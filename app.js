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
function openModal(title,body,footer='',size=''){const mc=document.getElementById('modal-content');mc.className='modal'+(size?' '+size:'');const ov=document.getElementById('modal-overlay');ov.classList.remove('ci-mode','ci-sb-collapsed','wac-mode','wac-sb-collapsed');if(size&&size.indexOf('modal-pi')!==-1){const sb=document.querySelector('.sidebar');if(sb&&sb.classList.contains('collapsed')){mc.classList.add('pi-sidebar-collapsed')}else{mc.classList.add('pi-sidebar-expanded')}}if(size==='modal-ci-create'){const sb=document.querySelector('.sidebar');ov.classList.add('ci-mode');if(sb&&sb.classList.contains('collapsed')){ov.classList.add('ci-sb-collapsed')}}if(size==='modal-wac'){const sb=document.querySelector('.sidebar');ov.classList.add('wac-mode');if(sb&&sb.classList.contains('collapsed')){ov.classList.add('wac-sb-collapsed')}}mc.innerHTML='<div class="modal-header"><span class="modal-title">'+esc(title)+'</span><button class="modal-close" onclick="closeModal()">&times;</button></div><div class="modal-body">'+body+'</div>'+(footer?'<div class="modal-footer">'+footer+'</div>':'');ov.classList.add('show')}
function closeModal(){const ov=document.getElementById('modal-overlay');ov.classList.remove('show','ci-mode','ci-sb-collapsed','wac-mode','wac-sb-collapsed')}
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
// 启动时检查飞书 OAuth 配置；未配齐时隐藏/灰化"飞书登录"按钮，避免用户点出 20028 "client_id 请求不合法"错误页
async function probeFeishuStatus(){
  try{
    const r=await fetch('/api/auth/feishu/status',{credentials:'same-origin'});
    if(!r.ok) return;
    const s=await r.json();
    const btn=document.getElementById('login-btn');
    if(!btn) return;
    if(!s.configured){
      btn.disabled=true;
      btn.style.opacity='0.5';
      btn.style.cursor='not-allowed';
      btn.title=t('login.feishu_unconfigured','飞书登录未配置（FEISHU_APP_ID/REDIRECT_URI 缺失），请使用下方"本地应急登录"');
      btn.textContent=t('login.feishu_disabled','🔒 飞书登录未配置');
    }
  }catch(e){ /* 静默失败：保持按钮可用，避免误伤 */ }
}
function toggleBreakGlass(){ clearLoginError(); const f=document.getElementById('bg-form'); if(f) f.style.display = (f.style.display==='none'||!f.style.display)?'block':'none'; }
function showLoginError(msg){ const el=document.getElementById('login-error'); if(!el)return; el.textContent=msg; el.style.display='block'; }
function clearLoginError(){ const el=document.getElementById('login-error'); if(el) el.style.display='none'; }
async function doBreakGlassLogin(){
  const u=document.getElementById('bg-username');
  const p=document.getElementById('bg-password');
  const btn=document.querySelector('#bg-form .btn-secondary');
  const loading=document.getElementById('login-loading');
  if(!u||!p){alert(t('login.controlNotLoaded','登录控件未加载'));return}
  if(!u.value||!p.value){showLoginError(t('login.enterEmergencyCreds','请输入应急账号和密码'));return}
  if(loading) loading.style.display='flex';
  if(btn) btn.disabled=true;
  try{
    const d=await api('/api/auth/local/login','POST',{username:u.value,password:p.value});
    currentUser=d;
    // I18N-B1-FINAL-4-GAPS-CLOSEOUT：应急登录成功后应用用户语言偏好（共享函数；skipSave 不触发保存 API）
    applyCurrentUserLanguagePreference(d);
    if(loading) loading.style.display='none';
    if(btn) btn.disabled=false;
    showApp();
  }catch(e){
    if(loading) loading.style.display='none';
    if(btn) btn.disabled=false;
    showLoginError(t('toast.doBreakGlassLogin', '应急登录失败: {v1}', {v1: e.message||e}));
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
  showEnterSplash();
  // break-glass 本地应急账号：内置系统标签按语言显示；真实飞书用户姓名保持原文
  const isLocal=currentUser.auth_source==='local' || currentUser.username==='admin';
  const displayName=isLocal ? t('auth.breakglass_admin_label','超级管理员') : (currentUser.name||'');
  document.getElementById('user-name').textContent=displayName;
  renderUserRole();
  document.getElementById('user-avatar').textContent=(displayName||'U').charAt(0).toUpperCase();
  renderTopNav();renderSidebar();initSidebarCollapse();showPage('dashboard');
  // Listing 飞书卡片深链：登录后自动进入物流管理并打开对应物流详情弹窗（?page=logistics&batch=<内部id>）。
  // 轻量支持，不做完整前端路由；欢迎 splash 结束后执行，避免弹窗被覆盖。
  const _dl = new URLSearchParams(location.search);
  if (_dl.get('page') === 'logistics' && _dl.get('batch')) {
    setTimeout(function () {
      try { showPage('logistics'); viewLogDetail(_dl.get('batch')); } catch (e) { /* 深链失败不影响主流程 */ }
    }, 2000);
  }
}

// 登录欢迎 splash（纯视觉，进入系统时显示一次，不改变权限/路由/业务）
function showEnterSplash(){
  const el=document.getElementById('welcome-screen');
  if(!el) return;
  el.classList.remove('hidden');
  el.classList.add('show');
  setTimeout(function(){ el.classList.add('hidden'); setTimeout(function(){ el.classList.remove('show'); },700); },1800);
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
// Phase 2: 子模块名显示函数
function formatPermSubmodule(submodule){
  return t('permission.submodule.'+submodule, submodule);
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
    {id:'consignment',key:'nav.consignment',icon:'🤝',label:t("nav.consignment","寄售库存"),perm:'inventory_view'},
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
    {id:'inbound',key:'nav.wac_confirm',icon:'💰',label:t("nav.wac_confirm", "WAC确认"),perm:'inbound_view'},
  ]},
  {id:'approval',key:'nav.approval',label:t("nav.approval_center", "\u5ba1\u6279\u4e2d\u5fc3"),items:[
    {id:'approval-center',key:'nav.approval_center',icon:'✅',label:t("nav.approval_center", "\u5ba1\u6279\u4e2d\u5fc3"),perm:'approval_view'},
  ]},
  {id:'finance',key:'nav.finance',label:t("nav.finance","财务"),items:[
    {id:'payable-cockpit',key:'nav.payable_cockpit',icon:'🧭',label:t("nav.payable_cockpit","应付驾驶舱"),perm:'payment_view'},
    {id:'payment',key:'nav.payment',icon:'💳',label:t("nav.payment", "\u4ed8\u6b3e\u7ba1\u7406"),perm:'payment_view'},
    {id:'cost',key:'nav.cost',icon:'💰',label:t("nav.cost", "\u6210\u672c\u7ba1\u7406"),perm:'cost_view'},
    {id:'payable-list',key:'nav.payable_list',icon:'📋',label:t("nav.payable_list", "\u5e94\u4ed8\u8d39\u7528\u5217\u8868"),perm:'payment_view'},
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
  'nav.inventory_total':'库存总表','nav.consignment':'寄售库存','nav.skus':'SKU主数据','nav.stock_check':'库存盘点',
  'nav.stagnant':'呆滞分析','nav.sales':'销售','nav.sales_data':'销售数据',
  'nav.forecast':'订单预测','nav.procurement':'采购链','nav.po':'PO管理',
  'nav.pi':'PI管理','nav.ci':'CI/PL管理','nav.logistics':'物流管理','nav.inbound':'WAC确认',
  'nav.approval':'审批中心','nav.approval_center':'审批中心','nav.finance':'财务',
  'nav.payable_cockpit':'应付驾驶舱','nav.payment':'付款管理','nav.cost':'成本管理','nav.payable_list':'应付费用列表',
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
  // Phase 2: 页面级权限守卫 — 进入页面前校验对应权限
  var _allNavItems = NAV_MODULES.flatMap(function(m){return m.items;});
  var _navItem = _allNavItems.find(function(i){return i.id===page;});
  if(_navItem && _navItem.perm && !hasPermission(_navItem.perm)){
    showToast(t('toast.no_page_permission','无权限访问该页面'), 'danger');
    return;
  }
  // CI-DETAIL-UX：切换页面时关闭 CI 详情/编辑 modal，避免弹窗残留（不影响其他 modal）
  const _ov=document.getElementById('modal-overlay');
  if(_ov&&_ov.classList.contains('ci-mode')) closeModal();
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
  const titles={dashboard:t("nav.dashboard", "\u9996\u9875\u770b\u677f"),skus:t("nav.skus", "SKU\u4e3b\u6570\u636e"),inventory:t("page.inventory_total","库存总表"),outbound:t("nav.outbound","销售数据"),replenishment:t("nav.replenishment","订单预测"),stagnant:t("nav.stagnant", "\u5446\u6ede\u5206\u6790"),check:t("nav.stock_check", "\u5e93\u5b58\u76d8\u70b9"),po:t("nav.po", "PO\u7ba1\u7406"),pi:t("nav.pi", "PI\u7ba1\u7406"),ci:t("nav.ci", "CI/PL\u7ba1\u7406"),logistics:t("nav.logistics", "\u7269\u6d41\u7ba1\u7406"),inbound:t("nav.wac_confirm", "WAC确认"),cost:t("nav.cost", "\u6210\u672c\u7ba1\u7406"),payment:t("nav.payment", "\u4ed8\u6b3e\u7ba1\u7406"),'payable-cockpit':t("nav.payable_cockpit","应付驾驶舱"),'payable-list':t("nav.payable_list","应付费用列表"),forwarder:t("nav.forwarder_analysis", "\u8d27\u4ee3\u5206\u6790"),countries:t("nav.countries", "\u56fd\u5bb6\u7ba1\u7406"),warehouses:t("nav.warehouses", "\u4ed3\u5e93\u7ba1\u7406"),suppliers:t("nav.suppliers", "\u4f9b\u5e94\u5546\u7ba1\u7406"),'freight-forwarders':t("nav.freight_forwarders", "\u8d27\u4ee3\u7ba1\u7406"),currencies:t("nav.currencies", "\u5e01\u79cd\u8bbe\u7f6e"),config:t("nav.config", "\u7cfb\u7edf\u53c2\u6570"),'payment-terms':t("nav.payment_terms", "\u4ed8\u6b3e\u6761\u4ef6"),'approval-flows':t("nav.approval_flows", "\u5ba1\u6279\u6d41\u7ba1\u7406"),'approval-center':t("nav.approval_center", "\u5ba1\u6279\u4e2d\u5fc3"),'expense-types':t("nav.expense_types", "\u8d39\u7528\u7c7b\u578b"),'allocation-rules':t("nav.allocation_rules", "\u5206\u644a\u89c4\u5219"),users:t("nav.users", "\u7528\u6237\u7ba1\u7406"),roles:t("nav.roles","角色权限"),'batch-tasks':t("nav.batch_tasks", "\u6279\u91cf\u4efb\u52a1\u4e2d\u5fc3"),'brand-settings':t("nav.brand_settings", "\u54c1\u724c\u8bbe\u7f6e"),'operation-logs':t("nav.operation_logs", "\u64cd\u4f5c\u65e5\u5fd7"),'payment-categories':t("nav.payment_categories", "\u4ed8\u6b3e\u7c7b\u76ee\u7ba1\u7406"),'payer-entities':t("nav.payer_entities", "\u4ed8\u6b3e\u4e3b\u4f53")};
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>';
  const R={dashboard:renderDashboard,skus:renderSKUs,inventory:renderInventory,consignment:renderConsignment,outbound:renderOutbound,replenishment:renderReplenishment,stagnant:renderStagnant,check:renderCheck,po:renderPO,pi:renderPI,ci:renderCI,logistics:renderLogistics,inbound:renderInbound,cost:renderCost,payment:renderPayment,'payable-cockpit':renderPayableCockpit,'payable-list':renderPayableList,forwarder:renderForwarderAnalysis,countries:renderCountries,warehouses:renderWarehouses,suppliers:renderSuppliers,'freight-forwarders':renderFreightForwarders,currencies:renderCurrencies,config:renderConfig,'payment-terms':renderPaymentTerms,'approval-flows':renderApprovalFlows,'approval-center':renderApprovalCenter,'expense-types':renderExpenseTypes,'allocation-rules':renderAllocationRules,users:renderUsers,roles:renderRoles,'batch-tasks':renderBatchTasks,'brand-settings':renderBrandSettings,'operation-logs':renderOperationLogs,'payment-categories':renderPaymentCategories,'payer-entities':renderPayerEntities};
  if(R[page])R[page]();
}

// ==================== 首页看板 ====================
// UI-only 纯展示（非业务判断）：仅展示金额与「待付款」事实状态。
// 风险等级由后续业务规则定义，前端不做推断，也不新增任何计算。
function froPayableState(value){
  return Number(value||0)>0
    ? {cls:'has', label:t('fro.payable_has','有待付款')}
    : {cls:'none', label:t('fro.payable_none','无待付款')};
}
function setFroPayState(prefix, value){
  var st=froPayableState(value);
  var lbl=document.getElementById(prefix+'-status');
  if(lbl) lbl.textContent=st.label;
}
// 未来应付卡：审批中 / 已批准待付款 拆分（方案A，纯展示，总额不变）
function setFroPaySplit(prefix, data){
  const el=document.getElementById(prefix+'-split');
  if(!el||!data)return;
  const pend=Number(data.pending||0), appr=Number(data.approved||0);
  if(pend<=0&&appr<=0){el.textContent='';return;}
  el.innerHTML='<span style="color:#f57f17">审批中 ¥'+fmtMoney(pend,'')+'</span> · <span style="color:#1565c0">已批准待付款 ¥'+fmtMoney(appr,'')+'</span>';
}
// 未来应付卡片（纯展示：金额 + 待付款事实状态，无风险推断）
function froPayCard(prefix, label){
  return '<div class="fro-pay-card">'+
    '<div class="fro-pay-top"><span class="fro-pay-status" id="'+prefix+'-status">'+t("common.loading","...")+'</span></div>'+
    '<div class="fro-pay-amount">¥ <span id="'+prefix+'">'+t("common.loading","...")+'</span></div>'+
    '<div class="fro-pay-split" id="'+prefix+'-split" style="font-size:12px;color:#888;margin-top:4px"></div>'+
    '<div class="fro-pay-label">'+label+'</div>'+
  '</div>';
}
async function renderDashboard(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>'+
    '<div class="fro-overview">'+
      '<section class="fro-hero">'+
        '<div class="fro-hero-main">'+
          '<div class="fro-hero-label">'+t("fro.total_inventory_assets","库存总资产")+'</div>'+
          '<div class="fro-hero-value fro-clickable" onclick="renderFroInventoryAnalysis()" style="cursor:pointer" title="'+t("fro.inv_dist_title","库存资金分布")+'">¥ <span id="fro-total">'+t("common.loading","加载中...")+'</span></div>'+
          '<div class="fro-hero-sub">'+t("fro.hero_sub","当前供应链资金占用")+'</div>'+
        '</div>'+
        '<div class="fro-hero-structure">'+
          '<div class="fro-structure-bar">'+
            '<div class="fro-structure-seg inv" id="fro-inv-bar"></div>'+
            '<div class="fro-structure-seg trs" id="fro-trs-bar"></div>'+
            '<div class="fro-structure-seg csn" id="fro-csn-bar"></div>'+
          '</div>'+
          '<div class="fro-structure-legend">'+
            '<div class="fro-legend-item fro-clickable" onclick="renderFroInventoryAnalysis()" style="cursor:pointer">'+
              '<span class="fro-legend-dot inv"></span>'+
              '<span class="fro-legend-name">'+t("fro.available_assets","可用库存")+'</span>'+
              '<span class="fro-legend-amount">¥ <span id="fro-inventory">'+t("common.loading","...")+'</span></span>'+
              '<span class="fro-legend-pct" id="fro-inventory-pct"></span>'+
            '</div>'+
            '<div class="fro-legend-item fro-clickable" onclick="renderFroTransitAnalysis()" style="cursor:pointer">'+
              '<span class="fro-legend-dot trs"></span>'+
              '<span class="fro-legend-name">'+t("fro.transit_inventory_assets","在途库存")+'</span>'+
              '<span class="fro-legend-amount">¥ <span id="fro-transit">'+t("common.loading","...")+'</span></span>'+
              '<span class="fro-legend-pct" id="fro-transit-pct"></span>'+
            '</div>'+
            '<div class="fro-legend-item fro-clickable" onclick="renderFroInventoryAnalysis()" style="cursor:pointer">'+
              '<span class="fro-legend-dot csn"></span>'+
              '<span class="fro-legend-name">'+t("fro.consignment_assets","寄售库存")+'</span>'+
              '<span class="fro-legend-amount">¥ <span id="fro-consign">'+t("common.loading","...")+'</span></span>'+
              '<span class="fro-legend-pct" id="fro-consign-pct"></span>'+
            '</div>'+
          '</div>'+
        '</div>'+
      '</section>'+
      '<section class="fro-section">'+
        '<div class="fro-section-title">'+t("fro.future_payables","未来应付资金压力")+'</div>'+
        '<div class="fro-pay-grid">'+
          froPayCard('fro-pay7', t("fro.days_7","未来7天"))+
          froPayCard('fro-pay30', t("fro.days_30","未来30天"))+
          froPayCard('fro-pay90', t("fro.days_90","未来90天"))+
        '</div>'+
      '</section>'+
      '<div class="fro-as-of" id="fro-as-of"></div>'+
    '</div>';
  try{
    const d=await api('/api/financial-risk/overview');
    // 竞态防护：页面已切走则静默结束
    if(!document.getElementById('fro-total')) return;
    var totalVal=Number(d.total_assets.value||0);
    var availVal=Number(d.available_assets.value||0);
    var trsVal=Number(d.in_transit_assets.value||0);
    var csnVal=Number(d.consignment_assets.value||0);
    document.getElementById('fro-total').textContent=fmtMoney(totalVal,'');
    document.getElementById('fro-inventory').textContent=fmtMoney(availVal,'');
    document.getElementById('fro-transit').textContent=fmtMoney(trsVal,'');
    document.getElementById('fro-consign').textContent=fmtMoney(csnVal,'');
    // 占比 = 各组件 / 库存总资产（总额为 0 时显示空，防 NaN/Infinity）
    var availPct=totalVal>0?availVal/totalVal*100:0;
    var trsPct=totalVal>0?trsVal/totalVal*100:0;
    var csnPct=totalVal>0?csnVal/totalVal*100:0;
    var availPctEl=document.getElementById('fro-inventory-pct');
    var trsPctEl=document.getElementById('fro-transit-pct');
    var csnPctEl=document.getElementById('fro-consign-pct');
    if(availPctEl) availPctEl.textContent=totalVal>0?availPct.toFixed(1)+'%':'';
    if(trsPctEl) trsPctEl.textContent=totalVal>0?trsPct.toFixed(1)+'%':'';
    if(csnPctEl) csnPctEl.textContent=totalVal>0?csnPct.toFixed(1)+'%':'';
    var invBar=document.getElementById('fro-inv-bar');
    var trsBar=document.getElementById('fro-trs-bar');
    var csnBar=document.getElementById('fro-csn-bar');
    if(invBar) invBar.style.width=availPct.toFixed(1)+'%';
    if(trsBar) trsBar.style.width=trsPct.toFixed(1)+'%';
    if(csnBar) csnBar.style.width=csnPct.toFixed(1)+'%';
    document.getElementById('fro-pay7').textContent=fmtMoney(d.future_payables.days_7.value,'');
    document.getElementById('fro-pay30').textContent=fmtMoney(d.future_payables.days_30.value,'');
    document.getElementById('fro-pay90').textContent=fmtMoney(d.future_payables.days_90.value,'');
    // 待付款事实状态（纯展示，不做风险推断）
    setFroPayState('fro-pay7',Number(d.future_payables.days_7.value||0));
    setFroPayState('fro-pay30',Number(d.future_payables.days_30.value||0));
    setFroPayState('fro-pay90',Number(d.future_payables.days_90.value||0));
    // 资金状态拆分（方案A：审批中 / 已批准待付款），总额不变
    setFroPaySplit('fro-pay7', d.future_payables.days_7);
    setFroPaySplit('fro-pay30', d.future_payables.days_30);
    setFroPaySplit('fro-pay90', d.future_payables.days_90);
    var asOfEl=document.getElementById('fro-as-of');
    if(asOfEl&&d.as_of) asOfEl.textContent=t("fro.as_of","数据截止")+'：'+d.as_of;
  }catch(e){
    if(document.getElementById('fro-total')) showFlash(e.message,'danger');
  }
}

// ==================== 资金风险总览 - 下钻分析 ====================
let _froInvSeq=0;

function renderFroInventoryAnalysis(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>'+
    '<div class="fro-analysis">'+
      '<div class="fro-analysis-header">'+
        '<div class="fro-analysis-back"><a href="javascript:showPage(\'dashboard\')" class="fro-back-link">← '+t('fro.back_overview','返回总览')+'</a></div>'+
      '</div>'+
      '<div class="fro-analysis-title">'+t('fro.inv_dist_title','库存资金分布')+'</div>'+
      '<div class="fro-analysis-subtitle">'+t('fro.dim_country','按国家')+'</div>'+
      '<div class="fro-analysis-total" id="fro-inv-total">'+t('common.loading','加载中...')+'</div>'+
      '<div class="fro-analysis-table" id="fro-inv-table"></div>'+
    '</div>';

  api('/api/financial-risk/overview').then(function(d){
    var totalEl=document.getElementById('fro-inv-total');
    if(!totalEl) return;
    var grandTotal=Number(d.total_assets.value||0);
    totalEl.innerHTML='<span class="fro-total-label">'+t('fro.asset_total_label','库存总资产（CNY）')+'</span> <span class="fro-total-amount">¥ '+fmtMoney(grandTotal,'')+'</span>';

    var tableEl=document.getElementById('fro-inv-table');
    if(!tableEl) return;
    var countries=(d.countries||[]);
    if(countries.length===0){
      tableEl.innerHTML='<div class="fro-empty">'+t('common.no_data','暂无数据')+'</div>';
      return;
    }
    var hdr='<tr><th>'+t('common.country','国家')+'</th><th>'+t('fro.asset_total_label','库存总资产（CNY）')+'</th><th>'+t('common.percentage','占比')+'</th><th></th></tr>';
    function rowHtml(g){
      var pct=grandTotal>0?(Number(g.total_asset||0)/grandTotal*100):0;
      var clickFn="renderFroCountryAssetDetail('"+String(g.country_code).replace(/'/g,"\\'")+"')";
      return '<tr>'+
        '<td class="td-bold">'+esc(g.country||'—')+'</td>'+
        '<td class="td-num td-bold">¥ '+fmtMoney(g.total_asset,'')+'</td>'+
        '<td class="td-num">'+pct.toFixed(1)+'%</td>'+
        '<td><a class="fro-drill-link" href="javascript:'+clickFn+'">'+t('fro.drill_down','下钻 ›')+'</a></td>'+
      '</tr>';
    }
    function barHtml(g){
      var pct=grandTotal>0?(Number(g.total_asset||0)/grandTotal*100):0;
      var clickFn="renderFroCountryAssetDetail('"+String(g.country_code).replace(/'/g,"\\'")+"')";
      return '<div class="fro-bar-row" onclick="'+clickFn+'" style="cursor:pointer">'+
        '<div class="fro-bar-label">'+esc(g.country||'—')+'</div>'+
        '<div class="fro-bar-track"><div class="fro-bar-fill" style="width:'+Math.min(pct,100)+'%"></div></div>'+
        '<div class="fro-bar-val">¥ '+fmtMoney(g.total_asset,'')+' ('+pct.toFixed(1)+'%)</div>'+
      '</div>';
    }
    tableEl.innerHTML=
      '<div class="fro-bars">'+countries.map(barHtml).join('')+'</div>'+
      '<table class="data-table fro-data-table" style="margin-top:16px"><thead>'+hdr+'</thead><tbody>'+countries.map(rowHtml).join('')+'</tbody></table>';
  }).catch(function(e){
    var el=document.getElementById('fro-inv-table');
    if(el) el.innerHTML='<div class="fro-empty fro-error">'+esc(e.message)+'</div>';
  });
}

// 第二层：国家资产详情（可用 / 在途 / 寄售 三段拆解 + 三段比例条）
function renderFroCountryAssetDetail(code){
  code=code||'';
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>'+
    '<div class="fro-analysis">'+
      '<div class="fro-analysis-header">'+
        '<div class="fro-analysis-back"><a href="javascript:renderFroInventoryAnalysis()" class="fro-back-link">← '+t('fro.back_overview','返回总览')+'</a></div>'+
      '</div>'+
      '<div class="fro-analysis-title" id="fro-country-title">'+t('common.loading','加载中...')+'</div>'+
      '<div class="fro-analysis-total" id="fro-country-total">'+t('common.loading','加载中...')+'</div>'+
      '<div class="fro-country-bars" id="fro-country-bars"></div>'+
      '<div class="fro-analysis-table" id="fro-country-table"></div>'+
    '</div>';

  api('/api/financial-risk/overview').then(function(d){
    var countries=(d.countries||[]);
    var g=null;
    for(var i=0;i<countries.length;i++){ if(countries[i].country_code===code){ g=countries[i]; break; } }
    var titleEl=document.getElementById('fro-country-title');
    var totalEl=document.getElementById('fro-country-total');
    var barsEl=document.getElementById('fro-country-bars');
    var tableEl=document.getElementById('fro-country-table');
    if(!g){ if(titleEl) titleEl.textContent=t('common.no_data','暂无数据'); return; }

    var name=esc(g.country||code);
    if(titleEl) titleEl.innerHTML=name+' '+t('fro.total_inventory_assets','库存总资产');
    if(totalEl) totalEl.innerHTML='<span class="fro-total-label">'+t('fro.asset_total_label','库存总资产（CNY）')+'</span> <span class="fro-total-amount">¥ '+fmtMoney(g.total_asset,'')+'</span>';

    var total=Number(g.total_asset||0);
    var a=Number(g.available_asset||0);
    var tr=Number(g.transit_asset||0);
    var cs=Number(g.consignment_asset||0);
    var aPct=total>0?a/total*100:0;
    var trPct=total>0?tr/total*100:0;
    var csPct=total>0?cs/total*100:0;

    if(barsEl) barsEl.innerHTML=
      '<div class="fro-structure-bar" style="margin-bottom:14px">'+
        '<div class="fro-structure-seg inv" style="width:'+aPct.toFixed(1)+'%"></div>'+
        '<div class="fro-structure-seg trs" style="width:'+trPct.toFixed(1)+'%"></div>'+
        '<div class="fro-structure-seg csn" style="width:'+csPct.toFixed(1)+'%"></div>'+
      '</div>';

    if(tableEl){
      var hdr='<tr><th>'+t('fro.assets_structure','资产结构')+'</th><th>'+t('fro.amount_cny','金额(CNY)')+'</th><th>'+t('common.percentage','占比')+'</th></tr>';
      function row(cls,label,val,pct){
        return '<tr>'+
          '<td class="td-bold"><span class="fro-legend-dot '+cls+'"></span> '+label+'</td>'+
          '<td class="td-num td-bold">¥ '+fmtMoney(val,'')+'</td>'+
          '<td class="td-num">'+pct.toFixed(1)+'%</td>'+
        '</tr>';
      }
      var rows=row('inv',t('fro.available_assets','可用库存'),a,aPct)+
               row('trs',t('fro.transit_inventory_assets','在途库存'),tr,trPct)+
               row('csn',t('fro.consignment_assets','寄售库存'),cs,csPct);
      tableEl.innerHTML='<table class="data-table fro-data-table"><thead>'+hdr+'</thead><tbody>'+rows+'</tbody></table>';
    }
  }).catch(function(e){
    var el=document.getElementById('fro-country-table');
    if(el) el.innerHTML='<div class="fro-empty fro-error">'+esc(e.message)+'</div>';
  });
}

function renderFroTransitAnalysis(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>'+
    '<div class="fro-analysis">'+
      '<div class="fro-analysis-header">'+
        '<div class="fro-analysis-back"><a href="javascript:showPage(\'dashboard\')" class="fro-back-link">← '+t('fro.back_overview','返回总览')+'</a></div>'+
      '</div>'+
      '<div class="fro-analysis-title">'+t('fro.transit_title','运输中资产')+'</div>'+
      '<div class="fro-analysis-subtitle">'+t('fro.transit_detail_desc','已发货未完全入库的 CI 明细')+'</div>'+
      '<div class="fro-analysis-total" id="fro-trs-total">'+t('common.loading','加载中...')+'</div>'+
      '<div class="fro-analysis-table" id="fro-trs-table"></div>'+
    '</div>';

  api('/api/financial-risk/in-transit-breakdown').then(function(d){
    var totalEl=document.getElementById('fro-trs-total');
    if(!totalEl) return;
    totalEl.innerHTML='<span class="fro-total-label">'+t('fro.in_transit_assets','在途资产')+'（CNY）</span> <span class="fro-total-amount">¥ '+fmtMoney(d.total,'')+'</span>';

    var tableEl=document.getElementById('fro-trs-table');
    if(!tableEl) return;

    if(!d.items||d.items.length===0){
      tableEl.innerHTML='<div class="fro-empty">'+t('common.no_data','暂无数据')+'</div>';
      return;
    }

    function inboundStatusLabel(s){
      if(s==='completed') return t('fro.inbound_complete','已入库');
      if(s==='partial') return t('fro.inbound_partial','部分入库');
      return t('fro.inbound_none','未入库');
    }
    function inboundBadgeClass(s){
      if(s==='completed') return 'status-completed';
      if(s==='partial') return 'status-warning';
      return 'status-pending';
    }

    var hdr='<tr>'+
      '<th>CI '+t('common.number','编号')+'</th>'+
      '<th>'+t('common.country','国家')+'</th>'+
      '<th>'+t('common.brand','品牌')+'</th>'+
      '<th>'+t('common.warehouse','仓库')+'</th>'+
      '<th>'+t('fro.logistics_status','物流状态')+'</th>'+
      '<th>'+t('fro.inbound_status','入库状态')+'</th>'+
      '<th>'+t('fro.amount_cny','金额(CNY)')+'</th>'+
      '<th>'+t('common.percentage','占比')+'</th>'+
    '</tr>';
    var total=d.total||0;
    var rowsHtml=d.items.map(function(it){
      var logLabel=logisticsStatusLabelByKey(it.logistics_display_status);
      var logBadge=logisticsStatusBadgeClassByKey(it.logistics_display_status);
      var inbLabel=inboundStatusLabel(it.inbound_derived_status);
      var inbBadge=inboundBadgeClass(it.inbound_derived_status);
      var pct=total>0?(Number(it.amount_cny||0)/total*100).toFixed(1):'0.0';
      return '<tr>'+
        '<td class="td-mono td-bold">'+esc(it.ci_no)+'</td>'+
        '<td>'+esc(it.country||'—')+'</td>'+
        '<td>'+esc(it.brand||'—')+'</td>'+
        '<td>'+esc(it.warehouse||'—')+'</td>'+
        '<td><span class="status-badge '+logBadge+'">'+esc(logLabel)+'</span></td>'+
        '<td><span class="status-badge '+inbBadge+'">'+esc(inbLabel)+'</span></td>'+
        '<td class="td-num td-bold">¥ '+fmtMoney(it.amount_cny,'')+'</td>'+
        '<td class="td-num">'+pct+'%</td>'+
      '</tr>';
    }).join('');
    tableEl.innerHTML='<table class="data-table fro-data-table"><thead>'+hdr+'</thead><tbody>'+rowsHtml+'</tbody></table>';
  }).catch(function(e){
    var el=document.getElementById('fro-trs-table');
    if(el) el.innerHTML='<div class="fro-empty fro-error">'+esc(e.message)+'</div>';
  });
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
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div id="simple-manager-page" data-load-seq="'+mySeq+'"><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">'+icon+' '+title+'</div><div class="table-section-actions">'+(hasPermission('system_config')?'<button class="btn btn-primary btn-sm" onclick="editSimple(\''+apiUrl+'\',\''+b64EncodeUnicode(JSON.stringify(fields))+'\')">'+t('common.add','➕ 新增')+'</button>':'')+'</div></div><div id="simple-table"></div></div></div>';
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
  document.getElementById('content-inner').innerHTML=
    '<div id="flash-container"></div>'+
    '<div class="table-section">'+
      '<div class="table-section-title"><div class="table-section-title-left">✅ 审批流管理</div>'+
      '<div class="table-section-actions"><span class="muted-hint">配置企业采购、付款等业务审批规则</span></div></div>'+
      '<div class="approval-flow-filter" style="display:flex;gap:8px;margin:6px 0 14px">'+
        '<span class="approval-tab active" data-f="all" onclick="onApprovalFlowFilter(\'all\')">全部</span>'+
        '<span class="approval-tab" data-f="po" onclick="onApprovalFlowFilter(\'po\')">采购</span>'+
        '<span class="approval-tab" data-f="payment" onclick="onApprovalFlowFilter(\'payment\')">付款</span>'+
      '</div>'+
      '<div id="approval-flow-editor"></div>'+
    '</div>';
  loadApprovalFlows();
}
// 审批流管理：仅 PO / Payment 两类可配置（均为既有类型，不新增）
const EDITABLE_FLOW_TYPES=['po','payment'];
let _afState={};
let _afCandidates=[];
let _afData=[];
let _afEditId=null;
let _afFilter='all';
function afSafeId(id){return String(id).replace(/[^a-zA-Z0-9_]/g,'_');}
function afSetEnable(flowId,checked){if(_afState[flowId])_afState[flowId].is_enabled=checked?1:0;}
function afSetUser(flowId,level,uid){const st=_afState[flowId];if(!st)return;const lv=st.levels.find(l=>l.level===level);if(lv)lv.approver_user_id=uid;}
function afBizTypeLabel(bt){return bt==='po'?'🛒 采购审批':(bt==='payment'?'💰 付款审批':bt);}
function afStatusBadge(on){return on?'<span style="color:#16a34a">🟢 已启用</span>':'<span style="color:#9ca3af">🔴 未启用</span>';}
function afApproverName(uid){
  if(!uid)return '未配置';
  const u=_afCandidates.find(x=>x.id===uid);
  return u?esc(u.name):'未配置';
}
// 候选人按业务类型过滤（PO→po_approve；Payment→payment_approve）；不修改后端接口
function afFilterCandidates(bt){
  if(bt==='po')return _afCandidates.filter(u=>u.has_po_approve);
  if(bt==='payment')return _afCandidates.filter(u=>u.has_payment_approve);
  return _afCandidates;
}
async function loadApprovalFlows(){
  try{
    const data=await api('/api/approval-flows');
    const cands=await api('/api/approval-candidates');
    // 隐藏 07-29「统一付款审批流」前的遗留付款场景孤儿流（flow_pay_* 且非 flow_pay 本身）。
    // 这些流 is_enabled=0 且运行时统一走 business_type='payment' 的 flow_pay，纯展示噪音。仅前端过滤，不动 DB/API/逻辑。
    _afData=data.filter(f=>!(String(f.id).startsWith('flow_pay_')&&f.id!=='flow_pay'));
    _afCandidates=cands;_afEditId=null;_afState={};
    for(const f of _afData){
      _afState[f.id]={name:f.name,business_type:f.business_type,is_enabled:!!f.is_enabled,
        levels:(Array.isArray(f.levels)?f.levels:[]).map(l=>({level:Number(l.level),approver_user_id:l.approver_user_id||''}))};
    }
    afRenderAll();
  }catch(e){showFlash(e.message,'danger')}
}
// 付款审批流节点语义标签（纯展示，不落库、不进 levels JSON、不改审批引擎）
// L1=财务审批节点，L2=付款人审批节点（付款执行）；其余业务类型/级次返回空
function afNodeSemanticLabel(businessType, level){
  if(businessType!=='payment')return '';
  if(level===1)return '财务审批节点';
  if(level===2)return '付款人审批节点（付款执行）';
  return '';
}
// 展示态：业务化卡片（与编辑态分离）
function afRenderCards(f){
  const st=_afState[f.id]||{};
  const levels=(st.levels||[]).slice().sort((a,b)=>a.level-b.level);
  const nodes=levels.length
    ? levels.map(lv=>{const sem=afNodeSemanticLabel(f.business_type,lv.level);const head=sem?('<b>'+lv.level+'级 '+esc(sem)+'</b>'):(lv.level+' 审批人');return '<div style="margin:4px 0">'+head+'：'+afApproverName(lv.approver_user_id)+'</div>';}).join('')
    : '<div class="muted-hint">暂无审批节点，点击「编辑流程」配置</div>';
  return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:14px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div><b>'+esc(f.name)+'</b> <span class="muted-hint">'+afBizTypeLabel(f.business_type)+'（'+esc(f.business_type)+'）</span></div>'+
      afStatusBadge(!!f.is_enabled)+
    '</div>'+
    '<div class="muted-hint" style="margin-bottom:8px">审批级别：'+levels.length+' 级</div>'+
    '<div style="background:#f9fafb;border-radius:6px;padding:8px;margin-bottom:10px">'+nodes+'</div>'+
    '<div><button class="btn btn-secondary" onclick="afEditFlow(\''+esc(f.id)+'\')">编辑流程</button></div>'+
  '</div>';
}
// 编辑态卡片：复用 afRenderLevels 渲染节点编辑器
function afCardEdit(f){
  return '<div style="border:1px solid #3b82f6;border-radius:8px;padding:14px;margin-bottom:14px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div><b>'+esc(f.name)+'</b> <span class="muted-hint">'+afBizTypeLabel(f.business_type)+'</span></div>'+
      '<label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" '+(f.is_enabled?'checked':'')+' onchange="afSetEnable(\''+esc(f.id)+'\',this.checked)"> 启用</label>'+
    '</div>'+
    '<div id="aflevels_'+afSafeId(f.id)+'"></div>'+
    '<div style="margin-top:10px;display:flex;gap:8px">'+
      '<button class="btn btn-secondary" onclick="afAddLevel(\''+esc(f.id)+'\')">＋ 添加审批节点</button>'+
      '<button class="btn btn-primary" onclick="afSaveFlow(\''+esc(f.id)+'\')">💾 保存</button>'+
      '<button class="btn btn-secondary" onclick="afCancelEdit(\''+esc(f.id)+'\')">取消</button>'+
    '</div>'+
  '</div>';
}
function afRenderAll(){
  const wrap=document.getElementById('approval-flow-editor');
  if(!wrap)return;
  const list=_afData.filter(f=>_afFilter==='all'||f.business_type===_afFilter);
  if(!list.length){wrap.innerHTML='<div class="empty-state"><div class="empty-icon">✅</div>暂无审批流</div>';return;}
  let html='';
  for(const f of list){
    const editable=EDITABLE_FLOW_TYPES.includes(f.business_type);
    if(editable&&_afEditId===f.id) html+=afCardEdit(f);
    else html+=afRenderCards(f);
  }
  wrap.innerHTML=html;
  for(const f of list){
    if(EDITABLE_FLOW_TYPES.includes(f.business_type)&&_afEditId===f.id) afRenderLevels(f.id);
  }
  const tabs=document.querySelectorAll('.approval-flow-filter .approval-tab');
  tabs.forEach(el=>el.classList.toggle('active',el.dataset.f===_afFilter));
}
function onApprovalFlowFilter(type){_afFilter=type;afRenderAll();}
function afEditFlow(id){_afEditId=id;afRenderAll();}
function afCancelEdit(id){_afEditId=null;loadApprovalFlows();}
function afRenderLevels(flowId){
  const st=_afState[flowId]; if(!st)return;
  const box=document.getElementById('aflevels_'+afSafeId(flowId)); if(!box)return;
  const sorted=st.levels.slice().sort((a,b)=>a.level-b.level);
  const cands=afFilterCandidates(st.business_type);
  let html='';
  sorted.forEach(lv=>{
    const opts=cands.map(u=>'<option value="'+esc(u.id)+'" '+(u.id===lv.approver_user_id?'selected':'')+'>'+esc(u.name)+'（'+esc(formatRoleLabel(u.role_id,u.role_name))+'）</option>').join('');
    html+='<div style="display:flex;gap:8px;align-items:center;margin:6px 0">'+
      '<span style="min-width:64px">'+lv.level+' 级'+(afNodeSemanticLabel(st.business_type,lv.level)?(' · '+esc(afNodeSemanticLabel(st.business_type,lv.level))):'')+'</span>'+
      '<select data-af-user="'+lv.level+'" onchange="afSetUser(\''+esc(flowId)+'\','+lv.level+',this.value)" style="flex:1">'+opts+'</select>'+
      '<button class="btn btn-secondary" onclick="afMoveLevel(\''+esc(flowId)+'\','+lv.level+',-1)" title="上移">↑</button>'+
      '<button class="btn btn-secondary" onclick="afMoveLevel(\''+esc(flowId)+'\','+lv.level+',1)" title="下移">↓</button>'+
      '<button class="btn btn-secondary" onclick="afRemoveLevel(\''+esc(flowId)+'\','+lv.level+')" title="删除">✕</button>'+
    '</div>';
  });
  if(!sorted.length) html='<div class="muted-hint">请添加审批节点</div>';
  box.innerHTML=html;
}
function afAddLevel(flowId){const st=_afState[flowId];if(!st)return;const maxL=st.levels.reduce((m,l)=>Math.max(m,l.level),0);const cands=afFilterCandidates(st.business_type);st.levels.push({level:maxL+1,approver_user_id:cands[0]?cands[0].id:''});afRenderLevels(flowId);}
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
  try{await api('/api/approval-flows','POST',payload);showToast(t('gen.L765.1','审批流已保存'),'success');_afEditId=null;loadApprovalFlows();}
  catch(e){showToast(e.message,'danger')}
}
// ==================== 审批中心（PO 审批人侧补齐，最小范围） ====================
// 信息架构预留：待我审批 / 全部待审批 / 采购类 / 财务类 / 确认任务 / 抄送我的 / 已处理
// 本期仅实现 PO 审批（待我审批/全部待审批/采购类 共用 PO 待审列表）；其余分类为占位。
function renderApprovalCenter(){
  // Phase 2: 根据具体审批权限动态显示标签
  var _hasPoApprove = hasPermission('po_approve');
  var _hasPaymentApprove = hasPermission('payment_approve');
  var _hasCheckApprove = hasPermission('check_approve');
  var tabs=[];
  if(_hasPoApprove){
    tabs.push({id:'mine',label:t("app.378", "\u5f85\u6211\u5ba1\u6279")});
    tabs.push({id:'all',label:t("app.379", "\u5168\u90e8\u5f85\u5ba1\u6279")});
    tabs.push({id:'purchase',label:t("app.380", "\u91c7\u8d2d\u5ba1\u6279")});
  }
  if(_hasPaymentApprove){
    tabs.push({id:'finance',label:t("app.381", "\u4ed8\u6b3e\u5ba1\u6279")});
  }
  if(_hasCheckApprove){
    tabs.push({id:'check',label:t("app.1200", "\u5e93\u5b58\u5ba1\u6279")});
  }
  // Phase 2: 无具体审批权限 → 空状态
  if(tabs.length===0){
    document.getElementById('content-inner').innerHTML='<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">\u2705 '+t('nav.approval_center','\u5ba1\u6279\u4e2d\u5fc3')+'</div></div><div class="empty-state"><div class="empty-icon">\ud83d\udcb3</div>'+t('approval.no_permission','\u60a8\u6682\u65e0\u5ba1\u6279\u6743\u9650\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u5206\u914d\u76f8\u5173\u6743\u9650\u3002')+'</div></div>';
    return;
  }
  document.getElementById('content-inner').innerHTML=t('html.renderApprovalCenter', '<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">\u2705 \u5ba1\u6279\u4e2d\u5fc3</div><div class="table-section-actions"><span class="muted-hint">\u5df2\u63a5\u5165 PO \u5ba1\u6279\uff08\u91c7\u8d2d\u7c7b\uff09\u4e0e\u4ed8\u6b3e\u7533\u8bf7\u5ba1\u6279\uff08\u8d22\u52a1\u7c7b\uff09\uff0c\u5176\u4f59\u5206\u7c7b\u9884\u7559</span></div></div><div class="approval-tabs" id="approval-tabs">{v1}</div><div id="approval-list"></div></div>', {v1: tabs.map(function(tab,i){return '<span class="approval-tab'+(i===0?' active':'')+'" data-tab="'+tab.id+'" onclick="switchApprovalTab(\''+tab.id+'\')">'+tab.label+'</span>';}).join('')});
  switchApprovalTab(tabs[0].id);
}
let _approvalTab='mine';
let _approvalListData=[];
function switchApprovalTab(tab){
  _approvalTab=tab;
  document.querySelectorAll('#approval-tabs .approval-tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));
  // 待我审批 / 全部待审批 / 采购类审批 → PO 待审列表；财务类审批 → 付款申请待审列表；库存审批 → 占位
  if(tab==='mine'||tab==='all'||tab==='purchase'){
    loadApprovalCenterList();
  }else if(tab==='finance'){
    loadFinanceApprovalList();
  }else if(tab==='check'){
    document.getElementById('approval-list').innerHTML='<div class="empty-state"><div class="empty-icon">🚧</div>'+t('approval.check_placeholder','库存审批功能将在后续版本接入')+'</div>';
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
    // 财务类审批列表状态标签：pending=待审批；approved 且未 paid=待付款确认（付款确认中）
    const financeStateLabel=(p)=>{
      if(p.approval_status==='approved' && p.payment_status!=='paid'){
        return String(p.payment_status||'').includes('partial') ? t('payment.state_pay_confirming','付款确认中') : t('payment.state_pending_pay_confirm','待付款确认');
      }
      return t('payment.state_pending_approval','待审批');
    };
    const financeStateClass=(p)=>(p.approval_status==='approved'&&p.payment_status!=='paid')?'status-pending':'status-approved';
    wrap.innerHTML=t('html.loadFinanceApprovalList', '<div class="table-container"><table class="data-table"><thead><tr><th>申请号</th><th>大类</th><th>小类</th><th>来源单号</th><th>关联CI</th><th>付款对象</th><th class="text-right">总数量</th><th class="text-right">应付金额</th><th>币种</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead><tbody>{v1}</tbody></table></div>', {v1: data.map(p=>{
        const catLabel=PAY_CATEGORIES[p.payment_category]||p.payment_category;
        const subLabel=(PAY_SUBCATS[p.payment_category]&&PAY_SUBCATS[p.payment_category][p.payment_subcategory])||p.payment_subcategory||'';
        const qtyTxt=(p.total_qty!==null&&p.total_qty!==undefined)?Number(p.total_qty).toLocaleString('en-US'):'—';
        const isPayConfirm=(p.approval_status==='approved'&&p.payment_status!=='paid');
        const btnTitle=isPayConfirm?t('payment.finance_pay_confirm','付款确认'):(canApprove?t('gen.L822.1','查看/审批'):t("app.389", "\u67e5\u770b\u8be6\u60c5"));
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
          '<td><span class="status-badge '+financeStateClass(p)+'">'+esc(financeStateLabel(p))+'</span></td>'+
          '<td class="cell-actions">'+
            '<button class="action-btn" onclick="viewPayment(\''+p.id+'\',\'finance\')" title="'+btnTitle+'">👁️</button>'+
          '</td>'+
        '</tr>';
      }).join('')});
  }catch(e){showFlash(e.message,'danger')}
}
function tabLabel(id){const m={mine:t("app.378", "\u5f85\u6211\u5ba1\u6279"),all:t("app.379", "\u5168\u90e8\u5f85\u5ba1\u6279"),purchase:t("app.380", "\u91c7\u8d2d\u5ba1\u6279"),finance:t("app.381", "\u4ed8\u6b3e\u5ba1\u6279"),check:t("app.1200", "\u5e93\u5b58\u5ba1\u6279"),confirm:t("app.382", "\u786e\u8ba4\u4efb\u52a1"),cc:t("app.383", "\u6284\u9001\u6211\u7684"),done:t("app.384", "\u5df2\u5904\u7406")};return m[id]||id;}
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
      // FEISHU-USER-ROLE-SAVE-MINIMAL-FIX: role_id=null 时占位项 selected 且不禁用，
      // 避免 disabled+selected 导致浏览器忽略 selected 而默认显示第一个真实角色（超级管理员）。
      // role_id 已存在时占位项 disabled，管理员无法误选"未分配"。
      const rolePlaceholder = isBG ? '' : '<option value=""'+(!u.role_id?' selected':' disabled')+'>'+t('user.role_unassigned','未分配')+'</option>';
      const roleSel = '<select class="user-role-sel" data-uid="'+u.id+'"'+(isBG?t('gen.L948.1',' disabled title="\u5e94\u6025\u8d26\u53f7\u89d2\u8272\u56fa\u5b9a"'):'')+'>'+rolePlaceholder+roles.map(r=>'<option value="'+r.id+'"'+(r.id===u.role_id?' selected':'')+'>'+esc(formatRoleLabel(r.id, r.name))+'</option>').join('')+'</select>';
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
      // USER-SCOPE: 数据权限来源标识
      var dsCell;
      if(u.role_id==='role_admin'){
        dsCell='<span style="font-size:12px;color:#999">'+t('user.data_scope_admin','不限制')+'</span>';
      }else if(u.has_personal_scope){
        dsCell='<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:#fff3e0;color:#e65100;cursor:pointer" onclick="openUserDataScopeEditor(\''+u.id+'\')">'+t('user.data_scope_personal','个人覆盖')+'</span>';
      }else{
        dsCell='<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:#e3f2fd;color:#1565c0;cursor:pointer" onclick="openUserDataScopeEditor(\''+u.id+'\')">'+t('user.data_scope_inherited','继承角色')+'</span>';
      }
      return '<tr>'
        +'<td>'+esc(u.name||'')+'</td>'
        +'<td>'+esc(u.username||'')+'</td>'
        +'<td>'+esc(u.feishu_union_id||'')+'</td>'
        +'<td>'+esc(u.email||'')+'</td>'
        +'<td>'+(isBG?t('gen.L959.1','本地应急'):t("app.415", "\u98de\u4e66"))+'</td>'
        +'<td>'+statusBadge+'</td>'
        +'<td>'+roleSel+'</td>'
        +'<td>'+langSel+'</td>'
        +'<td>'+dsCell+'</td>'
        +'<td>'+actionBtn+'</td>'
        +'</tr>';
    }).join('');
    document.getElementById('content-inner').innerHTML=
      t('html.renderUsers', '<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">👤 用户管理</div></div><div class="table-container"><table class="data-table"><thead><tr><th>姓名</th><th>用户名</th><th>飞书标识(脱敏)</th><th>邮箱</th><th>来源</th><th>状态</th><th>角色</th><th>语言偏好</th><th>数据权限</th><th>操作</th></tr></thead><tbody>{v1}</tbody></table></div><div class="pc-hint">用户由飞书首次登录自动创建（默认 <b>'+statusLabel('pending')+'</b>，无角色、无权限）。管理员启用并分配角色后，用户方可进入业务。不允许创建本地密码账号、不允许修改密码、不允许编辑飞书标识、不允许停用/删除应急账号。</div></div>', {v1: rows});
    // I18N-B1-PAGE-CONTEXT-STATE-01：限定 [data-uid] 排除顶部 lang-switcher（class同为 user-role-sel），
    // 否则 renderUsers 会给 lang-switcher 绑定 setUserRole，语言切换时 setUserRole(undefined) → renderUsers() 覆盖当前页
    document.querySelectorAll('.user-role-sel[data-uid]').forEach(sel=>{ sel.addEventListener('change',()=>setUserRole(sel.dataset.uid, sel.value)); });
    document.querySelectorAll('.user-lang-sel[data-uid]').forEach(sel=>{ sel.addEventListener('change',()=>setUserLanguagePreference(sel.dataset.uid, sel.value)); });
  }catch(e){ showFlash(e.message,'danger'); }
}
async function setUserRole(uid, roleId){
  if(!roleId){ showToast(t('user.role_select_required','请选择有效角色'),'warning'); renderUsers(); return; }
  const u=(window.__userCache||[]).find(x=>x.id===uid);
  if(!u){ renderUsers(); return; }
  try{ await api('/api/users/'+uid,'PUT',{username:u.username, name:u.name, role_id:roleId}); showToast(t('gen.L973.1','角色已更新'),'success'); renderUsers(); }catch(e){ showToast(e.message,'danger'); renderUsers(); }
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

// ==================== 用户数据权限覆盖（USER-SCOPE） ====================
// 用户个人数据权限 > 角色数据权限 > 无限制
async function openUserDataScopeEditor(userId){
  try{
    var u=(window.__userCache||[]).find(x=>x.id===userId);
    if(!u){showToast(t('gen.L1028.1','未找到该用户'),'danger');return;}
    // 并行加载：用户数据权限 + 角色数据权限参考 + 可选国家/品牌/仓库
    var isAdmin=u.role_id==='role_admin';
    var result=isAdmin?{source:'admin',personal:null,role:null}:await api('/api/users/'+userId+'/data-scope');
    var countries=isAdmin?[]:await api('/api/countries');
    var brands=isAdmin?[]:await api('/api/brands/all');
    var warehouses=isAdmin?[]:await api('/api/warehouses');
    var body='<div style="font-size:12px;color:var(--text-secondary,#999);margin-bottom:10px">'+t('user.data_scope_user','用户：')+'<b>'+esc(u.name||u.username||'')+'</b></div>';
    if(isAdmin){
      body+='<div class="flash flash-info show" style="margin-bottom:12px">'+t('user.data_scope_admin_hint','超级管理员不受数据权限限制，无需配置。')+'</div>';
    }else{
      // 权限来源标识
      var sourceLabel=result.source==='personal'
        ?'<span style="padding:2px 8px;border-radius:4px;background:#fff3e0;color:#e65100;font-size:12px">'+t('user.data_scope_personal','个人覆盖')+'</span>'
        :'<span style="padding:2px 8px;border-radius:4px;background:#e3f2fd;color:#1565c0;font-size:12px">'+t('user.data_scope_inherited','继承角色')+'</span>';
      body+='<div style="margin-bottom:12px"><span style="font-weight:600;font-size:13px">'+t('user.data_scope_source','权限来源：')+'</span>'+sourceLabel+'</div>';
      // 如果继承角色，显示角色当前配置作为参考
      if(result.source==='role'&&result.role){
        var roleScope=result.role;
        var roleInfo=[];
        if(roleScope.countries&&roleScope.countries.length)roleInfo.push(t('user.data_scope_countries','国家')+': '+roleScope.countries.length);
        if(roleScope.brands&&roleScope.brands.length)roleInfo.push(t('user.data_scope_brands','品牌')+': '+roleScope.brands.length);
        if(roleScope.warehouses&&roleScope.warehouses.length)roleInfo.push(t('user.data_scope_warehouses','仓库')+': '+roleScope.warehouses.length);
        if(roleInfo.length){
          body+='<div style="font-size:12px;color:var(--text-secondary,#999);margin-bottom:10px;padding:6px 10px;background:var(--surface-muted,#f5f5f5);border-radius:6px">'+t('user.data_scope_role_ref','角色当前配置')+'：'+roleInfo.join(' · ')+'</div>';
        }else{
          body+='<div style="font-size:12px;color:var(--text-secondary,#999);margin-bottom:10px">'+t('user.data_scope_role_empty','角色未配置数据权限（当前不限制）')+'</div>';
        }
      }
      // 当前选中的值（个人配置 or 空数组）
      var sel=result.personal||{countries:[],brands:[],warehouses:[]};
      var countryItems=countries.map(function(c){return{id:c.id,name:c.name};});
      var warehouseItems=warehouses.map(function(w){return{id:w.id,name:w.name+(w.country_name?' ('+w.country_name+')':'')};});
      body+='<div style="font-size:12px;color:var(--text-secondary,#999);margin-bottom:6px">'+t('user.data_scope_personal_hint','勾选用户个人数据范围，将覆盖角色配置。不勾选则该维度不限制。')+'</div>';
      // 国家
      body+='<div style="margin-bottom:12px">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
        +'<span style="font-weight:600;font-size:13px">'+t('user.data_scope_countries','国家')+'</span>'
        +'<span style="font-size:12px"><a href="javascript:void(0)" onclick="document.querySelectorAll(\'.uds-country-cb\').forEach(function(cb){cb.checked=true})" style="color:var(--primary,#2e7d32)">'+t('action.select_all','全选')+'</a> | <a href="javascript:void(0)" onclick="document.querySelectorAll(\'.uds-country-cb\').forEach(function(cb){cb.checked=false})" style="color:var(--danger,#e53e3e)">'+t('action.clear','清空')+'</a></span>'
        +'</div>'
        +'<div style="max-height:100px;overflow-y:auto;border:1px solid var(--border,#e0e0e0);border-radius:6px;padding:8px">'+dsCheckboxList(countryItems,sel.countries,'uds-country','id','name')+'</div>'
        +'</div>';
      // 品牌
      body+='<div style="margin-bottom:12px">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
        +'<span style="font-weight:600;font-size:13px">'+t('user.data_scope_brands','品牌')+'</span>'
        +'<span style="font-size:12px"><a href="javascript:void(0)" onclick="document.querySelectorAll(\'.uds-brand-cb\').forEach(function(cb){cb.checked=true})" style="color:var(--primary,#2e7d32)">'+t('action.select_all','全选')+'</a> | <a href="javascript:void(0)" onclick="document.querySelectorAll(\'.uds-brand-cb\').forEach(function(cb){cb.checked=false})" style="color:var(--danger,#e53e3e)">'+t('action.clear','清空')+'</a></span>'
        +'</div>'
        +'<div style="max-height:100px;overflow-y:auto;border:1px solid var(--border,#e0e0e0);border-radius:6px;padding:8px">'+dsCheckboxList(brands.map(function(b){return{id:b,name:b};}),sel.brands,'uds-brand','id','name')+'</div>'
        +'</div>';
      // 仓库
      body+='<div style="margin-bottom:12px">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
        +'<span style="font-weight:600;font-size:13px">'+t('user.data_scope_warehouses','仓库')+'</span>'
        +'<span style="font-size:12px"><a href="javascript:void(0)" onclick="document.querySelectorAll(\'.uds-warehouse-cb\').forEach(function(cb){cb.checked=true})" style="color:var(--primary,#2e7d32)">'+t('action.select_all','全选')+'</a> | <a href="javascript:void(0)" onclick="document.querySelectorAll(\'.uds-warehouse-cb\').forEach(function(cb){cb.checked=false})" style="color:var(--danger,#e53e3e)">'+t('action.clear','清空')+'</a></span>'
        +'</div>'
        +'<div style="max-height:100px;overflow-y:auto;border:1px solid var(--border,#e0e0e0);border-radius:6px;padding:8px">'+dsCheckboxList(warehouseItems,sel.warehouses,'uds-warehouse','id','name')+'</div>'
        +'</div>';
    }
    // 按钮：保存 + 清除个人配置（仅个人覆盖时显示） + 取消
    var footer='<button class="btn btn-secondary" onclick="closeModal()">'+t('role.btn.cancel','取消')+'</button>';
    if(!isAdmin){
      if(result.source==='personal'){
        footer+='<button class="btn btn-warning" id="uds-clear-btn" data-uid="'+esc(userId)+'">'+t('user.data_scope_clear','清除个人配置')+'</button>';
      }
      footer+='<button class="btn btn-primary" id="uds-save-btn" data-uid="'+esc(userId)+'">'+t('role.btn.save','保存')+'</button>';
    }
    openModal(t('user.data_scope_title','用户数据权限配置 · {v1}',{v1:u.name||u.username||''}),body,footer,'modal-lg');
    var saveBtn=document.getElementById('uds-save-btn');
    if(saveBtn){saveBtn.addEventListener('click',function(){saveUserDataScope(this.getAttribute('data-uid'));});}
    var clearBtn=document.getElementById('uds-clear-btn');
    if(clearBtn){clearBtn.addEventListener('click',function(){
      if(confirm(t('user.data_scope_clear_confirm','清除后将回退到角色数据权限，确认？'))){
        clearUserDataScope(this.getAttribute('data-uid'));
      }
    });}
  }catch(e){showToast(e.message||t("app.427","打开失败"),'danger')}
}
async function saveUserDataScope(userId){
  try{
    var dsCountries=Array.from(document.querySelectorAll('#modal-content .uds-country-cb:checked')).map(function(cb){return cb.value;});
    var dsBrands=Array.from(document.querySelectorAll('#modal-content .uds-brand-cb:checked')).map(function(cb){return cb.value;});
    var dsWarehouses=Array.from(document.querySelectorAll('#modal-content .uds-warehouse-cb:checked')).map(function(cb){return cb.value;});
    await api('/api/users/'+userId+'/data-scope','PUT',{countries:dsCountries,brands:dsBrands,warehouses:dsWarehouses});
    showToast(t('user.data_scope_saved','用户数据权限已保存'),'success');
    closeModal();
    renderUsers();
  }catch(e){showToast(e.message,'danger')}
}
async function clearUserDataScope(userId){
  try{
    await api('/api/users/'+userId+'/data-scope','DELETE');
    showToast(t('user.data_scope_cleared','已清除个人数据权限，回退到角色级'),'success');
    closeModal();
    renderUsers();
  }catch(e){showToast(e.message,'danger')}
}

// ==================== 数据权限管理（角色级） ====================
// 复用：数据权限多选列表 HTML 生成
function dsCheckboxList(items, selected, idPrefix, valueKey, labelKey){
  return items.map((item) => {
    const val = item[valueKey];
    const label = item[labelKey] || val;
    const checked = selected.indexOf(val) >= 0 ? ' checked' : '';
    return '<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 8px;cursor:pointer;white-space:nowrap">'
      + '<input type="checkbox" class="'+idPrefix+'-cb" value="'+esc(val)+'"'+checked+'>'
      + '<span>'+esc(label)+'</span></label>';
  }).join('');
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
const ROLE_MODULE_ORDER=['首页','销售','采购链','库存','财务','审批','系统管理'];
async function openRoleEditor(roleId){
  try{
    const role=roleListData.find(r=>r.id===roleId);
    if(!role){showToast(t('gen.L1000.1','未找到该角色'),'danger');return;}
    // 并行加载：权限目录 + 角色数据权限 + 可选国家/品牌/仓库
    const isAdmin = role.id==='role_admin';
    const [catalog, scope, countries, brands, warehouses] = await Promise.all([
      api('/api/permissions'),
      isAdmin ? Promise.resolve(null) : api('/api/roles/'+roleId+'/data-scope'),
      isAdmin ? Promise.resolve([]) : api('/api/countries'),
      isAdmin ? Promise.resolve([]) : api('/api/brands/all'),
      isAdmin ? Promise.resolve([]) : api('/api/warehouses')
    ]);
    const own=role.permissions||[];
    const groups={};
    catalog.forEach(p=>{ (groups[p.module]=groups[p.module]||[]).push(p); });
    let body=t('gen.L1005.1','<div style="font-size:12px;color:var(--text-secondary,#999);margin-bottom:10px">')+t('role.field.name_readonly','角色名称（只读）：')+'<b>'+esc(formatRoleLabel(role.id, role.name))+t('gen.L1005.2','</b> ｜ ')+t('role.field.desc_readonly','角色说明（只读）：')+esc(formatRoleDescription(role.id, role.description))+'</div>';
    if(isAdmin){
      body+='<div class="flash flash-warning show" style="margin-bottom:12px">'+t('role.locked_warning','超级管理员角色：关键管理权限（角色管理 / 用户管理 / 系统配置）已被锁定，不可取消，以避免系统失去管理入口。')+'</div>';
    }
    // --- 1. 页面权限（功能权限）---
    body+='<div style="font-weight:700;margin:16px 0 6px;font-size:14px;border-bottom:2px solid var(--border,#e0e0e0);padding-bottom:4px">'+t('role.section.page_perm','页面权限')+'</div>';
    ROLE_MODULE_ORDER.forEach(mod=>{
      const items=groups[mod]; if(!items||!items.length)return;
      body+='<div style="font-weight:600;margin:12px 0 6px;font-size:13px">'+esc(formatPermModule(mod))+'</div>';
      // Phase 2: 按 submodule 分组渲染
      var subgroups={};
      items.forEach(function(p){
        var sm=p.submodule||'';
        (subgroups[sm]=subgroups[sm]||[]).push(p);
      });
      Object.keys(subgroups).forEach(function(sm){
        if(sm){
          body+='<div style="font-weight:500;margin:8px 0 4px 12px;font-size:12px;color:var(--text-secondary,#666)">'+esc(formatPermSubmodule(sm))+'</div>';
        }
        body+='<div style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-left:12px">';
        subgroups[sm].forEach(function(p){
          var checked=own.includes(p.key)?'checked':'';
          var locked=(isAdmin&&ROLE_CRITICAL_PERMS.includes(p.key));
          var dis=locked?'disabled':'';
          var lockIco=locked?' 🔒':'';
          body+='<label style="font-size:13px;display:flex;align-items:center;gap:4px;min-width:140px"><input type="checkbox" data-perm="'+esc(p.key)+'" '+checked+' '+dis+'>'+esc(formatPermLabel(p.key, p.label))+lockIco+'</label>';
        });
        body+='</div>';
      });
    });
    // --- 2. 数据权限（Data Scope）---
    if(!isAdmin){
      const selCountries = (scope&&scope.countries) || [];
      const selBrands = (scope&&scope.brands) || [];
      const selWarehouses = (scope&&scope.warehouses) || [];
      const countryItems = countries.map(c => ({id: c.id, name: c.name}));
      const warehouseItems = warehouses.map(w => ({id: w.id, name: w.name + (w.country_name ? ' ('+w.country_name+')' : '')}));
      body+='<div style="font-weight:700;margin:20px 0 6px;font-size:14px;border-bottom:2px solid var(--border,#e0e0e0);padding-bottom:4px">'+t('role.section.data_scope','数据权限')+'</div>';
      body+='<div style="font-size:12px;color:var(--text-secondary,#999);margin-bottom:10px">'+t('role.data_scope_hint','勾选该角色可访问的数据范围。不勾选则不限制该维度。仅对非管理员角色生效。')+'</div>';
      // 国家
      body+='<div style="margin-bottom:12px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
        +   '<span style="font-weight:600;font-size:13px">'+t('user.data_scope_countries','国家')+'</span>'
        +   '<span style="font-size:12px"><a href="javascript:void(0)" onclick="document.querySelectorAll(\'.ds-country-cb\').forEach(cb=>cb.checked=true)" style="color:var(--primary,#2e7d32)">'+t('action.select_all','全选')+'</a> | <a href="javascript:void(0)" onclick="document.querySelectorAll(\'.ds-country-cb\').forEach(cb=>cb.checked=false)" style="color:var(--danger,#e53e3e)">'+t('action.clear','清空')+'</a></span>'
        + '</div>'
        + '<div style="max-height:100px;overflow-y:auto;border:1px solid var(--border,#e0e0e0);border-radius:6px;padding:8px">'+dsCheckboxList(countryItems, selCountries, 'ds-country', 'id', 'name')+'</div>'
        + '</div>';
      // 品牌
      body+='<div style="margin-bottom:12px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
        +   '<span style="font-weight:600;font-size:13px">'+t('user.data_scope_brands','品牌')+'</span>'
        +   '<span style="font-size:12px"><a href="javascript:void(0)" onclick="document.querySelectorAll(\'.ds-brand-cb\').forEach(cb=>cb.checked=true)" style="color:var(--primary,#2e7d32)">'+t('action.select_all','全选')+'</a> | <a href="javascript:void(0)" onclick="document.querySelectorAll(\'.ds-brand-cb\').forEach(cb=>cb.checked=false)" style="color:var(--danger,#e53e3e)">'+t('action.clear','清空')+'</a></span>'
        + '</div>'
        + '<div style="max-height:100px;overflow-y:auto;border:1px solid var(--border,#e0e0e0);border-radius:6px;padding:8px">'+dsCheckboxList(brands.map(b=>({id:b,name:b})), selBrands, 'ds-brand', 'id', 'name')+'</div>'
        + '</div>';
      // 仓库
      body+='<div style="margin-bottom:12px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
        +   '<span style="font-weight:600;font-size:13px">'+t('user.data_scope_warehouses','仓库')+'</span>'
        +   '<span style="font-size:12px"><a href="javascript:void(0)" onclick="document.querySelectorAll(\'.ds-warehouse-cb\').forEach(cb=>cb.checked=true)" style="color:var(--primary,#2e7d32)">'+t('action.select_all','全选')+'</a> | <a href="javascript:void(0)" onclick="document.querySelectorAll(\'.ds-warehouse-cb\').forEach(cb=>cb.checked=false)" style="color:var(--danger,#e53e3e)">'+t('action.clear','清空')+'</a></span>'
        + '</div>'
        + '<div style="max-height:100px;overflow-y:auto;border:1px solid var(--border,#e0e0e0);border-radius:6px;padding:8px">'+dsCheckboxList(warehouseItems, selWarehouses, 'ds-warehouse', 'id', 'name')+'</div>'
        + '</div>';
    }
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
    // 保存页面权限
    await api('/api/roles','POST',{id:roleId,name:role.name,description:role.description||'',permissions:perms});
    // 保存数据权限（非管理员角色）
    if(roleId!=='role_admin'){
      const dsCountries = Array.from(document.querySelectorAll('#modal-content .ds-country-cb:checked')).map(cb => cb.value);
      const dsBrands = Array.from(document.querySelectorAll('#modal-content .ds-brand-cb:checked')).map(cb => cb.value);
      const dsWarehouses = Array.from(document.querySelectorAll('#modal-content .ds-warehouse-cb:checked')).map(cb => cb.value);
      await api('/api/roles/'+roleId+'/data-scope', 'PUT', { countries: dsCountries, brands: dsBrands, warehouses: dsWarehouses });
    }
    showToast(t('gen.L1036.1','角色权限已保存'),'success');
    closeModal();
    loadRoles();
  }catch(e){showToast(e.message||t("app.429", "\u4fdd\u5b58\u5931\u8d25"),'danger')}
}

// ==================== 品牌设置 ====================
// 品牌采购状态（停采品牌系统级规则）：在品牌设置页维护 可采购/停采
let brandSettingsLoadSeq=0;
async function renderBrandSettings(){
  const mySeq=++brandSettingsLoadSeq;
  document.getElementById('content-inner').innerHTML=t('html.renderBrandSettings', '<div id="flash-container"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🏷️ 品牌设置</div><div class="table-section-actions">{v1}</div></div><div id="brand-settings-table"></div></div>', {v1: hasPermission('system_config')?t('gen.L1045.1','<button class="btn btn-primary btn-sm" onclick="saveBrandSettings()">💾 保存采购状态</button>'):''});
  try{
    const brands=await api('/api/brands/all');
    if(mySeq!==brandSettingsLoadSeq||currentPage!=='brand-settings')return;
    let settings=[];
    try{ settings=await api('/api/brand-settings'); }catch(e){ settings=[]; }
    if(mySeq!==brandSettingsLoadSeq||currentPage!=='brand-settings')return;
    const statusMap={};
    settings.forEach(s=>{ statusMap[s.brand]=s.procurement_status; });
    const skus=await api('/api/skus');
    if(mySeq!==brandSettingsLoadSeq||currentPage!=='brand-settings')return;
    const brandCount={};
    skus.forEach(s=>{if(s.brand){brandCount[s.brand]=(brandCount[s.brand]||0)+1}});
    if(!brands.length){
      const bsTbl0=document.getElementById('brand-settings-table');
      if(bsTbl0)bsTbl0.innerHTML='<div class="empty-state"><div class="empty-icon">🏷️</div>'+t('html.brand.emptyState','暂无品牌数据')+'<br><span style="font-size:12px;color:#999">'+t('html.brand.emptyStateHint','品牌来源于 SKU 主数据中的品牌字段')+'</span></div>';
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
    const bsTbl=document.getElementById('brand-settings-table');
    if(!bsTbl)return;
    bsTbl.innerHTML=html;
    // 语言切换刷新守卫：任一品牌采购状态下拉变更即标记未保存，阻止切换语言时整页刷新丢值
    document.querySelectorAll('#brand-settings-table select[data-brand]').forEach(sel=>{
      sel.addEventListener('change',()=>{ window.__brandUnsaved=true; });
    });
  }catch(e){
    if(mySeq===brandSettingsLoadSeq&&currentPage==='brand-settings')showFlash(e.message,'danger');
  }
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
  {key:'weighted_avg_cost',label:t("po.011", "\u52a0\u6743\u5e73\u5747\u6210\u672c"),format:parseFloat},
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
        '<div style="color:#666">'+t("html.inv.wac_auto", "期初库存导入时，加权平均成本列作为初始本币成本；已有有效WAC不会被覆盖；后续CI入库时系统将按已确认成本版本自动匹配。")+'</div>'+
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
        if(rec.available_qty===undefined||rec.available_qty===''||!isFinite(rec.available_qty))rec._errors.push(t("toast.avail_qty_required", "可用数量不能为空且必须为数字"));
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
    var createdN=res.created||0, failedN=res.failed||0, toastMsg, toastType;
    if(createdN>0&&failedN===0){toastMsg=t('toast.importDone2','导入完成：新增{c}，失败{f}',{c:createdN,f:failedN});toastType='success';}
    else if(createdN>0&&failedN>0){toastMsg=t('toast.import_partial','导入部分完成：新增{c}，失败{f}',{c:createdN,f:failedN});toastType='warning';}
    else if(createdN===0&&failedN>0){toastMsg=t('toast.import_failed2','导入失败：新增{c}，失败{f}',{c:createdN,f:failedN});toastType='danger';}
    else{toastMsg=t('toast.import_no_data','无有效数据：新增{c}，失败{f}',{c:createdN,f:failedN});toastType='danger';}
    showToast(toastMsg,toastType);
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

// ==================== 寄售库存初始化（批量导入） ====================
// 简化模型：只导入“当前寄售剩余库存”，4 列模板。国家/仓库取自页面选择，不出现在 Excel 中。
// 列别名映射：同时兼容中文与英文表头
var CI_IMPORT_COLUMNS=[
  {key:'customer_name',aliases:['客户名称','customer_name','客户','customer']},
  {key:'sku_code',aliases:['SKU','sku_code','sku','sku编码']},
  {key:'remaining_qty',aliases:['剩余数量','remaining_qty','剩余','remain_qty','qty'],num:true},
  {key:'unit_cost',aliases:['寄售成本单价','unit_cost','成本单价','单价','cost'],num:true}
];

function openConsignmentImport(){
  openModal(t('ci.title','📦 寄售库存初始化'),
    '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div style="margin-bottom:12px;padding:12px 14px;background:#f0f5ff;border:1px solid #adc6ff;border-radius:6px;font-size:12px;color:#333">'+
        '<div style="font-weight:600;margin-bottom:6px">'+t('ci.step1','步骤 1：选择寄售仓库')+'</div>'+
        '<div style="color:#666;margin-bottom:8px">'+t('ci.note','选择本次寄售库存初始化的目标仓库。上传的出库明细将按此仓库归集，导入后会覆盖该仓库此前的寄售批次。')+'</div>'+
        '<select id="ci-warehouse" style="padding:6px 10px;border:1px solid #d9d9d9;border-radius:4px;width:100%;max-width:360px"><option value="">'+t('ci.select_wh','请选择仓库')+'</option></select>'+
      '</div>'+
      '<div id="ci-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s" '+
        'onclick="document.getElementById(\'ci-file-input\').click()" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
        'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handleConsignmentFile(event.dataTransfer.files[0])">'+
        '<div style="font-size:48px;color:#1890ff;margin-bottom:8px">📦</div>'+
        '<div style="font-size:14px;color:#333;margin-bottom:4px">'+t('ci.drop_hint','点击上传或拖拽文件到此处')+'</div>'+
        '<div style="font-size:12px;color:#999">'+t('ci.support_fmt','支持 .xlsx / .xls / .csv 格式')+'</div>'+
      '</div>'+
      '<input type="file" id="ci-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleConsignmentFile(this.files[0])">'+
      '<div id="consignment-preview" style="margin-top:16px"></div>'+
      '<div id="consignment-result" style="margin-top:16px"></div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="downloadConsignmentTemplate()">'+t('ci.download_tpl','下载模板')+'</button>'+
    '<button class="btn btn-secondary" onclick="closeModal()">'+t('action.close','关闭')+'</button>'+
    '<button class="btn btn-primary" id="ci-import-btn" onclick="submitConsignmentImport()" disabled>'+t('ci.start_import','开始导入')+'</button>',
    'modal-lg'
  );
  window._ciPreviewData=null;
  window._ciFileName='';
  window._ciWarehouses=[];
  // 异步加载仓库下拉（仅 active）
  (async function(){
    try{
      var whs=await api('/api/warehouses');
      window._ciWarehouses=(whs||[]).filter(function(w){return w.status==='active'});
      var sel=document.getElementById('ci-warehouse');
      if(sel){
        sel.innerHTML='<option value="">'+t('ci.select_wh','请选择仓库')+'</option>'+
          window._ciWarehouses.map(function(w){return '<option value="'+esc(w.name)+'">'+esc(w.name)+(w.country_name?(' ('+esc(w.country_name)+')'):'')+'</option>'}).join('');
      }
    }catch(e){ showToast(t('ci.load_wh_fail','仓库列表加载失败'),'danger'); }
  })();
}

function downloadConsignmentTemplate(){
  var headers=['客户名称','SKU','剩余数量','寄售成本单价'];
  var sample=[
    ['PT Maju Jaya','RD-K585-RGB','370','85.50'],
    ['CV Sentosa','RD-M601-BK','200','92.00']
  ];
  var ws=XLSX.utils.aoa_to_sheet([headers].concat(sample));
  ws['!cols']=headers.map(function(h){return {wch:h.length*2.2+6}});
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,t('ci.sheet_name','寄售库存'));
  XLSX.writeFile(wb,t('ci.template_file','寄售库存_导入模板.xlsx'));
}

async function handleConsignmentFile(file){
  if(!file)return;
  var ext=file.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)){showToast(t('toast.only_xlsx','仅支持 .xlsx / .xls / .csv 格式'),'danger');return}
  var whSel=document.getElementById('ci-warehouse');
  var warehouseName=whSel?whSel.value:'';
  if(!warehouseName){showToast(t('ci.select_wh_first','请先选择寄售仓库'),'danger');return}
  var wh=(window._ciWarehouses||[]).find(function(w){return w.name===warehouseName});
  var countryName=wh?(wh.country_name||''):'';
  var reader=new FileReader();
  reader.onload=async function(e){
    try{
      var data=e.target.result;
      var wb;
      if(ext==='csv'){wb=XLSX.read(data,{type:'string',codepage:65001})}
      else{wb=XLSX.read(new Uint8Array(data),{type:'array',cellDates:true})}
      var ws=wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      if(rows.length<2){showToast(t('toast.file_empty','文件为空或缺少数据行'),'danger');return}
      var headers=rows[0].map(function(h){return String(h||'').trim().toLowerCase()});
      // 建立列名->索引映射（兼容中英文别名）
      var colMap={};
      CI_IMPORT_COLUMNS.forEach(function(col){
        for(var i=0;i<headers.length;i++){
          if(headers[i]==='')continue;
          if(col.aliases.some(function(a){return a.toLowerCase()===headers[i]})){colMap[col.key]=i;break}
        }
      });
      var items=[];
      for(var i=1;i<rows.length;i++){
        var row=rows[i];
        if(!row||row.every(function(c){return !c||String(c).trim()===''}))continue;
        var rec={};
        CI_IMPORT_COLUMNS.forEach(function(col){
          var idx=colMap[col.key];
          if(idx==null||idx<0||row[idx]===undefined||row[idx]==='')return;
          var val=row[idx];
          if(typeof val==='string')val=val.trim();
          if(col.num){var n=Number(val);val=Number.isFinite(n)?n:val}
          else if(col.key==='outbound_date'){
            if(val instanceof Date)val=formatDateISO(val);
            else val=String(val).trim().slice(0,10);
          }
          rec[col.key]=val;
        });
        items.push(rec);
      }
      if(!items.length){showToast(t('toast.file_empty','文件为空或缺少数据行'),'danger');return}
      window._ciFileName=file.name;
      document.getElementById('consignment-result').innerHTML='';
      // 调用后端预览校验
      var res=await api('/api/consignment-inventory/preview','POST',{
        warehouse_name:warehouseName,
        country_name:countryName,
        items:items
      });
      window._ciPreviewData={preview:res,warehouse_name:warehouseName,country_name:countryName};
      renderConsignmentPreview(res);
    }catch(err){showToast((err&&err.message)||t('ci.parse_fail','文件解析失败'),'danger')}
  };
  if(ext==='csv')reader.readAsText(file,'UTF-8');
  else reader.readAsArrayBuffer(file);
}

function renderConsignmentPreview(d){
  var btn=document.getElementById('ci-import-btn');
  var canImport=d&&d.valid_rows>0&&d.error_rows===0;
  if(btn)btn.disabled=!canImport;
  var html='<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px">'+
    '<b>'+t('ci.preview_summary','预览汇总')+'</b>'+
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px 16px;margin-top:8px;color:#555">'+
      '<span>'+t('ci.total_rows','总行数')+'：<b>'+(d.total_rows||0)+'</b></span>'+
      '<span style="color:#52c41a">'+t('ci.valid_rows','有效行')+'：<b>'+(d.valid_rows||0)+'</b></span>'+
      '<span style="color:'+(d.error_rows>0?'#ff4d4f':'#999')+'">'+t('ci.error_rows','错误行')+'：<b>'+(d.error_rows||0)+'</b></span>'+
      '<span>'+t('ci.duplicate_count','重复行')+'：<b>'+(d.duplicate_count||0)+'</b></span>'+
      '<span>'+t('ci.customer_count','客户数')+'：<b>'+(d.customer_count||0)+'</b></span>'+
      '<span>'+t('ci.sku_count','SKU数')+'：<b>'+(d.sku_count||0)+'</b></span>'+
      '<span>'+t('ci.total_remaining_qty','剩余总数量')+'：<b>'+(d.total_remaining_qty||0)+'</b></span>'+
      '<span>'+t('ci.total_remaining_value','剩余库存金额')+'：<b>'+(d.total_remaining_value||0)+'</b></span>'+
    '</div></div>';
  // 错误明细表
  if(d.errors&&d.errors.length){
    html+='<div style="margin-bottom:10px"><div style="font-weight:600;color:#ff4d4f;margin-bottom:6px">'+t('ci.error_detail','错误明细')+'（'+d.errors.length+'）</div>'+
      '<div class="table-container" style="max-height:200px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>'+t('col.row','行')+'</th><th>'+t('ci.field','字段')+'</th><th>'+t('ci.value','值')+'</th><th>'+t('ci.reason','原因')+'</th></tr></thead><tbody>'+
      d.errors.map(function(e){return '<tr style="background:#fff1f0"><td>'+esc(e.row)+'</td><td>'+esc(e.field)+'</td><td>'+esc(e.value==null?'':e.value)+'</td><td>'+esc(e.reason)+'</td></tr>'}).join('')+
      '</tbody></table></div></div>';
  }
  // 有效行预览表（前 20 行）
  var valid=d.valid_items||[];
  html+='<div style="font-weight:600;margin-bottom:6px">'+t('ci.valid_preview','有效行预览')+'（'+t('ci.showing_first','前 ')+(Math.min(valid.length,20))+'/'+valid.length+'）</div>'+
    '<div class="table-container" style="max-height:320px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr>'+
    '<th>'+t('col.row','行')+'</th><th>SKU</th><th>'+t('ci.customer','客户名称')+'</th><th>'+t('ci.remaining_qty','剩余数量')+'</th><th>'+t('ci.unit_cost','寄售成本单价')+'</th><th>'+t('ci.remaining_value','剩余金额')+'</th></tr></thead><tbody>';
  valid.slice(0,20).forEach(function(v,idx){
    html+='<tr><td>'+(idx+1)+'</td><td class="cell-id">'+esc(v.sku_code)+'</td><td>'+esc(v.customer_name||'-')+'</td><td class="text-right">'+esc(v.remaining_qty)+'</td><td class="text-right">'+fmtMoney(v.unit_cost)+'</td><td class="text-right">'+fmtMoney(v.remaining_inventory_value)+'</td></tr>';
  });
  if(valid.length>20)html+='<tr><td colspan="6" style="text-align:center;color:#999;padding:8px">... '+(valid.length-20)+' '+t('ci.more_rows','条')+'</td></tr>';
  if(!valid.length)html+='<tr><td colspan="6" style="text-align:center;color:#999;padding:16px">'+t('ci.no_valid','无有效行')+'</td></tr>';
  html+='</tbody></table></div>';
  document.getElementById('consignment-preview').innerHTML=html;
}

async function submitConsignmentImport(){
  var ci=window._ciPreviewData;
  if(!ci||!ci.preview||!ci.preview.valid_items||!ci.preview.valid_items.length){showToast(t('ci.no_valid_data','没有可导入的有效数据'),'danger');return}
  var btn=document.getElementById('ci-import-btn');
  if(btn){btn.disabled=true;btn.textContent=t('ci.importing','导入中...')}
  try{
    var res=await api('/api/consignment-inventory/import','POST',{
      warehouse_name:ci.warehouse_name,
      country_name:ci.country_name,
      original_filename:window._ciFileName||'',
      items:ci.preview.valid_items
    });
    if(btn){btn.textContent=t('ci.start_import','开始导入')}
    if(res&&res.success){
      var html='<div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:8px;padding:14px 16px;font-size:13px">'+
        '<div style="font-weight:600;margin-bottom:8px">✅ '+t('ci.import_done','导入完成')+'</div>'+
        '<div style="color:#555">'+t('ci.import_stats','共导入 {v1} 条有效行，剩余总数量 {v2}，剩余库存金额 {v3}。',{v1:res.stats.valid_rows||0,v2:res.stats.total_remaining_qty||0,v3:res.stats.total_remaining_value||0})+'</div>'+
        '<div style="color:#999;margin-top:4px">'+t('ci.batch_id','批次号')+'：'+esc(res.batch_id||'')+'</div></div>';
      var box=document.getElementById('consignment-result');
      if(box)box.innerHTML=html;
      showToast(t('ci.import_success','寄售库存导入成功'),'success');
      closeModal();
      loadInv();
    }else{
      showToast(t('ci.import_failed','导入失败'),'danger');
    }
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent=t('ci.start_import','开始导入')}
    showToast((e&&e.message)||t('ci.import_failed','导入失败'),'danger');
  }
}

async function viewConsignmentLots(warehouse,skuCode){
  openModal(t('ci.lots_title','🔍 寄售批次明细')+' - '+esc(skuCode),
    '<div id="ci-lots-body" style="padding:4px"><div style="text-align:center;color:#999;padding:30px">'+t('ci.loading','加载中...')+'</div></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">'+t('action.close','关闭')+'</button>',
    'modal-lg'
  );
  try{
    var lots=await api('/api/consignment-inventory/lots?warehouse='+encodeURIComponent(warehouse)+'&sku_code='+encodeURIComponent(skuCode));
    var body=document.getElementById('ci-lots-body');
    if(!body)return;
    if(!lots||!lots.length){
      body.innerHTML='<div style="text-align:center;color:#999;padding:30px">'+t('ci.no_lots','无寄售批次记录')+'</div>';
      return;
    }
    var html='<div style="margin-bottom:8px;font-size:13px;color:#555">'+t('ci.lots_count','共 {v1} 条活跃批次',{v1:lots.length})+'（'+esc(warehouse)+'）</div>'+
      '<div class="table-container" style="max-height:60vh;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr>'+
      '<th>'+t('ci.customer','客户名称')+'</th><th>SKU</th><th>'+t('ci.remaining_qty','当前剩余数量')+'</th><th>'+t('ci.unit_cost','寄售成本单价')+'</th><th>'+t('ci.remaining_value','当前剩余库存金额')+'</th></tr></thead><tbody>';
    lots.forEach(function(l){
      html+='<tr><td>'+esc(l.customer_name||'-')+'</td><td class="cell-id">'+esc(l.sku_code||'-')+'</td><td class="text-right">'+esc(l.remaining_qty)+'</td><td class="text-right">'+fmtMoney(l.unit_cost)+'</td><td class="text-right">'+fmtMoney(l.remaining_inventory_value)+'</td></tr>';
    });
    html+='</tbody></table></div>';
    body.innerHTML=html;
  }catch(e){
    var b=document.getElementById('ci-lots-body');
    if(b)b.innerHTML='<div style="text-align:center;color:#ff4d4f;padding:30px">'+esc((e&&e.message)||t('ci.load_fail','加载失败'))+'</div>';
  }
}

// ==================== 寄售库存独立页面（Phase 2：数据源 consignment_inventory_lots，不读取 inventory） ====================
// 列表/筛选/底部合计；页头保留「寄售库存初始化」导入入口。
async function renderConsignment(){
  document.getElementById('content-inner').innerHTML =
    '<div id="flash-container"></div>'+
    '<div class="filter-bar"><div class="filter-form">'+
      '<div class="filter-group"><label>'+t('nav.consignment.country','国家')+'</label><input type="text" id="cs-c" placeholder="'+t('nav.consignment.country_ph','国家')+'"></div>'+
      '<div class="filter-group"><label>'+t('ci.customer','客户名称')+'</label><input type="text" id="cs-cust" placeholder="'+t('ci.customer_ph','客户名称')+'"></div>'+
      '<div class="filter-group"><label>SKU</label><input type="text" id="cs-sku" placeholder="SKU"></div>'+
      '<div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadConsignment()">'+t('action.search','搜索')+'</button><button class="btn btn-secondary btn-sm" onclick="resetConsignmentFilters()">'+t('action.reset','重置')+'</button></div>'+
    '</div></div>'+
    '<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🤝 '+t('nav.consignment','寄售库存')+'</div>'+
      '<div class="table-section-title-right"><button class="btn btn-secondary btn-sm" onclick="openConsignmentImport()">'+t('btn.consignment_init','📦 寄售库存初始化')+'</button></div></div>'+
      '<div id="cs-summary" class="stats-grid" style="margin-bottom:12px"></div>'+
      '<div id="cs-table"></div>'+
    '</div>';
  loadConsignment();
}

async function loadConsignment(){
  try{
    const c=document.getElementById('cs-c')?.value||'';
    const cust=document.getElementById('cs-cust')?.value||'';
    const sku=document.getElementById('cs-sku')?.value||'';
    // 顶部汇总与明细列表使用完全相同的筛选范围（国家 + 客户 + SKU）
    // 注意：customer_name 仅作为普通筛选条件参与查询，不新增按客户分组/统计卡/报表
    const q=[];
    if(c) q.push('country='+encodeURIComponent(c));
    if(cust) q.push('customer_name='+encodeURIComponent(cust));
    if(sku) q.push('sku_code='+encodeURIComponent(sku));
    // 复用库存总表汇率口径（/api/inventory/currency-rates）：country→currency、rate=cnyToForeign（1 CNY = X 本币）
    const [lots, rateInfo, sumLots] = await Promise.all([
      api('/api/consignment-inventory/lots'+(q.length?'?'+q.join('&'):'')),
      api('/api/inventory/currency-rates'),
      api('/api/consignment-inventory/lots'+(q.length?'?'+q.join('&'):''))
    ]);
    const countryCurrency={};
    (rateInfo.countries||[]).forEach(function(co){
      var curr=co.default_currency||'';
      var rateObj=(rateInfo.rates||{})[curr];
      countryCurrency[co.country]={code:curr, symbol:co.symbol||'', rate:rateObj?rateObj.rate:null};
    });
    renderConsignmentSummary(sumLots||[], countryCurrency);
    const box=document.getElementById('cs-table');
    if(!box)return;
    if(!lots||!lots.length){
      box.innerHTML='<div style="text-align:center;color:#999;padding:30px">'+t('ci.no_lots','无寄售批次记录')+'</div>';
      const sumEl=document.getElementById('cs-summary'); if(sumEl)sumEl.innerHTML='';
      return;
    }
    let html='<div class="table-container" style="box-shadow:none"><table class="data-table"><thead><tr>'+
      '<th>'+t('ci.customer','客户名称')+'</th>'+
      '<th>SKU</th>'+
      '<th>'+t('nav.warehouse','仓库')+'</th>'+
      '<th class="text-right">'+t('ci.remaining_qty','当前剩余数量')+'</th>'+
      '<th class="text-right">'+t('ci.unit_cost','寄售成本单价')+'</th>'+
      '<th class="text-right">'+t('ci.remaining_value','当前剩余库存金额')+'</th>'+
    '</tr></thead><tbody>';
    let sumQty=0, sumVal=0;
    lots.forEach(function(l){
      const qty=Number(l.remaining_qty||0), val=Number(l.remaining_inventory_value||0);
      sumQty+=qty; sumVal+=val;
      html+='<tr><td>'+esc(l.customer_name||'-')+'</td><td>'+esc(l.sku_code||'-')+'</td><td>'+esc(l.warehouse_name||'-')+'</td>'+
        '<td class="text-right">'+qty.toLocaleString()+'</td>'+
        '<td class="text-right">'+fmtMoney(l.unit_cost)+'</td>'+
        '<td class="text-right">'+fmtMoney(l.remaining_inventory_value)+'</td></tr>';
    });
    html+='</tbody></table></div>';
    box.innerHTML=html;
  }catch(e){
    const box=document.getElementById('cs-table');
    if(box)box.innerHTML='<div style="text-align:center;color:#ff4d4f;padding:30px">'+esc((e&&e.message)||t('ci.load_fail','加载失败'))+'</div>';
  }
}

// 寄售库存顶部汇总：复用库存总表 countryCurrency（rate=cnyToForeign，CNY=本币/rate）
// 1) 寄售剩余数量 = Σ remaining_qty
// 2) 原币货值 = 按 country/currency 分别 Σ remaining_inventory_value（不同币种不相加）
// 3) 人民币货值 = 各币种原币货值按系统汇率折算为 RMB 后合计
function renderConsignmentSummary(lots, countryCurrency){
  const el=document.getElementById('cs-summary');
  if(!el) return;
  const fmtN=function(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});};
  let totalQty=0;
  const byCur={}; let rmbTotal=0;
  (lots||[]).forEach(function(l){
    const qty=Number(l.remaining_qty||0);
    const val=Number(l.remaining_inventory_value||0);
    totalQty+=qty;
    const ci=countryCurrency[l.country_name]||{};
    const code=ci.code||t('inv.kpi.unknown_cur','未知');
    if(!byCur[code]) byCur[code]={symbol:(ci.symbol||''), amount:0, hasRate:!!ci.rate};
    byCur[code].amount+=val;
    if(ci.rate) rmbTotal += val / ci.rate; // rate=cnyToForeign，CNY = 本币 / rate
  });
  const curCodes=Object.keys(byCur);
  let localHtml;
  if(curCodes.length===1){
    const code=curCodes[0];
    localHtml=(byCur[code].symbol?byCur[code].symbol+' ':'')+fmtN(byCur[code].amount);
  } else if(curCodes.length>1){
    localHtml=curCodes.map(function(code){
      return (byCur[code].symbol?byCur[code].symbol+' ':'')+fmtN(byCur[code].amount);
    }).join('　/　');
  } else {
    localHtml='-';
  }
  const rmbValue='¥ '+fmtN(rmbTotal);
  el.innerHTML=
    '<div class="stat-card"><div class="stat-label">'+t('ci.summary_qty','寄售剩余库存')+'</div><div class="stat-number">'+Number(totalQty).toLocaleString('en-US')+' '+t('inv.kpi.unit','件')+'</div></div>'+
    '<div class="stat-card"><div class="stat-label">'+t('ci.summary_rmb','寄售库存货值（人民币）')+'</div><div class="stat-number">'+esc(rmbValue)+'</div></div>'+
    '<div class="stat-card"><div class="stat-label">'+t('ci.summary_local','原币货值')+'</div><div class="stat-number">'+esc(localHtml)+'</div></div>';
}

function resetConsignmentFilters(){
  const c=document.getElementById('cs-c'), cust=document.getElementById('cs-cust'), sku=document.getElementById('cs-sku');
  if(c)c.value=''; if(cust)cust.value=''; if(sku)sku.value='';
  loadConsignment();
}

// ==================== 销售数据批量导入 ====================
const SALES_IMPORT_COLUMNS=[
  {key:'source_system',label:t("po.018", "\u6765\u6e90\u7cfb\u7edf"),required:true},
  {key:'order_no',label:t("po.019", "\u8ba2\u5355\u53f7"),required:true},
  {key:'order_detail_id',label:t("po.020", "\u8ba2\u5355\u660e\u7ec6ID")},
  {key:'order_date',label:t('col.order_date','下单日期'),required:true},
  {key:'country',label:t('col.country','国家'),required:true},
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
      '<div id="sales-progress" style="margin-top:16px"></div>'+
      '<div id="sales-result" style="margin-top:16px"></div>'+
    '</div>',
    '<button class="btn btn-secondary" onclick="downloadSalesTemplate()">'+t("html.inv.download_tpl", "下载模板")+'</button>'+
    '<button class="btn btn-secondary" onclick="closeModal()">'+t("action.close", "关闭")+'</button>'+
    '<button class="btn btn-primary" id="sales-import-btn" onclick="submitSalesBatchImport()" disabled>'+t("html.inv.start_import", "开始导入")+'</button>'
  );
  window._salesImportData=[];
  setSalesImportSessionId('');
  stopSalesImportPolling();
}

var salesImportStatusPollTimer=null;
var salesImportStatusTerminal=false;
function salesImportSessionId(){try{return sessionStorage.getItem('sales_import_id')||''}catch(_){return ''}}
function setSalesImportSessionId(id){try{if(id)sessionStorage.setItem('sales_import_id',id);else sessionStorage.removeItem('sales_import_id')}catch(_){} }
function salesImportPhaseLabel(phase){return ({validating:'校验中',staging:'准备导入',matching:'匹配已有记录',writing:'写入销售数据',committing:'提交事务',inventory_recalc:'刷新库存',completed:'导入完成',failed_uncommitted:'导入失败，数据未写入',unknown_pending_reconcile:'导入结果待确认',sales_committed_recalc_failed:'销售数据已导入，库存重算失败'})[phase]||'处理中'}
function stopSalesImportPolling(){if(salesImportStatusPollTimer){clearTimeout(salesImportStatusPollTimer);salesImportStatusPollTimer=null}}
function renderSalesImportProgress(run){
  var el=document.getElementById('sales-progress'); if(!el||!run)return;
  var pct=run.percent===null||run.percent===undefined?'':String(run.percent)+'%';
  var count=(run.processed_count===undefined?'':String(run.processed_count)+' / '+String(run.total_count||0));
  var active=!['completed','failed_uncommitted','sales_committed_recalc_failed'].includes(run.status);
  var color=run.status==='completed'?'#52c41a':(run.status==='failed_uncommitted'?'#ff4d4f':(run.status==='sales_committed_recalc_failed'?'#faad14':'#1890ff'));
  el.innerHTML='<div style="border:1px solid #d9e8ff;background:#f7fbff;border-radius:8px;padding:12px 14px;font-size:13px">'+
    '<div style="display:flex;justify-content:space-between;gap:12px"><b style="color:'+color+'">'+esc(salesImportPhaseLabel(run.phase||run.status))+'</b><span>'+esc(pct)+'</span></div>'+
    '<div style="height:6px;background:#e6f4ff;border-radius:4px;margin:8px 0"><div style="height:6px;width:'+(run.percent==null?0:Math.max(0,Math.min(100,run.percent)))+'%;background:'+color+';border-radius:4px"></div></div>'+
    '<div style="color:#666">已处理 '+esc(count)+(active?'，请勿重复提交':'')+'</div></div>';
}
function renderSalesImportResult(res){
  var status=res.status||'completed';
  window._lastSalesImportErrors=res.errors||[];
  var failed=Number(res.failed||0);
  var heading=status==='failed_uncommitted'?'导入失败，数据未写入':status==='unknown_pending_reconcile'?'导入结果待确认':status==='sales_committed_recalc_failed'?'销售数据已导入，库存重算失败':'导入完成报告';
  var bg=status==='completed'?(failed>0?'#fffbe6':'#f6ffed'):(status==='sales_committed_recalc_failed'?'#fffbe6':'#fff1f0');
  var border=status==='completed'?(failed>0?'#ffe58f':'#b7eb8f'):(status==='sales_committed_recalc_failed'?'#ffe58f':'#ffa39e');
  var html='<div style="background:'+bg+';border:1px solid '+border+';border-radius:8px;padding:14px 16px;font-size:13px">'+
    '<div style="font-weight:600;margin-bottom:8px">'+heading+'</div>'+
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">'+
      '总行数：'+(res.total||res.total_count||0)+' 条'+
      '<span style="color:#52c41a">新增：'+(res.inserted||0)+' 条</span>'+
      '<span style="color:#1890ff">更新：'+(res.updated||0)+' 条</span>'+
      '<span style="color:#faad14">重复无变化：'+(res.skipped||0)+' 条</span>'+
      '<span style="color:#ff3b30">失败：'+failed+' 条</span></div>';
  if(window._lastSalesImportErrors.length>0){
    html+='<div style="margin-top:10px"><div style="font-weight:600;color:#ff3b30;margin-bottom:6px">失败明细</div>';
    html+=window._lastSalesImportErrors.slice(0,20).map(function(e){return '<div style="color:#666">第 '+e.row+' 行：'+esc(e.reason)+'</div>'}).join('');
    if(window._lastSalesImportErrors.length>20)html+='<div style="color:#999">还有 '+(window._lastSalesImportErrors.length-20)+' 条失败...</div>';
    html+='<button type="button" class="btn btn-secondary" style="margin-top:10px" onclick="downloadSalesImportErrors()">下载失败明细</button></div>';
  }
  html+='</div>';
  var el=document.getElementById('sales-result'); if(el)el.innerHTML=html;
  return status;
}
async function pollSalesImportStatus(importId){
  if(!importId)return;
  try{
    var run=await api('/api/sales-records/bulk-import/'+encodeURIComponent(importId)+'/status');
    renderSalesImportProgress(run);
    var terminal=['completed','failed_uncommitted','sales_committed_recalc_failed','unknown_pending_reconcile'].includes(run.status);
    if(terminal){
      salesImportStatusTerminal=true;stopSalesImportPolling();renderSalesImportResult(run);if(run.status!=='unknown_pending_reconcile')setSalesImportSessionId('');
      var btn=document.getElementById('sales-import-btn');if(btn){btn.disabled=false;btn.textContent=t('app.067','开始导入')}
      if(run.status==='completed')showToast(t('toast.importDone4','导入完成：新增{c}，更新{u}，重复{s}，失败{f}',{c:run.inserted||0,u:run.updated||0,s:run.skipped||0,f:run.failed||0}),run.failed>0?'warning':'success');
      else if(run.status==='sales_committed_recalc_failed')showToast('销售数据已导入，库存重算失败','warning');
      else showToast(run.status==='unknown_pending_reconcile'?'导入结果待确认':'导入失败，数据未写入','danger');
      return run;
    }
    salesImportStatusPollTimer=setTimeout(function(){pollSalesImportStatus(importId)},600);
    return run;
  }catch(e){
    // 状态轮询失败不触发重复提交；下一次轮询继续尝试恢复状态。
    var el=document.getElementById('sales-progress');if(el)el.innerHTML='<div style="padding:10px;color:#666">导入处理中，正在恢复状态…</div>';
    salesImportStatusPollTimer=setTimeout(function(){pollSalesImportStatus(importId)},1200);
  }
}
function startSalesImportPolling(importId){stopSalesImportPolling();salesImportStatusTerminal=false;pollSalesImportStatus(importId)}
function resumeSalesImport(){var id=salesImportSessionId();if(id)startSalesImportPolling(id)}

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
        if(!rec.country||!String(rec.country).trim())rec._errors.push(t('col.country','国家')+'不能为空');
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
      var _sib=document.getElementById('sales-import-btn'); if(_sib) _sib.disabled=records.filter(function(r){return r._errors.length===0}).length===0;
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
    var _sib2=document.getElementById('sales-import-btn'); if(_sib2) _sib2.disabled=false;
  }catch(e){
    showToast(t('toast.requestSalesPreview', '预览失败: {v1}', {v1: e.message||''}),'danger');
  }
}

function renderSalesPreview(records){
  var valid=records.filter(function(r){return r._errors.length===0}).length;
  var invalid=records.length-valid;
  var html=t('gen.L2722.1','<div style="background:#f0f8ff;padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px"><b>共 ')+records.length+t('gen.L2722.2',' 条数据</b>，<span style="color:#52c41a">有效 ')+valid+t('gen.L2722.3',' 条</span>')+(invalid>0?t('gen.L2722.4','，<span style="color:#ff4d4f">无效 ')+invalid+t('gen.L2722.5',' 条</span>'):'')+'</div>';
  html+='<div class="table-container" style="max-height:300px;overflow:auto;box-shadow:none;border:1px solid #f0f0f0"><table class="data-table"><thead><tr><th>'+t("col.row", "行")+'</th><th>'+t("po.018", "来源系统")+'</th><th>'+t("po.019", "订单号")+'</th><th>'+t("col.order_date", "下单日期")+'</th><th>'+t("col.country", "国家")+'</th><th>SKU</th><th>'+t("col.qty", "数量")+'</th><th>'+t("col.effective_order", "有效订单")+'</th><th>'+t("col.verify", "校验")+'</th></tr></thead><tbody>';
  records.slice(0,20).forEach(function(r){
    var ok=r._errors.length===0;
    html+='<tr style="'+(ok?'':'background:#fff1f0')+'">'+
      '<td>'+r._rowNum+'</td>'+
      '<td>'+esc(r.source_system||'-')+'</td>'+
      '<td class="cell-id">'+esc(r.order_no||'-')+'</td>'+
      '<td>'+esc(r.order_date||'-')+'</td>'+
      '<td>'+esc(r.country||'-')+'</td>'+
      '<td class="cell-id">'+esc(r.sku_code||'-')+'</td>'+
      '<td class="text-right">'+(r.quantity!==undefined?r.quantity:'-')+'</td>'+
      '<td>'+(r.is_valid_order?t('gen.L2733.1','<span style="color:#52c41a">是</span>'):t('gen.L2733.2','<span style="color:#999">否</span>'))+'</td>'+
      '<td>'+(ok?'<span class="status-badge status-completed">✓</span>':'<span class="status-badge status-danger" title="'+esc(r._errors.join('; '))+'">✗ '+r._errors.length+'</span>')+'</td>'+
    '</tr>';
  });
  if(records.length>20)html+=t('gen.L2737.1','<tr><td colspan="9" style="text-align:center;color:#999;padding:8px">... 还有 ')+(records.length-20)+t('gen.L2737.2',' 条</td></tr>');
  html+='</tbody></table></div>';
  if(invalid>0){
    html+='<div style="margin-top:10px;padding:10px;background:#fffbe6;border-radius:4px;font-size:12px;color:#666"><b>'+t("html.preview.invalid_detail", "无效行明细：")+'</b><br>'+
      records.filter(function(r){return r._errors.length>0}).slice(0,10).map(function(r){return t("html.preview.row_pre", "第 ")+r._rowNum+t("html.preview.row_suffix", " 行：")+r._errors.join('、')}).join('<br>')+
      (invalid>10?'<br>...':'')+'</div>';
  }
  var _sps=document.getElementById('sales-preview-stats'); if(_sps) _sps.innerHTML=html;
  if(valid>0) requestSalesPreview();
}

function downloadSalesTemplate(){
  var headers=SALES_IMPORT_COLUMNS.map(function(c){return c.label});
  var sample=[
    ['BigSeller','BS-2026-001234','','2026-06-15','印尼',t("app.641", "Shopee\u5370\u5c3c\u5e97"),'BOYA','BY-M1',30,'true','Shipped',t("sample.normal_order", "正常订单")],
    [t("sample.zhisu", "至速"),'ZS-2026-005678','','2026-06-15','马来西亚',t("app.644", "Lazada\u9a6c\u6765\u5e97"),'BOYA','BY-M1000',15,'true','Delivered',''],
    ['EDA','EDA-2026-009999','DTL-001','2026-06-14','泰国',t("app.645", "TikTok\u6cf0\u56fd\u5e97"),'BOYA','BY-WM8 Pro',8,'false','Cancelled',t("sample.sales_remark", "取消订单不计入预测")]
  ];
  var ws=XLSX.utils.aoa_to_sheet([headers].concat(sample));
  ws['!cols']=SALES_IMPORT_COLUMNS.map(function(c){return {wch:c.label.length*2+6}});
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,t("nav.sales_data", "销售数据"));
  XLSX.writeFile(wb,t("app.647", "\u9500\u552e\u6570\u636e_\u5bfc\u5165\u6a21\u677f.xlsx"));
}

async function legacySubmitSalesBatchImport(){
  var records=window._salesImportData||[];
  var valid=records.filter(function(r){return r._errors.length===0});
  if(valid.length===0){showToast(t("toast.no_valid_data", "没有可导入的有效数据"),'danger');return}
  var btn=document.getElementById('sales-import-btn');
  if(!btn) return;
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
    var _sr=document.getElementById('sales-result'); if(_sr) _sr.innerHTML=html;
    showToast(t('toast.importDone4','导入完成：新增{c}，更新{u}，重复{s}，失败{f}',{c:res.inserted||0, u:res.updated||0, s:res.skipped||0, f:res.failed||0}),res.failed>0?'warning':'success');
    loadSales();
  }catch(e){
    showToast(e.message||t("toast.import_failed", "导入失败"),'danger');
  }finally{
    btn.disabled=false;btn.textContent=t("app.067", "\u5f00\u59cb\u5bfc\u5165");
  }
}

// Phase 1/Checkpoint 3 override: import_id/idempotent submission and real
// server-side progress.  Kept local to the sales import page.
async function submitSalesBatchImport(){
  var records=window._salesImportData||[];
  var valid=records.filter(function(r){return r._errors.length===0});
  if(valid.length===0){showToast(t("toast.no_valid_data", "没有可导入的有效数据"),'danger');return}
  var btn=document.getElementById('sales-import-btn');
  if(!btn||window._salesImportSubmitting)return;
  window._salesImportSubmitting=true;btn.disabled=true;btn.textContent=t("app.613", "\u5bfc入中...");
  var importId='';
  try{importId=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():'sales-import-'+Date.now()+'-'+Math.random().toString(36).slice(2)}catch(_){importId='sales-import-'+Date.now()}
  setSalesImportSessionId(importId);startSalesImportPolling(importId);
  try{
    var items=valid.map(function(r){var o={};SALES_IMPORT_COLUMNS.forEach(function(c){o[c.key]=r[c.key]!==undefined?r[c.key]:''});return o});
    var res=await api('/api/sales-records/bulk-import','POST',{items:items,import_id:importId});
    renderSalesImportProgress(res);
    if(['completed','failed_uncommitted','sales_committed_recalc_failed','unknown_pending_reconcile'].includes(res.status)){
      renderSalesImportResult(res);stopSalesImportPolling();salesImportStatusTerminal=true;
      if(res.status!=='unknown_pending_reconcile')setSalesImportSessionId('');
      if(res.status==='completed')showToast(t('toast.importDone4','导入完成：新增{c}，更新{u}，重复{s}，失败{f}',{c:res.inserted||0,u:res.updated||0,s:res.skipped||0,f:res.failed||0}),res.failed>0?'warning':'success');
      else if(res.status==='sales_committed_recalc_failed')showToast('销售数据已导入，库存重算失败','warning');
      else if(res.status==='unknown_pending_reconcile')showToast('导入结果待确认','warning');
      else showToast('导入失败，数据未写入','danger');
      loadSales();
    }
  }catch(e){
    var progressEl=document.getElementById('sales-progress');if(progressEl)progressEl.innerHTML='<div style="padding:10px;color:#666">导入请求未及时返回，正在通过 import_id 确认结果…</div>';
  }finally{
    window._salesImportSubmitting=false;
    if(salesImportStatusTerminal){btn.disabled=false;btn.textContent=t("app.067", "\u5f00始导入")}
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
// 库存总表：关键词防抖（350ms）+ 请求序号守卫（避免快速切换筛选时旧请求覆盖新结果）
// 仅限本页面使用，不关联任何页面切换/渲染守卫（如 pageRenderSeq）。
let _invKwTimer = null;
let _invLoadSeq = 0;
function debouncedInvKeyword(){
  if(_invKwTimer) clearTimeout(_invKwTimer);
  _invKwTimer = setTimeout(loadInv, 350);
}

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
    t('html.renderInventory', `<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>国家</label><select id="inv-c" onchange="onInvFilterChange('country')"><option value="">全部</option></select></div><div class="filter-group"><label>仓库</label><select id="inv-w" onchange="onInvFilterChange('warehouse')"><option value="">全部</option></select></div><div class="filter-group"><label>品牌</label><select id="inv-b" onchange="onInvFilterChange('brand')"><option value="">全部</option></select></div><div class="filter-group"><label>关键词</label><input type="text" id="inv-k" placeholder="SKU/产品名" oninput="debouncedInvKeyword()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadInv()">搜索</button><button class="btn btn-secondary btn-sm" onclick="resetInvFilters()">重置</button>{v1}</div></div></div><div id="inv-batch-bar" style="display:none;background:var(--bg-card,#fff);border:1px solid var(--border,#e0e0e0);border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span id="inv-batch-count" style="font-weight:600;margin-right:8px"></span><button class="btn btn-sm btn-secondary" onclick="invBatchAction('export')">📊 导出</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_status')">🏷️ 库存状态</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_focused')">⭐ 重点关注</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_safety_stock')">🛡️ 安全库存</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_turnover')">🎯 目标周转</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_replenish_rule')">📋 补货规则</button><button class="btn btn-sm btn-secondary" onclick="invBatchAction('set_remark')">📝 库存备注</button><button class="btn btn-sm btn-warning" onclick="invBatchAction('inventory_adjust')">🔧 发起调整单</button><button class="btn btn-sm btn-danger" onclick="invBatchAction('delete')" style="background:#ff4d4f;color:#fff;border:none">🗑️ 删除</button><button class="btn btn-sm btn-secondary" onclick="invClearSelection()" style="margin-left:auto">取消选择</button></div><div id="inv-cards" class="stats-grid"></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📦 库存总表</div><div class="table-section-title-right" id="inv-rate-display" style="font-size:12px;color:#666;display:flex;gap:12px;align-items:center"></div></div><div id="inv-table"></div></div>`, {v1: hasPermission('inventory_import')?(t('gen.L2829.1','<button class="btn btn-secondary btn-sm" onclick="openInvBatchImport()">📥 导入库存</button>')):''});
  // 筛选级联：根据当前已选条件动态刷新下拉可选项（仅库存总表页面）
  try{ await refreshInvFilterOptions(); }catch(e){console.warn('filter-options load failed',e)}
  // 恢复库存总表保存的筛选状态（仅本页面 localStorage，不影响其他页面）
  try{
    const saved=JSON.parse(localStorage.getItem('psi_inv_filters_v1')||'null');
    if(saved){
      const fc=document.getElementById('inv-c'), fw=document.getElementById('inv-w'), fb=document.getElementById('inv-b'), fk=document.getElementById('inv-k');
      if(fc && saved.c) fc.value=saved.c;
      if(fw && saved.w) fw.value=saved.w;
      if(fb && saved.b) fb.value=saved.b;
      if(fk && saved.k!=null) fk.value=saved.k;
    }
  }catch(e){}
  loadInv();
}

async function loadInv(){
  try{
    const c=document.getElementById('inv-c')?.value||'',w=document.getElementById('inv-w')?.value||'',b=document.getElementById('inv-b')?.value||'',k=document.getElementById('inv-k')?.value||'';
    // 保存库存总表筛选状态（仅本页面 localStorage，不写数据库、不影响其他页面）
    try{ localStorage.setItem('psi_inv_filters_v1', JSON.stringify({c,w,b,k})); }catch(e){}
    const mySeq = ++_invLoadSeq;
    const [data, rateInfo] = await Promise.all([
      api('/api/inventory?country='+encodeURIComponent(c)+'&warehouse='+encodeURIComponent(w)+'&brand='+encodeURIComponent(b)+'&keyword='+encodeURIComponent(k)),
      api('/api/inventory/currency-rates')
    ]);
    if(mySeq !== _invLoadSeq) return; // 丢弃过期响应：避免快速切换筛选时旧请求覆盖新结果
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

    // ===== 库存总表体验优化（仅前端 app.js，不改 index.html / server.js / DB）=====
    // 1) 注入作用域样式：仅冻结库存总表 thead（页面级 sticky，钉在浏览器顶部）
    // 注意：取消 .table-container 的 overflow 滚动容器，改为页面级滚动，
    // 否则 overflow-x:auto 会使其成为滚动容器，导致 thead sticky 相对容器而非视口，表头随页面滚走。
    if(!document.getElementById('inv-freeze-style')){
      var __st=document.createElement('style'); __st.id='inv-freeze-style';
      __st.textContent='#inv-table .inv-thead-wrap{position:sticky;top:-12px;z-index:40;overflow:hidden;background:#fafbfc;box-shadow:0 2px 4px rgba(0,0,0,.08)}#inv-table .inv-thead-wrap .data-table{margin:0}#inv-table .inv-body-wrap{overflow-x:auto}#inv-table .data-table thead .col-sticky{z-index:4}';
      document.head.appendChild(__st);
    }
    // 2) 库存数据截止日期（独立信息区域，复用现有 snapshot_cutoff_date；汇率之后、指标卡之前）
    var __snapEl=document.getElementById('inv-snapshot-date');
    if(!__snapEl){
      __snapEl=document.createElement('div'); __snapEl.id='inv-snapshot-date';
      __snapEl.style.margin='4px 0 8px'; __snapEl.style.fontSize='13px'; __snapEl.style.color='var(--text-secondary)';
      var __cardsEl=document.getElementById('inv-cards');
      if(__cardsEl && __cardsEl.parentNode) __cardsEl.parentNode.insertBefore(__snapEl, __cardsEl);
    }
    try{
      var __snaps=(data||[]).map(function(i){return i.snapshot_cutoff_date;}).filter(function(v){return v!=null && String(v).trim()!=='';});
      var __distinct=Array.from(new Set(__snaps.map(function(d){return String(d).slice(0,10);})));
      if(__distinct.length===1){
        __snapEl.innerHTML=t('inv.snapshot.cutoff','库存数据截止：')+fmtDate(__distinct[0]);
        __snapEl.style.color='var(--text-secondary)';
      } else if(__distinct.length===0){
        __snapEl.innerHTML=t('inv.snapshot.cutoff','库存数据截止：')+t('inv.snapshot.unset','未设置');
        __snapEl.style.color='var(--text-secondary)';
      } else {
        // 多个不同日期 -> 提示不一致，绝不静默取 MAX
        __snapEl.innerHTML='⚠ '+t('inv.snapshot.inconsistent','库存数据日期不一致，请检查同步');
        __snapEl.style.color='#ff4d4f';
      }
    }catch(e){}

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
    const invTable=document.getElementById('inv-table');
    if(!invTable) return; // 竞态/页面切换时容器可能已不存在，静默退出避免 null 报错
    invTable.innerHTML = buildInvTableHTML(data, cols, invAllFilteredIds.length, fmtLocalMoney, fmtCnyMoney);
    syncInvHeader();
    renderInvCards(data, countryCurrency, c);
  }catch(e){showFlash(e.message,'danger')}
}

// 库存总表指标卡：根据当前筛选结果实时汇总（仅本页面，复用 loadInv 已构建的 countryCurrency）

// 库存总表表头/表体拆分滚动（2026-08-02 修复）
// 纵向：滚动容器是 .content(overflow-y:auto, padding-top:12px)，不是 viewport；
// 故 sticky top 用 -12px 抵消 .content 的 padding-top，使表头贴合 topbar 下沿；
// 横向：表体容器 overflow-x:auto 自身横向滚动；表头与表体列宽+横向位移同步，保持对齐。
// 仅前端 app.js，不改 server.js / DB / index.html 全局 / 其他页面 / 表格列与数据。
function buildInvTableHTML(data, cols, allCount, fmtLocalMoney, fmtCnyMoney){
  const thead='<tr><th class="col-sticky" style="width:32px;left:0;background:#fafbfc"><input type="checkbox" id="inv-check-all" onchange="toggleAllInv(this.checked)"></th><th class="col-sticky" style="white-space:nowrap;left:32px;background:#fafbfc">SKU<br><a href="javascript:void(0)" onclick="selectAllInvFiltered()" style="font-size:11px;color:var(--primary,#2e7d32)">全选全部('+allCount+')</a></th>'+cols.slice(1).map(h=>'<th>'+h+'</th>').join('');
  const tbody = !data.length
    ? '<tr><td colspan="'+(cols.length+1)+t('gen.L2908.1','" style="text-align:center;padding:30px;color:#999">暂无库存数据</td></tr>')
    : data.map(i=>{
        var invVal = (i.available_qty||0)*(i.weighted_avg_cost||0);
        var daysSinceLastInbound = '-';
        var agingRisk = '-';
        var agingRiskClass = '';
        if(i.last_inbound_date && String(i.last_inbound_date).trim()){
          var d = new Date(i.last_inbound_date);
          if(!isNaN(d)){
            var diffMs = new Date() - d;
            var diffDays = Math.floor(diffMs / (1000*60*60*24));
            daysSinceLastInbound = diffDays;
            if(diffDays <= 90){agingRisk=t("inventory.005", "正常");agingRiskClass='status-completed';}
            else if(diffDays <= 180){agingRisk=t("app.670", "关注");agingRiskClass='status-warning';}
            else if(diffDays <= 365){agingRisk=t("app.671", "高库龄");agingRiskClass='status-danger';}
            else{agingRisk=t("app.672", "超高库龄");agingRiskClass='status-danger';}
          }
        } else {
          agingRisk = t("app.673", "未知");
          agingRiskClass = 'status-warning';
        }
        return '<tr>'
        +'<td class="col-sticky" style="left:0;background:var(--card-bg,#fff)"><input type="checkbox" class="inv-check" value="'+esc(i.id)+'" onchange="updateInvBatchBar()"></td>'
        +'<td class="col-sticky cell-id" style="left:32px;background:var(--card-bg,#fff)" title="'+esc(i.product_name||'')+'">'+esc(i.sku_code)+' <button class="action-btn" style="padding:0 2px;font-size:12px;line-height:1;vertical-align:baseline" title="'+t('ci.lots_btn','查看寄售批次')+'" onclick="event.stopPropagation();viewConsignmentLots(\''+esc(i.warehouse)+'\',\''+esc(i.sku_code)+'\')">🔍</button></td>'
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
        +'<td class="text-right">'+(daysSinceLastInbound!=='-'?daysSinceLastInbound+t('gen.L2947.1','天'):t("app.673", "未知"))+'</td>'
        +'<td><span class="status-badge '+agingRiskClass+'">'+agingRisk+'</span></td>'
        +'<td class="cell-date">'+fmtDate(i.first_inbound_date)+'</td>'
        +'<td class="cell-date">'+fmtDate(i.snapshot_cutoff_date)+'</td>'
        +'<td class="cell-date">'+fmtDate(i.last_outbound_date)+'</td>'
        +'<td>'+invStatusBadge(i.inventory_status)+'</td>'
        +'<td>'+(i.is_focused?'⭐':'')+'</td>'
        +'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="'+esc(i.inventory_remark||'')+'">'+esc(i.inventory_remark||'')+'</td>'
        +'</tr>';
      }).join('');
  return '<div class="inv-thead-wrap" id="inv-thead-wrap"><table class="data-table inv-head-table" id="inv-head-table" style="table-layout:fixed;width:max-content;margin:0"><thead>'+thead+'</thead></table></div>'
    + '<div class="table-container inv-body-wrap" id="inv-body-wrap" style="overflow-x:auto"><table class="data-table inv-body-table" id="inv-body-table" style="table-layout:fixed;width:max-content"><tbody>'+tbody+'</tbody></table></div>';
}

// 同步库存表头与表体：列宽对齐 + 横向滚动位移同步

// ===== 库存总表筛选级联（P1-1，仅库存总表页面）=====
async function refreshInvFilterOptions(){
  var fc=document.getElementById('inv-c'), fw=document.getElementById('inv-w'), fb=document.getElementById('inv-b');
  if(!fc||!fw||!fb) return;
  var c=fc.value||'', w=fw.value||'', b=fb.value||'';
  try{
    var opts=await api('/api/inventory/filter-options?country='+encodeURIComponent(c)+'&warehouse='+encodeURIComponent(w)+'&brand='+encodeURIComponent(b));
    _rebuildInvSelect(fc, opts.countries, c);
    _rebuildInvSelect(fw, opts.warehouses, w);
    _rebuildInvSelect(fb, opts.brands, b);
  }catch(e){ console.warn('filter-options refresh failed', e); }
}
function _rebuildInvSelect(sel, values, current){
  sel.innerHTML='<option value="">全部</option>';
  (values||[]).forEach(function(v){
    var o=document.createElement('option'); o.value=v; o.textContent=v;
    if(v===current) o.selected=true;
    sel.appendChild(o);
  });
}
async function onInvFilterChange(dim){
  // 维度变化后刷新依赖下拉（保留已选有效条件），再重新拉取库存数据
  await refreshInvFilterOptions();
  loadInv();
}

function syncInvHeader(){
  var bw=document.getElementById('inv-body-wrap');
  var hw=document.getElementById('inv-thead-wrap');
  var body=document.getElementById('inv-body-table');
  var head=document.getElementById('inv-head-table');
  if(bw&&hw&&body&&head){
    bw.onscroll=function(){ hw.scrollLeft=this.scrollLeft; };
    // P1-2：布局稳定（字体/异步内容回流）后再次同步，消除列宽漂移
    if(!window._invSyncRAF){
      window._invSyncRAF=true;
      requestAnimationFrame(function(){ window._invSyncRAF=false; _syncInvHeaderInternal(); });
    }
  }
  if(!body||!head) return;
  _syncInvHeaderInternal();
  if(!window._invResizeBound){
    window._invResizeBound=true;
    window.addEventListener('resize', function(){ _syncInvHeaderInternal(); });
    if(typeof ResizeObserver!=='undefined'){
      try{ var ro=new ResizeObserver(function(){ _syncInvHeaderInternal(); }); ro.observe(document.body); }catch(e){}
    }
  }
}

// P1-2(R4)：列宽对齐核心 —— head/body 两张独立 table 共享同一份 <colgroup> 作为唯一列宽真源。
// 列宽 = max(表头文字固有宽, 数据固有宽)，动态测量（列标题走 t() 国际化，禁止静态 px 表）。
// 幂等：每次重算前必须清除上一轮 inline width/min-width 并移除旧 colgroup，
//       否则 auto 测量会被上一轮总宽撑大，ResizeObserver 重复触发即导致宽度逐轮膨胀。
function _syncInvHeaderInternal(){
  var body=document.getElementById('inv-body-table');
  var head=document.getElementById('inv-head-table');
  if(!body||!head) return;
  var ref=body.querySelector('tbody tr');
  var hRow=head.querySelector('thead tr');
  if(!ref||!hRow) return;
  var bCells=ref.children, hCells=hRow.children;
  var i, n=hCells.length;
  // 复位到自然布局（同时是空数据分支的回退状态）
  var reset=function(){
    for(var j=0;j<hCells.length;j++){ hCells[j].style.width=''; hCells[j].style.minWidth=''; }
    for(var k=0;k<bCells.length;k++){ bCells[k].style.width=''; bCells[k].style.minWidth=''; }
    [head,body].forEach(function(t){
      var cg=t.querySelector('colgroup'); if(cg) cg.parentNode.removeChild(cg);
      t.style.tableLayout='auto'; t.style.width='max-content'; t.style.minWidth='';
    });
  };
  reset();
  if(bCells.length<n) return; // 空数据行（colspan 占位），跳过列宽同步，保持自然布局
  void body.offsetWidth; // 强制回流，确保读到 auto 布局下的固有宽度
  var ws=[], totalW=0, w;
  for(i=0;i<n;i++){
    w=Math.ceil(Math.max(hCells[i].getBoundingClientRect().width, bCells[i].getBoundingClientRect().width));
    if(i===0) w=32; // 复选框列钉死 32px，与 col-sticky 的 left:32px 严格对齐
    ws.push(w); totalW+=w;
  }
  // 同一份 colgroup 注入两张表：fixed 布局下 <col> 优先级高于首行单元格，构成唯一列宽真源
  var cgHTML='<colgroup>';
  for(i=0;i<n;i++){ cgHTML+='<col style="width:'+ws[i]+'px">'; }
  cgHTML+='</colgroup>';
  [head,body].forEach(function(t){
    t.insertAdjacentHTML('afterbegin', cgHTML);
    t.style.tableLayout='fixed'; t.style.width=totalW+'px'; t.style.minWidth=totalW+'px';
  });
}

function renderInvCards(data, countryCurrency, countryFilter){
  const el=document.getElementById('inv-cards');
  if(!el) return;
  const fmtN=function(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});};
  // 可用库存（=Σ available_qty）
  let totalQty=0;
  let safetyStock=0, inTransit=0, piUnshipped=0, poUnconfirmed=0;
  const byCur={}; let rmbTotal=0;
  (data||[]).forEach(function(i){
    totalQty += (i.available_qty||0);
    safetyStock += (i.safety_stock||0);
    inTransit += (i.in_transit_qty||0);
    piUnshipped += (i.pi_confirmed_unshipped_qty||0);
    poUnconfirmed += (i.po_unconfirmed_pi_qty||0);
    const ci = countryCurrency[i.country] || {};
    const invVal = (i.available_qty||0)*(i.weighted_avg_cost||0);
    const code = ci.code || t('inv.kpi.unknown_cur','未知');
    if(!byCur[code]) byCur[code]={symbol:(ci.symbol||''), amount:0};
    byCur[code].amount += invVal;
    if(ci.rate) rmbTotal += invVal / ci.rate; // rate=cnyToForeign (1 CNY = X 本币)，CNY = 本币/rate
  });
  const curCodes=Object.keys(byCur);
  let localTitle, localValue;
  if(curCodes.length===1){
    const code=curCodes[0];
    localTitle=t('inv.kpi.amount_local_cur','库存金额（{v1}）',{v1:code});
    localValue=(byCur[code].symbol?byCur[code].symbol+' ':'')+fmtN(byCur[code].amount);
  } else if(curCodes.length>1){
    localTitle=t('inv.kpi.amount_local','库存金额（本币）');
    localValue=curCodes.map(function(code){
      return code+': '+(byCur[code].symbol?byCur[code].symbol+' ':'')+fmtN(byCur[code].amount);
    }).join('　/　');
  } else {
    localTitle=t('inv.kpi.amount_local','库存金额（本币）');
    localValue='-';
  }
  const rmbValue='¥ '+fmtN(rmbTotal);
  el.innerHTML =
    '<div class="stat-card"><div class="stat-label">'+t('inv.kpi.available_qty','可用库存')+'</div><div class="stat-number">'+Number(totalQty).toLocaleString('en-US')+' '+t('inv.kpi.unit','件')+'</div></div>'
    +(countryFilter ? '<div class="stat-card"><div class="stat-label">'+esc(localTitle)+'</div><div class="stat-number">'+esc(localValue)+'</div></div>' : '')
    +'<div class="stat-card"><div class="stat-label">'+t('inv.kpi.amount_rmb','库存金额（人民币）')+'</div><div class="stat-number">'+esc(rmbValue)+'</div></div>'
    +'<div class="stat-card"><div class="stat-label">'+t('inv.kpi.safety_stock','安全库存')+'</div><div class="stat-number">'+Number(safetyStock).toLocaleString('en-US')+' '+t('inv.kpi.unit','件')+'</div></div>'
    +'<div class="stat-card"><div class="stat-label">'+t('inv.kpi.in_transit','在途')+'</div><div class="stat-number">'+Number(inTransit).toLocaleString('en-US')+' '+t('inv.kpi.unit','件')+'</div></div>'
    +'<div class="stat-card"><div class="stat-label">'+t('inv.kpi.pi_unshipped','PI未发')+'</div><div class="stat-number">'+Number(piUnshipped).toLocaleString('en-US')+' '+t('inv.kpi.unit','件')+'</div></div>'
    +'<div class="stat-card"><div class="stat-label">'+t('inv.kpi.po_unconfirmed','PO未确认')+'</div><div class="stat-number">'+Number(poUnconfirmed).toLocaleString('en-US')+' '+t('inv.kpi.unit','件')+'</div></div>';
}

// 重置库存总表筛选：清空条件 + 删除保存状态 + 恢复全部库存 + 重新计算指标卡
function resetInvFilters(){
  const fc=document.getElementById('inv-c'), fw=document.getElementById('inv-w'), fb=document.getElementById('inv-b'), fk=document.getElementById('inv-k');
  if(fc) fc.value=''; if(fw) fw.value=''; if(fb) fb.value=''; if(fk) fk.value='';
  try{ localStorage.removeItem('psi_inv_filters_v1'); }catch(e){}
  loadInv();
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
  const cba=document.getElementById('inv-check-all'); if(cba) cba.checked=true;
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
    t('html.renderOutbound', '<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>来源系统</label><select id="sr-ss"><option value="">全部</option></select></div><div class="filter-group"><label>国家</label><select id="sr-co"><option value="">全部</option></select></div><div class="filter-group"><label>渠道</label><select id="sr-sp"><option value="">全部</option></select></div><div class="filter-group"><label>品牌</label><select id="sr-b"><option value="">全部</option></select></div><div class="filter-group"><label>SKU搜索</label><input type="text" id="sr-sk" class="form-control" placeholder="SKU（支持部分/大小写不敏感）"></div><div class="filter-group"><label>有效订单</label><select id="sr-iv"><option value="">全部</option><option value="1">有效</option><option value="0">无效</option></select></div><div class="filter-group"><label>开始日期</label><input type="date" id="sr-sd" class="form-control"></div><div class="filter-group"><label>结束日期</label><input type="date" id="sr-ed" class="form-control"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="salesResetPage();loadSales()">搜索</button>{v1}</div></div></div><div id="sr-batch-bar" style="display:none;background:var(--bg-card,#fff);border:1px solid var(--border,#e0e0e0);border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span id="sr-batch-count" style="font-weight:600;margin-right:8px"></span>{v2}<button class="btn btn-sm btn-secondary" onclick="salesBatchExport()">📊 导出</button><button class="btn btn-sm btn-secondary" onclick="salesClearSelection()" style="margin-left:auto">取消选择</button></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🛒 销售明细</div></div><div id="sr-table"></div></div>', {v1: hasPermission('outbound_import')?t('gen.L3164.1','<button class="btn btn-secondary btn-sm" onclick="openSalesBatchImport()">📥 导入</button>'):'', v2: hasPermission('outbound_delete')?'<button class="btn btn-sm btn-danger" onclick="salesDeleteSelected()">🗑 删除</button>':''});
  // 加载下拉选项
  try{
    const opts=await api('/api/sales-records/filter-options');
    const fss=document.getElementById('sr-ss'), fsp=document.getElementById('sr-sp'), fb=document.getElementById('sr-b'), fco=document.getElementById('sr-co');
    // 清除除"全部"外的旧选项，防止重复追加
    function refillSelect(el, values){
      if(!el) return;
      // 保留第一个 option（"全部"），删除其余
      while(el.options.length>1) el.remove(1);
      values.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;el.appendChild(o);});
    }
    refillSelect(fss, opts.source_systems||[]);
    refillSelect(fsp, opts.shop_platforms||[]);
    refillSelect(fb, opts.brands||[]);
    refillSelect(fco, opts.countries||[]);
  }catch(e){console.warn('sales filter-options load failed',e)}
  loadSales();
}

let salesCurrentPage = 1;
const SALES_PAGE_SIZE = 500;

// 统一构造销售列表筛选参数：列表查询与“全选全部”查询共用，避免前端参数漂移
function buildSalesFilterParams(){
  const ss=document.getElementById('sr-ss')?.value||'',sp=document.getElementById('sr-sp')?.value||'',b=document.getElementById('sr-b')?.value||'',iv=document.getElementById('sr-iv')?.value||'',sd=document.getElementById('sr-sd')?.value||'',ed=document.getElementById('sr-ed')?.value||'',co=document.getElementById('sr-co')?.value||'',sk=document.getElementById('sr-sk')?.value||'';
  const p=new URLSearchParams();
  if(ss) p.set('source_system',ss);
  if(sp) p.set('shop_platform',sp);
  if(b) p.set('brand',b);
  if(sk) p.set('sku_code',sk);
  if(iv!==undefined && iv!=='') p.set('is_valid',iv);
  if(co) p.set('country',co);
  if(sd) p.set('start_date',sd);
  if(ed) p.set('end_date',ed);
  return p;
}

async function loadSales(opts){
  opts = opts || {};
  const preserveSelection = !!opts.preserveSelection;
  try{
    const offset=(salesCurrentPage-1)*SALES_PAGE_SIZE;
    const p=buildSalesFilterParams();
    p.set('limit',SALES_PAGE_SIZE);
    p.set('offset',offset);
    const resp=await api('/api/sales-records?'+p.toString());
    const data=resp.rows||resp;
    const totalCount=resp.total!==undefined?resp.total:data.length;
    salesDataCache = data;
    // 选择态管理：仅当“全新筛选加载”（非翻页保活）时重置为当前页选择态
    if(!preserveSelection || !salesSelectAllMode){
      salesAllFilteredIds = data.map(d=>d.id);
      salesSelectAllMode = false;
    }
    updateSalesBatchBar();
    const cols = [t("po.018", "来源系统"),t("po.019", "订单号"),t("col.order_date", "下单日期"),t("col.country", "国家"),t("col.channel", "渠道"),t("app.112", "\u54c1\u724c"),'SKU',t("app.232", "\u4ea7\u54c1\u540d"),t("col.quantity", "数量"),t("app.640", "\u6709\u6548\u8ba2\u5355"),t("po.022", "\u539f\u59cb\u8ba2\u5355\u72b6\u6001"),t("col.remark", "备注")];
    const _srTable=document.getElementById('sr-table'); if(!_srTable) return;
    const totalPages=Math.ceil(totalCount/SALES_PAGE_SIZE);
    const inSelectAll = salesSelectAllMode;
    const allSet = inSelectAll ? new Set(salesAllFilteredIds) : null;
    const paginationHtml=totalCount>SALES_PAGE_SIZE?'<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--bg-card,#fff);border-top:1px solid var(--border,#e0e0e0);font-size:13px"><span>'+t('html.sales.total_records','共 {n} 条',{n:totalCount})+'</span><div style="display:flex;gap:6px;align-items:center"><button class="btn btn-sm btn-secondary" onclick="salesGotoPage('+(salesCurrentPage-1)+')" '+(salesCurrentPage<=1?'disabled':'')+'>'+t('action.prev','上一页')+'</button><span>'+salesCurrentPage+' / '+totalPages+'</span><button class="btn btn-sm btn-secondary" onclick="salesGotoPage('+(salesCurrentPage+1)+')" '+(salesCurrentPage>=totalPages?'disabled':'')+'>'+t('action.next','下一页')+'</button></div></div>':'';
    _srTable.innerHTML=t('html.loadSales', '<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th style="width:32px"><input type="checkbox" id="sr-check-all" onchange="toggleAllSales(this.checked)"></th><th style="white-space:nowrap"><a href="javascript:void(0)" onclick="selectAllSalesFiltered()" style="font-size:11px;color:var(--primary,#2e7d32)">全选全部({v1})</a></th>{v2}</tr></thead><tbody>{v3}</tbody></table></div>', {v1: totalCount, v2: cols.slice(1).map(h=>'<th>'+h+'</th>').join(''), v3: !data.length?'<tr><td colspan="'+(cols.length+1)+t('gen.L3188.1','" style="text-align:center;padding:30px;color:#999">暂无数据</td></tr>')
      :data.map(r=>'<tr'+(r.is_valid_order?'':' style="opacity:0.5"')+'>'
        +'<td><input type="checkbox" class="sr-check" value="'+esc(r.id)+'"'+(inSelectAll && allSet.has(r.id)?' checked':'')+' onchange="updateSalesBatchBar()"></td>'
        +'<td>'+esc(r.source_system||'-')+'</td>'
        +'<td class="cell-id">'+esc(r.order_no||'-')+'</td>'
        +'<td class="cell-date">'+fmtDate(r.order_date)+'</td>'
        +'<td>'+esc(r.country||'-')+'</td>'
        +'<td>'+esc(r.shop_platform||'-')+'</td>'
        +'<td>'+esc(r.brand||'-')+'</td>'
        +'<td class="cell-id">'+esc(r.sku_code)+'</td>'
        +'<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.product_name||'')+'">'+esc(r.product_name||'-')+'</td>'
        +'<td class="text-right font-bold">'+r.quantity+'</td>'
        +'<td>'+(r.is_valid_order?t('gen.L3199.1','<span style="color:#52c41a">✅ 有效</span>'):t('gen.L3199.2','<span style="color:#999">❌ 无效</span>'))+'</td>'
        +'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.original_order_status||'')+'">'+esc(r.original_order_status||'-')+'</td>'
        +'<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.remark||'')+'">'+esc(r.remark||'')+'</td>'
      +'</tr>').join('')})+paginationHtml;
  }catch(e){showFlash(e.message,'danger')}
}

function salesGotoPage(page){
  if(page<1) return;
  salesCurrentPage=page;
  // 翻页：保留“全选全部”选择态，仅刷新当前页数据
  loadSales({preserveSelection:true});
}

// 清除选择态（用于“筛选条件变化”场景，与翻页区分开）
function resetSalesSelection(){
  salesSelectAllMode = false;
  salesAllFilteredIds = [];
}

function salesResetPage(){
  salesCurrentPage=1;
  // 搜索 = 新筛选，必须清选择（分页 ≠ 新筛选）
  resetSalesSelection();
}

function salesGetSelectedIds(){
  if(salesSelectAllMode) return salesAllFilteredIds;
  return Array.from(document.querySelectorAll('.sr-check:checked')).map(cb=>cb.value);
}

function toggleAllSales(checked){
  document.querySelectorAll('.sr-check').forEach(cb=>cb.checked=checked);
  salesSelectAllMode = false;
  salesAllFilteredIds = [];
  updateSalesBatchBar();
}

async function salesFetchAllFilteredIds(){
  // 与 loadSales 共用同一前端筛选参数来源，避免两套筛选 SQL 漂移
  const p=buildSalesFilterParams();
  const resp=await api('/api/sales-records/ids?'+p.toString());
  return (resp.ids||[]);
}

async function selectAllSalesFiltered(){
  try{
    const ids = await salesFetchAllFilteredIds();
    salesAllFilteredIds = ids;
    salesSelectAllMode = true;
    document.querySelectorAll('.sr-check').forEach(cb=>cb.checked=true);
    const cba=document.getElementById('sr-check-all'); if(cba) cba.checked=true;
    updateSalesBatchBar();
  }catch(e){ showFlash(e.message,'danger'); }
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

// §10 删除 payload 的 selection 语义：全选全部 → 完整 filtered ids；否则 → 当前页选中 ids
function salesGetDeleteIds(){
  return salesSelectAllMode ? Array.from(salesAllFilteredIds) : salesGetSelectedIds();
}

// §9/§11/§12 真实删除入口（后端 outbound_delete 终态校验；此处仅 UX 前置）
async function salesDeleteSelected(){
  const ids = salesGetDeleteIds();
  if(ids.length === 0){ showToast(t("toast.select_first","请先选择记录"),'warning'); return; }
  // §11 preflight（真实 DELETE 仍会全量复校权限/scope/whole-request，此处仅 UX 预确认）
  let preflight = null;
  try{
    preflight = await api('/api/sales-records/delete-preflight','POST',{ids});
  }catch(e){ showFlash(e.message,'danger'); return; }
  if(!preflight || preflight.error){ showFlash((preflight&&preflight.error)||t('err.preflight_failed','预检失败'),'danger'); return; }
  const ok = confirm(t('confirm.sales_delete','确定删除已选择的 {n} 条销售记录吗？\n删除后，对应 SKU 的销量统计和订单预测将同步更新。',{n: ids.length}));
  if(!ok) return;
  try{
    const resp = await api('/api/sales-records','DELETE',{ids});
    if(resp && resp.error){ showFlash(resp.error,'danger'); return; }
    showFlash(t('flash.sales_deleted','已删除 {n} 条销售记录',{n: (resp&&resp.deleted_count!=null?resp.deleted_count:ids.length)}),'success');
    resetSalesSelection();
    // §12 保留筛选条件重新加载；修正越界页（删除后当前页可能超出总页数）
    await loadSales();
    while(salesDataCache.length===0 && salesCurrentPage>1){
      salesCurrentPage = salesCurrentPage - 1;
      await loadSales();
    }
  }catch(e){ showFlash(e.message,'danger'); }
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
// ==================== 总预测：月度销量列（字段池覆盖 去年1月 ~ 今年12月）====================
// 不新增页面年份筛选：当年 12 个月默认显示，去年 12 个月默认隐藏，用户通过「字段配置」自行开关。
// 列 key 固定为 ms_YYYY_MM，随年份滚动而稳定，localStorage 中已保存的显隐/顺序/冻结配置不会失效。
function isRpMonthColKey(key){return /^ms_\d{4}_\d{2}$/.test(String(key||''));}
function rpMonthColDefs(){
  var now=new Date();
  var currentYear=now.getFullYear();
  var currentMonth=now.getMonth()+1; // 1-12，当前月（含）之前的月份视为“已发生”
  var defs=[];
  [currentYear-1,currentYear].forEach(function(y){
    for(var m=1;m<=12;m++){
      var mm=String(m).padStart(2,'0');
      // 当年已过去的月份默认可见；未来未发生月份默认隐藏（显示0，可在字段设置动态打开）
      var visible=y===currentYear && m<=currentMonth;
      defs.push({key:'ms_'+y+'_'+mm,ym:y+'-'+mm,year:y,month:m,label:y+'-'+mm,visibleByDefault:visible});
    }
  });
  return defs;
}
// 月度销量取数区间：与字段池覆盖范围一致
function rpMonthColRange(){
  var currentYear=new Date().getFullYear();
  return {start:(currentYear-1)+'-01',end:currentYear+'-12'};
}
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
    sku:{min:120,default:170,max:240},
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
    transit_allocated:{min:95,default:120,max:180},
    transit_total:{min:85,default:100,max:160},
    transit_unallocated:{min:85,default:100,max:160},
    pool:{min:80,default:100,max:140},
    po_unconfirmed:{min:75,default:95,max:140},
    pi_unshipped:{min:85,default:100,max:160},
    // 周转
    avail_turnover:{min:75,default:90,max:130},
    transit_turnover:{min:75,default:90,max:130},
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
// 总预测月份销量列统一列宽，与渠道页单月销量列（sales_m*）保持一致
var RP_MONTH_COL_WIDTH={min:65,default:72,max:120};
function rpColWidthDef(key){
  if(isRpMonthColKey(key)) return RP_MONTH_COL_WIDTH;
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
    {key:'sku',label:'SKU',fixed:true},
    {key:'model',label:'Model'}
  ].concat(rpMonthColDefs()).concat([
    {key:'online_avg',label:t('gen.L3367.1','线上')+rpSalesStatsDays+t('gen.L3367.2','天月均销量')},
    {key:'offline_avg',label:t('gen.L3368.1','线下')+rpSalesStatsDays+t('gen.L3368.2','天月均销量')},
    {key:'total_avg',label:rpSalesStatsDays+t('gen.L3369.1','天月均销量')},
    {key:'avail',label:t("app.730", "\u5f53\u524d\u53ef\u7528\u5e93\u5b58")},
    {key:'transit',label:t('gen.L3371.1','在途库存')},
    {key:'pi_unshipped',label:t("app.731", "PI\u5df2\u786e\u8ba4\u672a\u53d1\u8d27")},
    {key:'po_unconfirmed',label:t("app.732", "PO\u672a\u786e\u8ba4PI"),visibleByDefault:false},
    {key:'total_target_stock',label:t("app.109", "\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf"),fixed:true},
    {key:'avail_turnover',label:t('gen.L3375.1','当前可用周转')},
    {key:'transit_turnover',label:t("app.733", "\u5728\u9014\u5e93\u5b58\u5468\u8f6c")},
    {key:'after_order_turnover',label:t("app.734", "\u9884\u8ba1\u4e0b\u5355\u540e\u5468\u8f6c")},
    {key:'last_inbound_date',label:t("po.012", "\u6700\u540e\u5165\u5e93\u65e5\u671f")},
    {key:'days_since_last_inbound',label:t("app.663", "\u8ddd\u6700\u540e\u5165\u5e93\u5929\u6570")},
    {key:'sales_status',label:t("app.735", "\u52a8\u9500\u72b6\u6001")},
    {key:'risk_tags',label:t("app.736", "\u98ce\u9669\u6807\u7b7e")},
    {key:'action_rec',label:t("app.111", "\u5efa\u8bae\u52a8\u4f5c")},
    {key:'suggestion',label:t('col.suggestion','建议说明')},
    {key:'ai_business_advice',label:t("app.737", "AI\u5efa\u8bae")},
    {key:'actions',label:t("common.actions", "\u64cd\u4f5c")},
    // --- 以下默认隐藏 ---
    {key:'online_pct',label:t("app.738", "\u7ebf\u4e0a\u5360\u6bd4"),visibleByDefault:false},
    {key:'offline_pct',label:t("app.739", "\u7ebf\u4e0b\u5360\u6bd4"),visibleByDefault:false},
    {key:'pool',label:t("app.740", "\u603b\u5e93\u5b58\u6c60"),visibleByDefault:false},
        {key:'sales_reason',label:t("app.742", "\u52a8\u9500\u539f\u56e0"),visibleByDefault:false},
    {key:'online_target_turn',label:t("app.743", "\u7ebf\u4e0a\u76ee\u6807\u5468\u8f6c"),visibleByDefault:false},
    {key:'offline_target_turn',label:t("app.744", "\u7ebf\u4e0b\u76ee\u6807\u5468\u8f6c"),visibleByDefault:false},
    {key:'online_target_stock',label:t("app.745", "\u7ebf\u4e0a\u5efa\u8bae"),visibleByDefault:false},
    {key:'offline_target_stock',label:t("app.746", "\u7ebf\u4e0b\u5efa\u8bae"),visibleByDefault:false},
    {key:'arrival_month',label:t("app.747", "\u5230\u8d27\u6708\u4efd"),visibleByDefault:false}
  ]);
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
  // 业务友好展示名（仅中文 fallback，不改内部值/不改 i18n key）
  var DISPLAY={
    '正常动销':'正常销售',
    '缺货风险':'即将缺货',
    '慢销':'销售偏慢',
    '停采/停产':'停止补货',
    '停采/清库存':'停止补货'
  };
  var key=MAP[v];
  if(!key) return v;
  return t(key, DISPLAY[v] || v);
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
  if(!key) return tg;
  // 业务友好展示名（仅中文 fallback，不改内部值/不改 i18n key）
  var DISPLAY={'销量失真':'缺货影响'};
  return t(key, DISPLAY[tg] || tg); // 未识别值原样显示
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
  var monthLabels={};
  var now=new Date();
  for(var offset=3;offset>=0;offset--){
    var d=new Date(now.getFullYear(),now.getMonth()-offset,1);
    monthLabels[['sales_m4','sales_m3','sales_m2','sales_m1'][3-offset]]
      =formatMonthLabel(d.getFullYear(),d.getMonth()+1,offset===0);
  }
  return [
    {key:'spacer',label:t("app.761", "\u5360\u4f4d"),fixed:true},
    {key:'sku',label:'SKU',fixed:true},
    {key:'model',label:'Model'},
    {key:'sales_m4',label:monthLabels.sales_m4},
    {key:'sales_m3',label:monthLabels.sales_m3},
    {key:'sales_m2',label:monthLabels.sales_m2},
    {key:'sales_m1',label:monthLabels.sales_m1},
    {key:'channel_avg',label:t('gen.L3457.1','渠道')+rpSalesStatsDays+t('gen.L3457.2','天月均销量')},
    {key:'channel_pct',label:t("app.766", "\u6e20\u9053\u5360\u6bd4")},
    // --- 库存判断字段（按用户指定顺序）---
    // 顺序：可用库存 → 当前可用周转 → 在途库存（已分配）→ 在途总库存 → 未分配在途 → 在途库存周转 → 未确认PO → 已确认PI未发货
    {key:'avail',label:t("app.767", "\u5f53\u524d\u53ef\u7528\u5e93\u5b58")},
    {key:'avail_turnover',label:t('gen.L3462.1','当前可用周转')},
    {key:'transit_allocated',label:t('forecast.compact.allocated_in_transit','在途库存（已分配）')},
    {key:'transit_total',label:t('forecast.compact.transit_total','在途总库存'),visibleByDefault:false},
    {key:'transit_unallocated',label:t('forecast.compact.transit_unallocated','未分配在途'),visibleByDefault:false},
    {key:'transit_turnover',label:t("app.733", "\u5728\u9014\u5e93\u5b58\u5468\u8f6c")},
    {key:'po_unconfirmed',label:t("app.732", "PO\u672a\u786e\u8ba4PI"),visibleByDefault:false},
    {key:'pi_unshipped',label:t("app.731", "PI\u5df2\u786e\u8ba4\u672a\u53d1\u8d27")},
    {key:'target_turn',label:t("app.660", "\u76ee\u6807\u5468\u8f6c"),visibleByDefault:false},
    {key:'target_stock',label:t('gen.L3467.1','建议采购'),fixed:true},
    {key:'after_order_turnover',label:t("app.734", "\u9884\u8ba1\u4e0b\u5355\u540e\u5468\u8f6c")},
    // --- 默认展示：结果 + 动作 ---
    {key:'sales_judgement',label:t("app.110", "\u52a8\u9500\u5224\u65ad")},
    {key:'action_rec',label:t("app.111", "\u5efa\u8bae\u52a8\u4f5c")},
    {key:'suggestion',label:t('col.suggestion','建议说明')},
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
    // v5 迁移（所有模式）：统一强制 SKU → Model → 其他字段（SKU 永远最左固定，Model 紧随其后）
  var migKey5='rp_col_config_v5_'+tabKey;
  if(localStorage.getItem(migKey5)!=='1'){
    if(Array.isArray(saved)&&saved.length){
      var lead5=[], skuItem5=null, modelItem5=null, rest5=[];
      saved.forEach(function(s){
        if(s.key==='check'||s.key==='spacer') lead5.push(s);
        else if(s.key==='sku') skuItem5=s;
        else if(s.key==='model') modelItem5=s;
        else rest5.push(s);
      });
      var rebuilt5=lead5.slice();
      if(skuItem5) rebuilt5.push(skuItem5);
      if(modelItem5) rebuilt5.push(modelItem5);
      rebuilt5=rebuilt5.concat(rest5);
      saved=rebuilt5;
      localStorage.setItem(storageKey,JSON.stringify(saved));
    }
    localStorage.setItem(migKey5,'1');
  }
  // v6 迁移（仅渠道页）：将 'transit' 键替换为 'transit_allocated'，追加在途总库存/未分配在途列
  if(tabKey!=='total'){
    var migKey6='rp_col_config_v6_'+tabKey;
    if(localStorage.getItem(migKey6)!=='1'){
      if(Array.isArray(saved)&&saved.length){
        saved=saved.map(function(s){
          if(s.key==='transit') return {key:'transit_allocated',visible:s.visible};
          return s;
        });
        var hasTT=saved.some(function(s){return s.key==='transit_total';});
        var hasTU=saved.some(function(s){return s.key==='transit_unallocated';});
        if(!hasTT) saved.push({key:'transit_total',visible:false});
        if(!hasTU) saved.push({key:'transit_unallocated',visible:false});
        localStorage.setItem(storageKey,JSON.stringify(saved));
      }
      localStorage.setItem(migKey6,'1');
    }
  }
  // v7 迁移（仅渠道页）：调整库存判断字段顺序
  // avail → avail_turnover → transit_allocated → transit_total → transit_unallocated → transit_turnover → po_unconfirmed → pi_unshipped
  if(tabKey!=='total'){
    var migKey7='rp_col_config_v7_'+tabKey;
    if(localStorage.getItem(migKey7)!=='1'){
      if(Array.isArray(saved)&&saved.length){
        var INV_ORDER=['avail','avail_turnover','transit_allocated','transit_total','transit_unallocated','transit_turnover','po_unconfirmed','pi_unshipped'];
        var invItems={}, nonInv=[];
        saved.forEach(function(s){
          if(INV_ORDER.indexOf(s.key)>=0){invItems[s.key]=s;}
          else{nonInv.push(s);}
        });
        // 找到插入位置：紧跟在 channel_pct 之后
        var insertIdx=0;
        for(var j=0;j<nonInv.length;j++){
          if(nonInv[j].key==='channel_pct'){insertIdx=j+1;}
        }
        var orderedInv=[];
        INV_ORDER.forEach(function(k){if(invItems[k]) orderedInv.push(invItems[k]);});
        var rebuilt7=nonInv.slice(0,insertIdx).concat(orderedInv).concat(nonInv.slice(insertIdx));
        saved=rebuilt7;
        localStorage.setItem(storageKey,JSON.stringify(saved));
      }
      localStorage.setItem(migKey7,'1');
    }
  }
  // v8 迁移（仅总预测）：月度销量字段插入到 Model 之后，兼容旧 localStorage 排序
  // 不改动用户已有字段的相对顺序，也不覆盖用户已保存的显隐选择
  if(tabKey==='total'){
    var migKey8='rp_col_config_v8_total';
    if(localStorage.getItem(migKey8)!=='1'){
      if(Array.isArray(saved)&&saved.length){
        var monthDefs8=rpMonthColDefs();
        var savedKeys8={};
        saved.forEach(function(s){savedKeys8[s.key]=true;});
        var newMonthItems=monthDefs8
          .filter(function(md){return !savedKeys8[md.key];})
          .map(function(md){return {key:md.key,visible:md.visibleByDefault!==false};});
        if(newMonthItems.length){
          // 插入位置：Model 之后；无 Model 时退回 SKU 之后；再无则置于首位
          var anchorIdx=-1;
          for(var k8=0;k8<saved.length;k8++){
            if(saved[k8].key==='model'){anchorIdx=k8;break;}
          }
          if(anchorIdx<0){
            for(var k9=0;k9<saved.length;k9++){
              if(saved[k9].key==='sku'){anchorIdx=k9;break;}
            }
          }
          saved=saved.slice(0,anchorIdx+1).concat(newMonthItems).concat(saved.slice(anchorIdx+1));
          localStorage.setItem(storageKey,JSON.stringify(saved));
        }
      }
      localStorage.setItem(migKey8,'1');
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

// 历史销量仅用于查看，不参与预测计算。
const RP_HISTORICAL_SALES_KEY='rp_historical_sales_cfg';
function loadHistoricalSalesConfig(){
  try{
    var cfg=JSON.parse(localStorage.getItem(RP_HISTORICAL_SALES_KEY)||'null');
    if(cfg&&['monthly','daily'].indexOf(cfg.mode)>=0&&cfg.start&&cfg.end){
      window._rpHistoricalSalesConfig=cfg;
      return true;
    }
  }catch(e){}
  window._rpHistoricalSalesConfig=null;
  return false;
}
function saveHistoricalSalesConfig(mode,start,end){
  var cfg={mode:mode,start:start,end:end};
  localStorage.setItem(RP_HISTORICAL_SALES_KEY,JSON.stringify(cfg));
  window._rpHistoricalSalesConfig=cfg;
}
function onHistoricalModeChange(){
  var mode=document.getElementById('rp-hist-mode')?.value||'monthly';
  var monthFields=document.getElementById('rp-hist-month-fields');
  var dayFields=document.getElementById('rp-hist-day-fields');
  if(monthFields)monthFields.style.display=mode==='monthly'?'flex':'none';
  if(dayFields)dayFields.style.display=mode==='daily'?'flex':'none';
}
async function fetchHistoricalSales(){
  var cfg=window._rpHistoricalSalesConfig;
  if(!cfg)return;
  try{
    var url='/api/replenishment-suggestions/historical-sales?mode='+encodeURIComponent(cfg.mode)
      +'&start='+encodeURIComponent(cfg.start)+'&end='+encodeURIComponent(cfg.end)
      +'&'+rpQuery();
    var result=await api(url);
    if(!result||result.success===false)throw new Error((result&&result.error)||t('forecast.hist.api_no_data','未获取到历史销售数据'));
    window._rpHistoricalSales=result;
    rpClearViewForTab(rpTab);
    await loadRp();
  }catch(e){
    window._rpHistoricalSales=null;
    showFlash(t('forecast.hist.api_failed','历史销售查询失败：')+e.message,'danger');
  }
}
function loadRpWithHistorical(){
  if(window._rpHistoricalSalesConfig)return fetchHistoricalSales();
  return loadRp();
}
function applyHistoricalSalesView(){
  var mode=document.getElementById('rp-hist-mode')?.value||'monthly';
  var start=document.getElementById(mode==='monthly'?'rp-hist-start-month':'rp-hist-start-date')?.value||'';
  var end=document.getElementById(mode==='monthly'?'rp-hist-end-month':'rp-hist-end-date')?.value||'';
  if(!start||!end||start>end){
    showToast(t('forecast.hist.api_error','查询失败：')+t('common.invalid_date_range','请选择有效的开始和结束日期'),'danger');
    return;
  }
  saveHistoricalSalesConfig(mode,start,end);
  closeModal();
  fetchHistoricalSales();
}
function clearHistoricalSales(){
  localStorage.removeItem(RP_HISTORICAL_SALES_KEY);
  window._rpHistoricalSalesConfig=null;
  window._rpHistoricalSales=null;
  closeModal();
  rpClearViewForTab(rpTab);
  loadRp();
}
function historicalSalesPanelHtml(){
  var cfg=window._rpHistoricalSalesConfig||{};
  var now=new Date();
  var currentMonth=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  var startMonth=cfg.mode==='monthly'?cfg.start:currentMonth;
  var endMonth=cfg.mode==='monthly'?cfg.end:currentMonth;
  var today=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  var startDate=cfg.mode==='daily'?cfg.start:today;
  var endDate=cfg.mode==='daily'?cfg.end:today;
  var mode=cfg.mode||'monthly';
  return '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">'
    +'<div style="font-weight:700;margin-bottom:8px">'+t('forecast.hist.title','历史销售查看范围')+'</div>'
    +'<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:end">'
    +'<label>'+t('common.mode','方式')+'<select id="rp-hist-mode" onchange="onHistoricalModeChange()" style="display:block;margin-top:4px"><option value="monthly" '+(mode==='monthly'?'selected':'')+'>'+t('forecast.hist.monthly','按月')+'</option><option value="daily" '+(mode==='daily'?'selected':'')+'>'+t('forecast.hist.daily','按日')+'</option></select></label>'
    +'<div id="rp-hist-month-fields" style="display:'+(mode==='monthly'?'flex':'none')+';gap:8px"><label>'+t('forecast.hist.start_month','开始月份')+'<input id="rp-hist-start-month" type="month" value="'+esc(startMonth)+'" style="display:block;margin-top:4px"></label><label>'+t('forecast.hist.end_month','结束月份')+'<input id="rp-hist-end-month" type="month" value="'+esc(endMonth)+'" style="display:block;margin-top:4px"></label></div>'
    +'<div id="rp-hist-day-fields" style="display:'+(mode==='daily'?'flex':'none')+';gap:8px"><label>'+t('forecast.hist.start_date','开始日期')+'<input id="rp-hist-start-date" type="date" value="'+esc(startDate)+'" style="display:block;margin-top:4px"></label><label>'+t('forecast.hist.end_date','结束日期')+'<input id="rp-hist-end-date" type="date" value="'+esc(endDate)+'" style="display:block;margin-top:4px"></label></div>'
    +'<button class="btn btn-primary btn-sm" onclick="applyHistoricalSalesView()">'+t('forecast.hist.view','查看')+'</button>'
    +'<button class="btn btn-default btn-sm" onclick="clearHistoricalSales()">'+t('forecast.hist.clear','清除')+'</button>'
    +'</div><div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">'+t('forecast.hist.help','仅用于历史数据查看，不参与任何预测计算。')+'</div></div>';
}
function addHistoricalColsToActive(activeKeys,Cols,totals,data){
  var hist=window._rpHistoricalSales;
  if(!hist||!hist.success)return;
  var columns=hist.mode==='monthly'?(hist.columns||[]):['total'];
  // 渠道预测已固定展示当前四个自然月；历史查看范围与其重叠时不再重复追加同月列。
  var builtInMonths={};
  if(hist.mode==='monthly'&&['sales_m4','sales_m3','sales_m2','sales_m1'].some(function(key){return activeKeys.indexOf(key)>=0;})){
    var now=new Date();
    for(var offset=3;offset>=0;offset--){
      var month=new Date(now.getFullYear(),now.getMonth()-offset,1);
      builtInMonths[month.getFullYear()+'-'+String(month.getMonth()+1).padStart(2,'0')]=true;
    }
  }
  // 总预测已通过字段配置展示的月份列（ms_YYYY_MM），历史查看范围与其重叠时不再重复追加同月列
  if(hist.mode==='monthly'){
    activeKeys.forEach(function(key){
      if(isRpMonthColKey(key)) builtInMonths[key.slice(3).replace('_','-')]=true;
    });
  }
  totals._historical={};
  // 收集本次需要新增的历史列 key（按时间升序，已在 columns 中保证），稍后统一插入到固定位置
  var histKeys=[];
  columns.forEach(function(column){
    if(builtInMonths[column])return;
    var key='hs_'+String(column).replace(/[^a-zA-Z0-9]/g,'_');
    var label=hist.mode==='monthly'?column:t('forecast.hist.col_custom_period','自定义期间销量');
    totals._historical[key]=0;
    (data||[]).forEach(function(r){
      var item=(hist.data&&hist.data[r.sku_code])||{};
      totals._historical[key]+=Number(item[column]||0);
    });
    Cols[key]={
      th:rpThCompact(esc(label),'','text-right','',true),
      td:function(r){
        var item=(hist.data&&hist.data[r.sku_code])||{};
        return '<td class="text-right">'+formatQuantityDisplay(Number(item[column]||0))+'</td>';
      },
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t._historical[key]||0)+'</td>';}
    };
    if(activeKeys.indexOf(key)<0)histKeys.push(key);
  });
  // 固定显示位置：历史销售月份字段统一放在 SKU 列之后（按时间升序），禁止动态追加到表格末尾
  if(histKeys.length){
    var skuIdx=activeKeys.indexOf('sku');
    var insertIdx = skuIdx>=0 ? skuIdx+1 : (activeKeys.indexOf('check')>=0 ? 1 : 0);
    for(var hi=0;hi<histKeys.length;hi++){
      activeKeys.splice(insertIdx+hi,0,histKeys[hi]);
    }
  }
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
    +historicalSalesPanelHtml()
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
  rpClearViewForTab(tabKey);
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
function initRpTableDrag(tabKey, container){
  if(window._rpHistoricalSales)return;
  container=container||rpActiveContainer();
  if(!container)return;
  // 重试机制：等待表格渲染完成
  function tryInit(){
    var table=container.querySelector('table');
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
  rpClearDataCache();
  rpClearAllViews();
  document.getElementById('content-inner').innerHTML=t('html.renderReplenishment', `<div id="flash-container"></div><div id="rp-collapsible"><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>国家</label><select id="rp-c" onchange="onRpCountryChange()"><option value="">全部</option></select></div><div class="filter-group"><label>仓库</label><select id="rp-w" onchange="loadRpSummary();loadRp()"><option value="">全部</option></select></div><div class="filter-group"><label>品牌</label><select id="rp-b" onchange="onRpBrandChange()"><option value="">全部</option></select></div><div class="filter-actions">{v1}<button class="btn btn-default btn-sm" onclick="exportRpExcel()">⬇ 导出Excel</button><button class="btn btn-default btn-sm" onclick="openRpParams()">⚙ 预测参数设置</button></div></div></div></div><div class="tab-bar" style="margin:12px 20px 0;display:flex;justify-content:space-between;align-items:center"><div style="display:flex"><div class="tab-item active" onclick="switchRpTab('total')">📊 总预测</div><div class="tab-item" onclick="switchRpTab('online')">🛒 线上预测</div><div class="tab-item" onclick="switchRpTab('offline')">🏪 线下预测</div></div><div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary)"><span>显示方式：</span><div class="rp-mode-switch"><button class="rp-mode-btn active" onclick="switchRpMode('monthly')">按月</button><button class="rp-mode-btn" onclick="switchRpMode('daily')">按天</button></div><button class="btn btn-default btn-sm rp-collapse-btn" id="rp-collapse-btn" onclick="toggleRpCollapse()" title="收起/展开 顶部筛选区与指标卡片">▾ 收起</button></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left" id="rp-tab-title">📊 SKU动销与订单预测（总预测）</div><div class="table-section-actions"><input type="text" id="rp-s" placeholder="SKU搜索" onkeypress="if(event.key==='Enter')loadRp()" style="width:140px;height:28px;padding:4px 8px;border:1px solid #d0d7de;border-radius:4px;font-size:13px;margin-right:8px">{v2}{v3}<button class="btn btn-default btn-sm" id="rp-field-config-btn" onclick="openRpFieldConfig(rpTab)" title="字段显示与排序" style="margin-left:8px">⚙ 字段配置</button></div></div><div id="rp-table"></div></div>`, {v1: hasPermission('replenishment_edit')?t('gen.L3813.1','<button class="btn btn-success btn-sm rp-gen-btn" onclick="genRp()">🔄 重新计算</button>'):'', v2: hasPermission('replenishment_edit')?t('gen.L3813.2','<button class="btn btn-success btn-sm rp-gen-btn" onclick="genRp()" style="margin-right:8px">🔄 重新计算</button>'):'', v3: hasPermission('po_create')?t('gen.L3813.3','<button class="btn btn-primary btn-sm" id="rp-po-btn" onclick="genPOModal()">🛒 生成PO</button>'):''});
  var rpFilterActions=document.querySelector('#rp-collapsible .filter-actions');
  if(rpFilterActions){
    var statusFilter=document.createElement('div');
    statusFilter.className='filter-group';
    statusFilter.innerHTML='<label>'+t('app.735','动销状态')+'</label><select id="rp-status" onchange="onRpFilterChange()"><option value="">'+t('common.all','全部')+'</option>'
      +['缺货风险','呆滞','慢销','正常动销','新品/销售数据不足','无有效销售','清仓','停采/停产','停采/清库存'].map(function(v){return '<option value="'+esc(v)+'">'+esc(formatForecastSalesStatus(v))+'</option>';}).join('')
      +'</select>';
    rpFilterActions.parentNode.insertBefore(statusFilter,rpFilterActions);
    var lifecycleFilter=document.createElement('div');
    lifecycleFilter.className='filter-group';
    lifecycleFilter.innerHTML='<label>'+t('app.559','生命周期')+'</label><select id="rp-lifecycle" onchange="onRpFilterChange()"><option value="">'+t('common.all','全部')+'</option>'
      +['new_test','new_launch','growth','stable','slow','stagnant','clearance','stopped'].map(function(v){return '<option value="'+v+'">'+esc(fmtLifecycleDyn(v))+'</option>';}).join('')
      +'</select>';
    rpFilterActions.parentNode.insertBefore(lifecycleFilter,rpFilterActions);
    rpFilterActions.insertAdjacentHTML('beforeend','<button class="btn btn-default btn-sm" onclick="resetRpFilters()">↺ '+t('common.reset','重置筛选')+'</button>');
  }
  var rpWarehouse=document.getElementById('rp-w');
  if(rpWarehouse)rpWarehouse.setAttribute('onchange','onRpFilterChange()');
  var rpSearch=document.getElementById('rp-s');
  if(rpSearch)rpSearch.setAttribute('onkeypress',"if(event.key==='Enter'){onRpFilterChange();}");
  // 优先恢复语言切换期间的内存状态；否则读取账号级订单预测偏好。
  if(!window.__rpFilterState){
    var savedPreferences=await loadRpPreferences();
    if(savedPreferences)window.__rpFilterState=savedPreferences;
  }
  await loadRpFilterOptions();
  // RC-FILTER-PRESERVE：语言切换后恢复筛选稳定值（会话内一次）
  // 国家→仓库→品牌存在依赖关系，loadRpFilterOptions 已 await onRpCountryChange 完成选项重建
  // 此处按依赖顺序回填稳定值：country（已由 loadRpFilterOptions 内部 prevCountry 保持）→ warehouse → brand
  if(typeof window.__restoreRpFilterState==='function'){
    window.__restoreRpFilterState();
  }
  loadRpSummary();
  if(loadHistoricalSalesConfig())fetchHistoricalSales();
  else loadRp();
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
  if(!skipDataReload){
    saveRpPreferences();
    loadRpSummary();
    loadRpWithHistorical();
  }
}
// RC-FILTER-PRESERVE：语言切换时保存/恢复订单预测筛选稳定值（会话内）
// 仅保存稳定 ID/value，不保存翻译文字；恢复时若选项已不存在则保持""（全部）
window.__saveRpFilterState=function(){
  try{window.__rpFilterState=collectRpPreferences();}catch(e){window.__rpFilterState=null;}
};
window.__restoreRpFilterState=function(){
  var s=window.__rpFilterState;
  if(!s) return false;
  try{
    // country/warehouse/brand 已在 loadRpFilterOptions→onRpCountryChange 中按依赖顺序恢复
    // 此处仅恢复 search/rpTab/rpMode（这些不依赖 select 选项重建）
    var st=document.getElementById('rp-status'); if(st) st.value=s.sales_status||'';
    var lc=document.getElementById('rp-lifecycle'); if(lc) lc.value=s.lifecycle_status||'';
    var sk=document.getElementById('rp-s'); if(sk) sk.value=s.search||'';
    // 恢复 tab/mode 变量 + UI 高亮（不调用 switchRpTab/switchRpMode 以避免重复 loadRp）
    if(s.rpTab && typeof rpTab!=='undefined'){
      rpTab=s.rpTab;
      var tabs=['total','online','offline'];
      document.querySelectorAll('#content-inner .tab-bar .tab-item').forEach(function(el,i){
        el.classList.toggle('active', tabs[i]===s.rpTab);
      });
      var titles={
        total:t("shell.068", "\ud83d\udcca SKU\u52a8\u9500\u4e0e\u8ba2\u5355\u9884\u6d4b\uff08\u603b\u9884\u6d4b\uff09"),
        online:t("app.783", "\ud83d\uded2 \u7ebf\u4e0a\u9500\u91cf\u9884\u6d4b"),
        offline:t("app.784", "\ud83c\udfea \u7ebf\u4e0b\u9500\u91cf\u9884\u6d4b")
      };
      var title=document.getElementById('rp-tab-title');
      if(title) title.textContent=titles[s.rpTab]||titles.total;
      var poBtn=document.getElementById('rp-po-btn');
      if(poBtn) poBtn.style.display=(s.rpTab==='total')?'':'none';
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
  saveRpPreferences();
  loadRpSummary();loadRpWithHistorical();
}
function collectRpPreferences(){
  return {
    country:document.getElementById('rp-c')?.value||'',
    warehouse:document.getElementById('rp-w')?.value||'',
    brand:document.getElementById('rp-b')?.value||'',
    sales_status:document.getElementById('rp-status')?.value||'',
    lifecycle_status:document.getElementById('rp-lifecycle')?.value||'',
    search:document.getElementById('rp-s')?.value||'',
    rpTab:rpTab||'total',
    rpMode:rpMode||'monthly'
  };
}
var _rpPreferencesSaveQueue=Promise.resolve();
async function loadRpPreferences(){
  try{
    await _rpPreferencesSaveQueue;
    var result=await api('/api/replenishment-suggestions/preferences');
    return result&&result.preferences?result.preferences:null;
  }catch(e){
    console.warn('replenishment preferences load failed',e);
    return null;
  }
}
function saveRpPreferences(){
  var preferences;
  try{preferences=collectRpPreferences();}catch(e){return Promise.resolve(null);}
  _rpPreferencesSaveQueue=_rpPreferencesSaveQueue
    .then(function(){return api('/api/replenishment-suggestions/preferences','PUT',{preferences:preferences});})
    .catch(function(e){console.warn('replenishment preferences save failed',e);return null;});
  return _rpPreferencesSaveQueue;
}
function onRpFilterChange(){
  saveRpPreferences();
  rpClearDataCache();
  rpClearAllViews();
  loadRpSummary();
  loadRpWithHistorical();
}
async function resetRpFilters(){
  ['rp-c','rp-w','rp-b','rp-status','rp-lifecycle','rp-s'].forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.value='';
  });
  window.__rpFilterState=null;
  rpClearDataCache();
  rpClearAllViews();
  await onRpCountryChange(true);
  await saveRpPreferences();
  loadRpSummary();
  loadRpWithHistorical();
}
function rpQuery(){
  const c=document.getElementById('rp-c')?.value||'';
  const w=document.getElementById('rp-w')?.value||'';
  const b=document.getElementById('rp-b')?.value||'';
  const k=document.getElementById('rp-s')?.value||'';
  const s=document.getElementById('rp-status')?.value||'';
  const l=document.getElementById('rp-lifecycle')?.value||'';
  return 'country='+encodeURIComponent(c)+'&warehouse='+encodeURIComponent(w)+'&brand='+encodeURIComponent(b)+'&keyword='+encodeURIComponent(k)+'&sales_status='+encodeURIComponent(s)+'&lifecycle_status='+encodeURIComponent(l);
}
function rpFilterBody(){
  return {
    country:document.getElementById('rp-c')?.value||'',
    warehouse:document.getElementById('rp-w')?.value||'',
    brand:document.getElementById('rp-b')?.value||''
  };
}
// ==================== 订单预测：缓存基础设施 ====================
var RP_MAX_DOM_VIEWS=3;
var RP_MAX_DATA_ENTRIES=20;
window._rpCache={
  data:new Map(),
  pending:new Map(),
  views:{},
  viewOrder:[]
};
function rpBaseUrl(){return '/api/replenishment-suggestions?'+rpQuery();}
function rpMonthlySalesUrl(){
  var r=rpMonthColRange();
  return '/api/replenishment-suggestions/monthly-sales?start='+r.start+'&end='+r.end+'&'+rpQuery();
}
function rpDailyUrl(){
  var url='/api/replenishment-suggestions/daily-sales?'+rpQuery();
  if(rpTab==='online')url+='&tab=online';
  else if(rpTab==='offline')url+='&tab=offline';
  var hcfg=window._rpHistoricalSalesConfig;
  if(hcfg&&hcfg.start&&hcfg.end){
    var ds,de;
    if(hcfg.mode==='monthly'){
      var eP=hcfg.end.split('-');var ey=Number(eP[0]),em=Number(eP[1]);
      ds=hcfg.start+'-01';de=ey+'-'+String(em).padStart(2,'0')+'-'+String(new Date(ey,em,0).getDate()).padStart(2,'0');
    }else{ds=hcfg.start;de=hcfg.end;}
    url+='&start='+encodeURIComponent(ds)+'&end='+encodeURIComponent(de);
  }
  return url;
}
function rpCurrentViewKey(){return rpTab+'-'+rpMode;}
function rpSignature(viewKey){
  if(viewKey==='total-monthly')return rpBaseUrl()+'|'+rpMonthlySalesUrl();
  if(viewKey==='online-monthly'||viewKey==='offline-monthly')return rpBaseUrl();
  return rpDailyUrl();
}
async function rpFetchCached(url){
  if(window._rpCache.data.has(url)){return window._rpCache.data.get(url);}
  if(window._rpCache.pending.has(url)){return window._rpCache.pending.get(url);}
  var p=api(url);
  window._rpCache.pending.set(url,p);
  try{
    var resp=await p;
    window._rpCache.data.set(url,resp);
    if(window._rpCache.data.size>RP_MAX_DATA_ENTRIES){
      var firstKey=window._rpCache.data.keys().next().value;
      window._rpCache.data.delete(firstKey);
    }
    return resp;
  }finally{window._rpCache.pending.delete(url);}
}
function rpGetViewNode(viewKey){
  var v=window._rpCache.views[viewKey];
  if(!v)return null;
  if(v.signature!==rpSignature(viewKey))return null;
  return v;
}
function rpActiveContainer(){
  var containers=document.querySelectorAll('#rp-table .rp-view-container');
  for(var i=0;i<containers.length;i++){
    if(containers[i].style.display!=='none')return containers[i];
  }
  return null;
}
function rpEnsureContainer(viewKey){
  var id='rp-view-'+viewKey;
  var el=document.getElementById(id);
  if(!el){
    el=document.createElement('div');
    el.id=id;
    el.className='rp-view-container';
    el.style.display='none';
    document.getElementById('rp-table').appendChild(el);
  }
  return el;
}
function rpShowView(viewKey){
  document.querySelectorAll('#rp-table .rp-view-container').forEach(function(el){
    el.style.display='none';
  });
  var target=document.getElementById('rp-view-'+viewKey);
  if(target)target.style.display='block';
}
function rpStoreViewNode(viewKey,container){
  window._rpCache.views[viewKey]={node:container,signature:rpSignature(viewKey),scrollTop:0,scrollLeft:0};
  var idx=window._rpCache.viewOrder.indexOf(viewKey);
  if(idx>=0)window._rpCache.viewOrder.splice(idx,1);
  window._rpCache.viewOrder.push(viewKey);
  rpEvictOldViews();
}
function rpTouchView(viewKey){
  var idx=window._rpCache.viewOrder.indexOf(viewKey);
  if(idx>=0){window._rpCache.viewOrder.splice(idx,1);window._rpCache.viewOrder.push(viewKey);}
}
function rpEvictOldViews(){
  while(window._rpCache.viewOrder.length>RP_MAX_DOM_VIEWS){
    var old=window._rpCache.viewOrder.shift();
    var v=window._rpCache.views[old];
    if(v&&v.node)v.node.remove();
    delete window._rpCache.views[old];
  }
}
function rpRemoveView(viewKey){
  var v=window._rpCache.views[viewKey];
  if(v&&v.node)v.node.remove();
  delete window._rpCache.views[viewKey];
  var idx=window._rpCache.viewOrder.indexOf(viewKey);
  if(idx>=0)window._rpCache.viewOrder.splice(idx,1);
}
function rpClearAllViews(){
  Object.keys(window._rpCache.views).forEach(function(k){
    var v=window._rpCache.views[k];
    if(v&&v.node)v.node.remove();
  });
  window._rpCache.views={};
  window._rpCache.viewOrder=[];
}
function rpClearViewForTab(tab){
  ['monthly','daily'].forEach(function(mode){
    rpRemoveView(tab+'-'+mode);
  });
}
function rpClearDataCache(){
  window._rpCache.data.clear();
  window._rpCache.pending.clear();
}
function rpSaveScroll(viewKey){
  var v=window._rpCache.views[viewKey];
  if(!v||!v.node)return;
  var sc=v.node.querySelector('.table-container')||v.node.querySelector('.daily-table-wrap');
  if(sc){v.scrollTop=sc.scrollTop;v.scrollLeft=sc.scrollLeft;}
}
function rpRestoreScroll(viewKey){
  var v=window._rpCache.views[viewKey];
  if(!v||!v.node)return;
  var sc=v.node.querySelector('.table-container')||v.node.querySelector('.daily-table-wrap');
  if(sc){if(v.scrollTop)sc.scrollTop=v.scrollTop;if(v.scrollLeft)sc.scrollLeft=v.scrollLeft;}
}
// ==================== 订单预测：Tab/Mode 切换 ====================
function switchRpTab(tab){
  var _t0=performance.now();
  rpTab=tab;
  document.querySelectorAll('#content-inner .tab-bar .tab-item').forEach((t,i)=>{
    const tabs=['total','online','offline'];
    t.classList.toggle('active',tabs[i]===tab);
  });
  const titles={total:t("shell.068", "\ud83d\udcca SKU\u52a8\u9500\u4e0e\u8ba2\u5355\u9884\u6d4b\uff08\u603b\u9884\u6d4b\uff09"),online:t("app.783", "\ud83d\uded2 \u7ebf\u4e0a\u9500\u91cf\u9884\u6d4b"),offline:t("app.784", "\ud83c\udfea \u7ebf\u4e0b\u9500\u91cf\u9884\u6d4b")};
  document.getElementById('rp-tab-title').textContent=titles[tab]||'';
  var poBtn=document.getElementById('rp-po-btn');
  if(poBtn){poBtn.style.display=(tab==='total')?'':'none';}
  saveRpPreferences();
  var viewKey=tab+'-'+rpMode;
  var cached=rpGetViewNode(viewKey);
  if(cached){
    rpSaveScroll(rpCurrentViewKey());
    rpShowView(viewKey);
    rpRestoreScroll(viewKey);
    rpTouchView(viewKey);
    updateRpFieldConfigBtn(tab);
    return;
  }
  loadRp();
  updateRpFieldConfigBtn(tab);
}
function switchRpMode(mode){
  var _t0=performance.now();
  rpMode=mode;
  document.querySelectorAll('.rp-mode-btn').forEach(b=>b.classList.remove('active'));
  event.target.classList.add('active');
  saveRpPreferences();
  var viewKey=rpTab+'-'+mode;
  var cached=rpGetViewNode(viewKey);
  if(cached){
    rpSaveScroll(rpCurrentViewKey());
    rpShowView(viewKey);
    rpRestoreScroll(viewKey);
    rpTouchView(viewKey);
    updateRpFieldConfigBtn(rpTab);
    return;
  }
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
async function loadRpSummary(){/* KPI指标卡已移除 */}
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
  var myViewKey='total-monthly';
  try{
    await getSalesStatsDays();
    var bUrl=rpBaseUrl();
    var msUrl=rpMonthlySalesUrl();
    var bResult=await rpFetchCached(bUrl);
    var msResult=await rpFetchCached(msUrl).catch(function(){return null;});
    var data=bResult;
    var monthlySales=(msResult&&msResult.success)?(msResult.data||{}):{};
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
      var avail = r.available_qty||0;
      var transit = r.in_transit_qty||0;
      var piUnshipped = r.pi_confirmed_unshipped_qty||0;
      c.pool=r.total_inventory_pool!=null?r.total_inventory_pool:(avail+transit+piUnshipped);
      c.ct=c.taPeriod>0?Math.round(c.pool/c.taPeriod*10)/10:0;
      c.ot=r.online_target_turnover||2;
      c.oft=r.offline_target_turnover||2;
      c.os=r.online_target_stock||0;
      c.ofs=r.offline_target_stock||0;
      c.ots=r.other_target_stock||0;
      c.sq=r.suggested_qty||0;
      c.po=r.po_unconfirmed_pi_qty||0;
      c.availTurnover = c.taPeriod>0 ? Math.round(avail/c.taPeriod*10)/10 : null;
      c.transitTurnover = c.taPeriod>0 ? Math.round((avail+transit)/c.taPeriod*10)/10 : null;
      c.afterOrderTurnover = c.taPeriod>0 ? Math.round((c.pool+c.po+c.sq)/c.taPeriod*10)/10 : null;
      c.piUnshipped = piUnshipped;
      // 月度销量按 sku_code|country 对齐行粒度（与 sales_m1..m4 的分组维度一致）
      c.monthly = monthlySales[r.sku_code+'|'+(r.country||'')] || {};
      r._c=c;
      window._rpRowData[r.id]=c;
    });
    // 列渲染器
    var Cols={
      check:{th:'<th style="width:36px"><input type="checkbox" class="rp-all" onchange="(function(el){el.closest(\'.rp-view-container\').querySelectorAll(\'.rp-ck\').forEach(function(c){c.checked=el.checked})})(this)"></th>',
        td:function(r,c){return '<td><input type="checkbox" class="rp-ck" value="'+r.id+'" data-sku="'+esc(r.sku_code)+'" data-qty="'+c.sq+'"></td>';},
        sum:function(total){return t('gen.L4049.1','<td class="text-center"><span style="font-size:11px;font-weight:700">合计</span></td>');}},
      model:{th:'<th>Model</th>',
        td:function(r,c){return '<td class="text-truncate" style="max-width:90px" title="'+esc(r.model||'')+'">'+esc(r.model||'')+'</td>';},
        sum:function(t){return '<td></td>';}},
      sku:{th:'<th style="min-width:120px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">SKU</th>',
        td:function(r,c){return '<td class="cell-id rp-sku-cell" style="min-width:120px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.sku_code||'')+'">'+esc(r.sku_code||'')+'</td>';},
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
      avail:{th:rpThCompact(t('app.767','当前可用\n库存'),'','text-right','',true),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(r.available_qty||0)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.avail)+'</td>';}},
      transit:{th:rpThCompact(t('app.768','在途\n库存'),'','text-right','',true),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(r.in_transit_qty||0)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.transit)+'</td>';}},
      po_unconfirmed:{th:rpThCompact(t('forecast.compact.po_unconfirmed','未确认\nPO'),t("app.796", "\u5df2\u7ecf\u521b\u5efa PO\uff0c\u4f46\u8fd8\u6ca1\u6709\u786e\u8ba4 PI \u7684\u6570\u91cf\u3002\u5c5e\u4e8e\u6f5c\u5728\u4f9b\u5e94\uff0c\u4e0d\u7b49\u4e8e\u4e00\u5b9a\u4f1a\u53d1\u8d27\u3002"),'text-right','',true),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(r.po_unconfirmed_pi_qty||0)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.po)+'</td>';}},
      pool:{th:rpTh(t("app.740", "\u603b\u5e93\u5b58\u6c60"),t("app.797", "\u5f53\u524d\u53ef\u7528\u5e93\u5b58 + \u5728\u9014\u5e93\u5b58 + PI/PO\u5df2\u786e\u8ba4\u672a\u53d1\u8d27\u3002\u672a\u786e\u8ba4PO\u4e0d\u8ba1\u5165\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right font-bold">'+formatQuantityDisplay(c.pool)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.pool)+'</td>';}},
      pi_unshipped:{th:rpThCompact(t('forecast.compact.pi_unshipped','已确认PI\n未发货'),t("app.800", "PI \u5df2\u786e\u8ba4\uff0c\u4f46\u5de5\u5382\u8fd8\u6ca1\u6709\u53d1\u8d27\u7684\u6570\u91cf\u3002\u6bd4 PO\u672a\u786e\u8ba4PI \u66f4\u63a5\u8fd1\u5b9e\u9645\u4f9b\u5e94\u3002"),'text-right','',true),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.piUnshipped)+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.piUnshipped)+'</td>';}},
      avail_turnover:{th:rpTh(t('gen.L4089.1','当前可用周转'),t("app.801", "\u5f53\u524d\u53ef\u7528\u5e93\u5b58 \u00f7 \u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002\u8868\u793a\u4e0d\u8003\u8651\u5728\u9014\u548c\u672a\u53d1\u8d27\u8ba2\u5355\u65f6\uff0c\u73b0\u6709\u5e93\u5b58\u5927\u7ea6\u8fd8\u80fd\u5356\u51e0\u4e2a\u6708\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right '+(c.availTurnover!==null?(c.availTurnover<2?'text-danger':c.availTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.availTurnover!==null?c.availTurnover:'-')+'</td>';},
        sum:function(t){return '<td class="text-right">'+(t.taPeriod>0?Math.round(t.availWS/t.taPeriod*10)/10:'-')+'</td>';}},
      transit_turnover:{th:rpTh(t("app.733", "\u5728\u9014\u5e93\u5b58\u5468\u8f6c"),t("app.802", "\uff08\u5f53\u524d\u53ef\u7528\u5e93\u5b58 + \u5728\u9014\u5e93\u5b58\uff09\u00f7 \u6708\u5747\u9500\u91cf\uff08\u9509\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002"),'text-right'),
        td:function(r,c){return '<td class="text-right '+(c.transitTurnover!==null?(c.transitTurnover<2?'text-danger':c.transitTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.transitTurnover!==null?c.transitTurnover:'-')+'</td>';},
        sum:function(t){return '<td class="text-right">'+(t.taPeriod>0?Math.round((t.availWS+t.transitWS)/t.taPeriod*10)/10:'-')+'</td>';}},
      after_order_turnover:{th:rpThCompact(t('forecast.compact.after_order_turnover','\u9884\u8ba1\u4e0b\u5355\u540e\n\u5468\u8f6c'),t("app.803", "\uff08\u5f53\u524d\u5e93\u5b58\u6c60 + \u672c\u6b21\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf\uff09\u00f7 \u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002"),'text-right','',true),
        td:function(r,c){return '<td class="text-right '+(c.afterOrderTurnover!==null?(c.afterOrderTurnover<2?'text-danger':c.afterOrderTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.afterOrderTurnover!==null?c.afterOrderTurnover:'-')+'</td>';},
        sum:function(t){return '<td class="text-right">'+(t.taPeriod>0?Math.round((t.poolWS+t.poWS+t.sqWS)/t.taPeriod*10)/10:'-')+'</td>';}},
      sales_status:{th:rpThCompact(t('forecast.compact.sales_status','销量\n状态'),t("app.804", "\u7cfb\u7edf\u6839\u636e\u9500\u91cf\u8d8b\u52bf\u3001\u5e93\u5b58\u72b6\u6001\u3001\u5e93\u5b58\u5468\u8f6c\u548c\u751f\u547d\u5468\u671f\u7efc\u5408\u5224\u65ad\u5f53\u524d SKU \u9500\u552e\u72b6\u6001\uff0c\u5e76\u81ea\u52a8\u9009\u62e9\u5bf9\u5e94\u8865\u8d27\u8ba1\u7b97\u65b9\u5f0f\u3002\u7528\u6237\u65e0\u9700\u7406\u89e3\u8ba1\u7b97\u89c4\u5219\uff0c\u53ea\u9700\u6839\u636e\u7cfb\u7edf\u5224\u65ad\u6267\u884c\u590d\u6838\u3001\u8865\u8d27\u6216\u505c\u6b62\u91c7\u8d2d\u3002"),'text-center','',true),
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
      suggestion:{th:rpThCompact(t('col.suggestion','建议\n说明'),'','','',true),
        td:function(r,c){return '<td class="rp-cell-wrap" title="'+esc(r.suggestion||'')+'">'+esc(r.suggestion||'')+'</td>';},
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
    // 月度销量列渲染器（纯展示：数据取自 sales_records 事实表，不参与任何预测计算）
    var rpMonthDefs=rpMonthColDefs();
    rpMonthDefs.forEach(function(md){
      Cols[md.key]={
        th:rpThCompact(esc(md.label),'','text-right','',true),
        td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(Number((c.monthly||{})[md.ym]||0))+'</td>';},
        sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(Number((t._monthly||{})[md.key]||0))+'</td>';}
      };
    });
    // 按配置过滤+排序（不追加隐藏字段，避免列错位）
    var config=getRpColConfig('total');
    var activeKeys=[];
    config.forEach(function(cfg){
      var col=Cols[cfg.key];
      if(col&&(cfg.visible||cfg.key==='check'||cfg.key==='sku'||cfg.key==='total_target_stock')){
        activeKeys.push(cfg.key);
      }
    });
    // 计算合计
    var totals={count:data.length,oa:0,ofa:0,oaPeriod:0,ofaPeriod:0,ta:0,taPeriod:0,avail:0,transit:0,po:0,piUnshipped:0,pool:0,os:0,ofs:0,sq:0,
      availWS:0,transitWS:0,poWS:0,piUnshippedWS:0,poolWS:0,sqWS:0,_monthly:{}};
    rpMonthDefs.forEach(function(md){totals._monthly[md.key]=0;});
    data.forEach(function(r){
      var c=r._c;
      rpMonthDefs.forEach(function(md){totals._monthly[md.key]+=Number((c.monthly||{})[md.ym]||0);});
      totals.oa+=c.oa;totals.ofa+=c.ofa;totals.oaPeriod+=c.oaPeriod;totals.ofaPeriod+=c.ofaPeriod;totals.ta+=c.ta;totals.taPeriod+=c.taPeriod;
      totals.avail+=(r.available_qty||0);totals.transit+=(r.in_transit_qty||0);totals.po+=(r.po_unconfirmed_pi_qty||0);totals.piUnshipped+=c.piUnshipped;totals.pool+=c.pool;
      totals.os+=c.os;totals.ofs+=c.ofs;
      totals.sq+=c.sq;
      if(c.taPeriod>0){
        totals.availWS+=(r.available_qty||0);
        totals.transitWS+=(r.in_transit_qty||0);
        totals.poWS+=(r.po_unconfirmed_pi_qty||0);
        totals.piUnshippedWS+=c.piUnshipped;
        totals.poolWS+=c.pool;
        totals.sqWS+=c.sq;
      }
    });
    addHistoricalColsToActive(activeKeys,Cols,totals,data);
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
    var html='<div class="table-container" style="box-shadow:none;border-radius:0;overflow:auto;max-height:70vh"><table class="data-table rp-monthly-table" style="width:'+rpColWidthTotal(activeKeys)+'px;min-width:'+rpColWidthTotal(activeKeys)+'px">'+rpColgroupHtml(activeKeys)+'<thead><tr style="height:34px">'+th+'</tr>'+sum+'</thead><tbody>'+rows+tableFoot+'</tbody></table></div>';
    var container=rpEnsureContainer(myViewKey);
    container.innerHTML=html;
    rpStoreViewNode(myViewKey,container);
    if(rpCurrentViewKey()===myViewKey){
      rpShowView(myViewKey);
      applyChannelFreezeColumns('total', activeKeys, container);
      syncRpHeaderHeight(container);
      initRpTableDrag('total', container);
    }
  }catch(e){showFlash(e.message,'danger')}
}

// 纯显示函数：用真实年月标识每个自然月（不影响日期/销售数据逻辑）
function formatMonthLabel(year, monthNumber, isCurrent){
  var ym=year+'-'+String(monthNumber).padStart(2,'0');
  var lang = (typeof getLang === 'function') ? getLang() : 'zh';
  if(lang === 'en'){
    return isCurrent ? (ym+' (This Month)') : ym;
  }
  if(lang === 'id'){
    return isCurrent ? (ym+' (Bulan Ini)') : ym;
  }
  return isCurrent ? (ym+'本月') : ym;
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

// ── PI 列表「发货状态」列（纯发货语义，不混入上传状态） ──
function computePIShipStatus(p) {
  if (p.pi_status === 'cancelled') return 'cancelled';
  const confirmed = Number(p.confirmed_qty_sum || p.total_confirmed_qty || 0);
  const shipped = Number(p.shipped_qty_sum || p.total_shipped_qty || 0);
  if (confirmed > 0 && shipped >= confirmed) return 'shipped_complete';
  if (shipped > 0 && shipped < confirmed) return 'partial_shipped';
  return 'pending_shipment';
}
function renderPIShipStatusBadge(p) {
  const st = computePIShipStatus(p);
  const map = {
    shipped_complete: ['status-completed', t('pi.ship_status.shipped_complete', '全部发货完成')],
    partial_shipped: ['status-warning', t('pi.ship_status.partial_shipped', '部分发货')],
    cancelled: ['status-cancelled', t('pi.ship_status.cancelled', '已取消')],
    pending_shipment: ['status-pending', t('pi.ship_status.pending_shipment', '未发货')]
  };
  const m = map[st] || map.pending_shipment;
  return '<span class="status-badge ' + m[0] + '">' + esc(m[1]) + '</span>';
}
// ==================== 物流状态展示层映射（5 态冻结，后端派生 logistics_display_status，前端只展示） ====================
// 展示状态键 → 中文标签
// 物流状态纯粹代表运输过程，不依赖 Inbound 事实
function logisticsStatusLabelByKey(displayKey) {
  switch (displayKey) {
    case 'pending_shipment':   return t('logistics.status.pending_shipment', '待出运');
    case 'in_transit':         return t('logistics.status.in_transit', '运输中');
    case 'customs_clearing':   return t('logistics.status.customs_clearing', '清关中');
    case 'awaiting_delivery':  return t('logistics.status.awaiting_delivery', '待派送');
    case 'warehouse_arrived':  return t('logistics.status.warehouse_arrived', '已到仓');
    default:                   return '—';
  }
}
// 展示状态键 → badge class
function logisticsStatusBadgeClassByKey(displayKey) {
  switch (displayKey) {
    case 'pending_shipment':   return 'status-pending';
    case 'in_transit':         return 'status-pending';
    case 'customs_clearing':   return 'status-warning';
    case 'awaiting_delivery':  return 'status-warning';
    case 'warehouse_arrived':  return 'status-completed';
    default:                   return 'status-pending';
  }
}
// 物流筛选下拉（展示状态键，传给后端 logistics_display_status 参数）
function logisticsFilterOptions(selected) {
  const opts = [
    { val: 'pending_shipment',   label: t('logistics.status.pending_shipment', '待出运') },
    { val: 'in_transit',         label: t('logistics.status.in_transit', '运输中') },
    { val: 'customs_clearing',   label: t('logistics.status.customs_clearing', '清关中') },
    { val: 'awaiting_delivery',  label: t('logistics.status.awaiting_delivery', '待派送') },
    { val: 'warehouse_arrived',  label: t('logistics.status.warehouse_arrived', '已到仓') }
  ];
  return opts.map(o => '<option value="' + o.val + '"' + (selected === o.val ? ' selected' : '') + '>' + o.label + '</option>').join('');
}
// 物流编辑下拉（底层 logistics_status 值，写入数据库）
// 人工可选择全部 5 个运输阶段，不包含"已入库"（入库状态由 Inbound 事实派生）
function logisticsEditOptions(selected) {
  const opts = [
    { val: 'pending',     label: t('logistics.status.pending_shipment', '待出运') },
    { val: 'in_transit',  label: t('logistics.status.in_transit', '运输中') },
    { val: 'customs',     label: t('logistics.status.customs_clearing', '清关中') },
    { val: 'delivering',  label: t('logistics.status.awaiting_delivery', '待派送') },
    { val: 'completed',   label: t('logistics.status.warehouse_arrived', '已到仓') }
  ];
  return opts.map(o => '<option value="' + o.val + '"' + (selected === o.val ? ' selected' : '') + '>' + o.label + '</option>').join('');
}

// ==================== 国家名称展示层映射（根据当前语言显示） ====================
// 数据库存储中文国家名，前端根据 i18n 语言映射为对应语言标签
function countryLabel(rawCountry) {
  if (!rawCountry) return '—';
  var key = 'country.' + rawCountry.replace(/\s+/g, '_').toLowerCase();
  var label = t(key, '');
  return label || rawCountry;
}

// ==================== CI 入库状态展示层派生（不修改底层 ci_status） ====================
function ciInboundStatusLabel(inboundDerivedStatus) {
  switch (inboundDerivedStatus) {
    case 'completed': return t('ci.inbound_status.completed', '已入库');
    case 'partial':   return t('ci.inbound_status.partial', '部分入库');
    default:          return t('ci.inbound_status.none', '未入库');
  }
}
function ciInboundStatusBadgeClass(inboundDerivedStatus) {
  switch (inboundDerivedStatus) {
    case 'completed': return 'status-completed';
    case 'partial':   return 'status-warning';
    default:          return 'status-pending';
  }
}

// PI 附件数组归一化（兼容历史单对象 / 数组 / 空值）
function normalizeAttachments(v) {
  try {
    const a = typeof v === 'string' ? JSON.parse(v) : v;
    if (Array.isArray(a)) return a.filter(x => x && x.dataUrl);
    if (a && a.dataUrl) return [a];
    return [];
  } catch (e) { return []; }
}
// ==================== 通用附件组件（v1.0.2：PI 列表先接入；CI/PO/PL/PAY/售后暂未迁移）====================
// 设计原则：不绑定任何业务字段/接口/权限；files 与 options 由调用方传入；复用全局 openModal/closeModal。
// 事件清理：统一 _attPreviewCleanup / _attUploaderCleanup，覆盖 Esc / 遮罩 / 关闭按钮 / 外部 closeModal 四路径。
// 拖拽事件使用具名 addEventListener / removeEventListener，绝不覆盖 window.ondragover / window.ondrop。

// ---- 通用工具 ----
function _attFmtSize(b){
  if(b==null||b==='')return '-';
  var n=Number(b); if(!n||n<0)return '-';
  if(n<1024)return n+' B';
  if(n<1048576)return (n/1024).toFixed(1)+' KB';
  return (n/1048576).toFixed(2)+' MB';
}
// dataUrl → blob URL（PDF 预览 / 下载用，避免 data: 协议在 iframe/下载受限）
function _attDataUrlToBlobUrl(dataUrl){
  try{
    var m=String(dataUrl||'').match(/^data:(.*?);base64,(.*)$/);
    if(!m) return dataUrl;
    var mime=m[1]||'application/octet-stream';
    var bin=atob(m[2]); var arr=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr],{type:mime}));
  }catch(e){ return dataUrl; }
}

// ---- 通用附件预览组件 ----
// openAttachmentPreview(files, options)
//   files: Array<{name,type,size,dataUrl}>
//   options: {title, startIndex, canDownload, onDownload, businessLabel}
var _attPreviewState=null; // {files, idx, opts, _escBound, _mo}

function openAttachmentPreview(files, options){
  var opts=options||{};
  var list=normalizeAttachments(files);
  if(!list.length){ showToast(t('att.no_files','暂无附件'),'warning'); return; }
  var start=Number(opts.startIndex)||0;
  if(start<0||start>=list.length)start=0;
  _attPreviewCleanup(); // 先清理可能残留的旧状态
  _attPreviewState={files:list, idx:start, opts:opts};
  // Esc 监听（具名，cleanup 时移除）
  _attPreviewState._escBound=function(e){ if(e.key==='Escape'||e.keyCode===27){ closeModal(); } };
  document.addEventListener('keydown', _attPreviewState._escBound);
  // modal 关闭监听（覆盖遮罩点击 / 右上角关闭 / 外部 closeModal）
  var ov=document.getElementById('modal-overlay');
  if(ov && typeof MutationObserver!=='undefined'){
    _attPreviewState._mo=new MutationObserver(function(muts){
      for(var i=0;i<muts.length;i++){
        if(muts[i].attributeName==='class' && !ov.classList.contains('show')){ _attPreviewCleanup(); return; }
      }
    });
    _attPreviewState._mo.observe(ov,{attributes:true,attributeFilter:['class']});
  }
  _attRenderPreview();
}

function _attRenderPreview(){
  var s=_attPreviewState; if(!s)return;
  var att=s.files[s.idx]; if(!att)return;
  var opts=s.opts||{};
  var name=att.name||t('common.attachment','附件');
  // 顶部工具条：当前文件名（单行省略 + hover 全文）+ 下载图标（右上角）
  var dlBtn=(opts.canDownload!==false)
    ? '<button class="btn btn-secondary btn-sm" onclick="_attDownloadCurrent()" title="'+t('att.download_current','下载当前附件')+'">\u2B07 '+t('common.download','下载')+'</button>'
    : '';
  var topBar='<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap">'
    +'<div style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#333" title="'+esc(name)+'">'+esc(name)+'</div>'
    +'<div style="flex:0 0 auto">'+dlBtn+'</div></div>';
  // 多附件切换标签（仅 >1 时显示；切换不重开弹窗、不重拉数据）
  var tabsHtml='';
  if(s.files.length>1){
    tabsHtml='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;border-bottom:1px solid #e8e8e8;padding-bottom:8px;overflow-x:auto">';
    for(var i=0;i<s.files.length;i++){
      var isActive=i===s.idx;
      var tabStyle=isActive
        ? 'font-weight:600;color:#1890ff;border-bottom:2px solid #1890ff;padding:2px 8px;cursor:pointer;white-space:nowrap'
        : 'color:#666;padding:2px 8px;cursor:pointer;white-space:nowrap';
      var tabName=s.files[i].name||(t('common.attachment','附件')+' '+(i+1));
      var tabDisplay=tabName.length>24?tabName.substring(0,21)+'...':tabName;
      tabsHtml+='<span style="'+tabStyle+'" title="'+esc(tabName)+'" onclick="_attSwitch('+i+')">'+esc(tabDisplay)+'</span>';
    }
    tabsHtml+='</div>';
  }
  var previewHtml=_attBuildPreviewContent(att);
  var title=opts.title||t('att.modal_title_preview','查看附件');
  var body=topBar+tabsHtml+previewHtml;
  var footer='<button class="btn btn-secondary" onclick="_attPreviewCleanup();closeModal()">'+t('att.close','关闭')+'</button>';
  openModal(title, body, footer, 'modal-lg');
}

function _attBuildPreviewContent(att){
  var type=(att.type||'').toLowerCase();
  var dataUrl=att.dataUrl||'';
  var name=att.name||'';
  // PDF：iframe 内联预览（blob URL 避免 data: 在部分浏览器受限）；固定高度避免双滚动条
  if(type==='application/pdf'||name.toLowerCase().endsWith('.pdf')){
    var pdfUrl=_attDataUrlToBlobUrl(dataUrl);
    return '<div style="width:100%;height:min(70vh,600px);"><iframe src="'+pdfUrl+'" style="width:100%;height:100%;border:0;" allowfullscreen></iframe></div>';
  }
  // 图片：保持比例，不拉伸
  if(type.indexOf('image/')===0||/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(name)){
    return '<div style="text-align:center;padding:10px;"><img src="'+dataUrl+'" style="max-width:100%;max-height:min(70vh,560px);object-fit:contain;border-radius:4px" alt="'+esc(name)+'" /></div>';
  }
  // 不支持格式：文件信息卡（仍保留上方下载图标，不报错）
  var sizeStr=_attFmtSize(att.size);
  return '<div style="text-align:center;padding:40px 20px;">'
    +'<div style="font-size:48px;margin-bottom:16px;">\uD83D\uDCC4</div>'
    +'<div style="font-weight:600;margin-bottom:8px;word-break:break-all">'+esc(name)+'</div>'
    +'<div style="color:#999;margin-bottom:4px">'+t('att.file_type','文件类型')+': '+esc(att.type||'-')+'</div>'
    +'<div style="color:#999;margin-bottom:16px">'+t('att.file_size','文件大小')+': '+sizeStr+'</div>'
    +'<div style="color:#999">'+t('att.preview_not_supported','此格式不支持在线预览，请使用上方下载按钮下载')+'</div>'
    +'</div>';
}

function _attSwitch(idx){
  if(!_attPreviewState)return;
  if(idx<0||idx>=_attPreviewState.files.length)return;
  _attPreviewState.idx=idx;
  _attRenderPreview();
}

function _attDownloadCurrent(){
  var s=_attPreviewState; if(!s)return;
  var att=s.files[s.idx]; if(!att)return;
  var opts=s.opts||{};
  if(typeof opts.onDownload==='function'){
    try{ opts.onDownload(att, s.idx); }catch(e){ showToast(e.message,'danger'); }
    return;
  }
  var link=document.createElement('a');
  link.href=att.dataUrl;
  link.download=att.name||t('common.attachment','附件');
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function _attPreviewCleanup(){
  if(!_attPreviewState)return;
  if(_attPreviewState._escBound) document.removeEventListener('keydown', _attPreviewState._escBound);
  if(_attPreviewState._mo) _attPreviewState._mo.disconnect();
  _attPreviewState=null;
}

// ---- 通用附件上传组件 ----
// openAttachmentUploader(options)
//   options: {existingFiles, multiple, accept, maxFileSize, maxFiles, uploadHandler, mergeStrategy, businessLabel, onSuccess}
var _attUploaderState=null; // {opts, queue:[], rejected:[], _escBound, _mo, _dz, _winOver, _winDrop}

function openAttachmentUploader(options){
  var opts=options||{};
  _attUploaderCleanup(); // 先清理可能残留的旧状态
  _attUploaderState={opts:opts, queue:[], rejected:[]};
  // Esc 监听
  _attUploaderState._escBound=function(e){ if(e.key==='Escape'||e.keyCode===27){ closeModal(); } };
  document.addEventListener('keydown', _attUploaderState._escBound);
  // modal 关闭监听（覆盖遮罩 / 右上角 / 外部 closeModal）
  var ov=document.getElementById('modal-overlay');
  if(ov && typeof MutationObserver!=='undefined'){
    _attUploaderState._mo=new MutationObserver(function(muts){
      for(var i=0;i<muts.length;i++){
        if(muts[i].attributeName==='class' && !ov.classList.contains('show')){ _attUploaderCleanup(); return; }
      }
    });
    _attUploaderState._mo.observe(ov,{attributes:true,attributeFilter:['class']});
  }
  _attRenderUploader();
}

function _attRenderUploader(){
  var s=_attUploaderState; if(!s)return;
  var opts=s.opts||{};
  var accept=opts.accept||'.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp';
  var title=opts.businessLabel||t('att.modal_title_upload','上传附件');
  // 拖拽区（静态，事件在 openModal 后具名绑定到元素）
  var dropZone='<div id="att-drop-zone" class="att-drop-zone">'
    +'<div style="font-size:32px;color:#1890ff;margin-bottom:6px">\uD83D\uDCC1</div>'
    +'<div style="font-size:13px;color:#333;margin-bottom:3px">'+t('att.drag_hint','将文件拖到此处')+'</div>'
    +'<div style="font-size:12px;color:#999">'+t('att.click_hint','或点击选择文件')+'</div>'
    +'</div>'
    +'<input type="file" id="att-file-input" '+(opts.multiple!==false?'multiple':'')+' accept="'+esc(accept)+'" style="display:none">';
  var body='<div class="att-uploader">'+dropZone+'<div id="att-file-list" class="att-file-list"></div><div id="att-upload-error" class="att-upload-error"></div></div>';
  var footer='<button class="btn btn-secondary" onclick="closeModal()">'+t('att.cancel','取消')+'</button>'
    +'<button id="att-upload-btn" class="btn btn-primary" onclick="_attDoUpload()">'+t('att.upload','上传')+'</button>';
  openModal(title, body, footer, 'modal-lg');
  _attBindDropZone();
  _attRenderFileList();
}

function _attBindDropZone(){
  var s=_attUploaderState; if(!s)return;
  var dz=document.getElementById('att-drop-zone');
  var fi=document.getElementById('att-file-input');
  if(dz){
    dz.onclick=function(){ if(fi) fi.click(); };
    var onEnter=function(e){ e.preventDefault(); e.stopPropagation(); dz.classList.add('att-drop-over'); };
    var onOver=function(e){ e.preventDefault(); e.stopPropagation(); if(!dz.classList.contains('att-drop-over')) dz.classList.add('att-drop-over'); };
    var onLeave=function(e){ e.preventDefault(); e.stopPropagation(); if(e.target===dz) dz.classList.remove('att-drop-over'); };
    var onDrop=function(e){ e.preventDefault(); e.stopPropagation(); dz.classList.remove('att-drop-over'); if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length){ _attAddFiles(e.dataTransfer.files); } };
    dz.addEventListener('dragenter',onEnter);
    dz.addEventListener('dragover',onOver);
    dz.addEventListener('dragleave',onLeave);
    dz.addEventListener('drop',onDrop);
    s._dz={el:dz, enter:onEnter, over:onOver, leave:onLeave, drop:onDrop};
  }
  if(fi){ fi.onchange=function(){ if(fi.files&&fi.files.length){ _attAddFiles(fi.files); } fi.value=''; }; }
  // 阻止 window 级拖拽默认（防止文件拖到弹窗外被浏览器打开）；具名 addEventListener，cleanup 时 removeEventListener
  s._winOver=function(e){ e.preventDefault(); };
  s._winDrop=function(e){ e.preventDefault(); };
  window.addEventListener('dragover', s._winOver);
  window.addEventListener('drop', s._winDrop);
}

// 解析 accept 字符串为 {exts:{}, mimes:{}}
function _attParseAccept(accept){
  var exts={}, mimes={};
  String(accept||'').split(',').forEach(function(tok){
    tok=tok.trim().toLowerCase();
    if(!tok)return;
    if(tok.charAt(0)==='.') exts[tok.substring(1)]=true;
    else if(tok.indexOf('/')!==-1) mimes[tok]=true;
  });
  return {exts:exts, mimes:mimes};
}

// 文件类型校验：有 MIME 结合 MIME，MIME 为空按扩展名；不得误拒绝浏览器未提供 MIME 的合法文件
function _attCheckFileType(file, spec){
  if(!spec) return true;
  var hasExt=false, hasMime=false;
  for(var k in spec.exts){ hasExt=true; break; }
  for(var m in spec.mimes){ hasMime=true; break; }
  if(!hasExt && !hasMime) return true; // 无限制
  var name=(file.name||'').toLowerCase();
  var ext='';
  var dot=name.lastIndexOf('.');
  if(dot>=0) ext=name.substring(dot+1);
  var mime=(file.type||'').toLowerCase();
  if(ext && spec.exts[ext]) return true; // 扩展名匹配 → 通过
  if(mime){
    if(spec.mimes[mime]) return true;
    for(var mm in spec.mimes){
      if(mm.charAt(mm.length-1)==='*' && mime.indexOf(mm.slice(0,-1))===0) return true;
    }
    return false; // MIME 非空但既不匹配扩展名也不匹配 MIME → 拒绝
  }
  return false; // MIME 为空 + 扩展名不匹配 → 拒绝
}

// 去重：同名 + 同大小
function _attIsDuplicate(file, list){
  var name=file.name||''; var size=Number(file.size)||0;
  for(var i=0;i<list.length;i++){
    var f=list[i];
    if((f.name||'')===name && (Number(f.size)||0)===size) return true;
  }
  return false;
}

function _attAddFiles(fileList){
  var s=_attUploaderState; if(!s)return;
  var opts=s.opts||{};
  var spec=_attParseAccept(opts.accept);
  var maxFileSize=Number(opts.maxFileSize)||0;
  var maxFiles=Number(opts.maxFiles)||0;
  var existing=(opts.existingFiles||[]).slice();
  for(var i=0;i<fileList.length;i++){
    var f=fileList[i];
    if(!_attCheckFileType(f, spec)){ s.rejected.push({name:f.name||'',size:f.size,reason:t('att.unsupported_format','格式不支持')}); continue; }
    if(maxFileSize>0 && f.size>maxFileSize){ s.rejected.push({name:f.name||'',size:f.size,reason:t('att.file_too_large','文件过大（超过 {v1}）',{v1:_attFmtSize(maxFileSize)})}); continue; }
    var allExisting=existing.concat(s.queue);
    if(_attIsDuplicate(f, allExisting)){ s.rejected.push({name:f.name||'',size:f.size,reason:t('att.duplicate','文件重复')}); continue; }
    if(maxFiles>0 && (existing.length + s.queue.length + 1) > maxFiles){ s.rejected.push({name:f.name||'',size:f.size,reason:t('att.too_many_files','文件数量超限（最多 {v1} 个）',{v1:maxFiles})}); continue; }
    s.queue.push({file:f, name:f.name, type:f.type, size:f.size, dataUrl:null, reading:false});
  }
  _attRenderFileList();
  // 异步读取 dataUrl（不阻塞 UI）
  s.queue.forEach(function(item){
    if(item.dataUrl||item.reading)return;
    item.reading=true;
    var r=new FileReader();
    r.onload=function(e){ item.dataUrl=e.target.result; item.reading=false; _attSyncUploadBtn(); };
    r.onerror=function(){ item.reading=false; };
    r.readAsDataURL(item.file);
  });
}

function _attOnFilesPicked(files){ _attAddFiles(files); }

function _attSyncUploadBtn(){
  var s=_attUploaderState; if(!s)return;
  var btn=document.getElementById('att-upload-btn');
  if(btn){
    var hasReady=s.queue.some(function(it){ return it.dataUrl&&!it.reading; });
    btn.disabled=!hasReady;
  }
}

function _attRenderFileList(){
  var s=_attUploaderState; if(!s)return;
  var el=document.getElementById('att-file-list');
  if(!el)return;
  var html='';
  if(s.queue.length){
    html+='<div style="font-size:12px;color:#666;margin:12px 0 6px;font-weight:600">'+t('att.pending_list','待上传文件')+' ('+s.queue.length+')</div>';
    html+='<div class="att-file-rows">';
    s.queue.forEach(function(it,idx){
      html+='<div class="att-file-row">'
        +'<div class="att-file-info"><span class="att-file-name" title="'+esc(it.name)+'">'+esc(it.name)+'</span>'
        +'<span class="att-file-meta">'+esc(it.type||'-')+' · '+_attFmtSize(it.size)+'</span></div>'
        +'<button class="btn btn-secondary btn-sm" onclick="_attRemoveQueue('+idx+')">'+t('att.remove','移除')+'</button>'
        +'</div>';
    });
    html+='</div>';
  }
  if(s.rejected.length){
    html+='<div style="font-size:12px;color:#d4380d;margin:12px 0 6px;font-weight:600">'+t('att.rejected_list','被拒绝文件')+' ('+s.rejected.length+')</div>';
    html+='<div class="att-file-rows">';
    s.rejected.forEach(function(it,idx){
      html+='<div class="att-file-row att-file-rejected">'
        +'<div class="att-file-info"><span class="att-file-name" title="'+esc(it.name)+'">'+esc(it.name)+'</span>'
        +'<span class="att-file-meta">'+_attFmtSize(it.size)+' · '+esc(it.reason)+'</span></div>'
        +'<button class="btn btn-secondary btn-sm" onclick="_attRemoveRejected('+idx+')">'+t('att.remove','移除')+'</button>'
        +'</div>';
    });
    html+='</div>';
  }
  if(!s.queue.length && !s.rejected.length){
    html='<div style="color:#999;font-size:13px;text-align:center;padding:16px 0">'+t('att.no_files','暂无附件')+'</div>';
  }
  el.innerHTML=html;
  _attSyncUploadBtn();
}

function _attRemoveQueue(idx){
  var s=_attUploaderState; if(!s)return;
  if(idx<0||idx>=s.queue.length)return;
  s.queue.splice(idx,1);
  _attRenderFileList();
}

function _attRemoveRejected(idx){
  var s=_attUploaderState; if(!s)return;
  if(idx<0||idx>=s.rejected.length)return;
  s.rejected.splice(idx,1);
  _attRenderFileList();
}

function _attDoUpload(){
  var s=_attUploaderState; if(!s)return;
  var opts=s.opts||{};
  var ready=s.queue.filter(function(it){ return it.dataUrl&&!it.reading; });
  if(!ready.length){ showToast(t('att.empty_queue','请先添加文件'),'warning'); return; }
  var btn=document.getElementById('att-upload-btn');
  if(btn){ btn.disabled=true; btn.textContent=t('att.uploading','上传中…'); } // 防重复提交；不伪造百分比
  // 合并：mergeStrategy 默认 merge（不覆盖旧附件）
  var existing=(opts.mergeStrategy==='replace')?[]:(opts.existingFiles||[]).slice();
  var merged=existing.concat(ready.map(function(it){
    return {name:it.name, type:it.type, size:it.size, dataUrl:it.dataUrl, uploaded_at:new Date().toISOString()};
  }));
  Promise.resolve().then(function(){ return opts.uploadHandler(merged); })
    .then(function(){
      _attUploaderCleanup();
      closeModal();
      if(typeof opts.onSuccess==='function') opts.onSuccess();
    })
    .catch(function(e){
      if(btn){ btn.disabled=false; btn.textContent=t('att.retry','重试'); } // 失败保留列表，允许重试
      var msg=(e&&e.message)||t('att.upload_failed','上传失败');
      showToast(msg,'danger');
      var errBox=document.getElementById('att-upload-error');
      if(errBox) errBox.textContent=msg;
    });
}

function _attUploaderCleanup(){
  if(!_attUploaderState)return;
  if(_attUploaderState._escBound) document.removeEventListener('keydown', _attUploaderState._escBound);
  if(_attUploaderState._mo) _attUploaderState._mo.disconnect();
  if(_attUploaderState._dz && _attUploaderState._dz.el){
    var d=_attUploaderState._dz;
    d.el.removeEventListener('dragenter',d.enter);
    d.el.removeEventListener('dragover',d.over);
    d.el.removeEventListener('dragleave',d.leave);
    d.el.removeEventListener('drop',d.drop);
  }
  if(_attUploaderState._winOver) window.removeEventListener('dragover', _attUploaderState._winOver);
  if(_attUploaderState._winDrop) window.removeEventListener('drop', _attUploaderState._winDrop);
  _attUploaderState=null;
}
// ==================== 通用附件组件 END ====================

// PI 列表「PI附件」单元格：未上传→待上传PI（可点击上传）；已上传→查看PI（弹窗预览）；多附件显示数量
function renderPIAttachmentCell(p) {
  const atts = normalizeAttachments(p.attachment);
  // 单元格固定宽度 + 长文件名省略 + hover 全文，避免撑开 PI 表
  var cellStyle = 'display:inline-block;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom';
  if (!atts.length) {
    return '<span class="link-text" style="color:#fa8c16;' + cellStyle + '" onclick="event.stopPropagation();uploadPIAttachmentInline(\'' + p.id + '\')">' + t('pi.attachment.pending', '待上传PI') + '</span>';
  }
  if (atts.length === 1) {
    var name = atts[0].name || t('pi.attachment.view', '查看PI');
    return '<span class="link-text" style="' + cellStyle + '" title="' + esc(name) + '" onclick="event.stopPropagation();piPreviewInline(\'' + p.id + '\')">' + esc(name) + '</span>';
  }
  var label = t('pi.attachment.view', '查看PI') + ' (' + atts.length + ')';
  return '<span class="link-text" style="' + cellStyle + '" title="' + esc(label) + '" onclick="event.stopPropagation();piPreviewInline(\'' + p.id + '\')">' + esc(label) + '</span>';
}
// PI 附件上传业务适配器：权限校验 + 拉取现有附件 + 调用通用上传组件 + 更新当前行（不刷新整张列表）
async function uploadPIAttachmentInline(id) {
  if (!hasPermission('pi_edit')) { showToast(t('toast.uploadNoPermission', '无附件上传权限'), 'danger'); return; }
  try {
    const pi = await api('/api/proforma-invoices/' + id);
    const existing = normalizeAttachments(pi.attachment);
    openAttachmentUploader({
      existingFiles: existing,
      multiple: true,
      accept: '.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp',
      maxFileSize: 20 * 1024 * 1024, // PI 限制作为调用参数，不固化为全系统规则
      maxFiles: 20,
      mergeStrategy: 'merge', // 合并旧附件，不覆盖
      businessLabel: t('pi.field.attachment', 'PI附件'),
      uploadHandler: async function (merged) {
        await api('/api/proforma-invoices/' + id + '/attachment', 'POST', { attachment: merged });
      },
      onSuccess: async function () {
        // 上传接口仅返回 {success:true}，无最新附件数据 → GET 单条 PI 更新当前行；不刷新整张 PI 列表
        const cell = document.getElementById('pi-att-' + id);
        if (cell) { const fresh = await api('/api/proforma-invoices/' + id); cell.innerHTML = renderPIAttachmentCell(fresh); }
        showToast(t('att.upload_ok', '附件已上传'), 'success');
      }
    });
  } catch (e) { showToast(e.message, 'danger'); }
}

// PI 附件预览业务适配器：拉取 PI 数据 → 调用通用预览组件（不打开新标签页）
async function piPreviewInline(id, startIndex) {
  try {
    const d = await api('/api/proforma-invoices/' + id);
    const atts = normalizeAttachments(d.attachment);
    if (!atts.length) { showToast(t('att.no_files', '暂无附件'), 'warning'); return; }
    openAttachmentPreview(atts, {
      title: t('pi.preview_title', '查看 PI \u2014 {v1}').replace('{v1}', d.pi_no || id),
      startIndex: startIndex || 0,
      canDownload: true,
      businessLabel: t('pi.field.attachment', 'PI附件')
    });
  } catch (e) { showToast(e.message, 'danger'); }
}

// PI 定金付款状态枚举展示层映射（仅显示用，不写回 DB / 不参与状态机判断）
function piNeedsDeposit(value) {
  return value === true || value === 1 || value === '1';
}
// UI 只暴露三个业务态：无需定金 / 待付款 / 已付款。
// 该字段后端有两套枚举来源（server.js 列表 SELECT 用 COALESCE 覆盖）：
//   ① PI 旧枚举：none / unpaid / pending_approval / partial / paid
//   ② Payment Core payable_items.lifecycle_status：active / reserved / partially_paid / paid / cancelled / released
// 展示层统一收敛，禁止把任何内部枚举值透出到界面（原 default 分支会原样回显 active）。
// 仅改文案：不写回 DB、不参与状态机判断、不影响付款流程；badge 配色仍由调用处按 ==='paid' 判定。
function formatPIDepositStatus(status) {
  var s = (status == null ? '' : String(status)).trim().toLowerCase();
  if (s === 'none') return t('pi.deposit_status.none', '无需定金');
  if (s === 'paid') return t('pi.deposit_status.paid', '已付款');
  // 其余（unpaid / pending_approval / partial / active / reserved / partially_paid / cancelled / released / 空值）
  // 一律归为「待付款」——业务语义即「需要定金但尚未付清」。
  return t('pi.deposit_status.pending', '待付款');
}

// 线上/线下预测 + 按月：设置目标周转
async function loadRpChannelMonthly(channel){
  var myViewKey=channel+'-monthly';
  var isOnline=channel==='online';
  var chLabel=isOnline?t('gen.L4185.1','线上'):t('gen.L4185.2','线下');
  var now=new Date();
  var ml=[];
  for(var i=3;i>=0;i--){
    var d=new Date(now.getFullYear(),now.getMonth()-i,1);
    ml.push(formatMonthLabel(d.getFullYear(),d.getMonth()+1,i===0));
  }
  try{
    await getSalesStatsDays();
    var data=await rpFetchCached(rpBaseUrl());
    // 预处理
    // 月份字段语义统一约定：m1=本月，m2=上月，m3=上上月，m4=当前四个月窗口中的最早自然月。
    // 表头从左到右：真实年月(m4) → 真实年月(m3) → 真实年月(m2) → 真实年月本月(m1)。

    // 统一 Effective Allocation 计算（纯函数，无任何 DOM / DB 依赖）
    // 输入：
    //   transitTotal : inventory.in_transit_qty（实时在途事实）
    //   manualOnline / manualOffline : Raw Manual Allocation = 用户当前最后一次保存的人工在途分配意图（保留，本轮不动库）
    //   allocStatus  : channel_allocation_status（'allocated' 时走原自动拆分）
    //   onlinePct    : resolved_online_pct（仅 allocated 自动拆分时使用）
    // 不变量（永久成立）：
    //   0 <= effectiveOnline, 0 <= effectiveOffline, 0 <= unallocatedTransit
    //   effectiveOnline + effectiveOffline <= transitTotal
    //   effectiveOnline + effectiveOffline + unallocatedTransit = transitTotal
    // 冻结原则：当前 effective allocation 永远不得超过当前实时 inventory.in_transit_qty。
    function computeEffectiveTransitAllocation(transitTotal, manualOnline, manualOffline, allocStatus, onlinePct) {
      var transit = Math.max(0, Math.floor(Number(transitTotal) || 0));
      var mo = Math.max(0, Math.floor(Number(manualOnline) || 0));
      var mf = Math.max(0, Math.floor(Number(manualOffline) || 0));
      var hasManual = mo > 0 || mf > 0;
      var manualTotal = mo + mf;
      var effectiveOnline = 0, effectiveOffline = 0;

      if (transit <= 0) {
        // 实时在途为 0：无论如何 effective 必须为 0（Raw Manual 保留，仅显示/派生归零）
        effectiveOnline = 0;
        effectiveOffline = 0;
      } else if (hasManual) {
        if (manualTotal <= transit) {
          // 人工总量未超当前在途 → 原值保留，剩余进 unallocated
          effectiveOnline = mo;
          effectiveOffline = mf;
        } else {
          // 部分到仓：按原人工比例同比例缩减到 transitTotal（确定性最大余数规则）
          var exactOnline = transit * mo / manualTotal;
          var exactOffline = transit * mf / manualTotal;
          var floorOnline = Math.floor(exactOnline);
          var floorOffline = Math.floor(exactOffline);
          var remainder = transit - (floorOnline + floorOffline); // 0 或 1
          if (remainder > 0) {
            var fracOnline = exactOnline - floorOnline;
            var fracOffline = exactOffline - floorOffline;
            // 余数给 fractional remainder 较大的一方；完全相等时固定给 online（明确 tie-break）
            if (fracOffline > fracOnline) floorOffline += remainder;
            else floorOnline += remainder;
          }
          effectiveOnline = floorOnline;
          effectiveOffline = floorOffline;
        }
      } else if (allocStatus === 'allocated') {
        // 无人工：保持现有 allocated / onlinePct 自动拆分逻辑不变
        var pct = (onlinePct != null) ? Number(onlinePct) : 0;
        effectiveOnline = Math.round(transit * pct / 100);
        effectiveOffline = Math.round(transit * (100 - pct) / 100);
      } else {
        effectiveOnline = 0;
        effectiveOffline = 0;
      }

      // 防御性钳制（理论上上述分支已保证不变量，仅保底）
      if (effectiveOnline < 0) effectiveOnline = 0;
      if (effectiveOffline < 0) effectiveOffline = 0;
      if (effectiveOnline + effectiveOffline > transit) {
        effectiveOffline = transit - effectiveOnline;
        if (effectiveOffline < 0) { effectiveOffline = 0; effectiveOnline = transit; }
      }
      var unallocatedTransit = Math.max(0, transit - effectiveOnline - effectiveOffline);

      return { effectiveOnline: effectiveOnline, effectiveOffline: effectiveOffline, unallocatedTransit: unallocatedTransit };
    }

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
      // CHANNEL-ALLOCATION: 渠道分配模型 — 当已解析渠道占比时，使用解析值替代销量占比
      if (r.channel_allocation_status === 'allocated' && r.resolved_online_pct != null) {
        pctPeriod = isOnline ? r.resolved_online_pct : (100 - r.resolved_online_pct);
        pct = pctPeriod; // 同步覆盖4m口径分摊，保持一致
      }
      var availTotal=r.available_qty||0;
      var transitTotal=r.in_transit_qty||0;
      var piUnshippedTotal=r.pi_confirmed_unshipped_qty||0;
      var pool=r.total_inventory_pool!=null?r.total_inventory_pool:(availTotal+transitTotal+piUnshippedTotal);
      var allocatedStock=Math.round(pool*(pctPeriod/100)); // P4: period 分摊，供渠道建议采购显示与反推 target_stock
      // 渠道分摊库存（按销量占比分摊，不真正拆分库存；仅用于线上/线下测算口径）
      var availAllocated=Math.round(availTotal*(pct/100));
      var transitAllocated=Math.round(transitTotal*(pct/100));
      var piUnshippedAllocated=Math.round(piUnshippedTotal*(pct/100));
      r._c.salesM1=salesM1; r._c.salesM2=salesM2; r._c.salesM3=salesM3; r._c.salesM4=salesM4;
      r._c.avgSales=avgSales; r._c.totalAvg=totalAvg; r._c.pct=pct; r._c.pctPeriod=pctPeriod; r._c.avgSalesPeriod=avgSalesPeriod; r._c.totalAvgPeriod=totalAvgPeriod;
      r._c.channelRatioSource = r.channel_ratio_source || '';
      r._c.channelAllocationStatus = r.channel_allocation_status || '';
      r._c.pool=pool; r._c.allocatedStock=allocatedStock;
      r._c.transit=transitTotal; r._c.po=r.po_unconfirmed_pi_qty||0; r._c.avail=availTotal;
      r._c.availAllocated=availAllocated; r._c.transitAllocated=transitAllocated; r._c.piUnshippedAllocated=piUnshippedAllocated;
      r._c.targetTurn=targetTurn; r._c.targetStock=targetStock; r._c.remark=remark;
      r._c.piUnshipped = piUnshippedTotal;
      // 建议采购数量：单源口径，直接读后端落库的渠道分量（三页统一，不再前端重算）
      r._c.suggestedQty = isOnline ? (r.online_suggested_qty||0) : (r.offline_suggested_qty||0);
      // 三周转指标（基于渠道月均 + 渠道分摊库存，口径：可用+在途，不含PI未发货）
      // 当前可用周转：用 period 口径分摊库存 ÷ 渠道月均(period)，消除 4m分摊÷period月均 的混合口径
      // 分摊库存为库存数量，按整数展示
      // 有效在途分配(effectiveTransitAllocated)参与库存池和周转计算，非纯展示
      // 未分配在途是双渠道共享池，人工输入消耗该共享池
      var availAllocatedPeriod = Math.round(availTotal*(pctPeriod/100));
      var transitAllocatedPeriod = Math.round(transitTotal*(pctPeriod/100)); // 自动分摊在途（参考值）
      var piUnshippedAllocatedPeriod = Math.round(piUnshippedTotal*(pctPeriod/100));
      var poAllocatedPeriod = Math.round((r.po_unconfirmed_pi_qty||0)*(pctPeriod/100));
      // 双渠道有效在途分配：人工配置是对自动分配的整体业务替代
      // 一旦存在任意人工分配，SKU整体进入人工模式，未填写渠道默认0
      // 共享未分配池 = 在途总库存 - 线上有效分配 - 线下有效分配
      var manualOnline = r.manual_online_transit_qty||0;
      var manualOffline = r.manual_offline_transit_qty||0;
      var hasManualAllocation = manualOnline > 0 || manualOffline > 0;
      // Raw Manual Allocation = 用户当前最后一次保存的人工在途分配意图（保留，本轮不动库）
      // Effective Allocation = 按实时 transitTotal 实时派生，永不超过当前在途
      var _eff = computeEffectiveTransitAllocation(transitTotal, manualOnline, manualOffline, r.channel_allocation_status, r.resolved_online_pct);
      var effectiveOnline = _eff.effectiveOnline;
      var effectiveOffline = _eff.effectiveOffline;
      var effectiveTransitAllocated = isOnline ? effectiveOnline : effectiveOffline;
      // 共享未分配在途池（>=0，恒等于 transitTotal - effectiveOnline - effectiveOffline）
      var transitUnallocated = _eff.unallocatedTransit;
      // 当前渠道可分配上限
      // 人工模式：在途总库存 - 另一渠道人工值（另一渠道已锁定为人工值）
      // 自动模式：在途总库存（输入任意正数将进入人工模式，另一渠道归0，可覆盖全部在途库存）
      var maxAvailableTransit;
      if(hasManualAllocation){
        maxAvailableTransit = isOnline
          ? Math.max(0, transitTotal - manualOffline)
          : Math.max(0, transitTotal - manualOnline);
      }else{
        maxAvailableTransit = transitTotal;
      }
      // 渠道库存池=分摊可用+有效在途分配+分摊PI未发货+分摊PO（使用 effectiveTransitAllocated）
      var poolAllocatedPeriod = availAllocatedPeriod+effectiveTransitAllocated+piUnshippedAllocatedPeriod+poAllocatedPeriod;
      r._c.poolAllocatedPeriod = poolAllocatedPeriod;
      r._c.piUnshippedAllocatedPeriod = piUnshippedAllocatedPeriod;
      r._c.poAllocatedPeriod = poAllocatedPeriod;
      r._c.availAllocatedPeriod = availAllocatedPeriod;
      r._c.transitAllocatedPeriod = transitAllocatedPeriod; // 保留自动分摊值供参考
      r._c.effectiveTransitAllocated = effectiveTransitAllocated; // 有效在途分配，参与计算
      r._c.transitTotalDisplay = transitTotal;
      r._c.transitUnallocated = transitUnallocated; // 共享未分配池（双渠道一致）
      r._c.maxAvailableTransit = maxAvailableTransit; // 当前渠道可分配上限
      r._c.availTurnover = avgSalesPeriod>0 ? Math.round(availAllocatedPeriod/avgSalesPeriod*10)/10 : null;
      r._c.currentTurn = avgSalesPeriod>0 ? Math.round(poolAllocatedPeriod/avgSalesPeriod*10)/10 : t("app.799", "\u65e0\u9500\u91cf");
      r._c.transitTurnover = avgSalesPeriod>0 ? Math.round((availAllocatedPeriod+effectiveTransitAllocated)/avgSalesPeriod*10)/10 : null;
      r._c.afterOrderTurnover = avgSalesPeriod>0 ? Math.round((poolAllocatedPeriod+r._c.suggestedQty)/avgSalesPeriod*10)/10 : null;
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
    Cols.sku={th:'<th style="min-width:120px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">SKU</th>',
      td:function(r,c){return '<td class="cell-id rp-sku-cell" style="min-width:120px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(r.sku_code||'')+'">'+esc(r.sku_code||'')+'</td>';},
      sum:function(total){return '<td><span style="font-size:10px;color:#888">'+total.count+t('gen.L4269.1','个SKU</span></td>');}};
    Cols.sales_m4={th:rpThCompact(ml[0],'','text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.salesM4)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.salesM4)+'</td>';}};
    Cols.sales_m3={th:rpThCompact(ml[1],'','text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.salesM3)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.salesM3)+'</td>';}};
    Cols.sales_m2={th:rpThCompact(ml[2],'','text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.salesM2)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.salesM2)+'</td>';}};
    Cols.sales_m1={th:rpThCompact(ml[3],'','text-right','',true),
      td:function(r,c){return '<td class="text-right font-bold">'+formatQuantityDisplay(c.salesM1)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.salesM1)+'</td>';}};
    Cols.channel_avg={th:rpThCompact(rpSalesStatsDays+t('gen.L3457.2','天月均销量'),'',t('forecast.help.channel_avg_sales','按"预测参数设置"中的销量统计周期计算：近{days}天有效销量 ÷ 周期月数；60/90/120天分别除以2/3/4。',{days:rpSalesStatsDays}),'text-right','',true),
      td:function(r,c){return '<td class="text-right font-bold">'+formatQuantityDisplay(c.avgSalesPeriod)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.avgSalesPeriod)+'</td>';}};
    Cols.channel_pct={th:rpThCompact(t('forecast.compact.sales_share','销量\n占比'),t("app.811", "\u8be5\u6e20\u9053\u5728\u5f53\u524d\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u5185\u7684\u6708\u5747\u9500\u91cf\u5360\u603b\u6708\u5747\u9500\u91cf\u7684\u6bd4\u4f8b\uff0c\u7528\u4e8e\u5c55\u793a\u6e20\u9053\u9500\u552e\u7ed3\u6784\u3002\u91c7\u8d2d\u5efa\u8bae\u7531\u5171\u4eab\u5e93\u5b58\u6c60\u4e0e\u7ebf\u4e0a/\u7ebf\u4e0b\u76ee\u6807\u5e93\u5b58\u7edf\u4e00\u8ba1\u7b97\u3002"),'text-right','',true),
      td:function(r,c){
        if(c.channelAllocationStatus==='allocated'){
          var srcLabel = c.channelRatioSource==='recent_sales' ? '' :
                         c.channelRatioSource==='historical_sales' ? '<span class="channel-src-badge" style="font-size:10px;color:#888;margin-left:2px">('+t('forecast.channel.historical','历史')+')<span>' :
                         c.channelRatioSource==='pre_stockout' ? '<span class="channel-src-badge" style="font-size:10px;color:#888;margin-left:2px">('+t('forecast.channel.pre_stockout','缺货前')+')<span>' :
                         c.channelRatioSource==='manual_config' ? '<span class="channel-src-badge" style="font-size:10px;color:#888;margin-left:2px">('+t('forecast.channel.manual','人工')+')<span>' : '';
          return '<td class="text-right">'+Math.round(c.pctPeriod)+'%'+srcLabel+'</td>';
        }
        if(c.channelAllocationStatus==='unallocated'){
          return '<td class="text-right text-muted" style="font-size:11px">'+t('forecast.channel.unallocated','未分配')+'</td>';
        }
        return '<td class="text-right">'+(c.totalAvgPeriod>0?Math.round(c.pctPeriod)+'%':'-')+'</td>';
      },
      sum:function(t){return '<td class="text-right">'+(t.totalAvgPeriod>0?Math.round(t.avgSalesPeriod/t.totalAvgPeriod*100)+'%':'-')+'</td>';}};
    Cols.transit_allocated={th:rpThCompact(t('forecast.compact.allocated_in_transit','在途库存（已分配）'),t('forecast.help.allocated_in_transit','按{channel}销量统计周期占比，从总在途库存中分摊给该渠道的数量。在途总库存>0时可手动输入分配数量，输入值消耗共享未分配在途池，人工分配可随时修改。',{channel:chLabel}),'text-right','',true),
      td:function(r,c){
        // 只要存在在途库存，就显示人工分配入口（允许覆盖自动分配或修改已有人工分配）
        if((c.transitTotalDisplay||0) > 0){
          var maxAvail=c.maxAvailableTransit||0;
          return '<td class="text-right" style="padding:2px 4px">'
            +'<input type="number" min="0" max="'+maxAvail+'" class="rp-transit-manual" data-rid="'+r.id+'" value="'+(c.effectiveTransitAllocated||0)+'" style="width:60px;text-align:right;padding:2px 4px;border:1px solid #ddd;border-radius:3px" onchange="saveTransitAllocation(\''+r.id+'\',\''+channel+'\',this.value)">'
            +'</td>';
        }
        return '<td class="text-right">'+formatQuantityDisplay(c.effectiveTransitAllocated||0)+'</td>';
      },
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.effectiveTransitAllocated)+'</td>';}};
    Cols.transit_total={th:rpThCompact(t('forecast.compact.transit_total','在途总库存'),t('forecast.help.transit_total','该SKU的全部在途库存总量（不分渠道）。'),'text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.transitTotalDisplay||0)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.transitTotalDisplay)+'</td>';}};
    Cols.transit_unallocated={th:rpThCompact(t('forecast.compact.transit_unallocated','未分配在途'),t('forecast.help.transit_unallocated','在途总库存减去线上和线下已分配数量后的剩余共享池。'),'text-right','',true),
      td:function(r,c){return '<td class="text-right rp-transit-unallocated-cell">'+formatQuantityDisplay(c.transitUnallocated||0)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.transitUnallocated)+'</td>';}};
    Cols.po_unconfirmed={th:rpThCompact(t('forecast.compact.po_unconfirmed','未确认\nPO'),t("app.796", "\u5df2\u7ecf\u521b\u5efa PO\uff0c\u4f46\u8fd8\u6ca1\u6709\u786e\u8ba4 PI \u7684\u6570\u91cf\u3002\u5c5e\u4e8e\u6f5c\u5728\u4f9b\u5e94\uff0c\u4e0d\u7b49\u4e8e\u4e00\u5b9a\u4f1a\u53d1\u8d27\u3002"),'text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.poAllocatedPeriod||0)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.poAllocatedPeriod)+'</td>';}};
    Cols.avail={th:rpThCompact(t('forecast.compact.allocated_available','可用库存'),t('forecast.help.allocated_available','按{channel}销量统计周期占比，从总可用库存中分摊给该渠道的数量（仅测算用，非独立仓库库存）。',{channel:chLabel}),'text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.availAllocatedPeriod||0)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.availAllocatedPeriod)+'</td>';}};
    Cols.pi_unshipped={th:rpThCompact(t('forecast.compact.pi_unshipped','已确认PI\n未发货'),t("app.800", "PI \u5df2\u786e\u8ba4\uff0c\u4f44\u5de5\u5382\u8fd8\u6ca1\u6709\u53d1\u8d27\u7684\u6570\u91cf\u3002\u6bd4 PO\u672a\u786e\u8ba4PI \u66f4\u63a5\u8fd1\u5b9e\u9645\u4f9b\u5e94\u3002"),'text-right','',true),
      td:function(r,c){return '<td class="text-right">'+formatQuantityDisplay(c.piUnshippedAllocatedPeriod||0)+'</td>';},
      sum:function(t){return '<td class="text-right">'+formatQuantityDisplay(t.piUnshippedAllocatedPeriod)+'</td>';}},
    Cols.avail_turnover={th:rpTh(t('gen.L4306.1','当前可用周转'),t("app.801", "\u5f53\u524d\u53ef\u7528\u5e93\u5b58 \u00f7 \u6708\u5747\u9500\u91cf\uff08\u9500\u91cf\u7edf\u8ba1\u5468\u671f\u53e3\u5f84\uff09\u3002\u8868\u793a\u4e0d\u8003\u8651\u5728\u9014\u548c\u672a\u53d1\u8d27\u8ba2\u5355\u65f6\uff0c\u73b0\u6709\u5e93\u5b58\u5927\u7ea6\u8fd8\u80fd\u5356\u51e0\u4e2a\u6708\u3002"),'text-right'),
      td:function(r,c){return '<td class="text-right '+(c.availTurnover!==null?(c.availTurnover<2?'text-danger':c.availTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.availTurnover!==null?c.availTurnover:'-')+'</td>';},
      sum:function(t){return '<td class="text-right">'+(t.avgSalesPeriod>0?Math.round(t.availWS/t.avgSalesPeriod*10)/10:'-')+'</td>';}};
    Cols.transit_turnover={th:rpTh(t("app.733", "\u5728\u9014\u5e93\u5b58\u5468\u8f6c"),t("app.802", "\uff08\u5f53\u524d\u53ef\u7528\u5e93\u5b58 + \u5728\u9014\u5e93\u5b58\uff09\u00f7 \u5f53\u524d\u9884\u6d4b\u5468\u671f\u6708\u5747\u9500\u91cf\u3002"),'text-right'),
      td:function(r,c){return '<td class="text-right '+(c.transitTurnover!==null?(c.transitTurnover<2?'text-danger':c.transitTurnover>6?'text-secondary':'text-success'):'text-muted')+'">'+(c.transitTurnover!==null?c.transitTurnover:'-')+'</td>';},
      sum:function(t){return '<td class="text-right">'+(t.avgSalesPeriod>0?Math.round((t.availWS+t.transitWS)/t.avgSalesPeriod*10)/10:'-')+'</td>';}};
    Cols.after_order_turnover={th:rpThCompact(t('forecast.compact.after_order_turnover','\u9884\u8ba1\u4e0b\u5355\u540e\n\u5468\u8f6c'),t("app.803", "\uff08\u5f53\u524d\u5e93\u5b58\u6c60 + \u672c\u6b21\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf\uff09\u00f7 \u5f53\u524d\u9884\u6d4b\u5468\u671f\u6708\u5747\u9509\u91cf\u3002"),'text-right','',true),
      td:function(r,c){return '<td class="text-right rp-after-order-turn" data-rid="'+r.id+'" '+(c.afterOrderTurnover!==null?(c.afterOrderTurnover<2?'text-danger':c.afterOrderTurnover>6?'text-secondary':'text-success'):'text-muted')+'>'+(c.afterOrderTurnover!==null?c.afterOrderTurnover:'-')+'</td>';},
      sum:function(t){return '<td class="text-right">'+(t.avgSalesPeriod>0?Math.round((t.availWS+t.transitWS+t.poWS+t.piUnshippedWS+t.suggestedQtyWS)/t.avgSalesPeriod*10)/10:'-')+'</td>';}};
    Cols.sales_status={th:rpThCompact(t('forecast.compact.sales_status','销量\n状态'),t("app.804", "\u7cfb\u7edf\u6839\u636e\u9500\u91cf\u8d8b\u52bf\u3001\u5e93\u5b58\u72b6\u6001\u3001\u5e93\u5b58\u5468\u8f6c\u548c\u751f\u547d\u5468\u671f\u7efc\u5408\u5224\u65ad\u5f53\u524d SKU \u9500\u552e\u72b6\u6001\uff0c\u5e76\u81ea\u52a8\u9009\u62e9\u5bf9\u5e94\u8865\u8d27\u8ba1\u7b97\u65b9\u5f0f\u3002\u7528\u6237\u65e0\u9700\u7406\u89e3\u8ba1\u7b97\u89c4\u5219\uff0c\u53ea\u9700\u6839\u636e\u7cfb\u7edf\u5224\u65ad\u6267\u884c\u590d\u6838\u3001\u8865\u8d27\u6216\u505c\u6b62\u91c7\u8d2d\u3002"),'text-center','',true),
      td:function(r,c){return '<td class="text-center rp-sales-status-cell"><span class="status-badge">'+formatForecastSalesStatus(r.sales_status||'')+'</span></td>';},
      sum:function(t){return '<td class="text-center"></td>';}};
    Cols.risk_tags={th:rpThCompact(t('forecast.compact.risk_tags','风险\n标签'),'','','text-center','',true),
      td:function(r,c){return '<td class="rp-cell-wrap text-center rp-risk-tags-cell">'+formatForecastRiskTags(r.risk_tags||'')+'</td>';},
      sum:function(t){return '<td class="text-center"></td>';}};
    Cols.action_rec={th:rpThCompact(t('forecast.compact.action_rec','建议\n操作'),t("app.805", "\u7cfb\u7edf\u6839\u636e\u52a8\u9500\u5224\u65ad\u7ed9\u51fa\u7684\u64cd\u4f5c\u5efa\u8bae\uff0c\u4f8b\u5982\u4f18\u5148\u8865\u8d27\u3001\u8c28\u614e\u8865\u8d27\u3001\u6682\u505c\u8865\u8d27\u3001\u4eba\u5de5\u590d\u6838\u3002"),'','',true),
      td:function(r,c){return '<td class="rp-cell-wrap" title="'+esc(r.action||'')+'">'+formatForecastAction(r.action||'')+'</td>';},
      sum:function(t){return '<td></td>';}};
    Cols.suggestion={th:rpThCompact(t('col.suggestion','建议\n说明'),'','','',true),
      td:function(r,c){return '<td class="rp-cell-wrap" title="'+esc(r.suggestion||'')+'">'+esc(r.suggestion||'')+'</td>';},
      sum:function(t){return '<td></td>';}};
    // 动销判断 = 动销状态 ｜ 风险标签（前端合并展示）
    Cols.sales_judgement={th:rpThCompact(t('forecast.compact.sales_judgement','动销\n判断'),t("app.804", "\u7cfb\u7edf\u6839\u636e\u9500\u91cf\u8d8b\u52bf\u3001\u5e93\u5b58\u72b6\u6001\u3001\u5e93\u5b58\u5468\u8f6c\u548c\u751f\u547d\u5468\u671f\u7efc\u5408\u5224\u65ad\u5f53\u524d SKU \u9500\u552e\u72b6\u6001\uff0c\u5e76\u81ea\u52a8\u9009\u62e9\u5bf9\u5e94\u8865\u8d27\u8ba1\u7b97\u65b9\u5f0f\u3002\u7528\u6237\u65e0\u9700\u7406\u89e3\u8ba1\u7b97\u89c4\u5219\uff0c\u53ea\u9700\u6839\u636e\u7cfb\u7edf\u5224\u65ad\u6267\u884c\u590d\u6838\u3001\u8865\u8d27\u6216\u505c\u6b62\u91c7\u8d2d\u3002"),'','',true),
      td:function(r,c){return '<td class="rp-movement-cell" style="min-width:150px;max-width:180px">'+buildSalesJudgement(r)+'</td>';},
      sum:function(t){return '<td></td>';}};
    // 复盘入口
    Cols.review={th:t('gen.L4329.1','<th class="text-center">复盘</th>'),
      td:function(r,c){return '<td class="cell-actions text-center"><button class="action-btn" onclick="openRpReview(\''+r.id+'\',\''+channel+t('gen.L4330.1','\')" title="查看复盘">查看</button></td>');},
      sum:function(t){return '<td class="text-center"></td>';}};
    Cols.target_turn={th:rpThCompact(t('forecast.compact.target_turnover','目标\n周转'),t("app.808", "\u5e0c\u671b\u8865\u8d27\u540e\u5e93\u5b58\u80fd\u8986\u76d6\u7684\u9500\u552e\u6708\u6570\u3002\u5b83\u662f\u8ba1\u7b97\u53c2\u6570\uff0c\u4e0d\u662f\u5b9e\u9645\u5e93\u5b58\u7ed3\u679c\u3002"),'text-right','',true),
      td:function(r,c){
        return '<td class="text-right"><input type="number" class="rp-target-turn" data-rid="'+r.id+'" data-channel="'+channel+'" data-avg-sales="'+c.avgSalesPeriod+'" value="'+c.targetTurn+'" min="0" step="0.5" style="width:65px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-weight:bold;text-align:center" onchange="onTargetTurnChange(this)"></td>';
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
    var totals={count:data.length,salesM1:0,salesM2:0,salesM3:0,salesM4:0,avgSales:0,totalAvg:0,totalAvgPeriod:0,avgSalesPeriod:0,transit:0,transitAllocated:0,transitAllocatedPeriod:0,effectiveTransitAllocated:0,transitTotalDisplay:0,transitUnallocated:0,po:0,avail:0,availAllocated:0,availAllocatedPeriod:0,piUnshipped:0,allocatedStock:0,poolAllocatedPeriod:0,targetStock:0,suggestedQty:0,
      piUnshippedAllocatedPeriod:0,poAllocatedPeriod:0,
      availWS:0,transitWS:0,poWS:0,piUnshippedWS:0,suggestedQtyWS:0};
    data.forEach(function(r){
      var c=r._c;
      totals.salesM4+=c.salesM4;totals.salesM3+=c.salesM3;totals.salesM2+=c.salesM2;totals.salesM1+=c.salesM1;
      totals.avgSales+=c.avgSales;totals.totalAvg+=c.totalAvg;totals.totalAvgPeriod+=c.totalAvgPeriod;totals.avgSalesPeriod+=c.avgSalesPeriod;
      totals.transit+=c.transit;totals.transitAllocated+=c.transitAllocated;totals.transitAllocatedPeriod+=(c.transitAllocatedPeriod||0);totals.effectiveTransitAllocated+=(c.effectiveTransitAllocated||0);totals.transitTotalDisplay+=(c.transitTotalDisplay||0);totals.transitUnallocated+=(c.transitUnallocated||0);totals.po+=c.po;totals.avail+=c.avail;totals.availAllocated+=c.availAllocated;totals.availAllocatedPeriod+=(c.availAllocatedPeriod||0);
      totals.piUnshipped+=c.piUnshipped;
      totals.piUnshippedAllocatedPeriod+=(c.piUnshippedAllocatedPeriod||0);
      totals.poAllocatedPeriod+=(c.poAllocatedPeriod||0);
      totals.allocatedStock+=c.allocatedStock;totals.poolAllocatedPeriod+=(c.poolAllocatedPeriod||0);totals.targetStock+=c.targetStock;
      totals.suggestedQty+=Math.round(c.suggestedQty||0);
      if(c.avgSalesPeriod>0){
        totals.availWS+=c.availAllocatedPeriod||0;
        totals.transitWS+=c.effectiveTransitAllocated||0;
        totals.poWS+=c.poAllocatedPeriod||0;
        totals.piUnshippedWS+=c.piUnshippedAllocatedPeriod||0;
        totals.suggestedQtyWS+=Math.round(c.suggestedQty||0);
      }
    });
    addHistoricalColsToActive(activeKeys,Cols,totals,data);
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
    var html='<div class="table-container" style="box-shadow:none;border-radius:0;overflow:auto;max-height:70vh"><table class="data-table rp-monthly-table" style="width:'+rpColWidthTotal(activeKeys)+'px;min-width:'+rpColWidthTotal(activeKeys)+'px">'+rpColgroupHtml(activeKeys)+'<thead><tr style="height:34px">'+th+'</tr>'+sum+'</thead><tbody>'+rows+tableFoot+'</tbody></table></div>';
    var container=rpEnsureContainer(myViewKey);
    container.innerHTML=html;
    rpStoreViewNode(myViewKey,container);
    if(rpCurrentViewKey()===myViewKey){
      rpShowView(myViewKey);
      applyChannelFreezeColumns(tabKey, activeKeys, container);
      syncRpHeaderHeight(container);
      initRpTableDrag(channel, container);
    }
  }catch(e){showFlash(e.message,'danger')}
}

// 订单预测表头换行后：同步合计行 sticky top 到实际表头高度
function syncRpHeaderHeight(container){
  container=container||rpActiveContainer();
  if(!container)return;
  var headerTr=container.querySelector('.rp-monthly-table thead tr:first-child');
  if(!headerTr) return;
  var summaryTds=container.querySelectorAll('.rp-monthly-table .rp-summary-row td');
  if(!summaryTds.length) return;
  var h=headerTr.offsetHeight||34;
  for(var i=0;i<summaryTds.length;i++){ summaryTds[i].style.top=h+'px'; }
}

// 渠道表格动态冻结列：飞书风格可拖拽冻结线
// 基于 localStorage 保存的字段 key 恢复冻结位置；字段配置变化后自动重算
function applyChannelFreezeColumns(tabKey, activeKeys, container){
  container=container||rpActiveContainer();
  if(!container)return;
  var table=container.querySelector('.rp-monthly-table');
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
      applyChannelFreezeColumns(tabKey, activeKeys, container);
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
    // 2.5 缺货影响说明（仅当存在"销量失真"标签时展示）
    +(function(){
      var hasDistortion = tags.indexOf('销量失真') >= 0;
      if(!hasDistortion) return '';
      var maxMonthly = Math.max(c.salesM1||0, c.salesM2||0, c.salesM3||0, c.salesM4||0);
      var refLabel = isOnline ? t('gen.L4658.1','线上') : t('gen.L4658.2','线下');
      var explainHtml = '<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:12px 16px;margin-bottom:8px">'
        +'<div style="font-size:13px;line-height:1.8;color:#5d4037">'
        +t('forecast.review.distortion_explain','当前库存为 0，近期销量受到缺货限制。系统未采用滚动月均销量，而采用过去4个月最高月销量作为补货参考。')
        +'</div></div>';
      var dataHtml = '<div class="detail-grid" style="grid-template-columns:1fr 1fr 1fr">'
        +kv(t('forecast.review.monthly_avg','{channel} 月均', {channel:refLabel}), c.avgSalesPeriod!==undefined?formatQuantityDisplay(c.avgSalesPeriod):'')
        +kv(t('forecast.review.ref_sales','补货参考销量'), formatQuantityDisplay(maxMonthly)+'<br><span style="font-size:11px;color:var(--text-secondary)">'+t('forecast.review.ref_sales_hint','（过去4个月最高月销量）')+'</span>', true)
        +kv(t("app.109", "\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf"), formatQuantityDisplay(c.suggestedQty))
        +'</div>';
      return t('forecast.review.distortion_title','<div class="detail-section"><h3>2.5 补货参考说明</h3>')+explainHtml+dataHtml+'</div>';
    })()
    // 3. 关键数据（渠道口径）
    +t('forecast.review.key_data_title','<div class="detail-section"><h3>3. 关键数据（{channel}）</h3><div class="detail-grid">', {channel:chLabel})
    +kv(t('forecast.review.monthly_avg','{channel} 月均', {channel:chLabel}), c.avgSalesPeriod!==undefined?formatQuantityDisplay(c.avgSalesPeriod):'')
    +kv(t('forecast.review.sales_share','{channel} 占比', {channel:chLabel}), c.pctPeriod!==undefined?Math.round(c.pctPeriod)+'%':'')
    +kv(t('forecast.review.channel_source','渠道占比来源'), (function(){
      if(c.channelAllocationStatus==='allocated'){
        if(c.channelRatioSource==='recent_sales') return t('forecast.channel.recent_sales','近期销量');
        if(c.channelRatioSource==='historical_sales') return t('forecast.channel.historical_sales','历史销量修正');
        if(c.channelRatioSource==='pre_stockout') return t('forecast.channel.pre_stockout','缺货前销量');
        if(c.channelRatioSource==='manual_config') return t('forecast.channel.manual','人工配置');
      }
      if(c.channelAllocationStatus==='unallocated') return t('forecast.channel.unallocated','未分配');
      return '';
    })())
    +kv(t('app.767','当前可用库存'), c.avail!==undefined?formatQuantityDisplay(c.avail):'')
    +kv(t('gen.L4686.1','当前可用周转'), c.availTurnover!==null?c.availTurnover:t("app.799", "\u65e0\u9500\u91cf"))
    +kv(t('forecast.compact.allocated_in_transit','在途库存（已分配）'), c.effectiveTransitAllocated!==undefined?formatQuantityDisplay(c.effectiveTransitAllocated):'')
    +kv(t('forecast.compact.transit_total','在途总库存'), c.transitTotalDisplay!==undefined?formatQuantityDisplay(c.transitTotalDisplay):'')
    +kv(t('forecast.compact.transit_unallocated','未分配在途'), c.transitUnallocated!==undefined?formatQuantityDisplay(c.transitUnallocated):'')
    +kv(t("app.733", "\u5728\u9014\u5e93\u5b58\u5468\u8f6c"), c.transitTurnover!==null?c.transitTurnover:t("app.799", "\u65e0\u9500\u91cf"))
    +kv(t("app.731", "PI\u5df2\u786e\u8ba4\u672a\u53d1\u8d27"), formatQuantityDisplay(c.piUnshipped))
    +kv(t("app.660", "\u76ee\u6807\u5468\u8f6c"), c.targetTurn)
    +kv(t("app.109", "\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf"), formatQuantityDisplay(c.suggestedQty))
    +kv(t("app.734", "\u9884\u8ba1\u4e0b\u5355\u540e\u5468\u8f6c"), c.afterOrderTurnover!==null?c.afterOrderTurnover:t("app.799", "\u65e0\u9500\u91cf"))
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
  var vc=input.closest('.rp-view-container')||rpActiveContainer();
  var stockEl=vc?vc.querySelector('.rp-target-stock-'+rid):document.querySelector('.rp-target-stock-'+rid);
  if(stockEl) stockEl.textContent=stock;
  // 异步保存目标周转
  var field=channel==='online'?'online_target_turnover':'offline_target_turnover';
  api('/api/replenishment-suggestions/'+rid,'PUT',{online_target_turnover:channel==='online'?months:undefined,offline_target_turnover:channel==='offline'?months:undefined}).then(function(){
    rpClearDataCache();
    var vk=rpCurrentViewKey();
    if(window._rpCache.views[vk])window._rpCache.views[vk].signature='__STALE__';
  });
}

// 线上/线下建议采购数量修改 → 自动保存 + 换算预计下单后周转 + 反馈
// input 显示的是最终建议值（suggestedQty），用户编辑后反推 target_stock = 输入值 + allocatedStock
async function onChannelTargetStockChange(input){
  var rid=input.dataset.rid;
  var channel=input.dataset.channel;
  var qty=parseInt(input.value)||0;
  var vc=input.closest('.rp-view-container')||rpActiveContainer();
  // 从缓存读取行数据用于换算
  var cache=window._rpChannelData&&window._rpChannelData[channel];
  var r=cache?cache[rid]:null;
  var c=r?r._c:null;
  // 反推 target_stock = 用户输入的最终建议值 + 渠道分摊库存
  var allocatedStock=c?c.allocatedStock:0;
  var targetStock=qty+allocatedStock;
  // 前端实时换算预计下单后周转（当前库存池 + 新建议采购）
  if(c){
    var newAfterOrder=c.avgSalesPeriod>0?Math.round((c.pool+qty)/c.avgSalesPeriod*10)/10:null;
    c.afterOrderTurnover=newAfterOrder; // 同步缓存，供复盘弹窗读取
    var turnEl=vc?vc.querySelector('.rp-after-order-turn[data-rid="'+rid+'"]'):document.querySelector('.rp-after-order-turn[data-rid="'+rid+'"]');
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
    rpClearDataCache();
    var vk2=rpCurrentViewKey();
    if(window._rpCache.views[vk2])window._rpCache.views[vk2].signature='__STALE__';
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
    rpClearDataCache();
    var vk3=rpCurrentViewKey();
    if(window._rpCache.views[vk3])window._rpCache.views[vk3].signature='__STALE__';
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
  var vc=input.closest('.rp-view-container')||rpActiveContainer();
  // 从存储的行数据读取，不依赖 DOM 列位置
  var rowData=window._rpRowData&&window._rpRowData[rid];
  var totalAvg=rowData?(rowData.totalAvg||0):0;
  var pool=rowData?(rowData.pool||0):0;
  var afterOrder=totalAvg>0?Math.round((pool+foq)/totalAvg*10)/10:0;
  var turnEl=vc?vc.querySelector('#rp-turn-'+rid):document.getElementById('rp-turn-'+rid);
  if(turnEl){
    turnEl.textContent=totalAvg>0?afterOrder:t("app.799", "\u65e0\u9500\u91cf");
    var cls=afterOrder<2?'text-danger':afterOrder>=2&&afterOrder<4?'text-success':afterOrder>=4&&afterOrder<6?'text-primary':'text-secondary';
    turnEl.className='text-right '+cls;
  }
  // 启用/禁用调整原因
  var reasonSel=vc?vc.querySelector('.rp-adj-reason[data-rid="'+rid+'"]'):document.querySelector('.rp-adj-reason[data-rid="'+rid+'"]');
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
  var ck=vc?vc.querySelector('.rp-ck[value="'+rid+'"]'):document.querySelector('.rp-ck[value="'+rid+'"]');
  if(ck) ck.dataset.qty=parseInt(input.dataset.suggested)||0;
  // 自动保存
  saveFinalQty(rid);
}

// 调整原因修改
function onAdjReasonChange(sel){
  var rid=sel.dataset.rid;
  var reason=sel.value;
  api('/api/replenishment-suggestions/'+rid,'PUT',{adjustment_reason:reason}).then(function(){
    showToast(t('gen.L4853.1','调整原因已保存'),'success');
    rpClearDataCache();
    var vk=rpCurrentViewKey();
    if(window._rpCache.views[vk])window._rpCache.views[vk].signature='__STALE__';
  }).catch(function(e){showToast(e.message,'danger')});
}

// 保存渠道变更（目标周转+备注）
async function saveChannelChanges(rid,channel){
  var vc=rpActiveContainer();
  var turnInput=vc?vc.querySelector('.rp-target-turn[data-rid="'+rid+'"][data-channel="'+channel+'"]'):document.querySelector('.rp-target-turn[data-rid="'+rid+'"][data-channel="'+channel+'"]');
  var remarkInput=vc?vc.querySelector('.rp-channel-remark[data-rid="'+rid+'"][data-channel="'+channel+'"]'):document.querySelector('.rp-channel-remark[data-rid="'+rid+'"][data-channel="'+channel+'"]');
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
      var stockEl=vc?vc.querySelector('.rp-target-stock-'+rid):document.querySelector('.rp-target-stock-'+rid);
      if(stockEl){
        var stock=channel==='online'?(d.online_target_stock||0):(d.offline_target_stock||0);
        stockEl.textContent=stock;
      }
    }
    showToast(t('gen.L4880.1','已保存，目标库存已回写总预测'),'success');
    rpClearDataCache();
    var vk=rpCurrentViewKey();
    if(window._rpCache.views[vk])window._rpCache.views[vk].signature='__STALE__';
  }catch(e){showToast(e.message,'danger')}
}

// 在途库存人工分配保存
// 人工配置是对自动分配的整体业务替代，一旦存在任意人工分配，SKU整体进入人工模式
// 人工输入消耗共享未分配在途池，线上+线下分配总和不得超过在途总库存
// 保存时同时发送另一渠道的当前人工值，确保DB状态与前端一致（完整替代规则）
async function saveTransitAllocation(rid,channel,val){
  var qty=parseInt(val)||0;
  if(qty<0) qty=0;
  var vc=rpActiveContainer();
  var otherManualVal=0; // 另一渠道的当前人工值（默认0）
  // 客户端校验：从缓存读取在途总库存和另一渠道有效已分配量
  var cached=window._rpChannelData&&window._rpChannelData[channel]&&window._rpChannelData[channel][rid];
  if(cached){
    var transitTotal=cached.in_transit_qty||0;
    otherManualVal = channel==='online'
      ? (cached.manual_offline_transit_qty||0)
      : (cached.manual_online_transit_qty||0);
    // 判断是否进入人工模式：当前输入>0 或 另一渠道已有人工值
    var hasManual = (qty > 0) || (otherManualVal > 0);
    var otherEffective;
    if(hasManual){
      // 人工模式：另一渠道有效值 = 其人工值（未填写=0）
      otherEffective = otherManualVal;
    }else{
      // 自动模式：另一渠道有效值 = 自动分配结果
      otherEffective = 0;
      if(cached.channel_allocation_status === 'allocated'){
        var otherPct = channel==='online'
          ? (100 - (cached.resolved_online_pct||0))
          : (cached.resolved_online_pct||0);
        otherEffective = Math.round(transitTotal * (otherPct/100));
      }
    }
    var maxAvailable=transitTotal-otherEffective;
    if(maxAvailable<0) maxAvailable=0;
    if(qty>maxAvailable){
      showToast(t('forecast.transit.exceed','分配数量超过可分配上限')+': '+maxAvailable,'danger');
      // 恢复输入框值为上限
      var input=vc?vc.querySelector('.rp-transit-manual[data-rid="'+rid+'"]'):document.querySelector('.rp-transit-manual[data-rid="'+rid+'"]');
      if(input) input.value=maxAvailable;
      qty=maxAvailable;
    }
  }
  // 保存当前渠道值，同时保留另一渠道的已有人工值（确保DB状态完整）
  var body={};
  if(channel==='online'){
    body.manual_online_transit_qty=qty;
    body.manual_offline_transit_qty=otherManualVal;
  }else{
    body.manual_offline_transit_qty=qty;
    body.manual_online_transit_qty=otherManualVal;
  }
  try{
    await api('/api/replenishment-suggestions/'+rid,'PUT',body);
    showToast(t('forecast.transit.saved','在途分配已保存，库存池已更新'),'success');
    // 保存滚动位置，刷新后恢复（避免保存后页面跳到顶部）
    var scrollContainer=vc?vc.querySelector('.table-container'):document.querySelector('#rp-table .table-container');
    var savedScrollTop=scrollContainer?scrollContainer.scrollTop:0;
    var savedScrollLeft=scrollContainer?scrollContainer.scrollLeft:0;
    // 刷新当前渠道页数据以重算库存池、周转、未分配在途等所有派生值
    if(typeof loadRp==='function'){
      rpClearDataCache();
      rpRemoveView(rpCurrentViewKey());
      await loadRp();
      // 恢复滚动位置
      requestAnimationFrame(function(){
        var ac=rpActiveContainer();
        var sc=ac?ac.querySelector('.table-container'):document.querySelector('#rp-table .table-container');
        if(sc){sc.scrollTop=savedScrollTop;sc.scrollLeft=savedScrollLeft;}
      });
    }
  }catch(e){showToast(e.message,'danger')}
}

// 最终下单数量保存（失焦时触发）
async function saveFinalQty(rid){
  var vc=rpActiveContainer();
  var input=vc?vc.querySelector('.rp-final-qty[data-rid="'+rid+'"]'):document.querySelector('.rp-final-qty[data-rid="'+rid+'"]');
  if(!input) return;
  var foq=parseInt(input.value)||0;
  var reasonSel=vc?vc.querySelector('.rp-adj-reason[data-rid="'+rid+'"]'):document.querySelector('.rp-adj-reason[data-rid="'+rid+'"]');
  var body={final_order_qty:foq};
  if(reasonSel && !reasonSel.disabled) body.adjustment_reason=reasonSel.value;
  try{
    var resp=await api('/api/replenishment-suggestions/'+rid,'PUT',body);
    showToast(t('gen.L4894.1','已保存'),'success');
    rpClearDataCache();
    var vk=rpCurrentViewKey();
    if(window._rpCache.views[vk])window._rpCache.views[vk].signature='__STALE__';
  }catch(e){showToast(e.message,'danger')}
}

// 按天模式：冻结左侧列 + 冻结汇总行
async function loadRpDaily(){
  var myViewKey=rpTab+'-daily';
  try{
    var url=rpDailyUrl();
    const resp=await rpFetchCached(url);
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
      {key:'sku',              width:170},
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
      +'<th style="'+sHead(0)+'"><input type="checkbox" class="rp-all" onchange="(function(el){el.closest(\'.rp-view-container\').querySelectorAll(\'.rp-ck\').forEach(function(c){c.checked=el.checked})})(this)"></th>'
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
        +'<td class="rp-daily-cell-wrap" style="'+sBody(4)+';max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:monospace;font-size:12px" title="'+esc(r.sku_code||'')+'">'+esc(r.sku_code)+'</td>'
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
    var html='<div class="daily-table-wrap" style="overflow:auto;max-height:70vh;position:relative">'
      +'<table class="data-table" style="white-space:nowrap;border-collapse:separate;border-spacing:0">'
      +'<thead>'+headRow+summaryRow+'</thead>'
      +'<tbody>'+rows+emptyFoot+'</tbody>'
      +'</table></div>';
    var container=rpEnsureContainer(myViewKey);
    container.innerHTML=html;
    rpStoreViewNode(myViewKey,container);
    if(rpCurrentViewKey()===myViewKey){
      rpShowView(myViewKey);
      syncRpDailyHeaderHeight(container);
    }
  }catch(e){showFlash(e.message,'danger')}
}

// 按天表头高度自适应：表头可换行后实际高度 != headerH(34)
// 渲染后读取真实 thead tr 高度，重写汇总行及日期汇总单元格的 sticky top
function syncRpDailyHeaderHeight(container){
  container=container||rpActiveContainer();
  if(!container)return;
  var headTr=container.querySelector('.daily-table-wrap thead tr:first-child');
  if(!headTr) return;
  var h=headTr.offsetHeight||34;
  var sumTr=container.querySelector('.daily-table-wrap .rp-daily-summary-row');
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
    var vc=input.closest('.rp-view-container')||rpActiveContainer();
    // 根据当前Tab更新对应的周转月数列
    const turnEl=vc?vc.querySelector('#rp-turn-'+rid):document.getElementById('rp-turn-'+rid);
    if(turnEl&&d){
      let afterOrder=99;
      if(rpTab==='online') afterOrder=d.online_after_order_turnover_months||99;
      else if(rpTab==='offline') afterOrder=d.offline_after_order_turnover_months||99;
      else afterOrder=d.after_order_turnover_months||99;
      turnEl.textContent=Math.round(afterOrder*10)/10;
      turnEl.className='text-right '+(afterOrder<2?'text-danger':afterOrder>=2&&afterOrder<4?'text-success':afterOrder>=4&&afterOrder<6?'text-primary':'text-secondary');
    }
    const suggEl=vc?vc.querySelector('#rp-sugg-'+rid):document.getElementById('rp-sugg-'+rid);
    if(suggEl&&d) suggEl.textContent=d.suggestion||'';
    const ck=vc?vc.querySelector('.rp-ck[value="'+rid+'"]'):document.querySelector('.rp-ck[value="'+rid+'"]');
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
    rpClearDataCache();
    rpClearAllViews();
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
      +'<div style="font-size:12px;color:#888;margin-top:4px">月均销量、库存周转、动销分类、风险判断、目标库存与建议采购数量均使用当前「销量统计周期」；保存后系统会自动重新计算预测快照。</div>'
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
      +t("app.869", "\u4fdd\u5b58\u540e\u7cfb\u7edf\u4f1a\u81ea\u52a8\u91cd\u65b0\u8ba1\u7b97\uff0c\u5e76\u540c\u6b65\u5237\u65b0\u6307\u6807\u5361\u3001\u660e\u7ec6\u548c\u5efa\u8bae\u7ed3\u679c\u3002")
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
    {key:'sales_stats_days',value:sd,description:t("system.009", "\u9500\u91cf\u7edf\u8ba1\u5468\u671f(\u5929)\uff1a60/90/120\uff0c\u5f71\u54cd\u6708\u5747\u9500\u91cf\u3001\u5f53\u524d\u53ef\u7528\u5468\u8f6c\u3001\u5728\u9014\u5e93\u5b58\u5468\u8f6c\u3001\u9884\u8ba1\u4e0b\u5355\u540e\u5468\u8f6c\u4e0e\u5efa\u8bae\u91c7\u8d2d\u6570\u91cf")},
    {key:'dim_default_config',value:JSON.stringify(rules),description:t('gen.L5247.1','目标周转多维默认值(JSON数组)：brand/country/warehouse/online_turnover/offline_turnover，空=通配；命中优先级 品牌+国家+仓库>品牌+国家>品牌+仓库>品牌>国家+仓库>国家>仓库>兜底')}
  ];
  try{
    await api('/api/system-config','POST',{configs:configs});
    // 刷新销量统计周期缓存，并立即重算当前筛选范围，保证页面指标和建议同步变化。
    rpSalesStatsDays=parseInt(sd)||90; _rpSdPromise=null;
    var generated=await api('/api/replenishment-suggestions/generate','POST',rpFilterBody());
    if(generated&&generated.success===false){
      throw new Error(t('forecast.generate.unmatched','存在未配置目标周转的维度，预测参数已保存但重新计算未完成'));
    }
    await loadRpSummary();
    await loadRpWithHistorical();
    showToast(t('gen.L5253.1','预测参数已保存，页面指标和建议已同步更新'),'success');
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
    if(po.price_warnings&&po.price_warnings.length>0){
      showToast(t('po.create_success_with_warning','PO创建成功，但'+po.price_warnings.length+'个SKU待补充FOB价格'),'warning');
    }else{
      showToast(t('gen.L5323.1','PO创建成功'),'success');
    }
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
    document.getElementById('po-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">🛒</div>'+t("empty.no_po","暂无PO")+'</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("col.po_no","PO号")+'</th><th>'+t("col.supplier","供应商")+'</th><th>'+t("app.112","品牌")+'</th><th>'+t("app.113","国家")+'</th><th>'+t("app.114","仓库")+'</th><th>'+t("col.po_date","PO日期")+'</th><th>'+t("html.pay.th.currency","币种")+'</th><th>'+t("col.detail","明细")+'</th><th>'+t("po.price_status","价格状态")+'</th><th>'+t("col.po_status","PO状态")+'</th><th>'+t("col.approval","审批")+'</th><th>'+t("common.actions","操作")+'</th></tr></thead><tbody>'+data.map(p=>'<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewPO\',\''+p.id+'\')"><td class="cell-id"><span class="link-text" onclick="viewPO(\''+p.id+'\')">'+esc(p.po_no)+'</span></td><td>'+esc(p.supplier_name)+'</td><td>'+esc(p.brand)+'</td><td>'+esc(p.country)+'</td><td>'+esc(p.target_warehouse)+'</td><td class="cell-date">'+fmtDate(p.po_date)+'</td><td>'+esc(p.currency)+'</td><td class="text-center">'+(p.item_count||0)+'</td><td><span class="status-badge '+(p.price_status==='confirmed'?'status-completed':'status-pending')+'">'+(p.price_status==='confirmed'?t("po.price_confirmed","已确认价格"):t("po.price_pending","待补充FOB价格"))+'</span></td><td><span class="status-badge '+((p.po_status==='approved'||p.po_status==='transferred_pi')?'status-completed':p.po_status==='pending_approval'?'status-pending':'status-draft')+'">'+statusLabel(p.po_status)+'</span></td><td><span class="status-badge '+(p.approval_status==='approved'?'status-approved':p.approval_status==='rejected'?'status-rejected':'status-pending')+'">'+statusLabel(p.approval_status)+'</span></td><td class="cell-actions"><button class="action-btn" onclick="viewPO(\''+p.id+'\')">👁️</button>'+(p.po_status==='draft'&&hasPermission('po_create')?'<button class="action-btn" onclick="submitPO(\''+p.id+'\')" title="'+t("po.submit_approval","提交审批")+'">📤</button>':'')+(p.po_status==='approved'&&hasPermission('po_create')?'<button class="action-btn" onclick="sendFactory(\''+p.id+'\')" title="'+t("po.send_factory","发工厂")+'">📨</button>':'')+((hasPermission('po_export')||hasPermission('po_create'))?'<button class="action-btn" onclick="exportPO(\''+p.id+'\')" title="'+t("action.export_excel","导出Excel")+'">📊</button>':'')+(hasPermission('po_create')?'<button class="action-btn" onclick="voidPO(\''+p.id+'\')" title="'+t("action.void","作废")+'">'+t("action.void","作废")+'</button>':'')+(hasPermission('po_create')&&p.po_status==='draft'?'<button class="action-btn" style="color:#d4380d" onclick="deletePO(\''+p.id+'\')" title="'+t("action.delete","删除")+'">'+t("action.delete","删除")+'</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}
async function viewPO(id){
  try{const po=await api('/api/purchase-orders/'+id);
    const totalQty=(po.items||[]).reduce((s,i)=>s+(i.po_qty||0),0);
    const totalAmt=(po.items||[]).reduce((s,i)=>s+((i.po_qty||0)*(i.unit_price||0)),0);
    const hasMissingPrice=(po.items||[]).some(i=>!i.unit_price||i.unit_price<=0);
    openModal(t('modal.title.viewPO', 'PO详情 - {v1}', {v1: po.po_no}),t('modal.body.viewPO', '<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>基本信息</h3><div class="detail-grid">{v1}</div></div><div class="detail-section"><h3>PO明细</h3>'+(hasMissingPrice?'<div style="padding:8px 12px;background:#fff7e6;border:1px solid #ffd591;border-radius:4px;margin-bottom:8px;font-size:13px;color:#d46b08">⚠️ '+t("po.price_pending","待补充FOB价格")+'：部分SKU单价为0，请在转PI前补充</div>':'')+'<div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th class="text-right">数量</th><th class="text-right">单价</th><th class="text-right">金额</th></tr></thead><tbody>{v2}</tbody></table></div><div style="display:flex;gap:24px;justify-content:flex-end;margin-top:10px;font-weight:600"><span>合计 SKU：{v3} 个</span><span>合计数量：{v4} 件</span><span>合计金额：{v5}</span></div></div></div>', {v1: ['po_no','supplier_name','brand','country','target_warehouse','po_date','currency','po_status','approval_status','created_by_name'].map(f=>'<div class="detail-item"><span class="detail-label">'+f+'</span><span class="detail-value">'+esc(po[f])+'</span></div>').join(''), v2: (po.items||[]).map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.po_qty+'</td><td class="text-right">'+((!i.unit_price||i.unit_price<=0)?'<span style="color:#d46b08">'+t("po.price_pending","待补充")+'</span>':fmtMoney(i.unit_price,po.currency))+'</td><td class="text-right">'+fmtMoney((i.po_qty||0)*(i.unit_price||0),po.currency)+'</td></tr>').join(''), v3: (po.items||[]).length, v4: totalQty, v5: fmtMoney(totalAmt,po.currency)}));
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
  document.getElementById('content-inner').innerHTML=t('html.renderPI', `<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>发货状态</label><div class="multi-select" id="pi-fs-wrap" style="position:relative;display:inline-block"><button type="button" class="ms-toggle" id="pi-fs-toggle" style="min-width:150px;padding:6px 10px;border:1px solid #d0d7de;border-radius:6px;background:#fff;cursor:pointer;text-align:left;font-size:13px;color:#24292f" onclick="event.stopPropagation();togglePIFs()">未发货, 部分发货 ▾</button><div class="ms-panel" id="pi-fs-panel" style="display:none;position:absolute;z-index:50;margin-top:4px;background:#fff;border:1px solid #d0d7de;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:6px;min-width:160px" onclick="event.stopPropagation()"><label class="ms-item" style="display:flex;align-items:center;gap:6px;padding:5px 8px;white-space:nowrap;cursor:pointer;font-weight:normal;font-size:13px"><input type="checkbox" id="pi-fs-all" onchange="piFsAllChange()"> 全部</label><label class="ms-item" style="display:flex;align-items:center;gap:6px;padding:5px 8px;white-space:nowrap;cursor:pointer;font-weight:normal;font-size:13px"><input type="checkbox" class="pi-fs-opt" value="pending_shipment" checked onchange="piFsOptChange()"> 未发货</label><label class="ms-item" style="display:flex;align-items:center;gap:6px;padding:5px 8px;white-space:nowrap;cursor:pointer;font-weight:normal;font-size:13px"><input type="checkbox" class="pi-fs-opt" value="partial_shipped" checked onchange="piFsOptChange()"> 部分发货</label><label class="ms-item" style="display:flex;align-items:center;gap:6px;padding:5px 8px;white-space:nowrap;cursor:pointer;font-weight:normal;font-size:13px"><input type="checkbox" class="pi-fs-opt" value="shipped_complete" onchange="piFsOptChange()"> 全部发货</label></div></div></div><div class="filter-group"><label>关键词</label><input type="text" id="pi-fk" onkeypress="if(event.key==='Enter'){_piKeyword=this.value;loadPI()}"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="_piKeyword=document.getElementById('pi-fk').value;loadPI()">搜索</button>{v1}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📄 PI列表</div></div><div id="pi-table"></div></div>`, {v1: hasPermission('pi_create')?t('gen.L5434.1','<button class="btn btn-secondary btn-sm" onclick="downloadDocTemplate(\'pi\')">📥 PI模板</button><button class="btn btn-secondary btn-sm" onclick="openDocImport(\'pi\')">📤 批量导入PI</button><button class="btn btn-primary btn-sm" onclick="createPI()">➕ 新建PI</button>'):''});
  loadPI();
  updatePIFsLabel();
}
async function loadPI(){
  try{
    const raw=await api('/api/proforma-invoices?keyword='+encodeURIComponent(_piKeyword));
    const _piSel=piSelectedStatuses();
    const data = _piSel.length ? raw.filter(p=>_piSel.includes(computePIShipStatus(p))) : raw;
    document.getElementById('pi-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">📄</div>'+t("empty.no_pi","暂无PI")+'</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("col.pi_no","PI号")+'</th><th>'+t("col.related_po","关联PO")+'</th><th>'+t("col.supplier","供应商")+'</th><th>'+t("app.112","品牌")+'</th><th>'+t("app.113","国家")+'</th><th>'+t("app.114","仓库")+'</th><th>'+t("col.date","日期")+'</th><th>'+t("html.pay.th.currency","币种")+'</th><th>'+t("col.total_amount","总金额")+'</th><th>'+t("col.is_deposit","是否定金")+'</th><th>'+t("col.deposit_ratio","定金比例")+'</th><th>'+t("col.deposit_amount","定金金额")+'</th><th>'+t("col.deposit_status","定金状态")+'</th><th>'+t("pi.field.ship_status","发货状态")+'</th><th>'+t("pi.col.attachment","PI附件")+'</th><th>'+t("common.actions","操作")+'</th></tr></thead><tbody>'+data.map(p=>'<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewPI\',\''+p.id+'\')"><td class="cell-id"><span class="link-text" onclick="viewPI(\''+p.id+'\')">'+esc(p.pi_no)+'</span></td><td class="cell-id">'+esc(p.related_po_no)+'</td><td>'+esc(p.supplier_name)+'</td><td>'+esc(p.brand)+'</td><td>'+esc(p.country)+'</td><td>'+esc(p.target_warehouse)+'</td><td class="cell-date">'+fmtDate(p.pi_date)+'</td><td>'+esc(p.currency)+'</td><td class="text-right">'+fmtMoney(p.total_amount)+'</td><td>'+(piNeedsDeposit(p.need_deposit)?'<span class="status-badge status-pending">'+t("enum.yes","是")+'</span>':'<span class="status-badge status-completed">'+t("enum.no","否")+'</span>')+'</td><td class="text-right">'+(p.deposit_ratio||0)+'%</td><td class="text-right">'+fmtMoney(p.payable_deposit)+'</td><td>'+(piNeedsDeposit(p.need_deposit)?'<span class="status-badge '+(p.deposit_paid?'status-paid':'status-unpaid')+'">'+esc(formatPIDepositStatus(p.deposit_paid?'paid':'unpaid'))+'</span>':'<span class="status-badge status-completed">'+t('pi.deposit_status.none','无需定金')+'</span>')+'</td><td>'+renderPIShipStatusBadge(p)+'</td><td id="pi-att-'+p.id+'">'+renderPIAttachmentCell(p)+'</td><td class="cell-actions"><button class="action-btn" onclick="viewPI(\''+p.id+'\')">👁️</button>'+(hasPermission('pi_edit')?('<button class="action-btn" '+(p.locked?('disabled title="'+t("pi.locked_note","已锁定，不可编辑：")+''+esc(p.lock_reason||''+t("pi.locked","已锁定")+'')+'" style="opacity:.3;cursor:not-allowed">✏️</button>'):('onclick="editPI(\''+p.id+'\')" title="'+t("action.edit","编辑")+'">✏️</button>'))):'')+'<button class="action-btn" onclick="uploadDocAttachment(\'pi\',\''+p.id+'\',\'attachment\')" title="'+t("pi.upload_attachment","上传PI附件")+'">📎</button>'+(piNeedsDeposit(p.need_deposit)&&p.payable_deposit>0&&p.deposit_payment_status==='unpaid'&&hasPermission('payment_create')?'<button class="action-btn" onclick="createDepPay(\''+p.id+'\')" title="'+t("pi.deposit_pay","定金付款")+'">💰</button>':'')+(hasPermission('pi_edit')?'<button class="action-btn" '+(p.pi_status==='completed'?'disabled title="'+t("pi.cannot_void_completed","已完成状态不可作废")+'" style="opacity:.3;cursor:not-allowed"':'onclick="voidPI(\''+p.id+'\')" title="'+t("action.void","作废")+'"')+'>'+t("action.void","作废")+'</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

let _piKeyword='';
function piSelectedStatuses(){
  const all=document.getElementById('pi-fs-all');
  if(all&&all.checked) return [];
  return Array.from(document.querySelectorAll('.pi-fs-opt:checked')).map(el=>el.value);
}
function updatePIFsLabel(){
  const btn=document.getElementById('pi-fs-toggle'); if(!btn) return;
  const all=document.getElementById('pi-fs-all');
  const opts=Array.from(document.querySelectorAll('.pi-fs-opt:checked'));
  let txt;
  if((all&&all.checked)||opts.length===0){ txt=t('pi.filter.all','全部'); }
  else{
    const map={pending_shipment:t('pi.ship_status.pending_shipment','未发货'),partial_shipped:t('pi.ship_status.partial_shipped','部分发货'),shipped_complete:t('pi.ship_status.shipped_complete','全部发货')};
    txt=opts.map(o=>map[o.value]||o.value).join(', ');
  }
  btn.textContent=txt+' ▾';
}
function piFsAllChange(){ if(document.getElementById('pi-fs-all').checked){ document.querySelectorAll('.pi-fs-opt').forEach(o=>o.checked=false); } updatePIFsLabel(); loadPI(); }
function piFsOptChange(){ const any=document.querySelectorAll('.pi-fs-opt:checked').length>0; const all=document.getElementById('pi-fs-all'); if(all) all.checked=!any; updatePIFsLabel(); loadPI(); }
function togglePIFs(){ const p=document.getElementById('pi-fs-panel'); if(!p) return; const open=p.style.display!=='block'; p.style.display=open?'block':'none'; if(open){ setTimeout(function(){document.addEventListener('click',piFsOutside);},0); } else { document.removeEventListener('click',piFsOutside); } }
function piFsOutside(e){ const w=document.getElementById('pi-fs-wrap'); if(w&&!w.contains(e.target)){ const p=document.getElementById('pi-fs-panel'); if(p)p.style.display='none'; document.removeEventListener('click',piFsOutside); } }

async function viewPI(id, backPay, backMode){
  // 先开弹窗骨架 + Loading（立即响应，不等接口）
  openModal(t('modal.title.viewPI','PI详情'),'<div style="padding:40px;text-align:center"><div style="font-size:32px;color:#1890ff;margin-bottom:8px">⏳</div><div style="color:#666">'+t('common.loading','加载中…')+'</div></div>','','modal-pi');
  try{const pi=await api('/api/proforma-invoices/'+id);
    if(!document.getElementById('modal-overlay').classList.contains('show'))return; // 用户在 Loading 期间关闭了弹窗
    let poRef=[];if(pi.related_po_id){try{poRef=(await api('/api/purchase-orders/'+pi.related_po_id)).items||[];}catch(e){}}
    const diffHtml=renderCmpReadonly(computePODiff(poRef,pi.items||[]));
    // 若来自付款申请详情，提供【← 返回付款申请详情】入口，保留原上下文（含 mode）
    const backFooter=backPay?'<button class="btn btn-secondary" onclick="viewPayment(\''+backPay+'\',\''+(backMode||'view')+t('gen.L5449.1','\')">← 返回付款申请详情</button><button class="btn btn-secondary" onclick="closeModal()">关闭</button>'):'';
    openModal(t('modal.title.viewPI', 'PI详情 - {v1}', {v1: pi.pi_no}),t('modal.body.viewPI', '<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>基本信息</h3><div class="detail-grid detail-grid-pi">{v1}{v2}</div></div><div class="detail-section"><h3>PI明细</h3><div class="pi-table-scroll"><table class="data-table pi-items-table"><thead><tr><th>SKU</th><th>PO数量</th><th>PI确认</th><th>单价</th><th>折扣</th><th>金额</th><th>已发货</th><th>未发货</th></tr></thead><tbody>{v3}</tbody></table></div></div><div class="detail-section"><h3>PO vs PI 差异对比</h3>{v4}</div></div>', {v1: [{f:'pi_no',l:t('col.pi_no','PI号')},{f:'related_po_no',l:t('col.related_po','关联PO')},{f:'supplier_name',l:t('pi.field.supplier','供应商')},{f:'brand',l:t('app.112','品牌')},{f:'country',l:t('app.113','国家')},{f:'target_warehouse',l:t('app.114','仓库')},{f:'pi_date',l:t('pi.field.date','PI日期')},{f:'currency',l:t('html.pay.th.currency','币种')},{f:'total_amount',l:t('pi.field.total_amount','总金额')},{f:'payment_terms',l:t('nav.payment_terms','付款条件')},{f:'need_deposit',l:t('col.is_deposit','是否定金')},{f:'deposit_ratio',l:t('col.deposit_ratio','定金比例')},{f:'payable_deposit',l:t('col.deposit_amount','定金金额')},{f:'expected_delivery',l:t('pi.field.expected_delivery','预计交期')},{f:'pi_status',l:t('pi.field.status','PI状态')}].map(o=>'<div class="detail-item"><span class="detail-label">'+o.l+'</span><span class="detail-value">'+(o.f==='need_deposit'?(piNeedsDeposit(pi[o.f])?t('gen.L5450.1','是'):t('gen.L5450.2','否')):(o.f==='pi_status'?esc(formatPIStatus(pi.pi_status)):(o.f==='deposit_ratio'?(pi[o.f]||0)+'%':(o.f==='total_amount'||o.f==='payable_deposit'?(pi.currency?pi.currency+' ':'')+fmtMoney(pi[o.f]):esc(pi[o.f])))))+'</span></div>').join(''), v2: attachmentHtml('pi',pi.id,'attachment',pi.attachment,t("pi.field.attachment", "PI\u9644\u4ef6")), v3: (pi.items||[]).map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.po_qty+'</td><td class="text-right">'+i.pi_confirmed_qty+'</td><td class="text-right">'+fmtMoney(i.unit_price)+'</td><td class="text-right">'+((i.discount||0)*100)+'%</td><td class="text-right">'+fmtMoney(i.pi_amount)+'</td><td class="text-right">'+(i.shipped_qty||0)+'</td><td class="text-right">'+(i.unshipped_qty||0)+'</td></tr>').join(''), v4: diffHtml.replace('class="table-container"','class="pi-table-scroll"')}),backFooter,'modal-pi');
    // PI-TABLE-ALIGN-01 R4: 给 i18n 渲染的 Items 表补 pi-items-readonly class + 像素 colgroup（8列总宽1165px）
    const _piItemsTbl=document.querySelector('.modal-pi .pi-table-scroll .data-table:not(.pi-cmp-table)');
    if(_piItemsTbl){if(!_piItemsTbl.classList.contains('pi-items-readonly'))_piItemsTbl.classList.add('pi-items-readonly');if(!_piItemsTbl.querySelector('colgroup')){_piItemsTbl.insertAdjacentHTML('afterbegin','<colgroup><col style="width:230px"><col style="width:125px"><col style="width:170px"><col style="width:130px"><col style="width:110px"><col style="width:140px"><col style="width:120px"><col style="width:140px"></colgroup>');}}
  }catch(e){showToast(e.message,'danger')}
}
async function editPI(id){
  // 先开弹窗骨架 + Loading（立即响应，不等 PI 请求）
  openModal(t('modal.title.editPI','编辑PI'),'<div style="padding:40px;text-align:center"><div style="font-size:32px;color:#1890ff;margin-bottom:8px">⏳</div><div style="color:#666">'+t('common.loading','加载中…')+'</div></div>','','modal-pi');
  try{
    const pi=await api('/api/proforma-invoices/'+id);
    // 锁定：打开即提示，不渲染可编辑表单（第2层：仅前端表现，PUT 守卫已在第1层落地）
    if(pi.locked){
      openModal(t('modal.title.editPI', '编辑PI - {v1}', {v1: esc(pi.pi_no)}),t('modal.body.editPI', '<div style="padding:24px 16px;text-align:center"><div style="font-size:42px;margin-bottom:10px">🔒</div><div style="font-size:15px;font-weight:600;margin-bottom:6px">该 PI 已锁定，不可编辑</div><div style="color:var(--text-muted)">原因：{v1}</div></div>', {v1: esc(pi.lock_reason||t('gen.L5458.1','已锁定'))}),t('gen.L5458.2','<button class="btn btn-secondary" onclick="closeModal()">关闭</button>'));
      return;
    }
    // 并行加载主数据(缓存) + PO 明细 + 仓库选项（预取，避免表单打开后仓库空窗期）
    var _poPromise=pi.related_po_id?api('/api/purchase-orders/'+pi.related_po_id).then(function(po){return po.items||[];}).catch(function(){return [];}):Promise.resolve([]);
    var _whPromise=pi.country?api('/api/warehouses/by-country?country='+encodeURIComponent(pi.country)).catch(function(){return [];}):Promise.resolve([]);
    var _edData;
    try{ _edData=await Promise.all([_getMaster(['suppliers','countries','brands']),_poPromise,_whPromise]);     }catch(e){showToast(e.message,'danger');return;}
    if(!document.getElementById('modal-overlay').classList.contains('show'))return; // 用户在 Loading 期间关闭了弹窗
    const suppliers=_edData[0].suppliers,countries=_edData[0].countries,brands=_edData[0].brands;
    let poRef=_edData[1];
    const warehouses=_edData[2]||[];
    const countryOpts=countries.filter(c=>c.status==='active').map(c=>'<option value="'+esc(c.name)+'"'+(c.name===pi.country?' selected':'')+'>'+esc(c.name)+(c.flag?(' '+c.flag):'')+'</option>').join('');
    const piNoLocked=!!pi.pi_no_locked;
    const piNoField=piNoLocked
      ? '<div class="form-group"><label>PI号（锁定）</label><input type="text" value="'+esc(pi.pi_no)+'" disabled><div class="form-hint" style="color:#fa8c16;font-size:12px">'+esc(pi.pi_no_lock_reason||t('gen.L5458.1','已锁定'))+'</div></div>'
      : '<div class="form-group"><label>PI号</label><input type="text" id="npi-no" value="'+esc(pi.pi_no)+'" placeholder="'+t('pi.no.edit_hint','留空保持原值；修改需唯一，系统自动校验')+'"></div>';
    const supOpts=suppliers.map(s=>'<option value="'+s.id+'" data-name="'+esc(s.name)+'" data-last="'+esc(s.last_used_payment_term_id||'')+'"'+(s.id===pi.supplier_id?' selected':'')+'>'+esc(s.name)+'</option>').join('');
    const curOpts=['USD','RMB','IDR','MYR','THB'].map(c=>'<option'+(c===pi.currency?' selected':'')+'>'+c+'</option>').join('');
    const body='<div class="form-card" style="box-shadow:none;padding:0">'
      +t('gen.L5468.2','<div style="margin-bottom:12px;padding:8px 12px;background:#f0f5ff;border:1px solid #adc6ff;border-radius:6px;font-size:12px;color:#333">编辑模式：可修改表头与明细并实时预览差异；保存将调用后端 PUT（付款条件变更自动回写供应商上次使用项）。PI号在未进入后续业务阶段时可修改（修改需唯一，系统自动校验）。「关联PO / 供应商」为锁定项不可改。</div>')
      +'<div class="form-grid">'
      +piNoField
      +'<div class="form-group"><label>'+t('app.113','国家')+'</label><select id="npi-country" onchange="onPICountryChange()">'+countryOpts+'</select></div>'
      +'<div class="form-group"><label>'+t('app.114','仓库')+'</label><select id="npi-wh"><option value="">（请选择仓库）</option></select></div>'
      +'<div class="form-group"><label>'+t('app.112','品牌')+'</label><select id="npi-brand"></select></div>'
      +t('gen.L5471.1','<div class="form-group"><label>关联PO（锁定）</label><input type="text" value="')+esc(pi.related_po_no||t("app.140", "\u65e0\u5173\u8054"))+'" disabled></div>'
      +t('gen.L5472.1','<div class="form-group"><label>供应商（锁定）</label><select id="npi-sup" disabled onchange="onPISupplierChange()">')+supOpts+'</select></div>'
      +t('gen.L5473.1','<div class="form-group"><label>PI日期</label><input type="date" id="npi-date" value="')+esc(pi.pi_date||'')+'"></div>'
      +t('gen.L5474.1','<div class="form-group"><label>币种</label><select id="npi-cur"')+((pi.deposit_payment_status==='pending_approval')?' disabled':'')+'>'+curOpts+'</select>'
      +((pi.deposit_payment_status==='pending_approval')?'<div class="form-hint" style="color:#fa8c16;font-size:12px">'+t('pi.currency.locked_hint','定金审批中，币种不可修改')+'</div>':'')+'</div>'
      +t('gen.L5475.1','<div class="form-group"><label>是否需要定金</label><select id="npi-need-dep" onchange="togglePIDeposit()"><option value="1"')+(piNeedsDeposit(pi.need_deposit)?' selected':'')+t('gen.L5475.2','>是</option><option value="0"')+(!piNeedsDeposit(pi.need_deposit)?' selected':'')+t('gen.L5475.3','>否</option></select></div>')
      +t('gen.L5476.1','<div class="form-group"><label>定金比例(%)</label><input type="number" id="npi-dep" value="')+(pi.deposit_ratio||0)+'"></div>'
      +t('gen.L5477.1','<div class="form-group"><label>预计交期</label><input type="date" id="npi-del" value="')+esc(pi.expected_delivery||'')+'"></div>'
      +t('gen.L5478.1','<div class="form-group"><label>付款条件</label><select id="npi-terms"><option value="">（未选择）</option></select></div>')
      +'</div>'
      +t('gen.L5480.1','<h4 style="margin:16px 0 8px">PO vs PI 合并对比 <button class="btn btn-secondary btn-sm" onclick="addPIRow()">➕ 添加行</button> <button class="btn btn-secondary btn-sm" onclick="openSupplierPIImport()">📥 导入供应商PI</button></h4>')
      +t('gen.L5481.1','<div class="table-container" style="max-height:52vh;overflow:auto;box-shadow:none;margin-bottom:8px"><table class="data-table pi-cmp-table" id="pi-items-table"><thead><tr><th>SKU</th><th>PO数量</th><th>PI确认数量</th><th>PO单价</th><th>PI确认单价</th><th>PI折扣</th><th>PI金额</th><th>数量差异</th><th>单价差异</th><th>操作</th></tr></thead><tbody id="pi-items"></tbody><tfoot id="pi-cmp-foot"></tfoot></table></div>')
      +'</div>';
    openModal(t('modal.title.editPI.2', '编辑PI - {v1}', {v1: esc(pi.pi_no)}),body,t('modal.footer.editPI', `<button class="btn btn-secondary" onclick="closeModal()">关闭</button><button class="btn btn-primary" onclick="saveEditPI('{v1}')">💾 保存</button>`, {v1: id}),'modal-pi');
    const sb=document.querySelector('.modal.show .btn-primary'); if(sb) sb.id='btn-save-edit-pi';
    // 预填明细（复用 computePODiff + renderCmpTable）
    window._piRows=computePODiff(poRef,pi.items||[]);renderCmpTable();
    // 仓库选项同步填充 + 回填保存值（预取数据，表单打开后立即填充，无空窗期；先加载选项→确认 option 存在→回填值）
    const wSel=document.getElementById('npi-wh');
    if(wSel){
      wSel.innerHTML='<option value="">（请选择仓库）</option>'+warehouses.map(w=>'<option value="'+esc(w.name||w.code||w)+'">'+esc(w.name||w.code||w)+'</option>').join('');
      wSel.value=pi.target_warehouse||'';
      if(pi.target_warehouse&&![...wSel.options].some(o=>o.value===pi.target_warehouse)){
        wSel.innerHTML+='<option value="'+esc(pi.target_warehouse)+'" data-saved-value-fallback="1">'+esc(pi.target_warehouse)+'</option>';
        wSel.value=pi.target_warehouse;
        window._piDataAnomalies=window._piDataAnomalies||[];
        window._piDataAnomalies.push({type:'warehouse_not_in_country_options',pi_id:pi.id,pi_no:pi.pi_no,country:pi.country,target_warehouse:pi.target_warehouse,detected_at:new Date().toISOString()});
        showToast(t('pi.warehouse.saved_value_missing','仓库数据异常：已保存仓库不在当前国家仓库列表中，已保留原值'),'warning');
      }
    }
    // 付款条件联动（异步，不阻塞仓库显示）
    await onPISupplierChange();
    // 付款条件预填
    const termSel=document.getElementById('npi-terms');
    if(termSel&&pi.payment_term_id&&[...termSel.options].some(o=>o.value===pi.payment_term_id))termSel.value=pi.payment_term_id;
    // 仅应用定金比例输入的禁用态，不改动已预填的比例值
    const needSel=document.getElementById('npi-need-dep'),depIn=document.getElementById('npi-dep');
    if(needSel&&depIn)depIn.disabled=needSel.value==='0';
    // 品牌选项填充 + 选中已保存品牌
    var bSel=document.getElementById('npi-brand');
    if(bSel){
      bSel.innerHTML='<option value="">（请选择品牌）</option>'+(brands||[]).map(function(b){return '<option value="'+esc(b)+'"'+(b===pi.brand?' selected':'')+'>'+esc(b)+'</option>';}).join('');
      if(pi.brand&&![...bSel.options].some(o=>o.value===pi.brand)){bSel.innerHTML+='<option value="'+esc(pi.brand)+'" selected>'+esc(pi.brand)+'</option>';}
    }
  }catch(e){showToast(e.message,'danger')}
}
async function saveEditPI(id){
  const btn=document.getElementById('btn-save-edit-pi');
  if(btn){btn.disabled=true;btn._old=btn.textContent;btn.textContent=t('common.saving','保存中…');}
  try{
    const termSel=document.getElementById('npi-terms');
    // 明细：仅组装有效 SKU 行（与 saveNewPI 同源，PUT 端会按 pi_confirmed_qty 重算金额/PO 同步）
    const items=[];
    (window._piRows||[]).forEach(r=>{if(r.sku&&r.sku.trim())items.push({sku_code:r.sku.trim(),po_qty:parseInt(r.poQty)||0,pi_confirmed_qty:parseInt(r.piQty)||0,unit_price:parseFloat(r.piPrice)||0,discount:parseFloat(r.piDisc)||0})});
    const termId=termSel?termSel.value:'';
    const paymentTermsText=(termId&&termSel.options[termSel.selectedIndex])?termSel.options[termSel.selectedIndex].textContent:'';
    const d={
      pi_date:document.getElementById('npi-date')?.value||'',
      currency:document.getElementById('npi-cur')?.value||'',
      payment_terms:paymentTermsText,
      payment_term_id:termId,
      expected_delivery:document.getElementById('npi-del').value,
      need_deposit:document.getElementById('npi-need-dep').value==='1'?1:0,
      deposit_ratio:parseFloat(document.getElementById('npi-dep').value)||0,
      pi_no:(document.getElementById('npi-no')?.value||'').trim(),
      brand:document.getElementById('npi-brand')?.value||'',
      country:document.getElementById('npi-country')?.value||'',
      target_warehouse:document.getElementById('npi-wh')?.value||'',
      items
    };
    // 调用第1层已落地的 PUT：内置锁定守卫 + 金额/PO transferred_pi_qty 同步 + 付款条件变更自动回写供应商 last_used
    const res=await api('/api/proforma-invoices/'+id,'PUT',d);
    showToast(t('toast.piSaved','PI 保存成功（总额 {amt}）',{amt:fmtMoney(res.total_amount)}),'success');
    closeModal();
    loadPI(); // 刷新 PI 列表
  }catch(e){showToast(e.message,'danger')}
  finally{ if(btn){btn.disabled=false;btn.textContent=btn._old||t('common.save','保存');} }
}
// 会话级主数据缓存（suppliers/countries/brands；PO/PI/明细/附件不缓存）
var _masterCache={suppliers:null,countries:null,brands:null,ts:0,TTL:5*60*1000};
async function _getMaster(keys){
  var now=Date.now(), expired=(now-_masterCache.ts)>_masterCache.TTL;
  var result={}, need=[];
  keys.forEach(function(k){ if(expired||!_masterCache[k]) need.push(k); else result[k]=_masterCache[k]; });
  if(need.length){
    var fetchers=need.map(function(k){
      if(k==='suppliers') return api('/api/suppliers');
      if(k==='countries') return api('/api/countries');
      if(k==='brands') return api('/api/brands/all');
      return Promise.resolve(null);
    });
    var fetched=await Promise.all(fetchers);
    need.forEach(function(k,i){ _masterCache[k]=fetched[i]; result[k]=fetched[i]; });
    _masterCache.ts=now;
  }
  return result;
}
// 设置品牌可编辑态（PO 关联→只读；无关联→可编辑）
function _setPIBrandEditable(editable){
  var bSel=document.getElementById('npi-brand');
  if(bSel) bSel.disabled=!editable;
}

async function createPI(){
  // 先开弹窗骨架 + Loading（立即响应，不等接口）
  openModal(t('gen.L5520.1','新建PI'),'<div style="padding:40px;text-align:center"><div style="font-size:32px;color:#1890ff;margin-bottom:8px">⏳</div><div style="color:#666">'+t('common.loading','加载中…')+'</div></div>','','modal-pi');
  // 并行加载主数据（带会话级缓存）；PO 列表不缓存
  var _piData;
  try{ _piData=await Promise.all([_getMaster(['suppliers','countries','brands']),api('/api/purchase-orders?status=approved')]);   }catch(e){showToast(e.message,'danger');return;}
  if(!document.getElementById('modal-overlay').classList.contains('show'))return; // 用户在 Loading 期间关闭了弹窗
  const suppliers=_piData[0].suppliers,pos=_piData[1],countries=_piData[0].countries,brands=_piData[0].brands;
  const countryOpts='<option value="">（请选择国家）</option>'+countries.filter(c=>c.status==='active').map(c=>'<option value="'+esc(c.name)+'"'+(c.default_currency?' data-cur="'+esc(c.default_currency)+'"':'')+'>'+esc(c.name)+(c.flag?(' '+c.flag):'')+'</option>').join('');
  const whOpts='<option value="">（请选择仓库）</option>';
  const brandOpts='<option value="">（请选择品牌）</option>'+(brands||[]).map(b=>'<option value="'+esc(b)+'">'+esc(b)+'</option>').join('');
  openModal(t('gen.L5520.1','新建PI'),t('modal.body.createPI', `<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>PI号（可选，留空自动生成）</label><input type="text" id="npi-no" placeholder="留空则系统自动生成"></div><div class="form-group"><label>关联PO</label><select id="npi-po" onchange="loadPOForPI()"><option value="">无关联</option>{v1}</select></div><div class="form-group"><label>供应商 <span class="required">*</span></label><select id="npi-sup" onchange="onPISupplierChange()">{v2}</select></div><div class="form-group"><label>国家 <span class="required">*</span></label><select id="npi-country" onchange="onPICountryChange()"></select></div><div class="form-group"><label>仓库 <span class="required">*</span></label><select id="npi-wh"></select></div><div class="form-group"><label>品牌 <span class="required">*</span></label><select id="npi-brand"></select></div><div class="form-group"><label>PI日期</label><input type="date" id="npi-date" value="{v3}"></div><div class="form-group"><label>币种</label><select id="npi-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div><div class="form-group"><label>是否需要定金</label><select id="npi-need-dep" onchange="togglePIDeposit()"><option value="1">${t('term.yes','是')}</option><option value="0">${t('term.no','否')}</option></select></div><div class="form-group"><label>定金比例(%)</label><input type="number" id="npi-dep" value="30"></div><div class="form-group"><label>预计交期</label><input type="date" id="npi-del"></div><div class="form-group"><label>付款条件</label><select id="npi-terms"><option value="">（未选择）</option></select></div></div><h4 style="margin:16px 0 8px">PO vs PI 合并对比 <button class="btn btn-secondary btn-sm" onclick="addPIRow()">➕ 添加行</button> <button class="btn btn-secondary btn-sm" onclick="openSupplierPIImport()">📥 导入供应商PI</button> <button class="btn btn-secondary btn-sm" onclick="downloadDocTemplate('supplierPI')">📄 模板</button></h4><div class="pi-table-scroll" style="max-height:52vh;overflow:auto;box-shadow:none;margin-bottom:8px"><table class="data-table pi-cmp-table" id="pi-items-table"><thead><tr><th>SKU</th><th>PO数量</th><th>PI确认数量</th><th>PO单价</th><th>PI确认单价</th><th>PI折扣</th><th>PI金额</th><th>数量差异</th><th>单价差异</th><th>操作</th></tr></thead><tbody id="pi-items"></tbody><tfoot id="pi-cmp-foot"></tfoot></table></div></div>`, {v1: pos.map(p=>'<option value="'+p.id+'" data-no="'+p.po_no+'">'+esc(p.po_no)+' - '+esc(p.supplier_name)+'</option>').join(''), v2: suppliers.map(s=>'<option value="'+s.id+'" data-name="'+esc(s.name)+'" data-last="'+esc(s.last_used_payment_term_id||'')+'">'+esc(s.name)+'</option>').join(''), v3: todayStr()}),t('gen.L5520.2','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveNewPI()">创建</button>'),'modal-pi');
  window._piRows=[];renderCmpTable();
  onPISupplierChange();
  // 统一填充 select 选项（三语模板结构一致，选项由 JS 填充）
  var _cSelPI=document.getElementById('npi-country');if(_cSelPI)_cSelPI.innerHTML=countryOpts;
  var _wSelPI=document.getElementById('npi-wh');if(_wSelPI)_wSelPI.innerHTML=whOpts;
  var _bSelPI=document.getElementById('npi-brand');if(_bSelPI)_bSelPI.innerHTML=brandOpts;
  const sb=document.querySelector('.modal.show .btn-primary'); if(sb) sb.id='btn-save-new-pi';
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
// 国家 → 仓库联动（按国家过滤启用的仓库）
async function populatePIWarehouse(country){
  const wSel=document.getElementById('npi-wh');
  if(!wSel)return;
  if(!country){wSel.innerHTML='<option value="">（请选择仓库）</option>';return;}
  try{
    const whs=await api('/api/warehouses/by-country?country='+encodeURIComponent(country));
    wSel.innerHTML='<option value="">（请选择仓库）</option>'+whs.map(w=>'<option value="'+esc(w.name||w.code||w)+'">'+esc(w.name||w.code||w)+'</option>').join('');
  }catch(e){ wSel.innerHTML='<option value="">（请选择仓库）</option>'; }
}
// 国家变更 → 重新拉取仓库下拉（不改变用户已选国家/仓库之外的字段）
function onPICountryChange(){
  const cSel=document.getElementById('npi-country');
  populatePIWarehouse(cSel?cSel.value:'');
}
// 设置/恢复 国家+仓库 可编辑态（新建：PO 关联→只读；无关联→可编辑）
function setPICountryWarehouseEditable(editable){
  const cSel=document.getElementById('npi-country'),wSel=document.getElementById('npi-wh');
  if(cSel)cSel.disabled=!editable;
  if(wSel)wSel.disabled=!editable;
  _setPIBrandEditable(editable); // 品牌随国家/仓库同步可编辑态
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
async function loadPOForPI(){const poId=document.getElementById('npi-po').value;window._poRef=null;const curSel=document.getElementById('npi-cur');const cSel=document.getElementById('npi-country'),wSel=document.getElementById('npi-wh');if(!poId){if(curSel)curSel.disabled=false;setPICountryWarehouseEditable(true);var _bSel0=document.getElementById('npi-brand');if(_bSel0)_bSel0.value='';if(cSel)cSel.value='';if(wSel)wSel.innerHTML='<option value="">（请选择仓库）</option>';renderCmpTable();return;}try{const po=await api('/api/purchase-orders/'+poId);const supSel=document.getElementById('npi-sup');let sid=po.supplier_id;if(sid&&![...supSel.options].some(o=>o.value===sid)){const byName=[...supSel.options].find(o=>o.dataset.name===po.supplier_name);if(byName)sid=byName.value;}supSel.value=sid||'';onPISupplierChange();if(curSel){curSel.value=po.currency;curSel.disabled=true;}// PO 关联：国家+仓库自动带出（只读，用户不可改）；切回无关联时恢复可编辑（见上分支）
  if(cSel){cSel.value=po.country||'';cSel.disabled=true;}
  if(wSel){await populatePIWarehouse(po.country||'');wSel.value=po.target_warehouse||'';wSel.disabled=true;}var _bSelPI=document.getElementById('npi-brand');if(_bSelPI){if(po.brand){if(![..._bSelPI.options].some(o=>o.value===po.brand)){_bSelPI.innerHTML='<option value="'+esc(po.brand)+'">'+esc(po.brand)+'</option>';}_bSelPI.value=po.brand;}_bSelPI.disabled=true;}
  window._poRef=po.items||[];const extra=(window._piRows||[]).filter(r=>!r.fromPO);window._piRows=(po.items||[]).map(it=>({sku:it.sku_code||'',poQty:it.po_qty||0,poPrice:it.unit_price||0,piQty:0,piPrice:0,piDisc:0,fromPO:true})).concat(extra);renderCmpTable();}catch(e){showToast(e.message,'danger')}}
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
  const btn=document.getElementById('btn-save-new-pi');
  if(btn){btn.disabled=true;btn._old=btn.textContent;btn.textContent=t('common.saving','保存中…');}
  const poSel=document.getElementById('npi-po'),supSel=document.getElementById('npi-sup'),termSel=document.getElementById('npi-terms');const items=[];
  (window._piRows||[]).forEach(r=>{if(r.sku&&r.sku.trim())items.push({sku_code:r.sku.trim(),po_qty:parseInt(r.poQty)||0,pi_confirmed_qty:parseInt(r.piQty)||0,unit_price:parseFloat(r.piPrice)||0,discount:parseFloat(r.piDisc)||0})});
  const termId=termSel?termSel.value:'';
  const paymentTermsText=(termId&&termSel.options[termSel.selectedIndex])?termSel.options[termSel.selectedIndex].textContent:'';
  // 品牌：统一从表单读取（PO 关联时为只读预填值，无关联时为用户选择）
  const brand=document.getElementById('npi-brand')?.value||'';
  const country=document.getElementById('npi-country')?.value||'';
  const target_warehouse=document.getElementById('npi-wh')?.value||'';
  const d={related_po_id:poSel.value||'',related_po_no:poSel.options[poSel.selectedIndex]?.dataset.no||'',supplier_id:supSel.value,supplier_name:supSel.options[supSel.selectedIndex].dataset.name,brand,country,target_warehouse,pi_no:(document.getElementById('npi-no')?.value||'').trim()||'',pi_date:document.getElementById('npi-date').value,currency:document.getElementById('npi-cur').value,need_deposit:document.getElementById('npi-need-dep').value==='1'?1:0,deposit_ratio:parseFloat(document.getElementById('npi-dep').value)||0,expected_delivery:document.getElementById('npi-del').value,payment_terms:paymentTermsText,payment_term_id:termId,items};
  try{
    await api('/api/proforma-invoices','POST',d);
    if(termId&&supSel.value){try{await api('/api/suppliers/'+encodeURIComponent(supSel.value)+'/last-payment-term','POST',{payment_term_id:termId});}catch(e){}}
    showToast(t('gen.L5697.1','PI创建成功'),'success');closeModal();loadPI();
  }catch(e){showToast(e.message,'danger')}
  finally{ if(btn){btn.disabled=false;btn.textContent=btn._old||t('common.save','保存');} }
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

// ==================== CI 详情附件统一（CI-DETAIL-UX：仅 CI 详情 modal 使用，不改 PI/其他 modal） ====================
function ciUnifiedAttachmentHtml(ci){
  var slot=function(field,label,val){
    var a=parseAttachmentValue(val);var has=a&&a.dataUrl;
    var body=has
      ? '<span class="link-text" onclick="ciPreviewAttachment(\'ci\',\''+ci.id+'\',\''+field+'\')">'+esc(a.name||label)+'</span>'
        +' <button class="btn btn-secondary btn-sm" onclick="downloadAttachment(\'ci\',\''+ci.id+'\',\''+field+'\')">下载</button>'
        +' <button class="btn btn-secondary btn-sm" onclick="uploadDocAttachment(\'ci\',\''+ci.id+'\',\''+field+'\')">重传</button>'
        +' <button class="btn btn-danger btn-sm" onclick="deleteDocAttachment(\'ci\',\''+ci.id+'\',\''+field+'\')">删除</button>'
      : '<button class="btn btn-secondary btn-sm" onclick="uploadDocAttachment(\'ci\',\''+ci.id+'\',\''+field+'\')">上传</button>';
    return '<div class="ci-attach-slot" ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ondragleave="this.classList.remove(\'drag-over\')" ondrop="event.preventDefault();this.classList.remove(\'drag-over\');ciDropUpload(\'ci\',\''+ci.id+'\',\''+field+'\',event)">'
      +'<div class="ci-attach-label">'+label+'</div><div class="ci-attach-body">'+body+'</div></div>';
  };
  return '<style>.ci-attach-unified{display:flex;gap:14px;flex-wrap:wrap}.ci-attach-slot{flex:1;min-width:220px;border:1px dashed #ccd3dc;border-radius:8px;padding:12px;background:#fafbfc;transition:.15s}.ci-attach-slot.drag-over{border-color:#2e7d32;background:#eef9ee}.ci-attach-label{font-size:12px;color:#666;margin-bottom:8px;font-weight:600}.ci-attach-body{display:flex;gap:6px;align-items:center;flex-wrap:wrap}</style>'
    +'<div class="ci-attach-unified">'
    +slot('attachment',t('ci.003','CI附件'),ci.attachment)
    +slot('pl_attachment',t('ci.004','PL附件'),ci.pl_attachment)
    +'</div>';
}
async function ciDropUpload(docType,id,field,event){
  var f=event.dataTransfer&&event.dataTransfer.files&&event.dataTransfer.files[0];if(!f)return;
  var r=new FileReader();r.onload=async function(e){
    var attachment={name:f.name,type:f.type,size:f.size,dataUrl:e.target.result,uploaded_at:new Date().toISOString()};
    try{
      var url=(docType==='pi'?'/api/proforma-invoices/':'/api/commercial-invoices/')+id+'/attachment';
      await api(url,'POST',{field:field,attachment:attachment});
      showToast(t('gen.L5748.1','附件已上传'),'success');
      if(docType==='pi'){loadPI();}else{await viewCI(id);}
    }catch(err){showToast(err.message,'danger');}
  };r.readAsDataURL(f);
}
function ciPreviewAttachment(docType,id,field){
  api((docType==='pi'?'/api/proforma-invoices/':'/api/commercial-invoices/')+id).then(function(d){
    var a=parseAttachmentValue(d[field]);if(!a||!a.dataUrl){showToast(t('gen.L5751.1','暂无附件'),'warning');return;}
    window.open(a.dataUrl,'_blank');
  }).catch(function(e){showToast(e.message,'danger');});
}
// ==================== CI/PL管理 ====================
function canImportHistoricalCI(){return hasPermission('ci_create')&&hasPermission('payment_create')&&hasPermission('payment_approve')}
async function renderCI(){
  const ciFilterControls = '<div class="filter-group"><label>'+t('field.country','国家')+'</label><select id="ci-country" onchange="onCIFilterChange()"><option value="">全部</option></select></div><div class="filter-group"><label>'+t('field.target_warehouse','仓库')+'</label><select id="ci-warehouse" onchange="onCIFilterChange()"><option value="">全部</option></select></div><div class="filter-group"><label>'+t('field.brand','品牌')+'</label><select id="ci-brand" onchange="onCIFilterChange()"><option value="">全部</option></select></div>';
  document.getElementById('content-inner').innerHTML=t('html.renderCI', '<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>单据类型</label><select id="ci-source-mode" onchange="onCISourceModeChange()"><option value="operational">运营 CI</option><option value="historical">历史 CI</option><option value="all">全部</option></select></div><div class="filter-group"><label>入库状态</label><select id="ci-inbound-fs"><option value="">全部</option><option value="none">未入库</option><option value="partial">部分入库</option><option value="completed">已入库</option></select></div>' + ciFilterControls + '<div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadCI()">搜索</button>{v1}{v2}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">🚚 CI/PL列表</div></div><div id="ci-purchase-summary"></div><div id="ci-table"></div></div>', {v1: hasPermission('ci_create')?t('gen.L5756.1','<button class="btn btn-primary btn-sm" onclick="createCI()">➕ 新建CI</button>'):'', v2: ''});
  refreshCIFilterOptions();
  loadCI();
}
function onCISourceModeChange(){const mode=document.getElementById('ci-source-mode')?.value||'operational',fs=document.getElementById('ci-inbound-fs');if(fs)fs.disabled=mode==='historical';refreshCIFilterOptions();loadCI()}
async function refreshCIFilterOptions(){
  try{
    const mode=document.getElementById('ci-source-mode')?.value||'operational';
    const country=document.getElementById('ci-country')?.value||'';
    const warehouse=document.getElementById('ci-warehouse')?.value||'';
    const brand=document.getElementById('ci-brand')?.value||'';
    const q='mode='+encodeURIComponent(mode)+'&country='+encodeURIComponent(country)+'&warehouse='+encodeURIComponent(warehouse)+'&brand='+encodeURIComponent(brand);
    const opts=await api('/api/ci-filter-options?'+q);
    fillCISelect('ci-country', opts.countries||[], country);
    fillCISelect('ci-warehouse', opts.warehouses||[], warehouse);
    const wh=document.getElementById('ci-warehouse'); if(wh) wh.disabled=(mode==='historical');
  }catch(e){ /* 选项刷新失败不影响列表渲染 */ }
}
function fillCISelect(id, values, current){
  const sel=document.getElementById(id); if(!sel)return;
  const keep=values.indexOf(current)>=0?current:'';
  sel.innerHTML='<option value="">全部</option>'+values.map(function(v){return '<option value="'+esc(String(v))+'"'+(v===keep?' selected':'')+'>'+esc(String(v))+'</option>';}).join('');
}
function onCIFilterChange(){ refreshCIFilterOptions(); loadCI(); }
function renderOperationalCITable(data){
  return !data.length?t('gen.L5761.1','<div class="empty-state"><div class="empty-icon">🚚</div>暂无运营CI</div>'):t('gen.L5761.2','<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>CI号</th><th>'+t('ci.col.type','CI类型')+'</th><th>关联PI</th><th>供应商</th><th>品牌</th><th>国家</th><th>仓库</th><th>'+t('ci.col.ship_date','出货日期')+'</th><th>币种</th><th>CI金额</th><th>已付定金</th><th>应付尾款</th><th>'+t('ci.col.related_logistics','关联物流单')+'</th><th>'+t('ci.col.logistics_status','物流状态')+'</th><th>'+t('ci.col.inbound_status','入库状态')+'</th><th>'+t('col.status','状态')+'</th><th>操作</th></tr></thead><tbody>')+data.map(c=>'<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewCI\',\''+c.id+'\')"><td class="cell-id"><span class="link-text" onclick="viewCI(\''+c.id+'\')">'+esc(c.ci_no)+'</span></td><td>'+ciTypeBadge('operational')+'</td><td class="cell-id" style="max-width:160px">'+renderMultiPICell(c)+'</td><td>'+esc(c.supplier_name)+'</td><td>'+esc(c.brand)+'</td><td>'+esc(c.country)+'</td><td>'+esc(c.target_warehouse)+'</td><td class="cell-date">'+fmtDate(c.actual_ship_date||c.ci_date)+'</td><td>'+esc(c.currency)+'</td><td class="text-right">'+fmtMoney(c.goods_amount)+'</td><td class="text-right">'+fmtMoney(c.actual_deducted_deposit)+'</td><td class="text-right">'+fmtMoney(c.payable_balance)+'</td><td class="cell-id" style="max-width:140px">'+esc(c.related_logistics_batch_nos||'—')+'</td><td><span class="status-badge '+logisticsStatusBadgeClassByKey(c.ci_logistics_display_status)+'">'+logisticsStatusLabelByKey(c.ci_logistics_display_status)+'</span></td><td><span class="status-badge '+ciInboundStatusBadgeClass(c.inbound_derived_status)+'">'+ciInboundStatusLabel(c.inbound_derived_status)+'</span></td><td><span class="status-badge status-completed">'+t('ci.status.shipped','已出货')+'</span></td><td class="cell-actions"><button class="action-btn" onclick="viewCI(\''+c.id+'\')">👁️</button><button class="action-btn" onclick="uploadDocAttachment(\'ci\',\''+c.id+t('gen.L5761.3','\',\'attachment\')" title="\u4e0a\u4f20CI\u9644\u4ef6">📎</button><button class="action-btn" onclick="uploadDocAttachment(\'ci\',\'')+c.id+t('gen.L5761.4','\',\'pl_attachment\')" title="\u4e0a\u4f20PL\u9644\u4ef6">📦</button>')+(c.payable_balance>0&&c.balance_payment_status==='unpaid'&&hasPermission('payment_create')?'<button class="action-btn" onclick="createBalPay(\''+c.id+t('gen.L5761.5','\')" title="尾款付款">💰</button>'):'')+(hasPermission('cost_view')?'<button class="action-btn" onclick="viewCICost(\''+c.id+t('gen.L5761.6','\')" title="费用管理">📊</button>'):'')+(hasPermission('ci_edit')?'<button class="action-btn" '+((c.ci_status==='completed'||c.ci_status==='partial_inbound')?t('gen.L5761.7','disabled title="\u8be5\u72b6\u6001\u4e0d\u53ef\u4f5c\u5e9f" style="opacity:.3;cursor:not-allowed"'):'onclick="voidCI(\''+c.id+t('gen.L5761.8','\')" title="\u4f5c\u5e9f"'))+t('gen.L5761.9','>作废</button>'):'')+'</td></tr>').join('')+'</tbody></table></div>';
}
function renderHistoricalCITable(data){
  return !data.length?t('gen.L5764.1','<div class="empty-state"><div class="empty-icon">📚</div>暂无历史CI</div>'):t('gen.L5764.2','<div style="font-size:12px;color:#666;padding:10px 0">仅用于历史采购金额和应付管理，不影响库存、WAC及订单预测。</div><div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>历史CI号</th><th>'+t('ci.col.type','CI类型')+'</th><th>供应商</th><th>品牌</th><th>国家</th><th>日期</th><th>币种</th><th>总货款</th><th>导入历史已付</th><th>后续已付</th><th>抵扣</th><th>抹零</th><th>未结金额</th><th>付款状态</th><th>到期日</th><th>操作</th></tr></thead><tbody>')+data.map(h=>{const st=h.payment_status==='paid'?'status-paid':String(h.payment_status||'').includes('partial')?'status-pending':'status-unpaid';return '<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewHistoricalCI\',\''+h.id+'\')"><td class="cell-id"><span class="link-text" onclick="viewHistoricalCI(\''+h.id+'\')">'+esc(h.historical_ci_no)+'</span></td><td>'+ciTypeBadge('historical')+'</td><td>'+esc(h.supplier_name)+'</td><td>'+esc(h.brand_name)+'</td><td>'+esc(h.country)+'</td><td class="cell-date">'+fmtDate(h.ci_date)+'</td><td>'+esc(h.currency)+'</td><td class="text-right font-bold">'+fmtMoney(h.gross_goods_amount)+'</td><td class="text-right">'+fmtMoney(h.historical_paid_amount)+'</td><td class="text-right">'+fmtMoney(h.subsequent_paid_amount)+'</td><td class="text-right">'+fmtMoney(h.deduction_amount)+'</td><td class="text-right">'+fmtMoney(h.rounding_amount)+'</td><td class="text-right '+(Number(h.unpaid_amount||0)>0?'text-danger':'')+'">'+fmtMoney(h.unpaid_amount)+'</td><td><span class="status-badge '+st+'">'+esc(PAY_STATUS_MAP[h.payment_status]||h.payment_status)+'</span></td><td class="cell-date">'+fmtDate(h.due_date)+'</td><td class="cell-actions"><button class="action-btn" onclick="viewHistoricalCI(\''+h.id+t('gen.L5764.3','\')" title="\u67e5\u770b\u5386\u53f2CI">👁️</button>')+(hasPermission('payment_view')?'<button class="action-btn" onclick="viewPayment(\''+h.payment_request_id+t('gen.L5764.4','\')" title="\u4ed8\u6b3e\u4e0e\u7ed3\u7b97">💳</button>'):'')+'</td></tr>'}).join('')+'</tbody></table></div>';
}
function renderPurchaseAmountSummary(summary){
  const scope=(label,data)=>'<div class="stat-card"><div class="stat-label">'+label+'</div><div class="stat-number" style="font-size:17px">'+((data.by_currency||[]).map(x=>esc(x.currency)+' '+Number(x.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})).join(' · ')||'0.00')+'</div><div style="font-size:12px;color:#999;margin-top:4px">'+data.count+t('gen.L5767.1',' 张；人民币待补 ')+data.rmb_pending_count+t('gen.L5767.2',' 张</div></div>');
  return '<div class="stats-grid mb-16" style="grid-template-columns:repeat(3,minmax(0,1fr))">'+scope(t("app.978", "\u8fd0\u8425\u91c7\u8d2d\u91d1\u989d"),summary.operational)+scope(t('gen.L5768.1','历史采购金额'),summary.historical)+scope(t("app.979", "\u91c7\u8d2d\u91d1\u989d\u5408\u8ba1\uff08\u6309\u5e01\u79cd\uff09"),summary.total)+'</div><div style="font-size:12px;color:#999;margin:-8px 0 12px">'+esc(summary.rmb_note||'')+'</div>';
}
// ── Multi-PI display helpers ��─
// ── CI list display helpers ──
function ciTypeBadge(type){
  if(type==='historical')return '<span class="ci-type-badge ci-type-hist">'+t('ci.type.historical','历史CI')+'</span>';
  return '<span class="ci-type-badge ci-type-op">'+t('ci.type.operational','运营CI')+'</span>';
}
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
    const mode=document.getElementById('ci-source-mode')?.value||'operational',s=document.getElementById('ci-inbound-fs')?.value||'';
    const country=document.getElementById('ci-country')?.value||'';
    const warehouse=document.getElementById('ci-warehouse')?.value||'';
    const brand=document.getElementById('ci-brand')?.value||'';
    const opQ='inbound_status='+encodeURIComponent(s)+(country?'&country='+encodeURIComponent(country):'')+(warehouse?'&warehouse='+encodeURIComponent(warehouse):'')+(brand?'&brand='+encodeURIComponent(brand):'');
    const histQ=(country?'country='+encodeURIComponent(country):'')+(brand?'&brand='+encodeURIComponent(brand):'');
    const results=await Promise.all([mode==='historical'?Promise.resolve([]):api('/api/commercial-invoices?'+opQ),mode==='operational'?Promise.resolve([]):api('/api/historical-commercial-invoices'+(histQ?'?'+histQ:'')),api('/api/purchase-amount-summary')]);
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
    body+='<div id="hci-items-h-summary" style="display:none;margin-top:8px;padding:8px 12px;background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;font-size:13px"></div>';

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

    // Row 5: Warehouse + CI Date + Actual Ship Date
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.target_warehouse','目标仓库')+' <span class="required">*</span></label><input id="hci-wh" readonly style="background:#f5f5f5" placeholder="'+t('ci.warehouse_auto','选择PI后自动填入')+'"><input type="hidden" id="hci-wh-id"></div>';
    body+='<div class="form-group"><label>'+t('field.ci_date','CI 日期')+' <span class="required">*</span></label><input type="date" id="hci-date"></div>';
    body+='<div class="form-group"><label>'+t('field.actual_ship_date','实际出货日期')+' <span class="required">*</span></label><input type="date" id="hci-ship-date" onchange="calcHciDueDate()"><div style="font-size:12px;color:#999">'+t('hci.ship_date_hint','用于信用账期计算，与 CI 日期不同')+'</div></div></div>';

    // Row 6: Gross Amount + Historical Paid
    body+='<div class="form-grid">';
    body+='<div class="form-group" id="hci-gross-group"><label>'+t('field.gross_amount','历史货款总金额')+' <span class="required">*</span></label><input type="number" min="0.01" step="0.01" id="hci-gross" placeholder="0.00"><div id="hci-gross-hint" style="font-size:12px;color:#999"></div></div>';
    body+='<div class="form-group"><label>'+t('field.historical_paid','导入前历史已付款')+'</label><input type="number" min="0" step="0.01" id="hci-paid" value="0" placeholder="0.00"></div></div>';

    // Row 7: Paid Date + Payment Terms
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.paid_date','历史已付款日期')+'</label><input type="date" id="hci-paid-date"><div style="font-size:12px;color:#999">'+t('hci.paid_date_hint','未知时保持为空，不会用导入日期代替')+'</div></div>';
    body+='<div class="form-group"><label>'+t('field.payment_terms','付款条件/账期')+'</label><select id="hci-terms" onchange="calcHciDueDate()"><option value="">'+t('app.none','无')+'</option>';
    termOpts.forEach(function(tm){body+='<option value="'+esc(tm.name)+'"'+(tm.credit_days>0?' data-credit="'+tm.credit_days+'"':'')+'>'+esc(tm.name)+(tm.credit_days>0?' ('+tm.credit_days+t('unit.days','天')+')':'')+'</option>';});
    body+='</select></div></div>';

    // Row 8: Due Date + Notes
    body+='<div class="form-grid">';
    body+='<div class="form-group"><label>'+t('field.due_date','到期日')+'</label><input type="date" id="hci-due"></div>';
    body+='<div class="form-group"><label>'+t('field.source_note','原始凭证或备注')+'</label><input id="hci-note" placeholder="'+t('hci.note_hint','可选')+'"></div></div>';

    body+='</div>';

    window._hciR=0;window._hciAllItems=[];window._hciSelectedPiIds=[];
  openModal(t("po.037", "历史 CI 导入"), body,
      t('hci.footer_btns','<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="hci-save" onclick="saveHistoricalCI()">导入</button>'),'modal-ci-create');

    // Apply default (linked) mode state: hide manual gross input + lock currency
    onHistoricalPIModeChange();

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
        html+='<input type="checkbox" class="hci-pi-cb" value="'+p.id+'" data-no="'+esc(p.pi_no)+'" data-cur="'+p.currency+'" data-wh="'+esc(p.target_warehouse||'')+'" data-wh-id="'+(p.warehouse_id||'')+'" onchange="onHciPISelectionChange()" style="flex-shrink:0;width:16px;height:16px">';
        html+='<span style="font-size:13px;font-weight:500;color:#333;white-space:nowrap">'+esc(p.pi_no)+'</span>';
        html+='</div>';
        html+='<div style="font-size:12px;color:#888;margin-top:4px;padding-left:24px">'+t('ci.pi.remain','剩余可出货：')+remain+' '+t('unit.pcs','件')+'</div>';
        html+='</label>';
      });
      piList.innerHTML=html;
    }
    window._hciAllItems=[];window._hciR=0;window._hciSelectedPiIds=[];updateHciPiTriggerText();
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
  // Gross amount field: only manual input in non-linked mode
  var grossGroup=document.getElementById('hci-gross-group');
  var grossHint=document.getElementById('hci-gross-hint');
  var curSel=document.getElementById('hci-currency');
  if(mode.value==='linked'){
    if(grossGroup)grossGroup.style.display='none';
    if(grossHint)grossHint.textContent=t('hci.gross_auto_hint','关联 PI 时，历史货款总金额由 CI 明细金额自动汇总');
    if(curSel){curSel.disabled=true;curSel.style.background='#f5f5f5';}
  }else{
    if(grossGroup)grossGroup.style.display='';
    if(grossHint)grossHint.textContent='';
    if(curSel){curSel.disabled=false;curSel.style.background='';}
    // manual mode: clear any auto-filled gross so user must enter manually
    var gi=document.getElementById('hci-gross');if(gi)gi.value='';
  }
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
  var opening=dd.style.display==='none';
  dd.style.display=opening?'block':'none';
  // Restore checked state from current selection when re-opening
  if(opening){
    var selIds=window._hciSelectedPiIds||[];
    var cbs=dd.querySelectorAll('.hci-pi-cb');
    cbs.forEach(function(cb){cb.checked=selIds.indexOf(cb.value)!==-1;});
    updateHciPiTriggerText();
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
  try{await aggregateHciPIItems(piIds);}catch(e){showToast(e.message,'danger')}
  resolveCIWarehouse('.hci-pi-cb','hci-wh','hci-wh-id');
}

// ── Aggregate line items from selected PIs (informational reference table) ──
async function aggregateHciPIItems(piIds){
  var preview=document.getElementById('hci-items-preview'),summary=document.getElementById('hci-items-h-summary');
  if(!preview)return;
  if(!piIds||piIds.length===0){preview.style.display='none';if(summary)summary.style.display='none';window._hciAllItems=[];window._hciR=0;return;}

  // Fetch all selected PIs and collect line items (same as operational CI)
  var allItems=[];
  window._hciR=0;
  for(var i=0;i<piIds.length;i++){
    try{
      var pi=await api('/api/proforma-invoices/'+piIds[i]);
      (pi.items||[]).forEach(function(it){
        if((it.unshipped_qty||0)>0.001){
          var disc=it.discount||0;
          var up=it.unit_price||0;
          var netUp=up*(1-disc);
          allItems.push({
            pi_id:pi.id,pi_no:pi.pi_no,sku_code:it.sku_code,
            pi_confirmed_qty:it.pi_confirmed_qty||0,shipped_qty:it.shipped_qty||0,
            unshipped_qty:it.unshipped_qty||0,unit_price:up,
            discount:disc,net_unit_price:netUp,
            reference_customs_rate:it.reference_customs_rate,currency:pi.currency,
            idx:window._hciR++
          });
        }
      });
    }catch(e){}
  }
  window._hciAllItems=allItems;

  if(allItems.length===0){preview.style.display='none';if(summary)summary.style.display='none';return;}

  // Build 11-column table (matching operational CI: +原单价/折扣/折后单价)
  var html='<table class="data-table ci-detail-table" style="margin:0;font-size:12px">'+
    '<colgroup><col style="width:12%"><col style="width:10%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:10%"><col style="width:8%"><col style="width:7%"><col style="width:8%"><col style="width:10%"><col style="width:40px"></colgroup>'+
    '<thead><tr>'+
    '<th class="ci-col-sku">SKU</th><th class="ci-col-pi">'+t('ci.col.pi_source','PI来源')+'</th>'+
    '<th class="ci-col-right">'+t('ci.col.pi_confirmed','PI总数量')+'</th>'+
    '<th class="ci-col-right">'+t('ci.col.pi_shipped','已出货')+'</th>'+
    '<th class="ci-col-right">'+t('ci.col.pi_unshipped','未出货')+'</th>'+
    '<th class="ci-col-right">'+t('ci.col.ci_qty','本次CI数量')+'</th>'+
    '<th class="ci-col-right">'+t('field.original_unit_price','原单价')+'</th>'+
    '<th class="ci-col-right">'+t('field.discount','折扣')+'</th>'+
    '<th class="ci-col-right">'+t('field.net_unit_price','折后单价')+'</th>'+
    '<th class="ci-col-right">'+t('ci.col.amount','金额')+'</th>'+
    '<th class="ci-col-act">'+t('app.operation','操作')+'</th></tr></thead><tbody>';

  allItems.forEach(function(it){
    var cQty=it.pi_confirmed_qty||0,sQty=it.shipped_qty||0,uQty=it.unshipped_qty||0;
    var disc=it.discount||0;
    var netUp=it.net_unit_price||0;
    html+='<tr id="hci-r-'+it.idx+'" data-pi-id="'+it.pi_id+'">'+
      '<td class="ci-col-sku">'+esc(it.sku_code)+'</td>'+
      '<td class="ci-col-pi" style="font-size:12px;color:#888">'+esc(it.pi_no)+'</td>'+
      '<td class="ci-col-right" style="color:#888">'+cQty+'</td>'+
      '<td class="ci-col-right" style="color:#888">'+sQty+'</td>'+
      '<td class="ci-col-right" style="color:#888">'+uQty+'</td>'+
      '<td class="ci-col-right"><input type="number" id="hci-rq-'+it.idx+'" value="'+uQty+'" min="0" max="'+uQty+'" onchange="updateHciCISummary()" oninput="updateHciCISummary()"></td>'+
      '<td class="ci-col-right" style="color:#888">'+fmtMoney(it.unit_price)+'</td>'+
      '<td class="ci-col-right" style="color:#888">'+(disc>0?(disc*100).toFixed(1)+'%':'—')+'</td>'+
      '<td class="ci-col-right" style="color:#888">'+fmtMoney(netUp)+'</td>'+
      '<td class="ci-col-right" style="font-weight:bold" id="hci-ra-'+it.idx+'">'+fmtMoney(uQty*netUp)+'</td>'+
      '<td class="ci-col-act"><button onclick="deleteHciCIRow('+it.idx+')" style="color:#bbb;border:none;background:none;cursor:pointer;font-size:13px;line-height:1;padding:2px 4px" title="'+t('common.delete','删除')+'">×</button></td>'+
      '</tr>';
  });

  html+='</tbody></table>';
  preview.innerHTML=html;
  preview.style.display='';

  // Show summary
  updateHciCISummary();
  // linked mode: lock currency to PI currency (multi-PI share same currency per R4)
  var modeChk0=document.querySelector('input[name="hci-pi-mode"]:checked');
  if(modeChk0&&modeChk0.value==='linked'){
    var curSel0=document.getElementById('hci-currency');
    var itemCur=(allItems[0]||{}).currency||'';
    if(curSel0&&itemCur){curSel0.value=itemCur;curSel0.disabled=true;curSel0.style.background='#f5f5f5';}
  }
}

// ── Historical CI real-time summary ──
function getHciItemTotal(){
  var allItems=window._hciAllItems||[],total=0;
  allItems.forEach(function(it){
    var qe=document.getElementById('hci-rq-'+it.idx);
    var q=parseInt(qe?qe.value:0)||0;
    var netUp=it.net_unit_price||0;
    if(q>0)total+=q*netUp;
  });
  return total;
}
function updateHciCISummary(){
  var summary=document.getElementById('hci-items-h-summary'),allItems=window._hciAllItems||[];
  if(!summary||allItems.length===0){if(summary)summary.style.display='none';return;}
  var totalQty=0,totalAmt=getHciItemTotal();
  allItems.forEach(function(it){
    var qe=document.getElementById('hci-rq-'+it.idx);
    var q=parseInt(qe?qe.value:0)||0;
    if(q>0){totalQty+=q;
      var netUp=it.net_unit_price||0;
      var ae=document.getElementById('hci-ra-'+it.idx);if(ae)ae.textContent=fmtMoney(q*netUp);}
  });
  // linked mode: auto-fill gross_goods_amount from CI detail total
  var modeChk=document.querySelector('input[name="hci-pi-mode"]:checked');
  if(modeChk&&modeChk.value==='linked'){var gi=document.getElementById('hci-gross');if(gi)gi.value=totalAmt;}
  summary.style.display='';
  var currency=(allItems[0]||{}).currency||'';
  summary.innerHTML='<div class="ci-summary-bar">'+
    '<span>'+t('ci.summary.qty','合计数量：{v1} 件',{v1:totalQty})+'</span>'+
    '<span class="ci-sum-right">'+t('ci.summary.amt','CI金额：{v1} {v2}',{v1:fmtMoney(totalAmt),v2:currency})+'</span>'+
    '</div>';
}

// ── Historical CI delete individual row ──
function deleteHciCIRow(idx){
  var allItems=window._hciAllItems||[];
  window._hciAllItems=allItems.filter(function(it){return it.idx!==idx;});
  var row=document.getElementById('hci-r-'+idx);
  if(row)row.remove();
  updateHciCISummary();
  if(window._hciAllItems.length===0){
    var preview=document.getElementById('hci-items-preview');
    if(preview){preview.style.display='none';}
    var summary=document.getElementById('hci-items-h-summary');
    if(summary)summary.style.display='none';
  }
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
      tmSel.innerHTML+='<option value="'+esc(tm.name)+'"'+(tm.credit_days>0?' data-credit="'+tm.credit_days+'"':'')+(tm.is_default?' selected':'')+'>'+esc(tm.name)+(tm.credit_days>0?' ('+tm.credit_days+t('unit.days','天')+')':'')+'</option>';
    });
  }
  if(savedVal){
    var found=false;
    for(var i=0;i<tmSel.options.length;i++){if(tmSel.options[i].value===savedVal){found=true;break;}}
    if(found)tmSel.value=savedVal;
  }
}
// ── Historical CI due date auto-calculation (actual_ship_date + credit_days) ──
function calcHciDueDate(){
  var shipEl=document.getElementById('hci-ship-date'),dueEl=document.getElementById('hci-due'),termsEl=document.getElementById('hci-terms');
  if(!shipEl||!dueEl||!termsEl)return;
  var shipDate=shipEl.value;
  if(!shipDate)return;
  var selOpt=termsEl.options[termsEl.selectedIndex];
  var creditDays=parseInt(selOpt&&selOpt.dataset.credit)||0;
  if(creditDays<=0)return;
  var d=new Date(shipDate+'T00:00:00');
  if(isNaN(d.getTime()))return;
  d.setDate(d.getDate()+creditDays);
  var yyyy=d.getFullYear(),mm=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');
  dueEl.value=yyyy+'-'+mm+'-'+dd;
}
async function saveHistoricalCI(){
  const btn=document.getElementById('hci-save');if(!btn||btn.disabled)return;
  const supplier=document.getElementById('hci-supplier');
  var piModeChk=document.querySelector('input[name="hci-pi-mode"]:checked');
  var isLinked=piModeChk&&piModeChk.value==='linked';
  var gross = isLinked ? getHciItemTotal() : parseFloat(document.getElementById('hci-gross').value);
  const paid=parseFloat(document.getElementById('hci-paid').value||0);
  // Collect selected PI info (optional)
  var piMode=document.querySelector('input[name="hci-pi-mode"]:checked');
  var piIds=[],piNos=[];
  if(piMode&&piMode.value==='linked'){
    document.querySelectorAll('.hci-pi-cb:checked').forEach(function(cb){piIds.push(cb.value);piNos.push(cb.dataset.no);});
  }
  const body={historical_ci_no:document.getElementById('hci-no').value.trim(),supplier_id:supplier.value,supplier_name:document.getElementById('hci-supplier-name').value.trim(),brand_name:document.getElementById('hci-brand').value.trim(),country:document.getElementById('hci-country').value,ci_date:document.getElementById('hci-date').value,actual_ship_date:document.getElementById('hci-ship-date').value,currency:document.getElementById('hci-currency').value,gross_goods_amount:gross,historical_paid_amount:paid,historical_paid_date:document.getElementById('hci-paid-date').value,payment_terms:document.getElementById('hci-terms').value.trim(),due_date:document.getElementById('hci-due').value,source_note:document.getElementById('hci-note').value.trim(),source_mode:'historical',idempotency_key:document.getElementById('hci-idempotency').value,warehouse_name:(document.getElementById('hci-wh')||{}).value||'',warehouse_id:(document.getElementById('hci-wh-id')||{}).value||undefined};
  // Attach PI references when linked mode
  if(piIds.length>0){body.related_pi_ids=piIds;body.related_pi_nos=piNos;
    // HCI-PI-LINK-01: 收集 CI 明细 (pi_id/sku_code/shipped_qty/unit_price/discount/net_unit_price) 发送给服务端，确保 PI 发货状态同步
    var ciItems=[];(window._hciAllItems||[]).forEach(function(it){
      var qe=document.getElementById('hci-rq-'+it.idx);
      var q=parseInt(qe?qe.value:0)||0;
      if(q>0)ciItems.push({pi_id:it.pi_id,sku_code:it.sku_code,shipped_qty:q,unit_price:it.unit_price,discount:it.discount,net_unit_price:it.net_unit_price});
    });
    if(ciItems.length>0)body.items=ciItems;
  }
  if(!body.historical_ci_no||!body.supplier_name||!body.brand_name||!body.country||!body.ci_date||!body.currency){showToast(t('gen.L5793.1','请填写历史 CI 编号、供应商、品牌、国家、日期和币种'),'warning');return}if(!(gross>0)){showToast(isLinked?t('hci.gross_auto_required','请选择关联 PI 并填写 CI 明细数量与单价，货款总金额由明细自动汇总'):t('gen.L5793.2','历史货款总金额必须大于0'),'warning');return}if(!Number.isFinite(paid)||paid<0){showToast(t('gen.L5793.3','历史已付款金额不能小于0'),'warning');return}if(paid>gross){showToast(t('gen.L5793.4','历史已付款金额不能超过历史货款总金额'),'warning');return}
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
    var itemsSection='';
    if(h.items&&h.items.length>0){
      itemsSection='<div class="detail-section"><h3>'+t('hci.items_title','SKU 成交价格明细')+'</h3>'+
        '<table class="data-table" style="box-shadow:none;font-size:12px">'+
        '<thead><tr><th>SKU</th><th class="ci-col-right">'+t('ci.col.ci_qty','数量')+'</th>'+
        '<th class="ci-col-right">'+t('field.original_unit_price','原单价')+'</th>'+
        '<th class="ci-col-right">'+t('field.discount','折扣')+'</th>'+
        '<th class="ci-col-right">'+t('field.net_unit_price','折后单价')+'</th>'+
        '<th class="ci-col-right">'+t('ci.col.amount','金额')+'</th></tr></thead><tbody>'+
        h.items.map(function(it){
          var disc=it.discount||0;
          return '<tr><td>'+esc(it.sku_code)+'</td>'+
            '<td class="ci-col-right">'+(it.shipped_qty||0)+'</td>'+
            '<td class="ci-col-right">'+fmtMoney(it.unit_price)+'</td>'+
            '<td class="ci-col-right">'+(disc>0?(disc*100).toFixed(1)+'%':'—')+'</td>'+
            '<td class="ci-col-right">'+fmtMoney(it.net_unit_price)+'</td>'+
            '<td class="ci-col-right" style="font-weight:bold">'+fmtMoney(it.ci_amount)+'</td></tr>';
        }).join('')+
        '</tbody></table>'+
        '<div style="font-size:12px;color:#999;margin-top:8px">'+t('hci.items_note','SKU 级成交价格快照，创建时锁定，不可编辑')+'</div></div>';
    }
    openModal(t('modal.title.viewHistoricalCI', '历史 CI - {v1}', {v1: esc(h.historical_ci_no)}),t('modal.body.viewHistoricalCI', '<div class="detail-card" style="box-shadow:none;padding:0"><div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:10px;margin-bottom:14px;font-size:13px">source_mode = historical；仅参与采购金额和应付统计，不进入 PO/PI/PL/Inbound、库存、WAC 或订单预测。</div><div class="detail-grid">{v1}<div class="detail-item"><span class="detail-label">'+t('field.actual_ship_date','实际出货日期')+'</span><span class="detail-value{v2}">{v3}</span></div>{v4}</div>{v5}</div>', {v1: [[t('gen.L5822.1','历史CI编号'),h.historical_ci_no],[t('gen.L5822.2','供应商'),h.supplier_name],[t('gen.L5822.3','品牌'),h.brand_name],[t('gen.L5822.4','国家'),h.country],[t('gen.L5822.5','CI日期'),fmtDate(h.ci_date)],[t('gen.L5822.6','币种'),h.currency],[t('gen.L5822.7','总货款'),fmtMoney(h.gross_goods_amount,h.currency)],[t('gen.L5822.8','导入历史已付'),fmtMoney(h.historical_paid_amount,h.currency)],[t('gen.L5822.9','历史付款日期'),h.historical_paid_date||t('gen.L5822.10','未知')],[t('gen.L5822.11','后续已付'),fmtMoney(h.subsequent_paid_amount,h.currency)],[t('gen.L5822.12','抵扣'),fmtMoney(h.deduction_amount,h.currency)],[t('gen.L5822.13','抹零'),fmtMoney(h.rounding_amount,h.currency)],[t('gen.L5822.14','未结金额'),fmtMoney(h.unpaid_amount,h.currency)],[t('gen.L5822.15','付款状态'),PAY_STATUS_MAP[h.payment_status]||h.payment_status],[t('gen.L5822.16','付款条件'),h.payment_terms||'—'],[t('gen.L5822.17','到期日'),fmtDate(h.due_date)],[t('gen.L5822.18','原始凭证或备注'),h.source_note||'—']].map(x=>'<div class="detail-item"><span class="detail-label">'+x[0]+'</span><span class="detail-value">'+esc(x[1])+'</span></div>').join(''), v2: !h.actual_ship_date?' text-warning':'', v3: h.actual_ship_date?esc(fmtDate(h.actual_ship_date)):t("app.998", "\u5f85\u8865\u5145"), v4: canEdit?'<div class="detail-item" style="grid-column:1/-1"><button class="btn btn-secondary btn-sm" onclick="editActualShipDate(\'historical\',\''+h.id+'\',\''+(h.actual_ship_date||'')+t('gen.L5822.19','\')">补充/更正实际出货日期</button></div>'):'', v5: itemsSection+attachSection}),t('modal.footer.viewHistoricalCI', '{v1}{v2}<button class="btn btn-secondary" onclick="closeModal()">关闭</button>', {v1: back, v2: hasPermission('payment_view')?'<button class="btn btn-primary" onclick="viewPayment(\''+h.payment_request_id+t('gen.L5822.20','\')">付款与结算</button>'):''}))
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
    openModal(t('modal.title.viewCI', 'CI/PL详情 - {v1}', {v1: ci.ci_no}),t('modal.body.viewCI', '<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>'+t('section.basic_info','基本信息')+'</h3><div class="detail-grid">{v1}<div class="detail-item"><span class="detail-label">'+t('field.actual_ship_date','实际出货日期')+'</span><span class="detail-value{v2}">{v3}</span></div>{v4}{v5}{v6}</div></div><div class="detail-section"><h3>'+t('section.ci_items','CI明细')+'</h3><div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>数量</th><th>原单价</th><th>折扣</th><th>折后单价</th><th>金额</th><th>实际关税税率(%)</th><th>已入库</th><th>未入库</th></tr></thead><tbody>{v7}</tbody></table></div></div><div class="detail-section"><h3>'+t('section.pl_items','PL明细')+'</h3>{v8}</div></div>', {v1: (function(fields){
      var labels={ci_no:t('field.ci_no','CI号'),related_pi_no:t('field.related_pi_no','关联PI'),supplier_name:t('field.supplier_name','供应商'),brand:t('field.brand','品牌'),country:t('field.country','国家'),target_warehouse:t('field.target_warehouse','目标仓库'),ci_date:t('field.ci_date','CI日期'),payable_date:t('field.payable_date','应付日期'),currency:t('field.currency','币种'),ci_total_qty:t('ci.detail.total_qty','CI总数量'),goods_amount:t('field.goods_amount','CI金额'),pi_total_amount:t('ci.detail.pi_total','PI总金额'),amount_difference:t('ci.detail.amount_diff','金额差异'),difference_reason:t('ci.detail.diff_reason','差异原因'),actual_deducted_deposit:t('ci.detail.deposit','已抵扣定金'),payable_balance:t('ci.detail.balance','应付尾款'),transport_basis:t('ci.detail.transport','运输方式'),import_duty_total:t('ci.detail.duty','进口关税'),ci_status:t('field.ci_status','CI状态'),balance_payment_status:t('ci.detail.bal_status','尾款付款状态')};
      var buf='';fields.forEach(function(f){
        var v;if(f==='related_pi_no'){var pns=[];try{pns=JSON.parse(ci.related_pi_nos||'[]');}catch(e){}if(pns.length===0&&ci.related_pi_no)pns=[ci.related_pi_no];v=pns.length>0?pns.map(esc).join('<br>'):'—';}
        else if(f==='ci_status'){var sc=ciStatusClass(ci[f]);v='<span class="status-badge '+sc+'">'+statusLabel(ci[f])+'</span>';}
        else if(f==='ci_total_qty'){v=(ci.items||[]).reduce(function(s,i){return s+(parseInt(i.shipped_qty,10)||0);},0);}else if(f==='balance_payment_status')v=statusLabel(ci[f]);
        else v=esc(ci[f]);
        buf+='<div class=\"detail-item\"><span class=\"detail-label\">'+(labels[f]||f)+'</span><span class=\"detail-value\">'+v+'</span></div>';
      });return buf;
    })(ci._v1fields||['ci_no','related_pi_no','supplier_name','brand','country','target_warehouse','ci_date','payable_date','currency','ci_total_qty','goods_amount','pi_total_amount','amount_difference','difference_reason','actual_deducted_deposit','payable_balance','transport_basis','import_duty_total','ci_status','balance_payment_status']), v2: !ci.actual_ship_date?' text-warning':'', v3: ci.actual_ship_date?esc(fmtDate(ci.actual_ship_date)):t("app.998", "\u5f85\u8865\u5145"), v4: hasPermission('ci_edit')?'<div class="detail-item" style="grid-column:1/-1"><button class="btn btn-secondary btn-sm" onclick="editActualShipDate(\'commercial\',\''+ci.id+'\',\''+(ci.actual_ship_date||'')+t('gen.L5837.1','\')">补充/更正实际出货日期</button></div>'):'', v5: '<div class="detail-item" style="grid-column:1/-1"><span class="detail-label">'+t("ci.005", "CI / PL 附件")+'</span><span class="detail-value">'+ciUnifiedAttachmentHtml(ci)+'</span></div>', v6: '', v7: (ci.items||[]).map(i=>{var dsc=i.discount||0;var nup=i.net_unit_price||(i.unit_price*(1-dsc));return '<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.shipped_qty+'</td><td class="text-right">'+fmtMoney(i.unit_price)+'</td><td class="text-right">'+(dsc>0?(dsc*100).toFixed(1)+'%':'—')+'</td><td class="text-right">'+fmtMoney(nup)+'</td><td class="text-right">'+fmtMoney(i.ci_amount)+'</td><td class="text-right">'+(i.actual_customs_rate===null||i.actual_customs_rate===''?'—':esc(i.actual_customs_rate))+'</td><td class="text-right">'+(i.inbound_qty||0)+'</td><td class="text-right">'+(i.uninbound_qty||0)+'</td></tr>';}).join(''), v8: plItems.length?t('gen.L5837.2','<div class="table-container"><table class="data-table"><thead><tr><th>SKU</th><th>每箱数量</th><th>箱数</th><th>总数量</th><th>总毛重</th><th>总净重</th><th>总体积</th></tr></thead><tbody>')+plItems.map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+i.qty_per_carton+'</td><td class="text-right">'+i.cartons+'</td><td class="text-right">'+i.total_qty+'</td><td class="text-right">'+i.gross_weight+'</td><td class="text-right">'+i.net_weight+'</td><td class="text-right">'+i.cbm+'</td></tr>').join('')+'</tbody></table></div>':t('gen.L5837.3','<div class="empty-state"><div class="empty-icon">📦</div>暂无PL明细</div>')}),ciBackFooter,'modal-ci-create');
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
    body+='<div class="form-group"><label>'+t('field.target_warehouse','目标仓库')+' <span class="required">*</span></label><input id="nci-wh" readonly style="background:#f5f5f5" placeholder="'+t('ci.warehouse_auto','选择PI后自动填入')+'"><input type="hidden" id="nci-wh-id"></div>';
    body+='<div class="form-group"><label>'+t('field.shipment_batch','发货批次')+'</label><input type="number" id="nci-batch" value="1"></div></div>';
    // Row 4: Payment terms
    body+='<div class="form-group" style="margin-top:10px"><label>'+t('field.payment_terms','付款条件')+'</label><select id="nci-payment-terms"><option value="">'+t('app.none','无')+'</option>';
    termOpts.forEach(function(tm){body+='<option value="'+esc(tm.name)+'"'+(tm.credit_days>0?' data-credit="'+tm.credit_days+'"':'')+'>'+esc(tm.name)+(tm.credit_days>0?' ('+tm.credit_days+t('unit.days','天')+')':'')+'</option>';});
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
      html+='<input type="checkbox" class="nci-pi-cb" value="'+p.id+'" data-no="'+esc(p.pi_no)+'" data-supid="'+p.supplier_id+'" data-cur="'+p.currency+'" data-supname="'+esc(p.supplier_name)+'" data-wh="'+esc(p.target_warehouse||'')+'" data-wh-id="'+(p.warehouse_id||'')+'" onchange="onCIPISelectionChange()" style="flex-shrink:0;width:16px;height:16px">';
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
      tmSel.innerHTML+='<option value="'+esc(tm.name)+'"'+(tm.credit_days>0?' data-credit="'+tm.credit_days+'"':'')+(tm.is_default?' selected':'')+'>'+esc(tm.name)+(tm.credit_days>0?' ('+tm.credit_days+t('unit.days','天')+')':'')+'</option>';
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
  resolveCIWarehouse('.nci-pi-cb','nci-wh','nci-wh-id');
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
            window._ciAllItems.push({pi_id:pi.id,pi_no:pi.pi_no,sku_code:it.sku_code,pi_confirmed_qty:it.pi_confirmed_qty||0,shipped_qty:it.shipped_qty||0,unshipped_qty:it.unshipped_qty,unit_price:it.unit_price,discount:it.discount||0,reference_customs_rate:it.reference_customs_rate,idx:curR++,currency:pi.currency});
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
    var headHtml='<table class="data-table ci-detail-table" style="margin:0;font-size:12px">'+
      '<colgroup><col style="width:12%"><col style="width:10%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:10%"><col style="width:8%"><col style="width:7%"><col style="width:8%"><col style="width:10%"><col style="width:40px"></colgroup>'+
      '<thead><tr>'+
      '<th class="ci-col-sku">SKU</th><th class="ci-col-pi">'+t('ci.col.pi_source','PI来源')+'</th><th class="ci-col-right">'+t('ci.col.pi_confirmed','PI总数量')+'</th>'+
      '<th class="ci-col-right">'+t('ci.col.pi_shipped','已出货')+'</th><th class="ci-col-right">'+t('ci.col.pi_unshipped','未出货')+'</th>'+
      '<th class="ci-col-right">'+t('ci.col.ci_qty','本次CI数量')+'</th><th class="ci-col-right">'+t('field.original_unit_price','原单价')+'</th>'+
      '<th class="ci-col-right">'+t('field.discount','折扣')+'</th><th class="ci-col-right">'+t('field.net_unit_price','折后单价')+'</th>'+
      '<th class="ci-col-right">'+t('ci.col.amount','金额')+'</th><th class="ci-col-act">'+t('app.operation','操作')+'</th></tr></thead><tbody>';
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

// Helper: build one CI item row (with discount & net unit price)
function buildCIItemRow(it,allItems){
  var refRate=it.reference_customs_rate!=null&&it.reference_customs_rate!==undefined?it.reference_customs_rate:'';
  var cQty=it.pi_confirmed_qty||0, sQty=it.shipped_qty||0, uQty=it.unshipped_qty||0;
  var discount=it.discount||0;
  var netUnitPrice=it.unit_price*(1-discount);
  return '<tr id="ci-r-'+it.idx+'" data-pi-id="'+it.pi_id+'">'+
    '<td class="ci-col-sku">'+esc(it.sku_code)+'</td>'+
    '<td class="ci-col-pi" style="font-size:12px;color:#888">'+esc(it.pi_no)+'</td>'+
    '<td class="ci-col-right" style="color:#888">'+cQty+'</td>'+
    '<td class="ci-col-right" style="color:#888">'+sQty+'</td>'+
    '<td class="ci-col-right" style="color:#888">'+uQty+'</td>'+
    '<td class="ci-col-right"><input type="number" id="ci-rq-'+it.idx+'" value="'+uQty+'" min="0" max="'+uQty+'" onchange="updateCISummary()" oninput="updateCISummary()"></td>'+
    '<td class="ci-col-right">'+fmtMoney(it.unit_price)+'</td>'+
    '<td class="ci-col-right" style="color:#888">'+(discount>0?(discount*100).toFixed(1)+'%':'—')+'</td>'+
    '<td class="ci-col-right" style="color:#888">'+fmtMoney(netUnitPrice)+'</td>'+
    '<td class="ci-col-right" style="font-weight:bold" id="ci-ra-'+it.idx+'">'+fmtMoney(uQty*netUnitPrice)+'</td>'+
    '<td class="ci-col-act"><button onclick="deleteCIRow('+it.idx+')" style="color:#bbb;border:none;background:none;cursor:pointer;font-size:13px;line-height:1;padding:2px 4px" title="'+t('common.delete','删除')+'">×</button></td>'+
    '<input type="hidden" id="ci-rr-'+it.idx+'" value="'+refRate+'">'+
    '<input type="hidden" id="ci-rd-'+it.idx+'" value="'+discount+'">'+
    '</tr>';
}

// Helper: real-time total summary (with discount)
function updateCISummary(){
  var summary=document.getElementById('ci-items-summary'),allItems=window._ciAllItems||[];
  if(!summary||allItems.length===0){if(summary)summary.style.display='none';return;}
  var totalQty=0,totalAmt=0;
  allItems.forEach(function(it){
    var qe=document.getElementById('ci-rq-'+it.idx);
    var q=parseInt(qe?qe.value:0)||0;
    var discount=it.discount||0;
    var netPrice=it.unit_price*(1-discount);
    if(q>0){totalQty+=q;totalAmt+=q*netPrice;
      var ae=document.getElementById('ci-ra-'+it.idx);if(ae)ae.textContent=fmtMoney(q*netPrice);}
  });
  summary.style.display='';
  var currency=(allItems[0]||{}).currency||'';
  summary.innerHTML='<div class="ci-summary-bar">'+
    '<span>'+t('ci.summary.qty','合计数量：{v1} 件',{v1:totalQty})+'</span>'+
    '<span class="ci-sum-right">'+t('ci.summary.amt','CI金额：{v1} {v2}',{v1:fmtMoney(totalAmt),v2:currency})+'</span>'+
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
// ── Resolve target warehouse from selected PIs ──
function resolveCIWarehouse(cbSelector,whInputId,whIdInputId){
  var cbs=document.querySelectorAll(cbSelector+':checked');
  var whs={},whIds={};
  cbs.forEach(function(cb){
    var wh=cb.dataset.wh,whId=cb.dataset.whId;
    if(wh){whs[wh]=true;}
    if(whId){whIds[whId]=true;}
  });
  var whInput=document.getElementById(whInputId);
  var whIdInput=document.getElementById(whIdInputId);
  var whNames=Object.keys(whs),whIdVals=Object.keys(whIds);
  if(whNames.length===0){
    if(whInput){whInput.value='';whInput.style.borderColor='';}
    if(whIdInput)whIdInput.value='';
    return whNames;
  }
  if(whNames.length===1){
    if(whInput){whInput.value=whNames[0];whInput.style.borderColor='';}
    if(whIdInput)whIdInput.value=whIdVals[0]||'';
  }else{
    if(whInput){whInput.value=t('ci.warehouse_conflict','多个PI仓库不一致，请确认');whInput.style.borderColor='#faad14';}
    if(whIdInput)whIdInput.value='';
  }
  return whNames;
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
    var qe=document.getElementById('ci-rq-'+it.idx),re=document.getElementById('ci-rr-'+it.idx);
    if(!qe)continue;var q=parseInt(qe.value)||0;if(q<=0)continue;
    // unit_price 取自内存中的 PI 明细快照（buildCIItemRow 仅以只读文本展示原单价，页面无 ci-rp-{idx} 输入框，不能读 input）
    items.push({pi_id:it.pi_id,sku_code:it.sku_code,shipped_qty:q,unit_price:it.unit_price||0,actual_customs_rate:re&&re.value!==''?parseFloat(re.value):null});
  }
  if(items.length===0){showToast(t('ci.no_items','请至少添加一条出货明细'),'warning');return;}
  var ciNo=(document.getElementById('nci-no')||{}).value||'',supSel=document.getElementById('nci-supplier');
  var supName='',supId='';
  if(supSel&&supSel.value){var opt=supSel.options[supSel.selectedIndex];supId=supSel.value;supName=opt?opt.dataset.name||'':'';}
  var cur=document.getElementById('nci-cur').value,bat=parseInt(document.getElementById('nci-batch').value)||1;
  var payTerms=(document.getElementById('nci-payment-terms')||{}).value||'',tmSel=document.getElementById('nci-payment-terms');
  var creditDays=0;
  if(tmSel&&tmSel.value&&tmSel.selectedOptions[0]){var cd=tmSel.selectedOptions[0].dataset.credit;if(cd)creditDays=parseInt(cd)||0;}
  var d={ci_no:ciNo||undefined,related_pi_ids:piIds,related_pi_nos:piNos,supplier_name:supName,supplier_id:supId,currency:cur,ci_date:ciDate||undefined,actual_ship_date:sd,shipment_batch:bat,payment_terms:payTerms,credit_days:creditDays,warehouse_name:(document.getElementById('nci-wh')||{}).value||'',warehouse_id:(document.getElementById('nci-wh-id')||{}).value||undefined,items:items};
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
      t('modal.body.viewCICost', '<div class="form-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>费用标记</h3><div class="detail-grid"><div class="detail-item"><span class="detail-label">有关税</span><span class="detail-value">{v1}</span></div><div class="detail-item"><span class="detail-label">有商检费用</span><span class="detail-value">{v2}</span></div></div>{v3}</div><div class="detail-section"><h3>分摊输入快照</h3><div class="form-grid"><div class="form-group"><label>本票实际运输计费基础</label><select id="ci-cost-basis" {v4}><option value="">无运输类费用 / 未选择</option><option value="cbm" {v5}>CBM</option><option value="kg" {v6}>KG（PL总毛重）</option></select></div><div class="form-group"><label>CI Import Duty总金额</label><input type="number" min="0" step="0.01" id="ci-duty-total" value="{v7}" {v8}></div></div><div style="font-size:12px;color:#777;margin:8px 0">运输依据和实际税率均为本票快照，不会从运输方式或SKU主数据动态重算；费用确认后锁定。</div><div class="table-container" style="box-shadow:none"><table class="data-table"><thead><tr><th>SKU</th><th>原单价</th><th>折扣</th><th>折后单价</th><th>CI实际金额</th><th>本票实际关税税率(%)</th></tr></thead><tbody>{v9}</tbody></table></div>{v10}</div><div class="detail-section"><h3>费用汇总</h3><div class="detail-grid"><div class="detail-item"><span class="detail-label">商品金额</span><span class="detail-value">{v11}</span></div><div class="detail-item"><span class="detail-label">到仓费用</span><span class="detail-value">{v12}</span></div><div class="detail-item"><span class="detail-label">关税</span><span class="detail-value">{v13}</span></div><div class="detail-item"><span class="detail-label">商检费用</span><span class="detail-value">{v14}</span></div><div class="detail-item"><span class="detail-label">落地成本总额</span><span class="detail-value font-bold">{v15}</span></div><div class="detail-item"><span class="detail-label">费用确认</span><span class="detail-value">{v16}</span></div><div class="detail-item"><span class="detail-label">费用分摊</span><span class="detail-value">{v17}</span></div><div class="detail-item"><span class="detail-label">原库存导入</span><span class="detail-value">{v18}</span></div></div></div>{v19}<div class="flex gap-8 mt-16">{v20}{v21}{v22}{v23}{v24}</div></div>', {v1: summary.has_customs_duty?t('gen.L5956.1','✅ 是'):t("ci.012", "\u274c \u5426"), v2: summary.has_inspection_fee?t('gen.L5956.2','✅ 是'):t("ci.012", "\u274c \u5426"), v3: hasPermission('ci_edit')?'<div class="flex gap-8 mt-16"><button class="btn btn-secondary btn-sm" onclick="toggleCiCostFlag(\''+id+'\','+(summary.has_customs_duty?0:1)+t('gen.L5956.3',',null)">切换关税标记</button><button class="btn btn-secondary btn-sm" onclick="toggleCiCostFlag(\'')+id+'\',null,'+(summary.has_inspection_fee?0:1)+t('gen.L5956.4',')">切换商检标记</button></div>'):'', v4: summary.cost_confirmed?'disabled':'', v5: summary.transport_basis==='cbm'?'selected':'', v6: summary.transport_basis==='kg'?'selected':'', v7: Number(summary.import_duty_total||0), v8: summary.cost_confirmed?'disabled':'', v9: (summary.ci_items||[]).map(i=>'<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+fmtMoney(i.ci_amount)+'</td><td class="text-right"><input type="number" min="0" step="0.01" class="ci-duty-rate" data-id="'+esc(i.id)+'" value="'+(i.actual_customs_rate===null||i.actual_customs_rate===''?'':esc(i.actual_customs_rate))+'" style="width:120px;text-align:right" '+(summary.cost_confirmed?'disabled':'')+'></td></tr>').join(''), v10: hasPermission('ci_edit')&&!summary.cost_confirmed?'<button class="btn btn-secondary btn-sm mt-16" onclick="saveCiCostInputs(\''+id+t('gen.L5956.5','\')">保存分摊输入</button>'):'', v11: fmtMoney(summary.goods_amount), v12: fmtMoney(summary.warehouse_arrival_total), v13: fmtMoney(summary.customs_duty_total), v14: fmtMoney(summary.inspection_fee_total), v15: fmtMoney(summary.landing_cost_total), v16: summary.cost_confirmed?t('gen.L5956.6','✅ 已确认'):t("ci.021", "\u274c \u672a\u786e\u8ba4"), v17: summary.cost_allocated?t('gen.L5956.7','✅ 已分摊'):t("ci.023", "\u274c \u672a\u5206\u644a"), v18: summary.original_inventory_imported?t('gen.L5956.8','✅ 已完成'):t('gen.L5956.9','❌ 未完成'), v19: summary.cost_items&&summary.cost_items.length?t('gen.L5956.10','<div class="detail-section"><h3>费用明细</h3><div class="table-container"><table class="data-table"><thead><tr><th>类别</th><th>小类</th><th>付款申请号</th><th>应付金额</th><th>已付金额</th><th>计入落地成本</th><th>付款对象</th></tr></thead><tbody>')+summary.cost_items.map(c=>'<tr><td>'+esc(PAY_CATEGORIES[c.cost_category]||c.cost_category)+'</td><td>'+esc(c.cost_subcategory)+'</td><td class="cell-id">'+esc(c.request_no)+'</td><td class="text-right">'+fmtMoney(c.payable_amount)+'</td><td class="text-right">'+fmtMoney(c.paid_amount)+'</td><td>'+(c.include_in_landing_cost?'✅':'❌')+'</td><td>'+esc(c.payee_name)+'</td></tr>').join('')+'</tbody></table></div></div>':'', v20: hasPermission('ci_edit')&&!summary.cost_confirmed?'<button class="btn btn-secondary btn-sm" onclick="confirmCiCosts(\''+id+t('gen.L5956.11','\')">✅ 确认费用完整</button>'):'', v21: hasPermission('ci_edit')?'<button class="btn btn-secondary btn-sm" onclick="allocateCosts(\''+id+t('gen.L5956.12','\')">📊 费用分摊</button>'):'', v22: hasPermission('payment_create')&&summary.has_customs_duty&&!summary.cost_confirmed?'<button class="btn btn-secondary btn-sm" onclick="createCustomsDutyPay(\''+id+t('gen.L5956.13','\')">💰 关税付款</button>'):'', v23: hasPermission('payment_create')&&summary.has_inspection_fee&&!summary.cost_confirmed?'<button class="btn btn-secondary btn-sm" onclick="createInspectionFeePay(\''+id+t('gen.L5956.14','\')">💰 商检付款</button>'):'', v24: hasPermission('payment_create')&&!summary.cost_confirmed?'<button class="btn btn-secondary btn-sm" onclick="createWarehousePay(\''+id+t('gen.L5956.15','\')">🚚 到仓费用付款</button>'):''}),
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
  document.getElementById('content-inner').innerHTML=t('html.renderLogistics', '<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>'+t('logistics.filter.status','状态')+'</label><select id="log-fs"><option value="">'+t('common.all','全部')+'</option>'+logisticsFilterOptions('')+'</select></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadLog()">'+t('common.search','搜索')+'</button>{v1}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">'+t('logistics.title','🚢 物流批次')+'</div></div><div id="log-table"></div></div>', {v1: hasPermission('logistics_create')?'<button class="btn btn-primary btn-sm" onclick="createLogWithPL()">'+t('logistics.btn.create','➕ 新建物流批次')+'</button>':''});
  loadLog();
}
async function loadLog(retry){
  try{
    const s=document.getElementById('log-fs')?.value||'';
    const data=await api('/api/logistics-batches?logistics_display_status='+s);
    document.getElementById('log-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">🚢</div>'+t('logistics.empty','暂无物流数据')+'</div>':'<div class="table-container" style="box-shadow:none;border-radius:0;overflow-x:auto"><table class="data-table" style="table-layout:fixed;width:100%;min-width:0"><colgroup><col style="width:120px"><col style="width:100px"><col style="width:140px"><col style="width:100px"><col style="width:70px"><col style="width:80px"><col style="width:110px"><col style="width:100px"><col style="width:70px"><col style="width:70px"><col style="width:100px"><col style="width:110px"><col style="width:110px"><col style="width:160px"><col style="width:120px"></colgroup><thead><tr><th>'+t('logistics.col.batch_no','物流单号')+'</th><th>'+t('logistics.col.pl_no','PL号')+'</th><th>'+t('logistics.col.related_ci','关联CI')+'</th><th>'+t('logistics.col.forwarder','货代')+'</th><th>'+t('logistics.col.mode','方式')+'</th><th>'+t('logistics.col.country','国家')+'</th><th>'+t('logistics.col.eta','预计到港日期')+'</th><th>'+t('logistics.col.inbound_date','到货日期')+'</th><th>'+t('logistics.col.cartons','箱数')+'</th><th>CBM</th><th>'+t('logistics.col.total_freight','综合运费')+'</th><th>'+t('common.status','状态')+'</th><th>'+t('logistics.col.listing_status','Listing状态')+'</th><th>'+t('logistics.col.listing_owner','上架负责人')+'</th><th>'+t('common.actions','操作')+'</th></tr></thead><tbody>'+data.map(l=>{return '<tr class="clickable-detail-row" onclick="rowClickView(event,\'viewLogDetail\',\''+l.id+'\')"><td class="cell-id" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(l.batch_no)+'</td><td class="cell-id">'+esc(l.pl_no||'-')+'</td><td class="cell-id" title="'+esc(l.related_ci_no)+'" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(l.related_ci_no)+'</td><td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(l.forwarder_name)+'</td><td>'+t('logistics.mode.'+l.transport_mode, l.transport_mode)+'</td><td>'+countryLabel(l.target_country)+'</td><td class="cell-date">'+fmtDate(l.eta_date)+'</td><td class="cell-date '+(hasPermission('logistics_edit')?'cell-clickable':'')+'" '+(hasPermission('logistics_edit')?'data-id="'+l.id+'" onclick="event.stopPropagation();editArrivalDate(this.dataset.id)"':'')+'>'+fmtDate(l.actual_arrival_date)+'</td>'+'<td>'+(l.total_cartons||0)+'</td><td>'+(l.total_cbm||0)+'</td><td>'+fmtMoney(l.total_freight,l.freight_currency)+'</td><td style="white-space:nowrap"><span class="status-badge '+logisticsStatusBadgeClassByKey(l.logistics_display_status)+'">'+logisticsStatusLabelByKey(l.logistics_display_status)+'</span></td>'+listingStatusCell(l)+listingOwnerCell(l)+'<td class="cell-actions" style="white-space:nowrap"><button class="action-btn" onclick="viewLogDetail(\''+l.id+'\')" title="'+t('common.view','查看')+'">👁️</button>'+(hasPermission('logistics_edit')?'<button class="action-btn" onclick="editLog(\''+l.id+'\')" title="'+t('common.edit','编辑')+'">✏️</button>':'')+(hasPermission('logistics_edit')?'<button class="action-btn" onclick="notifyListing(\''+l.id+'\')" title="'+t('logistics.action.notify','发送上架提醒')+'">🔔</button>':'')+((l.total_freight>0||l.customs_duty>0||l.other_fees>0)&&l.fee_status==='unpaid'&&l.related_ci_id&&hasPermission('payment_create')?'<button class="action-btn" onclick="generateCostItems(\''+l.id+'\')" title="'+t('logistics.btn.generate_cost','生成成本记录')+'">📋</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>';
  }catch(e){
    if(!retry){
      document.getElementById('log-table').innerHTML='<div class="empty-state"><div class="empty-icon">⏳</div>'+t('logistics.toast.loading','加载中，请稍候...')+'</div>';
      setTimeout(()=>{loadLog(true);},1500);
    }else{
      showFlash(e.message,'danger');
    }
  }
}
async function viewLogDetail(id){
  try{
    const l=await api('/api/logistics-batches/'+id);
    let plData=null;
    if(l.pl_id){plData=await api('/api/packing-lists/'+l.pl_id);}
    const plItems=(plData&&plData.items)||[];
    const plItemsHTML=plItems.length?'<div class="table-container" style="box-shadow:none;border-radius:0;overflow-x:auto;margin-top:8px"><table class="data-table" style="table-layout:fixed;width:100%;min-width:0"><colgroup><col style="width:25%"><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:15%"></colgroup><thead><tr><th>'+t('logistics.pl.sku','SKU')+'</th><th>'+t('logistics.pl.cartons','CTN数量')+'</th><th>'+t('logistics.pl.total_qty','总数量')+'</th><th>'+t('logistics.pl.gross_weight','总毛重')+'</th><th>'+t('logistics.pl.net_weight','总净重')+'</th><th>'+t('logistics.pl.cbm','总体积')+'</th></tr></thead><tbody>'+plItems.map(it=>'<tr><td class="cell-id" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(it.sku_code)+'</td><td style="white-space:nowrap">'+(it.cartons||0)+'</td><td style="white-space:nowrap">'+(it.total_qty||0)+'</td><td style="white-space:nowrap">'+(it.gross_weight||0)+'</td><td style="white-space:nowrap">'+(it.net_weight||0)+'</td><td style="white-space:nowrap">'+(it.cbm||0)+'</td></tr>').join('')+'</tbody></table></div>':'<div style="padding:12px;color:#999">'+t('logistics.detail.no_pl_items','无PL明细')+'</div>';
    const plSummary=plData?'<div style="display:flex;gap:16px;margin-top:8px;font-size:13px;color:#666"><span>'+t('logistics.pl.summary_pl_no','PL单号')+': <b>'+esc(plData.pl_no||'')+'</b></span><span>'+t('logistics.pl.summary_total_cartons','总CTN数量')+': <b>'+(l.total_cartons||plData.total_cartons||0)+'</b></span><span>'+t('logistics.pl.summary_total_qty','总数量')+': <b>'+(plData.total_qty||0)+'</b></span><span>'+t('logistics.pl.summary_gross_weight','总毛重')+': <b>'+(plData.total_gross_weight||0)+'</b>kg</span><span>'+t('logistics.pl.summary_cbm','总体积')+': <b>'+(plData.total_cbm||0)+'</b>CBM</span><span>'+t('logistics.pl.summary_status','状态')+': <b>'+esc(plData.status||'')+'</b></span></div>':'';
    openModal(t('logistics.detail.title','物流详情')+' - '+esc(l.batch_no),'<div class="detail-card" style="box-shadow:none;padding:0">'+
      '<div class="detail-section"><h3>'+t('logistics.detail.basic_info','基本信息')+'</h3><div class="detail-grid">'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.batch_no','物流单号')+'</span><span class="detail-value">'+esc(l.batch_no)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.pl_no','PL单号')+'</span><span class="detail-value">'+esc(l.pl_no||'-')+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.related_ci','关联CI')+'</span><span class="detail-value" title="'+esc(l.related_ci_no)+'">'+esc(l.related_ci_no)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.forwarder','货代')+'</span><span class="detail-value">'+esc(l.forwarder_name)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.transport_mode','运输方式')+'</span><span class="detail-value">'+t('logistics.mode.'+l.transport_mode, l.transport_mode)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.target_country','目标国家')+'</span><span class="detail-value">'+countryLabel(l.target_country)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.target_warehouse','目标仓库')+'</span><span class="detail-value">'+esc(l.target_warehouse)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.pickup_date','提货日期')+'</span><span class="detail-value">'+fmtDate(l.pickup_date)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.depart_date','出发日期')+'</span><span class="detail-value">'+fmtDate(l.depart_date)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.eta','预计到港')+'</span><span class="detail-value">'+fmtDate(l.eta_date)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.arrival_date','到港日期')+'</span><span class="detail-value">'+fmtDate(l.actual_arrival_date)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.logistics_status','物流状态')+'</span><span class="detail-value">'+logisticsStatusLabelByKey(l.logistics_display_status)+'</span></div>'+
      '</div></div>'+
      '<div class="detail-section"><h3>'+t('logistics.detail.pl_items','PL装箱明细')+'</h3>'+plSummary+plItemsHTML+'</div>'+
      '<div class="detail-section"><h3>'+t('logistics.detail.fee_info','费用信息')+'</h3><div class="detail-grid">'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.freight_currency','运费币种')+'</span><span class="detail-value">'+esc(l.freight_currency)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.freight','运费')+'</span><span class="detail-value">'+fmtMoney(l.international_freight,l.freight_currency)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.local_charges','其他运输费用')+'</span><span class="detail-value">'+fmtMoney(l.local_charges,l.freight_currency)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.total_freight','综合运费')+'</span><span class="detail-value">'+fmtMoney(l.total_freight,l.freight_currency)+'</span></div>'+
      '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.fee_status','费用状态')+'</span><span class="detail-value">'+t('logistics.fee.'+l.fee_status, l.fee_status)+'</span></div>'+
      '</div></div>'+
      // ── Freight payment facts section ──
      (function(){
        var fpf=l.freight_payment_facts;
        if(!fpf){
          return '';
        }
        if(!fpf.has_real_settlement){
          return '<div class="detail-section"><h3>'+t('logistics.detail.payment_facts','付款事实')+'</h3>'+
            '<div style="background:#fffbe6;border:1px solid #ffe58f;border-radius:6px;padding:10px 14px;font-size:13px;color:#d48806">'+
            '⚠️ '+t('logistics.detail.payment_fact_missing','付款事实缺失，需要历史付款记录')+
            '</div></div>';
        }
        var pb=fpf.payment_breakdown||[];
        var pbHtml=pb.length?'<div style="margin-top:8px"><table class="data-table" style="font-size:11px;min-width:500px"><thead><tr>'+
          '<th>PR ID</th><th>'+t('wac.original_amount','原始金额')+'</th><th>'+t('logistics.detail.local_currency','本币')+'</th><th>'+t('logistics.detail.frozen_fx_rate','冻结汇率')+'</th><th>'+t('logistics.detail.fx_rate_date','汇率日期')+'</th><th>'+t('logistics.detail.actual_payment_date','付款日期')+'</th><th>'+t('logistics.detail.local_amount','本币金额')+'</th>'+
          '</tr></thead><tbody>'+
          pb.map(function(pd){return '<tr>'+
            '<td class="cell-id">'+esc(pd.payment_request_id)+'</td>'+
            '<td class="text-right">'+Number(pd.amount).toFixed(2)+'</td>'+
            '<td>'+esc(pd.local_currency)+'</td>'+
            '<td class="text-right">'+Number(pd.local_rate).toFixed(4)+'</td>'+
            '<td class="cell-date">'+fmtDate(pd.local_rate_date)+'</td>'+
            '<td class="cell-date">'+fmtDate(pd.paid_date)+'</td>'+
            '<td class="text-right">'+Number(pd.local_amount).toFixed(2)+'</td>'+
          '</tr>';}).join('')+
          '</tbody></table></div>':'';
        return '<div class="detail-section"><h3>'+t('logistics.detail.payment_facts','付款事实')+'</h3><div class="detail-grid">'+
          '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.payment_status','付款状态')+'</span><span class="detail-value">✅ '+t('wac.import_ok','就绪')+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.original_currency','原始货币')+'</span><span class="detail-value">'+esc(l.freight_currency)+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.business_freight','业务运费金额')+'</span><span class="detail-value">'+fmtMoney(l.total_freight,l.freight_currency)+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.actual_payment_date','实际付款日期')+'</span><span class="detail-value">'+fmtDate(fpf.last_paid_date)+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.local_currency','本币')+'</span><span class="detail-value">'+esc(pb[0]?pb[0].local_currency:'')+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.effective_rate','有效汇率')+'</span><span class="detail-value">'+(fpf.effective_rate!=null?Number(fpf.effective_rate).toFixed(4):'-')+'</span></div>'+
          '<div class="detail-item"><span class="detail-label">'+t('logistics.detail.local_amount','本币金额')+'</span><span class="detail-value">'+Number(fpf.local_total||0).toFixed(2)+'</span></div>'+
          '</div>'+pbHtml+'</div>';
      })()+
      (l.remark?'<div class="detail-section"><h3>'+t('logistics.detail.remark','备注')+'</h3><div>'+esc(l.remark)+'</div></div>':'')+
      '</div>',
      '<button class="btn btn-secondary" onclick="closeModal()">'+t('common.close','关闭')+'</button>'+
      (hasPermission('logistics_edit')?'<button class="btn btn-secondary" onclick="backfillArrival(\''+id+'\')">'+t('wac.backfill_btn_arrival','历史到货日期补录')+'</button>':'')+
      (hasPermission('payment_create')?'<button class="btn btn-secondary" onclick="backfillFreightPayment(\''+id+'\')">'+t('wac.backfill_btn_freight','补录运费付款')+'</button>':'')+
      (hasPermission('logistics_edit')?'<button class="btn btn-primary" onclick="closeModal();editLog(\''+id+'\')">'+t('common.edit','编辑')+'</button>':''),'modal-ci-create');
  }catch(e){showToast(e.message,'danger')}
}

// ==================== 历史事实补录 (Historical Backfill) ====================

async function backfillArrival(batchId){
  try{
    const l=await api('/api/logistics-batches/'+batchId);
    openModal(t('wac.backfill_arrival_title','补录到货事实')+' - '+esc(l.batch_no),
      '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div class="form-grid">'+
      '<div class="form-group form-group-full"><label>'+t('wac.backfill_actual_arrival','实际到港日期')+' <span class="required">*</span></label>'+
      '<input type="date" id="bf-arrival-date" value="'+esc(l.actual_arrival_date||'')+'" style="width:100%"></div>'+
      '<div class="form-group form-group-full"><label>'+t('wac.backfill_evidence','凭证/审计信息')+'</label>'+
      '<input type="text" id="bf-evidence" placeholder="'+t('wac.backfill_evidence','凭证/审计信息')+'" style="width:100%"></div>'+
      '</div>'+
      '<div style="font-size:12px;color:#999;margin-top:8px">'+t('wac.backfill_arrival_hint','补录实际到港日期和审计信息')+'</div>'+
      '</div>',
      '<button class="btn btn-secondary" onclick="closeModal()">'+t('common.cancel','取消')+'</button>'+
      '<button class="btn btn-primary" onclick="submitBackfillArrival(\''+batchId+'\')">'+t('wac.backfill_submit','提交补录')+'</button>',
      'modal-ci-create');
  }catch(e){showToast(e.message,'danger')}
}

async function submitBackfillArrival(batchId){
  const date=document.getElementById('bf-arrival-date').value;
  const evidence=document.getElementById('bf-evidence').value;
  if(!date){showToast(t('wac.backfill_arrival_date','到港日期')+' required','danger');return;}
  try{
    await api('/api/logistics-batches/'+batchId+'/backfill-arrival','POST',{actual_arrival_date:date,evidence:evidence});
    closeModal();
    showToast(t('wac.backfill_success','补录成功'),'success');
    viewLogDetail(batchId);
  }catch(e){showToast(e.message,'danger')}
}

async function backfillFreightPayment(batchId){
  try{
    const l=await api('/api/logistics-batches/'+batchId);
    openModal(t('wac.backfill_freight_title','补录运费付款事实')+' - '+esc(l.batch_no),
      '<div class="form-card" style="box-shadow:none;padding:0">'+
      '<div class="form-grid">'+
      '<div class="form-group"><label>'+t('wac.backfill_original_amount','原始金额')+' <span class="required">*</span></label>'+
      '<input type="number" id="bf-orig-amt" value="'+(l.total_freight||0)+'" step="0.01" style="width:100%"></div>'+
      '<div class="form-group"><label>'+t('wac.backfill_original_currency','原始货币')+' <span class="required">*</span></label>'+
      '<input type="text" id="bf-orig-cur" value="'+esc(l.freight_currency||'USD')+'" style="width:100%"></div>'+
      '<div class="form-group"><label>'+t('wac.backfill_paid_date','付款日期')+' <span class="required">*</span></label>'+
      '<input type="date" id="bf-paid-date" style="width:100%"></div>'+
      '<div class="form-group"><label>'+t('wac.backfill_local_currency','本币')+' <span class="required">*</span></label>'+
      '<input type="text" id="bf-local-cur" placeholder="IDR" style="width:100%"></div>'+
      '<div class="form-group"><label>'+t('wac.backfill_local_rate','本币汇率')+' <span class="required">*</span></label>'+
      '<input type="number" id="bf-local-rate" step="0.0001" style="width:100%"></div>'+
      '<div class="form-group"><label>'+t('wac.backfill_local_rate_date','汇率日期')+' <span class="required">*</span></label>'+
      '<input type="date" id="bf-rate-date" style="width:100%"></div>'+
      '<div class="form-group"><label>'+t('wac.backfill_local_amount','本币金额')+' <span class="required">*</span></label>'+
      '<input type="number" id="bf-local-amt" step="0.01" style="width:100%"></div>'+
      '<div class="form-group form-group-full"><label>'+t('wac.backfill_evidence','凭证/审计信息')+'</label>'+
      '<input type="text" id="bf-freight-evidence" placeholder="'+t('wac.backfill_evidence','凭证/审计信息')+'" style="width:100%"></div>'+
      '</div>'+
      '<div style="font-size:12px;color:#999;margin-top:8px">'+t('wac.backfill_freight_hint','补录真实付款记录到正式事实模型')+'</div>'+
      '</div>',
      '<button class="btn btn-secondary" onclick="closeModal()">'+t('common.cancel','取消')+'</button>'+
      '<button class="btn btn-primary" onclick="submitBackfillFreightPayment(\''+batchId+'\')">'+t('wac.backfill_submit','提交补录')+'</button>',
      'modal-ci-create');
  }catch(e){showToast(e.message,'danger')}
}

async function submitBackfillFreightPayment(batchId){
  const d={
    original_amount:parseFloat(document.getElementById('bf-orig-amt').value),
    original_currency:document.getElementById('bf-orig-cur').value,
    paid_date:document.getElementById('bf-paid-date').value,
    local_currency:document.getElementById('bf-local-cur').value,
    local_rate:parseFloat(document.getElementById('bf-local-rate').value),
    local_rate_date:document.getElementById('bf-rate-date').value,
    local_amount:parseFloat(document.getElementById('bf-local-amt').value),
    evidence:document.getElementById('bf-freight-evidence').value
  };
  if(!d.original_amount||!d.original_currency||!d.paid_date||!d.local_currency||!d.local_rate||!d.local_rate_date||!d.local_amount){
    showToast('All fields required','danger');return;
  }
  try{
    await api('/api/logistics-batches/'+batchId+'/backfill-freight-payment','POST',d);
    closeModal();
    showToast(t('wac.backfill_success','补录成功'),'success');
    viewLogDetail(batchId);
  }catch(e){showToast(e.message,'danger')}
}

// ===== LOGISTICS-LISTING-01 前端：上架状态/负责人 helpers（2026-08-07）=====
const LISTING_STATUS_OPTIONS=[{v:'pending_plan',l:'待提交上架计划'},{v:'preparing',l:'准备中'},{v:'ready',l:'已准备完成'},{v:'listed',l:'已上架'}];
function listingStatusOptions(selected){
  return LISTING_STATUS_OPTIONS.map(o=>'<option value="'+o.v+'"'+(o.v===selected?' selected':'')+'>'+t('logistics.listing_status.'+o.v, o.l)+'</option>').join('');
}
function formatOwnerNames(arr){
  arr=arr||[];
  if(!arr.length) return '<span style="color:#999">—</span>';
  if(arr.length<=2) return esc(arr.join('、'));
  return esc(arr[0])+' <span style="color:#1890ff">+'+(arr.length-1)+'</span>';
}
function userChecklist(users, selectedIds, cbClass){
  users=users||[];
  const sel=(selectedIds||[]).map(String);
  if(!users.length) return '<span class="empty-state" style="padding:8px">'+t('logistics.listing.no_users','暂无可选用户')+'</span>';
  return users.map(u=>{
    const checked=sel.includes(String(u.id))?' checked':'';
    return '<label class="cc-check"><input type="checkbox" class="'+cbClass+'" value="'+esc(u.id)+'"'+checked+'> '+esc(u.name)+'</label>';
  }).join('');
}
async function changeListingStatus(id, sel){
  const prev=sel.dataset.prev||'pending_plan';
  const nv=sel.value;
  if(nv===prev) return;
  try{
    await api('/api/logistics-batches/'+id+'/listing','POST',{listing_status:nv});
    sel.dataset.prev=nv;
    showToast(t('logistics.listing.status_updated','上架状态已更新'),'success');
  }catch(e){ sel.value=prev; showToast(e.message,'danger'); }
}
function listingStatusCell(l){
  const st=l.listing_status||'pending_plan';
  return '<td style="white-space:nowrap"><select class="listing-status-select" style="width:110px;padding:2px 4px" data-prev="'+esc(st)+'" onchange="changeListingStatus(\''+l.id+'\', this)" onclick="event.stopPropagation()">'+listingStatusOptions(st)+'</select></td>';
}
function listingOwnerCell(l){
  const names=l.listing_owner_names||[];
  return '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(names.join('、'))+'">'+formatOwnerNames(names)+'</td>';
}
async function createLogWithPL(){
  try{
    const cis=await api('/api/commercial-invoices/available-for-pl');
    window._ffs=await api('/api/freight-forwarders');const users=await api('/api/users');
    const ciTableHTML=cis.length?'<div class="table-container" style="overflow-x:auto"><table class="data-table"><thead><tr><th>选择</th><th>CI号</th><th>供应商</th><th>CI日期</th><th>出货日期</th><th>国家</th><th>仓库</th><th>CI数量</th><th>已生成PL</th><th>剩余可生成</th></tr></thead><tbody>'+cis.map(c=>'<tr><td><button class="btn btn-primary btn-sm" onclick="selectCIForPL(\''+c.id+'\')">选择</button></td><td class="cell-id">'+esc(c.ci_no)+'</td><td>'+esc(c.supplier_name)+'</td><td class="cell-date">'+fmtDate(c.ci_date)+'</td><td class="cell-date">'+fmtDate(c.actual_ship_date)+'</td><td>'+esc(c.country)+'</td><td>'+esc(c.target_warehouse)+'</td><td class="text-right">'+(c.total_ci_qty||0)+'</td><td class="text-right">'+(c.generated_pl_qty||0)+'</td><td class="text-right font-bold" style="color:'+(c.available_to_create_pl_qty>0?'#1890ff':'#999')+'">'+(c.available_to_create_pl_qty||0)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty-state"><div class="empty-icon">📦</div>没有可生成PL的CI</div>';
    openModal('新建物流批次 — 选择CI',ciTableHTML,'<button class="btn btn-secondary" onclick="closeModal()">取消</button>','modal-ci-create');
  }catch(e){showToast(e.message,'danger')}
}
async function selectCIForPL(ciId){
  try{
    const ci=await api('/api/commercial-invoices/'+ciId);
    let costSummary={customs_duty_total:0,inspection_fee_total:0};
    try{costSummary=await api('/api/commercial-invoices/'+ciId+'/cost-summary')}catch(e){}
    const skus=await api('/api/skus');
    const skuMap={};skus.forEach(s=>skuMap[s.sku_code]=s);
    const users=await api('/api/users');
    window._plCI=ci;window._plCostSummary=costSummary;window._plSkuMap=skuMap;window._plUsers=users;
    window._plDraft=[];window._otherFees=[];
    const plCheck=ci.pl_check||[];
    // 聚合 CI items 中相同 SKU 的多行（CI 可能包含同 SKU 多行）
    const ciAgg={};
    ci.items.forEach(item=>{
      if(!ciAgg[item.sku_code])ciAgg[item.sku_code]={sku_code:item.sku_code,shipped_qty:0};
      ciAgg[item.sku_code].shipped_qty+=(item.shipped_qty||0);
    });
    Object.values(ciAgg).forEach(item=>{
      const pc=plCheck.find(p=>p.sku_code===item.sku_code)||{ci_qty:0,pl_qty:0};
      const remaining=(item.shipped_qty||0)-(pc.pl_qty||0);
      if(remaining>0){
        window._plDraft.push({sku_code:item.sku_code,cartons:0,qty_per_carton:0,total_qty:remaining,
          gross_weight_per_carton:0,net_weight_per_carton:0,cbm_per_carton:0,length:0,width:0,height:0,
          gross_weight:0,net_weight:0,cbm:0,
          ci_shipped_qty:item.shipped_qty,pl_qty:pc.pl_qty||0,remaining:remaining});
      }
    });
    const ffs=window._ffs||[];
    const ffOpts=ffs.map(f=>'<option value="'+f.id+'" data-name="'+esc(f.name)+'">'+esc(f.name)+'</option>').join('');
    const ciDisplay='<input type="text" value="'+esc(ci.ci_no)+'" disabled title="'+esc(ci.ci_no)+'">';
    const shipDate=ci.actual_ship_date||'';
    openModal('新建物流批次 — '+esc(ci.ci_no),
      '<div class="form-card" style="box-shadow:none;padding:0;max-height:70vh;overflow-y:auto">'+
      '<div class="detail-section"><h3>基础信息</h3><div class="form-grid">'+
      '<div class="form-group"><label>关联CI</label>'+ciDisplay+'</div>'+
      '<div class="form-group"><label>供应商</label><input type="text" value="'+esc(ci.supplier_name||'')+'" disabled></div>'+
      '<div class="form-group"><label>PL单号（留空自动生成）</label><input type="text" id="npl-no" placeholder="自动生成"></div>'+
      '<div class="form-group"><label>物流单号（留空自动生成）</label><input type="text" id="npl-batchno" placeholder="自动生成"></div>'+
      '<div class="form-group"><label>货代</label><select id="npl-ff"><option value="">选择货代</option>'+ffOpts+'</select></div>'+
      '<div class="form-group"><label>运输方式</label><select id="npl-mode"><option value="sea">海运</option><option value="air">空运</option><option value="land">陆运</option><option value="express">快递</option></select></div>'+
      '<div class="form-group"><label>目标国家</label><input type="text" id="npl-country" value="'+esc(ci.country||'')+'"></div>'+
      '<div class="form-group"><label>目标仓库</label><input type="text" id="npl-wh" value="'+esc(ci.target_warehouse||'')+'"></div>'+
      '<div class="form-group"><label>发货日期</label><input type="date" id="npl-pickup" value="'+shipDate+'" readonly style="background:#f5f5f7;color:#666"></div>'+
      '<div class="form-group"><label>预计到港</label><input type="date" id="npl-eta"></div>'+
      '</div></div>'+
      '<div class="detail-section"><h3>PL装箱明细 <label style="font-size:13px;font-weight:normal;color:#666;margin-left:12px">总CTN数量: <input type="number" id="npl-total-ctn" value="0" style="width:70px;padding:2px" placeholder="0"></label></h3>'+
      '<div style="display:flex;gap:8px;margin-bottom:8px"><button class="btn btn-secondary btn-sm" onclick="downloadPLTemplate()">下载导入模板</button></div>'+
      '<div id="pl-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:20px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s;margin-bottom:8px" '+
        'onclick="document.getElementById(\'pl-file-input\').click()" '+
        'ondragover="event.preventDefault();this.style.borderColor=\'#1890ff\';this.style.background=\'#e6f7ff\'" '+
        'ondragleave="this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\'" '+
        'ondrop="event.preventDefault();this.style.borderColor=\'#d9d9d9\';this.style.background=\'#fafafa\';handlePLFile(event.dataTransfer.files[0])">'+
        '<div style="font-size:28px;color:#1890ff;margin-bottom:4px">📤</div>'+
        '<div style="font-size:13px;color:#333;margin-bottom:2px">点击上传或拖拽文件到此处</div>'+
        '<div style="font-size:11px;color:#999">支持 .xlsx / .xls / .csv 格式，字段：SKU、数量、CTN数量、总毛重、总净重、总体积</div>'+
      '</div>'+
      '<input type="file" id="pl-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handlePLFile(this.files[0])">'+
      '<div id="pl-draft-table"></div></div>'+
      '<div class="detail-section"><h3>费用信息</h3><div class="form-grid">'+
      '<div class="form-group"><label>运费币种</label><select id="npl-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div>'+
      '<div class="form-group"><label>运费</label><input type="number" step="0.01" id="npl-freight" value="0" oninput="calcTotalFreight()"></div>'+
      '</div><div style="margin-top:12px"><label style="font-weight:500">其他运输类费用（动态）</label><div id="other-fees-list"></div><button class="btn btn-secondary btn-sm" onclick="addOtherFeeRow()" style="margin-top:4px">添加费用行</button></div>'+
      '<div id="ci-readonly-costs" style="margin-top:12px;padding:8px;background:#f5f5f7;border-radius:8px"><div style="font-size:13px;color:#666;margin-bottom:4px">CI费用（只读参考）</div><div style="display:flex;gap:16px;font-size:13px"><span>关税: <b>'+fmtMoney(costSummary.customs_duty_total||0,ci.currency||'USD')+'</b></span><span>商检费: <b>'+fmtMoney(costSummary.inspection_fee_total||0,ci.currency||'USD')+'</b></span></div></div>'+
      '<div style="margin-top:8px;font-size:14px;font-weight:500">综合运费合计: <span id="total-freight-display">0.00</span></div>'+
      '<div class="form-group" style="margin-top:8px"><label>备注</label><input type="text" id="npl-remark"></div>' + '<div class="detail-section"><h3>'+t('logistics.listing.section','上架信息')+'</h3><div class="form-grid">'+'<div class="form-group" style="grid-column:1/-1"><label>'+t('logistics.listing.owner','上架负责人')+' <span class="required">*</span></label><div class="cc-list" id="npl-owner-list">'+userChecklist(users,[],'listing-owner-cb')+'</div></div>'+'<div class="form-group" style="grid-column:1/-1"><label>'+t('logistics.listing.cc','上架抄送(CC)')+'</label><div class="cc-list" id="npl-cc-list">'+userChecklist(users,[],'listing-cc-cb')+'</div></div>'+'</div></div>' + '</div></div></div>',
      '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-secondary" onclick="createLogWithPL()">返回选择CI</button><button class="btn btn-primary" onclick="saveLogWithPL()">创建物流批次</button>','modal-ci-create');
    renderPLDraftTable();renderOtherFees();calcTotalFreight();
  }catch(e){showToast(e.message,'danger')}
}
function renderPLDraftTable(){
  const items=window._plDraft||[];
  if(!items.length){document.getElementById('pl-draft-table').innerHTML='<div style="padding:24px 12px;text-align:center;color:#999"><div style="font-size:32px;margin-bottom:8px">📋</div><div style="font-size:14px;margin-bottom:4px">暂无PL明细</div><div style="font-size:12px;color:#bbb">点击上方上传区域导入Excel，或手动编辑下方明细</div></div>';return;}
  let tc=0,tq=0,tg=0,tn=0,tb=0;
  items.forEach(it=>{tc+=it.cartons||0;tq+=it.total_qty||0;tg+=it.gross_weight||0;tn+=it.net_weight||0;tb+=it.cbm||0;});
  document.getElementById('pl-draft-table').innerHTML='<style>.pl-draft-wrap{overflow:auto;max-height:420px}.pl-draft-wrap thead th{position:sticky;top:0;z-index:2;background:#eef0f3;white-space:nowrap}</style><div class="table-container pl-draft-wrap"><table class="data-table" style="font-size:12px"><thead><tr><th>SKU</th><th>CI发货</th><th>已生成PL</th><th>剩余</th><th>CTN数量</th><th>总数量</th><th>总毛重</th><th>总净重</th><th>总体积</th><th></th></tr></thead><tbody>'+
    items.map((it,i)=>'<tr><td class="cell-id">'+esc(it.sku_code)+'</td><td class="text-right">'+(it.ci_shipped_qty||0)+'</td><td class="text-right">'+(it.pl_qty||0)+'</td><td class="text-right">'+(it.remaining||0)+'</td>'+
      '<td><input type="number" value="'+(it.cartons||0)+'" style="width:60px;padding:2px" onchange="updatePLRow('+i+',\'cartons\',this.value)"></td>'+
      '<td><input type="number" value="'+(it.total_qty||0)+'" style="width:70px;padding:2px;font-weight:bold" onchange="updatePLRow('+i+',\'total_qty\',this.value)"></td>'+
      '<td><input type="number" step="0.01" value="'+(it.gross_weight||0)+'" style="width:70px;padding:2px" onchange="updatePLRow('+i+',\'gross_weight\',this.value)"></td>'+
      '<td><input type="number" step="0.01" value="'+(it.net_weight||0)+'" style="width:70px;padding:2px" onchange="updatePLRow('+i+',\'net_weight\',this.value)"></td>'+
      '<td><input type="number" step="0.0001" value="'+(it.cbm||0)+'" style="width:70px;padding:2px" onchange="updatePLRow('+i+',\'cbm\',this.value)"></td>'+
      '<td><button class="action-btn" onclick="removePLRow('+i+')" title="删除">🗑️</button></td></tr>').join('')+
    '<tr style="font-weight:bold;background:#f5f5f7"><td>合计</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="text-right">'+tc+'</td><td class="text-right">'+tq+'</td><td class="text-right">'+tg.toFixed(2)+'</td><td class="text-right">'+tn.toFixed(2)+'</td><td class="text-right">'+tb.toFixed(4)+'</td><td>&nbsp;</td></tr>'+
    '</tbody></table></div>';
}
function updatePLRow(idx,field,val){
  const it=window._plDraft[idx];if(!it)return;
  it[field]=parseFloat(val)||0;
  renderPLDraftTable();
}
function removePLRow(idx){window._plDraft.splice(idx,1);renderPLDraftTable();}
function downloadPLTemplate(){
  const headers=['SKU','数量','CTN数量','总毛重','总净重','总体积'];
  const sample=['NT03U505N-016G-20BK',60,6,9.00,7.20,0.3000];
  const ws=XLSX.utils.aoa_to_sheet([headers,sample]);
  ws['!cols']=headers.map(h=>({wch:Math.max(h.length*2+4,12)}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'PL汇总');
  XLSX.writeFile(wb,'PL装箱明细_导入模板.xlsx');
}
function handlePLFile(file){
  if(!file)return;
  const r=new FileReader();r.onload=ev=>{try{
    const wb=XLSX.read(ev.target.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws);
    const aliasMap={'sku_code':['SKU','SKU编码','料号','sku_code'],'total_qty':['数量','总数量','Total QTY','total_qty'],'cartons':['CTN数量','箱数','CTN','Total CTN','cartons'],'gross_weight':['总毛重','GW','gross_weight'],'net_weight':['总净重','NW','net_weight'],'cbm':['总体积','CBM','cbm']};
    const mapped=rows.map(row=>{const item={};for(const [key,aliases] of Object.entries(aliasMap)){for(const alias of aliases){if(row[alias]!==undefined){item[key]=isNaN(row[alias])?row[alias]:parseFloat(row[alias]);break;}}}return item;});

    // 第一步：按标准化 SKU 聚合本次导入数据（同 SKU 多行 → SUM，重复导入不累加）
    const importMap=new Map();
    mapped.forEach(item=>{
      if(!item.sku_code)return;
      const key=String(item.sku_code).trim().toLowerCase();
      if(!importMap.has(key)){
        importMap.set(key,{sku_code:String(item.sku_code).trim(),total_qty:0,gross_weight:0,net_weight:0,cbm:0,cartons:0});
      }
      const agg=importMap.get(key);
      agg.total_qty+=(item.total_qty||0);
      agg.gross_weight+=(item.gross_weight||0);
      agg.net_weight+=(item.net_weight||0);
      agg.cbm+=(item.cbm||0);
      agg.cartons+=(item.cartons||0);
    });

    // 第二步：遍历 _plDraft，覆盖或清零
    const ciItemsRaw=window._plCI.items||[];const plCheck=window._plCI.pl_check||[];
    const ciAgg={};
    ciItemsRaw.forEach(i=>{if(!ciAgg[i.sku_code])ciAgg[i.sku_code]={sku_code:i.sku_code,shipped_qty:0};ciAgg[i.sku_code].shipped_qty+=(i.shipped_qty||0);});
    const ciItems=Object.values(ciAgg);
    let matched=0,unmatched=0;
    window._plDraft.forEach(d=>{
      const key=String(d.sku_code).trim().toLowerCase();
      if(importMap.has(key)){
        const imp=importMap.get(key);
        d.total_qty=imp.total_qty;
        d.gross_weight=imp.gross_weight;
        d.net_weight=imp.net_weight;
        d.cbm=imp.cbm;
        d.cartons=imp.cartons;
        matched++;
      }else{
        d.total_qty=0;d.gross_weight=0;d.net_weight=0;d.cbm=0;
      }
    });
    // 处理 importMap 中存在但 _plDraft 中尚无的 SKU（CI 中有匹配）
    importMap.forEach((imp,key)=>{
      const existIdx=window._plDraft.findIndex(d=>String(d.sku_code).trim().toLowerCase()===key);
      if(existIdx<0){
        const ciItem=ciItems.find(i=>i.sku_code.toLowerCase()===key);
        if(ciItem){
          const pc=plCheck.find(p=>p.sku_code===ciItem.sku_code)||{pl_qty:0};
          const remaining=(ciItem.shipped_qty||0)-(pc.pl_qty||0);
          window._plDraft.push({sku_code:ciItem.sku_code,cartons:imp.cartons,qty_per_carton:0,total_qty:imp.total_qty,
            gross_weight_per_carton:0,net_weight_per_carton:0,cbm_per_carton:0,length:0,width:0,height:0,
            gross_weight:imp.gross_weight,net_weight:imp.net_weight,cbm:imp.cbm,
            ci_shipped_qty:ciItem.shipped_qty,pl_qty:pc.pl_qty||0,remaining:remaining});
          matched++;
        }else{
          unmatched++;
        }
      }
    });
    renderPLDraftTable();showToast('导入完成：匹配'+matched+'行，未匹配'+unmatched+'行',matched>0?'success':'warning');
  }catch(err){showToast(err.message,'danger')}};r.readAsArrayBuffer(file);
}
function renderOtherFees(){
  const fees=window._otherFees||[];
  document.getElementById('other-fees-list').innerHTML=fees.map((f,i)=>
    '<div style="display:flex;gap:8px;margin-top:4px;align-items:center">'+
    '<input type="text" placeholder="费用名称" value="'+esc(f.name||'')+'" style="flex:1;padding:4px" onchange="updateOtherFee('+i+',\'name\',this.value)">'+
    '<input type="number" step="0.01" placeholder="金额" value="'+(f.amount||0)+'" style="width:120px;padding:4px" oninput="updateOtherFee('+i+',\'amount\',this.value);calcTotalFreight()">'+
    '<button class="action-btn" onclick="removeOtherFeeRow('+i+')">🗑️</button></div>').join('');
}
function addOtherFeeRow(){if(!window._otherFees)window._otherFees=[];window._otherFees.push({name:'',amount:0});renderOtherFees();}
function removeOtherFeeRow(idx){window._otherFees.splice(idx,1);renderOtherFees();calcTotalFreight();}
function updateOtherFee(idx,field,val){if(!window._otherFees[idx])return;if(field==='amount')window._otherFees[idx].amount=parseFloat(val)||0;else window._otherFees[idx][field]=val;}
function calcTotalFreight(){
  const freight=parseFloat(document.getElementById('npl-freight')?.value)||0;
  const otherSum=(window._otherFees||[]).reduce((s,f)=>s+(f.amount||0),0);
  const el=document.getElementById('total-freight-display');if(el)el.textContent=(freight+otherSum).toFixed(2);
}
async function saveLogWithPL(){
  const ci=window._plCI;if(!ci){showToast('请先选择CI','warning');return;}
  const items=window._plDraft||[];if(!items.length){showToast('PL明细不能为空','warning');return;}
  for(const it of items){if((Number(it.total_qty)||0)<=0){showToast('SKU '+it.sku_code+' 数量必须大于0','warning');return;}}
  // PL整体级校验：总毛重和总体积至少填写一项
  const totalGW=items.reduce((s,it)=>s+(parseFloat(it.gross_weight)||0),0);
  const totalCBM=items.reduce((s,it)=>s+(parseFloat(it.cbm)||0),0);
  if(totalGW<=0&&totalCBM<=0){showToast('总毛重和总体积至少需要填写一项','warning');return;}
  const otherSum=(window._otherFees||[]).reduce((s,f)=>s+(f.amount||0),0);
  const ffSel=document.getElementById('npl-ff');
  const d={related_ci_id:ci.id,related_ci_no:ci.ci_no,
    pl_no:document.getElementById('npl-no').value||'',batch_no:document.getElementById('npl-batchno').value||'',
    forwarder_id:ffSel.value||'',forwarder_name:ffSel.options[ffSel.selectedIndex]?.dataset.name||'',
    transport_mode:document.getElementById('npl-mode').value,
    target_country:document.getElementById('npl-country').value,
    target_warehouse:document.getElementById('npl-wh').value,pickup_date:document.getElementById('npl-pickup').value,
    eta_date:document.getElementById('npl-eta').value,
    freight_currency:document.getElementById('npl-cur').value,
    international_freight:parseFloat(document.getElementById('npl-freight').value)||0,
    local_charges:otherSum,customs_service_fee:0,delivery_fee:0,customs_duty:0,vat_gst:0,other_fees:0,
    remark:document.getElementById('npl-remark').value||'',
    total_cartons:parseInt(document.getElementById('npl-total-ctn')?.value)||0,
    items:items.map(it=>({sku_code:it.sku_code,cartons:it.cartons||0,qty_per_carton:it.qty_per_carton||0,
      total_qty:it.total_qty||0,gross_weight:it.gross_weight||0,net_weight:it.net_weight||0,cbm:it.cbm||0}))};
  try{
      const ownerIds=Array.from(document.querySelectorAll('#npl-owner-list .listing-owner-cb')).filter(cb=>cb.checked).map(cb=>cb.value);
  if(ownerIds.length===0){ showToast(t('logistics.listing.owner_required','上架负责人至少选择 1 人'),'warning'); return; }
  const ccIds=Array.from(document.querySelectorAll('#npl-cc-list .listing-cc-cb')).filter(cb=>cb.checked).map(cb=>cb.value);
  d.listing_owner_ids=ownerIds; d.listing_cc_user_ids=ccIds;
  const result=await api('/api/logistics-batches/create-with-pl','POST',d);
    showToast('创建成功：PL '+result.pl_no+' / 物流 '+result.batch_no,'success');
    closeModal();loadLog();
  }catch(e){showToast(e.message,'danger')}
}
async function editLog(id){
  try{
    const l=await api('/api/logistics-batches/'+id);
    let plData=null;if(l.pl_id){plData=await api('/api/packing-lists/'+l.pl_id);}
    const ffs=await api('/api/freight-forwarders');const users=await api('/api/users');const listingInfo=await api('/api/logistics-batches/'+id+'/listing').catch(()=>null);
    const ffOpts=ffs.map(f=>'<option value="'+f.id+'" data-name="'+esc(f.name)+'"'+(f.id===l.forwarder_id?' selected':'')+'>'+esc(f.name)+'</option>').join('');
    const plItems=(plData&&plData.items)||[];
    openModal(t('logistics.edit.title','编辑物流批次')+' — '+esc(l.batch_no),
      '<div class="form-card" style="box-shadow:none;padding:0;max-height:70vh;overflow-y:auto">'+
      '<div class="detail-section"><h3>'+t('logistics.edit.basic_info','基础信息')+'</h3><div class="form-grid">'+
      '<div class="form-group"><label>'+t('logistics.edit.batch_no','物流单号')+'</label><input type="text" id="el-batchno" value="'+esc(l.batch_no)+'"></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.pl_no','PL单号')+'</label><input type="text" id="el-plno" value="'+esc(plData?plData.pl_no:'')+'"></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.forwarder','货代')+'</label><select id="el-ff"><option value="">'+t('logistics.edit.select_forwarder','选择货代')+'</option>'+ffOpts+'</select></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.transport_mode','运输方式')+'</label><select id="el-mode"><option value="sea"'+(l.transport_mode==='sea'?' selected':'')+'>'+t('logistics.mode.sea','海运')+'</option><option value="air"'+(l.transport_mode==='air'?' selected':'')+'>'+t('logistics.mode.air','空运')+'</option><option value="land"'+(l.transport_mode==='land'?' selected':'')+'>'+t('logistics.mode.land','陆运')+'</option><option value="express"'+(l.transport_mode==='express'?' selected':'')+'>'+t('logistics.mode.express','快递')+'</option></select></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.target_country','目标国家')+'</label><input type="text" id="el-country" value="'+esc(countryLabel(l.target_country))+'" data-raw="'+esc(l.target_country)+'" onfocus="if(this.dataset.raw){this.value=this.dataset.raw;}" onblur="if(this.value===this.dataset.raw){this.value=this.dataset.display;}" data-display="'+esc(countryLabel(l.target_country))+'"></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.target_warehouse','目标仓库')+'</label><input type="text" id="el-wh" value="'+esc(l.target_warehouse)+'"></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.pickup_date','提货日期')+'</label><input type="date" id="el-pickup" value="'+(l.pickup_date||'')+'"></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.depart_date','出发日期')+'</label><input type="date" id="el-depart" value="'+(l.depart_date||'')+'"></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.eta','预计到港')+'</label><input type="date" id="el-eta" value="'+(l.eta_date||'')+'"></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.actual_arrival','实际到货日期')+'</label><input type="date" id="el-arrival" value="'+(l.actual_arrival_date||'')+'"></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.logistics_status','物流状态')+'</label><select id="el-status">'+logisticsEditOptions(l.logistics_status)+'</select></div>'+
      '</div></div>'+
      '<div class="detail-section"><h3>'+t('logistics.edit.pl_items','PL装箱明细')+' <span style="font-size:13px;font-weight:normal;color:#666">'+t('logistics.edit.total_cartons','总CTN数量')+': <b>'+(l.total_cartons||0)+'</b></span></h3>'+(plItems.length?'<div class="table-container" style="overflow-x:auto"><table class="data-table" style="font-size:12px;table-layout:fixed;width:100%;min-width:0"><colgroup><col style="width:22%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:13%"></colgroup><thead><tr><th>'+t('logistics.pl.sku','SKU')+'</th><th>'+t('logistics.pl.cartons','CTN数量')+'</th><th>'+t('logistics.pl.total_qty','总数量')+'</th><th>'+t('logistics.pl.gross_weight','总毛重')+'</th><th>'+t('logistics.pl.net_weight','总净重')+'</th><th>'+t('logistics.pl.cbm','总体积')+'</th><th>'+t('logistics.pl.received_qty','已入库')+'</th></tr></thead><tbody>'+plItems.map(it=>'<tr><td class="cell-id" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(it.sku_code)+'</td><td style="white-space:nowrap">'+(it.cartons||0)+'</td><td class="font-bold" style="white-space:nowrap">'+(it.total_qty||0)+'</td><td style="white-space:nowrap">'+(it.gross_weight||0)+'</td><td style="white-space:nowrap">'+(it.net_weight||0)+'</td><td style="white-space:nowrap">'+(it.cbm||0)+'</td><td style="white-space:nowrap">'+(it.received_qty||0)+'</td></tr>').join('')+'</tbody></table></div>':'<div style="padding:12px;color:#999">'+t('logistics.edit.no_pl_items','无PL明细')+'</div>')+'</div>'+
      '<div class="detail-section"><h3>'+t('logistics.edit.fee_info','费用信息')+'</h3><div class="form-grid">'+
      '<div class="form-group"><label>'+t('logistics.edit.freight_currency','运费币种')+'</label><select id="el-cur"><option'+(l.freight_currency==='USD'?' selected':'')+'>USD</option><option'+(l.freight_currency==='RMB'?' selected':'')+'>RMB</option><option'+(l.freight_currency==='IDR'?' selected':'')+'>IDR</option><option'+(l.freight_currency==='MYR'?' selected':'')+'>MYR</option><option'+(l.freight_currency==='THB'?' selected':'')+'>THB</option></select></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.freight','运费')+'</label><input type="number" step="0.01" id="el-freight" value="'+(l.international_freight||0)+'"></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.local_charges','其他运输费用')+'</label><input type="number" step="0.01" id="el-local" value="'+(l.local_charges||0)+'"></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.fee_status','费用状态')+'</label><select id="el-feestatus"><option value="unpaid"'+(l.fee_status==='unpaid'?' selected':'')+'>'+t('logistics.fee.unpaid','未付')+'</option><option value="paid"'+(l.fee_status==='paid'?' selected':'')+'>'+t('logistics.fee.paid','已付')+'</option></select></div>'+
      '<div class="form-group"><label>'+t('logistics.edit.remark','备注')+'</label><input type="text" id="el-remark" value="'+esc(l.remark||'')+'"></div>' + '<div class="detail-section"><h3>'+t('logistics.listing.section','上架信息')+'</h3><div class="form-grid">'+'<div class="form-group" style="grid-column:1/-1"><label>'+t('logistics.listing.owner','上架负责人')+' <span class="required">*</span></label><div class="cc-list" id="el-owner-list">'+userChecklist(users,(listingInfo&&listingInfo.listing_owner_ids)||[],'listing-owner-cb')+'</div></div>'+'<div class="form-group" style="grid-column:1/-1"><label>'+t('logistics.listing.cc','上架抄送(CC)')+'</label><div class="cc-list" id="el-cc-list">'+userChecklist(users,(listingInfo&&listingInfo.cc||[]).map(function(c){return c.user_id;}),'listing-cc-cb')+'</div></div>'+'</div></div>' + '</div></div></div>',
      '<button class="btn btn-secondary" onclick="closeModal()">'+t('common.cancel','取消')+'</button><button class="btn btn-primary" onclick="saveEditLog(\''+id+'\''+(plData?',\''+plData.id+'\'':'')+')">'+t('common.save','保存')+'</button>','modal-ci-create');
  }catch(e){showToast(e.message,'danger')}
}
async function saveEditLog(logId,plId){
  const ownerIds=Array.from(document.querySelectorAll('#el-owner-list .listing-owner-cb')).filter(cb=>cb.checked).map(cb=>cb.value);
  if(ownerIds.length===0){ showToast(t('logistics.listing.owner_required','上架负责人至少选择 1 人'),'warning'); return; }
  const ccIds=Array.from(document.querySelectorAll('#el-cc-list .listing-cc-cb')).filter(cb=>cb.checked).map(cb=>cb.value);
  const d={batch_no:document.getElementById('el-batchno').value,
    forwarder_id:document.getElementById('el-ff').value,
    forwarder_name:document.getElementById('el-ff').options[document.getElementById('el-ff').selectedIndex]?.dataset.name||'',
    transport_mode:document.getElementById('el-mode').value,
    target_country:(function(){var el=document.getElementById('el-country');var v=el.value;if(v===el.dataset.display&&el.dataset.raw){return el.dataset.raw;}return v;})(),
    target_warehouse:document.getElementById('el-wh').value,pickup_date:document.getElementById('el-pickup').value,
    depart_date:document.getElementById('el-depart').value,eta_date:document.getElementById('el-eta').value,actual_arrival_date:document.getElementById('el-arrival').value,
    logistics_status:document.getElementById('el-status').value,freight_currency:document.getElementById('el-cur').value,
    international_freight:parseFloat(document.getElementById('el-freight').value)||0,
    local_charges:parseFloat(document.getElementById('el-local').value)||0,
    fee_status:document.getElementById('el-feestatus').value,remark:document.getElementById('el-remark').value};
  try{
    await api('/api/logistics-batches/'+logId,'PUT',d);
    if(plId){await api('/api/packing-lists/'+plId,'PUT',{pl_no:document.getElementById('el-plno').value});}
    await api('/api/logistics-batches/'+logId+'/listing','POST',{listing_owner_ids:ownerIds,listing_cc_user_ids:ccIds});
    showToast(t('logistics.toast.save_success','保存成功'),'success');closeModal();loadLog();
  }catch(e){showToast(e.message,'danger')}
}

// 正常「到货日期」业务入口：复用正常 PUT /api/logistics-batches/:id，仅更新 actual_arrival_date
// 不走高别 backfill endpoint；completed 单也仅改此合法日期字段，不扩大其它业务字段编辑权限
async function editArrivalDate(id){
  try{
    const l=await api('/api/logistics-batches/'+id);
    openModal(t('logistics.edit.actual_arrival','实际到货日期')+' - '+esc(l.batch_no),
      '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
      '<div class="form-group form-group-full"><label>'+t('logistics.edit.actual_arrival','实际到货日期')+'</label>'+
      '<input type="date" id="arrival-date-input" value="'+(l.actual_arrival_date||'')+'" style="width:100%"></div>'+
      '</div><div id="arrival-date-err" class="form-error"></div></div>',
      '<button class="btn btn-secondary" onclick="closeModal()">'+t('common.cancel','取消')+'</button>'+
      '<button class="btn btn-primary" onclick="saveArrivalDate(\''+id+'\')">'+t('common.save','保存')+'</button>',
      'modal-ci-create');
  }catch(e){showToast(e.message,'danger')}
}
async function saveArrivalDate(id){
  try{
    const date=document.getElementById('arrival-date-input').value;
    await api('/api/logistics-batches/'+id,'PUT',{actual_arrival_date:date});
    closeModal();
    showToast(t('logistics.edit.arrival_saved','到货日期已保存'),'success');
    loadLog();
  }catch(e){const el=document.getElementById('arrival-date-err');if(el)el.textContent=e.message;showToast(e.message,'danger')}
}

async function notifyListing(id){
  try{
    await api('/api/logistics-batches/'+id+'/notify','POST');
    showToast(t('logistics.toast.notify_sent','上架提醒已发送'),'success');
  }catch(e){showToast(e.message,'danger')}
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

// LOGISTICS-COST-LINK-V2：从物流单费用生成 ci_cost_items（成本事实）+ payable_items（应付费用列表）
// 成本流与资金流分离：不自动创建 payment_request，付款申请由人工在应付费用列表提交
async function generateCostItems(id){
  try{
    const log=await api('/api/logistics-batches/'+id);
    if(!log.related_ci_id){showToast(t('logistics.gen_cost.no_ci','该物流批次未关联CI，无法生成成本记录'),'warning');return}
    const freightTotal=(Number(log.international_freight)||0)+(Number(log.local_charges)||0)+(Number(log.customs_service_fee)||0)+(Number(log.delivery_fee)||0);
    const dutyTotal=(Number(log.customs_duty)||0)+(Number(log.vat_gst)||0);
    const otherTotal=Number(log.other_fees)||0;
    if(freightTotal<=0&&dutyTotal<=0&&otherTotal<=0){showToast(t('logistics.gen_cost.no_fees','物流单费用均为0，无需生成成本记录'),'warning');return}
    const currency=log.freight_currency||'USD';
    const defaultPayee=log.forwarder_name||'';
    let costListHtml='';
    if(freightTotal>0)costListHtml+='<div style="display:flex;justify-content:space-between;padding:4px 0"><span>'+t('logistics.gen_cost.freight','运费(国际运费+本地费用+报关服务费+派送费)')+'</span><b>'+fmtMoney(freightTotal,currency)+'</b></div>';
    if(dutyTotal>0)costListHtml+='<div style="display:flex;justify-content:space-between;padding:4px 0"><span>'+t('logistics.gen_cost.duty','关税(关税+增值税/GST)')+'</span><b>'+fmtMoney(dutyTotal,currency)+'</b></div>';
    if(otherTotal>0)costListHtml+='<div style="display:flex;justify-content:space-between;padding:4px 0"><span>'+t('logistics.gen_cost.other','其他费用')+'</span><b>'+fmtMoney(otherTotal,currency)+'</b></div>';
    openModal(t('logistics.gen_cost.title','生成成本记录')+' - '+esc(log.batch_no),
      '<div style="margin-bottom:16px">'+t('logistics.gen_cost.confirm_hint','以下费用将生成CI成本记录并推送到应付费用列表，付款申请需在应付费用列表手动提交：')+'</div>'+
      '<div style="background:#f5f5f5;padding:12px;border-radius:4px;margin-bottom:16px">'+costListHtml+'</div>'+
      '<div style="margin-bottom:8px"><label style="display:block;margin-bottom:4px;font-weight:600">'+t('logistics.gen_cost.payee','收款方')+'</label><input type="text" id="gen-cost-payee" class="form-input" value="'+esc(defaultPayee)+'" placeholder="'+t('logistics.gen_cost.payee_placeholder','货代/报关行名称')+'"></div>'+
      '<div style="color:#999;font-size:12px">'+t('logistics.gen_cost.note','提示：生成后可在应付费用列表查看并手动提交付款申请。关税将自动更新CI的Import Duty总额。')+'</div>',
      '<button class="btn btn-secondary" onclick="closeModal()">'+t('common.cancel','取消')+'</button><button class="btn btn-primary" onclick="confirmGenerateCostItems(\''+id+'\')">'+t('logistics.gen_cost.confirm','确认生成')+'</button>',
      'modal-ci-create');
  }catch(e){showToast(e.message,'danger')}
}
async function confirmGenerateCostItems(id){
  try{
    const payeeName=document.getElementById('gen-cost-payee')?.value||'';
    const result=await api('/api/logistics-batches/'+id+'/generate-cost-items','POST',{payee_name:payeeName});
    closeModal();
    const items=result.generated||[];
    let msg=t('logistics.gen_cost.success','成本记录已生成')+' ('+items.length+t('logistics.gen_cost.items','笔')+'), '+t('logistics.gen_cost.payable_hint','请在应付费用列表提交付款申请')+'\n';
    items.forEach(it=>{msg+=it.fee_no+' - '+it.cost_category+'/'+it.cost_subcategory+' '+fmtMoney(it.amount,result.currency||'')+'\n'});
    showToast(msg,'success');
    loadLog();
  }catch(e){showToast(e.message,'danger')}
}

// ==================== WAC 确认（原入库管理页面改造） ====================
// 物流批次到货后 → WAC确认 → 更新库存成本
// 不做传统ERP入库闭环，只打通「物流 → WAC → 库存成本」
// WAC是否确认以 wac_history 记录为事实来源，不增加第二套状态
async function renderInbound(){
  document.getElementById('content-inner').innerHTML='<div id="flash-container"></div>'+
    '<div class="filter-bar"><div class="filter-form"><div class="filter-actions">'+
    '<button class="btn btn-primary btn-sm" onclick="loadWacPending()">'+t('wac.refresh','刷新')+'</button>'+
    '<button class="btn btn-secondary btn-sm" onclick="loadWacHistory()" style="margin-left:8px">'+t('wac.history','确认历史')+'</button>'+
    '</div></div></div>'+
    '<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">💰 '+t('wac.pending_title','待WAC确认的物流批次')+'</div></div><div id="wac-table"></div></div>';
  loadWacPending();
}

// 加载待WAC确认的物流批次列表
// 以 wac_history 中是否存在 logistics_batch_id 记录作为"已确认"判断
async function loadWacPending(){
  try{
    const data=await api('/api/wac/pending-batches');
    document.getElementById('wac-table').innerHTML=!data.length?
      '<div class="empty-state"><div class="empty-icon">💰</div>'+t('wac.no_pending','暂无待确认的物流批次')+'</div>':
      '<div class="table-container" style="box-shadow:none;border-radius:0">'+
      '<table class="data-table"><thead><tr>'+
      '<th>'+t('wac.col_batch_no','物流单号')+'</th>'+
      '<th>'+t('wac.col_ci','关联CI')+'</th>'+
      '<th>'+t('wac.col_forwarder','货代')+'</th>'+
      '<th>'+t('wac.col_country','国家')+'</th>'+
      '<th>'+t('wac.col_warehouse','仓库')+'</th>'+
      '<th>'+t('wac.col_arrival','到货日期')+'</th>'+
      '<th>'+t('wac.col_pl_qty','PL总数量')+'</th>'+
      '<th>'+t('wac.col_goods','货值')+'</th>'+
      '<th>'+t('wac.col_action','操作')+'</th>'+
      '</tr></thead><tbody>'+
      data.map(r=>'<tr>'+
        '<td class="cell-id">'+esc(r.batch_no)+'</td>'+
        '<td class="cell-id">'+esc(r.ci_no||r.related_ci_no||'-')+'</td>'+
        '<td>'+esc(r.forwarder_name||'-')+'</td>'+
        '<td>'+countryLabel(r.target_country)+'</td>'+
        '<td>'+esc(r.target_warehouse||'-')+'</td>'+
        '<td class="cell-date">'+fmtDate(r.actual_arrival_date)+'</td>'+
        '<td class="text-right">'+(r.pl_total_qty||0)+'</td>'+
        '<td class="text-right">'+(r.goods_amount||0)+' '+(r.ci_currency||'')+'</td>'+
        '<td><button class="btn btn-primary btn-sm" onclick="wacConfirm(\''+r.id+'\')">'+t('wac.btn_confirm','WAC确认')+'</button></td>'+
      '</tr>').join('')+
      '</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
}

// WAC确认弹窗：展示PL明细 + 用户输入旧库存数量 + 自动计算新WAC
// 结构：固定(标题/批次信息/公式/操作栏) + 滚动(SKU明细表) + 固定(底部按钮)
async function wacConfirm(batchId){
  try{
    const p=await api('/api/wac/preview/'+batchId);
    window._wacPreview=p;
    const m=p.meta||{};
    const blockers=p.blockers||[];
    const items=p.items||[];
    window._wacImport={batchId:batchId,matched:[],missing:[],unknown:[],duplicate:[],invalid:[]};
    const skuIndex={};
    items.forEach((it,i)=>{const k=String(it.sku_code);if(!(k in skuIndex))skuIndex[k]=i;});
    window._wacSkuIndex=skuIndex;

    // ── Blocker panel (if any) ──
    let blockerHtml='';
    if(blockers.length>0){
      blockerHtml='<div style="background:#fff2f0;border:1px solid #ffccc7;border-radius:6px;padding:12px 16px;margin-bottom:12px">'+
        '<div style="font-size:14px;font-weight:bold;color:#cf1322">⚠️ '+t('wac.cannot_confirm','当前批次不可确认WAC')+'</div>'+
        '<div style="font-size:12px;color:#999;margin-bottom:8px">'+t('wac.blocker_title','WAC确认阻断')+' ('+blockers.length+')</div>'+
        blockers.map(b=>{
          const friendly=t('blocker.'+b.code,b.message||b.code);
          const detailStr=b.detail?(Object.entries(b.detail).map(([k,v])=>esc(k)+'='+esc(String(v))).join(', ')):'';
          return '<div style="padding:4px 0;border-bottom:1px solid #fff0f0">'+
            '<span style="color:#cf1322">● '+esc(friendly)+'</span> '+
            '<span style="font-size:11px;color:#999">'+esc(b.code)+'</span>'+
            (detailStr?'<div style="font-size:11px;color:#999;margin-left:16px">'+detailStr+'</div>':'')+
          '</div>';
        }).join('')+
      '</div>';
    }

    // ── Batch info ──
    const batchInfo='<div style="background:#f0f8ff;padding:12px 16px;border-radius:6px;margin-bottom:12px;font-size:13px">'+
      '<b>'+t('wac.batch_info','物流批次')+'</b>：'+esc(m.batch_no||'')+' ｜ '+
      '<b>CI</b>：'+esc(m.ci_no||'-')+' ｜ '+
      '<b>'+t('wac.target_currency','目标货币')+'</b>：'+esc(m.local_currency||'-')+' ｜ '+
      '<b>'+t('wac.arrival','到货日期')+'</b>：'+fmtDate(m.actual_arrival_date)+' ｜ '+
      '<b>'+t('wac.allocation_basis','分摊基准')+'</b>：'+esc(m.transport_basis?String(m.transport_basis).toUpperCase():'-')+
      (m.already_confirmed?' ｜ <span style="color:#fa8c16">'+t('wac.already_confirmed','该批次已完成WAC确认')+'</span>':'')+
    '</div>';

    // ── Cost facts sections (only when no blockers) ──
    let costFactsHtml='';
    if(blockers.length===0 && items.length>0){
      const it0=items[0];
      // Product Cost section
      costFactsHtml+='<div style="background:#f6ffed;border:1px solid #d9f7be;border-radius:6px;padding:10px 14px;margin-bottom:8px">'+
        '<div style="font-weight:bold;font-size:13px;margin-bottom:6px">📦 '+t('wac.product_cost_section','产品成本')+'</div>'+
        '<div style="display:flex;gap:20px;font-size:12px;flex-wrap:wrap">'+
          '<span>'+t('wac.original_currency','原始货币')+': <b>'+esc(m.ci_currency||'')+'</b></span>'+
          '<span>'+t('wac.original_amount','原始金额')+': <b>'+fmtMoney(m.ci_goods_amount_total,m.ci_currency)+'</b></span>'+
          '<span>'+t('wac.actual_payment_date','到货日期')+': <b>'+fmtDate(m.actual_arrival_date)+'</b></span>'+
          '<span>'+t('wac.product_fx','产品汇率')+': <b>'+(it0.product_fx_rate!=null?Number(it0.product_fx_rate).toFixed(4)+' ('+esc(it0.product_fx_direction||'')+')':'-')+'</b></span>'+
          '<span>'+t('wac.fx_rate_date','汇率日期')+': <b>'+fmtDate(m.actual_arrival_date)+'</b></span>'+
        '</div></div>';

      // Freight section
      const pb=m.freight_payment_breakdown||[];
      const pbHtml=pb.length?'<div style="margin-top:6px"><div style="font-size:12px;font-weight:bold;margin-bottom:4px">'+t('wac.payment_breakdown','付款明细')+'</div>'+
        '<table class="data-table" style="font-size:11px;min-width:400px"><thead><tr>'+
        '<th>PR ID</th><th>'+t('wac.original_amount','原始金额')+'</th><th>'+t('wac.local_currency','本币')+'</th><th>'+t('wac.effective_fx_rate','有效汇率')+'</th><th>'+t('wac.fx_rate_date','汇率日期')+'</th><th>'+t('wac.actual_payment_date','付款日期')+'</th><th>'+t('wac.local_amount','本币金额')+'</th>'+
        '</tr></thead><tbody>'+
        pb.map(pd=>'<tr>'+
          '<td class="cell-id">'+esc(pd.payment_request_id)+'</td>'+
          '<td class="text-right">'+Number(pd.amount).toFixed(2)+'</td>'+
          '<td>'+esc(pd.local_currency)+'</td>'+
          '<td class="text-right">'+Number(pd.local_rate).toFixed(4)+'</td>'+
          '<td class="cell-date">'+fmtDate(pd.local_rate_date)+'</td>'+
          '<td class="cell-date">'+fmtDate(pd.paid_date)+'</td>'+
          '<td class="text-right">'+Number(pd.local_amount).toFixed(2)+'</td>'+
        '</tr>').join('')+
        '</tbody></table></div>':'<div style="font-size:11px;color:#999;margin-top:4px">'+t('wac.no_payment_breakdown','暂无付款明细')+'</div>';

      costFactsHtml+='<div style="background:#f6ffed;border:1px solid #d9f7be;border-radius:6px;padding:10px 14px;margin-bottom:8px">'+
        '<div style="font-weight:bold;font-size:13px;margin-bottom:6px">🚢 '+t('wac.freight_section','运费')+'</div>'+
        '<div style="display:flex;gap:20px;font-size:12px;flex-wrap:wrap">'+
          '<span>'+t('wac.original_currency','原始货币')+': <b>'+esc(m.freight_currency||'')+'</b></span>'+
          '<span>'+t('wac.business_amount','业务金额')+': <b>'+fmtMoney(m.freight_business_amount,m.freight_currency)+'</b></span>'+
          '<span>'+t('wac.payment_status','付款状态')+': <b>'+(pb.length>0?'✅ '+t('wac.import_ok','就绪'):'❌')+'</b></span>'+
          '<span>'+t('wac.last_paid_date','最后付款日期')+': <b>'+fmtDate(m.freight_last_paid_date)+'</b></span>'+
          '<span>'+t('wac.effective_rate','有效汇率')+': <b>'+(m.freight_effective_rate!=null?Number(m.freight_effective_rate).toFixed(4):'-')+'</b></span>'+
          '<span>'+t('wac.local_amount','本币金额')+': <b>'+fmtMoney(m.freight_local_amount,m.local_currency)+'</b></span>'+
        '</div>'+pbHtml+'</div>';

      // Duty section
      costFactsHtml+='<div style="background:#f6ffed;border:1px solid #d9f7be;border-radius:6px;padding:10px 14px;margin-bottom:8px">'+
        '<div style="font-weight:bold;font-size:13px;margin-bottom:6px">📋 '+t('wac.duty_section','关税')+'</div>'+
        '<div style="display:flex;gap:20px;font-size:12px;flex-wrap:wrap">'+
          '<span>'+t('wac.original_amount','原始金额')+': <b>'+fmtMoney(m.duty_business_amount,m.freight_currency)+'</b></span>'+
          '<span>'+t('wac.vat_excluded','增值税已排除')+': ✅</span>'+
          '<span>'+t('wac.local_amount','本币金额')+': <b>'+fmtMoney(m.duty_local_amount,m.local_currency)+'</b></span>'+
        '</div></div>';

      // Inspection/Other section
      const inspTotal=(m.inspection_local_total||0)+(m.other_local_total||0);
      costFactsHtml+='<div style="background:#f6ffed;border:1px solid #d9f7be;border-radius:6px;padding:10px 14px;margin-bottom:8px">'+
        '<div style="font-weight:bold;font-size:13px;margin-bottom:6px">🔧 '+t('wac.inspection_section','检验/其他')+'</div>'+
        '<div style="display:flex;gap:20px;font-size:12px;flex-wrap:wrap">'+
          '<span>'+t('wac.local_amount','本币金额')+': <b>'+fmtMoney(inspTotal,m.local_currency)+'</b></span>'+
          '<span style="font-size:11px;color:#999">('+t('wac.inspection_section','检验/其他')+': '+(m.inspection_local_total||0).toFixed(2)+' + '+(m.other_local_total||0).toFixed(2)+')</span>'+
        '</div></div>';
    }

    // ── SKU table (only when no blockers) ──
    let skuTableHtml='';
    if(blockers.length===0 && items.length>0){
      const rowsHtml=items.map((it,i)=>{
        const oldQty=it.old_qty||it.available_qty||0;
        const oldWac=it.current_wac||0;
        const batchQty=it.batch_qty||0;
        const unitCost=it.unit_landing_cost||0;
        const newQty=oldQty+batchQty;
        const newWac=it.new_wac||0;
        return '<tr>'+
          '<td class="cell-id">'+esc(it.sku_code)+'</td>'+
          '<td>'+esc(it.product_name||it.model||'-')+'</td>'+
          '<td class="text-right">'+batchQty+'</td>'+
          '<td class="text-right">'+(it.weighted_purchase_unit_price||0).toFixed(4)+'</td>'+
          '<td class="text-right">'+(it.customs_rate!==null&&it.customs_rate!==undefined?Number(it.customs_rate).toFixed(4):'-')+'</td>'+
          '<td class="text-right" style="color:#999">'+(it.old_qty||it.available_qty||0)+'</td>'+
          '<td><input type="number" id="wac-old-'+i+'" value="'+oldQty+'" placeholder="0" min="0" step="1" style="width:90px;padding:4px;text-align:right;background:#fffbe6" onchange="recalcWacRow('+i+');wacValidateInputs()"></td>'+
          '<td class="text-right">'+(it.current_wac||0).toFixed(4)+' <span style="font-size:10px;color:#999">'+esc(m.local_currency||'')+'</span></td>'+
          '<td class="text-right">'+(it.product_cost_local||0).toFixed(2)+'</td>'+
          '<td class="text-right">'+(it.freight_cost_local||0).toFixed(2)+'</td>'+
          '<td class="text-right">'+(it.customs_cost_local||0).toFixed(2)+'</td>'+
          '<td class="text-right">'+((it.inspection_cost_local||0)+(it.other_cost_local||0)).toFixed(2)+'</td>'+
          '<td class="text-right font-bold">'+(it.unit_landing_cost||0).toFixed(4)+' <span style="font-size:10px;color:#999">'+esc(m.local_currency||'')+'</span></td>'+
          '<td class="text-right font-bold" id="wac-new-'+i+'" style="color:#1890ff">'+newWac.toFixed(4)+' <span style="font-size:10px;color:#999">'+esc(m.local_currency||'')+'</span></td>'+
        '</tr>';
      }).join('');

      const opBar='<div class="wac-opbar">'+
        '<button class="btn btn-secondary btn-sm" onclick="exportWacOldInventoryTemplate()">📥 '+t('wac.btn_export_old','导出旧库存模板')+'</button>'+
        '<button class="btn btn-secondary btn-sm" onclick="importWacOldInventory()">📤 '+t('wac.btn_import_old','导入旧库存')+'</button>'+
        '<span class="wac-import-status" id="wac-import-status"><span class="warn">'+t('wac.import_not_imported','未导入')+'</span></span>'+
      '</div>';

      const formulaHint='<div style="background:#fffbe6;padding:10px 14px;border-radius:6px;margin-bottom:12px;font-size:12px;color:#666">'+
        t('wac.formula_hint','移动加权公式：新WAC = (旧库存数量 × 当前WAC + 本批次数量 × 单位落地成本) ÷ (旧库存数量 + 本批次数量)')+'<br>'+
        t('wac.landing_cost_hint_v2','单位落地成本 = (SKU级采购成本 + 按成本比例分摊的物流/其他费用 + 按税率权重分摊的关税) ÷ SKU数量')+'<br>'+
        t('wac.old_qty_hint','⚠️ 旧库存数量需人工输入，请根据实际盘点填写，不可直接使用系统库存数量')+
      '</div>';

      skuTableHtml=formulaHint+opBar+
        '<div class="wac-table-scroll">'+
        '<table class="data-table" style="table-layout:auto;min-width:1100px"><thead><tr>'+
          '<th>SKU</th><th>'+t('wac.col_product','产品')+'</th>'+
          '<th>'+t('wac.col_pl_qty','PL数量')+'</th>'+
          '<th>'+t('wac.col_weighted_price','加权采购单价')+'</th>'+
          '<th>'+t('wac.col_customs_rate','关税税率')+'</th>'+
          '<th>'+t('wac.col_avail','当前库存')+'</th>'+
          '<th>'+t('wac.col_old_qty','旧库存数量')+'</th>'+
          '<th>'+t('wac.col_current_wac','当前WAC')+'</th>'+
          '<th>'+t('wac.col_product_cost_local','产品成本(本币)')+'</th>'+
          '<th>'+t('wac.col_freight_local','运费分摊(本币)')+'</th>'+
          '<th>'+t('wac.col_duty_local','关税分摊(本币)')+'</th>'+
          '<th>'+t('wac.col_inspection_local','检验分摊(本币)')+'</th>'+
          '<th>'+t('wac.col_unit_landing','单位落地成本')+'</th>'+
          '<th>'+t('wac.col_new_wac','新WAC')+'</th>'+
        '</tr></thead><tbody>'+rowsHtml+'</tbody></table></div>';
    }

    const head='<div class="form-card" style="box-shadow:none;padding:0;display:flex;flex-direction:column;overflow:hidden">'+
      batchInfo+blockerHtml+costFactsHtml+skuTableHtml+
    '</div>';

    const footerBtns='<button class="btn btn-secondary" onclick="closeModal()">'+t('common.cancel','取消')+'</button>'+
      (blockers.length===0||m.already_confirmed
        ? '<button class="btn btn-primary" id="wac-confirm-btn" '+(m.already_confirmed?'disabled':'')+' onclick="submitWacConfirm(\''+batchId+'\')">'+t('wac.btn_submit','确认WAC')+'</button>'
        : '<button class="btn btn-primary" id="wac-confirm-btn" disabled>'+t('wac.cannot_confirm','当前批次不可确认WAC')+'</button>');

    openModal(
      t('wac.modal_title','WAC确认')+' - '+(m.batch_no||''),
      head,
      footerBtns,
    'modal-wac');
    if(blockers.length===0&&!m.already_confirmed) wacValidateInputs();
  }catch(e){showToast(e.message,'danger')}
}

// 行内重算新WAC（用户修改旧库存数量时实时更新预览）
function recalcWacRow(i){
  const p=window._wacPreview;
  if(!p||!p.items[i])return;
  const it=p.items[i];
  const oldQty=parseFloat(document.getElementById('wac-old-'+i)?.value)||0;
  const oldWac=it.current_wac||0;
  const batchQty=it.batch_qty||0;
  const unitCost=it.unit_landing_cost||0;
  const newQty=oldQty+batchQty;
  const newWac=newQty>0?Math.round((oldQty*oldWac+batchQty*unitCost)/newQty*10000)/10000:unitCost;
  const cell=document.getElementById('wac-new-'+i);
  if(cell)cell.textContent=newWac.toFixed(4);
}

// 读取某行 old_qty 输入，严格区分 0 与 空白/非法（不使用 if(!qty) 这类判断）
function readWacOldRaw(i){
  const el=document.getElementById('wac-old-'+i);
  if(!el) return {ok:false,reason:'missing'};
  const raw=String(el.value==null?'':el.value).trim();
  if(raw==='') return {ok:false,reason:'blank'};
  const num=Number(raw);
  if(isNaN(num)) return {ok:false,reason:'nan'};
  if(num<0) return {ok:false,reason:'negative'};
  return {ok:true,value:num};
}
// 实时校验：任何输入空白/非法 → 禁止确认；文件级 unknown/duplicate 永久阻断
function wacValidateInputs(){
  const p=window._wacPreview; const st=window._wacImport;
  if(!p||!p.items) return;
  const items=p.items;
  const liveInvalid=[];
  items.forEach((it,i)=>{
    const r=readWacOldRaw(i);
    if(!r.ok) liveInvalid.push(it.sku_code);
  });
  // 重新 reconcile：把已变为合法的 missing/invalid 从文件级列表中移除（支持手工修正后解禁）
  if(st){
    st.missing=st.missing.filter(s=>liveInvalid.includes(s));
    st.invalid=st.invalid.filter(s=>liveInvalid.includes(s));
  }
  const unknownN=st?st.unknown.length:0;
  const duplicateN=st?st.duplicate.length:0;
  const blocked=liveInvalid.length>0||unknownN>0||duplicateN>0;
  const statusEl=document.getElementById('wac-import-status');
  const btn=document.getElementById('wac-confirm-btn');
  if(statusEl){
    const parts=[];
    const matchedN=st?st.matched.length:0;
    const missingN=st?st.missing.length:0;
    const unknownArr=st?st.unknown:[];
    const duplicateArr=st?st.duplicate:[];
    const invalidArr=st?st.invalid:[];
    parts.push('<span class="'+(matchedN?'ok':'')+'">'+t('wac.import_matched','已匹配')+': '+matchedN+'</span>');
    if(missingN) parts.push('<span class="bad">'+t('wac.import_missing','缺失SKU')+': '+missingN+' ('+st.missing.join(', ')+')</span>');
    if(unknownArr.length) parts.push('<span class="bad">'+t('wac.import_unknown','未知SKU')+': '+unknownArr.length+' ('+unknownArr.join(', ')+')</span>');
    if(duplicateArr.length) parts.push('<span class="bad">'+t('wac.import_duplicate','重复SKU')+': '+duplicateArr.length+' ('+duplicateArr.join(', ')+')</span>');
    if(invalidArr.length) parts.push('<span class="bad">'+t('wac.import_invalid','非法数量')+': '+invalidArr.length+' ('+invalidArr.join(', ')+')</span>');
    if(liveInvalid.length) parts.push('<span class="bad">'+t('wac.import_live_invalid','当前输入异常')+': '+liveInvalid.length+' ('+liveInvalid.join(', ')+')</span>');
    if(!missingN&&!unknownArr.length&&!duplicateArr.length&&!invalidArr.length&&!liveInvalid.length){
      parts.push('<span class="ok">'+t('wac.import_ok','就绪')+'</span>');
    }
    statusEl.innerHTML=parts.join(' ');
  }
  if(btn) btn.disabled=blocked;
}
// 导出旧库存模板：以当前 WAC Preview 的 SKU 集合为唯一来源（按 sku_code 防御性去重）
async function exportWacOldInventoryTemplate(){
  try{
    const p=window._wacPreview;
    if(!p||!p.items||!p.items.length){showToast(t('wac.export_no_data','暂无SKU可导出'),'warning');return;}
    const seen={}; const rows=[];
    p.items.forEach(it=>{
      const k=String(it.sku_code);
      if(seen[k])return; seen[k]=true;
      rows.push({'SKU':k,'原库存数量':'','备注':''});
    });
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,t('wac.old_inventory_sheet','旧库存模板'));
    const safeBatch=String(p.batch_no||'batch').replace(/[\\/:*?"<>|]/g,'_');
    XLSX.writeFile(wb,'WAC_OldInventory_'+safeBatch+'.xlsx');
    showToast(t('wac.export_ok','已导出旧库存模板，请填写「原库存数量」后重新导入'),'success');
  }catch(e){showToast(e.message,'danger')}
}
// 导入旧库存 Excel：完整校验（SKU列/数量列/空SKU/0与空白/负数/非数字/重复/未知/缺失）
async function importWacOldInventory(){
  const p=window._wacPreview; const st=window._wacImport;
  if(!p||!p.items||!p.items.length){showToast(t('wac.import_no_data','请先打开WAC确认弹窗'),'warning');return;}
  if(!st||st.batchId!==p.batch_no){st&&(st.batchId=p.batch_no);}
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
        if(rows.length<2){showToast(t('wac.import_file_empty','文件为空或仅含表头'),'danger');return;}
        const headers=rows[0].map(h=>String(h==null?'':h).trim());
        const skuIdx=headers.findIndex(h=>h==='SKU'||h==='sku_code');
        const qtyIdx=headers.findIndex(h=>h.indexOf('原库存数量')!==-1||h==='original_qty'||h==='old_qty');
        if(skuIdx<0){showToast(t('wac.err_no_sku_col','缺少 SKU 列，请使用导出的模板'),'danger');return;}
        if(qtyIdx<0){showToast(t('wac.err_no_qty_col','缺少 原库存数量 列，请使用导出的模板'),'danger');return;}
        // 当前批次 SKU 集合（去重）
        const skuIndex=window._wacSkuIndex||{};
        const batchSkus=Object.keys(skuIndex);
        const batchSet=new Set(batchSkus);
        // 解析文件行
        const fileMap={}; // sku -> [{row, qtyRaw, qtyKind}]
        const parseErrors=[]; let hasValidRow=false;
        for(let i=1;i<rows.length;i++){
          const row=rows[i];
          if(!row||row.every(c=>c===''||c==null))continue; // 整行空跳过
          const skuRaw=row[skuIdx];
          const sku=String(skuRaw==null?'':skuRaw).trim();
          if(!sku){parseErrors.push(t('wac.err_empty_sku','第 {v1} 行 SKU 为空',{v1:i+1}));continue;}
          const qtyRaw=row[qtyIdx];
          // 0 与空白严格区分
          let qtyKind;
          if(qtyRaw===''||qtyRaw==null) qtyKind='blank';
          else{
            const num=Number(String(qtyRaw).trim());
            if(isNaN(num)) qtyKind='nan';
            else if(num<0) qtyKind='negative';
            else qtyKind='num';
          }
          if(!fileMap[sku])fileMap[sku]=[];
          fileMap[sku].push({row:i+1,qtyRaw:qtyRaw,qtyKind:qtyKind});
          if(qtyKind==='num')hasValidRow=true;
        }
        if(!hasValidRow&&Object.keys(fileMap).length===0){showToast(t('wac.import_no_valid','未找到有效数据'),'danger');return;}

        const matched=[]; const missing=[]; const unknown=[]; const duplicate=[]; const invalid=[];
        batchSkus.forEach(sku=>{
          const idx=skuIndex[sku];
          if(!(sku in fileMap)){ // Excel 中完全缺失该 SKU → 清空输入框(置为空白)，强制用户处理后才可确认
            missing.push(sku);
            const el=document.getElementById('wac-old-'+idx);
            if(el){el.value=''; recalcWacRow(idx);}
            return;
          }
          const entries=fileMap[sku];
          if(entries.length>1){ duplicate.push(sku); return; }
          const e0=entries[0];
          if(e0.qtyKind==='blank'){ // Excel 中该 SKU 数量空白 → 视为未提供旧库存，清空输入框
            missing.push(sku);
            const el=document.getElementById('wac-old-'+idx);
            if(el){el.value=''; recalcWacRow(idx);}
            return;
          }
          if(e0.qtyKind==='nan'||e0.qtyKind==='negative'){ invalid.push(sku); return; }
          // num → 回填输入框并实时重算（0 也合法，保留数字 0）
          const el=document.getElementById('wac-old-'+idx);
          if(el){el.value=String(Number(String(e0.qtyRaw).trim())); recalcWacRow(idx);}
          matched.push(sku);
        });
        // 文件中不在当前批次的 SKU → unknown
        Object.keys(fileMap).forEach(sku=>{ if(!batchSet.has(sku)) unknown.push(sku); });

        // 覆盖式写入本次导入状态（每次导入都重置，不继承上次）
        st.matched=matched; st.missing=missing.slice(); st.unknown=unknown.slice(); st.duplicate=duplicate.slice(); st.invalid=invalid.slice();

        const msgs=[];
        if(missing.length) msgs.push(t('wac.import_missing','缺失SKU')+': '+missing.join(', '));
        if(unknown.length) msgs.push(t('wac.import_unknown','未知SKU')+'（'+t('wac.import_unknown_hint','不在当前批次')+'）: '+unknown.join(', '));
        if(duplicate.length) msgs.push(t('wac.import_duplicate','重复SKU')+': '+duplicate.join(', '));
        if(invalid.length) msgs.push(t('wac.import_invalid','非法数量')+': '+invalid.join(', '));
        if(parseErrors.length) msgs.push(parseErrors.join('；'));

        wacValidateInputs();

        if(msgs.length){
          showToast(t('wac.import_done_with_err','导入完成但存在异常：')+msgs.join('；'),'warning');
        }else{
          showToast(t('wac.import_success','导入成功，已匹配 {v1} 个 SKU',{v1:matched.length}),'success');
        }
      }catch(err){showToast(t('wac.import_fail','导入失败：{v1}',{v1:err.message}),'danger')}
    };
    reader.readAsArrayBuffer(file);
  };
  input.click();
}
// 提交WAC确认
// 只更新 inventory.weighted_avg_cost，不更新 available_qty
async function submitWacConfirm(batchId){
  const p=window._wacPreview;
  if(!p){closeModal();return}
  // 提交前再次校验：文件结构错误（未知/重复 SKU）直接拦截
  wacValidateInputs();
  const st=window._wacImport;
  if(st&&(st.unknown.length||st.duplicate.length)){
    showToast(t('wac.confirm_blocked','存在缺失/异常 SKU，禁止确认 WAC：')+st.unknown.concat(st.duplicate).join(', '),'danger');
    return;
  }
  // 提交层独立安全：逐 SKU 读取；任何 blank/nan/negative/非法 立即拒绝，绝不 fallback 0
  const items=[];
  for(let i=0;i<(p.items||[]).length;i++){
    const it=p.items[i];
    const r=readWacOldRaw(i);
    if(!r.ok){
      showToast(t('wac.confirm_blocked','存在缺失/异常 SKU，禁止确认 WAC：')+esc(it.sku_code),'danger');
      return;
    }
    items.push({ sku_code:it.sku_code, old_qty:r.value });
  }
  if(items.length===0){showToast(t('wac.no_items','无PL明细数据'),'warning');return}
  if(!confirm(t('wac.confirm_msg','确认提交WAC计算？写入后不可修改。')))return;
  try{
    const r=await api('/api/wac/confirm/'+batchId,'POST',{items});
    showToast(t('wac.success','WAC确认成功，共{v1}个SKU更新','',{v1:r.confirmed_count}),'success');
    closeModal();loadWacPending();
  }catch(e){showToast(e.message,'danger')}
}

// WAC确认历史（从 wac_history 派生，不依赖 logistics_batches 状态字段）
async function loadWacHistory(){
  try{
    const data=await api('/api/wac/confirmed-batches');
    document.getElementById('wac-table').innerHTML=!data.length?
      '<div class="empty-state"><div class="empty-icon">📋</div>'+t('wac.no_history','暂无WAC确认历史')+'</div>':
      '<div class="table-container" style="box-shadow:none;border-radius:0">'+
      '<table class="data-table"><thead><tr>'+
      '<th>'+t('wac.col_batch_no','物流单号')+'</th>'+
      '<th>'+t('wac.col_ci','关联CI')+'</th>'+
      '<th>'+t('wac.col_country','国家')+'</th>'+
      '<th>'+t('wac.col_warehouse','仓库')+'</th>'+
      '<th>'+t('wac.col_arrival','到货日期')+'</th>'+
      '<th>'+t('wac.col_confirmed_at','确认时间')+'</th>'+
      '<th>'+t('wac.col_pl_qty','PL总数量')+'</th>'+
      '<th>'+t('wac.col_sku_count','SKU数')+'</th>'+
      '</tr></thead><tbody>'+
      data.map(r=>'<tr>'+
        '<td class="cell-id">'+esc(r.batch_no)+'</td>'+
        '<td class="cell-id">'+esc(r.related_ci_no||r.ci_no||'-')+'</td>'+
        '<td>'+countryLabel(r.target_country)+'</td>'+
        '<td>'+esc(r.target_warehouse||'-')+'</td>'+
        '<td class="cell-date">'+fmtDate(r.actual_arrival_date)+'</td>'+
        '<td class="cell-date">'+fmtDate(r.confirmed_at)+'</td>'+
        '<td class="text-right">'+(r.pl_total_qty||0)+'</td>'+
        '<td class="text-right">'+(r.sku_count||0)+'</td>'+
      '</tr>').join('')+
      '</tbody></table></div>';
  }catch(e){showFlash(e.message,'danger')}
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
      t('gen.L6368.1','• 总库存池 = 当前可用 + CI 已发货在途 + PI/PO 已确认未发货；未确认 PO 不计入<br>')+
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
    // CI明细（含折扣信息）
    if(summary.ci_items&&summary.ci_items.length){
      html+='<div class="table-section mb-16"><div class="table-section-title"><div class="table-section-title-left">'+t('cost.section_ci_items','📋 CI明细')+'</div></div><div class="table-container" style="box-shadow:none;border-radius:0;overflow-x:auto"><table class="data-table"><thead><tr><th>'+t('col.sku','SKU')+'</th><th>'+t('ci.col.ci_qty','数量')+'</th><th>'+t('field.original_unit_price','原单价')+'</th><th>'+t('field.discount','折扣')+'</th><th>'+t('field.net_unit_price','折后单价')+'</th><th>'+t('ci.col.amount','金额')+'</th><th>'+t('cost.col_ci_unit_cost','实际关税税率(%)')+'</th></tr></thead><tbody>'+summary.ci_items.map(function(i){var dsc=i.discount||0;var nup=i.net_unit_price||(i.unit_price*(1-dsc));return '<tr><td class="cell-id">'+esc(i.sku_code)+'</td><td class="text-right">'+(i.shipped_qty||0)+'</td><td class="text-right">'+fmtMoney(i.unit_price)+'</td><td class="text-right">'+(dsc>0?(dsc*100).toFixed(1)+'%':'—')+'</td><td class="text-right">'+fmtMoney(nup)+'</td><td class="text-right font-bold">'+fmtMoney(i.ci_amount)+'</td><td class="text-right">'+(i.actual_customs_rate===null||i.actual_customs_rate===''?'—':esc(i.actual_customs_rate))+'</td></tr>';}).join('')+'</tbody></table></div></div>';
    }
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
let _cockpitLoadSeq=0;
async function renderPayableCockpit(){
  const el=document.getElementById('content-inner');
  el.innerHTML='<div id="flash-container"></div><div style="padding:20px;color:var(--text-secondary,#888)">'+t("cockpit.loading","加载中…")+'</div>';
  const seq=++_cockpitLoadSeq;
  try{
    const data=await api('/api/finance/payable-cockpit');
    // 竞态防护：页面已切走则静默结束，不向已销毁/替换的 DOM 写入（避免跨页面 null 错误）
    if(seq!==_cockpitLoadSeq||currentPage!=='payable-cockpit')return;
    _cockpitData=data;
    renderCockpitView();
  }catch(e){
    // 竞态防护：页面已切走后不再写 DOM（避免 "Cannot set properties of null"）
    if(seq!==_cockpitLoadSeq||currentPage!=='payable-cockpit')return;
    el.innerHTML=t('html.renderPayableCockpit', '<div id="flash-container"></div><div class="flash flash-danger show">加载应付驾驶舱失败：{v1}</div>', {v1: esc(e.message)});
  }
}

function cockpitCard(label,valueHtml,tone,sub){
  // 苹果风格：圆角大留白 + 弱边框 + 数字突出 + 标签弱化 + 配色纪律（红=风险/橙=即将/绿=完成/蓝=未结清/灰=普通）
  const accent={danger:'#ff3b30',warn:'#ff9500',settled:'#34c759',outstanding:'#007aff',info:'#ff9500',total:'#8e8e93',normal:'#1d1d1f'}[tone]||'#8e8e93';
  const numColor={danger:'#ff3b30',warn:'#e8830c',settled:'#1a8a3c',outstanding:'#0a6cff',info:'#b06a00',total:'#1d1d1f',normal:'#1d1d1f'}[tone]||'#1d1d1f';
  return '<div style="flex:1;min-width:172px;padding:18px 20px;background:var(--bg-card,#fff);border:1px solid var(--border,#ececec);border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.05)">'
    +'<div style="font-size:13px;color:var(--text-secondary,#8e8e93);margin-bottom:10px;display:flex;align-items:center;gap:7px"><span style="width:8px;height:8px;border-radius:50%;background:'+accent+';display:inline-block"></span>'+esc(label)+'</div>'
    +'<div style="font-size:26px;font-weight:700;letter-spacing:-0.4px;color:'+numColor+'">'+valueHtml+'</div>'
    +(sub?'<div style="font-size:12px;color:var(--text-secondary,#8e8e93);margin-top:6px">'+sub+'</div>':'')
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
// 供应商风险状态（红=逾期 / 橙=近期压力 / 蓝=普通未结 / 绿=完成）
function cockpitSupplierRisk(s){
  if(s.overdue_amount>0) return {key:'overdue',label:t("cockpit.status_overdue","逾期"),color:'#ff3b30'};
  if(s.due_soon>0) return {key:'due_soon',label:t("cockpit.status_due_soon_short","近期压力"),color:'#ff9500'};
  if(s.outstanding<=0) return {key:'done',label:t("cockpit.status_done","完成"),color:'#34c759'};
  return {key:'normal',label:t("cockpit.status_normal_short","未结"),color:'#007aff'};
}
function supplierPill(st){
  return '<span class="sup-pill" style="background:'+st.color+'1a;color:'+st.color+';border-color:'+st.color+'33">'+esc(st.label)+'</span>';
}
// 供应商风险卡（Apple 风：左侧状态色条 + 突出 供应商/未结金额/最近应付日期/风险状态）
function cockpitSupplierCard(s){
  const cur=s.currency||'';
  const st=cockpitSupplierRisk(s);
  const amtColor=st.key==='overdue'?'#ff3b30':st.key==='due_soon'?'#ff9500':st.key==='done'?'#34c759':'#007aff';
  const dueHtml=s.earliest_due_date?esc(s.earliest_due_date):'<span style="color:#999">'+t("cockpit.status_no_due","无到期日")+'</span>';
  return '<div class="supplier-card" style="border-left-color:'+st.color+'" onclick="cockpitSupplierDrawer(\''+encodeURIComponent(s.supplier_name)+'\',\''+esc(cur)+'\')" title="'+t('cockpit.row_title','点击查看该供应商费用组成与付款明细')+'">'
    +'<div class="supplier-card-top"><div class="supplier-card-name">'+esc(s.supplier_name)+'</div>'+supplierPill(st)+'</div>'
    +'<div class="supplier-card-amount" style="color:'+amtColor+'">'+esc(fmtMoney(s.outstanding))+' <span class="supplier-card-cur">'+esc(cur)+'</span></div>'
    +'<div class="supplier-card-due">'+t("cockpit.lbl_nearest_due","最近应付")+'：'+dueHtml+'</div>'
    +'</div>';
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
let _cockpitSecondaryOpen=false;
function toggleCockpitSecondary(){
  const body=document.getElementById('cockpit-secondary-body');
  const tog=document.getElementById('cockpit-secondary-toggle');
  if(!body)return;
  _cockpitSecondaryOpen=body.style.display==='none';
  body.style.display=_cockpitSecondaryOpen?'':'none';
  if(tog)tog.textContent=_cockpitSecondaryOpen?'收起 ▲':'展开 ▼';
}
function cockpitOpenSecondary(){
  const body=document.getElementById('cockpit-secondary-body');
  const tog=document.getElementById('cockpit-secondary-toggle');
  _cockpitSecondaryOpen=true;
  if(body)body.style.display='';
  if(tog)tog.textContent='收起 ▲';
}
function cockpitShowAnomaly(){
  const only=document.getElementById('cockpit-only-outstanding');if(only)only.checked=true;
  const nd=document.getElementById('cockpit-only-nodue');if(nd)nd.checked=true;
  const kw=document.getElementById('cockpit-detail-kw');if(kw)kw.value='';
  const body=document.getElementById('cockpit-detail-body');if(body)body.style.display='';
  const tog=document.getElementById('cockpit-detail-toggle');if(tog)tog.textContent=t("app.1102", "\u6536\u8d77 \u25b2");
  cockpitOpenSecondary();
  renderCockpitDetails();
  // ④ UX：异常卡片联动同步提示（纯展示，不改动任何筛选/聚合逻辑）
  const ndRows=getCockpitView().details.filter(r=>r.credit_missing_due);
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
  // 筛选键统一用 country_display 归一化（CI 历史表存代码、PI/CI 表存中文），保证同一国家只一类展示
  if(f.country==='__NONE__') rows=rows.filter(r=>!(r.country_display||r.country||''));
  else if(f.country) rows=rows.filter(r=>(r.country_display||r.country||'')===f.country);
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
      if(r.credit_missing_due){ m.no_due_outstanding+=r.outstanding; }
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
    if(r.country_display||r.country) s.country_set[r.country_display||r.country||'']=1;
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
  d.details.forEach(r=>{ if(r.country_display||r.country){ const k=r.supplier_name+'||'+r.currency; (cm[k]=cm[k]||{}); cm[k][r.country_display||r.country||'']=1; } });
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
  // 筛选下拉选项（来自全量 details，不受筛选影响，始终完整）。统一用 country_display 归一化（CI 表存中文国名、历史 CI 表存代码），保证同国仅一项
  const countrySet={}; allDetails.forEach(r=>{ const _c=r.country_display||r.country||''; countrySet[_c]=1; });
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
  // ===== 核心指标：优先关注信号 + 应付结构（按币种绝不跨币种合并）=====
  const ovCount=curs.reduce((a,cur)=>a+((v.metrics[cur]&&v.metrics[cur].overdue_count)||0),0);
  const noDueCount=v.details.filter(r=>r.outstanding>0&&r.credit_missing_due).length;
  // 第一层：用户最关心的风险与时间信号（红=风险 / 橙=即将 / 蓝=未结清）
  html+='<div class="cockpit-section-title">'+t("cockpit.layer_core","核心指标")+'</div>';
  html+='<div class="cockpit-sub-title">'+t("cockpit.layer_focus","优先关注")+'</div>';
  html+='<div style="display:flex;flex-wrap:wrap;gap:12px">';
  html+=cockpitCard(t("pi.020", "已逾期"),cockpitCurBreakdown(v,'overdue_amount'),'danger',ovCount+t("cockpit.unit_pi"," 笔"));
  html+=cockpitCard(t("app.1108", "未来 7 天付款"),cockpitCurBreakdown(v,'due_7'),'warn','');
  html+=cockpitCard(t("app.1109", "未来 30 天付款"),cockpitCurBreakdown(v,'due_30'),'warn','');
  html+=cockpitCard(t("cockpit.cur_unsettled","当前未结清"),cockpitCurBreakdown(v,'outstanding'),'outstanding','');
  html+='</div>';

  // 数据异常提醒（可点击筛选，纯展示）
  if(noDueCount>0){
    html+='<div style="margin-top:12px;display:flex;align-items:center;gap:10px;padding:12px 16px;background:#fff8f0;border:1px solid #ffd591;border-radius:12px;font-size:13px;color:#b06a00;cursor:pointer" onclick="cockpitShowAnomaly()">'
      +'<span style="font-size:16px">⚠</span><div>'+t("cockpit.anomaly_banner","{v1} 笔 Credit 付款缺少应付日期，点击查看。",{v1:noDueCount})+'</div></div>';
  }

  // 应付结构（总应付 / 已结清 / 未结清，按币种）
  html+='<div class="cockpit-sub-title" style="margin-top:18px">'+t("cockpit.layer_structure","应付结构")+'</div>';
  html+='<div style="display:flex;flex-wrap:wrap;gap:12px">';
  curs.forEach(cur=>{ const m=v.metrics[cur]; if(!m)return;
    html+=cockpitCard(cur+t("cockpit.lbl_total_payable"," 总应付"),esc(fmtMoney(m.gross_payable)),'total','');
    html+=cockpitCard(cur+t("cockpit.lbl_settled"," 已结清"),esc(fmtMoney(m.settled)),'settled','');
    html+=cockpitCard(cur+t("cockpit.unsettled"," 未结清"),esc(fmtMoney(m.outstanding)),'outstanding',m.request_count+t("cockpit.unit_pi"," 笔"));
  });
  html+='</div>';

  // ===== 供应商风险：卡片网格（突出 供应商 / 未结金额 / 最近应付日期 / 风险状态）=====
  if((v.by_supplier||[]).length){
    html+='<div class="cockpit-section-title">🏢 '+t("cockpit.layer_supplier_risk","供应商风险")+' <span class="cockpit-section-sub">'+t("cockpit.click_row_hint","点击卡片查看费用组成与付款明细")+'</span></div>';
    html+='<div class="cockpit-supplier-grid">';
    (v.by_supplier||[]).forEach(s=>{ html+=cockpitSupplierCard(s); });
    html+='</div>';
  }

  // ===== 费用构成：货款 / 运输费 / 关税 / 检测费 / 其他（不拆定金尾款）=====
  const catAgg={};
  (v.by_category||[]).forEach(c=>{
    const alias=cockpitCatAlias(c.payment_category);
    if(!catAgg[alias])catAgg[alias]={};
    if(!catAgg[alias][c.currency])catAgg[alias][c.currency]={outstanding:0};
    catAgg[alias][c.currency].outstanding+=c.outstanding;
  });
  const catOrder=[''+t("cockpit.cat_goods","货款")+'',t("pi.022", "\u8fd0\u8f93\u8d39"),t("app.224", "\u5173\u7a0e"),t("pi.023", "\u68c0\u9a8c\u8d39"),''+t("ci.035","其他费用")+''];
  const catCurs=curs.slice().sort();
  html+='<div class="cockpit-section-title" style="margin-top:20px">'+t("cockpit.layer_cost_composition","费用构成")+'</div>';
  html+='<div style="display:flex;flex-wrap:wrap;gap:10px">';
  catOrder.forEach(alias=>{
    const curMap=catAgg[alias]||{};
    const curParts=catCurs.map(cur=>{
      const t=curMap[cur]||{outstanding:0};
      return '<div style="font-size:12px;line-height:1.5"><span style="color:var(--text-secondary,#999);font-size:11px;margin-right:4px">'+esc(cur)+'</span>'+esc(fmtMoney(t.outstanding))+'</div>';
    }).join('');
    html+='<div style="flex:1;min-width:150px;padding:12px 14px;background:var(--bg-card,#fff);border:1px solid var(--border,#e6e6e6);border-radius:10px">'
      +'<div style="font-size:12px;color:var(--text-secondary,#888);margin-bottom:6px">'+alias+'</div>'+curParts+'</div>';
  });
  html+='</div>';

  // ===== 折叠次级区域：费用类型汇总 + 应付明细（默认折叠，点击展开）=====
  const totalCnt=v.details.length;
  const outCnt=v.details.filter(r=>r.outstanding>0).length;
  html+='<div class="cockpit-secondary" style="margin-top:20px">'
    +'<div class="cockpit-secondary-head" onclick="toggleCockpitSecondary()">'
    +'<span>'+t("cockpit.secondary_title","展开查看：费用类型汇总 · 应付明细")+'</span>'
    +'<span id="cockpit-secondary-toggle" class="cockpit-secondary-toggle">'+( _cockpitSecondaryOpen?t("cockpit.collapse","收起 ▲"):t("app.1103","展开 ▼"))+'</span></div>'
    +'<div id="cockpit-secondary-body" style="display:'+(_cockpitSecondaryOpen?'':'none')+'">';
  // 费用类型汇总
  if((v.by_category||[]).length){
    html+='<div class="table-section" style="margin-top:14px"><div class="table-section-title"><div class="table-section-title-left">📊 '+t("cockpit.layer_by_category","按费用类型汇总")+'</div></div>';
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
  // 应付明细（内层仍可独立折叠）
  html+='<div class="table-section" style="margin-top:16px"><div class="table-section-title" style="cursor:pointer" onclick="toggleCockpitDetail()">'
    +'<div class="table-section-title-left">📋 '+t("cockpit.layer_details_prefix","应付明细（共")+' '+totalCnt+''+t("cockpit.layer_details_mid"," 条，未结清 ")+''+outCnt+''+t("cockpit.layer_details_suffix"," 条）")+'</div>'
    +'<div style="font-size:12px;color:var(--text-secondary,#999)" id="cockpit-detail-toggle">'+t("app.1103","展开查看 ▼")+'</div></div>'
    +'<div id="cockpit-detail-body" style="display:none">'
    +'<div class="filter-actions" style="margin:8px 0">'
    +'<label style="font-size:12px;margin-right:6px"><input type="checkbox" id="cockpit-only-outstanding" onchange="renderCockpitDetails()" checked> '+t("cockpit.only_outstanding","仅看未结清")+'</label>'
    +'<label style="font-size:12px;margin-right:6px"><input type="checkbox" id="cockpit-only-nodue" onchange="renderCockpitDetails()"> '+t("cockpit.only_no_due","仅看无到期日")+'</label>'
    +'<input type="text" id="cockpit-detail-kw" placeholder="'+t('cockpit.kw_placeholder','供应商/申请号/CI')+'" style="width:180px" oninput="renderCockpitDetails()">'
    +'</div><div id="cockpit-detail-table"></div></div></div>';
  html+='</div>';
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
  rows=mergeBalanceByCi(rows);
  let html='<table class="data-table"><thead><tr><th>'+t("cockpit.col_request_no","付款申请编号")+'</th><th>'+t("cockpit.col_supplier","供应商")+'</th><th>'+t("cockpit.col_source","来源")+'</th><th>'+t("cockpit.col_related_pi_ci","关联PI/CI")+'</th><th>'+t("cockpit.filter_cat","费用类型")+'</th><th>'+t("cockpit.col_payer","付款主体")+'</th><th>'+t("cockpit.col_currency","币种")+'</th><th style="text-align:right">'+t("cockpit.col_payable","应付")+'</th><th style="text-align:right">'+t("cockpit.col_written_off","已核销")+'</th><th style="text-align:right">'+t("cockpit.col_outstanding","未结清")+'</th><th>'+t("cockpit.col_due_date","到期日")+'</th><th style="text-align:right">'+t("cockpit.col_overdue_days","逾期天数")+'</th><th>'+t("cockpit.col_status","状态")+'</th></tr></thead><tbody>';
  if(!rows.length)html+='<tr><td colspan="13" style="text-align:center;color:#999;padding:20px">'+t("cockpit.no_match","无匹配记录")+'</td></tr>';
  rows.forEach(r=>{
    const rel=[r.related_pi_no,r.related_ci_no].filter(Boolean).join(' / ')||'—';
    const catTxt=(r.category_label||'')+(r.subcategory_label?' / '+r.subcategory_label:'');
    const srcTxt=esc(cockpitSourceNo(r));
    const rowClick=r.merged?('openMergedBalanceSummary(\''+esc(r.ids.join(','))+'\')'):('viewPayment(\''+esc(r.id)+'\')');
    html+='<tr style="cursor:pointer" onclick="'+rowClick+'">'
      +'<td style="color:#1d6fd3">'+esc(r.request_no)+(r.source_mode==='historical'?' <span style="font-size:10px;color:#999">'+t("cockpit.historical","(历史)")+'</span>':'')+'</td>'
      +'<td>'+esc(r.supplier_name)+'</td>'
      +'<td>'+srcTxt+'</td>'
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
// 明细来源：按 source_type 显示应付事实主体（PI→PI编号，CI/历史CI→CI编号）。
// payment_request 仅作为辅助状态展示（见状态栏 request_no 小字），不作为来源主体。
// 应付来源展示：仅展示费用事实依据单据（财务关注应付依据，不展示 CI↔PI 采购链路关联）。
//   - 定金(deposit) → PI 编号
//   - 尾款(balance) → CI 编号
//   - 其他费用 → 对应业务单据编号（优先 CI，其次 PI）
// 基于 subcategory_code（费用性质）判定，不依赖 source_type：尾款 bug 项 source_type 虽为 pi，subcategory 仍为 balance，应显示 CI 编号。
function cockpitSourceNo(r){
  const sub = r.subcategory || r.subcategory_code || '';
  if (sub === 'deposit') return r.related_pi_no || r.related_ci_no || '—';
  if (sub === 'balance') return r.related_ci_no || r.related_pi_no || '—';
  return r.related_ci_no || r.related_pi_no || '—';
}
// ============================================================
// 尾款(余额)按 CI 粒度合并展示（仅展示层，不改 payable_items / 付款流程）
// 业务事实：尾款付款粒度是 CI（多个 PI 合并出货 → 1 个 CI → 多笔尾款 payable_item）。
// 展示规则：balance 且 related_ci_no 非空 → 按 CI 号分组，金额(payable/paid/deduction/rounding/remaining)求和；
//           deposit 与其他费用保持原粒度。合并行携带底层所有 id（ids），付款申请仍走现有 multi-expense。
// 兼容两套字段名：应付列表(payable_amount/paid_amount/deduction_amount/rounding_amount/remaining_amount)
//               与 驾驶舱(gross_payable/settled/outstanding)。
// ============================================================
function _mPayable(r){ if(r.payable_amount!=null&&r.payable_amount!=='')return Number(r.payable_amount); if(r.gross_payable!=null)return Number(r.gross_payable); return Number(r.payable_amount_minor||0)/100; }
function _mPaid(r){ if(r.paid_amount!=null&&r.paid_amount!=='')return Number(r.paid_amount); if(r.settled!=null)return Number(r.settled); return 0; }
function _mDed(r){ if(r.deduction_amount!=null&&r.deduction_amount!=='')return Number(r.deduction_amount); return 0; }
function _mRound(r){ if(r.rounding_amount!=null&&r.rounding_amount!=='')return Number(r.rounding_amount); return 0; }
function _mRemain(r){ if(r.remaining_amount!=null&&r.remaining_amount!=='')return Number(r.remaining_amount); if(r.outstanding!=null)return Number(r.outstanding); return Math.max(0,_mPayable(r)-_mPaid(r)-_mDed(r)-_mRound(r)); }
function _mSub(r){ return r.subcategory || r.subcategory_code || ''; }
function _mCI(r){ return r.related_ci_no || ''; }
// 驾驶舱 status 优先级合并（paid > approved > pending_approval > rejected > reversed）
const _COCKPIT_STATUS_PRI={'paid':5,'approved':4,'pending_approval':3,'rejected':2,'reversed':1};
const _COCKPIT_STATUS_LABEL={'paid':'已付款','approved':'已通过','pending_approval':'审批中','rejected':'已驳回','reversed':'已冲销'};
function mergeBalanceByCi(rows){
  const groups={}; const out=[];
  rows.forEach(function(r){
    const sub=_mSub(r), ci=_mCI(r);
    if(sub==='balance' && ci){ (groups[ci]=groups[ci]||[]).push(r); }
    else out.push(r);
  });
  Object.keys(groups).forEach(function(ci){
    const ms=groups[ci];
    const base=Object.assign({}, ms[0]);
    let p=0,pa=0,d=0,ro=0,re=0,bestP=0,best='';
    ms.forEach(function(r){
      p+=_mPayable(r); pa+=_mPaid(r); d+=_mDed(r); ro+=_mRound(r); re+=_mRemain(r);
      const pri=_COCKPIT_STATUS_PRI[r.status]||0; if(pri>bestP){bestP=pri;best=r.status;}
    });
    base.payable_amount=p; base.gross_payable=p;
    base.paid_amount=pa; base.settled=pa;
    base.deduction_amount=d;
    base.rounding_amount=ro;
    base.remaining_amount=re; base.outstanding=re;
    base.related_ci_no=ci; base.related_pi_no='';
    base.subcategory='balance'; base.subcategory_code='balance'; base.fee_type='balance';
    base.merged=true; base.merged_count=ms.length;
    base.ids=ms.map(function(r){return r.id;});
    base.id=ci; // 展示行键（非真实 item id），选择器据此展开到底层 items
    base.payable_date = ms.map(function(r){return r.payable_date;}).filter(Boolean)[0] || '';
    if(base.has_due===undefined){ base.has_due = ms.some(function(r){return r.has_due;}); }
    if(best){ base.status=best; base.status_label=_COCKPIT_STATUS_LABEL[best]||base.status_label||''; }
    base.request_no=''; // 合并行不展示单条 PR，状态栏已聚合
    out.push(base);
  });
  return out;
}
function cockpitSupplierDrawer(supplierEnc,currency){
  const supplier=decodeURIComponent(supplierEnc);
  const d=_cockpitData;if(!d)return;
  const rows=mergeBalanceByCi(getCockpitView().details.filter(r=>r.supplier_name===supplier&&r.currency===currency));
  const brands=(d.supplier_brands&&d.supplier_brands[supplier])||'';
  // 头部国家列表：归一化拼接（CI/PI 存中文名，历史 CI 存代码），避免同一国家显示成两种风格
  const _cset={}; rows.forEach(r=>{ const _c=r.country_display||r.country; if(_c) _cset[_c]=1; });
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
    const src=cockpitSourceNo(r);
    const srcTxt=esc(src)+(r.source_mode==='historical'?' <span style="font-size:10px;color:#999">'+t("cockpit.historical","(历史)")+'</span>':'');
    const catTxt=(r.category_label||'')+(r.subcategory_label?' / '+r.subcategory_label:'')||'—';
    const prAux=r.request_no?('<div style="font-size:11px;color:#999;margin-top:2px">'+t("cockpit.col_payment_no","付款编号")+': '+esc(r.request_no)+'</div>'):'';
    const rowClick=r.merged?('openMergedBalanceSummary(\''+esc(r.ids.join(','))+'\')'):('closeCockpitDrawer();viewPayment(\''+esc(r.id)+'\')');
    return '<tr style="cursor:pointer" onclick="'+rowClick+'">'
      +'<td>'+srcTxt+'</td>'
      +'<td>'+esc((r.country_display||r.country||'—'))+'</td>'
      +'<td>'+esc(catTxt||'—')+'</td>'
      +'<td style="text-align:right">'+fmtMoney(r.gross_payable)+'</td>'
      +'<td style="text-align:right;color:#2e7d32">'+fmtMoney(r.settled)+'</td>'
      +'<td style="text-align:right;color:#1565c0;font-weight:600">'+fmtMoney(r.outstanding)+'</td>'
      +'<td>'+(r.payable_date||'<span style="color:#999">'+t("cockpit.status_no_due","无到期日")+'</span>')+'</td>'
      +'<td>'+cockpitStatusBadge(r)+prAux+'</td></tr>';
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
    +'<table class="data-table"><thead><tr><th>'+t("cockpit.col_source","应付来源")+'</th><th>'+t("cockpit.col_country","国家")+'</th><th>'+t("cockpit.filter_cat","费用类型")+'</th><th style="text-align:right">'+t("cockpit.col_payable","应付")+'</th><th style="text-align:right">'+t("cockpit.col_paid","已付")+'</th><th style="text-align:right">'+t("cockpit.col_unpaid","未付")+'</th><th>'+t("cockpit.col_due_date","到期日")+'</th><th>'+t("cockpit.col_status","状态")+'</th></tr></thead><tbody>'+detailHtml+'</tbody></table>'
    +'</div>';
  const dr=document.getElementById('cockpit-drawer');
  if(dr){dr.innerHTML=html;openCockpitDrawer();}
}

// ==================== PAY-CORE 应付费用列表（运营工作台，恢复已冻结用户路径）====================
// 设计原则：本页面只负责"选择业务对象"（多选/全选/已选 N 项），
// 业务校验（同收款方 / 同币种 / 同国家）全部复用付款申请创建的统一入口
// （multi-expense / batch-cancel），页面不维护任何一套业务规则，避免规则分散。
const PAY_FEE_TYPE_LABELS={deposit:'定金',balance:'尾款',freight:'运费',customs_clearance:'清关费',port_charges:'港口费',delivery:'派送费',warehouse:'仓储费',other_local:'其他本地费',duty:'关税',inspection:'商检费'};
const PAY_SOURCE_TYPE_LABELS={pi:'PI',ci:'CI',manual:'手动录入',historical_ci:'历史CI',logistics:'物流单'};
const PAY_LIFECYCLE_LABELS={active:'待处理',reserved:'已占用',partially_paid:'部分已付',released:'已释放',paid:'已付款',cancelled:'已取消'};
// 合并行「付款申请状态」聚合：取底层所有成员业务态的最高优先级（已付款 > 部分付款 > 已通过 > 审批中 > 草稿 > 未申请）
const _PR_STATUS_PRI={'已付款':6,'部分付款':5,'已通过':4,'审批中':3,'草稿':2,'未申请':1};
function mergedPayablePrStatus(r){
  if(!r.merged||!r.ids)return '未申请';
  let bestP=0,best='未申请';
  r.ids.forEach(function(id){
    const s=_payablePrStatusMap[id]||'未申请';
    const p=_PR_STATUS_PRI[s]||0; if(p>bestP){bestP=p;best=s;}
  });
  return best;
}
let _payableListSel=new Set();
let _payableListData=[];
let _payablePrStatusMap={};
// 合并行选择展开：mergedKey(CI号) → 底层 payable_item 数组。getSelectedPayableItems 据此展开。
let _mergedRowsMap={};

// 应付费用列表「付款申请状态」：将关联 PR 的原始枚举聚合为业务态（禁止透出内部枚举）
// 多 PR 关联同一 payable_item 时按资金状态最高优先级展示：已付款 > 部分付款 > 已通过 > 审批中 > 草稿
function derivePayablePrBusinessStatus(prs){
  if(!prs||!prs.length)return '未申请';
  const has={paid:false,partial:false,approved:false,pending:false,draft:false};
  prs.forEach(function(p){
    const as=p.approval_status, ps=p.payment_status;
    if(as==='draft'){has.draft=true;return;}
    if(as==='pending'||as==='pending_approval'){has.pending=true;return;}
    if(as==='approved'){
      if(ps==='paid'||ps==='deduction_settled')has.paid=true;
      else if(ps==='partial_paid'||ps==='partial_deduction'||ps==='partial_rounding'||ps==='partial_payment_partial_deduction')has.partial=true;
      else has.approved=true; // approved 但未付款（unpaid 等）
      return;
    }
    // rejected/cancelled 等不计入（端点默认已排除）
  });
  if(has.paid)return '已付款';
  if(has.partial)return '部分付款';
  if(has.approved)return '已通过';
  if(has.pending)return '审批中';
  if(has.draft)return '草稿';
  return '未申请';
}

// 批量获取整页 payable_item 的付款申请状态，建立 payable_item_id → 业务态 map（单请求，禁止 N+1）
async function loadPayablePrStatusMap(items){
  _payablePrStatusMap={};
  if(!items||!items.length)return;
  const ids=items.map(function(r){return r.id;}).filter(Boolean).join(',');
  if(!ids)return;
  try{
    const rels=await api('/api/payment-requests/by-payable-items?ids='+encodeURIComponent(ids));
    const prs=(rels&&rels.payment_requests)||[];
    const byItem={};
    prs.forEach(function(p){const iid=p.payable_item_id;if(!iid)return;(byItem[iid]=byItem[iid]||[]).push(p);});
    items.forEach(function(r){_payablePrStatusMap[r.id]=derivePayablePrBusinessStatus(byItem[r.id]||[]);});
  }catch(e){
    // 状态列降级：获取失败时标未申请，不影响主列表与生命周期
    items.forEach(function(r){_payablePrStatusMap[r.id]='未申请';});
  }
}

async function renderPayableList(){
  const el=document.getElementById('content-inner');
  el.innerHTML='<div id="flash-container"></div>'+
    '<div class="filter-bar"><div class="filter-form">'+
      '<div class="filter-group"><label>'+t('payable_list.filter_status','状态')+'</label><select id="payl-fs"><option value="">'+t('payable_list.all','全部')+'</option><option value="active">'+t('payable_list.status_active','待处理')+'</option><option value="reserved">'+t('payable_list.status_reserved','已占用')+'</option><option value="partially_paid">'+t('payable_list.status_partially_paid','部分已付')+'</option></select></div>'+
      '<div class="filter-group"><label>'+t('payable_list.filter_feetype','费用类型')+'</label><select id="payl-ft"><option value="">'+t('payable_list.all','全部')+'</option>'+Object.keys(PAY_FEE_TYPE_LABELS).map(function(k){return '<option value="'+k+'">'+PAY_FEE_TYPE_LABELS[k]+'</option>';}).join('')+'</select></div>'+
      '<div class="filter-group"><label>'+t('payable_list.filter_sourcetype','来源')+'</label><select id="payl-st"><option value="">'+t('payable_list.all','全部')+'</option>'+Object.keys(PAY_SOURCE_TYPE_LABELS).map(function(k){return '<option value="'+k+'">'+PAY_SOURCE_TYPE_LABELS[k]+'</option>';}).join('')+'</select></div>'+
      '<div class="filter-group"><label>'+t('payable_list.filter_keyword','关键词')+'</label><input type="text" id="payl-fk" placeholder="'+t('payable_list.filter_keyword_ph','费用号/来源单号/收款方')+'" onkeypress="if(event.key===\'Enter\')loadPayableList()"></div>'+
      '<div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadPayableList()">'+t('common.search','搜索')+'</button></div>'+
    '</div></div>'+
    '<div class="table-section"><div class="table-section-title"><div class="table-section-title-left">📋 '+t('nav.payable_list','应付费用列表')+'</div><div class="table-section-title-right" id="payl-selinfo"></div></div>'+
    '<div id="payl-toolbar" class="payl-toolbar"></div>'+
    '<div id="payl-hint" class="payl-hint"></div>'+
    '<div id="payl-table"></div></div>';
  _payableListSel=new Set();
  await loadPayableList();
}

async function loadPayableList(){
  const fs=document.getElementById('payl-fs');
  const ft=document.getElementById('payl-ft');
  const st=document.getElementById('payl-st');
  const fk=document.getElementById('payl-fk');
  const params=new URLSearchParams();
  if(fs&&fs.value)params.set('lifecycle_status',fs.value);
  if(ft&&ft.value)params.set('fee_type',ft.value);
  if(st&&st.value)params.set('source_type',st.value);
  if(fk&&fk.value)params.set('keyword',fk.value);
  const q=params.toString();
  let data;
  try{
    data=await api('/api/payable-items'+(q?'?'+q:''));
  }catch(e){
    const tb=document.getElementById('payl-table');if(tb)tb.innerHTML='<div class="flash flash-danger show">'+esc(e.message)+'</div>';
    return;
  }
  _payableListData=(data&&data.items)||[];
  await loadPayablePrStatusMap(_payableListData);
  renderPayableTable();
  updatePayableMenu();
}

function renderPayableTable(){
  _mergedRowsMap={};
  const rows=mergeBalanceByCi(_payableListData);
  // 记录合并行底层 items，供选择集展开
  rows.forEach(function(r){ if(r.merged)_mergedRowsMap[r.id]=r.ids.map(function(id){ return _payableListData.find(function(x){return x.id===id;})||{id:id}; }); });
  const tb=document.getElementById('payl-table');if(!tb)return;
  if(!rows.length){
    tb.innerHTML='<div class="flash flash-info show">'+t('payable_list.empty','暂无应付费用（默认显示待处理/已占用/部分已付）')+'</div>';
    return;
  }
  let html='<table class="data-table"><thead><tr>'+
    '<th style="width:36px"><input type="checkbox" id="payl-selall" onchange="togglePayableSelAll(this.checked)"></th>'+
    '<th>'+t('payable_list.col_feeno','费用号')+'</th>'+
    '<th>'+t('payable_list.col_source','来源')+'</th>'+
    '<th>'+t('payable_list.col_country','国家')+'</th>'+
    '<th>'+t('payable_list.col_supplier','供应商')+'</th>'+
    '<th>'+t('payable_list.col_feetype','费用类型')+'</th>'+
    '<th>'+t('payable_list.col_payee','收款方')+'</th>'+
    '<th class="muted-col">'+t('payable_list.col_currency','币种')+'</th>'+
    '<th style="text-align:right">'+t('payable_list.col_amount','应付金额')+'</th>'+
    '<th style="text-align:right">'+t('payable_list.col_paid','已付款')+'</th>'+
    '<th style="text-align:right" class="muted-col">'+t('payable_list.col_deduction','抵扣')+'</th>'+
    '<th style="text-align:right" class="muted-col">'+t('payable_list.col_rounding','抹零')+'</th>'+
    '<th style="text-align:right">'+t('payable_list.col_remaining','剩余未付')+'</th>'+
    '<th class="col-paydate">'+t('payable_list.col_paydate','应付日期')+' ⭐</th>'+
    '<th>'+t('payable_list.col_status','状态')+'</th>'+
    '<th>'+t('payable_list.col_pr_status','付款申请状态')+'</th>'+
    '<th class="muted-col">'+t('payable_list.col_created','创建时间')+'</th>'+
    '</tr></thead><tbody>';
  rows.forEach(function(r){
    const rKey=r.id;
    const checked=_payableListSel.has(rKey)?'checked':'';
    const payableNum=Number((r.payable_amount!=null?r.payable_amount:(r.payable_amount_minor/100))||0);
    const amt=payableNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
    // PAY-CORE 多次付款：拆分 已付款/抵扣/抹零/剩余未付（应付金额不变，剩余=应付-已付款-抵扣-抹零，动态推导）
    const paidNum=Number(r.paid_amount||0);
    const deductionNum=Number(r.deduction_amount||0);
    const roundingNum=Number(r.rounding_amount||0);
    const remainNum=r.remaining_amount!=null?Number(r.remaining_amount):Math.max(0,payableNum-paidNum-deductionNum-roundingNum);
    const paidTxt=paidNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
    const deductionTxt=deductionNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
    const roundingTxt=roundingNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
    const remainTxt=remainNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
    const srcTxt=esc(cockpitSourceNo(r));
    const rowClick=r.merged?('openMergedBalanceSummary(\''+esc(r.ids.join(','))+'\')'):('openPayableDetailModal(\''+esc(r.id)+'\')');
    html+='<tr class="pay-row" onclick="'+rowClick+'">'+
      '<td onclick="event.stopPropagation()"><input type="checkbox" class="payl-cb" data-id="'+esc(rKey)+'" onchange="togglePayableSel(\''+esc(rKey)+'\',this.checked)"></td>'+
      '<td>'+esc(r.fee_no||'')+'</td>'+
      '<td>'+srcTxt+'</td>'+
      '<td>'+esc(r.country_display||r.country||'—')+'</td>'+
      '<td>'+esc(r.supplier_name||r.payee_name_snapshot||'—')+'</td>'+
      '<td>'+esc(PAY_FEE_TYPE_LABELS[r.fee_type]||r.fee_type||'')+'</td>'+
      '<td>'+esc(r.payee_name_snapshot||'')+'</td>'+
      '<td class="muted-col">'+esc(r.currency||'')+'</td>'+
      '<td style="text-align:right">'+amt+'</td>'+
      '<td style="text-align:right"'+(paidNum>0?'':' class="muted"')+'>'+paidTxt+'</td>'+
      '<td style="text-align:right" class="muted-col'+(deductionNum>0?'':' muted')+'">'+deductionTxt+'</td>'+
      '<td style="text-align:right" class="muted-col'+(roundingNum>0?'':' muted')+'">'+roundingTxt+'</td>'+
      '<td style="text-align:right"><b>'+remainTxt+'</b></td>'+
      '<td class="col-paydate'+(r.payable_date?'':' muted')+'">'+ (r.payable_date?esc(fmtDate(r.payable_date)):'—') +'</td>'+
      '<td>'+esc(PAY_LIFECYCLE_LABELS[r.lifecycle_status]||r.lifecycle_status||'')+'</td>'+
      '<td>'+esc(r.merged?mergedPayablePrStatus(r):(_payablePrStatusMap[r.id]||'未申请'))+'</td>'+
      '<td class="muted-col muted">'+esc((r.created_at||'').slice(0,19))+'</td>'+
      '</tr>';
  });
  html+='</tbody></table>';
  tb.innerHTML=html;
  const all=document.getElementById('payl-selall');
  if(all){const cbs=document.querySelectorAll('.payl-cb');const sel=rows.filter(function(r){return _payableListSel.has(r.id);}).length;all.checked=(cbs.length>0&&sel===cbs.length);}
}

function togglePayableSel(id,checked){
  if(checked)_payableListSel.add(id);else _payableListSel.delete(id);
  updatePayableMenu();
}
function togglePayableSelAll(checked){
  document.querySelectorAll('.payl-cb').forEach(function(cb){
    const id=cb.getAttribute('data-id');
    if(checked)_payableListSel.add(id);else _payableListSel.delete(id);
    cb.checked=checked;
  });
  updatePayableMenu();
}
function getSelectedPayableItems(){
  const out=[];
  _payableListData.forEach(function(r){ if(_payableListSel.has(r.id))out.push(r); });
  // 展开合并行选择：CI 键 → 底层所有 payable_item
  Object.keys(_mergedRowsMap).forEach(function(k){
    if(_payableListSel.has(k)){ _mergedRowsMap[k].forEach(function(r){ out.push(r); }); }
  });
  return out;
}
function updatePayableMenu(){
  const sel=getSelectedPayableItems();
  const n=sel.length;
  const info=document.getElementById('payl-selinfo');
  const tb=document.getElementById('payl-toolbar');
  const hint=document.getElementById('payl-hint');
  if(info)info.textContent=t('payable_list.selected','已选 {v1} 项',{v1:n});
  if(!tb)return;
  tb.innerHTML='<button class="btn btn-secondary btn-sm" id="payl-view" onclick="viewPayableSelected()">'+t('payable_list.btn_view','查看')+'</button>'+
    '<button class="btn btn-primary btn-sm" id="payl-create" onclick="createPaymentFromSelected()">'+t('payable_list.btn_create','创建付款申请')+'</button>'+
    '<button class="btn btn-warning btn-sm" id="payl-withdraw" onclick="withdrawPaymentFromSelected()">'+t('payable_list.btn_withdraw','撤回付款申请')+'</button>';
  const statuses=new Set(sel.map(function(r){return r.lifecycle_status;}));
  // PAY-CORE 多次付款：active（未申请）与 partially_paid（已付部分、仍有剩余）都可发起付款申请
  const allActive=statuses.size>0&&sel.every(function(r){return r.lifecycle_status==='active'||r.lifecycle_status==='partially_paid';});
  const allReserved=statuses.size===1&&statuses.has('reserved');
  const mixed=!allActive&&!allReserved;
  const bv=document.getElementById('payl-view');
  const bc=document.getElementById('payl-create');
  const bw=document.getElementById('payl-withdraw');
  // 查看：>=1 即可（单选看明细，多选看摘要）；纯展示，不受生命周期限制
  if(n===0){bv.disabled=true;bv.title=t('payable_list.hint_select','请先选择费用');}else{bv.disabled=false;bv.title='';}
  // 创建付款申请：全部为待处理/部分已付（同收款方/同币种/同国家 的校验交由统一入口 multi-expense，页面不维护）
  if(allActive&&n>0){bc.disabled=false;bc.title='';}
  else{bc.disabled=true;bc.title=mixed?t('payable_list.hint_same_status','需选择相同状态（待处理/部分已付 或 已占用）的费用'):t('payable_list.hint_create_only_active','仅待处理或部分已付的费用可创建付款申请');}
  // 撤回付款申请：仅全部 reserved
  if(allReserved&&n>0){bw.disabled=false;bw.title='';}
  else{bw.disabled=true;bw.title=mixed?t('payable_list.hint_same_status','需选择相同状态（待处理/部分已付 或 已占用）的费用'):t('payable_list.hint_withdraw_only_reserved','仅已占用（reserved）费用可撤回付款申请');}
  // 提示行：明确原因
  if(hint){
    if(n===0)hint.textContent='';
    else if(mixed)hint.textContent='⚠ '+t('payable_list.hint_same_status','需选择相同状态（待处理/部分已付 或 已占用）的费用');
    else if(allActive)hint.textContent='ℹ '+t('payable_list.hint_withdraw_only_reserved','仅已占用（reserved）费用可撤回付款申请');
    else if(allReserved)hint.textContent='ℹ '+t('payable_list.hint_create_only_active','仅待处理（active）费用可创建付款申请');
    else hint.textContent='';
  }
}

// 单行点击查看详情（独立于多选状态，不影响付款申请多选）
async function openPayableDetailModal(id){
  let detail,rels;
  try{
    detail=await api('/api/payable-items/'+encodeURIComponent(id));
    rels=await api('/api/payment-requests/by-payable-items?ids='+encodeURIComponent(id));
  }catch(e){showFlash(t('payable_list.view_fail','加载失败：{v1}',{v1:e.message}),'danger');return;}
  const it=detail.item||{};
  const prs=(rels&&rels.payment_requests)||[];
  openModal(t('payable_list.detail_title','应付费用明细'),buildPayableDetailHtml(it,prs));
}
// 构建应付费用明细 HTML（单选行点击与「查看」按钮共用，避免重复逻辑）
function buildPayableDetailHtml(it,prs){
  const payableNum=Number((it.payable_amount!=null?it.payable_amount:it.payable_amount_minor/100)||0);
  const amt=payableNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const paidNum=Number(it.paid_amount||0);
  const deductionNum=Number(it.deduction_amount||0);
  const roundingNum=Number(it.rounding_amount||0);
  const remainNum=it.remaining_amount!=null?Number(it.remaining_amount):Math.max(0,payableNum-paidNum-deductionNum-roundingNum);
  const paidTxt=paidNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const deductionTxt=deductionNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const roundingTxt=roundingNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const remainTxt=remainNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  let html='<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px">';
  html+='<div><b>'+t('payable_list.col_feeno','费用号')+'</b></div><div>'+esc(it.fee_no||'')+'</div>';
  html+='<div><b>'+t('payable_list.col_source','来源')+'</b></div><div>'+esc(cockpitSourceNo(it))+'</div>';
  html+='<div><b>'+t('payable_list.col_feetype','费用类型')+'</b></div><div>'+esc(PAY_FEE_TYPE_LABELS[it.fee_type]||it.fee_type||'')+'</div>';
  html+='<div><b>'+t('payable_list.col_payee','收款方')+'</b></div><div>'+esc(it.payee_name_snapshot||'')+'</div>';
  html+='<div><b>'+t('payable_list.col_currency','币种')+'</b></div><div>'+esc(it.currency||'')+'</div>';
  html+='<div><b>'+t('payable_list.col_amount','应付金额')+'</b></div><div>'+amt+'</div>';
  html+='<div><b>'+t('payable_list.col_paid','已付款')+'</b></div><div>'+paidTxt+'</div>';
  html+='<div><b>'+t('payable_list.col_deduction','抵扣')+'</b></div><div>'+deductionTxt+'</div>';
  html+='<div><b>'+t('payable_list.col_rounding','抹零')+'</b></div><div>'+roundingTxt+'</div>';
  html+='<div><b>'+t('payable_list.col_remaining','剩余未付')+'</b></div><div><b>'+remainTxt+'</b></div>';
  html+='<div><b>'+t('payable_list.col_paydate','应付日期')+'</b></div><div>'+(it.payable_date?esc(fmtDate(it.payable_date)):'<span class="muted">—</span>')+'</div>';
  html+='<div><b>'+t('payable_list.col_status','状态')+'</b></div><div>'+esc(PAY_LIFECYCLE_LABELS[it.lifecycle_status]||it.lifecycle_status||'')+'</div>';
  html+='</div>';
  html+='<h4 style="margin:14px 0 6px">'+t('payable_list.related_pr','关联付款申请')+'</h4>';
  if(!prs.length)html+='<div class="muted">'+t('payable_list.no_pr','无关联付款申请')+'</div>';
  else{
    html+='<table class="data-table"><thead><tr><th>'+t('payable_list.pr_no','申请号')+'</th><th>'+t('payable_list.pr_paystatus','付款状态')+'</th><th>'+t('payable_list.pr_appstatus','审批状态')+'</th><th>'+t('payable_list.pr_action','操作')+'</th></tr></thead><tbody>';
    prs.forEach(function(p){
      var actionHtml='';
      if(p.approval_status==='draft'){
        actionHtml='<button class="btn btn-primary btn-sm" onclick="submitPaymentRequestApproval(\''+esc(p.id)+'\')">'+t('payable_list.btn_submit_approval','提交审批')+'</button>';
      }
      html+='<tr><td>'+esc(p.request_no||'')+'</td><td>'+esc(p.payment_status||'')+'</td><td>'+esc(p.approval_status||'')+'</td><td>'+actionHtml+'</td></tr>';
    });
    html+='</tbody></table>';
  }
  return html;
}
async function viewPayableSelected(){
  const sel=getSelectedPayableItems();
  if(!sel.length){showToast(t('payable_list.hint_select','请先选择费用'),'warning');return;}
  if(sel.length===1){
    await openPayableDetailModal(sel[0].id);
    return;
  }else{
    // 多选：仅显示所选摘要，不混淆不同付款申请
    let html='<div class="muted" style="margin-bottom:8px">'+t('payable_list.summary_multi','已选 {v1} 项（仅摘要，查看明细请单选）',{v1:sel.length})+'</div>';
    html+='<table class="data-table"><thead><tr><th>'+t('payable_list.col_feeno','费用号')+'</th><th>'+t('payable_list.col_feetype','费用类型')+'</th><th style="text-align:right">'+t('payable_list.col_amount','应付金额')+'</th><th style="text-align:right">'+t('payable_list.col_paid','已付款')+'</th><th style="text-align:right">'+t('payable_list.col_deduction','抵扣')+'</th><th style="text-align:right">'+t('payable_list.col_rounding','抹零')+'</th><th style="text-align:right">'+t('payable_list.col_remaining','剩余未付')+'</th><th>'+t('payable_list.col_status','状态')+'</th></tr></thead><tbody>';
    sel.forEach(function(r){
      const payableNum=Number((r.payable_amount!=null?r.payable_amount:r.payable_amount_minor/100)||0);
      const amt=payableNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
      const paidNum=Number(r.paid_amount||0);
      const deductionNum=Number(r.deduction_amount||0);
      const roundingNum=Number(r.rounding_amount||0);
      const remainNum=r.remaining_amount!=null?Number(r.remaining_amount):Math.max(0,payableNum-paidNum-deductionNum-roundingNum);
      const paidTxt=paidNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
      const deductionTxt=deductionNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
      const roundingTxt=roundingNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
      const remainTxt=remainNum.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
      html+='<tr><td>'+esc(r.fee_no||'')+'</td><td>'+esc(PAY_FEE_TYPE_LABELS[r.fee_type]||r.fee_type||'')+'</td><td style="text-align:right">'+amt+'</td><td style="text-align:right">'+paidTxt+'</td><td style="text-align:right">'+deductionTxt+'</td><td style="text-align:right">'+roundingTxt+'</td><td style="text-align:right">'+remainTxt+'</td><td>'+esc(PAY_LIFECYCLE_LABELS[r.lifecycle_status]||r.lifecycle_status||'')+'</td></tr>';
    });
    html+='</tbody></table>';
    openModal(t('payable_list.summary_title','所选费用摘要'),html);
  }
}

// 合并尾款明细：展示该 CI 下各 PI 尾款的逐笔事实（付款事实粒度为 CI，不展开多个 PI 为独立付款行）
async function openMergedBalanceSummary(idsCsv){
  const ids=String(idsCsv).split(',').filter(Boolean);
  if(ids.length===1){ await openPayableDetailModal(ids[0]); return; }
  let rows=[];
  try{
    const rels=await api('/api/payment-requests/by-payable-items?ids='+encodeURIComponent(ids.join(',')));
    const prs=(rels&&rels.payment_requests)||[];
    const byItem={};
    prs.forEach(function(p){const i=p.payable_item_id; if(!i)return; (byItem[i]=byItem[i]||[]).push(p);});
    for(const id of ids){
      const d=await api('/api/payable-items/'+encodeURIComponent(id));
      rows.push({it:d.item||{}, prs:byItem[id]||[]});
    }
  }catch(e){ showFlash(t('payable_list.view_fail','加载失败：{v1}',{v1:e.message}),'danger'); return; }
  const f2=function(n){return Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});};
  let sp=0,spa=0,sd=0,sr=0,sre=0;
  let html='<div class="muted" style="margin-bottom:8px">'+t('payable_list.merged_balance_title','该 CI 尾款由 {v1} 笔 PI 尾款合并（付款事实粒度为 CI）',{v1:rows.length})+'</div>';
  html+='<table class="data-table"><thead><tr><th>'+t('payable_list.col_source','来源')+'</th><th>'+t('payable_list.col_feetype','费用类型')+'</th><th style="text-align:right">'+t('payable_list.col_amount','应付金额')+'</th><th style="text-align:right">'+t('payable_list.col_paid','已付款')+'</th><th style="text-align:right">'+t('payable_list.col_deduction','抵扣')+'</th><th style="text-align:right">'+t('payable_list.col_rounding','抹零')+'</th><th style="text-align:right">'+t('payable_list.col_remaining','剩余未付')+'</th><th>'+t('payable_list.col_status','状态')+'</th></tr></thead><tbody>';
  rows.forEach(function(o){
    const it=o.it;
    const payableNum=Number((it.payable_amount!=null?it.payable_amount:it.payable_amount_minor/100)||0);
    const paidNum=Number(it.paid_amount||0), dedNum=Number(it.deduction_amount||0), roundNum=Number(it.rounding_amount||0);
    const remNum=it.remaining_amount!=null?Number(it.remaining_amount):Math.max(0,payableNum-paidNum-dedNum-roundNum);
    sp+=payableNum;spa+=paidNum;sd+=dedNum;sr+=roundNum;sre+=remNum;
    html+='<tr><td>'+esc(cockpitSourceNo(it))+'</td><td>'+esc(PAY_FEE_TYPE_LABELS[it.fee_type]||it.fee_type||'')+'</td><td style="text-align:right">'+f2(payableNum)+'</td><td style="text-align:right">'+f2(paidNum)+'</td><td style="text-align:right">'+f2(dedNum)+'</td><td style="text-align:right">'+f2(roundNum)+'</td><td style="text-align:right"><b>'+f2(remNum)+'</b></td><td>'+esc(PAY_LIFECYCLE_LABELS[it.lifecycle_status]||it.lifecycle_status||'')+'</td></tr>';
  });
  html+='<tr style="font-weight:700;background:#f5f7fa"><td>'+t('common.total','合计')+'</td><td></td><td style="text-align:right">'+f2(sp)+'</td><td style="text-align:right">'+f2(spa)+'</td><td style="text-align:right">'+f2(sd)+'</td><td style="text-align:right">'+f2(sr)+'</td><td style="text-align:right">'+f2(sre)+'</td><td></td></tr>';
  html+='</tbody></table>';
  openModal(t('payable_list.merged_balance_title','合并尾款明细'),html);
}

async function createPaymentFromSelected(){
  const sel=getSelectedPayableItems();
  if(!sel.length||!sel.every(function(r){return r.lifecycle_status==='active'||r.lifecycle_status==='partially_paid';})){showToast(t('payable_list.hint_create_only_active','仅待处理或部分已付的费用可创建付款申请'),'warning');return;}
  const ids=sel.map(function(r){return r.id;});
  // 注意：同收款方/同币种/同国家 的校验交由统一入口 multi-expense 在后端完成；页面不重复实现，避免规则分散。
  try{
    const d=await api('/api/payment-requests/multi-expense','POST',{payable_item_ids:ids,remark:''});
    showFlash(t('payable_list.create_success','已创建付款申请：{v1}（{v2} 项），已自动提交审批',{v1:d.request_no,v2:d.item_count}),'success');
    _payableListSel=new Set();
    await loadPayableList();
  }catch(e){
    showFlash(t('payable_list.create_fail','创建失败：{v1}',{v1:e.message}),'danger');
  }
}

async function withdrawPaymentFromSelected(){
  const sel=getSelectedPayableItems();
  if(!sel.length||!sel.every(function(r){return r.lifecycle_status==='reserved';})){showToast(t('payable_list.hint_withdraw_only_reserved','仅已占用（reserved）费用可撤回付款申请'),'warning');return;}
  const ids=sel.map(function(r){return r.id;});
  if(!window.confirm(t('payable_list.withdraw_confirm','确认撤回所选 {v1} 项付款申请？此操作将释放已占用费用。',{v1:ids.length}))){return;}
  try{
    const d=await api('/api/payment-requests/batch-cancel','POST',{payable_item_ids:ids});
    const cnt=(d&&d.cancelled&&d.cancelled.length)||0;
    const skp=(d&&d.skipped&&d.skipped.length)||0;
    let msg=t('payable_list.withdraw_success','已撤回 {v1} 项付款申请',{v1:cnt});
    if(skp)msg+='；'+t('payable_list.withdraw_skipped','跳过 {v1} 项已撤回',{v1:skp});
    showFlash(msg,'success');
    _payableListSel=new Set();
    await loadPayableList();
  }catch(e){
    showFlash(t('payable_list.withdraw_fail','撤回失败：{v1}',{v1:e.message}),'danger');
  }
}

// PAY-CORE draft→pending：应付费用列表查看明细中提交付款申请审批
async function submitPaymentRequestApproval(prId){
  if(!prId){showToast(t('payable_list.submit_no_id','缺少付款申请ID'),'warning');return;}
  try{
    await api('/api/payment-requests/'+encodeURIComponent(prId)+'/submit-approval','POST',{submitter_name:(currentUser&&currentUser.name)||''});
    closeModal();
    showToast(t('payable_list.submit_success','已提交审批'),'success');
    await loadPayableList();
  }catch(e){
    showToast(t('payable_list.submit_fail','提交审批失败：{v1}',{v1:e.message}),'danger');
  }
}

async function renderPayment(){
  document.getElementById('content-inner').innerHTML=t('html.renderPayment', `<div id="flash-container"></div><div class="filter-bar"><div class="filter-form"><div class="filter-group"><label>状态</label><select id="pay-fs"><option value="">全部</option><option value="approved">已审批</option><option value="paid">已付款</option><option value="partial_paid">部分付款</option><option value="cancelled">已取消</option></select></div><div class="filter-group"><label>类别</label><select id="pay-fc"><option value="">全部</option><option value="goods">货款</option><option value="warehouse_arrival">到仓费用</option><option value="customs_duty">关税</option><option value="inspection_fee">商检费用</option></select></div><div class="filter-group"><label>关键词</label><input type="text" id="pay-fk" placeholder="申请号/供应商/来源单号" onkeypress="if(event.key==='Enter')loadPay()"></div><div class="filter-actions"><button class="btn btn-primary btn-sm" onclick="loadPay()">搜索</button>{v1}</div></div></div><div class="table-section"><div class="table-section-title"><div class="table-section-title-left">💳 付款申请</div></div><div id="pay-table"></div></div>`, {v1: hasPermission('payment_import')?t('gen.L6956.1','<button class="btn btn-secondary btn-sm" onclick="importPayResult()">📥 导入付款结果</button>'):''});
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
    // 注意：审批按钮映射仅看 approval_status，避免已 approved 但 payment_status='pending_approval' 的单据被误判为“待审批”、仍显示 approve 按钮导致重复调用 approve 返回 409
    const isPendingApproval=(p.approval_status==='pending');
    // 两级财务审批流程：第二级「付款确认」——一级已审批(approved)且尚未进入付款动作。
    // PAY-CORE 多次付款：partial_paid / partial_payment_partial_deduction 等已发生付款动作的状态不再显示确认按钮，
    // 避免同一 PR 重复确认；剩余尾款由用户从应付费用列表另行创建付款申请。
    // 仍显示：approved（仅靠审批待付款）/ partial_deduction（已抵扣但未付款）。
    // 已审批通过、待付款确认：approved（仅靠审批待付款）/ partial_deduction（已抵扣未付款）/ pending_approval（审批已通过、尚未确认付款）
    const isPendingPaymentConfirmation=(mode==='finance'&&p.approval_status==='approved'&&['approved','partial_deduction','pending_approval'].includes(p.payment_status));
    const canApprove=hasPermission('payment_approve');
    // PAY-CORE Phase 2：判断是否为最终审批节点（current_level >= max_level）
    const appr=p.approval||{};
    const isFinalLevel=appr&&appr.current_level>=appr.max_level&&appr.max_level>0;
    // PAY-CORE Phase 2：最终节点需要填写实际付款信息
    const _now=new Date(),_today=new Date(_now.getTime()-_now.getTimezoneOffset()*60000).toISOString().slice(0,10);
    // 固定缓存本单基准未结，供抵扣/抹零联动与实时未结计算使用（不改动后端逻辑，仅为前端展示）
    window._finalPayCtx={outstanding:Number(p.outstanding||p.unpaid_amount||0),prId:id,paymentCategory:p.payment_category||'',dateInputId:'pay-final-date',amountInputId:'pay-final-amount'};
    const paymentFormHtml=(mode==='finance'&&canApprove&&((isPendingApproval&&isFinalLevel)||isPendingPaymentConfirmation))
      ? '<div class="detail-section"><h3>'+t("payment.final_payment_info","最终付款信息")+'</h3>'
        +'<div class="form-grid">'
        +'<div class="form-group"><label>'+t("payment.actual_paid_amount","实际付款金额")+' <span class="required">*</span></label>'
        +'<input type="number" min="0" step="0.01" id="pay-final-amount" value="'+Number(p.outstanding||p.unpaid_amount||0).toFixed(2)+'" oninput="onPayAmountChanged()"></div>'
        + (p.payment_mode==='multi' && p.items && p.items.length ? buildMultiAllocationTable(p.items, p.currency) : '')
        +'<div class="form-group"><label>'+t("payment.actual_paid_date","实际付款日期")+' <span class="required">*</span></label>'
        +'<input type="date" id="pay-final-date" value="'+_today+'" onchange="onPayDateChanged()"></div>'
        +'<div id="pay-fx-display" style="grid-column:1/-1;margin-top:-4px;padding:8px 12px;background:#f5f5f5;border-radius:6px;display:none"></div>'
        +'<div class="form-group form-group-full"><label>'+t("payment.bank_ref_no","银行流水号")+'</label>'
        +'<input type="text" id="pay-final-bank-ref"></div>'
        +'<div class="form-group form-group-full"><label>'+t("payment.payment_account","付款账户")+'</label>'
        +'<input type="text" id="pay-final-account" placeholder="'+t("payment.payment_account_placeholder","选填，用于结算记录付款账户")+'"></div>'
        +'<div class="form-group"><label>'+t("payment.deduction_amount","抵扣金额")+'</label>'
        +(isPendingPaymentConfirmation&&Number(p.deduction_amount||0)>0
            ? '<input type="number" class="is-disabled" disabled value="'+Number(p.deduction_amount||0).toFixed(2)+'">'
            : '<input type="number" min="0" step="0.01" id="pay-final-ded-amt" placeholder="'+t("payment.deduction_placeholder","选填，无抵扣请留空")+'" oninput="recalcFinalPay()">')+'</div>'
        +'<div class="form-group"><label>'+t("payment.deduction_source_type","抵扣来源类型")+'</label>'
        +(isPendingPaymentConfirmation&&Number(p.deduction_amount||0)>0
            ? '<input type="text" class="is-disabled" disabled value="'+esc(p.deduction_source_type||'—')+'">'
            : '<select id="pay-final-ded-type" onchange="recalcFinalPay()"><option value="">'+t("payment.ded_type_select","选择")+'</option><option value="other_payment">'+t("payment.ded_other_payment","其他付款多付")+'</option><option value="price_diff">'+t("payment.ded_price_diff","价格差异")+'</option><option value="other">'+t("payment.ded_other","其他")+'</option></select>')+'</div>'
        +'<div class="form-group form-group-full"><label>'+t("payment.deduction_reason","抵扣原因/备注")+'</label>'
        +(isPendingPaymentConfirmation&&Number(p.deduction_amount||0)>0
            ? '<input type="text" class="is-disabled" disabled value="'+esc(p.deduction_source_desc||'—')+'">'
            : '<input type="text" id="pay-final-ded-desc" placeholder="'+t("payment.deduction_reason_placeholder","有抵扣时建议填写")+'" oninput="recalcFinalPay()">')+'</div>'
        +'<div class="form-group"><label>'+t("payment.rounding_amount","抹零金额")+'</label>'
        +'<input type="number" min="0" step="0.01" id="pay-final-rounding" placeholder="'+t("payment.rounding_placeholder","选填，不抹零请留空")+'" oninput="recalcFinalPay()"></div>'
        +'<div class="form-group form-group-full"><label>'+t("payment.rounding_reason","抹零原因")+'</label>'
        +'<input type="text" id="pay-final-rounding-reason" placeholder="'+t("payment.rounding_reason_placeholder","建议填写")+'"></div>'
        +'<div class="form-group form-group-full" style="background:#f6f8fb;padding:8px 10px;border-radius:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
          +'<span style="font-weight:600">'+t("payment.estimated_outstanding","预估未结金额")+':</span>'
          +'<span id="pay-final-est-outstanding" style="font-weight:700;color:#c0392b">'+Number(p.outstanding||p.unpaid_amount||0).toFixed(2)+'</span>'
          +'<span style="color:#999;font-size:12px">'+t("payment.est_formula","= 当前未结 − 实际付款 − 抵扣 − 抹零")+'</span>'
        +'</div>'
        +'</div>'
        +'<div style="font-size:12px;color:#999;margin-top:8px">'+t("payment.final_payment_hint","通过最终审批后将自动执行付款结算。整数实际付款 + 尾差抹零 = 应付金额时视为全额结清（允许抹零）；仅当实际付款 + 抹零 仍小于应付金额时才计为部分付款。")+'</div>'
        +'</div>'
      : '';
    const opinionHtml=(mode==='finance'&&isPendingApproval&&canApprove)
      ? '<div class="detail-section"><h3>'+t("payment.opinion_title","审批意见")+'</h3><textarea id="pay-appr-remark" rows="3" placeholder="'+t("payment.approve_opinion_placeholder","填写审批意见（驳回时必填）；在框内粘贴图片可自动上传为附件")+'" style="width:100%;box-sizing:border-box" onpaste="onPayRemarkPaste(event)"></textarea></div>'
      : '';
    const body='<div class="detail-card" style="box-shadow:none;padding:0"><div class="detail-section"><h3>'+t("payment.summary","付款申请摘要")+'</h3>'+summary+'</div>'+relHtml+settlementSection+attSection+paymentFormHtml+opinionHtml+'</div>';
    // footer：finance 模式待审 → 通过/驳回；否则仅关闭
    let footer='<button class="btn btn-secondary" onclick="closeModal()">'+t("common.close","关闭")+'</button>';
    if(mode==='finance'&&canApprove&&isPendingPaymentConfirmation){
      // 第二级付款确认：一级已审批通过，此处仅执行付款结算确认（走 confirm-paid 接口）
      footer='<button class="btn btn-secondary" onclick="closeModal()">'+t("common.close","关闭")+'</button>'
        +'<button class="btn btn-primary" id="pay-final-confirm-btn" onclick="financeConfirmPay(\''+id+'\')">💰 '+t("payment.confirm_pay_btn","确认付款")+'</button>';
    } else if(mode==='finance'&&isPendingApproval&&canApprove){
      const approveLabel=isFinalLevel?t("payment.final_approve_btn","通过并付款"):t("action.approve","通过");
      footer='<button class="btn btn-secondary" onclick="closeModal()">'+t("common.close","关闭")+'</button>'
        +'<button class="btn btn-danger" onclick="financeApprove(\''+id+'\',\'reject\')">⛔ '+t("action.reject","驳回")+'</button>'
        +'<button class="btn btn-primary" onclick="financeApprove(\''+id+'\',\'approve\')">✅ '+approveLabel+'</button>';
    }
    openModal(t('modal.title.viewPayment', '付款申请详情 - {v1}', {v1: esc(p.request_no)}), body, footer);
    // 渲染后校正"预估未结金额"初始值（实际付款默认=当前未结，故初始未结应为0）
    if(paymentFormHtml){ try{ recalcFinalPay(); }catch(_){} }
    if(paymentFormHtml&&p.payment_category!=='goods'){ setTimeout(function(){ onPayDateChanged(); }, 0); }
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
// 最终付款信息区：抵扣/抹零为独立结算事实，实时预览未结（前端展示用，不改后端逻辑）
// 抵扣不自动改写“实际付款金额”（银行流水金额 = 系统付款金额）
// 预估未结 = 当前未结基准 − 实际付款 − 抵扣 − 抹零（与后端 paymentSettlementFacts 口径一致）
function recalcFinalPay(){
  try{
    const base=(window._finalPayCtx&&Number.isFinite(window._finalPayCtx.outstanding))?window._finalPayCtx.outstanding:0;
    const amtEl=document.getElementById('pay-final-amount')||document.getElementById('pay-settle-amount');
    const ded=parseFloat(document.getElementById('pay-final-ded-amt')?document.getElementById('pay-final-ded-amt').value:0)||0;
    const rnd=parseFloat(document.getElementById('pay-final-rounding')?document.getElementById('pay-final-rounding').value:0)||0;
    // 实际付款金额由用户独立填写，抵扣仅作独立结算事实，互不改写
    const paid=parseFloat(amtEl?amtEl.value:0)||0;
    const out=Math.max(0,base-paid-ded-rnd);
    const outEl=document.getElementById('pay-final-est-outstanding');
    if(outEl) outEl.textContent=out.toFixed(2);
    // 合并付款人工分摊：实时算已分配合计与差额（剩余未分配 / 超出），差额不为 0 则禁用确认按钮
    const allocInputs=document.querySelectorAll('.pay-alloc-input');
    if(allocInputs&&allocInputs.length){
      let sumMinor=0;
      allocInputs.forEach(function(inp){ sumMinor+=Math.round((parseFloat(inp.value)||0)*100); });
      const paidMinor=Math.round(paid*100);
      const diffMinor=paidMinor-sumMinor; // >0 剩余未分配；<0 超出实际付款金额
      const totalEl=document.getElementById('pay-alloc-total');
      if(totalEl) totalEl.textContent=(sumMinor/100).toFixed(2);
      const diffEl=document.getElementById('pay-alloc-diff');
      if(diffEl){
        if(diffMinor>0){ diffEl.innerHTML=t('payment.alloc_unassigned','剩余未分配')+': <b>'+(diffMinor/100).toFixed(2)+'</b>'; diffEl.style.color='#b26a00'; }
        else if(diffMinor<0){ diffEl.innerHTML=t('payment.alloc_over','超出实际付款金额')+': <b>'+(-diffMinor/100).toFixed(2)+'</b>'; diffEl.style.color='#c0392b'; }
        else { diffEl.innerHTML=t('payment.alloc_ok','✓ 分摊合计与实际付款金额一致'); diffEl.style.color='#1a7f37'; }
      }
      ['pay-final-confirm-btn','pay-settle-save'].forEach(function(id){ const b=document.getElementById(id); if(b) b.disabled=(diffMinor!==0); });
    }
  }catch(_){}
}

// 合并付款确认付款：渲染各费用单人工分摊表（费用单 / 剩余未付 / 本次分摊 / 已分配 / 差额提示）
// items: GET /api/payment-requests/:id 返回的 items[]（含 id(pri.id), payable_item_id, fee_no, requested_amount_minor）
// 初始化不填默认分摊金额：分摊在用户输入「实际付款金额」后由 autoDistributePayAllocations 按剩余未付比例生成
function buildMultiAllocationTable(items, currency){
  if(!items||!items.length) return '';
  const rows=items.map(function(it){
    const remainMinor=Number(it.requested_amount_minor||0);
    return '<tr>'
      +'<td>'+esc(it.fee_no||it.payable_item_id)+'</td>'
      +'<td class="text-right">'+fmtMoney(remainMinor/100, currency||'')+'</td>'
      +'<td><input type="number" min="0" step="0.01" class="pay-alloc-input" data-pri="'+esc(it.id)+'" data-remain-minor="'+remainMinor+'" placeholder="'+t('payment.alloc_placeholder','填写实际付款金额后自动分摊')+'" oninput="recalcFinalPay()"></td>'
      +'</tr>';
  }).join('');
  return '<div class="detail-section" style="grid-column:1/-1"><h3>'+t('payment.alloc_title','合并付款明细（人工分摊）')+'</h3>'
    +'<div class="table-container" style="box-shadow:none;border:1px solid #eee"><table class="data-table"><thead><tr>'
    +'<th>'+t('payment.alloc_fee','费用单')+'</th>'
    +'<th class="text-right">'+t('payment.alloc_remain','剩余未付')+'</th>'
    +'<th>'+t('payment.alloc_this','本次分摊')+'</th>'
    +'</tr></thead><tbody>'+rows+'</tbody></table></div>'
    +'<div style="font-size:12px;margin-top:6px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">'
    +'<span>'+t('payment.alloc_total','已分配')+': <b id="pay-alloc-total">0.00</b></span>'
    +'<span id="pay-alloc-diff"></span>'
    +'</div></div>';
}
// 实际付款金额变化时：按各费用单「剩余未付」比例自动生成默认分摊，尾差归最大项（与后端自动分摊口径一致）
// 生成后用户可手工修改任意一项；金额清空或为 0 时清空全部分摊
function autoDistributePayAllocations(){
  const list=Array.prototype.slice.call(document.querySelectorAll('.pay-alloc-input'));
  if(!list.length) return;
  const amtEl=document.getElementById('pay-final-amount')||document.getElementById('pay-settle-amount');
  const paidMinor=Math.round((parseFloat(amtEl?amtEl.value:'')||0)*100);
  if(!(paidMinor>0)){ list.forEach(function(inp){ inp.value=''; }); return; }
  const remainOf=function(inp){ return Number(inp.getAttribute('data-remain-minor'))||0; };
  const totalRemain=list.reduce(function(s,inp){ return s+remainOf(inp); },0);
  if(!(totalRemain>0)) return;
  const sorted=list.slice().sort(function(a,b){ return remainOf(b)-remainOf(a); });
  let othersSum=0;
  for(let i=1;i<sorted.length;i++){
    const m=Math.floor(paidMinor*remainOf(sorted[i])/totalRemain);
    sorted[i].value=(m/100).toFixed(2);
    othersSum+=m;
  }
  const topMinor=paidMinor-othersSum;
  sorted[0].value=((topMinor>0?topMinor:0)/100).toFixed(2);
}
// 实际付款金额输入框专用：先重算默认分摊，再刷新合计/差额与未结预览
function onPayAmountChanged(){
  try{ autoDistributePayAllocations(); }catch(_){}
  recalcFinalPay();
  try{ renderPayFxDisplay(); }catch(_){}
}
// 合并付款人工分摊：收集 .pay-alloc-input 并校验（financeApprove / financeConfirmPay 共用同一套逻辑）
// 返回 {ok:false} 表示校验不通过（已 toast 提示）；{ok:true,allocations:null} 表示无分摊表（走后端原自动分摊）
function collectPayAllocations(amount){
  const inputs=document.querySelectorAll('.pay-alloc-input');
  if(!inputs||!inputs.length) return {ok:true, allocations:null};
  const allocations=[];
  let sum=0;
  for(let i=0;i<inputs.length;i++){
    const inp=inputs[i];
    const raw=(inp.value||'').trim();
    if(raw===''){showToast(t('payment.alloc_required','请填写每个费用单的本次分摊金额'),'warning');inp.focus();return {ok:false}}
    const v=parseFloat(raw);
    if(!Number.isFinite(v)||v<0){showToast(t('payment.alloc_negative','分摊金额不能为负数'),'warning');inp.focus();return {ok:false}}
    allocations.push({payment_request_item_id:inp.getAttribute('data-pri'), amount:v});
    sum+=v;
  }
  if(!allocations.length){showToast(t('payment.alloc_empty','合并付款必须填写分摊明细'),'warning');return {ok:false}}
  if(Math.abs(sum-(Number(amount)||0))>0.001){showToast(t('payment.alloc_mismatch','分摊合计必须等于实际付款金额'),'warning');return {ok:false}}
  return {ok:true, allocations:allocations};
}
// 财务类审批：通过 / 驳回（复用后端 POST /api/payment-requests/:id/approve，审批意见存 approval_remark）
async function financeApprove(id, action){
  const ta=document.getElementById('pay-appr-remark');
  const remark=ta?ta.value.trim():'';
  if(action==='reject'&&!remark){showToast(t('gen.L7183.1','驳回时审批意见必填'),'warning');if(ta)ta.focus();return}
  // PAY-CORE Phase 2：最终审批节点收集付款信息
  const body={action:action,remark:remark};
  const amtEl=document.getElementById('pay-final-amount');
  if(action==='approve'&&amtEl){
    const amount=parseFloat(amtEl.value);
    const paidDate=document.getElementById('pay-final-date')?document.getElementById('pay-final-date').value:'';
    const bankRef=document.getElementById('pay-final-bank-ref')?document.getElementById('pay-final-bank-ref').value.trim():'';
    const roundingVal=document.getElementById('pay-final-rounding')?document.getElementById('pay-final-rounding').value:'';
    const roundingReason=document.getElementById('pay-final-rounding-reason')?document.getElementById('pay-final-rounding-reason').value.trim():'';
    const roundingAmount=parseFloat(roundingVal);
    // 抵扣字段（确认付款页固定显示，无抵扣时留空）
    const dedAmtEl=document.getElementById('pay-final-ded-amt');
    const dedAmt=dedAmtEl?parseFloat(dedAmtEl.value)||0:0;
    const dedType=document.getElementById('pay-final-ded-type')?document.getElementById('pay-final-ded-type').value.trim():'';
    const dedDesc=document.getElementById('pay-final-ded-desc')?document.getElementById('pay-final-ded-desc').value.trim():'';
    if(!(Number.isFinite(amount)&&amount>0)){showToast(t('payment.err_amount_required','实际付款金额必须大于0'),'warning');amtEl.focus();return}
    if(!paidDate){showToast(t('payment.err_date_required','请选择实际付款日期'),'warning');return}
    // 有抵扣时来源类型与原因必填（后端 applyDeductionSettlement 要求）
    if(dedAmt>0&&!dedType){showToast(t('payment.ded_type_required','有抵扣时必须选择抵扣来源类型'),'warning');return}
    if(dedAmt>0&&!dedDesc){showToast(t('payment.ded_reason_required','有抵扣时必须填写抵扣原因/备注'),'warning');return}
    // 总额校验：实际付款 + 抵扣 + 抹零 不得超过当前未结基准
    const base=(window._finalPayCtx&&Number.isFinite(window._finalPayCtx.outstanding))?window._finalPayCtx.outstanding:0;
    const rnd=Number.isFinite(roundingAmount)&&roundingAmount>0?roundingAmount:0;
    if(amount+dedAmt+rnd>base+0.001){showToast(t('payment.err_exceed_outstanding','实际付款+抵扣+抹零 不能超过当前未结金额'),'warning');return}
    body.actual_paid_amount=amount;
    body.actual_paid_date=paidDate;
    body.bank_ref_no=bankRef;
    const accountEl=document.getElementById('pay-final-account');
    body.payment_account=accountEl?accountEl.value.trim():'';
    if(rnd>0){
      body.rounding_amount=rnd;
      if(roundingReason)body.rounding_reason=roundingReason;
    }
    body.idempotency_key='appr:'+id+':'+(window.crypto&&window.crypto.randomUUID?window.crypto.randomUUID():(Date.now()+'-'+Math.random().toString(36).slice(2)));
    // 合并付款人工分摊（付款确认场景）：收集 + 校验（与 financeConfirmPay 共用）
    const allocRes=collectPayAllocations(amount);
    if(!allocRes.ok)return;
    if(allocRes.allocations)body.allocations=allocRes.allocations;
    if(!window.confirm(t('payment.final_approve_confirm','确认通过最终审批并执行付款？此操作将自动结算付款。'))){return}
    // 有抵扣时先写抵扣（复用现有 /deduction 接口与 PAY-CORE deduction 能力），再执行审批结算。
    // 顺序保证：deduction 写入后 applyPaymentSettlement 计算 outstanding 时自动扣减抵扣，满足 应付−实际付款−抵扣−抹零=未结
    if(dedAmt>0){
      try{
        await api('/api/payment-requests/'+id+'/deduction','POST',{has_deduction:1,deduction_amount:dedAmt,deduction_source_type:dedType,deduction_source_desc:dedDesc});
      }catch(e){ showToast(e.message,'danger'); return; }
    }
  }
  try{
    const r=await api('/api/payment-requests/'+id+'/approve','POST',body);
    if(r.settlement){
      showToast(t('payment.final_approve_success','最终审批通过，付款已完成'),'success');
    }else{
      showToast(action==='approve'?t('gen.L7186.1','已通过'):t('gen.L7186.2','已驳回'),'success');
    }
    closeModal();
    if(typeof loadFinanceApprovalList==='function'&&document.getElementById('approval-list'))loadFinanceApprovalList();
    if(document.getElementById('pay-table'))loadPay();
  }catch(e){showToast(e.message,'danger')}
}
// 两级审批流程：第二级「付款确认」——对已通过一级审批(approval_status='approved')但尚未付清的单据，
// 在财务类审批详情中执行付款结算确认（复用后端 confirm-paid 路径）。不回退审批、不新建申请。
async function financeConfirmPay(id){
  const amtEl=document.getElementById('pay-final-amount');
  if(!amtEl){showToast(t('payment.err_form_missing','付款确认表单未加载'),'danger');return;}
  const amount=parseFloat(amtEl.value);
  const paidDate=document.getElementById('pay-final-date')?document.getElementById('pay-final-date').value:'';
  const bankRef=document.getElementById('pay-final-bank-ref')?document.getElementById('pay-final-bank-ref').value.trim():'';
  const accountEl=document.getElementById('pay-final-account');
  const paymentAccount=accountEl?accountEl.value.trim():'';
  const roundingVal=document.getElementById('pay-final-rounding')?document.getElementById('pay-final-rounding').value:'';
  const roundingReason=document.getElementById('pay-final-rounding-reason')?document.getElementById('pay-final-rounding-reason').value.trim():'';
  const roundingAmount=parseFloat(roundingVal);
  if(!(Number.isFinite(amount)&&amount>0)){showToast(t('payment.err_amount_required','实际付款金额必须大于0'),'warning');amtEl.focus();return}
  if(!paidDate){showToast(t('payment.err_date_required','请选择实际付款日期'),'warning');return}
  // 抵扣字段：确认模式下若已生效则被 disabled（无 id），此时跳过；否则按普通抵扣处理
  const dedAmtEl=document.getElementById('pay-final-ded-amt');
  let dedAmt=0,dedType='',dedDesc='';
  if(dedAmtEl && !dedAmtEl.disabled){
    dedAmt=parseFloat(dedAmtEl.value)||0;
    dedType=document.getElementById('pay-final-ded-type')?document.getElementById('pay-final-ded-type').value.trim():'';
    dedDesc=document.getElementById('pay-final-ded-desc')?document.getElementById('pay-final-ded-desc').value.trim():'';
    if(dedAmt>0&&!dedType){showToast(t('payment.ded_type_required','有抵扣时必须选择抵扣来源类型'),'warning');return}
    if(dedAmt>0&&!dedDesc){showToast(t('payment.ded_reason_required','有抵扣时必须填写抵扣原因/备注'),'warning');return}
  }
  const base=(window._finalPayCtx&&Number.isFinite(window._finalPayCtx.outstanding))?window._finalPayCtx.outstanding:0;
  const rnd=Number.isFinite(roundingAmount)&&roundingAmount>0?roundingAmount:0;
  if(amount+dedAmt+rnd>base+0.001){showToast(t('payment.err_exceed_outstanding','实际付款+抵扣+抹零 不能超过当前未结金额'),'warning');return}
  const body={action:'confirm-paid',paid_amount:amount,paid_date:paidDate,bank_ref_no:bankRef,payment_account:paymentAccount,idempotency_key:'conf:'+id+':'+(window.crypto&&window.crypto.randomUUID?window.crypto.randomUUID():(Date.now()+'-'+Math.random().toString(36).slice(2)))};
  if(rnd>0){body.rounding_amount=rnd;if(roundingReason)body.rounding_reason=roundingReason;}
  // 合并付款人工分摊（付款确认场景）：收集 + 校验（与 financeApprove 共用）。校验失败提前返回，不写抵扣、不提交结算
  const allocRes=collectPayAllocations(amount);
  if(!allocRes.ok)return;
  if(allocRes.allocations)body.allocations=allocRes.allocations;
  // 确认模式下抵扣已生效不在此重复提交；仅当存在可编辑抵扣字段时才提交
  if(dedAmt>0){
    try{
      await api('/api/payment-requests/'+id+'/deduction','POST',{has_deduction:1,deduction_amount:dedAmt,deduction_source_type:dedType,deduction_source_desc:dedDesc});
    }catch(e){showToast(e.message,'danger');return;}
  }
  const btn=document.getElementById('pay-final-confirm-btn');
  if(btn){btn.disabled=true;btn.textContent=t("app.476","保存中…");}
  try{
    await api('/api/payment-requests/'+id+'/approve','POST',body);
    showToast(t('payment.confirm_pay_success','付款确认成功，结算已完成'),'success');
    closeModal();
    if(typeof loadFinanceApprovalList==='function'&&document.getElementById('approval-list'))loadFinanceApprovalList();
    if(document.getElementById('pay-table'))loadPay();
  }catch(e){showToast(e.message,'danger');if(btn){btn.disabled=false;btn.textContent=t("payment.confirm_pay_btn","确认付款")}}
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
      return '<tr'+(hasPermission('payment_view')?(' class="clickable-detail-row" onclick="rowClickView(event,\'viewPayment\',\''+p.id+'\')"'):'')+'><td class="cell-id">'+esc(p.request_no)+'</td><td>'+esc(catLabel)+'</td><td>'+esc(subLabel)+'</td><td class="cell-id">'+esc(p.source_no)+'</td><td class="cell-id">'+esc(p.related_ci_no||'')+'</td><td>'+esc(p.supplier_name)+'</td><td class="text-right font-bold">'+fmtMoney(p.payable_amount)+'</td><td class="text-right '+(p.deduction_amount>0?'text-warning':'')+'">'+(p.deduction_amount>0?fmtMoney(p.deduction_amount):'-')+'</td><td class="text-right font-bold">'+fmtMoney(actualDisplay)+'</td><td class="text-right">'+fmtMoney(p.paid_amount)+'</td><td class="text-right '+(p.unpaid_amount>0?'text-danger':'')+'">'+fmtMoney(p.unpaid_amount)+'</td><td>'+esc(p.currency)+'</td><td><span class="status-badge '+stClass+'">'+esc(stLabel)+'</span></td><td class="cell-actions">'+(hasPermission('payment_view')?'<button class="action-btn" onclick="viewPayment(\''+p.id+'\')" title="'+t('title.viewDetail','查看详情')+'">👁️</button>':'')+(needsExpenseCountry&&hasPermission('payment_approve')?'<button class="action-btn" onclick="openPaymentExpenseCountry(\''+p.id+'\')" title="'+t('term.fin.supplement_expense_country','补录费用归属国家')+'">'+t("payment.fill_country","补国家")+'</button>':'')+(canRound&&hasPermission('payment_approve')?'<button class="action-btn" onclick="openPaymentRounding(\''+p.id+'\')" title="'+t("payment.manual_rounding","手动抹零")+'">'+t("payment.type_rounding","抹零")+'</button>':'')+(canDeduct&&hasPermission('payment_create')?'<button class="action-btn" onclick="editDeduction(\''+p.id+'\')" title="'+t('title.editDeduction','编辑抵扣')+'">✂️</button>':'')+'</td></tr>';
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
      (function(){ var _b=t('modal.body.confirmPaid', '<div class="form-card" style="box-shadow:none;padding:0"><input type="hidden" id="pay-settle-idempotency" value="{v1}"><div class="detail-grid mb-16"><div class="detail-item"><span class="detail-label">当前未付</span><span class="detail-value">{v2}</span></div><div class="detail-item"><span class="detail-label">币种</span><span class="detail-value">{v3}</span></div></div><div class="form-grid"><div class="form-group"><label>本次实际付款金额 <span class="required">*</span></label><input type="number" min="0" step="0.01" id="pay-settle-amount" value="{v4}" oninput="onPayAmountChanged()"></div><div class="form-group"><label>实际付款日期 <span class="required">*</span></label><input type="date" id="pay-settle-date" value="{v5}" onchange="onPayDateChanged()"></div><div class="form-group form-group-full"><label>付款凭证号</label><input type="text" id="pay-settle-voucher"></div><div class="form-group"><label>抹零金额</label><input type="number" min="0" step="0.01" id="pay-settle-rounding" placeholder="选填，不抹零请留空" oninput="recalcFinalPay()"></div><div class="form-group form-group-full"><label>抹零原因</label><input type="text" id="pay-settle-rounding-reason" placeholder="建议填写，未填将记录为人工抹零"></div></div><div style="font-size:12px;color:#999">非货款费用将严格按实际付款日期读取系统 realtime 汇率并保存快照；缺少汇率时不会确认付款。</div><div id="pay-fx-display" style="margin-top:12px;padding:8px 12px;background:#f5f5f5;border-radius:6px;display:none"></div></div>', {v1: idempotencyKey, v2: fmtMoney(p.outstanding,p.currency), v3: esc(p.currency||''), v4: Number(p.outstanding||0).toFixed(2), v5: today}); if(p.payment_mode==='multi'&&p.items&&p.items.length){ _b+=buildMultiAllocationTable(p.items, p.currency); } return _b; })(),
      t('modal.footer.confirmPaid', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="pay-settle-save" onclick="saveConfirmedPayment('{v1}')">确认付款</button>`, {v1: id}));
    window._finalPayCtx={outstanding:Number(p.outstanding||0),prId:id,paymentCategory:p.payment_category||'',dateInputId:'pay-settle-date',amountInputId:'pay-settle-amount'};
    if(p.payment_category!=='goods'){setTimeout(function(){onPayDateChanged();},0);}
  }catch(e){showToast(e.message,'danger')}
}
function renderPayFxDisplay(){
  var ctx=window._finalPayCtx||{};
  var fxDiv=document.getElementById('pay-fx-display');
  if(!fxDiv||!ctx.fxRate){return;}
  var amtInput=document.getElementById(ctx.amountInputId||'pay-settle-amount');
  var currentAmt=amtInput?parseFloat(amtInput.value):0;
  if(!Number.isFinite(currentAmt)||currentAmt<=0){currentAmt=ctx.outstanding||0;}
  var localAmt=Math.round(currentAmt*ctx.fxRate*100)/100;
  fxDiv.style.display='block';
  fxDiv.style.background='#e8f5e9';fxDiv.style.color='#2e7d32';
  fxDiv.innerHTML='<div style="font-size:13px;font-weight:600">付款日汇率</div>'
    +'<div style="margin-top:4px">1 '+esc(ctx.fxOriginalCurrency||'')+' = '+Number(ctx.fxRate).toLocaleString(undefined,{maximumFractionDigits:4})+' '+esc(ctx.fxLocalCurrency||'')+'</div>'
    +'<div style="margin-top:2px;font-size:12px;color:#888">本币金额：'+fmtMoney(currentAmt,ctx.fxOriginalCurrency)+' → '+fmtMoney(localAmt,ctx.fxLocalCurrency)+'</div>'
    +'<div style="margin-top:2px;font-size:11px;color:#aaa">来源：'+esc(ctx.fxSource||'')+(ctx.fxDirection?' / '+esc(ctx.fxDirection):'')+'</div>';
}
async function onPayDateChanged(){
  var ctx=window._finalPayCtx||{};
  if(ctx.paymentCategory==='goods'){return;}
  var dateInput=document.getElementById(ctx.dateInputId||'pay-settle-date');
  var fxDiv=document.getElementById('pay-fx-display');
  if(!dateInput||!fxDiv){return;}
  var paidDate=dateInput.value;
  if(!paidDate){fxDiv.style.display='none';fxDiv.innerHTML='';ctx.fxRate=null;return;}
  fxDiv.style.display='block';
  fxDiv.style.background='#f5f5f5';fxDiv.style.color='#666';
  fxDiv.innerHTML='正在获取付款日汇率…';
  ctx.fxRate=null;
  var requestedDate=paidDate;
  try{
    var r=await api('/api/payment-requests/'+ctx.prId+'/payment-fx/resolve','POST',{rate_date:paidDate});
    if(r.skip){fxDiv.style.display='none';return;}
    var currentDate=dateInput.value;
    if(currentDate!==requestedDate){return;}
    ctx.fxRate=r.rate;
    ctx.fxRateDate=r.rate_date;
    ctx.fxLocalCurrency=r.local_currency;
    ctx.fxOriginalCurrency=r.original_currency;
    ctx.fxSource=r.source;
    ctx.fxDirection=r.direction;
    renderPayFxDisplay();
  }catch(e){
    var currentDate2=dateInput.value;
    if(currentDate2!==requestedDate){return;}
    fxDiv.style.background='#fef0f0';fxDiv.style.color='#c62828';
    fxDiv.innerHTML='<div style="font-size:13px;font-weight:600">汇率缺失</div>'
      +'<div style="margin-top:4px;font-size:12px">'+esc(e.message||'获取汇率失败')+'</div>'
      +'<div style="margin-top:2px;font-size:11px;color:#aaa">请在汇率管理中添加该日期的汇率后重试</div>';
  }
}
async function saveConfirmedPayment(id){
  const btn=document.getElementById('pay-settle-save');if(!btn||btn.disabled)return;
  const amount=parseFloat(document.getElementById('pay-settle-amount').value),paidDate=document.getElementById('pay-settle-date').value,voucher=document.getElementById('pay-settle-voucher').value,idempotencyKey=document.getElementById('pay-settle-idempotency').value;
  const roundingVal=document.getElementById('pay-settle-rounding')?document.getElementById('pay-settle-rounding').value:'';
  const roundingReason=document.getElementById('pay-settle-rounding-reason')?document.getElementById('pay-settle-rounding-reason').value.trim():'';
  const roundingAmount=parseFloat(roundingVal);
  const hasRounding=Number.isFinite(roundingAmount)&&roundingAmount>0;
  const hasPaid=Number.isFinite(amount)&&amount>0;
  if(!hasPaid&&!hasRounding){showToast(t('gen.L7224.1','本次实际付款金额必须大于0'),'warning');return}
  if(!paidDate){showToast(t('gen.L7224.2','请选择实际付款日期'),'warning');return}
  // 合并付款人工分摊：收集 + 前端校验（与 financeApprove/financeConfirmPay 共用）
  const allocRes=collectPayAllocations(hasPaid?amount:0);
  if(!allocRes.ok)return;
  btn.disabled=true;btn.textContent=t("app.476", "\u4fdd\u5b58\u4e2d\u2026");
  const body={action:'confirm-paid',paid_date:paidDate,payment_voucher:voucher,idempotency_key:idempotencyKey};
  if(hasPaid){body.paid_amount=amount;}
  if(hasRounding){body.rounding_amount=roundingAmount;if(roundingReason){body.rounding_reason=roundingReason;}}
  if(allocRes.allocations){body.allocations=allocRes.allocations;}
  try{await api('/api/payment-requests/'+id+'/approve','POST',body);showToast(t('gen.L7226.1','付款结果已保存'),'success');closeModal();loadPay()}catch(e){showToast(e.message,'danger');if(document.getElementById('pay-settle-save')){btn.disabled=false;btn.textContent=t('gen.L7226.2','确认付款')}}
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
// 版本角标：读取 /api/version（公开），生产环境不显示「本地」；同步 document.title
async function initVersionBadge(){
  try{
    const v=await api('/api/version','GET');
    const badge=document.getElementById('version-badge');
    if(badge){
      const short=v.commit?(' '+String(v.commit).slice(0,7)):'';
      const env=(v.environment==='production')?'':(' 本地');
      const deploy=(v.environment==='production'&&v.deployTime)?(' '+String(v.deployTime).slice(0,10)):'';
      badge.textContent='v'+v.version+short+deploy+env;
      let tip='version '+v.version+' · commit '+(v.commit||'-')+' · '+(v.environment||'-');
      if(v.deployTime)tip+=' · deploy '+v.deployTime;
      badge.title=tip;
    }
    document.title=t('page.doc_title','进销存管理系统')+' v'+v.version;
  }catch(e){ /* 后端不可达时保留 index.html 静态占位，不报错 */ }
}
window.addEventListener('DOMContentLoaded',()=>{
  // 多语言：启动时回填静态文本 + 同步语言切换器
  if (typeof applyI18n==='function') applyI18n();
  var _sw=document.getElementById('lang-switcher'); if(_sw&&typeof getLang==='function') _sw.value=getLang();
  // 直开 HTML 文件（file://）时后端不可达，先给出醒目指引
  if(isFileProtocol()){
    showFatalNotice(t('err.file_protocol_startup','⚠️ 检测到您直接打开了 HTML 文件（file://）。进销存系统需要后端服务，请：<br>① 在终端运行 <b>node server.js</b><br>② 浏览器访问 <b>http://localhost:3001</b><br>不要直接双击 index.html。'));
    return;
  }
  // 版本角标（公开接口，登录前后均可刷新）
  initVersionBadge();
  // 凭证基于 HttpOnly Cookie（Session），启动即从 /api/me 探活；无有效会话则显示登录页
  bootFromSession();
  // 探测飞书 OAuth 配置（异步，不阻塞登录页加载）
  if (typeof probeFeishuStatus==='function') probeFeishuStatus();
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
