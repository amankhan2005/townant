import { ipFingerprint } from '../lib/crypto.js';
import { enforce } from '../services/rateLimit.js';

// Express middleware around services/rateLimit.enforce. key(req) defaults to the client IP
// as resolved by Express using the configured trusted-proxy hop count only.
export function rateLimit({ name, windowMs, max, key, failClosed = false, message }) {
  return async (req, res, next) => {
    const subject = key ? key(req) : ipFingerprint(req.ip);
    if (subject === null) return next();
    const result = await enforce(`${name}:${subject}`, { windowMs, max, failClosed, message });
    if (result) {
      res.setHeader('RateLimit-Limit', max);
      res.setHeader('RateLimit-Remaining', result.remaining);
      res.setHeader('RateLimit-Reset', Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    }
    return next();
  };
}

export const byUserOrIp = (req) => (req.auth ? `u:${req.auth.user._id}` : `ip:${ipFingerprint(req.ip)}`);
