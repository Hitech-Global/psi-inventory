'use strict';

/**
 * logistics-filters-ux.test.cjs — LOGISTICS-FILTERS-UX 回归测试
 *
 * 纯前端本地筛选：国家(target_country) / 品牌(brand) / 仓库(target_warehouse)
 * 三筛选，默认"全部"，AND 组合，0 阻塞 GET（网络/UI 筛选分离）。
 *
 * 被测函数 applyLogisticsFilters 直接从 app.js 抽取真实源码 eval（不重造），
 * 保证测试的是生产真实逻辑。其余 F6/F7/F8/F9 用源码契约断言（warm cache 不被破坏）。
 *
 * 不访问生产 DB；不依赖浏览器。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ---- 从 app.js 抽取真实 applyLogisticsFilters 函数（brace-match）----
const appSrc = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
function extractFn(name) {
  const start = appSrc.indexOf('function ' + name);
  assert.ok(start >= 0, 'app.js 未找到 ' + name);
  const open = appSrc.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < appSrc.length; i++) {
    const c = appSrc[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  const body = appSrc.slice(start, i + 1);
  // eslint-disable-next-line no-eval
  eval(body); // 在当前作用域定义函数
  return body;
}
const fnSrc = extractFn('applyLogisticsFilters');
const applyLogisticsFilters = eval('(' + fnSrc + ')');

// ---- 样例数据（覆盖多国家/品牌/仓库、无 brand/warehouse 历史 batch、多品牌 batch）----
const ROWS = [
  { id: 'B1', target_country: 'ID', brand: 'Redragon', target_warehouse: 'Bekasi Warehouse', status: 'in_transit' },
  { id: 'B2', target_country: 'MY', brand: 'Netac', target_warehouse: 'KL Warehouse', status: 'in_transit' },
  { id: 'B3', target_country: 'ID', brand: 'Redragon', target_warehouse: 'Jakarta Warehouse', status: 'customs_clearing' },
  { id: 'B4', target_country: 'TH', brand: 'BOYA', target_warehouse: 'Bangkok Warehouse', status: 'in_transit' },
  { id: 'B5', target_country: 'ID', brand: 'Joypeer', target_warehouse: 'Bekasi Warehouse', status: 'pending_shipment' },
  { id: 'B6', target_country: 'ID', brand: 'Redragon', target_warehouse: 'Bekasi Warehouse', status: 'warehouse_arrived' },
  { id: 'B7', target_country: 'ID', brand: null, target_warehouse: null, status: 'in_transit' }, // 无 brand/warehouse 历史 batch
  { id: 'B8', target_country: 'ID', brands: ['Redragon', 'Netac'], target_warehouse: 'Bekasi Warehouse', status: 'in_transit' }, // 多品牌 batch
];

const ids = (arr) => arr.map((r) => r.id).sort();

test('F1: 三个默认"全部" → 显示完整列表', () => {
  const out = applyLogisticsFilters(ROWS, { country: '', brand: '', warehouse: '' });
  assert.equal(out.length, ROWS.length);
  assert.deepEqual(ids(out), ids(ROWS));
});

test('F2: country 筛选 → 只显示对应国家', () => {
  const out = applyLogisticsFilters(ROWS, { country: 'ID', brand: '', warehouse: '' });
  assert.deepEqual(ids(out), ['B1', 'B3', 'B5', 'B6', 'B7', 'B8']);
});

test('F3: brand 筛选 → 只显示包含该品牌的 batch', () => {
  const out = applyLogisticsFilters(ROWS, { country: '', brand: 'Redragon', warehouse: '' });
  // B1/B3/B6 标量 brand=Redragon；B8 多品牌数组含 Redragon
  assert.deepEqual(ids(out), ['B1', 'B3', 'B6', 'B8']);
});

test('F4: warehouse 筛选 → 只显示对应仓库', () => {
  const out = applyLogisticsFilters(ROWS, { country: '', brand: '', warehouse: 'Bekasi Warehouse' });
  assert.deepEqual(ids(out), ['B1', 'B5', 'B6', 'B8']);
});

test('F5: country + brand + warehouse → AND 组合正确', () => {
  const out = applyLogisticsFilters(ROWS, { country: 'ID', brand: 'Redragon', warehouse: 'Bekasi Warehouse' });
  // ID ∧ Redragon ∧ Bekasi = B1, B6（B8 也满足三条件）→ B1,B6,B8
  assert.deepEqual(ids(out), ['B1', 'B6', 'B8']);
});

test('F6: 筛选切换 = 0 阻塞 GET（纯函数无网络依赖）', () => {
  // 纯函数不得引用 api / fetch / XMLHttpRequest 等网络调用
  assert.ok(!/api\s*\(/.test(fnSrc), 'applyLogisticsFilters 不应调用 api()');
  assert.ok(!/fetch\s*\(/.test(fnSrc), 'applyLogisticsFilters 不应调用 fetch()');
  assert.ok(!/XMLHttpRequest/.test(fnSrc), 'applyLogisticsFilters 不应使用 XHR');
  // 连续筛选不抛错、不依赖外部状态
  let cur = ROWS;
  cur = applyLogisticsFilters(cur, { country: 'ID' });
  cur = applyLogisticsFilters(cur, { brand: 'Redragon' });
  cur = applyLogisticsFilters(cur, { warehouse: 'Bekasi Warehouse' });
  assert.deepEqual(ids(cur), ['B1', 'B6', 'B8']);
});

test('F10: 空结果 → 正常返回 0 条，无异常', () => {
  const out = applyLogisticsFilters(ROWS, { brand: 'NonExistentBrand' });
  assert.equal(out.length, 0);
  // 其他筛选组合仍可用
  assert.equal(applyLogisticsFilters(ROWS, { country: 'ZZ' }).length, 0);
});

test('F11: 多品牌 batch → 选择其中任一品牌均可命中', () => {
  // B8 brands=['Redragon','Netac']
  const byRedragon = applyLogisticsFilters(ROWS, { brand: 'Redragon' });
  const byNetac = applyLogisticsFilters(ROWS, { brand: 'Netac' });
  assert.ok(byRedragon.some((r) => r.id === 'B8'), '多品牌 batch 应命中 Redragon');
  assert.ok(byNetac.some((r) => r.id === 'B8'), '多品牌 batch 应命中 Netac');
  assert.deepEqual(ids(byNetac), ['B2', 'B8']);
});

test('F12: 无 brand / warehouse 的历史 batch → 不报错，全部状态下仍显示', () => {
  // B7 brand=null, warehouse=null
  const out = applyLogisticsFilters(ROWS, { country: '', brand: '', warehouse: '' });
  assert.ok(out.some((r) => r.id === 'B7'), '无 brand/warehouse 的 batch 在"全部"下应显示');
  // 仅按 country=ID 过滤时 B7 仍应出现（因 country 匹配，brand/warehouse 为"全部"）
  const byId = applyLogisticsFilters(ROWS, { country: 'ID', brand: '', warehouse: '' });
  assert.ok(byId.some((r) => r.id === 'B7'), 'B7 在 country=ID 且其余全部时仍显示');
});

// ---- F7/F8/F9: 源码契约（warm cache 不被破坏 + 三筛选状态持久化 + mutation 后重 apply）----
test('F7/F8: warm cache 架构不被破坏（cacheKey/logistics + status signature 不变）', () => {
  assert.ok(appSrc.includes("cacheKey:'logistics'"), 'loadLog 必须仍用 cacheKey=logistics');
  assert.ok(appSrc.includes("signature:_sig") && appSrc.includes("const _sig='log:'+s"), 'signature 仍仅依赖 status（log:<status>）');
  assert.ok(appSrc.includes("_logRawRows=data;"), 'loadLog 必须保存完整 raw 快照');
  assert.ok(appSrc.includes("const _view=applyLogisticsFilters(data,{country:_logCountryFilter,brand:_logBrandFilter,warehouse:_logWarehouseFilter})"), 'loadLog 必须按三筛选本地重算 _view');
  // 三筛选状态变量持久化
  assert.ok(appSrc.includes('let _logCountryFilter='), '存在 _logCountryFilter 会话态');
  assert.ok(appSrc.includes('let _logBrandFilter='), '存在 _logBrandFilter 会话态');
  assert.ok(appSrc.includes('let _logWarehouseFilter='), '存在 _logWarehouseFilter 会话态');
});

test('F7: 三筛选 UI 已挂载且 onchange 触发本地筛选', () => {
  assert.ok(appSrc.includes("id=\"log-country\" onchange=\"applyLogFilters()\""), '国家 select 已挂载并绑定 applyLogFilters');
  assert.ok(appSrc.includes("id=\"log-brand\" onchange=\"applyLogFilters()\""), '品牌 select 已挂载并绑定 applyLogFilters');
  assert.ok(appSrc.includes("id=\"log-warehouse\" onchange=\"applyLogFilters()\""), '仓库 select 已挂载并绑定 applyLogFilters');
});

test('F7/F9: facets 动态生成 + loadLog 内调用 populateLogFacets + mutation 重 apply 路径存在', () => {
  assert.ok(appSrc.includes('function populateLogFacets()'), '存在 populateLogFacets（facets 动态生成，不新增 endpoint）');
  assert.ok(appSrc.includes('populateLogFacets();'), 'loadLog 内必须调用 populateLogFacets（raw list → facets）');
  // mutation invalidation 链路已在 LOGISTICS-WARM-RETURN-P1 落地：markDirty('logistics') → reload → _logRawRows 刷新 → 当前筛选重 apply
  assert.ok(appSrc.includes("function applyLogFilters()"), '存在 applyLogFilters（本地重筛入口，0 阻塞 GET）');
});

test('F9: mutation dirty 后 reload 路径存在（markDirty→loadLog→重 apply）', () => {
  const appPerf = fs.readFileSync(path.resolve(__dirname, '..', 'app-perf.js'), 'utf8');
  // 契约：物流写操作（notify 除外）必须打脏 logistics 页缓存（mutation=invalidation，navigation 不打脏）。
  // 用稳定片段断言，兼容同一行的相邻扩展（如 logistics-decision-summary 同块打脏）。
  assert.ok(appPerf.includes("if (isLogi && !has('/notify'))"), 'app-perf 物流写操作守卫（排除 notify）存在');
  assert.ok(appPerf.includes("pages.push('logistics')"), 'app-perf 物流写操作仍打脏 logistics 页缓存（mutation=invalidation）');
});
