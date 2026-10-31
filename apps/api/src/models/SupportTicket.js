import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SUPPORT_STATUSES = ['open', 'in_progress', 'waiting_on_requester', 'resolved', 'closed'];
export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
// Categories offered to each kind of requester. There are no payment categories: TownAnt
// takes no payments.
export const SUPPORT_CATEGORIES = {
  customer: ['account', 'booking', 'business_concern', 'technical', 'privacy', 'feedback', 'other'],
  vendor: ['account', 'listing', 'bookings', 'team', 'technical', 'feedback', 'other'],
};

const historySchema = new Schema(
  {
    action: { type: String, required: true },
    from: String,
    to: String,
    actorType: { type: String, enum: ['customer', 'vendor', 'admin', 'system'], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// A request to TownAnt support from a customer or a vendor team member. Separate from
// customer↔business conversations (Conversation), which are booking inquiries.
const supportTicketSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    requesterType: { type: String, enum: ['customer', 'vendor'], required: true },
    requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Vendor tickets belong to the business they were raised for.
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    category: { type: String, required: true },
    subject: { type: String, required: true, maxlength: 120 },
    status: { type: String, enum: SUPPORT_STATUSES, default: 'open' },
    priority: { type: String, enum: SUPPORT_PRIORITIES, default: 'normal' },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    // Who owes the next reply.
    awaiting: { type: String, enum: ['support', 'requester', 'none'], default: 'support' },
    lastMessageAt: { type: Date, default: Date.now },
    lastRequesterMessageAt: Date,
    lastSupportReplyAt: Date,
    requesterUnread: { type: Boolean, default: false },
    resolvedAt: Date,
    closedAt: Date,
    // Set when the requester deleted their account; the ticket is kept for support records.
    requesterDeletedAt: Date,
    history: [historySchema],
  },
  { timestamps: true },
);

supportTicketSchema.index({ requesterType: 1, requesterId: 1, lastMessageAt: -1 });
supportTicketSchema.index({ companyId: 1, lastMessageAt: -1 });
supportTicketSchema.index({ status: 1, awaiting: 1, lastMessageAt: -1 });

export const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);
