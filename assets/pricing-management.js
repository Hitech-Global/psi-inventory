(function () {
  'use strict';

  var state = null;

  function psT(zh, en, id) {
    var lang = typeof getLang === 'function' ? getLang() : 'zh';
    return lang === 'en' ? (en || zh) : lang === 'id' ? (id || en || zh) : zh;
  }
  function psEsc(value) { return typeof esc === 'function' ? esc(String(value == null ? '' : value)) : String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function psArg(value) { return psEsc(JSON.stringify(value == null ? '' : String(value))); }
  function psNum(value) { var n = Number(value); return Number.isFinite(n) ? n : null; }
  function psFmt(value, digits) {
    var n = psNum(value);
    if (n === null) return '—';
    return n.toLocaleString(undefined, { minimumFractionDigits: digits == null ? 0 : digits, maximumFractionDigits: digits == null ? 2 : digits });
  }
  function psCurrency() {
    if (!state || !state.scheme) return '';
    var item = (state.meta.currencies || []).find(function (c) { return String(c.code).toUpperCase() === String(state.scheme.currency || '').toUpperCase(); });
    return item && item.symbol ? item.symbol : (state.scheme.currency || '');
  }
  function psCountryLabel(country) {
    var item = (state.meta.countries || []).find(function (c) { return c.name === country; });
    var code = item ? String(item.code || '').toUpperCase() : '';
    if (code === 'ID') return psT('印度尼西亚', 'Indonesia', 'Indonesia');
    if (code === 'MY') return psT('马来西亚', 'Malaysia', 'Malaysia');
    if (code === 'TH') return psT('泰国', 'Thailand', 'Thailand');
    if (code === 'SG') return psT('新加坡', 'Singapore', 'Singapura');
    return country || '';
  }
  function psNotify(message, type) {
    if (typeof showToast === 'function') showToast(message, type || 'info');
  }
  function psCanEdit() { return !!(state && state.details && state.details.can_edit); }
  function psAmountAllowed() { return !!(state && state.rowsResult && state.rowsResult.amount_view_allowed); }

  async function renderPricingSystem() {
    var root = document.getElementById('content-inner');
    if (!root) return;
    state = { meta: { countries: [], brands: [], currencies: [] }, schemes: [], scheme: null, details: null, rows: [], rowsResult: null, versions: [], tab: 'details', search: '', category: '', grouped: true, collapsed: {}, loading: true };
    root.innerHTML = '<div class="ps-loading"><span class="ps-spinner"></span>' + psEsc(psT('正在加载价格体系…', 'Loading pricing system…', 'Memuat sistem harga…')) + '</div>';
    try {
      var result = await Promise.all([api('/api/pricing/meta'), api('/api/pricing/schemes')]);
      state.meta = result[0] || state.meta;
      state.schemes = Array.isArray(result[1]) ? result[1] : [];
      state.selectedSchemeId = state.schemes.length ? state.schemes[0].id : '';
      state.loading = false;
      if (state.selectedSchemeId) await psLoadScheme(state.selectedSchemeId);
      else psRender();
    } catch (error) {
      state.loading = false;
      root.innerHTML = '<div class="ps-error"><strong>' + psEsc(psT('价格体系加载失败', 'Unable to load pricing system', 'Gagal memuat sistem harga')) + '</strong><div>' + psEsc(error.message) + '</div><button class="btn btn-secondary" onclick="renderPricingSystem()">' + psEsc(psT('重试', 'Retry', 'Coba lagi')) + '</button></div>';
    }
  }

  async function psLoadScheme(id) {
    state.loading = true;
    state.selectedSchemeId = id;
    psRender();
    try {
      var result = await Promise.all([
        api('/api/pricing/schemes/' + encodeURIComponent(id)),
        api('/api/pricing/schemes/' + encodeURIComponent(id) + '/rows')
      ]);
      state.details = result[0];
      state.scheme = result[0].scheme;
      state.rowsResult = result[1] || { rows: [] };
      state.rows = Array.isArray(state.rowsResult.rows) ? state.rowsResult.rows : [];
      state.loading = false;
      psRender();
    } catch (error) {
      state.loading = false;
      state.details = null;
      state.scheme = null;
      state.rows = [];
      psRender();
      psNotify(error.message, 'danger');
    }
  }

  function psRender() {
    var root = document.getElementById('content-inner');
    if (!root || !state) return;
    root.innerHTML = psRenderHeader() + (state.scheme ? psRenderScheme() : psRenderEmpty());
    if (!state.scheme) return;
    var body = document.getElementById('ps-tab-body');
    if (!body) return;
    if (state.loading) {
      body.innerHTML = '<div class="ps-loading"><span class="ps-spinner"></span>' + psEsc(psT('正在读取 SKU 和库存数据…', 'Loading SKU and inventory data…', 'Memuat SKU dan inventaris…')) + '</div>';
      return;
    }
    if (state.tab === 'details') body.innerHTML = psRenderPriceTable();
    else if (state.tab === 'rules') body.innerHTML = psRenderRules();
    else if (state.tab === 'formula') body.innerHTML = psRenderFormula();
    else if (state.tab === 'settings') body.innerHTML = psRenderSettings();
    else if (state.tab === 'versions') psLoadVersions();
  }

  function psRenderHeader() {
    var meta = state.meta || {};
    var countries = meta.countries || [];
    var brands = meta.brands || [];
    var schemes = state.schemes || [];
    var selected = state.scheme || schemes.find(function (s) { return s.id === state.selectedSchemeId; }) || {};
    var countryOptions = '<option value="">' + psEsc(psT('全部国家', 'All countries', 'Semua negara')) + '</option>' +
      countries.map(function (c) { return '<option value="' + psEsc(c.name) + '" ' + (selected.country === c.name ? 'selected' : '') + '>' + psEsc(psCountryLabel(c.name)) + '</option>'; }).join('');
    var brandOptions = '<option value="">' + psEsc(psT('全部品牌', 'All brands', 'Semua merek')) + '</option>' +
      brands.map(function (b) { return '<option value="' + psEsc(b) + '" ' + (selected.brand === b ? 'selected' : '') + '>' + psEsc(b) + '</option>'; }).join('');
    var platforms = Array.from(new Set(schemes.map(function (s) { return s.platform; }).filter(Boolean)));
    var platformOptions = '<option value="">' + psEsc(psT('全部平台', 'All platforms', 'Semua platform')) + '</option>' +
      platforms.map(function (p) { return '<option value="' + psEsc(p) + '" ' + (selected.platform === p ? 'selected' : '') + '>' + psEsc(p) + '</option>'; }).join('');
    var stores = Array.from(new Set(schemes.map(function (s) { return s.store || ''; })));
    var storeOptions = '<option value="">' + psEsc(psT('全部店铺', 'All stores', 'Semua toko')) + '</option>' +
      stores.filter(Boolean).map(function (s) { return '<option value="' + psEsc(s) + '" ' + (selected.store === s ? 'selected' : '') + '>' + psEsc(s) + '</option>'; }).join('');
    return '<div class="ps-page">' +
      '<div class="ps-page-head"><div><h1>' + psEsc(psT('价格体系', 'Pricing System', 'Sistem Harga')) + '</h1><p>' + psEsc(psT('按国家、品牌和电商平台维护成本、费用规则与定价。', 'Maintain costs, fee rules and pricing by country, brand and platform.', 'Kelola biaya, aturan biaya, dan harga berdasarkan negara, merek, dan platform.')) + '</p></div>' +
      '<div class="ps-head-actions">' +
      '<button class="btn btn-secondary" onclick="psPickImport()" ' + (!state.scheme || !psCanEdit() ? 'disabled' : '') + '>⇧ ' + psEsc(psT('导入 Excel', 'Import Excel', 'Impor Excel')) + '</button>' +
      '<button class="btn btn-secondary" onclick="psExportExcel()" ' + (!state.scheme ? 'disabled' : '') + '>⇩ ' + psEsc(psT('导出 Excel', 'Export Excel', 'Ekspor Excel')) + '</button>' +
      '<button class="btn btn-primary" onclick="psOpenNewScheme()">＋ ' + psEsc(psT('新建价格方案', 'New pricing scheme', 'Buat skema harga')) + '</button>' +
      '</div></div>' +
      '<div class="ps-filterbar">' +
      '<label><span>' + psEsc(psT('国家', 'Country', 'Negara')) + '</span><select id="ps-filter-country" onchange="psApplyFilters()">' + countryOptions + '</select></label>' +
      '<label><span>' + psEsc(psT('品牌', 'Brand', 'Merek')) + '</span><select id="ps-filter-brand" onchange="psApplyFilters()">' + brandOptions + '</select></label>' +
      '<label><span>' + psEsc(psT('电商平台', 'Platform', 'Platform')) + '</span><select id="ps-filter-platform" onchange="psApplyFilters()">' + platformOptions + '</select></label>' +
      '<label><span>' + psEsc(psT('店铺', 'Store', 'Toko')) + '</span><select id="ps-filter-store" onchange="psApplyFilters()">' + storeOptions + '</select></label>' +
      '<label><span>' + psEsc(psT('方案状态', 'Status', 'Status')) + '</span><select id="ps-filter-status" onchange="psApplyFilters()"><option value="">' + psEsc(psT('全部状态', 'All statuses', 'Semua status')) + '</option><option value="active" ' + (selected.status === 'active' ? 'selected' : '') + '>' + psEsc(psT('启用', 'Active', 'Aktif')) + '</option><option value="draft" ' + (selected.status === 'draft' ? 'selected' : '') + '>' + psEsc(psT('待配置', 'Draft', 'Draf')) + '</option><option value="disabled" ' + (selected.status === 'disabled' ? 'selected' : '') + '>' + psEsc(psT('停用', 'Disabled', 'Nonaktif')) + '</option></select></label>' +
      '</div></div>';
  }

  function psRenderEmpty() {
    return '<div class="ps-empty"><div class="ps-empty-icon">▤</div><h2>' + psEsc(psT('还没有价格方案', 'No pricing schemes yet', 'Belum ada skema harga')) + '</h2><p>' + psEsc(psT('先建立一个国家、品牌和平台组合，再维护 SKU 成本与费用规则。', 'Create a country, brand and platform combination to start managing SKU costs and fees.', 'Buat kombinasi negara, merek, dan platform untuk mulai mengelola biaya SKU.')) + '</p><button class="btn btn-primary" onclick="psOpenNewScheme()">＋ ' + psEsc(psT('新建价格方案', 'New pricing scheme', 'Buat skema harga')) + '</button></div>';
  }

  function psRenderScheme() {
    var scheme = state.scheme;
    var rows = state.rows || [];
    var categories = Array.from(new Set(rows.map(function (r) { return r.category || '未分类'; })));
    var profits = rows.map(function (r) { return psNum(r.profit_rate); }).filter(function (v) { return v !== null; });
    var avg = profits.length ? profits.reduce(function (a, b) { return a + b; }, 0) / profits.length : null;
    var statusText = scheme.status === 'active' ? psT('启用', 'Active', 'Aktif') : scheme.status === 'disabled' ? psT('停用', 'Disabled', 'Nonaktif') : psT('待配置', 'Draft', 'Draf');
    var tabs = [
      ['details', psT('价格明细', 'Price details', 'Detail harga')],
      ['rules', psT('费用规则', 'Fee rules', 'Aturan biaya')],
      ['formula', psT('SRP 公式', 'SRP formula', 'Rumus SRP')],
      ['settings', psT('方案设置', 'Scheme settings', 'Pengaturan skema')],
      ['versions', psT('版本记录', 'Version history', 'Riwayat versi')]
    ];
    var html = '<div class="ps-scheme-card"><div class="ps-scheme-title"><div><h2>' + psEsc(psCountryLabel(scheme.country)) + ' · ' + psEsc(scheme.brand) + ' · ' + psEsc(scheme.platform) + '</h2><span class="ps-status ps-status-' + psEsc(scheme.status) + '">' + psEsc(statusText) + '</span><p>' + psEsc(psT('币种：', 'Currency: ', 'Mata uang: ')) + psEsc(scheme.currency || '—') + '　|　' + psEsc(psT('生效日期：', 'Effective: ', 'Berlaku: ')) + psEsc(scheme.effective_date || '—') + '　|　' + psEsc(scheme.description || '') + '</p></div>' +
      '<div class="ps-stats"><div class="ps-stat"><span>SKU ' + psEsc(psT('数量', 'count', 'jumlah')) + '</span><strong>' + rows.length + '</strong></div><div class="ps-stat"><span>' + psEsc(psT('产品类目', 'Categories', 'Kategori')) + '</span><strong>' + categories.length + '</strong></div><div class="ps-stat"><span>' + psEsc(psT('平均利润率', 'Avg. profit rate', 'Rata-rata margin')) + '</span><strong class="' + (avg !== null && avg < 10 ? 'ps-red' : 'ps-green') + '">' + (avg === null ? '—' : psFmt(avg, 2) + '%') + '</strong></div></div></div></div>';
    html += '<div class="ps-tabs">' + tabs.map(function (tab) {
      return '<button class="ps-tab ' + (state.tab === tab[0] ? 'active' : '') + '" onclick="psSetTab(' + psArg(tab[0]) + ')">' + psEsc(tab[1]) + '</button>';
    }).join('') + '</div><div id="ps-tab-body" class="ps-tab-body"></div>';
    return html;
  }

  function psFilteredRows() {
    var rows = (state.rows || []).slice();
    var term = String(state.search || '').trim().toLowerCase();
    if (term) rows = rows.filter(function (r) { return String(r.sku_code || '').toLowerCase().includes(term) || String(r.product_name || '').toLowerCase().includes(term); });
    if (state.category) rows = rows.filter(function (r) { return (r.category || '未分类') === state.category; });
    rows.sort(function (a, b) {
      var ac = String(a.category || '未分类'), bc = String(b.category || '未分类');
      return ac.localeCompare(bc) || String(a.sku_code).localeCompare(String(b.sku_code));
    });
    return rows;
  }

  function psRenderPriceTable() {
    var rows = psFilteredRows();
    var fields = (state.details.fields || []).filter(function (f) { return Number(f.is_active) === 1; }).sort(function (a, b) { return Number(a.display_order || 0) - Number(b.display_order || 0); });
    var categories = Array.from(new Set((state.rows || []).map(function (r) { return r.category || '未分类'; }))).sort();
    var categoryOptions = '<option value="">' + psEsc(psT('全部类目', 'All categories', 'Semua kategori')) + '</option>' + categories.map(function (c) { return '<option value="' + psEsc(c) + '" ' + (state.category === c ? 'selected' : '') + '>' + psEsc(c) + '</option>'; }).join('');
    var html = '';
    if (rows.some(function (r) { return r.category === '未分类'; })) {
      html += '<div class="ps-notice ps-notice-warning">ⓘ ' + psEsc(psT('部分 SKU 主数据未维护产品类目，暂按「未分类」显示；类目费用规则无法匹配这些 SKU。', 'Some SKU master records have no product category. They are grouped as Unclassified and category-based rules will not match them.', 'Beberapa SKU belum memiliki kategori di master data. SKU tersebut ditampilkan sebagai Tanpa Kategori.')) + '</div>';
    }
    if (state.scheme && !String(state.scheme.srp_formula || '').trim()) {
      html += '<div class="ps-notice ps-notice-info">ⓘ ' + psEsc(psT('尚未设置 SRP 计算公式，SRP、利润和利润率暂不计算。请前往「SRP 公式」设置。', 'SRP formula is not configured. SRP, profit and margin will remain blank until a formula is saved.', 'Rumus SRP belum diatur.')) + '</div>';
    }
    html += '<div class="ps-table-toolbar"><div class="ps-toolbar-left"><input class="ps-search" placeholder="' + psEsc(psT('搜索 SKU', 'Search SKU', 'Cari SKU')) + '" value="' + psEsc(state.search) + '" oninput="psSetSearch(this.value)"><select class="ps-category-filter" onchange="psSetCategory(this.value)">' + categoryOptions + '</select></div><div class="ps-toolbar-right"><label class="ps-switch"><input type="checkbox" ' + (state.grouped ? 'checked' : '') + ' onchange="psToggleGrouped(this.checked)"><span></span>' + psEsc(psT('按类目分组', 'Group by category', 'Kelompokkan kategori')) + '</label><button class="btn btn-secondary btn-sm" onclick="psOpenFieldSettings()">▦ ' + psEsc(psT('字段设置', 'Field settings', 'Pengaturan kolom')) + '</button></div></div>';
    if (!psAmountAllowed()) {
      html += '<div class="ps-notice ps-notice-warning">' + psEsc(psT('当前账号没有价格金额查看权限，只显示 SKU、类目和库存数量。', 'This account cannot view pricing amounts. Only SKU, category and stock are shown.', 'Akun ini tidak memiliki izin melihat nilai harga.')) + '</div>';
    }
    var amountAllowed = psAmountAllowed();
    var columns = ['<th class="ps-sticky-sku">SKU</th>', '<th>' + psEsc(psT('产品类目', 'Category', 'Kategori')) + '</th>'];
    if (state.rowsResult && state.rowsResult.inventory_view_allowed) columns.push('<th class="ps-stock-head">' + psEsc(psT('库存数量', 'Stock qty', 'Stok')) + '</th>');
    if (amountAllowed) {
      columns.push('<th>FOB-RMB</th>');
      fields.forEach(function (field) { columns.push('<th>' + psEsc(field.field_name) + (field.value_type === 'percent' ? '<small>(%)</small>' : '') + '</th>'); });
      columns.push('<th class="ps-srp-head">SRP-' + psEsc(state.scheme.currency || '') + '</th><th>' + psEsc(psT('利润', 'Profit', 'Laba')) + '<small>(' + psEsc(state.scheme.currency || '') + ')</small></th><th>' + psEsc(psT('利润率', 'Margin', 'Margin')) + '</th>');
    }
    if (psCanEdit()) columns.push('<th></th>');
    html += '<div class="ps-table-wrap"><table class="ps-table"><thead><tr>' + columns.join('') + '</tr></thead><tbody>';
    if (!rows.length) {
      html += '<tr><td colspan="' + columns.length + '" class="ps-no-data">' + psEsc(psT('没有匹配的 SKU', 'No matching SKUs', 'Tidak ada SKU yang cocok')) + '</td></tr>';
    } else if (state.grouped) {
      var groups = {};
      rows.forEach(function (r) { var key = r.category || '未分类'; if (!groups[key]) groups[key] = []; groups[key].push(r); });
      Object.keys(groups).sort().forEach(function (category) {
        var collapsed = !!state.collapsed[category];
        html += '<tr class="ps-group-row"><td colspan="' + columns.length + '"><button onclick="psToggleCategory(' + psArg(category) + ')" class="ps-group-toggle">' + (collapsed ? '›' : '⌄') + '</button><strong>' + psEsc(category) + '</strong><span>' + groups[category].length + ' SKUs</span></td></tr>';
        if (!collapsed) groups[category].forEach(function (row) { html += psRenderRow(row, fields, amountAllowed); });
      });
    } else {
      rows.forEach(function (row) { html += psRenderRow(row, fields, amountAllowed); });
    }
    html += '</tbody></table></div>';
    return html;
  }

  function psRenderRow(row, fields, amountAllowed) {
    var html = '<tr><td class="ps-sticky-sku"><strong>' + psEsc(row.sku_code) + '</strong></td><td><span class="ps-category-pill">' + psEsc(row.category || '未分类') + '</span></td>';
    if (state.rowsResult && state.rowsResult.inventory_view_allowed) {
      html += '<td class="ps-stock ' + (Number(row.stock_qty) === 0 ? 'zero' : '') + '">' + (row.stock_qty == null ? '—' : psFmt(row.stock_qty, 0)) + '</td>';
    }
    if (amountAllowed) {
      html += '<td class="ps-number">' + (row.fob_rmb == null ? '—' : psFmt(row.fob_rmb, 2)) + psEditable(row, 'FOB_RMB', row.fob_rmb, 'currency') + '</td>';
      fields.forEach(function (field) {
        var value = row.fields ? row.fields[field.field_key] : null;
        var text = value == null ? '—' : (field.value_type === 'percent' ? psFmt(value, 2) + '%' : psFmt(value, 2));
        html += '<td class="ps-number">' + psEsc(text) + psEditable(row, field.field_key, value, field.value_type) + '</td>';
      });
      html += '<td class="ps-number ps-srp-cell">' + (row.srp == null ? '—' : psFmt(row.srp, 0)) + '</td>';
      html += '<td class="ps-number">' + (row.profit == null ? '—' : psFmt(row.profit, 0)) + '</td>';
      html += '<td class="ps-number ' + (row.profit_rate != null && row.profit_rate < 10 ? 'ps-red' : '') + '">' + (row.profit_rate == null ? '—' : psFmt(row.profit_rate, 2) + '%') + '</td>';
    }
    if (psCanEdit()) html += '<td class="ps-actions"><button class="ps-more" onclick="psEditSku(' + psArg(row.sku_code) + ')" title="' + psEsc(psT('编辑 SKU 价格', 'Edit SKU pricing', 'Edit harga SKU')) + '">···</button></td>';
    return html + '</tr>';
  }

  function psEditable(row, key, value, type) {
    if (!psCanEdit()) return '';
    return '<button class="ps-cell-edit" onclick="psEditValue(' + psArg(row.sku_code) + ',' + psArg(key) + ',' + psArg(value == null ? '' : value) + ',' + psArg(type) + ')" title="' + psEsc(psT('手动覆盖', 'Manual override', 'Override manual')) + '">✎</button>';
  }

  function psRenderRules() {
    var fields = (state.details.fields || []).filter(function (f) { return Number(f.is_active) === 1; });
    var rules = state.details.rules || [];
    var html = '<div class="ps-section-head"><div><h3>' + psEsc(psT('费用字段与适用规则', 'Fee fields and applicability rules', 'Kolom biaya dan aturan penerapan')) + '</h3><p>' + psEsc(psT('字段属于当前价格方案。规则可以按全部 SKU、产品类目或单个 SKU 匹配。', 'Fields belong to this pricing scheme. Rules can target all SKUs, a product category or an individual SKU.', 'Kolom biaya dimiliki skema ini dan dapat diterapkan ke semua SKU, kategori, atau SKU tertentu.')) + '</p></div>' +
      '<button class="btn btn-primary" onclick="psOpenFieldModal()">＋ ' + psEsc(psT('添加费用字段', 'Add fee field', 'Tambah kolom biaya')) + '</button></div>';
    if (!fields.length) return html + '<div class="ps-empty-inline">' + psEsc(psT('还没有费用字段，先添加一个字段。', 'No fee fields yet. Add your first field.', 'Belum ada kolom biaya.')) + '</div>';
    fields.forEach(function (field) {
      var list = rules.filter(function (r) { return r.field_id === field.id; });
      html += '<div class="ps-field-card"><div class="ps-field-head"><div><strong>' + psEsc(field.field_name) + '</strong><span class="ps-field-meta">' + psEsc(field.group_type) + ' · ' + psEsc(field.value_type) + ' · ' + (Number(field.include_in_profit) ? psEsc(psT('计入利润', 'Deduct from profit', 'Dikurangi dari laba')) : psEsc(psT('仅展示', 'Display only', 'Hanya tampil'))) + (Number(field.required_for_profit) ? ' · ' + psEsc(psT('利润必填', 'Required for profit', 'Wajib untuk laba')) : '') + '</span></div>' +
        '<div class="ps-field-actions"><button class="btn btn-secondary btn-sm" onclick="psOpenRuleModal(' + psArg(field.id) + ')">＋ ' + psEsc(psT('添加规则', 'Add rule', 'Tambah aturan')) + '</button><button class="btn btn-secondary btn-sm" onclick="psOpenFieldModal(' + psArg(field.id) + ')">' + psEsc(psT('编辑字段', 'Edit field', 'Edit kolom')) + '</button><button class="btn btn-ghost btn-sm" onclick="psDeactivateField(' + psArg(field.id) + ')">' + psEsc(psT('停用', 'Disable', 'Nonaktifkan')) + '</button></div></div>';
      if (!list.length) html += '<div class="ps-rule-empty">' + psEsc(psT('暂无规则。可以在价格明细中按 SKU 手动维护，也可以在这里建立类目规则。', 'No rules yet. Enter SKU overrides in Price details or create category rules here.', 'Belum ada aturan.')) + '</div>';
      list.forEach(function (rule) {
        var scopeLabel = rule.scope_type === 'global' ? psT('全部 SKU', 'All SKUs', 'Semua SKU') : rule.scope_type === 'category' ? psT('类目：', 'Category: ', 'Kategori: ') + (rule.scope_value === '__UNCATEGORIZED__' ? '未分类' : rule.scope_value) : 'SKU：' + rule.scope_value;
        var calc = rule.calculation_type === 'rate' ? '费率 ' + psFmt(rule.rate, 2) + '%' :
          rule.calculation_type === 'percentage' ? psFmt(rule.rate, 2) + '% × ' + rule.basis :
          rule.calculation_type === 'capped' ? psFmt(rule.rate, 2) + '% × ' + rule.basis + '，封顶 ' + psFmt(rule.cap_amount, 2) :
          rule.calculation_type === 'formula' ? rule.formula : psFmt(rule.fixed_amount, 2);
        html += '<div class="ps-rule-row"><span class="ps-rule-scope">' + psEsc(scopeLabel) + '</span><span class="ps-rule-calc">' + psEsc(calc) + '</span><span class="ps-rule-status">' + psEsc(rule.status === 'active' ? psT('启用', 'Active', 'Aktif') : psT('停用', 'Disabled', 'Nonaktif')) + '</span><button class="btn btn-ghost btn-sm" onclick="psOpenRuleModal(' + psArg(field.id) + ',' + psArg(rule.id) + ')">' + psEsc(psT('编辑', 'Edit', 'Edit')) + '</button><button class="btn btn-ghost btn-sm" onclick="psDeactivateRule(' + psArg(rule.id) + ')">' + psEsc(psT('停用', 'Disable', 'Nonaktifkan')) + '</button></div>';
      });
      html += '</div>';
    });
    return html;
  }

  function psRenderFormula() {
    var scheme = state.scheme;
    var variables = ['FOB_RMB', 'RMB_TO_LOCAL', 'EXCHANGE_RATE', 'INVENTORY_QTY'].concat((state.details.fields || []).map(function (f) { return f.field_key; }));
    return '<div class="ps-config-card"><div class="ps-section-head"><div><h3>' + psEsc(psT('SRP 计算公式', 'SRP calculation formula', 'Rumus perhitungan SRP')) + '</h3><p>' + psEsc(psT('公式由你自行维护。系统只负责安全解析公式并计算结果，不提供固定定价方案。', 'Maintain your own formula. The system safely parses and calculates it without imposing a preset pricing method.', 'Rumus dikelola sendiri.')) + '</p></div></div>' +
      '<label class="ps-form-label">' + psEsc(psT('SRP 公式', 'SRP formula', 'Rumus SRP')) + '</label><textarea id="ps-srp-formula" class="ps-formula-input" rows="4" placeholder="FOB_RMB * 2.2 * RMB_TO_LOCAL">' + psEsc(scheme.srp_formula || '') + '</textarea>' +
      '<label class="ps-form-label">' + psEsc(psT('RMB → 本币汇率', 'RMB to local currency FX rate', 'Kurs RMB ke mata uang lokal')) + '</label><input id="ps-srp-fx" type="number" step="0.000001" value="' + psEsc(scheme.exchange_rate || '') + '" class="ps-input ps-input-narrow">' +
      '<div class="ps-variable-title">' + psEsc(psT('可用变量（点击复制）', 'Available variables (click to copy)', 'Variabel tersedia (klik untuk menyalin)')) + '</div><div class="ps-variable-list">' + variables.map(function (v) { return '<button class="ps-variable" onclick="psCopyVariable(' + psArg(v) + ')">' + psEsc(v) + '</button>'; }).join('') + '</div>' +
      '<div class="ps-form-hint">' + psEsc(psT('支持 +、-、*、/、括号，以及 ROUND、MIN、MAX、ABS、CEIL、FLOOR、SQRT、POW 函数。百分号可写为 10%。', 'Supports +, -, *, /, parentheses and ROUND, MIN, MAX, ABS, CEIL, FLOOR, SQRT, POW. You may write 10% as a percentage literal.', 'Mendukung operasi aritmetika dan fungsi matematika.')) + '</div>' +
      '<div class="ps-form-actions"><button class="btn btn-primary" onclick="psSaveFormula()">' + psEsc(psT('保存公式', 'Save formula', 'Simpan rumus')) + '</button></div></div>';
  }

  function psRenderSettings() {
    var s = state.scheme;
    var currencies = state.meta.currencies || [];
    return '<div class="ps-config-card"><div class="ps-section-head"><div><h3>' + psEsc(psT('方案基本信息', 'Scheme details', 'Detail skema')) + '</h3><p>' + psEsc(psT('每个国家、品牌、平台和店铺组合独立维护。', 'Each country, brand, platform and store combination is maintained independently.', 'Setiap kombinasi negara, merek, platform, dan toko dikelola terpisah.')) + '</p></div></div>' +
      '<div class="ps-form-grid"><label class="ps-form-label">' + psEsc(psT('国家', 'Country', 'Negara')) + '<select id="ps-set-country" class="ps-input">' + (state.meta.countries || []).map(function (c) { return '<option value="' + psEsc(c.name) + '" ' + (c.name === s.country ? 'selected' : '') + '>' + psEsc(psCountryLabel(c.name)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="ps-form-label">' + psEsc(psT('品牌', 'Brand', 'Merek')) + '<select id="ps-set-brand" class="ps-input">' + (state.meta.brands || []).map(function (b) { return '<option value="' + psEsc(b) + '" ' + (b === s.brand ? 'selected' : '') + '>' + psEsc(b) + '</option>'; }).join('') + '</select></label>' +
      '<label class="ps-form-label">' + psEsc(psT('电商平台', 'Platform', 'Platform')) + '<input id="ps-set-platform" class="ps-input" value="' + psEsc(s.platform) + '"></label>' +
      '<label class="ps-form-label">' + psEsc(psT('店铺', 'Store', 'Toko')) + '<input id="ps-set-store" class="ps-input" value="' + psEsc(s.store || '') + '" placeholder="' + psEsc(psT('可选，不填代表全部店铺', 'Optional; blank means all stores', 'Opsional')) + '"></label>' +
      '<label class="ps-form-label">' + psEsc(psT('本币', 'Local currency', 'Mata uang lokal')) + '<select id="ps-set-currency" class="ps-input">' + currencies.map(function (c) { return '<option value="' + psEsc(c.code) + '" ' + (c.code === s.currency ? 'selected' : '') + '>' + psEsc(c.code + ' · ' + c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="ps-form-label">' + psEsc(psT('RMB → 本币汇率', 'RMB to local FX rate', 'Kurs RMB ke mata uang lokal')) + '<input id="ps-set-fx" class="ps-input" type="number" step="0.000001" value="' + psEsc(s.exchange_rate || '') + '"></label>' +
      '<label class="ps-form-label">' + psEsc(psT('生效日期', 'Effective date', 'Tanggal berlaku')) + '<input id="ps-set-date" class="ps-input" type="date" value="' + psEsc(s.effective_date || '') + '"></label>' +
      '<label class="ps-form-label">' + psEsc(psT('方案状态', 'Status', 'Status')) + '<select id="ps-set-status" class="ps-input"><option value="draft" ' + (s.status === 'draft' ? 'selected' : '') + '>' + psEsc(psT('待配置', 'Draft', 'Draf')) + '</option><option value="active" ' + (s.status === 'active' ? 'selected' : '') + '>' + psEsc(psT('启用', 'Active', 'Aktif')) + '</option><option value="disabled" ' + (s.status === 'disabled' ? 'selected' : '') + '>' + psEsc(psT('停用', 'Disabled', 'Nonaktif')) + '</option></select></label>' +
      '<label class="ps-form-label ps-form-wide">' + psEsc(psT('方案说明', 'Description', 'Deskripsi')) + '<input id="ps-set-description" class="ps-input" value="' + psEsc(s.description || '') + '"></label></div>' +
      '<div class="ps-form-actions"><button class="btn btn-primary" onclick="psSaveSettings()">' + psEsc(psT('保存方案设置', 'Save scheme settings', 'Simpan pengaturan')) + '</button></div></div>';
  }

  async function psLoadVersions() {
    var body = document.getElementById('ps-tab-body');
    if (!body) return;
    body.innerHTML = '<div class="ps-loading"><span class="ps-spinner"></span>' + psEsc(psT('正在加载版本记录…', 'Loading version history…', 'Memuat riwayat versi…')) + '</div>';
    try {
      state.versions = await api('/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/versions');
      body.innerHTML = psRenderVersions();
    } catch (error) {
      body.innerHTML = '<div class="ps-error">' + psEsc(error.message) + '</div>';
    }
  }

  function psRenderVersions() {
    var versions = state.versions || [];
    if (!versions.length) return '<div class="ps-empty-inline">' + psEsc(psT('暂无版本记录', 'No version history', 'Belum ada riwayat versi')) + '</div>';
    return '<div class="ps-version-list">' + versions.map(function (v) {
      return '<div class="ps-version-row"><div><strong>v' + psEsc(v.version_no) + '</strong><span>' + psEsc(v.change_summary || '') + '</span><small>' + psEsc(v.created_at || '') + ' · ' + psEsc(v.created_by || '—') + '</small></div>' +
        (psCanEdit() ? '<button class="btn btn-secondary btn-sm" onclick="psRestoreVersion(' + Number(v.version_no) + ')">' + psEsc(psT('恢复此版本', 'Restore version', 'Pulihkan versi')) + '</button>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function psSetTab(tab) { state.tab = tab; psRender(); }
  function psSetSearch(value) { state.search = value; var body = document.getElementById('ps-tab-body'); if (body) body.innerHTML = psRenderPriceTable(); }
  function psSetCategory(value) { state.category = value; var body = document.getElementById('ps-tab-body'); if (body) body.innerHTML = psRenderPriceTable(); }
  function psToggleGrouped(value) { state.grouped = !!value; var body = document.getElementById('ps-tab-body'); if (body) body.innerHTML = psRenderPriceTable(); }
  function psToggleCategory(category) { state.collapsed[category] = !state.collapsed[category]; var body = document.getElementById('ps-tab-body'); if (body) body.innerHTML = psRenderPriceTable(); }

  function psApplyFilters() {
    var country = document.getElementById('ps-filter-country').value;
    var brand = document.getElementById('ps-filter-brand').value;
    var platform = document.getElementById('ps-filter-platform').value;
    var store = document.getElementById('ps-filter-store').value;
    var status = document.getElementById('ps-filter-status').value;
    var match = state.schemes.filter(function (s) {
      return (!country || s.country === country) && (!brand || s.brand === brand) && (!platform || s.platform === platform) &&
        (!store || (s.store || '') === store) && (!status || s.status === status);
    });
    if (!match.length) {
      state.scheme = null; state.details = null; state.rows = []; state.selectedSchemeId = '';
      psRender();
      return;
    }
    psLoadScheme(match[0].id);
  }

  function psOpenNewScheme() {
    var countries = state.meta.countries || [];
    var brands = state.meta.brands || [];
    var currencies = state.meta.currencies || [];
    var html = '<div class="ps-modal-grid"><label>' + psEsc(psT('国家', 'Country', 'Negara')) + '<select id="ps-new-country" class="ps-input">' + countries.map(function (c) { return '<option value="' + psEsc(c.name) + '" data-currency="' + psEsc(c.default_currency || '') + '">' + psEsc(psCountryLabel(c.name)) + '</option>'; }).join('') + '</select></label>' +
      '<label>' + psEsc(psT('品牌', 'Brand', 'Merek')) + '<select id="ps-new-brand" class="ps-input">' + brands.map(function (b) { return '<option value="' + psEsc(b) + '">' + psEsc(b) + '</option>'; }).join('') + '</select></label>' +
      '<label>' + psEsc(psT('电商平台', 'Platform', 'Platform')) + '<input id="ps-new-platform" class="ps-input" placeholder="Shopee / TikTok Shop"></label>' +
      '<label>' + psEsc(psT('店铺（可选）', 'Store (optional)', 'Toko (opsional)')) + '<input id="ps-new-store" class="ps-input" placeholder="' + psEsc(psT('留空代表全部店铺', 'Blank means all stores', 'Kosong berarti semua toko')) + '"></label>' +
      '<label>' + psEsc(psT('本币', 'Currency', 'Mata uang')) + '<select id="ps-new-currency" class="ps-input">' + currencies.map(function (c) { return '<option value="' + psEsc(c.code) + '">' + psEsc(c.code + ' · ' + c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>' + psEsc(psT('方案说明', 'Description', 'Deskripsi')) + '<input id="ps-new-description" class="ps-input"></label></div>';
    openModal(psT('新建价格方案', 'New pricing scheme', 'Buat skema harga'), html,
      '<button class="btn btn-secondary" onclick="closeModal()">' + psEsc(psT('取消', 'Cancel', 'Batal')) + '</button><button class="btn btn-primary" onclick="psCreateScheme()">' + psEsc(psT('创建方案', 'Create scheme', 'Buat skema')) + '</button>');
    var countryEl = document.getElementById('ps-new-country');
    var currencyEl = document.getElementById('ps-new-currency');
    function syncCurrency() {
      var option = countryEl.options[countryEl.selectedIndex];
      var preferred = option && option.getAttribute('data-currency');
      if (preferred && Array.from(currencyEl.options).some(function (o) { return o.value === preferred; })) currencyEl.value = preferred;
    }
    countryEl.addEventListener('change', syncCurrency);
    syncCurrency();
  }

  async function psCreateScheme() {
    try {
      var payload = {
        country: document.getElementById('ps-new-country').value,
        brand: document.getElementById('ps-new-brand').value,
        platform: document.getElementById('ps-new-platform').value,
        store: document.getElementById('ps-new-store').value,
        currency: document.getElementById('ps-new-currency').value,
        description: document.getElementById('ps-new-description').value
      };
      var result = await api('/api/pricing/schemes', 'POST', payload);
      closeModal();
      await renderPricingSystem();
      if (result && result.id) await psLoadScheme(result.id);
      psNotify(psT('价格方案已创建', 'Pricing scheme created', 'Skema harga dibuat'), 'success');
    } catch (error) { psNotify(error.message, 'danger'); }
  }

  function psOpenFieldModal(fieldId) {
    var field = (state.details.fields || []).find(function (f) { return f.id === fieldId; }) || {};
    var isEdit = !!fieldId;
    var html = '<div class="ps-modal-grid"><label>' + psEsc(psT('字段名称', 'Field name', 'Nama kolom')) + '<input id="ps-field-name" class="ps-input" value="' + psEsc(field.field_name || '') + '"></label>' +
      '<label>' + psEsc(psT('字段分组', 'Field group', 'Grup kolom')) + '<select id="ps-field-group" class="ps-input"><option value="cost" ' + (field.group_type === 'cost' ? 'selected' : '') + '>' + psEsc(psT('商品成本', 'Product cost', 'Biaya produk')) + '</option><option value="fee" ' + (!field.group_type || field.group_type === 'fee' ? 'selected' : '') + '>' + psEsc(psT('平台费用', 'Platform fee', 'Biaya platform')) + '</option><option value="other" ' + (field.group_type === 'other' ? 'selected' : '') + '>' + psEsc(psT('其他', 'Other', 'Lainnya')) + '</option></select></label>' +
      '<label>' + psEsc(psT('数值类型', 'Value type', 'Jenis nilai')) + '<select id="ps-field-type" class="ps-input"><option value="currency" ' + (field.value_type !== 'percent' && field.value_type !== 'number' ? 'selected' : '') + '>' + psEsc(psT('金额', 'Currency amount', 'Nominal')) + '</option><option value="percent" ' + (field.value_type === 'percent' ? 'selected' : '') + '>百分比 (%)</option><option value="number" ' + (field.value_type === 'number' ? 'selected' : '') + '>' + psEsc(psT('数字', 'Number', 'Angka')) + '</option></select></label>' +
      '<label>' + psEsc(psT('默认计算方式', 'Default calculation', 'Perhitungan default')) + '<select id="ps-field-calc" class="ps-input"><option value="manual" ' + (field.calculation_type !== 'formula' ? 'selected' : '') + '>' + psEsc(psT('手动填写/规则匹配', 'Manual / rule based', 'Manual / berdasarkan aturan')) + '</option><option value="formula" ' + (field.calculation_type === 'formula' ? 'selected' : '') + '>' + psEsc(psT('公式计算', 'Formula', 'Rumus')) + '</option></select></label>' +
      '<label class="ps-form-wide">' + psEsc(psT('公式（仅公式计算时填写）', 'Formula (for formula calculation)', 'Rumus')) + '<input id="ps-field-formula" class="ps-input" value="' + psEsc(field.formula || '') + '" placeholder="FOB_RMB * (1 + PPN / 100)"></label>' +
      '<label class="ps-checkbox-label"><input id="ps-field-profit" type="checkbox" ' + (Number(field.include_in_profit) !== 0 ? 'checked' : '') + '> ' + psEsc(psT('计入利润扣减', 'Deduct from profit', 'Kurangi laba')) + '</label>' +
      '<label class="ps-checkbox-label"><input id="ps-field-required" type="checkbox" ' + (Number(field.required_for_profit) === 1 ? 'checked' : '') + '> ' + psEsc(psT('利润计算必填（缺失时不计算利润）', 'Required for profit calculation', 'Wajib untuk perhitungan laba')) + '</label></div>';
    openModal(isEdit ? psT('编辑费用字段', 'Edit fee field', 'Edit kolom biaya') : psT('添加费用字段', 'Add fee field', 'Tambah kolom biaya'), html,
      '<button class="btn btn-secondary" onclick="closeModal()">' + psEsc(psT('取消', 'Cancel', 'Batal')) + '</button><button class="btn btn-primary" onclick="psSaveField(' + psArg(fieldId || '') + ')">' + psEsc(psT('保存', 'Save', 'Simpan')) + '</button>');
  }

  async function psSaveField(fieldId) {
    try {
      var body = {
        field_name: document.getElementById('ps-field-name').value,
        group_type: document.getElementById('ps-field-group').value,
        value_type: document.getElementById('ps-field-type').value,
        calculation_type: document.getElementById('ps-field-calc').value,
        formula: document.getElementById('ps-field-formula').value,
        include_in_profit: document.getElementById('ps-field-profit').checked,
        required_for_profit: document.getElementById('ps-field-required').checked
      };
      var url = '/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/fields' + (fieldId ? '/' + encodeURIComponent(fieldId) : '');
      await api(url, fieldId ? 'PUT' : 'POST', body);
      closeModal();
      await psLoadScheme(state.scheme.id);
      state.tab = 'rules';
      psRender();
      psNotify(psT('费用字段已保存', 'Field saved', 'Kolom biaya disimpan'), 'success');
    } catch (error) { psNotify(error.message, 'danger'); }
  }

  async function psDeactivateField(fieldId) {
    if (!confirm(psT('停用该字段？历史版本会保留。', 'Disable this field? Historical versions will be retained.', 'Nonaktifkan kolom ini?'))) return;
    try {
      await api('/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/fields/' + encodeURIComponent(fieldId), 'DELETE');
      await psLoadScheme(state.scheme.id);
      state.tab = 'rules'; psRender();
      psNotify(psT('字段已停用', 'Field disabled', 'Kolom dinonaktifkan'), 'success');
    } catch (error) { psNotify(error.message, 'danger'); }
  }

  function psOpenRuleModal(fieldId, ruleId) {
    var field = (state.details.fields || []).find(function (f) { return f.id === fieldId; });
    var rule = (state.details.rules || []).find(function (r) { return r.id === ruleId; }) || {};
    var isEdit = !!ruleId;
    var categoryOptions = (state.details.categories || []).map(function (c) {
      var value = c === '未分类' ? '__UNCATEGORIZED__' : c;
      return '<option value="' + psEsc(value) + '" ' + (rule.scope_value === value ? 'selected' : '') + '>' + psEsc(c) + '</option>';
    }).join('');
    var skuOptions = (state.rows || []).map(function (r) { return '<option value="' + psEsc(r.sku_code) + '" ' + (rule.scope_value === r.sku_code ? 'selected' : '') + '>' + psEsc(r.sku_code) + '</option>'; }).join('');
    var html = '<div class="ps-modal-grid"><label class="ps-form-wide">' + psEsc(psT('费用字段', 'Fee field', 'Kolom biaya')) + '<input class="ps-input" value="' + psEsc(field ? field.field_name : '') + '" disabled></label>' +
      '<label>' + psEsc(psT('适用范围', 'Applies to', 'Berlaku untuk')) + '<select id="ps-rule-scope" class="ps-input" onchange="psRuleScopeChanged()"><option value="global" ' + ((rule.scope_type || 'global') === 'global' ? 'selected' : '') + '>' + psEsc(psT('全部 SKU', 'All SKUs', 'Semua SKU')) + '</option><option value="category" ' + (rule.scope_type === 'category' ? 'selected' : '') + '>' + psEsc(psT('指定产品类目', 'Product category', 'Kategori produk')) + '</option><option value="sku" ' + (rule.scope_type === 'sku' ? 'selected' : '') + '>指定 SKU</option></select></label>' +
      '<label id="ps-rule-scope-value-wrap">' + psEsc(psT('匹配对象', 'Target', 'Target')) + '<select id="ps-rule-scope-value" class="ps-input"><option value="">—</option>' + categoryOptions + skuOptions + '</select></label>' +
      '<label>' + psEsc(psT('计算方式', 'Calculation', 'Perhitungan')) + '<select id="ps-rule-calc" class="ps-input"><option value="rate" ' + (rule.calculation_type === 'rate' ? 'selected' : '') + '>' + psEsc(psT('返回费率（%）', 'Return rate (%)', 'Persentase (%)')) + '</option><option value="percentage" ' + (rule.calculation_type === 'percentage' ? 'selected' : '') + '>' + psEsc(psT('按基数比例计算金额', 'Percentage of basis', 'Persentase dari dasar')) + '</option><option value="capped" ' + (rule.calculation_type === 'capped' ? 'selected' : '') + '>' + psEsc(psT('比例 + 封顶', 'Percentage with cap', 'Persentase dengan batas')) + '</option><option value="fixed" ' + (rule.calculation_type === 'fixed' ? 'selected' : '') + '>' + psEsc(psT('固定金额', 'Fixed amount', 'Nominal tetap')) + '</option><option value="manual" ' + (!rule.calculation_type || rule.calculation_type === 'manual' ? 'selected' : '') + '>' + psEsc(psT('手动数值', 'Manual value', 'Nilai manual')) + '</option><option value="formula" ' + (rule.calculation_type === 'formula' ? 'selected' : '') + '>' + psEsc(psT('自定义公式', 'Custom formula', 'Rumus khusus')) + '</option></select></label>' +
      '<label>' + psEsc(psT('计算基数', 'Calculation basis', 'Dasar perhitungan')) + '<select id="ps-rule-basis" class="ps-input">' + ['SRP','FOB_RMB','LANDING_COST_CNY','LANDING_COST_LOCAL'].concat((state.details.fields || []).map(function (f) { return f.field_key; })).filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (v) { return '<option value="' + psEsc(v) + '" ' + (String(rule.basis || 'SRP').toUpperCase() === v ? 'selected' : '') + '>' + psEsc(v) + '</option>'; }).join('') + '</select></label>' +
      '<label>' + psEsc(psT('费率 (%)', 'Rate (%)', 'Persentase (%)')) + '<input id="ps-rule-rate" class="ps-input" type="number" step="0.0001" value="' + psEsc(rule.rate == null ? '' : rule.rate) + '"></label>' +
      '<label>' + psEsc(psT('固定金额', 'Fixed amount', 'Nominal tetap')) + '<input id="ps-rule-fixed" class="ps-input" type="number" step="0.01" value="' + psEsc(rule.fixed_amount == null ? '' : rule.fixed_amount) + '"></label>' +
      '<label>' + psEsc(psT('封顶金额', 'Cap amount', 'Batas maksimum')) + '<input id="ps-rule-cap" class="ps-input" type="number" step="0.01" value="' + psEsc(rule.cap_amount == null ? '' : rule.cap_amount) + '"></label>' +
      '<label>' + psEsc(psT('最低金额（可选）', 'Floor amount (optional)', 'Nominal minimum')) + '<input id="ps-rule-floor" class="ps-input" type="number" step="0.01" value="' + psEsc(rule.floor_amount == null ? '' : rule.floor_amount) + '"></label>' +
      '<label class="ps-form-wide">' + psEsc(psT('公式（公式计算时填写）', 'Formula (for formula calculation)', 'Rumus')) + '<input id="ps-rule-formula" class="ps-input" value="' + psEsc(rule.formula || '') + '" placeholder="SRP * 0.05"></label>' +
      '<label class="ps-checkbox-label"><input id="ps-rule-per-order" type="checkbox" ' + (Number(rule.per_order) === 1 ? 'checked' : '') + '> ' + psEsc(psT('按订单收费，分摊到单件', 'Charged per order; allocate per unit', 'Biaya per pesanan; alokasikan per unit')) + '</label>' +
      '<label>' + psEsc(psT('每单商品数量', 'Items per order', 'Jumlah item per pesanan')) + '<input id="ps-rule-items" class="ps-input" type="number" min="1" step="1" value="' + psEsc(rule.items_per_order || 1) + '"></label>' +
      '<label>' + psEsc(psT('生效日期', 'Effective from', 'Mulai berlaku')) + '<input id="ps-rule-from" class="ps-input" type="date" value="' + psEsc(rule.effective_from || '') + '"></label>' +
      '<label>' + psEsc(psT('失效日期', 'Effective to', 'Berakhir')) + '<input id="ps-rule-to" class="ps-input" type="date" value="' + psEsc(rule.effective_to || '') + '"></label></div>';
    openModal(isEdit ? psT('编辑费用规则', 'Edit fee rule', 'Edit aturan biaya') : psT('新增费用规则', 'Add fee rule', 'Tambah aturan biaya'), html,
      '<button class="btn btn-secondary" onclick="closeModal()">' + psEsc(psT('取消', 'Cancel', 'Batal')) + '</button><button class="btn btn-primary" onclick="psSaveRule(' + psArg(fieldId) + ',' + psArg(ruleId || '') + ')">' + psEsc(psT('保存规则', 'Save rule', 'Simpan aturan')) + '</button>');
    psRuleScopeChanged();
    var scopeValueEl = document.getElementById('ps-rule-scope-value');
    if (scopeValueEl) scopeValueEl.value = rule.scope_value || '';
  }

  function psRuleScopeChanged() {
    var scope = document.getElementById('ps-rule-scope');
    var target = document.getElementById('ps-rule-scope-value');
    if (!scope || !target) return;
    var type = scope.value;
    target.innerHTML = '<option value="">—</option>';
    if (type === 'category') {
      (state.details.categories || []).forEach(function (c) {
        var value = c === '未分类' ? '__UNCATEGORIZED__' : c;
        target.insertAdjacentHTML('beforeend', '<option value="' + psEsc(value) + '">' + psEsc(c) + '</option>');
      });
    } else if (type === 'sku') {
      (state.rows || []).forEach(function (r) {
        target.insertAdjacentHTML('beforeend', '<option value="' + psEsc(r.sku_code) + '">' + psEsc(r.sku_code) + '</option>');
      });
    }
  }

  async function psSaveRule(fieldId, ruleId) {
    try {
      var body = {
        field_id: fieldId,
        scope_type: document.getElementById('ps-rule-scope').value,
        scope_value: document.getElementById('ps-rule-scope-value').value,
        calculation_type: document.getElementById('ps-rule-calc').value,
        basis: document.getElementById('ps-rule-basis').value,
        rate: document.getElementById('ps-rule-rate').value,
        fixed_amount: document.getElementById('ps-rule-fixed').value,
        cap_amount: document.getElementById('ps-rule-cap').value,
        floor_amount: document.getElementById('ps-rule-floor').value,
        formula: document.getElementById('ps-rule-formula').value,
        per_order: document.getElementById('ps-rule-per-order').checked,
        items_per_order: document.getElementById('ps-rule-items').value,
        effective_from: document.getElementById('ps-rule-from').value,
        effective_to: document.getElementById('ps-rule-to').value
      };
      var url = '/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/rules' + (ruleId ? '/' + encodeURIComponent(ruleId) : '');
      await api(url, ruleId ? 'PUT' : 'POST', body);
      closeModal();
      await psLoadScheme(state.scheme.id);
      state.tab = 'rules'; psRender();
      psNotify(psT('费用规则已保存', 'Fee rule saved', 'Aturan biaya disimpan'), 'success');
    } catch (error) { psNotify(error.message, 'danger'); }
  }

  async function psDeactivateRule(ruleId) {
    if (!confirm(psT('停用这条费用规则？', 'Disable this fee rule?', 'Nonaktifkan aturan ini?'))) return;
    try {
      await api('/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/rules/' + encodeURIComponent(ruleId), 'DELETE');
      await psLoadScheme(state.scheme.id);
      state.tab = 'rules'; psRender();
    } catch (error) { psNotify(error.message, 'danger'); }
  }

  function psEditValue(skuCode, fieldKey, value, valueType) {
    var label = fieldKey === 'FOB_RMB' ? 'FOB-RMB' : ((state.details.fields || []).find(function (f) { return f.field_key === fieldKey; }) || {}).field_name || fieldKey;
    var html = '<div class="ps-modal-grid"><label class="ps-form-wide">' + psEsc(psT('SKU', 'SKU', 'SKU')) + '<input class="ps-input" value="' + psEsc(skuCode) + '" disabled></label>' +
      '<label class="ps-form-wide">' + psEsc(label) + (valueType === 'percent' ? ' (%)' : '') + '<input id="ps-value-input" class="ps-input" type="number" step="0.0001" value="' + psEsc(value == null ? '' : value) + '"></label>' +
      '<label class="ps-checkbox-label"><input id="ps-value-na" type="checkbox"> ' + psEsc(psT('该 SKU 不适用此费用', 'Not applicable to this SKU', 'Tidak berlaku untuk SKU ini')) + '</label>' +
      '<label class="ps-checkbox-label"><input id="ps-value-reset" type="checkbox"> ' + psEsc(psT('恢复自动匹配（清除单 SKU 覆盖）', 'Reset to automatic rule matching', 'Kembali ke aturan otomatis')) + '</label></div>';
    openModal(psT('手动维护 SKU 价格', 'Manual SKU value', 'Nilai manual SKU'), html,
      '<button class="btn btn-secondary" onclick="closeModal()">' + psEsc(psT('取消', 'Cancel', 'Batal')) + '</button><button class="btn btn-primary" onclick="psSaveValue(' + psArg(skuCode) + ',' + psArg(fieldKey) + ')">' + psEsc(psT('保存', 'Save', 'Simpan')) + '</button>');
  }

  async function psSaveValue(skuCode, fieldKey) {
    try {
      var notApplicable = document.getElementById('ps-value-na').checked;
      var reset = document.getElementById('ps-value-reset').checked;
      var value = document.getElementById('ps-value-input').value;
      var valueUrl = '/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/values/' + encodeURIComponent(skuCode) + '/' + encodeURIComponent(fieldKey);
      if (reset) await api(valueUrl, 'DELETE');
      else await api(valueUrl, 'PUT', { value: value, is_applicable: !notApplicable });
      closeModal();
      await psLoadScheme(state.scheme.id);
      state.tab = 'details'; psRender();
      psNotify(psT('SKU 价格已更新', 'SKU pricing updated', 'Harga SKU diperbarui'), 'success');
    } catch (error) { psNotify(error.message, 'danger'); }
  }

  function psEditSku(skuCode) {
    var row = (state.rows || []).find(function (r) { return r.sku_code === skuCode; }) || {};
    var html = '<div class="ps-modal-actions"><button class="btn btn-secondary" onclick="psEditValue(' + psArg(skuCode) + ',\'FOB_RMB\',' + psArg(row.fob_rmb == null ? '' : row.fob_rmb) + ',\'currency\')">编辑 FOB-RMB</button>' +
      (state.details.fields || []).filter(function (f) { return Number(f.is_active) === 1; }).map(function (f) {
        var value = row.fields ? row.fields[f.field_key] : null;
        return '<button class="btn btn-secondary" onclick="psEditValue(' + psArg(skuCode) + ',' + psArg(f.field_key) + ',' + psArg(value == null ? '' : value) + ',' + psArg(f.value_type) + ')">' + psEsc(f.field_name) + '</button>';
      }).join('') + '</div>';
    openModal(psT('选择要维护的字段', 'Choose a field to edit', 'Pilih kolom untuk diedit'), html);
  }

  function psOpenFieldSettings() {
    var fields = (state.details.fields || []).filter(function (f) { return Number(f.is_active) === 1; }).slice().sort(function (a, b) { return Number(a.display_order || 0) - Number(b.display_order || 0); });
    var html = '<div class="ps-field-order-list">' + fields.map(function (f, index) {
      return '<div class="ps-field-order-item"><span>' + psEsc(f.field_name) + '</span><div><button class="btn btn-secondary btn-sm" onclick="psMoveField(' + psArg(f.id) + ',-1)" ' + (index === 0 ? 'disabled' : '') + '>↑</button><button class="btn btn-secondary btn-sm" onclick="psMoveField(' + psArg(f.id) + ',1)" ' + (index === fields.length - 1 ? 'disabled' : '') + '>↓</button></div></div>';
    }).join('') + '</div>';
    openModal(psT('字段显示顺序', 'Column order', 'Urutan kolom'), html, '<button class="btn btn-secondary" onclick="closeModal()">' + psEsc(psT('关闭', 'Close', 'Tutup')) + '</button>');
  }

  async function psMoveField(fieldId, direction) {
    var fields = (state.details.fields || []).filter(function (f) { return Number(f.is_active) === 1; }).slice().sort(function (a, b) { return Number(a.display_order || 0) - Number(b.display_order || 0); });
    var index = fields.findIndex(function (f) { return f.id === fieldId; });
    var targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= fields.length) return;
    var a = fields[index], b = fields[targetIndex];
    try {
      await api('/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/fields/' + encodeURIComponent(a.id), 'PUT', { display_order: Number(b.display_order || 0) });
      await api('/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/fields/' + encodeURIComponent(b.id), 'PUT', { display_order: Number(a.display_order || 0) });
      await psLoadScheme(state.scheme.id);
      psOpenFieldSettings();
    } catch (error) { psNotify(error.message, 'danger'); }
  }

  async function psSaveFormula() {
    try {
      var formula = document.getElementById('ps-srp-formula').value;
      var exchangeRate = document.getElementById('ps-srp-fx').value;
      await api('/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/formula', 'PUT', { formula: formula, exchange_rate: exchangeRate });
      await psLoadScheme(state.scheme.id);
      state.tab = 'formula'; psRender();
      psNotify(psT('SRP 公式已保存', 'SRP formula saved', 'Rumus SRP disimpan'), 'success');
    } catch (error) { psNotify(error.message, 'danger'); }
  }

  function psCopyVariable(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(function () { psNotify(psT('已复制变量', 'Variable copied', 'Variabel disalin'), 'success'); }).catch(function () { psNotify(value, 'info'); });
    else psNotify(value, 'info');
  }

  async function psSaveSettings() {
    try {
      var schemeId = state.scheme.id;
      var body = {
        country: document.getElementById('ps-set-country').value,
        brand: document.getElementById('ps-set-brand').value,
        platform: document.getElementById('ps-set-platform').value,
        store: document.getElementById('ps-set-store').value,
        currency: document.getElementById('ps-set-currency').value,
        exchange_rate: document.getElementById('ps-set-fx').value,
        effective_date: document.getElementById('ps-set-date').value,
        status: document.getElementById('ps-set-status').value,
        description: document.getElementById('ps-set-description').value
      };
      await api('/api/pricing/schemes/' + encodeURIComponent(schemeId), 'PUT', body);
      await psLoadScheme(schemeId);
      state.tab = 'settings'; psRender();
      psNotify(psT('价格方案设置已保存', 'Scheme settings saved', 'Pengaturan skema disimpan'), 'success');
    } catch (error) { psNotify(error.message, 'danger'); }
  }

  async function psRestoreVersion(versionNo) {
    if (!confirm(psT('确定恢复到版本 v', 'Restore version v', 'Pulihkan versi v') + versionNo + '？')) return;
    try {
      await api('/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/versions/' + versionNo + '/restore', 'POST', {});
      await psLoadScheme(state.scheme.id);
      state.tab = 'versions'; psRender();
      psNotify(psT('已恢复历史版本，并生成新的版本记录', 'Version restored and a new version created', 'Versi dipulihkan dan versi baru dibuat'), 'success');
    } catch (error) { psNotify(error.message, 'danger'); }
  }

  function psPickImport() {
    if (!psCanEdit()) return;
    var input = document.getElementById('ps-import-file');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file'; input.id = 'ps-import-file'; input.accept = '.xlsx,.xls,.csv'; input.style.display = 'none';
      input.addEventListener('change', function () { psImportExcel(input); });
      document.body.appendChild(input);
    }
    input.value = '';
    input.click();
  }

  async function psImportExcel(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    try {
      var buffer = await file.arrayBuffer();
      var workbook = XLSX.read(buffer, { type: 'array' });
      var sheet = workbook.Sheets[workbook.SheetNames[0]];
      var sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      if (!sourceRows.length) throw new Error(psT('Excel 没有可导入的数据', 'The Excel file contains no rows', 'File Excel kosong'));
      var fields = state.details.fields || [];
      var fieldByHeader = {};
      fields.forEach(function (f) {
        fieldByHeader[String(f.field_key).toUpperCase()] = f.field_key;
        fieldByHeader[psHeaderKey(f.field_name)] = f.field_key;
      });
      fieldByHeader.FOBRMB = 'FOB_RMB';
      fieldByHeader.LANDINGCOSTIDR = 'LANDING_COST_LOCAL';
      fieldByHeader.LANDINGCOSTLOCAL = 'LANDING_COST_LOCAL';
      fieldByHeader.PPH = 'PPH_IMPORT';
      fieldByHeader.PPH1 = 'PPH_SALES';
      var ignored = ['PRODUCTCATEGORY','CATEGORY','STOCK','STOCKQTY','INVENTORY','PRICESEGMENT','SRPIDR','SRPCNY','SRPPROFIT','PROFIT','PROFITRATE','MARGIN'];
      var unknown = new Set();
      var payload = [];
      sourceRows.forEach(function (sourceRow) {
        var values = {};
        var sku = '';
        Object.keys(sourceRow).forEach(function (header) {
          var key = psHeaderKey(header);
          if (key === 'SKU' || key === 'SKUCODE' || key === 'PRODUCTSKU') { sku = String(sourceRow[header] || '').trim(); return; }
          if (ignored.indexOf(key) >= 0 || key.indexOf('SRP') === 0) return;
          var fieldKey = fieldByHeader[key];
          if (!fieldKey && key.indexOf('COMMISSIONFEE') === 0) fieldKey = 'COMMISSION_FEE';
          if (!fieldKey && key.indexOf('PAYMENTFEE') === 0) fieldKey = 'PAYMENT_FEE';
          if (!fieldKey && key.indexOf('FREESHIPPINGXTRA') === 0) fieldKey = 'FREE_SHIPPING_XTRA';
          if (!fieldKey && key.indexOf('ORDERPROCESSINGFEE') === 0) fieldKey = 'ORDER_PROCESSING_FEE';
          if (!fieldKey && key.indexOf('LANDINGCOSTCNY') === 0) fieldKey = 'LANDING_COST_CNY';
          if (!fieldKey && key.indexOf('ADSCOST') === 0) fieldKey = 'ADS_COST';
          if (!fieldKey) { unknown.add(header); return; }
          var raw = String(sourceRow[header] == null ? '' : sourceRow[header]).trim();
          if (!raw) return;
          var num = Number(raw.replace(/[,，￥¥$IDRMYRTHB\s%]/gi, ''));
          if (Number.isFinite(num)) values[fieldKey] = num;
        });
        if (sku) payload.push({ sku_code: sku, values: values });
      });
      if (unknown.size) throw new Error(psT('Excel 存在未配置的字段，请先在「费用规则」中添加：', 'Unconfigured Excel columns. Add them in Fee rules first: ', 'Kolom Excel belum dikonfigurasi: ') + Array.from(unknown).join('、'));
      if (!payload.length) throw new Error(psT('没有识别到 SKU 列，请确认表头包含 SKU。', 'No SKU column found. Please include a SKU header.', 'Kolom SKU tidak ditemukan.'));
      var result = await api('/api/pricing/schemes/' + encodeURIComponent(state.scheme.id) + '/import', 'POST', { rows: payload });
      await psLoadScheme(state.scheme.id);
      state.tab = 'details'; psRender();
      psNotify(psT('导入完成：', 'Import complete: ', 'Impor selesai: ') + result.imported + psT(' 个 SKU', ' SKUs', ' SKU') + (result.skipped ? '；' + psT('跳过 ', ' skipped ', ' dilewati ') + result.skipped : ''), 'success');
    } catch (error) { psNotify(error.message, 'danger'); }
    if (input) input.value = '';
  }

  function psHeaderKey(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }

  function psExportExcel() {
    if (!state || !state.scheme) return;
    var fields = (state.details.fields || []).filter(function (f) { return Number(f.is_active) === 1; }).sort(function (a, b) { return Number(a.display_order || 0) - Number(b.display_order || 0); });
    var amountAllowed = psAmountAllowed();
    var rows = (state.rows || []).map(function (row) {
      var out = { SKU: row.sku_code, '产品类目': row.category || '未分类' };
      if (state.rowsResult && state.rowsResult.inventory_view_allowed) out['库存数量'] = row.stock_qty;
      if (amountAllowed) {
        out['FOB-RMB'] = row.fob_rmb;
        fields.forEach(function (f) { out[f.field_name] = row.fields ? row.fields[f.field_key] : null; });
        out['SRP-' + state.scheme.currency] = row.srp;
        out['利润-' + state.scheme.currency] = row.profit;
        out['利润率'] = row.profit_rate == null ? null : row.profit_rate / 100;
      }
      return out;
    });
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Pricing');
    XLSX.writeFile(wb, 'Pricing_' + String(state.scheme.country).replace(/\s+/g, '_') + '_' + String(state.scheme.brand).replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  window.renderPricingSystem = renderPricingSystem;
  window.psSetTab = psSetTab;
  window.psSetSearch = psSetSearch;
  window.psSetCategory = psSetCategory;
  window.psToggleGrouped = psToggleGrouped;
  window.psToggleCategory = psToggleCategory;
  window.psApplyFilters = psApplyFilters;
  window.psOpenNewScheme = psOpenNewScheme;
  window.psCreateScheme = psCreateScheme;
  window.psOpenFieldModal = psOpenFieldModal;
  window.psSaveField = psSaveField;
  window.psDeactivateField = psDeactivateField;
  window.psOpenRuleModal = psOpenRuleModal;
  window.psRuleScopeChanged = psRuleScopeChanged;
  window.psSaveRule = psSaveRule;
  window.psDeactivateRule = psDeactivateRule;
  window.psEditValue = psEditValue;
  window.psSaveValue = psSaveValue;
  window.psEditSku = psEditSku;
  window.psOpenFieldSettings = psOpenFieldSettings;
  window.psMoveField = psMoveField;
  window.psSaveFormula = psSaveFormula;
  window.psCopyVariable = psCopyVariable;
  window.psSaveSettings = psSaveSettings;
  window.psRestoreVersion = psRestoreVersion;
  window.psPickImport = psPickImport;
  window.psImportExcel = psImportExcel;
  window.psExportExcel = psExportExcel;
})();
