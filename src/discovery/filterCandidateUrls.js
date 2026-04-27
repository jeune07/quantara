// Pure-code URL hygiene. Given a list of raw candidate URLs, return only
// the ones that look like product pages on retailers we'd actually want
// to extract.
//
// Three layers:
//   1. Reject patterns: search results, blogs, category pages, FAQ.
//   2. Per-retailer accept patterns: Amazon /dp/, Best Buy /site/.../<id>.p, etc.
//   3. Generic accept fallback: any URL whose path contains /product/, /p/,
//      /item/, /listing/, /pd/, /dp/, or /itm/ with a numeric / mixed-case
//      ID segment is treated as a product page.
//
// Then dedupe by hostname (one canonical URL per retailer) and drop the
// source domain itself.

const REJECT_PATH_PATTERNS = [
  /\/search(\/|$)/i,
  /\/s\?/,                 // amazon search
  /\/blog(\/|$)/i,
  /\/news(\/|$)/i,
  /\/article(s)?(\/|$)/i,
  /\/review(s)?(\/|$)/i,
  /\/guide(s)?(\/|$)/i,
  /\/c(at(egory|egories)?)?(\/|$)/i,
  /\/collections?(\/|$)/i,
  /\/compare(\/|$)/i,
  /\/vs(\/|$)/i,
  /\/comparison(\/|$)/i,
  /\/help(\/|$)/i,
  /\/support(\/|$)/i,
  /\/customer-service(\/|$)/i,
  /\/faq(\/|$)/i,
  /\/about(\/|$)/i,
  /\/policies(\/|$)/i,
  /\/legal(\/|$)/i,
];

const REJECT_QUERY_PATTERNS = [
  /[?&]q=/i,
  /[?&]search=/i,
  /[?&]keyword=/i,
  /[?&]query=/i,
];

// Per-retailer "this is definitely a product page" patterns. Anchor with
// a leading slash so a token like /dp/ matches /dp/B07ABC but not /...dp/.
const RETAILER_PRODUCT_PATTERNS = {
  'amazon.com':   [/\/dp\/[A-Z0-9]{6,}/i, /\/gp\/product\/[A-Z0-9]{6,}/i],
  'bestbuy.com':  [/\/site\/.+\d{6,}\.p/i],
  'walmart.com':  [/\/ip\/.+\/?\d{4,}/i],
  'target.com':   [/\/p\/.+\/A-\d+/i],
  'ebay.com':     [/\/itm\/\d+/i],
  'etsy.com':     [/\/listing\/\d+/i],
  'homedepot.com':[/\/p\/.+\/\d+/i],
  'lowes.com':    [/\/pd\/.+\/\d+/i],
  'costco.com':   [/\/.+\.product\.\d+\.html/i],
  'newegg.com':   [/\/p\/[A-Z0-9-]+/i],
  'macys.com':    [/\/shop\/product\//i],
  'kohls.com':    [/\/product\//i],
  'rakuten.com':  [/\/shop\/.+\/product\//i],
  'wayfair.com':  [/\/.+\/pdp\//i],
  'mcmaster.com': [/\/[0-9]{4,7}[A-Z][A-Z0-9]{1,8}/],
  'grainger.com': [/\/product\//i],
};

const GENERIC_PRODUCT_PATTERNS = [
  /\/product(s)?\/[^\/?#]+/i,
  /\/item\/[^\/?#]+/i,
  /\/listing\/[^\/?#]+/i,
  /\/p\/[^\/?#]+\/[^\/?#]+/i, // e.g. /p/foo/bar
  /\/pd\/[^\/?#]+/i,
  /\/dp\/[A-Z0-9]{6,}/i,
  /\/itm\/\d+/i,
  /\/sku\/[^\/?#]+/i,
];

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function isRejected(parsed) {
  for (const re of REJECT_PATH_PATTERNS) if (re.test(parsed.pathname)) return true;
  for (const re of REJECT_QUERY_PATTERNS) if (re.test(parsed.search)) return true;
  return false;
}

function findRetailerKey(host) {
  if (!host) return null;
  let h = host;
  while (h.includes('.')) {
    if (RETAILER_PRODUCT_PATTERNS[h]) return h;
    h = h.replace(/^[^.]+\./, '');
  }
  return null;
}

function looksLikeProductPage(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  if (isRejected(parsed)) return false;

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  const retailerKey = findRetailerKey(host);
  if (retailerKey) {
    return RETAILER_PRODUCT_PATTERNS[retailerKey].some((re) => re.test(parsed.pathname));
  }
  // Unknown retailer: fall back to generic product-page heuristic.
  return GENERIC_PRODUCT_PATTERNS.some((re) => re.test(parsed.pathname));
}

// Main entry point. urls is an array of raw URL strings; sourceUrl (when
// provided) is the host we're extracting from — that domain is excluded
// from the candidate set so we don't suggest the same retailer the user
// already has.
function filterCandidateUrls(urls, sourceUrl) {
  const sourceHost = hostnameOf(sourceUrl || '');
  const seenHosts = new Set();
  if (sourceHost) seenHosts.add(sourceHost);

  const kept = [];
  for (const u of urls) {
    if (typeof u !== 'string' || !u) continue;
    if (!looksLikeProductPage(u)) continue;
    const host = hostnameOf(u);
    if (!host) continue;
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    kept.push(u);
  }
  return kept;
}

module.exports = {
  filterCandidateUrls,
  looksLikeProductPage,
  hostnameOf,
  REJECT_PATH_PATTERNS,
  RETAILER_PRODUCT_PATTERNS,
  GENERIC_PRODUCT_PATTERNS,
};
