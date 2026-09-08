'use strict';

/**
 * 物流决策页面 —— 后端口径与缓存单测（TEST A–H）
 * 覆盖需求第十二条 24 项关键 case 中的后端可验证子集：
 *   A. sea=RMB/CBM、air=RMB/KG、永不通算
 *   B. cbm=0/weight=0/freight=0/非RMB/缺日期/到货<发运/cancelled/land/express 排除
 *   C. 加权单位运费 SUM(freight)/SUM(unit) ≠ AVG；n=1/2 不伪造 P90；n<5 不返回稳定性等级
 *   D. 单货代不显示“首选”；双 n=1 不高置信推荐；n>=3 真实 P90；n>=5 返回原始 p50/p90/cv
 *   E. detail 接口按 country+transport 精确过滤（sea/air 不混）
 *   F. 缓存层：summary/detail 分 key + 按 combo 隔离命中（覆盖“切回命中缓存”）
 *   G. mutation 精准失效：logistics PUT/POST 打脏 logistics-decision-summary + 所有 detail 桶（不全局清）
 *   H. 小样本展示「数据较少」/「样本不足」语义（字段级断言）
 * 前端瞬开/筛选切换/旧请求防护（case 19/20/22/23）由缓存层 F + reqToken 设计保证，浏览器验收阶段确认。
 */

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { query, queryOne, run, getDB } = require('./db');
const { computeLogisticsDecision } = require('./server');

function resetDB() {
  const d = getDB();
  d.exec('DELETE FROM logistics_batches');
}
function createSchema() {
  getDB().exec(`
    CREATE TABLE IF NOT EXISTS logistics_batches (
      id TEXT PRIMARY KEY, batch_no TEXT NOT NULL UNIQUE, logistics_status TEXT DEFAULT 'completed',
      target_country TEXT DEFAULT '', transport_mode TEXT DEFAULT '',
      forwarder_id TEXT DEFAULT '', forwarder_name TEXT DEFAULT '',
      total_freight NUMERIC DEFAULT 0, total_cbm NUMERIC DEFAULT 0, total_weight NUMERIC DEFAULT 0,
      freight_currency TEXT DEFAULT 'RMB', depart_date TEXT DEFAULT '', actual_arrival_date TEXT DEFAULT ''
    )
  `);
}
let _seq = 0;
function insertBatch(o) {
  _seq++;
  run(
    'INSERT INTO logistics_batches (id, batch_no, logistics_status, target_country, transport_mode, forwarder_id, forwarder_name, total_freight, total_cbm, total_weight, freight_currency, depart_date, actual_arrival_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      'b' + _seq, 'BN' + _seq, o.status || 'completed', o.country, o.transport, o.fid || o.fname, o.fname,
      o.freight, o.cbm || 0, o.weight || 0, o.currency || 'RMB', o.depart, o.arrival
    ]
  );
}
// 由 depart + days 计算 arrival（ISO 日期）
function arr(depart, days) {
  const d = new Date(depart + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ===== A. 基础分组 + 双口径 + 小样本不伪造 =====
test('A. 双口径分离 + n=1 不伪造 P90/稳定性 + 单货代不显示首选', () => {
  createSchema(); resetDB();
  // ID·sea 仅丰年 n=1
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 980, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', 22) });
  // ID·air 丰年 n=1 (12.5/KG, 8天) 与 随波 n=1 (13/KG, 10天) → 丰年更便宜且更快
  insertBatch({ country: 'ID', transport: 'air', fname: '丰年', freight: 1250, weight: 100, depart: '2026-02-01', arrival: arr('2026-02-01', 8) });
  insertBatch({ country: 'ID', transport: 'air', fname: '随波', freight: 1300, weight: 100, depart: '2026-02-01', arrival: arr('2026-02-01', 10) });

  const sum = computeLogisticsDecision('12m', null, null);
  assert.equal(sum.valid_count, 3);
  assert.equal(sum.excluded_count, 0);
  // sea 行（独立单位 RMB/CBM）
  const sea = sum.rows.find(r => r.country === 'ID' && r.transport === 'sea');
  assert.ok(sea, '应有 ID·sea 行');
  assert.equal(sea.unit, 'RMB/CBM');
  assert.equal(sea.forwarders.length, 1);
  assert.equal(sea.forwarders[0].unit_cost, 980);
  assert.equal(sea.forwarders[0].normal_days, 22);
  assert.equal(sea.forwarders[0].has_conservative, false); // n=1 → 不伪造 P90
  assert.equal(sea.forwarders[0].conservative_days, null);
  assert.equal(sea.forwarders[0].stability_ready, false);  // n<5 → 不评稳定性
  assert.equal(sea.verdict_code, 'only_forwarder');         // 单货代 → 不显示首选
  assert.equal(sea.primary, null);
  assert.equal(sea.sample_adequate, false);
  // air 行（独立单位 RMB/KG）；丰年更便宜且更快 → record_both（低样本，不强行首选）
  const air = sum.rows.find(r => r.country === 'ID' && r.transport === 'air');
  assert.equal(air.unit, 'RMB/KG');
  const feng = air.forwarders.find(f => f.name === '丰年');
  const sui = air.forwarders.find(f => f.name === '随波');
  assert.equal(feng.unit_cost, 12.5);
  assert.equal(sui.unit_cost, 13);
  assert.equal(air.verdict_code, 'record_both');
  assert.equal(air.primary.name, '丰年');
  assert.equal(air.sample_adequate, false);
});

// ===== B. 排除规则（12 项数据质量 case） =====
test('B. 异常批次全部排除 + 非RMB计入 excluded_currency_count', () => {
  createSchema(); resetDB();
  // 1 条有效基线
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 980, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', 22) });
  // cancelled
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 500, cbm: 1, status: 'cancelled', depart: '2026-01-01', arrival: arr('2026-01-01', 10) });
  // cbm=0 (sea)
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 500, cbm: 0, depart: '2026-01-01', arrival: arr('2026-01-01', 10) });
  // weight=0 (air)
  insertBatch({ country: 'ID', transport: 'air', fname: '丰年', freight: 500, weight: 0, depart: '2026-01-01', arrival: arr('2026-01-01', 10) });
  // freight=0
  insertBatch({ country: 'ID', transport: 'sea', name: '丰年', fid: '丰年', freight: 0, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', 10) });
  // arrival < depart
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 500, cbm: 1, depart: '2026-01-05', arrival: '2026-01-01' });
  // 缺 depart
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 500, cbm: 1, depart: '', arrival: '2026-01-10' });
  // 缺 arrival
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 500, cbm: 1, depart: '2026-01-01', arrival: '' });
  // land（v1 排除）
  insertBatch({ country: 'ID', transport: 'land', fname: '丰年', freight: 500, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', 10) });
  // express（v1 排除）
  insertBatch({ country: 'ID', transport: 'express', fname: '丰年', freight: 500, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', 10) });
  // 非 RMB（计入 excluded_currency_count，且不参与成本比较）
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 500, cbm: 1, currency: 'USD', depart: '2026-01-01', arrival: arr('2026-01-01', 10) });

  const sum = computeLogisticsDecision('12m', null, null);
  // 仅 1 条有效
  assert.equal(sum.valid_count, 1);
  assert.equal(sum.excluded_currency_count, 1); // 仅 USD 那条
  // completed_in_range = 10（11 条中 1 条 cancelled 不计；缺 depart 那条因 depart 不在时间范围内也不计入 range 基数）
  // valid=1 → excluded = 10 - 1 = 9？ 实际：缺 depart 批次 depart='' 不满足 depart_date>=range_start，故不计入 completed_in_range 基数 → completed_in_range=9 → excluded=8
  assert.equal(sum.excluded_count, 8);
  // 非 RMB 未污染有效成本
  const sea = sum.rows.find(r => r.country === 'ID' && r.transport === 'sea');
  assert.equal(sea.forwarders[0].unit_cost, 980); // USD 那条未参与
});

// ===== C. 加权单位运费 + n>=3 真实P90 + n>=5 返回原始cv + not_recommended =====
test('C. 加权 SUM/SUM ≠ AVG；n>=3 真实P90；n>=5 返回p50/p90/cv；被支配货代标不建议', () => {
  createSchema(); resetDB();
  // F1 ID·sea n=5：freight/cbm = [980/1,2000/2,3000/3,1500/1.5,2500/2.5]；days=[20,22,24,28,30]
  const f1 = [['980', 1, 20], ['2000', 2, 22], ['3000', 3, 24], ['1500', 1.5, 28], ['2500', 2.5, 30]];
  f1.forEach(b => insertBatch({ country: 'ID', transport: 'sea', fname: 'F1', freight: Number(b[0]), cbm: b[1], depart: '2026-01-01', arrival: arr('2026-01-01', b[2]) }));
  // F2 ID·sea n=3：更便宜(800/CBM)且更快(days 10/12/14)
  [10, 12, 14].forEach(d => insertBatch({ country: 'ID', transport: 'sea', fname: 'F2', freight: 800, cbm: 1, depart: '2026-03-01', arrival: arr('2026-03-01', d) }));
  // F3 ID·sea n=1：更贵(5000/CBM)且更慢(40天) → 被 F2 支配
  insertBatch({ country: 'ID', transport: 'sea', fname: 'F3', freight: 5000, cbm: 1, depart: '2026-04-01', arrival: arr('2026-04-01', 40) });

  const sum = computeLogisticsDecision('12m', null, null);
  const sea = sum.rows.find(r => r.country === 'ID' && r.transport === 'sea');
  const g1 = sea.forwarders.find(f => f.name === 'F1');
  const g2 = sea.forwarders.find(f => f.name === 'F2');
  const g3 = sea.forwarders.find(f => f.name === 'F3');
  // 加权：SUM(freight)=9980 / SUM(cbm)=10 = 998.0（若用 AVG 则为 996，证明走 SUM/SUM）
  assert.ok(Math.abs(g1.unit_cost - 998.0) < 0.01, '加权单位运费应为 998.0，实际 ' + g1.unit_cost);
  // n=5 → 稳定性原始数据返回
  // 百分位口径 = nearest-rank 向上取整（不插值）：
  //   n=5 days=[20,22,24,28,30] → P50 位置 ceil(5/2)=3 → 24；P90 位置 ceil(5*0.9)=5 → 30
  assert.equal(g1.stability_ready, true);
  assert.ok(g1.stability_calc && g1.stability_calc.p50 === 24 && g1.stability_calc.p90 === 30,
    'n=5 应为 p50=24 p90=30（nearest-rank），实际 ' + JSON.stringify(g1.stability_calc));
  assert.ok(g1.stability_calc.cv > 0);
  // n>=3 真实 P90：F2 days[10,12,14] → P50 位置 ceil(3/2)=2 → 12；P90 位置 ceil(2.7)=3 → 14
  // 反例保护：若用截断 CAST(n*0.9) 会得到位置 2 → P90=12，保守天数退化成中位数（偏乐观），必须失败
  assert.equal(g2.normal_days, 12);
  assert.equal(g2.conservative_days, 14);
  assert.equal(g2.has_conservative, true);
  // 决策：F2 更便宜且更快 → cheaper_faster，且 n>=3 充分样本
  assert.equal(sea.verdict_code, 'cheaper_faster');
  assert.equal(sea.primary.name, 'F2');
  assert.equal(sea.sample_adequate, true);
  // F3 被支配 → not_recommended
  assert.equal(g3.not_recommended, true);
  assert.equal(g2.not_recommended, false);
});

// ===== D. 单货代 + 双 n=1 不高置信推荐（语义） =====
test('D. 双 n=1 不高置信推荐（record_* 而非 cheaper_faster）', () => {
  createSchema(); resetDB();
  // 两货代均 n=1，且一个更贵更慢
  insertBatch({ country: 'ID', transport: 'sea', fname: 'A', freight: 1000, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', 20) });
  insertBatch({ country: 'ID', transport: 'sea', fname: 'B', freight: 1200, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', 30) });
  const sum = computeLogisticsDecision('12m', null, null);
  const sea = sum.rows.find(r => r.country === 'ID' && r.transport === 'sea');
  assert.equal(sea.forwarders.length, 2);
  assert.equal(sea.sample_adequate, false);
  // A 更便宜且更快 → record_both（低样本，不强行首选）
  assert.equal(sea.verdict_code, 'record_both');
  assert.equal(sea.primary.name, 'A');
  // B 更贵更慢 → not_recommended
  assert.equal(sea.forwarders.find(f => f.name === 'B').not_recommended, true);
});

// ===== E. detail 按 country+transport 精确过滤（sea/air 不混） =====
test('E. detail 接口按 country+transport 精确过滤', () => {
  createSchema(); resetDB();
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 980, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', 22) });
  insertBatch({ country: 'ID', transport: 'air', fname: '丰年', freight: 1250, weight: 100, depart: '2026-02-01', arrival: arr('2026-02-01', 8) });
  const dSea = computeLogisticsDecision('12m', 'ID', 'sea');
  assert.equal(dSea.rows.length, 1);
  assert.equal(dSea.rows[0].transport, 'sea');
  assert.equal(dSea.rows[0].unit, 'RMB/CBM');
  const dAir = computeLogisticsDecision('12m', 'ID', 'air');
  assert.equal(dAir.rows.length, 1);
  assert.equal(dAir.rows[0].transport, 'air');
  assert.equal(dAir.rows[0].unit, 'RMB/KG');
  // 缺参数应被路由层拒绝（此处直接校验 builder 对缺 country 返回全部，路由层再 400）
  const all = computeLogisticsDecision('12m', null, null);
  assert.equal(all.rows.length, 2);
});

// ===== F. 缓存层：summary/detail 分 key + combo 隔离命中（覆盖“切回命中缓存”） =====
test('F. AppStore.page 按 combo 分桶且签名隔离', () => {
  require('./app-perf'); // 挂到 globalThis.AppStore
  const ps = globalThis.AppStore.page;
  ps.set('logistics-decision-detail|12m|ID|sea', 'sig1', { v: 'sea-data' }, { ttl: 60000 });
  ps.set('logistics-decision-detail|12m|ID|air', 'sig1', { v: 'air-data' }, { ttl: 60000 });
  // 同 combo 同签名命中
  assert.deepEqual(ps.hit('logistics-decision-detail|12m|ID|sea', 'sig1', 60000), { v: 'sea-data' });
  // 不同 combo 不串
  assert.equal(ps.hit('logistics-decision-detail|12m|ID|air', 'sig1', 60000).v, 'air-data');
  assert.equal(ps.hit('logistics-decision-detail|12m|ID|sea', 'sig1', 60000).v, 'sea-data');
  // 不同签名不命中
  assert.equal(ps.hit('logistics-decision-detail|12m|ID|sea', 'sig2', 60000), undefined);
  // 不同时间范围不串
  assert.equal(ps.hit('logistics-decision-detail|6m|ID|sea', 'sig1', 60000), undefined);
});

// ===== G. mutation 精准失效：logistics 写操作打脏 summary + 所有 detail 桶（不全局清） =====
test('G. logistics mutation 精准打脏 logistics-decision 缓存（不全局清）', () => {
  require('./app-perf');
  const ps = globalThis.AppStore.page;
  ps.set('logistics-decision-summary|12m', 's', { a: 1 }, { ttl: 60000 });
  ps.set('logistics-decision-detail|12m|ID|sea', 'd', { b: 1 }, { ttl: 60000 });
  ps.set('logistics-decision-detail|12m|ID|air', 'd', { c: 1 }, { ttl: 60000 });
  ps.set('inventory', 'inv', { keep: 1 }, { ttl: 60000 }); // 不相关页面，应保留
  // 模拟物流批次 PUT
  globalThis.AppStore.onMutation('PUT', '/api/logistics-batches/123', {});
  assert.equal(ps.get('logistics-decision-summary|12m').dirty, true, 'summary 应打脏');
  assert.equal(ps.get('logistics-decision-detail|12m|ID|sea').dirty, true, 'detail(sea) 应打脏');
  assert.equal(ps.get('logistics-decision-detail|12m|ID|air').dirty, true, 'detail(air) 应打脏');
  assert.equal(ps.get('inventory').dirty, false, '不相关页面不应打脏（非全局清）');
  // notify 通知类不打脏
  ps.set('logistics-decision-detail|12m|ID|sea', 'd', { b: 1 }, { ttl: 60000 });
  globalThis.AppStore.onMutation('POST', '/api/logistics-batches/123/notify', {});
  assert.equal(ps.get('logistics-decision-detail|12m|ID|sea').dirty, false, 'notify 通知不打脏');
});

// ===== H. 小样本字段语义（数据较少/样本不足） =====
test('H. 小样本字段语义正确', () => {
  createSchema(); resetDB();
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 980, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', 22) });
  const sum = computeLogisticsDecision('12m', null, null);
  const f = sum.rows[0].forwarders[0];
  assert.equal(f.n, 1);
  assert.equal(f.low_sample, true);
  assert.equal(f.has_conservative, false);
  assert.equal(f.conservative_days, null);
  assert.equal(f.stability_ready, false);
  assert.equal(sum.rows[0].sample_adequate, false);
});

// ===== I. NULL forwarder_id / forwarder_name 不丢组（valid_count 与表格 n 之和守恒） =====
test('I. forwarder_id/name 为 NULL 时不丢组，且 SUM(n) == valid_count', () => {
  createSchema(); resetDB();
  // 直接写入 NULL（生产历史行可能如此），绕过 insertBatch 的默认值
  getDB().exec(`INSERT INTO logistics_batches
    (id,batch_no,logistics_status,target_country,transport_mode,forwarder_id,forwarder_name,
     total_freight,total_cbm,total_weight,freight_currency,depart_date,actual_arrival_date)
    VALUES ('n1','NB1','completed','ID','sea',NULL,NULL,1000,1,0,'RMB','2026-01-01','2026-01-21')`);
  insertBatch({ country: 'ID', transport: 'sea', fname: '丰年', freight: 900, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', 20) });

  const sum = computeLogisticsDecision('12m', null, null);
  assert.equal(sum.valid_count, 2);
  const totalN = sum.rows.reduce((s, r) => s + r.forwarders.reduce((a, f) => a + f.n, 0), 0);
  assert.equal(totalN, sum.valid_count, 'SUM(n) 必须等于 valid_count，否则有货代组被静默丢弃');
  const sea = sum.rows.find(r => r.country === 'ID' && r.transport === 'sea');
  assert.equal(sea.forwarders.length, 2, 'NULL 货代应作为独立组保留');
  assert.ok(sea.forwarders.some(f => f.unit_cost === 1000), 'NULL 货代的单位运费应仍被计算');
});

// ===== J. split 结论必须带 delta_cost/delta_days（前端文案直接读，缺失会渲染出 undefined） =====
test('J. split 分流结论携带 delta_cost/delta_days', () => {
  createSchema(); resetDB();
  // A：便宜(800/CBM)但慢(20天)，n=3；B：贵(1000/CBM)但快(12天)，n=3 → 双方样本充分 → split
  [20, 20, 20].forEach(d => insertBatch({ country: 'ID', transport: 'sea', fname: 'A', freight: 800, cbm: 1, depart: '2026-01-01', arrival: arr('2026-01-01', d) }));
  [12, 12, 12].forEach(d => insertBatch({ country: 'ID', transport: 'sea', fname: 'B', freight: 1000, cbm: 1, depart: '2026-02-01', arrival: arr('2026-02-01', d) }));

  const sum = computeLogisticsDecision('12m', null, null);
  const sea = sum.rows.find(r => r.country === 'ID' && r.transport === 'sea');
  assert.equal(sea.verdict_code, 'split');
  assert.equal(sea.normal_replenish.name, 'A', '常规补货 = 最便宜');
  assert.equal(sea.urgent_replenish.name, 'B', '紧急补货 = 最快');
  // 关键断言：delta 字段必须存活过 slim() 白名单投影
  assert.equal(sea.urgent_replenish.delta_cost, 200, '每 CBM 多花 1000-800=200');
  assert.equal(sea.urgent_replenish.delta_days, 8, '快 20-12=8 天');
  // 双方都不应被判"不建议"（各有优势，互不支配）
  assert.equal(sea.forwarders.find(f => f.name === 'A').not_recommended, false);
  assert.equal(sea.forwarders.find(f => f.name === 'B').not_recommended, false);
});
