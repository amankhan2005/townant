import crypto from 'node:crypto';
import { withTransaction } from '../db.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { Company, SupportMessage, SupportTicket, User } from '../models/index.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';

// TownAnt support tickets for customers and vendors, handled by Super Admins.
//
// Every lookup goes through `ticketFilter`, so a ticket outside the caller's scope behaves
// exactly like one that doesn't exist. Internal notes are filtered out for requesters at the
// query level, not in the UI.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newReference = () => `SUP-${Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('')}`;

export const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', waiting_on_requester: 'Waiting for your reply', resolved: 'Resolved', closed: 'Closed' };

/**
 * scope: { type: 'customer', userId }
 *      | { type: 'vendor', companyId, userId, allCompanyTickets }  (owners/managers see all of the business's tickets)
 *      | { type: 'admin' }
 */
export function ticketFilter(scope, id) {
  const byId = id ? { _id: id } : {};
  if (scope.type === 'customer') return { ...byId, requesterType: 'customer', requesterId: scope.userId };
  if (scope.type === 'vendor') return { ...byId, requesterType: 'vendor', companyId: scope.companyId, ...(scope.allCompanyTickets ? {} : { requesterId: scope.userId }) };
  if (scope.type === 'admin') return byId;
  throw new Error('unknown scope');
}

async function findTicket(scope, id, session) {
  const ticket = await SupportTicket.findOne(ticketFilter(scope, id)).session(session ?? null);
  if (!ticket) throw notFound('Support request not found.');
  return ticket;
}

const preview = (body) => (body.length > 140 ? `${body.slice(0, 137)}…` : body);
const requesterLink = (t) => (t.requesterType === 'vendor' ? `/business/support/${t._id}` : `/support/${t._id}`);

async function notifyRequester(ticket, { title, body, key }, session) {
  await notify(
    {
      recipientId: ticket.requesterId,
      audience: ticket.requesterType,
      type: 'support_update',
      title,
      body,
      link: requesterLink(ticket),
      entityType: 'support_ticket',
      entityId: ticket._id,
      dedupeKey: `support:${ticket._id}:${key}`,
    },
    session,
  );
}

export async function createTicket({ scope, user, category, subject, body }) {
  return withTransaction(async (session) => {
    let ticket;
    for (let attempt = 0; !ticket; attempt += 1) {
      try {
        [ticket] = await SupportTicket.create(
          [
            {
              reference: newReference(),
              requesterType: scope.type,
              requesterId: user._id,
              companyId: scope.type === 'vendor' ? scope.companyId : undefined,
              category,
              subject,
              status: 'open',
              awaiting: 'support',
              lastMessageAt: new Date(),
              lastRequesterMessageAt: new Date(),
              history: [{ action: 'created', to: 'open', actorType: scope.type, actorId: user._id }],
            },
          ],
          { session },
        );
      } catch (err) {
        if (err.code !== 11000 || attempt > 3) throw err;
      }
    }
    await SupportMessage.create([{ ticketId: ticket._id, authorType: 'requester', authorId: user._id, body }], { session });
    await notifyRequester(ticket, { title: `We received your support request ${ticket.reference}`, body: `“${subject}” — we'll reply here and let you know.`, key: 'created' }, session);
    return ticket;
  });
}

export async function listTickets(scope, { status, page, limit, extra = {} }) {
  const filter = { ...ticketFilter(scope), ...extra };
  if (status === 'active') filter.status = { $nin: ['resolved', 'closed'] };
  else if (status) filter.status = status;
  const [rows, total] = await Promise.all([SupportTicket.find(filter).sort({ lastMessageAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), SupportTicket.countDocuments(filter)]);
  return { rows, total };
}

export async function getTicket(scope, id, { includeInternal = false } = {}) {
  const ticket = await findTicket(scope, id);
  const messages = await SupportMessage.find({ ticketId: ticket._id, ...(includeInternal ? {} : { internal: false }) }).sort({ createdAt: 1 }).limit(500).lean();
  return { ticket, messages };
}

export async function markRead(scope, ticket) {
  if (scope.type !== 'admin' && ticket.requesterUnread) await SupportTicket.updateOne({ _id: ticket._id }, { $set: { requesterUnread: false } });
}

// Requester replies. A reply reopens a resolved ticket; closed tickets need a new request.
export async function requesterReply({ scope, id, user, body }) {
  return withTransaction(async (session) => {
    const ticket = await findTicket(scope, id, session);
    if (ticket.status === 'closed') throw conflict('TICKET_CLOSED', 'This request is closed. Start a new request if you still need help.');
    const from = ticket.status;
    const to = ['waiting_on_requester', 'resolved'].includes(from) ? 'open' : from;
    await SupportMessage.create([{ ticketId: ticket._id, authorType: 'requester', authorId: user._id, body }], { session });
    const now = new Date();
    const update = { $set: { status: to, awaiting: 'support', lastMessageAt: now, lastRequesterMessageAt: now, ...(to !== from ? { resolvedAt: null } : {}) } };
    if (to !== from) update.$push = { history: { action: 'requester_reply', from, to, actorType: scope.type, actorId: user._id } };
    return SupportTicket.findByIdAndUpdate(ticket._id, update, { new: true, session });
  });
}

// Requesters may mark their own request resolved, or reopen a resolved one.
export async function requesterSetStatus({ scope, id, user, action }) {
  const ticket = await findTicket(scope, id);
  const rule = { resolve: { from: ['open', 'in_progress', 'waiting_on_requester'], to: 'resolved' }, reopen: { from: ['resolved'], to: 'open' } }[action];
  if (!rule.from.includes(ticket.status)) throw conflict('INVALID_STATUS', action === 'reopen' ? 'Only resolved requests can be reopened.' : 'This request is already resolved or closed.');
  const now = new Date();
  const updated = await SupportTicket.findOneAndUpdate(
    { _id: ticket._id, status: ticket.status },
    {
      $set: { status: rule.to, awaiting: rule.to === 'resolved' ? 'none' : 'support', resolvedAt: rule.to === 'resolved' ? now : null, lastMessageAt: now },
      $push: { history: { action: `requester_${action}`, from: ticket.status, to: rule.to, actorType: scope.type, actorId: user._id } },
    },
    { new: true },
  );
  if (!updated) throw conflict('TICKET_STATE_CHANGED', 'This request was just updated. Refresh to see its status.');
  return updated;
}

// Support reply or internal note. A public reply hands the ticket back to the requester unless
// the agent picks another status.
export async function supportReply({ req, id, body, internal, status }) {
  return withTransaction(async (session) => {
    const ticket = await findTicket({ type: 'admin' }, id, session);
    const now = new Date();
    await SupportMessage.create([{ ticketId: ticket._id, authorType: 'support', authorId: req.auth.user._id, body, internal }], { session });
    if (internal) {
      await audit(req, { action: 'support.internal_note', entityType: 'support_ticket', entityId: ticket._id, companyId: ticket.companyId }, session);
      return SupportTicket.findByIdAndUpdate(ticket._id, { $set: { updatedAt: now } }, { new: true, session });
    }
    if (ticket.requesterDeletedAt) throw conflict('REQUESTER_DELETED', 'The requester deleted their account, so they cannot receive replies.');
    const from = ticket.status;
    const to = status ?? (from === 'closed' ? 'closed' : 'waiting_on_requester');
    const updated = await SupportTicket.findByIdAndUpdate(
      ticket._id,
      {
        $set: {
          status: to,
          awaiting: ['resolved', 'closed'].includes(to) ? 'none' : to === 'waiting_on_requester' ? 'requester' : 'support',
          lastMessageAt: now,
          lastSupportReplyAt: now,
          requesterUnread: true,
          ...(to === 'resolved' ? { resolvedAt: now } : {}),
          ...(to === 'closed' ? { closedAt: now } : {}),
        },
        $push: { history: { action: 'support_reply', from, to, actorType: 'admin', actorId: req.auth.user._id } },
      },
      { new: true, session },
    );
    await notifyRequester(updated, { title: `TownAnt support replied to ${updated.reference}`, body: preview(body), key: `reply:${now.getTime()}` }, session);
    await audit(req, { action: 'support.reply', entityType: 'support_ticket', entityId: ticket._id, companyId: ticket.companyId, metadata: { from, to } }, session);
    return updated;
  });
}

const STATUS_NOTICES = {
  in_progress: (t) => `We're working on your request ${t.reference}`,
  resolved: (t) => `Your support request ${t.reference} was resolved`,
  closed: (t) => `Your support request ${t.reference} was closed`,
};

export async function supportUpdate({ req, id, changes }) {
  return withTransaction(async (session) => {
    const ticket = await findTicket({ type: 'admin' }, id, session);
    const $set = {};
    const history = [];
    const now = new Date();
    if (changes.assigneeId !== undefined) {
      if (changes.assigneeId && !(await User.exists({ _id: changes.assigneeId, role: 'super_admin', status: 'active' }).session(session))) {
        throw new AppError(422, 'INVALID_ASSIGNEE', 'Tickets can only be assigned to an active Super Admin.');
      }
      $set.assigneeId = changes.assigneeId || null;
      history.push({ action: 'assigned', to: changes.assigneeId || 'unassigned', actorType: 'admin', actorId: req.auth.user._id });
    }
    if (changes.priority && changes.priority !== ticket.priority) {
      $set.priority = changes.priority;
      history.push({ action: 'priority', from: ticket.priority, to: changes.priority, actorType: 'admin', actorId: req.auth.user._id });
    }
    const statusChanged = changes.status && changes.status !== ticket.status;
    if (statusChanged) {
      $set.status = changes.status;
      $set.awaiting = ['resolved', 'closed'].includes(changes.status) ? 'none' : changes.status === 'waiting_on_requester' ? 'requester' : 'support';
      if (changes.status === 'resolved') $set.resolvedAt = now;
      if (changes.status === 'closed') $set.closedAt = now;
      if (['open', 'in_progress'].includes(changes.status)) Object.assign($set, { resolvedAt: null, closedAt: null });
      history.push({ action: 'status', from: ticket.status, to: changes.status, actorType: 'admin', actorId: req.auth.user._id });
    }
    if (!history.length) return ticket;
    const updated = await SupportTicket.findByIdAndUpdate(ticket._id, { $set, $push: { history: { $each: history } } }, { new: true, session });
    if (statusChanged && STATUS_NOTICES[changes.status] && !ticket.requesterDeletedAt) {
      await notifyRequester(updated, { title: STATUS_NOTICES[changes.status](updated), body: updated.subject, key: `status:${changes.status}:${now.getTime()}` }, session);
    }
    await audit(req, { action: 'support.update', entityType: 'support_ticket', entityId: ticket._id, companyId: ticket.companyId, metadata: { ...changes, from: ticket.status } }, session);
    return updated;
  });
}

// ----- Serialization -----

export function serializeTicket(t, { view }) {
  const out = {
    id: t._id.toString(),
    reference: t.reference,
    requesterType: t.requesterType,
    category: t.category,
    subject: t.subject,
    status: t.status,
    awaiting: t.awaiting,
    lastMessageAt: t.lastMessageAt,
    resolvedAt: t.resolvedAt ?? null,
    closedAt: t.closedAt ?? null,
    createdAt: t.createdAt,
  };
  if (view === 'admin') {
    Object.assign(out, {
      priority: t.priority,
      assigneeId: t.assigneeId?.toString() ?? null,
      companyId: t.companyId?.toString() ?? null,
      requesterDeleted: Boolean(t.requesterDeletedAt),
      lastRequesterMessageAt: t.lastRequesterMessageAt ?? null,
      lastSupportReplyAt: t.lastSupportReplyAt ?? null,
    });
  } else {
    out.unread = Boolean(t.requesterUnread);
  }
  return out;
}

// Requesters see who wrote each message only as "you" or "TownAnt support".
export function serializeMessages(messages, { view }) {
  return messages
    .filter((m) => view === 'admin' || !m.internal)
    .map((m) => ({
      id: m._id.toString(),
      authorType: m.authorType,
      body: m.body,
      createdAt: m.createdAt,
      ...(view === 'admin' ? { internal: m.internal, authorId: m.authorId?.toString() ?? null } : {}),
    }));
}

// Requester details for the admin view: only what support needs to identify and reply.
export async function requesterDetails(tickets) {
  const users = new Map((await User.find({ _id: { $in: tickets.map((t) => t.requesterId) } }, { displayName: 1, email: 1, phone: 1, status: 1 }).lean()).map((u) => [u._id.toString(), u]));
  const companies = new Map((await Company.find({ _id: { $in: tickets.map((t) => t.companyId).filter(Boolean) } }, { name: 1, slug: 1 }).lean()).map((c) => [c._id.toString(), c]));
  return (t) => {
    const u = users.get(t.requesterId.toString());
    const c = t.companyId ? companies.get(t.companyId.toString()) : null;
    return {
      id: t.requesterId.toString(),
      name: u?.status === 'deleted' ? 'Deleted customer' : u?.displayName ?? null,
      email: u?.status === 'deleted' ? null : u?.email ?? null,
      phone: u?.status === 'deleted' ? null : u?.phone ?? null,
      company: c ? { id: c._id.toString(), name: c.name, slug: c.slug } : null,
    };
  };
}
