import { Router } from 'express';
import { z } from 'zod';
import { ipFingerprint } from '../../lib/crypto.js';
import { notFound } from '../../lib/errors.js';
import { countryCode, isoDate, objectId, pageMeta, pagination, text, validate } from '../../lib/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { Review, Service } from '../../models/index.js';
import { track } from '../../services/analytics.js';
import { availabilitySummary, availableSlots, serializeSlot } from '../../services/availability.js';
import { collections, findPublishedCompany, mostBooked, POPULAR_MIN_BOOKINGS, POPULAR_WINDOW_DAYS, publicCategories, publicProfile, searchCompanies, spotlight } from '../../services/catalog.js';
import { hit } from '../../services/rateLimit.js';
import { serializeReview } from '../../services/reviews.js';
import { publicSite } from '../../services/site.js';

const router = Router();
const MIN = 60 * 1000;

router.use(rateLimit({ name: 'catalog', windowMs: MIN, max: 120 }));

// Super Admin edits (names, images, publishing) must reach customers on their next page load, and a
// replaced image's old asset is deleted, so a cached response would point at a missing file. `no-cache`
// makes browsers revalidate every time; the ETag turns an unchanged response into a cheap 304.
const REVALIDATE = 'public, no-cache';

router.get('/categories', async (_req, res) => {
  res.set('Cache-Control', REVALIDATE);
  res.json({ data: await publicCategories() });
});

// Public site configuration managed by Super Admins (homepage hero image and promotional banner).
router.get('/site', async (_req, res) => {
  res.set('Cache-Control', REVALIDATE);
  res.json({ data: await publicSite() });
});

export const searchQuery = pagination.extend({
  q: text(100).optional(),
  category: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,60}$/).optional(),
  country: countryCode.optional(),
  region: text(80).optional(),
  city: text(80).optional(),
  postalCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9 -]{2,12}$/).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(200).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  availableOn: isoDate.optional(),
  sort: z.enum(['relevance', 'rating', 'newest']).default('relevance'),
});

const limitQuery = (max, fallback) => z.object({ limit: z.coerce.number().int().min(1).max(max).default(fallback) }).strict();
// Location parameters accepted by the homepage rows; same rules as search.
const locationQuery = searchQuery.pick({ country: true, region: true, city: true, postalCode: true, lat: true, lng: true, radiusKm: true });
const pickLocation = ({ country, region, city, postalCode, lat, lng, radiusKm }) => ({ country, region, city, postalCode, lat, lng, radiusKm });

router.get('/spotlight', validate({ query: limitQuery(12, 6) }), async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ data: await spotlight(req.valid.query.limit) });
});

router.get('/most-booked', validate({ query: limitQuery(12, 8).extend(locationQuery.shape).strict() }), async (req, res) => {
  const location = pickLocation(req.valid.query);
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    data: await mostBooked(req.valid.query.limit, location),
    meta: { windowDays: POPULAR_WINDOW_DAYS, minBookings: POPULAR_MIN_BOOKINGS, basis: 'confirmed or completed bookings', area: Object.values(location).some((v) => v !== undefined) },
  });
});

router.get(
  '/collections',
  validate({ query: z.object({ categories: z.coerce.number().int().min(1).max(8).default(4), perCategory: z.coerce.number().int().min(1).max(12).default(8), ...locationQuery.shape }).strict() }),
  async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ data: await collections({ maxCategories: req.valid.query.categories, perCategory: req.valid.query.perCategory, location: pickLocation(req.valid.query) }) });
  },
);

router.get('/companies', validate({ query: searchQuery.strict() }), async (req, res) => {
  const params = req.valid.query;
  const { items, total } = await searchCompanies(params);
  res.json({ data: items, meta: pageMeta(params, total) });
});

async function loadCompany(req) {
  const company = await findPublishedCompany(req.params.slug);
  if (!company) throw notFound('Business not found.');
  return company;
}

const slugParam = z.object({ slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$|^[a-f0-9]{24}$/i) }).strict();

router.get('/companies/:slug', validate({ params: slugParam }), async (req, res) => {
  const company = await loadCompany(req);
  res.json({ data: await publicProfile(company) });
});

router.get('/companies/:slug/services', validate({ params: slugParam }), async (req, res) => {
  const company = await loadCompany(req);
  const services = await Service.find({ companyId: company._id, isActive: true, archivedAt: null }).sort({ sortOrder: 1, createdAt: 1 });
  res.json({ data: services.map((s) => s.toPublic()) });
});

router.get('/companies/:slug/reviews', validate({ params: slugParam, query: pagination.strict() }), async (req, res) => {
  const company = await loadCompany(req);
  if (company.sections?.reviews === false) return res.json({ data: [], meta: pageMeta(req.valid.query, 0) });
  const { page, limit } = req.valid.query;
  const filter = { companyId: company._id, status: 'published', authorPendingDeletion: { $ne: true } };
  const [rows, total] = await Promise.all([Review.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Review.countDocuments(filter)]);
  return res.json({ data: rows.map((r) => serializeReview(r)), meta: pageMeta(req.valid.query, total) });
});

async function loadService(company, serviceId) {
  const service = await Service.findOne({ _id: serviceId, companyId: company._id, isActive: true, archivedAt: null });
  if (!service) throw notFound('Service not found.');
  return service;
}

// Open slots for one day. Advisory only: the booking endpoint re-checks at commit time.
router.get(
  '/companies/:slug/slots',
  validate({ params: slugParam, query: z.object({ serviceId: objectId, date: isoDate }).strict() }),
  async (req, res) => {
    const company = await loadCompany(req);
    const service = await loadService(company, req.valid.query.serviceId);
    const slots = await availableSlots({ company, service, date: req.valid.query.date });
    res.set('Cache-Control', 'no-store');
    res.json({ data: { timezone: company.availability.timezone, date: req.valid.query.date, slots: slots.map((s) => serializeSlot(s, company.availability.timezone)) } });
  },
);

router.get(
  '/companies/:slug/availability',
  validate({ params: slugParam, query: z.object({ serviceId: objectId, from: isoDate, days: z.coerce.number().int().min(1).max(31).default(14) }).strict() }),
  async (req, res) => {
    const company = await loadCompany(req);
    const service = await loadService(company, req.valid.query.serviceId);
    const days = await availabilitySummary({ company, service, from: req.valid.query.from, days: req.valid.query.days });
    res.set('Cache-Control', 'no-store');
    res.json({ data: { timezone: company.availability.timezone, days } });
  },
);

// Counts a profile view at most once per visitor (IP fingerprint) per business per 30 minutes.
router.post('/companies/:slug/view', validate({ params: slugParam }), async (req, res) => {
  const company = await loadCompany(req);
  const result = await hit(`view:${company._id}:${ipFingerprint(req.ip)}`, { windowMs: 30 * MIN, max: 1 }).catch(() => null);
  if (result?.allowed) await track('profile_view', { companyId: company._id, categoryId: company.primaryCategoryId });
  res.status(204).end();
});

export default router;
