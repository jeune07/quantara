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

async function productToWorkbookBuffer(product) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'quantara';
  wb.created = new Date();

  const overview = wb.addWorksheet('Product');
  overview.columns = [
    { header: 'Field', key: 'field', width: 18 },
    { header: 'Value', key: 'value', width: 80 },
  ];
  styleHeader(overview);

  const fields = [
    ['Title', product.title || ''],
    ['SKU', product.sku || ''],
    ['Brand', product.brand || ''],
    ['Price', priceString(product.price)],
    ['Availability', product.availability || ''],
    ['Description', product.description || ''],
    ['Source URL', product.sourceUrl || ''],
  ];
  for (const [field, value] of fields) {
    const row = overview.addRow({ field, value });
    if (field === 'Source URL' && value) {
      hyperlinkCell(row.getCell('value'), value);
    }
  }

  const specsSheet = wb.addWorksheet('Specs');
  specsSheet.columns = [
    { header: 'Spec', key: 'spec', width: 30 },
    { header: 'Value', key: 'value', width: 60 },
  ];
  styleHeader(specsSheet);
  const specs = product.specs && typeof product.specs === 'object' ? product.specs : {};
  for (const [k, v] of Object.entries(specs)) {
    specsSheet.addRow({ spec: k, value: String(v) });
  }

  const imagesSheet = wb.addWorksheet('Images');
  imagesSheet.columns = [
    { header: '#', key: 'idx', width: 6 },
    { header: 'URL', key: 'url', width: 80 },
  ];
  styleHeader(imagesSheet);
  const images = Array.isArray(product.images) ? product.images : [];
  images.forEach((url, i) => {
    const row = imagesSheet.addRow({ idx: i + 1, url });
    if (url) hyperlinkCell(row.getCell('url'), url);
  });

  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length) {
    const variantSheet = wb.addWorksheet('Variants');
    const attrKeys = new Set();
    variants.forEach((v) => {
      if (v && v.attributes) {
        Object.keys(v.attributes).forEach((k) => attrKeys.add(k));
      }
    });
    variantSheet.columns = [
      { header: 'SKU', key: 'sku', width: 20 },
      { header: 'Label', key: 'label', width: 40 },
      ...[...attrKeys].map((k) => ({ header: k, key: k, width: 20 })),
    ];
    styleHeader(variantSheet);
    variants.forEach((v) => {
      const row = { sku: v.sku || '', label: v.label || '' };
      const attrs = v.attributes || {};
      for (const k of attrKeys) row[k] = attrs[k] || '';
      variantSheet.addRow(row);
    });
  }

  return await wb.xlsx.writeBuffer();
}

module.exports = { productToWorkbookBuffer };
