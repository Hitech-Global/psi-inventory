'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const webDir = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');

const htmlIds = new Set(
  Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]),
);

const staticIdSelectors = new Set(
  Array.from(app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g), match => match[1]),
);

const missing = Array.from(staticIdSelectors).filter(id => !htmlIds.has(id)).sort();
assert.deepStrictEqual(
  missing,
  [],
  `app.js references DOM ids missing from index.html: ${missing.join(', ')}`,
);

const views = Array.from(html.matchAll(/data-view="([^"]+)"/g), match => match[1]);
for (const view of views) {
  assert(htmlIds.has(`view-${view}`), `missing view container #view-${view}`);
}

for (const required of [
  'countryFilter',
  'brandFilter',
  'shopSelect',
  'portfolioDiagnosisRows',
  'storeSummary',
  'storeTrendRows',
  'storeSkuRows',
  'campaignRows',
  'systemStatus',
]) {
  assert(htmlIds.has(required), `missing required frontend id ${required}`);
}

assert(
  !app.includes("$('[data-business-country]').forEach"),
  'business group rows must use querySelectorAll helper ($$), not single querySelector',
);

console.log(`shopee web contract tests: ok (${htmlIds.size} ids, ${staticIdSelectors.size} static selectors)`);
