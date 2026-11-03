'use strict';

/**
 * TikTok 页签测试。
 *
 * 覆盖三组约束：
 *   1. **查询层的口径纪律** —— 三个 GMV 口径分别返回，绝不合并成"总 GMV"；
 *   2. **缺失与零要分得开** —— 没有数据是「—」，真的是 0 就显示 0；
 *   3. **前端接入完整性** —— 侧栏按钮、视图容器、脚本引入、静态资源白名单
 *      都要在位，缺一个就是线上 404 或点了没反应。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  BASIS_LABELS,
  TikTokQueryRepository,
  resolveDateRange,
  toDateString,
  toNumber,
} = require('../src/tiktok-query-repository');

const webDir = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
const tiktokUi = fs.readFileSync(path.join(webDir, 'tiktok-ui-v1.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone-server.js'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '..', 'src', 'http-router.js'), 'utf8');

// ---------------------------------------------------------------------------
// 假连接池：记录 SQL，按调用顺序返回预设结果
// ---------------------------------------------------------------------------

function createFakePool(responses = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      const next = responses[index++];
      return { rows: next ? next.rows || [] : [], rowCount: next ? (next.rowCount || 0) : 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// 1. 口径纪律
// ---------------------------------------------------------------------------

function testOverviewKeepsCalibersSeparate() {
  const pool = createFakePool([
    {
      rows: [{
        attributionBasis: 'order_level',
        source: 'shop_order',
        currency: 'USD',
        dayCount: 3,
        orders: '10',
        units: '25',
        spend: null,
        impressions: null,
        clicks: null,
        // 订单口径有前两个，第三个必须为 null
        gmvOrderTotal: '1200',
        gmvSubtotal: '1000',
        gmvSettled: null,
        refunds: null,
        commission: null,
        shipping: null,
        cancellations: '1',
        incrementalGmv: null,
        firstDate: '2026-11-01',
        lastDate: '2026-11-03',
      }],
    },
  ]);

  const repo = new TikTokQueryRepository({ pool });
  return repo.getShopOverview({
    regionGroup: 'ROW', shopId: 'SHOP-1', startDate: '2026-11-01', endDate: '2026-11-03',
  }).then((overview) => {
    const basis = overview.byBasis.order_level;
    assert.ok(basis, '应返回 order_level 口径');
    assert.strictEqual(basis.gmvOrderTotal, 1200, '订单实付应为数字');
    assert.strictEqual(basis.gmvSubtotal, 1000, '货款小计应为数字');
    // ★ 结算收入在订单口径下必须是 null —— 不能被订单实付推算出来。
    assert.strictEqual(basis.gmvSettled, null, '订单口径的结算收入必须为 null，不能由其他口径推导');

    // ★ 每个口径必须是独立的一行，而不是被合并进同一个对象。
    assert.strictEqual(Object.keys(overview.byBasis).length, 1, '只有一种口径时只能有一个键');
    assert.ok(basis.attributionLabel, '每个口径都要有中文说明 —— 读者要能看懂这是哪一列');
  });
}

function testTwoBasesAreSeparateEntries() {
  const pool = createFakePool([
    {
      rows: [
        {
          attributionBasis: 'order_level', source: 'shop_order', currency: 'USD', dayCount: 2,
          orders: '5', units: '9', spend: null, impressions: null, clicks: null,
          gmvOrderTotal: '500', gmvSubtotal: '400', gmvSettled: null,
          refunds: null, commission: null, shipping: null, cancellations: null, incrementalGmv: null,
          firstDate: '2026-11-01', lastDate: '2026-11-02',
        },
        {
          // 平台归因口径：金额完全不同，且结算收入有值（来自 finance 端点）
          attributionBasis: 'platform_attributed', source: 'gmv_max_report', currency: 'USD', dayCount: 2,
          orders: '3', units: '4', spend: '50', impressions: '900', clicks: '60',
          gmvOrderTotal: null, gmvSubtotal: null, gmvSettled: null,
          refunds: null, commission: null, shipping: null, cancellations: null, incrementalGmv: '120',
          firstDate: '2026-11-01', lastDate: '2026-11-02',
        },
      ],
    },
  ]);

  const repo = new TikTokQueryRepository({ pool });
  return repo.getShopOverview({
    regionGroup: 'ROW', shopId: 'SHOP-1', startDate: '2026-11-01', endDate: '2026-11-02',
  }).then((overview) => {
    const keys = Object.keys(overview.byBasis);
    assert.strictEqual(keys.length, 2, '两个口径必须是两个独立条目，不能合并');

    const order = overview.byBasis.order_level;
    const attributed = overview.byBasis.platform_attributed;

    // ★ 关键：不能出现"把两个口径的金额加总"的结果。
    assert.strictEqual(order.gmvOrderTotal, 500, '订单口径金额不应被改动');
    assert.strictEqual(attributed.incrementalGmv, 120, '平台归因口径的增量应有值');
    assert.strictEqual(attributed.gmvOrderTotal, null, '平台归因口径不该有订单实付值');

    // 两个口径的中文说明必须不同 —— 否则读者分不清。
    assert.notStrictEqual(
      order.attributionLabel, attributed.attributionLabel,
      '不同口径必须有不同的说明文字',
    );
  });
}

function testDailyRowsAreNotSummed() {
  const pool = createFakePool([
    {
      rows: [{
        eventDate: '2026-11-01', attributionBasis: 'order_level', source: 'shop_order',
        channel: 'unknown', currency: 'USD', orders: '2', units: '3', spend: null,
        impressions: null, clicks: null, gmvOrderTotal: '200', gmvSubtotal: '180',
        gmvSettled: null, refunds: null, commission: null, shipping: null,
        cancellations: '0', baselineNaturalGmv: null, incrementalGmv: null,
      }],
    },
  ]);

  const repo = new TikTokQueryRepository({ pool });
  return repo.listDailySummary({
    regionGroup: 'ROW', shopId: 'SHOP-1', startDate: '2026-11-01', endDate: '2026-11-01',
  }).then((rows) => {
    assert.strictEqual(rows.length, 1);
    const row = rows[0];
    assert.strictEqual(row.gmvOrderTotal, 200);
    assert.strictEqual(row.gmvSubtotal, 180);
    assert.strictEqual(row.gmvSettled, null, '结算口径在订单来源下必须为 null');
    assert.strictEqual(row.channel, 'unknown', 'TikTok 订单侧没有流量来源，渠道只能是 unknown');
    assert.ok(row.attributionLabel, '日粒度行也要带口径说明');
  });
}

// ---------------------------------------------------------------------------
// 2. 缺失与零分得开
// ---------------------------------------------------------------------------

function testMissingIsNotZero() {
  assert.strictEqual(toNumber(null), null, 'null 必须保持 null');
  assert.strictEqual(toNumber(undefined), null, 'undefined 必须保持 null');
  assert.strictEqual(toNumber(''), null, '空串必须保持 null');
  assert.strictEqual(toNumber('0'), 0, '字符串 0 必须转成数字 0 —— 它不是缺失');
  assert.strictEqual(toNumber(0), 0, '数字 0 就是 0');
  assert.strictEqual(toNumber('123.45'), 123.45);
  assert.strictEqual(toNumber('abc'), null, '非数字必须回到 null，不能变成 NaN');

  assert.strictEqual(toDateString(null), null);
  assert.strictEqual(toDateString('2026-11-01'), '2026-11-01');
  assert.strictEqual(toDateString('2026-11-01T10:00:00Z'), '2026-11-01', '带时间的也要取日期部分');
}

function testDateRangeRespectsLimit() {
  // 没给开始日期 → 回退 30 天（与 TikTok 报表端点的 30 天上限对齐）
  const fallback = resolveDateRange({ startDate: null, endDate: '2026-11-03', today: new Date('2026-11-03T00:00:00Z') });
  assert.strictEqual(fallback.endDate, '2026-11-03');
  assert.strictEqual(fallback.startDate, '2026-10-05', '默认回退 30 天');

  // 区间过长 → 截断到上限，不让查询扫全表
  const long = resolveDateRange({ startDate: '2020-01-01', endDate: '2026-11-03', today: new Date('2026-11-03T00:00:00Z') });
  const span = (new Date(`${long.endDate}T00:00:00Z`) - new Date(`${long.startDate}T00:00:00Z`)) / 86400000;
  assert.ok(span <= 92, `区间应被截断到 93 天内，实际 ${span + 1} 天`);

  // 正常区间原样保留
  const ok = resolveDateRange({ startDate: '2026-11-01', endDate: '2026-11-03', today: new Date('2026-11-03T00:00:00Z') });
  assert.strictEqual(ok.startDate, '2026-11-01');
  assert.strictEqual(ok.endDate, '2026-11-03');
}

// ---------------------------------------------------------------------------
// 3. 前端接入完整性
// ---------------------------------------------------------------------------

function testFrontendWiringIsComplete() {
  // 侧栏按钮
  assert.match(html, /data-view="tiktok"/, 'index.html 缺少 TikTok 侧栏按钮');
  // 视图容器
  assert.match(html, /id="view-tiktok"/, 'index.html 缺少 #view-tiktok 容器');
  // 脚本引入
  assert.match(html, /src="\/tiktok-ui-v1\.js"/, 'index.html 缺少 tiktok-ui-v1.js 的引入');
  // ★ 静态资源白名单 —— 漏了线上就是 404，页面整个不工作
  assert.match(
    server, /'\/tiktok-ui-v1\.js'/,
    'standalone-server 的静态资源白名单缺少 /tiktok-ui-v1.js —— 线上会 404',
  );

  // app.js 的视图白名单必须包含 tiktok
  const viewWhiteList = app.match(/\['overview'[^\]]*\]/);
  assert.ok(viewWhiteList, '找不到 app.js 的视图白名单');
  assert.match(viewWhiteList[0], /'tiktok'/, "app.js 的视图白名单缺少 'tiktok'");

  // 加载分支
  assert.match(app, /state\.view === 'tiktok'/, 'app.js 缺少 TikTok 视图的加载分支');
  // 加载函数
  assert.match(app, /async function loadTikTokData/, 'app.js 缺少 loadTikTokData');
  // 导出与刷新按钮绑定
  assert.match(app, /#tiktokExportBtn/, 'app.js 缺少 TikTok 导出按钮绑定');
  assert.match(app, /#tiktokRefreshBtn/, 'app.js 缺少 TikTok 刷新按钮绑定');
}

function testFrontendUiModuleContract() {
  assert.match(tiktokUi, /window\.TikTokUI\s*=\s*\{[^}]*render/, 'tiktok-ui-v1.js 必须导出 render');
  assert.match(tiktokUi, /window\.TikTokUI\s*=\s*\{[^}]*exportCsv/, 'tiktok-ui-v1.js 必须导出 exportCsv');

  // ★ 缺失值必须显示成破折号，而不是 0
  assert.match(tiktokUi, /const MISSING = '—'/, '缺失值必须用破折号表示');
  // ★ 页面不能出现"总 GMV"这种把口径合并的说法。
  // 只查代码标识符（注释里为了说明纪律会提到这个词，那不算）。
  const code = tiktokUi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    code, /totalGmv|total_gmv|gmvTotal/,
    '前端不能出现合并口径的「总 GMV」—— 三个口径互不推导',
  );
}

function testBackendRoutesAreRegistered() {
  assert.match(router, /router\.get\('\/tiktok\/shops'/, '缺少 TikTok 店铺列表路由');
  assert.match(router, /router\.get\('\/tiktok\/shops\/:shopId\/overview'/, '缺少 TikTok 概览路由');
  assert.match(router, /router\.get\('\/tiktok\/shops\/:shopId\/products'/, '缺少 TikTok 商品路由');
  assert.match(router, /router\.get\('\/tiktok\/shops\/:shopId\/orders'/, '缺少 TikTok 订单路由');

  // 权限隔离：TikTok 的 shop_id 是字符串，不能用按数字比的那个断言
  assert.match(router, /canSeeTikTokShop/, '缺少 TikTok 店铺的权限判断');
  assert.match(router, /String\(id\) === target/, '权限比较必须把两侧转成字符串 —— TikTok 的 shop_id 不是数字');
}

function testRepositoryRequiresPool() {
  assert.throws(() => new TikTokQueryRepository({}), /pool is required/);
  assert.throws(() => new TikTokQueryRepository({ pool: {} }), /pool is required/);
}

function testBasisLabelsCoverAllBases() {
  // 每个口径都要有中文说明，否则页面会显示原始英文枚举
  for (const basis of ['order_level', 'platform_attributed', 'paid_only', 'derived_incremental', 'derived_net', 'unknown']) {
    assert.ok(BASIS_LABELS[basis], `口径 ${basis} 缺少中文说明`);
  }
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

const tests = [
  ['概览：三个口径分开返回，不合并', testOverviewKeepsCalibersSeparate],
  ['概览：两个口径是两个独立条目', testTwoBasesAreSeparateEntries],
  ['日粒度：口径不被加总', testDailyRowsAreNotSummed],
  ['缺失与零分得开', testMissingIsNotZero],
  ['日期区间：默认 30 天、超长截断', testDateRangeRespectsLimit],
  ['前端接入完整（含静态资源白名单）', testFrontendWiringIsComplete],
  ['前端 UI 模块契约', testFrontendUiModuleContract],
  ['后端路由已注册且有权限隔离', testBackendRoutesAreRegistered],
  ['repository 构造参数校验', testRepositoryRequiresPool],
  ['所有口径都有中文说明', testBasisLabelsCoverAllBases],
];

async function main() {
  let passed = 0;
  const failures = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
    } catch (error) {
      failures.push({ name, error });
    }
  }
  if (failures.length) {
    for (const f of failures) {
      process.stderr.write(`❌ ${f.name}\n   ${f.error && f.error.message}\n`);
    }
    throw new Error(`${failures.length} 个测试失败（共 ${tests.length} 个）`);
  }
  process.stdout.write(`tiktok tab page tests passed (${passed} cases)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
