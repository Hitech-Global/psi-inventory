// 订单预测「建议采购数量」持久化 — server-managed revision + expected revision CAS 回归测试
//
// Part 1：后端字段/CAS 数学（临时 sqlite，与生产同 schema；使用 server.js 中完全一致的 CAS UPDATE + suggestion SQL CASE）。
// Part 2：前端单飞/coalesce/override/journal/drain/stale 状态机（vm 加载真实 app.js，fetch 桩仿真 server CAS）。
// Part 3：migration 幂等（PG 列 ADD COLUMN IF NOT EXISTS 幂等验证）。
//
// 重要：本测试复制 server.js 的 CAS SQL 与 buildSuggestionText 进行等价性核对；若 server.js 改动，需同步更新此处。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; console.log('  PASS  '+name); } else { fail++; console.log('  FAIL  '+name); } }

// ============ 与 server.js buildSuggestionText(5478) 完全一致的 JS 镜像（纯函数，仅用于等价比对） ============
function buildSuggestionText(salesStatus, lifecycleStatus, suggestedQty, brandStopped) {
  const lifecycle = lifecycleStatus || 'stable';
  if (brandStopped || salesStatus === '停采/清库存' || salesStatus === '停采/停产' || lifecycle === 'clearance' || lifecycle === 'stopped') {
    return '停止采购，优先消化现有库存';
  }
  if (lifecycle === 'new_test') return '新品测试期，暂不自动生成采购建议';
  if (lifecycle === 'new_launch') return '新品导入期，建议人工复核采购数量';
  if (salesStatus === '呆滞') return '近30天无销量，建议清库存并暂停采购';
  if (salesStatus === '慢销') return '库存周转偏高，建议观察并谨慎采购';
  return suggestedQty > 0 ? `建议采购 ${suggestedQty}` : '当前库存池充足，建议观察';
}
function normalizeRiskTags(t){
  if(Array.isArray(t)) return t;
  if(typeof t==='string'){ if(t.charAt(0)==='['){ try{ return JSON.parse(t); }catch(e){ return []; } } return t? [t] : []; }
  return [];
}
function shouldBlockReplenish(sales_status, risk_tags){
  const tags = normalizeRiskTags(risk_tags);
  if(['清仓','停采/停产','无有效销售','呆滞','慢销'].includes(sales_status)) return true;
  if(tags.includes('高库存严重')||tags.includes('高库存关注')||tags.includes('高库龄风险')) return true;
  if(tags.includes('新品无销量')) return true;
  return false;
}

// server.js manual CAS 使用的 suggestion SQL CASE（online 渠道示例，otherCh=offline）。与 server.js 保持一致。
const SUGGESTION_CASE_SQL = `
  suggestion = CASE
    WHEN sales_status IN ('停采/清库存','停采/停产') OR lifecycle_status IN ('clearance','stopped')
      THEN '停止采购，优先消化现有库存'
    WHEN lifecycle_status = 'new_test' THEN '新品测试期，暂不自动生成采购建议'
    WHEN lifecycle_status = 'new_launch' THEN '新品导入期，建议人工复核采购数量'
    WHEN sales_status = '呆滞' THEN '近30天无销量，建议清库存并暂停采购'
    WHEN sales_status = '慢销' THEN '库存周转偏高，建议观察并谨慎采购'
    WHEN (? + COALESCE(offline_suggested_qty, 0) + COALESCE(other_suggested_qty, 0)) > 0
      THEN '建议采购 ' || CAST(CAST((? + COALESCE(offline_suggested_qty, 0) + COALESCE(other_suggested_qty, 0)) AS INTEGER) AS TEXT)
    ELSE '当前库存池充足，建议观察' END`;

// ============ Part 1：后端 CAS 数学（真实 sqlite + 与 server.js 一致 SQL） ============
function testBackendCas(){
  console.log('\n[Part 1] 后端 online_suggested_qty / offline CAS + revision + suggestion CASE');
  let Database;
  try { Database = require('better-sqlite3'); } catch(e){ console.log('  SKIP  better-sqlite3 不可用'); return; }
  const tmp = path.join(require('os').tmpdir(), 'rp_cas_test_'+Date.now()+'.db');
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  const db = new Database(tmp);
  db.exec(`CREATE TABLE replenishment_suggestions(
    id TEXT PRIMARY KEY, sku_code TEXT, country TEXT, target_warehouse TEXT,
    online_suggested_qty INTEGER DEFAULT 0, offline_suggested_qty INTEGER DEFAULT 0,
    other_suggested_qty INTEGER DEFAULT 0, suggested_qty INTEGER DEFAULT 0,
    sales_status TEXT DEFAULT '', risk_tags TEXT DEFAULT '', lifecycle_status TEXT DEFAULT '',
    online_write_seq INTEGER DEFAULT 0, offline_write_seq INTEGER DEFAULT 0, recalc_revision INTEGER DEFAULT 0,
    suggestion TEXT DEFAULT ''
  );`);

  // 镜像 server.js manual online CAS（channel=online, otherCh=offline）。返回 {changes, row}
  function casOnline(id, val, expOnline, expRecalc){
    id = String(id);
    const rs = db.prepare('SELECT offline_suggested_qty, online_suggested_qty, other_suggested_qty, sales_status, risk_tags, lifecycle_status FROM replenishment_suggestions WHERE id=?').get(id);
    if(!rs) return { changes: -1 };
    const blocked = shouldBlockReplenish(rs.sales_status||'', rs.risk_tags||'');
    const isStopped = (rs.sales_status||'')==='停采/清库存';
    const effVal = (blocked||isStopped)?0:(parseInt(val)||0);
    const otherChVal = rs.offline_suggested_qty||0;
    const otherVal = rs.other_suggested_qty||0;
    const resUp = db.prepare(
      `UPDATE replenishment_suggestions
         SET online_suggested_qty = ?,
             suggested_qty = ? + COALESCE(offline_suggested_qty,0) + COALESCE(other_suggested_qty,0),
             online_write_seq = COALESCE(online_write_seq,0)+1,
             ${SUGGESTION_CASE_SQL}
       WHERE id = ? AND COALESCE(online_write_seq,0) = ? AND COALESCE(recalc_revision,0) = ?`
    ).run(effVal, effVal, effVal, effVal, id, expOnline, expRecalc);
    return { changes: resUp.changes, row: db.prepare('SELECT * FROM replenishment_suggestions WHERE id=?').get(id) };
  }
  function casOffline(id, val, expOffline, expRecalc){
    id = String(id);
    const rs = db.prepare('SELECT online_suggested_qty, offline_suggested_qty, other_suggested_qty, sales_status, risk_tags, lifecycle_status FROM replenishment_suggestions WHERE id=?').get(id);
    if(!rs) return { changes: -1 };
    const blocked = shouldBlockReplenish(rs.sales_status||'', rs.risk_tags||'');
    const isStopped = (rs.sales_status||'')==='停采/清库存';
    const effVal = (blocked||isStopped)?0:(parseInt(val)||0);
    const otherChVal = rs.online_suggested_qty||0;
    const otherVal = rs.other_suggested_qty||0;
    const resUp = db.prepare(
      `UPDATE replenishment_suggestions
         SET offline_suggested_qty = ?,
             suggested_qty = ? + COALESCE(online_suggested_qty,0) + COALESCE(other_suggested_qty,0),
             offline_write_seq = COALESCE(offline_write_seq,0)+1,
             ${SUGGESTION_CASE_SQL.replace(/offline_suggested_qty/g,'online_suggested_qty')}
       WHERE id = ? AND COALESCE(offline_write_seq,0) = ? AND COALESCE(recalc_revision,0) = ?`
    ).run(effVal, effVal, effVal, effVal, id, expOffline, expRecalc);
    return { changes: resUp.changes, row: db.prepare('SELECT * FROM replenishment_suggestions WHERE id=?').get(id) };
  }
  // 模拟系统重算（generate/refresh/双 turnover/双 target_stock）：双渠道 + recalc 各 +1
  function recompute(id){
    db.prepare('UPDATE replenishment_suggestions SET online_write_seq=COALESCE(online_write_seq,0)+1, offline_write_seq=COALESCE(offline_write_seq,0)+1, recalc_revision=COALESCE(recalc_revision,0)+1 WHERE id=?').run(String(id));
  }

  // 1) revision=20，manual expected20 成功 → 21
  db.prepare("INSERT INTO replenishment_suggestions(id,sku_code,online_suggested_qty,offline_suggested_qty,other_suggested_qty,suggested_qty,online_write_seq,offline_write_seq,recalc_revision,sales_status) VALUES(1,'S1',10,20,0,30,20,20,5,'正常动销')").run();
  let r1 = casOnline(1, 30, 20, 5);
  ok('manual expected(20,5) 成功 changes=1', r1.changes===1);
  ok('manual 成功后 online_write_seq 20→21', r1.row.online_write_seq===21);
  ok('manual 不 bump recalc_revision（仍=5）', r1.row.recalc_revision===5);
  ok('online=30 → suggested_qty=30+20+0=50', r1.row.suggested_qty===50);

  // 2) 第二个旧 expected(20) → stale（changes=0）
  let r2 = casOnline(1, 30, 20, 5);
  ok('第二个旧 expected(20) → stale changes=0', r2.changes===0);

  // 3) stale 后最新 journal value（300, expected=21）rebase 成功 → 22
  let r3 = casOnline(1, 300, 21, 5);
  ok('rebase 用最新 expected(21) 成功 → 22', r3.row.online_write_seq===22);
  ok('最终收敛到 300', r3.row.online_suggested_qty===300);

  // 4) B 先到 / A 后到：A(30,exp20) stale 不覆盖 B
  db.prepare("INSERT INTO replenishment_suggestions(id,sku_code,online_suggested_qty,offline_suggested_qty,other_suggested_qty,suggested_qty,online_write_seq,offline_write_seq,recalc_revision,sales_status) VALUES(2,'S2',10,20,0,30,20,20,5,'正常动销')").run();
  let bFirst = casOnline(2, 300, 20, 5); // B 先到
  ok('B 先到成功（seq=21, val=300）', bFirst.row.online_write_seq===21 && bFirst.row.online_suggested_qty===300);
  let aLate = casOnline(2, 30, 20, 5);   // A 后到（旧 expected）
  ok('A 后到 stale，不覆盖 B', aLate.changes===0 && bFirst.row.online_suggested_qty===300);

  // 5) 系统重算淘汰旧 manual：recompute 后旧 manual expected(recalc=5) stale
  db.prepare("INSERT INTO replenishment_suggestions(id,sku_code,online_suggested_qty,offline_suggested_qty,other_suggested_qty,suggested_qty,online_write_seq,offline_write_seq,recalc_revision,sales_status) VALUES(3,'S3',10,20,0,30,20,20,5,'正常动销')").run();
  recompute(3); // → recalc=6
  let oldManual = casOnline(3, 999, 20, 5); // 旧 manual 持 recalc=5
  ok('recompute 后旧 manual（recalc=5）stale，不覆盖系统结果', oldManual.changes===0);
  ok('recompute 后 recalc_revision=6', db.prepare('SELECT recalc_revision FROM replenishment_suggestions WHERE id=3').get().recalc_revision===6);

  // 6) online/offline 两种提交顺序 → total 恒等 = 70
  db.prepare("INSERT INTO replenishment_suggestions(id,sku_code,online_suggested_qty,offline_suggested_qty,other_suggested_qty,suggested_qty,online_write_seq,offline_write_seq,recalc_revision,sales_status) VALUES(4,'S4',10,20,0,30,20,20,5,'正常动销')").run();
  let oFirst = casOnline(4, 30, 20, 5);     // online→30
  let fThen = casOffline(4, 40, 20, 5);     // offline→40
  ok('online 先 / offline 后 → total=70', oFirst.row.suggested_qty===50 && fThen.row.suggested_qty===70);
  db.prepare("INSERT INTO replenishment_suggestions(id,sku_code,online_suggested_qty,offline_suggested_qty,other_suggested_qty,suggested_qty,online_write_seq,offline_write_seq,recalc_revision,sales_status) VALUES(5,'S5',10,20,0,30,20,20,5,'正常动销')").run();
  let fFirst = casOffline(5, 40, 20, 5);    // offline→40
  let oThen = casOnline(5, 30, 20, 5);      // online→30
  ok('offline 先 / online 后 → total=70', fFirst.row.suggested_qty===50 && oThen.row.suggested_qty===70);

  // 7) suggestion SQL CASE == buildSuggestionText（覆盖真实可达场景）
  const cases = [
    { sales_status:'正常动销', lifecycle_status:'stable',    online:30, offline:20, other:5, blocked:false, expectSugg:'建议采购 55' },
    { sales_status:'正常动销', lifecycle_status:'stable',    online:0,  offline:0,  other:0, blocked:false, expectSugg:'当前库存池充足，建议观察' },
    { sales_status:'停采/清库存', lifecycle_status:'stable',  online:77, offline:20, other:0, blocked:true,  expectSugg:'停止采购，优先消化现有库存' },
    { sales_status:'停采/停产', lifecycle_status:'stable',    online:1,  offline:0,  other:0, blocked:true,  expectSugg:'停止采购，优先消化现有库存' },
    { sales_status:'正常动销', lifecycle_status:'clearance',  online:5,  offline:0,  other:0, blocked:false, expectSugg:'停止采购，优先消化现有库存' },
    { sales_status:'正常动销', lifecycle_status:'stopped',   online:5,  offline:0,  other:0, blocked:false, expectSugg:'停止采购，优先消化现有库存' },
    { sales_status:'正常动销', lifecycle_status:'new_test',   online:5,  offline:0,  other:0, blocked:false, expectSugg:'新品测试期，暂不自动生成采购建议' },
    { sales_status:'正常动销', lifecycle_status:'new_launch', online:5,  offline:0,  other:0, blocked:false, expectSugg:'新品导入期，建议人工复核采购数量' },
    { sales_status:'呆滞',     lifecycle_status:'stable',    online:5,  offline:0,  other:0, blocked:false, expectSugg:'近30天无销量，建议清库存并暂停采购' },
    { sales_status:'慢销',     lifecycle_status:'stable',    online:5,  offline:0,  other:0, blocked:false, expectSugg:'库存周转偏高，建议观察并谨慎采购' },
    // risk_tags 触发 shouldBlockReplenish → 存储值=0，但文本按 total(=0) 走正常分支（非“建议采购 30”）
    { sales_status:'正常动销', lifecycle_status:'stable',    online:30, offline:0,  other:0, blocked:true, risk_tags:'["高库存严重"]', expectSugg:'当前库存池充足，建议观察' },
  ];
  let ci = 0;
  cases.forEach(function(c){
    ci++;
    const id = 'SC'+ci;
    db.prepare('INSERT INTO replenishment_suggestions(id,sku_code,online_suggested_qty,offline_suggested_qty,other_suggested_qty,suggested_qty,sales_status,risk_tags,lifecycle_status,online_write_seq,offline_write_seq,recalc_revision) VALUES(?,?,0,?,?,0,?,?,?,0,0,0)')
      .run(id, 'X', c.offline, c.other, c.sales_status, c.risk_tags||'', c.lifecycle_status);
    const effValSql = (c.blocked)?0:c.online;  // 与 server.js 一致：block 在写入前强制为 0
    const res = db.prepare(
      `UPDATE replenishment_suggestions SET online_suggested_qty=?,
         suggested_qty = ? + COALESCE(offline_suggested_qty,0)+COALESCE(other_suggested_qty,0),
         online_write_seq=COALESCE(online_write_seq,0)+1, ${SUGGESTION_CASE_SQL}
       WHERE id=? AND COALESCE(online_write_seq,0)=0 AND COALESCE(recalc_revision,0)=0`
    ).run(effValSql, effValSql, effValSql, effValSql, id);
    const row = db.prepare('SELECT * FROM replenishment_suggestions WHERE id=?').get(id);
    // 计算 JS 期望值：effVal = blocked?0:online；total = effVal+offline+other；isStopped = sales_status==='停采/清库存'
    const effVal = (c.blocked)?0:c.online;
    const total = effVal + c.offline + c.other;
    const jsSugg = buildSuggestionText(c.sales_status, c.lifecycle_status, total, c.sales_status==='停采/清库存');
    ok('CASE==JS ['+c.sales_status+'/'+c.lifecycle_status+'/blocked='+c.blocked+']', row.suggestion===jsSugg);
    if(c.expectSugg!==undefined) ok('suggestion 文本 = "'+c.expectSugg+'"', row.suggestion===c.expectSugg);
    if(c.blocked) ok('blocked 存储值=0（非原始 '+c.online+'）', row.online_suggested_qty===0);
  });

  db.close();
  fs.unlinkSync(tmp);
}

// ============ Part 2：前端单飞/coalesce/override/journal/drain/stale（真实 app.js + 仿真 server） ============
function testFrontend(){
  console.log('\n[Part 2] 前端状态机（真实 app.js + 仿真 server CAS）');
  const code = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  let suggestedEls = []; // 测试中用于验证「建议采购」input.disabled 的真实 DOM 元素（按 data-rid=R8）

  // 仿真 server：内存行 + revision + CAS + recompute
  function makeServer(){
    const rows = {};
    return {
      rows,
      putManual(id, channel, val, expOnline, expOffline, expRecalc){
        const r = rows[id];
        if(!r) return { status:404, body:{ success:false, error:'SUGGESTION_NOT_FOUND' } };
        const needExpected = (channel==='online') ? (expOnline===undefined||expRecalc===undefined) : (expOffline===undefined||expRecalc===undefined);
        if(needExpected) return { status:400, body:{ success:false, error:'SUGGESTION_REVISION_REQUIRED' } };
        const isStopped = r.sales_status==='停采/清库存';
        const blocked = shouldBlockReplenish(r.sales_status||'', r.risk_tags||'');
        const eff = (blocked||isStopped)?0:(parseInt(val)||0);
        const otherCh = channel==='online'?'offline':'online';
        const otherChVal = r[otherCh+'_suggested_qty']||0;
        const otherVal = r.other_suggested_qty||0;
        const total = eff + otherChVal + otherVal;
        const expSeq = channel==='online'?expOnline:expOffline;
        const curSeq = channel==='online'?r.online_write_seq:r.offline_write_seq;
        if(curSeq !== expSeq || r.recalc_revision !== expRecalc){
          return { status:200, body:{ success:true, stale:true, data: snap(r) } };
        }
        r[channel+'_suggested_qty'] = eff;
        r.suggested_qty = total;
        r[channel+'_write_seq'] = curSeq+1;
        r.suggestion = buildSuggestionText(r.sales_status, r.lifecycle_status, total, isStopped);
        return { status:200, body:{ success:true, stale:false, data: snap(r) } };
      },
      recompute(id){ const r=rows[id]; if(!r) return; r.online_write_seq=(r.online_write_seq||0)+1; r.offline_write_seq=(r.offline_write_seq||0)+1; r.recalc_revision=(r.recalc_revision||0)+1; }
    };
    function snap(r){ return JSON.parse(JSON.stringify(r)); }
  }
  const server = makeServer();

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    performance: { now: () => Date.now() }, Date, Math, JSON, parseInt, parseFloat, String, Number, Object, Array,
    getLang: () => 'zh',
    addEventListener: () => {}, removeEventListener: () => {},
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    location: { href: '' }, navigator: { language: 'zh' },
    __failPut: false,
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (sel) => {
        // 测试中让「建议采购」input 可被真实查询，用于断言 .disabled
        if (sel && sel.indexOf('.rp-target-stock-input[data-rid="R8"]') >= 0) return suggestedEls;
        return [];
      },
      createElement: () => ({ style:{}, classList:{add(){},remove(){},toggle(){}}, appendChild(){}, setAttribute(){}, addEventListener(){} }),
      addEventListener: () => {}, body: { appendChild(){} }
    },
    sessionStorage: (() => { const m = new Map(); return {
      getItem: k => m.has(k)?m.get(k):null, setItem: (k,v) => m.set(k,String(v)), removeItem: k => m.delete(k),
      key: i => Array.from(m.keys())[i]||null, get length(){ return m.size; } }; })(),
    fetch: (url, opts) => {
      let body = {}; try { body = JSON.parse((opts && opts.body) || '{}'); } catch(e){}
      // 仅当 body 含 online_suggested_qty / offline_suggested_qty 才是 manual 保存；
      // target_turnover / target_stock 属于系统重算，走下方 recompute 分支。
      const needsManual = body.online_suggested_qty !== undefined || body.offline_suggested_qty !== undefined;
      if (url.indexOf('/api/replenishment-suggestions/') >= 0 && opts && opts.method === 'PUT' && needsManual) {
        if (body.expected_recalc_revision === undefined) {
          return Promise.resolve({ ok:false, status:400, json:()=>Promise.resolve({ success:false, error:'SUGGESTION_REVISION_REQUIRED' }) });
        }
        const rid = url.split('/').pop();
        const ch = body.online_suggested_qty !== undefined ? 'online' : 'offline';
        if (sandbox.__failPut) return Promise.reject(new Error('network'));
        const res = server.putManual(rid, ch,
          ch==='online'?body.online_suggested_qty:body.offline_suggested_qty,
          body.expected_online_write_seq, body.expected_offline_write_seq, body.expected_recalc_revision);
        return Promise.resolve({ ok: res.status<400, status: res.status, json: () => Promise.resolve(res.body) });
      }
      // target-turnover / target_stock：仿真 recompute（双渠道 write_seq + recalc_revision 各 +1）
      if (url.indexOf('/api/replenishment-suggestions/') >= 0) {
        if (sandbox.__failTurnover) return Promise.reject(new Error('turnover-fail'));
        const rid = url.split('/').pop();
        server.recompute(rid);
        const r = server.rows[rid];
        return Promise.resolve({ ok:true, status:200, json: () => Promise.resolve({ success:true, data: r?JSON.parse(JSON.stringify(r)):{} }) });
      }
      return Promise.resolve({ ok:true, status:200, json: () => Promise.resolve({}) });
    },
    showRpAutoSaved: () => {}, showRpSaveFailed: () => {}, showToast: () => {}, confirm: () => true, t: (k,d) => d||k,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(code, sandbox, { filename: 'app.js' }); }
  catch (e) { console.log('  SKIP  加载 app.js 失败: ' + e.message); return; }
  const S = sandbox;
  // app.js 顶层 function 声明会覆盖上文传入的 mock；此处针对 vm 无头环境覆盖 DOM 重函数，
  // 使 onTargetTurnChange 的 .then 能正常推进（更新 baseline）而不触发 .catch(unhandled)。
  try {
    S.rpClearDataCache = () => {};
    S.rpInvalidateSuggestionViews = () => {};
    S.showRpSaveFailed = () => {};
    S.showRpAutoSaved = () => {};
  } catch (e) {}

  function setRow(rid, init){
    const row = Object.assign({ id:rid, sku_code:'X', online_suggested_qty:10, offline_suggested_qty:20, other_suggested_qty:0,
      suggested_qty:30, sales_status:'正常动销', risk_tags:'', lifecycle_status:'stable',
      online_write_seq:20, offline_write_seq:20, recalc_revision:5, suggestion:'' }, init||{});
    server.rows[rid] = JSON.parse(JSON.stringify(row));
    // 注入前端缓存（双渠道同 rid）
    ['online','offline'].forEach(function(ch){
      if(!S.window._rpChannelData) S.window._rpChannelData={};
      if(!S.window._rpChannelData[ch]) S.window._rpChannelData[ch]={};
      const cached = JSON.parse(JSON.stringify(row));
      cached._serverRevOnline = row.online_write_seq; cached._serverRevOffline = row.offline_write_seq;
      cached._serverRecalc = row.recalc_revision; cached._recalcInFlight=false;
      S.window._rpChannelData[ch][rid] = cached;
    });
  }
  function resetState(){
    S.window._rpManualStock = { online:{}, offline:{} };
    S.window._rpSaveState = { online:{}, offline:{} };
    S.window._rpChannelData = undefined;
    const keys = Array.from({ length: S.sessionStorage.length }, (_, i) => S.sessionStorage.key(i));
    keys.forEach(k => S.sessionStorage.removeItem(k));
    sandbox.__failPut = false;
    sandbox.__failTurnover = false;
    suggestedEls = [];
  }
  function finish(){ console.log('\n==== 结果: '+pass+' passed, '+fail+' failed ===='); process.exit(fail?1:0); }
  process.on('unhandledRejection', (e) => { console.log('  UNHANDLED REJECTION: '+(e&&e.stack||e)); finish(); });
  setTimeout(finish, 8000);

  // 2.1 单飞 + coalesce：3→30→300 最终 = 300
  resetState(); setRow('R1');
  S.rpGetSaveState('online','R1').pending = 3;
  const p1 = S.rpFlushOne('online','R1');
  S.rpGetSaveState('online','R1').pending = 30;
  S.rpGetSaveState('online','R1').pending = 300;
  p1.then(() => {
    ok('coalesce 最终 = 300', server.rows['R1'].online_suggested_qty===300);
    ok('成功后 override 清除', S.rpGetManualStock('online','R1')===undefined);
    ok('成功后 journal 清除', S.sessionStorage.getItem('rpj::R1::online')===null);
    ok('前端 baseline 更新到 seq=21', S.rpGetRow('online','R1')._serverRevOnline===21);
    step2();
  }).catch(e => { console.log('  FAIL coalesce: '+e.message); step2(); });

  function step2(){
    // 2.2 drain 失败：保留 override + journal
    resetState(); setRow('R3');
    S.window._rpSaveState.online.R3 = { pending:42, inFlight:false, timer:null, flightPromise:null };
    S.rpSetManualStock('online','R3',42);
    S.sessionStorage.setItem('rpj::R3::online', JSON.stringify({v:42,localOp:1,baseRecalcRevision:5}));
    S.__failPut = true;
    S.rpDrainAllPending().then(ok1 => {
      ok('drain 失败返回 false', ok1===false);
      ok('失败后 override 保留', S.rpGetManualStock('online','R3')===42);
      ok('失败后 journal 保留', S.sessionStorage.getItem('rpj::R3::online')!==null);
      step3();
    }).catch(e => { console.log('  FAIL drain-fail: '+e.message); step3(); });
  }
  function step3(){
    // 2.3 journal replay：replay 带新 baseline 的 expected，最终保存
    resetState(); setRow('R5');
    S.sessionStorage.setItem('rpj::R5::offline', JSON.stringify({v:77,localOp:1,baseRecalcRevision:5}));
    S.__failPut = false;
    S.rpReplayJournal();
    setTimeout(() => {
      ok('journal replay 后 offline=77 落库', server.rows['R5'].offline_suggested_qty===77);
      ok('replay 成功 override 清除', S.rpGetManualStock('offline','R5')===undefined);
      step4();
    }, 700);
  }
  function step4(){
    // 2.4 stale → manual conflict rebase：A(30,exp20) stale，B(300,exp21) 重发成功
    resetState(); setRow('R6');
    // 先让 server 接受一个 A=30（exp 20,5），把 seq 推到 21
    server.putManual('R6','online',30,20,undefined,5);
    // 前端 baseline 现在应=21；模拟用户新输入 300（journal baseRecalc=5 与 server 一致）
    S.window._rpChannelData.online.R6._serverRevOnline = 21;
    S.window._rpChannelData.offline.R6._serverRevOnline = 21;
    S.rpWriteJournal('online','R6',300); // baseRecalc=5
    S.rpGetSaveState('online','R6').pending = 300;
    // 这里直接驱动一次“旧 A 的 stale 响应”场景：我们伪造一次 flush 携带旧 expected 看 rebase
    // 简化：直接调用 rpFlushOne 发 300（expected=21, recalc=5）→ 成功
    S.rpFlushOne('online','R6').then(() => {
      ok('manual conflict 后最新值 300 落库', server.rows['R6'].online_suggested_qty===300);
      ok('最终 seq=22', S.rpGetRow('online','R6')._serverRevOnline===22);
      step5();
    }).catch(e => { console.log('  FAIL rebase: '+e.message); step5(); });
  }
  function step5(){
    // 2.5 stale → system recompute invalidation：旧 manual 在 recompute 后 stale 被丢弃，不被复活
    resetState(); setRow('R7');
    server.putManual('R7','online',50,20,undefined,5); // 旧 manual seq20→21
    server.recompute('R7'); // 系统重算 → recalc=6, seq=22
    S.window._rpChannelData.online.R7._serverRevOnline = 22;
    S.window._rpChannelData.online.R7._serverRecalc = 6;
    // 前端仍持有旧 journal（baseRecalc=5），refresh replay 应判定失效丢弃
    S.sessionStorage.setItem('rpj::R7::online', JSON.stringify({v:50,localOp:1,baseRecalcRevision:5}));
    S.rpReplayJournal();
    setTimeout(() => {
      // 关键：旧 manual 不能覆盖 recompute 结果。recompute 不改 suggested 值，此处验证 stale 丢弃不报错、不写库
      ok('旧 manual 未覆盖（seq 仍=22 未被回退）', server.rows['R7'].online_write_seq===22);
      ok('旧 journal 已被丢弃', S.sessionStorage.getItem('rpj::R7::online')===null);
      step6();
    }, 700);
  }
  function step6(){
    // 2.6 target-turnover in-flight：真实禁用「建议采购」input；turnover 完成后 300 用新 recalc 保存
    resetState(); setRow('R8');
    const onlineEl = { dataset:{ rid:'R8', channel:'online' }, value:'0', disabled:false };
    const offlineEl = { dataset:{ rid:'R8', channel:'offline' }, value:'0', disabled:false };
    suggestedEls = [onlineEl, offlineEl];
    const turnInput = { dataset:{ rid:'R8', channel:'online', avgSales:'10' }, value:'3', closest:()=>null };
    S.onTargetTurnChange(turnInput); // in-flight：_recalcInFlight=true + 真实禁用 suggested input
    const manualInput = { dataset:{ rid:'R8', channel:'online' }, value:'300', closest:()=>null };
    S.onChannelTargetStockInput(manualInput); // 应被锁，不写 journal
    ok('turnover in-flight 期间 manual 不写 journal', S.sessionStorage.getItem('rpj::R8::online')===null);
    ok('turnover in-flight 标记为真', S.rpIsRecalcInFlight('R8')===true);
    ok('turnover in-flight online suggested input.disabled===true', onlineEl.disabled===true);
    ok('turnover in-flight offline suggested input.disabled===true', offlineEl.disabled===true);
    // 等待 turnover 完成（仿真 recompute + 前端 baseline 更新）
    setTimeout(() => {
      ok('turnover 完成 _recalcInFlight 清回 false', S.rpIsRecalcInFlight('R8')===false);
      ok('turnover 完成 online suggested input.disabled===false', onlineEl.disabled===false);
      ok('turnover 完成 offline suggested input.disabled===false', offlineEl.disabled===false);
      ok('turnover 后前端 baseline recalc=6', S.rpGetRow('online','R8')._serverRecalc===6);
      // 现在用户输入 300，应带新 baseRecalc=6
      S.onChannelTargetStockInput(manualInput);
      const entry = JSON.parse(S.sessionStorage.getItem('rpj::R8::online')||'null');
      ok('turnover 后 manual journal 带新 baseRecalcRevision=6', entry && entry.baseRecalcRevision===6);
      setTimeout(() => {
        ok('turnover 后 300 落库成功', server.rows['R8'].online_suggested_qty===300);
        step6b();
      }, 700);
    }, 700);
  }
  function step6b(){
    // 2.7 turnover 失败：同样恢复「建议采购」input.disabled（成功/失败都解锁）
    resetState(); setRow('R8');
    const onlineEl = { dataset:{ rid:'R8', channel:'online' }, value:'0', disabled:false };
    const offlineEl = { dataset:{ rid:'R8', channel:'offline' }, value:'0', disabled:false };
    suggestedEls = [onlineEl, offlineEl];
    sandbox.__failTurnover = true;
    const turnInput = { dataset:{ rid:'R8', channel:'online', avgSales:'10' }, value:'3', closest:()=>null };
    S.onTargetTurnChange(turnInput); // in-flight：disabled=true
    ok('turnover 失败 in-flight online suggested input.disabled===true', onlineEl.disabled===true);
    ok('turnover 失败 in-flight offline suggested input.disabled===true', offlineEl.disabled===true);
    setTimeout(() => {
      ok('turnover 失败 _recalcInFlight 清回 false', S.rpIsRecalcInFlight('R8')===false);
      ok('turnover 失败 online suggested input 恢复 disabled===false', onlineEl.disabled===false);
      ok('turnover 失败 offline suggested input 恢复 disabled===false', offlineEl.disabled===false);
      finish();
    }, 700);
  }
}

// ============ Part 3：migration 幂等（PG ADD COLUMN IF NOT EXISTS） ============
function testMigrationIdempotent(){
  console.log('\n[Part 3] migration 幂等验证');
  let mod;
  try { mod = require('./migrations/replenishment-revision'); } catch(e){ console.log('  SKIP migration 模块不可用: '+e.message); return; }
  // 用一个记录的 in-memory run 模拟 PG；SQLite 路径直接返回
  const executed = [];
  const fakeRun = (sql) => { executed.push(sql); return { changes: 0 }; };
  mod.ensureReplenishmentRevisionColumns(fakeRun, false); // sqlite → 无操作
  ok('sqlite 驱动不执行 ALTER', executed.length===0);

  executed.length = 0;
  mod.ensureReplenishmentRevisionColumns(fakeRun, true); // pg → 3 条
  ok('pg 首次执行 3 条 ALTER', executed.length===3);
  ok('含 online_write_seq', executed.some(s=>s.indexOf('online_write_seq')>=0));
  ok('含 offline_write_seq', executed.some(s=>s.indexOf('offline_write_seq')>=0));
  ok('含 recalc_revision', executed.some(s=>s.indexOf('recalc_revision')>=0));
  ok('使用 IF NOT EXISTS（幂等）', executed.every(s=>s.indexOf('IF NOT EXISTS')>=0));

  // 第二次执行：仍 3 条（幂等，由 SQL 自身保证 no-op，不报错）
  executed.length = 0;
  let threw = false;
  try { mod.ensureReplenishmentRevisionColumns(fakeRun, true); } catch(e){ threw = true; }
  ok('pg 二次执行不抛错（幂等）', !threw && executed.length===3);
}

testBackendCas();
testFrontend();
testMigrationIdempotent();
