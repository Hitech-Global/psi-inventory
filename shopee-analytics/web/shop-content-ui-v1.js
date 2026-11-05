'use strict';

/**
 * The videos and the livestreams of the shops.
 *
 * Both belong to the person behind the shop rather than to the shop
 * itself, so what is shown here is what those two applications reported.
 *
 * A figure the platform did not report is shown as a dash rather than as
 * a zero. The two are not the same thing: a zero would say that nobody
 * watched, where a dash says only that it was not reported.
 *
 * A shop with no reading is shown apart from one that came out badly.
 * The first has not been looked at, the second was looked at and did not
 * come out well.
 */

(function () {
  let current = null;

  /**
   * The name a shop is known by on the page.
   */
  function shopTitle(shopId) {
    const shops = (current && current.shops) || [];
    const found = shops.find(shop => Number(shop.shopId) === Number(shopId));
    return found ? (found.displayName || found.shopId) : shopId;
  }

  /**
   * A figure, or a dash where there is none.
   */
  function isMissing(value) {
    return value === null || value === undefined || value === '';
  }

  function formatNumber(value) {
    if (isMissing(value)) return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString('zh-CN');
  }

  function formatMoney(value) {
    if (isMissing(value)) return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }

  /**
   * A duration in seconds, as hours and minutes.
   */
  function formatDuration(value) {
    if (isMissing(value)) return '—';
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (!hours) return `${minutes} 分`;
    return `${hours} 小时 ${minutes} 分`;
  }

  function renderSummary(data) {
    const host = document.querySelector('#contentSummary');
    if (!host) return;
    const shops = data.shops || [];
    const videos = data.videos || [];
    const sessions = data.sessions || [];
    const videoShops = shops.filter(shop => shop.videoConnected).length;
    const liveShops = shops.filter(shop => shop.livestreamConnected).length;
    const totalViews = videos.reduce((sum, row) => sum + Number(row.views || 0), 0);
    const totalOrders = videos.reduce((sum, row) => sum + Number(row.orders || 0), 0)
      + sessions.reduce((sum, row) => sum + Number(row.orders || 0), 0);
    const cards = [
      { label: '店铺总数', value: shops.length, hint: '当前筛选下的店铺' },
      { label: '已连视频', value: videoShops, hint: '已授权 Video 应用' },
      { label: '已连直播', value: liveShops, hint: '已授权 Livestream 应用' },
      { label: '视频数', value: videos.length, hint: '有读数的视频' },
      { label: '直播场次', value: sessions.length, hint: '有读数的场次' },
      { label: '观看', value: totalViews, hint: '视频与直播合计' },
      { label: '订单', value: totalOrders, hint: '视频与直播带来的订单' },
    ];
    host.innerHTML = cards.map(card => `
      <div class="kpi-card content-kpi">
        <span class="kpi-label">${escapeHtml(card.label)}</span>
        <strong class="kpi-value">${escapeHtml(formatNumber(card.value))}</strong>
        <span class="kpi-hint">${escapeHtml(card.hint)}</span>
      </div>`).join('');
    host.classList.remove('hidden');
  }

  /**
   * The shops that have no reading yet.
   *
   * They are named apart from the ones that read badly: the first has
   * not been looked at, the second was looked at and did not come out
   * well, and a reader who cannot tell them apart will be misled by
   * one of the two.
   */
  function renderNotice(data) {
    const host = document.querySelector('#contentNotice');
    if (!host) return;
    const shops = data.shops || [];
    const withoutVideo = shops.filter(shop => !shop.videoConnected);
    const withoutLive = shops.filter(shop => !shop.livestreamConnected);
    const parts = [];
    if (withoutVideo.length) {
      parts.push(`${withoutVideo.map(shop => shop.displayName || shop.shopId).join('、')} 尚未连接 Video`);
    }
    if (withoutLive.length) {
      parts.push(`${withoutLive.map(shop => shop.displayName || shop.shopId).join('、')} 尚未连接 Livestream`);
    }
    if (!parts.length) {
      host.classList.add('hidden');
      host.innerHTML = '';
      return;
    }
    host.innerHTML = `<p class="content-notice">${escapeHtml(parts.join('；'))}。`
      + '在「店铺接口」里点「连接视频」或「连接直播」即可授权。</p>';
    host.classList.remove('hidden');
  }

  function renderVideoTable(data) {
    const head = document.querySelector('#contentVideoHead');
    const body = document.querySelector('#contentVideoBody');
    if (!head || !body) return;
    const columns = [
      '店铺', '视频', '日期', '观看', '有效观看', '访客', '平均观看',
      '点赞', '分享', '评论', '买家', '加购', '订单', '销售额',
    ];
    head.innerHTML = `<tr>${columns.map(label => `<th scope="col">${escapeHtml(label)}</th>`).join('')}</tr>`;
    const rows = data.videos || [];
    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty" colspan="14">还没有视频读数。授权 Video 应用并同步后，这里会显示每个视频的表现。</td></tr>';
      return;
    }
    body.innerHTML = rows.map(row => `
      <tr>
        <td>${escapeHtml(shopTitle(row.shopId))}</td>
        <td>${escapeHtml(row.title || `视频 ${row.videoId}`)}</td>
        <td>${escapeHtml(row.eventDate || '')}</td>
        <td class="num">${escapeHtml(formatNumber(row.views))}</td>
        <td class="num">${escapeHtml(formatNumber(row.effectiveViews))}</td>
        <td class="num">${escapeHtml(formatNumber(row.viewers))}</td>
        <td class="num">${escapeHtml(formatDuration(row.watchDurationSeconds))}</td>
        <td class="num">${escapeHtml(formatNumber(row.likes))}</td>
        <td class="num">${escapeHtml(formatNumber(row.shares))}</td>
        <td class="num">${escapeHtml(formatNumber(row.comments))}</td>
        <td class="num">${escapeHtml(formatNumber(row.buyers))}</td>
        <td class="num">${escapeHtml(formatNumber(row.addToCart))}</td>
        <td class="num">${escapeHtml(formatNumber(row.orders))}</td>
        <td class="num">${escapeHtml(formatMoney(row.sales))}</td>
      </tr>`).join('');
  }

  function renderSessionTable(data) {
    const head = document.querySelector('#contentSessionHead');
    const body = document.querySelector('#contentSessionBody');
    if (!head || !body) return;
    const columns = [
      '店铺', '直播', '日期', '观看', '访客', '峰值在线', '时长',
      '点击', '加购', '订单', '买家', '销售额', '评论', '分享',
    ];
    head.innerHTML = `<tr>${columns.map(label => `<th scope="col">${escapeHtml(label)}</th>`).join('')}</tr>`;
    const rows = data.sessions || [];
    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty" colspan="14">还没有直播读数。授权 Livestream 应用并同步后，这里会显示每场直播的表现。</td></tr>';
      return;
    }
    body.innerHTML = rows.map(row => `
      <tr>
        <td>${escapeHtml(shopTitle(row.shopId))}</td>
        <td>${escapeHtml(row.title || `场次 ${row.sessionId}`)}</td>
        <td>${escapeHtml(row.eventDate || '')}</td>
        <td class="num">${escapeHtml(formatNumber(row.views))}</td>
        <td class="num">${escapeHtml(formatNumber(row.viewers))}</td>
        <td class="num">${escapeHtml(formatNumber(row.peakViewers))}</td>
        <td class="num">${escapeHtml(formatDuration(row.watchDurationSeconds))}</td>
        <td class="num">${escapeHtml(formatNumber(row.clicks))}</td>
        <td class="num">${escapeHtml(formatNumber(row.addToCart))}</td>
        <td class="num">${escapeHtml(formatNumber(row.orders))}</td>
        <td class="num">${escapeHtml(formatNumber(row.buyers))}</td>
        <td class="num">${escapeHtml(formatMoney(row.sales))}</td>
        <td class="num">${escapeHtml(formatNumber(row.comments))}</td>
        <td class="num">${escapeHtml(formatNumber(row.shares))}</td>
      </tr>`).join('');
  }

  function render(data) {
    current = data || {};
    renderSummary(current);
    renderNotice(current);
    renderVideoTable(current);
    renderSessionTable(current);
  }

  /**
   * The figures, as a file the reader can open elsewhere.
   */
  function exportCsv() {
    const data = current || {};
    const lines = [];
    lines.push('视频表现');
    lines.push('店铺,视频,日期,观看,有效观看,访客,平均观看秒,点赞,分享,评论,买家,加购,订单,销售额');
    for (const row of data.videos || []) {
      const cells = [
        shopTitle(row.shopId), row.title || '', row.eventDate || '',
        row.views, row.effectiveViews, row.viewers, row.watchDurationSeconds,
        row.likes, row.shares, row.comments, row.buyers, row.addToCart,
        row.orders, row.sales,
      ];
      lines.push(cells.map(cell => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','));
    }
    lines.push('');
    lines.push('直播场次');
    lines.push('店铺,直播,日期,观看,访客,峰值在线,时长秒,点击,加购,订单,买家,销售额,评论,分享');
    for (const row of data.sessions || []) {
      const cells = [
        shopTitle(row.shopId), row.title || '', row.eventDate || '',
        row.views, row.viewers, row.peakViewers, row.watchDurationSeconds,
        row.clicks, row.addToCart, row.orders, row.buyers, row.sales,
        row.comments, row.shares,
      ];
      lines.push(cells.map(cell => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `视频与直播-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  window.ShopeeShopContent = { render, exportCsv };
})();
