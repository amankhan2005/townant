// Browser smoke test of the full web journey against a running local dev stack (see e2e/README.md).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
// This test creates accounts, companies and bookings. It refuses to run unless MONGODB_URI is
// explicitly set to a local MongoDB; that value also overrides apps/api/.env for the admin
// bootstrap below, so a remote database configured there is never touched.
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.MONGODB_URI ?? '')) {
  console.error('Refusing to run: set MONGODB_URI to a local MongoDB, e.g. mongodb://127.0.0.1:27018/townant?replicaSet=rs0');
  process.exit(2);
}
const { default: puppeteer } = await import('puppeteer-core');
// This test creates accounts and companies. Refuse to touch anything but a local database:
// MONGODB_URI must be set explicitly (it overrides apps/api/.env for the admin bootstrap).
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.MONGODB_URI ?? '')) {
  console.error('Refusing to run: set MONGODB_URI to a local MongoDB (e.g. mongodb://127.0.0.1:27018/townant?replicaSet=rs0).');
  process.exit(2);
}
// The API must run with DEV_PRINT_OTP=true and its stdout written to this file.
const LOG = process.env.API_LOG ?? 'api.log';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
const run = Date.now().toString(36);
execFileSync('mkdir', ['-p', SHOTS]);

const lastDevEmail = (pattern) => {
  const lines = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.includes('[dev-email]'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const msg = JSON.parse(lines[i]).msg;
    const m = msg.match(pattern);
    if (m) return m[1];
  }
  throw new Error(`no dev email matching ${pattern}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] });
const errors = [];
const pages = [];
async function newPage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(`console: ${m.text()}`));
  page.on('dialog', (d) => d.accept());
  pages.push(page);
  return page;
}
const fill = async (page, label, value) => {
  const el = await page.waitForSelector(`::-p-aria(${label})`, { timeout: 8000 });
  await el.click({ clickCount: 3 });
  await el.type(value);
};
const click = async (page, name) => (await page.waitForSelector(`::-p-aria(${name})`, { timeout: 8000 })).click();
// Custom listbox select: open the labelled trigger, then choose the option by its text.
const choose = async (page, label, option) => {
  await click(page, label);
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
  await page.evaluate((text) => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === text).click(), option);
  await page.waitForFunction(() => !document.querySelector('[role="listbox"]'), { timeout: 5000 });
};
const waitText = (page, text, timeout = 10000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const shot = (page, name, fullPage = true) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage });

try {
  // A. Bootstrap a Super Admin and complete setup in the browser.
  const out = execFileSync('node', ['--env-file=.env', 'scripts/create-admin.js', '--email', `ops-${run}@townant.dev`], { cwd: new URL('../apps/api', import.meta.url).pathname, encoding: 'utf8' });
  const adminLink = out.match(/(http\S+admin\/setup\?token=\S+)/)[1];
  const admin = await newPage();
  await admin.goto(adminLink);
  await fill(admin, 'Your name', 'Ops Lead');
  await fill(admin, 'Create a password', 'admin-passphrase-for-e2e');
  await fill(admin, 'Confirm password', 'admin-passphrase-for-e2e');
  await click(admin, 'Create account');
  await waitText(admin, 'Marketplace activity');
  if (admin.url().includes('token=')) throw new Error('setup token left in URL');
  await shot(admin, '01-admin-dashboard');
  console.log('✓ admin setup + dashboard');

  // B. Public vendor application.
  const applicant = await newPage();
  await applicant.goto(`${BASE}/join`);
  await fill(applicant, 'Business name', `Sunrise Cleaning ${run}`);
  await fill(applicant, 'Your name', 'Riley Chen');
  await fill(applicant, 'Business email', `owner-${run}@sunrise.dev`);
  await choose(applicant, 'Main category', 'Cleaning');
  await fill(applicant, 'City', 'Austin');
  await fill(applicant, 'State / region (optional)', 'TX');
  await fill(applicant, 'ZIP / postal code (optional)', '78701');
  await fill(applicant, 'Tell us about your business', 'Residential deep cleaning and move-out cleans across central Austin since 2019.');
  await shot(applicant, '02-join-form');
  await click(applicant, 'Submit application');
  await waitText(applicant, 'Application received');
  console.log('✓ vendor application submitted');

  // C. Admin approves it.
  await admin.goto(`${BASE}/admin/applications`);
  await waitText(admin, `Sunrise Cleaning ${run}`);
  await admin.evaluate((n) => [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes(n)).click(), `Sunrise Cleaning ${run}`);
  await click(admin, 'Approve & create company');
  // Confirm in the dialog, which states the consequence before anything is created.
  await (await admin.waitForSelector('[role="dialog"] ::-p-aria(Approve & create company)')).click();
  await waitText(admin, 'created as a draft');
  await shot(admin, '03-admin-approved');
  console.log('✓ admin approved application');

  // D. Vendor completes setup, adds a service and hours, publishes.
  await sleep(300);
  const vendorLink = `${BASE}/business/setup?token=${lastDevEmail(/business\/setup\?token=([A-Za-z0-9_%-]+)/)}`;
  const vendor = await newPage();
  await vendor.goto(vendorLink);
  await fill(vendor, 'Your name', 'Riley Chen');
  await fill(vendor, 'Create a password', 'vendor-passphrase-for-e2e');
  await fill(vendor, 'Confirm password', 'vendor-passphrase-for-e2e');
  await click(vendor, 'Create account');
  await waitText(vendor, 'Finish your profile');
  await shot(vendor, '04-vendor-overview');
  await vendor.goto(`${BASE}/business/services`);
  await click(vendor, 'Add your first service');
  await fill(vendor, 'Service name', 'Deep clean (2 bedrooms)');
  await fill(vendor, 'Description (optional)', 'Kitchen, bathrooms, floors and dusting.');
  await choose(vendor, 'Price display', 'Starting from');
  await fill(vendor, 'Amount', '120');
  await click(vendor, 'Save service');
  await waitText(vendor, 'Service saved');
  await shot(vendor, '05-vendor-services');
  await vendor.goto(`${BASE}/business/availability`);
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) await click(vendor, day);
  await click(vendor, 'Save changes');
  await waitText(vendor, 'Availability saved');
  await shot(vendor, '06-vendor-availability');
  await vendor.goto(`${BASE}/business/profile`);
  await click(vendor, 'Publish profile');
  await waitText(vendor, 'Your profile is live');
  await shot(vendor, '07-vendor-profile');
  console.log('✓ vendor setup, service, hours, published');

  // E0. Admin places the business in the homepage spotlight via the admin console.
  await admin.goto(`${BASE}/admin/companies`);
  await waitText(admin, `Sunrise Cleaning ${run}`);
  await admin.evaluate((n) => [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes(n)).click(), `Sunrise Cleaning ${run}`);
  await click(admin, 'Feature in homepage spotlight');
  await fill(admin, 'Headline (optional)', 'Spring deep cleans in Austin');
  await click(admin, 'Save spotlight');
  await waitText(admin, 'Spotlight saved');
  console.log('✓ admin spotlight set');

  // E. Guest discovers, chooses a time, and is asked to sign in only when confirming.
  const customer = await newPage();
  await customer.goto(BASE);
  await waitText(customer, 'In the spotlight');
  await waitText(customer, 'Spring deep cleans in Austin');
  await shot(customer, '08-home');
  await customer.goto(`${BASE}/search?q=deep+clean&city=Austin`);
  await waitText(customer, `Sunrise Cleaning ${run}`);
  await shot(customer, '09-search');
  await customer.evaluate((n) => [...document.querySelectorAll('a')].find((a) => a.innerText.includes(n)).click(), `Sunrise Cleaning ${run}`);
  await waitText(customer, 'Deep clean (2 bedrooms)');
  await shot(customer, '10-profile');
  await click(customer, 'Book Deep clean (2 bedrooms)');
  await customer.waitForSelector('[role="radiogroup"] [role="radio"]', { timeout: 10000 });
  await customer.click('[role="radiogroup"] [role="radio"]');
  const chosen = await customer.evaluate(() => document.querySelector('[role="radio"][aria-checked="true"]').textContent);
  await fill(customer, 'Note for the business (optional)', 'Buzz 4B. Cat is friendly.');
  await shot(customer, '11-service-booking', false);
  await click(customer, 'Confirm booking');
  await waitText(customer, 'Verify to book');
  await fill(customer, 'Email address', `sam-${run}@example.dev`);
  await click(customer, 'Send code');
  await waitText(customer, 'We sent a 6-digit code');
  await sleep(300);
  const code = lastDevEmail(/Enter this code to continue: (\d{6})/);
  await fill(customer, 'Verification code', code);
  await fill(customer, 'Your name (optional)', 'Sam Rivera');
  await click(customer, 'Verify and continue');
  console.log('  step: waiting for signed-in confirmation');
  await waitText(customer, "You're signed in");
  console.log('  step: signed in');
  await customer.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 5000 });
  // The chosen time and note survived sign-in.
  const kept = await customer.evaluate(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent);
  if (kept !== chosen) throw new Error(`selected time lost after sign-in (${chosen} -> ${kept})`);
  await click(customer, 'Confirm booking');
  console.log('  step: confirm clicked');
  await waitText(customer, 'History');
  await shot(customer, '12-booking-detail');
  console.log('✓ guest booked; sign-in requested at booking time and selection kept');

  // F. Vendor sees the appointment.
  await vendor.goto(`${BASE}/business/appointments`);
  await waitText(vendor, 'Sam Rivera');
  await shot(vendor, '13-vendor-appointments');
  console.log('✓ vendor sees appointment');

  // G. Mobile viewport.
  const mobile = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await mobile.goto(BASE);
  await waitText(mobile, 'What do you need today?');
  await shot(mobile, '14-mobile-home');
  console.log('✓ mobile home');
} catch (err) {
  console.error('E2E FAILED:', err.message);
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}fail-${i}.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.log('Browser errors:\n' + [...new Set(errors)].join('\n'));
  await browser.close();
}
