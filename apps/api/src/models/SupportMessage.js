import mongoose from 'mongoose';

const { Schema } = mongoose;

// A message on a support ticket. `internal` notes are written by TownAnt staff for each other
// and are never returned to the requester.
const supportMessageSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'SupportTicket', required: true },
    authorType: { type: String, enum: ['requester', 'support', 'system'], required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    body: { type: String, required: true, maxlength: 4000 },
    internal: { type: Boolean, default: false },
  },
  { timestamps: true },
);

supportMessageSchema.index({ ticketId: 1, createdAt: 1 });

export const SupportMessage = mongoose.model('SupportMessage', supportMessageSchema);
