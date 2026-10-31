import mongoose from 'mongoose';

const { Schema } = mongoose;

// accountType separates passwordless customers from provisioned staff (vendor users and
// Super Admins). Identifiers are unique per account type, so the same email can belong to
// a customer account and a separately provisioned vendor account without linking them.
const userSchema = new Schema(
  {
    accountType: { type: String, enum: ['customer', 'staff'], required: true, immutable: true },
    role: { type: String, enum: ['customer', 'vendor', 'super_admin'], required: true },
    // 'pending_deletion': the customer asked to delete the account; it can be restored for 15 days
    // (deletionScheduledFor) by signing in with a one-time code. 'deleted' is the final tombstone:
    // identifiers and profile data are removed (see services/accountDeletion.js).
    status: { type: String, enum: ['active', 'invited', 'suspended', 'pending_deletion', 'deleted'], default: 'active' },
    displayName: { type: String, trim: true, maxlength: 80 },
    email: { type: String, lowercase: true, trim: true },
    emailVerifiedAt: Date,
    phone: { type: String },
    phoneVerifiedAt: Date,
    // Staff always have a password once set up. Customers may optionally add one as an alternative
    // to one-time codes; OTP sign-in keeps working either way.
    passwordHash: { type: String, select: false },
    passwordChangedAt: Date,
    // Set when someone other than the account holder chose the password (a Super Admin-issued
    // temporary password). Every API except the password change itself is refused until it is cleared.
    passwordChangeRequired: { type: Boolean, default: false },
    temporaryPasswordExpiresAt: Date,
    notificationPrefs: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
    },
    defaultLocation: {
      country: String,
      region: String,
      city: String,
      postalCode: String,
    },
    suspendedAt: Date,
    suspensionReason: String,
    lastLoginAt: Date,
    deletionRequestedAt: Date,
    deletionScheduledFor: Date,
    deletedAt: Date,
  },
  { timestamps: true },
);

userSchema.index({ accountType: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ accountType: 1, phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ status: 1, deletionScheduledFor: 1 }, { partialFilterExpression: { status: 'pending_deletion' } });

// Only fields a user may see about themselves.
userSchema.methods.toSelf = function toSelf() {
  return {
    id: this._id.toString(),
    accountType: this.accountType,
    role: this.role,
    status: this.status,
    displayName: this.displayName ?? null,
    email: this.email ?? null,
    emailVerified: Boolean(this.emailVerifiedAt),
    phone: this.phone ?? null,
    phoneVerified: Boolean(this.phoneVerifiedAt),
    notificationPrefs: this.notificationPrefs,
    defaultLocation: this.defaultLocation ?? {},
    passwordChangeRequired: Boolean(this.passwordChangeRequired),
    // passwordChangedAt is set whenever a password is stored and cleared when a customer removes theirs.
    hasPassword: Boolean(this.passwordChangedAt),
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
