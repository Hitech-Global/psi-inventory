'use strict';

/**
 * TikTok Shop 页签。
 *
 * 这个页签要回答的是「TikTok 店现在怎么样」，但它有两件 Shopee 页签没有的难处：
 *
 * 一、口径不能混
 *   TikTok 的三个 GMV 口径（订单实付 / 货款小计 / 结算收入）互不推导。
 *   所以表格按**口径分行**：每行是一个口径下的数，
 *   绝不把三个口径加总成一个"总 GMV" —— 那样得到的数字没有任何业务含义。
 *   每个口径旁边都写着它的名字，读者一眼能看出自己在看哪一列。
 *
 * 二、没有数据和数是零不是一回事
 *   某天没订单，可能是那天真没生意，也可能是那天没同步过来。
 *   后者说明数据是缺的，不能当 0 参与计算。所以缺失一律显示"—"而不是 0。
 *
 * 广告数据不在这里：Marketing API 的鉴权方式与 Shop Open API 不兼容，
 * 尚未接通。页面会把这件事说清楚，而不是给一个空的广告表格让人猜。
 */

(function () {
  let current = null;

  /** 缺失值显示成破折号，而不是 0 —— 0 是「确实是零」，破折号是「没有」。 */
  const MISSING = '—';

  /**
   * 口径的展示顺序。
   *
   * 订单口径排第一：它是唯一不依赖报表接口、只要有订单就能算出来的口径，
   * 也就最容易拿到。平台归因与纯付费口径依赖广告报表，结算口径依赖账单。
   */
  const BASIS_ORDER = ['order_level', 'platform_attributed', 'paid_only', 'derived_incremental', 'derived_net', 'unknown'];

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /**
   * 判断一个值是否缺失。
   *
   * null / undefined / 空串都是缺失；0 不是 ——
   * 0 是一个真实的数（这天真的没订单），显示成"—"会把它伪装成缺数据。
   */
  function isMissing(value) {
    return value === null || value === undefined || value === '';
  }

  /** 数字展示：缺失显示破折号，其余保留两位小数（去掉多余的尾零）。 */
  function formatNumber(value) {
    if (isMissing(value)) return MISSING;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return MISSING;
    return parsed.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  /** 金额展示：带上币种。缺失时只显示破折号，不带币种 —— 避免误导。 */
  function formatMoney(value, currency) {
    if (isMissing(value)) return MISSING;
    const code = currency && currency !== 'UNKNOWN' ? ` ${currency}` : '';
    return `${formatNumber(value)}${code}`;
  }

  /** 百分比展示：值是小数（0.05 = 5%）。缺失时显示破折号。 */
  function formatPercent(value) {
    if (isMissing(value)) return MISSING;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return MISSING;
    return `${(parsed * 100).toFixed(2)}%`;
  }

  /**
   * 把日期渲染成 Excel 能识别的日期，避免导出后变成一串数字。
   */
  function formatDate(value) {
    if (isMissing(value)) return '';
    return String(value).slice(0, 10);
  }

  /**
   * 顶部概览卡片。
   *
   * ★ 这里刻意**不显示**一个"总 GMV"卡片。三个口径不能相加，
   *   所以只显示订单口径的实付额，并标明它是订单口径。
   */
  function renderSummary(data) {
    const host = document.querySelector('#tiktokSummary');
    if (!host) return;
    const byBasis = data.byBasis || {};
    const orderBasis = byBasis.order_level || {};
    const coverage = data.coverage || {};
    const days = Number(orderBasis.dayCount || 0);

    const cards = [
      { label: '订单实付', value: formatMoney(orderBasis.gmvOrderTotal, orderBasis.currency), hint: '订单口径' },
      { label: '订单数', value: formatNumber(orderBasis.orders), hint: `${days} 天有数据` },
      { label: '已同步天数', value: formatNumber(coverage.coveredDayCount), hint: `区间 ${formatDate(data.startDate)} 起` },
      { label: '订单总数', value: formatNumber(coverage.orderCount), hint: `商品 ${formatNumber(coverage.productCount)}` },
    ];

    host.innerHTML = cards.map(card => `
      <div class="kpi-card">
        <span class="kpi-label">${escapeHtml(card.label)}</span>
        <strong class="kpi-value">${escapeHtml(card.value)}</strong>
        <span class="kpi-hint">${escapeHtml(card.hint)}</span>
      </div>`).join('');
    host.classList.remove('hidden');
  }

  /**
   * 口径说明条。
   *
   * 页面必须说清楚「下面这些数字分别是什么口径」——
   * 否则同一天里两行不同口径的数会被当成同一个指标的两条记录。
   */
  function renderNotice(data) {
    const host = document.querySelector('#tiktokNotice');
    if (!host) return;
    const byBasis = data.byBasis || {};
    const present = BASIS_ORDER.filter(basis => byBasis[basis]);
    const coverage = data.coverage || {};

    if (!present.length) {
      host.innerHTML = '<div class="tiktok-notice warn">'
        + '<strong>这个区间还没有 TikTok 数据。</strong>'
        + `<span>区间 ${escapeHtml(formatDate(data.startDate))} 至 ${escapeHtml(formatDate(data.endDate))} 内没有任何口径的记录。`
        + '请先在「平台接入」里完成 TikTok 店铺授权，再触发一次数据同步。</span></div>';
      host.classList.remove('hidden');
      return;
    }

    const parts = present.map(basis => {
      const row = byBasis[basis];
      return `${escapeHtml(row.attributionLabel)}（${escapeHtml(row.sourceLabel)}）`;
    });

    const missingNote = coverage.orderCount
      ? ''
      : '<div class="tiktok-notice warn"><strong>还没有同步到订单。</strong>'
        + '<span>店铺已授权，但这个区间内没有订单数据。可能是尚未触发同步，也可能是确实没有订单 —— 两种情况在页面上分得清。</span></div>';

    host.innerHTML = missingNote
      + '<div class="tiktok-notice"><strong>下面每个口径各占一行，它们不能相加。</strong>'
      + `<span>${parts.join('、')}。三个 GMV 口径互不推导，把它们加总会得到一个没有业务含义的数字。</span></div>`;
    host.classList.remove('hidden');
  }

  /**
   * 日粒度表格：按日期 + 口径分行。
   */
  function renderDailyTable(data) {
    const head = document.querySelector('#tiktokDailyHead');
    const body = document.querySelector('#tiktokDailyBody');
    if (!head || !body) return;
    const rows = data.daily || [];

    head.innerHTML = `<tr>
      <th scope="col">日期</th>
      <th scope="col">口径</th>
      <th scope="col">来源</th>
      <th scope="col">币种</th>
      <th scope="col">订单数</th>
      <th scope="col">销量</th>
      <th scope="col">订单实付</th>
      <th scope="col">货款小计</th>
      <th scope="col">结算收入</th>
      <th scope="col">退款</th>
      <th scope="col">取消</th>
    </tr>`;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="11" class="empty">这个区间还没有数据。</td></tr>';
      return;
    }

    body.innerHTML = rows.map(row => `<tr>
      <td>${escapeHtml(formatDate(row.eventDate))}</td>
      <td><span class="tiktok-basis">${escapeHtml(row.attributionLabel || row.attributionBasis || '')}</span></td>
      <td>${escapeHtml(row.sourceLabel || row.source || '')}</td>
      <td>${escapeHtml(row.currency || '')}</td>
      <td>${escapeHtml(formatNumber(row.orders))}</td>
      <td>${escapeHtml(formatNumber(row.units))}</td>
      <td>${escapeHtml(formatMoney(row.gmvOrderTotal, row.currency))}</td>
      <td>${escapeHtml(formatMoney(row.gmvSubtotal, row.currency))}</td>
      <td>${escapeHtml(formatMoney(row.gmvSettled, row.currency))}</td>
      <td>${escapeHtml(formatMoney(row.refunds, row.currency))}</td>
      <td>${escapeHtml(formatNumber(row.cancellations))}</td>
    </tr>`).join('');
  }

  /**
   * 商品表格。
   *
   * 商品级没有结算口径 —— 结算只到订单/账单层。所以这里不显示结算列，
   * 而不是显示一列破折号让人以为"这个商品没结算收入"。
   */
  function renderProductTable(data) {
    const head = document.querySelector('#tiktokProductHead');
    const body = document.querySelector('#tiktokProductBody');
    if (!head || !body) return;
    const rows = data.products || [];

    head.innerHTML = `<tr>
      <th scope="col">商品</th>
      <th scope="col">商品 ID</th>
      <th scope="col">订单数</th>
      <th scope="col">销量</th>
      <th scope="col">商品金额</th>
      <th scope="col">折扣</th>
    </tr>`;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">这个区间还没有商品数据。</td></tr>';
      return;
    }

    body.innerHTML = rows.map(row => `<tr>
      <td>${escapeHtml(row.productName || '')}</td>
      <td>${escapeHtml(row.productId || '')}</td>
      <td>${escapeHtml(formatNumber(row.orderCount))}</td>
      <td>${escapeHtml(formatNumber(row.units))}</td>
      <td>${escapeHtml(formatNumber(row.grossAmount))}</td>
      <td>${escapeHtml(formatNumber(row.discounts))}</td>
    </tr>`).join('');
  }

  /**
   * 最近订单表格。
   */
  function renderOrderTable(data) {
    const head = document.querySelector('#tiktokOrderHead');
    const body = document.querySelector('#tiktokOrderBody');
    if (!head || !body) return;
    const rows = data.orders || [];

    head.innerHTML = `<tr>
      <th scope="col">订单号</th>
      <th scope="col">日期</th>
      <th scope="col">状态</th>
      <th scope="col">口径</th>
      <th scope="col">币种</th>
      <th scope="col">销量</th>
      <th scope="col">订单实付</th>
      <th scope="col">货款小计</th>
    </tr>`;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">这个区间还没有订单。</td></tr>';
      return;
    }

    body.innerHTML = rows.map(row => `<tr>
      <td>${escapeHtml(row.orderId || '')}</td>
      <td>${escapeHtml(formatDate(row.orderDate))}</td>
      <td>${escapeHtml(row.orderStatus || '')}</td>
      <td><span class="tiktok-basis">${escapeHtml(row.attributionLabel || '')}</span></td>
      <td>${escapeHtml(row.currency || '')}</td>
      <td>${escapeHtml(formatNumber(row.units))}</td>
      <td>${escapeHtml(formatMoney(row.gmvOrderTotal, row.currency))}</td>
      <td>${escapeHtml(formatMoney(row.gmvSubtotal, row.currency))}</td>
    </tr>`).join('');
  }

  /**
   * 渲染整个页签。
   *
   * @param {object} data 后端返回的 { byBasis, daily, coverage, startDate, endDate }
   */
  function render(data) {
    if (!data) return;
    current = data;
    renderSummary(data);
    renderNotice(data);
    renderDailyTable(data);
    // products / orders 传进来时可能是数组，也可能是 { products: [...] }。
    // 两种都接受 —— 调用方（app.js）传的是数组，而后端接口返回的是带外层的对象。
    renderProductTable({ products: Array.isArray(data.products) ? data.products : (data.products?.products || []) });
    renderOrderTable({ orders: Array.isArray(data.orders) ? data.orders : (data.orders?.orders || []) });
  }

  /**
   * 导出日粒度 CSV。
   *
   * ★ 导出里也带着口径列 —— 把 CSV 拿到 Excel 里做透视时，
   *   不同口径的数仍然分得开。
   */
  function exportCsv() {
    if (!current) return;
    const head = ['日期', '口径', '来源', '币种', '订单数', '销量', '订单实付', '货款小计', '结算收入', '退款', '取消'];
    const lines = [head.join(',')];
    for (const row of current.daily || []) {
      const cells = [
        formatDate(row.eventDate),
        row.attributionLabel || row.attributionBasis || '',
        row.sourceLabel || row.source || '',
        row.currency || '',
        isMissing(row.orders) ? '' : String(row.orders),
        isMissing(row.units) ? '' : String(row.units),
        isMissing(row.gmvOrderTotal) ? '' : String(row.gmvOrderTotal),
        isMissing(row.gmvSubtotal) ? '' : String(row.gmvSubtotal),
        isMissing(row.gmvSettled) ? '' : String(row.gmvSettled),
        isMissing(row.refunds) ? '' : String(row.refunds),
        isMissing(row.cancellations) ? '' : String(row.cancellations),
      ];
      lines.push(cells.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tiktok-daily-${formatDate(current.startDate)}-${formatDate(current.endDate)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  window.TikTokUI = { render, exportCsv };
})();
