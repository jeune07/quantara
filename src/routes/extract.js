const express = require('express');
const { extractFromUrl, ExtractError } = require('../extractor/extractFromUrl');
const { productToWorkbookBuffer } = require('../output/toExcel');

const router = express.Router();

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

function errorPayload(err) {
  if (err instanceof ExtractError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }
  return { status: 500, body: { error: err.message || 'Internal error' } };
}

router.post('/extract', async (req, res) => {
  const v = validateUrl(req.body && req.body.url);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const product = await extractFromUrl(v.url);
    res.json({ product });
  } catch (err) {
    const { status, body } = errorPayload(err);
    res.status(status).json(body);
  }
});

router.post('/extract.xlsx', async (req, res) => {
  const v = validateUrl(req.body && req.body.url);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const product = await extractFromUrl(v.url);
    const buffer = await productToWorkbookBuffer(product);
    const filename =
      (product.sku || product.title || 'product')
        .replace(/[^a-z0-9_-]+/gi, '_')
        .slice(0, 60) + '.xlsx';
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
