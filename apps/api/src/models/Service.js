import mongoose from 'mongoose';
import { PRICE_DISPLAY } from '@townant/shared';

const { Schema } = mongoose;

// A bookable offering. Price fields are informational only; TownAnt never collects payment.
const serviceSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 2000, default: '' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    durationMinutes: { type: Number, required: true, min: 5, max: 720 },
    bookingMode: { type: String, enum: ['instant', 'request'], default: 'instant' },
    price: {
      display: { type: String, enum: PRICE_DISPLAY, default: 'hidden' },
      amount: Number,
      currency: { type: String, maxlength: 3 },
      note: { type: String, maxlength: 120 },
    },
    isActive: { type: Boolean, default: true },
    archivedAt: Date,
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

serviceSchema.index({ companyId: 1, archivedAt: 1, sortOrder: 1 });

serviceSchema.methods.toPublic = function toPublic() {
  const showPrice = this.price?.display && this.price.display !== 'hidden';
  return {
    id: this._id.toString(),
    title: this.title,
    description: this.description,
    categoryId: this.categoryId?.toString() ?? null,
    durationMinutes: this.durationMinutes,
    bookingMode: this.bookingMode,
    price: showPrice
      ? { display: this.price.display, amount: this.price.amount ?? null, currency: this.price.currency ?? null, note: this.price.note ?? null }
      : null,
  };
};

export const Service = mongoose.model('Service', serviceSchema);
