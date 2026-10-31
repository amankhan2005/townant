import mongoose from 'mongoose';

// Fixed-window counters shared by every API instance.
const rateLimitBucketSchema = new mongoose.Schema(
  {
    _id: String,
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

rateLimitBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitBucket = mongoose.model('RateLimitBucket', rateLimitBucketSchema);
