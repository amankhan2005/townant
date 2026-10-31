import mongoose from 'mongoose';

const { Schema } = mongoose;

// Single-use, time-limited tokens for vendor setup invitations, staff password resets and
// restoring a customer account that is pending deletion (issued only after a verified sign-in code).
const actionTokenSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    purpose: { type: String, enum: ['staff_invite', 'password_reset', 'account_restore'], required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

actionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

export const ActionToken = mongoose.model('ActionToken', actionTokenSchema);
