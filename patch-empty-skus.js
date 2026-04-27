// Re-fetch the SKU rows that came back empty and patch them in place.
// Reads OUT_FILE (default cotter-pins-full.xlsx), finds rows with no title
// or no specs, refetches those SKU URLs, and writes the workbook back.

const puppeteer = require('puppeteer');
const ExcelJS = require('exceljs');
const path = require('path');

const FILE = path.resolve(process.env.OUT_FILE || 'cotter-pins-full.xlsx');
const CONCURRENCY = Number(process.env.CONCURRENCY) || 2;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function newPage(browser) {
  const p = await browser.newPage();
  await p.setUserAgent(UA);
  await p.setViewport({ width: 1366, height: 900 });
  return p;
}

async function fetchSkuDetails(page, skuUrl) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(skuUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await page
        .waitForFunction(
          () => {
            const h1 = document.querySelector('h1');
            return h1 && h1.innerText && h1.innerText.trim().length > 3;
          },
          { timeout: 25000 }
        )
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));

      const data = await page.evaluate(() => {
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
        const isProductImg = (src) =>
          !!src &&
          /ImageCache\//i.test(src) &&
          /\.(png|jpg|jpeg)/i.test(src) &&
          !/Browse-Catalog-Icon|placeholder|MastheadLogo|sprite/i.test(src);
        const img =
          [...document.querySelectorAll('img')]
            .map((i) => i.src || i.getAttribute('data-src') || '')
            .find(isProductImg) || '';
        return { title, description, specs, img };
      });

      if (data.title || Object.keys(data.specs).length) return data;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          out[idx] = await fn(items[idx], idx);
        } catch (e) {
          out[idx] = { __error: e.message };
        }
      }
    })
  );
  return out;
}

(async () => {
  console.log(`Loading ${FILE} ...`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet('SKUs');
  if (!ws) {
    console.error('No "SKUs" sheet in workbook.');
    process.exit(1);
  }

  const cellText = (cell) => {
    const v = cell.value;
    if (v && typeof v === 'object' && 'text' in v) return v.text;
    return typeof v === 'string' ? v : '';
  };

  // Column keys (must match scrape-skus-to-excel.js):
  // 1=idx 2=category 3=catDesc 4=sku 5=skuUrl 6=title 7=desc 8=specs 9=img
  const empties = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const title = cellText(row.getCell(6));
    const specs = cellText(row.getCell(8));
    if (!title.trim() && !specs.trim()) {
      empties.push({ rowNum: n, sku: cellText(row.getCell(4)), url: cellText(row.getCell(5)) });
    }
  });
  console.log(`Empty rows to refetch: ${empties.length}`);
  if (!empties.length) return;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const results = await mapLimit(empties, CONCURRENCY, async (entry, idx) => {
    const p = await newPage(browser);
    try {
      const data = await fetchSkuDetails(p, entry.url);
      console.log(
        `  [${idx + 1}/${empties.length}] ${entry.sku} ${data?.title ? '✓' : '✗'}`
      );
      return data;
    } finally {
      await p.close();
    }
  });

  await browser.close();

  let patched = 0;
  results.forEach((data, i) => {
    if (!data || data.__error) return;
    const row = ws.getRow(empties[i].rowNum);
    if (data.title) row.getCell(6).value = data.title;
    if (data.description) row.getCell(7).value = data.description;
    if (Object.keys(data.specs).length) {
      row.getCell(8).value = Object.entries(data.specs)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    }
    if (data.img) {
      row.getCell(9).value = { text: data.img, hyperlink: data.img };
      row.getCell(9).font = { color: { argb: 'FF0563C1' }, underline: true };
    }
    row.alignment = { vertical: 'top', wrapText: true };
    if (data.title || Object.keys(data.specs).length) patched++;
  });

  await wb.xlsx.writeFile(FILE);
  console.log(`Patched ${patched} of ${empties.length} empty rows. Wrote ${FILE}.`);
})().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
