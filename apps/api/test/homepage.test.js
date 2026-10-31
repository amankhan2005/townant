import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createVendor, firstSlots, loginAdmin, loginCustomer, resetDb, startTestServer, stopTestServer, pngImage } from './helpers.js';

let app;
let fakes;
let models;

const PNG = pngImage(1600, 900);

beforeAll(async () => {
  ({ app, fakes } = await startTestServer());
  models = await import('../src/models/index.js');
});
afterAll(stopTestServer);
beforeEach(resetDb);

describe('category management', () => {
  it('lets only Super Admins upload a category image, which appears on the public category', async () => {
    const admin = await loginAdmin(app, fakes);
    const cat = await models.Category.create({ name: 'Pet Care', slug: 'pet-care' });
    const { client: vendor } = await createVendor(app, fakes);
    expect((await vendor.post(`/api/v1/admin/categories/${cat._id}/image`).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/categories/${cat._id}/image`).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })).status).toBe(401);

    const up = await admin.post(`/api/v1/admin/categories/${cat._id}/image`).field('alt', 'A groomer brushing a dog').attach('file', PNG, { filename: '../x.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(fakes.sent.uploads.at(-1).folder).toBe(`townant/platform/categories/${cat._id}`);
    expect(await models.AuditEvent.countDocuments({ action: 'category.image_upload' })).toBe(1);

    const pub = (await request(app).get('/api/v1/catalog/categories')).body.data.find((c) => c.slug === 'pet-care');
    expect(pub.image.url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(pub.image.alt).toBe('A groomer brushing a dog');
    expect(pub.image).not.toHaveProperty('publicId');

    // Replacing removes the old asset; removing clears it publicly.
    const firstId = (await models.Category.findById(cat._id)).image.publicId;
    await admin.post(`/api/v1/admin/categories/${cat._id}/image`).attach('file', PNG, { filename: 'b.png', contentType: 'image/png' });
    expect(fakes.sent.destroyed).toContain(firstId);
    expect((await admin.delete(`/api/v1/admin/categories/${cat._id}/image`)).status).toBe(200);
    expect((await request(app).get('/api/v1/catalog/categories')).body.data.find((c) => c.slug === 'pet-care').image).toBeNull();
  });

  it('rejects non-image bytes for category images', async () => {
    const admin = await loginAdmin(app, fakes);
    const cat = await models.Category.create({ name: 'Pet Care', slug: 'pet-care' });
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64, ' '));
    expect((await admin.post(`/api/v1/admin/categories/${cat._id}/image`).attach('file', html, { filename: 'x.png', contentType: 'image/png' })).status).toBe(415);
  });

  it('publishes and unpublishes categories, hiding sub-categories of inactive parents', async () => {
    const admin = await loginAdmin(app, fakes);
    const created = await admin.post('/api/v1/admin/categories').send({ name: 'Wellness', slug: 'wellness', description: 'Massage, yoga and more' });
    expect(created.status).toBe(201);
    const child = await admin.post('/api/v1/admin/categories').send({ name: 'Massage', slug: 'massage', parentId: created.body.data.id });
    expect(child.status).toBe(201);
    // Only two levels: a sub-category cannot be a parent.
    expect((await admin.post('/api/v1/admin/categories').send({ name: 'Deep', slug: 'deep', parentId: child.body.data.id })).status).toBe(422);

    let slugs = (await request(app).get('/api/v1/catalog/categories')).body.data.map((c) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(['wellness', 'massage']));

    expect((await admin.patch(`/api/v1/admin/categories/${created.body.data.id}`).send({ isActive: false })).status).toBe(200);
    slugs = (await request(app).get('/api/v1/catalog/categories')).body.data.map((c) => c.slug);
    expect(slugs).not.toContain('wellness');
    expect(slugs).not.toContain('massage');
  });
});

describe('homepage hero image', () => {
  it('is uploaded as a draft, published only by a Super Admin with alt text, and can be taken down', async () => {
    const admin = await loginAdmin(app, fakes);
    expect((await request(app).get('/api/v1/catalog/site')).body.data).toEqual({ hero: null, banner: null });

    const customer = await loginCustomer(app, fakes, 'c@example.com');
    expect((await customer.post('/api/v1/admin/site/hero/draft').attach('file', PNG, { filename: 'h.png', contentType: 'image/png' })).status).toBe(403);

    const draft = await admin.post('/api/v1/admin/site/hero/draft').attach('file', PNG, { filename: 'h.png', contentType: 'image/png' });
    expect(draft.status).toBe(201);
    expect(draft.body.data.hero.draft.image.url).toBeTruthy();
    expect(fakes.sent.uploads.at(-1).folder).toBe('townant/platform/site/hero');
    // Drafts are never public.
    expect((await request(app).get('/api/v1/catalog/site')).body.data.hero).toBeNull();

    // Publishing requires a text alternative.
    expect((await admin.post('/api/v1/admin/site/hero/publish')).status).toBe(422);
    expect((await admin.patch('/api/v1/admin/site/hero').send({ alt: 'Customer booking on a phone', focalX: 70 })).status).toBe(200);
    expect((await admin.patch('/api/v1/admin/site/hero').send({ focalX: 140 })).status).toBe(400);
    const pub = await admin.post('/api/v1/admin/site/hero/publish');
    expect(pub.status).toBe(200);
    expect(pub.body.data.hero.draft).toBeNull();

    const site = (await request(app).get('/api/v1/catalog/site')).body.data;
    expect(site.hero).toMatchObject({ alt: 'Customer booking on a phone', focal: { x: 70, y: 50 } });
    expect(site.hero.image).not.toHaveProperty('publicId');

    // A replacement draft does not change the live hero until it is published.
    const live = site.hero.image.url;
    await admin.post('/api/v1/admin/site/hero/draft').field('alt', 'New image').attach('file', PNG, { filename: 'h2.png', contentType: 'image/png' });
    expect((await request(app).get('/api/v1/catalog/site')).body.data.hero.image.url).toBe(live);
    expect((await admin.delete('/api/v1/admin/site/hero/draft')).status).toBe(200);

    expect((await admin.post('/api/v1/admin/site/hero/unpublish').send({})).status).toBe(400);
    expect((await admin.post('/api/v1/admin/site/hero/unpublish').send({ reason: 'Seasonal refresh' })).status).toBe(200);
    expect((await request(app).get('/api/v1/catalog/site')).body.data.hero).toBeNull();
    const actions = (await models.AuditEvent.find({ entityType: 'site' }).lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['site.hero_draft_upload', 'site.hero_publish', 'site.hero_unpublish']));
  });
});

describe('spotlight management', () => {
  it('orders placements as the admin sets them and refuses ineligible businesses', async () => {
    const admin = await loginAdmin(app, fakes);
    const a = await createVendor(app, fakes, { name: 'Alpha Co' });
    const b = await createVendor(app, fakes, { name: 'Beta Co' });
    const c = await createVendor(app, fakes, { name: 'Gamma Co' });
    for (const v of [a, b, c]) await admin.put(`/api/v1/admin/companies/${v.company._id}/spotlight`).send({ active: true });
    expect((await request(app).get('/api/v1/catalog/spotlight')).body.data.map((x) => x.name)).toEqual(['Alpha Co', 'Beta Co', 'Gamma Co']);

    const order = [c, a, b].map((v) => v.company._id.toString());
    expect((await admin.put('/api/v1/admin/spotlight/order').send({ ids: order })).status).toBe(204);
    expect((await request(app).get('/api/v1/catalog/spotlight')).body.data.map((x) => x.name)).toEqual(['Gamma Co', 'Alpha Co', 'Beta Co']);

    // Ordering cannot be used to place a business that isn't in the spotlight.
    const d = await createVendor(app, fakes, { name: 'Delta Co' });
    expect((await admin.put('/api/v1/admin/spotlight/order').send({ ids: [...order, d.company._id.toString()] })).status).toBe(422);
    expect((await admin.put('/api/v1/admin/spotlight/order').send({ ids: [order[0], order[0]] })).status).toBe(422);
    expect((await a.client.put('/api/v1/admin/spotlight/order').send({ ids: order })).status).toBe(403);

    // Suspended businesses can't be placed, and a placed business disappears publicly once suspended.
    await models.Company.updateOne({ _id: d.company._id }, { $set: { status: 'suspended' } });
    expect((await admin.put(`/api/v1/admin/companies/${d.company._id}/spotlight`).send({ active: true })).status).toBe(409);
    await models.Company.updateOne({ _id: a.company._id }, { $set: { status: 'suspended' } });
    expect((await request(app).get('/api/v1/catalog/spotlight')).body.data.map((x) => x.name)).toEqual(['Gamma Co', 'Beta Co']);

    const adminList = (await admin.get('/api/v1/admin/spotlight')).body.data;
    expect(adminList.map((x) => [x.name, x.visible])).toEqual([
      ['Gamma Co', true],
      ['Alpha Co', false],
      ['Beta Co', true],
    ]);
  });
});

describe('location-aware homepage rows', () => {
  it('limits most-booked and category rows to the selected area', async () => {
    const austin = await createVendor(app, fakes, { name: 'Austin Busy', durationMinutes: 30 });
    const leeds = await createVendor(app, fakes, { name: 'Leeds Busy', durationMinutes: 30 });
    await models.Company.updateOne({ _id: leeds.company._id }, { $set: { address: { city: 'Leeds', region: 'West Yorkshire', postalCode: 'LS1 4AP', country: 'GB' } } });
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    for (const v of [austin, leeds]) {
      const slots = await firstSlots(app, v.company, v.service);
      for (const slot of slots.slice(0, 3)) await customer.post('/api/v1/bookings').send({ serviceId: v.service._id.toString(), startAt: slot.startAt });
    }

    const all = await request(app).get('/api/v1/catalog/most-booked');
    expect(all.body.data.map((c) => c.name).sort()).toEqual(['Austin Busy', 'Leeds Busy']);
    const gb = await request(app).get('/api/v1/catalog/most-booked').query({ country: 'GB', postalCode: 'LS1 4AP' });
    expect(gb.body.data.map((c) => c.name)).toEqual(['Leeds Busy']);
    expect(gb.body.meta.area).toBe(true);
    const nowhere = await request(app).get('/api/v1/catalog/most-booked').query({ city: 'Lisbon', country: 'PT' });
    expect(nowhere.body.data).toEqual([]);

    const rows = await request(app).get('/api/v1/catalog/collections').query({ city: 'austin' });
    expect(rows.body.data[0].items.map((i) => i.name)).toEqual(['Austin Busy']);
    // Operator-like values are rejected by the schema.
    expect((await request(app).get('/api/v1/catalog/most-booked').query({ postalCode: '{"$ne":1}' })).status).toBe(400);
  });

  it('matches coordinates only for businesses within the radius', async () => {
    const near = await createVendor(app, fakes, { name: 'Near Co' });
    const far = await createVendor(app, fakes, { name: 'Far Co' });
    await models.Company.updateOne({ _id: near.company._id }, { $set: { location: { type: 'Point', coordinates: [-97.74, 30.27] } } });
    await models.Company.updateOne({ _id: far.company._id }, { $set: { location: { type: 'Point', coordinates: [-96.8, 32.78] } } });
    const res = await request(app).get('/api/v1/catalog/collections').query({ lat: 30.26, lng: -97.75, radiusKm: 25 });
    expect(res.body.data[0].items.map((i) => i.name)).toEqual(['Near Co']);
  });
});

describe('homepage category rows', () => {
  it('come only from published categories a Super Admin keeps on the homepage', async () => {
    const admin = await loginAdmin(app, fakes);
    const { category } = await createVendor(app, fakes, { name: 'Sparkle Cleaning' });
    expect((await request(app).get('/api/v1/catalog/collections')).body.data.map((c) => c.category.slug)).toEqual(['cleaning']);

    // Taking the row off the homepage keeps the category published and searchable.
    expect((await admin.patch(`/api/v1/admin/categories/${category._id}`).send({ showOnHomepage: false })).body.data.showOnHomepage).toBe(false);
    expect((await request(app).get('/api/v1/catalog/collections')).body.data).toEqual([]);
    expect((await request(app).get('/api/v1/catalog/categories')).body.data.map((c) => c.slug)).toContain('cleaning');
    expect((await request(app).get('/api/v1/catalog/companies').query({ category: 'cleaning' })).body.data).toHaveLength(1);
  });
});

describe('public site configuration caching', () => {
  it('is revalidated on every load so a replaced hero or banner is never served stale', async () => {
    const res = await request(app).get('/api/v1/catalog/site');
    expect(res.headers['cache-control']).toBe('public, no-cache');
    expect(res.headers.etag).toBeTruthy();
    const again = await request(app).get('/api/v1/catalog/site').set('If-None-Match', res.headers.etag);
    expect(again.status).toBe(304);
    expect((await request(app).get('/api/v1/catalog/categories')).headers['cache-control']).toBe('public, no-cache');
  });
});
