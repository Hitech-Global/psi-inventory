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

  function renderMissingSources(missing) {
    const host = document.querySelector('#funnelMissing');
    if (!host) return;
    if (!missing.length) {
      host.classList.add('hidden');
      host.innerHTML = '';
      return;
    }
    const items = missing
      .map(entry => `<li><strong>${escapeHtml(entry.source)}</strong>：${escapeHtml(entry.metrics.join('、'))}</li>`)
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

  window.ShopeeFunnel = { render, load, exportCsv, formatCount, formatMoney, formatPercent, formatChange };
})();
