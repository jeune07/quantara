const TurndownService = require('turndown');

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

td.remove(['script', 'style', 'noscript', 'svg', 'iframe']);

const MAX_CHARS = 60000;

function htmlToMarkdown(html) {
  let md;
  try {
    md = td.turndown(html);
  } catch {
    md = html;
  }
  if (md.length > MAX_CHARS) {
    md = md.slice(0, MAX_CHARS) + '\n\n...[truncated]';
  }
  return md;
}

module.exports = { htmlToMarkdown };
