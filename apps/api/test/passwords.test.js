import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStaffUser, createVendor, lastCode, loginAdmin, loginCustomer, loginStaff, resetDb, startTestServer, stopTestServer } from './helpers.js';

let app;
let fakes;
let models;

beforeAll(async () => {
  ({ app, fakes } = await startTestServer());
  models = await import('../src/models/index.js');
});
afterAll(stopTestServer);
beforeEach(resetDb);

const OLD = 'correct horse battery staple';
const resetToken = () => fakes.sent.email.at(-1).text.match(/token=([A-Za-z0-9_-]+)/)[1];

describe('Super Admin password management', () => {
  it('changes the password with current-password verification and signs out other sessions', async () => {
    const admin = await loginAdmin(app, fakes, 'root@townant.test');
    await models.OtpChallenge.deleteMany({});
    const otherDevice = await loginStaff(app, fakes, 'root@townant.test');
    const change = (body) => admin.post('/api/v1/staff-auth/password/change').send(body);
    expect((await change({ currentPassword: 'wrong password!!', newPassword: 'a brand new admin phrase' })).status).toBe(401);
    expect((await change({ currentPassword: OLD, newPassword: 'short' })).status).toBe(400);
    expect((await change({ currentPassword: OLD, newPassword: 'a brand new admin phrase', confirmPassword: 'a different phrase here' })).status).toBe(400);
    const ok = await change({ currentPassword: OLD, newPassword: 'a brand new admin phrase', confirmPassword: 'a brand new admin phrase' });
    expect(ok.status).toBe(200);
    expect((await admin.get('/api/v1/admin/site')).status).toBe(200);
    expect((await otherDevice.get('/api/v1/admin/site')).status).toBe(401);
    expect((await request(app).post('/api/v1/staff-auth/login').send({ email: 'root@townant.test', password: OLD })).status).toBe(401);
    // The stored value is a scrypt hash, never the password.
    const stored = await models.User.findOne({ email: 'root@townant.test' }).select('+passwordHash').lean();
    expect(stored.passwordHash).toMatch(/^scrypt\$/);
    expect(stored.passwordHash).not.toContain('brand new');
  });

  it('recovers access with a single-use emailed link and a generic response for unknown addresses', async () => {
    await createStaffUser({ email: 'root@townant.test', role: 'super_admin' });
    const before = fakes.sent.email.length;
    const unknown = await request(app).post('/api/v1/staff-auth/password/forgot').send({ email: 'nobody@townant.test' });
    const known = await request(app).post('/api/v1/staff-auth/password/forgot').send({ email: 'root@townant.test' });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(fakes.sent.email.length).toBe(before + 1);
    expect(fakes.sent.email.at(-1).text).toContain('/admin/reset-password?token=');
    const token = resetToken();
    expect((await request(app).post('/api/v1/staff-auth/password/reset').send({ token, password: 'recovered admin phrase 1' })).status).toBe(200);
    expect((await request(app).post('/api/v1/staff-auth/password/reset').send({ token, password: 'another admin phrase 22' })).status).toBe(400);
    // Signing in still needs the emailed second factor.
    const login = await request(app).post('/api/v1/staff-auth/login').send({ email: 'root@townant.test', password: 'recovered admin phrase 1', transport: 'bearer' });
    expect(login.status).toBe(200);
    expect(login.body.data.mfaRequired).toBe(true);
    expect((await request(app).get('/api/v1/admin/site').set('Authorization', `Bearer ${login.body.data.token}`)).status).toBe(401);
  });
});

describe('vendor password management', () => {
  it('changes and recovers a vendor password', async () => {
    const { client } = await createVendor(app, fakes, { email: 'owner@vendor.test' });
    expect((await client.post('/api/v1/staff-auth/password/change').send({ currentPassword: OLD, newPassword: 'vendor updated phrase 1', confirmPassword: 'vendor updated phrase 1' })).status).toBe(200);
    expect((await request(app).post('/api/v1/staff-auth/password/forgot').send({ email: 'owner@vendor.test' })).status).toBe(202);
    expect(fakes.sent.email.at(-1).text).toContain('/business/reset-password?token=');
    const token = resetToken();
    expect((await request(app).post('/api/v1/staff-auth/password/reset').send({ token, password: 'vendor recovered phrase 2' })).status).toBe(200);
    // Resets end every session.
    expect((await client.get('/api/v1/vendor/context')).status).toBe(401);
    expect((await request(app).post('/api/v1/staff-auth/login').send({ email: 'owner@vendor.test', password: 'vendor recovered phrase 2' })).status).toBe(200);
  });
});

describe('customer passwords (optional, alongside one-time codes)', () => {
  it('adds a password only after a fresh code, then signs in with either method', async () => {
    const alice = await loginCustomer(app, fakes, 'alice@example.com');
    expect(alice.user.hasPassword).toBe(false);
    // Without a code a first password can't be added.
    expect((await alice.put('/api/v1/me/password').send({ newPassword: 'alice long secret 77', confirmPassword: 'alice long secret 77' })).status).toBe(400);
    const ch = await alice.post('/api/v1/me/password/challenge').send({});
    expect(ch.status).toBe(201);
    expect(fakes.sent.email.at(-1).to).toBe('alice@example.com');
    const code = lastCode(fakes);
    expect((await alice.put('/api/v1/me/password').send({ newPassword: 'alice long secret 77', confirmPassword: 'alice long secret 77', channel: 'email', challengeId: ch.body.data.challengeId, code: code === '000000' ? '111111' : '000000' })).status).toBe(400);
    const added = await alice.put('/api/v1/me/password').send({ newPassword: 'alice long secret 77', confirmPassword: 'alice long secret 77', channel: 'email', challengeId: ch.body.data.challengeId, code });
    expect(added.status).toBe(200);
    expect(added.body.data.user.hasPassword).toBe(true);

    const pw = (password) => request(app).post('/api/v1/auth/password/login').send({ channel: 'email', email: 'alice@example.com', password, transport: 'bearer' });
    const wrong = await pw('not my password at all');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await request(app).post('/api/v1/auth/password/login').send({ channel: 'email', email: 'nobody@example.com', password: 'alice long secret 77' })).body.error.code).toBe('INVALID_CREDENTIALS');
    const ok = await pw('alice long secret 77');
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.id).toBe(alice.user.id);

    // One-time codes keep working for the same account.
    await models.OtpChallenge.deleteMany({});
    const viaCode = await loginCustomer(app, fakes, 'alice@example.com');
    expect(viaCode.user.id).toBe(alice.user.id);

    // Changing needs the current password; removing it leaves OTP sign-in.
    expect((await alice.put('/api/v1/me/password').send({ currentPassword: 'wrong one here', newPassword: 'alice newer secret 88', confirmPassword: 'alice newer secret 88' })).status).toBe(401);
    expect((await alice.put('/api/v1/me/password').send({ currentPassword: 'alice long secret 77', newPassword: 'alice newer secret 88', confirmPassword: 'alice newer secret 88' })).status).toBe(200);
    expect((await alice.delete('/api/v1/me/password').send({ currentPassword: 'alice newer secret 88' })).body.data.user.hasPassword).toBe(false);
    expect((await pw('alice newer secret 88')).status).toBe(401);
  });

  it('resets a forgotten password with a code bound to the account, without revealing which addresses exist', async () => {
    const alice = await loginCustomer(app, fakes, 'alice@example.com');
    const noPassword = await loginCustomer(app, fakes, 'nopass@example.com');
    const ch = await alice.post('/api/v1/me/password/challenge').send({});
    await alice.put('/api/v1/me/password').send({ newPassword: 'alice long secret 77', confirmPassword: 'alice long secret 77', channel: 'email', challengeId: ch.body.data.challengeId, code: lastCode(fakes) });
    await models.OtpChallenge.deleteMany({});
    await models.RateLimitBucket.deleteMany({});

    const before = fakes.sent.email.length;
    const ghost = await request(app).post('/api/v1/auth/password/forgot').send({ channel: 'email', email: 'ghost@example.com' });
    const nopass = await request(app).post('/api/v1/auth/password/forgot').send({ channel: 'email', email: 'nopass@example.com' });
    expect(fakes.sent.email.length).toBe(before);
    const real = await request(app).post('/api/v1/auth/password/forgot').send({ channel: 'email', email: 'alice@example.com' });
    expect(fakes.sent.email.length).toBe(before + 1);
    for (const r of [ghost, nopass, real]) {
      expect(r.status).toBe(201);
      expect(Object.keys(r.body.data).sort()).toEqual(['challengeId', 'channel', 'expiresAt', 'maskedDestination', 'message', 'resendAvailableAt']);
    }
    const code = lastCode(fakes);
    // A decoy challenge never works, and the real code doesn't work for another account.
    expect((await request(app).post('/api/v1/auth/password/reset').send({ channel: 'email', email: 'ghost@example.com', challengeId: ghost.body.data.challengeId, code, password: 'some new phrase 123' })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/password/reset').send({ channel: 'email', email: 'nopass@example.com', challengeId: real.body.data.challengeId, code, password: 'some new phrase 123' })).status).toBe(400);
    const reset = await request(app).post('/api/v1/auth/password/reset').send({ channel: 'email', email: 'alice@example.com', challengeId: real.body.data.challengeId, code, password: 'reset long phrase 456', confirmPassword: 'reset long phrase 456' });
    expect(reset.status).toBe(200);
    expect((await alice.get('/api/v1/me')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/password/login').send({ channel: 'email', email: 'alice@example.com', password: 'reset long phrase 456' })).status).toBe(200);
    expect((await noPassword.get('/api/v1/me')).status).toBe(200);
    // Staff accounts are unaffected by customer password routes.
    const { client: vendor } = await createVendor(app, fakes);
    expect((await vendor.put('/api/v1/me/password').send({ newPassword: 'vendor via me route', confirmPassword: 'vendor via me route' })).status).toBe(403);
  });
});
