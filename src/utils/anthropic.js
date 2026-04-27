// Single Anthropic client + model constant. Imported by both the extractor
// (URL → product, PDF → products) and the analysis layer (group, future:
// categorize, audit, etc.) so model upgrades happen in one place.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';

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
    `[anthropic:${label}] tokens: input=${usage.input_tokens || 0} ` +
      `cache_read=${usage.cache_read_input_tokens || 0} ` +
      `cache_create=${usage.cache_creation_input_tokens || 0} ` +
      `output=${usage.output_tokens || 0}`
  );
}

module.exports = { getClient, MODEL, logUsage };
