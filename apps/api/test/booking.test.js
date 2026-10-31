import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createVendor, dateAhead, firstSlots, loginAdmin, loginCustomer, resetDb, startTestServer, stopTestServer } from './helpers.js';

let app;
let fakes;
let models;

beforeAll(async () => {
  ({ app, fakes } = await startTestServer());
  models = await import('../src/models/index.js');
});
afterAll(stopTestServer);
beforeEach(resetDb);

const book = (client, body, key) => {
  const req = client.post('/api/v1/bookings');
  if (key) req.set('Idempotency-Key', key);
  return req.send(body);
};

describe('booking creation', () => {
  it('creates an instant booking from a server-offered slot and notifies both sides', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c1@example.com');
    const [slot] = await firstSlots(app, company, service);
    const res = await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt, note: 'Gate code 1234' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'confirmed', startAt: slot.startAt, company: { name: company.name } });
    expect(res.body.data.reference).toMatch(/^TA-[A-Z0-9]{8}$/);
    expect(await models.SlotClaim.countDocuments()).toBe(12); // 60 minutes / 5-minute units
    expect(await models.Notification.countDocuments({ type: 'booking_confirmed' })).toBe(2);
    expect(await models.NotificationDelivery.countDocuments()).toBe(4);
  });

  it('creates a pending request for request-mode services', async () => {
    const { company, service } = await createVendor(app, fakes, { bookingMode: 'request' });
    const customer = await loginCustomer(app, fakes, 'c1@example.com');
    const [slot] = await firstSlots(app, company, service);
    const res = await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('requested');
    expect(res.body.data.requestExpiresAt).toBeTruthy();
  });

  it('rejects a second booking for a taken slot and stops offering it', async () => {
    const { company, service } = await createVendor(app, fakes);
    const a = await loginCustomer(app, fakes, 'a@example.com');
    const b = await loginCustomer(app, fakes, 'b@example.com');
    const [slot] = await firstSlots(app, company, service);
    expect((await book(a, { serviceId: service._id.toString(), startAt: slot.startAt })).status).toBe(201);
    const second = await book(b, { serviceId: service._id.toString(), startAt: slot.startAt });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SLOT_UNAVAILABLE');
    const after = await firstSlots(app, company, service);
    expect(after.find((s) => s.startAt === slot.startAt)).toBeUndefined();
  });

  it('rejects an overlapping booking that starts mid-appointment', async () => {
    const { company, service } = await createVendor(app, fakes, { durationMinutes: 90 });
    const a = await loginCustomer(app, fakes, 'a@example.com');
    const b = await loginCustomer(app, fakes, 'b@example.com');
    const slots = await firstSlots(app, company, service);
    expect((await book(a, { serviceId: service._id.toString(), startAt: slots[0].startAt })).status).toBe(201);
    // slots[1] starts 30 minutes later, inside the first 90-minute booking.
    const overlap = await book(b, { serviceId: service._id.toString(), startAt: slots[1].startAt });
    expect(overlap.status).toBe(409);
  });

  it('allows exactly one of many concurrent requests for the same slot', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customers = [];
    for (let i = 0; i < 8; i += 1) customers.push(await loginCustomer(app, fakes, `race${i}@example.com`));
    const [slot] = await firstSlots(app, company, service);
    const results = await Promise.all(customers.map((c) => book(c, { serviceId: service._id.toString(), startAt: slot.startAt })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(await models.Booking.countDocuments()).toBe(1);
  });

  it('allows only one of concurrent overlapping (different start) requests', async () => {
    const { company, service } = await createVendor(app, fakes, { durationMinutes: 120 });
    const customers = [];
    for (let i = 0; i < 4; i += 1) customers.push(await loginCustomer(app, fakes, `ov${i}@example.com`));
    const slots = await firstSlots(app, company, service);
    const results = await Promise.all(customers.map((c, i) => book(c, { serviceId: service._id.toString(), startAt: slots[i].startAt })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('rejects times the schedule does not offer (off-grid, past, outside hours, too far ahead)', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    const offGrid = new Date(new Date(slot.startAt).getTime() + 7 * 60000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString().replace(/T.*/, 'T10:00:00.000Z');
    const night = `${dateAhead(3)}T23:00:00.000Z`;
    const farFuture = `${dateAhead(200)}T10:00:00.000Z`;
    for (const startAt of [offGrid, past, night, farFuture]) {
      const res = await book(customer, { serviceId: service._id.toString(), startAt });
      expect(res.status, startAt).toBe(409);
    }
    expect(await models.Booking.countDocuments()).toBe(0);
  });

  it('rejects protected fields and forged identifiers in the body (mass assignment)', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    const base = { serviceId: service._id.toString(), startAt: slot.startAt };
    for (const extra of [{ status: 'completed' }, { customerId: '64b000000000000000000000' }, { companyId: company._id.toString() }, { price: 0 }, { endAt: slot.startAt }]) {
      const res = await book(customer, { ...base, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('replays an idempotent retry instead of creating a duplicate', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const slots = await firstSlots(app, company, service);
    const body = { serviceId: service._id.toString(), startAt: slots[0].startAt };
    const first = await book(customer, body, 'retry-key-0001');
    const again = await book(customer, body, 'retry-key-0001');
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.meta.replayed).toBe(true);
    expect(again.body.data.id).toBe(first.body.data.id);
    const misuse = await book(customer, { ...body, startAt: slots[3].startAt }, 'retry-key-0001');
    expect(misuse.status).toBe(422);
    expect(await models.Booking.countDocuments()).toBe(1);
  });

  it('handles concurrent retries with the same idempotency key as one booking', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    const results = await Promise.all(Array.from({ length: 5 }, () => book(customer, { serviceId: service._id.toString(), startAt: slot.startAt }, 'same-key-123')));
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await models.Booking.countDocuments()).toBe(1);
  });

  it('requires an authenticated customer account', async () => {
    const { company, service, client: vendor } = await createVendor(app, fakes);
    const [slot] = await firstSlots(app, company, service);
    const body = { serviceId: service._id.toString(), startAt: slot.startAt };
    expect((await request(app).post('/api/v1/bookings').send(body)).status).toBe(401);
    expect((await vendor.post('/api/v1/bookings').send(body)).status).toBe(403);
  });

  it('refuses bookings for unpublished or suspended businesses and archived services', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    await models.Company.updateOne({ _id: company._id }, { $set: { status: 'suspended' } });
    expect((await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt })).status).toBe(404);
    await models.Company.updateOne({ _id: company._id }, { $set: { status: 'published' } });
    await models.Service.updateOne({ _id: service._id }, { $set: { archivedAt: new Date(), isActive: false } });
    expect((await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt })).status).toBe(404);
  });

  it('caps the number of upcoming bookings per customer', async () => {
    const { company, service } = await createVendor(app, fakes, { durationMinutes: 30 });
    const customer = await loginCustomer(app, fakes, 'hoarder@example.com');
    const slots = await firstSlots(app, company, service);
    for (let i = 0; i < 10; i += 1) expect((await book(customer, { serviceId: service._id.toString(), startAt: slots[i].startAt })).status).toBe(201);
    const res = await book(customer, { serviceId: service._id.toString(), startAt: slots[10].startAt });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_LIMIT_REACHED');
  });

  it('succeeds even when the email provider is down (delivery is asynchronous)', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    fakes.failNext.email = true;
    const res = await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt });
    expect(res.status).toBe(201);
    const { processDeliveries } = await import('../src/services/notifications.js');
    await processDeliveries();
    expect(await models.Booking.countDocuments({ status: 'confirmed' })).toBe(1);
    const failed = await models.NotificationDelivery.findOne({ channel: 'email', lastError: { $exists: true, $ne: null }, status: 'pending' });
    expect(failed).toBeTruthy(); // queued for retry, booking untouched
  });
});

describe('booking access control', () => {
  it("hides another customer's booking (read and write) as not found", async () => {
    const { company, service } = await createVendor(app, fakes);
    const owner = await loginCustomer(app, fakes, 'owner@example.com');
    const intruder = await loginCustomer(app, fakes, 'intruder@example.com');
    const [slot] = await firstSlots(app, company, service);
    const { body } = await book(owner, { serviceId: service._id.toString(), startAt: slot.startAt });
    const id = body.data.id;
    expect((await intruder.get(`/api/v1/bookings/${id}`)).status).toBe(404);
    expect((await intruder.post(`/api/v1/bookings/${id}/cancel`).send({})).status).toBe(404);
    expect((await intruder.post(`/api/v1/bookings/${id}/reschedule`).send({ startAt: slot.startAt })).status).toBe(404);
    const list = await intruder.get('/api/v1/bookings?when=all');
    expect(list.body.data).toHaveLength(0);
  });

  it("prevents a vendor from reading or changing another company's appointments", async () => {
    const a = await createVendor(app, fakes, { name: 'Vendor A' });
    const b = await createVendor(app, fakes, { name: 'Vendor B' });
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, a.company, a.service);
    const { body } = await book(customer, { serviceId: a.service._id.toString(), startAt: slot.startAt });
    const id = body.data.id;
    expect((await b.client.get(`/api/v1/vendor/bookings/${id}`)).status).toBe(404);
    for (const action of ['confirm', 'decline', 'cancel', 'complete', 'no-show']) {
      expect((await b.client.post(`/api/v1/vendor/bookings/${id}/${action}`).send({ reason: 'x' })).status).toBe(404);
    }
    // X-Company-Id cannot select a company the vendor is not a member of.
    const forged = await b.client.get(`/api/v1/vendor/bookings/${id}`).set('X-Company-Id', a.company._id.toString());
    expect(forged.status).toBe(403);
    expect((await b.client.get('/api/v1/vendor/bookings?view=all')).body.data).toHaveLength(0);
    expect((await a.client.get(`/api/v1/vendor/bookings/${id}`)).status).toBe(200);
  });

  it('does not let a customer use vendor or admin transitions', async () => {
    const { company, service } = await createVendor(app, fakes, { bookingMode: 'request' });
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    const { body } = await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt });
    expect((await customer.post(`/api/v1/vendor/bookings/${body.data.id}/confirm`).send({})).status).toBe(403);
    expect((await customer.post(`/api/v1/admin/bookings/${body.data.id}/cancel`).send({ reason: 'hack' })).status).toBe(403);
    expect((await customer.patch(`/api/v1/bookings/${body.data.id}`).send({ status: 'confirmed' })).status).toBe(404);
    expect((await models.Booking.findById(body.data.id)).status).toBe('requested');
  });
});

describe('booking lifecycle', () => {
  it('lets the vendor confirm a request, and not confirm it twice', async () => {
    const { company, service, client: vendor } = await createVendor(app, fakes, { bookingMode: 'request' });
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    const { body } = await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt });
    const ok = await vendor.post(`/api/v1/vendor/bookings/${body.data.id}/confirm`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('confirmed');
    const again = await vendor.post(`/api/v1/vendor/bookings/${body.data.id}/confirm`).send({});
    expect(again.status).toBe(409);
    expect(await models.AuditEvent.countDocuments({ action: 'booking.confirm' })).toBe(1);
  });

  it('rejects completing or marking no-show before the start time', async () => {
    const { company, service, client: vendor } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    const { body } = await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt });
    expect((await vendor.post(`/api/v1/vendor/bookings/${body.data.id}/complete`).send({})).status).toBe(422);
    expect((await vendor.post(`/api/v1/vendor/bookings/${body.data.id}/no-show`).send({})).status).toBe(422);
  });

  it('requires a reason for vendor cancellation and releases the slot', async () => {
    const { company, service, client: vendor } = await createVendor(app, fakes);
    const a = await loginCustomer(app, fakes, 'a@example.com');
    const b = await loginCustomer(app, fakes, 'b@example.com');
    const [slot] = await firstSlots(app, company, service);
    const { body } = await book(a, { serviceId: service._id.toString(), startAt: slot.startAt });
    expect((await vendor.post(`/api/v1/vendor/bookings/${body.data.id}/cancel`).send({})).status).toBe(422);
    const cancelled = await vendor.post(`/api/v1/vendor/bookings/${body.data.id}/cancel`).send({ reason: 'Staff illness' });
    expect(cancelled.body.data.status).toBe('cancelled_by_vendor');
    expect(await models.SlotClaim.countDocuments()).toBe(0);
    expect((await book(b, { serviceId: service._id.toString(), startAt: slot.startAt })).status).toBe(201);
  });

  it('enforces the customer cancellation cutoff on the server', async () => {
    const { company, service } = await createVendor(app, fakes);
    await models.Company.updateOne({ _id: company._id }, { $set: { 'bookingPolicy.cancellationCutoffHours': 168 } });
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    const { body } = await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt });
    expect(body.data.actions).not.toContain('cancel_customer');
    const res = await customer.post(`/api/v1/bookings/${body.data.id}/cancel`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CANCELLATION_WINDOW_PASSED');
  });

  it('lets a customer cancel before the cutoff, then refuses further changes', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service, 5);
    const { body } = await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt });
    const res = await customer.post(`/api/v1/bookings/${body.data.id}/cancel`).send({ reason: 'Plans changed' });
    expect(res.body.data.status).toBe('cancelled_by_customer');
    expect((await customer.post(`/api/v1/bookings/${body.data.id}/cancel`).send({})).status).toBe(409);
    expect((await customer.post(`/api/v1/bookings/${body.data.id}/reschedule`).send({ startAt: slot.startAt })).status).toBe(409);
  });

  it('reschedules atomically: old slot freed, new slot claimed, conflicts rejected', async () => {
    const { company, service } = await createVendor(app, fakes);
    const a = await loginCustomer(app, fakes, 'a@example.com');
    const b = await loginCustomer(app, fakes, 'b@example.com');
    const slots = await firstSlots(app, company, service, 5);
    const first = await book(a, { serviceId: service._id.toString(), startAt: slots[0].startAt });
    await book(b, { serviceId: service._id.toString(), startAt: slots[4].startAt });

    const blocked = await a.post(`/api/v1/bookings/${first.body.data.id}/reschedule`).send({ startAt: slots[4].startAt });
    expect(blocked.status).toBe(409);
    expect((await models.Booking.findById(first.body.data.id)).startAt.toISOString()).toBe(slots[0].startAt);
    expect(await models.SlotClaim.countDocuments({ bookingId: first.body.data.id })).toBe(12);

    const moved = await a.post(`/api/v1/bookings/${first.body.data.id}/reschedule`).send({ startAt: slots[8].startAt });
    expect(moved.status).toBe(200);
    expect(moved.body.data.startAt).toBe(slots[8].startAt);
    // Original time is bookable again.
    expect((await book(b, { serviceId: service._id.toString(), startAt: slots[0].startAt })).status).toBe(201);
  });

  it('lets an admin cancel any booking with an audited reason', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const admin = await loginAdmin(app, fakes);
    const [slot] = await firstSlots(app, company, service);
    const { body } = await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt });
    expect((await admin.post(`/api/v1/admin/bookings/${body.data.id}/cancel`).send({})).status).toBe(400);
    const res = await admin.post(`/api/v1/admin/bookings/${body.data.id}/cancel`).send({ reason: 'Fraud report' });
    expect(res.body.data.status).toBe('cancelled_by_admin');
    const audit = await models.AuditEvent.findOne({ action: 'booking.cancel_admin' });
    expect(audit).toMatchObject({ actorType: 'admin', reason: 'Fraud report' });
  });

  it('expires unanswered requests and frees the slot', async () => {
    const { company, service } = await createVendor(app, fakes, { bookingMode: 'request' });
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    const { body } = await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt });
    await models.Booking.updateOne({ _id: body.data.id }, { $set: { requestExpiresAt: new Date(Date.now() - 1000) } });
    const { expireStaleRequests } = await import('../src/services/booking.js');
    expect(await expireStaleRequests()).toBe(1);
    expect((await models.Booking.findById(body.data.id)).status).toBe('expired');
    expect(await models.SlotClaim.countDocuments()).toBe(0);
  });
});

describe('scheduling rules', () => {
  it('skips wall-clock times that do not exist during a DST change', async () => {
    const { scheduleSlots } = await import('../src/services/availability.js');
    const availability = {
      timezone: 'America/New_York',
      weekly: Array.from({ length: 7 }, () => [{ start: '01:00', end: '04:00' }]),
      exceptions: [],
      slotIntervalMinutes: 30,
      bufferMinutes: 0,
      minNoticeMinutes: 0,
      maxAdvanceDays: 400,
    };
    const now = new Date('2027-03-01T00:00:00Z');
    // 2027-03-14: clocks jump from 02:00 to 03:00 in New York.
    const slots = scheduleSlots({ availability, durationMinutes: 30, date: '2027-03-14', now });
    const { DateTime } = await import('luxon');
    const localHours = slots.map((s) => DateTime.fromJSDate(s.startAt, { zone: 'America/New_York' }).hour);
    expect(localHours).not.toContain(2); // 02:00-02:59 does not exist that night
    expect(localHours).toContain(3);
    expect(slots.every((s) => s.endAt - s.startAt === 30 * 60000)).toBe(true);
    // An ordinary day has 6 half-hour slots between 01:00 and 04:00; the DST day has fewer.
    expect(scheduleSlots({ availability, durationMinutes: 30, date: '2027-03-10', now })).toHaveLength(6);
    expect(slots.length).toBeLessThan(6);
  });

  it('honours closed exceptions and minimum notice', async () => {
    const { company, service, client: vendor } = await createVendor(app, fakes);
    const date = dateAhead(4);
    const res = await vendor.put('/api/v1/vendor/company/availability').send({
      timezone: 'UTC',
      weekly: Array.from({ length: 7 }, () => [{ start: '08:00', end: '20:00' }]),
      exceptions: [{ date, closed: true }],
      slotIntervalMinutes: 30,
      bufferMinutes: 0,
      minNoticeMinutes: 60,
      maxAdvanceDays: 60,
    });
    expect(res.status).toBe(200);
    const slots = await request(app).get(`/api/v1/catalog/companies/${company.slug}/slots`).query({ serviceId: service._id.toString(), date });
    expect(slots.body.data.slots).toHaveLength(0);
  });

  it('rejects overlapping or inverted opening hours', async () => {
    const { client: vendor } = await createVendor(app, fakes);
    const weekly = Array.from({ length: 7 }, () => [{ start: '08:00', end: '12:00' }]);
    weekly[1] = [
      { start: '08:00', end: '12:00' },
      { start: '11:00', end: '14:00' },
    ];
    const res = await vendor.put('/api/v1/vendor/company/availability').send({ timezone: 'UTC', weekly, exceptions: [], slotIntervalMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 0, maxAdvanceDays: 30 });
    expect(res.status).toBe(400);
    const bad = await vendor.put('/api/v1/vendor/company/availability').send({ timezone: 'Mars/Olympus', weekly: Array.from({ length: 7 }, () => []), exceptions: [], slotIntervalMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 0, maxAdvanceDays: 30 });
    expect(bad.status).toBe(400);
  });
});

describe('user-facing date text', () => {
  it('writes MM/DD/YYYY in notifications and rejects impossible dates', async () => {
    const { company, service } = await createVendor(app, fakes);
    const customer = await loginCustomer(app, fakes, 'c@example.com');
    const [slot] = await firstSlots(app, company, service);
    await book(customer, { serviceId: service._id.toString(), startAt: slot.startAt });
    const note = await models.Notification.findOne({ audience: 'customer' }).lean();
    const [y, m, d] = slot.startAt.slice(0, 10).split('-');
    expect(note.body).toContain(`${m}/${d}/${y} at `); // company zone is UTC in fixtures
    expect(note.body).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const bad = await request(app).get(`/api/v1/catalog/companies/${company.slug}/slots`).query({ serviceId: service._id.toString(), date: '2027-02-30' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain('YYYY-MM-DD');
  });
});
