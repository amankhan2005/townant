import crypto from 'node:crypto';
import express, { Router } from 'express';
import { getEnv } from '../config/env.js';
import { isDuplicateKey } from '../db.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { NotificationDelivery, OtpChallenge, WebhookEvent } from '../models/index.js';

// Webhooks only update delivery status. They can never approve accounts, confirm bookings
// or change permissions, so a forged event that slipped through could not escalate.
const router = Router();
router.use(rateLimit({ name: 'webhooks', windowMs: 60 * 1000, max: 600 }));
router.use(express.raw({ type: 'application/json', limit: '256kb' }));

const reject = () => new AppError(401, 'INVALID_SIGNATURE', 'Invalid signature.');

// Returns false if this event ID was already processed.
async function firstDelivery(provider, id) {
  try {
    await WebhookEvent.create({ _id: `${provider}:${id}`, provider });
    return true;
  } catch (err) {
    if (isDuplicateKey(err)) return false;
    throw err;
  }
}

// Resend signs webhooks with Svix: HMAC-SHA256 over "id.timestamp.body" using the
// base64 secret after the "whsec_" prefix; header holds space-separated "v1,<sig>" values.
export function verifySvix({ secret, id, timestamp, signatureHeader, body, toleranceSeconds = 300, now = Date.now() }) {
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSeconds) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return signatureHeader.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    return version === 'v1' && sig && safeEqual(sig, expected);
  });
}

router.post('/resend', async (req, res) => {
  const env = getEnv();
  if (!env.RESEND_WEBHOOK_SECRET) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const ok = verifySvix({
    secret: env.RESEND_WEBHOOK_SECRET,
    id: req.get('svix-id'),
    timestamp: req.get('svix-timestamp'),
    signatureHeader: req.get('svix-signature'),
    body,
  });
  if (!ok) throw reject();
  if (!(await firstDelivery('resend', req.get('svix-id')))) return res.status(200).json({ data: { duplicate: true } });

  const event = JSON.parse(body);
  const messageId = event?.data?.email_id;
  const status = { 'email.delivered': 'delivered', 'email.bounced': 'failed', 'email.complained': 'failed' }[event?.type];
  if (messageId && status) {
    await NotificationDelivery.updateOne({ providerMessageId: messageId, status: { $in: ['sent', 'delivered'] } }, { $set: { status, lastError: status === 'failed' ? event.type : undefined } });
    await OtpChallenge.updateOne({ providerMessageId: messageId }, { $set: { deliveryStatus: status } });
  }
  return res.status(200).json({ data: { received: true } });
});

// Meta webhook verification handshake.
router.get('/whatsapp', (req, res) => {
  const env = getEnv();
  const token = req.query['hub.verify_token'];
  if (req.query['hub.mode'] === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && typeof token === 'string' && safeEqual(token, env.WHATSAPP_VERIFY_TOKEN)) {
    return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? '').slice(0, 100));
  }
  return res.status(403).end();
});

router.post('/whatsapp', async (req, res) => {
  const env = getEnv();
  if (!env.WHATSAPP_APP_SECRET) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const header = req.get('x-hub-signature-256') ?? '';
  const expected = `sha256=${crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
  if (!safeEqual(header, expected)) throw reject();

  const payload = JSON.parse(raw.toString('utf8'));
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const st of change?.value?.statuses ?? []) {
        if (!st?.id || !(await firstDelivery('whatsapp', `${st.id}:${st.status}`))) continue;
        const status = { delivered: 'delivered', read: 'delivered', failed: 'failed' }[st.status];
        if (status) await OtpChallenge.updateOne({ providerMessageId: st.id }, { $set: { deliveryStatus: status } });
        if (st.status === 'failed') logger.warn({ code: st.errors?.[0]?.code }, 'whatsapp otp delivery failed');
      }
    }
  }
  return res.status(200).json({ data: { received: true } });
});

export default router;
