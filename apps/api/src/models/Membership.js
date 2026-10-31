import mongoose from 'mongoose';

const { Schema } = mongoose;

// Links a staff user to the company they may operate. All vendor authorization is derived
// from this record, never from IDs supplied by the client.
const membershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    role: { type: String, enum: ['owner', 'manager', 'staff'], required: true },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
  },
  { timestamps: true },
);

membershipSchema.index({ userId: 1, companyId: 1 }, { unique: true });

export const Membership = mongoose.model('Membership', membershipSchema);
