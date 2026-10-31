import mongoose from 'mongoose';

const { Schema } = mongoose;

// One document per 5-minute unit an active booking occupies on a resource. The unique
// index makes overlapping claims impossible at the database level, regardless of how many
// API instances race for the same slot.
export const CLAIM_UNIT_MINUTES = 5;

const slotClaimSchema = new Schema(
  {
    resourceKey: { type: String, required: true },
    unitStart: { type: Date, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  },
  { versionKey: false },
);

slotClaimSchema.index({ resourceKey: 1, unitStart: 1 }, { unique: true });

export const SlotClaim = mongoose.model('SlotClaim', slotClaimSchema);
