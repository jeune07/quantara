// Catalog-table scraper.
// Loads the McMaster cotter-pins category page, captures the
// ProdPageWebPart.aspx response (which contains the full server-rendered
// JSON state with every product row), and writes a workbook structured
// the way the listing displays:
//
//   Material header  →  Diameter sub-header  →  rows of
//   { Length, Specs Met, Pkg Qty, SKU, Price }.
//
// Two sheets:
//   "Catalog (grouped)" — header rows for Material and Diameter, then
//      tabular SKU rows (mirrors the on-page layout).
//   "Catalog (flat)" — every row with explicit columns, easy to filter.
//
// Usage:
//   CATEGORY_URL='https://www.mcmaster.com/products/cotter-pins/cotter-pins-3~~/' \
//   OUT_FILE=cotter-pins-catalog.xlsx \
//   node scrape-catalog-table.js

const puppeteer = require('puppeteer');
const ExcelJS = require('exceljs');
const path = require('path');

const CATEGORY_URL =
  process.env.CATEGORY_URL ||
  'https://www.mcmaster.com/products/cotter-pins/cotter-pins-3~~/';
const OUT = path.resolve(process.env.OUT_FILE || 'cotter-pins-catalog.xlsx');

// Comma-separated list of material names to keep (case-insensitive substring
// match). When unset, every material is included.
//   MATERIALS="18-8 Stainless Steel,316 Stainless Steel"
const MATERIALS = (process.env.MATERIALS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Comma/whitespace-separated exact SKU list. When set, only rows with these
// part numbers are kept. Applied after the MATERIALS filter.
//   SKUS="98401A910,98401A409, 98401A413"
const SKUS = new Set(
  (process.env.SKUS || '')
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function captureProdPage(url) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1366, height: 900 });

    const bodies = [];
    page.on('response', async (res) => {
      if (res.url().includes('ProdPageWebPart')) {
        try {
          bodies.push(await res.text());
        } catch {}
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000));
    return bodies;
  } finally {
    await browser.close();
  }
}

function parseEnvelope(body) {
  // Body format: 10-digit length prefix + JSON.
  const m = body.match(/^(\d{10})/);
  if (!m) return null;
  const len = parseInt(m[1], 10);
  try {
    return JSON.parse(body.slice(10, 10 + len));
  } catch (e) {
    return null;
  }
}

function findChildren(envelope) {
  // Walk the tree to find a node with Children[].Table.Rows populated.
  const queue = [envelope];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (
      Array.isArray(node.Children) &&
      node.Children.length &&
      node.Children[0]?.Table?.Rows
    ) {
      return node.Children;
    }
    for (const k of Object.keys(node)) queue.push(node[k]);
  }
  return [];
}

function readCell(table, cellId) {
  const cmd = table.Metadata.CellIdToCellMetadata[cellId];
  if (!cmd) return { text: '', partNumber: '' };
  const md = table.Metadata.ValueMetadataIdToValueMetadata;
  const text = (cmd.ValueMetadataIds || [])
    .map((vid) => {
      const m = md[vid];
      if (!m) return '';
      return (m.Name?.Components || []).map((c) => c.Text).join('');
    })
    .join(' / ');
  return { text, partNumber: cmd.PartNumbers?.[0] || '' };
}

function buildRows(children) {
  const flat = [];
  for (const child of children) {
    const material = child.Display?.Title || '';
    const tbl = child.Table;
    if (!tbl?.Rows) continue;

    // Identify each column by its header name.
    const colMeta = tbl.Metadata.ColumnIdToMetadata || {};
    const colName = (id) =>
      (colMeta[id]?.Name?.Components || []).map((c) => c.Text).join(' ').trim();

    const cols = {};
    for (const id of Object.keys(colMeta)) {
      const name = colName(id).toLowerCase();
      if (name.includes('material')) cols.material = id;
      else if (name.includes('dia')) cols.diameter = id;
      else if (name === 'lg.' || name.startsWith('lg')) cols.length = id;
      else if (name.includes('specs') || name.includes('spec')) cols.specs = id;
      else if (name.includes('pkg. qty') || (name.includes('pkg') && name.includes('qty')))
        cols.pkgQty = id;
      else if (name === 'pkg.' || name === 'pkg' || name === 'each') cols.price = id;
      else cols[`col_${id}`] = id;
    }

    for (const row of tbl.Rows) {
      const map = row.ColumnIdToCellIdMap || {};
      const get = (k) => (cols[k] ? readCell(tbl, map[cols[k]]) : { text: '', partNumber: '' });

      const matCell = get('material');
      const diaCell = get('diameter');
      const lenCell = get('length');
      const specCell = get('specs');
      const qtyCell = get('pkgQty');
      const priceCell = get('price');

      // SKU comes either from a dedicated unnamed column or from any cell's
      // PartNumbers — fall back to scanning every cell in the row.
      let sku = '';
      for (const cellId of Object.values(map)) {
        const pn = tbl.Metadata.CellIdToCellMetadata[cellId]?.PartNumbers?.[0];
        if (pn) {
          sku = pn;
          break;
        }
      }

      flat.push({
        materialGroup: material,
        material: matCell.text || material,
        diameter: diaCell.text,
        length: lenCell.text,
        specsMet: specCell.text,
        pkgQty: qtyCell.text,
        sku,
        price: priceCell.text,
      });
    }
  }
  return flat;
}

function writeWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'cotter-pin catalog scraper';
  wb.created = new Date();

  // ---- Flat sheet -------------------------------------------------------
  const flat = wb.addWorksheet('Catalog (flat)');
  flat.columns = [
    { header: 'Material Group', key: 'materialGroup', width: 32 },
    { header: 'Material', key: 'material', width: 28 },
    { header: 'Diameter', key: 'diameter', width: 16 },
    { header: 'Length', key: 'length', width: 12 },
    { header: 'Specs Met', key: 'specsMet', width: 18 },
    { header: 'Pkg Qty', key: 'pkgQty', width: 10 },
    { header: 'SKU', key: 'sku', width: 14 },
    { header: 'Price', key: 'price', width: 10 },
    { header: 'SKU URL', key: 'skuUrl', width: 44 },
  ];
  styleHeader(flat);
  rows.forEach((r) => {
    const url = r.sku ? `https://www.mcmaster.com/${r.sku}/` : '';
    const row = flat.addRow({ ...r, skuUrl: url });
    if (url) {
      row.getCell('skuUrl').value = { text: url, hyperlink: url };
      row.getCell('skuUrl').font = { color: { argb: 'FF0563C1' }, underline: true };
    }
  });

  // ---- Grouped sheet ----------------------------------------------------
  const grouped = wb.addWorksheet('Catalog (grouped)');
  grouped.columns = [
    { header: '', key: 'a', width: 28 },
    { header: '', key: 'b', width: 14 },
    { header: '', key: 'c', width: 18 },
    { header: '', key: 'd', width: 10 },
    { header: '', key: 'e', width: 14 },
    { header: '', key: 'f', width: 10 },
  ];
  grouped.spliceRows(1, 1); // remove the empty header row

  let lastMaterial = null;
  let lastDiameter = null;

  // Sort: by material group, then material, then diameter, preserving original
  // row order within a (material, diameter) bucket.
  const sorted = [...rows].sort((a, b) => {
    if (a.materialGroup !== b.materialGroup)
      return a.materialGroup.localeCompare(b.materialGroup);
    if (a.material !== b.material) return a.material.localeCompare(b.material);
    if (a.diameter !== b.diameter) return naturalCompare(a.diameter, b.diameter);
    return 0;
  });

  for (const r of sorted) {
    if (r.material !== lastMaterial) {
      grouped.addRow([]);
      const mr = grouped.addRow([r.material]);
      mr.font = { bold: true, size: 13 };
      mr.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' },
      };
      // Column header row: Lg. / Specs Met / Pkg Qty / SKU / Price
      const hdr = grouped.addRow(['Lg.', 'Specs Met', 'Pkg Qty', 'SKU', 'Price']);
      hdr.font = { bold: true, italic: true };
      hdr.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8E8E8' },
      };
      lastMaterial = r.material;
      lastDiameter = null;
    }
    if (r.diameter !== lastDiameter) {
      const dr = grouped.addRow([r.diameter]);
      dr.font = { bold: true };
      lastDiameter = r.diameter;
    }
    const dataRow = grouped.addRow([
      r.length,
      r.specsMet,
      r.pkgQty,
      r.sku,
      r.price ? `$${r.price}` : '',
    ]);
    if (r.sku) {
      const url = `https://www.mcmaster.com/${r.sku}/`;
      dataRow.getCell(4).value = { text: r.sku, hyperlink: url };
      dataRow.getCell(4).font = { color: { argb: 'FF0563C1' }, underline: true };
    }
  }

  return wb;
}

function naturalCompare(a, b) {
  // For sizes like "1/16\"" vs "3/32\"" — convert to a numeric value where possible.
  const num = (s) => {
    const m = s.match(/(\d+)\s*\/\s*(\d+)/);
    if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };
  return num(a) - num(b);
}

function styleHeader(ws) {
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8E8E8' },
  };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

(async () => {
  console.log(`Loading ${CATEGORY_URL} ...`);
  const bodies = await captureProdPage(CATEGORY_URL);
  if (!bodies.length) {
    console.error('No ProdPageWebPart response captured.');
    process.exit(1);
  }
  // Use the largest captured body (the full table envelope).
  const body = bodies.reduce((a, b) => (b.length > a.length ? b : a), '');
  const env = parseEnvelope(body);
  if (!env) {
    console.error('Failed to parse JSON envelope.');
    process.exit(1);
  }
  const children = findChildren(env);
  console.log(`Found ${children.length} material groups.`);
  children.forEach((c) =>
    console.log(`  - ${c.Display?.Title}: ${c.Table?.Rows?.length || 0} rows`)
  );
  let rows = buildRows(children);
  console.log(`Total rows: ${rows.length}`);

  if (MATERIALS.length) {
    const before = rows.length;
    rows = rows.filter((r) =>
      MATERIALS.some((m) => (r.material || '').toLowerCase().includes(m))
    );
    console.log(
      `Filtered to materials [${MATERIALS.join(', ')}]: ${rows.length} of ${before} rows`
    );
  }

  if (SKUS.size) {
    const before = rows.length;
    rows = rows.filter((r) => SKUS.has((r.sku || '').toUpperCase()));
    console.log(`Filtered to ${SKUS.size} SKUs: ${rows.length} of ${before} rows`);
    const matched = new Set(rows.map((r) => r.sku.toUpperCase()));
    const missing = [...SKUS].filter((s) => !matched.has(s));
    if (missing.length) console.log(`  Missing SKUs: ${missing.join(', ')}`);
  }

  const wb = writeWorkbook(rows);
  await wb.xlsx.writeFile(OUT);
  console.log(`Wrote ${OUT}`);
})().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
