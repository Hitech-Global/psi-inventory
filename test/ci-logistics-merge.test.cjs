// CI/PL × 物流合并 PHASE A — hermetic 前端 builder 测试 + 静态接线/审计隔离校验
// 不依赖服务器/PG：从 app.js 真实源码中按括号匹配抽取真实函数，在沙箱中执行。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// —— 括号匹配抽取真实函数 ——
function extractFn(src, name) {
  const sig = 'function ' + name + '(';
  const idx = src.indexOf(sig);
  if (idx < 0) throw new Error('extractFn: 未找到 ' + name);
  // 从函数自身的 '(' 开始计数括号，找到参数列表结束的 ')'
  let i = idx + sig.length - 1; // 指向 '('
  let depth = 1;
  while (i < src.length) {
    i++;
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  while (i < src.length && src[i] !== '{') i++;
  const bodyStart = i; let bd = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') bd++;
    else if (src[j] === '}') { bd--; if (bd === 0) { j++; break; } }
  }
  return src.slice(idx, j);
}

const FNS = [
  'ciAccHead', 'renderCIItemsShell', 'renderCIItemsRows', 'renderCIPLShell', 'renderPLSubShell',
  'toggleCISection', 'togglePLSection', 'renderPLItemsRows', 'renderCILogisticsShell',
  'renderCILogisticsTable', 'buildPLPriceLookup', 'validatePLExport', 'sanitizeSheetName',
  'buildPLSheetRows', 'exportBlockReason', '__ciCtx', 'invalidateCILogistics'
];
let fnSrc = '';
FNS.forEach(n => { fnSrc += extractFn(APP, n) + '\n'; });

// 沙箱：最小依赖 stub（与真实 app.js 顶部 helper 行为一致）
const sandbox = {};
const stub = `
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function fmtMoney(v,c){const n=Number(v||0);return (c?c+' ':'')+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function fmtDate(d){return d?String(d).split('T')[0]:'';}
  function t(key,def){ return (arguments.length>=2 && def!=null)?def:key; }
  function hasPermission(p){ return false; }
  function showToast(){}
  function api(){ return Promise.resolve({}); }
  var window = { __ciDetailCtx: null };
  function FakeEl(){ this._a={}; this.innerHTML=''; this.textContent=''; this.style={}; }
  FakeEl.prototype.hasAttribute=function(k){return k in this._a;};
  FakeEl.prototype.getAttribute=function(k){return this._a[k];};
  FakeEl.prototype.setAttribute=function(k,v){this._a[k]=v;};
  FakeEl.prototype.removeAttribute=function(k){delete this._a[k];};
  var __reg={};
  function reg(id){ if(!__reg[id]) __reg[id]=new FakeEl(); return __reg[id]; }
  var document = { getElementById:function(id){ return __reg[id]||null; } };
`;
vm.createContext(sandbox);
vm.runInContext(stub + '\n' + fnSrc + '\nthis.__api={renderCIItemsShell,renderCIItemsRows,renderCIPLShell,renderPLSubShell,toggleCISection,togglePLSection,renderPLItemsRows,renderCILogisticsShell,renderCILogisticsTable,buildPLPriceLookup,validatePLExport,sanitizeSheetName,buildPLSheetRows,exportBlockReason,__ciCtx,invalidateCILogistics,reg};', sandbox);
const A = sandbox.__api;

// 准备测试数据
const ci31 = { ci_no: 'HIT20260717-1A', id: 'ci_x', currency: 'USD', items: Array.from({ length: 31 }, (_, i) => ({
  sku_code: 'SKU' + i, shipped_qty: 10, unit_price: 5.5, discount: 0, net_unit_price: 5.5, ci_amount: 55, actual_customs_rate: 7, inbound_qty: 0, uninbound_qty: 10
})), packing_lists: [
  { id: 'pl1', pl_no: 'PL2026A', total_qty: 100, total_cartons: 10, total_cbm: 5, items: [{ sku_code: 'SKU0', qty_per_carton: 10, cartons: 10, total_qty: 100, gross_weight: 50, net_weight: 45, cbm: 5 }] },
  { id: 'pl2', pl_no: 'PL2026B', total_qty: 80, total_cartons: 8, total_cbm: 4, items: [{ sku_code: 'SKU1', qty_per_carton: 10, cartons: 8, total_qty: 80, gross_weight: 40, net_weight: 36, cbm: 4 }] },
  { id: 'pl3', pl_no: 'PL2026C', total_qty: 120, total_cartons: 12, total_cbm: 6, items: [{ sku_code: 'SKU2', qty_per_carton: 10, cartons: 12, total_qty: 120, gross_weight: 60, net_weight: 54, cbm: 6 }] }
] };

console.log('\n[1] 折叠壳结构');
{
  const s = A.renderCIItemsShell(ci31);
  ok('CI壳含 hidden 属性', s.includes('hidden'));
  ok('CI壳 data-rendered="0"', s.includes('data-rendered="0"'));
  ok('CI壳 tbody 初始为空（无 <tr>）', (s.match(/<tr/g) || []).length === 0);
  ok('CI壳显示计数 (31)', s.includes('(31)'));
}
console.log('\n[2] PL 多张壳（修复只显示首张 PL）');
{
  const s = A.renderCIPLShell(ci31);
  ok('PL壳含 3 张 PL 二级折叠壳', (s.match(/ci-pl-sub-/g) || []).length === 3);
  ok('PL壳二级 body 初始为空', (s.match(/<tr/g) || []).length === 0);
  ok('PL壳计数 (3)', s.includes('(3)'));
}
console.log('\n[3] 展开后渲染：CI 31 行 / PL items');
{
  sandbox.window.__ciDetailCtx = { ci: ci31, ciId: 'ci_x' }; // renderPLItemsRows 经 __ciCtx() 读取
  const ciRows = A.renderCIItemsRows(ci31);
  const ciData = (ciRows.split('<tbody>')[1] || '');
  ok('CI 展开生成 31 个 data <tr>', (ciData.match(/<tr/g) || []).length === 31, 'got ' + (ciData.match(/<tr/g) || []).length);
  const plRows = A.renderPLItemsRows('pl1');
  const plData = (plRows.split('<tbody>')[1] || '');
  ok('PL1 展开生成 1 个 data <tr>', (plData.match(/<tr/g) || []).length === 1, 'got ' + (plData.match(/<tr/g) || []).length);
}
console.log('\n[4] toggle 二次展开不重渲染 + 无额外 api');
{
  sandbox.window.__ciDetailCtx = { ci: ci31, ciId: 'ci_x' };
  const A2 = sandbox; // 同一上下文
  // 计数包裹
  vm.runInContext('var __rc=0; var __o=renderCIItemsRows; renderCIItemsRows=function(c){__rc++;return __o(c);};', sandbox);
  A.reg('ci-acc-body-items'); A.reg('ci-caret-items');
  A.toggleCISection('items');   // 展开 → 渲染 #1
  A.toggleCISection('items');   // 折叠
  A.toggleCISection('items');   // 再次展开 → 不应重渲染
  const rc = vm.runInContext('__rc', sandbox);
  const body = A.reg('ci-acc-body-items');
  ok('首次+二次展开仅渲染 1 次', rc === 1, 'rc=' + rc);
  ok('展开后 body 已渲染（非空）', body.innerHTML.length > 0);
  ok('折叠后 body 重新 hidden', body.hasAttribute('hidden'));
}
console.log('\n[5] 价格 lookup：同价 exact / 异价 ambiguous');
{
  const lu = A.buildPLPriceLookup([
    { sku_code: 'A', unit_price: 10 }, { sku_code: 'A', unit_price: 10 }, // 同价多行
    { sku_code: 'B', unit_price: 12 }, { sku_code: 'B', unit_price: 15 }   // 异价
  ], 'USD');
  ok('A 同价多行 → exact', lu.A.status === 'exact' && lu.A.unit_price === 10);
  ok('B 异价 → ambiguous', lu.B.status === 'ambiguous');
}
console.log('\n[6] validatePLExport：仅校验 in-scope SKU（范围最小化）');
{
  const lu = A.buildPLPriceLookup([
    { sku_code: 'A', unit_price: 10 }, { sku_code: 'B', unit_price: 12 }, { sku_code: 'B', unit_price: 15 }
  ], 'USD');
  const issues = A.validatePLExport(lu, ['A', 'B']); // 仅 A,B 在范围内；CI 内其它 SKU 不阻断
  ok('A exact 无 issue', !issues.find(x => x.sku_code === 'A'));
  ok('B ambiguous 被列出', !!issues.find(x => x.sku_code === 'B' && x.reason === 'ambiguous'));
  const issues2 = A.validatePLExport(lu, ['A', 'C']); // C 不在 lookup → missing
  ok('C missing 被列出', !!issues2.find(x => x.sku_code === 'C' && x.reason === 'missing'));
}
console.log('\n[7] sanitizeSheetName：31 截断 / 非法字符 / 重名 ~2');
{
  const long = 'PL_' + 'X'.repeat(40);
  const s1 = A.sanitizeSheetName(long);
  ok('超长名截断至 ≤31', s1.length <= 31, 'len=' + s1.length);
  const ill = A.sanitizeSheetName('PL/a:b*c?');
  ok('去除非法字符', !/[/\\:*?"<>|]/.test(ill));
  const used = {};
  const a = A.sanitizeSheetName('PL_1', used); const b = A.sanitizeSheetName('PL_1', used);
  ok('重名生成 ~2', b === 'PL_1~2', 'b=' + b);
}
console.log('\n[8] buildPLSheetRows：CI单价=unit_price（非 WAC），PL No. 完整');
{
  const rows = A.buildPLSheetRows(ci31.packing_lists[0], ci31, { SKU0: { unit_price: 5.5, currency: 'USD' } });
  ok('行数 = PL item 数', rows.length === 1);
  ok('CI单价=unit_price(5.5)', rows[0]['CI单价'] === 5.5);
  ok('CI币种=USD', rows[0]['CI币种'] === 'USD');
  ok('PL No. 完整', rows[0]['PL No.'] === 'PL2026A');
}
console.log('\n[9] 物流批次表：3 行 / 空集空态');
{
  const batches = [
    { id: 'b1', batch_no: 'LB1', pls: [{ pl_no: 'PL2026A', total_cbm: 5 }], transport_mode: 'sea', eta_date: '2026-08-10', actual_arrival_date: '2026-08-12', actual_transit_days: 25, total_cartons: 10, total_freight: 100, freight_currency: 'USD', freight_value_ratio: 6.5, logistics_display_status: 'arrived', listing_status: 'pending_plan', listing_owner_names: ['张三'] },
    { id: 'b2', batch_no: 'LB2', pls: [], transport_mode: 'air', total_freight: 50, freight_currency: 'USD', logistics_display_status: 'in_transit', listing_status: 'pending_plan', listing_owner_names: [] },
    { id: 'b3', batch_no: 'LB3', pls: [{ pl_no: 'PL2026C', total_cbm: 6 }], transport_mode: 'sea', total_freight: 70, freight_currency: 'USD', logistics_display_status: 'arrived', listing_status: 'ready', listing_owner_names: ['李四'] }
  ];
  const tbl = A.renderCILogisticsTable(batches, 'ci_x');
  const tblData = (tbl.split('<tbody>')[1] || '');
  ok('3 个 batch → 3 行 data <tr>', (tblData.match(/<tr/g) || []).length === 3, 'rows=' + (tblData.match(/<tr/g) || []).length);
  ok('批次 b1 CBM 聚合 = 5.00', tbl.includes('5.00'));
  ok('批次 b3 CBM 聚合 = 6.00', tbl.includes('6.00'));
  const empty = A.renderCILogisticsTable([], 'ci_x');
  ok('空集显示空态文案', empty.includes('暂无关联物流批次'));
}
console.log('\n[10] exportBlockReason：ambiguous 列出两个价');
{
  const data = { blocking_reason: 'price_ambiguous_or_missing', ci: { currency: 'USD' }, blocking_issues: [{ sku_code: 'B', reason: 'ambiguous', distinct_unit_prices: [12, 15] }] };
  const msg = A.exportBlockReason(data);
  ok('含 SKU B', msg.includes('B'));
  ok('含两个价 12.00 / 15.00', msg.includes('12.00') && msg.includes('15.00'));
}
console.log('\n[11] 静态接线：server.js 新增只读 route');
{
  ok('route :id/logistics-batches 存在', SERVER.includes("app.get('/api/commercial-invoices/:id/logistics-batches'"));
  ok('route :id/export-data 存在', SERVER.includes("app.get('/api/logistics-batches/:id/export-data'"));
  ok('LOGI_DERIVED_COLS 提取', SERVER.includes('const LOGI_DERIVED_COLS'));
  ok('decorateLogisticsRows 提取', SERVER.includes('function decorateLogisticsRows'));
  ok('旧物流列表 route 未被删除', SERVER.includes("app.get('/api/logistics-batches',"));
  ok('不可新增 ci_item 外键（无 ALTER/add column ci_item_id）', !/ci_item_id/.test(SERVER));
}
console.log('\n[12] viewCI 重构：初始不含 CI/PL item 行（懒渲染）');
{
  // 抽取完整 viewCI 不可行（依赖大量运行时），此处校验源码层面：模板已瘦身、壳 builder 被调用
  ok('viewCI 内调用 renderCIItemsShell', APP.includes('renderCIItemsShell(ci)'));
  ok('viewCI 内调用 renderCIPLShell', APP.includes('renderCIPLShell(ci)'));
  ok('viewCI 内调用 renderCILogisticsShell', APP.includes('renderCILogisticsShell(id)'));
  ok('viewCI 尾部队异步 load（非 await）', APP.includes('loadCILogistics(id).catch'));
  ok('viewCI 模板 v7 已置空（CI item 行移至懒渲染壳）', APP.includes("v7: ''"));
}

console.log('\n[13] 审计产物隔离：audit-artifacts/* 不得进入暂存区');
{
  try {
    const out = execSync('git status --porcelain', { cwd: ROOT }).toString();
    const stagedAudit = out.split('\n').filter(l => l && l[0] !== '?' && l[0] !== ' ' && /audit-artifacts\//.test(l.slice(3)));
    ok('无 audit-artifacts 文件被暂存', stagedAudit.length === 0, stagedAudit.join(' | '));
  } catch (e) { ok('git 状态可读取', false, e.message); }
}

console.log('\n[14] app.js / server.js 语法');
{
  try { require('child_process').execSync('node --check ' + path.join(ROOT, 'app.js')); ok('app.js --check 通过', true); }
  catch (e) { ok('app.js --check 通过', false, e.message); }
}

console.log('\n==== 结果: ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
