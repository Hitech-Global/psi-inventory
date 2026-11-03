'use strict';

/**
 * How each shop is being run.
 *
 * The platform sets a standard for each figure and reports the figure
 * beside it, so a shop is said to have met a standard only where the
 * platform's own line says it did. The figure is shown with the standard
 * it is measured against, so a reader can see what it was measured
 * against rather than being told only that it fell short.
 *
 * A shop with no reading is shown apart from one that fell short. They
 * are not the same thing: the first has not been looked at, the second
 * was looked at and did not come out well.
 */

(function () {
  let current = null;
  // The detail held against each figure, and how many there are.
  let detailGroups = new Map();
  let detailCounts = new Map();

  /**
   * The name a measure is known by on the page.
   */
  function metricLabel(metricKey) {
    const measures = (current && current.measures) || [];
    const found = measures.find(measure => measure.key === metricKey);
    return found ? found.label : metricKey || '其它';
  }

  const STATUS_TEXT = {
    good: { label: '良好', className: 'health-pill good' },
    watch: { label: '需关注', className: 'health-pill watch' },
    poor: { label: '需改进', className: 'health-pill poor' },
    unknown: { label: '数据不足', className: 'health-pill unknown' },
    unconnected: { label: '未连接', className: 'health-pill unconnected' },
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function isMissing(value) {
    return value === null || value === undefined || value === '';
  }

  /**
   * A figure, the standard it is measured against, and whether it met it.
   */
  /**
   * A figure, written the way its kind is written.
   */
  function formatValue(value, kind) {
    if (isMissing(value)) return '—';
    if (kind === 'percent') return `${(Number(value) * 100).toFixed(2)}%`;
    if (kind === 'days') return `${Number(value).toFixed(2)} 天`;
    return Number(value).toFixed(2);
  }

  function formatMeasure(measure) {
    if (isMissing(measure.value)) return '<span class="health-empty">—</span>';
    const shown = formatValue(measure.value, measure.kind);
    // The standard is written the same way as the figure, so the two can be
    // read against each other: a standard of five per cent is not shown as
    // a fifth of a per cent.
    const target = isMissing(measure.target)
      ? ''
      : ` <span class="health-target">${escapeHtml(measure.comparator || '')} ${escapeHtml(formatValue(measure.target, measure.kind))}</span>`;
    const mark = measure.status === 'met'
      ? '<span class="health-mark met" title="达标">✓</span>'
      : measure.status === 'breached'
        ? '<span class="health-mark breached" title="未达标">!</span>'
        : '';
    return `<span class="health-value">${escapeHtml(shown)}</span>${target}${mark}`;
  }

  function statusPill(status) {
    const spec = STATUS_TEXT[status] || STATUS_TEXT.unknown;
    return `<span class="${spec.className}">${escapeHtml(spec.label)}</span>`;
  }

  function renderSummary(data) {
    const host = document.querySelector('#healthSummary');
    if (!host) return;
    const rows = data.rows || [];
    const missing = data.missing || [];
    const count = status => rows.filter(row => row.status === status).length;
    const cards = [
      { label: '店铺总数', value: rows.length, hint: '当前筛选下的店铺' },
      { label: '良好', value: count('good'), hint: '全部指标达标' },
      { label: '需关注', value: count('watch'), hint: '有指标未达标' },
      { label: '需改进', value: count('poor'), hint: '店铺评分未达标' },
      { label: '未连接', value: missing.length, hint: '缺少 ERP 连接' },
    ];
    host.innerHTML = cards.map(card => `
      <div class="kpi-card health-kpi">
        <span class="kpi-label">${escapeHtml(card.label)}</span>
        <strong class="kpi-value">${escapeHtml(String(card.value))}</strong>
        <span class="kpi-hint">${escapeHtml(card.hint)}</span>
      </div>`).join('');
    host.classList.remove('hidden');
  }

  function renderHead(measures) {
    const heads = measures.map(measure => `<th scope="col">${escapeHtml(measure.label)}</th>`).join('');
    return `<tr>
      <th scope="col">店铺</th>
      <th scope="col">状态</th>
      ${heads}
      <th scope="col">违规</th>
      <th scope="col">数据日期</th>
    </tr>`;
  }

  function renderRow(row, measures, detailCounts) {
    const cells = measures.map(measure => {
      const found = (row.measures || []).find(item => item.key === measure.key);
      const shown = found ? formatMeasure(found) : '<span class="health-empty">—</span>';
      const count = (detailCounts && detailCounts.get(`${row.shopId}|${measure.key}`)) || 0;
      // A figure with detail behind it says so, and opens it when asked.
      if (!count) return `<td>${shown}</td>`;
      return `<td class="health-cell-detail" data-shop="${escapeHtml(String(row.shopId))}"
        data-metric="${escapeHtml(measure.key)}" title="点击查看 ${count} 条明细">`
        + `${shown}<span class="health-detail-mark">${escapeHtml(String(count))}</span></td>`;
    }).join('');
    // A shop that has not been read yet is shown in the table with its
    // number, so the table is a list of the shops rather than a list of
    // the shops that happened to have figures.
    const note = row.status === 'unconnected'
      ? '<span class="health-breach-count">尚未连接 ERP</span>'
      : row.breachCount
        ? `<span class="health-breach-count">${escapeHtml(String(row.breachCount))} 项未达标</span>`
        : '';
    return `<tr class="health-row ${escapeHtml(row.status)}">
      <th scope="row">
        <span class="health-shop-name">${escapeHtml(row.displayName || `Shop ${row.shopId}`)}</span>
        <span class="health-shop-id">${escapeHtml(String(row.shopId))}</span>
      </th>
      <td>${statusPill(row.status)}${note}</td>
      ${cells}
      <td>${isMissing(row.violationTotal) ? '<span class="health-empty">—</span>' : escapeHtml(String(row.violationTotal))}</td>
      <td class="health-date">${row.eventDate ? escapeHtml(String(row.eventDate).slice(0, 10)) : '<span class="health-empty">—</span>'}</td>
    </tr>`;
  }

  function renderMissing(missing) {
    if (!missing.length) return '';
    const items = missing.map(row => `
      <li>
        <span class="health-shop-name">${escapeHtml(row.displayName || `Shop ${row.shopId}`)}</span>
        <span class="health-shop-id">${escapeHtml(String(row.shopId))}</span>
        <span class="health-missing-note">缺少 ERP 连接，取不到健康读数</span>
      </li>`).join('');
    return `
      <section class="health-missing">
        <h3>还没有读数的店铺（${missing.length}）</h3>
        <p>这些店铺尚未建立 ERP 连接，因此取不到健康读数。这与「读了但不达标」不同。</p>
        <ul>${items}</ul>
      </section>`;
  }

  /**
   * What is behind the figures.
   *
   * A rate says a shop's cancellations are a fraction of its orders; the
   * detail names the orders and the reason each was counted. A reader
   * looking at a shop that is not doing well needs the second, and so does
   * a diagnosis — it cannot be built on the first alone.
   */
  /**
   * The detail behind each measure, kept where it belongs.
   *
   * A reader looking at the table wants to know which figure is wrong and
   * then which orders it was wrong about. Listing every order for every
   * shop below the table answers the second question before it is asked,
   * and buries the first.
   *
   * So the detail is held against the figure it belongs to and shown only
   * when that figure is clicked.
   */
  function groupEvents(events, measures) {
    const grouped = new Map();
    if (!events || !events.length) return grouped;
    for (const event of events) {
      const key = `${event.shopId}|${event.metricKey || ''}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(event);
    }
    return grouped;
  }

  /**
   * The detail for one figure, as a table.
   */
  function renderDetailRows(list, measures) {
    const kindLabels = {
      penalty_point: '绩效罚分',
      listing_issue: '有问题的商品',
      late_order: '迟发订单',
      metric_source: '指标明细',
    };
    const head = `<tr>
      <th scope="col">类型</th>
      <th scope="col">订单号</th>
      <th scope="col">原因码</th>
      <th scope="col">详情</th>
    </tr>`;
    const rows = list.map(event => {
      const kind = kindLabels[event.kind] || event.kind;
      const reason = event.reasonCode ? `原因码 ${event.reasonCode}` : '—';
      const order = event.orderSn || '—';
      const parts = [event.title, event.detail].filter(Boolean).join(' · ');
      // The measure is already named above the table; saying it again in
      // every row says nothing.
      const detail = parts || (event.metricKey ? '—' : '—');
      return `<tr>
        <td>${escapeHtml(kind)}</td>
        <td class="health-detail-order">${escapeHtml(String(order))}</td>
        <td>${escapeHtml(String(reason))}</td>
        <td>${escapeHtml(detail)}</td>
      </tr>`;
    }).join('');
    return `<table class="health-detail-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }

  function render(data) {
    current = data;
    const head = document.querySelector('#healthHead');
    const body = document.querySelector('#healthBody');
    if (!head || !body) return;

    const measures = data.measures || [];
    const rows = data.rows || [];
    const missing = data.missing || [];

    renderSummary(data);
    head.innerHTML = renderHead(measures);

    // The detail is held against the figure it belongs to, and shown only
    // when that figure is clicked.
    detailGroups = groupEvents(data.events || [], measures);
    detailCounts = new Map([...detailGroups].map(([key, list]) => [key, list.length]));

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${measures.length + 4}" class="empty">
        当前筛选下没有店铺。先在「店铺接口」页为店铺连接 ERP，健康读数会自动开始收集。
      </td></tr>`;
    } else {
      body.innerHTML = rows.map(row => renderRow(row, measures, detailCounts)).join('');
    }

    const notice = document.querySelector('#healthNotice');
    if (notice) {
      const parts = [];
      if (missing.length) parts.push(renderMissing(missing));
      if (parts.length) {
        notice.classList.remove('hidden');
        notice.innerHTML = parts.join('');
      } else {
        notice.classList.add('hidden');
        notice.innerHTML = '';
      }
    }
  }

  /**
   * Open the detail behind a figure, or close it again.
   */
  function toggleDetail(cell) {
    const shopId = cell.dataset.shop;
    const metricKey = cell.dataset.metric;
    const key = `${shopId}|${metricKey}`;
    const list = detailGroups.get(key);
    if (!list || !list.length) return;
    const body = document.querySelector('#healthBody');
    if (!body) return;
    const row = cell.closest('tr');
    if (!row) return;
    const existing = body.querySelector(`tr[data-detail-key="${CSS.escape(key)}"]`);
    if (existing) {
      existing.remove();
      cell.classList.remove('open');
      return;
    }
    const detailRow = document.createElement('tr');
    detailRow.className = 'health-detail-row';
    detailRow.dataset.detailKey = key;
    const columns = document.querySelectorAll('#healthHead th').length || 1;
    detailRow.innerHTML = `<td colspan="${columns}">`
      + `<div class="health-detail-box">`
      + `<div class="health-detail-head">${escapeHtml(metricLabel(metricKey))} 的明细（${list.length} 条）</div>`
      + renderDetailRows(list, current ? current.measures : [])
      + `</div></td>`;
    row.after(detailRow);
    cell.classList.add('open');
  }

  function exportCsv() {
    if (!current) return;
    const measures = current.measures || [];
    const head = ['店铺', '店铺ID', '状态', ...measures.map(measure => measure.label), '违规数', '数据日期'];
    const lines = [head.join(',')];
    for (const row of current.rows || []) {
      const cells = [
        row.displayName || '',
        String(row.shopId),
        (STATUS_TEXT[row.status] || STATUS_TEXT.unknown).label,
        ...measures.map(measure => {
          const found = (row.measures || []).find(item => item.key === measure.key);
          if (!found || isMissing(found.value)) return '';
          return found.kind === 'percent' ? (Number(found.value) * 100).toFixed(2) : String(found.value);
        }),
        isMissing(row.violationTotal) ? '' : String(row.violationTotal),
        String(row.eventDate || '').slice(0, 10),
      ];
      lines.push(cells.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `店铺健康-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  document.addEventListener('click', event => {
    const cell = event.target.closest('.health-cell-detail');
    if (cell) toggleDetail(cell);
  });

  window.ShopeeShopHealth = { render, exportCsv };
})();
