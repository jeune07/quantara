# quantara

A self-hosted product-extraction backend for e-commerce research. Paste any
product URL (or upload a PDF catalog), and Claude returns a structured JSON
representation: title, SKU, brand, price, description, specifications,
variants, images, and availability. Every extraction joins a running batch
that exports to a single multi-sheet Excel workbook with optional columns
for price-history deltas, margin calculations, and cross-retailer product
grouping.

It is **not** a scraper for a single site — there are no per-vendor
selectors. The pipeline renders the page with a stealth-instrumented
Chromium, normalizes the DOM, and asks Claude (`claude-sonnet-4-6`) to
extract a fixed schema via structured tool use. When text extraction is
blocked or thin, it retries with the page screenshot via the same
multimodal model.

---

## Quick start

```bash
# 1. Install (Node 18+, Chromium downloaded by Puppeteer)
npm install

# 2. Configure
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# 3. Run
npm start                  # production
npm run dev                # auto-restart on file changes (Node 22+)

# Open http://localhost:3000
```

A brief startup warning is printed if `ANTHROPIC_API_KEY` is unset; the
server boots regardless so the UI is reachable, but extraction calls will
return a typed 5xx until the key is provided.

### First extraction

1. Open the UI, paste a product URL (e.g. `https://www.mcmaster.com/98401A910/`).
2. The server renders, cleans, asks Claude, persists a snapshot, and returns
   `{product, history: {previous, delta}}`.
3. The product appears in the **Batch** panel. Repeat with more URLs (or
   bulk-paste a CSV / upload a PDF catalog).
4. Click **Download .xlsx** — every product in the batch is emitted to one
   workbook with flat tables.

### From the command line

```bash
# Single URL
curl -sS -X POST http://localhost:3000/api/extract \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.mcmaster.com/98401A910/"}' | jq .

# Bundle a list of products into a workbook
curl -sS -X POST http://localhost:3000/api/workbook \
  -H 'Content-Type: application/json' \
  -d @products.json -o catalog.xlsx
```

---

## Configuration

| Env var               | Default                      | Purpose                                                           |
| --------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`   | _(required for extraction)_  | Anthropic API key. Without it `/api/extract*` and `/api/group` return 5xx with an explicit error. |
| `PORT`                | `3000`                       | HTTP listen port.                                                 |
| `QUANTARA_DB`         | `data/quantara.db`           | SQLite path for snapshot history. Auto-created on first connect.  |

Constants worth knowing (defined at the top of the relevant module — change
in code, not env):

| Constant                       | Value     | Where                          |
| ------------------------------ | --------- | ------------------------------ |
| Page navigation timeout        | 60 s      | `src/extractor/fetchPage.js`   |
| Markdown size cap (URL path)   | 60 000 ch | `src/extractor/htmlToMarkdown.js` |
| Markdown size cap (PDF path)   | 60 000 ch | `src/extractor/parsePdf.js`    |
| Min "useful" markdown          | 500 ch    | `src/extractor/extractFromUrl.js` |
| Min "useful" PDF text          | 200 ch    | `src/extractor/extractFromPdf.js` |
| Block-page min body sample     | 400 ch    | `src/extractor/blockDetect.js` |
| Auto-scroll plateau wait       | 1 s       | `src/extractor/pageReady.js`   |
| Auto-scroll hard ceiling       | 8 s       | `src/extractor/pageReady.js`   |
| PDF upload limit               | 10 MB     | `src/routes/extract.js`        |
| Bulk-import concurrency        | 2         | `public/index.html`            |
| Workbook hard limit            | 500 SKUs  | `src/routes/extract.js`        |

---

## How extraction works

The orchestrator (`src/extractor/extractFromUrl.js`) is the only place where
strategy lives. Routes never call Puppeteer or Claude directly.

```
              ┌─────────────────────────────────────────────────┐
URL ────►─────┤ 1. renderPage  (stealth Puppeteer, smart waits) │
              └─────────────────────────────────────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────────────────┐
              │ 2. detectBlock                                  │
              │    captcha / 5xx / "access denied" / empty body │
              │    HARD block → 502 with typed `code`           │
              │    "empty" body  → continue, vision may help    │
              └─────────────────────────────────────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────────────────┐
              │ 3. cleanHtml → htmlToMarkdown                   │
              │    strip <script>/<style>/<svg>, attrs, etc.    │
              │    convert to markdown, cap at 60K chars        │
              └─────────────────────────────────────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────────────────┐
              │ 4. extractFromText  (Claude tool_use)           │
              │    record_product schema, forced single call    │
              │    cache_control on system prompt + tool def    │
              └─────────────────────────────────────────────────┘
                                    │
                ┌───────────────────┴────────────────────┐
                │                                        │
       useful (title +                       thin (no title or
       desc/specs/price)                     no substantive fields)
                │                                        │
                ▼                                        ▼
       extractionMode: "text"          ┌────────────────────────────────┐
                                       │ 5. extractFromImage (vision)   │
                                       │    same prompt + tool, but PNG │
                                       │    of the rendered viewport    │
                                       └────────────────────────────────┘
                                                          │
                                                          ▼
                                       extractionMode: "vision" or "hybrid"
                                       (hybrid = field-by-field merge of
                                        text and vision results)
```

`extractionMode` is returned with every product: `"text"`, `"vision"`,
`"hybrid"`, or `"text-low-confidence"` (text path produced something but it
didn't pass the quality gate and no screenshot was available for fallback).
The UI shows it as a colored badge; the workbook records it in the `Mode`
column.

### Stealth defaults

`puppeteer-extra-plugin-stealth` is enabled in `src/utils/puppeteer.js`. It
defeats most basic bot detection (Cloudflare's "Just a moment", common
navigator-fingerprint checks). It does **not** defeat hCaptcha, Amazon's
hardened anti-bot, or geo-gated content. When it fails, `detectBlock`
catches the result so the user gets a clear typed error instead of garbage
extraction.

### PDF ingestion

`src/extractor/extractFromPdf.js` is a sibling orchestrator with the same
shape: parse → block-check (zero-text catch) → Claude (multi-product
`record_products` tool) → array of products. PDFs are **text-only** in v1 —
scanned/image-only PDFs return `422 pdf_no_text` instead of being silently
mis-extracted. OCR fallback is a future addition.

---

## Features

| Surface                    | Where                                                |
| -------------------------- | ---------------------------------------------------- |
| URL → product (text + vision fallback) | `POST /api/extract`                       |
| PDF catalog → products[]   | `POST /api/extract-pdf` (multipart)                  |
| Bulk URL import (UI)       | Paste list / upload CSV; concurrency-2 queue         |
| Per-product economics      | Cost / Shipping / Fees % / Fees $ → live margin %    |
| Price-history snapshots    | SQLite; per-URL delta returned on each extract       |
| Cross-retailer grouping    | `POST /api/group` — Claude clusters by canonical id  |
| Multi-product Excel export | `POST /api/workbook` — flat tables, optional columns |

---

## HTTP API

All POST bodies are `application/json` unless noted. Errors return
`{error: string, code?: string}`; extraction errors set `code` to one of
`render_failed`, `blocked_captcha`, `blocked_access_denied`,
`blocked_rate_limited`, `blocked_http_error`, `vision_failed`,
`pdf_unreadable`, `pdf_no_text`, `pdf_no_products`, `catalog_extract_failed`,
`group_failed`.

### `POST /api/extract`

```json
// Request
{ "url": "https://www.mcmaster.com/98401A910/" }

// Response (200)
{
  "product": {
    "title": "...",
    "sku": "98401A910",
    "brand": "...",
    "price": { "amount": 8.42, "currency": "USD", "raw": "$8.42 per pkg" },
    "description": "...",
    "specs": { "Material": "18-8 SS", "Length": "1\"" },
    "variants": [],
    "images": ["https://..."],
    "availability": "In stock",
    "sourceUrl": "https://www.mcmaster.com/98401A910/",
    "extractionMode": "text"
  },
  "history": {
    "previous": {
      "id": 17, "sourceUrl": "...", "priceAmount": 9.42,
      "extractedAt": "2026-04-20 15:31:02", "...": "..."
    },
    "delta": {
      "since": "2026-04-20 15:31:02",
      "priceFrom": 9.42, "priceTo": 8.42,
      "priceChange": -1.0, "pricePercent": -10.62
    }
  }
}
```

`history.previous` is `null` on the first extract of a URL.
`history.delta` is `null` when nothing meaningful changed.

### `POST /api/extract-pdf`

`multipart/form-data` with one `file` field, max 10 MB.

```json
// Response (200)
{
  "filename": "vendor-q2-catalog.pdf",
  "products": [ /* same Product shape */ ]
}
```

### `POST /api/workbook`

```json
// Request
{ "products": [ /* array of Product objects (max 500) */ ] }
```

Returns an `.xlsx` file (`Content-Type:
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
Filename auto-generated as `<sku-or-title>.xlsx` for single product, or
`quantara-<n>-products-<timestamp>.xlsx` for multi.

### `POST /api/group`

```json
// Request — same Product[] shape as /api/workbook
{ "products": [ /* ... */ ] }

// Response
{
  "groups": [
    {
      "canonicalName": "Apple AirPods Pro 2nd Gen",
      "memberIndices": [0, 3, 7],
      "confidence": "high",
      "reason": "Identical brand+model and matching MPN."
    }
  ]
}
```

Every input index appears in exactly one group; products Claude doesn't
cluster end up as low-confidence singletons (defensive normalization in
`src/analysis/groupProducts.js`).

### `GET /api/history?url=<source-url>`

Returns up to 50 snapshots for a URL, newest first. No Claude call.

```json
{
  "url": "https://www.mcmaster.com/98401A910/",
  "history": [
    { "id": 42, "priceAmount": 8.42, "extractedAt": "2026-04-27 17:22:00", "...": "..." }
  ]
}
```

---

## Project layout

```
quantara/
├── server.js                     Express entry: dotenv, json, static, /api routes
├── public/
│   └── index.html                Single-file UI (no build step)
├── src/
│   ├── extractor/                URL/PDF → Product
│   │   ├── extractFromUrl.js     Orchestrator: render → block-check → text → vision fallback → merge
│   │   ├── extractFromPdf.js     Orchestrator: parse → text → record_products
│   │   ├── fetchPage.js          Puppeteer renderPage (returns html, screenshot, status)
│   │   ├── pageReady.js          autoScroll + body-text plateau wait
│   │   ├── blockDetect.js        Pure function on title + body + status; returns {blocked, reason}
│   │   ├── cleanHtml.js          Strip scripts/styles/attrs; pure
│   │   ├── htmlToMarkdown.js     turndown wrapper, 60K-char cap
│   │   ├── parsePdf.js           pdf-parse 2.x wrapper
│   │   ├── productSchema.js      record_product + record_products tool defs (single source of truth)
│   │   └── claudeExtract.js      extractFromText / extractFromImage / extractProductsFromCatalog
│   ├── analysis/                 Post-extraction transforms
│   │   └── groupProducts.js      Claude grouping with defensive normalizeGroups
│   ├── db/                       Persistence
│   │   ├── database.js           Lazy SQLite connection (WAL, idempotent schema)
│   │   └── snapshots.js          recordSnapshot / getLatestSnapshot / getHistory / computeDelta
│   ├── output/
│   │   └── toExcel.js            Multi-product workbook (Products / Specs / Images / Variants),
│   │                             optional columns appear only when used
│   ├── routes/
│   │   └── extract.js            Thin: validate → delegate → typed errors
│   └── utils/
│       ├── anthropic.js          Shared client + MODEL constant + logUsage
│       ├── puppeteer.js          Stealth launch + UA + viewport
│       └── excel.js              styleHeader, hyperlinkCell helpers
├── legacy/                       Preserved McMaster-Carr scrapers (npm run scrape:*)
├── data/                         SQLite (gitignored)
├── .env.example
└── package.json
```

The architecture has three layered concerns kept strictly separate:

1. **Routes** validate input and translate errors. They never call SDKs.
2. **Extractors / analysis** own all Claude and Puppeteer calls. They
   produce or transform `Product` objects.
3. **Output** consumes `Product[]` and produces files.

Adding a new ingestion path = a new file in `src/extractor/` + one route.
Adding a new analysis = a new file in `src/analysis/` + one route. The
existing code does not need to be modified.

---

## Data model

The `Product` object is the canonical shape passed between every layer.

| Field            | Type                                       | Notes                                          |
| ---------------- | ------------------------------------------ | ---------------------------------------------- |
| `title`          | string (required)                          | Verbatim from the page.                        |
| `sku`            | string                                     | Manufacturer / vendor part number.             |
| `brand`          | string                                     | Brand or manufacturer.                         |
| `price`          | `{amount, currency, raw}`                  | All optional; `raw` is the as-displayed string. |
| `description`    | string                                     | Visible product copy. No invention.            |
| `specs`          | `{[label: string]: string}`                | Labels copied verbatim.                        |
| `variants`       | `{sku, label, attributes}[]`               | Multi-SKU pages.                               |
| `images`         | string[]                                   | Absolute URLs only.                            |
| `availability`   | string                                     | "In stock", "Backordered", etc.                |
| `sourceUrl`      | string                                     | Final URL after redirects (or `pdf:filename`). |
| `extractionMode` | `text`/`vision`/`hybrid`/`text-low-confidence`/`pdf-text` | Set by orchestrator. |

Client-side metadata (used by the UI and surfaced in the workbook):

| Field         | Source       | Effect                                                  |
| ------------- | ------------ | ------------------------------------------------------- |
| `_history`    | server response | Adds Previous Price / Δ Price / Δ % / Last Seen columns |
| `_economics`  | UI inputs    | Adds Cost / Shipping / Fees / Net Revenue / Profit / Margin % |
| `_group`      | `/api/group` | Adds Group # / Canonical Name / Group Confidence        |

Underscore-prefixed fields are never sent to Claude — they are local annotations.

---

## Database schema

SQLite at `data/quantara.db` (WAL mode, gitignored). One table:

```sql
CREATE TABLE extractions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url      TEXT NOT NULL,
  sku             TEXT,
  title           TEXT,
  price_amount    REAL,
  price_currency  TEXT,
  price_raw       TEXT,
  availability    TEXT,
  extraction_mode TEXT,
  product_json    TEXT NOT NULL,           -- full product as JSON
  extracted_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_extractions_url
  ON extractions(source_url, extracted_at DESC);
```

Snapshots are written **after** the previous one is read, so the route can
return a real delta. PDF-sourced products are not persisted in v1 (they
have no canonical re-fetch URL).

---

## Anthropic usage

| Setting        | Value                                          |
| -------------- | ---------------------------------------------- |
| Model          | `claude-sonnet-4-6`                            |
| `max_tokens`   | 4096 (single product) / 8192 (catalog) / 4096 (group) |
| Tool choice    | Forced single tool: `record_product` / `record_products` / `record_groups` |
| Caching        | `cache_control: { type: 'ephemeral' }` on the system prompt and the tool definition. Subsequent calls within the 5-minute TTL hit the cache (verified via `cache_read_input_tokens` in server logs). |
| Vision         | base64 PNG of the rendered viewport. Same model.   |

The model ID is centralized in `src/utils/anthropic.js`. To upgrade
(e.g. to Opus 4.7 for harder pages), change one line; both the extractor
and the analysis paths pick it up.

---

## Workbook structure

A single workbook covers any number of products. Sheets are flat tables
keyed by `Ref` (SKU when present, else title), so the user can sort,
filter, and pivot in Excel without lookups.

| Sheet      | Always present | Adds rows when                                |
| ---------- | -------------- | --------------------------------------------- |
| Products   | yes            | one row per product                            |
| Specs      | yes            | one row per `(product, spec key)`             |
| Images     | yes            | one row per image URL                         |
| Variants   | conditional    | only if at least one product has `variants[]` |

The `Products` sheet also adds optional column groups when relevant data is
present. None of these widen the sheet for users who don't use the feature.

| Trigger                                             | Adds columns                                         |
| --------------------------------------------------- | ---------------------------------------------------- |
| Any product has `_history.previous`                 | Previous Price, Δ Price, Δ %, Last Seen             |
| Any product has `_economics` (with at least one cost) | Cost, Shipping, Fees %, Fees $, Net Revenue, Profit, Margin % |
| Any product has `_group`                            | Group #, Canonical Name, Group Confidence            |

---

## Limits & known limitations

- **No OCR.** Image-only / scanned PDFs return `422 pdf_no_text`. Real
  catalogs from vendors are typically text-extractable; consumer-facing
  marketing PDFs are often not.
- **One screenshot per page.** Vision fallback uses the first viewport
  (the autoScroll resets to the top before capture, so hero content is
  reliably included). Pages where the relevant content is below the fold
  may need full-page screenshots — possible future addition.
- **No proxy rotation.** Aggressive bot-defended sites (Amazon at scale)
  will still trigger blocks even with stealth. The block-detector at
  least surfaces a clear typed error instead of garbage extraction.
- **Single SQLite DB.** Fine for a single user / single machine. For
  multi-tenant deployment, swap `src/db/database.js` for a Postgres
  connection — the `snapshots.js` interface stays.
- **No auth.** The server is intended for trusted local / single-user
  deployment. Don't expose `/api/*` to the public internet without a
  reverse-proxy auth layer.

---

## Legacy scrapers

`legacy/` preserves the original McMaster-Carr-specific scrapers from
before the Anthropic-powered architecture:

```bash
CATEGORY_URL='https://www.mcmaster.com/products/cotter-pins/cotter-pins-3~~/' \
  npm run scrape:catalog       # legacy/scrape-catalog-table.js
npm run scrape:tiles            # legacy/scrape-to-excel.js
npm run scrape:skus             # legacy/scrape-skus-to-excel.js
```

These are kept for bulk McMaster catalog runs that don't need
generality — they're faster and cheaper than the Claude path for that one
supplier. They share no code with `src/`.

---

## Troubleshooting

| Symptom                                                             | Cause / Fix                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| `ANTHROPIC_API_KEY is not set` on extract                           | Add the key to `.env` and restart.                   |
| `Page is blocked (captcha)`                                         | Stealth didn't defeat this site. Try a different URL or wait — some sites cool down. |
| `cache_read_input_tokens=0` on every call                           | The system prompt or tool definition changed between calls. The cache is invalidated by any byte-level change in the cached prefix. |
| Workbook download is empty / corrupted                              | The browser's download was interrupted. Re-click; the server is stateless and the batch is in localStorage. |
| `pdf_no_text`                                                       | PDF is image-only or encrypted. Not OCR'd in v1.    |
| Server hangs on a URL                                               | Page navigation timeout is 60 s. If it hangs longer, investigate the page in a real browser — Puppeteer should have errored. |
| Many extractions all return `extractionMode: text-low-confidence`   | Page renders content but the text path produced no description/specs/price. Often a category page rather than a PDP. |

To inspect token usage and cache hits, watch `npm start` logs:

```
[anthropic:text] tokens: input=187 cache_read=2456 cache_create=0 output=312
```

`cache_read > 0` means the cached prefix landed; everything past the
breakpoint is being processed normally.

---

## License

ISC.
