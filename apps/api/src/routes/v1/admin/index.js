import { Router } from 'express';
import multer from 'multer';
import { DateTime } from 'luxon';
import mongoose from 'mongoose';
import { z } from 'zod';
import { isDuplicateKey, withTransaction } from '../../../db.js';
import { AppError, conflict, notFound } from '../../../lib/errors.js';
import { normalizePhone } from '../../../lib/phone.js';
import { countryCode, email, escapeRegex, isoDate, objectId, pageMeta, pagination, text, validate } from '../../../lib/validate.js';
import { requireAdmin } from '../../../middleware/auth.js';
import { rateLimit } from '../../../middleware/rateLimit.js';
import {
  AuditEvent,
  Booking,
  Category,
  Company,
  Conversation,
  Membership,
  Message,
  Review,
  ReviewReport,
  Service,
  Session,
  User,
  VendorApplication,
} from '../../../models/index.js';
import { countEvents, dailySeries } from '../../../services/analytics.js';
import { restoreCompany, purgeCompany, softDeleteCompany, upcomingBookingCount } from '../../../services/companyLifecycle.js';
import { EXPORT_MAX_ROWS, sendWorkbook } from '../../../services/exports.js';
import { audit } from '../../../services/audit.js';
import { serializeBookings, transitionBooking } from '../../../services/booking.js';
import { companyCard, companyForOwner, rebuildSearchText } from '../../../services/catalog.js';
import { BANNER_RULES, checkBannerDimensions, deleteImage, MAX_IMAGE_BYTES, PLATFORM_FOLDERS, uploadPlatformImage } from '../../../services/media.js';
import { serializeSiteForAdmin, siteSettings } from '../../../services/site.js';
import support from './support.js';
import { serializeConversations, serializeMessage } from '../../../services/conversations.js';
import { adminCreateCompany, approveApplication, decideApplication, resendInvite } from '../../../services/onboarding.js';
import { recomputeRating, serializeReview } from '../../../services/reviews.js';
import { revokeAllSessions } from '../../../services/session.js';
import { hashPassword, randomToken } from '../../../lib/crypto.js';
import { ActionToken } from '../../../models/index.js';

const router = Router();
router.use(requireAdmin);
router.use(rateLimit({ name: 'admin-api', windowMs: 60 * 1000, max: 300, key: (req) => req.auth.user._id.toString() }));

router.use(support);

const idParam = z.object({ id: objectId }).strict();
// Exports read up to EXPORT_MAX_ROWS records each, so they get their own per-admin budget.
const exportLimit = rateLimit({ name: 'admin-export', windowMs: 60 * 60 * 1000, max: 60, key: (req) => req.auth.user._id.toString(), message: 'Too many exports. Please wait a few minutes and try again.' });
const reasonBody = z.object({ reason: text(500, { min: 3 }) }).strict();
const search = (q) => ({ $regex: escapeRegex(q), $options: 'i' });

// ----- Dashboard -----

const dashboardQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), companyId: objectId.optional(), categoryId: objectId.optional() }).strict();

// Every figure comes from stored records (events, companies, users, bookings, applications) for the
// selected UTC date range; nothing is estimated or extrapolated.
async function dashboardData(query) {
  const to = query.to ?? DateTime.utc().toISODate();
  const from = query.from ?? DateTime.fromISO(to).minus({ days: 29 }).toISODate();
  const match = { day: { $gte: from, $lte: to } };
  if (query.companyId) match.companyId = new mongoose.Types.ObjectId(query.companyId);
  if (query.categoryId) match.categoryId = new mongoose.Types.ObjectId(query.categoryId);
  const created = { $gte: DateTime.fromISO(from, { zone: 'utc' }).toJSDate(), $lt: DateTime.fromISO(to, { zone: 'utc' }).plus({ days: 1 }).toJSDate() };
  const perDay = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } };
  const [events, series, companiesByStatus, pendingApplications, customers, openReports, bookingStatus, applicationsByStatus, customerSignups, companiesCreated, bookingsCreated, categoryMix, pendingDeletion] = await Promise.all([
    countEvents(match),
    dailySeries(match),
    Company.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    VendorApplication.countDocuments({ status: { $in: ['submitted', 'under_review'] } }),
    User.countDocuments({ role: 'customer', status: { $in: ['active', 'suspended'] } }),
    ReviewReport.countDocuments({ status: 'open' }),
    Booking.aggregate([{ $match: { createdAt: created } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    VendorApplication.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    User.aggregate([{ $match: { role: 'customer', createdAt: created } }, { $group: { _id: perDay, n: { $sum: 1 } } }]),
    Company.aggregate([{ $match: { createdAt: created } }, { $group: { _id: perDay, n: { $sum: 1 } } }]),
    Booking.aggregate([{ $match: { createdAt: created } }, { $group: { _id: perDay, n: { $sum: 1 } } }]),
    // Live businesses per top-level category (a sub-category counts towards its parent).
    Company.aggregate([
      { $match: { status: 'published' } },
      { $project: { cat: { $ifNull: ['$primaryCategoryId', { $arrayElemAt: ['$categoryIds', 0] }] } } },
      { $match: { cat: { $ne: null } } },
      { $lookup: { from: 'categories', localField: 'cat', foreignField: '_id', as: 'c' } },
      { $unwind: '$c' },
      { $group: { _id: { $ifNull: ['$c.parentId', '$c._id'] }, n: { $sum: 1 } } },
      { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'top' } },
      { $unwind: '$top' },
      { $project: { _id: 1, n: 1, name: '$top.name', slug: '$top.slug' } },
      { $sort: { n: -1, name: 1 } },
    ]),
    User.countDocuments({ role: 'customer', status: 'pending_deletion' }),
  ]);
  const daily = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
  return {
    range: { from, to },
    events: { profileViews: events.profile_view ?? 0, favorites: events.favorite_added ?? 0, inquiries: events.inquiry_started ?? 0, bookingsCreated: events.booking_created ?? 0, bookingsConfirmed: events.booking_confirmed ?? 0 },
    series,
    growth: { customers: daily(customerSignups), companies: daily(companiesCreated), bookings: daily(bookingsCreated) },
    categoryMix: categoryMix.map((r) => ({ id: r._id.toString(), name: r.name, slug: r.slug, companies: r.n })),
    totals: {
      companies: Object.fromEntries(companiesByStatus.map((r) => [r._id, r.n])),
      pendingApplications,
      customers,
      customersPendingDeletion: pendingDeletion,
      openReviewReports: openReports,
      bookingsByStatus: Object.fromEntries(bookingStatus.map((r) => [r._id, r.n])),
      applicationsByStatus: Object.fromEntries(applicationsByStatus.map((r) => [r._id, r.n])),
    },
    note: 'Counts come from recorded platform data in the selected UTC date range.',
  };
}

router.get('/dashboard', validate({ query: dashboardQuery }), async (req, res) => {
  res.json({ data: await dashboardData(req.valid.query) });
});

// ----- Vendor applications -----

const applicationFilters = { status: z.enum(['submitted', 'under_review', 'info_requested', 'approved', 'rejected']).optional(), q: text(80).optional() };

function applicationFilter({ status, q }) {
  const filter = {};
  if (status) filter.status = status;
  if (q) filter.$or = [{ businessName: search(q) }, { email: search(q) }];
  return filter;
}

router.get('/applications', validate({ query: pagination.extend(applicationFilters).strict() }), async (req, res) => {
  const { page, limit } = req.valid.query;
  const filter = applicationFilter(req.valid.query);
  const [rows, total] = await Promise.all([VendorApplication.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), VendorApplication.countDocuments(filter)]);
  res.json({ data: rows.map(serializeApplication), meta: pageMeta(req.valid.query, total) });
});

const APPLICATION_STATUS_TEXT = { submitted: 'New', under_review: 'Under review', info_requested: 'Info requested', approved: 'Approved', rejected: 'Rejected' };

router.get('/applications/export', exportLimit, validate({ query: z.object(applicationFilters).strict() }), async (req, res) => {
  const filter = applicationFilter(req.valid.query);
  const [rows, total] = await Promise.all([VendorApplication.find(filter).sort({ createdAt: -1 }).limit(EXPORT_MAX_ROWS).lean(), VendorApplication.countDocuments(filter)]);
  const cats = new Map((await Category.find({}, { name: 1 }).lean()).map((c) => [c._id.toString(), c.name]));
  const columns = [
    { header: 'Business', width: 30, value: (a) => a.businessName },
    { header: 'Status', width: 15, value: (a) => APPLICATION_STATUS_TEXT[a.status] ?? a.status },
    { header: 'Contact name', width: 22, value: (a) => a.contactName },
    { header: 'Email', width: 30, value: (a) => a.email },
    { header: 'Phone', width: 18, value: (a) => a.phone },
    { header: 'Website', width: 28, value: (a) => a.website },
    { header: 'Categories', width: 30, value: (a) => (a.categoryIds ?? []).map((id) => cats.get(String(id))).filter(Boolean).join(', ') },
    { header: 'City', width: 18, value: (a) => a.address?.city },
    { header: 'State / region', width: 16, value: (a) => a.address?.region },
    { header: 'Country', width: 10, value: (a) => a.address?.country },
    { header: 'Service mode', width: 14, value: (a) => a.serviceMode },
    { header: 'Submitted (UTC)', width: 16, type: 'date', value: (a) => a.createdAt },
    { header: 'Decided (UTC)', width: 15, type: 'date', value: (a) => a.decidedAt },
    { header: 'Decision note', width: 40, value: (a) => a.decisionReason },
  ];
  await sendWorkbook(res, 'company-applications', [{ name: 'Applications', columns, rows }], { truncated: total > rows.length, total });
});

function serializeApplication(a) {
  return {
    id: a._id.toString(),
    status: a.status,
    businessName: a.businessName,
    contactName: a.contactName,
    email: a.email,
    phone: a.phone ?? null,
    website: a.website ?? null,
    categoryIds: (a.categoryIds ?? []).map(String),
    description: a.description,
    address: a.address,
    serviceMode: a.serviceMode,
    decisionReason: a.decisionReason ?? null,
    decidedAt: a.decidedAt ?? null,
    companyId: a.companyId?.toString() ?? null,
    createdAt: a.createdAt,
  };
}

router.get('/applications/:id', validate({ params: idParam }), async (req, res) => {
  const app = await VendorApplication.findById(req.valid.params.id).lean();
  if (!app) throw notFound();
  // Mark as under review the first time an admin opens it.
  if (app.status === 'submitted') {
    await VendorApplication.updateOne({ _id: app._id, status: 'submitted' }, { $set: { status: 'under_review', reviewerId: req.auth.user._id } });
    app.status = 'under_review';
  }
  res.json({ data: serializeApplication(app) });
});

router.post('/applications/:id/approve', validate({ params: idParam, body: z.object({ reason: text(500).optional() }).strict() }), async (req, res) => {
  const result = await approveApplication(req, req.valid.params.id, req.valid.body.reason);
  res.json({ data: { application: serializeApplication(result.application.toObject()), company: companyForOwner(result.company), inviteEmailSent: result.inviteEmailSent } });
});

router.post('/applications/:id/reject', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const app = await decideApplication(req, req.valid.params.id, 'rejected', req.valid.body.reason);
  res.json({ data: serializeApplication(app.toObject()) });
});

router.post('/applications/:id/request-info', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const app = await decideApplication(req, req.valid.params.id, 'info_requested', req.valid.body.reason);
  res.json({ data: serializeApplication(app.toObject()) });
});

// ----- Companies -----

const companyFilters = { status: z.enum(['draft', 'published', 'suspended']).optional(), q: text(80).optional(), view: z.enum(['active', 'deleted']).default('active') };

// The normal list never includes deleted businesses; `view=deleted` is the Recently Deleted list.
function companyFilter({ status, q, view }) {
  const filter = view === 'deleted' ? { status: 'deleted' } : status ? { status } : { status: { $ne: 'deleted' } };
  if (q) filter.$or = [{ name: search(q) }, { slug: search(q) }, { 'address.city': search(q) }];
  return filter;
}

router.get('/companies', validate({ query: pagination.extend(companyFilters).strict() }), async (req, res) => {
  const { page, limit, view } = req.valid.query;
  const filter = companyFilter(req.valid.query);
  const sort = view === 'deleted' ? { 'deletion.deletedAt': -1 } : { createdAt: -1 };
  const [rows, total] = await Promise.all([Company.find(filter).sort(sort).skip((page - 1) * limit).limit(limit), Company.countDocuments(filter)]);
  res.json({ data: rows.map(companyForOwner), meta: pageMeta(req.valid.query, total) });
});

// Every company matching the list filters (not just one page), as a spreadsheet.
router.get('/companies/export', exportLimit, validate({ query: z.object(companyFilters).strict() }), async (req, res) => {
  const filter = companyFilter(req.valid.query);
  const [rows, total] = await Promise.all([Company.find(filter).sort({ createdAt: -1 }).limit(EXPORT_MAX_ROWS).lean(), Company.countDocuments(filter)]);
  const cats = new Map((await Category.find({}, { name: 1 }).lean()).map((c) => [c._id.toString(), c.name]));
  const owners = await Membership.find({ companyId: { $in: rows.map((r) => r._id) }, role: 'owner', status: 'active' }, { companyId: 1, userId: 1 }).lean();
  const ownerUsers = new Map((await User.find({ _id: { $in: owners.map((o) => o.userId) } }, { email: 1 }).lean()).map((u) => [u._id.toString(), u.email]));
  const ownerOf = new Map(owners.map((o) => [o.companyId.toString(), ownerUsers.get(o.userId.toString())]));
  const statusText = { published: 'Live', draft: 'Draft', suspended: 'Suspended', deleted: 'Deleted' };
  const columns = [
    { header: 'Company', width: 32, value: (c) => c.name },
    { header: 'Link name', width: 28, value: (c) => c.slug },
    { header: 'Status', width: 12, value: (c) => statusText[c.status] ?? c.status },
    { header: 'Verified', width: 10, type: 'boolean', value: (c) => Boolean(c.verified) },
    { header: 'Primary category', width: 22, value: (c) => cats.get(String(c.primaryCategoryId ?? c.categoryIds?.[0] ?? '')) },
    { header: 'Categories', width: 32, value: (c) => (c.categoryIds ?? []).map((id) => cats.get(String(id))).filter(Boolean).join(', ') },
    { header: 'City', width: 18, value: (c) => c.address?.city },
    { header: 'State / region', width: 16, value: (c) => c.address?.region },
    { header: 'Country', width: 10, value: (c) => c.address?.country },
    { header: 'Service mode', width: 14, value: (c) => c.serviceMode },
    { header: 'Owner email', width: 30, value: (c) => ownerOf.get(c._id.toString()) },
    { header: 'Rating', width: 10, type: 'number', format: '0.0', value: (c) => (c.ratingCount ? Math.round(c.ratingAvg * 10) / 10 : null) },
    { header: 'Reviews', width: 10, type: 'number', value: (c) => c.ratingCount ?? 0 },
    { header: 'In spotlight', width: 12, type: 'boolean', value: (c) => Boolean(c.spotlight?.active) },
    { header: 'Created (UTC)', width: 14, type: 'date', value: (c) => c.createdAt },
    { header: 'Published (UTC)', width: 15, type: 'date', value: (c) => c.publishedAt },
    { header: 'Deleted (UTC)', width: 14, type: 'date', value: (c) => c.deletion?.deletedAt },
    { header: 'Recoverable until (UTC)', width: 22, type: 'date', value: (c) => (c.deletion?.purgedAt ? null : c.deletion?.restoreUntil) },
  ];
  await sendWorkbook(res, req.valid.query.view === 'deleted' ? 'deleted-companies' : 'companies', [{ name: 'Companies', columns, rows }], { truncated: total > rows.length, total });
});

router.get('/companies/:id', validate({ params: idParam }), async (req, res) => {
  const company = await Company.findById(req.valid.params.id);
  if (!company) throw notFound();
  const members = await Membership.find({ companyId: company._id }).lean();
  const users = new Map((await User.find({ _id: { $in: members.map((m) => m.userId) } }, { email: 1, displayName: 1, status: 1, lastLoginAt: 1 }).lean()).map((u) => [u._id.toString(), u]));
  const [bookingCount, serviceCount, upcomingBookings] = await Promise.all([Booking.countDocuments({ companyId: company._id }), Service.countDocuments({ companyId: company._id, archivedAt: null }), upcomingBookingCount(company._id)]);
  res.json({
    data: {
      ...companyForOwner(company),
      members: members.map((m) => {
        const u = users.get(m.userId.toString());
        return { userId: m.userId.toString(), role: m.role, membershipStatus: m.status, email: u?.email, name: u?.displayName ?? null, accountStatus: u?.status, lastLoginAt: u?.lastLoginAt ?? null };
      }),
      stats: { bookings: bookingCount, services: serviceCount, upcomingBookings },
    },
  });
});

router.post(
  '/companies',
  validate({
    body: z
      .object({
        name: text(120, { min: 2 }),
        ownerEmail: email,
        categoryIds: z.array(objectId).max(5).default([]),
        description: text(2000, { multiline: true }).default(''),
        address: z.object({ line1: text(120).optional(), city: text(80, { min: 1 }), region: text(80).optional(), postalCode: text(12).optional(), country: countryCode }).strict(),
        serviceMode: z.enum(['fixed', 'mobile', 'both']).default('fixed'),
        phone: z.string().trim().max(32).optional(),
      })
      .strict(),
  }),
  async (req, res) => {
    const b = req.valid.body;
    const categoryIds = (await Category.find({ _id: { $in: b.categoryIds }, isActive: true }, { _id: 1 }).lean()).map((c) => c._id);
    const result = await adminCreateCompany(req, {
      name: b.name,
      email: b.ownerEmail,
      categoryIds,
      description: b.description,
      address: b.address,
      serviceMode: b.serviceMode,
      contactPhone: b.phone ? normalizePhone(b.phone, b.address.country) : undefined,
    });
    res.status(201).json({ data: { company: companyForOwner(result.company), inviteEmailSent: result.inviteEmailSent } });
  },
);

router.patch('/companies/:id', validate({ params: idParam, body: z.object({ verified: z.boolean().optional(), name: text(120, { min: 2 }).optional() }).strict() }), async (req, res) => {
  const company = await Company.findOneAndUpdate({ _id: req.valid.params.id, status: { $ne: 'deleted' } }, { $set: req.valid.body }, { new: true });
  if (!company) throw (await Company.exists({ _id: req.valid.params.id })) ? conflict('COMPANY_DELETED', 'Restore this business before changing it.') : notFound();
  await audit(req, { action: 'company.admin_update', entityType: 'company', entityId: company._id, companyId: company._id, metadata: req.valid.body });
  res.json({ data: companyForOwner(company) });
});

// Suspension hides the business and blocks new bookings and vendor changes. Existing
// bookings are left in place for the admin to handle individually.
router.post('/companies/:id/suspend', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const company = await withTransaction(async (session) => {
    const current = await Company.findById(req.valid.params.id).session(session);
    if (!current) throw notFound();
    if (current.status === 'suspended') throw conflict('INVALID_STATUS', 'This business is already suspended.');
    if (current.status === 'deleted') throw conflict('COMPANY_DELETED', 'Restore this business before suspending it.');
    const updated = await Company.findOneAndUpdate(
      { _id: current._id, status: current.status },
      { $set: { status: 'suspended', statusBeforeSuspension: current.status, suspendedAt: new Date(), suspensionReason: req.valid.body.reason } },
      { new: true, session },
    );
    await audit(req, { action: 'company.suspend', entityType: 'company', entityId: current._id, companyId: current._id, reason: req.valid.body.reason }, session);
    return updated;
  });
  res.json({ data: companyForOwner(company) });
});

router.post('/companies/:id/reactivate', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const company = await withTransaction(async (session) => {
    const current = await Company.findOne({ _id: req.valid.params.id, status: 'suspended' }).session(session);
    if (!current) throw conflict('INVALID_STATUS', 'This business is not suspended.');
    current.status = current.statusBeforeSuspension === 'published' ? 'published' : 'draft';
    current.suspendedAt = undefined;
    current.suspensionReason = undefined;
    await current.save({ session });
    await audit(req, { action: 'company.reactivate', entityType: 'company', entityId: current._id, companyId: current._id, reason: req.valid.body.reason }, session);
    return current;
  });
  res.json({ data: companyForOwner(company) });
});

// Soft delete with a 15-day recovery window (services/companyLifecycle.js). Nothing is removed now.
router.delete('/companies/:id', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const company = await softDeleteCompany(req, req.valid.params.id, req.valid.body.reason);
  res.json({ data: { ...companyForOwner(company), upcomingBookings: await upcomingBookingCount(company._id) } });
});

router.post('/companies/:id/restore', validate({ params: idParam, body: z.object({ reason: text(500).optional() }).strict() }), async (req, res) => {
  res.json({ data: companyForOwner(await restoreCompany(req, req.valid.params.id, req.valid.body.reason)) });
});

// Finalizes a deleted business once its recovery period has ended (the job does this too).
router.post('/companies/:id/purge', validate({ params: idParam }), async (req, res) => {
  const current = await Company.findById(req.valid.params.id, { status: 1, deletion: 1 }).lean();
  if (!current) throw notFound();
  if (current.status !== 'deleted') throw conflict('NOT_DELETED', 'Only deleted businesses can be permanently deleted.');
  if (current.deletion?.purgedAt) throw conflict('ALREADY_PURGED', 'This business has already been permanently deleted.');
  if (current.deletion?.restoreUntil > new Date()) throw conflict('RECOVERY_PERIOD_ACTIVE', 'This business can still be restored. It can be permanently deleted once its recovery period ends.');
  const result = await purgeCompany(current._id, { req });
  if (!result) throw conflict('STATE_CHANGED', 'This business changed. Refresh and try again.');
  res.json({ data: { ...companyForOwner(await Company.findById(current._id)), finalized: result } });
});

// Homepage spotlight placement. Copy is optional and written by TownAnt staff; only published
// businesses are ever shown publicly. Suspended businesses cannot be placed.
router.put(
  '/companies/:id/spotlight',
  validate({ params: idParam, body: z.object({ active: z.boolean(), headline: text(80).optional(), blurb: text(160).optional() }).strict() }),
  async (req, res) => {
    const { active, headline, blurb } = req.valid.body;
    const current = await Company.findById(req.valid.params.id, { status: 1, spotlight: 1 }).lean();
    if (!current) throw notFound();
    if (active && current.status === 'suspended') throw conflict('NOT_ELIGIBLE', 'Suspended businesses cannot be placed in the spotlight.');
    if (current.status === 'deleted') throw conflict('COMPANY_DELETED', 'Restore this business before changing its spotlight placement.');
    // New placements go to the end of the row; existing ones keep their position.
    let order = current.spotlight?.order ?? 0;
    if (active && !current.spotlight?.active) {
      const last = await Company.findOne({ 'spotlight.active': true }, { 'spotlight.order': 1 }).sort({ 'spotlight.order': -1 }).lean();
      order = (last?.spotlight?.order ?? -1) + 1;
    }
    const company = await Company.findByIdAndUpdate(
      current._id,
      { $set: { spotlight: { active, order, headline: active ? headline : undefined, blurb: active ? blurb : undefined, updatedAt: new Date(), updatedBy: req.auth.user._id } } },
      { new: true },
    );
    await audit(req, { action: active ? 'company.spotlight_on' : 'company.spotlight_off', entityType: 'company', entityId: company._id, companyId: company._id, metadata: { headline: headline ?? null } });
    res.json({ data: companyForOwner(company) });
  },
);

// ----- Homepage: spotlight list, ordering and hero image -----

// Every current placement, including ones not shown publicly, with the reason they are hidden.
router.get('/spotlight', async (_req, res) => {
  const rows = await Company.find({ 'spotlight.active': true }).sort({ 'spotlight.order': 1, 'spotlight.updatedAt': -1, _id: 1 }).limit(100).lean();
  const cats = new Map((await Category.find({ _id: { $in: rows.flatMap((r) => r.categoryIds ?? []) } }).lean()).map((c) => [c._id.toString(), { id: c._id.toString(), name: c.name, slug: c.slug }]));
  res.json({
    data: rows.map((r) => ({
      ...companyCard(r, cats),
      status: r.status,
      visible: r.status === 'published',
      spotlight: { headline: r.spotlight.headline ?? null, blurb: r.spotlight.blurb ?? null, order: r.spotlight.order ?? 0 },
    })),
  });
});

router.put('/spotlight/order', validate({ body: z.object({ ids: z.array(objectId).min(1).max(100) }).strict() }), async (req, res) => {
  const { ids } = req.valid.body;
  if (new Set(ids).size !== ids.length) throw new AppError(422, 'DUPLICATE_IDS', 'Each business can appear once.');
  const placed = await Company.find({ _id: { $in: ids }, 'spotlight.active': true }, { _id: 1 }).lean();
  if (placed.length !== ids.length) throw new AppError(422, 'NOT_IN_SPOTLIGHT', 'Only businesses currently in the spotlight can be ordered.');
  await Company.bulkWrite(ids.map((id, order) => ({ updateOne: { filter: { _id: id, 'spotlight.active': true }, update: { $set: { 'spotlight.order': order } } } })));
  await audit(req, { action: 'site.spotlight_reorder', entityType: 'site', metadata: { ids } });
  res.status(204).end();
});

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 8, parts: 9 } });
const uploadLimit = rateLimit({ name: 'admin-upload', windowMs: 60 * 60 * 1000, max: 60, key: (req) => req.auth.user._id.toString() });
const heroMeta = z.object({ alt: text(140).default(''), focalX: z.coerce.number().int().min(0).max(100).default(50), focalY: z.coerce.number().int().min(0).max(100).default(50) }).strict();

router.get('/site', async (_req, res) => {
  res.json({ data: serializeSiteForAdmin(await siteSettings()), meta: { uploads: { maxBytes: MAX_IMAGE_BYTES, formats: ['JPEG', 'PNG', 'WebP'] }, banner: { ratio: '3:1', recommended: BANNER_RULES.recommended, min: { width: BANNER_RULES.minWidth, height: BANNER_RULES.minHeight } } } });
});

// Saves site settings after a new image upload. If saving fails, the just-uploaded asset is removed
// (nothing references it) and the previously published image stays untouched.
async function saveWithUpload(site, publicId) {
  try {
    await site.save();
  } catch (err) {
    await deleteImage(publicId);
    throw err;
  }
}

// Uploads a new hero image as a draft (not public until published). With `publish=true` the image
// is published in the same step; that needs the image description, as publishing always has.
router.post(
  '/site/hero/draft',
  uploadLimit,
  imageUpload.single('file'),
  validate({ body: heroMeta.extend({ publish: z.enum(['true', 'false']).optional() }).strict() }),
  async (req, res) => {
    const { publish, ...meta } = req.valid.body;
    if (publish === 'true' && !meta.alt.trim()) throw new AppError(422, 'ALT_REQUIRED', 'Add a short description of the image before publishing.');
    const image = await uploadPlatformImage({ folder: PLATFORM_FOLDERS.hero(), file: req.file, userId: req.auth.user._id });
    const site = await siteSettings();
    const previousDraft = site.hero?.draft?.image?.publicId;
    const previousLive = site.hero?.published?.image?.publicId;
    if (publish === 'true') {
      site.set('hero.published', { image, ...meta });
      site.set('hero.draft', undefined);
      site.set('hero.publishedAt', new Date());
      site.set('hero.publishedBy', req.auth.user._id);
    } else {
      site.set('hero.draft', { image, ...meta });
    }
    await saveWithUpload(site, image.publicId);
    // Old assets go only after the new state is saved.
    if (previousDraft && previousDraft !== site.hero.published?.image?.publicId) await deleteImage(previousDraft);
    if (publish === 'true' && previousLive && previousLive !== image.publicId) await deleteImage(previousLive);
    await audit(req, { action: publish === 'true' ? 'site.hero_publish' : 'site.hero_draft_upload', entityType: 'site', metadata: { publicId: image.publicId, direct: publish === 'true' } });
    res.status(201).json({ data: serializeSiteForAdmin(site) });
  },
);

// Edits the draft's (or, with nothing drafted, the published image's) text alternative and focal point.
router.patch('/site/hero', validate({ body: heroMeta.partial().strict() }), async (req, res) => {
  const site = await siteSettings();
  const target = site.hero?.draft?.image ? 'draft' : site.hero?.published?.image ? 'published' : null;
  if (!target) throw notFound('No hero image has been uploaded yet.');
  for (const [k, v] of Object.entries(req.valid.body)) site.set(`hero.${target}.${k}`, v);
  await site.save();
  await audit(req, { action: 'site.hero_update', entityType: 'site', metadata: { target, fields: Object.keys(req.valid.body) } });
  res.json({ data: serializeSiteForAdmin(site) });
});

router.post('/site/hero/publish', async (req, res) => {
  const site = await siteSettings();
  if (!site.hero?.draft?.image) throw conflict('NO_DRAFT', 'Upload a hero image before publishing.');
  if (!site.hero.draft.alt?.trim()) throw new AppError(422, 'ALT_REQUIRED', 'Add a short description of the image before publishing.');
  const replaced = site.hero.published?.image?.publicId;
  site.set('hero.published', site.hero.draft.toObject());
  site.set('hero.draft', undefined);
  site.set('hero.publishedAt', new Date());
  site.set('hero.publishedBy', req.auth.user._id);
  await site.save();
  if (replaced && replaced !== site.hero.published.image.publicId) await deleteImage(replaced);
  await audit(req, { action: 'site.hero_publish', entityType: 'site', metadata: { publicId: site.hero.published.image.publicId } });
  res.json({ data: serializeSiteForAdmin(site) });
});

router.delete('/site/hero/draft', async (req, res) => {
  const site = await siteSettings();
  const removed = site.hero?.draft?.image?.publicId;
  if (!removed) throw notFound('There is no draft to discard.');
  site.set('hero.draft', undefined);
  await site.save();
  if (removed !== site.hero?.published?.image?.publicId) await deleteImage(removed);
  await audit(req, { action: 'site.hero_draft_discard', entityType: 'site' });
  res.json({ data: serializeSiteForAdmin(site) });
});

// Takes the published hero down; the homepage falls back to its image-free layout.
router.post('/site/hero/unpublish', validate({ body: reasonBody }), async (req, res) => {
  const site = await siteSettings();
  const removed = site.hero?.published?.image?.publicId;
  if (!removed) throw notFound('No hero image is published.');
  site.set('hero.published', undefined);
  site.set('hero.publishedAt', undefined);
  await site.save();
  await deleteImage(removed);
  await audit(req, { action: 'site.hero_unpublish', entityType: 'site', reason: req.valid.body.reason });
  res.json({ data: serializeSiteForAdmin(site) });
});

// ----- Homepage promotional banner (below "New and noteworthy") -----
// Published directly: no draft step. An image alone is a complete banner; text and link are optional.

// Same-site paths ("/search?category=pets") or https URLs only. No javascript:, data: or
// protocol-relative ("//host") links.
const bannerLink = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || /^\/(?![/\\])[^\s]*$/.test(v) || /^https:\/\/[^\s/$.?#][^\s]*$/i.test(v), 'Use a link that starts with / or https://');
const bannerText = { alt: text(140), title: text(80), description: text(200), linkUrl: bannerLink, linkLabel: text(40) };

router.post('/site/banner', uploadLimit, imageUpload.single('file'), validate({ body: z.object(Object.fromEntries(Object.entries(bannerText).map(([k, v]) => [k, v.default('')]))).strict() }), async (req, res) => {
  const b = req.valid.body;
  if (b.linkLabel && !b.linkUrl) throw new AppError(400, 'VALIDATION_ERROR', 'Add a link for the button text, or leave the button text empty.');
  // The 3:1 rule is checked on the uploaded bytes; client-reported sizes are never trusted.
  const image = await uploadPlatformImage({ folder: PLATFORM_FOLDERS.banner(), file: req.file, userId: req.auth.user._id, check: checkBannerDimensions });
  const site = await siteSettings();
  const replaced = site.promoBanner?.image?.publicId;
  site.set('promoBanner', { image, ...b, publishedAt: new Date(), publishedBy: req.auth.user._id });
  await saveWithUpload(site, image.publicId);
  // The previous banner stays live until the new one is saved; only then is its asset removed.
  if (replaced && replaced !== image.publicId) await deleteImage(replaced);
  await audit(req, { action: replaced ? 'site.banner_replace' : 'site.banner_publish', entityType: 'site', metadata: { publicId: image.publicId, hasTitle: Boolean(b.title), hasLink: Boolean(b.linkUrl) } });
  res.status(201).json({ data: serializeSiteForAdmin(site) });
});

// Edits the live banner's text and link without replacing the image.
router.patch('/site/banner', validate({ body: z.object(Object.fromEntries(Object.entries(bannerText).map(([k, v]) => [k, v.optional()]))).strict() }), async (req, res) => {
  const site = await siteSettings();
  if (!site.promoBanner?.image) throw notFound('No promotional banner is published.');
  const next = { linkUrl: site.promoBanner.linkUrl, linkLabel: site.promoBanner.linkLabel, ...req.valid.body };
  if (next.linkLabel && !next.linkUrl) throw new AppError(400, 'VALIDATION_ERROR', 'Add a link for the button text, or leave the button text empty.');
  for (const [k, v] of Object.entries(req.valid.body)) site.set(`promoBanner.${k}`, v);
  await site.save();
  await audit(req, { action: 'site.banner_update', entityType: 'site', metadata: { fields: Object.keys(req.valid.body) } });
  res.json({ data: serializeSiteForAdmin(site) });
});

router.delete('/site/banner', async (req, res) => {
  const site = await siteSettings();
  const removed = site.promoBanner?.image?.publicId;
  if (!removed) throw notFound('No promotional banner is published.');
  site.set('promoBanner', undefined);
  await site.save();
  await deleteImage(removed);
  await audit(req, { action: 'site.banner_remove', entityType: 'site' });
  res.json({ data: serializeSiteForAdmin(site) });
});

router.post('/companies/:id/resend-invite', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await resendInvite(req, req.valid.params.id) });
});

// ----- Users -----

router.get(
  '/users',
  validate({ query: pagination.extend({ role: z.enum(['customer', 'vendor', 'super_admin']).optional(), status: z.enum(['active', 'invited', 'suspended', 'pending_deletion', 'deleted']).optional(), q: text(80).optional() }).strict() }),
  async (req, res) => {
    const { role, status, q, page, limit } = req.valid.query;
    const filter = {};
    if (role) filter.role = role;
    if (status) filter.status = status;
    if (q) filter.$or = [{ email: search(q) }, { displayName: search(q) }, { phone: search(q) }];
    const [rows, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), User.countDocuments(filter)]);
    res.json({
      data: rows.map((u) => ({ ...u.toSelf(), suspensionReason: u.suspensionReason ?? null, lastLoginAt: u.lastLoginAt ?? null, deletionScheduledFor: u.deletionScheduledFor ?? null, temporaryPasswordExpiresAt: u.passwordChangeRequired ? (u.temporaryPasswordExpiresAt ?? null) : null })),
      meta: pageMeta(req.valid.query, total),
    });
  },
);

router.post('/users/:id/suspend', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  if (req.auth.user._id.equals(req.valid.params.id)) throw new AppError(422, 'SELF_ACTION', 'You cannot suspend your own account.');
  const user = await User.findOneAndUpdate(
    { _id: req.valid.params.id, status: { $ne: 'suspended' } },
    { $set: { status: 'suspended', suspendedAt: new Date(), suspensionReason: req.valid.body.reason } },
    { new: true },
  );
  if (!user) throw conflict('INVALID_STATUS', 'User not found or already suspended.');
  await revokeAllSessions(user._id, 'suspended');
  await audit(req, { action: 'user.suspend', entityType: 'user', entityId: user._id, reason: req.valid.body.reason });
  res.json({ data: user.toSelf() });
});

router.post('/users/:id/reactivate', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const current = await User.findOne({ _id: req.valid.params.id, status: 'suspended' }).select('+passwordHash');
  if (!current) throw conflict('INVALID_STATUS', 'User not found or not suspended.');
  // Staff who never finished setup go back to "invited".
  const next = current.accountType === 'staff' && !current.passwordHash ? 'invited' : 'active';
  await User.updateOne({ _id: current._id }, { $set: { status: next }, $unset: { suspendedAt: 1, suspensionReason: 1 } });
  await audit(req, { action: 'user.reactivate', entityType: 'user', entityId: current._id, reason: req.valid.body.reason });
  res.json({ data: (await User.findById(current._id)).toSelf() });
});

// Issues a temporary password for a vendor staff account (for owners who can't use the emailed setup
// or reset link). It is shown once in this response only — never stored in plaintext, emailed or
// logged — expires after TEMP_PASSWORD_HOURS, and must be changed at first sign-in before any
// other API works (middleware/auth.js#enforcePasswordChange). Every session for the account ends.
const TEMP_PASSWORD_HOURS = 72;
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function temporaryPassword() {
  for (;;) {
    const bytes = randomToken(32);
    const pw = [...bytes].filter((ch) => TEMP_ALPHABET.includes(ch)).slice(0, 16).join('');
    if (pw.length === 16 && new Set(pw).size >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}

router.post(
  '/users/:id/temporary-password',
  rateLimit({ name: 'admin-temp-password', windowMs: 60 * 60 * 1000, max: 20, key: (req) => req.auth.user._id.toString() }),
  validate({ params: idParam, body: reasonBody }),
  async (req, res) => {
    const target = await User.findById(req.valid.params.id);
    if (!target) throw notFound();
    if (target.accountType !== 'staff' || target.role !== 'vendor') throw new AppError(422, 'NOT_ELIGIBLE', 'Temporary passwords can only be issued to vendor staff accounts.');
    if (!['active', 'invited'].includes(target.status)) throw conflict('INVALID_STATUS', 'Reactivate this account before issuing a temporary password.');
    const pw = temporaryPassword();
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600 * 1000);
    const updated = await User.findOneAndUpdate(
      { _id: target._id, status: target.status },
      { $set: { passwordHash: await hashPassword(pw), passwordChangedAt: new Date(), passwordChangeRequired: true, temporaryPasswordExpiresAt: expiresAt, status: 'active' } },
      { new: true },
    );
    if (!updated) throw conflict('STATE_CHANGED', 'This account changed. Refresh and try again.');
    // An unused setup link would otherwise be a second way in.
    await ActionToken.updateMany({ userId: target._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
    await revokeAllSessions(target._id, 'temporary_password');
    await audit(req, { action: 'user.temporary_password_issued', entityType: 'user', entityId: target._id, reason: req.valid.body.reason, metadata: { expiresAt: expiresAt.toISOString() } });
    res.status(201).json({ data: { temporaryPassword: pw, expiresAt, user: updated.toSelf() } });
  },
);

router.post('/users/:id/revoke-sessions', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const result = await Session.updateMany({ userId: req.valid.params.id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'admin_revoked' } });
  await audit(req, { action: 'user.revoke_sessions', entityType: 'user', entityId: req.valid.params.id, reason: req.valid.body.reason });
  res.json({ data: { revoked: result.modifiedCount } });
});

// ----- Bookings -----

router.get(
  '/bookings',
  validate({ query: pagination.extend({ status: z.string().regex(/^[a-z_]+$/).max(30).optional(), companyId: objectId.optional(), q: z.string().trim().toUpperCase().regex(/^TA-[A-Z0-9]{1,8}$/).optional() }).strict() }),
  async (req, res) => {
    const { status, companyId, q, page, limit } = req.valid.query;
    const filter = {};
    if (status) filter.status = status;
    if (companyId) filter.companyId = companyId;
    if (q) filter.reference = q;
    const [rows, total] = await Promise.all([Booking.find(filter).sort({ startAt: -1 }).skip((page - 1) * limit).limit(limit), Booking.countDocuments(filter)]);
    res.json({ data: await serializeBookings(rows, 'admin'), meta: pageMeta(req.valid.query, total) });
  },
);

router.post('/bookings/:id/cancel', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const booking = await transitionBooking({ req, scope: { type: 'admin' }, bookingId: req.valid.params.id, action: 'cancel_admin', actor: 'admin', reason: req.valid.body.reason });
  const [out] = await serializeBookings([booking], 'admin');
  res.json({ data: out });
});

// ----- Inquiries -----

router.get('/conversations', validate({ query: pagination.extend({ status: z.enum(['open', 'closed']).optional(), companyId: objectId.optional() }).strict() }), async (req, res) => {
  const { status, companyId, page, limit } = req.valid.query;
  const filter = {};
  if (status) filter.status = status;
  if (companyId) filter.companyId = companyId;
  const [rows, total] = await Promise.all([Conversation.find(filter).sort({ lastMessageAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Conversation.countDocuments(filter)]);
  res.json({ data: await serializeConversations(rows, 'admin'), meta: pageMeta(req.valid.query, total) });
});

// Reading private message content requires a stated reason and is audited.
router.post('/conversations/:id/messages', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const conversation = await Conversation.findById(req.valid.params.id).lean();
  if (!conversation) throw notFound();
  const messages = await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).limit(500).lean();
  await audit(req, { action: 'conversation.admin_read', entityType: 'conversation', entityId: conversation._id, companyId: conversation.companyId, reason: req.valid.body.reason });
  res.json({ data: { messages: messages.map(serializeMessage) } });
});

router.post('/conversations/:id/close', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const updated = await Conversation.findOneAndUpdate({ _id: req.valid.params.id, status: 'open' }, { $set: { status: 'closed', closedAt: new Date(), closedBy: 'admin' } }, { new: true });
  if (!updated) throw conflict('INVALID_STATUS', 'Conversation not found or already closed.');
  await audit(req, { action: 'conversation.admin_close', entityType: 'conversation', entityId: updated._id, companyId: updated.companyId, reason: req.valid.body.reason });
  res.status(204).end();
});

// ----- Reviews -----

router.get('/reviews', validate({ query: pagination.extend({ status: z.enum(['published', 'hidden']).optional(), reported: z.enum(['true', 'false']).optional() }).strict() }), async (req, res) => {
  const { status, reported, page, limit } = req.valid.query;
  const filter = {};
  if (status) filter.status = status;
  if (reported === 'true') filter.reportCount = { $gt: 0 };
  const [rows, total] = await Promise.all([Review.find(filter).sort({ reportCount: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Review.countDocuments(filter)]);
  const reports = await ReviewReport.find({ reviewId: { $in: rows.map((r) => r._id) }, status: 'open' }).lean();
  res.json({
    data: rows.map((r) => ({
      ...serializeReview(r, { includeModeration: true }),
      openReports: reports.filter((p) => p.reviewId.equals(r._id)).map((p) => ({ reason: p.reason, details: p.details ?? null, createdAt: p.createdAt })),
    })),
    meta: pageMeta(req.valid.query, total),
  });
});

// Moderation hides or restores a review; review text is never edited.
for (const [action, from, to] of [
  ['hide', 'published', 'hidden'],
  ['restore', 'hidden', 'published'],
]) {
  router.post(`/reviews/:id/${action}`, validate({ params: idParam, body: reasonBody }), async (req, res) => {
    const review = await withTransaction(async (session) => {
      const updated = await Review.findOneAndUpdate(
        { _id: req.valid.params.id, status: from },
        { $set: { status: to }, $push: { moderation: { action, reason: req.valid.body.reason, actorId: req.auth.user._id } } },
        { new: true, session },
      );
      if (!updated) throw conflict('INVALID_STATUS', `Review not found or not ${from}.`);
      await ReviewReport.updateMany({ reviewId: updated._id, status: 'open' }, { $set: { status: 'resolved' } }, { session });
      await recomputeRating(updated.companyId, session);
      await audit(req, { action: `review.${action}`, entityType: 'review', entityId: updated._id, companyId: updated.companyId, reason: req.valid.body.reason }, session);
      return updated;
    });
    res.json({ data: serializeReview(review, { includeModeration: true }) });
  });
}

router.post('/reviews/:id/dismiss-reports', validate({ params: idParam, body: reasonBody }), async (req, res) => {
  const result = await ReviewReport.updateMany({ reviewId: req.valid.params.id, status: 'open' }, { $set: { status: 'resolved' } });
  await audit(req, { action: 'review.dismiss_reports', entityType: 'review', entityId: req.valid.params.id, reason: req.valid.body.reason });
  res.json({ data: { resolved: result.modifiedCount } });
});

// ----- Categories -----

const categoryBody = {
  name: text(60, { min: 2 }),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single dashes').min(2).max(60),
  parentId: objectId.nullable(),
  icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
  description: text(300),
  imageAlt: text(140),
  showOnHomepage: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
};

const adminCategory = (c) => ({ ...c.toPublic(), imageAlt: c.imageAlt ?? '', sortOrder: c.sortOrder, isActive: c.isActive, showOnHomepage: c.showOnHomepage !== false, createdAt: c.createdAt ?? null, updatedAt: c.updatedAt ?? null });

const OPEN_APPLICATION = ['submitted', 'under_review', 'info_requested'];

// Where a category is referenced. Deleted businesses count too: they still point at it and may be restored.
async function categoryUsage(id) {
  const oid = new mongoose.Types.ObjectId(String(id));
  const [companies, liveCompanies, services, children, openApplications] = await Promise.all([
    Company.countDocuments({ $or: [{ categoryIds: oid }, { primaryCategoryId: oid }] }),
    Company.countDocuments({ status: 'published', $or: [{ categoryIds: oid }, { primaryCategoryId: oid }] }),
    Service.countDocuments({ categoryId: oid }),
    Category.countDocuments({ parentId: oid }),
    VendorApplication.countDocuments({ categoryIds: oid, status: { $in: OPEN_APPLICATION } }),
  ]);
  return { companies, liveCompanies, services, children, openApplications };
}

router.get('/categories', async (_req, res) => {
  const cats = await Category.find().sort({ sortOrder: 1, name: 1 });
  // Business counts per category (any status except deleted) for the list.
  const counts = await Company.aggregate([{ $match: { status: { $ne: 'deleted' } } }, { $unwind: '$categoryIds' }, { $group: { _id: '$categoryIds', n: { $sum: 1 } } }]);
  const byId = new Map(counts.map((c) => [c._id.toString(), c.n]));
  res.json({ data: cats.map((c) => ({ ...adminCategory(c), companyCount: byId.get(c._id.toString()) ?? 0 })) });
});

router.get('/categories/export', exportLimit, async (req, res) => {
  const cats = await Category.find().sort({ sortOrder: 1, name: 1 }).lean();
  const counts = await Company.aggregate([{ $match: { status: { $ne: 'deleted' } } }, { $unwind: '$categoryIds' }, { $group: { _id: '$categoryIds', all: { $sum: 1 }, live: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } } } }]);
  const byId = new Map(counts.map((c) => [c._id.toString(), c]));
  const names = new Map(cats.map((c) => [c._id.toString(), c.name]));
  const columns = [
    { header: 'Category', width: 26, value: (c) => c.name },
    { header: 'Slug', width: 22, value: (c) => c.slug },
    { header: 'Parent', width: 22, value: (c) => (c.parentId ? names.get(c.parentId.toString()) : null) },
    { header: 'Level', width: 14, value: (c) => (c.parentId ? 'Sub-category' : 'Top level') },
    { header: 'Published', width: 11, type: 'boolean', value: (c) => c.isActive !== false },
    { header: 'Sort order', width: 11, type: 'number', value: (c) => c.sortOrder ?? 0 },
    { header: 'Businesses', width: 12, type: 'number', value: (c) => byId.get(c._id.toString())?.all ?? 0 },
    { header: 'Live businesses', width: 15, type: 'number', value: (c) => byId.get(c._id.toString())?.live ?? 0 },
    { header: 'Has image', width: 11, type: 'boolean', value: (c) => Boolean(c.image?.url) },
    { header: 'Description', width: 44, value: (c) => c.description },
    { header: 'Created (UTC)', width: 14, type: 'date', value: (c) => c.createdAt },
    { header: 'Updated (UTC)', width: 14, type: 'date', value: (c) => c.updatedAt },
  ];
  await sendWorkbook(res, 'categories', [{ name: 'Categories', columns, rows: cats }], { total: cats.length });
});

router.get('/categories/:id', validate({ params: idParam }), async (req, res) => {
  const cat = await Category.findById(req.valid.params.id);
  if (!cat) throw notFound();
  const [usage, parent, children] = await Promise.all([categoryUsage(cat._id), cat.parentId ? Category.findById(cat.parentId, { name: 1 }).lean() : null, Category.find({ parentId: cat._id }).sort({ sortOrder: 1, name: 1 })]);
  res.json({ data: { ...adminCategory(cat), parent: parent ? { id: parent._id.toString(), name: parent.name } : null, children: children.map(adminCategory), usage } });
});

async function checkParent(parentId, selfId) {
  if (!parentId) return;
  if (selfId && parentId === String(selfId)) throw new AppError(422, 'INVALID_PARENT', 'A category cannot be its own parent.');
  const parent = await Category.findById(parentId, { parentId: 1 }).lean();
  if (!parent) throw notFound('Parent category not found.');
  // Two levels only: a parent must itself be top level, and a category with children stays top level.
  if (parent.parentId) throw new AppError(422, 'INVALID_PARENT', 'Choose a top-level category as the parent.');
  if (selfId && (await Category.exists({ parentId: selfId }))) throw new AppError(422, 'INVALID_PARENT', 'This category has sub-categories, so it must stay top level.');
}

const slugTaken = () => conflict('SLUG_TAKEN', 'A category with this slug already exists. Choose another.');

router.post(
  '/categories',
  validate({ body: z.object({ ...categoryBody, parentId: categoryBody.parentId.default(null), icon: categoryBody.icon.optional(), description: categoryBody.description.optional(), imageAlt: categoryBody.imageAlt.optional(), showOnHomepage: categoryBody.showOnHomepage.default(true), sortOrder: categoryBody.sortOrder.default(0), isActive: categoryBody.isActive.default(true) }).strict() }),
  async (req, res) => {
    await checkParent(req.valid.body.parentId);
    if (await Category.exists({ slug: req.valid.body.slug })) throw slugTaken();
    let cat;
    try {
      cat = await Category.create(req.valid.body);
    } catch (err) {
      // Two creates racing on the same slug: the unique index decides.
      if (isDuplicateKey(err, 'slug')) throw slugTaken();
      throw err;
    }
    await audit(req, { action: 'category.create', entityType: 'category', entityId: cat._id });
    res.status(201).json({ data: adminCategory(cat) });
  },
);

// Slugs can change (with a uniqueness check); old /search?category=<slug> links then stop matching.
router.patch('/categories/:id', validate({ params: idParam, body: z.object(Object.fromEntries(Object.entries(categoryBody).map(([k, v]) => [k, v.optional()]))).strict() }), async (req, res) => {
  const body = req.valid.body;
  if (body.parentId !== undefined) await checkParent(body.parentId, req.valid.params.id);
  if (body.slug && (await Category.exists({ slug: body.slug, _id: { $ne: req.valid.params.id } }))) throw slugTaken();
  let cat;
  try {
    cat = await Category.findByIdAndUpdate(req.valid.params.id, { $set: body }, { new: true, runValidators: true });
  } catch (err) {
    if (isDuplicateKey(err, 'slug')) throw slugTaken();
    throw err;
  }
  if (!cat) throw notFound();
  // Names feed business search text; rebuild for the businesses that use this category.
  if (body.name) {
    const affected = await Company.find({ categoryIds: cat._id }, { _id: 1 }).limit(5000).lean();
    for (const c of affected) await rebuildSearchText(c._id);
  }
  await audit(req, { action: 'category.update', entityType: 'category', entityId: cat._id, metadata: { fields: Object.keys(body) } });
  res.json({ data: adminCategory(cat) });
});

// Deletes a category without leaving broken references. A category with sub-categories can't be
// deleted. One that businesses, services or open applications still use needs `reassignTo` (every
// reference moves to that category in one transaction); otherwise the response lists the usage so
// the admin can reassign or unpublish instead.
router.delete('/categories/:id', validate({ params: idParam, body: z.object({ reassignTo: objectId.optional() }).strict() }), async (req, res) => {
  const cat = await Category.findById(req.valid.params.id);
  if (!cat) throw notFound();
  const usage = await categoryUsage(cat._id);
  if (usage.children) throw conflict('CATEGORY_HAS_CHILDREN', 'Move or delete this category’s sub-categories first.', { usage });
  const { reassignTo } = req.valid.body;
  const inUse = usage.companies + usage.services + usage.openApplications > 0;
  if (inUse && !reassignTo) throw conflict('CATEGORY_IN_USE', 'Businesses or services still use this category. Choose a category to move them to, or unpublish it instead.', { usage });
  let target = null;
  if (reassignTo) {
    if (reassignTo === cat._id.toString()) throw new AppError(422, 'INVALID_TARGET', 'Choose a different category to move businesses to.');
    target = await Category.findById(reassignTo, { _id: 1, name: 1, isActive: 1 }).lean();
    if (!target) throw notFound('The category to move businesses to was not found.');
    if (!target.isActive) throw new AppError(422, 'INVALID_TARGET', 'Choose a published category to move businesses to.');
  }
  const affected = target ? await Company.find({ $or: [{ categoryIds: cat._id }, { primaryCategoryId: cat._id }] }, { _id: 1 }).lean() : [];
  const moved = await withTransaction(async (session) => {
    const opts = { session };
    let counts = { companies: 0, services: 0, applications: 0 };
    if (target) {
      await Company.updateMany({ categoryIds: cat._id }, { $addToSet: { categoryIds: target._id } }, opts);
      const companies = await Company.updateMany({ categoryIds: cat._id }, { $pull: { categoryIds: cat._id } }, opts);
      await Company.updateMany({ primaryCategoryId: cat._id }, { $set: { primaryCategoryId: target._id } }, opts);
      const services = await Service.updateMany({ categoryId: cat._id }, { $set: { categoryId: target._id } }, opts);
      await VendorApplication.updateMany({ categoryIds: cat._id }, { $addToSet: { categoryIds: target._id } }, opts);
      const applications = await VendorApplication.updateMany({ categoryIds: cat._id }, { $pull: { categoryIds: cat._id } }, opts);
      counts = { companies: Math.max(companies.modifiedCount, affected.length), services: services.modifiedCount, applications: applications.modifiedCount };
    } else {
      // Closed applications may still list it; drop the dangling ID from their history.
      await VendorApplication.updateMany({ categoryIds: cat._id }, { $pull: { categoryIds: cat._id } }, opts);
    }
    const removed = await Category.deleteOne({ _id: cat._id }, opts);
    if (removed.deletedCount !== 1) throw conflict('STATE_CHANGED', 'This category changed. Refresh and try again.');
    await audit(req, { action: 'category.delete', entityType: 'category', entityId: cat._id, metadata: { name: cat.name, slug: cat.slug, reassignTo: target?._id?.toString() ?? null, moved: counts } }, session);
    return counts;
  });
  for (const c of affected) await rebuildSearchText(c._id);
  if (cat.image?.publicId) await deleteImage(cat.image.publicId);
  res.json({ data: { deleted: true, id: cat._id.toString(), reassignedTo: target ? { id: target._id.toString(), name: target.name } : null, moved } });
});

// Category card image. Stored under a server-chosen folder for that category.
router.post('/categories/:id/image', uploadLimit, imageUpload.single('file'), validate({ params: idParam, body: z.object({ alt: text(140).optional() }).strict() }), async (req, res) => {
  const cat = await Category.findById(req.valid.params.id);
  if (!cat) throw notFound();
  const image = await uploadPlatformImage({ folder: PLATFORM_FOLDERS.category(cat._id), file: req.file, userId: req.auth.user._id });
  const replaced = cat.image?.publicId;
  cat.image = image;
  if (req.valid.body.alt !== undefined) cat.imageAlt = req.valid.body.alt;
  try {
    await cat.save();
  } catch (err) {
    await deleteImage(image.publicId);
    throw err;
  }
  if (replaced) await deleteImage(replaced);
  await audit(req, { action: 'category.image_upload', entityType: 'category', entityId: cat._id, metadata: { publicId: image.publicId } });
  res.status(201).json({ data: adminCategory(cat) });
});

router.delete('/categories/:id/image', validate({ params: idParam }), async (req, res) => {
  const cat = await Category.findById(req.valid.params.id);
  if (!cat) throw notFound();
  const removed = cat.image?.publicId;
  if (!removed) throw notFound('This category has no image.');
  cat.image = undefined;
  await cat.save();
  await deleteImage(removed);
  await audit(req, { action: 'category.image_remove', entityType: 'category', entityId: cat._id });
  res.json({ data: adminCategory(cat) });
});

// ----- Reports -----

const BOOKING_STATUS_TEXT = {
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

// The dashboard's underlying figures for the selected period, one sheet per table.
router.get('/dashboard/export', exportLimit, validate({ query: dashboardQuery }), async (req, res) => {
  const d = await dashboardData(req.valid.query);
  const days = [];
  for (let day = DateTime.fromISO(d.range.from, { zone: 'utc' }); day.toISODate() <= d.range.to; day = day.plus({ days: 1 })) days.push(day.toISODate());
  const eventCount = (day, type) => d.series.find((s) => s.day === day && s.type === type)?.count ?? 0;
  const c = d.totals.companies;
  const summary = [
    ['Reporting period start (UTC)', DateTime.fromISO(d.range.from, { zone: 'utc' }).toJSDate()],
    ['Reporting period end (UTC)', DateTime.fromISO(d.range.to, { zone: 'utc' }).toJSDate()],
    ['Live businesses', c.published ?? 0],
    ['Draft businesses', c.draft ?? 0],
    ['Suspended businesses', c.suspended ?? 0],
    ['Deleted businesses (recoverable or finalized)', c.deleted ?? 0],
    ['Applications awaiting review', d.totals.pendingApplications],
    ['Customer accounts', d.totals.customers],
    ['Customer accounts pending deletion', d.totals.customersPendingDeletion],
    ['Open review reports', d.totals.openReviewReports],
    ['Profile views in period', d.events.profileViews],
    ['Favorites in period', d.events.favorites],
    ['Inquiries started in period', d.events.inquiries],
    ['Bookings created in period', d.events.bookingsCreated],
    ['Bookings confirmed in period', d.events.bookingsConfirmed],
  ].map(([metric, value]) => ({ metric, value }));
  await sendWorkbook(res, 'dashboard-report', [
    { name: 'Summary', rows: summary, columns: [{ header: 'Metric', width: 44, value: (r) => r.metric }, { header: 'Value', width: 16, value: (r) => r.value }] },
    {
      name: 'Daily activity',
      rows: days,
      columns: [
        { header: 'Date (UTC)', width: 14, type: 'date', value: (day) => DateTime.fromISO(day, { zone: 'utc' }).toJSDate() },
        { header: 'Profile views', width: 14, type: 'number', value: (day) => eventCount(day, 'profile_view') },
        { header: 'Favorites', width: 12, type: 'number', value: (day) => eventCount(day, 'favorite_added') },
        { header: 'Inquiries', width: 12, type: 'number', value: (day) => eventCount(day, 'inquiry_started') },
        { header: 'Bookings created', width: 17, type: 'number', value: (day) => d.growth.bookings[day] ?? 0 },
        { header: 'Bookings confirmed', width: 19, type: 'number', value: (day) => eventCount(day, 'booking_confirmed') },
        { header: 'New customers', width: 15, type: 'number', value: (day) => d.growth.customers[day] ?? 0 },
        { header: 'New businesses', width: 15, type: 'number', value: (day) => d.growth.companies[day] ?? 0 },
      ],
    },
    {
      name: 'Bookings by status',
      rows: Object.entries(d.totals.bookingsByStatus).sort((a, b) => b[1] - a[1]),
      columns: [{ header: 'Status', width: 24, value: ([s]) => BOOKING_STATUS_TEXT[s] ?? s }, { header: 'Bookings created in period', width: 26, type: 'number', value: ([, n]) => n }],
    },
    {
      name: 'Businesses by category',
      rows: d.categoryMix,
      columns: [{ header: 'Top-level category', width: 28, value: (r) => r.name }, { header: 'Live businesses', width: 16, type: 'number', value: (r) => r.companies }],
    },
    {
      name: 'Applications by status',
      rows: Object.entries(d.totals.applicationsByStatus),
      columns: [{ header: 'Status', width: 20, value: ([s]) => APPLICATION_STATUS_TEXT[s] ?? s }, { header: 'Applications', width: 14, type: 'number', value: ([, n]) => n }],
    },
  ]);
});

// ----- Audit log -----

router.get(
  '/audit',
  validate({ query: pagination.extend({ entityType: z.string().regex(/^[a-z_]+$/).max(40).optional(), entityId: objectId.optional(), actorId: objectId.optional(), action: z.string().regex(/^[a-z_.]+$/).max(60).optional() }).strict() }),
  async (req, res) => {
    const { page, limit, ...rest } = req.valid.query;
    const filter = Object.fromEntries(Object.entries(rest).filter(([, v]) => v));
    const [rows, total] = await Promise.all([AuditEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditEvent.countDocuments(filter)]);
    const actors = new Map((await User.find({ _id: { $in: rows.map((r) => r.actorId).filter(Boolean) } }, { email: 1, displayName: 1 }).lean()).map((u) => [u._id.toString(), u]));
    res.json({
      data: rows.map((r) => ({
        id: r._id.toString(),
        at: r.createdAt,
        actorType: r.actorType,
        actor: r.actorId ? { id: r.actorId.toString(), label: actors.get(r.actorId.toString())?.email ?? null } : null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId?.toString() ?? null,
        companyId: r.companyId?.toString() ?? null,
        reason: r.reason ?? null,
        metadata: r.metadata ?? {},
        requestId: r.requestId ?? null,
      })),
      meta: pageMeta(req.valid.query, total),
    });
  },
);

export default router;
