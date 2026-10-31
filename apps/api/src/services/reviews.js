import mongoose from 'mongoose';
import { BOOKING_STATUS } from '@townant/shared';
import { isDuplicateKey, withTransaction } from '../db.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { Booking, Company, Review } from '../models/index.js';
import { notifyCompany } from './notifications.js';

// Rating aggregates are recomputed from published reviews, never adjusted by hand.
export async function recomputeRating(companyId, session) {
  const [agg] = await Review.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(String(companyId)), status: 'published', authorPendingDeletion: { $ne: true } } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]).session(session ?? null);
  await Company.updateOne({ _id: companyId }, { $set: { ratingAvg: agg?.avg ?? 0, ratingCount: agg?.count ?? 0 } }, session ? { session } : undefined);
}

// Only the customer of a completed booking can review it, once.
export async function createReview({ customer, bookingId, rating, text }) {
  const booking = await Booking.findOne({ _id: bookingId, customerId: customer._id });
  if (!booking) throw notFound('Booking not found.');
  if (booking.status !== BOOKING_STATUS.COMPLETED) throw unprocessable('REVIEW_NOT_ALLOWED', 'You can review a booking after it has been completed.');
  try {
    return await withTransaction(async (session) => {
      const [review] = await Review.create(
        [
          {
            companyId: booking.companyId,
            customerId: customer._id,
            bookingId: booking._id,
            serviceId: booking.serviceId,
            rating,
            text,
            authorName: customer.displayName ? customer.displayName.split(' ')[0] : 'TownAnt customer',
          },
        ],
        { session },
      );
      await recomputeRating(booking.companyId, session);
      await notifyCompany(
        booking.companyId,
        { type: 'review_received', title: `New ${rating}-star review`, body: text ? text.slice(0, 140) : undefined, link: '/business/reviews', entityType: 'review', entityId: review._id, dedupeKey: `review:${review._id}:created` },
        session,
      );
      return review;
    });
  } catch (err) {
    if (isDuplicateKey(err, 'bookingId')) throw conflict('ALREADY_REVIEWED', 'You have already reviewed this booking.');
    throw err;
  }
}

export const serializeReview = (r, { includeModeration = false } = {}) => ({
  id: r._id.toString(),
  rating: r.rating,
  text: r.text,
  authorName: r.authorName,
  createdAt: r.createdAt,
  vendorReply: r.vendorReply?.text ? { text: r.vendorReply.text, repliedAt: r.vendorReply.repliedAt } : null,
  ...(includeModeration ? { status: r.status, reportCount: r.reportCount, moderation: r.moderation, companyId: r.companyId.toString() } : {}),
});
