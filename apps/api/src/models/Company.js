import mongoose from 'mongoose';
import { PROFILE_SECTIONS } from '@townant/shared';

const { Schema } = mongoose;

export const mediaSchema = new Schema(
  {
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    width: Number,
    height: Number,
    bytes: Number,
    format: String,
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const intervalSchema = new Schema({ start: String, end: String }, { _id: false });

const availabilitySchema = new Schema(
  {
    timezone: { type: String, default: 'America/New_York' },
    // weekly[0] = Sunday ... weekly[6] = Saturday; each day may have several intervals (breaks between).
    weekly: { type: [[intervalSchema]], default: () => [[], [], [], [], [], [], []] },
    exceptions: [
      new Schema(
        {
          date: { type: String, required: true },
          closed: { type: Boolean, default: true },
          intervals: [intervalSchema],
          note: { type: String, maxlength: 120 },
        },
        { _id: false },
      ),
    ],
    slotIntervalMinutes: { type: Number, default: 30 },
    bufferMinutes: { type: Number, default: 0 },
    minNoticeMinutes: { type: Number, default: 60 },
    maxAdvanceDays: { type: Number, default: 60 },
  },
  { _id: false },
);

const companySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true },
    // 'deleted' is a Super Admin soft delete: hidden everywhere public and closed to its team, and
    // restorable until `deletion.restoreUntil` (15 days). After that a job finalizes it (`deletion.purgedAt`);
    // the record itself is kept so bookings, reviews and audit history still resolve.
    status: { type: String, enum: ['draft', 'published', 'suspended', 'deleted'], default: 'draft', index: true },
    statusBeforeSuspension: String,
    suspendedAt: Date,
    suspensionReason: String,
    deletion: {
      deletedAt: Date,
      deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reason: { type: String, maxlength: 500 },
      statusBefore: { type: String, enum: ['draft', 'published', 'suspended'] },
      restoreUntil: Date,
      purgedAt: Date,
    },
    publishedAt: Date,
    verified: { type: Boolean, default: false },

    primaryCategoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    categoryIds: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    summary: { type: String, maxlength: 300, default: '' },
    description: { type: String, maxlength: 4000, default: '' },

    contact: {
      email: String,
      phone: String,
      website: String,
    },
    address: {
      line1: String,
      line2: String,
      area: String,
      city: String,
      region: String,
      postalCode: String,
      country: { type: String, default: 'US' },
    },
    // GeoJSON [lng, lat]; only set when the vendor supplies coordinates.
    location: {
      type: new Schema({ type: { type: String, enum: ['Point'], required: true }, coordinates: { type: [Number], required: true } }, { _id: false }),
      default: undefined,
    },
    serviceMode: { type: String, enum: ['fixed', 'mobile', 'both'], default: 'fixed' },
    serviceArea: {
      radiusKm: Number,
      postalCodes: [String],
    },

    media: {
      logo: mediaSchema,
      banner: mediaSchema,
      gallery: { type: [mediaSchema], default: [] },
    },
    sections: {
      type: Object,
      default: () => Object.fromEntries(PROFILE_SECTIONS.map((s) => [s, true])),
    },
    policies: {
      cancellation: { type: String, maxlength: 1500, default: '' },
    },
    bookingPolicy: {
      cancellationCutoffHours: { type: Number, default: 24 },
      rescheduleCutoffHours: { type: Number, default: 24 },
      requestExpiryHours: { type: Number, default: 24 },
    },
    availability: { type: availabilitySchema, default: () => ({}) },

    // Homepage "In the spotlight". Only a Super Admin can set this (audited); the copy is
    // written by TownAnt staff, never generated.
    spotlight: {
      active: { type: Boolean, default: false },
      // Position in the homepage row (ascending), set from the admin Homepage screen.
      order: { type: Number, default: 0 },
      headline: { type: String, maxlength: 80 },
      blurb: { type: String, maxlength: 160 },
      updatedAt: Date,
      updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },

    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    // Lower-cased text used for keyword search; rebuilt whenever profile or services change.
    searchText: { type: String, default: '' },

    applicationId: { type: Schema.Types.ObjectId, ref: 'VendorApplication' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false },
);

companySchema.index({ location: '2dsphere' });
companySchema.index({ status: 1, categoryIds: 1, ratingAvg: -1 });
companySchema.index({ status: 1, 'address.country': 1, 'address.city': 1 });
companySchema.index({ status: 1, 'address.postalCode': 1 });
companySchema.index({ 'spotlight.active': 1, status: 1, 'spotlight.order': 1 });
companySchema.index({ status: 1, publishedAt: -1 });
companySchema.index({ status: 1, 'deletion.restoreUntil': 1 }, { partialFilterExpression: { status: 'deleted' } });

export const Company = mongoose.model('Company', companySchema);
