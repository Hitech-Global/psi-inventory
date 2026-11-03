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
      { label: '已连接店铺', value: rows.length, hint: '已取到健康读数' },
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

  function renderRow(row, measures) {
    const cells = measures.map(measure => {
      const found = (row.measures || []).find(item => item.key === measure.key);
      return `<td>${found ? formatMeasure(found) : '<span class="health-empty">—</span>'}</td>`;
    }).join('');
    return `<tr class="health-row ${escapeHtml(row.status)}">
      <th scope="row">
        <span class="health-shop-name">${escapeHtml(row.displayName || `Shop ${row.shopId}`)}</span>
        <span class="health-shop-id">${escapeHtml(String(row.shopId))}</span>
      </th>
      <td>${statusPill(row.status)}${row.breachCount ? `<span class="health-breach-count">${escapeHtml(String(row.breachCount))} 项未达标</span>` : ''}</td>
      ${cells}
      <td>${isMissing(row.violationTotal) ? '<span class="health-empty">—</span>' : escapeHtml(String(row.violationTotal))}</td>
      <td class="health-date">${escapeHtml(String(row.eventDate || '').slice(0, 10))}</td>
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
  function renderEvents(events) {
    if (!events.length) return '';
    const kindLabels = {
      penalty_point: '绩效罚分',
      listing_issue: '有问题的商品',
      late_order: '迟发订单',
      metric_source: '指标明细',
    };
    const byShop = new Map();
    for (const event of events) {
      if (!byShop.has(event.shopId)) byShop.set(event.shopId, []);
      byShop.get(event.shopId).push(event);
    }
    const sections = [...byShop.entries()].map(([shopId, list]) => {
      const items = list.map(event => {
        const kind = kindLabels[event.kind] || event.kind;
        const metric = event.metricKey ? ` · ${event.metricKey}` : '';
        const reason = event.reasonCode ? ` · 原因码 ${event.reasonCode}` : '';
        const order = event.orderSn ? ` · ${event.orderSn}` : '';
        const title = event.title ? ` · ${event.title}` : '';
        const detail = event.detail ? ` · ${event.detail}` : '';
        return `<li><span class="health-event-kind">${escapeHtml(kind)}${escapeHtml(metric)}</span>`
          + `<span class="health-event-detail">${escapeHtml(reason)}${escapeHtml(order)}${escapeHtml(title)}${escapeHtml(detail)}</span></li>`;
      }).join('');
      const shopName = list[0].shopName || `店铺 ${shopId}`;
      return `<div class="health-event-shop">
        <h4>${escapeHtml(shopName)} <span>${escapeHtml(String(shopId))}</span></h4>
        <ul>${items}</ul>
      </div>`;
    }).join('');
    return `<section class="health-events">
      <h3>指标背后的明细（${events.length}）</h3>
      <p>每个指标背后具体是哪些订单、什么原因码 —— 诊断要看的是这一层。</p>
      ${sections}
    </section>`;
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

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${measures.length + 4}" class="empty">
        还没有店铺健康读数。先在「店铺接口」页为店铺连接 ERP，健康读数会自动开始收集。
      </td></tr>`;
    } else {
      body.innerHTML = rows.map(row => renderRow(row, measures)).join('');
    }

    const notice = document.querySelector('#healthNotice');
    if (notice) {
      const parts = [];
      if (missing.length) parts.push(renderMissing(missing));
      const events = data.events || [];
      if (events.length) parts.push(renderEvents(events));
      if (parts.length) {
        notice.classList.remove('hidden');
        notice.innerHTML = parts.join('');
      } else {
        notice.classList.add('hidden');
        notice.innerHTML = '';
      }
    }
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

  window.ShopeeShopHealth = { render, exportCsv };
})();
