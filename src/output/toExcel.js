// Multi-product workbook builder.
//
// One workbook covers any number of products. Sheets are flat tables, which
// scale to 1 product or 1,000 without growing the tab count:
//
//   Products  — one row per product (the catalog overview)
//   Specs     — long format: row per (product, spec key) pair
//   Images    — long format: row per (product, image url) pair
//   Variants  — long format, only added if at least one product has variants
//
// Each row is keyed by `Ref` — the product's SKU when present, else its
// title — so the user can sort/filter/pivot in Excel without lookups.

const ExcelJS = require('exceljs');
const { styleHeader, hyperlinkCell } = require('../utils/excel');

function priceString(price) {
  if (!price || typeof price !== 'object') return '';
  if (price.raw) return price.raw;
  if (typeof price.amount === 'number') {
    return price.currency
      ? `${price.amount} ${price.currency}`
      : String(price.amount);
  }
  return '';
}

function priceCurrency(price) {
  return price && typeof price === 'object' ? price.currency || '' : '';
}

function refOf(product) {
  return product.sku || product.title || product.sourceUrl || '(unnamed)';
}

function addProductsSheet(wb, products) {
  const ws = wb.addWorksheet('Products');
  ws.columns = [
    { header: 'Ref', key: 'ref', width: 22 },
    { header: 'Title', key: 'title', width: 40 },
    { header: 'SKU', key: 'sku', width: 18 },
    { header: 'Brand', key: 'brand', width: 20 },
    { header: 'Price', key: 'price', width: 18 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Availability', key: 'availability', width: 18 },
    { header: 'Description', key: 'description', width: 60 },
    { header: 'Source URL', key: 'sourceUrl', width: 50 },
    { header: 'Mode', key: 'mode', width: 14 },
  ];
  styleHeader(ws);

  for (const p of products) {
    const row = ws.addRow({
      ref: refOf(p),
      title: p.title || '',
      sku: p.sku || '',
      brand: p.brand || '',
      price: priceString(p.price),
      currency: priceCurrency(p.price),
      availability: p.availability || '',
      description: p.description || '',
      sourceUrl: p.sourceUrl || '',
      mode: p.extractionMode || '',
    });
    if (p.sourceUrl) hyperlinkCell(row.getCell('sourceUrl'), p.sourceUrl);
  }
}

function addSpecsSheet(wb, products) {
  const ws = wb.addWorksheet('Specs');
  ws.columns = [
    { header: 'Ref', key: 'ref', width: 22 },
    { header: 'Spec', key: 'spec', width: 30 },
    { header: 'Value', key: 'value', width: 60 },
  ];
  styleHeader(ws);

  for (const p of products) {
    const ref = refOf(p);
    const specs = p.specs && typeof p.specs === 'object' ? p.specs : {};
    for (const [k, v] of Object.entries(specs)) {
      ws.addRow({ ref, spec: k, value: String(v) });
    }
  }
}

function addImagesSheet(wb, products) {
  const ws = wb.addWorksheet('Images');
  ws.columns = [
    { header: 'Ref', key: 'ref', width: 22 },
    { header: '#', key: 'idx', width: 6 },
    { header: 'URL', key: 'url', width: 80 },
  ];
  styleHeader(ws);

  for (const p of products) {
    const ref = refOf(p);
    const images = Array.isArray(p.images) ? p.images : [];
    images.forEach((url, i) => {
      const row = ws.addRow({ ref, idx: i + 1, url });
      if (url) hyperlinkCell(row.getCell('url'), url);
    });
  }
}

function addVariantsSheet(wb, products) {
  const attrKeys = new Set();
  let any = false;
  for (const p of products) {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    if (variants.length) any = true;
    for (const v of variants) {
      if (v && v.attributes) Object.keys(v.attributes).forEach((k) => attrKeys.add(k));
    }
  }
  if (!any) return;

  const ws = wb.addWorksheet('Variants');
  ws.columns = [
    { header: 'Ref', key: 'ref', width: 22 },
    { header: 'Variant SKU', key: 'sku', width: 20 },
    { header: 'Label', key: 'label', width: 40 },
    ...[...attrKeys].map((k) => ({ header: k, key: k, width: 20 })),
  ];
  styleHeader(ws);

  for (const p of products) {
    const ref = refOf(p);
    const variants = Array.isArray(p.variants) ? p.variants : [];
    for (const v of variants) {
      const row = { ref, sku: v.sku || '', label: v.label || '' };
      const attrs = (v && v.attributes) || {};
      for (const k of attrKeys) row[k] = attrs[k] || '';
      ws.addRow(row);
    }
  }
}

async function productsToWorkbookBuffer(products) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('productsToWorkbookBuffer requires a non-empty array');
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'quantara';
  wb.created = new Date();

  addProductsSheet(wb, products);
  addSpecsSheet(wb, products);
  addImagesSheet(wb, products);
  addVariantsSheet(wb, products);

  return await wb.xlsx.writeBuffer();
}

module.exports = { productsToWorkbookBuffer };
