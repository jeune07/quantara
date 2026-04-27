const express = require('express');
const { renderPage } = require('../extractor/fetchPage');
const { cleanHtml } = require('../extractor/cleanHtml');
const { htmlToMarkdown } = require('../extractor/htmlToMarkdown');
const { extractProduct } = require('../extractor/claudeExtract');
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

async function runPipeline(url) {
  let rendered;
  try {
    rendered = await renderPage(url);
  } catch (e) {
    const err = new Error(`Failed to render page: ${e.message}`);
    err.status = 502;
    throw err;
  }

  const cleaned = cleanHtml(rendered.html);
  const markdown = htmlToMarkdown(cleaned);

  let product;
  try {
    product = await extractProduct({
      markdown,
      sourceUrl: rendered.finalUrl || url,
      pageTitle: rendered.title,
    });
  } catch (e) {
    const err = new Error(`Anthropic extraction failed: ${e.message}`);
    err.status = 502;
    throw err;
  }

  return product;
}

router.post('/extract', async (req, res) => {
  const v = validateUrl(req.body && req.body.url);
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const product = await runPipeline(v.url);
    res.json({ product });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/extract.xlsx', async (req, res) => {
  const v = validateUrl(req.body && req.body.url);
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const product = await runPipeline(v.url);
    const buffer = await productToWorkbookBuffer(product);
    const filename =
      (product.sku || product.title || 'product')
        .replace(/[^a-z0-9_-]+/gi, '_')
        .slice(0, 60) + '.xlsx';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
