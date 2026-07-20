// i18n.js — 进销存系统多语言基础设施（P0 + P1 Shell/高频 UI）
// 纯前端，无后端依赖。普通全局脚本，须在 app.js 之前引入（index.html）。
// 设计原则：渐进式接入、业务 key、中文默认 fallback、不重构任何页面逻辑。
(function () {
  'use strict';

  var I18N = {
    lang: 'zh',
    // zh 故意留空：t(key,'中文') 的中文即回退源，无需维护 zh 字典
    dict: { zh: {}, en: {}, id: {} }
  };

  // 初始化语言（localStorage 持久化，默认中文）
  try {
    var saved = localStorage.getItem('lang');
    if (saved === 'zh' || saved === 'en' || saved === 'id') I18N.lang = saved;
  } catch (e) {}

  function syncHtmlLang() {
    try { document.documentElement.lang = (I18N.lang === 'zh') ? 'zh-CN' : I18N.lang; } catch (e) {}
  }
  syncHtmlLang();

  // 业务 key + 中文 fallback；vars 可选 {name:'x'}
  function t(key, fallbackZh, vars) {
    var d = I18N.dict[I18N.lang] || {};
    var s = (d[key] != null) ? d[key] : (fallbackZh != null ? fallbackZh : key);
    if (vars && typeof s === 'string') {
      s = s.replace(/\{(\w+)\}/g, function (m, k) { return (vars[k] != null) ? vars[k] : m; });
    }
    return s;
  }

  function getLang() { return I18N.lang; }

  function setLang(lang) {
    if (lang !== 'zh' && lang !== 'en' && lang !== 'id') return;
    I18N.lang = lang;
    try { localStorage.setItem('lang', lang); } catch (e) {}
    syncHtmlLang();
    // 仅重渲染 Shell（顶栏/侧边栏），并重填静态 [data-i18n] 节点。
    // 关键：不重渲染当前业务页 body（不调用 showPage），以保未提交表单不被清空。
    if (typeof renderTopNav === 'function') { try { renderTopNav(); } catch (e) {} }
    if (typeof renderSidebar === 'function') { try { renderSidebar(); } catch (e) {} }
    applyI18n();
  }

  // 回填所有 [data-i18n] 节点；首次运行把原文存为回退。
  // 默认改 textContent；若元素带 data-i18n-attr="placeholder" 则改该属性（如 input 占位符）。
  var _origText = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var _origAttr = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function applyI18n() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-i18n');
      var attr = el.getAttribute('data-i18n-attr');
      if (attr) {
        var zha = _origAttr && _origAttr.has(el) ? _origAttr.get(el) : (el.getAttribute(attr) || '');
        if (_origAttr) _origAttr.set(el, zha);
        el.setAttribute(attr, t(key, zha));
      } else {
        var zh = _origText && _origText.has(el) ? _origText.get(el) : el.textContent;
        if (_origText) _origText.set(el, zh);
        el.textContent = t(key, zh);
      }
    }
  }

  // 暴露全局
  window.I18N = I18N;
  window.t = t;
  window.getLang = getLang;
  window.setLang = setLang;
  window.applyI18n = applyI18n;

  // ===================== 翻译字典 =====================
  // 注意：以下 en/id 为 ChatGPT 起草译文，待用户（印尼团队）审校。
  // key 使用点号业务 key（与 app.js 中 t('common.save',...) 等一致）；zh 不在此维护（运行时用 t(key,'中文') 字面量回退）。

  // ---- 登录 / 待授权页 ----
  I18N.dict.en['auth.login_title'] = '📦 Inventory Management System';
  I18N.dict.id['auth.login_title'] = '📦 Sistem Manajemen Inventaris';
  I18N.dict.en['auth.login_subtitle'] = 'Procurement · Inventory · Cost · Payment Management';
  I18N.dict.id['auth.login_subtitle'] = 'Manajemen Pengadaan · Inventaris · Biaya · Pembayaran';
  I18N.dict.en['auth.feishu_login'] = '🔵 Sign in with Feishu';
  I18N.dict.id['auth.feishu_login'] = '🔵 Masuk dengan Feishu';
  I18N.dict.en['auth.recommend_title'] = 'We recommend signing in with Feishu';
  I18N.dict.id['auth.recommend_title'] = 'Disarankan masuk dengan akun Feishu';
  I18N.dict.en['auth.recommend_hint'] = 'Admin will activate your account and assign permissions on first sign-in.';
  I18N.dict.id['auth.recommend_hint'] = 'Admin akan mengaktifkan akun Anda dan menetapkan izin saat masuk pertama.';
  I18N.dict.en['auth.breakglass_link'] = 'Local emergency sign-in';
  I18N.dict.id['auth.breakglass_link'] = 'Masuk darurat lokal';
  I18N.dict.en['auth.bg_username_ph'] = 'Emergency account';
  I18N.dict.id['auth.bg_username_ph'] = 'Akun darurat';
  I18N.dict.en['auth.bg_password_ph'] = 'Emergency password';
  I18N.dict.id['auth.bg_password_ph'] = 'Kata sandi darurat';
  I18N.dict.en['auth.breakglass_login_btn'] = 'Emergency sign-in';
  I18N.dict.id['auth.breakglass_login_btn'] = 'Masuk darurat';
  I18N.dict.en['pending.title'] = '⏳ Account pending approval';
  I18N.dict.id['pending.title'] = '⏳ Akun menunggu persetujuan';
  I18N.dict.en['pending.recognized'] = 'Your Feishu account has been recognized';
  I18N.dict.id['pending.recognized'] = 'Akun Feishu Anda telah dikenali';
  I18N.dict.en['pending.wait_title'] = 'Account recognized, awaiting admin approval';
  I18N.dict.id['pending.wait_title'] = 'Akun dikenali, menunggu persetujuan admin';
  I18N.dict.en['pending.wait_hint'] = 'Once an admin activates your account and assigns a role, you can access the system. Contact your system admin if you have questions.';
  I18N.dict.id['pending.wait_hint'] = 'Setelah admin mengaktifkan akun dan menetapkan peran, Anda dapat mengakses sistem. Hubungi admin sistem jika ada pertanyaan.';
  I18N.dict.en['pending.logout_btn'] = 'Sign out';
  I18N.dict.id['pending.logout_btn'] = 'Keluar';

  // ---- 通用按钮 / 状态 / 空态（P1 已接线的共享框架串） ----
  I18N.dict.en['common.logout'] = 'Sign out';
  I18N.dict.id['common.logout'] = 'Keluar';
  I18N.dict.en['common.save'] = 'Save';
  I18N.dict.id['common.save'] = 'Simpan';
  I18N.dict.en['common.cancel'] = 'Cancel';
  I18N.dict.id['common.cancel'] = 'Batal';
  I18N.dict.en['common.add'] = '➕ Add';
  I18N.dict.id['common.add'] = '➕ Tambah';
  I18N.dict.en['common.delete'] = 'Delete';
  I18N.dict.id['common.delete'] = 'Hapus';
  I18N.dict.en['common.actions'] = 'Actions';
  I18N.dict.id['common.actions'] = 'Aksi';
  I18N.dict.en['common.no_data'] = 'No data';
  I18N.dict.id['common.no_data'] = 'Tidak ada data';
  I18N.dict.en['common.confirm_delete'] = 'Delete this item?';
  I18N.dict.id['common.confirm_delete'] = 'Hapus item ini?';
  I18N.dict.en['common.deleted'] = 'Deleted';
  I18N.dict.id['common.deleted'] = 'Terhapus';
  I18N.dict.en['common.invalid_params'] = 'Invalid parameters';
  I18N.dict.id['common.invalid_params'] = 'Parameter tidak valid';

  // ---- 通用按钮 / 状态（P1 已定义译文、待 P2 页面接线） ----
  I18N.dict.en['common.edit'] = 'Edit';
  I18N.dict.id['common.edit'] = 'Edit';
  I18N.dict.en['common.search'] = 'Search';
  I18N.dict.id['common.search'] = 'Cari';
  I18N.dict.en['common.reset'] = 'Reset';
  I18N.dict.id['common.reset'] = 'Atur ulang';
  I18N.dict.en['common.refresh'] = 'Refresh';
  I18N.dict.id['common.refresh'] = 'Segarkan';
  I18N.dict.en['common.import'] = 'Import';
  I18N.dict.id['common.import'] = 'Impor';
  I18N.dict.en['common.export'] = 'Export';
  I18N.dict.id['common.export'] = 'Ekspor';
  I18N.dict.en['common.confirm'] = 'Confirm';
  I18N.dict.id['common.confirm'] = 'Konfirmasi';
  I18N.dict.en['common.close'] = 'Close';
  I18N.dict.id['common.close'] = 'Tutup';
  I18N.dict.en['common.submit'] = 'Submit';
  I18N.dict.id['common.submit'] = 'Kirim';
  I18N.dict.en['common.back'] = 'Back';
  I18N.dict.id['common.back'] = 'Kembali';
  I18N.dict.en['common.loading'] = 'Loading...';
  I18N.dict.id['common.loading'] = 'Memuat...';
  I18N.dict.en['common.success'] = 'Operation successful';
  I18N.dict.id['common.success'] = 'Operasi berhasil';
  I18N.dict.en['common.fail'] = 'Operation failed';
  I18N.dict.id['common.fail'] = 'Operasi gagal';
  I18N.dict.en['common.no_permission'] = 'No permission';
  I18N.dict.id['common.no_permission'] = 'Tidak memiliki izin';
  I18N.dict.en['common.network_error'] = 'Network error';
  I18N.dict.id['common.network_error'] = 'Kesalahan jaringan';
  I18N.dict.en['common.empty'] = 'Nothing here';
  I18N.dict.id['common.empty'] = 'Tidak ada konten';
  I18N.dict.en['common.load_fail'] = 'Failed to load. Please retry.';
  I18N.dict.id['common.load_fail'] = 'Gagal memuat. Coba lagi.';
  I18N.dict.en['common.retry'] = 'Retry';
  I18N.dict.id['common.retry'] = 'Coba lagi';
  I18N.dict.en['common.yes'] = 'Yes';
  I18N.dict.id['common.yes'] = 'Ya';
  I18N.dict.en['common.no'] = 'No';
  I18N.dict.id['common.no'] = 'Tidak';

  // ---- 导航（Sidebar / Topnav） ----
  I18N.dict.en['nav.app_title'] = 'Inventory System';
  I18N.dict.id['nav.app_title'] = 'Sistem Inventaris';
  // 模块
  I18N.dict.en['nav.home'] = 'Dashboard';
  I18N.dict.id['nav.home'] = 'Dasbor';
  I18N.dict.en['nav.inventory'] = 'Inventory';
  I18N.dict.id['nav.inventory'] = 'Inventaris';
  I18N.dict.en['nav.sales'] = 'Sales';
  I18N.dict.id['nav.sales'] = 'Penjualan';
  I18N.dict.en['nav.procurement'] = 'Procurement';
  I18N.dict.id['nav.procurement'] = 'Pengadaan';
  I18N.dict.en['nav.approval'] = 'Approvals';
  I18N.dict.id['nav.approval'] = 'Persetujuan';
  I18N.dict.en['nav.finance'] = 'Finance';
  I18N.dict.id['nav.finance'] = 'Keuangan';
  I18N.dict.en['nav.system'] = 'System';
  I18N.dict.id['nav.system'] = 'Sistem';
  // 菜单项
  I18N.dict.en['nav.dashboard'] = 'Dashboard';
  I18N.dict.id['nav.dashboard'] = 'Dasbor';
  I18N.dict.en['nav.skus'] = 'SKU Master';
  I18N.dict.id['nav.skus'] = 'Data Induk SKU';
  I18N.dict.en['nav.inventory_total'] = 'Inventory List';
  I18N.dict.id['nav.inventory_total'] = 'Daftar Inventaris';
  I18N.dict.en['nav.stock_check'] = 'Stock Check';
  I18N.dict.id['nav.stock_check'] = 'Cek Stok';
  I18N.dict.en['nav.stagnant'] = 'Slow-Moving Analysis';
  I18N.dict.id['nav.stagnant'] = 'Analisis Stok Lambat';
  I18N.dict.en['nav.sales_data'] = 'Sales Data';
  I18N.dict.id['nav.sales_data'] = 'Data Penjualan';
  I18N.dict.en['nav.forecast'] = 'Demand Forecast';
  I18N.dict.id['nav.forecast'] = 'Peramalan Pesanan';
  I18N.dict.en['nav.po'] = 'Purchase Orders';
  I18N.dict.id['nav.po'] = 'Purchase Order';
  I18N.dict.en['nav.pi'] = 'Proforma Invoices';
  I18N.dict.id['nav.pi'] = 'Proforma Invoice';
  I18N.dict.en['nav.ci'] = 'CI / PL';
  I18N.dict.id['nav.ci'] = 'CI / PL';
  I18N.dict.en['nav.logistics'] = 'Logistics';
  I18N.dict.id['nav.logistics'] = 'Logistik';
  I18N.dict.en['nav.inbound'] = 'Inbound';
  I18N.dict.id['nav.inbound'] = 'Barang Masuk';
  I18N.dict.en['nav.approval_center'] = 'Approval Center';
  I18N.dict.id['nav.approval_center'] = 'Pusat Persetujuan';
  I18N.dict.en['nav.payable_cockpit'] = 'Payables Cockpit';
  I18N.dict.id['nav.payable_cockpit'] = 'Kokpit Hutang';
  I18N.dict.en['nav.payment'] = 'Payments';
  I18N.dict.id['nav.payment'] = 'Pembayaran';
  I18N.dict.en['nav.cost'] = 'Cost Management';
  I18N.dict.id['nav.cost'] = 'Manajemen Biaya';
  I18N.dict.en['nav.users'] = 'Users';
  I18N.dict.id['nav.users'] = 'Pengguna';
  I18N.dict.en['nav.roles'] = 'Roles & Permissions';
  I18N.dict.id['nav.roles'] = 'Peran & Izin';
  I18N.dict.en['nav.countries'] = 'Countries';
  I18N.dict.id['nav.countries'] = 'Negara';
  I18N.dict.en['nav.warehouses'] = 'Warehouses';
  I18N.dict.id['nav.warehouses'] = 'Gudang';
  I18N.dict.en['nav.brand_settings'] = 'Brand Settings';
  I18N.dict.id['nav.brand_settings'] = 'Pengaturan Merek';
  I18N.dict.en['nav.currencies'] = 'Currencies';
  I18N.dict.id['nav.currencies'] = 'Mata Uang';
  I18N.dict.en['nav.operation_logs'] = 'Operation Logs';
  I18N.dict.id['nav.operation_logs'] = 'Log Operasi';
  I18N.dict.en['nav.config'] = 'System Settings';
  I18N.dict.id['nav.config'] = 'Pengaturan Sistem';
  I18N.dict.en['nav.suppliers'] = 'Suppliers';
  I18N.dict.id['nav.suppliers'] = 'Supplier';
  I18N.dict.en['nav.freight_forwarders'] = 'Freight Forwarders';
  I18N.dict.id['nav.freight_forwarders'] = 'Forwarder Kargo';
  I18N.dict.en['nav.payment_terms'] = 'Payment Terms';
  I18N.dict.id['nav.payment_terms'] = 'Syarat Pembayaran';
  I18N.dict.en['nav.payment_categories'] = 'Payment Categories';
  I18N.dict.id['nav.payment_categories'] = 'Kategori Pembayaran';
  I18N.dict.en['nav.payer_entities'] = 'Payer Entities';
  I18N.dict.id['nav.payer_entities'] = 'Entitas Pembayar';
  I18N.dict.en['nav.approval_flows'] = 'Approval Flows';
  I18N.dict.id['nav.approval_flows'] = 'Alur Persetujuan';
  I18N.dict.en['nav.expense_types'] = 'Expense Types';
  I18N.dict.id['nav.expense_types'] = 'Jenis Biaya';
  I18N.dict.en['nav.allocation_rules'] = 'Allocation Rules';
  I18N.dict.id['nav.allocation_rules'] = 'Aturan Alokasi';
  I18N.dict.en['nav.batch_tasks'] = 'Batch Tasks';
  I18N.dict.id['nav.batch_tasks'] = 'Tugas Massal';
  I18N.dict.en['nav.forwarder_analysis'] = 'Forwarder Analysis';
  I18N.dict.id['nav.forwarder_analysis'] = 'Analisis Forwarder';
})();
