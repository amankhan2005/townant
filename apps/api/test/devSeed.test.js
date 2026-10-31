import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateAhead, lastCode, resetDb, startTestServer, stopTestServer } from './helpers.js';

let app;
let fakes;
let models;
let seed;

const ADMIN_PASSWORD = 'dev-admin-Passw0rd!';
const VENDOR_PASSWORD = 'dev-vendor-Passw0rd!';
const credentials = { adminEmail: 'admin@townant.test', adminPassword: ADMIN_PASSWORD, vendorPassword: VENDOR_PASSWORD };

// The starter taxonomy slugs the demo data refers to (the seed never creates categories).
async function createDemoCategories() {
  const pairs = [...seed.DEMO_VENDORS.map((v) => v.category), ...seed.DEMO_APPLICATIONS.map((a) => a.category)];
  for (const [parentSlug, childSlug] of pairs) {
    const parent = (await models.Category.findOne({ slug: parentSlug })) ?? (await models.Category.create({ name: parentSlug, slug: parentSlug }));
    if (!(await models.Category.exists({ slug: childSlug }))) await models.Category.create({ name: childSlug, slug: childSlug, parentId: parent._id });
  }
}

const counts = async () => ({
  users: await models.User.countDocuments(),
  companies: await models.Company.countDocuments(),
  memberships: await models.Membership.countDocuments(),
  services: await models.Service.countDocuments(),
  applications: await models.VendorApplication.countDocuments(),
});

beforeAll(async () => {
  ({ app, fakes } = await startTestServer());
  models = await import('../src/models/index.js');
  seed = await import('../scripts/lib/devSeed.js');
});
afterAll(stopTestServer);
beforeEach(async () => {
  await resetDb();
  await createDemoCategories();
});

describe('development seed target guard', () => {
  const ok = { NODE_ENV: 'development', ALLOW_DEV_SEED: 'true', MONGODB_URI: 'mongodb://127.0.0.1:27018/townant?replicaSet=rs0' };
  const SRV = 'mongodb+srv://seed-user:Atlas-S3cret@cluster0.abcde.mongodb.net';
  const atlas = { NODE_ENV: 'development', ALLOW_DEV_SEED: 'true', CONFIRM_ATLAS_DEV_SEED: 'townant_dev_seed', MONGODB_URI: `${SRV}/townant_dev_seed?retryWrites=true&w=majority&appName=Cluster0` };

  it('accepts an opted-in local database and describes it without credentials', () => {
    expect(seed.assertSafeSeedTarget(ok)).toMatchObject({ kind: 'local', label: '127.0.0.1:27018', dbName: 'townant' });
    expect(seed.assertSafeSeedTarget({ ...ok, MONGODB_URI: 'mongodb://dev:s3cret@localhost:27017/townant_dev' })).toMatchObject({ kind: 'local', label: 'localhost:27017', dbName: 'townant_dev' });
  });

  it('accepts the dedicated Atlas development database with opt-in and confirmation, without exposing the host', () => {
    expect(seed.assertSafeSeedTarget(atlas)).toMatchObject({ kind: 'atlas', label: 'MongoDB Atlas', dbName: 'townant_dev_seed' });
    expect(seed.assertSafeSeedTarget({ ...atlas, NODE_ENV: 'test' }).kind).toBe('atlas');
    // Non-SRV Atlas strings list every replica set member.
    const members = 'ac-x-shard-00-00.abcde.mongodb.net:27017,ac-x-shard-00-01.abcde.mongodb.net:27017,ac-x-shard-00-02.abcde.mongodb.net:27017';
    expect(seed.assertSafeSeedTarget({ ...atlas, MONGODB_URI: `mongodb://u:p@${members}/townant_dev_seed?ssl=true&replicaSet=atlas-x&authSource=admin` })).toMatchObject({ kind: 'atlas', label: 'MongoDB Atlas', dbName: 'townant_dev_seed' });
  });

  it.each([
    ['production (local)', { ...ok, NODE_ENV: 'production' }, /NODE_ENV is "production"/],
    ['production (Atlas, fully confirmed)', { ...atlas, NODE_ENV: 'production' }, /NODE_ENV is "production"/],
    ['no opt-in (local)', { ...ok, ALLOW_DEV_SEED: undefined }, /ALLOW_DEV_SEED/],
    ['no opt-in (Atlas)', { ...atlas, ALLOW_DEV_SEED: undefined }, /ALLOW_DEV_SEED/],
    ['opt-in that is not exactly "true"', { ...atlas, ALLOW_DEV_SEED: 'yes' }, /ALLOW_DEV_SEED/],
    ['Atlas without a database name', { ...atlas, MONGODB_URI: `${SRV}/?retryWrites=true` }, /names no database/],
    ['Atlas without a path', { ...atlas, MONGODB_URI: SRV }, /names no database/],
    ['Atlas with another database', { ...atlas, MONGODB_URI: `${SRV}/townant?retryWrites=true` }, /exactly "townant_dev_seed"/],
    ['Atlas with a production database', { ...atlas, MONGODB_URI: `${SRV}/townant_prod` }, /exactly "townant_dev_seed"/],
    ['Atlas with a look-alike name', { ...atlas, MONGODB_URI: `${SRV}/townant_dev_seed2` }, /exactly "townant_dev_seed"/],
    ['Atlas with different letter case', { ...atlas, MONGODB_URI: `${SRV}/TownAnt_Dev_Seed` }, /exactly "townant_dev_seed"/],
    ['Atlas without confirmation', { ...atlas, CONFIRM_ATLAS_DEV_SEED: undefined }, /CONFIRM_ATLAS_DEV_SEED=townant_dev_seed/],
    ['Atlas with a wrong confirmation', { ...atlas, CONFIRM_ATLAS_DEV_SEED: 'true' }, /CONFIRM_ATLAS_DEV_SEED=townant_dev_seed/],
    ['a non-Atlas SRV host', { ...atlas, MONGODB_URI: 'mongodb+srv://u:p@db.example.com/townant_dev_seed' }, /local server .* or MongoDB Atlas/],
    ['a host that only contains mongodb.net', { ...atlas, MONGODB_URI: 'mongodb+srv://u:p@cluster0.mongodb.net.evil.example/townant_dev_seed' }, /local server .* or MongoDB Atlas/],
    ['a remote host', { ...ok, MONGODB_URI: 'mongodb://db.example.com:27017/townant_dev_seed' }, /local server .* or MongoDB Atlas/],
    ['local and remote replica members mixed', { ...ok, MONGODB_URI: 'mongodb://127.0.0.1:27017,10.0.0.5:27017/townant' }, /local server .* or MongoDB Atlas/],
    ['Atlas and other replica members mixed', { ...atlas, MONGODB_URI: 'mongodb://a.abcde.mongodb.net:27017,10.0.0.5:27017/townant_dev_seed' }, /local server .* or MongoDB Atlas/],
    ['a production-looking local name', { ...ok, MONGODB_URI: 'mongodb://127.0.0.1:27017/townant_prod' }, /production database/],
    ['a missing URI', { ...ok, MONGODB_URI: undefined }, /mongodb:\/\/ or mongodb\+srv:\/\//],
    ['an empty URI', { ...ok, MONGODB_URI: '   ' }, /mongodb:\/\/ or mongodb\+srv:\/\//],
    ['another scheme', { ...ok, MONGODB_URI: 'postgres://127.0.0.1/townant' }, /mongodb:\/\/ or mongodb\+srv:\/\//],
    ['a URI with no host', { ...atlas, MONGODB_URI: 'mongodb+srv:///townant_dev_seed' }, /no valid host/],
    ['a malformed database name', { ...atlas, MONGODB_URI: `${SRV}/%E0%A4%A` }, /invalid database name/],
  ])('refuses %s', (_label, env, message) => {
    expect(() => seed.assertSafeSeedTarget(env)).toThrow(message);
  });

  it('never echoes a refused URI, its password or an Atlas host', () => {
    const messages = [
      { ...ok, MONGODB_URI: 'mongodb://user:hunter2-secret@db.example.com/townant' },
      { ...atlas, MONGODB_URI: 'mongodb+srv://user:hunter2-secret@cluster0.abcde.mongodb.net/townant' },
      { ...atlas, CONFIRM_ATLAS_DEV_SEED: undefined, MONGODB_URI: 'mongodb+srv://user:hunter2-secret@cluster0.abcde.mongodb.net/townant_dev_seed' },
      { ...atlas, NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://user:hunter2-secret@cluster0.abcde.mongodb.net/townant_dev_seed' },
    ].map((env) => {
      try {
        seed.assertSafeSeedTarget(env);
        return '';
      } catch (err) {
        return err.message;
      }
    });
    expect(messages.every(Boolean)).toBe(true);
    for (const m of messages) expect(m).not.toMatch(/hunter2|user:|example\.com|cluster0|abcde|mongodb\.net\//);
  });

  it('checks the connected database and host before any write', () => {
    const atlasTarget = seed.assertSafeSeedTarget(atlas);
    expect(() => seed.assertConnectedTarget({ databaseName: 'townant_dev_seed', host: 'ac-x-shard-00-01.abcde.mongodb.net' }, atlasTarget)).not.toThrow();
    expect(() => seed.assertConnectedTarget({ databaseName: 'townant', host: 'ac-x-shard-00-01.abcde.mongodb.net' }, atlasTarget)).toThrow(/expected "townant_dev_seed"/);
    expect(() => seed.assertConnectedTarget({ databaseName: 'townant_dev_seed', host: '10.0.0.5' }, atlasTarget)).toThrow(/not the expected Atlas host/);
    const localTarget = seed.assertSafeSeedTarget(ok);
    expect(() => seed.assertConnectedTarget({ databaseName: 'townant', host: '127.0.0.1' }, localTarget)).not.toThrow();
    expect(() => seed.assertConnectedTarget({ databaseName: 'townant', host: 'cluster0.abcde.mongodb.net' }, localTarget)).toThrow(/not the expected local host/);
  });

  it('requires both passwords and applies the staff password policy', () => {
    expect(seed.checkSeedCredentials(credentials)).toEqual([]);
    const problems = seed.checkSeedCredentials({ adminEmail: 'admin@townant.test', adminPassword: 'short', vendorPassword: undefined });
    expect(problems).toEqual([expect.stringMatching(/^DEV_SUPER_ADMIN_PASSWORD: /), 'DEV_VENDOR_PASSWORD is not set']);
    expect(problems.join(' ')).not.toContain('short');
  });
});

describe('development seed data', () => {
  it('creates a Super Admin, ten vendors and two pending applications, and is idempotent', async () => {
    const first = await seed.seedDevData(credentials);
    expect(first.vendors.filter((v) => v.error)).toEqual([]);
    expect(first.vendors).toHaveLength(10);
    expect(new Set(first.vendors.map((v) => v.email)).size).toBe(10);
    expect(first.vendors.map((v) => v.status)).toEqual(['published', 'published', 'published', 'published', 'published', 'published', 'published', 'draft', 'draft', 'suspended']);
    expect(first.applications.map((a) => a.status)).toEqual(['submitted', 'under_review']);
    expect(JSON.stringify(first)).not.toMatch(/Passw0rd|scrypt\$/);

    const before = await counts();
    expect(before).toMatchObject({ users: 11, companies: 10, memberships: 10, applications: 2 });

    const second = await seed.seedDevData(credentials);
    expect(await counts()).toEqual(before);
    expect(second.admin.outcome).toBe('existing (password unchanged)');
    expect(second.vendors.every((v) => v.outcome === 'existing' && v.account === 'existing (password unchanged)')).toBe(true);
  });

  it('links every business to its owner, existing categories and services', async () => {
    await seed.seedDevData(credentials);
    const companies = await models.Company.find({ slug: /^demo-/ });
    for (const c of companies) {
      const owner = await models.Membership.findOne({ companyId: c._id, role: 'owner', status: 'active' });
      const user = await models.User.findById(owner.userId);
      expect(user).toMatchObject({ accountType: 'staff', role: 'vendor', status: 'active' });
      expect(await models.Category.countDocuments({ _id: { $in: c.categoryIds } })).toBe(c.categoryIds.length);
      expect(await models.Service.countDocuments({ companyId: c._id, isActive: true })).toBeGreaterThan(0);
      expect(c.summary).toMatch(/^Demo listing/);
    }
  });

  it('does not overwrite an existing password unless asked, and refuses to change another role', async () => {
    await seed.seedDevData(credentials);
    const other = { ...credentials, adminPassword: 'another-admin-Passw0rd', vendorPassword: 'another-vendor-Passw0rd' };
    await seed.seedDevData(other);
    expect((await request(app).post('/api/v1/staff-auth/login').send({ email: seed.vendorEmail(1), password: VENDOR_PASSWORD })).status).toBe(200);

    await seed.seedDevData({ ...other, resetPasswords: true });
    expect((await request(app).post('/api/v1/staff-auth/login').send({ email: seed.vendorEmail(1), password: 'another-vendor-Passw0rd' })).status).toBe(200);
    await models.RateLimitBucket.deleteMany({});

    await models.User.create({ accountType: 'staff', role: 'vendor', status: 'active', email: 'taken@townant.test' });
    await expect(seed.seedDevData({ ...credentials, adminEmail: 'taken@townant.test' })).rejects.toThrow(/vendor account/);
    expect(await models.User.findOne({ email: 'taken@townant.test' })).toMatchObject({ role: 'vendor' });
  });

  it('can seed the starter categories into an empty database first, without changing existing ones', async () => {
    const { seedCategories } = await import('../scripts/lib/categories.js');
    await models.Category.deleteMany({});
    await models.Category.create({ name: 'Cleaning (renamed by admin)', slug: 'cleaning', isActive: false });
    const total = await seedCategories();
    expect(await seedCategories()).toBe(total);
    expect(await models.Category.findOne({ slug: 'cleaning' })).toMatchObject({ name: 'Cleaning (renamed by admin)', isActive: false });
    const summary = await seed.seedDevData(credentials);
    expect(summary.vendors.filter((v) => v.error)).toEqual([]);
  });

  it('reports a missing category instead of inventing one', async () => {
    await models.Category.deleteMany({ slug: { $in: ['pet-care', 'pet-grooming'] } });
    const summary = await seed.seedDevData(credentials);
    expect(summary.vendors.find((v) => v.business === 'Paws & Suds Grooming').error).toMatch(/seed:categories/);
    expect(await models.Category.exists({ slug: 'pet-care' })).toBeNull();
  });

  it('signs in through the normal staff flow: Super Admin with email MFA, vendors into their own business', async () => {
    await seed.seedDevData(credentials);

    const login = await request(app).post('/api/v1/staff-auth/login').send({ email: 'admin@townant.test', password: ADMIN_PASSWORD, transport: 'bearer' });
    expect(login.status).toBe(200);
    expect(login.body.data.mfa).toBeTruthy();
    const auth = (r) => r.set('Authorization', `Bearer ${login.body.data.token}`);
    // Until the emailed code is verified the session cannot reach the console.
    expect((await auth(request(app).get('/api/v1/admin/applications'))).status).toBe(401);
    const mfa = await auth(request(app).post('/api/v1/staff-auth/mfa/verify')).send({ challengeId: login.body.data.mfa.challengeId, code: lastCode(fakes) });
    expect(mfa.status).toBe(200);
    const apps = await auth(request(app).get('/api/v1/admin/applications'));
    expect(apps.status).toBe(200);
    expect(apps.body.data.map((a) => a.businessName)).toEqual(expect.arrayContaining(['Corner Nail Bar', 'Steady Hands Handyman']));

    const vendor = await request(app).post('/api/v1/staff-auth/login').send({ email: seed.vendorEmail(8), password: VENDOR_PASSWORD, transport: 'bearer' });
    expect(vendor.status).toBe(200);
    expect(vendor.body.data.mfa).toBeFalsy();
    const context = await request(app).get('/api/v1/vendor/context').set('Authorization', `Bearer ${vendor.body.data.token}`);
    expect(context.status).toBe(200);
    expect(context.body.data).toMatchObject({ role: 'owner', company: { slug: 'demo-keynote-music-lessons', status: 'draft' } });
    // Vendor 8 is complete, so it can publish; vendor 9 has no hours and is told why.
    expect((await request(app).post('/api/v1/vendor/company/publish').set('Authorization', `Bearer ${vendor.body.data.token}`)).status).toBe(200);
    const incomplete = await request(app).post('/api/v1/staff-auth/login').send({ email: seed.vendorEmail(9), password: VENDOR_PASSWORD, transport: 'bearer' });
    const publish = await request(app).post('/api/v1/vendor/company/publish').set('Authorization', `Bearer ${incomplete.body.data.token}`);
    expect(publish.status).toBe(422);
    expect(publish.body.error.details.missing).toEqual(['opening hours']);
  });

  it('shows only published demo businesses publicly, with bookable times', async () => {
    await seed.seedDevData(credentials);
    const list = await request(app).get('/api/v1/catalog/companies').query({ limit: 50 });
    expect(list.status).toBe(200);
    const slugs = list.body.data.map((c) => c.slug);
    expect(slugs).toHaveLength(7);
    expect(slugs).not.toContain('demo-keynote-music-lessons');
    expect(slugs).not.toContain('demo-frame-and-focus-photography');
    expect((await request(app).get('/api/v1/catalog/companies/demo-frame-and-focus-photography')).status).toBe(404);

    const company = await models.Company.findOne({ slug: 'demo-northside-barber-co' });
    const service = await models.Service.findOne({ companyId: company._id, title: 'Classic haircut' });
    let slots = [];
    for (let day = 2; day <= 8 && !slots.length; day += 1) {
      const res = await request(app).get(`/api/v1/catalog/companies/${company.slug}/slots`).query({ serviceId: service._id.toString(), date: dateAhead(day) });
      expect(res.status).toBe(200);
      slots = res.body.data.slots;
    }
    expect(slots.length).toBeGreaterThan(0);
  });
});

describe('seeded Super Admin sign-in (regression: 401 then 429 at /admin/login)', () => {
  const login = (agent, password, email = 'admin@townant.test') => agent.post('/api/v1/staff-auth/login').send({ email, password });
  afterEach(() => vi.useRealTimers());

  it('signs in through the browser flow: password, cookie session pending MFA, emailed code, full session', async () => {
    await seed.seedDevData(credentials);
    const agent = request.agent(app);
    const res = await login(agent, ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ user: { role: 'super_admin', email: 'admin@townant.test' }, mfaRequired: true, mfa: { challengeId: expect.any(String) } });
    expect(res.body.data.token).toBeUndefined();
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('ta_sid='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api/);

    const session = await models.Session.findOne({ userId: res.body.data.user.id });
    expect(session).toMatchObject({ transport: 'cookie', mfaRequired: true });
    expect(session.mfaVerifiedAt ?? null).toBeNull();
    expect((await agent.get('/api/v1/auth/session')).body.data).toMatchObject({ mfaRequired: true });
    expect((await agent.get('/api/v1/admin/applications')).status).toBe(401);

    // The code goes to the email provider (the dev outbox in development), never the response.
    expect(JSON.stringify(res.body)).not.toContain(lastCode(fakes));
    const csrf = { 'X-CSRF-Token': res.body.data.csrfToken };
    expect((await agent.post('/api/v1/staff-auth/mfa/verify').send({ challengeId: res.body.data.mfa.challengeId, code: '000000' }).set(csrf)).status).toBe(400);
    const verified = await agent.post('/api/v1/staff-auth/mfa/verify').set(csrf).send({ challengeId: res.body.data.mfa.challengeId, code: lastCode(fakes) });
    expect(verified.status).toBe(200);
    expect((await models.Session.findById(session._id)).mfaVerifiedAt).toBeInstanceOf(Date);
    expect((await agent.get('/api/v1/auth/session')).body.data).toMatchObject({ mfaRequired: false, user: { role: 'super_admin' } });
    expect((await agent.get('/api/v1/admin/applications')).status).toBe(200);
  });

  it('answers a wrong password and an account missing from the API database with the same 401', async () => {
    // Before seeding: the situation when the API reads a different database than the seed wrote.
    const missing = await login(request(app), ADMIN_PASSWORD);
    await seed.seedDevData(credentials);
    const wrong = await login(request(app), 'not-the-admin-password');
    for (const r of [missing, wrong]) {
      expect(r.status).toBe(401);
      expect(r.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    expect(await models.Session.countDocuments()).toBe(0);
  });

  it('locks the account after 8 attempts in a 15-minute window, even with the right password, and lifts when the window ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-29T11:16:00Z') });
    await seed.seedDevData(credentials);
    for (let i = 0; i < 8; i += 1) expect((await login(request(app), `wrong-guess-${i}`)).status).toBe(401);

    const limited = await login(request(app), ADMIN_PASSWORD);
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatchObject({ code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
    expect(Number(limited.headers['retry-after'])).toBe(14 * 60);
    expect(await models.Session.countDocuments()).toBe(0);

    // The per-email limit doesn't lock other accounts out (the per-IP limit of 20 still applies).
    expect((await login(request(app), VENDOR_PASSWORD, seed.vendorEmail(1))).status).toBe(200);

    // Fixed windows aligned to the clock: this one ends at 11:30:00Z. No reset is needed.
    vi.setSystemTime(new Date('2026-10-29T11:30:01Z'));
    const after = await login(request(app), ADMIN_PASSWORD);
    expect(after.status).toBe(200);
    expect(after.body.data.mfaRequired).toBe(true);
  });
});

describe('Super Admin second sign-in while the first code is still fresh (regression: 429 OTP_COOLDOWN)', () => {
  const login = (agent) => agent.post('/api/v1/staff-auth/login').send({ email: 'admin@townant.test', password: ADMIN_PASSWORD });

  it('continues with the code already sent instead of failing, and the code still works', async () => {
    await seed.seedDevData(credentials);
    const first = await login(request(app));
    const emailsAfterFirst = fakes.sent.email.length;
    const code = lastCode(fakes);

    const agent = request.agent(app);
    const second = await login(agent);
    expect(second.status).toBe(200);
    expect(second.body.data.mfa.challengeId).toBe(first.body.data.mfa.challengeId);
    expect(fakes.sent.email.length).toBe(emailsAfterFirst);
    const verified = await agent.post('/api/v1/staff-auth/mfa/verify').set('X-CSRF-Token', second.body.data.csrfToken).send({ challengeId: second.body.data.mfa.challengeId, code });
    expect(verified.status).toBe(200);
  });

  it('does not spend the hourly code budget when resuming', async () => {
    await seed.seedDevData(credentials);
    const before = fakes.sent.email.length;
    const ids = new Set();
    for (let i = 0; i < 6; i += 1) {
      const r = await login(request(app));
      expect(r.status).toBe(200);
      ids.add(r.body.data.mfa.challengeId);
    }
    expect(ids.size).toBe(1);
    expect(fakes.sent.email.length - before).toBe(1);
    const sendBuckets = await models.RateLimitBucket.find({ _id: /^otp-send:dest:/ }).lean();
    expect(sendBuckets.map((b) => b.count)).toEqual([1]);
  });

  it('keeps the strict cooldown for an explicit "send a new code"', async () => {
    await seed.seedDevData(credentials);
    const agent = request.agent(app);
    const res = await login(agent);
    const resend = await agent.post('/api/v1/staff-auth/mfa/resend').set('X-CSRF-Token', res.body.data.csrfToken);
    expect(resend.status).toBe(429);
    expect(resend.body.error.code).toBe('OTP_COOLDOWN');
  });

  it('does not resume a code that was used up, and sends a new one once the cooldown allows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-29T12:00:00Z') });
    await seed.seedDevData(credentials);
    const first = await login(request(app));
    await models.OtpChallenge.updateOne({ challengeId: first.body.data.mfa.challengeId }, { $set: { attempts: 5 } });
    const blocked = await login(request(app));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('OTP_COOLDOWN');
    vi.setSystemTime(new Date('2026-10-29T12:01:05Z'));
    const fresh = await login(request(app));
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.mfa.challengeId).not.toBe(first.body.data.mfa.challengeId);
    vi.useRealTimers();
  });

  it('creates no session or cookie when the code cannot be sent', async () => {
    await seed.seedDevData(credentials);
    fakes.failNext.email = true;
    const res = await login(request(app));
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('OTP_DELIVERY_FAILED');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await models.Session.countDocuments()).toBe(0);
  });
});

describe('API / seed database agreement', () => {
  const local = { NODE_ENV: 'development', ALLOW_DEV_SEED: 'true', MONGODB_URI: 'mongodb://127.0.0.1:27018/townant_dev_seed?replicaSet=rs0' };
  const atlasEnv = { NODE_ENV: 'development', ALLOW_DEV_SEED: 'true', CONFIRM_ATLAS_DEV_SEED: 'townant_dev_seed', MONGODB_URI: 'mongodb+srv://u:Secr3t@cluster0.abcde.mongodb.net/townant_dev_seed?retryWrites=true' };

  it('reads the database name from a connection string', async () => {
    const { uriDatabaseName } = await import('../src/db.js');
    expect(uriDatabaseName('mongodb+srv://u:p@cluster0.abcde.mongodb.net/?retryWrites=true')).toBe('');
    expect(uriDatabaseName('mongodb+srv://u:p@cluster0.abcde.mongodb.net')).toBe('');
    expect(uriDatabaseName('mongodb+srv://u:p@cluster0.abcde.mongodb.net/townant_dev_seed?w=majority')).toBe('townant_dev_seed');
    expect(uriDatabaseName('mongodb://127.0.0.1:27018/townant?replicaSet=rs0')).toBe('townant');
  });

  it('warns when the API would read another database or server than the one seeded, without printing either', () => {
    const target = seed.assertSafeSeedTarget(atlasEnv);
    const cases = {
      noDb: seed.apiTargetNote('mongodb+srv://u:Secr3t@cluster0.abcde.mongodb.net/?retryWrites=true', target),
      otherDb: seed.apiTargetNote('mongodb+srv://u:Secr3t@cluster0.abcde.mongodb.net/townant', target),
      otherServer: seed.apiTargetNote('mongodb://127.0.0.1:27018/townant_dev_seed', target),
      missing: seed.apiTargetNote(undefined, target),
      invalid: seed.apiTargetNote('not a uri', target),
      same: seed.apiTargetNote('mongodb+srv://other-user:Other@cluster0.abcde.mongodb.net/townant_dev_seed?appName=x', target),
    };
    expect(cases.noDb).toMatchObject({ ok: false, message: expect.stringMatching(/names no database, so MongoDB uses "test"/) });
    expect(cases.otherDb).toMatchObject({ ok: false, message: expect.stringMatching(/uses the database "townant", not "townant_dev_seed"/) });
    expect(cases.otherServer).toMatchObject({ ok: false, message: expect.stringMatching(/different server/) });
    expect(cases.missing.ok).toBe(false);
    expect(cases.invalid.ok).toBe(false);
    expect(cases.same.ok).toBe(true);
    for (const { message } of Object.values(cases)) expect(message).not.toMatch(/Secr3t|Other@|cluster0|abcde|127\.0\.0\.1|u:/);
    expect(seed.apiTargetNote('mongodb://localhost:27018/townant_dev_seed', seed.assertSafeSeedTarget(local)).ok).toBe(false);
    expect(seed.apiTargetNote('mongodb://127.0.0.1:27018/townant_dev_seed?replicaSet=rs0', seed.assertSafeSeedTarget(local)).ok).toBe(true);
  });
});
