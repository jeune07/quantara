// Orchestrator. Single entry point used by the routes. Owns the strategy:
//
//   1. Render with stealth Puppeteer (smart waits live in fetchPage/pageReady).
//   2. Block-detect on the rendered HTML+title. If blocked, throw a typed 502
//      so the caller never feeds garbage to Claude.
//   3. Try text extraction (Markdown → Claude with tool_use).
//   4. If the text result is too thin to be useful AND we have a screenshot,
//      retry with vision and merge the richer of the two.
//
// Each strategy step is small, named for what it does, and lives in its own
// file. The orchestrator is the only place where steps are composed.

const { renderPage } = require('./fetchPage');
const { detectBlock } = require('./blockDetect');
const { cleanHtml } = require('./cleanHtml');
const { htmlToMarkdown } = require('./htmlToMarkdown');
const { extractFromText, extractFromImage } = require('./claudeExtract');

const MIN_USEFUL_MARKDOWN_CHARS = 500;

// "Useful" = enough signal that we trust the text-only extraction. Tunable
// from one place; if you want to be more aggressive about vision fallback,
// raise the bar here.
function isUseful(product) {
  if (!product || typeof product !== 'object') return false;
  if (!product.title || !product.title.trim()) return false;
  const hasDescription =
    typeof product.description === 'string' && product.description.trim().length > 20;
  const hasSpecs =
    product.specs && typeof product.specs === 'object' && Object.keys(product.specs).length > 0;
  const hasPrice = product.price && (product.price.raw || product.price.amount);
  // Title plus at least one substantive field.
  return hasDescription || hasSpecs || hasPrice;
}

// Field-by-field merge: prefer the value that has more information.
function richer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (typeof a === 'string' && typeof b === 'string') {
    return b.trim().length > a.trim().length ? b : a;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return b.length > a.length ? b : a;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return Object.keys(b).length > Object.keys(a).length ? b : a;
  }
  return a;
}

function mergeProducts(textProduct, visionProduct) {
  const merged = { ...textProduct };
  for (const key of Object.keys(visionProduct)) {
    merged[key] = richer(merged[key], visionProduct[key]);
  }
  return merged;
}

class ExtractError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function extractFromUrl(url) {
  let rendered;
  try {
    rendered = await renderPage(url);
  } catch (e) {
    throw new ExtractError(`Failed to render page: ${e.message}`, 502, 'render_failed');
  }
  const sourceUrl = rendered.finalUrl || url;

  const block = detectBlock({
    html: rendered.html,
    title: rendered.title,
    httpStatus: rendered.httpStatus,
  });

  // For empty/short pages we can still try vision — there might be content
  // baked into the screenshot that the DOM doesn't expose. For active blocks
  // (captcha, access denied, HTTP error) we bail; vision can't see past them.
  const isHardBlock =
    block.blocked && block.reason !== 'empty';
  if (isHardBlock) {
    throw new ExtractError(
      `Page is blocked (${block.reason}): ${block.detail}`,
      502,
      `blocked_${block.reason}`
    );
  }

  const cleaned = cleanHtml(rendered.html);
  const markdown = htmlToMarkdown(cleaned);

  let textProduct = null;
  let textError = null;
  const markdownLooksThin =
    !markdown || markdown.trim().length < MIN_USEFUL_MARKDOWN_CHARS;

  if (!markdownLooksThin) {
    try {
      textProduct = await extractFromText({
        markdown,
        sourceUrl,
        pageTitle: rendered.title,
      });
    } catch (e) {
      textError = e;
      console.warn(`[extractFromUrl] text path failed: ${e.message}`);
    }
  }

  if (textProduct && isUseful(textProduct)) {
    return { ...textProduct, extractionMode: 'text' };
  }

  // Fallback: vision. Available iff we actually captured a screenshot.
  if (!rendered.screenshot) {
    if (textProduct) {
      return { ...textProduct, extractionMode: 'text-low-confidence' };
    }
    throw (
      textError ||
      new ExtractError(
        'Page produced no usable text and no screenshot was available',
        502,
        'no_signal'
      )
    );
  }

  let visionProduct;
  try {
    visionProduct = await extractFromImage({
      screenshot: rendered.screenshot,
      sourceUrl,
      pageTitle: rendered.title,
      markdownHint: markdown,
    });
  } catch (e) {
    if (textProduct) {
      return { ...textProduct, extractionMode: 'text-low-confidence' };
    }
    throw new ExtractError(
      `Vision extraction failed: ${e.message}`,
      502,
      'vision_failed'
    );
  }

  if (textProduct) {
    return {
      ...mergeProducts(textProduct, visionProduct),
      extractionMode: 'hybrid',
    };
  }
  return { ...visionProduct, extractionMode: 'vision' };
}

module.exports = { extractFromUrl, ExtractError };
