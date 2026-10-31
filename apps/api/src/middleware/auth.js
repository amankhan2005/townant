import mongoose from 'mongoose';
import { safeEqual } from '../lib/crypto.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { Company, Membership } from '../models/index.js';
import { resolveSession, SESSION_COOKIE, sessionCookieOptions } from '../services/session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Identifies the caller from a bearer token (mobile) or the session cookie (web).
// Never rejects; protected routes add a require* guard.
export async function authenticate(req, res, next) {
  const header = req.get('authorization');
  let token;
  let via;
  if (header?.startsWith('Bearer ')) {
    token = header.slice(7).trim();
    via = 'bearer';
  } else if (req.cookies?.[SESSION_COOKIE]) {
    token = req.cookies[SESSION_COOKIE];
    via = 'cookie';
  }
  if (!token) return next();

  const resolved = await resolveSession(token);
  if (!resolved) {
    if (via === 'cookie') res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions({}), expires: undefined });
    return next();
  }
  // A token must be used over the transport it was issued for; a stolen cookie value
  // cannot be replayed as a bearer token to dodge the CSRF check, and vice versa.
  if ((resolved.session.transport === 'cookie') !== (via === 'cookie')) return next();

  req.auth = { ...resolved, via };
  return next();
}

// Cookie-authenticated, state-changing requests must echo the per-session CSRF token.
export function csrfProtection(req, _res, next) {
  if (!req.auth || req.auth.via !== 'cookie' || SAFE_METHODS.has(req.method)) return next();
  const supplied = req.get('x-csrf-token');
  if (!supplied || !safeEqual(supplied, req.auth.session.csrfToken)) {
    return next(new AppError(403, 'CSRF_FAILED', 'Your session could not be verified. Refresh the page and try again.'));
  }
  return next();
}

// A staff account signed in with a temporary password (issued by a Super Admin) may only change
// that password, read its session and sign out. Enforced for every API, so visiting a portal URL
// directly or calling the API cannot get around it.
const PASSWORD_CHANGE_ALLOWED = new Set(['GET /api/v1/auth/session', 'POST /api/v1/auth/logout', 'GET /api/v1/me', 'POST /api/v1/staff-auth/password/change']);

export function enforcePasswordChange(req, _res, next) {
  if (!req.auth?.user.passwordChangeRequired) return next();
  if (PASSWORD_CHANGE_ALLOWED.has(`${req.method} ${req.path.replace(/\/$/, '')}`)) return next();
  return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password to continue.'));
}

export function requireAuth(req, _res, next) {
  if (!req.auth) return next(unauthorized());
  return next();
}

export function requireCustomer(req, _res, next) {
  if (!req.auth) return next(unauthorized());
  if (req.auth.user.role !== 'customer') return next(forbidden('This action is available to customer accounts.'));
  return next();
}

export function requireAdmin(req, _res, next) {
  if (!req.auth) return next(unauthorized());
  if (req.auth.user.role !== 'super_admin') return next(forbidden());
  const { session } = req.auth;
  if (session.mfaRequired && !session.mfaVerifiedAt) {
    return next(new AppError(401, 'MFA_REQUIRED', 'Complete two-step verification to continue.'));
  }
  return next();
}

// Company-scoped permissions for vendor team members.
export const VENDOR_PERMISSIONS = Object.freeze({
  owner: ['dashboard', 'company:write', 'media:write', 'services:write', 'availability:write', 'bookings:read', 'bookings:write', 'messages', 'reviews:reply'],
  manager: ['dashboard', 'company:write', 'media:write', 'services:write', 'availability:write', 'bookings:read', 'bookings:write', 'messages', 'reviews:reply'],
  staff: ['dashboard', 'bookings:read', 'bookings:write', 'messages'],
});

// Resolves the vendor's company from their active membership. The company is never taken
// from a client-supplied ID alone: X-Company-Id only selects among the caller's own memberships.
// `allowSuspended` lets a suspended business still write to routes it needs to resolve the
// suspension (support requests); everything else is read-only while suspended.
export const vendorContext = ({ allowSuspended = false } = {}) => async (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  if (req.auth.user.role !== 'vendor') return next(forbidden());

  const memberships = await Membership.find({ userId: req.auth.user._id, status: 'active' }).lean();
  const requested = req.get('x-company-id');
  let membership;
  if (requested) {
    if (!mongoose.isValidObjectId(requested)) return next(forbidden());
    membership = memberships.find((m) => m.companyId.toString() === requested);
  } else if (memberships.length === 1) {
    [membership] = memberships;
  } else if (memberships.length > 1) {
    return next(new AppError(409, 'COMPANY_SELECTION_REQUIRED', 'Choose which business to manage.'));
  }
  if (!membership) return next(forbidden('You are not a member of this business.'));

  const company = await Company.findById(membership.companyId);
  if (!company) return next(forbidden());
  // A deleted business is closed to its team (it can be restored by TownAnt for 15 days).
  if (company.status === 'deleted') return next(new AppError(403, 'COMPANY_DELETED', 'This business has been removed from TownAnt. Contact TownAnt support.'));
  if (company.status === 'suspended' && !allowSuspended && !SAFE_METHODS.has(req.method)) {
    return next(new AppError(403, 'COMPANY_SUSPENDED', 'This business is suspended. Contact TownAnt support.'));
  }
  req.vendor = { membership, company, permissions: VENDOR_PERMISSIONS[membership.role] ?? [] };
  return next();
};

export const requireVendor = vendorContext();

export const requirePermission = (permission) => (req, _res, next) => {
  if (!req.vendor?.permissions.includes(permission)) return next(forbidden());
  return next();
};
