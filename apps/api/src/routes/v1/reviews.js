import { Router } from 'express';
import { z } from 'zod';
import { isDuplicateKey } from '../../db.js';
import { conflict, notFound } from '../../lib/errors.js';
import { objectId, text, validate } from '../../lib/validate.js';
import { requireCustomer } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { Review, ReviewReport } from '../../models/index.js';
import { createReview, serializeReview } from '../../services/reviews.js';

const router = Router();
router.use(requireCustomer);
const userKey = (req) => req.auth.user._id.toString();

router.post(
  '/',
  rateLimit({ name: 'review-create', windowMs: 60 * 60 * 1000, max: 10, key: userKey }),
  validate({ body: z.object({ bookingId: objectId, rating: z.number().int().min(1).max(5), text: text(2000, { multiline: true }).default('') }).strict() }),
  async (req, res) => {
    const review = await createReview({ customer: req.auth.user, ...req.valid.body });
    res.status(201).json({ data: serializeReview(review) });
  },
);

router.get('/mine', async (req, res) => {
  const rows = await Review.find({ customerId: req.auth.user._id }, { bookingId: 1, rating: 1 }).lean();
  res.json({ data: rows.map((r) => ({ id: r._id.toString(), bookingId: r.bookingId.toString(), rating: r.rating })) });
});

router.post(
  '/:id/report',
  rateLimit({ name: 'review-report', windowMs: 60 * 60 * 1000, max: 20, key: userKey }),
  validate({ params: z.object({ id: objectId }).strict(), body: z.object({ reason: z.enum(['spam', 'offensive', 'not_genuine', 'privacy', 'other']), details: text(500).optional() }).strict() }),
  async (req, res) => {
    const review = await Review.findOne({ _id: req.valid.params.id, status: 'published' });
    if (!review) throw notFound('Review not found.');
    try {
      await ReviewReport.create({ reviewId: review._id, reporterId: req.auth.user._id, ...req.valid.body });
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('ALREADY_REPORTED', 'You have already reported this review.');
      throw err;
    }
    await Review.updateOne({ _id: review._id }, { $inc: { reportCount: 1 } });
    res.status(202).json({ data: { message: 'Thanks. Our team will review this report.' } });
  },
);

export default router;
