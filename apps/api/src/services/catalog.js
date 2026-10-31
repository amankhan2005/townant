import { BOOKING_STATUS } from '@townant/shared';
import mongoose from 'mongoose';
import { todayIn } from '../lib/time.js';
import { escapeRegex } from '../lib/validate.js';
import { Booking, Category, Company, Service } from '../models/index.js';
import { availabilitySummary } from './availability.js';
import { deletionInfo } from './companyLifecycle.js';

export async function rebuildSearchText(companyId, session) {
  const opts = session ? { session } : undefined;
  const company = await Company.findById(companyId, null, opts);
  if (!company) return;
  const [categories, services] = await Promise.all([
    Category.find({ _id: { $in: company.categoryIds } }, { name: 1 }, opts).lean(),
    Service.find({ companyId, archivedAt: null, isActive: true }, { title: 1 }, opts).lean(),
  ]);
  const parts = [
    company.name,
    company.summary,
    ...categories.map((c) => c.name),
    ...services.map((s) => s.title),
    company.address?.area,
    company.address?.city,
    company.address?.region,
    company.address?.postalCode,
  ];
  company.searchText = parts.filter(Boolean).join(' ').toLowerCase().slice(0, 4000);
  await company.save(opts);
}

// Only published (active) categories are named on public cards; a business whose category was
// unpublished stays listed but no longer shows that category.
async function categoryMap(ids) {
  const cats = await Category.find({ _id: { $in: ids }, isActive: true }).lean();
  return new Map(cats.map((c) => [c._id.toString(), { id: c._id.toString(), name: c.name, slug: c.slug }]));
}

const media = (m) => (m ? { url: m.url, width: m.width ?? null, height: m.height ?? null } : null);

// "New" means published on TownAnt within the last 30 days. Defined here so every client agrees.
export const NEW_WINDOW_DAYS = 30;
const isNew = (c) => Boolean(c.publishedAt) && Date.now() - new Date(c.publishedAt).getTime() < NEW_WINDOW_DAYS * 86400000;

export function companyCard(c, cats, distanceMeters) {
  const primary = cats.get(c.primaryCategoryId?.toString() ?? c.categoryIds?.[0]?.toString());
  return {
    id: c._id.toString(),
    slug: c.slug,
    name: c.name,
    summary: c.summary,
    verified: c.verified,
    category: primary ?? null,
    logo: media(c.media?.logo),
    cover: media(c.media?.banner ?? c.media?.gallery?.[0]),
    rating: c.sections?.reviews === false ? null : { average: Math.round(c.ratingAvg * 10) / 10, count: c.ratingCount },
    location: { area: c.address?.area ?? null, city: c.address?.city ?? null, region: c.address?.region ?? null, country: c.address?.country ?? null },
    serviceMode: c.serviceMode,
    isNew: isNew(c),
    // Only present when both sides have coordinates and the query was geographic.
    distanceKm: typeof distanceMeters === 'number' ? Math.round(distanceMeters / 100) / 10 : null,
  };
}

// Public profile. Sections the vendor switched off are omitted entirely, not just hidden.
export async function publicProfile(c) {
  const cats = await categoryMap(c.categoryIds ?? []);
  const s = c.sections ?? {};
  return {
    ...companyCard(c, cats),
    description: c.description,
    // Needed to show and book slots even when the hours section is hidden.
    timezone: c.availability.timezone,
    categories: [...cats.values()],
    banner: media(c.media?.banner),
    gallery: s.gallery === false ? null : (c.media?.gallery ?? []).map(media),
    hours:
      s.hours === false
        ? null
        : { timezone: c.availability.timezone, weekly: c.availability.weekly, exceptions: (c.availability.exceptions ?? []).filter((e) => e.date >= todayIn(c.availability.timezone)) },
    contact: s.contact === false ? null : { email: c.contact?.email ?? null, phone: c.contact?.phone ?? null, website: c.contact?.website ?? null },
    address:
      s.contact === false || c.serviceMode === 'mobile'
        ? { city: c.address?.city ?? null, region: c.address?.region ?? null, country: c.address?.country ?? null }
        : c.address,
    serviceArea: c.serviceMode === 'fixed' ? null : c.serviceArea,
    policies: s.policies === false ? null : { cancellation: c.policies?.cancellation || null },
    bookingPolicy: c.bookingPolicy,
    sections: s,
  };
}

async function categoryFilterIds(slug) {
  const root = await Category.findOne({ slug, isActive: true }).lean();
  if (!root) return null;
  const children = await Category.find({ parentId: root._id, isActive: true }, { _id: 1 }).lean();
  return [root._id, ...children.map((c) => c._id)];
}

const EARTH_RADIUS_KM = 6378.1;
export const DEFAULT_RADIUS_KM = 25;
// Largest service radius a vendor can set (routes/v1/vendor/company.js).
const MAX_SERVICE_RADIUS_KM = 500;

// Adds the caller's location to a Company filter. Geographic queries match businesses whose
// coordinates fall inside the radius; place queries match the address, and a postal code also
// matches mobile businesses that list it in their service area. Returns whether a location
// constraint was applied.
export function applyLocation(filter, { country, region, city, postalCode, lat, lng, radiusKm } = {}, { geo = true } = {}) {
  const and = [];
  if (geo && typeof lat === 'number' && typeof lng === 'number') {
    and.push({ location: { $geoWithin: { $centerSphere: [[lng, lat], (radiusKm ?? DEFAULT_RADIUS_KM) / EARTH_RADIUS_KM] } } });
  }
  if (country) and.push({ 'address.country': country });
  if (region) and.push({ 'address.region': { $regex: `^${escapeRegex(region)}$`, $options: 'i' } });
  if (city) and.push({ 'address.city': { $regex: `^${escapeRegex(city)}$`, $options: 'i' } });
  if (postalCode) and.push({ $or: [{ 'address.postalCode': postalCode }, { 'serviceArea.postalCodes': postalCode }] });
  if (and.length) filter.$and = [...(filter.$and ?? []), ...and];
  return and.length > 0;
}

const SORTS = {
  rating: { ratingAvg: -1, ratingCount: -1, _id: 1 },
  newest: { publishedAt: -1, _id: 1 },
  relevance: { ratingCount: -1, ratingAvg: -1, _id: 1 },
};

// Keyword/location/category search over published companies. All inputs arrive validated
// as scalars; keyword tokens are regex-escaped.
export async function searchCompanies(params) {
  const { q, category, country, region, city, postalCode, lat, lng, radiusKm, minRating, availableOn, sort, page, limit } = params;
  const filter = { status: 'published' };

  if (category) {
    const ids = await categoryFilterIds(category);
    if (!ids) return { items: [], total: 0 };
    filter.categoryIds = { $in: ids };
  }
  if (q) {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    filter.$and = tokens.map((t) => ({ searchText: { $regex: escapeRegex(t) } }));
  }
  // Coordinates are handled by $geoNear below so results carry a real distance.
  applyLocation(filter, { country, region, city, postalCode }, { geo: false });
  if (minRating) filter.ratingAvg = { $gte: minRating };

  const geo = typeof lat === 'number' && typeof lng === 'number';
  const radius = radiusKm ?? DEFAULT_RADIUS_KM;
  // The date filter needs per-company slot computation, so it scans a bounded candidate set.
  const candidateLimit = availableOn ? 100 : limit;
  const skip = availableOn ? 0 : (page - 1) * limit;

  let rows;
  let total;
  if (geo) {
    // A business is "near" when it is inside the customer's radius, or when it travels to
    // customers (mobile / both) and its own service radius reaches the customer.
    const pipeline = [
      { $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'distanceMeters', maxDistance: Math.max(radius, MAX_SERVICE_RADIUS_KM) * 1000, query: filter, spherical: true } },
      {
        $match: {
          $or: [
            { distanceMeters: { $lte: radius * 1000 } },
            { serviceMode: { $in: ['mobile', 'both'] }, $expr: { $lte: ['$distanceMeters', { $multiply: [{ $ifNull: ['$serviceArea.radiusKm', 0] }, 1000] }] } },
          ],
        },
      },
    ];
    if (sort === 'rating') pipeline.push({ $sort: SORTS.rating });
    const [facet] = await Company.aggregate([...pipeline, { $facet: { rows: [{ $skip: skip }, { $limit: candidateLimit }], total: [{ $count: 'n' }] } }]);
    rows = facet.rows;
    total = facet.total[0]?.n ?? 0;
  } else {
    [rows, total] = await Promise.all([
      Company.find(filter).sort(SORTS[sort] ?? SORTS.relevance).skip(skip).limit(candidateLimit).lean(),
      Company.countDocuments(filter),
    ]);
  }

  if (availableOn) {
    rows = await filterByAvailability(rows, availableOn);
    total = rows.length;
    rows = rows.slice((page - 1) * limit, page * limit);
  }

  const cats = await categoryMap(rows.flatMap((r) => [r.primaryCategoryId, ...(r.categoryIds ?? [])]).filter(Boolean));
  return { items: await withPriceFrom(rows.map((r) => companyCard(r, cats, r.distanceMeters))), total };
}

// "From $35" for business cards: the lowest price among the business's active services whose price
// the vendor shows as fixed or "from". Hidden and quote-only prices never contribute, so a card
// shows no price unless the business has published one. One query per page of cards.
export async function withPriceFrom(cards) {
  if (!cards.length) return cards;
  const rows = await Service.aggregate([
    { $match: { companyId: { $in: cards.map((c) => new mongoose.Types.ObjectId(c.id)) }, isActive: true, archivedAt: null, 'price.display': { $in: ['fixed', 'from'] }, 'price.amount': { $type: 'number' } } },
    { $sort: { 'price.amount': 1 } },
    { $group: { _id: '$companyId', amount: { $first: '$price.amount' }, currency: { $first: '$price.currency' } } },
  ]);
  const from = new Map(rows.map((r) => [r._id.toString(), { amount: r.amount, currency: r.currency || 'USD' }]));
  return cards.map((c) => ({ ...c, priceFrom: from.get(c.id) ?? null }));
}

async function filterByAvailability(companies, date) {
  const services = await Service.find({ companyId: { $in: companies.map((c) => c._id) }, isActive: true, archivedAt: null }, { companyId: 1, durationMinutes: 1 })
    .sort({ durationMinutes: 1 })
    .lean();
  const shortest = new Map();
  for (const s of services) if (!shortest.has(s.companyId.toString())) shortest.set(s.companyId.toString(), s);
  const out = [];
  for (const c of companies) {
    const service = shortest.get(c._id.toString());
    if (!service) continue;
    const [day] = await availabilitySummary({ company: c, service, from: date, days: 1 });
    if (day.openSlots > 0) out.push(c);
  }
  return out;
}

export async function findPublishedCompany(slugOrId) {
  const filter = mongoose.isValidObjectId(slugOrId) && /^[a-f0-9]{24}$/i.test(slugOrId) ? { _id: slugOrId } : { slug: slugOrId };
  return Company.findOne({ ...filter, status: 'published' });
}

export async function uniqueSlug(name, session) {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'business';
  let slug = base;
  for (let i = 2; await Company.exists({ slug }).session(session ?? null); i += 1) slug = `${base}-${i}`;
  return slug;
}

// Full record for the company's own team and for Super Admins.
export function companyForOwner(c) {
  return {
    id: c._id.toString(),
    name: c.name,
    slug: c.slug,
    status: c.status,
    verified: c.verified,
    suspensionReason: c.status === 'suspended' ? c.suspensionReason ?? null : null,
    publishedAt: c.publishedAt ?? null,
    primaryCategoryId: c.primaryCategoryId?.toString() ?? null,
    categoryIds: (c.categoryIds ?? []).map(String),
    summary: c.summary,
    description: c.description,
    contact: c.contact ?? {},
    address: c.address ?? {},
    location: c.location?.coordinates ? { lng: c.location.coordinates[0], lat: c.location.coordinates[1] } : null,
    serviceMode: c.serviceMode,
    serviceArea: c.serviceArea ?? {},
    media: {
      logo: c.media?.logo ? { publicId: c.media.logo.publicId, url: c.media.logo.url } : null,
      banner: c.media?.banner ? { publicId: c.media.banner.publicId, url: c.media.banner.url } : null,
      gallery: (c.media?.gallery ?? []).map((m) => ({ publicId: m.publicId, url: m.url })),
    },
    sections: c.sections,
    policies: c.policies,
    bookingPolicy: c.bookingPolicy,
    availability: c.availability,
    rating: { average: Math.round((c.ratingAvg ?? 0) * 10) / 10, count: c.ratingCount ?? 0 },
    spotlight: { active: Boolean(c.spotlight?.active), headline: c.spotlight?.headline ?? null, blurb: c.spotlight?.blurb ?? null },
    deletion: deletionInfo(c),
    createdAt: c.createdAt,
  };
}

const cardsFor = async (companies) => {
  const cats = await categoryMap(companies.flatMap((r) => [r.primaryCategoryId, ...(r.categoryIds ?? [])]).filter(Boolean));
  return withPriceFrom(companies.map((r) => companyCard(r, cats)));
};

// Published businesses a Super Admin has placed in the homepage spotlight, in the admin's order.
// Drafts and suspended businesses keep their placement but are never returned publicly.
export async function spotlight(limit) {
  const rows = await Company.find({ status: 'published', 'spotlight.active': true }).sort({ 'spotlight.order': 1, 'spotlight.updatedAt': -1, _id: 1 }).limit(limit).lean();
  const cards = await cardsFor(rows);
  return cards.map((card, i) => ({ ...card, spotlight: { headline: rows[i].spotlight.headline || null, blurb: rows[i].spotlight.blurb || null } }));
}

export const POPULAR_WINDOW_DAYS = 90;
// A business needs at least this many confirmed or completed bookings in the window before it
// can be presented as "most booked". One or two bookings do not substantiate the label.
export const POPULAR_MIN_BOOKINGS = 3;
const AREA_CANDIDATE_CAP = 2000;

// Published businesses ranked by confirmed or completed bookings created in the last 90 days,
// optionally restricted to the caller's area (see applyLocation). Counts are used for ordering
// only and are not returned, so business volumes aren't disclosed publicly.
export async function mostBooked(limit, location = {}) {
  const since = new Date(Date.now() - POPULAR_WINDOW_DAYS * 86400000);
  const match = { createdAt: { $gte: since }, status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED] } };
  const areaFilter = { status: 'published' };
  if (applyLocation(areaFilter, location)) {
    const inArea = await Company.find(areaFilter, { _id: 1 }).limit(AREA_CANDIDATE_CAP).lean();
    if (!inArea.length) return [];
    match.companyId = { $in: inArea.map((c) => c._id) };
  }
  const ranked = await Booking.aggregate([
    { $match: match },
    { $group: { _id: '$companyId', n: { $sum: 1 } } },
    { $match: { n: { $gte: POPULAR_MIN_BOOKINGS } } },
    { $sort: { n: -1, _id: 1 } },
    { $limit: limit * 3 },
  ]);
  const companies = new Map((await Company.find({ _id: { $in: ranked.map((r) => r._id) }, status: 'published' }).lean()).map((c) => [c._id.toString(), c]));
  const ordered = ranked.map((r) => companies.get(r._id.toString())).filter(Boolean).slice(0, limit);
  return cardsFor(ordered);
}

const categoryImage = (c) => (c.image?.url ? { url: c.image.url, width: c.image.width ?? null, height: c.image.height ?? null, alt: c.imageAlt || '' } : null);

// Homepage category rows: active top-level categories (Super Admin–managed) that have at least
// one published business (in the caller's area when one is given), each with its highest-rated
// businesses. Empty categories are skipped, so nothing is shown that customers can't book.
export async function collections({ maxCategories, perCategory, location = {} }) {
  // Super Admins can keep a published category off the homepage rows (showOnHomepage: false).
  const parents = await Category.find({ isActive: true, parentId: null, showOnHomepage: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).lean();
  const children = await Category.find({ isActive: true, parentId: { $in: parents.map((p) => p._id) } }, { _id: 1, parentId: 1 }).lean();
  const out = [];
  for (const parent of parents) {
    if (out.length >= maxCategories) break;
    const ids = [parent._id, ...children.filter((c) => c.parentId.equals(parent._id)).map((c) => c._id)];
    const filter = { status: 'published', categoryIds: { $in: ids } };
    applyLocation(filter, location);
    const rows = await Company.find(filter).sort(SORTS.rating).limit(perCategory).lean();
    if (rows.length) {
      out.push({
        category: { id: parent._id.toString(), name: parent.name, slug: parent.slug, icon: parent.icon ?? null, description: parent.description ?? null, image: categoryImage(parent) },
        items: await cardsFor(rows),
      });
    }
  }
  return out;
}

// Categories customers can browse: active, and (for sub-categories) under an active parent.
export async function publicCategories() {
  const cats = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
  const active = new Set(cats.map((c) => c._id.toString()));
  return cats.filter((c) => !c.parentId || active.has(c.parentId.toString())).map((c) => c.toPublic());
}
