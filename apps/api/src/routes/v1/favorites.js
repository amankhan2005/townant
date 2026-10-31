import { Router } from 'express';
import { z } from 'zod';
import { isDuplicateKey } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { objectId, validate } from '../../lib/validate.js';
import { requireCustomer } from '../../middleware/auth.js';
import { Category, Company, Favorite } from '../../models/index.js';
import { track } from '../../services/analytics.js';
import { companyCard } from '../../services/catalog.js';

const router = Router();
router.use(requireCustomer);

router.get('/', async (req, res) => {
  const favs = await Favorite.find({ userId: req.auth.user._id }).sort({ createdAt: -1 }).limit(200).lean();
  const companies = await Company.find({ _id: { $in: favs.map((f) => f.companyId) }, status: 'published' }).lean();
  const cats = new Map((await Category.find({ _id: { $in: companies.flatMap((c) => c.categoryIds) } }).lean()).map((c) => [c._id.toString(), { id: c._id.toString(), name: c.name, slug: c.slug }]));
  const byId = new Map(companies.map((c) => [c._id.toString(), c]));
  res.json({ data: favs.map((f) => byId.get(f.companyId.toString())).filter(Boolean).map((c) => companyCard(c, cats)) });
});

router.get('/ids', async (req, res) => {
  const favs = await Favorite.find({ userId: req.auth.user._id }, { companyId: 1 }).lean();
  res.json({ data: favs.map((f) => f.companyId.toString()) });
});

router.put('/:companyId', validate({ params: z.object({ companyId: objectId }).strict() }), async (req, res) => {
  const company = await Company.findOne({ _id: req.valid.params.companyId, status: 'published' }, { _id: 1, primaryCategoryId: 1 });
  if (!company) throw notFound('Business not found.');
  try {
    await Favorite.create({ userId: req.auth.user._id, companyId: company._id });
    await track('favorite_added', { companyId: company._id, categoryId: company.primaryCategoryId });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
  res.status(204).end();
});

router.delete('/:companyId', validate({ params: z.object({ companyId: objectId }).strict() }), async (req, res) => {
  await Favorite.deleteOne({ userId: req.auth.user._id, companyId: req.valid.params.companyId });
  res.status(204).end();
});

export default router;
