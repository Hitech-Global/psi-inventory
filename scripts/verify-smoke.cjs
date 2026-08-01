// 本地全系统 API 冒烟测试（隔离 schema，结束 DROP，不碰 public）。
// 覆盖 8 项：
//  1. breakglass 基础登录 + 会话(/api/me) + 飞书 status
//  2. 库存列表 + filter-options
//  3. 订单预测 daily-sales
//  4. generate 正常返回 JSON
//  5. generate 运行期间并发访问 库存/PI/CI/Payment
//  6. PO/PI/CI/PL/Inbound 核心列表接口
//  7. 应付费用/付款申请/审批相关接口
//  8. 不得出现 HTML 500 / status=0 / 进程冻结 / 数据库连接耗尽
//
// 安全约束（发布门禁 项5）：本脚本不得包含任何 DATABASE_URL / 密码 / token / 真实生产数据。
//  - 数据库连接串仅从环境变量 DATABASE_URL 读取；缺失即报错退出，绝不内置连接串。
//  - 默认且只能作用于隔离 schema（p0_iso）：所有写操作仅在该 schema 内，结束后 DROP，public 仅被读取用于复制。
//  - break-glass 临时密码仅用于本地启动隔离 server，非生产凭据，可用 SMOKE_BREAKGLASS_PASSWORD 覆盖。
//  - 结果落盘于 os.tmpdir()/smoke_run.log。
const { Client } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

const LOG = process.env.SMOKE_LOG || (os.tmpdir() + '/smoke_run.log');
try { fs.writeFileSync(LOG, ''); } catch (e) {}
const _origLog = console.log;
console.log = (...a) => { _origLog(...a); try { fs.appendFileSync(LOG, a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'); } catch (e2) {} };

const BASE_DB_URL = process.env.DATABASE_URL;
if (!BASE_DB_URL) {
  console.error('[FATAL] 必须设置环境变量 DATABASE_URL（指向隔离副本或生产只读副本）；本脚本不内置任何连接串/密码。');
  process.exit(1);
}
const SCHEMA = process.env.SMOKE_SCHEMA || 'p0_iso';
const PORT = parseInt(process.env.SMOKE_PORT || '3997', 10);
const BG_PASS = process.env.SMOKE_BREAKGLASS_PASSWORD || 'SmokeLocalTest123';
// server 连接到隔离 schema：在 DATABASE_URL 基础上追加 search_path（兼容已有 query 参数）。
const SERVER_DB_URL = BASE_DB_URL + (BASE_DB_URL.includes('?') ? '&' : '?') + 'options=-c%20search_path%3D' + SCHEMA;
const NODE = process.execPath; // 复用当前 Node 运行时，避免硬编码绝对路径
const BASE = 'http://localhost:' + PORT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let srv = null;
function killSrv() { try { if (srv) srv.kill('SIGKILL'); } catch (e) {} }
process.on('exit', killSrv);
process.once('SIGTERM', () => { killSrv(); process.exit(0); });
process.once('SIGINT', () => { killSrv(); process.exit(0); });

async function setup() {
  const c = new Client({ connectionString: BASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await c.query(`CREATE SCHEMA ${SCHEMA}`);
  const t = await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  for (const r of t.rows) {
    await c.query(`CREATE TABLE ${SCHEMA}.${r.tablename} (LIKE public.${r.tablename} INCLUDING ALL)`);
    await c.query(`INSERT INTO ${SCHEMA}.${r.tablename} SELECT * FROM public.${r.tablename}`);
  }
  await c.end();
  console.log('[setup] copied ' + t.rows.length + ' tables into ' + SCHEMA);
}
async function teardown() {
  const c = new Client({ connectionString: BASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  console.log('[teardown] dropped ' + SCHEMA + ' (public untouched)');
  await c.end();
}
async function waitServer() {
  for (let i = 0; i < 90; i++) { try { const r = await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(2000) }); if (r.status) return; } catch (e) {} await sleep(1000); }
  throw new Error('server not ready');
}
async function login() {
  const r = await fetch(BASE + '/api/auth/local/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: BG_PASS }) });
  const sc = r.headers.get('set-cookie') || '';
  const m = sc.match(/session_token=([^;]+)/);
  if (!m) throw new Error('no session cookie (login status=' + r.status + ')');
  return m[1];
}
async function api(path, method, cookie, body, timeoutMs) {
  const to = timeoutMs || 180000;
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, { method, headers: cookie ? { 'Content-Type': 'application/json', Cookie: 'session_token=' + cookie } : { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(to) });
    const buf = await r.arrayBuffer();
    const txt = Buffer.from(buf).toString('utf8');
    let json = null; try { json = JSON.parse(txt); } catch (e) {}
    const isHtml = /^\s*<!DOCTYPE html|<html/i.test(txt);
    return { status: r.status, ms: Date.now() - t0, json, ok: r.ok, isJson: !!json && !isHtml, isHtml, bytes: buf.byteLength };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, err: String(e), ok: false, isJson: false, isHtml: false, bytes: 0 };
  }
}

// 模块列表型端点（项 2/3/6/7）
const moduleEndpoints = [
  ['me', '/api/me', 'GET'],
  ['feishu_status', '/api/auth/feishu/status', 'GET'],
  ['inventory_list', '/api/inventory?page=1&pageSize=5', 'GET'],
  ['inventory_filter', '/api/inventory/filter-options', 'GET'],
  ['daily_sales', '/api/replenishment-suggestions/daily-sales?tab=all', 'GET'],
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
// 并发探针（项 5）
const concurProbes = [
  ['inventory', '/api/inventory?page=1&pageSize=5', 'GET'],
  ['PI', '/api/proforma-invoices?page=1&pageSize=5', 'GET'],
  ['CI', '/api/commercial-invoices?page=1&pageSize=5', 'GET'],
  ['Payment', '/api/payment-requests?page=1&pageSize=5', 'GET'],
];

(async () => {
  try {
    // 预清理端口
    try {
      const { execSync } = require('child_process');
      const pids = execSync('lsof -tiTCP:' + PORT + ' -sTCP:LISTEN 2>/dev/null || true').toString().trim().split(/\s+/).filter(Boolean);
      for (const p of pids) { try { process.kill(Number(p), 'SIGKILL'); } catch (e) {} }
      if (pids.length) { console.log('[preclean] killed ' + pids.length + ' stale listener(s) on ' + PORT); await sleep(1000); }
    } catch (e) { console.log('[preclean] skip (' + e.message + ')'); }

    const fail = { html500: [], status0: [], spawn: [], exhaust: [] };
    await setup();
    srv = spawn(NODE, ['server.js'], {
      cwd: __dirname + '/..',
      env: Object.assign({}, process.env, {
        DB_DRIVER: 'pg', DATABASE_URL: SERVER_DB_URL, PORT: String(PORT),
        BREAKGLASS_ADMIN_PASSWORD: BG_PASS, FEISHU_NOTIFY_DRYRUN: '1', NODE_ENV: 'development',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let srvLog = '';
    srv.stdout.on('data', d => { srvLog += d; });
    srv.stderr.on('data', d => { srvLog += d; });
    srv.on('exit', (code) => console.log('[server exit] code=' + code));
    await waitServer();

    // === 项 1: breakglass 登录 + 会话 ===
    const cookie = await login();
    console.log('[auth] breakglass login OK, cookie len=' + cookie.length);
    const me = await api('/api/me', 'GET', cookie);
    console.log('[auth] /api/me status=' + me.status + ' isJson=' + me.isJson + ' user=' + (me.json && me.json.username));
    if (me.status !== 200 || !me.isJson) fail.spawn.push('auth_session');

    // === 项 2/3/6/7: 模块列表顺序冒烟 ===
    console.log('\n=== PHASE A: module list smoke ===');
    const aResults = [];
    for (const [name, path, method] of moduleEndpoints) {
      const r = await api(path, method, cookie);
      aResults.push({ name, path, ...r });
      console.log(`  [${name}] status=${r.status} ms=${r.ms} isJson=${r.isJson} bytes=${r.bytes}${r.isHtml ? ' HTML!' : ''}`);
      if (r.status === 0) fail.status0.push(name);
      if (r.status >= 500 && (r.isHtml || !r.isJson)) fail.html500.push(name + '(status=' + r.status + ')');
    }

    // === 项 4 + 5: generate JSON + 运行期间并发 ===
    console.log('\n=== PHASE B: generate + concurrency (3 iters) ===');
    const genStatuses = [], genMs = [];
    for (let it = 1; it <= 3; it++) {
      const genP = api('/api/replenishment-suggestions/generate', 'POST', cookie, {});
      await sleep(400);
      const probes = await Promise.all(concurProbes.map(([n, p, m]) => api(p, m, cookie)));
      const gen = await genP;
      genStatuses.push(gen.status); genMs.push(gen.ms);
      console.log(`--- ITER ${it} ---`);
      console.log(`  [generate] status=${gen.status} ms=${gen.ms} isJson=${gen.isJson} success=${(gen.json && gen.json.success)}`);
      concurProbes.forEach(([n], i) => console.log(`    [concur ${n}] status=${probes[i].status} ms=${probes[i].ms} isJson=${probes[i].isJson}`));
      if (gen.status !== 200 || !gen.isJson) fail.spawn.push('generate_iter' + it);
      probes.forEach((p, i) => {
        if (p.status === 0) fail.status0.push('concur_' + concurProbes[i][0] + '_iter' + it);
        if (p.status >= 500 && (p.isHtml || !p.isJson)) fail.html500.push('concur_' + concurProbes[i][0] + '_iter' + it);
      });
      await sleep(1000);
    }

    // === 项 8: 连接耗尽 / 冻结 压力突发（诊断用：捕获真实错误 + 记录延迟）===
    console.log('\n=== PHASE C1: realistic burst (12 parallel, 120s) ===');
    {
      const burst = [];
      for (let k = 0; k < 12; k++) { const e = moduleEndpoints[k % moduleEndpoints.length]; burst.push({ idx: k, ep: e[0], p: e[1], m: e[2], req: api(e[1], e[2], cookie, undefined, 120000) }); }
      const burstRes = await Promise.all(burst.map(b => b.req));
      let ok = 0, fl = 0;
      burst.forEach((b, i) => { const r = burstRes[i]; if (r.status === 0 || r.status >= 500) { fl++; if (r.status === 0) { fail.status0.push('c1#' + b.idx); console.log(`    [c1#${b.idx} ${b.ep}] TIMEOUT err=${r.err}`); } else fail.html500.push('c1#' + b.idx); } else ok++; });
      console.log(`  c1 burst: total=${burstRes.length} ok=${ok} fail=${fl}`);
    }
    console.log('\n=== PHASE C2: extreme stress (30 parallel, 150s) — classify timeouts ===');
    {
      const burst = [];
      for (let k = 0; k < 2; k++) for (const e of moduleEndpoints) burst.push({ idx: k * 100 + moduleEndpoints.indexOf(e), ep: e[0], p: e[1], m: e[2], req: api(e[1], e[2], cookie, undefined, 150000) });
      const burstRes = await Promise.all(burst.map(b => b.req));
      let ok = 0, fl = 0; const errTypes = {};
      burst.forEach((b, i) => { const r = burstRes[i]; if (r.status === 0 || r.status >= 500) { fl++; const key = r.status === 0 ? ('timeout/err:' + (r.err || '').slice(0, 60)) : ('http' + r.status); errTypes[key] = (errTypes[key] || 0) + 1; if (r.status === 0) fail.status0.push('c2#' + b.ep); else fail.html500.push('c2#' + b.ep); } else ok++; });
      console.log(`  c2 stress: total=${burstRes.length} ok=${ok} fail=${fl}`);
      console.log('  c2 error types: ' + JSON.stringify(errTypes));
      if (fl > 0) fail.exhaust.push('c2_stress_fail=' + fl + ' (see error types)');
    }

    // === 汇总 ===
    console.log('\n=== SUMMARY ===');
    console.log('generate statuses: ' + genStatuses.join(',') + '  ms: ' + genMs.join(','));
    console.log('module list endpoints: ' + aResults.length + ' probed, allJson=' + aResults.every(r => r.isJson && r.status === 200));
    console.log('HTML 500 occurrences: ' + (fail.html500.length ? fail.html500.join('; ') : 'NONE'));
    console.log('status=0 (network/timeout/freeze) occurrences: ' + (fail.status0.length ? fail.status0.join('; ') : 'NONE'));
    console.log('connection-exhaustion signals: ' + (fail.exhaust.length ? fail.exhaust.join('; ') : 'NONE'));
    console.log('auth/session: ' + (fail.spawn.includes('auth_session') ? 'FAIL' : 'OK'));
    const pass = fail.html500.length === 0 && fail.status0.length === 0 && fail.exhaust.length === 0 && !fail.spawn.includes('auth_session') && genStatuses.every(s => s === 200) && aResults.every(r => r.status === 200 && r.isJson);
    console.log('SMOKE: ' + (pass ? 'PASS ✓' : 'FAIL ✗'));
    console.log('SMOKE_FAILS=' + JSON.stringify(fail));
    process.exitCode = pass ? 0 : 2;
  } catch (e) {
    console.error('[FATAL]', e);
    process.exitCode = 1;
  } finally {
    // 发布门禁 项5：必须在 finally 中清理隔离 schema 与子进程，绝不残留。
    killSrv();
    try { await teardown(); } catch (e2) { console.error('[teardown error]', e2 && e2.message); }
  }
})();
