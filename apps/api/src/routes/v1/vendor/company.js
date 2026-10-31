import { Router } from 'express';
import multer from 'multer';
import { PROFILE_SECTIONS } from '@townant/shared';
import { z } from 'zod';
import { AppError, unprocessable } from '../../../lib/errors.js';
import { normalizePhone } from '../../../lib/phone.js';
import { isValidZone, minutesOf } from '../../../lib/time.js';
import { countryCode, email, hhmm, isoDate, objectId, text, validate } from '../../../lib/validate.js';
import { requirePermission } from '../../../middleware/auth.js';
import { rateLimit } from '../../../middleware/rateLimit.js';
import { Category, Company, Membership, Service, User } from '../../../models/index.js';
import { audit } from '../../../services/audit.js';
import { companyForOwner, rebuildSearchText } from '../../../services/catalog.js';
import { deleteImage, MAX_GALLERY_IMAGES, MAX_IMAGE_BYTES, uploadCompanyImage } from '../../../services/media.js';

const router = Router();

router.get('/context', async (req, res) => {
  const memberships = await Membership.find({ userId: req.auth.user._id, status: 'active' }).lean();
  const companies = await Company.find({ _id: { $in: memberships.map((m) => m.companyId) } }, { name: 1, status: 1 }).lean();
  res.json({
    data: {
      user: req.auth.user.toSelf(),
      role: req.vendor.membership.role,
      permissions: req.vendor.permissions,
      company: companyForOwner(req.vendor.company),
      companies: companies.map((c) => ({ id: c._id.toString(), name: c.name, status: c.status })),
    },
  });
});

const profileBody = z
  .object({
    name: text(120, { min: 2 }).optional(),
    summary: text(300).optional(),
    description: text(4000, { multiline: true }).optional(),
    categoryIds: z.array(objectId).min(1).max(5).optional(),
    primaryCategoryId: objectId.optional(),
    contact: z
      .object({ email: email.optional().or(z.literal('')), phone: z.string().trim().max(32).optional(), website: z.url({ protocol: /^https?$/ }).max(200).optional().or(z.literal('')) })
      .strict()
      .optional(),
    address: z
      .object({
        line1: text(120).optional(),
        line2: text(120).optional(),
        area: text(80).optional(),
        city: text(80, { min: 1 }),
        region: text(80).optional(),
        postalCode: z.string().trim().toUpperCase().max(12).optional(),
        country: countryCode,
      })
      .strict()
      .optional(),
    location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict().nullable().optional(),
    serviceMode: z.enum(['fixed', 'mobile', 'both']).optional(),
    serviceArea: z
      .object({ radiusKm: z.number().min(1).max(500).optional(), postalCodes: z.array(z.string().trim().toUpperCase().max(12)).max(100).optional() })
      .strict()
      .optional(),
    sections: z.object(Object.fromEntries(PROFILE_SECTIONS.map((s) => [s, z.boolean().optional()]))).strict().optional(),
    policies: z.object({ cancellation: text(1500, { multiline: true }) }).strict().optional(),
    bookingPolicy: z
      .object({
        cancellationCutoffHours: z.number().int().min(0).max(168).optional(),
        rescheduleCutoffHours: z.number().int().min(0).max(168).optional(),
        requestExpiryHours: z.number().int().min(1).max(168).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Explicit field mapping: the body is never merged into the document wholesale.
router.patch('/company', requirePermission('company:write'), validate({ body: profileBody }), async (req, res) => {
  const b = req.valid.body;
  const company = req.vendor.company;
  if (b.categoryIds) {
    const found = await Category.countDocuments({ _id: { $in: b.categoryIds }, isActive: true });
    if (found !== new Set(b.categoryIds).size) throw unprocessable('INVALID_CATEGORY', 'Choose categories from the list.');
    company.categoryIds = b.categoryIds;
  }
  if (b.primaryCategoryId) {
    if (!company.categoryIds.map(String).includes(b.primaryCategoryId)) throw unprocessable('INVALID_CATEGORY', 'The main category must be one of your categories.');
    company.primaryCategoryId = b.primaryCategoryId;
  } else if (b.categoryIds && !b.categoryIds.includes(company.primaryCategoryId?.toString())) {
    company.primaryCategoryId = b.categoryIds[0];
  }
  for (const key of ['name', 'summary', 'description', 'serviceMode']) if (b[key] !== undefined) company[key] = b[key];
  if (b.contact) {
    company.contact = {
      email: b.contact.email || undefined,
      phone: b.contact.phone ? normalizePhone(b.contact.phone, b.address?.country ?? company.address?.country) : undefined,
      website: b.contact.website || undefined,
    };
  }
  if (b.address) company.address = b.address;
  if (b.location !== undefined) company.location = b.location ? { type: 'Point', coordinates: [b.location.lng, b.location.lat] } : undefined;
  for (const group of ['serviceArea', 'policies', 'bookingPolicy']) {
    for (const [k, v] of Object.entries(b[group] ?? {})) company.set(`${group}.${k}`, v);
  }
  if (b.sections) {
    company.sections = { ...company.sections, ...b.sections };
    company.markModified('sections');
  }
  await company.save();
  await rebuildSearchText(company._id);
  await audit(req, { action: 'company.update', entityType: 'company', entityId: company._id, companyId: company._id, metadata: { fields: Object.keys(b) } });
  res.json({ data: companyForOwner(await Company.findById(company._id)) });
});

const intervalList = z
  .array(z.object({ start: hhmm, end: hhmm }).strict())
  .max(4)
  .refine((list) => {
    const sorted = [...list].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
    return sorted.every((iv, i) => minutesOf(iv.start) < minutesOf(iv.end) && (i === 0 || minutesOf(sorted[i - 1].end) <= minutesOf(iv.start)));
  }, 'Opening hours must not overlap and must end after they start');

const availabilityBody = z
  .object({
    timezone: z.string().refine(isValidZone, 'Unknown time zone'),
    weekly: z.array(intervalList).length(7),
    exceptions: z.array(z.object({ date: isoDate, closed: z.boolean(), intervals: intervalList.default([]), note: text(120).optional() }).strict()).max(200).default([]),
    slotIntervalMinutes: z.union([5, 10, 15, 20, 30, 45, 60, 90, 120].map((n) => z.literal(n))),
    bufferMinutes: z.number().int().min(0).max(240).multipleOf(5),
    minNoticeMinutes: z.number().int().min(0).max(10080),
    maxAdvanceDays: z.number().int().min(1).max(365),
  })
  .strict();

// Changing hours does not cancel existing bookings; they keep their reserved time.
router.put('/company/availability', requirePermission('availability:write'), validate({ body: availabilityBody }), async (req, res) => {
  const b = req.valid.body;
  const sortDay = (d) => [...d].sort((x, y) => minutesOf(x.start) - minutesOf(y.start));
  const company = req.vendor.company;
  company.availability = {
    ...b,
    weekly: b.weekly.map(sortDay),
    exceptions: [...new Map(b.exceptions.map((e) => [e.date, { ...e, intervals: e.closed ? [] : sortDay(e.intervals) }])).values()].sort((x, y) => x.date.localeCompare(y.date)),
  };
  await company.save();
  await audit(req, { action: 'company.availability_update', entityType: 'company', entityId: company._id, companyId: company._id });
  res.json({ data: companyForOwner(company) });
});

// Publishing requires the minimum a customer needs to book.
router.post('/company/publish', requirePermission('company:write'), async (req, res) => {
  const company = req.vendor.company;
  const missing = [];
  if (!company.primaryCategoryId) missing.push('a main category');
  if (!company.address?.city) missing.push('a city');
  if (!(await Service.exists({ companyId: company._id, isActive: true, archivedAt: null }))) missing.push('at least one active service');
  if (!company.availability.weekly.some((d) => d.length)) missing.push('opening hours');
  if (missing.length) throw unprocessable('PROFILE_INCOMPLETE', `Add ${missing.join(', ')} before publishing.`, { missing });
  const updated = await Company.findOneAndUpdate({ _id: company._id, status: 'draft' }, { $set: { status: 'published', publishedAt: company.publishedAt ?? new Date() } }, { new: true });
  if (!updated) throw new AppError(409, 'INVALID_STATUS', 'This business cannot be published in its current state.');
  await audit(req, { action: 'company.publish', entityType: 'company', entityId: company._id, companyId: company._id });
  res.json({ data: companyForOwner(updated) });
});

router.post('/company/unpublish', requirePermission('company:write'), async (req, res) => {
  const updated = await Company.findOneAndUpdate({ _id: req.vendor.company._id, status: 'published' }, { $set: { status: 'draft' } }, { new: true });
  if (!updated) throw new AppError(409, 'INVALID_STATUS', 'This business is not published.');
  await audit(req, { action: 'company.unpublish', entityType: 'company', entityId: updated._id, companyId: updated._id });
  res.json({ data: companyForOwner(updated) });
});

// Registered before /company/media/:kind so "remove" is not treated as a kind.
router.post(
  '/company/media/remove',
  requirePermission('media:write'),
  validate({ body: z.object({ kind: z.enum(['logo', 'banner', 'gallery']), publicId: z.string().max(200).optional() }).strict() }),
  async (req, res) => {
    const { kind, publicId } = req.valid.body;
    const company = req.vendor.company;
    let removed;
    if (kind === 'gallery') {
      removed = company.media.gallery.find((m) => m.publicId === publicId)?.publicId;
      if (!removed) throw unprocessable('NOT_FOUND', 'Photo not found.');
      await Company.updateOne({ _id: company._id }, { $pull: { 'media.gallery': { publicId: removed } } });
    } else {
      removed = company.media?.[kind]?.publicId;
      await Company.updateOne({ _id: company._id }, { $unset: { [`media.${kind}`]: 1 } });
    }
    await deleteImage(removed);
    res.json({ data: companyForOwner(await Company.findById(company._id)) });
  },
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 2 } });

router.post(
  '/company/media/:kind',
  requirePermission('media:write'),
  rateLimit({ name: 'media-upload', windowMs: 60 * 60 * 1000, max: 40, key: (req) => req.vendor.company._id.toString() }),
  validate({ params: z.object({ kind: z.enum(['logo', 'banner', 'gallery']) }).strict() }),
  upload.single('file'),
  async (req, res) => {
    const { kind } = req.valid.params;
    const company = req.vendor.company;
    if (kind === 'gallery' && company.media.gallery.length >= MAX_GALLERY_IMAGES) {
      throw unprocessable('GALLERY_FULL', `The gallery holds up to ${MAX_GALLERY_IMAGES} photos. Remove one first.`);
    }
    const image = await uploadCompanyImage({ companyId: company._id, kind, file: req.file, userId: req.auth.user._id });
    let replaced;
    if (kind === 'gallery') {
      const updated = await Company.updateOne(
        { _id: company._id, [`media.gallery.${MAX_GALLERY_IMAGES - 1}`]: { $exists: false } },
        { $push: { 'media.gallery': image } },
      );
      if (!updated.modifiedCount) {
        await deleteImage(image.publicId);
        throw unprocessable('GALLERY_FULL', `The gallery holds up to ${MAX_GALLERY_IMAGES} photos.`);
      }
    } else {
      replaced = company.media?.[kind]?.publicId;
      await Company.updateOne({ _id: company._id }, { $set: { [`media.${kind}`]: image } });
    }
    if (replaced) await deleteImage(replaced);
    await audit(req, { action: 'company.media_upload', entityType: 'company', entityId: company._id, companyId: company._id, metadata: { kind } });
    res.status(201).json({ data: companyForOwner(await Company.findById(company._id)) });
  },
);

router.get('/team', requirePermission('company:write'), async (req, res) => {
  const members = await Membership.find({ companyId: req.vendor.company._id, status: 'active' }).lean();
  const users = new Map((await User.find({ _id: { $in: members.map((m) => m.userId) } }, { displayName: 1, email: 1, status: 1 }).lean()).map((u) => [u._id.toString(), u]));
  res.json({
    data: members.map((m) => {
      const u = users.get(m.userId.toString());
      return { userId: m.userId.toString(), role: m.role, name: u?.displayName ?? null, email: u?.email ?? null, status: u?.status ?? 'unknown' };
    }),
  });
});

export default router;
