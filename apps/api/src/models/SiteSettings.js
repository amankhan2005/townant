import mongoose from 'mongoose';
import { mediaSchema } from './Company.js';

const { Schema } = mongoose;

const heroSchema = new Schema(
  {
    image: { type: mediaSchema, default: undefined },
    alt: { type: String, maxlength: 140, default: '' },
    // Focal point for cropping on narrow screens, as a CSS object-position percentage.
    focalX: { type: Number, min: 0, max: 100, default: 50 },
    focalY: { type: Number, min: 0, max: 100, default: 50 },
  },
  { _id: false },
);

// Homepage promotional banner (below "New and noteworthy"). Published directly — there is no draft
// stage: the new image replaces the live one only after it has been uploaded and saved. Title,
// description and link are optional; an image alone is a complete banner.
const bannerSchema = new Schema(
  {
    image: { type: mediaSchema, required: true },
    alt: { type: String, maxlength: 140, default: '' },
    title: { type: String, maxlength: 80, default: '' },
    description: { type: String, maxlength: 200, default: '' },
    linkUrl: { type: String, maxlength: 300, default: '' },
    linkLabel: { type: String, maxlength: 40, default: '' },
    publishedAt: Date,
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

// Platform-wide public site configuration managed by Super Admins. One document (key "site").
// The hero has a draft (uploaded, previewable in the admin console) and a published version
// (what the public homepage shows), so a replacement is never live before it is reviewed.
const siteSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, enum: ['site'] },
    hero: {
      draft: { type: heroSchema, default: undefined },
      published: { type: heroSchema, default: undefined },
      publishedAt: Date,
      publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    promoBanner: { type: bannerSchema, default: undefined },
  },
  { timestamps: true, minimize: false },
);

export const SiteSettings = mongoose.model('SiteSettings', siteSettingsSchema);
