import { Router } from 'express';
import { forbidden, unauthorized } from '../../../lib/errors.js';
import { requireVendor } from '../../../middleware/auth.js';
import { Company, Membership } from '../../../models/index.js';
import { rateLimit } from '../../../middleware/rateLimit.js';
import company from './company.js';
import operations from './operations.js';
import support from './support.js';

const router = Router();

// Lists the caller's own businesses so a multi-business user can choose one. Needs no
// company selection, and only ever returns companies the caller is a member of.
router.get('/companies', async (req, res) => {
  if (!req.auth) throw unauthorized();
  if (req.auth.user.role !== 'vendor') throw forbidden();
  const memberships = await Membership.find({ userId: req.auth.user._id, status: 'active' }).lean();
  const companies = await Company.find({ _id: { $in: memberships.map((m) => m.companyId) }, status: { $ne: 'deleted' } }, { name: 1, status: 1 }).lean();
  res.json({ data: companies.map((c) => ({ id: c._id.toString(), name: c.name, status: c.status, role: memberships.find((m) => m.companyId.equals(c._id)).role })) });
});

// Support has its own vendor guard (it stays writable for suspended businesses).
router.use(support);

router.use(requireVendor);
router.use(rateLimit({ name: 'vendor-api', windowMs: 60 * 1000, max: 300, key: (req) => req.auth.user._id.toString() }));
router.use(company);
router.use(operations);

export default router;
