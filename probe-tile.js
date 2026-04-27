const puppeteer = require('puppeteer');
const PAGE = 'https://www.mcmaster.com/products/cotter-pins/';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(PAGE, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));

  const tiles = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[class*="_outerContainer_vvkod_"]').forEach((el) => {
      const title = el.querySelector('[class*="_titleContainer_vvkod_"]')?.innerText?.trim() || '';
      const copy = el.querySelector('[class*="_copyContainer_vvkod_"]')?.innerText?.trim() || '';
      const count = el.querySelector('[class*="_productCount_"]')?.innerText?.trim() || '';
      const img = el.querySelector('img')?.src || '';
      const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
      const all = el.innerText.replace(/\s+/g, ' ').trim();
      out.push({ title, copy, count, img, link, all });
    });
    return out;
  });

  console.log(`Found ${tiles.length} tiles.`);
  tiles.forEach((t, i) => {
    console.log(`\n[${i}] title="${t.title}" count="${t.count}" link="${t.link}"`);
    console.log(`     copy: ${t.copy.slice(0, 160)}`);
    console.log(`     all:  ${t.all.slice(0, 200)}`);
  });

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
