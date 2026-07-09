// 验证「订单预测顶部收起/展开」真实逻辑：加载真实 app.js，注入最小 DOM/localStorage 桩，
// 直接调用 app.js 中真实的 toggleRpCollapse / applyRpCollapseState / applyRpCollapse 函数。
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// ---- 最小 DOM 桩 ----
function makeEl() {
  const classes = new Set();
  return {
    textContent: '',
    title: '',
    _classes: classes,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => {
        const has = classes.has(c);
        const want = force === undefined ? !has : !!force;
        if (want) classes.add(c); else classes.delete(c);
        return want;
      },
      contains: c => classes.has(c)
    }
  };
}
const els = {};
function getEl(id) { if (!els[id]) els[id] = makeEl(); return els[id]; }

const documentMock = {
  getElementById: id => (id === 'rp-collapsible' || id === 'rp-collapse-btn') ? getEl(id) : null,
  addEventListener: () => {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, set innerHTML(v) {}, get innerHTML() { return ''; } }),
  body: { appendChild() {} }
};

const store = {};
const localStorageMock = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

const windowMock = { addEventListener: () => {} };

const sandbox = {
  window: windowMock,
  document: documentMock,
  localStorage: localStorageMock,
  console,
  setTimeout: () => {},
  Math, JSON, Date, Number, String, Array, Object, Set, RegExp, isNaN, parseInt, parseFloat,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  fetch: () => Promise.reject(new Error('no fetch in test'))
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'app.js' });

// ---- 断言工具 ----
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  [OK ] ' + msg); }
  else { fail++; console.log('  [FAIL] ' + msg); }
}

const toggle = sandbox.toggleRpCollapse;
const applyState = sandbox.applyRpCollapseState;
const apply = sandbox.applyRpCollapse;

console.log('=== 1. 函数存在性（确认真实代码已包含新逻辑）===');
assert(typeof toggle === 'function', 'toggleRpCollapse 是函数');
assert(typeof applyState === 'function', 'applyRpCollapseState 是函数');
assert(typeof apply === 'function', 'applyRpCollapse 是函数');

const collapsedEl = getEl('rp-collapsible');
const btn = getEl('rp-collapse-btn');

console.log('\n=== 2. 默认展开（localStorage 为空）===');
store['rp_top_collapsed'] = undefined; delete store['rp_top_collapsed'];
apply();
assert(!collapsedEl._classes.has('rp-collapsed'), '默认未折叠');
assert(btn.textContent === '▾ 收起', '按钮文本=“▾ 收起”');

console.log('\n=== 3. 点击收起（toggle）===');
toggle();
assert(collapsedEl._classes.has('rp-collapsed'), '折叠区被隐藏 (class=rp-collapsed)');
assert(store['rp_top_collapsed'] === '1', 'localStorage 已存 = “1”');
assert(btn.textContent === '▸ 展开', '按钮文本切换为 “▸ 展开”');

console.log('\n=== 4. 再次点击展开（toggle）===');
toggle();
assert(!collapsedEl._classes.has('rp-collapsed'), '折叠区恢复显示');
assert(store['rp_top_collapsed'] === '0', 'localStorage 已存 = “0”');
assert(btn.textContent === '▾ 收起', '按钮文本恢复为 “▾ 收起”');

console.log('\n=== 5. 模拟页面重载：localStorage 已有 “1” 应自动恢复折叠 ===');
store['rp_top_collapsed'] = '1';
// 重置 DOM 状态，模拟新渲染
collapsedEl._classes.clear(); btn.textContent = '';
apply();
assert(collapsedEl._classes.has('rp-collapsed'), '重载后自动保持折叠');
assert(btn.textContent === '▸ 展开', '重载后按钮文本=“▸ 展开”');

console.log('\n=== 6. 内部元素 id 未被破坏（筛选/指标/表格逻辑仍可用）===');
assert(code.includes("id=\"rp-c\""), '筛选区 国家下拉 id=rp-c 仍在');
assert(code.includes("id=\"rp-kpi\""), '指标卡容器 id=rp-kpi 仍在');
assert(code.includes("id=\"rp-table\""), '表格容器 id=rp-table 仍在');
assert(
  code.includes('switchRpTab(') &&
  code.includes('📊 总预测') && code.includes('🛒 线上预测') && code.includes('🏪 线下预测'),
  '总/线上/线下 三个 Tab（总预测/线上预测/线下预测）切换逻辑未改动'
);
assert(code.includes("onclick=\"genPOModal()\""), '生成PO入口 genPOModal 未被改动');

console.log('\n========================================');
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
