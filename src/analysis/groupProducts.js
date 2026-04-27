// Cross-marketplace identity grouping.
//
// Takes a batch of already-extracted products and asks Claude to cluster
// them by canonical product identity — same physical product across
// retailers and across variants (size/color/pack). The reply is an array
// of groups: { canonicalName, memberIndices, confidence, reason }.
//
// To keep the request small we send a compact projection per product
// (index, title, sku, brand, price, sourceUrl). Descriptions and full
// specs are intentionally omitted.

const { getClient, MODEL, logUsage } = require('../utils/anthropic');

const MAX_TOKENS = 4096;

const SYSTEM_PROMPT =
  'You group product extractions by canonical product identity.\n\n' +
  '- Same physical product sold by different retailers → same group.\n' +
  '- Different size / color / pack quantity of the same base product →\n' +
  '  same group; the canonical name describes the base.\n' +
  '- Different products → separate groups (singletons are fine).\n' +
  '- Prefer precision over recall: if uncertain, keep them separate.\n' +
  '- Use brand+model fingerprints, SKU/MPN matches, distinctive specs,\n' +
  '  and near-identical titles as evidence. Source URL domain is a hint,\n' +
  '  never proof.\n' +
  '- Every input index must appear in exactly one group.\n' +
  '- Always call the tool exactly once.';

const groupProductsTool = {
  name: 'record_groups',
  description: 'Record the grouping of products by canonical identity.',
  input_schema: {
    type: 'object',
    required: ['groups'],
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          required: ['canonicalName', 'memberIndices'],
          properties: {
            canonicalName: {
              type: 'string',
              description:
                'Concise canonical name shared by all members (e.g. ' +
                '"Apple AirPods Pro 2nd Gen").',
            },
            memberIndices: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Zero-based indices into the input list.',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
            },
            reason: {
              type: 'string',
              description:
                'One short sentence on what evidence ties them together.',
            },
          },
        },
      },
    },
  },
};

function compactProduct(p, i) {
  return {
    index: i,
    title: (p.title || '').slice(0, 200),
    sku: p.sku || '',
    brand: p.brand || '',
    price: p.price && p.price.raw ? p.price.raw : '',
    sourceUrl: p.sourceUrl || '',
  };
}

async function groupProducts(products) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('groupProducts requires a non-empty array');
  }
  if (products.length === 1) {
    return [
      {
        canonicalName: products[0].title || 'Product',
        memberIndices: [0],
        confidence: 'high',
        reason: 'Only one product in the batch.',
      },
    ];
  }

  const compact = products.map(compactProduct);
  const userText =
    'Cluster these ' + products.length + ' products by canonical identity. ' +
    'Use the indices below as memberIndices.\n\n' +
    JSON.stringify(compact, null, 2);

  const c = getClient();
  const response = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [{ ...groupProductsTool, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: 'record_groups' },
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
  });

  logUsage('group', response.usage);

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || !Array.isArray(toolUse.input.groups)) {
    throw new Error('Claude did not return a groups array');
  }
  return normalizeGroups(toolUse.input.groups, products.length);
}

// Defensive: clamp out-of-range indices, dedupe, and ensure every product
// ends up in some group. Anything Claude missed becomes its own singleton.
function normalizeGroups(rawGroups, n) {
  const seen = new Set();
  const groups = [];

  for (const g of rawGroups) {
    const indices = (g.memberIndices || [])
      .map((i) => Number(i))
      .filter((i) => Number.isInteger(i) && i >= 0 && i < n)
      .filter((i) => {
        if (seen.has(i)) return false;
        seen.add(i);
        return true;
      });
    if (indices.length === 0) continue;
    groups.push({
      canonicalName: g.canonicalName || 'Group',
      memberIndices: indices,
      confidence: g.confidence || 'medium',
      reason: g.reason || '',
    });
  }

  for (let i = 0; i < n; i++) {
    if (!seen.has(i)) {
      groups.push({
        canonicalName: 'Ungrouped #' + (i + 1),
        memberIndices: [i],
        confidence: 'low',
        reason: 'Not placed by the grouping pass; defaulted to singleton.',
      });
    }
  }
  return groups;
}

module.exports = { groupProducts };
