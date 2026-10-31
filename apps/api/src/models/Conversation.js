import mongoose from 'mongoose';

const { Schema } = mongoose;

const conversationSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service' },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    subject: { type: String, maxlength: 120 },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    closedAt: Date,
    closedBy: { type: String, enum: ['customer', 'vendor', 'admin', 'system'] },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: String,
    customerUnread: { type: Number, default: 0 },
    vendorUnread: { type: Number, default: 0 },
  },
  { timestamps: true },
);

conversationSchema.index({ customerId: 1, lastMessageAt: -1 });
conversationSchema.index({ companyId: 1, lastMessageAt: -1 });
conversationSchema.index({ bookingId: 1 }, { unique: true, partialFilterExpression: { bookingId: { $type: 'objectId' } } });

export const Conversation = mongoose.model('Conversation', conversationSchema);
