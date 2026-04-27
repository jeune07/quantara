// Attempt the full McMaster-Carr handshake: shell page -> Vldt -> tokenauthorization -> page.
// Uses a manual cookie jar since built-in fetch does not persist cookies across calls.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ORIGIN = 'https://www.mcmaster.com';
const PAGE = `${ORIGIN}/products/cotter-pins/`;

const jar = new Map(); // name -> value

function storeSetCookie(headers) {
  // Node's fetch exposes raw set-cookie via getSetCookie()
  const list = headers.getSetCookie ? headers.getSetCookie() : [];
  for (const line of list) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    jar.set(name, value);
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function step(label, url, init = {}) {
  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(init.headers || {}),
  };
  if (jar.size) headers.Cookie = cookieHeader();
  const res = await fetch(url, { ...init, headers, redirect: 'follow' });
  storeSetCookie(res.headers);
  const body = await res.text();
  console.log(
    `[${label}] ${res.status} ${url}  cookies=${jar.size}  body=${body.length}b`
  );
  return { res, body };
}

(async () => {
  try {
    // 1. Shell page to collect initial cookies
    await step('shell', PAGE);

    // 2. Validation
    await step('vldt', `${ORIGIN}/mv1776973905/Vldt.aspx`, {
      headers: { Referer: PAGE, 'X-Requested-With': 'XMLHttpRequest' },
    });

    // 3. Token authorization
    await step('token', `${ORIGIN}/mv1776973905/tokenauthorization.aspx`, {
      method: 'POST',
      headers: {
        Referer: PAGE,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Length': '0',
      },
    });

    // 4. Re-fetch the product page with the new cookies
    const { body } = await step('page-again', PAGE, {
      headers: { Referer: PAGE },
    });

    const hits = (body.match(/cotter[- ]?pin/gi) || []).length;
    console.log(`\nmentions of "cotter pin" in final body: ${hits}`);
    console.log(
      `first 400 chars of body:\n${body.slice(0, 400).replace(/\s+/g, ' ')}`
    );
  } catch (err) {
    console.error('Failed:', err);
  }
})();
