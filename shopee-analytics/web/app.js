'use strict';

const $ = selector => document.querySelector(selector);
const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const pct = value => Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : '—';
const roas = value => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';
const num = value => fmt.format(Number(value || 0));

const STATE_LABELS = Object.freeze({
  TARGET_MET: '目标达成',
  PROFITABLE_BUT_BELOW_TARGET: '盈利但低于目标',
  BELOW_BREAK_EVEN: '低于保本',
  ABOVE_BREAK_EVEN_BUT_OVER_SPEND_LIMIT: '盈利但广告占比超限',
  TARGET_UNKNOWN: '目标未设置',
  WITHIN_SPEND_LIMIT: '广告占比正常',
  OVER_SPEND_LIMIT: '广告占比超限',
  NO_ATTRIBUTED_GMV: '暂无归因GMV',
  VOLUME_REFERENCE_MET: '订单参考量达标',
  LOW_VOLUME_SIGNAL: '订单量不足',
  CORE_CANDIDATE: '主力候选',
  EXPLORATION_KEEP: '保留探索',
  INSUFFICIENT_EXPLORATION: '探索样本不足',
  HIGH_RISK_ZERO_ORDER: '高风险空烧',
  PRODUCT_OPTIMIZATION_CANDIDATE: '商品优化候选',
  ZERO_ORDER_STILL_TESTING: '零订单继续测试',
  NO_ORDER_NEEDS_AOV_CONTEXT: '零订单 / 缺少AOV',
  OBSERVE: '继续观察',
});

function stateLabel(state) {
  return STATE_LABELS[state] || state || '—';
}

function formatDateTime(value) {
  if (!value) return '从未';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '未知';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function freshnessClass(lastSyncedAt) {
  if (!lastSyncedAt) return 'missing';
  const hours = (Date.now() - new Date(lastSyncedAt).getTime()) / 3600000;
  if (!Number.isFinite(hours)) return 'missing';
  if (hours <= 6) return 'fresh';
  if (hours <= 30) return 'aging';
  return 'stale';
}

function freshnessLabel(lastSyncedAt) {
  const cls = freshnessClass(lastSyncedAt);
  return ({ fresh: '最新', aging: '待刷新', stale: '已过期', missing: '无数据' })[cls];
}

function money(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return num(n);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function stateClass(state) {
  if (/TARGET_MET|WITHIN_SPEND|CORE_CANDIDATE/.test(state || '')) return 'good';
  if (/BELOW_BREAK|OVER_SPEND|HIGH_RISK/.test(state || '')) return 'bad';
  if (/LOW_VOLUME|BELOW_TARGET|OPTIMIZATION|ZERO_ORDER/.test(state || '')) return 'warn';
  return 'neutral';
}

function itemStateClass(state) {
  if (state === 'CORE_CANDIDATE') return 'core';
  if (state === 'EXPLORATION_KEEP' || state === 'INSUFFICIENT_EXPLORATION') return 'explore';
  if (state === 'HIGH_RISK_ZERO_ORDER') return 'risk';
  if (state === 'PRODUCT_OPTIMIZATION_CANDIDATE' || state === 'ZERO_ORDER_STILL_TESTING') return 'optimize';
  return '';
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function initDates() {
  $('#endDate').value = dateDaysAgo(1);
  $('#startDate').value = dateDaysAgo(7);
  const remembered = localStorage.getItem('shopee-analytics-shop-id');
  if (remembered) $('#shopId').value = remembered;
}

async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}

async function checkHealth() {
  const badge = $('#healthBadge');
  try {
    await json('/api/shopee-analytics/health');
    badge.textContent = '只读分析服务正常';
    badge.className = 'health ok';
  } catch (error) {
    badge.textContent = '分析服务不可用';
    badge.className = 'health bad';
  }
}

function renderSystemStatus(data) {
  const panel = $('#systemStatus');
  const sources = data.sources || [];
  const tokens = data.tokens || [];
  const tokenByRole = new Map(tokens.map(token => [token.appRole, token]));
  const warnings = data.warnings || [];

  $('#statusSubtitle').textContent = data.ok
    ? '同步链路无严重错误；仍请关注单个数据源的新鲜度。'
    : '发现需要处理的数据连接问题，诊断结论可能不完整。';

  $('#sourceStatusGrid').innerHTML = sources.map(source => {
    const cls = freshnessClass(source.lastSyncedAt);
    return `<div class="source-card ${cls}">
      <div class="source-card-top">
        <strong>${escapeHtml(source.source)}</strong>
        <span class="source-state ${cls}">${freshnessLabel(source.lastSyncedAt)}</span>
      </div>
      <div class="source-date">最新数据：${escapeHtml(source.latestDataDate || '—')}</div>
      <div class="source-sync">同步：${escapeHtml(formatDateTime(source.lastSyncedAt))}</div>
    </div>`;
  }).join('');

  const requiredRoles = ['ADS', 'STORE_OPS', 'ERP', 'BRAND_PORTAL'];
  const tokenHtml = requiredRoles.map(role => {
    const token = tokenByRole.get(role);
    const expires = token && token.expiresAt ? new Date(token.expiresAt) : null;
    const remainingHours = expires && !Number.isNaN(expires.getTime())
      ? (expires.getTime() - Date.now()) / 3600000
      : null;
    let cls = 'fresh';
    let label = '正常';
    if (!token) { cls = 'missing'; label = '未配置'; }
    else if (token.refreshError) { cls = 'stale'; label = '刷新失败'; }
    else if (remainingHours !== null && remainingHours <= 0) { cls = 'aging'; label = '待自动刷新'; }
    return `<div class="source-card token-card ${cls}">
      <div class="source-card-top">
        <strong>${role} Token</strong>
        <span class="source-state ${cls}">${label}</span>
      </div>
      <div class="source-date">过期：${escapeHtml(token ? formatDateTime(token.expiresAt) : '—')}</div>
      <div class="source-sync">上次刷新：${escapeHtml(token ? formatDateTime(token.lastRefreshAt) : '—')}</div>
    </div>`;
  }).join('');
  $('#sourceStatusGrid').insertAdjacentHTML('beforeend', tokenHtml);

  const warningBox = $('#systemWarnings');
  if (warnings.length) {
    warningBox.innerHTML = warnings.map(warning => `
      <div class="warning-row ${warning.severity || 'warning'}">
        <span>${escapeHtml(warning.code)}</span>
        <strong>${escapeHtml(warning.message)}</strong>
      </div>`).join('');
    warningBox.classList.remove('hidden');
  } else {
    warningBox.innerHTML = '';
    warningBox.classList.add('hidden');
  }
  panel.classList.remove('hidden');
}

async function loadSystemStatus() {
  const shopId = $('#shopId').value.trim();
  if (!shopId) return;
  const button = $('#refreshStatusBtn');
  if (button) button.disabled = true;
  try {
    const data = await json(`/api/shopee-analytics/status?shop_id=${encodeURIComponent(shopId)}`);
    renderSystemStatus(data);
  } catch (error) {
    $('#systemStatus').classList.remove('hidden');
    $('#statusSubtitle').textContent = `数据状态读取失败：${error.message}`;
    $('#sourceStatusGrid').innerHTML = '';
  } finally {
    if (button) button.disabled = false;
  }
}

function renderSummary(campaigns) {
  const sum = campaigns.reduce((acc, row) => {
    const p = row.performance || {};
    acc.expense += Number(p.expense || 0);
    acc.gmv += Number(p.broadGmv || 0);
    acc.orders += Number(p.broadOrders || 0);
    acc.clicks += Number(p.clicks || 0);
    acc.impressions += Number(p.impressions || 0);
    return acc;
  }, { expense: 0, gmv: 0, orders: 0, clicks: 0, impressions: 0 });
  const ratio = sum.gmv ? sum.expense / sum.gmv : 0;
  const totalRoas = sum.expense ? sum.gmv / sum.expense : 0;

  $('#summary').innerHTML = [
    ['广告花费', money(sum.expense), ''],
    ['Broad GMV', money(sum.gmv), ''],
    ['Broad订单', num(sum.orders), ''],
    ['ROAS', roas(totalRoas), ''],
    ['广告花费占比', pct(ratio), ratio > .15 ? 'negative' : 'positive'],
  ].map(([label, value, cls]) =>
    `<div class="kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`
  ).join('');
  $('#summary').classList.remove('hidden');
}

function renderCampaigns(data) {
  const rows = data.campaigns || [];
  $('#campaignCount').textContent = rows.length;
  renderSummary(rows);

  if (!rows.length) {
    $('#campaignRows').innerHTML = '<tr><td colspan="6" class="empty">这个区间没有 Campaign 数据。</td></tr>';
    return;
  }

  $('#campaignRows').innerHTML = rows.map(row => {
    const p = row.performance || {};
    const spendRatio = p.broadGmv ? p.expense / p.broadGmv : 0;
    const status = row.status || row.campaignTypeRaw || 'unknown';
    return `<tr data-campaign="${row.campaignId}">
      <td><div class="campaign-name"><strong>#${row.campaignId}</strong><small>${escapeHtml(row.biddingMethod || row.adType || '')}</small></div></td>
      <td>${num(p.broadOrders)}</td>
      <td>${roas(p.broadRoas)}</td>
      <td class="${spendRatio > .15 ? 'negative' : ''}">${pct(spendRatio)}</td>
      <td>${row.targetRoas == null ? '—' : roas(row.targetRoas)}</td>
      <td><span class="pill neutral">${escapeHtml(status)}</span></td>
    </tr>`;
  }).join('');

  document.querySelectorAll('[data-campaign]').forEach(row => {
    row.addEventListener('click', () => loadAnalysis(Number(row.dataset.campaign)));
  });
}

function metric(label, value, sub = '', cls = '') {
  return `<div class="metric"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></div>`;
}

function miniMetrics(p) {
  return [
    `<div><strong>${num(p.broadOrders)}</strong><span>订单</span></div>`,
    `<div><strong>${roas(p.broadRoas)}</strong><span>ROAS</span></div>`,
    `<div><strong>${money(p.expense)}</strong><span>花费</span></div>`,
  ].join('');
}

function renderAnalysis(data) {
  const d = data.diagnosis;
  const c = d.campaign;
  $('#diagnosisTitle').textContent = `Campaign #${data.campaignId}`;
  $('#diagnosisSubtitle').textContent = `${data.startDate} → ${data.endDate} · ${c.days} 个数据日`;
  $('#diagnosisState').textContent = stateLabel(c.roasState);
  $('#diagnosisState').className = `pill ${stateClass(c.roasState)}`;

  const template = $('#diagnosisTemplate').content.cloneNode(true);
  $('#diagnosisBody').replaceChildren(template);

  $('#campaignMetrics').innerHTML = [
    metric('订单量', num(c.broadOrders), `周等效 ${Number(c.weeklyEquivalentOrders || 0).toFixed(1)} · ${stateLabel(c.volumeState)}`),
    metric('Broad ROAS', roas(c.broadRoas), `Target ${roas(c.targetRoas)}`, c.broadRoas >= c.targetRoas && c.targetRoas ? 'positive' : ''),
    metric('广告花费占比', pct(c.adCostRatio), `硬约束 ≤ ${pct(c.adSpendRatioLimit)} / 对应ROAS ≥ ${roas(c.spendLimitRoas)}`, c.spendLimitState === 'OVER_SPEND_LIMIT' ? 'negative' : 'positive'),
    metric('CTR', pct(c.ctr), `${num(c.clicks)} clicks / ${num(c.impressions)} impressions`),
    metric('Broad CVR', pct(c.broadCvr), '订单 / 点击'),
    metric('Direct ROAS', roas(c.directRoas), '用于观察广告商品自身'),
    metric('Direct订单', num(c.directOrders), `Broad订单 ${num(c.broadOrders)}`),
    metric('CPC', money(c.cpc), c.targetVsRecommended || ''),
    metric('预算利用率', c.budgetUtilization == null ? '—' : pct(c.budgetUtilization), c.dailyBudget ? `日预算 ${money(c.dailyBudget)} / 日均花费 ${money(c.avgDailySpend)}` : '未读取日预算'),
  ].join('');

  $('#actionList').innerHTML = (d.actions || []).length
    ? d.actions.map(action => `<div class="action-card">
        <div class="action-code">${escapeHtml(action.code)}</div>
        <strong>${escapeHtml(action.title)}</strong>
        <p>${escapeHtml(action.reason || '')}</p>
        <div class="action-do">${escapeHtml(action.action || '')}</div>
      </div>`).join('')
    : '<div class="empty-inline">当前没有结构性动作，继续观察完整周期。</div>';

  $('#ordinaryMetrics').innerHTML = miniMetrics(data.baseline.ordinary || {});
  $('#eventMetrics').innerHTML = miniMetrics(data.baseline.event || {});

  const items = d.items || [];
  $('#itemRows').innerHTML = items.length ? items.map(item => {
    const rec = item.recommendedRoi && item.recommendedRoi.exact
      ? roas(item.recommendedRoi.exact.value)
      : '—';
    return `<tr data-item="${item.itemId}">
      <td><div class="item-name"><strong>${escapeHtml(item.itemSku || ('#' + item.itemId))}</strong><small>${escapeHtml(item.itemName || '')}</small></div></td>
      <td title="${escapeHtml(item.action && item.action.action || '')}"><span class="state ${itemStateClass(item.state)}">${escapeHtml(stateLabel(item.state))}</span></td>
      <td>${num(item.directOrders)}</td>
      <td>${roas(item.directRoas)}</td>
      <td>${roas(item.broadRoas)}</td>
      <td>${pct(item.spendShare)}</td>
      <td>${pct(item.directGmvShare)}</td>
      <td>${pct(item.ctr)}</td>
      <td>${pct(item.directCvr)}</td>
      <td>${item.productCard ? pct(item.productCard.conversionRate) : '—'}</td>
      <td>${item.productCard ? pct(item.productCard.addToCartRate) : '—'}</td>
      <td>${rec}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="12" class="empty">没有商品层数据。</td></tr>';

  const quality = data.dataQuality || {};
  const qualityWarnings = quality.warnings || [];
  const spendCoverageText = quality.spendCoverage == null ? '—' : pct(quality.spendCoverage);
  const itemCoverageText = quality.itemCoverage == null ? '—' : pct(quality.itemCoverage);
  $('#dataQualityBox').innerHTML = `
    <div class="quality-summary">
      <div><span>商品层花费覆盖</span><strong>${spendCoverageText}</strong></div>
      <div><span>成员 Performance 覆盖</span><strong>${itemCoverageText}</strong></div>
      <div><span>广告组成员</span><strong>${num(quality.membershipCount)}</strong></div>
      <div><span>有表现商品</span><strong>${num(quality.performanceItemCount)}</strong></div>
    </div>
    ${qualityWarnings.length ? `<div class="quality-warnings">${qualityWarnings.map(warning =>
      `<div>⚠ ${escapeHtml(warning.message)}</div>`).join('')}</div>` : '<div class="quality-ok">数据覆盖未发现明显异常。</div>'}
  `;

  $('#diagnosisNotes').innerHTML = (d.notes || []).map(note => `<div>• ${escapeHtml(note)}</div>`).join('');

  document.querySelectorAll('[data-item]').forEach(row => {
    row.addEventListener('click', event => {
      event.stopPropagation();
      loadItemTimeline(Number(row.dataset.item), row);
    });
  });
}

function timelineDetail(event) {
  const d = event.detail || {};
  if (event.type === 'VOUCHER_START') {
    return [
      d.percentage == null ? null : `折扣 ${(Number(d.percentage) <= 1 ? Number(d.percentage) * 100 : Number(d.percentage)).toFixed(1)}%`,
      d.discountAmount == null ? null : `固定减免 ${money(d.discountAmount)}`,
      d.minBasketPrice == null ? null : `门槛 ${money(d.minBasketPrice)}`,
    ].filter(Boolean).join(' · ');
  }
  if (event.type === 'DISCOUNT_START') {
    return [
      d.originalPrice == null ? null : `原价 ${money(d.originalPrice)}`,
      d.promotionPrice == null ? null : `活动价 ${money(d.promotionPrice)}`,
      d.modelId ? `Model #${d.modelId}` : null,
    ].filter(Boolean).join(' · ');
  }
  if (event.type === 'RETURN') {
    return [
      d.status || null,
      d.quantity == null ? null : `${d.quantity} 件`,
      d.refundAmount == null ? null : `退款 ${money(d.refundAmount)} ${d.currency || ''}`,
    ].filter(Boolean).join(' · ');
  }
  if (event.type === 'RECOMMENDED_ROAS') {
    return `预估范围 ${roas(d.lower)} / ${roas(d.exact)} / ${roas(d.upper)}`;
  }
  return d.after ? JSON.stringify(d.after) : '';
}

async function loadItemTimeline(itemId, rowEl) {
  document.querySelectorAll('[data-item]').forEach(row => row.classList.toggle('selected', row === rowEl));
  $('#timelineTitle').textContent = `SKU 时间线 · #${itemId}`;
  $('#timeline').innerHTML = '<div class="empty-inline">读取中…</div>';
  try {
    const params = new URLSearchParams({
      shop_id: $('#shopId').value.trim(),
      start_date: $('#startDate').value,
      end_date: $('#endDate').value,
    });
    const data = await json(`/api/shopee-analytics/items/${itemId}/timeline?${params}`);
    const events = data.events || [];
    $('#timeline').innerHTML = events.length ? events.map(event => `
      <div class="timeline-event">
        <div class="timeline-dot"></div>
        <div class="timeline-main">
          <div class="timeline-meta"><span>${escapeHtml(String(event.at).slice(0, 16).replace('T', ' '))}</span><b>${escapeHtml(event.type)}</b></div>
          <strong>${escapeHtml(event.title || event.type)}</strong>
          <p>${escapeHtml(timelineDetail(event))}</p>
        </div>
      </div>`).join('') : '<div class="empty-inline">这个周期没有已记录的运营事件。</div>';
  } catch (error) {
    $('#timeline').innerHTML = `<div class="empty-inline">${escapeHtml(error.message)}</div>`;
  }
}

async function loadAnalysis(campaignId) {
  document.querySelectorAll('[data-campaign]').forEach(row => {
    row.classList.toggle('selected', Number(row.dataset.campaign) === campaignId);
  });
  $('#diagnosisState').textContent = '读取中';
  $('#diagnosisState').className = 'pill neutral';

  try {
    const params = new URLSearchParams({
      shop_id: $('#shopId').value.trim(),
      start_date: $('#startDate').value,
      end_date: $('#endDate').value,
    });
    const data = await json(`/api/shopee-analytics/campaigns/${campaignId}/analysis?${params}`);
    renderAnalysis(data);
  } catch (error) {
    $('#diagnosisBody').innerHTML = `<div class="empty-state"><strong>读取失败</strong><span>${escapeHtml(error.message)}</span></div>`;
    $('#diagnosisState').textContent = '错误';
    $('#diagnosisState').className = 'pill bad';
  }
}

async function loadCampaigns() {
  const button = $('#loadBtn');
  const shopId = $('#shopId').value.trim();
  const startDate = $('#startDate').value;
  const endDate = $('#endDate').value;
  if (!shopId || !startDate || !endDate) return;

  localStorage.setItem('shopee-analytics-shop-id', shopId);
  button.disabled = true;
  button.textContent = '读取中…';
  try {
    const params = new URLSearchParams({ shop_id: shopId, start_date: startDate, end_date: endDate });
    const data = await json(`/api/shopee-analytics/campaigns?${params}`);
    renderCampaigns(data);
    loadSystemStatus();
  } catch (error) {
    $('#campaignRows').innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
  } finally {
    button.disabled = false;
    button.textContent = '读取分析';
  }
}

initDates();
checkHealth();
$('#loadBtn').addEventListener('click', loadCampaigns);
$('#refreshStatusBtn').addEventListener('click', loadSystemStatus);
if ($('#shopId').value.trim()) loadSystemStatus();
