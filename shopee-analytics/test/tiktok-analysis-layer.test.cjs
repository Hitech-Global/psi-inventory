'use strict';

/**
 * TikTok 分析层测试。
 *
 * 这一层要守住的底线只有一条：**不编造数据**。
 *
 * TikTok 的订单对象没有流量来源字段，GMV Max 又把付费与自然流量合并在报表里。
 * 如果把 TikTok 数据硬套进 Shopee 的诊断规则，最可能出的不是"报错"，而是
 * "看起来合理但完全错误"的结论 —— 比如把 direct 订单当成 0，于是判定「投放无效」。
 *
 * 所以这里重点验三件事：
 *   1. **口径不混** —— 三个 GMV 口径分别汇总，绝不加总；跨口径相除被闸门拦下；
 *   2. **拿不到就说拿不到** —— 不可得的结论标为不可得，不给数值、不给结论；
 *   3. **事实与推测分开** —— 每条结论都带 kind，读者能分出哪句是数、哪句是判断。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  ATTRIBUTION_BASES,
  CHANNELS,
  PLATFORMS,
  assertSameBasis,
  canDivideAcrossBases,
  createMetric,
} = require('../src/platform-model');
const {
  CAPABILITIES,
  buildAnalysis,
  computeMetrics,
  groupFactsByBasis,
  safeRatioWithBasis,
  sumFacts,
  toFact,
} = require('../src/platforms/tiktok-analysis-adapter');
const {
  diagnoseTikTokShop,
} = require('../src/platforms/tiktok-diagnosis');

const webDir = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
const tiktokUi = fs.readFileSync(path.join(webDir, 'tiktok-ui-v1.js'), 'utf8');

// ---------------------------------------------------------------------------
// 样例数据
// ---------------------------------------------------------------------------

/** 一天的多口径数据。 */
function sampleRows() {
  return [
    {
      eventDate: '2026-11-01',
      attributionBasis: 'order_level',
      source: 'shop_order',
      currency: 'USD',
      orders: 10, units: 25,
      gmvOrderTotal: 1200, gmvSubtotal: 1000,
      gmvSettled: null, spend: null, impressions: null, clicks: null,
      refunds: null, cancellations: 1,
    },
    {
      eventDate: '2026-11-01',
      attributionBasis: 'platform_attributed',
      source: 'gmv_max_report',
      currency: 'USD',
      orders: 6, units: null,
      gmvOrderTotal: 800, gmvSubtotal: null, gmvSettled: null,
      spend: 200, impressions: 5000, clicks: 300,
      refunds: null, commission: null, shipping: null, cancellations: null,
      incrementalGmv: null,
    },
    {
      eventDate: '2026-11-01',
      attributionBasis: 'derived_net',
      source: 'finance_statement',
      currency: 'USD',
      orders: null, units: null,
      gmvOrderTotal: null, gmvSubtotal: null, gmvSettled: 900,
      spend: 200, impressions: null, clicks: null,
      refunds: 20, commission: 100, shipping: 50, cancellations: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// 1. 口径不混
// ---------------------------------------------------------------------------

function testFactsAreGroupedByBasis() {
  const { byBasis } = groupFactsByBasis(sampleRows());
  assert.deepStrictEqual(
    Object.keys(byBasis).sort(),
    ['derived_net', 'order_level', 'platform_attributed'],
    '三种口径必须各自成组',
  );
}

function testBasesAreNotSummedTogether() {
  const analysis = buildAnalysis({ rows: sampleRows() });

  // 订单口径 10 笔，平台归因口径 6 笔 —— 绝不能变成 16。
  assert.strictEqual(analysis.facts.order_level.orders, 10, '订单口径的订单数应保持原值');
  assert.strictEqual(
    analysis.facts.platform_attributed.orders, 6,
    '平台归因口径的订单数应保持原值 —— 不能与订单口径相加',
  );

  // GMV 同样分开。
  assert.strictEqual(analysis.facts.order_level.gmvOrderTotal, 1200);
  assert.strictEqual(analysis.facts.platform_attributed.gmvOrderTotal, 800);

  // ★ 结算口径在订单口径下必须是 null —— 订单里没有结算收入。
  assert.strictEqual(
    analysis.facts.order_level.gmvSettled, null,
    '订单口径不得有结算收入 —— 那是用订单推算出来的，是编造',
  );
}

function testCrossBasisDivisionIsBlocked() {
  // 平台归因 GMV ÷ 结算净收益 —— 闸门明确不允许。
  assert.strictEqual(
    canDivideAcrossBases('platform_attributed', 'derived_net'), false,
    '平台归因口径除以结算口径应当被禁止',
  );

  const numerator = createMetric({
    platform: PLATFORMS.TIKTOK, attributionBasis: 'platform_attributed', value: 800,
  });
  const denominator = createMetric({
    platform: PLATFORMS.TIKTOK, attributionBasis: 'derived_net', value: 730,
  });
  assert.strictEqual(
    safeRatioWithBasis(numerator, denominator, 'test'),
    null,
    '跨口径相除必须返回 null，不能给出一个看似合理的数',
  );
  assert.throws(() => assertSameBasis(numerator, denominator, 'test'), /refusing to combine/);

  // 允许的一对：平台归因 ÷ 纯付费（同一张 GMV Max 报表内）
  const spend = createMetric({
    platform: PLATFORMS.TIKTOK, attributionBasis: 'paid_only', value: 200,
  });
  assert.strictEqual(
    safeRatioWithBasis(numerator, spend, 'test'), 4,
    '允许的组合应当正常算出',
  );
}

function testFactKeepsUnknownChannel() {
  const fact = toFact(sampleRows()[0]);
  assert.strictEqual(fact.channel, CHANNELS.UNKNOWN, 'TikTok 订单侧的渠道只能是 unknown，不能猜');
  assert.strictEqual(fact.platform, PLATFORMS.TIKTOK);
}

function testSumKeepsMissingAsNull() {
  // 一行有 orders，一行没有 —— 汇总后 orders 有值，但没出现过的字段仍是 null。
  const facts = [
    toFact({ attributionBasis: 'order_level', source: 'shop_order', orders: 3 }),
    toFact({ attributionBasis: 'order_level', source: 'shop_order', orders: null }),
  ];
  const totals = sumFacts(facts);
  assert.strictEqual(totals.orders, 3, '有值的字段应累加');
  assert.strictEqual(
    totals.gmvSettled, null,
    '没出现过的字段必须保持 null —— 「没有」不能变成 0',
  );
}

// ---------------------------------------------------------------------------
// 2. 拿不到就说拿不到
// ---------------------------------------------------------------------------

function testUnavailableItemsAreDeclared() {
  const diagnosis = diagnoseTikTokShop({ rows: sampleRows(), shopId: 'SHOP-1' });
  const keys = diagnosis.unavailable.map(item => item.key);
  assert.ok(keys.includes('traffic-split'), '必须声明流量结构拿不到');
  assert.ok(keys.includes('maturity-grading'), '必须声明成熟度分档拿不到');
  assert.ok(keys.includes('direct-roas'), '必须声明直接归因 ROAS 拿不到');

  diagnosis.unavailable.forEach((item) => {
    assert.strictEqual(item.available, false, '不可得项必须标为不可得');
    assert.ok(item.reason && item.reason.length > 10, '不可得项必须说明原因');
    assert.ok(item.impact && item.impact.length > 10, '不可得项必须说明影响');
    // ★ 不可得项绝不能带数值。
    assert.strictEqual(item.value, undefined, '不可得项不能带数值');
  });
}

function testCapabilitiesReflectPlatformLimits() {
  assert.strictEqual(CAPABILITIES.trafficSplit.available, false);
  assert.strictEqual(CAPABILITIES.maturityGrading.available, false);
  assert.strictEqual(CAPABILITIES.settlementNet.available, true);
  assert.strictEqual(CAPABILITIES.incremental.available, true);
}

function testNoMaturityGradingIsInvented() {
  // ★ 关键：TikTok 侧没有 direct 订单，诊断里绝不能出现成熟度分档。
  const diagnosis = diagnoseTikTokShop({ rows: sampleRows(), shopId: 'SHOP-1' });
  const texts = diagnosis.signals.map(item => `${item.title}${item.detail}`).join('\n');
  assert.doesNotMatch(
    texts, /成熟度|流量结构|直接归因/,
    'TikTok 诊断不能给出依赖 direct/broad 拆分的结论 —— 那是编造',
  );
  // 也不能出现 direct 订单数当成 0 的说法。
  assert.doesNotMatch(
    texts, /direct_?orders?\s*[:=]\s*0/i,
    '不能把缺失的 direct 订单写成 0',
  );
}

function testEmptyDataGivesActionableSignal() {
  const diagnosis = diagnoseTikTokShop({ rows: [], shopId: 'SHOP-1' });
  assert.strictEqual(diagnosis.signals.length, 1, '没有数据时给一条说明');
  const signal = diagnosis.signals[0];
  assert.strictEqual(signal.code, 'TIKTOK_NO_DATA');
  assert.ok(signal.action && signal.action.length > 10, '必须给出下一步动作');
  assert.strictEqual(signal.kind, 'ai-suggestion', '这是建议而非事实');
}

// ---------------------------------------------------------------------------
// 3. 事实与推测分开
// ---------------------------------------------------------------------------

function testSignalsDeclareTheirKind() {
  const diagnosis = diagnoseTikTokShop({ rows: sampleRows(), shopId: 'SHOP-1' });
  diagnosis.signals.forEach((item) => {
    assert.ok(
      item.kind === 'data-fact' || item.kind === 'ai-suggestion',
      `每条结论都必须标明是数据事实还是 AI 推测，实际 ${item.kind}`,
    );
  });
  // 至少各有一条 —— 两类都要有才说明区分是真的在做。
  const kinds = new Set(diagnosis.signals.map(item => item.kind));
  assert.ok(kinds.has('data-fact'), '应有数据事实类结论');
  assert.ok(kinds.has('ai-suggestion'), '应有 AI 推测类结论');
}

function testSettledNetRoasIsComputed() {
  const diagnosis = diagnoseTikTokShop({ rows: sampleRows(), shopId: 'SHOP-1' });
  const roasSignal = diagnosis.signals.find(item => item.code === 'TIKTOK_SETTLED_NET_ROAS');
  const netSignal = diagnosis.signals.find(item => item.code === 'TIKTOK_SETTLED_NET');
  assert.ok(roasSignal, '应有结算净 ROAS 结论');
  assert.ok(netSignal, '应有结算净收益结论');
  // 净收益 900-100-50-20=730
  const net = diagnosis.facts.derived_net.netProceeds;
  assert.strictEqual(net, 730, '结算净收益应为 730');
  // 结算是卖家实际到手的钱，所以这个口径不受广告归因方式影响 —— 这是它最有价值的地方。
  assert.match(netSignal.detail, /不受平台归因口径影响/, '应说明结算口径为什么可靠');
  // ROAS 那条要说清分子分母同源、口径成立。
  assert.match(roasSignal.detail, /口径成立/, '结算净 ROAS 应说明口径为什么成立');
}

function testSpendRatioIsComputed() {
  const analysis = buildAnalysis({ rows: sampleRows() });
  const ratio = analysis.metricsByBasis.platform_attributed.spendRatio.value;
  // 200 / 800
  assert.strictEqual(ratio, 0.25, '花费占比应为 200/800=0.25');
}

function testIncrementalMissingIsExplainedNotGuessed() {
  // 有平台归因但没自然基线 → 应明确说"拿不到"，而不是编一个增量。
  const diagnosis = diagnoseTikTokShop({ rows: sampleRows(), shopId: 'SHOP-1' });
  const signal = diagnosis.signals.find(item => item.code === 'TIKTOK_INCREMENTAL_BASELINE_MISSING');
  assert.ok(signal, '应说明增量口径为何拿不到');
  assert.strictEqual(signal.severity, 'neutral', '这是状态说明，不是异常');
  assert.ok(
    signal.action && signal.action.includes('基线'),
    '应给出补齐自然基线的具体动作',
  );
}

// ---------------------------------------------------------------------------
// 4. 前端接入完整性
// ---------------------------------------------------------------------------

function testFrontendWiring() {
  assert.match(html, /id="tiktokDiagnosisBtn"/, 'index.html 缺少诊断按钮');
  assert.match(html, /id="tiktokSignals"/, 'index.html 缺少诊断结论容器');
  assert.match(html, /id="tiktokUnavailable"/, 'index.html 缺少能力边界容器');
  assert.match(app, /async function loadTikTokDiagnosis/, 'app.js 缺少 loadTikTokDiagnosis');
  assert.match(app, /#tiktokDiagnosisBtn/, 'app.js 缺少诊断按钮绑定');
  assert.match(app, /tiktok\/shops\/.*diagnosis/, 'app.js 缺少诊断接口调用');
  assert.match(tiktokUi, /window\.TikTokUI\s*=\s*\{[^}]*renderDiagnosis/, 'tiktok-ui-v1.js 必须导出 renderDiagnosis');

  // ★ 前端必须把「数据事实」与「AI 推测建议」渲染成两种不同的样子。
  assert.match(tiktokUi, /数据事实/, '前端必须标出「数据事实」');
  assert.match(tiktokUi, /AI 推测建议/, '前端必须标出「AI 推测建议」');
}

function testBackendRouteExists() {
  const router = fs.readFileSync(path.join(__dirname, '..', 'src', 'http-router.js'), 'utf8');
  assert.match(
    router, /router\.get\('\/tiktok\/shops\/:shopId\/diagnosis'/,
    '缺少 TikTok 诊断路由',
  );
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

const tests = [
  ['事实按口径分组', testFactsAreGroupedByBasis],
  ['三个口径互不加总', testBasesAreNotSummedTogether],
  ['跨口径相除被闸门拦下', testCrossBasisDivisionIsBlocked],
  ['订单侧渠道恒为 unknown', testFactKeepsUnknownChannel],
  ['缺失保持 null 不变 0', testSumKeepsMissingAsNull],
  ['不可得项被明确声明', testUnavailableItemsAreDeclared],
  ['能力清单反映平台限制', testCapabilitiesReflectPlatformLimits],
  ['不编造成熟度/流量结构结论', testNoMaturityGradingIsInvented],
  ['无数据时给出可执行提示', testEmptyDataGivesActionableSignal],
  ['每条结论标明事实或推测', testSignalsDeclareTheirKind],
  ['结算净收益与 ROAS 计算正确', testSettledNetRoasIsComputed],
  ['花费占比计算正确', testSpendRatioIsComputed],
  ['增量缺失被解释而非编造', testIncrementalMissingIsExplainedNotGuessed],
  ['前端接入完整', testFrontendWiring],
  ['后端诊断路由已注册', testBackendRouteExists],
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
  process.stdout.write(`tiktok analysis layer tests passed (${passed} cases)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
