// Pure block-page detector. Operates on the title + a short body sample —
// no DOM, no Puppeteer dependency, easy to unit-test.
//
// Returns:
//   { blocked: false }
// or
//   { blocked: true, reason: 'captcha' | 'access_denied' | 'http_error' | 'rate_limited' | 'empty', detail: string }
//
// We err on the side of *not* flagging a real page as blocked: if a signal is
// ambiguous (e.g. a product called "Robot Vacuum") the title regex still has
// to co-occur with a tiny body or a known-block phrase to trigger.

const TITLE_BLOCK_PATTERNS = [
  { re: /\brobot check\b/i, reason: 'captcha' },
  { re: /\bare you (a )?human\b/i, reason: 'captcha' },
  { re: /\bcaptcha\b/i, reason: 'captcha' },
  { re: /\baccess denied\b/i, reason: 'access_denied' },
  { re: /\b403\s*forbidden\b/i, reason: 'access_denied' },
  { re: /\bunusual traffic\b/i, reason: 'rate_limited' },
  { re: /\btoo many requests\b/i, reason: 'rate_limited' },
  { re: /\bblocked\b/i, reason: 'access_denied' },
  { re: /^attention required/i, reason: 'captcha' }, // Cloudflare default title
  { re: /^just a moment/i, reason: 'captcha' }, // Cloudflare interstitial
];

const BODY_BLOCK_PHRASES = [
  /verify (you('| a)re|that you are) (a )?human/i,
  /complete the security check/i,
  /enable javascript and cookies to continue/i,
  /your request has been blocked/i,
  /to discuss automated access to amazon data/i, // Amazon's specific block copy
  /please solve this puzzle/i,
];

const MIN_BODY_CHARS = 400;

function bodyTextSample(html) {
  // Strip tags + scripts, collapse whitespace, take first ~4 KB.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, 4000);
}

function detectBlock({ html, title, httpStatus }) {
  if (httpStatus && httpStatus >= 400 && httpStatus !== 404) {
    return {
      blocked: true,
      reason: 'http_error',
      detail: `HTTP ${httpStatus}`,
    };
  }

  const sample = bodyTextSample(html || '');

  if (title) {
    for (const { re, reason } of TITLE_BLOCK_PATTERNS) {
      if (re.test(title)) {
        return {
          blocked: true,
          reason,
          detail: `Page title matches "${title.trim().slice(0, 80)}"`,
        };
      }
    }
  }

  for (const re of BODY_BLOCK_PHRASES) {
    if (re.test(sample)) {
      return {
        blocked: true,
        reason: 'captcha',
        detail: `Body matches block phrase: ${re.source}`,
      };
    }
  }

  if (sample.length < MIN_BODY_CHARS) {
    return {
      blocked: true,
      reason: 'empty',
      detail: `Body text too short (${sample.length} chars)`,
    };
  }

  return { blocked: false };
}

module.exports = { detectBlock };
