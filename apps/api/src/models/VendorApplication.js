import mongoose from 'mongoose';

const { Schema } = mongoose;

const vendorApplicationSchema = new Schema(
  {
    status: {
      type: String,
      enum: ['submitted', 'under_review', 'info_requested', 'approved', 'rejected'],
      default: 'submitted',
      index: true,
    },
    businessName: { type: String, required: true },
    contactName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phone: String,
    website: String,
    categoryIds: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    description: String,
    address: {
      line1: String,
      city: String,
      region: String,
      postalCode: String,
      country: String,
    },
    serviceMode: { type: String, enum: ['fixed', 'mobile', 'both'], default: 'fixed' },
    reviewerId: { type: Schema.Types.ObjectId, ref: 'User' },
    decisionReason: String,
    decidedAt: Date,
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    ipHash: String,
  },
  { timestamps: true },
);

vendorApplicationSchema.index({ email: 1, createdAt: -1 });

export const VendorApplication = mongoose.model('VendorApplication', vendorApplicationSchema);
