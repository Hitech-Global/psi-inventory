/**
 * Traffic funnel page.
 *
 * The table is laid out the way the team's spreadsheet is: metric names down
 * the left, days across the top, and the change against the previous day
 * sitting above the two headline numbers. Reading a day therefore means
 * reading down a column, the same as reading the sheet.
 *
 * A cell with no source behind it shows a dash rather than a zero. A zero
 * would say the shop had no visitors; a dash says the traffic figures have
 * not been filled in yet. Which sources are missing is stated above the
 * table so the blanks are explained rather than puzzling.
 */
(function () {
  'use strict';

  const DASH = '—';
  const numberFormat = new Intl.NumberFormat('en-US');
  const percentFormat = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  let current = null;
  let currentProducts = null;
  // Which column the products are ordered by, and which way. The first
  // order is the one that answers the question the page is asking — the
  // visits — and it is the largest first.
  let productSort = { key: 'productVisitors', dir: 'desc' };

  function isMissing(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value));
  }

  function formatCount(value) {
    if (isMissing(value)) return DASH;
    return numberFormat.format(Math.round(Number(value)));
  }

  function formatMoney(value, currency) {
    if (isMissing(value)) return DASH;
    if (window.ShopeeCurrency) {
      const formatted = window.ShopeeCurrency.format(Number(value), { currency });
      if (formatted) return formatted;
    }
    return currency ? `${currency} ${numberFormat.format(Number(value))}` : numberFormat.format(Number(value));
  }

  function formatPercent(value) {
    if (isMissing(value)) return DASH;
    return `${percentFormat.format(Number(value) * 100)}%`;
  }

  /** Change against the previous day, signed so a fall reads as a fall. */
  function formatChange(value) {
    if (isMissing(value)) return DASH;
    const number = Number(value);
    const sign = number > 0 ? '+' : '';
    return `${sign}${percentFormat.format(number * 100)}%`;
  }

  function formatCell(row, value, currency) {
    if (row.kind === 'change') return formatChange(value);
    if (row.format === 'percent') return formatPercent(value);
    if (row.format === 'money') return formatMoney(value, currency);
    return formatCount(value);
  }

  function formatDateLabel(isoDate) {
    const [year, month, day] = String(isoDate).split('-');
    if (!year || !month || !day) return isoDate;
    return `${month}/${day}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function renderHead(dates) {
    const cells = dates
      .map(date => `<th class="funnel-date-head">${escapeHtml(formatDateLabel(date))}</th>`)
      .join('');
    return `<tr><th class="funnel-metric-head">指标 / Metric</th>${cells}</tr>`;
  }

  function renderRow(row, dates, currency) {
    const cells = row.values
      .map(value => `<td class="${isMissing(value) ? 'funnel-empty' : ''}">${escapeHtml(formatCell(row, value, currency))}</td>`)
      .join('');
    const rowClass = row.kind === 'change' ? 'funnel-change-row' : 'funnel-metric-row';
    return `<tr class="${rowClass}" data-metric="${escapeHtml(row.key)}"><th scope="row">${escapeHtml(row.label)}</th>${cells}</tr>`;
  }

  function renderGroupRow(group, rows) {
    const members = rows.filter(row => row.group === group.key);
    const label = group.label || group.key;
    return `<tr class="funnel-group-row"><th colspan="${members.length + 1}">${escapeHtml(label)}</th></tr>`;
  }

  function render(data) {
    current = data;
    const host = document.querySelector('#funnelBody');
    const head = document.querySelector('#funnelHead');
    if (!host || !head) return;

    const dates = data.dates || [];
    const rows = data.rows || [];
    const currency = data.shop?.currency || null;

    head.innerHTML = renderHead(dates);

    if (!rows.length || !dates.length) {
      host.innerHTML = `<tr><td colspan="${dates.length + 1}" class="empty">这个区间没有可显示的数据。</td></tr>`;
      return;
    }

    const groups = [];
    for (const row of rows) {
      if (!groups.find(group => group.key === row.group)) {
        groups.push({ key: row.group, label: rows.find(item => item.group === row.group)?.groupLabel || row.group });
      }
    }

    const parts = [];
    for (const group of groups) {
      const groupRows = rows.filter(row => row.group === group.key);
      if (group.kind !== 'change') parts.push(renderGroupRow(group, rows));
      for (const row of groupRows) parts.push(renderRow(row, dates, currency));
    }
    host.innerHTML = parts.join('');

    const subtitle = document.querySelector('#funnelSubtitle');
    if (subtitle) {
      const name = data.shop?.displayName || `店铺 ${data.shop?.shopId ?? ''}`;
      subtitle.textContent = `${name} · ${data.startDate} 至 ${data.endDate} · ${dates.length} 天`;
    }

    renderMissingSources(data.missingSources || []);
  }

  /**
   * What the products drew.
   *
   * These figures are the seller's own: the visits, the pages, what went
   * into the basket and what was saved for later. The open platform gives
   * none of them.
   *
   * They are the figures for the whole period rather than for each day,
   * so the table says so — they are not a day's figures and must not be
   * read against the days above them.
   */
  const PRODUCT_COLUMNS = [
    { key: 'productVisitors', label: '访客', kind: 'count' },
    { key: 'productPageViews', label: '浏览量', kind: 'count' },
    { key: 'bounceRate', label: '跳出率', kind: 'percent' },
    { key: 'searchClicks', label: '搜索点击', kind: 'count' },
    { key: 'likes', label: '收藏', kind: 'count' },
    { key: 'addToCartVisitors', label: '加购访客', kind: 'count' },
    { key: 'addToCartUnits', label: '加购件数', kind: 'count' },
    { key: 'addToCartRate', label: '加购率', kind: 'percent' },
    { key: 'unitsSold', label: '销量', kind: 'count' },
    { key: 'sales', label: '销售额', kind: 'money' },
  ];

  function formatProductValue(value, kind, currency) {
    if (value === null || value === undefined || value === '') return '—';
    if (kind === 'percent') return `${(Number(value) * 100).toFixed(2)}%`;
    if (kind === 'money') return formatMoney(value, currency);
    return Number(value).toLocaleString('en-US');
  }

  function renderProductHead() {
    const cells = PRODUCT_COLUMNS
      .map(column => {
        const active = productSort.key === column.key;
        const arrow = active ? (productSort.dir === 'desc' ? ' ↓' : ' ↑') : '';
        return `<th scope="col" class="funnel-sortable${active ? ' active' : ''}"
          data-sort-key="${escapeHtml(column.key)}" title="点击按${escapeHtml(column.label)}排序">`
          + `${escapeHtml(column.label)}${arrow}</th>`;
      })
      .join('');
    return `<tr><th scope="col">商品</th><th scope="col">父 SKU</th>${cells}</tr>`;
  }

  /**
   * Put the products in order.
   *
   * A figure the shop did not report is not a zero, so it goes to the
   * end whichever way the order runs — a product with no visits yet is
   * not the same as one with none.
   */
  function sortProducts(rows) {
    const { key, dir } = productSort;
    if (!key) return rows;
    const sign = dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = a[key];
      const right = b[key];
      const leftMissing = left === null || left === undefined || left === '';
      const rightMissing = right === null || right === undefined || right === '';
      if (leftMissing && rightMissing) return 0;
      if (leftMissing) return 1;
      if (rightMissing) return -1;
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign;
      return String(left).localeCompare(String(right)) * sign;
    });
  }

  function toggleProductSort(key) {
    if (productSort.key === key) {
      productSort = { key, dir: productSort.dir === 'desc' ? 'asc' : 'desc' };
    } else {
      productSort = { key, dir: 'desc' };
    }
    const head = document.querySelector('#funnelProductsHead');
    const body = document.querySelector('#funnelProductsBody');
    if (head) head.innerHTML = renderProductHead();
    if (body && currentProducts) {
      body.innerHTML = sortProducts(currentProducts.rows || [])
        .map(row => renderProductRow(row, (currentProducts.currency) || null))
        .join('');
    }
  }

  function renderProductRow(row, currency) {
    const cells = PRODUCT_COLUMNS
      .map(column => {
        const value = row[column.key];
        const shown = formatProductValue(value, column.kind, currency);
        const empty = value === null || value === undefined || value === '';
        return `<td class="${empty ? 'funnel-empty' : ''}">${escapeHtml(shown)}</td>`;
      })
      .join('');
    const name = row.itemName ? escapeHtml(String(row.itemName).slice(0, 70)) : '—';
    return `<tr class="funnel-product-row">
      <th scope="row">
        <span class="funnel-product-name" title="${escapeHtml(String(row.itemName || ''))}">${name}</span>
        <span class="funnel-product-id">${escapeHtml(String(row.itemId))}</span>
      </th>
      <td>${row.parentSku && row.parentSku !== '-' ? escapeHtml(String(row.parentSku)) : '<span class="funnel-empty">—</span>'}</td>
      ${cells}
    </tr>`;
  }

  function renderProductSummary(totals, currency) {
    const host = document.querySelector('#funnelProductsSummary');
    if (!host || !totals) return;
    const cards = [
      { label: '商品访客', value: formatProductValue(totals.productVisitors, 'count', currency) },
      { label: '商品浏览量', value: formatProductValue(totals.productPageViews, 'count', currency) },
      { label: '跳出率', value: formatProductValue(totals.bounceRate, 'percent', currency) },
      { label: '收藏', value: formatProductValue(totals.likes, 'count', currency) },
      { label: '加购访客', value: formatProductValue(totals.addToCartVisitors, 'count', currency) },
      { label: '加购件数', value: formatProductValue(totals.addToCartUnits, 'count', currency) },
      { label: '加购率', value: formatProductValue(totals.addToCartRate, 'percent', currency) },
    ];
    host.innerHTML = cards
      .map(card => `<div class="kpi-card"><span class="kpi-label">${escapeHtml(card.label)}</span>`
        + `<strong class="kpi-value">${escapeHtml(String(card.value))}</strong></div>`)
      .join('');
    host.classList.remove('hidden');
  }

  function renderProducts(payload) {
    const panel = document.querySelector('#funnelProductsPanel');
    const head = document.querySelector('#funnelProductsHead');
    const body = document.querySelector('#funnelProductsBody');
    if (!panel || !head || !body) return;
    currentProducts = payload || null;
    const rows = (payload && payload.rows) || [];
    const totals = payload && payload.totals;
    const currency = (payload && payload.currency) || null;
    const byParent = Boolean(payload && payload.byParent);

    if (!rows.length) {
      panel.classList.add('hidden');
      const summary = document.querySelector('#funnelProductsSummary');
      if (summary) summary.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    head.innerHTML = renderProductHead();
    body.innerHTML = sortProducts(rows).map(row => renderProductRow(row, currency)).join('');
    renderProductSummary(totals, currency);
    renderDropoffs(payload.dropoffs || [], payload.rules || null);

    const toggle = document.querySelector('#funnelProductsGroupToggle');
    if (toggle) {
      toggle.textContent = byParent ? '按商品看' : '按父 SKU 聚合';
      toggle.dataset.mode = byParent ? 'item' : 'parent';
    }

    const subtitle = document.querySelector('#funnelProductsSubtitle');
    if (subtitle) {
      const period = totals && totals.eventDate ? String(totals.eventDate).slice(0, 10) : '';
      subtitle.textContent = `访客、浏览、收藏与加购 —— 这些数只有卖家中心的导出里有。`
        + (period ? ` 统计区间自 ${period} 起，为整段期间合计，不是逐日数据。` : ' 为整段期间合计，不是逐日数据。');
    }
  }

  /**
   * The products where the basket did not turn into a sale.
   *
   * A customer who put something in the basket and did not buy it was
   * close to buying, and something stood in the way. What it was cannot
   * be said from the figures — the price, the shipping, the wait or the
   * stock would each show the same way. What the figures do say is how
   * many were let down, and that is the order of the list.
   */
  function renderDropoffs(dropoffs, rules) {
    const host = document.querySelector('#funnelDropoffs');
    if (!host) return;
    if (!dropoffs.length) {
      host.classList.add('hidden');
      host.innerHTML = '';
      return;
    }
    host.classList.remove('hidden');
    const minVisitors = rules && rules.minAddToCartVisitors ? rules.minAddToCartVisitors : 100;
    const maxRate = rules && rules.maxBuyerRate ? rules.maxBuyerRate : 0.4;
    const items = dropoffs.map(row => `
      <li>
        <span class="funnel-dropoff-name">${escapeHtml(String(row.itemName || `商品 ${row.itemId}`).slice(0, 60))}</span>
        <span class="funnel-dropoff-id">${escapeHtml(String(row.itemId))}</span>
        <span class="funnel-dropoff-facts">
          加购 <strong>${escapeHtml(String(row.addToCartVisitors))}</strong> 人
          · 成交 <strong>${escapeHtml(String(row.buyers))}</strong> 人
          · 流失 <strong class="funnel-dropoff-lost">${escapeHtml(String(row.lostVisitors))}</strong> 人
          · 买家率 ${escapeHtml((row.buyerRate * 100).toFixed(1))}%
        </span>
        <span class="funnel-dropoff-action">查价格与运费</span>
      </li>`).join('');
    host.innerHTML = `
      <h3>加购了却没买（${dropoffs.length}）</h3>
      <p>加购访客 ≥ ${escapeHtml(String(minVisitors))} 且买家占比 &lt; ${escapeHtml((maxRate * 100).toFixed(0))}% 判为未转化，按流失人数排序。</p>
      <ul>${items}</ul>`;
  }

  function exportProductsCsv() {
    if (!currentProducts || !currentProducts.rows.length) return;
    const rows = sortProducts(currentProducts.rows);
    const head = ['商品', '商品ID', '父SKU', ...PRODUCT_COLUMNS.map(column => column.label)];
    const lines = [head.join(',')];
    for (const row of rows) {
      const cells = [
        String(row.itemName || ''), String(row.itemId), String(row.parentSku || ''),
        ...PRODUCT_COLUMNS.map(column => {
          const value = row[column.key];
          if (value === null || value === undefined || value === '') return '';
          return column.kind === 'percent' ? (Number(value) * 100).toFixed(2) + '%' : String(value);
        }),
      ];
      lines.push(cells.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `商品表现-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function renderMissingSources(missing) {
    const host = document.querySelector('#funnelMissing');
    if (!host) return;
    if (!missing.length) {
      host.classList.add('hidden');
      host.innerHTML = '';
      return;
    }
    const items = missing
      .map(entry => {
        const head = `<strong>${escapeHtml(entry.source)}</strong>：${escapeHtml(entry.metrics.join('、'))}`;
        if (!entry.action) return `<li>${head}</li>`;
        return `<li>${head}<br /><span class="funnel-source-action">${escapeHtml(entry.action)}</span></li>`;
      })
      .join('');
    host.innerHTML = `<strong>以下数据源尚未就绪，相关单元格显示为 ${DASH}：</strong><ul>${items}</ul>`;
    host.classList.remove('hidden');
  }

  /** Export the table the way it is shown, so it can be dropped into a sheet. */
  function exportCsv() {
    if (!current) return;
    const currency = current.shop?.currency || '';
    const header = ['Metric', ...(current.dates || []).map(formatDateLabel)].join(',');
    const lines = [header];
    for (const row of current.rows || []) {
      const cells = row.values.map(value => {
        const text = formatCell(row, value, currency);
        return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      });
      lines.push([row.label, ...cells].join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `shopee-funnel-${current.shop?.shopId ?? 'shop'}-${current.startDate}-${current.endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  async function load() {
    const shop = window.ShopeeFunnelState?.selectedShop?.();
    if (!shop) return;
    const filters = window.ShopeeFunnelState?.currentFilters?.() || {};
    const params = new URLSearchParams({
      shop_id: String(shop.shopId),
      start_date: filters.startDate,
      end_date: filters.endDate,
    });
    const data = await window.ShopeeFunnelState?.json?.(`/api/shopee-analytics/funnel?${params}`);
    render(data);
  }

  document.addEventListener('click', event => {
    const head = event.target.closest('#funnelProductsHead [data-sort-key]');
    if (head) toggleProductSort(head.dataset.sortKey);
  });

  window.ShopeeFunnel = {
    render, load, exportCsv, renderProducts, exportProductsCsv,
    formatCount, formatMoney, formatPercent, formatChange,
  };
})();
