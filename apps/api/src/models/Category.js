import mongoose from 'mongoose';
import { mediaSchema } from './Company.js';

const { Schema } = mongoose;

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    icon: { type: String, maxlength: 40 },
    description: { type: String, maxlength: 300 },
    // Uploaded by a Super Admin; shown on public category cards. No stock fallback is substituted.
    image: { type: mediaSchema, default: undefined },
    imageAlt: { type: String, maxlength: 140 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    // Whether a published top-level category gets its own business row on the homepage.
    showOnHomepage: { type: Boolean, default: true },
  },
  { timestamps: true },
);

categorySchema.index({ parentId: 1, sortOrder: 1 });

categorySchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    slug: this.slug,
    parentId: this.parentId ? this.parentId.toString() : null,
    icon: this.icon ?? null,
    description: this.description ?? null,
    image: this.image?.url ? { url: this.image.url, width: this.image.width ?? null, height: this.image.height ?? null, alt: this.imageAlt || '' } : null,
  };
};

export const Category = mongoose.model('Category', categorySchema);
