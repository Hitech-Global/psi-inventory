'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const pct = value => Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : '—';
const roas = value => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';
const num = value => fmt.format(Number(value || 0));

const STATE_LABELS = Object.freeze({
  TARGET_MET: '目标达成',
  PROFITABLE_BUT_BELOW_TARGET: '盈利但低于目标',
  BELOW_BREAK_EVEN: '低于保本',
  ABOVE_BREAK_EVEN_BUT_OVER_SPEND_LIMIT: '盈利但广告占比超限',
  TARGET_UNKNOWN: '目标未设置',
  WITHIN_SPEND_LIMIT: '广告占比正常',
  OVER_SPEND_LIMIT: '广告占比超限',
  NO_ATTRIBUTED_GMV: '暂无归因GMV',
  VOLUME_REFERENCE_MET: '订单参考量达标',
  LOW_VOLUME_SIGNAL: '订单量不足',
  CORE_CANDIDATE: '主力候选',
  EXPLORATION_KEEP: '保留探索',
  INSUFFICIENT_EXPLORATION: '探索样本不足',
  HIGH_RISK_ZERO_ORDER: '高风险空烧',
  PRODUCT_OPTIMIZATION_CANDIDATE: '商品优化候选',
  ZERO_ORDER_STILL_TESTING: '零订单继续测试',
  NO_ORDER_NEEDS_AOV_CONTEXT: '零订单 / 缺少AOV',
  OBSERVE: '继续观察',
  LEARNING: '学习期',
  CONVERGING: '收敛观察期',
  STABLE: '稳定期',
  UNSTABLE: '长期未稳定',
});

const state = {
  view: 'overview',
  shops: [],
  countries: [],
  brands: [],
  selectedCampaignId: null,
  adsType: 'gms',
  adGroupPreview: null,
  shopScopes: [],
};

function moneyCompact(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return num(n);
}

function formatMoney(value, currency) {
  const n = Number(value || 0);
  if (!currency) return moneyCompact(n);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'IDR' ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${moneyCompact(n)}`;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function stateLabel(value) {
  return STATE_LABELS[value] || value || '—';
}

function changePct(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function changeClass(value, invert = false) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
  const n = Number(value);
  if (Math.abs(n) < 0.001) return '';
  const positive = invert ? n < 0 : n > 0;
  return positive ? 'positive' : 'negative';
}

function signalClass(signal) {
  if (!signal) return 'neutral';
  if (signal.severity === 'high') return 'bad';
  if (signal.severity === 'medium') return 'warn';
  if (signal.severity === 'positive') return 'good';
  return 'neutral';
}

function stateClass(value) {
  if (/TARGET_MET|WITHIN_SPEND|CORE_CANDIDATE|STABLE/.test(value || '') && value !== 'UNSTABLE') return 'good';
  if (/BELOW_BREAK|OVER_SPEND|HIGH_RISK|UNSTABLE/.test(value || '')) return 'bad';
  if (/LOW_VOLUME|BELOW_TARGET|OPTIMIZATION|ZERO_ORDER|LEARNING|CONVERGING/.test(value || '')) return 'warn';
  return 'neutral';
}

function itemStateClass(value) {
  if (value === 'CORE_CANDIDATE') return 'core';
  if (value === 'EXPLORATION_KEEP' || value === 'INSUFFICIENT_EXPLORATION') return 'explore';
  if (value === 'HIGH_RISK_ZERO_ORDER') return 'risk';
  if (value === 'PRODUCT_OPTIMIZATION_CANDIDATE' || value === 'ZERO_ORDER_STILL_TESTING') return 'optimize';
  return '';
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return '从未';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '未知';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function freshnessClass(lastSyncedAt) {
  if (!lastSyncedAt) return 'missing';
  const hours = (Date.now() - new Date(lastSyncedAt).getTime()) / 3600000;
  if (!Number.isFinite(hours)) return 'missing';
  if (hours <= 6) return 'fresh';
  if (hours <= 30) return 'aging';
  return 'stale';
}

function freshnessLabel(lastSyncedAt) {
  return ({
    fresh: '最新',
    aging: '待刷新',
    stale: '已过期',
    missing: '无数据',
  })[freshnessClass(lastSyncedAt)];
}

function backupStatusCard(backup) {
  if (!backup) {
    return `<div class="source-card missing">
      <div class="source-card-top"><strong>PostgreSQL备份</strong><span class="source-state missing">未配置</span></div>
      <div class="source-date">尚未读取到备份状态</div>
      <div class="source-sync">台式机部署后由本机→NAS备份任务更新</div>
    </div>`;
  }
  const cls = backup.ok ? 'fresh' : 'stale';
  const label = backup.ok ? '正常' : '失败';
  const sizeMb = backup.sizeBytes ? (Number(backup.sizeBytes) / 1024 / 1024).toFixed(1) : '—';
  return `<div class="source-card ${cls}">
    <div class="source-card-top"><strong>PostgreSQL备份</strong><span class="source-state ${cls}">${label}</span></div>
    <div class="source-date">NAS：${backup.nasCopiedAt ? formatDateTime(backup.nasCopiedAt) : '未确认'}</div>
    <div class="source-sync">最近成功：${formatDateTime(backup.completedAt)} · ${sizeMb} MB${backup.error ? ' · 最近失败：' + escapeHtml(backup.error) : ''}</div>
  </div>`;
}

function initDates() {
  $('#endDate').value = dateDaysAgo(1);
  $('#startDate').value = dateDaysAgo(7);
}

async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}

async function checkHealth() {
  const badge = $('#healthBadge');
  try {
    await json('/api/shopee-analytics/health');
    badge.textContent = '只读分析服务正常';
    badge.className = 'health ok';
  } catch {
    badge.textContent = '分析服务不可用';
    badge.className = 'health bad';
  }
}

function currentFilters() {
  return {
    country: $('#countryFilter').value,
    brand: $('#brandFilter').value,
    shopId: $('#shopSelect').value ? Number($('#shopSelect').value) : null,
    startDate: $('#startDate').value,
    endDate: $('#endDate').value,
  };
}

function filteredShops() {
  const { country, brand } = currentFilters();
  return state.shops.filter(shop =>
    (!country || shop.countryCode === country) &&
    (!brand || shop.brandCode === brand)
  );
}

function selectedShop() {
  const id = currentFilters().shopId;
  return id ? state.shops.find(shop => shop.shopId === id) || null : null;
}

function renderDimensionOptions() {
  const countrySelect = $('#countryFilter');
  const brandSelect = $('#brandFilter');
  const existingCountry = countrySelect.value;
  const existingBrand = brandSelect.value;

  countrySelect.innerHTML = '<option value="">全部国家</option>' +
    state.countries.map(row =>
      `<option value="${escapeHtml(row.code)}">${escapeHtml(row.name || row.code)}</option>`
    ).join('');

  brandSelect.innerHTML = '<option value="">全部品牌</option>' +
    state.brands.map(row =>
      `<option value="${escapeHtml(row.code)}">${escapeHtml(row.name || row.code)}</option>`
    ).join('');

  if (state.countries.some(row => row.code === existingCountry)) countrySelect.value = existingCountry;
  if (state.brands.some(row => row.code === existingBrand)) brandSelect.value = existingBrand;
}

function renderShopOptions({ preserve = true } = {}) {
  const select = $('#shopSelect');
  const previous = preserve ? select.value : '';
  const shops = filteredShops();

  const groups = new Map();
  for (const shop of shops) {
    const key = `${shop.countryCode} · ${shop.brandName || shop.brandCode}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(shop);
  }

  let html = '<option value="">全部店铺</option>';
  for (const [label, group] of groups.entries()) {
    html += `<optgroup label="${escapeHtml(label)}">`;
    html += group.map(shop =>
      `<option value="${shop.shopId}">${escapeHtml(shop.displayName)}</option>`
    ).join('');
    html += '</optgroup>';
  }
  select.innerHTML = html;

  if (previous && shops.some(shop => String(shop.shopId) === previous)) select.value = previous;
  else select.value = '';
}

async function loadShopDirectory() {
  const data = await json('/api/shopee-analytics/shops');
  state.shops = data.shops || [];
  state.countries = data.countries || [];
  state.brands = data.brands || [];
  renderDimensionOptions();
  renderShopOptions({ preserve: false });

  if (!state.shops.length) {
    $('#portfolioRows').innerHTML =
      '<tr><td colspan="14" class="empty">尚未配置店铺档案。先配置国家 / 品牌 / 店铺后即可使用多店总览。</td></tr>';
  }
}

function switchView(view) {
  state.view = view;
  $$('.view-tab').forEach(button =>
    button.classList.toggle('active', button.dataset.view === view)
  );
  $$('.view-section').forEach(section => section.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  updateSingleShopPrompts();
  loadCurrentView();
}

function updateSingleShopPrompts() {
  const shop = selectedShop();

  $('#storeShopPrompt').classList.toggle('hidden', Boolean(shop));
  $('#storeDetail').classList.toggle('hidden', !shop);

  $('#adsShopPrompt').classList.toggle('hidden', Boolean(shop));
  $('#adsGrid').classList.toggle('hidden', !shop);

  if (shop) {
    $('#statusPortfolioPanel').classList.add('hidden');
    $('#statusPortfolioSummary').classList.add('hidden');
  } else {
    $('#statusPortfolioPanel').classList.remove('hidden');
    $('#systemStatus').classList.add('hidden');
  }
}

function portfolioKpi(label, value, sub = '') {
  return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="kpi-sub">${escapeHtml(sub)}</div>` : ''}</div>`;
}

function renderPortfolio(data) {
  const totals = data.totals || {};
  const dimensions = data.dimensions || {};
  const shops = data.shops || [];
  const comparison = data.comparison || { shops: [], businessGroups: [] };
  const shopDiagnosisMap = new Map(
    (comparison.shops || []).map(row => [String(row.shopId), row.diagnosis])
  );
  const groupDiagnosisMap = new Map(
    (comparison.businessGroups || []).map(row => [row.key, row.diagnosis])
  );

  $('#portfolioShopCount').textContent = `${num(totals.shopCount)} 店`;
  $('#portfolioSubtitle').textContent = dimensions.multiCurrency
    ? '当前包含多个币种：金额按币种分别汇总，不直接做跨币种 GMV / ROAS 合计。'
    : '当前为单一币种，可直接比较金额与广告效率。';

  $('#portfolioSummary').innerHTML = [
    portfolioKpi('店铺数', num(totals.shopCount)),
    portfolioKpi('总订单', num(totals.orders), '来自 Shop BI'),
    portfolioKpi('总销量', num(totals.unitsSold)),
    portfolioKpi('广告 Broad 订单', num(totals.broadOrders)),
    portfolioKpi('退货/退款单', num(totals.returnCount)),
  ].join('');
  $('#portfolioSummary').classList.remove('hidden');

  const currencyGroups = data.currencyGroups || [];
  $('#currencyGroups').innerHTML = currencyGroups.length
    ? currencyGroups.map(group => `
      <article class="currency-card">
        <div class="currency-card-head">
          <strong>${escapeHtml(group.currency)}</strong>
          <span>${num(group.shopCount)} 店</span>
        </div>
        <div class="currency-money">${formatMoney(group.sales, group.currency)}</div>
        <div class="currency-label">销售额</div>
        <div class="currency-metrics">
          <div><span>广告花费</span><strong>${formatMoney(group.adExpense, group.currency)}</strong></div>
          <div><span>广告占比</span><strong>${group.adSpendRatioToBiSales == null ? '—' : pct(group.adSpendRatioToBiSales)}</strong></div>
          <div><span>Broad ROAS</span><strong>${roas(group.broadRoas)}</strong></div>
          <div><span>Broad GMV占比</span><strong>${group.adGmvShareOfBiSales == null ? '—' : pct(group.adGmvShareOfBiSales)}</strong></div>
          <div><span>估算非广告归因销售</span><strong>${formatMoney(group.estimatedNaturalSales, group.currency)}</strong></div>
          <div><span>退款</span><strong>${formatMoney(group.refundAmount, group.currency)}</strong></div>
        </div>
      </article>`).join('')
    : '<div class="empty-inline">所选范围没有金额数据。</div>';
  $('#currencyGroups').classList.remove('hidden');

  const portfolioContext = data.comparisonContext || {};
  $('#portfolioCompareSubtitle').textContent =
    `当前 ${data.startDate} → ${data.endDate}，对比上一等长周期 ${data.previousStartDate} → ${data.previousEndDate}。经营信号用于定位下钻方向，不直接视为因果结论。` +
    (portfolioContext.warning ? ` ⚠ ${portfolioContext.warning}` : '');

  const diagnosisRows = shops.map(shop => ({
    shop,
    diagnosis: shopDiagnosisMap.get(String(shop.shopId)) || null,
  }));
  const attentionCount = diagnosisRows.filter(row =>
    row.diagnosis && row.diagnosis.primarySignal &&
    ['high', 'medium'].includes(row.diagnosis.primarySignal.severity)
  ).length;
  $('#portfolioIssueCount').textContent = `${attentionCount} 需关注`;
  $('#portfolioIssueCount').className = `pill ${attentionCount ? 'warn' : 'good'}`;

  $('#portfolioDiagnosisRows').innerHTML = diagnosisRows.length
    ? diagnosisRows
      .sort((a, b) => {
        const ac = a.diagnosis && a.diagnosis.changes && a.diagnosis.changes.sales;
        const bc = b.diagnosis && b.diagnosis.changes && b.diagnosis.changes.sales;
        if (ac === null || ac === undefined) return 1;
        if (bc === null || bc === undefined) return -1;
        return ac - bc;
      })
      .map(({ shop, diagnosis }) => {
        const changes = diagnosis && diagnosis.changes || {};
        const signal = diagnosis && diagnosis.primarySignal;
        return `<tr data-diagnosis-shop="${shop.shopId}">
          <td><div class="shop-cell"><strong>${escapeHtml(shop.displayName)}</strong><small>${escapeHtml(shop.countryCode)} · ${escapeHtml(shop.brandName || shop.brandCode)}</small></div></td>
          <td class="${changeClass(changes.sales)}">${changePct(changes.sales)}</td>
          <td class="${changeClass(changes.productClicks)}">${changePct(changes.productClicks)}</td>
          <td class="${changeClass(changes.clickToOrder)}">${changePct(changes.clickToOrder)}</td>
          <td class="${changeClass(changes.aov)}">${changePct(changes.aov)}</td>
          <td class="${changeClass(changes.estimatedNaturalSales)}">${changePct(changes.estimatedNaturalSales)}</td>
          <td class="${changeClass(changes.broadGmv)}">${changePct(changes.broadGmv)}</td>
          <td title="${escapeHtml(signal && signal.detail || '')}"><span class="pill ${signalClass(signal)}">${escapeHtml(signal && signal.title || '等待数据')}</span></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="8" class="empty">当前筛选没有店铺诊断数据。</td></tr>';

  $$('[data-diagnosis-shop]').forEach(row => {
    row.addEventListener('click', () => {
      $('#shopSelect').value = row.dataset.diagnosisShop;
      switchView('store');
    });
  });

  const businessGroups = data.businessGroups || [];
  $('#businessGroupCount').textContent = `${num(businessGroups.length)} 组`;
  $('#businessGroupRows').innerHTML = businessGroups.length
    ? businessGroups.map(group => {
        const key = [group.countryCode, group.brandCode, group.currency].join('|');
        const diagnosis = groupDiagnosisMap.get(key);
        const salesChange = diagnosis && diagnosis.changes && diagnosis.changes.sales;
        const signal = diagnosis && diagnosis.primarySignal;
        return `<tr data-business-country="${escapeHtml(group.countryCode)}" data-business-brand="${escapeHtml(group.brandCode)}">
          <td>${escapeHtml(group.countryName || group.countryCode)}</td>
          <td>${escapeHtml(group.brandName || group.brandCode)}</td>
          <td>${num(group.shopCount)}</td>
          <td>${escapeHtml(group.currency)}</td>
          <td>${formatMoney(group.sales, group.currency)}</td>
          <td class="${changeClass(salesChange)}">${changePct(salesChange)}</td>
          <td>${num(group.orders)}</td>
          <td>${formatMoney(group.estimatedNaturalSales, group.currency)}</td>
          <td>${formatMoney(group.adExpense, group.currency)}</td>
          <td class="${group.adSpendRatioLimit != null && group.adSpendRatioToBiSales > group.adSpendRatioLimit ? 'negative' : ''}" title="${group.mixedAdSpendRatioLimits ? '组内店铺广告花费占比约束不同，不用统一15%判断' : (group.adSpendRatioLimit == null ? '' : '当前组约束 ≤ ' + pct(group.adSpendRatioLimit))}">${group.adSpendRatioToBiSales == null ? '—' : pct(group.adSpendRatioToBiSales)}</td>
          <td>${group.adGmvShareOfBiSales == null ? '—' : pct(group.adGmvShareOfBiSales)}</td>
          <td>${roas(group.broadRoas)}</td>
          <td title="${escapeHtml(signal && signal.detail || '')}"><span class="pill ${signalClass(signal)}">${escapeHtml(signal && signal.title || '—')}</span></td>
          <td>${formatMoney(group.refundAmount, group.currency)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="14" class="empty">当前筛选没有国家 × 品牌汇总数据。</td></tr>';

  $$('[data-business-country]').forEach(row => {
    row.addEventListener('click', () => {
      $('#countryFilter').value = row.dataset.businessCountry;
      $('#brandFilter').value = row.dataset.businessBrand;
      renderShopOptions({ preserve: false });
      loadCurrentView();
    });
  });

  $('#portfolioRows').innerHTML = shops.length
    ? shops.map(shop => `<tr data-portfolio-shop="${shop.shopId}">
        <td>${escapeHtml(shop.countryName || shop.countryCode)}</td>
        <td>${escapeHtml(shop.brandName || shop.brandCode)}</td>
        <td><div class="shop-cell"><strong>${escapeHtml(shop.displayName)}</strong><small>#${shop.shopId}</small></div></td>
        <td>${escapeHtml(shop.currency)}</td>
        <td>${formatMoney(shop.sales, shop.currency)}</td>
        <td>${num(shop.orders)}</td>
        <td>${formatMoney(shop.adExpense, shop.currency)}</td>
        <td class="${shop.adSpendRatioToBiSales > shop.adSpendRatioLimit ? 'negative' : ''}" title="经营约束 ≤ ${pct(shop.adSpendRatioLimit)}">${shop.adSpendRatioToBiSales == null ? '—' : pct(shop.adSpendRatioToBiSales)}</td>
        <td>${shop.adGmvShareOfBiSales == null ? '—' : pct(shop.adGmvShareOfBiSales)}</td>
        <td>${formatMoney(shop.estimatedNaturalSales, shop.currency)}</td>
        <td>${roas(shop.broadRoas)}</td>
        <td>${num(shop.directOrders)}</td>
        <td>${formatMoney(shop.refundAmount, shop.currency)}</td>
        <td>${num(shop.returnCount)}</td>
      </tr>`).join('')
    : '<tr><td colspan="14" class="empty">当前筛选没有店铺数据。</td></tr>';

  $$('[data-portfolio-shop]').forEach(row => {
    row.addEventListener('click', () => {
      $('#shopSelect').value = row.dataset.portfolioShop;
      switchView('store');
    });
  });
}

async function loadPortfolio() {
  const filters = currentFilters();
  const params = new URLSearchParams({
    start_date: filters.startDate,
    end_date: filters.endDate,
  });
  if (filters.country) params.set('country', filters.country);
  if (filters.brand) params.set('brand', filters.brand);
  if (filters.shopId) params.set('shop_ids', String(filters.shopId));

  const data = await json(`/api/shopee-analytics/overview?${params}`);
  renderPortfolio(data);
}

function renderStoreDetail(data) {
  const shop = data.shop;
  const current = data.current || {};
  const diagnosis = data.diagnosis || {};
  const changes = diagnosis.changes || {};
  const primarySignal = diagnosis.primarySignal || null;

  $('#storeTitle').textContent =
    `${shop.countryName || shop.countryCode} · ${shop.brandName || shop.brandCode} · ${shop.displayName}`;
  const storeContext = data.comparisonContext || {};
  $('#storeCompareSubtitle').textContent =
    `当前 ${data.startDate} → ${data.endDate}，对比上一等长周期 ${data.previousStartDate} → ${data.previousEndDate}。` +
    (storeContext.warning ? ` ⚠ ${storeContext.warning}` : '');

  $('#storePrimarySignal').textContent = primarySignal ? primarySignal.title : '等待数据';
  $('#storePrimarySignal').className = `pill ${signalClass(primarySignal)}`;

  $('#storeSummary').innerHTML = [
    portfolioKpi('销售额', formatMoney(current.sales, shop.currency), `较上期 ${changePct(changes.sales)}`),
    portfolioKpi('订单', num(current.orders), `较上期 ${changePct(changes.orders)}`),
    portfolioKpi('商品点击', num(current.productClicks), `较上期 ${changePct(changes.productClicks)}`),
    portfolioKpi('点击→订单', current.orderPerProductClick == null ? '—' : pct(current.orderPerProductClick), `较上期 ${changePct(changes.clickToOrder)}`),
    portfolioKpi('客单价', current.orders ? formatMoney(current.sales / current.orders, shop.currency) : '—', `较上期 ${changePct(changes.aov)}`),
    portfolioKpi('广告花费占比', current.adSpendRatioToBiSales == null ? '—' : pct(current.adSpendRatioToBiSales), `经营约束 ≤ ${pct(current.adSpendRatioLimit)}`),
    portfolioKpi('Broad ROAS', roas(current.broadRoas)),
    portfolioKpi('估算非广告归因销售', formatMoney(current.estimatedNaturalSales, shop.currency), `较上期 ${changePct(changes.estimatedNaturalSales)}`),
  ].join('');

  const signals = diagnosis.signals || [];
  $('#storeSignalList').innerHTML = signals.map(signal => `
    <article class="store-signal ${signal.severity || 'neutral'}">
      <span class="pill ${signalClass(signal)}">${escapeHtml(signal.title)}</span>
      <p>${escapeHtml(signal.detail || '')}</p>
      ${signal.action ? `<div class="signal-action">${escapeHtml(signal.action)}</div>` : ''}
    </article>
  `).join('') || '<div class="empty-inline">暂无经营变化信号。</div>';

  $('#storeTrendRows').innerHTML = (data.daily || []).length
    ? data.daily.map(row => {
        const eventText = row.event
          ? (row.event.eventType === 'DOUBLE_DAY' ? '双日' : row.event.eventType === 'PAYDAY_25' ? '25日' : row.event.eventType)
          : '普通日';
        return `<tr>
          <td>${escapeHtml(row.eventDate)}</td>
          <td><span class="event-tag ${row.event ? 'special' : ''}">${escapeHtml(eventText)}</span></td>
          <td>${row.sales == null ? '—' : formatMoney(row.sales, shop.currency)}</td>
          <td>${row.orders == null ? '—' : num(row.orders)}</td>
          <td>${row.productClicks == null ? '—' : num(row.productClicks)}</td>
          <td>${row.clickToOrder == null ? '—' : pct(row.clickToOrder)}</td>
          <td>${row.aov == null ? '—' : formatMoney(row.aov, shop.currency)}</td>
          <td>${formatMoney(row.adExpense, shop.currency)}</td>
          <td>${roas(row.broadRoas)}</td>
          <td>${row.estimatedNaturalSales == null ? '—' : formatMoney(row.estimatedNaturalSales, shop.currency)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="10" class="empty">这个周期没有每日店铺数据。</td></tr>';

  const skus = data.skus || [];
  $('#storeSkuCount').textContent = `${num(skus.length)} SKU`;
  const skuDiagnosis = data.skuDiagnosis || {};
  $('#storeSkuSubtitle').textContent = data.productCardExactPeriod
    ? `已匹配当前周期 Product Card；店内总CVR中位数 ${skuDiagnosis.cvrMedian == null ? '—' : pct(skuDiagnosis.cvrMedian)}，${num(skuDiagnosis.attentionCount)} 个商品需优先关注。`
    : `当前周期没有精确匹配的 Product Card；先显示 API 广告数据，${num(skuDiagnosis.attentionCount)} 个商品出现广告侧风险信号。`;

  $('#storeSkuRows').innerHTML = skus.length
    ? skus.map(item => `<tr data-store-item="${item.itemId}">
        <td><div class="item-name"><strong>${escapeHtml(item.itemSku || ('#' + item.itemId))}</strong><small>${escapeHtml(item.itemName || '')}</small></div></td>
        <td>${item.totalSales == null ? '—' : formatMoney(item.totalSales, shop.currency)}</td>
        <td>${item.totalOrders == null ? '—' : num(item.totalOrders)}</td>
        <td>${item.totalConversionRate == null ? '—' : pct(item.totalConversionRate)}</td>
        <td>${item.addToCartRate == null ? '—' : pct(item.addToCartRate)}</td>
        <td>${formatMoney(item.adExpense, shop.currency)}</td>
        <td>${formatMoney(item.broadGmv, shop.currency)}</td>
        <td>${item.directGmvShareOfSales == null ? '—' : pct(item.directGmvShareOfSales)}</td>
        <td>${roas(item.broadRoas)}</td>
        <td>${roas(item.directRoas)}</td>
        <td>${item.breakEvenRoas == null ? '未配置' : roas(item.breakEvenRoas)}</td>
        <td>${num(item.directOrders)}</td>
        <td>${item.estimatedNaturalSales == null ? '—' : formatMoney(item.estimatedNaturalSales, shop.currency)}</td>
        <td title="${escapeHtml([
          item.primarySignal && item.primarySignal.detail,
          item.primarySignal && item.primarySignal.action,
        ].filter(Boolean).join(' '))}"><span class="pill ${signalClass(item.primarySignal)}">${escapeHtml(item.primarySignal && item.primarySignal.title || '—')}</span></td>
      </tr>`).join('')
    : '<tr><td colspan="14" class="empty">当前周期没有商品层数据。</td></tr>';

  $$('[data-store-item]').forEach(row => {
    row.addEventListener('click', () => {
      const itemId = Number(row.dataset.storeItem);
      switchView('ads');
      setTimeout(() => {
        const target = document.querySelector(`[data-item="${itemId}"]`);
        if (target) target.scrollIntoView({ block: 'center' });
      }, 0);
    });
  });
}

async function loadStoreDetail() {
  const shop = selectedShop();
  if (!shop) return;
  const filters = currentFilters();
  const params = new URLSearchParams({
    start_date: filters.startDate,
    end_date: filters.endDate,
  });
  const data = await json(`/api/shopee-analytics/shops/${shop.shopId}/detail?${params}`);
  renderStoreDetail(data);
}

function renderCampaignSummary(campaigns, shop) {
  const sum = campaigns.reduce((acc, row) => {
    const p = row.performance || {};
    acc.expense += Number(p.expense || 0);
    acc.gmv += Number(p.broadGmv || 0);
    acc.orders += Number(p.broadOrders || 0);
    acc.clicks += Number(p.clicks || 0);
    acc.impressions += Number(p.impressions || 0);
    return acc;
  }, { expense: 0, gmv: 0, orders: 0, clicks: 0, impressions: 0 });
  const ratio = sum.gmv ? sum.expense / sum.gmv : null;
  const totalRoas = sum.expense ? sum.gmv / sum.expense : 0;

  $('#summary').innerHTML = [
    ['广告花费', formatMoney(sum.expense, shop.currency), ''],
    ['Broad GMV', formatMoney(sum.gmv, shop.currency), ''],
    ['Broad订单', num(sum.orders), ''],
    ['ROAS', roas(totalRoas), ''],
    ['花费/Broad GMV', ratio == null ? '—' : pct(ratio), ratio > .15 ? 'negative' : 'positive'],
  ].map(([label, value, cls]) =>
    `<div class="kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`
  ).join('');
  $('#summary').classList.remove('hidden');
}

function renderCampaigns(data, shop) {
  const rows = data.campaigns || [];
  $('#campaignCount').textContent = rows.length;
  $('#campaignSubtitle').textContent =
    `${shop.countryName || shop.countryCode} · ${shop.brandName || shop.brandCode} · ${shop.displayName}`;
  renderCampaignSummary(rows, shop);

  if (!rows.length) {
    $('#campaignRows').innerHTML = '<tr><td colspan="6" class="empty">这个区间没有 Campaign 数据。</td></tr>';
    return;
  }

  $('#campaignRows').innerHTML = rows.map(row => {
    const p = row.performance || {};
    const spendRatio = p.broadGmv ? p.expense / p.broadGmv : null;
    const status = row.status || row.campaignTypeRaw || 'unknown';
    return `<tr data-campaign="${row.campaignId}">
      <td><div class="campaign-name"><strong>#${row.campaignId}</strong><small>${escapeHtml(row.biddingMethod || row.adType || '')}</small></div></td>
      <td>${num(p.broadOrders)}</td>
      <td>${roas(p.broadRoas)}</td>
      <td class="${spendRatio > .15 ? 'negative' : ''}">${spendRatio == null ? '—' : pct(spendRatio)}</td>
      <td>${row.targetRoas == null ? '—' : roas(row.targetRoas)}</td>
      <td><span class="pill neutral">${escapeHtml(status)}</span></td>
    </tr>`;
  }).join('');

  $$('[data-campaign]').forEach(row => {
    row.addEventListener('click', () => loadAnalysis(Number(row.dataset.campaign)));
  });
}

async function loadCampaigns() {
  const shop = selectedShop();
  if (!shop) return;
  const filters = currentFilters();
  const params = new URLSearchParams({
    shop_id: String(shop.shopId),
    start_date: filters.startDate,
    end_date: filters.endDate,
  });
  const data = await json(`/api/shopee-analytics/campaigns?${params}`);
  renderCampaigns(data, shop);
}

function switchAdsType(type) {
  if (!['gms', 'manual', 'auto', 'groups'].includes(type)) return;
  state.adsType = type;
  $$('.ads-type-tab').forEach(button =>
    button.classList.toggle('active', button.dataset.adsType === type)
  );
  $('#adsGmsPanel').classList.toggle('hidden', type !== 'gms');
  $('#adsManualPanel').classList.toggle('hidden', type !== 'manual');
  $('#adsAutoPanel').classList.toggle('hidden', type !== 'auto');
  $('#adsGroupImportPanel').classList.toggle('hidden', type !== 'groups');
  loadCurrentView();
}

function renderAdGroupScopeGate(payload) {
  state.adGroupPreview = payload;
  const sourceShopId = Number(payload.sourceShopId ?? payload.shopId);
  const sourceShopName = payload.sourceShopName ?? payload.shopName ?? '未提供';
  const exactScope = state.shopScopes.find(scope => scope.shopId === sourceShopId) || null;
  const current = selectedShop();
  const select = $('#adGroupTargetShop');
  const targetOptions = [`<option value="">请选择确认导入的目标 Shop</option>`]
    .concat(state.shopScopes.map(scope => `<option value="${scope.shopId}">${escapeHtml(scope.displayName)} · ${scope.shopId}${scope.oauthAuthorized ? ' · OAuth API' : ' · import-only'}</option>`));
  select.innerHTML = targetOptions.join('');
  select.disabled = false;
  select.value = exactScope ? String(sourceShopId) : '';
  const anotherShop = current && current.shopId !== sourceShopId;
  $('#adGroupScopeNotice').textContent = anotherShop
    ? `This report belongs to another shop: ${sourceShopId} (${sourceShopName}). Import into current shop is blocked.`
    : exactScope
      ? `报告来源店铺 ${sourceShopId} 已注册。确认导入只能选择同一 Shop ID。`
      : `报告来源店铺 ${sourceShopId} 尚未注册。请先明确注册为 import-only 店铺。`;
  $('#adGroupRegisterImportOnlyBtn').disabled = Boolean(exactScope);
  $('#adGroupRegisterImportOnlyBtn').textContent = `注册 import-only 店铺 ${sourceShopId}`;
  $('#adGroupScopeGate').classList.remove('hidden');
  updateAdGroupImportButton();
}

function updateAdGroupImportButton() {
  const preview = state.adGroupPreview;
  const sourceShopId = Number(preview && (preview.sourceShopId ?? preview.shopId));
  const targetShopId = Number($('#adGroupTargetShop').value);
  const targetScope = state.shopScopes.find(scope => scope.shopId === targetShopId);
  $('#adGroupImportBtn').disabled = !preview || !targetScope || sourceShopId !== targetShopId || Boolean(preview.persisted);
}

async function loadShopScopes() {
  const data = await json('/api/shopee-analytics/shop-scopes');
  state.shopScopes = data.shopScopes || [];
}

function renderAdGroupImportResult(payload) {
  const summary = [`${payload.adGroupCount || 0} 个广告组`, `${payload.itemRowCount || 0} 个商品行`, `${payload.periodStart || '—'} 至 ${payload.periodEnd || '—'} · ${payload.granularity || '—'}`, `完整 ${payload.completeCount || 0} · 部分 ${payload.partialCount || 0} · 不一致 ${payload.mismatchCount || 0}`];
  const warning = (payload.warnings || []).length ? `<p class="product-ad-note">质量提示：${escapeHtml((payload.warnings || []).map(x => x.code || x).join('、'))}</p>` : '';
  const source = `来源 Shop ID：${payload.sourceShopId ?? payload.shopId ?? '—'} · 来源店名：${payload.sourceShopName ?? payload.shopName ?? '未提供'} · 报告来源：${payload.reportSource || 'SHOPEE_AD_GROUP_EXPORT'}`;
  $('#adGroupImportResult').innerHTML = `<strong>${payload.persisted ? '已按幂等键写入' : '预览完成，尚未写入'}</strong><p>${escapeHtml(source)}</p><p>${escapeHtml(summary.join('；'))}</p>${warning}`;
  if (!payload.persisted) renderAdGroupScopeGate(payload);
  else $('#adGroupImportBtn').disabled = true;
}

async function uploadAdGroup({ persist = false } = {}) {
  const file = $('#adGroupFile').files && $('#adGroupFile').files[0];
  if (!file) throw new Error('请先选择 CSV 或 XLSX 文件');
  const query = new URLSearchParams({ filename: file.name });
  if (persist) {
    query.set('confirm', 'YES');
    query.set('target_shop_id', $('#adGroupTargetShop').value);
  }
  const response = await fetch(`/api/shopee-analytics/ad-groups/import?${query}`, { method: 'POST', headers: { 'content-type': file.type || (file.name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv') }, body: file });
  const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`${payload.error || 'REQUEST_FAILED'}: ${payload.message || `HTTP ${response.status}`}`); if (!persist) await loadShopScopes(); renderAdGroupImportResult(payload);
}

async function registerImportOnlyScope() {
  const preview = state.adGroupPreview;
  if (!preview) throw new Error('请先预览报告');
  const shopId = Number(preview.sourceShopId ?? preview.shopId);
  const response = await fetch('/api/shopee-analytics/shop-scopes/import-only', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shopId, importSourceShopName: preview.sourceShopName ?? preview.shopName ?? null }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${payload.error || 'REQUEST_FAILED'}: ${payload.message || `HTTP ${response.status}`}`);
  await loadShopScopes(); renderAdGroupScopeGate(preview);
}

function productAdDiagnosis(row) {
  const p = row.performance || {};
  if (!p.broadOrders && p.expense > 0) return '有花费无订单';
  if (row.targetRoas && p.broadRoas < row.targetRoas) return '低于Target';
  if (p.broadOrders >= 25) return '订单样本较充分';
  return '继续积累样本';
}

function renderProductAds(data, shop) {
  const type = data.adType;
  const rows = data.campaigns || [];
  const targetId = type === 'manual' ? '#manualAdRows' : '#autoAdRows';
  const countId = type === 'manual' ? '#manualAdCount' : '#autoAdCount';
  $(countId).textContent = `${num(rows.length)} 个`;

  $(targetId).innerHTML = rows.length
    ? rows.map(row => {
        const p = row.performance || {};
        const diagnosis = productAdDiagnosis(row);
        return `<tr data-product-ad-campaign="${row.campaignId}" data-product-ad-type="${type}">
          <td><div class="campaign-name"><strong>#${row.campaignId}</strong><small>${escapeHtml(row.biddingMethod || row.adType || '')}</small></div></td>
          <td><span class="pill neutral" title="${escapeHtml(diagnosis)}">${escapeHtml(row.status || diagnosis)}</span></td>
          <td>${row.campaignBudget == null ? '—' : formatMoney(row.campaignBudget, shop.currency)}</td>
          <td>${num(p.broadOrders)}</td>
          <td>${num(p.directOrders)}</td>
          <td>${roas(p.broadRoas)}</td>
          <td>${roas(p.directRoas)}</td>
          <td>${pct(p.ctr)}</td>
          <td>${pct(p.broadCvr)}</td>
          <td>${formatMoney(p.expense, shop.currency)}</td>
          <td>${row.targetRoas == null ? '—' : roas(row.targetRoas)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="11" class="empty">当前周期没有${type === 'manual' ? '单品广告' : '全店广告'}数据。</td></tr>`;

  $$('[data-product-ad-campaign]').forEach(row => {
    if (row.dataset.productAdType !== type) return;
    row.addEventListener('click', () => loadProductAdDetail(type, Number(row.dataset.productAdCampaign)));
  });
}

async function loadProductAds(type) {
  const shop = selectedShop();
  if (!shop) return;
  const filters = currentFilters();
  const params = new URLSearchParams({
    shop_id: String(shop.shopId),
    start_date: filters.startDate,
    end_date: filters.endDate,
    ad_type: type,
  });
  const data = await json(`/api/shopee-analytics/product-ads?${params}`);
  renderProductAds(data, shop);
}

function renderProductAdDetail(data) {
  const d = data.diagnosis || {};
  const p = d.performance || {};
  const setting = data.latestSetting || {};
  const detailId = data.adType === 'manual' ? '#manualAdDetail' : '#autoAdDetail';
  const itemLabel = data.adType === 'manual' ? '关联商品' : '当前自动选品';

  $(detailId).innerHTML = `
    <div class="product-ad-detail-head">
      <div>
        <div class="section-label">${data.adType === 'manual' ? 'MANUAL PRODUCT AD' : 'AUTO PRODUCT AD'}</div>
        <h3>${escapeHtml(setting.adName || data.campaign.adName || ('Campaign #' + data.campaignId))}</h3>
        <p>${escapeHtml(setting.campaignPlacement || data.campaign.campaignPlacement || 'placement 未返回')} · ${escapeHtml(setting.biddingMethod || data.campaign.biddingMethod || 'bidding 未返回')}</p>
      </div>
      <span class="pill neutral">${escapeHtml(d.primarySignal || '等待数据')}</span>
    </div>
    <div class="product-ad-detail-metrics">
      ${metric('周等效订单', Number(d.weeklyEquivalentOrders || 0).toFixed(1), `门槛 ${num(d.weeklyOrderReference || 25)}`)}
      ${metric('Broad ROAS', roas(p.broadRoas), d.targetRoas ? `Target ${roas(d.targetRoas)}` : '无Target')}
      ${metric('CTR', pct(p.ctr), `${num(p.clicks)} clicks`)}
      ${metric('Broad CVR', pct(p.broadCvr), `${num(p.broadOrders)} orders`)}
      ${metric('广告花费', formatMoney(p.expense, selectedShop().currency), `${data.startDate} → ${data.endDate}`)}
      ${metric(itemLabel, num(data.items.length), data.adType === 'auto' ? '仅真实Membership' : '不假设永远只有1个')}
    </div>
    <div class="product-ad-action"><strong>下一步</strong><span>${escapeHtml(d.action || '继续观察。')}</span></div>
  `;

  const items = data.items || [];
  if (data.adType === 'auto') {
    $('#autoAdItems').innerHTML = items.length
      ? `<strong>当前自动选品范围 · ${num(items.length)} 个商品</strong>
         <div class="product-ad-item-list">${items.map(item =>
           `<span><b>${escapeHtml(item.itemName || ('Item #' + item.itemId))}</b><small>${escapeHtml(item.itemSku || String(item.itemId))} · ${escapeHtml(item.autoProductStatus || item.membershipState || 'ACTIVE')}</small></span>`
         ).join('')}</div>
         <div class="product-ad-note">${escapeHtml(data.itemPerformanceNote || '')}</div>`
      : '<div class="empty-inline">当前没有可用的真实 Membership 快照；系统不会用广告表现反推自动选品。</div>';
  }
}

async function loadProductAdDetail(type, campaignId) {
  const shop = selectedShop();
  if (!shop) return;
  const filters = currentFilters();
  const params = new URLSearchParams({
    shop_id: String(shop.shopId),
    start_date: filters.startDate,
    end_date: filters.endDate,
    ad_type: type,
  });
  const data = await json(`/api/shopee-analytics/product-ads/${campaignId}/detail?${params}`);
  renderProductAdDetail(data);
}

function metric(label, value, sub = '', cls = '') {
  return `<div class="metric"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${escapeHtml(sub)}</div></div>`;
}

function miniMetrics(p, currency) {
  return [
    `<div><strong>${num(p.broadOrders)}</strong><span>订单</span></div>`,
    `<div><strong>${roas(p.broadRoas)}</strong><span>ROAS</span></div>`,
    `<div><strong>${formatMoney(p.expense, currency)}</strong><span>花费</span></div>`,
  ].join('');
}

function renderAnalysis(data) {
  const shop = selectedShop();
  const d = data.diagnosis;
  const c = d.campaign;

  $('#diagnosisTitle').textContent = `Campaign #${data.campaignId}`;
  $('#diagnosisSubtitle').textContent =
    `${shop.displayName} · ${data.startDate} → ${data.endDate} · ${c.days} 个数据日`;
  $('#diagnosisState').textContent = stateLabel(c.maturityStatus || c.roasState);
  $('#diagnosisState').className = `pill ${stateClass(c.maturityStatus || c.roasState)}`;

  const template = $('#diagnosisTemplate').content.cloneNode(true);
  $('#diagnosisBody').replaceChildren(template);

  $('#campaignMetrics').innerHTML = [
    metric('订单量', num(c.broadOrders), `周等效 ${Number(c.weeklyEquivalentOrders || 0).toFixed(1)} · ${stateLabel(c.volumeState)}`),
    metric('Broad ROAS', roas(c.broadRoas), `Target ${roas(c.targetRoas)}`, c.broadRoas >= c.targetRoas && c.targetRoas ? 'positive' : ''),
    metric('广告花费占比', pct(c.adCostRatio), `硬约束 ≤ ${pct(c.adSpendRatioLimit)} / 对应ROAS ≥ ${roas(c.spendLimitRoas)}`, c.spendLimitState === 'OVER_SPEND_LIMIT' ? 'negative' : 'positive'),
    metric('CTR', pct(c.ctr), `${num(c.clicks)} clicks / ${num(c.impressions)} impressions`),
    metric('Broad CVR', pct(c.broadCvr), '订单 / 点击'),
    metric('Direct ROAS', roas(c.directRoas), '用于观察广告商品自身'),
    metric('Direct订单', num(c.directOrders), `Broad订单 ${num(c.broadOrders)}`),
    metric('CPC', formatMoney(c.cpc, shop.currency), c.targetVsRecommended || ''),
    metric('预算利用率', c.budgetUtilization == null ? '—' : pct(c.budgetUtilization), c.dailyBudget ? `日预算 ${formatMoney(c.dailyBudget, shop.currency)} / 日均花费 ${formatMoney(c.avgDailySpend, shop.currency)}` : '未读取日预算'),
  ].join('');

  const maturity = c.maturity || {};
  const maturityEvidence = maturity.evidence || {};
  const maturityDiagnostics = maturity.diagnostics || {};
  const evidenceLabel = (key, label) => {
    const value = maturityEvidence[key];
    const cls = value === true ? 'good' : value === false ? 'bad' : 'neutral';
    const text = value === true ? '已满足' : value === false ? '未满足' : '待更多数据';
    return `<div><span>${escapeHtml(label)}</span><strong class="${cls}">${text}</strong></div>`;
  };
  $('#maturityBox').innerHTML = `
    <div class="section-label">MATURITY · 成熟度判断</div>
    <div class="quality-summary">
      <div><span>当前阶段</span><strong>${escapeHtml(stateLabel(c.maturityStatus || 'UNKNOWN'))}</strong></div>
      <div><span>Confidence</span><strong>${escapeHtml(maturity.confidence || '—')}</strong></div>
      <div><span>稳定证据</span><strong>${num(maturity.evidencePassed)} / ${num(maturity.evidenceEvaluated)}</strong></div>
      <div><span>SKU花费日均变动</span><strong>${maturityDiagnostics.allocationMeanAbsDelta == null ? '—' : pct(maturityDiagnostics.allocationMeanAbsDelta)}</strong></div>
    </div>
    <div class="quality-summary maturity-evidence">
      ${evidenceLabel('sample', 'Direct订单样本')}
      ${evidenceLabel('allocation', 'SKU花费分配')}
      ${evidenceLabel('orderSource', '订单来源持续性')}
      ${evidenceLabel('cvr', 'CVR稳定性')}
      ${evidenceLabel('roas', 'ROAS稳定性')}
      ${evidenceLabel('scale', '扩量承接')}
    </div>
    <div class="quality-ok">7天仅为最低观察窗口；25 Direct Orders 为内部成熟度参考，不是 Shopee 官方“学习完成”规则。</div>
  `;

  const explanation = maturity.explanation || {};
  const leader = maturityDiagnostics.leader || {};
  const scale = maturityDiagnostics.scale || {};
  $('#maturityBox').innerHTML += `
    <div class="maturity-explanation">
      <strong>${escapeHtml(explanation.headline || '')}</strong>
      <div class="maturity-columns">
        <div><span>当前卡点</span>${(explanation.blockers || []).length
          ? (explanation.blockers || []).map(x => `<p>• ${escapeHtml(x)}</p>`).join('')
          : '<p>• 暂无主要稳定性卡点</p>'}</div>
        <div><span>已形成证据</span>${(explanation.positives || []).length
          ? (explanation.positives || []).map(x => `<p>• ${escapeHtml(x)}</p>`).join('')
          : '<p>• 继续累计数据</p>'}</div>
      </div>
      <div class="quality-summary">
        <div><span>连续主力 SKU</span><strong>${leader.leaderItemId ? '#' + escapeHtml(leader.leaderItemId) : '—'}</strong></div>
        <div><span>主力连续率</span><strong>${leader.continuity == null ? '—' : pct(leader.continuity)}</strong></div>
        <div><span>扩量 CVR 保持</span><strong>${scale.cvrRetention == null ? '—' : pct(scale.cvrRetention)}</strong></div>
        <div><span>扩量 ROAS 保持</span><strong>${scale.roasRetention == null ? '—' : pct(scale.roasRetention)}</strong></div>
      </div>
    </div>
  `;

  const quality = data.dataQuality || {};
  const qualityWarnings = quality.warnings || [];
  $('#dataQualityBox').innerHTML = `
    <div class="quality-summary">
      <div><span>商品层花费覆盖</span><strong>${quality.spendCoverage == null ? '—' : pct(quality.spendCoverage)}</strong></div>
      <div><span>成员 Performance 覆盖</span><strong>${quality.itemCoverage == null ? '—' : pct(quality.itemCoverage)}</strong></div>
      <div><span>广告组成员</span><strong>${num(quality.membershipCount)}</strong></div>
      <div><span>有表现商品</span><strong>${num(quality.performanceItemCount)}</strong></div>
    </div>
    ${qualityWarnings.length
      ? `<div class="quality-warnings">${qualityWarnings.map(warning => `<div>⚠ ${escapeHtml(warning.message)}</div>`).join('')}</div>`
      : '<div class="quality-ok">数据覆盖未发现明显异常。</div>'}
  `;

  $('#actionList').innerHTML = (d.actions || []).length
    ? d.actions.map(action => `<div class="action-card">
        <div class="action-code">${escapeHtml(action.code)}</div>
        <strong>${escapeHtml(action.title)}</strong>
        <p>${escapeHtml(action.reason || '')}</p>
        <div class="action-do">${escapeHtml(action.action || '')}</div>
      </div>`).join('')
    : '<div class="empty-inline">当前没有结构性动作，继续观察完整周期。</div>';

  const operationGuard = d.operationGuard || {};
  const operationGuardHtml = operationGuard.blocked
    ? `<div class="quality-warnings"><div>⚠ 操作观察期：${escapeHtml(operationGuard.reason || '')}</div></div>`
    : '<div class="quality-ok">最近结构性操作未触发冷却阻断。</div>';

  $('#actionGateList').innerHTML = operationGuardHtml + ((d.actionGates || []).length
    ? `<div class="section-label">STRUCTURAL ACTION GATES · 结构性动作前置条件</div>` +
      d.actionGates.map(gate => `<div class="action-card ${gate.allowed ? 'gate-allowed' : 'gate-blocked'}">
        <div class="action-code">${escapeHtml(gate.code)}</div>
        <strong>${escapeHtml(gate.title)} · ${gate.allowed ? '允许受控验证' : '当前阻断'}</strong>
        <p>${escapeHtml(gate.reason || '')}</p>
      </div>`).join('')
    : '');

  $('#ordinaryMetrics').innerHTML = miniMetrics(data.baseline.ordinary || {}, shop.currency);
  $('#eventMetrics').innerHTML = miniMetrics(data.baseline.event || {}, shop.currency);

  const items = d.items || [];
  $('#itemRows').innerHTML = items.length ? items.map(item => {
    const rec = item.recommendedRoi && item.recommendedRoi.exact
      ? roas(item.recommendedRoi.exact.value)
      : '—';
    return `<tr data-item="${item.itemId}">
      <td><div class="item-name"><strong>${escapeHtml(item.itemSku || ('#' + item.itemId))}</strong><small>${escapeHtml(item.itemName || '')}</small></div></td>
      <td title="${escapeHtml(item.action && item.action.action || '')}"><span class="state ${itemStateClass(item.state)}">${escapeHtml(stateLabel(item.state))}</span></td>
      <td title="Signal 与 Confidence 分开；高ROAS小样本不会自动成为主力">${escapeHtml(item.signalConfidence && item.signalConfidence.confidence || '—')}</td>
      <td title="内部分析模型，不是 Shopee 官方字段"><span class="state">${escapeHtml(item.trafficStage || '—')}</span></td>
      <td title="${escapeHtml(item.scaleEligibility && item.scaleEligibility.reason || '')}">${item.scaleEligibility && item.scaleEligibility.eligible ? '可受控验证' : '暂不放大'}</td>
      <td>${num(item.directOrders)}</td>
      <td>${roas(item.directRoas)}</td>
      <td title="商品自身保本ROAS；0表示尚未配置">${item.itemBreakEvenRoas ? roas(item.itemBreakEvenRoas) : '未配置'}</td>
      <td title="max(商品保本ROAS, 店铺广告花费占比约束对应ROAS)">${roas(item.viabilityRoas)}</td>
      <td>${roas(item.broadRoas)}</td>
      <td>${pct(item.spendShare)}</td>
      <td>${pct(item.directGmvShare)}</td>
      <td>${pct(item.ctr)}</td>
      <td>${pct(item.directCvr)}</td>
      <td>${item.productCard ? pct(item.productCard.conversionRate) : '—'}</td>
      <td>${item.productCard ? pct(item.productCard.addToCartRate) : '—'}</td>
      <td>${rec}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="17" class="empty">没有商品层数据。</td></tr>';

  $('#diagnosisNotes').innerHTML =
    (d.notes || []).map(note => `<div>• ${escapeHtml(note)}</div>`).join('');

  $$('[data-item]').forEach(row => {
    row.addEventListener('click', event => {
      event.stopPropagation();
      loadItemTimeline(Number(row.dataset.item), row);
    });
  });
}

function timelineDetail(event) {
  const d = event.detail || {};
  const shop = selectedShop();

  if (event.type === 'VOUCHER_START') {
    return [
      d.percentage == null ? null : `折扣 ${(Number(d.percentage) <= 1 ? Number(d.percentage) * 100 : Number(d.percentage)).toFixed(1)}%`,
      d.discountAmount == null ? null : `固定减免 ${formatMoney(d.discountAmount, shop && shop.currency)}`,
      d.minBasketPrice == null ? null : `门槛 ${formatMoney(d.minBasketPrice, shop && shop.currency)}`,
    ].filter(Boolean).join(' · ');
  }
  if (event.type === 'DISCOUNT_START') {
    return [
      d.originalPrice == null ? null : `原价 ${formatMoney(d.originalPrice, shop && shop.currency)}`,
      d.promotionPrice == null ? null : `活动价 ${formatMoney(d.promotionPrice, shop && shop.currency)}`,
      d.modelId ? `Model #${d.modelId}` : null,
    ].filter(Boolean).join(' · ');
  }
  if (event.type === 'RETURN') {
    return [
      d.status || null,
      d.quantity == null ? null : `${d.quantity} 件`,
      d.refundAmount == null ? null : `退款 ${formatMoney(d.refundAmount, d.currency || (shop && shop.currency))}`,
    ].filter(Boolean).join(' · ');
  }
  if (event.type === 'RECOMMENDED_ROAS') {
    return `预估范围 ${roas(d.lower)} / ${roas(d.exact)} / ${roas(d.upper)}`;
  }
  if (event.type === 'PRICE_CHANGE') {
    const before = d.before || {};
    const after = d.after || {};
    return [
      after.modelSku || after.modelName || (after.modelId ? `Model #${after.modelId}` : null),
      before.currentPrice == null || after.currentPrice == null
        ? null
        : `${formatMoney(before.currentPrice, shop && shop.currency)} → ${formatMoney(after.currentPrice, shop && shop.currency)}`,
      before.originalPrice == null || after.originalPrice == null ||
        Number(before.originalPrice) === Number(after.originalPrice)
        ? null
        : `原价 ${formatMoney(before.originalPrice, shop && shop.currency)} → ${formatMoney(after.originalPrice, shop && shop.currency)}`,
    ].filter(Boolean).join(' · ');
  }
  if (event.type === 'CAMPAIGN_SETTING_CHANGE') {
    const before = d.before || {};
    const after = d.after || {};
    const changes = [];
    if (String(before.targetRoas ?? '') !== String(after.targetRoas ?? '')) {
      changes.push(`Target ROAS ${roas(before.targetRoas)} → ${roas(after.targetRoas)}`);
    }
    if (String(before.campaignBudget ?? '') !== String(after.campaignBudget ?? '')) {
      changes.push(`预算 ${formatMoney(before.campaignBudget, shop && shop.currency)} → ${formatMoney(after.campaignBudget, shop && shop.currency)}`);
    }
    if (String(before.status ?? '') !== String(after.status ?? '')) {
      changes.push(`状态 ${before.status || '—'} → ${after.status || '—'}`);
    }
    if (String(before.biddingMethod ?? '') !== String(after.biddingMethod ?? '')) {
      changes.push(`出价方式 ${before.biddingMethod || '—'} → ${after.biddingMethod || '—'}`);
    }
    return changes.join(' · ');
  }
  if (event.type === 'VOUCHER_CHANGE') {
    const before = d.before || {};
    const after = d.after || {};
    const changes = [];
    if (String(before.percentage ?? '') !== String(after.percentage ?? '')) {
      changes.push(`折扣 ${before.percentage ?? '—'} → ${after.percentage ?? '—'}`);
    }
    if (String(before.discountAmount ?? '') !== String(after.discountAmount ?? '')) {
      changes.push(`固定减免 ${formatMoney(before.discountAmount, shop && shop.currency)} → ${formatMoney(after.discountAmount, shop && shop.currency)}`);
    }
    if (String(before.minBasketPrice ?? '') !== String(after.minBasketPrice ?? '')) {
      changes.push(`门槛 ${formatMoney(before.minBasketPrice, shop && shop.currency)} → ${formatMoney(after.minBasketPrice, shop && shop.currency)}`);
    }
    if (JSON.stringify(before.itemIds || []) !== JSON.stringify(after.itemIds || [])) {
      changes.push('适用商品变化');
    }
    return changes.join(' · ') || 'Voucher配置变化';
  }
  if (event.type === 'DISCOUNT_CHANGE') {
    const beforeRows = Array.isArray(d.before && d.before.itemRows) ? d.before.itemRows : [];
    const afterRows = Array.isArray(d.after && d.after.itemRows) ? d.after.itemRows : [];
    const beforePrice = beforeRows[0] && beforeRows[0].promotionPrice;
    const afterPrice = afterRows[0] && afterRows[0].promotionPrice;
    const parts = [];
    if (beforePrice != null || afterPrice != null) {
      parts.push(`活动价 ${formatMoney(beforePrice, shop && shop.currency)} → ${formatMoney(afterPrice, shop && shop.currency)}`);
    }
    if (String(d.before && d.before.endTime || '') !== String(d.after && d.after.endTime || '')) {
      parts.push('活动结束时间变化');
    }
    return parts.join(' · ') || 'Discount配置变化';
  }
  if (event.type === 'SKU_ADDED_TO_CAMPAIGN') return '加入广告组';
  if (event.type === 'SKU_REMOVED_FROM_CAMPAIGN') return '移出广告组';
  return d.after ? JSON.stringify(d.after) : '';
}

async function loadItemTimeline(itemId, rowEl) {
  const shop = selectedShop();
  if (!shop) return;

  $$('[data-item]').forEach(row => row.classList.toggle('selected', row === rowEl));
  $('#timelineTitle').textContent = `SKU 时间线 · #${itemId}`;
  $('#timeline').innerHTML = '<div class="empty-inline">读取中…</div>';

  try {
    const filters = currentFilters();
    const params = new URLSearchParams({
      shop_id: String(shop.shopId),
      start_date: filters.startDate,
      end_date: filters.endDate,
    });
    const data = await json(`/api/shopee-analytics/items/${itemId}/timeline?${params}`);
    const events = data.events || [];
    $('#timeline').innerHTML = events.length ? events.map(event => `
      <div class="timeline-event">
        <div class="timeline-dot"></div>
        <div class="timeline-main">
          <div class="timeline-meta"><span>${escapeHtml(String(event.at).slice(0, 16).replace('T', ' '))}</span><b>${escapeHtml(event.type)}</b></div>
          <strong>${escapeHtml(event.title || event.type)}</strong>
          <p>${escapeHtml(timelineDetail(event))}</p>
        </div>
      </div>`).join('') : '<div class="empty-inline">这个周期没有已记录的运营事件。</div>';
  } catch (error) {
    $('#timeline').innerHTML = `<div class="empty-inline">${escapeHtml(error.message)}</div>`;
  }
}

async function loadAnalysis(campaignId) {
  const shop = selectedShop();
  if (!shop) return;

  state.selectedCampaignId = campaignId;
  $$('[data-campaign]').forEach(row => {
    row.classList.toggle('selected', Number(row.dataset.campaign) === campaignId);
  });
  $('#diagnosisState').textContent = '读取中';
  $('#diagnosisState').className = 'pill neutral';

  try {
    const filters = currentFilters();
    const params = new URLSearchParams({
      shop_id: String(shop.shopId),
      start_date: filters.startDate,
      end_date: filters.endDate,
    });
    const data = await json(`/api/shopee-analytics/campaigns/${campaignId}/analysis?${params}`);
    renderAnalysis(data);
  } catch (error) {
    $('#diagnosisBody').innerHTML =
      `<div class="empty-state"><strong>读取失败</strong><span>${escapeHtml(error.message)}</span></div>`;
    $('#diagnosisState').textContent = '错误';
    $('#diagnosisState').className = 'pill bad';
  }
}

function renderStatusPortfolio(data) {
  const statuses = data.statuses || [];
  const warningTotal = statuses.reduce(
    (sum, status) => sum + Number(status.warningCount || 0),
    0,
  );

  $('#statusPortfolioSummary').innerHTML = [
    portfolioKpi('店铺数', num(data.shopCount)),
    portfolioKpi('正常店铺', num(data.okShopCount)),
    portfolioKpi('异常店铺', num(data.errorShopCount)),
    portfolioKpi('提醒数量', num(warningTotal)),
    portfolioKpi('覆盖国家', num(new Set(statuses.map(row => row.shop.countryCode)).size)),
    portfolioKpi(
      '最近NAS备份',
      data.backup && data.backup.ok ? formatDateTime(data.backup.nasCopiedAt || data.backup.completedAt) : '未确认',
      data.backup && data.backup.restoreVerifiedAt
        ? `恢复验证 ${formatDateTime(data.backup.restoreVerifiedAt)}`
        : '恢复验证尚未记录',
    ),
  ].join('');
  $('#statusPortfolioSummary').classList.remove('hidden');

  $('#statusPortfolioRows').innerHTML = statuses.length
    ? statuses.map(row => `<tr data-status-shop="${row.shop.shopId}">
        <td>${escapeHtml(row.shop.countryName || row.shop.countryCode)}</td>
        <td>${escapeHtml(row.shop.brandName || row.shop.brandCode)}</td>
        <td><div class="shop-cell"><strong>${escapeHtml(row.shop.displayName)}</strong><small>#${row.shop.shopId}</small></div></td>
        <td><span class="pill ${row.ok ? 'good' : 'bad'}">${row.ok ? '正常' : '需处理'}</span></td>
        <td>${escapeHtml(formatDateTime(row.lastAnySyncAt))}</td>
        <td class="${row.errorCount ? 'negative' : ''}">${num(row.errorCount)}</td>
        <td>${num(row.warningCount)}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty">当前筛选没有店铺。</td></tr>';

  $$('[data-status-shop]').forEach(row => {
    row.addEventListener('click', () => {
      $('#shopSelect').value = row.dataset.statusShop;
      updateSingleShopPrompts();
      loadSystemStatus();
    });
  });
}

async function loadStatusPortfolio() {
  const filters = currentFilters();
  const params = new URLSearchParams();
  if (filters.country) params.set('country', filters.country);
  if (filters.brand) params.set('brand', filters.brand);

  const button = $('#refreshStatusPortfolioBtn');
  if (button) button.disabled = true;
  try {
    const data = await json(`/api/shopee-analytics/status/portfolio?${params}`);
    renderStatusPortfolio(data);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderSystemStatus(data) {
  const shop = selectedShop();
  const sources = data.sources || [];
  const tokens = data.tokens || [];
  const tokenByRole = new Map(tokens.map(token => [token.appRole, token]));
  const warnings = data.warnings || [];

  $('#statusTitle').textContent = `数据状态 · ${shop ? shop.displayName : ''}`;
  $('#statusSubtitle').textContent = data.ok
    ? '同步链路无严重错误；仍请关注单个数据源的新鲜度。'
    : '发现需要处理的数据连接问题，诊断结论可能不完整。';

  $('#sourceStatusGrid').innerHTML = sources.map(source => {
    const cls = freshnessClass(source.lastSyncedAt);
    return `<div class="source-card ${cls}">
      <div class="source-card-top">
        <strong>${escapeHtml(source.source)}</strong>
        <span class="source-state ${cls}">${freshnessLabel(source.lastSyncedAt)}</span>
      </div>
      <div class="source-date">最新数据：${escapeHtml(source.latestDataDate || '—')}</div>
      <div class="source-sync">同步：${escapeHtml(formatDateTime(source.lastSyncedAt))}</div>
    </div>`;
  }).join('');

  const requiredRoles = ['ADS', 'STORE_OPS', 'ERP', 'BRAND_PORTAL'];
  $('#sourceStatusGrid').insertAdjacentHTML('beforeend', backupStatusCard(data.backup));

  $('#sourceStatusGrid').insertAdjacentHTML('beforeend', requiredRoles.map(role => {
    const token = tokenByRole.get(role);
    const expires = token && token.expiresAt ? new Date(token.expiresAt) : null;
    const remainingHours = expires && !Number.isNaN(expires.getTime())
      ? (expires.getTime() - Date.now()) / 3600000
      : null;

    let cls = 'fresh';
    let label = '正常';
    if (!token) { cls = 'missing'; label = '未配置'; }
    else if (token.refreshError) { cls = 'stale'; label = '刷新失败'; }
    else if (remainingHours !== null && remainingHours <= 0) { cls = 'aging'; label = '待自动刷新'; }

    return `<div class="source-card token-card ${cls}">
      <div class="source-card-top">
        <strong>${role} Token</strong>
        <span class="source-state ${cls}">${label}</span>
      </div>
      <div class="source-date">过期：${escapeHtml(token ? formatDateTime(token.expiresAt) : '—')}</div>
      <div class="source-sync">上次刷新：${escapeHtml(token ? formatDateTime(token.lastRefreshAt) : '—')}</div>
    </div>`;
  }).join(''));

  const history = data.historyCoverage;
  const historyGrid = $('#historyCoverageGrid');
  const historyRange = $('#historyCoverageRange');
  const historyNote = $('#historyCoverageNote');

  if (history) {
    historyRange.textContent = `${history.startDate} → ${history.endDate}`;
    historyRange.className = 'pill neutral';
    historyGrid.innerHTML = [
      ['GMS日覆盖', history.gmsCampaignDayCoverage == null ? '—' : pct(history.gmsCampaignDayCoverage),
        history.campaignCount ? `${num(history.campaignDayRows)} / ${num(history.expectedGmsCampaignDayRows)} campaign-days` : '暂无已识别GMS Campaign'],
      ['Shop BI日覆盖', pct(history.shopBiDayCoverage),
        `${num(history.shopBiDays)} / ${num(history.expectedDays)} days`],
      ['订单记录', num(history.orders), '事件型数据，不计算每日覆盖率'],
      ['退货/退款记录', num(history.returns), '事件型数据，不计算每日覆盖率'],
      ['商品主数据', num(history.products), '当前商品 / Model 状态'],
      ['Voucher / Discount', `${num(history.vouchers)} / ${num(history.discounts)}`, '平台仍可返回的活动记录'],
      ['Product Card', num(history.productCardPeriodRows), '与完整历史区间精确匹配的导入行'],
      ['Membership快照日', num(history.membershipSnapshotDays), '只信任真实成员快照，不由广告表现反推'],
    ].map(([label,value,sub]) => `
      <div class="history-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(sub)}</small>
      </div>`).join('');

    const notes = [
      ...(history.limitations || []),
      history.backfillErrorCount
        ? `有 ${history.backfillErrorCount} 个历史回填状态仍记录错误。`
        : null,
    ].filter(Boolean);
    historyNote.innerHTML = notes.map(note => `<div>• ${escapeHtml(note)}</div>`).join('');
    historyNote.classList.toggle('hidden', notes.length === 0);
  } else {
    historyRange.textContent = '未配置起始日期';
    historyRange.className = 'pill warn';
    historyGrid.innerHTML =
      '<div class="empty-inline">这个店铺还没有 analyticsStartDate，暂时无法判断历史数据完整度。</div>';
    historyNote.innerHTML = '';
    historyNote.classList.add('hidden');
  }

  const warningBox = $('#systemWarnings');
  if (warnings.length) {
    warningBox.innerHTML = warnings.map(warning => `
      <div class="warning-row ${warning.severity || 'warning'}">
        <span>${escapeHtml(warning.code)}</span>
        <strong>${escapeHtml(warning.message)}</strong>
      </div>`).join('');
    warningBox.classList.remove('hidden');
  } else {
    warningBox.innerHTML = '';
    warningBox.classList.add('hidden');
  }
  $('#systemStatus').classList.remove('hidden');
}

async function loadSystemStatus() {
  const shop = selectedShop();
  if (!shop) return;
  const button = $('#refreshStatusBtn');
  if (button) button.disabled = true;

  try {
    const data = await json(`/api/shopee-analytics/status?shop_id=${shop.shopId}`);
    renderSystemStatus(data);
  } catch (error) {
    $('#systemStatus').classList.remove('hidden');
    $('#statusSubtitle').textContent = `数据状态读取失败：${error.message}`;
    $('#sourceStatusGrid').innerHTML = '';
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadCurrentView() {
  updateSingleShopPrompts();
  if (!$('#startDate').value || !$('#endDate').value) return;

  const button = $('#loadBtn');
  button.disabled = true;
  button.textContent = '读取中…';
  try {
    if (state.view === 'overview') await loadPortfolio();
    else if (state.view === 'store' && selectedShop()) await loadStoreDetail();
    else if (state.view === 'ads' && state.adsType === 'groups') return;
    else if (state.view === 'ads' && selectedShop()) {
      if (state.adsType === 'gms') await loadCampaigns();
      else await loadProductAds(state.adsType);
    }
    else if (state.view === 'status') {
      if (selectedShop()) await loadSystemStatus();
      else await loadStatusPortfolio();
    }
  } catch (error) {
    if (state.view === 'overview') {
      $('#portfolioRows').innerHTML =
        `<tr><td colspan="14" class="empty">${escapeHtml(error.message)}</td></tr>`;
    } else if (state.view === 'ads' && state.adsType !== 'groups') {
      const target = state.adsType === 'gms' ? '#campaignRows' : state.adsType === 'manual' ? '#manualAdRows' : '#autoAdRows';
      const colspan = state.adsType === 'gms' ? 6 : 11;
      $(target).innerHTML = `<tr><td colspan="${colspan}" class="empty">${escapeHtml(error.message)}</td></tr>`;
    } else {
      $('#statusSubtitle').textContent = error.message;
    }
  } finally {
    button.disabled = false;
    button.textContent = '读取分析';
  }
}

function onDimensionChanged() {
  renderShopOptions();
  updateSingleShopPrompts();
}

function onShopChanged() {
  state.selectedCampaignId = null;
  updateSingleShopPrompts();
  if (state.view !== 'overview') loadCurrentView();
}

async function init() {
  initDates();
  await checkHealth();
  try {
    await loadShopDirectory();
    await loadCurrentView();
  } catch (error) {
    $('#portfolioRows').innerHTML =
      `<tr><td colspan="14" class="empty">${escapeHtml(error.message)}</td></tr>`;
  }
}

$$('.view-tab').forEach(button => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});
$$('.ads-type-tab').forEach(button => {
  button.addEventListener('click', () => switchAdsType(button.dataset.adsType));
});
$('#countryFilter').addEventListener('change', onDimensionChanged);
$('#brandFilter').addEventListener('change', onDimensionChanged);
$('#shopSelect').addEventListener('change', onShopChanged);
$('#loadBtn').addEventListener('click', loadCurrentView);
$('#refreshStatusBtn').addEventListener('click', loadSystemStatus);
$('#refreshStatusPortfolioBtn').addEventListener('click', loadStatusPortfolio);
$('#adGroupPreviewBtn').addEventListener('click', () => uploadAdGroup().catch(error => { $('#adGroupImportResult').textContent = error.message; }));
$('#adGroupImportBtn').addEventListener('click', () => uploadAdGroup({ persist: true }).catch(error => { $('#adGroupImportResult').textContent = error.message; }));
$('#adGroupTargetShop').addEventListener('change', updateAdGroupImportButton);
$('#adGroupRegisterImportOnlyBtn').addEventListener('click', () => registerImportOnlyScope().catch(error => { $('#adGroupImportResult').textContent = error.message; }));

init();
