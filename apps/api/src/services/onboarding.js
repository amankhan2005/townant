import { withTransaction } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { ActionToken, Company, Membership, User, VendorApplication } from '../models/index.js';
import { providers } from '../providers/index.js';
import { audit } from './audit.js';
import { rebuildSearchText, uniqueSlug } from './catalog.js';
import { renderEmail } from './emailTemplates.js';
import { queueDirectEmail } from './notifications.js';

const INVITE_TTL_HOURS = 72;
const RESET_TTL_HOURS = 1;

export async function createActionToken({ userId, purpose, ttlHours, createdBy }, session) {
  const token = randomToken(32);
  // Issuing a new token voids any earlier unused one for the same purpose.
  await ActionToken.updateMany({ userId, purpose, consumedAt: null }, { $set: { consumedAt: new Date() } }, session ? { session } : undefined);
  await ActionToken.create([{ tokenHash: sha256(token), purpose, userId, createdBy, expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000) }], session ? { session } : undefined);
  return token;
}

// Validates without consuming (used to show the setup form). Returns the user or null.
export async function inspectActionToken(token, purpose) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const record = await ActionToken.findOne({ tokenHash: sha256(token), purpose, consumedAt: null, expiresAt: { $gt: new Date() } }).lean();
  if (!record) return null;
  return User.findById(record.userId);
}

// Atomically consumes a token so it can be used only once.
export async function consumeActionToken(token, purpose, session) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const record = await ActionToken.findOneAndUpdate(
    { tokenHash: sha256(token), purpose, consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { new: true, session },
  );
  return record;
}

// Sends immediately rather than through the outbox so the raw token is never persisted.
async function sendTokenEmail(to, template, payload) {
  const email = providers().email;
  if (!email) return false;
  try {
    await email.send({ to, ...renderEmail(template, payload) });
    return true;
  } catch (err) {
    logger.warn({ err: err.message, template }, 'token email not sent');
    return false;
  }
}

const REVIEWABLE = ['submitted', 'under_review', 'info_requested'];

// Creates the company (draft), the owner account (invited) and the membership in one
// transaction, then emails a single-use setup link. If the email already belongs to a
// staff account, the company is added to that account instead.
async function provisionCompany(req, { name, email, categoryIds, description, address, serviceMode, contactPhone, website, applicationId }, session) {
  const slug = await uniqueSlug(name, session);
  const [company] = await Company.create(
    [
      {
        name,
        slug,
        status: 'draft',
        primaryCategoryId: categoryIds?.[0],
        categoryIds: categoryIds ?? [],
        summary: (description ?? '').slice(0, 300),
        description: description ?? '',
        contact: { email, phone: contactPhone, website },
        address: { ...address, country: address?.country ?? 'US' },
        serviceMode: serviceMode ?? 'fixed',
        applicationId,
        createdBy: req.auth.user._id,
      },
    ],
    { session },
  );

  let user = await User.findOne({ accountType: 'staff', email }).session(session);
  let existing = true;
  if (user && user.role !== 'vendor') throw conflict('EMAIL_IN_USE', 'This email belongs to a TownAnt administrator account.');
  if (!user) {
    existing = false;
    [user] = await User.create([{ accountType: 'staff', role: 'vendor', status: 'invited', email, emailVerifiedAt: undefined }], { session });
  }
  await Membership.create([{ userId: user._id, companyId: company._id, role: 'owner' }], { session });
  const token = existing && user.status === 'active' ? null : await createActionToken({ userId: user._id, purpose: 'staff_invite', ttlHours: INVITE_TTL_HOURS, createdBy: req.auth.user._id }, session);
  await rebuildSearchText(company._id, session);
  return { company, user, token };
}

export async function approveApplication(req, applicationId, reason) {
  const result = await withTransaction(async (session) => {
    const app = await VendorApplication.findOneAndUpdate(
      { _id: applicationId, status: { $in: REVIEWABLE } },
      { $set: { status: 'approved', reviewerId: req.auth.user._id, decidedAt: new Date(), decisionReason: reason } },
      { new: true, session },
    );
    if (!app) throw conflict('APPLICATION_NOT_REVIEWABLE', 'This application has already been decided or does not exist.');
    const provisioned = await provisionCompany(
      req,
      {
        name: app.businessName,
        email: app.email,
        categoryIds: app.categoryIds,
        description: app.description,
        address: app.address,
        serviceMode: app.serviceMode,
        contactPhone: app.phone,
        website: app.website,
        applicationId: app._id,
      },
      session,
    );
    app.companyId = provisioned.company._id;
    await app.save({ session });
    await queueDirectEmail({ toEmail: app.email, template: 'application_decision', payload: { businessName: app.businessName, status: 'approved', reason }, dedupeKey: `application:${app._id}:approved` }, session);
    await audit(req, { action: 'vendor_application.approve', entityType: 'vendor_application', entityId: app._id, companyId: provisioned.company._id, reason }, session);
    await audit(req, { action: 'company.create', entityType: 'company', entityId: provisioned.company._id, companyId: provisioned.company._id, metadata: { source: 'application' } }, session);
    return { app, ...provisioned };
  });
  const inviteEmailSent = result.token
    ? await sendTokenEmail(result.user.email, 'staff_invite', { token: result.token, companyName: result.company.name })
    : await sendTokenEmail(result.user.email, 'staff_added', { companyName: result.company.name });
  return { application: result.app, company: result.company, inviteEmailSent };
}

export async function decideApplication(req, applicationId, status, reason) {
  if (!reason) throw unprocessable('REASON_REQUIRED', 'Please give a reason the applicant can act on.');
  return withTransaction(async (session) => {
    const app = await VendorApplication.findOneAndUpdate(
      { _id: applicationId, status: { $in: status === 'info_requested' ? ['submitted', 'under_review'] : REVIEWABLE } },
      { $set: { status, reviewerId: req.auth.user._id, decidedAt: new Date(), decisionReason: reason } },
      { new: true, session },
    );
    if (!app) throw conflict('APPLICATION_NOT_REVIEWABLE', 'This application cannot be changed in its current state.');
    await queueDirectEmail(
      { toEmail: app.email, template: 'application_decision', payload: { businessName: app.businessName, status, reason }, dedupeKey: `application:${app._id}:${status}:${app.updatedAt.getTime()}` },
      session,
    );
    await audit(req, { action: `vendor_application.${status === 'rejected' ? 'reject' : 'request_info'}`, entityType: 'vendor_application', entityId: app._id, reason }, session);
    return app;
  });
}

// Direct creation by a Super Admin without a public application.
export async function adminCreateCompany(req, input) {
  const result = await withTransaction(async (session) => {
    const provisioned = await provisionCompany(req, input, session);
    await audit(req, { action: 'company.create', entityType: 'company', entityId: provisioned.company._id, companyId: provisioned.company._id, metadata: { source: 'admin' } }, session);
    return provisioned;
  });
  const inviteEmailSent = result.token
    ? await sendTokenEmail(result.user.email, 'staff_invite', { token: result.token, companyName: result.company.name })
    : await sendTokenEmail(result.user.email, 'staff_added', { companyName: result.company.name });
  return { company: result.company, inviteEmailSent };
}

export async function resendInvite(req, companyId) {
  const owner = await Membership.findOne({ companyId, role: 'owner', status: 'active' });
  if (!owner) throw notFound('No owner found for this business.');
  const user = await User.findById(owner.userId);
  if (!user || user.status !== 'invited') throw conflict('ALREADY_ACTIVE', 'The owner has already completed setup. They can use “Forgot password” if needed.');
  const company = await Company.findById(companyId, { name: 1 });
  const token = await createActionToken({ userId: user._id, purpose: 'staff_invite', ttlHours: INVITE_TTL_HOURS, createdBy: req.auth.user._id });
  await audit(req, { action: 'company.resend_invite', entityType: 'company', entityId: companyId, companyId });
  return { inviteEmailSent: await sendTokenEmail(user.email, 'staff_invite', { token, companyName: company.name }) };
}

export async function requestPasswordReset(email) {
  const user = await User.findOne({ accountType: 'staff', email, status: 'active' });
  if (!user) return;
  const token = await createActionToken({ userId: user._id, purpose: 'password_reset', ttlHours: RESET_TTL_HOURS });
  await sendTokenEmail(user.email, 'password_reset', { token, area: user.role === 'super_admin' ? 'admin' : 'business' });
}
