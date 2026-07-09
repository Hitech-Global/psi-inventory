const http = require('http');
function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname:'localhost', port:3001, path, method, headers:{ 'Content-Type':'application/json', ...(headers||{}) } };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve({ status:res.statusCode, data:JSON.parse(buf) }); } catch(e) { resolve({ status:res.statusCode, data:buf }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const login = await req('POST', '/api/auth/login', { username:'admin', password:'admin' });
  const perms = login.data.permissions.join(',');
  const gen = await req('POST', '/api/replenishment-suggestions/generate', {}, { 'X-User-Id':'user_admin', 'X-User-Permissions': perms });
  console.log('Generate:', JSON.stringify(gen.data));

  const list = await req('GET', '/api/replenishment-suggestions', null, { 'X-User-Id':'user_admin', 'X-User-Permissions': perms });
  const lcSkus = list.data.filter(r => r.sku_code && r.sku_code.startsWith('LC-'));

  const expectations = {
    'LC-NEW-TEST':   { desc: '新品导入', expectSug:0,   suggContains:'新品导入' },
    'LC-NEW-LAUNCH': { desc: '新品启动', expectSug:100, suggContains:'新品启动' },
    'LC-GROWTH':     { desc: '成长期',   expectSug:160, suggContains:'建议采购' },
    'LC-STABLE':     { desc: '成熟期',   expectSug:200, suggContains:'建议采购' },
    'LC-SLOW':       { desc: '衰退期',   expectSug:100, suggContains:'建议采购' },
    'LC-STAGNANT':   { desc: '滞销',     expectSug:0,   suggContains:'滞销' },
    'LC-CLEARANCE':  { desc: '清仓期',   expectSug:0,   suggContains:'清仓' },
    'LC-STOPPED':    { desc: '停采',     expectSug:0,   suggContains:'停采' }
  };

  let pass = 0, fail = 0;
  lcSkus.sort((a, b) => a.sku_code.localeCompare(b.sku_code)).forEach(r => {
    const e = expectations[r.sku_code];
    const actual = r.suggested_qty || 0;
    const qtyOk = actual === e.expectSug;
    const suggOk = r.suggestion && r.suggestion.includes(e.suggContains);
    const ok = qtyOk && suggOk;
    if (ok) pass++; else fail++;
    console.log('  [' + (ok ? '✓' : '✗') + '] ' + r.sku_code + ' (' + e.desc + '): qty=' + actual + (qtyOk?'':' (期望 '+e.expectSug+')') + ', sugg="' + r.suggestion + '"' + (suggOk?'':' (期望含 '+e.suggContains+')') + ', risk=' + r.risk_level);
  });
  console.log('\n=== ' + pass + ' pass, ' + fail + ' fail ===');
}

main().catch(e => { console.error('ERR:', e); process.exit(1); });
