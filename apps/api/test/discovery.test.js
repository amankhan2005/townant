import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createVendor, firstSlots, loginAdmin, loginCustomer, resetDb, startTestServer, stopTestServer } from './helpers.js';

let app;
let fakes;
let models;

beforeAll(async () => {
  ({ app, fakes } = await startTestServer());
  models = await import('../src/models/index.js');
});
afterAll(stopTestServer);
beforeEach(resetDb);

describe('spotlight', () => {
  it('is set only by Super Admins, audited, and shows only published businesses', async () => {
    const admin = await loginAdmin(app, fakes);
    const a = await createVendor(app, fakes, { name: 'Shine Co' });
    const b = await createVendor(app, fakes, { name: 'Draft Co' });
    expect((await request(app).get('/api/v1/catalog/spotlight')).body.data).toEqual([]);

    // Vendors and customers cannot spotlight themselves.
    expect((await a.client.put(`/api/v1/admin/companies/${a.company._id}/spotlight`).send({ active: true })).status).toBe(403);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    expect((await customer.put(`/api/v1/admin/companies/${a.company._id}/spotlight`).send({ active: true })).status).toBe(403);

    const on = await admin.put(`/api/v1/admin/companies/${a.company._id}/spotlight`).send({ active: true, headline: 'Spring deep cleans', blurb: 'Booked by neighbors across Austin.' });
    expect(on.status).toBe(200);
    await admin.put(`/api/v1/admin/companies/${b.company._id}/spotlight`).send({ active: true, headline: 'Hidden' });
    await models.Company.updateOne({ _id: b.company._id }, { $set: { status: 'draft' } });

    const list = await request(app).get('/api/v1/catalog/spotlight');
    expect(list.body.data.map((c) => c.name)).toEqual(['Shine Co']);
    expect(list.body.data[0].spotlight).toEqual({ headline: 'Spring deep cleans', blurb: 'Booked by neighbors across Austin.' });
    expect(await models.AuditEvent.countDocuments({ action: 'company.spotlight_on' })).toBe(2);

    await admin.put(`/api/v1/admin/companies/${a.company._id}/spotlight`).send({ active: false });
    expect((await request(app).get('/api/v1/catalog/spotlight')).body.data).toEqual([]);
    // Over-long copy and unknown fields are rejected.
    expect((await admin.put(`/api/v1/admin/companies/${a.company._id}/spotlight`).send({ active: true, headline: 'x'.repeat(81) })).status).toBe(400);
    expect((await admin.put(`/api/v1/admin/companies/${a.company._id}/spotlight`).send({ active: true, discount: '50%' })).status).toBe(400);
  });
});

describe('most booked', () => {
  it('ranks by confirmed/completed bookings in the last 90 days and exposes no counts', async () => {
    const busy = await createVendor(app, fakes, { name: 'Busy Co', durationMinutes: 30 });
    const quiet = await createVendor(app, fakes, { name: 'Quiet Co', durationMinutes: 30 });
    const none = await createVendor(app, fakes, { name: 'Unbooked Co' });
    const c1 = await loginCustomer(app, fakes, 'c1@example.com');
    const busySlots = await firstSlots(app, busy.company, busy.service);
    for (const slot of busySlots.slice(0, 3)) await c1.post('/api/v1/bookings').send({ serviceId: busy.service._id.toString(), startAt: slot.startAt });
    const [quietSlot, quietSlot2] = await firstSlots(app, quiet.company, quiet.service);
    await c1.post('/api/v1/bookings').send({ serviceId: quiet.service._id.toString(), startAt: quietSlot.startAt });
    // A cancelled booking does not count.
    const cancelled = await c1.post('/api/v1/bookings').send({ serviceId: quiet.service._id.toString(), startAt: quietSlot2.startAt });
    await models.Booking.updateOne({ _id: cancelled.body.data.id }, { $set: { status: 'cancelled_by_customer' } });

    const res = await request(app).get('/api/v1/catalog/most-booked');
    expect(res.status).toBe(200);
    // Quiet Co has one qualifying booking: below the minimum that justifies "most booked".
    expect(res.body.data.map((c) => c.name)).toEqual(['Busy Co']);
    expect(res.body.meta.minBookings).toBe(3);
    expect(res.body.data.map((c) => c.name)).not.toContain(none.company.name);
    expect(JSON.stringify(res.body.data)).not.toMatch(/"n"|bookingCount|count":3/);

    // Old bookings fall out of the window; unpublished businesses never appear.
    await models.Booking.collection.updateMany({ companyId: busy.company._id }, { $set: { createdAt: new Date(Date.now() - 91 * 86400000) } });
    await models.Company.updateOne({ _id: quiet.company._id }, { $set: { status: 'suspended' } });
    expect((await request(app).get('/api/v1/catalog/most-booked')).body.data).toEqual([]);
  });
});

describe('category collections', () => {
  it('returns only active categories that have published businesses', async () => {
    const { category } = await createVendor(app, fakes, { name: 'Clean A' });
    await models.Category.create({ name: 'Empty Category', slug: 'empty-cat' });
    const hidden = await models.Category.create({ name: 'Hidden', slug: 'hidden-cat', isActive: false });
    const other = await createVendor(app, fakes, { name: 'In Hidden' });
    await models.Company.updateOne({ _id: other.company._id }, { $set: { categoryIds: [hidden._id], primaryCategoryId: hidden._id } });

    const res = await request(app).get('/api/v1/catalog/collections');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.category.slug)).toEqual([category.slug]);
    expect(res.body.data[0].items.map((i) => i.name)).toEqual(['Clean A']);
  });
});

describe('new badge', () => {
  it('marks only businesses published in the last 30 days', async () => {
    const fresh = await createVendor(app, fakes, { name: 'Fresh Co' });
    const old = await createVendor(app, fakes, { name: 'Old Co' });
    await models.Company.updateOne({ _id: old.company._id }, { $set: { publishedAt: new Date(Date.now() - 45 * 86400000) } });
    const res = await request(app).get('/api/v1/catalog/companies').query({ sort: 'newest' });
    const byName = Object.fromEntries(res.body.data.map((c) => [c.name, c.isNew]));
    expect(byName).toEqual({ 'Fresh Co': true, 'Old Co': false });
    expect(fresh.company.name).toBe('Fresh Co');
  });
});

describe('location-aware search', () => {
  // Downtown Austin; Georgetown is ~42 km north.
  const AUSTIN = { lat: 30.2672, lng: -97.7431 };
  const GEORGETOWN = [-97.6779, 30.6333];
  const place = async (name, patch) => {
    const v = await createVendor(app, fakes, { name });
    await models.Company.updateOne({ _id: v.company._id }, { $set: { location: { type: 'Point', coordinates: GEORGETOWN }, ...patch } });
    return v;
  };

  it('includes businesses that travel to the customer when their own service radius reaches them', async () => {
    await place('Shop Only', { serviceMode: 'fixed' });
    await place('Travels Far', { serviceMode: 'mobile', serviceArea: { radiusKm: 60 } });
    await place('Travels Near', { serviceMode: 'both', serviceArea: { radiusKm: 20 } });
    await place('Travels Unset', { serviceMode: 'mobile' });

    const near = await request(app).get('/api/v1/catalog/companies').query({ ...AUSTIN, radiusKm: 25 });
    expect(near.status).toBe(200);
    expect(near.body.data.map((c) => c.name)).toEqual(['Travels Far']);
    expect(near.body.data[0].distanceKm).toBeGreaterThan(25);
    expect(near.body.meta.total).toBe(1);

    // A wider customer radius still includes everything inside it, whatever the service mode.
    const wide = await request(app).get('/api/v1/catalog/companies').query({ ...AUSTIN, radiusKm: 50 });
    expect(wide.body.data.map((c) => c.name).sort()).toEqual(['Shop Only', 'Travels Far', 'Travels Near', 'Travels Unset']);
  });

  it('shows a starting price only from active services with a published price', async () => {
    const a = await createVendor(app, fakes, { name: 'Priced Co' });
    const b = await createVendor(app, fakes, { name: 'Quote Co' });
    await models.Service.updateOne({ _id: a.service._id }, { $set: { price: { display: 'from', amount: 80, currency: 'USD' } } });
    await models.Service.create({ companyId: a.company._id, title: 'Quick tidy', durationMinutes: 30, price: { display: 'fixed', amount: 45, currency: 'USD' } });
    await models.Service.create({ companyId: a.company._id, title: 'Retired', durationMinutes: 30, isActive: false, price: { display: 'fixed', amount: 5, currency: 'USD' } });
    await models.Service.create({ companyId: a.company._id, title: 'Secret', durationMinutes: 30, price: { display: 'hidden', amount: 1, currency: 'USD' } });
    await models.Service.updateOne({ _id: b.service._id }, { $set: { price: { display: 'quote' } } });

    const res = await request(app).get('/api/v1/catalog/companies').query({ q: 'co' });
    const byName = Object.fromEntries(res.body.data.map((c) => [c.name, c.priceFrom]));
    expect(byName).toEqual({ 'Priced Co': { amount: 45, currency: 'USD' }, 'Quote Co': null });
  });
});
