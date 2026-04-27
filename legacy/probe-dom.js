const puppeteer = require('puppeteer');
const fs = require('fs');
const PAGE = 'https://www.mcmaster.com/products/cotter-pins/';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(PAGE, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));

  const html = await page.content();
  fs.writeFileSync('rendered.html', html);

  // Look for plausible product block containers: elements that contain a link
  // to a product family (/products/...) plus text with a dollar price or part number.
  const summary = await page.evaluate(() => {
    const texts = [];
    document.querySelectorAll('a[href*="/products/"]').forEach((a) => {
      const host = a.closest('li, div, section, article');
      if (!host) return;
      const snip = host.innerText.replace(/\s+/g, ' ').trim().slice(0, 200);
      texts.push({
        tag: host.tagName,
        cls: host.className,
        href: a.getAttribute('href'),
        text: snip,
      });
    });
    return texts.slice(0, 40);
  });

  console.log('rendered.html written:', fs.statSync('rendered.html').size, 'bytes');
  console.log('\nProduct-link hosts (first 40):');
  for (const s of summary) {
    console.log(`- <${s.tag} class="${s.cls}"> href=${s.href}`);
    console.log(`   ${s.text}`);
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
