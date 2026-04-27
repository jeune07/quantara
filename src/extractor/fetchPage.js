const { withBrowser, newPage } = require('../utils/puppeteer');

async function renderPage(url) {
  return withBrowser(async (browser) => {
    const page = await newPage(browser);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2000));
    const html = await page.content();
    const finalUrl = page.url();
    const title = await page.title();
    return { html, finalUrl, title };
  });
}

module.exports = { renderPage };
