// Minimal PDF → text extraction wrapper.
//
// pdf-parse 2.x exposes a PDFParse class that loads a buffer, then exposes
// per-page or whole-document text. We use whole-document text (joined with
// page-break markers so Claude can reason about layout) and cap the output
// at 60K chars — enough for ~10–20 catalog pages and well under the model
// input limit.

const { PDFParse } = require('pdf-parse');

const MAX_CHARS = 60000;

async function pdfBufferToText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('pdfBufferToText requires a non-empty Buffer');
  }
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    // pdf-parse 2.x returns either { text, numpages, ... } or pages array
    // depending on options. Normalize: if `pages` is present join with form
    // feed; else use `text`.
    let text;
    if (Array.isArray(result.pages)) {
      text = result.pages
        .map((p, i) => `\n=== Page ${i + 1} ===\n${p.text || ''}`)
        .join('');
    } else {
      text = result.text || '';
    }
    text = text.trim();
    const truncated = text.length > MAX_CHARS;
    if (truncated) text = text.slice(0, MAX_CHARS) + '\n\n...[truncated]';
    return { text, truncated, pageCount: result.numpages || result.numPages || null };
  } finally {
    if (typeof parser.destroy === 'function') {
      try { await parser.destroy(); } catch {}
    }
  }
}

module.exports = { pdfBufferToText };
