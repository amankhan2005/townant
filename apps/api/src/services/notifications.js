import { logger } from '../lib/logger.js';
import { DeviceToken, Membership, Notification, NotificationDelivery, User } from '../models/index.js';
import { providers } from '../providers/index.js';
import { renderEmail } from './emailTemplates.js';

const MAX_ATTEMPTS = 5;
// Accounts that must not receive email or push (suspended, or deleted/awaiting deletion).
const INACTIVE = new Set(['suspended', 'pending_deletion', 'deleted']);
const LEASE_MS = 60 * 1000;

// Creates an in-app notification plus pending email/push deliveries. When `session` is a
// transaction, the notification commits atomically with the change that caused it, and
// external delivery happens afterwards in the worker. A provider outage therefore never
// rolls back or blocks a booking.
export async function notify({ recipientId, audience, type, title, body, link, entityType, entityId, dedupeKey }, session) {
  const opts = session ? { session } : undefined;
  const existing = await Notification.findOne({ dedupeKey }, { _id: 1 }, opts);
  if (existing) return existing;
  const [notification] = await Notification.create([{ recipientId, audience, type, title, body, link, entityType, entityId, dedupeKey }], opts);
  await NotificationDelivery.create(
    [
      { notificationId: notification._id, recipientId, channel: 'email', template: 'notification', payload: { title, body, link }, dedupeKey: `${dedupeKey}:email` },
      { notificationId: notification._id, recipientId, channel: 'push', template: 'notification', payload: { title, body, link }, dedupeKey: `${dedupeKey}:push` },
    ],
    { ...opts, ordered: true },
  );
  return notification;
}

// Notifies every active team member of a company.
export async function notifyCompany(companyId, payload, session) {
  const members = await Membership.find({ companyId, status: 'active' }, { userId: 1 }, session ? { session } : undefined).lean();
  for (const m of members) {
    await notify({ ...payload, recipientId: m.userId, audience: 'vendor', dedupeKey: `${payload.dedupeKey}:${m.userId}` }, session);
  }
}

// Queues an email to an address that has no user account (e.g. a vendor applicant).
export async function queueDirectEmail({ toEmail, template, payload, dedupeKey }, session) {
  const opts = session ? { session } : undefined;
  if (await NotificationDelivery.exists({ dedupeKey }).session(session ?? null)) return;
  await NotificationDelivery.create([{ channel: 'email', toEmail, template, payload, dedupeKey }], opts);
}

async function deliverEmail(delivery) {
  const p = providers();
  if (!p.email) return { status: 'skipped', reason: 'email provider not configured' };
  let to = delivery.toEmail;
  if (!to) {
    const user = await User.findById(delivery.recipientId, { email: 1, emailVerifiedAt: 1, notificationPrefs: 1, accountType: 1, status: 1 }).lean();
    if (!user || INACTIVE.has(user.status) || !user.email) return { status: 'skipped', reason: 'no email' };
    if (user.accountType === 'customer' && !user.emailVerifiedAt) return { status: 'skipped', reason: 'email not verified' };
    if (user.notificationPrefs?.email === false) return { status: 'skipped', reason: 'opted out' };
    to = user.email;
  }
  const message = renderEmail(delivery.template, delivery.payload);
  const result = await p.email.send({ to, ...message, idempotencyKey: `delivery-${delivery._id}` });
  return { status: 'sent', providerMessageId: result?.id };
}

async function deliverPush(delivery) {
  const user = await User.findById(delivery.recipientId, { notificationPrefs: 1, status: 1 }).lean();
  if (!user || INACTIVE.has(user.status) || user.notificationPrefs?.push === false) return { status: 'skipped', reason: 'opted out' };
  const tokens = await DeviceToken.find({ userId: delivery.recipientId, disabledAt: null }).lean();
  if (!tokens.length) return { status: 'skipped', reason: 'no devices' };
  const { title, body, link } = delivery.payload;
  const tickets = await providers().push.send(tokens.map((t) => ({ to: t.token, title, body, data: { link } })));
  const unregistered = tokens.filter((_t, i) => tickets[i]?.unregistered).map((t) => t._id);
  if (unregistered.length) await DeviceToken.updateMany({ _id: { $in: unregistered } }, { $set: { disabledAt: new Date() } });
  if (!tickets.some((t) => t.ok) && unregistered.length < tokens.length) {
    const err = new Error('all push tickets failed');
    err.retryable = true;
    throw err;
  }
  return { status: 'sent', providerMessageId: tickets.find((t) => t.ok)?.id };
}

// Claims and processes due deliveries. Safe to run on several workers concurrently: each
// delivery is leased with a conditional update before it is sent.
export async function processDeliveries({ batch = 25 } = {}) {
  let processed = 0;
  for (; processed < batch; processed += 1) {
    const now = new Date();
    const delivery = await NotificationDelivery.findOneAndUpdate(
      {
        $or: [
          { status: 'pending', nextAttemptAt: { $lte: now } },
          { status: 'sending', leaseUntil: { $lt: now } },
        ],
      },
      { $set: { status: 'sending', leaseUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
      { new: true, sort: { nextAttemptAt: 1 } },
    );
    if (!delivery) break;
    try {
      const result = delivery.channel === 'email' ? await deliverEmail(delivery) : await deliverPush(delivery);
      await NotificationDelivery.updateOne(
        { _id: delivery._id },
        { $set: { status: result.status, providerMessageId: result.providerMessageId, lastError: result.reason, sentAt: result.status === 'sent' ? new Date() : undefined, leaseUntil: null } },
      );
    } catch (err) {
      const retry = err.retryable !== false && delivery.attempts < MAX_ATTEMPTS;
      const backoffMs = 30 * 1000 * 2 ** (delivery.attempts - 1);
      await NotificationDelivery.updateOne(
        { _id: delivery._id },
        {
          $set: {
            status: retry ? 'pending' : 'failed',
            nextAttemptAt: new Date(Date.now() + backoffMs),
            lastError: String(err.message).slice(0, 200),
            leaseUntil: null,
          },
        },
      );
      logger.warn({ deliveryId: delivery._id.toString(), channel: delivery.channel, attempts: delivery.attempts, retry, err: err.message }, 'notification delivery failed');
    }
  }
  return processed;
}
