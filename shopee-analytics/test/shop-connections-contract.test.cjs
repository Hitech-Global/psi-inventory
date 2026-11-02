'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const srcDir = path.join(__dirname, '..', 'src');
const webDir = path.join(__dirname, '..', 'web');

/**
 * Load the panel in a window of its own and hand back its shop renderer.
 *
 * The panel is written for the browser, so it is loaded the way the browser
 * loads it — as a function with a window to put itself on — rather than
 * being pulled apart and reassembled.
 */
function loadPanelRenderer() {
  const source = fs.readFileSync(path.join(webDir, 'shop-connections-ui-v1.js'), 'utf8');
  const fakeWindow = {};
  new Function('window', source)(fakeWindow);
  assert.ok(fakeWindow.ShopeeShopConnections, 'the panel must put itself on the window');
  return fakeWindow.ShopeeShopConnections.renderShop;
}

test('the connections state is served for every shop in one request', () => {
  const router = fs.readFileSync(path.join(srcDir, 'http-router.js'), 'utf8');
  assert.ok(router.includes("router.get('/shop-connections'"), 'the endpoint must exist');
  assert.ok(router.includes('getShopConnectionCoverage'), 'the coverage must be gathered in one pass');
  assert.ok(router.includes('authorizedShopIds') || router.includes('req.auth.shopIds'), 'the endpoint must respect shop access');
});

test('the settings menu carries both entries', () => {
  const auth = fs.readFileSync(path.join(webDir, 'auth-ui-v1.js'), 'utf8');
  const index = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  assert.ok(index.includes('data-side-action="shop-connections"'), 'the shop connections entry must exist');
  assert.ok(index.includes('data-side-platform="tiktok"'), 'the tiktok entry must exist');
  assert.ok(auth.includes('side-item[data-admin-action]'), 'the administrative entries must be reachable');
  assert.ok(auth.includes('.sidebar-foot'), 'the reader menu must sit in the sidebar');
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

test('the panel says what is missing and what can be done about it', () => {
  const renderShop = loadPanelRenderer();

  const empty = renderShop({
    shopId: 1326456001,
    displayName: 'Shop A',
    countryName: 'Indonesia',
    brandName: 'Netac',
    shopBi: { days: 0, latestDate: null },
    livestream: { days: 0, latestDate: null },
    returns: { rows: 0, latestDate: null },
    erp: { credentialConfigured: true, tokenPresent: false, redirectUrl: 'https://x/cb' },
    brandPortal: { credentialConfigured: true, tokenPresent: false, redirectUrl: 'https://x/cb' },
  });
  assert.ok(empty.includes('待授权'), 'a shop with nothing connected must be waiting for one');
  assert.ok(empty.includes('data-connect="erp"'), 'the returns connection must be offered');
  assert.ok(empty.includes('data-connect="brand-portal"'), 'the shop report connection must be offered');
  assert.ok(empty.includes('Indonesia · Netac · Shop A'), 'the shop must be named');

  const connected = renderShop({
    shopId: 1,
    displayName: 'Shop B',
    shopBi: { days: 30, latestDate: '2026-11-01' },
    livestream: { days: 30, latestDate: '2026-11-01' },
    returns: { rows: 12, latestDate: '2026-11-01' },
    erp: { credentialConfigured: true, tokenPresent: true, tokenExpiresAt: '2026-12-01T00:00:00Z' },
    brandPortal: { credentialConfigured: true, tokenPresent: true },
  });
  assert.ok(connected.includes('已同步 30 天'), 'a connected shop must say so');
  assert.ok(!connected.includes('data-connect='), 'a connected shop must not be offered a connection');
});

test('a shop whose credential is missing is told that before being offered a button', () => {
  const renderShop = loadPanelRenderer();

  const rendered = renderShop({
    shopId: 1,
    displayName: 'Shop C',
    shopBi: { days: 0 },
    livestream: { days: 0 },
    returns: { rows: 0 },
    erp: { credentialConfigured: false, tokenPresent: false },
    brandPortal: { credentialConfigured: false, tokenPresent: false },
  });
  assert.ok(rendered.includes('未配置凭据'), 'the missing credential must be named');
  assert.ok(!rendered.includes('data-connect='), 'no button may be offered when it cannot work');
});

test('a connected shop is told it needs no attention, not when its token expires', () => {
  const renderShop = loadPanelRenderer();
  const rendered = renderShop({
    shopId: 1,
    displayName: 'Shop D',
    shopBi: { days: 30, latestDate: '2026-11-01' },
    livestream: { days: 30 },
    returns: { rows: 5 },
    erp: { credentialConfigured: true, tokenPresent: true, tokenExpiresAt: '2026-11-02T10:10:00Z' },
    brandPortal: { credentialConfigured: true, tokenPresent: true },
  });
  // The access token is replaced every few hours; showing its expiry would
  // read as a deadline the reader has to act on.
  assert.ok(!rendered.includes('令牌到期'), 'the access token expiry must not be shown');
  assert.ok(rendered.includes('自动续期'), 'the reader must be told nothing is needed');
});

test('a connection whose renewal failed is marked as needing the authorization again', () => {
  const renderShop = loadPanelRenderer();
  const rendered = renderShop({
    shopId: 1,
    displayName: 'Shop E',
    shopBi: { days: 0 },
    livestream: { days: 0 },
    returns: { rows: 0 },
    erp: { credentialConfigured: true, tokenPresent: true, tokenRefreshError: 'refresh rejected' },
    brandPortal: { credentialConfigured: true, tokenPresent: true, tokenRefreshError: 'refresh rejected' },
  });
  assert.ok(rendered.includes('需重新授权'), 'the stale connection must be marked');
  assert.ok(rendered.includes('重新授权'), 'a way to fix it must be offered');
});
