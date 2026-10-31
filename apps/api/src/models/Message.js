import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderType: { type: String, enum: ['customer', 'vendor', 'system'], required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User' },
    body: { type: String, required: true, maxlength: 2000 },
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

export const Message = mongoose.model('Message', messageSchema);
