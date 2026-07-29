// ==================== 进销存管理系统 - 前端逻辑 ====================
let currentUser=null;let currentPage='dashboard';

// --- 工具函数 ---
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtMoney(v,c){const n=Number(v||0);return(c?c+' ':'')+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
// 数量类显示专用格式化：标准四舍五入取整，仅影响页面显示，不改原始数据/计算精度/导出
// 覆盖：销量、库存、在途、PO/PI数量、建议采购、分摊库存等
// 不覆盖：周转月数、占比、百分比、日期、金额、单价、汇率、CBM、KG
function formatQuantityDisplay(value){var n=Number(value||0);return Math.round(n)}
function fmtDate(d){return d?String(d).split('T')[0]:''}
function todayStr(){return new Date().toISOString().split('T')[0]}
function b64EncodeUnicode(s){return btoa(unescape(encodeURIComponent(String(s||''))))}
function b64DecodeUnicode(s){return decodeURIComponent(escape(atob(String(s||''))))}
function showToast(msg,type='info'){const c=document.getElementById('toast-container');const t=document.createElement('div');t.className='toast toast-'+type;t.innerHTML='<div>'+esc(msg)+'</div>';c.appendChild(t);setTimeout(()=>{t.style.opacity='0';setTimeout(()=>t.remove(),300)},3500)}
function showFlash(msg,type='info'){const c=document.getElementById('flash-container');if(!c)return;c.innerHTML='<div class="flash flash-'+type+' show">'+esc(msg)+'</div>';setTimeout(()=>{if(c)c.innerHTML=''},4000)}
function openModal(title,body,footer='',size=''){const mc=document.getElementById('modal-content');mc.className='modal'+(size?' '+size:'');if(size&&size.indexOf('modal-pi')!==-1){const sb=document.querySelector('.sidebar');if(sb&&sb.classList.contains('collapsed')){mc.classList.add('pi-sidebar-collapsed')}else{mc.classList.add('pi-sidebar-expanded')}}mc.innerHTML='<div class="modal-header"><span class="modal-title">'+esc(title)+'</span><button class="modal-close" onclick="closeModal()">&times;</button></div><div class="modal-body">'+body+'</div>'+(footer?'<div class="modal-footer">'+footer+'</div>':'');document.getElementById('modal-overlay').classList.add('show')}
function closeModal(){document.getElementById('modal-overlay').classList.remove('show')}
function rowClickView(e,fn){var t=e.target;if(t.closest('button,a,input,select,textarea,label,[contenteditable="true"],[role="button"],[data-row-click-ignore],.link-text,.action-btn,.checkbox,[onclick]:not(tr)'))return;var args=Array.prototype.slice.call(arguments,2);if(typeof window[fn]==='function')window[fn].apply(null,args);}
// 语言切换刷新守卫：modal 打开时不刷新当前页（避免丢失 modal 内未提交内容）
function isModalOpen(){const ov=document.getElementById('modal-overlay');return !!(ov&&ov.classList.contains('show'));}
// 最小未保存标志：仅 Brand Settings 的 inline 编辑使用，不构建全局 pageDirty 系统
window.__brandUnsaved=false;

// ==================== 状态显示统一（RC-B 修复，纯显示层） ====================
// 数据库 status 值保持不变；仅把 status 值映射为当前语言显示文本。
// 全部枚举集中在此，新增 status 值需同步在 i18n.js 增加 status.* 键并登记到本映射。
const STATUS_KEY_MAP={
  active:'status.active', pending:'status.pending', disabled:'status.disabled',
  approved:'status.approved', rejected:'status.rejected',
  paid:'status.paid', unpaid:'status.unpaid', partial:'status.partial',
  draft:'status.draft', open:'status.open', completed:'status.completed',
  pending_approval:'status.pending_approval', transferred_pi:'status.transferred_pi',
  cancelled:'status.cancelled', reversed:'status.reversed',
  normal:'status.normal', out_of_stock_risk:'status.out_of_stock_risk', high_stock:'status.high_stock',
  slow_moving:'status.slow_moving', clearance:'status.clearance', abnormal:'status.abnormal', in_transit:'status.in_transit',
  partial_paid:'status.partial_paid', partial_deduction:'status.partial_deduction',
  partial_rounding:'status.partial_rounding', deduction_settled:'status.deduction_settled',
  partial_payment_partial_deduction:'status.partial_payment_partial_deduction'
};
const STATUS_ZH={
  active:'启用', pending:'待激活', disabled:'已停用', approved:'已通过', rejected:'已驳回',
  paid:'已付款', unpaid:'未付款', partial:'部分', draft:'草稿', open:'进行中', completed:'已完成',
  pending_approval:'待审批', transferred_pi:'已转PI', cancelled:'已取消', reversed:'已冲销',
  normal:'正常', out_of_stock_risk:'断货风险', high_stock:'高库存', slow_moving:'慢销',
  clearance:'清仓', abnormal:'异常', in_transit:'在途',
  partial_paid:'部分付款', partial_deduction:'部分抵扣', partial_rounding:'部分抹零',
  deduction_settled:'全额抵扣', partial_payment_partial_deduction:'部分付款+部分抵扣'
};
// status 值 → 当前语言显示文本（未知值原样返回，避免空白）
function statusLabel(s){
  if(s==null||s==='') return '-';
  const k=STATUS_KEY_MAP[s];
  if(k) return t(k, STATUS_ZH[s]||s);
  return STATUS_ZH[s]||s;
}
// CI status → CSS badge class mapping
function ciStatusClass(s){
  if(!s) return 'status-unpaid';
  if(s==='paid'||s==='completed'||s==='deduction_settled') return 'status-paid';
  if(s==='pending_approval'||s==='pending'||s==='draft'||s==='approved') return 'status-pending';
  if(s==='rejected'||s==='cancelled'||s==='reversed'||s==='unpaid') return 'status-unpaid';
  if(String(s).indexOf('partial')>=0) return 'status-pending';
  return 'status-unpaid';
}
function showModal(html){document.getElementById('modal-content').innerHTML=html;document.getElementById('modal-overlay').classList.add('show')}

// 批量操作结果报告弹窗
function showBatchResultModal(result, page){
  const total = (result.success||0)+(result.failed||0)+(result.skipped||0);
  const successRate = total > 0 ? Math.round((result.success/total)*100) : 0;
  let errors = [];
  try { errors = typeof result.errors === 'string' ? JSON.parse(result.errors) : (result.errors||[]); } catch(e) { errors = []; }

  const html = '<div class="modal-header"><h3>'+t("modal.batch_result.title", "📊 批量操作结果报告")+'</h3><button class="modal-close" onclick="closeModal()">×</button></div>'
    +'<div class="modal-body">'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:16px">'
    +'<div style="text-align:center;padding:12px;background:#e8f5e9;border-radius:8px"><div style="font-size:24px;font-weight:700;color:#2e7d32">'+(result.success||0)+'</div><div style="font-size:12px;color:#666">'+t("modal.batch.success", "成功")+'</div></div>'
    +'<div style="text-align:center;padding:12px;background:#ffebee;border-radius:8px"><div style="font-size:24px;font-weight:700;color:#c62828">'+(result.failed||0)+'</div><div style="font-size:12px;color:#666">'+t("modal.batch.fail", "失败")+'</div></div>'
    +'<div style="text-align:center;padding:12px;background:#fff3cd;border-radius:8px"><div style="font-size:24px;font-weight:700;color:#f57f17">'+(result.skipped||0)+'</div><div style="font-size:12px;color:#666">'+t("modal.batch.skip", "跳过")+'</div></div>'
    +'<div style="text-align:center;padding:12px;background:var(--bg-hover,#f5f5f5);border-radius:8px"><div style="font-size:24px;font-weight:700">'+successRate+'%</div><div style="font-size:12px;color:#666">'+t("modal.batch.rate", "成功率")+'</div></div>'
    +'</div>'
    +(result.recalc_count !== undefined ? t('gen.L69.1','<div style="margin-bottom:12px;padding:8px 12px;background:#e3f2fd;border-radius:6px;font-size:13px;color:#1565c0">🔄 已触发 ')+result.recalc_count+t('gen.L69.2',' 条SKU库存重算（周转月/库存状态/预测）</div>') : '')
    +(errors.length > 0 ?
      t('gen.L71.1','<div style="margin-bottom:12px"><div style="font-weight:600;margin-bottom:8px">失败明细：</div>')
      +'<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border,#e0e0e0);border-radius:6px">'
      +errors.map(e=>'<div style="padding:6px 12px;border-bottom:1px solid var(--border,#eee);font-size:13px"><span style="color:#c62828">✗</span> '+(e.sku_code||e.id||'')+' — '+esc(e.reason||'')+'</div>').join('')
      +'</div></div>'
      +t('gen.L75.1','<button class="btn btn-sm btn-secondary" onclick="downloadBatchErrors()">📥 下载错误报告</button>')
    : t('gen.L76.1','<div style="text-align:center;padding:20px;color:#2e7d32">✅ 全部执行成功</div>'))
    +'</div>'
    +'<div class="modal-footer">'
    +'<button class="btn btn-secondary" onclick="closeModal()">'+t("action.close", "关闭")+'</button>'
    +'<button class="btn btn-primary" onclick="closeModal();showPage(\'batch-tasks\')">'+t("modal.batch.task_center", "查看任务中心")+'</button>'
    +'</div>';

  // 存储错误数据供下载
  window._lastBatchErrors = errors;
  showModal(html);
}

function downloadBatchErrors(){
  const errors = window._lastBatchErrors || [];
  if(!errors.length) return;
  if(typeof XLSX === 'undefined'){ showFlash(t("toast.xlsx_missing", "XLSX库未加载"),'danger'); return; }
  const headers = ['ID','SKU',t("html.batch.err_reason", "失败原因")];
  const rows = errors.map(e=>[e.id||'', e.sku_code||'', e.reason||'']);
  const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t("app.013", "\u9519\u8bef\u62a5\u544a"));
  XLSX.writeFile(wb, t('gen.L97.1','批量操作错误报告_')+new Date().toISOString().slice(0,10)+'.xlsx');
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
  const h={'Content-Type':'application/json','Accept-Language':(typeof getLang==='function'?getLang():'zh')};
  const o={method,headers:h,credentials:'same-origin'};if(body)o.body=JSON.stringify(body);
  let r;
  try{
    r=await fetch(url,o);
  }catch(err){
    // fetch 网络层失败：服务未启动 / 地址不可达 / 以 file:// 打开 —— 正是 "Failed to fetch" 的根因
    const tip=isFileProtocol()
      ? t('err.file_protocol','⚠️ 检测到您直接打开了 HTML 文件（file://）。本系统必须通过后端服务访问，请：<br>① 在终端运行 <b>node server.js</b><br>② 浏览器打开 <b>http://localhost:3001</b>（默认账号 admin / admin）<br>不要直接双击 index.html。')
      : t('err.fetch_failed','⚠️ 无法连接服务器（Failed to fetch）。请确认已运行 <b>node server.js</b>，并通过 <b>http://localhost:3001</b> 访问本系统（不要使用静态文件服务器或 file:// 打开）。');
    throw new Error(tip);
  }
  if(r.status===401){doLogout();throw new Error(t('err.not_logged_in','未登录，请重新登录'))}
  if(r.status===403){showToast(t('err.no_permission_toast','没有操作权限'),'danger');throw new Error(t('err.no_permission','没有该操作的权限'))}
  let d;
  try{ d=await r.json(); }catch(e){ throw new Error(t('err.non_json','服务器返回了非 JSON 响应，可能后端服务未正常启动。请检查终端中 <b>node server.js</b> 是否在运行。')); }
  if(d&&d.error)throw new Error(d.error);
  return d;
}

// --- 登录（飞书 OAuth 主入口 + break-glass 应急）---
// 飞书登录：直接跳转后端授权端点（生产环境由后端 302 到飞书；test 环境由测试脚本驱动）
function doFeishuLogin(){ window.location.href='/api/auth/feishu/login?lang='+encodeURIComponent(typeof getLang==='function'?getLang():'zh'); }
function toggleBreakGlass(){ const f=document.getElementById('bg-form'); if(f) f.style.display = (f.style.display==='none'||!f.style.display)?'block':'none'; }
async function doBreakGlassLogin(){
  const u=document.getElementById('bg-username');
  const p=document.getElementById('bg-password');
  if(!u||!p){alert(t('login.controlNotLoaded','登录控件未加载'));return}
  if(!u.value||!p.value){showToast(t('login.enterEmergencyCreds','请输入应急账号和密码'),'warning');return}
  try{
    const d=await api('/api/auth/local/login','POST',{username:u.value,password:p.value});
    currentUser=d;
    // I18N-B1-FINAL-4-GAPS-CLOSEOUT：应急登录成功后应用用户语言偏好（共享函数；skipSave 不触发保存 API）
    applyCurrentUserLanguagePreference(d);
    showApp();
  }catch(e){
    showToast(t('toast.doBreakGlassLogin', '应急登录失败: {v1}', {v1: e.message||e}),'danger');
  }
}
// pending 落地页：仅显示"账号已识别，等待管理员授权"，业务接口由后端 apiAuth 拦截
function showPendingPage(data){
  const lp=document.getElementById('login-page'); if(lp) lp.style.display='none';
  const app=document.getElementById('app'); if(app) app.style.display='none';
  const pp=document.getElementById('pending-page');
  if(pp){ const nm=document.getElementById('pending-name'); if(nm) nm.textContent=(data&&(data.name||data.username))||''; pp.style.display='flex'; }
}
function doLogout(){
  api('/api/logout','POST').catch(()=>{}).finally(()=>{
    currentUser=null;
    const lp=document.getElementById('login-page'); if(lp) lp.style.display='flex';
    const pp=document.getElementById('pending-page'); if(pp) pp.style.display='none';
    const app=document.getElementById('app'); if(app) app.style.display='none';
  });
}
function showApp(){
  const lp=document.getElementById('login-page');if(lp)lp.style.display='none';
  const pp=document.getElementById('pending-page');if(pp)pp.style.display='none';
  document.getElementById('app').style.display='flex';
  // break-glass 本地应急账号：内置系统标签按语言显示；真实飞书用户姓名保持原文
  const isLocal=currentUser.auth_source==='local' || currentUser.username==='admin';
  const displayName=isLocal ? t('auth.breakglass_admin_label','超级管理员') : (currentUser.name||'');
  document.getElementById('user-name').textContent=displayName;
  renderUserRole();
  document.getElementById('user-avatar').textContent=(displayName||'U').charAt(0).toUpperCase();
  renderTopNav();renderSidebar();initSidebarCollapse();showPage('dashboard');
}

// 用户角色标签国际化（仅显示用，不改动权限/业务逻辑）；语言切换时由 i18n.setLang 重新调用
// 系统内置角色使用独立静态 i18n key；自定义/未知角色 fallback 到 role_name 原文，不出现 undefined/unknown/空白。
function renderUserRole(){
  var el=document.getElementById('user-role');
  if(!el||!currentUser) return;
  el.textContent=formatRoleLabel(currentUser.role_id, currentUser.role_name);
  // 同步刷新顶部用户显示名称（break-glass 本地账号按语言显示，真实飞书姓名保持原文）
  var nameEl=document.getElementById('user-name');
  if(nameEl){
    var isLocal=currentUser.auth_source==='local' || currentUser.username==='admin';
    nameEl.textContent=isLocal ? t('auth.breakglass_admin_label','超级管理员') : (currentUser.name||'');
  }
}

// 统一角色显示函数（仅显示用）：内置角色三语翻译，自定义/未知角色保持 role_name 原文。
// role_id 为空或 role_name 为空时安全显示 "—"。
function formatRoleLabel(roleId, roleName){
  if(!roleId && !roleName) return '—';
  // 内置角色静态映射：每个 role_id 使用独立 i18n key，zh fallback 为数据库原始中文名
  var builtin = {
    'role_admin': { key:'role.admin', zh:'超级管理员' },
    'role_operator': { key:'role.operator', zh:'运营人员' },
    'role_viewer': { key:'role.viewer', zh:'普通用户' }
  };
  var entry = builtin[roleId];
  if(entry){
    // 已登录内置角色：返回当前语言翻译；zh fallback 到数据库中文名以保持语义一致
    return t(entry.key, entry.zh);
  }
  // 自定义或未知角色：保持 role_name 原文，不误套翻译
  return roleName || '—';
}

// SYS-ROLE-I18N-UX-02：内置角色描述显示函数（仅显示用）
// 内置角色描述按 role.id 映射三语，自定义角色描述保持数据库原文。
function formatRoleDescription(roleId, roleDesc){
  var descMap = {
    'role_admin': { key:'role.description.admin', zh:'拥有系统全部管理权限' },
    'role_operator': { key:'role.description.operator', zh:'业务操作权限，含审批与导入导出' },
    'role_viewer': { key:'role.description.viewer', zh:'只读查看权限' }
  };
  var entry = descMap[roleId];
  if(entry) return t(entry.key, entry.zh);
  return roleDesc || t("app.425", "（无）");
}

// SYS-ROLE-I18N-UX-02：权限分类显示函数（module 为 server.js PERM_LABELS 中的中文分类名，作为稳定 key 后缀）
function formatPermModule(module){
  return t('permission.category.'+module, module);
}

// SYS-ROLE-I18N-UX-02：权限名称显示函数（permKey 为 server.js PERM_LABELS 中的稳定 permission.key）
function formatPermLabel(permKey, fallbackLabel){
  return t('permission.label.'+permKey, fallbackLabel);
}

// --- 导航结构定义 ---
const NAV_MODULES=[
  {id:'home',key:'nav.home',label:t("nav.dashboard", "\u9996\u9875\u770b\u677f"),items:[
    {id:'dashboard',key:'nav.dashboard',icon:'📊',label:t("nav.dashboard", "\u9996\u9875\u770b\u677f"),perm:'dashboard_view'},
  ]},
  {id:'inventory',key:'nav.inventory',label:t("nav.inventory", "\u5e93\u5b58\u7ba1\u7406"),items:[
    {id:'skus',key:'nav.skus',icon:'🏷️',label:t("nav.skus", "SKU\u4e3b\u6570\u636e"),perm:'sku_view'},
    {id:'inventory',key:'nav.inventory_total',icon:'📦',label:t("nav.inventory_total","库存总表"),perm:'inventory_view'},
    {id:'check',key:'nav.stock_check',icon:'🔍',label:t("nav.stock_check", "\u5e93\u5b58\u76d8\u70b9"),perm:'check_view'},
    {id:'stagnant',key:'nav.stagnant',icon:'⚠️',label:t("nav.stagnant", "\u5446\u6ede\u5206\u6790"),perm:'stagnant_view'},
  ]},
  {id:'sales',key:'nav.sales',label:t("nav.sales","销售"),items:[
    {id:'outbound',key:'nav.sales_data',icon:'🛒',label:t("nav.sales_data","销售数据"),perm:'outbound_view'},
    {id:'replenishment',key:'nav.forecast',icon:'📈',label:t("nav.forecast","订单预测"),perm:'replenishment_view'},
  ]},
  {id:'procurement',key:'nav.procurement',label:t("nav.procurement", "\u91c7\u8d2d\u94fe"),items:[
    {id:'po',key:'nav.po',icon:'🛒',label:t("nav.po", "PO\u7ba1\u7406"),perm:'po_view'},
    {id:'pi',key:'nav.pi',icon:'📄',label:t("nav.pi", "PI\u7ba1\u7406"),perm:'pi_view'},
    {id:'ci',key:'nav.ci',icon:'🚚',label:t("nav.ci", "CI/PL\u7ba1\u7406"),perm:'ci_view'},
    {id:'logistics',key:'nav.logistics',icon:'🚢',label:t("nav.logistics", "\u7269\u6d41\u7ba1\u7406"),perm:'logistics_view'},
    {id:'inbound',key:'nav.inbound',icon:'📥',label:t("nav.inbound", "\u5165\u5e93\u7ba1\u7406"),perm:'inbound_view'},
  ]},
  {id:'approval',key:'nav.approval',label:t("nav.approval_center", "\u5ba1\u6279\u4e2d\u5fc3"),items:[
    {id:'approval-center',key:'nav.approval_center',icon:'✅',label:t("nav.approval_center", "\u5ba1\u6279\u4e2d\u5fc3"),perm:'po_approve'},
  ]},
  {id:'finance',key:'nav.finance',label:t("nav.finance","财务"),items:[
    {id:'payable-cockpit',key:'nav.payable_cockpit',icon:'🧭',label:t("nav.payable_cockpit","应付驾驶舱"),perm:'payment_view'},
    {id:'payment',key:'nav.payment',icon:'💳',label:t("nav.payment", "\u4ed8\u6b3e\u7ba1\u7406"),perm:'payment_view'},
    {id:'cost',key:'nav.cost',icon:'💰',label:t("nav.cost", "\u6210\u672c\u7ba1\u7406"),perm:'cost_view'},
  ]},
  {id:'system',key:'nav.system',label:t("nav.system", "\u7cfb\u7edf\u7ba1\u7406"),items:[
    {id:'users',key:'nav.users',icon:'👤',label:t("nav.users", "\u7528\u6237\u7ba1\u7406"),perm:'user_manage'},
    {id:'roles',key:'nav.roles',icon:'🛡️',label:t("nav.roles","角色权限"),perm:'role_manage'},
    {id:'countries',key:'nav.countries',icon:'🌍',label:t("nav.countries", "\u56fd\u5bb6\u7ba1\u7406"),perm:'system_config'},
    {id:'warehouses',key:'nav.warehouses',icon:'🏭',label:t("nav.warehouses", "\u4ed3\u5e93\u7ba1\u7406"),perm:'system_config'},
    {id:'brand-settings',key:'nav.brand_settings',icon:'🏷️',label:t("nav.brand_settings", "\u54c1\u724c\u8bbe\u7f6e"),perm:'system_config'},
    {id:'currencies',key:'nav.currencies',icon:'💱',label:t("nav.currencies", "\u5e01\u79cd\u8bbe\u7f6e"),perm:'system_config'},
    {id:'operation-logs',key:'nav.operation_logs',icon:'📝',label:t("nav.operation_logs", "\u64cd\u4f5c\u65e5\u5fd7"),perm:'inventory_view'},
    {id:'config',key:'nav.config',icon:'⚙️',label:t("nav.config", "\u7cfb\u7edf\u53c2\u6570"),perm:'system_config'},
    {id:'suppliers',key:'nav.suppliers',icon:'🏢',label:t("nav.suppliers", "\u4f9b\u5e94\u5546\u7ba1\u7406"),perm:'system_config'},
    {id:'freight-forwarders',key:'nav.freight_forwarders',icon:'🚛',label:t("nav.freight_forwarders", "\u8d27\u4ee3\u7ba1\u7406"),perm:'system_config'},
    {id:'payment-terms',key:'nav.payment_terms',icon:'📋',label:t("nav.payment_terms", "\u4ed8\u6b3e\u6761\u4ef6"),perm:'system_config'},
    {id:'payment-categories',key:'nav.payment_categories',icon:'🗂️',label:t("nav.payment_categories", "\u4ed8\u6b3e\u7c7b\u76ee\u7ba1\u7406"),perm:'system_config'},
    {id:'payer-entities',key:'nav.payer_entities',icon:'🏦',label:t("nav.payer_entities", "\u4ed8\u6b3e\u4e3b\u4f53"),perm:'system_config'},
    {id:'approval-flows',key:'nav.approval_flows',icon:'✅',label:t("nav.approval_flows", "\u5ba1\u6279\u6d41\u7ba1\u7406"),perm:'system_config'},
    {id:'expense-types',key:'nav.expense_types',icon:'📊',label:t("nav.expense_types", "\u8d39\u7528\u7c7b\u578b"),perm:'system_config'},
    {id:'allocation-rules',key:'nav.allocation_rules',icon:'📐',label:t("nav.allocation_rules", "\u5206\u644a\u89c4\u5219"),perm:'system_config'},
    {id:'batch-tasks',key:'nav.batch_tasks',icon:'📋',label:t("nav.batch_tasks", "\u6279\u91cf\u4efb\u52a1\u4e2d\u5fc3"),perm:'inventory_view'},
    {id:'forwarder',key:'nav.forwarder_analysis',icon:'📈',label:t("nav.forwarder_analysis", "\u8d27\u4ee3\u5206\u6790"),perm:'forwarder_view'},
  ]},
];
// 导航中文 fallback：避免 label 在加载时被 t() 凝固为非中文
var NAV_ZH={
  'nav.home':'首页看板','nav.dashboard':'首页看板','nav.inventory':'库存管理',
  'nav.inventory_total':'库存总表','nav.skus':'SKU主数据','nav.stock_check':'库存盘点',
  'nav.stagnant':'呆滞分析','nav.sales':'销售','nav.sales_data':'销售数据',
  'nav.forecast':'订单预测','nav.procurement':'采购链','nav.po':'PO管理',
  'nav.pi':'PI管理','nav.ci':'CI/PL管理','nav.logistics':'物流管理','nav.inbound':'入库管理',
  'nav.approval':'审批中心','nav.approval_center':'审批中心','nav.finance':'财务',
  'nav.payable_cockpit':'应付驾驶舱','nav.payment':'付款管理','nav.cost':'成本管理',
  'nav.system':'系统管理','nav.users':'用户管理','nav.roles':'角色权限',
  'nav.countries':'国家管理','nav.warehouses':'仓库管理','nav.brand_settings':'品牌设置',
  'nav.currencies':'币种设置','nav.operation_logs':'操作日志','nav.config':'系统参数',
  'nav.suppliers':'供应商管理','nav.freight_forwarders':'货代管理','nav.payment_terms':'付款条件',
  'nav.payment_categories':'付款类别管理','nav.payer_entities':'付款主体','nav.approval_flows':'审批流管理',
  'nav.expense_types':'费用类型','nav.allocation_rules':'分摊规则','nav.batch_tasks':'批量任务中心',
  'nav.forwarder_analysis':'货代分析'
};
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
    html+='<a class="topnav-item'+(currentModule===m.id?' active':'')+'" onclick="switchModule(\''+m.id+'\')">'+t(m.key,NAV_ZH[m.key]||m.label)+'</a>';
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
  if(titleEl)titleEl.textContent=t('nav.app_title','进销存系统');
  const vis=mod.items.filter(i=>hasPermission(i.perm));
  let html='';
  vis.forEach(i=>{html+='<div class="sidebar-item" data-page="'+i.id+'" onclick="showPage(\''+i.id+'\')" title="'+t(i.key,NAV_ZH[i.key]||i.label)+'"><span class="icon">'+i.icon+'</span><span>'+t(i.key,NAV_ZH[i.key]||i.label)+'</span></div>'});
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
  const titles={dashboard:t("nav.dashboard", "\u9996\u9875\u770b\u677f"),skus:t("nav.skus", "SKU\u4e3b\u6570\u636e"),inventory:t("page.inventory_total","库存总表"),outbound:t("nav.outbound","销售数据"),replenishment:t("nav.replenishment","订单预测"),stagnant:t("nav.stagnant", "\u5446\u6ede\u5206\u6790"),check:t("nav.stock_check", "\u5e93\u5b58\u76d8\u70b9"),po:t("nav.po", "PO\u7ba1\u7406"),pi:t("nav.pi", "PI\u7ba1\u7406"),ci:t("nav.ci", "CI/PL\u7ba1\u7406"),logistics:t("nav.logistics", "\u7269\u6d41\u7ba1\u7406"),inbound:t("nav.inbound", "\u5165\u5e93\u7ba1\u7406"),cost:t("nav.cost", "\u6210\u672c\u7ba1\u7406"),payment:t("nav.payment", "\u4ed8\u6b3e\u7ba1\u7406"),'payable-cockpit':t("nav.payable_cockpit","应付驾驶舱"),forwarder:t("nav.forwarder_analysis", "\u8d27\u4ee3\u5206\u6790"),countries:t("nav.countries", "\u56fd\u5bb6\u7ba1\u7406"),warehouses:t("nav.warehouses", "\u4ed3\u5e93\u7ba1\u7406"),suppliers:t("nav.suppliers", "\u4f9b\u5e94\u5546\u7ba1\u7406"),'freight-forwarders':t("nav.freight_forwarders", "\u8d27\u4ee3\u7ba1\u7406"),currencies:t("nav.currencies", "\u5e01\u79cd\u8bbe\u7f6e"),config:t("nav.config", "\u7cfb\u7edf\u53c2\u6570"),'payment-terms':t("nav.payment_terms", "\u4ed8\u6b3e\u6761\u4ef6"),'approval-flows':t("nav.approval_flows", "\u5ba1\u6279\u6d41\u7ba1\u7406"),'approval-center':t("nav.approval_center", "\u5ba1\u6279\u4e2d\u5fc3"),'expense-types':t("nav.expense_types", "\u8d39\u7528\u7c7b\u578b"),'allocation-rules':t("nav.allocation_rules", "\u5206\u644a\u89c4\u5219"),users:t("nav.users", "\u7528\u6237\u7ba1\u7406"),roles:t("nav.roles","角色权限"),'batch-tasks':t("nav.batch_tasks", "\u6279\u91cf\u4efb\u52a1\u4e2d\u5fc3"),'brand-settings':t("nav.brand_settings", "\u54c1\u724c\u8bbe\u7f6e"),'operation-logs':t("nav.operation_logs", "\u64cd\u4f5c\u65e5\u5fd7"),'payment-categories':t("nav.payment_categories", "\u4ed8\u6b3e\u7c7b\u76ee\u7ba1\u7406"),'payer-entities':t("nav.payer_entities", "\u4ed8\u6b3e\u4e3b\u4f53")};
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>';
  const R={dashboard:renderDashboard,skus:renderSKUs,inventory:renderInventory,outbound:renderOutbound,replenishment:renderReplenishment,stagnant:renderStagnant,check:renderCheck,po:renderPO,pi:renderPI,ci:renderCI,logistics:renderLogistics,inbound:renderInbound,cost:renderCost,payment:renderPayment,'payable-cockpit':renderPayableCockpit,forwarder:renderForwarderAnalysis,countries:renderCountries,warehouses:renderWarehouses,suppliers:renderSuppliers,'freight-forwarders':renderFreightForwarders,currencies:renderCurrencies,config:renderConfig,'payment-terms':renderPaymentTerms,'approval-flows':renderApprovalFlows,'approval-center':renderApprovalCenter,'expense-types':renderExpenseTypes,'allocation-rules':renderAllocationRules,users:renderUsers,roles:renderRoles,'batch-tasks':renderBatchTasks,'brand-settings':renderBrandSettings,'operation-logs':renderOperationLogs,'payment-categories':renderPaymentCategories,'payer-entities':renderPayerEntities};
  if(R[page])R[page]();
}

// ==================== 首页看板 ====================
async function renderDashboard(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="stats-grid" id="dash-stats"><div class="empty-state"><div class="empty-icon">⏳</div>'+t("html.dash.loading", "加载中...")+'</div></div><div class="chart-container"><h3 style="margin-bottom:12px">'+t("html.dash.freight_trend", "运费占比趋势")+'</h3><div class="chart-canvas-wrapper"><canvas id="chart-freight"></canvas></div></div><div class="stats-grid" id="dash-pending"></div>';
  try{
    const d=await api('/api/dashboard');
    // 竞态防护：页面已切走则静默结束，不向已销毁 DOM 写入（避免跨页面 null 错误）
    const statsEl=document.getElementById('dash-stats');
    const pendingEl=document.getElementById('dash-pending');
    const chartEl=document.getElementById('chart-freight');
    if(!statsEl||!pendingEl) return;
    const stats=[
      {l:t("app.348", "\u603b\u5e93\u5b58\u91d1\u989d"),v:fmtMoney(d.total_inventory_value,'USD'),c:''},
      {l:t("app.349", "\u5728\u9014\u5e93\u5b58\u91d1\u989d"),v:fmtMoney(d.in_transit_value,'USD'),c:''},
      {l:t("app.350", "\u5446\u6ede\u5e93\u5b58\u91d1\u989d"),v:fmtMoney(d.stagnant_value,'USD'),c:'warning'},
      {l:t("app.351", "\u7f3a\u8d27\u98ce\u9669SKU"),v:d.shortage_sku_count,c:'danger'},
      {l:t("app.352", "\u5efa\u8bae\u91c7\u8d2d\u91d1\u989d"),v:fmtMoney(d.suggest_purchase_amount,'USD'),c:''},
      {l:t("app.353", "7\u5929\u5185\u5f85\u4ed8\u6b3e"),v:fmtMoney(d.pay_7d_amount,'USD'),c:'warning'},
      {l:t("app.354", "30\u5929\u5185\u5f85\u4ed8\u6b3e"),v:fmtMoney(d.pay_30d_amount,'USD'),c:''},
      {l:t("app.355", "\u903e\u671f\u4ed8\u6b3e\u91d1\u989d"),v:fmtMoney(d.overdue_amount,'USD'),c:'danger'},
    ];
    statsEl.innerHTML=stats.map(s=>'<div class="stat-card '+s.c+'"><div class="stat-number">'+s.v+'</div><div class="stat-label">'+s.l+'</div></div>').join('');
    pendingEl.innerHTML=t('html.renderDashboard', '<div class="stat-card"><div class="stat-number">{v1}</div><div class="stat-label">PO未完成</div></div><div class="stat-card"><div class="stat-number">{v2}</div><div class="stat-label">PI未完成</div></div><div class="stat-card"><div class="stat-number">{v3}</div><div class="stat-label">CI未完成</div></div>', {v1: d.po_pending, v2: d.pi_pending, v3: d.ci_pending});
    if(d.freight_trend&&d.freight_trend.length&&chartEl){
      // I18N-B1-BUGFIX-01：语言切换时 showPage→renderDashboard 可能重叠调用，
      // 两个 async 调用通过 getElementById 拿到同一 canvas，第二个 new Chart 抛出
      // "Canvas is already in use"。创建前先销毁已存在的旧实例。
      var _oldChart=Chart.getChart(chartEl); if(_oldChart) _oldChart.destroy();
      new Chart(chartEl.getContext('2d'),{type:'line',data:{labels:d.freight_trend.map(x=>x.month),datasets:[{label:t("app.223", "\u7efc\u5408\u8fd0\u8d39"),data:d.freight_trend.map(x=>x.freight),borderColor:'#2e7d32',yAxisID:'y'},{label:t("app.357", "\u8fd0\u8d39\u5360\u6bd4(%)"),data:d.freight_trend.map(x=>x.ratio),borderColor:'#ff9500',yAxisID:'y1'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{position:'left'},y1:{position:'right',grid:{display:false}}}}});
    }
  }catch(e){
    // 仅当 dashboard 目标 DOM 仍存在时才显示错误，避免上一页请求的错误污染新页面
    if(document.getElementById('dash-stats')) showFlash(e.message,'danger');
  }
}

// ==================== 通用表格管理器 ====================
let simpleMgrLoadSeq=0;
function simpleMgrTarget(mySeq){
  const root=document.getElementById('simple-manager-page');
  const table=document.getElementById('simple-table');
  if(!root||!table)return null;
  if(Number(root.dataset.loadSeq)!==mySeq||mySeq!==simpleMgrLoadSeq)return null;
  return table;
}
function renderSimpleMgr(title,apiUrl,fields,icon){
  const mySeq=++simpleMgrLoadSeq;
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div id="simple-manager-page" data-load-seq="'+mySeq+'"><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">'+icon+' '+title+'</div><div class="table-section-actions">'+(hasPermission('system_config')?'<button class="btn btn-primary btn-sm" onclick="editSimple(\''+apiUrl+'\','+encodeURIComponent(JSON.stringify(fields))+')">'+t('common.add','➕ 新增')+'</button>':'')+'</div></div><div id="simple-table"></div></div></div>';
  loadSimple(apiUrl,fields,mySeq);
}
async function loadSimple(apiUrl,fields,mySeq){
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
    const html=!data.length?'<div class="empty-state"><div class="empty-icon">📭</div>'+t('common.no_data','暂无数据')+'</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr>'+df.map(f=>'<th>'+f.label+'</th>').join('')+'<th>'+t('common.actions','操作')+'</th></tr></thead><tbody>'+data.map(item=>'<tr>'+df.map(f=>{
      if (f.multi) {
        const vals = String(item[f.name]||'').split(',').map(s=>s.trim()).filter(Boolean);
        return '<td>'+(vals.length ? vals.map(v=>'<span class="badge badge-sm" style="margin:2px;background:#e3f2fd;color:#1565c0">'+esc(v)+'</span>').join('') : '<span style="color:#999">'+t('term.all_brands','全部品牌')+'</span>')+'</td>';
      }
      return '<td>'+(f.bool?(item[f.name]?'✅':'❌'):esc(item[f.name]))+'</td>';
    }).join('')+'<td class="cell-actions">'+(hasPermission('system_config')?'<button class="action-btn action-edit" onclick=\'editSimple("'+apiUrl+'","'+b64EncodeUnicode(JSON.stringify(fields))+'","'+item.id+'")\'>✏️</button><button class="action-btn action-delete" onclick="deleteSimple(\''+apiUrl+'\',\''+item.id+'\')">🗑️</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
    const table=simpleMgrTarget(mySeq);
    if(!table)return;
    table.innerHTML=html;
  }catch(e){
    if(simpleMgrTarget(mySeq))showFlash(e.message,'danger');
  }
}
function editSimple(apiUrl,fieldsStr,id){
  let fields;
  try{fields=JSON.parse(fieldsStr)}catch(e){try{fields=JSON.parse(b64DecodeUnicode(fieldsStr))}catch(e2){showToast(t('common.invalid_params','参数错误'),'danger');return}}
  const body='<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid" id="simple-form-grid">'+fields.map(f=>{
    if(f.hide)return '';
    let inp;
    if(f.area) inp='<textarea name="'+f.name+'" rows="2"></textarea>';
    else if(f.sel) inp='<select name="'+f.name+'">'+(f.opts||[]).map(o=>{const v=typeof o==='object'?o.v:o;const l=typeof o==='object'?o.l:o;return '<option value="'+v+'">'+l+'</option>'}).join('')+'</select>';
    else if(f.num) inp='<input type="number" step="0.01" name="'+f.name+'">';
    else if(f.bool) inp='<select name="'+f.name+'"><option value="1">'+t('term.yes','是')+'</option><option value="0">'+t('term.no','否')+'</option></select>';
    else if(f.multi) {
      // 渲染多选框：checkbox 列表 + 隐藏 input 存逗号分隔值
      const opts = f.opts || [];
      inp='<div class="multi-select-box" data-name="'+f.name+'" style="border:1px solid var(--border);border-radius:6px;padding:8px;max-height:160px;overflow-y:auto;background:#fafbfc">' +
        '<div style="margin-bottom:6px;display:flex;gap:8px"><button type="button" class="btn btn-xs btn-secondary" onclick="multiSelectAll(this,\''+f.name+'\')">'+t('action.select_all','全选')+'</button><button type="button" class="btn btn-xs btn-secondary" onclick="multiSelectNone(this,\''+f.name+'\')">'+t('action.clear','清空')+'</button><span style="color:#999;font-size:12px;align-self:center">'+t('term.multi_select_hint','不选 = 适用于所有品牌')+'</span></div>' +
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
  openModal(id?t("action.edit", "编辑"):t("action.add", "新增"),body,'<button class="btn btn-secondary" onclick="closeModal()">'+t('common.cancel','取消')+'</button><button class="btn btn-primary" onclick="saveSimple(\''+apiUrl+'\',\''+(id||'')+'\')">'+t('common.save','保存')+'</button>');
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
  try{await api(apiUrl,'POST',data);showToast(t('gen.L468.1','保存成功'),'success');closeModal();loadSimple(apiUrl,Object.keys(data).map(k=>({name:k,label:k})))}catch(e){showToast(e.message,'danger')}
}
async function deleteSimple(apiUrl,id){if(!confirm(t('common.confirm_delete','确认删除？')))return;try{await api(apiUrl+'/'+id,'DELETE');showToast(t('common.deleted','已删除'),'success');location.reload()}catch(e){showToast(e.message,'danger')}}

// --- 系统管理页面 ---

// 批量任务中心
async function renderBatchTasks(){
  document.getElementById('content-inner').innerHTML=
    '<div id="flash-container"></div>'
    +'<div class="filter-bar"><div class="filter-form">'
    +t('gen.L479.1','<div class="filter-group"><label>页面</label><select id="bt-page" onchange="loadBatchTasks()"><option value="">全部</option><option value="inventory">库存总表</option><option value="outbound">销售数据</option><option value="skus">SKU主数据</option></select></div>')
    +t('gen.L480.1','<div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadBatchTasks()">刷新</button></div>')
    +'</div></div></div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">'
    +t('gen.L483.1','<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📋 批量任务</div></div><div id="bt-tasks"></div></div>')
    +t('gen.L484.1','<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📜 操作日志</div></div><div id="bt-logs"></div></div>')
    +'</div>';
  loadBatchTasks();
}

async function loadBatchTasks(){
  try{
    const page=document.getElementById('bt-page')?.value||'';
    const taskUrl='/api/batch-tasks'+(page?('?page='+page):'');
    const logUrl='/api/operation-logs'+(page?('?page='+page):'');
    const [tasks, logs] = await Promise.all([api(taskUrl), api(logUrl)]);

    document.getElementById('bt-tasks').innerHTML = !tasks.length ? t('gen.L496.1','<div class="empty-state"><div class="empty-icon">📭</div>暂无批量任务</div>') :
      t('gen.L497.1','<div style="max-height:500px;overflow-y:auto"><table class="data-table"><thead><tr><th>任务名称</th><th>操作人</th><th>页面</th><th>状态</th><th>总数</th><th>成功</th><th>失败</th><th>跳过</th><th>开始时间</th><th>错误报告</th></tr></thead><tbody>')
      +tasks.map(task=>'<tr>'
        +'<td>'+esc(task.task_name)+'</td>'
        +'<td>'+esc(task.operator_name||'-')+'</td>'
        +'<td>'+esc(task.page||'-')+'</td>'
        +'<td><span class="status-badge '+(task.status==='completed'?'status-normal':'status-warning')+'">'+statusLabel(task.status)+'</span></td>'
        +'<td class="text-right">'+task.total_count+'</td>'
        +'<td class="text-right" style="color:#2e7d32;font-weight:600">'+task.success_count+'</td>'
        +'<td class="text-right" style="color:#c62828">'+task.failed_count+'</td>'
        +'<td class="text-right" style="color:#f57f17">'+task.skipped_count+'</td>'
        +'<td class="cell-date">'+fmtDate(task.started_at)+'</td>'
        +'<td>'+(task.failed_count>0?'<button class="btn btn-sm btn-secondary" onclick="downloadTaskErrors(\''+task.id+'\')">'+t('action.download','📥 下载')+'</button>':'-')+'</td>'
      +'</tr>').join('')+'</tbody></table></div>';

    document.getElementById('bt-logs').innerHTML = !logs.length ? t('gen.L511.1','<div class="empty-state"><div class="empty-icon">📭</div>暂无操作日志</div>') :
      t('gen.L512.1','<div style="max-height:500px;overflow-y:auto"><table class="data-table"><thead><tr><th>时间</th><th>操作人</th><th>页面</th><th>操作</th><th>影响数</th><th>原因</th><th>重算</th></tr></thead><tbody>')
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
  fetch('/api/batch-tasks/'+taskId, {headers:{'Content-Type':'application/json','Accept-Language':(typeof getLang==='function'?getLang():'zh')},credentials:'same-origin'})
    .then(r=>r.json())
    .then(task=>{
      let errors=[];
      try{errors=typeof task.error_report==='string'?JSON.parse(task.error_report):(task.error_report||[]);}catch(e){}
      if(!errors.length){showToast(t('msg.no_error_data','无错误数据'),'info');return;}
      if(typeof XLSX==='undefined'){showFlash(t('msg.xlsx_not_loaded','XLSX库未加载'),'danger');return;}
      const headers=['ID','SKU',t('col.fail_reason','失败原因')];
      const rows=errors.map(e=>[e.id||'',e.sku_code||'',e.reason||'']);
      const ws=XLSX.utils.aoa_to_sheet([headers].concat(rows));
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,t("app.013", "\u9519\u8bef\u62a5\u544a"));
      XLSX.writeFile(wb,t('term.error_report_prefix','任务错误报告_')+taskId+'.xlsx');
    })
    .catch(e=>showFlash(t('msg.download_failed_prefix','下载失败: ')+e.message,'danger'));
}

function renderCountries(){renderSimpleMgr(t("nav.countries", "\u56fd\u5bb6\u7ba1\u7406"),'/api/countries',[{name:'name',label:t("col.name", "名称"),req:1},{name:'code',label:t("shell.002", "\u4ee3\u7801"),req:1},{name:'default_currency',label:t("app.022", "\u9ed8\u8ba4\u5e01\u79cd")},{name:'sort_order',label:t("shell.003", "\u6392\u5e8f"),num:1},{name:'status',label:t("status.label", "\u72b6\u6001"),sel:1,opts:['active','disabled']}],'🌍')}
function renderWarehouses(){
  renderSimpleMgr(t("shell.004", "\u4ed3\u5e93\u7ba1\u7406\uff08\u56fd\u5bb6+\u4ed3\u5e93+\u54c1\u724c\u5173\u8054\uff09"),'/api/warehouses',[
    {name:'name',label:t("shell.005", "\u4ed3\u5e93\u540d\u79f0"),req:1},
    {name:'country_name',label:t("shell.006", "\u6240\u5c5e\u56fd\u5bb6"),req:1},
    {name:'warehouse_type',label:t("app.187", "\u7c7b\u578b"),sel:1,opts:[{v:'self',l:t("shell.007", "\u81ea\u6709\u4ed3")},{v:'third_party',l:t("shell.008", "\u7b2c\u4e09\u65b9\u4ed3")}]},
    {name:'brands',label:t("app.021", "\u5173\u8054\u54c1\u724c"),multi:1,source:'/api/brands/all',full:1},
    {name:'address',label:t("shell.009", "\u5730\u5740"),full:1},
    {name:'sort_order',label:t("shell.003", "\u6392\u5e8f"),num:1},
    {name:'status',label:t("status.label", "\u72b6\u6001"),sel:1,opts:['active','disabled']}
  ],'🏭')}
let supplierLoadSeq=0;
function supplierTarget(mySeq){
  const root=document.getElementById('supplier-manager-page');
  const table=document.getElementById('supplier-table');
  if(!root||!table)return null;
  if(Number(root.dataset.loadSeq)!==mySeq||mySeq!==supplierLoadSeq)return null;
  return table;
}
async function renderSuppliers(){
  const mySeq=++supplierLoadSeq;
  document.getElementById('content-inner').innerHTML=t('html.renderSuppliers', '<div id="flash-container"></div><div id="supplier-manager-page" data-load-seq="{v1}"><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🏢 供应商管理</div><div class="table-section-actions">{v2}</div></div><div id="supplier-table"></div></div></div>', {v1: mySeq, v2: hasPermission('system_config')?t('gen.L564.1','<button class="btn btn-primary btn-sm" onclick="openSupplierModal()">➕ 新增</button>'):''});
  loadSuppliers(mySeq);
}
function parseSupplierBrands(s){
  try{return Array.isArray(s.associated_brands)?s.associated_brands:JSON.parse(s.associated_brands||'[]')}catch(e){return String(s.associated_brands||'').split(',').map(x=>x.trim()).filter(Boolean)}
}
async function loadSuppliers(mySeq){
  if(mySeq===undefined||mySeq===null){
    const root=document.getElementById('supplier-manager-page');
    if(!root)return;
    mySeq=++supplierLoadSeq;
    root.dataset.loadSeq=String(mySeq);
  }
  try{
    const data=await api('/api/suppliers');
    const table=supplierTarget(mySeq);
    if(!table)return;
    table.innerHTML=!data.length?t('gen.L581.1','<div class="empty-state"><div class="empty-icon">🏢</div>暂无供应商</div>'):t('gen.L581.2','<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>供应商名称</th><th>关联品牌</th><th>默认币种</th><th>联系人</th><th>联系方式</th><th>备注</th><th>状态</th><th>操作</th></tr></thead><tbody>')+data.map(s=>{
      const brands=parseSupplierBrands(s);
      return '<tr><td class="cell-name">'+esc(s.name)+'</td><td>'+esc(brands.join(', '))+'</td><td>'+esc(s.default_currency||'USD')+'</td><td>'+esc(s.contact_person||'')+'</td><td>'+esc(s.phone||'')+'</td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis" title="'+esc(s.remark||'')+'">'+esc(s.remark||'')+'</td><td><span class="status-badge '+(s.status==='active'?'status-normal':'status-cancelled')+'">'+(s.status==='active'?t('status.active','启用'):t('status.disabled','停用'))+'</span></td><td class="cell-actions">'+(hasPermission('system_config')?'<button class="action-btn action-edit" onclick="openSupplierModal(\''+s.id+'\')">✏️</button><button class="action-btn" onclick="toggleSupplierStatus(\''+s.id+'\',\''+(s.status==='active'?'disabled':'active')+'\')" title="'+(s.status==='active'?t('action.disable','停用'):t('action.enable','启用'))+'">'+(s.status==='active'?'⏸️':'▶️')+'</button>':'')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
  }catch(e){
    if(supplierTarget(mySeq))showFlash(e.message,'danger');
  }
}
async function openSupplierModal(id){
  try{
    const [suppliers, skus]=await Promise.all([api('/api/suppliers'), api('/api/skus')]);
    const supplier=id?suppliers.find(s=>s.id===id):{};
    const brands=[...new Set(skus.map(s=>s.brand).filter(b=>b&&String(b).trim()))].sort();
    const selected=new Set(parseSupplierBrands(supplier||{}));
    const brandChecks=brands.map(b=>'<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 10px 4px 0;font-size:13px"><input type="checkbox" class="sup-brand" value="'+esc(b)+'" '+(selected.has(b)?'checked':'')+'> '+esc(b)+'</label>').join('')||t('gen.L595.1','<span style="color:#999">暂无品牌，请先维护 SKU 品牌</span>');
    // 加载该供应商已有付款条件（结构化多条）
    let terms=[];
    if(id){ try{ terms=await api('/api/suppliers/'+encodeURIComponent(id)+'/payment-terms'); }catch(e){ terms=[]; } }
    window._supTerms=(terms||[]).map(t=>({id:t.id,term_name:t.term_name||'',term_type:t.term_type||'advance',credit_days:t.credit_days||0,is_default:!!t.is_default,display_order:t.display_order||0,status:t.status||'active'}));
    const html='<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'
      +t('gen.L601.1','<div class="form-group"><label>供应商名称 <span class="required">*</span></label><input type="text" id="sup-name" value="')+esc(supplier?.name||'')+'"></div>'
      +t('gen.L602.1','<div class="form-group"><label>默认币种</label><select id="sup-cur">')+['USD','RMB','IDR','MYR','THB'].map(c=>'<option value="'+c+'"'+((supplier?.default_currency||'USD')===c?' selected':'')+'>'+c+'</option>').join('')+'</select></div>'
      +t('gen.L603.1','<div class="form-group"><label>联系人</label><input type="text" id="sup-contact" value="')+esc(supplier?.contact_person||'')+'"></div>'
      +t('gen.L604.1','<div class="form-group"><label>联系方式</label><input type="text" id="sup-phone" value="')+esc(supplier?.phone||'')+'"></div>'
      +t('gen.L605.1','<div class="form-group"><label>状态</label><select id="sup-status"><option value="active"')+((supplier?.status||'active')==='active'?' selected':'')+t('gen.L605.2','>启用</option><option value="disabled"')+(supplier?.status==='disabled'?' selected':'')+t('gen.L605.3','>停用</option></select></div>')
      +t('gen.L606.1','<div class="form-group form-group-full"><label>关联品牌</label><div style="border:1px solid var(--border);border-radius:6px;padding:8px;max-height:150px;overflow:auto">')+brandChecks+'</div></div>'
      +t('gen.L607.1','<div class="form-group form-group-full"><label>备注</label><textarea id="sup-remark" rows="3">')+esc(supplier?.remark||'')+'</textarea></div>'
      +'</div>'
      +'<div class="sup-terms-section">'
        +t('gen.L610.1','<div class="sup-terms-head"><span>💳 付款条件（可维护多条）</span></div>')
        +'<div id="sup-terms-list"></div>'
        +t('gen.L612.1','<button type="button" class="btn btn-secondary btn-sm" onclick="addSupTermRow()">➕ 添加付款条件</button>')
      +'</div>'
      +'</div>';
    openModal(id?t('gen.L615.1','编辑供应商'):t("app.365", "\u65b0\u589e\u4f9b\u5e94\u5546"),html,t('modal.footer.openSupplierModal', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveSupplier('{v1}')">保存</button>`, {v1: id||''}));
    renderSupTerms();
  }catch(e){showToast(e.message,'danger')}
}
// 供应商付款条件子表渲染
function renderSupTerms(){
  const box=document.getElementById('sup-terms-list');
  if(!box) return;
  const arr=window._supTerms||(window._supTerms=[]);
  if(!arr.length){ box.innerHTML='<div class="sup-terms-empty">'+t('msg.no_pay_terms','暂无付款条件，点击下方“添加付款条件”新增')+'</div>'; return; }
  box.innerHTML=arr.map((term,i)=>{
    const isDefault=!!term.is_default;
    const creditVisible=(term.term_type==='credit'||term.term_type==='other');
    return '<div class="sup-term-card" data-i="'+i+'">'
      +'<span class="sup-term-idx">'+(i+1)+'</span>'
      +'<div class="sup-term-fields">'
        +'<div class="sup-term-field"><label>'+t('col.name','名称')+'</label><input type="text" class="st-name" data-i="'+i+'" value="'+esc(term.term_name)+t('gen.L631.1','" placeholder="\u5982 T/T 100% in advance"></div>')
        +'<div class="sup-term-field"><label>'+t('col.type','类型')+'</label><select class="st-type" data-i="'+i+'">'
          +'<option value="advance"'+((term.term_type||'advance')==='advance'?' selected':'')+'>'+t('term.payterm_advance','预付 advance')+'</option>'
          +'<option value="credit"'+((term.term_type||'advance')==='credit'?' selected':'')+'>'+t('term.payterm_credit','信用 credit')+'</option>'
          +'<option value="other"'+((term.term_type||'advance')==='other'?' selected':'')+'>'+t('term.payterm_other','其他 other')+'</option>'
        +'</select></div>'
        +'<div class="sup-term-field st-credit-box" style="display:'+(creditVisible?'flex':'none')+'"><label>'+t('col.credit_days','信用天数')+'</label><input type="number" class="st-days" data-i="'+i+'" value="'+esc(term.credit_days||0)+t('gen.L637.1','" min="0" placeholder="\u624b\u52a8\u586b\u5199\u5929\u6570"></div>')
        +'<div class="sup-term-field sup-term-default"><label>'+t('term.default','默认')+'</label><input type="radio" name="sup-term-default" class="st-default" data-i="'+i+'"'+(isDefault?' checked':'')+'></div>'
        +'<div class="sup-term-field sup-term-del"><button type="button" class="action-btn action-del" title="'+t('action.delete','删除')+'" onclick="delSupTermRow('+i+')">🗑️</button></div>'
      +'</div>'
    +'</div>';
  }).join('');
}
// 事件委托：名称/类型/天数/默认变更同步到 window._supTerms
document.addEventListener('input', function(e){
  const el=e.target;
  if(el.classList && el.classList.contains('st-name')){ const i=+el.dataset.i; if(window._supTerms[i]) window._supTerms[i].term_name=el.value; }
  else if(el.classList && el.classList.contains('st-days')){ const i=+el.dataset.i; if(window._supTerms[i]) window._supTerms[i].credit_days=(+el.value||0); }
});
document.addEventListener('change', function(e){
  const el=e.target;
  if(el.classList && el.classList.contains('st-type')){
    const i=+el.dataset.i; if(!window._supTerms[i]) return;
    window._supTerms[i].term_type=el.value;
    // 仅就地切换信用天数框显隐，不整块重渲染（避免丢焦点/重建异常）
    const card=document.querySelector('.sup-term-card[data-i="'+i+'"]');
    if(card){
      const creditBox=card.querySelector('.st-credit-box');
      if(creditBox) creditBox.style.display=(el.value==='credit'||el.value==='other')?'flex':'none';
    }
  } else if(el.classList && el.classList.contains('st-default')){
    const i=+el.dataset.i; (window._supTerms||[]).forEach((t,k)=>{ if(k!==i) t.is_default=false; }); if(window._supTerms[i]) window._supTerms[i].is_default=true; renderSupTerms();
  }
});
function addSupTermRow(){
  (window._supTerms||(window._supTerms=[])).push({id:'_new_'+Date.now()+'_'+Math.floor(Math.random()*1e4),term_name:'',term_type:'advance',credit_days:0,is_default:false,display_order:window._supTerms.length,status:'active'});
  renderSupTerms();
}
function delSupTermRow(i){
  if(window._supTerms[i]){ window._supTerms.splice(i,1); renderSupTerms(); }
}
async function saveSupplier(id){
  const brands=Array.from(document.querySelectorAll('.sup-brand:checked')).map(el=>el.value);
  const d={id:id||undefined,name:document.getElementById('sup-name').value.trim(),associated_brands:brands,default_currency:document.getElementById('sup-cur').value,contact_person:document.getElementById('sup-contact').value,phone:document.getElementById('sup-phone').value,remark:document.getElementById('sup-remark').value,status:document.getElementById('sup-status').value};
  if(!d.name){showToast(t('gen.L675.1','供应商名称不能为空'),'warning');return;}
  try{
    const r=await api('/api/suppliers','POST',d);
    const supId=r.id||id;
    // 落付款条件（整供应商替换）
    if(supId){
      const terms=(window._supTerms||[]).map((t,i)=>({id:t.id,term_name:t.term_name,term_type:t.term_type,credit_days:t.credit_days,is_default:t.is_default,display_order:i,status:t.status||'active'}));
      await api('/api/suppliers/'+encodeURIComponent(supId)+'/payment-terms','POST',terms);
    }
    showToast(t('gen.L684.1','保存成功'),'success');closeModal();loadSuppliers();
  }catch(e){showToast(e.message,'danger')}
}
async function toggleSupplierStatus(id,status){
  try{const suppliers=await api('/api/suppliers');const s=suppliers.find(x=>x.id===id);if(!s)return;await api('/api/suppliers','POST',{...s,associated_brands:parseSupplierBrands(s),status});showToast(status==='active'?t('gen.L688.1','已启用'):t('gen.L688.2','已停用'),'success');loadSuppliers()}catch(e){showToast(e.message,'danger')}
}
function renderFreightForwarders(){renderSimpleMgr(t("nav.freight_forwarders", "\u8d27\u4ee3\u7ba1\u7406"),'/api/freight-forwarders',[{name:'name',label:t("col.name", "名称"),req:1},{name:'short_name',label:t("shell.010", "\u7b80\u79f0")},{name:'contact_person',label:t("app.023", "\u8054\u7cfb\u4eba")},{name:'phone',label:t("shell.011", "\u7535\u8bdd")},{name:'email',label:t("shell.012", "\u90ae\u7bb1")},{name:'service_types',label:t("shell.013", "\u670d\u52a1\u7c7b\u578b")},{name:'status',label:t("status.label", "\u72b6\u6001"),sel:1,opts:['active','disabled']}],'🚛')}
function renderCurrencies(){renderSimpleMgr(t("shell.014", "\u5e01\u79cd\u7ba1\u7406"),'/api/currencies',[{name:'code',label:t("shell.002", "\u4ee3\u7801"),req:1},{name:'name',label:t("col.name", "名称"),req:1},{name:'symbol',label:t("shell.015", "\u7b26\u53f7")},{name:'is_base',label:t("shell.016", "\u57fa\u7840\u5e01\u79cd"),bool:1},{name:'sort_order',label:t("shell.003", "\u6392\u5e8f"),num:1},{name:'status',label:t("status.label", "\u72b6\u6001"),sel:1,opts:['active','disabled']}],'💱')}
function renderPaymentTerms(){renderSimpleMgr(t("nav.payment_terms", "\u4ed8\u6b3e\u6761\u4ef6"),'/api/payment-terms',[{name:'name',label:`${t("col.name","名称")}`,req:1},{name:'payee_type',label:t("app.209", "\u4ed8\u6b3e\u5bf9\u8c61"),sel:1,opts:['factory','forwarder','customs']},{name:'payment_type',label:t("shell.017", "\u4ed8\u6b3e\u7c7b\u578b"),sel:1,opts:['goods','logistics','tax']},{name:'payment_stage',label:t("shell.018", "\u4ed8\u6b3e\u9636\u6bb5"),sel:1,opts:['deposit','balance','full','monthly']},{name:'payment_node',label:t("shell.019", "\u4ed8\u6b3e\u8282\u70b9"),sel:1,opts:['after_pi','before_ship','after_ci','after_arrival','after_inbound','monthly']},{name:'ratio',label:t("shell.020", "\u6bd4\u4f8b(%)"),num:1},{name:'remind_days_before',label:t("shell.021", "\u63d0\u9192\u63d0\u524d\u5929"),num:1},{name:'is_enabled',label:t("common.enable", "\u542f\u7528"),bool:1}],'📋')}
function renderApprovalFlows(){
  document.getElementById('content-inner').innerHTML=t('gen.L694.1','<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">✅ 审批流管理</div></div><div id="approval-flow-editor"></div></div>');
  loadApprovalFlows();
}
// N5: 审批流最小配置界面（仅 PO 类型可编辑；责任主体为具体系统用户）
let _afState={};
let _afCandidates=[];
function afSafeId(id){return String(id).replace(/[^a-zA-Z0-9_]/g,'_');}
function afSetEnable(flowId,checked){if(_afState[flowId])_afState[flowId].is_enabled=checked?1:0;}
function afSetUser(flowId,level,uid){const st=_afState[flowId];if(!st)return;const lv=st.levels.find(l=>l.level===level);if(lv)lv.approver_user_id=uid;}
async function loadApprovalFlows(){
  try{
    const data=await api('/api/approval-flows');
    const cands=await api('/api/approval-candidates');
    _afCandidates=cands;
    _afState={};
    const wrap=document.getElementById('approval-flow-editor');
    if(!data.length){wrap.innerHTML=t('gen.L710.1','<div class="empty-state"><div class="empty-icon">✅</div>暂无审批流</div>');return;}
    let html='';
    for(const f of data){
      const isPO=f.business_type==='po';
      _afState[f.id]={name:f.name,business_type:f.business_type,is_enabled:!!f.is_enabled,
        levels:(Array.isArray(f.levels)?f.levels:[]).map(l=>({level:Number(l.level),approver_user_id:l.approver_user_id||''}))};
      html+='<div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:14px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
          '<div><b>'+esc(f.name)+'</b> <span class="muted-hint">('+esc(f.business_type)+')</span></div>'+
          (isPO?'<label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" '+(f.is_enabled?'checked':'')+' onchange="afSetEnable(\''+esc(f.id)+t('gen.L719.1','\',this.checked)"> 启用</label>'):t('gen.L719.2','<span class="muted-hint">非PO类型本轮只读</span>'))+
        '</div>';
      if(isPO){
        html+='<div id="aflevels_'+afSafeId(f.id)+'"></div>'+
          '<div style="margin-top:10px;display:flex;gap:8px">'+
            '<button class="btn btn-secondary" onclick="afAddLevel(\''+esc(f.id)+t('gen.L724.1','\')">＋ 添加审批级次</button>')+
            '<button class="btn btn-primary" onclick="afSaveFlow(\''+esc(f.id)+t('gen.L725.1','\')">💾 保存</button>')+
          '</div>';
      }else{
        html+='<div class="muted-hint">'+esc(JSON.stringify(f.levels))+'</div>';
      }
      html+='</div>';
    }
    wrap.innerHTML=html;
    for(const f of data){ if(f.business_type==='po') afRenderLevels(f.id); }
  }catch(e){showFlash(e.message,'danger')}
}
function afRenderLevels(flowId){
  const st=_afState[flowId]; if(!st)return;
  const box=document.getElementById('aflevels_'+afSafeId(flowId)); if(!box)return;
  const sorted=st.levels.slice().sort((a,b)=>a.level-b.level);
  let html='';
  sorted.forEach(lv=>{
    const opts=_afCandidates.map(u=>'<option value="'+esc(u.id)+'" '+(u.id===lv.approver_user_id?'selected':'')+'>'+esc(u.name)+'（'+esc(formatRoleLabel(u.role_id, u.role_name))+'）</option>').join('');
    html+='<div style="display:flex;gap:8px;align-items:center;margin:6px 0">'+
      t('gen.L744.1','<span style="min-width:64px">第 ')+lv.level+t('gen.L744.2',' 级</span>')+
      '<select data-af-user="'+lv.level+'" onchange="afSetUser(\''+esc(flowId)+'\','+lv.level+',this.value)" style="flex:1">'+opts+'</select>'+
      '<button class="btn btn-secondary" onclick="afMoveLevel(\''+esc(flowId)+'\','+lv.level+t('gen.L746.1',',-1)" title="\u4e0a\u79fb">↑</button>')+
      '<button class="btn btn-secondary" onclick="afMoveLevel(\''+esc(flowId)+'\','+lv.level+t('gen.L747.1',',1)" title="\u4e0b\u79fb">↓</button>')+
      '<button class="btn btn-secondary" onclick="afRemoveLevel(\''+esc(flowId)+'\','+lv.level+t('gen.L748.1',')" title="删除">✕</button>')+
    '</div>';
  });
  box.innerHTML=html;
}
function afAddLevel(flowId){const st=_afState[flowId];if(!st)return;const maxL=st.levels.reduce((m,l)=>Math.max(m,l.level),0);st.levels.push({level:maxL+1,approver_user_id:_afCandidates[0]?_afCandidates[0].id:''});afRenderLevels(flowId);}
function afRemoveLevel(flowId,level){const st=_afState[flowId];if(!st)return;if(st.levels.length<=1){showToast(t('gen.L754.1','至少保留一个审批级次'),'warning');return;}st.levels=st.levels.filter(l=>l.level!==level);st.levels.sort((a,b)=>a.level-b.level).forEach((l,i)=>l.level=i+1);afRenderLevels(flowId);}
function afMoveLevel(flowId,level,dir){const st=_afState[flowId];if(!st)return;const sorted=st.levels.slice().sort((a,b)=>a.level-b.level);const idx=sorted.findIndex(l=>l.level===level);const j=idx+dir;if(j<0||j>=sorted.length)return;const t=sorted[idx].level;sorted[idx].level=sorted[j].level;sorted[j].level=t;afRenderLevels(flowId);}
async function afSaveFlow(flowId){
  const st=_afState[flowId];if(!st)return;
  const sorted=st.levels.slice().sort((a,b)=>a.level-b.level);
  for(let i=0;i<sorted.length;i++){
    if(sorted[i].level!==i+1){showToast(t('gen.L760.1','审批级次必须连续（1,2,3...）'),'danger');return;}
    if(!sorted[i].approver_user_id){showToast(t('validation.approverLevelRequired','第 {n} 级审批人不能为空',{n:(i+1)}),'danger');return;}
  }
  const payload={id:flowId,name:st.name,business_type:st.business_type,is_enabled:st.is_enabled?1:0,
    levels:sorted.map(l=>({level:l.level,approver_user_id:l.approver_user_id}))};
  try{await api('/api/approval-flows','POST',payload);showToast(t('gen.L765.1','审批流已保存'),'success');loadApprovalFlows();}
  catch(e){showToast(e.message,'danger')}
}
// ==================== 审批中心（PO 审批人侧补齐，最小范围） ====================
// 信息架构预留：待我审批 / 全部待审批 / 采购类 / 财务类 / 确认任务 / 抄送我的 / 已处理
// 本期仅实现 PO 审批（待我审批/全部待审批/采购类 共用 PO 待审列表）；其余分类为占位。
function renderApprovalCenter(){
  const tabs=[
    {id:'mine',label:t("app.378", "\u5f85\u6211\u5ba1\u6279")},
    {id:'all',label:t("app.379", "\u5168\u90e8\u5f85\u5ba1\u6279")},
    {id:'purchase',label:t("app.380", "\u91c7\u8d2d\u7c7b\u5ba1\u6279")},
    {id:'finance',label:t("app.381", "\u8d22\u52a1\u7c7b\u5ba1\u6279")},
    {id:'confirm',label:t("app.382", "\u786e\u8ba4\u4efb\u52a1")},
    {id:'cc',label:t("app.383", "\u6284\u9001\u6211\u7684")},
    {id:'done',label:t("app.384", "\u5df2\u5904\u7406")},
  ];
  document.getElementById('content-inner').innerHTML=t('html.renderApprovalCenter', '<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">✅ 审批中心</div><div class="table-section-actions"><span class="muted-hint">已接入 PO 审批（采购类）与付款申请审批（财务类），其余分类预留</span></div></div><div class="approval-tabs" id="approval-tabs">{v1}</div><div id="approval-list"></div></div>', {v1: tabs.map((tab,i)=>'<span class="approval-tab'+(i===0?' active':'')+'" data-tab="'+tab.id+'" onclick="switchApprovalTab(\''+tab.id+'\')">'+tab.label+'</span>').join('')});
  switchApprovalTab('mine');
}
let _approvalTab='mine';
let _approvalListData=[];
function switchApprovalTab(tab){
  _approvalTab=tab;
  document.querySelectorAll('#approval-tabs .approval-tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));
  // 待我审批 / 全部待审批 / 采购类审批 → PO 待审列表；财务类审批 → 付款申请待审列表；其余预留占位
  if(tab==='mine'||tab==='all'||tab==='purchase'){
    loadApprovalCenterList();
  }else if(tab==='finance'){
    loadFinanceApprovalList();
  }else{
    document.getElementById('approval-list').innerHTML=t('html.switchApprovalTab', '<div class="empty-state"><div class="empty-icon">🚧</div>{v1} 分类将在后续版本接入</div>', {v1: esc(tabLabel(tab))});
  }
}
// 财务类审批：加载付款申请待审列表（GET /api/payment-requests/pending），点击 👁️ 复用 viewPayment(id,'finance')
async function loadFinanceApprovalList(){
  const wrap=document.getElementById('approval-list');
  if(!wrap)return;
  try{
    const data=await api('/api/payment-requests/pending');
    if(!data.length){wrap.innerHTML=t('gen.L804.1','<div class="empty-state"><div class="empty-icon">✅</div>暂无待审付款申请</div>');return}
    const canApprove=hasPermission('payment_approve');
    wrap.innerHTML=t('html.loadFinanceApprovalList', '<div class="table-container"><table class="data-table"><thead><tr><th>申请号</th><th>大类</th><th>小类</th><th>来源单号</th><th>关联CI</th><th>付款对象</th><th class="text-right">总数量</th><th class="text-right">应付金额</th><th>币种</th><th>提交时间</th><th>操作</th></tr></thead><tbody>{v1}</tbody></table></div>', {v1: data.map(p=>{
        const catLabel=PAY_CATEGORIES[p.payment_category]||p.payment_category;
        const subLabel=(PAY_SUBCATS[p.payment_category]&&PAY_SUBCATS[p.payment_category][p.payment_subcategory])||p.payment_subcategory||'';
        const qtyTxt=(p.total_qty!==null&&p.total_qty!==undefined)?Number(p.total_qty).toLocaleString('en-US'):'—';
        return '<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewPayment\',\''+p.id+'\',\'finance\')">'+
          '<td class="cell-id">'+esc(p.request_no)+'</td>'+
          '<td>'+esc(catLabel)+'</td>'+
          '<td>'+esc(subLabel)+'</td>'+
          '<td class="cell-id">'+esc(p.source_no||'')+'</td>'+
          '<td class="cell-id">'+esc(p.related_ci_no||'')+'</td>'+
          '<td>'+esc(p.supplier_name||'')+'</td>'+
          '<td class="text-right">'+qtyTxt+'</td>'+
          '<td class="text-right font-bold">'+fmtMoney(p.payable_amount,p.currency)+'</td>'+
          '<td>'+esc(p.currency||'')+'</td>'+
          '<td>'+esc((p.created_at||'').replace('T',' ').slice(0,19))+'</td>'+
          '<td class="cell-actions">'+
            '<button class="action-btn" onclick="viewPayment(\''+p.id+'\',\'finance\')" title="'+(canApprove?t('gen.L822.1','查看/审批'):t("app.389", "\u67e5\u770b\u8be6\u60c5"))+'">👁️</button>'+
          '</td>'+
        '</tr>';
      }).join('')});
  }catch(e){showFlash(e.message,'danger')}
}
function tabLabel(id){const m={mine:t("app.378", "\u5f85\u6211\u5ba1\u6279"),all:t("app.379", "\u5168\u90e8\u5f85\u5ba1\u6279"),purchase:t("app.380", "\u91c7\u8d2d\u7c7b\u5ba1\u6279"),finance:t("app.381", "\u8d22\u52a1\u7c7b\u5ba1\u6279"),confirm:t("app.382", "\u786e\u8ba4\u4efb\u52a1"),cc:t("app.383", "\u6284\u9001\u6211\u7684"),done:t("app.384", "\u5df2\u5904\u7406")};return m[id]||id;}
async function loadApprovalCenterList(){
  try{
    // M3: 待我审批 tab 按当前用户过滤；其余 tab 保持原逻辑
    const data=await api('/api/purchase-orders/pending-approval' + (_approvalTab === 'mine' ? '?mine=1' : ''));
    _approvalListData=data;
    const html=!data.length?t('gen.L834.1','<div class="empty-state"><div class="empty-icon">✅</div>暂无待审批 PO</div>'):
      '<div class="table-container"><table class="data-table"><thead><tr>'+
      t('gen.L836.1','<th>PO号</th><th>提交人</th><th>品牌</th><th>国家</th><th>仓库</th><th class="text-right">总数量</th><th class="text-right">总金额</th><th>提交时间</th><th>审批级次</th><th>操作</th>')+
      '</tr></thead><tbody>'+data.map(r=>'<tr class="clickable-detail-row" onclick="rowClickView(event,\'openApprovalDetail\',\''+r.approval_id+'\',\''+r.po_id+'\')">'+
        '<td class="cell-id">'+esc(r.po_no)+'</td>'+
        '<td>'+esc(r.submitter_name)+'</td>'+
        '<td>'+esc(r.brand)+'</td>'+
        '<td>'+esc(r.country)+'</td>'+
        '<td>'+esc(r.target_warehouse)+'</td>'+
        '<td class="text-right">'+(r.total_qty||0).toLocaleString()+'</td>'+
        '<td class="text-right">'+fmtMoney(r.total_amount,r.currency)+'</td>'+
        '<td>'+esc((r.submitted_at||'').replace('T',' ').slice(0,19))+'</td>'+
        '<td>'+esc(r.current_level)+'/'+esc(r.max_level)+'</td>'+
        '<td class="cell-actions">'+
          '<button class="action-btn" onclick="openApprovalDetail(\''+r.approval_id+'\',\''+r.po_id+t('gen.L848.1','\')" title="\u67e5\u770b\u8be6\u60c5">👁️</button>')+
          '<button class="action-btn" onclick="approvePO(\''+r.po_id+t('gen.L849.1','\')" title="通过审批">✅ 通过</button>')+
          '<button class="action-btn" onclick="rejectPO(\''+r.po_id+t('gen.L850.1','\')" title="\u9a73\u56de">⛔ 驳回</button>')+
        '</td>'+
      '</tr>').join('')+'</tbody></table></div>';
    document.getElementById('approval-list').innerHTML=html;
  }catch(e){showFlash(e.message,'danger')}
}
async function approvePO(id){
  const r=_approvalListData.find(x=>x.po_id===id);
  if(!r){showToast(t('gen.L858.1','未找到该审批记录'),'danger');return;}
  let approvers=[];
  try{approvers=JSON.parse(r.approvers||'[]')||[];}catch(e){}
  const curLevel=r.current_level;
  const nextLevel=r.current_level+1;
  const isLast=nextLevel>r.max_level;
  const curA=approvers.find(a=>a.level===curLevel);
  const nextA=approvers.find(a=>a.level===nextLevel);
  const row=(l,v)=>'<div class="detail-item"><span class="detail-label">'+l+'</span><span class="detail-value">'+esc(v ?? '')+'</span></div>';
  const body='<div class="detail-card" style="box-shadow:none;padding:0">'+
    t('gen.L868.1','<div class="detail-section"><h3>审批人信息</h3><div class="detail-grid">')+
      row(t("app.395", "\u5f53\u524d\u5ba1\u6279\u7ea7\u6b21"), curLevel+' / '+r.max_level)+
      row(t("app.396", "\u5f53\u524d\u5ba1\u6279\u4eba"), curA?(curA.approver_name||'—'):t("app.397", "\uff08\u672a\u914d\u7f6e\uff09"))+
      (isLast?'':row(t("app.398", "\u4e0b\u4e00\u5ba1\u6279\u7ea7\u6b21"), nextLevel+' / '+r.max_level))+
      (isLast?'':row(t("app.399", "\u4e0b\u4e00\u5ba1\u6279\u4eba"), nextA?(nextA.approver_name||'—'):t("app.400", "\uff08\u672a\u914d\u7f6e / \u5f85\u6307\u5b9a\uff09")))+
    '</div></div>'+
    '<p class="muted-hint" style="margin:6px 0 0">'+(isLast?t('gen.L874.1','通过后将最终生效。'):t('gen.L874.2','通过后仍需第 ')+nextLevel+t('gen.L874.3',' 级审批才最终生效。'))+'</p>'+
  '</div>';
  openModal(t('modal.title.approvePO', '确认通过审批 · {v1}', {v1: r.po_no}), body,
    t('modal.footer.approvePO', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="confirmApprovePO('{v1}')">✅ 确认通过</button>`, {v1: id}));
}
async function confirmApprovePO(id){
  try{
    await api('/api/purchase-orders/'+id+'/approve','POST',{action:'approve'});
    closeModal();
    showToast(t('gen.L883.1','已通过（待后续级次）'),'success');
    if(_approvalTab==='mine'||_approvalTab==='all'||_approvalTab==='purchase')loadApprovalCenterList();
  }catch(e){showToast(e.message,'danger')}
}
function rejectPO(id){
  const reason=prompt(t('gen.L888.1','请输入驳回原因（必填）：'));
  if(reason===null)return;
  if(!reason.trim()){showToast(t('gen.L890.1','驳回原因必填'),'warning');return;}
  doRejectPO(id,reason.trim());
}
async function doRejectPO(id,reason){
  try{
    await api('/api/purchase-orders/'+id+'/approve','POST',{action:'reject',remark:reason});
    showToast(t('gen.L896.1','已驳回，PO 已退回草稿'),'success');
    if(_approvalTab==='mine'||_approvalTab==='all'||_approvalTab==='purchase')loadApprovalCenterList();
  }catch(e){showToast(e.message,'danger')}
}
async function openApprovalDetail(approvalId,poId){
  const r=(_approvalListData.find(x=>x.approval_id===approvalId))||(_approvalListData.find(x=>x.po_id===poId));
  if(!r){showToast(t('gen.L902.1','未找到该审批记录'),'danger');return;}
  let hist=[];
  try{hist=JSON.parse(r.approval_history||'[]');}catch(e){}
  const actionLabel=m=>m==='submit'?t('gen.L905.1','提交审批'):m==='approve'?t('gen.L905.2','通过'):m==='reject'?t('gen.L905.3','驳回'):m==='withdraw'?t('gen.L905.4','撤回'):(m||'');
  const tl=hist.length?hist.map(h=>'<li class="tl-item"><div class="tl-action"><b>'+esc(actionLabel(h.action))+'</b></div><div class="tl-meta">'+(h.user_name||'')+' · '+esc((h.time||'').replace('T',' ').slice(0,19))+'</div>'+(h.remark?t('gen.L906.1','<div class="tl-remark">备注：')+esc(h.remark)+'</div>':'')+'</li>').join(''):t('gen.L906.2','<li class="tl-item"><div class="tl-meta">暂无审批轨迹</div></li>');
  const row=(l,v)=>'<div class="detail-item"><span class="detail-label">'+l+'</span><span class="detail-value">'+esc(v ?? '')+'</span></div>';
  // 复用 PO 详情接口获取 SKU 明细（与 viewPO 同源，不新造逻辑）
  let items=[];
  try{const po=await api('/api/purchase-orders/'+poId); items=po.items||[];}catch(e){}
  const itemsHtml=items.length?
    t('gen.L912.1','<div class="detail-section"><h3>PO明细</h3><div class="table-container"><table class="data-table"><thead><tr>')+
      t('gen.L913.1','<th>SKU</th><th class="text-right">数量</th><th class="text-right">单价</th><th class="text-right">小计</th></tr></thead><tbody>')+
      items.map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+(i.po_qty||0)+'</td><td class="text-right">'+fmtMoney(i.unit_price,r.currency)+'</td><td class="text-right">'+fmtMoney(i.po_amount,r.currency)+'</td></tr>').join('')+
    '</tbody></table></div></div>'
    :t('gen.L916.1','<div class="detail-section"><h3>PO明细</h3><div class="muted-hint" style="padding:8px 0">无明细数据</div></div>');
  openModal(t('modal.title.openApprovalDetail', 'PO 审批详情 · {v1}', {v1: r.po_no}),
    t('modal.body.openApprovalDetail', '<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>基本信息</h3><div class="detail-grid">{v1}{v2}{v3}{v4}{v5}{v6}{v7}{v8}{v9}</div></div>{v10}{v11}<div class="detail-section"><h3>审批轨迹</h3><ul class="approval-timeline">{v12}</ul></div></div>', {v1: row(t("app.115", "PO\u53f7"),r.po_no), v2: row(t("app.112", "\u54c1\u724c"),r.brand), v3: row(t("app.113", "\u56fd\u5bb6"),r.country), v4: row(t("app.114", "\u4ed3\u5e93"),r.target_warehouse), v5: row(t("app.195", "\u603b\u6570\u91cf"),(r.total_qty||0).toLocaleString()), v6: row(t("app.129", "\u603b\u91d1\u989d"),fmtMoney(r.total_amount,r.currency)), v7: row(t("app.391", "\u63d0\u4ea4\u4eba"),r.submitter_name), v8: row(t("approval.001", "\u63d0\u4ea4\u65f6\u95f4"),(r.submitted_at||'').replace('T',' ').slice(0,19)), v9: row(t("app.392", "\u5ba1\u6279\u7ea7\u6b21"),r.current_level+' / '+r.max_level), v10: itemsHtml, v11: (function(){let cc=Array.isArray(r.cc_users)?r.cc_users:[];return t('gen.L918.1','<div class="detail-section"><h3>抄送人 (CC)</h3><div class="detail-grid">')+(cc.length?cc.map(c=>t('gen.L918.2','<div class="detail-item"><span class="detail-label">抄送</span><span class="detail-value">')+esc(c.user_name||c.user_id)+'</span></div>').join(''):t('gen.L918.3','<div class="muted-hint" style="padding:4px 0">无抄送人</div>'))+'</div></div>';})(), v12: tl}));
}

function renderExpenseTypes(){renderSimpleMgr(t("nav.expense_types", "\u8d39\u7528\u7c7b\u578b"),'/api/expense-types',[{name:'name',label:t("col.name", "名称"),req:1},{name:'code',label:t("shell.002", "\u4ee3\u7801")},{name:'is_freight',label:t("shell.023", "\u8ba1\u5165\u7efc\u5408\u8fd0\u8d39"),bool:1},{name:'is_cost',label:t("shell.024", "\u8ba1\u5165\u6210\u672c"),bool:1},{name:'sort_order',label:t("shell.003", "\u6392\u5e8f"),num:1},{name:'status',label:t("status.label", "\u72b6\u6001"),sel:1,opts:['active','disabled']}],'📊')}
function renderAllocationRules(){renderSimpleMgr(t("nav.allocation_rules", "\u5206\u644a\u89c4\u5219"),'/api/allocation-rules',[{name:'name',label:t("col.name", "名称"),req:1},{name:'transport_mode',label:t("shell.025", "\u8fd0\u8f93\u65b9\u5f0f"),sel:1,opts:['sea','air','express','land']},{name:'expense_type',label:t("nav.expense_types", "\u8d39\u7528\u7c7b\u578b"),sel:1,opts:['freight','duty']},{name:'allocation_basis',label:t('gen.L922.1','分摊依据'),sel:1,opts:['cbm','weight','amount']},{name:'is_enabled',label:t("common.enable", "\u542f\u7528"),bool:1}],'📐')}
function renderConfig(){
  document.getElementById('content-inner').innerHTML=t('html.renderConfig', '<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">⚙️ 系统配置</div><div class="table-section-actions">{v1}</div></div><div id="config-table" style="padding:20px"></div></div>', {v1: hasPermission('system_config')?t('gen.L924.1','<button class="btn btn-primary btn-sm" onclick="saveConfig()">💾 保存</button>'):''});
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
  try{await api('/api/system-config','POST',{configs});showToast(t('gen.L937.1','配置已保存'),'success')}catch(e){showToast(e.message,'danger')}
}
// 用户管理最小闭环：查看（脱敏飞书标识）、启用/停用、分配角色；不允许建本地密码账号、改密码、改飞书标识、停用/删应急账号
// I18N-100P-B1：新增语言偏好 inline select（管理员可设置）
async function renderUsers(){
  document.getElementById('content-inner').innerHTML=t('gen.L941.1','<div id="flash-container"></div><div id="user-mgr-loading" class="pc-loading">加载用户列表…</div>');
  try{
    const [users, roles]=await Promise.all([api('/api/users'), api('/api/roles')]);
    window.__userCache=users;
    const rows=users.map(u=>{
      const isBG = u.auth_source==='local';
      const statusBadge = '<span class="status-'+(u.status==='active'?'active':(u.status==='pending'?'pending':'disabled'))+'">'+statusLabel(u.status)+'</span>';
      const roleSel = '<select class="user-role-sel" data-uid="'+u.id+'"'+(isBG?t('gen.L948.1',' disabled title="\u5e94\u6025\u8d26\u53f7\u89d2\u8272\u56fa\u5b9a"'):'')+'>'+roles.map(r=>'<option value="'+r.id+'"'+(r.id===u.role_id?' selected':'')+'>'+esc(formatRoleLabel(r.id, r.name))+'</option>').join('')+'</select>';
      // I18N-100P-B1：语言偏好 inline select（zh/en/id）
      const lp = u.language_preference==='en'?'en':(u.language_preference==='id'?'id':'zh');
      const langSel = '<select class="user-lang-sel" data-uid="'+u.id+'">'
        +'<option value="zh"'+(lp==='zh'?' selected':'')+'>'+t('user.lang_zh','中文')+'</option>'
        +'<option value="en"'+(lp==='en'?' selected':'')+'>'+t('user.lang_en','English')+'</option>'
        +'<option value="id"'+(lp==='id'?' selected':'')+'>'+t('user.lang_id','Bahasa Indonesia')+'</option>'
        +'</select>';
      const actionBtn = isBG
        ? t('gen.L950.1','<button class="btn btn-xs btn-secondary" disabled title="应急账号不可停用">停用</button>')
        : (u.status==='active'
            ? '<button class="btn btn-xs btn-warning" onclick="setUserStatus(\''+u.id+t('gen.L952.1','\',\'disabled\')">停用</button>')
            : '<button class="btn btn-xs btn-success" onclick="setUserStatus(\''+u.id+t('gen.L953.1','\',\'active\')">启用</button>'));
      return '<tr>'
        +'<td>'+esc(u.name||'')+'</td>'
        +'<td>'+esc(u.username||'')+'</td>'
        +'<td>'+esc(u.feishu_union_id||'')+'</td>'
        +'<td>'+esc(u.email||'')+'</td>'
        +'<td>'+(isBG?t('gen.L959.1','本地应急'):t("app.415", "\u98de\u4e66"))+'</td>'
        +'<td>'+statusBadge+'</td>'
        +'<td>'+roleSel+'</td>'
        +'<td>'+langSel+'</td>'
        +'<td>'+actionBtn+'</td>'
        +'</tr>';
    }).join('');
    document.getElementById('content-inner').innerHTML=
      t('html.renderUsers', '<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">👤 用户管理</div></div><div class="table-container"><table class="data-table"><thead><tr><th>姓名</th><th>用户名</th><th>飞书标识(脱敏)</th><th>邮箱</th><th>来源</th><th>状态</th><th>角色</th><th>语言偏好</th><th>操作</th></tr></thead><tbody>{v1}</tbody></table></div><div class="pc-hint">用户由飞书首次登录自动创建（默认 <b>'+statusLabel('pending')+'</b>，无角色、无权限）。管理员启用并分配角色后，用户方可进入业务。不允许创建本地密码账号、不允许修改密码、不允许编辑飞书标识、不允许停用/删除应急账号。</div></div>', {v1: rows});
    // I18N-B1-PAGE-CONTEXT-STATE-01：限定 [data-uid] 排除顶部 lang-switcher（class同为 user-role-sel），
    // 否则 renderUsers 会给 lang-switcher 绑定 setUserRole，语言切换时 setUserRole(undefined) → renderUsers() 覆盖当前页
    document.querySelectorAll('.user-role-sel[data-uid]').forEach(sel=>{ sel.addEventListener('change',()=>setUserRole(sel.dataset.uid, sel.value)); });
    document.querySelectorAll('.user-lang-sel[data-uid]').forEach(sel=>{ sel.addEventListener('change',()=>setUserLanguagePreference(sel.dataset.uid, sel.value)); });
  }catch(e){ showFlash(e.message,'danger'); }
}
async function setUserRole(uid, roleId){
  const u=(window.__userCache||[]).find(x=>x.id===uid);
  if(!u){ renderUsers(); return; }
  try{ await api('/api/users/'+uid,'PUT',{username:u.username, name:u.name, role_id:roleId}); showToast(t('gen.L973.1','角色已更新'),'success'); }catch(e){ showToast(e.message,'danger'); renderUsers(); }
}
// I18N-100P-B1：管理员修改用户语言偏好（复用 PUT /api/users/:id）
async function setUserLanguagePreference(uid, lp){
  const u=(window.__userCache||[]).find(x=>x.id===uid);
  if(!u){ renderUsers(); return; }
  try{ await api('/api/users/'+uid,'PUT',{username:u.username, name:u.name, language_preference:lp}); showToast(t('gen.L973.2','语言偏好已更新'),'success'); }catch(e){ showToast(e.message,'danger'); renderUsers(); }
}
async function setUserStatus(uid, status){
  const u=(window.__userCache||[]).find(x=>x.id===uid);
  if(!u){ renderUsers(); return; }
  try{ await api('/api/users/'+uid,'PUT',{username:u.username, name:u.name, status}); showToast(status==='active'?t('gen.L978.1','已启用'):t('gen.L978.2','已停用'),'success'); renderUsers(); }catch(e){ showToast(e.message,'danger'); }
}
function renderRoles(){
  document.getElementById('content-inner').innerHTML=t('gen.L981.1','<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🛡️ 角色管理</div></div><div id="simple-table"></div></div>');
  loadRoles();
}
let roleListData=[];
async function loadRoles(){
  try{
    const data=await api('/api/roles');
    roleListData=data;
    const html=!data.length?t('gen.L989.1','<div class="empty-state">暂无角色</div>'):t('gen.L989.2','<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>')+t('role.col.name','角色名')+t('gen.L989.2.th1','</th><th>')+t('role.col.description','描述')+t('gen.L989.2.th2','</th><th>')+t('role.col.perm_count','权限数')+t('gen.L989.2.th3','</th><th>')+t('role.col.system','系统')+t('gen.L989.2.th4','</th><th>')+t('role.col.actions','操作')+t('gen.L989.2.th5','</th></tr></thead><tbody>')+data.map(r=>'<tr class="role-edit-row" data-role-id="'+esc(r.id)+'" style="cursor:pointer" title="'+t('gen.L989.3.title','点击编辑权限')+'"><td>'+esc(formatRoleLabel(r.id, r.name))+'</td><td>'+esc(formatRoleDescription(r.id, r.description))+'</td><td>'+(r.permissions||[]).length+'</td><td>'+(r.is_system?'✅':'❌')+'</td><td><button class="btn btn-sm btn-primary role-edit-btn" data-role-id="'+esc(r.id)+'">'+t('gen.L989.4.btn','编辑权限')+'</button></td></tr>').join('')+'</tbody></table></div>';
    document.getElementById('simple-table').innerHTML=html;
    // [SEC] 角色 ID 通过 data-role-id 传递，避免 inline onclick 拼接 JS 字符串（防注入）
    document.querySelectorAll('#simple-table .role-edit-btn').forEach(function(btn){
      btn.addEventListener('click', function(e){ e.stopPropagation(); openRoleEditor(this.getAttribute('data-role-id')); });
    });
    document.querySelectorAll('#simple-table .role-edit-row').forEach(function(tr){
      tr.addEventListener('click', function(){ openRoleEditor(this.getAttribute('data-role-id')); });
    });
  }catch(e){showFlash(e.message,'danger')}
}

// 角色权限编辑：点击角色 → 弹窗勾选权限 → 保存（复用 POST /api/roles upsert）
const ROLE_CRITICAL_PERMS=['role_manage','user_manage','system_config'];
const ROLE_MODULE_ORDER=['系统管理','采购','库存','销售','财务','报表'];
async function openRoleEditor(roleId){
  try{
    const role=roleListData.find(r=>r.id===roleId);
    if(!role){showToast(t('gen.L1000.1','未找到该角色'),'danger');return;}
    const catalog=await api('/api/permissions');
    const own=role.permissions||[];
    const groups={};
    catalog.forEach(p=>{ (groups[p.module]=groups[p.module]||[]).push(p); });
    let body=t('gen.L1005.1','<div style="font-size:12px;color:var(--text-secondary,#999);margin-bottom:10px">')+t('role.field.name_readonly','角色名称（只读）：')+'<b>'+esc(formatRoleLabel(role.id, role.name))+t('gen.L1005.2','</b> ｜ ')+t('role.field.desc_readonly','角色说明（只读）：')+esc(formatRoleDescription(role.id, role.description))+'</div>';
    if(role.id==='role_admin'){
      body+='<div class="flash flash-warning show" style="margin-bottom:12px">'+t('role.locked_warning','超级管理员角色：关键管理权限（角色管理 / 用户管理 / 系统配置）已被锁定，不可取消，以避免系统失去管理入口。')+'</div>';
    }
    ROLE_MODULE_ORDER.forEach(mod=>{
      const items=groups[mod]; if(!items||!items.length)return;
      body+='<div style="font-weight:600;margin:12px 0 6px;font-size:13px">'+esc(formatPermModule(mod))+'</div><div style="display:flex;flex-wrap:wrap;gap:8px 16px">';
      items.forEach(p=>{
        const checked=own.includes(p.key)?'checked':'';
        const locked=(role.id==='role_admin'&&ROLE_CRITICAL_PERMS.includes(p.key));
        const dis=locked?'disabled':'';
        const lockIco=locked?' 🔒':'';
        body+='<label style="font-size:13px;display:flex;align-items:center;gap:4px;min-width:140px"><input type="checkbox" data-perm="'+esc(p.key)+'" '+checked+' '+dis+'>'+esc(formatPermLabel(p.key, p.label))+lockIco+'</label>';
      });
      body+='</div>';
    });
    // [SEC] 保存按钮通过 data-role-id 传递，避免 inline onclick 拼接 JS 字符串（防注入）
    const footer='<button class="btn btn-secondary" onclick="closeModal()">'+t('role.btn.cancel','取消')+'</button><button class="btn btn-primary" id="role-save-btn" data-role-id="'+esc(role.id)+'">'+t('role.btn.save','保存')+'</button>';
    openModal(t('modal.title.openRoleEditor', '编辑角色权限 · {v1}', {v1: formatRoleLabel(role.id, role.name)}), body, footer, 'modal-lg');
    var saveBtn=document.getElementById('role-save-btn');
    if(saveBtn){ saveBtn.addEventListener('click', function(){ saveRolePermissions(this.getAttribute('data-role-id')); }); }
  }catch(e){showToast(e.message||t("app.427", "\u6253\u5f00\u5931\u8d25"),'danger')}
}
async function saveRolePermissions(roleId){
  try{
    const role=roleListData.find(r=>r.id===roleId);
    if(!role){showToast(t('gen.L1028.1','未找到该角色'),'danger');return;}
    const boxes=[...document.querySelectorAll('#modal-content input[type=checkbox][data-perm]')];
    let perms=boxes.filter(b=>b.checked).map(b=>b.getAttribute('data-perm'));
    // 安全护栏（前端锁定 + 后端再次强制）：role_admin 始终保留关键管理权限
    if(roleId==='role_admin'){
      ROLE_CRITICAL_PERMS.forEach(p=>{ if(!perms.includes(p)) perms.push(p); });
    }
    await api('/api/roles','POST',{id:roleId,name:role.name,description:role.description||'',permissions:perms});
    showToast(t('gen.L1036.1','角色权限已保存'),'success');
    closeModal();
    loadRoles();
  }catch(e){showToast(e.message||t("app.429", "\u4fdd\u5b58\u5931\u8d25"),'danger')}
}

// ==================== 品牌设置 ====================
// 品牌采购状态（停采品牌系统级规则）：在品牌设置页维护 可采购/停采
async function renderBrandSettings(){
  document.getElementById('content-inner').innerHTML=t('html.renderBrandSettings', '<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🏷️ 品牌设置</div><div class="table-section-actions">{v1}</div></div><div id="brand-settings-table"></div></div>', {v1: hasPermission('system_config')?t('gen.L1045.1','<button class="btn btn-primary btn-sm" onclick="saveBrandSettings()">💾 保存采购状态</button>'):''});
  try{
    const brands=await api('/api/brands/all');
    let settings=[];
    try{ settings=await api('/api/brand-settings'); }catch(e){ settings=[]; }
    const statusMap={};
    settings.forEach(s=>{ statusMap[s.brand]=s.procurement_status; });
    const skus=await api('/api/skus');
    const brandCount={};
    skus.forEach(s=>{if(s.brand){brandCount[s.brand]=(brandCount[s.brand]||0)+1}});
    if(!brands.length){
      document.getElementById('brand-settings-table').innerHTML='<div class="empty-state"><div class="empty-icon">🏷️</div>'+t('html.brand.emptyState','暂无品牌数据')+'<br><span style="font-size:12px;color:#999">'+t('html.brand.emptyStateHint','品牌来源于 SKU 主数据中的品牌字段')+'</span></div>';
      return;
    }
    const html='<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t('html.brand.colName','品牌名称')+'</th><th>'+t('html.brand.colSkuCount','关联SKU数')+'</th><th>'+t('html.brand.colStatus','采购状态')+'</th></tr></thead><tbody>'+brands.map(b=>{
      const st=statusMap[b]||'active';
      return '<tr><td class="cell-name">'+esc(b)+'</td><td>'+(brandCount[b]||0)+'</td>'+
        '<td><select class="form-control input-sm" data-brand="'+esc(b)+'" style="width:140px">'+
          '<option value="active"'+((st==='active')?' selected':'')+'>'+t('html.brand.statusActive','可采购')+'</option>'+
          '<option value="stopped"'+((st==='stopped')?' selected':'')+'>'+t('html.brand.statusStopped','停采')+'</option>'+
        '</select></td></tr>';
    }).join('')+'</tbody></table></div>'+
    '<div style="padding:12px 20px;color:#999;font-size:12px">💡 '+t('html.brand.statusHint','采购状态设为「停采」的品牌：不参与补货建议（建议采购固定为 0）、不进入 PO 候选、不要求命中目标周转规则、不阻止整页重新计算，但在订单预测页仍可见（便于清库存）。')+'</div>';
    document.getElementById('brand-settings-table').innerHTML=html;
    // 语言切换刷新守卫：任一品牌采购状态下拉变更即标记未保存，阻止切换语言时整页刷新丢值
    document.querySelectorAll('#brand-settings-table select[data-brand]').forEach(sel=>{
      sel.addEventListener('change',()=>{ window.__brandUnsaved=true; });
    });
  }catch(e){showFlash(e.message,'danger')}
}
async function saveBrandSettings(){
  try{
    const selects=document.querySelectorAll('#brand-settings-table select[data-brand]');
    const items=[];
    selects.forEach(s=>{ items.push({brand:s.getAttribute('data-brand'), procurement_status:s.value}); });
    if(!items.length){showToast(t('toast.brand.noneToSave','没有可保存的品牌'),'warning');return;}
    await api('/api/brand-settings','POST',{items:items});
    window.__brandUnsaved=false;
    showToast(t('toast.brand.savedStatus','已保存品牌采购状态'),'success');
    renderBrandSettings();
  }catch(e){showToast(e.message||t("app.429", "\u4fdd\u5b58\u5931\u8d25"),'danger')}
}

// ==================== 付款类目管理（L1B-2-2B 并行全量加载 + 请求版本防竞态 + 内存关联） ====================
// 本轮只修：① 跨页面异步竞态（loadSeq + 根节点存在判断）② 串行按需 → 三个完整 GET 并行 + 内存建树
// ③ 切换大类/小类仅内存过滤（零网络）④ 刷新保留有效选择 ⑤ fee_type 显示用当前小类 name
// 仍不含任何 CRUD 提交（新增/编辑/启停在 L1B-2-3~2-5 实现）；无 system_config 权限时只读。
let pcState={
  categories:[],      // 全部大类（GET /api/payment-categories）
  subcategories:[],   // 全部小类（GET /api/payment-subcategories）
  sources:[],         // 全部来源映射（GET /api/payment-subcategory-sources）
  selCatId:null,
  selSubId:null,
  readOnly:false,
  loadSeq:0,          // 本页面专用加载序号，每次进入/刷新自增
  editingId:null,     // 当前编辑的大类 id（null=新增）
  editingSubId:null,  // 当前编辑的小类 id（null=新增）
  saving:false,       // 保存中（防重复提交）
  savingSub:false,    // 小类保存中（防重复提交）
  toggling:false,     // 大类启停提交中（防重复点击）
  togglingSub:false,  // 小类启停提交中（防重复点击）
  savingMap:false,    // 来源映射保存中（防重复提交）
  togglingMap:false   // 来源映射启停提交中（防重复点击）
};

// 来源类型显示名映射（仅展示用；不改动旧付款流程的硬编码常量）
const PC_SRC_LABEL={pi:'PI',ci:'CI',manual:t("app.433", "\u624b\u52a8\u5f55\u5165")};
const PC_SOURCE_FEE_MATRIX=Object.freeze({
  pi:Object.freeze(['deposit']),
  ci:Object.freeze(['balance','freight','customs_clearance','port_charges','delivery','warehouse','other_local','duty','inspection']),
  manual:Object.freeze(['freight','customs_clearance','port_charges','delivery','warehouse','other_local'])
});
const PC_FEE_LABEL={
  deposit:t('term.deposit','定金'),balance:t('term.balance','尾款'),freight:t('term.freight','运费'),customs_clearance:t("app.434", "\u6e05\u5173\u8d39"),port_charges:t("app.435", "\u6e2f\u53e3\u8d39"),
  delivery:t("app.436", "\u6d3e\u9001\u8d39"),warehouse:t("app.437", "\u4ed3\u50a8\u8d39"),other_local:t("app.438", "\u5176\u4ed6\u672c\u5730\u8d39"),duty:t("app.224", "\u5173\u7a0e"),inspection:t("app.439", "\u5546\u68c0\u8d39")
};
const PC_SOURCE_ORDER=['pi','ci','manual'];
const pcSrcLabel=c=>PC_SRC_LABEL[c]||c;
const pcFeeLabel=c=>PC_FEE_LABEL[c]||c;
const PC_PAYEE_LABEL={
  factory:t("app.440", "\u5de5\u5382"),
  service_provider:t("app.441", "\u670d\u52a1\u5546/\u8d27\u4ee3"),
  customs:t("app.442", "\u6d77\u5173"),
  inspection_org:t("app.443", "\u5546\u68c0\u673a\u6784"),
  warehouse:t("app.114", "\u4ed3\u5e93"),
  port:t("app.444", "\u6e2f\u53e3"),
  other:t('term.other','其他')
};
function pcPayeeLabel(code){
  if(!code) return `${t("status.not_set","未设置")}`;
  return (PC_PAYEE_LABEL[code]||code)+'（'+code+'）';
}
function pcPayeeOptions(selected){
  const vals=[...new Set(pcState.subcategories.map(s=>s.payee_type_default).filter(Boolean))].sort();
  if(selected && !vals.includes(selected)) vals.push(selected);
  return '<option value=""'+(!selected?' selected':'')+`>${t("status.not_set","未设置")}</option>`+vals.map(v=>'<option value="'+esc(v)+'"'+(selected===v?' selected':'')+'>'+esc(pcPayeeLabel(v))+'</option>').join('');
}
function pcCatLabel(cat){
  return cat ? cat.name+'（'+cat.code+'）' : '';
}

async function renderPaymentCategories(){
  pcState.readOnly=!hasPermission('system_config');
  document.getElementById('content-inner').innerHTML=
    t('html.renderPaymentCategories', `<div id="flash-container"></div>{v1}<div class="pc-head"><div><div class="pc-title">${t("term.fin.payment_category_mgmt","付款类目管理")}</div><div class="pc-desc">${t("action.manage_category","维护付款大类")}、${t("term.fin.subcategory_source_map","小类及其费用来源映射")}。${t("term.fin.disabled_not_in_new","停用项目不会出现在新的付款申请中")}，${t("term.fin.no_impact_history","但不影响历史记录")}。</div></div><div class="pc-head-actions"><button class="btn btn-secondary btn-sm" id="pc-refresh-btn" onclick="renderPaymentCategories()">🔄 ${t("action.refresh","刷新")}</button><button class="btn btn-secondary btn-sm" onclick="pcShowHelp()">❔ ${t("term.fin.page_note","页面说明")}</button></div></div><div id="payment-categories-page"><div class="payment-category-columns" id="pc-cols">{v2}{v3}{v4}</div></div>`, {v1: pcState.readOnly?`<div class="pc-readonly-banner">🔒 ${t("term.fin.readonly_mode","只读模式")}：${t("term.fin.current_account_no","当前账号无")}「${t("term.fin.system_config","系统配置")}」${t("term.fin.permission","权限")}，${t("term.fin.view_only_category","仅可查看付款类目")}，${t("term.fin.cannot_add","不能新增")} / ${t("action.edit","编辑")} / ${t("action.toggle_enable","启停")}。</div>`:'', v2: pcColShell(`${t("col.payment_category","付款大类")}`,t("shell.032", "\uff0b \u65b0\u589e\u5927\u7c7b"),'pcOpenCategoryModal()','pc-cat-body',null), v3: pcColShell(t("shell.033", "\u4ed8\u6b3e\u5c0f\u7c7b"),t("shell.034", "\uff0b \u65b0\u589e\u5c0f\u7c7b"),'pcOpenSubModal()','pc-sub-body','pc-sub-title'), v4: pcColShell(t("shell.035", "\u6765\u6e90\u6620\u5c04"),t("shell.036", "\uff0b \u65b0\u589e\u6620\u5c04"),'pcOpenMapModal()','pc-map-body','pc-map-title')});
  await pcLoadAll();
}

// 三栏外壳（readOnly 时隐藏新增按钮；中/右栏标题含动态父级名）
function pcColShell(titleHtml,addLabel,addFn,bodyId,titleId){
  const titleInner=titleId?'<span id="'+titleId+'">'+titleHtml+'</span>':titleHtml;
  const addBtn=pcState.readOnly?'':'<button class="btn btn-primary btn-sm" onclick="'+addFn+'">'+addLabel+'</button>';
  return '<section class="col-pc-card"><div class="col-pc-head"><div class="col-pc-title">'+titleInner+'</div>'+addBtn+'</div>'+
    '<div class="col-pc-body" id="'+bodyId+'"><div class="pc-loading">'+t('common.loading','加载中…')+'</div></div></section>';
}

// —— 并行全量加载：三个完整 GET（不带任何过滤参数）——
async function pcLoadAll(){
  const mySeq=++pcState.loadSeq;
  const root=document.getElementById('payment-categories-page');
  if(!root) return;            // 页面已被销毁（切走），静默结束
  pcSetLoading(true);
  ['pc-cat-body','pc-sub-body','pc-map-body'].forEach(id=>{const el=document.getElementById(id); if(el)el.innerHTML='<div class="pc-loading">'+t('common.loading','加载中…')+'</div>';});
  const st=document.getElementById('pc-sub-title'); if(st)st.innerHTML=t("shell.033", "\u4ed8\u6b3e\u5c0f\u7c7b");
  const mt=document.getElementById('pc-map-title'); if(mt)mt.innerHTML=t("shell.035", "\u6765\u6e90\u6620\u5c04");
  try{
    // 方式 A：三个完整 GET 并行加载，前端内存建树（切换大类/小类不再请求后端）
    const [catResp, subResp, sourceResp]=await Promise.all([
      api('/api/payment-categories'),
      api('/api/payment-subcategories'),
      api('/api/payment-subcategory-sources')
    ]);
    // 过期请求或页面已销毁 → 直接丢弃，不回写、不报错
    if(mySeq!==pcState.loadSeq) return;
    if(!document.getElementById('payment-categories-page')) return;
    pcState.categories=Array.isArray(catResp)?catResp:[];
    pcState.subcategories=Array.isArray(subResp)?subResp:[];
    pcState.sources=Array.isArray(sourceResp)?sourceResp:[];
    pcRenderAll();   // 保留 pcState.selCatId/selSubId（刷新前已存于内存），失效则按 active 优先重选
  }catch(e){
    if(mySeq!==pcState.loadSeq) return;
    if(!document.getElementById('payment-categories-page')) return;
    ['pc-cat-body','pc-sub-body','pc-map-body'].forEach(id=>{const el=document.getElementById(id); if(el)el.innerHTML=pcError(e.message);});
  }finally{
    if(mySeq===pcState.loadSeq) pcSetLoading(false);
  }
}
function pcSetLoading(loading){
  const btn=document.getElementById('pc-refresh-btn');
  if(btn){ btn.disabled=loading; btn.style.opacity=loading?'0.6':'1'; btn.textContent=loading?t('gen.L1194.1','⏳ 加载中…'):t("app.080", "\ud83d\udd04 \u5237\u65b0"); }
}

// —— 内存关联辅助 ——
function pcCatById(id){ return pcState.categories.find(c=>c.id===id)||null; }
function pcSubsOf(catId){ return pcState.subcategories.filter(s=>s.category_id===catId); }
function pcMapsOf(subId){ return pcState.sources.filter(m=>m.subcategory_id===subId); }
function pcActiveFirst(list){ return list.find(x=>x.status==='active')||list[0]||null; }

// 首屏/刷新渲染：保留之前的选择（pcState.selCatId/selSubId），失效则按 active 优先重选
function pcRenderAll(){
  const cat=pcCatById(pcState.selCatId)||pcActiveFirst(pcState.categories);
  pcState.selCatId=cat?cat.id:null;
  let sub=null;
  if(pcState.selCatId){
    const subs=pcSubsOf(pcState.selCatId);
    if(pcState.selSubId && subs.find(s=>s.id===pcState.selSubId)) sub=subs.find(s=>s.id===pcState.selSubId);
    else sub=pcActiveFirst(subs);
  }
  pcState.selSubId=sub?sub.id:null;
  pcRenderCats();
  pcRenderSubs();
}
// 点击左栏大类（同步内存切换，不请求后端；旧大类的小类不保留，自动选新大类下第一个 active 小类）
function pcSelectCat(catId){
  const cat=pcCatById(catId); if(!cat) return;
  pcState.selCatId=cat.id;
  const sub=pcActiveFirst(pcSubsOf(catId));
  pcState.selSubId=sub?sub.id:null;
  pcRenderCats();
  pcRenderSubs();
}
// 点击中栏小类（同步内存切换，不请求后端）
function pcSelectSub(subId){
  const sub=pcState.subcategories.find(s=>s.id===subId); if(!sub) return;
  pcState.selSubId=sub.id;
  pcRenderSubs();
}

// —— 三栏渲染 ——
function pcRenderCats(){
  const body=document.getElementById('pc-cat-body'); if(!body)return;
  if(!pcState.categories.length){ body.innerHTML=pcEmpty(t("app.448", "\u6682\u65e0\u4ed8\u6b3e\u5927\u7c7b")); return; }
  body.innerHTML=pcState.categories.map(c=>pcCatRow(c)).join('');
}
function pcRenderSubs(){
  const body=document.getElementById('pc-sub-body'); if(!body)return;
  const st=document.getElementById('pc-sub-title');
  if(st){ const cat=pcCatById(pcState.selCatId); st.innerHTML=t('html.pcRenderSubs', '{v1} <span class="pc-sub">· 付款小类</span>', {v1: esc(cat?cat.name:t("shell.033", "\u4ed8\u6b3e\u5c0f\u7c7b"))}); }
  if(!pcState.selCatId){ body.innerHTML=pcEmpty(t("app.450", "\u8bf7\u9009\u62e9\u5de6\u4fa7\u4ed8\u6b3e\u5927\u7c7b")); pcRenderMaps(); return; }
  const subs=pcSubsOf(pcState.selCatId);
  if(!subs.length){ body.innerHTML=pcEmpty(t("app.451", "\u8be5\u5927\u7c7b\u4e0b\u6682\u65e0\u4ed8\u6b3e\u5c0f\u7c7b")); pcRenderMaps(); return; }
  body.innerHTML=subs.map(s=>pcSubRow(s)).join('');
  pcRenderMaps();
}
function pcRenderMaps(){
  const body=document.getElementById('pc-map-body'); if(!body)return;
  const mt=document.getElementById('pc-map-title');
  if(mt){ const sub=pcState.subcategories.find(s=>s.id===pcState.selSubId); mt.innerHTML=t('html.pcRenderMaps', '{v1} <span class="pc-sub">· 来源映射</span>', {v1: esc(sub?sub.name:t("shell.035", "\u6765\u6e90\u6620\u5c04"))}); }
  if(!pcState.selSubId){ body.innerHTML=pcEmpty(t("app.453", "\u8bf7\u9009\u62e9\u5de6\u4fa7\u4ed8\u6b3e\u5c0f\u7c7b")); return; }
  const maps=pcMapsOf(pcState.selSubId).slice().sort(pcMapSort);
  if(!maps.length){ body.innerHTML=pcEmpty(t("app.454", "\u8be5\u5c0f\u7c7b\u4e0b\u6682\u65e0\u6765\u6e90\u6620\u5c04"))+pcHint(); return; }
  body.innerHTML=maps.map(m=>pcMapRow(m)).join('')+pcHint();
}
function pcMapSort(a,b){
  const statusDiff=(a.status==='active'?0:1)-(b.status==='active'?0:1);
  if(statusDiff) return statusDiff;
  const sourceDiff=PC_SOURCE_ORDER.indexOf(a.source_type)-PC_SOURCE_ORDER.indexOf(b.source_type);
  if(sourceDiff) return sourceDiff;
  const feeOrder=PC_SOURCE_FEE_MATRIX[a.source_type]||[];
  const feeDiff=feeOrder.indexOf(a.fee_type)-feeOrder.indexOf(b.fee_type);
  if(feeDiff) return feeDiff;
  return String(a.created_at||a.id||'').localeCompare(String(b.created_at||b.id||''));
}

// —— 行渲染 ——
function pcCatRow(c){
  return '<div class="pc-row'+(c.id===pcState.selCatId?' selected':'')+'" data-id="'+esc(c.id)+'" onclick="pcSelectCat(\''+esc(c.id)+'\')">'+
    '<div class="pc-main"><div class="pc-name" title="'+esc(c.name)+'">'+esc(c.name)+'</div>'+
    '<div class="pc-code" title="'+esc(c.code)+'">'+esc(c.code)+'</div></div>'+
    pcStatusBadge(c.status)+(pcState.readOnly?'':pcRowActions(c.status, c.id))+'</div>';
}
function pcSubRow(s){
  const recip=`${t("term.fin.default_payee","默认收款对象")}：`+esc(pcPayeeLabel(s.payee_type_default));
  return '<div class="pc-row'+(s.id===pcState.selSubId?' selected':'')+'" data-id="'+esc(s.id)+'" onclick="pcSelectSub(\''+esc(s.id)+'\')">'+
    '<div class="pc-main"><div class="pc-name" title="'+esc(s.name)+'">'+esc(s.name)+'</div>'+
    '<div class="pc-code" title="'+esc(s.code)+'">'+esc(s.code)+'</div>'+
    '<div class="pc-meta">'+recip+'</div></div>'+
    pcStatusBadge(s.status)+(pcState.readOnly?'':pcSubRowActions(s.status, s.id))+'</div>';
}
function pcMapRow(m){
  const srcLabel=pcSrcLabel(m.source_type);
  const feeLabel=pcFeeLabel(m.fee_type)+'（'+m.fee_type+'）';
  return '<div class="pc-row" data-id="'+esc(m.id)+'">'+
    '<div class="pc-main"><div class="pc-name" title="'+esc(srcLabel)+'">'+esc(srcLabel)+
      ' <span class="pc-code-inline">'+esc(m.source_type)+'</span></div>'+
      '<div class="pc-code" title="'+esc(feeLabel)+`">${t("col.expense_event","费用事件")}：`+esc(feeLabel)+'</div></div>'+
    pcStatusBadge(m.status)+(pcState.readOnly?'':pcMapRowActions(m.status,m.id))+'</div>';
}
function pcStatusBadge(status){
  return status==='active'
    ? `<span class="status-badge status-normal">${t("action.enable","启用")}</span>`
    : `<span class="status-badge status-disabled">${t("action.disable","停用")}</span>`;
}
// 已启用只显示「停用」，已停用只显示「启用」；绝不出现删除 / 垃圾桶按钮。点击不触发行选中。
// 仅左栏大类行传入 id → 真实 编辑/启停；中/右栏无 id → 仍走 pcStub()（后续开放）。
function pcRowActions(status, id){
  const editFn = id ? 'pcOpenCategoryModal(\''+esc(id)+'\')' : 'pcStub()';
  const toggleFn = id ? 'pcToggleCategory(\''+esc(id)+'\')' : 'pcStub()';
  return '<div class="pc-actions"><button class="pc-edit" onclick="event.stopPropagation();'+editFn+`">${t("action.edit","编辑")}</button>`+
    (status==='active'
      ? '<button class="pc-toggle" onclick="event.stopPropagation();'+toggleFn+`">${t("action.disable","停用")}</button>`
      : '<button class="pc-toggle" onclick="event.stopPropagation();'+toggleFn+`">${t("action.enable","启用")}</button>`)+'</div>';
}
function pcSubRowActions(status, id){
  return '<div class="pc-actions"><button class="pc-edit" onclick="event.stopPropagation();pcOpenSubModal(\''+esc(id)+`\')">${t("action.edit","编辑")}</button>`+
    (status==='active'
      ? '<button class="pc-toggle" onclick="event.stopPropagation();pcToggleSub(\''+esc(id)+`\')">${t("action.disable","停用")}</button>`
      : '<button class="pc-toggle" onclick="event.stopPropagation();pcToggleSub(\''+esc(id)+`\')">${t("action.enable","启用")}</button>`)+'</div>';
}
function pcMapRowActions(status,id){
  return '<div class="pc-actions">'+(status==='active'
    ? '<button class="pc-toggle" onclick="event.stopPropagation();pcToggleMap(\''+esc(id)+`\')">${t("action.disable","停用")}</button>`
    : '<button class="pc-toggle" onclick="event.stopPropagation();pcToggleMap(\''+esc(id)+`\')">${t("action.enable","启用")}</button>`)+'</div>';
}
function pcHint(){
  return `<div class="pc-hint">${t("term.fin.same_valid","同一个有效的")}「<b>${t("col.source_type","来源类型")} + ${t("col.expense_type","费用类型")}</b>」，${t("term.fin.map_one_subcategory","只能映射到一个付款小类")}。</div>`;
}
function pcEmpty(msg){ return '<div class="pc-empty"><span class="pc-empty-icon">📭</span>'+esc(msg)+'</div>'; }
function pcError(msg){ return `<div class="pc-empty" style="color:#c0392b"><span class="pc-empty-icon">⚠️</span>${t("term.fin.load_failed","加载失败")}：`+esc(msg)+`<br><button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="renderPaymentCategories()">${t("action.reload","重新加载")}</button></div>`; }
// 本层占位：点击新增 / 编辑 / 启停仅提示，真实提交在 L1B-2-3~2-5 实现
function pcStub(){ showToast(`${t("term.fin.tier_future","该层级功能将在后续开发中开放")}`,'info'); }
function pcShowHelp(){
  openModal(t("app.458", "\u4ed8\u6b3e\u7c7b\u76ee\u7ba1\u7406 \u00b7 \u9875\u9762\u8bf4\u660e"),
    '<div style="font-size:13px;line-height:1.9;color:var(--text-secondary)">'+
    `${t("term.fin.three_tier","本页维护三层结构")}：<br>`+
    `① <b>${t("col.payment_category","付款大类")}</b>（${t("term.fin.eg_goods_payment","如货款")}、${t("term.fin.to_warehouse_cost","到仓费用")}、${t("term.fin.tariff","关税")}）<br>`+
    `② <b>${t("col.payment_subcategory","付款小类")}</b>（${t("term.fin.eg_freight","如运费")}、${t("term.fin.clearance_fee","清关费")}，${t("term.fin.belongs_to_category","归属某个大类")}）<br>`+
    `③ <b>${t("col.source_mapping","来源映射")}</b>（${t("term.fin.subcategory_binding","小类绑定")}「${t("col.source_type","来源类型")} + ${t("col.expense_type","费用类型")}」，${t("term.fin.such_as","如")} CI + freight）<br><br>`+
    `${t("term.fin.rules","规则")}：${t("term.fin.same_valid","同一个有效的")}「${t("col.source_type","来源类型")} + ${t("col.expense_type","费用类型")}」${t("term.fin.map_one_subcategory","只能映射到一个付款小类")}。<br>`+
    `${t("term.fin.disabled_not_in_new","停用项目不会出现在新的付款申请中")}，${t("term.fin.no_impact_history","但不影响历史记录")}。</div>`);
}

// ==================== 付款大类 CRUD（L1B-2-3，仅调 POST /api/payment-categories） ====================
// 打开 新增/编辑 弹窗（id 为空=新增；带 id=编辑并预填真实字段）
function pcOpenCategoryModal(id){
  if(pcState.readOnly) return;                 // 只读守卫：即便 DOM 残留也不打开写弹窗
  pcState.editingId = id || null;
  const isEdit = !!pcState.editingId;
  const c = isEdit ? (pcState.categories.find(x=>x.id===pcState.editingId)||null) : null;
  const name = c?esc(c.name):'';
  const code = c?esc(c.code):'';
  const sort = c?Number(c.sort_order||0):0;
  const status = c?c.status:'active';
  const codeHint = isEdit
    ? `<div class="pc-modal-hint">${t("term.fin.referenced_by_biz","已被业务数据引用的")}code${t("term.fin.cannot_modify","不能修改")}；${t("term.fin.if_referenced","如被引用")}，${t("term.fin.save_prompt","保存时系统会明确提示")}。</div>`
    : `<div class="pc-modal-hint">code${t("term.fin.for_system_link","用于系统关联")}，${t("term.fin.use_snake_case2","建议使用英文小写和下划线")}，${t("term.fin.eg","例如")} warehouse_arrival。</div>`;
  const body =
    '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
      `<div class="form-group form-group-full"><label>${t("col.category_name","大类名称")} <span class="required">*</span></label>`+
        t('gen.L1354.1','<input type="text" id="pc-cat-name" placeholder="\u4f8b\u5982\uff1a\u8d27\u6b3e\u3001\u5230\u4ed3\u8d39\u7528" value="')+name+'"></div>'+
      `<div class="form-group form-group-full"><label>${t("col.sku_category","大类")}code <span class="required">*</span></label>`+
        `<input type="text" id="pc-cat-code" placeholder="${t("term.fin.eg","例如")}：warehouse_arrival" value="`+code+'">'+codeHint+'</div>'+
      `<div class="form-group"><label>${t("col.sort","排序")}</label>`+
        '<input type="number" id="pc-cat-sort" step="1" value="'+sort+`"><div class="pc-modal-hint">${t("term.fin.smaller_first","数字越小越靠前")}</div></div>`+
      `<div class="form-group"><label>${t("col.status","状态")}</label>`+
        '<select id="pc-cat-status"><option value="active"'+(status==='active'?' selected':'')+`>${t("action.enable","启用")}</option>`+
        '<option value="inactive"'+(status==='inactive'?' selected':'')+`>${t("action.disable","停用")}</option></select></div>`+
    '</div>'+
    '<div id="pc-cat-modal-error" class="pc-modal-error" style="display:none"></div></div>';
  const footer=`<button class="btn btn-secondary" onclick="closeModal()">${t("action.cancel","取消")}</button>`+
    `<button class="btn btn-primary" id="pc-cat-save-btn" onclick="pcSaveCategory()">${t("action.save","保存")}</button>`;
  openModal(isEdit?`${t("action.edit_payment_category","编辑付款大类")}`:t("app.470", "\u65b0\u589e\u4ed8\u6b3e\u5927\u7c7b"), body, footer, 'pc-modal');
}

function pcCatModalError(msg){ const el=document.getElementById('pc-cat-modal-error'); if(el){ el.textContent=msg; el.style.display='block'; } }
function pcCatModalErrorClear(){ const el=document.getElementById('pc-cat-modal-error'); if(el){ el.textContent=''; el.style.display='none'; } }

// 专用 POST（不抛出，返回结构化结果，弹窗内优先显示错误；403 固定中文文案）
async function pcFetchJSON(url, method, body, scopeLabel){
  scopeLabel=scopeLabel||t('gen.L1374.1','付款大类');
  const h={'Content-Type':'application/json','Accept-Language':(typeof getLang==='function'?getLang():'zh')};
  const o={method,headers:h,credentials:'same-origin'}; if(body)o.body=JSON.stringify(body);
  try{
    const r=await fetch(url,o);
    if(r.status===401){doLogout(); return {status:401, error:t("app.342", "\u672a\u767b\u5f55\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55")};}
    let d=null; try{d=await r.json();}catch(e){}
    if(r.ok) return {status:r.status, data:d};
    let err=t('gen.L1382.1','服务器错误（')+r.status+'）';
    if(r.status===403) err=t('gen.L1383.1','没有系统配置权限，无法维护')+scopeLabel+'。';
    else if(d&&d.error) err=d.error;
    return {status:r.status, error:err};
  }catch(e){
    return {status:0, error:t("app.471", "\u26a0\ufe0f \u65e0\u6cd5\u8fde\u63a5\u670d\u52a1\u5668\uff08Failed to fetch\uff09\u3002\u8bf7\u786e\u8ba4\u5df2\u8fd0\u884c node server.js \u5e76\u901a\u8fc7 http://localhost:3001 \u8bbf\u95ee\u3002")};
  }
}

// 保存新增/编辑（前端校验 → 提交 → 弹窗内错误 / 成功刷新）
async function pcSaveCategory(){
  if(pcState.readOnly || pcState.saving) return;
  const nameEl=document.getElementById('pc-cat-name');
  const codeEl=document.getElementById('pc-cat-code');
  const sortEl=document.getElementById('pc-cat-sort');
  const statusEl=document.getElementById('pc-cat-status');
  if(!nameEl||!codeEl||!sortEl||!statusEl) return;
  const name=(nameEl.value||'').trim();
  const code=(codeEl.value||'').trim();           // 只 trim 首尾，绝不改/翻译用户输入
  if(!name){ pcCatModalError(`${t("term.fin.category_name_required","大类名称不能为空")}`); return; }
  if(!code){ pcCatModalError(`${t("col.sku_category","大类")}code${t("term.fin.cannot_be_empty","不能为空")}`); return; }
  let sortRaw=(sortEl.value||'').trim();
  let sortOrder=0;
  if(sortRaw!==''){ const n=Number(sortRaw); if(!Number.isInteger(n)){ pcCatModalError(`${t("term.fin.sort_must_integer","排序必须为整数")}`); return; } sortOrder=n; }
  const status=statusEl.value;
  if(!['active','inactive'].includes(status)){ pcCatModalError(`${t("term.fin.invalid_status","状态值无效")}`); return; }
  const body={name,code,sort_order:sortOrder,status};
  if(pcState.editingId) body.id=pcState.editingId;   // 编辑必须携带真实 id
  const btn=document.getElementById('pc-cat-save-btn');
  pcState.saving=true;
  if(btn){ btn.disabled=true; btn.textContent=t("app.476", "\u4fdd\u5b58\u4e2d\u2026"); }
  pcCatModalErrorClear();
  const res=await pcFetchJSON('/api/payment-categories','POST',body);
  pcState.saving=false;
  if(btn){ btn.disabled=false; btn.textContent=t("common.save", "\u4fdd\u5b58"); }
  if(res.status>=200 && res.status<300){
    closeModal();
    if(!pcState.editingId && res.data && res.data.id) pcState.selCatId=res.data.id; // 新增大类优先选中
    await pcLoadAll();
    showToast(pcState.editingId?`${t("term.fin.category_updated","付款大类已更新")}`:t("app.478", "\u4ed8\u6b3e\u5927\u7c7b\u5df2\u521b\u5efa"),'success');
  }else{
    let msg=res.error||t("app.429", "\u4fdd\u5b58\u5931\u8d25");
    if(res.status===403) msg=`${t("term.fin.no_system_config_perm","没有系统配置权限")}，${t("term.fin.cannot_maintain_category","无法维护付款大类")}。`;
    pcCatModalError(msg);                              // 弹窗保持打开，输入不丢失
  }
}

// 启用 / 停用（携带完整必要字段，无物理删除）
async function pcToggleCategory(id){
  if(pcState.readOnly) return;
  const cat=pcState.categories.find(c=>c.id===id); if(!cat) return;
  const willDisable = cat.status==='active';
  const ok = willDisable
    ? confirm(t("app.480", "\u505c\u7528\u540e\uff0c\u8be5\u4ed8\u6b3e\u5927\u7c7b\u53ca\u5176\u5c0f\u7c7b\u4e0d\u4f1a\u51fa\u73b0\u5728\u65b0\u7684\u4ed8\u6b3e\u7533\u8bf7\u9009\u62e9\u4e2d\uff0c\u4f46\u4e0d\u4f1a\u5f71\u54cd\u5386\u53f2\u8bb0\u5f55\u3002\u786e\u8ba4\u505c\u7528\u5417\uff1f"))
    : confirm(t("app.481", "\u786e\u8ba4\u542f\u7528\u8be5\u4ed8\u6b3e\u5927\u7c7b\u5417\uff1f"));
  if(!ok) return;
  if(pcState.toggling) return;
  pcState.toggling=true;
  try{
    const res=await pcFetchJSON('/api/payment-categories','POST',{
      id:cat.id, name:cat.name, code:cat.code, sort_order:cat.sort_order,
      status: willDisable?'inactive':'active'
    });
    if(res.status>=200 && res.status<300){
      pcState.selCatId=cat.id;        // 保持该大类选中（停用后仍显示，不自动跳走）
      await pcLoadAll();
      showToast(willDisable?`${t("term.fin.disabled_category","已停用该付款大类")}`:t("app.483", "\u5df2\u542f\u7528\u8be5\u4ed8\u6b3e\u5927\u7c7b"),'success');
    }else{
      let msg=res.error||`${t("term.fin.operation_failed","操作失败")}`;
      if(res.status===403) msg=`${t("term.fin.no_system_config_perm","没有系统配置权限")}，${t("term.fin.cannot_maintain_category","无法维护付款大类")}。`;
      showToast(msg,'danger');
    }
  }finally{ pcState.toggling=false; }
}

// ==================== 付款主体主数据维护（L2A-2A-3：仅主数据，不接入采购业务链） ====================
let peState = { readOnly: false, saving: false, toggling: false, list: [], countries: [], currencies: [] };

async function renderPayerEntities() {
  peState.readOnly = !hasPermission('system_config');
  document.getElementById('content-inner').innerHTML =
    t('html.renderPayerEntities', `<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🏦 ${t("term.fin.payer_entity_mgmt","付款主体管理")}</div><div class="table-section-actions">{v1}<button class="btn btn-secondary btn-sm" onclick="renderPayerEntities()">🔄 ${t("action.refresh","刷新")}</button></div></div>{v2}<div id="pe-table"></div></div>`, {v1: peState.readOnly ? '' : `<button class="btn btn-primary btn-sm" onclick="peOpenModal()">➕ ${t("action.add_payer_entity","新增付款主体")}</button>`, v2: peState.readOnly ? `<div class="pc-readonly-banner">🔒 ${t("term.fin.readonly_mode","只读模式")}：${t("term.fin.current_account_no","当前账号无")}「${t("term.fin.system_config","系统配置")}」${t("term.fin.permission","权限")}，${t("term.fin.view_only_payer","仅可查看付款主体")}，${t("term.fin.cannot_add","不能新增")} / ${t("action.edit","编辑")} / ${t("action.toggle_enable","启停")}。</div>` : ''});
  try {
    const [list, countries, currencies] = await Promise.all([
      api('/api/payer-entities'),
      api('/api/countries'),
      api('/api/currencies'),
    ]);
    peState.list = list || [];
    peState.countries = countries || [];
    peState.currencies = (currencies || []).filter(c => c.status === 'active');
    peRenderTable(peState.list);
  } catch (e) {
    const t = document.getElementById('pe-table');
    if (t) t.innerHTML = t('html.renderPayerEntities.2', `<div class="empty-state"><div class="empty-icon">⚠️</div>${t("term.fin.load_failed","加载失败")}：{v1}</div>`, {v1: esc(e.message || e)});
  }
}

function peRenderTable(list) {
  const t = document.getElementById('pe-table');
  if (!t) return;
  if (!list.length) {
    t.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div>${t("term.fin.no_payer_data","暂无付款主体数据")}</div>`;
    return;
  }
  const countryName = id => { const c = peState.countries.find(x => x.id === id); return c ? c.name : (id || '-'); };
  const curLabel = code => {
    if (!code) return '<span style="color:#999">—</span>';
    const c = peState.currencies.find(x => x.code === code);
    return esc(code) + (c ? '（' + esc(c.name) + '）' : '');
  };
  t.innerHTML = t('html.peRenderTable', `<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>${t("col.entity_code","主体代码")}</th><th>${t("col.legal_name","法人名称")}</th><th>${t("col.country","所属国家")}</th><th>${t("col.default_currency","默认币种")}</th><th>${t("col.is_default","是否默认")}</th><th>${t("col.status","状态")}</th><th>${t("col.reference_count","引用数量")}</th><th>${t("col.sort","排序")}</th><th>${t("col.actions","操作")}</th></tr></thead><tbody>{v1}</tbody></table></div>`, {v1: list.map(e => '<tr>' +
      '<td><code>'+esc(e.entity_key)+'</code></td>' +
      '<td>'+esc(e.entity_name)+'</td>' +
      '<td>'+esc(countryName(e.country_id))+'</td>' +
      '<td>'+curLabel(e.default_currency)+'</td>' +
      '<td>'+(e.is_default ? t("app.489", "\u2705 \u9ed8\u8ba4") : '—')+'</td>' +
      '<td><span class="status-badge '+(e.status==='active'?'status-normal':'status-warning')+'">'+esc(e.status==='active'?`${t("action.enable","启用")}`:`${t("action.disable","停用")}`)+'</span></td>' +
      '<td class="text-right">'+ (e.ref_count || 0) +'</td>' +
      '<td class="text-right">'+ (e.sort_order || 0) +'</td>' +
      '<td class="cell-actions">' +
        (peState.readOnly ? '' :
          `<button class="action-btn action-edit" title="${t("action.edit","编辑")}" onclick="peOpenModal(\'`+e.id+'\')">✏️</button>' +
          (e.status==='active'
            ? `<button class="action-btn action-delete" title="${t("action.disable","停用")}" onclick="peToggleStatus(\'`+e.id+'\')">⏸️</button>'
            : t('gen.L1507.1','<button class="action-btn action-edit" title="\u542f\u7528" onclick="peToggleStatus(\'')+e.id+'\')">▶️</button>')
        ) +
      '</td>' +
    '</tr>').join('')});
}

function peOpenModal(id) {
  if (peState.readOnly) return;
  const isEdit = !!id;
  const e = isEdit ? (peState.list.find(x => x.id === id) || null) : null;
  const entity_key = e ? e.entity_key : '';
  const entity_name = e ? e.entity_name : '';
  const country_id = e ? e.country_id : '';
  const default_currency = e ? (e.default_currency || '') : '';
  const is_default = e ? (e.is_default ? 1 : 0) : 0;
  const status = e ? e.status : 'active';
  const sort_order = e ? Number(e.sort_order || 0) : 0;
  const refCount = e ? (e.ref_count || 0) : 0;

  const countryOpts = `<option value="">${t("term.fin.please_select_country","请选择国家")}</option>` + peState.countries.map(c =>
    '<option value="'+esc(c.id)+'"'+(c.id===country_id?' selected':'')+'>'+esc(c.name)+'</option>').join('');
  const curOpts = `<option value="">— ${t("enum.not_specified","不指定")} —</option>` + peState.currencies.map(c =>
    '<option value="'+esc(c.code)+'"'+(c.code===default_currency?' selected':'')+'>'+esc(c.code)+'（'+esc(c.name)+'）</option>').join('');

  const keyDisabled = (isEdit && refCount > 0) ? 'disabled' : '';
  const keyHint = isEdit
    ? (refCount > 0
        ? `<div class="pc-modal-hint" style="color:#b26a00">${t("term.fin.payer_code_referenced","该付款主体代码已被业务数据引用")}，${t("term.fin.not_modifiable","不可修改")}。</div>`
        : `<div class="pc-modal-hint">${t("term.fin.entity_code_stable2","实体代码为稳定标识")}；${t("status.no_reference","当前无引用")}，${t("term.fin.allow_modify","允许修改")}。${t("term.fin.locked_when_referenced","一旦被引用将锁定")}。</div>`)
    : `<div class="pc-modal-hint">${t("term.fin.entity_code_stable","实体代码为稳定业务标识")}，${t("term.fin.use_snake_case","建议使用英文小写加下划线")}，${t("term.fin.eg","例如")} id_company_a。</div>`;

  const body = '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">' +
    `<div class="form-group form-group-full"><label>${t("col.payer_code","付款主体代码")}(entity_key) <span class="required">*</span></label>` +
      `<input type="text" id="pe-key" placeholder="${t("term.fin.eg","例如")}：id_company_a" value="`+esc(entity_key)+'" '+keyDisabled+'>'+keyHint+'</div>' +
    `<div class="form-group form-group-full"><label>${t("col.legal_name","法人名称")}(entity_name) <span class="required">*</span></label>` +
      t('gen.L1542.1','<input type="text" id="pe-name" placeholder="\u6cd5\u4eba\u6b63\u5f0f\u540d\u79f0" value="')+esc(entity_name)+'"></div>' +
    `<div class="form-group"><label>${t("col.country","所属国家")} <span class="required">*</span></label>` +
      '<select id="pe-country">'+countryOpts+'</select></div>' +
    `<div class="form-group"><label>${t("col.default_currency","默认币种")}</label>` +
      '<select id="pe-currency">'+curOpts+`</select><div class="pc-modal-hint">${t("term.fin.only_default_hint","仅作为默认提示")}，${t("term.fin.not_override_currency","不覆盖实际付款币种")}。</div></div>` +
    `<div class="form-group"><label>${t("col.is_default","是否默认")}</label>` +
      '<select id="pe-default"><option value="0"'+(is_default?'':' selected')+`>${t("enum.no","否")}</option><option value="1"`+(is_default?' selected':'')+`>${t("enum.yes","是")}（${t("term.fin.country_default_payer","该国默认付款主体")}）</option></select></div>` +
    `<div class="form-group"><label>${t("col.status","状态")}</label>` +
      '<select id="pe-status"><option value="active"'+(status==='active'?' selected':'')+`>${t("action.enable","启用")}</option><option value="inactive"`+(status==='inactive'?' selected':'')+`>${t("action.disable","停用")}</option></select></div>` +
    `<div class="form-group"><label>${t("col.sort","排序")}</label>` +
      '<input type="number" id="pe-sort" step="1" value="'+sort_order+`"><div class="pc-modal-hint">${t("term.fin.smaller_first","数字越小越靠前")}</div></div>` +
    '</div>' +
    '<div id="pe-modal-error" class="pe-modal-error" style="display:none"></div></div>';

  const footer = `<button class="btn btn-secondary" onclick="closeModal()">${t("action.cancel","取消")}</button>` +
    '<button class="btn btn-primary" id="pe-save-btn" onclick="peSave(\''+(id||'')+`\')">${t("action.save","保存")}</button>`;
  openModal(isEdit ? t("app.495", "\u7f16\u8f91\u4ed8\u6b3e\u4e3b\u4f53") : t("app.496", "\u65b0\u589e\u4ed8\u6b3e\u4e3b\u4f53"), body, footer);
}

function peModalError(msg){ const el = document.getElementById('pe-modal-error'); if (el) { el.textContent = msg; el.style.display = 'block'; } }
function peModalErrorClear(){ const el = document.getElementById('pe-modal-error'); if (el) { el.textContent = ''; el.style.display = 'none'; } }

// 专用请求（不抛出，返回结构化结果，弹窗内优先显示错误；403 固定中文文案）
async function peFetchJSON(url, method, body) {
  const h = { 'Content-Type': 'application/json', 'Accept-Language': (typeof getLang === 'function' ? getLang() : 'zh') };
  const o = { method, headers: h, credentials: 'same-origin' }; if (body) o.body = JSON.stringify(body);
  try {
    const r = await fetch(url, o);
    if (r.status === 401) { doLogout(); return { status: 401, error: t("app.342", "\u672a\u767b\u5f55\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55") }; }
    let d = null; try { d = await r.json(); } catch (e) {}
    if (r.ok) return { status: r.status, data: d };
    let err = t('gen.L1573.1','服务器错误（') + r.status + '）';
    if (r.status === 403) err = t('gen.L1574.1','没有系统配置权限，无法维护付款主体。');
    else if (d && d.error) err = d.error;
    return { status: r.status, error: err };
  } catch (e) {
    return { status: 0, error: t("app.471", "\u26a0\ufe0f \u65e0\u6cd5\u8fde\u63a5\u670d\u52a1\u5668\uff08Failed to fetch\uff09\u3002\u8bf7\u786e\u8ba4\u5df2\u8fd0\u884c node server.js \u5e76\u901a\u8fc7 http://localhost:3001 \u8bbf\u95ee\u3002") };
  }
}

async function peSave(id) {
  if (peState.readOnly || peState.saving) return;
  const keyEl = document.getElementById('pe-key');
  const nameEl = document.getElementById('pe-name');
  const countryEl = document.getElementById('pe-country');
  const curEl = document.getElementById('pe-currency');
  const defEl = document.getElementById('pe-default');
  const statusEl = document.getElementById('pe-status');
  const sortEl = document.getElementById('pe-sort');
  if (!keyEl || !nameEl || !countryEl || !curEl || !defEl || !statusEl || !sortEl) return;
  const entity_key = keyEl.value.trim();
  const entity_name = nameEl.value.trim();
  const country_id = countryEl.value;
  const default_currency = curEl.value;
  const is_default = defEl.value === '1' ? 1 : 0;
  const status = statusEl.value;
  let sort_order = 0;
  const sortRaw = (sortEl.value || '').trim();
  if (sortRaw !== '') { const n = Number(sortRaw); if (!Number.isInteger(n)) { peModalError(`${t("term.fin.sort_must_integer","排序必须为整数")}`); return; } sort_order = n; }

  if (!entity_key) { peModalError(`${t("col.payer_code","付款主体代码")}(entity_key)${t("term.fin.cannot_be_empty","不能为空")}`); return; }
  if (!entity_name) { peModalError(`${t("col.legal_name","法人名称")}(entity_name)${t("term.fin.cannot_be_empty","不能为空")}`); return; }
  if (!country_id) { peModalError(`${t("term.fin.please_select_belong_country","请选择所属国家")}`); return; }
  if (!['active', 'inactive'].includes(status)) { peModalError(`${t("term.fin.invalid_status","状态值无效")}`); return; }
  if (is_default === 1 && status === 'inactive') { peModalError(`${t("term.fin.disabled_cannot_default","停用主体不能设为默认")}`); return; }

  const body = { entity_key, entity_name, country_id, default_currency, is_default, status, sort_order };
  const btn = document.getElementById('pe-save-btn');
  peState.saving = true;
  if (btn) { btn.disabled = true; btn.textContent = t("app.476", "\u4fdd\u5b58\u4e2d\u2026"); }
  peModalErrorClear();
  const url = id ? ('/api/payer-entities/' + id) : '/api/payer-entities';
  const method = id ? 'PUT' : 'POST';
  const res = await peFetchJSON(url, method, body);
  peState.saving = false;
  if (btn) { btn.disabled = false; btn.textContent = t("common.save", "\u4fdd\u5b58"); }
  if (res.status >= 200 && res.status < 300) {
    closeModal();
    await renderPayerEntities();
    showToast(id ? t("app.502", "\u4ed8\u6b3e\u4e3b\u4f53\u5df2\u66f4\u65b0") : t("app.503", "\u4ed8\u6b3e\u4e3b\u4f53\u5df2\u521b\u5efa"), 'success');
  } else {
    let msg = res.error || t("app.429", "\u4fdd\u5b58\u5931\u8d25");
    if (res.status === 403) msg = `${t("term.fin.no_system_config_perm","没有系统配置权限")}，${t("term.fin.cannot_maintain_payer","无法维护付款主体")}。`;
    peModalError(msg); // 弹窗保持打开，输入不丢
  }
}

async function peToggleStatus(id) {
  if (peState.readOnly) return;
  const e = peState.list.find(x => x.id === id);
  if (!e) return;
  const willDisable = e.status === 'active';
  const ok = willDisable
    ? confirm(t("app.504", "\u505c\u7528\u540e\uff0c\u8be5\u4ed8\u6b3e\u4e3b\u4f53\u4e0d\u4f1a\u51fa\u73b0\u5728\u65b0\u7684\u4ed8\u6b3e\u7533\u8bf7\u9009\u62e9\u4e2d\uff08\u4e0d\u5f71\u54cd\u5386\u53f2\uff09\u3002\u786e\u8ba4\u505c\u7528\u5417\uff1f"))
    : confirm(t("app.505", "\u786e\u8ba4\u542f\u7528\u8be5\u4ed8\u6b3e\u4e3b\u4f53\u5417\uff1f"));
  if (!ok) return;
  if (peState.toggling) return;
  peState.toggling = true;
  try {
    const res = await peFetchJSON('/api/payer-entities/' + id + '/status', 'POST', { status: willDisable ? 'inactive' : 'active' });
    if (res.status >= 200 && res.status < 300) {
      await renderPayerEntities();
      showToast(willDisable ? t("app.506", "\u5df2\u505c\u7528\u8be5\u4ed8\u6b3e\u4e3b\u4f53") : t("app.507", "\u5df2\u542f\u7528\u8be5\u4ed8\u6b3e\u4e3b\u4f53"), 'success');
    } else {
      let msg = res.error || `${t("term.fin.operation_failed","操作失败")}`;
      if (res.status === 403) msg = `${t("term.fin.no_system_config_perm","没有系统配置权限")}，${t("term.fin.cannot_maintain_payer","无法维护付款主体")}。`;
      showToast(msg, 'danger');
    }
  } finally { peState.toggling = false; }
}

// ==================== 付款小类 CRUD（L1B-2-4，仅调 POST /api/payment-subcategories） ====================
function pcSubModalError(msg){ const el=document.getElementById('pc-sub-modal-error'); if(el){ el.textContent=msg; el.style.display='block'; } }
function pcSubModalErrorClear(){ const el=document.getElementById('pc-sub-modal-error'); if(el){ el.textContent=''; el.style.display='none'; } }
function pcUpdateSubCatInactiveHint(){
  const sel=document.getElementById('pc-sub-category');
  const hint=document.getElementById('pc-sub-cat-inactive-hint');
  if(!sel||!hint) return;
  const cat=pcCatById(sel.value);
  hint.style.display=cat&&cat.status==='inactive'?'block':'none';
}
function pcOpenSubModal(id){
  if(pcState.readOnly) return;
  pcState.editingSubId=id||null;
  const isEdit=!!pcState.editingSubId;
  const sub=isEdit?(pcState.subcategories.find(s=>s.id===pcState.editingSubId)||null):null;
  if(isEdit&&!sub){showToast(t('gen.L1668.1','付款小类不存在'),'danger');return;}
  const currentCat=isEdit?pcCatById(sub.category_id):(pcCatById(pcState.selCatId)||pcActiveFirst(pcState.categories));
  const catValue=currentCat?currentCat.id:'';
  const catOptions=t('gen.L1671.1','<option value="">请选择付款大类</option>')+pcState.categories.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===catValue?' selected':'')+'>'+esc(pcCatLabel(c))+'</option>').join('');
  const catHtml=isEdit
    ? t('gen.L1673.1','<div class="form-group form-group-full"><label>所属付款大类</label><input type="text" value="')+esc(pcCatLabel(currentCat))+t('gen.L1673.2','" readonly><div class="pc-modal-hint">编辑状态下不允许移动小类到其他大类。</div>')+(currentCat&&currentCat.status==='inactive'?t('gen.L1673.3','<div class="pc-modal-hint" style="color:#b26a00">该付款大类当前已停用，新小类不会出现在新的付款申请中。</div>'):'')+'</div>'
    : t('gen.L1674.1','<div class="form-group form-group-full"><label>所属付款大类 <span class="required">*</span></label><select id="pc-sub-category" onchange="pcUpdateSubCatInactiveHint()">')+catOptions+t('gen.L1674.2','</select><div id="pc-sub-cat-inactive-hint" class="pc-modal-hint" style="display:none;color:#b26a00">该付款大类当前已停用，新小类不会出现在新的付款申请中。</div></div>');
  const codeHint=isEdit
    ? t('gen.L1676.1','<div class="pc-modal-hint">已被业务数据引用的code不能修改；如被引用，保存时系统会明确提示。</div>')
    : t('gen.L1677.1','<div class="pc-modal-hint">code用于系统关联，建议使用英文小写和下划线，例如 customs_clearance。</div>');
  const body='<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
    catHtml+
    t('gen.L1680.1','<div class="form-group form-group-full"><label>小类名称 <span class="required">*</span></label><input type="text" id="pc-sub-name" placeholder="\u4f8b\u5982\uff1a\u5b9a\u91d1\u3001\u5c3e\u6b3e\u3001\u8fd0\u8d39\u3001\u6e05\u5173\u8d39" value="')+esc(sub?sub.name:'')+'"></div>'+
    t('gen.L1681.1','<div class="form-group form-group-full"><label>小类code <span class="required">*</span></label><input type="text" id="pc-sub-code" placeholder="例如：customs_clearance" value="')+esc(sub?sub.code:'')+'">'+codeHint+'</div>'+
    t('gen.L1682.1','<div class="form-group"><label>默认收款对象类型</label><select id="pc-sub-payee">')+pcPayeeOptions(sub?sub.payee_type_default:'')+'</select></div>'+
    t('gen.L1683.1','<div class="form-group"><label>排序</label><input type="number" id="pc-sub-sort" step="1" value="')+(sub?Number(sub.sort_order||0):0)+t('gen.L1683.2','"><div class="pc-modal-hint">数字越小越靠前</div></div>')+
    t('gen.L1684.1','<div class="form-group"><label>状态</label><select id="pc-sub-status"><option value="active"')+((sub?sub.status:'active')==='active'?' selected':'')+t('gen.L1684.2','>启用</option><option value="inactive"')+((sub?sub.status:'active')==='inactive'?' selected':'')+t('gen.L1684.3','>停用</option></select></div>')+
    '</div><div id="pc-sub-modal-error" class="pc-modal-error" style="display:none"></div></div>';
  const footer=t('gen.L1686.1','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="pc-sub-save-btn" onclick="pcSaveSub()">保存</button>');
  openModal(isEdit?t('gen.L1687.1','编辑付款小类'):t("app.516", "\u65b0\u589e\u4ed8\u6b3e\u5c0f\u7c7b"),body,footer,'pc-modal');
  if(!isEdit) pcUpdateSubCatInactiveHint();
}
async function pcSaveSub(){
  if(pcState.readOnly||pcState.savingSub) return;
  const isEdit=!!pcState.editingSubId;
  const sub=isEdit?(pcState.subcategories.find(s=>s.id===pcState.editingSubId)||null):null;
  const catId=isEdit?(sub?sub.category_id:''):(document.getElementById('pc-sub-category')?.value||'');
  const name=(document.getElementById('pc-sub-name')?.value||'').trim();
  const code=(document.getElementById('pc-sub-code')?.value||'').trim();
  const payee=document.getElementById('pc-sub-payee')?.value||'';
  const sortRaw=(document.getElementById('pc-sub-sort')?.value||'').trim();
  const status=document.getElementById('pc-sub-status')?.value||'active';
  if(!catId){pcSubModalError(t('gen.L1700.1','所属付款大类不能为空'));return;}
  if(!name){pcSubModalError(t('gen.L1701.1','小类名称不能为空'));return;}
  if(!code){pcSubModalError(t('gen.L1702.1','小类code不能为空'));return;}
  let sortOrder=0;
  if(sortRaw!==''){const n=Number(sortRaw);if(!Number.isInteger(n)){pcSubModalError(t('gen.L1704.1','排序必须为整数'));return;}sortOrder=n;}
  if(!['active','inactive'].includes(status)){pcSubModalError(t('gen.L1705.1','status无效'));return;}
  const body={category_id:catId,name,code,payee_type_default:payee,sort_order:sortOrder,status};
  if(isEdit) body.id=pcState.editingSubId;
  const btn=document.getElementById('pc-sub-save-btn');
  pcState.savingSub=true;
  if(btn){btn.disabled=true;btn.textContent=t("app.476", "\u4fdd\u5b58\u4e2d\u2026");}
  pcSubModalErrorClear();
  const res=await pcFetchJSON('/api/payment-subcategories','POST',body,t("shell.033", "\u4ed8\u6b3e\u5c0f\u7c7b"));
  pcState.savingSub=false;
  if(btn){btn.disabled=false;btn.textContent=t("common.save", "\u4fdd\u5b58");}
  if(res.status>=200&&res.status<300){
    closeModal();
    pcState.selCatId=catId;
    if(isEdit) pcState.selSubId=pcState.editingSubId;
    else if(res.data&&res.data.id) pcState.selSubId=res.data.id;
    await pcLoadAll();
    showToast(isEdit?t('gen.L1721.1','付款小类已更新'):t("app.522", "\u4ed8\u6b3e\u5c0f\u7c7b\u5df2\u521b\u5efa"),'success');
  }else{
    let msg=res.error||t("app.429", "\u4fdd\u5b58\u5931\u8d25");
    if(res.status===403) msg=t('gen.L1724.1','没有系统配置权限，无法维护付款小类。');
    pcSubModalError(msg);
  }
}
async function pcToggleSub(id){
  if(pcState.readOnly) return;
  const sub=pcState.subcategories.find(s=>s.id===id); if(!sub) return;
  const willDisable=sub.status==='active';
  const ok=willDisable
    ? confirm(t("app.524", "\u505c\u7528\u540e\uff0c\u8be5\u4ed8\u6b3e\u5c0f\u7c7b\u4e0d\u4f1a\u51fa\u73b0\u5728\u65b0\u7684\u4ed8\u6b3e\u7533\u8bf7\u9009\u62e9\u4e2d\uff0c\u4f46\u4e0d\u4f1a\u5f71\u54cd\u5386\u53f2\u8bb0\u5f55\u548c\u5df2\u6709\u6765\u6e90\u6620\u5c04\u3002\u786e\u8ba4\u505c\u7528\u5417\uff1f"))
    : confirm(t("app.525", "\u786e\u8ba4\u542f\u7528\u8be5\u4ed8\u6b3e\u5c0f\u7c7b\u5417\uff1f"));
  if(!ok||pcState.togglingSub) return;
  pcState.togglingSub=true;
  try{
    const res=await pcFetchJSON('/api/payment-subcategories','POST',{
      id:sub.id,
      category_id:sub.category_id,
      name:sub.name,
      code:sub.code,
      payee_type_default:sub.payee_type_default||'',
      sort_order:sub.sort_order||0,
      status:willDisable?'inactive':'active'
    },t("shell.033", "\u4ed8\u6b3e\u5c0f\u7c7b"));
    if(res.status>=200&&res.status<300){
      pcState.selCatId=sub.category_id;
      pcState.selSubId=sub.id;
      await pcLoadAll();
      showToast(willDisable?t('gen.L1751.1','已停用该付款小类'):t("app.527", "\u5df2\u542f\u7528\u8be5\u4ed8\u6b3e\u5c0f\u7c7b"),'success');
    }else{
      let msg=res.error||t('gen.L1753.1','操作失败');
      if(res.status===403) msg=t('gen.L1754.1','没有系统配置权限，无法维护付款小类。');
      showToast(msg,'danger');
    }
  }finally{pcState.togglingSub=false;}
}

// ==================== 来源映射新增 / 启用 / 停用（L1B-2-5C） ====================
function pcMapModalError(msg){
  const el=document.getElementById('pc-map-modal-error');
  if(el){el.textContent=msg;el.style.display='block';}
}
function pcMapModalErrorClear(){
  const el=document.getElementById('pc-map-modal-error');
  if(el){el.textContent='';el.style.display='none';}
}
function pcMapFeeOptions(sourceType,selected){
  const allowed=PC_SOURCE_FEE_MATRIX[sourceType]||[];
  if(!allowed.length) return t('gen.L1771.1','<option value="">请先选择来源类型</option>');
  return t('gen.L1772.1','<option value="">请选择费用事件</option>')+allowed.map(code=>
    '<option value="'+esc(code)+'"'+(selected===code?' selected':'')+'>'+esc(pcFeeLabel(code)+'（'+code+'）')+'</option>'
  ).join('');
}
function pcUpdateMapFeeOptions(){
  const sourceEl=document.getElementById('pc-map-source');
  const feeEl=document.getElementById('pc-map-fee');
  if(!sourceEl||!feeEl) return;
  feeEl.innerHTML=pcMapFeeOptions(sourceEl.value,'');
  feeEl.disabled=!sourceEl.value;
  pcMapModalErrorClear();
}
function pcOpenMapModal(){
  if(pcState.readOnly||!hasPermission('system_config')) return;
  const cat=pcCatById(pcState.selCatId);
  const sub=pcState.subcategories.find(s=>s.id===pcState.selSubId&&s.category_id===pcState.selCatId)||null;
  if(!cat){showToast(t('gen.L1788.1','请先选择付款大类'),'warning');return;}
  if(!sub){showToast(t('gen.L1789.1','请先选择付款小类'),'warning');return;}
  const inactiveReasons=[];
  if(cat.status!=='active') inactiveReasons.push(t('gen.L1791.1','所属一级类目“')+pcCatLabel(cat)+t('gen.L1791.2','”已停用'));
  if(sub.status!=='active') inactiveReasons.push(t('gen.L1792.1','所属二级类目“')+sub.name+'（'+sub.code+t('gen.L1792.2','）”已停用'));
  const parentInactive=inactiveReasons.length>0;
  const statusHtml=parentInactive
    ? t('gen.L1795.1','<select id="pc-map-status" disabled><option value="inactive" selected>停用</option></select>')+
      '<div class="pc-modal-hint" style="color:#b26a00">'+esc(inactiveReasons.join('；'))+t('gen.L1796.1','。该映射只能保存为停用状态，暂时不会进入新的付款业务；父级重新启用后，需要手动启用该映射。</div>')
    : t('gen.L1797.1','<select id="pc-map-status"><option value="active" selected>启用</option><option value="inactive">停用</option></select>');
  const body='<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
    t('gen.L1799.1','<div class="form-group form-group-full"><label>所属一级类目</label><input type="text" value="')+esc(pcCatLabel(cat))+'" readonly></div>'+
    t('gen.L1800.1','<div class="form-group form-group-full"><label>所属二级类目</label><input type="text" value="')+esc(sub.name+'（'+sub.code+'）')+'" readonly></div>'+
    t('gen.L1801.1','<div class="form-group"><label>来源类型 <span class="required">*</span></label><select id="pc-map-source" onchange="pcUpdateMapFeeOptions()">')+
      t('gen.L1802.1','<option value="">请选择来源类型</option><option value="pi">PI（pi）</option><option value="ci">CI（ci）</option><option value="manual">手动录入（manual）</option></select></div>')+
    t('gen.L1803.1','<div class="form-group"><label>费用事件 <span class="required">*</span></label><select id="pc-map-fee" disabled>')+pcMapFeeOptions('','')+'</select></div>'+
    t('gen.L1804.1','<div class="form-group form-group-full"><label>状态</label>')+statusHtml+'</div>'+
    t('gen.L1805.1','</div><div class="pc-modal-hint" style="margin-top:12px">来源映射仅决定业务来源对应的付款小类；成本、分摊、统计和预测规则将在相关模块中单独配置。</div>')+
    '<div id="pc-map-modal-error" class="pc-modal-error" style="display:none"></div></div>';
  const footer=t('gen.L1807.1','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="pc-map-save-btn" onclick="pcSaveMap()">保存</button>');
  openModal(t("app.535", "\u65b0\u589e\u6765\u6e90\u6620\u5c04"),body,footer,'pc-modal');
}
async function pcSaveMap(){
  if(pcState.readOnly||!hasPermission('system_config')||pcState.savingMap) return;
  const cat=pcCatById(pcState.selCatId);
  const sub=pcState.subcategories.find(s=>s.id===pcState.selSubId&&s.category_id===pcState.selCatId)||null;
  if(!cat){pcMapModalError(t('gen.L1814.1','当前付款大类不存在，请关闭弹窗后重新选择'));return;}
  if(!sub){pcMapModalError(t('gen.L1815.1','当前付款小类不存在，请关闭弹窗后重新选择'));return;}
  const sourceType=document.getElementById('pc-map-source')?.value||'';
  const feeType=document.getElementById('pc-map-fee')?.value||'';
  const status=document.getElementById('pc-map-status')?.value||'';
  if(!sourceType){pcMapModalError(t('gen.L1819.1','请选择来源类型'));return;}
  if(!feeType){pcMapModalError(t('gen.L1820.1','请选择费用事件'));return;}
  if(!PC_SOURCE_FEE_MATRIX[sourceType]||!PC_SOURCE_FEE_MATRIX[sourceType].includes(feeType)){
    pcMapModalError(pcSrcLabel(sourceType)+'（'+sourceType+t("app.538", "\uff09\u4e0d\u652f\u6301\u8d39\u7528\u4e8b\u4ef6")+feeType);return;
  }
  if(!['active','inactive'].includes(status)){pcMapModalError(t('gen.L1824.1','状态值无效'));return;}
  if((cat.status!=='active'||sub.status!=='active')&&status!=='inactive'){
    pcMapModalError(t('gen.L1826.1','所属一级类目或二级类目已停用，来源映射只能保存为停用状态'));return;
  }
  pcMapModalErrorClear();
  pcState.savingMap=true;
  const btn=document.getElementById('pc-map-save-btn');
  if(btn){btn.disabled=true;btn.textContent=t("app.476", "\u4fdd\u5b58\u4e2d\u2026");}
  const catId=cat.id;
  const subId=sub.id;
  const res=await pcFetchJSON('/api/payment-subcategory-sources','POST',{
    subcategory_id:sub.id,source_type:sourceType,fee_type:feeType,status
  },t("shell.035", "\u6765\u6e90\u6620\u5c04"));
  pcState.savingMap=false;
  const liveBtn=document.getElementById('pc-map-save-btn');
  if(liveBtn){liveBtn.disabled=false;liveBtn.textContent=t("common.save", "\u4fdd\u5b58");}
  if(res.status>=200&&res.status<300){
    closeModal();
    pcState.selCatId=catId;
    pcState.selSubId=subId;
    await pcLoadAll();
    showToast(t('gen.L1845.1','来源映射已创建'),'success');
  }else{
    pcMapModalError(res.error||t('gen.L1847.1','保存失败'));
  }
}
async function pcToggleMap(id){
  if(pcState.readOnly||!hasPermission('system_config')||pcState.togglingMap) return;
  const mapping=pcState.sources.find(m=>m.id===id);
  if(!mapping) return;
  const sub=pcState.subcategories.find(s=>s.id===mapping.subcategory_id)||null;
  if(!sub||sub.id!==pcState.selSubId) return;
  const cat=pcCatById(sub.category_id);
  if(!cat||cat.id!==pcState.selCatId) return;
  const willDisable=mapping.status==='active';
  const ok=willDisable
    ? confirm(t("app.541", "\u505c\u7528\u540e\uff0c\u8be5\u6620\u5c04\u5c06\u4e0d\u518d\u51fa\u73b0\u5728\u542f\u7528\u914d\u7f6e\u4e2d\uff1b\u4f46\u73b0\u6709\u65e7\u4ed8\u6b3e\u5165\u53e3\u5c1a\u672a\u63a5\u5165\u6765\u6e90\u6620\u5c04\uff0c\u4ecd\u53ef\u80fd\u7ee7\u7eed\u751f\u6210\u5bf9\u5e94\u4ed8\u6b3e\u3002\u786e\u8ba4\u505c\u7528\u5417\uff1f"))
    : confirm(t("app.542", "\u786e\u8ba4\u542f\u7528\u8be5\u6765\u6e90\u6620\u5c04\u5417\uff1f"));
  if(!ok) return;
  pcState.togglingMap=true;
  try{
    const res=await pcFetchJSON('/api/payment-subcategory-sources','POST',{
      id:mapping.id,
      subcategory_id:mapping.subcategory_id,
      source_type:mapping.source_type,
      fee_type:mapping.fee_type,
      status:willDisable?'inactive':'active'
    },t("shell.035", "\u6765\u6e90\u6620\u5c04"));
    if(res.status>=200&&res.status<300){
      pcState.selCatId=cat.id;
      pcState.selSubId=sub.id;
      await pcLoadAll();
      showToast(willDisable?t('gen.L1876.1','来源映射已停用'):t("app.544", "\u6765\u6e90\u6620\u5c04\u5df2\u542f\u7528"),'success');
    }else{
      showToast(res.error||t('gen.L1878.1','操作失败'),'danger');
    }
  }finally{pcState.togglingMap=false;}
}

// ==================== 操作日志 ====================
async function renderOperationLogs(){
  document.getElementById('content-inner').innerHTML=`<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📝 ${t("term.fin.operation_log","操作日志")}</div><div class="table-section-actions"><button class="btn btn-secondary btn-sm" onclick="renderOperationLogs()">🔄 ${t("action.refresh","刷新")}</button></div></div><div id="op-logs-table"></div></div>`;
  try{
    const data=await api('/api/operation-logs?page=&limit=100');
    const rows=Array.isArray(data)?data:(data.rows||data.data||[]);
    const html=!rows.length?`<div class="empty-state"><div class="empty-icon">📝</div>${t("term.fin.no_operation_log","暂无操作日志")}</div>`:`<div class="table-container" style="box-shadow:none;border-radius:0;max-height:600px;overflow:auto"><table class="data-table"><thead><tr><th>${t("col.time","时间")}</th><th>${t("col.operator","操作人")}</th><th>${t("term.fin.page","页面")}</th><th>${t("col.operation_type","操作类型")}</th><th>${t("col.affected_count","影响数量")}</th><th>${t("col.reason","原因")}</th></tr></thead><tbody>`+rows.map(r=>'<tr><td class="cell-date">'+esc((r.created_at||'').replace('T',' ').slice(0,19))+'</td><td>'+esc(r.operator_name||'-')+'</td><td>'+esc(r.page||'-')+'</td><td>'+esc(r.operation_type||'-')+'</td><td class="text-right">'+(r.affected_count||0)+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.reason||'')+'">'+esc(r.reason||'-')+'</td></tr>').join('')+'</tbody></table></div>';
    document.getElementById('op-logs-table').innerHTML=html;
  }catch(e){showFlash(e.message,'danger')}
}
async function renderSKUs(){
  // 动态从已有SKU中提取品牌、生命周期、状态选项
  let brandOpts = t('gen.L1895.1','<option value="">全部品牌</option>');
  let lcOpts = t('gen.L1896.1','<option value="">全部生命周期</option>');
  let stOpts = t('gen.L1897.1','<option value="">全部状态</option>');
  try {
    const all = await api('/api/skus');
    const brands = [...new Set(all.map(s => s.brand).filter(b => b && b.trim()))].sort();
    brands.forEach(b => { brandOpts += '<option value="' + esc(b) + '">' + esc(b) + '</option>'; });
    const lcLabels = {'new_test':t("app.547", "\u65b0\u54c1\u5bfc\u5165"),'new_launch':t("app.548", "\u65b0\u54c1\u542f\u52a8"),'growth':t("app.549", "\u6210\u957f\u671f"),'stable':t("app.550", "\u6210\u719f\u671f"),'slow':t("app.551", "\u8870\u9000\u671f"),'stagnant':t("app.552", "\u6ede\u9500"),'clearance':t("app.553", "\u6e05\u4ed3\u671f"),'stopped':t("app.554", "\u505c\u91c7/\u505c\u4ea7"),'discontinued':t("app.554", "\u505c\u91c7/\u505c\u4ea7")};
    const lifecycles = [...new Set(all.map(s => s.lifecycle_status).filter(l => l))].sort();
    lifecycles.forEach(l => { lcOpts += '<option value="' + l + '">' + (lcLabels[l] || l) + '</option>'; });
    const statuses = [...new Set(all.map(s => s.status).filter(s => s))].sort();
    const stLabels = {'normal':t("common.enable", "\u542f\u7528"),'stopped':t("common.disable", "\u505c\u7528"),'clearance':t("app.555", "\u6e05\u4ed3"),'discontinued':t("app.556", "\u505c\u4ea7")};
    statuses.forEach(s => { stOpts += '<option value="' + s + '">' + (stLabels[s] || s) + '</option>'; });
  } catch(e) { /* fallback to static options below */ }
  // 兜底：如果数据库为空，给出常用选项
  if (brandOpts === '<option value="">全部品牌</option>') {
    brandOpts += '<option value="Redragon">Redragon</option><option value="Logitech">Logitech</option><option value="Razer">Razer</option><option value="CoolerMaster">CoolerMaster</option>';
  }
  if (lcOpts === '<option value="">全部生命周期</option>') {
    lcOpts += t('gen.L1914.1','<option value="new_test">新品导入</option><option value="new_launch">新品启动</option><option value="growth">成长期</option><option value="stable">成熟期</option><option value="slow">衰退期</option><option value="stagnant">滞销</option><option value="clearance">清仓期</option><option value="stopped">停采/停产</option>');
  }
  if (stOpts === '<option value="">全部状态</option>') {
    stOpts += t('gen.L1917.1','<option value="normal">启用</option><option value="stopped">停用</option><option value="clearance">清仓</option><option value="discontinued">停产</option>');
  }
  document.getElementById('content-inner').innerHTML=t('html.renderSKUs', `<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>关键词</label><input type="text" id="sku-kw" placeholder="SKU/产品名/Model/EAN" onkeypress="if(event.key==='Enter')loadSKUs()"></div><div class="filter-group"><label>品牌</label><select id="sku-brand">{v1}</select></div><div class="filter-group"><label>状态</label><select id="sku-st">{v2}</select></div><div class="filter-group"><label>生命周期</label><select id="sku-lc">{v3}</select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadSKUs()">搜索</button></div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🏷️ SKU列表</div><div class="table-section-actions"><div style="position:relative;display:inline-block">{v4}</div>{v5}</div></div><div id="sku-batch-bar" style="display:none"></div><div id="sku-table"></div></div>`, {v1: brandOpts, v2: stOpts, v3: lcOpts, v4: hasPermission('sku_import')?t('gen.L1919.1','<button class="btn btn-secondary btn-sm" id="sku-import-trigger" onclick="toggleSkuImportMenu(event)">📥 导入/更新SKU ▾</button>'):'', v5: hasPermission('sku_create')?t('gen.L1919.2','<button class="btn btn-primary btn-sm" onclick="editSKU()">➕ 新增SKU</button>'):''});
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
    t('gen.L1932.1','<div style="padding:8px 16px;cursor:pointer;font-size:13px;border-bottom:1px solid #f0f0f0" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'#fff\'" onclick="toggleSkuImportMenu();openSkuBatchImport()">📥 新增/更新导入</div>')+
    t('gen.L1933.1','<div style="padding:8px 16px;cursor:pointer;font-size:13px" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'#fff\'" onclick="toggleSkuImportMenu();showSkuImportRecords()">📋 查看导入记录</div>');
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
  openModal(t("po.004", "SKU\u5bfc\u5165\u8bb0\u5f55"),
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      t('gen.L1963.1','<div id="sku-import-records-list" style="min-height:100px"><div style="text-align:center;color:#999;padding:20px">加载中...</div></div>')+
    '</div>',
    t('gen.L1965.1','<button class="btn btn-secondary" onclick="closeModal()">关闭</button>')
  );
  // 简单展示当前SKU统计
  api('/api/skus?keyword=').then(function(data){
    var html=t('gen.L1969.1','<div style="background:#f0f8ff;padding:14px;border-radius:6px;margin-bottom:12px;font-size:13px"><b>当前SKU主数据概况</b></div>');
    html+=t('gen.L1970.1','<div class="table-container" style="box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>指标</th><th>数量</th></tr></thead><tbody>');
    html+=t('gen.L1971.1','<tr><td>SKU总数</td><td class="text-right font-bold">')+data.length+'</td></tr>';
    html+=t('gen.L1972.1','<tr><td>启用状态</td><td class="text-right">')+data.filter(function(s){return s.status==='normal'}).length+'</td></tr>';
    html+=t('gen.L1973.1','<tr><td>停用状态</td><td class="text-right">')+data.filter(function(s){return s.status==='stopped'||s.status==='discontinued'}).length+'</td></tr>';
    html+=t('gen.L1974.1','<tr><td>清仓状态</td><td class="text-right">')+data.filter(function(s){return s.status==='clearance'}).length+'</td></tr>';
    html+=t('gen.L1975.1','<tr><td>有品牌</td><td class="text-right">')+data.filter(function(s){return s.brand&&s.brand.trim()}).length+'</td></tr>';
    html+=t('gen.L1976.1','<tr><td>有EAN/条码</td><td class="text-right">')+data.filter(function(s){return s.barcode&&s.barcode.trim()}).length+'</td></tr>';
    html+='</tbody></table></div>';
    html+=t('gen.L1978.1','<div style="margin-top:12px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666">💡 导入说明：使用"新增/更新导入"功能上传Excel，系统会自动根据SKU编码判断是新增还是更新。SKU编码已存在则更新，不存在则新增。</div>');
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
    var lcLabels={'new_test':t('gen.L1991.1','新品导入'),'new_launch':t("app.548", "\u65b0\u54c1\u542f\u52a8"),'growth':t("app.549", "\u6210\u957f\u671f"),'stable':t("app.550", "\u6210\u719f\u671f"),'slow':t("app.551", "\u8870\u9000\u671f"),'stagnant':t("app.552", "\u6ede\u9500"),'clearance':t("app.553", "\u6e05\u4ed3\u671f"),'stopped':t("app.554", "\u505c\u91c7/\u505c\u4ea7"),'discontinued':t("app.554", "\u505c\u91c7/\u505c\u4ea7")};
    var lcBadge={'new_test':'status-pending','new_launch':'status-pending','growth':'status-info','stable':'status-normal','slow':'status-warning','stagnant':'status-warning','clearance':'status-warning','stopped':'status-danger','discontinued':'status-danger'};
    var thead='<thead><tr>'+
      '<th style="width:36px"><input type="checkbox" onchange="toggleAllSku(this)"></th>'+
      t('gen.L1995.1','<th>品牌</th><th>Category</th><th>Model</th><th>SKU</th><th>产品名称</th><th>EAN</th>')+
      t('gen.L1996.1','<th>状态</th><th>生命周期</th><th>是否停采</th><th>创建时间</th><th>更新时间</th><th>操作</th>')+
      '</tr></thead>';
    var tbody=data.map(function(s){
        var isEnabled=s.status==='normal';
        var isStopped=s.status==='stopped'||s.status==='discontinued';
        var lcText=lcLabels[s.lifecycle_status]||t("app.570", "\u672a\u5224\u65ad");
        var lcCls=lcBadge[s.lifecycle_status]||'status-pending';
        return '<tr id="sku-row-'+s.id+'">'+
          '<td><input type="checkbox" class="sku-checkbox" value="'+s.id+'" onchange="onSkuCheckChange()"></td>'+
          '<td>'+esc(s.brand||'-')+'</td>'+
          '<td>'+esc(s.category||'-')+'</td>'+
          '<td>'+esc(s.model||'-')+'</td>'+
          '<td class="cell-id">'+esc(s.sku_code)+'</td>'+
          '<td>'+esc(s.product_name||'-')+'</td>'+
          '<td>'+esc(s.barcode||'-')+'</td>'+
          '<td><span class="status-badge '+(isEnabled?'status-normal':'status-danger')+'">'+(isEnabled?t('gen.L2011.1','启用'):t("common.disable", "\u505c\u7528"))+'</span></td>'+
          '<td><span class="status-badge '+lcCls+'">'+lcText+'</span></td>'+
          '<td>'+(isStopped?t('gen.L2013.1','<span style="color:#ff4d4f">是</span>'):t("action.no", "否"))+'</td>'+
          '<td class="cell-date">'+(s.created_at||'').slice(0,19)+'</td>'+
          '<td class="cell-date">'+(s.updated_at||'').slice(0,19)+'</td>'+
          '<td class="cell-actions">'+(hasPermission('sku_edit')?'<button class="action-btn action-edit" onclick="editSKU(\''+s.id+'\')">✏️</button>':'')+(hasPermission('sku_delete')?'<button class="action-btn action-delete" onclick="deleteSKU(\''+s.id+'\')">🗑️</button>':'')+'</td>'+
        '</tr>';
      }).join('');
    var emptyTip=t('gen.L2019.1','<tr><td colspan="13" style="text-align:center;color:#999;padding:40px">📭 暂无SKU数据，点击右上角"导入/更新SKU"或"\u65b0\u589eSKU"开始</td></tr>');
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
  bar.innerHTML=t('html.updateSkuBatchBar', '<span style="font-size:13px;font-weight:600;margin-right:16px">已选择 {v1} 个SKU</span>{v2}{v3}{v4}{v5}{v6}{v7}{v8}<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="batchSkuExport()">📤 批量导出</button>{v9}', {v1: count, v2: hasPermission('sku_edit')?t('gen.L2044.1','<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="batchSkuUpdate(\'status\',\'启用\')">✅ 批量启用</button>'):'', v3: hasPermission('sku_edit')?t('gen.L2044.2','<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="batchSkuUpdate(\'status\',\'停用\')">⏸️ 批量停用</button>'):'', v4: hasPermission('sku_edit')?t('gen.L2044.3','<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="openBatchSkuEditModal(\'brand\')">批量修改品牌</button>'):'', v5: hasPermission('sku_edit')?t('gen.L2044.4','<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="openBatchSkuEditModal(\'category\')">批量修改Category</button>'):'', v6: hasPermission('sku_edit')?t('gen.L2044.5','<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="openBatchSkuEditModal(\'model\')">批量修改Model</button>'):'', v7: hasPermission('sku_edit')?t('gen.L2044.6','<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="openBatchSkuEditModal(\'lifecycle_status\')">批量修改生命周期</button>'):'', v8: hasPermission('sku_edit')?t('gen.L2044.7','<button class="btn btn-sm btn-secondary" style="margin-right:6px" onclick="openBatchSkuEditModal(\'status\')">批量修改状态</button>'):'', v9: hasPermission('sku_delete')?t('gen.L2044.8','<button class="btn btn-sm" style="margin-right:6px;background:#ff4d4f;color:#fff;border:none" onclick="batchSkuDelete()">🗑️ 批量删除</button>'):''});
}
function openBatchSkuEditModal(field){
  var count=Object.keys(window._skuSelected||{}).length;
  if(count===0)return;
  var fieldLabels={'brand':t("app.112", "\u54c1\u724c"),'category':'Category','model':'Model','lifecycle_status':t("app.559", "\u751f\u547d\u5468\u671f"),'status':t("status.label", "\u72b6\u6001")};
  var label=fieldLabels[field]||field;
  var options='';
  if(field==='lifecycle_status'){
    options=t('gen.L2053.1','<select name="val" style="width:100%;padding:6px"><option value="new_test">新品导入</option><option value="new_launch">新品启动</option><option value="growth">成长期</option><option value="stable">成熟期</option><option value="slow">衰退期</option><option value="stagnant">滞销</option><option value="clearance">清仓期</option><option value="stopped">停采/停产</option></select>');
  }else if(field==='status'){
    options=t('gen.L2055.1','<select name="val" style="width:100%;padding:6px"><option value="启用">启用</option><option value="停用">停用</option><option value="清仓">清仓</option><option value="停产">停产</option></select>');
  }else{
    options=t('gen.L2057.1','<input type="text" name="val" style="width:100%;padding:6px" placeholder="请输入新的')+label+'">';
  }
  openModal(t('modal.title.openBatchSkuEditModal', '批量修改{v1}', {v1: label}),
    t('modal.body.openBatchSkuEditModal', '<div style="padding:16px"><div style="margin-bottom:12px;padding:10px;background:#fffbe6;border-radius:4px;font-size:13px;color:#666">你正在修改 <b>{v1}</b> 个SKU的{v2}，是否确认？</div><div class="form-group"><label>{v3}</label>{v4}</div></div>', {v1: count, v2: label, v3: label, v4: options}),
    t('modal.footer.openBatchSkuEditModal', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="confirmBatchSkuUpdate('{v1}')">确认修改</button>`, {v1: field})
  );
}
function confirmBatchSkuUpdate(field){
  var el=document.querySelector('[name="val"]');
  if(!el)return;
  var val=el.value;
  if(!val||!val.trim()){showToast(t('gen.L2068.1','值不能为空'),'danger');return}
  var ids=Object.keys(window._skuSelected||{});
  if(ids.length===0)return;
  var data={};data[field]=val;
  api('/api/skus/batch-update','POST',{ids:ids,data:data}).then(function(res){
    closeModal();
    showToast(t('toast.skuUpdated','已更新{count}个SKU',{count:res.updated||ids.length}),'success');
    loadSKUs();
  }).catch(function(e){showToast(e.message,'danger')});
}
function batchSkuUpdate(field,val){
  var ids=Object.keys(window._skuSelected||{});
  if(ids.length===0)return;
  if(!confirm(t('confirm.modifySkuStatus','你正在修改 {n} 个SKU的状态为"{val}"，是否确认？',{n:ids.length, val:val})))return;
  var data={};data[field]=val;
  api('/api/skus/batch-update','POST',{ids:ids,data:data}).then(function(res){
    showToast(t('toast.skuUpdated','已更新{count}个SKU',{count:res.updated||ids.length}),'success');
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
  XLSX.utils.book_append_sheet(wb,ws,t("app.580", "SKU\u5bfc\u51fa"));
  XLSX.writeFile(wb,t('gen.L2102.1','SKU批量导出_')+ids.length+t('gen.L2102.2','条.xlsx'));
  showToast(t('toast.skuExported','已导出{count}条SKU',{count:selected.length}),'success');
}
function batchSkuDelete(){
  var ids=Object.keys(window._skuSelected||{});
  if(ids.length===0)return;
  if(!confirm(t('confirm.deleteSkusBatch','⚠️ 删除后可能影响库存、出库、PO、PI、CI/PL等关联数据。\n如果SKU已有业务数据，将不允许删除，只能停用。\n\n确认删除选中的 {n} 个SKU吗？',{n:ids.length})))return;
  if(!confirm(t('confirm.deleteSkusIrreversible','二次确认：真的要删除这 {n} 个SKU吗？此操作不可逆！',{n:ids.length})))return;
  api('/api/skus/batch-delete','POST',{ids:ids}).then(function(res){
    var msg=t('gen.L2111.1','已删除')+res.deleted+t('gen.L2111.2','个');
    if(res.failed>0)msg+=t('gen.L2112.1','，失败')+res.failed+t('gen.L2112.2','个（有关联业务数据）');
    showToast(msg,res.failed>0?'warning':'success');
    if(res.errors&&res.errors.length>0){
      var html=t('gen.L2115.1','<div style="max-height:300px;overflow:auto"><div style="font-weight:600;margin-bottom:8px">删除失败的SKU：</div>');
      res.errors.forEach(function(e){html+='<div style="color:#666;padding:2px 0">'+esc(e.sku_code||e.id)+'：'+esc(e.reason)+'</div>'});
      html+='</div>';
      openModal(t("app.582", "\u5220\u9664\u7ed3\u679c"),html,t('gen.L2118.1','<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'));
    }
    loadSKUs();
  }).catch(function(e){showToast(e.message,'danger')});
}
function editSKU(id){
  const F=[{n:'sku_code',l:t("app.583", "SKU\u7f16\u7801"),r:1},{n:'product_name',l:t("app.566", "\u4ea7\u54c1\u540d\u79f0")},{n:'brand',l:t("app.112", "\u54c1\u724c"),r:1},{n:'category',l:t('gen.L2124.1','类目')},{n:'model',l:t("app.584", "\u578b\u53f7")},{n:'color_spec',l:t("app.585", "\u989c\u8272/\u89c4\u683c")},{n:'barcode',l:t("app.586", "EAN/\u6761\u7801")},{n:'purchase_price_rmb',l:t("app.587", "RMB\u91c7\u8d2d\u5355\u4ef7"),t:'num'},{n:'purchase_price_usd',l:t("app.588", "USD\u91c7\u8d2d\u5355\u4ef7"),t:'num'},{n:'carton_spec',l:t("app.589", "\u7bb1\u89c4")},{n:'qty_per_carton',l:t("app.590", "\u5355\u7bb1\u6570\u91cf"),t:'num'},{n:'unit_weight',l:t("app.591", "\u5355\u4f4d\u91cd\u91cf(KG)"),t:'num'},{n:'unit_cbm',l:t("app.592", "\u5355\u4f4d\u4f53\u79ef(CBM)"),t:'num'},{n:'is_new_product',l:t("app.593", "\u662f\u5426\u65b0\u54c1"),t:'sel',o:[{v:0,l:t("action.no", "否")},{v:1,l:t("action.yes", "是")}]},{n:'launch_date',l:t("app.594", "\u4e0a\u5e02\u65e5\u671f"),t:'date'},{n:'new_product_protection_days',l:t("app.595", "\u65b0\u54c1\u4fdd\u62a4\u671f(\u5929)"),t:'num'},{n:'lifecycle_status',l:t("app.559", "\u751f\u547d\u5468\u671f"),t:'sel',o:[{v:'new_test',l:t("app.547", "\u65b0\u54c1\u5bfc\u5165")},{v:'new_launch',l:t("app.548", "\u65b0\u54c1\u542f\u52a8")},{v:'growth',l:t("app.549", "\u6210\u957f\u671f")},{v:'stable',l:t("app.550", "\u6210\u719f\u671f")},{v:'slow',l:t("app.551", "\u8870\u9000\u671f")},{v:'stagnant',l:t("app.552", "\u6ede\u9500")},{v:'clearance',l:t("app.553", "\u6e05\u4ed3\u671f")},{v:'stopped',l:t("app.554", "\u505c\u91c7/\u505c\u4ea7")}]},{n:'auto_replenish',l:t("app.596", "\u5141\u8bb8\u81ea\u52a8\u8865\u8d27"),t:'sel',o:[{v:1,l:t("action.yes", "是")},{v:0,l:t("action.no", "否")}]},{n:'status',l:t("status.label", "\u72b6\u6001"),t:'sel',o:[{v:'normal',l:t("common.enable", "\u542f\u7528")},{v:'stopped',l:t("common.disable", "\u505c\u7528")},{v:'clearance',l:t("app.555", "\u6e05\u4ed3")},{v:'discontinued',l:t("app.556", "\u505c\u4ea7")}]},{n:'remark',l:t("app.025", "\u5907\u6ce8"),t:'area',f:1}];
  let body='<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">';
  F.forEach(f=>{const inp=f.t==='area'?'<textarea name="'+f.n+'" rows="2"></textarea>':f.t==='sel'?'<select name="'+f.n+'">'+(f.o||[]).map(o=>{const v=typeof o==='object'?o.v:o;const l=typeof o==='object'?o.l:o;return '<option value="'+v+'">'+l+'</option>'}).join('')+'</select>':f.t==='date'?'<input type="date" name="'+f.n+'">':f.t==='num'?'<input type="number" step="0.0001" name="'+f.n+'">':'<input type="text" name="'+f.n+'">';body+='<div class="form-group '+(f.f?'form-group-full':'')+'"><label>'+f.l+(f.r?' <span class="required">*</span>':'')+'</label>'+inp+'</div>'});
  body+='</div></div>';
  openModal(id?t('gen.L2128.1','编辑SKU'):t("app.598", "\u65b0\u589eSKU"),body,t('modal.footer.editSKU', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveSKU('{v1}')">保存</button>`, {v1: id||''}));
  if(id)api('/api/skus/'+id).then(s=>{F.forEach(f=>{const el=document.querySelector('[name="'+f.n+'"]');if(el)el.value=s[f.n]!==undefined?s[f.n]:''})}).catch(()=>{});
}
async function saveSKU(id){
  const form=document.querySelector('.form-grid');const data={};
  form.querySelectorAll('input,select,textarea').forEach(el=>{if(el.name)data[el.name]=el.value});
  data.purchase_price_rmb=parseFloat(data.purchase_price_rmb)||0;
  data.purchase_price_usd=parseFloat(data.purchase_price_usd)||0;
  data.qty_per_carton=parseInt(data.qty_per_carton)||0;data.unit_weight=parseFloat(data.unit_weight)||0;data.unit_cbm=parseFloat(data.unit_cbm)||0;
  data.is_new_product=parseInt(data.is_new_product)||0;data.new_product_protection_days=parseInt(data.new_product_protection_days)||90;data.auto_replenish=parseInt(data.auto_replenish)||0;
  try{if(id){await api('/api/skus/'+id,'PUT',data);showToast(t('gen.L2138.1','保存成功'),'success')}else{await api('/api/skus','POST',data);showToast(t('gen.L2138.2','创建成功'),'success')}closeModal();loadSKUs()}catch(e){showToast(e.message,'danger')}
}
async function deleteSKU(id){
  if(!confirm(t('gen.L2141.1','⚠️ 删除SKU可能影响库存、出库、PO、PI、CI/PL等关联数据。\n如果SKU已有业务数据，将不允许删除，只能停用。\n\n确认删除吗？')))return;
  try{
    await api('/api/skus/'+id,'DELETE');
    showToast(t('gen.L2144.1','已删除'),'success');
    loadSKUs();
  }catch(e){
    showToast(e.message||t("inventory.003", "\u5220\u9664\u5931\u8d25"),'danger');
  }
}

// --- 通用导入函数 ---
function importFile(url,callback){
  const inp=document.createElement('input');inp.type='file';inp.accept='.xlsx,.xls';
  inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=async ev=>{try{const wb=XLSX.read(ev.target.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const items=XLSX.utils.sheet_to_json(ws);const result=await api(url,'POST',{items});showToast(t('toast.importDone3','导入完成：新增{c}，更新{u}，失败{f}',{c:result.created||0, u:result.updated||0, f:result.failed||0}),'success');if(callback)callback()}catch(err){showToast(err.message,'danger')}};r.readAsArrayBuffer(f)};
  inp.click();
}

// ==================== SKU批量导入 ====================
const SKU_IMPORT_COLUMNS=[
  {key:'sku_code',label:t("app.583", "SKU\u7f16\u7801"),required:true},
  {key:'product_name',label:t("app.566", "\u4ea7\u54c1\u540d\u79f0")},
  {key:'brand',label:t("app.112", "\u54c1\u724c")},
  {key:'category',label:t('col.payment_category','类目')},
  {key:'model',label:t("app.584", "\u578b\u53f7")},
  {key:'color_spec',label:t("app.585", "\u989c\u8272/\u89c4\u683c")},
  {key:'barcode',label:t("po.005", "\u6761\u7801")},
  {key:'purchase_price_rmb',label:t("app.587", "RMB\u91c7\u8d2d\u5355\u4ef7"),format:parseFloat},
  {key:'purchase_price_usd',label:t("app.588", "USD\u91c7\u8d2d\u5355\u4ef7"),format:parseFloat},
  {key:'carton_spec',label:t("app.589", "\u7bb1\u89c4")},
  {key:'qty_per_carton',label:t("app.590", "\u5355\u7bb1\u6570\u91cf"),format:parseInt},
  {key:'unit_weight',label:t("app.591", "\u5355\u4f4d\u91cd\u91cf(KG)"),format:parseFloat},
  {key:'unit_cbm',label:t("app.592", "\u5355\u4f4d\u4f53\u79ef(CBM)"),format:parseFloat},
  {key:'lifecycle_status',label:t("app.559", "\u751f\u547d\u5468\u671f")},
  {key:'launch_date',label:t("app.594", "\u4e0a\u5e02\u65e5\u671f")},
  {key:'status',label:t("status.label", "\u72b6\u6001")},
  {key:'remark',label:t("app.025", "\u5907\u6ce8")}
];
// 生命周期中文 → 代码
const SKU_LIFECYCLE_MAP={'新品导入':'new_test','新品启动':'new_launch','成长期':'growth','成熟期':'stable','衰退期':'slow','滞销':'stagnant','清仓期':'clearance','停采':'stopped','停产':'stopped','停采/停产':'stopped'};
const SKU_STATUS_MAP={'启用':'normal','正常':'normal','清仓':'clearance','停用':'stopped','停采':'stopped','停产':'discontinued'};

function openSkuBatchImport(){
  openModal(t("po.006", "\u6279\u91cf\u5bfc\u5165SKU\u4e3b\u6570\u636e"),
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div id="si-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s" '+
        'onclick="document.getElementById(\'si-file-input\').click()" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
        'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handleSkuFile(event.dataTransfer.files[0])">'+
        '<div style="font-size:48px;color:#1890ff;margin-bottom:8px">📤</div>'+
        '<div style="font-size:14px;color:#333;margin-bottom:4px">'+t("html.inv.drop_hint", "点击上传或拖拽文件到此处")+'</div>'+
        '<div style="font-size:12px;color:#999">'+t("html.inv.support_fmt", "支持 .xlsx / .xls / .csv 格式")+'</div>'+
      '</div>'+
      '<input type="file" id="si-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleSkuFile(this.files[0])">'+
      '<div id="si-preview" style="margin-top:16px"></div>'+
      '<div id="si-result" style="margin-top:16px"></div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="downloadSkuTemplate()">'+t("html.inv.download_tpl", "下载模板")+'</button>'+
    '<button class="btn btn-secondary" onclick="closeModal()">'+t("action.close", "关闭")+'</button>'+
    '<button class="btn btn-primary" id="si-import-btn" onclick="submitSkuBatchImport()" disabled>'+t("html.inv.start_import", "开始导入")+'</button>'
  );
  window._skuImportData=[];
}

function handleSkuFile(file){
  if(!file)return;
  var ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){showToast(t("toast.only_xlsx", "仅支持 .xlsx / .xls / .csv 格式"),'danger');return}
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=e.target.result;
      var wb;
      if(ext==='csv'){wb=XLSX.read(data,{type:'string',codepage:65001})}
      else{wb=XLSX.read(new Uint8Array(data),{type:'array',cellDates:true})}
      var ws=wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      if(rows.length<2){showToast(t("toast.file_empty", "文件为空或缺少数据行"),'danger');return}
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
        if(!rec.sku_code||!String(rec.sku_code).trim())rec._errors.push(t("toast.sku_code_required", "SKU编码不能为空"));
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
    }catch(err){showToast(t('toast.handleSkuFile', '文件解析失败：{v1}', {v1: err.message}),'danger')}
  };
  if(ext==='csv')reader.readAsText(file,'UTF-8');
  else reader.readAsArrayBuffer(file);
}

function renderSkuPreview(records){
  var valid=records.filter(function(r){return r._errors.length===0}).length;
  var invalid=records.length-valid;
  var html=t('gen.L2264.1','<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px"><b>共 ')+records.length+t('gen.L2264.2',' 条数据</b>，<span style="color:#52c41a">有效 ')+valid+t('gen.L2264.3',' 条</span>')+(invalid>0?t('gen.L2264.4','，<span style="color:#ff4d4f">无效 ')+invalid+t('gen.L2264.5',' 条</span>'):'')+'</div>';
  html+='<div class="table-container" style="max-height:300px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>'+t("col.row", "行")+'</th><th>'+t("col.sku_code", "SKU编码")+'</th><th>'+t("col.product_name", "产品名称")+'</th><th>'+t("app.112", "品牌")+'</th><th>'+t("col.model", "型号")+'</th><th>'+t("app.559", "生命周期")+'</th><th>'+t("col.status", "状态")+'</th><th>'+t("col.verify", "校验")+'</th></tr></thead><tbody>';
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
  if(records.length>20)html+=t('gen.L2280.1','<tr><td colspan="8" style="text-align:center;color:#999;padding:8px">... 还有 ')+(records.length-20)+t('gen.L2280.2',' 条</td></tr>');
  html+='</tbody></table></div>';
  if(invalid>0){
    html+='<div style="margin-top:10px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666"><b>'+t("html.preview.invalid_detail", "无效行明细：")+'</b><br>'+
      records.filter(function(r){return r._errors.length>0}).slice(0,10).map(function(r){return t("html.preview.row_pre", "第 ")+r._rowNum+t("html.preview.row_suffix", " 行：")+r._errors.join('、')}).join('<br>')+
      (invalid>10?'<br>...':'')+'</div>';
  }
  document.getElementById('si-preview').innerHTML=html;
}

function downloadSkuTemplate(){
  var headers=SKU_IMPORT_COLUMNS.map(function(c){return c.label});
  var sample=[
    ['RD-K585-RGB',t("app.604", "K585 RGB\u673a\u68b0\u952e\u76d8"),'Redragon',t("app.605", "\u673a\u68b0\u952e\u76d8"),'K585',t("app.606", "\u9ed1\u8272"),'6959368123456','USD','18.50','48x32x12cm',20,0.85,0.012,t("app.549", "\u6210\u957f\u671f"),'2025-03-15',t("inventory.005", "\u6b63\u5e38"),t("sample.hot_seller", "热销款")],
    ['RD-M601-BK',t("app.608", "M601\u6e38\u620f\u9f20\u6807"),'Redragon',t("app.609", "\u6e38\u620f\u9f20\u6807"),'M601',t("app.606", "\u9ed1\u8272"),'6959368789012','USD','6.20','30x20x8cm',50,0.25,0.005,t("app.550", "\u6210\u719f\u671f"),'2024-06-01',t("inventory.005", "\u6b63\u5e38"),t("sample.normal_style", "常规款")]
  ];
  var ws=XLSX.utils.aoa_to_sheet([headers].concat(sample));
  ws['!cols']=SKU_IMPORT_COLUMNS.map(function(c){return {wch:c.label.length*2+6}});
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,t("nav.skus", "SKU\u4e3b\u6570\u636e"));
  XLSX.writeFile(wb,t("app.611", "SKU\u4e3b\u6570\u636e_\u5bfc\u5165\u6a21\u677f.xlsx"));
}

async function submitSkuBatchImport(){
  var records=window._skuImportData||[];
  var valid=records.filter(function(r){return r._errors.length===0});
  if(valid.length===0){showToast(t("toast.no_valid_data", "没有可导入的有效数据"),'danger');return}
  var btn=document.getElementById('si-import-btn');
  btn.disabled=true;btn.textContent=t("app.613", "\u5bfc\u5165\u4e2d...");
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
      '<div style="font-weight:600;margin-bottom:8px">'+t("toast.import_done", "导入完成")+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
        t("html.import.added_open", "<span>已新增：")+(res.created||0)+t("html.unit.tiao_close", " 条</span>")+
        t("html.import.updated_open", "<span>已更新：")+(res.updated||0)+t("html.unit.tiao_close", " 条</span>")+
        t("html.import.fail_open", "<span>失败：")+(res.failed||0)+t("html.unit.tiao_close", " 条</span>")+
      '</div>';
    if(window._lastSkuImportErrors.length>0){
      html+='<div style="margin-top:10px"><div style="font-weight:600;color:#ff3b30;margin-bottom:6px">'+t("html.inv.fail_detail", "失败明细")+'</div>';
      html+=window._lastSkuImportErrors.slice(0,20).map(function(e){return t('gen.L2327.1','<div style="color:#666">第 ')+e.row+t('gen.L2327.2',' 行：')+esc(e.reason)+'</div>'}).join('');
      if(window._lastSkuImportErrors.length>20)html+=t('gen.L2328.1','<div style="color:#999">还有 ')+(window._lastSkuImportErrors.length-20)+t('gen.L2328.2',' 条失败...</div>');
      html+='<button type="button" class="btn btn-secondary" style="margin-top:10px" onclick="downloadSkuImportErrors()">'+t("html.inv.download_fail", "下载失败明细")+'</button></div>';
    }
    html+='</div>';
    document.getElementById('si-result').innerHTML=html;
    showToast(t('toast.importDone3','导入完成：新增{c}，更新{u}，失败{f}',{c:res.created||0, u:res.updated||0, f:res.failed||0}),res.failed>0?'warning':'success');
    loadSKUs();
  }catch(e){
    showToast(e.message||t("toast.import_failed", "导入失败"),'danger');
  }finally{
    btn.disabled=false;btn.textContent=t("app.067", "\u5f00\u59cb\u5bfc\u5165");
  }
}

function downloadSkuImportErrors(){
  if(!window._lastSkuImportErrors||window._lastSkuImportErrors.length===0)return;
  var ws=XLSX.utils.aoa_to_sheet([[t("col.row_no", "行号"),t("html.batch.err_reason", "失败原因")]].concat(window._lastSkuImportErrors.map(function(e){return [e.row,e.reason]})));
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,t("html.inv.fail_detail", "失败明细"));
  XLSX.writeFile(wb,t("app.617", "SKU\u5bfc\u5165\u5931\u8d25\u660e\u7ec6.xlsx"));
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
  {key:'sku_code',label:t("app.583", "SKU\u7f16\u7801"),required:true},
  {key:'brand',label:t("app.112", "\u54c1\u724c")},
  {key:'import_date',label:t("po.009", "\u5bfc\u5165\u65e5\u671f"),required:true},
  {key:'country',label:t("app.113", "\u56fd\u5bb6")},
  {key:'warehouse',label:t("app.114", "\u4ed3\u5e93")},
  {key:'channel',label:t('col.channel','渠道')},
  {key:'available_qty',label:t("po.010", "\u53ef\u7528\u6570\u91cf"),format:parseInt},
  {key:'weighted_avg_cost',label:t("po.011", "\u52a0\u6743\u6210\u672c(\u5ffd\u7565)"),format:parseFloat},
  {key:'last_inbound_date',label:t("po.012", "\u6700\u540e\u5165\u5e93\u65e5\u671f"),format:parseDateStr},
  {key:'remark',label:t("app.025", "\u5907\u6ce8")}
];

function openInvBatchImport(){
  openModal(t("po.013", "\u6279\u91cf\u5bfc\u5165\u5e93\u5b58\u6570\u636e"),
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div style="margin-bottom:12px;padding:12px 14px;background:#fff7e6;border:1px solid #ffd591;border-radius:6px;font-size:12px;color:#333">'+
        '<div style="font-weight:600;margin-bottom:6px">'+t("html.inv.snapshot_cutoff", "库存快照截止日期")+'</div>'+
        t('gen.L2381.1','<div style="margin-bottom:8px;color:#666">当前导入的可用库存已经完整扣除出库数据的最后一天。例如今天是7月5日但当天还没结束，截止日期应填7月4日。<b style="color:#ff3b30">')+t("html.inv.required_note", "必填，不填写不允许导入。")+'</b></div>'+
        '<input type="date" id="inv-snapshot-cutoff" style="padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;width:200px" onchange="window._invSnapshotDate=this.value;updateInvImportBtnState()">'+
      '</div>'+
      '<div style="margin-bottom:12px;padding:10px 14px;background:#e6f7ff;border:1px solid #91d5ff;border-radius:6px;font-size:12px;color:#333">'+
        '<div style="font-weight:600;margin-bottom:4px">'+t("html.inv.wac_note", "加权平均成本说明")+'</div>'+
        '<div style="color:#666">'+t("html.inv.wac_auto", "加权平均成本由系统按最新已确认成本版本自动匹配，导入文件中的加权成本列将被忽略。")+'</div>'+
      '</div>'+
      '<div id="inv-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s" '+
        'onclick="document.getElementById(\'inv-file-input\').click()" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
        'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handleInvFile(event.dataTransfer.files[0])">'+
        '<div style="font-size:48px;color:#1890ff;margin-bottom:8px">📦</div>'+
        '<div style="font-size:14px;color:#333;margin-bottom:4px">'+t("html.inv.drop_hint", "点击上传或拖拽文件到此处")+'</div>'+
        '<div style="font-size:12px;color:#999">'+t("html.inv.support_fmt", "支持 .xlsx / .xls / .csv 格式")+'</div>'+
      '</div>'+
      '<input type="file" id="inv-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleInvFile(this.files[0])">'+
      '<div id="inv-preview" style="margin-top:16px"></div>'+
      '<div id="inv-result" style="margin-top:16px"></div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="downloadInvTemplate()">'+t("html.inv.download_tpl", "下载模板")+'</button>'+
    '<button class="btn btn-secondary" onclick="closeModal()">'+t("action.close", "关闭")+'</button>'+
    '<button class="btn btn-primary" id="inv-import-btn" onclick="submitInvBatchImport()" disabled>'+t("html.inv.start_import", "开始导入")+'</button>'
  );
  window._invImportData=[];
  window._invSnapshotDate='';
}

function handleInvFile(file){
  if(!file)return;
  var ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){showToast(t("toast.only_xlsx", "仅支持 .xlsx / .xls / .csv 格式"),'danger');return}
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=e.target.result;
      var wb;
      if(ext==='csv'){wb=XLSX.read(data,{type:'string',codepage:65001})}
      else{wb=XLSX.read(new Uint8Array(data),{type:'array',cellDates:true})}
      var ws=wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      if(rows.length<2){showToast(t("toast.file_empty", "文件为空或缺少数据行"),'danger');return}
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
        if(!rec.sku_code||!String(rec.sku_code).trim())rec._errors.push(t("toast.sku_code_required", "SKU编码不能为空"));
        if(!rec.import_date)rec._errors.push(t("app.618", "\u5bfc\u5165\u65e5\u671f\u4e0d\u80fd\u4e3a\u7a7a"));
        else{
          if(rec.import_date instanceof Date)rec.import_date=formatDateISO(rec.import_date);
          else rec.import_date=String(rec.import_date).trim().slice(0,10);
        }
        records.push(rec);
      }
      window._invImportData=records;
      renderInvPreview(records);
      updateInvImportBtnState();
    }catch(err){showToast(t('toast.handleInvFile', '文件解析失败：{v1}', {v1: err.message}),'danger')}
  };
  if(ext==='csv')reader.readAsText(file,'UTF-8');
  else reader.readAsArrayBuffer(file);
}

function renderInvPreview(records){
  var valid=records.filter(function(r){return r._errors.length===0}).length;
  var invalid=records.length-valid;
  var html=t('gen.L2458.1','<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px"><b>共 ')+records.length+t('gen.L2458.2',' 条数据</b>，<span style="color:#52c41a">有效 ')+valid+t('gen.L2458.3',' 条</span>')+(invalid>0?t('gen.L2458.4','，<span style="color:#ff4d4f">无效 ')+invalid+t('gen.L2458.5',' 条</span>'):'')+'</div>';
  html+='<div class="table-container" style="max-height:300px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>'+t("col.row", "行")+'</th><th>'+t("col.sku_code", "SKU编码")+'</th><th>'+t("app.112", "品牌")+'</th><th>'+t("po.009", "导入日期")+'</th><th>'+t("app.113", "国家")+'</th><th>'+t("app.114", "仓库")+'</th><th>'+t("po.010", "可用数量")+'</th><th>'+t("app.619", "加权成本")+'</th><th>'+t("col.last_inbound_date", "最后入库日期")+'</th><th>'+t("col.verify", "校验")+'</th></tr></thead><tbody>';
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
  if(records.length>20)html+=t('gen.L2475.1','<tr><td colspan="10" style="text-align:center;color:#999;padding:8px">... 还有 ')+(records.length-20)+t('gen.L2475.2',' 条</td></tr>');
  html+='</tbody></table></div>';
  if(invalid>0){
    html+='<div style="margin-top:10px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666"><b>'+t("html.preview.invalid_detail", "无效行明细：")+'</b><br>'+
      records.filter(function(r){return r._errors.length>0}).slice(0,10).map(function(r){return t("html.preview.row_pre", "第 ")+r._rowNum+t("html.preview.row_suffix", " 行：")+r._errors.join('、')}).join('<br>')+
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
      btn.textContent=t("app.620", "\u8bf7\u5148\u586b\u5199\u5feb\u7167\u622a\u6b62\u65e5\u671f");
    }else{
      btn.textContent=t("app.067", "\u5f00\u59cb\u5bfc\u5165");
    }
  }
}

function downloadInvTemplate(){
  var headers=INV_IMPORT_COLUMNS.map(function(c){return c.label});
  var sample=[
    ['RD-K585-RGB','Redragon','2026-07-05',t("app.621", "\u5370\u5c3c"),t("app.622", "Jakarta\u4ed3"),t("col.online", "线上"),'350','85.50','2026-06-20',''],
    ['RD-M601-BK','Redragon','2026-07-05',t("app.621", "\u5370\u5c3c"),t("app.622", "Jakarta\u4ed3"),t("col.offline", "线下"),'120','92.00','','']
  ];
  var ws=XLSX.utils.aoa_to_sheet([headers].concat(sample));
  ws['!cols']=INV_IMPORT_COLUMNS.map(function(c){return {wch:c.label.length*2+6}});
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,t("app.623", "\u5e93\u5b58\u6570\u636e"));
  XLSX.writeFile(wb,t("app.624", "\u5e93\u5b58\u6570\u636e_\u5bfc\u5165\u6a21\u677f.xlsx"));
}

async function submitInvBatchImport(){
  var records=window._invImportData||[];
  var valid=records.filter(function(r){return r._errors.length===0});
  if(valid.length===0){showToast(t("toast.no_valid_data", "没有可导入的有效数据"),'danger');return}
  var snapshotDate=window._invSnapshotDate||'';
  if(!snapshotDate){showToast(t("toast.fill_snapshot_date", "请填写库存快照截止日期"),'danger');return}
  var btn=document.getElementById('inv-import-btn');
  btn.disabled=true;btn.textContent=t("app.613", "\u5bfc\u5165\u4e2d...");
  try{
    var items=valid.map(function(r){
      var o={};
      INV_IMPORT_COLUMNS.forEach(function(c){o[c.key]=r[c.key]!==undefined?r[c.key]:''});
      return o;
    });
    var res=await api('/api/inventory-imports/bulk-import','POST',{items:items,snapshot_cutoff_date:snapshotDate});
    window._lastInvImportErrors=res.errors||[];
    var html='<div style="background:'+(res.failed>0?'#fffbe6':'#f6ffed')+';border:1px solid '+(res.failed>0?'#ffe58f':'#b7eb8f')+';border-radius:8px;padding:14px 16px;font-size:13px">'+
      '<div style="font-weight:600;margin-bottom:8px">'+t("toast.import_done", "导入完成")+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'+
        t("html.import.added_open", "<span>已新增：")+(res.created||0)+t("html.unit.tiao_close", " 条</span>")+
        t("html.import.fail_open", "<span>失败：")+(res.failed||0)+t("html.unit.tiao_close", " 条</span>")+
        t('gen.L2534.1','<span style="color:#1890ff">快照截止日期：')+esc(res.snapshot_cutoff_date||snapshotDate)+'</span>'+
      '</div>';
    // P1-03-B: WAC warnings 展示
    if(res.wac_warnings&&res.wac_warnings.length>0){
      var highWarnings=res.wac_warnings.filter(function(w){return w.priority==='high'});
      var normalWarnings=res.wac_warnings.filter(function(w){return w.priority!=='high'});
      html+='<div style="margin-top:10px;padding:10px 12px;border-radius:6px;background:'+(highWarnings.length>0?'#fff1f0':'#fffbe6')+';border:1px solid '+(highWarnings.length>0?'#ffa39e':'#ffe58f')+'">'+
        '<div style="font-weight:600;color:'+(highWarnings.length>0?'#ff3b30':'#faad14')+t('gen.L2541.1',';margin-bottom:6px">加权平均成本匹配结果</div>');
      if(highWarnings.length>0){
        html+='<div style="color:#ff3b30;margin-bottom:4px;font-weight:600">'+t("html.inv.high_priority", "⚠️ 高优先级（成本为 0，请尽快完成成本确认）")+'</div>';
        highWarnings.forEach(function(w){
          html+='<div style="color:#666;margin-left:12px">'+esc(w.sku_code)+' / '+esc(w.country||'')+' / '+esc(w.warehouse||'')+'：'+esc(w.message)+'</div>';
        });
      }
      if(normalWarnings.length>0){
        html+='<div style="color:#faad14;margin-bottom:4px;margin-top:'+(highWarnings.length>0?'6px':'0')+t('gen.L2549.1','">ℹ️ 已保留原成本（请完成成本确认以更新）</div>');
        normalWarnings.forEach(function(w){
          html+='<div style="color:#666;margin-left:12px">'+esc(w.sku_code)+' / '+esc(w.country||'')+' / '+esc(w.warehouse||'')+'：'+esc(w.message)+'</div>';
        });
      }
      html+='</div>';
    }
    if(window._lastInvImportErrors.length>0){
      html+='<div style="margin-top:10px"><div style="font-weight:600;color:#ff3b30;margin-bottom:6px">'+t("html.inv.fail_detail", "失败明细")+'</div>';
      html+=window._lastInvImportErrors.slice(0,20).map(function(e){return t('gen.L2558.1','<div style="color:#666">第 ')+e.row+t('gen.L2558.2',' 行：')+esc(e.reason)+'</div>'}).join('');
      if(window._lastInvImportErrors.length>20)html+=t('gen.L2559.1','<div style="color:#999">还有 ')+(window._lastInvImportErrors.length-20)+t('gen.L2559.2',' 条失败...</div>');
      html+='<button type="button" class="btn btn-secondary" style="margin-top:10px" onclick="downloadInvImportErrors()">'+t("html.inv.download_fail", "下载失败明细")+'</button></div>';
    }
    html+='</div>';
    document.getElementById('inv-result').innerHTML=html;
    showToast(t('toast.importDone2','导入完成：新增{c}，失败{f}',{c:res.created||0, f:res.failed||0}),res.failed>0?'warning':'success');
    loadInv();
  }catch(e){
    showToast(e.message||t("toast.import_failed", "导入失败"),'danger');
  }finally{
    btn.disabled=false;btn.textContent=t("app.067", "\u5f00\u59cb\u5bfc\u5165");
  }
}

function downloadInvImportErrors(){
  if(!window._lastInvImportErrors||window._lastInvImportErrors.length===0)return;
  var ws=XLSX.utils.aoa_to_sheet([[t("col.row_no", "行号"),t("html.batch.err_reason", "失败原因")]].concat(window._lastInvImportErrors.map(function(e){return [e.row,e.reason]})));
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,t("html.inv.fail_detail", "失败明细"));
  XLSX.writeFile(wb,t("app.628", "\u5e93\u5b58\u5bfc\u5165\u5931\u8d25\u660e\u7ec6.xlsx"));
}

// ==================== 销售数据批量导入 ====================
const SALES_IMPORT_COLUMNS=[
  {key:'source_system',label:t("po.018", "\u6765\u6e90\u7cfb\u7edf"),required:true},
  {key:'order_no',label:t("po.019", "\u8ba2\u5355\u53f7"),required:true},
  {key:'order_detail_id',label:t("po.020", "\u8ba2\u5355\u660e\u7ec6ID")},
  {key:'order_date',label:t('col.order_date','下单日期'),required:true},
  {key:'shop_platform',label:t('col.channel','渠道')},
  {key:'brand',label:t("app.112", "\u54c1\u724c")},
  {key:'sku_code',label:'SKU',required:true},
  {key:'quantity',label:t("col.quantity", "数量"),required:true,format:parseInt},
  {key:'is_valid_order',label:t("po.021", "\u662f\u5426\u6709\u6548\u8ba2\u5355")},
  {key:'original_order_status',label:t("po.022", "\u539f\u59cb\u8ba2\u5355\u72b6\u6001")},
  {key:'remark',label:t("app.025", "\u5907\u6ce8")}
];

function openSalesBatchImport(){
  openModal(t("po.023", "\u6279\u91cf\u5bfc\u5165\u9500\u552e\u6570\u636e"),
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div id="sales-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s" '+
        'onclick="document.getElementById(\'sales-file-input\').click()" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
        'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handleSalesFile(event.dataTransfer.files[0])">'+
        '<div style="font-size:48px;color:#1890ff;margin-bottom:8px">🛒</div>'+
        '<div style="font-size:14px;color:#333;margin-bottom:4px">'+t("html.inv.drop_hint", "点击上传或拖拽文件到此处")+'</div>'+
        '<div style="font-size:12px;color:#999">'+t("html.inv.support_fmt", "支持 .xlsx / .xls / .csv 格式")+'</div>'+
      '</div>'+
      '<input type="file" id="sales-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleSalesFile(this.files[0])">'+
      '<div style="margin-top:12px;padding:12px 14px;background:#f0f5ff;border:1px solid #adc6ff;border-radius:6px;font-size:12px;color:#333">'+
        '<div style="font-weight:600;margin-bottom:6px">'+t("html.sales.import_note", "导入说明")+'</div>'+
        '<div style="line-height:1.8">'+
          t("html.sales.bullet1", "• <b>来源系统+订单号+SKU+渠道</b> 为唯一键，重复导入将自动更新而非新增<br>")+
          t("html.sales.bullet2", "• <b>是否有效订单=true</b> 的订单计入销量预测、周转月、补货建议<br>")+
          t("html.sales.bullet3", "• <b>是否有效订单=false</b> 的订单不计入预测，仅保留记录用于追溯<br>")+
          t("html.sales.bullet4", "• <b>原始订单状态</b> 仅用于追溯，不参与系统计算<br>")+
          t("html.sales.bullet5", "• 销售数据导入<b>不扣减库存</b>，库存以库存快照导入为准<br>")+
          t("html.sales.bullet6", "• 如有<b>订单明细ID</b>，优先按 来源系统+订单明细ID 去重")+
        '</div>'+
      '</div>'+
      '<div id="sales-preview-stats" style="margin-top:16px"></div>'+
      '<div id="sales-result" style="margin-top:16px"></div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="downloadSalesTemplate()">'+t("html.inv.download_tpl", "下载模板")+'</button>'+
    '<button class="btn btn-secondary" onclick="closeModal()">'+t("action.close", "关闭")+'</button>'+
    '<button class="btn btn-primary" id="sales-import-btn" onclick="submitSalesBatchImport()" disabled>'+t("html.inv.start_import", "开始导入")+'</button>'
  );
  window._salesImportData=[];
}

function handleSalesFile(file){
  if(!file)return;
  var ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){showToast(t("toast.only_xlsx", "仅支持 .xlsx / .xls / .csv 格式"),'danger');return}
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=e.target.result;
      var wb;
      if(ext==='csv'){wb=XLSX.read(data,{type:'string',codepage:65001})}
      else{wb=XLSX.read(new Uint8Array(data),{type:'array',cellDates:true})}
      var ws=wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      if(rows.length<2){showToast(t("toast.file_empty", "文件为空或缺少数据行"),'danger');return}
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
        if(!rec.source_system||!String(rec.source_system).trim())rec._errors.push(t("toast.src_required", "来源系统不能为空"));
        if(!rec.order_no||!String(rec.order_no).trim())rec._errors.push(t("toast.order_required", "订单号不能为空"));
        if(!rec.sku_code||!String(rec.sku_code).trim())rec._errors.push(t("toast.sku_required", "SKU不能为空"));
        if(!rec.order_date)rec._errors.push(t("app.632", "\u4e0b\u5355\u65e5\u671f\u4e0d\u80fd\u4e3a\u7a7a"));
        else{
          var normalizedDate=normalizeOrderDate(rec.order_date);
          if(normalizedDate)rec.order_date=normalizedDate;
          else rec._errors.push(t("toast.date_unknown", "下单日期格式无法识别：")+rec.order_date);
        }
        if(rec.quantity===undefined||rec.quantity===null||isNaN(rec.quantity)||rec.quantity<=0)rec._errors.push(t("app.633", "\u6570\u91cf\u5fc5\u987b\u4e3a\u6b63\u6570"));
        // is_valid_order 默认true
        if(rec.is_valid_order!==undefined&&rec.is_valid_order!==''){
          var v=String(rec.is_valid_order).toLowerCase().trim();
          rec.is_valid_order=(v==='true'||v==='1'||v===t("action.yes", "是")||v==='有效')?1:0;
        }else{
          rec.is_valid_order=1;
        }
        records.push(rec);
      }
      window._salesImportData=records;
      renderSalesPreview(records);
      document.getElementById('sales-import-btn').disabled=records.filter(function(r){return r._errors.length===0}).length===0;
    }catch(err){showToast(t('toast.handleSalesFile', '文件解析失败：{v1}', {v1: err.message}),'danger')}
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
      '<div style="font-weight:600;margin-bottom:8px">'+t("html.sales.preview_stats", "导入预览统计")+'</div>'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">'+
        t("html.sales.preview_total_open", "<span>总记录数：")+(res.preview.length)+'</span>'+
        t('gen.L2702.1','<span style="color:#52c41a">将新增：')+res.preview.filter(function(p){return p.action==='insert'}).length+'</span>'+
        t('gen.L2703.1','<span style="color:#1890ff">将更新：')+res.preview.filter(function(p){return p.action==='update'}).length+'</span>'+
        t('gen.L2704.1','<span style="color:#faad14">重复无变化：')+res.preview.filter(function(p){return p.action==='skip'}).length+'</span>'+
        t('gen.L2705.1','<span style="color:#ff3b30">异常失败：')+res.preview.filter(function(p){return p.errors.length>0}).length+'</span>'+
      '</div>';
    html+='</div>';
    var el=document.getElementById('sales-preview-stats');
    if(el){
      var oldPreview=el.querySelector('div[style*="overflow:auto"]');
      el.innerHTML=html+(oldPreview?oldPreview.outerHTML:'');
    }
    document.getElementById('sales-import-btn').disabled=false;
  }catch(e){
    showToast(t('toast.requestSalesPreview', '预览失败: {v1}', {v1: e.message||''}),'danger');
  }
}

function renderSalesPreview(records){
  var valid=records.filter(function(r){return r._errors.length===0}).length;
  var invalid=records.length-valid;
  var html=t('gen.L2722.1','<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px"><b>共 ')+records.length+t('gen.L2722.2',' 条数据</b>，<span style="color:#52c41a">有效 ')+valid+t('gen.L2722.3',' 条</span>')+(invalid>0?t('gen.L2722.4','，<span style="color:#ff4d4f">无效 ')+invalid+t('gen.L2722.5',' 条</span>'):'')+'</div>';
  html+='<div class="table-container" style="max-height:300px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>'+t("col.row", "行")+'</th><th>'+t("po.018", "来源系统")+'</th><th>'+t("po.019", "订单号")+'</th><th>'+t("col.order_date", "下单日期")+'</th><th>SKU</th><th>'+t("col.qty", "数量")+'</th><th>'+t("col.effective_order", "有效订单")+'</th><th>'+t("col.verify", "校验")+'</th></tr></thead><tbody>';
  records.slice(0,20).forEach(function(r){
    var ok=r._errors.length===0;
    html+='<tr style="'+(ok?'':'background:#fff1f0')+'">'+
      '<td>'+r._rowNum+'</td>'+
      '<td>'+esc(r.source_system||'-')+'</td>'+
      '<td class="cell-id">'+esc(r.order_no||'-')+'</td>'+
      '<td>'+esc(r.order_date||'-')+'</td>'+
      '<td class="cell-id">'+esc(r.sku_code||'-')+'</td>'+
      '<td class="text-right">'+(r.quantity!==undefined?r.quantity:'-')+'</td>'+
      '<td>'+(r.is_valid_order?t('gen.L2733.1','<span style="color:#52c41a">是</span>'):t('gen.L2733.2','<span style="color:#999">否</span>'))+'</td>'+
      '<td>'+(ok?'<span class="status-badge status-completed">✓</span>':'<span class="status-badge status-danger" title="'+esc(r._errors.join('; '))+'">✗ '+r._errors.length+'</span>')+'</td>'+
    '</tr>';
  });
  if(records.length>20)html+=t('gen.L2737.1','<tr><td colspan="8" style="text-align:center;color:#999;padding:8px">... 还有 ')+(records.length-20)+t('gen.L2737.2',' 条</td></tr>');
  html+='</tbody></table></div>';
  if(invalid>0){
    html+='<div style="margin-top:10px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666"><b>'+t("html.preview.invalid_detail", "无效行明细：")+'</b><br>'+
      records.filter(function(r){return r._errors.length>0}).slice(0,10).map(function(r){return t("html.preview.row_pre", "第 ")+r._rowNum+t("html.preview.row_suffix", " 行：")+r._errors.join('、')}).join('<br>')+
      (invalid>10?'<br>...':'')+'</div>';
  }
  document.getElementById('sales-preview-stats').innerHTML=html;
  if(valid>0) requestSalesPreview();
}

function downloadSalesTemplate(){
  var headers=SALES_IMPORT_COLUMNS.map(function(c){return c.label});
  var sample=[
    ['BigSeller','BS-2026-001234','','2026-06-15',t("app.641", "Shopee\u5370\u5c3c\u5e97"),'BOYA','BY-M1',30,'true','Shipped',t("sample.normal_order", "正常订单")],
    [t("sample.zhisu", "至速"),'ZS-2026-005678','','2026-06-15',t("app.644", "Lazada\u9a6c\u6765\u5e97"),'BOYA','BY-M1000',15,'true','Delivered',''],
    ['EDA','EDA-2026-009999','DTL-001','2026-06-14',t("app.645", "TikTok\u6cf0\u56fd\u5e97"),'BOYA','BY-WM8 Pro',8,'false','Cancelled',t("sample.sales_remark", "取消订单不计入预测")]
  ];
  var ws=XLSX.utils.aoa_to_sheet([headers].concat(sample));
  ws['!cols']=SALES_IMPORT_COLUMNS.map(function(c){return {wch:c.label.length*2+6}});
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,t("nav.sales_data", "销售数据"));
  XLSX.writeFile(wb,t("app.647", "\u9500\u552e\u6570\u636e_\u5bfc\u5165\u6a21\u677f.xlsx"));
}

async function submitSalesBatchImport(){
  var records=window._salesImportData||[];
  var valid=records.filter(function(r){return r._errors.length===0});
  if(valid.length===0){showToast(t("toast.no_valid_data", "没有可导入的有效数据"),'danger');return}
  var btn=document.getElementById('sales-import-btn');
  btn.disabled=true;btn.textContent=t("app.613", "\u5bfc\u5165\u4e2d...");
  try{
    var items=valid.map(function(r){
      var o={};
      SALES_IMPORT_COLUMNS.forEach(function(c){o[c.key]=r[c.key]!==undefined?r[c.key]:''});
      return o;
    });
    var res=await api('/api/sales-records/bulk-import','POST',{items:items});
    window._lastSalesImportErrors=res.errors||[];
    var html='<div style="background:'+(res.failed>0?'#fffbe6':'#f6ffed')+';border:1px solid '+(res.failed>0?'#ffe58f':'#b7eb8f')+';border-radius:8px;padding:14px 16px;font-size:13px">'+
      '<div style="font-weight:600;margin-bottom:8px">'+t("html.sales.import_done_report", "导入完成报告")+'</div>'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">'+
        t("html.sales.total_rows_open", "<span>总行数：")+(res.total||0)+t("html.unit.tiao_close", " 条</span>")+
        t('gen.L2780.1','<span style="color:#52c41a">新增：')+(res.inserted||0)+t('gen.L2780.2',' 条</span>')+
        t('gen.L2781.1','<span style="color:#1890ff">更新：')+(res.updated||0)+t('gen.L2781.2',' 条</span>')+
        t('gen.L2782.1','<span style="color:#faad14">重复无变化：')+(res.skipped||0)+t('gen.L2782.2',' 条</span>')+
        t('gen.L2783.1','<span style="color:#ff3b30">失败：')+(res.failed||0)+t('gen.L2783.2',' 条</span>')+
      '</div>';
    if(window._lastSalesImportErrors.length>0){
      html+='<div style="margin-top:10px"><div style="font-weight:600;color:#ff3b30;margin-bottom:6px">'+t("html.inv.fail_detail", "失败明细")+'</div>';
      html+=window._lastSalesImportErrors.slice(0,20).map(function(e){return t('gen.L2787.1','<div style="color:#666">第 ')+e.row+t('gen.L2787.2',' 行：')+esc(e.reason)+'</div>'}).join('');
      if(window._lastSalesImportErrors.length>20)html+=t('gen.L2788.1','<div style="color:#999">还有 ')+(window._lastSalesImportErrors.length-20)+t('gen.L2788.2',' 条失败...</div>');
      html+='<button type="button" class="btn btn-secondary" style="margin-top:10px" onclick="downloadSalesImportErrors()">'+t("html.inv.download_fail", "下载失败明细")+'</button></div>';
    }
    html+='</div>';
    document.getElementById('sales-result').innerHTML=html;
    showToast(t('toast.importDone4','导入完成：新增{c}，更新{u}，重复{s}，失败{f}',{c:res.inserted||0, u:res.updated||0, s:res.skipped||0, f:res.failed||0}),res.failed>0?'warning':'success');
    loadSales();
  }catch(e){
    showToast(e.message||t("toast.import_failed", "导入失败"),'danger');
  }finally{
    btn.disabled=false;btn.textContent=t("app.067", "\u5f00\u59cb\u5bfc\u5165");
  }
}

function downloadSalesImportErrors(){
  if(!window._lastSalesImportErrors||window._lastSalesImportErrors.length===0)return;
  var ws=XLSX.utils.aoa_to_sheet([[t("col.row_no", "行号"),t("html.batch.err_reason", "失败原因")]].concat(window._lastSalesImportErrors.map(function(e){return [e.row,e.reason]})));
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,t("html.inv.fail_detail", "失败明细"));
  XLSX.writeFile(wb,t("app.650", "\u9500\u552e\u5bfc\u5165\u5931\u8d25\u660e\u7ec6.xlsx"));
}

// ==================== 库存总表 ====================
let invDataCache = [];
let invAllFilteredIds = [];
let invSelectAllMode = false;

const INV_STATUS_OPTS = [
  {val:'normal',label:t("inventory.005", "\u6b63\u5e38")},{val:'out_of_stock_risk',label:t("app.651", "\u65ad\u8d27\u98ce\u9669")},
  {val:'high_stock',label:t("app.652", "\u9ad8\u5e93\u5b58")},{val:'slow_moving',label:t("app.653", "\u6162\u9500")},
  {val:'clearance',label:t("app.555", "\u6e05\u4ed3")},{val:'abnormal',label:t("app.238", "\u5f02\u5e38")}
];
function invStatusLabel(v){const o=INV_STATUS_OPTS.find(x=>x.val===v);return o?o.label:v||'-';}
function invStatusBadge(v){
  const cls={'normal':'status-normal','out_of_stock_risk':'status-danger','high_stock':'status-warning','slow_moving':'status-warning','clearance':'status-warning','abnormal':'status-danger'}[v]||'status-normal';
  return '<span class="status-badge '+cls+'">'+invStatusLabel(v)+'</span>';
}

async function renderInventory(){
  invDataCache = []; invAllFilteredIds = []; invSelectAllMode = false;
  document.getElementById('content-inner').innerHTML=
    t('html.renderInventory', `<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>国家</label><select id="inv-c"><option value="">全部</option></select></div><div class="filter-group"><label>仓库</label><select id="inv-w"><option value="">全部</option></select></div><div class="filter-group"><label>品牌</label><select id="inv-b"><option value="">全部</option></select></div><div class="filter-group"><label>关键词</label><input type="text" id="inv-k" placeholder="SKU/产品名" onkeypress="if(event.key==='Enter')loadInv()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadInv()">搜索</button>{v1}</div></div></div><div id="inv-batch-bar" style="display:none;background:var(--bg-card,#fff);border:1px solid var(--border,#e0e0e0);border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span id="inv-batch-count" style="font-weight:600;margin-right:8px"></span><button class="btn btn-sm btn-secondary" onclick="invBatchAction('export')">📊 导出</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_status')">🏷️ 库存状态</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_focused')">⭐ 重点关注</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_safety_stock')">🛡️ 安全库存</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_turnover')">🎯 目标周转</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_replenish_rule')">📋 补货规则</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_remark')">📝 库存备注</button><button class="btn btn-sm btn-warning" onclick="invBatchAction('inventory_adjust')">🔧 发起调整单</button><button class="btn btn-sm btn-danger" onclick="invBatchAction('delete')" style="background:#ff4d4f;color:#fff;border:none">🗑️ 删除</button><button class="btn btn-sm btn-secondary" onclick="invClearSelection()" style="margin-left:auto">取消选择</button></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📦 库存总表</div><div class="table-section-title-right" id="inv-rate-display" style="font-size:12px;color:#666;display:flex;gap:12px;align-items:center"></div></div><div id="inv-table"></div></div>`, {v1: hasPermission('inventory_import')?t('gen.L2829.1','<button class="btn btn-secondary btn-sm" onclick="openInvBatchImport()">📥 导入库存</button>'):''});
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
          rateRowsHtml += '<div style="background:#fff4e6;padding:3px 10px;border-radius:12px;white-space:nowrap;color:#ff4d4f">CNY:' + esc(ci.code) + t('gen.L2879.1','　无汇率</div>');
        }
      }
    });
    if(rateRowsHtml){
      rateRowsHtml = t('gen.L2884.1','<span style="color:#999;margin-right:4px;align-self:center">汇率(') + (rateInfo.rate_date||'') + '):</span>'
        + '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">' + rateRowsHtml + '</div>'
        + '<button class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:11px;margin-left:6px;align-self:center" onclick="refreshInvRates()">'+'🔄 '+t("action.refresh", "刷新")+'</button>';
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
    const cols = ['SKU',t("app.113", "\u56fd\u5bb6"),t("app.114", "\u4ed3\u5e93"),t("app.112", "\u54c1\u724c"),t("col.available", "可用"),t("app.655", "\u5b89\u5168\u5e93\u5b58"),t("col.in_transit", "在途"),t("app.656", "PI\u672a\u53d1"),t("app.657", "PO\u672a\u786e"),t("app.619", "\u52a0\u6743\u6210\u672c"),t("app.658", "\u5e93\u5b58\u91d1\u989d(\u672c\u5e01)"),t("app.659", "\u5e93\u5b58\u91d1\u989d(\u00a5)"),t("app.660", "\u76ee\u6807\u5468\u8f6c"),t("app.661", "\u5b9e\u9645\u5468\u8f6c"),t("app.662", "\u6700\u540e\u5165\u5e93"),t("app.663", "\u8ddd\u6700\u540e\u5165\u5e93\u5929\u6570"),t("app.664", "\u5e93\u9f84\u98ce\u9669"),t("app.665", "\u9996\u6b21\u5165\u5e93"),t("app.666", "\u5e93\u5b58\u5feb\u7167\u622a\u6b62"),t("app.667", "\u6700\u540e\u51fa\u5e93"),t("col.inv_status", "库存状态"),t("app.668", "\u91cd\u70b9\u5173\u6ce8"),t("col.remark", "备注")];
    document.getElementById('inv-table').innerHTML=t('html.loadInv', '<div class="table-container" style="box-shadow:none;border-radius:0;max-width:100%"><table class="data-table"><thead><tr><th class="col-sticky" style="width:32px;left:0;background:#fafbfc"><input type="checkbox" id="inv-check-all" onchange="toggleAllInv(this.checked)"></th><th class="col-sticky" style="white-space:nowrap;left:32px;background:#fafbfc">SKU<br><a href="javascript:void(0)" onclick="selectAllInvFiltered()" style="font-size:11px;color:var(--primary,#2e7d32)">全选全部({v1})</a></th>{v2}</tr></thead><tbody>{v3}</tbody></table></div>', {v1: invAllFilteredIds.length, v2: cols.slice(1).map(h=>'<th>'+h+'</th>').join(''), v3: !data.length?'<tr><td colspan="'+(cols.length+1)+t('gen.L2908.1','" style="text-align:center;padding:30px;color:#999">暂无库存数据</td></tr>')
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
            if(diffDays <= 90){agingRisk=t("inventory.005", "\u6b63\u5e38");agingRiskClass='status-completed';}
            else if(diffDays <= 180){agingRisk=t("app.670", "\u5173\u6ce8");agingRiskClass='status-warning';}
            else if(diffDays <= 365){agingRisk=t("app.671", "\u9ad8\u5e93\u9f84");agingRiskClass='status-danger';}
            else{agingRisk=t("app.672", "\u8d85\u9ad8\u5e93\u9f84");agingRiskClass='status-danger';}
          }
        } else {
          agingRisk = t("app.673", "\u672a\u77e5");
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
        +'<td class="text-right">'+(daysSinceLastInbound!=='-'?daysSinceLastInbound+t('gen.L2947.1','天'):t("app.673", "\u672a\u77e5"))+'</td>'
        +'<td><span class="status-badge '+agingRiskClass+'">'+agingRisk+'</span></td>'
        +'<td class="cell-date">'+fmtDate(i.first_inbound_date)+'</td>'
        +'<td class="cell-date">'+fmtDate(i.snapshot_cutoff_date)+'</td>'
        +'<td class="cell-date">'+fmtDate(i.last_outbound_date)+'</td>'
        +'<td>'+invStatusBadge(i.inventory_status)+'</td>'
        +'<td>'+(i.is_focused?'⭐':'')+'</td>'
        +'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="'+esc(i.inventory_remark||'')+'">'+esc(i.inventory_remark||'')+'</td>'
      +'</tr>';
      }).join('')});
  }catch(e){showFlash(e.message,'danger')}
}

async function refreshInvRates(){
  try{
    // 删除今天的缓存汇率，强制重新从API获取
    await api('/api/exchange-rates/refresh','POST',{});
    showToast(t("toast.rate_refreshed", "汇率已刷新"),'success');
    loadInv();
  }catch(e){
    // 如果没有refresh接口，直接重新加载（会从DB取或重新获取）
    showToast(t("toast.rate_refreshing", "正在刷新汇率..."),'info');
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
  if(countEl) countEl.textContent = t('text.updateInvBatchBar', '已选择 {v1} 条{v2}', {v1: ids.length, v2: invSelectAllMode?t('gen.L3005.1','（全部筛选结果）'):''});
}

async function invBatchAction(action){
  const ids = invGetSelectedIds();
  if(ids.length === 0){ showToast(t("toast.select_first", "请先选择记录"),'warning'); return; }

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
    +'<div style="font-weight:600;margin-bottom:8px">'+t("modal.batch_preview", "📋 操作预览")+'</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">'
    +t("modal.batch_affect_records_open", "<div>影响记录数: <b>")+preview.total_records+'</b></div>'
    +t("modal.batch_affect_sku_open", "<div>涉及SKU数: <b>")+preview.sku_count+'</b></div>'
    +t("modal.batch_affect_qty_open", "<div>涉及库存数量: <b>")+(preview.total_available_qty||0)+'</b></div>'
    +t("modal.batch_affect_country_open", "<div>涉及国家: <b>")+preview.countries.join(', ')+'</b></div>'
    +t("modal.batch_affect_warehouse_open", "<div>涉及仓库: <b>")+preview.warehouses.join(', ')+'</b></div>'
    +'</div></div>';

  let inputHtml = '';
  let title = '';
  let danger = false;

  if(action === 'set_status'){
    title = t("app.684", "\u6279\u91cf\u8bbe\u7f6e\u5e93\u5b58\u72b6\u6001");
    inputHtml = '<div class="form-group"><label>'+t("col.inv_status", "库存状态")+'</label><select id="batch-val" class="form-control">'+INV_STATUS_OPTS.map(o=>'<option value="'+o.val+'">'+o.label+'</option>').join('')+'</select></div>';
  } else if(action === 'set_focused'){
    title = t("app.685", "\u6279\u91cf\u8bbe\u7f6e\u91cd\u70b9\u5173\u6ce8");
    inputHtml = '<div class="form-group"><label>'+t("modal.batch_focus", "是否重点关注")+t('gen.L3048.1','</label><select id="batch-val" class="form-control"><option value="1">⭐ 设为重点关注</option><option value="0">')+t("modal.batch_unset_focus", "取消重点关注")+'</option></select></div>';
  } else if(action === 'set_safety_stock'){
    title = t("app.689", "\u6279\u91cf\u8bbe\u7f6e\u5b89\u5168\u5e93\u5b58");
    inputHtml = '<div class="form-group"><label>'+t("modal.batch_safety", "安全库存数量")+t('gen.L3051.1','</label><input type="number" id="batch-val" class="form-control" min="0" placeholder="\u8bf7\u8f93\u5165\u5b89\u5168\u5e93\u5b58\u6570\u91cf"></div>');
  } else if(action === 'set_turnover'){
    title = t("app.692", "\u6279\u91cf\u8bbe\u7f6e\u76ee\u6807\u5468\u8f6c\u6708\u6570");
    inputHtml = '<div class="form-group"><label>'+t("modal.batch_turnover", "目标周转月数")+t('gen.L3054.1','</label><input type="number" id="batch-val" class="form-control" min="0" step="0.5" placeholder="\u5982: 2, 3, 4"></div>');
  } else if(action === 'set_replenish_rule'){
    title = t("app.695", "\u6279\u91cf\u8bbe\u7f6e\u8865\u8d27\u89c4\u5219");
    inputHtml = '<div class="form-group"><label>'+t("modal.batch_rule", "补货规则")+'</label><select id="batch-val" class="form-control"><option value="auto">'+t("modal.batch_rule_auto", "自动补货")+'</option><option value="manual">'+t("modal.batch_rule_manual", "手动补货")+'</option><option value="stop">'+t("modal.batch_rule_stop", "停止补货")+'</option><option value="">'+t("modal.batch_rule_clear", "清空规则")+'</option></select></div>';
  } else if(action === 'set_remark'){
    title = t("app.701", "\u6279\u91cf\u8bbe\u7f6e\u5e93\u5b58\u5907\u6ce8");
    inputHtml = '<div class="form-group"><label>'+t("modal.batch_remark", "库存备注")+t('gen.L3060.1','</label><textarea id="batch-val" class="form-control" rows="3" placeholder="\u8bf7\u8f93\u5165\u5907\u6ce8\u5185\u5bb9"></textarea></div>');
  } else if(action === 'inventory_adjust'){
    title = t("app.704", "\u6279\u91cf\u53d1\u8d77\u5e93\u5b58\u8c03\u6574\u5355");
    danger = true;
    inputHtml = '<div class="form-group"><label>'+t("modal.batch_adj_type", "调整类型")+'</label><select id="batch-val" class="form-control"><option value="manual">'+t("modal.batch_adj_manual", "手工调整")+'</option><option value="correction">'+t("modal.batch_adj_correct", "库存纠正")+'</option><option value="loss">'+t("modal.batch_adj_loss", "盘亏")+'</option><option value="gain">'+t("modal.batch_adj_gain", "盘盈")+'</option></select></div>'
      +'<div class="form-group"><label>'+t("modal.batch_adj_reason", "调整原因（必填）")+t('gen.L3065.1','</label><textarea id="batch-reason" class="form-control" rows="3" placeholder=t("modal.batch_adj_reason_ph", "请说明调整原因") required></textarea></div>');
  } else if(action === 'delete'){
    title = t("modal.batch_del_title", "批量删除库存");
    danger = true;
    inputHtml = '<div class="form-group"><label>'+t("modal.batch_del_reason", "删除原因（必填，将记录到操作日志）")+t('gen.L3069.1','</label><textarea id="batch-reason" class="form-control" rows="3" placeholder="\u5982\uff1a\u6e05\u7406\u6d4b\u8bd5\u6570\u636e" required></textarea></div>')
      +t('gen.L3070.1','<div style="background:#fff1f0;border:1px solid #ffccc7;border-radius:6px;padding:10px;font-size:12px;color:#a8071a">⚠️ 若记录已关联库存导入/出库/调整单，将被跳过不允许删除。</div>');
  }

  const reasonHtml = action !== 'inventory_adjust' ? '<div class="form-group"><label>'+t("modal.batch_reason", "操作原因（选填）")+t('gen.L3073.1','</label><input type="text" id="batch-reason" class="form-control" placeholder="\u64cd\u4f5c\u539f\u56e0"></div>') : '';

  return '<div class="modal-header"><h3>'+(danger?'⚠️ ':'')+title+'</h3><button class="modal-close" onclick="closeModal()">×</button></div>'
    +'<div class="modal-body">'
    +previewHtml
    +inputHtml
    +reasonHtml
    +t('gen.L3080.1','<div style="margin-top:16px;padding:10px;background:#fff3cd;border-radius:6px;font-size:12px;color:#856404">⚠️ 批量操作将逐条执行，异常数据自动跳过，执行完成后展示结果报告')+(danger?t('gen.L3080.2','。此操作为高影响操作，请确认后执行。'):'')+'</div>'
    +'</div>'
    +'<div class="modal-footer">'
    +'<button class="btn btn-secondary" onclick="closeModal()">'+t("common.cancel", "取消")+'</button>'
    +'<button class="btn '+(danger?'btn-danger':'btn-primary')+'" onclick="invBatchExecute(\''+action+'\')">'+(danger?t('gen.L3084.1','确认执行'):t('gen.L3084.2','执行'))+'</button>'
    +'</div>';
}

async function invBatchExecute(action){
  const ids = invGetSelectedIds();
  const val = document.getElementById('batch-val')?.value;
  const reason = document.getElementById('batch-reason')?.value || '';

  if(action === 'set_safety_stock' && (!val || val < 0)){ showToast(t("toast.safety_required", "请输入有效的安全库存"),'warning'); return; }
  if(action === 'set_turnover' && (!val || val < 0)){ showToast(t("toast.turnover_required", "请输入有效的目标周转月数"),'warning'); return; }
  if(action === 'inventory_adjust' && !reason){ showToast(t("toast.reason_required", "调整原因不能为空"),'warning'); return; }
  if(action === 'delete' && !reason.trim()){ showToast(t("toast.del_reason_required", "删除原因不能为空"),'warning'); return; }

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
  showFlash(t("pi.001", "\u6b63\u5728\u6267\u884c\u6279\u91cf\u64cd\u4f5c..."),'info');

  try {
    const result = await api(url, 'POST', body);
    showBatchResultModal(result, 'inventory');
    invClearSelection();
    loadInv();
  } catch(e) {
    showFlash(t("toast.batch_failed", "批量操作失败: ")+e.message, 'danger');
  }
}

function invBatchExport(ids){
  const data = invDataCache.filter(d => ids.includes(d.id));
  const headers = ['SKU',t("app.232", "\u4ea7\u54c1\u540d"),t("app.112", "\u54c1\u724c"),t("app.113", "\u56fd\u5bb6"),t("app.114", "\u4ed3\u5e93"),t("html.inv_export.available", "可用库存"),t("app.655", "\u5b89\u5168\u5e93\u5b58"),t("col.in_transit", "在途"),t("app.656", "PI\u672a\u53d1"),t("app.657", "PO\u672a\u786e"),t("app.619", "\u52a0\u6743\u6210\u672c"),t("app.658", "\u5e93\u5b58\u91d1\u989d(\u672c\u5e01)"),t("shell.052", "\u5e93\u5b58\u91d1\u989d(\u4eba\u6c11\u5e01)"),t("shell.053", "\u76ee\u6807\u5468\u8f6c\u6708"),t("shell.054", "\u5b9e\u9645\u5468\u8f6c\u6708"),t("app.662", "\u6700\u540e\u5165\u5e93"),t("app.667", "\u6700\u540e\u51fa\u5e93"),t("col.inv_status", "库存状态"),t("app.668", "\u91cd\u70b9\u5173\u6ce8"),t("col.remark", "备注")];
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
      invStatusLabel(d.inventory_status), d.is_focused?t("action.yes", "是"):'', d.inventory_remark||''
    ];
  });
  if(typeof XLSX === 'undefined'){ showFlash(t("toast.xlsx_missing", "XLSX库未加载"),'danger'); return; }
  const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t("nav.inventory_total", "库存总表"));
  XLSX.writeFile(wb, t('gen.L3153.1','库存总表导出_')+new Date().toISOString().slice(0,10)+'.xlsx');
}

// ==================== 销售数据 ====================
let salesDataCache = [];
let salesAllFilteredIds = [];
let salesSelectAllMode = false;

async function renderOutbound(){
  salesDataCache = []; salesAllFilteredIds = []; salesSelectAllMode = false;
  document.getElementById('content-inner').innerHTML=
    t('html.renderOutbound', '<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>来源系统</label><select id="sr-ss"><option value="">全部</option></select></div><div class="filter-group"><label>渠道</label><select id="sr-sp"><option value="">全部</option></select></div><div class="filter-group"><label>品牌</label><select id="sr-b"><option value="">全部</option></select></div><div class="filter-group"><label>有效订单</label><select id="sr-iv"><option value="">全部</option><option value="1">有效</option><option value="0">无效</option></select></div><div class="filter-group"><label>开始日期</label><input type="date" id="sr-sd" class="form-control"></div><div class="filter-group"><label>结束日期</label><input type="date" id="sr-ed" class="form-control"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadSales()">搜索</button>{v1}</div></div></div><div id="sr-batch-bar" style="display:none;background:var(--bg-card,#fff);border:1px solid var(--border,#e0e0e0);border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span id="sr-batch-count" style="font-weight:600;margin-right:8px"></span><button class="btn btn-sm btn-secondary" onclick="salesBatchExport()">📊 导出</button><button class="btn btn-sm btn-secondary" onclick="salesClearSelection()" style="margin-left:auto">取消选择</button></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🛒 销售明细</div></div><div id="sr-table"></div></div>', {v1: hasPermission('outbound_import')?t('gen.L3164.1','<button class="btn btn-secondary btn-sm" onclick="openSalesBatchImport()">📥 导入</button>'):''});
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
    const cols = [t("po.018", "来源系统"),t("po.019", "订单号"),t("col.order_date", "下单日期"),t("col.channel", "渠道"),t("app.112", "\u54c1\u724c"),'SKU',t("app.232", "\u4ea7\u54c1\u540d"),t("col.quantity", "数量"),t("app.640", "\u6709\u6548\u8ba2\u5355"),t("po.022", "\u539f\u59cb\u8ba2\u5355\u72b6\u6001"),t("col.remark", "备注")];
    document.getElementById('sr-table').innerHTML=t('html.loadSales', '<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th style="width:32px"><input type="checkbox" id="sr-check-all" onchange="toggleAllSales(this.checked)"></th><th style="white-space:nowrap"><a href="javascript:void(0)" onclick="selectAllSalesFiltered()" style="font-size:11px;color:var(--primary,#2e7d32)">全选全部({v1})</a></th>{v2}</tr></thead><tbody>{v3}</tbody></table></div>', {v1: salesAllFilteredIds.length, v2: cols.slice(1).map(h=>'<th>'+h+'</th>').join(''), v3: !data.length?'<tr><td colspan="'+(cols.length+1)+t('gen.L3188.1','" style="text-align:center;padding:30px;color:#999">暂无数据</td></tr>')
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
        +'<td>'+(r.is_valid_order?t('gen.L3199.1','<span style="color:#52c41a">✅ 有效</span>'):t('gen.L3199.2','<span style="color:#999">❌ 无效</span>'))+'</td>'
        +'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.original_order_status||'')+'">'+esc(r.original_order_status||'-')+'</td>'
        +'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.remark||'')+'">'+esc(r.remark||'')+'</td>'
      +'</tr>').join('')});
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
  if(countEl) countEl.textContent = t('text.updateSalesBatchBar', '已选择 {v1} 条{v2}', {v1: ids.length, v2: salesSelectAllMode?t('gen.L3239.1','（全部筛选结果）'):''});
}

function salesBatchExport(){
  const ids = salesGetSelectedIds();
  if(ids.length === 0){ showToast(t("toast.select_first", "请先选择记录"),'warning'); return; }
  const data = salesDataCache.filter(d => ids.includes(d.id));
  const headers = [t("po.018", "来源系统"),t("po.019", "\u8ba2\u5355\u53f7"),t("po.020", "\u8ba2\u5355\u660e\u7ec6ID"),t("col.order_date", "下单日期"),t("col.channel", "渠道"),t("app.112", "\u54c1\u724c"),'SKU',t("col.quantity", "数量"),t("po.021", "\u662f\u5426\u6709\u6548\u8ba2\u5355"),t("po.022", "\u539f\u59cb\u8ba2\u5355\u72b6\u6001"),t("col.remark", "备注")];
  const rows = data.map(d => [
    d.source_system||'', d.order_no||'', d.order_detail_id||'', d.order_date||'',
    d.shop_platform||'', d.brand||'', d.sku_code||'', d.quantity||0,
    d.is_valid_order?'true':'false', d.original_order_status||'', d.remark||''
  ]);
  if(typeof XLSX === 'undefined'){ showFlash(t("toast.xlsx_missing", "XLSX库未加载"),'danger'); return; }
  const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t("app.721", "\u9500\u552e\u660e\u7ec6"));
  XLSX.writeFile(wb, t('gen.L3256.1','销售数据导出_')+new Date().toISOString().slice(0,10)+'.xlsx');
}

// ==================== SKU动销与订单预测 ====================
let rpTab = 'total'; // total | online | offline
let rpMode = 'monthly'; // monthly | daily
// 生命周期枚举值 → 业务标签
const LIFECYCLE_LABELS={
  'new_test':t("app.547", "\u65b0\u54c1\u5bfc\u5165"),
  'new_launch':t("app.548", "\u65b0\u54c1\u542f\u52a8"),
  'growth':t("app.549", "\u6210\u957f\u671f"),
  'stable':t("app.550", "\u6210\u719f\u671f"),
  'slow':t("app.551", "\u8870\u9000\u671f"),
  'stagnant':t("app.552", "\u6ede\u9500"),
  'clearance':t("app.553", "\u6e05\u4ed3\u671f"),
  'stopped':t("app.554", "\u505c\u91c7/\u505c\u4ea7")
};
const LIFECYCLE_STRATEGY={
  'new_test':{strategy:t("app.722", "\u4e0d\u76f4\u63a5\u751f\u6210PO\uff0c\u9700\u5b8c\u6210\u65b0\u54c1\u542f\u52a8\u68c0\u67e5"),coeff:0,replenish:false},
  'new_launch':{strategy:t("app.723", "\u89c2\u5bdf\u671f+\u5907\u8d27\u9884\u8b66\uff0c\u6309\u76ee\u6807\u6708\u657050%\u5efa\u8bae"),coeff:0.5,replenish:true},
  'growth':{strategy:t("app.724", "\u5141\u8bb8\u4f18\u5148\u8865\u8d27\uff0c\u6309\u76ee\u6807\u6708\u657080%\u5efa\u8bae"),coeff:0.8,replenish:true},
  'stable':{strategy:t("app.725", "\u6309\u9ed8\u8ba4\u76ee\u6807\u6708\u6570\u8865\u8d27"),coeff:1.0,replenish:true},
  'slow':{strategy:t("app.726", "\u964d\u4f4e\u76ee\u6807\u6708\u6570\uff0c\u630950%\u5efa\u8bae\u8865\u8d27"),coeff:0.5,replenish:true},
  'stagnant':{strategy:t("app.727", "\u6682\u7f13\u8865\u8d27\uff0c\u9700\u5148\u6e05\u7406\u5e93\u5b58"),coeff:0,replenish:false},
  'clearance':{strategy:t("app.728", "\u6e05\u4ed3\u671f\uff0c\u4e0d\u5efa\u8bae\u8865\u8d27"),coeff:0,replenish:false},
  'stopped':{strategy:t("app.729", "\u505c\u91c7/\u505c\u4ea7\uff0c\u4e0d\u53c2\u4e0e\u8865\u8d27\u5efa\u8bae"),coeff:0,replenish:false}
};
function fmtLifecycle(v){return LIFECYCLE_LABELS[v]||v||'-';}
// 动态读取生命周期标签（语言切换后立即生效，不依赖模块加载时的 const 快照）
function fmtLifecycleDyn(v){
  if(!v) return '-';
  var map={
    'new_test':t("app.547", "\u65b0\u54c1\u5bfc\u5165"),
    'new_launch':t("app.548", "\u65b0\u54c1\u542f\u52a8"),
    'growth':t("app.549", "\u6210\u957f\u671f"),
    'stable':t("app.550", "\u6210\u719f\u671f"),
    'slow':t("app.551", "\u8870\u9000\u671f"),
    'stagnant':t("app.552", "\u6ede\u9500"),
    'clearance':t("app.553", "\u6e05\u4ed3\u671f"),
    'stopped':t("app.554", "\u505c\u91c7/\u505c\u4ea7")
  };
  return map[v]||v;
}
// 动销分组三语显示（按天列表 sales_group 字段）
// 后端枚举值：滞销/低动销/中动销/高动销（server.js 行3479-3482）
// 仅改变显示层，不修改 API 值、数据库值和业务判断
function formatSalesGroupLabel(rawValue){
  var v=String(rawValue||'').trim();
  if(!v) return '';
  var map={
    '滞销':t('forecast.sales_group.stagnant','滞销'),
    '低动销':t('forecast.sales_group.low','低动销'),
    '中动销':t('forecast.sales_group.medium','中动销'),
    '高动销':t('forecast.sales_group.high','高动销')
  };
  return map[v]||v; // 未知值原样显示
}

// ==================== 订单预测：字段配置系统 ====================
var RP_COL_STORAGE_KEYS={total:'prediction_table_columns_total',online:'prediction_table_columns_online',offline:'prediction_table_columns_offline'};
// ==================== 订单预测：固定列宽配置（ORDER-FORECAST-FIXED-COLUMNS-01）====================
// 系统统一维护固定优化列宽，不再支持手动拖动/保存/重置列宽
// min/max 仅作为开发约束和安全验证，不用于用户交互
// 默认/最小/最大列宽配置（像素），按字段 key 查询
function rpColWidthDefs(){
  return {
    // 标识列
    check:{min:36,default:36,max:60},
    spacer:{min:28,default:36,max:48},
    model:{min:80,default:100,max:200},
    sku:{min:110,default:135,max:240},
    // 单月销量
    sales_m4:{min:65,default:72,max:120},
    sales_m3:{min:65,default:72,max:120},
    sales_m2:{min:65,default:72,max:120},
    sales_m1:{min:70,default:90,max:120},
    // 月均销量
    online_avg:{min:90,default:115,max:160},
    offline_avg:{min:90,default:115,max:160},
    total_avg:{min:90,default:115,max:160},
    channel_avg:{min:90,default:115,max:160},
    // 占比
    online_pct:{min:65,default:72,max:120},
    offline_pct:{min:65,default:72,max:120},
    channel_pct:{min:65,default:72,max:120},
    // 库存
    avail:{min:95,default:105,max:180},
    transit:{min:95,default:105,max:180},
    pool:{min:80,default:100,max:140},
    po_unconfirmed:{min:75,default:95,max:140},
    pi_unshipped:{min:85,default:100,max:160},
    // 周转
    avail_turnover:{min:75,default:90,max:130},
    transit_turnover:{min:75,default:90,max:130},
    current_turn:{min:75,default:90,max:130},
    after_order_turnover:{min:80,default:95,max:140},
    // 采购
    target_turn:{min:75,default:90,max:130},
    target_stock:{min:85,default:100,max:150},
    total_target_stock:{min:85,default:100,max:150},
    online_target_turn:{min:75,default:90,max:130},
    offline_target_turn:{min:75,default:90,max:130},
    online_target_stock:{min:85,default:100,max:150},
    offline_target_stock:{min:85,default:100,max:150},
    // 日期
    last_inbound_date:{min:85,default:100,max:140},
    days_since_last_inbound:{min:75,default:90,max:130},
    arrival_month:{min:75,default:95,max:130},
    // 状态/动作/说明性文本
    sales_status:{min:80,default:105,max:180},
    risk_tags:{min:100,default:120,max:240},
    sales_reason:{min:100,default:145,max:240},
    action_rec:{min:100,default:150,max:220},
    ai_business_advice:{min:120,default:180,max:300},
    sales_judgement:{min:120,default:120,max:200},
    review:{min:50,default:70,max:100},
    remark:{min:100,default:145,max:240},
    suggestion:{min:100,default:140,max:220},
    actions:{min:60,default:70,max:100}
  };
}
// 获取某列固定宽度：直接返回系统默认值，不读取 localStorage
function rpColWidth(key){
  return rpColWidthDef(key).default;
}
// 生成 colgroup HTML（header/summary/body 共用，保证严格对齐）
// 安全 fallback：未找到专属定义时使用通用 {min:60,default:100,max:200}，防止 undefined.min 崩溃
var RP_COL_WIDTH_DEFAULT={min:60,default:100,max:200};
function rpColWidthDef(key){
  var defs=rpColWidthDefs();
  return defs[key]||RP_COL_WIDTH_DEFAULT;
}
function rpColgroupHtml(activeKeys){
  var cols=activeKeys.map(function(k){
    var def=rpColWidthDef(k);
    return '<col data-col-key="'+k+'" style="width:'+rpColWidth(k)+'px;min-width:'+def.min+'px;max-width:'+def.max+'px">';
  }).join('');
  return '<colgroup>'+cols+'</colgroup>';
}
// 计算当前 activeKeys 的固定宽度总和（纯函数，用于 table width/min-width）
// 防止 .data-table{width:100%} 压缩列宽到容器宽度
function rpColWidthTotal(activeKeys){
  return activeKeys.reduce(function(sum,k){return sum+rpColWidth(k);},0);
}
// 表头语义换行：在指定位置插入 <br>，不拆散术语
// 仅渠道独立页签使用 compact 文案；Total 页签保留 channel 区分
// compact=true 时表头不含渠道词，允许更紧凑换行
function rpThCompact(label, help, cls, extra, compact){
  var c=cls||'';
  var e=extra||'';
  // label 中已含 <br> 的直接渲染，不二次处理
  var h='';
  if(help){
    h='<span class="rp-th-help" data-tip="'+esc(help)+'"></span>';
  }
  // compact 模式：表头允许换行（CSS white-space:normal 已在 th 上）
  // label 中的 \n 转换为 <br>，支持语义换行控制
  var displayLabel=label;
  if(compact){
    displayLabel=String(label).replace(/\n/g,'<br>');
  }
  return '<th class="rp-th-compact '+c+'" '+e+'>'+displayLabel+h+'</th>';
}

// 总预测列元数据（key,label,fixed,visibleByDefault）
// 通用表头 helper：生成带问号 tooltip 的 th
// label: 字段名, help: 说明文字, cls: th 的 class（如 'text-right'）, extra: th 的额外属性
// 说明气泡通过事件委托渲染到 body 下的 #global-tooltip，避免被 table-container overflow 裁剪
function rpTh(label, help, cls, extra){
  var c=cls||'';
  var e=extra||'';
  var h='';
  if(help){
    h='<span class="rp-th-help" data-tip="'+esc(help)+'"></span>';
  }
  return '<th class="'+c+'" '+e+'>'+esc(label)+h+'</th>';
}
// 全局 tooltip：事件委托，hover/focus 显示，mouseout/blur/外部点击 关闭
// 渲染到 body 下的 #global-tooltip，fixed 定位，避免被 table-container 裁剪
var _rpTooltipEl=null;
function _rpGetTooltipEl(){
  if(!_rpTooltipEl) _rpTooltipEl=document.getElementById('global-tooltip');
  return _rpTooltipEl;
}
function _rpShowTooltip(icon){
  var tip=icon.getAttribute('data-tip');
  if(!tip) return;
  var el=_rpGetTooltipEl();
  if(!el) return;
  el.textContent=tip;
  el.classList.add('visible');
  // 先显示才能测量尺寸
  var rect=icon.getBoundingClientRect();
  var tw=el.offsetWidth, th=el.offsetHeight;
  var gap=8;
  var vw=window.innerWidth, vh=window.innerHeight;
  // 优先显示在上方，空间不够则下方
  var above=rect.top - th - gap;
  var below=rect.bottom + gap;
  var showAbove = above >= 0 || (below + th + gap) > vh;
  var top = showAbove ? (rect.top - th - gap) : below;
  // 水平居中对齐 icon，右侧不够则左偏，左侧不够则贴左边
  var left = rect.left + rect.width/2 - tw/2;
  if(left + tw > vw - 8) left = vw - tw - 8;
  if(left < 8) left = 8;
  el.style.left=left+'px';
  el.style.top=top+'px';
  el.classList.toggle('tip-above',showAbove);
  el.classList.toggle('tip-below',!showAbove);
}
function _rpHideTooltip(){
  var el=_rpGetTooltipEl();
  if(el){ el.classList.remove('visible','tip-above','tip-below'); el.textContent=''; }
}
// 事件委托：在 document 上监听 .rp-th-help 的 mouseover/mouseout/focusin/focusout
document.addEventListener('mouseover',function(e){
  var icon=e.target.closest && e.target.closest('.rp-th-help');
  if(icon && icon.getAttribute('data-tip')) _rpShowTooltip(icon);
});
document.addEventListener('mouseout',function(e){
  var icon=e.target.closest && e.target.closest('.rp-th-help');
  if(icon) _rpHideTooltip();
});
document.addEventListener('focusin',function(e){
  var icon=e.target.closest && e.target.closest('.rp-th-help');
  if(icon && icon.getAttribute('data-tip')) _rpShowTooltip(icon);
});
document.addEventListener('focusout',function(e){
  var icon=e.target.closest && e.target.closest('.rp-th-help');
  if(icon) _rpHideTooltip();
});
// 点击非 tooltip 触发元素时关闭
document.addEventListener('click',function(e){
  var icon=e.target.closest && e.target.closest('.rp-th-help');
  if(!icon) _rpHideTooltip();
});
// 横向滚动时位置需重算：滚动中隐藏 tooltip 避免错位
window.addEventListener('scroll',function(){ _rpHideTooltip(); },true);
function rpTotalColMeta(){
  return [
    {key:'check',label:t('gen.L3364.1','选择'),fixed:true},
    {key:'model',label:'Model',fixed:true},
    {key:'sku',label:'SKU',fixed:true},
    {key:'online_avg',label:t('gen.L3367.1','线上')+rpSalesStatsDays+t('gen.L3367.2','天月均销量')},
    {key:'offline_avg',label:t('gen.L3368.1','线下')+rpSalesStatsDays+t('gen.L3368.2','天月均销量')},
    {key:'total_avg',label:rpSalesStatsDays+t('gen.L3369.1','天月均销量')},
    {key:'avail',label:t("app.730", "\u5f53\u524d\u53ef\u7528\u5e93\u5b58")},
    {key:'transit',label:t('gen.L3371.1','在途库存')},
    {key:'pi_unshipped',label:t("app.731", "PI\u5df2\u786e\u8ba4\u672a\u53d1\u8d27")},
    {key:'po_unconfirmed',label:t("app.732", "PO\u672a\u786e\u8ba4PI")},
    {key:'total_target_stock',label:t("app.109", "\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf"),fixed:true},
    {key:'avail_turnover',label:t('gen.L3375.1','当前可用周转')},
    {key:'transit_turnover',label:t("app.733", "\u5728\u9014\u540e\u5468\u8f6c")},
    {key:'after_order_turnover',label:t("app.734", "\u4e0b\u5355\u540e\u5468\u8f6c")},
    {key:'last_inbound_date',label:t("po.012", "\u6700\u540e\u5165\u5e93\u65e5\u671f")},
    {key:'days_since_last_inbound',label:t("app.663", "\u8ddd\u6700\u540e\u5165\u5e93\u5929\u6570")},
    {key:'sales_status',label:t("app.735", "\u52a8\u9500\u72b6\u6001")},
    {key:'risk_tags',label:t("app.736", "\u98ce\u9669\u6807\u7b7e")},
    {key:'action_rec',label:t("app.111", "\u5efa\u8bae\u52a8\u4f5c")},
    {key:'ai_business_advice',label:t("app.737", "AI\u5efa\u8bae")},
    {key:'actions',label:t("common.actions", "\u64cd\u4f5c")},
    // --- 以下默认隐藏 ---
    {key:'online_pct',label:t("app.738", "\u7ebf\u4e0a\u5360\u6bd4"),visibleByDefault:false},
    {key:'offline_pct',label:t("app.739", "\u7ebf\u4e0b\u5360\u6bd4"),visibleByDefault:false},
    {key:'pool',label:t("app.740", "\u603b\u5e93\u5b58\u6c60"),visibleByDefault:false},
    {key:'current_turn',label:t("app.741", "\u5f53\u524d\u5468\u8f6c"),visibleByDefault:false},
    {key:'sales_reason',label:t("app.742", "\u52a8\u9500\u539f\u56e0"),visibleByDefault:false},
    {key:'online_target_turn',label:t("app.743", "\u7ebf\u4e0a\u76ee\u6807\u5468\u8f6c"),visibleByDefault:false},
    {key:'offline_target_turn',label:t("app.744", "\u7ebf\u4e0b\u76ee\u6807\u5468\u8f6c"),visibleByDefault:false},
    {key:'online_target_stock',label:t("app.745", "\u7ebf\u4e0a\u5efa\u8bae"),visibleByDefault:false},
    {key:'offline_target_stock',label:t("app.746", "\u7ebf\u4e0b\u5efa\u8bae"),visibleByDefault:false},
    {key:'arrival_month',label:t("app.747", "\u5230\u8d27\u6708\u4efd"),visibleByDefault:false},
    // legacy 'suggestion' 字段已移除：由 'action_rec' 统一展示建议操作
  ];
}
// 规范化 risk_tags（兼容数组和逗号字符串）
function normalizeRiskTags(risk_tags) {
  if (Array.isArray(risk_tags)) return risk_tags.map(function(t){return String(t).trim();}).filter(Boolean);
  if (typeof risk_tags === 'string') return risk_tags.split(',').map(function(t){return t.trim();}).filter(Boolean);
  return [];
}
// 业务拦截：判断是否应该阻止自动补货
function shouldBlockReplenish(sales_status, risk_tags) {
  var tags = normalizeRiskTags(risk_tags);
  if ([t('gen.L3408.1','清仓'),t("app.554", "\u505c\u91c7/\u505c\u4ea7"),t("app.749", "\u65e0\u6709\u6548\u9500\u552e"),t("app.750", "\u5446\u6ede"),t('gen.L3408.2','慢销')].indexOf(sales_status) >= 0) return true;
  if (tags.indexOf(t("app.751", "\u9ad8\u5e93\u5b58\u4e25\u91cd"))>=0 || tags.indexOf(t("app.752", "\u9ad8\u5e93\u5b58\u5173\u6ce8"))>=0 || tags.indexOf(t("app.753", "\u9ad8\u5e93\u9f84\u98ce\u9669"))>=0) return true;
  if (tags.indexOf(t("app.754", "\u65b0\u54c1\u65e0\u9500\u91cf"))>=0) return true;
  return false;
}
// 动销判断 = 动销状态（主标签）+ 风险标签（小 pill 标签），分层展示
function buildSalesJudgement(r){
  var status=(r.sales_status||'').trim();
  var raw=r.risk_tags||'';
  var tags=Array.isArray(raw)?raw:String(raw).split(',').map(function(s){return s.trim();}).filter(Boolean);
  if(!status && !tags.length) return '<span class="text-muted">-</span>';
  var html='<div class="sales-judgement">';
  // 显示层翻译：status 和 tags 均通过 format 函数翻译，原始值不变
  var statusText=status?formatForecastSalesStatus(status):t("app.673", "\u672a\u77e5");
  html+='<span class="sj-status">'+esc(statusText)+'</span>';
  if(tags.length){
    html+='<div class="sj-tags">';
    tags.forEach(function(tg){ html+='<span class="sj-tag">'+esc(formatForecastRiskTag(tg))+'</span>'; });
    html+='</div>';
  }
  html+='</div>';
  return html;
}
// 建议动作简化映射：长文案 → 简短动作（无法匹配返回原值）
function simplifyAction(action){
  var a=String(action||'').trim();
  if(!a) return '';
  var map=[
    [/停止采购.*消化库存/, t('gen.L3434.1','暂缓补货')],
    [/停止采购.*不参与补货/, t('gen.L3435.1','暂缓补货')],
    [/优先复核补货.*确认现货/, t('gen.L3436.1','优先补货')],
    [/优先复核补货.*避免断货/, t('gen.L3437.1','优先补货')],
    [/谨慎补货.*消化库存/, t('gen.L3438.1','谨慎补货')],
    [/按目标周转正常补货/, t('gen.L3439.1','正常补货')],
    [/人工复核目标周转.*暂缓补货/, t('gen.L3440.1','人工复核')],
    [/暂停补货.*清库存/, t('gen.L3441.1','暂停补货')],
    [/检查上架.*暂缓补货/, t('gen.L3442.1','暂缓补货')]
  ];
  for(var i=0;i<map.length;i++){ if(map[i][0].test(a)) return map[i][1]; }
  return a;
}
// === 订单预测系统生成值三语显示（显示层翻译，不改原始数据/API/数据库）===
// Suggested Action 显式静态映射（action 原始值 -> i18n key 的中文 fallback）
function formatForecastAction(rawValue){
  var v=String(rawValue||'').trim();
  if(!v) return '';
  var MAP={
    '停止采购，优先消化库存':'forecast.action.clearance',
    '停止采购，不参与补货':'forecast.action.stopped',
    '人工复核目标周转，暂缓补货':'forecast.action.new_product',
    '检查上架/价格/渠道，暂缓补货':'forecast.action.no_sales',
    '优先复核补货，确认现货':'forecast.action.stockout',
    '优先复核补货，避免断货':'forecast.action.stockout_risk',
    '暂停补货，先清库存':'forecast.action.stagnant',
    '谨慎补货，先消化库存':'forecast.action.slow_sales',
    '按目标周转正常补货':'forecast.action.normal',
    '人工复核后决定':'forecast.action.review',
    '停止采购，优先清库存':'forecast.action.brand_stopped'
  };
  var key=MAP[v];
  if(!key) return v; // 未识别值原样显示，不翻译自由文本
  return t(key, v); // 中文模式 fallback 为原始值，英文/印尼文返回翻译
}
// Movement Judgment / Sales Status 显式静态映射
function formatForecastSalesStatus(rawValue){
  var v=String(rawValue||'').trim();
  if(!v) return '';
  var MAP={
    '正常动销':'forecast.movement.normal',
    '清仓':'forecast.movement.clearance',
    '停采/停产':'forecast.movement.stopped',
    '新品/销售数据不足':'forecast.movement.new_product',
    '无有效销售':'forecast.movement.no_sales',
    '缺货':'forecast.movement.stockout',
    '缺货风险':'forecast.movement.stockout_risk',
    '呆滞':'forecast.movement.stagnant',
    '慢销':'forecast.movement.slow_sales',
    '停采/清库存':'forecast.movement.brand_stopped'
  };
  var key=MAP[v];
  if(!key) return v;
  return t(key, v);
}
// Risk Tags 显式静态映射（支持逗号分隔字符串或数组）
var FORECAST_RISK_MAP={
  '高库存关注':'forecast.risk.high_stock_attention',
  '高库存严重':'forecast.risk.high_stock_severe',
  '高库龄风险':'forecast.risk.high_age',
  '库龄未知':'forecast.risk.age_unknown',
  '销量失真':'forecast.risk.sales_distortion',
  '新品无销量':'forecast.risk.new_product_no_sales'
};
// 单个 risk tag 翻译（供 buildSalesJudgement 逐个标签使用）
function formatForecastRiskTag(rawValue){
  var tg=String(rawValue||'').trim();
  if(!tg) return '';
  var key=FORECAST_RISK_MAP[tg];
  return key?t(key,tg):tg; // 未识别值原样显示
}
function formatForecastRiskTags(rawValue){
  var raw=rawValue||'';
  var tags=Array.isArray(raw)?raw:String(raw).split(',');
  var out=[];
  for(var i=0;i<tags.length;i++){
    var tg=String(tags[i]||'').trim();
    if(!tg) continue;
    out.push(formatForecastRiskTag(tg));
  }
  return out.join(', ');
}
// formatForecastSalesReason / formatForecastAiAdvice 已删除：
// sales_reason / ai_business_advice 由后端 forecastDisplayT 按请求语言翻译确定性模板后直接显示，
// 前端不再重新生成或缩减（保持信息等价）
// 线上/线下预测列元数据
function rpChannelColMeta(){
  return [
    {key:'spacer',label:t("app.761", "\u5360\u4f4d"),fixed:true},
    {key:'model',label:'Model',fixed:true},
    {key:'sku',label:'SKU',fixed:true},
    {key:'sales_m4',label:t("app.762", "\u8fd14\u6708\u6e20\u9053\u9500\u91cf")},
    {key:'sales_m3',label:t("app.763", "\u8fd13\u6708\u6e20\u9053\u9500\u91cf")},
    {key:'sales_m2',label:t("app.764", "\u8fd12\u6708\u6e20\u9053\u9500\u91cf")},
    {key:'sales_m1',label:t("app.765", "\u672c\u6708\u6e20\u9053\u9500\u91cf")},
    {key:'channel_avg',label:t('gen.L3457.1','渠道')+rpSalesStatsDays+t('gen.L3457.2','天月均销量')},
    {key:'channel_pct',label:t("app.766", "\u6e20\u9053\u5360\u6bd4")},
    // --- 库存判断字段（按用户指定顺序）---
    {key:'avail',label:t("app.767", "\u5206\u644a\u53ef\u7528\u5e93\u5b58")},
    {key:'transit',label:t("app.768", "\u5206\u644a\u5728\u9014\u5e93\u5b58")},
    {key:'avail_turnover',label:t('gen.L3462.1','当前可用周转')},
    {key:'transit_turnover',label:t("app.733", "\u5728\u9014\u540e\u5468\u8f6c")},
    {key:'po_unconfirmed',label:t("app.732", "PO\u672a\u786e\u8ba4PI")},
    {key:'pi_unshipped',label:t("app.731", "PI\u5df2\u786e\u8ba4\u672a\u53d1\u8d27")},
    {key:'target_turn',label:t("app.660", "\u76ee\u6807\u5468\u8f6c"),visibleByDefault:false},
    {key:'target_stock',label:t('gen.L3467.1','建议采购'),fixed:true},
    {key:'after_order_turnover',label:t("app.734", "\u4e0b\u5355\u540e\u5468\u8f6c")},
    // --- 默认展示：结果 + 动作 ---
    {key:'sales_judgement',label:t("app.110", "\u52a8\u9500\u5224\u65ad")},
    {key:'action_rec',label:t("app.111", "\u5efa\u8bae\u52a8\u4f5c")},
    {key:'review',label:t('gen.L3472.1','复盘')},
    // --- 复盘详情字段（默认隐藏，可在字段配置中开启）---
    {key:'sales_status',label:t("app.735", "\u52a8\u9500\u72b6\u6001"),visibleByDefault:false},
    {key:'risk_tags',label:t("app.736", "\u98ce\u9669\u6807\u7b7e"),visibleByDefault:false},
    {key:'sales_reason',label:t("app.742", "\u52a8\u9500\u539f\u56e0"),visibleByDefault:false},
    {key:'ai_business_advice',label:t("app.737", "AI\u5efa\u8bae"),visibleByDefault:false},
    {key:'last_inbound_date',label:t("po.012", "\u6700\u540e\u5165\u5e93\u65e5\u671f")},
    {key:'days_since_last_inbound',label:t("app.663", "\u8ddd\u6700\u540e\u5165\u5e93\u5929\u6570")},
    {key:'remark',label:t("app.025", "\u5907\u6ce8")},
    {key:'actions',label:t("common.actions", "\u64cd\u4f5c"),visibleByDefault:false},
  ];
}
// 读取字段配置：返回 [{key,label,fixed,visible}] 按保存顺序，新列追加到末尾
function getRpColConfig(tabKey){
  var defs = tabKey==='total' ? rpTotalColMeta() : rpChannelColMeta();
  var storageKey=RP_COL_STORAGE_KEYS[tabKey];
  var saved=null;
  try{saved=JSON.parse(localStorage.getItem(storageKey));}catch(e){}
  // 一次性迁移：仅 online/offline，将「动销状态/风险标签/动销原因/AI建议」默认隐藏
  // 不影响 total，不清空其它字段配置；迁移后写入版本标记，后续不再执行
  if(tabKey!=='total'){
    var migKey='rp_col_config_v2_'+tabKey;
    if(localStorage.getItem(migKey)!=='1'){
      if(Array.isArray(saved)&&saved.length){
        var HIDE_KEYS={sales_status:1,risk_tags:1,sales_reason:1,ai_business_advice:1};
        var migrated=saved.map(function(s){
          if(HIDE_KEYS[s.key]) return {key:s.key,visible:false};
          return s;
        });
        // 追加新列（若旧配置里没有）
        var existKeys={};
        migrated.forEach(function(s){existKeys[s.key]=1;});
        defs.forEach(function(d){
          if((d.key==='sales_judgement'||d.key==='review')&&!existKeys[d.key]){
            migrated.push({key:d.key,visible:d.visibleByDefault!==false});
          }
        });
        localStorage.setItem(storageKey,JSON.stringify(migrated));
        saved=migrated;
      }
      localStorage.setItem(migKey,'1');
    }
    // v3 迁移：将「目标周转」默认隐藏（不影响其它字段）
    var migKey3='rp_col_config_v3_'+tabKey;
    if(localStorage.getItem(migKey3)!=='1'){
      if(Array.isArray(saved)&&saved.length){
        saved=saved.map(function(s){
          if(s.key==='target_turn') return {key:s.key,visible:false};
          return s;
        });
        localStorage.setItem(storageKey,JSON.stringify(saved));
      }
      localStorage.setItem(migKey3,'1');
    }
    // v4 迁移：将「操作」列默认隐藏（不影响其它字段，保留 saveChannelChanges 供字段配置开启后使用）
    var migKey4='rp_col_config_v4_'+tabKey;
    if(localStorage.getItem(migKey4)!=='1'){
      if(Array.isArray(saved)&&saved.length){
        saved=saved.map(function(s){
          if(s.key==='actions') return {key:s.key,visible:false};
          return s;
        });
        localStorage.setItem(storageKey,JSON.stringify(saved));
      }
      localStorage.setItem(migKey4,'1');
    }
  }
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
// 构建单个字段行 HTML（含冻结到此列单选控件）
function buildRpCfgItem(c, tabKey){
  var hidden = (!c.visible && !c.fixed);
  var dimmedClass = hidden ? ' rp-cfg-item-hidden' : '';
  var fixedBadge = c.fixed ? t('gen.L3562.1','<span class="rp-cfg-badge-fixed">固定</span>') : '';
  var checked = (c.visible || c.fixed) ? 'checked' : '';
  var disabled = c.fixed ? 'disabled' : '';
  // 冻结单选：仅可见字段可选，隐藏字段禁用
  var freezeKey = getFreezeColKey(tabKey);
  var isFreezeBoundary = (freezeKey === c.key);
  var freezeDisabled = hidden ? 'disabled' : '';
  var freezeChecked = (isFreezeBoundary && !hidden) ? 'checked' : '';
  return '<div class="rp-cfg-item'+dimmedClass+'" data-key="'+c.key+'" data-fixed="'+(c.fixed?1:0)+'" draggable="true">'
    + t('gen.L3566.1','<span class="rp-cfg-handle" title="\u62d6\u62fd\u6392\u5e8f">⠿</span>')
    + '<span class="rp-cfg-name">'+esc(c.label||t("app.771", "(\u7a7a)"))+'</span>'
    + fixedBadge
    + '<label class="rp-cfg-freeze" title="'+t('freeze.column.to','冻结到此列')+'">'
    + '<input type="radio" name="rp-freeze-boundary" class="rp-cfg-freeze-radio" data-key="'+c.key+'" '+freezeChecked+' '+freezeDisabled+'>'
    + '<span>'+t('freeze.column.to','冻结到此列')+'</span>'
    + '</label>'
    + '<label class="rp-cfg-switch">'
    + '<input type="checkbox" class="rp-cfg-vis" data-key="'+c.key+'" '+checked+' '+disabled+' onchange="onRpCfgToggle(this,\''+tabKey+'\')">'
    + '<span class="rp-cfg-slider"></span>'
    + '</label>'
    + '</div>';
}
// 打开字段配置面板
function openRpFieldConfig(tabKey){
  // 按天模式：只显示冻结列配置，不显示按月字段隐藏/排序
  if(rpMode==='daily'){
    return openRpDailyFieldConfig(tabKey);
  }
  var config=getRpColConfig(tabKey);
  var tabLabel = tabKey==='total'?t('gen.L3578.1','总预测'):tabKey==='online'?t('gen.L3578.2','线上预测'):t('gen.L3578.3','线下预测');
  var visibleCount = config.filter(function(c){return c.visible||c.fixed;}).length;
  var totalCount = config.length;
  var freezeKey = getFreezeColKey(tabKey);
  var freezeNoneChecked = !freezeKey ? 'checked' : '';
  var html='<div class="rp-cfg-panel">'
    +'<div class="rp-cfg-toolbar">'
    +t('gen.L3583.1','<input type="text" class="rp-cfg-search" id="rp-cfg-search" placeholder="\u641c\u7d22\u5b57\u6bb5..." oninput="filterRpCfgFields()">')
    +'<button class="btn btn-default btn-sm" onclick="showAllRpFields(\''+tabKey+t('gen.L3584.1','\')">全部显示</button>')
    +'</div>'
    +t('gen.L3586.1','<div class="rp-cfg-stats" id="rp-cfg-stats">显示 ')+visibleCount+' / '+totalCount+t('gen.L3586.2',' 个字段</div>')
    +'<div class="rp-cfg-freeze-bar">'
    +'<label class="rp-cfg-freeze-none" title="'+t('freeze.none','不冻结')+'">'
    +'<input type="radio" name="rp-freeze-boundary" class="rp-cfg-freeze-radio" data-key="" '+freezeNoneChecked+'>'
    +'<span>'+t('freeze.none','不冻结')+'</span>'
    +'</label>'
    +'</div>'
    +'<div class="rp-cfg-list" id="rp-cfg-list">'
    + config.map(function(c){ return buildRpCfgItem(c, tabKey); }).join('')
    + '</div>'
    +t('gen.L3590.1','<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">拖拽 ⠿ 手柄可调整字段顺序；切换开关控制显示/隐藏；固定字段不可关闭。</div>')
    +'</div>';
  openModal(t('modal.title.openRpFieldConfig', '字段配置 - {v1}', {v1: tabLabel}), html,
    t('modal.footer.openRpFieldConfig', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-default" onclick="resetRpFieldConfig('{v1}')">恢复默认字段</button><button class="btn btn-primary" onclick="saveRpFieldConfig('{v2}')">保存</button>`, {v1: tabKey, v2: tabKey}));
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
  var freezeRadio = item.querySelector('.rp-cfg-freeze-radio');
  if(checkbox.checked){
    item.classList.remove('rp-cfg-item-hidden');
    if(freezeRadio) freezeRadio.disabled = false;
  } else {
    item.classList.add('rp-cfg-item-hidden');
    if(freezeRadio){ freezeRadio.disabled = true; freezeRadio.checked = false; }
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
  stats.textContent = t('text.updateRpCfgStats', '显示 {v1} / {v2} 个字段', {v1: visible, v2: items.length});
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
      var fr = item.querySelector('.rp-cfg-freeze-radio');
      if(fr) fr.disabled = false;
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
  // 保存冻结截止列：读取选中的单选按钮 data-key
  var selectedFreeze = document.querySelector('.rp-cfg-freeze-radio:checked');
  var freezeColKey = selectedFreeze ? (selectedFreeze.dataset.key || '') : '';
  setFreezeColKey(tabKey, freezeColKey);
  closeModal();
  showToast(t('gen.L3711.1','字段配置已保存'),'success');
  if(tabKey==='total')loadRp();
  else loadRpChannelMonthly(tabKey);
  updateRpFieldConfigBtn(tabKey);
}
// 恢复默认（面板内重置，不关闭弹窗）
function resetRpFieldConfig(tabKey){
  localStorage.removeItem(RP_COL_STORAGE_KEYS[tabKey]);
  localStorage.removeItem('rp_freeze_col_'+tabKey); // 冻结设置恢复默认(last_inbound_date)
  var config = getRpColConfig(tabKey);
  var list = document.getElementById('rp-cfg-list');
  if(list){
    list.innerHTML = config.map(function(c){ return buildRpCfgItem(c, tabKey); }).join('');
    initRpCfgDrag(tabKey);
    updateRpCfgStats(tabKey);
  }
  // 同步更新"不冻结"单选状态
  var freezeKey = getFreezeColKey(tabKey);
  var freezeNoneRadio = document.querySelector('.rp-cfg-freeze-none .rp-cfg-freeze-radio');
  if(freezeNoneRadio) freezeNoneRadio.checked = !freezeKey;
  var search = document.getElementById('rp-cfg-search');
  if(search) search.value = '';
  showToast(t('gen.L3728.1','已恢复默认字段配置'),'success');
}
// ==================== 按天字段配置：仅冻结列 ====================
// 按天视图不提供字段隐藏/排序/列宽编辑，仅支持冻结边界配置
// 冻结配置独立保存：rp_freeze_col_daily_{tabKey}
// 动态日期列不作为冻结截止列（本轮限制）
function rpDailyColMeta(){
  return [
    {key:'selection',        label:t('forecast.daily.col.selection','选择')},
    {key:'sales_group',      label:t('forecast.daily.col.sales_group','动销')},
    {key:'lifecycle_status', label:t('forecast.daily.col.lifecycle_status','生命周期')},
    {key:'model',            label:t('forecast.daily.col.model','Model')},
    {key:'sku',              label:t('forecast.daily.col.sku','SKU')},
    {key:'last_7_days',      label:t('forecast.daily.col.last_7_days','近7天')},
    {key:'last_14_days',     label:t('forecast.daily.col.last_14_days','近14天')},
    {key:'last_30_days',     label:t('forecast.daily.col.last_30_days','近30天')},
    {key:'avg_daily_sales',  label:t('forecast.daily.col.avg_daily_sales','日均')},
    {key:'trend',            label:t('forecast.daily.col.trend','趋势')}
  ];
}
function openRpDailyFieldConfig(tabKey){
  var tabLabel = tabKey==='total'?t('gen.L3578.1','总预测'):tabKey==='online'?t('gen.L3578.2','线上预测'):t('gen.L3578.3','线下预测');
  var freezeKey = getDailyFreezeColKey(tabKey);
  var freezeNoneChecked = !freezeKey ? 'checked' : '';
  var cols = rpDailyColMeta();
  var items = cols.map(function(c){
    var checked = (freezeKey === c.key) ? 'checked' : '';
    return '<div class="rp-cfg-item">'
      + '<span class="rp-cfg-name">'+esc(c.label)+'</span>'
      + '<label class="rp-cfg-freeze" title="'+t('freeze.column.to','冻结到此列')+'">'
      + '<input type="radio" name="rp-freeze-boundary" class="rp-cfg-freeze-radio" data-key="'+c.key+'" '+checked+'>'
      + '<span>'+t('freeze.column.to','冻结到此列')+'</span>'
      + '</label>'
      + '</div>';
  }).join('');
  var html='<div class="rp-cfg-panel">'
    +'<div class="rp-cfg-freeze-bar">'
    +'<label class="rp-cfg-freeze-none" title="'+t('freeze.none','不冻结')+'">'
    +'<input type="radio" name="rp-freeze-boundary" class="rp-cfg-freeze-radio" data-key="" '+freezeNoneChecked+'>'
    +'<span>'+t('freeze.none','不冻结')+'</span>'
    +'</label>'
    +'</div>'
    +'<div class="rp-cfg-list" id="rp-cfg-list">'+items+'</div>'
    +t('forecast.daily.cfg.tip','<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">按天视图仅支持冻结列配置；不提供字段隐藏、排序或列宽编辑。动态日期列不参与冻结。</div>')
    +'</div>';
  openModal(t('modal.title.openRpDailyFieldConfig', '冻结列配置 - {v1}', {v1: tabLabel}), html,
    t('modal.footer.openRpDailyFieldConfig', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-default" onclick="resetRpDailyFieldConfig('{v1}')">恢复默认</button><button class="btn btn-primary" onclick="saveRpDailyFieldConfig('{v2}')">保存</button>`, {v1: tabKey, v2: tabKey}));
}
function saveRpDailyFieldConfig(tabKey){
  var selectedFreeze = document.querySelector('.rp-cfg-freeze-radio:checked');
  var freezeColKey = selectedFreeze ? (selectedFreeze.dataset.key || '') : '';
  setDailyFreezeColKey(tabKey, freezeColKey);
  closeModal();
  showToast(t('gen.L3711.1','字段配置已保存'),'success');
  loadRpDaily();
}
function resetRpDailyFieldConfig(tabKey){
  // 删除 daily key → 恢复 checkpoint f7d95df 真实按天默认（冻结到 trend）
  localStorage.removeItem('rp_freeze_col_daily_'+tabKey);
  var freezeKey = getDailyFreezeColKey(tabKey);
  var freezeNoneRadio = document.querySelector('.rp-cfg-freeze-none .rp-cfg-freeze-radio');
  if(freezeNoneRadio) freezeNoneRadio.checked = !freezeKey;
  document.querySelectorAll('#rp-cfg-list .rp-cfg-freeze-radio').forEach(function(r){
    r.checked = (r.dataset.key === freezeKey);
  });
  showToast(t('gen.L3728.1','已恢复默认字段配置'),'success');
}
// 更新表格顶部按钮显示计数
function updateRpFieldConfigBtn(tabKey){
  var btn = document.getElementById('rp-field-config-btn');
  if(!btn) return;
  // 按天模式：按钮只显示"冻结列"，不带字段计数
  if(rpMode==='daily'){
    btn.textContent = t('text.updateRpFieldConfigBtn.daily', '⚙ 冻结列');
    return;
  }
  var config = getRpColConfig(tabKey || rpTab);
  var visible = config.filter(function(c){return c.visible||c.fixed;}).length;
  var total = config.length;
  btn.textContent = t('text.updateRpFieldConfigBtn', '⚙ 字段配置 {v1}/{v2}', {v1: visible, v2: total});
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
      th.title=t("app.779", "\u62d6\u62fd\u8c03\u6574\u987a\u5e8f");
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
  document.getElementById('content-inner').innerHTML=t('html.renderReplenishment', `<div id="flash-container"></div><div id="rp-collapsible"><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>国家</label><select id="rp-c" onchange="onRpCountryChange()"><option value="">全部</option></select></div><div class="filter-group"><label>仓库</label><select id="rp-w" onchange="loadRpSummary();loadRp()"><option value="">全部</option></select></div><div class="filter-group"><label>品牌</label><select id="rp-b" onchange="onRpBrandChange()"><option value="">全部</option></select></div><div class="filter-actions">{v1}<button class="btn btn-default btn-sm" onclick="exportRpExcel()">⬇ 导出Excel</button><button class="btn btn-default btn-sm" onclick="openRpParams()">⚙ 预测参数设置</button></div></div></div><div id="rp-kpi" class="kpi-row"></div></div><div class="tab-bar" style="margin:12px 20px 0;display:flex;justify-content:space-between;align-items:center"><div style="display:flex"><div class="tab-item active" onclick="switchRpTab('total')">📊 总预测</div><div class="tab-item" onclick="switchRpTab('online')">🛒 线上预测</div><div class="tab-item" onclick="switchRpTab('offline')">🏪 线下预测</div></div><div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary)"><span>显示方式：</span><div class="rp-mode-switch"><button class="rp-mode-btn active" onclick="switchRpMode('monthly')">按月</button><button class="rp-mode-btn" onclick="switchRpMode('daily')">按天</button></div><button class="btn btn-default btn-sm rp-collapse-btn" id="rp-collapse-btn" onclick="toggleRpCollapse()" title="收起/展开 顶部筛选区与指标卡片">▾ 收起</button></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left" id="rp-tab-title">📊 SKU动销与订单预测（总预测）</div><div class="table-section-actions"><input type="text" id="rp-s" placeholder="SKU搜索" onkeypress="if(event.key==='Enter')loadRp()" style="width:140px;height:28px;padding:4px 8px;border:1px solid #d0d7de;border-radius:4px;font-size:13px;margin-right:8px">{v2}{v3}<button class="btn btn-default btn-sm" id="rp-field-config-btn" onclick="openRpFieldConfig(rpTab)" title="字段显示与排序" style="margin-left:8px">⚙ 字段配置</button></div></div><div id="rp-table"></div></div>`, {v1: hasPermission('replenishment_edit')?t('gen.L3813.1','<button class="btn btn-success btn-sm rp-gen-btn" onclick="genRp()">🔄 重新计算</button>'):'', v2: hasPermission('replenishment_edit')?t('gen.L3813.2','<button class="btn btn-success btn-sm rp-gen-btn" onclick="genRp()" style="margin-right:8px">🔄 重新计算</button>'):'', v3: hasPermission('po_create')?t('gen.L3813.3','<button class="btn btn-primary btn-sm" id="rp-po-btn" onclick="genPOModal()">🛒 生成PO</button>'):''});
  await loadRpFilterOptions();
  // RC-FILTER-PRESERVE：语言切换后恢复筛选稳定值（会话内一次）
  // 国家→仓库→品牌存在依赖关系，loadRpFilterOptions 已 await onRpCountryChange 完成选项重建
  // 此处按依赖顺序回填稳定值：country（已由 loadRpFilterOptions 内部 prevCountry 保持）→ warehouse → brand
  var restored=false;
  if(typeof window.__restoreRpFilterState==='function'){
    restored=window.__restoreRpFilterState();
  }
  loadRpSummary();
  loadRp();
  updateRpFieldConfigBtn(rpTab||'total');
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
    btn.textContent=collapsed?t('gen.L3833.1','▸ 展开'):t("shell.067", "\u25be \u6536\u8d77");
    btn.title=collapsed?t('gen.L3834.1','展开 顶部筛选区与指标卡片'):t("app.782", "\u6536\u8d77 \u9876\u90e8\u7b5b\u9009\u533a\u4e0e\u6307\u6807\u5361\u7247");
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
    cSel.innerHTML=t('html.loadRpFilterOptions', '<option value="">全部</option>{v1}', {v1: (countries||[]).map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('')});
    // RC-FILTER-PRESERVE：语言切换后从保存的状态恢复 country（在 onRpCountryChange 之前设置）
    // 这样仓库和品牌选项会针对正确的 country 加载
    var savedState=window.__rpFilterState;
    var restoreCountry = savedState && savedState.country ? savedState.country : '';
    if(restoreCountry && countries.includes(restoreCountry)) cSel.value=restoreCountry;
    else if(countries.includes(prevCountry)) cSel.value=prevCountry;
    else cSel.value='';
    // 联动加载仓库和品牌（此时 country 已恢复，仓库/品牌选项针对正确国家加载）
    await onRpCountryChange(true);
  }catch(e){console.warn('replenishment filter-options load failed',e)}
}
// 国家变化时联动：仓库列表 + 品牌列表都从 warehouses 表按国家筛选
async function onRpCountryChange(skipDataReload){
  const country=document.getElementById('rp-c')?.value||'';
  const prevWarehouse=document.getElementById('rp-w')?.value||'';
  const prevBrand=document.getElementById('rp-b')?.value||'';
  // RC-FILTER-PRESERVE：语言切换后从保存状态恢复 warehouse（在选项重建后设置）
  var savedState=window.__rpFilterState;
  var restoreWarehouse = savedState && savedState.warehouse ? savedState.warehouse : '';
  var restoreBrand = savedState && savedState.brand ? savedState.brand : '';
  try{
    const url='/api/warehouses/by-country'+(country?('?country='+encodeURIComponent(country)):'');
    const whs=await api(url);
    // 填充仓库下拉
    const wSel=document.getElementById('rp-w');
    if(wSel){
      wSel.innerHTML=t('html.onRpCountryChange', '<option value="">全部</option>{v1}', {v1: (whs||[]).map(w=>'<option value="'+esc(w.name)+'">'+esc(w.name)+'</option>').join('')});
      // 按依赖顺序恢复：优先使用 savedState 中的 warehouse，其次 prevWarehouse
      if(restoreWarehouse && (whs||[]).some(w=>w.name===restoreWarehouse)) wSel.value=restoreWarehouse;
      else if(prevWarehouse && (whs||[]).some(w=>w.name===prevWarehouse)) wSel.value=prevWarehouse;
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
      bSel.innerHTML=t('html.onRpCountryChange.2', '<option value="">全部</option>{v1}', {v1: brands.map(b=>'<option value="'+esc(b)+'">'+esc(b)+'</option>').join('')});
      // 按依赖顺序恢复：优先使用 savedState 中的 brand
      if(restoreBrand && brands.includes(restoreBrand)) bSel.value=restoreBrand;
      else if(prevBrand && brands.includes(prevBrand)) bSel.value=prevBrand;
      else bSel.value='';
    }
  }catch(e){console.warn('onRpCountryChange failed',e)}
  if(!skipDataReload){loadRpSummary();loadRp();}
}
// RC-FILTER-PRESERVE：语言切换时保存/恢复订单预测筛选稳定值（会话内）
// 仅保存稳定 ID/value，不保存翻译文字；恢复时若选项已不存在则保持""（全部）
window.__saveRpFilterState=function(){
  var s={};
  try{
    var c=document.getElementById('rp-c'); if(c) s.country=c.value||'';
    var w=document.getElementById('rp-w'); if(w) s.warehouse=w.value||'';
    var b=document.getElementById('rp-b'); if(b) s.brand=b.value||'';
    var sk=document.getElementById('rp-search'); if(sk) s.search=sk.value||'';
    if(typeof rpTab!=='undefined') s.rpTab=rpTab;
    if(typeof rpMode!=='undefined') s.rpMode=rpMode;
    window.__rpFilterState=s;
  }catch(e){ window.__rpFilterState=null; }
};
window.__restoreRpFilterState=function(){
  var s=window.__rpFilterState;
  if(!s) return false;
  try{
    // country/warehouse/brand 已在 loadRpFilterOptions→onRpCountryChange 中按依赖顺序恢复
    // 此处仅恢复 search/rpTab/rpMode（这些不依赖 select 选项重建）
    var sk=document.getElementById('rp-search'); if(sk) sk.value=s.search||'';
    // 恢复 tab/mode 变量 + UI 高亮（不调用 switchRpTab/switchRpMode 以避免重复 loadRp）
    if(s.rpTab && typeof rpTab!=='undefined'){
      rpTab=s.rpTab;
      var tabs=['total','online','offline'];
      document.querySelectorAll('#content-inner .tab-bar .tab-item').forEach(function(el,i){
        el.classList.toggle('active', tabs[i]===s.rpTab);
      });
    }
    if(s.rpMode && typeof rpMode!=='undefined'){
      rpMode=s.rpMode;
      document.querySelectorAll('.rp-mode-btn').forEach(function(btn){
        btn.classList.toggle('active', btn.getAttribute('onclick').indexOf(s.rpMode)>0);
      });
    }
    return true;
  }catch(e){ return false; }
  finally{ window.__rpFilterState=null; }
};
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
      wSel.innerHTML=t('html.onRpBrandChange', '<option value="">全部</option>{v1}', {v1: (whs||[]).map(w=>'<option value="'+esc(w.name)+'">'+esc(w.name)+'</option>').join('')});
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
  const titles={total:t("shell.068", "\ud83d\udcca SKU\u52a8\u9500\u4e0e\u8ba2\u5355\u9884\u6d4b\uff08\u603b\u9884\u6d4b\uff09"),online:t("app.783", "\ud83d\uded2 \u7ebf\u4e0a\u9500\u91cf\u9884\u6d4b"),offline:t("app.784", "\ud83c\udfea \u7ebf\u4e0b\u9500\u91cf\u9884\u6d4b")};
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
  updateRpFieldConfigBtn(rpTab);
}
// 销量统计周期（period 口径基准）：缓存当前 sales_stats_days，供动态表头与 period 显示字段使用
var rpSalesStatsDays=90;
var _rpSdPromise=null;
function getSalesStatsDays(){
  if(_rpSdPromise)return _rpSdPromise;
  _rpSdPromise=(async()=>{
    try{
      var data=await api('/api/system-config');
      (data||[]).forEach(function(c){ if(c.key==='sales_stats_days'&&c.value){rpSalesStatsDays=parseInt(c.value)||90;} });
    }catch(e){ /* 用默认 90 */ }
    return rpSalesStatsDays;
  })();
  return _rpSdPromise;
}
async function loadRpSummary(){
  try{
    await getSalesStatsDays();
    const d=await api('/api/replenishment-suggestions/summary?'+rpQuery());
    const kpi=[
      {label:t('gen.L3971.1','SKU总数'),value:d.totalSkus||0,unit:t('gen.L3971.2','个')},
      {label:t("app.740", "\u603b\u5e93\u5b58\u6c60"),value:d.totalPool||0,unit:t('gen.L3972.1','件')},
      {label:t("pi.003", "\u8fd14\u4e2a\u6708\u603b\u9500\u91cf"),value:d.totalSales4m||0,unit:t('gen.L3973.1','件')},
      {label:rpSalesStatsDays+t('gen.L3974.1','天月均销量'),value:d.avgSalesPeriod||0,unit:t("pi.004", "\u4ef6/\u6708"),tip:t('gen.L3974.2','按"预测参数设置"中的销量统计周期（近')+rpSalesStatsDays+t('gen.L3974.3','天有效销量 ÷ ')+rpSalesStatsDays+t('gen.L3974.4',' × 30）计算的月均销量；当前可用周转也按此口径')},
      {label:t("pi.005", "\u9884\u8ba1\u5468\u8f6c\u6708\u6570"),value:d.overallTurnover||0,unit:t('gen.L3975.1','月'),warn:d.overallTurnover<2,turnover:true,tip:t("pi.006", "\u6309\u5f53\u524d\u9500\u91cf\u7edf\u8ba1\u5468\u671f(period)\u8ba1\u7b97\u7684\u5e73\u5747\u5468\u8f6c\uff08\u4ec5\u5c55\u793a\uff0c\u4e0d\u5f71\u54cd\u91c7\u8d2d\u94fe\u8def\uff09\uff1b\u5df2\u6392\u9664\u6708\u5747\u9500\u91cf=0\u7684\u65e0\u52a8\u9500SKU")},
      {label:t("pi.007", "\u9700\u8865\u8d27SKU"),value:d.needReplenish||0,unit:t('gen.L3976.1','个'),accent:true},
      {label:t("app.651", "\u65ad\u8d27\u98ce\u9669"),value:d.stockoutRisk||0,unit:t('gen.L3977.1','个'),danger:true},
      {label:t("pi.008", "\u9ad8\u5e93\u5b58/\u6162\u9500"),value:d.highStock||0,unit:t('gen.L3978.1','个'),muted:true}
    ];
    document.getElementById('rp-kpi').innerHTML='<div class="kpi-grid">'+kpi.map(k=>'<div class="kpi-card'+(k.danger?' kpi-danger':k.accent?' kpi-accent':k.muted?' kpi-muted':'')+'">'
      +'<div class="kpi-label">'+k.label+(k.tip?' <span class="link-text" onclick="showKpiTip(this,\''+k.tip.replace(/'/g,"\\'")+'\')" style="cursor:help" title="'+k.tip+'">?</span>':'')+'</div>'
      +'<div class="kpi-value'+(k.warn?' kpi-warn':'')+'">'+(k.turnover?(typeof k.value==='number'&&k.value%1!==0?Math.round(k.value*10)/10:k.value):formatQuantityDisplay(k.value))+'</div>'
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
    await getSalesStatsDays();
    var data=await api('/api/replenishment-suggestions?'+rpQuery());
    var turnColor=function(v){return v<2?'text-danger':v>=2&&v<4?'text-success':v>=4&&v<6?'text-primary':'text-secondary';};
    var ADJ=[t('gen.L4014.1','MOQ限制'),t("app.786", "\u6574\u7bb1\u53d6\u6574"),t("app.787", "\u5de5\u5382\u6392\u4ea7"),t("app.788", "\u4f9b\u5e94\u5546\u4ea7\u80fd"),t("app.789", "\u51d1\u67dc"),t("app.790", "\u9884\u7b97\u63a7\u5236"),t("app.791", "\u8001\u677f\u786e\u8ba4"),t("app.792", "\u6e20\u9053\u7b56\u7565"),t('gen.L4014.2','其他')];
    // 预计算 + 存储行数据（供 onFinalQtyChange 使用）
    window._rpRowData=window._rpRowData||{};
    data.forEach(function(r){
      var c={};
      c.oa=r.online_avg_sales_4m||0;
      c.ofa=r.offline_avg_sales_4m||0;
      c.oaPeriod=r.online_avg_sales_period||0;
      c.ofaPeriod=r.offline_avg_sales_period||0;
      c.ta=r.avg_sales_4m||0;
      c.taPeriod=r.avg_sales_period||0;
      c.opct=c.taPeriod>0?Math.round(c.oaPeriod/c.taPeriod*100):0;
      c.ofpct=c.taPeriod>0?Math.round(c.ofaPeriod/c.taPeriod*100):0;
      c.pool=r.total_inventory_pool||((r.available_qty||0)+(r.in_transit_qty||0)+(r.po_unconfirmed_pi_qty||0));
      c.ct=c.taPeriod>0?Math.round(c.pool/c.taPeriod*10)/10:0; // P2: 当前周转分母切 period（纯显示，不碰采购）
      c.ot=r.online_target_turnover||2;
      c.oft=r.offline_target_turnover||2;
      c.os=r.online_target_stock||0;
      c.ofs=r.offline_target_stock||0;
      c.ots=r.other_target_stock||0;
      c.sq=r.suggested_qty||0;
      var avail = r.available_qty||0;
      var transit = r.in_transit_qty||0;
      var piUnshipped = r.pi_confirmed_unshipped_qty||0;
      c.availTurnover = c.taPeriod>0 ? Math.round(avail/c.taPeriod*10)/10 : null;
      c.transitTurnover = c.taPeriod>0 ? Math.round((avail+transit)/c.taPeriod*10)/10 : null; // P2: 分母切 period
      c.afterOrderTurnover = c.taPeriod>0 ? Math.round((avail+transit+c.sq)/c.taPeriod*10)/10 : null; // P2: 分母切 period
      c.piUnshipped = piUnshipped;
      r._c=c;
      window._rpRowData[r.id]=c;
    });
    // 列渲染器
    var Cols={
      check:{th:'<th style="width:36px"><input type="checkbox" id="rp-all" onchange="document.querySelectorAll(\'.rp-ck\').forEach(function(c){c.checked=this.checked})"></th>',
        td:function(r,c){return '<td><input type="checkbox" class="rp-ck" value="'+r.id+'" data-sku="'+esc(r.sku_code)+'" data-qty="'+c.sq+'"></td>';},
        sum:function(total){return t('gen.L4049.1','<td class="text-center"><span style="font-size:11px;font-weight:700">合计</span></td>');}},
      model:{th:'<th>Model</th>',
        td:function(r,c){return '<td class="text-truncate" style="max-width:90px" title="'+esc(r.model||'')+'">'+esc(r.model||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      sku:{th:'<th>SKU</th>',
        td:function(r,c){return '<td class="cell-id" title="'+esc(r.sku_code||'')+'">'+esc(r.sku_code||'')+'</td>';},
        sum:function(total){return '<td><span style="font-size:10px;color:#888">'+total.count+t('gen.L4055.1','个SKU</span></td>');}},
      online_avg:{th:rpTh(t('gen.L4056.1','线上')+rpSalesStatsDays+t('gen.L4056.2','天月均销量'),t('gen.L4056.3','按"预测参数设置"中的销量统计周期计算：近')+rpSalesStatsDays+t('gen.L4056.4','天有效销量 ÷ ')+rpSalesStatsDays+' × 30。','text-right'),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.oaPeriod)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.oaPeriod)+'</td>';}},
      offline_avg:{th:rpTh(t('gen.L4059.1','线下')+rpSalesStatsDays+t('gen.L4059.2','天月均销量'),t('gen.L4059.3','按"预测参数设置"中的销量统计周期计算：近')+rpSalesStatsDays+t('gen.L4059.4','天有效销量 ÷ ')+rpSalesStatsDays+' × 30。','text-right'),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.ofaPeriod)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.ofaPeriod)+'</td>';}},
      total_avg:{th:rpThCompact(t('forecast.compact.total_avg','{days}天月均销量',{days:rpSalesStatsDays}),t('gen.L4062.2','按"预测参数设置"中的销量统计周期计算：近')+rpSalesStatsDays+t('gen.L4062.3','天有效销量 ÷ ')+rpSalesStatsDays+' × 30。','text-right','',true),
        td:function(r,c){return '<td class="text-right font-bold">'+formatQuantityDisplay(c.taPeriod)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.taPeriod)+'</td>';}},
      online_pct:{th:rpTh(t("app.738", "\u7ebf\u4e0a\u5360\u6bd4"),t("app.794", "\u6839\u636e\u7ebf\u4e0a\u9500\u91cf\u7edf\u8ba1\u5468\u671f(\u8fd1 N \u5929)\u9500\u91cf\u5360\u603b\u9500\u91cf(\u9500\u91cf\u7edf\u8ba1\u5468\u671f)\u7684\u6bd4\u4f8b\u8ba1\u7b97\uff0c\u7528\u4e8e\u5e93\u5b58\u5206\u644a\u548c\u8865\u8d27\u6d4b\u7b97\u3002\u5360\u6bd4\u4e0e\u5206\u644a\u5e93\u5b58\u6309\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right">'+(c.taPeriod>0?c.opct+'%':'-')+'</td>';},
        sum:function(t){return '<td class="text-right"></td>';}},
      offline_pct:{th:rpTh(t("app.739", "\u7ebf\u4e0b\u5360\u6bd4"),t("app.795", "\u6839\u636e\u7ebf\u4e0b\u9500\u91cf\u7edf\u8ba1\u5468\u671f(\u8fd1 N \u5929)\u9500\u91cf\u5360\u603b\u9500\u91cf(\u9500\u91cf\u7edf\u8ba1\u5468\u671f)\u7684\u6bd4\u4f8b\u8ba1\u7b97\uff0c\u7528\u4e8e\u5e93\u5b58\u5206\u644a\u548c\u8865\u8d27\u6d4b\u7b97\u3002\u5360\u6bd4\u4e0e\u5206\u644a\u5e93\u5b58\u6309\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right">'+(c.taPeriod>0?c.ofpct+'%':'-')+'</td>';},
        sum:function(t){return '<td class="text-right"></td>';}},
      avail:{th:rpThCompact(t('forecast.compact.allocated_available','已分摊\n可用库存'),'','text-right','',true),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(r.available_qty||0)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.avail)+'</td>';}},
      transit:{th:rpThCompact(t('forecast.compact.allocated_in_transit','已分摊\n在途库存'),'','text-right','',true),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(r.in_transit_qty||0)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.transit)+'</td>';}},
      po_unconfirmed:{th:rpThCompact(t('forecast.compact.po_unconfirmed','未确认\nPO'),t("app.796", "\u5df2\u7ecf\u521b\u5efa PO\uff0c\u4f46\u8fd8\u6ca1\u6709\u786e\u8ba4 PI \u7684\u6570\u91cf\u3002\u5c5e\u4e8e\u6f5c\u5728\u4f9b\u5e94\uff0c\u4e0d\u7b49\u4e8e\u4e00\u5b9a\u4f1a\u53d1\u8d27\u3002"),'text-right','',true),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(r.po_unconfirmed_pi_qty||0)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.po)+'</td>';}},
      pool:{th:rpTh(t("app.740", "\u603b\u5e93\u5b58\u6c60"),t("app.797", "\u5f53\u524d\u53ef\u7528\u5e93\u5b58 + \u5728\u9014\u5e93\u5b58 + PO\u672a\u786e\u8ba4PI + PI\u5df2\u786e\u8ba4\u672a\u53d1\u8d27\u3002\u7528\u4e8e\u5224\u65ad\u6574\u4f53\u662f\u5426\u9700\u8981\u8865\u8d27\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right font-bold">'+formatQuantityDisplay(c.pool)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.pool)+'</td>';}},
      current_turn:{th:rpTh(t("app.741", "\u5f53\u524d\u5468\u8f6c"),t("app.798", "\u603b\u5e93\u5b58\u6c60 \u00f7 \u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002\u8868\u793a\u4e0d\u8003\u8651\u5728\u9014\u548c\u672a\u53d1\u8d27\u8ba2\u5355\u65f6\uff0c\u6574\u4f53\u5e93\u5b58\u5927\u7ea6\u8fd8\u80fd\u5356\u51e0\u4e2a\u6708\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right '+(c.taPeriod>0?(c.ct<2?'text-danger':c.ct>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.taPeriod>0?c.ct:t("app.799", "\u65e0\u9500\u91cf"))+'</td>';},
        sum:function(t){return '<td class="text-right"></td>';}},
      pi_unshipped:{th:rpThCompact(t('forecast.compact.pi_unshipped','已确认PI\n未发货'),t("app.800", "PI \u5df2\u786e\u8ba4\uff0c\u4f46\u5de5\u5382\u8fd8\u6ca1\u6709\u53d1\u8d27\u7684\u6570\u91cf\u3002\u6bd4 PO\u672a\u786e\u8ba4PI \u66f4\u63a5\u8fd1\u5b9e\u9645\u4f9b\u5e94\u3002"),'text-right','',true),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.piUnshipped)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.piUnshipped)+'</td>';}},
      avail_turnover:{th:rpTh(t('gen.L4089.1','当前可用周转'),t("app.801", "\u5f53\u524d\u53ef\u7528\u5e93\u5b58 \u00f7 \u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002\u8868\u793a\u4e0d\u8003\u8651\u5728\u9014\u548c\u672a\u53d1\u8d27\u8ba2\u5355\u65f6\uff0c\u73b0\u6709\u5e93\u5b58\u5927\u7ea6\u8fd8\u80fd\u5356\u51e0\u4e2a\u6708\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right '+(c.availTurnover!==null?(c.availTurnover<2?'text-danger':c.availTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.availTurnover!==null?c.availTurnover:'-')+'</td>';},
        sum:function(t){return '<td class="text-right"></td>';}},
      transit_turnover:{th:rpTh(t("app.733", "\u5728\u9014\u540e\u5468\u8f6c"),t("app.802", "\uff08\u5f53\u524d\u53ef\u7528\u5e93\u5b58 + \u5728\u9014\u5e93\u5b58\uff09\u00f7 \u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002\u7528\u4e8e\u5224\u65ad\u5df2\u5728\u8def\u4e0a\u7684\u8d27\u5230\u540e\uff0c\u5e93\u5b58\u80fd\u652f\u6491\u591a\u4e45\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right '+(c.transitTurnover!==null?(c.transitTurnover<2?'text-danger':c.transitTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.transitTurnover!==null?c.transitTurnover:'-')+'</td>';},
        sum:function(t){return '<td class="text-right"></td>';}},
      after_order_turnover:{th:rpThCompact(t('forecast.compact.after_order_turnover','下单后\n周转'),t("app.803", "\uff08\u5f53\u524d\u53ef\u7528\u5e93\u5b58 + \u5728\u9014\u5e93\u5b58 + \u672c\u6b21\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf\uff09\u00f7 \u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002\u7528\u4e8e\u5224\u65ad\u672c\u6b21\u8865\u8d27\u540e\u9884\u8ba1\u80fd\u652f\u6491\u51e0\u4e2a\u6708\u3002"),'text-right','',true),
        td:function(r,c){return '<td class="text-right '+(c.afterOrderTurnover!==null?(c.afterOrderTurnover<2?'text-danger':c.afterOrderTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.afterOrderTurnover!==null?c.afterOrderTurnover:'-')+'</td>';},
        sum:function(t){return '<td class="text-right"></td>';}},
      sales_status:{th:rpThCompact(t('forecast.compact.sales_status','销量\n状态'),t("app.804", "\u7cfb\u7edf\u6839\u636e\u9500\u91cf\u3001\u5e93\u5b58\u3001\u5e93\u9f84\u3001\u7f3a\u8d27\u3001\u6162\u9500\u3001\u9ad8\u5e93\u5b58\u7b49\u89c4\u5219\u5224\u65ad SKU \u5f53\u524d\u72b6\u6001\u3002"),'text-center','',true),
        td:function(r,c){return '<td class="text-center rp-sales-status-cell"><span class="status-badge">'+formatForecastSalesStatus(r.sales_status||'')+'</span></td>';},
        sum:function(t){return '<td class="text-center"></td>';}},
      risk_tags:{th:rpThCompact(t('forecast.compact.risk_tags','风险\n标签'),'','','text-center','',true),
        td:function(r,c){return '<td class="rp-cell-wrap text-center rp-risk-tags-cell">'+formatForecastRiskTags(r.risk_tags||'')+'</td>';},
        sum:function(t){return '<td class="text-center"></td>';}},
      sales_reason:{th:rpThCompact(t('forecast.compact.sales_reason','销量\n原因'),'','','',true),
        td:function(r,c){return '<td class="rp-cell-wrap" title="'+esc(r.sales_reason||'')+'">'+esc(r.sales_reason||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      action_rec:{th:rpThCompact(t('forecast.compact.action_rec','建议\n操作'),t("app.805", "\u7cfb\u7edf\u6839\u636e\u52a8\u9500\u5224\u65ad\u7ed9\u51fa\u7684\u64cd\u4f5c\u5efa\u8bae\uff0c\u4f8b\u5982\u4f18\u5148\u8865\u8d27\u3001\u8c28\u614e\u8865\u8d27\u3001\u6682\u505c\u8865\u8d27\u3001\u4eba\u5de5\u590d\u6838\u3002"),'','',true),
        td:function(r,c){return '<td class="rp-cell-wrap" title="'+esc(r.action||'')+'">'+formatForecastAction(r.action||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      ai_business_advice:{th:rpThCompact(t('forecast.compact.ai_business_advice','AI业务\n建议'),'','','',true),
        td:function(r,c){return '<td class="rp-cell-wrap" title="'+esc(r.ai_business_advice||'')+'">'+esc(r.ai_business_advice||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      last_inbound_date:{th:rpThCompact(t('forecast.compact.last_inbound_date','最近\n入库日期'),t("app.806", "\u8be5 SKU \u6700\u8fd1\u4e00\u6b21\u5165\u5e93\u7684\u65e5\u671f\uff0c\u7528\u4e8e\u5224\u65ad\u5e93\u9f84\u548c\u662f\u5426\u957f\u671f\u672a\u8865\u8d27\u3002"),'text-center','',true),
        td:function(r,c){return '<td class="cell-date text-center">'+(r.last_inbound_date?fmtDate(r.last_inbound_date):t("app.673", "\u672a\u77e5"))+'</td>';},
        sum:function(t){return '<td class="text-center"></td>';}},
      days_since_last_inbound:{th:rpThCompact(t('forecast.compact.days_since_last_inbound','距上次\n入库天数'),t("app.807", "\u5f53\u524d\u65e5\u671f\u8ddd\u79bb\u6700\u540e\u4e00\u6b21\u5165\u5e93\u65e5\u671f\u7684\u5929\u6570\u3002\u5929\u6570\u8d8a\u957f\uff0c\u8bf4\u660e\u8be5 SKU \u8d8a\u4e45\u6ca1\u6709\u65b0\u8d27\u5165\u5e93\u3002"),'text-right','',true),
        td:function(r,c){
          var d=r.days_since_last_inbound;
          var cls=d!==null?(d<=90?'text-success':d<=180?'text-primary':d<=365?'text-warning':'text-danger'):'text-muted';
          return '<td class="text-right '+cls+'">'+(d!==null?d:t('gen.L4120.1','未知'))+'</td>';
        },
        sum:function(t){return '<td class="text-right"></td>';}},
      online_target_turn:{th:rpTh(t("app.743", "\u7ebf\u4e0a\u76ee\u6807\u5468\u8f6c"),t("app.808", "\u5e0c\u671b\u8865\u8d27\u540e\u5e93\u5b58\u80fd\u8986\u76d6\u7684\u9500\u552e\u6708\u6570\u3002\u5b83\u662f\u8ba1\u7b97\u53c2\u6570\uff0c\u4e0d\u662f\u5b9e\u9645\u5e93\u5b58\u7ed3\u679c\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right">'+c.ot+'</td>';},
        sum:function(t){return '<td class="text-right"></td>';}},
      offline_target_turn:{th:rpTh(t("app.744", "\u7ebf\u4e0b\u76ee\u6807\u5468\u8f6c"),t("app.808", "\u5e0c\u671b\u8865\u8d27\u540e\u5e93\u5b58\u80fd\u8986\u76d6\u7684\u9500\u552e\u6708\u6570\u3002\u5b83\u662f\u8ba1\u7b97\u53c2\u6570\uff0c\u4e0d\u662f\u5b9e\u9645\u5e93\u5b58\u7ed3\u679c\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right">'+c.oft+'</td>';},
        sum:function(t){return '<td class="text-right"></td>';}},
      online_target_stock:{th:t('gen.L4129.1','<th class="text-right">线上</th>'),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.os)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.os)+'</td>';}},
      offline_target_stock:{th:t('gen.L4132.1','<th class="text-right">线下</th>'),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.ofs)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.ofs)+'</td>';}},
      total_target_stock:{th:rpTh(t("app.109", "\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf"),t("app.809", "\u57fa\u4e8e\u9500\u91cf\u7edf\u8ba1\u5468\u671f(\u8fd1 N \u5929)\u6708\u5747\u9500\u91cf\u4e0e\u76ee\u6807\u5468\u8f6c\u8ba1\u7b97\u7684\u5efa\u8bae\u8865\u8d27\u6570\u91cf\u3002\u6162\u9500\u3001\u5446\u6ede\u3001\u9ad8\u5e93\u5b58\u7b49 SKU \u4f1a\u88ab\u62e6\u622a\u4e3a 0\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right font-bold">'+formatQuantityDisplay(c.sq)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.sq)+'</td>';}},
      arrival_month:{th:t('gen.L4138.1','<th class="text-center">到货月份</th>'),
        td:function(r,c){return '<td class="text-center">'+esc(r.arrival_month||'')+'</td>';},
        sum:function(t){return '<td class="text-center"></td>';}},
      actions:{th:t('gen.L4144.1','<th class="text-center">操作</th>'),
        td:function(r,c){return '<td class="cell-actions text-center"><button class="action-btn" onclick="toggleGenPO(\''+r.id+t('gen.L4145.1','\')" title="\u52a0\u5165PO">🛒</button></td>');},
        sum:function(t){return '<td class="text-center"></td>';}}
    };
    // 按配置过滤+排序（不追加隐藏字段，避免列错位）
    var config=getRpColConfig('total');
    var activeKeys=[];
    config.forEach(function(cfg){
      var col=Cols[cfg.key];
      if(col&&(cfg.visible||cfg.key==='check'||cfg.key==='model'||cfg.key==='sku'||cfg.key==='total_target_stock')){
        activeKeys.push(cfg.key);
      }
    });
    // 计算合计
    var totals={count:data.length,oa:0,ofa:0,oaPeriod:0,ofaPeriod:0,ta:0,taPeriod:0,avail:0,transit:0,po:0,piUnshipped:0,pool:0,os:0,ofs:0,sq:0};
    data.forEach(function(r){
      var c=r._c;
      totals.oa+=c.oa;totals.ofa+=c.ofa;totals.oaPeriod+=c.oaPeriod;totals.ofaPeriod+=c.ofaPeriod;totals.ta+=c.ta;totals.taPeriod+=c.taPeriod;
      totals.avail+=(r.available_qty||0);totals.transit+=(r.in_transit_qty||0);totals.po+=(r.po_unconfirmed_pi_qty||0);totals.piUnshipped+=c.piUnshipped;totals.pool+=c.pool;
      totals.os+=c.os;totals.ofs+=c.ofs;
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
      ? '<tr><td colspan="'+colCount+t('gen.L4175.1','" style="text-align:center;padding:40px 20px;color:#999;background:#fafbfc">💡 当前筛选条件下暂无建议，请调整国家/仓库/品牌或点击"重新计算"</td></tr>')
      : '';
    document.getElementById('rp-table').innerHTML='<div class="table-container" style="box-shadow:none;border-radius:0;overflow:auto;max-height:70vh"><table class="data-table rp-monthly-table" style="width:'+rpColWidthTotal(activeKeys)+'px;min-width:'+rpColWidthTotal(activeKeys)+'px">'+rpColgroupHtml(activeKeys)+'<thead><tr style="height:34px">'+th+'</tr>'+sum+'</thead><tbody>'+rows+tableFoot+'</tbody></table></div>';
    applyChannelFreezeColumns('total', activeKeys);
    syncRpHeaderHeight();
    initRpTableDrag('total');
  }catch(e){showFlash(e.message,'danger')}
}

// 纯显示函数：根据当前语言格式化月份标签（不影响日期/销售数据逻辑）
function formatMonthLabel(monthNumber, isCurrent){
  var lang = (typeof getLang === 'function') ? getLang() : 'zh';
  if(lang === 'en'){
    var enMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return isCurrent ? ('This Month/'+enMonths[monthNumber-1]) : enMonths[monthNumber-1];
  }
  if(lang === 'id'){
    var idMonths = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    return isCurrent ? ('Bulan Ini/'+idMonths[monthNumber-1]) : idMonths[monthNumber-1];
  }
  // zh: 保持原有"本月/X月"、"X月"格式
  return isCurrent ? ('本月/'+monthNumber+'月') : (monthNumber+'月');
}

// PI 状态枚举展示层映射（仅显示用，不写回 DB / 不参与状态机判断）
function formatPIStatus(status) {
  switch (status) {
    case 'pending':
      return t('pi.status.pending', '待上传 PI');
    case 'uploaded':
      return t('pi.status.uploaded', '已上传 PI');
    case 'confirmed':
      return t('pi.status.confirmed', '已确认');
    case 'pending_deposit':
      return t('pi.status.pending_deposit', '待定金审批');
    case 'deposit_paid':
      return t('pi.status.deposit_paid', '定金已付款');
    case 'producing':
      return t('pi.status.producing', '生产中');
    case 'pending_ci_pl':
      return t('pi.status.pending_ci_pl', '待 CI/PL');
    case 'partial_shipped':
      return t('pi.status.partial_shipped', '部分发货');
    case 'shipped_complete':
      return t('pi.status.shipped_complete', '全部发货完成');
    case 'cancelled':
      return t('pi.status.cancelled', '已取消');
    case 'completed':
      return t('pi.status.completed', '已完成');
    default:
      return status || '—';
  }
}

// PI 定金付款状态枚举展示层映射（仅显示用，不写回 DB / 不参与状态机判断）
function formatPIDepositStatus(status) {
  switch (status) {
    case 'unpaid':
      return t('pi.deposit_status.unpaid', '未付款');
    case 'pending_approval':
      return t('pi.deposit_status.pending_approval', '待审批');
    case 'partial':
      return t('pi.deposit_status.partial', '部分付款');
    case 'paid':
      return t('pi.deposit_status.paid', '已付款');
    default:
      return status || '—';
  }
}

// 线上/线下预测 + 按月：设置目标周转
async function loadRpChannelMonthly(channel){
  var isOnline=channel==='online';
  var chLabel=isOnline?t('gen.L4185.1','线上'):t('gen.L4185.2','线下');
  var now=new Date();
  var ml=[];
  for(var i=3;i>=0;i--){
    var d=new Date(now.getFullYear(),now.getMonth()-i,1);
    var m=d.getMonth()+1;
    ml.push(formatMonthLabel(m, i===0));
  }
  try{
    await getSalesStatsDays();
    var data=await api('/api/replenishment-suggestions?'+rpQuery());
    // 预处理
    // 月份字段语义统一约定：m1=本月(7月) m2=上月(6月) m3=上上月(5月) m4=4个月前(4月)
    // 表头从左到右：4月(m4) → 5月(m3) → 6月(m2) → 本月/7月(m1)
    data.forEach(function(r){
      r._c={};
      var salesM1,salesM2,salesM3,salesM4,avgSales,targetTurn,targetStock,remark;
      if(isOnline){
        salesM1=r.online_sales_m1||0; salesM2=r.online_sales_m2||0; salesM3=r.online_sales_m3||0; salesM4=r.online_sales_m4||0;
        avgSales=r.online_avg_sales_4m||0;
        targetTurn=r.online_target_turnover||2;
        targetStock=r.online_target_stock||0;
        remark=r.online_remark||'';
      }else{
        salesM1=r.offline_sales_m1||0; salesM2=r.offline_sales_m2||0; salesM3=r.offline_sales_m3||0; salesM4=r.offline_sales_m4||0;
        avgSales=r.offline_avg_sales_4m||0;
        targetTurn=r.offline_target_turnover||2;
        targetStock=r.offline_target_stock||0;
        remark=r.offline_remark||'';
      }
      var totalAvg=r.avg_sales_4m||0;
      var totalAvgPeriod=r.avg_sales_period||0;
      var avgSalesPeriod = isOnline ? (r.online_avg_sales_period||0) : (r.offline_avg_sales_period||0);
      var pct=totalAvg>0?(avgSales/totalAvg*100):0;
      var pctPeriod=totalAvgPeriod>0?(avgSalesPeriod/totalAvgPeriod*100):0;
      var availTotal=r.available_qty||0;
      var transitTotal=r.in_transit_qty||0;
      var piUnshippedTotal=r.pi_confirmed_unshipped_qty||0;
      var pool=r.total_inventory_pool||(availTotal+transitTotal+(r.po_unconfirmed_pi_qty||0))||0;
      var allocatedStock=Math.round(pool*(pctPeriod/100)); // P4: period 分摊，供渠道建议采购显示与反推 target_stock
      // 渠道分摊库存（按销量占比分摊，不真正拆分库存；仅用于线上/线下测算口径）
      var availAllocated=Math.round(availTotal*(pct/100));
      var transitAllocated=Math.round(transitTotal*(pct/100));
      var piUnshippedAllocated=Math.round(piUnshippedTotal*(pct/100));
      r._c.salesM1=salesM1; r._c.salesM2=salesM2; r._c.salesM3=salesM3; r._c.salesM4=salesM4;
      r._c.avgSales=avgSales; r._c.totalAvg=totalAvg; r._c.pct=pct; r._c.pctPeriod=pctPeriod; r._c.avgSalesPeriod=avgSalesPeriod; r._c.totalAvgPeriod=totalAvgPeriod;
      r._c.pool=pool; r._c.allocatedStock=allocatedStock;
      r._c.transit=transitTotal; r._c.po=r.po_unconfirmed_pi_qty||0; r._c.avail=availTotal;
      r._c.availAllocated=availAllocated; r._c.transitAllocated=transitAllocated; r._c.piUnshippedAllocated=piUnshippedAllocated;
      r._c.targetTurn=targetTurn; r._c.targetStock=targetStock; r._c.remark=remark;
      r._c.piUnshipped = piUnshippedTotal;
      // 建议采购数量：单源口径，直接读后端落库的渠道分量（三页统一，不再前端重算）
      r._c.suggestedQty = isOnline ? (r.online_suggested_qty||0) : (r.offline_suggested_qty||0);
      // 三周转指标（基于渠道月均 + 渠道分摊库存，口径：可用+在途，不含PI未发货）
      // 当前可用周转：用 period 口径分摊库存 ÷ 渠道月均(period)，消除 4m分摊÷period月均 的混合口径
      // P4：占比/分摊显示列也已切 period（pctPeriod / availAllocatedPeriod / transitAllocatedPeriod 直接驱动显示）
      // 分摊库存为库存数量，按整数展示（与 4m 口径的 availAllocated/transitAllocated 一致，避免长浮点串）
      var availAllocatedPeriod = Math.round(availTotal*(pctPeriod/100));
      var transitAllocatedPeriod = Math.round(transitTotal*(pctPeriod/100)); // P4: period 分摊在途，驱动显示 + 周转
      var poolAllocatedPeriod = pool*(pctPeriod/100);             // P4: period 分摊总库存池，驱动当前测算周转显示
      r._c.poolAllocatedPeriod = poolAllocatedPeriod;
      r._c.availAllocatedPeriod = availAllocatedPeriod; // period 分摊可用，供手动改建议采购时实时刷新下单后周转
      r._c.transitAllocatedPeriod = transitAllocatedPeriod; // period 分摊在途，同上
      r._c.availTurnover = avgSalesPeriod>0 ? Math.round(availAllocatedPeriod/avgSalesPeriod*10)/10 : null;
      // P2: 当前测算周转/在途后/下单后 全切 period（period 分摊 ÷ 渠道 period 月均），仅显示层，不写回采购链
      r._c.currentTurn = avgSalesPeriod>0 ? Math.round(poolAllocatedPeriod/avgSalesPeriod*10)/10 : t("app.799", "\u65e0\u9500\u91cf");
      r._c.transitTurnover = avgSalesPeriod>0 ? Math.round((availAllocatedPeriod+transitAllocatedPeriod)/avgSalesPeriod*10)/10 : null;
      r._c.afterOrderTurnover = avgSalesPeriod>0 ? Math.round((availAllocatedPeriod+transitAllocatedPeriod+r._c.suggestedQty)/avgSalesPeriod*10)/10 : null;
    });
    // 缓存行数据（含 _c 计算字段）供复盘弹窗读取
    window._rpChannelData = window._rpChannelData || {};
    var channelCache = {};
    data.forEach(function(r){ channelCache[r.id] = r; });
    window._rpChannelData[channel] = channelCache;
    // 列渲染器 — key 必须与 rpChannelColMeta() 中的 key 一致
    var Cols={};
    Cols.spacer={th:'<th style="width:36px"></th>',
      td:function(r,c){return '<td></td>';},
      sum:function(t){return '<td></td>';}};
    Cols.model={th:'<th>Model</th>',
      td:function(r,c){return '<td class="text-truncate" style="max-width:100px" title="'+esc(r.model||'')+'">'+esc(r.model||'')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.sku={th:'<th>SKU</th>',
      td:function(r,c){return '<td class="cell-id" title="'+esc(r.sku_code||'')+'">'+esc(r.sku_code||'')+'</td>';},
      sum:function(total){return '<td><span style="font-size:10px;color:#888">'+total.count+t('gen.L4269.1','个SKU</span></td>');}};
    Cols.sales_m4={th:rpThCompact(t('forecast.compact.month_sales','{month}\n销量',{month:ml[0]}),'','text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.salesM4)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.salesM4)+'</td>';}};
    Cols.sales_m3={th:rpThCompact(t('forecast.compact.month_sales','{month}\n销量',{month:ml[1]}),'','text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.salesM3)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.salesM3)+'</td>';}};
    Cols.sales_m2={th:rpThCompact(t('forecast.compact.month_sales','{month}\n销量',{month:ml[2]}),'','text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.salesM2)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.salesM2)+'</td>';}};
    Cols.sales_m1={th:rpThCompact(t('forecast.compact.this_month_sales','本月\n销量'),'','text-right','',true),
      td:function(r,c){return '<td class="text-right font-bold">'+formatQuantityDisplay(c.salesM1)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.salesM1)+'</td>';}};
    Cols.channel_avg={th:rpThCompact(t('forecast.compact.avg_monthly_sales','90天\n月均销量'),'',t('forecast.help.channel_avg_sales','按"预测参数设置"中的销量统计周期计算：近{days}天有效销量 ÷ {days} × 30。',{days:rpSalesStatsDays}),'text-right','',true),
      td:function(r,c){return '<td class="text-right font-bold">'+formatQuantityDisplay(c.avgSalesPeriod)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.avgSalesPeriod)+'</td>';}};
    Cols.channel_pct={th:rpThCompact(t('forecast.compact.sales_share','销量\n占比'),t("app.811", "\u6839\u636e\u8be5\u6e20\u9053\u9500\u91cf\u7edf\u8ba1\u5468\u671f(\u8fd1 N \u5929)\u9500\u91cf\u5360\u603b\u9500\u91cf(\u9500\u91cf\u7edf\u8ba1\u5468\u671f)\u7684\u6bd4\u4f8b\u8ba1\u7b97\uff0c\u7528\u4e8e\u5e93\u5b58\u5206\u644a\u548c\u8865\u8d27\u6d4b\u7b97\u3002\u5360\u6bd4\u4e0e\u5206\u644a\u5e93\u5b58\u6309\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\u3002"),'text-right','',true),
      td:function(r,c){return '<td class="text-right">'+(c.totalAvgPeriod>0?Math.round(c.pctPeriod)+'%':'-')+'</td>';},
      sum:function(t){return '<td class="text-right">'+(t.totalAvgPeriod>0?Math.round(t.avgSalesPeriod/t.totalAvgPeriod*100)+'%':'-')+'</td>';}};
    Cols.transit={th:rpThCompact(t('forecast.compact.allocated_in_transit','已分摊\n在途库存'),t('forecast.help.allocated_in_transit','按{channel}销量统计周期占比，从总在途库存中分摊给该渠道的数量（仅测算用，非独立仓库库存）。',{channel:chLabel}),'text-right','',true),
      td:function(r,c){return t('gen.L4289.1','<td class="text-right" title="总在途库存 ')+(c.transit||0)+' × '+chLabel+t('gen.L4289.2','销量统计周期占比 ')+Math.round(c.pctPeriod||0)+'%">'+formatQuantityDisplay(c.transitAllocatedPeriod)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.transitAllocatedPeriod)+'</td>';}};
    Cols.po_unconfirmed={th:rpThCompact(t('forecast.compact.po_unconfirmed','未确认\nPO'),t("app.796", "\u5df2\u7ecf\u521b\u5efa PO\uff0c\u4f46\u8fd8\u6ca1\u6709\u786e\u8ba4 PI \u7684\u6570\u91cf\u3002\u5c5e\u4e8e\u6f5c\u5728\u4f9b\u5e94\uff0c\u4e0d\u7b49\u4e8e\u4e00\u5b9a\u4f1a\u53d1\u8d27\u3002"),'text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(r.po_unconfirmed_pi_qty||0)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.po)+'</td>';}};
    Cols.avail={th:rpThCompact(t('forecast.compact.allocated_available','已分摊\n可用库存'),t('forecast.help.allocated_available','按{channel}销量统计周期占比，从总可用库存中分摊给该渠道的数量（仅测算用，非独立仓库库存）。',{channel:chLabel}),'text-right','',true),
      td:function(r,c){return t('gen.L4295.1','<td class="text-right" title="总可用库存 ')+(c.avail||0)+' × '+chLabel+t('gen.L4295.2','销量统计周期占比 ')+Math.round(c.pctPeriod||0)+'%">'+formatQuantityDisplay(c.availAllocatedPeriod)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.availAllocatedPeriod)+'</td>';}};
    Cols.current_turn={th:rpThCompact(t('forecast.compact.current_turnover','当前\n周转'),t("app.813", "\u6e20\u9053\u5206\u644a\u5e93\u5b58\u6c60\uff08\u6309\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u5360\u6bd4\u5206\u644a\uff09\u00f7 \u6e20\u9053\u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002\u8868\u793a\u73b0\u6709\u5e93\u5b58\u5927\u7ea6\u8fd8\u80fd\u5356\u51e0\u4e2a\u6708\u3002"),'text-right','',true),
      td:function(r,c){
        var cls=c.avgSalesPeriod>0?(c.currentTurn<2?'text-danger':c.currentTurn>6?'text-secondary':'text-success'):'text-muted';
        return '<td class="text-right '+cls+'">'+(c.avgSalesPeriod>0?c.currentTurn:t("app.799", "\u65e0\u9500\u91cf"))+'</td>';
      },
      sum:function(t){return '<td class="text-right">'+(t.avgSalesPeriod>0?Math.round(t.poolAllocatedPeriod/t.avgSalesPeriod*10)/10:'-')+'</td>';}};
    Cols.pi_unshipped={th:rpThCompact(t('forecast.compact.pi_unshipped','已确认PI\n未发货'),t("app.800", "PI \u5df2\u786e\u8ba4\uff0c\u4f44\u5de5\u5382\u8fd8\u6ca1\u6709\u53d1\u8d27\u7684\u6570\u91cf\u3002\u6bd4 PO\u672a\u786e\u8ba4PI \u66f4\u63a5\u8fd1\u5b9e\u9645\u4f9b\u5e94\u3002"),'text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.piUnshipped)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.piUnshipped)+'</td>';}},
    Cols.avail_turnover={th:rpTh(t('gen.L4306.1','当前可用周转'),t("app.801", "\u5f53\u524d\u53ef\u7528\u5e93\u5b58 \u00f7 \u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002\u8868\u793a\u4e0d\u8003\u8651\u5728\u9014\u548c\u672a\u53d1\u8d27\u8ba2\u5355\u65f6\uff0c\u73b0\u6709\u5e93\u5b58\u5927\u7ea6\u8fd8\u80fd\u5356\u51e0\u4e2a\u6708\u3002"),'text-right'),
      td:function(r,c){return '<td class="text-right '+(c.availTurnover!==null?(c.availTurnover<2?'text-danger':c.availTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.availTurnover!==null?c.availTurnover:'-')+'</td>';},
      sum:function(t){return '<td class="text-right"></td>';}};
    Cols.transit_turnover={th:rpTh(t("app.733", "\u5728\u9014\u540e\u5468\u8f6c"),t("app.802", "\uff08\u5f53\u524d\u53ef\u7528\u5e93\u5b58 + \u5728\u9014\u5e93\u5b58\uff09\u00f7 \u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002\u7528\u4e8e\u5224\u65ad\u5df2\u5728\u8def\u4e0a\u7684\u8d27\u5230\u540e\uff0c\u5e93\u5b58\u80fd\u652f\u6491\u591a\u4e45\u3002"),'text-right'),
      td:function(r,c){return '<td class="text-right '+(c.transitTurnover!==null?(c.transitTurnover<2?'text-danger':c.transitTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.transitTurnover!==null?c.transitTurnover:'-')+'</td>';},
      sum:function(t){return '<td class="text-right"></td>';}};
    Cols.after_order_turnover={th:rpThCompact(t('forecast.compact.after_order_turnover','下单后\n周转'),t("app.803", "\uff08\u5f53\u524d\u53ef\u7528\u5e93\u5b58 + \u5728\u9014\u5e93\u5b58 + \u672c\u6b21\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf\uff09\u00f7 \u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002\u7528\u4e8e\u5224\u65ad\u672c\u6b21\u8865\u8d27\u540e\u9884\u8ba1\u80fd\u652f\u6491\u51e0\u4e2a\u6708\u3002"),'text-right','',true),
      td:function(r,c){return '<td class="text-right rp-after-order-turn" data-rid="'+r.id+'" '+(c.afterOrderTurnover!==null?(c.afterOrderTurnover<2?'text-danger':c.afterOrderTurnover>6?'text-secondary':'text-success'):'text-muted')+'>'+(c.afterOrderTurnover!==null?c.afterOrderTurnover:'-')+'</td>';},
      sum:function(t){return '<td class="text-right"></td>';}};
    Cols.sales_status={th:rpThCompact(t('forecast.compact.sales_status','销量\n状态'),t("app.804", "\u7cfb\u7edf\u6839\u636e\u9500\u91cf\u3001\u5e93\u5b58\u3001\u5e93\u9f84\u3001\u7f3a\u8d27\u3001\u6162\u9500\u3001\u9ad8\u5e93\u5b58\u7b49\u89c4\u5219\u5224\u65ad SKU \u5f53\u524d\u72b6\u6001\u3002"),'text-center','',true),
      td:function(r,c){return '<td class="text-center rp-sales-status-cell"><span class="status-badge">'+formatForecastSalesStatus(r.sales_status||'')+'</span></td>';},
      sum:function(t){return '<td class="text-center"></td>';}};
    Cols.risk_tags={th:rpThCompact(t('forecast.compact.risk_tags','风险\n标签'),'','','text-center','',true),
      td:function(r,c){return '<td class="rp-cell-wrap text-center rp-risk-tags-cell">'+formatForecastRiskTags(r.risk_tags||'')+'</td>';},
      sum:function(t){return '<td class="text-center"></td>';}};
    Cols.action_rec={th:rpThCompact(t('forecast.compact.action_rec','建议\n操作'),t("app.805", "\u7cfb\u7edf\u6839\u636e\u52a8\u9500\u5224\u65ad\u7ed9\u51fa\u7684\u64cd\u4f5c\u5efa\u8bae\uff0c\u4f8b\u5982\u4f18\u5148\u8865\u8d27\u3001\u8c28\u614e\u8865\u8d27\u3001\u6682\u505c\u8865\u8d27\u3001\u4eba\u5de5\u590d\u6838\u3002"),'','',true),
      td:function(r,c){return '<td class="rp-cell-wrap" title="'+esc(r.action||'')+'">'+formatForecastAction(r.action||'')+'</td>';},
      sum:function(t){return '<td></td>';}};
    // 动销判断 = 动销状态 ｜ 风险标签（前端合并展示）
    Cols.sales_judgement={th:rpThCompact(t('forecast.compact.sales_judgement','动销\n判断'),t("app.804", "\u7cfb\u7edf\u6839\u636e\u9500\u91cf\u3001\u5e93\u5b58\u3001\u5e93\u9f84\u3001\u7f3a\u8d27\u3001\u6162\u9500\u3001\u9ad8\u5e93\u5b58\u7b49\u89c4\u5219\u5224\u65ad SKU \u5f53\u524d\u72b6\u6001\u3002"),'','',true),
      td:function(r,c){return '<td class="rp-movement-cell" style="min-width:150px;max-width:180px">'+buildSalesJudgement(r)+'</td>';},
      sum:function(t){return '<td></td>';}};
    // 复盘入口
    Cols.review={th:t('gen.L4329.1','<th class="text-center">复盘</th>'),
      td:function(r,c){return '<td class="cell-actions text-center"><button class="action-btn" onclick="openRpReview(\''+r.id+'\',\''+channel+t('gen.L4330.1','\')" title="查看复盘">查看</button></td>');},
      sum:function(t){return '<td class="text-center"></td>';}};
    Cols.target_turn={th:rpThCompact(t('forecast.compact.target_turnover','目标\n周转'),t("app.808", "\u5e0c\u671b\u8865\u8d27\u540e\u5e93\u5b58\u80fd\u8986\u76d6\u7684\u9500\u552e\u6708\u6570\u3002\u5b83\u662f\u8ba1\u7b97\u53c2\u6570\uff0c\u4e0d\u662f\u5b9e\u9645\u5e93\u5b58\u7ed3\u679c\u3002"),'text-right','',true),
      td:function(r,c){
        return '<td class="text-right"><input type="number" class="rp-target-turn" data-rid="'+r.id+'" data-channel="'+channel+'" data-avg-sales="'+c.avgSales+'" value="'+c.targetTurn+'" min="0" step="0.5" style="width:65px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-weight:bold;text-align:center" onchange="onTargetTurnChange(this)"></td>';
      },
      sum:function(t){return '<td class="text-right"></td>';}};
    Cols.target_stock={th:rpThCompact(t('forecast.compact.suggested_purchase','建议\n采购'),t("app.809", "\u57fa\u4e8e\u9500\u91cf\u7edf\u8ba1\u5468\u671f(\u8fd1 N \u5929)\u6708\u5747\u9500\u91cf\u4e0e\u76ee\u6807\u5468\u8f6c\u8ba1\u7b97\u7684\u5efa\u8bae\u8865\u8d27\u6570\u91cf\u3002\u6162\u9500\u3001\u5446\u6ede\u3001\u9ad8\u5e93\u5b58\u7b49 SKU \u4f1a\u88ab\u62a6\u622a\u4e3a 0\u3002"),'text-right','',true),
      td:function(r,c){
        var _blocked=shouldBlockReplenish(r.sales_status||'',r.risk_tags||'');
        var _val=_blocked?0:Math.round(c.suggestedQty||0);
        return '<td class="text-right"><input type="number" class="rp-target-stock-input" data-rid="'+r.id+'" data-channel="'+channel+'" value="'+_val+'" min="0" style="width:75px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-weight:bold;text-align:center" onchange="onChannelTargetStockChange(this)"></td>';
      },
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.suggestedQty)+'</td>';}};
    Cols.last_inbound_date={th:rpThCompact(t('forecast.compact.last_inbound_date','最近\n入库日期'),t("app.806", "\u8be5 SKU \u6700\u8fd1\u4e00\u6b21\u5165\u5e93\u7684\u65e5\u671f\uff0c\u7528\u4e8e\u5224\u65ad\u5e93\u9f84\u548c\u662f\u5426\u957f\u671f\u672a\u8865\u8d27\u3002"),'text-center','',true),
      td:function(r,c){return '<td class="cell-date text-center">'+(r.last_inbound_date?fmtDate(r.last_inbound_date):t("app.673", "\u672a\u77e5"))+'</td>';},
      sum:function(t){return '<td class="text-center"></td>';}};
    Cols.days_since_last_inbound={th:rpThCompact(t('forecast.compact.days_since_last_inbound','距上次\n入库天数'),t("app.807", "\u5f53\u524d\u65e5\u671f\u8ddd\u79bb\u6700\u540e\u4e00\u6b21\u5165\u5e93\u65e5\u671f\u7684\u5929\u6570\u3002\u5929\u6570\u8d8a\u957f\uff0c\u8bf4\u660e\u8be5 SKU \u8d8a\u4e45\u6ca1\u6709\u65b0\u8d27\u5165\u5e93\u3002"),'text-right','',true),
      td:function(r,c){
        var d=r.days_since_last_inbound;
        var cls=d!==null?(d<=90?'text-success':d<=180?'text-primary':d<=365?'text-warning':'text-danger'):'text-muted';
        return '<td class="text-right '+cls+'">'+(d!==null?d:t('gen.L4351.1','未知'))+'</td>';
      },
      sum:function(t){return '<td class="text-right"></td>';}};
    Cols.remark={th:rpThCompact(t('forecast.compact.remark','备注'),'','','',true),
      td:function(r,c){return '<td><input type="text" class="rp-channel-remark" data-rid="'+r.id+'" data-channel="'+channel+'" value="'+esc(c.remark)+'" onblur="onChannelRemarkBlur(this)" style="width:110px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px"></td>';},
      sum:function(t){return '<td></td>';}};
    Cols.actions={th:t('gen.L4357.1','<th class="text-center">操作</th>'),
      td:function(r,c){return '<td class="cell-actions text-center"><button class="action-btn" onclick="saveChannelChanges(\''+r.id+'\',\''+channel+t('gen.L4358.1','\')" title="\u4fdd\u5b58">💾</button></td>');},
      sum:function(t){return '<td class="text-center"></td>';}};
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
    // 计算合计（salesM1~M4 语义与字段一致：M1=本月, M2=上月, M3=上上月, M4=4个月前）
    var totals={count:data.length,salesM1:0,salesM2:0,salesM3:0,salesM4:0,avgSales:0,totalAvg:0,totalAvgPeriod:0,avgSalesPeriod:0,transit:0,transitAllocated:0,transitAllocatedPeriod:0,po:0,avail:0,availAllocated:0,availAllocatedPeriod:0,piUnshipped:0,allocatedStock:0,poolAllocatedPeriod:0,targetStock:0,suggestedQty:0};
    data.forEach(function(r){
      var c=r._c;
      totals.salesM4+=c.salesM4;totals.salesM3+=c.salesM3;totals.salesM2+=c.salesM2;totals.salesM1+=c.salesM1;
      totals.avgSales+=c.avgSales;totals.totalAvg+=c.totalAvg;totals.totalAvgPeriod+=c.totalAvgPeriod;totals.avgSalesPeriod+=c.avgSalesPeriod;
      totals.transit+=c.transit;totals.transitAllocated+=c.transitAllocated;totals.transitAllocatedPeriod+=(c.transitAllocatedPeriod||0);totals.po+=c.po;totals.avail+=c.avail;totals.availAllocated+=c.availAllocated;totals.availAllocatedPeriod+=(c.availAllocatedPeriod||0);
      totals.piUnshipped+=c.piUnshipped;
      totals.allocatedStock+=c.allocatedStock;totals.poolAllocatedPeriod+=(c.poolAllocatedPeriod||0);totals.targetStock+=c.targetStock;
      totals.suggestedQty+=Math.round(c.suggestedQty||0);
    });
    // 渲染
    var th=activeKeys.map(function(k){return Cols[k].th;}).join('');
    var rows=data.map(function(r){
      return '<tr data-rid="'+r.id+'">' + activeKeys.map(function(k){return Cols[k].td(r,r._c);}).join('') + '</tr>';
    }).join('');
    var sum='<tr class="rp-summary-row">' + activeKeys.map(function(k){return Cols[k].sum(totals);}).join('') + '</tr>';
    var colCount=activeKeys.length;
    var tableFoot=!data.length
      ? '<tr><td colspan="'+colCount+t('gen.L4389.1','" style="text-align:center;padding:40px 20px;color:#999;background:#fafbfc">💡 当前筛选条件下暂无建议，请调整国家/仓库/品牌或点击"重新计算"</td></tr>')
      : '';
    document.getElementById('rp-table').innerHTML='<div class="table-container" style="box-shadow:none;border-radius:0;overflow:auto;max-height:70vh"><table class="data-table rp-monthly-table" style="width:'+rpColWidthTotal(activeKeys)+'px;min-width:'+rpColWidthTotal(activeKeys)+'px">'+rpColgroupHtml(activeKeys)+'<thead><tr style="height:34px">'+th+'</tr>'+sum+'</thead><tbody>'+rows+tableFoot+'</tbody></table></div>';
    applyChannelFreezeColumns(tabKey, activeKeys);
    syncRpHeaderHeight();
    initRpTableDrag(channel);
  }catch(e){showFlash(e.message,'danger')}
}

// 订单预测表头换行后：同步合计行 sticky top 到实际表头高度
function syncRpHeaderHeight(){
  var headerTr=document.querySelector('#rp-table .rp-monthly-table thead tr:first-child');
  if(!headerTr) return;
  var summaryTds=document.querySelectorAll('#rp-table .rp-monthly-table .rp-summary-row td');
  if(!summaryTds.length) return;
  var h=headerTr.offsetHeight||34;
  for(var i=0;i<summaryTds.length;i++){ summaryTds[i].style.top=h+'px'; }
}

// 渠道表格动态冻结列：飞书风格可拖拽冻结线
// 基于 localStorage 保存的字段 key 恢复冻结位置；字段配置变化后自动重算
function applyChannelFreezeColumns(tabKey, activeKeys){
  var container=document.querySelector('#rp-table .table-container');
  var table=container?container.querySelector('.rp-monthly-table'):null;
  if(!table) return;
  // 1. 先清理旧 sticky 样式（字段配置/切换页面/拖动后都会重新计算，避免残留）
  clearFreezeStyles(table);
  // 2. 读取保存的冻结字段 key
  var freezeKey=getFreezeColKey(tabKey);
  var freezeIdx=-1;
  if(freezeKey){
    for(var i=0;i<activeKeys.length;i++){
      if(activeKeys[i]===freezeKey){ freezeIdx=i; break; }
    }
    // 保存的字段被隐藏 → 退回到其前一个可见列；若前面没有可见列 → 不冻结
    if(freezeIdx<0){
      var fullConfig=getRpColConfig(tabKey);
      var cfgIdx=-1;
      for(var ci=0;ci<fullConfig.length;ci++){
        if(fullConfig[ci].key===freezeKey){ cfgIdx=ci; break; }
      }
      var fallbackKey='';
      if(cfgIdx>0){
        for(var pi=cfgIdx-1;pi>=0;pi--){
          if(fullConfig[pi].visible||fullConfig[pi].fixed){ fallbackKey=fullConfig[pi].key; break; }
        }
      }
      if(fallbackKey){
        for(var fi=0;fi<activeKeys.length;fi++){
          if(activeKeys[fi]===fallbackKey){ freezeIdx=fi; break; }
        }
        setFreezeColKey(tabKey, fallbackKey);
      }else{
        setFreezeColKey(tabKey,'');
      }
    }
  }
  // freezeIdx<0 → 取消冻结（不设 sticky，冻结线隐藏）
  // 3. 读取表头行各 cell 实际宽度，计算累计 left 偏移
  var headRow=table.querySelector('thead tr');
  var headCells=headRow?headRow.children:[];
  if(!headCells.length) { renderFreezeLine(container, tabKey, activeKeys, -1, []); return; }
  var widths=[];
  var lefts=[];
  var total=0;
  for(var w=0;w<headCells.length;w++){
    var cw=headCells[w].offsetWidth||headCells[w].getBoundingClientRect().width||0;
    widths.push(cw);
    lefts.push(total);
    total+=cw;
  }
  // 4. 设置 sticky（表头/合计行/数据行的前 freezeIdx+1 列）
  if(freezeIdx>=0){
    // 表头
    for(var hi=0;hi<=freezeIdx;hi++){
      var hCell=headCells[hi];
      if(!hCell) continue;
      hCell.classList.add('rp-freeze-cell');
      hCell.style.left=lefts[hi]+'px';
      if(hi===freezeIdx) hCell.classList.add('rp-freeze-last');
    }
    // 合计行
    var sumRow=table.querySelector('.rp-summary-row');
    if(sumRow){
      var sumCells=sumRow.children;
      for(var si=0;si<=freezeIdx;si++){
        var sCell=sumCells[si];
        if(!sCell) continue;
        sCell.classList.add('rp-freeze-cell');
        sCell.style.left=lefts[si]+'px';
        if(si===freezeIdx) sCell.classList.add('rp-freeze-last');
      }
    }
    // 数据行
    var bodyRows=table.querySelectorAll('tbody tr');
    Array.prototype.forEach.call(bodyRows,function(tr){
      var cells=tr.children;
      for(var bi=0;bi<=freezeIdx;bi++){
        var bCell=cells[bi];
        if(!bCell) continue;
        bCell.classList.add('rp-freeze-cell');
        bCell.style.left=lefts[bi]+'px';
        if(bi===freezeIdx) bCell.classList.add('rp-freeze-last');
      }
    });
  }
  // 5. 渲染冻结线
  renderFreezeLine(container, tabKey, activeKeys, freezeIdx, widths, lefts);
}

// 清理旧冻结样式：position/left/z-index/box-shadow/background/border-right/rp-freeze-last class
// 用 .rp-freeze-cell,.rp-freeze-last 双选择器，确保任何残留的 rp-freeze-last 都被清理（避免灰线残留）
// 同时清理可能残留的 .dragging / .visible class（拖拽中断时的兜底）
function clearFreezeStyles(table){
  var cells=table.querySelectorAll('.rp-freeze-cell,.rp-freeze-last');
  Array.prototype.forEach.call(cells,function(c){
    c.classList.remove('rp-freeze-cell','rp-freeze-last');
    c.style.left='';
    c.style.position='';
    c.style.zIndex='';
    c.style.boxShadow='';
    c.style.background='';
    c.style.borderRight='';
  });
  // 清理可能残留的 rp-freeze-line / rp-freeze-drop-line，并清除 .dragging / .visible 残留 class
  var container=table.closest('.table-container');
  if(container){
    var oldLines=container.querySelectorAll('.rp-freeze-line,.rp-freeze-drop-line');
    Array.prototype.forEach.call(oldLines,function(l){
      l.classList.remove('dragging','visible');
      l.remove();
    });
    // 移除旧 scroll handler，避免残留 handler 校正到不存在的线
    if(container._rpFreezeScrollHandler){
      container.removeEventListener('scroll',container._rpFreezeScrollHandler);
      container._rpFreezeScrollHandler=null;
    }
  }
}

// 读取/保存冻结字段 key（用字段 key 保存，不用列序号）
// null=未配置→默认 last_inbound_date；空字符串=用户选择"不冻结"
function getFreezeColKey(tabKey){
  var v=localStorage.getItem('rp_freeze_col_'+tabKey);
  if(v===null) return 'last_inbound_date';
  return v;
}
function setFreezeColKey(tabKey, colKey){
  localStorage.setItem('rp_freeze_col_'+tabKey, colKey||'');
}

// 按天冻结配置：独立于按月保存（rp_freeze_col_daily_{tabKey}）
// null=未配置→默认 trend（保持 checkpoint f7d95df 硬编码 10 列行为，最后一列为 trend）
// 空字符串=用户选择"不冻结"
// 其他值=冻结到该字段 key（必须是按天固定信息列稳定 key）
function getDailyFreezeColKey(tabKey){
  var v=localStorage.getItem('rp_freeze_col_daily_'+tabKey);
  if(v===null) return 'trend';
  return v;
}
function setDailyFreezeColKey(tabKey, colKey){
  localStorage.setItem('rp_freeze_col_daily_'+tabKey, colKey||'');
}

// 渲染冻结线 + 绑定拖拽 + scroll 校正
function renderFreezeLine(container, tabKey, activeKeys, freezeIdx, widths, lefts){
  // 移除旧冻结线和落点线（确保页面只有一条冻结线）
  var oldLines=container.querySelectorAll('.rp-freeze-line,.rp-freeze-drop-line');
  Array.prototype.forEach.call(oldLines,function(l){ l.remove(); });
  // 移除旧 scroll handler（无论是否取消冻结，都先清理，避免残留 handler）
  if(container._rpFreezeScrollHandler){
    container.removeEventListener('scroll',container._rpFreezeScrollHandler);
    container._rpFreezeScrollHandler=null;
  }
  // 取消冻结 → 不显示冻结线
  if(freezeIdx<0||!widths.length) return;
  // 冻结线位置 = 冻结区右边界（表格内容坐标）
  var freezeRight=lefts[freezeIdx]+widths[freezeIdx];
  // 创建冻结线元素
  var line=document.createElement('div');
  line.className='rp-freeze-line';
  line.innerHTML=t('gen.L4533.1','<div class="rp-freeze-line-tooltip">拖动调整冻结区域</div>');
  container.appendChild(line);
  // 存储当前冻结右边界，供 scroll handler 使用
  line._rpFreezeRight=freezeRight;
  // 立即校正位置（考虑当前 scrollLeft）
  line.style.left=(freezeRight - container.scrollLeft)+'px';
  // 重新绑定 scroll handler：冻结线固定在视口冻结区右边界，不随横向滚动移动
  container._rpFreezeScrollHandler=function(){
    // 防御：如果存在多条冻结线（异常情况），只保留最后一条，移除其余
    var lines=container.querySelectorAll('.rp-freeze-line');
    if(lines.length>1){
      for(var i=0;i<lines.length-1;i++){ lines[i].remove(); }
    }
    var l=container.querySelector('.rp-freeze-line');
    if(l && l._rpFreezeRight!=null){
      l.style.left=(l._rpFreezeRight - container.scrollLeft)+'px';
    }
  };
  container.addEventListener('scroll',container._rpFreezeScrollHandler,{passive:true});
  // 绑定拖拽
  initFreezeLineDrag(line, container, tabKey, activeKeys, widths, lefts);
}

// 冻结线拖拽逻辑：当前冻结线不动，新增落点提示线吸附到列边界
// 拖拽状态清理：onUp + window.blur + document mouseout/pointerout + ESC 四出口兜底
function initFreezeLineDrag(line, container, tabKey, activeKeys, widths, lefts){
  line.addEventListener('mousedown',function(e){
    e.preventDefault();
    e.stopPropagation();
    line.classList.add('dragging');
    document.body.style.userSelect='none';
    var containerRect=container.getBoundingClientRect();
    // 创建落点提示线
    var dropLine=document.createElement('div');
    dropLine.className='rp-freeze-drop-line';
    container.appendChild(dropLine);
    // 计算所有列边界（累计宽度的右边界），用于吸附
    var bounds=[]; // {idx, x} 每列右边界
    var acc=0;
    for(var i=0;i<widths.length;i++){
      acc+=widths[i];
      bounds.push({idx:i, x:acc});
    }
    // 根据鼠标 x 找最近的列边界（吸附）
    function findNearestBound(mouseX){
      if(!bounds.length) return -1;
      // 拖到最左边（x < 第一列宽度的一半）→ 取消冻结
      if(mouseX < widths[0]/2) return -1;
      var best=bounds[0]; var bestDist=Math.abs(bounds[0].x-mouseX);
      for(var b=1;b<bounds.length;b++){
        var d=Math.abs(bounds[b].x-mouseX);
        if(d<bestDist){ best=bounds[b]; bestDist=d; }
      }
      return best.idx;
    }
    // mousemove：落点线吸附到最近列边界，当前冻结线不动
    function onMove(ev){
      var mouseX=ev.clientX-containerRect.left+container.scrollLeft;
      var nearestIdx=findNearestBound(mouseX);
      if(nearestIdx<0){
        // 取消冻结：落点线放最左侧
        dropLine.style.left='0px';
        dropLine.classList.add('visible');
      }else{
        var dropX=lefts[nearestIdx]+widths[nearestIdx];
        dropLine.style.left=(dropX - container.scrollLeft)+'px';
        dropLine.classList.add('visible');
      }
    }
    // 统一清理函数：移除监听 + 清除 class + 移除节点 + 还原 body
    // 在 onUp / window.blur / document mouseout / ESC 四个出口调用
    var _cleaned=false;
    function _cleanupDrag(){
      if(_cleaned) return; _cleaned=true;
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
      window.removeEventListener('blur',_cleanupDrag);
      document.removeEventListener('mouseout',_onDocMouseOut);
      document.removeEventListener('pointerout',_onDocMouseOut);
      document.removeEventListener('keydown',_onKey);
      line.classList.remove('dragging');
      document.body.style.userSelect='';
      dropLine.classList.remove('visible');
      if(dropLine.parentNode) dropLine.remove();
    }
    // ESC 键取消拖拽
    function _onKey(ev){
      if(ev.key==='Escape'||ev.keyCode===27){ _cleanupDrag(); }
    }
    // 鼠标离开文档（mouseout/pointerout 兜底，relatedTarget 为 null 或不在 document 时触发）
    function _onDocMouseOut(ev){
      if(!ev.relatedTarget || ev.relatedTarget.nodeName==='HTML'){
        _cleanupDrag();
      }
    }
    // mouseup：根据落点线位置确定冻结列
    function onUp(ev){
      var mouseX=ev.clientX-containerRect.left+container.scrollLeft;
      var newFreezeIdx=findNearestBound(mouseX);
      _cleanupDrag();
      // 保存冻结字段 key
      if(newFreezeIdx>=0){
        setFreezeColKey(tabKey, activeKeys[newFreezeIdx]);
      }else{
        setFreezeColKey(tabKey,''); // 取消冻结
      }
      // 重新渲染冻结列
      applyChannelFreezeColumns(tabKey, activeKeys);
    }
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
    window.addEventListener('blur',_cleanupDrag);
    document.addEventListener('mouseout',_onDocMouseOut);
    document.addEventListener('pointerout',_onDocMouseOut);
    document.addEventListener('keydown',_onKey);
    // 立即触发一次，让落点线出现在鼠标位置
    onMove(e);
  });
}
function openRpReview(rid, channel){
  var cache = window._rpChannelData && window._rpChannelData[channel];
  var r = cache ? cache[rid] : null;
  if(!r){ showToast(t('gen.L4655.1','未找到该行数据，请刷新后重试'),'danger'); return; }
  var c = r._c || {};
  var isOnline = channel==='online';
  var chLabel = isOnline?t('gen.L4658.1','线上'):t('gen.L4658.2','线下');
  var rawRisk = r.risk_tags || '';
  var tags = Array.isArray(rawRisk)?rawRisk:String(rawRisk).split(',').map(function(s){return s.trim();}).filter(Boolean);
  // 枚举字段保持数据库原始值，前端按原始值格式化三语
  // sales_reason / ai_business_advice 由后端按请求语言翻译后直接显示
  var statusText = r.sales_status ? formatForecastSalesStatus(r.sales_status) : t("app.673", "\u672a\u77e5");
  var judgementText = tags.length ? (statusText+'｜'+tags.map(formatForecastRiskTag).join('、')) : statusText;
  var actionShort = simplifyAction(r.action);
  var actionFull = r.action || '';
  var actionShortI18n = formatForecastAction(actionShort) || actionShort;
  var actionFullI18n = formatForecastAction(actionFull) || actionFull;
  var actionHtml = actionShortI18n + (actionFull && actionFull!==actionShort ? '<br><span style="color:var(--text-secondary);font-size:12px">'+esc(actionFullI18n)+'</span>' : '');
  function kv(label, val, isHtml){
    var v = (val===null||val===undefined||val==='') ? '<span class="text-muted">-</span>' : (isHtml?val:esc(val));
    return '<div class="detail-item"><span class="detail-label">'+esc(label)+'</span><span class="detail-value">'+v+'</span></div>';
  }
  var html='<div class="detail-card" style="box-shadow:none;padding:0">'
    // 1. 系统判断
    +t('gen.L4672.1','<div class="detail-section"><h3>1. 系统判断</h3><div class="detail-grid">')
    +kv(t("app.110", "\u52a8\u9500\u5224\u65ad"), judgementText)
    +kv(t("app.111", "\u5efa\u8bae\u52a8\u4f5c"), actionHtml, true)
    +'</div></div>'
    // 2. 判断原因（上下排列，各占整行，便于多句长文本阅读）
    +t('gen.L4677.1','<div class="detail-section"><h3>2. 判断原因</h3><div class="rp-review-reason-wrap">')
    +'<div class="rp-review-reason-item"><div class="detail-label">'+esc(t("app.742", "\u52a8\u9500\u539f\u56e0"))+'</div><div class="rp-review-reason-text">'+esc(r.sales_reason||'')+'</div></div>'
    +'<div class="rp-review-reason-item"><div class="detail-label">'+esc(t("app.737", "AI\u5efa\u8bae"))+'</div><div class="rp-review-reason-text">'+esc(r.ai_business_advice||'')+'</div></div>'
    +'</div></div>'
    // 3. 关键数据（渠道口径）
    +t('forecast.review.key_data_title','<div class="detail-section"><h3>3. 关键数据（{channel}）</h3><div class="detail-grid">', {channel:chLabel})
    +kv(t('forecast.review.monthly_avg','{channel} 月均', {channel:chLabel}), c.avgSales!==undefined?formatQuantityDisplay(c.avgSales):'')
    +kv(t('forecast.review.sales_share','{channel} 占比', {channel:chLabel}), c.pct!==undefined?Math.round(c.pct)+'%':'')
    +kv(t('forecast.review.allocated_available','已分摊可用库存（{channel}）', {channel:chLabel}), c.availAllocated!==undefined?formatQuantityDisplay(c.availAllocated):'')
    +kv(t('gen.L4686.1','当前可用周转'), c.availTurnover!==null?c.availTurnover:t("app.799", "\u65e0\u9500\u91cf"))
    +kv(t('forecast.review.allocated_in_transit','已分摊在途库存（{channel}）', {channel:chLabel}), c.transitAllocated!==undefined?formatQuantityDisplay(c.transitAllocated):'')
    +kv(t("app.733", "\u5728\u9014\u540e\u5468\u8f6c"), c.transitTurnover!==null?c.transitTurnover:t("app.799", "\u65e0\u9500\u91cf"))
    +kv(t("app.732", "PO\u672a\u786e\u8ba4PI"), formatQuantityDisplay(r.po_unconfirmed_pi_qty||0))
    +kv(t("app.731", "PI\u5df2\u786e\u8ba4\u672a\u53d1\u8d27"), formatQuantityDisplay(c.piUnshipped))
    +kv(t("app.660", "\u76ee\u6807\u5468\u8f6c"), c.targetTurn)
    +kv(t("app.109", "\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf"), formatQuantityDisplay(c.suggestedQty))
    +kv(t("app.734", "\u4e0b\u5355\u540e\u5468\u8f6c"), c.afterOrderTurnover!==null?c.afterOrderTurnover:t("app.799", "\u65e0\u9500\u91cf"))
    +kv(t("po.012", "\u6700\u540e\u5165\u5e93\u65e5\u671f"), r.last_inbound_date?fmtDate(r.last_inbound_date):t("app.673", "\u672a\u77e5"))
    +kv(t("app.663", "\u8ddd\u6700\u540e\u5165\u5e93\u5929\u6570"), r.days_since_last_inbound!==null?r.days_since_last_inbound:t("app.673", "\u672a\u77e5"))
    +'</div></div>'
    // 4. 人工调整
    +t('gen.L4698.1','<div class="detail-section"><h3>4. 人工调整</h3><div class="detail-grid">')
    +kv(t("app.025", "\u5907\u6ce8"), c.remark||'')
    +kv(t("app.820", "\u8c03\u6574\u4eba"), t('gen.L4700.1','<span class="text-muted">暂无记录</span>'), true)
    +kv(t("app.822", "\u8c03\u6574\u65f6\u95f4"), t('gen.L4701.1','<span class="text-muted">暂无记录</span>'), true)
    +kv(t("app.823", "\u8c03\u6574\u524d\u6570\u91cf"), t('gen.L4702.1','<span class="text-muted">暂无记录</span>'), true)
    +kv(t("app.824", "\u8c03\u6574\u540e\u6570\u91cf"), t('gen.L4703.1','<span class="text-muted">暂无记录</span>'), true)
    +'</div></div>'
    +'</div>';
  openModal(t('modal.title.openRpReview', '复盘 - {v1} ({v2})', {v1: r.sku_code||'', v2: chLabel}), html,
    t('gen.L4707.1','<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'), 'rp-review-modal');
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

// 线上/线下建议采购数量修改 → 自动保存 + 换算下单后周转 + 反馈
// input 显示的是最终建议值（suggestedQty），用户编辑后反推 target_stock = 输入值 + allocatedStock
async function onChannelTargetStockChange(input){
  var rid=input.dataset.rid;
  var channel=input.dataset.channel;
  var qty=parseInt(input.value)||0;
  // 从缓存读取行数据用于换算
  var cache=window._rpChannelData&&window._rpChannelData[channel];
  var r=cache?cache[rid]:null;
  var c=r?r._c:null;
  // 反推 target_stock = 用户输入的最终建议值 + 渠道分摊库存
  var allocatedStock=c?c.allocatedStock:0;
  var targetStock=qty+allocatedStock;
  // 前端实时换算下单后周转（基于渠道 period 分摊库存 + 新建议采购；与 P2 显示口径一致）
  if(c){
    var newAfterOrder=c.avgSalesPeriod>0?Math.round((c.availAllocatedPeriod+c.transitAllocatedPeriod+qty)/c.avgSalesPeriod*10)/10:null;
    c.afterOrderTurnover=newAfterOrder; // 同步缓存，供复盘弹窗读取
    var turnEl=document.querySelector('.rp-after-order-turn[data-rid="'+rid+'"]');
    if(turnEl&&newAfterOrder!==null){
      turnEl.textContent=newAfterOrder;
      var cls=newAfterOrder<2?'text-danger':newAfterOrder>6?'text-secondary':'text-success';
      turnEl.className='text-right rp-after-order-turn '+cls;
    }
  }
  // 异步保存（后端按反推后的 target_stock 重算 suggested_qty）
  var data={};
  if(channel==='online') data.online_target_stock=targetStock;
  else data.offline_target_stock=targetStock;
  try{
    var resp=await api('/api/replenishment-suggestions/'+rid,'PUT',data);
    var d=resp.data;
    if(d){
      // 同步缓存：target_stock（反推值）+ suggested_qty（后端重算）+ suggestedQty（前端显示值）
      if(r){
        if(channel==='online'){ r.online_target_stock=targetStock; r.online_suggested_qty=d.online_suggested_qty; }
        else { r.offline_target_stock=targetStock; r.offline_suggested_qty=d.offline_suggested_qty; }
        r.suggested_qty=d.suggested_qty;
        if(c) c.suggestedQty = channel==='online' ? (d.online_suggested_qty||0) : (d.offline_suggested_qty||0);
      }
    }
    showRpAutoSaved(input);
  }catch(e){
    showRpSaveFailed(input);
  }
}

// 线上/线下备注修改 → 自动保存
async function onChannelRemarkBlur(input){
  var rid=input.dataset.rid;
  var channel=input.dataset.channel;
  var val=input.value;
  var data={};
  if(channel==='online') data.online_remark=val;
  else data.offline_remark=val;
  try{
    await api('/api/replenishment-suggestions/'+rid,'PUT',data);
    showRpAutoSaved(input);
  }catch(e){
    showRpSaveFailed(input);
  }
}

// 自动保存成功反馈：输入框右侧短暂显示"已保存"
function showRpAutoSaved(input){
  var td=input.parentNode;
  if(!td) return;
  // 避免重复添加
  var existing=td.querySelector('.rp-save-tip');
  if(existing) existing.remove();
  var tip=document.createElement('span');
  tip.className='rp-save-tip';
  tip.textContent=t("app.825", "\u5df2\u4fdd\u5b58");
  tip.style.cssText='position:absolute;right:4px;top:50%;transform:translateY(-50%);font-size:10px;color:#52c41a;pointer-events:none;animation:rpFadeOut 1.6s ease 0.4s forwards';
  td.style.position='relative';
  td.appendChild(tip);
  setTimeout(function(){ if(tip.parentNode) tip.remove(); },2200);
}
// 保存失败反馈：输入框红色边框 + toast
function showRpSaveFailed(input){
  input.style.borderColor='#ff4d4f';
  input.style.boxShadow='0 0 0 2px rgba(255,77,79,0.2)';
  showToast(t('gen.L4805.1','保存失败，请重试'),'danger');
  setTimeout(function(){
    input.style.borderColor='';
    input.style.boxShadow='';
  },2500);
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
    turnEl.textContent=totalAvg>0?afterOrder:t("app.799", "\u65e0\u9500\u91cf");
    var cls=afterOrder<2?'text-danger':afterOrder>=2&&afterOrder<4?'text-success':afterOrder>=4&&afterOrder<6?'text-primary':'text-secondary';
    turnEl.className='text-right '+cls;
  }
  // 启用/禁用调整原因
  var reasonSel=document.querySelector('.rp-adj-reason[data-rid="'+rid+'"]');
  if(reasonSel){
    if(foq!==suggested){
      reasonSel.disabled=false;
      if(reasonSel.value==='') reasonSel.options[0].text=t("app.211", "\u8bf7\u9009\u62e9");
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
    showToast(t('gen.L4853.1','调整原因已保存'),'success');
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
    showToast(t('gen.L4880.1','已保存，目标库存已回写总预测'),'success');
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
    showToast(t('gen.L4894.1','已保存'),'success');
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

    // 按天固定信息列定义：稳定 key + 宽度（用于冻结边界计算）
    // 注意：动态日期列不参与冻结边界配置（本轮限制）
    // 宽度按英文文案完整换行后可读性调整（不改变字段顺序与 key）
    var dailyCols=[
      {key:'selection',        width:36},
      {key:'sales_group',      width:88},
      {key:'lifecycle_status', width:120},
      {key:'model',            width:124},
      {key:'sku',              width:140},
      {key:'last_7_days',      width:80},
      {key:'last_14_days',     width:80},
      {key:'last_30_days',     width:80},
      {key:'avg_daily_sales',  width:88},
      {key:'trend',            width:60}
    ];
    var fcw=dailyCols.map(function(c){return c.width;});
    var fcLeft=[]; var totalFw=0;
    fcw.forEach(function(w,i){fcLeft.push(totalFw);totalFw+=w;});
    var headerH=34; // 表头行高
    var summaryH=30; // 汇总行高

    // 读取按天冻结配置（独立于按月保存）
    // null=未配置→默认 trend（保持 checkpoint f7d95df 硬编码 10 列行为）
    // 空字符串=用户选择"不冻结"
    var freezeKey=getDailyFreezeColKey(rpTab);
    var freezeIdx=-1;
    if(freezeKey){
      for(var di=0;di<dailyCols.length;di++){
        if(dailyCols[di].key===freezeKey){ freezeIdx=di; break; }
      }
      // 保存的 key 非法（不在固定列中）→ 回退默认 trend
      if(freezeIdx<0){
        for(var dj=0;dj<dailyCols.length;dj++){
          if(dailyCols[dj].key==='trend'){ freezeIdx=dj; break; }
        }
      }
    }
    var FREEZE_SHADOW='box-shadow:2px 0 6px rgba(0,0,0,0.12)';
    // 生成单元格 sticky 样式：i<=freezeIdx 应用 sticky left；否则仅保留宽度约束保持列对齐
    function sHead(i){
      var w='min-width:'+fcw[i]+'px;max-width:'+fcw[i]+'px';
      if(i>freezeIdx) return 'position:sticky;top:0;z-index:3;background:var(--bg-header,#f5f7fa);'+w;
      var s='position:sticky;top:0;left:'+fcLeft[i]+'px;z-index:5;background:var(--bg-header,#f5f7fa);'+w;
      return i===freezeIdx?(s+';'+FREEZE_SHADOW):s;
    }
    function sSum(i){
      var w='min-width:'+fcw[i]+'px;max-width:'+fcw[i]+'px';
      if(i>freezeIdx) return 'position:sticky;top:'+headerH+'px;z-index:2;background:#e8edf3;font-weight:700;'+w;
      var s='position:sticky;top:'+headerH+'px;left:'+fcLeft[i]+'px;z-index:4;background:#e8edf3;font-weight:700;'+w;
      return i===freezeIdx?(s+';'+FREEZE_SHADOW):s;
    }
    function sBody(i){
      var w='min-width:'+fcw[i]+'px;max-width:'+fcw[i]+'px';
      if(i>freezeIdx) return w;
      var s='position:sticky;left:'+fcLeft[i]+'px;z-index:1;background:var(--bg-card,#fff);'+w;
      return i===freezeIdx?(s+';'+FREEZE_SHADOW):s;
    }

    // 日期表头：7/1, 7/2...
    var dateHeaders=dates.map(function(d){
      var p=d.split('-');
      return '<th class="text-right rp-daily-th" style="min-width:44px;position:sticky;top:0;z-index:3;background:var(--bg-header,#f5f7fa)">'+parseInt(p[1])+'/'+parseInt(p[2])+'</th>';
    }).join('');

    // === 表头行 ===
    // 表头允许自动换行（white-space:normal），高度自适应；汇总行 sticky top 在渲染后由 syncRpDailyHeaderHeight 同步
    var headRow='<tr>'
      +'<th style="'+sHead(0)+'"><input type="checkbox" id="rp-all" onchange="document.querySelectorAll(\'.rp-ck\').forEach(function(c){c.checked=this.checked})"></th>'
      +'<th class="rp-daily-th" style="'+sHead(1)+'">'+t('forecast.daily.col.sales_group','动销')+'</th>'
      +'<th class="rp-daily-th" style="'+sHead(2)+'">'+t('forecast.daily.col.lifecycle_status','生命周期')+'</th>'
      +'<th class="rp-daily-th" style="'+sHead(3)+'">Model</th>'
      +'<th class="rp-daily-th" style="'+sHead(4)+'">SKU</th>'
      +'<th class="text-right rp-daily-th" style="'+sHead(5)+'">'+t('forecast.daily.col.last_7_days','近7天')+'</th>'
      +'<th class="text-right rp-daily-th" style="'+sHead(6)+'">'+t('forecast.daily.col.last_14_days','近14天')+'</th>'
      +'<th class="text-right rp-daily-th" style="'+sHead(7)+'">'+t('forecast.daily.col.last_30_days','近30天')+'</th>'
      +'<th class="text-right rp-daily-th" style="'+sHead(8)+'">'+t('forecast.daily.col.avg_daily_sales','日均')+'</th>'
      +'<th class="text-center rp-daily-th" style="'+sHead(9)+'">'+t('forecast.daily.col.trend','趋势')+'</th>'
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
      return '<td class="text-right rp-daily-sum-date" style="position:sticky;top:'+headerH+'px;z-index:2;background:#e8edf3;font-weight:700;font-size:11px;min-width:44px">'+(dateSums[i]>0?formatQuantityDisplay(dateSums[i]):'<span style="color:#aaa">-</span>')+'</td>';
    }).join('');
    var summaryRow='<tr class="rp-daily-summary-row" style="background:#e8edf3">'
      +'<td style="'+sSum(0)+'" class="text-center" colspan="1"><span style="font-size:11px;font-weight:700">'+t('forecast.daily.summary.total','合计')+'</span></td>'
      +'<td style="'+sSum(1)+'"></td>'
      +'<td style="'+sSum(2)+'"></td>'
      +'<td style="'+sSum(3)+'"></td>'
      +'<td style="'+sSum(4)+'"><span style="font-size:10px;color:#888">'+data.length+' '+t('forecast.daily.summary.sku_unit','个SKU')+'</span></td>'
      +'<td class="text-right" style="'+sSum(5)+'">'+formatQuantityDisplay(sum7)+'</td>'
      +'<td class="text-right" style="'+sSum(6)+'">'+formatQuantityDisplay(sum14)+'</td>'
      +'<td class="text-right" style="'+sSum(7)+'">'+formatQuantityDisplay(sum30)+'</td>'
      +'<td class="text-right" style="'+sSum(8)+'">'+formatQuantityDisplay(sumAvg)+'</td>'
      +'<td class="text-center" style="'+sSum(9)+'"></td>'
      +summaryDateCells
      +'</tr>';

    // === 数据行 ===
    var rows='';
    data.forEach(function(r){
      var trendIcon=r.trend==='up'?'<span class="trend-up">↗</span>':r.trend==='down'?'<span class="trend-down">↘</span>':'<span class="trend-flat">→</span>';
      var dailyCells=(r.daily_sales||[]).map(function(q){
        return '<td class="daily-sales-cell">'+(q>0?formatQuantityDisplay(q):'<span class="daily-sales-zero">-</span>')+'</td>';
      }).join('');
      rows+='<tr>'
        +'<td style="'+sBody(0)+'"><input type="checkbox" class="rp-ck" value="'+r.id+'" data-sku="'+esc(r.sku_code)+'"></td>'
        +'<td style="'+sBody(1)+'"><span class="badge badge-sm">'+formatSalesGroupLabel(r.sales_group)+'</span></td>'
        +'<td style="'+sBody(2)+';white-space:normal"><span class="lifecycle-tag lc-'+(r.lifecycle_status||'stable')+'">'+fmtLifecycleDyn(r.lifecycle_status)+'</span></td>'
        +'<td class="rp-daily-cell-wrap" style="'+sBody(3)+';white-space:normal;overflow-wrap:anywhere">'+esc(r.model||'')+'</td>'
        +'<td class="rp-daily-cell-wrap" style="'+sBody(4)+';white-space:normal;overflow-wrap:anywhere;font-family:monospace;font-size:12px">'+esc(r.sku_code)+'</td>'
        +'<td class="text-right font-bold" style="'+sBody(5)+'">'+formatQuantityDisplay(r.last_7_days||0)+'</td>'
        +'<td class="text-right" style="'+sBody(6)+'">'+formatQuantityDisplay(r.last_14_days||0)+'</td>'
        +'<td class="text-right" style="'+sBody(7)+'">'+formatQuantityDisplay(r.last_30_days||0)+'</td>'
        +'<td class="text-right font-bold" style="'+sBody(8)+'">'+formatQuantityDisplay(r.avg_daily_sales||0)+'</td>'
        +'<td class="text-center" style="'+sBody(9)+'">'+trendIcon+'</td>'
        +dailyCells
        +'</tr>';
    });

    var emptyFoot=!data.length
      ? '<tr><td colspan="'+(10+dates.length)+'" style="text-align:center;padding:40px 20px;color:#999;background:#fafbfc">'+t('forecast.daily.empty','📈 当前筛选条件下暂无销量数据，请调整国家/仓库/品牌或点击"重新计算"')+'</td></tr>'
      : '';
    document.getElementById('rp-table').innerHTML='<div class="daily-table-wrap" style="overflow:auto;max-height:70vh;position:relative">'
      +'<table class="data-table" style="white-space:nowrap;border-collapse:separate;border-spacing:0">'
      +'<thead>'+headRow+summaryRow+'</thead>'
      +'<tbody>'+rows+emptyFoot+'</tbody>'
      +'</table></div>';
    // 表头允许自动换行 → 渲染后测量真实表头高度，同步汇总行 sticky top
    syncRpDailyHeaderHeight();
  }catch(e){showFlash(e.message,'danger')}
}

// 按天表头高度自适应：表头可换行后实际高度 != headerH(34)
// 渲染后读取真实 thead tr 高度，重写汇总行及日期汇总单元格的 sticky top
function syncRpDailyHeaderHeight(){
  var headTr=document.querySelector('#rp-table .daily-table-wrap thead tr:first-child');
  if(!headTr) return;
  var h=headTr.offsetHeight||34;
  var sumTr=document.querySelector('#rp-table .daily-table-wrap .rp-daily-summary-row');
  if(sumTr){
    var cells=sumTr.children;
    for(var i=0;i<cells.length;i++){
      cells[i].style.top=h+'px';
    }
  }
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
    showToast(t('gen.L5018.1','已更新'),'success');
  }catch(e){showToast(e.message,'danger');loadRp()}
}
async function genRp(){
  if(!confirm(t("app.828", "\u91cd\u65b0\u8ba1\u7b97\u5c06\u6309\u6700\u65b0\u6570\u636e\u8986\u76d6\u5f53\u524d\u624b\u52a8\u8c03\u6574\u7684\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf\uff0c\u662f\u5426\u7ee7\u7eed\uff1f")))return;
  const buttons=Array.from(document.querySelectorAll('.rp-gen-btn'));
  const oldLabels=buttons.map(b=>b.innerHTML);
  buttons.forEach(b=>{b.disabled=true;b.innerHTML=t("app.829", "\u8ba1\u7b97\u4e2d...");});
  showToast(t('gen.L5026.1','正在重新计算，请稍候...'),'info');
  try{
    const r=await api('/api/replenishment-suggestions/generate','POST',rpFilterBody());
    if(!r||!r.success){
      if(r&&r.unmatched){ showUnmatchedRules(r.unmatched); }
      else{ showToast(t('toast.genRp', '重新计算失败：{v1}', {v1: r&&r.message||t("app.831", "\u672a\u77e5\u9519\u8bef")}),'danger'); }
      return;
    }
    showToast(t('toast.suggestionsGenerated','已生成{count}条建议',{count:r.count}),'success');
    await loadRpSummary();
    await loadRp();
  }catch(e){
    showToast(t('toast.genRp.2', '重新计算失败，请稍后重试：{v1}', {v1: e.message||''}),'danger');
  }finally{
    buttons.forEach((b,i)=>{b.disabled=false;b.innerHTML=oldLabels[i]||t("shell.058", "\ud83d\udd04 \u91cd\u65b0\u8ba1\u7b97");});
  }
}
function showUnmatchedRules(unmatched){
  var byBrand={};
  (unmatched||[]).forEach(function(u){
    var b=u.brand||t("app.832", "(\u65e0\u54c1\u724c)");
    if(!byBrand[b]) byBrand[b]={brand:b,count:0};
    byBrand[b].count+=u.count||0;
  });
  var rows=Object.values(byBrand).sort(function(a,b){return b.count-a.count;});
  var html='<div style="padding:8px 0">'
    +t('gen.L5052.1','<div style="font-size:14px;margin-bottom:12px;color:#c0392b">以下品牌未配置目标周转规则，无法重新计算。请先在「⚙ 预测参数设置」中为这些品牌添加规则后再重算：</div>')
    +t('gen.L5053.1','<table class="table table-bordered" style="font-size:13px"><thead><tr><th>品牌</th><th style="width:140px">未命中 SKU 数</th></tr></thead><tbody>')
    +rows.map(function(r){return '<tr><td>'+esc(r.brand)+'</td><td>'+r.count+'</td></tr>';}).join('')
    +'</tbody></table>'
    +t('gen.L5056.1','<div style="font-size:12px;color:#888;margin-top:8px">提示：只需添加品牌级规则（国家/仓库留空）即可覆盖该品牌所有国家/仓库。</div>')
    +'</div>';
  openModal(t("app.836", "\u26a0\ufe0f \u65e0\u6cd5\u91cd\u65b0\u8ba1\u7b97\uff1a\u76ee\u6807\u5468\u8f6c\u89c4\u5219\u672a\u8986\u76d6"), html, t('gen.L5058.1','<button class="btn btn-primary" onclick="closeModal()">知道了</button>'));
}
function exportRpExcel(){
  try{
    const url='/api/replenishment-suggestions/export?'+rpQuery();
    window.open(url,'_blank');
  }catch(e){showToast(e.message,'danger')}
}
var _rpDimRowCount=0;
var _rpLoadedDimRules=[]; // openRpParams 暂存现有 dim_default_config，供 saveRpParams 做 upsert
function currentRpContext(){
  return {
    brand: document.getElementById('rp-b')?.value||'',
    country: document.getElementById('rp-c')?.value||'',
    warehouse: document.getElementById('rp-w')?.value||''
  };
}
function dimScoreLabel(score){
  var m={7:t("app.838", "\u54c1\u724c+\u56fd\u5bb6+\u4ed3\u5e93"),6:t("app.839", "\u54c1\u724c+\u56fd\u5bb6"),5:t("app.840", "\u54c1\u724c+\u4ed3\u5e93"),4:t("app.112", "\u54c1\u724c"),3:t("app.841", "\u56fd\u5bb6+\u4ed3\u5e93"),2:t("app.113", "\u56fd\u5bb6"),1:t("app.114", "\u4ed3\u5e93"),0:t("app.842", "\u5168\u901a\u914d")};
  return m[score]!=null?m[score]:(t('gen.L5077.1','得分')+score);
}
// 前端镜像 server.js getDimTurnover 评分（不改变后端命中逻辑，仅用于只读参考与预填）
function resolveDimHit(rules, brand, country, warehouse){
  if(!rules||!rules.length) return null;
  var b=(brand||'').trim(), c=(country||'').trim(), w=(warehouse||'').trim();
  // 全通配上下文（三处皆空）：只找「品牌=国家=仓库=空」的全通配规则，避免误显最高分具体规则
  if(b===''&&c===''&&w===''){
    for(var k=0;k<rules.length;k++){
      var rk=rules[k];
      if(((rk.brand||'').trim()==='')&&((rk.country||'').trim()==='')&&((rk.warehouse||'').trim()==='')){
        return Object.assign({},rk,{score:0});
      }
    }
    return null;
  }
  var best=null, bestScore=-1;
  for(var i=0;i<rules.length;i++){
    var r=rules[i];
    var rb=(r.brand||'').trim(), rc=(r.country||'').trim(), rw=(r.warehouse||'').trim();
    if((rb===''||rb===b)&&(rc===''||rc===c)&&(rw===''||rw===w)){
      var score=0;
      if(rb!=='') score+=4;
      if(rc!=='') score+=2;
      if(rw!=='') score+=1;
      if(score>bestScore){ bestScore=score; best=r; }
    }
  }
  return best?Object.assign({},best,{score:bestScore}):null;
}
function toggleRpAdv(){
  var el=document.getElementById('rp-adv-body');
  if(el) el.style.display=(el.style.display==='none'||!el.style.display)?'block':'none';
}
async function openRpParams(){
  // 从 system_config 读取当前值
  var cfg={sales_stats_days:'90'};
  var dimRules=[];
  try{
    var data=await api('/api/system-config');
    (data||[]).forEach(function(c){
      if(c.key==='sales_stats_days'&&c.value) cfg.sales_stats_days=c.value;
      if(c.key==='dim_default_config'&&c.value){ try{var a=JSON.parse(c.value); if(Array.isArray(a)) dimRules=a;}catch(e){} }
    });
  }catch(e){ /* 读取失败用默认值 */ }
  _rpLoadedDimRules=dimRules; // 暂存供保存时 upsert
  var sd=cfg.sales_stats_days;
  var ctx=currentRpContext();
  var ctxLabel=function(v){ return v?esc(v):t("app.843", "\u901a\u914d\uff08\u5168\u90e8\uff09"); };
  var hit=resolveDimHit(dimRules, ctx.brand, ctx.country, ctx.warehouse);
  var keyOf=function(r){return (r.brand||'')+'|'+(r.country||'')+'|'+(r.warehouse||'');};
  var ctxKey=keyOf({brand:ctx.brand,country:ctx.country,warehouse:ctx.warehouse});
  var prefillOnline = hit?hit.online_turnover:'';
  var prefillOffline = hit?hit.offline_turnover:'';
  var prefillNote = hit
    ? (keyOf(hit)===ctxKey ? t('gen.L5132.1','（当前维度已有规则，修改将覆盖它）') : t('gen.L5132.2','（参考：当前命中到更宽规则「')+dimScoreLabel(hit.score)+t("app.845", "\u300d\uff0c\u4fdd\u5b58\u5c06\u65b0\u589e\u5f53\u524d\u7ef4\u5ea6\u7684\u4e13\u5c5e\u89c4\u5219\uff09"))
    : t("app.846", "\uff08\u5f53\u524d\u7ef4\u5ea6\u6682\u65e0\u547d\u4e2d\u89c4\u5219\uff0c\u4fdd\u5b58\u5c06\u65b0\u589e\uff09");
  var isFullWildcard = !ctx.brand && !ctx.country && !ctx.warehouse;
  var hitBlock = hit
    ? '<table class="table table-bordered" style="font-size:13px;margin-bottom:0">'
      +'<tbody>'
      +t('gen.L5138.1','<tr><td style="width:120px;background:#fafafa;font-weight:600">命中的品牌</td><td>')+(esc(hit.brand)||t("app.848", "\u901a\u914d"))+'</td></tr>'
      +t('gen.L5139.1','<tr><td style="background:#fafafa;font-weight:600">国家</td><td>')+(esc(hit.country)||t("app.848", "\u901a\u914d"))+'</td></tr>'
      +t('gen.L5140.1','<tr><td style="background:#fafafa;font-weight:600">仓库</td><td>')+(esc(hit.warehouse)||t("app.848", "\u901a\u914d"))+'</td></tr>'
      +t('gen.L5141.1','<tr><td style="background:#fafafa;font-weight:600">线上周转</td><td>')+esc(hit.online_turnover)+'</td></tr>'
      +t('gen.L5142.1','<tr><td style="background:#fafafa;font-weight:600">线下周转</td><td>')+esc(hit.offline_turnover)+'</td></tr>'
      +t('gen.L5143.1','<tr><td style="background:#fafafa;font-weight:600">命中优先级</td><td>')+esc(dimScoreLabel(hit.score))+t('gen.L5143.2','（得分 ')+hit.score+'）</td></tr>'
      +'</tbody></table>'
    : t('gen.L5145.1','<div style="color:#c0392b;font-size:13px">当前维度暂无命中规则（保存后将新增此维度规则）</div>');
  var html='<div style="padding:8px 0">'
    +'<div class="form-group" style="margin-bottom:14px">'
      +t('gen.L5148.1','<label style="font-weight:600;display:block;margin-bottom:6px">销量统计周期</label>')
      +'<select id="rp-param-stats-days" class="form-control" style="width:160px">'
        +'<option value="60"'+(String(sd)==='60'?' selected':'')+t('gen.L5150.1','>近 60 天</option>')
        +'<option value="90"'+(String(sd)==='90'?' selected':'')+t('gen.L5151.1','>近 90 天（默认）</option>')
        +'<option value="120"'+(String(sd)==='120'?' selected':'')+t('gen.L5152.1','>近 120 天</option>')
      +'</select>'
      +t('gen.L5154.1','<div style="font-size:12px;color:#888;margin-top:4px">月均销量、当前可用周转、当前周转、当前测算周转、在途后周转、下单后周转、预计周转月数、占比、分摊库存、建议采购数量均已按当前「销量统计周期」计算；仅分类/风险/拦截层（动销状态、风险标签）仍按近 4 个月口径，属阶段性拆分（非 bug）。</div>')
    +'</div>'
    +'<div class="form-group" style="margin-bottom:14px">'
      +t('gen.L5157.1','<label style="font-weight:600;display:block;margin-bottom:8px">目标周转配置</label>')
      +'<div style="padding:10px;background:#f5f7fa;border:1px solid #e1e5ea;border-radius:6px;margin-bottom:10px;font-size:13px;color:#666">'
        +t('gen.L5159.1','<div style="font-weight:600;color:#444;margin-bottom:6px">① 当前页面筛选（只读参考）</div>')
        +t('gen.L5160.1','当前正在查看： ')
        +t('gen.L5161.1','<span style="display:inline-block;padding:2px 8px;margin:0 3px;background:#fff;border:1px solid #ccc;border-radius:10px">品牌: ')+ctxLabel(ctx.brand)+'</span>'
        +t('gen.L5162.1','<span style="display:inline-block;padding:2px 8px;margin:0 3px;background:#fff;border:1px solid #ccc;border-radius:10px">国家: ')+ctxLabel(ctx.country)+'</span>'
        +t('gen.L5163.1','<span style="display:inline-block;padding:2px 8px;margin:0 3px;background:#fff;border:1px solid #ccc;border-radius:10px">仓库: ')+ctxLabel(ctx.warehouse)+'</span>'
      +'</div>'
      +'<div style="padding:10px;background:#eef4fb;border:1px solid #cfe0f5;border-radius:6px;margin-bottom:6px">'
        +t('gen.L5166.1','<div style="font-weight:600;color:#2c5d8a;margin-bottom:6px">② 本次保存的规则对象（可编辑，默认预填当前筛选）</div>')
        +t('gen.L5167.1','<div style="font-size:12px;color:#888;margin-bottom:8px">空白=通配（不限该维度）。命中优先级：品牌+国家+仓库 &gt; 品牌+国家 &gt; 品牌+仓库 &gt; 品牌 &gt; 国家+仓库 &gt; 国家 &gt; 仓库 &gt; 全通配。<b>无兜底值</b>——未命中的 SKU 会阻止重新计算。保存以此处为准。</div>')
        +'<div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:8px">'
          +t('gen.L5169.1','<div><label style="font-size:12px;color:#666">品牌</label><input type="text" id="rp-rule-brand" class="form-control input-sm" value="')+esc(ctx.brand)+t('gen.L5169.2','" placeholder="(\u7a7a=\u901a\u914d)" style="width:120px"></div>')
          +t('gen.L5170.1','<div><label style="font-size:12px;color:#666">国家</label><input type="text" id="rp-rule-country" class="form-control input-sm" value="')+esc(ctx.country)+t('gen.L5170.2','" placeholder="(\u7a7a=\u901a\u914d)" style="width:120px"></div>')
          +t('gen.L5171.1','<div><label style="font-size:12px;color:#666">仓库</label><input type="text" id="rp-rule-warehouse" class="form-control input-sm" value="')+esc(ctx.warehouse)+t('gen.L5171.2','" placeholder="(\u7a7a=\u901a\u914d)" style="width:130px"></div>')
        +'</div>'
        +'<div style="display:flex;gap:12px;align-items:flex-end">'
          +t('gen.L5174.1','<div><label style="font-size:12px;color:#666">线上周转</label><input type="number" id="rp-param-online" class="form-control input-sm" value="')+esc(String(prefillOnline!=null?prefillOnline:''))+'" min="0" step="0.5" style="width:90px"></div>'
          +t('gen.L5175.1','<div><label style="font-size:12px;color:#666">线下周转</label><input type="number" id="rp-param-offline" class="form-control input-sm" value="')+esc(String(prefillOffline!=null?prefillOffline:''))+'" min="0" step="0.5" style="width:90px"></div>'
          +'<div style="font-size:12px;color:#888;padding-bottom:6px">'+prefillNote+'</div>'
        +'</div>'
      +'</div>'
    +'</div>'
    +'<div class="form-group" style="margin-bottom:14px">'
      +t('gen.L5181.1','<label style="font-weight:600;display:block;margin-bottom:6px">当前命中到的已有规则（只读，保存前可见将覆盖/新增哪条）</label>')
      +hitBlock
    +'</div>'
    + (isFullWildcard
      ? t('gen.L5185.1','<div style="margin-bottom:14px;padding:10px;background:#fdecea;border:1px solid #f5c6cb;border-radius:6px;color:#c0392b;font-size:13px">⚠️ 当前 品牌/国家/仓库 均为「全部」。保存后将生成<b>全通配规则</b>，作用于所有未被更具体规则覆盖的维度。请确认确实需要。</div>')
      : '')
    +'<div style="margin-top:6px">'
      +t('gen.L5188.1','<div style="cursor:pointer;font-weight:600;color:#555;font-size:13px;user-select:none" onclick="toggleRpAdv()">⚙ 高级设置（手动维护其它维度规则） ▾</div>')
      +'<div id="rp-adv-body" style="display:none;margin-top:8px">'
        +t('gen.L5190.1','<div style="font-size:12px;color:#888;margin-bottom:8px">以下为全部已配置规则，可手动增删改<b>当前筛选维度之外</b>的规则；保存时一并合并（当前维度规则以左侧输入框为准）。</div>')
        +t('gen.L5191.1','<table class="table table-bordered" style="font-size:13px;margin-bottom:8px"><thead><tr><th>品牌</th><th>国家</th><th>仓库</th><th>线上周转</th><th>线下周转</th><th style="width:50px"></th></tr></thead><tbody id="rp-dim-tbody"></tbody></table>')
        +t('gen.L5192.1','<button class="btn btn-default btn-sm" onclick="addRpDimRow()">+ 新增规则</button>')
      +'</div>'
    +'</div>'
    +'<div style="margin-top:12px;padding:10px;background:var(--bg-secondary,#f5f5f5);border-radius:6px;font-size:12px;color:#666">'
      +t("app.869", "\u4fdd\u5b58\u540e\u8bf7\u70b9\u51fb\u300c\u91cd\u65b0\u8ba1\u7b97\u300d\u4f7f\u65b0\u53c2\u6570\u751f\u6548\u3002")
    +'</div>'
  +'</div>';
  openModal(t("shell.060", "\u2699 \u9884\u6d4b\u53c2\u6570\u8bbe\u7f6e"), html,
    t('gen.L5200.1','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveRpParams()">💾 保存当前维度规则</button>'));
  // 渲染高级区：现有全部规则
  _rpDimRowCount=0;
  dimRules.forEach(function(r){
    addRpDimRow(r.brand||'',r.country||'',r.warehouse||'',r.online_turnover,r.offline_turnover);
  });
}
function addRpDimRow(brand,country,warehouse,online,offline){
  _rpDimRowCount++;
  var tr=document.createElement('tr');
  tr.innerHTML=t('html.addRpDimRow', `<td><input class="form-control input-sm rp-dim-brand" value="{v1}" placeholder="(空=通配)" style="min-width:90px"></td><td><input class="form-control input-sm rp-dim-country" value="{v2}" placeholder="(空=通配)" style="min-width:90px"></td><td><input class="form-control input-sm rp-dim-warehouse" value="{v3}" placeholder="(空=通配)" style="min-width:100px"></td><td><input type="number" class="form-control input-sm rp-dim-online" value="{v4}" min="0" step="0.5" style="width:80px"></td><td><input type="number" class="form-control input-sm rp-dim-offline" value="{v5}" min="0" step="0.5" style="width:80px"></td><td style="text-align:center;vertical-align:middle"><button class="btn btn-xs btn-danger" onclick="this.closest('tr').remove()">×</button></td>`, {v1: esc(brand||''), v2: esc(country||''), v3: esc(warehouse||''), v4: esc(String(online!=null?online:4)), v5: esc(String(offline!=null?offline:4))});
  document.getElementById('rp-dim-tbody').appendChild(tr);
}
async function saveRpParams(){
  var sd=document.getElementById('rp-param-stats-days').value;
  if(!sd||[60,90,120].indexOf(parseInt(sd))<0){showToast(t('gen.L5215.1','请选择有效的销量统计周期'),'warning');return;}
  // 保存来源：② 可编辑规则对象（默认预填当前筛选，但用户可改），不直接绑定页面筛选下拉
  var ctx={
    brand: (document.getElementById('rp-rule-brand').value||'').trim(),
    country: (document.getElementById('rp-rule-country').value||'').trim(),
    warehouse: (document.getElementById('rp-rule-warehouse').value||'').trim()
  };
  var online=parseFloat(document.getElementById('rp-param-online').value)||0;
  var offline=parseFloat(document.getElementById('rp-param-offline').value)||0;
  if(!(online>0)||!(offline>0)){showToast(t('gen.L5224.1','周转值必须为正数'),'warning');return;}
  // 全通配（② 三处皆空）→ 强二次确认，文案明确
  if(!ctx.brand && !ctx.country && !ctx.warehouse){
    if(!confirm(t("app.873", "\u8fd9\u4f1a\u4fdd\u5b58\u4e3a\u5168\u901a\u914d\u89c4\u5219\uff0c\u4f5c\u7528\u4e8e\u6240\u6709\u672a\u88ab\u66f4\u5177\u4f53\u89c4\u5219\u8986\u76d6\u7684\u7ef4\u5ea6\u3002\u786e\u8ba4\u4fdd\u5b58\u5417\uff1f"))) return;
  }
  var newRule={brand:ctx.brand, country:ctx.country, warehouse:ctx.warehouse, online_turnover:online, offline_turnover:offline};
  var keyOf=function(r){return (r.brand||'')+'|'+(r.country||'')+'|'+(r.warehouse||'');};
  // 当前上下文 upsert：删同键旧规则 → 追加新规则
  var rules=(_rpLoadedDimRules||[]).slice();
  rules=rules.filter(function(r){return keyOf(r)!==keyOf(newRule);});
  rules.push(newRule);
  // 合并高级区手动行（当前维度外），按 key 去重，当前上下文优先
  var advRows=document.getElementById('rp-dim-tbody').querySelectorAll('tr');
  advRows.forEach(function(tr){
    var inputs=tr.querySelectorAll('input');
    if(inputs.length<5) return;
    var ar={brand:(inputs[0].value||'').trim(),country:(inputs[1].value||'').trim(),warehouse:(inputs[2].value||'').trim(),online_turnover:parseFloat(inputs[3].value)||0,offline_turnover:parseFloat(inputs[4].value)||0};
    if(!(ar.online_turnover>0)||!(ar.offline_turnover>0)) return; // 跳过非法高级行
    if(!rules.some(function(r){return keyOf(r)===keyOf(ar);})) rules.push(ar);
  });
  if(!rules.length){showToast(t('gen.L5244.1','至少需要一条规则'),'warning');return;}
  var configs=[
    {key:'sales_stats_days',value:sd,description:t("system.009", "\u9500\u91cf\u7edf\u8ba1\u5468\u671f(\u5929)\uff1a60/90/120\uff0c\u5f71\u54cd\u6708\u5747\u9500\u91cf\u4e0e\u5404\u9879\u5468\u8f6c\uff08\u5f53\u524d\u53ef\u7528/\u5f53\u524d/\u5728\u9014\u540e/\u4e0b\u5355\u540e\uff09\u663e\u793a\u53e3\u5f84")},
    {key:'dim_default_config',value:JSON.stringify(rules),description:t('gen.L5247.1','目标周转多维默认值(JSON数组)：brand/country/warehouse/online_turnover/offline_turnover，空=通配；命中优先级 品牌+国家+仓库>品牌+国家>品牌+仓库>品牌>国家+仓库>国家>仓库>兜底')}
  ];
  try{
    await api('/api/system-config','POST',{configs:configs});
    // 刷新销量统计周期缓存，使下次渲染表头/period 显示用新值
    rpSalesStatsDays=parseInt(sd)||90; _rpSdPromise=null;
    showToast(t('gen.L5253.1','已保存预测参数，请点击「重新计算」使新参数生效'),'success');
    closeModal();
  }catch(e){showToast(e.message||t("app.429", "\u4fdd\u5b58\u5931\u8d25"),'danger');}
}
function toggleGenPO(rid){
  const ck=document.querySelector('.rp-ck[value="'+rid+'"]');
  if(ck) ck.checked=!ck.checked;
}
async function genPOModal(){
  try{
    const suggestions=await api('/api/replenishment-suggestions?'+rpQuery());
    // 生成 PO 只使用后端最终建议采购数量 suggested_qty
    const filtered=suggestions.filter(r=>(r.suggested_qty||0)>0);
    if(!filtered.length){showToast(''+t("toast.genpo_empty","当前没有需要生成 PO 的 SKU。")+'','warning');return;}
    // 预览窗口：显示建议采购数量 > 0 的 SKU
    const prevHtml='<div class="table-container" style="max-height:50vh;overflow:auto"><table class="data-table"><thead><tr><th>SKU</th><th>Model</th><th class="text-right">'+t("col.suggest_qty","建议采购数量")+'</th><th>'+t("col.sales_judgement","动销判断")+'</th><th>'+t("col.suggest_action","建议动作")+'</th><th>'+t("app.112","品牌")+'</th><th>'+t("app.113","国家")+'</th><th>'+t("app.114","仓库")+'</th></tr></thead><tbody>'
      +filtered.map((r,i)=>'<tr><td class="cell-id">'+esc(r.sku_code)+'</td><td class="text-truncate" style="max-width:120px">'+esc(r.model||'')+'</td><td class="text-right font-bold">'+(r.suggested_qty||0)+'</td><td style="min-width:100px">'+buildSalesJudgement(r)+'</td><td style="min-width:80px">'+esc(simplifyAction(r.action))+'</td><td>'+(r.brand||'-')+'</td><td>'+(r.country||'-')+'</td><td>'+(r.target_warehouse||'-')+'</td></tr>').join('')
      +'</tbody></table></div><div style="margin-top:10px;font-weight:600;color:var(--primary)">'+t("common.total_prefix","共")+' '+filtered.length+''+t("genpo.suggest_total"," 个 SKU，建议采购总数量：")+''+filtered.reduce((s,r)=>s+(r.suggested_qty||0),0)+''+t("genpo.unit_pcs"," 件")+'</div>';
    openModal(t("app.877", "\u751f\u6210PO\u9884\u89c8"),t('modal.body.genPOModal', '<div style="padding:4px 0"><p style="margin-bottom:12px;color:#666">以下为建议采购数量 > 0 的 SKU，确认后将继续选择供应商并生成 PO。</p>{v1}</div>', {v1: prevHtml}),'<button class="btn btn-secondary" onclick="closeModal()">'+t("common.cancel","取消")+'</button><button class="btn btn-primary" onclick="continueGenPO()">'+t("action.confirm_continue","确认并继续")+'</button>');
    window._genPOFiltered=filtered;
  }catch(e){showToast(e.message,'danger')}
}
async function continueGenPO(){
  try{
    const filtered=window._genPOFiltered||[];
    if(!filtered.length){closeModal();return;}
    const suppliers=await api('/api/suppliers');
    const items=filtered.map(r=>({id:r.id,sku_code:r.sku_code,brand:r.brand||'',po_qty:r.suggested_qty||0,country:r.country||'',target_warehouse:r.target_warehouse||''}));
    const brands=[...new Set(items.map(i=>i.brand).filter(Boolean))];
    if(!items.length || items.some(i=>!i.brand)){
      showToast(t('gen.L5283.1','部分 SKU 未配置品牌，请先在 SKU 管理中维护品牌信息。'),'danger');
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
      showToast(t('gen.L5294.1','部分品牌未匹配到唯一供应商，请先在供应商管理中维护品牌与供应商关系。'),'danger');
      return;
    }
    const supplierIds=[...new Set(brands.map(b=>brandSupplier[b].id))];
    if(supplierIds.length!==1){
      showToast(t('gen.L5299.1','所选 SKU 属于不同供应商，请分开生成 PO。'),'warning');
      return;
    }
    const supplier=brandSupplier[brands[0]];
    const country=document.getElementById('rp-c')?.value || items[0]?.country || '';
    const warehouse=document.getElementById('rp-w')?.value || items[0]?.target_warehouse || '';
    const brandText=brands.join(', ');
    const totalQty=items.reduce((s,i)=>s+(parseInt(i.po_qty)||0),0);
    openModal(t('gen.L5307.1','生成PO'),t('modal.body.continueGenPO', '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>供应商</label><input type="text" id="po-supplier-name" value="{v1}" readonly></div><div class="form-group"><label>品牌</label><input type="text" id="po-brand" value="{v2}" readonly></div><div class="form-group"><label>国家</label><input type="text" id="po-country" value="{v3}" readonly></div><div class="form-group"><label>仓库</label><input type="text" id="po-wh" value="{v4}" readonly></div><div class="form-group"><label>币种</label><select id="po-cur">{v5}</select></div><div class="form-group"><label>PO日期</label><input type="date" id="po-date" value="{v6}"></div></div><h4 style="margin:16px 0 8px">SKU明细（可编辑数量）</h4><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th class="text-right">数量</th></tr></thead><tbody>{v7}</tbody></table></div><div style="display:flex;gap:24px;justify-content:flex-end;margin-top:10px;font-weight:600"><span>合计 SKU：<b id="po-sku-total">{v8}</b> 个</span><span>合计数量：<b id="po-qty-total">{v9}</b> 件</span></div></div>', {v1: esc(supplier.name), v2: esc(brandText), v3: esc(country), v4: esc(warehouse), v5: ['RMB','USD'].map(c=>'<option value="'+c+'"'+((supplier.default_currency||'USD')===c?' selected':'')+'>'+c+'</option>').join(''), v6: todayStr(), v7: items.map((it,i)=>'<tr><td class="cell-id">'+esc(it.sku_code)+'</td><td class="text-right"><input type="number" min="0" id="po-qty-'+i+'" value="'+(parseInt(it.po_qty)||0)+'" oninput="updateGenPOSummary()" style="width:100px;padding:4px;text-align:right"></td></tr>').join(''), v8: items.length, v9: totalQty}),
      t('gen.L5308.1','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveGenPO()">创建PO</button>'));
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
  const d={...meta,currency:document.getElementById('po-cur').value,po_date:document.getElementById('po-date').value,from_suggestion:1,items:(window._poItems||[]).map((it,i)=>({sku_code:it.sku_code,po_qty:parseInt(document.getElementById('po-qty-'+i)?.value)||0}))};
  try{
    const po=await api('/api/purchase-orders','POST',d);
    showToast(t('gen.L5323.1','PO创建成功'),'success');
    openPOExportConfirm(po.id);
  }catch(e){showToast(e.message,'danger')}
}
function openPOExportConfirm(poId){
  openModal(t('gen.L5328.1','PO 创建成功'),t('gen.L5328.2','<div style="padding:4px 0;font-size:14px">PO 已创建成功，是否立即导出 Excel 格式 PO？</div>'),t('modal.footer.openPOExportConfirm', `<button class="btn btn-secondary" onclick="closeModal();showPage('po')">取消</button><button class="btn btn-primary" onclick="exportPO('{v1}');closeModal();showPage('po')">导出 Excel</button>`, {v1: poId}));
}
// ==================== PO管理 ====================
async function renderPO(){
  document.getElementById('content-inner').innerHTML=t('html.renderPO', `<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="po-fs"><option value="">全部</option><option value="draft">草稿</option><option value="pending_approval">待审批</option><option value="approved">已审批</option><option value="sent_factory">已发工厂</option><option value="partial_pi">部分转PI</option><option value="transferred_pi">已转PI</option></select></div><div class="filter-group"><label>关键词</label><input type="text" id="po-fk" onkeypress="if(event.key==='Enter')loadPO()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadPO()">搜索</button>{v1}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🛒 PO列表</div></div><div id="po-table"></div></div>`, {v1: hasPermission('po_create')?t('gen.L5332.1','<button class="btn btn-primary btn-sm" onclick="createPO()">➕ 新建PO</button>'):''});
  loadPO();
}
async function loadPO(){
  try{
    const s=document.getElementById('po-fs')?.value||'',k=document.getElementById('po-fk')?.value||'';
    const data=await api('/api/purchase-orders?status='+s+'&keyword='+encodeURIComponent(k));
    document.getElementById('po-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">🛒</div>'+t("empty.no_po","暂无PO")+'</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("col.po_no","PO号")+'</th><th>'+t("col.supplier","供应商")+'</th><th>'+t("app.112","品牌")+'</th><th>'+t("app.113","国家")+'</th><th>'+t("app.114","仓库")+'</th><th>'+t("col.po_date","PO日期")+'</th><th>'+t("html.pay.th.currency","币种")+'</th><th>'+t("col.detail","明细")+'</th><th>'+t("col.po_status","PO状态")+'</th><th>'+t("col.approval","审批")+'</th><th>'+t("common.actions","操作")+'</th></tr></thead><tbody>'+data.map(p=>'<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewPO\',\''+p.id+'\')"><td class="cell-id"><span class="link-text" onclick="viewPO(\''+p.id+'\')">'+esc(p.po_no)+'</span></td><td>'+esc(p.supplier_name)+'</td><td>'+esc(p.brand)+'</td><td>'+esc(p.country)+'</td><td>'+esc(p.target_warehouse)+'</td><td class="cell-date">'+fmtDate(p.po_date)+'</td><td>'+esc(p.currency)+'</td><td class="text-center">'+(p.item_count||0)+'</td><td><span class="status-badge '+((p.po_status==='approved'||p.po_status==='transferred_pi')?'status-completed':p.po_status==='pending_approval'?'status-pending':'status-draft')+'">'+statusLabel(p.po_status)+'</span></td><td><span class="status-badge '+(p.approval_status==='approved'?'status-approved':p.approval_status==='rejected'?'status-rejected':'status-pending')+'">'+statusLabel(p.approval_status)+'</span></td><td class="cell-actions"><button class="action-btn" onclick="viewPO(\''+p.id+'\')">👁️</button>'+(p.po_status==='draft'&&hasPermission('po_create')?'<button class="action-btn" onclick="submitPO(\''+p.id+'\')" title="'+t("po.submit_approval","提交审批")+'">📤</button>':'')+(p.po_status==='approved'&&hasPermission('po_create')?'<button class="action-btn" onclick="sendFactory(\''+p.id+'\')" title="'+t("po.send_factory","发工厂")+'">📨</button>':'')+((hasPermission('po_export')||hasPermission('po_create'))?'<button class="action-btn" onclick="exportPO(\''+p.id+'\')" title="'+t("action.export_excel","导出Excel")+'">📊</button>':'')+(hasPermission('po_create')?'<button class="action-btn" onclick="voidPO(\''+p.id+'\')" title="'+t("action.void","作废")+'">'+t("action.void","作废")+'</button>':'')+(hasPermission('po_create')&&p.po_status==='draft'?'<button class="action-btn" style="color:#d4380d" onclick="deletePO(\''+p.id+'\')" title="'+t("action.delete","删除")+'">'+t("action.delete","删除")+'</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function viewPO(id){
  try{const po=await api('/api/purchase-orders/'+id);
    const totalQty=(po.items||[]).reduce((s,i)=>s+(i.po_qty||0),0);
    openModal(t('modal.title.viewPO', 'PO详情 - {v1}', {v1: po.po_no}),t('modal.body.viewPO', '<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>基本信息</h3><div class="detail-grid">{v1}</div></div><div class="detail-section"><h3>PO明细</h3><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th class="text-right">数量</th></tr></thead><tbody>{v2}</tbody></table></div><div style="display:flex;gap:24px;justify-content:flex-end;margin-top:10px;font-weight:600"><span>合计 SKU：{v3} 个</span><span>合计数量：{v4} 件</span></div></div></div>', {v1: ['po_no','supplier_name','brand','country','target_warehouse','po_date','currency','po_status','approval_status','created_by_name'].map(f=>'<div class="detail-item"><span class="detail-label">'+f+'</span><span class="detail-value">'+esc(po[f])+'</span></div>').join(''), v2: (po.items||[]).map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.po_qty+'</td></tr>').join(''), v3: (po.items||[]).length, v4: totalQty}));
  }catch(e){showToast(e.message,'danger')}
}
async function createPO(){
  const suppliers=await api('/api/suppliers');
  openModal(t("system.013", "\u65b0\u5efaPO"),t('modal.body.createPO', '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>供应商 <span class="required">*</span></label><select id="npo-sup">{v1}</select></div><div class="form-group"><label>品牌</label><input type="text" id="npo-brand"></div><div class="form-group"><label>国家</label><input type="text" id="npo-country"></div><div class="form-group"><label>仓库</label><input type="text" id="npo-wh"></div><div class="form-group"><label>PO日期</label><input type="date" id="npo-date" value="{v2}"></div><div class="form-group"><label>币种</label><select id="npo-cur"><option value="RMB">RMB</option><option value="USD">USD</option></select></div></div><h4 style="margin:16px 0 8px">明细 <button class="btn btn-secondary btn-sm" onclick="addPORow()">➕ 添加</button></h4><div id="po-items"></div></div>', {v1: suppliers.map(s=>'<option value="'+s.id+'" data-name="'+esc(s.name)+'">'+esc(s.name)+'</option>').join(''), v2: todayStr()}),'<button class="btn btn-secondary" onclick="closeModal()">'+t("common.cancel","取消")+'</button><button class="btn btn-primary" onclick="saveNewPO()">'+t("action.create","创建")+'</button>');
  window._poR=0;addPORow();
}
function addPORow(){const c=document.getElementById('po-items');const i=window._poR++;c.innerHTML+=t('html.addPORow', `<div class="flex gap-8 mb-8" id="po-r-{v1}"><input type="text" placeholder="SKU" id="po-rs-{v2}" style="flex:1"><input type="number" placeholder="数量" id="po-rq-{v3}" style="width:100px"><button class="btn btn-danger btn-sm" onclick="document.getElementById('po-r-{v4}').remove()">🗑️</button></div>`, {v1: i, v2: i, v3: i, v4: i})}
async function saveNewPO(){
  const sel=document.getElementById('npo-sup');const items=[];
  for(let i=0;i<window._poR;i++){const sku=document.getElementById('po-rs-'+i)?.value;if(sku)items.push({sku_code:sku,po_qty:parseInt(document.getElementById('po-rq-'+i).value)||0})}
  const d={supplier_id:sel.value,supplier_name:sel.options[sel.selectedIndex].dataset.name,brand:document.getElementById('npo-brand').value,country:document.getElementById('npo-country').value,target_warehouse:document.getElementById('npo-wh').value,po_date:document.getElementById('npo-date').value,currency:document.getElementById('npo-cur').value,items};
  try{await api('/api/purchase-orders','POST',d);showToast(t('gen.L5358.1','PO创建成功'),'success');closeModal();loadPO()}catch(e){showToast(e.message,'danger')}
}
async function submitPO(id){
  try{
    const users=await api('/api/cc-candidates');
    const opts=users.map(u=>'<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:4px 0;min-width:160px"><input type="checkbox" class="cc-chk" value="'+esc(u.id)+'">'+esc(u.name)+'（'+esc(formatRoleLabel(u.role_id, u.role_name))+'）</label>').join('');
    const body='<div style="font-size:13px;color:#888;margin-bottom:8px">'+t("po.submit_hint","提交后将进入审批流程。可选：勾选需要知会的抄送人（仅记录，不阻塞审批、不发送通知）。")+'</div>'
      +'<div style="max-height:280px;overflow:auto;display:flex;flex-wrap:wrap;gap:4px 18px;padding:6px 2px;border:1px solid #eee;border-radius:6px">'+(opts||'<div class="muted-hint">'+t("empty.no_cc","暂无可用抄送人")+'</div>')+'</div>';
    const footer='<button class="btn btn-secondary" onclick="closeModal()">'+t("common.cancel","取消")+'</button><button class="btn btn-primary" onclick="confirmSubmitApproval(\''+id+'\')">'+t("po.confirm_submit","确认提交")+'</button>';
    openModal(t("app.888", "\u63d0\u4ea4\u5ba1\u6279 \u00b7 \u9009\u62e9\u6284\u9001\u4eba\uff08\u53ef\u9009\uff09"), body, footer, 'modal-lg');
  }catch(e){showToast(e.message,'danger')}
}
async function confirmSubmitApproval(id){
  const chk=[...document.querySelectorAll('#modal-content .cc-chk')].filter(c=>c.checked).map(c=>c.value);
  try{
    await api('/api/purchase-orders/'+id+'/submit-approval','POST',{submitter_name:currentUser.name, cc_user_ids:chk});
    showToast(t('toast.approvalSubmitted','已提交审批{extra}',{extra:chk.length?t('gen.L5374.1','，已记录 ')+chk.length+t('gen.L5374.2',' 位抄送人'):''}),'success');
    closeModal();loadPO();
  }catch(e){showToast(e.message,'danger')}
}
async function sendFactory(id){if(!confirm(t("app.889", "\u786e\u8ba4\u5df2\u53d1\u5de5\u5382\uff1f")))return;try{await api('/api/purchase-orders/'+id+'/send-to-factory','POST');showToast(t('gen.L5378.1','已标记发工厂'),'success');loadPO()}catch(e){showToast(e.message,'danger')}}
async function exportPO(id){
  try{
    const po=await api('/api/purchase-orders/'+id);
    const totalQty=(po.items||[]).reduce((s,i)=>s+(i.po_qty||0),0);
    const ws=XLSX.utils.json_to_sheet([
      {字段:t("app.891", "PO\u7f16\u53f7"),内容:po.po_no},
      {字段:t("app.117", "PO\u65e5\u671f"),内容:po.po_date},
      {字段:t("app.116", "\u4f9b\u5e94\u5546"),内容:po.supplier_name},
      {字段:t("app.112", "\u54c1\u724c"),内容:po.brand},
      {字段:t("app.113", "\u56fd\u5bb6"),内容:po.country},
      {字段:t("app.114", "\u4ed3\u5e93"),内容:po.target_warehouse},
      {字段:t("app.118", "\u5e01\u79cd"),内容:po.currency}
    ]);
    const detailRows=(po.items||[]).map(i=>({SKU:i.sku_code,数量:i.po_qty}));
    detailRows.push({SKU:t("app.892", "\u5408\u8ba1 SKU \u6570\u91cf"),数量:(po.items||[]).length});
    detailRows.push({SKU:t("app.893", "\u5408\u8ba1\u91c7\u8d2d\u6570\u91cf"),数量:totalQty});
    const ws2=XLSX.utils.json_to_sheet(detailRows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,t("app.894", "PO\u4fe1\u606f"));
    XLSX.utils.book_append_sheet(wb,ws2,t("app.895", "SKU\u660e\u7ec6"));
    XLSX.writeFile(wb,'PO_'+po.po_no+'.xlsx');
  }catch(e){showToast(e.message,'danger')}
}

// ==================== 单据作废 / 删除（前端入口，调用后端 void / DELETE 端点） ====================
function openVoidModal(title, type, id){
  const typeName = type==='po'?t('gen.L5405.1','采购订单(PO)'):type==='pi'?t('gen.L5405.2','形式发票(PI)'):t('gen.L5405.3','商业发票(CI)');
  openModal(title,
    t('modal.body.openVoidModal', '<div class="form-card" style="box-shadow:none;padding:0"><p style="margin:0 0 12px;color:#666;font-size:13px">确认作废该{v1}？作废后状态将置为「已取消」，且订单预测页对应的在途字段会自动回落（无需重新计算）。</p><div class="form-group"><label>作废原因 <span class="required">*</span></label><textarea id="void-reason" rows="3" placeholder="请填写作废原因（必填）" style="width:100%;box-sizing:border-box"></textarea></div></div>', {v1: typeName}),
    t('modal.footer.openVoidModal', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-danger" onclick="confirmVoid('{v1}','{v2}')">确认作废</button>`, {v1: type, v2: id}));
}
async function confirmVoid(type, id){
  const el=document.getElementById('void-reason');
  const reason=el&&el.value?el.value.trim():'';
  if(!reason){showToast(t('gen.L5413.1','请填写作废原因'),'warning');return;}
  const url=type==='po'?'/api/purchase-orders/'+id+'/void':type==='pi'?'/api/proforma-invoices/'+id+'/void':'/api/commercial-invoices/'+id+'/void';
  try{
    await api(url,'POST',{void_reason:reason});
    showToast(t('gen.L5417.1','已作废'),'success');closeModal();
    if(type==='po')loadPO();else if(type==='pi')loadPI();else loadCI();
  }catch(e){showToast(e.message,'danger');}
}
function voidPO(id){openVoidModal(t("po.033", "\u4f5c\u5e9fPO"),'po',id);}
function voidPI(id){openVoidModal(t("pi.009", "\u4f5c\u5e9fPI"),'pi',id);}
function voidCI(id){openVoidModal(t("ci.001", "\u4f5c\u5e9fCI"),'ci',id);}
async function deletePO(id){
  if(!confirm(t('gen.L5425.1','确认删除该PO？此操作不可恢复，删除后对应的在途字段会自动回落。')))return;
  try{
    await api('/api/purchase-orders/'+id,'DELETE');
    showToast(t('gen.L5428.1','PO已删除'),'success');loadPO();
  }catch(e){showToast(e.message,'danger');}
}

// ==================== PI管理 ====================
async function renderPI(){
  document.getElementById('content-inner').innerHTML=t('html.renderPI', `<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="pi-fs"><option value="">全部</option><option value="pending">待上传 PI</option><option value="uploaded">已上传 PI</option><option value="confirmed">已确认</option><option value="pending_deposit">待定金审批</option><option value="deposit_paid">定金已付款</option><option value="producing">生产中</option><option value="pending_ci_pl">待 CI/PL</option><option value="cancelled">已取消</option></select></div><div class="filter-group"><label>关键词</label><input type="text" id="pi-fk" onkeypress="if(event.key==='Enter')loadPI()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadPI()">搜索</button>{v1}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📄 PI列表</div></div><div id="pi-table"></div></div>`, {v1: hasPermission('pi_create')?t('gen.L5434.1','<button class="btn btn-secondary btn-sm" onclick="downloadDocTemplate(\'pi\')">📥 PI模板</button><button class="btn btn-secondary btn-sm" onclick="openDocImport(\'pi\')">📤 批量导入PI</button><button class="btn btn-primary btn-sm" onclick="createPI()">➕ 新建PI</button>'):''});
  loadPI();
}
async function loadPI(){
  try{
    const s=document.getElementById('pi-fs')?.value||'',k=document.getElementById('pi-fk')?.value||'';
    const data=await api('/api/proforma-invoices?status='+s+'&keyword='+encodeURIComponent(k));
    document.getElementById('pi-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">📄</div>'+t("empty.no_pi","暂无PI")+'</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("col.pi_no","PI号")+'</th><th>'+t("col.related_po","关联PO")+'</th><th>'+t("col.supplier","供应商")+'</th><th>'+t("app.112","品牌")+'</th><th>'+t("app.113","国家")+'</th><th>'+t("app.114","仓库")+'</th><th>'+t("col.date","日期")+'</th><th>'+t("html.pay.th.currency","币种")+'</th><th>'+t("col.total_amount","总金额")+'</th><th>'+t("col.is_deposit","是否定金")+'</th><th>'+t("col.deposit_ratio","定金比例")+'</th><th>'+t("col.deposit_amount","定金金额")+'</th><th>'+t("col.deposit_status","定金状态")+'</th><th>'+t("pi.field.status","PI状态")+'</th><th>'+t("common.actions","操作")+'</th></tr></thead><tbody>'+data.map(p=>'<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewPI\',\''+p.id+'\')"><td class="cell-id"><span class="link-text" onclick="viewPI(\''+p.id+'\')">'+esc(p.pi_no)+'</span></td><td class="cell-id">'+esc(p.related_po_no)+'</td><td>'+esc(p.supplier_name)+'</td><td>'+esc(p.brand)+'</td><td>'+esc(p.country)+'</td><td>'+esc(p.target_warehouse)+'</td><td class="cell-date">'+fmtDate(p.pi_date)+'</td><td>'+esc(p.currency)+'</td><td class="text-right">'+fmtMoney(p.total_amount)+'</td><td>'+(p.need_deposit?'<span class="status-badge status-pending">'+t("enum.yes","是")+'</span>':'<span class="status-badge status-completed">'+t("enum.no","否")+'</span>')+'</td><td class="text-right">'+(p.deposit_ratio||0)+'%</td><td class="text-right">'+fmtMoney(p.payable_deposit)+'</td><td><span class="status-badge '+(p.deposit_payment_status==='paid'?'status-paid':'status-unpaid')+'">'+esc(formatPIDepositStatus(p.deposit_payment_status))+'</span></td><td><span class="status-badge status-pending">'+esc(formatPIStatus(p.pi_status))+'</span></td><td class="cell-actions"><button class="action-btn" onclick="viewPI(\''+p.id+'\')">👁️</button>'+(hasPermission('pi_edit')?('<button class="action-btn" '+(p.locked?('disabled title="'+t("pi.locked_note","已锁定，不可编辑：")+''+esc(p.lock_reason||''+t("pi.locked","已锁定")+'')+'" style="opacity:.3;cursor:not-allowed">✏️</button>'):('onclick="editPI(\''+p.id+'\')" title="'+t("action.edit","编辑")+'">✏️</button>'))):'')+'<button class="action-btn" onclick="uploadDocAttachment(\'pi\',\''+p.id+'\',\'attachment\')" title="'+t("pi.upload_attachment","上传PI附件")+'">📎</button>'+(p.need_deposit&&p.payable_deposit>0&&p.deposit_payment_status==='unpaid'&&hasPermission('payment_create')?'<button class="action-btn" onclick="createDepPay(\''+p.id+'\')" title="'+t("pi.deposit_pay","定金付款")+'">💰</button>':'')+(hasPermission('pi_edit')?'<button class="action-btn" '+(p.pi_status==='completed'?'disabled title="'+t("pi.cannot_void_completed","已完成状态不可作废")+'" style="opacity:.3;cursor:not-allowed"':'onclick="voidPI(\''+p.id+'\')" title="'+t("action.void","作废")+'"')+'>'+t("action.void","作废")+'</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function viewPI(id, backPay, backMode){
  try{const pi=await api('/api/proforma-invoices/'+id);
    let poRef=[];if(pi.related_po_id){try{poRef=(await api('/api/purchase-orders/'+pi.related_po_id)).items||[];}catch(e){}}
    const diffHtml=renderCmpReadonly(computePODiff(poRef,pi.items||[]));
    // 若来自付款申请详情，提供【← 返回付款申请详情】入口，保留原上下文（含 mode）
    const backFooter=backPay?'<button class="btn btn-secondary" onclick="viewPayment(\''+backPay+'\',\''+(backMode||'view')+t('gen.L5449.1','\')">← 返回付款申请详情</button><button class="btn btn-secondary" onclick="closeModal()">关闭</button>'):'';
    openModal(t('modal.title.viewPI', 'PI详情 - {v1}', {v1: pi.pi_no}),t('modal.body.viewPI', '<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>基本信息</h3><div class="detail-grid detail-grid-pi">{v1}{v2}</div></div><div class="detail-section"><h3>PI明细</h3><div class="pi-table-scroll"><table class="data-table pi-items-table"><thead><tr><th>SKU</th><th>PO数量</th><th>PI确认</th><th>单价</th><th>折扣</th><th>金额</th><th>已发货</th><th>未发货</th></tr></thead><tbody>{v3}</tbody></table></div></div><div class="detail-section"><h3>PO vs PI 差异对比</h3>{v4}</div></div>', {v1: [{f:'pi_no',l:t('col.pi_no','PI号')},{f:'related_po_no',l:t('col.related_po','关联PO')},{f:'supplier_name',l:t('pi.field.supplier','供应商')},{f:'brand',l:t('app.112','品牌')},{f:'country',l:t('app.113','国家')},{f:'target_warehouse',l:t('app.114','仓库')},{f:'pi_date',l:t('pi.field.date','PI日期')},{f:'currency',l:t('html.pay.th.currency','币种')},{f:'total_amount',l:t('pi.field.total_amount','总金额')},{f:'payment_terms',l:t('nav.payment_terms','付款条件')},{f:'need_deposit',l:t('col.is_deposit','是否定金')},{f:'deposit_ratio',l:t('col.deposit_ratio','定金比例')},{f:'payable_deposit',l:t('col.deposit_amount','定金金额')},{f:'expected_delivery',l:t('pi.field.expected_delivery','预计交期')},{f:'pi_status',l:t('pi.field.status','PI状态')}].map(o=>'<div class="detail-item"><span class="detail-label">'+o.l+'</span><span class="detail-value">'+(o.f==='need_deposit'?(pi[o.f]?t('gen.L5450.1','是'):t('gen.L5450.2','否')):(o.f==='pi_status'?esc(formatPIStatus(pi.pi_status)):(o.f==='deposit_ratio'?(pi[o.f]||0)+'%':(o.f==='total_amount'||o.f==='payable_deposit'?(pi.currency?pi.currency+' ':'')+fmtMoney(pi[o.f]):esc(pi[o.f])))))+'</span></div>').join(''), v2: attachmentHtml('pi',pi.id,'attachment',pi.attachment,t("pi.field.attachment", "PI\u9644\u4ef6")), v3: (pi.items||[]).map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.po_qty+'</td><td class="text-right">'+i.pi_confirmed_qty+'</td><td class="text-right">'+fmtMoney(i.unit_price)+'</td><td class="text-right">'+((i.discount||0)*100)+'%</td><td class="text-right">'+fmtMoney(i.pi_amount)+'</td><td class="text-right">'+(i.shipped_qty||0)+'</td><td class="text-right">'+(i.unshipped_qty||0)+'</td></tr>').join(''), v4: diffHtml.replace('class="table-container"','class="pi-table-scroll"')}),backFooter,'modal-pi');
    // PI-TABLE-ALIGN-01 R4: 给 i18n 渲染的 Items 表补 pi-items-readonly class + 像素 colgroup（8列总宽1165px）
    const _piItemsTbl=document.querySelector('.modal-pi .pi-table-scroll .data-table:not(.pi-cmp-table)');
    if(_piItemsTbl){if(!_piItemsTbl.classList.contains('pi-items-readonly'))_piItemsTbl.classList.add('pi-items-readonly');if(!_piItemsTbl.querySelector('colgroup')){_piItemsTbl.insertAdjacentHTML('afterbegin','<colgroup><col style="width:230px"><col style="width:125px"><col style="width:170px"><col style="width:130px"><col style="width:110px"><col style="width:140px"><col style="width:120px"><col style="width:140px"></colgroup>');}}
  }catch(e){showToast(e.message,'danger')}
}
async function editPI(id){
  try{
    const pi=await api('/api/proforma-invoices/'+id);
    // 锁定：打开即提示，不渲染可编辑表单（第2层：仅前端表现，PUT 守卫已在第1层落地）
    if(pi.locked){
      openModal(t('modal.title.editPI', '编辑PI - {v1}', {v1: esc(pi.pi_no)}),t('modal.body.editPI', '<div style="padding:24px 16px;text-align:center"><div style="font-size:42px;margin-bottom:10px">🔒</div><div style="font-size:15px;font-weight:600;margin-bottom:6px">该 PI 已锁定，不可编辑</div><div style="color:var(--text-muted)">原因：{v1}</div></div>', {v1: esc(pi.lock_reason||t('gen.L5458.1','已锁定'))}),t('gen.L5458.2','<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'));
      return;
    }
    const suppliers=await api('/api/suppliers');
    // 预取关联 PO 明细，用于 PO vs PI 对比（与 viewPI 同源）
    let poRef=[];
    if(pi.related_po_id){try{poRef=(await api('/api/purchase-orders/'+pi.related_po_id)).items||[];}catch(e){}}
    const supOpts=suppliers.map(s=>'<option value="'+s.id+'" data-name="'+esc(s.name)+'" data-last="'+esc(s.last_used_payment_term_id||'')+'"'+(s.id===pi.supplier_id?' selected':'')+'>'+esc(s.name)+'</option>').join('');
    const curOpts=['USD','RMB','IDR','MYR','THB'].map(c=>'<option'+(c===pi.currency?' selected':'')+'>'+c+'</option>').join('');
    const body='<div class="form-card" style="box-shadow:none;padding:0">'
      +t('gen.L5468.1','<div style="margin-bottom:12px;padding:8px 12px;background:#f0f5ff;border:1px solid #adc6ff;border-radius:6px;font-size:12px;color:#333">编辑模式：可修改表头与明细并实时预览差异；保存将调用后端 PUT（付款条件变更自动回写供应商上次使用项）。「PI号 / 关联PO / 供应商 / PI日期 / 币种」为锁定项不可改。</div>')
      +'<div class="form-grid">'
      +t('gen.L5470.1','<div class="form-group"><label>PI号（锁定）</label><input type="text" value="')+esc(pi.pi_no)+'" disabled></div>'
      +t('gen.L5471.1','<div class="form-group"><label>关联PO（锁定）</label><input type="text" value="')+esc(pi.related_po_no||t("app.140", "\u65e0\u5173\u8054"))+'" disabled></div>'
      +t('gen.L5472.1','<div class="form-group"><label>供应商（锁定）</label><select id="npi-sup" disabled onchange="onPISupplierChange()">')+supOpts+'</select></div>'
      +t('gen.L5473.1','<div class="form-group"><label>PI日期（锁定）</label><input type="date" id="npi-date" value="')+esc(pi.pi_date||'')+'" disabled></div>'
      +t('gen.L5474.1','<div class="form-group"><label>币种（锁定）</label><select id="npi-cur" disabled>')+curOpts+'</select></div>'
      +t('gen.L5475.1','<div class="form-group"><label>是否需要定金</label><select id="npi-need-dep" onchange="togglePIDeposit()"><option value="1"')+(pi.need_deposit?' selected':'')+t('gen.L5475.2','>是</option><option value="0"')+(!pi.need_deposit?' selected':'')+t('gen.L5475.3','>否</option></select></div>')
      +t('gen.L5476.1','<div class="form-group"><label>定金比例(%)</label><input type="number" id="npi-dep" value="')+(pi.deposit_ratio||0)+'"></div>'
      +t('gen.L5477.1','<div class="form-group"><label>预计交期</label><input type="date" id="npi-del" value="')+esc(pi.expected_delivery||'')+'"></div>'
      +t('gen.L5478.1','<div class="form-group"><label>付款条件</label><select id="npi-terms"><option value="">（未选择）</option></select></div>')
      +'</div>'
      +t('gen.L5480.1','<h4 style="margin:16px 0 8px">PO vs PI 合并对比 <button class="btn btn-secondary btn-sm" onclick="addPIRow()">➕ 添加行</button> <button class="btn btn-secondary btn-sm" onclick="openSupplierPIImport()">📥 导入供应商PI</button></h4>')
      +t('gen.L5481.1','<div class="table-container" style="max-height:52vh;overflow:auto;box-shadow:none;margin-bottom:8px"><table class="data-table pi-cmp-table" id="pi-items-table"><thead><tr><th>SKU</th><th>PO数量</th><th>PI确认数量</th><th>PO单价</th><th>PI确认单价</th><th>PI折扣</th><th>PI金额</th><th>数量差异</th><th>单价差异</th><th>操作</th></tr></thead><tbody id="pi-items"></tbody><tfoot id="pi-cmp-foot"></tfoot></table></div>')
      +'</div>';
    openModal(t('modal.title.editPI.2', '编辑PI - {v1}', {v1: esc(pi.pi_no)}),body,t('modal.footer.editPI', `<button class="btn btn-secondary" onclick="closeModal()">关闭</button><button class="btn btn-primary" onclick="saveEditPI('{v1}')">💾 保存</button>`, {v1: id}),'modal-pi');
    // 预填明细（复用 computePODiff + renderCmpTable）
    window._piRows=computePODiff(poRef,pi.items||[]);renderCmpTable();
    // 付款条件下拉联动 + 预填该 PI 实际使用的付款条件（覆盖默认项）
    await onPISupplierChange();
    const termSel=document.getElementById('npi-terms');
    if(termSel&&pi.payment_term_id&&[...termSel.options].some(o=>o.value===pi.payment_term_id))termSel.value=pi.payment_term_id;
    // 仅应用定金比例输入的禁用态，不改动已预填的比例值
    const needSel=document.getElementById('npi-need-dep'),depIn=document.getElementById('npi-dep');
    if(needSel&&depIn)depIn.disabled=needSel.value==='0';
  }catch(e){showToast(e.message,'danger')}
}
async function saveEditPI(id){
  try{
    const termSel=document.getElementById('npi-terms');
    // 明细：仅组装有效 SKU 行（与 saveNewPI 同源，PUT 端会按 pi_confirmed_qty 重算金额/PO 同步）
    const items=[];
    (window._piRows||[]).forEach(r=>{if(r.sku&&r.sku.trim())items.push({sku_code:r.sku.trim(),po_qty:parseInt(r.poQty)||0,pi_confirmed_qty:parseInt(r.piQty)||0,unit_price:parseFloat(r.piPrice)||0,discount:parseFloat(r.piDisc)||0})});
    const termId=termSel?termSel.value:'';
    const paymentTermsText=(termId&&termSel.options[termSel.selectedIndex])?termSel.options[termSel.selectedIndex].textContent:'';
    const d={
      payment_terms:paymentTermsText,
      payment_term_id:termId,
      expected_delivery:document.getElementById('npi-del').value,
      need_deposit:document.getElementById('npi-need-dep').value==='1'?1:0,
      deposit_ratio:parseFloat(document.getElementById('npi-dep').value)||0,
      items
    };
    // 调用第1层已落地的 PUT：内置锁定守卫 + 金额/PO transferred_pi_qty 同步 + 付款条件变更自动回写供应商 last_used
    const res=await api('/api/proforma-invoices/'+id,'PUT',d);
    showToast(t('toast.piSaved','PI 保存成功（总额 {amt}）',{amt:fmtMoney(res.total_amount)}),'success');
    closeModal();
    loadPI(); // 刷新 PI 列表
  }catch(e){showToast(e.message,'danger')}
}
async function createPI(){
  const suppliers=await api('/api/suppliers');const pos=await api('/api/purchase-orders?status=approved');
  openModal(t('gen.L5520.1','新建PI'),t('modal.body.createPI', `<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>关联PO</label><select id="npi-po" onchange="loadPOForPI()"><option value="">无关联</option>{v1}</select></div><div class="form-group"><label>供应商 <span class="required">*</span></label><select id="npi-sup" onchange="onPISupplierChange()">{v2}</select></div><div class="form-group"><label>PI日期</label><input type="date" id="npi-date" value="{v3}"></div><div class="form-group"><label>币种</label><select id="npi-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div><div class="form-group"><label>是否需要定金</label><select id="npi-need-dep" onchange="togglePIDeposit()"><option value="1">${t('term.yes','是')}</option><option value="0">${t('term.no','否')}</option></select></div><div class="form-group"><label>定金比例(%)</label><input type="number" id="npi-dep" value="30"></div><div class="form-group"><label>预计交期</label><input type="date" id="npi-del"></div><div class="form-group"><label>付款条件</label><select id="npi-terms"><option value="">（未选择）</option></select></div></div><h4 style="margin:16px 0 8px">PO vs PI 合并对比 <button class="btn btn-secondary btn-sm" onclick="addPIRow()">➕ 添加行</button> <button class="btn btn-secondary btn-sm" onclick="openSupplierPIImport()">📥 导入供应商PI</button> <button class="btn btn-secondary btn-sm" onclick="downloadDocTemplate('supplierPI')">📄 模板</button></h4><div class="pi-table-scroll" style="max-height:52vh;overflow:auto;box-shadow:none;margin-bottom:8px"><table class="data-table pi-cmp-table" id="pi-items-table"><thead><tr><th>SKU</th><th>PO数量</th><th>PI确认数量</th><th>PO单价</th><th>PI确认单价</th><th>PI折扣</th><th>PI金额</th><th>数量差异</th><th>单价差异</th><th>操作</th></tr></thead><tbody id="pi-items"></tbody><tfoot id="pi-cmp-foot"></tfoot></table></div></div>`, {v1: pos.map(p=>'<option value="'+p.id+'" data-no="'+p.po_no+'">'+esc(p.po_no)+' - '+esc(p.supplier_name)+'</option>').join(''), v2: suppliers.map(s=>'<option value="'+s.id+'" data-name="'+esc(s.name)+'" data-last="'+esc(s.last_used_payment_term_id||'')+'">'+esc(s.name)+'</option>').join(''), v3: todayStr()}),t('gen.L5520.2','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveNewPI()">创建</button>'),'modal-pi');
  window._piRows=[];renderCmpTable();
  onPISupplierChange();
}
async function onPISupplierChange(){
  const supSel=document.getElementById('npi-sup'),termSel=document.getElementById('npi-terms');
  if(!supSel||!termSel)return;
  const supId=supSel.value;
  const lastUsed=supSel.options[supSel.selectedIndex]?.dataset.last||'';
  if(!supId){termSel.innerHTML=t('gen.L5529.1','<option value="">（未选择）</option>');return;}
  try{
    const terms=await api('/api/suppliers/'+encodeURIComponent(supId)+'/payment-terms');
    window._piTermsMap={};
    termSel.innerHTML=t('html.onPISupplierChange', '<option value="">（未选择）</option>{v1}', {v1: terms.map(term=>{window._piTermsMap[term.id]=term;const extra=(term.term_type==='credit'||term.term_type==='other')&&term.credit_days?('（'+term.credit_days+t("app.924", "\u5929\uff09")):'';return '<option value="'+term.id+'">'+esc(term.term_name+(extra?' '+extra:''))+'</option>';}).join('')});
    // 默认优先级：1) 上次该供应商实际使用的付款条件 2) 供应商默认项 3) 空白
    let defId='';
    if(lastUsed&&terms.some(t=>t.id===lastUsed))defId=lastUsed;
    else{const dft=terms.find(t=>t.is_default);if(dft)defId=dft.id;}
    termSel.value=defId;
  }catch(e){showToast(e.message,'danger');}
}
function togglePIDeposit(){const need=document.getElementById('npi-need-dep')?.value!=='0';const dep=document.getElementById('npi-dep');if(dep){dep.disabled=!need;if(!need)dep.value=0;else if(!dep.value||dep.value==='0')dep.value=30;}}
function addPIRow(){window._piRows.push({sku:'',poQty:0,poPrice:0,piQty:0,piPrice:0,piDisc:0,fromPO:false});renderCmpTable();}
function renderCmpTable(){const tb=document.getElementById('pi-items');if(!tb)return;
// PI-TABLE-ALIGN-01 R4: 注入 colgroup 像素列宽（10列总宽1380px）+ pi-cmp-editable class
const _tbl=tb.parentElement;if(_tbl){if(!_tbl.classList.contains('pi-cmp-editable'))_tbl.classList.add('pi-cmp-editable');if(!_tbl.querySelector('colgroup')){_tbl.insertAdjacentHTML('afterbegin','<colgroup><col style="width:220px"><col style="width:120px"><col style="width:145px"><col style="width:135px"><col style="width:180px"><col style="width:120px"><col style="width:125px"><col style="width:120px"><col style="width:135px"><col style="width:80px"></colgroup>');}}
if(!window._piRows||!window._piRows.length){tb.innerHTML=t('gen.L5543.1','<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:18px">暂无明细，点击「➕ 添加行」新增 SKU，或「📥 导入供应商PI」</td></tr>');return;}tb.innerHTML=(window._piRows||[]).map((r,idx)=>cmpRowHTML(idx,r)).join('');window._piRows.forEach((r,idx)=>updCmpRow(idx));}
function cmpRowHTML(idx,r){return '<tr data-idx="'+idx+'"><td><input type="text" value="'+esc(r.sku)+'" id="pi-rsk-'+idx+'" oninput="updCmpRow('+idx+')"></td><td style="color:var(--text-muted)">'+r.poQty+'</td><td><input type="number" value="'+r.piQty+'" id="pi-rq-'+idx+'" oninput="updCmpRow('+idx+')"></td><td style="color:var(--text-muted)">'+fmtMoney(r.poPrice)+'</td><td><input type="number" step="0.01" value="'+r.piPrice+'" id="pi-rp-'+idx+'" oninput="updCmpRow('+idx+')"></td><td><input type="number" step="0.01" value="'+r.piDisc+'" id="pi-rd-'+idx+'" oninput="updCmpRow('+idx+')"></td><td id="pi-ramt-'+idx+'">0.00</td><td id="pi-rqd-'+idx+'">0</td><td id="pi-rpd-'+idx+'">0</td><td><button class="btn btn-danger btn-sm" onclick="delCmpRow('+idx+')">🗑️</button></td></tr>';}
function updCmpRow(idx){const r=window._piRows[idx];if(!r)return;r.sku=document.getElementById('pi-rsk-'+idx)?.value||'';r.piQty=parseFloat(document.getElementById('pi-rq-'+idx)?.value)||0;r.piPrice=parseFloat(document.getElementById('pi-rp-'+idx)?.value)||0;r.piDisc=parseFloat(document.getElementById('pi-rd-'+idx)?.value)||0;const d=cmpDerived(r);const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};set('pi-ramt-'+idx,d.piAmt.toFixed(2));set('pi-rqd-'+idx,String(d.qtyDiff));set('pi-rpd-'+idx,d.priceDiff.toFixed(2));recomputeCmpFooter();}
function delCmpRow(idx){window._piRows.splice(idx,1);renderCmpTable();}
function cmpDerived(r){const poQty=+r.poQty||0,poPrice=+r.poPrice||0,piQty=+r.piQty||0,piPrice=+r.piPrice||0,piDisc=+r.piDisc||0;const poAmt=poQty*poPrice;const piAmt=piQty*piPrice*(1-piDisc);const qtyDiff=piQty-poQty;const priceDiff=piPrice-poPrice;const amtDiff=piAmt-poAmt;const hasPO=poQty>0||poPrice>0,hasPI=piQty>0||piPrice>0;let status=t("app.926", "\u4e00\u81f4");if(!hasPO&&hasPI)status=t("app.927", "PI\u65b0\u589e");else if(hasPO&&!hasPI)status=t("app.928", "PO\u6709PI\u7f3a");else if(Math.abs(qtyDiff)>1e-9&&Math.abs(priceDiff)>1e-9)status=t("app.929", "\u91cf\u4ef7\u5747\u5dee");else if(Math.abs(qtyDiff)>1e-9)status=t("app.930", "\u4ec5\u6570\u91cf\u5dee");else if(Math.abs(priceDiff)>1e-9)status=t("app.931", "\u4ec5\u5355\u4ef7\u5dee");return {poAmt,piAmt,qtyDiff,priceDiff,amtDiff,status};}
function recomputeCmpFooter(){const f=document.getElementById('pi-cmp-foot');if(!f)return;let poQty=0,piQty=0,piAmt=0,qtyD=0,amtD=0;(window._piRows||[]).forEach(r=>{const d=cmpDerived(r);poQty+=r.poQty;piQty+=r.piQty;piAmt+=d.piAmt;qtyD+=d.qtyDiff;amtD+=d.amtDiff;});f.innerHTML=t('html.recomputeCmpFooter', '<tr style="font-weight:700;background:#e8edf3"><td>汇总</td><td class="text-right">{v1}</td><td class="text-right">{v2}</td><td></td><td></td><td></td><td class="text-right">{v3}</td><td class="text-right">{v4}</td><td colspan="2" class="text-right">金额差异：{v5}</td></tr>', {v1: poQty, v2: piQty, v3: fmtMoney(piAmt), v4: qtyD, v5: fmtMoney(amtD)});}
async function loadPOForPI(){const poId=document.getElementById('npi-po').value;window._poRef=null;const curSel=document.getElementById('npi-cur');if(!poId){if(curSel)curSel.disabled=false;renderCmpTable();return;}try{const po=await api('/api/purchase-orders/'+poId);const supSel=document.getElementById('npi-sup');let sid=po.supplier_id;if(sid&&![...supSel.options].some(o=>o.value===sid)){const byName=[...supSel.options].find(o=>o.dataset.name===po.supplier_name);if(byName)sid=byName.value;}supSel.value=sid||'';onPISupplierChange();if(curSel){curSel.value=po.currency;curSel.disabled=true;}window._poRef=po.items||[];const extra=(window._piRows||[]).filter(r=>!r.fromPO);window._piRows=(po.items||[]).map(it=>({sku:it.sku_code||'',poQty:it.po_qty||0,poPrice:it.unit_price||0,piQty:0,piPrice:0,piDisc:0,fromPO:true})).concat(extra);renderCmpTable();}catch(e){showToast(e.message,'danger')}}
function computePODiff(poRef,piItems){const map={};const rows=[];const norm=s=>String(s||'').trim().toLowerCase();(poRef||[]).forEach(p=>{const sku=p.sku_code||'';const r={sku,poQty:p.po_qty||0,poPrice:p.unit_price||0,piQty:0,piPrice:0,piDisc:0,fromPO:true};rows.push(r);map[norm(sku)]=r;});(piItems||[]).forEach(p=>{const sku=p.sku_code||'';const ex=map[norm(sku)];if(ex){ex.piQty=p.pi_confirmed_qty||0;ex.piPrice=p.unit_price||0;ex.piDisc=p.discount||0;}else{const r={sku,poQty:0,poPrice:0,piQty:p.pi_confirmed_qty||0,piPrice:p.unit_price||0,piDisc:p.discount||0,fromPO:false};rows.push(r);map[norm(sku)]=r;}});return rows;}
function renderCmpReadonly(rows){const body=rows.map(r=>{const d=cmpDerived(r);return '<tr><td class="cell-id">'+esc(r.sku)+'</td><td>'+r.poQty+'</td><td>'+r.piQty+'</td><td>'+fmtMoney(r.poPrice)+'</td><td>'+fmtMoney(r.piPrice)+'</td><td>'+((r.piDisc||0)*100).toFixed(0)+'%</td><td>'+fmtMoney(d.piAmt)+'</td><td>'+d.qtyDiff+'</td><td>'+d.priceDiff.toFixed(2)+'</td><td>'+d.status+'</td></tr>';}).join('');let poQty=0,piQty=0,piAmt=0,qtyD=0,amtD=0;rows.forEach(r=>{const d=cmpDerived(r);poQty+=r.poQty;piQty+=r.piQty;piAmt+=d.piAmt;qtyD+=d.qtyDiff;amtD+=d.amtDiff;});const foot=t('gen.L5551.1','<tr style="font-weight:700;background:#e8edf3"><td>汇总</td><td>')+poQty+'</td><td>'+piQty+'</td><td></td><td></td><td></td><td>'+fmtMoney(piAmt)+'</td><td>'+qtyD+t('gen.L5551.2','</td><td colspan="2">金额差异：')+fmtMoney(amtD)+'</td></tr>';return t('gen.L5551.3','<div class="table-container" style="max-height:50vh;overflow:auto;box-shadow:none"><table class="data-table pi-cmp-table pi-cmp-readonly"><colgroup><col style="width:220px"><col style="width:120px"><col style="width:145px"><col style="width:135px"><col style="width:180px"><col style="width:120px"><col style="width:125px"><col style="width:120px"><col style="width:135px"><col style="width:210px"></colgroup><thead><tr><th>SKU</th><th>PO数量</th><th>PI确认数量</th><th>PO单价</th><th>PI确认单价</th><th>PI折扣</th><th>PI金额</th><th>数量差异</th><th>单价差异</th><th>状态</th></tr></thead><tbody>')+body+'</tbody><tfoot>'+foot+'</tfoot></table></div>';}
const SUPPLIER_PI_IMPORT_COLUMNS=[
  {key:'sku_code',label:'SKU',required:true},
  {key:'pi_confirmed_qty',label:t("app.143", "PI\u786e\u8ba4\u6570\u91cf"),required:true,format:v=>parseFloat(v)||0},
  {key:'unit_price',label:t("app.145", "PI\u786e\u8ba4\u5355\u4ef7"),required:false,format:v=>parseFloat(v)||0},
  {key:'discount',label:t("app.146", "PI\u6298\u6263"),required:false,format:v=>parseFloat(v)||0}
];
function openSupplierPIImport(){
  if(document.getElementById('supplier-pi-import-overlay'))return;
  const overlay=document.createElement('div');
  overlay.id='supplier-pi-import-overlay';
  overlay.className='modal-overlay show';
  overlay.style.zIndex='1500';
  overlay.innerHTML=
    '<div class="modal modal-lg">'+
      t('gen.L5566.1','<div class="modal-header"><span class="modal-title">导入供应商PI</span><button class="modal-close" onclick="closeSupplierPIImport()">&times;</button></div>')+
      '<div class="modal-body">'+
        '<div id="sup-pi-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s" '+
          'onclick="document.getElementById(\'sup-pi-file-input\').click()" '+
          'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
          'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
          'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handleSupplierPIFile(event.dataTransfer.files[0])">'+
          '<div style="font-size:48px;color:#1890ff;margin-bottom:8px">📥</div>'+
          t('gen.L5574.1','<div style="font-size:14px;color:#333;margin-bottom:4px">点击上传或拖拽文件到此处</div>')+
          t('gen.L5575.1','<div style="font-size:12px;color:#999">支持 .xlsx / .xls / .csv 格式</div>')+
        '</div>'+
        '<input type="file" id="sup-pi-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleSupplierPIFile(this.files[0])">'+
        '<div style="margin-top:12px;padding:12px 14px;background:#f0f5ff;border:1px solid #adc6ff;border-radius:6px;font-size:12px;color:#333">'+
          t('gen.L5579.1','<div style="font-weight:600;margin-bottom:6px">导入说明</div>')+
          '<div style="line-height:1.8">'+
            t('gen.L5581.1','• 列：<b>SKU、PI确认数量、PI确认单价、PI折扣</b>（折扣填 0~1，如 0.1 表示 10%）<br>')+
            t('gen.L5582.1','• 系统按 <b>SKU</b> 与下方「PO vs PI 合并对比」表匹配：已存在的 SKU 直接回填 PI 列，未匹配的 SKU 作为新增行加入<br>')+
            t('gen.L5583.1','• 导入仅在当前新建 PI 弹窗内填充，不会单独入库；点「创建」后才落库<br>')+
            t('gen.L5584.1','• 与 PO 的差异将自动重算')+
          '</div>'+
        '</div>'+
        '<div id="sup-pi-preview" style="margin-top:16px"></div>'+
        '<div id="sup-pi-result" style="margin-top:16px"></div>'+
      '</div>'+
      '<div class="modal-footer">'+
        t('gen.L5591.1','<button class="btn btn-secondary" onclick="downloadDocTemplate(\'supplierPI\')">下载模板</button>')+
        t('gen.L5592.1','<button class="btn btn-secondary" onclick="closeSupplierPIImport()">关闭</button>')+
        t('gen.L5593.1','<button class="btn btn-primary" id="sup-pi-import-btn" onclick="submitSupplierPIImport()" disabled>开始导入</button>')+
      '</div>'+
    '</div>';
  document.body.appendChild(overlay);
  window._supplierPiImportData=[];
}
function closeSupplierPIImport(){const o=document.getElementById('supplier-pi-import-overlay');if(o)o.remove();window._supplierPiImportData=[];}
function handleSupplierPIFile(file){
  if(!file)return;
  const ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){showToast(t('gen.L5603.1','仅支持 .xlsx / .xls / .csv 格式'),'danger');return;}
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      let wb;
      if(ext==='csv'){wb=XLSX.read(e.target.result,{type:'string',codepage:65001});}
      else{wb=XLSX.read(new Uint8Array(e.target.result),{type:'array',cellDates:true});}
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      if(rows.length<2){showToast(t('gen.L5612.1','文件为空或缺少数据行'),'danger');return;}
      const headers=rows[0].map(h=>String(h||'').trim());
      const records=[];
      for(let i=1;i<rows.length;i++){
        const row=rows[i];
        if(!row||row.every(c=>!c||String(c).trim()===''))continue;
        const rec={_rowNum:i+1,_errors:[]};
        SUPPLIER_PI_IMPORT_COLUMNS.forEach(col=>{
          const idx=headers.findIndex(h=>h===col.label||h===col.key);
          if(idx>=0&&row[idx]!==undefined&&row[idx]!==''){let val=row[idx];if(typeof val==='string')val=val.trim();if(col.format)val=col.format(val);rec[col.key]=val;}
        });
        if(!rec.sku_code||!String(rec.sku_code).trim())rec._errors.push(t('gen.L5623.1','SKU不能为空'));
        if(rec.pi_confirmed_qty===undefined||rec.pi_confirmed_qty===null||isNaN(rec.pi_confirmed_qty)||rec.pi_confirmed_qty<=0)rec._errors.push(t("app.934", "PI\u786e\u8ba4\u6570\u91cf\u5fc5\u987b\u4e3a\u6b63\u6570"));
        if(rec.discount!==undefined&&!isNaN(rec.discount)&&(rec.discount<0||rec.discount>1))rec._errors.push(t("app.935", "PI\u6298\u6263\u9700\u5728 0~1 \u4e4b\u95f4"));
        records.push(rec);
      }
      window._supplierPiImportData=records;
      renderSupplierPIPreview(records);
      const btn=document.getElementById('sup-pi-import-btn');
      if(btn)btn.disabled=records.filter(r=>r._errors.length===0).length===0;
    }catch(err){showToast(t('toast.handleSupplierPIFile', '文件解析失败：{v1}', {v1: err.message}),'danger');}
  };
  if(ext==='csv')reader.readAsText(file,'UTF-8');else reader.readAsArrayBuffer(file);
}
function renderSupplierPIPreview(records){
  const valid=records.filter(r=>r._errors.length===0).length;
  const invalid=records.length-valid;
  let html=t('gen.L5639.1','<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px"><b>共 ')+records.length+t('gen.L5639.2',' 条数据</b>，<span style="color:#52c41a">有效 ')+valid+t('gen.L5639.3',' 条</span>')+(invalid>0?t('gen.L5639.4','，<span style="color:#ff4d4f">无效 ')+invalid+t('gen.L5639.5',' 条</span>'):'')+'</div>';
  html+=t('gen.L5640.1','<div class="table-container" style="max-height:300px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>行</th><th>SKU</th><th>PI确认数量</th><th>PI确认单价</th><th>PI折扣</th><th>校验</th></tr></thead><tbody>');
  records.slice(0,20).forEach(r=>{
    const ok=r._errors.length===0;
    html+='<tr style="'+(ok?'':'background:#fff1f0')+'"><td>'+r._rowNum+'</td><td class="cell-id">'+esc(r.sku_code||'-')+'</td><td class="text-right">'+(r.pi_confirmed_qty!==undefined?r.pi_confirmed_qty:'-')+'</td><td class="text-right">'+(r.unit_price!==undefined?r.unit_price:'-')+'</td><td class="text-right">'+(r.discount!==undefined?r.discount:'-')+'</td><td>'+(ok?'<span class="status-badge status-completed">✓</span>':'<span class="status-badge status-danger" title="'+esc(r._errors.join('; '))+'">✗ '+r._errors.length+'</span>')+'</td></tr>';
  });
  if(records.length>20)html+=t('gen.L5645.1','<tr><td colspan="6" style="text-align:center;color:#999;padding:8px">... 还有 ')+(records.length-20)+t('gen.L5645.2',' 条</td></tr>');
  html+='</tbody></table></div>';
  if(invalid>0){
    html+=t('gen.L5648.1','<div style="margin-top:10px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666"><b>无效行明细：</b><br>')+
      records.filter(r=>r._errors.length>0).slice(0,10).map(r=>t('gen.L5649.1','第 ')+r._rowNum+t('gen.L5649.2',' 行：')+r._errors.join('、')).join('<br>')+(invalid>10?'<br>...':'')+'</div>';
  }
  const el=document.getElementById('sup-pi-preview');
  if(el)el.innerHTML=html;
}
async function submitSupplierPIImport(){
  const records=window._supplierPiImportData||[];
  const valid=records.filter(r=>r._errors.length===0);
  if(!valid.length){showToast(t('gen.L5657.1','没有可导入的有效数据'),'danger');return;}
  const btn=document.getElementById('sup-pi-import-btn');
  if(btn){btn.disabled=true;btn.textContent=t("app.613", "\u5bfc\u5165\u4e2d...");}
  try{
    let matched=0,added=0,skipped=records.length-valid.length;
    valid.forEach(r=>{
      const sku=String(r.sku_code).trim();
      const ex=(window._piRows||[]).find(x=>x.sku&&x.sku.toLowerCase()===sku.toLowerCase());
      if(ex){ex.piQty=r.pi_confirmed_qty||0;ex.piPrice=r.unit_price||0;ex.piDisc=r.discount||0;matched++;}
      else{window._piRows.push({sku,poQty:0,poPrice:0,piQty:r.pi_confirmed_qty||0,piPrice:r.unit_price||0,piDisc:r.discount||0,fromPO:false});added++;}
    });
    renderCmpTable();
    window._lastSupplierPiImportErrors=records.filter(r=>r._errors.length>0).map(r=>({row:r._rowNum,reason:r._errors.join('、')}));
    let html=t('gen.L5670.1','<div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:8px;padding:14px 16px;font-size:13px"><div style="font-weight:600;margin-bottom:8px">导入完成报告</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"><span>总行数：')+records.length+t('gen.L5670.2',' 条</span><span style="color:#1890ff">匹配回填：')+matched+t('gen.L5670.3',' 条</span><span style="color:#52c41a">新增行：')+added+t('gen.L5670.4',' 条</span><span style="color:#ff3b30">跳过（无效）：')+skipped+t('gen.L5670.5',' 条</span></div>');
    if(window._lastSupplierPiImportErrors.length){
      html+=t('gen.L5672.1','<div style="margin-top:10px"><div style="font-weight:600;color:#ff3b30;margin-bottom:6px">无效明细</div>')+window._lastSupplierPiImportErrors.slice(0,20).map(e=>t('gen.L5672.2','<div style="color:#666">第 ')+e.row+t('gen.L5672.3',' 行：')+esc(e.reason)+'</div>').join('')+(window._lastSupplierPiImportErrors.length>20?t('gen.L5672.4','<div style="color:#999">还有 ')+(window._lastSupplierPiImportErrors.length-20)+t('gen.L5672.5',' 条...</div>'):'')+t('gen.L5672.6','<button type="button" class="btn btn-secondary" style="margin-top:10px" onclick="downloadSupplierPIImportErrors()">下载无效明细</button></div>');
    }
    html+='</div>';
    const resEl=document.getElementById('sup-pi-result');if(resEl)resEl.innerHTML=html;
    showToast(t('toast.importMatch3','导入完成：匹配{m}，新增{a}，跳过{s}',{m:matched, a:added, s:skipped}),'success');
  }catch(e){showToast(e.message||t('gen.L5677.1','导入失败'),'danger');}
  finally{if(btn){btn.disabled=false;btn.textContent=t("app.067", "\u5f00\u59cb\u5bfc\u5165");}}
}
function downloadSupplierPIImportErrors(){
  if(!window._lastSupplierPiImportErrors||!window._lastSupplierPiImportErrors.length)return;
  const ws=XLSX.utils.aoa_to_sheet([[t('gen.L5682.1','行号'),t('gen.L5682.2','失败原因')]].concat(window._lastSupplierPiImportErrors.map(e=>[e.row,e.reason])));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,t("app.159", "\u65e0\u6548\u660e\u7ec6"));XLSX.writeFile(wb,t("app.937", "\u4f9b\u5e94\u5546PI\u5bfc\u5165\u65e0\u6548\u660e\u7ec6.xlsx"));
}
async function saveNewPI(){
  const poSel=document.getElementById('npi-po'),supSel=document.getElementById('npi-sup'),termSel=document.getElementById('npi-terms');const items=[];
  (window._piRows||[]).forEach(r=>{if(r.sku&&r.sku.trim())items.push({sku_code:r.sku.trim(),po_qty:parseInt(r.poQty)||0,pi_confirmed_qty:parseInt(r.piQty)||0,unit_price:parseFloat(r.piPrice)||0,discount:parseFloat(r.piDisc)||0})});
  const termId=termSel?termSel.value:'';
  const paymentTermsText=(termId&&termSel.options[termSel.selectedIndex])?termSel.options[termSel.selectedIndex].textContent:'';
  // 品牌/国家/仓库：与批量导入口径一致，关联 PO 时从 PO 带（PI 自身快照字段，不展示期 join 他表）
  let brand='',country='',target_warehouse='';
  if(poSel&&poSel.value){try{const po=await api('/api/purchase-orders/'+encodeURIComponent(poSel.value));brand=po.brand||'';country=po.country||'';target_warehouse=po.target_warehouse||'';}catch(e){}}
  const d={related_po_id:poSel.value||'',related_po_no:poSel.options[poSel.selectedIndex]?.dataset.no||'',supplier_id:supSel.value,supplier_name:supSel.options[supSel.selectedIndex].dataset.name,brand,country,target_warehouse,pi_date:document.getElementById('npi-date').value,currency:document.getElementById('npi-cur').value,need_deposit:document.getElementById('npi-need-dep').value==='1'?1:0,deposit_ratio:parseFloat(document.getElementById('npi-dep').value)||0,expected_delivery:document.getElementById('npi-del').value,payment_terms:paymentTermsText,payment_term_id:termId,items};
  try{
    await api('/api/proforma-invoices','POST',d);
    if(termId&&supSel.value){try{await api('/api/suppliers/'+encodeURIComponent(supSel.value)+'/last-payment-term','POST',{payment_term_id:termId});}catch(e){}}
    showToast(t('gen.L5697.1','PI创建成功'),'success');closeModal();loadPI();
  }catch(e){showToast(e.message,'danger')}
}
async function createDepPay(id){
  try{
    const pi=await api('/api/proforma-invoices/'+id);
    openModal(t('modal.title.createDepPay', '创建定金付款申请 - {v1}', {v1: pi.pi_no}),
      t('modal.body.createDepPay', `<div class="form-card" style="box-shadow:none;padding:0"><div class="detail-grid mb-16"><div class="detail-item"><span class="detail-label">PI总金额</span><span class="detail-value">{v1}</span></div><div class="detail-item"><span class="detail-label">定金比例</span><span class="detail-value">{v2}%</span></div><div class="detail-item"><span class="detail-label">应付定金</span><span class="detail-value font-bold">{v3}</span></div></div><div class="form-grid"><div class="form-group"><label>是否抵扣</label><select id="dep-ded" onchange="document.getElementById('dep-ded-amt').disabled=this.value==='0'"><option value="0">否</option><option value="1">是</option></select></div><div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="dep-ded-amt" value="0" disabled></div><div class="form-group"><label>抵扣来源类型</label><select id="dep-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="quality_claim">质量索赔</option><option value="advance_payment">预付款抵扣</option><option value="other">其他</option></select></div><div class="form-group"><label>抵扣参考号</label><input type="text" id="dep-ded-ref"></div><div class="form-group form-group-full"><label>抵扣说明</label><textarea id="dep-ded-desc" rows="2"></textarea></div></div></div>`, {v1: fmtMoney(pi.total_amount), v2: pi.deposit_ratio||0, v3: fmtMoney(pi.payable_deposit)}),
      t('modal.footer.createDepPay', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveDepPay('{v1}')">创建</button>`, {v1: id}));
  }catch(e){showToast(e.message,'danger')}
}
async function saveDepPay(id){
  const d={pi_id:id,has_deduction:parseInt(document.getElementById('dep-ded').value),deduction_amount:parseFloat(document.getElementById('dep-ded-amt').value)||0,deduction_source_type:document.getElementById('dep-ded-type').value,deduction_source_desc:document.getElementById('dep-ded-desc').value,deduction_ref_no:document.getElementById('dep-ded-ref').value};
  try{await api('/api/payment-requests/from-pi-deposit','POST',d);showToast(t('toast.depPayCreated','定金付款申请已生成'),'success');closeModal()}catch(e){showToast(e.message,'danger')}
}

const DOC_TEMPLATES={
  pi:{file:t("app.940", "PI\u5bfc\u5165\u6a21\u677f.xlsx"),sheet:'PI',url:'/api/proforma-invoices/batch-import',headers:['PI编号',t("app.942", "\u5173\u8054PO\u7f16\u53f7"),t("app.116", "\u4f9b\u5e94\u5546"),t("app.112", "\u54c1\u724c"),t("app.113", "\u56fd\u5bb6"),t("app.114", "\u4ed3\u5e93"),t("app.118", "\u5e01\u79cd"),t("po.036", "PI\u65e5\u671f"),t("app.919", "\u662f\u5426\u9700\u8981\u5b9a\u91d1"),t("app.131", "\u5b9a\u91d1\u6bd4\u4f8b"),t("app.921", "\u9884\u8ba1\u4ea4\u671f"),t("nav.payment_terms", "\u4ed8\u6b3e\u6761\u4ef6"),'SKU',t("col.quantity", "数量"),'单价',t("col.remark", "备注")],sample:['PI-2026-001','PO-2026-001','','','','','USD',todayStr(),t("action.yes", "是"),30,'','','SKU001',100,1.5,'']},
  supplierPI:{file:t("app.943", "\u4f9b\u5e94\u5546PI\u5bfc\u5165\u6a21\u677f.xlsx"),sheet:'PI',headers:['SKU',t("app.143", "PI\u786e\u8ba4\u6570\u91cf"),t("app.145", "PI\u786e\u8ba4\u5355\u4ef7"),'PI折扣'],sample:['SKU001',100,2,0]},
  ci:{file:t("app.944", "CI\u5bfc\u5165\u6a21\u677f.xlsx"),sheet:'CI',url:'/api/commercial-invoices/batch-import',headers:['CI编号',t("app.942", "\u5173\u8054PO\u7f16\u53f7"),t("app.946", "\u5173\u8054PI\u7f16\u53f7"),t("app.116", "\u4f9b\u5e94\u5546"),t("app.112", "\u54c1\u724c"),t("app.113", "\u56fd\u5bb6"),t("app.114", "\u4ed3\u5e93"),t("app.118", "\u5e01\u79cd"),t("app.947", "CI\u65e5\u671f"),t("app.948", "\u5b9e\u9645\u51fa\u8d27\u65e5\u671f"),'SKU',t("col.quantity", "数量"),'单价',t("app.949", "\u5b9e\u9645\u5173\u7a0e\u7a0e\u7387"),t("app.950", "\u5dee\u5f02\u539f\u56e0"),t("col.remark", "备注")],sample:['CI-2026-001','PO-2026-001','PI-2026-001','','','','','USD',todayStr(),todayStr(),'SKU001',100,1.5,10,'','']},
  pl:{file:t("app.951", "PL\u5bfc\u5165\u6a21\u677f.xlsx"),sheet:'PL',url:'/api/packing-lists/batch-import',headers:['PL编号',t("app.942", "\u5173\u8054PO\u7f16\u53f7"),t("app.953", "\u5173\u8054CI\u7f16\u53f7"),t("app.954", "PL\u65e5\u671f"),t("app.955", "\u7bb1\u53f7"),'SKU',t("app.193", "\u6bcf\u7bb1\u6570\u91cf"),t("app.194", "\u7bb1\u6570"),t("app.195", "\u603b\u6570\u91cf"),t("app.956", "\u5355\u7bb1\u6bdb\u91cd"),t("app.957", "\u5355\u7bb1\u51c0\u91cd"),t("app.958", "\u5355\u7bb1\u4f53\u79ef"),t("col.remark", "备注")],sample:['PL-2026-001','PO-2026-001','CI-2026-001',todayStr(),'CTN-001','SKU001',10,10,100,12,10,0.08,'']},
  historicalCI:{file:t("app.959", "\u5386\u53f2CI\u8d22\u52a1\u5bfc\u5165\u6a21\u677f.xlsx"),sheet:'历史CI',url:'/api/historical-commercial-invoices/batch-import',headers:['历史CI编号',t("app.961", "\u4f9b\u5e94\u5546ID"),t("app.116", "\u4f9b\u5e94\u5546"),t("app.112", "\u54c1\u724c"),t("app.113", "\u56fd\u5bb6"),t("app.947", "CI\u65e5\u671f"),t("app.948", "\u5b9e\u9645\u51fa\u8d27\u65e5\u671f"),t("app.118", "\u5e01\u79cd"),t("app.962", "\u5386\u53f2\u8d27\u6b3e\u603b\u91d1\u989d"),t("app.963", "\u5386\u53f2\u5df2\u4ed8\u6b3e"),t("app.964", "\u5386\u53f2\u4ed8\u6b3e\u65e5\u671f"),t("nav.payment_terms", "\u4ed8\u6b3e\u6761\u4ef6"),t("app.184", "\u5230\u671f\u65e5"),t("app.965", "\u539f\u59cb\u51ed\u8bc1\u6216\u5907\u6ce8"),'幂等键'],sample:['HCI-2025-001','',t("app.967", "\u5386\u53f2\u4f9b\u5e94\u5546"),'Redragon',t("app.968", "\u5370\u5ea6\u5c3c\u897f\u4e9a"),'2025-12-31','2025-12-31','USD',100000,70000,'',t("app.969", "30\u5929"),'2026-01-30',t("app.970", "\u5386\u53f2\u51ed\u8bc1\u7f16\u53f7\u6216\u5907\u6ce8"),'']}
};
function downloadDocTemplate(type){
  const t=DOC_TEMPLATES[type]; if(!t)return;
  const ws=XLSX.utils.aoa_to_sheet([t.headers,t.sample]);
  ws['!cols']=t.headers.map(h=>({wch:Math.max(10,h.length*2+2)}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,t.sheet);XLSX.writeFile(wb,t.file);
}
function openDocImport(type){
  const t=DOC_TEMPLATES[type]; if(!t)return;
  openModal(t('modal.title.openDocImport', '批量导入{v1}', {v1: t.sheet}),t('modal.body.openDocImport', `<div class="form-card" style="box-shadow:none;padding:0"><div id="doc-import-drop" style="border:2px dashed #d9d9d9;border-radius:8px;padding:34px 20px;text-align:center;cursor:pointer;background:#fafafa" onclick="document.getElementById('doc-import-file').click()"><div style="font-size:42px;color:#1890ff;margin-bottom:8px">📤</div><div>点击上传 Excel / CSV 文件</div><div style="font-size:12px;color:#999;margin-top:4px">支持 .xlsx / .xls / .csv</div></div><input type="file" id="doc-import-file" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleDocImportFile('{v1}',this.files[0])"><div id="doc-import-result" style="margin-top:14px"></div></div>`, {v1: type}),t('modal.footer.openDocImport', `<button class="btn btn-secondary" onclick="downloadDocTemplate('{v1}')">下载模板</button><button class="btn btn-secondary" onclick="closeModal()">关闭</button>`, {v1: type}));
}
function handleDocImportFile(type,file){
  if(!file)return;const t=DOC_TEMPLATES[type];const r=new FileReader();
  r.onload=async e=>{try{const data=new Uint8Array(e.target.result);const wb=XLSX.read(data,{type:'array',cellDates:true});const ws=wb.Sheets[wb.SheetNames[0]];const items=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false,dateNF:'yyyy-mm-dd'});const res=await api(t.url,'POST',{items});renderDocImportResult(res);if(type==='pi')loadPI();if(type==='ci'||type==='pl')loadCI();if(type==='historicalCI'){const mode=document.getElementById('ci-source-mode');if(mode)mode.value='historical';loadCI();}}catch(err){showToast(t('toast.handleDocImportFile', '导入失败：{v1}', {v1: err.message}),'danger')}};r.readAsArrayBuffer(file);
}
function renderDocImportResult(res){
  const errs=res.errors||[];
  let html=t('gen.L5736.1','<div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:10px;margin-bottom:10px">导入完成：成功 ')+(res.success||0)+t('gen.L5736.2',' 条')+(res.idempotent?t('gen.L5736.3','，幂等识别 ')+res.idempotent+t('gen.L5736.4',' 条'):'')+t('gen.L5736.5','，失败 ')+(res.failed||0)+t('gen.L5736.6',' 条</div>');
  (res.messages||[]).forEach(m=>html+='<div style="background:#fffbe6;border:1px solid #ffe58f;border-radius:6px;padding:8px;margin-bottom:8px">'+esc(m)+'</div>');
  if(errs.length)html+=t('gen.L5738.1','<div class="table-container" style="max-height:260px;overflow:auto;box-shadow:none;border:1px solid #eee"><table class="data-table"><thead><tr><th>行号</th><th>失败原因</th></tr></thead><tbody>')+errs.map(e=>'<tr><td>'+e.row+'</td><td>'+esc(e.reason||e.error)+'</td></tr>').join('')+'</tbody></table></div>';
  document.getElementById('doc-import-result').innerHTML=html;
}
function parseAttachmentValue(v){try{return typeof v==='string'?JSON.parse(v):v}catch(e){return v?{name:t('gen.L5741.1','附件'),dataUrl:v}:null}}
function attachmentHtml(docType,id,field,val,label){
  const a=parseAttachmentValue(val);const has=a&&a.dataUrl;
  return '<div class="detail-item"><span class="detail-label">'+label+'</span><span class="detail-value">'+(has?'<span class="link-text" onclick="downloadAttachment(\''+docType+'\',\''+id+'\',\''+field+'\')">'+esc(a.name||label)+'</span> <button class="btn btn-secondary btn-sm" onclick="uploadDocAttachment(\''+docType+'\',\''+id+'\',\''+field+t('gen.L5744.1','\')">重传</button> <button class="btn btn-danger btn-sm" onclick="deleteDocAttachment(\'')+docType+'\',\''+id+'\',\''+field+t('gen.L5744.2','\')">删除</button>'):'<button class="btn btn-secondary btn-sm" onclick="uploadDocAttachment(\''+docType+'\',\''+id+'\',\''+field+t('gen.L5744.3','\')">上传</button>'))+'</span></div>';
}
async function uploadDocAttachment(docType,id,field){
  const inp=document.createElement('input');inp.type='file';inp.accept='.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp';
  inp.onchange=()=>{const f=inp.files[0];if(!f)return;const r=new FileReader();r.onload=async e=>{const attachment={name:f.name,type:f.type,size:f.size,dataUrl:e.target.result,uploaded_at:new Date().toISOString()};try{const url=docType==='pi'?'/api/proforma-invoices/'+id+'/attachment':'/api/commercial-invoices/'+id+'/attachment';await api(url,'POST',{field,attachment});showToast(t('gen.L5748.1','附件已上传'),'success');docType==='pi'?loadPI():loadCI();}catch(err){showToast(err.message,'danger')}};r.readAsDataURL(f)};inp.click();
}
async function deleteDocAttachment(docType,id,field){try{const url=docType==='pi'?'/api/proforma-invoices/'+id+'/attachment':'/api/commercial-invoices/'+id+'/attachment';await api(url,'POST',{field,attachment:''});showToast(t('gen.L5750.1','附件已删除'),'success');closeModal();docType==='pi'?loadPI():loadCI();}catch(e){showToast(e.message,'danger')}}
async function downloadAttachment(docType,id,field){const d=await api((docType==='pi'?'/api/proforma-invoices/':'/api/commercial-invoices/')+id);const a=parseAttachmentValue(d[field]);if(!a||!a.dataUrl){showToast(t('gen.L5751.1','暂无附件'),'warning');return}const link=document.createElement('a');link.href=a.dataUrl;link.download=a.name||t('gen.L5751.2','附件');link.click();}

// ==================== CI/PL管理 ====================
function canImportHistoricalCI(){return hasPermission('ci_create')&&hasPermission('payment_create')&&hasPermission('payment_approve')}
async function renderCI(){
  document.getElementById('content-inner').innerHTML=t('html.renderCI', '<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>单据类型</label><select id="ci-source-mode" onchange="onCISourceModeChange()"><option value="operational">运营 CI</option><option value="historical">历史 CI</option><option value="all">全部</option></select></div><div class="filter-group"><label>状态</label><select id="ci-fs"><option value="">全部</option><option value="draft">待上传 CI/PL</option><option value="uploaded">已上传 CI/PL</option><option value="checking">待核对</option><option value="checked">已核对</option><option value="pending_balance">待尾款审批</option><option value="balance_paid">尾款已付款</option><option value="shipped">已发货</option><option value="customs">清关中</option><option value="completed">已完成</option></select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadCI()">搜索</button>{v1}{v2}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🚚 CI/PL列表</div></div><div id="ci-purchase-summary"></div><div id="ci-table"></div></div>', {v1: hasPermission('ci_create')?t('gen.L5756.1','<button class="btn btn-primary btn-sm" onclick="createCI()">➕ 新建CI</button>'):'', v2: ''});
  loadCI();
}
function onCISourceModeChange(){const mode=document.getElementById('ci-source-mode')?.value||'operational',status=document.getElementById('ci-fs');if(status)status.disabled=mode==='historical';loadCI()}
function renderOperationalCITable(data){
  return !data.length?t('gen.L5761.1','<div class="empty-state"><div class="empty-icon">🚚</div>暂无运营CI</div>'):t('gen.L5761.2','<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>CI号</th><th>关联PO</th><th>关联PI</th><th>供应商</th><th>品牌</th><th>国家</th><th>仓库</th><th>日期</th><th>币种</th><th>CI金额</th><th>已付定金</th><th>应付尾款</th><th>差异</th><th>状态</th><th>操作</th></tr></thead><tbody>')+data.map(c=>'<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewCI\',\''+c.id+'\')"><td class="cell-id"><span class="link-text" onclick="viewCI(\''+c.id+'\')">'+esc(c.ci_no)+'</span></td><td class="cell-id">'+esc(c.related_po_no)+'</td><td class="cell-id" style="max-width:160px">'+renderMultiPICell(c)+'</td><td>'+esc(c.supplier_name)+'</td><td>'+esc(c.brand)+'</td><td>'+esc(c.country)+'</td><td>'+esc(c.target_warehouse)+'</td><td class="cell-date">'+fmtDate(c.ci_date)+'</td><td>'+esc(c.currency)+'</td><td class="text-right">'+fmtMoney(c.goods_amount)+'</td><td class="text-right">'+fmtMoney(c.actual_deducted_deposit)+'</td><td class="text-right">'+fmtMoney(c.payable_balance)+'</td><td class="text-right">'+fmtMoney(c.amount_difference)+'</td><td><span class="status-badge '+ciStatusClass(c.ci_status)+'">'+statusLabel(c.ci_status)+'</span></td><td class="cell-actions"><button class="action-btn" onclick="viewCI(\''+c.id+'\')">👁️</button><button class="action-btn" onclick="uploadDocAttachment(\'ci\',\''+c.id+t('gen.L5761.3','\',\'attachment\')" title="\u4e0a\u4f20CI\u9644\u4ef6">📎</button><button class="action-btn" onclick="uploadDocAttachment(\'ci\',\'')+c.id+t('gen.L5761.4','\',\'pl_attachment\')" title="\u4e0a\u4f20PL\u9644\u4ef6">📦</button>')+(c.payable_balance>0&&c.balance_payment_status==='unpaid'&&hasPermission('payment_create')?'<button class="action-btn" onclick="createBalPay(\''+c.id+t('gen.L5761.5','\')" title="尾款付款">💰</button>'):'')+(hasPermission('cost_view')?'<button class="action-btn" onclick="viewCICost(\''+c.id+t('gen.L5761.6','\')" title="费用管理">📊</button>'):'')+(hasPermission('ci_edit')?'<button class="action-btn" '+((c.ci_status==='completed'||c.ci_status==='partial_inbound')?t('gen.L5761.7','disabled title="\u8be5\u72b6\u6001\u4e0d\u53ef\u4f5c\u5e9f" style="opacity:.3;cursor:not-allowed"'):'onclick="voidCI(\''+c.id+t('gen.L5761.8','\')" title="\u4f5c\u5e9f"'))+t('gen.L5761.9','>作废</button>'):'')+'</td></tr>').join('')+'</tbody></table></div>';
}
function renderHistoricalCITable(data){
  return !data.length?t('gen.L5764.1','<div class="empty-state"><div class="empty-icon">📚</div>暂无历史CI</div>'):t('gen.L5764.2','<div style="font-size:12px;color:#666;padding:10px 0">仅用于历史采购金额和应付管理，不影响库存、WAC及订单预测。</div><div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>历史CI号</th><th>供应商</th><th>品牌</th><th>国家</th><th>日期</th><th>币种</th><th>总货款</th><th>导入历史已付</th><th>后续已付</th><th>抵扣</th><th>抹零</th><th>未结金额</th><th>付款状态</th><th>到期日</th><th>操作</th></tr></thead><tbody>')+data.map(h=>{const st=h.payment_status==='paid'?'status-paid':String(h.payment_status||'').includes('partial')?'status-pending':'status-unpaid';return '<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewHistoricalCI\',\''+h.id+'\')"><td class="cell-id"><span class="link-text" onclick="viewHistoricalCI(\''+h.id+'\')">'+esc(h.historical_ci_no)+'</span></td><td>'+esc(h.supplier_name)+'</td><td>'+esc(h.brand_name)+'</td><td>'+esc(h.country)+'</td><td class="cell-date">'+fmtDate(h.ci_date)+'</td><td>'+esc(h.currency)+'</td><td class="text-right font-bold">'+fmtMoney(h.gross_goods_amount)+'</td><td class="text-right">'+fmtMoney(h.historical_paid_amount)+'</td><td class="text-right">'+fmtMoney(h.subsequent_paid_amount)+'</td><td class="text-right">'+fmtMoney(h.deduction_amount)+'</td><td class="text-right">'+fmtMoney(h.rounding_amount)+'</td><td class="text-right '+(Number(h.unpaid_amount||0)>0?'text-danger':'')+'">'+fmtMoney(h.unpaid_amount)+'</td><td><span class="status-badge '+st+'">'+esc(PAY_STATUS_MAP[h.payment_status]||h.payment_status)+'</span></td><td class="cell-date">'+fmtDate(h.due_date)+'</td><td class="cell-actions"><button class="action-btn" onclick="viewHistoricalCI(\''+h.id+t('gen.L5764.3','\')" title="\u67e5\u770b\u5386\u53f2CI">👁️</button>')+(hasPermission('payment_view')?'<button class="action-btn" onclick="viewPayment(\''+h.payment_request_id+t('gen.L5764.4','\')" title="\u4ed8\u6b3e\u4e0e\u7ed3\u7b97">💳</button>'):'')+'</td></tr>'}).join('')+'</tbody></table></div>';
}
function renderPurchaseAmountSummary(summary){
  const scope=(label,data)=>'<div class="stat-card"><div class="stat-label">'+label+'</div><div class="stat-number" style="font-size:17px">'+((data.by_currency||[]).map(x=>esc(x.currency)+' '+Number(x.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})).join(' · ')||'0.00')+'</div><div style="font-size:12px;color:#999;margin-top:4px">'+data.count+t('gen.L5767.1',' 张；人民币待补 ')+data.rmb_pending_count+t('gen.L5767.2',' 张</div></div>');
  return '<div class="stats-grid mb-16" style="grid-template-columns:repeat(3,minmax(0,1fr))">'+scope(t("app.978", "\u8fd0\u8425\u91c7\u8d2d\u91d1\u989d"),summary.operational)+scope(t('gen.L5768.1','历史采购金额'),summary.historical)+scope(t("app.979", "\u91c7\u8d2d\u91d1\u989d\u5408\u8ba1\uff08\u6309\u5e01\u79cd\uff09"),summary.total)+'</div><div style="font-size:12px;color:#999;margin:-8px 0 12px">'+esc(summary.rmb_note||'')+'</div>';
}
// ── Multi-PI display helpers ��─
function renderMultiPICell(c){
  var piNos=[];
  try{piNos=JSON.parse(c.related_pi_nos||'[]');}catch(e){piNos=[];}
  if(piNos.length===0&&c.related_pi_no)piNos=[c.related_pi_no];
  if(piNos.length===0)return '—';
  if(piNos.length<=2)return piNos.map(function(n){return '<span style="white-space:nowrap">'+esc(n)+'</span>';}).join('<br>');
  var uid='pcl-'+c.id.replace(/[^a-zA-Z0-9]/g,'');
  var f2=piNos.slice(0,2).map(function(n){return '<span style="white-space:nowrap">'+esc(n)+'</span>';}).join('<br>');
  return '<div id="'+uid+'" class="pi-collapsed">'+f2+
    '<br><span class="link-text" onclick="event.stopPropagation();togglePICell(\''+uid+'\',\''+piNos.length+'\')" style="font-size:11px">+'+ (piNos.length-2) +' '+t('ci.more_pi','更多')+'</span></div>'+
    '<div id="'+uid+'-x" style="display:none">'+piNos.map(function(n){return '<span style="white-space:nowrap">'+esc(n)+'</span>';}).join('<br>')+
    '<br><span class="link-text" onclick="event.stopPropagation();togglePICell(\''+uid+'\',\''+piNos.length+'\')" style="font-size:11px">'+t('ci.collapse','收起')+'</span></div>';
}
function togglePICell(uid,total){
  var m=document.getElementById(uid),r=document.getElementById(uid+'-x');
  if(!m||!r)return;
  if(r.style.display==='none'){m.style.display='none';r.style.display='';}
  else{r.style.display='none';m.style.display='';}
}

async function loadCI(){
  try{
    const mode=document.getElementById('ci-source-mode')?.value||'operational',s=document.getElementById('ci-fs')?.value||'';
    const results=await Promise.all([mode==='historical'?Promise.resolve([]):api('/api/commercial-invoices?status='+encodeURIComponent(s)),mode==='operational'?Promise.resolve([]):api('/api/historical-commercial-invoices'),api('/api/purchase-amount-summary')]);
    const table=document.getElementById('ci-table'),summary=document.getElementById('ci-purchase-summary');if(!table||!summary)return;
    summary.innerHTML=renderPurchaseAmountSummary(results[2]);
    if(mode==='operational')table.innerHTML=renderOperationalCITable(results[0]);
    else if(mode==='historical')table.innerHTML=renderHistoricalCITable(results[1]);
    else table.innerHTML=t('html.loadCI', '<h3 style="margin:8px 0 10px;font-size:15px">运营 CI</h3>{v1}<h3 style="margin:20px 0 10px;font-size:15px">历史 CI</h3>{v2}', {v1: renderOperationalCITable(results[0]), v2: renderHistoricalCITable(results[1])});
  }catch(e){showFlash(e.message,'danger')}
}
async function createHistoricalCI(){
  try{
    if(!canImportHistoricalCI()){showToast(t('gen.L5783.1','历史 CI 导入需要 CI 创建、付款创建和付款审批权限'),'danger');return}
    const results=await Promise.all([api('/api/suppliers'),api('/api/countries'),api('/api/currencies'),api('/api/brands/all'),api('/api/payment-term-options'),api('/api/proforma-invoices')]);
    const suppliers=results[0].filter(function(s){return s.status==='active';});
    const countries=results[1].filter(function(x){return x.status==='active';});
    const currencies=results[2].filter(function(x){return x.status==='active';});
    const brands=results[3];
    const termOpts=results[4]||[];
    const allPis=results[5]||[];

    // Filter available PIs (same logic as operational CI — PI-level aggregates)
    var avlPiMap={};var EPSILON=0.001;
    allPis.forEach(function(p){
      var remainQty=(p.confirmed_qty_sum||0)-(p.shipped_qty_sum||0);
      if(remainQty>EPSILON && (p.need_deposit!==1||p.deposit_payment_status==='paid')){
        avlPiMap[p.id]=p;
      }
    });
    window._hciAllPis=Array.from(Object.values(avlPiMap));
    window._hciAllTermOpts=termOpts;
    window._hciSuppliers=suppliers;
    window._hciBrands=brands;
    window._hciCountries={};countries.forEach(function(c){window._hciCountries[c.name]=c.code;});

    const idempotency='historical-ci-ui:'+(window.crypto&&window.crypto.randomUUID?window.crypto.randomUUID():(Date.now()+'-'+Math.random().toString(36).slice(2)));

    // Build HTML body — same layout style as createOperationalCI
    var body='<div class="form-card" style="box-shadow:none;padding:0">';
    body+='<input type="hidden" id="hci-idempotency" value="'+idempotency+'">';
    body+='<div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:10px;margin-bottom:14px;font-size:13px">'+t('gen.L5783.2','仅用于历史采购金额和应付管理，不影响库存、WAC及订单预测。')+'</div>';

    // Row 1: CI No + Supplier
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.historical_ci_no','历史 CI 编号')+' <span class="required">*</span></label><input id="hci-no" placeholder="'+t('ci.no.auto','留空自动生成')+'"><div style="font-size:11px;color:#999">'+t('ci.no.hint','留空则自动生成；填写需唯一')+'</div></div>';
    body+='<div class="form-group"><label>'+t('field.supplier_name','供应商')+' <span class="required">*</span></label><select id="hci-supplier" onchange="onHistoricalSupplierChange()"><option value="">'+t('ci.select_supplier_first','请先选择供应商')+'</option>';
    suppliers.forEach(function(s){
      body+='<option value="'+s.id+'" data-name="'+esc(s.name)+'" data-currency="'+(s.default_currency||'')+'" data-brands="'+esc(s.associated_brands||'[]')+'">'+esc(s.name)+'</option>';
    });
    body+='</select></div></div>';

    // Row 2: PI association toggle
    body+='<h4 style="margin:12px 0 8px">'+t('hci.pi_assoc','PI 关联')+'</h4>';
    body+='<div style="display:flex;gap:12px;margin-bottom:12px">';
    body+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="radio" name="hci-pi-mode" value="linked" checked onchange="onHistoricalPIModeChange()"> '+t('hci.pi_linked','有关联 PI')+'</label>';
    body+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="radio" name="hci-pi-mode" value="manual" onchange="onHistoricalPIModeChange()"> '+t('hci.pi_manual','无 PI 数据（手工录入）')+'</label>';
    body+='</div>';

    // PI dropdown (shown when mode=linked)
    body+='<div id="hci-pi-section" class="form-group" style="position:relative;margin-bottom:12px">';
    body+='<div id="hci-pi-trigger" onclick="toggleHciPiDropdown()" style="padding:8px 12px;border:1px solid #d9d9d9;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;min-height:38px;background:#fff;user-select:none">';
    body+='<span id="hci-pi-trigger-text" style="font-size:13px;color:#999">'+t('ci.select_supplier_first_hint','请先选择供应商')+'</span>';
    body+='<span style="font-size:11px;color:#999">▼</span></div>';
    body+='<div id="hci-pi-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;max-height:240px;overflow-y:auto;border:1px solid #d9d9d9;border-radius:6px;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.1);margin-top:2px">';
    body+='<div style="padding:12px;font-size:13px;color:#999">'+t('ci.select_supplier_first_hint','请先选择供应商')+'</div></div></div>';

    // Aggregated PI items table (shown when PI(s) selected)
    body+='<div id="hci-items-preview" style="margin-bottom:12px;display:none"></div>';

    // Row 3: Supplier snapshot (auto-filled) + Brand
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.supplier_snapshot','供应商快照')+' <span class="required">*</span></label><input id="hci-supplier-name" placeholder="'+t('hci.supplier_snapshot_hint','选择供应商后自动填入')+'" readonly style="background:#f5f5f5"></div>';
    body+='<div class="form-group"><label>'+t('field.brand','品牌')+' <span class="required">*</span></label><input id="hci-brand" placeholder="'+t('hci.brand_hint','选择供应商后自动填入')+'"></div></div>';

    // Row 4: Country + Currency (auto-filled)
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.country','采购归属国家')+' <span class="required">*</span></label><select id="hci-country"><option value="">'+t('app.select','请选择')+'</option>';
    countries.forEach(function(c){body+='<option value="'+esc(c.code)+'"'+(c.default_currency?' data-cur="'+esc(c.default_currency)+'"':'')+'>'+esc(c.name)+(c.flag?' '+c.flag:'')+'</option>';});
    body+='</select></div>';
    body+='<div class="form-group"><label>'+t('field.currency','币种')+' <span class="required">*</span></label><select id="hci-currency">';
    currencies.forEach(function(c){body+='<option value="'+esc(c.code)+'"'+(c.symbol?' data-symbol="'+esc(c.symbol)+'"':'')+'>'+esc(c.code)+(c.symbol?' ('+c.symbol+')':'')+'</option>';});
    body+='</select></div></div>';

    // Row 5: CI Date + Actual Ship Date
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.ci_date','CI 日期')+' <span class="required">*</span></label><input type="date" id="hci-date"></div>';
    body+='<div class="form-group"><label>'+t('field.actual_ship_date','实际出货日期')+' <span class="required">*</span></label><input type="date" id="hci-ship-date"><div style="font-size:12px;color:#999">'+t('hci.ship_date_hint','用于信用账期计算，与 CI 日期不同')+'</div></div></div>';

    // Row 6: Gross Amount + Historical Paid
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.gross_amount','历史货款总金额')+' <span class="required">*</span></label><input type="number" min="0.01" step="0.01" id="hci-gross" placeholder="0.00"></div>';
    body+='<div class="form-group"><label>'+t('field.historical_paid','导入前历史已付款')+'</label><input type="number" min="0" step="0.01" id="hci-paid" value="0" placeholder="0.00"></div></div>';

    // Row 7: Paid Date + Payment Terms
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.paid_date','历史已付款日期')+'</label><input type="date" id="hci-paid-date"><div style="font-size:12px;color:#999">'+t('hci.paid_date_hint','未知时保持为空，不会用导入日期代替')+'</div></div>';
    body+='<div class="form-group"><label>'+t('field.payment_terms','付款条件/账期')+'</label><select id="hci-terms"><option value="">'+t('app.none','无')+'</option>';
    termOpts.forEach(function(tm){body+='<option value="'+esc(tm.name)+'"'+(tm.credit_days>0?' data-credit="'+tm.credit_days+'"':'')+'>'+esc(tm.name)+(tm.credit_days>0?' ('+tm.credit_days+t('unit.days','天')+')':'')+' ('+(tm.source==='supplier'?t('ci.term.supplier','供应商'):t('ci.term.global','全局'))+')</option>';});
    body+='</select></div></div>';

    // Row 8: Due Date + Notes
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.due_date','到期日')+'</label><input type="date" id="hci-due"></div>';
    body+='<div class="form-group"><label>'+t('field.source_note','原始凭证或备注')+'</label><input id="hci-note" placeholder="'+t('hci.note_hint','可选')+'"></div></div>';

    body+='</div>';

    openModal(t("po.037", "历史 CI 导入"), body,
      t('hci.footer_btns','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="hci-save" onclick="saveHistoricalCI()">导入</button>'),'modal-ci-create');

    // Init click-outside listener for PI dropdown
    if(!window._hciPiDocListener){window._hciPiDocListener=true;document.addEventListener('click',function(e){if(!e.target.closest('#hci-pi-trigger')&&!e.target.closest('#hci-pi-dropdown')){closeHciPiDropdown();}});}
  }catch(e){showToast(e.message,'danger')}
}
function onHistoricalSupplierChange(){
  var sel=document.getElementById('hci-supplier');
  var name=document.getElementById('hci-supplier-name');
  var brand=document.getElementById('hci-brand');
  var cur=document.getElementById('hci-currency');
  var piList=document.getElementById('hci-pi-dropdown');
  if(!sel)return;
  var supId=sel.value;
  var option=sel.options[sel.selectedIndex];
  var supName=option&&option.dataset.name||'';

  // Auto-fill supplier snapshot
  if(name){name.value=supName;}

  // Auto-fill brand from supplier's associated_brands
  if(brand){
    var brandsStr=option&&option.dataset.brands||'[]';
    var supBrands=[];
    try{supBrands=JSON.parse(brandsStr);}catch(e){supBrands=[];}
    if(supBrands.length===1){
      brand.value=supBrands[0];
    }else if(supBrands.length>1){
      brand.value=supBrands.join(', ');
      brand.placeholder=supBrands.join(', ');
    }else{
      brand.value='';
      brand.placeholder='';
    }
  }

  // Auto-fill currency from supplier's default_currency
  if(cur&&supId){
    var supCur=option&&option.dataset.currency||'';
    if(supCur){
      for(var i=0;i<cur.options.length;i++){if(cur.options[i].value===supCur){cur.value=supCur;break;}}
    }
  }

  // Filter payment terms by supplier
  onHistoricalPaymentTermsFilter(supId);

  // Filter PI dropdown
  if(piList&&supId){
    var supPis=(window._hciAllPis||[]).filter(function(p){return p.supplier_id===supId;});
    if(supPis.length===0){
      piList.innerHTML='<div style="padding:12px;font-size:13px;color:#999">'+t('ci.no_pi_for_supplier','该供应商无可选PI')+'</div>';
    }else{
      var html='';
      supPis.forEach(function(p){
        var remain=(p.confirmed_qty_sum||0)-(p.shipped_qty_sum||0);
        html+='<label class="hci-pi-item" style="display:block;padding:10px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;margin:0;transition:background .15s" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'#fff\'">';
        html+='<div style="display:flex;align-items:center;gap:8px">';
        html+='<input type="checkbox" class="hci-pi-cb" value="'+p.id+'" data-no="'+esc(p.pi_no)+'" data-cur="'+p.currency+'" onchange="onHciPISelectionChange()" style="flex-shrink:0;width:16px;height:16px">';
        html+='<span style="font-size:13px;font-weight:500;color:#333;white-space:nowrap">'+esc(p.pi_no)+'</span>';
        html+='</div>';
        html+='<div style="font-size:12px;color:#888;margin-top:4px;padding-left:24px">'+t('ci.pi.remain','剩余可出货：')+remain+' '+t('unit.pcs','件')+'</div>';
        html+='</label>';
      });
      piList.innerHTML=html;
    }
    updateHciPiTriggerText();
  }else if(piList&&!supId){
    piList.innerHTML='<div style="padding:12px;font-size:13px;color:#999">'+t('ci.select_supplier_first_hint','请先选择供应商')+'</div>';
    updateHciPiTriggerText();
  }
}

// ── PI mode toggle (linked vs manual) ──
function onHistoricalPIModeChange(){
  var mode=document.querySelector('input[name="hci-pi-mode"]:checked');
  var section=document.getElementById('hci-pi-section');
  if(!section||!mode)return;
  section.style.display=mode.value==='linked'?'':'none';
  // Clear PI selection when switching to manual
  if(mode.value==='manual'){
    document.querySelectorAll('.hci-pi-cb').forEach(function(cb){cb.checked=false;});
    updateHciPiTriggerText();
  }
}

// ── PI dropdown toggle ──
function toggleHciPiDropdown(){
  var dd=document.getElementById('hci-pi-dropdown');
  if(!dd)return;
  dd.style.display=dd.style.display==='none'?'block':'none';
  if(dd.style.display==='block'){
    var sel=document.getElementById('hci-supplier');
    if(sel&&sel.value)onHistoricalSupplierChange();
  }
}
function closeHciPiDropdown(){
  var dd=document.getElementById('hci-pi-dropdown');
  if(dd)dd.style.display='none';
}
function updateHciPiTriggerText(){
  var el=document.getElementById('hci-pi-trigger-text');
  if(!el)return;
  var cbs=document.querySelectorAll('.hci-pi-cb:checked');
  if(cbs.length===0){el.textContent=t('ci.select_supplier_first_hint','请先选择供应商');el.style.color='#999';return;}
  if(cbs.length===1){el.textContent=cbs[0].dataset.no;el.style.color='#333';return;}
  el.textContent=cbs.length+' '+t('hci.pi_selected','个PI已选择');el.style.color='#333';
}
async function onHciPISelectionChange(){
  var cbs=document.querySelectorAll('.hci-pi-cb:checked');
  updateHciPiTriggerText();
  closeHciPiDropdown();
  if(cbs.length===0){
    var preview=document.getElementById('hci-items-preview');
    if(preview)preview.style.display='none';
    window._hciSelectedPiIds=[];
    return;
  }
  // Collect selected PI IDs
  var piIds=[];cbs.forEach(function(cb){piIds.push(cb.value);});
  window._hciSelectedPiIds=piIds;
  // ── Auto-fill from PI data (country/brand/currency/supplier_name via _hciAllPis) ──
  var firstPi=null;
  for(var j=0;j<cbs.length;j++){
    var pid=cbs[j].value;
    var match=(window._hciAllPis||[]).find(function(p){return p.id===pid;});
    if(match){firstPi=match;break;}
  }
  if(firstPi){
    // Country: reverse lookup name → code
    var countryMap=window._hciCountries||{};
    var countryCode=countryMap[firstPi.country]||'';
    if(countryCode){
      var countrySel=document.getElementById('hci-country');
      if(countrySel){for(var k=0;k<countrySel.options.length;k++){if(countrySel.options[k].value===countryCode){countrySel.value=countryCode;break;}}}
    }
    // Brand
    var brandEl=document.getElementById('hci-brand');
    if(brandEl&&firstPi.brand){brandEl.value=firstPi.brand;}
    // Currency
    var curEl=document.getElementById('hci-currency');
    if(curEl&&firstPi.currency){for(var c=0;c<curEl.options.length;c++){if(curEl.options[c].value===firstPi.currency){curEl.value=firstPi.currency;break;}}}
    // Supplier snapshot
    var supNameEl=document.getElementById('hci-supplier-name');
    if(supNameEl&&firstPi.supplier_name){supNameEl.value=firstPi.supplier_name;}
  }
  // ── Aggregate and display items from all selected PIs ──
  try{await aggregateHciPIItems(piIds);}catch(e){}
}

// ── Aggregate line items from selected PIs (informational reference table) ──
async function aggregateHciPIItems(piIds){
  var preview=document.getElementById('hci-items-preview');
  if(!preview||piIds.length===0){if(preview)preview.style.display='none';return;}
  // Fetch all selected PIs (single endpoint for items)
  var allItems=[];
  for(var i=0;i<piIds.length;i++){
    try{
      var pi=await api('/api/proforma-invoices/'+piIds[i]);
      (pi.items||[]).forEach(function(it){
        if((it.unshipped_qty||0)>0.001){
          allItems.push({pi_no:pi.pi_no,sku_code:it.sku_code,pi_confirmed_qty:it.pi_confirmed_qty||it.shipped_qty||0,unshipped_qty:it.unshipped_qty||0,unit_price:it.unit_price||0,currency:pi.currency});
        }
      });
    }catch(e){}
  }
  if(allItems.length===0){preview.style.display='none';return;}
  // Aggregate by SKU (sum qty, average unit price for reference)
  var agg={};
  allItems.forEach(function(it){
    var key=it.sku_code;
    if(!agg[key])agg[key]={sku_code:it.sku_code,pi_nos:[],total_confirmed:0,unshipped:0,unit_price:0,price_count:0,currency:it.currency};
    agg[key].pi_nos.push(it.pi_no);
    agg[key].total_confirmed+=it.pi_confirmed_qty;
    agg[key].unshipped+=it.unshipped_qty;
    agg[key].unit_price+=it.unit_price;
    agg[key].price_count++;
  });
  var rows=Object.values(agg);
  rows.forEach(function(r){r.unit_price=r.price_count>0?r.unit_price/r.price_count:0;});
  // Build table
  var html='<h4 style="margin:12px 0 8px">'+t('ci.items_from_pi','从PI带出的出货明细')+' <span style="font-size:12px;color:#888">('+piIds.length+' PI)</span></h4>';
  html+='<div style="max-height:300px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:6px">';
  html+='<table class="data-table" style="margin:0;font-size:13px"><thead><tr>';
  html+='<th>SKU</th><th>'+t('ci.col.pi_source','PI来源')+'</th>';
  html+='<th style="text-align:right">'+t('ci.col.pi_qty','PI数量')+'</th>';
  html+='<th style="text-align:right">'+t('ci.pi.remain','剩余可出货')+'</th>';
  html+='<th style="text-align:right">'+t('field.unit_price','参考单价')+'</th>';
  html+='</tr></thead><tbody>';
  var grandTotal=0;
  rows.forEach(function(r){
    var uniqueNos=[];r.pi_nos.forEach(function(n){if(uniqueNos.indexOf(n)<0)uniqueNos.push(n);});
    var rowTotal=r.unshipped*r.unit_price;
    grandTotal+=rowTotal;
    html+='<tr>';
    html+='<td class="cell-id">'+esc(r.sku_code)+'</td>';
    html+='<td style="font-size:12px;color:#888">'+uniqueNos.join(', ')+'</td>';
    html+='<td style="text-align:right">'+r.total_confirmed+'</td>';
    html+='<td style="text-align:right">'+r.unshipped+'</td>';
    html+='<td style="text-align:right">'+fmtMoney(r.unit_price)+' '+esc(r.currency)+'</td>';
    html+='</tr>';
  });
  html+='</tbody><tfoot><tr style="background:#fafafa;font-weight:bold">';
  html+='<td colspan="4" style="text-align:right">'+t('ci.summary.est_total','参考总金额')+'</td>';
  html+='<td style="text-align:right">'+fmtMoney(grandTotal)+' '+esc(rows[0]&&rows[0].currency||'')+'</td>';
  html+='</tr></tfoot></table></div>';
  html+='<div style="font-size:12px;color:#999;margin-top:4px">'+t('hci.items_hint','以上为参考信息，请在下方填写实际历史货款金额')+'</div>';
  preview.innerHTML=html;
  preview.style.display='';
}

// ── Payment terms filter (same pattern as onCIPaymentTermsFilter) ──
async function onHistoricalPaymentTermsFilter(supId){
  var tmSel=document.getElementById('hci-terms');
  if(!tmSel||!supId)return;
  var savedVal=tmSel.value;
  var supTerms=[],globalTerms=window._hciAllTermOpts||[];
  try{supTerms=await api('/api/suppliers/'+supId+'/payment-terms');}catch(e){supTerms=[];}
  var globalOnly=globalTerms.filter(function(g){return g.source==='global';}).map(function(g){return{name:g.name,credit_days:g.credit_days||0,source:'global'};});
  var displayTerms=supTerms&&supTerms.length>0?supTerms.map(function(t){return{name:t.term_name,credit_days:t.credit_days||0,source:'supplier',is_default:t.is_default};}):[];
  if(displayTerms.length===0)displayTerms=globalOnly;
  tmSel.innerHTML='<option value="">'+t('app.none','无')+'</option>';
  if(displayTerms.length>0){
    displayTerms.forEach(function(tm){
      tmSel.innerHTML+='<option value="'+esc(tm.name)+'"'+(tm.credit_days>0?' data-credit="'+tm.credit_days+'"':'')+(tm.is_default?' selected':'')+'>'+esc(tm.name)+(tm.credit_days>0?' ('+tm.credit_days+t('unit.days','天')+')':'')+' ('+(tm.source==='supplier'?t('ci.term.supplier','供应商'):t('ci.term.global','全局'))+')</option>';
    });
  }
  if(savedVal){
    var found=false;
    for(var i=0;i<tmSel.options.length;i++){if(tmSel.options[i].value===savedVal){found=true;break;}}
    if(found)tmSel.value=savedVal;
  }
}
async function saveHistoricalCI(){
  const btn=document.getElementById('hci-save');if(!btn||btn.disabled)return;
  const supplier=document.getElementById('hci-supplier');
  const gross=parseFloat(document.getElementById('hci-gross').value);
  const paid=parseFloat(document.getElementById('hci-paid').value||0);
  // Collect selected PI info (optional)
  var piMode=document.querySelector('input[name="hci-pi-mode"]:checked');
  var piIds=[],piNos=[];
  if(piMode&&piMode.value==='linked'){
    document.querySelectorAll('.hci-pi-cb:checked').forEach(function(cb){piIds.push(cb.value);piNos.push(cb.dataset.no);});
  }
  const body={historical_ci_no:document.getElementById('hci-no').value.trim(),supplier_id:supplier.value,supplier_name:document.getElementById('hci-supplier-name').value.trim(),brand_name:document.getElementById('hci-brand').value.trim(),country:document.getElementById('hci-country').value,ci_date:document.getElementById('hci-date').value,actual_ship_date:document.getElementById('hci-ship-date').value,currency:document.getElementById('hci-currency').value,gross_goods_amount:gross,historical_paid_amount:paid,historical_paid_date:document.getElementById('hci-paid-date').value,payment_terms:document.getElementById('hci-terms').value.trim(),due_date:document.getElementById('hci-due').value,source_note:document.getElementById('hci-note').value.trim(),source_mode:'historical',idempotency_key:document.getElementById('hci-idempotency').value};
  // Attach PI references when linked mode
  if(piIds.length>0){body.related_pi_ids=piIds;body.related_pi_nos=piNos;}
  if(!body.historical_ci_no||!body.supplier_name||!body.brand_name||!body.country||!body.ci_date||!body.currency){showToast(t('gen.L5793.1','请填写历史 CI 编号、供应商、品牌、国家、日期和币种'),'warning');return}if(!(gross>0)){showToast(t('gen.L5793.2','历史货款总金额必须大于0'),'warning');return}if(!Number.isFinite(paid)||paid<0){showToast(t('gen.L5793.3','历史已付款金额不能小于0'),'warning');return}if(paid>gross){showToast(t('gen.L5793.4','历史已付款金额不能超过历史货款总金额'),'warning');return}
  btn.disabled=true;btn.textContent=t("app.984", "导入中…");try{const result=await api('/api/historical-commercial-invoices','POST',body);showToast(result.idempotent?t('gen.L5794.1','已识别为重复请求，未重复记账'):t("app.986", "历史 CI 已导入"),'success');closeModal();const mode=document.getElementById('ci-source-mode');if(mode)mode.value='historical';loadCI()}catch(e){showToast(e.message,'danger');if(document.getElementById('hci-save')){btn.disabled=false;btn.textContent=t('gen.L5794.2','导入')}}
}
// CI-SHIP-DATE-01：补充/更正实际出货日期（明确操作按钮 + 最小化弹窗，避免误改）
async function editActualShipDate(type, id, current){
  const url = type === 'historical' ? '/api/historical-commercial-invoices/'+id+'/actual-ship-date' : '/api/commercial-invoices/'+id+'/actual-ship-date';
  window._asdUrl = url;
  openModal(t("app.987", "\u8865\u5145/\u66f4\u6b63\u5b9e\u9645\u51fa\u8d27\u65e5\u671f"), t('modal.body.editActualShipDate', '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>实际出货日期 (YYYY-MM-DD) <span class="required">*</span></label><input type="date" id="asd-input" value="{v1}"></div></div><div style="font-size:12px;color:#999">仅记录真实实际出货日期；不影响 due_date、付款、应付日期、库存或 WAC。</div></div>', {v1: current||''}), t('gen.L5800.1','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="submitActualShipDate()">保存</button>'));
}
async function submitActualShipDate(){
  const val = document.getElementById('asd-input').value;
  try{
    await api(window._asdUrl, 'PUT', { actual_ship_date: val });
    showToast(t('gen.L5806.1','实际出货日期已保存'),'success');
    closeModal();
    loadCI();
  }catch(e){ showToast(e.message,'danger'); }
}
async function viewHistoricalCI(id,backPay,backMode){
  try{
    const h=await api('/api/historical-commercial-invoices/'+id);
    const back=backPay?'<button class="btn btn-secondary" onclick="viewPayment(\''+backPay+'\',\''+(backMode||'view')+t('gen.L5814.1','\')">← 返回付款申请详情</button>'):'';
    window._hciCurrentId=id;
    const attaches=parseHistoricalAttachments(h.attachment);
    const canEdit=hasPermission('ci_edit');
    const attachSection=t('gen.L5818.1','<div class="detail-section"><h3>历史 CI 附件（留痕）</h3>')+
      (canEdit?t('gen.L5819.1','<div class="flex gap-8 mb-8"><select id="hci-att-type" class="form-control" style="max-width:180px"><option value="ci_document">原始 CI</option><option value="payment_proof">历史付款凭证</option><option value="statement">对账单</option><option value="terms_proof">账期证明</option><option value="other">其他说明</option></select><button class="btn btn-primary btn-sm" onclick="uploadHistoricalAttachment()">上传附件</button></div>'):'')+
      '<div id="hci-att-list">'+historicalAttachmentListHtml(attaches,canEdit)+'</div>'+
      t('gen.L5821.1','<div style="font-size:12px;color:#999;margin-top:8px">附件仅作为原始证据与审计留痕，不参与应付、抵扣、抹零、未结、WAC、库存或订单预测。</div></div>');
    openModal(t('modal.title.viewHistoricalCI', '历史 CI - {v1}', {v1: esc(h.historical_ci_no)}),t('modal.body.viewHistoricalCI', '<div class="detail-card" style="box-shadow:none;padding:0"><div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:10px;margin-bottom:14px;font-size:13px">source_mode = historical；仅参与采购金额和应付统计，不进入 PO/PI/PL/Inbound、库存、WAC 或订单预测。</div><div class="detail-grid">{v1}<div class="detail-item"><span class="detail-label">实际出货日期</span><span class="detail-value{v2}">{v3}</span></div>{v4}</div>{v5}</div>', {v1: [[t('gen.L5822.1','历史CI编号'),h.historical_ci_no],[t('gen.L5822.2','供应商'),h.supplier_name],[t('gen.L5822.3','品牌'),h.brand_name],[t('gen.L5822.4','国家'),h.country],[t('gen.L5822.5','CI日期'),fmtDate(h.ci_date)],[t('gen.L5822.6','币种'),h.currency],[t('gen.L5822.7','总货款'),fmtMoney(h.gross_goods_amount,h.currency)],[t('gen.L5822.8','导入历史已付'),fmtMoney(h.historical_paid_amount,h.currency)],[t('gen.L5822.9','历史付款日期'),h.historical_paid_date||t('gen.L5822.10','未知')],[t('gen.L5822.11','后续已付'),fmtMoney(h.subsequent_paid_amount,h.currency)],[t('gen.L5822.12','抵扣'),fmtMoney(h.deduction_amount,h.currency)],[t('gen.L5822.13','抹零'),fmtMoney(h.rounding_amount,h.currency)],[t('gen.L5822.14','未结金额'),fmtMoney(h.unpaid_amount,h.currency)],[t('gen.L5822.15','付款状态'),PAY_STATUS_MAP[h.payment_status]||h.payment_status],[t('gen.L5822.16','付款条件'),h.payment_terms||'—'],[t('gen.L5822.17','到期日'),fmtDate(h.due_date)],[t('gen.L5822.18','原始凭证或备注'),h.source_note||'—']].map(x=>'<div class="detail-item"><span class="detail-label">'+x[0]+'</span><span class="detail-value">'+esc(x[1])+'</span></div>').join(''), v2: !h.actual_ship_date?' text-warning':'', v3: h.actual_ship_date?esc(fmtDate(h.actual_ship_date)):t("app.998", "\u5f85\u8865\u5145"), v4: canEdit?'<div class="detail-item" style="grid-column:1/-1"><button class="btn btn-secondary btn-sm" onclick="editActualShipDate(\'historical\',\''+h.id+'\',\''+(h.actual_ship_date||'')+t('gen.L5822.19','\')">补充/更正实际出货日期</button></div>'):'', v5: attachSection}),t('modal.footer.viewHistoricalCI', '{v1}{v2}<button class="btn btn-secondary" onclick="closeModal()">关闭</button>', {v1: back, v2: hasPermission('payment_view')?'<button class="btn btn-primary" onclick="viewPayment(\''+h.payment_request_id+t('gen.L5822.20','\')">付款与结算</button>'):''}))
  }catch(e){showToast(e.message,'danger')}
}
function parseHistoricalAttachments(val){ if(!val)return[]; try{ const v=typeof val==='string'?JSON.parse(val):val; return Array.isArray(v)?v:(v&&typeof v==='object'?[v]:[]); }catch(e){ return []; } }
const HCI_ATTACH_LABELS={ci_document:t("app.991", "\u539f\u59cb CI"),payment_proof:t("app.992", "\u5386\u53f2\u4ed8\u6b3e\u51ed\u8bc1"),statement:t("app.993", "\u5bf9\u8d26\u5355"),terms_proof:t("app.994", "\u8d26\u671f\u8bc1\u660e"),other:t("app.995", "\u5176\u4ed6\u8bf4\u660e")};
function fmtAttachSize(bytes){ const b=Number(bytes)||0; if(b<1024)return b+' B'; if(b<1024*1024)return (b/1024).toFixed(1)+' KB'; return (b/1024/1024).toFixed(2)+' MB'; }
function historicalAttachmentListHtml(list,canEdit){ const active=(list||[]).filter(a=>!a.deleted); if(!active.length)return t('gen.L5828.1','<div class="empty-state" style="padding:12px">暂无附件</div>'); return t('gen.L5828.2','<table class="data-table" style="box-shadow:none"><thead><tr><th>类型</th><th>文件名</th><th>大小</th><th>上传人</th><th>上传时间</th><th>操作</th></tr></thead><tbody>')+active.map((a,i)=>'<tr><td>'+(HCI_ATTACH_LABELS[a.category]||a.category||t('gen.L5828.3','其他'))+'</td><td class="cell-id">'+esc(a.name||t("app.999", "\u672a\u547d\u540d"))+'</td><td>'+fmtAttachSize(a.size)+'</td><td>'+esc(a.uploaded_by_name||a.uploaded_by||'—')+'</td><td>'+esc(a.uploaded_at||'—')+t('gen.L5828.4','</td><td class="cell-actions"><button class="action-btn" title="下载" onclick="downloadHistoricalAttachment(')+i+')">⬇️</button>'+(canEdit?t('gen.L5828.5','<button class="action-btn" title="删除" onclick="deleteHistoricalAttachment(')+i+')">🗑️</button>':'')+'</td></tr>').join('')+'</tbody></table>'; }
async function uploadHistoricalAttachment(){ try{ const id=window._hciCurrentId; if(!id)return; const typeSel=document.getElementById('hci-att-type'); const category=typeSel?typeSel.value:'other'; const inp=document.createElement('input'); inp.type='file'; inp.accept='.pdf,.xls,.xlsx,.doc,.docx,.jpg,.jpeg,.png,.webp'; inp.onchange=()=>{ const f=inp.files[0]; if(!f)return; const r=new FileReader(); r.onload=async e=>{ try{ await api('/api/historical-commercial-invoices/'+id+'/attachment','POST',{attachment:{name:f.name,type:f.type,size:f.size,dataUrl:e.target.result,category}}); showToast(t('gen.L5829.1','附件已上传'),'success'); viewHistoricalCI(id); }catch(err){ showToast(err.message,'danger'); } }; r.readAsDataURL(f); }; inp.click(); }catch(e){ showToast(e.message,'danger'); } }
async function downloadHistoricalAttachment(index){ try{ const id=window._hciCurrentId; if(!id)return; const h=await api('/api/historical-commercial-invoices/'+id); const active=parseHistoricalAttachments(h.attachment).filter(a=>!a.deleted); const a=active[index]; if(!a||!a.dataUrl){ showToast(t('gen.L5830.1','附件不存在'),'warning'); return; } const link=document.createElement('a'); link.href=a.dataUrl; link.download=a.name||t('gen.L5830.2','附件'); link.click(); }catch(e){ showToast(e.message,'danger'); } }
async function deleteHistoricalAttachment(index){ try{ const id=window._hciCurrentId; if(!id)return; const h=await api('/api/historical-commercial-invoices/'+id); const list=parseHistoricalAttachments(h.attachment); const active=list.filter(a=>!a.deleted); const target=active[index]; if(!target)return; const realIdx=list.indexOf(target); await api('/api/historical-commercial-invoices/'+id+'/attachment/'+realIdx+'/delete','POST',{}); showToast(t('gen.L5831.1','附件已删除（软删除）'),'success'); viewHistoricalCI(id); }catch(e){ showToast(e.message,'danger'); } }
async function viewCI(id, backPay, backMode){
  try{const ci=await api('/api/commercial-invoices/'+id);
    const pl=ci.packing_list||{};const plItems=pl.items||[];
    // 若来自付款申请详情，提供【← 返回付款申请详情】入口，保留原上下文（含 mode）
    const ciBackFooter=backPay?'<button class="btn btn-secondary" onclick="viewPayment(\''+backPay+'\',\''+(backMode||'view')+t('gen.L5836.1','\')">← 返回付款申请详情</button><button class="btn btn-secondary" onclick="closeModal()">关闭</button>'):'';
    openModal(t('modal.title.viewCI', 'CI/PL详情 - {v1}', {v1: ci.ci_no}),t('modal.body.viewCI', '<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>'+t('section.basic_info','基本信息')+'</h3><div class="detail-grid">{v1}<div class="detail-item"><span class="detail-label">实际出货日期</span><span class="detail-value{v2}">{v3}</span></div>{v4}{v5}{v6}</div></div><div class="detail-section"><h3>'+t('section.ci_items','CI明细')+'</h3><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>数量</th><th>单价</th><th>金额</th><th>实际关税税率(%)</th><th>已入库</th><th>未入库</th></tr></thead><tbody>{v7}</tbody></table></div></div><div class="detail-section"><h3>'+t('section.pl_items','PL明细')+'</h3>{v8}</div><div class="detail-section"><h3>'+t('section.ci_pl_diff','CI vs PL 数量核对')+'</h3><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>CI数量</th><th>PL数量</th><th>差异</th></tr></thead><tbody>{v9}</tbody></table></div></div></div>', {v1: (function(fields){
      var labels={ci_no:t('field.ci_no'),related_po_no:t('field.related_po_no'),related_pi_no:t('field.related_pi_no'),supplier_name:t('field.supplier_name'),brand:t('field.brand'),country:t('field.country'),target_warehouse:t('field.target_warehouse'),ci_date:t('field.ci_date'),currency:t('field.currency'),goods_amount:t('field.goods_amount'),pi_total_amount:t('ci.detail.pi_total','PI总金额'),amount_difference:t('ci.detail.amount_diff','金额差异'),difference_reason:t('ci.detail.diff_reason','差异原因'),actual_deducted_deposit:t('ci.detail.deposit','已抵扣定金'),payable_balance:t('ci.detail.balance','应付尾款'),transport_basis:t('ci.detail.transport','运输方式'),import_duty_total:t('ci.detail.duty','进口关税'),ci_status:t('field.ci_status'),balance_payment_status:t('ci.detail.bal_status','尾款付款状态')};
      var buf='';fields.forEach(function(f){
        var v;if(f==='related_pi_no'){var pns=[];try{pns=JSON.parse(ci.related_pi_nos||'[]');}catch(e){}if(pns.length===0&&ci.related_pi_no)pns=[ci.related_pi_no];v=pns.length>0?pns.map(esc).join('<br>'):'—';}
        else v=esc(ci[f]);
        buf+='<div class=\"detail-item\"><span class=\"detail-label\">'+(labels[f]||f)+'</span><span class=\"detail-value\">'+v+'</span></div>';
      });return buf;
    })(ci._v1fields||['ci_no','related_po_no','related_pi_no','supplier_name','brand','country','target_warehouse','ci_date','currency','goods_amount','pi_total_amount','amount_difference','difference_reason','actual_deducted_deposit','payable_balance','transport_basis','import_duty_total','ci_status','balance_payment_status']), v2: !ci.actual_ship_date?' text-warning':'', v3: ci.actual_ship_date?esc(fmtDate(ci.actual_ship_date)):t("app.998", "\u5f85\u8865\u5145"), v4: hasPermission('ci_edit')?'<div class="detail-item" style="grid-column:1/-1"><button class="btn btn-secondary btn-sm" onclick="editActualShipDate(\'commercial\',\''+ci.id+'\',\''+(ci.actual_ship_date||'')+t('gen.L5837.1','\')">补充/更正实际出货日期</button></div>'):'', v5: attachmentHtml('ci',ci.id,'attachment',ci.attachment,t("ci.003", "CI\u9644\u4ef6")), v6: attachmentHtml('ci',ci.id,'pl_attachment',ci.pl_attachment,t("ci.004", "PL\u9644\u4ef6")), v7: (ci.items||[]).map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.shipped_qty+'</td><td class="text-right">'+fmtMoney(i.unit_price)+'</td><td class="text-right">'+fmtMoney(i.ci_amount)+'</td><td class="text-right">'+(i.actual_customs_rate===null||i.actual_customs_rate===''?'—':esc(i.actual_customs_rate))+'</td><td class="text-right">'+(i.inbound_qty||0)+'</td><td class="text-right">'+(i.uninbound_qty||0)+'</td></tr>').join(''), v8: plItems.length?t('gen.L5837.2','<div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>每箱数量</th><th>箱数</th><th>总数量</th><th>总毛重</th><th>总净重</th><th>总体积</th></tr></thead><tbody>')+plItems.map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.qty_per_carton+'</td><td class="text-right">'+i.cartons+'</td><td class="text-right">'+i.total_qty+'</td><td class="text-right">'+i.gross_weight+'</td><td class="text-right">'+i.net_weight+'</td><td class="text-right">'+i.cbm+'</td></tr>').join('')+'</tbody></table></div>':t('gen.L5837.3','<div class="empty-state"><div class="empty-icon">📦</div>暂无PL明细</div>'), v9: (ci.pl_check||[]).map(r=>'<tr><td class="cell-id">'+esc(r.sku_code)+'</td><td class="text-right">'+r.ci_qty+'</td><td class="text-right">'+r.pl_qty+'</td><td class="text-right '+(r.diff_qty!==0?'text-danger':'')+'">'+r.diff_qty+'</td></tr>').join('')}),ciBackFooter);
    // PUR-OPS-COLLAB-01：注入上架准备分区（DOM 注入，避免改动上方大字符串）
    let opsState=null; try{ opsState=await api('/api/commercial-invoices/'+id+'/ops-prep'); }catch(e){ opsState=null; }
    let opsCands=[]; try{ opsCands=await api('/api/cc-candidates'); }catch(e){ opsCands=[]; }
    const opsMb=document.querySelector('#modal-content .modal-body');
    if(opsMb) opsMb.insertAdjacentHTML('beforeend', renderOpsPrepSection(ci.id, opsState, opsCands));
  }catch(e){showToast(e.message,'danger')}
}
// ==================== PUR-OPS-COLLAB-01：电商运营上架准备（V1）前端 ====================
// 仅展示/编辑：负责人、抄送(CC)、计划上架日期、就绪(Ready)状态；不含图片/Listing/广告/活动。
function renderOpsPrepSection(ciId, opsState, opsCands){
  if(!opsState) return t('gen.L5848.1','<div class="detail-section"><h3>上架准备（电商运营）</h3><div class="empty-state" style="padding:12px">无法读取上架准备状态。</div></div>');
  if(opsState.wac_confirmed !== true){
    return t('gen.L5850.1','<div class="detail-section"><h3>上架准备（电商运营）</h3><div style="font-size:13px;color:#fa8c16;background:#fff7e6;border:1px solid #ffd591;border-radius:6px;padding:10px">CI 尚未完成成本确认（wac_confirmed=1），上架准备将在确认后开启。</div></div>');
  }
  const canEdit = hasPermission('ci_edit');
  const ownerId = opsState.ops_owner_id || '';
  const ownerName = opsState.ops_owner_name || '';
  const planDate = opsState.ops_plan_listing_date || '';
  const ready = opsState.ops_ready_status === 'ready';
  const ccList = opsState.cc || [];
  const isOwner = !!(ownerId && currentUser && currentUser.id === ownerId);
  const isAdmin = hasPermission('*');
  const canSetReady = canEdit && (isOwner || isAdmin) && !!ownerId;
  const cands = opsCands || [];

  if(!canEdit){
    // 只读：仅展示当前状态
    let html = t('gen.L5865.1','<div class="detail-section" id="ops-prep-section"><h3>上架准备（电商运营）</h3>');
    html += '<div class="detail-grid">';
    html += t('gen.L5867.1','<div class="detail-item"><span class="detail-label">负责人</span><span class="detail-value">')+(ownerName||ownerId||t("app.199", "\u672a\u5206\u914d"))+'</span></div>';
    html += t('gen.L5868.1','<div class="detail-item"><span class="detail-label">计划上架日期</span><span class="detail-value">')+(planDate||t("app.1002", "\u5f85\u5b9a"))+'</span></div>';
    html += t('gen.L5869.1','<div class="detail-item"><span class="detail-label">就绪状态</span><span class="detail-value">')+(ready?'<span class="badge badge-success">Ready</span>':'<span class="badge badge-warning">Pending</span>')+'</span></div>';
    html += '</div>';
    html += t('gen.L5871.1','<div class="detail-item" style="grid-column:1/-1"><span class="detail-label">抄送(CC)</span><span class="detail-value">')+(ccList.length?ccList.map(c=>esc(c.user_name)).join('、'):t('gen.L5871.2','无'))+'</span></div>';
    if(ready) html += t('gen.L5872.1','<div style="margin-top:8px;font-size:13px;color:#52c41a;background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:8px">✔ 上架准备已完成（Ready），可安排上架。</div>');
    html += '</div>';
    return html;
  }

  // 可编辑
  const ownerOpts = t('gen.L5878.1','<option value="">未分配</option>') + cands.map(u=>'<option value="'+u.id+'"'+(u.id===ownerId?' selected':'')+'>'+esc(u.name)+'（'+esc(formatRoleLabel(u.role_id, u.role_name))+'）</option>').join('');
  const ccChecks = cands.length ? cands.map(u=>{
    const chk = ccList.some(c=>c.user_id===u.id) ? ' checked' : '';
    return '<label class="cc-check"><input type="checkbox" class="ops-cc-cb" value="'+u.id+'"'+chk+'> '+esc(u.name)+'</label>';
  }).join('') : t('gen.L5882.1','<span class="empty-state">无可选项</span>');

  let html = t('gen.L5884.1','<div class="detail-section" id="ops-prep-section"><h3>上架准备（电商运营）</h3>');
  html += t('gen.L5885.1','<div style="font-size:12px;color:#999;margin-bottom:8px">仅管理负责人、抄送、计划上架日期与就绪状态；不含图片、Listing、广告或活动。</div>');
  html += '<div class="form-grid" id="ops-prep-form">';
  html += t('gen.L5887.1','<div class="form-group"><label>负责人 <span class="required">*</span></label><select id="ops-owner" class="form-control">')+ownerOpts+'</select></div>';
  html += t('gen.L5888.1','<div class="form-group"><label>计划上架日期</label><input type="date" id="ops-plan-date" class="form-control" value="')+planDate+'"></div>';
  html += t('gen.L5889.1','<div class="form-group" style="grid-column:1/-1"><label>抄送(CC)</label><div class="cc-list" id="ops-cc-list">')+ccChecks+'</div></div>';
  html += '</div>';
  html += '<div class="ops-prep-actions" style="margin-top:8px">';
  html += '<button class="btn btn-primary btn-sm" onclick="saveOpsPrep(\''+ciId+t('gen.L5892.1','\')">保存上架准备</button> ');
  if(canSetReady) html += '<button class="btn btn-success btn-sm" onclick="setOpsReady(\''+ciId+t('gen.L5893.1','\')">标记上架准备完成（Ready）</button>');
  html += '</div>';
  if(ready) html += t('gen.L5895.1','<div style="margin-top:8px;font-size:13px;color:#52c41a;background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:8px">✔ 上架准备已完成（Ready），可安排上架。</div>');
  html += '</div>';
  return html;
}
async function saveOpsPrep(ciId){
  try{
    const owner = (document.getElementById('ops-owner')||{}).value || '';
    const planDate = (document.getElementById('ops-plan-date')||{}).value || '';
    const ccs = Array.from(document.querySelectorAll('.ops-cc-cb')).filter(cb=>cb.checked).map(cb=>cb.value);
    if(!owner){ showToast(t('gen.L5904.1','请选择负责人'),'warning'); return; }
    await api('/api/commercial-invoices/'+ciId+'/ops-prep','POST',{ owner_user_id: owner, cc_user_ids: ccs, plan_listing_date: planDate });
    showToast(t('gen.L5906.1','上架准备已保存'),'success');
    await refreshOpsPrep(ciId);
  }catch(e){ showToast(e.message,'danger'); }
}
async function setOpsReady(ciId){
  try{
    await api('/api/commercial-invoices/'+ciId+'/ops-ready','POST',{});
    showToast(t('gen.L5913.1','已标记上架准备完成（Ready）'),'success');
    await refreshOpsPrep(ciId);
  }catch(e){ showToast(e.message,'danger'); }
}
async function refreshOpsPrep(ciId){
  try{
    const opsState = await api('/api/commercial-invoices/'+ciId+'/ops-prep');
    const opsCands = await api('/api/cc-candidates');
    const container = document.getElementById('ops-prep-section');
    if(container) container.outerHTML = renderOpsPrepSection(ciId, opsState, opsCands);
  }catch(e){ showToast(e.message,'danger'); }
}
async function createCI(){
  openModal(t('ci.new_ci','新建 CI'),
    '<div style="display:flex;gap:16px;justify-content:center;padding:24px">'+
    '<button class="btn btn-primary" style="font-size:16px;padding:16px 28px;min-width:160px" onclick="closeModal();createOperationalCI()">🚚 '+t('ci.type.op','运营 CI')+'</button>'+
    '<button class="btn btn-secondary" style="font-size:16px;padding:16px 28px;min-width:160px" onclick="closeModal();createHistoricalCI()">📚 '+t('ci.type.hist','历史 CI')+'</button>'+
    '</div>'+
    '<div style="text-align:center;color:#888;font-size:13px;margin-top:12px">'+t('ci.type.hint','运营 CI 可关联多个 PI；历史 CI 仅用于历史采购金额管理')+'</div>',
    '<button class="btn btn-secondary" onclick="closeModal()">'+t('app.cancel','取消')+'</button>'
  );
}
async function createOperationalCI(){
  try{
    var results=await Promise.all([api('/api/proforma-invoices'),api('/api/suppliers'),api('/api/payment-term-options')]);
    var pis=results[0],suppliers=results[1].filter(function(s){return s.status==='active';}),termOpts=results[2]||[];
    // Filter available PIs — use PI-level aggregates; list endpoint does NOT return items array
    var avlPiMap={};
    var EPSILON=0.001;
    pis.forEach(function(p){
      var remainQty=(p.confirmed_qty_sum||0)-(p.shipped_qty_sum||0);
      if(remainQty>EPSILON && (p.need_deposit!==1||p.deposit_payment_status==='paid')){
        avlPiMap[p.id]=p;
      }
    });
    window._availPiMap=avlPiMap;
    window._allPis=Array.from(Object.values(avlPiMap));

    var body='<div class="form-card" style="box-shadow:none;padding:0">';
    // Row 1: CI No + Supplier
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.ci_no','CI 编号')+'</label><input id="nci-no" placeholder="'+t('ci.no.auto','留空自动生成')+'"><div style="font-size:11px;color:#999">'+t('ci.no.hint','留空则自动生成；填写需唯一')+'</div></div>';
    body+='<div class="form-group"><label>'+t('field.supplier_name','供应商')+' <span class="required">*</span></label><select id="nci-supplier" onchange="onCISupplierChange()"><option value="">'+t('ci.select_supplier_first','请先选择供应商')+'</option>';
    suppliers.forEach(function(s){
      var count=window._allPis.filter(function(p){return p.supplier_id===s.id;}).length;
      body+='<option value="'+s.id+'" data-name="'+esc(s.name)+'">'+esc(s.name)+'</option>';
    });
    body+='</select></div></div>';
    // Row 2: PI dropdown multi-select
    body+='<h4 style="margin:12px 0 8px">'+t('ci.select_pi','选择关联 PI')+' <span style="font-size:12px;color:#ff4d4f">（同供应商+同币种）</span></h4>';
    body+='<div class="form-group" style="position:relative;margin-bottom:12px">';
    body+='<div id="nci-pi-trigger" onclick="toggleNciPiDropdown()" style="padding:8px 12px;border:1px solid #d9d9d9;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;min-height:38px;background:#fff;user-select:none">';
    body+='<span id="nci-pi-trigger-text" style="font-size:13px;color:#999">'+t('ci.select_supplier_first_hint','请先选择供应商')+'</span>';
    body+='<span style="font-size:11px;color:#999">▼</span></div>';
    body+='<div id="nci-pi-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;max-height:240px;overflow-y:auto;border:1px solid #d9d9d9;border-radius:6px;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.1);margin-top:2px">';
    body+='<div style="padding:12px;font-size:13px;color:#999">'+t('ci.select_supplier_first_hint','请先选择供应商')+'</div></div></div>';
    // Row 3: Currency + Ship date + Batch
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.currency','币种')+' <span class="required">*</span></label><input id="nci-cur" readonly style="background:#f5f5f5" placeholder="'+t('ci.currency_auto','选择PI后自动填入')+'"></div>';
    body+='<div class="form-group"><label>'+t('field.ci_date','CI日期')+' <span class="required">*</span></label><input type="date" id="nci-date"></div>';
    body+='<div class="form-group"><label>'+t('field.actual_ship_date','实际出货日期')+' <span class="required">*</span></label><input type="date" id="nci-ship-date"></div>';
    body+='<div class="form-group"><label>'+t('field.shipment_batch','发货批次')+'</label><input type="number" id="nci-batch" value="1"></div></div>';
    // Row 4: Payment terms
    body+='<div class="form-group" style="margin-top:10px"><label>'+t('field.payment_terms','付款条件')+'</label><select id="nci-payment-terms"><option value="">'+t('app.none','无')+'</option>';
    termOpts.forEach(function(tm){body+='<option value="'+esc(tm.name)+'"'+(tm.credit_days>0?' data-credit="'+tm.credit_days+'"':'')+'>'+esc(tm.name)+(tm.credit_days>0?' ('+tm.credit_days+t('unit.days','天')+')':'')+' ('+(tm.source==='supplier'?t('ci.term.supplier','供应商'):t('ci.term.global','全局'))+')</option>';});
    body+='</select></div>';
    // Items section
    body+='<h4 style="margin:16px 0 8px">'+t('section.ci_items','CI 明细')+'</h4>';
    body+='<div id="ci-items-preview" style="font-size:12px;color:#999;padding:8px;border:1px dashed #ddd;border-radius:6px">'+t('ci.select_pi_first','请先选择供应��和PI')+'</div>';
    body+='<div id="ci-items-summary" style="display:none;margin-top:8px;padding:8px 12px;background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;font-size:13px"></div>';
    body+='</div>';
    openModal(t('ci.new_op_ci','新建运营 CI'),body,
      '<button class="btn btn-secondary" onclick="closeModal()">'+t('app.cancel','取消')+'</button>'+
      '<button class="btn btn-primary" id="nci-save-btn" onclick="saveNewCI()">'+t('app.create','创建')+'</button>','modal-ci-create');
    window._ciR=0;window._ciAllItems=[];window._ciSelectedPiIds={};window._allTermOpts=termOpts;
  if(!window._nciPiDocListener){window._nciPiDocListener=true;document.addEventListener('click',function(e){if(!e.target.closest('#nci-pi-trigger')&&!e.target.closest('#nci-pi-dropdown')){closeNciPiDropdown();}});}
  }catch(e){showToast(e.message,'danger')}
}
// ── Supplier-first: filter PI list ──
function onCISupplierChange(){
  var sel=document.getElementById('nci-supplier'),list=document.getElementById('nci-pi-dropdown'),cur=document.getElementById('nci-cur'),preview=document.getElementById('ci-items-preview'),summary=document.getElementById('ci-items-summary');
  if(!list||!sel)return;
  var supId=sel.value;
  // Clear currency + items
  if(cur)cur.value='';
  if(preview)preview.innerHTML='<div style="padding:12px;color:#999">'+t('ci.select_pi_first','请先选择供应商和PI')+'</div>';
  if(summary)summary.style.display='none';
  window._ciAllItems=[];window._ciR=0;window._ciSelectedPiIds={};
  if(!supId){list.innerHTML='<div class="empty-state" style="padding:12px;font-size:13px;color:#999">'+t('ci.select_supplier_first_hint','请先选择供应商')+'</div>';updateNciPiTriggerText();return;}
  // Filter PIs for this supplier
  var supPis=window._allPis.filter(function(p){return p.supplier_id===supId;});
  if(supPis.length===0){list.innerHTML='<div class="empty-state" style="padding:12px;font-size:13px;color:#999">'+t('ci.no_pi_for_supplier','该供应商无可选PI')+'</div>';onCIPaymentTermsFilter(supId);updateNciPiTriggerText();return;}
  // ── Filter payment terms by supplier ──
  onCIPaymentTermsFilter(supId);
  // Group by currency
  var curMap={};
  supPis.forEach(function(p){var k=p.currency||'?';if(!curMap[k])curMap[k]=[];curMap[k].push(p);});
  var html='';
  Object.keys(curMap).sort().forEach(function(curKey){
    var g=curMap[curKey];
    g.forEach(function(p){
      var remain=(p.confirmed_qty_sum||0)-(p.shipped_qty_sum||0);
      html+='<label class="nci-pi-item" style="display:block;padding:10px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;margin:0;transition:background .15s" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'#fff\'">';
      html+='<div style="display:flex;align-items:center;gap:8px">';
      html+='<input type="checkbox" class="nci-pi-cb" value="'+p.id+'" data-no="'+esc(p.pi_no)+'" data-supid="'+p.supplier_id+'" data-cur="'+p.currency+'" data-supname="'+esc(p.supplier_name)+'" onchange="onCIPISelectionChange()" style="flex-shrink:0;width:16px;height:16px">';
      html+='<span style="font-size:13px;font-weight:500;color:#333;white-space:nowrap">'+esc(p.pi_no)+'</span>';
      html+='</div>';
      html+='<div style="font-size:12px;color:#888;margin-top:4px;padding-left:24px">'+t('ci.pi.remain','剩余可出货：')+remain+' '+t('unit.pcs','件')+'</div>';
      html+='</label>';
    });
  });
  list.innerHTML=html;
  updateNciPiTriggerText();
}
async function onCIPaymentTermsFilter(supId){
  var tmSel=document.getElementById('nci-payment-terms');
  if(!tmSel||!supId)return;
  var savedVal=tmSel.value;
  // Fetch supplier-specific terms and global fallback
  var supTerms=[],globalTerms=window._allTermOpts||[];
  try{
    supTerms=await api('/api/suppliers/'+supId+'/payment-terms');
  }catch(e){supTerms=[];}
  // Global terms as fallback
  var globalOnly=globalTerms.filter(function(g){return g.source==='global';}).map(function(g){return{name:g.name,credit_days:g.credit_days||0,source:'global'};});
  // Supplier terms take priority
  var displayTerms=supTerms&&supTerms.length>0?supTerms.map(function(t){return{name:t.term_name,credit_days:t.credit_days||0,source:'supplier',is_default:t.is_default};}):[];
  // If supplier has terms, show them; otherwise show global only
  if(displayTerms.length===0)displayTerms=globalOnly;
  // Rebuild select
  tmSel.innerHTML='<option value="">'+t('app.none','无')+'</option>';
  if(displayTerms.length>0){
    displayTerms.forEach(function(tm){
      tmSel.innerHTML+='<option value="'+esc(tm.name)+'"'+(tm.credit_days>0?' data-credit="'+tm.credit_days+'"':'')+(tm.is_default?' selected':'')+'>'+esc(tm.name)+(tm.credit_days>0?' ('+tm.credit_days+t('unit.days','天')+')':'')+' ('+(tm.source==='supplier'?t('ci.term.supplier','供应商'):t('ci.term.global','全局'))+')</option>';
    });
  }
  // Restore saved value if still present
  if(savedVal){
    var found=false;
    for(var i=0;i<tmSel.options.length;i++){if(tmSel.options[i].value===savedVal){found=true;break;}}
    if(found)tmSel.value=savedVal;
  }
}
function onCIPISelectionChange(){
  var cbs=document.querySelectorAll('.nci-pi-cb:checked'),selSup=null,selCur=null;
  // Lock to first selected PI's supplier+currency
  cbs.forEach(function(cb){if(!selSup){selSup=cb.dataset.supid;selCur=cb.dataset.cur;}});
  document.querySelectorAll('.nci-pi-cb:not(:checked)').forEach(function(cb){
    var dis=(selSup&&(cb.dataset.supid!==selSup||cb.dataset.cur!==selCur));
    cb.disabled=dis;var lb=cb.closest('.pi-check');if(lb)lb.style.opacity=dis?'0.4':'1';
  });
  // Auto-fill currency
  if(cbs.length>0){
    document.getElementById('nci-cur').value=selCur||'';
  }else{
    document.getElementById('nci-cur').value='';
  }
  // Delta refresh: only add/remove changed PIs
  var newIds={};cbs.forEach(function(cb){newIds[cb.value]=true;});
  var oldIds=window._ciSelectedPiIds||{};
  var added=[],removed=[];
  Object.keys(newIds).forEach(function(id){if(!oldIds[id])added.push(id);});
  Object.keys(oldIds).forEach(function(id){if(!newIds[id])removed.push(id);});
  window._ciSelectedPiIds=newIds;
  if(added.length>0||removed.length>0){
    loadMultiPIItems(added,removed);
  }
  updateNciPiTriggerText();
  closeNciPiDropdown();
}
async function loadMultiPIItems(addedPiIds,removedPiIds){
  var preview=document.getElementById('ci-items-preview'),summary=document.getElementById('ci-items-summary');
  if(!preview)return;

  // Handle full reset (no delta args — caller wants full refresh)
  var isFull=!addedPiIds&&!removedPiIds;
  if(isFull){
    var cbs=document.querySelectorAll('.nci-pi-cb:checked');
    if(cbs.length===0){preview.innerHTML='<div style="padding:12px;color:#999">'+t('ci.select_pi_first','请先选择供应商和PI')+'</div>';if(summary)summary.style.display='none';window._ciAllItems=[];window._ciR=0;return;}
    addedPiIds=[];cbs.forEach(function(cb){addedPiIds.push(cb.value);});
  }

  // Remove items for unchecked PIs
  if(removedPiIds&&removedPiIds.length>0){
    var removedSet={};removedPiIds.forEach(function(id){removedSet[id]=true;});
    window._ciAllItems=(window._ciAllItems||[]).filter(function(it){return !removedSet[it.pi_id];});
    // Re-index
    window._ciAllItems.forEach(function(it,i){it.idx=i;});
    window._ciR=window._ciAllItems.length;
    // Remove DOM rows
    removedPiIds.forEach(function(piId){
      var rows=preview.querySelectorAll('[data-pi-id="'+piId+'"]');
      rows.forEach(function(r){r.remove();});
    });
  }

  // Fetch and add items for newly checked PIs
  if(addedPiIds&&addedPiIds.length>0){
    var curR=window._ciR||0;
    for(var i=0;i<addedPiIds.length;i++){
      try{
        var pi=window._availPiMap&&window._availPiMap[addedPiIds[i]];
        // _availPiMap comes from list endpoint (no items), so always fetch single PI for item details
        if(!pi||!pi.items||pi.items.length===0){try{pi=await api('/api/proforma-invoices/'+addedPiIds[i]);}catch(e){continue;}}
        (pi.items||[]).forEach(function(it){
          if((it.unshipped_qty||0)>0){
            window._ciAllItems=(window._ciAllItems||[]);
            window._ciAllItems.push({pi_id:pi.id,pi_no:pi.pi_no,sku_code:it.sku_code,pi_confirmed_qty:it.pi_confirmed_qty||0,shipped_qty:it.shipped_qty||0,unshipped_qty:it.unshipped_qty,unit_price:it.unit_price,reference_customs_rate:it.reference_customs_rate,idx:curR++,currency:pi.currency});
          }
        });
      }catch(e){}
    }
    window._ciR=curR;
  }

  var allItems=window._ciAllItems||[];
  if(allItems.length===0){
    preview.innerHTML='<div style="padding:12px;color:#999">'+t('ci.select_pi_first','请先选择供应商和PI')+'</div>';
    if(summary)summary.style.display='none';
    return;
  }

  // ── Build 6-column table ──
  var tbodyHtml='';var isNewTable=!preview.querySelector('table');
  if(isNewTable){
    // Full table build
    var headHtml='<table class="data-table" style="margin:0;font-size:12px"><thead><tr>'+
      '<th>SKU</th><th>'+t('ci.col.pi_source','PI来源')+'</th><th style="text-align:right">'+t('ci.col.pi_confirmed','PI总数量')+'</th>'+
      '<th style="text-align:right">'+t('ci.col.pi_shipped','已出货')+'</th><th style="text-align:right">'+t('ci.col.pi_unshipped','未出货')+'</th>'+
      '<th style="text-align:right">'+t('ci.col.ci_qty','本次CI数量')+'</th><th style="text-align:right">'+t('field.unit_price','单价')+'</th>'+
      '<th style="text-align:right">'+t('ci.col.amount','金额')+'</th><th style="width:36px">'+t('app.operation','操作')+'</th></tr></thead><tbody>';
    allItems.forEach(function(it){
      tbodyHtml+=buildCIItemRow(it,allItems);
    });
    tbodyHtml+='</tbody></table>';
    preview.innerHTML=headHtml+tbodyHtml;
  }else{
    // Append only new items (those without existing DOM rows)
    var tbody=preview.querySelector('tbody');
    if(tbody){
      allItems.forEach(function(it){
        if(!document.getElementById('ci-r-'+it.idx)){
          tbody.insertAdjacentHTML('beforeend',buildCIItemRow(it,allItems));
        }
      });
    }
  }

  // ── Realtime summary ──
  updateCISummary();
}

// Helper: build one CI item row (6 cols)
function buildCIItemRow(it,allItems){
  var refRate=it.reference_customs_rate!=null&&it.reference_customs_rate!==undefined?it.reference_customs_rate:'';
  var cQty=it.pi_confirmed_qty||0, sQty=it.shipped_qty||0, uQty=it.unshipped_qty||0;
  return '<tr id="ci-r-'+it.idx+'" data-pi-id="'+it.pi_id+'">'+
    '<td class="cell-id">'+esc(it.sku_code)+'</td>'+
    '<td style="font-size:12px;color:#888">'+esc(it.pi_no)+'</td>'+
    '<td style="text-align:right;color:#888">'+cQty+'</td>'+
    '<td style="text-align:right;color:#888">'+sQty+'</td>'+
    '<td style="text-align:right;color:#888">'+uQty+'</td>'+
    '<td><input type="number" id="ci-rq-'+it.idx+'" value="'+uQty+'" style="width:70px;text-align:right" min="0" max="'+uQty+'" onchange="updateCISummary()" oninput="updateCISummary()"></td>'+
    '<td><input type="number" step="0.01" id="ci-rp-'+it.idx+'" value="'+it.unit_price+'" style="width:80px;text-align:right" onchange="updateCISummary()" oninput="updateCISummary()"></td>'+
    '<td style="text-align:right;font-weight:bold" id="ci-ra-'+it.idx+'">'+fmtMoney(uQty*it.unit_price)+'</td>'+
    '<td style="text-align:center"><button onclick="deleteCIRow('+it.idx+')" style="color:#bbb;border:none;background:none;cursor:pointer;font-size:13px;line-height:1;padding:2px 4px" title="'+t('common.delete','删除')+'">×</button></td>'+
    '<input type="hidden" id="ci-rr-'+it.idx+'" value="'+refRate+'">'+
    '</tr>';
}

// Helper: real-time total summary
function updateCISummary(){
  var summary=document.getElementById('ci-items-summary'),allItems=window._ciAllItems||[];
  if(!summary||allItems.length===0){if(summary)summary.style.display='none';return;}
  var totalQty=0,totalAmt=0;
  allItems.forEach(function(it){
    var qe=document.getElementById('ci-rq-'+it.idx),pe=document.getElementById('ci-rp-'+it.idx);
    var q=parseInt(qe?qe.value:0)||0,p=parseFloat(pe?pe.value:0)||0;
    if(q>0){totalQty+=q;totalAmt+=q*p;
      var ae=document.getElementById('ci-ra-'+it.idx);if(ae)ae.textContent=fmtMoney(q*p);}
  });
  summary.style.display='';
  var currency=(allItems[0]||{}).currency||'';
  summary.innerHTML='<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">'+
    '<span>'+t('ci.summary.qty','合计数量：{v1} 件',{v1:totalQty})+'</span>'+
    '<span style="font-weight:bold">'+t('ci.summary.amt','CI金额：{v1} {v2}',{v1:fmtMoney(totalAmt),v2:currency})+'</span>'+
    '</div>';
}

// ── Delete individual CI item row (user can remove SKUs not shipping this batch) ──
function deleteCIRow(idx){
  var allItems=window._ciAllItems||[];
  window._ciAllItems=allItems.filter(function(it){return it.idx!==idx;});
  var row=document.getElementById('ci-r-'+idx);
  if(row)row.remove();
  updateCISummary();
  if(window._ciAllItems.length===0){
    var preview=document.getElementById('ci-items-preview');
    if(preview)preview.innerHTML='<div style="padding:12px;color:#999">'+t('ci.select_pi_first','请先选择供应商和PI')+'</div>';
    var summary=document.getElementById('ci-items-summary');
    if(summary)summary.style.display='none';
  }
}

// ── PI dropdown multi-select ──
function toggleNciPiDropdown(){
  var dd=document.getElementById('nci-pi-dropdown');
  if(!dd)return;
  var isOpen=dd.style.display==='block';
  dd.style.display=isOpen?'none':'block';
}
function closeNciPiDropdown(e){
  var dd=document.getElementById('nci-pi-dropdown'),trig=document.getElementById('nci-pi-trigger');
  if(!dd)return;
  if(e&&trig&&trig.contains(e.target))return;
  dd.style.display='none';
}
function updateNciPiTriggerText(){
  var txt=document.getElementById('nci-pi-trigger-text');
  if(!txt)return;
  var cbs=document.querySelectorAll('.nci-pi-cb:checked');
  if(cbs.length===0){txt.textContent=t('ci.041','请选择PI');txt.style.color='#999';}
  else if(cbs.length===1){
    var no=cbs[0].dataset.no||'';txt.textContent=no;txt.style.color='#333';
  }else{txt.textContent=t('ci.042','{v1} PI已选择',{v1:cbs.length});txt.style.color='#333';}
}

async function saveNewCI(){
  var cbs=document.querySelectorAll('.nci-pi-cb:checked');
  if(cbs.length===0){showToast(t('ci.no_pi_sel','请至少选择一个 PI'),'warning');return;}
  var piIds=[],piNos=[];
  cbs.forEach(function(cb){piIds.push(cb.value);piNos.push(cb.dataset.no);});
  var sd=document.getElementById('nci-ship-date').value;
  if(!sd){showToast(t('ci.ship_date_req','请填写实际出货日期'),'warning');return;}
  var ciDate=(document.getElementById('nci-date')||{}).value||'';
  var items=[];
  var allItems=window._ciAllItems||[];
  for(var i=0;i<allItems.length;i++){
    var it=allItems[i];
    var qe=document.getElementById('ci-rq-'+it.idx),pe=document.getElementById('ci-rp-'+it.idx),re=document.getElementById('ci-rr-'+it.idx);
    if(!qe)continue;var q=parseInt(qe.value)||0;if(q<=0)continue;
    items.push({pi_id:it.pi_id,sku_code:it.sku_code,shipped_qty:q,unit_price:parseFloat(pe?pe.value:0)||0,actual_customs_rate:re&&re.value!==''?parseFloat(re.value):null});
  }
  if(items.length===0){showToast(t('ci.no_items','请至少添加一条出货明细'),'warning');return;}
  var ciNo=(document.getElementById('nci-no')||{}).value||'',supSel=document.getElementById('nci-supplier');
  var supName='',supId='';
  if(supSel&&supSel.value){var opt=supSel.options[supSel.selectedIndex];supId=supSel.value;supName=opt?opt.dataset.name||'':'';}
  var cur=document.getElementById('nci-cur').value,bat=parseInt(document.getElementById('nci-batch').value)||1;
  var payTerms=(document.getElementById('nci-payment-terms')||{}).value||'',tmSel=document.getElementById('nci-payment-terms');
  var creditDays=0;
  if(tmSel&&tmSel.value&&tmSel.selectedOptions[0]){var cd=tmSel.selectedOptions[0].dataset.credit;if(cd)creditDays=parseInt(cd)||0;}
  var d={ci_no:ciNo||undefined,related_pi_ids:piIds,related_pi_nos:piNos,supplier_name:supName,supplier_id:supId,currency:cur,ci_date:ciDate||undefined,actual_ship_date:sd,shipment_batch:bat,payment_terms:payTerms,credit_days:creditDays,items:items};
  var btn=document.getElementById('nci-save-btn');if(btn){btn.disabled=true;btn.textContent=t('app.creating','创建中...');}
  try{await api('/api/commercial-invoices','POST',d);showToast(t('ci.created','CI创建成功'),'success');closeModal();loadCI();}
  catch(e){showToast(e.message,'danger');if(btn){btn.disabled=false;btn.textContent=t('app.create','创建');}}
}

async function createBalPay(id){
  try{
    const ci=await api('/api/commercial-invoices/'+id);
    openModal(t('modal.title.createBalPay', '创建尾款付款申请 - {v1}', {v1: ci.ci_no}),
      t('modal.body.createBalPay', `<div class="form-card" style="box-shadow:none;padding:0"><div class="detail-grid mb-16"><div class="detail-item"><span class="detail-label">CI金额</span><span class="detail-value">{v1}</span></div><div class="detail-item"><span class="detail-label">已抵扣定金</span><span class="detail-value">{v2}</span></div><div class="detail-item"><span class="detail-label">应付尾款</span><span class="detail-value font-bold">{v3}</span></div></div><div class="form-grid"><div class="form-group"><label>是否抵扣</label><select id="bal-ded" onchange="document.getElementById('bal-ded-amt').disabled=this.value==='0'"><option value="0">否</option><option value="1">是</option></select></div><div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="bal-ded-amt" value="0" disabled></div><div class="form-group"><label>抵扣来源类型</label><select id="bal-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="quality_claim">质量索赔</option><option value="advance_payment">预付款抵扣</option><option value="other">其他</option></select></div><div class="form-group"><label>抵扣参考号</label><input type="text" id="bal-ded-ref"></div><div class="form-group form-group-full"><label>抵扣说明</label><textarea id="bal-ded-desc" rows="2"></textarea></div></div></div>`, {v1: fmtMoney(ci.goods_amount), v2: fmtMoney(ci.actual_deducted_deposit), v3: fmtMoney(ci.payable_balance)}),
      t('modal.footer.createBalPay', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveBalPay('{v1}')">创建</button>`, {v1: id}));
  }catch(e){showToast(e.message,'danger')}
}
async function saveBalPay(id){
  const d={ci_id:id,has_deduction:parseInt(document.getElementById('bal-ded').value),deduction_amount:parseFloat(document.getElementById('bal-ded-amt').value)||0,deduction_source_type:document.getElementById('bal-ded-type').value,deduction_source_desc:document.getElementById('bal-ded-desc').value,deduction_ref_no:document.getElementById('bal-ded-ref').value};
  try{await api('/api/payment-requests/from-ci-balance','POST',d);showToast(t('toast.balPayCreated','尾款付款申请已生成'),'success');closeModal()}catch(e){showToast(e.message,'danger')}
}
// CI费用管理入口
async function viewCICost(id){
  try{
    const summary=await api('/api/commercial-invoices/'+id+'/cost-summary');
    const ci=await api('/api/commercial-invoices/'+id);
    openModal(t('modal.title.viewCICost', 'CI费用管理 - {v1}', {v1: ci.ci_no}),
      t('modal.body.viewCICost', '<div class="form-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>费用标记</h3><div class="detail-grid"><div class="detail-item"><span class="detail-label">有关税</span><span class="detail-value">{v1}</span></div><div class="detail-item"><span class="detail-label">有商检费用</span><span class="detail-value">{v2}</span></div></div>{v3}</div><div class="detail-section"><h3>分摊输入快照</h3><div class="form-grid"><div class="form-group"><label>本票实际运输计费基础</label><select id="ci-cost-basis" {v4}><option value="">无运输类费用 / 未选择</option><option value="cbm" {v5}>CBM</option><option value="kg" {v6}>KG（PL总毛重）</option></select></div><div class="form-group"><label>CI Import Duty总金额</label><input type="number" min="0" step="0.01" id="ci-duty-total" value="{v7}" {v8}></div></div><div style="font-size:12px;color:#777;margin:8px 0">运输依据和实际税率均为本票快照，不会从运输方式或SKU主数据动态重算；费用确认后锁定。</div><div class="table-container" style="box-shadow:none"><table class="data-table"><thead><tr><th>SKU</th><th>CI实际金额</th><th>本票实际关税税率(%)</th></tr></thead><tbody>{v9}</tbody></table></div>{v10}</div><div class="detail-section"><h3>费用汇总</h3><div class="detail-grid"><div class="detail-item"><span class="detail-label">商品金额</span><span class="detail-value">{v11}</span></div><div class="detail-item"><span class="detail-label">到仓费用</span><span class="detail-value">{v12}</span></div><div class="detail-item"><span class="detail-label">关税</span><span class="detail-value">{v13}</span></div><div class="detail-item"><span class="detail-label">商检费用</span><span class="detail-value">{v14}</span></div><div class="detail-item"><span class="detail-label">落地成本总额</span><span class="detail-value font-bold">{v15}</span></div><div class="detail-item"><span class="detail-label">费用确认</span><span class="detail-value">{v16}</span></div><div class="detail-item"><span class="detail-label">费用分摊</span><span class="detail-value">{v17}</span></div><div class="detail-item"><span class="detail-label">原库存导入</span><span class="detail-value">{v18}</span></div></div></div>{v19}<div class="flex gap-8 mt-16">{v20}{v21}{v22}{v23}{v24}</div></div>', {v1: summary.has_customs_duty?t('gen.L5956.1','✅ 是'):t("ci.012", "\u274c \u5426"), v2: summary.has_inspection_fee?t('gen.L5956.2','✅ 是'):t("ci.012", "\u274c \u5426"), v3: hasPermission('ci_edit')?'<div class="flex gap-8 mt-16"><button class="btn btn-secondary btn-sm" onclick="toggleCiCostFlag(\''+id+'\','+(summary.has_customs_duty?0:1)+t('gen.L5956.3',',null)">切换关税标记</button><button class="btn btn-secondary btn-sm" onclick="toggleCiCostFlag(\'')+id+'\',null,'+(summary.has_inspection_fee?0:1)+t('gen.L5956.4',')">切换商检标记</button></div>'):'', v4: summary.cost_confirmed?'disabled':'', v5: summary.transport_basis==='cbm'?'selected':'', v6: summary.transport_basis==='kg'?'selected':'', v7: Number(summary.import_duty_total||0), v8: summary.cost_confirmed?'disabled':'', v9: (summary.ci_items||[]).map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+fmtMoney(i.ci_amount)+'</td><td class="text-right"><input type="number" min="0" step="0.01" class="ci-duty-rate" data-id="'+esc(i.id)+'" value="'+(i.actual_customs_rate===null||i.actual_customs_rate===''?'':esc(i.actual_customs_rate))+'" style="width:120px;text-align:right" '+(summary.cost_confirmed?'disabled':'')+'></td></tr>').join(''), v10: hasPermission('ci_edit')&&!summary.cost_confirmed?'<button class="btn btn-secondary btn-sm mt-16" onclick="saveCiCostInputs(\''+id+t('gen.L5956.5','\')">保存分摊输入</button>'):'', v11: fmtMoney(summary.goods_amount), v12: fmtMoney(summary.warehouse_arrival_total), v13: fmtMoney(summary.customs_duty_total), v14: fmtMoney(summary.inspection_fee_total), v15: fmtMoney(summary.landing_cost_total), v16: summary.cost_confirmed?t('gen.L5956.6','✅ 已确认'):t("ci.021", "\u274c \u672a\u786e\u8ba4"), v17: summary.cost_allocated?t('gen.L5956.7','✅ 已分摊'):t("ci.023", "\u274c \u672a\u5206\u644a"), v18: summary.original_inventory_imported?t('gen.L5956.8','✅ 已完成'):t('gen.L5956.9','❌ 未完成'), v19: summary.cost_items&&summary.cost_items.length?t('gen.L5956.10','<div class="detail-section"><h3>费用明细</h3><div class="table-container"><table class="data-table"><thead><tr><th>类别</th><th>小类</th><th>付款申请号</th><th>应付金额</th><th>已付金额</th><th>计入落地成本</th><th>付款对象</th></tr></thead><tbody>')+summary.cost_items.map(c=>'<tr><td>'+esc(PAY_CATEGORIES[c.cost_category]||c.cost_category)+'</td><td>'+esc(c.cost_subcategory)+'</td><td class="cell-id">'+esc(c.request_no)+'</td><td class="text-right">'+fmtMoney(c.payable_amount)+'</td><td class="text-right">'+fmtMoney(c.paid_amount)+'</td><td>'+(c.include_in_landing_cost?'✅':'❌')+'</td><td>'+esc(c.payee_name)+'</td></tr>').join('')+'</tbody></table></div></div>':'', v20: hasPermission('ci_edit')&&!summary.cost_confirmed?'<button class="btn btn-secondary btn-sm" onclick="confirmCiCosts(\''+id+t('gen.L5956.11','\')">✅ 确认费用完整</button>'):'', v21: hasPermission('ci_edit')?'<button class="btn btn-secondary btn-sm" onclick="allocateCosts(\''+id+t('gen.L5956.12','\')">📊 费用分摊</button>'):'', v22: hasPermission('payment_create')&&summary.has_customs_duty&&!summary.cost_confirmed?'<button class="btn btn-secondary btn-sm" onclick="createCustomsDutyPay(\''+id+t('gen.L5956.13','\')">💰 关税付款</button>'):'', v23: hasPermission('payment_create')&&summary.has_inspection_fee&&!summary.cost_confirmed?'<button class="btn btn-secondary btn-sm" onclick="createInspectionFeePay(\''+id+t('gen.L5956.14','\')">💰 商检付款</button>'):'', v24: hasPermission('payment_create')&&!summary.cost_confirmed?'<button class="btn btn-secondary btn-sm" onclick="createWarehousePay(\''+id+t('gen.L5956.15','\')">🚚 到仓费用付款</button>'):''}),
      '<button class="btn btn-secondary" onclick="closeModal()">'+t("common.close","关闭")+'<</button>');
  }catch(e){showToast(e.message,'danger')}
}
async function toggleCiCostFlag(id,duty,insp){
  const d={};if(duty!==null)d.has_customs_duty=duty;if(insp!==null)d.has_inspection_fee=insp;
  try{await api('/api/commercial-invoices/'+id+'/cost-flags','PUT',d);showToast(''+t("toast.cost_flag_updated","费用标记已更新")+'','success');viewCICost(id)}catch(e){showToast(e.message,'danger')}
}
async function saveCiCostInputs(id,quiet){
  const basis=document.getElementById('ci-cost-basis'),duty=document.getElementById('ci-duty-total');
  if(!basis||!duty)return false;
  const items=[...document.querySelectorAll('.ci-duty-rate')].map(input=>({id:input.dataset.id,actual_customs_rate:input.value===''?null:parseFloat(input.value)}));
  const body={transport_basis:basis.value||null,import_duty_total:parseFloat(duty.value)||0,items};
  if(body.import_duty_total<0||items.some(i=>i.actual_customs_rate!==null&&(!Number.isFinite(i.actual_customs_rate)||i.actual_customs_rate<0))){showToast(''+t("validation.duty_rate_positive","Import Duty和实际关税税率不能小于0")+'','warning');return false}
  try{await api('/api/commercial-invoices/'+id+'/cost-inputs','PUT',body);if(!quiet){showToast(''+t("toast.cost_inputs_saved","分摊输入已保存")+'','success');viewCICost(id)}return true}catch(e){showToast(e.message,'danger');return false}
}
async function createWarehousePay(ciId){
  try{
  let countryField='';
  if(!ciId){const countries=(await api('/api/countries')).filter(c=>c.status==='active');countryField='<div class="form-group"><label>'+t('term.fin.expense_country','费用归属国家')+' <span class="required">*</span></label><select id="war-country"><option value="">'+t("common.please_select","请选择")+'</option>'+countries.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.name)+'（'+esc(c.code)+'）</option>').join('')+'</select></div>'}
  openModal(t('modal.title.createWarehousePay','创建到仓费用付款'),
    t('modal.body.createWarehousePay', `<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>费用小类</label><select id="war-sub"><option value="freight">运费</option><option value="customs_clearance">清关费</option><option value="port_charges">港口费</option><option value="delivery">派送费</option><option value="warehouse">仓储费</option><option value="other_local">其他本地费</option></select></div><div class="form-group"><label>付款对象</label><input type="text" id="war-payee" placeholder="货代/服务商名称"></div><div class="form-group"><label>应付金额</label><input type="number" step="0.01" id="war-amt"></div><div class="form-group"><label>币种</label><select id="war-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div>{v1}<div class="form-group"><label>计入落地成本</label><select id="war-lic"><option value="1">'+t('term.yes','是')+'</option><option value="0">'+t('term.no','否')+'</option></select></div><div class="form-group"><label>备注</label><input type="text" id="war-rem"></div><div class="form-group"><label>是否抵扣</label><select id="war-ded" onchange="document.getElementById('war-ded-amt').disabled=this.value==='0'"><option value="0">否</option><option value="1">是</option></select></div><div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="war-ded-amt" value="0" disabled></div><div class="form-group"><label>抵扣来源类型</label><select id="war-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="quality_claim">质量索赔</option><option value="other">其他</option></select></div><div class="form-group form-group-full"><label>抵扣说明</label><input type="text" id="war-ded-desc"></div></div></div>`, {v1: countryField}),
    t('modal.footer.createWarehousePay', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveWarehousePay('{v1}')">创建</button>`, {v1: ciId}));
  }catch(e){showToast(e.message,'danger')}
}
async function saveWarehousePay(ciId){
  const countryEl=document.getElementById('war-country');if(!ciId&&(!countryEl||!countryEl.value)){showToast(t('validation.expenseCountryRequired','请选择费用归属国家'),'warning');return}
  const d={ci_id:ciId,subcategory:document.getElementById('war-sub').value,payee_name:document.getElementById('war-payee').value,payable_amount:parseFloat(document.getElementById('war-amt').value)||0,currency:document.getElementById('war-cur').value,expense_country:countryEl?countryEl.value:'',remark:document.getElementById('war-rem').value,has_deduction:parseInt(document.getElementById('war-ded').value),deduction_amount:parseFloat(document.getElementById('war-ded-amt').value)||0,deduction_source_type:document.getElementById('war-ded-type').value,deduction_source_desc:document.getElementById('war-ded-desc').value,include_in_landing_cost:parseInt(document.getElementById('war-lic').value)};
  try{await api('/api/payment-requests/warehouse-arrival','POST',d);showToast(t('toast.warehousePayCreated','到仓费用付款申请已创建'),'success');closeModal()}catch(e){showToast(e.message,'danger')}
}
async function createCustomsDutyPay(ciId){
  openModal(t("app.1021", "\u521b\u5efa\u5173\u7a0e\u4ed8\u6b3e"),
    t('modal.body.createCustomsDutyPay', '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
    '<div class="form-group"><label>付款对象</label><input type="text" id="dut-payee" value="海关"></div>'+
    '<div class="form-group"><label>应付金额</label><input type="number" step="0.01" id="dut-amt"></div>'+
    '<div class="form-group"><label>币种</label><select id="dut-cur"><option>USD</option><option>RMB</option></select></div>'+
    '<div class="form-group"><label>备注</label><input type="text" id="dut-rem"></div>'+
    '<div class="form-group"><label>是否抵扣</label><select id="dut-ded" onchange="document.getElementById(\'dut-ded-amt\').disabled=this.value===\'0\'"><option value="0">否</option><option value="1">是</option></select></div>'+
    '<div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="dut-ded-amt" value="0" disabled></div>'+
    '<div class="form-group"><label>抵扣来源类型</label><select id="dut-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="other">其他</option></select></div>'+
    '<div class="form-group form-group-full"><label>抵扣说明</label><input type="text" id="dut-ded-desc"></div>'+
    '</div></div>'),
    t('modal.footer.createCustomsDutyPay', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveCustomsDutyPay('{v1}')">创建</button>`, {v1: ciId}));
}
async function saveCustomsDutyPay(ciId){
  const d={ci_id:ciId,payee_name:document.getElementById('dut-payee').value,payable_amount:parseFloat(document.getElementById('dut-amt').value)||0,currency:document.getElementById('dut-cur').value,remark:document.getElementById('dut-rem').value,has_deduction:parseInt(document.getElementById('dut-ded').value),deduction_amount:parseFloat(document.getElementById('dut-ded-amt').value)||0,deduction_source_type:document.getElementById('dut-ded-type').value,deduction_source_desc:document.getElementById('dut-ded-desc').value};
  try{await api('/api/payment-requests/customs-duty','POST',d);showToast(t('toast.customsDutyPayCreated','关税付款申请已创建'),'success');closeModal()}catch(e){showToast(e.message,'danger')}
}
async function createInspectionFeePay(ciId){
  openModal(t("app.1023", "\u521b\u5efa\u5546\u68c0\u8d39\u7528\u4ed8\u6b3e"),
    t('modal.body.createInspectionFeePay', '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
    '<div class="form-group"><label>付款对象</label><input type="text" id="ins-payee" placeholder="\u5546\u68c0\u673a\u6784"></div>'+
    '<div class="form-group"><label>应付金额</label><input type="number" step="0.01" id="ins-amt"></div>'+
    '<div class="form-group"><label>币种</label><select id="ins-cur"><option>USD</option><option>RMB</option></select></div>'+
    '<div class="form-group"><label>备注</label><input type="text" id="ins-rem"></div>'+
    '<div class="form-group"><label>是否抵扣</label><select id="ins-ded" onchange="document.getElementById(\'ins-ded-amt\').disabled=this.value===\'0\'"><option value="0">否</option><option value="1">是</option></select></div>'+
    '<div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="ins-ded-amt" value="0" disabled></div>'+
    '<div class="form-group"><label>抵扣来源类型</label><select id="ins-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="other">其他</option></select></div>'+
    '<div class="form-group form-group-full"><label>抵扣说明</label><input type="text" id="ins-ded-desc"></div>'+
    '</div></div>'),
    t('modal.footer.createInspectionFeePay', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveInspectionFeePay('{v1}')">创建</button>`, {v1: ciId}));
}
async function saveInspectionFeePay(ciId){
  const d={ci_id:ciId,payee_name:document.getElementById('ins-payee').value,payable_amount:parseFloat(document.getElementById('ins-amt').value)||0,currency:document.getElementById('ins-cur').value,remark:document.getElementById('ins-rem').value,has_deduction:parseInt(document.getElementById('ins-ded').value),deduction_amount:parseFloat(document.getElementById('ins-ded-amt').value)||0,deduction_source_type:document.getElementById('ins-ded-type').value,deduction_source_desc:document.getElementById('ins-ded-desc').value};
  try{await api('/api/payment-requests/inspection-fee','POST',d);showToast(t('toast.inspectionFeePayCreated','商检费用付款申请已创建'),'success');closeModal()}catch(e){showToast(e.message,'danger')}
}

// ==================== 物流管理 ====================
async function renderLogistics(){
  document.getElementById('content-inner').innerHTML=t('html.renderLogistics', '<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="log-fs"><option value="">全部</option><option value="pending">待提货</option><option value="picked_up">已提货</option><option value="in_transit">运输中</option><option value="arrived">到港</option><option value="customs">清关中</option><option value="cleared">已清关</option><option value="delivering">派送中</option><option value="completed">已完成</option></select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadLog()">搜索</button>{v1}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🚢 物流批次</div></div><div id="log-table"></div></div>', {v1: hasPermission('logistics_create')?t('gen.L6025.1','<button class="btn btn-primary btn-sm" onclick="createLog()">➕ 新建</button>'):''});
  loadLog();
}
async function loadLog(){
  try{
    const s=document.getElementById('log-fs')?.value||'';
    const data=await api('/api/logistics-batches?status='+s);
    document.getElementById('log-table').innerHTML=!data.length?t('gen.L6032.1','<div class="empty-state"><div class="empty-icon">🚢</div>暂无物流数据</div>'):t('gen.L6032.2','<div class="table-container" style="box-shadow:none;border-radius:0;overflow-x:auto"><table class="data-table"><thead><tr><th>批次号</th><th>关联CI</th><th>货代</th><th>方式</th><th>起运港</th><th>目的港</th><th>国家</th><th>提货</th><th>出发</th><th>到港</th><th>清关完成</th><th>入库完成</th><th>箱数</th><th>CBM</th><th>综合运费</th><th>关税</th><th>状态</th><th>费用</th><th>操作</th></tr></thead><tbody>')+data.map(l=>'<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewLog\',\''+l.id+'\')"><td class="cell-id">'+esc(l.batch_no)+'</td><td class="cell-id">'+esc(l.related_ci_no)+'</td><td>'+esc(l.forwarder_name)+'</td><td>'+esc(l.transport_mode)+'</td><td>'+esc(l.origin_port)+'</td><td>'+esc(l.dest_port)+'</td><td>'+esc(l.target_country)+'</td><td class="cell-date">'+fmtDate(l.pickup_date)+'</td><td class="cell-date">'+fmtDate(l.depart_date)+'</td><td class="cell-date">'+fmtDate(l.actual_arrival_date)+'</td><td class="cell-date">'+fmtDate(l.customs_end_date)+'</td><td class="cell-date">'+fmtDate(l.inbound_complete_date)+'</td><td class="text-right">'+(l.total_cartons||0)+'</td><td class="text-right">'+(l.total_cbm||0)+'</td><td class="text-right">'+fmtMoney(l.total_freight,l.freight_currency)+'</td><td class="text-right">'+fmtMoney(l.customs_duty,l.freight_currency)+'</td><td><span class="status-badge '+(l.logistics_status==='completed'?'status-completed':'status-pending')+'">'+esc(l.logistics_status)+'</span></td><td><span class="status-badge '+(l.fee_status==='paid'?'status-paid':'status-unpaid')+'">'+esc(l.fee_status)+'</span></td><td class="cell-actions"><button class="action-btn" onclick="viewLog(\''+l.id+'\')">👁️</button>'+(l.total_freight>0&&l.fee_status==='unpaid'&&hasPermission('payment_create')?'<button class="action-btn" onclick="createFrtPay(\''+l.id+t('gen.L6032.3','\')" title="\u8fd0\u8d39\u4ed8\u6b3e">💰</button>'):'')+(l.customs_duty>0&&l.fee_status==='unpaid'&&hasPermission('payment_create')?'<button class="action-btn" onclick="createDutyPay(\''+l.id+t('gen.L6032.4','\')" title="\u5173\u7a0e\u4ed8\u6b3e">🏛️</button>'):'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function viewLog(id){
  try{const l=await api('/api/logistics-batches/'+id);const fs=['batch_no','related_ci_no','forwarder_name','transport_mode','origin_port','dest_port','target_country','target_warehouse','pickup_date','depart_date','eta_date','actual_arrival_date','customs_start_date','customs_end_date','delivery_date','inbound_complete_date','logistics_status','total_cartons','total_weight','total_cbm','freight_currency','international_freight','local_charges','customs_service_fee','delivery_fee','total_freight','customs_duty','vat_gst','other_fees','fee_status'];
    openModal(t('modal.title.viewLog', '物流详情 - {v1}', {v1: l.batch_no}),t('modal.body.viewLog', '<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>基本信息</h3><div class="detail-grid">{v1}</div></div></div>', {v1: fs.map(f=>'<div class="detail-item"><span class="detail-label">'+f+'</span><span class="detail-value">'+esc(l[f])+'</span></div>').join('')}));
  }catch(e){showToast(e.message,'danger')}
}
async function createLog(){
  const ffs=await api('/api/freight-forwarders');const cis=await api('/api/commercial-invoices?status=shipped');
  openModal(t("ci.025", "\u65b0\u5efa\u7269\u6d41\u6279\u6b21"),t('modal.body.createLog', '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>关联CI</label><select id="nlog-ci"><option value="">无</option>{v1}</select></div><div class="form-group"><label>货代</label><select id="nlog-ff"><option value="">选择</option>{v2}</select></div><div class="form-group"><label>运输方式</label><select id="nlog-mode"><option value="sea">海运</option><option value="air">空运</option><option value="land">陆运</option><option value="express">快递</option></select></div><div class="form-group"><label>起运港</label><input type="text" id="nlog-origin"></div><div class="form-group"><label>目的港</label><input type="text" id="nlog-dest"></div><div class="form-group"><label>目标国家</label><input type="text" id="nlog-country"></div><div class="form-group"><label>目标仓库</label><input type="text" id="nlog-wh"></div><div class="form-group"><label>提货日期</label><input type="date" id="nlog-pickup"></div><div class="form-group"><label>出发日期</label><input type="date" id="nlog-depart"></div><div class="form-group"><label>预计到港</label><input type="date" id="nlog-eta"></div><div class="form-group"><label>运费币种</label><select id="nlog-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div><div class="form-group"><label>国际运费</label><input type="number" step="0.01" id="nlog-intl" value="0"></div><div class="form-group"><label>本地杂费</label><input type="number" step="0.01" id="nlog-local" value="0"></div><div class="form-group"><label>清关服务费</label><input type="number" step="0.01" id="nlog-csv" value="0"></div><div class="form-group"><label>派送费</label><input type="number" step="0.01" id="nlog-delivery" value="0"></div><div class="form-group"><label>关税</label><input type="number" step="0.01" id="nlog-duty" value="0"></div><div class="form-group"><label>VAT/GST</label><input type="number" step="0.01" id="nlog-vat" value="0"></div><div class="form-group"><label>其他费用</label><input type="number" step="0.01" id="nlog-other" value="0"></div></div></div>', {v1: cis.map(c=>'<option value="'+c.id+'" data-no="'+c.ci_no+'">'+esc(c.ci_no)+' - '+esc(c.supplier_name)+'</option>').join(''), v2: ffs.map(f=>'<option value="'+f.id+'" data-name="'+esc(f.name)+'">'+esc(f.name)+'</option>').join('')}),t('gen.L6042.1','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveNewLog()">创建</button>'));
}
async function saveNewLog(){
  const ciSel=document.getElementById('nlog-ci'),ffSel=document.getElementById('nlog-ff');
  const d={related_ci_id:ciSel.value||'',related_ci_no:ciSel.options[ciSel.selectedIndex]?.dataset.no||'',forwarder_id:ffSel.value||'',forwarder_name:ffSel.options[ffSel.selectedIndex]?.dataset.name||'',transport_mode:document.getElementById('nlog-mode').value,origin_port:document.getElementById('nlog-origin').value,dest_port:document.getElementById('nlog-dest').value,target_country:document.getElementById('nlog-country').value,target_warehouse:document.getElementById('nlog-wh').value,pickup_date:document.getElementById('nlog-pickup').value,depart_date:document.getElementById('nlog-depart').value,eta_date:document.getElementById('nlog-eta').value,freight_currency:document.getElementById('nlog-cur').value,international_freight:parseFloat(document.getElementById('nlog-intl').value)||0,local_charges:parseFloat(document.getElementById('nlog-local').value)||0,customs_service_fee:parseFloat(document.getElementById('nlog-csv').value)||0,delivery_fee:parseFloat(document.getElementById('nlog-delivery').value)||0,customs_duty:parseFloat(document.getElementById('nlog-duty').value)||0,vat_gst:parseFloat(document.getElementById('nlog-vat').value)||0,other_fees:parseFloat(document.getElementById('nlog-other').value)||0};
  try{await api('/api/logistics-batches','POST',d);showToast(t('gen.L6047.1','创建成功'),'success');closeModal();loadLog()}catch(e){showToast(e.message,'danger')}
}
async function createFrtPay(id){
  try{
    const log=await api('/api/logistics-batches/'+id);
    if(!log.related_ci_id){showToast(t('toast.frtPayNoCI','该物流批次未关联CI，请从CI费用管理页面创建到仓费用付款'),'warning');return}
    // 跳转到CI费用管理
    viewCICost(log.related_ci_id);
  }catch(e){showToast(e.message,'danger')}
}
async function createDutyPay(id){
  try{
    const log=await api('/api/logistics-batches/'+id);
    if(!log.related_ci_id){showToast(''+t("toast.duty_no_related_ci","该物流批次未关联CI，请从CI费用管理页面创建关税付款")+'','warning');return}
    const ci=await api('/api/commercial-invoices/'+log.related_ci_id);
    if(!ci.has_customs_duty){showToast(''+t("toast.ci_no_customs_set","该CI未标记为有关税，请先在CI费用管理中设置")+'','warning');return}
    createCustomsDutyPay(log.related_ci_id);
  }catch(e){showToast(e.message,'danger')}
}

// ==================== 入库管理 ====================
async function renderInbound(){
  document.getElementById('content-inner').innerHTML=t('html.renderInbound', '<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="in-fs"><option value="">全部</option><option value="pending">待入库</option><option value="completed">已完成</option><option value="abnormal">异常</option></select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadIn()">搜索</button>{v1}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📥 入库记录</div></div><div id="in-table"></div></div>', {v1: hasPermission('inbound_create')?t('gen.L6069.1','<button class="btn btn-primary btn-sm" onclick="openBatchImportInbound()">📥 批量导入</button><button class="btn btn-primary btn-sm" onclick="createIn()">➕ 新建入库</button>'):''});
  loadIn();
}
async function loadIn(){
  try{
    const s=document.getElementById('in-fs')?.value||'';
    const data=await api('/api/inbound-records?status='+s);
    document.getElementById('in-table').innerHTML=!data.length?t('gen.L6076.1','<div class="empty-state"><div class="empty-icon">📥</div>暂无入库数据</div>'):t('gen.L6076.2','<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>入库单号</th><th>来源CI</th><th>来源PL</th><th>物流批次</th><th>国家</th><th>仓库</th><th>日期</th><th>SKU</th><th>产品名</th><th>CI发货</th><th>应入库</th><th>实际入库</th><th>累计</th><th>未入库</th><th>异常</th><th>状态</th></tr></thead><tbody>')+data.map(i=>'<tr><td class="cell-id">'+esc(i.inbound_no)+'</td><td class="cell-id">'+esc(i.source_ci_no)+'</td><td class="cell-id">'+esc(i.source_pl_no||'-')+'</td><td class="cell-id">'+esc(i.source_logistics_batch_no)+'</td><td>'+esc(i.country)+'</td><td>'+esc(i.warehouse)+'</td><td class="cell-date">'+fmtDate(i.inbound_date)+'</td><td class="cell-id">'+esc(i.sku_code)+'</td><td>'+esc(i.product_name)+'</td><td class="text-right">'+(i.ci_shipped_qty||0)+'</td><td class="text-right">'+(i.expected_qty||0)+'</td><td class="text-right font-bold">'+(i.actual_qty||0)+'</td><td class="text-right">'+(i.accumulated_qty||0)+'</td><td class="text-right">'+(i.uninbound_qty||0)+'</td><td class="text-right '+(i.abnormal_qty>0?'text-danger':'')+'">'+(i.abnormal_qty||0)+'</td><td><span class="status-badge '+(i.inbound_status==='completed'?'status-completed':i.inbound_status==='abnormal'?'status-danger':'status-pending')+'">'+esc(i.inbound_status)+'</span></td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
// P1-STATE-01D：新建入库改为「选择 PL 明细」驱动，写入时提交 source_pl_id + source_pl_item_id
async function createIn(){
  const pls=await api('/api/packing-lists');
  openModal(t("app.1029", "\u65b0\u5efa\u5165\u5e93\uff08\u5173\u8054PL\u660e\u7ec6\uff09"),t('modal.body.createIn', '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>来源PL <span class="required">*</span></label><select id="nin-pl" onchange="loadPLForIn()"><option value="">选择PL</option>{v1}</select></div><div class="form-group"><label>入库日期 <span class="required">*</span></label><input type="date" id="nin-date" value="{v2}"></div><div class="form-group"><label>国家</label><input type="text" id="nin-country"></div><div class="form-group"><label>仓库</label><input type="text" id="nin-wh"></div><div class="form-group"><label>物流批次号</label><input type="text" id="nin-log"></div><div class="form-group"><label>派送批次号</label><input type="text" id="nin-del"></div></div><div id="in-pl-items" style="margin-top:16px"></div></div>', {v1: pls.map(p=>'<option value="'+p.id+'" data-no="'+esc(p.pl_no)+'">'+esc(p.pl_no)+' - '+esc(p.related_ci_no||'')+' - '+esc(p.supplier_name||'')+'</option>').join(''), v2: todayStr()}),t('gen.L6082.1','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveNewIn()">创建入库</button>'));
}
async function loadPLForIn(){
  const plSel=document.getElementById('nin-pl');
  if(!plSel.value)return;
  try{
    const pl=await api('/api/packing-lists/'+plSel.value);
    const items=pl.items||[];
    document.getElementById('in-pl-items').innerHTML=t('html.loadPLForIn', '<h4 style="margin-bottom:8px">PL明细（已入库/剩余）</h4><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>PL数量</th><th>已入库</th><th>剩余</th><th>本次入库</th></tr></thead><tbody>{v1}</tbody></table></div>', {v1: items.map((item,i)=>'<tr><td class="cell-id">'+esc(item.sku_code)+'</td><td class="text-right">'+(item.total_qty||0)+'</td><td class="text-right">'+(item.received_qty||0)+'</td><td class="text-right">'+(item.remaining_qty||0)+'</td><td><input type="number" id="in-q-'+i+'" value="'+Math.max(0,(item.remaining_qty||0))+'" style="width:80px;padding:4px"></td></tr>').join('')});
    window._inPL=plSel.value;
    window._inPLNo=plSel.options[plSel.selectedIndex].dataset.no;
    window._inItems=items;
  }catch(e){}
}
async function saveNewIn(){
  const country=document.getElementById('nin-country').value,wh=document.getElementById('nin-wh').value,date=document.getElementById('nin-date').value,log=document.getElementById('nin-log').value,del=document.getElementById('nin-del').value;
  const plId=window._inPL||'',plNo=window._inPLNo||'',items=window._inItems||[];
  try{
    for(let i=0;i<items.length;i++){
      const q=parseInt(document.getElementById('in-q-'+i)?.value)||0;
      if(q>0)await api('/api/inbound-records','POST',{source_pl_id:plId,source_pl_item_id:items[i].id,source_logistics_batch_no:log,delivery_batch_no:del,country,warehouse:wh,inbound_date:date,sku_code:items[i].sku_code,actual_qty:q})
    }
    showToast(t('gen.L6104.1','入库完成'),'success');closeModal();loadIn();
  }catch(e){showToast(e.message,'danger')}
}

// ==================== 入库批量导入 ====================
// 必填列：SKU编码、入库日期、实际入库数量
// 选填列：来源CI号、物流批次号、派送批次号、国家、仓库、CI发货量、应入库量、异常数量、异常原因、备注
// P1-STATE-01D：导入列改为以 PL 关联为主；source_pl_item_id 为权威，source_pl_no+SKU 为兼容解析
const INBOUND_IMPORT_COLUMNS=[
  {key:'sku_code',label:t("app.583", "SKU\u7f16\u7801"),required:true},
  {key:'inbound_date',label:t("po.045", "\u5165\u5e93\u65e5\u671f"),required:true,format:v=>v?(v instanceof Date?formatDateISO(v):String(v).trim().slice(0,10)):''},
  {key:'actual_qty',label:t("po.046", "\u5b9e\u9645\u5165\u5e93\u6570\u91cf"),required:true},
  {key:'source_pl_item_id',label:t("po.047", "PL\u660e\u7ec6ID")},
  {key:'source_pl_no',label:t("po.048", "PL\u53f7\uff08\u517c\u5bb9\uff0c\u9700\u4e0eSKU\u914d\u5408\u5b9a\u4f4d\u660e\u7ec6\uff09")},
  {key:'source_logistics_batch_no',label:t("app.1030", "\u7269\u6d41\u6279\u6b21\u53f7")},
  {key:'delivery_batch_no',label:t("app.1031", "\u6d3e\u9001\u6279\u6b21\u53f7")},
  {key:'country',label:t("app.113", "\u56fd\u5bb6")},
  {key:'warehouse',label:t("app.114", "\u4ed3\u5e93")},
  {key:'ci_shipped_qty',label:t("po.049", "CI\u53d1\u8d27\u91cf")},
  {key:'expected_qty',label:t("po.050", "\u5e94\u5165\u5e93\u91cf")},
  {key:'abnormal_qty',label:t("po.051", "\u5f02\u5e38\u6570\u91cf")},
  {key:'abnormal_reason',label:t("po.052", "\u5f02\u5e38\u539f\u56e0")},
  {key:'remark',label:t("app.025", "\u5907\u6ce8")}
];

function openBatchImportInbound(){
  openModal(t("po.053", "\u6279\u91cf\u5bfc\u5165\u5165\u5e93\u8bb0\u5f55"),
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div id="bi-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s" '+
        'onclick="document.getElementById(\'bi-file-input\').click()" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
        'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handleInboundFile(event.dataTransfer.files[0])">'+
        '<div style="font-size:48px;color:#1890ff;margin-bottom:8px">📤</div>'+
        t('gen.L6138.1','<div style="font-size:14px;color:#333;margin-bottom:4px">点击上传或拖拽文件到此处</div>')+
        t('gen.L6139.1','<div style="font-size:12px;color:#999">支持 .xlsx / .csv 格式</div>')+
      '</div>'+
      '<input type="file" id="bi-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleInboundFile(this.files[0])">'+
      '<div id="bi-preview" style="margin-top:16px"></div>'+
    '</div>',
    t('gen.L6144.1','<button class="btn btn-secondary" onclick="downloadInboundTemplate()">下载模板</button>')+
    t('gen.L6145.1','<button class="btn btn-secondary" onclick="closeModal()">关闭</button>')+
    t('gen.L6146.1','<button class="btn btn-primary" id="bi-import-btn" onclick="submitBatchImportInbound()" disabled>开始导入</button>')
  );
  window._inboundImportData=[];
}

function handleInboundFile(file){
  if(!file)return;
  const ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){showToast(t('gen.L6154.1','仅支持 .xlsx / .xls / .csv 格式'),'danger');return}
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=new Uint8Array(e.target.result);
      const wb=XLSX.read(data,{type:'array',cellDates:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      if(rows.length<2){showToast(t('gen.L6162.1','文件为空或缺少数据行'),'danger');return}
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
          if(v===undefined||v===null||v===''||(typeof v==='string'&&!v.trim()))rec._errors.push(c.label+t('gen.L6183.1','不能为空'));
        });
        // P1-STATE-01D：必须提供 PL明细ID 或 PL号（与SKU配合定位明细）
        if(!rec.source_pl_item_id && !rec.source_pl_no){
          rec._errors.push(t("app.1033", "\u5fc5\u987b\u63d0\u4f9b PL\u660e\u7ec6ID \u6216 PL\u53f7"));
        }
        if(rec.actual_qty!==undefined&&rec.actual_qty!==''){
          const n=parseInt(rec.actual_qty);
          if(isNaN(n)||n<=0)rec._errors.push(t('gen.L6191.1','实际入库数量必须为正整数（大于0）'));
          else rec.actual_qty=n;
        }
        if(rec.inbound_date){
          const d=String(rec.inbound_date);
          if(!/^\d{4}-\d{2}-\d{2}/.test(d))rec._errors.push(t("app.1035", "\u5165\u5e93\u65e5\u671f\u683c\u5f0f\u5e94\u4e3a YYYY-MM-DD"));
        }
        records.push(rec);
      }
      window._inboundImportData=records;
      renderInboundPreview(records);
      document.getElementById('bi-import-btn').disabled=records.length===0;
    }catch(err){showToast(t('toast.handleInboundFile', '文件解析失败：{v1}', {v1: err.message}),'danger')}
  };
  reader.readAsArrayBuffer(file);
}

function renderInboundPreview(records){
  const valid=records.filter(r=>r._errors.length===0).length;
  const invalid=records.length-valid;
  let html='<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px"><b>'+t("common.total_prefix","共")+' '+records.length+''+t("common.unit_item_data"," 条数据")+'</b>，<span style="color:#52c41a">'+t("common.valid","有效")+' '+valid+''+t("common.unit_item"," 条")+'</span>'+(invalid>0?'，<span style="color:#ff4d4f">'+t("common.invalid","无效")+' '+invalid+''+t("common.unit_item"," 条")+'</span>':'')+'</div>';
  html+='<div class="table-container" style="max-height:300px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>'+t("col.row","行")+'</th><th>SKU</th><th>'+t("col.date","日期")+'</th><th>'+t("col.qty","数量")+'</th><th>'+t("col.pl_detail_id","PL明细ID")+'</th><th>'+t("col.pl_no","PL号")+'</th><th>'+t("app.113","国家")+'</th><th>'+t("app.114","仓库")+'</th><th>'+t("col.status","状态")+'</th></tr></thead><tbody>';
  const preview=records.slice(0,20);
  preview.forEach(r=>{
    const ok=r._errors.length===0;
    html+='<tr style="'+(ok?'':'background:#fff1f0')+'">'+
      '<td>'+r._rowNum+'</td>'+
      '<td class="cell-id">'+esc(r.sku_code||'-')+'</td>'+
      '<td class="cell-date">'+esc(r.inbound_date||'-')+'</td>'+
      '<td class="text-right">'+(r.actual_qty!==undefined?r.actual_qty:'-')+'</td>'+
      '<td class="cell-id">'+esc(r.source_pl_item_id||'-')+'</td>'+
      '<td class="cell-id">'+esc(r.source_pl_no||'-')+'</td>'+
      '<td>'+esc(r.country||'-')+'</td>'+
      '<td>'+esc(r.warehouse||'-')+'</td>'+
      '<td>'+(ok?'<span class="status-badge status-completed">✓</span>':'<span class="status-badge status-danger" title="'+esc(r._errors.join('; '))+'">✗ '+r._errors.length+'</span>')+'</td>'+
    '</tr>';
  });
  if(records.length>20)html+='<tr><td colspan="9" style="text-align:center;color:#999;padding:8px">... '+t("common.remaining","还有")+' '+(records.length-20)+''+t("common.unit_item"," 条")+'</td></tr>';
  html+='</tbody></table></div>';
  if(invalid>0){
    html+='<div style="margin-top:10px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666"><b>'+t("common.invalid_rows_detail","无效行明细：")+'</b><br>'+
      records.filter(r=>r._errors.length>0).slice(0,10).map(r=>''+t("common.ordinal_prefix","第")+' '+r._rowNum+''+t("col.row_colon"," 行：")+''+r._errors.join('、')).join('<br>')+
      (invalid>10?'<br>...':'')+'</div>';
  }
  document.getElementById('bi-preview').innerHTML=html;
}

function formatDateISO(d){
  if(!(d instanceof Date)||isNaN(d))return'';
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}
// 销售日期统一规范化（前端预览校验，后端结果为准）
// 兼容：Date对象 / YYYY-MM-DD / YYYY-MM / YYYY/M/D / YYYY/MM/DD / M/D/YYYY / M/D/YY / Excel序列号(20000-80000)
// 返回 null 表示无法识别
function normalizeOrderDate(value){
  if(value===null||value===undefined||value==='')return null;
  if(value instanceof Date){
    if(isNaN(value.getTime()))return null;
    return formatDateISO(value);
  }
  var s=String(value).trim();
  if(!s)return null;
  // Excel 日期序列号（限制 20000-80000）
  if(/^\d+$/.test(s)){
    var num=parseInt(s,10);
    if(num>=20000&&num<=80000){
      var epochMs=(num-25569)*86400000;
      var dt=new Date(epochMs);
      if(!isNaN(dt.getTime())){
        return dt.getUTCFullYear()+'-'+String(dt.getUTCMonth()+1).padStart(2,'0')+'-'+String(dt.getUTCDate()).padStart(2,'0');
      }
    }
    return null;
  }
  // YYYY-MM-DD
  var m1=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m1)return _buildValidDateJS(m1[1],m1[2],m1[3]);
  // YYYY-MM（补 -01）
  var m2=s.match(/^(\d{4})-(\d{1,2})$/);
  if(m2)return _buildValidDateJS(m2[1],m2[2],'01');
  // 含斜杠
  if(s.indexOf('/')>=0){
    var parts=s.split('/').map(function(p){return p.trim()});
    if(parts.length!==3)return null;
    var a=parts[0],b=parts[1],c=parts[2];
    if(/^\d{4}$/.test(a))return _buildValidDateJS(a,b,c);
    if(/^\d{1,2}$/.test(a)&&/^\d{1,2}$/.test(b)){
      var year;
      if(/^\d{4}$/.test(c))year=c;
      else if(/^\d{2}$/.test(c)){var yy=parseInt(c,10);year=String(yy<=69?2000+yy:1900+yy)}
      else return null;
      return _buildValidDateJS(year,a,b);
    }
    return null;
  }
  return null;
}
function _buildValidDateJS(yStr,mStr,dStr){
  var y=parseInt(yStr,10),m=parseInt(mStr,10),d=parseInt(dStr,10);
  if(isNaN(y)||isNaN(m)||isNaN(d))return null;
  if(m<1||m>12)return null;
  if(d<1||d>31)return null;
  var dt=new Date(y,m-1,d);
  if(dt.getFullYear()!==y||dt.getMonth()!==m-1||dt.getDate()!==d)return null;
  return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}

function downloadInboundTemplate(){
  // 构造示例数据（P1-STATE-01D：以 PL 关联为准；两种写法均可）
  const sample=[
    {sku_code:'SKU001',inbound_date:'2026-07-04',actual_qty:100,source_pl_item_id:t("app.1037", "PLI\u793a\u4f8bID\uff08\u66ff\u6362\u4e3a\u771f\u5b9ePL\u660e\u7ec6ID\uff09"),source_pl_no:'',source_logistics_batch_no:'',delivery_batch_no:'',country:t("app.1038", "\u7f8e\u56fd"),warehouse:t("app.1039", "\u7f8e\u897f\u4ed3"),ci_shipped_qty:100,expected_qty:100,abnormal_qty:0,abnormal_reason:'',remark:t("app.1040", "\u6309PL\u660e\u7ec6ID\u5165\u5e93")},
    {sku_code:'SKU002',inbound_date:'2026-07-04',actual_qty:50,source_pl_item_id:'',source_pl_no:'PL-2026-001',source_logistics_batch_no:'LG-2026-07',delivery_batch_no:'',country:t("app.1041", "\u82f1\u56fd"),warehouse:t("app.1042", "\u82f1\u56fd\u4ed3"),ci_shipped_qty:0,expected_qty:50,abnormal_qty:5,abnormal_reason:t("app.1043", "\u5916\u7bb1\u7834\u635f"),remark:t("app.1044", "\u6309PL\u53f7+SKU\u5165\u5e93")}
  ];
  // 表头使用中文标签
  const headers=INBOUND_IMPORT_COLUMNS.map(c=>c.label);
  const data=sample.map(r=>INBOUND_IMPORT_COLUMNS.map(c=>r[c.key]!==undefined?r[c.key]:''));
  const ws=XLSX.utils.aoa_to_sheet([headers,...data]);
  // 设置列宽
  ws['!cols']=INBOUND_IMPORT_COLUMNS.map(c=>({wch:c.label.length*2+4}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,t("app.1045", "\u5165\u5e93\u8bb0\u5f55"));
  XLSX.writeFile(wb,t("app.1046", "\u5165\u5e93\u8bb0\u5f55_\u5bfc\u5165\u6a21\u677f.xlsx"));
}

async function submitBatchImportInbound(){
  const records=window._inboundImportData||[];
  const valid=records.filter(r=>r._errors.length===0);
  if(valid.length===0){showToast(t('gen.L6319.1','没有可导入的有效数据'),'danger');return}
  const btn=document.getElementById('bi-import-btn');
  btn.disabled=true;btn.textContent=t("app.613", "\u5bfc\u5165\u4e2d...");
  try{
    const res=await api('/api/inbound-records/batch-import','POST',{records:valid});
    let msg=t('gen.L6324.1','导入完成：成功 ')+res.success+t('gen.L6324.2',' 条');
    if(res.failed)msg+=t('gen.L6325.1','，失败 ')+res.failed+t('gen.L6325.2',' 条');
    showToast(msg,res.failed?'warning':'success');
    if(res.errors&&res.errors.length){
      console.warn(t("app.1047", "\u5bfc\u5165\u9519\u8bef\u660e\u7ec6"),res.errors);
    }
    closeModal();
    loadIn();
  }catch(e){
    showToast(e.message||t('gen.L6333.1','导入失败'),'danger');
    btn.disabled=false;btn.textContent=t("app.067", "\u5f00\u59cb\u5bfc\u5165");
  }
}

// 生命周期说明弹窗
function openLifecycleHelp(){
  const rows=[
    {k:'new_test',label:t("app.547", "\u65b0\u54c1\u5bfc\u5165"),strategy:t("app.1048", "\u4e0d\u76f4\u63a5\u751f\u6210PO\uff0c\u9700\u5148\u5b8c\u6210\u65b0\u54c1\u542f\u52a8\u68c0\u67e5\u6e05\u5355"),coeff:'0%',replenish:false,judge:t("app.1049", "SKU\u7684 launch_date \u8ddd\u4eca \u226430 \u5929")},
    {k:'new_launch',label:t("app.548", "\u65b0\u54c1\u542f\u52a8"),strategy:t("app.1050", "\u89c2\u5bdf\u671f+\u5907\u8d27\u9884\u8b66\uff0c\u6309\u76ee\u6807\u6708\u657050%\u5efa\u8bae\u8865\u8d27"),coeff:'50%',replenish:true,judge:t("app.1051", "30-90\u5929 + \u5df2\u6709\u90e8\u5206\u51fa\u5e93")},
    {k:'growth',label:t("app.549", "\u6210\u957f\u671f"),strategy:t("app.724", "\u5141\u8bb8\u4f18\u5148\u8865\u8d27\uff0c\u6309\u76ee\u6807\u6708\u657080%\u5efa\u8bae"),coeff:'80%',replenish:true,judge:t("app.1052", "\u6708\u9500\u91cf\u8fde\u7eed 2-3 \u4e2a\u6708\u73af\u6bd4\u589e\u957f \u226520%")},
    {k:'stable',label:t("app.550", "\u6210\u719f\u671f"),strategy:t("app.1053", "\u6309\u9ed8\u8ba4\u76ee\u6807\u6708\u6570\uff084\u4e2a\u6708\uff09\u5efa\u8bae\u8865\u8d27"),coeff:'100%',replenish:true,judge:t("app.1054", "\u9500\u91cf\u7a33\u5b9a\uff0c\u65e0\u660e\u663e\u4e0a\u5347\u6216\u4e0b\u964d\u8d8b\u52bf")},
    {k:'slow',label:t("app.551", "\u8870\u9000\u671f"),strategy:t("app.726", "\u964d\u4f4e\u76ee\u6807\u6708\u6570\uff0c\u630950%\u5efa\u8bae\u8865\u8d27"),coeff:'50%',replenish:true,judge:t("app.1055", "\u6708\u9500\u91cf\u8fde\u7eed 2-3 \u4e2a\u6708\u73af\u6bd4\u4e0b\u964d \u226520%")},
    {k:'stagnant',label:t("app.552", "\u6ede\u9500"),strategy:t("app.727", "\u6682\u7f13\u8865\u8d27\uff0c\u9700\u5148\u6e05\u7406\u5e93\u5b58"),coeff:'0%',replenish:false,judge:t("app.1056", "\u8fd1 90 \u5929\u65e0\u51fa\u5e93\u8bb0\u5f55")},
    {k:'clearance',label:t("app.553", "\u6e05\u4ed3\u671f"),strategy:t("app.1057", "\u6e05\u4ed3\u4e2d\uff0c\u4e0d\u5efa\u8bae\u8865\u8d27"),coeff:'0%',replenish:false,judge:t("app.1058", "SKU \u72b6\u6001 = clearance")},
    {k:'stopped',label:t("app.554", "\u505c\u91c7/\u505c\u4ea7"),strategy:t("app.729", "\u505c\u91c7/\u505c\u4ea7\uff0c\u4e0d\u53c2\u4e0e\u8865\u8d27\u5efa\u8bae"),coeff:'0%',replenish:false,judge:t("app.1059", "SKU \u72b6\u6001 = stopped / discontinued")}
  ];
  const html='<div style="padding:4px 8px"><div style="background:#f6f8fa;padding:12px;border-radius:6px;margin-bottom:14px;font-size:13px;line-height:1.6">'+
    t('gen.L6351.1','<b>📌 生命周期的作用</b><br>')+
    t('gen.L6352.1','生命周期是辅助系统判断补货策略的字段，影响 <b>建议补货量</b> 和 <b>建议动作</b>。<br>')+
    t('gen.L6353.1','可在 <b>商品管理 → 生命周期</b> 字段手动调整。')+
    '</div>'+
    '<div class="table-container" style="box-shadow:none;border:1px solid #e1e4e8"><table class="data-table">'+
    t('gen.L6356.1','<thead><tr><th>标签</th><th>系统判断依据</th><th>补货策略</th><th style="text-align:center">补货系数</th><th style="text-align:center">是否补货</th></tr></thead>')+
    '<tbody>'+rows.map(r=>'<tr>'+
      '<td><span class="lifecycle-tag lc-'+r.k+'">'+r.label+'</span></td>'+
      '<td style="font-size:12px;color:#586069">'+r.judge+'</td>'+
      '<td style="font-size:12px">'+r.strategy+'</td>'+
      '<td style="text-align:center;font-weight:bold">'+r.coeff+'</td>'+
      '<td style="text-align:center">'+(r.replenish?t('gen.L6362.1','<span class="status-badge status-completed">是</span>'):t('gen.L6362.2','<span class="status-badge status-secondary">否</span>'))+'</td>'+
    '</tr>').join('')+
    '</tbody></table></div>'+
    '<div style="margin-top:12px;padding:10px 12px;background:#fff8c5;border-radius:6px;font-size:12px;color:#586069;line-height:1.6">'+
      t('gen.L6366.1','<b>💡 计算公式</b><br>')+
      t('gen.L6367.1','建议补货量 = max(0, 目标库存 − 总库存池)（结果按箱规/MOQ 取整；慢销/呆滞/高库存等会被拦截为 0）<br>')+
      t('gen.L6368.1','• 总库存池 = 当前可用 + 在途 + PI 已确认未发货 + PO 未确认 PI<br>')+
      t('gen.L6369.1','• 目标库存月数 默认 4（后端配置，本轮不在"预测参数设置"界面调整）<br>')+
      t('gen.L6370.1','• 生命周期系数当前不参与建议补货量数值计算（仅用于建议动作/经营建议文案）<br>')+
      t("app.1073", "\u2022 \u6ce8\u610f\uff1a\u6708\u5747\u9500\u91cf\u3001\u5f53\u524d\u53ef\u7528\u5468\u8f6c\u3001\u5f53\u524d\u5468\u8f6c\u3001\u5f53\u524d\u6d4b\u7b97\u5468\u8f6c\u3001\u5728\u9014\u540e\u5468\u8f6c\u3001\u4e0b\u5355\u540e\u5468\u8f6c\u3001\u9884\u8ba1\u5468\u8f6c\u6708\u6570\u3001\u5360\u6bd4\u3001\u5206\u644a\u5e93\u5b58\u3001\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf\u5747\u5df2\u6309\u5f53\u524d\u300c\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u300d\u8ba1\u7b97\uff1b\u4ec5\u5206\u7c7b/\u98ce\u9669/\u62e6\u622a\u5c42\uff08\u52a8\u9500\u72b6\u6001\u3001\u98ce\u9669\u6807\u7b7e\uff09\u4ecd\u6309\u8fd1 4 \u4e2a\u6708\u53e3\u5f84\uff0c\u5c5e\u9636\u6bb5\u6027\u62c6\u5206\uff08\u975e bug\uff09\u3002")+
    '</div></div>';
  openModal(t("app.1074", "\ud83d\udcd6 \u751f\u547d\u5468\u671f\u8bf4\u660e"), html, t('gen.L6373.1','<button class="btn btn-primary" onclick="closeModal()">关闭</button>'));
}

// ==================== 成本管理 ====================
async function renderCost(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>'+
    '<div class="tab-bar">'+
      '<div class="tab-item active" onclick="switchCostTab(\'alloc\',this)">'+t("cost.tab_alloc","📊 费用分摊")+'<</div>'+
      '<div class="tab-item" onclick="switchCostTab(\'origin\',this)">'+t("cost.tab_origin","📦 原库存导入")+'<</div>'+
      '<div class="tab-item" onclick="switchCostTab(\'wac\',this)">'+t("cost.tab_wac","💰 加权平均成本")+'<</div>'+
      '<div class="tab-item" onclick="switchCostTab(\'logs\',this)">'+t("cost.tab_logs","📝 成本更新日志")+'<</div>'+
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
  document.getElementById('cost-tab-content').innerHTML='<div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>'+t("col.ci","CI号")+'<</label><input type="text" id="cost-ci" onkeypress="if(event.key===\'Enter\')fetchCostAlloc()"></div><div class="filter-group"><label>'+t("col.sku","SKU")+'<</label><input type="text" id="cost-sku" onkeypress="if(event.key===\'Enter\')fetchCostAlloc()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="fetchCostAlloc()">'+t("action.search","搜索")+'<</button></div></div></div><div id="cost-alloc-table"><div class="empty-state"><div class="empty-icon">📊</div>'+t("empty.search_cost_alloc","请搜索查看费用分摊数据")+'<</div></div>';
  fetchCostAlloc();
}
async function fetchCostAlloc(){
  try{
    const ci=document.getElementById('cost-ci')?.value||'',sku=document.getElementById('cost-sku')?.value||'';
    const data=await api('/api/cost-allocations?ci_no='+encodeURIComponent(ci)+'&sku_code='+encodeURIComponent(sku));
    document.getElementById('cost-alloc-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">📊</div>'+t("empty.no_cost_data","暂无成本数据")+'<</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("col.ci","CI号")+'<</th><th>'+t("col.sku","SKU")+'<</th><th>'+t("cost.col_product_cost","商品成本")+'<</th><th>'+t("cost.col_alloc_freight","分摊运费")+'<</th><th>'+t("cost.col_alloc_duty","分摊关税")+'<</th><th>'+t("cost.col_alloc_other","分摊其他")+'<</th><th>'+t("cost.col_landing_total","总落地成本")+'<</th><th>'+t("col.inbound_qty","入库量")+'<</th><th>'+t("cost.col_unit_product_cost","单位商品成本")+'<</th><th>'+t("cost.col_unit_alloc_cost","单位分摊成本")+'<</th><th>'+t("cost.col_unit_landing_with_fees","含费单位成本")+'<</th><th>'+t("col.original_qty","原库存量")+'<</th><th>'+t("col.original_cost","原成本")+'<</th><th>'+t("cost.col_currency","币种")+'<</th></tr></thead><tbody>'+data.map(c=>'<tr><td class="cell-id">'+esc(c.ci_no)+'</td><td class="cell-id">'+esc(c.sku_code)+'</td><td class="text-right">'+fmtMoney(c.product_cost)+'</td><td class="text-right">'+fmtMoney(c.allocated_freight)+'</td><td class="text-right">'+fmtMoney(c.allocated_duty)+'</td><td class="text-right">'+fmtMoney(c.allocated_other)+'</td><td class="text-right font-bold">'+fmtMoney(c.total_landing_cost)+'</td><td class="text-right">'+(c.inbound_qty||0)+'</td><td class="text-right">'+fmtMoney(c.unit_product_cost)+'</td><td class="text-right">'+fmtMoney(c.unit_allocated_cost)+'</td><td class="text-right font-bold">'+fmtMoney(c.unit_landing_cost_with_fees||c.unit_landing_cost)+'</td><td class="text-right">'+(c.original_qty||0)+'</td><td class="text-right">'+fmtMoney(c.original_avg_cost)+'</td><td>'+esc(c.currency)+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
// Tab 2: 原库存导入
async function loadCostOrigin(){
  document.getElementById('cost-tab-content').innerHTML=t('html.loadCostOrigin', '<div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>选择CI</label><select id="orig-ci" onchange="loadOriginRecords()"><option value="">选择CI</option></select></div><div class="filter-actions">{v1}{v2}</div></div></div><div id="origin-check"></div><div id="origin-records"></div>', {v1: hasPermission('cost_view')?t('gen.L6410.1','<button class="btn btn-secondary btn-sm" onclick="downloadOriginTemplate()">📥 下载模板</button>'):'', v2: hasPermission('cost_view')?t('gen.L6410.2','<button class="btn btn-primary btn-sm" onclick="importOriginInventory()">📤 导入原库存</button>'):''});
  try{
    const cis=await api('/api/commercial-invoices');
    document.getElementById('orig-ci').innerHTML=t('html.loadCostOrigin.2', '<option value="">选择CI</option>{v1}', {v1: cis.map(c=>'<option value="'+c.id+'">'+esc(c.ci_no)+' - '+esc(c.supplier_name)+' ('+fmtMoney(c.goods_amount)+')</option>').join('')});
  }catch(e){showFlash(e.message,'danger')}
}
async function loadOriginRecords(){
  const ciId=document.getElementById('orig-ci')?.value;
  if(!ciId){document.getElementById('origin-check').innerHTML='';document.getElementById('origin-records').innerHTML='';return}
  try{
    const check=await api('/api/original-inventory/'+ciId+'/check');
    document.getElementById('origin-check').innerHTML=t('html.loadOriginRecords', '<div class="stats-grid mb-16"><div class="stat-card {v1}"><div class="stat-number">{v2}</div><div class="stat-label">原库存导入状态</div></div><div class="stat-card"><div class="stat-number">{v3}/{v4}</div><div class="stat-label">已导入/总SKU数</div></div></div>{v5}', {v1: check.all_imported?'success':'warning', v2: check.all_imported?t('gen.L6421.1','✅ 已完成'):t("inventory.007", "\u26a0\ufe0f \u672a\u5b8c\u6210"), v3: check.imported_skus, v4: check.total_skus, v5: check.missing_skus&&check.missing_skus.length?t('gen.L6421.2','<div class="flash flash-warning show">缺少SKU: ')+esc(check.missing_skus.join(', '))+'</div>':''});
    const records=await api('/api/original-inventory/'+ciId);
    document.getElementById('origin-records').innerHTML=!records.length?'<div class="empty-state"><div class="empty-icon">📦</div>'+t("empty.no_origin_data","暂无原库存数据")+'<</div>':'<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">'+t("cost.section_origin_records","📦 原库存记录")+'<</div></div><div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("col.sku","SKU")+'<</th><th>'+t("app.113","国家")+'<</th><th>'+t("app.114","仓库")+'<</th><th>'+t("cost.col_original_qty","原库存数量")+'<</th><th>'+t("col.remark","备注")+'<</th><th>'+t("cost.col_import_time","导入时间")+'<</th></tr></thead><tbody>'+records.map(r=>'<tr><td class="cell-id">'+esc(r.sku_code)+'</td><td>'+esc(r.country)+'</td><td>'+esc(r.warehouse)+'</td><td class="text-right font-bold">'+(r.original_qty||0)+'</td><td>'+esc(r.remark)+'</td><td class="cell-date">'+fmtDate(r.imported_at)+'</td></tr>').join('')+'</tbody></table></div></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function downloadOriginTemplate(){
  try{
    const t=await api('/api/original-inventory/template');
    const ws=XLSX.utils.json_to_sheet(t.sample);
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,t("app.1077", "\u539f\u5e93\u5b58\u6a21\u677f"));
    XLSX.writeFile(wb,t("app.1078", "\u539f\u5e93\u5b58\u6570\u91cf\u5bfc\u5165\u6a21\u677f.xlsx"));
  }catch(e){showToast(e.message,'danger')}
}
async function importOriginInventory(){
  const ciId=document.getElementById('orig-ci')?.value;
  if(!ciId){showToast(''+t("validation.select_ci_first","请先选择CI")+'','warning');return}
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
        if(rows.length<2){showToast(''+t("validation.file_empty","文件为空")+'','danger');return}
        const headers=rows[0].map(h=>String(h||'').trim());
        const items=[];
        for(let i=1;i<rows.length;i++){
          const row=rows[i];if(!row||row.every(c=>!c))continue;
          const skuIdx=headers.findIndex(h=>h==='SKU'||h==='sku_code');
          const qtyIdx=headers.findIndex(h=>h.includes(t("app.279", "\u539f\u5e93\u5b58"))||h==='original_qty');
          const countryIdx=headers.findIndex(h=>h==='国家'||h==='country');
          const whIdx=headers.findIndex(h=>h==='仓库'||h==='warehouse');
          const remarkIdx=headers.findIndex(h=>h===t("col.remark", "备注")||h==='remark');
          if(skuIdx>=0&&row[skuIdx])items.push({sku_code:String(row[skuIdx]).trim(),original_qty:parseFloat(row[qtyIdx])||0,country:countryIdx>=0?String(row[countryIdx]||'').trim():'',warehouse:whIdx>=0?String(row[whIdx]||'').trim():'',remark:remarkIdx>=0?String(row[remarkIdx]||'').trim():''});
        }
        if(!items.length){showToast(''+t("validation.no_valid_data","未找到有效数据")+'','danger');return}
        const result=await api('/api/original-inventory/import','POST',{ci_id:ciId,items});
        showToast(t('toast.importSuccessFail','导入完成: 成功{s}条, 失败{f}条',{s:result.success, f:result.failed}),'success');
        if(result.errors&&result.errors.length)console.log(t("app.1081", "\u5bfc\u5165\u9519\u8bef:"),result.errors);
        loadOriginRecords();
      }catch(err){showToast(t('toast.importOriginInventory', '导入失败: {v1}', {v1: err.message}),'danger')}
    };
    reader.readAsArrayBuffer(file);
  };
  input.click();
}
// Tab 3: 加权平均成本
async function loadCostWac(){
  document.getElementById('cost-tab-content').innerHTML='<div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>'+t("cost.select_ci","选择CI")+'</label><select id="wac-ci" onchange="loadWacDetail()"><option value="">'+t("cost.select_ci","选择CI")+'</option></select></div></div></div><div id="wac-detail"></div>';
  try{
    const cis=await api('/api/commercial-invoices');
    document.getElementById('wac-ci').innerHTML=t('html.loadCostWac', '<option value="">选择CI</option>{v1}', {v1: cis.map(c=>'<option value="'+c.id+'">'+esc(c.ci_no)+' - '+esc(c.supplier_name)+'</option>').join('')});
  }catch(e){showFlash(e.message,'danger')}
}
async function loadWacDetail(){
  const ciId=document.getElementById('wac-ci')?.value;
  if(!ciId){document.getElementById('wac-detail').innerHTML='';return}
  try{
    const summary=await api('/api/commercial-invoices/'+ciId+'/cost-summary');
    const check=await api('/api/original-inventory/'+ciId+'/check');
    const allocs=await api('/api/cost-allocation/'+ciId);
    const details=await api('/api/cost-allocation/'+ciId+'/details');
    let html='<div class="stats-grid mb-16">'+
      '<div class="stat-card"><div class="stat-number">'+fmtMoney(summary.goods_amount)+'</div><div class="stat-label">'+t("cost.stat_goods_amount","商品金额")+'<</div></div>'+
      '<div class="stat-card"><div class="stat-number">'+fmtMoney(summary.warehouse_arrival_total)+'</div><div class="stat-label">'+t("cost.stat_warehouse_fee","到仓费用")+'<</div></div>'+
      '<div class="stat-card"><div class="stat-number">'+fmtMoney(summary.customs_duty_total)+'</div><div class="stat-label">'+t("cost.stat_duty","关税")+'<</div></div>'+
      '<div class="stat-card"><div class="stat-number">'+fmtMoney(summary.inspection_fee_total)+'</div><div class="stat-label">'+t("cost.stat_inspection_fee","商检费用")+'<</div></div>'+
      '<div class="stat-card success"><div class="stat-number">'+fmtMoney(summary.landing_cost_total)+'</div><div class="stat-label">'+t("cost.stat_landing_total","落地成本总额")+'<</div></div>'+
    '</div>';
    // 状态指示
    html+='<div class="detail-card mb-16"><div class="detail-section"><h3>'+t("cost.op_flow","操作流程")+'<</h3><div class="detail-grid">'+
      '<div class="detail-item"><span class="detail-label">'+t("cost.step1","1. 录入费用")+'<</span><span class="detail-value">'+(summary.cost_items&&summary.cost_items.length>=1?''+t("cost.step1_done","✅ 已录入")+'':t("app.1088", "\u274c \u672a\u5f55\u5165"))+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t("cost.step2","2. 确认费用完整")+'<</span><span class="detail-value">'+(summary.cost_confirmed?''+t("cost.step2_done","✅ 已确认")+'':t("ci.021", "\u274c \u672a\u786e\u8ba4"))+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t("cost.step3","3. 费用分摊")+'<</span><span class="detail-value">'+(summary.cost_allocated?''+t("cost.step3_done","✅ 已分摊")+'':t("ci.023", "\u274c \u672a\u5206\u644a"))+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t("cost.step4","4. 导入原库存")+'<</span><span class="detail-value">'+(check.all_imported?''+t("cost.step4_done","✅ 已完成")+'':''+t("cost.step4_undone","❌ 未完成 (")+''+check.imported_skus+'/'+check.total_skus+')')+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t("cost.step5","5. 确认加权平均成本")+'<</span><span class="detail-value">'+(summary.wac_confirmed?''+t("cost.step5_done","✅ 已确认（版本已锁定）")+'':t("app.1090", "\u23f3 \u5f85\u6267\u884c"))+'</span></div>'+
    '</div>';
    // 操作按钮
    html+='<div class="flex gap-8 mt-16">'+
      (hasPermission('ci_edit')?'<button class="btn btn-secondary btn-sm" onclick="confirmCiCosts(\''+ciId+'\')">'+t("cost.btn_confirm_cost","✅ 确认费用完整")+'<</button>':'')+
      (hasPermission('ci_edit')?'<button class="btn btn-secondary btn-sm" onclick="allocateCosts(\''+ciId+'\')">'+t("cost.btn_allocate","📊 执行费用分摊")+'<</button>':'')+
      (hasPermission('ci_edit')?(summary.wac_confirmed?'<button class="btn btn-secondary btn-sm" disabled>'+t("cost.step2_done","✅ 已确认")+'<</button>':'<button class="btn btn-primary btn-sm" onclick="updateWeightedAvg(\''+ciId+'\')" '+(summary.cost_confirmed&&summary.cost_allocated&&check.all_imported?'':'disabled')+'>'+t("cost.btn_confirm_wac","💰 确认加权平均成本")+'<</button>'):'')+
    '</div></div>';
    // 分摊明细
    if(allocs&&allocs.length){
      html+='<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">'+t("cost.section_alloc_detail","📊 分摊明细")+'<</div></div><div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("col.sku","SKU")+'<</th><th>'+t("cost.col_product_cost","商品成本")+'<</th><th>'+t("cost.col_alloc_freight","分摊运费")+'<</th><th>'+t("cost.col_alloc_duty","分摊关税")+'<</th><th>'+t("cost.col_alloc_inspection","分摊商检")+'<</th><th>'+t("cost.col_landing_total","总落地成本")+'<</th><th>'+t("col.inbound_qty","入库量")+'<</th><th>'+t("cost.col_unit_landing_with_fees","含费单位成本")+'<</th><th>'+t("col.original_qty","原库存量")+'<</th><th>'+t("col.original_cost","原成本")+'<</th></tr></thead><tbody>'+allocs.map(a=>'<tr><td class="cell-id">'+esc(a.sku_code)+'</td><td class="text-right">'+fmtMoney(a.product_cost)+'</td><td class="text-right">'+fmtMoney(a.allocated_freight)+'</td><td class="text-right">'+fmtMoney(a.allocated_duty)+'</td><td class="text-right">'+fmtMoney(a.allocated_other)+'</td><td class="text-right font-bold">'+fmtMoney(a.total_landing_cost)+'</td><td class="text-right">'+(a.inbound_qty||0)+'</td><td class="text-right font-bold">'+fmtMoney(a.unit_landing_cost_with_fees||a.unit_landing_cost)+'</td><td class="text-right">'+(a.original_qty||0)+'</td><td class="text-right">'+fmtMoney(a.original_avg_cost)+'</td></tr>').join('')+'</tbody></table></div></div>';
    }
    if(details&&details.length){
      html+='<div class="table-section mt-16"><div class="table-section-title"><div class="table-section-title-left">'+t("cost.section_basis_evidence","分摊依据与尾差证据")+'<</div></div><div class="table-container" style="box-shadow:none;border-radius:0;overflow-x:auto"><table class="data-table"><thead><tr><th>'+t("cost.col_category","费用")+'<</th><th>'+t("cost.col_subcategory","小类")+'<</th><th>'+t("col.sku","SKU")+'<</th><th>'+t("cost.col_basis","依据")+'<</th><th>basis value</th><th>basis total</th><th>'+t("cost.col_ratio","比例")+'<</th><th>'+t("cost.col_theoretical","理论金额")+'<</th><th>'+t("cost.col_rounded","舍入金额")+'<</th><th>'+t("cost.col_rounding_adj","尾差调整")+'<</th><th>'+t("cost.col_final","最终金额")+'<</th></tr></thead><tbody>'+details.map(d=>'<tr><td>'+esc(d.cost_category)+'</td><td>'+esc(d.cost_subcategory)+'</td><td class="cell-id">'+esc(d.sku_code)+(d.is_rounding_anchor?' *':'')+'</td><td>'+esc(d.allocation_basis)+'</td><td class="text-right">'+Number(d.basis_value||0).toFixed(4)+'</td><td class="text-right">'+Number(d.basis_total||0).toFixed(4)+'</td><td class="text-right">'+(Number(d.ratio||0)*100).toFixed(4)+'%</td><td class="text-right">'+Number(d.theoretical_amount||0).toFixed(6)+'</td><td class="text-right">'+fmtMoney(d.rounded_amount)+'</td><td class="text-right">'+fmtMoney(d.rounding_adjustment)+'</td><td class="text-right font-bold">'+fmtMoney(d.final_allocated_amount)+'</td></tr>').join('')+'</tbody></table></div></div>';
    }
    document.getElementById('wac-detail').innerHTML=html;
  }catch(e){showFlash(e.message,'danger')}
}
async function confirmCiCosts(ciId){
  if(document.getElementById('ci-cost-basis')&&!(await saveCiCostInputs(ciId,true)))return;
  try{await api('/api/commercial-invoices/'+ciId+'/confirm-costs','POST');showToast(''+t("toast.costs_confirmed_locked","费用已确认完整，运输依据和实际税率已锁定")+'','success');closeModal();loadWacDetail()}catch(e){showToast(e.message,'danger')}
}
async function allocateCosts(ciId){
  try{const r=await api('/api/cost-allocation/allocate/'+ciId,'POST');showToast(t('toast.costAllocated','费用分摊完成，共{n}条',{n:r.allocations?.length||0}),'success');loadWacDetail()}catch(e){showToast(e.message,'danger')}
}
async function updateWeightedAvg(ciId){
  if(!confirm(''+t("confirm.wac_generate","确认生成加权平均成本版本？\n\n这将生成并锁定的 WAC 历史版本，不会修改库存总表的数量、成本和金额。\n库存总表的加权平均成本将在 ERP 库存导入时自动匹配最新已确认版本。")+''))return;
  try{
    const r=await api('/api/cost-allocation/update-weighted-avg/'+ciId,'POST',{remark:''+t("cost.confirm_remark","成本确认")+''});
    showToast(t('toast.wacVersionLocked','加权平均成本版本已生成并锁定，共{n}条',{n:r.updated_count}),'success');
    // 显示详细结果
    if(r.logs&&r.logs.length){
      let logHtml='<div class="table-container"><table class="data-table"><thead><tr><th>'+t("col.sku","SKU")+'<</th><th>'+t("col.version","版本号")+'<</th><th>'+t("cost.col_original_inventory","原库存")+'<</th><th>'+t("col.old_cost","旧成本")+'<</th><th>'+t("col.inbound_qty","入库量")+'<</th><th>'+t("cost.col_unit_landing_cost","单位落地成本")+'<</th><th>'+t("cost.col_new_wac","新加权平均成本")+'<</th></tr></thead><tbody>'+r.logs.map(l=>'<tr><td class="cell-id">'+esc(l.sku_code)+'</td><td class="text-center font-bold">v'+l.version_no+'</td><td class="text-right">'+l.original_qty+'</td><td class="text-right">'+fmtMoney(l.old_avg_cost)+'</td><td class="text-right">'+l.inbound_qty+'</td><td class="text-right">'+fmtMoney(l.unit_landing_cost)+'</td><td class="text-right font-bold">'+fmtMoney(l.new_avg_cost)+'</td></tr>').join('')+'</tbody></table></div>';
      openModal(''+t("toast.wac_version_generated","加权平均成本版本已生成")+'',logHtml,'<button class="btn btn-primary" onclick="closeModal()">'+t("action.confirm","确定")+'<</button>');
    }
    loadWacDetail();
  }catch(e){showToast(e.message,'danger')}
}
// Tab 4: 成本更新日志
async function loadCostLogs(){
  document.getElementById('cost-tab-content').innerHTML='<div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>'+t("col.ci","CI号")+'<</label><input type="text" id="log-ci" onkeypress="if(event.key===\'Enter\')fetchCostLogs()"></div><div class="filter-group"><label>'+t("col.sku","SKU")+'<</label><input type="text" id="log-sku" onkeypress="if(event.key===\'Enter\')fetchCostLogs()"></div><div class="filter-group"><label>'+t("cost.filter_keyword","关键词")+'<</label><input type="text" id="log-kw" onkeypress="if(event.key===\'Enter\')fetchCostLogs()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="fetchCostLogs()">'+t("action.search","搜索")+'<</button></div></div></div><div id="cost-logs-table"><div class="empty-state"><div class="empty-icon">📝</div>'+t("empty.search_logs","请搜索查看日志")+'<</div></div>';
  fetchCostLogs();
}
async function fetchCostLogs(){
  try{
    const ci=document.getElementById('log-ci')?.value||'',sku=document.getElementById('log-sku')?.value||'',kw=document.getElementById('log-kw')?.value||'';
    const data=await api('/api/cost-update-logs?ci_no='+encodeURIComponent(ci)+'&sku_code='+encodeURIComponent(sku)+'&keyword='+encodeURIComponent(kw));
    document.getElementById('cost-logs-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">📝</div>'+t("empty.no_log_data","暂无日志数据")+'<</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("col.time","时间")+'<</th><th>'+t("col.sku","SKU")+'<</th><th>'+t("app.113","国家")+'<</th><th>'+t("app.114","仓库")+'<</th><th>'+t("col.related_po","关联PO")+'<</th><th>'+t("cost.col_rel_ci","关联CI")+'<</th><th>'+t("cost.col_original_inventory","原库存")+'<</th><th>'+t("col.old_cost","旧成本")+'<</th><th>'+t("col.inbound_qty","入库量")+'<</th><th>'+t("cost.col_ci_unit_cost","CI单位成本")+'<</th><th>'+t("cost.col_unit_landing_cost","单位落地成本")+'<</th><th>'+t("col.new_qty","新库存")+'<</th><th>'+t("col.new_cost","新成本")+'<</th><th>'+t("col.operator","操作人")+'<</th><th>'+t("col.remark","备注")+'<</th></tr></thead><tbody>'+data.map(l=>'<tr><td class="cell-date">'+fmtDate(l.created_at)+' '+String(l.created_at||'').split(' ')[1]||''+'</td><td class="cell-id">'+esc(l.sku_code)+'</td><td>'+esc(l.country)+'</td><td>'+esc(l.warehouse)+'</td><td class="cell-id">'+esc(l.related_po_no)+'</td><td class="cell-id">'+esc(l.related_ci_no)+'</td><td class="text-right">'+l.original_qty+'</td><td class="text-right">'+fmtMoney(l.old_avg_cost)+'</td><td class="text-right">'+l.inbound_qty+'</td><td class="text-right">'+fmtMoney(l.ci_unit_cost)+'</td><td class="text-right">'+fmtMoney(l.unit_landing_cost)+'</td><td class="text-right font-bold">'+l.new_qty+'</td><td class="text-right font-bold">'+fmtMoney(l.new_avg_cost)+'</td><td>'+esc(l.operator_name)+'</td><td>'+esc(l.remark)+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

// ==================== 付款管理 ====================
const PAY_CATEGORIES={goods:t("payment.category.goods","货款"),warehouse_arrival:t("app.1083", "\u5230\u4ed3\u8d39\u7528"),customs_duty:t("app.224", "\u5173\u7a0e"),inspection_fee:t("app.1084", "\u5546\u68c0\u8d39\u7528")};
const PAY_SUBCATS={
  goods:{deposit:t('term.deposit','定金'),balance:t('term.balance','尾款')},
  warehouse_arrival:{freight:t('term.freight','运费'),customs_clearance:t("app.434", "\u6e05\u5173\u8d39"),port_charges:t("app.435", "\u6e2f\u53e3\u8d39"),delivery:t("app.436", "\u6d3e\u9001\u8d39"),warehouse:t("app.437", "\u4ed3\u50a8\u8d39"),other_local:t("app.438", "\u5176\u4ed6\u672c\u5730\u8d39")},
  customs_duty:{duty:t("app.224", "\u5173\u7a0e")},
  inspection_fee:{inspection:t("app.439", "\u5546\u68c0\u8d39")}
};
const PAY_STATUS_MAP={pending_approval:t("shell.072", "\u5f85\u5ba1\u6279"),approved:t("shell.073", "\u5df2\u5ba1\u6279"),paid:t("app.1094", "\u5df2\u4ed8\u6b3e"),rejected:t("app.1095", "\u5df2\u9a73\u56de"),partial_paid:t("app.1096", "\u90e8\u5206\u4ed8\u6b3e"),partial_deduction:t("app.1097", "\u90e8\u5206\u62b5\u6263"),partial_rounding:t("app.1098", "\u90e8\u5206\u62b9\u96f6"),deduction_settled:t("app.1099", "\u5168\u989d\u62b5\u6263"),partial_payment_partial_deduction:t("app.1100", "\u90e8\u5206\u4ed8\u6b3e+\u90e8\u5206\u62b5\u6263"),reversed:t("app.1101", "\u5df2\u51b2\u9500"),cancelled:t("shell.085", "\u5df2\u53d6\u6d88")};

// ==================== FIN-DASHBOARD-01：财务应付驾驶舱（只读）====================
let _cockpitData=null;
async function renderPayableCockpit(){
  const el=document.getElementById('content-inner');
  el.innerHTML='<div id="flash-container"></div><div style="padding:20px;color:var(--text-secondary,#888)">'+t("cockpit.loading","加载中…")+'</div>';
  try{
    const data=await api('/api/finance/payable-cockpit');
    _cockpitData=data;
    renderCockpitView();
  }catch(e){
    el.innerHTML=t('html.renderPayableCockpit', '<div id="flash-container"></div><div class="flash flash-danger show">加载应付驾驶舱失败：{v1}</div>', {v1: esc(e.message)});
  }
}

function cockpitCard(label,valueHtml,tone,sub){
  const toneColor={total:'var(--text-primary,#222)',settled:'#2e7d32',outstanding:'#1565c0',warn:'#f57f17',danger:'#c62828',info:'#6a1b9a'}[tone]||'var(--text-primary,#222)';
  return '<div style="flex:1;min-width:150px;padding:14px 16px;background:var(--bg-card,#fff);border:1px solid var(--border,#e6e6e6);border-radius:10px">'
    +'<div style="font-size:12px;color:var(--text-secondary,#888);margin-bottom:6px">'+esc(label)+'</div>'
    +'<div style="font-size:20px;font-weight:700;color:'+toneColor+'">'+valueHtml+'</div>'
    +(sub?'<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:4px">'+sub+'</div>':'')
    +'</div>';
}
function cockpitCurBreakdown(d,field){
  return (d.currencies||[]).map(cur=>{
    const m=d.metrics[cur];if(!m)return '';
    return '<div style="font-size:15px;line-height:1.5"><span style="color:var(--text-secondary,#999);font-size:11px;margin-right:4px">'+esc(cur)+'</span>'+esc(fmtMoney(m[field]))+'</div>';
  }).join('');
}
function cockpitSupplierStatus(s){
  if(s.overdue_amount>0) return '<span style="color:#c62828">'+t("cockpit.status_overdue","已逾期")+'</span>';
  if(s.due_soon>0) return '<span style="color:#f57f17">'+t("cockpit.status_due_soon","即将到期")+'</span>';
  if(s.outstanding>0 && !s.earliest_due_date) return '<span style="color:#999">'+t("cockpit.status_no_due","无到期日")+'</span>';
  return '<span style="color:#2e7d32">'+t("cockpit.status_normal","正常")+'</span>';
}
// 费用类型展示别名（仅展示用，底层 payment_category / 计算逻辑不变）
const COCKPIT_CAT_ALIAS={goods:''+t("cockpit.cat_goods","货款")+'',warehouse_arrival:t("pi.022", "\u8fd0\u8f93\u8d39"),customs_duty:t("app.224", "\u5173\u7a0e"),inspection_fee:t("pi.023", "\u68c0\u9a8c\u8d39")};
function cockpitCatAlias(cat){return COCKPIT_CAT_ALIAS[cat]||t("ci.035", "\u5176\u4ed6\u8d39\u7528");}
function toggleCockpitDetail(){
  const body=document.getElementById('cockpit-detail-body');
  const tog=document.getElementById('cockpit-detail-toggle');
  if(!body)return;
  const open=body.style.display==='none';
  body.style.display=open?'':'none';
  if(tog)tog.textContent=open?''+t("cockpit.collapse","收起 ▲")+'':t("app.1103", "\u5c55\u5f00\u67e5\u770b \u25bc");
  if(open)renderCockpitDetails();
}
function cockpitShowAnomaly(){
  const only=document.getElementById('cockpit-only-outstanding');if(only)only.checked=true;
  const nd=document.getElementById('cockpit-only-nodue');if(nd)nd.checked=true;
  const kw=document.getElementById('cockpit-detail-kw');if(kw)kw.value='';
  const body=document.getElementById('cockpit-detail-body');if(body)body.style.display='';
  const tog=document.getElementById('cockpit-detail-toggle');if(tog)tog.textContent=t("app.1102", "\u6536\u8d77 \u25b2");
  renderCockpitDetails();
  // ④ UX：异常卡片联动同步提示（纯展示，不改动任何筛选/聚合逻辑）
  const ndRows=getCockpitView().details.filter(r=>!r.has_due);
  let note=document.getElementById('cockpit-anomaly-note');
  if(!note){ note=document.createElement('div'); note.id='cockpit-anomaly-note'; note.style='font-size:12px;color:#f57f17;margin:4px 0 8px'; const body=document.getElementById('cockpit-detail-body'); if(body) body.insertBefore(note, body.firstChild); }
  note.textContent=t('text.cockpitShowAnomaly', '已自动筛选：仅显示无到期日单据（共 {v1} 笔）。可在上方筛选栏调整。', {v1: ndRows.length});
  const box=document.getElementById('cockpit-detail-table');if(box)box.scrollIntoView({behavior:'smooth',block:'start'});
}

// ===== FIN-DASHBOARD-UX-02：筛选与展示增强（纯展示层，不改动任何业务计算/结算/汇率规则） =====
function isoAddDays(iso,n){ const dt=new Date(iso+'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate()+n); return dt.toISOString().split('T')[0]; }
function cockpitActiveFilters(){
  const g=id=>document.getElementById(id);
  return {
    country:(g('cockpit-f-country')?g('cockpit-f-country').value:''),
    supplier:(g('cockpit-f-supplier')?g('cockpit-f-supplier').value:''),
    currency:(g('cockpit-f-currency')?g('cockpit-f-currency').value:''),
    category:(g('cockpit-f-category')?g('cockpit-f-category').value:'')
  };
}
function cockpitFilteredDetails(){
  const d=_cockpitData; if(!d) return [];
  const f=cockpitActiveFilters();
  let rows=d.details;
  if(f.country==='__NONE__') rows=rows.filter(r=>!(r.country||''));
  else if(f.country) rows=rows.filter(r=>(r.country||'')===f.country);
  if(f.supplier) rows=rows.filter(r=>r.supplier_name===f.supplier);
  if(f.currency) rows=rows.filter(r=>r.currency===f.currency);
  if(f.category) rows=rows.filter(r=>r.payment_category===f.category);
  return rows;
}
// 从（过滤后）details 客户端重算聚合：仅分组求和 + 到期桶划分，不触碰 paymentSettlementFacts/unpaid_amount/payable_date/payment status/汇率
function cockpitAggregate(rows){
  const d=_cockpitData; const today=d.today;
  const d7=isoAddDays(today,7), d30=isoAddDays(today,30);
  const metrics={};
  const bump=cur=>{ if(!metrics[cur]) metrics[cur]={currency:cur,request_count:0,gross_payable:0,settled:0,outstanding:0,due_7:0,due_30:0,overdue_amount:0,overdue_count:0,no_due_outstanding:0}; return metrics[cur]; };
  rows.forEach(r=>{
    const m=bump(r.currency);
    m.request_count++; m.gross_payable+=r.gross_payable; m.settled+=r.settled; m.outstanding+=r.outstanding;
    if(r.outstanding>0){
      if(!r.has_due){ m.no_due_outstanding+=r.outstanding; }
      else if(r.payable_date<today){ m.overdue_amount+=r.outstanding; m.overdue_count++; }
      else { if(r.payable_date<=d7) m.due_7+=r.outstanding; if(r.payable_date<=d30) m.due_30+=r.outstanding; }
    }
  });
  const supMap={};
  rows.forEach(r=>{
    const key=r.supplier_name+'||'+r.currency;
    if(!supMap[key]) supMap[key]={supplier_name:r.supplier_name,currency:r.currency,country_set:{},gross_payable:0,settled:0,outstanding:0,due_soon:0,overdue_amount:0,earliest_due_date:'',outstanding_count:0,request_count:0,ids:[],last_payment_date:''};
    const s=supMap[key];
    s.request_count++; s.ids.push(r.id); s.gross_payable+=r.gross_payable; s.settled+=r.settled; s.outstanding+=r.outstanding;
    if(r.country) s.country_set[r.country]=1;
    if(r.outstanding>0){
      s.outstanding_count++;
      if(r.has_due){ if(r.payable_date<today) s.overdue_amount+=r.outstanding; else if(r.payable_date<=d30) s.due_soon+=r.outstanding; if(!s.earliest_due_date||r.payable_date<s.earliest_due_date) s.earliest_due_date=r.payable_date; }
    }
    if(r.last_payment_date&&(!s.last_payment_date||r.last_payment_date>s.last_payment_date)) s.last_payment_date=r.last_payment_date;
  });
  const by_supplier=Object.values(supMap).map(s=>{
    s.brands=(d.supplier_brands&&d.supplier_brands[s.supplier_name])||'';
    s.country=Object.keys(s.country_set).join(', '); delete s.country_set;
    return s;
  }).sort((a,b)=>b.outstanding-a.outstanding);
  const catMap={};
  rows.forEach(r=>{
    const key=r.payment_category+'||'+r.currency;
    if(!catMap[key]) catMap[key]={payment_category:r.payment_category,category_label:r.category_label,currency:r.currency,gross_payable:0,settled:0,outstanding:0,request_count:0};
    const c=catMap[key]; c.request_count++; c.gross_payable+=r.gross_payable; c.settled+=r.settled; c.outstanding+=r.outstanding;
  });
  const by_category=Object.values(catMap).sort((a,b)=>b.outstanding-a.outstanding);
  const curs=Object.keys(metrics).sort();
  return {metrics,by_supplier,by_category,details:rows,curs};
}
// 无筛选：沿用服务端聚合（零回归），仅补充 brands/country 展示字段
function cockpitBaselineView(){
  const d=_cockpitData;
  const cm={};
  d.details.forEach(r=>{ if(r.country){ const k=r.supplier_name+'||'+r.currency; (cm[k]=cm[k]||{}); cm[k][r.country]=1; } });
  const by_supplier=d.by_supplier.map(s=>{ const k=s.supplier_name+'||'+s.currency; return Object.assign({},s,{brands:(d.supplier_brands&&d.supplier_brands[s.supplier_name])||'', country: cm[k]?Object.keys(cm[k]).join(', '):''}); });
  return {metrics:d.metrics,by_supplier,by_category:d.by_category,details:d.details,curs:d.currencies};
}
function getCockpitView(){
  const d=_cockpitData; if(!d) return null;
  const f=cockpitActiveFilters();
  const hasFilter=f.country||f.supplier||f.currency||f.category;
  return hasFilter?cockpitAggregate(cockpitFilteredDetails()):cockpitBaselineView();
}
function cockpitResetFilters(){
  ['cockpit-f-country','cockpit-f-supplier','cockpit-f-currency','cockpit-f-category'].forEach(id=>{ const e=document.getElementById(id); if(e)e.value=''; });
  renderCockpitLayers();
}

// 外壳：标题 + 口径说明 + 顶部筛选栏 + #cockpit-layers 容器
function renderCockpitView(){
  const d=_cockpitData;if(!d)return;
  const el=document.getElementById('content-inner');
  const allDetails=d.details||[];
  // 筛选下拉选项（来自全量 details，不受筛选影响，始终完整）
  const countrySet={}; allDetails.forEach(r=>{ countrySet[r.country||'']=1; });
  let countryOpts=''; if(countrySet['']) countryOpts+='<option value="__NONE__">'+t("cockpit.opt_notset","未设置(-)")+'</option>';
  Object.keys(countrySet).filter(c=>c).sort().forEach(c=>{ countryOpts+='<option value="'+esc(c)+'">'+esc(c)+'</option>'; });
  const supSet={}; allDetails.forEach(r=>{ supSet[r.supplier_name]=1; });
  const supplierOpts=Object.keys(supSet).sort().map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
  const curSet={}; allDetails.forEach(r=>{ if(r.currency) curSet[r.currency]=1; });
  const currencyOpts=Object.keys(curSet).sort().map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
  const catSet={}; allDetails.forEach(r=>{ if(r.payment_category) catSet[r.payment_category]=1; });
  const categoryOpts=Object.keys(catSet).sort().map(c=>'<option value="'+esc(c)+'">'+esc(cockpitCatAlias(c))+'</option>').join('');

  let html='<div id="flash-container"></div>';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-size:15px;font-weight:700">🧭 '+t("cockpit.title","财务应付驾驶舱")+'</div>'
    +'<div style="font-size:12px;color:var(--text-secondary,#999)">'+t("cockpit.lbl_data_time","数据时间")+' '+esc(fmtDate(d.generated_at))+' '+t("cockpit.lbl_today","｜ 今天")+' '+esc(d.today)+'</div></div>';
  html+='<details style="font-size:12px;color:var(--text-secondary,#999);margin-bottom:14px"><summary style="cursor:pointer">'+t("cockpit.caliber_note","口径说明")+'</summary><div style="line-height:1.7;padding:6px 0 0 14px">'
    +esc(d.notes.outstanding)+'<br>'+esc(d.notes.currency)+'<br>'+esc(d.notes.due_date)+'</div></details>';

  if(!d.currencies.length){
    html+='<div class="flash flash-info show">'+t("cockpit.no_valid","当前无有效应付单据。")+'</div>';
    el.innerHTML='<div class="cockpit-page">'+html+'</div>'; return;
  }
  // 顶部筛选栏（纯展示层，切换仅重渲染 #cockpit-layers，不请求后端）
  html+='<div class="filter-bar" style="margin:6px 0 10px"><div class="filter-form" style="flex-wrap:wrap">'
    +'<div class="filter-group"><label>'+t("cockpit.filter_country","国家")+'</label><select id="cockpit-f-country" onchange="renderCockpitLayers()"><option value="">'+t("cockpit.all","全部")+'</option>'+countryOpts+'</select></div>'
    +'<div class="filter-group"><label>'+t("cockpit.filter_supplier","供应商")+'</label><select id="cockpit-f-supplier" onchange="renderCockpitLayers()"><option value="">'+t("cockpit.all","全部")+'</option>'+supplierOpts+'</select></div>'
    +'<div class="filter-group"><label>'+t("cockpit.filter_currency","币种")+'</label><select id="cockpit-f-currency" onchange="renderCockpitLayers()"><option value="">'+t("cockpit.all","全部")+'</option>'+currencyOpts+'</select></div>'
    +'<div class="filter-group"><label>'+t("cockpit.filter_cat","费用类型")+'</label><select id="cockpit-f-category" onchange="renderCockpitLayers()"><option value="">'+t("cockpit.all","全部")+'</option>'+categoryOpts+'</select></div>'
    +'<div class="filter-actions"><button class="btn btn-secondary btn-sm" onclick="cockpitResetFilters()">'+t("cockpit.reset","重置")+'</button></div>'
    +'</div></div>';
  html+='<div id="cockpit-layers"></div>';
  el.innerHTML='<div class="cockpit-page">'+html+'</div>';
  renderCockpitLayers();
}

// 分层渲染（随筛选联动）：应付概览 / 费用构成 / 供应商总览 / 费用类型 / 应付明细
function renderCockpitLayers(){
  const d=_cockpitData;if(!d)return;
  const box=document.getElementById('cockpit-layers');if(!box)return;
  const v=getCockpitView();
  const curs=v.curs;
  let html='';
  // Layer 1 — 应付概览（④ UX：高优先信号前置——已逾期 / 未来压力 / 数据异常 排在各币种未结清之前）
  const ovCount=curs.reduce((a,cur)=>a+((v.metrics[cur]&&v.metrics[cur].overdue_count)||0),0);
  const noDueCount=v.details.filter(r=>r.outstanding>0&&!r.has_due).length;
  const noDueSub=noDueCount>0?'<span style="color:#f57f17;cursor:pointer" onclick="cockpitShowAnomaly()">'+t("cockpit.anomaly_hint","CI出货日/Credit未录入，点击查看 ▼")+'</span>':t("app.227", "\u65e0");
  html+='<div style="font-size:13px;font-weight:600;margin:6px 0 8px">'+t("cockpit.layer_overview","应付概览")+'</div>';
  html+='<div style="display:flex;flex-wrap:wrap;gap:10px">';
  html+=cockpitCard(t("pi.020", "\u5df2\u903e\u671f"),cockpitCurBreakdown(v,'overdue_amount'),'danger',ovCount+''+t("cockpit.unit_pi"," 笔")+'');
  html+=cockpitCard(t("app.1108", "\u672a\u67657\u5929\u4ed8\u6b3e\u538b\u529b"),cockpitCurBreakdown(v,'due_7'),'warn','');
  html+=cockpitCard(t("app.1109", "\u672a\u676530\u5929\u4ed8\u6b3e\u538b\u529b"),cockpitCurBreakdown(v,'due_30'),'warn','');
  html+=cockpitCard(t("app.1110", "\u6570\u636e\u5f02\u5e38\u63d0\u9192"),'<span style="font-size:22px">'+noDueCount+'</span><span style="font-size:13px;font-weight:400">'+t("cockpit.missing_due_date"," 笔缺少应付日期")+'</span>','info',noDueSub);
  curs.forEach(cur=>{
    const m=v.metrics[cur]; if(!m)return;
    html+=cockpitCard(cur+''+t("cockpit.unsettled"," 未结清")+'',esc(fmtMoney(m.outstanding)),'outstanding',esc(cur)+' '+m.request_count+''+t("cockpit.unit_pi"," 笔")+'');
  });
  html+='</div>';

  // Layer 2 — 金额构成
  html+='<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:10px">';
  curs.forEach(cur=>{ const m=v.metrics[cur]; html+=cockpitCard(cur+''+t("cockpit.lbl_total_payable"," 总应付")+'',esc(fmtMoney(m.gross_payable)),'total',''); html+=cockpitCard(cur+''+t("cockpit.lbl_settled"," 已结清")+'',esc(fmtMoney(m.settled)),'settled',''); });
  html+='</div>';

  // Layer 1.5 — 应付费用构成
  const catAgg={};
  (v.by_category||[]).forEach(c=>{
    const alias=cockpitCatAlias(c.payment_category);
    if(!catAgg[alias])catAgg[alias]={};
    if(!catAgg[alias][c.currency])catAgg[alias][c.currency]={outstanding:0};
    catAgg[alias][c.currency].outstanding+=c.outstanding;
  });
  const catOrder=[''+t("cockpit.cat_goods","货款")+'',t("pi.022", "\u8fd0\u8f93\u8d39"),t("app.224", "\u5173\u7a0e"),t("pi.023", "\u68c0\u9a8c\u8d39"),''+t("ci.035","其他费用")+''];
  const catCurs=curs.slice().sort();
  html+='<div style="margin-top:14px"><div style="font-size:13px;font-weight:600;margin:6px 0 8px">'+t("cockpit.layer_cost_composition","应付费用构成")+'</div><div style="display:flex;flex-wrap:wrap;gap:10px">';
  catOrder.forEach(alias=>{
    const curMap=catAgg[alias]||{};
    const curParts=catCurs.map(cur=>{
      const t=curMap[cur]||{outstanding:0};
      return '<div style="font-size:12px;line-height:1.5"><span style="color:var(--text-secondary,#999);font-size:11px;margin-right:4px">'+esc(cur)+'</span>'+esc(fmtMoney(t.outstanding))+'</div>';
    }).join('');
    html+='<div style="flex:1;min-width:150px;padding:12px 14px;background:var(--bg-card,#fff);border:1px solid var(--border,#e6e6e6);border-radius:10px">'
      +'<div style="font-size:12px;color:var(--text-secondary,#888);margin-bottom:6px">'+alias+'</div>'+curParts+'</div>';
  });
  html+='</div></div>';

  // Layer 3 — 供应商应付总览（含品牌/国家展示列，品牌仅关联展示）
  if((v.by_supplier||[]).length){
    html+='<div class="table-section" style="margin-top:16px"><div class="table-section-title"><div class="table-section-title-left">🏢 '+t("cockpit.layer_by_supplier","按供应商应付总览")+'</div><div style="font-size:12px;color:var(--text-secondary,#999)">'+t("cockpit.click_row_hint","点击任意行查看该供应商费用组成与付款明细")+'</div></div>';
    html+='<table class="data-table"><thead><tr><th>'+t("cockpit.col_supplier","供应商")+'</th><th>'+t("cockpit.col_brand","品牌")+'</th><th>'+t("cockpit.col_country","国家")+'</th><th>'+t("cockpit.col_currency","币种")+'</th><th style="text-align:right">'+t("cockpit.col_total_payable","总应付")+'</th><th style="text-align:right">'+t("cockpit.col_settled","已结清")+'</th><th style="text-align:right">'+t("cockpit.col_outstanding","未结清")+'</th><th>'+t("cockpit.col_status","状态")+'</th></tr></thead><tbody>';
    (v.by_supplier||[]).forEach(s=>{
      html+='<tr style="cursor:pointer" onclick="cockpitSupplierDrawer(\''+encodeURIComponent(s.supplier_name)+'\',\''+esc(s.currency)+'\')" title="'+t('cockpit.row_title','点击查看该供应商费用组成与付款明细')+'">'
        +'<td>'+esc(s.supplier_name)+'</td>'
        +'<td>'+(s.brands?'<span title="'+esc(s.brands)+'">'+esc(s.brands)+'</span>':'<span style="color:#999">—</span>')+'</td>'
        +'<td>'+(s.country?esc(s.country):'<span style="color:#999">—</span>')+'</td>'
        +'<td>'+esc(s.currency)+'</td>'
        +'<td style="text-align:right">'+fmtMoney(s.gross_payable)+'</td>'
        +'<td style="text-align:right;color:#2e7d32">'+fmtMoney(s.settled)+'</td>'
        +'<td style="text-align:right;color:#1565c0;font-weight:600">'+fmtMoney(s.outstanding)+'</td>'
        +'<td>'+cockpitSupplierStatus(s)+'</td></tr>';
    });
    html+='</tbody></table></div>';
  }

  // Layer 4 — 按费用类型汇总
  if((v.by_category||[]).length){
    html+='<div class="table-section" style="margin-top:16px"><div class="table-section-title"><div class="table-section-title-left">📊 '+t("cockpit.layer_by_category","按费用类型汇总")+'</div></div>';
    html+='<table class="data-table"><thead><tr><th>'+t("cockpit.filter_cat","费用类型")+'</th><th>'+t("cockpit.col_currency","币种")+'</th><th style="text-align:right">'+t("cockpit.col_total_payable","总应付")+'</th><th style="text-align:right">'+t("cockpit.col_settled","已结清")+'</th><th style="text-align:right">'+t("cockpit.col_outstanding","未结清")+'</th><th style="text-align:right">'+t("cockpit.col_count","笔数")+'</th></tr></thead><tbody>';
    v.by_category.forEach(c=>{
      html+='<tr><td>'+esc(c.category_label||c.payment_category)+'</td><td>'+esc(c.currency)+'</td>'
        +'<td style="text-align:right">'+fmtMoney(c.gross_payable)+'</td>'
        +'<td style="text-align:right;color:#2e7d32">'+fmtMoney(c.settled)+'</td>'
        +'<td style="text-align:right;color:#1565c0;font-weight:600">'+fmtMoney(c.outstanding)+'</td>'
        +'<td style="text-align:right">'+c.request_count+'</td></tr>';
    });
    html+='</tbody></table></div>';
  }

  // Layer 5 — 应付明细（默认折叠，保持原字段结构，不增加国家列）
  const totalCnt=v.details.length;
  const outCnt=v.details.filter(r=>r.outstanding>0).length;
  html+='<div class="table-section" style="margin-top:16px"><div class="table-section-title" style="cursor:pointer" onclick="toggleCockpitDetail()">'
    +'<div class="table-section-title-left">📋 '+t("cockpit.layer_details_prefix","应付明细（共")+' '+totalCnt+''+t("cockpit.layer_details_mid"," 条，未结清 ")+''+outCnt+''+t("cockpit.layer_details_suffix"," 条）")+'</div>'
    +'<div style="font-size:12px;color:var(--text-secondary,#999)" id="cockpit-detail-toggle">'+t("app.1103","展开查看 ▼")+'</div></div>'
    +'<div id="cockpit-detail-body" style="display:none">'
    +'<div class="filter-actions" style="margin:8px 0">'
    +'<label style="font-size:12px;margin-right:6px"><input type="checkbox" id="cockpit-only-outstanding" onchange="renderCockpitDetails()" checked> '+t("cockpit.only_outstanding","仅看未结清")+'</label>'
    +'<label style="font-size:12px;margin-right:6px"><input type="checkbox" id="cockpit-only-nodue" onchange="renderCockpitDetails()"> '+t("cockpit.only_no_due","仅看无到期日")+'</label>'
    +'<input type="text" id="cockpit-detail-kw" placeholder="'+t('cockpit.kw_placeholder','供应商/申请号/CI')+'" style="width:180px" oninput="renderCockpitDetails()">'
    +'</div><div id="cockpit-detail-table"></div></div></div>';
  box.innerHTML=html;
}

function cockpitStatusBadge(r){
  const color={paid:'#2e7d32',approved:'#1565c0',pending_approval:'#f57f17',rejected:'#c62828',reversed:'#c62828'}[r.status]||'#666';
  return '<span style="color:'+color+'">'+esc(r.status_label)+'</span>';
}

function renderCockpitDetails(preSupplier,preCurrency){
  const d=_cockpitData;if(!d)return;
  const box=document.getElementById('cockpit-detail-table');if(!box)return;
  const onlyOut=document.getElementById('cockpit-only-outstanding');
  const onlyNoDue=document.getElementById('cockpit-only-nodue');
  const kwEl=document.getElementById('cockpit-detail-kw');
  const kw=(kwEl?kwEl.value:'').trim().toLowerCase();
  let rows=getCockpitView().details.slice();
  if(onlyOut&&onlyOut.checked)rows=rows.filter(r=>r.outstanding>0);
  if(onlyNoDue&&onlyNoDue.checked)rows=rows.filter(r=>!r.has_due);
  if(preSupplier!==undefined){
    rows=rows.filter(r=>r.supplier_name===preSupplier&&r.currency===preCurrency);
  }
  if(kw)rows=rows.filter(r=>(r.supplier_name+' '+r.request_no+' '+(r.related_ci_no||'')+' '+(r.related_pi_no||'')).toLowerCase().includes(kw));
  let html='<table class="data-table"><thead><tr><th>'+t("cockpit.col_request_no","付款申请编号")+'</th><th>'+t("cockpit.col_supplier","供应商")+'</th><th>'+t("cockpit.col_source","来源")+'</th><th>'+t("cockpit.col_related_pi_ci","关联PI/CI")+'</th><th>'+t("cockpit.filter_cat","费用类型")+'</th><th>'+t("cockpit.col_payer","付款主体")+'</th><th>'+t("cockpit.col_currency","币种")+'</th><th style="text-align:right">'+t("cockpit.col_payable","应付")+'</th><th style="text-align:right">'+t("cockpit.col_written_off","已核销")+'</th><th style="text-align:right">'+t("cockpit.col_outstanding","未结清")+'</th><th>'+t("cockpit.col_due_date","到期日")+'</th><th style="text-align:right">'+t("cockpit.col_overdue_days","逾期天数")+'</th><th>'+t("cockpit.col_status","状态")+'</th></tr></thead><tbody>';
  if(!rows.length)html+='<tr><td colspan="13" style="text-align:center;color:#999;padding:20px">'+t("cockpit.no_match","无匹配记录")+'</td></tr>';
  rows.forEach(r=>{
    const rel=[r.related_pi_no,r.related_ci_no].filter(Boolean).join(' / ')||'—';
    const catTxt=(r.category_label||'')+(r.subcategory_label?' / '+r.subcategory_label:'');
    html+='<tr style="cursor:pointer" onclick="viewPayment(\''+r.id+'\')">'
      +'<td style="color:#1d6fd3">'+esc(r.request_no)+(r.source_mode==='historical'?' <span style="font-size:10px;color:#999">'+t("cockpit.historical","(历史)")+'</span>':'')+'</td>'
      +'<td>'+esc(r.supplier_name)+'</td>'
      +'<td>'+esc(r.source_type||'—')+'</td>'
      +'<td>'+esc(rel)+'</td>'
      +'<td>'+esc(catTxt||'—')+'</td>'
      +'<td>'+esc(r.payee_label||'—')+'</td>'
      +'<td>'+esc(r.currency)+'</td>'
      +'<td style="text-align:right">'+fmtMoney(r.gross_payable)+'</td>'
      +'<td style="text-align:right;color:#2e7d32">'+fmtMoney(r.settled)+'</td>'
      +'<td style="text-align:right;color:#1565c0;font-weight:600">'+fmtMoney(r.outstanding)+'</td>'
      +'<td>'+(r.payable_date||'<span style="color:#999">'+t("cockpit.status_no_due","无到期日")+'</span>')+'</td>'
      +'<td style="text-align:right;color:'+(r.overdue_days>0?'#c62828':'inherit')+'">'+(r.overdue_days>0?r.overdue_days:'—')+'</td>'
      +'<td>'+cockpitStatusBadge(r)+'</td></tr>';
  });
  html+='</tbody></table>';
  box.innerHTML=html;
}

function openCockpitDrawer(){
  const ov=document.getElementById('cockpit-drawer-overlay');
  const dr=document.getElementById('cockpit-drawer');
  if(ov)ov.classList.add('show');
  if(dr)dr.classList.add('open');
  document.addEventListener('keydown',cockpitDrawerEsc);
}
function closeCockpitDrawer(){
  const ov=document.getElementById('cockpit-drawer-overlay');
  const dr=document.getElementById('cockpit-drawer');
  if(ov)ov.classList.remove('show');
  if(dr)dr.classList.remove('open');
  document.removeEventListener('keydown',cockpitDrawerEsc);
}
function cockpitDrawerEsc(e){if(e.key==='Escape')closeCockpitDrawer();}
function cockpitSupplierDrawer(supplierEnc,currency){
  const supplier=decodeURIComponent(supplierEnc);
  const d=_cockpitData;if(!d)return;
  const rows=getCockpitView().details.filter(r=>r.supplier_name===supplier&&r.currency===currency);
  const brands=(d.supplier_brands&&d.supplier_brands[supplier])||'';
  const _cset={}; rows.forEach(r=>{ if(r.country) _cset[r.country]=1; });
  const countries=Object.keys(_cset).join(', ');
  const order=[''+t("cockpit.cat_goods","货款")+'',''+t("pi.022","运输费")+'',''+t("app.224","关税")+'',''+t("pi.023","检验费")+'',''+t("ci.035","其他费用")+''];
  const buckets={};let totalOut=0;
  rows.forEach(r=>{
    const alias=cockpitCatAlias(r.payment_category);
    if(!buckets[alias])buckets[alias]={outstanding:0};
    buckets[alias].outstanding+=r.outstanding;
    totalOut+=r.outstanding;
  });
  const maxOut=Math.max(1,...order.map(k=>(buckets[k]||{outstanding:0}).outstanding));
  const compHtml=order.map(k=>{
    const b=buckets[k]||{outstanding:0};
    const pct=Math.round(b.outstanding/maxOut*100);
    const dim=b.outstanding===0;
    return '<div style="margin-bottom:10px">'
      +'<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>'+k+'</span>'
      +'<span style="font-weight:600'+(dim?';color:#bbb':'')+'">'+esc(fmtMoney(b.outstanding))+' <span style="font-size:11px;color:#999">'+esc(currency)+'</span></span></div>'
      +'<div style="height:6px;background:#eef0f3;border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+(dim?'#e0e0e0':'#3370ff')+';border-radius:4px"></div></div></div>';
  }).join('');
  const detailHtml=rows.length?rows.map(r=>{
    const rel=[r.related_pi_no,r.related_ci_no].filter(Boolean).join(' / ')||'—';
    const catTxt=(r.category_label||'')+(r.subcategory_label?' / '+r.subcategory_label:'')||'—';
    return '<tr style="cursor:pointer" onclick="closeCockpitDrawer();viewPayment(\''+r.id+'\')">'
      +'<td style="color:#1d6fd3">'+esc(r.request_no)+(r.source_mode==='historical'?' <span style="font-size:10px;color:#999">'+t("cockpit.historical","(历史)")+'</span>':'')+'</td>'
      +'<td>'+esc(rel)+'</td>'
      +'<td>'+esc(catTxt||'—')+'</td>'
      +'<td style="text-align:right">'+fmtMoney(r.gross_payable)+'</td>'
      +'<td style="text-align:right;color:#2e7d32">'+fmtMoney(r.settled)+'</td>'
      +'<td style="text-align:right;color:#1565c0;font-weight:600">'+fmtMoney(r.outstanding)+'</td>'
      +'<td>'+(r.payable_date||'<span style="color:#999">'+t("cockpit.status_no_due","无到期日")+'</span>')+'</td>'
      +'<td>'+cockpitStatusBadge(r)+'</td></tr>';
  }).join('') : '<tr><td colspan="8" style="text-align:center;color:#999;padding:18px">'+t("cockpit.no_payment_record","无付款记录")+'</td></tr>';
  const html='<div class="drawer-header"><div>'
    +'<div style="font-size:15px;font-weight:700">'+esc(supplier)+'</div>'
    +'<div style="font-size:12px;color:var(--text-secondary,#999);margin-top:2px">'+esc(currency)
    +(brands?''+t("cockpit.lbl_brand"," ｜ 品牌 ")+''+esc(brands):'')
    +(countries?''+t("cockpit.lbl_country"," ｜ 国家 ")+''+esc(countries):'')
    +'</div>'
    +'<div style="font-size:12px;color:var(--text-secondary,#999);margin-top:8px">'+t("cockpit.lbl_outstanding_amount","未结清金额")+'</div>'
    +'<div style="font-size:24px;font-weight:700;color:#1565c0">'+esc(fmtMoney(totalOut))+' <span style="font-size:14px;color:#999">'+esc(currency)+'</span></div>'
    +'</div><button class="modal-close" onclick="closeCockpitDrawer()">×</button></div>'
    +'<div class="drawer-body">'
    +'<div style="font-size:13px;font-weight:600;margin-bottom:10px">'+t("cockpit.cost_composition","费用组成")+'</div>'+compHtml
    +'<div style="font-size:13px;font-weight:600;margin:18px 0 8px">'+t("cockpit.payment_detail_prefix","付款明细（")+''+rows.length+''+t("cockpit.payment_detail_suffix"," 笔）")+'</div>'
    +'<table class="data-table"><thead><tr><th>'+t("cockpit.col_payment_no","付款编号")+'</th><th>'+t("cockpit.col_source","来源")+'</th><th>'+t("cockpit.filter_cat","费用类型")+'</th><th style="text-align:right">'+t("cockpit.col_payable","应付")+'</th><th style="text-align:right">'+t("cockpit.col_paid","已付")+'</th><th style="text-align:right">'+t("cockpit.col_unpaid","未付")+'</th><th>'+t("cockpit.col_due_date","到期日")+'</th><th>'+t("cockpit.col_status","状态")+'</th></tr></thead><tbody>'+detailHtml+'</tbody></table>'
    +'</div>';
  const dr=document.getElementById('cockpit-drawer');
  if(dr){dr.innerHTML=html;openCockpitDrawer();}
}

async function renderPayment(){
  document.getElementById('content-inner').innerHTML=t('html.renderPayment', `<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="pay-fs"><option value="">全部</option><option value="pending_approval">待审批</option><option value="approved">已审批</option><option value="paid">已付款</option><option value="partial_paid">部分付款</option><option value="rejected">已驳回</option></select></div><div class="filter-group"><label>类别</label><select id="pay-fc"><option value="">全部</option><option value="goods">货款</option><option value="warehouse_arrival">到仓费用</option><option value="customs_duty">关税</option><option value="inspection_fee">商检费用</option></select></div><div class="filter-group"><label>关键词</label><input type="text" id="pay-fk" placeholder="申请号/供应商/来源单号" onkeypress="if(event.key==='Enter')loadPay()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadPay()">搜索</button>{v1}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">💳 付款申请</div></div><div id="pay-table"></div></div>`, {v1: hasPermission('payment_import')?t('gen.L6956.1','<button class="btn btn-secondary btn-sm" onclick="importPayResult()">📥 导入付款结果</button>'):''});
  loadPay();
}
// 统一付款申请详情弹窗（付款管理与审批中心财务类审批共用同一弹窗）
// mode：'view'=只读详情（付款管理，仅关闭）；'finance'=审批中心财务类审批（补审批意见 + 通过/驳回）
async function viewPayment(id, mode){
  mode=mode||'view';
  if(!hasPermission('payment_view')){showToast(t('toast.no_view_permission','无查看权限'),'danger');return}
  try{
    const p=await api('/api/payment-requests/'+id);
    const catLabel=PAY_CATEGORIES[p.payment_category]||p.payment_category;
    const subLabel=(PAY_SUBCATS[p.payment_category]&&PAY_SUBCATS[p.payment_category][p.payment_subcategory])||p.payment_subcategory||'';
    const stLabel=PAY_STATUS_MAP[p.payment_status]||p.payment_status;
    const cur=p.currency||'';
    const fld=(k,v)=>'<div class="detail-item"><span class="detail-label">'+k+'</span><span class="detail-value">'+v+'</span></div>';
    const qtyHtml=(p.total_qty!==null&&p.total_qty!==undefined)?'<b>'+Number(p.total_qty).toLocaleString('en-US')+'</b>':'<span style="color:#999">—'+t("payment.no_qty_detail","（费用/无货物明细）")+'</span>';
    // 返回上下文：从付款详情点开 PI/CI 后，需能返回本条付款详情（保留 mode）
    const backArg="'"+id+"','"+mode+"'";
    // 来源单号可点击：定金→PI，尾款/费用→CI（带返回上下文）
    let srcHtml=esc(p.source_no||'—');
    if(p.source_id&&(p.source_type==='pi'||p.source_type==='ci'||p.source_type==='historical_ci')){
      const fn=p.source_type==='pi'?'viewPI':(p.source_type==='ci'?'viewCI':'viewHistoricalCI');
      srcHtml='<a href="javascript:void(0)" style="color:#1d6fd3;cursor:pointer;text-decoration:underline" onclick="'+fn+'(\''+p.source_id+'\','+backArg+')">'+esc(p.source_no||p.source_id)+'</a>';
    }
    const summary='<div class="detail-grid">'
      + fld(t("app.303", "\u7533\u8bf7\u53f7"), esc(p.request_no))
      + fld(t("app.1136", "\u4ed8\u6b3e\u9636\u6bb5 / \u7c7b\u578b"), esc(catLabel+(subLabel?' / '+subLabel:'')))
      + fld(t("app.305", "\u6765\u6e90\u5355\u53f7"), srcHtml)
      + fld(t("app.213", "\u5173\u8054CI"), esc(p.related_ci_no||'—'))
      + fld(t("app.127", "\u5173\u8054PO"), esc(p.related_po_no||'—'))
      + fld(t("app.209", "\u4ed8\u6b3e\u5bf9\u8c61"), esc(p.supplier_name||'—'))
      + fld(t("app.129", "\u603b\u91d1\u989d"), fmtMoney(p.payable_amount, cur))
      + fld(t("app.1137", "\u7533\u8bf7\u91d1\u989d"), fmtMoney(p.payable_amount, cur))
      + fld(t("app.308", "\u5df2\u4ed8"), fmtMoney(p.paid_amount, cur))
      + fld(t("app.309", "\u672a\u4ed8"), fmtMoney(p.unpaid_amount, cur))
      + (p.deduction_amount>0?fld(t("app.306", "\u62b5\u6263\u91d1\u989d"), fmtMoney(p.deduction_amount, cur)):'')
      + (p.rounding_amount>0?fld(t("app.1138", "\u62b9\u96f6\u91d1\u989d"), fmtMoney(p.rounding_amount, cur)):'')
      + fld(t("app.1139", "\u5b9e\u9645\u4ed8\u6b3e\u65e5\u671f"), esc(p.paid_date||'—'))
      + fld(t("app.118", "\u5e01\u79cd"), esc(cur||'—'))
      + (p.payment_category!=='goods'?fld(t('term.fin.expense_country','费用归属国家'), esc(p.expense_country||t("app.445", "\u672a\u8bbe\u7f6e"))):'')
      + fld(t("app.195", "\u603b\u6570\u91cf"), qtyHtml)
      + fld(t("status.label", "\u72b6\u6001"), esc(stLabel))
      + fld(t("app.1140", "\u5ba1\u6279\u72b6\u6001"), statusLabel(p.approval_status))
      + fld(t("nav.payment_terms", "\u4ed8\u6b3e\u6761\u4ef6"), esc(p.payment_terms||'—'))
      + fld(t("app.025", "\u5907\u6ce8"), esc(p.remark||'—'))
      + (p.approval_remark?fld(t("app.1141", "\u5ba1\u6279\u610f\u89c1"), esc(p.approval_remark)+(p.approver_name?'（'+esc(p.approver_name)+'）':'')):'')
      +'</div>';
    let relHtml='';
    if(p.pi_summary){
      const pi=p.pi_summary;
      relHtml+='<div class="detail-section"><h3>'+t("payment.rel_pi_summary","关联 PI 摘要 ")+'<a href="javascript:void(0)" style="color:#1d6fd3;cursor:pointer;text-decoration:underline" onclick="viewPI(\''+pi.id+'\','+backArg+')">'+esc(pi.pi_no)+'</a></h3>'
        +'<div class="detail-grid">'
        + fld(t("app.116", "\u4f9b\u5e94\u5546"), esc(pi.supplier_name||'—'))
        + fld(t("app.112", "\u54c1\u724c"), esc(pi.brand||'—'))
        + fld(t("app.113", "\u56fd\u5bb6"), esc(pi.country||'—'))
        + fld(t("app.114", "\u4ed3\u5e93"), esc(pi.target_warehouse||'—'))
        + fld(t("app.147", "PI\u91d1\u989d"), fmtMoney(pi.total_amount, pi.currency))
        + fld(t("app.134", "PI\u72b6\u6001"), esc(formatPIStatus(pi.pi_status)||'—'))
        + fld(t("po.036", "PI\u65e5\u671f"), esc(fmtDate(pi.pi_date)))
        +'</div></div>';
    }
    if(p.ci_summary){
      const ci=p.ci_summary;
      relHtml+='<div class="detail-section"><h3>'+t("payment.rel_ci_summary","关联 CI 摘要 ")+'<a href="javascript:void(0)" style="color:#1d6fd3;cursor:pointer;text-decoration:underline" onclick="viewCI(\''+ci.id+'\','+backArg+')">'+esc(ci.ci_no)+'</a></h3>'
        +'<div class="detail-grid">'
        + fld(t("app.116", "\u4f9b\u5e94\u5546"), esc(ci.supplier_name||'—'))
        + fld(t("app.112", "\u54c1\u724c"), esc(ci.brand||'—'))
        + fld(t("app.113", "\u56fd\u5bb6"), esc(ci.country||'—'))
        + fld(t("app.114", "\u4ed3\u5e93"), esc(ci.target_warehouse||'—'))
        + fld(t("ci.039", "CI\u8d27\u503c"), fmtMoney(ci.goods_amount, ci.currency))
        + fld(t("ci.040", "CI\u72b6\u6001"), esc(ci.ci_status||'—'))
        + fld(t("app.947", "CI\u65e5\u671f"), esc(fmtDate(ci.ci_date)))
        + fld(t("app.127", "\u5173\u8054PO"), esc(ci.related_po_no||'—'))
        +'</div></div>';
    }
    if(p.historical_ci_summary){
      const h=p.historical_ci_summary;
      relHtml+='<div class="detail-section"><h3>'+t("payment.rel_his_ci_summary","关联历史 CI 摘要 ")+'<a href="javascript:void(0)" style="color:#1d6fd3;cursor:pointer;text-decoration:underline" onclick="viewHistoricalCI(\''+h.id+'\','+backArg+')">'+esc(h.historical_ci_no)+'</a></h3>'
        +'<div class="detail-grid">'
        + fld(t("app.116", "\u4f9b\u5e94\u5546"), esc(h.supplier_name||'—'))
        + fld(t("app.112", "\u54c1\u724c"), esc(h.brand_name||'—'))
        + fld(t("app.113", "\u56fd\u5bb6"), esc(h.country||'—'))
        + fld(t("app.1142", "\u5386\u53f2\u8d27\u6b3e\u603b\u989d"), fmtMoney(h.gross_goods_amount,h.currency))
        + fld(t("app.178", "\u5bfc\u5165\u5386\u53f2\u5df2\u4ed8"), fmtMoney(h.historical_paid_amount,h.currency))
        + fld(t("app.964", "\u5386\u53f2\u4ed8\u6b3e\u65e5\u671f"), esc(h.historical_paid_date||t("app.673", "\u672a\u77e5")))
        + fld(t("app.1143", "\u5386\u53f2CI\u65e5\u671f"), esc(fmtDate(h.ci_date)))
        + fld(t("app.1144", "\u6765\u6e90\u6a21\u5f0f"), 'historical')
        +'</div></div>';
    }
    const settlementLogs=p.settlement_logs||[];
    const settlementSection='<div class="detail-section"><h3>'+t("payment.settlement_records","结算记录")+'</h3>'+(settlementLogs.length
      ? '<div class="table-container" style="box-shadow:none;border:1px solid #eee"><table class="data-table"><thead><tr><th>'+t("col.type","类型")+'</th><th>'+t("col.amount","金额")+'</th><th>'+t("col.payment_date","付款日期")+'</th><th>'+t("col.rate_snapshot","汇率快照")+'</th><th>'+t("col.operator_time","操作人/时间")+'</th><th>'+t("col.status","状态")+'</th><th>'+t("common.actions","操作")+'</th></tr></thead><tbody>'+settlementLogs.map(log=>{
          const isPayment=log.event_type==='payment',isRounding=log.event_type==='rounding',isRoundingReversal=log.event_type==='rounding_reversal';
          const rateText=isPayment&&log.local_currency?(esc(log.original_currency||cur)+'→'+esc(log.local_currency)+' '+Number(log.local_rate||0)+'；'+esc(log.original_currency||cur)+'→RMB '+Number(log.rmb_rate||0)):'—';
          const state=isRoundingReversal?''+t("payment.state_reversal_evidence","撤销证据")+'':(log.status==='applied'?''+t("common.valid","有效")+'':''+t("payment.state_reversed","已冲销")+'');
          const action=log.status==='applied'&&!isRoundingReversal&&hasPermission('payment_approve')
            ? '<button class="btn btn-danger btn-sm" onclick="reversePaymentSettlement(\''+id+'\',\''+String(log.id).replace(/'/g,'')+'\',\''+log.event_type+'\')">'+(isRounding?''+t("payment.action_reverse_rounding","撤销抹零")+'':''+t("payment.action_reverse","冲销")+''+(isPayment?''+t("payment.type_pay","付款")+'':t("app.180", "\u62b5\u6263")))+'</button>' : '';
          const typeLabel=isPayment?''+t("payment.type_pay","付款")+'':(isRounding?''+t("payment.type_rounding","抹零")+'':(isRoundingReversal?''+t("payment.type_rounding_reversal","抹零撤销")+'':t("app.180", "\u62b5\u6263")));
          return '<tr><td>'+typeLabel+(log.is_legacy?''+t("payment.legacy_baseline","（历史基线）")+'':'')+'</td><td class="text-right">'+fmtMoney(log.amount,cur)+'</td><td>'+esc(log.paid_date||'—')+'</td><td style="font-size:12px">'+rateText+(isPayment&&log.local_currency?'<br>'+t("payment.local_currency","本币")+' '+fmtMoney(log.local_amount,log.local_currency)+'；'+t("payment.cny","人民币")+' '+fmtMoney(log.rmb_amount,'RMB'):'')+'</td><td>'+esc(log.operator_name||'—')+'<br><span style="font-size:12px;color:#999">'+esc((log.created_at||'').replace('T',' ').slice(0,19))+'</span></td><td><span class="status-badge '+(log.status==='applied'?'status-paid':'status-rejected')+'">'+state+'</span>'+(log.reversal_reason?'<br><span style="font-size:12px;color:#999">'+esc(log.reversal_reason)+'</span>':'')+'</td><td>'+action+'</td></tr>';
        }).join('')+'</tbody></table></div>'
      : '<div style="color:#999;font-size:13px">'+t("empty.no_settlement","暂无结算记录")+'</div>')+'</div>';
    // 附件（多文件）：归一化为数组
    let attaches=[];
    try{ const pv=(typeof p.attachment==='string'&&p.attachment)?JSON.parse(p.attachment):p.attachment; attaches=Array.isArray(pv)?pv:(pv&&pv.dataUrl?[{name:pv.name,type:pv.type,size:pv.size,dataUrl:pv.dataUrl}]:[]); }catch(e){ attaches=[]; }
    window._payId=id; window._payAttachments=attaches; window._payCanUpload=(hasPermission('payment_create')||hasPermission('payment_approve'));
    // 附件展示 + 上传区（view 与 finance 模式均显示）
    const attSection='<div class="detail-section"><h3>'+t('payment.attachments','付款申请附件')+'</h3>'
      +'<div id="pay-att-list">'+renderPayAttachmentListInner()+'</div>'
      +(window._payCanUpload
        ? '<div id="pay-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:22px 16px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s;margin-top:10px" '
          +'onclick="document.getElementById(\'pay-file-input\').click()" '
          +'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '
          +'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '
          +'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';payUploadFiles(window._payId, event.dataTransfer.files)">'
          +'<div style="font-size:32px;color:#1890ff;margin-bottom:6px">📎</div>'
          +'<div style="font-size:13px;color:#333;margin-bottom:3px">'+t("payment.upload_hint","点击上传或拖拽文件到此处")+'</div>'
          +'<div style="font-size:12px;color:#999">'+t("payment.support_formats","支持 图片 / PDF / Excel / Word 等，可多选")+'</div></div>'
          +'<input type="file" id="pay-file-input" multiple accept="image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx" style="display:none" onchange="payUploadFiles(window._payId, this.files)">'
        : '')
      +'</div>';
    // finance 模式且待审：补审批意见输入框（粘贴图片自动上传为附件）
    const isPendingApproval=(p.payment_status==='pending_approval'||p.approval_status==='pending');
    const canApprove=hasPermission('payment_approve');
    const opinionHtml=(mode==='finance'&&isPendingApproval&&canApprove)
      ? '<div class="detail-section"><h3>'+t("payment.opinion_title","审批意见")+'</h3><textarea id="pay-appr-remark" rows="3" placeholder="'+t("payment.approve_opinion_placeholder","填写审批意见（驳回时必填）；在框内粘贴图片可自动上传为附件")+'" style="width:100%;box-sizing:border-box" onpaste="onPayRemarkPaste(event)"></textarea></div>'
      : '';
    const body='<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>'+t("payment.summary","付款申请摘要")+'</h3>'+summary+'</div>'+relHtml+settlementSection+attSection+opinionHtml+'</div>';
    // footer：finance 模式待审 → 通过/驳回；否则仅关闭
    let footer='<button class="btn btn-secondary" onclick="closeModal()">'+t("common.close","关闭")+'</button>';
    if(mode==='finance'&&isPendingApproval&&canApprove){
      footer='<button class="btn btn-secondary" onclick="closeModal()">'+t("common.close","关闭")+'</button>'
        +'<button class="btn btn-danger" onclick="financeApprove(\''+id+'\',\'reject\')">⛔ '+t("action.reject","驳回")+'</button>'
        +'<button class="btn btn-primary" onclick="financeApprove(\''+id+'\',\'approve\')">✅ '+t("action.approve","通过")+'</button>';
    }
    openModal(t('modal.title.viewPayment', '付款申请详情 - {v1}', {v1: esc(p.request_no)}), body, footer);
  }catch(e){showToast(e.message,'danger')}
}
// ===== 付款申请附件（Layer 4：多文件上传/展示/删除/粘贴图片自动上传）=====
function fmtSize(b){ if(b==null)return ''; if(b<1024)return b+'B'; if(b<1024*1024)return (b/1024).toFixed(1)+'KB'; return (b/1024/1024).toFixed(1)+'MB'; }
function readFileAsDataURL(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f); }); }
function renderPayAttachmentListInner(){
  const arr=window._payAttachments||[];
  if(!arr.length) return '<div style="color:#999;font-size:13px">'+t('empty.noAttachment','暂无附件')+'</div>';
  return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">'+arr.map((a,idx)=>{
    const isImg=(a.type&&a.type.indexOf('image/')===0)||/\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name||'');
    const thumb=isImg?'<img src="'+a.dataUrl+'" style="width:54px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #eee;vertical-align:middle;cursor:pointer" onclick="openPayAttachmentUrl('+idx+')">':'';
    const nameLink='<a href="javascript:void(0)" style="color:#1d6fd3;cursor:pointer;text-decoration:underline;word-break:break-all" onclick="openPayAttachmentUrl('+idx+')">'+esc(a.name||(t('common.attachment','附件')+(idx+1)))+'</a>';
    const del=window._payCanUpload?'<button class="btn btn-danger btn-sm" style="margin-left:4px" onclick="payDeleteAttachment(window._payId,'+idx+')">'+t('action.delete','删除')+'</button>':'';
    return '<div style="border:1px solid #eee;border-radius:8px;padding:8px;display:flex;align-items:center;gap:8px;background:#fff;max-width:280px">'+thumb+'<div style="min-width:0">'+nameLink+'<div style="font-size:11px;color:#999">'+(a.size?fmtSize(a.size):'')+(a.uploaded_at?' · '+a.uploaded_at.slice(0,10):'')+'</div></div>'+del+'</div>';
  }).join('')+'</div>';
}
function renderPayAttachmentList(){ const el=document.getElementById('pay-att-list'); if(el) el.innerHTML=renderPayAttachmentListInner(); }
async function payUploadFiles(id, files){
  if(!files||!files.length)return;
  if(!(hasPermission('payment_create')||hasPermission('payment_approve'))){showToast(t('toast.uploadNoPermission','无附件上传权限'),'danger');return}
  const arr=window._payAttachments||[];
  try{
    for(const f of files){ const du=await readFileAsDataURL(f); arr.push({name:f.name,type:f.type,size:f.size,dataUrl:du,uploaded_at:new Date().toISOString()}); }
    await api('/api/payment-requests/'+id+'/attachment','POST',{attachment:arr});
    window._payAttachments=arr; renderPayAttachmentList();
    showToast(t('toast.attachmentUploaded','附件已上传（{n}）',{n:files.length}),'success');
  }catch(e){ showToast(e.message,'danger'); }
}
async function payDeleteAttachment(id, idx){
  const arr=window._payAttachments||[];
  if(idx<0||idx>=arr.length)return;
  arr.splice(idx,1);
  try{ await api('/api/payment-requests/'+id+'/attachment','POST',{attachment:arr}); window._payAttachments=arr; renderPayAttachmentList(); showToast(t('toast.attachmentDeleted','附件已删除'),'success'); }
  catch(e){ showToast(e.message,'danger'); }
}
// 附件 dataUrl → blob URL（PDF/其他文件用，避免 data: 协议在新标签/下载时受限）
function payAttachmentBlobUrl(a){
  const dataUrl=a.dataUrl||('data:'+(a.type||'')+';base64,'+(a.data||''));
  try{
    const m=dataUrl.match(/^data:(.*?);base64,(.*)$/);
    if(!m) return dataUrl;
    const mime=m[1]||a.type||'application/octet-stream';
    const bin=atob(m[2]); const arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr],{type:mime}));
  }catch(e){ return dataUrl; }
}
// 图片大图预览：独立 lightbox，叠在付款详情弹窗之上，关闭后回到详情（不破坏上下文）
function previewPayImage(idx){
  const a=(window._payAttachments||[])[idx]; if(!a)return;
  const url=a.dataUrl||('data:'+(a.type||'')+';base64,'+(a.data||''));
  let ov=document.getElementById('pay-img-lightbox');
  if(!ov){
    ov=document.createElement('div'); ov.id='pay-img-lightbox'; ov.className='modal-overlay';
    ov.style.zIndex='3000';
    ov.innerHTML='<div style="position:relative;max-width:92vw;max-height:92vh;display:flex;align-items:center;justify-content:center" onclick="event.stopPropagation()">'
      +'<img id="pay-img-lightbox-img" src="" style="max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.35)">'
      +'<button class="modal-close" style="position:absolute;top:-14px;right:-14px;background:#fff;color:#333;box-shadow:0 2px 8px rgba(0,0,0,.3)" onclick="closePayImageLightbox()">&times;</button></div>';
    ov.onclick=closePayImageLightbox;
    document.body.appendChild(ov);
  }
  document.getElementById('pay-img-lightbox-img').src=url;
  ov.classList.add('show');
}
function closePayImageLightbox(){ const ov=document.getElementById('pay-img-lightbox'); if(ov) ov.classList.remove('show'); }
// 附件点击：分层在线预览（图片弹窗大图 / PDF 新标签预览 / 其他下载）
function openPayAttachmentUrl(idx){
  const a=(window._payAttachments||[])[idx]; if(!a)return;
  const isImg=(a.type&&a.type.indexOf('image/')===0)||/\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name||'');
  const isPdf=(a.type==='application/pdf')||/\.pdf$/i.test(a.name||'');
  if(isImg){ previewPayImage(idx); }
  else if(isPdf){ const u=payAttachmentBlobUrl(a); if(u) window.open(u,'_blank'); }
  else { // 其他文件：点击即下载，可点击不无响应
    const u=payAttachmentBlobUrl(a);
    const link=document.createElement('a'); link.href=u; link.download=a.name||'download';
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  }
}
function onPayRemarkPaste(e){
  const cd=e.clipboardData||(e.originalEvent&&e.originalEvent.clipboardData);
  if(!cd||!cd.items)return;
  let imgFile=null;
  for(const it of cd.items){ if(it.kind==='file'&&it.type&&it.type.indexOf('image/')===0){ imgFile=it.getAsFile(); break; } }
  if(!imgFile)return; // 普通文本粘贴放行
  e.preventDefault();
  if(!(hasPermission('payment_create')||hasPermission('payment_approve'))){ showToast(t('gen.L7176.1','无附件上传权限'),'danger'); return; }
  payUploadFiles(window._payId,[imgFile]); // 粘贴图片自动上传为附件
}
// 财务类审批：通过 / 驳回（复用后端 POST /api/payment-requests/:id/approve，审批意见存 approval_remark）
async function financeApprove(id, action){
  const ta=document.getElementById('pay-appr-remark');
  const remark=ta?ta.value.trim():'';
  if(action==='reject'&&!remark){showToast(t('gen.L7183.1','驳回时审批意见必填'),'warning');if(ta)ta.focus();return}
  try{
    await api('/api/payment-requests/'+id+'/approve','POST',{action:action,remark:remark});
    showToast(action==='approve'?t('gen.L7186.1','已通过'):t('gen.L7186.2','已驳回'),'success');
    closeModal();
    if(typeof loadFinanceApprovalList==='function'&&document.getElementById('approval-list'))loadFinanceApprovalList();
    if(document.getElementById('pay-table'))loadPay();
  }catch(e){showToast(e.message,'danger')}
}
async function loadPay(){
  try{
    const s=document.getElementById('pay-fs')?.value||'',c=document.getElementById('pay-fc')?.value||'',k=document.getElementById('pay-fk')?.value||'';
    const data=await api('/api/payment-requests?status='+s+'&category='+c+'&keyword='+encodeURIComponent(k));
    document.getElementById('pay-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">💳</div>'+t('empty.noPaymentData','暂无付款数据')+'</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("html.pay.th.applyNo","申请号")+'</th><th>'+t("html.pay.th.category","大类")+'</th><th>'+t("html.pay.th.subcategory","小类")+'</th><th>'+t("html.pay.th.sourceNo","来源单号")+'</th><th>'+t("html.pay.th.relCI","关联CI")+'</th><th>'+t("html.pay.th.payee","付款对象")+'</th><th>'+t("html.pay.th.payable","应付金额")+'</th><th>'+t("html.pay.th.deduct","抵扣金额")+'</th><th>'+t("html.pay.th.actualPayable","实际应付")+'</th><th>'+t("html.pay.th.paid","已付")+'</th><th>'+t("html.pay.th.unpaid","未付")+'</th><th>'+t("html.pay.th.currency","币种")+'</th><th>'+t("html.pay.th.status","状态")+'</th><th>'+t("html.pay.th.action","操作")+'</th></tr></thead><tbody>'+data.map(p=>{
      const catLabel=PAY_CATEGORIES[p.payment_category]||p.payment_category;
      const subLabel=(PAY_SUBCATS[p.payment_category]&&PAY_SUBCATS[p.payment_category][p.payment_subcategory])||p.payment_subcategory||'';
      const stLabel=PAY_STATUS_MAP[p.payment_status]||p.payment_status;
      const stClass=p.payment_status==='paid'?'status-paid':p.payment_status==='approved'?'status-approved':p.payment_status==='rejected'?'status-rejected':p.payment_status.includes('partial')?'status-pending':'status-pending';
      const canPay=p.approval_status==='approved'&&Number(p.unpaid_amount||0)>0&&!['rejected','cancelled'].includes(p.payment_status);
      const canDeduct=p.approval_status==='pending'&&Number(p.paid_amount||0)<=0&&Number(p.deduction_amount||0)<=0&&Number(p.unpaid_amount||0)>0;
      const canRound=p.approval_status==='approved'&&Number(p.unpaid_amount||0)>0&&Number(p.rounding_amount||0)<=0&&!['rejected','cancelled'].includes(p.payment_status);
      const needsExpenseCountry=p.payment_category!=='goods'&&!String(p.expense_country||'').trim();
      const actualDisplay=Number(p.actual_pay_amount||0)>0||Number(p.deduction_amount||0)>0||Number(p.rounding_amount||0)>0?p.actual_pay_amount:p.payable_amount;
      return '<tr'+(hasPermission('payment_view')?(' class="clickable-detail-row" onclick="rowClickView(event,\'viewPayment\',\''+p.id+'\')"'):'')+'><td class="cell-id">'+esc(p.request_no)+'</td><td>'+esc(catLabel)+'</td><td>'+esc(subLabel)+'</td><td class="cell-id">'+esc(p.source_no)+'</td><td class="cell-id">'+esc(p.related_ci_no||'')+'</td><td>'+esc(p.supplier_name)+'</td><td class="text-right font-bold">'+fmtMoney(p.payable_amount)+'</td><td class="text-right '+(p.deduction_amount>0?'text-warning':'')+'">'+(p.deduction_amount>0?fmtMoney(p.deduction_amount):'-')+'</td><td class="text-right font-bold">'+fmtMoney(actualDisplay)+'</td><td class="text-right">'+fmtMoney(p.paid_amount)+'</td><td class="text-right '+(p.unpaid_amount>0?'text-danger':'')+'">'+fmtMoney(p.unpaid_amount)+'</td><td>'+esc(p.currency)+'</td><td><span class="status-badge '+stClass+'">'+esc(stLabel)+'</span></td><td class="cell-actions">'+(hasPermission('payment_view')?'<button class="action-btn" onclick="viewPayment(\''+p.id+'\')" title="'+t('title.viewDetail','查看详情')+'">👁️</button>':'')+(needsExpenseCountry&&hasPermission('payment_approve')?'<button class="action-btn" onclick="openPaymentExpenseCountry(\''+p.id+'\')" title="'+t('term.fin.supplement_expense_country','补录费用归属国家')+'">'+t("payment.fill_country","补国家")+'</button>':'')+(p.approval_status==='pending'&&hasPermission('payment_approve')?'<button class="action-btn action-edit" onclick="apprPay(\''+p.id+'\',\'approve\')" title="'+t("action.approve","通过")+'">✅</button><button class="action-btn action-delete" onclick="apprPay(\''+p.id+'\',\'reject\')" title="'+t("action.reject","驳回")+'">❌</button>':'')+(canPay&&hasPermission('payment_approve')?'<button class="action-btn action-edit" onclick="confirmPaid(\''+p.id+'\')" title="'+t("payment.confirm_pay","确认付款")+'">💵</button>':'')+(canRound&&hasPermission('payment_approve')?'<button class="action-btn" onclick="openPaymentRounding(\''+p.id+'\')" title="'+t("payment.manual_rounding","手动抹零")+'">'+t("payment.type_rounding","抹零")+'</button>':'')+(canDeduct&&hasPermission('payment_create')?'<button class="action-btn" onclick="editDeduction(\''+p.id+'\')" title="'+t('title.editDeduction','编辑抵扣')+'">✂️</button>':'')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function apprPay(id,act){const rem=act==='reject'?(prompt(t('gen.L7210.1','驳回原因：'))||''):'';try{await api('/api/payment-requests/'+id+'/approve','POST',{action:act,remark:rem});showToast(act==='approve'?t('gen.L7210.2','已通过'):t('gen.L7210.3','已驳回'),'success');loadPay()}catch(e){showToast(e.message,'danger')}}
async function confirmPaid(id){
  try{
    const p=await api('/api/payment-requests/'+id);
    const now=new Date(),today=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
    const idempotencyKey='pay:'+(window.crypto&&window.crypto.randomUUID?window.crypto.randomUUID():(Date.now()+'-'+Math.random().toString(36).slice(2)));
    openModal(t('modal.title.confirmPaid', '确认付款 - {v1}', {v1: esc(p.request_no)}),
      t('modal.body.confirmPaid', '<div class="form-card" style="box-shadow:none;padding:0"><input type="hidden" id="pay-settle-idempotency" value="{v1}"><div class="detail-grid mb-16"><div class="detail-item"><span class="detail-label">当前未付</span><span class="detail-value">{v2}</span></div><div class="detail-item"><span class="detail-label">币种</span><span class="detail-value">{v3}</span></div></div><div class="form-grid"><div class="form-group"><label>本次实际付款金额 <span class="required">*</span></label><input type="number" min="0.01" step="0.01" id="pay-settle-amount" value="{v4}"></div><div class="form-group"><label>实际付款日期 <span class="required">*</span></label><input type="date" id="pay-settle-date" value="{v5}"></div><div class="form-group form-group-full"><label>付款凭证号</label><input type="text" id="pay-settle-voucher"></div></div><div style="font-size:12px;color:#999">非货款费用将严格按实际付款日期读取系统 realtime 汇率并保存快照；缺少汇率时不会确认付款。</div></div>', {v1: idempotencyKey, v2: fmtMoney(p.outstanding,p.currency), v3: esc(p.currency||''), v4: Number(p.outstanding||0).toFixed(2), v5: today}),
      t('modal.footer.confirmPaid', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="pay-settle-save" onclick="saveConfirmedPayment('{v1}')">确认付款</button>`, {v1: id}));
  }catch(e){showToast(e.message,'danger')}
}
async function saveConfirmedPayment(id){
  const btn=document.getElementById('pay-settle-save');if(!btn||btn.disabled)return;
  const amount=parseFloat(document.getElementById('pay-settle-amount').value),paidDate=document.getElementById('pay-settle-date').value,voucher=document.getElementById('pay-settle-voucher').value,idempotencyKey=document.getElementById('pay-settle-idempotency').value;
  if(!(amount>0)){showToast(t('gen.L7224.1','本次实际付款金额必须大于0'),'warning');return}if(!paidDate){showToast(t('gen.L7224.2','请选择实际付款日期'),'warning');return}
  btn.disabled=true;btn.textContent=t("app.476", "\u4fdd\u5b58\u4e2d\u2026");
  try{await api('/api/payment-requests/'+id+'/approve','POST',{action:'confirm-paid',paid_amount:amount,paid_date:paidDate,payment_voucher:voucher,idempotency_key:idempotencyKey});showToast(t('gen.L7226.1','付款结果已保存'),'success');closeModal();loadPay()}catch(e){showToast(e.message,'danger');if(document.getElementById('pay-settle-save')){btn.disabled=false;btn.textContent=t('gen.L7226.2','确认付款')}}
}
async function reversePaymentSettlement(paymentId,logId,eventType){
  const isRounding=eventType==='rounding',label=eventType==='payment'?''+t("settle.lbl_payment","付款")+'':(isRounding?''+t("settle.lbl_rounding","抹零")+'':t("app.180", "\u62b5\u6263"));const reason=prompt(''+t("settle.please_enter","请输入")+''+(isRounding?''+t("settle.reverse_rounding","撤销")+'':''+t("settle.reverse_payment","冲销")+'')+label+''+t("settle.reason_suffix","原因：")+'');if(reason===null)return;if(!reason.trim()){showToast((isRounding?''+t("settle.reverse_rounding","撤销")+'':''+t("settle.reverse_payment","冲销")+'')+t("app.1162", "\u539f\u56e0\u4e0d\u80fd\u4e3a\u7a7a"),'warning');return}
  const route=eventType==='payment'?'/reverse-payment':(isRounding?'/reverse-rounding':'/reverse-deduction');
  try{await api('/api/payment-requests/'+paymentId+route,'POST',{settlement_log_id:logId,reason:reason.trim()});showToast(label+(isRounding?''+t("settle.done_reversed","已撤销")+'':t("app.1101", "\u5df2\u51b2\u9500")),'success');closeModal();loadPay()}catch(e){showToast(e.message,'danger')}
}
async function openPaymentRounding(id){
  try{const p=await api('/api/payment-requests/'+id);openModal(t('modal.title.openPaymentRounding', '手动抹零 - {v1}', {v1: esc(p.request_no)}),t('modal.body.openPaymentRounding', '<div class="form-card" style="box-shadow:none;padding:0"><div class="detail-grid mb-16"><div class="detail-item"><span class="detail-label">原始应付</span><span class="detail-value">{v1}</span></div><div class="detail-item"><span class="detail-label">当前未结</span><span class="detail-value">{v2}</span></div></div><div class="form-grid"><div class="form-group"><label>抹零金额 <span class="required">*</span></label><input type="number" min="0.01" step="0.01" id="pay-rounding-amount" placeholder="请手动填写"></div><div class="form-group form-group-full"><label>原因或备注 <span class="required">*</span></label><textarea id="pay-rounding-reason" rows="2"></textarea></div></div><div style="font-size:12px;color:#999">抹零只影响本付款申请的结清状态，不修改原始应付金额，也不参与采购成本、WAC 或趋势换算。</div></div>', {v1: fmtMoney(p.payable_amount,p.currency), v2: fmtMoney(p.outstanding,p.currency)}),t('modal.footer.openPaymentRounding', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="pay-rounding-save" onclick="savePaymentRounding('{v1}')">确认抹零</button>`, {v1: id}))}catch(e){showToast(e.message,'danger')}
}
async function savePaymentRounding(id){
  const btn=document.getElementById('pay-rounding-save');if(!btn||btn.disabled)return;const amount=parseFloat(document.getElementById('pay-rounding-amount').value),reason=document.getElementById('pay-rounding-reason').value.trim();
  if(!Number.isFinite(amount)||amount<0){showToast(''+t("settle.rounding_amt_ge0","抹零金额不能小于0")+'','warning');return}if(!(amount>0)){showToast(''+t("settle.rounding_amt_gt0","抹零金额必须大于0")+'','warning');return}if(!reason){showToast(''+t("settle.rounding_reason_required","抹零原因或备注不能为空")+'','warning');return}
  btn.disabled=true;btn.textContent=t("app.476", "\u4fdd\u5b58\u4e2d\u2026");try{await api('/api/payment-requests/'+id+'/rounding','POST',{amount,reason});showToast(''+t("settle.rounding_applied","抹零已生效")+'','success');closeModal();loadPay()}catch(e){showToast(e.message,'danger');if(document.getElementById('pay-rounding-save')){btn.disabled=false;btn.textContent=t("app.1171", "\u786e\u8ba4\u62b9\u96f6")}}
}
async function openPaymentExpenseCountry(id){
  try{
    const results=await Promise.all([api('/api/payment-requests/'+id),api('/api/countries')]),p=results[0],countries=results[1].filter(c=>c.status==='active');
    if(p.payment_category==='goods'){showToast(`${t("term.fin.goods_no_expense_country","货款付款申请不需要费用归属国家")}`,'warning');return}
    if(p.expense_country){showToast(t('toast.expenseCountrySnapshot',`${t("term.fin.expense_country_snapshotted","费用归属国家已快照为")} {country}`,{country:p.expense_country}),'warning');return}
    openModal(t('modal.title.openPaymentExpenseCountry', `${t("term.fin.supplement_expense_country","补录费用归属国家")} - {v1}`, {v1: esc(p.request_no)}),t('modal.body.openPaymentExpenseCountry', `<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group form-group-full"><label>${t("term.fin.expense_country","费用归属国家")} <span class="required">*</span></label><select id="pay-expense-country"><option value="">${t("term.fin.please_select","请选择")}</option>{v1}</select></div></div><div style="font-size:12px;color:#999">${t("term.fin.save_as_snapshot","保存后作为付款申请快照")}，${t("term.fin.not_change_with_master","不会随付款主体或来源主数据变化")}；${t("term.fin.correction_controlled","如需更正需另行受控处理")}。</div></div>`, {v1: countries.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.name)+'（'+esc(c.code)+'）</option>').join('')}),t('modal.footer.openPaymentExpenseCountry', `<button class="btn btn-secondary" onclick="closeModal()">${t("action.cancel","取消")}</button><button class="btn btn-primary" id="pay-country-save" onclick="savePaymentExpenseCountry('{v1}')">${t("action.save","保存")}</button>`, {v1: id}));
  }catch(e){showToast(e.message,'danger')}
}
async function savePaymentExpenseCountry(id){
  const btn=document.getElementById('pay-country-save');if(!btn||btn.disabled)return;const country=document.getElementById('pay-expense-country').value;
  if(!country){showToast(`${t("term.fin.please_select_expense_country","请选择费用归属国家")}`,'warning');return}
  btn.disabled=true;btn.textContent=t("app.476", "\u4fdd\u5b58\u4e2d\u2026");try{await api('/api/payment-requests/'+id+'/expense-country','PUT',{expense_country:country});showToast(`${t("term.fin.expense_country_saved","费用归属国家已保存")}`,'success');closeModal();loadPay()}catch(e){showToast(e.message,'danger');if(document.getElementById('pay-country-save')){btn.disabled=false;btn.textContent=t("common.save", "\u4fdd\u5b58")}}
}
async function editDeduction(id){
  try{
    const p=await api('/api/payment-requests/'+id.replace(/'/g,''));
    // Since there's no GET by id endpoint, use the list
    const data=await api('/api/payment-requests?keyword='+id);
    const pay=data.find(x=>x.id===id);
    if(!pay){showToast(t('toast.paymentNotFound','未找到付款申请'),'danger');return}
    openModal(t('modal.title.editDeduction', '编辑抵扣 - {v1}', {v1: pay.request_no}),
      t('modal.body.editDeduction', `<div class="form-card" style="box-shadow:none;padding:0"><div class="detail-grid mb-16"><div class="detail-item"><span class="detail-label">应付金额</span><span class="detail-value">{v1} {v2}</span></div><div class="detail-item"><span class="detail-label">付款对象</span><span class="detail-value">{v3}</span></div></div><div class="form-grid"><div class="form-group"><label>是否抵扣</label><select id="ded-has" onchange="document.getElementById('ded-amt').disabled=!this.value"><option value="0">否</option><option value="1" {v4}>是</option></select></div><div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="ded-amt" value="{v5}" {v6}></div><div class="form-group"><label>抵扣来源类型</label><select id="ded-type"><option value="">选择</option><option value="other_payment" {v7}>其他付款多付</option><option value="price_diff" {v8}>价格差异</option><option value="quality_claim" {v9}>质量索赔</option><option value="advance_payment" {v10}>预付款抵扣</option><option value="other" {v11}>其他</option></select></div><div class="form-group"><label>抵扣参考号</label><input type="text" id="ded-ref" value="{v12}"></div><div class="form-group form-group-full"><label>抵扣说明</label><textarea id="ded-desc" rows="2">{v13}</textarea></div></div></div>`, {v1: fmtMoney(pay.payable_amount), v2: esc(pay.currency||''), v3: esc(pay.supplier_name), v4: pay.has_deduction?'selected':'', v5: pay.deduction_amount||0, v6: pay.has_deduction?'':'disabled', v7: pay.deduction_source_type==='other_payment'?'selected':'', v8: pay.deduction_source_type==='price_diff'?'selected':'', v9: pay.deduction_source_type==='quality_claim'?'selected':'', v10: pay.deduction_source_type==='advance_payment'?'selected':'', v11: pay.deduction_source_type==='other'?'selected':'', v12: esc(pay.deduction_ref_no||''), v13: esc(pay.deduction_source_desc||'')}),
      t('modal.footer.editDeduction', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveDeduction('{v1}')">保存</button>`, {v1: id}));
  }catch(e){showToast(e.message,'danger')}
}
async function saveDeduction(id){
  const d={has_deduction:parseInt(document.getElementById('ded-has').value),deduction_amount:parseFloat(document.getElementById('ded-amt').value)||0,deduction_source_type:document.getElementById('ded-type').value,deduction_source_desc:document.getElementById('ded-desc').value,deduction_ref_no:document.getElementById('ded-ref').value};
  try{await api('/api/payment-requests/'+id+'/deduction','PUT',d);showToast(t('toast.deductionSaved','抵扣信息已保存'),'success');closeModal();loadPay()}catch(e){showToast(e.message,'danger')}
}
function importPayResult(){importFile('/api/payment-requests/bulk-import-result',loadPay)}

// ==================== 呆滞分析 ====================
async function renderStagnant(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>'+t("app.113", "国家")+'</label><input type="text" id="stag-c"></div><div class="filter-group"><label>'+t("col.level", "等级")+'</label><select id="stag-l"><option value="all">'+t("status.all_stag", "全部呆滞")+'</option><option value="light">'+t("status.light", "轻度")+'</option><option value="medium">'+t("status.medium", "中度")+'</option><option value="heavy">'+t("status.heavy", "重度")+'</option><option value="dead">'+t("status.dead", "死亡库存")+'</option><option value="backlog">'+t("status.backlog", "积压")+'</option><option value="severe_backlog">'+t("status.severe_backlog", "严重积压")+'</option><option value="new_product">'+t("col.is_new", "新品")+'</option></select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadStag()">'+t("action.search", "搜索")+t('gen.L7274.1','</button></div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">⚠️ 呆滞库存</div></div><div id="stag-table"></div></div>');
  loadStag();
}
async function loadStag(){
  try{
    const c=document.getElementById('stag-c')?.value||'',l=document.getElementById('stag-l')?.value||'all';
    const data=await api('/api/stagnant-analysis?country='+encodeURIComponent(c)+'&level='+l);
    const tv=data.reduce((s,i)=>s+(i.inventory_value||0),0);
    document.getElementById('stag-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">✅</div>'+t("empty.no_stag", "暂无呆滞库存")+'</div>':'<div class="stats-grid mb-16"><div class="stat-card warning"><div class="stat-number">'+fmtMoney(tv,'USD')+'</div><div class="stat-label">'+t("col.stag_amount", "呆滞库存总金额")+'</div></div><div class="stat-card"><div class="stat-number">'+data.length+'</div><div class="stat-label">'+t("col.stag_sku_count", "呆滞SKU数")+'</div></div></div><div class="table-container" style="box-shadow:none;border-radius:0;max-height:600px;overflow:auto"><table class="data-table"><thead><tr><th>SKU</th><th>'+t("app.232", "产品名")+'</th><th>'+t("app.112", "品牌")+'</th><th>'+t("app.113", "国家")+'</th><th>'+t("app.114", "仓库")+'</th><th>'+t("col.inventory_qty", "库存")+'</th><th>'+t("col.amount", "金额")+'</th><th>'+t("col.last_sale", "最后销售")+'</th><th>'+t("col.days_since_sale", "距今天数")+'</th><th>30d</th><th>60d</th><th>90d</th><th>'+t("col.month_forecast", "月预测")+'</th><th>'+t("col.turnover_months", "周转月")+'</th><th>'+t("col.is_new", "新品")+'</th><th>'+t("app.559", "生命周期")+'</th><th>'+t("col.stagnant_level", "呆滞等级")+'</th><th>'+t("col.suggestion", "建议")+'</th></tr></thead><tbody>'+data.map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td>'+esc(i.product_name)+'</td><td>'+esc(i.brand)+'</td><td>'+esc(i.country)+'</td><td>'+esc(i.warehouse)+'</td><td class="text-right font-bold">'+i.available_qty+'</td><td class="text-right">'+fmtMoney(i.inventory_value)+'</td><td class="cell-date">'+fmtDate(i.last_sale_date)+'</td><td class="text-right">'+(i.days_since_sale!==null?i.days_since_sale:'-')+'</td><td class="text-right">'+i.sales_30d+'</td><td class="text-right">'+i.sales_60d+'</td><td class="text-right">'+i.sales_90d+'</td><td class="text-right">'+i.monthly_forecast+'</td><td class="text-right">'+i.turnover_months+'</td><td>'+(i.is_new_product?'<span class="status-badge status-pending">'+t("col.is_new", "新品")+'</span>':'-')+'</td><td>'+esc(i.lifecycle_status)+'</td><td><span class="status-badge '+(i.stagnant_level==='dead'||i.stagnant_level==='severe_backlog'?'status-danger':i.stagnant_level==='heavy'||i.stagnant_level==='backlog'?'status-warning':'status-pending')+'">'+esc(i.stagnant_level)+'</span></td><td>'+esc(i.suggestion)+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

// ==================== 货代分析 ====================
async function renderForwarderAnalysis(){
  document.getElementById('content-inner').innerHTML=t('gen.L7288.1','<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>国家</label><input type="text" id="ff-c"></div><div class="filter-group"><label>运输方式</label><select id="ff-m"><option value="">全部</option><option value="sea">海运</option><option value="air">空运</option><option value="express">快递</option></select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadFF()">搜索</button></div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📈 货代分析</div></div><div id="ff-table"></div></div>');
  loadFF();
}
async function loadFF(){
  try{
    const c=document.getElementById('ff-c')?.value||'',m=document.getElementById('ff-m')?.value||'';
    const data=await api('/api/freight-forwarder-analysis?country='+encodeURIComponent(c)+'&transport_mode='+m);
    document.getElementById('ff-table').innerHTML=!data.length?t('gen.L7295.1','<div class="empty-state"><div class="empty-icon">📈</div>暂无货代分析数据</div>'):t('gen.L7295.2','<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>货代</th><th>国家</th><th>方式</th><th>批次</th><th>CI总额</th><th>总CBM</th><th>总重量</th><th>综合运费</th><th>关税</th><th>运费占比</th><th>每CBM</th><th>每KG</th><th>运输天</th><th>清关天</th><th>派送天</th></tr></thead><tbody>')+data.map(f=>'<tr><td class="cell-name">'+esc(f.forwarder_name)+'</td><td>'+esc(f.target_country)+'</td><td>'+esc(f.transport_mode)+'</td><td class="text-center">'+f.batch_count+'</td><td class="text-right">'+fmtMoney(f.total_ci_amount)+'</td><td class="text-right">'+(f.total_cbm||0)+'</td><td class="text-right">'+(f.total_weight||0)+'</td><td class="text-right font-bold">'+fmtMoney(f.total_freight)+'</td><td class="text-right">'+fmtMoney(f.total_duty)+'</td><td class="text-right '+(f.freight_ratio>15?'text-danger':f.freight_ratio>10?'text-warning':'')+'">'+f.freight_ratio+'%</td><td class="text-right">'+(f.freight_per_cbm||0)+'</td><td class="text-right">'+(f.freight_per_kg||0)+'</td><td class="text-right">'+(f.avg_transport_days||'-')+'</td><td class="text-right">'+(f.avg_customs_days||'-')+'</td><td class="text-right">'+(f.avg_delivery_days||'-')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

// ==================== 库存盘点 ====================
async function renderCheck(){
  document.getElementById('content-inner').innerHTML=t('html.renderCheck', '<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>国家</label><input type="text" id="chk-c"></div><div class="filter-group"><label>仓库</label><input type="text" id="chk-w"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadChk()">搜索</button>{v1}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🔍 盘点记录</div></div><div id="chk-table"></div></div>', {v1: hasPermission('check_create')?t('gen.L7301.1','<button class="btn btn-secondary btn-sm" onclick="exportChkTpl()">📋 导出模板</button><button class="btn btn-secondary btn-sm" onclick="importFile(\'/api/inventory-checks/bulk-import\',loadChk)">📥 导入盘点</button>'):''});
  loadChk();
}
async function loadChk(){
  try{
    const c=document.getElementById('chk-c')?.value||'',w=document.getElementById('chk-w')?.value||'';
    const data=await api('/api/inventory-checks?country='+encodeURIComponent(c)+'&warehouse='+encodeURIComponent(w));
    document.getElementById('chk-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">🔍</div>'+t("empty.no_check", "暂无盘点数据")+'</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("col.check_no", "盘点单号")+'</th><th>'+t("app.113", "国家")+'</th><th>'+t("app.114", "仓库")+'</th><th>'+t("col.date", "日期")+'</th><th>SKU</th><th>'+t("col.system_qty", "系统库存")+'</th><th>'+t("col.actual_qty", "实盘")+'</th><th>'+t("col.diff_qty", "差异")+'</th><th>'+t("col.diff_amount", "差异金额")+'</th><th>'+t("col.reason", "原因")+'</th><th>'+t("col.handle", "处理")+'</th><th>'+t("col.approval", "审批")+'</th><th>'+t("common.actions", "操作")+'</th></tr></thead><tbody>'+data.map(c=>'<tr><td class="cell-id">'+esc(c.check_no)+'</td><td>'+esc(c.country)+'</td><td>'+esc(c.warehouse)+'</td><td class="cell-date">'+fmtDate(c.check_date)+'</td><td class="cell-id">'+esc(c.sku_code)+'</td><td class="text-right">'+c.system_qty+'</td><td class="text-right font-bold">'+c.actual_qty+'</td><td class="text-right '+(c.diff_qty!==0?'text-danger':'')+'">'+(c.diff_qty>0?'+':'')+c.diff_qty+'</td><td class="text-right">'+fmtMoney(c.diff_amount)+'</td><td>'+esc(c.diff_reason)+'</td><td>'+esc(c.handle_method)+'</td><td><span class="status-badge '+(c.approval_status==='approved'?'status-approved':'status-pending')+'">'+statusLabel(c.approval_status)+'</span></td><td>'+(c.approval_status==='pending'&&hasPermission('check_approve')?'<button class="action-btn action-edit" onclick="apprChk(\''+c.id+t('gen.L7308.1','\')" title="\u5ba1\u6279">✅</button>'):'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function exportChkTpl(){
  const c=document.getElementById('chk-c')?.value||'',w=document.getElementById('chk-w')?.value||'';
  try{const data=await api('/api/inventory-checks/template?country='+encodeURIComponent(c)+'&warehouse='+encodeURIComponent(w));const ws=XLSX.utils.json_to_sheet(data.map(d=>({国家:d.country,仓库:d.warehouse,SKU:d.sku_code,产品名:d.product_name,品牌:d.brand,系统库存:d.system_qty,实盘库存:t('gen.L7313.1','",\u5dee\u5f02\u539f\u56e0:"",\u5904\u7406\u65b9\u5f0f:"'),盘点日期:todayStr()})));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'盘点模板');XLSX.writeFile(wb,'盘点模板_'+(c||'all')+'.xlsx')}catch(e){showToast(e.message,'danger')}
}
async function apprChk(id){if(!confirm(t("app.1187", "\u786e\u8ba4\u5ba1\u6279\u901a\u8fc7\uff1f\u5c06\u8c03\u6574\u5e93\u5b58\u3002")))return;try{await api('/api/inventory-checks/'+id+'/approve','POST');showToast(t("shell.073", "已审批"),'success');loadChk()}catch(e){showToast(e.message,'danger')}}

// ==================== 初始化 ====================
window.addEventListener('DOMContentLoaded',()=>{
  // 多语言：启动时回填静态文本 + 同步语言切换器
  if (typeof applyI18n==='function') applyI18n();
  var _sw=document.getElementById('lang-switcher'); if(_sw&&typeof getLang==='function') _sw.value=getLang();
  // 直开 HTML 文件（file://）时后端不可达，先给出醒目指引
  if(isFileProtocol()){
    showFatalNotice(t('err.file_protocol_startup','⚠️ 检测到您直接打开了 HTML 文件（file://）。进销存系统需要后端服务，请：<br>① 在终端运行 <b>node server.js</b><br>② 浏览器访问 <b>http://localhost:3001</b><br>不要直接双击 index.html。'));
    return;
  }
  // 凭证基于 HttpOnly Cookie（Session），启动即从 /api/me 探活；无有效会话则显示登录页
  bootFromSession();
});
// 启动探活：有效会话 → 进入业务（pending 显示待授权页）；无效 → 登录页
async function bootFromSession(){
  try{
    const me=await api('/api/me','GET');
    if(me&&me.status==='pending'){ showPendingPage(me); }
    else {
      currentUser=me;
      // I18N-B1-FINAL-4-GAPS-CLOSEOUT：会话恢复应用用户语言偏好（共享函数；skipSave 不触发保存 API）
      applyCurrentUserLanguagePreference(me);
      showApp();
    }
  }catch(e){
    // 未登录 / 会话失效：api 已在 401 时调用 doLogout 显示登录页
    const lp=document.getElementById('login-page'); if(lp) lp.style.display='flex';
  }
}
