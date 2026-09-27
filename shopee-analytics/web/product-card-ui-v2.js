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
            <div><h2>每日明细</h2><p>店铺级 Product Ads 汇总</p></div>
            <span id="productCardCoverageV2" class="pill neutral">等待数据</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>日期</th><th>${sl('impressions')}</th><th>${sl('clicks')}</th><th>${sl('ctr')}</th><th>${sl('conversions')}</th><th>${sl('directConversions')}</th>
                <th>${sl('gmv')}</th><th>${sl('directGmv')}</th><th>${sl('expense')}</th><th>${sl('roas')}</th><th>${sl('directRoas')}</th><th>${sl('costPerConversion')}</th>
              </tr></thead>
              <tbody id="productCardDailyRowsV2"><tr><td colspan="12" class="empty">选择店铺后读取 Product Card 总览。</td></tr></tbody>
            </table>
          </div>
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
      rowsEl.innerHTML = '<tr><td colspan="12" class="empty">请选择单个店铺与日期范围。</td></tr>';
      coverage.textContent = '等待店铺';
      return;
    }

    const params = new URLSearchParams({
      shop_id: String(ctx.shopId),
      start_date: ctx.startDate,
      end_date: ctx.endDate,
    });
    const data = await api(`/api/shopee-analytics/product-ads/overview?${params}`);
    const s = data.summary || {};
    const daily = data.daily || [];
    coverage.textContent = data.dataAvailable ? `${int(daily.length)} 天` : '暂无API汇总';
    coverage.className = `pill ${data.dataAvailable ? 'good' : 'warn'}`;

    if (!data.dataAvailable) {
      summary.innerHTML = [
        kpi(sl('impressions'), '—'), kpi(sl('clicks'), '—'), kpi(sl('ctr'), '—'), kpi(sl('conversions'), '—'), kpi(sl('expense'), '—'),
      ].join('');
      rowsEl.innerHTML = '<tr><td colspan="12" class="empty">当前周期暂无 Product Card 店铺级汇总。不会使用“全店推”或某个 GMV Max Campaign 冒充总览。</td></tr>';
      return;
    }

    summary.innerHTML = [
      kpi(sl('impressions'), int(s.impressions)),
      kpi(sl('clicks'), int(s.clicks)),
      kpi(sl('ctr'), pct2(s.ctr)),
      kpi(sl('conversions'), int(s.broadOrders), `${sl('directConversions')} ${int(s.directOrders)}`),
      kpi(sl('gmv'), money2(s.broadGmv), `${sl('directGmv')} ${money2(s.directGmv)}`),
      kpi(sl('expense'), money2(s.expense)),
      kpi(sl('roas'), fixed2(s.broadRoas), `${sl('directRoas')} ${fixed2(s.directRoas)}`),
      kpi(sl('costPerConversion'), money2(s.costPerConversion), `${sl('costPerDirectConversion')} ${money2(s.costPerDirectConversion)}`),
      kpi(sl('conversionRate'), pct2(s.broadCvr), `${sl('directConversionRate')} ${pct2(s.directCvr)}`),
      kpi(sl('acos'), pct2(s.broadAcos), `${sl('directAcos')} ${pct2(s.directAcos)}`),
    ].join('');

    rowsEl.innerHTML = daily.map(row => `<tr>
      <td>${esc(row.eventDate)}</td>
      <td>${int(row.impressions)}</td>
      <td>${int(row.clicks)}</td>
      <td>${pct2(row.ctr)}</td>
      <td>${int(row.broadOrders)}</td>
      <td>${int(row.directOrders)}</td>
      <td>${money2(row.broadGmv)}</td>
      <td>${money2(row.directGmv)}</td>
      <td>${money2(row.expense)}</td>
      <td>${fixed2(row.broadRoas)}</td>
      <td>${fixed2(row.directRoas)}</td>
      <td>${money2(row.costPerConversion)}</td>
    </tr>`).join('');
  }

  function unavailable(source = '当前 Shopee API 未返回该字段') {
    return `<span title="${esc(source)}">—</span>`;
  }

  function productAdRowsHtml(rows, type) {
    return rows.map(row => {
      const p = row.performance || {};
      if (type === 'manual') return `<tr data-product-card-campaign="${row.campaignId}" data-product-card-type="manual">
        <td><div class="campaign-name"><strong>#${row.campaignId}</strong><small>${esc(row.adName || '')}</small></div></td>
        <td><span class="pill neutral">${esc(row.status || '—')}</span></td><td>${esc(row.biddingMethod || '—')}</td><td>${money2(row.campaignBudget)}</td>
        <td>${int(p.impressions)}</td><td>${int(p.clicks)}</td><td>${pct2(p.ctr)}</td><td>${int(p.addToCart)}</td><td>${pct2(p.addToCartRate)}</td>
        <td>${int(p.broadOrders)}</td><td>${int(p.directOrders)}</td><td>${pct2(p.broadCvr)}</td><td>${pct2(p.directCvr)}</td>
        <td>${money2(p.costPerConversion)}</td><td>${money2(p.costPerDirectConversion)}</td><td>${int(p.broadUnits)}</td><td>${int(p.directUnits)}</td>
        <td>${money2(p.broadGmv)}</td><td>${money2(p.directGmv)}</td><td>${money2(p.expense)}</td><td>${fixed2(p.broadRoas)}</td><td>${fixed2(p.directRoas)}</td>
        <td>${pct2(p.broadAcos)}</td><td>${pct2(p.directAcos)}</td><td>${unavailable()}</td><td>${unavailable()}</td><td>${unavailable()}</td><td>${fixed2(row.targetRoas)}</td>
      </tr>`;
      return `<tr data-product-card-campaign="${row.campaignId}" data-product-card-type="auto">
        <td><div class="campaign-name"><strong>#${row.campaignId}</strong><small>GMV Max · GMS</small></div></td>
        <td>${int(p.impressions)}</td><td>${int(p.clicks)}</td><td>${pct2(p.ctr)}</td><td>${int(p.broadOrders)}</td><td>${int(p.directOrders)}</td>
        <td>${pct2(p.broadCvr)}</td><td>${pct2(p.directCvr)}</td><td>${money2(p.costPerConversion)}</td><td>${money2(p.costPerDirectConversion)}</td>
        <td>${int(p.broadUnits)}</td><td>${int(p.directUnits)}</td><td>${money2(p.broadGmv)}</td><td>${money2(p.directGmv)}</td><td>${money2(p.expense)}</td>
        <td>${fixed2(p.broadRoas)}</td><td>${fixed2(p.directRoas)}</td><td>${pct2(p.broadAcos)}</td><td>${pct2(p.directAcos)}</td><td>${unavailable('GMS API 未返回 Voucher Amount')}</td><td>${unavailable('GMS API 未返回 Vouchered Sales')}</td>
      </tr>`;
    }).join('');
  }

  async function loadProductAdsV2(type) {
    const ctx = selectedContext();
    if (!ctx.shopId || !['manual', 'auto'].includes(type)) return;
    const target = type === 'manual' ? $('#manualAdRows') : $('#autoAdRows');
    const count = type === 'manual' ? $('#manualAdCount') : $('#autoAdCount');
    if (!target) return;
    const params = new URLSearchParams({
      shop_id: String(ctx.shopId), start_date: ctx.startDate, end_date: ctx.endDate,
    });
    if (type === 'manual') params.set('ad_type', 'manual');
    const data = await api(type === 'manual'
      ? `/api/shopee-analytics/product-ads?${params}`
      : `/api/shopee-analytics/campaigns?${params}`);
    const rows = data.campaigns || [];
    if (count) count.textContent = `${int(rows.length)} 个`;
    target.innerHTML = rows.length
      ? productAdRowsHtml(rows, type)
      : `<tr><td colspan="${type === 'manual' ? MANUAL_COLUMNS.length : GMS_COLUMNS.length}" class="empty">当前周期没有${type === 'manual' ? '单品广告' : '全店推'}数据。</td></tr>`;
    $$('[data-product-card-campaign]').forEach(row => {
      if (row.dataset.productCardType !== type) return;
      row.addEventListener('click', () => loadProductAdDetailV2(type, Number(row.dataset.productCardCampaign)));
    });
  }

  async function loadProductAdDetailV2(type, campaignId) {
    const ctx = selectedContext();
    if (!ctx.shopId) return;
    const params = new URLSearchParams({
      shop_id: String(ctx.shopId), start_date: ctx.startDate, end_date: ctx.endDate,
    });
    if (type === 'manual') params.set('ad_type', 'manual');
    const data = await api(type === 'manual'
      ? `/api/shopee-analytics/product-ads/${campaignId}/detail?${params}`
      : `/api/shopee-analytics/campaigns/${campaignId}/analysis?${params}`);
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
      $('#autoAdItems').innerHTML = items.length ? `
        <div class="panel-head"><div><h3>商品明细</h3><p>全店推 · GMS Item Performance · ${int(items.length)} 商品</p></div></div>
        <div class="table-wrap"><table><thead><tr>
          <th>商品</th><th>${sl('productId')}</th><th>${sl('impressions')}</th><th>${sl('clicks')}</th><th>${sl('ctr')}</th>
          <th>${sl('conversions')}</th><th>${sl('directConversions')}</th><th>${sl('conversionRate')}</th><th>${sl('directConversionRate')}</th>
          <th>${sl('costPerConversion')}</th><th>${sl('costPerDirectConversion')}</th><th>${sl('itemsSold')}</th><th>${sl('directItemsSold')}</th>
          <th>${sl('gmv')}</th><th>${sl('directGmv')}</th><th>${sl('expense')}</th><th>${sl('roas')}</th><th>${sl('directRoas')}</th><th>${sl('acos')}</th><th>${sl('directAcos')}</th>
        </tr></thead><tbody>${items.map(item => `<tr>
          <td><div class="ad-group-item-name"><strong>${esc(item.itemName || ('#' + item.itemId))}</strong><small>${esc(item.itemSku || '')}</small></div></td><td>${esc(item.itemId)}</td>
          <td>${int(item.impressions)}</td><td>${int(item.clicks)}</td><td>${pct2(item.ctr)}</td><td>${int(item.broadOrders)}</td><td>${int(item.directOrders)}</td>
          <td>${pct2(item.broadCvr)}</td><td>${pct2(item.directCvr)}</td><td>${money2(item.costPerConversion)}</td><td>${money2(item.costPerDirectConversion)}</td>
          <td>${int(item.broadUnits)}</td><td>${int(item.directUnits)}</td><td>${money2(item.broadGmv)}</td><td>${money2(item.directGmv)}</td><td>${money2(item.expense)}</td>
          <td>${fixed2(item.broadRoas)}</td><td>${fixed2(item.directRoas)}</td><td>${pct2(item.broadAcos)}</td><td>${pct2(item.directAcos)}</td>
        </tr>`).join('')}</tbody></table></div>`
        : '<div class="empty-inline">当前周期没有 GMS 商品层表现。</div>';
    }
  }

  function adGroupItemTable(row) {
    const items = Array.isArray(row.items) ? row.items : [];
    if (!items.length) return '<div class="empty-inline">这个广告组没有保存商品层明细。</div>';
    return `<div class="ad-group-inline-box"><div class="panel-head"><div><h3>商品明细</h3><p>${esc(row.campaign_name || '广告组')} · ${int(items.length)} 商品</p></div></div>
      <div class="table-wrap"><table><thead><tr>
        <th>${sl('adProductName')}</th><th>${sl('productId')}</th><th>${sl('impressions')}</th><th>${sl('clicks')}</th><th>${sl('ctr')}</th>
        <th>${sl('conversions')}</th><th>${sl('directConversions')}</th><th>${sl('conversionRate')}</th><th>${sl('directConversionRate')}</th>
        <th>${sl('costPerConversion')}</th><th>${sl('costPerDirectConversion')}</th><th>${sl('itemsSold')}</th><th>${sl('directItemsSold')}</th>
        <th>${sl('gmv')}</th><th>${sl('directGmv')}</th><th>${sl('expense')}</th><th>${sl('roas')}</th><th>${sl('directRoas')}</th><th>${sl('acos')}</th><th>${sl('directAcos')}</th><th>${sl('voucherAmount')}</th><th>${sl('voucheredSales')}</th>
      </tr></thead><tbody>${items.map(item => `<tr>
        <td><div class="ad-group-item-name"><strong>${esc(item.productName || ('#' + item.itemId))}</strong><small>${esc(item.itemSku || '')}</small></div></td><td>${esc(item.itemId)}</td>
        <td>${int(item.impressions)}</td><td>${int(item.clicks)}</td><td>${pct2(item.ctr)}</td><td>${int(item.orders)}</td><td>${int(item.directConversions)}</td><td>${pct2(item.cvr)}</td><td>${pct2(item.directCvr)}</td>
        <td>${money2(item.costPerConversion)}</td><td>${money2(item.costPerDirectConversion)}</td><td>${int(item.itemsSold)}</td><td>${int(item.directItemsSold)}</td>
        <td>${money2(item.gmv)}</td><td>${money2(item.directGmv)}</td><td>${money2(item.expense)}</td><td>${fixed2(item.sourceRoas)}</td><td>${fixed2(item.directRoas)}</td>
        <td>${pct2(item.acos)}</td><td>${pct2(item.directAcos)}</td><td>${money2(item.voucherAmount)}</td><td>${money2(item.voucheredSales)}</td>
      </tr>`).join('')}</tbody></table></div></div>`;
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
    const ctx = selectedContext(); const body = $('#adGroupRows'); if (!body || !ctx.shopId) return;
    const params = new URLSearchParams({ shop_id:String(ctx.shopId),start_date:ctx.startDate,end_date:ctx.endDate,promotion_type:'AD_GROUP',data_source:'MANUAL_IMPORT' });
    const data = await api(`/api/shopee-analytics/ad-promotions?${params}`); lastGroupRows = data.promotions || [];
    body.innerHTML = lastGroupRows.length ? lastGroupRows.map((row,index) => {
      const groupKey = `ad-group-${index}`;
      return `<tr data-ad-group-index="${index}" data-sort-group="${groupKey}" title="点击展开/收起商品明细">
        <td>${esc(String(row.event_date).slice(0,10))}</td><td>${esc(row.campaign_name || '—')}</td><td>${esc(row.campaign_status || '—')}</td><td>${esc(row.source_ad_type || '—')}</td>
        <td>${esc(row.biddingMethod || '—')}</td><td>${esc(row.groupStartDate || '—')}</td><td>${esc(row.groupEndDate || '—')}</td><td>${int(row.item_count)}</td>
        <td>${int(row.impressions)}</td><td>${int(row.clicks)}</td><td>${pct2(row.ctr)}</td><td>${int(row.orders)}</td><td>${int(row.directConversions)}</td><td>${pct2(row.cvr)}</td><td>${pct2(row.directCvr)}</td>
        <td>${money2(row.costPerConversion)}</td><td>${money2(row.costPerDirectConversion)}</td><td>${int(row.itemsSold)}</td><td>${int(row.directItemsSold)}</td><td>${money2(row.gmv)}</td><td>${money2(row.direct_gmv)}</td>
        <td>${money2(row.expense)}</td><td>${fixed2(row.source_roas)}</td><td>${fixed2(row.direct_roas)}</td><td>${pct2(row.acos)}</td><td>${pct2(row.directAcos)}</td><td>${money2(row.voucherAmount)}</td><td>${money2(row.voucheredSales)}</td>
        <td><span class="pill neutral">${esc(row.data_quality_status || 'COMPLETE')}</span></td></tr>
        <tr class="ad-group-inline-detail hidden" data-ad-group-detail-index="${index}" data-sort-detail="1" data-sort-group="${groupKey}"><td colspan="${GROUP_COLUMNS.length}">${adGroupItemTable(row)}</td></tr>`;
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
