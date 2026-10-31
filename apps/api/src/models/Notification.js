import mongoose from 'mongoose';

const { Schema } = mongoose;

// In-app notification. It is the durable record; email/push are best-effort deliveries of it.
const notificationSchema = new Schema(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    audience: { type: String, enum: ['customer', 'vendor', 'admin'], required: true },
    type: { type: String, required: true },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, maxlength: 500 },
    // Relative in-app path, e.g. /bookings/<id>. The destination re-checks authorization.
    link: String,
    entityType: String,
    entityId: Schema.Types.ObjectId,
    readAt: Date,
    // Prevents duplicate logical notifications when a job or request is retried.
    dedupeKey: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, readAt: 1 });

export const Notification = mongoose.model('Notification', notificationSchema);
