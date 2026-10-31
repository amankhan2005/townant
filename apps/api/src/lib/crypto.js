import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { getEnv } from '../config/env.js';

const scrypt = promisify(crypto.scrypt);

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const hmac = (value) => crypto.createHmac('sha256', getEnv().OTP_PEPPER).update(value).digest('hex');

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Numeric code from a CSPRNG with no modulo bias.
export const numericCode = (digits = 6) => crypto.randomInt(0, 10 ** digits).toString().padStart(digits, '0');

// Short human-friendly reference (no ambiguous characters).
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function bookingReference() {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += REF_ALPHABET[crypto.randomInt(0, REF_ALPHABET.length)];
  return `TA-${out}`;
}

// Identifies a client IP in rate limits and audit records without storing the raw address.
export const ipFingerprint = (ip) => hmac(`ip:${ip ?? 'unknown'}`).slice(0, 32);

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

// Always performs a full scrypt so a missing account takes as long as a wrong password.
export async function verifyPassword(password, stored) {
  const [scheme, n, r, p, saltB64, keyB64] = (stored || DUMMY_HASH).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const N = Number(n);
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { N, r: Number(r), p: Number(p), maxmem: 128 * N * Number(r) * 2 });
  return Boolean(stored) && crypto.timingSafeEqual(key, expected);
}
