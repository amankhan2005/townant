import mongoose from 'mongoose';

const { Schema } = mongoose;

// Reviews are tied to a completed booking. Moderation hides a review; it never edits the text.
const reviewSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, maxlength: 2000, default: '' },
    authorName: String,
    status: { type: String, enum: ['published', 'hidden'], default: 'published' },
    moderation: [
      new Schema(
        { action: String, reason: String, actorId: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } },
        { _id: false },
      ),
    ],
    reportCount: { type: Number, default: 0 },
    // The author asked to delete their account: hidden publicly and left out of ratings during the
    // 15-day recovery window, shown again if the account is restored, deleted when it is finalized.
    authorPendingDeletion: { type: Boolean, default: false },
    vendorReply: {
      text: { type: String, maxlength: 1000 },
      repliedAt: Date,
      repliedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
  },
  { timestamps: true },
);

reviewSchema.index({ companyId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ reportCount: -1, status: 1 });

export const Review = mongoose.model('Review', reviewSchema);
