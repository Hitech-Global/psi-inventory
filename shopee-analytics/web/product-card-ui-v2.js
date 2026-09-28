'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const sl = key => window.ShopeeMetricLabels?.label(key) || key;
  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const present = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const int = value => present(value)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value))
    : '—';
  const fixed2 = value => present(value)
    ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))
    : '—';
  const pct2 = value => present(value) ? `${(Number(value) * 100).toFixed(2)}%` : '—';
  const money2 = value => present(value) ? fixed2(value) : '—';
  const addIsoDays = (value, days) => {
    const d = new Date(`${value}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const rangeDays = (start, end) => Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000) + 1;
  const comparisonRange = (start, end) => {
    const days = rangeDays(start, end);
    return { startDate: addIsoDays(start, -days), endDate: addIsoDays(start, -1), days };
  };
  const delta = (current, previous) => {
    if (!present(current) || !present(previous)) return null;
    const c = Number(current), p = Number(previous);
    if (p === 0) return c === 0 ? 0 : null;
    return (c - p) / Math.abs(p);
  };
  function changeHtml(current, previous) {
    const d = delta(current, previous);
    if (d === null) return '<small class="metric-change neutral">—</small>';
    const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'neutral';
    const sign = d > 0 ? '+' : '';
    return `<small class="metric-change ${cls}">${sign}${(d * 100).toFixed(1)}%</small>`;
  }
  function metricTd(current, formatter, previous) {
    const sort = present(current) ? Number(current) : '';
    return `<td data-sort-value="${sort}"><div class="metric-cell"><span>${formatter(current)}</span>${changeHtml(current, previous)}</div></td>`;
  }
  const OVERVIEW_METRICS = [
    ['展示次数','impressions',int],['点击数','clicks',int],['点击率','ctr',pct2],['订单量','broadOrders',int],
    ['商品已出售','broadUnits',int],['销售额','broadGmv',money2],['花费','expense',money2],['广告支出回报率','broadRoas',fixed2],
    ['优惠券金额','voucherAmount',money2],['优惠券带来的销售额','voucheredSales',money2],['加购次数','addToCart',int],['加购率','addToCartRate',pct2],
  ];
  const SUPPLEMENTAL_OVERVIEW_KEYS = new Set(['voucherAmount','voucheredSales','addToCart','addToCartRate']);
  function supplementalStatus(data, key) {
    const info = data?.supplementalCoverage?.[key];
    if (!info) return '等待 Seller Centre 总览数据';
    if (info.complete) return info.exactRange ? 'Seller Centre evidence' : 'Seller Centre 每日 evidence 完整';
    if (info.availableDays) return `Seller Centre 覆盖 ${info.availableDays}/${info.expectedDays} 天`;
    return '等待 Seller Centre 总览数据';
  }

  let shopDirectory = [];
  let lastGroupRows = [];
  let refreshSeq = 0;

  async function api(url) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function selectedContext() {
    const shopId = Number($('#shopSelect')?.value || 0);
    return {
      shopId,
      startDate: $('#startDate')?.value || '',
      endDate: $('#endDate')?.value || '',
      shop: shopDirectory.find(row => Number(row.shopId) === shopId) || null,
    };
  }

  function activeType() {
    return $('.ads-type-tab.active')?.dataset.adsType || 'manual';
  }

  function setPanelVisibility(type) {
    $('#adsGmsPanel')?.classList.remove('hidden');
    $('#adsGmvMaxPanel')?.classList.add('hidden');
    $('#adsManualPanel')?.classList.toggle('hidden', type !== 'manual');
    $('#adsAutoPanel')?.classList.toggle('hidden', type !== 'auto');
    $('#adsGroupImportPanel')?.classList.toggle('hidden', type !== 'groups');
  }

  function injectStyles() {
    if ($('#productCardUiV2Styles')) return;
    const style = document.createElement('style');
    style.id = 'productCardUiV2Styles';
    style.textContent = `
      .product-card-parent{display:none!important}
      .product-card-parent h2{margin:1px 0 2px;font-size:16px}.product-card-parent p{margin:0;color:#6e6e73;font-size:11px}.product-card-parent .section-label{margin:0 0 2px;font-size:9px}
      .product-card-context{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      .product-card-legacy-hidden{display:none!important}
      .product-card-overview{display:grid;gap:14px}.product-card-overview .kpi-grid{margin-bottom:0}
      .product-card-daily-panel{background:#fff;border:1px solid #e6e6e8;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,.035)}
      .product-card-daily-panel .panel-head{border-bottom:1px solid #ececef}
      .metric-exact{font-variant-numeric:tabular-nums}
      .metric-cell{display:flex;flex-direction:column;gap:3px;align-items:flex-start;min-height:36px}.metric-cell>span{font-variant-numeric:tabular-nums}.metric-change{font-size:10px;line-height:1.15;font-weight:650}.metric-change.up{color:#2db55d}.metric-change.down{color:#ff4d36}.metric-change.neutral{color:#a1a1a6}
      #adGroupRows tr[data-ad-group-index]{cursor:pointer}#adGroupRows tr[data-ad-group-index]:hover{background:#f8fbff}#adGroupRows tr.selected{background:#eef6ff}
      .ad-group-inline-detail>td{padding:0!important;background:#fbfbfc;border-bottom:1px solid #ececef}.ad-group-inline-box{padding:0 0 12px}
      .ad-group-inline-box .panel-head{padding:12px 18px}.ad-group-inline-box .table-wrap{max-height:420px;border-top:1px solid #ececef}
      .ad-group-item-name{display:flex;flex-direction:column;gap:2px;min-width:190px;text-align:left}.ad-group-item-name strong{font-size:12px}.ad-group-item-name small{font-size:10px;color:#86868b;white-space:normal}
      .product-card-source{font-size:10px;color:#86868b}.ads-type-tabs{margin-bottom:10px}
      @media(max-width:800px){.product-card-parent{align-items:flex-start;flex-direction:column}.product-card-overview .kpi-grid{grid-template-columns:repeat(2,1fr)}}
    `;
    document.head.appendChild(style);
  }

  function buildHierarchy() {
    const tabs = $('.ads-type-tabs');
    if (!tabs) return;
    tabs.setAttribute('aria-label', 'Product Card 广告类型');
    const labels = { manual: '单品广告', groups: '广告组', auto: '全店推' };
    $$('.ads-type-tab').forEach(button => {
      if (labels[button.dataset.adsType]) button.textContent = labels[button.dataset.adsType];
    });

    if (!$('#productCardParent')) {
      const parent = document.createElement('div');
      parent.id = 'productCardParent';
      parent.className = 'product-card-parent';
      parent.innerHTML = `
        <div>
          <div class="section-label">PRODUCT CARD</div>
          <h2>Product Card</h2>
          <p>商品广告总览与下钻</p>
        </div>
        <div class="product-card-context">
          <span id="productCardContextV2" class="pill neutral">总览</span>
          <span id="productCardSourceV2" class="pill good">SHOPEE API</span>
        </div>`;
      tabs.parentNode.insertBefore(parent, tabs);
    }

    const gmsPanel = $('#adsGmsPanel');
    if (gmsPanel && !$('#productCardOverviewV2')) {
      const overview = document.createElement('div');
      overview.id = 'productCardOverviewV2';
      overview.className = 'product-card-overview';
      overview.innerHTML = `
        <section id="productCardSummaryV2" class="kpi-grid"></section>
        <section class="product-card-daily-panel">
          <div class="panel-head">
            <div><h2>每日明细</h2><p>店铺级 Product Ads 汇总 · 环比上一日</p></div>
            <span id="productCardCoverageV2" class="pill neutral">等待数据</span>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>日期</th>${OVERVIEW_METRICS.map(([label]) => `<th>${label}</th>`).join('')}</tr></thead>
            <tbody id="productCardDailyRowsV2"><tr><td colspan="13" class="empty">选择店铺后读取 Product Card 总览。</td></tr></tbody>
          </table></div>
        </section>`;
      gmsPanel.insertBefore(overview, gmsPanel.firstChild);
    }

    configureAdMetricTables();

  }

  const metricCol = key => ({ key });
  const textCol = label => ({ label });
  const MANUAL_COLUMNS = [textCol('Campaign'),textCol('状态'),textCol('竞价方式'),textCol('预算'),
    metricCol('impressions'),metricCol('clicks'),metricCol('ctr'),metricCol('addToCart'),metricCol('addToCartRate'),
    metricCol('conversions'),metricCol('directConversions'),metricCol('conversionRate'),metricCol('directConversionRate'),
    metricCol('costPerConversion'),metricCol('costPerDirectConversion'),metricCol('itemsSold'),metricCol('directItemsSold'),
    metricCol('gmv'),metricCol('directGmv'),metricCol('expense'),metricCol('roas'),metricCol('directRoas'),metricCol('acos'),metricCol('directAcos'),
    textCol('平均排名'),metricCol('voucherAmount'),metricCol('voucheredSales'),textCol('Target ROAS')];
  const GMS_COLUMNS = [textCol('Campaign / 投放算法'),metricCol('impressions'),metricCol('clicks'),metricCol('ctr'),
    metricCol('conversions'),metricCol('directConversions'),metricCol('conversionRate'),metricCol('directConversionRate'),
    metricCol('costPerConversion'),metricCol('costPerDirectConversion'),metricCol('itemsSold'),metricCol('directItemsSold'),
    metricCol('gmv'),metricCol('directGmv'),metricCol('expense'),metricCol('roas'),metricCol('directRoas'),metricCol('acos'),metricCol('directAcos'),
    metricCol('voucherAmount'),metricCol('voucheredSales')];
  const GROUP_COLUMNS = [textCol('报表日期'),metricCol('adProductName'),metricCol('status'),metricCol('adsType'),metricCol('biddingMethod'),
    metricCol('startDate'),metricCol('endDate'),textCol('商品数'),metricCol('impressions'),metricCol('clicks'),metricCol('ctr'),
    metricCol('conversions'),metricCol('directConversions'),metricCol('conversionRate'),metricCol('directConversionRate'),
    metricCol('costPerConversion'),metricCol('costPerDirectConversion'),metricCol('itemsSold'),metricCol('directItemsSold'),metricCol('gmv'),metricCol('directGmv'),
    metricCol('expense'),metricCol('roas'),metricCol('directRoas'),metricCol('acos'),metricCol('directAcos'),metricCol('voucherAmount'),metricCol('voucheredSales'),textCol('数据质量')];

  function headerHtml(columns) {
    return columns.map(column => column.key
      ? `<th data-shopee-metric="${column.key}">${esc(sl(column.key))}</th>`
      : `<th>${esc(column.label)}</th>`).join('');
  }

  function configureAdMetricTables() {
    const manualHead = $('#adsManualPanel thead tr');
    const autoHead = $('#adsAutoPanel thead tr');
    const groupHead = $('#adsGroupImportPanel thead tr');
    if (manualHead) manualHead.innerHTML = headerHtml(MANUAL_COLUMNS);
    if (autoHead) autoHead.innerHTML = headerHtml(GMS_COLUMNS);
    if (groupHead) groupHead.innerHTML = headerHtml(GROUP_COLUMNS);
    window.ShopeeMetricLabels?.apply?.();
  }

  function kpi(label, value, sub = '') {
    return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value metric-exact">${esc(value)}</div>${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}</div>`;
  }

  async function loadShopDirectoryV2() {
    try {
      const payload = await api('/api/shopee-analytics/shops');
      shopDirectory = payload.shops || [];
    } catch {
      shopDirectory = [];
    }
  }

  async function loadProductCardOverviewV2() {
    const ctx = selectedContext();
    const summary = $('#productCardSummaryV2');
    const rowsEl = $('#productCardDailyRowsV2');
    const coverage = $('#productCardCoverageV2');
    if (!summary || !rowsEl || !coverage) return;
    if (!ctx.shopId || !ctx.startDate || !ctx.endDate) {
      summary.innerHTML = '';
      rowsEl.innerHTML = '<tr><td colspan="13" class="empty">请选择单个店铺与日期范围。</td></tr>';
      coverage.textContent = '等待店铺';
      return;
    }
    const previousRange = comparisonRange(ctx.startDate, ctx.endDate);
    const makeParams = (startDate, endDate) => new URLSearchParams({
      shop_id: String(ctx.shopId), start_date: startDate, end_date: endDate,
    });
    const [data, previousData] = await Promise.all([
      api(`/api/shopee-analytics/product-ads/overview?${makeParams(ctx.startDate, ctx.endDate)}`),
      api(`/api/shopee-analytics/product-ads/overview?${makeParams(previousRange.startDate, previousRange.endDate)}`),
    ]);
    const current = data.summary || {};
    const previous = previousData.summary || {};
    const daily = data.daily || [];
    const priorDaily = previousData.daily || [];
    coverage.textContent = data.dataAvailable ? `${int(daily.length)} 天` : '暂无API汇总';
    coverage.className = `pill ${data.dataAvailable ? 'good' : 'warn'}`;
    summary.innerHTML = OVERVIEW_METRICS.map(([label, key, formatter]) => {
      let comparisonText;
      if (present(current[key]) && present(previous[key])) {
        comparisonText = `环比 ${changeHtml(current[key], previous[key]).replace(/<[^>]+>/g, '')}`;
      } else if (SUPPLEMENTAL_OVERVIEW_KEYS.has(key)) {
        comparisonText = supplementalStatus(data, key);
      } else {
        comparisonText = present(current[key]) ? '' : '当前 Shopee API 未返回';
      }
      return kpi(label, formatter(current[key]), comparisonText);
    }).join('');
    if (!data.dataAvailable) {
      rowsEl.innerHTML = '<tr><td colspan="13" class="empty">当前周期暂无 Product Card 店铺级汇总。</td></tr>';
      return;
    }
    const dayMap = new Map([...priorDaily, ...daily].map(row => [row.eventDate, row]));
    rowsEl.innerHTML = daily.map(row => {
      const previousDay = dayMap.get(addIsoDays(row.eventDate, -1)) || {};
      return `<tr><td>${esc(row.eventDate)}</td>${OVERVIEW_METRICS.map(([, key, formatter]) => metricTd(row[key], formatter, previousDay[key])).join('')}</tr>`;
    }).join('');
  }

  function unavailable(source = '当前 Shopee API 未返回该字段') {
    return `<span title="${esc(source)}">—</span>`;
  }

  function productAdRowsHtml(rows, type, previousMap = new Map()) {
    return rows.map(row => {
      const p = row.performance || {};
      const previous = previousMap.get(Number(row.campaignId));
      const q = previous?.performance || {};
      if (type === 'manual') return `<tr data-product-card-campaign="${row.campaignId}" data-product-card-type="manual">
        <td><div class="campaign-name"><strong>#${row.campaignId}</strong><small>${esc(row.adName || '')}</small></div></td>
        <td><span class="pill neutral">${esc(row.status || '—')}</span></td><td>${esc(row.biddingMethod || '—')}</td>
        <td data-sort-value="${present(row.campaignBudget) ? Number(row.campaignBudget) : ''}">${money2(row.campaignBudget)}</td>
        ${metricTd(p.impressions, int, q.impressions)}${metricTd(p.clicks, int, q.clicks)}${metricTd(p.ctr, pct2, q.ctr)}
        ${metricTd(p.addToCart, int, q.addToCart)}${metricTd(p.addToCartRate, pct2, q.addToCartRate)}
        ${metricTd(p.broadOrders, int, q.broadOrders)}${metricTd(p.directOrders, int, q.directOrders)}
        ${metricTd(p.broadCvr, pct2, q.broadCvr)}${metricTd(p.directCvr, pct2, q.directCvr)}
        ${metricTd(p.costPerConversion, money2, q.costPerConversion)}${metricTd(p.costPerDirectConversion, money2, q.costPerDirectConversion)}
        ${metricTd(p.broadUnits, int, q.broadUnits)}${metricTd(p.directUnits, int, q.directUnits)}
        ${metricTd(p.broadGmv, money2, q.broadGmv)}${metricTd(p.directGmv, money2, q.directGmv)}${metricTd(p.expense, money2, q.expense)}
        ${metricTd(p.broadRoas, fixed2, q.broadRoas)}${metricTd(p.directRoas, fixed2, q.directRoas)}
        ${metricTd(p.broadAcos, pct2, q.broadAcos)}${metricTd(p.directAcos, pct2, q.directAcos)}
        <td>${unavailable()}</td>${metricTd(p.voucherAmount, money2, q.voucherAmount)}${metricTd(p.voucheredSales, money2, q.voucheredSales)}<td>${fixed2(row.targetRoas)}</td>
      </tr>`;
      return `<tr data-product-card-campaign="${row.campaignId}" data-product-card-type="auto">
        <td><div class="campaign-name"><strong>#${row.campaignId}</strong><small>GMV Max · GMS</small></div></td>
        ${metricTd(p.impressions, int, q.impressions)}${metricTd(p.clicks, int, q.clicks)}${metricTd(p.ctr, pct2, q.ctr)}
        ${metricTd(p.broadOrders, int, q.broadOrders)}${metricTd(p.directOrders, int, q.directOrders)}
        ${metricTd(p.broadCvr, pct2, q.broadCvr)}${metricTd(p.directCvr, pct2, q.directCvr)}
        ${metricTd(p.costPerConversion, money2, q.costPerConversion)}${metricTd(p.costPerDirectConversion, money2, q.costPerDirectConversion)}
        ${metricTd(p.broadUnits, int, q.broadUnits)}${metricTd(p.directUnits, int, q.directUnits)}
        ${metricTd(p.broadGmv, money2, q.broadGmv)}${metricTd(p.directGmv, money2, q.directGmv)}${metricTd(p.expense, money2, q.expense)}
        ${metricTd(p.broadRoas, fixed2, q.broadRoas)}${metricTd(p.directRoas, fixed2, q.directRoas)}
        ${metricTd(p.broadAcos, pct2, q.broadAcos)}${metricTd(p.directAcos, pct2, q.directAcos)}
        ${metricTd(p.voucherAmount, money2, q.voucherAmount)}${metricTd(p.voucheredSales, money2, q.voucheredSales)}
      </tr>`;
    }).join('');
  }

  async function loadProductAdsV2(type) {
    const ctx = selectedContext();
    if (!ctx.shopId || !['manual', 'auto'].includes(type)) return;
    const target = type === 'manual' ? $('#manualAdRows') : $('#autoAdRows');
    const count = type === 'manual' ? $('#manualAdCount') : $('#autoAdCount');
    if (!target) return;
    const previousRange = comparisonRange(ctx.startDate, ctx.endDate);
    const urlFor = (startDate, endDate) => {
      const params = new URLSearchParams({ shop_id: String(ctx.shopId), start_date: startDate, end_date: endDate });
      if (type === 'manual') params.set('ad_type', 'manual');
      return type === 'manual' ? `/api/shopee-analytics/product-ads?${params}` : `/api/shopee-analytics/campaigns?${params}`;
    };
    const [data, previousData] = await Promise.all([
      api(urlFor(ctx.startDate, ctx.endDate)),
      api(urlFor(previousRange.startDate, previousRange.endDate)),
    ]);
    const rows = data.campaigns || [];
    const previousMap = new Map((previousData.campaigns || []).map(row => [Number(row.campaignId), row]));
    if (count) count.textContent = `${int(rows.length)} 个`;
    target.innerHTML = rows.length
      ? productAdRowsHtml(rows, type, previousMap)
      : `<tr><td colspan="${type === 'manual' ? MANUAL_COLUMNS.length : GMS_COLUMNS.length}" class="empty">当前周期没有${type === 'manual' ? '单品广告' : '全店推'}数据。</td></tr>`;
    $$('[data-product-card-campaign]').forEach(row => {
      if (row.dataset.productCardType !== type) return;
      row.addEventListener('click', () => loadProductAdDetailV2(type, Number(row.dataset.productCardCampaign)));
    });
  }

  async function loadProductAdDetailV2(type, campaignId) {
    const ctx = selectedContext();
    if (!ctx.shopId) return;
    const previousRange = comparisonRange(ctx.startDate, ctx.endDate);
    const urlFor = (startDate, endDate) => {
      const params = new URLSearchParams({ shop_id: String(ctx.shopId), start_date: startDate, end_date: endDate });
      if (type === 'manual') params.set('ad_type', 'manual');
      return type === 'manual'
        ? `/api/shopee-analytics/product-ads/${campaignId}/detail?${params}`
        : `/api/shopee-analytics/campaigns/${campaignId}/analysis?${params}`;
    };
    const data = await api(urlFor(ctx.startDate, ctx.endDate));
    const previousData = type === 'auto' ? await api(urlFor(previousRange.startDate, previousRange.endDate)) : null;
    const detail = type === 'manual' ? $('#manualAdDetail') : $('#autoAdDetail');
    if (!detail) return;
    const d = data.diagnosis || {};
    const p = type === 'manual' ? (d.performance || {}) : (d.campaign || {});
    const setting = data.latestSetting || {};
    const primaryAction = Array.isArray(d.actions) ? d.actions[0] : null;
    detail.innerHTML = `
      <div class="product-ad-detail-head">
        <div><div class="section-label">${type === 'manual' ? 'SINGLE PRODUCT AD' : 'SHOP-WIDE PRODUCT AD'}</div>
          <h3>${esc(setting.adName || data.campaign?.adName || (type === 'auto' ? ('全店推 Campaign #' + campaignId) : ('Campaign #' + campaignId)))}</h3>
          <p>${type === 'auto' ? 'GMV Max · GMS API' : (esc(setting.campaignPlacement || data.campaign?.campaignPlacement || '—') + ' · ' + esc(setting.biddingMethod || data.campaign?.biddingMethod || '—'))}</p>
        </div><span class="pill neutral">${esc(d.primarySignal || primaryAction?.title || '—')}</span>
      </div>
      <div class="product-ad-detail-metrics">
        ${kpi(sl('conversions'), int(p.broadOrders), `${sl('directConversions')} ${int(p.directOrders)}`)}
        ${kpi(sl('roas'), fixed2(p.broadRoas), `${sl('directRoas')} ${fixed2(p.directRoas)}`)}
        ${kpi(sl('ctr'), pct2(p.ctr), `${int(p.clicks)} ${sl('clicks')}`)}
        ${kpi(sl('conversionRate'), pct2(p.broadCvr), `${sl('directConversionRate')} ${pct2(p.directCvr)}`)}
        ${kpi(sl('expense'), money2(p.expense), `${ctx.startDate} → ${ctx.endDate}`)}
        ${kpi('Target ROAS', type === 'auto' ? (p.targetRoas == null ? '—' : fixed2(p.targetRoas)) : (setting.targetRoas == null ? '—' : fixed2(setting.targetRoas)))}
      </div>
      <div class="product-ad-action"><strong>下一步</strong><span>${esc(type === 'auto' ? (primaryAction?.action || '继续观察。') : (d.action || '继续观察。'))}</span></div>`;
    if (type === 'auto' && $('#autoAdItems')) {
      const items = d.items || [];
      const previousMap = new Map((previousData?.diagnosis?.items || []).map(item => [Number(item.itemId), item]));
      $('#autoAdItems').innerHTML = items.length ? `
        <div class="panel-head"><div><h3>商品明细</h3><p>全店推 · GMS Item Performance · 环比上一周期 · ${int(items.length)} 商品</p></div></div>
        <div class="table-wrap"><table><thead><tr>
          <th>商品</th><th>${sl('productId')}</th><th>${sl('impressions')}</th><th>${sl('clicks')}</th><th>${sl('ctr')}</th>
          <th>${sl('conversions')}</th><th>${sl('directConversions')}</th><th>${sl('conversionRate')}</th><th>${sl('directConversionRate')}</th>
          <th>${sl('costPerConversion')}</th><th>${sl('costPerDirectConversion')}</th><th>${sl('itemsSold')}</th><th>${sl('directItemsSold')}</th>
          <th>${sl('gmv')}</th><th>${sl('directGmv')}</th><th>${sl('expense')}</th><th>${sl('roas')}</th><th>${sl('directRoas')}</th><th>${sl('acos')}</th><th>${sl('directAcos')}</th>
          <th>${sl('voucherAmount')}</th><th>${sl('voucheredSales')}</th>
        </tr></thead><tbody>${items.map(item => {
          const q = previousMap.get(Number(item.itemId)) || {};
          return `<tr><td><div class="ad-group-item-name"><strong>${esc(item.itemName || ('#' + item.itemId))}</strong><small>${esc(item.itemSku || '')}</small></div></td><td>${esc(item.itemId)}</td>
            ${metricTd(item.impressions, int, q.impressions)}${metricTd(item.clicks, int, q.clicks)}${metricTd(item.ctr, pct2, q.ctr)}
            ${metricTd(item.broadOrders, int, q.broadOrders)}${metricTd(item.directOrders, int, q.directOrders)}${metricTd(item.broadCvr, pct2, q.broadCvr)}${metricTd(item.directCvr, pct2, q.directCvr)}
            ${metricTd(item.costPerConversion, money2, q.costPerConversion)}${metricTd(item.costPerDirectConversion, money2, q.costPerDirectConversion)}
            ${metricTd(item.broadUnits, int, q.broadUnits)}${metricTd(item.directUnits, int, q.directUnits)}${metricTd(item.broadGmv, money2, q.broadGmv)}${metricTd(item.directGmv, money2, q.directGmv)}
            ${metricTd(item.expense, money2, q.expense)}${metricTd(item.broadRoas, fixed2, q.broadRoas)}${metricTd(item.directRoas, fixed2, q.directRoas)}${metricTd(item.broadAcos, pct2, q.broadAcos)}${metricTd(item.directAcos, pct2, q.directAcos)}
            ${metricTd(item.voucherAmount, money2, q.voucherAmount)}${metricTd(item.voucheredSales, money2, q.voucheredSales)}</tr>`;
        }).join('')}</tbody></table></div>`
        : '<div class="empty-inline">当前周期没有 GMS 商品层表现。</div>';
    }
  }

  function adGroupItemTable(row, previousRow = null) {
    const items = Array.isArray(row.items) ? row.items : [];
    if (!items.length) return '<div class="empty-inline">这个广告组没有保存商品层明细。</div>';
    const previousMap = new Map((previousRow?.items || []).map(item => [Number(item.itemId), item]));
    return `<div class="ad-group-inline-box"><div class="panel-head"><div><h3>商品明细</h3><p>${esc(row.campaign_name || '广告组')} · 环比上一周期 · ${int(items.length)} 商品</p></div></div>
      <div class="table-wrap"><table><thead><tr>
        <th>${sl('adProductName')}</th><th>${sl('productId')}</th><th>${sl('impressions')}</th><th>${sl('clicks')}</th><th>${sl('ctr')}</th>
        <th>${sl('conversions')}</th><th>${sl('directConversions')}</th><th>${sl('conversionRate')}</th><th>${sl('directConversionRate')}</th>
        <th>${sl('costPerConversion')}</th><th>${sl('costPerDirectConversion')}</th><th>${sl('itemsSold')}</th><th>${sl('directItemsSold')}</th>
        <th>${sl('gmv')}</th><th>${sl('directGmv')}</th><th>${sl('expense')}</th><th>${sl('roas')}</th><th>${sl('directRoas')}</th><th>${sl('acos')}</th><th>${sl('directAcos')}</th><th>${sl('voucherAmount')}</th><th>${sl('voucheredSales')}</th>
      </tr></thead><tbody>${items.map(item => {
        const q = previousMap.get(Number(item.itemId)) || {};
        return `<tr><td><div class="ad-group-item-name"><strong>${esc(item.productName || ('#' + item.itemId))}</strong><small>${esc(item.itemSku || '')}</small></div></td><td>${esc(item.itemId)}</td>
          ${metricTd(item.impressions, int, q.impressions)}${metricTd(item.clicks, int, q.clicks)}${metricTd(item.ctr, pct2, q.ctr)}
          ${metricTd(item.orders, int, q.orders)}${metricTd(item.directConversions, int, q.directConversions)}${metricTd(item.cvr, pct2, q.cvr)}${metricTd(item.directCvr, pct2, q.directCvr)}
          ${metricTd(item.costPerConversion, money2, q.costPerConversion)}${metricTd(item.costPerDirectConversion, money2, q.costPerDirectConversion)}
          ${metricTd(item.itemsSold, int, q.itemsSold)}${metricTd(item.directItemsSold, int, q.directItemsSold)}
          ${metricTd(item.gmv, money2, q.gmv)}${metricTd(item.directGmv, money2, q.directGmv)}${metricTd(item.expense, money2, q.expense)}
          ${metricTd(item.sourceRoas, fixed2, q.sourceRoas)}${metricTd(item.directRoas, fixed2, q.directRoas)}
          ${metricTd(item.acos, pct2, q.acos)}${metricTd(item.directAcos, pct2, q.directAcos)}${metricTd(item.voucherAmount, money2, q.voucherAmount)}${metricTd(item.voucheredSales, money2, q.voucheredSales)}
        </tr>`;
      }).join('')}</tbody></table></div></div>`;
  }

  function toggleGroupItems(index, rowEl) {
    const detail = $(`#adGroupRows tr[data-ad-group-detail-index="${index}"]`);
    if (!detail) return;
    const willOpen = detail.classList.contains('hidden');
    $$('#adGroupRows tr[data-ad-group-detail-index]').forEach(el => el.classList.add('hidden'));
    $$('#adGroupRows tr[data-ad-group-index]').forEach(el => el.classList.remove('selected'));
    if (willOpen) { detail.classList.remove('hidden'); rowEl.classList.add('selected'); }
  }

  async function loadAdGroupsV2() {
    const ctx = selectedContext();
    const body = $('#adGroupRows');
    if (!body || !ctx.shopId) return;
    const previousRange = comparisonRange(ctx.startDate, ctx.endDate);
    const urlFor = (startDate, endDate) => `/api/shopee-analytics/ad-promotions?${new URLSearchParams({
      shop_id: String(ctx.shopId), start_date: startDate, end_date: endDate,
      promotion_type: 'AD_GROUP', data_source: 'MANUAL_IMPORT',
    })}`;
    const [data, previousData] = await Promise.all([
      api(urlFor(ctx.startDate, ctx.endDate)),
      api(urlFor(previousRange.startDate, previousRange.endDate)),
    ]);
    lastGroupRows = data.promotions || [];
    const compareKey = (row, date) => [date, String(row.campaign_name || '').trim(), String(row.groupStartDate || '')].join('|');
    const previousMap = new Map((previousData.promotions || []).map(row => [compareKey(row, String(row.event_date).slice(0, 10)), row]));
    body.innerHTML = lastGroupRows.length ? lastGroupRows.map((row, index) => {
      const groupKey = `ad-group-${index}`;
      const date = String(row.event_date).slice(0, 10);
      const previous = previousMap.get(compareKey(row, addIsoDays(date, -previousRange.days))) || {};
      return `<tr data-ad-group-index="${index}" data-sort-group="${groupKey}" title="点击展开/收起商品明细">
        <td>${esc(date)}</td><td>${esc(row.campaign_name || '—')}</td><td>${esc(row.campaign_status || '—')}</td><td>${esc(row.source_ad_type || '—')}</td>
        <td>${esc(row.biddingMethod || '—')}</td><td>${esc(row.groupStartDate || '—')}</td><td>${esc(row.groupEndDate || '—')}</td><td>${int(row.item_count)}</td>
        ${metricTd(row.impressions, int, previous.impressions)}${metricTd(row.clicks, int, previous.clicks)}${metricTd(row.ctr, pct2, previous.ctr)}
        ${metricTd(row.orders, int, previous.orders)}${metricTd(row.directConversions, int, previous.directConversions)}${metricTd(row.cvr, pct2, previous.cvr)}${metricTd(row.directCvr, pct2, previous.directCvr)}
        ${metricTd(row.costPerConversion, money2, previous.costPerConversion)}${metricTd(row.costPerDirectConversion, money2, previous.costPerDirectConversion)}
        ${metricTd(row.itemsSold, int, previous.itemsSold)}${metricTd(row.directItemsSold, int, previous.directItemsSold)}
        ${metricTd(row.gmv, money2, previous.gmv)}${metricTd(row.direct_gmv, money2, previous.direct_gmv)}${metricTd(row.expense, money2, previous.expense)}
        ${metricTd(row.source_roas, fixed2, previous.source_roas)}${metricTd(row.direct_roas, fixed2, previous.direct_roas)}
        ${metricTd(row.acos, pct2, previous.acos)}${metricTd(row.directAcos, pct2, previous.directAcos)}
        ${metricTd(row.voucherAmount, money2, previous.voucherAmount)}${metricTd(row.voucheredSales, money2, previous.voucheredSales)}
        <td><span class="pill neutral">${esc(row.data_quality_status || 'COMPLETE')}</span></td></tr>
        <tr class="ad-group-inline-detail hidden" data-ad-group-detail-index="${index}" data-sort-detail="1" data-sort-group="${groupKey}"><td colspan="${GROUP_COLUMNS.length}">${adGroupItemTable(row, previous)}</td></tr>`;
    }).join('') : `<tr><td colspan="${GROUP_COLUMNS.length}" class="empty">当前周期暂无广告组数据。</td></tr>`;
    $('#adGroupEmptyState')?.classList.toggle('hidden', Boolean(lastGroupRows.length));
    $$('#adGroupRows tr[data-ad-group-index]').forEach(rowEl => rowEl.addEventListener('click', () => toggleGroupItems(Number(rowEl.dataset.adGroupIndex), rowEl)));
  }

  async function refreshActivePanel() {
    const seq = ++refreshSeq;
    const type = activeType();
    setPanelVisibility(type);
    try {
      await loadProductCardOverviewV2();
      if (type === 'manual' || type === 'auto') await loadProductAdsV2(type);
      else if (type === 'groups') await loadAdGroupsV2();
    } catch (error) {
      if (seq !== refreshSeq) return;
      if ($('#productCardDailyRowsV2')) $('#productCardDailyRowsV2').innerHTML = `<tr><td colspan="12" class="empty">${esc(error.message)}</td></tr>`;
      if (type === 'groups' && $('#adGroupRows')) $('#adGroupRows').innerHTML = `<tr><td colspan="${GROUP_COLUMNS.length}" class="empty">${esc(error.message)}</td></tr>`;
    }
  }

  function scheduleRefresh(delay = 80) {
    window.setTimeout(() => refreshActivePanel(), delay);
  }

  async function init() {
    injectStyles();
    buildHierarchy();
    await loadShopDirectoryV2();

    // Keep the legacy state machine/tabs for compatibility, but make the three
    // read paths below authoritative for the Product Card UI.
    window.loadCampaigns = loadProductCardOverviewV2;
    window.loadProductAds = loadProductAdsV2;
    window.loadAdGroups = loadAdGroupsV2;

    $$('.ads-type-tab').forEach(button => button.addEventListener('click', () => scheduleRefresh(40)));
    $$('.view-tab[data-view="ads"]').forEach(button => button.addEventListener('click', () => scheduleRefresh(80)));
    $('#loadBtn')?.addEventListener('click', () => scheduleRefresh(80));
    $('#shopSelect')?.addEventListener('change', () => scheduleRefresh(80));
    $('#dateRangeApply')?.addEventListener('click', () => scheduleRefresh(80));
    $$('[data-date-preset]').forEach(button => button.addEventListener('click', () => scheduleRefresh(80)));

    scheduleRefresh(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
  else init();
})();
