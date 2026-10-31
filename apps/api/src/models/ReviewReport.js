import mongoose from 'mongoose';

const { Schema } = mongoose;

const reviewReportSchema = new Schema(
  {
    reviewId: { type: Schema.Types.ObjectId, ref: 'Review', required: true },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: ['spam', 'offensive', 'not_genuine', 'privacy', 'other'], required: true },
    details: { type: String, maxlength: 500 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  },
  { timestamps: true },
);

reviewReportSchema.index({ reviewId: 1, reporterId: 1 }, { unique: true });

export const ReviewReport = mongoose.model('ReviewReport', reviewReportSchema);
