// Wording for the Super Admin console. Booking labels name who acted (the shared customer and
// vendor labels say "you"); audit actions are shown in plain language with the raw code kept
// available on the audit log itself.

export const ADMIN_BOOKING_LABELS = {
  requested: 'Awaiting business',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled_by_customer: 'Cancelled by customer',
  cancelled_by_vendor: 'Cancelled by business',
  cancelled_by_admin: 'Cancelled by TownAnt',
  declined: 'Declined',
  no_show: 'No-show',
  expired: 'Expired',
};

const ENTITY = {
  company: 'Business',
  vendor_application: 'Application',
  user: 'Account',
  booking: 'Booking',
  review: 'Review',
  category: 'Category',
  conversation: 'Conversation',
  service: 'Service',
  site: 'Homepage',
  staff: 'Staff',
  support: 'Support request',
};

const VERB = {
  create: 'created',
  update: 'updated',
  approve: 'approved',
  reject: 'rejected',
  request_info: 'more information requested',
  suspend: 'suspended',
  reactivate: 'reactivated',
  publish: 'published',
  unpublish: 'unpublished',
  login: 'signed in',
  mfa_verified: 'two-step verification completed',
  invite_accepted: 'invite accepted',
  password_reset: 'password reset',
  password_change: 'password changed',
  resend_invite: 'setup invite resent',
  cancel: 'cancelled',
  hide: 'hidden',
  restore: 'restored',
  self_delete: 'deleted by its owner',
};

const words = (s) => s.replaceAll('_', ' ');

// "company.suspend" → "Business suspended"; unknown codes fall back to readable words.
export function describeAudit(action = '') {
  const [entity, ...rest] = action.split('.');
  const verb = rest.join('.');
  const subject = ENTITY[entity] ?? words(entity).replace(/^\w/, (c) => c.toUpperCase());
  if (!verb) return subject;
  return `${subject} ${VERB[verb] ?? words(verb.replaceAll('.', ' '))}`;
}
