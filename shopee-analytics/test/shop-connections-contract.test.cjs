'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const srcDir = path.join(__dirname, '..', 'src');
const webDir = path.join(__dirname, '..', 'web');

test('the connections state is served for every shop in one request', () => {
  const router = fs.readFileSync(path.join(srcDir, 'http-router.js'), 'utf8');
  assert.ok(router.includes("router.get('/shop-connections'"), 'the endpoint must exist');
  assert.ok(router.includes('getShopConnectionCoverage'), 'the coverage must be gathered in one pass');
  assert.ok(router.includes('authorizedShopIds') || router.includes('req.auth.shopIds'), 'the endpoint must respect shop access');
});

test('the settings menu carries both entries', () => {
  const auth = fs.readFileSync(path.join(webDir, 'auth-ui-v1.js'), 'utf8');
  assert.ok(auth.includes('data-admin-action="connections"'), 'the shop connections entry must exist');
  assert.ok(auth.includes('data-admin-action="platforms"'), 'the platform access entry must exist');
  assert.ok(auth.includes('window.ShopeeShopConnections'), 'the menu must reach the panel');
});

test('the toolbar link to the connections page is gone', () => {
  const index = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  assert.ok(!index.includes('id="connectionsLink"'), 'the toolbar link must be removed');
  assert.ok(index.includes('shop-connections-ui-v1.js'), 'the panel script must be loaded');
});

test('the shop page no longer carries its own authorization buttons', () => {
  const index = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
  assert.ok(!index.includes('storeErpAction'), 'the ERP button must be gone from the shop page');
  assert.ok(!index.includes('storeBrandPortalAction'), 'the Brand Portal button must be gone from the shop page');
  assert.ok(!app.includes('renderErpAction'), 'the dead renderer must be gone');
  assert.ok(!app.includes('renderBrandPortalAction'), 'the dead renderer must be gone');
});

test('the shop page still says when its figures are incomplete, and that label leads to the panel', () => {
  const index = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
  assert.ok(index.includes('id="storeBiStatus"'), 'the label must stay on the shop page');
  assert.ok(app.includes('window.ShopeeShopConnections?.open()'), 'the label must lead to the panel');
});

test('the panel escapes what it renders', () => {
  const panel = fs.readFileSync(path.join(webDir, 'shop-connections-ui-v1.js'), 'utf8');
  const match = panel.match(/function esc\(value\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'the panel must escape what it renders');
  const fn = new Function(`return (${match[0].replace('function esc', 'function')})`)();
  const escaped = fn('<script>"x" & \'y\'</script>');
  // The angle brackets, the ampersand and the quotes must all be entities.
  assert.ok(escaped.includes('&lt;script&gt;'), 'the angle brackets must be escaped');
  assert.ok(escaped.includes('&amp;'), 'the ampersand must be escaped');
  assert.ok(escaped.includes('&quot;x&quot;'), 'the double quotes must be escaped');
  assert.ok(escaped.includes('&#039;y&#039;'), 'the single quote must be escaped');
  assert.ok(!escaped.includes('<script>'), 'no raw tag may survive');
});
