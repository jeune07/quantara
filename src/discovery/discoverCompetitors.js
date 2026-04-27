// Cross-retailer discovery — orchestrator.
//
// Given one extracted product, find pages on *other* retailers selling the
// same item. Stages:
//
//   1. Ask Claude (with the web_search server-side tool) to discover
//      candidate URLs and emit them via the record_competitors custom tool.
//   2. URL hygiene: filterCandidateUrls drops search/category/blog pages,
//      enforces per-retailer product-page patterns, dedupes by hostname,
//      and excludes the source domain.
//   3. Taxonomy: categorizeRetailer tags each survivor with a category
//      (authorized / big-box / marketplace / specialty-refurb / wholesale-
//      b2b / wholesale-international / fashion / home / outdoor-sports /
//      auto / carriers / books / office / long-tail).
//
// Returns enriched candidate objects ready for the UI to queue through
// /api/extract:
//   { url, retailer, category, tier, trust, confidence, reason }
//
// Stages 2–3 run as pure code on Claude's output, so the UI sees clean
// data even if Claude's discovery overshoots or returns junk URLs.

const { getClient, MODEL, logUsage } = require('../utils/anthropic');
const { filterCandidateUrls, hostnameOf } = require('./filterCandidateUrls');
const { categorizeUrl } = require('./categorizeRetailer');

const MAX_TOKENS = 2048;

const SYSTEM_PROMPT =
  'You are a product-discovery assistant. The user provides one product;\n' +
  'your job is to find that same product on OTHER retail websites.\n\n' +
  'Rules:\n' +
  '- Use web_search as many times as needed to discover candidate pages.\n' +
  '- Each candidate must be a direct PRODUCT PAGE (not a category page,\n' +
  '  not a search-results page, not a review article).\n' +
  '- Each candidate must be a different retailer from the source. Do not\n' +
  '  list the source domain itself, and do not list the same retailer twice.\n' +
  '- Match identity precisely: same brand and model. Variants (size, color,\n' +
  '  pack quantity) are acceptable as long as the base product is the same.\n' +
  '- Aim for 3–8 high-quality candidates. Fewer is fine if quality is thin.\n' +
  '- When you are done searching, you MUST call record_competitors exactly\n' +
  '  once with the structured list. Do not return a free-text answer.';

const recordCompetitorsTool = {
  name: 'record_competitors',
  description:
    'Record the discovered competitor product pages. Each entry is one ' +
    'retailer selling the same product as the source.',
  input_schema: {
    type: 'object',
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          required: ['url', 'retailer'],
          properties: {
            url: { type: 'string' },
            retailer: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason: { type: 'string' },
          },
        },
      },
    },
  },
};

const webSearchTool = { type: 'web_search_20260209', name: 'web_search' };

function describeProduct(product) {
  const lines = [];
  if (product.title) lines.push('Title: ' + product.title);
  if (product.brand) lines.push('Brand: ' + product.brand);
  if (product.sku) lines.push('SKU / Part #: ' + product.sku);
  if (product.price && product.price.raw) lines.push('Price: ' + product.price.raw);
  if (product.sourceUrl) lines.push('Source URL: ' + product.sourceUrl);
  return lines.join('\n');
}

async function callClaude(product) {
  const sourceHost = hostnameOf(product.sourceUrl || '');
  const userText =
    'Find this product on other retailers. Skip the source domain itself' +
    (sourceHost ? ' (' + sourceHost + ')' : '') +
    '.\n\n' +
    describeProduct(product);

  const c = getClient();
  const response = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [webSearchTool, recordCompetitorsTool],
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
  });

  logUsage('discover', response.usage);

  if (response.stop_reason === 'pause_turn') {
    throw new Error(
      'Discovery hit the server-side tool iteration limit. Try again with ' +
        'a more specific product (brand + SKU work best).'
    );
  }
  const toolUse = response.content.find(
    (b) => b.type === 'tool_use' && b.name === 'record_competitors'
  );
  if (!toolUse) {
    throw new Error('Claude finished without calling record_competitors. Try again.');
  }
  return Array.isArray(toolUse.input.candidates) ? toolUse.input.candidates : [];
}

// Public entry point used by the route. Composes the three stages.
async function discoverCompetitors(product) {
  if (!product || (!product.title && !product.sku)) {
    throw new Error('discoverCompetitors requires a product with at least a title or sku');
  }

  const raw = await callClaude(product);

  // Stage 2: URL hygiene. We feed only the URLs through the filter so we
  // can re-attach Claude's per-candidate metadata afterwards.
  const byUrl = new Map(raw.map((c) => [c.url, c]));
  const cleanUrls = filterCandidateUrls(
    raw.map((c) => c && c.url).filter(Boolean),
    product.sourceUrl
  );

  // Stage 3: categorize.
  return cleanUrls.map((url) => {
    const meta = byUrl.get(url) || {};
    const category = categorizeUrl(url);
    return {
      url,
      retailer: meta.retailer || category.name,
      category: category.category,
      tier: category.tier,
      trust: category.trust,
      confidence: meta.confidence || 'medium',
      reason: meta.reason || '',
    };
  });
}

module.exports = { discoverCompetitors };
