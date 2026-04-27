const { withBrowser, newPage } = require('../utils/puppeteer');
const { settlePage } = require('./pageReady');

const NAV_TIMEOUT_MS = 60000;

async function renderPage(url) {
  return withBrowser(async (browser) => {
    const page = await newPage(browser);

    const response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: NAV_TIMEOUT_MS,
    });
    const httpStatus = response ? response.status() : 0;

    const settle = await settlePage(page);

    const html = await page.content();
    const finalUrl = page.url();
    const title = await page.title();

    // Viewport screenshot from the top — autoScroll ended at scroll(0,0), so
    // this captures the hero section (title, price, main image) which is where
    // vision extraction has the most leverage.
    const screenshot = await page
      .screenshot({ type: 'png', fullPage: false })
      .catch(() => null);

    return { html, finalUrl, title, httpStatus, settle, screenshot };
  });
}

module.exports = { renderPage };
