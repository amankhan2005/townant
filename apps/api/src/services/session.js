import { getEnv } from '../config/env.js';
import { ipFingerprint, randomToken, sha256 } from '../lib/crypto.js';
import { Session, User } from '../models/index.js';

export const SESSION_COOKIE = 'ta_sid';

// Absolute lifetime and idle timeout per role. Admin sessions are deliberately short.
const POLICY = {
  customer: { absoluteHours: 24 * 30, idleMinutes: 60 * 24 * 14 },
  vendor: { absoluteHours: 24 * 7, idleMinutes: 60 * 12 },
  super_admin: { absoluteHours: 12, idleMinutes: 30 },
};

export async function createSession({ user, transport, req, mfaRequired = false, mfaVerified = false }) {
  const policy = POLICY[user.role];
  const token = randomToken(32);
  const session = await Session.create({
    tokenHash: sha256(token),
    userId: user._id,
    accountType: user.accountType,
    csrfToken: randomToken(24),
    transport,
    mfaRequired,
    mfaVerifiedAt: mfaRequired && mfaVerified ? new Date() : undefined,
    expiresAt: new Date(Date.now() + policy.absoluteHours * 3600 * 1000),
    idleTimeoutMinutes: policy.idleMinutes,
    ipHash: ipFingerprint(req.ip),
    userAgent: String(req.get('user-agent') ?? '').slice(0, 200),
  });
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  return { token, session };
}

// Returns { session, user } for a live session, or null.
export async function resolveSession(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const now = new Date();
  const session = await Session.findOne({ tokenHash: sha256(token), revokedAt: null, expiresAt: { $gt: now } });
  if (!session) return null;
  if (now - session.lastSeenAt > session.idleTimeoutMinutes * 60 * 1000) {
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: now, revokedReason: 'idle_timeout' } });
    return null;
  }
  const user = await User.findById(session.userId);
  if (!user || user.status !== 'active') return null;
  if (now - session.lastSeenAt > 60 * 1000) {
    await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: now } });
  }
  return { session, user };
}

export const revokeSession = (sessionId, reason = 'logout') =>
  Session.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });

export const revokeAllSessions = (userId, reason) =>
  Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });

export function sessionCookieOptions(session) {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api',
    domain: env.COOKIE_DOMAIN,
    expires: session.expiresAt,
  };
}

// Completes a sign-in: cookie for browsers, token in the body for the mobile app.
export function issueSession(res, { token, session }, user) {
  const body = { user: user.toSelf(), csrfToken: session.csrfToken, mfaRequired: session.mfaRequired && !session.mfaVerifiedAt };
  if (session.transport === 'cookie') {
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(session));
  } else {
    body.token = token;
    body.expiresAt = session.expiresAt;
  }
  return body;
}
