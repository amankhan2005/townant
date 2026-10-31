import { ACTIVE_BOOKING_STATUSES } from '@townant/shared';
import { withTransaction } from '../db.js';
import { AppError, conflict } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  Booking,
  Conversation,
  DeviceToken,
  Favorite,
  Notification,
  NotificationDelivery,
  OtpChallenge,
  Review,
  ReviewReport,
  Session,
  SupportMessage,
  SupportTicket,
  User,
} from '../models/index.js';
import { audit } from './audit.js';
import { transitionBooking } from './booking.js';
import { recomputeRating } from './reviews.js';

// Customer account deletion policy (also shown to the customer before they confirm, and
// documented in docs/DECISIONS.md). Deletion has two stages:
//
// 1. Request (immediately)
//   - The account becomes `pending_deletion` for RECOVERY_DAYS. Every session ends, push
//     registrations and queued emails/pushes are dropped, and the customer's reviews are hidden
//     publicly (ratings recalculated).
//   - Upcoming requested or confirmed appointments are cancelled (each business is notified), so no
//     business holds a slot for someone who has left. Restoring the account does not rebook them.
//   - Nothing else is removed: signing in with a one-time code during the window offers to restore it.
// 2. Finalize (after RECOVERY_DAYS, by the background job)
//   Deleted
//     - Name, email, phone, saved location and notification preferences (the account record is
//       reduced to a tombstone with no personal data, so the email/phone can sign up again).
//     - Sign-in codes, saved businesses, in-app notifications, reviews the customer wrote (ratings
//       recalculated) and reports they filed.
//   Kept, without the customer's name or contact details
//     - Past appointments (date, service, status): the business's own service records.
//     - Messages with businesses: closed and shown as "Deleted customer".
//     - Support tickets: closed and kept for support and audit records.
//     - The audit entries for the request and the deletion (no personal data).
// Customers have no uploaded images, so no media is removed.

export const RECOVERY_DAYS = 15;
const DAY_MS = 24 * 3600 * 1000;

export const DELETION_POLICY = {
  recoveryDays: RECOVERY_DAYS,
  recovery: [
    `For ${RECOVERY_DAYS} days you can restore the account by signing in with a one-time code`,
    'During that time your reviews are hidden and you are signed out everywhere',
  ],
  deleted: [
    'Your name, email address, phone number and saved location',
    'Saved businesses, notifications and notification settings',
    'Reviews you have written (business ratings are recalculated)',
    'Sign-in sessions on every device and push-notification registrations',
  ],
  cancelled: ['Upcoming appointments are cancelled right away — each business is told. Restoring the account does not rebook them'],
  retained: [
    'Past appointments, without your name or contact details, as the business’s service records',
    'Messages you exchanged with businesses, shown as from a “Deleted customer”',
    'Support requests, closed and kept for our support records',
    'A record that the account was deleted, with no personal details',
  ],
};

const upcomingFilter = (userId) => ({ customerId: userId, status: { $in: ACTIVE_BOOKING_STATUSES }, startAt: { $gt: new Date() } });

// What deleting this account would change, for the confirmation screen.
export async function deletionSummary(userId) {
  const [upcomingBookings, pastBookings, reviews, conversations, openTickets, favorites] = await Promise.all([
    Booking.countDocuments(upcomingFilter(userId)),
    Booking.countDocuments({ customerId: userId, $nor: [upcomingFilter(userId)] }),
    Review.countDocuments({ customerId: userId }),
    Conversation.countDocuments({ customerId: userId }),
    SupportTicket.countDocuments({ requesterType: 'customer', requesterId: userId, status: { $nin: ['closed'] } }),
    Favorite.countDocuments({ userId }),
  ]);
  return { counts: { upcomingBookings, pastBookings, reviews, conversations, openTickets, favorites }, policy: DELETION_POLICY };
}

async function cancelUpcoming(req, userId) {
  const upcoming = await Booking.find(upcomingFilter(userId), { _id: 1 }).lean();
  let cancelled = 0;
  for (const b of upcoming) {
    try {
      await transitionBooking({ req, scope: { type: 'customer', userId }, bookingId: b._id, action: 'cancel_account_deleted', actor: 'system', reason: 'The customer deleted their TownAnt account.' });
      cancelled += 1;
    } catch (err) {
      // A concurrent change (e.g. the vendor cancelled first) leaves nothing to release.
      if (err.status !== 409) throw err;
    }
  }
  return cancelled;
}

async function recomputeFor(reviews, session) {
  for (const companyId of new Set(reviews.map((r) => r.companyId.toString()))) await recomputeRating(companyId, session);
}

/**
 * Starts the deletion of a customer's account. Callers must have re-verified the customer (fresh
 * OTP) first. The account stays restorable for RECOVERY_DAYS. A second request for an account that
 * is already pending fails with 409, so retries and concurrent requests cannot reschedule it.
 */
export async function requestCustomerDeletion(req, user) {
  const userId = user._id;
  const now = new Date();
  const scheduledFor = new Date(now.getTime() + RECOVERY_DAYS * DAY_MS);

  const result = await withTransaction(async (session) => {
    const opts = { session };
    const marked = await User.updateOne(
      { _id: userId, accountType: 'customer', status: 'active' },
      { $set: { status: 'pending_deletion', deletionRequestedAt: now, deletionScheduledFor: scheduledFor } },
      opts,
    );
    if (marked.modifiedCount !== 1) throw conflict('DELETION_NOT_ALLOWED', 'This account is not active, so it cannot be deleted again.');
    const reviews = await Review.find({ customerId: userId }, { companyId: 1 }, opts).lean();
    await Review.updateMany({ customerId: userId }, { $set: { authorPendingDeletion: true } }, opts);
    await recomputeFor(reviews, session);
    // Sign out everywhere, stop pushes and anything already queued for delivery.
    const sessions = await Session.deleteMany({ userId }, opts);
    await DeviceToken.deleteMany({ userId }, opts);
    await NotificationDelivery.deleteMany({ recipientId: userId, status: 'pending' }, opts);
    await OtpChallenge.deleteMany({ userId, purpose: { $ne: 'login' } }, opts);
    const counts = { reviewsHidden: reviews.length, sessionsEnded: sessions.deletedCount };
    await audit(req, { action: 'user.deletion_requested', entityType: 'user', entityId: userId, metadata: { ...counts, recoverUntil: scheduledFor.toISOString() } }, session);
    return counts;
  });

  // Appointments are released after the account is marked, so a cancelled booking is never left
  // behind by a request that then failed. Each cancellation is its own idempotent transition.
  const cancelledBookings = await cancelUpcoming(req, userId);
  logger.info({ userId: userId.toString(), cancelledBookings, ...result }, 'customer account deletion requested');
  return { recoverUntil: scheduledFor, cancelledBookings, ...result };
}

/**
 * Restores a pending-deletion account. Only call after the customer proved control of an identifier
 * on the account (verified sign-in code) and confirmed. Conditional on the window still being open,
 * so an expired account, a concurrent finalization or a duplicate restore cannot succeed twice.
 */
export async function restoreCustomerAccount(req, userId) {
  return withTransaction(async (session) => {
    const opts = { session };
    const restored = await User.findOneAndUpdate(
      { _id: userId, accountType: 'customer', status: 'pending_deletion', deletionScheduledFor: { $gt: new Date() } },
      { $set: { status: 'active' }, $unset: { deletionRequestedAt: 1, deletionScheduledFor: 1 } },
      { new: true, session },
    );
    if (!restored) throw new AppError(410, 'RESTORE_UNAVAILABLE', 'This account can no longer be restored.');
    const reviews = await Review.find({ customerId: userId, authorPendingDeletion: true }, { companyId: 1 }, opts).lean();
    await Review.updateMany({ customerId: userId }, { $set: { authorPendingDeletion: false } }, opts);
    await recomputeFor(reviews, session);
    await audit(req, { action: 'user.restore', entityType: 'user', entityId: userId, metadata: { reviewsShown: reviews.length }, actor: { actorType: 'customer', actorId: userId } }, session);
    return restored;
  });
}

/**
 * Permanently deletes a customer account whose recovery window has ended. Each step is idempotent
 * and the tombstone write is conditional, so a retry (or a second worker) completes the job without
 * repeating it. Pass `force: true` only from tests.
 */
export async function finalizeCustomerDeletion(userId, { req = null, force = false } = {}) {
  const due = await User.exists({ _id: userId, accountType: 'customer', status: 'pending_deletion', ...(force ? {} : { deletionScheduledFor: { $lte: new Date() } }) });
  if (!due) return null;

  // Anything that slipped in since the request (there should be none: the account cannot sign in).
  const cancelled = await cancelUpcoming(req, userId);

  const result = await withTransaction(async (session) => {
    const opts = { session };
    const reviews = await Review.find({ customerId: userId }, { _id: 1, companyId: 1 }, opts).lean();
    await ReviewReport.deleteMany({ $or: [{ reporterId: userId }, { reviewId: { $in: reviews.map((r) => r._id) } }] }, opts);
    await Review.deleteMany({ customerId: userId }, opts);
    await recomputeFor(reviews, session);

    await Conversation.updateMany({ customerId: userId, status: 'open' }, { $set: { status: 'closed', closedAt: new Date(), closedBy: 'system' } }, opts);

    const openTickets = await SupportTicket.find({ requesterType: 'customer', requesterId: userId, status: { $ne: 'closed' } }, { _id: 1, status: 1 }, opts).lean();
    for (const t of openTickets) {
      await SupportMessage.create([{ ticketId: t._id, authorType: 'system', body: 'The requester deleted their TownAnt account. This ticket was closed automatically.' }], opts);
      await SupportTicket.updateOne(
        { _id: t._id },
        { $set: { status: 'closed', closedAt: new Date(), awaiting: 'none', requesterDeletedAt: new Date() }, $push: { history: { action: 'requester_deleted', from: t.status, to: 'closed', actorType: 'system' } } },
        opts,
      );
    }
    await SupportTicket.updateMany({ requesterType: 'customer', requesterId: userId }, { $set: { requesterDeletedAt: new Date() } }, opts);

    const [favorites, notifications] = await Promise.all([Favorite.deleteMany({ userId }, opts), Notification.deleteMany({ recipientId: userId }, opts)]);
    await NotificationDelivery.deleteMany({ recipientId: userId }, opts);
    await DeviceToken.deleteMany({ userId }, opts);
    await OtpChallenge.deleteMany({ userId }, opts);
    await Session.deleteMany({ userId }, opts);

    // Tombstone: no personal fields remain. Conditional, so only one finalization records it.
    const tomb = await User.updateOne(
      { _id: userId, accountType: 'customer', status: 'pending_deletion' },
      {
        $set: { status: 'deleted', deletedAt: new Date(), notificationPrefs: { email: false, push: false } },
        $unset: {
          displayName: 1,
          email: 1,
          emailVerifiedAt: 1,
          phone: 1,
          phoneVerifiedAt: 1,
          defaultLocation: 1,
          lastLoginAt: 1,
          suspendedAt: 1,
          suspensionReason: 1,
          passwordHash: 1,
          passwordChangedAt: 1,
          deletionScheduledFor: 1,
        },
      },
      opts,
    );
    if (tomb.modifiedCount !== 1) return null;
    const counts = { cancelledBookings: cancelled, reviewsDeleted: reviews.length, ticketsClosed: openTickets.length, favoritesDeleted: favorites.deletedCount, notificationsDeleted: notifications.deletedCount };
    await audit(req, { action: 'user.self_delete', entityType: 'user', entityId: userId, metadata: counts }, session);
    return counts;
  });

  if (result) logger.info({ userId: userId.toString(), ...result }, 'customer account deleted');
  return result;
}

// Background job: finalizes accounts whose recovery window has ended. Bounded per run.
export async function finalizeDueCustomerDeletions({ batch = 20 } = {}) {
  const due = await User.find({ accountType: 'customer', status: 'pending_deletion', deletionScheduledFor: { $lte: new Date() } }, { _id: 1 }).sort({ deletionScheduledFor: 1 }).limit(batch).lean();
  let finalized = 0;
  for (const u of due) {
    try {
      if (await finalizeCustomerDeletion(u._id)) finalized += 1;
    } catch (err) {
      logger.error({ err, userId: u._id.toString() }, 'account deletion finalization failed');
    }
  }
  return finalized;
}
