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

// Server-side mirror of the client's computeMargin. Centralizing the formula
// here means a future REST/CLI client gets the same math the UI shows.
function computeMargin(product) {
  const e = product && product._economics;
  if (!e) return null;
  const sale =
    product.price && typeof product.price.amount === 'number'
      ? product.price.amount
      : null;
  if (sale == null || sale <= 0) return null;
  const cost = Number(e.cost) || 0;
  const ship = Number(e.shipping) || 0;
  const feeP = Number(e.feesPercent) || 0;
  const feeF = Number(e.feesFixed) || 0;
  if (cost === 0 && ship === 0 && feeP === 0 && feeF === 0) return null;
  const fees = sale * (feeP / 100) + feeF;
  const netRevenue = sale - fees;
  const profit = netRevenue - cost - ship;
  return {
    cost, ship, feeP, feeF, fees,
    netRevenue, profit,
    marginPercent: (profit / sale) * 100,
  };
}

function addProductsSheet(wb, products) {
  // Optional column groups are only shown when at least one product has data
  // for them — keeps the sheet narrow when nobody uses the feature.
  const anyHistory = products.some(
    (p) => p && p._history && p._history.previous
  );
  const anyEconomics = products.some((p) => computeMargin(p) != null);
  const anyGroups = products.some((p) => p && p._group && p._group.id != null);

  const ws = wb.addWorksheet('Products');
  const columns = [
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
  if (anyHistory) {
    columns.push(
      { header: 'Previous Price', key: 'prevPrice', width: 14 },
      { header: 'Δ Price', key: 'priceChange', width: 12 },
      { header: 'Δ %', key: 'pricePercent', width: 10 },
      { header: 'Last Seen', key: 'lastSeen', width: 20 }
    );
  }
  if (anyEconomics) {
    columns.push(
      { header: 'Cost', key: 'cost', width: 10 },
      { header: 'Shipping', key: 'shipping', width: 10 },
      { header: 'Fees %', key: 'feesPercent', width: 9 },
      { header: 'Fees $', key: 'feesFixed', width: 10 },
      { header: 'Net Revenue', key: 'netRevenue', width: 13 },
      { header: 'Profit', key: 'profit', width: 10 },
      { header: 'Margin %', key: 'marginPercent', width: 10 }
    );
  }
  if (anyGroups) {
    columns.push(
      { header: 'Group #', key: 'groupId', width: 8 },
      { header: 'Canonical Name', key: 'canonicalName', width: 40 },
      { header: 'Group Confidence', key: 'groupConfidence', width: 14 }
    );
  }
  ws.columns = columns;
  styleHeader(ws);

  for (const p of products) {
    const row = {
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
    };
    if (anyHistory) {
      const prev = p._history && p._history.previous;
      const delta = p._history && p._history.delta;
      row.prevPrice = prev && prev.priceAmount != null ? prev.priceAmount : '';
      row.priceChange = delta && delta.priceChange != null ? delta.priceChange : '';
      row.pricePercent =
        delta && delta.pricePercent != null
          ? Number(delta.pricePercent.toFixed(2))
          : '';
      row.lastSeen = prev ? prev.extractedAt : '';
    }
    if (anyEconomics) {
      const m = computeMargin(p);
      if (m) {
        row.cost = m.cost;
        row.shipping = m.ship;
        row.feesPercent = m.feeP;
        row.feesFixed = m.feeF;
        row.netRevenue = Number(m.netRevenue.toFixed(2));
        row.profit = Number(m.profit.toFixed(2));
        row.marginPercent = Number(m.marginPercent.toFixed(2));
      }
    }
    if (anyGroups) {
      const g = p._group;
      if (g) {
        row.groupId = g.id;
        row.canonicalName = g.canonicalName || '';
        row.groupConfidence = g.confidence || '';
      }
    }
    const xlRow = ws.addRow(row);
    if (p.sourceUrl) hyperlinkCell(xlRow.getCell('sourceUrl'), p.sourceUrl);
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
