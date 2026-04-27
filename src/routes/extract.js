const express = require('express');
const multer = require('multer');
const { extractFromUrl, ExtractError } = require('../extractor/extractFromUrl');
const { extractFromPdf } = require('../extractor/extractFromPdf');
const { productsToWorkbookBuffer } = require('../output/toExcel');
const {
  recordSnapshot,
  getLatestSnapshot,
  getHistory,
  computeDelta,
} = require('../db/snapshots');

const router = express.Router();

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
});

const MAX_PRODUCTS_PER_WORKBOOK = 500;

function validateUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { error: 'url is required' };
  }
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: 'url is not a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'url must use http or https' };
  }
  return { url: parsed.toString() };
}

function validateProducts(raw) {
  if (!Array.isArray(raw)) return { error: 'products must be an array' };
  if (raw.length === 0) return { error: 'products array is empty' };
  if (raw.length > MAX_PRODUCTS_PER_WORKBOOK) {
    return { error: `at most ${MAX_PRODUCTS_PER_WORKBOOK} products per workbook` };
  }
  for (const [i, p] of raw.entries()) {
    if (!p || typeof p !== 'object') {
      return { error: `products[${i}] is not an object` };
    }
    if (!p.title && !p.sku) {
      return { error: `products[${i}] needs at least a title or SKU` };
    }
  }
  return { products: raw };
}

function workbookFilename(products) {
  if (products.length === 1) {
    const p = products[0];
    const stem = (p.sku || p.title || 'product')
      .replace(/[^a-z0-9_-]+/gi, '_')
      .slice(0, 60);
    return `${stem}.xlsx`;
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `quantara-${products.length}-products-${stamp}.xlsx`;
}

function errorPayload(err) {
  if (err instanceof ExtractError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }
  return { status: 500, body: { error: err.message || 'Internal error' } };
}

// Run a side-effect that should never fail the main request. We log and
// swallow — the user's extraction is more important than the snapshot.
function safeCall(fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[extract] persistence error:', err.message);
    return null;
  }
}

router.post('/extract', async (req, res) => {
  const v = validateUrl(req.body && req.body.url);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    // Order matters: read the prior snapshot *before* writing the new one
    // so the delta compares to history, not to itself.
    const previous = safeCall(() => getLatestSnapshot(v.url));
    const product = await extractFromUrl(v.url);
    const delta = previous ? computeDelta(previous, product) : null;
    safeCall(() => recordSnapshot(product));
    res.json({ product, history: { previous, delta } });
  } catch (err) {
    const { status, body } = errorPayload(err);
    res.status(status).json(body);
  }
});

router.post('/extract-pdf', upload.single('file'), async (req, res) => {
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({ error: 'file is required (multipart field "file")' });
  }
  try {
    const products = await extractFromPdf(req.file.buffer, req.file.originalname);
    res.json({ products, filename: req.file.originalname });
  } catch (err) {
    const { status, body } = errorPayload(err);
    res.status(status).json(body);
  }
});

router.get('/history', (req, res) => {
  const v = validateUrl(req.query && req.query.url);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const history = getHistory(v.url, 50);
    res.json({ url: v.url, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workbook', async (req, res) => {
  const v = validateProducts(req.body && req.body.products);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const buffer = await productsToWorkbookBuffer(v.products);
    const filename = workbookFilename(v.products);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    const { status, body } = errorPayload(err);
    res.status(status).json(body);
  }
});

module.exports = router;
