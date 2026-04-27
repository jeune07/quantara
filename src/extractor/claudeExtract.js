const Anthropic = require('@anthropic-ai/sdk');
const { recordProductTool } = require('./productSchema');

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT =
  'You extract structured product information from a single product page.\n\n' +
  'You will be given the page content rendered as Markdown. Identify the product on ' +
  'that page and call the record_product tool with the fields you can read off the ' +
  'page. Rules:\n\n' +
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

async function extractProduct({ markdown, sourceUrl, pageTitle }) {
  const c = getClient();

  const userText =
    `Source URL: ${sourceUrl}\n` +
    (pageTitle ? `Page <title>: ${pageTitle}\n` : '') +
    '\n--- BEGIN PAGE MARKDOWN ---\n' +
    markdown +
    '\n--- END PAGE MARKDOWN ---';

  const response = await c.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        ...recordProductTool,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_product' },
    messages: [{ role: 'user', content: userText }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return a tool_use block');
  }

  const product = { ...toolUse.input, sourceUrl };

  const usage = response.usage || {};
  console.log(
    `[claudeExtract] tokens: input=${usage.input_tokens || 0} ` +
      `cache_read=${usage.cache_read_input_tokens || 0} ` +
      `cache_create=${usage.cache_creation_input_tokens || 0} ` +
      `output=${usage.output_tokens || 0}`
  );

  return product;
}

module.exports = { extractProduct, MODEL };
