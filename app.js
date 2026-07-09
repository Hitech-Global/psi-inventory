// ==================== 进销存管理系统 - 前端逻辑 ====================
let currentUser=null;let currentPage='dashboard';

// --- 工具函数 ---
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtMoney(v,c){const n=Number(v||0);return(c?c+' ':'')+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function fmtDate(d){return d?String(d).split('T')[0]:''}
function todayStr(){return new Date().toISOString().split('T')[0]}
function b64EncodeUnicode(s){return btoa(unescape(encodeURIComponent(String(s||''))))}
function b64DecodeUnicode(s){return decodeURIComponent(escape(atob(String(s||''))))}
function showToast(msg,type='info'){const c=document.getElementById('toast-container');const t=document.createElement('div');t.className='toast toast-'+type;t.innerHTML='<div>'+esc(msg)+'</div>';c.appendChild(t);setTimeout(()=>{t.style.opacity='0';setTimeout(()=>t.remove(),300)},3500)}
function showFlash(msg,type='info'){const c=document.getElementById('flash-container');if(!c)return;c.innerHTML='<div class="flash flash-'+type+' show">'+esc(msg)+'</div>';setTimeout(()=>{if(c)c.innerHTML=''},4000)}
function openModal(title,body,footer=''){document.getElementById('modal-content').innerHTML='<div class="modal-header"><span class="modal-title">'+esc(title)+'</span><button class="modal-close" onclick="closeModal()">&times;</button></div><div class="modal-body">'+body+'</div>'+(footer?'<div class="modal-footer">'+footer+'</div>':'');document.getElementById('modal-overlay').classList.add('show')}
function closeModal(){document.getElementById('modal-overlay').classList.remove('show')}
function showModal(html){document.getElementById('modal-content').innerHTML=html;document.getElementById('modal-overlay').classList.add('show')}

// 批量操作结果报告弹窗
function showBatchResultModal(result, page){
  const total = (result.success||0)+(result.failed||0)+(result.skipped||0);
  const successRate = total > 0 ? Math.round((result.success/total)*100) : 0;
  let errors = [];
  try { errors = typeof result.errors === 'string' ? JSON.parse(result.errors) : (result.errors||[]); } catch(e) { errors = []; }

  const html = '<div class="modal-header"><h3>📊 批量操作结果报告</h3><button class="modal-close" onclick="closeModal()">×</button></div>'
    +'<div class="modal-body">'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:16px">'
    +'<div style="text-align:center;padding:12px;background:#e8f5e9;border-radius:8px"><div style="font-size:24px;font-weight:700;color:#2e7d32">'+(result.success||0)+'</div><div style="font-size:12px;color:#666">成功</div></div>'
    +'<div style="text-align:center;padding:12px;background:#ffebee;border-radius:8px"><div style="font-size:24px;font-weight:700;color:#c62828">'+(result.failed||0)+'</div><div style="font-size:12px;color:#666">失败</div></div>'
    +'<div style="text-align:center;padding:12px;background:#fff3cd;border-radius:8px"><div style="font-size:24px;font-weight:700;color:#f57f17">'+(result.skipped||0)+'</div><div style="font-size:12px;color:#666">跳过</div></div>'
    +'<div style="text-align:center;padding:12px;background:var(--bg-hover,#f5f5f5);border-radius:8px"><div style="font-size:24px;font-weight:700">'+successRate+'%</div><div style="font-size:12px;color:#666">成功率</div></div>'
    +'</div>'
    +(result.recalc_count !== undefined ? '<div style="margin-bottom:12px;padding:8px 12px;background:#e3f2fd;border-radius:6px;font-size:13px;color:#1565c0">🔄 已触发 '+result.recalc_count+' 条SKU库存重算（周转月/库存状态/预测）</div>' : '')
    +(errors.length > 0 ?
      '<div style="margin-bottom:12px"><div style="font-weight:600;margin-bottom:8px">失败明细：</div>'
      +'<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border,#e0e0e0);border-radius:6px">'
      +errors.map(e=>'<div style="padding:6px 12px;border-bottom:1px solid var(--border,#eee);font-size:13px"><span style="color:#c62828">✗</span> '+(e.sku_code||e.id||'')+' — '+esc(e.reason||'')+'</div>').join('')
      +'</div></div>'
      +'<button class="btn btn-sm btn-secondary" onclick="downloadBatchErrors()">📥 下载错误报告</button>'
    : '<div style="text-align:center;padding:20px;color:#2e7d32">✅ 全部执行成功</div>')
    +'</div>'
    +'<div class="modal-footer">'
    +'<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'
    +'<button class="btn btn-primary" onclick="closeModal();showPage(\'batch-tasks\')">查看任务中心</button>'
    +'</div>';

  // 存储错误数据供下载
  window._lastBatchErrors = errors;
  showModal(html);
}

function downloadBatchErrors(){
  const errors = window._lastBatchErrors || [];
  if(!errors.length) return;
  if(typeof XLSX === 'undefined'){ showFlash('XLSX库未加载','danger'); return; }
  const headers = ['ID','SKU','失败原因'];
  const rows = errors.map(e=>[e.id||'', e.sku_code||'', e.reason||'']);
  const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '错误报告');
  XLSX.writeFile(wb, '批量操作错误报告_'+new Date().toISOString().slice(0,10)+'.xlsx');
}
function hasPermission(p){if(!currentUser||!currentUser.permissions)return false;return currentUser.permissions.includes('*')||currentUser.permissions.includes(p)}
function hasAny(perms){if(!Array.isArray(perms))perms=[perms];return perms.some(p=>hasPermission(p))}

// 是否以 file:// 方式直接打开（脱离后端服务）
function isFileProtocol(){return location.protocol==='file:'||location.protocol==='null:'}

// 顶部致命提示条（如未启动后端、直开 HTML 文件）
function showFatalNotice(msg){
  let el=document.getElementById('fatal-notice');
  if(!el){
    el=document.createElement('div');
    el.id='fatal-notice';
    el.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#c53030;color:#fff;padding:16px 20px;font-size:14px;line-height:1.9;box-shadow:0 2px 10px rgba(0,0,0,.35)';
    document.body.appendChild(el);
  }
  el.innerHTML=msg;
}

// --- API ---
async function api(url,method='GET',body=null){
  const h={'Content-Type':'application/json'};
  if(currentUser){h['X-User-Id']=currentUser.id;h['X-User-Name']=encodeURIComponent(currentUser.name||'');h['X-User-Role']=currentUser.role_id||'';h['X-User-Permissions']=(currentUser.permissions||[]).join(',')}
  const o={method,headers:h};if(body)o.body=JSON.stringify(body);
  let r;
  try{
    r=await fetch(url,o);
  }catch(err){
    // fetch 网络层失败：服务未启动 / 地址不可达 / 以 file:// 打开 —— 正是 "Failed to fetch" 的根因
    const tip=isFileProtocol()
      ? '⚠️ 检测到您直接打开了 HTML 文件（file://）。本系统必须通过后端服务访问，请：<br>① 在终端运行 <b>node server.js</b><br>② 浏览器打开 <b>http://localhost:3001</b>（默认账号 admin / admin）<br>不要直接双击 index.html。'
      : '⚠️ 无法连接服务器（Failed to fetch）。请确认已运行 <b>node server.js</b>，并通过 <b>http://localhost:3001</b> 访问本系统（不要使用静态文件服务器或 file:// 打开）。';
    throw new Error(tip);
  }
  if(r.status===401){doLogout();throw new Error('未登录，请重新登录')}
  if(r.status===403){showToast('没有操作权限','danger');throw new Error('没有该操作的权限')}
  let d;
  try{ d=await r.json(); }catch(e){ throw new Error('服务器返回了非 JSON 响应，可能后端服务未正常启动。请检查终端中 <b>node server.js</b> 是否在运行。'); }
  if(d&&d.error)throw new Error(d.error);
  return d;
}

// --- 登录 ---
async function doLogin(){
  try{
    const u=document.getElementById('login-username');
    const p=document.getElementById('login-password');
    if(!u||!p){alert('登录控件未加载');return}
    if(!u.value||!p.value){showToast('请输入用户名和密码','warning');return}
    console.log('[login] 调用 /api/auth/login', u.value);
    const d=await api('/api/auth/login','POST',{username:u.value,password:p.value});
    console.log('[login] 成功', d);
    currentUser=d;localStorage.setItem('inv_user',JSON.stringify(d));showApp();
  }catch(e){
    console.error('[login] 失败', e);
    showToast('登录失败: '+(e.message||e),'danger');
  }
}
function doLogout(){currentUser=null;localStorage.removeItem('inv_user');document.getElementById('login-page').style.display='flex';document.getElementById('app').style.display='none'}
function showApp(){document.getElementById('login-page').style.display='none';document.getElementById('app').style.display='flex';document.getElementById('user-name').textContent=currentUser.name;document.getElementById('user-role').textContent=currentUser.role_name||'';document.getElementById('user-avatar').textContent=currentUser.name.charAt(0).toUpperCase();renderTopNav();renderSidebar();initSidebarCollapse();showPage('dashboard')}

// --- 导航结构定义 ---
const NAV_MODULES=[
  {id:'home',label:'首页看板',items:[
    {id:'dashboard',icon:'📊',label:'首页看板',perm:'dashboard_view'},
  ]},
  {id:'inventory',label:'库存管理',items:[
    {id:'skus',icon:'🏷️',label:'SKU主数据',perm:'sku_view'},
    {id:'inventory',icon:'📦',label:'库存总表',perm:'inventory_view'},
    {id:'check',icon:'🔍',label:'库存盘点',perm:'check_view'},
    {id:'stagnant',icon:'⚠️',label:'呆滞分析',perm:'stagnant_view'},
  ]},
  {id:'sales',label:'销售',items:[
    {id:'outbound',icon:'🛒',label:'销售数据',perm:'outbound_view'},
    {id:'replenishment',icon:'📈',label:'订单预测',perm:'replenishment_view'},
  ]},
  {id:'procurement',label:'采购链',items:[
    {id:'po',icon:'🛒',label:'PO管理',perm:'po_view'},
    {id:'pi',icon:'📄',label:'PI管理',perm:'pi_view'},
    {id:'ci',icon:'🚚',label:'CI/PL管理',perm:'ci_view'},
    {id:'logistics',icon:'🚢',label:'物流管理',perm:'logistics_view'},
    {id:'inbound',icon:'📥',label:'入库管理',perm:'inbound_view'},
  ]},
  {id:'finance',label:'财务',items:[
    {id:'payment',icon:'💳',label:'付款管理',perm:'payment_view'},
    {id:'cost',icon:'💰',label:'成本管理',perm:'cost_view'},
  ]},
  {id:'system',label:'系统管理',items:[
    {id:'users',icon:'👤',label:'用户管理',perm:'user_manage'},
    {id:'roles',icon:'🛡️',label:'角色权限',perm:'role_manage'},
    {id:'countries',icon:'🌍',label:'国家管理',perm:'system_config'},
    {id:'warehouses',icon:'🏭',label:'仓库管理',perm:'system_config'},
    {id:'brand-settings',icon:'🏷️',label:'品牌设置',perm:'system_config'},
    {id:'currencies',icon:'💱',label:'币种设置',perm:'system_config'},
    {id:'operation-logs',icon:'📝',label:'操作日志',perm:'system_config'},
    {id:'config',icon:'⚙️',label:'系统参数',perm:'system_config'},
    {id:'suppliers',icon:'🏢',label:'供应商管理',perm:'system_config'},
    {id:'freight-forwarders',icon:'🚛',label:'货代管理',perm:'system_config'},
    {id:'payment-terms',icon:'📋',label:'付款条件',perm:'system_config'},
    {id:'approval-flows',icon:'✅',label:'审批流管理',perm:'system_config'},
    {id:'expense-types',icon:'📊',label:'费用类型',perm:'system_config'},
    {id:'allocation-rules',icon:'📐',label:'分摊规则',perm:'system_config'},
    {id:'batch-tasks',icon:'📋',label:'批量任务中心',perm:'system_config'},
    {id:'forwarder',icon:'📈',label:'货代分析',perm:'forwarder_view'},
  ]},
];
// 构建页面→模块映射
const PAGE_TO_MODULE={};
NAV_MODULES.forEach(m=>m.items.forEach(it=>{PAGE_TO_MODULE[it.id]=m.id}));

let currentModule='home';

// --- 顶部导航 ---
function renderTopNav(){
  let html='';
  NAV_MODULES.forEach(m=>{
    // 只显示有权限访问至少一项的模块
    const hasAny=m.items.some(it=>hasPermission(it.perm));
    if(!hasAny)return;
    html+='<a class="topnav-item'+(currentModule===m.id?' active':'')+'" onclick="switchModule(\''+m.id+'\')">'+m.label+'</a>';
  });
  document.getElementById('topnav').innerHTML=html;
}

// --- 切换模块 ---
function switchModule(modId){
  if(currentModule===modId)return;
  currentModule=modId;
  renderTopNav();
  renderSidebar();
  // 切换模块后自动跳转到该模块的第一个有权限页面
  const mod=NAV_MODULES.find(m=>m.id===modId);
  if(mod){
    const first=mod.items.find(it=>hasPermission(it.perm));
    if(first)showPage(first.id);
  }
}

// --- 侧边栏 ---
function renderSidebar(){
  const mod=NAV_MODULES.find(m=>m.id===currentModule)||NAV_MODULES[0];
  const titleEl=document.getElementById('sidebar-module-title');
  if(titleEl)titleEl.textContent='进销存系统';
  const vis=mod.items.filter(i=>hasPermission(i.perm));
  let html='';
  vis.forEach(i=>{html+='<div class="sidebar-item" data-page="'+i.id+'" onclick="showPage(\''+i.id+'\')" title="'+i.label+'"><span class="icon">'+i.icon+'</span><span>'+i.label+'</span></div>'});
  document.getElementById('sidebar-nav').innerHTML=html;
}
// --- 侧边栏折叠/展开（状态持久化到 localStorage）---
function toggleSidebar(){
  const sb=document.querySelector('.sidebar');
  if(!sb)return;
  const collapsed=sb.classList.toggle('collapsed');
  const btn=document.querySelector('.sidebar-collapse-btn');
  if(btn)btn.textContent=collapsed?'»':'«';
  try{localStorage.setItem('sidebar_collapsed',collapsed?'1':'0');}catch(e){}
}
function initSidebarCollapse(){
  let pref=null;
  try{pref=localStorage.getItem('sidebar_collapsed');}catch(e){}
  if(pref==='1'){
    const sb=document.querySelector('.sidebar');
    if(sb)sb.classList.add('collapsed');
    const btn=document.querySelector('.sidebar-collapse-btn');
    if(btn)btn.textContent='»';
  }
}

// --- 页面路由 ---
function showPage(page){
  currentPage=page;
  // 自动切换到页面所属的模块
  const pageModule=PAGE_TO_MODULE[page];
  if(pageModule&&pageModule!==currentModule){
    currentModule=pageModule;
    renderTopNav();
    renderSidebar();
  }
  document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  document.querySelectorAll('.topnav-item').forEach((el,i)=>{if(NAV_MODULES[i]&&NAV_MODULES[i].id===currentModule)el.classList.add('active');else el.classList.remove('active')});
  const titles={dashboard:'首页看板',skus:'SKU主数据',inventory:'库存总表',outbound:'销售数据',replenishment:'订单预测',stagnant:'呆滞分析',check:'库存盘点',po:'PO管理',pi:'PI管理',ci:'CI/PL管理',logistics:'物流管理',inbound:'入库管理',cost:'成本管理',payment:'付款管理',forwarder:'货代分析',countries:'国家管理',warehouses:'仓库管理',suppliers:'供应商管理','freight-forwarders':'货代管理',currencies:'币种设置',config:'系统参数','payment-terms':'付款条件','approval-flows':'审批流管理','expense-types':'费用类型','allocation-rules':'分摊规则',users:'用户管理',roles:'角色权限','batch-tasks':'批量任务中心','brand-settings':'品牌设置','operation-logs':'操作日志'};
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>';
  const R={dashboard:renderDashboard,skus:renderSKUs,inventory:renderInventory,outbound:renderOutbound,replenishment:renderReplenishment,stagnant:renderStagnant,check:renderCheck,po:renderPO,pi:renderPI,ci:renderCI,logistics:renderLogistics,inbound:renderInbound,cost:renderCost,payment:renderPayment,forwarder:renderForwarderAnalysis,countries:renderCountries,warehouses:renderWarehouses,suppliers:renderSuppliers,'freight-forwarders':renderFreightForwarders,currencies:renderCurrencies,config:renderConfig,'payment-terms':renderPaymentTerms,'approval-flows':renderApprovalFlows,'expense-types':renderExpenseTypes,'allocation-rules':renderAllocationRules,users:renderUsers,roles:renderRoles,'batch-tasks':renderBatchTasks,'brand-settings':renderBrandSettings,'operation-logs':renderOperationLogs};
  if(R[page])R[page]();
}

// ==================== 首页看板 ====================
async function renderDashboard(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="stats-grid" id="dash-stats"><div class="empty-state"><div class="empty-icon">⏳</div>加载中...</div></div><div class="chart-container"><h3 style="margin-bottom:12px">运费占比趋势</h3><div class="chart-canvas-wrapper"><canvas id="chart-freight"></canvas></div></div><div class="stats-grid" id="dash-pending"></div>';
  try{
    const d=await api('/api/dashboard');
    const stats=[
      {l:'总库存金额',v:fmtMoney(d.total_inventory_value,'USD'),c:''},
      {l:'在途库存金额',v:fmtMoney(d.in_transit_value,'USD'),c:''},
      {l:'呆滞库存金额',v:fmtMoney(d.stagnant_value,'USD'),c:'warning'},
      {l:'缺货风险SKU',v:d.shortage_sku_count,c:'danger'},
      {l:'建议采购金额',v:fmtMoney(d.suggest_purchase_amount,'USD'),c:''},
      {l:'7天内待付款',v:fmtMoney(d.pay_7d_amount,'USD'),c:'warning'},
      {l:'30天内待付款',v:fmtMoney(d.pay_30d_amount,'USD'),c:''},
      {l:'逾期付款金额',v:fmtMoney(d.overdue_amount,'USD'),c:'danger'},
    ];
    document.getElementById('dash-stats').innerHTML=stats.map(s=>'<div class="stat-card '+s.c+'"><div class="stat-number">'+s.v+'</div><div class="stat-label">'+s.l+'</div></div>').join('');
    document.getElementById('dash-pending').innerHTML='<div class="stat-card"><div class="stat-number">'+d.po_pending+'</div><div class="stat-label">PO未完成</div></div><div class="stat-card"><div class="stat-number">'+d.pi_pending+'</div><div class="stat-label">PI未完成</div></div><div class="stat-card"><div class="stat-number">'+d.ci_pending+'</div><div class="stat-label">CI未完成</div></div>';
    if(d.freight_trend&&d.freight_trend.length){
      new Chart(document.getElementById('chart-freight').getContext('2d'),{type:'line',data:{labels:d.freight_trend.map(x=>x.month),datasets:[{label:'综合运费',data:d.freight_trend.map(x=>x.freight),borderColor:'#2e7d32',yAxisID:'y'},{label:'运费占比(%)',data:d.freight_trend.map(x=>x.ratio),borderColor:'#ff9500',yAxisID:'y1'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{position:'left'},y1:{position:'right',grid:{display:false}}}}});
    }
  }catch(e){showFlash(e.message,'danger')}
}

// ==================== 通用表格管理器 ====================
function renderSimpleMgr(title,apiUrl,fields,icon){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">'+icon+' '+title+'</div><div class="table-section-actions">'+(hasPermission('system_config')?'<button class="btn btn-primary btn-sm" onclick="editSimple(\''+apiUrl+'\','+encodeURIComponent(JSON.stringify(fields))+')">➕ 新增</button>':'')+'</div></div><div id="simple-table"></div></div>';
  loadSimple(apiUrl,fields);
}
async function loadSimple(apiUrl,fields){
  try{
    const data=await api(apiUrl);
    const df=fields.filter(f=>!f.hide);
    // 如果有 multi 字段，预先拉取选项
    const multiFields = df.filter(f => f.multi);
    for (const mf of multiFields) {
      if (!mf.opts) {
        try { mf.opts = await api(mf.source || (apiUrl.replace(/\/[^/]*$/,'') + '/brands/all')); } catch(e) { mf.opts = []; }
      }
    }
    const html=!data.length?'<div class="empty-state"><div class="empty-icon">📭</div>暂无数据</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr>'+df.map(f=>'<th>'+f.label+'</th>').join('')+'<th>操作</th></tr></thead><tbody>'+data.map(item=>'<tr>'+df.map(f=>{
      if (f.multi) {
        const vals = String(item[f.name]||'').split(',').map(s=>s.trim()).filter(Boolean);
        return '<td>'+(vals.length ? vals.map(v=>'<span class="badge badge-sm" style="margin:2px;background:#e3f2fd;color:#1565c0">'+esc(v)+'</span>').join('') : '<span style="color:#999">全部品牌</span>')+'</td>';
      }
      return '<td>'+(f.bool?(item[f.name]?'✅':'❌'):esc(item[f.name]))+'</td>';
    }).join('')+'<td class="cell-actions">'+(hasPermission('system_config')?'<button class="action-btn action-edit" onclick=\'editSimple("'+apiUrl+'","'+b64EncodeUnicode(JSON.stringify(fields))+'","'+item.id+'")\'>✏️</button><button class="action-btn action-delete" onclick="deleteSimple(\''+apiUrl+'\',\''+item.id+'\')">🗑️</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
    document.getElementById('simple-table').innerHTML=html;
  }catch(e){showFlash(e.message,'danger')}
}
function editSimple(apiUrl,fieldsStr,id){
  let fields;
  try{fields=JSON.parse(fieldsStr)}catch(e){try{fields=JSON.parse(b64DecodeUnicode(fieldsStr))}catch(e2){showToast('参数错误','danger');return}}
  const body='<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid" id="simple-form-grid">'+fields.map(f=>{
    if(f.hide)return '';
    let inp;
    if(f.area) inp='<textarea name="'+f.name+'" rows="2"></textarea>';
    else if(f.sel) inp='<select name="'+f.name+'">'+(f.opts||[]).map(o=>{const v=typeof o==='object'?o.v:o;const l=typeof o==='object'?o.l:o;return '<option value="'+v+'">'+l+'</option>'}).join('')+'</select>';
    else if(f.num) inp='<input type="number" step="0.01" name="'+f.name+'">';
    else if(f.bool) inp='<select name="'+f.name+'"><option value="1">是</option><option value="0">否</option></select>';
    else if(f.multi) {
      // 渲染多选框：checkbox 列表 + 隐藏 input 存逗号分隔值
      const opts = f.opts || [];
      inp='<div class="multi-select-box" data-name="'+f.name+'" style="border:1px solid var(--border);border-radius:6px;padding:8px;max-height:160px;overflow-y:auto;background:#fafbfc">' +
        '<div style="margin-bottom:6px;display:flex;gap:8px"><button type="button" class="btn btn-xs btn-secondary" onclick="multiSelectAll(this,\''+f.name+'\')">全选</button><button type="button" class="btn btn-xs btn-secondary" onclick="multiSelectNone(this,\''+f.name+'\')">清空</button><span style="color:#999;font-size:12px;align-self:center">不选 = 适用于所有品牌</span></div>' +
        opts.map(o => {
          const v = typeof o==='object'?o.v:o; const l = typeof o==='object'?o.l:o;
          return '<label style="display:inline-flex;align-items:center;margin:3px 10px 3px 0;cursor:pointer"><input type="checkbox" class="multi-ck" data-name="'+f.name+'" value="'+v+'" style="margin-right:4px"> '+l+'</label>';
        }).join('') +
        '<input type="hidden" name="'+f.name+'" data-multi="1" value="">' +
        '</div>';
    }
    else inp='<input type="text" name="'+f.name+'">';
    return '<div class="form-group '+(f.full?'form-group-full':'')+'"><label>'+f.label+(f.req?' <span class="required">*</span>':'')+'</label>'+inp+'</div>';
  }).join('')+'</div></div>';
  openModal(id?'编辑':'新增',body,'<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveSimple(\''+apiUrl+'\',\''+(id||'')+'\')">保存</button>');
  if(id){
    Promise.all([api(apiUrl), ...(fields.filter(f=>f.multi && !f.opts).map(f => api(f.source || (apiUrl.replace(/\/[^/]*$/,'') + '/brands/all'))))]).then(results => {
      const all = results[0];
      const item = all.find(i => i.id === id);
      if (!item) return;
      // 收集 multi opts
      const multiOptsByField = {};
      let idx = 1;
      for (const f of fields) {
        if (f.multi) {
          if (f.opts) multiOptsByField[f.name] = f.opts;
          else { multiOptsByField[f.name] = results[idx++]; }
        }
      }
      fields.forEach(f => {
        const el = document.querySelector('[name="'+f.name+'"]');
        if (!el) return;
        if (f.multi) {
          const vals = String(item[f.name] || '').split(',').map(s => s.trim()).filter(Boolean);
          document.querySelectorAll('.multi-ck[data-name="'+f.name+'"]').forEach(ck => {
            if (vals.includes(ck.value)) ck.checked = true;
          });
          updateMultiHidden(f.name);
        } else {
          el.value = item[f.name] !== undefined ? item[f.name] : (f.bool ? '1' : '');
        }
      });
    }).catch(e => showToast(e.message, 'danger'));
  } else {
    // 新增模式：所有 multi 字段先拉 opts 用于显示
    const multiNeeds = fields.filter(f => f.multi && !f.opts);
    Promise.all(multiNeeds.map(f => api(f.source || (apiUrl.replace(/\/[^/]*$/,'') + '/brands/all')))).then(results => {
      // opts 已由 loadSimple 缓存到 f.opts 字段；但 f 在 editSimple 内是新对象。
      // 此处无操作，因为 opts 已经在弹出框中渲染好了（如果缺则空）。这里仅是多加载一次不会出错。
    }).catch(() => {});
  }
}
function multiSelectAll(btn, name){
  const box = btn.closest('.multi-select-box');
  box.querySelectorAll('.multi-ck[data-name="'+name+'"]').forEach(c => c.checked = true);
  updateMultiHidden(name);
}
function multiSelectNone(btn, name){
  const box = btn.closest('.multi-select-box');
  box.querySelectorAll('.multi-ck[data-name="'+name+'"]').forEach(c => c.checked = false);
  updateMultiHidden(name);
}
function updateMultiHidden(name){
  const cks = document.querySelectorAll('.multi-ck[data-name="'+name+'"]:checked');
  const vals = Array.from(cks).map(c => c.value);
  const hidden = document.querySelector('input[data-multi="1"][name="'+name+'"]');
  if (hidden) hidden.value = vals.join(',');
}
async function saveSimple(apiUrl,id){
  const form=document.getElementById('simple-form-grid');
  // 先同步所有 multi 字段
  form.querySelectorAll('input[data-multi="1"]').forEach(h => updateMultiHidden(h.name));
  const data={};
  form.querySelectorAll('input,select,textarea').forEach(el=>{
    if (el.type === 'checkbox' && el.classList.contains('multi-ck')) return; // 跳过中间 checkbox
    if (el.name) data[el.name] = el.value;
  });
  if(id)data.id=id;
  try{await api(apiUrl,'POST',data);showToast('保存成功','success');closeModal();loadSimple(apiUrl,Object.keys(data).map(k=>({name:k,label:k})))}catch(e){showToast(e.message,'danger')}
}
async function deleteSimple(apiUrl,id){if(!confirm('确认删除？'))return;try{await api(apiUrl+'/'+id,'DELETE');showToast('已删除','success');location.reload()}catch(e){showToast(e.message,'danger')}}

// --- 系统管理页面 ---

// 批量任务中心
async function renderBatchTasks(){
  document.getElementById('content-inner').innerHTML=
    '<div id="flash-container"></div>'
    +'<div class="filter-bar"><div class="filter-form">'
    +'<div class="filter-group"><label>页面</label><select id="bt-page" onchange="loadBatchTasks()"><option value="">全部</option><option value="inventory">库存总表</option><option value="outbound">销售数据</option><option value="skus">SKU主数据</option></select></div>'
    +'<div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadBatchTasks()">刷新</button></div>'
    +'</div></div></div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">'
    +'<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📋 批量任务</div></div><div id="bt-tasks"></div></div>'
    +'<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📜 操作日志</div></div><div id="bt-logs"></div></div>'
    +'</div>';
  loadBatchTasks();
}

async function loadBatchTasks(){
  try{
    const page=document.getElementById('bt-page')?.value||'';
    const taskUrl='/api/batch-tasks'+(page?('?page='+page):'');
    const logUrl='/api/operation-logs'+(page?('?page='+page):'');
    const [tasks, logs] = await Promise.all([api(taskUrl), api(logUrl)]);

    document.getElementById('bt-tasks').innerHTML = !tasks.length ? '<div class="empty-state"><div class="empty-icon">📭</div>暂无批量任务</div>' :
      '<div style="max-height:500px;overflow-y:auto"><table class="data-table"><thead><tr><th>任务名称</th><th>操作人</th><th>页面</th><th>状态</th><th>总数</th><th>成功</th><th>失败</th><th>跳过</th><th>开始时间</th><th>错误报告</th></tr></thead><tbody>'
      +tasks.map(t=>'<tr>'
        +'<td>'+esc(t.task_name)+'</td>'
        +'<td>'+esc(t.operator_name||'-')+'</td>'
        +'<td>'+esc(t.page||'-')+'</td>'
        +'<td><span class="status-badge '+(t.status==='completed'?'status-normal':'status-warning')+'">'+esc(t.status)+'</span></td>'
        +'<td class="text-right">'+t.total_count+'</td>'
        +'<td class="text-right" style="color:#2e7d32;font-weight:600">'+t.success_count+'</td>'
        +'<td class="text-right" style="color:#c62828">'+t.failed_count+'</td>'
        +'<td class="text-right" style="color:#f57f17">'+t.skipped_count+'</td>'
        +'<td class="cell-date">'+fmtDate(t.started_at)+'</td>'
        +'<td>'+(t.failed_count>0?'<button class="btn btn-sm btn-secondary" onclick="downloadTaskErrors(\''+t.id+'\')">📥 下载</button>':'-')+'</td>'
      +'</tr>').join('')+'</tbody></table></div>';

    document.getElementById('bt-logs').innerHTML = !logs.length ? '<div class="empty-state"><div class="empty-icon">📭</div>暂无操作日志</div>' :
      '<div style="max-height:500px;overflow-y:auto"><table class="data-table"><thead><tr><th>时间</th><th>操作人</th><th>页面</th><th>操作</th><th>影响数</th><th>原因</th><th>重算</th></tr></thead><tbody>'
      +logs.map(l=>'<tr>'
        +'<td class="cell-date">'+fmtDate(l.created_at)+'</td>'
        +'<td>'+esc(l.operator_name||'-')+'</td>'
        +'<td>'+esc(l.page||'-')+'</td>'
        +'<td>'+esc(l.operation_type)+'</td>'
        +'<td class="text-right">'+l.affected_count+'</td>'
        +'<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis" title="'+esc(l.reason||'')+'">'+esc(l.reason||'')+'</td>'
        +'<td>'+(l.triggered_recalc?'✅':'')+'</td>'
      +'</tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

function downloadTaskErrors(taskId){
  fetch('/api/batch-tasks/'+taskId, {headers:{'X-User-Id':currentUser.id,'X-User-Name':encodeURIComponent(currentUser.name||''),'X-User-Permissions':(currentUser.permissions||[]).join(',')}})
    .then(r=>r.json())
    .then(task=>{
      let errors=[];
      try{errors=typeof task.error_report==='string'?JSON.parse(task.error_report):(task.error_report||[]);}catch(e){}
      if(!errors.length){showToast('无错误数据','info');return;}
      if(typeof XLSX==='undefined'){showFlash('XLSX库未加载','danger');return;}
      const headers=['ID','SKU','失败原因'];
      const rows=errors.map(e=>[e.id||'',e.sku_code||'',e.reason||'']);
      const ws=XLSX.utils.aoa_to_sheet([headers].concat(rows));
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,'错误报告');
      XLSX.writeFile(wb,'任务错误报告_'+taskId+'.xlsx');
    })
    .catch(e=>showFlash('下载失败: '+e.message,'danger'));
}

function renderCountries(){renderSimpleMgr('国家管理','/api/countries',[{name:'name',label:'名称',req:1},{name:'code',label:'代码',req:1},{name:'default_currency',label:'默认币种'},{name:'sort_order',label:'排序',num:1},{name:'status',label:'状态',sel:1,opts:['active','disabled']}],'🌍')}
function renderWarehouses(){
  renderSimpleMgr('仓库管理（国家+仓库+品牌关联）','/api/warehouses',[
    {name:'name',label:'仓库名称',req:1},
    {name:'country_name',label:'所属国家',req:1},
    {name:'warehouse_type',label:'类型',sel:1,opts:[{v:'self',l:'自有仓'},{v:'third_party',l:'第三方仓'}]},
    {name:'brands',label:'关联品牌',multi:1,source:'/api/brands/all',full:1},
    {name:'address',label:'地址',full:1},
    {name:'sort_order',label:'排序',num:1},
    {name:'status',label:'状态',sel:1,opts:['active','disabled']}
  ],'🏭')}
async function renderSuppliers(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🏢 供应商管理</div><div class="table-section-actions">'+(hasPermission('system_config')?'<button class="btn btn-primary btn-sm" onclick="openSupplierModal()">➕ 新增</button>':'')+'</div></div><div id="supplier-table"></div></div>';
  loadSuppliers();
}
function parseSupplierBrands(s){
  try{return Array.isArray(s.associated_brands)?s.associated_brands:JSON.parse(s.associated_brands||'[]')}catch(e){return String(s.associated_brands||'').split(',').map(x=>x.trim()).filter(Boolean)}
}
async function loadSuppliers(){
  try{
    const data=await api('/api/suppliers');
    document.getElementById('supplier-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">🏢</div>暂无供应商</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>供应商名称</th><th>关联品牌</th><th>默认币种</th><th>联系人</th><th>联系方式</th><th>备注</th><th>状态</th><th>操作</th></tr></thead><tbody>'+data.map(s=>{
      const brands=parseSupplierBrands(s);
      return '<tr><td class="cell-name">'+esc(s.name)+'</td><td>'+esc(brands.join(', '))+'</td><td>'+esc(s.default_currency||'USD')+'</td><td>'+esc(s.contact_person||'')+'</td><td>'+esc(s.phone||'')+'</td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis" title="'+esc(s.remark||'')+'">'+esc(s.remark||'')+'</td><td><span class="status-badge '+(s.status==='active'?'status-normal':'status-cancelled')+'">'+(s.status==='active'?'启用':'停用')+'</span></td><td class="cell-actions">'+(hasPermission('system_config')?'<button class="action-btn action-edit" onclick="openSupplierModal(\''+s.id+'\')">✏️</button><button class="action-btn" onclick="toggleSupplierStatus(\''+s.id+'\',\''+(s.status==='active'?'disabled':'active')+'\')" title="'+(s.status==='active'?'停用':'启用')+'">'+(s.status==='active'?'⏸️':'▶️')+'</button>':'')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function openSupplierModal(id){
  try{
    const [suppliers, skus]=await Promise.all([api('/api/suppliers'), api('/api/skus')]);
    const supplier=id?suppliers.find(s=>s.id===id):{};
    const brands=[...new Set(skus.map(s=>s.brand).filter(b=>b&&String(b).trim()))].sort();
    const selected=new Set(parseSupplierBrands(supplier||{}));
    const brandChecks=brands.map(b=>'<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 10px 4px 0;font-size:13px"><input type="checkbox" class="sup-brand" value="'+esc(b)+'" '+(selected.has(b)?'checked':'')+'> '+esc(b)+'</label>').join('')||'<span style="color:#999">暂无品牌，请先维护 SKU 品牌</span>';
    const html='<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'
      +'<div class="form-group"><label>供应商名称 <span class="required">*</span></label><input type="text" id="sup-name" value="'+esc(supplier?.name||'')+'"></div>'
      +'<div class="form-group"><label>默认币种</label><select id="sup-cur">'+['USD','RMB','IDR','MYR','THB'].map(c=>'<option value="'+c+'"'+((supplier?.default_currency||'USD')===c?' selected':'')+'>'+c+'</option>').join('')+'</select></div>'
      +'<div class="form-group"><label>联系人</label><input type="text" id="sup-contact" value="'+esc(supplier?.contact_person||'')+'"></div>'
      +'<div class="form-group"><label>联系方式</label><input type="text" id="sup-phone" value="'+esc(supplier?.phone||'')+'"></div>'
      +'<div class="form-group"><label>状态</label><select id="sup-status"><option value="active"'+((supplier?.status||'active')==='active'?' selected':'')+'>启用</option><option value="disabled"'+(supplier?.status==='disabled'?' selected':'')+'>停用</option></select></div>'
      +'<div class="form-group form-group-full"><label>关联品牌</label><div style="border:1px solid var(--border);border-radius:6px;padding:8px;max-height:150px;overflow:auto">'+brandChecks+'</div></div>'
      +'<div class="form-group form-group-full"><label>备注</label><textarea id="sup-remark" rows="3">'+esc(supplier?.remark||'')+'</textarea></div>'
      +'</div></div>';
    openModal(id?'编辑供应商':'新增供应商',html,'<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveSupplier(\''+(id||'')+'\')">保存</button>');
  }catch(e){showToast(e.message,'danger')}
}
async function saveSupplier(id){
  const brands=Array.from(document.querySelectorAll('.sup-brand:checked')).map(el=>el.value);
  const d={id:id||undefined,name:document.getElementById('sup-name').value.trim(),associated_brands:brands,default_currency:document.getElementById('sup-cur').value,contact_person:document.getElementById('sup-contact').value,phone:document.getElementById('sup-phone').value,remark:document.getElementById('sup-remark').value,status:document.getElementById('sup-status').value};
  if(!d.name){showToast('供应商名称不能为空','warning');return;}
  try{await api('/api/suppliers','POST',d);showToast('保存成功','success');closeModal();loadSuppliers()}catch(e){showToast(e.message,'danger')}
}
async function toggleSupplierStatus(id,status){
  try{const suppliers=await api('/api/suppliers');const s=suppliers.find(x=>x.id===id);if(!s)return;await api('/api/suppliers','POST',{...s,associated_brands:parseSupplierBrands(s),status});showToast(status==='active'?'已启用':'已停用','success');loadSuppliers()}catch(e){showToast(e.message,'danger')}
}
function renderFreightForwarders(){renderSimpleMgr('货代管理','/api/freight-forwarders',[{name:'name',label:'名称',req:1},{name:'short_name',label:'简称'},{name:'contact_person',label:'联系人'},{name:'phone',label:'电话'},{name:'email',label:'邮箱'},{name:'service_types',label:'服务类型'},{name:'status',label:'状态',sel:1,opts:['active','disabled']}],'🚛')}
function renderCurrencies(){renderSimpleMgr('币种管理','/api/currencies',[{name:'code',label:'代码',req:1},{name:'name',label:'名称',req:1},{name:'symbol',label:'符号'},{name:'is_base',label:'基础币种',bool:1},{name:'sort_order',label:'排序',num:1},{name:'status',label:'状态',sel:1,opts:['active','disabled']}],'💱')}
function renderPaymentTerms(){renderSimpleMgr('付款条件','/api/payment-terms',[{name:'name',label:'名称',req:1},{name:'payee_type',label:'付款对象',sel:1,opts:['factory','forwarder','customs']},{name:'payment_type',label:'付款类型',sel:1,opts:['goods','logistics','tax']},{name:'payment_stage',label:'付款阶段',sel:1,opts:['deposit','balance','full','monthly']},{name:'payment_node',label:'付款节点',sel:1,opts:['after_pi','before_ship','after_ci','after_arrival','after_inbound','monthly']},{name:'ratio',label:'比例(%)',num:1},{name:'remind_days_before',label:'提醒提前天',num:1},{name:'is_enabled',label:'启用',bool:1}],'📋')}
function renderApprovalFlows(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">✅ 审批流管理</div></div><div id="simple-table"></div></div>';
  loadApprovalFlows();
}
async function loadApprovalFlows(){
  try{
    const data=await api('/api/approval-flows');
    const html=!data.length?'<div class="empty-state"><div class="empty-icon">✅</div>暂无审批流</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>名称</th><th>业务类型</th><th>审批层级</th><th>启用</th></tr></thead><tbody>'+data.map(f=>'<tr><td>'+esc(f.name)+'</td><td>'+esc(f.business_type)+'</td><td>'+esc(JSON.stringify(f.levels))+'</td><td>'+(f.is_enabled?'✅':'❌')+'</td></tr>').join('')+'</tbody></table></div>';
    document.getElementById('simple-table').innerHTML=html;
  }catch(e){showFlash(e.message,'danger')}
}
function renderExpenseTypes(){renderSimpleMgr('费用类型','/api/expense-types',[{name:'name',label:'名称',req:1},{name:'code',label:'代码'},{name:'is_freight',label:'计入综合运费',bool:1},{name:'is_cost',label:'计入成本',bool:1},{name:'sort_order',label:'排序',num:1},{name:'status',label:'状态',sel:1,opts:['active','disabled']}],'📊')}
function renderAllocationRules(){renderSimpleMgr('分摊规则','/api/allocation-rules',[{name:'name',label:'名称',req:1},{name:'transport_mode',label:'运输方式',sel:1,opts:['sea','air','express','land']},{name:'expense_type',label:'费用类型',sel:1,opts:['freight','duty']},{name:'allocation_basis',label:'分摊依据',sel:1,opts:['cbm','weight','amount']},{name:'is_enabled',label:'启用',bool:1}],'📐')}
function renderConfig(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">⚙️ 系统配置</div><div class="table-section-actions">'+(hasPermission('system_config')?'<button class="btn btn-primary btn-sm" onclick="saveConfig()">💾 保存</button>':'')+'</div></div><div id="config-table" style="padding:20px"></div></div>';
  loadConfig();
}
async function loadConfig(){
  try{
    const data=await api('/api/system-config');
    const html='<div class="form-grid">'+data.map(c=>'<div class="form-group"><label>'+esc(c.description||c.key)+'</label><input type="text" id="cfg-'+c.key+'" value="'+esc(c.value)+'" data-key="'+c.key+'" data-desc="'+esc(c.description||'')+'"></div>').join('')+'</div>';
    document.getElementById('config-table').innerHTML=html;
  }catch(e){showFlash(e.message,'danger')}
}
async function saveConfig(){
  const configs=[];
  document.querySelectorAll('[id^="cfg-"]').forEach(el=>{configs.push({key:el.dataset.key,value:el.value,description:el.dataset.desc})});
  try{await api('/api/system-config','POST',{configs});showToast('配置已保存','success')}catch(e){showToast(e.message,'danger')}
}
function renderUsers(){renderSimpleMgr('用户管理','/api/users',[{name:'username',label:'用户名',req:1},{name:'name',label:'姓名',req:1},{name:'password',label:'密码'},{name:'role_id',label:'角色ID',sel:1,opts:[{v:'role_admin',l:'超级管理员'},{v:'role_operator',l:'运营人员'},{v:'role_viewer',l:'普通用户'}]},{name:'status',label:'状态',sel:1,opts:['active','disabled']},{name:'email',label:'邮箱'}],'👤')}
function renderRoles(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🛡️ 角色管理</div></div><div id="simple-table"></div></div>';
  loadRoles();
}
async function loadRoles(){
  try{
    const data=await api('/api/roles');
    const html=!data.length?'<div class="empty-state">暂无角色</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>角色名</th><th>描述</th><th>权限数</th><th>系统</th></tr></thead><tbody>'+data.map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+esc(r.description)+'</td><td>'+(r.permissions||[]).length+'</td><td>'+(r.is_system?'✅':'❌')+'</td></tr>').join('')+'</tbody></table></div>';
    document.getElementById('simple-table').innerHTML=html;
  }catch(e){showFlash(e.message,'danger')}
}

// ==================== 品牌设置 ====================
async function renderBrandSettings(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🏷️ 品牌设置</div></div><div id="brand-settings-table"></div></div>';
  try{
    const brands=await api('/api/brands/all');
    const skus=await api('/api/skus');
    const brandCount={};
    skus.forEach(s=>{if(s.brand){brandCount[s.brand]=(brandCount[s.brand]||0)+1}});
    const html=!brands.length?'<div class="empty-state"><div class="empty-icon">🏷️</div>暂无品牌数据<br><span style="font-size:12px;color:#999">品牌来源于 SKU 主数据中的品牌字段</span></div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>品牌名称</th><th>关联SKU数</th></tr></thead><tbody>'+brands.map(b=>'<tr><td class="cell-name">'+esc(b)+'</td><td>'+(brandCount[b]||0)+'</td></tr>').join('')+'</tbody></table></div><div style="padding:12px 20px;color:#999;font-size:12px">💡 品牌数据来源于 SKU 主数据，请在 SKU 管理页面维护品牌信息</div>';
    document.getElementById('brand-settings-table').innerHTML=html;
  }catch(e){showFlash(e.message,'danger')}
}

// ==================== 操作日志 ====================
async function renderOperationLogs(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📝 操作日志</div><div class="table-section-actions"><button class="btn btn-secondary btn-sm" onclick="renderOperationLogs()">🔄 刷新</button></div></div><div id="op-logs-table"></div></div>';
  try{
    const data=await api('/api/operation-logs?page=&limit=100');
    const rows=Array.isArray(data)?data:(data.rows||data.data||[]);
    const html=!rows.length?'<div class="empty-state"><div class="empty-icon">📝</div>暂无操作日志</div>':'<div class="table-container" style="box-shadow:none;border-radius:0;max-height:600px;overflow:auto"><table class="data-table"><thead><tr><th>时间</th><th>操作人</th><th>页面</th><th>操作类型</th><th>影响数量</th><th>原因</th></tr></thead><tbody>'+rows.map(r=>'<tr><td class="cell-date">'+esc((r.created_at||'').replace('T',' ').slice(0,19))+'</td><td>'+esc(r.operator_name||'-')+'</td><td>'+esc(r.page||'-')+'</td><td>'+esc(r.operation_type||'-')+'</td><td class="text-right">'+(r.affected_count||0)+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.reason||'')+'">'+esc(r.reason||'-')+'</td></tr>').join('')+'</tbody></table></div>';
    document.getElementById('op-logs-table').innerHTML=html;
  }catch(e){showFlash(e.message,'danger')}
}
async function renderSKUs(){
  // 动态从已有SKU中提取品牌、生命周期、状态选项
  let brandOpts = '<option value="">全部品牌</option>';
  let lcOpts = '<option value="">全部生命周期</option>';
  let stOpts = '<option value="">全部状态</option>';
  try {
    const all = await api('/api/skus');
    const brands = [...new Set(all.map(s => s.brand).filter(b => b && b.trim()))].sort();
    brands.forEach(b => { brandOpts += '<option value="' + esc(b) + '">' + esc(b) + '</option>'; });
    const lcLabels = {'new_test':'新品导入','new_launch':'新品启动','growth':'成长期','stable':'成熟期','slow':'衰退期','stagnant':'滞销','clearance':'清仓期','stopped':'停采/停产','discontinued':'停采/停产'};
    const lifecycles = [...new Set(all.map(s => s.lifecycle_status).filter(l => l))].sort();
    lifecycles.forEach(l => { lcOpts += '<option value="' + l + '">' + (lcLabels[l] || l) + '</option>'; });
    const statuses = [...new Set(all.map(s => s.status).filter(s => s))].sort();
    const stLabels = {'normal':'启用','stopped':'停用','clearance':'清仓','discontinued':'停产'};
    statuses.forEach(s => { stOpts += '<option value="' + s + '">' + (stLabels[s] || s) + '</option>'; });
  } catch(e) { /* fallback to static options below */ }
  // 兜底：如果数据库为空，给出常用选项
  if (brandOpts === '<option value="">全部品牌</option>') {
    brandOpts += '<option value="Redragon">Redragon</option><option value="Logitech">Logitech</option><option value="Razer">Razer</option><option value="CoolerMaster">CoolerMaster</option>';
  }
  if (lcOpts === '<option value="">全部生命周期</option>') {
    lcOpts += '<option value="new_test">新品导入</option><option value="new_launch">新品启动</option><option value="growth">成长期</option><option value="stable">成熟期</option><option value="slow">衰退期</option><option value="stagnant">滞销</option><option value="clearance">清仓期</option><option value="stopped">停采/停产</option>';
  }
  if (stOpts === '<option value="">全部状态</option>') {
    stOpts += '<option value="normal">启用</option><option value="stopped">停用</option><option value="clearance">清仓</option><option value="discontinued">停产</option>';
  }
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>关键词</label><input type="text" id="sku-kw" placeholder="SKU/产品名/Model/EAN" onkeypress="if(event.key===\'Enter\')loadSKUs()"></div><div class="filter-group"><label>品牌</label><select id="sku-brand">'+brandOpts+'</select></div><div class="filter-group"><label>状态</label><select id="sku-st">'+stOpts+'</select></div><div class="filter-group"><label>生命周期</label><select id="sku-lc">'+lcOpts+'</select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadSKUs()">搜索</button></div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🏷️ SKU列表</div><div class="table-section-actions">'+
    '<div style="position:relative;display:inline-block">'+
      (hasPermission('sku_import')?'<button class="btn btn-secondary btn-sm" id="sku-import-trigger" onclick="toggleSkuImportMenu(event)">📥 导入/更新SKU ▾</button>':'')+
    '</div>'+
    (hasPermission('sku_create')?'<button class="btn btn-primary btn-sm" onclick="editSKU()">➕ 新增SKU</button>':'')+'</div></div><div id="sku-batch-bar" style="display:none"></div><div id="sku-table"></div></div>';
  // 将下拉菜单挂到 body，避免被父容器 overflow:hidden 截断
  ensureSkuImportMenu();
  loadSKUs();
}

function ensureSkuImportMenu(){
  var existing=document.getElementById('sku-import-menu');
  if(existing)existing.remove();
  var menu=document.createElement('div');
  menu.id='sku-import-menu';
  menu.style.cssText='display:none;position:fixed;background:#fff;border:1px solid #e0e0e0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.18);z-index:1100;min-width:160px';
  menu.innerHTML=
    '<div style="padding:8px 16px;cursor:pointer;font-size:13px;border-bottom:1px solid #f0f0f0" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'#fff\'" onclick="toggleSkuImportMenu();openSkuBatchImport()">📥 新增/更新导入</div>'+
    '<div style="padding:8px 16px;cursor:pointer;font-size:13px" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'#fff\'" onclick="toggleSkuImportMenu();showSkuImportRecords()">📋 查看导入记录</div>';
  document.body.appendChild(menu);
  // 点击其他地方关闭
  if(!window._skuMenuDocListener){
    document.addEventListener('click',function(e){
      var m=document.getElementById('sku-import-menu');
      var t=document.getElementById('sku-import-trigger');
      if(!m||m.style.display==='none')return;
      if(m.contains(e.target))return;
      if(t&&t.contains(e.target))return;
      m.style.display='none';
    });
    window._skuMenuDocListener=true;
  }
}

function toggleSkuImportMenu(evt){
  if(evt){evt.stopPropagation();}
  var m=document.getElementById('sku-import-menu');
  var t=document.getElementById('sku-import-trigger');
  if(!m||!t)return;
  if(m.style.display==='block'){m.style.display='none';return;}
  var rect=t.getBoundingClientRect();
  m.style.display='block';
  m.style.top=(rect.bottom+4)+'px';
  m.style.left=(rect.right-m.offsetWidth)+'px';
}
function showSkuImportRecords(){
  openModal('SKU导入记录',
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div id="sku-import-records-list" style="min-height:100px"><div style="text-align:center;color:#999;padding:20px">加载中...</div></div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'
  );
  // 简单展示当前SKU统计
  api('/api/skus?keyword=').then(function(data){
    var html='<div style="background:#f0f8ff;padding:14px;border-radius:6px;margin-bottom:12px;font-size:13px"><b>当前SKU主数据概况</b></div>';
    html+='<div class="table-container" style="box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>指标</th><th>数量</th></tr></thead><tbody>';
    html+='<tr><td>SKU总数</td><td class="text-right font-bold">'+data.length+'</td></tr>';
    html+='<tr><td>启用状态</td><td class="text-right">'+data.filter(function(s){return s.status==='normal'}).length+'</td></tr>';
    html+='<tr><td>停用状态</td><td class="text-right">'+data.filter(function(s){return s.status==='stopped'||s.status==='discontinued'}).length+'</td></tr>';
    html+='<tr><td>清仓状态</td><td class="text-right">'+data.filter(function(s){return s.status==='clearance'}).length+'</td></tr>';
    html+='<tr><td>有品牌</td><td class="text-right">'+data.filter(function(s){return s.brand&&s.brand.trim()}).length+'</td></tr>';
    html+='<tr><td>有EAN/条码</td><td class="text-right">'+data.filter(function(s){return s.barcode&&s.barcode.trim()}).length+'</td></tr>';
    html+='</tbody></table></div>';
    html+='<div style="margin-top:12px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666">💡 导入说明：使用"新增/更新导入"功能上传Excel，系统会自动根据SKU编码判断是新增还是更新。SKU编码已存在则更新，不存在则新增。</div>';
    document.getElementById('sku-import-records-list').innerHTML=html;
  }).catch(function(e){
    document.getElementById('sku-import-records-list').innerHTML='<div style="color:#ff4d4f;text-align:center;padding:20px">'+e.message+'</div>';
  });
}
async function loadSKUs(){
  try{
    const kw=document.getElementById('sku-kw')?.value||'',st=document.getElementById('sku-st')?.value||'',
          br=document.getElementById('sku-brand')?.value||'',lc=document.getElementById('sku-lc')?.value||'';
    const data=await api('/api/skus?keyword='+encodeURIComponent(kw)+'&status='+st+'&brand='+encodeURIComponent(br)+'&lifecycle_status='+lc);
    window._skuData=data;
    window._skuSelected={};
    var lcLabels={'new_test':'新品导入','new_launch':'新品启动','growth':'成长期','stable':'成熟期','slow':'衰退期','stagnant':'滞销','clearance':'清仓期','stopped':'停采/停产','discontinued':'停采/停产'};
    var lcBadge={'new_test':'status-pending','new_launch':'status-pending','growth':'status-info','stable':'status-normal','slow':'status-warning','stagnant':'status-warning','clearance':'status-warning','stopped':'status-danger','discontinued':'status-danger'};
    var thead='<thead><tr>'+
      '<th style="width:36px"><input type="checkbox" onchange="toggleAllSku(this)"></th>'+
      '<th>品牌</th><th>Category</th><th>Model</th><th>SKU</th><th>产品名称</th><th>EAN</th>'+
      '<th>状态</th><th>生命周期</th><th>是否停采</th><th>创建时间</th><th>更新时间</th><th>操作</th>'+
      '</tr></thead>';
    var tbody=data.map(function(s){
        var isEnabled=s.status==='normal';
        var isStopped=s.status==='stopped'||s.status==='discontinued';
        var lcText=lcLabels[s.lifecycle_status]||'未判断';
        var lcCls=lcBadge[s.lifecycle_status]||'status-pending';
        return '<tr id="sku-row-'+s.id+'">'+
          '<td><input type="checkbox" class="sku-checkbox" value="'+s.id+'" onchange="onSkuCheckChange()"></td>'+
          '<td>'+esc(s.brand||'-')+'</td>'+
          '<td>'+esc(s.category||'-')+'</td>'+
          '<td>'+esc(s.model||'-')+'</td>'+
          '<td class="cell-id">'+esc(s.sku_code)+'</td>'+
          '<td>'+esc(s.product_name||'-')+'</td>'+
          '<td>'+esc(s.barcode||'-')+'</td>'+
          '<td><span class="status-badge '+(isEnabled?'status-normal':'status-danger')+'">'+(isEnabled?'启用':'停用')+'</span></td>'+
          '<td><span class="status-badge '+lcCls+'">'+lcText+'</span></td>'+
          '<td>'+(isStopped?'<span style="color:#ff4d4f">是</span>':'否')+'</td>'+
          '<td class="cell-date">'+(s.created_at||'').slice(0,19)+'</td>'+
          '<td class="cell-date">'+(s.updated_at||'').slice(0,19)+'</td>'+
          '<td class="cell-actions">'+(hasPermission('sku_edit')?'<button class="action-btn action-edit" onclick="editSKU(\''+s.id+'\')">✏️</button>':'')+(hasPermission('sku_delete')?'<button class="action-btn action-delete" onclick="deleteSKU(\''+s.id+'\')">🗑️</button>':'')+'</td>'+
        '</tr>';
      }).join('');
    var emptyTip='<tr><td colspan="13" style="text-align:center;color:#999;padding:40px">📭 暂无SKU数据，点击右上角"导入/更新SKU"或"新增SKU"开始</td></tr>';
    document.getElementById('sku-table').innerHTML='<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table">'+thead+'<tbody>'+(tbody||emptyTip)+'</tbody></table></div>';
    updateSkuBatchBar();
  }catch(e){showFlash(e.message,'danger')}
}
function toggleAllSku(cb){
  document.querySelectorAll('.sku-checkbox').forEach(function(c){c.checked=cb.checked});
  onSkuCheckChange();
}
function onSkuCheckChange(){
  window._skuSelected={};
  document.querySelectorAll('.sku-checkbox:checked').forEach(function(c){window._skuSelected[c.value]=true});
  updateSkuBatchBar();
}
function updateSkuBatchBar(){
  var count=Object.keys(window._skuSelected||{}).length;
  var bar=document.getElementById('sku-batch-bar');
  if(!bar)return;
  if(count===0){bar.style.display='none';return}
  bar.style.display='block';
  bar.style.padding='8px 12px';
  bar.style.background='#e6f7ff';
  bar.style.border='1px solid #91d5ff';
  bar.style.borderRadius='4px';
  bar.style.marginBottom='8px';
  bar.innerHTML='<span style="font-size:13px;font-weight:600;margin-right:16px">已选择 '+count+' 个SKU</span>'+
    (hasPermission('sku_edit')?'<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="batchSkuUpdate(\'status\',\'启用\')">✅ 批量启用</button>':'')+
    (hasPermission('sku_edit')?'<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="batchSkuUpdate(\'status\',\'停用\')">⏸️ 批量停用</button>':'')+
    (hasPermission('sku_edit')?'<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="openBatchSkuEditModal(\'brand\')">批量修改品牌</button>':'')+
    (hasPermission('sku_edit')?'<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="openBatchSkuEditModal(\'category\')">批量修改Category</button>':'')+
    (hasPermission('sku_edit')?'<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="openBatchSkuEditModal(\'model\')">批量修改Model</button>':'')+
    (hasPermission('sku_edit')?'<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="openBatchSkuEditModal(\'lifecycle_status\')">批量修改生命周期</button>':'')+
    (hasPermission('sku_edit')?'<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="openBatchSkuEditModal(\'status\')">批量修改状态</button>':'')+
    '<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="batchSkuExport()">📤 批量导出</button>'+
    (hasPermission('sku_delete')?'<button class="btn btn-sm" style="margin-right:6px;background:#ff4d4f;color:#fff;border:none" onclick="batchSkuDelete()">🗑️ 批量删除</button>':'');
}
function openBatchSkuEditModal(field){
  var count=Object.keys(window._skuSelected||{}).length;
  if(count===0)return;
  var fieldLabels={'brand':'品牌','category':'Category','model':'Model','lifecycle_status':'生命周期','status':'状态'};
  var label=fieldLabels[field]||field;
  var options='';
  if(field==='lifecycle_status'){
    options='<select name="val" style="width:100%;padding:6px"><option value="new_test">新品导入</option><option value="new_launch">新品启动</option><option value="growth">成长期</option><option value="stable">成熟期</option><option value="slow">衰退期</option><option value="stagnant">滞销</option><option value="clearance">清仓期</option><option value="stopped">停采/停产</option></select>';
  }else if(field==='status'){
    options='<select name="val" style="width:100%;padding:6px"><option value="启用">启用</option><option value="停用">停用</option><option value="清仓">清仓</option><option value="停产">停产</option></select>';
  }else{
    options='<input type="text" name="val" style="width:100%;padding:6px" placeholder="请输入新的'+label+'">';
  }
  openModal('批量修改'+label,
    '<div style="padding:16px">'+
      '<div style="margin-bottom:12px;padding:10px;background:#fffbe6;border-radius:4px;font-size:13px;color:#666">你正在修改 <b>'+count+'</b> 个SKU的'+label+'，是否确认？</div>'+
      '<div class="form-group"><label>'+label+'</label>'+options+'</div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="confirmBatchSkuUpdate(\''+field+'\')">确认修改</button>'
  );
}
function confirmBatchSkuUpdate(field){
  var el=document.querySelector('[name="val"]');
  if(!el)return;
  var val=el.value;
  if(!val||!val.trim()){showToast('值不能为空','danger');return}
  var ids=Object.keys(window._skuSelected||{});
  if(ids.length===0)return;
  var data={};data[field]=val;
  api('/api/skus/batch-update','POST',{ids:ids,data:data}).then(function(res){
    closeModal();
    showToast('已更新'+(res.updated||ids.length)+'个SKU','success');
    loadSKUs();
  }).catch(function(e){showToast(e.message,'danger')});
}
function batchSkuUpdate(field,val){
  var ids=Object.keys(window._skuSelected||{});
  if(ids.length===0)return;
  if(!confirm('你正在修改 '+ids.length+' 个SKU的状态为"'+val+'"，是否确认？'))return;
  var data={};data[field]=val;
  api('/api/skus/batch-update','POST',{ids:ids,data:data}).then(function(res){
    showToast('已更新'+(res.updated||ids.length)+'个SKU','success');
    loadSKUs();
  }).catch(function(e){showToast(e.message,'danger')});
}
function batchSkuExport(){
  var ids=Object.keys(window._skuSelected||{});
  if(ids.length===0)return;
  var data=window._skuData||[];
  var selected=data.filter(function(s){return window._skuSelected[s.id]});
  if(selected.length===0)return;
  var headers=SKU_IMPORT_COLUMNS.map(function(c){return c.label});
  var rows=selected.map(function(s){
    return SKU_IMPORT_COLUMNS.map(function(c){return s[c.key]!==undefined?s[c.key]:''});
  });
  var ws=XLSX.utils.aoa_to_sheet([headers].concat(rows));
  ws['!cols']=SKU_IMPORT_COLUMNS.map(function(c){return {wch:c.label.length*2+6}});
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'SKU导出');
  XLSX.writeFile(wb,'SKU批量导出_'+ids.length+'条.xlsx');
  showToast('已导出'+selected.length+'条SKU','success');
}
function batchSkuDelete(){
  var ids=Object.keys(window._skuSelected||{});
  if(ids.length===0)return;
  if(!confirm('⚠️ 删除后可能影响库存、出库、PO、PI、CI/PL等关联数据。\n如果SKU已有业务数据，将不允许删除，只能停用。\n\n确认删除选中的 '+ids.length+' 个SKU吗？'))return;
  if(!confirm('二次确认：真的要删除这 '+ids.length+' 个SKU吗？此操作不可逆！'))return;
  api('/api/skus/batch-delete','POST',{ids:ids}).then(function(res){
    var msg='已删除'+res.deleted+'个';
    if(res.failed>0)msg+='，失败'+res.failed+'个（有关联业务数据）';
    showToast(msg,res.failed>0?'warning':'success');
    if(res.errors&&res.errors.length>0){
      var html='<div style="max-height:300px;overflow:auto"><div style="font-weight:600;margin-bottom:8px">删除失败的SKU：</div>';
      res.errors.forEach(function(e){html+='<div style="color:#666;padding:2px 0">'+esc(e.sku_code||e.id)+'：'+esc(e.reason)+'</div>'});
      html+='</div>';
      openModal('删除结果',html,'<button class="btn btn-secondary" onclick="closeModal()">关闭</button>');
    }
    loadSKUs();
  }).catch(function(e){showToast(e.message,'danger')});
}
function editSKU(id){
  const F=[{n:'sku_code',l:'SKU编码',r:1},{n:'product_name',l:'产品名称'},{n:'brand',l:'品牌',r:1},{n:'category',l:'类目'},{n:'model',l:'型号'},{n:'color_spec',l:'颜色/规格'},{n:'barcode',l:'EAN/条码'},{n:'purchase_currency',l:'采购币种',t:'sel',o:['USD','RMB','IDR','MYR','THB']},{n:'standard_purchase_price',l:'标准采购价',t:'num'},{n:'carton_spec',l:'箱规'},{n:'qty_per_carton',l:'单箱数量',t:'num'},{n:'unit_weight',l:'单位重量(KG)',t:'num'},{n:'unit_cbm',l:'单位体积(CBM)',t:'num'},{n:'is_new_product',l:'是否新品',t:'sel',o:[{v:0,l:'否'},{v:1,l:'是'}]},{n:'launch_date',l:'上市日期',t:'date'},{n:'new_product_protection_days',l:'新品保护期(天)',t:'num'},{n:'lifecycle_status',l:'生命周期',t:'sel',o:[{v:'new_test',l:'新品导入'},{v:'new_launch',l:'新品启动'},{v:'growth',l:'成长期'},{v:'stable',l:'成熟期'},{v:'slow',l:'衰退期'},{v:'stagnant',l:'滞销'},{v:'clearance',l:'清仓期'},{v:'stopped',l:'停采/停产'}]},{n:'auto_replenish',l:'允许自动补货',t:'sel',o:[{v:1,l:'是'},{v:0,l:'否'}]},{n:'status',l:'状态',t:'sel',o:[{v:'normal',l:'启用'},{v:'stopped',l:'停用'},{v:'clearance',l:'清仓'},{v:'discontinued',l:'停产'}]},{n:'remark',l:'备注',t:'area',f:1}];
  let body='<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">';
  F.forEach(f=>{const inp=f.t==='area'?'<textarea name="'+f.n+'" rows="2"></textarea>':f.t==='sel'?'<select name="'+f.n+'">'+(f.o||[]).map(o=>{const v=typeof o==='object'?o.v:o;const l=typeof o==='object'?o.l:o;return '<option value="'+v+'">'+l+'</option>'}).join('')+'</select>':f.t==='date'?'<input type="date" name="'+f.n+'">':f.t==='num'?'<input type="number" step="0.0001" name="'+f.n+'">':'<input type="text" name="'+f.n+'">';body+='<div class="form-group '+(f.f?'form-group-full':'')+'"><label>'+f.l+(f.r?' <span class="required">*</span>':'')+'</label>'+inp+'</div>'});
  body+='</div></div>';
  openModal(id?'编辑SKU':'新增SKU',body,'<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveSKU(\''+(id||'')+'\')">保存</button>');
  if(id)api('/api/skus/'+id).then(s=>{F.forEach(f=>{const el=document.querySelector('[name="'+f.n+'"]');if(el)el.value=s[f.n]!==undefined?s[f.n]:''})}).catch(()=>{});
}
async function saveSKU(id){
  const form=document.querySelector('.form-grid');const data={};
  form.querySelectorAll('input,select,textarea').forEach(el=>{if(el.name)data[el.name]=el.value});
  data.standard_purchase_price=parseFloat(data.standard_purchase_price)||0;
  data.qty_per_carton=parseInt(data.qty_per_carton)||0;data.unit_weight=parseFloat(data.unit_weight)||0;data.unit_cbm=parseFloat(data.unit_cbm)||0;
  data.is_new_product=parseInt(data.is_new_product)||0;data.new_product_protection_days=parseInt(data.new_product_protection_days)||90;data.auto_replenish=parseInt(data.auto_replenish)||0;
  try{if(id){await api('/api/skus/'+id,'PUT',data);showToast('保存成功','success')}else{await api('/api/skus','POST',data);showToast('创建成功','success')}closeModal();loadSKUs()}catch(e){showToast(e.message,'danger')}
}
async function deleteSKU(id){
  if(!confirm('⚠️ 删除SKU可能影响库存、出库、PO、PI、CI/PL等关联数据。\n如果SKU已有业务数据，将不允许删除，只能停用。\n\n确认删除吗？'))return;
  try{
    await api('/api/skus/'+id,'DELETE');
    showToast('已删除','success');
    loadSKUs();
  }catch(e){
    showToast(e.message||'删除失败','danger');
  }
}

// --- 通用导入函数 ---
function importFile(url,callback){
  const inp=document.createElement('input');inp.type='file';inp.accept='.xlsx,.xls';
  inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=async ev=>{try{const wb=XLSX.read(ev.target.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const items=XLSX.utils.sheet_to_json(ws);const result=await api(url,'POST',{items});showToast('导入完成：新增'+(result.created||0)+'，更新'+(result.updated||0)+'，失败'+(result.failed||0),'success');if(callback)callback()}catch(err){showToast(err.message,'danger')}};r.readAsArrayBuffer(f)};
  inp.click();
}

// ==================== SKU批量导入 ====================
const SKU_IMPORT_COLUMNS=[
  {key:'sku_code',label:'SKU编码',required:true},
  {key:'product_name',label:'产品名称'},
  {key:'brand',label:'品牌'},
  {key:'category',label:'类目'},
  {key:'model',label:'型号'},
  {key:'color_spec',label:'颜色/规格'},
  {key:'barcode',label:'条码'},
  {key:'purchase_currency',label:'采购币种'},
  {key:'standard_purchase_price',label:'标准采购价',format:parseFloat},
  {key:'carton_spec',label:'箱规'},
  {key:'qty_per_carton',label:'单箱数量',format:parseInt},
  {key:'unit_weight',label:'单位重量(KG)',format:parseFloat},
  {key:'unit_cbm',label:'单位体积(CBM)',format:parseFloat},
  {key:'lifecycle_status',label:'生命周期'},
  {key:'launch_date',label:'上市日期'},
  {key:'status',label:'状态'},
  {key:'remark',label:'备注'}
];
// 生命周期中文 → 代码
const SKU_LIFECYCLE_MAP={'新品导入':'new_test','新品启动':'new_launch','成长期':'growth','成熟期':'stable','衰退期':'slow','滞销':'stagnant','清仓期':'clearance','停采':'stopped','停产':'stopped','停采/停产':'stopped'};
const SKU_STATUS_MAP={'启用':'normal','正常':'normal','清仓':'clearance','停用':'stopped','停采':'stopped','停产':'discontinued'};

function openSkuBatchImport(){
  openModal('批量导入SKU主数据',
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div id="si-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s" '+
        'onclick="document.getElementById(\'si-file-input\').click()" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
        'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handleSkuFile(event.dataTransfer.files[0])">'+
        '<div style="font-size:48px;color:#1890ff;margin-bottom:8px">📤</div>'+
        '<div style="font-size:14px;color:#333;margin-bottom:4px">点击上传或拖拽文件到此处</div>'+
        '<div style="font-size:12px;color:#999">支持 .xlsx / .xls / .csv 格式</div>'+
      '</div>'+
      '<input type="file" id="si-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleSkuFile(this.files[0])">'+
      '<div id="si-preview" style="margin-top:16px"></div>'+
      '<div id="si-result" style="margin-top:16px"></div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="downloadSkuTemplate()">下载模板</button>'+
    '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'+
    '<button class="btn btn-primary" id="si-import-btn" onclick="submitSkuBatchImport()" disabled>开始导入</button>'
  );
  window._skuImportData=[];
}

function handleSkuFile(file){
  if(!file)return;
  var ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){showToast('仅支持 .xlsx / .xls / .csv 格式','danger');return}
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=e.target.result;
      var wb;
      if(ext==='csv'){wb=XLSX.read(data,{type:'string',codepage:65001})}
      else{wb=XLSX.read(new Uint8Array(data),{type:'array',cellDates:true})}
      var ws=wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      if(rows.length<2){showToast('文件为空或缺少数据行','danger');return}
      var headers=rows[0].map(function(h){return String(h||'').trim()});
      var records=[];
      for(var i=1;i<rows.length;i++){
        var row=rows[i];
        if(!row||row.every(function(c){return !c||String(c).trim()===''}))continue;
        var rec={_rowNum:i+1,_errors:[]};
        SKU_IMPORT_COLUMNS.forEach(function(col){
          var idx=headers.findIndex(function(h){return h===col.label||h===col.key});
          if(idx>=0&&row[idx]!==undefined&&row[idx]!==''){
            var val=row[idx];
            if(typeof val==='string')val=val.trim();
            if(col.format)val=col.format(val);
            rec[col.key]=val;
          }
        });
        // 校验必填
        if(!rec.sku_code||!String(rec.sku_code).trim())rec._errors.push('SKU编码不能为空');
        // 映射生命周期
        if(rec.lifecycle_status&&typeof rec.lifecycle_status==='string'){
          rec.lifecycle_status=SKU_LIFECYCLE_MAP[rec.lifecycle_status]||rec.lifecycle_status;
        }
        // 映射状态
        if(rec.status&&typeof rec.status==='string'){
          rec.status=SKU_STATUS_MAP[rec.status]||rec.status;
        }
        // 日期格式处理
        if(rec.launch_date&&rec.launch_date instanceof Date){
          rec.launch_date=formatDateISO(rec.launch_date);
        }else if(rec.launch_date){
          rec.launch_date=String(rec.launch_date).trim().slice(0,10);
        }
        records.push(rec);
      }
      window._skuImportData=records;
      renderSkuPreview(records);
      document.getElementById('si-import-btn').disabled=records.filter(function(r){return r._errors.length===0}).length===0;
    }catch(err){showToast('文件解析失败：'+err.message,'danger')}
  };
  if(ext==='csv')reader.readAsText(file,'UTF-8');
  else reader.readAsArrayBuffer(file);
}

function renderSkuPreview(records){
  var valid=records.filter(function(r){return r._errors.length===0}).length;
  var invalid=records.length-valid;
  var html='<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px"><b>共 '+records.length+' 条数据</b>，<span style="color:#52c41a">有效 '+valid+' 条</span>'+(invalid>0?'，<span style="color:#ff4d4f">无效 '+invalid+' 条</span>':'')+'</div>';
  html+='<div class="table-container" style="max-height:300px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>行</th><th>SKU编码</th><th>产品名称</th><th>品牌</th><th>型号</th><th>生命周期</th><th>状态</th><th>校验</th></tr></thead><tbody>';
  var preview=records.slice(0,20);
  preview.forEach(function(r){
    var ok=r._errors.length===0;
    html+='<tr style="'+(ok?'':'background:#fff1f0')+'">'+
      '<td>'+r._rowNum+'</td>'+
      '<td class="cell-id">'+esc(r.sku_code||'-')+'</td>'+
      '<td>'+esc(r.product_name||'-')+'</td>'+
      '<td>'+esc(r.brand||'-')+'</td>'+
      '<td>'+esc(r.model||'-')+'</td>'+
      '<td>'+esc(r.lifecycle_status||'-')+'</td>'+
      '<td>'+esc(r.status||'-')+'</td>'+
      '<td>'+(ok?'<span class="status-badge status-completed">✓</span>':'<span class="status-badge status-danger" title="'+esc(r._errors.join('; '))+'">✗ '+r._errors.length+'</span>')+'</td>'+
    '</tr>';
  });
  if(records.length>20)html+='<tr><td colspan="8" style="text-align:center;color:#999;padding:8px">... 还有 '+(records.length-20)+' 条</td></tr>';
  html+='</tbody></table></div>';
  if(invalid>0){
    html+='<div style="margin-top:10px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666"><b>无效行明细：</b><br>'+
      records.filter(function(r){return r._errors.length>0}).slice(0,10).map(function(r){return '第 '+r._rowNum+' 行：'+r._errors.join('、')}).join('<br>')+
      (invalid>10?'<br>...':'')+'</div>';
  }
  document.getElementById('si-preview').innerHTML=html;
}

function downloadSkuTemplate(){
  var headers=SKU_IMPORT_COLUMNS.map(function(c){return c.label});
  var sample=[
    ['RD-K585-RGB','K585 RGB机械键盘','Redragon','机械键盘','K585','黑色','6959368123456','USD','18.50','48x32x12cm',20,0.85,0.012,'成长期','2025-03-15','正常','热销款'],
    ['RD-M601-BK','M601游戏鼠标','Redragon','游戏鼠标','M601','黑色','6959368789012','USD','6.20','30x20x8cm',50,0.25,0.005,'成熟期','2024-06-01','正常','常规款']
  ];
  var ws=XLSX.utils.aoa_to_sheet([headers].concat(sample));
  ws['!cols']=SKU_IMPORT_COLUMNS.map(function(c){return {wch:c.label.length*2+6}});
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'SKU主数据');
  XLSX.writeFile(wb,'SKU主数据_导入模板.xlsx');
}

async function submitSkuBatchImport(){
  var records=window._skuImportData||[];
  var valid=records.filter(function(r){return r._errors.length===0});
  if(valid.length===0){showToast('没有可导入的有效数据','danger');return}
  var btn=document.getElementById('si-import-btn');
  btn.disabled=true;btn.textContent='导入中...';
  try{
    // 清理内部字段
    var items=valid.map(function(r){
      var o={};
      SKU_IMPORT_COLUMNS.forEach(function(c){o[c.key]=r[c.key]!==undefined?r[c.key]:''});
      return o;
    });
    var res=await api('/api/skus/bulk-import','POST',{items:items});
    window._lastSkuImportErrors=res.errors||[];
    var html='<div style="background:'+(res.failed>0?'#fffbe6':'#f6ffed')+';border:1px solid '+(res.failed>0?'#ffe58f':'#b7eb8f')+';border-radius:8px;padding:14px 16px;font-size:13px">'+
      '<div style="font-weight:600;margin-bottom:8px">导入完成</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
        '<span>已新增：'+(res.created||0)+' 条</span>'+
        '<span>已更新：'+(res.updated||0)+' 条</span>'+
        '<span>失败：'+(res.failed||0)+' 条</span>'+
      '</div>';
    if(window._lastSkuImportErrors.length>0){
      html+='<div style="margin-top:10px"><div style="font-weight:600;color:#ff3b30;margin-bottom:6px">失败明细</div>';
      html+=window._lastSkuImportErrors.slice(0,20).map(function(e){return '<div style="color:#666">第 '+e.row+' 行：'+esc(e.reason)+'</div>'}).join('');
      if(window._lastSkuImportErrors.length>20)html+='<div style="color:#999">还有 '+(window._lastSkuImportErrors.length-20)+' 条失败...</div>';
      html+='<button type="button" class="btn btn-secondary" style="margin-top:10px" onclick="downloadSkuImportErrors()">下载失败明细</button></div>';
    }
    html+='</div>';
    document.getElementById('si-result').innerHTML=html;
    showToast('导入完成：新增'+(res.created||0)+'，更新'+(res.updated||0)+'，失败'+(res.failed||0),res.failed>0?'warning':'success');
    loadSKUs();
  }catch(e){
    showToast(e.message||'导入失败','danger');
  }finally{
    btn.disabled=false;btn.textContent='开始导入';
  }
}

function downloadSkuImportErrors(){
  if(!window._lastSkuImportErrors||window._lastSkuImportErrors.length===0)return;
  var ws=XLSX.utils.aoa_to_sheet([['行号','失败原因']].concat(window._lastSkuImportErrors.map(function(e){return [e.row,e.reason]})));
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'失败明细');
  XLSX.writeFile(wb,'SKU导入失败明细.xlsx');
}

// ==================== 库存总表批量导入 ====================
// 日期字符串解析（用于导入）
function parseDateStr(v){
  if(!v)return '';
  if(v instanceof Date)return v.toISOString().slice(0,10);
  var s=String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  // 尝试解析其他格式
  var d=new Date(v);
  if(!isNaN(d))return d.toISOString().slice(0,10);
  return '';
}

const INV_IMPORT_COLUMNS=[
  {key:'sku_code',label:'SKU编码',required:true},
  {key:'brand',label:'品牌'},
  {key:'import_date',label:'导入日期',required:true},
  {key:'country',label:'国家'},
  {key:'warehouse',label:'仓库'},
  {key:'channel',label:'渠道'},
  {key:'available_qty',label:'可用数量',format:parseInt},
  {key:'weighted_avg_cost',label:'加权成本',format:parseFloat},
  {key:'last_inbound_date',label:'最后入库日期',format:parseDateStr},
  {key:'remark',label:'备注'}
];

function openInvBatchImport(){
  openModal('批量导入库存数据',
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div style="margin-bottom:12px;padding:12px 14px;background:#fff7e6;border:1px solid #ffd591;border-radius:6px;font-size:12px;color:#333">'+
        '<div style="font-weight:600;margin-bottom:6px">库存快照截止日期</div>'+
        '<div style="margin-bottom:8px;color:#666">当前导入的可用库存已经完整扣除出库数据的最后一天。例如今天是7月5日但当天还没结束，截止日期应填7月4日。<b style="color:#ff3b30">必填，不填写不允许导入。</b></div>'+
        '<input type="date" id="inv-snapshot-cutoff" style="padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;width:200px" onchange="window._invSnapshotDate=this.value;updateInvImportBtnState()">'+
      '</div>'+
      '<div id="inv-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s" '+
        'onclick="document.getElementById(\'inv-file-input\').click()" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
        'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handleInvFile(event.dataTransfer.files[0])">'+
        '<div style="font-size:48px;color:#1890ff;margin-bottom:8px">📦</div>'+
        '<div style="font-size:14px;color:#333;margin-bottom:4px">点击上传或拖拽文件到此处</div>'+
        '<div style="font-size:12px;color:#999">支持 .xlsx / .xls / .csv 格式</div>'+
      '</div>'+
      '<input type="file" id="inv-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleInvFile(this.files[0])">'+
      '<div id="inv-preview" style="margin-top:16px"></div>'+
      '<div id="inv-result" style="margin-top:16px"></div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="downloadInvTemplate()">下载模板</button>'+
    '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'+
    '<button class="btn btn-primary" id="inv-import-btn" onclick="submitInvBatchImport()" disabled>开始导入</button>'
  );
  window._invImportData=[];
  window._invSnapshotDate='';
}

function handleInvFile(file){
  if(!file)return;
  var ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){showToast('仅支持 .xlsx / .xls / .csv 格式','danger');return}
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=e.target.result;
      var wb;
      if(ext==='csv'){wb=XLSX.read(data,{type:'string',codepage:65001})}
      else{wb=XLSX.read(new Uint8Array(data),{type:'array',cellDates:true})}
      var ws=wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      if(rows.length<2){showToast('文件为空或缺少数据行','danger');return}
      var headers=rows[0].map(function(h){return String(h||'').trim()});
      var records=[];
      for(var i=1;i<rows.length;i++){
        var row=rows[i];
        if(!row||row.every(function(c){return !c||String(c).trim()===''}))continue;
        var rec={_rowNum:i+1,_errors:[]};
        INV_IMPORT_COLUMNS.forEach(function(col){
          var idx=headers.findIndex(function(h){return h===col.label||h===col.key});
          if(idx>=0&&row[idx]!==undefined&&row[idx]!==''){
            var val=row[idx];
            if(typeof val==='string')val=val.trim();
            if(col.format)val=col.format(val);
            rec[col.key]=val;
          }
        });
        if(!rec.sku_code||!String(rec.sku_code).trim())rec._errors.push('SKU编码不能为空');
        if(!rec.import_date)rec._errors.push('导入日期不能为空');
        else{
          if(rec.import_date instanceof Date)rec.import_date=formatDateISO(rec.import_date);
          else rec.import_date=String(rec.import_date).trim().slice(0,10);
        }
        records.push(rec);
      }
      window._invImportData=records;
      renderInvPreview(records);
      updateInvImportBtnState();
    }catch(err){showToast('文件解析失败：'+err.message,'danger')}
  };
  if(ext==='csv')reader.readAsText(file,'UTF-8');
  else reader.readAsArrayBuffer(file);
}

function renderInvPreview(records){
  var valid=records.filter(function(r){return r._errors.length===0}).length;
  var invalid=records.length-valid;
  var html='<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px"><b>共 '+records.length+' 条数据</b>，<span style="color:#52c41a">有效 '+valid+' 条</span>'+(invalid>0?'，<span style="color:#ff4d4f">无效 '+invalid+' 条</span>':'')+'</div>';
  html+='<div class="table-container" style="max-height:300px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>行</th><th>SKU编码</th><th>品牌</th><th>导入日期</th><th>国家</th><th>仓库</th><th>可用数量</th><th>加权成本</th><th>最后入库日期</th><th>校验</th></tr></thead><tbody>';
  records.slice(0,20).forEach(function(r){
    var ok=r._errors.length===0;
    html+='<tr style="'+(ok?'':'background:#fff1f0')+'">'+
      '<td>'+r._rowNum+'</td>'+
      '<td class="cell-id">'+esc(r.sku_code||'-')+'</td>'+
      '<td>'+esc(r.brand||'-')+'</td>'+
      '<td>'+esc(r.import_date||'-')+'</td>'+
      '<td>'+esc(r.country||'-')+'</td>'+
      '<td>'+esc(r.warehouse||'-')+'</td>'+
      '<td class="text-right">'+(r.available_qty!==undefined?r.available_qty:'-')+'</td>'+
      '<td class="text-right">'+(r.weighted_avg_cost!==undefined&&r.weighted_avg_cost!==''?r.weighted_avg_cost:'-')+'</td>'+
      '<td class="cell-date">'+esc(r.last_inbound_date||'-')+'</td>'+
      '<td>'+(ok?'<span class="status-badge status-completed">✓</span>':'<span class="status-badge status-danger" title="'+esc(r._errors.join('; '))+'">✗ '+r._errors.length+'</span>')+'</td>'+
    '</tr>';
  });
  if(records.length>20)html+='<tr><td colspan="10" style="text-align:center;color:#999;padding:8px">... 还有 '+(records.length-20)+' 条</td></tr>';
  html+='</tbody></table></div>';
  if(invalid>0){
    html+='<div style="margin-top:10px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666"><b>无效行明细：</b><br>'+
      records.filter(function(r){return r._errors.length>0}).slice(0,10).map(function(r){return '第 '+r._rowNum+' 行：'+r._errors.join('、')}).join('<br>')+
      (invalid>10?'<br>...':'')+'</div>';
  }
  document.getElementById('inv-preview').innerHTML=html;
}

function updateInvImportBtnState(){
  var records=window._invImportData||[];
  var hasValid=records.filter(function(r){return r._errors.length===0}).length>0;
  var hasDate=!!(window._invSnapshotDate||'');
  var btn=document.getElementById('inv-import-btn');
  if(btn){
    btn.disabled=!(hasValid&&hasDate);
    if(hasValid&&!hasDate){
      btn.textContent='请先填写快照截止日期';
    }else{
      btn.textContent='开始导入';
    }
  }
}

function downloadInvTemplate(){
  var headers=INV_IMPORT_COLUMNS.map(function(c){return c.label});
  var sample=[
    ['RD-K585-RGB','Redragon','2026-07-05','印尼','Jakarta仓','线上','350','85.50','2026-06-20',''],
    ['RD-M601-BK','Redragon','2026-07-05','印尼','Jakarta仓','线下','120','92.00','','']
  ];
  var ws=XLSX.utils.aoa_to_sheet([headers].concat(sample));
  ws['!cols']=INV_IMPORT_COLUMNS.map(function(c){return {wch:c.label.length*2+6}});
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'库存数据');
  XLSX.writeFile(wb,'库存数据_导入模板.xlsx');
}

async function submitInvBatchImport(){
  var records=window._invImportData||[];
  var valid=records.filter(function(r){return r._errors.length===0});
  if(valid.length===0){showToast('没有可导入的有效数据','danger');return}
  var snapshotDate=window._invSnapshotDate||'';
  if(!snapshotDate){showToast('请填写库存快照截止日期','danger');return}
  var btn=document.getElementById('inv-import-btn');
  btn.disabled=true;btn.textContent='导入中...';
  try{
    var items=valid.map(function(r){
      var o={};
      INV_IMPORT_COLUMNS.forEach(function(c){o[c.key]=r[c.key]!==undefined?r[c.key]:''});
      return o;
    });
    var res=await api('/api/inventory-imports/bulk-import','POST',{items:items,snapshot_cutoff_date:snapshotDate});
    window._lastInvImportErrors=res.errors||[];
    var html='<div style="background:'+(res.failed>0?'#fffbe6':'#f6ffed')+';border:1px solid '+(res.failed>0?'#ffe58f':'#b7eb8f')+';border-radius:8px;padding:14px 16px;font-size:13px">'+
      '<div style="font-weight:600;margin-bottom:8px">导入完成</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'+
        '<span>已新增：'+(res.created||0)+' 条</span>'+
        '<span>失败：'+(res.failed||0)+' 条</span>'+
        '<span style="color:#1890ff">快照截止日期：'+esc(res.snapshot_cutoff_date||snapshotDate)+'</span>'+
      '</div>';
    if(window._lastInvImportErrors.length>0){
      html+='<div style="margin-top:10px"><div style="font-weight:600;color:#ff3b30;margin-bottom:6px">失败明细</div>';
      html+=window._lastInvImportErrors.slice(0,20).map(function(e){return '<div style="color:#666">第 '+e.row+' 行：'+esc(e.reason)+'</div>'}).join('');
      if(window._lastInvImportErrors.length>20)html+='<div style="color:#999">还有 '+(window._lastInvImportErrors.length-20)+' 条失败...</div>';
      html+='<button type="button" class="btn btn-secondary" style="margin-top:10px" onclick="downloadInvImportErrors()">下载失败明细</button></div>';
    }
    html+='</div>';
    document.getElementById('inv-result').innerHTML=html;
    showToast('导入完成：新增'+(res.created||0)+'，失败'+(res.failed||0),res.failed>0?'warning':'success');
    loadInv();
  }catch(e){
    showToast(e.message||'导入失败','danger');
  }finally{
    btn.disabled=false;btn.textContent='开始导入';
  }
}

function downloadInvImportErrors(){
  if(!window._lastInvImportErrors||window._lastInvImportErrors.length===0)return;
  var ws=XLSX.utils.aoa_to_sheet([['行号','失败原因']].concat(window._lastInvImportErrors.map(function(e){return [e.row,e.reason]})));
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'失败明细');
  XLSX.writeFile(wb,'库存导入失败明细.xlsx');
}

// ==================== 销售数据批量导入 ====================
const SALES_IMPORT_COLUMNS=[
  {key:'source_system',label:'来源系统',required:true},
  {key:'order_no',label:'订单号',required:true},
  {key:'order_detail_id',label:'订单明细ID'},
  {key:'order_date',label:'下单日期',required:true},
  {key:'shop_platform',label:'渠道'},
  {key:'brand',label:'品牌'},
  {key:'sku_code',label:'SKU',required:true},
  {key:'quantity',label:'数量',required:true,format:parseInt},
  {key:'is_valid_order',label:'是否有效订单'},
  {key:'original_order_status',label:'原始订单状态'},
  {key:'remark',label:'备注'}
];

function openSalesBatchImport(){
  openModal('批量导入销售数据',
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div id="sales-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s" '+
        'onclick="document.getElementById(\'sales-file-input\').click()" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
        'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handleSalesFile(event.dataTransfer.files[0])">'+
        '<div style="font-size:48px;color:#1890ff;margin-bottom:8px">🛒</div>'+
        '<div style="font-size:14px;color:#333;margin-bottom:4px">点击上传或拖拽文件到此处</div>'+
        '<div style="font-size:12px;color:#999">支持 .xlsx / .xls / .csv 格式</div>'+
      '</div>'+
      '<input type="file" id="sales-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleSalesFile(this.files[0])">'+
      '<div style="margin-top:12px;padding:12px 14px;background:#f0f5ff;border:1px solid #adc6ff;border-radius:6px;font-size:12px;color:#333">'+
        '<div style="font-weight:600;margin-bottom:6px">导入说明</div>'+
        '<div style="line-height:1.8">'+
          '• <b>来源系统+订单号+SKU+渠道</b> 为唯一键，重复导入将自动更新而非新增<br>'+
          '• <b>是否有效订单=true</b> 的订单计入销量预测、周转月、补货建议<br>'+
          '• <b>是否有效订单=false</b> 的订单不计入预测，仅保留记录用于追溯<br>'+
          '• <b>原始订单状态</b> 仅用于追溯，不参与系统计算<br>'+
          '• 销售数据导入<b>不扣减库存</b>，库存以库存快照导入为准<br>'+
          '• 如有<b>订单明细ID</b>，优先按 来源系统+订单明细ID 去重'+
        '</div>'+
      '</div>'+
      '<div id="sales-preview-stats" style="margin-top:16px"></div>'+
      '<div id="sales-result" style="margin-top:16px"></div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="downloadSalesTemplate()">下载模板</button>'+
    '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'+
    '<button class="btn btn-primary" id="sales-import-btn" onclick="submitSalesBatchImport()" disabled>开始导入</button>'
  );
  window._salesImportData=[];
}

function handleSalesFile(file){
  if(!file)return;
  var ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){showToast('仅支持 .xlsx / .xls / .csv 格式','danger');return}
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=e.target.result;
      var wb;
      if(ext==='csv'){wb=XLSX.read(data,{type:'string',codepage:65001})}
      else{wb=XLSX.read(new Uint8Array(data),{type:'array',cellDates:true})}
      var ws=wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      if(rows.length<2){showToast('文件为空或缺少数据行','danger');return}
      var headers=rows[0].map(function(h){return String(h||'').trim()});
      var records=[];
      for(var i=1;i<rows.length;i++){
        var row=rows[i];
        if(!row||row.every(function(c){return !c||String(c).trim()===''}))continue;
        var rec={_rowNum:i+1,_errors:[]};
        SALES_IMPORT_COLUMNS.forEach(function(col){
          var idx=headers.findIndex(function(h){return h===col.label||h===col.key});
          if(idx>=0&&row[idx]!==undefined&&row[idx]!==''){
            var val=row[idx];
            if(typeof val==='string')val=val.trim();
            if(col.format)val=col.format(val);
            rec[col.key]=val;
          }
        });
        if(!rec.source_system||!String(rec.source_system).trim())rec._errors.push('来源系统不能为空');
        if(!rec.order_no||!String(rec.order_no).trim())rec._errors.push('订单号不能为空');
        if(!rec.sku_code||!String(rec.sku_code).trim())rec._errors.push('SKU不能为空');
        if(!rec.order_date)rec._errors.push('下单日期不能为空');
        else{
          if(rec.order_date instanceof Date)rec.order_date=formatDateISO(rec.order_date);
          else rec.order_date=String(rec.order_date).trim().slice(0,10);
        }
        if(rec.quantity===undefined||rec.quantity===null||isNaN(rec.quantity)||rec.quantity<=0)rec._errors.push('数量必须为正数');
        // is_valid_order 默认true
        if(rec.is_valid_order!==undefined&&rec.is_valid_order!==''){
          var v=String(rec.is_valid_order).toLowerCase().trim();
          rec.is_valid_order=(v==='true'||v==='1'||v==='是'||v==='有效')?1:0;
        }else{
          rec.is_valid_order=1;
        }
        records.push(rec);
      }
      window._salesImportData=records;
      renderSalesPreview(records);
      document.getElementById('sales-import-btn').disabled=records.filter(function(r){return r._errors.length===0}).length===0;
    }catch(err){showToast('文件解析失败：'+err.message,'danger')}
  };
  if(ext==='csv')reader.readAsText(file,'UTF-8');
  else reader.readAsArrayBuffer(file);
}

async function requestSalesPreview(){
  var records=window._salesImportData||[];
  var valid=records.filter(function(r){return r._errors.length===0});
  if(valid.length===0)return;
  var items=valid.map(function(r){
    var o={};
    SALES_IMPORT_COLUMNS.forEach(function(c){o[c.key]=r[c.key]!==undefined?r[c.key]:''});
    return o;
  });
  try{
    var res=await api('/api/sales-records/bulk-import-preview','POST',{items:items});
    var html='<div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:8px;padding:14px 16px;font-size:13px">'+
      '<div style="font-weight:600;margin-bottom:8px">导入预览统计</div>'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">'+
        '<span>总记录数：'+(res.preview.length)+'</span>'+
        '<span style="color:#52c41a">将新增：'+res.preview.filter(function(p){return p.action==='insert'}).length+'</span>'+
        '<span style="color:#1890ff">将更新：'+res.preview.filter(function(p){return p.action==='update'}).length+'</span>'+
        '<span style="color:#faad14">重复无变化：'+res.preview.filter(function(p){return p.action==='skip'}).length+'</span>'+
        '<span style="color:#ff3b30">异常失败：'+res.preview.filter(function(p){return p.errors.length>0}).length+'</span>'+
      '</div>';
    html+='</div>';
    var el=document.getElementById('sales-preview-stats');
    if(el){
      var oldPreview=el.querySelector('div[style*="overflow:auto"]');
      el.innerHTML=html+(oldPreview?oldPreview.outerHTML:'');
    }
    document.getElementById('sales-import-btn').disabled=false;
  }catch(e){
    showToast('预览失败: '+(e.message||''),'danger');
  }
}

function renderSalesPreview(records){
  var valid=records.filter(function(r){return r._errors.length===0}).length;
  var invalid=records.length-valid;
  var html='<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px"><b>共 '+records.length+' 条数据</b>，<span style="color:#52c41a">有效 '+valid+' 条</span>'+(invalid>0?'，<span style="color:#ff4d4f">无效 '+invalid+' 条</span>':'')+'</div>';
  html+='<div class="table-container" style="max-height:300px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>行</th><th>来源系统</th><th>订单号</th><th>下单日期</th><th>SKU</th><th>数量</th><th>有效订单</th><th>校验</th></tr></thead><tbody>';
  records.slice(0,20).forEach(function(r){
    var ok=r._errors.length===0;
    html+='<tr style="'+(ok?'':'background:#fff1f0')+'">'+
      '<td>'+r._rowNum+'</td>'+
      '<td>'+esc(r.source_system||'-')+'</td>'+
      '<td class="cell-id">'+esc(r.order_no||'-')+'</td>'+
      '<td>'+esc(r.order_date||'-')+'</td>'+
      '<td class="cell-id">'+esc(r.sku_code||'-')+'</td>'+
      '<td class="text-right">'+(r.quantity!==undefined?r.quantity:'-')+'</td>'+
      '<td>'+(r.is_valid_order?'<span style="color:#52c41a">是</span>':'<span style="color:#999">否</span>')+'</td>'+
      '<td>'+(ok?'<span class="status-badge status-completed">✓</span>':'<span class="status-badge status-danger" title="'+esc(r._errors.join('; '))+'">✗ '+r._errors.length+'</span>')+'</td>'+
    '</tr>';
  });
  if(records.length>20)html+='<tr><td colspan="8" style="text-align:center;color:#999;padding:8px">... 还有 '+(records.length-20)+' 条</td></tr>';
  html+='</tbody></table></div>';
  if(invalid>0){
    html+='<div style="margin-top:10px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666"><b>无效行明细：</b><br>'+
      records.filter(function(r){return r._errors.length>0}).slice(0,10).map(function(r){return '第 '+r._rowNum+' 行：'+r._errors.join('、')}).join('<br>')+
      (invalid>10?'<br>...':'')+'</div>';
  }
  document.getElementById('sales-preview-stats').innerHTML=html;
  if(valid>0) requestSalesPreview();
}

function downloadSalesTemplate(){
  var headers=SALES_IMPORT_COLUMNS.map(function(c){return c.label});
  var sample=[
    ['BigSeller','BS-2026-001234','','2026-06-15','Shopee印尼店','BOYA','BY-M1',30,'true','Shipped','正常订单'],
    ['至速','ZS-2026-005678','','2026-06-15','Lazada马来店','BOYA','BY-M1000',15,'true','Delivered',''],
    ['EDA','EDA-2026-009999','DTL-001','2026-06-14','TikTok泰国店','BOYA','BY-WM8 Pro',8,'false','Cancelled','取消订单不计入预测']
  ];
  var ws=XLSX.utils.aoa_to_sheet([headers].concat(sample));
  ws['!cols']=SALES_IMPORT_COLUMNS.map(function(c){return {wch:c.label.length*2+6}});
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'销售数据');
  XLSX.writeFile(wb,'销售数据_导入模板.xlsx');
}

async function submitSalesBatchImport(){
  var records=window._salesImportData||[];
  var valid=records.filter(function(r){return r._errors.length===0});
  if(valid.length===0){showToast('没有可导入的有效数据','danger');return}
  var btn=document.getElementById('sales-import-btn');
  btn.disabled=true;btn.textContent='导入中...';
  try{
    var items=valid.map(function(r){
      var o={};
      SALES_IMPORT_COLUMNS.forEach(function(c){o[c.key]=r[c.key]!==undefined?r[c.key]:''});
      return o;
    });
    var res=await api('/api/sales-records/bulk-import','POST',{items:items});
    window._lastSalesImportErrors=res.errors||[];
    var html='<div style="background:'+(res.failed>0?'#fffbe6':'#f6ffed')+';border:1px solid '+(res.failed>0?'#ffe58f':'#b7eb8f')+';border-radius:8px;padding:14px 16px;font-size:13px">'+
      '<div style="font-weight:600;margin-bottom:8px">导入完成报告</div>'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">'+
        '<span>总行数：'+(res.total||0)+' 条</span>'+
        '<span style="color:#52c41a">新增：'+(res.inserted||0)+' 条</span>'+
        '<span style="color:#1890ff">更新：'+(res.updated||0)+' 条</span>'+
        '<span style="color:#faad14">重复无变化：'+(res.skipped||0)+' 条</span>'+
        '<span style="color:#ff3b30">失败：'+(res.failed||0)+' 条</span>'+
      '</div>';
    if(window._lastSalesImportErrors.length>0){
      html+='<div style="margin-top:10px"><div style="font-weight:600;color:#ff3b30;margin-bottom:6px">失败明细</div>';
      html+=window._lastSalesImportErrors.slice(0,20).map(function(e){return '<div style="color:#666">第 '+e.row+' 行：'+esc(e.reason)+'</div>'}).join('');
      if(window._lastSalesImportErrors.length>20)html+='<div style="color:#999">还有 '+(window._lastSalesImportErrors.length-20)+' 条失败...</div>';
      html+='<button type="button" class="btn btn-secondary" style="margin-top:10px" onclick="downloadSalesImportErrors()">下载失败明细</button></div>';
    }
    html+='</div>';
    document.getElementById('sales-result').innerHTML=html;
    showToast('导入完成：新增'+(res.inserted||0)+'，更新'+(res.updated||0)+'，重复'+(res.skipped||0)+'，失败'+(res.failed||0),res.failed>0?'warning':'success');
    loadSales();
  }catch(e){
    showToast(e.message||'导入失败','danger');
  }finally{
    btn.disabled=false;btn.textContent='开始导入';
  }
}

function downloadSalesImportErrors(){
  if(!window._lastSalesImportErrors||window._lastSalesImportErrors.length===0)return;
  var ws=XLSX.utils.aoa_to_sheet([['行号','失败原因']].concat(window._lastSalesImportErrors.map(function(e){return [e.row,e.reason]})));
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'失败明细');
  XLSX.writeFile(wb,'销售导入失败明细.xlsx');
}

// ==================== 库存总表 ====================
let invDataCache = [];
let invAllFilteredIds = [];
let invSelectAllMode = false;

const INV_STATUS_OPTS = [
  {val:'normal',label:'正常'},{val:'out_of_stock_risk',label:'断货风险'},
  {val:'high_stock',label:'高库存'},{val:'slow_moving',label:'慢销'},
  {val:'clearance',label:'清仓'},{val:'abnormal',label:'异常'}
];
function invStatusLabel(v){const o=INV_STATUS_OPTS.find(x=>x.val===v);return o?o.label:v||'-';}
function invStatusBadge(v){
  const cls={'normal':'status-normal','out_of_stock_risk':'status-danger','high_stock':'status-warning','slow_moving':'status-warning','clearance':'status-warning','abnormal':'status-danger'}[v]||'status-normal';
  return '<span class="status-badge '+cls+'">'+invStatusLabel(v)+'</span>';
}

async function renderInventory(){
  invDataCache = []; invAllFilteredIds = []; invSelectAllMode = false;
  document.getElementById('content-inner').innerHTML=
    '<div id="flash-container"></div>'
    +'<div class="filter-bar"><div class="filter-form">'
    +'<div class="filter-group"><label>国家</label><select id="inv-c"><option value="">全部</option></select></div>'
    +'<div class="filter-group"><label>仓库</label><select id="inv-w"><option value="">全部</option></select></div>'
    +'<div class="filter-group"><label>品牌</label><select id="inv-b"><option value="">全部</option></select></div>'
    +'<div class="filter-group"><label>关键词</label><input type="text" id="inv-k" placeholder="SKU/产品名" onkeypress="if(event.key===\'Enter\')loadInv()"></div>'
    +'<div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadInv()">搜索</button>'
    +(hasPermission('inventory_import')?'<button class="btn btn-secondary btn-sm" onclick="openInvBatchImport()">📥 导入库存</button>':'')
    +'</div></div></div>'
    // 批量操作栏（默认隐藏）
    +'<div id="inv-batch-bar" style="display:none;background:var(--bg-card,#fff);border:1px solid var(--border,#e0e0e0);border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    +'<span id="inv-batch-count" style="font-weight:600;margin-right:8px"></span>'
    +'<button class="btn btn-sm btn-secondary" onclick="invBatchAction(\'export\')">📊 导出</button>'
    +'<button class="btn btn-sm btn-secondary" onclick="invBatchAction(\'set_status\')">🏷️ 库存状态</button>'
    +'<button class="btn btn-sm btn-secondary" onclick="invBatchAction(\'set_focused\')">⭐ 重点关注</button>'
    +'<button class="btn btn-sm btn-secondary" onclick="invBatchAction(\'set_safety_stock\')">🛡️ 安全库存</button>'
    +'<button class="btn btn-sm btn-secondary" onclick="invBatchAction(\'set_turnover\')">🎯 目标周转</button>'
    +'<button class="btn btn-sm btn-secondary" onclick="invBatchAction(\'set_replenish_rule\')">📋 补货规则</button>'
    +'<button class="btn btn-sm btn-secondary" onclick="invBatchAction(\'set_remark\')">📝 库存备注</button>'
    +'<button class="btn btn-sm btn-warning" onclick="invBatchAction(\'inventory_adjust\')">🔧 发起调整单</button>'
    +'<button class="btn btn-sm btn-danger" onclick="invBatchAction(\'delete\')" style="background:#ff4d4f;color:#fff;border:none">🗑️ 删除</button>'
    +'<button class="btn btn-sm btn-secondary" onclick="invClearSelection()" style="margin-left:auto">取消选择</button>'
    +'</div>'
    +'<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📦 库存总表</div><div class="table-section-title-right" id="inv-rate-display" style="font-size:12px;color:#666;display:flex;gap:12px;align-items:center"></div></div><div id="inv-table"></div></div>';
  // 加载下拉选项
  try{
    const opts=await api('/api/inventory/filter-options');
    const fc=document.getElementById('inv-c'), fw=document.getElementById('inv-w'), fb=document.getElementById('inv-b');
    if(fc) opts.countries.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;fc.appendChild(o);});
    if(fw) opts.warehouses.forEach(w=>{const o=document.createElement('option');o.value=w;o.textContent=w;fw.appendChild(o);});
    if(fb) opts.brands.forEach(b=>{const o=document.createElement('option');o.value=b;o.textContent=b;fb.appendChild(o);});
  }catch(e){console.warn('filter-options load failed',e)}
  loadInv();
}

async function loadInv(){
  try{
    const c=document.getElementById('inv-c')?.value||'',w=document.getElementById('inv-w')?.value||'',b=document.getElementById('inv-b')?.value||'',k=document.getElementById('inv-k')?.value||'';
    const [data, rateInfo] = await Promise.all([
      api('/api/inventory?country='+encodeURIComponent(c)+'&warehouse='+encodeURIComponent(w)+'&brand='+encodeURIComponent(b)+'&keyword='+encodeURIComponent(k)),
      api('/api/inventory/currency-rates')
    ]);
    window._invRateInfo = rateInfo; // 缓存供导出使用
    invDataCache = data;
    invAllFilteredIds = data.map(d=>d.id);
    invSelectAllMode = false;
    updateInvBatchBar();

    // 构建国家→货币信息映射
    // 后端 rate 现在是 cnyToForeign（1 CNY = X 本国货币）
    const countryCurrency = {}; // country -> {code, symbol, rate}
    (rateInfo.countries||[]).forEach(function(co){
      var curr = co.default_currency || '';
      var rateObj = (rateInfo.rates||{})[curr];
      countryCurrency[co.country] = {
        code: curr,
        symbol: co.symbol || '',
        name: co.currency_name || '',
        rate: rateObj ? rateObj.rate : null, // cnyToForeign: 1 CNY = X 本国货币
        rateDate: rateObj ? rateObj.date : ''
      };
    });

    // 显示汇率信息在标题右侧：CNY:IDR  1¥ = X IDR
    var rateRowsHtml = '';
    var shownCurrencies = {};
    Object.values(countryCurrency).forEach(function(ci){
      if(ci.code && !shownCurrencies[ci.code]){
        shownCurrencies[ci.code] = true;
        if(ci.rate){
          var rateStr = Number(ci.rate).toLocaleString('en-US',{maximumFractionDigits:4});
          rateRowsHtml += '<div style="background:#f0f8ff;padding:3px 10px;border-radius:12px;white-space:nowrap">CNY:' + esc(ci.code) + '　1 ¥ = ' + rateStr + ' ' + esc(ci.symbol||ci.code) + '</div>';
        } else {
          rateRowsHtml += '<div style="background:#fff4e6;padding:3px 10px;border-radius:12px;white-space:nowrap;color:#ff4d4f">CNY:' + esc(ci.code) + '　无汇率</div>';
        }
      }
    });
    if(rateRowsHtml){
      rateRowsHtml = '<span style="color:#999;margin-right:4px;align-self:center">汇率(' + (rateInfo.rate_date||'') + '):</span>'
        + '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">' + rateRowsHtml + '</div>'
        + '<button class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:11px;margin-left:6px;align-self:center" onclick="refreshInvRates()">🔄 刷新</button>';
    }
    var rateEl = document.getElementById('inv-rate-display');
    if(rateEl) rateEl.innerHTML = rateRowsHtml;

    // 格式化带货币符号的金额
    function fmtLocalMoney(val, country){
      var ci = countryCurrency[country];
      var sym = ci ? ci.symbol : '';
      return (sym ? sym + ' ' : '') + Number(val||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    }
    function fmtCnyMoney(localVal, country){
      var ci = countryCurrency[country];
      if(!ci || !ci.rate) return '<span style="color:#ccc">-</span>';
      // rate 是 cnyToForeign (1 CNY = X 本国货币)，所以 CNY = 本币 / rate
      var cnyVal = Number(localVal||0) / ci.rate;
      return '¥ ' + cnyVal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    }

    // 列顺序：复选框 | SKU | 国家 | 仓库 | 品牌 | 可用 | 安全库存 | 在途 | PI未发 | PO未确 | 加权成本 | 库存金额(本币) | 库存金额(¥) | 目标周转 | 实际周转 | 最后入库 | 距最后入库天数 | 库龄风险 | 库存快照截止 | 最后出库 | 库存状态 | 重点关注 | 备注
    // (产品名从列表移除——SKU已可识别，可悬停tooltip或在详情中看)
    const cols = ['SKU','国家','仓库','品牌','可用','安全库存','在途','PI未发','PO未确','加权成本','库存金额(本币)','库存金额(¥)','目标周转','实际周转','最后入库','距最后入库天数','库龄风险','首次入库','库存快照截止','最后出库','库存状态','重点关注','备注'];
    document.getElementById('inv-table').innerHTML='<div class="table-container" style="box-shadow:none;border-radius:0;max-width:100%"><table class="data-table"><thead><tr>'
      +'<th class="col-sticky" style="width:32px;left:0;background:#fafbfc"><input type="checkbox" id="inv-check-all" onchange="toggleAllInv(this.checked)"></th>'
      +'<th class="col-sticky" style="white-space:nowrap;left:32px;background:#fafbfc">SKU<br><a href="javascript:void(0)" onclick="selectAllInvFiltered()" style="font-size:11px;color:var(--primary,#2e7d32)">全选全部('+invAllFilteredIds.length+')</a></th>'
      +cols.slice(1).map(h=>'<th>'+h+'</th>').join('')
      +'</tr></thead><tbody>'
      +(!data.length?'<tr><td colspan="'+(cols.length+1)+'" style="text-align:center;padding:30px;color:#999">暂无库存数据</td></tr>'
      :data.map(i=>{
        var invVal = (i.available_qty||0)*(i.weighted_avg_cost||0);
        // 计算距最后入库天数和库龄风险
        var daysSinceLastInbound = '-';
        var agingRisk = '-';
        var agingRiskClass = '';
        if(i.last_inbound_date && String(i.last_inbound_date).trim()){
          var d = new Date(i.last_inbound_date);
          if(!isNaN(d)){
            var diffMs = new Date() - d;
            var diffDays = Math.floor(diffMs / (1000*60*60*24));
            daysSinceLastInbound = diffDays;
            if(diffDays <= 90){agingRisk='正常';agingRiskClass='status-completed';}
            else if(diffDays <= 180){agingRisk='关注';agingRiskClass='status-warning';}
            else if(diffDays <= 365){agingRisk='高库龄';agingRiskClass='status-danger';}
            else{agingRisk='超高库龄';agingRiskClass='status-danger';}
          }
        } else {
          agingRisk = '未知';
          agingRiskClass = 'status-warning';
        }
        return '<tr>'
        +'<td class="col-sticky" style="left:0;background:var(--card-bg,#fff)"><input type="checkbox" class="inv-check" value="'+esc(i.id)+'" onchange="updateInvBatchBar()"></td>'
        +'<td class="col-sticky cell-id" style="left:32px;background:var(--card-bg,#fff)" title="'+esc(i.product_name||'')+'">'+esc(i.sku_code)+'</td>'
        +'<td>'+esc(i.country)+'</td>'
        +'<td>'+esc(i.warehouse)+'</td>'
        +'<td>'+esc(i.brand)+'</td>'
        +'<td class="text-right font-bold">'+(i.available_qty||0)+'</td>'
        +'<td class="text-right">'+(i.safety_stock||0)+'</td>'
        +'<td class="text-right">'+(i.in_transit_qty||0)+'</td>'
        +'<td class="text-right">'+(i.pi_confirmed_unshipped_qty||0)+'</td>'
        +'<td class="text-right">'+(i.po_unconfirmed_pi_qty||0)+'</td>'
        +'<td class="text-right">'+fmtMoney(i.weighted_avg_cost)+'</td>'
        +'<td class="text-right" style="white-space:nowrap">'+fmtLocalMoney(invVal, i.country)+'</td>'
        +'<td class="text-right" style="white-space:nowrap;color:#d48806">'+fmtCnyMoney(invVal, i.country)+'</td>'
        +'<td class="text-right">'+(i.target_turnover_months||0)+'</td>'
        +'<td class="text-right">'+(i.turnover_months||0)+'</td>'
        +'<td class="cell-date">'+fmtDate(i.last_inbound_date)+'</td>'
        +'<td class="text-right">'+(daysSinceLastInbound!=='-'?daysSinceLastInbound+'天':'未知')+'</td>'
        +'<td><span class="status-badge '+agingRiskClass+'">'+agingRisk+'</span></td>'
        +'<td class="cell-date">'+fmtDate(i.first_inbound_date)+'</td>'
        +'<td class="cell-date">'+fmtDate(i.snapshot_cutoff_date)+'</td>'
        +'<td class="cell-date">'+fmtDate(i.last_outbound_date)+'</td>'
        +'<td>'+invStatusBadge(i.inventory_status)+'</td>'
        +'<td>'+(i.is_focused?'⭐':'')+'</td>'
        +'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="'+esc(i.inventory_remark||'')+'">'+esc(i.inventory_remark||'')+'</td>'
      +'</tr>';
      }).join(''))
      +'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

async function refreshInvRates(){
  try{
    // 删除今天的缓存汇率，强制重新从API获取
    await api('/api/exchange-rates/refresh','POST',{});
    showToast('汇率已刷新','success');
    loadInv();
  }catch(e){
    // 如果没有refresh接口，直接重新加载（会从DB取或重新获取）
    showToast('正在刷新汇率...','info');
    loadInv();
  }
}

function invGetSelectedIds(){
  if(invSelectAllMode) return invAllFilteredIds;
  return Array.from(document.querySelectorAll('.inv-check:checked')).map(cb=>cb.value);
}

function toggleAllInv(checked){
  document.querySelectorAll('.inv-check').forEach(cb=>cb.checked=checked);
  invSelectAllMode = false;
  updateInvBatchBar();
}

function selectAllInvFiltered(){
  invSelectAllMode = true;
  document.querySelectorAll('.inv-check').forEach(cb=>cb.checked=true);
  document.getElementById('inv-check-all').checked = true;
  updateInvBatchBar();
}

function invClearSelection(){
  document.querySelectorAll('.inv-check').forEach(cb=>cb.checked=false);
  const cba=document.getElementById('inv-check-all'); if(cba) cba.checked=false;
  invSelectAllMode = false;
  updateInvBatchBar();
}

function updateInvBatchBar(){
  const ids = invGetSelectedIds();
  const bar = document.getElementById('inv-batch-bar');
  if(!bar) return;
  if(ids.length === 0){ bar.style.display='none'; return; }
  bar.style.display='flex';
  const countEl = document.getElementById('inv-batch-count');
  if(countEl) countEl.textContent = '已选择 '+ids.length+' 条'+(invSelectAllMode?'（全部筛选结果）':'');
}

async function invBatchAction(action){
  const ids = invGetSelectedIds();
  if(ids.length === 0){ showToast('请先选择记录','warning'); return; }

  // 预览
  let preview;
  try { preview = await api('/api/inventory/batch-preview','POST',{ids}); }
  catch(e){ showFlash(e.message,'danger'); return; }

  if(action === 'export'){
    // 导出不需要确认弹窗，直接导出
    invBatchExport(ids);
    return;
  }

  // 弹出操作确认+参数输入
  const modalHtml = invBuildBatchModal(action, preview);
  showModal(modalHtml);
}

function invBuildBatchModal(action, preview){
  const previewHtml = '<div style="background:var(--bg-hover,#f5f5f5);border-radius:8px;padding:12px;margin-bottom:16px">'
    +'<div style="font-weight:600;margin-bottom:8px">📋 操作预览</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">'
    +'<div>影响记录数: <b>'+preview.total_records+'</b></div>'
    +'<div>涉及SKU数: <b>'+preview.sku_count+'</b></div>'
    +'<div>涉及库存数量: <b>'+(preview.total_available_qty||0)+'</b></div>'
    +'<div>涉及国家: <b>'+preview.countries.join(', ')+'</b></div>'
    +'<div>涉及仓库: <b>'+preview.warehouses.join(', ')+'</b></div>'
    +'</div></div>';

  let inputHtml = '';
  let title = '';
  let danger = false;

  if(action === 'set_status'){
    title = '批量设置库存状态';
    inputHtml = '<div class="form-group"><label>库存状态</label><select id="batch-val" class="form-control">'+INV_STATUS_OPTS.map(o=>'<option value="'+o.val+'">'+o.label+'</option>').join('')+'</select></div>';
  } else if(action === 'set_focused'){
    title = '批量设置重点关注';
    inputHtml = '<div class="form-group"><label>是否重点关注</label><select id="batch-val" class="form-control"><option value="1">⭐ 设为重点关注</option><option value="0">取消重点关注</option></select></div>';
  } else if(action === 'set_safety_stock'){
    title = '批量设置安全库存';
    inputHtml = '<div class="form-group"><label>安全库存数量</label><input type="number" id="batch-val" class="form-control" min="0" placeholder="请输入安全库存数量"></div>';
  } else if(action === 'set_turnover'){
    title = '批量设置目标周转月数';
    inputHtml = '<div class="form-group"><label>目标周转月数</label><input type="number" id="batch-val" class="form-control" min="0" step="0.5" placeholder="如: 2, 3, 4"></div>';
  } else if(action === 'set_replenish_rule'){
    title = '批量设置补货规则';
    inputHtml = '<div class="form-group"><label>补货规则</label><select id="batch-val" class="form-control"><option value="auto">自动补货</option><option value="manual">手动补货</option><option value="stop">停止补货</option><option value="">清空规则</option></select></div>';
  } else if(action === 'set_remark'){
    title = '批量设置库存备注';
    inputHtml = '<div class="form-group"><label>库存备注</label><textarea id="batch-val" class="form-control" rows="3" placeholder="请输入备注内容"></textarea></div>';
  } else if(action === 'inventory_adjust'){
    title = '批量发起库存调整单';
    danger = true;
    inputHtml = '<div class="form-group"><label>调整类型</label><select id="batch-val" class="form-control"><option value="manual">手工调整</option><option value="correction">库存纠正</option><option value="loss">盘亏</option><option value="gain">盘盈</option></select></div>'
      +'<div class="form-group"><label>调整原因（必填）</label><textarea id="batch-reason" class="form-control" rows="3" placeholder="请说明调整原因" required></textarea></div>';
  } else if(action === 'delete'){
    title = '批量删除库存';
    danger = true;
    inputHtml = '<div class="form-group"><label>删除原因（必填，将记录到操作日志）</label><textarea id="batch-reason" class="form-control" rows="3" placeholder="如：清理测试数据" required></textarea></div>'
      +'<div style="background:#fff1f0;border:1px solid #ffccc7;border-radius:6px;padding:10px;font-size:12px;color:#a8071a">⚠️ 若记录已关联库存导入/出库/调整单，将被跳过不允许删除。</div>';
  }

  const reasonHtml = action !== 'inventory_adjust' ? '<div class="form-group"><label>操作原因（选填）</label><input type="text" id="batch-reason" class="form-control" placeholder="操作原因"></div>' : '';

  return '<div class="modal-header"><h3>'+(danger?'⚠️ ':'')+title+'</h3><button class="modal-close" onclick="closeModal()">×</button></div>'
    +'<div class="modal-body">'
    +previewHtml
    +inputHtml
    +reasonHtml
    +'<div style="margin-top:16px;padding:10px;background:#fff3cd;border-radius:6px;font-size:12px;color:#856404">⚠️ 批量操作将逐条执行，异常数据自动跳过，执行完成后展示结果报告'+(danger?'。此操作为高影响操作，请确认后执行。':'')+'</div>'
    +'</div>'
    +'<div class="modal-footer">'
    +'<button class="btn btn-secondary" onclick="closeModal()">取消</button>'
    +'<button class="btn '+(danger?'btn-danger':'btn-primary')+'" onclick="invBatchExecute(\''+action+'\')">'+(danger?'确认执行':'执行')+'</button>'
    +'</div>';
}

async function invBatchExecute(action){
  const ids = invGetSelectedIds();
  const val = document.getElementById('batch-val')?.value;
  const reason = document.getElementById('batch-reason')?.value || '';

  if(action === 'set_safety_stock' && (!val || val < 0)){ showToast('请输入有效的安全库存','warning'); return; }
  if(action === 'set_turnover' && (!val || val < 0)){ showToast('请输入有效的目标周转月数','warning'); return; }
  if(action === 'inventory_adjust' && !reason){ showToast('调整原因不能为空','warning'); return; }
  if(action === 'delete' && !reason.trim()){ showToast('删除原因不能为空','warning'); return; }

  const apiMap = {
    'set_status': ['/api/inventory/batch-set-status', {ids, status:val, reason}],
    'set_focused': ['/api/inventory/batch-set-focused', {ids, is_focused: parseInt(val), reason}],
    'set_safety_stock': ['/api/inventory/batch-set-safety-stock', {ids, safety_stock: parseInt(val), reason}],
    'set_turnover': ['/api/inventory/batch-set-turnover', {ids, target_turnover_months: parseFloat(val), reason}],
    'set_replenish_rule': ['/api/inventory/batch-set-replenish-rule', {ids, replenishment_rule: val, reason}],
    'set_remark': ['/api/inventory/batch-set-remark', {ids, inventory_remark: val, reason}],
    'inventory_adjust': ['/api/inventory/batch-adjust', {ids, adjust_type: val, reason}],
    'delete': ['/api/inventory/batch-delete', {ids, reason}],
  };

  const [url, body] = apiMap[action];
  closeModal();
  showFlash('正在执行批量操作...','info');

  try {
    const result = await api(url, 'POST', body);
    showBatchResultModal(result, 'inventory');
    invClearSelection();
    loadInv();
  } catch(e) {
    showFlash('批量操作失败: '+e.message, 'danger');
  }
}

function invBatchExport(ids){
  const data = invDataCache.filter(d => ids.includes(d.id));
  const headers = ['SKU','产品名','品牌','国家','仓库','可用库存','安全库存','在途','PI未发','PO未确','加权成本','库存金额(本币)','库存金额(人民币)','目标周转月','实际周转月','最后入库','最后出库','库存状态','重点关注','备注'];
  const rows = data.map(d => {
    var invVal = (d.available_qty||0)*(d.weighted_avg_cost||0);
    // 从缓存获取汇率信息
    var rateInfo = window._invRateInfo || {};
    var countryCurrency = {};
    (rateInfo.countries||[]).forEach(function(co){
      var curr = co.default_currency || '';
      var rateObj = (rateInfo.rates||{})[curr];
      countryCurrency[co.country] = { code: curr, symbol: co.symbol || '', rate: rateObj ? rateObj.rate : null };
    });
    var ci = countryCurrency[d.country] || {};
    // rate 是 cnyToForeign (1 CNY = X 本国货币)，所以 CNY = 本币 / rate
    var cnyVal = ci.rate ? (invVal / ci.rate) : 0;
    return [
      d.sku_code, d.product_name||'', d.brand||'', d.country||'', d.warehouse||'',
      d.available_qty||0, d.safety_stock||0, d.in_transit_qty||0,
      d.pi_confirmed_unshipped_qty||0, d.po_unconfirmed_pi_qty||0,
      d.weighted_avg_cost||0, invVal, cnyVal,
      d.target_turnover_months||0, d.turnover_months||0,
      d.last_inbound_date||'', d.last_outbound_date||'',
      invStatusLabel(d.inventory_status), d.is_focused?'是':'', d.inventory_remark||''
    ];
  });
  if(typeof XLSX === 'undefined'){ showFlash('XLSX库未加载','danger'); return; }
  const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '库存总表');
  XLSX.writeFile(wb, '库存总表导出_'+new Date().toISOString().slice(0,10)+'.xlsx');
}

// ==================== 销售数据 ====================
let salesDataCache = [];
let salesAllFilteredIds = [];
let salesSelectAllMode = false;

async function renderOutbound(){
  salesDataCache = []; salesAllFilteredIds = []; salesSelectAllMode = false;
  document.getElementById('content-inner').innerHTML=
    '<div id="flash-container"></div>'
    +'<div class="filter-bar"><div class="filter-form">'
    +'<div class="filter-group"><label>来源系统</label><select id="sr-ss"><option value="">全部</option></select></div>'
    +'<div class="filter-group"><label>渠道</label><select id="sr-sp"><option value="">全部</option></select></div>'
    +'<div class="filter-group"><label>品牌</label><select id="sr-b"><option value="">全部</option></select></div>'
    +'<div class="filter-group"><label>有效订单</label><select id="sr-iv"><option value="">全部</option><option value="1">有效</option><option value="0">无效</option></select></div>'
    +'<div class="filter-group"><label>开始日期</label><input type="date" id="sr-sd" class="form-control"></div>'
    +'<div class="filter-group"><label>结束日期</label><input type="date" id="sr-ed" class="form-control"></div>'
    +'<div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadSales()">搜索</button>'
    +(hasPermission('outbound_import')?'<button class="btn btn-secondary btn-sm" onclick="openSalesBatchImport()">📥 导入</button>':'')
    +'</div></div></div>'
    // 批量操作栏
    +'<div id="sr-batch-bar" style="display:none;background:var(--bg-card,#fff);border:1px solid var(--border,#e0e0e0);border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    +'<span id="sr-batch-count" style="font-weight:600;margin-right:8px"></span>'
    +'<button class="btn btn-sm btn-secondary" onclick="salesBatchExport()">📊 导出</button>'
    +'<button class="btn btn-sm btn-secondary" onclick="salesClearSelection()" style="margin-left:auto">取消选择</button>'
    +'</div>'
    +'<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🛒 销售明细</div></div><div id="sr-table"></div></div>';
  // 加载下拉选项
  try{
    const opts=await api('/api/sales-records/filter-options');
    const fss=document.getElementById('sr-ss'), fsp=document.getElementById('sr-sp'), fb=document.getElementById('sr-b');
    if(fss) opts.source_systems.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;fss.appendChild(o);});
    if(fsp) opts.shop_platforms.forEach(w=>{const o=document.createElement('option');o.value=w;o.textContent=w;fsp.appendChild(o);});
    if(fb) opts.brands.forEach(b=>{const o=document.createElement('option');o.value=b;o.textContent=b;fb.appendChild(o);});
  }catch(e){console.warn('sales filter-options load failed',e)}
  loadSales();
}

async function loadSales(){
  try{
    const ss=document.getElementById('sr-ss')?.value||'',sp=document.getElementById('sr-sp')?.value||'',b=document.getElementById('sr-b')?.value||'',iv=document.getElementById('sr-iv')?.value||'',sd=document.getElementById('sr-sd')?.value||'',ed=document.getElementById('sr-ed')?.value||'';
    let url='/api/sales-records?source_system='+encodeURIComponent(ss)+'&shop_platform='+encodeURIComponent(sp)+'&brand='+encodeURIComponent(b)+'&is_valid='+iv;
    if(sd) url+='&start_date='+sd;
    if(ed) url+='&end_date='+ed;
    const data=await api(url);
    salesDataCache = data;
    salesAllFilteredIds = data.map(d=>d.id);
    salesSelectAllMode = false;
    updateSalesBatchBar();
    const cols = ['来源系统','订单号','下单日期','渠道','品牌','SKU','产品名','数量','有效订单','原始订单状态','备注'];
    document.getElementById('sr-table').innerHTML='<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr>'
      +'<th style="width:32px"><input type="checkbox" id="sr-check-all" onchange="toggleAllSales(this.checked)"></th>'
      +'<th style="white-space:nowrap"><a href="javascript:void(0)" onclick="selectAllSalesFiltered()" style="font-size:11px;color:var(--primary,#2e7d32)">全选全部('+salesAllFilteredIds.length+')</a></th>'
      +cols.slice(1).map(h=>'<th>'+h+'</th>').join('')
      +'</tr></thead><tbody>'
      +(!data.length?'<tr><td colspan="'+(cols.length+1)+'" style="text-align:center;padding:30px;color:#999">暂无数据</td></tr>'
      :data.map(r=>'<tr'+(r.is_valid_order?'':' style="opacity:0.5"')+'>'
        +'<td><input type="checkbox" class="sr-check" value="'+esc(r.id)+'" onchange="updateSalesBatchBar()"></td>'
        +'<td>'+esc(r.source_system||'-')+'</td>'
        +'<td class="cell-id">'+esc(r.order_no||'-')+'</td>'
        +'<td class="cell-date">'+fmtDate(r.order_date)+'</td>'
        +'<td>'+esc(r.shop_platform||'-')+'</td>'
        +'<td>'+esc(r.brand||'-')+'</td>'
        +'<td class="cell-id">'+esc(r.sku_code)+'</td>'
        +'<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.product_name||'')+'">'+esc(r.product_name||'-')+'</td>'
        +'<td class="text-right font-bold">'+r.quantity+'</td>'
        +'<td>'+(r.is_valid_order?'<span style="color:#52c41a">✅ 有效</span>':'<span style="color:#999">❌ 无效</span>')+'</td>'
        +'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.original_order_status||'')+'">'+esc(r.original_order_status||'-')+'</td>'
        +'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.remark||'')+'">'+esc(r.remark||'')+'</td>'
      +'</tr>').join(''))
      +'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

function salesGetSelectedIds(){
  if(salesSelectAllMode) return salesAllFilteredIds;
  return Array.from(document.querySelectorAll('.sr-check:checked')).map(cb=>cb.value);
}

function toggleAllSales(checked){
  document.querySelectorAll('.sr-check').forEach(cb=>cb.checked=checked);
  salesSelectAllMode = false;
  updateSalesBatchBar();
}

function selectAllSalesFiltered(){
  salesSelectAllMode = true;
  document.querySelectorAll('.sr-check').forEach(cb=>cb.checked=true);
  const cba=document.getElementById('sr-check-all'); if(cba) cba.checked=true;
  updateSalesBatchBar();
}

function salesClearSelection(){
  document.querySelectorAll('.sr-check').forEach(cb=>cb.checked=false);
  const cba=document.getElementById('sr-check-all'); if(cba) cba.checked=false;
  salesSelectAllMode = false;
  updateSalesBatchBar();
}

function updateSalesBatchBar(){
  const ids = salesGetSelectedIds();
  const bar = document.getElementById('sr-batch-bar');
  if(!bar) return;
  if(ids.length === 0){ bar.style.display='none'; return; }
  bar.style.display='flex';
  const countEl = document.getElementById('sr-batch-count');
  if(countEl) countEl.textContent = '已选择 '+ids.length+' 条'+(salesSelectAllMode?'（全部筛选结果）':'');
}

function salesBatchExport(){
  const ids = salesGetSelectedIds();
  if(ids.length === 0){ showToast('请先选择记录','warning'); return; }
  const data = salesDataCache.filter(d => ids.includes(d.id));
  const headers = ['来源系统','订单号','订单明细ID','下单日期','渠道','品牌','SKU','数量','是否有效订单','原始订单状态','备注'];
  const rows = data.map(d => [
    d.source_system||'', d.order_no||'', d.order_detail_id||'', d.order_date||'',
    d.shop_platform||'', d.brand||'', d.sku_code||'', d.quantity||0,
    d.is_valid_order?'true':'false', d.original_order_status||'', d.remark||''
  ]);
  if(typeof XLSX === 'undefined'){ showFlash('XLSX库未加载','danger'); return; }
  const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '销售明细');
  XLSX.writeFile(wb, '销售数据导出_'+new Date().toISOString().slice(0,10)+'.xlsx');
}

// ==================== SKU动销与订单预测 ====================
let rpTab = 'total'; // total | online | offline
let rpMode = 'monthly'; // monthly | daily
// 生命周期枚举值 → 业务标签
const LIFECYCLE_LABELS={
  'new_test':'新品导入',
  'new_launch':'新品启动',
  'growth':'成长期',
  'stable':'成熟期',
  'slow':'衰退期',
  'stagnant':'滞销',
  'clearance':'清仓期',
  'stopped':'停采/停产'
};
const LIFECYCLE_STRATEGY={
  'new_test':{strategy:'不直接生成PO，需完成新品启动检查',coeff:0,replenish:false},
  'new_launch':{strategy:'观察期+备货预警，按目标月数50%建议',coeff:0.5,replenish:true},
  'growth':{strategy:'允许优先补货，按目标月数80%建议',coeff:0.8,replenish:true},
  'stable':{strategy:'按默认目标月数补货',coeff:1.0,replenish:true},
  'slow':{strategy:'降低目标月数，按50%建议补货',coeff:0.5,replenish:true},
  'stagnant':{strategy:'暂缓补货，需先清理库存',coeff:0,replenish:false},
  'clearance':{strategy:'清仓期，不建议补货',coeff:0,replenish:false},
  'stopped':{strategy:'停采/停产，不参与补货建议',coeff:0,replenish:false}
};
function fmtLifecycle(v){return LIFECYCLE_LABELS[v]||v||'-';}

// ==================== 订单预测：字段配置系统 ====================
var RP_COL_STORAGE_KEYS={total:'prediction_table_columns_total',online:'prediction_table_columns_online',offline:'prediction_table_columns_offline'};

// 总预测列元数据（key,label,fixed,visibleByDefault）
function rpTotalColMeta(){
  return [
    {key:'check',label:'选择',fixed:true},
    {key:'model',label:'Model',fixed:true},
    {key:'sku',label:'SKU',fixed:true},
    {key:'online_avg',label:'线上月均'},
    {key:'offline_avg',label:'线下月均'},
    {key:'total_avg',label:'总月均'},
    {key:'avail',label:'当前可用库存'},
    {key:'transit',label:'在途库存'},
    {key:'pi_unshipped',label:'PI已确认未发货'},
    {key:'po_unconfirmed',label:'PO未确认PI'},
    {key:'total_target_stock',label:'建议采购数量',fixed:true},
    {key:'avail_turnover',label:'可用库存周转'},
    {key:'transit_turnover',label:'在途后周转'},
    {key:'after_order_turnover',label:'下单后周转'},
    {key:'last_inbound_date',label:'最后入库日期'},
    {key:'days_since_last_inbound',label:'距最后入库天数'},
    {key:'sales_status',label:'动销状态'},
    {key:'risk_tags',label:'风险标签'},
    {key:'action_rec',label:'建议动作'},
    {key:'ai_business_advice',label:'AI建议'},
    {key:'actions',label:'操作'},
    // --- 以下默认隐藏 ---
    {key:'online_pct',label:'线上占比',visibleByDefault:false},
    {key:'offline_pct',label:'线下占比',visibleByDefault:false},
    {key:'pool',label:'总库存池',visibleByDefault:false},
    {key:'current_turn',label:'当前周转',visibleByDefault:false},
    {key:'sales_reason',label:'动销原因',visibleByDefault:false},
    {key:'online_target_turn',label:'线上目标周转',visibleByDefault:false},
    {key:'offline_target_turn',label:'线下目标周转',visibleByDefault:false},
    {key:'online_target_stock',label:'线上建议',visibleByDefault:false},
    {key:'offline_target_stock',label:'线下建议',visibleByDefault:false},
    {key:'suggested_qty',label:'系统建议',visibleByDefault:false},
    {key:'arrival_month',label:'到货月份',visibleByDefault:false},
    {key:'suggestion',label:'建议动作(旧)',visibleByDefault:false},
  ];
}
// 线上/线下预测列元数据
function rpChannelColMeta(){
  return [
    {key:'spacer',label:'占位',fixed:true},
    {key:'model',label:'Model',fixed:true},
    {key:'sku',label:'SKU',fixed:true},
    {key:'sales_m4',label:'近4月渠道销量'},
    {key:'sales_m3',label:'近3月渠道销量'},
    {key:'sales_m2',label:'近2月渠道销量'},
    {key:'sales_m1',label:'本月渠道销量'},
    {key:'channel_avg',label:'渠道月均'},
    {key:'channel_pct',label:'渠道占比'},
    {key:'transit',label:'分摊在途库存'},
    {key:'po_unconfirmed',label:'PO未确认PI'},
    {key:'avail',label:'分摊可用库存'},
    {key:'current_turn',label:'当前测算周转',visibleByDefault:false},
    {key:'pi_unshipped',label:'PI已确认未发货'},
    {key:'avail_turnover',label:'可用库存周转'},
    {key:'transit_turnover',label:'在途后周转'},
    {key:'after_order_turnover',label:'下单后周转'},
    {key:'sales_status',label:'动销状态'},
    {key:'risk_tags',label:'风险标签'},
    {key:'action_rec',label:'建议动作'},
    {key:'sales_reason',label:'动销原因',visibleByDefault:false},
    {key:'ai_business_advice',label:'AI建议'},
    {key:'last_inbound_date',label:'最后入库日期'},
    {key:'days_since_last_inbound',label:'距最后入库天数'},
    {key:'target_turn',label:'目标周转'},
    {key:'target_stock',label:'建议采购数量',fixed:true},
    {key:'remark',label:'备注'},
    {key:'actions',label:'操作'},
  ];
}
// 读取字段配置：返回 [{key,label,fixed,visible}] 按保存顺序，新列追加到末尾
function getRpColConfig(tabKey){
  var defs = tabKey==='total' ? rpTotalColMeta() : rpChannelColMeta();
  var storageKey=RP_COL_STORAGE_KEYS[tabKey];
  var saved=null;
  try{saved=JSON.parse(localStorage.getItem(storageKey));}catch(e){}
  if(Array.isArray(saved)&&saved.length){
    var result=[]; var used={};
    saved.forEach(function(s){
      var d=defs.find(function(c){return c.key===s.key;});
      if(d){used[s.key]=true; result.push({key:d.key,label:d.label,fixed:!!d.fixed,visible:s.visible!==false});}
    });
    defs.forEach(function(d){if(!used[d.key])result.push({key:d.key,label:d.label,fixed:!!d.fixed,visible:d.visibleByDefault!==false});});
    return result;
  }
  return defs.map(function(d){return {key:d.key,label:d.label,fixed:!!d.fixed,visible:d.visibleByDefault!==false};});
}
// 保存字段配置
function saveRpColConfig(tabKey,config){
  localStorage.setItem(RP_COL_STORAGE_KEYS[tabKey],JSON.stringify(config.map(function(c){return {key:c.key,visible:c.visible};})));
}
// 获取当前激活（可见+有序）的列key列表
function getActiveRpColKeys(tabKey){
  return getRpColConfig(tabKey).filter(function(c){return c.visible||c.fixed;}).map(function(c){return c.key;});
}
// 构建单个字段行 HTML
function buildRpCfgItem(c, tabKey){
  var hidden = (!c.visible && !c.fixed);
  var dimmedClass = hidden ? ' rp-cfg-item-hidden' : '';
  var fixedBadge = c.fixed ? '<span class="rp-cfg-badge-fixed">固定</span>' : '';
  var checked = (c.visible || c.fixed) ? 'checked' : '';
  var disabled = c.fixed ? 'disabled' : '';
  return '<div class="rp-cfg-item'+dimmedClass+'" data-key="'+c.key+'" data-fixed="'+(c.fixed?1:0)+'" draggable="true">'
    + '<span class="rp-cfg-handle" title="拖拽排序">⠿</span>'
    + '<span class="rp-cfg-name">'+esc(c.label||'(空)')+'</span>'
    + fixedBadge
    + '<label class="rp-cfg-switch">'
    + '<input type="checkbox" class="rp-cfg-vis" data-key="'+c.key+'" '+checked+' '+disabled+' onchange="onRpCfgToggle(this,\''+tabKey+'\')">'
    + '<span class="rp-cfg-slider"></span>'
    + '</label>'
    + '</div>';
}
// 打开字段配置面板
function openRpFieldConfig(tabKey){
  var config=getRpColConfig(tabKey);
  var tabLabel = tabKey==='total'?'总预测':tabKey==='online'?'线上预测':'线下预测';
  var visibleCount = config.filter(function(c){return c.visible||c.fixed;}).length;
  var totalCount = config.length;
  var html='<div class="rp-cfg-panel">'
    +'<div class="rp-cfg-toolbar">'
    +'<input type="text" class="rp-cfg-search" id="rp-cfg-search" placeholder="搜索字段..." oninput="filterRpCfgFields()">'
    +'<button class="btn btn-default btn-sm" onclick="showAllRpFields(\''+tabKey+'\')">全部显示</button>'
    +'</div>'
    +'<div class="rp-cfg-stats" id="rp-cfg-stats">显示 '+visibleCount+' / '+totalCount+' 个字段</div>'
    +'<div class="rp-cfg-list" id="rp-cfg-list">'
    + config.map(function(c){ return buildRpCfgItem(c, tabKey); }).join('')
    + '</div>'
    +'<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">拖拽 ⠿ 手柄可调整字段顺序；切换开关控制显示/隐藏；固定字段不可关闭。</div>'
    +'</div>';
  openModal('字段配置 - '+tabLabel, html,
    '<button class="btn btn-secondary" onclick="closeModal()">取消</button>'
    +'<button class="btn btn-default" onclick="resetRpFieldConfig(\''+tabKey+'\')">恢复默认</button>'
    +'<button class="btn btn-primary" onclick="saveRpFieldConfig(\''+tabKey+'\')">保存</button>');
  setTimeout(function(){ initRpCfgDrag(tabKey); }, 100);
}
// 面板内拖拽排序初始化
function initRpCfgDrag(tabKey){
  var list = document.getElementById('rp-cfg-list');
  if(!list) return;
  var dragSrc = null;
  list.querySelectorAll('.rp-cfg-item').forEach(function(item){
    item.addEventListener('dragstart', function(e){
      dragSrc = this;
      this.classList.add('rp-cfg-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', this.dataset.key);
    });
    item.addEventListener('dragend', function(e){
      this.classList.remove('rp-cfg-dragging');
      list.querySelectorAll('.rp-cfg-item').forEach(function(it){
        it.classList.remove('rp-cfg-drop-above','rp-cfg-drop-below');
      });
      dragSrc = null;
    });
    item.addEventListener('dragover', function(e){
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if(this === dragSrc) return;
      var rect = this.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      list.querySelectorAll('.rp-cfg-item').forEach(function(it){
        it.classList.remove('rp-cfg-drop-above','rp-cfg-drop-below');
      });
      if(e.clientY < midY){
        this.classList.add('rp-cfg-drop-above');
      } else {
        this.classList.add('rp-cfg-drop-below');
      }
    });
    item.addEventListener('drop', function(e){
      e.preventDefault();
      e.stopPropagation();
      if(!dragSrc || dragSrc === this) return;
      var rect = this.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      var insertBefore = (e.clientY < midY);
      if(insertBefore){
        list.insertBefore(dragSrc, this);
      } else {
        list.insertBefore(dragSrc, this.nextSibling);
      }
      list.querySelectorAll('.rp-cfg-item').forEach(function(it){
        it.classList.remove('rp-cfg-drop-above','rp-cfg-drop-below');
      });
      updateRpCfgStats(tabKey);
    });
  });
}
// 开关切换：实时更新面板视觉
function onRpCfgToggle(checkbox, tabKey){
  var item = checkbox.closest('.rp-cfg-item');
  if(!item) return;
  if(checkbox.checked){
    item.classList.remove('rp-cfg-item-hidden');
  } else {
    item.classList.add('rp-cfg-item-hidden');
  }
  updateRpCfgStats(tabKey);
}
// 更新面板内统计文字
function updateRpCfgStats(tabKey){
  var list = document.getElementById('rp-cfg-list');
  var stats = document.getElementById('rp-cfg-stats');
  if(!list || !stats) return;
  var items = list.querySelectorAll('.rp-cfg-item');
  var visible = 0;
  items.forEach(function(it){
    var cb = it.querySelector('.rp-cfg-vis');
    if(cb && (cb.checked || cb.disabled)) visible++;
  });
  stats.textContent = '显示 '+visible+' / '+items.length+' 个字段';
}
// 全部显示
function showAllRpFields(tabKey){
  var list = document.getElementById('rp-cfg-list');
  if(!list) return;
  list.querySelectorAll('.rp-cfg-item').forEach(function(item){
    var cb = item.querySelector('.rp-cfg-vis');
    if(cb && !cb.disabled){
      cb.checked = true;
      item.classList.remove('rp-cfg-item-hidden');
    }
  });
  updateRpCfgStats(tabKey);
}
// 搜索过滤
function filterRpCfgFields(){
  var input = document.getElementById('rp-cfg-search');
  var q = (input && input.value ? input.value : '').toLowerCase().trim();
  var list = document.getElementById('rp-cfg-list');
  if(!list) return;
  list.querySelectorAll('.rp-cfg-item').forEach(function(item){
    var name = item.querySelector('.rp-cfg-name');
    var text = (name ? name.textContent : '').toLowerCase();
    item.style.display = (!q || text.indexOf(q) >= 0) ? '' : 'none';
  });
}
// 保存字段配置
function saveRpFieldConfig(tabKey){
  var config=[];
  var defs = tabKey==='total' ? rpTotalColMeta() : rpChannelColMeta();
  document.querySelectorAll('#rp-cfg-list .rp-cfg-item').forEach(function(item){
    var key=item.dataset.key;
    var fixed=item.dataset.fixed==='1';
    var vis=item.querySelector('.rp-cfg-vis').checked;
    var meta=defs.find(function(m){return m.key===key;});
    config.push({key:key,label:meta?meta.label:'',fixed:fixed,visible:fixed?true:vis});
  });
  saveRpColConfig(tabKey,config);
  closeModal();
  showToast('字段配置已保存','success');
  if(tabKey==='total')loadRp();
  else loadRpChannelMonthly(tabKey);
  updateRpFieldConfigBtn(tabKey);
}
// 恢复默认（面板内重置，不关闭弹窗）
function resetRpFieldConfig(tabKey){
  localStorage.removeItem(RP_COL_STORAGE_KEYS[tabKey]);
  var config = getRpColConfig(tabKey);
  var list = document.getElementById('rp-cfg-list');
  if(list){
    list.innerHTML = config.map(function(c){ return buildRpCfgItem(c, tabKey); }).join('');
    initRpCfgDrag(tabKey);
    updateRpCfgStats(tabKey);
  }
  var search = document.getElementById('rp-cfg-search');
  if(search) search.value = '';
  showToast('已恢复默认字段配置','success');
}
// 更新表格顶部按钮显示计数
function updateRpFieldConfigBtn(tabKey){
  var btn = document.getElementById('rp-field-config-btn');
  if(!btn) return;
  var config = getRpColConfig(tabKey || rpTab);
  var visible = config.filter(function(c){return c.visible||c.fixed;}).length;
  var total = config.length;
  btn.textContent = '⚙ 字段配置 '+visible+'/'+total;
}
// 拖拽表头调整列顺序：保存新顺序并重新渲染
function reorderRpColConfig(tabKey, srcKey, tgtKey){
  var config=getRpColConfig(tabKey);
  var srcIdx=-1, tgtIdx=-1;
  config.forEach(function(c,i){if(c.key===srcKey)srcIdx=i;if(c.key===tgtKey)tgtIdx=i;});
  if(srcIdx<0||tgtIdx<0||srcIdx===tgtIdx)return;
  var item=config.splice(srcIdx,1)[0];
  config.splice(tgtIdx,0,item);
  saveRpColConfig(tabKey,config);
  // 重新渲染
  if(tabKey==='total')loadRp();
  else loadRpChannelMonthly(tabKey);
}
// 初始化表头拖拽排序
function initRpTableDrag(tabKey){
  // 重试机制：等待表格渲染完成
  function tryInit(){
    var table=document.querySelector('#rp-table table');
    if(!table){setTimeout(tryInit,200);return;}
    var tr=table.querySelector('thead tr');
    if(!tr){setTimeout(tryInit,200);return;}
    var ths=tr.querySelectorAll('th');
    // 给每个 th 设置 draggable 和 data-col-key
    // 先从当前渲染的 activeKeys 获取列 key 顺序
    var config=getRpColConfig(tabKey);
    var activeKeys=config.filter(function(c){return c.visible||c.fixed;}).map(function(c){return c.key;});
    var dragSrcKey=null;
    ths.forEach(function(th,idx){
      if(idx>=activeKeys.length)return;
      var colKey=activeKeys[idx];
      th.draggable=true;
      th.dataset.colKey=colKey;
      th.style.cursor='grab';
      th.title='拖拽调整顺序';
      th.style.userSelect='none';
      // 移除旧事件（通过克隆替换）
      var newTh=th.cloneNode(true);
      th.parentNode.replaceChild(newTh,th);
      th=newTh;
      th.addEventListener('dragstart',function(e){
        dragSrcKey=this.dataset.colKey;
        this.style.opacity='0.4';
        e.dataTransfer.effectAllowed='move';
        e.dataTransfer.setData('text/plain',dragSrcKey||'');
        e.dataTransfer.setData('colkey',dragSrcKey||'');
      });
      th.addEventListener('dragend',function(e){
        this.style.opacity='1';
        ths.forEach(function(t){t.style.borderLeft='';t.style.borderRight='';t.style.background='';});
      });
      th.addEventListener('dragover',function(e){
        e.preventDefault();
        e.dataTransfer.dropEffect='move';
        ths.forEach(function(t){t.style.borderLeft='';t.style.borderRight='';t.style.background='';});
        this.style.borderLeft='3px solid var(--primary)';
        this.style.background='rgba(25,118,210,0.08)';
      });
      th.addEventListener('drop',function(e){
        e.preventDefault();
        e.stopPropagation();
        var tgtKey=this.dataset.colKey;
        this.style.borderLeft='';
        this.style.background='';
        if(dragSrcKey&&tgtKey&&dragSrcKey!==tgtKey){
          reorderRpColConfig(tabKey,dragSrcKey,tgtKey);
        }
      });
    });
  }
  setTimeout(tryInit,300);
}

async function renderReplenishment(){
  rpTab = 'total';
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>'
    +'<div id="rp-collapsible">'
    +'<div class="filter-bar"><div class="filter-form">'
    +'<div class="filter-group"><label>国家</label><select id="rp-c" onchange="onRpCountryChange()"><option value="">全部</option></select></div>'
    +'<div class="filter-group"><label>仓库</label><select id="rp-w" onchange="loadRpSummary();loadRp()"><option value="">全部</option></select></div>'
    +'<div class="filter-group"><label>品牌</label><select id="rp-b" onchange="onRpBrandChange()"><option value="">全部</option></select></div>'
    +'<div class="filter-actions">'
    +(hasPermission('replenishment_edit')?'<button class="btn btn-success btn-sm rp-gen-btn" onclick="genRp()">🔄 重新计算</button>':'')
    +'<button class="btn btn-default btn-sm" onclick="exportRpExcel()">⬇ 导出Excel</button>'
    +'<button class="btn btn-default btn-sm" onclick="openRpParams()">⚙ 预测参数设置</button>'
    +'</div></div>'
    +'</div>'
    +'<div id="rp-kpi" class="kpi-row"></div>'
    +'</div>'
    +'<div class="tab-bar" style="margin:12px 20px 0;display:flex;justify-content:space-between;align-items:center">'
    +'<div style="display:flex">'
    +'<div class="tab-item active" onclick="switchRpTab(\'total\')">📊 总预测</div>'
    +'<div class="tab-item" onclick="switchRpTab(\'online\')">🛒 线上预测</div>'
    +'<div class="tab-item" onclick="switchRpTab(\'offline\')">🏪 线下预测</div>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary)">'
    +'<span>显示方式：</span>'
    +'<div class="rp-mode-switch">'
    +'<button class="rp-mode-btn active" onclick="switchRpMode(\'monthly\')">按月</button>'
    +'<button class="rp-mode-btn" onclick="switchRpMode(\'daily\')">按天</button>'
    +'</div>'
    +'<button class="btn btn-default btn-sm rp-collapse-btn" id="rp-collapse-btn" onclick="toggleRpCollapse()" title="收起/展开 顶部筛选区与指标卡片">▾ 收起</button>'
    +'</div>'
    +'</div>'
    +'<div class="table-section"><div class="table-section-title"><div class="table-section-title-left" id="rp-tab-title">📊 SKU动销与订单预测（总预测）</div>'
    +'<div class="table-section-actions">'
    +'<input type="text" id="rp-s" placeholder="SKU搜索" onkeypress="if(event.key===\'Enter\')loadRp()" style="width:140px;height:28px;padding:4px 8px;border:1px solid #d0d7de;border-radius:4px;font-size:13px;margin-right:8px">'
    +(hasPermission('replenishment_edit')?'<button class="btn btn-success btn-sm rp-gen-btn" onclick="genRp()" style="margin-right:8px">🔄 重新计算</button>':'')
    +(hasPermission('po_create')?'<button class="btn btn-primary btn-sm" id="rp-po-btn" onclick="genPOModal()">🛒 生成PO</button>':'')
    +'<button class="btn btn-default btn-sm" id="rp-field-config-btn" onclick="openRpFieldConfig(rpTab)" title="字段显示与排序" style="margin-left:8px">⚙ 字段配置</button>'
    +'</div></div>'
    +'<div id="rp-table"></div></div>';
  await loadRpFilterOptions();
  loadRpSummary();
  loadRp();
  updateRpFieldConfigBtn('total');
  applyRpCollapse();
}
// ==================== 订单预测：顶部筛选区+指标卡 收起/展开 ====================
const RP_COLLAPSE_KEY='rp_top_collapsed';
function toggleRpCollapse(){
  const el=document.getElementById('rp-collapsible');
  if(!el) return;
  applyRpCollapseState(!el.classList.contains('rp-collapsed'));
}
function applyRpCollapseState(collapsed){
  const el=document.getElementById('rp-collapsible');
  const btn=document.getElementById('rp-collapse-btn');
  if(!el) return;
  el.classList.toggle('rp-collapsed',collapsed);
  if(btn){
    btn.textContent=collapsed?'▸ 展开':'▾ 收起';
    btn.title=collapsed?'展开 顶部筛选区与指标卡片':'收起 顶部筛选区与指标卡片';
  }
  try{localStorage.setItem(RP_COLLAPSE_KEY,collapsed?'1':'0');}catch(e){}
}
function applyRpCollapse(){
  let collapsed=false;
  try{collapsed=localStorage.getItem(RP_COLLAPSE_KEY)==='1';}catch(e){}
  applyRpCollapseState(collapsed);
}
async function loadRpFilterOptions(){
  try{
    // 国家列表从 warehouses 表获取（与仓库管理页一致）
    const countries=await api('/api/warehouses/countries');
    const cSel=document.getElementById('rp-c');
    if(!cSel) return;
    const prevCountry=cSel.value||'';
    cSel.innerHTML='<option value="">全部</option>'+(countries||[]).map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
    // 默认选印尼，若不存在则选第一个
    if(countries.includes(prevCountry)) cSel.value=prevCountry;
    else if(countries.includes('印尼')) cSel.value='印尼';
    else if(countries.includes('印度尼西亚')) cSel.value='印度尼西亚';
    else if(countries.length) cSel.value=countries[0];
    // 联动加载仓库和品牌
    await onRpCountryChange(true);
  }catch(e){console.warn('replenishment filter-options load failed',e)}
}
// 国家变化时联动：仓库列表 + 品牌列表都从 warehouses 表按国家筛选
async function onRpCountryChange(skipDataReload){
  const country=document.getElementById('rp-c')?.value||'';
  const prevWarehouse=document.getElementById('rp-w')?.value||'';
  const prevBrand=document.getElementById('rp-b')?.value||'';
  try{
    const url='/api/warehouses/by-country'+(country?('?country='+encodeURIComponent(country)):'');
    const whs=await api(url);
    // 填充仓库下拉
    const wSel=document.getElementById('rp-w');
    if(wSel){
      wSel.innerHTML='<option value="">全部</option>'+(whs||[]).map(w=>'<option value="'+esc(w.name)+'">'+esc(w.name)+'</option>').join('');
      if(prevWarehouse && (whs||[]).some(w=>w.name===prevWarehouse)) wSel.value=prevWarehouse;
      else wSel.value='';
    }
    // 从仓库的 brands 字段提取品牌列表
    const brandSet=new Set();
    (whs||[]).forEach(w=>{
      if(w.brands){
        String(w.brands).split(',').forEach(b=>{
          const t=b.trim();
          if(t) brandSet.add(t);
        });
      }
    });
    const brands=Array.from(brandSet).sort();
    const bSel=document.getElementById('rp-b');
    if(bSel){
      bSel.innerHTML='<option value="">全部</option>'+brands.map(b=>'<option value="'+esc(b)+'">'+esc(b)+'</option>').join('');
      if(prevBrand && brands.includes(prevBrand)) bSel.value=prevBrand;
      else if(brands.includes('Redragon')) bSel.value='Redragon';
      else bSel.value='';
    }
  }catch(e){console.warn('onRpCountryChange failed',e)}
  if(!skipDataReload){loadRpSummary();loadRp();}
}
// 品牌变化时联动：仓库列表按 国家+品牌 筛选
async function onRpBrandChange(){
  const country=document.getElementById('rp-c')?.value||'';
  const brand=document.getElementById('rp-b')?.value||'';
  const prevWarehouse=document.getElementById('rp-w')?.value||'';
  try{
    let url='/api/warehouses/by-country';
    const params=[];
    if(country) params.push('country='+encodeURIComponent(country));
    if(brand) params.push('brand='+encodeURIComponent(brand));
    if(params.length) url+='?'+params.join('&');
    // 如果有品牌筛选，用 by-country-brand 接口
    if(brand){
      url='/api/warehouses/by-country-brand'+(params.length?('?'+params.join('&')):'');
    }
    const whs=await api(url);
    const wSel=document.getElementById('rp-w');
    if(wSel){
      wSel.innerHTML='<option value="">全部</option>'+(whs||[]).map(w=>'<option value="'+esc(w.name)+'">'+esc(w.name)+'</option>').join('');
      if(prevWarehouse && (whs||[]).some(w=>w.name===prevWarehouse)) wSel.value=prevWarehouse;
      else wSel.value='';
    }
  }catch(e){console.warn('onRpBrandChange failed',e)}
  loadRpSummary();loadRp();
}
function rpQuery(){
  const c=document.getElementById('rp-c')?.value||'';
  const w=document.getElementById('rp-w')?.value||'';
  const b=document.getElementById('rp-b')?.value||'';
  const k=document.getElementById('rp-s')?.value||'';
  return 'country='+encodeURIComponent(c)+'&warehouse='+encodeURIComponent(w)+'&brand='+encodeURIComponent(b)+'&keyword='+encodeURIComponent(k);
}
function rpFilterBody(){
  return {
    country:document.getElementById('rp-c')?.value||'',
    warehouse:document.getElementById('rp-w')?.value||'',
    brand:document.getElementById('rp-b')?.value||''
  };
}
function switchRpTab(tab){
  rpTab=tab;
  document.querySelectorAll('#content-inner .tab-bar .tab-item').forEach((t,i)=>{
    const tabs=['total','online','offline'];
    t.classList.toggle('active',tabs[i]===tab);
  });
  const titles={total:'📊 SKU动销与订单预测（总预测）',online:'🛒 线上销量预测',offline:'🏪 线下销量预测'};
  document.getElementById('rp-tab-title').textContent=titles[tab]||'';
  var poBtn=document.getElementById('rp-po-btn');
  if(poBtn){poBtn.style.display=(tab==='total')?'':'none';}
  loadRp();
  updateRpFieldConfigBtn(tab);
}
function switchRpMode(mode){
  rpMode=mode;
  document.querySelectorAll('.rp-mode-btn').forEach(b=>b.classList.remove('active'));
  event.target.classList.add('active');
  loadRp();
}
async function loadRpSummary(){
  try{
    const d=await api('/api/replenishment-suggestions/summary?'+rpQuery());
    const kpi=[
      {label:'SKU总数',value:d.totalSkus||0,unit:'个'},
      {label:'总库存池',value:d.totalPool||0,unit:'件'},
      {label:'近4个月总销量',value:d.totalSales4m||0,unit:'件'},
      {label:'月均销量',value:d.avgSales4m||0,unit:'件/月'},
      {label:'预计周转月数',value:d.overallTurnover||0,unit:'月',warn:d.overallTurnover<2,tip:'正常动销SKU平均周转（已排除月均销量=0的无动销SKU）'},
      {label:'需补货SKU',value:d.needReplenish||0,unit:'个',accent:true},
      {label:'断货风险',value:d.stockoutRisk||0,unit:'个',danger:true},
      {label:'高库存/慢销',value:d.highStock||0,unit:'个',muted:true}
    ];
    document.getElementById('rp-kpi').innerHTML='<div class="kpi-grid">'+kpi.map(k=>'<div class="kpi-card'+(k.danger?' kpi-danger':k.accent?' kpi-accent':k.muted?' kpi-muted':'')+'">'
      +'<div class="kpi-label">'+k.label+(k.tip?' <span class="link-text" onclick="showKpiTip(this,\''+k.tip.replace(/'/g,"\\'")+'\')" style="cursor:help" title="'+k.tip+'">?</span>':'')+'</div>'
      +'<div class="kpi-value'+(k.warn?' kpi-warn':'')+'">'+(typeof k.value==='number'&&k.value%1!==0?Math.round(k.value*10)/10:k.value)+'</div>'
      +'<div class="kpi-unit">'+k.unit+'</div></div>').join('')+'</div>';
  }catch(e){}
}
function showKpiTip(el,tip){
  const existing=document.getElementById('kpi-tooltip');
  if(existing){existing.remove();return;}
  const div=document.createElement('div');
  div.id='kpi-tooltip';
  div.style.cssText='position:fixed;background:#1a1a2e;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;line-height:1.6;z-index:99999;max-width:300px;box-shadow:0 4px 12px rgba(0,0,0,.3)';
  div.textContent=tip;
  document.body.appendChild(div);
  const rect=el.getBoundingClientRect();
  div.style.top=(rect.bottom+6)+'px';
  div.style.left=rect.left+'px';
  setTimeout(()=>{const e=document.getElementById('kpi-tooltip');if(e)e.remove();},5000);
}

// ============ 按月模式 ============
// 总预测+按月：补货决策+生成PO
// 线上预测+按月：设置线上目标周转
// 线下预测+按月：设置线下目标周转

// 新 loadRp —— 列配置感知 + 新增2字段 + 改名
async function loadRp(){
  if(rpMode==='daily'){return loadRpDaily();}
  if(rpTab==='online'){return loadRpChannelMonthly('online');}
  if(rpTab==='offline'){return loadRpChannelMonthly('offline');}
  try{
    var data=await api('/api/replenishment-suggestions?'+rpQuery());
    var turnColor=function(v){return v<2?'text-danger':v>=2&&v<4?'text-success':v>=4&&v<6?'text-primary':'text-secondary';};
    var ADJ=['MOQ限制','整箱取整','工厂排产','供应商产能','凑柜','预算控制','老板确认','渠道策略','其他'];
    // 预计算 + 存储行数据（供 onFinalQtyChange 使用）
    window._rpRowData=window._rpRowData||{};
    data.forEach(function(r){
      var c={};
      c.oa=r.online_avg_sales_4m||0;
      c.ofa=r.offline_avg_sales_4m||0;
      c.ta=r.avg_sales_4m||0;
      c.opct=c.ta>0?Math.round(c.oa/c.ta*100):0;
      c.ofpct=c.ta>0?Math.round(c.ofa/c.ta*100):0;
      c.pool=r.total_inventory_pool||((r.available_qty||0)+(r.in_transit_qty||0)+(r.po_unconfirmed_pi_qty||0));
      c.ct=c.ta>0?Math.round(c.pool/c.ta*10)/10:0;
      c.ot=r.online_target_turnover||2;
      c.oft=r.offline_target_turnover||2;
      c.os=r.online_target_stock||0;
      c.ofs=r.offline_target_stock||0;
      c.ots=r.other_target_stock||0;
      c.ts=Math.max(0, (c.os||0)+(c.ofs||0));
      c.sq=r.suggested_qty||0;
      var avail = r.available_qty||0;
      var transit = r.in_transit_qty||0;
      var piUnshipped = r.pi_confirmed_unshipped_qty||0;
      c.availTurnover = c.ta>0 ? Math.round(avail/c.ta*10)/10 : null;
      c.transitTurnover = c.ta>0 ? Math.round((avail+transit)/c.ta*10)/10 : null;
      c.afterOrderTurnover = c.ta>0 ? Math.round((avail+transit+c.sq)/c.ta*10)/10 : null;
      c.piUnshipped = piUnshipped;
      r._c=c;
      window._rpRowData[r.id]=c;
    });
    // 列渲染器
    var Cols={
      check:{th:'<th style="width:36px"><input type="checkbox" id="rp-all" onchange="document.querySelectorAll(\'.rp-ck\').forEach(function(c){c.checked=this.checked})"></th>',
        td:function(r,c){return '<td><input type="checkbox" class="rp-ck" value="'+r.id+'" data-sku="'+esc(r.sku_code)+'" data-qty="'+c.sq+'"></td>';},
        sum:function(t){return '<td class="text-center"><span style="font-size:11px;font-weight:700">合计</span></td>';}},
      model:{th:'<th>Model</th>',
        td:function(r,c){return '<td class="text-truncate" style="max-width:90px">'+esc(r.model||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      sku:{th:'<th>SKU</th>',
        td:function(r,c){return '<td class="cell-id">'+esc(r.sku_code)+'</td>';},
        sum:function(t){return '<td><span style="font-size:10px;color:#888">'+t.count+'个SKU</span></td>';}},
      online_avg:{th:'<th class="text-right">线上月均</th>',
        td:function(r,c){return '<td class="text-right">'+Math.round(c.oa*100)/100+'</td>';},
        sum:function(t){return '<td class="text-right">'+Math.round(t.oa*100)/100+'</td>';}},
      offline_avg:{th:'<th class="text-right">线下月均</th>',
        td:function(r,c){return '<td class="text-right">'+Math.round(c.ofa*100)/100+'</td>';},
        sum:function(t){return '<td class="text-right">'+Math.round(t.ofa*100)/100+'</td>';}},
      total_avg:{th:'<th class="text-right">总月均</th>',
        td:function(r,c){return '<td class="text-right font-bold">'+Math.round(c.ta*100)/100+'</td>';},
        sum:function(t){return '<td class="text-right">'+Math.round(t.ta*100)/100+'</td>';}},
      online_pct:{th:'<th class="text-right">线上占比</th>',
        td:function(r,c){return '<td class="text-right">'+(c.ta>0?c.opct+'%':'-')+'</td>';},
        sum:function(t){return '<td></td>';}},
      offline_pct:{th:'<th class="text-right">线下占比</th>',
        td:function(r,c){return '<td class="text-right">'+(c.ta>0?c.ofpct+'%':'-')+'</td>';},
        sum:function(t){return '<td></td>';}},
      avail:{th:'<th class="text-right">当前可用库存</th>',
        td:function(r,c){return '<td class="text-right">'+(r.available_qty||0)+'</td>';},
        sum:function(t){return '<td class="text-right">'+t.avail+'</td>';}},
      transit:{th:'<th class="text-right">在途库存</th>',
        td:function(r,c){return '<td class="text-right">'+(r.in_transit_qty||0)+'</td>';},
        sum:function(t){return '<td class="text-right">'+t.transit+'</td>';}},
      po_unconfirmed:{th:'<th class="text-right">PO未确认PI</th>',
        td:function(r,c){return '<td class="text-right">'+(r.po_unconfirmed_pi_qty||0)+'</td>';},
        sum:function(t){return '<td class="text-right">'+t.po+'</td>';}},
      pool:{th:'<th class="text-right">总库存池</th>',
        td:function(r,c){return '<td class="text-right font-bold">'+c.pool+'</td>';},
        sum:function(t){return '<td class="text-right">'+t.pool+'</td>';}},
      current_turn:{th:'<th class="text-right">当前周转</th>',
        td:function(r,c){return '<td class="text-right '+(c.ta>0?(c.ct<2?'text-danger':c.ct>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.ta>0?c.ct:'无销量')+'</td>';},
        sum:function(t){return '<td></td>';}},
      pi_unshipped:{th:'<th class="text-right">PI已确认未发货</th>',
        td:function(r,c){return '<td class="text-right">'+c.piUnshipped+'</td>';},
        sum:function(t){return '<td class="text-right">'+t.piUnshipped+'</td>';}},
      avail_turnover:{th:'<th class="text-right">可用周转</th>',
        td:function(r,c){return '<td class="text-right '+(c.availTurnover!==null?(c.availTurnover<2?'text-danger':c.availTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.availTurnover!==null?c.availTurnover:'-')+'</td>';},
        sum:function(t){return '<td></td>';}},
      transit_turnover:{th:'<th class="text-right">在途后周转</th>',
        td:function(r,c){return '<td class="text-right '+(c.transitTurnover!==null?(c.transitTurnover<2?'text-danger':c.transitTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.transitTurnover!==null?c.transitTurnover:'-')+'</td>';},
        sum:function(t){return '<td></td>';}},
      after_order_turnover:{th:'<th class="text-right">下单后周转</th>',
        td:function(r,c){return '<td class="text-right '+(c.afterOrderTurnover!==null?(c.afterOrderTurnover<2?'text-danger':c.afterOrderTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.afterOrderTurnover!==null?c.afterOrderTurnover:'-')+'</td>';},
        sum:function(t){return '<td></td>';}},
      sales_status:{th:'<th>动销状态</th>',
        td:function(r,c){return '<td><span class="status-badge">'+esc(r.sales_status||'')+'</span></td>';},
        sum:function(t){return '<td></td>';}},
      risk_tags:{th:'<th>风险标签</th>',
        td:function(r,c){return '<td>'+esc(r.risk_tags||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      sales_reason:{th:'<th>动销原因</th>',
        td:function(r,c){return '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.sales_reason||'')+'">'+esc(r.sales_reason||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      action_rec:{th:'<th>建议动作</th>',
        td:function(r,c){return '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.action||'')+'">'+esc(r.action||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      ai_business_advice:{th:'<th style="min-width:180px">AI建议</th>',
        td:function(r,c){return '<td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(r.ai_business_advice||'')+'">'+esc(r.ai_business_advice||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      last_inbound_date:{th:'<th>最后入库日期</th>',
        td:function(r,c){return '<td class="cell-date">'+(r.last_inbound_date?fmtDate(r.last_inbound_date):'未知')+'</td>';},
        sum:function(t){return '<td></td>';}},
      days_since_last_inbound:{th:'<th class="text-right">距最后入库天数</th>',
        td:function(r,c){
          var d=r.days_since_last_inbound;
          var cls=d!==null?(d<=90?'text-success':d<=180?'text-primary':d<=365?'text-warning':'text-danger'):'text-muted';
          return '<td class="text-right '+cls+'">'+(d!==null?d:'未知')+'</td>';
        },
        sum:function(t){return '<td></td>';}},
      online_target_turn:{th:'<th class="text-right">线上目标周转</th>',
        td:function(r,c){return '<td class="text-right">'+c.ot+'</td>';},
        sum:function(t){return '<td></td>';}},
      offline_target_turn:{th:'<th class="text-right">线下目标周转</th>',
        td:function(r,c){return '<td class="text-right">'+c.oft+'</td>';},
        sum:function(t){return '<td></td>';}},
      online_target_stock:{th:'<th class="text-right">线上</th>',
        td:function(r,c){return '<td class="text-right">'+c.os+'</td>';},
        sum:function(t){return '<td class="text-right">'+t.os+'</td>';}},
      offline_target_stock:{th:'<th class="text-right">线下</th>',
        td:function(r,c){return '<td class="text-right">'+c.ofs+'</td>';},
        sum:function(t){return '<td class="text-right">'+t.ofs+'</td>';}},
      total_target_stock:{th:'<th class="text-right">建议采购数量</th>',
        td:function(r,c){return '<td class="text-right font-bold">'+c.ts+'</td>';},
        sum:function(t){return '<td class="text-right">'+t.ts+'</td>';}},
      suggested_qty:{th:'<th class="text-right">系统建议</th>',
        td:function(r,c){return '<td class="text-right" style="color:#888">'+c.sq+'</td>';},
        sum:function(t){return '<td class="text-right">'+t.sq+'</td>';}},
      arrival_month:{th:'<th>到货月份</th>',
        td:function(r,c){return '<td>'+esc(r.arrival_month||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      suggestion:{th:'<th>建议动作</th>',
        td:function(r,c){return '<td>'+esc(r.suggestion||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      actions:{th:'<th>操作</th>',
        td:function(r,c){return '<td class="cell-actions"><button class="action-btn" onclick="toggleGenPO(\''+r.id+'\')" title="加入PO">🛒</button></td>';},
        sum:function(t){return '<td></td>';}}
    };
    // 按配置过滤+排序
    var config=getRpColConfig('total');
    var activeKeys=[];
    config.forEach(function(cfg){
      var col=Cols[cfg.key];
      if(col&&(cfg.visible||cfg.key==='check'||cfg.key==='model'||cfg.key==='sku'||cfg.key==='total_target_stock')){
        activeKeys.push(cfg.key);
      }
    });
    Object.keys(Cols).forEach(function(k){if(activeKeys.indexOf(k)<0)activeKeys.push(k);});
    // 计算合计
    var totals={count:data.length,oa:0,ofa:0,ta:0,avail:0,transit:0,po:0,piUnshipped:0,pool:0,os:0,ofs:0,ts:0,sq:0};
    data.forEach(function(r){
      var c=r._c;
      totals.oa+=c.oa;totals.ofa+=c.ofa;totals.ta+=c.ta;
      totals.avail+=(r.available_qty||0);totals.transit+=(r.in_transit_qty||0);totals.po+=(r.po_unconfirmed_pi_qty||0);totals.piUnshipped+=c.piUnshipped;totals.pool+=c.pool;
      totals.os+=c.os;totals.ofs+=c.ofs;totals.ts+=c.ts;
      totals.sq+=c.sq;
    });
    // 渲染
    var th=activeKeys.map(function(k){return Cols[k].th;}).join('');
    var rows=data.map(function(r){
      return '<tr data-rid="'+r.id+'">' + activeKeys.map(function(k){return Cols[k].td(r,r._c);}).join('') + '</tr>';
    }).join('');
    var sum='<tr class="rp-summary-row">' + activeKeys.map(function(k){return Cols[k].sum(totals);}).join('') + '</tr>';
    var colCount=activeKeys.length;
    var tableFoot=!data.length
      ? '<tr><td colspan="'+colCount+'" style="text-align:center;padding:40px 20px;color:#999;background:#fafbfc">💡 当前筛选条件下暂无建议，请调整国家/仓库/品牌或点击"重新计算"</td></tr>'
      : '';
    document.getElementById('rp-table').innerHTML='<div class="table-container" style="box-shadow:none;border-radius:0;overflow:auto;max-height:70vh"><table class="data-table rp-monthly-table"><thead><tr style="height:34px">'+th+'</tr>'+sum+'</thead><tbody>'+rows+tableFoot+'</tbody></table></div>';
    initRpTableDrag('total');
  }catch(e){showFlash(e.message,'danger')}
}

// 线上/线下预测 + 按月：设置目标周转
async function loadRpChannelMonthly(channel){
  var isOnline=channel==='online';
  var chLabel=isOnline?'线上':'线下';
  var now=new Date();
  var ml=[];
  for(var i=3;i>=0;i--){
    var d=new Date(now.getFullYear(),now.getMonth()-i,1);
    var m=d.getMonth()+1;
    ml.push(i===0?'本月/'+m+'月':m+'月');
  }
  try{
    var data=await api('/api/replenishment-suggestions?'+rpQuery());
    // 预处理
    data.forEach(function(r){
      r._c={};
      var s1,s2,s3,s4,avgSales,targetTurn,targetStock,remark;
      if(isOnline){
        s1=r.online_sales_m4||0; s2=r.online_sales_m3||0; s3=r.online_sales_m2||0; s4=r.online_sales_m1||0;
        avgSales=r.online_avg_sales_4m||0;
        targetTurn=r.online_target_turnover||2;
        targetStock=r.online_target_stock||0;
        remark=r.online_remark||'';
      }else{
        s1=r.offline_sales_m4||0; s2=r.offline_sales_m3||0; s3=r.offline_sales_m2||0; s4=r.offline_sales_m1||0;
        avgSales=r.offline_avg_sales_4m||0;
        targetTurn=r.offline_target_turnover||2;
        targetStock=r.offline_target_stock||0;
        remark=r.offline_remark||'';
      }
      var totalAvg=r.avg_sales_4m||0;
      var pct=totalAvg>0?(avgSales/totalAvg*100):0;
      var availTotal=r.available_qty||0;
      var transitTotal=r.in_transit_qty||0;
      var piUnshippedTotal=r.pi_confirmed_unshipped_qty||0;
      var pool=r.total_inventory_pool||(availTotal+transitTotal+(r.po_unconfirmed_pi_qty||0))||0;
      var allocatedStock=pool*(pct/100);
      var currentTurn=avgSales>0?Math.round(allocatedStock/avgSales*10)/10:'无销量';
      // 渠道分摊库存（按销量占比分摊，不真正拆分库存；仅用于线上/线下测算口径）
      var availAllocated=Math.round(availTotal*(pct/100));
      var transitAllocated=Math.round(transitTotal*(pct/100));
      var piUnshippedAllocated=Math.round(piUnshippedTotal*(pct/100));
      r._c.s1=s1; r._c.s2=s2; r._c.s3=s3; r._c.s4=s4;
      r._c.avgSales=avgSales; r._c.totalAvg=totalAvg; r._c.pct=pct;
      r._c.pool=pool; r._c.allocatedStock=allocatedStock; r._c.currentTurn=currentTurn;
      r._c.transit=transitTotal; r._c.po=r.po_unconfirmed_pi_qty||0; r._c.avail=availTotal;
      r._c.availAllocated=availAllocated; r._c.transitAllocated=transitAllocated; r._c.piUnshippedAllocated=piUnshippedAllocated;
      r._c.targetTurn=targetTurn; r._c.targetStock=targetStock; r._c.remark=remark;
      r._c.piUnshipped = piUnshippedTotal;
      // 建议采购数量 = 目标周转 × 月均销量 - 当前测算库存
      r._c.suggestedQty=avgSales>0?Math.max(0,Math.round(avgSales*targetTurn)-allocatedStock):0;
      // 三周转指标（基于渠道月均 + 渠道分摊库存，口径：可用+在途，不含PI未发货）
      r._c.availTurnover = avgSales>0 ? Math.round(availAllocated/avgSales*10)/10 : null;
      r._c.transitTurnover = avgSales>0 ? Math.round((availAllocated+transitAllocated)/avgSales*10)/10 : null;
      r._c.afterOrderTurnover = avgSales>0 ? Math.round((availAllocated+transitAllocated+r._c.suggestedQty)/avgSales*10)/10 : null;
    });
    // 列渲染器 — key 必须与 rpChannelColMeta() 中的 key 一致
    var Cols={};
    Cols.spacer={th:'<th style="width:36px"></th>',
      td:function(r,c){return '<td></td>';},
      sum:function(t){return '<td></td>';}};
    Cols.model={th:'<th>Model</th>',
      td:function(r,c){return '<td class="text-truncate" style="max-width:100px">'+esc(r.model||'')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.sku={th:'<th>SKU</th>',
      td:function(r,c){return '<td class="cell-id">'+esc(r.sku_code)+'</td>';},
      sum:function(t){return '<td><span style="font-size:10px;color:#888">'+t.count+'个SKU</span></td>';}};
    Cols.sales_m4={th:'<th class="text-right">'+ml[3]+chLabel+'</th>',
      td:function(r,c){return '<td class="text-right">'+(isOnline?(r.online_sales_m4||0):(r.offline_sales_m4||0))+'</td>';},
      sum:function(t){return '<td class="text-right">'+(isOnline?t.s4:t.s4)+'</td>';}};
    Cols.sales_m3={th:'<th class="text-right">'+ml[2]+chLabel+'</th>',
      td:function(r,c){return '<td class="text-right">'+(isOnline?(r.online_sales_m3||0):(r.offline_sales_m3||0))+'</td>';},
      sum:function(t){return '<td class="text-right">'+(isOnline?t.s3:t.s3)+'</td>';}};
    Cols.sales_m2={th:'<th class="text-right">'+ml[1]+chLabel+'</th>',
      td:function(r,c){return '<td class="text-right">'+(isOnline?(r.online_sales_m2||0):(r.offline_sales_m2||0))+'</td>';},
      sum:function(t){return '<td class="text-right">'+(isOnline?t.s2:t.s2)+'</td>';}};
    Cols.sales_m1={th:'<th class="text-right">'+ml[0]+chLabel+'</th>',
      td:function(r,c){return '<td class="text-right font-bold">'+(isOnline?(r.online_sales_m1||0):(r.offline_sales_m1||0))+'</td>';},
      sum:function(t){return '<td class="text-right">'+(isOnline?t.s1:t.s1)+'</td>';}};
    Cols.channel_avg={th:'<th class="text-right">'+chLabel+'月均</th>',
      td:function(r,c){return '<td class="text-right font-bold">'+Math.round(c.avgSales*100)/100+'</td>';},
      sum:function(t){return '<td class="text-right">'+Math.round(t.avgSales*100)/100+'</td>';}};
    Cols.channel_pct={th:'<th class="text-right">'+chLabel+'占比</th>',
      td:function(r,c){return '<td class="text-right">'+(c.totalAvg>0?Math.round(c.pct)+'%':'-')+'</td>';},
      sum:function(t){return '<td class="text-right">'+(t.totalAvg>0?Math.round(t.avgSales/t.totalAvg*100)+'%':'-')+'</td>';}};
    Cols.transit={th:'<th class="text-right">'+chLabel+'分摊在途库存</th>',
      td:function(r,c){return '<td class="text-right" title="总在途库存 '+(c.transit||0)+' × '+chLabel+'销量占比 '+Math.round(c.pct||0)+'%">'+c.transitAllocated+'</td>';},
      sum:function(t){return '<td class="text-right">'+t.transitAllocated+'</td>';}};
    Cols.po_unconfirmed={th:'<th class="text-right">PO未确认PI</th>',
      td:function(r,c){return '<td class="text-right">'+(r.po_unconfirmed_pi_qty||0)+'</td>';},
      sum:function(t){return '<td class="text-right">'+t.po+'</td>';}};
    Cols.avail={th:'<th class="text-right">'+chLabel+'分摊可用库存</th>',
      td:function(r,c){return '<td class="text-right" title="总可用库存 '+(c.avail||0)+' × '+chLabel+'销量占比 '+Math.round(c.pct||0)+'%">'+c.availAllocated+'</td>';},
      sum:function(t){return '<td class="text-right">'+t.availAllocated+'</td>';}};
    Cols.current_turn={th:'<th class="text-right">'+chLabel+'当前测算周转</th>',
      td:function(r,c){
        var cls=c.avgSales>0?(c.currentTurn<2?'text-danger':c.currentTurn>6?'text-secondary':'text-success'):'text-muted';
        return '<td class="text-right '+cls+'">'+(c.avgSales>0?c.currentTurn:'无销量')+'</td>';
      },
      sum:function(t){return '<td class="text-right">'+(t.avgSales>0?Math.round(t.allocatedStock/t.avgSales*10)/10:'-')+'</td>';}};
    Cols.pi_unshipped={th:'<th class="text-right">PI已确认未发货</th>',
      td:function(r,c){return '<td class="text-right">'+c.piUnshipped+'</td>';},
      sum:function(t){return '<td class="text-right">'+t.piUnshipped+'</td>';}};
    Cols.avail_turnover={th:'<th class="text-right">可用库存周转</th>',
      td:function(r,c){return '<td class="text-right '+(c.availTurnover!==null?(c.availTurnover<2?'text-danger':c.availTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.availTurnover!==null?c.availTurnover:'-')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.transit_turnover={th:'<th class="text-right">在途后周转</th>',
      td:function(r,c){return '<td class="text-right '+(c.transitTurnover!==null?(c.transitTurnover<2?'text-danger':c.transitTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.transitTurnover!==null?c.transitTurnover:'-')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.after_order_turnover={th:'<th class="text-right">下单后周转</th>',
      td:function(r,c){return '<td class="text-right '+(c.afterOrderTurnover!==null?(c.afterOrderTurnover<2?'text-danger':c.afterOrderTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.afterOrderTurnover!==null?c.afterOrderTurnover:'-')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.sales_status={th:'<th>动销状态</th>',
      td:function(r,c){return '<td><span class="status-badge">'+esc(r.sales_status||'')+'</span></td>';},
      sum:function(t){return '<td></td>';}};
    Cols.risk_tags={th:'<th>风险标签</th>',
      td:function(r,c){return '<td>'+esc(r.risk_tags||'')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.action_rec={th:'<th>建议动作</th>',
      td:function(r,c){return '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.action||'')+'">'+esc(r.action||'')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.sales_reason={th:'<th>动销原因</th>',
      td:function(r,c){return '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.sales_reason||'')+'">'+esc(r.sales_reason||'')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.ai_business_advice={th:'<th style="min-width:180px">AI建议</th>',
      td:function(r,c){return '<td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(r.ai_business_advice||'')+'">'+esc(r.ai_business_advice||'')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.target_turn={th:'<th class="text-right" style="min-width:90px">'+chLabel+'目标周转</th>',
      td:function(r,c){
        return '<td class="text-right"><input type="number" class="rp-target-turn" data-rid="'+r.id+'" data-channel="'+channel+'" data-avg-sales="'+c.avgSales+'" value="'+c.targetTurn+'" min="0" step="0.5" style="width:65px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-weight:bold;text-align:right" onchange="onTargetTurnChange(this)"></td>';
      },
      sum:function(t){return '<td></td>';}};
    Cols.target_stock={th:'<th class="text-right">建议采购数量</th>',
      td:function(r,c){
        return '<td class="text-right"><input type="number" class="rp-target-stock-input" data-rid="'+r.id+'" data-channel="'+channel+'" value="'+c.targetStock+'" min="0" style="width:75px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-weight:bold;text-align:right" onchange="onChannelTargetStockChange(this)"></td>';
      },
      sum:function(t){return '<td class="text-right">'+t.targetStock+'</td>';}};
    Cols.last_inbound_date={th:'<th>最后入库日期</th>',
      td:function(r,c){return '<td class="cell-date">'+(r.last_inbound_date?fmtDate(r.last_inbound_date):'未知')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.days_since_last_inbound={th:'<th class="text-right">距最后入库天数</th>',
      td:function(r,c){
        var d=r.days_since_last_inbound;
        var cls=d!==null?(d<=90?'text-success':d<=180?'text-primary':d<=365?'text-warning':'text-danger'):'text-muted';
        return '<td class="text-right '+cls+'">'+(d!==null?d:'未知')+'</td>';
      },
      sum:function(t){return '<td></td>';}};
    Cols.remark={th:'<th style="min-width:120px">'+chLabel+'备注</th>',
      td:function(r,c){return '<td><input type="text" class="rp-channel-remark" data-rid="'+r.id+'" data-channel="'+channel+'" value="'+esc(c.remark)+'" style="width:110px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px"></td>';},
      sum:function(t){return '<td></td>';}};
    Cols.actions={th:'<th>操作</th>',
      td:function(r,c){return '<td class="cell-actions"><button class="action-btn" onclick="saveChannelChanges(\''+r.id+'\',\''+channel+'\')" title="保存">💾</button></td>';},
      sum:function(t){return '<td></td>';}};
    // 按配置过滤+排序：可见或固定的列才显示
    var tabKey=isOnline?'online':'offline';
    var config=getRpColConfig(tabKey);
    var activeKeys=[];
    config.forEach(function(cfg){
      var col=Cols[cfg.key];
      if(col&&(cfg.visible||cfg.fixed)){
        activeKeys.push(cfg.key);
      }
    });
    // 计算合计
    var totals={count:data.length,s1:0,s2:0,s3:0,s4:0,avgSales:0,totalAvg:0,transit:0,transitAllocated:0,po:0,avail:0,availAllocated:0,piUnshipped:0,allocatedStock:0,targetStock:0};
    data.forEach(function(r){
      var c=r._c;
      if(isOnline){
        totals.s4+=(r.online_sales_m4||0);totals.s3+=(r.online_sales_m3||0);totals.s2+=(r.online_sales_m2||0);totals.s1+=(r.online_sales_m1||0);
      }else{
        totals.s4+=(r.offline_sales_m4||0);totals.s3+=(r.offline_sales_m3||0);totals.s2+=(r.offline_sales_m2||0);totals.s1+=(r.offline_sales_m1||0);
      }
      totals.avgSales+=c.avgSales;totals.totalAvg+=c.totalAvg;
      totals.transit+=c.transit;totals.transitAllocated+=c.transitAllocated;totals.po+=c.po;totals.avail+=c.avail;totals.availAllocated+=c.availAllocated;
      totals.piUnshipped+=c.piUnshipped;
      totals.allocatedStock+=c.allocatedStock;totals.targetStock+=c.targetStock;
    });
    // 渲染
    var th=activeKeys.map(function(k){return Cols[k].th;}).join('');
    var rows=data.map(function(r){
      return '<tr data-rid="'+r.id+'">' + activeKeys.map(function(k){return Cols[k].td(r,r._c);}).join('') + '</tr>';
    }).join('');
    var sum='<tr class="rp-summary-row">' + activeKeys.map(function(k){return Cols[k].sum(totals);}).join('') + '</tr>';
    var colCount=activeKeys.length;
    var tableFoot=!data.length
      ? '<tr><td colspan="'+colCount+'" style="text-align:center;padding:40px 20px;color:#999;background:#fafbfc">💡 当前筛选条件下暂无建议，请调整国家/仓库/品牌或点击"重新计算"</td></tr>'
      : '';
    document.getElementById('rp-table').innerHTML='<div class="table-container" style="box-shadow:none;border-radius:0;overflow:auto;max-height:70vh"><table class="data-table rp-monthly-table"><thead><tr style="height:34px">'+th+'</tr>'+sum+'</thead><tbody>'+rows+tableFoot+'</tbody></table></div>';
    initRpTableDrag(channel);
  }catch(e){showFlash(e.message,'danger')}
}

// 目标周转修改 → 实时预览目标库存
function onTargetTurnChange(input){
  var rid=input.dataset.rid;
  var channel=input.dataset.channel;
  var months=parseFloat(input.value)||0;
  var avgSales=parseFloat(input.dataset.avgSales)||0;
  var stock=Math.round(avgSales*months);
  var stockEl=document.querySelector('.rp-target-stock-'+rid);
  if(stockEl) stockEl.textContent=stock;
  // 异步保存目标周转
  var field=channel==='online'?'online_target_turnover':'offline_target_turnover';
  api('/api/replenishment-suggestions/'+rid,'PUT',{online_target_turnover:channel==='online'?months:undefined,offline_target_turnover:channel==='offline'?months:undefined});
}

// 线上/线下建议采购数量修改
function onChannelTargetStockChange(input){
  var rid=input.dataset.rid;
  var channel=input.dataset.channel;
  var qty=parseInt(input.value)||0;
  // 异步保存
  var data={};
  if(channel==='online') data.online_target_stock=qty;
  else data.offline_target_stock=qty;
  api('/api/replenishment-suggestions/'+rid,'PUT',data);
}

// 最终下单数量修改 → 实时更新订单后周转 + 启用/禁用调整原因
function onFinalQtyChange(input){
  var rid=input.dataset.rid;
  var foq=parseInt(input.value)||0;
  var suggested=parseInt(input.dataset.suggested)||0;
  // 从存储的行数据读取，不依赖 DOM 列位置
  var rowData=window._rpRowData&&window._rpRowData[rid];
  var totalAvg=rowData?(rowData.totalAvg||0):0;
  var pool=rowData?(rowData.pool||0):0;
  var afterOrder=totalAvg>0?Math.round((pool+foq)/totalAvg*10)/10:0;
  var turnEl=document.getElementById('rp-turn-'+rid);
  if(turnEl){
    turnEl.textContent=totalAvg>0?afterOrder:'无销量';
    var cls=afterOrder<2?'text-danger':afterOrder>=2&&afterOrder<4?'text-success':afterOrder>=4&&afterOrder<6?'text-primary':'text-secondary';
    turnEl.className='text-right '+cls;
  }
  // 启用/禁用调整原因
  var reasonSel=document.querySelector('.rp-adj-reason[data-rid="'+rid+'"]');
  if(reasonSel){
    if(foq!==suggested){
      reasonSel.disabled=false;
      if(reasonSel.value==='') reasonSel.options[0].text='请选择';
    }else{
      reasonSel.disabled=true;
      reasonSel.value='';
      reasonSel.options[0].text='-';
    }
  }
  // 更新checkbox的data-qty
  var ck=document.querySelector('.rp-ck[value="'+rid+'"]');
  if(ck) ck.dataset.qty=parseInt(input.dataset.suggested)||0;
  // 自动保存
  saveFinalQty(rid);
}

// 调整原因修改
function onAdjReasonChange(sel){
  var rid=sel.dataset.rid;
  var reason=sel.value;
  // 异步保存原因
  api('/api/replenishment-suggestions/'+rid,'PUT',{adjustment_reason:reason}).then(function(){
    showToast('调整原因已保存','success');
  }).catch(function(e){showToast(e.message,'danger')});
}

// 保存渠道变更（目标周转+备注）
async function saveChannelChanges(rid,channel){
  var turnInput=document.querySelector('.rp-target-turn[data-rid="'+rid+'"][data-channel="'+channel+'"]');
  var remarkInput=document.querySelector('.rp-channel-remark[data-rid="'+rid+'"][data-channel="'+channel+'"]');
  if(!turnInput) return;
  var body={};
  if(channel==='online'){
    body.online_target_turnover=parseFloat(turnInput.value)||0;
    body.online_remark=remarkInput?remarkInput.value:'';
  }else{
    body.offline_target_turnover=parseFloat(turnInput.value)||0;
    body.offline_remark=remarkInput?remarkInput.value:'';
  }
  try{
    var resp=await api('/api/replenishment-suggestions/'+rid,'PUT',body);
    var d=resp.data;
    if(d){
      var stockEl=document.querySelector('.rp-target-stock-'+rid);
      if(stockEl){
        var stock=channel==='online'?(d.online_target_stock||0):(d.offline_target_stock||0);
        stockEl.textContent=stock;
      }
    }
    showToast('已保存，目标库存已回写总预测','success');
  }catch(e){showToast(e.message,'danger')}
}

// 最终下单数量保存（失焦时触发）
async function saveFinalQty(rid){
  var input=document.querySelector('.rp-final-qty[data-rid="'+rid+'"]');
  if(!input) return;
  var foq=parseInt(input.value)||0;
  var reasonSel=document.querySelector('.rp-adj-reason[data-rid="'+rid+'"]');
  var body={final_order_qty:foq};
  if(reasonSel && !reasonSel.disabled) body.adjustment_reason=reasonSel.value;
  try{
    var resp=await api('/api/replenishment-suggestions/'+rid,'PUT',body);
    showToast('已保存','success');
  }catch(e){showToast(e.message,'danger')}
}

// 按天模式：冻结左侧列 + 冻结汇总行
async function loadRpDaily(){
  try{
    let url='/api/replenishment-suggestions/daily-sales?'+rpQuery();
    if(rpTab==='online') url+='&tab=online';
    else if(rpTab==='offline') url+='&tab=offline';
    const resp=await api(url);
    const dates=resp.dates||[];
    const data=resp.skus||[];

    // 冻结列定义：宽度 + 计算left偏移
    var fcw=[36,56,96,88,110,64,64,64,56,48]; // 10个冻结列宽度
    var fcLeft=[]; var totalFw=0;
    fcw.forEach(function(w,i){fcLeft.push(totalFw);totalFw+=w;});
    var headerH=34; // 表头行高
    var summaryH=30; // 汇总行高

    // 生成冻结单元格的sticky样式
    function sHead(i){return 'position:sticky;top:0;left:'+fcLeft[i]+'px;z-index:5;min-width:'+fcw[i]+'px;max-width:'+fcw[i]+'px;background:var(--bg-header,#f5f7fa)';}
    function sSum(i){return 'position:sticky;top:'+headerH+'px;left:'+fcLeft[i]+'px;z-index:4;min-width:'+fcw[i]+'px;max-width:'+fcw[i]+'px;background:#e8edf3;font-weight:700';}
    function sBody(i){return 'position:sticky;left:'+fcLeft[i]+'px;z-index:1;min-width:'+fcw[i]+'px;max-width:'+fcw[i]+'px;background:var(--bg-card,#fff)';}

    // 日期表头：7/1, 7/2...
    var dateHeaders=dates.map(function(d){
      var p=d.split('-');
      return '<th class="text-right" style="min-width:44px;position:sticky;top:0;z-index:3;background:var(--bg-header,#f5f7fa)">'+parseInt(p[1])+'/'+parseInt(p[2])+'</th>';
    }).join('');

    // === 表头行 ===
    var headRow='<tr style="height:'+headerH+'px">'
      +'<th style="'+sHead(0)+'"><input type="checkbox" id="rp-all" onchange="document.querySelectorAll(\'.rp-ck\').forEach(function(c){c.checked=this.checked})"></th>'
      +'<th style="'+sHead(1)+'">动销</th>'
      +'<th style="'+sHead(2)+'">生命周期</th>'
      +'<th style="'+sHead(3)+'">Model</th>'
      +'<th style="'+sHead(4)+'">SKU</th>'
      +'<th class="text-right" style="'+sHead(5)+'">近7天</th>'
      +'<th class="text-right" style="'+sHead(6)+'">近14天</th>'
      +'<th class="text-right" style="'+sHead(7)+'">近30天</th>'
      +'<th class="text-right" style="'+sHead(8)+'">日均</th>'
      +'<th class="text-center" style="'+sHead(9)+'">趋势</th>'
      +dateHeaders
      +'</tr>';

    // === 汇总行（冻结在表头下方） ===
    var sum7=0,sum14=0,sum30=0,sumAvg=0;
    var dateSums=dates.map(function(){return 0;});
    data.forEach(function(r){
      sum7+=(r.last_7_days||0); sum14+=(r.last_14_days||0); sum30+=(r.last_30_days||0);
      sumAvg+=(r.avg_daily_sales||0);
      (r.daily_sales||[]).forEach(function(q,idx){dateSums[idx]+=q;});
    });
    var summaryDateCells=dates.map(function(d,i){
      return '<td class="text-right" style="position:sticky;top:'+headerH+'px;z-index:2;background:#e8edf3;font-weight:700;font-size:11px;min-width:44px">'+(dateSums[i]>0?dateSums[i]:'<span style="color:#aaa">-</span>')+'</td>';
    }).join('');
    var summaryRow='<tr style="height:'+summaryH+'px;background:#e8edf3">'
      +'<td style="'+sSum(0)+'" class="text-center" colspan="1"><span style="font-size:11px;font-weight:700">合计</span></td>'
      +'<td style="'+sSum(1)+'"></td>'
      +'<td style="'+sSum(2)+'"></td>'
      +'<td style="'+sSum(3)+'"></td>'
      +'<td style="'+sSum(4)+'"><span style="font-size:10px;color:#888">'+data.length+'个SKU</span></td>'
      +'<td class="text-right" style="'+sSum(5)+'">'+sum7+'</td>'
      +'<td class="text-right" style="'+sSum(6)+'">'+sum14+'</td>'
      +'<td class="text-right" style="'+sSum(7)+'">'+sum30+'</td>'
      +'<td class="text-right" style="'+sSum(8)+'">'+Math.round(sumAvg*100)/100+'</td>'
      +'<td class="text-center" style="'+sSum(9)+'"></td>'
      +summaryDateCells
      +'</tr>';

    // === 数据行 ===
    var rows='';
    data.forEach(function(r){
      var trendIcon=r.trend==='up'?'<span class="trend-up">↗</span>':r.trend==='down'?'<span class="trend-down">↘</span>':'<span class="trend-flat">→</span>';
      var dailyCells=(r.daily_sales||[]).map(function(q){
        return '<td class="daily-sales-cell">'+(q>0?q:'<span class="daily-sales-zero">-</span>')+'</td>';
      }).join('');
      rows+='<tr>'
        +'<td style="'+sBody(0)+'"><input type="checkbox" class="rp-ck" value="'+r.id+'" data-sku="'+esc(r.sku_code)+'"></td>'
        +'<td style="'+sBody(1)+'"><span class="badge badge-sm">'+(r.sales_group||'')+'</span></td>'
        +'<td style="'+sBody(2)+'"><span class="lifecycle-tag lc-'+(r.lifecycle_status||'stable')+'">'+fmtLifecycle(r.lifecycle_status)+'</span></td>'
        +'<td class="text-truncate" style="'+sBody(3)+';overflow:hidden;text-overflow:ellipsis">'+esc(r.model||'')+'</td>'
        +'<td class="cell-id" style="'+sBody(4)+'">'+esc(r.sku_code)+'</td>'
        +'<td class="text-right font-bold" style="'+sBody(5)+'">'+(r.last_7_days||0)+'</td>'
        +'<td class="text-right" style="'+sBody(6)+'">'+(r.last_14_days||0)+'</td>'
        +'<td class="text-right" style="'+sBody(7)+'">'+(r.last_30_days||0)+'</td>'
        +'<td class="text-right font-bold" style="'+sBody(8)+'">'+(r.avg_daily_sales||0)+'</td>'
        +'<td class="text-center" style="'+sBody(9)+'">'+trendIcon+'</td>'
        +dailyCells
        +'</tr>';
    });

    var emptyFoot=!data.length
      ? '<tr><td colspan="'+(10+dates.length)+'" style="text-align:center;padding:40px 20px;color:#999;background:#fafbfc">📈 当前筛选条件下暂无销量数据，请调整国家/仓库/品牌或点击"重新计算"</td></tr>'
      : '';
    document.getElementById('rp-table').innerHTML='<div class="daily-table-wrap" style="overflow:auto;max-height:70vh;position:relative">'
      +'<table class="data-table" style="white-space:nowrap;border-collapse:separate;border-spacing:0">'
      +'<thead>'+headRow+summaryRow+'</thead>'
      +'<tbody>'+rows+emptyFoot+'</tbody>'
      +'</table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

async function onRpQtyChange(input,rid){
  const val=parseInt(input.value)||0;
  try{
    const resp=await api('/api/replenishment-suggestions/'+rid,'PUT',{user_adjusted_qty:val});
    const d=resp.data;
    // 根据当前Tab更新对应的周转月数列
    const turnEl=document.getElementById('rp-turn-'+rid);
    if(turnEl&&d){
      let afterOrder=99;
      if(rpTab==='online') afterOrder=d.online_after_order_turnover_months||99;
      else if(rpTab==='offline') afterOrder=d.offline_after_order_turnover_months||99;
      else afterOrder=d.after_order_turnover_months||99;
      turnEl.textContent=Math.round(afterOrder*10)/10;
      turnEl.className='text-right '+(afterOrder<2?'text-danger':afterOrder>=2&&afterOrder<4?'text-success':afterOrder>=4&&afterOrder<6?'text-primary':'text-secondary');
    }
    const suggEl=document.getElementById('rp-sugg-'+rid);
    if(suggEl&&d) suggEl.textContent=d.suggestion||'';
    const ck=document.querySelector('.rp-ck[value="'+rid+'"]');
    if(ck) ck.dataset.qty=val;
    showToast('已更新','success');
  }catch(e){showToast(e.message,'danger');loadRp()}
}
async function genRp(){
  const buttons=Array.from(document.querySelectorAll('.rp-gen-btn'));
  const oldLabels=buttons.map(b=>b.innerHTML);
  buttons.forEach(b=>{b.disabled=true;b.innerHTML='计算中...';});
  showToast('正在重新计算，请稍候...','info');
  try{
    const r=await api('/api/replenishment-suggestions/generate','POST',rpFilterBody());
    showToast('已生成'+r.count+'条建议','success');
    await loadRpSummary();
    await loadRp();
  }catch(e){
    showToast('重新计算失败，请稍后重试：'+(e.message||''),'danger');
  }finally{
    buttons.forEach((b,i)=>{b.disabled=false;b.innerHTML=oldLabels[i]||'🔄 重新计算';});
  }
}
function exportRpExcel(){
  try{
    const url='/api/replenishment-suggestions/export?'+rpQuery();
    window.open(url,'_blank');
  }catch(e){showToast(e.message,'danger')}
}
function openRpParams(){
  const v=prompt('预测参数设置\n\n请输入"目标库存月数"（默认4个月）\n说明：工厂备货1个月 + 海运1个月 + 安全库存2个月', localStorage.getItem('rpTargetMonths')||'4');
  if(v!==null){
    const n=parseFloat(v);
    if(n>0){localStorage.setItem('rpTargetMonths',n);showToast('已保存目标库存月数 = '+n,'success');}
    else{showToast('请输入正数','danger');}
  }
}
function toggleGenPO(rid){
  const ck=document.querySelector('.rp-ck[value="'+rid+'"]');
  if(ck) ck.checked=!ck.checked;
}
async function genPOModal(){
  try{
    const suggestions=await api('/api/replenishment-suggestions?'+rpQuery());
    // 根据当前 Tab 过滤建议采购数量 > 0 的 SKU
    var targetField='total_target_stock';
    if(rpTab==='online') targetField='online_target_stock';
    else if(rpTab==='offline') targetField='offline_target_stock';
    const filtered=suggestions.filter(r=>(r[targetField]||0)>0);
    if(!filtered.length){showToast('当前没有需要生成 PO 的 SKU。','warning');return;}
    // 预览窗口：显示建议采购数量 > 0 的 SKU
    const prevHtml='<div class="table-container" style="max-height:50vh;overflow:auto"><table class="data-table"><thead><tr><th>SKU</th><th>Model</th><th class="text-right">建议采购数量</th><th>品牌</th><th>国家</th><th>仓库</th></tr></thead><tbody>'
      +filtered.map((r,i)=>'<tr><td class="cell-id">'+esc(r.sku_code)+'</td><td class="text-truncate" style="max-width:120px">'+esc(r.model||'')+'</td><td class="text-right font-bold">'+(r[targetField]||0)+'</td><td>'+(r.brand||'-')+'</td><td>'+(r.country||'-')+'</td><td>'+(r.target_warehouse||'-')+'</td></tr>').join('')
      +'</tbody></table></div><div style="margin-top:10px;font-weight:600;color:var(--primary)">共 '+filtered.length+' 个 SKU，建议采购总数量：'+filtered.reduce((s,r)=>s+(r[targetField]||0),0)+' 件</div>';
    openModal('生成PO预览','<div style="padding:4px 0"><p style="margin-bottom:12px;color:#666">以下为建议采购数量 > 0 的 SKU，确认后将继续选择供应商并生成 PO。</p>'+prevHtml+'</div>','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="continueGenPO()">确认并继续</button>');
    window._genPOFiltered=filtered;
  }catch(e){showToast(e.message,'danger')}
}
async function continueGenPO(){
  try{
    const filtered=window._genPOFiltered||[];
    if(!filtered.length){closeModal();return;}
    const suppliers=await api('/api/suppliers');
    const items=filtered.map(r=>({id:r.id,sku_code:r.sku_code,brand:r.brand||'',po_qty:rpTab==='online'?(r.online_target_stock||0):rpTab==='offline'?(r.offline_target_stock||0):(r.total_target_stock||0),country:r.country||'',target_warehouse:r.target_warehouse||''}));
    const brands=[...new Set(items.map(i=>i.brand).filter(Boolean))];
    if(!items.length || items.some(i=>!i.brand)){
      showToast('部分 SKU 未配置品牌，请先在 SKU 管理中维护品牌信息。','danger');
      return;
    }
    const activeSuppliers=suppliers.filter(s=>(s.status||'active')==='active');
    const brandSupplier={};
    brands.forEach(brand=>{
      const matched=activeSuppliers.filter(s=>parseSupplierBrands(s).includes(brand));
      if(matched.length===1) brandSupplier[brand]=matched[0];
      else if(matched.length>1) brandSupplier[brand]={ambiguous:true,brand};
    });
    if(brands.some(b=>!brandSupplier[b] || brandSupplier[b].ambiguous)){
      showToast('部分品牌未匹配到唯一供应商，请先在供应商管理中维护品牌与供应商关系。','danger');
      return;
    }
    const supplierIds=[...new Set(brands.map(b=>brandSupplier[b].id))];
    if(supplierIds.length!==1){
      showToast('所选 SKU 属于不同供应商，请分开生成 PO。','warning');
      return;
    }
    const supplier=brandSupplier[brands[0]];
    const country=document.getElementById('rp-c')?.value || items[0]?.country || '';
    const warehouse=document.getElementById('rp-w')?.value || items[0]?.target_warehouse || '';
    const brandText=brands.join(', ');
    const totalQty=items.reduce((s,i)=>s+(parseInt(i.po_qty)||0),0);
    openModal('生成PO','<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'
      +'<div class="form-group"><label>供应商</label><input type="text" id="po-supplier-name" value="'+esc(supplier.name)+'" readonly></div>'
      +'<div class="form-group"><label>品牌</label><input type="text" id="po-brand" value="'+esc(brandText)+'" readonly></div>'
      +'<div class="form-group"><label>国家</label><input type="text" id="po-country" value="'+esc(country)+'" readonly></div>'
      +'<div class="form-group"><label>仓库</label><input type="text" id="po-wh" value="'+esc(warehouse)+'" readonly></div>'
      +'<div class="form-group"><label>币种</label><select id="po-cur">'+['USD','RMB','IDR','MYR','THB'].map(c=>'<option value="'+c+'"'+((supplier.default_currency||'USD')===c?' selected':'')+'>'+c+'</option>').join('')+'</select></div>'
      +'<div class="form-group"><label>PO日期</label><input type="date" id="po-date" value="'+todayStr()+'"></div>'
      +'</div><h4 style="margin:16px 0 8px">SKU明细（可编辑数量）</h4><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th class="text-right">数量</th></tr></thead><tbody>'
      +items.map((it,i)=>'<tr><td class="cell-id">'+esc(it.sku_code)+'</td><td class="text-right"><input type="number" min="0" id="po-qty-'+i+'" value="'+(parseInt(it.po_qty)||0)+'" oninput="updateGenPOSummary()" style="width:100px;padding:4px;text-align:right"></td></tr>').join('')
      +'</tbody></table></div><div style="display:flex;gap:24px;justify-content:flex-end;margin-top:10px;font-weight:600"><span>合计 SKU：<b id="po-sku-total">'+items.length+'</b> 个</span><span>合计数量：<b id="po-qty-total">'+totalQty+'</b> 件</span></div></div>',
      '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveGenPO()">创建PO</button>');
    window._poMeta={supplier_id:supplier.id,supplier_name:supplier.name,brand:brandText,country,target_warehouse:warehouse};
    window._poItems=items;
  }catch(e){showToast(e.message,'danger')}
}
function updateGenPOSummary(){
  const items=window._poItems||[];
  const total=items.reduce((s,it,i)=>s+(parseInt(document.getElementById('po-qty-'+i)?.value)||0),0);
  const el=document.getElementById('po-qty-total'); if(el) el.textContent=total;
}
async function saveGenPO(){
  const meta=window._poMeta||{};
  const d={...meta,currency:document.getElementById('po-cur').value,po_date:document.getElementById('po-date').value,from_suggestion:1,items:(window._poItems||[]).map((it,i)=>({sku_code:it.sku_code,po_qty:parseInt(document.getElementById('po-qty-'+i)?.value)||0,unit_price:0}))};
  try{
    const po=await api('/api/purchase-orders','POST',d);
    showToast('PO创建成功','success');
    openPOExportConfirm(po.id);
  }catch(e){showToast(e.message,'danger')}
}
function openPOExportConfirm(poId){
  openModal('PO 创建成功','<div style="padding:4px 0;font-size:14px">PO 已创建成功，是否立即导出 Excel 格式 PO？</div>','<button class="btn btn-secondary" onclick="closeModal();showPage(\'po\')">取消</button><button class="btn btn-primary" onclick="exportPO(\''+poId+'\');closeModal();showPage(\'po\')">导出 Excel</button>');
}
// ==================== PO管理 ====================
async function renderPO(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="po-fs"><option value="">全部</option><option value="draft">草稿</option><option value="pending_approval">待审批</option><option value="approved">已审批</option><option value="sent_factory">已发工厂</option><option value="partial_pi">部分转PI</option><option value="transferred_pi">已转PI</option></select></div><div class="filter-group"><label>关键词</label><input type="text" id="po-fk" onkeypress="if(event.key===\'Enter\')loadPO()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadPO()">搜索</button>'+(hasPermission('po_create')?'<button class="btn btn-primary btn-sm" onclick="createPO()">➕ 新建PO</button>':'')+'</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🛒 PO列表</div></div><div id="po-table"></div></div>';
  loadPO();
}
async function loadPO(){
  try{
    const s=document.getElementById('po-fs')?.value||'',k=document.getElementById('po-fk')?.value||'';
    const data=await api('/api/purchase-orders?status='+s+'&keyword='+encodeURIComponent(k));
    document.getElementById('po-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">🛒</div>暂无PO</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>PO号</th><th>供应商</th><th>品牌</th><th>国家</th><th>仓库</th><th>PO日期</th><th>币种</th><th>明细</th><th>PO状态</th><th>审批</th><th>操作</th></tr></thead><tbody>'+data.map(p=>'<tr><td class="cell-id"><span class="link-text" onclick="viewPO(\''+p.id+'\')">'+esc(p.po_no)+'</span></td><td>'+esc(p.supplier_name)+'</td><td>'+esc(p.brand)+'</td><td>'+esc(p.country)+'</td><td>'+esc(p.target_warehouse)+'</td><td class="cell-date">'+fmtDate(p.po_date)+'</td><td>'+esc(p.currency)+'</td><td class="text-center">'+(p.item_count||0)+'</td><td><span class="status-badge '+((p.po_status==='approved'||p.po_status==='transferred_pi')?'status-completed':p.po_status==='pending_approval'?'status-pending':'status-draft')+'">'+esc(p.po_status)+'</span></td><td><span class="status-badge '+(p.approval_status==='approved'?'status-approved':p.approval_status==='rejected'?'status-rejected':'status-pending')+'">'+esc(p.approval_status)+'</span></td><td class="cell-actions"><button class="action-btn" onclick="viewPO(\''+p.id+'\')">👁️</button>'+(p.po_status==='draft'&&hasPermission('po_create')?'<button class="action-btn" onclick="submitPO(\''+p.id+'\')" title="提交审批">📤</button>':'')+(p.po_status==='approved'&&hasPermission('po_create')?'<button class="action-btn" onclick="sendFactory(\''+p.id+'\')" title="发工厂">📨</button>':'')+((hasPermission('po_export')||hasPermission('po_create'))?'<button class="action-btn" onclick="exportPO(\''+p.id+'\')" title="导出Excel">📊</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function viewPO(id){
  try{const po=await api('/api/purchase-orders/'+id);
    const totalQty=(po.items||[]).reduce((s,i)=>s+(i.po_qty||0),0);
    openModal('PO详情 - '+po.po_no,'<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>基本信息</h3><div class="detail-grid">'+['po_no','supplier_name','brand','country','target_warehouse','po_date','currency','po_status','approval_status','created_by_name'].map(f=>'<div class="detail-item"><span class="detail-label">'+f+'</span><span class="detail-value">'+esc(po[f])+'</span></div>').join('')+'</div></div><div class="detail-section"><h3>PO明细</h3><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th class="text-right">数量</th></tr></thead><tbody>'+(po.items||[]).map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.po_qty+'</td></tr>').join('')+'</tbody></table></div><div style="display:flex;gap:24px;justify-content:flex-end;margin-top:10px;font-weight:600"><span>合计 SKU：'+(po.items||[]).length+' 个</span><span>合计数量：'+totalQty+' 件</span></div></div></div>');
  }catch(e){showToast(e.message,'danger')}
}
async function createPO(){
  const suppliers=await api('/api/suppliers');
  openModal('新建PO','<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>供应商 <span class="required">*</span></label><select id="npo-sup">'+suppliers.map(s=>'<option value="'+s.id+'" data-name="'+esc(s.name)+'">'+esc(s.name)+'</option>').join('')+'</select></div><div class="form-group"><label>品牌</label><input type="text" id="npo-brand"></div><div class="form-group"><label>国家</label><input type="text" id="npo-country"></div><div class="form-group"><label>仓库</label><input type="text" id="npo-wh"></div><div class="form-group"><label>PO日期</label><input type="date" id="npo-date" value="'+todayStr()+'"></div><div class="form-group"><label>币种</label><select id="npo-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div></div><h4 style="margin:16px 0 8px">明细 <button class="btn btn-secondary btn-sm" onclick="addPORow()">➕ 添加</button></h4><div id="po-items"></div></div>','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveNewPO()">创建</button>');
  window._poR=0;addPORow();
}
function addPORow(){const c=document.getElementById('po-items');const i=window._poR++;c.innerHTML+='<div class="flex gap-8 mb-8" id="po-r-'+i+'"><input type="text" placeholder="SKU" id="po-rs-'+i+'" style="flex:1"><input type="number" placeholder="数量" id="po-rq-'+i+'" style="width:100px"><button class="btn btn-danger btn-sm" onclick="document.getElementById(\'po-r-'+i+'\').remove()">🗑️</button></div>'}
async function saveNewPO(){
  const sel=document.getElementById('npo-sup');const items=[];
  for(let i=0;i<window._poR;i++){const sku=document.getElementById('po-rs-'+i)?.value;if(sku)items.push({sku_code:sku,po_qty:parseInt(document.getElementById('po-rq-'+i).value)||0,unit_price:0})}
  const d={supplier_id:sel.value,supplier_name:sel.options[sel.selectedIndex].dataset.name,brand:document.getElementById('npo-brand').value,country:document.getElementById('npo-country').value,target_warehouse:document.getElementById('npo-wh').value,po_date:document.getElementById('npo-date').value,currency:document.getElementById('npo-cur').value,items};
  try{await api('/api/purchase-orders','POST',d);showToast('PO创建成功','success');closeModal();loadPO()}catch(e){showToast(e.message,'danger')}
}
async function submitPO(id){if(!confirm('确认提交审批？'))return;try{await api('/api/purchase-orders/'+id+'/submit-approval','POST',{submitter_name:currentUser.name});showToast('已提交审批','success');loadPO()}catch(e){showToast(e.message,'danger')}}
async function sendFactory(id){if(!confirm('确认已发工厂？'))return;try{await api('/api/purchase-orders/'+id+'/send-to-factory','POST');showToast('已标记发工厂','success');loadPO()}catch(e){showToast(e.message,'danger')}}
async function exportPO(id){
  try{
    const po=await api('/api/purchase-orders/'+id);
    const totalQty=(po.items||[]).reduce((s,i)=>s+(i.po_qty||0),0);
    const ws=XLSX.utils.json_to_sheet([
      {字段:'PO编号',内容:po.po_no},
      {字段:'PO日期',内容:po.po_date},
      {字段:'供应商',内容:po.supplier_name},
      {字段:'品牌',内容:po.brand},
      {字段:'国家',内容:po.country},
      {字段:'仓库',内容:po.target_warehouse},
      {字段:'币种',内容:po.currency}
    ]);
    const detailRows=(po.items||[]).map(i=>({SKU:i.sku_code,数量:i.po_qty}));
    detailRows.push({SKU:'合计 SKU 数量',数量:(po.items||[]).length});
    detailRows.push({SKU:'合计采购数量',数量:totalQty});
    const ws2=XLSX.utils.json_to_sheet(detailRows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'PO信息');
    XLSX.utils.book_append_sheet(wb,ws2,'SKU明细');
    XLSX.writeFile(wb,'PO_'+po.po_no+'.xlsx');
  }catch(e){showToast(e.message,'danger')}
}

// ==================== PI管理 ====================
async function renderPI(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="pi-fs"><option value="">全部</option><option value="pending">待上传 PI</option><option value="uploaded">已上传 PI</option><option value="confirmed">已确认</option><option value="pending_deposit">待定金审批</option><option value="deposit_paid">定金已付款</option><option value="producing">生产中</option><option value="pending_ci_pl">待 CI/PL</option><option value="cancelled">已取消</option></select></div><div class="filter-group"><label>关键词</label><input type="text" id="pi-fk" onkeypress="if(event.key===\'Enter\')loadPI()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadPI()">搜索</button>'+(hasPermission('pi_create')?'<button class="btn btn-secondary btn-sm" onclick="downloadDocTemplate(\'pi\')">📥 PI模板</button><button class="btn btn-secondary btn-sm" onclick="openDocImport(\'pi\')">📤 批量导入PI</button><button class="btn btn-primary btn-sm" onclick="createPI()">➕ 新建PI</button>':'')+'</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📄 PI列表</div></div><div id="pi-table"></div></div>';
  loadPI();
}
async function loadPI(){
  try{
    const s=document.getElementById('pi-fs')?.value||'',k=document.getElementById('pi-fk')?.value||'';
    const data=await api('/api/proforma-invoices?status='+s+'&keyword='+encodeURIComponent(k));
    document.getElementById('pi-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">📄</div>暂无PI</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>PI号</th><th>关联PO</th><th>供应商</th><th>品牌</th><th>国家</th><th>仓库</th><th>日期</th><th>币种</th><th>总金额</th><th>是否定金</th><th>定金比例</th><th>定金金额</th><th>定金状态</th><th>PI状态</th><th>操作</th></tr></thead><tbody>'+data.map(p=>'<tr><td class="cell-id"><span class="link-text" onclick="viewPI(\''+p.id+'\')">'+esc(p.pi_no)+'</span></td><td class="cell-id">'+esc(p.related_po_no)+'</td><td>'+esc(p.supplier_name)+'</td><td>'+esc(p.brand)+'</td><td>'+esc(p.country)+'</td><td>'+esc(p.target_warehouse)+'</td><td class="cell-date">'+fmtDate(p.pi_date)+'</td><td>'+esc(p.currency)+'</td><td class="text-right">'+fmtMoney(p.total_amount)+'</td><td>'+(p.need_deposit?'<span class="status-badge status-pending">是</span>':'<span class="status-badge status-completed">否</span>')+'</td><td class="text-right">'+(p.deposit_ratio||0)+'%</td><td class="text-right">'+fmtMoney(p.payable_deposit)+'</td><td><span class="status-badge '+(p.deposit_payment_status==='paid'?'status-paid':'status-unpaid')+'">'+esc(p.deposit_payment_status)+'</span></td><td><span class="status-badge status-pending">'+esc(p.pi_status)+'</span></td><td class="cell-actions"><button class="action-btn" onclick="viewPI(\''+p.id+'\')">👁️</button><button class="action-btn" onclick="uploadDocAttachment(\'pi\',\''+p.id+'\',\'attachment\')" title="上传PI附件">📎</button>'+(p.need_deposit&&p.payable_deposit>0&&p.deposit_payment_status==='unpaid'&&hasPermission('payment_create')?'<button class="action-btn" onclick="createDepPay(\''+p.id+'\')" title="定金付款">💰</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function viewPI(id){
  try{const pi=await api('/api/proforma-invoices/'+id);
    openModal('PI详情 - '+pi.pi_no,'<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>基本信息</h3><div class="detail-grid">'+['pi_no','related_po_no','supplier_name','brand','country','target_warehouse','pi_date','currency','total_amount','payment_terms','need_deposit','deposit_ratio','payable_deposit','expected_delivery','pi_status'].map(f=>'<div class="detail-item"><span class="detail-label">'+f+'</span><span class="detail-value">'+(f==='need_deposit'?(pi[f]?'是':'否'):esc(pi[f]))+'</span></div>').join('')+attachmentHtml('pi',pi.id,'attachment',pi.attachment,'PI附件')+'</div></div><div class="detail-section"><h3>PI明细</h3><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>PO数量</th><th>PI确认</th><th>单价</th><th>金额</th><th>已发货</th><th>未发货</th></tr></thead><tbody>'+(pi.items||[]).map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.po_qty+'</td><td class="text-right">'+i.pi_confirmed_qty+'</td><td class="text-right">'+fmtMoney(i.unit_price)+'</td><td class="text-right">'+fmtMoney(i.pi_amount)+'</td><td class="text-right">'+(i.shipped_qty||0)+'</td><td class="text-right">'+(i.unshipped_qty||0)+'</td></tr>').join('')+'</tbody></table></div></div></div>');
  }catch(e){showToast(e.message,'danger')}
}
async function createPI(){
  const suppliers=await api('/api/suppliers');const pos=await api('/api/purchase-orders?status=approved');
  openModal('新建PI','<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>关联PO</label><select id="npi-po" onchange="loadPOForPI()"><option value="">无关联</option>'+pos.map(p=>'<option value="'+p.id+'" data-no="'+p.po_no+'">'+esc(p.po_no)+' - '+esc(p.supplier_name)+'</option>').join('')+'</select></div><div class="form-group"><label>供应商 <span class="required">*</span></label><select id="npi-sup">'+suppliers.map(s=>'<option value="'+s.id+'" data-name="'+esc(s.name)+'">'+esc(s.name)+'</option>').join('')+'</select></div><div class="form-group"><label>PI日期</label><input type="date" id="npi-date" value="'+todayStr()+'"></div><div class="form-group"><label>币种</label><select id="npi-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div><div class="form-group"><label>是否需要定金</label><select id="npi-need-dep" onchange="togglePIDeposit()"><option value="1">是</option><option value="0">否</option></select></div><div class="form-group"><label>定金比例(%)</label><input type="number" id="npi-dep" value="30"></div><div class="form-group"><label>预计交期</label><input type="date" id="npi-del"></div><div class="form-group"><label>付款条件</label><input type="text" id="npi-terms"></div></div><h4 style="margin:16px 0 8px">明细 <button class="btn btn-secondary btn-sm" onclick="addPIRow()">➕ 添加</button></h4><div id="pi-items"></div></div>','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveNewPI()">创建</button>');
  window._piR=0;addPIRow();
}
function togglePIDeposit(){const need=document.getElementById('npi-need-dep')?.value!=='0';const dep=document.getElementById('npi-dep');if(dep){dep.disabled=!need;if(!need)dep.value=0;else if(!dep.value||dep.value==='0')dep.value=30;}}
function addPIRow(){const c=document.getElementById('pi-items');const i=window._piR++;c.innerHTML+='<div class="flex gap-8 mb-8" id="pi-r-'+i+'"><input type="text" placeholder="SKU" id="pi-rs-'+i+'" style="flex:1"><input type="number" placeholder="PO量" id="pi-rpq-'+i+'" style="width:90px"><input type="number" placeholder="PI确认" id="pi-rpq2-'+i+'" style="width:90px"><input type="number" step="0.01" placeholder="单价" id="pi-rp-'+i+'" style="width:120px"><button class="btn btn-danger btn-sm" onclick="document.getElementById(\'pi-r-'+i+'\').remove()">🗑️</button></div>'}
async function loadPOForPI(){const poId=document.getElementById('npi-po').value;if(!poId)return;try{const po=await api('/api/purchase-orders/'+poId);document.getElementById('npi-sup').value=po.supplier_id;document.getElementById('npi-cur').value=po.currency;document.getElementById('pi-items').innerHTML='';window._piR=0;(po.items||[]).forEach(item=>{addPIRow();const i=window._piR-1;document.getElementById('pi-rs-'+i).value=item.sku_code;document.getElementById('pi-rpq-'+i).value=item.po_qty;document.getElementById('pi-rp-'+i).value=item.unit_price})}catch(e){}}
async function saveNewPI(){
  const poSel=document.getElementById('npi-po'),supSel=document.getElementById('npi-sup');const items=[];
  for(let i=0;i<window._piR;i++){const sku=document.getElementById('pi-rs-'+i)?.value;if(sku)items.push({sku_code:sku,po_qty:parseInt(document.getElementById('pi-rpq-'+i).value)||0,pi_confirmed_qty:parseInt(document.getElementById('pi-rpq2-'+i).value)||0,unit_price:parseFloat(document.getElementById('pi-rp-'+i).value)||0})}
  const d={related_po_id:poSel.value||'',related_po_no:poSel.options[poSel.selectedIndex]?.dataset.no||'',supplier_id:supSel.value,supplier_name:supSel.options[supSel.selectedIndex].dataset.name,pi_date:document.getElementById('npi-date').value,currency:document.getElementById('npi-cur').value,need_deposit:document.getElementById('npi-need-dep').value==='1'?1:0,deposit_ratio:parseFloat(document.getElementById('npi-dep').value)||0,expected_delivery:document.getElementById('npi-del').value,payment_terms:document.getElementById('npi-terms').value,items};
  try{await api('/api/proforma-invoices','POST',d);showToast('PI创建成功','success');closeModal();loadPI()}catch(e){showToast(e.message,'danger')}
}
async function createDepPay(id){
  try{
    const pi=await api('/api/proforma-invoices/'+id);
    openModal('创建定金付款申请 - '+pi.pi_no,
      '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div class="detail-grid mb-16">'+
        '<div class="detail-item"><span class="detail-label">PI总金额</span><span class="detail-value">'+fmtMoney(pi.total_amount)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">定金比例</span><span class="detail-value">'+(pi.deposit_ratio||0)+'%</span></div>'+
        '<div class="detail-item"><span class="detail-label">应付定金</span><span class="detail-value font-bold">'+fmtMoney(pi.payable_deposit)+'</span></div>'+
      '</div>'+
      '<div class="form-grid">'+
        '<div class="form-group"><label>是否抵扣</label><select id="dep-ded" onchange="document.getElementById(\'dep-ded-amt\').disabled=this.value===\'0\'"><option value="0">否</option><option value="1">是</option></select></div>'+
        '<div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="dep-ded-amt" value="0" disabled></div>'+
        '<div class="form-group"><label>抵扣来源类型</label><select id="dep-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="quality_claim">质量索赔</option><option value="advance_payment">预付款抵扣</option><option value="other">其他</option></select></div>'+
        '<div class="form-group"><label>抵扣参考号</label><input type="text" id="dep-ded-ref"></div>'+
        '<div class="form-group form-group-full"><label>抵扣说明</label><textarea id="dep-ded-desc" rows="2"></textarea></div>'+
      '</div></div>',
      '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveDepPay(\''+id+'\')">创建</button>');
  }catch(e){showToast(e.message,'danger')}
}
async function saveDepPay(id){
  const d={pi_id:id,has_deduction:parseInt(document.getElementById('dep-ded').value),deduction_amount:parseFloat(document.getElementById('dep-ded-amt').value)||0,deduction_source_type:document.getElementById('dep-ded-type').value,deduction_source_desc:document.getElementById('dep-ded-desc').value,deduction_ref_no:document.getElementById('dep-ded-ref').value};
  try{await api('/api/payment-requests/from-pi-deposit','POST',d);showToast('定金付款申请已生成','success');closeModal()}catch(e){showToast(e.message,'danger')}
}

const DOC_TEMPLATES={
  pi:{file:'PI导入模板.xlsx',sheet:'PI',url:'/api/proforma-invoices/batch-import',headers:['PI编号','关联PO编号','供应商','品牌','国家','仓库','币种','PI日期','是否需要定金','定金比例','预计交期','付款条件','SKU','数量','单价','备注'],sample:['PI-2026-001','PO-2026-001','','','','','USD',todayStr(),'是',30,'','','SKU001',100,1.5,'']},
  ci:{file:'CI导入模板.xlsx',sheet:'CI',url:'/api/commercial-invoices/batch-import',headers:['CI编号','关联PO编号','关联PI编号','供应商','品牌','国家','仓库','币种','CI日期','SKU','数量','单价','差异原因','备注'],sample:['CI-2026-001','PO-2026-001','PI-2026-001','','','','','USD',todayStr(),'SKU001',100,1.5,'','']},
  pl:{file:'PL导入模板.xlsx',sheet:'PL',url:'/api/packing-lists/batch-import',headers:['PL编号','关联PO编号','关联CI编号','PL日期','箱号','SKU','每箱数量','箱数','总数量','单箱毛重','单箱净重','单箱体积','备注'],sample:['PL-2026-001','PO-2026-001','CI-2026-001',todayStr(),'CTN-001','SKU001',10,10,100,12,10,0.08,'']}
};
function downloadDocTemplate(type){
  const t=DOC_TEMPLATES[type]; if(!t)return;
  const ws=XLSX.utils.aoa_to_sheet([t.headers,t.sample]);
  ws['!cols']=t.headers.map(h=>({wch:Math.max(10,h.length*2+2)}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,t.sheet);XLSX.writeFile(wb,t.file);
}
function openDocImport(type){
  const t=DOC_TEMPLATES[type]; if(!t)return;
  openModal('批量导入'+t.sheet,'<div class="form-card" style="box-shadow:none;padding:0"><div id="doc-import-drop" style="border:2px dashed #d9d9d9;border-radius:8px;padding:34px 20px;text-align:center;cursor:pointer;background:#fafafa" onclick="document.getElementById(\'doc-import-file\').click()"><div style="font-size:42px;color:#1890ff;margin-bottom:8px">📤</div><div>点击上传 Excel / CSV 文件</div><div style="font-size:12px;color:#999;margin-top:4px">支持 .xlsx / .xls / .csv</div></div><input type="file" id="doc-import-file" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleDocImportFile(\''+type+'\',this.files[0])"><div id="doc-import-result" style="margin-top:14px"></div></div>','<button class="btn btn-secondary" onclick="downloadDocTemplate(\''+type+'\')">下载模板</button><button class="btn btn-secondary" onclick="closeModal()">关闭</button>');
}
function handleDocImportFile(type,file){
  if(!file)return;const t=DOC_TEMPLATES[type];const r=new FileReader();
  r.onload=async e=>{try{const data=new Uint8Array(e.target.result);const wb=XLSX.read(data,{type:'array',cellDates:true});const ws=wb.Sheets[wb.SheetNames[0]];const items=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false,dateNF:'yyyy-mm-dd'});const res=await api(t.url,'POST',{items});renderDocImportResult(res);if(type==='pi')loadPI();if(type==='ci'||type==='pl')loadCI();}catch(err){showToast('导入失败：'+err.message,'danger')}};r.readAsArrayBuffer(file);
}
function renderDocImportResult(res){
  const errs=res.errors||[];
  let html='<div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:10px;margin-bottom:10px">导入完成：成功 '+(res.success||0)+' 条，失败 '+(res.failed||0)+' 条</div>';
  (res.messages||[]).forEach(m=>html+='<div style="background:#fffbe6;border:1px solid #ffe58f;border-radius:6px;padding:8px;margin-bottom:8px">'+esc(m)+'</div>');
  if(errs.length)html+='<div class="table-container" style="max-height:260px;overflow:auto;box-shadow:none;border:1px solid #eee"><table class="data-table"><thead><tr><th>行号</th><th>失败原因</th></tr></thead><tbody>'+errs.map(e=>'<tr><td>'+e.row+'</td><td>'+esc(e.reason||e.error)+'</td></tr>').join('')+'</tbody></table></div>';
  document.getElementById('doc-import-result').innerHTML=html;
}
function parseAttachmentValue(v){try{return typeof v==='string'?JSON.parse(v):v}catch(e){return v?{name:'附件',dataUrl:v}:null}}
function attachmentHtml(docType,id,field,val,label){
  const a=parseAttachmentValue(val);const has=a&&a.dataUrl;
  return '<div class="detail-item"><span class="detail-label">'+label+'</span><span class="detail-value">'+(has?'<span class="link-text" onclick="downloadAttachment(\''+docType+'\',\''+id+'\',\''+field+'\')">'+esc(a.name||label)+'</span> <button class="btn btn-secondary btn-sm" onclick="uploadDocAttachment(\''+docType+'\',\''+id+'\',\''+field+'\')">重传</button> <button class="btn btn-danger btn-sm" onclick="deleteDocAttachment(\''+docType+'\',\''+id+'\',\''+field+'\')">删除</button>':'<button class="btn btn-secondary btn-sm" onclick="uploadDocAttachment(\''+docType+'\',\''+id+'\',\''+field+'\')">上传</button>')+'</span></div>';
}
async function uploadDocAttachment(docType,id,field){
  const inp=document.createElement('input');inp.type='file';inp.accept='.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp';
  inp.onchange=()=>{const f=inp.files[0];if(!f)return;const r=new FileReader();r.onload=async e=>{const attachment={name:f.name,type:f.type,size:f.size,dataUrl:e.target.result,uploaded_at:new Date().toISOString()};try{const url=docType==='pi'?'/api/proforma-invoices/'+id+'/attachment':'/api/commercial-invoices/'+id+'/attachment';await api(url,'POST',{field,attachment});showToast('附件已上传','success');docType==='pi'?loadPI():loadCI();}catch(err){showToast(err.message,'danger')}};r.readAsDataURL(f)};inp.click();
}
async function deleteDocAttachment(docType,id,field){try{const url=docType==='pi'?'/api/proforma-invoices/'+id+'/attachment':'/api/commercial-invoices/'+id+'/attachment';await api(url,'POST',{field,attachment:''});showToast('附件已删除','success');closeModal();docType==='pi'?loadPI():loadCI();}catch(e){showToast(e.message,'danger')}}
async function downloadAttachment(docType,id,field){const d=await api((docType==='pi'?'/api/proforma-invoices/':'/api/commercial-invoices/')+id);const a=parseAttachmentValue(d[field]);if(!a||!a.dataUrl){showToast('暂无附件','warning');return}const link=document.createElement('a');link.href=a.dataUrl;link.download=a.name||'附件';link.click();}

// ==================== CI/PL管理 ====================
async function renderCI(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="ci-fs"><option value="">全部</option><option value="draft">待上传 CI/PL</option><option value="uploaded">已上传 CI/PL</option><option value="checking">待核对</option><option value="checked">已核对</option><option value="pending_balance">待尾款审批</option><option value="balance_paid">尾款已付款</option><option value="shipped">已发货</option><option value="customs">清关中</option><option value="completed">已完成</option></select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadCI()">搜索</button>'+(hasPermission('ci_create')?'<button class="btn btn-secondary btn-sm" onclick="downloadDocTemplate(\'ci\')">📥 CI模板</button><button class="btn btn-secondary btn-sm" onclick="openDocImport(\'ci\')">📤 导入CI</button><button class="btn btn-secondary btn-sm" onclick="downloadDocTemplate(\'pl\')">📥 PL模板</button><button class="btn btn-secondary btn-sm" onclick="openDocImport(\'pl\')">📦 导入PL</button><button class="btn btn-primary btn-sm" onclick="createCI()">➕ 新建CI</button>':'')+'</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🚚 CI/PL列表</div></div><div id="ci-table"></div></div>';
  loadCI();
}
async function loadCI(){
  try{
    const s=document.getElementById('ci-fs')?.value||'';
    const data=await api('/api/commercial-invoices?status='+s);
    document.getElementById('ci-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">🚚</div>暂无CI</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>CI号</th><th>关联PO</th><th>关联PI</th><th>供应商</th><th>品牌</th><th>国家</th><th>仓库</th><th>日期</th><th>币种</th><th>CI金额</th><th>已付定金</th><th>应付尾款</th><th>差异</th><th>状态</th><th>操作</th></tr></thead><tbody>'+data.map(c=>'<tr><td class="cell-id"><span class="link-text" onclick="viewCI(\''+c.id+'\')">'+esc(c.ci_no)+'</span></td><td class="cell-id">'+esc(c.related_po_no)+'</td><td class="cell-id">'+esc(c.related_pi_no)+'</td><td>'+esc(c.supplier_name)+'</td><td>'+esc(c.brand)+'</td><td>'+esc(c.country)+'</td><td>'+esc(c.target_warehouse)+'</td><td class="cell-date">'+fmtDate(c.ci_date)+'</td><td>'+esc(c.currency)+'</td><td class="text-right">'+fmtMoney(c.goods_amount)+'</td><td class="text-right">'+fmtMoney(c.actual_deducted_deposit)+'</td><td class="text-right">'+fmtMoney(c.payable_balance)+'</td><td class="text-right">'+fmtMoney(c.amount_difference)+'</td><td><span class="status-badge status-pending">'+esc(c.ci_status)+'</span></td><td class="cell-actions"><button class="action-btn" onclick="viewCI(\''+c.id+'\')">👁️</button><button class="action-btn" onclick="uploadDocAttachment(\'ci\',\''+c.id+'\',\'attachment\')" title="上传CI附件">📎</button><button class="action-btn" onclick="uploadDocAttachment(\'ci\',\''+c.id+'\',\'pl_attachment\')" title="上传PL附件">📦</button>'+(c.payable_balance>0&&c.balance_payment_status==='unpaid'&&hasPermission('payment_create')?'<button class="action-btn" onclick="createBalPay(\''+c.id+'\')" title="尾款付款">💰</button>':'')+(hasPermission('cost_view')?'<button class="action-btn" onclick="viewCICost(\''+c.id+'\')" title="费用管理">📊</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function viewCI(id){
  try{const ci=await api('/api/commercial-invoices/'+id);
    const pl=ci.packing_list||{};const plItems=pl.items||[];
    openModal('CI/PL详情 - '+ci.ci_no,'<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>基本信息</h3><div class="detail-grid">'+['ci_no','related_po_no','related_pi_no','supplier_name','brand','country','target_warehouse','ci_date','currency','goods_amount','pi_total_amount','amount_difference','difference_reason','actual_deducted_deposit','payable_balance','ci_status','balance_payment_status'].map(f=>'<div class="detail-item"><span class="detail-label">'+f+'</span><span class="detail-value">'+esc(ci[f])+'</span></div>').join('')+attachmentHtml('ci',ci.id,'attachment',ci.attachment,'CI附件')+attachmentHtml('ci',ci.id,'pl_attachment',ci.pl_attachment,'PL附件')+'</div></div><div class="detail-section"><h3>CI明细</h3><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>数量</th><th>单价</th><th>金额</th><th>已入库</th><th>未入库</th></tr></thead><tbody>'+(ci.items||[]).map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.shipped_qty+'</td><td class="text-right">'+fmtMoney(i.unit_price)+'</td><td class="text-right">'+fmtMoney(i.ci_amount)+'</td><td class="text-right">'+(i.inbound_qty||0)+'</td><td class="text-right">'+(i.uninbound_qty||0)+'</td></tr>').join('')+'</tbody></table></div></div><div class="detail-section"><h3>PL明细</h3>'+(plItems.length?'<div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>每箱数量</th><th>箱数</th><th>总数量</th><th>总毛重</th><th>总净重</th><th>总体积</th></tr></thead><tbody>'+plItems.map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.qty_per_carton+'</td><td class="text-right">'+i.cartons+'</td><td class="text-right">'+i.total_qty+'</td><td class="text-right">'+i.gross_weight+'</td><td class="text-right">'+i.net_weight+'</td><td class="text-right">'+i.cbm+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty-state"><div class="empty-icon">📦</div>暂无PL明细</div>')+'</div><div class="detail-section"><h3>CI vs PL 数量核对</h3><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>CI数量</th><th>PL数量</th><th>差异</th></tr></thead><tbody>'+(ci.pl_check||[]).map(r=>'<tr><td class="cell-id">'+esc(r.sku_code)+'</td><td class="text-right">'+r.ci_qty+'</td><td class="text-right">'+r.pl_qty+'</td><td class="text-right '+(r.diff_qty!==0?'text-danger':'')+'">'+r.diff_qty+'</td></tr>').join('')+'</tbody></table></div></div></div>');
  }catch(e){showToast(e.message,'danger')}
}
async function createCI(){
  const suppliers=await api('/api/suppliers');const pis=await api('/api/proforma-invoices');
  openModal('新建CI','<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>关联PI</label><select id="nci-pi" onchange="loadPIForCI()"><option value="">无关联</option>'+pis.map(p=>'<option value="'+p.id+'" data-no="'+p.pi_no+'" data-supid="'+p.supplier_id+'" data-supname="'+esc(p.supplier_name)+'" data-cur="'+p.currency+'">'+esc(p.pi_no)+' - '+esc(p.supplier_name)+'</option>').join('')+'</select></div><div class="form-group"><label>供应商 <span class="required">*</span></label><select id="nci-sup">'+suppliers.map(s=>'<option value="'+s.id+'" data-name="'+esc(s.name)+'">'+esc(s.name)+'</option>').join('')+'</select></div><div class="form-group"><label>CI日期</label><input type="date" id="nci-date" value="'+todayStr()+'"></div><div class="form-group"><label>发货批次</label><input type="number" id="nci-batch" value="1"></div><div class="form-group"><label>币种</label><select id="nci-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div></div><h4 style="margin:16px 0 8px">CI明细 <button class="btn btn-secondary btn-sm" onclick="addCIRow()">➕ 添加</button></h4><div id="ci-items"></div></div>','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveNewCI()">创建</button>');
  window._ciR=0;addCIRow();
}
function addCIRow(){const c=document.getElementById('ci-items');const i=window._ciR++;c.innerHTML+='<div class="flex gap-8 mb-8" id="ci-r-'+i+'"><input type="text" placeholder="SKU" id="ci-rs-'+i+'" style="flex:1"><input type="number" placeholder="发货量" id="ci-rq-'+i+'" style="width:110px"><input type="number" step="0.01" placeholder="单价" id="ci-rp-'+i+'" style="width:120px"><button class="btn btn-danger btn-sm" onclick="document.getElementById(\'ci-r-'+i+'\').remove()">🗑️</button></div>'}
async function loadPIForCI(){const piSel=document.getElementById('nci-pi');if(!piSel.value)return;const opt=piSel.options[piSel.selectedIndex];document.getElementById('nci-sup').value=opt.dataset.supid;document.getElementById('nci-cur').value=opt.dataset.cur;try{const pi=await api('/api/proforma-invoices/'+piSel.value);document.getElementById('ci-items').innerHTML='';window._ciR=0;(pi.items||[]).forEach(item=>{addCIRow();const i=window._ciR-1;document.getElementById('ci-rs-'+i).value=item.sku_code;document.getElementById('ci-rq-'+i).value=item.unshipped_qty||0;document.getElementById('ci-rp-'+i).value=item.unit_price})}catch(e){}}
async function saveNewCI(){
  const piSel=document.getElementById('nci-pi'),supSel=document.getElementById('nci-sup');const items=[];
  for(let i=0;i<window._ciR;i++){const sku=document.getElementById('ci-rs-'+i)?.value;if(sku)items.push({sku_code:sku,shipped_qty:parseInt(document.getElementById('ci-rq-'+i).value)||0,unit_price:parseFloat(document.getElementById('ci-rp-'+i).value)||0})}
  const d={related_pi_id:piSel.value||'',related_pi_no:piSel.options[piSel.selectedIndex]?.dataset.no||'',supplier_id:supSel.value,supplier_name:supSel.options[supSel.selectedIndex].dataset.name,ci_date:document.getElementById('nci-date').value,shipment_batch:parseInt(document.getElementById('nci-batch').value)||1,currency:document.getElementById('nci-cur').value,items};
  try{await api('/api/commercial-invoices','POST',d);showToast('CI创建成功','success');closeModal();loadCI()}catch(e){showToast(e.message,'danger')}
}
async function createBalPay(id){
  try{
    const ci=await api('/api/commercial-invoices/'+id);
    openModal('创建尾款付款申请 - '+ci.ci_no,
      '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div class="detail-grid mb-16">'+
        '<div class="detail-item"><span class="detail-label">CI金额</span><span class="detail-value">'+fmtMoney(ci.goods_amount)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">已抵扣定金</span><span class="detail-value">'+fmtMoney(ci.actual_deducted_deposit)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">应付尾款</span><span class="detail-value font-bold">'+fmtMoney(ci.payable_balance)+'</span></div>'+
      '</div>'+
      '<div class="form-grid">'+
        '<div class="form-group"><label>是否抵扣</label><select id="bal-ded" onchange="document.getElementById(\'bal-ded-amt\').disabled=this.value===\'0\'"><option value="0">否</option><option value="1">是</option></select></div>'+
        '<div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="bal-ded-amt" value="0" disabled></div>'+
        '<div class="form-group"><label>抵扣来源类型</label><select id="bal-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="quality_claim">质量索赔</option><option value="advance_payment">预付款抵扣</option><option value="other">其他</option></select></div>'+
        '<div class="form-group"><label>抵扣参考号</label><input type="text" id="bal-ded-ref"></div>'+
        '<div class="form-group form-group-full"><label>抵扣说明</label><textarea id="bal-ded-desc" rows="2"></textarea></div>'+
      '</div></div>',
      '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveBalPay(\''+id+'\')">创建</button>');
  }catch(e){showToast(e.message,'danger')}
}
async function saveBalPay(id){
  const d={ci_id:id,has_deduction:parseInt(document.getElementById('bal-ded').value),deduction_amount:parseFloat(document.getElementById('bal-ded-amt').value)||0,deduction_source_type:document.getElementById('bal-ded-type').value,deduction_source_desc:document.getElementById('bal-ded-desc').value,deduction_ref_no:document.getElementById('bal-ded-ref').value};
  try{await api('/api/payment-requests/from-ci-balance','POST',d);showToast('尾款付款申请已生成','success');closeModal()}catch(e){showToast(e.message,'danger')}
}
// CI费用管理入口
async function viewCICost(id){
  try{
    const summary=await api('/api/commercial-invoices/'+id+'/cost-summary');
    const ci=await api('/api/commercial-invoices/'+id);
    openModal('CI费用管理 - '+ci.ci_no,
      '<div class="form-card" style="box-shadow:none;padding:0">'+
      // 费用标记
      '<div class="detail-section"><h3>费用标记</h3><div class="detail-grid">'+
        '<div class="detail-item"><span class="detail-label">有关税</span><span class="detail-value">'+(summary.has_customs_duty?'✅ 是':'❌ 否')+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">有商检费用</span><span class="detail-value">'+(summary.has_inspection_fee?'✅ 是':'❌ 否')+'</span></div>'+
      '</div>'+
      (hasPermission('ci_edit')?'<div class="flex gap-8 mt-16"><button class="btn btn-secondary btn-sm" onclick="toggleCiCostFlag(\''+id+'\','+(summary.has_customs_duty?0:1)+',null)">切换关税标记</button><button class="btn btn-secondary btn-sm" onclick="toggleCiCostFlag(\''+id+'\',null,'+(summary.has_inspection_fee?0:1)+')">切换商检标记</button></div>':'')+
      '</div>'+
      // 费用汇总
      '<div class="detail-section"><h3>费用汇总</h3><div class="detail-grid">'+
        '<div class="detail-item"><span class="detail-label">商品金额</span><span class="detail-value">'+fmtMoney(summary.goods_amount)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">到仓费用</span><span class="detail-value">'+fmtMoney(summary.warehouse_arrival_total)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">关税</span><span class="detail-value">'+fmtMoney(summary.customs_duty_total)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">商检费用</span><span class="detail-value">'+fmtMoney(summary.inspection_fee_total)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">落地成本总额</span><span class="detail-value font-bold">'+fmtMoney(summary.landing_cost_total)+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">费用确认</span><span class="detail-value">'+(summary.cost_confirmed?'✅ 已确认':'❌ 未确认')+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">费用分摊</span><span class="detail-value">'+(summary.cost_allocated?'✅ 已分摊':'❌ 未分摊')+'</span></div>'+
        '<div class="detail-item"><span class="detail-label">原库存导入</span><span class="detail-value">'+(summary.original_inventory_imported?'✅ 已完成':'❌ 未完成')+'</span></div>'+
      '</div></div>'+
      // 费用明细列表
      (summary.cost_items&&summary.cost_items.length?'<div class="detail-section"><h3>费用明细</h3><div class="table-container"><table class="data-table"><thead><tr><th>类别</th><th>小类</th><th>付款申请号</th><th>应付金额</th><th>已付金额</th><th>计入落地成本</th><th>付款对象</th></tr></thead><tbody>'+summary.cost_items.map(c=>'<tr><td>'+esc(PAY_CATEGORIES[c.cost_category]||c.cost_category)+'</td><td>'+esc(c.cost_subcategory)+'</td><td class="cell-id">'+esc(c.request_no)+'</td><td class="text-right">'+fmtMoney(c.payable_amount)+'</td><td class="text-right">'+fmtMoney(c.paid_amount)+'</td><td>'+(c.include_in_landing_cost?'✅':'❌')+'</td><td>'+esc(c.payee_name)+'</td></tr>').join('')+'</tbody></table></div></div>':'')+
      // 操作按钮
      '<div class="flex gap-8 mt-16">'+
        (hasPermission('ci_edit')?'<button class="btn btn-secondary btn-sm" onclick="confirmCiCosts(\''+id+'\')">✅ 确认费用完整</button>':'')+
        (hasPermission('cost_view')?'<button class="btn btn-secondary btn-sm" onclick="allocateCosts(\''+id+'\')">📊 费用分摊</button>':'')+
        (hasPermission('payment_create')&&summary.has_customs_duty?'<button class="btn btn-secondary btn-sm" onclick="createCustomsDutyPay(\''+id+'\')">💰 关税付款</button>':'')+
        (hasPermission('payment_create')&&summary.has_inspection_fee?'<button class="btn btn-secondary btn-sm" onclick="createInspectionFeePay(\''+id+'\')">💰 商检付款</button>':'')+
        (hasPermission('payment_create')?'<button class="btn btn-secondary btn-sm" onclick="createWarehousePay(\''+id+'\')">🚚 到仓费用付款</button>':'')+
      '</div></div>',
      '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>');
  }catch(e){showToast(e.message,'danger')}
}
async function toggleCiCostFlag(id,duty,insp){
  const d={};if(duty!==null)d.has_customs_duty=duty;if(insp!==null)d.has_inspection_fee=insp;
  try{await api('/api/commercial-invoices/'+id+'/cost-flags','PUT',d);showToast('费用标记已更新','success');viewCICost(id)}catch(e){showToast(e.message,'danger')}
}
async function createWarehousePay(ciId){
  openModal('创建到仓费用付款',
    '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
    '<div class="form-group"><label>费用小类</label><select id="war-sub"><option value="freight">运费</option><option value="customs_clearance">清关费</option><option value="port_charges">港口费</option><option value="delivery">派送费</option><option value="warehouse">仓储费</option><option value="other_local">其他本地费</option></select></div>'+
    '<div class="form-group"><label>付款对象</label><input type="text" id="war-payee" placeholder="货代/服务商名称"></div>'+
    '<div class="form-group"><label>应付金额</label><input type="number" step="0.01" id="war-amt"></div>'+
    '<div class="form-group"><label>币种</label><select id="war-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div>'+
    '<div class="form-group"><label>计入落地成本</label><select id="war-lic"><option value="1">是</option><option value="0">否</option></select></div>'+
    '<div class="form-group"><label>备注</label><input type="text" id="war-rem"></div>'+
    '<div class="form-group"><label>是否抵扣</label><select id="war-ded" onchange="document.getElementById(\'war-ded-amt\').disabled=this.value===\'0\'"><option value="0">否</option><option value="1">是</option></select></div>'+
    '<div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="war-ded-amt" value="0" disabled></div>'+
    '<div class="form-group"><label>抵扣来源类型</label><select id="war-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="quality_claim">质量索赔</option><option value="other">其他</option></select></div>'+
    '<div class="form-group form-group-full"><label>抵扣说明</label><input type="text" id="war-ded-desc"></div>'+
    '</div></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveWarehousePay(\''+ciId+'\')">创建</button>');
}
async function saveWarehousePay(ciId){
  const d={ci_id:ciId,subcategory:document.getElementById('war-sub').value,payee_name:document.getElementById('war-payee').value,payable_amount:parseFloat(document.getElementById('war-amt').value)||0,currency:document.getElementById('war-cur').value,remark:document.getElementById('war-rem').value,has_deduction:parseInt(document.getElementById('war-ded').value),deduction_amount:parseFloat(document.getElementById('war-ded-amt').value)||0,deduction_source_type:document.getElementById('war-ded-type').value,deduction_source_desc:document.getElementById('war-ded-desc').value,include_in_landing_cost:parseInt(document.getElementById('war-lic').value)};
  try{await api('/api/payment-requests/warehouse-arrival','POST',d);showToast('到仓费用付款申请已创建','success');closeModal()}catch(e){showToast(e.message,'danger')}
}
async function createCustomsDutyPay(ciId){
  openModal('创建关税付款',
    '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
    '<div class="form-group"><label>付款对象</label><input type="text" id="dut-payee" value="海关"></div>'+
    '<div class="form-group"><label>应付金额</label><input type="number" step="0.01" id="dut-amt"></div>'+
    '<div class="form-group"><label>币种</label><select id="dut-cur"><option>USD</option><option>RMB</option></select></div>'+
    '<div class="form-group"><label>备注</label><input type="text" id="dut-rem"></div>'+
    '<div class="form-group"><label>是否抵扣</label><select id="dut-ded" onchange="document.getElementById(\'dut-ded-amt\').disabled=this.value===\'0\'"><option value="0">否</option><option value="1">是</option></select></div>'+
    '<div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="dut-ded-amt" value="0" disabled></div>'+
    '<div class="form-group"><label>抵扣来源类型</label><select id="dut-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="other">其他</option></select></div>'+
    '<div class="form-group form-group-full"><label>抵扣说明</label><input type="text" id="dut-ded-desc"></div>'+
    '</div></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveCustomsDutyPay(\''+ciId+'\')">创建</button>');
}
async function saveCustomsDutyPay(ciId){
  const d={ci_id:ciId,payee_name:document.getElementById('dut-payee').value,payable_amount:parseFloat(document.getElementById('dut-amt').value)||0,currency:document.getElementById('dut-cur').value,remark:document.getElementById('dut-rem').value,has_deduction:parseInt(document.getElementById('dut-ded').value),deduction_amount:parseFloat(document.getElementById('dut-ded-amt').value)||0,deduction_source_type:document.getElementById('dut-ded-type').value,deduction_source_desc:document.getElementById('dut-ded-desc').value};
  try{await api('/api/payment-requests/customs-duty','POST',d);showToast('关税付款申请已创建','success');closeModal()}catch(e){showToast(e.message,'danger')}
}
async function createInspectionFeePay(ciId){
  openModal('创建商检费用付款',
    '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
    '<div class="form-group"><label>付款对象</label><input type="text" id="ins-payee" placeholder="商检机构"></div>'+
    '<div class="form-group"><label>应付金额</label><input type="number" step="0.01" id="ins-amt"></div>'+
    '<div class="form-group"><label>币种</label><select id="ins-cur"><option>USD</option><option>RMB</option></select></div>'+
    '<div class="form-group"><label>备注</label><input type="text" id="ins-rem"></div>'+
    '<div class="form-group"><label>是否抵扣</label><select id="ins-ded" onchange="document.getElementById(\'ins-ded-amt\').disabled=this.value===\'0\'"><option value="0">否</option><option value="1">是</option></select></div>'+
    '<div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="ins-ded-amt" value="0" disabled></div>'+
    '<div class="form-group"><label>抵扣来源类型</label><select id="ins-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="other">其他</option></select></div>'+
    '<div class="form-group form-group-full"><label>抵扣说明</label><input type="text" id="ins-ded-desc"></div>'+
    '</div></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveInspectionFeePay(\''+ciId+'\')">创建</button>');
}
async function saveInspectionFeePay(ciId){
  const d={ci_id:ciId,payee_name:document.getElementById('ins-payee').value,payable_amount:parseFloat(document.getElementById('ins-amt').value)||0,currency:document.getElementById('ins-cur').value,remark:document.getElementById('ins-rem').value,has_deduction:parseInt(document.getElementById('ins-ded').value),deduction_amount:parseFloat(document.getElementById('ins-ded-amt').value)||0,deduction_source_type:document.getElementById('ins-ded-type').value,deduction_source_desc:document.getElementById('ins-ded-desc').value};
  try{await api('/api/payment-requests/inspection-fee','POST',d);showToast('商检费用付款申请已创建','success');closeModal()}catch(e){showToast(e.message,'danger')}
}

// ==================== 物流管理 ====================
async function renderLogistics(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="log-fs"><option value="">全部</option><option value="pending">待提货</option><option value="picked_up">已提货</option><option value="in_transit">运输中</option><option value="arrived">到港</option><option value="customs">清关中</option><option value="cleared">已清关</option><option value="delivering">派送中</option><option value="completed">已完成</option></select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadLog()">搜索</button>'+(hasPermission('logistics_create')?'<button class="btn btn-primary btn-sm" onclick="createLog()">➕ 新建</button>':'')+'</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🚢 物流批次</div></div><div id="log-table"></div></div>';
  loadLog();
}
async function loadLog(){
  try{
    const s=document.getElementById('log-fs')?.value||'';
    const data=await api('/api/logistics-batches?status='+s);
    document.getElementById('log-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">🚢</div>暂无物流数据</div>':'<div class="table-container" style="box-shadow:none;border-radius:0;overflow-x:auto"><table class="data-table"><thead><tr><th>批次号</th><th>关联CI</th><th>货代</th><th>方式</th><th>起运港</th><th>目的港</th><th>国家</th><th>提货</th><th>出发</th><th>到港</th><th>清关完成</th><th>入库完成</th><th>箱数</th><th>CBM</th><th>综合运费</th><th>关税</th><th>状态</th><th>费用</th><th>操作</th></tr></thead><tbody>'+data.map(l=>'<tr><td class="cell-id">'+esc(l.batch_no)+'</td><td class="cell-id">'+esc(l.related_ci_no)+'</td><td>'+esc(l.forwarder_name)+'</td><td>'+esc(l.transport_mode)+'</td><td>'+esc(l.origin_port)+'</td><td>'+esc(l.dest_port)+'</td><td>'+esc(l.target_country)+'</td><td class="cell-date">'+fmtDate(l.pickup_date)+'</td><td class="cell-date">'+fmtDate(l.depart_date)+'</td><td class="cell-date">'+fmtDate(l.actual_arrival_date)+'</td><td class="cell-date">'+fmtDate(l.customs_end_date)+'</td><td class="cell-date">'+fmtDate(l.inbound_complete_date)+'</td><td class="text-right">'+(l.total_cartons||0)+'</td><td class="text-right">'+(l.total_cbm||0)+'</td><td class="text-right">'+fmtMoney(l.total_freight,l.freight_currency)+'</td><td class="text-right">'+fmtMoney(l.customs_duty,l.freight_currency)+'</td><td><span class="status-badge '+(l.logistics_status==='completed'?'status-completed':'status-pending')+'">'+esc(l.logistics_status)+'</span></td><td><span class="status-badge '+(l.fee_status==='paid'?'status-paid':'status-unpaid')+'">'+esc(l.fee_status)+'</span></td><td class="cell-actions"><button class="action-btn" onclick="viewLog(\''+l.id+'\')">👁️</button>'+(l.total_freight>0&&l.fee_status==='unpaid'&&hasPermission('payment_create')?'<button class="action-btn" onclick="createFrtPay(\''+l.id+'\')" title="运费付款">💰</button>':'')+(l.customs_duty>0&&l.fee_status==='unpaid'&&hasPermission('payment_create')?'<button class="action-btn" onclick="createDutyPay(\''+l.id+'\')" title="关税付款">🏛️</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function viewLog(id){
  try{const l=await api('/api/logistics-batches/'+id);const fs=['batch_no','related_ci_no','forwarder_name','transport_mode','origin_port','dest_port','target_country','target_warehouse','pickup_date','depart_date','eta_date','actual_arrival_date','customs_start_date','customs_end_date','delivery_date','inbound_complete_date','logistics_status','total_cartons','total_weight','total_cbm','freight_currency','international_freight','local_charges','customs_service_fee','delivery_fee','total_freight','customs_duty','vat_gst','other_fees','fee_status'];
    openModal('物流详情 - '+l.batch_no,'<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>基本信息</h3><div class="detail-grid">'+fs.map(f=>'<div class="detail-item"><span class="detail-label">'+f+'</span><span class="detail-value">'+esc(l[f])+'</span></div>').join('')+'</div></div></div>');
  }catch(e){showToast(e.message,'danger')}
}
async function createLog(){
  const ffs=await api('/api/freight-forwarders');const cis=await api('/api/commercial-invoices?status=shipped');
  openModal('新建物流批次','<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>关联CI</label><select id="nlog-ci"><option value="">无</option>'+cis.map(c=>'<option value="'+c.id+'" data-no="'+c.ci_no+'">'+esc(c.ci_no)+' - '+esc(c.supplier_name)+'</option>').join('')+'</select></div><div class="form-group"><label>货代</label><select id="nlog-ff"><option value="">选择</option>'+ffs.map(f=>'<option value="'+f.id+'" data-name="'+esc(f.name)+'">'+esc(f.name)+'</option>').join('')+'</select></div><div class="form-group"><label>运输方式</label><select id="nlog-mode"><option value="sea">海运</option><option value="air">空运</option><option value="land">陆运</option><option value="express">快递</option></select></div><div class="form-group"><label>起运港</label><input type="text" id="nlog-origin"></div><div class="form-group"><label>目的港</label><input type="text" id="nlog-dest"></div><div class="form-group"><label>目标国家</label><input type="text" id="nlog-country"></div><div class="form-group"><label>目标仓库</label><input type="text" id="nlog-wh"></div><div class="form-group"><label>提货日期</label><input type="date" id="nlog-pickup"></div><div class="form-group"><label>出发日期</label><input type="date" id="nlog-depart"></div><div class="form-group"><label>预计到港</label><input type="date" id="nlog-eta"></div><div class="form-group"><label>运费币种</label><select id="nlog-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div><div class="form-group"><label>国际运费</label><input type="number" step="0.01" id="nlog-intl" value="0"></div><div class="form-group"><label>本地杂费</label><input type="number" step="0.01" id="nlog-local" value="0"></div><div class="form-group"><label>清关服务费</label><input type="number" step="0.01" id="nlog-csv" value="0"></div><div class="form-group"><label>派送费</label><input type="number" step="0.01" id="nlog-delivery" value="0"></div><div class="form-group"><label>关税</label><input type="number" step="0.01" id="nlog-duty" value="0"></div><div class="form-group"><label>VAT/GST</label><input type="number" step="0.01" id="nlog-vat" value="0"></div><div class="form-group"><label>其他费用</label><input type="number" step="0.01" id="nlog-other" value="0"></div></div></div>','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveNewLog()">创建</button>');
}
async function saveNewLog(){
  const ciSel=document.getElementById('nlog-ci'),ffSel=document.getElementById('nlog-ff');
  const d={related_ci_id:ciSel.value||'',related_ci_no:ciSel.options[ciSel.selectedIndex]?.dataset.no||'',forwarder_id:ffSel.value||'',forwarder_name:ffSel.options[ffSel.selectedIndex]?.dataset.name||'',transport_mode:document.getElementById('nlog-mode').value,origin_port:document.getElementById('nlog-origin').value,dest_port:document.getElementById('nlog-dest').value,target_country:document.getElementById('nlog-country').value,target_warehouse:document.getElementById('nlog-wh').value,pickup_date:document.getElementById('nlog-pickup').value,depart_date:document.getElementById('nlog-depart').value,eta_date:document.getElementById('nlog-eta').value,freight_currency:document.getElementById('nlog-cur').value,international_freight:parseFloat(document.getElementById('nlog-intl').value)||0,local_charges:parseFloat(document.getElementById('nlog-local').value)||0,customs_service_fee:parseFloat(document.getElementById('nlog-csv').value)||0,delivery_fee:parseFloat(document.getElementById('nlog-delivery').value)||0,customs_duty:parseFloat(document.getElementById('nlog-duty').value)||0,vat_gst:parseFloat(document.getElementById('nlog-vat').value)||0,other_fees:parseFloat(document.getElementById('nlog-other').value)||0};
  try{await api('/api/logistics-batches','POST',d);showToast('创建成功','success');closeModal();loadLog()}catch(e){showToast(e.message,'danger')}
}
async function createFrtPay(id){
  try{
    const log=await api('/api/logistics-batches/'+id);
    if(!log.related_ci_id){showToast('该物流批次未关联CI，请从CI费用管理页面创建到仓费用付款','warning');return}
    // 跳转到CI费用管理
    viewCICost(log.related_ci_id);
  }catch(e){showToast(e.message,'danger')}
}
async function createDutyPay(id){
  try{
    const log=await api('/api/logistics-batches/'+id);
    if(!log.related_ci_id){showToast('该物流批次未关联CI，请从CI费用管理页面创建关税付款','warning');return}
    const ci=await api('/api/commercial-invoices/'+log.related_ci_id);
    if(!ci.has_customs_duty){showToast('该CI未标记为有关税，请先在CI费用管理中设置','warning');return}
    createCustomsDutyPay(log.related_ci_id);
  }catch(e){showToast(e.message,'danger')}
}

// ==================== 入库管理 ====================
async function renderInbound(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="in-fs"><option value="">全部</option><option value="pending">待入库</option><option value="completed">已完成</option><option value="abnormal">异常</option></select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadIn()">搜索</button>'+(hasPermission('inbound_create')?'<button class="btn btn-primary btn-sm" onclick="openBatchImportInbound()">📥 批量导入</button><button class="btn btn-primary btn-sm" onclick="createIn()">➕ 新建入库</button>':'')+'</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📥 入库记录</div></div><div id="in-table"></div></div>';
  loadIn();
}
async function loadIn(){
  try{
    const s=document.getElementById('in-fs')?.value||'';
    const data=await api('/api/inbound-records?status='+s);
    document.getElementById('in-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">📥</div>暂无入库数据</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>入库单号</th><th>来源CI</th><th>物流批次</th><th>国家</th><th>仓库</th><th>日期</th><th>SKU</th><th>产品名</th><th>CI发货</th><th>应入库</th><th>实际入库</th><th>累计</th><th>未入库</th><th>异常</th><th>状态</th></tr></thead><tbody>'+data.map(i=>'<tr><td class="cell-id">'+esc(i.inbound_no)+'</td><td class="cell-id">'+esc(i.source_ci_no)+'</td><td class="cell-id">'+esc(i.source_logistics_batch_no)+'</td><td>'+esc(i.country)+'</td><td>'+esc(i.warehouse)+'</td><td class="cell-date">'+fmtDate(i.inbound_date)+'</td><td class="cell-id">'+esc(i.sku_code)+'</td><td>'+esc(i.product_name)+'</td><td class="text-right">'+(i.ci_shipped_qty||0)+'</td><td class="text-right">'+(i.expected_qty||0)+'</td><td class="text-right font-bold">'+(i.actual_qty||0)+'</td><td class="text-right">'+(i.accumulated_qty||0)+'</td><td class="text-right">'+(i.uninbound_qty||0)+'</td><td class="text-right '+(i.abnormal_qty>0?'text-danger':'')+'">'+(i.abnormal_qty||0)+'</td><td><span class="status-badge '+(i.inbound_status==='completed'?'status-completed':i.inbound_status==='abnormal'?'status-danger':'status-pending')+'">'+esc(i.inbound_status)+'</span></td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function createIn(){
  const cis=await api('/api/commercial-invoices?status=shipped');
  openModal('新建入库','<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>来源CI</label><select id="nin-ci" onchange="loadCIForIn()"><option value="">选择CI</option>'+cis.map(c=>'<option value="'+c.id+'" data-no="'+c.ci_no+'">'+esc(c.ci_no)+' - '+esc(c.supplier_name)+'</option>').join('')+'</select></div><div class="form-group"><label>入库日期 <span class="required">*</span></label><input type="date" id="nin-date" value="'+todayStr()+'"></div><div class="form-group"><label>国家</label><input type="text" id="nin-country"></div><div class="form-group"><label>仓库</label><input type="text" id="nin-wh"></div><div class="form-group"><label>物流批次号</label><input type="text" id="nin-log"></div><div class="form-group"><label>派送批次号</label><input type="text" id="nin-del"></div></div><div id="in-ci-items" style="margin-top:16px"></div></div>','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveNewIn()">创建入库</button>');
}
async function loadCIForIn(){const ciSel=document.getElementById('nin-ci');if(!ciSel.value)return;try{const ci=await api('/api/commercial-invoices/'+ciSel.value);const items=ci.items||[];document.getElementById('in-ci-items').innerHTML='<h4 style="margin-bottom:8px">CI明细</h4><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>发货量</th><th>已入库</th><th>未入库</th><th>本次入库</th></tr></thead><tbody>'+items.map((item,i)=>'<tr><td class="cell-id">'+esc(item.sku_code)+'</td><td class="text-right">'+item.shipped_qty+'</td><td class="text-right">'+(item.inbound_qty||0)+'</td><td class="text-right">'+(item.uninbound_qty||0)+'</td><td><input type="number" id="in-q-'+i+'" value="'+(item.uninbound_qty||0)+'" style="width:80px;padding:4px"></td></tr>').join('')+'</tbody></table></div>';window._inCI=ciSel.value;window._inCINo=ciSel.options[ciSel.selectedIndex].dataset.no;window._inItems=items}catch(e){}}
async function saveNewIn(){
  const country=document.getElementById('nin-country').value,wh=document.getElementById('nin-wh').value,date=document.getElementById('nin-date').value,log=document.getElementById('nin-log').value,del=document.getElementById('nin-del').value;
  const ciId=window._inCI||'',ciNo=window._inCINo||'',items=window._inItems||[];
  try{for(let i=0;i<items.length;i++){const q=parseInt(document.getElementById('in-q-'+i)?.value)||0;if(q>0)await api('/api/inbound-records','POST',{source_ci_id:ciId,source_ci_no:ciNo,source_logistics_batch_no:log,delivery_batch_no:del,country,warehouse:wh,inbound_date:date,sku_code:items[i].sku_code,ci_shipped_qty:items[i].shipped_qty,expected_qty:items[i].uninbound_qty||0,actual_qty:q})}
    showToast('入库完成','success');closeModal();loadIn()}catch(e){showToast(e.message,'danger')}
}

// ==================== 入库批量导入 ====================
// 必填列：SKU编码、入库日期、实际入库数量
// 选填列：来源CI号、物流批次号、派送批次号、国家、仓库、CI发货量、应入库量、异常数量、异常原因、备注
const INBOUND_IMPORT_COLUMNS=[
  {key:'sku_code',label:'SKU编码',required:true},
  {key:'inbound_date',label:'入库日期',required:true,format:v=>v?(v instanceof Date?formatDateISO(v):String(v).trim().slice(0,10)):''},
  {key:'actual_qty',label:'实际入库数量',required:true},
  {key:'source_ci_no',label:'来源CI号'},
  {key:'source_logistics_batch_no',label:'物流批次号'},
  {key:'delivery_batch_no',label:'派送批次号'},
  {key:'country',label:'国家'},
  {key:'warehouse',label:'仓库'},
  {key:'ci_shipped_qty',label:'CI发货量'},
  {key:'expected_qty',label:'应入库量'},
  {key:'abnormal_qty',label:'异常数量'},
  {key:'abnormal_reason',label:'异常原因'},
  {key:'remark',label:'备注'}
];

function openBatchImportInbound(){
  openModal('批量导入入库记录',
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div id="bi-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s" '+
        'onclick="document.getElementById(\'bi-file-input\').click()" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
        'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handleInboundFile(event.dataTransfer.files[0])">'+
        '<div style="font-size:48px;color:#1890ff;margin-bottom:8px">📤</div>'+
        '<div style="font-size:14px;color:#333;margin-bottom:4px">点击上传或拖拽文件到此处</div>'+
        '<div style="font-size:12px;color:#999">支持 .xlsx / .csv 格式</div>'+
      '</div>'+
      '<input type="file" id="bi-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleInboundFile(this.files[0])">'+
      '<div id="bi-preview" style="margin-top:16px"></div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="downloadInboundTemplate()">下载模板</button>'+
    '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'+
    '<button class="btn btn-primary" id="bi-import-btn" onclick="submitBatchImportInbound()" disabled>开始导入</button>'
  );
  window._inboundImportData=[];
}

function handleInboundFile(file){
  if(!file)return;
  const ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){showToast('仅支持 .xlsx / .xls / .csv 格式','danger');return}
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=new Uint8Array(e.target.result);
      const wb=XLSX.read(data,{type:'array',cellDates:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      if(rows.length<2){showToast('文件为空或缺少数据行','danger');return}
      // 解析表头
      const headers=rows[0].map(h=>String(h||'').trim());
      const records=[];
      for(let i=1;i<rows.length;i++){
        const row=rows[i];
        if(!row || row.every(c=>!c||String(c).trim()===''))continue;
        const rec={};
        INBOUND_IMPORT_COLUMNS.forEach(col=>{
          const idx=headers.findIndex(h=>h===col.label||h===col.key);
          if(idx>=0 && row[idx]!==undefined){
            let val=row[idx];
            if(col.format)val=col.format(val);
            rec[col.key]=val;
          }
        });
        rec._rowNum=i+1;
        rec._errors=[];
        // 校验
        INBOUND_IMPORT_COLUMNS.filter(c=>c.required).forEach(c=>{
          const v=rec[c.key];
          if(v===undefined||v===null||v===''||(typeof v==='string'&&!v.trim()))rec._errors.push(c.label+'不能为空');
        });
        if(rec.actual_qty!==undefined&&rec.actual_qty!==''){
          const n=parseInt(rec.actual_qty);
          if(isNaN(n)||n<0)rec._errors.push('实际入库数量必须为非负整数');
          else rec.actual_qty=n;
        }
        if(rec.inbound_date){
          const d=String(rec.inbound_date);
          if(!/^\d{4}-\d{2}-\d{2}/.test(d))rec._errors.push('入库日期格式应为 YYYY-MM-DD');
        }
        records.push(rec);
      }
      window._inboundImportData=records;
      renderInboundPreview(records);
      document.getElementById('bi-import-btn').disabled=records.length===0;
    }catch(err){showToast('文件解析失败：'+err.message,'danger')}
  };
  reader.readAsArrayBuffer(file);
}

function renderInboundPreview(records){
  const valid=records.filter(r=>r._errors.length===0).length;
  const invalid=records.length-valid;
  let html='<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px"><b>共 '+records.length+' 条数据</b>，<span style="color:#52c41a">有效 '+valid+' 条</span>'+(invalid>0?'，<span style="color:#ff4d4f">无效 '+invalid+' 条</span>':'')+'</div>';
  html+='<div class="table-container" style="max-height:300px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>行</th><th>SKU</th><th>日期</th><th>数量</th><th>CI号</th><th>国家</th><th>仓库</th><th>状态</th></tr></thead><tbody>';
  const preview=records.slice(0,20);
  preview.forEach(r=>{
    const ok=r._errors.length===0;
    html+='<tr style="'+(ok?'':'background:#fff1f0')+'">'+
      '<td>'+r._rowNum+'</td>'+
      '<td class="cell-id">'+esc(r.sku_code||'-')+'</td>'+
      '<td class="cell-date">'+esc(r.inbound_date||'-')+'</td>'+
      '<td class="text-right">'+(r.actual_qty!==undefined?r.actual_qty:'-')+'</td>'+
      '<td class="cell-id">'+esc(r.source_ci_no||'-')+'</td>'+
      '<td>'+esc(r.country||'-')+'</td>'+
      '<td>'+esc(r.warehouse||'-')+'</td>'+
      '<td>'+(ok?'<span class="status-badge status-completed">✓</span>':'<span class="status-badge status-danger" title="'+esc(r._errors.join('; '))+'">✗ '+r._errors.length+'</span>')+'</td>'+
    '</tr>';
  });
  if(records.length>20)html+='<tr><td colspan="8" style="text-align:center;color:#999;padding:8px">... 还有 '+(records.length-20)+' 条</td></tr>';
  html+='</tbody></table></div>';
  if(invalid>0){
    html+='<div style="margin-top:10px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666"><b>无效行明细：</b><br>'+
      records.filter(r=>r._errors.length>0).slice(0,10).map(r=>'第 '+r._rowNum+' 行：'+r._errors.join('、')).join('<br>')+
      (invalid>10?'<br>...':'')+'</div>';
  }
  document.getElementById('bi-preview').innerHTML=html;
}

function formatDateISO(d){
  if(!(d instanceof Date)||isNaN(d))return'';
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

function downloadInboundTemplate(){
  // 构造示例数据
  const sample=[
    {sku_code:'SKU001',inbound_date:'2026-07-04',actual_qty:100,source_ci_no:'CI-2026-001',source_logistics_batch_no:'',delivery_batch_no:'',country:'美国',warehouse:'美西仓',ci_shipped_qty:100,expected_qty:100,abnormal_qty:0,abnormal_reason:'',remark:'正常入库'},
    {sku_code:'SKU002',inbound_date:'2026-07-04',actual_qty:50,source_ci_no:'',source_logistics_batch_no:'LG-2026-07',delivery_batch_no:'',country:'英国',warehouse:'英国仓',ci_shipped_qty:0,expected_qty:50,abnormal_qty:5,abnormal_reason:'外箱破损',remark:'部分损耗'}
  ];
  // 表头使用中文标签
  const headers=INBOUND_IMPORT_COLUMNS.map(c=>c.label);
  const data=sample.map(r=>INBOUND_IMPORT_COLUMNS.map(c=>r[c.key]!==undefined?r[c.key]:''));
  const ws=XLSX.utils.aoa_to_sheet([headers,...data]);
  // 设置列宽
  ws['!cols']=INBOUND_IMPORT_COLUMNS.map(c=>({wch:c.label.length*2+4}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'入库记录');
  XLSX.writeFile(wb,'入库记录_导入模板.xlsx');
}

async function submitBatchImportInbound(){
  const records=window._inboundImportData||[];
  const valid=records.filter(r=>r._errors.length===0);
  if(valid.length===0){showToast('没有可导入的有效数据','danger');return}
  const btn=document.getElementById('bi-import-btn');
  btn.disabled=true;btn.textContent='导入中...';
  try{
    const res=await api('/api/inbound-records/batch-import','POST',{records:valid});
    let msg='导入完成：成功 '+res.success+' 条';
    if(res.failed)msg+='，失败 '+res.failed+' 条';
    showToast(msg,res.failed?'warning':'success');
    if(res.errors&&res.errors.length){
      console.warn('导入错误明细',res.errors);
    }
    closeModal();
    loadIn();
  }catch(e){
    showToast(e.message||'导入失败','danger');
    btn.disabled=false;btn.textContent='开始导入';
  }
}

// 生命周期说明弹窗
function openLifecycleHelp(){
  const rows=[
    {k:'new_test',label:'新品导入',strategy:'不直接生成PO，需先完成新品启动检查清单',coeff:'0%',replenish:false,judge:'SKU的 launch_date 距今 ≤30 天'},
    {k:'new_launch',label:'新品启动',strategy:'观察期+备货预警，按目标月数50%建议补货',coeff:'50%',replenish:true,judge:'30-90天 + 已有部分出库'},
    {k:'growth',label:'成长期',strategy:'允许优先补货，按目标月数80%建议',coeff:'80%',replenish:true,judge:'月销量连续 2-3 个月环比增长 ≥20%'},
    {k:'stable',label:'成熟期',strategy:'按默认目标月数（4个月）建议补货',coeff:'100%',replenish:true,judge:'销量稳定，无明显上升或下降趋势'},
    {k:'slow',label:'衰退期',strategy:'降低目标月数，按50%建议补货',coeff:'50%',replenish:true,judge:'月销量连续 2-3 个月环比下降 ≥20%'},
    {k:'stagnant',label:'滞销',strategy:'暂缓补货，需先清理库存',coeff:'0%',replenish:false,judge:'近 90 天无出库记录'},
    {k:'clearance',label:'清仓期',strategy:'清仓中，不建议补货',coeff:'0%',replenish:false,judge:'SKU 状态 = clearance'},
    {k:'stopped',label:'停采/停产',strategy:'停采/停产，不参与补货建议',coeff:'0%',replenish:false,judge:'SKU 状态 = stopped / discontinued'}
  ];
  const html='<div style="padding:4px 8px"><div style="background:#f6f8fa;padding:12px;border-radius:6px;margin-bottom:14px;font-size:13px;line-height:1.6">'+
    '<b>📌 生命周期的作用</b><br>'+
    '生命周期是辅助系统判断补货策略的字段，影响 <b>建议补货量</b> 和 <b>建议动作</b>。<br>'+
    '可在 <b>商品管理 → 生命周期</b> 字段手动调整。'+
    '</div>'+
    '<div class="table-container" style="box-shadow:none;border:1px solid #e1e4e8"><table class="data-table">'+
    '<thead><tr><th>标签</th><th>系统判断依据</th><th>补货策略</th><th style="text-align:center">补货系数</th><th style="text-align:center">是否补货</th></tr></thead>'+
    '<tbody>'+rows.map(r=>'<tr>'+
      '<td><span class="lifecycle-tag lc-'+r.k+'">'+r.label+'</span></td>'+
      '<td style="font-size:12px;color:#586069">'+r.judge+'</td>'+
      '<td style="font-size:12px">'+r.strategy+'</td>'+
      '<td style="text-align:center;font-weight:bold">'+r.coeff+'</td>'+
      '<td style="text-align:center">'+(r.replenish?'<span class="status-badge status-completed">是</span>':'<span class="status-badge status-secondary">否</span>')+'</td>'+
    '</tr>').join('')+
    '</tbody></table></div>'+
    '<div style="margin-top:12px;padding:10px 12px;background:#fff8c5;border-radius:6px;font-size:12px;color:#586069;line-height:1.6">'+
      '<b>💡 计算公式</b><br>'+
      '建议补货量 = (目标库存月数 × 月均销量 − 总库存池) × 生命周期系数<br>'+
      '• 总库存池 = 当前可用 + 在途 + PO 未发<br>'+
      '• 目标库存月数 默认 4，可在 <b>预测参数设置</b> 中调整'+
    '</div></div>';
  openModal('📖 生命周期说明', html, '<button class="btn btn-primary" onclick="closeModal()">关闭</button>');
}

// ==================== 成本管理 ====================
async function renderCost(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>'+
    '<div class="tab-bar">'+
      '<div class="tab-item active" onclick="switchCostTab(\'alloc\',this)">📊 费用分摊</div>'+
      '<div class="tab-item" onclick="switchCostTab(\'origin\',this)">📦 原库存导入</div>'+
      '<div class="tab-item" onclick="switchCostTab(\'wac\',this)">💰 加权平均成本</div>'+
      '<div class="tab-item" onclick="switchCostTab(\'logs\',this)">📝 成本更新日志</div>'+
    '</div>'+
    '<div id="cost-tab-content"></div>';
  loadCostAlloc();
}
function switchCostTab(tab,el){
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  if(tab==='alloc')loadCostAlloc();
  else if(tab==='origin')loadCostOrigin();
  else if(tab==='wac')loadCostWac();
  else if(tab==='logs')loadCostLogs();
}
// Tab 1: 费用分摊
async function loadCostAlloc(){
  document.getElementById('cost-tab-content').innerHTML='<div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>CI号</label><input type="text" id="cost-ci" onkeypress="if(event.key===\'Enter\')fetchCostAlloc()"></div><div class="filter-group"><label>SKU</label><input type="text" id="cost-sku" onkeypress="if(event.key===\'Enter\')fetchCostAlloc()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="fetchCostAlloc()">搜索</button></div></div></div><div id="cost-alloc-table"><div class="empty-state"><div class="empty-icon">📊</div>请搜索查看费用分摊数据</div></div>';
  fetchCostAlloc();
}
async function fetchCostAlloc(){
  try{
    const ci=document.getElementById('cost-ci')?.value||'',sku=document.getElementById('cost-sku')?.value||'';
    const data=await api('/api/cost-allocations?ci_no='+encodeURIComponent(ci)+'&sku_code='+encodeURIComponent(sku));
    document.getElementById('cost-alloc-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">📊</div>暂无成本数据</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>CI号</th><th>SKU</th><th>商品成本</th><th>分摊运费</th><th>分摊关税</th><th>分摊其他</th><th>总落地成本</th><th>入库量</th><th>单位商品成本</th><th>单位分摊成本</th><th>含费单位成本</th><th>原库存量</th><th>原成本</th><th>币种</th></tr></thead><tbody>'+data.map(c=>'<tr><td class="cell-id">'+esc(c.ci_no)+'</td><td class="cell-id">'+esc(c.sku_code)+'</td><td class="text-right">'+fmtMoney(c.product_cost)+'</td><td class="text-right">'+fmtMoney(c.allocated_freight)+'</td><td class="text-right">'+fmtMoney(c.allocated_duty)+'</td><td class="text-right">'+fmtMoney(c.allocated_other)+'</td><td class="text-right font-bold">'+fmtMoney(c.total_landing_cost)+'</td><td class="text-right">'+(c.inbound_qty||0)+'</td><td class="text-right">'+fmtMoney(c.unit_product_cost)+'</td><td class="text-right">'+fmtMoney(c.unit_allocated_cost)+'</td><td class="text-right font-bold">'+fmtMoney(c.unit_landing_cost_with_fees||c.unit_landing_cost)+'</td><td class="text-right">'+(c.original_qty||0)+'</td><td class="text-right">'+fmtMoney(c.original_avg_cost)+'</td><td>'+esc(c.currency)+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
// Tab 2: 原库存导入
async function loadCostOrigin(){
  document.getElementById('cost-tab-content').innerHTML='<div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>选择CI</label><select id="orig-ci" onchange="loadOriginRecords()"><option value="">选择CI</option></select></div><div class="filter-actions">'+(hasPermission('cost_view')?'<button class="btn btn-secondary btn-sm" onclick="downloadOriginTemplate()">📥 下载模板</button>':'')+(hasPermission('cost_view')?'<button class="btn btn-primary btn-sm" onclick="importOriginInventory()">📤 导入原库存</button>':'')+'</div></div></div><div id="origin-check"></div><div id="origin-records"></div>';
  try{
    const cis=await api('/api/commercial-invoices');
    document.getElementById('orig-ci').innerHTML='<option value="">选择CI</option>'+cis.map(c=>'<option value="'+c.id+'">'+esc(c.ci_no)+' - '+esc(c.supplier_name)+' ('+fmtMoney(c.goods_amount)+')</option>').join('');
  }catch(e){showFlash(e.message,'danger')}
}
async function loadOriginRecords(){
  const ciId=document.getElementById('orig-ci')?.value;
  if(!ciId){document.getElementById('origin-check').innerHTML='';document.getElementById('origin-records').innerHTML='';return}
  try{
    const check=await api('/api/original-inventory/'+ciId+'/check');
    document.getElementById('origin-check').innerHTML='<div class="stats-grid mb-16"><div class="stat-card '+(check.all_imported?'success':'warning')+'"><div class="stat-number">'+(check.all_imported?'✅ 已完成':'⚠️ 未完成')+'</div><div class="stat-label">原库存导入状态</div></div><div class="stat-card"><div class="stat-number">'+check.imported_skus+'/'+check.total_skus+'</div><div class="stat-label">已导入/总SKU数</div></div></div>'+(check.missing_skus&&check.missing_skus.length?'<div class="flash flash-warning show">缺少SKU: '+esc(check.missing_skus.join(', '))+'</div>':'');
    const records=await api('/api/original-inventory/'+ciId);
    document.getElementById('origin-records').innerHTML=!records.length?'<div class="empty-state"><div class="empty-icon">📦</div>暂无原库存数据</div>':'<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📦 原库存记录</div></div><div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>SKU</th><th>国家</th><th>仓库</th><th>原库存数量</th><th>备注</th><th>导入时间</th></tr></thead><tbody>'+records.map(r=>'<tr><td class="cell-id">'+esc(r.sku_code)+'</td><td>'+esc(r.country)+'</td><td>'+esc(r.warehouse)+'</td><td class="text-right font-bold">'+(r.original_qty||0)+'</td><td>'+esc(r.remark)+'</td><td class="cell-date">'+fmtDate(r.imported_at)+'</td></tr>').join('')+'</tbody></table></div></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function downloadOriginTemplate(){
  try{
    const t=await api('/api/original-inventory/template');
    const ws=XLSX.utils.json_to_sheet(t.sample);
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'原库存模板');
    XLSX.writeFile(wb,'原库存数量导入模板.xlsx');
  }catch(e){showToast(e.message,'danger')}
}
async function importOriginInventory(){
  const ciId=document.getElementById('orig-ci')?.value;
  if(!ciId){showToast('请先选择CI','warning');return}
  const input=document.createElement('input');input.type='file';input.accept='.xlsx,.xls,.csv';
  input.onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=async ev=>{
      try{
        const data=new Uint8Array(ev.target.result);
        const wb=XLSX.read(data,{type:'array'});
        const ws=wb.Sheets[wb.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
        if(rows.length<2){showToast('文件为空','danger');return}
        const headers=rows[0].map(h=>String(h||'').trim());
        const items=[];
        for(let i=1;i<rows.length;i++){
          const row=rows[i];if(!row||row.every(c=>!c))continue;
          const skuIdx=headers.findIndex(h=>h==='SKU'||h==='sku_code');
          const qtyIdx=headers.findIndex(h=>h.includes('原库存')||h==='original_qty');
          const countryIdx=headers.findIndex(h=>h==='国家'||h==='country');
          const whIdx=headers.findIndex(h=>h==='仓库'||h==='warehouse');
          const remarkIdx=headers.findIndex(h=>h==='备注'||h==='remark');
          if(skuIdx>=0&&row[skuIdx])items.push({sku_code:String(row[skuIdx]).trim(),original_qty:parseFloat(row[qtyIdx])||0,country:countryIdx>=0?String(row[countryIdx]||'').trim():'',warehouse:whIdx>=0?String(row[whIdx]||'').trim():'',remark:remarkIdx>=0?String(row[remarkIdx]||'').trim():''});
        }
        if(!items.length){showToast('未找到有效数据','danger');return}
        const result=await api('/api/original-inventory/import','POST',{ci_id:ciId,items});
        showToast('导入完成: 成功'+result.success+'条, 失败'+result.failed+'条','success');
        if(result.errors&&result.errors.length)console.log('导入错误:',result.errors);
        loadOriginRecords();
      }catch(err){showToast('导入失败: '+err.message,'danger')}
    };
    reader.readAsArrayBuffer(file);
  };
  input.click();
}
// Tab 3: 加权平均成本
async function loadCostWac(){
  document.getElementById('cost-tab-content').innerHTML='<div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>选择CI</label><select id="wac-ci" onchange="loadWacDetail()"><option value="">选择CI</option></select></div></div></div><div id="wac-detail"></div>';
  try{
    const cis=await api('/api/commercial-invoices');
    document.getElementById('wac-ci').innerHTML='<option value="">选择CI</option>'+cis.map(c=>'<option value="'+c.id+'">'+esc(c.ci_no)+' - '+esc(c.supplier_name)+'</option>').join('');
  }catch(e){showFlash(e.message,'danger')}
}
async function loadWacDetail(){
  const ciId=document.getElementById('wac-ci')?.value;
  if(!ciId){document.getElementById('wac-detail').innerHTML='';return}
  try{
    const summary=await api('/api/commercial-invoices/'+ciId+'/cost-summary');
    const check=await api('/api/original-inventory/'+ciId+'/check');
    const allocs=await api('/api/cost-allocation/'+ciId);
    let html='<div class="stats-grid mb-16">'+
      '<div class="stat-card"><div class="stat-number">'+fmtMoney(summary.goods_amount)+'</div><div class="stat-label">商品金额</div></div>'+
      '<div class="stat-card"><div class="stat-number">'+fmtMoney(summary.warehouse_arrival_total)+'</div><div class="stat-label">到仓费用</div></div>'+
      '<div class="stat-card"><div class="stat-number">'+fmtMoney(summary.customs_duty_total)+'</div><div class="stat-label">关税</div></div>'+
      '<div class="stat-card"><div class="stat-number">'+fmtMoney(summary.inspection_fee_total)+'</div><div class="stat-label">商检费用</div></div>'+
      '<div class="stat-card success"><div class="stat-number">'+fmtMoney(summary.landing_cost_total)+'</div><div class="stat-label">落地成本总额</div></div>'+
    '</div>';
    // 状态指示
    html+='<div class="detail-card mb-16"><div class="detail-section"><h3>操作流程</h3><div class="detail-grid">'+
      '<div class="detail-item"><span class="detail-label">1. 录入费用</span><span class="detail-value">'+(summary.cost_items&&summary.cost_items.length>=1?'✅ 已录入':'❌ 未录入')+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">2. 确认费用完整</span><span class="detail-value">'+(summary.cost_confirmed?'✅ 已确认':'❌ 未确认')+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">3. 费用分摊</span><span class="detail-value">'+(summary.cost_allocated?'✅ 已分摊':'❌ 未分摊')+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">4. 导入原库存</span><span class="detail-value">'+(check.all_imported?'✅ 已完成':'❌ 未完成 ('+check.imported_skus+'/'+check.total_skus+')')+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">5. 更新加权平均成本</span><span class="detail-value">⏳ 待执行</span></div>'+
    '</div>';
    // 操作按钮
    html+='<div class="flex gap-8 mt-16">'+
      (hasPermission('ci_edit')?'<button class="btn btn-secondary btn-sm" onclick="confirmCiCosts(\''+ciId+'\')">✅ 确认费用完整</button>':'')+
      (hasPermission('cost_view')?'<button class="btn btn-secondary btn-sm" onclick="allocateCosts(\''+ciId+'\')">📊 执行费用分摊</button>':'')+
      (hasPermission('cost_view')?'<button class="btn btn-primary btn-sm" onclick="updateWeightedAvg(\''+ciId+'\')" '+(summary.cost_confirmed&&summary.cost_allocated&&check.all_imported?'':'disabled')+'>💰 更新加权平均成本</button>':'')+
    '</div></div>';
    // 分摊明细
    if(allocs&&allocs.length){
      html+='<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📊 分摊明细</div></div><div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>SKU</th><th>商品成本</th><th>分摊运费</th><th>分摊关税</th><th>分摊商检</th><th>总落地成本</th><th>入库量</th><th>含费单位成本</th><th>原库存量</th><th>原成本</th></tr></thead><tbody>'+allocs.map(a=>'<tr><td class="cell-id">'+esc(a.sku_code)+'</td><td class="text-right">'+fmtMoney(a.product_cost)+'</td><td class="text-right">'+fmtMoney(a.allocated_freight)+'</td><td class="text-right">'+fmtMoney(a.allocated_duty)+'</td><td class="text-right">'+fmtMoney(a.allocated_other)+'</td><td class="text-right font-bold">'+fmtMoney(a.total_landing_cost)+'</td><td class="text-right">'+(a.inbound_qty||0)+'</td><td class="text-right font-bold">'+fmtMoney(a.unit_landing_cost_with_fees||a.unit_landing_cost)+'</td><td class="text-right">'+(a.original_qty||0)+'</td><td class="text-right">'+fmtMoney(a.original_avg_cost)+'</td></tr>').join('')+'</tbody></table></div></div>';
    }
    document.getElementById('wac-detail').innerHTML=html;
  }catch(e){showFlash(e.message,'danger')}
}
async function confirmCiCosts(ciId){
  try{await api('/api/commercial-invoices/'+ciId+'/confirm-costs','POST');showToast('费用已确认完整','success');loadWacDetail()}catch(e){showToast(e.message,'danger')}
}
async function allocateCosts(ciId){
  try{const r=await api('/api/cost-allocation/allocate/'+ciId,'POST');showToast('费用分摊完成，共'+(r.allocations?.length||0)+'条','success');loadWacDetail()}catch(e){showToast(e.message,'danger')}
}
async function updateWeightedAvg(ciId){
  if(!confirm('确认更新加权平均成本？这将修改库存表中的数量和成本。'))return;
  try{
    const r=await api('/api/cost-allocation/update-weighted-avg/'+ciId,'POST',{remark:'手动更新'});
    showToast('加权平均成本更新完成，共更新'+r.updated_count+'个SKU','success');
    // 显示详细结果
    if(r.logs&&r.logs.length){
      let logHtml='<div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>原库存</th><th>旧成本</th><th>入库量</th><th>单位落地成本</th><th>新库存</th><th>新成本</th></tr></thead><tbody>'+r.logs.map(l=>'<tr><td class="cell-id">'+esc(l.sku_code)+'</td><td class="text-right">'+l.original_qty+'</td><td class="text-right">'+fmtMoney(l.old_avg_cost)+'</td><td class="text-right">'+l.inbound_qty+'</td><td class="text-right">'+fmtMoney(l.unit_landing_cost)+'</td><td class="text-right font-bold">'+l.new_qty+'</td><td class="text-right font-bold">'+fmtMoney(l.new_avg_cost)+'</td></tr>').join('')+'</tbody></table></div>';
      openModal('加权平均成本更新结果',logHtml,'<button class="btn btn-primary" onclick="closeModal()">确定</button>');
    }
    loadWacDetail();
  }catch(e){showToast(e.message,'danger')}
}
// Tab 4: 成本更新日志
async function loadCostLogs(){
  document.getElementById('cost-tab-content').innerHTML='<div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>CI号</label><input type="text" id="log-ci" onkeypress="if(event.key===\'Enter\')fetchCostLogs()"></div><div class="filter-group"><label>SKU</label><input type="text" id="log-sku" onkeypress="if(event.key===\'Enter\')fetchCostLogs()"></div><div class="filter-group"><label>关键词</label><input type="text" id="log-kw" onkeypress="if(event.key===\'Enter\')fetchCostLogs()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="fetchCostLogs()">搜索</button></div></div></div><div id="cost-logs-table"><div class="empty-state"><div class="empty-icon">📝</div>请搜索查看日志</div></div>';
  fetchCostLogs();
}
async function fetchCostLogs(){
  try{
    const ci=document.getElementById('log-ci')?.value||'',sku=document.getElementById('log-sku')?.value||'',kw=document.getElementById('log-kw')?.value||'';
    const data=await api('/api/cost-update-logs?ci_no='+encodeURIComponent(ci)+'&sku_code='+encodeURIComponent(sku)+'&keyword='+encodeURIComponent(kw));
    document.getElementById('cost-logs-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">📝</div>暂无日志数据</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>时间</th><th>SKU</th><th>国家</th><th>仓库</th><th>关联PO</th><th>关联CI</th><th>原库存</th><th>旧成本</th><th>入库量</th><th>CI单位成本</th><th>单位落地成本</th><th>新库存</th><th>新成本</th><th>操作人</th><th>备注</th></tr></thead><tbody>'+data.map(l=>'<tr><td class="cell-date">'+fmtDate(l.created_at)+' '+String(l.created_at||'').split(' ')[1]||''+'</td><td class="cell-id">'+esc(l.sku_code)+'</td><td>'+esc(l.country)+'</td><td>'+esc(l.warehouse)+'</td><td class="cell-id">'+esc(l.related_po_no)+'</td><td class="cell-id">'+esc(l.related_ci_no)+'</td><td class="text-right">'+l.original_qty+'</td><td class="text-right">'+fmtMoney(l.old_avg_cost)+'</td><td class="text-right">'+l.inbound_qty+'</td><td class="text-right">'+fmtMoney(l.ci_unit_cost)+'</td><td class="text-right">'+fmtMoney(l.unit_landing_cost)+'</td><td class="text-right font-bold">'+l.new_qty+'</td><td class="text-right font-bold">'+fmtMoney(l.new_avg_cost)+'</td><td>'+esc(l.operator_name)+'</td><td>'+esc(l.remark)+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

// ==================== 付款管理 ====================
const PAY_CATEGORIES={goods:'货款',warehouse_arrival:'到仓费用',customs_duty:'关税',inspection_fee:'商检费用'};
const PAY_SUBCATS={
  goods:{deposit:'定金',balance:'尾款'},
  warehouse_arrival:{freight:'运费',customs_clearance:'清关费',port_charges:'港口费',delivery:'派送费',warehouse:'仓储费',other_local:'其他本地费'},
  customs_duty:{duty:'关税'},
  inspection_fee:{inspection:'商检费'}
};
const PAY_STATUS_MAP={pending_approval:'待审批',approved:'已审批',paid:'已付款',rejected:'已驳回',partial_paid:'部分付款',partial_deduction:'部分抵扣',deduction_settled:'全额抵扣',partial_payment_partial_deduction:'部分付款+部分抵扣',cancelled:'已取消'};

async function renderPayment(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="pay-fs"><option value="">全部</option><option value="pending_approval">待审批</option><option value="approved">已审批</option><option value="paid">已付款</option><option value="partial_paid">部分付款</option><option value="rejected">已驳回</option></select></div><div class="filter-group"><label>类别</label><select id="pay-fc"><option value="">全部</option><option value="goods">货款</option><option value="warehouse_arrival">到仓费用</option><option value="customs_duty">关税</option><option value="inspection_fee">商检费用</option></select></div><div class="filter-group"><label>关键词</label><input type="text" id="pay-fk" placeholder="申请号/供应商/来源单号" onkeypress="if(event.key===\'Enter\')loadPay()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadPay()">搜索</button>'+(hasPermission('payment_import')?'<button class="btn btn-secondary btn-sm" onclick="importPayResult()">📥 导入付款结果</button>':'')+'</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">💳 付款申请</div></div><div id="pay-table"></div></div>';
  loadPay();
}
async function loadPay(){
  try{
    const s=document.getElementById('pay-fs')?.value||'',c=document.getElementById('pay-fc')?.value||'',k=document.getElementById('pay-fk')?.value||'';
    const data=await api('/api/payment-requests?status='+s+'&category='+c+'&keyword='+encodeURIComponent(k));
    document.getElementById('pay-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">💳</div>暂无付款数据</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>申请号</th><th>大类</th><th>小类</th><th>来源单号</th><th>关联CI</th><th>付款对象</th><th>应付金额</th><th>抵扣金额</th><th>实际应付</th><th>已付</th><th>未付</th><th>币种</th><th>状态</th><th>操作</th></tr></thead><tbody>'+data.map(p=>{
      const catLabel=PAY_CATEGORIES[p.payment_category]||p.payment_category;
      const subLabel=(PAY_SUBCATS[p.payment_category]&&PAY_SUBCATS[p.payment_category][p.payment_subcategory])||p.payment_subcategory||'';
      const stLabel=PAY_STATUS_MAP[p.payment_status]||p.payment_status;
      const stClass=p.payment_status==='paid'?'status-paid':p.payment_status==='approved'?'status-approved':p.payment_status==='rejected'?'status-rejected':p.payment_status.includes('partial')?'status-pending':'status-pending';
      return '<tr><td class="cell-id">'+esc(p.request_no)+'</td><td>'+esc(catLabel)+'</td><td>'+esc(subLabel)+'</td><td class="cell-id">'+esc(p.source_no)+'</td><td class="cell-id">'+esc(p.related_ci_no||'')+'</td><td>'+esc(p.supplier_name)+'</td><td class="text-right font-bold">'+fmtMoney(p.payable_amount)+'</td><td class="text-right '+(p.deduction_amount>0?'text-warning':'')+'">'+(p.deduction_amount>0?fmtMoney(p.deduction_amount):'-')+'</td><td class="text-right font-bold">'+fmtMoney(p.actual_pay_amount||p.payable_amount)+'</td><td class="text-right">'+fmtMoney(p.paid_amount)+'</td><td class="text-right '+(p.unpaid_amount>0?'text-danger':'')+'">'+fmtMoney(p.unpaid_amount)+'</td><td>'+esc(p.currency)+'</td><td><span class="status-badge '+stClass+'">'+esc(stLabel)+'</span></td><td class="cell-actions">'+(p.payment_status==='pending_approval'&&hasPermission('payment_approve')?'<button class="action-btn action-edit" onclick="apprPay(\''+p.id+'\',\'approve\')" title="通过">✅</button><button class="action-btn action-delete" onclick="apprPay(\''+p.id+'\',\'reject\')" title="驳回">❌</button>':'')+(p.payment_status==='approved'&&hasPermission('payment_approve')?'<button class="action-btn action-edit" onclick="confirmPaid(\''+p.id+'\')" title="确认已付">💵</button>':'')+(p.payment_status==='pending_approval'&&hasPermission('payment_create')?'<button class="action-btn" onclick="editDeduction(\''+p.id+'\')" title="编辑抵扣">✂️</button>':'')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function apprPay(id,act){const rem=act==='reject'?(prompt('驳回原因：')||''):'';try{await api('/api/payment-requests/'+id+'/approve','POST',{action:act,remark:rem});showToast(act==='approve'?'已通过':'已驳回','success');loadPay()}catch(e){showToast(e.message,'danger')}}
async function confirmPaid(id){const v=prompt('实际付款金额（留空全付）：');try{await api('/api/payment-requests/'+id+'/approve','POST',{action:'confirm-paid',paid_amount:v?parseFloat(v):null});showToast('已确认付款','success');loadPay()}catch(e){showToast(e.message,'danger')}}
async function editDeduction(id){
  try{
    const p=await api('/api/payment-requests/'+id.replace(/'/g,''));
    // Since there's no GET by id endpoint, use the list
    const data=await api('/api/payment-requests?keyword='+id);
    const pay=data.find(x=>x.id===id);
    if(!pay){showToast('未找到付款申请','danger');return}
    openModal('编辑抵扣 - '+pay.request_no,
      '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div class="detail-grid mb-16"><div class="detail-item"><span class="detail-label">应付金额</span><span class="detail-value">'+fmtMoney(pay.payable_amount)+' '+esc(pay.currency||'')+'</span></div><div class="detail-item"><span class="detail-label">付款对象</span><span class="detail-value">'+esc(pay.supplier_name)+'</span></div></div>'+
      '<div class="form-grid"><div class="form-group"><label>是否抵扣</label><select id="ded-has" onchange="document.getElementById(\'ded-amt\').disabled=!this.value"><option value="0">否</option><option value="1" '+(pay.has_deduction?'selected':'')+'>是</option></select></div>'+
      '<div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="ded-amt" value="'+(pay.deduction_amount||0)+'" '+(pay.has_deduction?'':'disabled')+'></div>'+
      '<div class="form-group"><label>抵扣来源类型</label><select id="ded-type"><option value="">选择</option><option value="other_payment" '+(pay.deduction_source_type==='other_payment'?'selected':'')+'>其他付款多付</option><option value="price_diff" '+(pay.deduction_source_type==='price_diff'?'selected':'')+'>价格差异</option><option value="quality_claim" '+(pay.deduction_source_type==='quality_claim'?'selected':'')+'>质量索赔</option><option value="advance_payment" '+(pay.deduction_source_type==='advance_payment'?'selected':'')+'>预付款抵扣</option><option value="other" '+(pay.deduction_source_type==='other'?'selected':'')+'>其他</option></select></div>'+
      '<div class="form-group"><label>抵扣参考号</label><input type="text" id="ded-ref" value="'+esc(pay.deduction_ref_no||'')+'"></div>'+
      '<div class="form-group form-group-full"><label>抵扣说明</label><textarea id="ded-desc" rows="2">'+esc(pay.deduction_source_desc||'')+'</textarea></div></div></div>',
      '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveDeduction(\''+id+'\')">保存</button>');
  }catch(e){showToast(e.message,'danger')}
}
async function saveDeduction(id){
  const d={has_deduction:parseInt(document.getElementById('ded-has').value),deduction_amount:parseFloat(document.getElementById('ded-amt').value)||0,deduction_source_type:document.getElementById('ded-type').value,deduction_source_desc:document.getElementById('ded-desc').value,deduction_ref_no:document.getElementById('ded-ref').value};
  try{await api('/api/payment-requests/'+id+'/deduction','PUT',d);showToast('抵扣信息已保存','success');closeModal();loadPay()}catch(e){showToast(e.message,'danger')}
}
function importPayResult(){importFile('/api/payment-requests/bulk-import-result',loadPay)}

// ==================== 呆滞分析 ====================
async function renderStagnant(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>国家</label><input type="text" id="stag-c"></div><div class="filter-group"><label>等级</label><select id="stag-l"><option value="all">全部呆滞</option><option value="light">轻度</option><option value="medium">中度</option><option value="heavy">重度</option><option value="dead">死亡库存</option><option value="backlog">积压</option><option value="severe_backlog">严重积压</option><option value="new_product">新品</option></select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadStag()">搜索</button></div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">⚠️ 呆滞库存</div></div><div id="stag-table"></div></div>';
  loadStag();
}
async function loadStag(){
  try{
    const c=document.getElementById('stag-c')?.value||'',l=document.getElementById('stag-l')?.value||'all';
    const data=await api('/api/stagnant-analysis?country='+encodeURIComponent(c)+'&level='+l);
    const tv=data.reduce((s,i)=>s+(i.inventory_value||0),0);
    document.getElementById('stag-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">✅</div>暂无呆滞库存</div>':'<div class="stats-grid mb-16"><div class="stat-card warning"><div class="stat-number">'+fmtMoney(tv,'USD')+'</div><div class="stat-label">呆滞库存总金额</div></div><div class="stat-card"><div class="stat-number">'+data.length+'</div><div class="stat-label">呆滞SKU数</div></div></div><div class="table-container" style="box-shadow:none;border-radius:0;max-height:600px;overflow:auto"><table class="data-table"><thead><tr><th>SKU</th><th>产品名</th><th>品牌</th><th>国家</th><th>仓库</th><th>库存</th><th>金额</th><th>最后销售</th><th>距今天数</th><th>30d</th><th>60d</th><th>90d</th><th>月预测</th><th>周转月</th><th>新品</th><th>生命周期</th><th>呆滞等级</th><th>建议</th></tr></thead><tbody>'+data.map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td>'+esc(i.product_name)+'</td><td>'+esc(i.brand)+'</td><td>'+esc(i.country)+'</td><td>'+esc(i.warehouse)+'</td><td class="text-right font-bold">'+i.available_qty+'</td><td class="text-right">'+fmtMoney(i.inventory_value)+'</td><td class="cell-date">'+fmtDate(i.last_sale_date)+'</td><td class="text-right">'+(i.days_since_sale!==null?i.days_since_sale:'-')+'</td><td class="text-right">'+i.sales_30d+'</td><td class="text-right">'+i.sales_60d+'</td><td class="text-right">'+i.sales_90d+'</td><td class="text-right">'+i.monthly_forecast+'</td><td class="text-right">'+i.turnover_months+'</td><td>'+(i.is_new_product?'<span class="status-badge status-pending">新品</span>':'-')+'</td><td>'+esc(i.lifecycle_status)+'</td><td><span class="status-badge '+(i.stagnant_level==='dead'||i.stagnant_level==='severe_backlog'?'status-danger':i.stagnant_level==='heavy'||i.stagnant_level==='backlog'?'status-warning':'status-pending')+'">'+esc(i.stagnant_level)+'</span></td><td>'+esc(i.suggestion)+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

// ==================== 货代分析 ====================
async function renderForwarderAnalysis(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>国家</label><input type="text" id="ff-c"></div><div class="filter-group"><label>运输方式</label><select id="ff-m"><option value="">全部</option><option value="sea">海运</option><option value="air">空运</option><option value="express">快递</option></select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadFF()">搜索</button></div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📈 货代分析</div></div><div id="ff-table"></div></div>';
  loadFF();
}
async function loadFF(){
  try{
    const c=document.getElementById('ff-c')?.value||'',m=document.getElementById('ff-m')?.value||'';
    const data=await api('/api/freight-forwarder-analysis?country='+encodeURIComponent(c)+'&transport_mode='+m);
    document.getElementById('ff-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">📈</div>暂无货代分析数据</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>货代</th><th>国家</th><th>方式</th><th>批次</th><th>CI总额</th><th>总CBM</th><th>总重量</th><th>综合运费</th><th>关税</th><th>运费占比</th><th>每CBM</th><th>每KG</th><th>运输天</th><th>清关天</th><th>派送天</th></tr></thead><tbody>'+data.map(f=>'<tr><td class="cell-name">'+esc(f.forwarder_name)+'</td><td>'+esc(f.target_country)+'</td><td>'+esc(f.transport_mode)+'</td><td class="text-center">'+f.batch_count+'</td><td class="text-right">'+fmtMoney(f.total_ci_amount)+'</td><td class="text-right">'+(f.total_cbm||0)+'</td><td class="text-right">'+(f.total_weight||0)+'</td><td class="text-right font-bold">'+fmtMoney(f.total_freight)+'</td><td class="text-right">'+fmtMoney(f.total_duty)+'</td><td class="text-right '+(f.freight_ratio>15?'text-danger':f.freight_ratio>10?'text-warning':'')+'">'+f.freight_ratio+'%</td><td class="text-right">'+(f.freight_per_cbm||0)+'</td><td class="text-right">'+(f.freight_per_kg||0)+'</td><td class="text-right">'+(f.avg_transport_days||'-')+'</td><td class="text-right">'+(f.avg_customs_days||'-')+'</td><td class="text-right">'+(f.avg_delivery_days||'-')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

// ==================== 库存盘点 ====================
async function renderCheck(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>国家</label><input type="text" id="chk-c"></div><div class="filter-group"><label>仓库</label><input type="text" id="chk-w"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadChk()">搜索</button>'+(hasPermission('check_create')?'<button class="btn btn-secondary btn-sm" onclick="exportChkTpl()">📋 导出模板</button><button class="btn btn-secondary btn-sm" onclick="importFile(\'/api/inventory-checks/bulk-import\',loadChk)">📥 导入盘点</button>':'')+'</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🔍 盘点记录</div></div><div id="chk-table"></div></div>';
  loadChk();
}
async function loadChk(){
  try{
    const c=document.getElementById('chk-c')?.value||'',w=document.getElementById('chk-w')?.value||'';
    const data=await api('/api/inventory-checks?country='+encodeURIComponent(c)+'&warehouse='+encodeURIComponent(w));
    document.getElementById('chk-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">🔍</div>暂无盘点数据</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>盘点单号</th><th>国家</th><th>仓库</th><th>日期</th><th>SKU</th><th>系统库存</th><th>实盘</th><th>差异</th><th>差异金额</th><th>原因</th><th>处理</th><th>审批</th><th>操作</th></tr></thead><tbody>'+data.map(c=>'<tr><td class="cell-id">'+esc(c.check_no)+'</td><td>'+esc(c.country)+'</td><td>'+esc(c.warehouse)+'</td><td class="cell-date">'+fmtDate(c.check_date)+'</td><td class="cell-id">'+esc(c.sku_code)+'</td><td class="text-right">'+c.system_qty+'</td><td class="text-right font-bold">'+c.actual_qty+'</td><td class="text-right '+(c.diff_qty!==0?'text-danger':'')+'">'+(c.diff_qty>0?'+':'')+c.diff_qty+'</td><td class="text-right">'+fmtMoney(c.diff_amount)+'</td><td>'+esc(c.diff_reason)+'</td><td>'+esc(c.handle_method)+'</td><td><span class="status-badge '+(c.approval_status==='approved'?'status-approved':'status-pending')+'">'+esc(c.approval_status)+'</span></td><td>'+(c.approval_status==='pending'&&hasPermission('check_approve')?'<button class="action-btn action-edit" onclick="apprChk(\''+c.id+'\')" title="审批">✅</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function exportChkTpl(){
  const c=document.getElementById('chk-c')?.value||'',w=document.getElementById('chk-w')?.value||'';
  try{const data=await api('/api/inventory-checks/template?country='+encodeURIComponent(c)+'&warehouse='+encodeURIComponent(w));const ws=XLSX.utils.json_to_sheet(data.map(d=>({国家:d.country,仓库:d.warehouse,SKU:d.sku_code,产品名:d.product_name,品牌:d.brand,系统库存:d.system_qty,实盘库存:'',差异原因:'',处理方式:'',盘点日期:todayStr()})));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'盘点模板');XLSX.writeFile(wb,'盘点模板_'+(c||'all')+'.xlsx')}catch(e){showToast(e.message,'danger')}
}
async function apprChk(id){if(!confirm('确认审批通过？将调整库存。'))return;try{await api('/api/inventory-checks/'+id+'/approve','POST');showToast('已审批','success');loadChk()}catch(e){showToast(e.message,'danger')}}

// ==================== 初始化 ====================
window.addEventListener('DOMContentLoaded',()=>{
  // 直开 HTML 文件（file://）时后端不可达，先给出醒目指引
  if(isFileProtocol()){
    showFatalNotice('⚠️ 检测到您直接打开了 HTML 文件（file://）。进销存系统需要后端服务，请：<br>① 在终端运行 <b>node server.js</b><br>② 浏览器访问 <b>http://localhost:3001</b>（默认账号 admin / admin）<br>不要直接双击 index.html。');
    return;
  }
  const saved=localStorage.getItem('inv_user');
  if(saved){try{currentUser=JSON.parse(saved);showApp()}catch(e){}}
});
