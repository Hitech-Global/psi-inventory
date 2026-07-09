// 进销存系统 - 后端接口冒烟测试
// 模拟浏览器：登录 -> 逐个访问各页面主接口 -> 统计状态码
const BASE = 'http://localhost:3001';
const PERMS = 'dashboard_view,sku_view,inventory_view,outbound_view,replenishment_view,stagnant_view,check_view,po_view,pi_view,ci_view,logistics_view,inbound_view,cost_view,payment_view,forwarder_view,user_manage,role_manage,system_config,sku_create,sku_edit,sku_delete,sku_import,sku_export,inventory_import,inventory_export,outbound_create,outbound_import,replenishment_edit,po_create,po_edit,po_approve,po_export,pi_create,pi_edit,ci_create,ci_edit,logistics_create,logistics_edit,inbound_create,inbound_edit,inbound_confirm,payment_create,payment_approve,payment_import,payment_export,check_create,check_approve,check_import,check_export,stagnant_export,forwarder_export';

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  const d = await r.json();
  return d.id;
}

async function get(userId, path) {
  const r = await fetch(BASE + path, {
    headers: { 'X-User-Id': userId, 'X-User-Permissions': PERMS }
  });
  let body = null;
  try { body = await r.json(); } catch (e) { body = (await r.text()).slice(0, 120); }
  return { path, status: r.status, ok: r.ok, isJson: typeof body === 'object', sample: body };
}

(async () => {
  console.log('== 登录 ==');
  const userId = await login();
  console.log('登录用户:', userId);

  const endpoints = [
    '/api/dashboard',
    '/api/skus?pageSize=5',
    '/api/inventory?pageSize=5',
    '/api/suppliers',
    '/api/inventory/filter-options',
    '/api/replenishment-suggestions?pageSize=5',
    '/api/purchase-orders?pageSize=5',
    '/api/proforma-invoices?pageSize=5',
    '/api/commercial-invoices?pageSize=5',
    '/api/logistics-batches?pageSize=5',
    '/api/inbound-records?pageSize=5',
    '/api/payment-requests?pageSize=5',
    '/api/stagnant-analysis',
    '/api/freight-forwarder-analysis',
    '/api/inventory-checks?pageSize=5',
    '/api/warehouses',
    '/api/currencies',
    '/api/countries',
    '/api/brands/all',
    '/api/users',
    '/api/roles',
    '/api/system-config',
  ];

  let fail = 0;
  for (const p of endpoints) {
    const res = await get(userId, p);
    const tag = res.ok ? 'OK ' : 'FAIL';
    if (!res.ok) fail++;
    let info = '';
    if (res.ok && res.isJson) {
      const b = res.sample;
      if (Array.isArray(b)) info = `数组 长度=${b.length}`;
      else if (b && typeof b === 'object') info = `对象 键=${Object.keys(b).length}`;
    } else {
      info = JSON.stringify(res.sample).slice(0, 80);
    }
    console.log(`[${tag}] ${res.status}  ${p}  ${info}`);
  }
  console.log(`\n== 结果: ${endpoints.length - fail}/${endpoints.length} 通过, ${fail} 失败 ==`);
  process.exit(fail ? 1 : 0);
})();
