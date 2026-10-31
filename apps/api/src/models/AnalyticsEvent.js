import mongoose from 'mongoose';

const { Schema } = mongoose;

// Explicitly defined interest events only. No user identifier is stored, so these
// cannot be used to build per-person browsing histories.
export const ANALYTICS_EVENTS = ['profile_view', 'favorite_added', 'inquiry_started', 'booking_created', 'booking_confirmed'];

const analyticsEventSchema = new Schema(
  {
    type: { type: String, enum: ANALYTICS_EVENTS, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    day: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

analyticsEventSchema.index({ companyId: 1, type: 1, day: 1 });
analyticsEventSchema.index({ type: 1, day: 1 });

export const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);
