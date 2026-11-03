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

test('the page tells the platform\'s standard from the figure', () => {
  const healthUi = fs.readFileSync(path.join(webDir, 'shop-health-ui-v1.js'), 'utf8');
  assert.ok(healthUi.includes('target'), 'the standard must be shown with the figure');
  assert.ok(healthUi.includes('exportCsv'), 'the page must offer an export');
  assert.ok(healthUi.includes('text/csv'), 'the export must be a csv');
});
