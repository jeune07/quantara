// Drill-down scraper:
//   1. Load the cotter-pins landing page and grab each category tile
//      (e.g. "Lightweight Aluminum", "Corrosion-Resistant Stainless Steel").
//   2. For each category, navigate to its listing page and harvest every SKU
//      link (e.g. https://www.mcmaster.com/98450A716/).
//   3. For each SKU page, extract title/description/spec key-value pairs.
//   4. Write everything to cotter-pins-skus.xlsx with two sheets:
//      "Categories" (one row per category) and "SKUs" (one row per part).
//
// Tunables via env vars:
//   MAX_CATEGORIES   limit categories processed (default: all)
//   MAX_SKUS_PER_CAT cap SKUs visited per category (default: 25)
//   CONCURRENCY      parallel SKU pages (default: 3)
//   HEADLESS         "false" to watch the browser (default: new)

const puppeteer = require('puppeteer');
const ExcelJS = require('exceljs');
const path = require('path');

const ROOT = 'https://www.mcmaster.com/products/cotter-pins/';
const OUT = path.join(__dirname, 'cotter-pins-skus.xlsx');

const MAX_CATEGORIES = numEnv('MAX_CATEGORIES', Infinity);
const MAX_SKUS_PER_CAT = numEnv('MAX_SKUS_PER_CAT', 25);
const CONCURRENCY = numEnv('CONCURRENCY', 3);
const HEADLESS = process.env.HEADLESS === 'false' ? false : 'new';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1366, height: 900 });
  return page;
}

async function getCategoryTiles(page) {
  await page.goto(ROOT, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));

  return page.evaluate(() => {
    const out = [];
    document
      .querySelectorAll('[class*="_outerContainer_vvkod_"]')
      .forEach((el) => {
        const title =
          el.querySelector('[class*="_titleContainer_vvkod_"]')?.innerText?.trim() || '';
        const description =
          el.querySelector('[class*="_copyContainer_vvkod_"]')?.innerText?.trim() || '';
        const countTxt =
          el.querySelector('[class*="_productCount_"]')?.innerText?.trim() || '';
        const img = el.querySelector('img')?.src || '';
        const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
        const m = countTxt.match(/(\d[\d,]*)/);
        const productCount = m ? Number(m[1].replace(/,/g, '')) : null;
        out.push({ title, description, productCount, link, img });
      });
    return out;
  });
}

async function getSkuLinks(page, categoryUrl, cap) {
  await page.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));

  // Scroll to coax lazy-loaded SKU rows into the DOM.
  await page.evaluate(async (target) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let last = 0;
    for (let i = 0; i < 30; i++) {
      const found = document.querySelectorAll('a[href*="/"][href]').length;
      window.scrollBy(0, 1500);
      await sleep(400);
      if (found === last && document.querySelectorAll('a').length > target) break;
      last = found;
    }
  }, cap);

  const links = await page.evaluate(() => {
    const set = new Set();
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      // McMaster part-number URLs look like /98450A716/ or /98450A716
      const m = href.match(/^\/?([0-9]{3,}[A-Z][A-Z0-9]+)\/?$/);
      if (m) set.add('https://www.mcmaster.com/' + m[1] + '/');
    });
    return [...set];
  });

  return links.slice(0, cap);
}

async function getSkuDetails(page, skuUrl) {
  await page.goto(skuUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait for the product title to render; SPA hydration is slow.
  try {
    await page.waitForFunction(
      () => {
        const h1 = document.querySelector('h1');
        return h1 && h1.innerText && h1.innerText.trim().length > 3;
      },
      { timeout: 15000 }
    );
  } catch {
    /* fall through — we'll still scrape what's there */
  }
  await new Promise((r) => setTimeout(r, 1500));

  return page.evaluate(() => {
    const txt = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();

    const title =
      txt(document.querySelector('h1')) ||
      txt(document.querySelector('[class*="title"]')) ||
      '';

    const description =
      txt(document.querySelector('meta[name="description"]')) ||
      txt(document.querySelector('[class*="description" i]')) ||
      txt(document.querySelector('[class*="copy" i]')) ||
      '';

    const partNo =
      (location.pathname.match(/\/([0-9]+[A-Z][A-Z0-9]+)\/?$/) || [])[1] || '';

    // Pick a real product image: McMaster CDN ImageCache PNGs, not logos/icons.
    const isProductImg = (src) =>
      !!src &&
      /ImageCache\//i.test(src) &&
      /\.(png|jpg|jpeg)/i.test(src) &&
      !/Browse-Catalog-Icon|placeholder|MastheadLogo|sprite/i.test(src);
    const imgEl = [...document.querySelectorAll('img')]
      .map((i) => i.src || i.getAttribute('data-src') || '')
      .find(isProductImg);
    const img = imgEl || '';

    // Generic spec scrape: dt/dd pairs and 2-cell table rows.
    const specs = {};
    document.querySelectorAll('dl').forEach((dl) => {
      const dts = dl.querySelectorAll('dt');
      const dds = dl.querySelectorAll('dd');
      dts.forEach((dt, i) => {
        const k = txt(dt);
        const v = txt(dds[i]);
        if (k && v) specs[k] = v;
      });
    });
    document.querySelectorAll('table tr').forEach((tr) => {
      const cells = tr.querySelectorAll('th, td');
      if (cells.length === 2) {
        const k = txt(cells[0]);
        const v = txt(cells[1]);
        if (k && v && !(k in specs)) specs[k] = v;
      }
    });
    // Fallback: paired "label / value" rows in spec panels.
    document.querySelectorAll('[class*="spec" i], [class*="detail" i]').forEach((sec) => {
      const labels = sec.querySelectorAll('[class*="label" i], [class*="key" i]');
      const values = sec.querySelectorAll('[class*="value" i], [class*="data" i]');
      labels.forEach((l, i) => {
        const k = txt(l);
        const v = txt(values[i]);
        if (k && v && !(k in specs)) specs[k] = v;
      });
    });

    return { partNo, title, description, img, specs };
  });
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (e) {
        out[idx] = { __error: e.message };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  console.log(`Loading ${ROOT} ...`);
  const root = await newPage(browser);
  let categories = await getCategoryTiles(root);
  await root.close();
  console.log(`Found ${categories.length} categories.`);
  if (Number.isFinite(MAX_CATEGORIES)) categories = categories.slice(0, MAX_CATEGORIES);

  // Walk categories sequentially, harvesting SKU links.
  const skuListPage = await newPage(browser);
  for (const cat of categories) {
    if (!cat.link) {
      cat.skuLinks = [];
      continue;
    }
    console.log(`-> ${cat.title} (${cat.link})`);
    cat.skuLinks = await getSkuLinks(skuListPage, cat.link, MAX_SKUS_PER_CAT);
    console.log(`   ${cat.skuLinks.length} SKU links`);
  }
  await skuListPage.close();

  // Visit SKU pages with bounded concurrency.
  const skuRows = [];
  for (const cat of categories) {
    if (!cat.skuLinks?.length) continue;
    console.log(`Fetching ${cat.skuLinks.length} SKUs from "${cat.title}" ...`);

    const results = await mapLimit(cat.skuLinks, CONCURRENCY, async (url) => {
      const p = await newPage(browser);
      try {
        return await getSkuDetails(p, url);
      } finally {
        await p.close();
      }
    });

    results.forEach((r, i) => {
      const url = cat.skuLinks[i];
      if (r?.__error) {
        skuRows.push({
          category: cat.title,
          categoryDescription: cat.description,
          sku: '',
          skuUrl: url,
          title: '',
          description: `ERROR: ${r.__error}`,
          specs: '',
          img: '',
        });
        return;
      }
      const specPairs = Object.entries(r.specs || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      skuRows.push({
        category: cat.title,
        categoryDescription: cat.description,
        sku: r.partNo,
        skuUrl: url,
        title: r.title,
        description: r.description,
        specs: specPairs,
        img: r.img,
      });
    });
  }

  await browser.close();

  // ---- Write workbook -----------------------------------------------------
  const wb = new ExcelJS.Workbook();
  wb.creator = 'cotter-pin scraper';
  wb.created = new Date();

  const cats = wb.addWorksheet('Categories');
  cats.columns = [
    { header: '#', key: 'idx', width: 5 },
    { header: 'Title', key: 'title', width: 38 },
    { header: 'Description', key: 'description', width: 80 },
    { header: 'Product Count', key: 'productCount', width: 14 },
    { header: 'SKUs Scraped', key: 'skuCount', width: 14 },
    { header: 'Detail URL', key: 'link', width: 70 },
    { header: 'Image URL', key: 'img', width: 70 },
  ];
  styleHeader(cats);
  categories.forEach((c, i) => {
    const row = cats.addRow({
      idx: i + 1,
      title: c.title,
      description: c.description,
      productCount: c.productCount,
      skuCount: c.skuLinks?.length || 0,
      link: c.link,
      img: c.img,
    });
    linkify(row, 'link', c.link);
    linkify(row, 'img', c.img);
    row.alignment = { vertical: 'top', wrapText: true };
  });

  const skus = wb.addWorksheet('SKUs');
  skus.columns = [
    { header: '#', key: 'idx', width: 5 },
    { header: 'Category', key: 'category', width: 32 },
    { header: 'Category Description', key: 'categoryDescription', width: 60 },
    { header: 'SKU', key: 'sku', width: 14 },
    { header: 'SKU URL', key: 'skuUrl', width: 44 },
    { header: 'Product Title', key: 'title', width: 50 },
    { header: 'Product Description', key: 'description', width: 70 },
    { header: 'Specs (key: value)', key: 'specs', width: 70 },
    { header: 'Image URL', key: 'img', width: 60 },
  ];
  styleHeader(skus);
  skuRows.forEach((s, i) => {
    const row = skus.addRow({ idx: i + 1, ...s });
    linkify(row, 'skuUrl', s.skuUrl);
    linkify(row, 'img', s.img);
    row.alignment = { vertical: 'top', wrapText: true };
  });

  await wb.xlsx.writeFile(OUT);
  console.log(`Wrote ${OUT}`);
  console.log(`${categories.length} categories, ${skuRows.length} SKUs total.`);
})().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});

function styleHeader(ws) {
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8E8E8' },
  };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function linkify(row, key, url) {
  if (!url) return;
  row.getCell(key).value = { text: url, hyperlink: url };
  row.getCell(key).font = { color: { argb: 'FF0563C1' }, underline: true };
}
