import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createVendor, firstSlots, lastCode, loginCustomer, resetDb, startTestServer, stopTestServer } from './helpers.js';

let app;
let fakes;
let models;

beforeAll(async () => {
  ({ app, fakes } = await startTestServer());
  models = await import('../src/models/index.js');
});
afterAll(stopTestServer);
beforeEach(resetDb);

async function requestCode(client) {
  const res = await client.post('/api/v1/me/deletion/challenge').send({});
  expect(res.status).toBe(201);
  return { challengeId: res.body.data.challengeId, code: lastCode(fakes), channel: res.body.data.channel };
}

describe('customer account deletion', () => {
  it('requires a signed-in customer, a fresh code and explicit confirmation', async () => {
    expect((await request(app).get('/api/v1/me/deletion')).status).toBe(401);
    expect((await request(app).post('/api/v1/me/deletion').send({})).status).toBe(401);
    const v = await createVendor(app, fakes);
    expect((await v.client.post('/api/v1/me/deletion/challenge').send({})).status).toBe(403);

    const alice = await loginCustomer(app, fakes, 'alice@example.com');
    const summary = await alice.get('/api/v1/me/deletion');
    expect(summary.body.data.channels).toEqual(['email']);
    expect(summary.body.data.policy.retained.length).toBeGreaterThan(0);

    const { challengeId, code } = await requestCode(alice);
    // The code goes to the address on the account, never one supplied by the client.
    expect(fakes.sent.email.at(-1).to).toBe('alice@example.com');
    expect((await alice.post('/api/v1/me/deletion/challenge').send({ email: 'evil@example.com' })).status).toBe(400);
    // Missing confirmation or a wrong code changes nothing.
    expect((await alice.post('/api/v1/me/deletion').send({ channel: 'email', challengeId, code })).status).toBe(400);
    expect((await alice.post('/api/v1/me/deletion').send({ channel: 'email', challengeId, code: code === '000000' ? '111111' : '000000', confirm: 'DELETE' })).status).toBe(400);
    expect((await models.User.findById(alice.user.id)).status).toBe('active');

    // Another customer's code can't delete this account.
    const bob = await loginCustomer(app, fakes, 'bob@example.com');
    const bobCode = await requestCode(bob);
    expect((await alice.post('/api/v1/me/deletion').send({ channel: 'email', challengeId: bobCode.challengeId, code: bobCode.code, confirm: 'DELETE' })).status).toBe(400);
    expect((await models.User.findById(alice.user.id)).status).toBe('active');
  });

  it('starts a 15-day recovery window: signs out everywhere, hides reviews, cancels upcoming bookings, keeps the identity', async () => {
    const { company, service } = await createVendor(app, fakes, { durationMinutes: 30 });
    const alice = await loginCustomer(app, fakes, 'alice@example.com', { displayName: 'Alice Doe' });
    const otherDevice = await loginCustomer(app, fakes, 'alice@example.com');
    const [slot] = await firstSlots(app, company, service);
    const upcoming = await alice.post('/api/v1/bookings').send({ serviceId: service._id.toString(), startAt: slot.startAt });
    expect(upcoming.status).toBe(201);
    const past = await pastBooking(alice.user.id, company, service);
    await models.Review.create({ companyId: company._id, customerId: alice.user.id, bookingId: past._id, rating: 5, text: 'Great', authorName: 'Alice', status: 'published' });
    await models.Company.updateOne({ _id: company._id }, { $set: { ratingAvg: 5, ratingCount: 1 } });
    await alice.put(`/api/v1/favorites/${company._id}`);

    const { challengeId, code } = await requestCode(alice);
    const res = await alice.post('/api/v1/me/deletion').send({ channel: 'email', challengeId, code, confirm: 'DELETE' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ deleted: true, pendingDeletion: true, cancelledBookings: 1, reviewsHidden: 1 });
    const days = (new Date(res.body.data.recoverUntil) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(14.9);
    expect(days).toBeLessThanOrEqual(15);

    expect((await alice.get('/api/v1/me')).status).toBe(401);
    expect((await otherDevice.get('/api/v1/me')).status).toBe(401);
    const user = await models.User.findById(alice.user.id).lean();
    expect(user).toMatchObject({ status: 'pending_deletion', email: 'alice@example.com', displayName: 'Alice Doe' });
    // Restorable data is kept; the review is hidden publicly and left out of the rating.
    expect(await models.Favorite.countDocuments({ userId: alice.user.id })).toBe(1);
    expect((await request(app).get(`/api/v1/catalog/companies/${company.slug}/reviews`)).body.data).toHaveLength(0);
    expect((await models.Company.findById(company._id).lean()).ratingCount).toBe(0);
    const cancelled = await models.Booking.findById(upcoming.body.data.id).lean();
    expect(cancelled.history.at(-1).action).toBe('cancel_account_deleted');
    expect(await models.SlotClaim.countDocuments({ bookingId: cancelled._id })).toBe(0);
    expect(await models.AuditEvent.countDocuments({ action: 'user.deletion_requested', entityId: alice.user.id })).toBe(1);
  });

  it('restores only after a correct sign-in code and an explicit confirmation, exactly once', async () => {
    const { company, service } = await createVendor(app, fakes);
    const alice = await loginCustomer(app, fakes, 'alice@example.com', { displayName: 'Alice Doe' });
    const past = await pastBooking(alice.user.id, company, service);
    await models.Review.create({ companyId: company._id, customerId: alice.user.id, bookingId: past._id, rating: 4, text: 'Good', authorName: 'Alice', status: 'published' });
    await deleteAccount(alice);

    // A wrong code never reveals or restores anything.
    const r1 = await request(app).post('/api/v1/auth/otp/request').send({ channel: 'email', email: 'alice@example.com' });
    const code = lastCode(fakes);
    const wrong = await request(app).post('/api/v1/auth/otp/verify').send({ channel: 'email', email: 'alice@example.com', challengeId: r1.body.data.challengeId, code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('OTP_INVALID');
    expect(wrong.body.error.details).toBeUndefined();

    // The right code explains the pending deletion but restores nothing yet.
    const ok = await request(app).post('/api/v1/auth/otp/verify').send({ channel: 'email', email: 'alice@example.com', challengeId: r1.body.data.challengeId, code });
    expect(ok.status).toBe(409);
    expect(ok.body.error.code).toBe('ACCOUNT_PENDING_DELETION');
    expect(ok.headers['set-cookie']).toBeUndefined();
    const { restoreToken, recoverUntil } = ok.body.error.details;
    expect(new Date(recoverUntil) > new Date()).toBe(true);
    expect((await models.User.findById(alice.user.id)).status).toBe('pending_deletion');

    // Confirmation is required, and a made-up token is useless.
    expect((await request(app).post('/api/v1/auth/account/restore').send({ restoreToken })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/account/restore').send({ restoreToken: 'x'.repeat(43), confirm: 'RESTORE' })).status).toBe(400);

    // Concurrent confirmations with the same token: exactly one restore, no duplicate account.
    const results = await Promise.all([1, 2, 3].map(() => request(app).post('/api/v1/auth/account/restore').send({ restoreToken, confirm: 'RESTORE', transport: 'bearer' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const restored = results.find((r) => r.status === 200).body.data;
    expect(restored).toMatchObject({ restored: true, user: { id: alice.user.id, status: 'active', displayName: 'Alice Doe' } });
    expect(await models.User.countDocuments({ accountType: 'customer', email: 'alice@example.com' })).toBe(1);
    expect((await request(app).get('/api/v1/me').set('Authorization', `Bearer ${restored.token}`)).status).toBe(200);
    // Reviews are visible again and count towards the rating.
    expect((await request(app).get(`/api/v1/catalog/companies/${company.slug}/reviews`)).body.data).toHaveLength(1);
    expect((await models.Company.findById(company._id).lean()).ratingCount).toBe(1);
    expect(await models.AuditEvent.countDocuments({ action: 'user.restore' })).toBe(1);
    // The token is single-use.
    expect((await request(app).post('/api/v1/auth/account/restore').send({ restoreToken, confirm: 'RESTORE' })).status).toBe(400);
  });

  it('never restores through a password, and a password reset cannot bypass the deletion', async () => {
    const alice = await loginCustomer(app, fakes, 'alice@example.com');
    const ch = (await alice.post('/api/v1/me/password/challenge').send({})).body.data;
    expect((await alice.put('/api/v1/me/password').send({ newPassword: 'a long garden path 42', confirmPassword: 'a long garden path 42', channel: 'email', challengeId: ch.challengeId, code: lastCode(fakes) })).status).toBe(200);
    await models.OtpChallenge.deleteMany({});
    await deleteAccount(alice);

    const pw = await request(app).post('/api/v1/auth/password/login').send({ channel: 'email', email: 'alice@example.com', password: 'a long garden path 42' });
    expect(pw.status).toBe(409);
    expect(pw.body.error.code).toBe('RESTORE_REQUIRES_CODE');
    expect(pw.headers['set-cookie']).toBeUndefined();
    const sent = fakes.sent.email.length;
    const forgot = await request(app).post('/api/v1/auth/password/forgot').send({ channel: 'email', email: 'alice@example.com' });
    expect(forgot.status).toBe(201);
    // Same response shape as for any address, but nothing is sent to a pending-deletion account.
    expect(fakes.sent.email.length).toBe(sent);
    expect((await request(app).post('/api/v1/auth/password/reset').send({ channel: 'email', email: 'alice@example.com', challengeId: forgot.body.data.challengeId, code: '123456', password: 'another long phrase 7' })).status).toBe(400);
    expect((await models.User.findById(alice.user.id)).status).toBe('pending_deletion');
  });

  it('after 15 days restoration is refused and the deletion is finalized without touching unrelated records', async () => {
    const { company, service, client: vendor } = await createVendor(app, fakes, { durationMinutes: 30 });
    const alice = await loginCustomer(app, fakes, 'alice@example.com', { displayName: 'Alice Doe' });
    const bob = await loginCustomer(app, fakes, 'bob@example.com', { displayName: 'Bob' });
    const past = await pastBooking(alice.user.id, company, service);
    const bobPast = await pastBooking(bob.user.id, company, service, 'TA-BOB1');
    await models.Review.create({ companyId: company._id, customerId: alice.user.id, bookingId: past._id, rating: 5, text: 'Great', authorName: 'Alice', status: 'published' });
    await models.Review.create({ companyId: company._id, customerId: bob.user.id, bookingId: bobPast._id, rating: 3, text: 'Fine', authorName: 'Bob', status: 'published' });
    await alice.put(`/api/v1/favorites/${company._id}`);
    await bob.put(`/api/v1/favorites/${company._id}`);
    await alice.post('/api/v1/conversations').send({ companyId: company._id.toString(), subject: 'Parking?', body: 'Is there parking nearby?' });
    await alice.post('/api/v1/support/tickets').send({ category: 'account', subject: 'Question about my data', body: 'What do you store about me?' });
    await deleteAccount(alice);

    // A restore token issued just before the deadline can't be used after it.
    const r1 = await request(app).post('/api/v1/auth/otp/request').send({ channel: 'email', email: 'alice@example.com' });
    const pending = await request(app).post('/api/v1/auth/otp/verify').send({ channel: 'email', email: 'alice@example.com', challengeId: r1.body.data.challengeId, code: lastCode(fakes) });
    await models.User.updateOne({ _id: alice.user.id }, { $set: { deletionScheduledFor: new Date(Date.now() - 1000) } });
    const late = await request(app).post('/api/v1/auth/account/restore').send({ restoreToken: pending.body.error.details.restoreToken, confirm: 'RESTORE' });
    expect(late.status).toBe(410);

    const { finalizeDueCustomerDeletions } = await import('../src/services/accountDeletion.js');
    expect(await finalizeDueCustomerDeletions()).toBe(1);
    // Running again (or on a second worker) does nothing more.
    expect(await finalizeDueCustomerDeletions()).toBe(0);

    const user = await models.User.findById(alice.user.id).lean();
    expect(user.status).toBe('deleted');
    for (const field of ['email', 'displayName', 'phone', 'passwordHash']) expect(user).not.toHaveProperty(field);
    expect(await models.Favorite.countDocuments({ userId: alice.user.id })).toBe(0);
    expect(await models.Review.countDocuments({ customerId: alice.user.id })).toBe(0);
    expect((await models.Conversation.findOne({ customerId: alice.user.id }).lean()).status).toBe('closed');
    const ticket = await models.SupportTicket.findOne({ requesterId: alice.user.id }).lean();
    expect(ticket.status).toBe('closed');
    expect(ticket.requesterDeletedAt).toBeTruthy();
    expect(await models.AuditEvent.countDocuments({ action: 'user.self_delete' })).toBe(1);
    expect(JSON.stringify(await models.AuditEvent.findOne({ action: 'user.self_delete' }).lean())).not.toMatch(/alice/i);

    // Unrelated and historical records are untouched.
    expect(await models.Booking.countDocuments({ _id: past._id })).toBe(1);
    const vendorView = (await vendor.get('/api/v1/vendor/bookings?view=all')).body.data.find((b) => b.reference === 'TA-PAST1');
    expect(vendorView.customer).toMatchObject({ name: 'Deleted customer', email: null, phone: null });
    expect((await models.User.findById(bob.user.id).lean()).status).toBe('active');
    expect(await models.Favorite.countDocuments({ userId: bob.user.id })).toBe(1);
    expect(await models.Review.countDocuments({ customerId: bob.user.id })).toBe(1);
    expect((await models.Company.findById(company._id).lean()).ratingCount).toBe(1);

    // The address can start a fresh, separate account.
    await models.OtpChallenge.deleteMany({});
    const again = await loginCustomer(app, fakes, 'alice@example.com');
    expect(again.user.id).not.toBe(alice.user.id);
    expect((await again.get('/api/v1/favorites')).body.data).toEqual([]);
  });

  it('a sign-in after the deadline but before the job ran finalizes the old account and starts a new one', async () => {
    const alice = await loginCustomer(app, fakes, 'alice@example.com', { displayName: 'Alice Doe' });
    await deleteAccount(alice);
    await models.User.updateOne({ _id: alice.user.id }, { $set: { deletionScheduledFor: new Date(Date.now() - 1000) } });
    const r1 = await request(app).post('/api/v1/auth/otp/request').send({ channel: 'email', email: 'alice@example.com' });
    const res = await request(app).post('/api/v1/auth/otp/verify').send({ channel: 'email', email: 'alice@example.com', challengeId: r1.body.data.challengeId, code: lastCode(fakes), transport: 'bearer' });
    expect(res.status).toBe(200);
    expect(res.body.data.previousAccountDeleted).toBe(true);
    expect(res.body.data.user.id).not.toBe(alice.user.id);
    expect((await models.User.findById(alice.user.id).lean()).status).toBe('deleted');
  });
});

async function deleteAccount(client) {
  const { challengeId, code } = await requestCode(client);
  const res = await client.post('/api/v1/me/deletion').send({ channel: 'email', challengeId, code, confirm: 'DELETE' });
  expect(res.status).toBe(200);
  await models.OtpChallenge.deleteMany({});
  await models.RateLimitBucket.deleteMany({});
}

function pastBooking(customerId, company, service, reference = 'TA-PAST1') {
  const start = Date.now() - 7 * 86400000;
  return models.Booking.create({
    reference,
    customerId,
    companyId: company._id,
    serviceId: service._id,
    serviceSnapshot: { title: 'Standard clean', durationMinutes: 30, bookingMode: 'instant' },
    resourceKey: `company:${company._id}`,
    startAt: new Date(start),
    endAt: new Date(start + 1800000),
    blockEndAt: new Date(start + 1800000),
    timezone: 'UTC',
    status: 'completed',
  });
}
