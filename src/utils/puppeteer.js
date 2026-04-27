const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
];

const VIEWPORT = { width: 1366, height: 900 };

async function withBrowser(fn) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: LAUNCH_ARGS,
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport(VIEWPORT);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });
  return page;
}

module.exports = { withBrowser, newPage, UA, LAUNCH_ARGS, VIEWPORT };
