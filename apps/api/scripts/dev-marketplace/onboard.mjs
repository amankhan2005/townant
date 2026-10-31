// Development helper: onboards the vendors in data.json through the same HTTP API the Super Admin
// and Vendor panels use — no direct database writes:
//   Super Admin  POST /admin/companies                 (creates the business and invites its owner)
//   Owner        POST /staff-auth/invite/accept        (sets the password from the emailed link)
//   Vendor       PATCH /vendor/company, PUT /vendor/company/availability, POST /vendor/services,
//                POST /vendor/company/media/{logo,banner,gallery}, POST /vendor/company/publish
// Existing businesses (same name) are skipped. Rate limits are respected (Retry-After).
//
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… VENDOR_PASSWORD=… API_LOG=<api log> \
//   node onboard.mjs <data.json> <image dir> > result.json
// Reads the invite links and two-step codes from the API's development log, so it only works
// against a local API using the development email provider. Never use it against production.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API = `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1`;
const { ADMIN_EMAIL, ADMIN_PASSWORD, VENDOR_PASSWORD, API_LOG } = process.env;
const [dataPath, imageDir] = process.argv.slice(2);
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(...a);

async function call(path, { method = 'GET', token, body, form } = {}) {
  for (;;) {
    const headers = { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API}${path}`, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 60);
      log(`  rate limited on ${path}; waiting ${wait}s`);
      await sleep((wait + 2) * 1000);
      continue;
    }
    const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`);
    return json;
  }
}

// Most recent development email to `to`; returns the text.
async function lastEmail(to, after, match) {
  for (let i = 0; i < 60; i += 1) {
    const lines = readFileSync(API_LOG, 'utf8').trim().split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('[dev-email]') || !line.includes(`"to":"${to}"`)) continue;
      const { time, msg } = JSON.parse(line);
      if (new Date(time).getTime() < after) break;
      const m = msg.match(match);
      if (m) return m[1];
    }
    await sleep(500);
  }
  throw new Error(`No matching email to ${to}`);
}

// The API answers 502 UPLOAD_FAILED ("nothing was changed — try again") when the image host can't
// be reached; retry like a person would.
const upload = async (token, kind, file) => {
  for (let attempt = 1; ; attempt += 1) {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(file)], { type: 'image/jpeg' }), file.split('/').pop());
    try {
      return await call(`/vendor/company/media/${kind}`, { method: 'POST', token, form });
    } catch (err) {
      if (attempt >= 10 || !/UPLOAD_FAILED/.test(err.message)) throw err;
      log(`  ${kind} upload failed (attempt ${attempt}); retrying`);
      await sleep(Math.min(5000 * attempt, 30000));
    }
  }
};

const HOURS = {
  standard: [[], [['08:00', '18:00']], [['08:00', '18:00']], [['08:00', '18:00']], [['08:00', '18:00']], [['08:00', '18:00']], [['09:00', '14:00']]],
  salon: [[], [], [['10:00', '19:00']], [['10:00', '19:00']], [['10:00', '19:00']], [['10:00', '20:00']], [['09:00', '17:00']]],
  wellness: [[], [['09:00', '20:00']], [['09:00', '20:00']], [['09:00', '20:00']], [['09:00', '20:00']], [['09:00', '20:00']], [['10:00', '16:00']]],
  photo: [[['09:00', '13:00'], ['14:00', '18:00']], [], [], [['09:00', '13:00'], ['14:00', '18:00']], [['09:00', '13:00'], ['14:00', '18:00']], [['09:00', '13:00'], ['14:00', '18:00']], [['08:00', '17:00']]],
};
const hoursFor = (cat) => (cat === 'beauty-salon' ? HOURS.salon : cat === 'massage-wellness' ? HOURS.wellness : cat === 'photography' ? HOURS.photo : HOURS.standard);
const policyFor = (v) => {
  const visit = v.serviceMode === 'fixed' ? 'appointment' : 'visit';
  const cutoff = v.category === 'moving-services' ? 48 : v.category === 'beauty-salon' ? 12 : 24;
  return {
    cutoff,
    text: `Please cancel or reschedule at least ${cutoff} hours before your ${visit} so we can offer the time to someone else. Prices shown are a guide; we confirm any extra work before starting. Payment is made directly to us after the ${visit} — TownAnt does not take payments.`,
  };
};

// Super Admin session (password + emailed two-step code).
const loginAt = Date.now() - 10 * 60 * 1000;
const admin = (await call('/staff-auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, transport: 'bearer' } })).data;
if (admin.mfa) {
  const code = await lastEmail(ADMIN_EMAIL, loginAt, /\b(\d{6})\b/);
  await call('/staff-auth/mfa/verify', { method: 'POST', token: admin.token, body: { challengeId: admin.mfa.challengeId, code } });
}
log('Super Admin signed in');
const cats = new Map((await call('/admin/categories', { token: admin.token })).data.map((c) => [c.slug, c]));

const results = [];
for (const v of data.vendors) {
  const cat = cats.get(v.category);
  if (!cat) throw new Error(`Category ${v.category} missing`);
  const existing = (await call(`/admin/companies?q=${encodeURIComponent(v.name)}&limit=5`, { token: admin.token })).data.find((c) => c.name === v.name);
  if (existing) {
    if (existing.status === 'draft') {
      log(`~ ${v.name} exists as a draft; finishing setup`);
      const owner = (await call('/staff-auth/login', { method: 'POST', body: { email: v.ownerEmail, password: VENDOR_PASSWORD, transport: 'bearer' } })).data;
      await setup(v, cat, owner.token);
    } else log(`= ${v.name} exists (${existing.status})`);
    const status = (await call(`/admin/companies/${existing.id}`, { token: admin.token })).data;
    results.push({ name: v.name, ownerEmail: v.ownerEmail, companyId: existing.id, slug: status.slug ?? status.company?.slug, status: status.status ?? status.company?.status, services: v.services.length, city: v.city });
    continue;
  }
  log(`+ ${v.name}`);
  const before = Date.now() - 1000;
  const { data: created } = await call('/admin/companies', {
    method: 'POST',
    token: admin.token,
    body: { name: v.name, ownerEmail: v.ownerEmail, categoryIds: [cat.id], description: v.description, address: { line1: v.line1, city: v.city, region: v.region, postalCode: v.postalCode, country: v.country }, serviceMode: v.serviceMode, phone: v.phone },
  });
  const inviteToken = await lastEmail(v.ownerEmail, before, /token=([A-Za-z0-9_-]{20,100})/);
  const owner = (await call('/staff-auth/invite/accept', { method: 'POST', body: { token: inviteToken, password: VENDOR_PASSWORD, displayName: v.ownerName, transport: 'bearer' } })).data;
  await setup(v, cat, owner.token);
  const { data: ctx } = await call('/vendor/context', { token: owner.token });
  results.push({ name: v.name, ownerEmail: v.ownerEmail, companyId: created.company.id, slug: ctx.company.slug, status: ctx.company.status, services: v.services.length, city: v.city });
}
console.log(JSON.stringify(results, null, 1));

// Brings a business to the complete, published state. Safe to repeat: services and photos that
// already exist are not added again.
async function setup(v, cat, t) {
  const policy = policyFor(v);
  await call('/vendor/company', {
    method: 'PATCH',
    token: t,
    body: {
      summary: v.summary,
      description: v.description,
      primaryCategoryId: cat.id,
      categoryIds: [cat.id],
      contact: { email: v.contactEmail, phone: v.phone },
      address: { line1: v.line1, area: v.area ?? undefined, city: v.city, region: v.region, postalCode: v.postalCode, country: v.country },
      location: { lat: v.lat, lng: v.lng },
      serviceMode: v.serviceMode,
      ...(v.serviceArea ? { serviceArea: v.serviceArea } : {}),
      policies: { cancellation: policy.text },
      bookingPolicy: { cancellationCutoffHours: policy.cutoff, rescheduleCutoffHours: policy.cutoff, requestExpiryHours: 24 },
    },
  });
  await call('/vendor/company/availability', {
    method: 'PUT',
    token: t,
    body: {
      timezone: 'America/Chicago',
      weekly: hoursFor(v.category).map((day) => day.map(([start, end]) => ({ start, end }))),
      exceptions: [],
      slotIntervalMinutes: v.category === 'moving-services' ? 60 : 30,
      bufferMinutes: v.serviceMode === 'fixed' ? 0 : 15,
      minNoticeMinutes: 120,
      maxAdvanceDays: 60,
    },
  });
  const have = new Set((await call('/vendor/services', { token: t })).data.filter((s) => !s.archived).map((s) => s.title));
  for (const [i, s] of v.services.entries()) {
    if (!have.has(s.title)) await call('/vendor/services', { method: 'POST', token: t, body: { ...s, categoryId: cat.id, sortOrder: i * 10 } });
  }
  const pad = String(v.n).padStart(2, '0');
  let company = (await call('/vendor/context', { token: t })).data.company;
  if (!company.media?.logo) await upload(t, 'logo', join(imageDir, `vendor-${pad}-logo.jpg`));
  if (!company.media?.banner) await upload(t, 'banner', join(imageDir, `vendor-${pad}-cover.jpg`));
  for (let g = (company.media?.gallery ?? []).length + 1; g <= 3; g += 1) await upload(t, 'gallery', join(imageDir, `vendor-${pad}-gallery-${g}.jpg`));
  company = (await call('/vendor/context', { token: t })).data.company;
  if (company.status === 'draft') company = (await call('/vendor/company/publish', { method: 'POST', token: t })).data;
  log(`  ${company.status} ${company.slug} (${v.services.length} services, logo, cover, 3 photos)`);
}
