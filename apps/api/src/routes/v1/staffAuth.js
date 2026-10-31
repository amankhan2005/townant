import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../../db.js';
import { hashPassword, hmac, verifyPassword } from '../../lib/crypto.js';
import { AppError, unauthorized } from '../../lib/errors.js';
import { maskDestination } from '../../lib/logger.js';
import { email, text, validate } from '../../lib/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { Company, Membership, Session, User } from '../../models/index.js';
import { actorOf, audit } from '../../services/audit.js';
import { consumeActionToken, inspectActionToken, requestPasswordReset } from '../../services/onboarding.js';
import { issueOtp, OTP_RESEND_COOLDOWN_SECONDS, pendingOtp, verifyOtp } from '../../services/otp.js';
import { createSession, issueSession, revokeAllSessions } from '../../services/session.js';

const router = Router();
const MIN = 60 * 1000;

const COMMON = new Set(['password1234', '123456789012', 'qwertyuiop12', 'townant12345', 'letmein12345', 'passwordpassword']);
export const password = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128)
  .refine((p) => !COMMON.has(p.toLowerCase()) && new Set(p).size >= 5, 'Choose a less predictable password');

// Every attempt counts (fixed 15-minute windows, per IP and per email); the limit lifts when the window ends.
const LOGIN_LIMITED = 'Too many sign-in attempts. Please wait a few minutes and try again.';

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

// `resume`: signing in again while the last code is still within its resend cooldown (e.g. a
// second attempt while the first email is on its way) continues with that code: nothing is sent
// and no send budget is used. Otherwise a new code is issued under the usual limits. The explicit
// "send a new code" action never resumes.
async function startMfa(user, req, { resume = false } = {}) {
  const otp = { channel: 'email', destination: user.email, purpose: 'mfa', userId: user._id };
  if (resume) {
    const fresh = await pendingOtp({ ...otp, createdAfter: new Date(Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000) });
    if (fresh) return fresh;
  }
  return issueOtp({ ...otp, req });
}

router.post(
  '/login',
  rateLimit({ name: 'staff-login-ip', windowMs: 15 * MIN, max: 20, failClosed: true, message: LOGIN_LIMITED }),
  validate({ body: z.object({ email, password: z.string().min(1).max(128), transport: z.enum(['cookie', 'bearer']).default('cookie') }).strict() }),
  rateLimit({ name: 'staff-login-account', windowMs: 15 * MIN, max: 8, failClosed: true, key: (req) => hmac(`login:${req.valid.body.email}`), message: LOGIN_LIMITED }),
  async (req, res) => {
    const { email: addr, password: pw, transport } = req.valid.body;
    const user = await User.findOne({ accountType: 'staff', email: addr }).select('+passwordHash');
    const ok = await verifyPassword(pw, user?.passwordHash);
    if (!user || !ok || user.status !== 'active') throw invalidCredentials();
    // A Super Admin-issued temporary password stops working after its expiry. The caller already
    // proved they know it, so saying why is safe and points them at a recovery path.
    if (user.passwordChangeRequired && user.temporaryPasswordExpiresAt && user.temporaryPasswordExpiresAt <= new Date()) {
      throw new AppError(401, 'TEMPORARY_PASSWORD_EXPIRED', 'This temporary password has expired. Use “Forgot password” or ask TownAnt for a new one.');
    }

    const mfaRequired = user.role === 'super_admin';
    // The code is issued before the session, so a failed send never leaves a half-signed-in session.
    const mfa = mfaRequired ? await startMfa(user, req, { resume: true }) : undefined;
    const issued = await createSession({ user, transport, req, mfaRequired });
    const body = issueSession(res, issued, user);
    if (mfa) body.mfa = mfa;
    await audit(req, { action: 'staff.login', entityType: 'user', entityId: user._id, metadata: { mfaRequired }, actor: actorOf(user) });
    res.json({ data: body });
  },
);

router.post('/mfa/resend', requireAuth, async (req, res) => {
  const { session, user } = req.auth;
  if (!session.mfaRequired || session.mfaVerifiedAt) throw new AppError(409, 'MFA_NOT_PENDING', 'Two-step verification is not pending.');
  res.status(201).json({ data: await startMfa(user, req) });
});

router.post(
  '/mfa/verify',
  requireAuth,
  rateLimit({ name: 'staff-mfa-verify', windowMs: 10 * MIN, max: 10, failClosed: true, key: (req) => req.auth.user._id.toString() }),
  validate({ body: z.object({ challengeId: z.string().min(16).max(64), code: z.string().regex(/^\d{6}$/) }).strict() }),
  async (req, res) => {
    const { session, user } = req.auth;
    if (!session.mfaRequired || session.mfaVerifiedAt) throw new AppError(409, 'MFA_NOT_PENDING', 'Two-step verification is not pending.');
    await verifyOtp({ ...req.valid.body, channel: 'email', destination: user.email, purpose: 'mfa', userId: user._id });
    await Session.updateOne({ _id: session._id }, { $set: { mfaVerifiedAt: new Date() } });
    await audit(req, { action: 'staff.mfa_verified', entityType: 'user', entityId: user._id });
    res.json({ data: { user: user.toSelf(), mfaRequired: false } });
  },
);

router.post(
  '/invite/inspect',
  rateLimit({ name: 'staff-invite-inspect', windowMs: 15 * MIN, max: 30 }),
  validate({ body: z.object({ token: z.string().min(20).max(100) }).strict() }),
  async (req, res) => {
    const user = await inspectActionToken(req.valid.body.token, 'staff_invite');
    if (!user || user.status !== 'invited') return res.json({ data: { valid: false } });
    const membership = await Membership.findOne({ userId: user._id, status: 'active' }).lean();
    const company = membership ? await Company.findById(membership.companyId, { name: 1 }).lean() : null;
    return res.json({ data: { valid: true, email: maskDestination('email', user.email), role: user.role, companyName: company?.name ?? null } });
  },
);

router.post(
  '/invite/accept',
  rateLimit({ name: 'staff-invite-accept', windowMs: 15 * MIN, max: 10, failClosed: true }),
  validate({ body: z.object({ token: z.string().min(20).max(100), password, displayName: text(80, { min: 1 }), transport: z.enum(['cookie', 'bearer']).default('cookie') }).strict() }),
  async (req, res) => {
    const { token, password: pw, displayName, transport } = req.valid.body;
    const passwordHash = await hashPassword(pw);
    const user = await withTransaction(async (session) => {
      const record = await consumeActionToken(token, 'staff_invite', session);
      if (!record) throw new AppError(400, 'TOKEN_INVALID', 'This setup link is invalid or has expired. Ask TownAnt to send a new one.');
      const updated = await User.findOneAndUpdate(
        { _id: record.userId, status: 'invited' },
        { $set: { status: 'active', passwordHash, passwordChangedAt: new Date(), displayName, emailVerifiedAt: new Date() } },
        { new: true, session },
      );
      if (!updated) throw new AppError(400, 'TOKEN_INVALID', 'This setup link is invalid or has expired.');
      await audit(req, { action: 'staff.invite_accepted', entityType: 'user', entityId: updated._id, actor: actorOf(updated) }, session);
      return updated;
    });
    // Following the emailed single-use link already proved control of the address, which
    // is the second factor for Super Admins.
    const admin = user.role === 'super_admin';
    const issued = await createSession({ user, transport, req, mfaRequired: admin, mfaVerified: admin });
    res.json({ data: issueSession(res, issued, user) });
  },
);

router.post(
  '/password/forgot',
  rateLimit({ name: 'staff-password-forgot', windowMs: 60 * MIN, max: 5, failClosed: true }),
  validate({ body: z.object({ email }).strict() }),
  async (req, res) => {
    await requestPasswordReset(req.valid.body.email);
    // Same response whether or not the account exists.
    res.status(202).json({ data: { message: 'If an account exists for that email, a reset link is on its way.' } });
  },
);

router.post(
  '/password/reset',
  rateLimit({ name: 'staff-password-reset', windowMs: 15 * MIN, max: 10, failClosed: true }),
  validate({ body: z.object({ token: z.string().min(20).max(100), password }).strict() }),
  async (req, res) => {
    const passwordHash = await hashPassword(req.valid.body.password);
    const user = await withTransaction(async (session) => {
      const record = await consumeActionToken(req.valid.body.token, 'password_reset', session);
      if (!record) throw new AppError(400, 'TOKEN_INVALID', 'This reset link is invalid or has expired.');
      const updated = await User.findOneAndUpdate(
        { _id: record.userId, status: 'active' },
        { $set: { passwordHash, passwordChangedAt: new Date(), passwordChangeRequired: false }, $unset: { temporaryPasswordExpiresAt: 1 } },
        { new: true, session },
      );
      if (!updated) throw new AppError(400, 'TOKEN_INVALID', 'This reset link is invalid or has expired.');
      await audit(req, { action: 'staff.password_reset', entityType: 'user', entityId: updated._id, actor: actorOf(updated) }, session);
      return updated;
    });
    await revokeAllSessions(user._id, 'password_reset');
    res.json({ data: { message: 'Password updated. Sign in with your new password.' } });
  },
);

router.post(
  '/password/change',
  requireAuth,
  rateLimit({ name: 'staff-password-change', windowMs: 15 * MIN, max: 10, failClosed: true, key: (req) => req.auth.user._id.toString(), message: 'Too many password attempts. Please wait a few minutes and try again.' }),
  validate({ body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: password, confirmPassword: z.string().max(128).optional() }).strict() }),
  async (req, res) => {
    const { user, session } = req.auth;
    if (user.accountType !== 'staff') throw unauthorized();
    const { currentPassword, newPassword, confirmPassword } = req.valid.body;
    if (confirmPassword !== undefined && confirmPassword !== newPassword) throw new AppError(400, 'VALIDATION_ERROR', 'The new passwords don’t match.', { fields: [{ path: 'confirmPassword', message: 'Passwords don’t match' }] });
    const withHash = await User.findById(user._id).select('+passwordHash');
    if (!(await verifyPassword(currentPassword, withHash.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Your current password is incorrect.');
    if (await verifyPassword(newPassword, withHash.passwordHash)) throw new AppError(422, 'PASSWORD_REUSED', 'Choose a password that is different from your current one.');
    const wasTemporary = Boolean(user.passwordChangeRequired);
    await User.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), passwordChangeRequired: false }, $unset: { temporaryPasswordExpiresAt: 1 } },
    );
    // This session stays signed in; every other session for the account ends.
    await Session.updateMany({ userId: user._id, _id: { $ne: session._id }, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'password_change' } });
    await audit(req, { action: 'staff.password_change', entityType: 'user', entityId: user._id, metadata: { replacedTemporary: wasTemporary } });
    const fresh = await User.findById(user._id);
    res.json({ data: { message: 'Password changed. Other sessions were signed out.', user: fresh.toSelf() } });
  },
);

export default router;
