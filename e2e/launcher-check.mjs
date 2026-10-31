// Floating "Ask TownAnt" launcher check: at each width the whole button must sit inside the
// viewport (at least 8 px from both edges) and the page must not be wider than the screen — also
// while pages are still loading, which is checked on a throttled connection because loading
// skeletons were what once widened the page on narrow phones. Read-only. Usage:
//   node launcher-check.mjs [paths…]
const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const WIDTHS = (process.env.WIDTHS ?? '320,375,768,1024,1440').split(',').map(Number);
const { default: puppeteer } = await import('puppeteer-core');
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/search', '/categories'];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

const measure = (page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Ask TownAnt'));
    const r = button?.getBoundingClientRect();
    return { vw, pageWidth: document.documentElement.scrollWidth, left: r ? Math.round(r.left) : null, right: r ? Math.round(vw - r.right) : null, labelFits: button ? button.scrollWidth <= button.clientWidth : null };
  });

let failures = 0;
for (const path of paths) {
  for (const width of WIDTHS) {
    const page = await browser.newPage();
    const mobile = width < 768;
    await page.setViewport({ width, height: 800, isMobile: mobile, hasTouch: mobile });
    const cdp = await page.createCDPSession();
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 80000, uploadThroughput: 40000 });
    const loaded = page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0', timeout: 120000 });
    const samples = [];
    for (let i = 0; i < 6; i += 1) {
      await new Promise((r) => setTimeout(r, 400));
      samples.push(await measure(page).catch(() => null));
    }
    await loaded;
    samples.push(await measure(page));
    const problems = samples.filter(Boolean).flatMap((m) => [
      m.pageWidth > m.vw && `page ${m.pageWidth}px wide in a ${m.vw}px viewport`,
      m.right !== null && (m.right < 8 || m.left < 8) && `button ${m.left}px from the left, ${m.right}px from the right`,
      m.labelFits === false && 'label clipped inside the button',
    ]).filter(Boolean);
    const final = samples.at(-1);
    const unique = [...new Set(problems)];
    if (unique.length) failures += 1;
    console.log(`${unique.length ? 'FAIL' : 'ok  '} ${String(width).padStart(4)}px ${path}  ${final.right === null ? 'launcher hidden on this page' : `${final.right}px from the right edge`}${unique.length ? `  — ${unique.join('; ')}` : ''}`);
    await page.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
