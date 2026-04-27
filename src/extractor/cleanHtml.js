const STRIP_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe', 'link', 'meta'];

function cleanHtml(html) {
  let out = html;

  for (const tag of STRIP_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
    out = out.replace(re, '');
    const selfClose = new RegExp(`<${tag}\\b[^>]*/?>`, 'gi');
    out = out.replace(selfClose, '');
  }

  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/src\s*=\s*"data:[^"]{200,}"/gi, 'src=""');
  out = out.replace(/\sstyle\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\sdata-[a-z0-9_-]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\sclass\s*=\s*"[^"]*"/gi, '');

  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/\n\s*\n\s*\n+/g, '\n\n');

  return out.trim();
}

module.exports = { cleanHtml };
