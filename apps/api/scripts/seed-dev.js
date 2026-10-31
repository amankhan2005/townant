// Seeds a development database with a Super Admin, ten demo vendors and two pending vendor
// applications (see docs/DEV_SEED.md). Development only:
//   npm run seed:dev -w @townant/api [-- [--with-categories] [--reset-passwords]]
// Allowed targets: a local MongoDB, or the dedicated Atlas database `townant_dev_seed` with
// CONFIRM_ATLAS_DEV_SEED=townant_dev_seed. Always needs ALLOW_DEV_SEED=true; never in production.
// The connection string and passwords are never printed.
import mongoose from 'mongoose';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { disconnectDb } from '../src/db.js';
import { getEnv } from '../src/config/env.js';
import { seedCategories } from './lib/categories.js';
import { apiTargetNote, assertConnectedTarget, assertSafeSeedTarget, checkSeedCredentials, seedDevData } from './lib/devSeed.js';

const { values } = parseArgs({ options: { 'reset-passwords': { type: 'boolean', default: false }, 'with-categories': { type: 'boolean', default: false } } });

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

const credentials = {
  adminEmail: (process.env.DEV_SUPER_ADMIN_EMAIL || 'admin@townant.test').trim().toLowerCase(),
  adminPassword: process.env.DEV_SUPER_ADMIN_PASSWORD,
  vendorPassword: process.env.DEV_VENDOR_PASSWORD,
};
const problems = checkSeedCredentials(credentials);
if (problems.length) fail(`Set the development credentials in apps/api/.env.seed (or .env) first:\n  - ${problems.join('\n  - ')}`);

console.log(`Seeding ${target.kind === 'atlas' ? 'Atlas' : 'local'} database "${target.dbName}" (${target.label})…`);

// Connect with automatic index and collection creation off, so nothing is written until the
// connected database has been checked against the approved target.
try {
  await mongoose.connect(getEnv().MONGODB_URI, { serverSelectionTimeoutMS: 15000, autoIndex: false, autoCreate: false });
} catch (err) {
  // Driver messages can include host names; print only the error class and code.
  fail(`Could not connect to the ${target.label} database (${err.codeName ?? err.code ?? err.name}). Check MONGODB_URI, the Atlas network access list and the database user.`);
}

try {
  assertConnectedTarget({ databaseName: mongoose.connection.db.databaseName, host: mongoose.connection.host }, target);
  // Builds missing indexes (unique email/slug indexes keep reruns duplicate-free); never drops any.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  // Starter taxonomy for an empty database; existing categories are never changed.
  if (values['with-categories']) console.log(`Categories ready: ${await seedCategories()}`);
  const summary = await seedDevData({ ...credentials, resetPasswords: values['reset-passwords'] });
  console.log(`\nSuper Admin  ${summary.admin.email}  — ${summary.admin.outcome}`);
  console.log('\nDemo vendors (password: DEV_VENDOR_PASSWORD)');
  for (const v of summary.vendors) {
    console.log(v.error ? `  ✗ ${v.email}  ${v.business}: ${v.error}` : `  ${v.email}  ${v.business.padEnd(30)} ${v.status.padEnd(10)} business ${v.outcome}, account ${v.account}`);
  }
  console.log('\nPending vendor applications (Super Admin → Applications)');
  for (const a of summary.applications) console.log(a.error ? `  ✗ ${a.business}: ${a.error}` : `  ${a.business.padEnd(30)} ${a.status.padEnd(13)} ${a.outcome}`);
  const failed = [...summary.vendors, ...summary.applications].filter((r) => r.error).length;
  if (failed) process.exitCode = 1;
  // .env.seed may override MONGODB_URI for this command, so read the API's own .env directly.
  const apiEnvFile = new URL('../.env', import.meta.url);
  const note = apiTargetNote(existsSync(apiEnvFile) ? parseEnv(readFileSync(apiEnvFile, 'utf8')).MONGODB_URI : undefined, target);
  console.log(`\n${note.ok ? 'API database: ' : 'WARNING: '}${note.message}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
