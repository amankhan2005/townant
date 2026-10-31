import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearerClient, createStaffUser, createVendor, firstSlots, lastCode, loginAdmin, loginCustomer, resetDb, startTestServer, stopTestServer } from './helpers.js';

let app;
let fakes;
let models;

beforeAll(async () => {
  ({ app, fakes } = await startTestServer());
  models = await import('../src/models/index.js');
});
afterAll(stopTestServer);
beforeEach(async () => {
  await resetDb();
  fakes.sent.email.length = 0;
});

const ID = '64b000000000000000000001';
// Every route mounted under /api/v1/admin (routes/v1/admin/index.js).
const ENDPOINTS = [
  ['get', '/dashboard'],
  ['get', '/applications'],
  ['get', `/applications/${ID}`],
  ['post', `/applications/${ID}/approve`],
  ['post', `/applications/${ID}/reject`],
  ['post', `/applications/${ID}/request-info`],
  ['get', '/companies'],
  ['get', `/companies/${ID}`],
  ['post', '/companies'],
  ['patch', `/companies/${ID}`],
  ['post', `/companies/${ID}/suspend`],
  ['post', `/companies/${ID}/reactivate`],
  ['post', `/companies/${ID}/resend-invite`],
  ['put', `/companies/${ID}/spotlight`],
  ['get', '/users'],
  ['post', `/users/${ID}/suspend`],
  ['post', `/users/${ID}/reactivate`],
  ['post', `/users/${ID}/revoke-sessions`],
  ['get', '/bookings'],
  ['post', `/bookings/${ID}/cancel`],
  ['get', '/conversations'],
  ['post', `/conversations/${ID}/messages`],
  ['post', `/conversations/${ID}/close`],
  ['get', '/reviews'],
  ['post', `/reviews/${ID}/hide`],
  ['post', `/reviews/${ID}/restore`],
  ['post', `/reviews/${ID}/dismiss-reports`],
  ['get', '/categories'],
  ['post', '/categories'],
  ['patch', `/categories/${ID}`],
  ['get', '/audit'],
];

const call = (client, method, path) => {
  const req = client ? client[method](`/api/v1/admin${path}`) : request(app)[method](`/api/v1/admin${path}`);
  return method === 'get' ? req : req.send({});
};

describe('access matrix: every admin endpoint', () => {
  it('rejects anonymous (401), customer (403), vendor (403) and admin without MFA (401 MFA_REQUIRED)', async () => {
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const { client: vendor } = await createVendor(app, fakes);
    await createStaffUser({ email: 'half@townant.test', role: 'super_admin' });
    const login = await request(app).post('/api/v1/staff-auth/login').send({ email: 'half@townant.test', password: 'correct horse battery staple', transport: 'bearer' });
    const mfaPending = bearerClient(app, login.body.data.token, login.body.data.user);
    await models.RateLimitBucket.deleteMany({});

    for (const [method, path] of ENDPOINTS) {
      const label = `${method.toUpperCase()} ${path}`;
      expect((await call(null, method, path)).status, label).toBe(401);
      expect((await call(customer, method, path)).status, label).toBe(403);
      expect((await call(vendor, method, path)).status, label).toBe(403);
      const pending = await call(mfaPending, method, path);
      expect(pending.status, label).toBe(401);
      expect(pending.body.error.code, label).toBe('MFA_REQUIRED');
    }
    // Nothing above performed an admin action (the only admin audit entry is the half-finished login itself).
    expect(await models.AuditEvent.countDocuments({ actorType: 'admin', action: { $ne: 'staff.login' } })).toBe(0);
  });

  it('rejects a forged role claim: a vendor token cannot become admin', async () => {
    const { client } = await createVendor(app, fakes);
    const res = await client.get('/api/v1/admin/dashboard').set('X-Role', 'super_admin');
    expect(res.status).toBe(403);
  });
});

describe('admin features against MongoDB', () => {
  it('requests more info on an application and emails the applicant', async () => {
    const admin = await loginAdmin(app, fakes);
    await request(app).post('/api/v1/vendor-applications').send({
      businessName: 'Quick Fix',
      contactName: 'Jo',
      email: 'jo@quickfix.test',
      description: 'Handyman services across the north side of town.',
      address: { city: 'Austin', country: 'US' },
    });
    const [{ id }] = (await admin.get('/api/v1/admin/applications')).body.data;
    const res = await admin.post(`/api/v1/admin/applications/${id}/request-info`).send({ reason: 'Please send your trade license number.' });
    expect(res.body.data.status).toBe('info_requested');
    const { processDeliveries } = await import('../src/services/notifications.js');
    await processDeliveries();
    expect(fakes.sent.email.some((m) => m.to === 'jo@quickfix.test' && m.text.includes('trade license'))).toBe(true);
    expect(await models.AuditEvent.countDocuments({ action: 'vendor_application.request_info' })).toBe(1);
  });

  it('creates a company directly, invites the owner, and supports view/edit/verify/resend', async () => {
    const admin = await loginAdmin(app, fakes);
    const created = await admin.post('/api/v1/admin/companies').send({ name: 'Direct Co', ownerEmail: 'owner@direct.test', address: { city: 'Denver', country: 'US' } });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ inviteEmailSent: true, company: { status: 'draft' } });
    const id = created.body.data.company.id;
    expect(fakes.sent.email.at(-1).text).toContain('/business/setup?token=');
    expect(fakes.sent.email.some((m) => /password:/i.test(m.text))).toBe(false);

    const detail = await admin.get(`/api/v1/admin/companies/${id}`);
    expect(detail.body.data.members[0]).toMatchObject({ role: 'owner', email: 'owner@direct.test', accountStatus: 'invited' });

    const edited = await admin.patch(`/api/v1/admin/companies/${id}`).send({ verified: true });
    expect(edited.body.data.verified).toBe(true);
    expect((await admin.patch(`/api/v1/admin/companies/${id}`).send({ status: 'published' })).status).toBe(400);

    const resend = await admin.post(`/api/v1/admin/companies/${id}/resend-invite`).send({});
    expect(resend.body.data.inviteEmailSent).toBe(true);
    // The first link is voided by the resend.
    expect(await models.ActionToken.countDocuments({ purpose: 'staff_invite', consumedAt: null })).toBe(1);

    const actions = (await models.AuditEvent.find({ entityId: id }).lean()).map((a) => a.action).sort();
    expect(actions).toEqual(['company.admin_update', 'company.create', 'company.resend_invite']);
  });

  it('suspends and reactivates a company, restoring its previous status', async () => {
    const admin = await loginAdmin(app, fakes);
    const { company } = await createVendor(app, fakes);
    expect((await admin.post(`/api/v1/admin/companies/${company._id}/suspend`).send({})).status).toBe(400);
    const s = await admin.post(`/api/v1/admin/companies/${company._id}/suspend`).send({ reason: 'Policy review' });
    expect(s.body.data).toMatchObject({ status: 'suspended', suspensionReason: 'Policy review' });
    expect((await request(app).get(`/api/v1/catalog/companies/${company.slug}`)).status).toBe(404);
    expect((await admin.post(`/api/v1/admin/companies/${company._id}/suspend`).send({ reason: 'again' })).status).toBe(409);
    const r = await admin.post(`/api/v1/admin/companies/${company._id}/reactivate`).send({ reason: 'Resolved' });
    expect(r.body.data.status).toBe('published');
    expect((await request(app).get(`/api/v1/catalog/companies/${company.slug}`)).status).toBe(200);
  });

  it('reactivates accounts and revokes sessions', async () => {
    const admin = await loginAdmin(app, fakes);
    const target = await loginCustomer(app, fakes, 'target@example.com');
    await admin.post(`/api/v1/admin/users/${target.user.id}/suspend`).send({ reason: 'Spam' });
    const re = await admin.post(`/api/v1/admin/users/${target.user.id}/reactivate`).send({ reason: 'Appeal accepted' });
    expect(re.body.data.status).toBe('active');
    const again = await loginCustomer(app, fakes, 'target@example.com');
    expect((await again.get('/api/v1/me')).status).toBe(200);
    const revoked = await admin.post(`/api/v1/admin/users/${target.user.id}/revoke-sessions`).send({ reason: 'Lost phone' });
    expect(revoked.body.data.revoked).toBeGreaterThan(0);
    expect((await again.get('/api/v1/me')).status).toBe(401);
    const list = await admin.get('/api/v1/admin/users?role=customer');
    expect(list.body.data.map((u) => u.email)).toContain('target@example.com');
  });

  it('lists bookings platform-wide and finds one by reference', async () => {
    const admin = await loginAdmin(app, fakes);
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    const b = await customer.post('/api/v1/bookings').send({ serviceId: service._id.toString(), startAt: slot.startAt });
    const list = await admin.get('/api/v1/admin/bookings');
    expect(list.body.meta.total).toBe(1);
    const byRef = await admin.get(`/api/v1/admin/bookings?q=${b.body.data.reference}`);
    expect(byRef.body.data[0].id).toBe(b.body.data.id);
    expect(byRef.body.data[0].customer.name).toBeTruthy();
  });

  it('shows inquiry metadata, requires an audited reason to read messages, and can close', async () => {
    const admin = await loginAdmin(app, fakes);
    const { company } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const convo = await customer.post('/api/v1/conversations').send({ companyId: company._id.toString(), body: 'Private question' });
    const list = await admin.get('/api/v1/admin/conversations');
    // Metadata only: no message text, not even a preview, without a stated reason.
    expect(JSON.stringify(list.body)).not.toContain('Private question');
    expect((await admin.post(`/api/v1/admin/conversations/${convo.body.data.id}/messages`).send({})).status).toBe(400);
    const read = await admin.post(`/api/v1/admin/conversations/${convo.body.data.id}/messages`).send({ reason: 'Abuse report #12' });
    expect(read.body.data.messages[0].body).toBe('Private question');
    expect(await models.AuditEvent.findOne({ action: 'conversation.admin_read' })).toMatchObject({ reason: 'Abuse report #12' });
    expect((await admin.post(`/api/v1/admin/conversations/${convo.body.data.id}/close`).send({ reason: 'Resolved' })).status).toBe(204);
    expect((await models.Conversation.findById(convo.body.data.id)).status).toBe('closed');
  });

  it('restores hidden reviews and dismisses reports, recomputing the rating', async () => {
    const admin = await loginAdmin(app, fakes);
    const { company, service, client: vendor } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    const b = await customer.post('/api/v1/bookings').send({ serviceId: service._id.toString(), startAt: slot.startAt });
    await models.Booking.collection.updateOne({ reference: b.body.data.reference }, { $set: { startAt: new Date(Date.now() - 7200000), endAt: new Date(Date.now() - 3600000) } });
    await vendor.post(`/api/v1/vendor/bookings/${b.body.data.id}/complete`).send({});
    const review = await customer.post('/api/v1/reviews').send({ bookingId: b.body.data.id, rating: 5, text: 'Great' });
    const id = review.body.data.id;

    await admin.post(`/api/v1/admin/reviews/${id}/hide`).send({ reason: 'Checking' });
    expect((await models.Company.findById(company._id)).ratingCount).toBe(0);
    const restored = await admin.post(`/api/v1/admin/reviews/${id}/restore`).send({ reason: 'Verified genuine' });
    expect(restored.body.data.status).toBe('published');
    expect((await models.Company.findById(company._id)).ratingCount).toBe(1);

    const reporter = await loginCustomer(app, fakes, 'r@example.com');
    await reporter.post(`/api/v1/reviews/${id}/report`).send({ reason: 'spam' });
    const dismissed = await admin.post(`/api/v1/admin/reviews/${id}/dismiss-reports`).send({ reason: 'Not spam' });
    expect(dismissed.body.data.resolved).toBe(1);
    expect((await models.Review.findById(id)).text).toBe('Great');
  });

  it('lists and edits categories (slug immutable, no self-parenting)', async () => {
    const admin = await loginAdmin(app, fakes);
    const cat = await admin.post('/api/v1/admin/categories').send({ name: 'Garden', slug: 'garden' });
    expect((await admin.get('/api/v1/admin/categories')).body.data.map((c) => c.slug)).toContain('garden');
    const edited = await admin.patch(`/api/v1/admin/categories/${cat.body.data.id}`).send({ name: 'Garden & Lawn', isActive: false });
    expect(edited.body.data).toMatchObject({ name: 'Garden & Lawn', isActive: false });
    expect((await admin.patch(`/api/v1/admin/categories/${cat.body.data.id}`).send({ slug: 'x' })).status).toBe(400);
    expect((await admin.patch(`/api/v1/admin/categories/${cat.body.data.id}`).send({ parentId: cat.body.data.id })).status).toBe(422);
    expect((await admin.post('/api/v1/admin/categories').send({ name: 'Dup', slug: 'garden' })).status).toBe(409);
  });
});

describe('Super Admin bootstrap and login', () => {
  it('bootstrap script creates an invited admin with a hashed single-use link; setup then works once', async () => {
    const { stdout } = await promisify(execFile)('node', ['scripts/create-admin.js', '--email', 'root@townant.test'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env },
    });
    const token = decodeURIComponent(stdout.match(/admin\/setup\?token=(\S+)/)[1]);
    const user = await models.User.findOne({ email: 'root@townant.test' }).select('+passwordHash').lean();
    expect(user).toMatchObject({ accountType: 'staff', role: 'super_admin', status: 'invited' });
    expect(user.passwordHash).toBeUndefined();
    // Only the SHA-256 of the token is stored.
    const stored = await models.ActionToken.findOne({ userId: user._id }).lean();
    expect(JSON.stringify(stored)).not.toContain(token);

    const accepted = await request(app).post('/api/v1/staff-auth/invite/accept').send({ token, password: 'root-passphrase-12345', displayName: 'Root', transport: 'bearer' });
    expect(accepted.status).toBe(200);
    // The emailed single-use link counts as the second factor for this first session.
    expect((await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${accepted.body.data.token}`)).status).toBe(200);
    expect((await request(app).post('/api/v1/staff-auth/invite/accept').send({ token, password: 'other-passphrase-12345', displayName: 'X' })).status).toBe(400);

    // Re-running the script for an active admin is refused.
    await expect(promisify(execFile)('node', ['scripts/create-admin.js', '--email', 'root@townant.test'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env } })).rejects.toThrow();
  });

  it('later logins need password then an emailed code; wrong codes are rejected', async () => {
    await createStaffUser({ email: 'ops@townant.test', role: 'super_admin' });
    const login = await request(app).post('/api/v1/staff-auth/login').send({ email: 'ops@townant.test', password: 'correct horse battery staple', transport: 'bearer' });
    expect(login.body.data).toMatchObject({ mfaRequired: true });
    expect(login.body.data.mfa.maskedDestination).toBe('o***@townant.test');
    const auth = (r) => r.set('Authorization', `Bearer ${login.body.data.token}`);
    const code = lastCode(fakes);
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await auth(request(app).post('/api/v1/staff-auth/mfa/verify')).send({ challengeId: login.body.data.mfa.challengeId, code: wrong })).status).toBe(400);
    expect((await auth(request(app).get('/api/v1/admin/users'))).status).toBe(401);
    expect((await auth(request(app).post('/api/v1/staff-auth/mfa/verify')).send({ challengeId: login.body.data.mfa.challengeId, code })).status).toBe(200);
    expect((await auth(request(app).get('/api/v1/admin/users'))).status).toBe(200);
    expect(await models.AuditEvent.countDocuments({ action: { $in: ['staff.login', 'staff.mfa_verified'] } })).toBe(2);
  });

  it('expires idle admin sessions after 30 minutes', async () => {
    const admin = await loginAdmin(app, fakes);
    await models.Session.updateMany({}, { $set: { lastSeenAt: new Date(Date.now() - 31 * 60 * 1000) } });
    expect((await admin.get('/api/v1/admin/dashboard')).status).toBe(401);
  });
});
