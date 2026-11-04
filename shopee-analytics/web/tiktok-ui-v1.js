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

  /**
   * 渲染诊断结论。
   *
   * ★ 这个页签最容易骗人的地方是「把推测说成事实」。
   * 所以每条结论都带上 kind 标签：data-fact 是数据事实，ai-suggestion 是 AI 推测建议。
   * 两者在视觉上必须能一眼分开 —— 事实用中性色，推测用带标记的样式。
   *
   * @param {object} diagnosis 后端 /tiktok/shops/:shopId/diagnosis 的返回
   */
  /**
   * 渲染诊断结论。
   *
   * ★ 这个页签最要紧的是不能把 AI 推测说得像数据事实。
   * 所以每条结论都带上 kind 标签：data-fact 是数据事实，ai-suggestion 是 AI 推测建议。
   * 两者在视觉上必须能一眼分开 —— 事实用中性色，推测用带标记的样式。
   *
   * @param {object} diagnosis 后端 /tiktok/shops/:shopId/diagnosis 的返回
   * @param {object} [options] 目标容器的 id 前缀，默认用经营数据页的那一套
   */
  function renderDiagnosis(diagnosis, options = {}) {
    const prefix = options.prefix || {
      notice: 'tiktokDiagnosisNotice',
      signals: 'tiktokSignals',
      unavailable: 'tiktokUnavailable',
    };
    const notice = document.querySelector(`#${prefix.notice}`);
    const signalsHost = document.querySelector(`#${prefix.signals}`);
    const unavailableHost = document.querySelector(`#${prefix.unavailable}`);
    if (!signalsHost) return;

    const signals = (diagnosis && diagnosis.signals) || [];
    const unavailable = (diagnosis && diagnosis.unavailable) || [];

    // 能力边界：拿不到的结论要说清楚。这是平台数据的客观边界，不是系统故障。
    if (unavailableHost) {
      if (unavailable.length) {
        unavailableHost.innerHTML = '<div class="tiktok-unavailable-box">'
          + '<strong>这几项在 TikTok 侧拿不到</strong>'
          + '<ul>' + unavailable.map(item => `
            <li>
              <span class="tiktok-unavailable-title">${escapeHtml(item.title)}</span>
              <span class="tiktok-unavailable-reason">${escapeHtml(item.reason || '')}</span>
              ${item.impact ? `<span class="tiktok-unavailable-impact">${escapeHtml(item.impact)}</span>` : ''}
            </li>`).join('')
          + '</ul></div>';
        unavailableHost.classList.remove('hidden');
      } else {
        unavailableHost.innerHTML = '';
        unavailableHost.classList.add('hidden');
      }
    }

    if (notice) {
      if (!signals.length) {
        notice.innerHTML = '<div class="tiktok-notice warn">'
          + '<strong>暂时没有可诊断的结论。</strong>'
          + '<span>这个区间内没有可用于诊断的数据。先完成授权并同步数据，再运行诊断。</span></div>';
        notice.classList.remove('hidden');
      } else {
        notice.innerHTML = '';
        notice.classList.add('hidden');
      }
    }

    if (!signals.length) {
      signalsHost.innerHTML = '';
      signalsHost.classList.add('hidden');
      return;
    }

    signalsHost.innerHTML = signals.map(item => {
      const isFact = item.kind === 'data-fact';
      return `<article class="tiktok-signal ${isFact ? 'fact' : 'suggestion'} ${escapeHtml(item.severity || 'info')}">
        <header class="tiktok-signal-head">
          <span class="tiktok-signal-kind">${isFact ? '数据事实' : 'AI 推测建议'}</span>
          <h3>${escapeHtml(item.title || '')}</h3>
        </header>
        <p class="tiktok-signal-detail">${escapeHtml(item.detail || '')}</p>
        ${item.action ? `<p class="tiktok-signal-action"><span>落地动作</span>${escapeHtml(item.action)}</p>` : ''}
      </article>`;
    }).join('');
    signalsHost.classList.remove('hidden');
  }

  /**
   * 渲染广告数据。
   *
   * ★ 这个区块最要紧的是**不把两种口径混在一起**：
   *   - 平台归因（GMV Max）：cost 与 gross_revenue 同源，相除就是平台 ROI，
   *     但 gross_revenue 含自然流量；
   *   - 纯付费（整合报表）：spend/impressions/clicks 是真正的付费侧数据。
   *
   * 表格按口径分行呈现，每行标出口径名与来源。
   * 概览卡片也分开 —— 平台归因的花费占比与纯付费的花费是同一个数，
   * 但它们与各自口径的 GMV 相除才是有意义的比值。
   *
   * @param {object} payload { rows: Array<object> }
   */
  function renderAds(payload) {
    const head = document.querySelector('#tiktokAdsHead');
    const body = document.querySelector('#tiktokAdsBody');
    const summary = document.querySelector('#tiktokAdsSummary');
    const notice = document.querySelector('#tiktokAdsNotice');
    if (!head || !body) return;

    const rows = (payload && payload.rows) || [];
    const platformAttributed = rows.filter(row => row.attributionBasis === 'platform_attributed');
    const paidOnly = rows.filter(row => row.attributionBasis === 'paid_only');

    if (notice) {
      if (!rows.length) {
        notice.innerHTML = '<div class="tiktok-notice warn">'
          + '<strong>还没有广告数据。</strong>'
          + '<span>需要先授权 TikTok 广告账户，再同步一次广告数据。'
          + '注意广告线用的是 Marketing API，与店铺授权是两套独立的凭据。</span></div>';
        notice.classList.remove('hidden');
      } else {
        notice.innerHTML = '';
        notice.classList.add('hidden');
      }
    }

    // 概览：两个口径各自给卡片，绝不合并。
    if (summary) {
      const attrTotal = sumField(platformAttributed, 'gmvOrderTotal');
      const paidTotal = sumField(paidOnly, 'spend');
      const cards = [
        {
          label: '平台归因 GMV',
          value: formatMoney(attrTotal, firstCurrency(platformAttributed)),
          hint: 'GMV Max · 含自然流量',
        },
        {
          label: '纯付费花费',
          value: formatMoney(paidTotal, firstCurrency(paidOnly)),
          hint: '整合报表 · 真实广告花费',
        },
        {
          label: '平台归因 ROI',
          value: formatRatio(attrTotal, paidTotal),
          hint: '归因 GMV ÷ 纯付费花费',
        },
        {
          label: '纯付费曝光',
          value: formatNumber(sumField(paidOnly, 'impressions')),
          hint: '整合报表 · 点击 ' + formatNumber(sumField(paidOnly, 'clicks')),
        },
      ];
      summary.innerHTML = cards.map(card => `
        <div class="kpi-card">
          <span class="kpi-label">${escapeHtml(card.label)}</span>
          <strong class="kpi-value">${escapeHtml(card.value)}</strong>
          <span class="kpi-hint">${escapeHtml(card.hint)}</span>
        </div>`).join('');
      summary.classList.remove('hidden');
    }

    head.innerHTML = `<tr>
      <th scope="col">日期</th>
      <th scope="col">口径</th>
      <th scope="col">来源</th>
      <th scope="col">币种</th>
      <th scope="col">花费</th>
      <th scope="col">曝光</th>
      <th scope="col">点击</th>
      <th scope="col">归因 GMV</th>
      <th scope="col">订单</th>
    </tr>`;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="empty">还没有广告数据。</td></tr>';
      return;
    }

    body.innerHTML = rows.map(row => `<tr>
      <td>${escapeHtml(formatDate(row.eventDate))}</td>
      <td><span class="tiktok-basis ${row.attributionBasis === 'paid_only' ? 'paid' : 'attributed'}">${escapeHtml(row.attributionLabel || row.attributionBasis || '')}</span></td>
      <td>${escapeHtml(row.sourceLabel || row.source || '')}</td>
      <td>${escapeHtml(row.currency || '')}</td>
      <td>${escapeHtml(formatMoney(row.spend, row.currency))}</td>
      <td>${escapeHtml(formatNumber(row.impressions))}</td>
      <td>${escapeHtml(formatNumber(row.clicks))}</td>
      <td>${escapeHtml(formatMoney(row.gmvOrderTotal, row.currency))}</td>
      <td>${escapeHtml(formatNumber(row.orders))}</td>
    </tr>`).join('');
  }

  /** 把一组行里某个字段求和；全缺失时返回 null（不是 0）。 */
  function sumField(rows, field) {
    let total = null;
    for (const row of rows) {
      const value = row[field];
      if (value === null || value === undefined || value === '') continue;
      total = (total || 0) + Number(value);
    }
    return total;
  }

  /** 取一组行里第一个非空币种。 */
  function firstCurrency(rows) {
    for (const row of rows) {
      if (row.currency && row.currency !== 'UNKNOWN') return row.currency;
    }
    return null;
  }

  /** 比率展示。任一端缺失就是「—」，不给一个假的 0。 */
  function formatRatio(numerator, denominator) {
    if (numerator === null || denominator === null || denominator === 0) return MISSING;
    return (numerator / denominator).toFixed(2);
  }


  /**
   * 渲染广告诊断。
   *
   * ★ 三个比值分属不同口径，页面必须把「怎么算出来的」一起显示 ——
   *   否则读者会把「跨报表的花费占比」当成「平台 ROI」，
   *   得出投放效率很高的错误结论。
   *
   * @param {object} diagnosis /tiktok/marketing/ads-diagnosis 的返回
   */
  function renderAdsDiagnosis(diagnosis) {
    const notice = document.querySelector('#tiktokAdsDiagnosisNotice');
    const signalsHost = document.querySelector('#tiktokAdsDiagnosisSignals');
    const calibersHost = document.querySelector('#tiktokAdsCalibers');
    const summaryHost = document.querySelector('#tiktokAdsDiagnosisSummary');
    if (!signalsHost) return;

    const metrics = (diagnosis && diagnosis.metrics) || {};
    const signals = (diagnosis && diagnosis.signals) || [];
    const calibers = (diagnosis && diagnosis.caliberNotes) || [];

    // 口径说明：三个比值各是什么来路。
    if (calibersHost) {
      if (calibers.length) {
        calibersHost.innerHTML = '<div class="tiktok-caliber-box">'
          + '<strong>这三个数分别怎么算出来的</strong>'
          + '<ul>' + calibers.map(note => `
            <li>
              <span class="tiktok-caliber-title">${escapeHtml(note.title)}</span>
              <span class="tiktok-caliber-formula">${escapeHtml(note.formula)}</span>
              <span class="tiktok-caliber-source">${escapeHtml(note.source)}</span>
              <span class="tiktok-caliber-note">${escapeHtml(note.note || '')}</span>
            </li>`).join('')
          + '</ul></div>';
        calibersHost.classList.remove('hidden');
      } else {
        calibersHost.innerHTML = '';
        calibersHost.classList.add('hidden');
      }
    }

    // 概览卡片：每个数都标出口径。
    if (summaryHost) {
      const cards = [
        { label: '平台归因 ROI', value: formatRatio(metrics.platformRoas), hint: '同源 · 平台面板那个数' },
        { label: '花费占 GMV', value: formatPercent(metrics.spendToAttributedGmv), hint: '跨报表 · 投放强度' },
        { label: '结算净 ROAS', value: formatRatio(metrics.settledNetRoas), hint: '结算口径 · 最可靠' },
        { label: '广告花费', value: formatMoney(metrics.attributedSpend), hint: 'GMV Max 口径' },
      ];
      summaryHost.innerHTML = cards.map(card => `
        <div class="kpi-card">
          <span class="kpi-label">${escapeHtml(card.label)}</span>
          <strong class="kpi-value">${escapeHtml(card.value)}</strong>
          <span class="kpi-hint">${escapeHtml(card.hint)}</span>
        </div>`).join('');
      summaryHost.classList.remove('hidden');
    }

    if (notice) {
      if (!signals.length) {
        notice.innerHTML = '<div class="tiktok-notice warn">'
          + '<strong>暂时没有可诊断的结论。</strong>'
          + '<span>这个区间内没有广告数据。先同步广告数据，再运行诊断。</span></div>';
        notice.classList.remove('hidden');
      } else {
        notice.innerHTML = '';
        notice.classList.add('hidden');
      }
    }

    signalsHost.innerHTML = signals.map(item => {
      const isFact = item.kind === 'data-fact';
      return `<article class="tiktok-signal ${isFact ? 'fact' : 'suggestion'} ${escapeHtml(item.severity || 'info')}">
        <header class="tiktok-signal-head">
          <span class="tiktok-signal-kind">${isFact ? '数据事实' : 'AI 推测建议'}</span>
          <h3>${escapeHtml(item.title || '')}</h3>
        </header>
        <p class="tiktok-signal-detail">${escapeHtml(item.detail || '')}</p>
        ${item.action ? `<p class="tiktok-signal-action"><span>落地动作</span>${escapeHtml(item.action)}</p>` : ''}
      </article>`;
    }).join('');
    signalsHost.classList.remove('hidden');
  }

  /**
   * 渲染店铺健康（SPS）。
   *
   * ★ 平台没给数据的指标必须显示为「—」并标为未知 ——
   *   不能用别的指标顶替，也不能自己算一个。
   *
   * @param {object} payload { overview, metrics, signals, status }
   */
  function renderHealth(payload) {
    const notice = document.querySelector('#tiktokHealthNotice');
    const signalsHost = document.querySelector('#tiktokHealthSignals');
    const head = document.querySelector('#tiktokHealthHead');
    const body = document.querySelector('#tiktokHealthBody');
    const summaryHost = document.querySelector('#tiktokHealthSummary');
    if (!head || !body) return;

    const overview = (payload && payload.overview) || {};
    const metrics = (payload && payload.metrics) || [];
    const signals = (payload && payload.signals) || [];
    const status = (payload && payload.status) || {};

    if (summaryHost) {
      const cards = [
        { label: '健康总分', value: overview.spsScore ?? '—', hint: overview.spsTierText || 'SPS' },
        { label: '同层级百分位', value: overview.peerPercentile || '—', hint: '同类店铺中的位置' },
        { label: '不达标指标', value: status.breachCount ?? 0, hint: `共 ${status.total ?? metrics.length} 项` },
        { label: '待改进问题', value: (overview.topIssues || []).length, hint: '平台指出、影响评分最大' },
      ];
      summaryHost.innerHTML = cards.map(card => `
        <div class="kpi-card">
          <span class="kpi-label">${escapeHtml(card.label)}</span>
          <strong class="kpi-value">${escapeHtml(String(card.value))}</strong>
          <span class="kpi-hint">${escapeHtml(card.hint)}</span>
        </div>`).join('');
      summaryHost.classList.remove('hidden');
    }

    head.innerHTML = `<tr>
      <th scope="col">指标</th>
      <th scope="col">当前值</th>
      <th scope="col">状态</th>
      <th scope="col">得分</th>
      <th scope="col">优秀线</th>
      <th scope="col">较差线</th>
      <th scope="col">平台说明</th>
    </tr>`;

    if (!metrics.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">还没有健康数据。点「读取健康」从 TikTok 拉取。</td></tr>';
    } else {
      body.innerHTML = metrics.map(metric => `<tr>
        <td>${escapeHtml(metric.metricName || '')}</td>
        <td>${escapeHtml(metric.displayValue || '—')}</td>
        <td><span class="tiktok-health-status ${escapeHtml(metric.level || 'unknown')}">${escapeHtml(metric.statusLabel || '未知')}</span></td>
        <td>${escapeHtml(metric.score ?? '—')}</td>
        <td>${escapeHtml(metric.excellentThreshold ?? '—')}</td>
        <td>${escapeHtml(metric.poorThreshold ?? '—')}</td>
        <td>${escapeHtml(metric.topReason || '')}</td>
      </tr>`).join('');
    }

    if (notice) {
      if (!signals.length && !metrics.length) {
        notice.innerHTML = '<div class="tiktok-notice warn">'
          + '<strong>还没有健康数据。</strong>'
          + '<span>需要该店铺已授权，且 TikTok 平台已算出 SPS。点「读取健康」获取。</span></div>';
        notice.classList.remove('hidden');
      } else {
        notice.innerHTML = '';
        notice.classList.add('hidden');
      }
    }

    if (signalsHost) {
      signalsHost.innerHTML = signals.map(item => {
        const isFact = item.kind === 'data-fact';
        return `<article class="tiktok-signal ${isFact ? 'fact' : 'suggestion'} ${escapeHtml(item.severity || 'info')}">
          <header class="tiktok-signal-head">
            <span class="tiktok-signal-kind">${isFact ? '数据事实' : 'AI 推测建议'}</span>
            <h3>${escapeHtml(item.title || '')}</h3>
          </header>
          <p class="tiktok-signal-detail">${escapeHtml(item.detail || '')}</p>
          ${item.action ? `<p class="tiktok-signal-action"><span>落地动作</span>${escapeHtml(item.action)}</p>` : ''}
        </article>`;
      }).join('');
      signalsHost.classList.remove('hidden');
    }
  }

  /**
   * 渲染达人概览。
   *
   * @param {object} payload { rows, summary }
   */
  function renderCreators(payload) {
    const head = document.querySelector('#tiktokCreatorsHead');
    const body = document.querySelector('#tiktokCreatorsBody');
    const summaryHost = document.querySelector('#tiktokCreatorsSummary');
    const notice = document.querySelector('#tiktokCreatorsNotice');
    if (!head || !body) return;

    const rows = (payload && payload.rows) || [];
    const summary = (payload && payload.summary) || {};

    if (summaryHost) {
      const cards = [
        { label: '合作达人数', value: summary.creatorCount ?? 0, hint: '区间内有数据的达人' },
        { label: '达人带来 GMV', value: formatNumber(summary.gmv), hint: '平台归因口径' },
        { label: '达人带来销量', value: formatNumber(summary.unitsSold), hint: '平台归因口径' },
        { label: '达人粉丝合计', value: formatNumber(summary.followerCount), hint: '仅供规模参考' },
      ];
      summaryHost.innerHTML = cards.map(card => `
        <div class="kpi-card">
          <span class="kpi-label">${escapeHtml(card.label)}</span>
          <strong class="kpi-value">${escapeHtml(String(card.value))}</strong>
          <span class="kpi-hint">${escapeHtml(card.hint)}</span>
        </div>`).join('');
      summaryHost.classList.remove('hidden');
    }

    head.innerHTML = `<tr>
      <th scope="col">达人</th>
      <th scope="col">粉丝数</th>
      <th scope="col">GMV</th>
      <th scope="col">销量</th>
      <th scope="col">GPM</th>
      <th scope="col">视频 GMV</th>
      <th scope="col">直播 GMV</th>
      <th scope="col">合作品牌数</th>
      <th scope="col">主要类目</th>
    </tr>`;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="empty">还没有达人数据。点「同步达人」从 TikTok 拉取。</td></tr>';
    } else {
      body.innerHTML = rows.map(row => {
        const categories = (row.categoryGmvDistribution || [])
          .slice(0, 2)
          .map(item => item.category_id)
          .filter(Boolean)
          .join('、');
        return `<tr>
          <td>${escapeHtml(row.nickname || row.username || row.creatorUserId || '')}</td>
          <td>${escapeHtml(formatNumber(row.followerCount))}</td>
          <td>${escapeHtml(formatMoney(row.gmv, row.currency))}</td>
          <td>${escapeHtml(formatNumber(row.unitsSold))}</td>
          <td>${escapeHtml(formatMoney(row.gpm, row.currency))}</td>
          <td>${escapeHtml(formatMoney(row.videoGmv, row.currency))}</td>
          <td>${escapeHtml(formatMoney(row.liveGmv, row.currency))}</td>
          <td>${escapeHtml(formatNumber(row.brandCollaborationCount))}</td>
          <td>${escapeHtml(categories || '—')}</td>
        </tr>`;
      }).join('');
    }

    if (notice) {
      if (!rows.length) {
        notice.innerHTML = '<div class="tiktok-notice">'
          + '<strong>达人数据是单独同步的。</strong>'
          + '<span>达人表现来自 TikTok 的达人联盟接口，与订单、广告是三套独立的数据源。'
          + '点「同步达人」拉取当前合作中的达人及其表现。</span></div>';
        notice.classList.remove('hidden');
      } else {
        notice.innerHTML = '';
        notice.classList.add('hidden');
      }
    }
  }

  window.TikTokUI = { render, renderDiagnosis, renderAds, renderAdsDiagnosis, renderHealth, renderCreators, exportCsv };
})();
