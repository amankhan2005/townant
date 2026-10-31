import pino from 'pino';

// Paths that must never reach log output. pino-http logs req/res, so header and body
// fields that can carry credentials are censored here as a backstop to not logging them at all.
const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.temporaryPassword',
  '*.restoreToken',
  '*.code',
  '*.token',
  '*.otp',
  '*.apiKey',
  '*.secret',
];

export function createLogger(level = 'info') {
  return pino({
    level,
    redact: { paths: REDACT, censor: '[redacted]' },
    base: { service: 'townant-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createLogger(process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'));

// Masks an email or phone number for display and logs, e.g. j***@example.com, +1******4567.
export function maskDestination(channel, value) {
  if (!value) return '';
  if (channel === 'email') {
    const [user, domain] = value.split('@');
    return `${user.slice(0, 1)}***@${domain}`;
  }
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(0, value.length - 6))}${value.slice(-4)}`;
}
