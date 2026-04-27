// Pure function: hostname → retailer metadata.
//
// Looks up a hostname in retailerTaxonomy.json. The taxonomy uses
// registrable-domain keys (e.g. "amazon.com" not "www.amazon.com" and not
// "smile.amazon.com"); we strip a leading "www." and try the full host
// first, then fall back to the registrable domain.
//
// Anything not in the taxonomy is reported as the catch-all "long-tail"
// category — kept in the candidate list with a warning so the user knows
// these need a closer look.

const taxonomy = require('./retailerTaxonomy.json');

const LONG_TAIL = {
  category: 'long-tail',
  tier: 3,
  trust: 'unknown',
};

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

// Strip leading subdomains until we hit a key in the taxonomy or run out.
// "smile.amazon.com" → "amazon.com", "www.shop.apple.com" → "apple.com".
function findInTaxonomy(host) {
  if (!host) return null;
  let h = host;
  while (h.includes('.')) {
    if (Object.prototype.hasOwnProperty.call(taxonomy, h) && h !== '_doc') {
      return { ...taxonomy[h], hostname: h };
    }
    h = h.replace(/^[^.]+\./, '');
  }
  return null;
}

function categorizeHostname(host) {
  const found = findInTaxonomy((host || '').toLowerCase().replace(/^www\./, ''));
  if (found) return found;
  return { ...LONG_TAIL, name: host || '(unknown)', hostname: host };
}

function categorizeUrl(url) {
  return categorizeHostname(hostnameOf(url));
}

function listKnownCategories() {
  const set = new Set();
  for (const [k, v] of Object.entries(taxonomy)) {
    if (k === '_doc') continue;
    set.add(v.category);
  }
  return [...set].sort();
}

module.exports = {
  categorizeHostname,
  categorizeUrl,
  hostnameOf,
  listKnownCategories,
};
