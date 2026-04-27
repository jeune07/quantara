// Pure function: given the candidates and the plan, summarize what
// discovery covered and what it missed.
//
// The orchestrator pipes both inputs into this; the route returns the
// resulting coverage object alongside the candidates so the UI can show
// the user what they got at a glance — and what's worth chasing manually.
//
// Output shape:
//   {
//     totalCandidates,
//     uniqueRetailers,
//     uniqueCategories,
//     queriesPlanned,
//     byCategory:   { '<category>': count, ... },
//     byStratum:    { '<stratum>':  count, ... },
//     emptyStrata:  ['<stratum>', ...],   // planned but returned 0 results
//     suggestions:  [string, ...],
//   }

const { categorizeUrl } = require('./categorizeRetailer');

// Categories we expect a complete market panel to cover, ranked roughly
// by importance for typical e-commerce research.
const VALUABLE_CATEGORIES = [
  'authorized',
  'big-box',
  'marketplace',
  'specialty-refurb',
  'wholesale-b2b',
  'wholesale-international',
];

function tally(items, key) {
  const out = {};
  for (const it of items) {
    const k = it[key];
    if (!k) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function generateSuggestions({ candidates, byCategory, emptyStrata, plan }) {
  const suggestions = [];

  if (candidates.length === 0) {
    suggestions.push(
      'No candidates were found. The product may be too obscure for ' +
        'web search, or the planner produced unhelpful queries. Try a more ' +
        'specific source (brand + exact MPN/SKU).'
    );
    return suggestions;
  }
  if (candidates.length < 3) {
    suggestions.push(
      'Only ' + candidates.length + ' candidate(s) found — coverage is thin. ' +
        'Consider re-running discovery with a more specific source product.'
    );
  }

  // Highlight planned strata that returned empty.
  for (const s of emptyStrata) {
    if (s === 'wholesale-b2b' || s === 'wholesale-international') {
      suggestions.push(
        'No ' + s + ' results — for arbitrage research, try the relevant ' +
          'wholesale sites (Alibaba, Grainger, etc.) directly.'
      );
    } else if (s === 'specialty-refurb') {
      suggestions.push(
        'No refurbished candidates — try Back Market, Gazelle, or Swappa ' +
          'directly if condition matters.'
      );
    } else if (s === 'marketplace') {
      suggestions.push(
        'No marketplace results (eBay, Mercari, Etsy). Direct site searches ' +
          'may surface used or third-party listings missed by web search.'
      );
    } else if (s === 'authorized-channel') {
      suggestions.push(
        'No authorized-retailer results — the manufacturer may not sell ' +
          'this product directly online.'
      );
    }
  }

  // Long-tail-only batches deserve a callout.
  const onlyLongTail =
    Object.keys(byCategory).length === 1 && byCategory['long-tail'];
  if (onlyLongTail) {
    suggestions.push(
      'All candidates are from long-tail / unknown retailers. Coverage of ' +
        'major categories (big-box, marketplace, authorized) is missing.'
    );
  }

  // Single-category coverage.
  const distinctValuable = VALUABLE_CATEGORIES.filter((c) => byCategory[c] > 0);
  if (
    candidates.length >= 4 &&
    distinctValuable.length === 1
  ) {
    suggestions.push(
      'All major-category candidates are concentrated in "' +
        distinctValuable[0] +
        '". Consider planning a follow-up discovery targeting other strata.'
    );
  }

  return suggestions;
}

function buildCoverage(candidates, plan) {
  const cands = Array.isArray(candidates) ? candidates : [];
  const planArr = Array.isArray(plan) ? plan : [];

  const byCategory = tally(cands, 'category');
  const byStratum = tally(cands, 'foundByStratum');

  // Strata that were in the plan but returned no surviving candidates.
  const stratumPlanned = new Set(planArr.map((q) => q.stratum));
  const stratumWithResults = new Set(Object.keys(byStratum));
  const emptyStrata = [...stratumPlanned]
    .filter((s) => !stratumWithResults.has(s))
    .sort();

  const uniqueRetailers = new Set(
    cands.map((c) => {
      try {
        return new URL(c.url).hostname.replace(/^www\./i, '').toLowerCase();
      } catch {
        return null;
      }
    }).filter(Boolean)
  ).size;

  const suggestions = generateSuggestions({
    candidates: cands,
    byCategory,
    emptyStrata,
    plan: planArr,
  });

  return {
    totalCandidates: cands.length,
    uniqueRetailers,
    uniqueCategories: Object.keys(byCategory).length,
    queriesPlanned: planArr.length,
    byCategory,
    byStratum,
    emptyStrata,
    suggestions,
  };
}

module.exports = { buildCoverage, VALUABLE_CATEGORIES };
