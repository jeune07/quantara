// Stage 2 of deep discovery: execute the planned queries in parallel.
//
// One Claude call per query, each call has access to the web_search
// server-side tool and a record_search_results custom tool. Calls run via
// Promise.all so wall-clock latency stays roughly constant in the number
// of queries — discovery for 5 queries takes ~the same time as 1.
//
// Each call returns up to 8 candidate URLs with retailer + confidence +
// reason metadata. We pool the results into one array; downstream stages
// (URL hygiene, categorization) operate on the pool.
//
// Per-query failures are isolated: if one search throws, the others still
// contribute. We log the failure and continue with what we got.

const { getClient, MODEL, logUsage } = require('../utils/anthropic');

const MAX_TOKENS = 1024;
const MAX_CANDIDATES_PER_QUERY = 8;

const SYSTEM_PROMPT =
  'You execute a single product-discovery web search and return candidate ' +
  'product pages.\n\n' +
  'Rules:\n' +
  '- Use web_search ONCE with the given query.\n' +
  '- From the results, pick up to ' + MAX_CANDIDATES_PER_QUERY + ' direct ' +
  'product pages on retailers (NOT category pages, NOT search results, ' +
  'NOT review/comparison articles).\n' +
  '- Skip the source domain provided by the user. Do not list the same ' +
  'retailer twice in your output.\n' +
  '- The product must match the source item — same brand and model. ' +
  'Variants (size, color, capacity, condition) are acceptable.\n' +
  '- When done, call record_search_results exactly once with the list. ' +
  'Do not return free-form text.';

const recordSearchResultsTool = {
  name: 'record_search_results',
  description: 'Record the URLs identified by this search query.',
  input_schema: {
    type: 'object',
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          required: ['url'],
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

async function runOneQuery({ query, stratum }, sourceUrl, productSummary) {
  const userText =
    'Source product (skip this domain): ' + (sourceUrl || '(none)') + '\n' +
    'Source product details:\n' + productSummary + '\n\n' +
    'Search query: ' + query + '\n' +
    'Stratum: ' + stratum + '\n' +
    'Run web_search once with this query, then call record_search_results ' +
    'with the candidate product pages found.';

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [webSearchTool, recordSearchResultsTool],
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
  });

  logUsage('search:' + stratum, response.usage);

  if (response.stop_reason === 'pause_turn') {
    throw new Error('search hit pause_turn for query "' + query + '"');
  }
  const toolUse = response.content.find(
    (b) => b.type === 'tool_use' && b.name === 'record_search_results'
  );
  if (!toolUse || !Array.isArray(toolUse.input.candidates)) {
    throw new Error('search did not record results for query "' + query + '"');
  }
  return toolUse.input.candidates.map((c) => ({
    ...c,
    foundByStratum: stratum,
    foundByQuery: query,
  }));
}

function describeProduct(product) {
  const lines = [];
  if (product.title) lines.push('Title: ' + product.title);
  if (product.brand) lines.push('Brand: ' + product.brand);
  if (product.sku) lines.push('SKU / Part #: ' + product.sku);
  if (product.price && product.price.raw) lines.push('Price: ' + product.price.raw);
  return lines.join('\n');
}

async function runSearchPasses(queries, product) {
  if (!Array.isArray(queries) || queries.length === 0) return [];

  const productSummary = describeProduct(product);
  const sourceUrl = product.sourceUrl || '';

  const results = await Promise.allSettled(
    queries.map((q) => runOneQuery(q, sourceUrl, productSummary))
  );

  const pool = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      pool.push(...r.value);
    } else {
      console.warn('[runSearchPasses] query failed:', r.reason && r.reason.message);
    }
  }
  return pool;
}

module.exports = { runSearchPasses };
