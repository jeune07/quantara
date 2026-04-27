// PDF-ingestion orchestrator. Same shape as extractFromUrl: one entry
// point that owns the strategy. Routes only call this function.
//
// Strategy:
//   1. Parse the PDF buffer to text (selectable text only — image-only
//      PDFs are not OCR'd in v1).
//   2. Bail with a typed 502 if the PDF yields no usable text.
//   3. Send the text to Claude with the multi-product tool and return the
//      array of products, each tagged with extractionMode: 'pdf-text'.

const { pdfBufferToText } = require('./parsePdf');
const { extractProductsFromCatalog } = require('./claudeExtract');
const { ExtractError } = require('./extractFromUrl');

const MIN_USEFUL_PDF_CHARS = 200;

async function extractFromPdf(buffer, filename) {
  let parsed;
  try {
    parsed = await pdfBufferToText(buffer);
  } catch (e) {
    throw new ExtractError(
      `Failed to read PDF: ${e.message}`,
      400,
      'pdf_unreadable'
    );
  }

  if (!parsed.text || parsed.text.length < MIN_USEFUL_PDF_CHARS) {
    throw new ExtractError(
      'PDF contained no extractable text. Image-only / scanned PDFs are not yet supported.',
      422,
      'pdf_no_text'
    );
  }

  const sourceLabel = filename ? `pdf:${filename}` : 'pdf:upload';

  let products;
  try {
    products = await extractProductsFromCatalog({
      text: parsed.text,
      sourceLabel,
    });
  } catch (e) {
    throw new ExtractError(
      `Anthropic catalog extraction failed: ${e.message}`,
      502,
      'catalog_extract_failed'
    );
  }

  if (!products.length) {
    throw new ExtractError(
      'No products were identified in the PDF.',
      422,
      'pdf_no_products'
    );
  }

  return products.map((p) => ({
    ...p,
    extractionMode: 'pdf-text',
    pageCount: parsed.pageCount,
    truncated: parsed.truncated,
  }));
}

module.exports = { extractFromPdf };
