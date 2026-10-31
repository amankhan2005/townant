import { conflict, notFound } from '../lib/errors.js';
import { Booking, Company, Conversation, Message, Service, User } from '../models/index.js';
import { track } from './analytics.js';
import { notify, notifyCompany } from './notifications.js';

// Participants are the customer and the company's team. Every lookup is scoped to one side.
export function conversationScope(scope, id) {
  if (scope.type === 'customer') return { _id: id, customerId: scope.userId };
  if (scope.type === 'vendor') return { _id: id, companyId: scope.companyId };
  return { _id: id };
}

export async function startConversation({ customer, companyId, serviceId, bookingId, subject, body }) {
  const company = await Company.findOne({ _id: companyId, status: 'published' });
  if (!company) throw notFound('Business not found.');
  if (serviceId && !(await Service.exists({ _id: serviceId, companyId: company._id }))) throw notFound('Service not found.');
  if (bookingId) {
    const booking = await Booking.exists({ _id: bookingId, customerId: customer._id, companyId: company._id });
    if (!booking) throw notFound('Booking not found.');
    const existing = await Conversation.findOne({ bookingId, customerId: customer._id });
    if (existing) {
      await postMessage({ scope: { type: 'customer', userId: customer._id }, conversationId: existing._id, sender: { type: 'customer', id: customer._id }, body });
      return existing;
    }
  }
  const conversation = await Conversation.create({
    companyId: company._id,
    customerId: customer._id,
    serviceId,
    bookingId,
    subject,
    lastMessagePreview: body.slice(0, 120),
    vendorUnread: 1,
  });
  await Message.create({ conversationId: conversation._id, senderType: 'customer', senderId: customer._id, body });
  await notifyCompany(company._id, {
    type: 'inquiry_received',
    title: 'New customer inquiry',
    body: subject || body.slice(0, 120),
    link: `/business/messages/${conversation._id}`,
    entityType: 'conversation',
    entityId: conversation._id,
    dedupeKey: `conversation:${conversation._id}:created`,
  });
  await track('inquiry_started', { companyId: company._id });
  return conversation;
}

// Customers may reopen a closed conversation by replying; vendors may only reply while open.
export async function postMessage({ scope, conversationId, sender, body }) {
  const conversation = await Conversation.findOne(conversationScope(scope, conversationId));
  if (!conversation) throw notFound('Conversation not found.');
  if (conversation.status === 'closed' && sender.type !== 'customer') {
    throw conflict('CONVERSATION_CLOSED', 'This conversation is closed.');
  }
  const message = await Message.create({ conversationId: conversation._id, senderType: sender.type, senderId: sender.id, body });
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: { lastMessageAt: message.createdAt, lastMessagePreview: body.slice(0, 120), status: 'open', closedAt: null, closedBy: null },
      $inc: sender.type === 'customer' ? { vendorUnread: 1 } : { customerUnread: 1 },
    },
  );
  const dedupeKey = `message:${message._id}`;
  if (sender.type === 'customer') {
    await notifyCompany(conversation.companyId, { type: 'message_received', title: 'New message from a customer', body: body.slice(0, 120), link: `/business/messages/${conversation._id}`, entityType: 'conversation', entityId: conversation._id, dedupeKey });
  } else {
    const company = await Company.findById(conversation.companyId, { name: 1 }).lean();
    await notify({ recipientId: conversation.customerId, audience: 'customer', type: 'message_received', title: `New message from ${company?.name ?? 'a business'}`, body: body.slice(0, 120), link: `/messages/${conversation._id}`, entityType: 'conversation', entityId: conversation._id, dedupeKey });
  }
  return message;
}

export async function listMessages(scope, conversationId, side) {
  const conversation = await Conversation.findOne(conversationScope(scope, conversationId));
  if (!conversation) throw notFound('Conversation not found.');
  const messages = await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).limit(500).lean();
  if (side === 'customer') await Conversation.updateOne({ _id: conversation._id }, { $set: { customerUnread: 0 } });
  if (side === 'vendor') await Conversation.updateOne({ _id: conversation._id }, { $set: { vendorUnread: 0 } });
  return { conversation, messages };
}

export async function closeConversation(scope, conversationId, by) {
  const updated = await Conversation.findOneAndUpdate(
    { ...conversationScope(scope, conversationId), status: 'open' },
    { $set: { status: 'closed', closedAt: new Date(), closedBy: by } },
    { new: true },
  );
  if (!updated) throw notFound('Conversation not found or already closed.');
  return updated;
}

export async function serializeConversations(list, side) {
  const companies = new Map((await Company.find({ _id: { $in: list.map((c) => c.companyId) } }, { name: 1, slug: 1, 'media.logo': 1 }).lean()).map((c) => [c._id.toString(), c]));
  const customers =
    side === 'customer' ? new Map() : new Map((await User.find({ _id: { $in: list.map((c) => c.customerId) } }, { displayName: 1, status: 1 }).lean()).map((u) => [u._id.toString(), u]));
  return list.map((c) => {
    const company = companies.get(c.companyId.toString());
    return {
      id: c._id.toString(),
      status: c.status,
      subject: c.subject ?? null,
      bookingId: c.bookingId?.toString() ?? null,
      serviceId: c.serviceId?.toString() ?? null,
      lastMessageAt: c.lastMessageAt,
      // Admins see metadata only; message text requires the audited read endpoint.
      lastMessagePreview: side === 'admin' ? undefined : c.lastMessagePreview,
      unread: side === 'customer' ? c.customerUnread : side === 'vendor' ? c.vendorUnread : undefined,
      company: company ? { id: company._id.toString(), name: company.name, slug: company.slug, logoUrl: company.media?.logo?.url ?? null } : null,
      customer: side === 'customer' ? undefined : { name: customers.get(c.customerId.toString())?.status === 'deleted' ? 'Deleted customer' : customers.get(c.customerId.toString())?.displayName || 'TownAnt customer' },
    };
  });
}

export const serializeMessage = (m) => ({ id: m._id.toString(), senderType: m.senderType, body: m.body, createdAt: m.createdAt });
