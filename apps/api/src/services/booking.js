import { ACTIVE_BOOKING_STATUSES, BOOKING_STATUS as S, formatDateTime } from '@townant/shared';
import { isDuplicateKey, withTransaction } from '../db.js';
import { bookingReference } from '../lib/crypto.js';
import { AppError, conflict, notFound, unprocessable } from '../lib/errors.js';
import { Booking, Company, Service, SlotClaim, User } from '../models/index.js';
import { track } from './analytics.js';
import { audit } from './audit.js';
import { matchScheduleSlot, resourceKeyFor, unitsFor } from './availability.js';
import { notify, notifyCompany } from './notifications.js';

const HOUR = 3600 * 1000;
export const MAX_ACTIVE_BOOKINGS_PER_CUSTOMER = 10;
export const MAX_PENDING_REQUESTS_PER_COMPANY = 3;

const slotTaken = () => conflict('SLOT_UNAVAILABLE', 'That time is no longer available. Please choose another slot.');
const stateChanged = () => conflict('BOOKING_STATE_CHANGED', 'This booking was updated by someone else. Refresh to see its current status.');

// Every lookup is constrained by the caller's scope, so a guessed ID for someone else's
// booking behaves exactly like a nonexistent one.
export function scopeFilter(scope, id) {
  if (scope.type === 'customer') return { _id: id, customerId: scope.userId };
  if (scope.type === 'vendor') return { _id: id, companyId: scope.companyId };
  if (scope.type === 'admin') return { _id: id };
  throw new Error('unknown scope');
}

export async function findScopedBooking(scope, id) {
  const booking = await Booking.findOne(scopeFilter(scope, id));
  if (!booking) throw notFound('Booking not found.');
  return booking;
}

// Notification and email text: "Thu, 10/29/2026 at 9:00 AM EDT" in the business's zone.
const localLabel = (date, zone) => formatDateTime(date, zone);

async function insertClaims(booking, session) {
  const docs = unitsFor(booking.startAt, booking.blockEndAt).map((unitStart) => ({ resourceKey: booking.resourceKey, unitStart, bookingId: booking._id }));
  try {
    await SlotClaim.insertMany(docs, { session, ordered: true });
  } catch (err) {
    if (isDuplicateKey(err)) throw slotTaken();
    throw err;
  }
}

async function loadBookable(serviceId) {
  const service = await Service.findOne({ _id: serviceId, isActive: true, archivedAt: null });
  if (!service) throw notFound('This service is not available.');
  const company = await Company.findOne({ _id: service.companyId, status: 'published' });
  if (!company) throw notFound('This service is not available.');
  return { service, company };
}

function parseInstant(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw unprocessable('INVALID_TIME', 'Choose a valid time.');
  return d;
}

export async function createBooking({ customer, serviceId, startAt: startInput, note, idempotencyKey }) {
  const startAt = parseInstant(startInput);
  const { service, company } = await loadBookable(serviceId);

  if (idempotencyKey) {
    const prior = await Booking.findOne({ customerId: customer._id, idempotencyKey });
    if (prior) {
      if (prior.serviceId.equals(service._id) && prior.startAt.getTime() === startAt.getTime()) return { booking: prior, replayed: true };
      throw unprocessable('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different booking.');
    }
  }

  // The requested time must be one the vendor's schedule actually offers right now. This
  // rejects stale availability responses, off-grid times and past or too-far-ahead times.
  const slot = matchScheduleSlot({ company, service, startAt });
  if (!slot) throw slotTaken();

  const now = new Date();
  const activeCount = await Booking.countDocuments({ customerId: customer._id, status: { $in: ACTIVE_BOOKING_STATUSES }, startAt: { $gt: now } });
  if (activeCount >= MAX_ACTIVE_BOOKINGS_PER_CUSTOMER) {
    throw unprocessable('BOOKING_LIMIT_REACHED', 'You have reached the limit of upcoming bookings. Cancel or complete one to book another.');
  }
  if (service.bookingMode === 'request') {
    const pendingHere = await Booking.countDocuments({ customerId: customer._id, companyId: company._id, status: S.REQUESTED });
    if (pendingHere >= MAX_PENDING_REQUESTS_PER_COMPANY) {
      throw unprocessable('BOOKING_LIMIT_REACHED', 'You already have several requests waiting for this business.');
    }
  }

  const instant = service.bookingMode === 'instant';
  const status = instant ? S.CONFIRMED : S.REQUESTED;
  try {
    const booking = await withTransaction(async (session) => {
      const [created] = await Booking.create(
        [
          {
            reference: bookingReference(),
            customerId: customer._id,
            companyId: company._id,
            serviceId: service._id,
            serviceSnapshot: { title: service.title, durationMinutes: service.durationMinutes, bookingMode: service.bookingMode },
            resourceKey: resourceKeyFor(company._id),
            startAt: slot.startAt,
            endAt: slot.endAt,
            blockEndAt: slot.blockEndAt,
            timezone: company.availability.timezone,
            status,
            customerNote: note || undefined,
            idempotencyKey: idempotencyKey || undefined,
            requestExpiresAt: instant ? undefined : new Date(Math.min(now.getTime() + company.bookingPolicy.requestExpiryHours * HOUR, slot.startAt.getTime())),
            history: [{ action: 'create', to: status, actorType: 'customer', actorId: customer._id }],
          },
        ],
        { session },
      );
      await insertClaims(created, session);

      const when = localLabel(created.startAt, created.timezone);
      await notify(
        {
          recipientId: customer._id,
          audience: 'customer',
          type: instant ? 'booking_confirmed' : 'booking_requested',
          title: instant ? `Booking confirmed with ${company.name}` : `Request sent to ${company.name}`,
          body: `${service.title} · ${when}${instant ? '' : ". We'll let you know when the business responds."}`,
          link: `/bookings/${created._id}`,
          entityType: 'booking',
          entityId: created._id,
          dedupeKey: `booking:${created._id}:created:customer`,
        },
        session,
      );
      await notifyCompany(
        company._id,
        {
          type: instant ? 'booking_confirmed' : 'booking_requested',
          title: instant ? 'New booking' : 'New booking request',
          body: `${service.title} · ${when}`,
          link: `/business/appointments/${created._id}`,
          entityType: 'booking',
          entityId: created._id,
          dedupeKey: `booking:${created._id}:created:vendor`,
        },
        session,
      );
      await track('booking_created', { companyId: company._id, categoryId: service.categoryId }, session);
      if (instant) await track('booking_confirmed', { companyId: company._id, categoryId: service.categoryId }, session);
      return created;
    });
    return { booking, replayed: false };
  } catch (err) {
    // A concurrent retry with the same idempotency key won the race: return its booking.
    if (idempotencyKey && isDuplicateKey(err, 'idempotencyKey')) {
      const prior = await Booking.findOne({ customerId: customer._id, idempotencyKey });
      if (prior && prior.serviceId.equals(service._id) && prior.startAt.getTime() === startAt.getTime()) return { booking: prior, replayed: true };
      throw unprocessable('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different booking.');
    }
    throw err;
  }
}

// action -> allowed source states, target state, who may perform it, whether the slot is released.
const TRANSITIONS = {
  confirm: { from: [S.REQUESTED], to: S.CONFIRMED, actors: ['vendor', 'admin'] },
  decline: { from: [S.REQUESTED], to: S.DECLINED, actors: ['vendor'], release: true },
  cancel_customer: { from: [S.REQUESTED, S.CONFIRMED], to: S.CANCELLED_BY_CUSTOMER, actors: ['customer'], release: true },
  cancel_vendor: { from: [S.REQUESTED, S.CONFIRMED], to: S.CANCELLED_BY_VENDOR, actors: ['vendor'], release: true, reasonRequired: true },
  cancel_admin: { from: [S.REQUESTED, S.CONFIRMED], to: S.CANCELLED_BY_ADMIN, actors: ['admin'], release: true, reasonRequired: true },
  complete: { from: [S.CONFIRMED], to: S.COMPLETED, actors: ['vendor', 'admin'] },
  no_show: { from: [S.CONFIRMED], to: S.NO_SHOW, actors: ['vendor'] },
  expire: { from: [S.REQUESTED], to: S.EXPIRED, actors: ['system'], release: true },
  // The customer deleted their account: upcoming appointments are released so the business
  // isn't left holding a slot for someone who can no longer be contacted.
  cancel_account_deleted: { from: [S.REQUESTED, S.CONFIRMED], to: S.CANCELLED_BY_CUSTOMER, actors: ['system'], release: true },
  // A Super Admin deleted the business and its 15-day recovery window ended: upcoming appointments
  // are released and each customer is told.
  cancel_business_removed: { from: [S.REQUESTED, S.CONFIRMED], to: S.CANCELLED_BY_ADMIN, actors: ['system'], release: true },
};

// Time- and policy-based rules evaluated on top of the state table.
function checkPolicy(action, booking, company, now) {
  const started = now >= booking.startAt;
  if (['complete', 'no_show'].includes(action) && !started) {
    throw unprocessable('TOO_EARLY', 'You can mark this after the appointment start time.');
  }
  if (['confirm', 'cancel_customer', 'cancel_vendor'].includes(action) && started) {
    throw unprocessable('APPOINTMENT_STARTED', 'This appointment has already started.');
  }
  if (action === 'cancel_customer' && booking.status === S.CONFIRMED) {
    const cutoff = company.bookingPolicy.cancellationCutoffHours * HOUR;
    if (booking.startAt - now < cutoff) {
      throw unprocessable(
        'CANCELLATION_WINDOW_PASSED',
        `Online cancellation closes ${company.bookingPolicy.cancellationCutoffHours} hours before the appointment. Please message the business.`,
      );
    }
  }
}

export function allowedActions(booking, company, actor, now = new Date()) {
  const result = [];
  for (const [action, rule] of Object.entries(TRANSITIONS)) {
    if (!rule.actors.includes(actor) || !rule.from.includes(booking.status)) continue;
    try {
      checkPolicy(action, booking, company, now);
      result.push(action);
    } catch {
      /* not currently allowed */
    }
  }
  if (canReschedule(booking, company, actor, now)) result.push('reschedule');
  return result;
}

const NOTIFY_COPY = {
  confirm: { type: 'booking_confirmed', customer: (c) => `Booking confirmed with ${c}` },
  decline: { type: 'booking_declined', customer: (c) => `${c} couldn't accept your request` },
  cancel_customer: { type: 'booking_cancelled', vendor: 'Booking cancelled by customer' },
  cancel_vendor: { type: 'booking_cancelled', customer: (c) => `${c} cancelled your booking` },
  cancel_admin: { type: 'booking_cancelled', customer: () => 'Your booking was cancelled by TownAnt', vendor: 'Booking cancelled by TownAnt' },
  expire: { type: 'booking_expired', customer: (c) => `Your request to ${c} expired`, vendor: 'A booking request expired' },
  cancel_account_deleted: { type: 'booking_cancelled', vendor: 'Booking cancelled: the customer deleted their account' },
  cancel_business_removed: { type: 'booking_cancelled', customer: (c) => `${c} is no longer on TownAnt, so your booking was cancelled` },
};

export async function transitionBooking({ req, scope, bookingId, action, actor, reason }) {
  const rule = TRANSITIONS[action];
  if (!rule) throw new AppError(400, 'BAD_REQUEST', 'Unknown action.');
  if (!rule.actors.includes(actor)) throw new AppError(403, 'FORBIDDEN', 'You cannot perform this action.');
  if (rule.reasonRequired && !reason) throw unprocessable('REASON_REQUIRED', 'Please give a reason.');

  const current = await findScopedBooking(scope, bookingId);
  if (!rule.from.includes(current.status)) {
    throw conflict('INVALID_TRANSITION', `A booking that is ${current.status.replaceAll('_', ' ')} cannot be changed this way.`);
  }
  const company = await Company.findById(current.companyId);
  const now = new Date();
  checkPolicy(action, current, company, now);

  return withTransaction(async (session) => {
    // Conditional on the status we validated, so concurrent changes cannot both apply.
    const updated = await Booking.findOneAndUpdate(
      { ...scopeFilter(scope, bookingId), status: current.status },
      {
        $set: { status: rule.to, ...(rule.to !== S.REQUESTED ? { requestExpiresAt: null } : {}) },
        $push: { history: { action, from: current.status, to: rule.to, actorType: actor, actorId: req?.auth?.user._id, reason } },
        $inc: { __v: 1 },
      },
      { new: true, session },
    );
    if (!updated) throw stateChanged();
    if (rule.release) await SlotClaim.deleteMany({ bookingId: updated._id }, { session });

    const copy = NOTIFY_COPY[action];
    const when = localLabel(updated.startAt, updated.timezone);
    const body = `${updated.serviceSnapshot.title} · ${when}${reason ? ` · Reason: ${reason}` : ''}`;
    if (copy?.customer) {
      await notify(
        {
          recipientId: updated.customerId,
          audience: 'customer',
          type: copy.type,
          title: copy.customer(company.name),
          body,
          link: `/bookings/${updated._id}`,
          entityType: 'booking',
          entityId: updated._id,
          dedupeKey: `booking:${updated._id}:${action}:${updated.__v}:customer`,
        },
        session,
      );
    }
    if (copy?.vendor) {
      await notifyCompany(
        updated.companyId,
        { type: copy.type, title: copy.vendor, body, link: `/business/appointments/${updated._id}`, entityType: 'booking', entityId: updated._id, dedupeKey: `booking:${updated._id}:${action}:${updated.__v}:vendor` },
        session,
      );
    }
    if (action === 'confirm') await track('booking_confirmed', { companyId: updated.companyId }, session);
    if (actor === 'vendor' || actor === 'admin') {
      await audit(req, { action: `booking.${action}`, entityType: 'booking', entityId: updated._id, companyId: updated.companyId, reason, metadata: { from: current.status, to: rule.to } }, session);
    }
    return updated;
  });
}

function canReschedule(booking, company, actor, now = new Date()) {
  if (!ACTIVE_BOOKING_STATUSES.includes(booking.status) || now >= booking.startAt) return false;
  if (actor === 'customer') {
    if (booking.status === S.REQUESTED) return true;
    return booking.startAt - now >= company.bookingPolicy.rescheduleCutoffHours * HOUR;
  }
  return actor === 'vendor';
}

export async function rescheduleBooking({ req, scope, bookingId, actor, startAt: startInput, reason }) {
  const newStart = parseInstant(startInput);
  const current = await findScopedBooking(scope, bookingId);
  const company = await Company.findById(current.companyId);
  if (actor === 'customer' && company.status !== 'published') throw notFound('This business is not taking bookings right now.');
  if (!canReschedule(current, company, actor)) {
    if (actor === 'customer' && ACTIVE_BOOKING_STATUSES.includes(current.status)) {
      throw unprocessable('RESCHEDULE_WINDOW_PASSED', `Online rescheduling closes ${company.bookingPolicy.rescheduleCutoffHours} hours before the appointment. Please message the business.`);
    }
    throw conflict('INVALID_TRANSITION', 'This booking cannot be rescheduled.');
  }
  if (newStart.getTime() === current.startAt.getTime()) throw unprocessable('SAME_TIME', 'Choose a different time.');

  const slot = matchScheduleSlot({ company, service: { durationMinutes: current.serviceSnapshot.durationMinutes }, startAt: newStart });
  if (!slot) throw slotTaken();

  const service = await Service.findById(current.serviceId, { bookingMode: 1 }).lean();
  // A customer moving a request-mode booking needs the business to approve the new time.
  const nextStatus = actor === 'customer' && service?.bookingMode === 'request' ? S.REQUESTED : current.status;

  return withTransaction(async (session) => {
    await SlotClaim.deleteMany({ bookingId: current._id }, { session });
    const updated = await Booking.findOneAndUpdate(
      { ...scopeFilter(scope, bookingId), status: current.status, startAt: current.startAt },
      {
        $set: {
          startAt: slot.startAt,
          endAt: slot.endAt,
          blockEndAt: slot.blockEndAt,
          status: nextStatus,
          reminderSentAt: null,
          requestExpiresAt:
            nextStatus === S.REQUESTED ? new Date(Math.min(Date.now() + company.bookingPolicy.requestExpiryHours * HOUR, slot.startAt.getTime())) : null,
        },
        $push: { history: { action: 'reschedule', from: current.status, to: nextStatus, actorType: actor, actorId: req.auth.user._id, reason, previousStartAt: current.startAt } },
        $inc: { __v: 1 },
      },
      { new: true, session },
    );
    if (!updated) throw stateChanged();
    await insertClaims(updated, session);

    const body = `${updated.serviceSnapshot.title} · now ${localLabel(updated.startAt, updated.timezone)}`;
    if (actor === 'customer') {
      await notifyCompany(
        updated.companyId,
        { type: 'booking_rescheduled', title: 'Booking rescheduled by customer', body, link: `/business/appointments/${updated._id}`, entityType: 'booking', entityId: updated._id, dedupeKey: `booking:${updated._id}:reschedule:${updated.__v}:vendor` },
        session,
      );
    } else {
      await notify(
        {
          recipientId: updated.customerId,
          audience: 'customer',
          type: 'booking_rescheduled',
          title: `${company.name} moved your booking`,
          body: reason ? `${body} · ${reason}` : body,
          link: `/bookings/${updated._id}`,
          entityType: 'booking',
          entityId: updated._id,
          dedupeKey: `booking:${updated._id}:reschedule:${updated.__v}:customer`,
        },
        session,
      );
      await audit(req, { action: 'booking.reschedule', entityType: 'booking', entityId: updated._id, companyId: updated.companyId, reason, metadata: { previousStartAt: current.startAt, startAt: updated.startAt } }, session);
    }
    return updated;
  });
}

// Worker: requests the business never answered stop holding the slot.
export async function expireStaleRequests(now = new Date()) {
  const stale = await Booking.find({ status: S.REQUESTED, requestExpiresAt: { $lte: now } }, { _id: 1 }).limit(100).lean();
  let expired = 0;
  for (const { _id } of stale) {
    try {
      await transitionBooking({ req: null, scope: { type: 'admin' }, bookingId: _id, action: 'expire', actor: 'system' });
      expired += 1;
    } catch (err) {
      if (err.code !== 'BOOKING_STATE_CHANGED' && err.code !== 'INVALID_TRANSITION') throw err;
    }
  }
  return expired;
}

// Worker: one reminder per booking, roughly 24 hours ahead.
export async function sendReminders(now = new Date()) {
  const due = await Booking.find({
    status: S.CONFIRMED,
    reminderSentAt: null,
    startAt: { $gt: now, $lte: new Date(now.getTime() + 24 * HOUR) },
  })
    .limit(200)
    .lean();
  for (const b of due) {
    const claimed = await Booking.updateOne({ _id: b._id, reminderSentAt: null }, { $set: { reminderSentAt: now } });
    if (claimed.modifiedCount !== 1) continue;
    const company = await Company.findById(b.companyId, { name: 1 }).lean();
    await notify({
      recipientId: b.customerId,
      audience: 'customer',
      type: 'booking_reminder',
      title: `Reminder: ${b.serviceSnapshot.title} with ${company?.name ?? 'your business'}`,
      body: localLabel(b.startAt, b.timezone),
      link: `/bookings/${b._id}`,
      entityType: 'booking',
      entityId: b._id,
      dedupeKey: `booking:${b._id}:reminder:${b.startAt.getTime()}`,
    });
  }
  return due.length;
}

export async function serializeBookings(bookings, view) {
  const companyIds = [...new Set(bookings.map((b) => b.companyId.toString()))];
  const companies = new Map((await Company.find({ _id: { $in: companyIds } }).lean()).map((c) => [c._id.toString(), c]));
  let customers = new Map();
  if (view !== 'customer') {
    const ids = [...new Set(bookings.map((b) => b.customerId.toString()))];
    customers = new Map((await User.find({ _id: { $in: ids } }, { displayName: 1, email: 1, phone: 1, emailVerifiedAt: 1, phoneVerifiedAt: 1, status: 1 }).lean()).map((u) => [u._id.toString(), u]));
  }
  const actor = view === 'admin' ? 'admin' : view;
  return bookings.map((b) => {
    const c = companies.get(b.companyId.toString());
    const out = {
      id: b._id.toString(),
      reference: b.reference,
      status: b.status,
      service: { id: b.serviceId.toString(), title: b.serviceSnapshot.title, durationMinutes: b.serviceSnapshot.durationMinutes, bookingMode: b.serviceSnapshot.bookingMode },
      startAt: b.startAt,
      endAt: b.endAt,
      timezone: b.timezone,
      customerNote: b.customerNote ?? null,
      requestExpiresAt: b.requestExpiresAt ?? null,
      createdAt: b.createdAt,
      company: c
        ? {
            id: c._id.toString(),
            name: c.name,
            slug: c.slug,
            logoUrl: c.media?.logo?.url ?? null,
            address: c.address,
            phone: c.contact?.phone ?? null,
          }
        : null,
      actions: c ? allowedActions(b, c, actor) : [],
      history: (b.history ?? []).map((h) => ({ action: h.action, from: h.from ?? null, to: h.to ?? null, actorType: h.actorType, reason: h.reason ?? null, at: h.at })),
    };
    if (view !== 'customer') {
      const u = customers.get(b.customerId.toString());
      // Vendors see only the verified contact details needed to deliver the service.
      out.customer = u
        ? {
            id: view === 'admin' ? u._id.toString() : undefined,
            name: u.status === 'deleted' ? 'Deleted customer' : u.displayName || 'TownAnt customer',
            deleted: u.status === 'deleted' || undefined,
            email: u.emailVerifiedAt ? u.email : null,
            phone: u.phoneVerifiedAt ? u.phone : null,
          }
        : null;
    }
    return out;
  });
}
