import { getEnv } from '../config/env.js';
import { hmac, ipFingerprint, numericCode, randomToken, safeEqual } from '../lib/crypto.js';
import { AppError, unavailable } from '../lib/errors.js';
import { logger, maskDestination } from '../lib/logger.js';
import { OtpChallenge } from '../models/index.js';
import { providers } from '../providers/index.js';
import { renderEmail } from './emailTemplates.js';
import { enforce } from './rateLimit.js';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
const HOUR = 3600 * 1000;

export const destinationFingerprint = (channel, destination) => hmac(`dest:${channel}:${destination}`);
const codeDigest = (challengeId, code) => hmac(`otp:${challengeId}:${code}`);

const invalidCode = () => new AppError(400, 'OTP_INVALID', 'That code is incorrect or has expired. Request a new code and try again.');

export function availableChannels() {
  const p = providers();
  return { email: Boolean(p.email), whatsapp: Boolean(p.whatsapp) };
}

// Issues a one-time code to an already-normalized destination. Rate limits apply per
// destination, per IP and globally per channel so the endpoint cannot be used as a relay.
export async function issueOtp({ channel, destination, purpose, userId, req }) {
  const p = providers();
  const sender = channel === 'email' ? p.email : p.whatsapp;
  if (!sender) throw unavailable('CHANNEL_UNAVAILABLE', 'This sign-in method is not available right now. Try another method.');

  const destHash = destinationFingerprint(channel, destination);
  const ipHash = ipFingerprint(req.ip);
  const limit = { failClosed: true, message: 'Too many codes requested. Please wait before trying again.' };
  await enforce(`otp-send:ip:${ipHash}`, { windowMs: HOUR, max: 15, ...limit });
  await enforce(`otp-send:dest:${destHash}`, { windowMs: HOUR, max: 5, ...limit });
  await enforce(`otp-send:global:${channel}`, { windowMs: 24 * HOUR, max: getEnv().OTP_DAILY_GLOBAL_CAP, ...limit });

  const latest = await OtpChallenge.findOne({ destinationHash: destHash, purpose }).sort({ createdAt: -1 }).lean();
  if (latest) {
    const waitMs = latest.createdAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000 - Date.now();
    if (waitMs > 0) throw new AppError(429, 'OTP_COOLDOWN', 'Please wait before requesting another code.', { retryAfterSeconds: Math.ceil(waitMs / 1000) });
  }

  // A new code supersedes every earlier unused code for this destination.
  await OtpChallenge.updateMany({ destinationHash: destHash, purpose, consumedAt: null, invalidatedAt: null }, { $set: { invalidatedAt: new Date() } });

  const challengeId = randomToken(24);
  const code = numericCode(6);
  const now = Date.now();
  const challenge = await OtpChallenge.create({
    challengeId,
    purpose,
    channel,
    destinationHash: destHash,
    userId,
    codeHash: codeDigest(challengeId, code),
    expiresAt: new Date(now + OTP_TTL_MINUTES * 60 * 1000),
    maxAttempts: OTP_MAX_ATTEMPTS,
    ipHash,
    purgeAt: new Date(now + 24 * HOUR),
  });

  try {
    const result =
      channel === 'email'
        ? await sender.send({ to: destination, ...renderEmail('otp_code', { code, minutes: OTP_TTL_MINUTES }), idempotencyKey: `otp-${challengeId}` })
        : await sender.sendOtp({ to: destination, code });
    await OtpChallenge.updateOne({ _id: challenge._id }, { $set: { deliveryStatus: 'sent', providerMessageId: result?.id } });
  } catch (err) {
    await OtpChallenge.updateOne({ _id: challenge._id }, { $set: { deliveryStatus: 'failed', invalidatedAt: new Date() } });
    logger.warn({ provider: err.provider, err: err.message, channel, purpose }, 'otp delivery failed');
    throw new AppError(502, 'OTP_DELIVERY_FAILED', "We couldn't send your code. Check the details and try again, or use another sign-in method.");
  }

  return {
    challengeId,
    channel,
    maskedDestination: maskDestination(channel, destination),
    expiresAt: challenge.expiresAt,
    resendAvailableAt: new Date(now + OTP_RESEND_COOLDOWN_SECONDS * 1000),
  };
}

// The newest code for this user and destination that can still be used (sent, unconsumed,
// not superseded, unexpired, attempts left), in issueOtp's response shape; null if none.
// `createdAfter` restricts it to codes sent since then.
export async function pendingOtp({ channel, destination, purpose, userId, createdAfter }) {
  const challenge = await OtpChallenge.findOne({
    ...(createdAfter && { createdAt: { $gt: createdAfter } }),
    destinationHash: destinationFingerprint(channel, destination),
    purpose,
    userId,
    deliveryStatus: 'sent',
    consumedAt: null,
    invalidatedAt: null,
    expiresAt: { $gt: new Date() },
    $expr: { $lt: ['$attempts', '$maxAttempts'] },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (!challenge) return null;
  return {
    challengeId: challenge.challengeId,
    channel,
    maskedDestination: maskDestination(channel, destination),
    expiresAt: challenge.expiresAt,
    resendAvailableAt: new Date(challenge.createdAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000),
  };
}

// Verifies and consumes a code. Each attempt is counted atomically before comparison, and
// consumption is a conditional write, so concurrent submissions of the same code cannot both succeed.
export async function verifyOtp({ challengeId, channel, destination, code, purpose, userId }) {
  const now = new Date();
  const challenge = await OtpChallenge.findOneAndUpdate(
    {
      challengeId,
      purpose,
      channel,
      consumedAt: null,
      invalidatedAt: null,
      expiresAt: { $gt: now },
      $expr: { $lt: ['$attempts', '$maxAttempts'] },
    },
    { $inc: { attempts: 1 } },
    { new: true },
  );
  if (!challenge) throw invalidCode();

  const destinationMatches = safeEqual(challenge.destinationHash, destinationFingerprint(channel, destination));
  const userMatches = !challenge.userId || (userId && challenge.userId.equals(userId));
  const codeMatches = safeEqual(challenge.codeHash, codeDigest(challengeId, String(code)));

  if (!destinationMatches || !userMatches || !codeMatches) {
    if (challenge.attempts >= challenge.maxAttempts) {
      await OtpChallenge.updateOne({ _id: challenge._id }, { $set: { invalidatedAt: now } });
    }
    throw invalidCode();
  }

  const consumed = await OtpChallenge.updateOne({ _id: challenge._id, consumedAt: null, invalidatedAt: null }, { $set: { consumedAt: now } });
  if (consumed.modifiedCount !== 1) throw invalidCode();
  return { channel, destination };
}
