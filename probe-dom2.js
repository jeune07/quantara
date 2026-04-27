const puppeteer = require('puppeteer');
const fs = require('fs');
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
  await new Promise((r) => setTimeout(r, 4000));

  // Grab main content DOM and look for repeating "tile"-like structures.
  const info = await page.evaluate(() => {
    const main = document.querySelector('#MainContent') || document.body;
    // Count elements by class
    const byCls = {};
    main.querySelectorAll('*').forEach((el) => {
      const cls = el.className;
      if (typeof cls !== 'string' || !cls) return;
      cls.split(/\s+/).forEach((c) => {
        byCls[c] = (byCls[c] || 0) + 1;
      });
    });
    const top = Object.entries(byCls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40);

    // Also dump any DOM node whose innerText contains a dollar price
    const priceNodes = [];
    main.querySelectorAll('*').forEach((el) => {
      const t = (el.innerText || '').trim();
      if (!t || t.length > 300) return;
      if (/\$\d/.test(t) && el.children.length < 8) {
        priceNodes.push({
          tag: el.tagName,
          cls: el.className,
          text: t.slice(0, 250).replace(/\s+/g, ' '),
        });
      }
    });

    // Look at h2/h3 headers (tile titles likely)
    const headers = [];
    main.querySelectorAll('h1,h2,h3,h4').forEach((el) => {
      headers.push({
        tag: el.tagName,
        cls: el.className,
        text: (el.innerText || '').trim().slice(0, 120),
      });
    });

    // Sample the main content HTML near tiles
    const firstTiles = [];
    const tilesRoot = main.querySelector('[class*="Presentation" i], [class*="Tile" i], [class*="presentation"], [class*="tile"]');
    // Fallback: find any repeating containers
    return {
      topClasses: top,
      priceNodeCount: priceNodes.length,
      priceSample: priceNodes.slice(0, 10),
      headers: headers.slice(0, 40),
      mainHtmlLen: main.innerHTML.length,
    };
  });

  console.log('Top classes in #MainContent:');
  for (const [c, n] of info.topClasses) console.log(`  ${n}\t${c}`);
  console.log(`\nHeaders (${info.headers.length}):`);
  for (const h of info.headers) console.log(`  <${h.tag} class="${h.cls}"> ${h.text}`);
  console.log(`\nNodes with $price: ${info.priceNodeCount}`);
  for (const p of info.priceSample) console.log(`  <${p.tag} class="${p.cls}"> ${p.text}`);
  console.log(`\n#MainContent innerHTML size: ${info.mainHtmlLen}`);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
