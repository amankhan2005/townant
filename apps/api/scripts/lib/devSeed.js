// Development seed: a Super Admin, ten demo vendor accounts with businesses, and two pending
// vendor applications. Uses the real models, password hashing and password policy; never
// creates categories (it references the ones `seed:categories` or a Super Admin created).
//
// Safe to re-run: every record is found by a stable key (staff email, `demo-` slug, service
// title, application email) and only inserted when missing. Existing accounts keep their
// passwords unless `resetPasswords` is set, and records edited while testing are left as-is.
import { createHash } from 'node:crypto';
import { hashPassword } from '../../src/lib/crypto.js';
import { Category, Company, Membership, Service, User, VendorApplication } from '../../src/models/index.js';
import { password as passwordPolicy } from '../../src/routes/v1/staffAuth.js';
import { rebuildSearchText } from '../../src/services/catalog.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const ATLAS_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.mongodb\.net$/;

// The only Atlas database the seed will ever write to, and the value CONFIRM_ATLAS_DEV_SEED must
// repeat. A dedicated name keeps demo data out of any database the deployed API might use.
export const ATLAS_SEED_DB = 'townant_dev_seed';

const refuse = (reason) => new Error(`Refusing to seed: ${reason}`);

// Splits a MongoDB URI into scheme, host names and database name without echoing any part of it.
function parseMongoUri(raw) {
  const uri = String(raw ?? '').trim();
  const scheme = uri.startsWith('mongodb+srv://') ? 'mongodb+srv' : uri.startsWith('mongodb://') ? 'mongodb' : null;
  if (!scheme) throw refuse('MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string.');
  const rest = uri.slice(scheme.length + 3);
  const slash = rest.indexOf('/');
  const authority = slash === -1 ? rest.split('?')[0] : rest.slice(0, slash);
  const hostList = authority.slice(authority.lastIndexOf('@') + 1);
  const hosts = hostList
    .split(',')
    .map((h) => (h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]).toLowerCase())
    .filter(Boolean);
  if (!hosts.length || /\s/.test(hostList)) throw refuse('MONGODB_URI has no valid host.');
  let dbName;
  try {
    dbName = decodeURIComponent((slash === -1 ? '' : rest.slice(slash + 1)).split('?')[0]);
  } catch {
    throw refuse('MONGODB_URI has an invalid database name.');
  }
  return { scheme, hostList, hosts, dbName, hostKey: createHash('sha256').update([...hosts].sort().join(',')).digest('hex') };
}

// Runs before any connection is opened. Two targets are allowed, both only with
// ALLOW_DEV_SEED=true and never in production:
//   local — mongodb:// to localhost / 127.0.0.1 / ::1 (database name must not look like production)
//   Atlas — hosts under .mongodb.net, database exactly `townant_dev_seed`, and
//           CONFIRM_ATLAS_DEV_SEED=townant_dev_seed
// Everything else is refused. Returns a description of the target with no credentials or Atlas
// host names in it (`hostKey` is a hash, used only to compare targets).
export function assertSafeSeedTarget({ NODE_ENV, MONGODB_URI, ALLOW_DEV_SEED, CONFIRM_ATLAS_DEV_SEED } = {}) {
  if (NODE_ENV === 'production') throw refuse('NODE_ENV is "production".');
  if (ALLOW_DEV_SEED !== 'true') throw refuse('set ALLOW_DEV_SEED=true to confirm this is a development database.');
  const { scheme, hostList, hosts, dbName, hostKey } = parseMongoUri(MONGODB_URI);

  if (scheme === 'mongodb' && hosts.every((h) => LOCAL_HOSTS.has(h))) {
    const name = dbName || 'test';
    if (/prod|live/i.test(name)) throw refuse(`database name "${name}" looks like a production database.`);
    return { kind: 'local', label: hostList, dbName: name, hostKey };
  }

  if (hosts.every((h) => ATLAS_HOST.test(h)) && (scheme === 'mongodb' || hosts.length === 1)) {
    if (!dbName) throw refuse(`the Atlas URI names no database. Put /${ATLAS_SEED_DB} before the "?" in MONGODB_URI.`);
    if (dbName !== ATLAS_SEED_DB) throw refuse(`on Atlas the database must be exactly "${ATLAS_SEED_DB}" (the URI names "${dbName}").`);
    if (CONFIRM_ATLAS_DEV_SEED !== ATLAS_SEED_DB) throw refuse(`set CONFIRM_ATLAS_DEV_SEED=${ATLAS_SEED_DB} to confirm writing demo data to that Atlas database.`);
    return { kind: 'atlas', label: 'MongoDB Atlas', dbName, hostKey };
  }

  throw refuse('the database must be a local server (localhost / 127.0.0.1 / ::1) or MongoDB Atlas (*.mongodb.net).');
}

// Checked after connecting and before the first write: the driver must have opened the database
// and kind of host that assertSafeSeedTarget approved.
export function assertConnectedTarget({ databaseName, host }, target) {
  if (databaseName !== target.dbName) throw refuse(`connected to database "${databaseName}", expected "${target.dbName}".`);
  const h = String(host ?? '').toLowerCase();
  const ok = target.kind === 'atlas' ? ATLAS_HOST.test(h) : LOCAL_HOSTS.has(h);
  if (!ok) throw refuse(`the connected server is not the expected ${target.kind === 'atlas' ? 'Atlas' : 'local'} host.`);
}

// Sign-in only works when the API reads the database that was seeded. Compares the API's own
// MONGODB_URI (from apps/api/.env) with the seed target by database name and hashed host list.
export function apiTargetNote(apiUri, target) {
  const restart = 'then restart the API';
  if (!apiUri) return { ok: false, message: `apps/api/.env sets no MONGODB_URI. Point it at the "${target.dbName}" database, ${restart}.` };
  let api;
  try {
    api = parseMongoUri(apiUri);
  } catch {
    return { ok: false, message: `apps/api/.env has an invalid MONGODB_URI. Point it at the "${target.dbName}" database, ${restart}.` };
  }
  const local = target.kind === 'local';
  // Without a database in the path the driver falls back to "test".
  const apiDb = api.dbName || 'test';
  if (api.hostKey !== target.hostKey) return { ok: false, message: `apps/api/.env points the API at a different server than the one just seeded, so seeded accounts can't sign in. Use the same ${local ? 'server' : 'cluster'} and the "${target.dbName}" database, ${restart}.` };
  if (apiDb !== target.dbName) {
    const why = api.dbName ? `uses the database "${apiDb}"` : 'names no database, so MongoDB uses "test"';
    return { ok: false, message: `apps/api/.env's MONGODB_URI ${why}, not "${target.dbName}", so seeded accounts can't sign in. Put /${target.dbName} before the "?" in that URI, ${restart}.` };
  }
  return { ok: true, message: `apps/api/.env points the API at "${target.dbName}" too. A MONGODB_URI set in the shell when starting the API overrides .env; the API log line "database connected" shows the database it uses.` };
}

// Missing or weak passwords are reported by variable name; values are never echoed.
export function checkSeedCredentials({ adminEmail, adminPassword, vendorPassword }) {
  const problems = [];
  if (!adminEmail) problems.push('DEV_SUPER_ADMIN_EMAIL is empty');
  for (const [name, value] of [
    ['DEV_SUPER_ADMIN_PASSWORD', adminPassword],
    ['DEV_VENDOR_PASSWORD', vendorPassword],
  ]) {
    if (!value) problems.push(`${name} is not set`);
    else {
      const result = passwordPolicy.safeParse(value);
      if (!result.success) problems.push(`${name}: ${result.error.issues[0].message}`);
    }
  }
  return problems;
}

const WEEKDAYS_9_TO_5 = (sat) => [[], ...Array.from({ length: 5 }, () => [{ start: '09:00', end: '17:00' }]), sat ? [{ start: '10:00', end: '14:00' }] : []];
const point = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
const usd = (amount, display = 'fixed') => ({ display, amount, currency: 'USD' });
const QUOTE = { display: 'quote' };

// The ten demo vendors. `state` drives the business status:
//   published  — visible in search and on the homepage, bookable (public discovery + booking tests)
//   ready      — draft with everything needed to publish (vendor "Publish" flow)
//   incomplete — draft without opening hours (publish validation error)
//   suspended  — suspended by a Super Admin after being published (hidden; reinstatement tests)
export const DEMO_VENDORS = [
  {
    n: 1, slug: 'demo-northside-barber-co', name: 'Northside Barber Co.', state: 'published', category: ['beauty-salon', 'barber'],
    address: { line1: '120 Main Street', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' }, location: point(-97.7431, 30.2672), timezone: 'America/Chicago',
    services: [['Classic haircut', 30, usd(35)], ['Beard trim', 20, usd(20)], ['Haircut and beard trim', 45, usd(50)]],
  },
  {
    n: 2, slug: 'demo-lakeview-massage-studio', name: 'Lakeview Massage Studio', state: 'published', category: ['health-wellness', 'massage'],
    address: { line1: '45 Lake Street', city: 'Chicago', region: 'IL', postalCode: '60601', country: 'US' }, location: point(-87.6298, 41.8781), timezone: 'America/Chicago',
    services: [['Swedish massage', 60, usd(90, 'from')], ['Deep tissue massage', 90, usd(130, 'from'), 'request']],
  },
  {
    n: 3, slug: 'demo-brightside-home-cleaning', name: 'Brightside Home Cleaning', state: 'published', category: ['cleaning', 'house-cleaning'],
    address: { line1: '300 Market Street', city: 'Denver', region: 'CO', postalCode: '80202', country: 'US' }, location: point(-104.9903, 39.7392), timezone: 'America/Denver',
    serviceMode: 'mobile', serviceArea: { radiusKm: 20, postalCodes: ['80202', '80203', '80204', '80205'] },
    services: [['Standard home cleaning', 120, usd(120, 'from')], ['Move-out deep clean', 240, QUOTE, 'request']],
  },
  {
    n: 4, slug: 'demo-harbor-plumbing-drain', name: 'Harbor Plumbing & Drain', state: 'published', category: ['repairs-maintenance', 'plumbing'],
    address: { line1: '88 Harbor Avenue', city: 'Seattle', region: 'WA', postalCode: '98101', country: 'US' }, location: point(-122.3321, 47.6062), timezone: 'America/Los_Angeles',
    serviceMode: 'both', serviceArea: { radiusKm: 25, postalCodes: ['98101', '98102', '98104'] },
    services: [['Leak inspection', 60, usd(95)], ['Drain unclogging', 90, QUOTE, 'request']],
  },
  {
    n: 5, slug: 'demo-shine-auto-detailing', name: 'Shine Auto Detailing', state: 'published', category: ['automotive', 'car-detailing'],
    address: { line1: '1500 Camelback Road', city: 'Phoenix', region: 'AZ', postalCode: '85016', country: 'US' }, location: point(-112.074, 33.4484), timezone: 'America/Phoenix',
    services: [['Exterior hand wash', 45, usd(40)], ['Full interior and exterior detail', 180, usd(180, 'from')]],
  },
  {
    n: 6, slug: 'demo-paws-and-suds-grooming', name: 'Paws & Suds Grooming', state: 'published', category: ['pet-care', 'pet-grooming'],
    address: { line1: '72 Hawthorne Boulevard', city: 'Portland', region: 'OR', postalCode: '97214', country: 'US' }, location: point(-122.6765, 45.5231), timezone: 'America/Los_Angeles',
    services: [['Bath and brush', 60, usd(55, 'from')], ['Full groom', 120, usd(85, 'from')]],
  },
  {
    n: 7, slug: 'demo-summit-personal-training', name: 'Summit Personal Training', state: 'published', category: ['fitness', 'personal-training'],
    address: { line1: '200 King Street West', city: 'Toronto', region: 'ON', postalCode: 'M5H 3T4', country: 'CA' }, location: point(-79.3832, 43.6532), timezone: 'America/Toronto',
    services: [['Intro training session', 45, { display: 'fixed', amount: 50, currency: 'CAD' }], ['One-to-one training', 60, { display: 'fixed', amount: 85, currency: 'CAD' }]],
  },
  {
    n: 8, slug: 'demo-keynote-music-lessons', name: 'Keynote Music Lessons', state: 'ready', category: ['lessons-tutoring', 'music-lessons'],
    address: { line1: '10 Camden High Street', city: 'London', region: 'Greater London', postalCode: 'NW1 0JH', country: 'GB' }, location: point(-0.1426, 51.5362), timezone: 'Europe/London',
    services: [['Piano lesson', 45, { display: 'fixed', amount: 40, currency: 'GBP' }], ['Guitar lesson', 45, { display: 'fixed', amount: 38, currency: 'GBP' }]],
  },
  {
    n: 9, slug: 'demo-greenleaf-landscaping', name: 'Greenleaf Landscaping', state: 'incomplete', category: ['home-services', 'landscaping'],
    address: { line1: '415 Peachtree Street', city: 'Atlanta', region: 'GA', postalCode: '30308', country: 'US' }, location: point(-84.388, 33.749), timezone: 'America/New_York',
    serviceMode: 'mobile', serviceArea: { radiusKm: 30, postalCodes: ['30308', '30309'] },
    services: [['Lawn mowing and edging', 60, usd(60, 'from')]],
  },
  {
    n: 10, slug: 'demo-frame-and-focus-photography', name: 'Frame & Focus Photography', state: 'suspended', category: ['events', 'photography'],
    address: { line1: '900 Biscayne Boulevard', city: 'Miami', region: 'FL', postalCode: '33132', country: 'US' }, location: point(-80.1918, 25.7617), timezone: 'America/New_York',
    services: [['Portrait session', 60, usd(150, 'from')], ['Event coverage consultation', 30, QUOTE, 'request']],
  },
];

// Applications waiting for a Super Admin decision (no account exists until one is approved).
export const DEMO_APPLICATIONS = [
  { businessName: 'Corner Nail Bar', contactName: 'Demo Applicant A', email: 'applicant01@townant.test', status: 'submitted', category: ['beauty-salon', 'nails'], address: { line1: '18 Elm Street', city: 'Boston', region: 'MA', postalCode: '02108', country: 'US' } },
  { businessName: 'Steady Hands Handyman', contactName: 'Demo Applicant B', email: 'applicant02@townant.test', status: 'under_review', category: ['home-services', 'handyman'], address: { line1: '64 Oak Avenue', city: 'Nashville', region: 'TN', postalCode: '37203', country: 'US' }, serviceMode: 'mobile' },
];

export const vendorEmail = (n) => `vendor${String(n).padStart(2, '0')}@townant.test`;

const DEMO_NOTE = 'Demo listing (development test data — not a real business).';

// Creates the account if missing. An existing account keeps its password and status unless
// `reset` is set (then the password is replaced and an unfinished invite is activated).
async function ensureStaffUser({ email, role, displayName, passwordHash, reset }) {
  const existing = await User.findOne({ accountType: 'staff', email });
  if (!existing) {
    const user = await User.create({ accountType: 'staff', role, status: 'active', email, displayName, emailVerifiedAt: new Date(), passwordHash, passwordChangedAt: new Date() });
    return { user, outcome: 'created' };
  }
  if (existing.role !== role) throw new Error(`${email} already belongs to a ${existing.role} account; it was not changed.`);
  if (!reset) return { user: existing, outcome: 'existing (password unchanged)' };
  await User.updateOne({ _id: existing._id }, { $set: { passwordHash, passwordChangedAt: new Date(), ...(existing.status === 'invited' ? { status: 'active', emailVerifiedAt: new Date() } : {}) } });
  return { user: existing, outcome: 'existing (password reset)' };
}

async function categoryPair([parentSlug, childSlug]) {
  const parent = await Category.findOne({ slug: parentSlug, parentId: null });
  if (!parent) return null;
  const child = await Category.findOne({ slug: childSlug, parentId: parent._id });
  return { parent, child };
}

const companyStatus = (state) => (state === 'published' ? 'published' : state === 'suspended' ? 'suspended' : 'draft');

async function ensureCompany(spec, owner, admin) {
  const existing = await Company.findOne({ slug: spec.slug });
  if (existing) {
    const ownedBySeed = await Membership.exists({ companyId: existing._id, userId: owner._id, role: 'owner' });
    if (!ownedBySeed) throw new Error(`A business with slug "${spec.slug}" already exists with another owner; it was not changed.`);
    return { company: existing, outcome: 'existing' };
  }
  const cats = await categoryPair(spec.category);
  if (!cats) throw new Error(`Category "${spec.category[0]}" does not exist. Run \`npm run seed:categories -w @townant/api\` first.`);
  const now = new Date();
  const status = companyStatus(spec.state);
  const company = await Company.create({
    name: spec.name,
    slug: spec.slug,
    status,
    publishedAt: status === 'draft' ? undefined : now,
    ...(status === 'suspended' ? { statusBeforeSuspension: 'published', suspendedAt: now, suspensionReason: 'Demo: suspended to test reinstatement.' } : {}),
    primaryCategoryId: cats.parent._id,
    categoryIds: [cats.parent._id, cats.child?._id].filter(Boolean),
    summary: `${DEMO_NOTE} ${spec.name} in ${spec.address.city}.`,
    description: `${DEMO_NOTE}\n\nUse this business to test discovery, availability and booking in local development.`,
    contact: { email: owner.email },
    address: spec.address,
    location: spec.location,
    serviceMode: spec.serviceMode ?? 'fixed',
    serviceArea: spec.serviceArea,
    availability: { timezone: spec.timezone, weekly: spec.state === 'incomplete' ? [[], [], [], [], [], [], []] : WEEKDAYS_9_TO_5(spec.n % 2 === 1), exceptions: [] },
    createdBy: admin._id,
  });
  await Membership.updateOne({ userId: owner._id, companyId: company._id }, { $setOnInsert: { role: 'owner', status: 'active' } }, { upsert: true });
  let order = 0;
  for (const [title, durationMinutes, price, bookingMode = 'instant'] of spec.services) {
    await Service.updateOne(
      { companyId: company._id, title },
      { $setOnInsert: { durationMinutes, bookingMode, price, categoryId: (cats.child ?? cats.parent)._id, description: `${title} (demo service).`, sortOrder: (order += 10) } },
      { upsert: true },
    );
  }
  await rebuildSearchText(company._id);
  return { company, outcome: 'created' };
}

async function ensureApplication(spec) {
  const existing = await VendorApplication.findOne({ email: spec.email, businessName: spec.businessName });
  if (existing) return { application: existing, outcome: 'existing' };
  const cats = await categoryPair(spec.category);
  if (!cats) throw new Error(`Category "${spec.category[0]}" does not exist. Run \`npm run seed:categories -w @townant/api\` first.`);
  const application = await VendorApplication.create({
    status: spec.status,
    businessName: spec.businessName,
    contactName: spec.contactName,
    email: spec.email,
    categoryIds: [cats.parent._id, cats.child?._id].filter(Boolean),
    description: `${DEMO_NOTE} Pending application for testing the Super Admin review workflow.`,
    address: spec.address,
    serviceMode: spec.serviceMode ?? 'fixed',
  });
  return { application, outcome: 'created' };
}

// Seeds everything; returns a summary with no secrets in it.
export async function seedDevData({ adminEmail, adminPassword, vendorPassword, resetPasswords = false }) {
  const [adminHash, vendorHash] = await Promise.all([hashPassword(adminPassword), hashPassword(vendorPassword)]);
  const admin = await ensureStaffUser({ email: adminEmail, role: 'super_admin', displayName: 'Dev Super Admin', passwordHash: adminHash, reset: resetPasswords });

  const vendors = [];
  for (const spec of DEMO_VENDORS) {
    const email = vendorEmail(spec.n);
    try {
      const owner = await ensureStaffUser({ email, role: 'vendor', displayName: `Demo Vendor ${String(spec.n).padStart(2, '0')}`, passwordHash: vendorHash, reset: resetPasswords });
      const { company, outcome } = await ensureCompany(spec, owner.user, admin.user);
      vendors.push({ email, account: owner.outcome, business: spec.name, slug: company.slug, status: company.status, state: spec.state, outcome });
    } catch (err) {
      vendors.push({ email, business: spec.name, error: err.message });
    }
  }

  const applications = [];
  for (const spec of DEMO_APPLICATIONS) {
    try {
      const { application, outcome } = await ensureApplication(spec);
      applications.push({ email: spec.email, business: spec.businessName, status: application.status, outcome });
    } catch (err) {
      applications.push({ email: spec.email, business: spec.businessName, error: err.message });
    }
  }

  return { admin: { email: adminEmail, outcome: admin.outcome }, vendors, applications };
}
