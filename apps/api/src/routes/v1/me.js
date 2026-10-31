import { Router } from 'express';
import { z } from 'zod';
import { isDuplicateKey } from '../../db.js';
import { AppError, conflict } from '../../lib/errors.js';
import { countryCode, email, text, validate } from '../../lib/validate.js';
import { requireAuth, requireCustomer } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { hashPassword, verifyPassword } from '../../lib/crypto.js';
import { Session, User } from '../../models/index.js';
import { deletionSummary, requestCustomerDeletion } from '../../services/accountDeletion.js';
import { audit } from '../../services/audit.js';
import { issueOtp, verifyOtp } from '../../services/otp.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../../services/session.js';
import { resolveDestination } from './auth.js';
import { password } from './staffAuth.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ data: req.auth.user.toSelf() });
});

// Only presentation and preference fields. Identifiers change through /identifiers with
// proof of control; role and status can never be set here.
router.patch(
  '/',
  requireAuth,
  validate({
    body: z
      .object({
        displayName: text(80, { min: 1 }).optional(),
        notificationPrefs: z.object({ email: z.boolean().optional(), push: z.boolean().optional() }).strict().optional(),
        defaultLocation: z
          .object({ country: countryCode.optional(), region: text(80).optional(), city: text(80).optional(), postalCode: text(12).optional() })
          .strict()
          .optional(),
      })
      .strict(),
  }),
  async (req, res) => {
    const body = req.valid.body;
    const $set = {};
    if (body.displayName !== undefined) $set.displayName = body.displayName;
    if (body.notificationPrefs?.email !== undefined) $set['notificationPrefs.email'] = body.notificationPrefs.email;
    if (body.notificationPrefs?.push !== undefined) $set['notificationPrefs.push'] = body.notificationPrefs.push;
    if (body.defaultLocation && req.auth.user.role === 'customer') $set.defaultLocation = body.defaultLocation;
    const user = await User.findByIdAndUpdate(req.auth.user._id, { $set }, { new: true });
    res.json({ data: user.toSelf() });
  },
);

const identifierBody = {
  channel: z.enum(['email', 'whatsapp']),
  email: email.optional(),
  phone: z.string().trim().max(32).optional(),
  country: countryCode.optional(),
};

// Adds or changes an email or phone on a customer account after proving control with an OTP.
// If the identifier already belongs to another account the request fails; accounts are
// never merged automatically.
router.post(
  '/identifiers/request',
  requireCustomer,
  rateLimit({ name: 'identifier-request', windowMs: 60 * 60 * 1000, max: 10, failClosed: true, key: (req) => req.auth.user._id.toString() }),
  validate({ body: z.object(identifierBody).strict() }),
  async (req, res) => {
    const body = req.valid.body;
    const destination = resolveDestination(body);
    const field = body.channel === 'email' ? 'email' : 'phone';
    if (await User.exists({ accountType: 'customer', [field]: destination, _id: { $ne: req.auth.user._id } })) {
      throw conflict('IDENTIFIER_UNAVAILABLE', `This ${field === 'email' ? 'email' : 'number'} can't be added to your account.`);
    }
    const challenge = await issueOtp({ channel: body.channel, destination, purpose: 'link', userId: req.auth.user._id, req });
    res.status(201).json({ data: challenge });
  },
);

router.post(
  '/identifiers/verify',
  requireCustomer,
  validate({ body: z.object({ ...identifierBody, challengeId: z.string().min(16).max(64), code: z.string().regex(/^\d{6}$/) }).strict() }),
  async (req, res) => {
    const body = req.valid.body;
    const destination = resolveDestination(body);
    await verifyOtp({ challengeId: body.challengeId, channel: body.channel, destination, code: body.code, purpose: 'link', userId: req.auth.user._id });
    const field = body.channel === 'email' ? 'email' : 'phone';
    try {
      const user = await User.findByIdAndUpdate(req.auth.user._id, { $set: { [field]: destination, [`${field}VerifiedAt`]: new Date() } }, { new: true });
      res.json({ data: user.toSelf() });
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('IDENTIFIER_UNAVAILABLE', `This ${field === 'email' ? 'email' : 'number'} can't be added to your account.`);
      throw err;
    }
  },
);

router.get('/sessions', requireAuth, async (req, res) => {
  const sessions = await Session.find({ userId: req.auth.user._id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).lean();
  res.json({
    data: sessions.map((s) => ({ id: s._id.toString(), current: s._id.equals(req.auth.session._id), userAgent: s.userAgent, lastSeenAt: s.lastSeenAt, createdAt: s.createdAt })),
  });
});

router.post('/sessions/revoke-others', requireAuth, async (req, res) => {
  const result = await Session.updateMany(
    { userId: req.auth.user._id, _id: { $ne: req.auth.session._id }, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'user_revoked' } },
  );
  res.json({ data: { revoked: result.modifiedCount } });
});

// ----- Account deletion (customers) -----
// Three steps: review what happens, re-verify with a fresh one-time code sent to an identifier
// already on the account, then confirm. The account then stays restorable for 15 days
// (services/accountDeletion.js) before it is permanently deleted.

const deletionLimit = rateLimit({ name: 'account-deletion', windowMs: 60 * 60 * 1000, max: 10, failClosed: true, key: (req) => req.auth.user._id.toString() });

// The verified identifier the code goes to; never one supplied by the client.
function verifiedDestination(user, channel, purpose = 'deleting your account') {
  const email = user.emailVerifiedAt && user.email ? { channel: 'email', destination: user.email } : null;
  const phone = user.phoneVerifiedAt && user.phone ? { channel: 'whatsapp', destination: user.phone } : null;
  const pick = channel === 'whatsapp' ? phone : channel === 'email' ? email : email ?? phone;
  if (!pick) throw new AppError(422, 'NO_VERIFIED_IDENTIFIER', `Add and verify an email or phone number before ${purpose}.`);
  return pick;
}

const verifiedChannels = (u) => [u.emailVerifiedAt && u.email ? 'email' : null, u.phoneVerifiedAt && u.phone ? 'whatsapp' : null].filter(Boolean);

router.get('/deletion', requireCustomer, async (req, res) => {
  res.json({ data: { ...(await deletionSummary(req.auth.user._id)), channels: verifiedChannels(req.auth.user) } });
});

router.post('/deletion/challenge', requireCustomer, deletionLimit, validate({ body: z.object({ channel: z.enum(['email', 'whatsapp']).optional() }).strict() }), async (req, res) => {
  const { channel, destination } = verifiedDestination(req.auth.user, req.valid.body.channel);
  const challenge = await issueOtp({ channel, destination, purpose: 'account_deletion', userId: req.auth.user._id, req });
  res.status(201).json({ data: challenge });
});

router.post(
  '/deletion',
  requireCustomer,
  deletionLimit,
  validate({ body: z.object({ channel: z.enum(['email', 'whatsapp']), challengeId: z.string().min(16).max(64), code: z.string().regex(/^\d{6}$/), confirm: z.literal('DELETE') }).strict() }),
  async (req, res) => {
    const { channel, challengeId, code } = req.valid.body;
    const { destination } = verifiedDestination(req.auth.user, channel);
    await verifyOtp({ challengeId, channel, destination, code, purpose: 'account_deletion', userId: req.auth.user._id });
    const result = await requestCustomerDeletion(req, req.auth.user);
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions({}), expires: undefined });
    // `deleted` is kept for older clients; the account is pending deletion until `recoverUntil`.
    res.json({ data: { deleted: true, pendingDeletion: true, ...result } });
  },
);

// ----- Optional password (customers) -----
// One-time codes stay the primary sign-in. Adding a first password needs a fresh code sent to a
// verified identifier on the account; changing or removing one needs the current password.

const passwordLimit = rateLimit({ name: 'customer-password', windowMs: 15 * 60 * 1000, max: 10, failClosed: true, key: (req) => req.auth.user._id.toString(), message: 'Too many password attempts. Please wait a few minutes and try again.' });

router.post('/password/challenge', requireCustomer, passwordLimit, validate({ body: z.object({ channel: z.enum(['email', 'whatsapp']).optional() }).strict() }), async (req, res) => {
  const { channel, destination } = verifiedDestination(req.auth.user, req.valid.body.channel, 'adding a password');
  const challenge = await issueOtp({ channel, destination, purpose: 'password_setup', userId: req.auth.user._id, req });
  res.status(201).json({ data: challenge });
});

router.put(
  '/password',
  requireCustomer,
  passwordLimit,
  validate({
    body: z
      .object({
        newPassword: password,
        confirmPassword: z.string().max(128),
        currentPassword: z.string().min(1).max(128).optional(),
        channel: z.enum(['email', 'whatsapp']).optional(),
        challengeId: z.string().min(16).max(64).optional(),
        code: z.string().regex(/^\d{6}$/).optional(),
      })
      .strict(),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const { user, session } = req.auth;
    if (b.confirmPassword !== b.newPassword) throw new AppError(400, 'VALIDATION_ERROR', 'The new passwords don’t match.', { fields: [{ path: 'confirmPassword', message: 'Passwords don’t match' }] });
    const withHash = await User.findById(user._id).select('+passwordHash');
    if (withHash.passwordHash) {
      if (!b.currentPassword || !(await verifyPassword(b.currentPassword, withHash.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Your current password is incorrect.');
      if (await verifyPassword(b.newPassword, withHash.passwordHash)) throw new AppError(422, 'PASSWORD_REUSED', 'Choose a password that is different from your current one.');
    } else {
      if (!b.challengeId || !b.code || !b.channel) throw new AppError(400, 'VERIFICATION_REQUIRED', 'Enter the code we sent you to add a password.');
      const { destination } = verifiedDestination(user, b.channel, 'adding a password');
      await verifyOtp({ challengeId: b.challengeId, channel: b.channel, destination, code: b.code, purpose: 'password_setup', userId: user._id });
    }
    const added = !withHash.passwordHash;
    await User.updateOne({ _id: user._id, status: 'active' }, { $set: { passwordHash: await hashPassword(b.newPassword), passwordChangedAt: new Date() } });
    await Session.updateMany({ userId: user._id, _id: { $ne: session._id }, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'password_change' } });
    await audit(req, { action: added ? 'user.password_add' : 'user.password_change', entityType: 'user', entityId: user._id });
    res.json({ data: { user: (await User.findById(user._id)).toSelf(), message: added ? 'Password added. You can still sign in with a one-time code.' : 'Password changed. Other sessions were signed out.' } });
  },
);

router.delete('/password', requireCustomer, passwordLimit, validate({ body: z.object({ currentPassword: z.string().min(1).max(128) }).strict() }), async (req, res) => {
  const withHash = await User.findById(req.auth.user._id).select('+passwordHash');
  if (!withHash.passwordHash) throw new AppError(409, 'NO_PASSWORD', 'This account has no password.');
  if (!(await verifyPassword(req.valid.body.currentPassword, withHash.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Your current password is incorrect.');
  await User.updateOne({ _id: withHash._id }, { $unset: { passwordHash: 1, passwordChangedAt: 1 } });
  await audit(req, { action: 'user.password_remove', entityType: 'user', entityId: withHash._id });
  res.json({ data: { user: (await User.findById(withHash._id)).toSelf(), message: 'Password removed. Sign in with a one-time code.' } });
});

export default router;
