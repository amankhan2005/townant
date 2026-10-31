// Development check: signs in to the Vendor Panel as a business owner and records what the vendor
// sees for a booking — the appointments list, the booking detail, and the times offered when
// moving another appointment to the same day (which must not include the booked time).
//
//   VENDOR_EMAIL=… VENDOR_PASSWORD=… BOOKING_REF=TA-… OTHER_BOOKING_ID=<id> DAY_LABEL="Tuesday, 11/03/2026" \
//   OUT=<dir> node dev-vendor-check.mjs
const { default: puppeteer } = await import('puppeteer-core');
const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const { VENDOR_EMAIL, VENDOR_PASSWORD, BOOKING_REF, OTHER_BOOKING_ID, DAY_LABEL, OUT = 'shots' } = process.env;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, defaultViewport: { width: 1360, height: 950 } });
const page = await browser.newPage();
page.setDefaultTimeout(30000);
const text = () => page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
const fill = async (label, value) => {
  const id = await page.evaluate((t) => [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(t))?.htmlFor, label);
  await page.type(`[id="${id}"]`, value);
};

await page.goto(`${BASE}/business/login`, { waitUntil: 'networkidle0' });
await fill('Email', VENDOR_EMAIL);
await fill('Password', VENDOR_PASSWORD);
await page.locator('button[type="submit"]').click();
await page.waitForFunction(() => location.pathname === '/business' || location.pathname === '/business/');
await page.waitForFunction(() => !document.body.innerText.includes('Loading'), { timeout: 30000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({ path: `${OUT}/vendor-dashboard.png` });
console.log('DASHBOARD:', (await text()).slice(0, 700));

await page.goto(`${BASE}/business/appointments`, { waitUntil: 'networkidle0' });
await page.waitForFunction((ref) => document.body.innerText.includes(ref) || document.body.innerText.includes('Tap Repair'), {}, BOOKING_REF);
await page.screenshot({ path: `${OUT}/vendor-appointments.png` });
console.log('LIST:', (await text()).slice(0, 1200));

await page.locator(`::-p-text(${BOOKING_REF})`).click();
await page.waitForFunction((ref) => /\/business\/appointments\/[a-f0-9]{24}$/.test(location.pathname) && document.body.innerText.includes(ref) && !document.body.innerText.includes('Loading appointment'), {}, BOOKING_REF);
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${OUT}/vendor-booking-detail.png` });
console.log('DETAIL:', (await text()).slice(0, 1200));

await page.goto(`${BASE}/business/appointments/${OTHER_BOOKING_ID}`, { waitUntil: 'networkidle0' });
await page.locator('::-p-text(Reschedule)').click();
await page.waitForFunction(() => document.body.innerText.includes('Move appointment'));
await page.locator('[aria-label="Next month"]').click();
await page.waitForSelector(`[aria-label^="${DAY_LABEL}"]`);
await page.click(`[aria-label^="${DAY_LABEL}"]`);
await page.waitForSelector('[role="radio"]');
await new Promise((r) => setTimeout(r, 800));
const times = await page.evaluate(() => [...document.querySelectorAll('[role="radio"]')].map((b) => b.textContent.trim()));
await page.screenshot({ path: `${OUT}/vendor-move-dialog.png` });
console.log('MOVE DIALOG TIMES:', JSON.stringify(times));
await browser.close();
