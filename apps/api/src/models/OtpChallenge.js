import mongoose from 'mongoose';

const { Schema } = mongoose;

// Stores only HMACs of the destination and code. The plaintext destination is
// re-supplied by the client at verification and checked against the fingerprint.
const otpChallengeSchema = new Schema(
  {
    challengeId: { type: String, required: true, unique: true },
    purpose: { type: String, enum: ['login', 'link', 'mfa', 'account_deletion', 'password_setup', 'password_reset'], required: true },
    channel: { type: String, enum: ['email', 'whatsapp'], required: true },
    destinationHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    consumedAt: Date,
    invalidatedAt: Date,
    deliveryStatus: { type: String, enum: ['pending', 'sent', 'delivered', 'failed'], default: 'pending' },
    providerMessageId: String,
    ipHash: String,
    // Removed by TTL a day after creation; long enough for abuse review.
    purgeAt: { type: Date, required: true },
  },
  { timestamps: true },
);

otpChallengeSchema.index({ destinationHash: 1, purpose: 1, createdAt: -1 });
otpChallengeSchema.index({ providerMessageId: 1 }, { sparse: true });
otpChallengeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const OtpChallenge = mongoose.model('OtpChallenge', otpChallengeSchema);
