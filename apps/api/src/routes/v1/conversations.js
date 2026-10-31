import { Router } from 'express';
import { z } from 'zod';
import { objectId, text, validate } from '../../lib/validate.js';
import { requireCustomer } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { Conversation } from '../../models/index.js';
import { closeConversation, listMessages, postMessage, serializeConversations, serializeMessage, startConversation } from '../../services/conversations.js';

const router = Router();
router.use(requireCustomer);
const scopeOf = (req) => ({ type: 'customer', userId: req.auth.user._id });
const idParam = z.object({ id: objectId }).strict();
const userKey = (req) => req.auth.user._id.toString();
const body = text(2000, { min: 1, multiline: true });

router.get('/', async (req, res) => {
  const list = await Conversation.find({ customerId: req.auth.user._id }).sort({ lastMessageAt: -1 }).limit(100).lean();
  res.json({ data: await serializeConversations(list, 'customer') });
});

router.post(
  '/',
  rateLimit({ name: 'inquiry-create', windowMs: 60 * 60 * 1000, max: 10, key: userKey }),
  validate({ body: z.object({ companyId: objectId, serviceId: objectId.optional(), bookingId: objectId.optional(), subject: text(120).optional(), body }).strict() }),
  async (req, res) => {
    const conversation = await startConversation({ customer: req.auth.user, ...req.valid.body });
    const [out] = await serializeConversations([conversation.toObject ? conversation.toObject() : conversation], 'customer');
    res.status(201).json({ data: out });
  },
);

router.get('/:id/messages', validate({ params: idParam }), async (req, res) => {
  const { conversation, messages } = await listMessages(scopeOf(req), req.valid.params.id, 'customer');
  const [meta] = await serializeConversations([conversation.toObject()], 'customer');
  res.json({ data: { conversation: meta, messages: messages.map(serializeMessage) } });
});

router.post(
  '/:id/messages',
  rateLimit({ name: 'message-send', windowMs: 10 * 60 * 1000, max: 40, key: userKey }),
  validate({ params: idParam, body: z.object({ body }).strict() }),
  async (req, res) => {
    const message = await postMessage({ scope: scopeOf(req), conversationId: req.valid.params.id, sender: { type: 'customer', id: req.auth.user._id }, body: req.valid.body.body });
    res.status(201).json({ data: serializeMessage(message) });
  },
);

router.post('/:id/close', validate({ params: idParam }), async (req, res) => {
  await closeConversation(scopeOf(req), req.valid.params.id, 'customer');
  res.status(204).end();
});

export default router;
