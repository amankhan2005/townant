import mongoose from 'mongoose';

const { Schema } = mongoose;

const favoriteSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  },
  { timestamps: true },
);

favoriteSchema.index({ userId: 1, companyId: 1 }, { unique: true });
favoriteSchema.index({ userId: 1, createdAt: -1 });

export const Favorite = mongoose.model('Favorite', favoriteSchema);
