// Cross-retailer discovery.
//
// Given one extracted product, find pages on *other* retailers selling the
// same item. We let Claude drive: it has the web_search server-side tool
// for discovery and a custom record_competitors tool for the structured
// reply. The orchestrator (route) feeds the candidates back through
// /api/extract so the user ends up with an extracted batch they can group
// + summarize.
//
// Output is a list of {url, retailer, confidence, reason} objects.
// Defensive cleanup: dedupes by hostname, drops candidates that share a
// hostname with the source, drops anything that fails URL parsing.

const { getClient, MODEL, logUsage } = require('../utils/anthropic');

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
            url: {
              type: 'string',
              description: 'Direct URL to the product page on the retailer.',
            },
            retailer: {
              type: 'string',
              description:
                'Retailer name (e.g. "Amazon", "Best Buy", "Sony Direct").',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description:
                'How confident you are this is the same product as the source.',
            },
            reason: {
              type: 'string',
              description:
                'One short sentence on why this is a match (matching SKU, ' +
                'brand+model, or other evidence).',
            },
          },
        },
      },
    },
  },
};

const webSearchTool = { type: 'web_search_20260209', name: 'web_search' };

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

// Build a compact "this is the product" block for Claude. Skip description
// and full specs — title + brand + sku is enough to fingerprint.
function describeProduct(product) {
  const lines = [];
  if (product.title) lines.push('Title: ' + product.title);
  if (product.brand) lines.push('Brand: ' + product.brand);
  if (product.sku) lines.push('SKU / Part #: ' + product.sku);
  if (product.price && product.price.raw) lines.push('Price: ' + product.price.raw);
  if (product.sourceUrl) lines.push('Source URL: ' + product.sourceUrl);
  return lines.join('\n');
}

async function findCompetitors(product) {
  if (!product || (!product.title && !product.sku)) {
    throw new Error('findCompetitors requires a product with at least a title or sku');
  }

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

  logUsage('find-competitors', response.usage);

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
    throw new Error(
      'Claude finished without calling record_competitors. Try again.'
    );
  }

  const raw = Array.isArray(toolUse.input.candidates) ? toolUse.input.candidates : [];
  return cleanCandidates(raw, sourceHost);
}

// Defensive normalization. Bad URLs, source-domain leakage, and per-hostname
// duplicates all get dropped. Order is preserved (Claude's ranking).
function cleanCandidates(rawCandidates, sourceHost) {
  const seenHosts = new Set();
  if (sourceHost) seenHosts.add(sourceHost);
  const out = [];
  for (const c of rawCandidates) {
    if (!c || typeof c !== 'object' || !c.url) continue;
    const host = hostnameOf(c.url);
    if (!host) continue;
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    out.push({
      url: c.url,
      retailer: c.retailer || host,
      confidence: c.confidence || 'medium',
      reason: c.reason || '',
    });
  }
  return out;
}

module.exports = { findCompetitors };
