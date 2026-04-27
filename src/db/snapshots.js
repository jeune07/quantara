// All persistence for product extractions lives here.
//
// recordSnapshot(product) — insert one row.
// getLatestSnapshot(url)  — most recent snapshot for a URL, or null.
// getHistory(url, limit)  — chronological history (newest first).
// computeDelta(prev, curr) — pure helper, no DB access. Diffs price /
//                            availability between two snapshots so the route
//                            can return it to the client.

const { getDb } = require('./database');

function priceAmount(product) {
  const p = product && product.price;
  if (p && typeof p.amount === 'number') return p.amount;
  return null;
}

function priceCurrency(product) {
  const p = product && product.price;
  return (p && p.currency) || null;
}

function priceRaw(product) {
  const p = product && product.price;
  return (p && p.raw) || null;
}

function recordSnapshot(product) {
  if (!product || !product.sourceUrl) return null;
  const stmt = getDb().prepare(`
    INSERT INTO extractions (
      source_url, sku, title,
      price_amount, price_currency, price_raw,
      availability, extraction_mode, product_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    product.sourceUrl,
    product.sku || null,
    product.title || null,
    priceAmount(product),
    priceCurrency(product),
    priceRaw(product),
    product.availability || null,
    product.extractionMode || null,
    JSON.stringify(product)
  );
  return info.lastInsertRowid;
}

function rowToSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceUrl: row.source_url,
    sku: row.sku,
    title: row.title,
    priceAmount: row.price_amount,
    priceCurrency: row.price_currency,
    priceRaw: row.price_raw,
    availability: row.availability,
    extractionMode: row.extraction_mode,
    extractedAt: row.extracted_at,
  };
}

function getLatestSnapshot(sourceUrl) {
  const row = getDb()
    .prepare(
      `SELECT * FROM extractions
        WHERE source_url = ?
        ORDER BY extracted_at DESC, id DESC
        LIMIT 1`
    )
    .get(sourceUrl);
  return rowToSnapshot(row);
}

function getHistory(sourceUrl, limit = 50) {
  const rows = getDb()
    .prepare(
      `SELECT * FROM extractions
        WHERE source_url = ?
        ORDER BY extracted_at DESC, id DESC
        LIMIT ?`
    )
    .all(sourceUrl, limit);
  return rows.map(rowToSnapshot);
}

function computeDelta(prev, curr) {
  if (!prev || !curr) return null;
  const delta = { since: prev.extractedAt };
  let any = false;

  const prevPrice = prev.priceAmount;
  const currPrice =
    curr && curr.price && typeof curr.price.amount === 'number'
      ? curr.price.amount
      : null;
  if (prevPrice != null && currPrice != null && prevPrice !== currPrice) {
    delta.priceFrom = prevPrice;
    delta.priceTo = currPrice;
    delta.priceChange = currPrice - prevPrice;
    delta.pricePercent = prevPrice === 0 ? null : (delta.priceChange / prevPrice) * 100;
    any = true;
  }

  const prevAvail = prev.availability || '';
  const currAvail = (curr && curr.availability) || '';
  if (prevAvail && currAvail && prevAvail !== currAvail) {
    delta.availabilityFrom = prevAvail;
    delta.availabilityTo = currAvail;
    any = true;
  }

  return any ? delta : null;
}

module.exports = {
  recordSnapshot,
  getLatestSnapshot,
  getHistory,
  computeDelta,
};
