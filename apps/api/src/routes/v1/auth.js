import { Router } from 'express';
import { z } from 'zod';
import { isDuplicateKey, withTransaction } from '../../db.js';
import { hashPassword, hmac, ipFingerprint, randomToken, verifyPassword } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { maskDestination } from '../../lib/logger.js';
import { normalizePhone } from '../../lib/phone.js';
import { countryCode, email, text, validate } from '../../lib/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { User } from '../../models/index.js';
import { finalizeCustomerDeletion, restoreCustomerAccount } from '../../services/accountDeletion.js';
import { audit } from '../../services/audit.js';
import { consumeActionToken, createActionToken } from '../../services/onboarding.js';
import { availableChannels, destinationFingerprint, issueOtp, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_MINUTES, pendingOtp, verifyOtp } from '../../services/otp.js';
import { enforce } from '../../services/rateLimit.js';
import { createSession, issueSession, revokeAllSessions, revokeSession, SESSION_COOKIE, sessionCookieOptions } from '../../services/session.js';
import { password } from './staffAuth.js';

const router = Router();
const MIN = 60 * 1000;
const RESTORE_TOKEN_TTL_HOURS = 0.25;

const destinationShape = {
  channel: z.enum(['email', 'whatsapp']),
  email: email.optional(),
  phone: z.string().trim().max(32).optional(),
  country: countryCode.optional(),
};

// Exactly one destination matching the chosen channel; the other is never required.
export function resolveDestination(body) {
  if (body.channel === 'email') {
    if (!body.email) throw new AppError(400, 'VALIDATION_ERROR', 'Enter your email address.');
    return body.email;
  }
  if (!body.phone) throw new AppError(400, 'VALIDATION_ERROR', 'Enter your mobile number.');
  return normalizePhone(body.phone, body.country);
}

const identifierField = (channel) => (channel === 'email' ? 'email' : 'phone');
const verifiedField = (channel) => (channel === 'email' ? 'emailVerifiedAt' : 'phoneVerifiedAt');

// The response for a verified sign-in to an account that is pending deletion. Nothing is restored
// yet: the single-use token (15 minutes) only lets this person confirm the restore.
async function pendingDeletionResponse(user) {
  const restoreToken = await createActionToken({ userId: user._id, purpose: 'account_restore', ttlHours: RESTORE_TOKEN_TTL_HOURS });
  return new AppError(409, 'ACCOUNT_PENDING_DELETION', 'This account is scheduled for deletion. You can restore it now.', {
    restoreToken,
    recoverUntil: user.deletionScheduledFor,
  });
}

router.get('/channels', (_req, res) => {
  res.json({ data: availableChannels() });
});

router.post(
  '/otp/request',
  rateLimit({ name: 'auth-otp-request', windowMs: 10 * MIN, max: 10, failClosed: true }),
  validate({ body: z.object(destinationShape).strict() }),
  async (req, res) => {
    const body = req.valid.body;
    const destination = resolveDestination(body);
    const challenge = await issueOtp({ channel: body.channel, destination, purpose: 'login', req });
    res.status(201).json({ data: challenge });
  },
);

router.post(
  '/otp/verify',
  rateLimit({ name: 'auth-otp-verify', windowMs: 10 * MIN, max: 30, failClosed: true }),
  validate({
    body: z
      .object({
        ...destinationShape,
        challengeId: z.string().min(16).max(64),
        code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
        transport: z.enum(['cookie', 'bearer']).default('cookie'),
        displayName: text(80).optional(),
      })
      .strict(),
  }),
  async (req, res) => {
    const body = req.valid.body;
    const destination = resolveDestination(body);
    // A wrong, expired or reused code stops here: nothing below (sign-in or restore) can happen.
    await verifyOtp({ challengeId: body.challengeId, channel: body.channel, destination, code: body.code, purpose: 'login' });

    // Sign in to the account that owns this verified identifier, or create one.
    const field = identifierField(body.channel);
    const upsert = () =>
      User.findOneAndUpdate(
        { accountType: 'customer', [field]: destination },
        {
          $setOnInsert: { accountType: 'customer', role: 'customer', status: 'active', [field]: destination, displayName: body.displayName || undefined },
          $set: { [verifiedField(body.channel)]: new Date() },
        },
        { upsert: true, new: true },
      );
    const signIn = async () => {
      try {
        return await upsert();
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        return upsert();
      }
    };
    let user = await signIn();
    let previousAccountDeleted = false;

    if (user.status === 'pending_deletion') {
      if (user.deletionScheduledFor > new Date()) throw await pendingDeletionResponse(user);
      // The recovery window has ended but the job hasn't run yet: finish the deletion now, then
      // continue as a first sign-in, which creates a new, empty account for this identifier.
      await finalizeCustomerDeletion(user._id, { req });
      user = await signIn();
      previousAccountDeleted = true;
    }
    if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact TownAnt support.');

    const issued = await createSession({ user, transport: body.transport === 'bearer' ? 'bearer' : 'cookie', req });
    res.json({ data: { ...issueSession(res, issued, user), ...(previousAccountDeleted ? { previousAccountDeleted } : {}) } });
  },
);

// Restores a pending-deletion account. Requires the single-use token from a verified sign-in code
// (see /otp/verify) and an explicit confirmation. Restoring is separate from password reset.
router.post(
  '/account/restore',
  rateLimit({ name: 'auth-account-restore', windowMs: 15 * MIN, max: 10, failClosed: true }),
  validate({ body: z.object({ restoreToken: z.string().min(20).max(100), confirm: z.literal('RESTORE'), transport: z.enum(['cookie', 'bearer']).default('cookie') }).strict() }),
  async (req, res) => {
    const record = await withTransaction((session) => consumeActionToken(req.valid.body.restoreToken, 'account_restore', session));
    if (!record) throw new AppError(400, 'TOKEN_INVALID', 'This restore request has expired. Sign in again to restore your account.');
    const user = await restoreCustomerAccount(req, record.userId);
    const issued = await createSession({ user, transport: req.valid.body.transport, req });
    res.json({ data: { ...issueSession(res, issued, user), restored: true } });
  },
);

// ----- Optional customer password -----
// Customers can add a password as an alternative to one-time codes (see /me/password). OTP sign-in
// keeps working for every account, with or without a password.

const PASSWORD_LIMITED = 'Too many sign-in attempts. Please wait a few minutes and try again.';

router.post(
  '/password/login',
  rateLimit({ name: 'customer-login-ip', windowMs: 15 * MIN, max: 20, failClosed: true, message: PASSWORD_LIMITED }),
  validate({ body: z.object({ ...destinationShape, password: z.string().min(1).max(128), transport: z.enum(['cookie', 'bearer']).default('cookie') }).strict() }),
  async (req, res) => {
    const body = req.valid.body;
    const destination = resolveDestination(body);
    await enforce(`customer-login-account:${hmac(`clogin:${body.channel}:${destination}`)}`, { windowMs: 15 * MIN, max: 8, failClosed: true, message: PASSWORD_LIMITED });
    const field = identifierField(body.channel);
    const user = await User.findOne({ accountType: 'customer', [field]: destination, [verifiedField(body.channel)]: { $ne: null } }).select('+passwordHash');
    // Always runs a full hash comparison, so unknown identifiers take as long as wrong passwords.
    const ok = await verifyPassword(body.password, user?.passwordHash);
    if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Those sign-in details are incorrect. You can also sign in with a one-time code.');
    // Restoring a pending-deletion account always needs a fresh one-time code, never just a password.
    if (user.status === 'pending_deletion') {
      throw new AppError(409, 'RESTORE_REQUIRES_CODE', 'This account is scheduled for deletion. Sign in with a one-time code to restore it.');
    }
    if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact TownAnt support.');
    const issued = await createSession({ user, transport: body.transport, req });
    await audit(req, { action: 'user.password_login', entityType: 'user', entityId: user._id, actor: { actorType: 'customer', actorId: user._id } });
    res.json({ data: issueSession(res, issued, user) });
  },
);

// Sends a reset code only to an active customer account that has a password and owns this verified
// identifier. Every other case gets an indistinguishable response with no message sent.
router.post(
  '/password/forgot',
  rateLimit({ name: 'customer-password-forgot', windowMs: 60 * MIN, max: 10, failClosed: true }),
  validate({ body: z.object(destinationShape).strict() }),
  async (req, res) => {
    const body = req.valid.body;
    const destination = resolveDestination(body);
    const field = identifierField(body.channel);
    const user = await User.findOne({ accountType: 'customer', status: 'active', [field]: destination, [verifiedField(body.channel)]: { $ne: null }, passwordChangedAt: { $ne: null } }, { _id: 1 }).lean();
    const otp = { channel: body.channel, destination, purpose: 'password_reset' };
    let challenge;
    if (user) {
      try {
        challenge = await issueOtp({ ...otp, userId: user._id, req });
      } catch (err) {
        // Within the resend cooldown the earlier code is still valid; continue with it.
        if (err.code !== 'OTP_COOLDOWN') throw err;
        challenge = await pendingOtp({ ...otp, userId: user._id });
        if (!challenge) throw err;
      }
    } else {
      // Same per-IP and per-destination budgets as a real send, so limits don't reveal existence either.
      const limit = { failClosed: true, message: 'Too many codes requested. Please wait before trying again.' };
      await enforce(`otp-send:ip:${ipFingerprint(req.ip)}`, { windowMs: 60 * MIN, max: 15, ...limit });
      await enforce(`otp-send:dest:${destinationFingerprint(body.channel, destination)}`, { windowMs: 60 * MIN, max: 5, ...limit });
      const now = Date.now();
      challenge = {
        challengeId: randomToken(24),
        channel: body.channel,
        maskedDestination: maskDestination(body.channel, destination),
        expiresAt: new Date(now + OTP_TTL_MINUTES * MIN),
        resendAvailableAt: new Date(now + OTP_RESEND_COOLDOWN_SECONDS * 1000),
      };
    }
    res.status(201).json({ data: { ...challenge, message: 'If an account with a password uses this address, we sent it a reset code.' } });
  },
);

router.post(
  '/password/reset',
  rateLimit({ name: 'customer-password-reset', windowMs: 15 * MIN, max: 10, failClosed: true }),
  validate({ body: z.object({ ...destinationShape, challengeId: z.string().min(16).max(64), code: z.string().regex(/^\d{6}$/), password, confirmPassword: z.string().max(128).optional() }).strict() }),
  async (req, res) => {
    const body = req.valid.body;
    if (body.confirmPassword !== undefined && body.confirmPassword !== body.password) throw new AppError(400, 'VALIDATION_ERROR', 'The new passwords don’t match.');
    const destination = resolveDestination(body);
    const field = identifierField(body.channel);
    const user = await User.findOne({ accountType: 'customer', status: 'active', [field]: destination }, { _id: 1 }).lean();
    // The code is bound to the account it was issued for; a decoy or another account's code never matches.
    await verifyOtp({ challengeId: body.challengeId, channel: body.channel, destination, code: body.code, purpose: 'password_reset', userId: user?._id ?? null });
    if (!user) throw new AppError(400, 'OTP_INVALID', 'That code is incorrect or has expired. Request a new code and try again.');
    const passwordHash = await hashPassword(body.password);
    const updated = await User.updateOne({ _id: user._id, status: 'active' }, { $set: { passwordHash, passwordChangedAt: new Date() } });
    if (updated.modifiedCount !== 1) throw new AppError(400, 'OTP_INVALID', 'That code is incorrect or has expired. Request a new code and try again.');
    await revokeAllSessions(user._id, 'password_reset');
    await audit(req, { action: 'user.password_reset', entityType: 'user', entityId: user._id, actor: { actorType: 'customer', actorId: user._id } });
    res.json({ data: { message: 'Password updated. Sign in with your new password or a one-time code.' } });
  },
);

router.get('/session', (req, res) => {
  if (!req.auth) return res.json({ data: { user: null, channels: availableChannels() } });
  const { session, user } = req.auth;
  return res.json({
    data: { user: user.toSelf(), csrfToken: session.csrfToken, mfaRequired: session.mfaRequired && !session.mfaVerifiedAt, channels: availableChannels() },
  });
});

router.post('/logout', async (req, res) => {
  if (req.auth) await revokeSession(req.auth.session._id, 'logout');
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions({}), expires: undefined });
  res.status(204).end();
});

export default router;
