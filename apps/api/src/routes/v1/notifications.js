import { Router } from 'express';
import { z } from 'zod';
import { objectId, pageMeta, pagination, validate } from '../../lib/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { DeviceToken, Notification } from '../../models/index.js';

const router = Router();
router.use(requireAuth);

const serialize = (n) => ({ id: n._id.toString(), type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, read: Boolean(n.readAt), createdAt: n.createdAt });

router.get('/', validate({ query: pagination.strict() }), async (req, res) => {
  const { page, limit } = req.valid.query;
  const filter = { recipientId: req.auth.user._id };
  const [rows, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...filter, readAt: null }),
  ]);
  res.json({ data: rows.map(serialize), meta: { ...pageMeta(req.valid.query, total), unread } });
});

router.get('/unread-count', async (req, res) => {
  res.json({ data: { unread: await Notification.countDocuments({ recipientId: req.auth.user._id, readAt: null }) } });
});

router.post('/:id/read', validate({ params: z.object({ id: objectId }).strict() }), async (req, res) => {
  await Notification.updateOne({ _id: req.valid.params.id, recipientId: req.auth.user._id, readAt: null }, { $set: { readAt: new Date() } });
  res.status(204).end();
});

router.post('/read-all', async (req, res) => {
  await Notification.updateMany({ recipientId: req.auth.user._id, readAt: null }, { $set: { readAt: new Date() } });
  res.status(204).end();
});

// Push device registration. A token is bound to one user at a time; re-registering moves it.
router.post(
  '/devices',
  validate({ body: z.object({ token: z.string().regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,100}\]$/, 'Invalid push token'), platform: z.enum(['ios', 'android']) }).strict() }),
  async (req, res) => {
    const { token, platform } = req.valid.body;
    await DeviceToken.findOneAndUpdate(
      { token },
      { $set: { userId: req.auth.user._id, platform, lastSeenAt: new Date(), disabledAt: null } },
      { upsert: true },
    );
    res.status(204).end();
  },
);

router.delete('/devices', validate({ body: z.object({ token: z.string().max(200) }).strict() }), async (req, res) => {
  await DeviceToken.deleteOne({ token: req.valid.body.token, userId: req.auth.user._id });
  res.status(204).end();
});

export default router;
