import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStaffUser, createVendor, loginAdmin, loginCustomer, loginStaff, resetDb, startTestServer, stopTestServer } from './helpers.js';

let app;
let fakes;
let models;

beforeAll(async () => {
  ({ app, fakes } = await startTestServer());
  models = await import('../src/models/index.js');
});
afterAll(stopTestServer);
beforeEach(resetDb);

const ticketBody = { category: 'booking', subject: 'Business did not show up', body: 'My appointment on Friday was not honoured by the business.' };

describe('customer support tickets', () => {
  it('creates a ticket with a reference, confirms it, and keeps customers apart', async () => {
    const alice = await loginCustomer(app, fakes, 'alice@example.com');
    const bob = await loginCustomer(app, fakes, 'bob@example.com');
    expect((await request(app).post('/api/v1/support/tickets').send(ticketBody)).status).toBe(401);

    const created = await alice.post('/api/v1/support/tickets').send(ticketBody);
    expect(created.status).toBe(201);
    expect(created.body.data.reference).toMatch(/^SUP-[A-Z2-9]{6}$/);
    expect(created.body.data.status).toBe('open');
    const id = created.body.data.id;
    expect(await models.Notification.countDocuments({ recipientId: alice.user.id, type: 'support_update' })).toBe(1);

    // Another customer cannot see, reply to or change it — it behaves as if it doesn't exist.
    expect((await bob.get(`/api/v1/support/tickets/${id}`)).status).toBe(404);
    expect((await bob.post(`/api/v1/support/tickets/${id}/messages`).send({ body: 'hijack' })).status).toBe(404);
    expect((await bob.post(`/api/v1/support/tickets/${id}/status`).send({ action: 'resolve' })).status).toBe(404);
    expect((await bob.get('/api/v1/support/tickets')).body.data).toEqual([]);

    // Validation: category must be a customer category; vendor-only categories and mass assignment are rejected.
    expect((await alice.post('/api/v1/support/tickets').send({ ...ticketBody, category: 'listing' })).status).toBe(400);
    expect((await alice.post('/api/v1/support/tickets').send({ ...ticketBody, status: 'resolved' })).status).toBe(400);
    expect((await alice.post('/api/v1/support/tickets').send({ ...ticketBody, body: 'short' })).status).toBe(400);

    const list = await alice.get('/api/v1/support/tickets');
    expect(list.body.data.map((t) => t.id)).toEqual([id]);
  });

  it('rate-limits ticket creation', async () => {
    const alice = await loginCustomer(app, fakes, 'alice@example.com');
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await alice.post('/api/v1/support/tickets').send(ticketBody)).status);
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it('runs the reply/status cycle and never shows internal notes to the requester', async () => {
    const alice = await loginCustomer(app, fakes, 'alice@example.com');
    const admin = await loginAdmin(app, fakes);
    const { id } = (await alice.post('/api/v1/support/tickets').send(ticketBody)).body.data;

    const note = await admin.post(`/api/v1/admin/support/tickets/${id}/messages`).send({ body: 'Checked the booking log: vendor marked no-show.', internal: true });
    expect(note.status).toBe(201);
    const reply = await admin.post(`/api/v1/admin/support/tickets/${id}/messages`).send({ body: 'Sorry about this. Could you confirm the booking reference?' });
    expect(reply.body.data.status).toBe('waiting_on_requester');
    expect(await models.Notification.countDocuments({ recipientId: alice.user.id, type: 'support_update' })).toBe(2); // created + reply, not the note

    const view = await alice.get(`/api/v1/support/tickets/${id}`);
    expect(view.body.data.messages.map((m) => m.authorType)).toEqual(['requester', 'support']);
    expect(JSON.stringify(view.body.data)).not.toMatch(/vendor marked no-show|internal|priority|assignee/);

    // Customer reply hands it back to support.
    const back = await alice.post(`/api/v1/support/tickets/${id}/messages`).send({ body: 'The reference is TA-12345.' });
    expect(back.body.data.status).toBe('open');

    // Admin resolves (customer notified), customer reopens, admin closes; closed is final for the requester.
    await admin.patch(`/api/v1/admin/support/tickets/${id}`).send({ status: 'resolved', priority: 'high' });
    expect((await models.Notification.find({ recipientId: alice.user.id }).lean()).some((n) => /resolved/.test(n.title))).toBe(true);
    expect((await alice.post(`/api/v1/support/tickets/${id}/status`).send({ action: 'reopen' })).body.data.status).toBe('open');
    await admin.patch(`/api/v1/admin/support/tickets/${id}`).send({ status: 'closed' });
    expect((await alice.post(`/api/v1/support/tickets/${id}/messages`).send({ body: 'one more thing' })).status).toBe(409);
    expect((await alice.post(`/api/v1/support/tickets/${id}/status`).send({ action: 'reopen' })).status).toBe(409);

    const detail = await admin.get(`/api/v1/admin/support/tickets/${id}`);
    expect(detail.body.data.messages.filter((m) => m.internal)).toHaveLength(1);
    expect(detail.body.data.history.map((h) => h.action)).toEqual(expect.arrayContaining(['created', 'support_reply', 'requester_reply', 'status', 'priority', 'requester_reopen']));
    expect(detail.body.data.requester.email).toBe('alice@example.com');
    expect(await models.AuditEvent.countDocuments({ action: { $in: ['support.reply', 'support.update', 'support.internal_note'] } })).toBeGreaterThanOrEqual(4);
  });
});

describe('vendor support tickets', () => {
  it('scopes tickets to the business and role, and works while suspended', async () => {
    const a = await createVendor(app, fakes, { name: 'Alpha Co' });
    const b = await createVendor(app, fakes, { name: 'Beta Co' });
    const staffUser = await createStaffUser({ email: 'staff@alpha.test' });
    await models.Membership.create({ userId: staffUser._id, companyId: a.company._id, role: 'staff' });
    const staff = await loginStaff(app, fakes, 'staff@alpha.test');

    const body = { category: 'listing', subject: 'Cannot publish my profile', body: 'The publish button stays disabled after adding hours.' };
    const own = await a.client.post('/api/v1/vendor/support/tickets').send(body);
    expect(own.status).toBe(201);
    const staffTicket = await staff.post('/api/v1/vendor/support/tickets').send({ ...body, subject: 'Calendar question' });
    expect(staffTicket.status).toBe(201);

    // Other businesses can't see it; customers can't use vendor support.
    expect((await b.client.get(`/api/v1/vendor/support/tickets/${own.body.data.id}`)).status).toBe(404);
    expect((await b.client.get('/api/v1/vendor/support/tickets')).body.data).toEqual([]);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    expect((await customer.get('/api/v1/vendor/support/tickets')).status).toBe(403);
    expect((await customer.get(`/api/v1/support/tickets/${own.body.data.id}`)).status).toBe(404);

    // Owners see all of the business's tickets; staff only their own.
    expect((await a.client.get('/api/v1/vendor/support/tickets')).body.data).toHaveLength(2);
    const staffList = (await staff.get('/api/v1/vendor/support/tickets')).body.data;
    expect(staffList.map((t) => t.subject)).toEqual(['Calendar question']);
    expect((await staff.get(`/api/v1/vendor/support/tickets/${own.body.data.id}`)).status).toBe(404);

    // A suspended business can still ask for help (but other writes stay blocked).
    await models.Company.updateOne({ _id: a.company._id }, { $set: { status: 'suspended' } });
    expect((await a.client.post('/api/v1/vendor/support/tickets').send({ ...body, subject: 'Why was I suspended?' })).status).toBe(201);
    expect((await a.client.patch('/api/v1/vendor/company').send({ summary: 'x' })).status).toBe(403);

    const ticket = await models.SupportTicket.findById(own.body.data.id).lean();
    expect(ticket.companyId.toString()).toBe(a.company._id.toString());
    expect(ticket.requesterType).toBe('vendor');
  });
});

describe('admin support desk', () => {
  it('is Super Admin only, filters tickets and validates assignment', async () => {
    const admin = await loginAdmin(app, fakes);
    const alice = await loginCustomer(app, fakes, 'alice@example.com');
    const v = await createVendor(app, fakes);
    await alice.post('/api/v1/support/tickets').send(ticketBody);
    await v.client.post('/api/v1/vendor/support/tickets').send({ category: 'technical', subject: 'Calendar sync broken', body: 'My calendar shows the wrong week.' });

    expect((await alice.get('/api/v1/admin/support/tickets')).status).toBe(403);
    expect((await v.client.get('/api/v1/admin/support/tickets')).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/support/tickets')).status).toBe(401);

    const vendorOnly = await admin.get('/api/v1/admin/support/tickets').query({ requesterType: 'vendor' });
    expect(vendorOnly.body.data.map((t) => t.subject)).toEqual(['Calendar sync broken']);
    expect(vendorOnly.body.data[0].requester.company.name).toBe('Acme Cleaning');
    const byRef = await admin.get('/api/v1/admin/support/tickets').query({ q: vendorOnly.body.data[0].reference });
    expect(byRef.body.data).toHaveLength(1);
    expect((await admin.get('/api/v1/admin/support/tickets').query({ q: 'calendar', awaiting: 'support' })).body.data).toHaveLength(1);
    expect((await admin.get('/api/v1/admin/support/tickets').query({ status: { $ne: 'x' } })).status).toBe(400);

    const id = vendorOnly.body.data[0].id;
    expect((await admin.patch(`/api/v1/admin/support/tickets/${id}`).send({ assigneeId: v.owner._id.toString() })).status).toBe(422);
    const me = (await admin.get('/api/v1/admin/support/meta')).body.data.assignees[0];
    expect((await admin.patch(`/api/v1/admin/support/tickets/${id}`).send({ assigneeId: me.id })).status).toBe(200);
    expect((await admin.get('/api/v1/admin/support/tickets').query({ assignee: 'me' })).body.data.map((t) => t.id)).toEqual([id]);
    // The vendor (owner) is notified of status changes on their own ticket.
    await admin.patch(`/api/v1/admin/support/tickets/${id}`).send({ status: 'in_progress' });
    expect(await models.Notification.countDocuments({ recipientId: v.owner._id, audience: 'vendor', type: 'support_update' })).toBe(2);
  });
});
