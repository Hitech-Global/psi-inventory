// 线上验收回归（真实生产环境，直接打真实端点，非隔离副本）。
// 覆盖用户验收清单 A(登录/会话) / B(各模块端点) / C(并发稳定性) / D(数据对齐)。
// 安全：所有凭据仅来自环境变量，绝不硬编码；不写入任何文件/仓库。
//   PROD_BASE_URL   默认 https://psi-inventory.onrender.com
//   PROD_BG_USER    默认 admin
//   PROD_BG_PASS    break-glass 管理员密码（必填）
//   PROD_TEST_SKUS  可选，逗号分隔的 P1 测试 SKU 编码，用于断言“不再出现”
//   PROD_TEST_COUNTRIES 可选，逗号分隔的已删除测试国家名，用于断言“不再出现”
//   PROD_TEST_WAREHOUSES 可选，逗号分隔的已删除测试仓库名
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

const LOG = process.env.SMOKE_LOG || (os.tmpdir() + '/online-regression.log');
try { fs.writeFileSync(LOG, ''); } catch (e) {}
const _log = console.log;
console.log = (...a) => { _log(...a); try { fs.appendFileSync(LOG, a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'); } catch (e2) {} };

const BASE = (process.env.PROD_BASE_URL || 'https://psi-inventory.onrender.com').replace(/\/$/, '');
const USER = process.env.PROD_BG_USER || 'admin';
const PASS = process.env.PROD_BG_PASS;
if (!PASS) { console.error('[FATAL] 必须设置 PROD_BG_PASS（线上 break-glass 密码）'); process.exit(1); }
const testSkus = (process.env.PROD_TEST_SKUS || '').split(',').map(s => s.trim()).filter(Boolean);
const testCountries = (process.env.PROD_TEST_COUNTRIES || '').split(',').map(s => s.trim()).filter(Boolean);
const testWarehouses = (process.env.PROD_TEST_WAREHOUSES || '').split(',').map(s => s.trim()).filter(Boolean);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function api(path, method, cookie, body, timeoutMs) {
  const to = timeoutMs || 180000;
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, {
      method, headers: cookie ? { 'Content-Type': 'application/json', Cookie: 'session_token=' + cookie } : { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(to)
    });
    const buf = await r.arrayBuffer(); const txt = Buffer.from(buf).toString('utf8');
    let json = null; try { json = JSON.parse(txt); } catch (e) {}
    const isHtml = /^\s*<!DOCTYPE html|<html/i.test(txt);
    const nonJsonMsg = /服务器返回非 JSON/.test(txt);
    const setCookie = r.headers.get('set-cookie') || '';
    return { status: r.status, ms: Date.now() - t0, json, ok: r.ok, isJson: !!json && !isHtml, isHtml, nonJsonMsg, setCookie, bytes: buf.byteLength };
  } catch (e) { return { status: 0, ms: Date.now() - t0, err: String(e), ok: false, isJson: false, isHtml: false, nonJsonMsg: false, bytes: 0 }; }
}

// 模块端点（B）
const moduleEndpoints = [
  ['me', '/api/me', 'GET'],
  ['feishu_status', '/api/auth/feishu/status', 'GET'],
  ['inventory_list', '/api/inventory?page=1&pageSize=5', 'GET'],
  ['inventory_filter', '/api/inventory/filter-options', 'GET'],
  ['sku_list', '/api/skus?page=1&pageSize=5', 'GET'],
  ['daily_sales', '/api/replenishment-suggestions/daily-sales?tab=all', 'GET'],
  ['forecast_list', '/api/replenishment-suggestions?page=1&pageSize=5', 'GET'],
  ['po_list', '/api/purchase-orders?page=1&pageSize=5', 'GET'],
  ['pi_list', '/api/proforma-invoices?page=1&pageSize=5', 'GET'],
  ['ci_list', '/api/commercial-invoices?page=1&pageSize=5', 'GET'],
  ['pl_list', '/api/packing-lists?page=1&pageSize=5', 'GET'],
  ['inbound_list', '/api/inbound-records?page=1&pageSize=5', 'GET'],
  ['payable_list', '/api/payable-items?page=1&pageSize=5', 'GET'],
  ['payment_list', '/api/payment-requests?page=1&pageSize=5', 'GET'],
  ['payment_pending', '/api/payment-requests/pending', 'GET'],
  ['po_pending_approval', '/api/purchase-orders/pending-approval', 'GET'],
  ['approval_flows', '/api/approval-flows', 'GET'],
];
const concurProbes = [
  ['inventory', '/api/inventory?page=1&pageSize=5', 'GET'],
  ['PI', '/api/proforma-invoices?page=1&pageSize=5', 'GET'],
  ['CI', '/api/commercial-invoices?page=1&pageSize=5', 'GET'],
  ['Payment', '/api/payment-requests?page=1&pageSize=5', 'GET'],
  ['daily_sales', '/api/replenishment-suggestions/daily-sales?tab=all', 'GET'],
];

function checkNullProps(json) {
  // 粗略检测常见“Cannot set properties of null”类前端错误（后端不应返回此文本；这里仅作 JSON 健全性）
  return false;
}

(async () => {
  const fail = { html500: [], status0: [], nonJson: [], auth: [], exhaust: [] };
  try {
    // === A: 登录 / 会话 / 错误密码拒登 / 登出重登 / 刷新保持 ===
    console.log('=== PHASE A: auth/session ===');
    const bad = await api('/api/auth/local/login', 'POST', null, { username: USER, password: 'WRONG_PASS_' + Date.now() });
    console.log(`  [login wrong-pass] status=${bad.status} (expect !=200)`);
    if (bad.status === 200) fail.auth.push('wrong_pass_accepted');
    const r = await api('/api/auth/local/login', 'POST', null, { username: USER, password: PASS });
    const sc = r.setCookie || '';
    const m = (typeof sc === 'string' ? sc : '').match(/session_token=([^;]+)/);
    if (!m) { console.log('  [login] FAIL no cookie status=' + r.status); fail.auth.push('login_no_cookie'); }
    else {
      const cookie = m[1];
      console.log('  [login] OK cookie len=' + cookie.length);
      const me1 = await api('/api/me', 'GET', cookie);
      console.log(`  [me] status=${me1.status} isJson=${me1.isJson} user=${me1.json && me1.json.username}`);
      if (me1.status !== 200 || !me1.isJson) fail.auth.push('me_fail');
      // 刷新保持：再请求一次 /api/me
      const me2 = await api('/api/me', 'GET', cookie);
      if (me2.status !== 200) fail.auth.push('refresh_session_lost');
      // 登出后失效（若端点存在）
      const lo = await api('/api/logout', 'POST', cookie);
      console.log(`  [logout] status=${lo.status}`);
      const me3 = await api('/api/me', 'GET', cookie);
      console.log(`  [me after logout] status=${me3.status} (expect 401 if logout effective)`);
      // 重新登录
      const r2 = await api('/api/auth/local/login', 'POST', null, { username: USER, password: PASS });
      const m2 = (r2.setCookie || '').match(/session_token=([^;]+)/);
      if (!m2) { console.log('  [relogin] FAIL no cookie status=' + r2.status); fail.auth.push('relogin_fail'); }
      else { var cookie2 = m2[1]; console.log('  [relogin] OK'); }
    }

    // === B: 各模块列表端点 ===
    console.log('\n=== PHASE B: module endpoints ===');
    const cookie = typeof cookie2 !== 'undefined' ? cookie2 : null;
    if (!cookie) { console.log('  [skip B] no session'); fail.auth.push('no_session_for_B'); }
    else {
      for (const [name, path, method] of moduleEndpoints) {
        const rr = await api(path, method, cookie);
        console.log(`  [${name}] status=${rr.status} ms=${rr.ms} isJson=${rr.isJson} bytes=${rr.bytes}${rr.isHtml ? ' HTML!' : ''}${rr.nonJsonMsg ? ' NONJSON!' : ''}`);
        if (rr.status === 0) fail.status0.push(name);
        if (rr.status >= 500 && (rr.isHtml || !rr.isJson)) fail.html500.push(name);
        if (rr.nonJsonMsg) fail.nonJson.push(name);
      }
    }

    // === C: generate + 并发稳定性 ===
    console.log('\n=== PHASE C: generate + concurrency ===');
    const genStatuses = [], genMs = [];
    for (let it = 1; it <= 2; it++) {
      const genP = api('/api/replenishment-suggestions/generate', 'POST', cookie, {});
      await sleep(400);
      const probes = await Promise.all(concurProbes.map(([n, p, mth]) => api(p, mth, cookie)));
      const gen = await genP;
      genStatuses.push(gen.status); genMs.push(gen.ms);
      console.log(`--- ITER ${it} ---`);
      console.log(`  [generate] status=${gen.status} ms=${gen.ms} isJson=${gen.isJson} success=${gen.json && gen.json.success}`);
      concurProbes.forEach(([n], i) => console.log(`    [concur ${n}] status=${probes[i].status} ms=${probes[i].ms} isJson=${probes[i].isJson}`));
      if (gen.status !== 200 || !gen.isJson) fail.exhaust.push('generate_iter' + it);
      probes.forEach((p, i) => {
        if (p.status === 0) fail.status0.push('concur_' + concurProbes[i][0] + '_' + it);
        if (p.status >= 500 && (p.isHtml || !p.isJson)) fail.html500.push('concur_' + concurProbes[i][0] + '_' + it);
        if (p.nonJsonMsg) fail.nonJson.push('concur_' + concurProbes[i][0] + '_' + it);
      });
      await sleep(1000);
    }

    // === D: 数据对齐 ===
    console.log('\n=== PHASE D: data alignment ===');
    const filter = await api('/api/inventory/filter-options', 'GET', cookie);
    let countries = [], warehouses = [];
    if (filter.isJson && filter.json) {
      countries = (filter.json.countries || []).map(c => c.name || c.code || c);
      warehouses = (filter.json.warehouses || []).map(w => w.name || w.code || w);
    }
    console.log('  countries=' + JSON.stringify(countries));
    console.log('  warehouses=' + JSON.stringify(warehouses));
    for (const c of testCountries) if (countries.includes(c)) fail.exhaust.push('test_country_still_present:' + c);
    for (const w of testWarehouses) if (warehouses.includes(w)) fail.exhaust.push('test_warehouse_still_present:' + w);
    if (testCountries.length) console.log(`  test countries absent: ${!testCountries.some(c => countries.includes(c))}`);
    if (testWarehouses.length) console.log(`  test warehouses absent: ${!testWarehouses.some(w => warehouses.includes(w))}`);
    // P1 测试 SKU 不再出现
    if (testSkus.length) {
      const sku = await api('/api/skus?page=1&pageSize=200', 'GET', cookie);
      let codes = [];
      if (sku.isJson && Array.isArray(sku.json)) codes = sku.json.map(s => s.sku_code || s.code || s);
      else if (sku.isJson && Array.isArray(sku.json.rows)) codes = sku.json.rows.map(s => s.sku_code || s.code || s);
      const hit = testSkus.filter(s => codes.includes(s));
      console.log('  P1 test SKUs present: ' + JSON.stringify(hit));
      if (hit.length) fail.exhaust.push('test_sku_present:' + hit.join(','));
    }

    // === 汇总 ===
    console.log('\n=== SUMMARY ===');
    console.log('generate statuses: ' + genStatuses.join(',') + ' ms: ' + genMs.join(','));
    console.log('HTML 500: ' + (fail.html500.length ? fail.html500.join('; ') : 'NONE'));
    console.log('status=0: ' + (fail.status0.length ? fail.status0.join('; ') : 'NONE'));
    console.log('非JSON响应: ' + (fail.nonJson.length ? fail.nonJson.join('; ') : 'NONE'));
    console.log('auth/session: ' + (fail.auth.length ? 'FAIL ' + fail.auth.join('; ') : 'OK'));
    console.log('数据对齐信号: ' + (fail.exhaust.length ? fail.exhaust.join('; ') : 'NONE'));
    const pass = fail.html500.length === 0 && fail.status0.length === 0 && fail.nonJson.length === 0 && fail.auth.length === 0 && fail.exhaust.length === 0 && genStatuses.every(s => s === 200);
    console.log('ONLINE_REGRESSION: ' + (pass ? 'PASS ✓' : 'FAIL ✗'));
    console.log('FAILS=' + JSON.stringify(fail));
    process.exitCode = pass ? 0 : 2;
  } catch (e) {
    console.error('[FATAL]', e);
    process.exitCode = 1;
  }
})();
