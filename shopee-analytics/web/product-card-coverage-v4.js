'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  let refreshSeq = 0;

  async function api(url) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function ensureNotice() {
    let notice = $('#productCardCoverageNotice');
    if (notice) return notice;
    const overview = $('#productCardOverviewV2');
    if (!overview) return null;
    notice = document.createElement('div');
    notice.id = 'productCardCoverageNotice';
    notice.className = 'notes hidden';
    overview.insertBefore(notice, overview.firstChild);
    return notice;
  }

  async function refreshCoverage() {
    const seq = ++refreshSeq;
    const shopId = Number($('#shopSelect')?.value || 0);
    const startDate = $('#startDate')?.value || '';
    const endDate = $('#endDate')?.value || '';
    const badge = $('#productCardCoverageV2');
    const notice = ensureNotice();
    if (!shopId || !startDate || !endDate || !badge || !notice) return;

    try {
      const params = new URLSearchParams({ shop_id: String(shopId), start_date: startDate, end_date: endDate });
      const data = await api(`/api/shopee-analytics/product-ads/overview?${params}`);
      if (seq !== refreshSeq) return;
      const coverage = data.coverage || {};
      if (!data.dataAvailable) {
        const missing = Array.isArray(coverage.missingDates) ? coverage.missingDates.join('、') : '';
        badge.textContent = '暂无API汇总';
        badge.className = 'pill warn';
        notice.classList.remove('hidden');
        notice.textContent = `当前周期没有 Product Card 店铺级 CPC API 数据${missing ? `，缺失日期：${missing}` : ''}。可点击【读取数据】从 Shopee API 抓取；系统不会使用其他广告类型数据替代总览。`;
        return;
      }
      const expected = Number(coverage.expectedDays || 0);
      const available = Number(coverage.availableDays || 0);
      badge.textContent = expected ? `${available}/${expected} 天` : `${available} 天`;
      badge.className = `pill ${coverage.complete ? 'good' : 'warn'}`;
      if (coverage.complete) {
        notice.classList.add('hidden');
        notice.textContent = '';
      } else {
        notice.classList.remove('hidden');
        const missing = Array.isArray(coverage.missingDates) ? coverage.missingDates.join('、') : '';
        notice.textContent = `Product Card 汇总数据不完整：当前 ${available}/${expected} 天，缺失 ${coverage.missingDays || 0} 天${missing ? `（${missing}）` : ''}。可点击【读取数据】从 Shopee API 补抓缺失周期；补齐前当前汇总只代表已落库日期。`;
      }
    } catch (error) {
      if (seq !== refreshSeq) return;
      badge.textContent = '覆盖检查失败';
      badge.className = 'pill warn';
      notice.classList.remove('hidden');
      notice.textContent = `Product Card 数据覆盖检查失败：${error.message}`;
    }
  }

  function schedule() { window.setTimeout(refreshCoverage, 120); }

  function init() {
    ensureNotice();
    window.addEventListener('shopee-data-refreshed', schedule);
    $('#shopSelect')?.addEventListener('change', schedule);
    $('#dateRangeApply')?.addEventListener('click', schedule);
    $$('[data-date-preset]').forEach(button => button.addEventListener('click', schedule));
    $$('.ads-type-tab[data-ads-type="gms"]').forEach(button => button.addEventListener('click', schedule));
    $$('.view-tab[data-view="ads"]').forEach(button => button.addEventListener('click', schedule));
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
