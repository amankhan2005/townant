// Responsive check: captures pages at several widths and fails on horizontal overflow or
// console errors. Read-only (it only loads pages). Usage:
//   node screens.mjs / /search?q=clean /categories
const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const WIDTHS = (process.env.WIDTHS ?? '1440,1024,768,390').split(',').map(Number);
const { default: puppeteer } = await import('puppeteer-core');
const OUT = new URL('./shots/', import.meta.url).pathname;
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/'];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let failures = 0;
for (const path of paths) {
  for (const width of WIDTHS) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()));
    await page.setViewport({ width, height: width < 600 ? 844 : 900, isMobile: width < 600, hasTouch: width < 600 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 300));
    const name = `${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}-${width}`;
    await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const ok = overflow <= 0 && errors.length === 0;
    if (!ok) failures += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${overflow > 0 ? ` overflow ${overflow}px` : ''}${errors.length ? ` errors: ${errors.join(' | ')}` : ''}`);
    await page.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
