// Domain constants shared by the API, web and mobile clients.
// The API is the only authority for these rules; clients use them for display.

export const BOOKING_STATUS = Object.freeze({
  REQUESTED: 'requested',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  CANCELLED_BY_CUSTOMER: 'cancelled_by_customer',
  CANCELLED_BY_VENDOR: 'cancelled_by_vendor',
  CANCELLED_BY_ADMIN: 'cancelled_by_admin',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show',
  EXPIRED: 'expired',
});

// Statuses that hold the slot on the calendar.
export const ACTIVE_BOOKING_STATUSES = Object.freeze([BOOKING_STATUS.REQUESTED, BOOKING_STATUS.CONFIRMED]);

export const BOOKING_STATUS_LABELS = Object.freeze({
  requested: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  declined: 'Declined',
  cancelled_by_customer: 'Cancelled by you',
  cancelled_by_vendor: 'Cancelled by business',
  cancelled_by_admin: 'Cancelled by TownAnt',
  completed: 'Completed',
  no_show: 'No-show',
  expired: 'Expired',
});

// Vendor-facing wording differs for customer cancellations.
export const VENDOR_BOOKING_STATUS_LABELS = Object.freeze({
  ...BOOKING_STATUS_LABELS,
  requested: 'Needs review',
  cancelled_by_customer: 'Cancelled by customer',
  cancelled_by_vendor: 'Cancelled by you',
});

export const BOOKING_STATUS_TONE = Object.freeze({
  requested: 'amber',
  confirmed: 'teal',
  declined: 'slate',
  cancelled_by_customer: 'slate',
  cancelled_by_vendor: 'slate',
  cancelled_by_admin: 'slate',
  completed: 'navy',
  no_show: 'red',
  expired: 'slate',
});

export const COMPANY_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  SUSPENDED: 'suspended',
});

export const APPLICATION_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  INFO_REQUESTED: 'info_requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const PRICE_DISPLAY = Object.freeze(['fixed', 'from', 'quote', 'hidden']);

export const PROFILE_SECTIONS = Object.freeze(['gallery', 'hours', 'reviews', 'policies', 'contact']);

export const WEEKDAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

export const MEMBERSHIP_ROLES = Object.freeze(['owner', 'manager', 'staff']);

export * from './dates.js';
export * as tokens from './tokens.js';
export { COUNTRY_CODES, countryName, countryOptions } from './countries.js';
