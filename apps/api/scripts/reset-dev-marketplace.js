// Clears the marketplace data of a DEVELOPMENT database so it can be rebuilt through the app:
// vendors, customers, categories, services, bookings, reviews, favorites, support threads,
// notifications and their uploaded images. Keeps every Super Admin (and their sessions and
// tokens), site settings (hero / promotional banner), the audit trail and rate-limit state.
//
//   npm run reset:dev -w @townant/api              # dry run: prints what would be removed
//   npm run reset:dev -w @townant/api -- --apply   # removes it
//
// Same safety rails as seed-dev.js (docs/DEV_SEED.md): ALLOW_DEV_SEED=true, never production, and
// on Atlas only the database `townant_dev_seed` with CONFIRM_ATLAS_DEV_SEED=townant_dev_seed. The
// connected database is re-checked before the first write. Back up first (mongodump).
// The connection string is never printed.
import mongoose from 'mongoose';
import { parseArgs } from 'node:util';
import { getEnv } from '../src/config/env.js';
import { disconnectDb } from '../src/db.js';
import * as M from '../src/models/index.js';
import { deleteImage } from '../src/services/media.js';
import { assertConnectedTarget, assertSafeSeedTarget } from './lib/devSeed.js';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let target;
try {
  target = assertSafeSeedTarget(process.env);
} catch (err) {
  fail(err.message);
}

try {
  await mongoose.connect(getEnv().MONGODB_URI, { serverSelectionTimeoutMS: 15000, autoIndex: false, autoCreate: false });
} catch (err) {
  fail(`Could not connect (${err.codeName ?? err.code ?? err.name}).`);
}

try {
  assertConnectedTarget({ databaseName: mongoose.connection.db.databaseName, host: mongoose.connection.host }, target);
  const admins = await M.User.find({ role: 'super_admin' }, { _id: 1, email: 1 }).lean();
  if (!admins.length) throw new Error('No Super Admin found — refusing to reset a database without one.');
  const adminIds = admins.map((a) => a._id);
  const notAdmin = { $nin: adminIds };

  // Uploaded images referenced by what is being removed (site settings are kept, so theirs stay).
  const companies = await M.Company.find({}, { media: 1 }).lean();
  const categories = await M.Category.find({}, { image: 1 }).lean();
  const images = [
    ...companies.flatMap((c) => [c.media?.logo, c.media?.banner, ...(c.media?.gallery ?? [])]),
    ...categories.map((c) => c.image),
  ]
    .map((m) => m?.publicId)
    .filter(Boolean);

  // Children before parents, so nothing is ever left pointing at a removed record.
  const steps = [
    ['slot claims', M.SlotClaim, {}],
    ['review reports', M.ReviewReport, {}],
    ['reviews', M.Review, {}],
    ['messages', M.Message, {}],
    ['conversations', M.Conversation, {}],
    ['bookings', M.Booking, {}],
    ['favorites', M.Favorite, {}],
    ['support messages', M.SupportMessage, {}],
    ['support tickets', M.SupportTicket, {}],
    ['notification deliveries', M.NotificationDelivery, { recipientId: notAdmin }],
    ['notifications', M.Notification, { recipientId: notAdmin }],
    ['analytics events', M.AnalyticsEvent, {}],
    ['device tokens', M.DeviceToken, { userId: notAdmin }],
    ['sessions', M.Session, { userId: notAdmin }],
    ['action tokens', M.ActionToken, { userId: notAdmin }],
    ['one-time codes', M.OtpChallenge, { $or: [{ userId: { $exists: false } }, { userId: null }, { userId: notAdmin }] }],
    ['services', M.Service, {}],
    ['memberships', M.Membership, {}],
    ['vendor applications', M.VendorApplication, {}],
    ['businesses', M.Company, {}],
    ['categories', M.Category, {}],
    ['users (vendors and customers)', M.User, { role: { $ne: 'super_admin' } }],
  ];

  console.log(`${values.apply ? 'Resetting' : 'Dry run for'} ${target.kind === 'atlas' ? 'Atlas' : 'local'} database "${target.dbName}"`);
  console.log(`Keeping Super Admin: ${admins.map((a) => a.email).join(', ')}; site settings; audit trail.`);
  for (const [label, Model, filter] of steps) {
    const n = await Model.countDocuments(filter);
    if (values.apply && n) await Model.deleteMany(filter);
    console.log(`  ${values.apply ? 'removed' : 'would remove'} ${String(n).padStart(4)} ${label}`);
  }
  if (values.apply) {
    let removed = 0;
    for (const publicId of images) {
      try {
        await deleteImage(publicId);
        removed += 1;
      } catch (err) {
        console.warn(`  could not delete image ${publicId}: ${err.message}`);
      }
    }
    console.log(`  removed ${String(removed).padStart(4)} uploaded images (of ${images.length})`);
    const left = await M.User.countDocuments({ role: 'super_admin' });
    console.log(`\nDone. Super Admins remaining: ${left}.`);
  } else {
    console.log(`  would remove ${String(images.length).padStart(4)} uploaded images\n\nNothing changed. Re-run with --apply to reset.`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
