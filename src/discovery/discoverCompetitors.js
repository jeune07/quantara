// Cross-retailer discovery — orchestrator. Multi-stage strategy:
//
//   1. planSearchStrategy   — Claude designs 4–6 queries spanning multiple
//                             strata (exact-match, authorized, marketplace,
//                             refurb, wholesale, comparison, regional).
//   2. runSearchPasses      — runs all queries in parallel; each query
//                             gets its own Claude call with the
//                             web_search server-side tool and pools URLs.
//   3. filterCandidateUrls  — pure-code URL hygiene: drops search/blog/
//                             category/help paths, enforces per-retailer
//                             product-page patterns, dedupes by hostname,
//                             excludes the source domain.
//   4. categorizeRetailer   — pure hostname → category lookup.
//
// All Claude calls share the same model (claude-sonnet-4-6) and use
// ephemeral cache_control on system prompts and tool definitions, so
// repeat invocations within the cache window are materially cheaper.
//
// The orchestrator returns:
//   {
//     candidates: [{url, retailer, category, tier, trust, confidence,
//                   reason, foundByStratum, foundByQuery}, ...],
//     plan:       [{query, stratum, rationale}, ...],
//   }
//
// Coverage analysis (Phase H3) consumes the candidates + plan and emits
// a separate coverage object; that lives in coverageReport.js.

const { planSearchStrategy } = require('./planSearchStrategy');
const { runSearchPasses } = require('./runSearchPasses');
const { filterCandidateUrls } = require('./filterCandidateUrls');
const { categorizeUrl } = require('./categorizeRetailer');

async function discoverCompetitors(product) {
  if (!product || (!product.title && !product.sku)) {
    throw new Error('discoverCompetitors requires a product with at least a title or sku');
  }

  // Stage 1: plan.
  const plan = await planSearchStrategy(product);

  // Stage 2: parallel search execution.
  const pooled = await runSearchPasses(plan, product);

  // Stage 3: URL hygiene. Run the filter on URLs alone, then re-attach
  // metadata from the pooled candidate objects. We use a Map so the first
  // pass to find a URL "wins" — its stratum / query attribution sticks.
  const byUrl = new Map();
  for (const c of pooled) {
    if (c && c.url && !byUrl.has(c.url)) byUrl.set(c.url, c);
  }
  const cleanUrls = filterCandidateUrls(
    [...byUrl.keys()],
    product.sourceUrl
  );

  // Stage 4: categorize.
  const candidates = cleanUrls.map((url) => {
    const meta = byUrl.get(url) || {};
    const category = categorizeUrl(url);
    return {
      url,
      retailer: meta.retailer || category.name,
      category: category.category,
      tier: category.tier,
      trust: category.trust,
      confidence: meta.confidence || 'medium',
      reason: meta.reason || '',
      foundByStratum: meta.foundByStratum || null,
      foundByQuery: meta.foundByQuery || null,
    };
  });

  return { candidates, plan };
}

module.exports = { discoverCompetitors };
