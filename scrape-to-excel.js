// Render the McMaster cotter-pins landing page, extract each product block
// (title, description, product count, image, detail URL), and write to an xlsx.

const puppeteer = require('puppeteer');
const ExcelJS = require('exceljs');
const path = require('path');

const PAGE = 'https://www.mcmaster.com/products/cotter-pins/';
const OUT = path.join(__dirname, 'cotter-pins.xlsx');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1366, height: 900 });

  console.log(`Loading ${PAGE} ...`);
  await page.goto(PAGE, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));

  const tiles = await page.evaluate(() => {
    const rows = [];
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
        const link =
          el.closest('a')?.href || el.querySelector('a')?.href || '';
        const m = countTxt.match(/(\d[\d,]*)/);
        const productCount = m ? Number(m[1].replace(/,/g, '')) : null;
        rows.push({ title, description, productCount, countTxt, link, img });
      });
    return rows;
  });

  await browser.close();

  console.log(`Extracted ${tiles.length} product blocks.`);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'cotter-pint scraper';
  wb.created = new Date();
  const ws = wb.addWorksheet('Cotter Pins');

  ws.columns = [
    { header: '#', key: 'idx', width: 5 },
    { header: 'Title', key: 'title', width: 38 },
    { header: 'Description', key: 'description', width: 80 },
    { header: 'Product Count', key: 'productCount', width: 14 },
    { header: 'Count (raw)', key: 'countTxt', width: 14 },
    { header: 'Detail URL', key: 'link', width: 70 },
    { header: 'Image URL', key: 'img', width: 70 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8E8E8' },
  };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  tiles.forEach((t, i) => {
    const row = ws.addRow({ idx: i + 1, ...t });
    if (t.link) {
      row.getCell('link').value = { text: t.link, hyperlink: t.link };
      row.getCell('link').font = { color: { argb: 'FF0563C1' }, underline: true };
    }
    if (t.img) {
      row.getCell('img').value = { text: t.img, hyperlink: t.img };
      row.getCell('img').font = { color: { argb: 'FF0563C1' }, underline: true };
    }
    row.alignment = { vertical: 'top', wrapText: true };
  });

  // Totals row
  const total = tiles.reduce((s, t) => s + (t.productCount || 0), 0);
  const totalRow = ws.addRow({
    title: `Total (${tiles.length} blocks)`,
    productCount: total,
  });
  totalRow.font = { bold: true };
  totalRow.getCell('title').alignment = { horizontal: 'right' };

  await wb.xlsx.writeFile(OUT);
  console.log(`Wrote ${OUT}`);
  console.log(`${tiles.length} blocks, ${total} total products.`);
})().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
