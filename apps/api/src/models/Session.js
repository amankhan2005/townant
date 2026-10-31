import mongoose from 'mongoose';

const { Schema } = mongoose;

// Opaque session: the client holds a random token, the database holds only its SHA-256.
const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountType: { type: String, required: true },
    csrfToken: { type: String, required: true },
    transport: { type: String, enum: ['cookie', 'bearer'], required: true },
    mfaRequired: { type: Boolean, default: false },
    mfaVerifiedAt: Date,
    expiresAt: { type: Date, required: true },
    idleTimeoutMinutes: { type: Number, required: true },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: Date,
    revokedReason: String,
    ipHash: String,
    userAgent: String,
  },
  { timestamps: true },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model('Session', sessionSchema);
