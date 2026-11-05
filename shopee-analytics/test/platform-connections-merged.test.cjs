'use strict';

/**
 * Every platform is connected in one place.
 *
 * The shop connections used to open in a panel over the application
 * while the platforms were connected on a page of their own. They are
 * now on that page, so the reader has one place to go rather than two
 * that each hold half of it.
 *
 * A reader who is sent to the platform page from inside the application
 * must find their way back, so the way back is remembered.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const pageSource = read('web/connections.html');
const appSource = read('web/app.js');
const panelSource = read('web/shop-connections-ui-v1.js');

const test = () => {
  // ── 平台接入页上有店铺连接 ────────────────────────────────────
  assert(pageSource.includes('id="shopeeShopConnectionsBody"'), 'the page has no place for the shop connections');
  assert(pageSource.includes('/api/shopee-analytics/shop-connections'), 'the page does not read the shop connections');
  assert(pageSource.includes('/shop-connections-ui-v1.js'), 'the shared rendering is not loaded');
  // The shared rendering is loaded before the script that uses it.
  assert(
    pageSource.indexOf('/shop-connections-ui-v1.js') < pageSource.indexOf('async function loadShopConnections'),
    'the shared rendering must be loaded before it is used',
  );
  // A failure is said out loud rather than left as a blank.
  assert(pageSource.includes('读取失败'), 'a failure to read is not shown');

  // ── 三扇门都在 ────────────────────────────────────────────────
  assert(pageSource.includes('/api/shopee-analytics/erp/oauth/start'), 'the ERP door is missing');
  assert(pageSource.includes('/api/shopee-analytics/brand-portal/oauth/start'), 'the Brand Portal door is missing');
  assert(pageSource.includes('/api/shopee-analytics/shop/oauth/start'), 'the video and livestream door is missing');

  // ── 共享的渲染被导出 ──────────────────────────────────────────
  assert(panelSource.includes('renderBody,'), 'the rendering is not shared');
  assert(panelSource.includes('window.ShopeeShopConnections'), 'the panel does not export itself');

  // ── 主应用的入口指向同一个地方 ────────────────────────────────
  assert(appSource.includes('function goToPlatformConnections'), 'the way to the platform page is missing');
  assert(appSource.includes('/connections.html'), 'the platform page is not where the reader is sent');
  assert(
    appSource.includes('platformConnectionsReturn'),
    'the way back is not remembered',
  );
  // The panel over the application is no longer opened from anywhere.
  assert(
    !/ShopeeShopConnections\?\.open\(\)/.test(appSource),
    'the old panel is still opened somewhere',
  );

  console.log('Platform connections merged tests: ok');
};

test();
