// Shared test harness: an in-memory single-node replica set (transactions enabled),
// the real Express app, and fake providers that record what would have been sent.
import { existsSync } from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

for (const candidate of ['/opt/homebrew/bin/mongod', '/usr/local/bin/mongod', '/usr/bin/mongod']) {
  if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync(candidate)) process.env.MONGOMS_SYSTEM_BINARY = candidate;
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_BASE_URL: 'http://localhost:5173',
  CORS_ORIGINS: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  OTP_PEPPER: 'test-pepper-0123456789abcdefghijklmnopqrstuvwxyz',
  MONGODB_URI: 'mongodb://placeholder',
  RUN_WORKER: 'false',
});

let replSet;

export async function startTestServer() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = replSet.getUri('townant-test');
  const { resetEnvCache } = await import('../src/config/env.js');
  resetEnvCache();
  const { connectDb } = await import('../src/db.js');
  await connectDb(process.env.MONGODB_URI);
  const { createApp } = await import('../src/app.js');
  const { setProviderOverrides } = await import('../src/providers/index.js');
  const fakes = createFakes();
  setProviderOverrides(fakes);
  return { app: createApp(), fakes };
}

export async function stopTestServer() {
  await mongoose.disconnect();
  await replSet?.stop();
}

export async function resetDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export function createFakes() {
  const sent = { email: [], whatsapp: [], push: [], uploads: [], destroyed: [] };
  const fakes = {
    sent,
    failNext: { email: false, whatsapp: false },
    aiResponse: null,
    transcript: null,
    email: {
      name: 'fake-email',
      async send(msg) {
        if (fakes.failNext.email) {
          fakes.failNext.email = false;
          const { ProviderError } = await import('../src/providers/http.js');
          throw new ProviderError('fake-email', 'HTTP 500', { status: 500, retryable: true });
        }
        sent.email.push(msg);
        return { id: `email-${sent.email.length}` };
      },
    },
    whatsapp: {
      name: 'fake-whatsapp',
      async sendOtp(msg) {
        if (fakes.failNext.whatsapp) {
          fakes.failNext.whatsapp = false;
          throw new Error('whatsapp down');
        }
        sent.whatsapp.push(msg);
        return { id: `wa-${sent.whatsapp.length}` };
      },
    },
    push: {
      name: 'fake-push',
      async send(messages) {
        sent.push.push(...messages);
        return messages.map((_m, i) => ({ ok: true, id: `push-${i}` }));
      },
    },
    media: {
      name: 'fake-media',
      async upload({ folder, publicId, buffer }) {
        sent.uploads.push({ folder, publicId });
        return { publicId: `${folder}/${publicId}`, url: `https://res.cloudinary.com/demo/image/upload/${folder}/${publicId}.png`, width: 10, height: 10, bytes: buffer.length, format: 'png' };
      },
      async destroy(publicId) {
        sent.destroyed.push(publicId);
      },
    },
    ai: {
      name: 'fake-ai',
      calls: [],
      async completeJson(args) {
        fakes.ai.calls.push(args);
        if (!fakes.aiResponse) throw new Error('ai offline');
        return typeof fakes.aiResponse === 'function' ? fakes.aiResponse(args) : fakes.aiResponse;
      },
      async transcribe({ buffer, mimeType }) {
        if (!fakes.transcript) throw new Error('stt offline');
        sent.transcriptions = [...(sent.transcriptions ?? []), { bytes: buffer.length, mimeType }];
        return { text: fakes.transcript };
      },
    },
  };
  return fakes;
}

export const lastCode = (fakes, channel = 'email') => {
  const list = fakes.sent[channel];
  const msg = list[list.length - 1];
  return channel === 'email' ? msg.text.match(/\b(\d{6})\b/)[1] : msg.code;
};

// Signs in a customer via email OTP and returns an authenticated bearer client.
export async function loginCustomer(app, fakes, email, { displayName } = {}) {
  const r1 = await request(app).post('/api/v1/auth/otp/request').send({ channel: 'email', email });
  if (r1.status !== 201) throw new Error(`otp request failed ${r1.status} ${JSON.stringify(r1.body)}`);
  const code = lastCode(fakes);
  const r2 = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ channel: 'email', email, challengeId: r1.body.data.challengeId, code, transport: 'bearer', displayName });
  if (r2.status !== 200) throw new Error(`otp verify failed ${r2.status} ${JSON.stringify(r2.body)}`);
  // Each OTP request starts a resend cooldown; clear it so tests can sign in repeatedly.
  const { OtpChallenge, RateLimitBucket } = await import('../src/models/index.js');
  await OtpChallenge.deleteMany({});
  await RateLimitBucket.deleteMany({});
  return bearerClient(app, r2.body.data.token, r2.body.data.user);
}

export function bearerClient(app, token, user) {
  const wrap = (method) => (url) => request(app)[method](url).set('Authorization', `Bearer ${token}`);
  return { token, user, get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
}

export async function createStaffUser({ email, role = 'vendor', password = 'correct horse battery staple' }) {
  const { User } = await import('../src/models/index.js');
  const { hashPassword } = await import('../src/lib/crypto.js');
  return User.create({ accountType: 'staff', role, status: 'active', email, emailVerifiedAt: new Date(), displayName: email.split('@')[0], passwordHash: await hashPassword(password) });
}

export async function loginStaff(app, fakes, email, password = 'correct horse battery staple') {
  const res = await request(app).post('/api/v1/staff-auth/login').send({ email, password, transport: 'bearer' });
  if (res.status !== 200) throw new Error(`staff login failed ${res.status} ${JSON.stringify(res.body)}`);
  const client = bearerClient(app, res.body.data.token, res.body.data.user);
  if (res.body.data.mfa) {
    const code = lastCode(fakes);
    const v = await client.post('/api/v1/staff-auth/mfa/verify').send({ challengeId: res.body.data.mfa.challengeId, code });
    if (v.status !== 200) throw new Error(`mfa failed ${v.status} ${JSON.stringify(v.body)}`);
  }
  const { RateLimitBucket } = await import('../src/models/index.js');
  await RateLimitBucket.deleteMany({});
  return client;
}

export async function loginAdmin(app, fakes, email = 'admin@townant.test') {
  await createStaffUser({ email, role: 'super_admin' });
  return loginStaff(app, fakes, email);
}

const OPEN_ALL_WEEK = Array.from({ length: 7 }, () => [{ start: '08:00', end: '20:00' }]);

// A published company with one service, open 08:00-20:00 UTC every day, plus a logged-in owner.
export async function createVendor(app, fakes, { email, name = 'Acme Cleaning', bookingMode = 'instant', durationMinutes = 60 } = {}) {
  const { Company, Membership, Service, Category } = await import('../src/models/index.js');
  const category = (await Category.findOne({ slug: 'cleaning' })) ?? (await Category.create({ name: 'Cleaning', slug: 'cleaning' }));
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
  const company = await Company.create({
    name,
    slug,
    status: 'published',
    publishedAt: new Date(),
    primaryCategoryId: category._id,
    categoryIds: [category._id],
    summary: `${name} summary`,
    address: { city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
    searchText: `${name.toLowerCase()} cleaning austin`,
    availability: { timezone: 'UTC', weekly: OPEN_ALL_WEEK, exceptions: [], slotIntervalMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 60, maxAdvanceDays: 60 },
  });
  const service = await Service.create({ companyId: company._id, title: 'Standard clean', durationMinutes, bookingMode, categoryId: category._id });
  const owner = await createStaffUser({ email: email ?? `owner-${slug}@vendor.test` });
  await Membership.create({ userId: owner._id, companyId: company._id, role: 'owner' });
  const client = await loginStaff(app, fakes, owner.email);
  return { company, service, owner, client, category };
}

// An ISO date `days` ahead in UTC.
export const dateAhead = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

export async function firstSlots(app, company, service, days = 3) {
  const res = await request(app).get(`/api/v1/catalog/companies/${company.slug}/slots`).query({ serviceId: service._id.toString(), date: dateAhead(days) });
  if (res.status !== 200) throw new Error(`slots failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.slots;
}

// Minimal but well-formed image headers with real dimensions (the API reads sizes from the bytes).
export function pngImage(width = 10, height = 10) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.set([8, 2, 0, 0, 0], 16);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(32)]);
}

// JPEG with an optional EXIF orientation segment and a SOF0 frame header.
export function jpegImage(width, height, orientation) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (orientation) {
    const tiff = Buffer.alloc(26);
    tiff.write('MM', 0, 'ascii');
    tiff.writeUInt16BE(42, 2);
    tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8);
    tiff.writeUInt16BE(0x0112, 10);
    tiff.writeUInt16BE(3, 12);
    tiff.writeUInt32BE(1, 14);
    tiff.writeUInt16BE(orientation, 18);
    const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
    const head = Buffer.from([0xff, 0xe1, 0, 0]);
    head.writeUInt16BE(app1.length + 2, 2);
    parts.push(head, app1);
  }
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

export function webpImage(width, height) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(32, 4);
  b.write('WEBPVP8X', 8, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}
