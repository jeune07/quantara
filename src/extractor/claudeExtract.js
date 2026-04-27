const Anthropic = require('@anthropic-ai/sdk');
const { recordProductTool, recordProductsTool } = require('./productSchema');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT =
  'You extract structured product information from a single product page.\n\n' +
  'You will be given the page content (as Markdown text and/or as a screenshot). ' +
  'Identify the product on that page and call the record_product tool with the ' +
  'fields you can read off the page. Rules:\n\n' +
  '- Only include data that is visibly present. Never fabricate prices, SKUs, ' +
  'specs, or descriptions.\n' +
  '- For specs, copy the labels as they appear on the page.\n' +
  '- For images, use absolute URLs. Skip favicons, logos, and decorative ' +
  'icons — only include images of the product itself.\n' +
  '- If the page is a category/listing page rather than a single product, pick ' +
  'the most prominent product and extract that one.\n' +
  '- If a field is not present, omit it or leave it as an empty string/object/array. ' +
  'Do not guess.\n' +
  '- Always call the tool exactly once.';

let client;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic();
  }
  return client;
}

function logUsage(label, usage) {
  if (!usage) return;
  console.log(
    `[claudeExtract:${label}] tokens: input=${usage.input_tokens || 0} ` +
      `cache_read=${usage.cache_read_input_tokens || 0} ` +
      `cache_create=${usage.cache_creation_input_tokens || 0} ` +
      `output=${usage.output_tokens || 0}`
  );
}

// Both extract paths share the same system prompt + tool — Anthropic prompt
// caching covers both, so back-to-back text and vision calls share the cached
// prefix.
async function callClaude({ userContent, label }) {
  const c = getClient();
  const response = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [{ ...recordProductTool, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: 'record_product' },
    messages: [{ role: 'user', content: userContent }],
  });

  logUsage(label, response.usage);

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return a tool_use block');
  }
  return toolUse.input;
}

async function extractFromText({ markdown, sourceUrl, pageTitle }) {
  const text =
    `Source URL: ${sourceUrl}\n` +
    (pageTitle ? `Page <title>: ${pageTitle}\n` : '') +
    '\n--- BEGIN PAGE MARKDOWN ---\n' +
    markdown +
    '\n--- END PAGE MARKDOWN ---';

  const input = await callClaude({
    userContent: [{ type: 'text', text }],
    label: 'text',
  });
  return { ...input, sourceUrl };
}

// Multi-product extraction — used for catalog inputs (PDFs today; could
// also fit a category-listing page later). Reuses the same system prompt
// and the same cache_control prefix as extractFromText, so back-to-back
// calls amortize.
async function extractProductsFromCatalog({ text, sourceLabel }) {
  const c = getClient();
  const userText =
    `Source: ${sourceLabel || '(unlabeled catalog)'}\n` +
    'The text below is a catalog or price list. Identify every distinct ' +
    'product and call record_products once with an array of all of them.\n' +
    '\n--- BEGIN CATALOG TEXT ---\n' +
    text +
    '\n--- END CATALOG TEXT ---';

  const response = await c.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [{ ...recordProductsTool, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: 'record_products' },
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
  });

  logUsage('catalog', response.usage);

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || !Array.isArray(toolUse.input.products)) {
    throw new Error('Claude did not return a products array');
  }
  return toolUse.input.products.map((p) => ({ ...p, sourceUrl: sourceLabel || '' }));
}

async function extractFromImage({ screenshot, sourceUrl, pageTitle, markdownHint }) {
  const blocks = [
    {
      type: 'text',
      text:
        `Source URL: ${sourceUrl}\n` +
        (pageTitle ? `Page <title>: ${pageTitle}\n` : '') +
        'Page text was unavailable or unhelpful — extract what you can see in ' +
        'the screenshot below.',
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: screenshot.toString('base64'),
      },
    },
  ];
  if (markdownHint && markdownHint.trim()) {
    blocks.push({
      type: 'text',
      text:
        '\nFor reference, here is whatever readable text we did capture from ' +
        'the page (may be partial or empty):\n\n' +
        markdownHint.slice(0, 8000),
    });
  }

  const input = await callClaude({ userContent: blocks, label: 'vision' });
  return { ...input, sourceUrl };
}

module.exports = {
  extractFromText,
  extractFromImage,
  extractProductsFromCatalog,
  MODEL,
};
