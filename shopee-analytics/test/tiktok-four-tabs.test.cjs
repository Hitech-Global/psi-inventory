'use strict';

/**
 * TikTok 四个页签的测试。
 *
 * 覆盖三组约束：
 *   1. **四个页签都在** —— 侧栏按钮、视图容器、加载分支、接口路由；
 *   2. **口径不混算** —— 广告诊断的三个比值分属不同口径，
 *      不能把跨报表的花费占比当成平台 ROI；
 *   3. **平台没给数据就说没有** —— 店铺健康的未知指标不能被补白。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  diagnoseAds,
} = require('../src/platforms/tiktok-ads-diagnosis');
const {
  buildSignals: buildHealthSignals,
  formatValue,
  normalizeMetrics,
  normalizeOverview,
  overallStatus,
  readStatus,
} = require('../src/platforms/tiktok-health-evaluation');
const {
  TikTokCreatorRepository,
  TikTokCreatorSyncRunner,
  toCreatorRow,
} = require('../src/tiktok-creator-repository');
const { ENDPOINTS, CREATOR_DATA_GROUPS } = require('../src/tiktok-catalog');

const webDir = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
const tiktokUi = fs.readFileSync(path.join(webDir, 'tiktok-ui-v1.js'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '..', 'src', 'http-router.js'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// ---------------------------------------------------------------------------
// 1. 四个页签都在
// ---------------------------------------------------------------------------

function testSidebarHasFourNewTabs() {
  for (const view of ['tiktok', 'tiktok-store', 'tiktok-ads', 'tiktok-health', 'tiktok-creators']) {
    assert.match(html, new RegExp(`data-view="${view}"`), `侧栏缺少 ${view} 按钮`);
    assert.match(html, new RegExp(`id="view-${view}"`), `缺少 #view-${view} 容器`);
  }
  // 侧栏里 TikTok 组应该是 5 项。
  const group = html.match(/<div class="side-group-title">TikTok<\/div>([\s\S]*?)<\/div>/);
  assert.ok(group, '找不到 TikTok 侧栏分组');
  const tabs = (group[1].match(/data-view="tiktok[^"]*"/g) || []);
  assert.strictEqual(tabs.length, 5, `TikTok 分组应有 5 个页签，实际 ${tabs.length}`);
}

function testViewWhitelistCoversNewTabs() {
  const match = app.match(/const view = \[([^\]]*)\]\.includes\(saved\.view\)/);
  assert.ok(match, '找不到视图白名单');
  for (const view of ['tiktok-store', 'tiktok-ads', 'tiktok-health', 'tiktok-creators']) {
    assert.ok(
      match[1].includes(`'${view}'`),
      `视图白名单缺少 ${view} —— 刷新页面后那个页签会跳回经营总览`,
    );
  }
}

const BUTTON_BY_VIEW = {
  'tiktok-store': 'tiktokStoreDiagnosisBtn',
  'tiktok-ads': 'tiktokAdsDiagnosisBtn',
  'tiktok-health': 'tiktokHealthRefreshBtn',
  'tiktok-creators': 'tiktokCreatorsRefreshBtn',
};

function testLoadBranchesExist() {
  for (const [view, fn] of [
    ['tiktok-store', 'loadTikTokStoreDiagnosis'],
    ['tiktok-ads', 'loadTikTokAdsDiagnosis'],
    ['tiktok-health', 'loadTikTokHealth'],
    ['tiktok-creators', 'loadTikTokCreators'],
  ]) {
    assert.match(app, new RegExp(`state\\.view === '${view}'`), `缺少 ${view} 的加载分支`);
    assert.match(app, new RegExp(`async function ${fn}`), `缺少 ${fn}`);
    const buttonId = BUTTON_BY_VIEW[view];
    assert.match(app, new RegExp('#' + buttonId), `缺少 ${view} 的按钮绑定（${buttonId}）`);
  }
}

function testBackendRoutesRegistered() {
  assert.match(router, /router\.get\('\/tiktok\/shops\/:shopId\/health'/, '缺少健康路由');
  assert.match(router, /router\.get\('\/tiktok\/shops\/:shopId\/ads-diagnosis'/, '缺少广告诊断路由');
  assert.match(router, /router\.get\('\/tiktok\/shops\/:shopId\/creators'/, '缺少达人路由');
  assert.match(router, /router\.post\('\/tiktok\/shops\/:shopId\/creators\/sync'/, '缺少达人同步路由');

  // 达人同步会消耗平台配额，只能 super admin 做。
  assert.match(
    router, /creators\/sync[\s\S]{0,600}ROLE_SUPER_ADMIN/,
    '达人同步必须限制为 super admin',
  );
}

function testShopCipherNeverComesFromFrontend() {
  // ★ cipher 是凭据的一部分 —— 前端传就能被篡改成别店的 cipher。
  //   所以路由里只能由后端按 shop_id 查出来。
  assert.match(router, /resolveTikTokShopCipher/, '路由必须用后端查 cipher 的方式');
  assert.doesNotMatch(
    router, /shop_cipher:\s*String\(req\.(query|body)/,
    'shop_cipher 不能从请求参数里取 —— 那能被篡改',
  );
}

// ---------------------------------------------------------------------------
// 2. 口径不混算
// ---------------------------------------------------------------------------

/** 三种口径各一行。 */
function sampleRows() {
  return [
    {
      attributionBasis: 'platform_attributed', spend: 200, gmvOrderTotal: 800,
      orders: 6, impressions: 5000, clicks: 300,
    },
    {
      attributionBasis: 'paid_only', spend: 200, impressions: 5000, clicks: 300,
    },
    {
      attributionBasis: 'derived_net', gmvSettled: 900, commission: 100, shipping: 50, refunds: 20,
    },
  ];
}

function testAdsDiagnosisKeepsThreeRatiosApart() {
  const diagnosis = diagnoseAds({ rows: sampleRows() });

  // ★ 平台 ROI：同源（GMV Max 内的 cost ÷ gross_revenue）= 800/200 = 4
  assert.strictEqual(diagnosis.metrics.platformRoas, 4, '平台 ROI 应为同源相除');
  // ★ 花费占比：跨报表（纯付费 spend ÷ 归因 GMV）= 200/800 = 0.25
  assert.strictEqual(
    diagnosis.metrics.spendToAttributedGmv, 0.25,
    '花费占归因 GMV 应为跨报表相除',
  );
  // ★ 结算净 ROAS = 730/200 = 3.65
  assert.strictEqual(diagnosis.metrics.settledNetRoas, 3.65, '结算净 ROAS 计算不对');
  // 纯付费 CTR = 300/5000 = 0.06
  assert.strictEqual(diagnosis.metrics.paidCtr, 0.06);

  // ★ 三个数必须都不同 —— 混成一个数就毁了口径纪律。
  const values = [
    diagnosis.metrics.platformRoas,
    diagnosis.metrics.spendToAttributedGmv,
    diagnosis.metrics.settledNetRoas,
  ];
  assert.strictEqual(new Set(values).size, 3, '三个比值不能相同 —— 否则说明混算了');
}

function testAdsDiagnosisExplainsEachRatio() {
  const diagnosis = diagnoseAds({ rows: sampleRows() });
  // 每个比值都要说清怎么算出来的 —— 否则读者会把跨报表的花费占比当成平台 ROI。
  assert.strictEqual(diagnosis.caliberNotes.length, 3, '三个比值都要有口径说明');
  for (const note of diagnosis.caliberNotes) {
    assert.ok(note.formula, `${note.title} 缺少算式`);
    assert.ok(note.source, `${note.title} 缺少来源说明`);
    assert.ok(note.note, `${note.title} 缺少口径提醒`);
  }
  // 同源与跨报表必须说清区别。
  const platformNote = diagnosis.caliberNotes.find(n => n.key === 'platform-roas');
  const spendNote = diagnosis.caliberNotes.find(n => n.key === 'spend-ratio');
  assert.match(platformNote.source, /同一张/, '平台 ROI 应说明是同一张报表');
  assert.match(spendNote.source, /跨两张|跨报表/, '花费占比应说明是跨报表');
}

function testAdsDiagnosisWithoutDataGivesAction() {
  const diagnosis = diagnoseAds({ rows: [] });
  assert.strictEqual(diagnosis.signals.length, 1);
  assert.strictEqual(diagnosis.signals[0].code, 'TIKTOK_ADS_NO_DATA');
  assert.ok(diagnosis.signals[0].action, '没有数据时要给出下一步动作');
  // 没有数据时不能编出比值。
  assert.strictEqual(diagnosis.metrics.platformRoas, null);
  assert.strictEqual(diagnosis.metrics.settledNetRoas, null);
}

// ---------------------------------------------------------------------------
// 3. 平台没给数据就说没有
// ---------------------------------------------------------------------------

function testHealthKeepsUnknownAsUnknown() {
  const metrics = normalizeMetrics([
    { metric_code: 'A', metric_name: '取消率', value: '3.2', value_unit: '%', score: '80', status: 'GOOD', benchmarks: { excellent_threshold: '2', poor_threshold: '5' } },
    { metric_code: 'B', metric_name: '退款率', value: '8.5', value_unit: '%', score: '40', status: 'POOR', top_reason_text: '高于同行' },
    { metric_code: 'C', metric_name: '客服响应', value: null, value_unit: '%', status: '' },
  ]);

  const unknown = metrics.find(m => m.metricCode === 'C');
  assert.strictEqual(unknown.level, 'unknown', '平台没给数据的指标必须标为未知');
  assert.strictEqual(unknown.value, null, '不能给未知指标编一个值');
  assert.strictEqual(unknown.displayValue, '—', '未知指标的显示值应是破折号');

  // 整体判定不能因为有未知项就说"良好"。
  const status = overallStatus(metrics);
  assert.strictEqual(status.level, 'poor', '有较差指标时整体应是需改进');
  assert.strictEqual(status.breachCount, 1);

  // 全部未知 → 整体未知，不是良好。
  const allUnknown = overallStatus(normalizeMetrics([
    { metric_code: 'X', metric_name: '某项', value: null, status: '' },
  ]));
  assert.strictEqual(allUnknown.level, 'unknown', '全是未知时整体应是未知');
  assert.strictEqual(allUnknown.breachCount, 0, '未知不算不达标');
}

function testHealthStatusNeverGuessesGood() {
  // ★ 平台没给 status → 未知。不能因为"没说不达标"就当成达标。
  assert.strictEqual(readStatus('').level, 'unknown');
  assert.strictEqual(readStatus(null).level, 'unknown');
  assert.strictEqual(readStatus(undefined).level, 'unknown');
  // 平台给了没见过的状态词 → 也当未知，不猜好坏。
  assert.strictEqual(readStatus('SOME_NEW_STATUS').level, 'unknown');
  // 认得的才给判定。
  assert.strictEqual(readStatus('EXCELLENT').level, 'good');
  assert.strictEqual(readStatus('POOR').level, 'poor');
}

function testHealthSignalsIncludeUnknownNote() {
  const overview = normalizeOverview({
    sps_score: '72.5', sps_tier_text: '良好', peer_percentile: '62%',
    top_issues: { issues: [{ metric_code: 'SHIP', metric_name: '迟发率', description: '高于同行', percentile: '20%', rank: 1 }] },
  });
  const metrics = normalizeMetrics([
    { metric_code: 'C', metric_name: '客服响应', value: null, status: '' },
  ]);
  const signals = buildHealthSignals({ overview, metrics });
  const unknown = signals.find(s => s.code === 'TIKTOK_SPS_METRIC_UNKNOWN');
  assert.ok(unknown, '必须有一条说明哪些指标平台没给数据');
  assert.match(unknown.detail, /不是"没问题"|不是「没问题」/, '要说清"没数据"不等于"没问题"');
}

function testHealthKeepsPlatformThresholds() {
  // ★ 达标线是平台给的，我们不发明 —— 所以必须原样保留。
  const metrics = normalizeMetrics([
    {
      metric_code: 'A', metric_name: '迟发率', value: '6.0', value_unit: '%', score: '40', status: 'POOR',
      benchmarks: { excellent_threshold: '1.5', poor_threshold: '4.0' },
    },
  ]);
  assert.strictEqual(metrics[0].excellentThreshold, '1.5');
  assert.strictEqual(metrics[0].poorThreshold, '4.0');
  // 没有 benchmarks 时不能自己填。
  const noBench = normalizeMetrics([{ metric_code: 'B', metric_name: 'x', value: '1', status: 'GOOD' }]);
  assert.strictEqual(noBench[0].excellentThreshold, null);
  assert.strictEqual(noBench[0].poorThreshold, null);
}

function testHealthFormatsUnitsFromPlatform() {
  assert.strictEqual(formatValue('3.2', '%'), '3.2%');
  assert.strictEqual(formatValue('2', 'day'), '2 天');
  assert.strictEqual(formatValue(null, '%'), '—', '缺失就是破折号');
  assert.strictEqual(formatValue(0, '%'), '0%', '0 是有值，要显示');
}

// ---------------------------------------------------------------------------
// 4. 达人：端点与数据
// ---------------------------------------------------------------------------

function testCreatorEndpointsUseCurrentVersion() {
  // ★ 202505 版已被 202608 取代，且路径参数从 creator_id 改成 creator_user_id。
  assert.match(
    ENDPOINTS.affiliateCreator.path,
    /^\/affiliate_seller\/202608\/marketplace_creators\/\{creator_user_id\}$/,
    '达人表现端点应使用 202608 版与 creator_user_id 参数名',
  );
  assert.match(
    ENDPOINTS.affiliateCreatorSearch.path,
    /^\/affiliate_seller\/202608\/marketplace_creators\/search$/,
    '达人搜索端点路径不对',
  );
  // data_groups 必须是官方定义的那几个。
  assert.deepStrictEqual(
    CREATOR_DATA_GROUPS,
    ['BASIC_CREATOR_INFORMATION', 'CONTENT_PERFORMANCE', 'COLLABORATION', 'SALES_AND_GMV'],
    'data_groups 取值必须与官方一致',
  );
  // 达人端点走 Shop Open API（要签名），不是 Marketing API。
  assert.ok(ENDPOINTS.affiliateCreator.requiresShopCipher, '达人端点需要 shop_cipher');
  assert.ok(ENDPOINTS.affiliateCreatorSearch.requiresShopCipher, '达人搜索端点需要 shop_cipher');
}

function testCreatorRowMapping() {
  const row = toCreatorRow({
    creator_user_id: 'CR-1', nickname: '达人甲',
    follower_count: 125000, units_sold: 430,
    gmv: { currency: 'USD', amount: '12345.67' },
    gpm: { currency: 'USD', amount: '123.45' },
  });
  assert.strictEqual(row.nickname, '达人甲');
  assert.strictEqual(row.followerCount, 125000);
  assert.strictEqual(row.gmv, 12345.67);
  assert.strictEqual(row.currency, 'USD');
  assert.strictEqual(row.gpm, 123.45);
  // 缺失的字段保持 null，不能变成 0。
  assert.strictEqual(row.liveGmv, null);
  assert.strictEqual(row.brandCollaborationCount, null);
}

function testCreatorTableExists() {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS tiktok_creator_daily/,
    'schema 里缺 tiktok_creator_daily 表');
  // 达人表现是快照，主键要含达人 id 与日期。
  const table = schema.match(/CREATE TABLE IF NOT EXISTS tiktok_creator_daily[\s\S]*?PRIMARY KEY \([^)]+\)/);
  assert.ok(table, '找不到主键定义');
  assert.match(table[0], /creator_user_id/, '主键要含达人 id');
  assert.match(table[0], /event_date/, '主键要含日期');
}

function testCreatorSyncToleratesIndividualFailures() {
  // ★ 一个达人被封/被删是常事 —— 不能因此丢掉其它达人。
  const written = [];
  const runner = new TikTokCreatorSyncRunner({
    pool: { query: async () => ({ rows: [] }) },
    creatorRepository: {
      async upsertCreatorDaily({ rows }) { written.push(...rows); return rows.length; },
    },
    client: {
      async request({ path }) {
        if (path.endsWith('/search')) {
          return { creators: [{ creator_user_id: 'A' }, { creator_user_id: 'B' }] };
        }
        if (path.endsWith('/A')) {
          throw new Error('creator A is gone');
        }
        return { creator: { creator_user_id: 'B', nickname: '乙', gmv: { currency: 'USD', amount: '10' } } };
      },
    },
    tokenRepository: {
      async load() {
        return { accessToken: 'AT', refreshToken: 'RT', expiresAt: new Date(Date.now() + 86400000) };
      },
    },
  });

  return runner.syncShop({
    regionGroup: 'ROW', shopId: 'shop1', shopCipher: 'cipher1',
  }).then((summary) => {
    assert.strictEqual(summary.searched, 2);
    assert.strictEqual(summary.fetched, 1, '只有 B 成功');
    assert.strictEqual(summary.errors.length, 1, 'A 的失败要被记下来');
    assert.strictEqual(written.length, 1, 'B 仍要落库');
  });
}

// ---------------------------------------------------------------------------
// 5. 前端渲染
// ---------------------------------------------------------------------------

function testFrontendExportsNewRenderers() {
  for (const fn of ['renderAdsDiagnosis', 'renderHealth', 'renderCreators']) {
    assert.match(tiktokUi, new RegExp(`window\\.TikTokUI\\s*=\\s*\\{[^}]*${fn}`), `缺少 ${fn}`);
  }
  // 渲染函数里必须区分事实与推测。
  assert.match(tiktokUi, /数据事实/, '必须标出「数据事实」');
  assert.match(tiktokUi, /AI 推测建议/, '必须标出「AI 推测建议」');
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

const tests = [
  ['侧栏有四个新页签', testSidebarHasFourNewTabs],
  ['视图白名单覆盖新页签', testViewWhitelistCoversNewTabs],
  ['加载分支与按钮绑定齐全', testLoadBranchesExist],
  ['后端路由已注册', testBackendRoutesRegistered],
  ['shop_cipher 不从前端来', testShopCipherNeverComesFromFrontend],
  ['广告诊断三个比值各归其位', testAdsDiagnosisKeepsThreeRatiosApart],
  ['广告诊断说清每个比值的来路', testAdsDiagnosisExplainsEachRatio],
  ['无广告数据时给动作而非编数', testAdsDiagnosisWithoutDataGivesAction],
  ['健康：未知保持未知', testHealthKeepsUnknownAsUnknown],
  ['健康：没状态不猜达标', testHealthStatusNeverGuessesGood],
  ['健康：明确说明哪些指标没数据', testHealthSignalsIncludeUnknownNote],
  ['健康：保留平台给的达标线', testHealthKeepsPlatformThresholds],
  ['健康：单位由平台决定', testHealthFormatsUnitsFromPlatform],
  ['达人端点用当前版本', testCreatorEndpointsUseCurrentVersion],
  ['达人数据映射正确', testCreatorRowMapping],
  ['达人表已建', testCreatorTableExists],
  ['达人同步容忍单个失败', testCreatorSyncToleratesIndividualFailures],
  ['前端导出新渲染函数', testFrontendExportsNewRenderers],
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
  process.stdout.write(`tiktok four tabs tests passed (${passed} cases)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
