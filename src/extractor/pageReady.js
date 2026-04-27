// Smart waits — the page should be allowed to render JS, lazy-load images, and
// settle before we snapshot the DOM. We use three signals in order:
//
//   1. networkidle2 (Puppeteer-native, set by caller via page.goto).
//   2. autoScroll — scroll to bottom in chunks. Triggers lazy-loaded images,
//      review widgets, spec tables that hydrate on intersection.
//   3. waitForProductSignals — wait until either:
//        a) the body text length has stopped growing for `stableMs` ms, OR
//        b) a hard ceiling (`maxWaitMs`) is reached.
//      We do not wait on specific selectors because the whole point of this
//      product is that we don't know the layout in advance.
//
// All numbers are tunable from one place at the top of the file.

const SCROLL_STEP_PX = 600;
const SCROLL_DELAY_MS = 150;
const SCROLL_MAX_STEPS = 40; // ~24,000px — enough for any realistic PDP

const STABILITY_POLL_MS = 250;
const STABILITY_PLATEAU_MS = 1000; // body length unchanged this long → done
const STABILITY_MAX_WAIT_MS = 8000; // hard ceiling after scroll completes

async function autoScroll(page) {
  await page.evaluate(
    async (stepPx, delayMs, maxSteps) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let lastHeight = -1;
      for (let i = 0; i < maxSteps; i++) {
        window.scrollBy(0, stepPx);
        await sleep(delayMs);
        const h = document.documentElement.scrollHeight;
        if (window.scrollY + window.innerHeight >= h) {
          if (h === lastHeight) break;
          lastHeight = h;
        }
      }
      window.scrollTo(0, 0);
    },
    SCROLL_STEP_PX,
    SCROLL_DELAY_MS,
    SCROLL_MAX_STEPS
  );
}

async function waitForProductSignals(page) {
  const start = Date.now();
  let lastLen = -1;
  let stableSince = Date.now();

  while (Date.now() - start < STABILITY_MAX_WAIT_MS) {
    const len = await page
      .evaluate(() => document.body && document.body.innerText.length)
      .catch(() => 0);

    if (len !== lastLen) {
      lastLen = len;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= STABILITY_PLATEAU_MS) {
      return { reason: 'stable', textLen: len };
    }
    await new Promise((r) => setTimeout(r, STABILITY_POLL_MS));
  }
  return { reason: 'timeout', textLen: lastLen };
}

async function settlePage(page) {
  await autoScroll(page);
  return waitForProductSignals(page);
}

module.exports = { autoScroll, waitForProductSignals, settlePage };
