import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { objectId, pageMeta, pagination, text, validate } from '../../lib/validate.js';
import { requireCustomer } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { Booking } from '../../models/index.js';
import { createBooking, findScopedBooking, rescheduleBooking, serializeBookings, transitionBooking } from '../../services/booking.js';

const router = Router();
const MIN = 60 * 1000;

router.use(requireCustomer);
const scopeOf = (req) => ({ type: 'customer', userId: req.auth.user._id });
const idParam = z.object({ id: objectId }).strict();
const userKey = (req) => req.auth.user._id.toString();

// Only these fields are accepted. Status, price, customer and company are derived on the server.
router.post(
  '/',
  rateLimit({ name: 'booking-create', windowMs: 10 * MIN, max: 15, key: userKey }),
  validate({ body: z.object({ serviceId: objectId, startAt: z.iso.datetime({ offset: true }), note: text(1000, { multiline: true }).optional() }).strict() }),
  async (req, res) => {
    const idempotencyKey = req.get('idempotency-key');
    if (idempotencyKey !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(idempotencyKey)) {
      throw new AppError(400, 'BAD_REQUEST', 'Idempotency-Key must be 8-64 letters, digits, - or _.');
    }
    const { booking, replayed } = await createBooking({ req, customer: req.auth.user, ...req.valid.body, idempotencyKey });
    const [out] = await serializeBookings([booking], 'customer');
    res.status(replayed ? 200 : 201).json({ data: out, meta: { replayed } });
  },
);

router.get(
  '/',
  validate({ query: pagination.extend({ when: z.enum(['upcoming', 'past', 'all']).default('upcoming') }).strict() }),
  async (req, res) => {
    const { when, page, limit } = req.valid.query;
    const now = new Date();
    const filter = { customerId: req.auth.user._id };
    if (when === 'upcoming') Object.assign(filter, { endAt: { $gte: now }, status: { $in: ['requested', 'confirmed'] } });
    if (when === 'past') filter.$or = [{ endAt: { $lt: now } }, { status: { $nin: ['requested', 'confirmed'] } }];
    const [rows, total] = await Promise.all([
      Booking.find(filter).sort({ startAt: when === 'upcoming' ? 1 : -1 }).skip((page - 1) * limit).limit(limit),
      Booking.countDocuments(filter),
    ]);
    res.json({ data: await serializeBookings(rows, 'customer'), meta: pageMeta(req.valid.query, total) });
  },
);

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const booking = await findScopedBooking(scopeOf(req), req.valid.params.id);
  const [out] = await serializeBookings([booking], 'customer');
  res.json({ data: out });
});

router.post(
  '/:id/cancel',
  rateLimit({ name: 'booking-change', windowMs: 10 * MIN, max: 20, key: userKey }),
  validate({ params: idParam, body: z.object({ reason: text(500).optional() }).strict() }),
  async (req, res) => {
    const booking = await transitionBooking({ req, scope: scopeOf(req), bookingId: req.valid.params.id, action: 'cancel_customer', actor: 'customer', reason: req.valid.body.reason });
    const [out] = await serializeBookings([booking], 'customer');
    res.json({ data: out });
  },
);

router.post(
  '/:id/reschedule',
  rateLimit({ name: 'booking-change', windowMs: 10 * MIN, max: 20, key: userKey }),
  validate({ params: idParam, body: z.object({ startAt: z.iso.datetime({ offset: true }) }).strict() }),
  async (req, res) => {
    const booking = await rescheduleBooking({ req, scope: scopeOf(req), bookingId: req.valid.params.id, actor: 'customer', startAt: req.valid.body.startAt });
    const [out] = await serializeBookings([booking], 'customer');
    res.json({ data: out });
  },
);

export default router;
