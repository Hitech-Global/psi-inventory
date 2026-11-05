'use strict';

/**
 * The other applications are read as one table.
 *
 * Each application is a partner of its own and each has to be authorized
 * shop by shop. Listed as cards with a shop picker on top, a reader had
 * to pick a shop and then read one application at a time, and the column
 * saying what an application covers was squeezed into a single character
 * per line.
 *
 * The table is country, shop, application, what it covers, whether it is
 * authorized, and the door to make it so.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const source = read('web/platform-connections-ui-v1.js');
const styles = read('web/styles.css');
const router = read('src/http-router.js');

const test = () => {
  // ── 六列 ──────────────────────────────────────────────────────
  for (const key of ['colCountry', 'colShop', 'colApp', 'colScope', 'colState', 'colAction']) {
    assert(source.includes(key), `the table is missing the column ${key}`);
  }
  assert(source.includes('id="platformAppsHead"'), 'the table has no head');
  assert(source.includes('id="platformAppsTable"'), 'the table has no body');

  // ── 一行一个「店铺 × 应用」 ────────────────────────────────────
  assert(source.includes('for (const shop of shopList)'), 'the table does not go shop by shop');
  assert(source.includes('for (const app of SHOPEE_APPS)'), 'the table does not go application by application');
  assert(source.includes('`${entry.shopId}:${entry.role}`'), 'the state of a shop and an application is not matched up');
  // The shop is named on the row, so there is no picker any more.
  assert(!source.includes('platformAppsShop'), 'the shop picker is still there');
  assert(!source.includes('id="platformAppsList"'), 'the old list is still there');

  // ── 说明那一列不能被压成竖排 ──────────────────────────────────
  assert(styles.includes('.apps-note{'), 'the note column has no style');
  const noteStyle = styles.slice(styles.indexOf('.apps-note{'), styles.indexOf('.apps-note{') + 200);
  assert(noteStyle.includes('white-space:normal'), 'the note column does not wrap, so it reads one character per line');

  // ── 一次读全部店铺 ────────────────────────────────────────────
  assert(source.includes("request('/api/shopee-analytics/app/status-all')"), 'the table does not read every shop at once');
  // The endpoint answers for every shop when none is named.
  assert(router.includes("req.query.shop_id !== undefined && req.query.shop_id !== ''"), 'the endpoint cannot be asked for every shop');
  // And it answers only for the shops this reader may see.
  const route = router.slice(router.indexOf("router.get('/app/status-all'"), router.indexOf("router.get('/app/status-all'") + 1400);
  assert(route.includes('ROLE_SUPER_ADMIN'), 'the endpoint does not narrow the shops for an operator');
  assert(route.includes('req.auth.shopIds'), 'the endpoint does not narrow the shops for an operator');

  console.log('Apps table tests: ok');
};

test();
