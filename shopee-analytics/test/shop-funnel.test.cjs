'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildDayMetrics,
  buildFunnelRows,
  computeChange,
  divide,
  missingSources,
  toNumber,
} = require('../src/shop-funnel');

const webDir = path.join(__dirname, '..', 'web');
const srcDir = path.join(__dirname, '..', 'src');

function row(overrides = {}) {
  return {
    eventDate: '2026-11-01',
    sales: null,
    orders: null,
    productClicks: null,
    productViews: null,
    uniqueVisitors: null,
    orderConversionRate: null,
    adsExpense: 0,
    paidOrders: 0,
    cancelledOrders: 0,
    orderGmv: 0,
    cancelledSales: 0,
    refundOrders: 0,
    refundAmount: 0,
    ...overrides,
  };
}

test('toNumber keeps missing values missing', () => {
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber('42'), 42);
  assert.equal(toNumber(0), 0);
});

test('divide refuses to divide by nothing', () => {
  assert.equal(divide(10, 2), 5);
  assert.equal(divide(10, 0), null);
  assert.equal(divide(null, 2), null);
  assert.equal(divide(10, null), null);
});

test('shop total is preferred over the order records for gmv and orders', () => {
  const metrics = buildDayMetrics(row({ sales: 500, orders: 12, orderGmv: 480, paidOrders: 11 }));
  assert.equal(metrics.gmv, 500);
  assert.equal(metrics.order, 12);
});

test('order records stand in when the shop total has not arrived', () => {
  const metrics = buildDayMetrics(row({ sales: null, orders: null, orderGmv: 480, paidOrders: 11 }));
  assert.equal(metrics.gmv, 480);
  assert.equal(metrics.order, 11);
});

test('conversion rate comes from the shop report when present, otherwise from the funnel itself', () => {
  const reported = buildDayMetrics(row({ orderConversionRate: 0.0421, orders: 10, uniqueVisitors: 200 }));
  assert.equal(reported.conversionRate, 0.0421);

  const derived = buildDayMetrics(row({ orderConversionRate: null, orders: 10, uniqueVisitors: 200 }));
  assert.equal(derived.conversionRate, 0.05);
});

test('ctr is clicks over views and is empty without views', () => {
  assert.equal(buildDayMetrics(row({ productClicks: 30, productViews: 1000 })).ctr, 0.03);
  assert.equal(buildDayMetrics(row({ productClicks: 30, productViews: 0 })).ctr, null);
  assert.equal(buildDayMetrics(row({ productClicks: null, productViews: 1000 })).ctr, null);
});

test('change against the previous day is signed and refuses a zero baseline', () => {
  assert.equal(computeChange(120, 100), 0.2);
  assert.equal(computeChange(80, 100), -0.2);
  assert.equal(computeChange(120, 0), null);
  assert.equal(computeChange(null, 100), null);
  assert.equal(computeChange(120, null), null);
});

test('the table lays out days across and metrics down', () => {
  const { dates, rows } = buildFunnelRows([
    row({ eventDate: '2026-11-01', uniqueVisitors: 100, orders: 5, sales: 1000 }),
    row({ eventDate: '2026-11-02', uniqueVisitors: 150, orders: 9, sales: 1500 }),
  ]);

  assert.deepEqual(dates, ['2026-11-01', '2026-11-02']);

  const visitor = rows.find(item => item.key === 'visitor');
  assert.deepEqual(visitor.values, [100, 150]);

  const gmv = rows.find(item => item.key === 'gmv');
  assert.deepEqual(gmv.values, [1000, 1500]);
});

test('the change rows sit above the body and compare with the previous day', () => {
  const { rows } = buildFunnelRows([
    row({ eventDate: '2026-11-01', orders: 10, sales: 1000 }),
    row({ eventDate: '2026-11-02', orders: 12, sales: 1100 }),
  ]);

  const orderChange = rows.find(item => item.key === 'orderDelta');
  const gmvChange = rows.find(item => item.key === 'gmvDelta');
  assert.deepEqual(orderChange.values, [null, 0.2]);
  assert.deepEqual(gmvChange.values, [null, 0.1]);

  const changeIndex = rows.findIndex(item => item.kind === 'change');
  const bodyIndex = rows.findIndex(item => item.kind === 'body');
  assert.ok(changeIndex < bodyIndex, 'change rows must come before the body');
});

test('a metric whose source is empty reads as missing rather than as zero', () => {
  const { rows } = buildFunnelRows([row({ eventDate: '2026-11-01' })], { shopReport: true, returns: true, orderAmounts: true });
  const visitor = rows.find(item => item.key === 'visitor');
  const refund = rows.find(item => item.key === 'refundOrder');
  assert.equal(visitor.values[0], null);
  assert.equal(refund.values[0], 0, 'a source that was read but held nothing is zero, not missing');
});

test('missing sources are reported so the blanks are explained', () => {
  // Neither the shop report nor the returns have been filled in for this
  // shop, so both halves of the funnel read as missing rather than zero.
  const { rows } = buildFunnelRows(
    [row({ eventDate: '2026-11-01' })],
    { shopReport: false, returns: false, orderAmounts: false },
  );
  const missing = missingSources(rows);
  const sources = missing.map(entry => entry.source);
  assert.ok(sources.some(source => source.includes('Business Insights')));
  assert.ok(sources.some(source => source.includes('退货')));
});

test('a missing source says what to do about it', () => {
  const { rows } = buildFunnelRows(
    [row({ eventDate: '2026-11-01' })],
    { shopReport: false, returns: false, orderAmounts: false },
  );
  const missing = missingSources(rows);
  // Every gap must carry a remedy, otherwise the reader is left with a
  // blank cell and no idea what to do about it.
  for (const entry of missing) {
    assert.ok(entry.action, `${entry.source} must say what to do`);
    assert.ok(entry.action.length > 10, 'the remedy must actually say something');
  }
  const brandPortal = missing.find(entry => entry.source.includes('Brand Portal'));
  assert.ok(brandPortal.action.includes('Brand Portal'), 'the remedy must name the connection to make');
});

test('a source that has never been filled in reads as missing, not as zero', () => {
  const { rows } = buildFunnelRows(
    [row({ eventDate: '2026-11-01', paidOrders: 0, orderGmv: 0 })],
    { shopReport: false, returns: false, orderAmounts: false },
  );
  assert.equal(rows.find(item => item.key === 'visitor').values[0], null);
  assert.equal(rows.find(item => item.key === 'refundOrder').values[0], null);
  assert.equal(rows.find(item => item.key === 'refundGmv').values[0], null);
});

test('a source that has been filled in reads as zero on a day with nothing in it', () => {
  const { rows } = buildFunnelRows(
    [row({ eventDate: '2026-11-01' })],
    { shopReport: true, returns: true, orderAmounts: true },
  );
  assert.equal(rows.find(item => item.key === 'refundOrder').values[0], 0);
});

test('orders recorded without an amount leave the sales figures empty', () => {
  // The order records in this environment carry a number and a state but no
  // amount, so there is no sales figure to report and none should be invented.
  const { rows } = buildFunnelRows(
    [row({ eventDate: '2026-11-01', paidOrders: 80, cancelledOrders: 16 })],
    { shopReport: false, returns: false, orderAmounts: false },
  );
  assert.equal(rows.find(item => item.key === 'gmv').values[0], null);
  assert.equal(rows.find(item => item.key === 'cancelledSales').values[0], null);
  assert.equal(rows.find(item => item.key === 'order').values[0], 80);
  assert.equal(rows.find(item => item.key === 'cancelledOrder').values[0], 16);
});

test('the sales source is named when neither the report nor the amounts are there', () => {
  const { rows } = buildFunnelRows(
    [row({ eventDate: '2026-11-01' })],
    { shopReport: false, returns: false, orderAmounts: false },
  );
  const missing = missingSources(rows).map(entry => entry.source);
  assert.ok(missing.some(source => source.includes('销售额')));
});

test('a source that has arrived is not reported as missing', () => {
  const { rows } = buildFunnelRows([
    row({ eventDate: '2026-11-01', uniqueVisitors: 100, productViews: 900, productClicks: 30 }),
  ], { shopReport: true, returns: true, orderAmounts: true });
  const missing = missingSources(rows);
  assert.ok(!missing.some(entry => entry.source.includes('Business Insights')));
});

test('livestream figures are present when the source has been filled in', () => {
  const { rows } = buildFunnelRows([
    row({
      eventDate: '2026-11-01',
      liveSessions: 3,
      liveHours: 2.5,
      liveViews: 1200,
      liveViewers: 340,
      liveConfirmedOrders: 21,
      liveConfirmedSales: 56000,
    }),
  ], { shopReport: true, returns: true, orderAmounts: true, livestream: true });

  const hours = rows.find(item => item.key === 'liveHours');
  const viewers = rows.find(item => item.key === 'liveViewers');
  const sales = rows.find(item => item.key === 'liveConfirmedSales');
  assert.equal(hours.values[0], 2.5);
  assert.equal(viewers.values[0], 340);
  assert.equal(sales.values[0], 56000);
});

test('livestream figures are missing when the source has not been filled in', () => {
  const { rows } = buildFunnelRows(
    [row({ eventDate: '2026-11-01' })],
    { shopReport: false, returns: false, orderAmounts: false, livestream: false },
  );
  assert.equal(rows.find(item => item.key === 'liveHours').values[0], null);
  assert.equal(rows.find(item => item.key === 'liveViewers').values[0], null);

  const missing = missingSources(rows).map(entry => entry.source);
  assert.ok(missing.some(source => source.includes('直播')));
});

test('the page is wired into the shell', () => {
  const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(srcDir, 'standalone-server.js'), 'utf8');

  assert.ok(indexHtml.includes('data-view="funnel"'), 'the tab must exist');
  assert.ok(indexHtml.includes('id="view-funnel"'), 'the view must exist');
  assert.ok(indexHtml.includes('/funnel-ui-v1.js'), 'the page script must be loaded');
  // The views are checked one by one rather than as a run of text: adding
  // a view between two of them would otherwise look like a broken shell.
  assert.ok(appJs.includes("'funnel'"), 'the view must be one the shell knows');
  assert.ok(appJs.includes("'status'"), 'the view must be one the shell knows');
  assert.ok(appJs.includes('loadFunnel()'), 'the view must load');
  assert.ok(appJs.includes('/api/shopee-analytics/funnel'), 'the view must call the endpoint');
  assert.ok(serverJs.includes('/funnel-ui-v1.js'), 'the script must be served');
});

test('the endpoint is registered and checks shop access', () => {
  const router = fs.readFileSync(path.join(srcDir, 'http-router.js'), 'utf8');
  assert.ok(router.includes("router.get('/funnel'"), 'the route must exist');
  assert.ok(router.includes('assertShopAccess(req, shopId)'), 'the route must check shop access');
});

test('the page can be exported as a sheet', () => {
  const funnelUi = fs.readFileSync(path.join(webDir, 'funnel-ui-v1.js'), 'utf8');
  assert.ok(funnelUi.includes('exportCsv'), 'the page must offer an export');
  assert.ok(funnelUi.includes('text/csv'), 'the export must be a csv');
});

test('every reading the funnel takes is carried over from the query', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const query = fs.readFileSync(path.join(__dirname, '..', 'src', 'query-repository.js'), 'utf8');
  const funnel = fs.readFileSync(path.join(__dirname, '..', 'src', 'shop-funnel.js'), 'utf8');

  const start = query.indexOf('getShopFunnelDaily');
  const mapping = query.slice(query.indexOf('const days = result.rows.map', start), query.indexOf('return { days, sources }', start));
  const carried = new Set((mapping.match(/^\s+(\w+):/gm) || []).map(part => part.trim().replace(':', '')));

  const build = funnel.slice(funnel.indexOf('function buildDayMetrics'), funnel.indexOf('function buildFunnelRows'));
  const wanted = new Set((build.match(/row\.(\w+)/g) || []).map(part => part.slice(4)));

  // A reading that the query does not carry over arrives empty, and an
  // empty reading is indistinguishable from a shop that had none — so the
  // gap is silent. Every reading the table shows must be carried.
  for (const name of wanted) {
    assert.ok(carried.has(name), `the query must carry ${name} over to the table`);
  }
});
