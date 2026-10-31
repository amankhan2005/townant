import { ACTIVE_BOOKING_STATUSES } from '@townant/shared';
import { withTransaction } from '../db.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { Booking, Company, Conversation, Membership, Service } from '../models/index.js';
import { audit } from './audit.js';
import { transitionBooking } from './booking.js';
import { deleteImage } from './media.js';

// Super Admin company deletion (documented in docs/DECISIONS.md, "Company deletion"):
//
// Delete (soft): status becomes 'deleted' for RESTORE_DAYS. The business disappears from every
//   public listing (all public queries require status 'published'), its team can no longer open the
//   portal, and nothing else changes: services, bookings, reviews, conversations, memberships,
//   spotlight placement and media are kept so a restore is exact. Existing bookings are left for the
//   admin to handle, as with suspension.
// Restore: within the window only. The previous status (draft, published or suspended) comes back,
//   so visibility follows the business's earlier publication and approval state.
// Finalize: after the window, by the background job (or an admin, once expired). Upcoming bookings
//   are cancelled with each customer notified, services are archived, memberships revoked, open
//   conversations closed, the spotlight placement and media removed. The company record itself is
//   kept as a tombstone so past bookings, reviews and the audit trail still resolve. No user
//   account, booking, review or message is deleted.

export const RESTORE_DAYS = 15;
const DAY_MS = 24 * 3600 * 1000;

const upcomingFilter = (companyId) => ({ companyId, status: { $in: ACTIVE_BOOKING_STATUSES }, startAt: { $gt: new Date() } });

export const upcomingBookingCount = (companyId) => Booking.countDocuments(upcomingFilter(companyId));

export async function softDeleteCompany(req, companyId, reason) {
  const now = new Date();
  const restoreUntil = new Date(now.getTime() + RESTORE_DAYS * DAY_MS);
  return withTransaction(async (session) => {
    const current = await Company.findById(companyId).session(session);
    if (!current) throw notFound();
    if (current.status === 'deleted') throw conflict('ALREADY_DELETED', 'This business is already deleted.');
    // Conditional on the status just read, so concurrent deletes (or a suspend racing a delete) can't both apply.
    const updated = await Company.findOneAndUpdate(
      { _id: current._id, status: current.status },
      { $set: { status: 'deleted', deletion: { deletedAt: now, deletedBy: req.auth.user._id, reason, statusBefore: current.status, restoreUntil } } },
      { new: true, session },
    );
    if (!updated) throw conflict('STATE_CHANGED', 'This business changed while you were deleting it. Refresh and try again.');
    await audit(req, { action: 'company.delete', entityType: 'company', entityId: current._id, companyId: current._id, reason, metadata: { statusBefore: current.status, restoreUntil: restoreUntil.toISOString() } }, session);
    return updated;
  });
}

export async function restoreCompany(req, companyId, reason) {
  return withTransaction(async (session) => {
    const current = await Company.findById(companyId).session(session);
    if (!current) throw notFound();
    if (current.status !== 'deleted') throw conflict('NOT_DELETED', 'This business is not deleted.');
    if (current.deletion?.purgedAt || !current.deletion?.restoreUntil || current.deletion.restoreUntil <= new Date()) {
      throw new AppError(410, 'RESTORE_EXPIRED', `The ${RESTORE_DAYS}-day recovery period for this business has ended.`);
    }
    const previous = current.deletion.statusBefore ?? 'draft';
    // The slug stays reserved while deleted (unique index), so a restore can't collide with another business.
    const restored = await Company.findOneAndUpdate(
      { _id: current._id, status: 'deleted', 'deletion.purgedAt': null, 'deletion.restoreUntil': { $gt: new Date() } },
      { $set: { status: previous }, $unset: { deletion: 1 } },
      { new: true, session },
    );
    if (!restored) throw conflict('STATE_CHANGED', 'This business changed while you were restoring it. Refresh and try again.');
    await audit(req, { action: 'company.restore', entityType: 'company', entityId: current._id, companyId: current._id, reason, metadata: { status: previous } }, session);
    return restored;
  });
}

const mediaIds = (c) => [c.media?.logo?.publicId, c.media?.banner?.publicId, ...(c.media?.gallery ?? []).map((m) => m.publicId)].filter(Boolean);

// Finalizes a deleted company whose recovery window has ended. Idempotent: the purge marker is
// written conditionally, so a second worker or a retry does nothing.
export async function purgeCompany(companyId, { req = null } = {}) {
  const current = await Company.findOne({ _id: companyId, status: 'deleted', 'deletion.purgedAt': null, 'deletion.restoreUntil': { $lte: new Date() } }).lean();
  if (!current) return null;

  const upcoming = await Booking.find(upcomingFilter(current._id), { _id: 1 }).lean();
  let cancelled = 0;
  for (const b of upcoming) {
    try {
      await transitionBooking({ req, scope: { type: 'admin' }, bookingId: b._id, action: 'cancel_business_removed', actor: 'system', reason: 'This business is no longer on TownAnt.' });
      cancelled += 1;
    } catch (err) {
      if (err.status !== 409 && err.status !== 422) throw err;
    }
  }

  const result = await withTransaction(async (session) => {
    const now = new Date();
    const marked = await Company.updateOne(
      { _id: current._id, status: 'deleted', 'deletion.purgedAt': null },
      { $set: { 'deletion.purgedAt': now, 'spotlight.active': false, searchText: '', 'media.gallery': [] }, $unset: { 'media.logo': 1, 'media.banner': 1 } },
      { session },
    );
    if (marked.modifiedCount !== 1) return null;
    const services = await Service.updateMany({ companyId: current._id, archivedAt: null }, { $set: { archivedAt: now, isActive: false } }, { session });
    const memberships = await Membership.updateMany({ companyId: current._id, status: 'active' }, { $set: { status: 'revoked' } }, { session });
    const conversations = await Conversation.updateMany({ companyId: current._id, status: 'open' }, { $set: { status: 'closed', closedAt: now, closedBy: 'system' } }, { session });
    const counts = { cancelledBookings: cancelled, servicesArchived: services.modifiedCount, membershipsRevoked: memberships.modifiedCount, conversationsClosed: conversations.modifiedCount };
    await audit(req, { action: 'company.purge', entityType: 'company', entityId: current._id, companyId: current._id, metadata: counts }, session);
    return counts;
  });
  if (!result) return null;
  // Assets go only after the references are gone; a failed delete leaves an orphan, never a broken image.
  for (const publicId of mediaIds(current)) await deleteImage(publicId);
  logger.info({ companyId: current._id.toString(), ...result }, 'deleted company finalized');
  return result;
}

export async function purgeDueCompanies({ batch = 20 } = {}) {
  const due = await Company.find({ status: 'deleted', 'deletion.purgedAt': null, 'deletion.restoreUntil': { $lte: new Date() } }, { _id: 1 }).sort({ 'deletion.restoreUntil': 1 }).limit(batch).lean();
  let purged = 0;
  for (const c of due) {
    try {
      if (await purgeCompany(c._id)) purged += 1;
    } catch (err) {
      logger.error({ err, companyId: c._id.toString() }, 'company finalization failed');
    }
  }
  return purged;
}

export function deletionInfo(c) {
  if (c.status !== 'deleted' || !c.deletion) return null;
  const restoreUntil = c.deletion.restoreUntil ?? null;
  const purged = Boolean(c.deletion.purgedAt);
  return {
    deletedAt: c.deletion.deletedAt ?? null,
    reason: c.deletion.reason ?? null,
    statusBefore: c.deletion.statusBefore ?? null,
    restoreUntil,
    purgedAt: c.deletion.purgedAt ?? null,
    restorable: !purged && Boolean(restoreUntil) && new Date(restoreUntil) > new Date(),
    daysLeft: !purged && restoreUntil ? Math.max(0, Math.ceil((new Date(restoreUntil) - Date.now()) / DAY_MS)) : 0,
  };
}
