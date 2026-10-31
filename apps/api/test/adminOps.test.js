import { strFromU8, unzipSync } from 'fflate';
import { imageDimensions } from '../src/services/media.js';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStaffUser, createVendor, firstSlots, loginAdmin, loginCustomer, loginStaff, resetDb, startTestServer, stopTestServer, jpegImage, pngImage, webpImage } from './helpers.js';

let app;
let fakes;
let models;

const PNG = pngImage(1600, 900);
const BANNER = pngImage(1200, 400);

beforeAll(async () => {
  ({ app, fakes } = await startTestServer());
  models = await import('../src/models/index.js');
});
afterAll(stopTestServer);
beforeEach(resetDb);

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

// Minimal .xlsx reader for assertions: rows of cell text for one sheet.
function readSheet(buffer, index = 1) {
  const files = unzipSync(new Uint8Array(buffer));
  const shared = files['xl/sharedStrings.xml'] ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>(.*?)<\/si>/gs)].map((m) => m[1].replace(/<[^>]+>/g, '')) : [];
  const xml = strFromU8(files[`xl/worksheets/sheet${index}.xml`]);
  return [...xml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map((r) =>
    [...r[1].matchAll(/<c([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)].map((c) => {
      const t = /t="(\w+)"/.exec(c[1])?.[1];
      const v = /<v>(.*?)<\/v>/s.exec(c[2] ?? '')?.[1] ?? /<t[^>]*>(.*?)<\/t>/s.exec(c[2] ?? '')?.[1] ?? null;
      return t === 's' ? shared[Number(v)] : v;
    }),
  );
}

const exportGet = (client, url) => client.get(url).buffer(true).parse(binary);

describe('company deletion and 15-day recovery', () => {
  it('soft-deletes, hides everywhere, keeps records, and restores the previous state', async () => {
    const admin = await loginAdmin(app, fakes);
    const { company, service, client: vendor, owner } = await createVendor(app, fakes, { name: 'Bright Windows' });
    const alice = await loginCustomer(app, fakes, 'alice@example.com');
    const [slot] = await firstSlots(app, company, service);
    const booking = await alice.post('/api/v1/bookings').send({ serviceId: service._id.toString(), startAt: slot.startAt });
    expect(booking.status).toBe(201);
    await models.Company.updateOne({ _id: company._id }, { $set: { spotlight: { active: true, order: 0 } } });

    expect((await vendor.delete(`/api/v1/admin/companies/${company._id}`).send({ reason: 'Duplicate listing' })).status).toBe(403);
    expect((await admin.delete(`/api/v1/admin/companies/${company._id}`).send({})).status).toBe(400);
    const del = await admin.delete(`/api/v1/admin/companies/${company._id}`).send({ reason: 'Duplicate listing' });
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ status: 'deleted', upcomingBookings: 1, deletion: { statusBefore: 'published', restorable: true, daysLeft: 15 } });
    expect((await admin.delete(`/api/v1/admin/companies/${company._id}`).send({ reason: 'Again' })).status).toBe(409);

    // Gone from public listings and the vendor portal; excluded from the normal admin list.
    expect((await request(app).get(`/api/v1/catalog/companies/${company.slug}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/catalog/companies')).body.data.map((c) => c.id)).not.toContain(company._id.toString());
    expect((await request(app).get('/api/v1/catalog/spotlight')).body.data.map((c) => c.id)).not.toContain(company._id.toString());
    const portal = await vendor.get('/api/v1/vendor/context');
    expect(portal.status).toBe(403);
    expect(portal.body.error.code).toBe('COMPANY_DELETED');
    expect((await admin.get('/api/v1/admin/companies')).body.data.map((c) => c.id)).not.toContain(company._id.toString());
    const recent = (await admin.get('/api/v1/admin/companies?view=deleted')).body.data;
    expect(recent.map((c) => c.id)).toEqual([company._id.toString()]);
    // Nothing related was removed.
    expect(await models.Booking.countDocuments({ companyId: company._id })).toBe(1);
    expect(await models.Service.countDocuments({ companyId: company._id, archivedAt: null })).toBe(1);
    expect(await models.Membership.countDocuments({ companyId: company._id, status: 'active' })).toBe(1);
    expect((await models.User.findById(owner._id)).status).toBe('active');
    // Changes are refused while deleted.
    expect((await admin.patch(`/api/v1/admin/companies/${company._id}`).send({ verified: true })).status).toBe(409);
    expect((await admin.post(`/api/v1/admin/companies/${company._id}/purge`)).status).toBe(409);

    // Concurrent restores: exactly one wins.
    const results = await Promise.all([1, 2, 3].map(() => admin.post(`/api/v1/admin/companies/${company._id}/restore`).send({})));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const restored = await models.Company.findById(company._id).lean();
    expect(restored.status).toBe('published');
    expect(restored.deletion).toBeUndefined();
    expect(restored.spotlight.active).toBe(true);
    expect((await request(app).get(`/api/v1/catalog/companies/${company.slug}`)).status).toBe(200);
    expect((await vendor.get('/api/v1/vendor/context')).status).toBe(200);
    expect(await models.AuditEvent.countDocuments({ action: { $in: ['company.delete', 'company.restore'] } })).toBe(2);
  });

  it('restores a draft as a draft and refuses restoration after 15 days, then finalizes safely', async () => {
    const admin = await loginAdmin(app, fakes);
    const { company, service, owner } = await createVendor(app, fakes, { name: 'Gone Garden' });
    const alice = await loginCustomer(app, fakes, 'alice@example.com');
    const [slot] = await firstSlots(app, company, service);
    const booking = (await alice.post('/api/v1/bookings').send({ serviceId: service._id.toString(), startAt: slot.startAt })).body.data;
    await admin.delete(`/api/v1/admin/companies/${company._id}`).send({ reason: 'Closed down' });
    await models.Company.updateOne({ _id: company._id }, { $set: { 'deletion.restoreUntil': new Date(Date.now() - 1000) } });

    const late = await admin.post(`/api/v1/admin/companies/${company._id}/restore`).send({});
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('RESTORE_EXPIRED');

    const { purgeDueCompanies } = await import('../src/services/companyLifecycle.js');
    expect(await purgeDueCompanies()).toBe(1);
    expect(await purgeDueCompanies()).toBe(0);
    const purged = await models.Company.findById(company._id).lean();
    expect(purged.status).toBe('deleted');
    expect(purged.deletion.purgedAt).toBeTruthy();
    // The upcoming booking was cancelled with the customer told; nothing was deleted.
    const b = await models.Booking.findById(booking.id).lean();
    expect(b.status).toBe('cancelled_by_admin');
    expect(b.history.at(-1).action).toBe('cancel_business_removed');
    expect(await models.Notification.countDocuments({ recipientId: alice.user.id, title: /no longer on TownAnt/ })).toBe(1);
    expect(await models.Booking.countDocuments({ companyId: company._id })).toBe(1);
    expect(await models.User.countDocuments({ _id: owner._id })).toBe(1);
    expect(await models.Service.countDocuments({ companyId: company._id })).toBe(1);
    expect(await models.Membership.countDocuments({ companyId: company._id, status: 'revoked' })).toBe(1);
    expect((await admin.post(`/api/v1/admin/companies/${company._id}/restore`).send({})).status).toBe(410);
    const listed = (await admin.get('/api/v1/admin/companies?view=deleted')).body.data[0];
    expect(listed.deletion).toMatchObject({ restorable: false, daysLeft: 0 });
    expect(listed.deletion.purgedAt).toBeTruthy();

    // A draft comes back as a draft.
    const { company: draft } = await createVendor(app, fakes, { name: 'Draft Co' });
    await models.Company.updateOne({ _id: draft._id }, { $set: { status: 'draft' } });
    await admin.delete(`/api/v1/admin/companies/${draft._id}`).send({ reason: 'Testing' });
    expect((await admin.post(`/api/v1/admin/companies/${draft._id}/restore`).send({})).body.data.status).toBe('draft');
  });
});

describe('category management', () => {
  it('creates, reads, updates and deletes with validation and uniqueness', async () => {
    const admin = await loginAdmin(app, fakes);
    expect((await admin.post('/api/v1/admin/categories').send({ name: 'Pets', slug: 'Bad Slug!' })).status).toBe(400);
    expect((await admin.post('/api/v1/admin/categories').send({ name: 'P', slug: 'pets' })).status).toBe(400);
    const created = await admin.post('/api/v1/admin/categories').send({ name: 'Pet Care', slug: 'pet-care', description: 'Grooming and walking' });
    expect(created.status).toBe(201);
    expect((await admin.post('/api/v1/admin/categories').send({ name: 'Pet Care 2', slug: 'pet-care' })).status).toBe(409);
    const id = created.body.data.id;

    const detail = await admin.get(`/api/v1/admin/categories/${id}`);
    expect(detail.body.data).toMatchObject({ name: 'Pet Care', usage: { companies: 0, services: 0, children: 0 } });

    await admin.post('/api/v1/admin/categories').send({ name: 'Home', slug: 'home' });
    expect((await admin.patch(`/api/v1/admin/categories/${id}`).send({ slug: 'home' })).status).toBe(409);
    const renamed = await admin.patch(`/api/v1/admin/categories/${id}`).send({ name: 'Pet Services', slug: 'pet-services', sortOrder: 3 });
    expect(renamed.body.data).toMatchObject({ name: 'Pet Services', slug: 'pet-services', sortOrder: 3 });
    expect((await request(app).get('/api/v1/catalog/categories')).body.data.map((c) => c.slug)).toContain('pet-services');

    const customer = await loginCustomer(app, fakes, 'c@example.com');
    expect((await customer.delete(`/api/v1/admin/categories/${id}`).send({})).status).toBe(403);
    expect((await admin.delete(`/api/v1/admin/categories/${id}`).send({})).status).toBe(200);
    expect((await admin.get(`/api/v1/admin/categories/${id}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/catalog/categories')).body.data.map((c) => c.slug)).not.toContain('pet-services');
    expect(await models.AuditEvent.countDocuments({ action: 'category.delete' })).toBe(1);
  });

  it('refuses to delete a category in use unless its businesses and services move to another category', async () => {
    const admin = await loginAdmin(app, fakes);
    const { company, service, category } = await createVendor(app, fakes, { name: 'Sparkle Cleaners' });
    const parent = await models.Category.create({ name: 'Home', slug: 'home' });
    await models.Category.create({ name: 'Child', slug: 'child', parentId: parent._id });
    const target = await models.Category.create({ name: 'Housekeeping', slug: 'housekeeping' });
    const app1 = await models.VendorApplication.create({ businessName: 'New Co', contactName: 'N', email: 'n@example.com', categoryIds: [category._id], description: 'x'.repeat(30), address: { city: 'Austin', country: 'US' }, status: 'submitted' });

    const blocked = await admin.delete(`/api/v1/admin/categories/${category._id}`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: 'CATEGORY_IN_USE', details: { usage: { companies: 1, liveCompanies: 1, services: 1, openApplications: 1 } } });
    expect((await admin.delete(`/api/v1/admin/categories/${parent._id}`).send({})).body.error.code).toBe('CATEGORY_HAS_CHILDREN');
    expect((await admin.delete(`/api/v1/admin/categories/${category._id}`).send({ reassignTo: category._id.toString() })).status).toBe(422);
    await models.Category.updateOne({ _id: target._id }, { $set: { isActive: false } });
    expect((await admin.delete(`/api/v1/admin/categories/${category._id}`).send({ reassignTo: target._id.toString() })).status).toBe(422);
    await models.Category.updateOne({ _id: target._id }, { $set: { isActive: true } });

    const moved = await admin.delete(`/api/v1/admin/categories/${category._id}`).send({ reassignTo: target._id.toString() });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ deleted: true, reassignedTo: { name: 'Housekeeping' }, moved: { companies: 1, services: 1, applications: 1 } });
    const c = await models.Company.findById(company._id).lean();
    expect(c.categoryIds.map(String)).toEqual([target._id.toString()]);
    expect(String(c.primaryCategoryId)).toBe(target._id.toString());
    expect(c.searchText).toContain('housekeeping');
    expect(String((await models.Service.findById(service._id).lean()).categoryId)).toBe(target._id.toString());
    expect((await models.VendorApplication.findById(app1._id).lean()).categoryIds.map(String)).toEqual([target._id.toString()]);
    // The business is still listed publicly under its new category.
    const results = (await request(app).get('/api/v1/catalog/companies?category=housekeeping')).body.data;
    expect(results.map((r) => r.id)).toContain(company._id.toString());
  });
});

describe('Excel exports', () => {
  it('exports every filtered company across pages, for Super Admins only', async () => {
    const admin = await loginAdmin(app, fakes);
    const cat = await models.Category.create({ name: 'Cleaning', slug: 'cleaning' });
    const docs = Array.from({ length: 27 }, (_, i) => ({ name: `Shop ${String(i).padStart(2, '0')}`, slug: `shop-${i}`, status: i < 25 ? 'published' : 'draft', categoryIds: [cat._id], primaryCategoryId: cat._id, address: { city: 'Austin', country: 'US' } }));
    docs.push({ name: '=HYPERLINK("http://evil")', slug: 'evil', status: 'published', address: { city: 'Austin', country: 'US' } });
    await models.Company.insertMany(docs);
    await models.Company.create({ name: 'Deleted Shop', slug: 'deleted-shop', status: 'deleted', deletion: { deletedAt: new Date(), restoreUntil: new Date(Date.now() + 86400000), statusBefore: 'published' } });

    // The list is paginated (20 per page); the export is not.
    expect((await admin.get('/api/v1/admin/companies?status=published')).body.data).toHaveLength(20);
    const res = await exportGet(admin, '/api/v1/admin/companies/export?status=published');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="townant-companies-\d{2}-\d{2}-\d{4}\.xlsx"$/);
    const rows = readSheet(res.body);
    expect(rows[0].slice(0, 3)).toEqual(['Company', 'Link name', 'Status']);
    expect(rows).toHaveLength(1 + 26);
    expect(rows.slice(1).every((r) => r[2] === 'Live')).toBe(true);
    // Text that a spreadsheet would run as a formula is neutralised.
    expect(rows.flat()).toContain(`'=HYPERLINK("http://evil")`);
    expect(rows.flat()).not.toContain('Deleted Shop');

    const searched = readSheet((await exportGet(admin, '/api/v1/admin/companies/export?q=shop%2001')).body);
    expect(searched.slice(1).map((r) => r[0])).toEqual(['Shop 01']);
    const deleted = readSheet((await exportGet(admin, '/api/v1/admin/companies/export?view=deleted')).body);
    expect(deleted.slice(1).map((r) => r[0])).toEqual(['Deleted Shop']);

    const { client: vendor } = await createVendor(app, fakes);
    expect((await vendor.get('/api/v1/admin/companies/export')).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/companies/export')).status).toBe(401);
    expect((await vendor.get('/api/v1/admin/dashboard/export')).status).toBe(403);
  });

  it('exports applications, categories and the dashboard report', async () => {
    const admin = await loginAdmin(app, fakes);
    await models.Category.create({ name: 'Cleaning', slug: 'cleaning' });
    await models.VendorApplication.create({ businessName: 'Applicant A', contactName: 'A', email: 'a@example.com', description: 'x'.repeat(30), address: { city: 'Austin', country: 'US' }, status: 'submitted' });
    await models.VendorApplication.create({ businessName: 'Applicant B', contactName: 'B', email: 'b@example.com', description: 'x'.repeat(30), address: { city: 'Austin', country: 'US' }, status: 'rejected' });

    const apps = readSheet((await exportGet(admin, '/api/v1/admin/applications/export?status=submitted')).body);
    expect(apps.slice(1).map((r) => r[0])).toEqual(['Applicant A']);
    const cats = readSheet((await exportGet(admin, '/api/v1/admin/categories/export')).body);
    expect(cats[1][0]).toBe('Cleaning');
    const dash = await exportGet(admin, '/api/v1/admin/dashboard/export?from=2026-10-01&to=2026-10-07');
    expect(dash.status).toBe(200);
    const summary = readSheet(dash.body, 1);
    expect(summary[0]).toEqual(['Metric', 'Value']);
    expect(summary.map((r) => r[0])).toContain('Applications awaiting review');
    const daily = readSheet(dash.body, 2);
    expect(daily).toHaveLength(1 + 7);
  });
});

describe('homepage images', () => {
  it('turns provider failures into a clear 502 and keeps the published hero', async () => {
    const admin = await loginAdmin(app, fakes);
    const first = await admin.post('/api/v1/admin/site/hero/draft').field('alt', 'Kitchen').field('publish', 'true').attach('file', PNG, { filename: 'h.png', contentType: 'image/png' });
    expect(first.status).toBe(201);
    expect(first.body.data.hero.published.alt).toBe('Kitchen');
    expect(first.body.data.hero.draft).toBeNull();
    const live = first.body.data.hero.published.image.url;
    expect((await request(app).get('/api/v1/catalog/site')).body.data.hero.image.url).toBe(live);
    // Direct publishing still needs the image description.
    expect((await admin.post('/api/v1/admin/site/hero/draft').field('publish', 'true').attach('file', PNG, { filename: 'h.png', contentType: 'image/png' })).status).toBe(422);

    const original = fakes.media.upload;
    const { ProviderError } = await import('../src/providers/http.js');
    fakes.media.upload = async () => {
      throw new ProviderError('cloudinary', 'upload connection failed (ECONNRESET)', { retryable: true, code: 'ECONNRESET' });
    };
    try {
      const failed = await admin.post('/api/v1/admin/site/hero/draft').field('alt', 'New').attach('file', PNG, { filename: 'h.png', contentType: 'image/png' });
      expect(failed.status).toBe(502);
      expect(failed.body.error.code).toBe('UPLOAD_FAILED');
      expect(failed.body.error.requestId).toBeTruthy();
      expect(JSON.stringify(failed.body)).not.toMatch(/cloudinary|ECONNRESET/i);
    } finally {
      fakes.media.upload = original;
    }
    expect((await request(app).get('/api/v1/catalog/site')).body.data.hero.image.url).toBe(live);
    expect((await admin.get('/api/v1/admin/site')).body.data.hero.draft).toBeNull();
  });

  it('publishes an image-only promotional banner directly, replaces it safely and removes it', async () => {
    const admin = await loginAdmin(app, fakes);
    const { client: vendor } = await createVendor(app, fakes);
    expect((await vendor.post('/api/v1/admin/site/banner').attach('file', BANNER, { filename: 'b.png', contentType: 'image/png' })).status).toBe(403);
    expect((await admin.post('/api/v1/admin/site/banner').field('title', 'No image')).status).toBe(400);
    const html = Buffer.from('<svg onload=alert(1)>'.padEnd(64, ' '));
    expect((await admin.post('/api/v1/admin/site/banner').attach('file', html, { filename: 'b.png', contentType: 'image/png' })).status).toBe(415);

    const pub = await admin.post('/api/v1/admin/site/banner').attach('file', BANNER, { filename: 'b.png', contentType: 'image/png' });
    expect(pub.status).toBe(201);
    const site = (await request(app).get('/api/v1/catalog/site')).body.data;
    expect(site.banner).toMatchObject({ alt: '', title: null, description: null, link: null });
    expect(site.banner.image.url).toMatch(/townant\/platform\/site\/banner\//);
    expect(site.hero).toBeNull();
    const firstId = (await models.SiteSettings.findOne({ key: 'site' })).promoBanner.image.publicId;

    // Links must be same-site paths or https.
    for (const bad of ['javascript:alert(1)', '//evil.example', 'http://insecure.example', 'data:text/html,x']) {
      expect((await admin.patch('/api/v1/admin/site/banner').send({ linkUrl: bad })).status).toBe(400);
    }
    expect((await admin.patch('/api/v1/admin/site/banner').send({ linkLabel: 'Shop' })).status).toBe(400);
    const edited = await admin.patch('/api/v1/admin/site/banner').send({ title: 'Spring cleaning', linkUrl: '/search?category=cleaning', linkLabel: 'Find cleaners' });
    expect(edited.status).toBe(200);
    expect((await request(app).get('/api/v1/catalog/site')).body.data.banner).toMatchObject({ title: 'Spring cleaning', link: { url: '/search?category=cleaning', label: 'Find cleaners' } });

    // A failed replacement leaves the live banner untouched.
    const original = fakes.media.upload;
    fakes.media.upload = async () => {
      throw Object.assign(new Error('down'), { provider: 'cloudinary', retryable: true });
    };
    try {
      expect((await admin.post('/api/v1/admin/site/banner').attach('file', BANNER, { filename: 'b2.png', contentType: 'image/png' })).status).toBe(502);
    } finally {
      fakes.media.upload = original;
    }
    expect((await models.SiteSettings.findOne({ key: 'site' })).promoBanner.image.publicId).toBe(firstId);

    const replaced = await admin.post('/api/v1/admin/site/banner').field('alt', 'Spring offer').attach('file', BANNER, { filename: 'b2.png', contentType: 'image/png' });
    expect(replaced.status).toBe(201);
    expect(fakes.sent.destroyed).toContain(firstId);
    expect((await admin.delete('/api/v1/admin/site/banner')).status).toBe(200);
    expect((await request(app).get('/api/v1/catalog/site')).body.data.banner).toBeNull();
    expect((await admin.delete('/api/v1/admin/site/banner')).status).toBe(404);
    const actions = (await models.AuditEvent.find({ entityType: 'site' }).lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['site.banner_publish', 'site.banner_update', 'site.banner_replace', 'site.banner_remove']));
  });
});

describe('image validation', () => {
  it('reads real dimensions from PNG, JPEG (including EXIF rotation) and WebP bytes', () => {
    expect(imageDimensions(pngImage(1200, 400))).toEqual({ width: 1200, height: 400 });
    expect(imageDimensions(jpegImage(1800, 600))).toEqual({ width: 1800, height: 600 });
    // A phone photo stored 600×1800 but tagged "rotate 90°" displays as 1800×600 (and vice versa).
    expect(imageDimensions(jpegImage(600, 1800, 6))).toEqual({ width: 1800, height: 600 });
    expect(imageDimensions(webpImage(2400, 800))).toEqual({ width: 2400, height: 800 });
    expect(imageDimensions(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]))).toBeNull();
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('rejects banners that are not 3:1 on the server and keeps the published banner', async () => {
    const admin = await loginAdmin(app, fakes);
    expect((await admin.post('/api/v1/admin/site/banner').attach('file', BANNER, { filename: 'ok.png', contentType: 'image/png' })).status).toBe(201);
    const live = (await request(app).get('/api/v1/catalog/site')).body.data.banner.image.url;
    const uploadsBefore = fakes.sent.uploads.length;
    for (const [img, code] of [
      [pngImage(1000, 1000), 'BANNER_RATIO_INVALID'],
      [pngImage(400, 1200), 'BANNER_RATIO_INVALID'],
      [jpegImage(1920, 1080), 'BANNER_RATIO_INVALID'],
      [jpegImage(400, 1200, 6), null],
      [webpImage(300, 100), 'BANNER_TOO_SMALL'],
    ]) {
      // The declared type and file name are irrelevant; only the bytes count.
      const res = await admin.post('/api/v1/admin/site/banner').attach('file', img, { filename: 'banner-1200x400.png', contentType: 'image/png' });
      if (code) {
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe(code);
        expect(res.body.error.details.requiredRatio).toBe('3:1');
      } else {
        expect(res.status).toBe(201);
      }
    }
    // Rejected files never reached the image provider; only the one valid (rotated) image did.
    expect(fakes.sent.uploads.length).toBe(uploadsBefore + 1);
    const malformed = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    expect((await admin.post('/api/v1/admin/site/banner').attach('file', malformed, { filename: 'b.png', contentType: 'image/png' })).status).toBe(415);
    expect((await request(app).get('/api/v1/catalog/site')).body.data.banner.image.url).not.toBe(live);
    const site = await admin.get('/api/v1/admin/site');
    expect(site.body.meta.banner).toMatchObject({ ratio: '3:1', recommended: { width: 1200, height: 400 } });
    expect(site.body.meta.uploads.maxBytes).toBe(5 * 1024 * 1024);
  });

  it('enforces the upload size limit', async () => {
    const admin = await loginAdmin(app, fakes);
    const huge = Buffer.concat([pngImage(1200, 400), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const res = await admin.post('/api/v1/admin/site/banner').attach('file', huge, { filename: 'b.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('keeps the published hero when saving the replacement fails, and removes the orphaned upload', async () => {
    const admin = await loginAdmin(app, fakes);
    await admin.post('/api/v1/admin/site/hero/draft').field('alt', 'Kitchen').field('publish', 'true').attach('file', PNG, { filename: 'h.png', contentType: 'image/png' });
    const live = (await request(app).get('/api/v1/catalog/site')).body.data.hero.image.url;
    const save = models.SiteSettings.prototype.save;
    models.SiteSettings.prototype.save = async function failingSave() {
      throw new Error('simulated database outage');
    };
    let res;
    try {
      res = await admin.post('/api/v1/admin/site/hero/draft').field('alt', 'Garden').field('publish', 'true').attach('file', PNG, { filename: 'h2.png', contentType: 'image/png' });
    } finally {
      models.SiteSettings.prototype.save = save;
    }
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(res.body)).not.toMatch(/simulated|database/);
    const orphan = fakes.sent.uploads.at(-1);
    expect(fakes.sent.destroyed).toContain(`${orphan.folder}/${orphan.publicId}`);
    expect((await request(app).get('/api/v1/catalog/site')).body.data.hero.image.url).toBe(live);
  });

  it('replacing or removing the banner never touches the hero', async () => {
    const admin = await loginAdmin(app, fakes);
    await admin.post('/api/v1/admin/site/hero/draft').field('alt', 'Kitchen').field('publish', 'true').attach('file', PNG, { filename: 'h.png', contentType: 'image/png' });
    const hero = (await request(app).get('/api/v1/catalog/site')).body.data.hero;
    const heroId = (await models.SiteSettings.findOne({ key: 'site' })).hero.published.image.publicId;
    await admin.post('/api/v1/admin/site/banner').attach('file', BANNER, { filename: 'b.png', contentType: 'image/png' });
    await admin.post('/api/v1/admin/site/banner').attach('file', BANNER, { filename: 'b2.png', contentType: 'image/png' });
    await admin.delete('/api/v1/admin/site/banner');
    expect((await request(app).get('/api/v1/catalog/site')).body.data.hero).toEqual(hero);
    expect(fakes.sent.destroyed).not.toContain(heroId);
  });
});

describe('vendor temporary passwords', () => {
  it('forces a password change before any other API works', async () => {
    const admin = await loginAdmin(app, fakes);
    const { company, owner, client: oldSession } = await createVendor(app, fakes, { email: 'owner@vendor.test' });
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    expect((await admin.post(`/api/v1/admin/users/${customer.user.id}/temporary-password`).send({ reason: 'Locked out' })).status).toBe(422);
    expect((await customer.post(`/api/v1/admin/users/${owner._id}/temporary-password`).send({ reason: 'Locked out' })).status).toBe(403);

    const issued = await admin.post(`/api/v1/admin/users/${owner._id}/temporary-password`).send({ reason: 'Owner locked out' });
    expect(issued.status).toBe(201);
    const temp = issued.body.data.temporaryPassword;
    expect(temp).toHaveLength(16);
    // Never stored or audited in plaintext; existing sessions end.
    expect(JSON.stringify(await models.AuditEvent.find({ action: 'user.temporary_password_issued' }).lean())).not.toContain(temp);
    expect((await models.User.findById(owner._id).select('+passwordHash').lean()).passwordHash).not.toContain(temp);
    expect((await oldSession.get('/api/v1/vendor/context')).status).toBe(401);

    const login = await request(app).post('/api/v1/staff-auth/login').send({ email: 'owner@vendor.test', password: temp, transport: 'bearer' });
    expect(login.status).toBe(200);
    expect(login.body.data.user.passwordChangeRequired).toBe(true);
    const auth = (r) => r.set('Authorization', `Bearer ${login.body.data.token}`);
    for (const path of ['/api/v1/vendor/context', '/api/v1/vendor/bookings', '/api/v1/notifications', `/api/v1/vendor/companies`]) {
      const r = await auth(request(app).get(path));
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    expect((await auth(request(app).get('/api/v1/auth/session'))).body.data.user.passwordChangeRequired).toBe(true);
    expect((await auth(request(app).post('/api/v1/staff-auth/password/change')).send({ currentPassword: temp, newPassword: temp })).status).toBe(422);
    expect((await auth(request(app).post('/api/v1/staff-auth/password/change')).send({ currentPassword: temp, newPassword: 'my own long secret 9', confirmPassword: 'different long secret 9' })).status).toBe(400);
    const changed = await auth(request(app).post('/api/v1/staff-auth/password/change')).send({ currentPassword: temp, newPassword: 'my own long secret 9', confirmPassword: 'my own long secret 9' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.user.passwordChangeRequired).toBe(false);
    const ctx = await auth(request(app).get('/api/v1/vendor/context'));
    expect(ctx.status).toBe(200);
    expect(ctx.body.data.company.id).toBe(company._id.toString());
    // The temporary password no longer works.
    expect((await request(app).post('/api/v1/staff-auth/login').send({ email: 'owner@vendor.test', password: temp })).status).toBe(401);
  });

  it('rejects an expired temporary password and leaves other vendors alone', async () => {
    const admin = await loginAdmin(app, fakes);
    const { owner } = await createVendor(app, fakes, { email: 'owner@vendor.test' });
    const other = await createStaffUser({ email: 'other@vendor.test' });
    const temp = (await admin.post(`/api/v1/admin/users/${owner._id}/temporary-password`).send({ reason: 'Locked out' })).body.data.temporaryPassword;
    await models.User.updateOne({ _id: owner._id }, { $set: { temporaryPasswordExpiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post('/api/v1/staff-auth/login').send({ email: 'owner@vendor.test', password: temp });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TEMPORARY_PASSWORD_EXPIRED');
    // A wrong password still gets the generic answer.
    expect((await request(app).post('/api/v1/staff-auth/login').send({ email: 'owner@vendor.test', password: 'not the password' })).body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await models.User.findById(other._id).lean()).passwordChangeRequired).toBe(false);
    const otherLogin = await loginStaff(app, fakes, 'other@vendor.test');
    expect(otherLogin.user.passwordChangeRequired).toBe(false);
  });
});
