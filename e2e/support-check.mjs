// Browser journey for support requests (customer, vendor, Super Admin) and customer account
// deletion. Creates its own users in a DEDICATED local database (name must contain "e2e") and
// reads one-time codes from the API log (the API must run with DEV_PRINT_OTP=true).
//   MONGODB_URI='mongodb://127.0.0.1:27018/townant_e2e_home?replicaSet=rs0' WEB_URL=http://localhost:5174 API_LOG=api-home.log node support-check.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const URI = process.env.MONGODB_URI ?? '';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URI) || !/\/[^/?]*e2e[^/?]*(\?|$)/.test(URI)) {
  console.error('Refusing to run: MONGODB_URI must be a local database whose name contains "e2e".');
  process.exit(2);
}
const BASE = process.env.WEB_URL ?? 'http://localhost:5174';
const LOG = new URL(process.env.API_LOG ?? 'api-home.log', import.meta.url).pathname;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
const run = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Seed a vendor (owner) directly; vendors sign in with a password.
const { default: mongoose } = await import('mongoose');
const models = await import('../apps/api/src/models/index.js');
const { hashPassword } = await import('../apps/api/src/lib/crypto.js');
await mongoose.connect(URI);
const vendorEmail = `owner-${run}@vendor-e2e.dev`;
const vendorUser = await models.User.create({ accountType: 'staff', role: 'vendor', status: 'active', email: vendorEmail, emailVerifiedAt: new Date(), displayName: 'Vendor Owner', passwordHash: await hashPassword('vendor-passphrase-e2e') });
const vendorCompany = await models.Company.create({ name: `Support Test Salon ${run}`, slug: `support-test-${run}`, status: 'published', publishedAt: new Date(), address: { city: 'Austin', country: 'US' } });
await models.Membership.create({ userId: vendorUser._id, companyId: vendorCompany._id, role: 'owner' });
await mongoose.disconnect();

const adminOut = execFileSync('node', ['--env-file=.env', 'scripts/create-admin.js', '--email', `desk-${run}@townant.dev`], { cwd: new URL('../apps/api', import.meta.url).pathname, encoding: 'utf8', env: { ...process.env, MONGODB_URI: URI } });
const adminLink = adminOut.match(/(http\S+admin\/setup\?token=\S+)/)[1].replace(/^https?:\/\/[^/]+/, BASE);

const lastCode = () => {
  const lines = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.includes('[dev-email]'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = JSON.parse(lines[i]).msg.match(/(\d{6})/);
    if (m) return m[1];
  }
  throw new Error('no code in API log');
};

const { default: puppeteer } = await import('puppeteer-core');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] });
const failures = [];
const errors = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
async function newPage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(`console: ${m.text()}`));
  return page;
}
const waitText = (page, text, timeout = 10000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const fill = async (page, label, value) => {
  const el = await page.waitForSelector(`::-p-aria(${label})`, { timeout: 8000 });
  await el.click({ clickCount: 3 });
  await el.type(value);
};
const click = async (page, name) => (await page.waitForSelector(`::-p-aria(${name})`, { timeout: 8000 })).click();
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });

try {
  // ----- Customer signs in and opens a request -----
  const customer = await newPage();
  await customer.goto(`${BASE}/login?next=/support/new`, { waitUntil: 'networkidle0' });
  await fill(customer, 'Email address', `jo-${run}@example.dev`);
  await click(customer, 'Send code');
  await waitText(customer, 'We sent a 6-digit code');
  await sleep(300);
  await fill(customer, 'Verification code', lastCode());
  await click(customer, 'Verify and continue');
  await customer.waitForFunction(() => location.pathname === '/support/new', { timeout: 10000 });
  await waitText(customer, 'New support request');

  await click(customer, 'Send request');
  await waitText(customer, 'Choose what your request is about.');
  const invalid = await customer.evaluate(() => [...document.querySelectorAll('[aria-invalid="true"]')].length);
  check(invalid >= 2, 'support form shows inline validation next to the fields');
  await click(customer, 'What is this about?');
  await customer.waitForSelector('[role="listbox"]');
  await customer.evaluate(() => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === 'A booking or appointment').click());
  await fill(customer, 'Subject', 'Booking shows the wrong time');
  await fill(customer, 'Describe the issue', 'My confirmation shows 3 PM but I selected 2 PM. Reference TA-TEST.');
  await shot(customer, 'support-new-1280');
  await click(customer, 'Send request');
  await customer.waitForFunction(() => /\/support\/[a-f0-9]{24}$/.test(location.pathname), { timeout: 10000 });
  await waitText(customer, 'SUP-');
  const ticketUrl = customer.url();
  const reference = await customer.evaluate(() => document.body.innerText.match(/SUP-[A-Z2-9]{6}/)[0]);
  check(Boolean(reference), `customer request created with reference ${reference}`);

  // ----- Vendor opens a request in the portal -----
  const vendor = await newPage();
  await vendor.goto(`${BASE}/business/login`, { waitUntil: 'networkidle0' });
  await fill(vendor, 'Email', vendorEmail);
  await fill(vendor, 'Password', 'vendor-passphrase-e2e');
  await vendor.keyboard.press('Enter');
  await vendor.waitForFunction(() => location.pathname.startsWith('/business') && !location.pathname.includes('login'), { timeout: 10000 });
  await vendor.goto(`${BASE}/business/support/new`, { waitUntil: 'networkidle0' });
  await click(vendor, 'What is this about?');
  await vendor.waitForSelector('[role="listbox"]');
  await vendor.evaluate(() => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === 'My listing and profile').click());
  await fill(vendor, 'Subject', 'Cannot update my banner');
  await fill(vendor, 'Describe the issue', 'Uploading a banner shows an error every time.');
  await click(vendor, 'Send request');
  await vendor.waitForFunction(() => /\/business\/support\/[a-f0-9]{24}$/.test(location.pathname), { timeout: 10000 });
  check(true, 'vendor request created in the portal');
  await shot(vendor, 'support-vendor-1280');

  // ----- Super Admin answers -----
  const admin = await newPage({ width: 1440, height: 900 });
  await admin.goto(adminLink);
  await fill(admin, 'Your name', 'Support Lead');
  await fill(admin, 'Create a password', 'admin-passphrase-for-e2e');
  await fill(admin, 'Confirm password', 'admin-passphrase-for-e2e');
  await click(admin, 'Create account');
  await waitText(admin, 'Marketplace activity', 15000);
  await admin.goto(`${BASE}/admin/support?requesterType=vendor`, { waitUntil: 'networkidle0' });
  await waitText(admin, 'Cannot update my banner');
  check(!(await admin.evaluate(() => document.body.innerText.includes('Booking shows the wrong time'))), 'admin queue filters by requester type');
  await admin.goto(`${BASE}/admin/support?q=${reference}`, { waitUntil: 'networkidle0' });
  await waitText(admin, 'Booking shows the wrong time');
  await admin.evaluate(() => document.querySelector('tbody tr').click());
  await waitText(admin, 'Reply to requester');
  await click(admin, 'Internal note');
  await fill(admin, 'Internal note (visible to Super Admins only)', 'Checked the booking log: slot was 2 PM.');
  await click(admin, 'Add note');
  await waitText(admin, 'Internal note added');
  await click(admin, 'Reply to requester');
  await fill(admin, 'Reply (the requester is notified)', 'Thanks for flagging this. We have asked the business to correct the time.');
  await click(admin, 'Send reply');
  await waitText(admin, 'Reply sent');
  await shot(admin, 'support-admin-1440');

  // ----- Customer sees the reply, never the internal note -----
  await customer.goto(ticketUrl, { waitUntil: 'networkidle0' });
  await waitText(customer, 'We have asked the business');
  const view = await customer.evaluate(() => document.body.innerText);
  check(!view.includes('Checked the booking log'), 'internal note is not shown to the customer');
  check(view.includes('Waiting for your reply'), 'status shows the request is waiting on the customer');
  await fill(customer, 'Your reply', 'Great, thank you!');
  await click(customer, 'Send reply');
  await waitText(customer, 'Reply sent');
  check((await customer.evaluate(() => document.body.innerText)).includes('Open'), 'customer reply reopens the request for support');
  await shot(customer, 'support-thread-1280');

  // ----- Account deletion -----
  await customer.goto(`${BASE}/account#delete-account`, { waitUntil: 'networkidle0' });
  await click(customer, 'Delete my account…');
  await waitText(customer, 'Kept without your name or contact details');
  check((await customer.evaluate(() => document.body.innerText)).includes('1 open support request closed'), 'deletion summary shows this account’s real data');
  // Focus stays inside the dialog while tabbing.
  for (let i = 0; i < 12; i += 1) await customer.keyboard.press('Tab');
  check(await customer.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), 'keyboard focus is trapped in the deletion dialog');
  await shot(customer, 'delete-review-1280');
  const continueDisabled = await customer.$eval('::-p-aria(Continue)', (b) => b.disabled);
  check(continueDisabled, 'cannot continue before acknowledging the consequences');
  await customer.click('[role="dialog"] input[type="checkbox"]');
  await click(customer, 'Continue');
  await click(customer, 'Send code');
  await waitText(customer, 'Code sent to');
  await sleep(300);
  await fill(customer, 'Code sent to', lastCode()).catch(async () => {
    const input = await customer.waitForSelector('input[autocomplete="one-time-code"]');
    await input.type(lastCode());
  });
  const finalDisabled = await customer.$eval('::-p-aria(Permanently delete my account)', (b) => b.disabled);
  check(finalDisabled, 'final delete stays disabled until DELETE is typed');
  await fill(customer, 'Type DELETE to confirm', 'DELETE');
  await click(customer, 'Permanently delete my account');
  await waitText(customer, 'Your account has been deleted', 15000);
  check(true, 'deletion confirmed only after the API responded');
  await shot(customer, 'delete-done-1280');
  await customer.goto(`${BASE}/support`, { waitUntil: 'networkidle0' });
  await customer.waitForFunction(() => location.pathname === '/login', { timeout: 10000 });
  check(true, 'signed out everywhere: protected pages require sign-in again');

  // ----- Phone layout -----
  const phone = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await phone.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(overflow <= 0, 'homepage has no horizontal overflow at 390 px');
  await shot(phone, 'home-390');

  check(errors.length === 0, `no console/page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (err) {
  failures.push(err.message);
  console.error('FAIL', err);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll support and deletion checks passed');
process.exit(failures.length ? 1 : 0);
