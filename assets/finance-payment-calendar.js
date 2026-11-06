'use strict';

// Finance Payment Calendar: calendar-only replacement for the old finance payment overview UI.
// It reads the existing payable ledger and creates manual items through the existing payable_items lifecycle.
let _financeCalendarState = {
  items: [], facets: {}, categories: [], payerEntities: [], currencies: [],
  currentDate: '', selectedDate: '', today: '', view: 'year',
  openFilter: '',
  filters: { payer: new Set(), country: new Set(), brand: new Set(), category: new Set(), status: new Set(), source: new Set(), currency: new Set() },
  loadingSeq: 0
};

function fcLang() {
  try {
    const value = typeof getLang === 'function' ? String(getLang() || '').toLowerCase() : 'zh';
    if (value.indexOf('en') === 0) return 'en';
    if (value.indexOf('id') === 0) return 'id';
  } catch (e) {}
  return 'zh';
}
function fcText(zh, en, id) {
  const lang = fcLang();
  return lang === 'en' ? en : (lang === 'id' ? id : zh);
}
function fcEsc(value) {
  if (typeof esc === 'function') return esc(value == null ? '' : String(value));
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fcJsArg(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '');
}
function fcMoney(value) {
  const number = Number(value || 0);
  if (typeof fmtMoney === 'function') return fmtMoney(number);
  return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fcTodayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fcParseISO(value) {
  const parts = String(value || '').slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return new Date();
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}
function fcLocalISO(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function fcAddDays(iso, amount) {
  const d = fcParseISO(iso);
  d.setDate(d.getDate() + amount);
  return fcLocalISO(d);
}
function fcAddMonths(iso, amount) {
  const d = fcParseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + amount);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return fcLocalISO(d);
}
function fcBuildMonthDates(iso) {
  const d = fcParseISO(iso);
  const first = new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0);
  first.setDate(first.getDate() - first.getDay());
  const dates = [];
  for (let i = 0; i < 42; i++) {
    const current = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i, 12, 0, 0, 0);
    dates.push(fcLocalISO(current));
  }
  return dates;
}
function fcBuildWeekDates(iso) {
  const d = fcParseISO(iso);
  d.setDate(d.getDate() - d.getDay());
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(fcAddDays(fcLocalISO(d), i));
  return dates;
}
function fcDateLabel(iso, includeYear) {
  const locale = fcLang() === 'en' ? 'en-US' : (fcLang() === 'id' ? 'id-ID' : 'zh-CN');
  const options = includeYear ? { year: 'numeric', month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric' };
  return fcParseISO(iso).toLocaleDateString(locale, options);
}
function fcMonthLabel(iso) {
  const locale = fcLang() === 'en' ? 'en-US' : (fcLang() === 'id' ? 'id-ID' : 'zh-CN');
  return fcParseISO(iso).toLocaleDateString(locale, { year: 'numeric', month: 'long' });
}
function fcWeekdayLabels() {
  if (fcLang() === 'en') return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (fcLang() === 'id') return ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  return ['日', '一', '二', '三', '四', '五', '六'];
}
function fcPayableAmount(item) {
  if (item && item.payable_amount != null) return Number(item.payable_amount || 0);
  return Number(item && item.payable_amount_minor || 0) / 100;
}
function fcRemainingAmount(item) {
  if (item && item.remaining_amount != null) return Math.max(0, Number(item.remaining_amount || 0));
  const settled = fcSettledAmount(item);
  return Math.max(0, fcPayableAmount(item) - settled);
}
function fcSettledAmount(item) {
  if (item && item.settled_amount != null) return Number(item.settled_amount || 0);
  return Number(item && item.paid_amount || 0) +
    Number(item && item.deduction_amount || 0) +
    Number(item && item.rounding_amount || 0);
}
function fcStatusKey(item, today) {
  if (fcRemainingAmount(item) <= 0.000001) return 'settled';
  const date = String(item && item.payable_date || '').slice(0, 10);
  if (date && date < String(today || fcTodayISO())) return 'overdue';
  if (String(item && item.lifecycle_status || '') === 'reserved') return 'reserved';
  if (Number(item && item.paid_amount || 0) > 0 || String(item && item.payment_state || '') === 'partial') return 'partial';
  return 'pending';
}
function fcStatusLabel(key) {
  const labels = {
    settled: [ '已结清', 'Settled', 'Lunas' ],
    overdue: [ '已逾期', 'Overdue', 'Terlambat' ],
    reserved: [ '付款申请中', 'Payment requested', 'Pengajuan pembayaran' ],
    partial: [ '部分付款', 'Partially paid', 'Dibayar sebagian' ],
    pending: [ '待付款', 'Pending', 'Belum dibayar' ]
  };
  const item = labels[key] || labels.pending;
  return fcText(item[0], item[1], item[2]);
}
function fcStatusClass(key) {
  return key === 'settled' ? 'is-settled' : (key === 'overdue' ? 'is-overdue' : (key === 'reserved' ? 'is-reserved' : (key === 'partial' ? 'is-partial' : 'is-pending')));
}
function fcItemTitle(item) {
  return String(item && (item.payee_name_snapshot || item.supplier_name || item.payee_name || item.fee_no) || fcText('未命名应付项', 'Unnamed payable', 'Hutang tanpa nama'));
}
function fcSourceLabel(value) {
  const labels = { pi: ['PI', 'PI', 'PI'], ci: ['CI', 'CI', 'CI'], historical_ci: ['历史 CI', 'Historical CI', 'CI historis'], logistics: ['物流批次', 'Logistics batch', 'Batch logistik'], manual: ['手动录入', 'Manual entry', 'Input manual'] };
  const item = labels[String(value || '')];
  return item ? fcText(item[0], item[1], item[2]) : (value || '—');
}
function fcCategoryLabel(value) {
  const known = {
    goods: ['采购货款', 'Goods', 'Barang'],
    warehouse_arrival: ['物流 / 到仓', 'Logistics / warehouse', 'Logistik / gudang'],
    customs_duty: ['关税', 'Customs duty', 'Bea masuk'],
    inspection_fee: ['商检 / 检测', 'Inspection', 'Inspeksi'],
    other: ['其他费用', 'Other expenses', 'Biaya lain']
  };
  const item = known[String(value || '')];
  if (item) return fcText(item[0], item[1], item[2]);
  const category = (_financeCalendarState.categories || []).find(c => String(c.code || '') === String(value || ''));
  return category ? category.name : (value || fcText('未分类', 'Uncategorized', 'Belum dikategorikan'));
}
function fcMonthlySummary(items, monthIso, today) {
  const monthKey = String(monthIso || fcTodayISO()).slice(0, 7);
  const totals = Object.create(null);
  const overdue = Object.create(null);
  const monthRows = [];
  const overdueRows = [];
  (items || []).forEach(item => {
    const date = String(item && item.payable_date || '').slice(0, 10);
    const currency = String(item && item.currency || 'UNKNOWN').toUpperCase();
    const remaining = fcRemainingAmount(item);
    if (date.slice(0, 7) === monthKey) {
      monthRows.push(item);
      if (!totals[currency]) totals[currency] = { gross: 0, settled: 0, outstanding: 0, count: 0 };
      totals[currency].gross += fcPayableAmount(item);
      totals[currency].settled += fcSettledAmount(item);
      totals[currency].outstanding += remaining;
      totals[currency].count++;
    }
    if (date && date < String(today || fcTodayISO()) && remaining > 0.000001) {
      overdueRows.push(item);
      overdue[currency] = (overdue[currency] || 0) + remaining;
    }
  });
  return { monthRows, totals, overdue, overdueRows };
}
function fcYearlySummary(items, yearIso, today) {
  const yearKey = String(yearIso || fcTodayISO()).slice(0, 4);
  const totals = Object.create(null);
  const overdue = Object.create(null);
  const months = Array.from({ length: 12 }, () => ({
    totals: Object.create(null), overdue: Object.create(null), count: 0
  }));
  const overdueRows = [];
  (items || []).forEach(item => {
    const date = String(item && item.payable_date || '').slice(0, 10);
    const currency = String(item && item.currency || 'UNKNOWN').toUpperCase();
    const remaining = fcRemainingAmount(item);
    if (date && date.slice(0, 4) === yearKey) {
      const monthIndex = Number(date.slice(5, 7)) - 1;
      if (monthIndex >= 0 && monthIndex < 12) {
        const month = months[monthIndex];
        if (!month.totals[currency]) month.totals[currency] = { gross: 0, settled: 0, outstanding: 0, count: 0 };
        if (!totals[currency]) totals[currency] = { gross: 0, settled: 0, outstanding: 0, count: 0 };
        const amount = fcPayableAmount(item);
        const settled = fcSettledAmount(item);
        month.totals[currency].gross += amount;
        month.totals[currency].settled += settled;
        month.totals[currency].outstanding += remaining;
        month.totals[currency].count++;
        month.count++;
        totals[currency].gross += amount;
        totals[currency].settled += settled;
        totals[currency].outstanding += remaining;
        totals[currency].count++;
        if (date < String(today || fcTodayISO()) && remaining > 0.000001) {
          month.overdue[currency] = (month.overdue[currency] || 0) + remaining;
        }
      }
    }
    // Keep the existing overdue-card meaning: all past-due, unsettled items, regardless of selected year.
    if (date && date < String(today || fcTodayISO()) && remaining > 0.000001) {
      overdue[currency] = (overdue[currency] || 0) + remaining;
      overdueRows.push(item);
    }
  });
  return { yearKey, totals, overdue, overdueRows, months };
}
function fcGetFilterOptions() {
  const data = _financeCalendarState;
  const items = data.items || [];
  const countries = (data.facets && data.facets.countries || []).map(x => ({ value: x.code, label: x.name || x.code }));
  const brands = (data.facets && data.facets.brands || []).map(x => ({ value: x, label: x }));
  const categories = (data.categories || []).map(x => ({ value: x.code, label: x.name || x.code }));
  const payers = (data.payerEntities || []).map(x => ({ value: x.entity_key, label: x.entity_name || x.entity_key }));
  const sources = [
    { value: 'pi', label: 'PI' }, { value: 'ci', label: 'CI' },
    { value: 'historical_ci', label: fcText('历史 CI', 'Historical CI', 'CI historis') },
    { value: 'logistics', label: fcText('物流批次', 'Logistics batch', 'Batch logistik') },
    { value: 'manual', label: fcText('手动录入', 'Manual entry', 'Input manual') }
  ];
  const statuses = ['pending', 'partial', 'reserved', 'settled', 'overdue'].map(x => ({ value: x, label: fcStatusLabel(x) }));
  const currencySet = new Set((data.currencies || []).filter(x => x.status !== 'inactive').map(x => String(x.code || '').toUpperCase()));
  items.forEach(x => { if (x.currency) currencySet.add(String(x.currency).toUpperCase()); });
  const currencies = [...currencySet].sort().map(x => ({ value: x, label: x }));
  const knownPayers = new Set(payers.map(x => x.value));
  items.forEach(x => {
    const key = String(x.payer_entity_key || '').trim();
    if (key && !knownPayers.has(key)) payers.push({ value: key, label: x.payer_name_snapshot || key });
  });
  const knownCategories = new Set(categories.map(x => x.value));
  items.forEach(x => {
    const key = String(x.category_code || '').trim();
    if (key && !knownCategories.has(key)) categories.push({ value: key, label: fcCategoryLabel(key) });
  });
  return { payer: payers, country: countries, brand: brands, category: categories, source: sources, status: statuses, currency: currencies };
}
function fcFilterValue(item, key) {
  if (key === 'payer') return String(item.payer_entity_key || '');
  if (key === 'country') return String(item.country_code || item.country || '');
  if (key === 'brand') return String(item.brand || '');
  if (key === 'category') return String(item.category_code || '');
  if (key === 'source') return String(item.source_type || '');
  if (key === 'status') return fcStatusKey(item, _financeCalendarState.today);
  if (key === 'currency') return String(item.currency || '').toUpperCase();
  return '';
}
function fcFilteredItems() {
  const state = _financeCalendarState;
  return (state.items || []).filter(item => {
    for (const key of Object.keys(state.filters)) {
      const selected = state.filters[key];
      if (selected && selected.size && !selected.has(fcFilterValue(item, key))) return false;
    }
    return true;
  });
}
function fcCurrencyLines(values) {
  const keys = Object.keys(values || {}).filter(k => Number(values[k] || 0) !== 0).sort();
  if (!keys.length) return '<span class="fcal-no-value">—</span>';
  return keys.map(currency => '<div class="fcal-currency-line"><span>' + fcEsc(currency) + '</span><strong>' + fcEsc(fcMoney(values[currency])) + '</strong></div>').join('');
}
function fcSummaryMap(summary, key) {
  const out = Object.create(null);
  Object.keys(summary.totals || {}).forEach(currency => { out[currency] = Number(summary.totals[currency][key] || 0); });
  return out;
}
function fcSummaryCard(label, values, note, tone) {
  return '<section class="fcal-stat-card ' + (tone || '') + '">' +
    '<div class="fcal-stat-label">' + fcEsc(label) + '</div>' +
    '<div class="fcal-stat-values">' + fcCurrencyLines(values) + '</div>' +
    '<div class="fcal-stat-note">' + fcEsc(note || '') + '</div></section>';
}
function fcFilterGroup(key, label, options) {
  const state = _financeCalendarState;
  const selected = state.filters[key] || new Set();
  const open = state.openFilter === key;
  const selectedOptions = (options || []).filter(option => selected.has(String(option.value)));
  const current = !selected.size
    ? fcText('全部', 'All', 'Semua')
    : (selected.size === 1
      ? (selectedOptions[0] ? selectedOptions[0].label : String([...selected][0]))
      : fcText('已选 ' + selected.size + ' 项', selected.size + ' selected', selected.size + ' dipilih'));
  const icons = { country: '◎', brand: '◇', currency: '▤', status: '◉', category: '◆' };
  const optionsHtml = (options || []).map(option => {
    const checked = selected.has(String(option.value));
    return '<label class="fcal-filter-option"><input type="checkbox" value="' + fcEsc(option.value) + '" ' + (checked ? 'checked' : '') +
      ' onchange="fcToggleFilterValue(\'' + fcJsArg(key) + '\',this.value,this.checked)">' +
      '<span>' + fcEsc(option.label) + '</span></label>';
  }).join('');
  return '<div class="fcal-filter" data-filter="' + fcEsc(key) + '">' +
    '<button type="button" class="fcal-filter-trigger" aria-expanded="' + (open ? 'true' : 'false') + '" onclick="fcToggleFilter(\'' + fcJsArg(key) + '\')">' +
    '<span class="fcal-filter-label"><span class="fcal-filter-icon">' + (icons[key] || '◦') + '</span>' + fcEsc(label) + '</span>' +
    '<span class="fcal-filter-value">' + fcEsc(current) + '</span><span class="fcal-filter-caret">⌄</span></button>' +
    (open ? '<div class="fcal-filter-panel"><div class="fcal-filter-panel-head"><strong>' + fcEsc(label) + '</strong>' +
      '<button type="button" onclick="fcClearOneFilter(\'' + fcJsArg(key) + '\')">' + fcEsc(fcText('清空', 'Clear', 'Hapus')) + '</button></div>' +
      '<div class="fcal-filter-options">' + (optionsHtml || '<div class="fcal-filter-empty">' + fcEsc(fcText('暂无选项', 'No options', 'Tidak ada opsi')) + '</div>') + '</div></div>' : '') +
    '</div>';
}
function fcRenderFilterBar() {
  const options = fcGetFilterOptions();
  return '<div class="fcal-filter-bar">' +
    fcFilterGroup('country', fcText('国家', 'Country', 'Negara'), options.country) +
    fcFilterGroup('brand', fcText('品牌', 'Brand', 'Merek'), options.brand) +
    fcFilterGroup('currency', fcText('币种', 'Currency', 'Mata uang'), options.currency) +
    fcFilterGroup('status', fcText('付款状态', 'Payment status', 'Status pembayaran'), options.status) +
    fcFilterGroup('category', fcText('费用类型', 'Expense type', 'Jenis biaya'), options.category) +
    '</div>';
}
function fcToggleFilter(key) {
  _financeCalendarState.openFilter = _financeCalendarState.openFilter === key ? '' : key;
  fcRenderPage();
}
function fcToggleFilterValue(key, value, checked) {
  const selected = _financeCalendarState.filters[key];
  if (!selected) return;
  if (checked) selected.add(String(value)); else selected.delete(String(value));
  _financeCalendarState.openFilter = key;
  fcRenderPage();
}
function fcClearOneFilter(key) {
  if (_financeCalendarState.filters[key]) _financeCalendarState.filters[key].clear();
  _financeCalendarState.openFilter = key;
  fcRenderPage();
}
function fcClearAllFilters() {
  Object.keys(_financeCalendarState.filters).forEach(key => _financeCalendarState.filters[key].clear());
  _financeCalendarState.keyword = '';
  _financeCalendarState.openFilter = '';
  fcRenderPage();
}
function fcEventHTML(item) {
  const key = fcStatusKey(item, _financeCalendarState.today);
  const amount = fcPayableAmount(item);
  const remaining = fcRemainingAmount(item);
  const currency = String(item.currency || '');
  const title = fcItemTitle(item);
  const partial = key === 'partial' ? '<span class="fcal-event-remaining">' + fcEsc(fcText('未付', 'Remaining', 'Sisa')) + ' ' + fcEsc(currency) + ' ' + fcEsc(fcMoney(remaining)) + '</span>' : '';
  return '<button type="button" class="fcal-event ' + fcStatusClass(key) + '" title="' + fcEsc(title + ' · ' + currency + ' ' + fcMoney(amount)) +
    '" onclick="event.stopPropagation();fcOpenDetail(\'' + fcJsArg(item.id) + '\')"><span class="fcal-event-title">' + fcEsc(title) +
    '</span><span class="fcal-event-amount">' + fcEsc(currency) + ' ' + fcEsc(fcMoney(amount)) + '</span>' +
    '<span class="fcal-event-status">' + fcEsc(fcStatusLabel(key)) + '</span>' + partial + '</button>';
}
function fcItemsOnDate(items, date) {
  return (items || []).filter(item => String(item.payable_date || '').slice(0, 10) === date)
    .sort((a, b) => String(a.payee_name_snapshot || a.fee_no || '').localeCompare(String(b.payee_name_snapshot || b.fee_no || ''), undefined, { numeric: true, sensitivity: 'base' }));
}
function fcRenderEvents(items, date, limit) {
  const rows = fcItemsOnDate(items, date);
  const max = limit || 3;
  let html = rows.slice(0, max).map(fcEventHTML).join('');
  if (rows.length > max) {
    html += '<button type="button" class="fcal-more-events" onclick="fcSetDate(\'' + date + '\',\'day\')">' +
      '+' + (rows.length - max) + ' ' + fcEsc(fcText('更多', 'more', 'lainnya')) + '</button>';
  }
  return html;
}
function fcRenderMonthGrid(items) {
  const state = _financeCalendarState;
  const dates = fcBuildMonthDates(state.currentDate);
  const weekdays = fcWeekdayLabels();
  let html = '<div class="fcal-calendar fcal-month-calendar"><div class="fcal-weekday-row">';
  weekdays.forEach(day => { html += '<div>' + fcEsc(day) + '</div>'; });
  html += '</div><div class="fcal-month-grid">';
  dates.forEach(date => {
    const inMonth = date.slice(0, 7) === state.currentDate.slice(0, 7);
    const today = date === state.today;
    html += '<div class="fcal-day-cell ' + (!inMonth ? 'is-outside ' : '') + (today ? 'is-today ' : '') +
      '" onclick="fcOpenCreate(\'' + date + '\')"><div class="fcal-day-cell-head"><span class="fcal-day-number ' +
      (today ? 'is-today-number' : '') + '">' + Number(date.slice(8, 10)) + '</span><button type="button" class="fcal-day-add" title="' +
      fcEsc(fcText('新增应付项', 'Add payable', 'Tambah hutang')) + '" onclick="event.stopPropagation();fcOpenCreate(\'' + date + '\')">＋</button></div>' +
      '<div class="fcal-day-events">' + fcRenderEvents(items, date, 3) + '</div></div>';
  });
  html += '</div></div>';
  return html;
}
function fcRenderWeekGrid(items) {
  const state = _financeCalendarState;
  const dates = fcBuildWeekDates(state.currentDate);
  const weekdays = fcWeekdayLabels();
  let html = '<div class="fcal-calendar fcal-week-calendar"><div class="fcal-weekday-row">';
  dates.forEach((date, i) => {
    html += '<div><span>' + fcEsc(weekdays[i]) + '</span><strong class="' + (date === state.today ? 'is-today-number' : '') + '">' +
      Number(date.slice(8, 10)) + '</strong></div>';
  });
  html += '</div><div class="fcal-week-grid">';
  dates.forEach(date => {
    html += '<div class="fcal-week-cell" onclick="fcOpenCreate(\'' + date + '\')"><div class="fcal-week-add">＋</div>' +
      fcRenderEvents(items, date, 8) + '</div>';
  });
  html += '</div></div>';
  return html;
}
function fcRenderDayView(items) {
  const state = _financeCalendarState;
  const date = state.selectedDate || state.currentDate;
  const rows = fcItemsOnDate(items, date);
  let html = '<section class="fcal-day-view"><div class="fcal-day-view-head"><div><div class="fcal-day-view-date">' +
    fcEsc(fcDateLabel(date, true)) + '</div><div class="fcal-day-view-count">' + rows.length + ' ' +
    fcEsc(fcText('笔应付事项', 'payable items', 'item hutang')) + '</div></div>' +
    '<button type="button" class="fcal-primary-button" onclick="fcOpenCreate(\'' + date + '\')">＋ ' +
    fcEsc(fcText('新增应付项', 'Add payable', 'Tambah hutang')) + '</button></div>';
  if (!rows.length) html += '<div class="fcal-empty-day">' + fcEsc(fcText('这一天没有付款安排，点击右上角新增应付项。', 'No payments scheduled. Add a payable item for this date.', 'Tidak ada pembayaran terjadwal. Tambahkan item hutang.')) + '</div>';
  else html += '<div class="fcal-day-event-list">' + rows.map(fcEventHTML).join('') + '</div>';
  html += '</section>';
  return html;
}
function fcYearMonthLabel(year, monthIndex) {
  const iso = String(year) + '-' + String(monthIndex + 1).padStart(2, '0') + '-01';
  const locale = fcLang() === 'en' ? 'en-US' : (fcLang() === 'id' ? 'id-ID' : 'zh-CN');
  return fcParseISO(iso).toLocaleDateString(locale, { month: 'long' });
}
function fcRenderYearGrid(items) {
  const state = _financeCalendarState;
  const summary = fcYearlySummary(items, state.currentDate, state.today);
  const year = summary.yearKey;
  const selectedMonth = Number(String(state.currentDate).slice(5, 7)) - 1;
  let html = '<section class="fcal-year-view"><div class="fcal-year-view-note">' +
    fcEsc(fcText('全年付款分布 · 点击月份进入月视图 · 各币种独立汇总，不跨币种相加', 'Annual payment overview · Select a month to open its calendar · Currencies are kept separate', 'Ringkasan pembayaran tahunan · Pilih bulan untuk membuka kalender · Mata uang ditampilkan terpisah')) +
    '</div><div class="fcal-year-grid">';
  summary.months.forEach((month, index) => {
    const currencies = Object.keys(month.totals || {}).sort();
    let detail = '';
    currencies.forEach(currency => {
      const values = month.totals[currency];
      const pct = values.gross > 0 ? Math.max(0, Math.min(100, Math.round(values.settled / values.gross * 100))) : 0;
      const overdueAmount = Number(month.overdue[currency] || 0);
      detail += '<div class="fcal-year-currency"><div class="fcal-year-currency-head"><strong>' + fcEsc(currency) +
        '</strong><span>' + values.count + ' ' + fcEsc(fcText('笔', 'items', 'item')) + '</span></div>' +
        '<div class="fcal-year-currency-line"><span>' + fcEsc(fcText('应付', 'Payable', 'Tagihan')) + '</span><strong>' + fcEsc(fcMoney(values.gross)) + '</strong></div>' +
        '<div class="fcal-year-currency-line"><span>' + fcEsc(fcText('已结清', 'Settled', 'Lunas')) + '</span><strong>' + fcEsc(fcMoney(values.settled)) + '</strong></div>' +
        '<div class="fcal-year-currency-line is-outstanding"><span>' + fcEsc(fcText('待付款', 'Outstanding', 'Belum dibayar')) + '</span><strong>' + fcEsc(fcMoney(values.outstanding)) + '</strong></div>' +
        '<div class="fcal-year-progress"><i style="width:' + pct + '%"></i></div>' +
        (overdueAmount > 0.000001 ? '<div class="fcal-year-overdue">' + fcEsc(fcText('逾期未付', 'Overdue', 'Terlambat')) + ' · ' + fcEsc(fcMoney(overdueAmount)) + '</div>' : '') +
        '</div>';
    });
    if (!detail) detail = '<div class="fcal-year-empty">' + fcEsc(fcText('暂无应付安排', 'No scheduled payables', 'Tidak ada jadwal pembayaran')) + '</div>';
    html += '<button type="button" class="fcal-year-month-card ' + (index === selectedMonth ? 'is-selected' : '') +
      '" onclick="fcSetYearMonth(' + index + ')"><div class="fcal-year-month-head"><strong>' +
      fcEsc(fcYearMonthLabel(year, index)) + '</strong><span>' + month.count + ' ' + fcEsc(fcText('笔', 'items', 'item')) +
      '</span></div>' + detail + '<div class="fcal-year-open-hint">' +
      fcEsc(fcText('查看本月日历', 'Open monthly calendar', 'Buka kalender bulanan')) + ' →</div></button>';
  });
  html += '</div></section>';
  return html;
}
function fcRenderCalendar(items) {
  if (_financeCalendarState.view === 'day') return fcRenderDayView(items);
  if (_financeCalendarState.view === 'week') return fcRenderWeekGrid(items);
  if (_financeCalendarState.view === 'year') return fcRenderYearGrid(items);
  return fcRenderMonthGrid(items);
}
function fcRenderToolbar() {
  const state = _financeCalendarState;
  let title = fcMonthLabel(state.currentDate);
  if (state.view === 'year') {
    const year = fcParseISO(state.currentDate).getFullYear();
    title = fcText(String(year) + '年', String(year), String(year));
  } else if (state.view === 'week') {
    const week = fcBuildWeekDates(state.currentDate);
    title = fcDateLabel(week[0], false) + ' – ' + fcDateLabel(week[6], true);
  } else if (state.view === 'day') title = fcDateLabel(state.selectedDate || state.currentDate, true);
  return '<div class="fcal-toolbar"><div class="fcal-toolbar-left">' +
    '<button type="button" class="fcal-nav-button" aria-label="Previous" onclick="fcNavigate(-1)">‹</button>' +
    '<strong class="fcal-toolbar-title">' + fcEsc(title) + '</strong>' +
    '<button type="button" class="fcal-nav-button" aria-label="Next" onclick="fcNavigate(1)">›</button></div>' +
    '<div class="fcal-toolbar-right"><div class="fcal-view-switch">' +
    '<button type="button" class="' + (state.view === 'day' ? 'is-active' : '') + '" onclick="fcSetView(\'day\')">' + fcEsc(fcText('日', 'Day', 'Hari')) + '</button>' +
    '<button type="button" class="' + (state.view === 'week' ? 'is-active' : '') + '" onclick="fcSetView(\'week\')">' + fcEsc(fcText('周', 'Week', 'Minggu')) + '</button>' +
    '<button type="button" class="' + (state.view === 'month' ? 'is-active' : '') + '" onclick="fcSetView(\'month\')">' + fcEsc(fcText('月', 'Month', 'Bulan')) + '</button>' +
    '<button type="button" class="' + (state.view === 'year' ? 'is-active' : '') + '" onclick="fcSetView(\'year\')">' + fcEsc(fcText('年', 'Year', 'Tahun')) + '</button>' +
    '</div></div></div>';
}
function fcRenderStats(items) {
  const state = _financeCalendarState;
  if (state.view === 'year') {
    const annual = fcYearlySummary(items, state.currentDate, state.today);
    return '<div class="fcal-stats-grid">' +
      fcSummaryCard(fcText('本年应付', 'Payables this year', 'Tagihan tahun ini'), fcSummaryMap(annual, 'gross'), fcText('按所选年度的应付日期归属', 'Grouped by due date in the selected year', 'Dikelompokkan berdasarkan tanggal jatuh tempo pada tahun terpilih'), '') +
      fcSummaryCard(fcText('本年已结清', 'Settled this year', 'Lunas tahun ini'), fcSummaryMap(annual, 'settled'), fcText('所选年度应付项累计结清金额', 'Settled amount for payables due in the selected year', 'Jumlah lunas untuk tagihan pada tahun terpilih'), 'is-green') +
      fcSummaryCard(fcText('本年待付款', 'Outstanding this year', 'Belum dibayar tahun ini'), fcSummaryMap(annual, 'outstanding'), fcText('所选年度应付项剩余未结金额', 'Remaining balance for payables due in the selected year', 'Sisa tagihan pada tahun terpilih'), 'is-blue') +
      fcSummaryCard(fcText('逾期未付', 'Overdue outstanding', 'Tunggakan'), annual.overdue, fcText('所有已逾期且尚未结清的应付项，不限年度', 'All past-due items with an outstanding balance, across all years', 'Semua tagihan lewat jatuh tempo yang belum lunas, semua tahun'), 'is-red') +
      '</div><div class="fcal-summary-note">' + fcEsc(fcText('金额按原币种分别汇总，不跨币种直接相加。年度应付、已结清和待付款按应付日期归属年度。', 'Amounts are grouped by original currency. Payables, settled and outstanding totals are grouped by due year.', 'Jumlah dikelompokkan menurut mata uang asli. Total tagihan, lunas, dan belum dibayar mengikuti tahun tanggal jatuh tempo.')) + '</div>';
  }
  const summary = fcMonthlySummary(items, state.currentDate, state.today);
  const overdueMap = summary.overdue;
  return '<div class="fcal-stats-grid">' +
    fcSummaryCard(fcText('本月应付', 'Payables this month', 'Tagihan bulan ini'), fcSummaryMap(summary, 'gross'), fcText('按应付日期归属月份', 'Grouped by due date', 'Dikelompokkan berdasarkan tanggal jatuh tempo'), '') +
    fcSummaryCard(fcText('本月已结清', 'Settled this month', 'Lunas bulan ini'), fcSummaryMap(summary, 'settled'), fcText('现金支付 + 抵扣 + 抹零', 'Cash paid + deductions + rounding', 'Pembayaran + potongan + pembulatan'), 'is-green') +
    fcSummaryCard(fcText('本月待付款', 'Outstanding this month', 'Belum dibayar bulan ini'), fcSummaryMap(summary, 'outstanding'), fcText('本月应付项剩余未结金额', 'Remaining balance for this month', 'Sisa tagihan bulan ini'), 'is-blue') +
    fcSummaryCard(fcText('逾期未付', 'Overdue outstanding', 'Tunggakan'), overdueMap, fcText('所有已逾期且尚未结清的应付项', 'All past-due items with an outstanding balance', 'Semua item lewat jatuh tempo yang belum lunas'), 'is-red') +
    '</div><div class="fcal-summary-note">' + fcEsc(fcText('金额按原币种分别汇总，不跨币种直接相加。已结清包含现金支付、抵扣和抹零。', 'Amounts are grouped by original currency. Settled includes cash payments, deductions and rounding.', 'Jumlah dikelompokkan menurut mata uang asli. Lunas mencakup pembayaran, potongan, dan pembulatan.')) + '</div>';
}
function fcRenderMain(items) {
  return '<main class="fcal-main"><div class="fcal-main-toolbar">' + fcRenderToolbar() + '</div>' +
    '<div class="fcal-calendar-wrap">' + fcRenderCalendar(items) + '</div>' +
    '<div class="fcal-legend"><span><i class="is-pending"></i>' + fcEsc(fcStatusLabel('pending')) + '</span>' +
    '<span><i class="is-partial"></i>' + fcEsc(fcStatusLabel('partial')) + '</span>' +
    '<span><i class="is-reserved"></i>' + fcEsc(fcStatusLabel('reserved')) + '</span>' +
    '<span><i class="is-settled"></i>' + fcEsc(fcStatusLabel('settled')) + '</span>' +
    '<span><i class="is-overdue"></i>' + fcEsc(fcStatusLabel('overdue')) + '</span></div></main>';
}
function fcCalendarStyles() {
  return '<style>' +
    '.fcal-page{width:100%;color:var(--text-primary,#1d1d1f);font-size:13px}' +
    '.fcal-page *{box-sizing:border-box}.fcal-page button,.fcal-page input,.fcal-page select{font:inherit}' +
    '.fcal-page button{cursor:pointer}.fcal-page button:focus-visible,.fcal-page input:focus-visible,.fcal-page select:focus-visible{outline:2px solid rgba(55,120,210,.55);outline-offset:2px}' +
    '.fcal-page .fcal-page-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:0 0 15px}' +
    '.fcal-page .fcal-page-title{font-size:21px;font-weight:650;letter-spacing:-.35px;margin:0}.fcal-page .fcal-page-subtitle{font-size:12px;color:var(--text-secondary,#777);margin-top:5px}' +
    '.fcal-primary-button{border:1px solid #247a3e;background:#27813f;color:#fff;border-radius:9px;padding:9px 13px;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.06)}.fcal-primary-button:hover{background:#206f35}' +
    '.fcal-stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin-bottom:6px}' +
    '.fcal-stat-card{min-width:0;border:1px solid var(--border,#e5e5e8);background:var(--bg-card,#fff);border-radius:12px;padding:13px 15px;min-height:105px}' +
    '.fcal-stat-label{font-size:12px;color:var(--text-secondary,#666);margin-bottom:8px}.fcal-stat-values{font-size:15px;font-weight:650;line-height:1.55;font-variant-numeric:tabular-nums}' +
    '.fcal-currency-line{display:flex;justify-content:space-between;gap:10px}.fcal-currency-line span{font-size:11px;color:var(--text-secondary,#777);font-weight:500}.fcal-currency-line strong{font-size:14px}' +
    '.fcal-stat-note{font-size:10px;color:var(--text-secondary,#888);margin-top:6px;line-height:1.45}.fcal-stat-card.is-green{border-top:2px solid #3b9a63}.fcal-stat-card.is-blue{border-top:2px solid #4b83d6}.fcal-stat-card.is-red{border-top:2px solid #d65a5a}' +
    '.fcal-summary-note{font-size:11px;color:var(--text-secondary,#888);margin:7px 0 14px}' +
    '.fcal-layout{display:grid;grid-template-columns:226px minmax(0,1fr);gap:13px;align-items:start}' +
    '.fcal-sidebar{display:flex;flex-direction:column;gap:10px;min-width:0}.fcal-sidebar-card{border:1px solid var(--border,#e5e5e8);background:var(--bg-card,#fff);border-radius:12px;padding:12px;min-width:0}' +
    '.fcal-mini-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:12px}.fcal-mini-head>div{display:flex;gap:3px}.fcal-mini-head button{width:25px;height:25px;border:0;background:transparent;border-radius:6px;color:var(--text-secondary,#666);font-size:18px}.fcal-mini-head button:hover{background:var(--bg-hover,#f1f4f8)}' +
    '.fcal-mini-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.fcal-mini-weekday{text-align:center;color:var(--text-secondary,#888);font-size:10px;padding:3px 0}.fcal-mini-day{border:0;background:transparent;border-radius:50%;height:25px;width:25px;justify-self:center;font-size:10px;color:var(--text-primary,#333);padding:0}.fcal-mini-day:hover{background:var(--bg-hover,#f0f2f5)}.fcal-mini-day.is-muted{color:#b5b8bf}.fcal-mini-day.is-today{box-shadow:inset 0 0 0 1px #3678d5;color:#3678d5;font-weight:700}.fcal-mini-day.is-selected{background:#3478d5;color:#fff!important;box-shadow:none}' +
    '.fcal-search-row{display:flex;align-items:center;gap:5px}.fcal-search-row input{width:100%;min-width:0;border:1px solid var(--border,#ddd);background:var(--bg-primary,#fff);color:var(--text-primary,#222);border-radius:8px;padding:8px 9px;font-size:11px}.fcal-search-row button{flex:0 0 33px;height:33px;border:1px solid var(--border,#ddd);background:var(--bg-secondary,#f6f7f8);border-radius:8px;color:var(--text-secondary,#666);font-size:18px}' +
    '.fcal-undated-button{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin-top:9px;padding:8px 9px;border:1px solid var(--border,#e5e5e8);background:var(--bg-secondary,#f8f9fa);border-radius:8px;color:var(--text-primary,#333);font-size:11px;text-align:left}.fcal-undated-button strong{color:#3678d5;font-size:11px}' +
    '.fcal-filter-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.fcal-filter-section-head strong{font-size:12px}.fcal-filter-section-head button,.fcal-filter-panel-head button{border:0;background:transparent;color:#3478d5;font-size:11px;padding:3px}' +
    '.fcal-filter{position:relative;margin-top:6px}.fcal-filter-trigger{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;border:1px solid var(--border,#e1e2e5);border-radius:8px;background:var(--bg-card,#fff);color:var(--text-primary,#333);font-size:11px;text-align:left}.fcal-filter-trigger[aria-expanded=true]{border-color:#8eacd8}.fcal-filter-caret{color:var(--text-secondary,#888);font-size:13px}' +
    '.fcal-filter-panel{position:absolute;top:calc(100% + 4px);left:0;width:260px;max-width:min(300px,calc(100vw - 35px));z-index:30;background:var(--bg-card,#fff);border:1px solid var(--border,#ddd);border-radius:10px;box-shadow:0 9px 24px rgba(0,0,0,.14);padding:9px}.fcal-filter-panel-head{display:flex;align-items:center;justify-content:space-between;padding:1px 3px 7px;font-size:11px}.fcal-filter-options{max-height:220px;overflow:auto}.fcal-filter-option{display:flex;align-items:center;gap:8px;padding:7px 5px;border-radius:6px;font-size:11px;cursor:pointer}.fcal-filter-option:hover{background:var(--bg-hover,#f2f4f7)}.fcal-filter-option input{accent-color:#3478d5}.fcal-filter-empty{padding:12px 5px;color:var(--text-secondary,#888);font-size:11px}' +
    '.fcal-main{min-width:0}.fcal-main-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.fcal-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;flex-wrap:wrap}.fcal-toolbar-left,.fcal-toolbar-right{display:flex;align-items:center;gap:6px}.fcal-today-button{border:1px solid var(--border,#ddd);background:var(--bg-card,#fff);border-radius:8px;padding:7px 11px;font-size:11px;color:var(--text-primary,#333)}.fcal-nav-button{width:29px;height:29px;border:0;background:transparent;border-radius:7px;color:var(--text-secondary,#666);font-size:22px;line-height:1}.fcal-nav-button:hover{background:var(--bg-hover,#f2f4f7)}.fcal-toolbar-title{font-size:16px;font-weight:650;margin-left:5px}.fcal-view-switch{display:flex;border:1px solid var(--border,#ddd);background:var(--bg-secondary,#f6f7f8);border-radius:8px;padding:2px;gap:2px}.fcal-view-switch button{border:0;background:transparent;border-radius:6px;padding:6px 11px;color:var(--text-secondary,#666);font-size:11px}.fcal-view-switch button.is-active{background:var(--bg-card,#fff);color:var(--text-primary,#222);box-shadow:0 1px 3px rgba(0,0,0,.12);font-weight:650}' +
    '.fcal-calendar-wrap{border:1px solid var(--border,#e3e4e7);border-radius:12px;overflow:hidden;background:var(--bg-card,#fff)}.fcal-calendar{width:100%;overflow:hidden}.fcal-weekday-row{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));background:var(--bg-secondary,#f7f8f9);border-bottom:1px solid var(--border,#e5e5e8)}.fcal-weekday-row>div{min-width:0;text-align:center;padding:9px 4px;color:var(--text-secondary,#777);font-size:10px;font-weight:600;border-right:1px solid var(--border,#e8e8ea)}.fcal-weekday-row>div:last-child{border-right:0}' +
    '.fcal-month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.fcal-day-cell{min-width:0;min-height:112px;padding:6px 5px;border-right:1px solid var(--border,#ececef);border-bottom:1px solid var(--border,#ececef);background:var(--bg-card,#fff);cursor:pointer;transition:background .12s}.fcal-day-cell:nth-child(7n){border-right:0}.fcal-day-cell:hover,.fcal-week-cell:hover{background:var(--bg-hover,#f8faff)}.fcal-day-cell.is-outside{background:var(--bg-secondary,#fafafa)}.fcal-day-cell.is-outside .fcal-day-number{color:#b6b8be}.fcal-day-cell.is-today{background:rgba(54,120,213,.035)}.fcal-day-cell-head{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:4px}.fcal-day-number{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:50%;font-size:11px;color:var(--text-primary,#333)}.fcal-day-number.is-today-number{background:#3478d5;color:#fff;font-weight:700}.fcal-day-add{opacity:0;border:0;background:transparent;color:#3478d5;font-size:16px;line-height:1;padding:1px 4px;border-radius:5px}.fcal-day-cell:hover .fcal-day-add{opacity:1}.fcal-day-events{display:flex;flex-direction:column;gap:3px}.fcal-event{display:flex;flex-direction:column;align-items:flex-start;width:100%;min-width:0;border:0;border-left:3px solid transparent;border-radius:5px;padding:4px 5px;text-align:left;gap:1px;line-height:1.25}.fcal-event:hover{filter:brightness(.97);box-shadow:0 1px 2px rgba(0,0,0,.08)}.fcal-event-title{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:650}.fcal-event-amount{font-size:10px;font-weight:550;font-variant-numeric:tabular-nums}.fcal-event-status,.fcal-event-remaining{font-size:9px;opacity:.82}.fcal-event.is-pending{background:#eaf1ff;color:#245bc5;border-left-color:#4c82d5}.fcal-event.is-partial{background:#fff4df;color:#95600b;border-left-color:#d79a36}.fcal-event.is-reserved{background:#f0eaff;color:#6842a6;border-left-color:#8c69c2}.fcal-event.is-settled{background:#e8f5eb;color:#237a40;border-left-color:#48a36b}.fcal-event.is-overdue{background:#fceaea;color:#b42318;border-left-color:#d9534f}.fcal-more-events{width:100%;border:0;background:transparent;color:#3478d5;text-align:left;font-size:9px;padding:3px 4px}' +
    '.fcal-week-calendar .fcal-weekday-row>div{display:flex;flex-direction:column;gap:4px;align-items:center}.fcal-weekday-row>div strong{font-size:13px;color:var(--text-primary,#333)}.fcal-weekday-row>div strong.is-today-number{color:#3478d5}.fcal-week-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-height:330px}.fcal-week-cell{min-width:0;padding:7px 5px;border-right:1px solid var(--border,#ececef);cursor:pointer}.fcal-week-cell:last-child{border-right:0}.fcal-week-add{font-size:12px;color:#b3b7be;text-align:right;margin-bottom:5px;opacity:0}.fcal-week-cell:hover .fcal-week-add{opacity:1}.fcal-week-cell .fcal-event{margin-bottom:5px}' +
    '.fcal-day-view{padding:16px;min-height:260px}.fcal-day-view-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}.fcal-day-view-date{font-size:17px;font-weight:650}.fcal-day-view-count{font-size:11px;color:var(--text-secondary,#888);margin-top:4px}.fcal-day-event-list{display:flex;flex-direction:column;gap:7px}.fcal-day-event-list .fcal-event{padding:10px 12px;border-left-width:4px}.fcal-day-event-list .fcal-event-title{font-size:12px}.fcal-day-event-list .fcal-event-amount{font-size:12px}.fcal-day-event-list .fcal-event-status,.fcal-day-event-list .fcal-event-remaining{font-size:10px}.fcal-empty-day{padding:35px 15px;text-align:center;color:var(--text-secondary,#888);font-size:12px;border:1px dashed var(--border,#ddd);border-radius:9px}' +
    '.fcal-legend{display:flex;align-items:center;flex-wrap:wrap;gap:13px;padding:10px 3px;color:var(--text-secondary,#777);font-size:10px}.fcal-legend span{display:inline-flex;align-items:center;gap:5px}.fcal-legend i{display:inline-block;width:8px;height:8px;border-radius:2px}.fcal-legend i.is-pending{background:#4c82d5}.fcal-legend i.is-partial{background:#d79a36}.fcal-legend i.is-reserved{background:#8c69c2}.fcal-legend i.is-settled{background:#48a36b}.fcal-legend i.is-overdue{background:#d9534f}.fcal-no-value{color:var(--text-secondary,#aaa);font-weight:400}' +
    '.fcal-year-view{padding:12px}.fcal-year-view-note{font-size:11px;color:var(--text-secondary,#888);margin:0 0 12px}.fcal-year-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.fcal-year-month-card{display:block;min-width:0;width:100%;padding:12px;border:1px solid var(--border,#e5e5e8);border-radius:10px;background:var(--bg-card,#fff);color:var(--text-primary,#222);text-align:left;cursor:pointer;transition:border-color .12s,background .12s}.fcal-year-month-card:hover{border-color:#8baee0;background:var(--bg-hover,#f8faff)}.fcal-year-month-card.is-selected{border-color:#3478d5;background:rgba(52,120,213,.035);box-shadow:inset 0 0 0 1px rgba(52,120,213,.12)}.fcal-year-month-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px}.fcal-year-month-head strong{font-size:14px;font-weight:650}.fcal-year-month-head span{font-size:10px;color:var(--text-secondary,#888)}.fcal-year-currency{padding:8px 0;border-top:1px solid var(--border,#ececef)}.fcal-year-currency-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}.fcal-year-currency-head strong{font-size:11px}.fcal-year-currency-head span{font-size:10px;color:var(--text-secondary,#888)}.fcal-year-currency-line{display:flex;justify-content:space-between;gap:7px;font-size:10px;line-height:1.55;color:var(--text-secondary,#777)}.fcal-year-currency-line strong{color:var(--text-primary,#333);font-weight:600;font-variant-numeric:tabular-nums}.fcal-year-currency-line.is-outstanding strong{color:#3478d5}.fcal-year-progress{height:4px;border-radius:5px;background:var(--bg-secondary,#edf0f3);overflow:hidden;margin-top:5px}.fcal-year-progress i{display:block;height:100%;background:#42a16a;border-radius:5px}.fcal-year-overdue{margin-top:5px;font-size:10px;color:#c5443d}.fcal-year-empty{padding:15px 2px 10px;text-align:center;color:var(--text-secondary,#aaa);font-size:10px}.fcal-year-open-hint{font-size:10px;color:#3478d5;margin-top:8px}' +
    '.fcal-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fcal-form-field{display:flex;flex-direction:column;gap:5px;min-width:0}.fcal-form-field.is-wide{grid-column:1/-1}.fcal-form-field label{font-size:11px;color:var(--text-secondary,#666);font-weight:600}.fcal-form-field input,.fcal-form-field select{width:100%;border:1px solid var(--border,#dfe0e4);border-radius:8px;padding:9px 10px;background:var(--bg-card,#fff);color:var(--text-primary,#222);font-size:12px}.fcal-form-note{grid-column:1/-1;font-size:11px;color:var(--text-secondary,#888);line-height:1.5;background:var(--bg-secondary,#f7f8f9);border-radius:8px;padding:9px 10px}.fcal-form-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px;margin-top:3px}.fcal-secondary-button{border:1px solid var(--border,#ddd);background:var(--bg-card,#fff);color:var(--text-primary,#333);border-radius:8px;padding:8px 12px;font-size:12px}.fcal-undated-list{display:flex;flex-direction:column;gap:6px;max-height:55vh;overflow:auto}.fcal-undated-item{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:1px solid var(--border,#e5e5e8);background:var(--bg-card,#fff);border-radius:8px;padding:9px 10px;text-align:left}.fcal-undated-item span{font-size:11px}.fcal-undated-item strong{font-size:11px;font-variant-numeric:tabular-nums}' +
    '@media(max-width:1150px){.fcal-layout{grid-template-columns:205px minmax(0,1fr)}.fcal-day-cell{min-height:98px}.fcal-stats-grid{gap:8px}.fcal-stat-card{padding:11px}.fcal-year-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
    '@media(max-width:900px){.fcal-layout{grid-template-columns:1fr}.fcal-sidebar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}.fcal-mini-card{grid-row:span 2}.fcal-sidebar-card:last-child{grid-column:1/-1}.fcal-filter-section-head{margin-bottom:6px}.fcal-filter{display:inline-block;width:calc(33.333% - 5px);margin-right:4px;vertical-align:top}}' +
    '@media(max-width:650px){.fcal-stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fcal-sidebar{grid-template-columns:1fr}.fcal-mini-card,.fcal-sidebar-card:last-child{grid-row:auto;grid-column:auto}.fcal-filter{width:100%;margin-right:0}.fcal-day-cell{min-height:80px;padding:4px 3px}.fcal-event{padding:3px}.fcal-event-title,.fcal-event-amount{font-size:9px}.fcal-day-add{opacity:1}.fcal-toolbar-title{font-size:14px}.fcal-week-grid{min-height:260px}.fcal-week-cell{padding:4px 2px}.fcal-form{grid-template-columns:1fr}.fcal-form-field.is-wide,.fcal-form-note,.fcal-form-actions{grid-column:1}.fcal-view-switch button{padding:6px 8px}.fcal-year-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fcal-year-view{padding:8px}.fcal-year-month-card{padding:9px}}' +
    '@media(max-width:430px){.fcal-year-grid{grid-template-columns:1fr}}' +

    '.fcal-filter-bar{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;align-items:center;margin:0 0 22px}' +
    '.fcal-page .fcal-filter{margin-top:0;min-width:0;width:100%;margin-right:0}' +
    '.fcal-page .fcal-filter-trigger{height:42px;padding:0 9px;border-radius:9px;gap:6px}' +
    '.fcal-filter-label{display:flex;align-items:center;gap:5px;min-width:0;color:var(--text-secondary,#68707b);font-size:11px;white-space:nowrap}' +
    '.fcal-filter-icon{color:var(--text-primary,#333);font-size:12px;line-height:1}' +
    '.fcal-filter-value{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary,#333);font-size:11px;font-weight:600;white-space:nowrap}' +
    '.fcal-stats-grid{margin-bottom:18px}.fcal-summary-note{display:none}' +
    '.fcal-main{min-width:0;border:1px solid var(--border,#e3e4e7);border-radius:12px;background:var(--bg-card,#fff);overflow:hidden}' +
    '.fcal-main-toolbar{padding:11px 15px;margin-bottom:0}.fcal-calendar-wrap{border:0;border-top:1px solid var(--border,#e3e4e7);border-radius:0}' +
    '.fcal-toolbar{flex-wrap:nowrap}.fcal-toolbar-left{gap:7px}.fcal-toolbar-title{font-size:16px}' +
    '@media(max-width:1150px){.fcal-filter-bar{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
    '@media(max-width:900px){.fcal-filter-bar{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
    '@media(max-width:650px){.fcal-filter-bar{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.fcal-main-toolbar{padding:9px}.fcal-toolbar{flex-wrap:wrap}.fcal-calendar-wrap{overflow-x:auto}.fcal-calendar{min-width:650px}}' +
    '</style>';
}
function fcCanCreate() {
  return typeof hasPermission !== 'function' || hasPermission('payment_create');
}
function fcManualOptions() {
  const options = [];
  (_financeCalendarState.categories || []).forEach(category => {
    (category.subcategories || []).forEach(sub => {
      const mapping = (sub.source_mappings || []).find(x => x.source_type === 'manual' && x.fee_type);
      if (mapping) options.push({
        subcategory_id: sub.id,
        fee_type: mapping.fee_type,
        category_code: category.code,
        label: (category.name || category.code) + ' / ' + (sub.name || sub.code)
      });
    });
  });
  return options;
}
function fcOpenCreate(date) {
  if (!fcCanCreate()) {
    if (typeof showToast === 'function') showToast(fcText('你没有创建应付项的权限', 'You do not have permission to create payables', 'Anda tidak memiliki izin membuat hutang'));
    return;
  }
  const state = _financeCalendarState;
  const selectedDate = String(date || state.selectedDate || state.today || fcTodayISO()).slice(0, 10);
  state.selectedDate = selectedDate;
  const manualOptions = fcManualOptions();
  const payers = (state.payerEntities || []).filter(x => x.status !== 'inactive');
  const currencies = (state.currencies || []).filter(x => x.status !== 'inactive');
  const optionHtml = manualOptions.map(x => '<option value="' + fcEsc(x.subcategory_id) + '" data-fee-type="' + fcEsc(x.fee_type) + '">' + fcEsc(x.label) + '</option>').join('');
  const payerHtml = payers.map(x => '<option value="' + fcEsc(x.entity_key) + '">' + fcEsc(x.entity_name) + '</option>').join('');
  const defaultCurrency = (payers[0] && payers[0].default_currency && currencies.some(x => x.code === payers[0].default_currency))
    ? payers[0].default_currency : (currencies[0] ? currencies[0].code : '');
  const currencyHtml = currencies.map(x => '<option value="' + fcEsc(x.code) + '" ' + (x.code === defaultCurrency ? 'selected' : '') + '>' + fcEsc(x.code) + '</option>').join('');
  const noCategory = !manualOptions.length;
  const noPayer = !payers.length;
  let html = '<div class="fcal-form">';
  html += '<div class="fcal-form-field is-wide"><label>' + fcEsc(fcText('付款对象 / 供应商', 'Payee / supplier', 'Penerima / pemasok')) + '</label><input id="fcal-new-payee" maxlength="160" placeholder="' + fcEsc(fcText('请输入付款对象名称', 'Enter the payee name', 'Masukkan nama penerima')) + '"></div>';
  html += '<div class="fcal-form-field is-wide"><label>' + fcEsc(fcText('费用类别', 'Expense category', 'Kategori biaya')) + '</label><select id="fcal-new-subcategory" ' + (noCategory ? 'disabled' : '') + '>' +
    (optionHtml || '<option value="">' + fcEsc(fcText('暂无可手动录入的费用类别', 'No manual-entry categories configured', 'Tidak ada kategori input manual')) + '</option>') + '</select></div>';
  html += '<div class="fcal-form-field"><label>' + fcEsc(fcText('应付金额', 'Payable amount', 'Jumlah hutang')) + '</label><input id="fcal-new-amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00"></div>';
  html += '<div class="fcal-form-field"><label>' + fcEsc(fcText('币种', 'Currency', 'Mata uang')) + '</label><select id="fcal-new-currency">' + (currencyHtml || '<option value="">—</option>') + '</select></div>';
  html += '<div class="fcal-form-field"><label>' + fcEsc(fcText('付款主体', 'Payer entity', 'Entitas pembayar')) + '</label><select id="fcal-new-payer" ' + (noPayer ? 'disabled' : '') + '>' +
    (payerHtml || '<option value="">' + fcEsc(fcText('请先配置付款主体', 'Configure a payer entity first', 'Konfigurasikan entitas pembayar terlebih dahulu')) + '</option>') + '</select></div>';
  html += '<div class="fcal-form-field"><label>' + fcEsc(fcText('应付日期', 'Due date', 'Tanggal jatuh tempo')) + '</label><input id="fcal-new-date" type="date" value="' + fcEsc(selectedDate) + '"></div>';
  html += '<div class="fcal-form-note">' + fcEsc(fcText('创建后会进入现有应付费用台账；后续付款申请和审批仍使用原有流程。费用类别仅显示已启用“手动录入”来源映射的项目。', 'The item will be added to the existing payable ledger. Payment requests and approvals continue through the current workflow. Only categories with an active manual-entry source mapping are shown.', 'Item akan masuk ke daftar hutang yang ada. Pengajuan dan persetujuan pembayaran tetap memakai alur saat ini. Hanya kategori dengan pemetaan input manual aktif yang ditampilkan.')) + '</div>';
  html += '<div class="fcal-form-actions"><button type="button" class="fcal-secondary-button" onclick="closeModal()">' + fcEsc(fcText('取消', 'Cancel', 'Batal')) + '</button>' +
    '<button type="button" class="fcal-primary-button" ' + (noCategory || noPayer || !currencies.length ? 'disabled' : '') + ' onclick="fcSubmitManualPayable()">' +
    fcEsc(fcText('保存应付项', 'Save payable', 'Simpan hutang')) + '</button></div></div>';
  if (typeof openModal === 'function') openModal(fcText('新增应付项', 'Create payable item', 'Buat item hutang'), html);
}
async function fcSubmitManualPayable() {
  const get = id => document.getElementById(id);
  const payee = get('fcal-new-payee');
  const category = get('fcal-new-subcategory');
  const amount = get('fcal-new-amount');
  const currency = get('fcal-new-currency');
  const payer = get('fcal-new-payer');
  const date = get('fcal-new-date');
  if (!payee || !String(payee.value || '').trim()) {
    if (typeof showToast === 'function') showToast(fcText('请填写付款对象', 'Enter a payee', 'Masukkan penerima'));
    return;
  }
  const selectedOption = category && category.options ? category.options[category.selectedIndex] : null;
  const feeType = selectedOption ? selectedOption.getAttribute('data-fee-type') : '';
  if (!category || !category.value || !feeType || !payer || !payer.value || !currency || !currency.value || !date || !date.value) {
    if (typeof showToast === 'function') showToast(fcText('请完整填写应付项信息', 'Complete all payable details', 'Lengkapi semua detail hutang'));
    return;
  }
  const amountValue = Number(amount && amount.value);
  if (!Number.isFinite(amountValue) || amountValue <= 0) {
    if (typeof showToast === 'function') showToast(fcText('应付金额必须大于0', 'Amount must be greater than zero', 'Jumlah harus lebih dari nol'));
    return;
  }
  const payload = {
    payee_name: String(payee.value).trim(),
    subcategory_id: category.value,
    fee_type: feeType,
    amount: amountValue,
    currency: currency.value,
    payer_entity_key: payer.value,
    payable_date: date.value
  };
  try {
    const result = await api('/api/payable-items/manual', 'POST', payload);
    if (!result || !result.success) throw new Error((result && result.error) || 'Create failed');
    if (typeof closeModal === 'function') closeModal();
    if (typeof showToast === 'function') showToast(fcText('应付项已创建', 'Payable item created', 'Item hutang berhasil dibuat'));
    await fcReloadData();
  } catch (error) {
    if (typeof showToast === 'function') showToast(error && error.message ? error.message : fcText('创建失败，请稍后重试', 'Could not create the payable item', 'Gagal membuat item hutang'));
  }
}
async function fcReloadData() {
  const seq = ++_financeCalendarState.loadingSeq;
  try {
    const results = await Promise.all([api('/api/payable-items'), api('/api/payable-items/facets')]);
    if (seq !== _financeCalendarState.loadingSeq) return;
    _financeCalendarState.items = results[0] && results[0].items || [];
    _financeCalendarState.facets = results[1] || {};
    fcRenderPage();
  } catch (error) {
    if (typeof showToast === 'function') showToast(error && error.message ? error.message : 'Reload failed');
  }
}
function fcOpenDetail(id) {
  if (typeof openPayableDetailModal === 'function') openPayableDetailModal(id);
  else if (typeof showToast === 'function') showToast(fcText('无法打开应付详情', 'Unable to open payable details', 'Tidak dapat membuka detail hutang'));
}
function fcOpenUndated() {
  const rows = fcFilteredItems().filter(item => !String(item.payable_date || '').trim());
  let html = '<div class="fcal-undated-list">';
  if (!rows.length) html += '<div class="fcal-empty-day">' + fcEsc(fcText('没有未安排付款日期的应付项', 'No payable items without a scheduled date', 'Tidak ada item tanpa tanggal')) + '</div>';
  rows.forEach(item => {
    html += '<button type="button" class="fcal-undated-item" onclick="fcOpenDetail(\'' + fcJsArg(item.id) + '\')"><span>' +
      fcEsc(fcItemTitle(item)) + '<br><small>' + fcEsc(item.fee_no || '') + '</small></span><strong>' +
      fcEsc(item.currency || '') + ' ' + fcEsc(fcMoney(fcPayableAmount(item))) + '</strong></button>';
  });
  html += '</div>';
  if (typeof openModal === 'function') openModal(fcText('未安排付款日期', 'No scheduled date', 'Belum ada tanggal'), html);
}
function fcToggleView(view) {
  _financeCalendarState.view = ['day', 'week', 'month', 'year'].includes(view) ? view : 'month';
  fcRenderPage();
}
function fcSetView(view) { fcToggleView(view); }
function fcSetDate(date, view) {
  _financeCalendarState.currentDate = String(date || fcTodayISO()).slice(0, 10);
  _financeCalendarState.selectedDate = _financeCalendarState.currentDate;
  if (view) _financeCalendarState.view = view;
  fcRenderPage();
}
function fcNavigate(direction) {
  const state = _financeCalendarState;
  if (state.view === 'year') state.currentDate = fcAddMonths(state.currentDate, Number(direction || 0) * 12);
  else if (state.view === 'month') state.currentDate = fcAddMonths(state.currentDate, Number(direction || 0));
  else state.currentDate = fcAddDays(state.currentDate, Number(direction || 0) * (state.view === 'week' ? 7 : 1));
  state.selectedDate = state.currentDate;
  fcRenderPage();
}
function fcSetYearMonth(monthIndex) {
  const state = _financeCalendarState;
  const index = Math.max(0, Math.min(11, Number(monthIndex) || 0));
  const year = fcParseISO(state.currentDate).getFullYear();
  state.currentDate = String(year) + '-' + String(index + 1).padStart(2, '0') + '-01';
  state.selectedDate = state.currentDate;
  state.view = 'month';
  fcRenderPage();
}
function fcGoToday() {
  _financeCalendarState.currentDate = _financeCalendarState.today || fcTodayISO();
  _financeCalendarState.selectedDate = _financeCalendarState.currentDate;
  fcRenderPage();
}
function fcBindOutside() {
  if (typeof window === 'undefined' || !window || window.__financeCalendarOutsideBound) return;
  if (typeof document === 'undefined' || !document.addEventListener) return;
  document.addEventListener('click', function (event) {
    if (!_financeCalendarState.openFilter) return;
    const target = event && event.target;
    if (target && target.closest && target.closest('.fcal-filter')) return;
    _financeCalendarState.openFilter = '';
    if (document.querySelectorAll) {
      document.querySelectorAll('.fcal-filter-panel').forEach(node => node.remove());
      document.querySelectorAll('.fcal-filter-trigger').forEach(node => node.setAttribute('aria-expanded', 'false'));
    }
  });
  window.__financeCalendarOutsideBound = true;
}
function fcRenderPage() {
  const root = typeof document !== 'undefined' ? document.getElementById('content-inner') : null;
  if (!root) return;
  const items = fcFilteredItems();
  const title = fcText('财务付款总览', 'Finance Payment Overview', 'Ringkasan Pembayaran');
  const createButton = fcCanCreate() ? '<button type="button" class="fcal-primary-button" onclick="fcOpenCreate(_financeCalendarState.selectedDate || _financeCalendarState.today)">＋ ' +
    fcEsc(fcText('创建应付项', 'Create payable', 'Buat hutang')) + '</button>' : '';
  root.innerHTML = fcCalendarStyles() + '<div class="fcal-page">' +
    '<div class="fcal-page-head"><div><h2 class="fcal-page-title">' + fcEsc(title) + '</h2><div class="fcal-page-subtitle">' +
    fcEsc(fcText('按应付日期查看应付安排 · 点击日期即可创建应付项', 'View payables by due date · Select a date to create a payable', 'Lihat tagihan berdasarkan tanggal jatuh tempo · Pilih tanggal untuk membuat item')) +
    '</div></div>' + createButton + '</div>' +
    fcRenderFilterBar() +
    fcRenderStats(items) +
    fcRenderMain(items) + '</div>';
  fcBindOutside();
}
function renderFinancePaymentCalendarPage(data) {
  const state = _financeCalendarState;
  state.items = data && Array.isArray(data.items) ? data.items : [];
  state.facets = data && data.facets || {};
  state.categories = data && Array.isArray(data.categories) ? data.categories : [];
  state.payerEntities = data && Array.isArray(data.payerEntities) ? data.payerEntities : [];
  state.currencies = data && Array.isArray(data.currencies) ? data.currencies : [];
  state.today = data && data.today ? String(data.today).slice(0, 10) : fcTodayISO();
  state.currentDate = state.today;
  state.selectedDate = state.today;
  state.view = 'year';
  state.openFilter = '';
  Object.keys(state.filters).forEach(key => state.filters[key].clear());
  fcRenderPage();
}
