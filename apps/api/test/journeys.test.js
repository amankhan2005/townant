import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearerClient, createVendor, dateAhead, firstSlots, loginAdmin, loginCustomer, resetDb, startTestServer, stopTestServer } from './helpers.js';

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

const application = (overrides = {}) => ({
  businessName: 'Bright Paws Grooming',
  contactName: 'Alex Morgan',
  email: 'alex@brightpaws.test',
  phone: '+1 512 555 0142',
  description: 'Mobile dog grooming across central Austin, gentle handling, all breeds.',
  address: { city: 'Austin', region: 'TX', postalCode: '78704', country: 'US' },
  serviceMode: 'mobile',
  ...overrides,
});

const inviteToken = () => {
  const mail = fakes.sent.email.find((m) => m.text.includes('/business/setup?token='));
  return decodeURIComponent(mail.text.match(/token=([^\s]+)/)[1]);
};

describe('vendor onboarding', () => {
  it('runs from public application to a published, bookable listing', async () => {
    const admin = await loginAdmin(app, fakes);
    const cat = await admin.post('/api/v1/admin/categories').send({ name: 'Pet Care', slug: 'pet-care', icon: 'paw' });
    expect(cat.status).toBe(201);

    const submitted = await request(app).post('/api/v1/vendor-applications').send(application({ categoryIds: [cat.body.data.id] }));
    expect(submitted.status).toBe(202);
    const list = await admin.get('/api/v1/admin/applications?status=submitted');
    expect(list.body.data).toHaveLength(1);
    const appId = list.body.data[0].id;
    expect((await admin.get(`/api/v1/admin/applications/${appId}`)).body.data.status).toBe('under_review');

    const approved = await admin.post(`/api/v1/admin/applications/${appId}/approve`).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.data.inviteEmailSent).toBe(true);
    expect(approved.body.data.company.status).toBe('draft');
    // Not visible to the public until the vendor publishes.
    expect((await request(app).get(`/api/v1/catalog/companies/${approved.body.data.company.slug}`)).status).toBe(404);
    // Approving twice is refused.
    expect((await admin.post(`/api/v1/admin/applications/${appId}/approve`).send({})).status).toBe(409);

    // The setup email contains a single-use link; no password is ever emailed.
    const token = inviteToken();
    expect(fakes.sent.email.some((m) => /password:/i.test(m.text))).toBe(false);
    const inspect = await request(app).post('/api/v1/staff-auth/invite/inspect').send({ token });
    expect(inspect.body.data).toMatchObject({ valid: true, companyName: 'Bright Paws Grooming' });

    const weak = await request(app).post('/api/v1/staff-auth/invite/accept').send({ token, password: 'short', displayName: 'Alex' });
    expect(weak.status).toBe(400);
    const accepted = await request(app).post('/api/v1/staff-auth/invite/accept').send({ token, password: 'a-very-good-passphrase-42', displayName: 'Alex', transport: 'bearer' });
    expect(accepted.status).toBe(200);
    const reused = await request(app).post('/api/v1/staff-auth/invite/accept').send({ token, password: 'another-good-passphrase-1', displayName: 'Mallory' });
    expect(reused.status).toBe(400);

    const vendor = bearerClient(app, accepted.body.data.token, accepted.body.data.user);
    const ctx = await vendor.get('/api/v1/vendor/context');
    expect(ctx.body.data).toMatchObject({ role: 'owner', company: { name: 'Bright Paws Grooming', status: 'draft' } });

    const early = await vendor.post('/api/v1/vendor/company/publish');
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('PROFILE_INCOMPLETE');

    const svc = await vendor.post('/api/v1/vendor/services').send({ title: 'Full groom', durationMinutes: 90, price: { display: 'from', amount: 65, currency: 'USD' } });
    expect(svc.status).toBe(201);
    const hours = await vendor.put('/api/v1/vendor/company/availability').send({
      timezone: 'America/Chicago',
      weekly: [[], ...Array.from({ length: 5 }, () => [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }]), []],
      exceptions: [],
      slotIntervalMinutes: 30,
      bufferMinutes: 15,
      minNoticeMinutes: 120,
      maxAdvanceDays: 45,
    });
    expect(hours.status).toBe(200);
    const published = await vendor.post('/api/v1/vendor/company/publish');
    expect(published.status).toBe(200);

    const search = await request(app).get('/api/v1/catalog/companies').query({ q: 'groom', city: 'austin' });
    expect(search.body.data.map((c) => c.name)).toEqual(['Bright Paws Grooming']);
    const byCategory = await request(app).get('/api/v1/catalog/companies').query({ category: 'pet-care' });
    expect(byCategory.body.meta.total).toBe(1);
    const profile = await request(app).get(`/api/v1/catalog/companies/${approved.body.data.company.slug}`);
    expect(profile.body.data.address.line1).toBeUndefined(); // mobile vendor: no street address shown
    const services = await request(app).get(`/api/v1/catalog/companies/${approved.body.data.company.slug}/services`);
    expect(services.body.data[0]).toMatchObject({ title: 'Full groom', price: { display: 'from', amount: 65, currency: 'USD' } });
  });

  it('rejects with a reason and notifies the applicant', async () => {
    const admin = await loginAdmin(app, fakes);
    await request(app).post('/api/v1/vendor-applications').send(application());
    const [{ id }] = (await admin.get('/api/v1/admin/applications')).body.data;
    expect((await admin.post(`/api/v1/admin/applications/${id}/reject`).send({})).status).toBe(400);
    const res = await admin.post(`/api/v1/admin/applications/${id}/reject`).send({ reason: 'Outside service area' });
    expect(res.body.data.status).toBe('rejected');
    const { processDeliveries } = await import('../src/services/notifications.js');
    await processDeliveries();
    expect(fakes.sent.email.some((m) => m.to === 'alex@brightpaws.test' && m.text.includes('Outside service area'))).toBe(true);
  });

  it('silently drops honeypot submissions and dedupes open applications', async () => {
    expect((await request(app).post('/api/v1/vendor-applications').send(application({ company_website: 'http://spam' }))).status).toBe(202);
    expect(await models.VendorApplication.countDocuments()).toBe(0);
    await request(app).post('/api/v1/vendor-applications').send(application());
    await request(app).post('/api/v1/vendor-applications').send(application());
    expect(await models.VendorApplication.countDocuments()).toBe(1);
  });

  it('cannot grant roles through the application form', async () => {
    const res = await request(app).post('/api/v1/vendor-applications').send({ ...application(), role: 'super_admin', status: 'approved' });
    expect(res.status).toBe(400);
  });

  it('supports password reset that signs out other sessions without revealing accounts', async () => {
    const { client, owner } = await createVendor(app, fakes);
    const unknown = await request(app).post('/api/v1/staff-auth/password/forgot').send({ email: 'nobody@vendor.test' });
    const known = await request(app).post('/api/v1/staff-auth/password/forgot').send({ email: owner.email });
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    const mail = fakes.sent.email.find((m) => m.text.includes('reset-password?token='));
    const token = decodeURIComponent(mail.text.match(/token=([^\s]+)/)[1]);
    expect((await request(app).post('/api/v1/staff-auth/password/reset').send({ token, password: 'brand-new-passphrase-9' })).status).toBe(200);
    expect((await client.get('/api/v1/vendor/context')).status).toBe(401);
    expect((await request(app).post('/api/v1/staff-auth/login').send({ email: owner.email, password: 'brand-new-passphrase-9' })).status).toBe(200);
  });
});

describe('customer marketplace journey', () => {
  it('favorites, inquires, books, chats, reviews and receives notifications', async () => {
    const { company, service, client: vendor } = await createVendor(app, fakes, { name: 'Glow Salon' });
    const customer = await loginCustomer(app, fakes, 'sam@example.com', { displayName: 'Sam Rivera' });

    expect((await customer.put(`/api/v1/favorites/${company._id}`)).status).toBe(204);
    expect((await customer.put(`/api/v1/favorites/${company._id}`)).status).toBe(204); // idempotent
    expect((await customer.get('/api/v1/favorites')).body.data.map((c) => c.name)).toEqual(['Glow Salon']);

    const convo = await customer.post('/api/v1/conversations').send({ companyId: company._id.toString(), subject: 'Parking?', body: 'Is there parking nearby?' });
    expect(convo.status).toBe(201);
    const vendorInbox = await vendor.get('/api/v1/vendor/conversations');
    expect(vendorInbox.body.data[0]).toMatchObject({ subject: 'Parking?', unread: 1, customer: { name: 'Sam Rivera' } });
    await vendor.post(`/api/v1/vendor/conversations/${convo.body.data.id}/messages`).send({ body: 'Yes, free lot behind us.' });
    const thread = await customer.get(`/api/v1/conversations/${convo.body.data.id}/messages`);
    expect(thread.body.data.messages.map((m) => m.senderType)).toEqual(['customer', 'vendor']);

    // Another customer cannot read the thread.
    const other = await loginCustomer(app, fakes, 'other@example.com');
    expect((await other.get(`/api/v1/conversations/${convo.body.data.id}/messages`)).status).toBe(404);

    const [slot] = await firstSlots(app, company, service);
    const booking = await customer.post('/api/v1/bookings').send({ serviceId: service._id.toString(), startAt: slot.startAt });
    expect(booking.status).toBe(201);

    // Vendor sees verified contact details needed to deliver the service.
    const vb = await vendor.get(`/api/v1/vendor/bookings/${booking.body.data.id}`);
    expect(vb.body.data.customer).toMatchObject({ name: 'Sam Rivera', email: 'sam@example.com' });

    // Review only after completion.
    const early = await customer.post('/api/v1/reviews').send({ bookingId: booking.body.data.id, rating: 5, text: 'Great' });
    expect(early.status).toBe(422);
    await models.Booking.collection.updateOne({ _id: new (await import('mongoose')).default.Types.ObjectId(booking.body.data.id) }, { $set: { startAt: new Date(Date.now() - 7200000), endAt: new Date(Date.now() - 3600000) } });
    expect((await vendor.post(`/api/v1/vendor/bookings/${booking.body.data.id}/complete`).send({})).status).toBe(200);
    const review = await customer.post('/api/v1/reviews').send({ bookingId: booking.body.data.id, rating: 4, text: 'Lovely cut, slightly late start.' });
    expect(review.status).toBe(201);
    expect((await customer.post('/api/v1/reviews').send({ bookingId: booking.body.data.id, rating: 1 })).status).toBe(409);
    expect((await other.post('/api/v1/reviews').send({ bookingId: booking.body.data.id, rating: 1 })).status).toBe(404);

    const profile = await request(app).get(`/api/v1/catalog/companies/${company.slug}`);
    expect(profile.body.data.rating).toEqual({ average: 4, count: 1 });

    const reply = await vendor.put(`/api/v1/vendor/reviews/${review.body.data.id}/reply`).send({ text: 'Thanks Sam!' });
    expect(reply.status).toBe(200);

    // Moderation hides without editing, and the rating follows.
    expect((await other.post(`/api/v1/reviews/${review.body.data.id}/report`).send({ reason: 'not_genuine' })).status).toBe(202);
    const admin = await loginAdmin(app, fakes);
    const reported = await admin.get('/api/v1/admin/reviews?reported=true');
    expect(reported.body.data[0].openReports).toHaveLength(1);
    await admin.post(`/api/v1/admin/reviews/${review.body.data.id}/hide`).send({ reason: 'Verified as fake' });
    const after = await request(app).get(`/api/v1/catalog/companies/${company.slug}`);
    expect(after.body.data.rating).toEqual({ average: 0, count: 0 });
    expect((await models.Review.findById(review.body.data.id)).text).toBe('Lovely cut, slightly late start.');

    const notes = await customer.get('/api/v1/notifications');
    expect(notes.body.meta.unread).toBeGreaterThan(0);
    expect(notes.body.data.map((n) => n.type)).toEqual(expect.arrayContaining(['booking_confirmed', 'message_received']));
    await customer.post('/api/v1/notifications/read-all');
    expect((await customer.get('/api/v1/notifications/unread-count')).body.data.unread).toBe(0);

    const analytics = await vendor.get('/api/v1/vendor/dashboard');
    expect(analytics.body.data.last30Days).toMatchObject({ favorites: 1, inquiries: 1, bookings: 1 });
  });

  it('hides vendor-disabled profile sections from the public profile', async () => {
    const { company, client } = await createVendor(app, fakes);
    await client.patch('/api/v1/vendor/company').send({ sections: { reviews: false, hours: false, contact: false } });
    const res = await request(app).get(`/api/v1/catalog/companies/${company.slug}`);
    expect(res.body.data.hours).toBeNull();
    expect(res.body.data.contact).toBeNull();
    expect(res.body.data.rating).toBeNull();
    expect(res.body.data.gallery).toEqual([]);
  });

  it('filters search by real availability on a date', async () => {
    const open = await createVendor(app, fakes, { name: 'Open Co' });
    const closed = await createVendor(app, fakes, { name: 'Closed Co' });
    const date = dateAhead(5);
    await models.Company.updateOne({ _id: closed.company._id }, { $push: { 'availability.exceptions': { date, closed: true, intervals: [] } } });
    const res = await request(app).get('/api/v1/catalog/companies').query({ availableOn: date });
    expect(res.body.data.map((c) => c.name)).toEqual([open.company.name]);
  });

  it('counts a profile view once per visitor window', async () => {
    const { company } = await createVendor(app, fakes);
    for (let i = 0; i < 3; i += 1) await request(app).post(`/api/v1/catalog/companies/${company.slug}/view`);
    expect(await models.AnalyticsEvent.countDocuments({ type: 'profile_view' })).toBe(1);
  });

  it('only includes published companies in search', async () => {
    const { company } = await createVendor(app, fakes, { name: 'Hidden Draft' });
    await models.Company.updateOne({ _id: company._id }, { $set: { status: 'draft' } });
    const res = await request(app).get('/api/v1/catalog/companies').query({ q: 'hidden' });
    expect(res.body.data).toHaveLength(0);
    expect((await request(app).get(`/api/v1/catalog/companies/${company.slug}/services`)).status).toBe(404);
  });
});
