// Development helper: creates the marketplace categories through the real Super Admin panel
// (Admin → Categories → Add category, then the card-image upload on the category page), exactly
// as an administrator would. Existing slugs are skipped. Never point this at production.
//
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… API_LOG=<api log with dev OTP lines> \
//   node dev-admin-categories.mjs <data.json> <image dir>
// The two-step code is read from the API's development log (DEV_PRINT_OTP), so this only works
// against a local API using the development email provider.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { default: puppeteer } = await import('puppeteer-core');
const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const [dataPath, imageDir] = process.argv.slice(2);
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const { ADMIN_EMAIL, ADMIN_PASSWORD, API_LOG } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !API_LOG) throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD and API_LOG.');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Latest development-email code sent to `to` after `since` (ms). Signing in again within the
// resend cooldown reuses the code already sent, so up to 10 minutes back is accepted.
async function codeFor(to, since) {
  const floor = Math.min(since, Date.now() - 10 * 60 * 1000);
  for (let i = 0; i < 40; i += 1) {
    const lines = readFileSync(API_LOG, 'utf8').trim().split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('[dev-email]') || !line.includes(`"to":"${to}"`)) continue;
      const { time, msg } = JSON.parse(line);
      if (new Date(time).getTime() < floor) break;
      const code = msg.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await sleep(500);
  }
  throw new Error(`No code emailed to ${to}`);
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, defaultViewport: { width: 1360, height: 900 } });
const page = await browser.newPage();
page.setDefaultTimeout(30000);

// Types into the input whose <label> starts with `label`.
async function fill(label, value) {
  const id = await page.evaluate((text) => [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(text))?.htmlFor, label);
  if (!id) throw new Error(`No field labelled ${label}`);
  await page.click(`[id="${id}"]`, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(`[id="${id}"]`, String(value));
}
// The panel's Select is a listbox: open it, then pick the option by its label.
async function select(label, optionLabel) {
  const id = await page.evaluate((text) => [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(text))?.htmlFor, label);
  await page.click(`[id="${id}"]`);
  await page.waitForSelector('[role="option"]');
  const picked = await page.evaluate((want) => {
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === want);
    option?.click();
    return Boolean(option);
  }, optionLabel);
  if (!picked) throw new Error(`No option ${optionLabel} in ${label}`);
}
const clickText = (text) => page.locator(`::-p-text(${text})`).click();

// Sign in: password, then the emailed two-step code.
const since = Date.now();
await page.goto(`${BASE}/admin/categories`, { waitUntil: 'networkidle0' });
await fill('Email', ADMIN_EMAIL);
await fill('Password', ADMIN_PASSWORD);
await page.locator('button[type="submit"]').click();
await page.waitForFunction(() => [...document.querySelectorAll('label')].some((l) => l.textContent.trim().startsWith('Code')));
await fill('Code', await codeFor(ADMIN_EMAIL, since));
await clickText('Verify');
await page.waitForFunction(() => location.pathname.startsWith('/admin/categories') && document.body.innerText.includes('Add category'));
console.log('Signed in to the Super Admin panel');

for (const c of data.categories) {
  await page.goto(`${BASE}/admin/categories`, { waitUntil: 'networkidle0' });
  const exists = await page.evaluate((slug) => document.body.innerText.includes(`/${slug}`) || document.body.innerText.includes(slug), c.slug);
  if (exists) {
    console.log(`= ${c.name} already exists`);
    continue;
  }
  await clickText('Add category');
  await page.waitForFunction(() => document.body.innerText.includes('New category'));
  await fill('Name', c.name);
  await fill('Slug', c.slug);
  await select('Line icon', c.icon);
  await fill('Description', c.description);
  await fill('Sort order', c.sortOrder);
  await clickText('Create category');
  await page.waitForFunction(() => /^\/admin\/categories\/[a-f0-9]{24}$/.test(location.pathname), { timeout: 30000 });
  // Card image, on the new category's page.
  const input = await page.waitForSelector('input[type="file"]');
  await input.uploadFile(join(imageDir, `category-${c.slug}.jpg`));
  await page.locator('::-p-text(Save image)').wait();
  await fill('Image description', `${c.name} illustration`);
  await clickText('Save image');
  await page.waitForFunction(() => document.body.innerText.includes('Image saved'), { timeout: 120000 });
  console.log(`+ ${c.name} created with image (${page.url().split('/').pop()})`);
}

await page.goto(`${BASE}/admin/categories`, { waitUntil: 'networkidle0' });
await sleep(800);
await page.screenshot({ path: process.env.SHOT ?? 'shots/dev-admin-categories.png', fullPage: true });
await browser.close();
