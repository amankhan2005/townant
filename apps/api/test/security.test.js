import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createVendor, loginAdmin, loginCustomer, resetDb, startTestServer, stopTestServer, pngImage } from './helpers.js';

let app;
let fakes;
let models;

beforeAll(async () => {
  ({ app, fakes } = await startTestServer());
  models = await import('../src/models/index.js');
});
afterAll(stopTestServer);
beforeEach(resetDb);

describe('input handling', () => {
  it('rejects MongoDB operator objects in JSON bodies', async () => {
    const r1 = await request(app).post('/api/v1/auth/otp/request').send({ channel: 'email', email: { $gt: '' } });
    expect(r1.status).toBe(400);
    const r2 = await request(app).post('/api/v1/staff-auth/login').send({ email: 'a@b.co', password: { $ne: null } });
    expect(r2.status).toBe(400);
    const r3 = await request(app).post('/api/v1/vendor-applications').send({ 'address.city': 'x' });
    expect(r3.status).toBe(400);
  });

  it('does not parse nested query objects (no operator injection via query string)', async () => {
    const res = await request(app).get('/api/v1/catalog/companies?category[$ne]=x');
    expect(res.status).toBe(400);
    const res2 = await request(app).get('/api/v1/catalog/companies').query('q[$regex]=.*');
    expect(res2.status).toBe(400);
  });

  it('treats regex metacharacters in search as literal text', async () => {
    await createVendor(app, fakes, { name: 'Plain Name' });
    const res = await request(app).get('/api/v1/catalog/companies').query({ q: '.*' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    const evil = await request(app).get('/api/v1/catalog/companies').query({ q: '(a+)+$' });
    expect(evil.status).toBe(200);
  });

  it('rejects oversized and non-JSON bodies', async () => {
    const big = await request(app).post('/api/v1/auth/otp/request').set('Content-Type', 'application/json').send(JSON.stringify({ channel: 'email', email: 'a@b.co', pad: 'x'.repeat(200000) }));
    expect(big.status).toBe(413);
    const form = await request(app).post('/api/v1/auth/otp/request').set('Content-Type', 'application/x-www-form-urlencoded').send('channel=email&email=a@b.co');
    expect(form.status).toBe(415);
    const malformed = await request(app).post('/api/v1/auth/otp/request').set('Content-Type', 'application/json').send('{"channel":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('MALFORMED_JSON');
  });

  it('rejects malformed object IDs without leaking internals', async () => {
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const res = await customer.get('/api/v1/bookings/not-an-id');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/Cast|mongoose|stack|at \//i);
  });

  it('stores user text as data and escapes it in emails (stored XSS)', async () => {
    const { renderEmail } = await import('../src/services/emailTemplates.js');
    const out = renderEmail('notification', { title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>', link: '/bookings/1' });
    expect(out.html).not.toContain('<script>');
    expect(out.html).not.toContain('<img');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('returns public profile text verbatim as JSON (rendering escapes it)', async () => {
    const { company, client } = await createVendor(app, fakes);
    const payload = '<script>alert("x")</script>';
    expect((await client.patch('/api/v1/vendor/company').send({ summary: payload })).status).toBe(200);
    const res = await request(app).get(`/api/v1/catalog/companies/${company.slug}`);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.data.summary).toBe(payload);
  });
});

describe('HTTP hardening', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toMatch(/geolocation=\(\)/);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('allows credentialed CORS only for configured origins', async () => {
    const good = await request(app).get('/api/v1/catalog/categories').set('Origin', 'http://localhost:5173');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(good.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app).get('/api/v1/catalog/categories').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(app).options('/api/v1/bookings').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns generic 404s and never a stack trace', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('ignores X-Forwarded-For when no proxy is trusted (rate limits cannot be dodged)', async () => {
    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      const r = await request(app).post('/api/v1/auth/otp/request').set('X-Forwarded-For', `10.0.0.${i}`).send({ channel: 'email', email: `user${i}@example.com` });
      statuses.push(r.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});

describe('role boundaries', () => {
  const adminRoutes = ['/api/v1/admin/dashboard', '/api/v1/admin/applications', '/api/v1/admin/companies', '/api/v1/admin/users', '/api/v1/admin/audit'];

  it('denies admin APIs to anonymous, customer and vendor callers', async () => {
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const { client: vendor } = await createVendor(app, fakes);
    for (const url of adminRoutes) {
      expect((await request(app).get(url)).status, url).toBe(401);
      expect((await customer.get(url)).status, url).toBe(403);
      expect((await vendor.get(url)).status, url).toBe(403);
    }
  });

  it('denies vendor APIs to customers and to admins', async () => {
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const admin = await loginAdmin(app, fakes);
    expect((await customer.get('/api/v1/vendor/context')).status).toBe(403);
    expect((await admin.get('/api/v1/vendor/context')).status).toBe(403);
  });

  it('applies staff permissions within a company', async () => {
    const { company, client: owner } = await createVendor(app, fakes);
    const { createStaffUser, loginStaff } = await import('./helpers.js');
    const staffUser = await createStaffUser({ email: 'staff@vendor.test' });
    await models.Membership.create({ userId: staffUser._id, companyId: company._id, role: 'staff' });
    const staff = await loginStaff(app, fakes, 'staff@vendor.test');
    expect((await staff.get('/api/v1/vendor/bookings')).status).toBe(200);
    expect((await staff.patch('/api/v1/vendor/company').send({ summary: 'hijack' })).status).toBe(403);
    expect((await staff.post('/api/v1/vendor/services').send({ title: 'X', durationMinutes: 30 })).status).toBe(403);
    expect((await owner.patch('/api/v1/vendor/company').send({ summary: 'ok' })).status).toBe(200);
  });

  it('lets a multi-business vendor list and select only their own companies', async () => {
    const a = await createVendor(app, fakes, { name: 'First Co' });
    const other = await createVendor(app, fakes, { name: 'Not Mine' });
    const second = await models.Company.create({ name: 'Second Co', slug: `second-${Date.now()}` });
    await models.Membership.create({ userId: a.owner._id, companyId: second._id, role: 'owner' });
    const list = await a.client.get('/api/v1/vendor/companies');
    expect(list.body.data.map((c) => c.name).sort()).toEqual(['First Co', 'Second Co']);
    const ambiguous = await a.client.get('/api/v1/vendor/context');
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.error.code).toBe('COMPANY_SELECTION_REQUIRED');
    const chosen = await a.client.get('/api/v1/vendor/context').set('X-Company-Id', second._id.toString());
    expect(chosen.body.data.company.name).toBe('Second Co');
    expect((await a.client.get('/api/v1/vendor/context').set('X-Company-Id', other.company._id.toString())).status).toBe(403);
  });

  it("blocks a vendor from editing another company's service by ID", async () => {
    const a = await createVendor(app, fakes, { name: 'A' });
    const b = await createVendor(app, fakes, { name: 'B' });
    const res = await b.client.patch(`/api/v1/vendor/services/${a.service._id}`).send({ title: 'Pwned' });
    expect(res.status).toBe(404);
    expect((await b.client.post(`/api/v1/vendor/services/${a.service._id}/archive`)).status).toBe(404);
    expect((await models.Service.findById(a.service._id)).title).toBe('Standard clean');
  });

  it('blocks writes for suspended companies but allows reads', async () => {
    const { company, client } = await createVendor(app, fakes);
    await models.Company.updateOne({ _id: company._id }, { $set: { status: 'suspended' } });
    expect((await client.get('/api/v1/vendor/context')).status).toBe(200);
    const res = await client.patch('/api/v1/vendor/company').send({ summary: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_SUSPENDED');
  });

  it('prevents an admin from suspending themselves and records audited actions', async () => {
    const admin = await loginAdmin(app, fakes);
    const self = await admin.post(`/api/v1/admin/users/${admin.user.id}/suspend`).send({ reason: 'test' });
    expect(self.status).toBe(422);
    const target = await loginCustomer(app, fakes, 'target@example.com');
    const res = await admin.post(`/api/v1/admin/users/${target.user.id}/suspend`).send({ reason: 'Abuse report' });
    expect(res.status).toBe(200);
    expect((await target.get('/api/v1/me')).status).toBe(401);
    const log = await admin.get('/api/v1/admin/audit?action=user.suspend');
    expect(log.body.data[0]).toMatchObject({ action: 'user.suspend', reason: 'Abuse report', actorType: 'admin' });
  });
});

describe('webhooks', () => {
  const secretBytes = crypto.randomBytes(24);
  const secret = `whsec_${secretBytes.toString('base64')}`;

  function sign(id, ts, body) {
    return `v1,${crypto.createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64')}`;
  }

  it('verifies Svix signatures with timestamp tolerance', async () => {
    const { verifySvix } = await import('../src/routes/webhooks.js');
    const body = '{"type":"email.delivered"}';
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySvix({ secret, id: 'msg_1', timestamp: ts, signatureHeader: sign('msg_1', ts, body), body })).toBe(true);
    expect(verifySvix({ secret, id: 'msg_1', timestamp: ts, signatureHeader: sign('msg_1', ts, body), body: body + ' ' })).toBe(false);
    expect(verifySvix({ secret, id: 'msg_2', timestamp: ts, signatureHeader: sign('msg_1', ts, body), body })).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(verifySvix({ secret, id: 'msg_1', timestamp: old, signatureHeader: sign('msg_1', old, body), body })).toBe(false);
  });

  it('rejects unsigned WhatsApp webhook posts', async () => {
    process.env.WHATSAPP_APP_SECRET = 'app-secret-for-test';
    const { resetEnvCache } = await import('../src/config/env.js');
    resetEnvCache();
    const body = JSON.stringify({ entry: [] });
    const forged = await request(app).post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=deadbeef').send(body);
    expect(forged.status).toBe(401);
    const sig = `sha256=${crypto.createHmac('sha256', 'app-secret-for-test').update(body).digest('hex')}`;
    const ok = await request(app).post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body);
    expect(ok.status).toBe(200);
    delete process.env.WHATSAPP_APP_SECRET;
    resetEnvCache();
  });
});

describe('media uploads', () => {
  const PNG = pngImage(800, 600);

  it('accepts real images into a server-chosen company folder only', async () => {
    const { company, client } = await createVendor(app, fakes);
    const res = await client.post('/api/v1/vendor/company/media/logo').attach('file', PNG, { filename: '../../other/evil.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data.media.logo.publicId.startsWith(`townant/companies/${company._id}/logo/`)).toBe(true);
    expect(fakes.sent.uploads.at(-1).folder).toBe(`townant/companies/${company._id}/logo`);
  });

  it('rejects files whose bytes are not an allowed image, regardless of declared type', async () => {
    const { client } = await createVendor(app, fakes);
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64, ' '));
    const res = await client.post('/api/v1/vendor/company/media/gallery').attach('file', html, { filename: 'photo.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'.padEnd(64, ' '));
    expect((await client.post('/api/v1/vendor/company/media/gallery').attach('file', svg, { filename: 'x.svg', contentType: 'image/svg+xml' })).status).toBe(415);
  });

  it('rejects files over 5 MB', async () => {
    const { client } = await createVendor(app, fakes);
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const res = await client.post('/api/v1/vendor/company/media/banner').attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
  });

  it("cannot remove another company's photo", async () => {
    const a = await createVendor(app, fakes, { name: 'A' });
    const b = await createVendor(app, fakes, { name: 'B' });
    const up = await a.client.post('/api/v1/vendor/company/media/gallery').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    const publicId = up.body.data.media.gallery[0].publicId;
    const res = await b.client.post('/api/v1/vendor/company/media/remove').send({ kind: 'gallery', publicId });
    expect(res.status).toBe(422);
    expect(fakes.sent.destroyed).not.toContain(publicId);
  });
});

describe('AI assistance', () => {
  it('only returns real published listings for natural-language search', async () => {
    const { company } = await createVendor(app, fakes, { name: 'Sparkle Cleaning' });
    fakes.aiResponse = { keywords: 'sparkle', categorySlug: 'invented-category', city: 'Austin', region: null, postalCode: null, country: 'us', date: null, clarifyingQuestion: null };
    const res = await request(app).post('/api/v1/ai/search').send({ query: 'find me a cleaner in Austin' });
    expect(res.status).toBe(200);
    expect(res.body.data.intent.categorySlug).toBeNull(); // invented category discarded
    expect(res.body.data.results.map((r) => r.id)).toEqual([company._id.toString()]);

    fakes.aiResponse = { keywords: 'unicorn grooming', categorySlug: null, city: 'Nowhere', region: null, postalCode: null, country: null, date: null, clarifyingQuestion: null };
    const none = await request(app).post('/api/v1/ai/search').send({ query: 'unicorn grooming in nowhere' });
    expect(none.body.data.results).toEqual([]);
  });

  it('fails safely when the model returns malformed output or is offline', async () => {
    fakes.aiResponse = { keywords: 42, injected: true };
    const bad = await request(app).post('/api/v1/ai/search').send({ query: 'anything at all' });
    expect(bad.status).toBe(503);
    expect(bad.body.error.code).toBe('AI_UNAVAILABLE');
    fakes.aiResponse = null;
    expect((await request(app).post('/api/v1/ai/search').send({ query: 'anything at all' })).status).toBe(503);
  });

  it('requires sign-in for writing help and rate-limits callers', async () => {
    expect((await request(app).post('/api/v1/ai/polish').send({ text: 'hello there', purpose: 'message' })).status).toBe(401);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    fakes.aiResponse = { text: 'Hello there.' };
    const statuses = [];
    for (let i = 0; i < 8; i += 1) statuses.push((await customer.post('/api/v1/ai/polish').send({ text: 'hello there', purpose: 'message' })).status);
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(6).every((s) => s === 429)).toBe(true);
  });
});
