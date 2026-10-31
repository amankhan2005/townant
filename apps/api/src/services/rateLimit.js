import { isDuplicateKey } from '../db.js';
import { tooMany } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { RateLimitBucket } from '../models/index.js';

// Fixed-window counter in MongoDB so limits hold across all API instances.
// Returns { allowed, count, remaining, resetAt }.
export async function hit(key, { windowMs, max }) {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const id = `${key}:${windowStart}`;
  const resetAt = new Date(windowStart + windowMs);
  const update = () =>
    RateLimitBucket.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: resetAt } }, { upsert: true, new: true, lean: true });
  let doc;
  try {
    doc = await update();
  } catch (err) {
    // Two first hits in the same window can race on the upsert; the retry increments the winner.
    if (!isDuplicateKey(err)) throw err;
    doc = await update();
  }
  return { allowed: doc.count <= max, count: doc.count, remaining: Math.max(0, max - doc.count), resetAt };
}

// Throws 429 when the limit is exceeded. failClosed controls behaviour when the store is
// unavailable: closed for cost-bearing operations (OTP, AI), open for ordinary reads.
export async function enforce(key, opts) {
  let result;
  try {
    result = await hit(key, opts);
  } catch (err) {
    logger.error({ err: err.message, key: key.split(':')[0] }, 'rate limit store unavailable');
    if (opts.failClosed) throw tooMany('This action is temporarily unavailable. Please try again shortly.', 30);
    return null;
  }
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    throw tooMany(opts.message, retryAfter);
  }
  return result;
}
