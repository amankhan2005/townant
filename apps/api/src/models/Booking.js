import mongoose from 'mongoose';
import { BOOKING_STATUS } from '@townant/shared';

const { Schema } = mongoose;

const historySchema = new Schema(
  {
    action: { type: String, required: true },
    from: String,
    to: String,
    actorType: { type: String, enum: ['customer', 'vendor', 'admin', 'system'], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    previousStartAt: Date,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// A scheduling record. It carries no payment state by design.
const bookingSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    serviceSnapshot: {
      title: String,
      durationMinutes: Number,
      bookingMode: String,
    },
    resourceKey: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    blockEndAt: { type: Date, required: true },
    timezone: { type: String, required: true },
    status: { type: String, enum: Object.values(BOOKING_STATUS), required: true },
    customerNote: { type: String, maxlength: 1000 },
    idempotencyKey: String,
    requestExpiresAt: Date,
    reminderSentAt: Date,
    history: [historySchema],
  },
  { timestamps: true, optimisticConcurrency: true },
);

bookingSchema.index({ customerId: 1, startAt: -1 });
bookingSchema.index({ companyId: 1, startAt: 1 });
bookingSchema.index({ status: 1, startAt: 1 });
bookingSchema.index({ status: 1, requestExpiresAt: 1 });
bookingSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

export const Booking = mongoose.model('Booking', bookingSchema);
