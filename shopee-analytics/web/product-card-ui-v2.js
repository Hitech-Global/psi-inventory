'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const sl = key => window.ShopeeMetricLabels?.label(key) || key;
  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const int = value => Number.isFinite(Number(value))
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value))
    : '—';
  const fixed2 = value => Number.isFinite(Number(value))
    ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))
    : '—';
  const pct2 = value => Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(2)}%`
    : '—';
  const money2 = value => Number.isFinite(Number(value)) ? fixed2(value) : '—';

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
    return $('.ads-type-tab.active')?.dataset.adsType || 'gms';
  }

  function setPanelVisibility(type) {
    $('#adsGmsPanel')?.classList.toggle('hidden', type !== 'gms');
    $('#adsGmvMaxPanel')?.classList.toggle('hidden', type !== 'gmvmax');
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
      .ad-group-item-detail-v2{border-top:1px solid #ececef;background:#fbfbfc}
      .ad-group-item-detail-v2 .panel-head{padding:14px 20px}.ad-group-item-detail-v2 .table-wrap{max-height:420px}
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
    const labels = { gms: '总览', gmvmax: 'GMV Max', manual: '单品广告', auto: '全店推', groups: '广告组' };
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

    const groupPanel = $('#adsGroupImportPanel');
    if (groupPanel && !$('#adGroupItemDetailV2')) {
      const detail = document.createElement('div');
      detail.id = 'adGroupItemDetailV2';
      detail.className = 'ad-group-item-detail-v2';
      detail.innerHTML = `
        <div class="panel-head">
          <div><h3>商品明细</h3><p>选择广告组后查看 Seller Centre 商品层数据。</p></div>
          <span id="adGroupItemCountV2" class="pill neutral">未选择</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>商品</th><th>${sl('impressions')}</th><th>${sl('clicks')}</th><th>${sl('ctr')}</th><th>${sl('conversions')}</th><th>${sl('gmv')}</th><th>${sl('expense')}</th><th>${sl('roas')}</th>
              <th>${sl('directGmv')}</th><th>${sl('directRoas')}</th><th>${sl('conversionRate')}</th><th>${sl('addToCart')}</th><th>数据质量</th>
            </tr></thead>
            <tbody id="adGroupItemRowsV2"><tr><td colspan="13" class="empty">先点击一个广告组。</td></tr></tbody>
          </table>
        </div>`;
      groupPanel.appendChild(detail);
    }
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

  function productAdRowsHtml(rows, type) {
    return rows.map(row => {
      const p = row.performance || {};
      return `<tr data-product-card-campaign="${row.campaignId}" data-product-card-type="${type}">
        <td><div class="campaign-name"><strong>#${row.campaignId}</strong><small>${esc(row.biddingMethod || row.adType || '')}</small></div></td>
        <td><span class="pill neutral">${esc(row.status || '—')}</span></td>
        <td>${row.campaignBudget == null ? '—' : money2(row.campaignBudget)}</td>
        <td>${int(p.broadOrders)}</td>
        <td>${int(p.directOrders)}</td>
        <td>${fixed2(p.broadRoas)}</td>
        <td>${fixed2(p.directRoas)}</td>
        <td>${pct2(p.ctr)}</td>
        <td>${pct2(p.broadCvr)}</td>
        <td>${money2(p.expense)}</td>
        <td>${row.targetRoas == null ? '—' : fixed2(row.targetRoas)}</td>
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
      shop_id: String(ctx.shopId), start_date: ctx.startDate, end_date: ctx.endDate, ad_type: type,
    });
    const data = await api(`/api/shopee-analytics/product-ads?${params}`);
    const rows = data.campaigns || [];
    if (count) count.textContent = `${int(rows.length)} 个`;
    target.innerHTML = rows.length
      ? productAdRowsHtml(rows, type)
      : `<tr><td colspan="11" class="empty">当前周期没有${type === 'manual' ? '单品广告' : '全店推'}数据。</td></tr>`;
    $$('[data-product-card-campaign]').forEach(row => {
      if (row.dataset.productCardType !== type) return;
      row.addEventListener('click', () => loadProductAdDetailV2(type, Number(row.dataset.productCardCampaign)));
    });
  }

  async function loadProductAdDetailV2(type, campaignId) {
    const ctx = selectedContext();
    if (!ctx.shopId) return;
    const params = new URLSearchParams({
      shop_id: String(ctx.shopId), start_date: ctx.startDate, end_date: ctx.endDate, ad_type: type,
    });
    const data = await api(`/api/shopee-analytics/product-ads/${campaignId}/detail?${params}`);
    const detail = type === 'manual' ? $('#manualAdDetail') : $('#autoAdDetail');
    if (!detail) return;
    const d = data.diagnosis || {};
    const p = d.performance || {};
    const setting = data.latestSetting || {};
    detail.innerHTML = `
      <div class="product-ad-detail-head">
        <div><div class="section-label">${type === 'manual' ? 'SINGLE PRODUCT AD' : 'SHOP-WIDE PRODUCT AD'}</div>
          <h3>${esc(setting.adName || data.campaign?.adName || ('Campaign #' + campaignId))}</h3>
          <p>${esc(setting.campaignPlacement || data.campaign?.campaignPlacement || '—')} · ${esc(setting.biddingMethod || data.campaign?.biddingMethod || '—')}</p>
        </div><span class="pill neutral">${esc(d.primarySignal || '—')}</span>
      </div>
      <div class="product-ad-detail-metrics">
        ${kpi(sl('conversions'), int(p.broadOrders), `${sl('directConversions')} ${int(p.directOrders)}`)}
        ${kpi(sl('roas'), fixed2(p.broadRoas), `${sl('directRoas')} ${fixed2(p.directRoas)}`)}
        ${kpi(sl('ctr'), pct2(p.ctr), `${int(p.clicks)} ${sl('clicks')}`)}
        ${kpi(sl('conversionRate'), pct2(p.broadCvr), `${sl('directConversionRate')} ${pct2(p.directCvr)}`)}
        ${kpi(sl('expense'), money2(p.expense), `${ctx.startDate} → ${ctx.endDate}`)}
        ${kpi('Target ROAS', setting.targetRoas == null ? '—' : fixed2(setting.targetRoas))}
      </div>
      <div class="product-ad-action"><strong>下一步</strong><span>${esc(d.action || '继续观察。')}</span></div>`;

    if (type === 'auto' && $('#autoAdItems')) {
      const items = data.items || [];
      $('#autoAdItems').innerHTML = items.length
        ? `<strong>当前自动选品范围 · ${int(items.length)} 个商品</strong><div class="product-ad-item-list">${items.map(item => `<span>#${esc(item.itemId)}${item.itemSku ? ` · ${esc(item.itemSku)}` : ''}</span>`).join('')}</div>`
        : '<div class="empty-inline">当前没有真实 Membership 商品。</div>';
    }
  }

  function renderGroupItems(row, rowEl) {
    $$('#adGroupRows tr[data-ad-group-index]').forEach(el => el.classList.toggle('selected', el === rowEl));
    const items = Array.isArray(row.items) ? row.items : [];
    const count = $('#adGroupItemCountV2');
    const body = $('#adGroupItemRowsV2');
    if (count) count.textContent = `${esc(String(row.campaign_name || '广告组'))} · ${int(items.length)} 商品`;
    if (!body) return;
    body.innerHTML = items.length ? items.map(item => `<tr>
      <td><div class="ad-group-item-name"><strong>${esc(item.itemSku || ('#' + item.itemId))}</strong><small>${esc(item.productName || '')}</small></div></td>
      <td>${int(item.impressions)}</td>
      <td>${int(item.clicks)}</td>
      <td>${pct2(item.ctr)}</td>
      <td>${int(item.orders)}</td>
      <td>${money2(item.gmv)}</td>
      <td>${money2(item.expense)}</td>
      <td>${fixed2(item.sourceRoas)}</td>
      <td>${money2(item.directGmv)}</td>
      <td>${fixed2(item.directRoas)}</td>
      <td>${pct2(item.cvr)}</td>
      <td>${int(item.addToCart)}</td>
      <td><span class="pill neutral">${esc(item.dataQualityStatus || '—')}</span></td>
    </tr>`).join('') : '<tr><td colspan="13" class="empty">这个广告组没有保存商品层明细。</td></tr>';
  }

  async function loadAdGroupsV2() {
    const ctx = selectedContext();
    const body = $('#adGroupRows');
    if (!body || !ctx.shopId) return;
    const params = new URLSearchParams({
      shop_id: String(ctx.shopId),
      start_date: ctx.startDate,
      end_date: ctx.endDate,
      promotion_type: 'AD_GROUP',
      data_source: 'MANUAL_IMPORT',
    });
    const data = await api(`/api/shopee-analytics/ad-promotions?${params}`);
    lastGroupRows = data.promotions || [];
    body.innerHTML = lastGroupRows.length ? lastGroupRows.map((row, index) => `<tr data-ad-group-index="${index}">
      <td>${esc(String(row.event_date).slice(0, 10))}</td>
      <td>${esc(row.campaign_name || '—')}</td>
      <td>${esc(row.campaign_status || '—')}</td>
      <td>${int(row.item_count)}</td>
      <td>${int(row.impressions)}</td>
      <td>${int(row.clicks)}</td>
      <td>${pct2(row.ctr)}</td>
      <td>${int(row.orders)}</td>
      <td>${money2(row.gmv)}</td>
      <td>${money2(row.expense)}</td>
      <td>${fixed2(row.source_roas)}</td>
      <td>${money2(row.direct_gmv)}</td>
      <td>${fixed2(row.direct_roas)}</td>
      <td><span class="pill neutral">${esc(row.data_quality_status || 'COMPLETE')}</span></td>
    </tr>`).join('') : '<tr><td colspan="14" class="empty">当前周期暂无广告组数据。</td></tr>';
    $('#adGroupEmptyState')?.classList.toggle('hidden', Boolean(lastGroupRows.length));
    if ($('#adGroupItemRowsV2')) $('#adGroupItemRowsV2').innerHTML = '<tr><td colspan="13" class="empty">点击上方一个广告组查看商品明细。</td></tr>';
    if ($('#adGroupItemCountV2')) $('#adGroupItemCountV2').textContent = '未选择';
    $$('#adGroupRows tr[data-ad-group-index]').forEach(rowEl => {
      rowEl.addEventListener('click', () => renderGroupItems(lastGroupRows[Number(rowEl.dataset.adGroupIndex)], rowEl));
    });
  }

  async function refreshActivePanel() {
    const seq = ++refreshSeq;
    const type = activeType();
    setPanelVisibility(type);
    try {
      if (type === 'gms') await loadProductCardOverviewV2();
      else if (type === 'gmvmax') { /* legacy GMV Max loader is owned by app.js */ }
      else if (type === 'manual' || type === 'auto') await loadProductAdsV2(type);
      else if (type === 'groups') await loadAdGroupsV2();
    } catch (error) {
      if (seq !== refreshSeq) return;
      if (type === 'gms' && $('#productCardDailyRowsV2')) $('#productCardDailyRowsV2').innerHTML = `<tr><td colspan="12" class="empty">${esc(error.message)}</td></tr>`;
      if (type === 'groups' && $('#adGroupRows')) $('#adGroupRows').innerHTML = `<tr><td colspan="14" class="empty">${esc(error.message)}</td></tr>`;
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

    if (activeType() === 'gms') scheduleRefresh(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
  else init();
})();
