// journey-screenshot.js
// Screenshots data-driven pages (establishment + its trust) that don't exist as
// static template files — by driving the GIAS prototype like a real user:
// search  ->  click a result  ->  screenshot establishment  ->  follow trust link -> screenshot.
//
// Usage: start the prototype (npm start), then in a second terminal: node journey-screenshot.js
// Requires: npm install --save-dev puppeteer

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// ---- Config -----------------------------------------------------
const BASE_URL   = 'http://localhost:3000';
const OUT_DIR    = path.join(__dirname, 'screenshots');
const WIDTHS     = { mobile: 375, desktop: 1280 };
const SETTLE_MS  = 400;

// Selectors — filled in from the prototype's actual markup:
//   search "What" field is  name="q"  id="search-what"   (search.html)
//   result links are        a.govuk-link -> /establishment/{id}   (results.html)
//   the trust link on an establishment page is an  a[href*="/establishment/"]
//     whose id differs from the current one (it points at the group UID).
const SELECTORS = {
  searchInput:  '#search-what',
  searchSubmit: 'button.govuk-button',
  resultLinks:  'a.govuk-link[href*="/establishment/"]',
};

// One entry per journey. `term` goes into the "What" box. `followTrust` decides
// whether we hop to the establishment's trust and screenshot that too.
const JOURNEYS = [
  { term: 'academy', name: 'establishment_academy', followTrust: true },
  // Add more journeys as needed, e.g.:
  // { term: 'community school', name: 'establishment_maintained', followTrust: false },
  // { term: 'federation',       name: 'establishment_federation', followTrust: true },
];
// -----------------------------------------------------------------

async function shootAllWidths (page, baseName) {
  for (const [label, width] of Object.entries(WIDTHS)) {
    await page.setViewport({ width, height: 800 });
    await new Promise(r => setTimeout(r, SETTLE_MS)); // let reflow settle
    const out = path.join(OUT_DIR, `${baseName}__${label}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`  \u2713  ${path.basename(out)}`);
  }
}

// Extract the numeric id from a /establishment/{id} href.
function idFromHref (href) {
  const m = href.match(/\/establishment\/([^?#/]+)/);
  return m ? m[1] : null;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  for (const journey of JOURNEYS) {
    console.log(`\nJourney: search "${journey.term}"`);
    try {
      // 1. Load the search page and run the search.
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(BASE_URL + '/search', { waitUntil: 'networkidle0' });
      await page.waitForSelector(SELECTORS.searchInput, { timeout: 10000 });
      await page.type(SELECTORS.searchInput, journey.term);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }),
        page.click(SELECTORS.searchSubmit),
      ]);

      // 2. Collect result establishment links (skip group/trust links in the
      //    "part of" column by taking the first result-row link).
      const establishmentId = await page.evaluate((sel) => {
        const a = document.querySelector(sel);
        return a ? a.getAttribute('href') : null;
      }, SELECTORS.resultLinks);

      if (!establishmentId) {
        console.log('  \u26a0  no results found — skipped');
        continue;
      }

      // 3. Navigate to the establishment page and screenshot it.
      const estId = idFromHref(establishmentId);
      await page.goto(`${BASE_URL}/establishment/${estId}`, { waitUntil: 'networkidle0' });
      await shootAllWidths(page, journey.name);

      // 4. Follow the trust link if asked. The trust link points at a different
      //    /establishment/{group_uid}, so find the first such link whose id
      //    isn't the current establishment.
      if (journey.followTrust) {
        const trustHref = await page.evaluate((estId) => {
          const links = Array.from(document.querySelectorAll('a[href*="/establishment/"]'));
          for (const a of links) {
            const m = a.getAttribute('href').match(/\/establishment\/([^?#/]+)/);
            if (m && m[1] !== estId) return a.getAttribute('href');
          }
          return null;
        }, estId);

        if (trustHref) {
          const trustId = idFromHref(trustHref);
          await page.goto(`${BASE_URL}/establishment/${trustId}`, { waitUntil: 'networkidle0' });
          await shootAllWidths(page, journey.name + '__trust');
        } else {
          console.log('  \u26a0  no trust link on this establishment — skipped trust shot');
        }
      }
    } catch (err) {
      console.log(`  \u2717  journey failed — ${err.message}`);
    }
  }

  await browser.close();
  console.log(`\nDone. Saved to ${OUT_DIR}`);
})();
