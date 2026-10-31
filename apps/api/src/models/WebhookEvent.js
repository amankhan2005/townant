import mongoose from 'mongoose';

// Records processed provider webhook IDs so replays are ignored.
const webhookEventSchema = new mongoose.Schema(
  {
    _id: String,
    provider: { type: String, required: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
