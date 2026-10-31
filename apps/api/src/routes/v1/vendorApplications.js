import { Router } from 'express';
import { z } from 'zod';
import { ipFingerprint } from '../../lib/crypto.js';
import { normalizePhone } from '../../lib/phone.js';
import { countryCode, email, objectId, text, validate } from '../../lib/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { Category, VendorApplication } from '../../models/index.js';
import { queueDirectEmail } from '../../services/notifications.js';

const router = Router();

const applicationBody = z
  .object({
    businessName: text(120, { min: 2 }),
    contactName: text(80, { min: 2 }),
    email,
    phone: z.string().trim().max(32).optional(),
    website: z.url({ protocol: /^https?$/ }).max(200).optional(),
    categoryIds: z.array(objectId).max(5).default([]),
    description: text(2000, { min: 20, multiline: true }),
    address: z
      .object({ line1: text(120).optional(), city: text(80, { min: 1 }), region: text(80).optional(), postalCode: text(12).optional(), country: countryCode })
      .strict(),
    serviceMode: z.enum(['fixed', 'mobile', 'both']).default('fixed'),
    // Honeypot: real users never see or fill this field.
    company_website: z.string().max(200).optional(),
  })
  .strict();

router.post(
  '/',
  rateLimit({ name: 'vendor-application', windowMs: 60 * 60 * 1000, max: 5, failClosed: true }),
  validate({ body: applicationBody }),
  async (req, res) => {
    const { company_website: honeypot, ...body } = req.valid.body;
    const accepted = { data: { message: 'Thanks! Your application was received. We will email you after review.' } };
    if (honeypot) return res.status(202).json(accepted);

    const phone = body.phone ? normalizePhone(body.phone, body.address.country) : undefined;
    const categoryIds = (await Category.find({ _id: { $in: body.categoryIds }, isActive: true }, { _id: 1 }).lean()).map((c) => c._id);
    // One open application per email; repeats are acknowledged without creating duplicates.
    const open = await VendorApplication.exists({ email: body.email, status: { $in: ['submitted', 'under_review'] } });
    if (!open) {
      const app = await VendorApplication.create({ ...body, phone, categoryIds, ipHash: ipFingerprint(req.ip) });
      await queueDirectEmail({ toEmail: app.email, template: 'application_received', payload: { businessName: app.businessName }, dedupeKey: `application:${app._id}:received` });
    }
    return res.status(202).json(accepted);
  },
);

export default router;
