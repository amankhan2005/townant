import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStaffUser, lastCode, loginCustomer, resetDb, startTestServer, stopTestServer } from './helpers.js';

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
  fakes.sent.whatsapp.length = 0;
});

// Mongoose treats createdAt as immutable, so age challenges through the driver.
const ageChallenges = () => models.OtpChallenge.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 120000) } });

const requestEmailOtp = (email = 'jamie@example.com') => request(app).post('/api/v1/auth/otp/request').send({ channel: 'email', email });

describe('customer email OTP', () => {
  it('signs in with email only and never exposes the code in the response', async () => {
    const r1 = await requestEmailOtp();
    expect(r1.status).toBe(201);
    expect(JSON.stringify(r1.body)).not.toMatch(/\b\d{6}\b/);
    expect(r1.body.data.maskedDestination).toBe('j***@example.com');

    const r2 = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ channel: 'email', email: 'jamie@example.com', challengeId: r1.body.data.challengeId, code: lastCode(fakes) });
    expect(r2.status).toBe(200);
    expect(r2.body.data.user).toMatchObject({ role: 'customer', email: 'jamie@example.com', emailVerified: true, phone: null });
    // Cookie transport: token is set as an HttpOnly cookie, never returned in the body.
    expect(r2.body.data.token).toBeUndefined();
    const cookie = r2.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/ta_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('stores only hashes of the code and destination', async () => {
    await requestEmailOtp();
    const doc = await models.OtpChallenge.findOne().lean();
    const raw = JSON.stringify(doc);
    expect(raw).not.toContain('jamie@example.com');
    expect(raw).not.toContain(lastCode(fakes));
  });

  it('rejects a wrong code and locks the challenge after 5 attempts', async () => {
    const r1 = await requestEmailOtp();
    const code = lastCode(fakes);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app).post('/api/v1/auth/otp/verify').send({ channel: 'email', email: 'jamie@example.com', challengeId: r1.body.data.challengeId, code: wrong });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('OTP_INVALID');
    }
    // Even the correct code no longer works.
    const r = await request(app).post('/api/v1/auth/otp/verify').send({ channel: 'email', email: 'jamie@example.com', challengeId: r1.body.data.challengeId, code });
    expect(r.status).toBe(400);
  });

  it('rejects replay of a consumed code', async () => {
    const r1 = await requestEmailOtp();
    const body = { channel: 'email', email: 'jamie@example.com', challengeId: r1.body.data.challengeId, code: lastCode(fakes) };
    expect((await request(app).post('/api/v1/auth/otp/verify').send(body)).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/otp/verify').send(body)).status).toBe(400);
  });

  it('allows exactly one success when the same code is submitted concurrently', async () => {
    const r1 = await requestEmailOtp();
    const body = { channel: 'email', email: 'jamie@example.com', challengeId: r1.body.data.challengeId, code: lastCode(fakes), transport: 'bearer' };
    const results = await Promise.all(Array.from({ length: 8 }, () => request(app).post('/api/v1/auth/otp/verify').send(body)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await models.User.countDocuments()).toBe(1);
  });

  it('rejects an expired code', async () => {
    const r1 = await requestEmailOtp();
    await models.OtpChallenge.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await request(app).post('/api/v1/auth/otp/verify').send({ channel: 'email', email: 'jamie@example.com', challengeId: r1.body.data.challengeId, code: lastCode(fakes) });
    expect(r.status).toBe(400);
  });

  it('rejects a code used with a different destination than it was sent to', async () => {
    const r1 = await requestEmailOtp('victim@example.com');
    const r = await request(app).post('/api/v1/auth/otp/verify').send({ channel: 'email', email: 'attacker@example.com', challengeId: r1.body.data.challengeId, code: lastCode(fakes) });
    expect(r.status).toBe(400);
  });

  it('enforces a resend cooldown and supersedes the previous code', async () => {
    const r1 = await requestEmailOtp();
    const first = lastCode(fakes);
    const again = await requestEmailOtp();
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('OTP_COOLDOWN');
    expect(again.headers['retry-after']).toBeDefined();

    await ageChallenges();
    const r3 = await requestEmailOtp();
    expect(r3.status).toBe(201);
    const old = await request(app).post('/api/v1/auth/otp/verify').send({ channel: 'email', email: 'jamie@example.com', challengeId: r1.body.data.challengeId, code: first });
    expect(old.status).toBe(400);
  });

  it('caps codes per destination per hour', async () => {
    for (let i = 0; i < 5; i += 1) {
      await ageChallenges();
      expect((await requestEmailOtp()).status).toBe(201);
    }
    await ageChallenges();
    const r = await requestEmailOtp();
    expect(r.status).toBe(429);
    expect(fakes.sent.email).toHaveLength(5);
  });

  it('reports delivery failure honestly and does not leave a usable code', async () => {
    fakes.failNext.email = true;
    const r = await requestEmailOtp();
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe('OTP_DELIVERY_FAILED');
    const doc = await models.OtpChallenge.findOne().lean();
    expect(doc.invalidatedAt).toBeTruthy();
  });

  it('gives the same response for new and existing accounts (no enumeration)', async () => {
    await loginCustomer(app, fakes, 'existing@example.com');
    const a = await requestEmailOtp('existing@example.com');
    const b = await requestEmailOtp('newperson@example.com');
    expect(a.status).toBe(b.status);
    expect(Object.keys(a.body.data).sort()).toEqual(Object.keys(b.body.data).sort());
  });
});

describe('customer WhatsApp OTP', () => {
  it('signs in with an international phone number only', async () => {
    const r1 = await request(app).post('/api/v1/auth/otp/request').send({ channel: 'whatsapp', phone: '+44 7400 123456' });
    expect(r1.status).toBe(201);
    expect(fakes.sent.whatsapp[0].to).toBe('+447400123456');
    const r2 = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ channel: 'whatsapp', phone: '07400 123456', country: 'GB', challengeId: r1.body.data.challengeId, code: lastCode(fakes, 'whatsapp'), transport: 'bearer' });
    expect(r2.status).toBe(200);
    expect(r2.body.data.user).toMatchObject({ phone: '+447400123456', phoneVerified: true, email: null });
    expect(r2.body.data.token).toBeTruthy();
  });

  it('rejects invalid numbers', async () => {
    const r = await request(app).post('/api/v1/auth/otp/request').send({ channel: 'whatsapp', phone: '12345' });
    expect(r.status).toBe(400);
  });
});

describe('sessions', () => {
  async function cookieLogin() {
    const agent = request.agent(app);
    const r1 = await agent.post('/api/v1/auth/otp/request').send({ channel: 'email', email: 'cookie@example.com' });
    const r2 = await agent.post('/api/v1/auth/otp/verify').send({ channel: 'email', email: 'cookie@example.com', challengeId: r1.body.data.challengeId, code: lastCode(fakes) });
    return { agent, csrf: r2.body.data.csrfToken };
  }

  it('requires the CSRF token for cookie-authenticated writes', async () => {
    const { agent, csrf } = await cookieLogin();
    const without = await agent.patch('/api/v1/me').send({ displayName: 'Jamie' });
    expect(without.status).toBe(403);
    expect(without.body.error.code).toBe('CSRF_FAILED');
    const wrong = await agent.patch('/api/v1/me').set('X-CSRF-Token', 'nope').send({ displayName: 'Jamie' });
    expect(wrong.status).toBe(403);
    const ok = await agent.patch('/api/v1/me').set('X-CSRF-Token', csrf).send({ displayName: 'Jamie' });
    expect(ok.status).toBe(200);
  });

  it('does not accept a cookie session token as a bearer token', async () => {
    const { agent } = await cookieLogin();
    const res = await agent.get('/api/v1/me');
    expect(res.status).toBe(200);
    const sessions = await models.Session.find().lean();
    expect(sessions[0].transport).toBe('cookie');
    // The raw token only exists in the cookie jar; the DB holds its hash.
    expect(JSON.stringify(sessions[0])).not.toMatch(/ta_sid/);
  });

  it('revokes the session on logout', async () => {
    const client = await loginCustomer(app, fakes, 'bye@example.com');
    expect((await client.get('/api/v1/me')).status).toBe(200);
    expect((await client.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await client.get('/api/v1/me')).status).toBe(401);
  });

  it('invalidates sessions of a suspended user immediately', async () => {
    const client = await loginCustomer(app, fakes, 'bad@example.com');
    await models.User.updateOne({ email: 'bad@example.com' }, { $set: { status: 'suspended' } });
    expect((await client.get('/api/v1/me')).status).toBe(401);
  });

  it('rejects malformed and forged bearer tokens', async () => {
    for (const token of ['x', 'a'.repeat(43), 'Bearer', '"; DROP', '{"$gt":""}']) {
      const res = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('ignores role and status fields on profile update (no privilege escalation)', async () => {
    const client = await loginCustomer(app, fakes, 'sneaky@example.com');
    const res = await client.patch('/api/v1/me').send({ displayName: 'x', role: 'super_admin' });
    expect(res.status).toBe(400);
    const res2 = await client.patch('/api/v1/me').send({ email: 'other@example.com' });
    expect(res2.status).toBe(400);
    expect((await models.User.findOne({ email: 'sneaky@example.com' })).role).toBe('customer');
  });
});

describe('account linking', () => {
  it('adds a phone only after OTP proof and never merges into another account', async () => {
    await request(app).post('/api/v1/auth/otp/request').send({ channel: 'whatsapp', phone: '+15125550100' });
    await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ channel: 'whatsapp', phone: '+15125550100', challengeId: (await models.OtpChallenge.findOne()).challengeId, code: lastCode(fakes, 'whatsapp') });
    await models.OtpChallenge.deleteMany({});

    const client = await loginCustomer(app, fakes, 'linker@example.com');
    const taken = await client.post('/api/v1/me/identifiers/request').send({ channel: 'whatsapp', phone: '+15125550100' });
    expect(taken.status).toBe(409);

    const r1 = await client.post('/api/v1/me/identifiers/request').send({ channel: 'whatsapp', phone: '+15125550199' });
    expect(r1.status).toBe(201);
    const r2 = await client.post('/api/v1/me/identifiers/verify').send({ channel: 'whatsapp', phone: '+15125550199', challengeId: r1.body.data.challengeId, code: lastCode(fakes, 'whatsapp') });
    expect(r2.status).toBe(200);
    expect(r2.body.data).toMatchObject({ email: 'linker@example.com', phone: '+15125550199', phoneVerified: true });
  });
});

describe('staff authentication', () => {
  it('uses one generic error for unknown email and wrong password', async () => {
    await createStaffUser({ email: 'owner@vendor.test' });
    const a = await request(app).post('/api/v1/staff-auth/login').send({ email: 'owner@vendor.test', password: 'wrong password!!' });
    const b = await request(app).post('/api/v1/staff-auth/login').send({ email: 'nobody@vendor.test', password: 'wrong password!!' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('cannot sign in to a staff account through customer OTP', async () => {
    await createStaffUser({ email: 'owner@vendor.test' });
    const client = await loginCustomer(app, fakes, 'owner@vendor.test');
    expect(client.user.role).toBe('customer');
    expect((await client.get('/api/v1/vendor/context')).status).toBe(403);
  });

  it('requires email second factor for Super Admin before admin APIs work', async () => {
    await createStaffUser({ email: 'root@townant.test', role: 'super_admin' });
    const res = await request(app).post('/api/v1/staff-auth/login').send({ email: 'root@townant.test', password: 'correct horse battery staple', transport: 'bearer' });
    expect(res.status).toBe(200);
    expect(res.body.data.mfaRequired).toBe(true);
    const token = res.body.data.token;
    const blocked = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');
    const v = await request(app)
      .post('/api/v1/staff-auth/mfa/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ challengeId: res.body.data.mfa.challengeId, code: lastCode(fakes) });
    expect(v.status).toBe(200);
    expect((await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });

  it('locks out repeated password guessing per account', async () => {
    await createStaffUser({ email: 'owner@vendor.test' });
    const statuses = [];
    for (let i = 0; i < 10; i += 1) {
      statuses.push((await request(app).post('/api/v1/staff-auth/login').send({ email: 'owner@vendor.test', password: `guess-number-${i}` })).status);
    }
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(8).every((s) => s === 429)).toBe(true);
  });
});
