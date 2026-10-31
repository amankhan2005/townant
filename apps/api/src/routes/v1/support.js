import { Router } from 'express';
import { pageMeta, validate } from '../../lib/validate.js';
import { requireCustomer } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { SUPPORT_CATEGORIES } from '../../models/index.js';
import { createTicket, getTicket, listTickets, markRead, requesterReply, requesterSetStatus, serializeMessages, serializeTicket } from '../../services/support.js';
import { createBody, idParam, listQuery, messageBody, statusBody } from './supportShared.js';

// Customer support requests. Customers only ever see their own tickets and never internal notes.
const router = Router();
router.use(requireCustomer);

const scopeOf = (req) => ({ type: 'customer', userId: req.auth.user._id });
const byUser = (req) => req.auth.user._id.toString();
const createLimit = rateLimit({ name: 'support-create', windowMs: 60 * 60 * 1000, max: 5, failClosed: true, key: byUser });
const replyLimit = rateLimit({ name: 'support-reply', windowMs: 60 * 60 * 1000, max: 40, failClosed: true, key: byUser });

router.get('/categories', (_req, res) => res.json({ data: SUPPORT_CATEGORIES.customer }));

router.get('/tickets', validate({ query: listQuery }), async (req, res) => {
  const { rows, total } = await listTickets(scopeOf(req), req.valid.query);
  res.json({ data: rows.map((t) => serializeTicket(t, { view: 'requester' })), meta: pageMeta(req.valid.query, total) });
});

router.post('/tickets', createLimit, validate({ body: createBody(SUPPORT_CATEGORIES.customer) }), async (req, res) => {
  const ticket = await createTicket({ scope: scopeOf(req), user: req.auth.user, ...req.valid.body });
  res.status(201).json({ data: serializeTicket(ticket, { view: 'requester' }) });
});

router.get('/tickets/:id', validate({ params: idParam }), async (req, res) => {
  const { ticket, messages } = await getTicket(scopeOf(req), req.valid.params.id);
  await markRead(scopeOf(req), ticket);
  res.json({ data: { ...serializeTicket(ticket, { view: 'requester' }), messages: serializeMessages(messages, { view: 'requester' }) } });
});

router.post('/tickets/:id/messages', replyLimit, validate({ params: idParam, body: messageBody }), async (req, res) => {
  const ticket = await requesterReply({ scope: scopeOf(req), id: req.valid.params.id, user: req.auth.user, body: req.valid.body.body });
  res.status(201).json({ data: serializeTicket(ticket, { view: 'requester' }) });
});

router.post('/tickets/:id/status', replyLimit, validate({ params: idParam, body: statusBody }), async (req, res) => {
  const ticket = await requesterSetStatus({ scope: scopeOf(req), id: req.valid.params.id, user: req.auth.user, action: req.valid.body.action });
  res.json({ data: serializeTicket(ticket, { view: 'requester' }) });
});

export default router;
