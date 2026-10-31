import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { escapeRegex, isoDate, objectId, pageMeta, pagination, text, validate } from '../../../lib/validate.js';
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, SUPPORT_STATUSES, SupportTicket, User } from '../../../models/index.js';
import { getTicket, requesterDetails, serializeMessages, serializeTicket, supportReply, supportUpdate } from '../../../services/support.js';
import { idParam } from '../supportShared.js';

// Super Admin support desk. Mounted behind requireAdmin (MFA-verified Super Admins only).
const router = Router();

const ALL_CATEGORIES = [...new Set([...SUPPORT_CATEGORIES.customer, ...SUPPORT_CATEGORIES.vendor])];

router.get('/support/meta', async (_req, res) => {
  const admins = await User.find({ role: 'super_admin', status: 'active' }, { displayName: 1, email: 1 }).sort({ email: 1 }).lean();
  const [awaitingSupport, unassigned] = await Promise.all([
    SupportTicket.countDocuments({ awaiting: 'support', status: { $nin: ['resolved', 'closed'] } }),
    SupportTicket.countDocuments({ assigneeId: null, status: { $nin: ['resolved', 'closed'] } }),
  ]);
  res.json({
    data: {
      categories: SUPPORT_CATEGORIES,
      statuses: SUPPORT_STATUSES,
      priorities: SUPPORT_PRIORITIES,
      assignees: admins.map((a) => ({ id: a._id.toString(), label: a.displayName || a.email })),
      counts: { awaitingSupport, unassigned },
    },
  });
});

router.get(
  '/support/tickets',
  validate({
    query: pagination
      .extend({
        status: z.enum([...SUPPORT_STATUSES, 'active']).optional(),
        category: z.enum(ALL_CATEGORIES).optional(),
        requesterType: z.enum(['customer', 'vendor']).optional(),
        priority: z.enum(SUPPORT_PRIORITIES).optional(),
        awaiting: z.enum(['support', 'requester']).optional(),
        assignee: z.union([z.enum(['me', 'none']), objectId]).optional(),
        q: text(80).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      })
      .strict(),
  }),
  async (req, res) => {
    const { status, category, requesterType, priority, awaiting, assignee, q, from, to, page, limit } = req.valid.query;
    const filter = {};
    if (status === 'active') filter.status = { $nin: ['resolved', 'closed'] };
    else if (status) filter.status = status;
    if (category) filter.category = category;
    if (requesterType) filter.requesterType = requesterType;
    if (priority) filter.priority = priority;
    if (awaiting) filter.awaiting = awaiting;
    if (assignee === 'me') filter.assigneeId = req.auth.user._id;
    else if (assignee === 'none') filter.assigneeId = null;
    else if (assignee) filter.assigneeId = assignee;
    if (q) filter.$or = [{ reference: q.toUpperCase().trim() }, { subject: { $regex: escapeRegex(q), $options: 'i' } }];
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = DateTime.fromISO(from, { zone: 'utc' }).toJSDate();
      if (to) filter.createdAt.$lt = DateTime.fromISO(to, { zone: 'utc' }).plus({ days: 1 }).toJSDate();
    }
    const [rows, total] = await Promise.all([
      SupportTicket.find(filter).sort({ lastMessageAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SupportTicket.countDocuments(filter),
    ]);
    const who = await requesterDetails(rows);
    res.json({ data: rows.map((t) => ({ ...serializeTicket(t, { view: 'admin' }), requester: who(t) })), meta: pageMeta(req.valid.query, total) });
  },
);

router.get('/support/tickets/:id', validate({ params: idParam }), async (req, res) => {
  const { ticket, messages } = await getTicket({ type: 'admin' }, req.valid.params.id, { includeInternal: true });
  const who = await requesterDetails([ticket]);
  const actors = new Map(
    (await User.find({ _id: { $in: [...messages.map((m) => m.authorId), ...ticket.history.map((h) => h.actorId)].filter(Boolean) } }, { displayName: 1, email: 1, role: 1 }).lean()).map((u) => [
      u._id.toString(),
      u.role === 'super_admin' ? u.displayName || u.email : null,
    ]),
  );
  res.json({
    data: {
      ...serializeTicket(ticket, { view: 'admin' }),
      requester: who(ticket),
      messages: serializeMessages(messages, { view: 'admin' }).map((m) => ({ ...m, authorLabel: m.authorType === 'support' ? actors.get(m.authorId) ?? 'TownAnt support' : null })),
      history: ticket.history.map((h) => ({ action: h.action, from: h.from ?? null, to: h.to ?? null, actorType: h.actorType, actorLabel: h.actorId ? actors.get(h.actorId.toString()) ?? null : null, at: h.at })),
    },
  });
});

router.post(
  '/support/tickets/:id/messages',
  validate({ params: idParam, body: z.object({ body: text(4000, { min: 2, multiline: true }), internal: z.boolean().default(false), status: z.enum(SUPPORT_STATUSES).optional() }).strict() }),
  async (req, res) => {
    const { body, internal, status } = req.valid.body;
    const ticket = await supportReply({ req, id: req.valid.params.id, body, internal, status: internal ? undefined : status });
    res.status(201).json({ data: serializeTicket(ticket, { view: 'admin' }) });
  },
);

router.patch(
  '/support/tickets/:id',
  validate({ params: idParam, body: z.object({ status: z.enum(SUPPORT_STATUSES).optional(), priority: z.enum(SUPPORT_PRIORITIES).optional(), assigneeId: objectId.nullable().optional() }).strict() }),
  async (req, res) => {
    const ticket = await supportUpdate({ req, id: req.valid.params.id, changes: req.valid.body });
    res.json({ data: serializeTicket(ticket, { view: 'admin' }) });
  },
);

export default router;
