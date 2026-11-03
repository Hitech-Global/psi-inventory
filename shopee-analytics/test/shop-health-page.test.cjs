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

test('the products can be put in order, and the ones that were lost are named', () => {
  const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  const funnelUi = fs.readFileSync(path.join(webDir, 'funnel-ui-v1.js'), 'utf8');
  const evaluation = require('../src/shop-health-evaluation');

  assert.ok(indexHtml.includes('id="funnelDropoffs"'), 'the list must have somewhere to go');
  assert.ok(funnelUi.includes('data-sort-key'), 'the headings must be clickable');
  assert.ok(funnelUi.includes('toggleProductSort'), 'clicking must change the order');
  assert.ok(funnelUi.includes('renderDropoffs'), 'the lost ones must be shown');

  // A figure the shop did not report is not a zero, so it goes to the end
  // whichever way the order runs.
  assert.ok(funnelUi.includes('leftMissing'), 'a missing figure must go to the end');

  // The rule: enough people put it in the basket for it to be a pattern,
  // and too few of them bought it for it to count as having been lost.
  const found = evaluation.findAddToCartDropoffs([
    { itemId: 'A', addToCartVisitors: 2367, buyers: 710 },
    { itemId: 'B', addToCartVisitors: 397, buyers: 75 },
    { itemId: 'C', addToCartVisitors: 20, buyers: 1 },
    { itemId: 'D', addToCartVisitors: 300, buyers: null },
  ]);
  const ids = found.map(row => row.itemId);
  assert.deepEqual(ids, ['A', 'B'], 'only the ones with enough in the basket and too few buying');
  assert.equal(found[0].lostVisitors, 1657);
  assert.equal(found[1].buyerRate < 0.4, true);
});

test('the products people looked at and left are named', () => {
  const evaluation = require('../src/shop-health-evaluation');
  const found = evaluation.findHighBounceLowConversion([
    // Drawn a crowd and sent it away again: 520 came, 211 left, two sold.
    { itemId: 'A', productVisitors: 520, bounceRate: 0.406, bounceVisitors: 211, unitsSold: 2 },
    // High bounce, but it sells: the rate is not the fault here.
    { itemId: 'B', productVisitors: 11619, bounceRate: 0.158, bounceVisitors: 1839, unitsSold: 1563 },
    // Two people and a high rate is not a pattern.
    { itemId: 'C', productVisitors: 50, bounceRate: 0.5, bounceVisitors: 25, unitsSold: 1 },
    // Nothing reported is not a fault either.
    { itemId: 'D', productVisitors: 800, bounceRate: null, unitsSold: null },
  ]);
  assert.deepEqual(found.map(row => row.itemId), ['A'],
    'only the one that drew a crowd and sent it away again');
  assert.equal(found[0].bounceVisitors, 211);
});

test('the products can be read as families, and the diagnosis says what they say', () => {
  const router = fs.readFileSync(path.join(srcDir, 'http-router.js'), 'utf8');
  const repository = fs.readFileSync(path.join(srcDir, 'shop-health-repository.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
  const diagnosis = require('../src/portfolio-diagnosis');

  assert.ok(repository.includes('async listProductTrafficByParentSku'), 'the families must be readable');
  assert.ok(router.includes('by_parent'), 'the route must offer them');
  assert.ok(appJs.includes('by_parent=1'), 'the page must ask for them');
  // The figures come from the products' own rows: a product's row already
  // says what its variations said together, so adding both counts twice.
  assert.ok(repository.includes('rowKind: \'PRODUCT\''), 'the families must be built from the products\' rows');

  // What the products say reaches the diagnosis, and it is said without
  // guessing why.
  const result = diagnosis.diagnoseRow({ sales: 100 }, { sales: 80 }, {
    products: [
      { itemId: 'A', itemName: 'A', addToCartVisitors: 2367, buyers: 710 },
      { itemId: 'B', itemName: 'B', productVisitors: 520, bounceRate: 0.406, bounceVisitors: 211, unitsSold: 2 },
    ],
  });
  const codes = result.signals.map(entry => entry.code);
  assert.ok(codes.includes('ADD_TO_CART_NOT_CONVERTED'), 'the basket that was not bought must be said');
  assert.ok(codes.includes('HIGH_BOUNCE_LOW_CONVERSION'), 'the pages that sent people away must be said');
  assert.ok(result.productDiagnosis, 'the products themselves must be named');
});
