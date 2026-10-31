import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { notFound, unprocessable } from '../../../lib/errors.js';
import { isoDate, objectId, pageMeta, pagination, text, validate } from '../../../lib/validate.js';
import { requirePermission } from '../../../middleware/auth.js';
import { Booking, Category, Conversation, Review, Service } from '../../../models/index.js';
import { countEvents, dailySeries } from '../../../services/analytics.js';
import { audit } from '../../../services/audit.js';
import { availableSlots, serializeSlot } from '../../../services/availability.js';
import { findScopedBooking, rescheduleBooking, serializeBookings, transitionBooking } from '../../../services/booking.js';
import { rebuildSearchText } from '../../../services/catalog.js';
import { closeConversation, listMessages, postMessage, serializeConversations, serializeMessage } from '../../../services/conversations.js';
import { serializeReview } from '../../../services/reviews.js';

const router = Router();
const idParam = z.object({ id: objectId }).strict();
const scopeOf = (req) => ({ type: 'vendor', companyId: req.vendor.company._id });

// ----- Services -----

const priceSchema = z
  .object({
    display: z.enum(['fixed', 'from', 'quote', 'hidden']),
    amount: z.number().min(0).max(1_000_000).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    note: text(120).optional(),
  })
  .strict()
  .refine((p) => !['fixed', 'from'].includes(p.display) || (p.amount !== undefined && p.currency), 'Add an amount and currency, or choose "On quote".');

// Base field rules without defaults; defaults apply only on create, so a PATCH never
// resets fields the caller did not send.
const serviceFields = {
  title: text(120, { min: 2 }),
  description: text(2000, { multiline: true }),
  categoryId: objectId,
  durationMinutes: z.number().int().min(5).max(720).multipleOf(5),
  bookingMode: z.enum(['instant', 'request']),
  price: priceSchema,
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
};
const createServiceBody = z
  .object({
    ...serviceFields,
    description: serviceFields.description.default(''),
    categoryId: serviceFields.categoryId.optional(),
    bookingMode: serviceFields.bookingMode.default('instant'),
    price: serviceFields.price.default({ display: 'hidden' }),
    isActive: serviceFields.isActive.default(true),
    sortOrder: serviceFields.sortOrder.default(0),
  })
  .strict();
const updateServiceBody = z.object(Object.fromEntries(Object.entries(serviceFields).map(([k, v]) => [k, v.optional()]))).strict();

const serializeService = (s) => ({ ...s.toPublic(), price: s.price, isActive: s.isActive, archived: Boolean(s.archivedAt), sortOrder: s.sortOrder, createdAt: s.createdAt });

async function assertCategory(categoryId) {
  if (categoryId && !(await Category.exists({ _id: categoryId, isActive: true }))) throw unprocessable('INVALID_CATEGORY', 'Choose a category from the list.');
}

router.get('/services', async (req, res) => {
  const services = await Service.find({ companyId: req.vendor.company._id }).sort({ archivedAt: 1, sortOrder: 1, createdAt: 1 });
  res.json({ data: services.map(serializeService) });
});

router.post('/services', requirePermission('services:write'), validate({ body: createServiceBody }), async (req, res) => {
  await assertCategory(req.valid.body.categoryId);
  if ((await Service.countDocuments({ companyId: req.vendor.company._id, archivedAt: null })) >= 100) throw unprocessable('LIMIT', 'You can have up to 100 services.');
  const service = await Service.create({ ...req.valid.body, companyId: req.vendor.company._id });
  await rebuildSearchText(req.vendor.company._id);
  await audit(req, { action: 'service.create', entityType: 'service', entityId: service._id, companyId: req.vendor.company._id });
  res.status(201).json({ data: serializeService(service) });
});

router.patch(
  '/services/:id',
  requirePermission('services:write'),
  validate({ params: idParam, body: updateServiceBody }),
  async (req, res) => {
    // Company scope is part of the filter, so another vendor's service ID matches nothing.
    const service = await Service.findOne({ _id: req.valid.params.id, companyId: req.vendor.company._id, archivedAt: null });
    if (!service) throw notFound('Service not found.');
    const b = req.valid.body;
    await assertCategory(b.categoryId);
    for (const key of Object.keys(serviceFields)) if (b[key] !== undefined) service[key] = b[key];
    await service.save();
    await rebuildSearchText(req.vendor.company._id);
    await audit(req, { action: 'service.update', entityType: 'service', entityId: service._id, companyId: req.vendor.company._id, metadata: { fields: Object.keys(b) } });
    res.json({ data: serializeService(service) });
  },
);

// Archiving keeps existing bookings intact; the service just stops being bookable.
router.post('/services/:id/archive', requirePermission('services:write'), validate({ params: idParam }), async (req, res) => {
  const service = await Service.findOneAndUpdate(
    { _id: req.valid.params.id, companyId: req.vendor.company._id, archivedAt: null },
    { $set: { archivedAt: new Date(), isActive: false } },
    { new: true },
  );
  if (!service) throw notFound('Service not found.');
  await rebuildSearchText(req.vendor.company._id);
  await audit(req, { action: 'service.archive', entityType: 'service', entityId: service._id, companyId: req.vendor.company._id });
  res.json({ data: serializeService(service) });
});

// ----- Appointments -----

router.get(
  '/bookings',
  requirePermission('bookings:read'),
  validate({
    query: pagination
      .extend({
        status: z.enum(['requested', 'confirmed', 'declined', 'cancelled_by_customer', 'cancelled_by_vendor', 'cancelled_by_admin', 'completed', 'no_show', 'expired']).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        view: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
      })
      .strict(),
  }),
  async (req, res) => {
    const { status, from, to, view, page, limit } = req.valid.query;
    const zone = req.vendor.company.availability.timezone;
    const filter = { companyId: req.vendor.company._id };
    if (status) filter.status = status;
    const range = {};
    if (from) range.$gte = DateTime.fromISO(from, { zone }).startOf('day').toJSDate();
    if (to) range.$lt = DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf('day').toJSDate();
    if (view === 'upcoming') range.$gte = range.$gte && range.$gte > new Date() ? range.$gte : new Date(Date.now() - 2 * 3600 * 1000);
    if (view === 'past') range.$lt = range.$lt && range.$lt < new Date() ? range.$lt : new Date();
    if (Object.keys(range).length) filter.startAt = range;
    const [rows, total] = await Promise.all([
      Booking.find(filter).sort({ startAt: view === 'past' ? -1 : 1 }).skip((page - 1) * limit).limit(limit),
      Booking.countDocuments(filter),
    ]);
    res.json({ data: await serializeBookings(rows, 'vendor'), meta: pageMeta(req.valid.query, total) });
  },
);

router.get('/bookings/:id', requirePermission('bookings:read'), validate({ params: idParam }), async (req, res) => {
  const [out] = await serializeBookings([await findScopedBooking(scopeOf(req), req.valid.params.id)], 'vendor');
  res.json({ data: out });
});

router.post(
  '/bookings/:id/reschedule',
  requirePermission('bookings:write'),
  validate({ params: idParam, body: z.object({ startAt: z.iso.datetime({ offset: true }), reason: text(500).optional() }).strict() }),
  async (req, res) => {
    const booking = await rescheduleBooking({ req, scope: scopeOf(req), bookingId: req.valid.params.id, actor: 'vendor', ...req.valid.body });
    const [out] = await serializeBookings([booking], 'vendor');
    res.json({ data: out });
  },
);

const ACTIONS = { confirm: 'confirm', decline: 'decline', cancel: 'cancel_vendor', complete: 'complete', 'no-show': 'no_show' };

router.post(
  '/bookings/:id/:action',
  requirePermission('bookings:write'),
  validate({ params: z.object({ id: objectId, action: z.enum(Object.keys(ACTIONS)) }).strict(), body: z.object({ reason: text(500).optional() }).strict() }),
  async (req, res) => {
    const booking = await transitionBooking({
      req,
      scope: scopeOf(req),
      bookingId: req.valid.params.id,
      action: ACTIONS[req.valid.params.action],
      actor: 'vendor',
      reason: req.valid.body.reason,
    });
    const [out] = await serializeBookings([booking], 'vendor');
    res.json({ data: out });
  },
);

router.get(
  '/bookings/:id/slots',
  requirePermission('bookings:write'),
  validate({ params: idParam, query: z.object({ date: isoDate }).strict() }),
  async (req, res) => {
    const booking = await findScopedBooking(scopeOf(req), req.valid.params.id);
    const slots = await availableSlots({
      company: req.vendor.company,
      service: { durationMinutes: booking.serviceSnapshot.durationMinutes },
      date: req.valid.query.date,
      ignoreBookingId: booking._id,
    });
    res.json({ data: { timezone: req.vendor.company.availability.timezone, slots: slots.map((s) => serializeSlot(s, req.vendor.company.availability.timezone)) } });
  },
);

// ----- Messages -----

router.get('/conversations', requirePermission('messages'), validate({ query: z.object({ status: z.enum(['open', 'closed']).optional() }).strict() }), async (req, res) => {
  const filter = { companyId: req.vendor.company._id };
  if (req.valid.query.status) filter.status = req.valid.query.status;
  const list = await Conversation.find(filter).sort({ lastMessageAt: -1 }).limit(200).lean();
  res.json({ data: await serializeConversations(list, 'vendor') });
});

router.get('/conversations/:id/messages', requirePermission('messages'), validate({ params: idParam }), async (req, res) => {
  const { conversation, messages } = await listMessages(scopeOf(req), req.valid.params.id, 'vendor');
  const [meta] = await serializeConversations([conversation.toObject()], 'vendor');
  res.json({ data: { conversation: meta, messages: messages.map(serializeMessage) } });
});

router.post(
  '/conversations/:id/messages',
  requirePermission('messages'),
  validate({ params: idParam, body: z.object({ body: text(2000, { min: 1, multiline: true }) }).strict() }),
  async (req, res) => {
    const message = await postMessage({ scope: scopeOf(req), conversationId: req.valid.params.id, sender: { type: 'vendor', id: req.auth.user._id }, body: req.valid.body.body });
    res.status(201).json({ data: serializeMessage(message) });
  },
);

router.post('/conversations/:id/close', requirePermission('messages'), validate({ params: idParam }), async (req, res) => {
  await closeConversation(scopeOf(req), req.valid.params.id, 'vendor');
  res.status(204).end();
});

// ----- Reviews -----

router.get('/reviews', validate({ query: pagination.strict() }), async (req, res) => {
  const { page, limit } = req.valid.query;
  const filter = { companyId: req.vendor.company._id, status: 'published' };
  const [rows, total] = await Promise.all([Review.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Review.countDocuments(filter)]);
  res.json({ data: rows.map((r) => serializeReview(r)), meta: pageMeta(req.valid.query, total) });
});

router.put(
  '/reviews/:id/reply',
  requirePermission('reviews:reply'),
  validate({ params: idParam, body: z.object({ text: text(1000, { min: 1, multiline: true }) }).strict() }),
  async (req, res) => {
    const review = await Review.findOneAndUpdate(
      { _id: req.valid.params.id, companyId: req.vendor.company._id, status: 'published' },
      { $set: { vendorReply: { text: req.valid.body.text, repliedAt: new Date(), repliedBy: req.auth.user._id } } },
      { new: true },
    );
    if (!review) throw notFound('Review not found.');
    res.json({ data: serializeReview(review) });
  },
);

// ----- Dashboard -----

router.get('/dashboard', requirePermission('dashboard'), async (req, res) => {
  const companyId = req.vendor.company._id;
  const now = new Date();
  const since = DateTime.utc().minus({ days: 30 }).toISODate();
  const [upcoming, requests, unreadConversations, events, series, nextBookings, latestReviews] = await Promise.all([
    Booking.countDocuments({ companyId, status: 'confirmed', startAt: { $gte: now } }),
    Booking.countDocuments({ companyId, status: 'requested' }),
    Conversation.countDocuments({ companyId, vendorUnread: { $gt: 0 } }),
    countEvents({ companyId, day: { $gte: since } }),
    dailySeries({ companyId, day: { $gte: since } }),
    Booking.find({ companyId, status: { $in: ['requested', 'confirmed'] }, startAt: { $gte: now } }).sort({ startAt: 1 }).limit(6),
    Review.find({ companyId, status: 'published' }).sort({ createdAt: -1 }).limit(3).lean(),
  ]);
  const c = req.vendor.company;
  const checklist = {
    logo: Boolean(c.media?.logo),
    description: (c.description ?? '').length >= 40,
    services: await Service.exists({ companyId, isActive: true, archivedAt: null }).then(Boolean),
    hours: c.availability.weekly.some((d) => d.length),
    gallery: (c.media?.gallery ?? []).length > 0,
    published: c.status === 'published',
  };
  res.json({
    data: {
      counts: { upcoming, requests, unreadConversations, rating: { average: Math.round(c.ratingAvg * 10) / 10, count: c.ratingCount } },
      last30Days: { profileViews: events.profile_view ?? 0, favorites: events.favorite_added ?? 0, inquiries: events.inquiry_started ?? 0, bookings: events.booking_created ?? 0 },
      series,
      nextBookings: await serializeBookings(nextBookings, 'vendor'),
      latestReviews: latestReviews.map((r) => serializeReview(r)),
      checklist,
    },
  });
});

export default router;
