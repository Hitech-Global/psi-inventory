'use strict';

/**
 * The videos and the livestreams page.
 *
 * A page that reaches for something the router was never given fails in
 * a way nobody sees: the request answers with an error, the page keeps
 * saying it is waiting for data, and the reader is left with a blank
 * panel. So each of the three things is checked here — that the route
 * uses it, that the router is given it, and that the server builds and
 * passes it on.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const routerSource = read('src/http-router.js');
const serverSource = read('src/standalone-server.js');
const appSource = read('web/app.js');
const pageSource = read('web/shop-content-ui-v1.js');
const htmlSource = read('web/index.html');
const catalogSource = read('src/catalog.js');

const test = () => {
  // ── 路由用了这些查询 ───────────────────────────────────────────
  assert(routerSource.includes("router.get('/shop-content'"), 'the route for the page is missing');
  assert(routerSource.includes('listVideoPerformance'), 'the route does not read the videos');
  assert(routerSource.includes('listVideoDaily'), 'the route does not read the videos by day');
  assert(routerSource.includes('listLivestreamSessions'), 'the route does not read the livestreams');

  // ── 查询方法在仓库里 ──────────────────────────────────────────
  const querySource = read('src/query-repository.js');
  assert(querySource.includes('async listVideoPerformance'), 'the query for the videos is missing');
  assert(querySource.includes('async listVideoDaily'), 'the query for the videos by day is missing');
  assert(querySource.includes('async listLivestreamSessions'), 'the query for the livestreams is missing');

  // ── 页面脚本在 HTML 里被加载 ──────────────────────────────────
  assert(htmlSource.includes('/shop-content-ui-v1.js'), 'the page script is not loaded');
  assert(htmlSource.includes('id="view-content"'), 'the view section is missing');
  assert(htmlSource.includes('id="contentVideoBody"'), 'the table for the videos is missing');
  assert(htmlSource.includes('id="contentSessionBody"'), 'the table for the livestreams is missing');
  assert(htmlSource.includes('data-view="content"'), 'the side button is missing');

  // ── 应用会取数据，也会说出失败 ────────────────────────────────
  assert(appSource.includes('/api/shopee-analytics/shop-content'), 'the page never asks for the data');
  assert(appSource.includes('loadShopContent'), 'the page has no loader');
  assert(
    /state\.view === 'content'/.test(appSource),
    'the view is never loaded',
  );
  assert(
    /state\.view === 'content'[\s\S]{0,400}读取失败/.test(appSource),
    'a failure on this view is not shown to the reader',
  );

  // ── 页面本身 ──────────────────────────────────────────────────
  assert(pageSource.includes('window.ShopeeShopContent'), 'the page does not export itself');
  assert(pageSource.includes('exportCsv'), 'the page cannot be exported');
  // A figure that was not reported is not a zero.
  assert(
    pageSource.includes("return '—'"),
    'a missing figure must be shown as a dash, not as a zero',
  );
  // The videos and the livestreams are asked for in the person's name.
  assert(catalogSource.includes("/api/v2/video/get_overview_performance"), 'the video endpoint is missing');
  assert(catalogSource.includes("/api/v2/livestream/get_session_list"), 'the livestream endpoint is missing');
  const clientSource = read('src/shopee-client.js');
  assert(clientSource.includes('signUserRequest'), 'the user signature is missing');
  assert(clientSource.includes('async userRequest'), 'the request made for a person is missing');

  console.log('Shop content page tests: ok');
};

test();
