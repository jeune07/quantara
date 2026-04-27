// Stage 1 of deep discovery: ask Claude to plan a multi-query search
// strategy *before* executing any web_search. The output is an array of
// 4–6 search queries, each targeting a different stratum of the retailer
// space (exact-match, authorized-channel, marketplace, refurb,
// comparison-aggregator, wholesale, regional). Running queries from
// different strata in parallel gives much better coverage than one
// generic search.
//
// The plan is small (~300 output tokens) so it's cheap; the system prompt
// is cached so repeat invocations within the 5-min cache window are
// cheaper still.

const { getClient, MODEL, logUsage } = require('../utils/anthropic');

const MAX_TOKENS = 1024;

const STRATA = [
  'exact-match',
  'authorized-channel',
  'big-box-retail',
  'marketplace',
  'specialty-refurb',
  'wholesale-b2b',
  'wholesale-international',
  'comparison-aggregator',
  'regional',
];

const SYSTEM_PROMPT =
  'You plan multi-query search strategies for product discovery.\n\n' +
  'Given one product, produce 4–6 web search queries that together cover ' +
  'as much of the retailer space as possible. Each query MUST target a ' +
  'different stratum from this list:\n' +
  STRATA.map((s) => '  - ' + s).join('\n') +
  '\n\nRules:\n' +
  '- Diversify aggressively — do not produce two queries with overlapping ' +
  'intent. The goal is breadth, not redundancy.\n' +
  '- Use brand + model + the most distinguishing attribute (capacity, ' +
  'size, MPN) when you have them.\n' +
  '- For exact-match, prefer SKU/MPN if available.\n' +
  '- For marketplace and big-box-retail, you may use site: filters when ' +
  'helpful (e.g. "iphone X site:ebay.com").\n' +
  '- Skip strata that obviously don\'t apply (e.g. "wholesale-b2b" for a ' +
  'consumer fashion item, "carriers" for non-electronics) — fewer ' +
  'high-quality queries is better than padding.\n' +
  '- Always call record_query_plan exactly once.';

const recordQueryPlanTool = {
  name: 'record_query_plan',
  description: 'Record the planned set of search queries for product discovery.',
  input_schema: {
    type: 'object',
    required: ['queries'],
    properties: {
      queries: {
        type: 'array',
        items: {
          type: 'object',
          required: ['query', 'stratum'],
          properties: {
            query: { type: 'string', description: 'The search query string.' },
            stratum: {
              type: 'string',
              enum: STRATA,
              description: 'Which retailer-space stratum this query targets.',
            },
            rationale: {
              type: 'string',
              description: 'One short sentence on why this query is in the plan.',
            },
          },
        },
      },
    },
  },
};

function describeProduct(product) {
  const lines = [];
  if (product.title) lines.push('Title: ' + product.title);
  if (product.brand) lines.push('Brand: ' + product.brand);
  if (product.sku) lines.push('SKU / Part #: ' + product.sku);
  if (product.price && product.price.raw) lines.push('Price: ' + product.price.raw);
  if (product.sourceUrl) lines.push('Source URL: ' + product.sourceUrl);
  return lines.join('\n');
}

async function planSearchStrategy(product) {
  if (!product || (!product.title && !product.sku)) {
    throw new Error('planSearchStrategy needs a product with title or sku');
  }

  const userText =
    'Plan the discovery search queries for this product:\n\n' +
    describeProduct(product);

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [{ ...recordQueryPlanTool, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: 'record_query_plan' },
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
  });

  logUsage('plan', response.usage);

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || !Array.isArray(toolUse.input.queries)) {
    throw new Error('Planner did not return a queries array');
  }
  return normalizePlan(toolUse.input.queries);
}

// Defensive: cap at 6 queries, drop any with unknown stratum or empty
// query string, dedupe by query text.
function normalizePlan(rawQueries) {
  const seen = new Set();
  const out = [];
  for (const q of rawQueries) {
    if (!q || typeof q.query !== 'string') continue;
    const query = q.query.trim();
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    const stratum = STRATA.includes(q.stratum) ? q.stratum : 'exact-match';
    out.push({ query, stratum, rationale: q.rationale || '' });
    if (out.length >= 6) break;
  }
  return out;
}

module.exports = { planSearchStrategy, STRATA };
