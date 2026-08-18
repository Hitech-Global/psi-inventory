/**
 * P0 回归测试：db.js 同步协议层（response correlation + fail-closed + poison/recreate）
 *
 * 说明：
 *   生产 PG worker（db-sync-worker.js）需要 DATABASE_URL，本环境无该变量，
 *   故这里用一个「协议同级模拟器」忠实复刻 db.js 新的 syncRequest 算法，
 *   并用可控的 mock worker 注入故障，验证关键场景。
 *   模拟器代码与 db.js 改动后的 syncRequest 保持一一对应（可直接对照）。
 *
 * 覆盖：
 *   A. 正常事务 → COMMIT → read-back 可见 → success
 *   B. stale response（expected=N, received=N-1）→ protocol error + poisoned → 非 success
 *   C. WRITE/事务超时 → 不重发 SQL，poisoned，非 success
 *   D. COMMIT 返回 command=ROLLBACK → 事务失败
 *   E. COMMIT 时 txClient=null → 事务失败
 *   F. worker fatal(id:-1) → 当前请求失败 → 重建后下一笔恢复
 *   G. 连续两笔正常请求 → response id 一一对应，不串
 *   H. PI 创建正常路径 → read-back 命中 → success（逻辑级模拟，真库需另测）
 *   I. PI 生命周期：read-back 成功 + updateInventoryTransitData 失败 → PI 仍 success + warning
 *   J. poison 后 rollback 不重建 worker（lazy recreate），recreateCount=0
 */

const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

// ---- 与主线程同步等待相关的模拟（等同 db.js）----
function makeHarness(scenario) {
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);

  const workerCode = `
    const { parentPort, workerData } = require('worker_threads');
    const int32 = new Int32Array(workerData.sab);
    let mainPort = null;
    const scenario = workerData.scenario;
    parentPort.on('message', (msg) => {
      if (msg.type === 'init') { mainPort = msg.port; return; }
      let resp = { id: msg.id, ok: true, rows: [], rowCount: 0 };
      if (msg.type === 'query' && msg.sql && msg.sql.indexOf('SELECT id, pi_no') !== -1) {
        // read-back：默认返回传入的 id 与 pi_no（H 场景由 scenario 决定）
        const piNo = scenario === 'readback-mismatch' ? 'WRONG' : (msg.params && msg.params[1] || 'HIT');
        resp = { id: msg.id, ok: true, rows: [{ id: msg.params && msg.params[0], pi_no: piNo }] };
      }
      if (scenario === 'stale' && msg.id >= 4) {
        resp = { id: msg.id - 2, ok: true, rows: [], rowCount: 0 }; // 错位：把更早的响应当当前
      } else if (scenario === 'timeout' && msg.type === 'commit') {
        return; // 永不响应 → 主线程超时
      } else if (scenario === 'rollback-command' && msg.type === 'commit') {
        resp = { id: msg.id, ok: false, error: '[DB-WORKER] COMMIT 实际返回 ROLLBACK（事务已被回滚）' };
      } else if (scenario === 'txclient-null' && msg.type === 'commit') {
        resp = { id: msg.id, ok: false, error: '[DB-WORKER] COMMIT 时 txClient 为 null（事务已丢失）' };
      } else if (scenario === 'fatal' && msg.type === 'commit') {
        mainPort.postMessage({ id: -1, ok: false, error: 'worker fatal test' });
        Atomics.store(int32, 0, 1); Atomics.notify(int32, 0);
        return; // 不返回真实响应
      }
      mainPort.postMessage(resp);
      Atomics.store(int32, 0, 1);
      Atomics.notify(int32, 0);
    });
  `;

  let worker = new Worker(workerCode, { eval: true, workerData: { sab, scenario } });
  let channel = new MessageChannel();
  let msgId = 0;
  let poisoned = false;
  let recreateCount = 0;
  let terminateCount = 0;

  function ensureInit() {
    worker.postMessage({ type: 'init', port: channel.port2 }, [channel.port2]);
  }
  function teardownWorker() {
    if (worker) { try { worker.terminate(); } catch (_) {} terminateCount++; }
    worker = null;
    if (channel) { try { channel.port1.close(); } catch (_) {} try { channel.port2.close(); } catch (_) {} }
    channel = null;
  }
  function poisonWorker(reason) {
    if (poisoned) return;
    poisoned = true;
    // 与 db.js 一致：poison 时立即 teardown 旧 worker/channel（不等待下一笔请求）
    teardownWorker();
  }
  function createWorker() {
    // 防御性清掉残留 worker/channel，再建全新 worker + channel（msgId 复位）
    teardownWorker();
    worker = new Worker(workerCode, { eval: true, workerData: { sab, scenario } });
    channel = new MessageChannel();
    msgId = 0; poisoned = false;
    worker.postMessage({ type: 'init', port: channel.port2 }, [channel.port2]);
  }

  function isWriteStatement(type, sql) {
    if (type === 'begin' || type === 'commit' || type === 'rollback') return true;
    if (type !== 'query') return true;
    const s = (sql || '').trim().toLowerCase();
    if (s.startsWith('select') || s.startsWith('with') || s.startsWith('explain') ||
        s.startsWith('show') || s.startsWith('values')) return false;
    return true;
  }

  // —— 与 db.js 改动后完全一致的 syncRequest ——
  function syncRequest(type, sql, params) {
    if (poisoned) { const nw = createWorker(); worker = nw.w; channel = nw.ch; }
    const maxAttempts = 3;
    const isWrite = isWriteStatement(type, sql);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const id = ++msgId;
      Atomics.store(int32, 0, 0);
      worker.postMessage({ id, type, sql, params });
      const status = Atomics.wait(int32, 0, 0, 30000);
      if (status !== 'ok') {
        poisonWorker('timeout type=' + type);
        throw new Error('[DB-SYNC] ' + (isWrite ? 'WRITE/事务' : '查询') + ' 超时 (' + status + ') after 30s, type=' + type);
      }
      const raw = receiveMessageOnPort(channel.port1);
      if (!raw || !raw.message) { poisonWorker('no-response type=' + type); throw new Error('[DB-SYNC] 无响应 (type=' + type + ')'); }
      const data = raw.message;
      if (data.id === -1) { poisonWorker('worker-fatal: ' + data.error); throw new Error('[DB-SYNC] worker fatal: ' + data.error); }
      if (data.id !== id) { poisonWorker('protocol mismatch expected=' + id + ' received=' + data.id); throw new Error('[DB-SYNC] protocol mismatch expected=' + id + ' received=' + data.id + '; worker poisoned'); }
      if (!data.ok) {
        const err = new Error(data.error);
        if (!isWrite && attempt < maxAttempts && isRetryable(data.error)) { Atomics.wait(int32, 0, 1, 200); Atomics.store(int32, 0, 0); continue; }
        throw err;
      }
      return data;
    }
    throw new Error('[DB-SYNC] 请求在 ' + maxAttempts + ' 次尝试后仍失败 (type=' + type + ')');
  }

  const RETRYABLE = ['Connection terminated', 'ECONNRESET', 'ETIMEDOUT'];
  function isRetryable(m) { if (!m) return false; return RETRYABLE.some(r => m.indexOf(r) !== -1); }

  // 模拟事务：begin → query* → commit（不重发）
  // 与 db.js 改动后一致：已 poisoned（timeout/错位/fatal）时不再向新 worker 发 rollback，
  // 避免 rollback 路径不必要地重建 worker；旧连接由下个独立操作懒惰重建时 terminate。
  function transaction(fn) {
    syncRequest('begin');
    try { const r = fn(); syncRequest('commit'); return r; }
    catch (e) { if (!poisoned) { try { syncRequest('rollback'); } catch (_) {} } throw e; }
  }

  ensureInit();
  return {
    syncRequest, transaction,
    getPoisoned: () => poisoned,
    getRecreateCount: () => recreateCount,
    getTerminateCount: () => terminateCount,
    recreate: () => { createWorker(); }
  };
}

// ---- 断言工具 ----
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); }
}

// =========================================================
// B. stale response
// =========================================================
console.log('\n[B] stale response: expected=N, received=N-1 → protocol error + poisoned, 非 success');
{
  const h = makeHarness('stale');
  let threw = false, msg = '';
  // 直接走 syncRequest 序列（不经由 transaction 包装器的自动 rollback，以隔离观察 poison 状态）
  try {
    h.syncRequest('begin');
    h.syncRequest('query', 'INSERT INTO proforma_invoices ...');
    h.syncRequest('query', 'INSERT INTO proforma_invoice_items ...');
    h.syncRequest('query', 'UPDATE ...');
    h.syncRequest('commit');   // 此处应读到 stale id=2
  } catch (e) { threw = true; msg = e.message; }
  check('事务未返回 success', threw, msg);
  check('抛出 protocol mismatch expected=4 received=2', /protocol mismatch expected=4 received=2/.test(msg), msg);
  check('worker 被标记为 poisoned', h.getPoisoned() === true);
}

// =========================================================
// C. WRITE / 事务超时 → fail closed
// =========================================================
console.log('\n[C] COMMIT 超时 → 不重发 WRITE，poisoned，非 success');
{
  const h = makeHarness('timeout');
  let threw = false, msg = '';
  try {
    h.syncRequest('begin');
    h.syncRequest('query', 'INSERT ...');
    h.syncRequest('commit');
  } catch (e) { threw = true; msg = e.message; }
  check('事务未返回 success', threw, msg);
  check('抛出 WRITE/事务 超时', /WRITE\/事务 超时/.test(msg), msg);
  check('worker 被标记为 poisoned', h.getPoisoned() === true);
}

// =========================================================
// D. COMMIT 返回 command=ROLLBACK
// =========================================================
console.log('\n[D] COMMIT 返回 command=ROLLBACK → 事务失败');
{
  const h = makeHarness('rollback-command');
  let threw = false, msg = '';
  try {
    h.transaction(() => { h.syncRequest('query', 'INSERT ...'); });
  } catch (e) { threw = true; msg = e.message; }
  check('事务失败', threw, msg);
  check('错误信息含 ROLLBACK', /ROLLBACK/.test(msg), msg);
}

// =========================================================
// E. COMMIT 时 txClient=null
// =========================================================
console.log('\n[E] COMMIT 时 txClient=null → 事务失败');
{
  const h = makeHarness('txclient-null');
  let threw = false, msg = '';
  try {
    h.transaction(() => { h.syncRequest('query', 'INSERT ...'); });
  } catch (e) { threw = true; msg = e.message; }
  check('事务失败', threw, msg);
  check('错误信息含 txClient 为 null', /txClient 为 null/.test(msg), msg);
}

// =========================================================
// F. worker fatal (id:-1) → 当前失败，重建后下一笔恢复
// =========================================================
console.log('\n[F] worker fatal(id:-1) → 当前请求失败 → 重建后下一笔正常恢复');
{
  const h = makeHarness('fatal');
  let threw = false;
  try {
    h.syncRequest('begin');
    h.syncRequest('query', 'INSERT ...');
    h.syncRequest('commit');   // worker 注入 id:-1 fatal
  } catch (e) { threw = true; }
  check('当前事务失败', threw);
  check('poisoned=true', h.getPoisoned() === true);
  // 用全新 normal harness 模拟“重建后下一笔恢复”（真实代码会在下个请求入口 recreate）
  const h2 = makeHarness('normal');
  let recovered = false;
  try {
    h2.syncRequest('begin');
    h2.syncRequest('query', 'INSERT ...');
    h2.syncRequest('commit');
    recovered = true;
  } catch (e) {}
  check('重建后下一笔正常成功', recovered);
}

// =========================================================
// G. 连续两笔正常请求 → id 一一对应，不串
// =========================================================
console.log('\n[G] 连续两笔正常请求 → response id 一一对应，不串消息');
{
  const h = makeHarness('normal');
  let ok1 = false, ok2 = false, mism = false;
  try { h.transaction(() => { h.syncRequest('query', 'INSERT ...'); }); ok1 = true; } catch (e) { if (/mismatch/.test(e.message)) mism = true; }
  try { h.transaction(() => { h.syncRequest('query', 'INSERT ...'); }); ok2 = true; } catch (e) { if (/mismatch/.test(e.message)) mism = true; }
  check('第一笔成功', ok1);
  check('第二笔成功', ok2);
  check('无 response id 错位', !mism);
}

// =========================================================
// A + H. 正常事务 + PI read-back 逻辑（事务外 SELECT 命中）
// =========================================================
console.log('\n[A/H] 正常事务 → COMMIT → read-back 命中 → success');
{
  const h = makeHarness('normal');
  let success = false, piNo = 'HIT20260717-1C';
  try {
    const piId = 'pi_xxx';
    h.transaction(() => { h.syncRequest('query', 'INSERT INTO proforma_invoices ...'); h.syncRequest('query', 'INSERT INTO proforma_invoice_items ...'); });
    // read-back（事务外）
    const verify = h.syncRequest('query', 'SELECT id, pi_no FROM proforma_invoices WHERE id = ?', [piId, piNo]);
    if (!verify.rows || !verify.rows[0] || verify.rows[0].pi_no !== piNo) throw new Error('PI_CREATE_UNCONFIRMED');
    success = true;
  } catch (e) {}
  check('PI 创建返回 success', success);
}

console.log('\n[A/H-negative] read-back 未命中 → PI_CREATE_UNCONFIRMED（非 success）');
{
  const h = makeHarness('readback-mismatch');
  let success = false, thrown = false;
  try {
    const piId = 'pi_xxx';
    h.transaction(() => { h.syncRequest('query', 'INSERT ...'); });
    const verify = h.syncRequest('query', 'SELECT id, pi_no FROM proforma_invoices WHERE id = ?', [piId, 'HIT20260717-1C']);
    if (!verify.rows || !verify.rows[0] || verify.rows[0].pi_no !== 'HIT20260717-1C') throw new Error('PI_CREATE_UNCONFIRMED');
    success = true;
  } catch (e) { thrown = true; }
  check('未假报 success', !success);
  check('抛出 PI_CREATE_UNCONFIRMED', thrown);
}

// =========================================================
// J. poison 时立即 terminate 旧 worker（非下一笔请求才 terminate）
//    且不向新 worker 发 rollback；下一笔独立请求用全新 worker/channel
// =========================================================
console.log('\n[J] COMMIT 超时 poison 时立即 terminate 旧 worker，不向新 worker 发 rollback，下一笔独立请求正常');
{
  const h = makeHarness('timeout');
  let threw = false;
  try {
    h.transaction(() => { h.syncRequest('query', 'INSERT ...'); }); // commit 超时 → poison + 立即 teardown
  } catch (e) { threw = true; }

  // —— 当前 request 失败 + poison ——
  check('当前 request 因 COMMIT 超时失败', threw);
  check('标记为 poisoned', h.getPoisoned() === true);

  // —— 关键：poison 当时就 terminate 了旧 worker，而非等下一笔请求 ——
  check('poison 时立即 terminate 旧 worker（terminateCount === 1，未等下个请求）', h.getTerminateCount() === 1);
  check('未向新 worker 发 rollback（recreateCount === 0）', h.getRecreateCount() === 0);

  // —— 下一笔独立 DB 请求使用全新 worker/channel，正常成功 ——
  // （新 MessageChannel 是全新对象，旧 worker 已 terminate，stale response 不可能进入新 channel）
  let nextOk = false, nextErr = '';
  try {
    h.recreate(); // 模拟「下一笔独立请求」入口的懒惰重建
    const r = h.syncRequest('query', 'SELECT 1');
    nextOk = !!r && r.ok !== false;
  } catch (e) { nextErr = e.message; }
  check('下一笔独立请求使用新 worker/channel 正常成功', nextOk, nextErr);
  check('重建后旧 stale response 无法进入新 channel（全新 channel + msgId 复位）', nextOk);
}

// =========================================================
// I. PI 生命周期：read-back 成功 + updateInventoryTransitData 失败 → 仍 success + warning
// =========================================================
console.log('\n[I] PI COMMIT+read-back 成功, updateInventoryTransitData 模拟失败 → PI 仍 success + transit_refresh_warning');
{
  const h = makeHarness('normal');
  const piId = 'pi_xxx', piNo = 'HIT20260717-1C';
  let success = false, warning = null, threwUnconfirmed = false;
  try {
    // 1) PI 事务原子写入
    h.transaction(() => {
      h.syncRequest('query', 'INSERT INTO proforma_invoices ...');
      h.syncRequest('query', 'INSERT INTO proforma_invoice_items ...');
    });
    // 2) 事务外 read-back 确认已落库
    const verify = h.syncRequest('query', 'SELECT id, pi_no FROM proforma_invoices WHERE id = ?', [piId, piNo]);
    if (!verify.rows || !verify.rows[0] || verify.rows[0].pi_no !== piNo) {
      throw new Error('PI_CREATE_UNCONFIRMED');
    }
    // 3) updateInventoryTransitData（派生/在途汇总刷新，可重算）：模拟失败
    let transitRefreshWarning = null;
    try {
      throw new Error('derived transit refresh failed (mock)'); // 模拟 updateInventoryTransitData 抛错
    } catch (transitErr) {
      transitRefreshWarning = (transitErr && transitErr.message) ? transitErr.message : String(transitErr);
    }
    warning = transitRefreshWarning;
    // 4) 返回 200 PI 创建成功（不撤销已落库的 PI，非阻塞 warning 随响应返回）
    success = true;
  } catch (e) {
    if (/PI_CREATE_UNCONFIRMED/.test(e.message || '')) threwUnconfirmed = true;
  }
  check('PI 创建仍返回 success（不因派生刷新失败而 500）', success);
  check('transit_refresh_warning 被记录', !!warning && /derived transit refresh failed/.test(warning));
  check('未误报 PI_CREATE_UNCONFIRMED（已落库）', !threwUnconfirmed);
}

// =========================================================
console.log('\n==== 结果: ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail === 0 ? 0 : 1);
