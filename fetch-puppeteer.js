// Load the McMaster cotter-pins page in real Chromium, let the SPA render,
// then dump the final HTML plus any obvious product strings and XHR endpoints.

const puppeteer = require('puppeteer');

const PAGE = 'https://www.mcmaster.com/products/cotter-pins/';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1366, height: 900 });

  const xhrs = [];
  page.on('response', async (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (type === 'xhr' || type === 'fetch') {
      xhrs.push({ status: res.status(), method: req.method(), url: req.url() });
    }
  });

  await page.goto(PAGE, { waitUntil: 'networkidle2', timeout: 60000 });

  // Give the SPA a bit more time in case anything is still rendering.
  await new Promise((r) => setTimeout(r, 2000));

  const finalHtml = await page.content();
  const bodyText = await page.evaluate(() => document.body.innerText);
  const title = await page.title();

  const cotterHits = (finalHtml.match(/cotter[- ]?pin/gi) || []).length;

  console.log(`URL:    ${page.url()}`);
  console.log(`Title:  ${title}`);
  console.log(`HTML:   ${finalHtml.length} bytes`);
  console.log(`Text:   ${bodyText.length} bytes`);
  console.log(`"cotter pin" mentions in final HTML: ${cotterHits}`);
  console.log('');
  console.log('--- First 2000 chars of rendered body text ---');
  console.log(bodyText.slice(0, 2000));
  console.log('');
  console.log(`--- XHR/fetch requests (${xhrs.length}) ---`);
  for (const r of xhrs.slice(0, 40)) {
    console.log(`${r.status} ${r.method} ${r.url}`);
  }

  await browser.close();
})().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
