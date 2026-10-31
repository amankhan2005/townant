import mongoose from 'mongoose';

const { Schema } = mongoose;

// Outbox entry for an external delivery attempt. Written in the same transaction as the
// business change, delivered later by the worker with retries.
const notificationDeliverySchema = new Schema(
  {
    notificationId: { type: Schema.Types.ObjectId, ref: 'Notification' },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User' },
    channel: { type: String, enum: ['email', 'push'], required: true },
    // Explicit address for messages to people without an account (e.g. vendor applicants).
    toEmail: String,
    template: { type: String, required: true },
    payload: { type: Object, default: {} },
    status: { type: String, enum: ['pending', 'sending', 'sent', 'delivered', 'failed', 'skipped'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseUntil: Date,
    lastError: String,
    providerMessageId: String,
    sentAt: Date,
    dedupeKey: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

notificationDeliverySchema.index({ status: 1, nextAttemptAt: 1 });
notificationDeliverySchema.index({ providerMessageId: 1 }, { sparse: true });

export const NotificationDelivery = mongoose.model('NotificationDelivery', notificationDeliverySchema);
