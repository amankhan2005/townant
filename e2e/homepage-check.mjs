// Browser checks for the homepage, location picker, assistant launcher and Super Admin homepage controls.
// Seeds a DEDICATED local database (name must contain "e2e"), so it never touches dev or remote
// data. Run against a stack started on that database (see e2e/README.md):
//   MONGODB_URI='mongodb://127.0.0.1:27018/townant_e2e_home?replicaSet=rs0' WEB_URL=http://localhost:5174 node homepage-check.mjs
import { execFileSync } from 'node:child_process';

const URI = process.env.MONGODB_URI ?? '';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URI) || !/\/[^/?]*e2e[^/?]*(\?|$)/.test(URI)) {
  console.error('Refusing to run: MONGODB_URI must be a local database whose name contains "e2e" (it is wiped).');
  process.exit(2);
}
const BASE = process.env.WEB_URL ?? 'http://localhost:5174';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
execFileSync('mkdir', ['-p', SHOTS]);

// ---------- Seed ----------
const { default: mongoose } = await import('mongoose');
const models = await import('../apps/api/src/models/index.js');
await mongoose.connect(URI);
for (const c of await mongoose.connection.db.collections()) await c.deleteMany({});

const svg = (bg, label) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${bg}"/><text x="400" y="320" font-size="48" text-anchor="middle" fill="#fff" font-family="Arial">${label}</text></svg>`)}`;
const media = (url) => ({ publicId: `e2e/${Math.random().toString(36).slice(2)}`, url, width: 800, height: 600 });
const hair = await models.Category.create({ name: 'Hair & Beauty', slug: 'hair-beauty', icon: 'scissors', sortOrder: 1, image: media(svg('#147d73', 'Hair')), imageAlt: 'Stylist at work' });
await models.Category.create({ name: 'Barbers', slug: 'barbers', parentId: hair._id });
const home = await models.Category.create({ name: 'Home Services', slug: 'home-services', icon: 'home', sortOrder: 2 });
// Published, with a business: produces a data-driven "Cleaning" row until Super Admin turns it off.
const cleaning = await models.Category.create({ name: 'Cleaning', slug: 'cleaning', icon: 'sparkles', sortOrder: 3 });
const petCare = await models.Category.create({ name: 'Pet Care', slug: 'pet-care', icon: 'paw', sortOrder: 4, isActive: false });
const OPEN = Array.from({ length: 7 }, () => [{ start: '08:00', end: '20:00' }]);
const company = (name, cat, address, extra = {}) =>
  models.Company.create({
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    status: 'published',
    publishedAt: new Date(),
    primaryCategoryId: cat._id,
    categoryIds: [cat._id],
    summary: `${name} — test listing`,
    address,
    searchText: `${name} ${cat.name} ${address.city}`.toLowerCase(),
    availability: { timezone: 'UTC', weekly: OPEN, exceptions: [] },
    ...extra,
  });
const austin = { city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' };
const a1 = await company('Austin Barbers', hair, austin, { media: { banner: media(svg('#14243a', 'Austin Barbers')) } });
const a2 = await company('Lone Star Handyman', home, austin);
const l1 = await company('Leeds Cuts', hair, { city: 'Leeds', region: 'West Yorkshire', postalCode: 'LS1 4AP', country: 'GB' });
await company('Sparkle Cleaners', cleaning, austin);
await company('Hidden Groomers', petCare, austin);
await company('Draft Salon', hair, austin, { status: 'draft' });
for (const c of [a1, a2, l1]) await models.Service.create({ companyId: c._id, title: 'Standard appointment', durationMinutes: 30 });
await models.SiteSettings.create({ key: 'site', hero: { published: { image: media(svg('#0f655d', 'Hero')), alt: 'Test hero illustration', focalX: 60, focalY: 50 }, publishedAt: new Date() } });
await mongoose.disconnect();

const adminOut = execFileSync('node', ['--env-file=.env', 'scripts/create-admin.js', '--email', `ops-${Date.now().toString(36)}@townant.dev`], {
  cwd: new URL('../apps/api', import.meta.url).pathname,
  encoding: 'utf8',
  env: { ...process.env, MONGODB_URI: URI },
});
const adminLink = adminOut.match(/(http\S+admin\/setup\?token=\S+)/)[1].replace(/^https?:\/\/[^/]+/, BASE);

// ---------- Browser ----------
const { default: puppeteer } = await import('puppeteer-core');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] });
const failures = [];
const errors = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
async function newPage(viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|503|Service Unavailable/.test(m.text()) && errors.push(`console: ${m.text()}`));
  return page;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitText = (page, text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);

// The visible location trigger (in the header search bar from 1024px, a standalone header button below).
const visibleTrigger = (page) =>
  page.evaluateHandle(() =>
    [...document.querySelectorAll('button[aria-label^="Location:"]')].find((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden';
    }),
  );

async function checkPicker(viewport, scroll, label) {
  const page = await newPage(viewport);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  if (scroll === 'top-edge') {
    // Put the trigger right under the top of the viewport (the reported failure case).
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[aria-label^="Location:"]')].find((x) => x.getBoundingClientRect().width > 0);
      window.scrollTo(0, b.getBoundingClientRect().top + window.scrollY - 70);
    });
  } else if (scroll) await page.evaluate((y) => window.scrollTo(0, y), scroll);
  await sleep(150);
  const trigger = await visibleTrigger(page);
  await trigger.click();
  await page.waitForSelector('[role="dialog"][aria-modal="true"]');
  await sleep(250);
  const geo = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal="true"]');
    const r = d.getBoundingClientRect();
    const submit = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Use this location');
    const title = d.querySelector('h2');
    const hit = (el) => {
      el.scrollIntoView({ block: 'nearest' });
      const b = el.getBoundingClientRect();
      const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return Boolean(at && (at === el || el.contains(at)));
    };
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, inBody: d.parentElement?.parentElement === document.body || d.closest('header') === null, submitHit: hit(submit), titleHit: hit(title), focusInside: d.contains(document.activeElement) };
  });
  const inside = geo.top >= -0.5 && geo.left >= -0.5 && geo.bottom <= geo.vh + 0.5 && geo.right <= geo.vw + 0.5;
  check(inside && geo.submitHit && geo.titleHit && geo.inBody && geo.focusInside, `location picker fully visible + usable — ${label} (top ${Math.round(geo.top)}, bottom ${Math.round(geo.bottom)}/${geo.vh})`);
  await page.screenshot({ path: `${SHOTS}picker-${label.replace(/[^a-z0-9]+/gi, '_')}.png` });
  await page.keyboard.press('Escape');
  await sleep(300);
  const closed = await page.evaluate(() => !document.querySelector('[role="dialog"][aria-modal="true"]') && document.activeElement?.getAttribute('aria-label')?.startsWith('Location:'));
  check(closed, `Escape closes the picker and returns focus — ${label}`);
  // Outside click closes too.
  await (await visibleTrigger(page)).click();
  await page.waitForSelector('[role="dialog"][aria-modal="true"]');
  await sleep(250);
  await page.mouse.click(4, viewport.height - 4);
  await sleep(300);
  if (viewport.width >= 640) check(await page.evaluate(() => !document.querySelector('[role="dialog"][aria-modal="true"]')), `outside click closes the picker — ${label}`);
  await page.close();
}

try {
  for (const [vp, scroll, label] of [
    [{ width: 1440, height: 900 }, 0, 'desktop 1440 top'],
    [{ width: 1440, height: 900 }, 1200, 'desktop 1440 scrolled'],
    [{ width: 1280, height: 560 }, 900, 'short viewport (zoomed) scrolled'],
    [{ width: 1024, height: 768 }, 'top-edge', 'tablet 1024 trigger at top edge'],
    [{ width: 768, height: 1024 }, 'top-edge', 'tablet 768 trigger at top edge'],
    [{ width: 390, height: 844, isMobile: true, hasTouch: true }, 'top-edge', 'phone 390 trigger at top edge'],
  ]) {
    await checkPicker(vp, scroll, label);
  }

  // Homepage content from the API.
  const page = await newPage({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  const homeData = await page.evaluate(() => ({
    heroAlt: document.querySelector('section[aria-labelledby="hero-heading"] img[fetchpriority="high"]')?.alt,
    heroBg: getComputedStyle(document.querySelector('section[aria-labelledby="hero-heading"]')).backgroundColor,
    heroColumns: (() => {
      const hero = document.querySelector('section[aria-labelledby="hero-heading"]');
      const h1 = hero.querySelector('h1').getBoundingClientRect();
      const img = hero.querySelector('img[fetchpriority="high"]').getBoundingClientRect();
      return img.left > h1.right && img.top < h1.bottom;
    })(),
    heroSubtitleItalic: getComputedStyle(document.querySelector('section[aria-labelledby="hero-heading"] h1 + p')).fontStyle,
    exploreHasImage: Boolean(document.querySelector('section[aria-labelledby="hero-heading"] ul li:last-child img, section[aria-labelledby="hero-heading"] ul li:last-child svg:not([aria-hidden="true"])')),
    cards: [...document.querySelectorAll('section[aria-labelledby="hero-heading"] ul[aria-label="What do you need today?"] li a')].map((a) => a.innerText.trim()),
    explore: document.querySelector('section[aria-labelledby="hero-heading"] ul[aria-label="What do you need today?"] li:last-child a')?.getAttribute('href'),
    heroSearch: Boolean(document.querySelector('section[aria-labelledby="hero-heading"] form[role="search"]')),
    categorySection: Boolean(document.getElementById('categories-heading')),
    cardImages: [...document.querySelectorAll('section[aria-labelledby="hero-heading"] ul[aria-label="What do you need today?"] li img')].length,
    headings: [...document.querySelectorAll('h2')].map((h) => h.innerText.trim()),
    categoryRows: document.querySelectorAll('section[aria-labelledby^="col-"]').length,
    cleaningRowLink: [...document.querySelectorAll('main a[href*="category=cleaning"]')].some((a) => !a.closest('ul[aria-label="What do you need today?"]')),
    howCount: [...document.querySelectorAll('h2')].filter((h) => h.innerText.trim() === 'How TownAnt Works').length,
    vendorCta: document.querySelector('section[aria-labelledby="vendor-heading"] a')?.getAttribute('href'),
    vendorFigures: document.querySelectorAll('section[aria-labelledby="vendor-heading"] figure').length,
    text: document.body.innerText,
    headingFont: getComputedStyle(document.querySelector('h1')).fontFamily,
    bodyFont: getComputedStyle(document.body).fontFamily,
  }));
  check(homeData.heroAlt === 'Test hero illustration', 'hero image comes from published site settings');
  check(JSON.stringify(homeData.cards) === JSON.stringify(['Hair & Beauty', 'Home Services', 'Cleaning', 'Explore Categories']) && homeData.explore === '/categories', `hero shows the published top-level categories, then Explore Categories (${homeData.cards.join(', ')})`);
  check(!homeData.heroSearch && !homeData.categorySection, 'no hero search form and no standalone Browse by category section');
  check(homeData.heroBg === 'rgb(255, 255, 255)' && homeData.heroColumns, 'hero is white with the photo in a right-hand column (1440px)');
  check(homeData.heroSubtitleItalic === 'italic' && !homeData.exploreHasImage, 'italic supporting line; Explore Categories is text only');
  check(!homeData.headings.includes('Cleaning') && homeData.categoryRows === 0 && !homeData.cleaningRowLink, 'no category rows on the homepage: no Cleaning heading or category=cleaning "See all" link');
  check(!homeData.headings.includes('Not sure where to start?') && !homeData.text.includes('TownAnt assistant'), 'assistant promotion removed from the homepage');
  check(['How TownAnt Works', 'TownAnt, wherever you go.', 'Bring your business to TownAnt.'].every((h) => homeData.headings.includes(h)) && homeData.howCount === 1, 'how-it-works (once), app and vendor sections render');
  check(homeData.vendorCta === '/join' && homeData.vendorFigures === 0, 'vendor banner has one CTA to /join and no portal mockup');
  check(!/9:41|★|4\.9|\d+ bookings/.test(await page.evaluate(() => document.querySelector('section[aria-labelledby="app-heading"]').innerText)), 'app mockup shows no invented ratings, counts or bookings');
  check(homeData.cardImages === 1, 'only the category with an uploaded image shows a photo');
  check(!homeData.cards.includes('Pet Care') && !homeData.headings.includes('Pet Care') && !homeData.text.includes('Pet Care'), 'unpublished category is not shown (no card, row or label)');

  check(!homeData.text.includes('Draft Salon'), 'draft business is not shown');
  check(!homeData.headings.some((h) => h.startsWith('Most booked')), 'most-booked row omitted without enough bookings');
  check(!homeData.headings.includes('In the spotlight'), 'spotlight omitted when nothing is placed');
  check(/Manrope/.test(homeData.headingFont) && /Inter/.test(homeData.bodyFont), 'Manrope headings, Inter body');
  await page.screenshot({ path: `${SHOTS}home-1440.png`, fullPage: true });

  // Choosing a location updates the homepage rows immediately (shared location store).
  await (await visibleTrigger(page)).click();
  await page.waitForSelector('[role="dialog"][aria-modal="true"]');
  await (await page.waitForSelector('::-p-aria(ZIP / postal code)')).type('LS1 4AP');
  await (await page.waitForSelector('::-p-aria(City)')).type('Leeds');
  await (await page.waitForSelector('[role="dialog"] ::-p-aria(Country)')).click();
  await page.waitForSelector('[role="listbox"]');
  await page.keyboard.type('United King');
  await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === 'United Kingdom').click());
  await (await page.waitForSelector('::-p-aria(Use this location)')).click();
  await waitText(page, 'near LS1 4AP, Leeds');
  await sleep(600);
  const newRow = await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby="new"] h3')].map((h) => h.innerText.trim()));
  check(JSON.stringify(newRow) === JSON.stringify(['Leeds Cuts']), `rows follow the selected location without reload (${newRow.join(', ')})`);

  // Assistant: opens, degrades gracefully when the AI provider is not configured, closes with Escape.
  await (await page.waitForSelector('::-p-aria(Ask TownAnt)')).click();
  await page.waitForSelector('[role="dialog"][aria-modal="false"]');
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  await page.keyboard.type('a barber in Leeds this weekend');
  await page.keyboard.press('Enter');
  await waitText(page, "isn't available right now");
  const assistant = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal="false"]');
    const r = d.getBoundingClientRect();
    return { inside: r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth, fallback: Boolean([...d.querySelectorAll('a')].find((a) => a.textContent.includes('Use regular search'))), mic: Boolean(d.querySelector('[aria-label="Speak your request"]')), where: d.innerText.includes('LS1 4AP, Leeds') };
  });
  check(assistant.inside && assistant.fallback, 'assistant shows a provider-failure fallback with regular search');
  check(assistant.mic, 'assistant offers a microphone control');
  check(assistant.where, 'assistant uses the selected location');
  await page.screenshot({ path: `${SHOTS}assistant-1440.png` });
  await page.keyboard.press('Escape');
  await sleep(300);
  check(await page.evaluate(() => !document.querySelector('[role="dialog"][aria-modal="false"]')), 'Escape closes the assistant');
  await page.goto(`${BASE}/b/austin-barbers/s/${(await (await fetch(`${BASE}/api/v1/catalog/companies/austin-barbers/services`)).json()).data[0].id}`, { waitUntil: 'networkidle0' });
  check(await page.evaluate(() => !document.querySelector('[aria-label="Ask TownAnt"]')), 'assistant launcher hidden on the booking page');
  await page.close();

  const phone = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await phone.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await (await phone.waitForSelector('::-p-aria(Ask TownAnt)')).click();
  await phone.waitForSelector('[role="dialog"][aria-modal="false"]');
  await sleep(250);
  const sheet = await phone.evaluate(() => {
    const r = document.querySelector('[role="dialog"][aria-modal="false"]').getBoundingClientRect();
    return r.top === 0 && r.left === 0 && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight;
  });
  check(sheet, 'assistant is a full-screen sheet on phones');
  await phone.screenshot({ path: `${SHOTS}assistant-390.png` });
  await phone.close();

  // Super Admin: homepage controls.
  const admin = await newPage({ width: 1280, height: 900 });
  await admin.goto(adminLink);
  await (await admin.waitForSelector('::-p-aria(Your name)')).type('Ops Lead');
  await (await admin.waitForSelector('::-p-aria(Create a password)')).type('admin-passphrase-for-e2e');
  await (await admin.waitForSelector('::-p-aria(Confirm password)')).type('admin-passphrase-for-e2e');
  await (await admin.waitForSelector('::-p-aria(Create account)')).click();
  await waitText(admin, 'Marketplace activity', 15000);
  await admin.goto(`${BASE}/admin/categories`, { waitUntil: 'networkidle0' });
  await waitText(admin, 'Unpublished');
  await admin.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit' && b.closest('div').innerText.includes('Home Services')).click());
  await waitText(admin, 'Category image');
  check(await admin.evaluate(() => document.body.innerText.includes('Choose an image') && document.body.innerText.includes('JPEG, PNG or WebP up to 5 MB')), 'admin category editor offers image upload');
  await admin.screenshot({ path: `${SHOTS}admin-category-edit.png` });
  await admin.keyboard.press('Escape');

  await sleep(400);
  // Turn off the Cleaning homepage row; the category stays published.
  await admin.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit' && b.closest('div').innerText.includes('/cleaning')).click());
  await (await admin.waitForSelector('[role="switch"][aria-checked="true"]::-p-aria(Show a row on the homepage)')).click();
  await (await admin.waitForSelector('::-p-aria(Save details)')).click();
  await waitText(admin, 'No homepage row');
  const home2 = await newPage({ width: 1440, height: 900 });
  await home2.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  const after = await home2.evaluate(() => ({ row: Boolean(document.querySelector('section[aria-labelledby="col-cleaning"]')), card: [...document.querySelectorAll('ul[aria-label="What do you need today?"] li a')].some((a) => a.innerText.trim() === 'Cleaning') }));
  check(!after.row && after.card, 'after the Super Admin toggle there is still no Cleaning row; the category stays browsable');
  await home2.close();

  await admin.goto(`${BASE}/admin/homepage`, { waitUntil: 'networkidle0' });
  await waitText(admin, 'Live on the homepage');
  check(await admin.evaluate(() => document.body.innerText.includes('Published') && document.body.innerText.includes('Test hero illustration')), 'admin sees the published hero');
  for (const name of ['Austin Barbers', 'Leeds Cuts']) {
    const search = await admin.waitForSelector('::-p-aria(Search published businesses)');
    await search.click({ clickCount: 3 });
    await search.type(name);
    await admin.waitForFunction((n) => [...document.querySelectorAll('li')].some((li) => li.innerText.includes(n) && li.querySelector('button')), { timeout: 8000 }, name);
    await admin.evaluate((n) => [...document.querySelectorAll('li')].find((li) => li.innerText.includes(n) && li.querySelector('button')).querySelector('button').click(), name);
    await waitText(admin, `${name} added to the spotlight`);
    await sleep(400);
  }
  await (await admin.waitForSelector('::-p-aria(Move Leeds Cuts up)')).click();
  await (await admin.waitForSelector('::-p-aria(Save order)')).click();
  await waitText(admin, 'Spotlight order saved');
  await sleep(300);
  const previewCount = await admin.evaluate(() => document.querySelectorAll('section[aria-labelledby="spotlight-preview"] article').length);
  check(previewCount === 2, 'admin spotlight preview shows the placed businesses');
  await admin.screenshot({ path: `${SHOTS}admin-homepage.png`, fullPage: true });
  const pub = await (await fetch(`${BASE}/api/v1/catalog/spotlight`)).json();
  check(JSON.stringify(pub.data.map((c) => c.name)) === JSON.stringify(['Leeds Cuts', 'Austin Barbers']), 'public spotlight follows the saved admin order');
  await admin.close();

  check(errors.length === 0, `no console/page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (err) {
  failures.push(err.message);
  console.error('FAIL', err);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll homepage checks passed');
process.exit(failures.length ? 1 : 0);
