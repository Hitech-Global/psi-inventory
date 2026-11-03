'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webDir = path.join(__dirname, '..', 'web');
const srcDir = path.join(__dirname, '..', 'src');

test('the page is wired into the shell', () => {
  const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(srcDir, 'standalone-server.js'), 'utf8');

  assert.ok(indexHtml.includes('data-view="health"'), 'the tab must exist');
  assert.ok(indexHtml.includes('id="view-health"'), 'the view must exist');
  assert.ok(indexHtml.includes('/shop-health-ui-v1.js'), 'the page script must be loaded');
  assert.ok(appJs.includes("'health'"), 'the view must be one the shell knows');
  assert.ok(appJs.includes('loadShopHealth()'), 'the view must load');
  assert.ok(appJs.includes('/api/shopee-analytics/shop-health'), 'the view must call the endpoint');
  assert.ok(serverJs.includes('/shop-health-ui-v1.js'), 'the script must be served');
});

test('the endpoint is registered and answers for every visible shop', () => {
  const router = fs.readFileSync(path.join(srcDir, 'http-router.js'), 'utf8');
  assert.ok(router.includes("router.get('/shop-health'"), 'the route must exist');
  // An operator sees only the shops assigned to them.
  assert.ok(router.includes('req.auth.shopIds'), 'the route must narrow to the shops the reader may see');
});

test('the route is given the repository it uses', () => {
  const router = fs.readFileSync(path.join(srcDir, 'http-router.js'), 'utf8');
  const server = fs.readFileSync(path.join(srcDir, 'standalone-server.js'), 'utf8');
  // A route that uses something the router was not given fails at runtime
  // with a name nobody recognises, and the page it belongs to simply stays
  // empty.
  const factory = router.slice(router.indexOf('function createShopeeAnalyticsRouter'));
  const parameters = factory.slice(0, factory.indexOf('}) {') + 2);
  assert.ok(parameters.includes('shopHealthRepository'), 'the router must be given the health registry');
  assert.ok(server.includes('shopHealthRepository,'), 'the server must pass the health registry on');
  assert.ok(server.includes('new ShopeeShopHealthRepository({ pool })'), 'the server must build it');
});

test('the page tells the platform\'s standard from the figure', () => {
  const healthUi = fs.readFileSync(path.join(webDir, 'shop-health-ui-v1.js'), 'utf8');
  assert.ok(healthUi.includes('target'), 'the standard must be shown with the figure');
  // The detail names the measure as the page names it, not by the key it is
  // stored under.
  assert.ok(healthUi.includes('measureLabels[event.metricKey]'), 'the detail must name the measure the way the page names it');
  // The summary counts the shops, the table lists them; the two must not
  // claim the same thing under different names.
  assert.ok(healthUi.includes("label: '店铺总数'"), 'the summary must count the shops');
  // The standard is written the same way as the figure: a standard of five
  // per cent must not be shown as a fifth of a per cent, or the two cannot
  // be read against each other.
  assert.ok(healthUi.includes('formatValue(measure.target, measure.kind)'), 'the standard must be written the way the figure is');
  assert.ok(healthUi.includes('exportCsv'), 'the page must offer an export');
  assert.ok(healthUi.includes('text/csv'), 'the export must be a csv');
});

test('the page lists every shop, whether or not it has been read yet', () => {
  const router = fs.readFileSync(path.join(srcDir, 'http-router.js'), 'utf8');
  // The page is about the shops. A shop that has not been read yet is part
  // of the answer, not an omission from it — and a table of gaps would read
  // as a shop that was measured and found wanting.
  assert.ok(router.includes('rows: allShops'), 'the table must list the shops without readings too');
  assert.ok(router.includes("status: 'unconnected'"), 'a shop without a reading must say so');
});

test('what the products drew is shown on the funnel page', () => {
  const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  const funnelUi = fs.readFileSync(path.join(webDir, 'funnel-ui-v1.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
  assert.ok(indexHtml.includes('id="funnelProductsPanel"'), 'the panel must exist');
  assert.ok(indexHtml.includes('id="funnelProductsBody"'), 'the table must exist');
  assert.ok(funnelUi.includes('renderProducts'), 'the panel must be filled');
  assert.ok(funnelUi.includes('addToCartVisitors'), 'the basket must be shown');
  assert.ok(funnelUi.includes('productPageViews'), 'the pages must be shown');
  assert.ok(funnelUi.includes('likes'), 'what was saved must be shown');
  assert.ok(appJs.includes('/api/shopee-analytics/product-traffic'), 'the panel must ask for them');
  // These are the figures for the whole period, not for each day, and the
  // page has to say so — otherwise they are read against the days above.
  assert.ok(funnelUi.includes('不是逐日数据'), 'the page must say the figures are for the period');
});
