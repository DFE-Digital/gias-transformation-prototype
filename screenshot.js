// screenshot.js
// Screenshots every GOV.UK Prototype Kit page at mobile + desktop widths.
// Usage: start your prototype (npm start), then in a second terminal: node screenshot.js

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// ---- Config -----------------------------------------------------
const BASE_URL   = 'http://localhost:3000';   // change if your prototype runs elsewhere
const VIEWS_DIR  = path.join(__dirname, 'app', 'views');
const OUT_DIR    = path.join(__dirname, 'screenshots');
const WIDTHS     = { mobile: 375, desktop: 1280 };
const HEIGHT     = 800;                        // starting height; full-page capture overrides this
const SETTLE_MS  = 400;                        // pause after load for fonts/JS to settle
// -----------------------------------------------------------------

// Recursively collect .html files, skipping partials/layouts and includes folders.
function findTemplates(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['includes', 'partials', 'layouts', '_templates'].includes(entry.name)) continue;
      findTemplates(full, found);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      // skip layout/partial files (convention: start with _ or named layout)
      if (entry.name.startsWith('_') || entry.name === 'layout.html') continue;
      found.push(full);
    }
  }
  return found;
}

// Turn a template file path into a route the Prototype Kit serves.
function fileToRoute(file) {
  let rel = path.relative(VIEWS_DIR, file).replace(/\\/g, '/'); // windows-safe
  rel = rel.replace(/\.html$/, '');
  rel = rel.replace(/\/index$/, '');   // index.html -> parent folder
  if (rel === 'index') rel = '';
  return '/' + rel;
}

// Safe filename from a route.
function routeToName(route) {
  const clean = route.replace(/^\//, '').replace(/\//g, '__') || 'home';
  return clean;
}

(async () => {
  if (!fs.existsSync(VIEWS_DIR)) {
    console.error(`Could not find ${VIEWS_DIR}. Run this from your prototype root.`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const routes = [...new Set(findTemplates(VIEWS_DIR).map(fileToRoute))].sort();
  console.log(`Found ${routes.length} pages.\n`);

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  const failures = [];

  for (const route of routes) {
    const url = BASE_URL + route;
    const name = routeToName(route);

    for (const [label, width] of Object.entries(WIDTHS)) {
      await page.setViewport({ width, height: HEIGHT });
      try {
        const res = await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
        if (res && res.status() >= 400) {
          console.log(`  ⚠  ${route} returned ${res.status()} — skipped`);
          failures.push(`${route} (${res.status()})`);
          break; // don't retry the other width for a broken route
        }
        await new Promise(r => setTimeout(r, SETTLE_MS));
        const out = path.join(OUT_DIR, `${name}__${label}.png`);
        await page.screenshot({ path: out, fullPage: true });
        console.log(`  ✓  ${name}__${label}.png`);
      } catch (err) {
        console.log(`  ✗  ${route} (${label}) — ${err.message}`);
        failures.push(`${route} (${label})`);
      }
    }
  }

  await browser.close();

  console.log(`\nDone. Saved to ${OUT_DIR}`);
  if (failures.length) {
    console.log(`\n${failures.length} page(s) had problems:`);
    failures.forEach(f => console.log('  - ' + f));
  }
})();