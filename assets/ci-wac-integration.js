(function (global) {
  'use strict';

  if (!global || typeof document === 'undefined' || global.__ciWacIntegrationInstalled) return;
  global.__ciWacIntegrationInstalled = true;

  function esc(value) {
    return typeof global.esc === 'function'
      ? global.esc(value)
      : String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function tr(key, fallback) {
    return typeof global.t === 'function' ? global.t(key, fallback) : fallback;
  }
  function date(value) {
    return value ? (typeof global.fmtDate === 'function' ? global.fmtDate(value) : value) : '—';
  }
  function money(value, currency) {
    return typeof global.fmtMoney === 'function'
      ? global.fmtMoney(value, currency)
      : ((currency ? currency + ' ' : '') + Number(value || 0).toFixed(2));
  }
  function field(label, value) {
    return '<div class="detail-item"><span class="detail-label">' + esc(label) +
      '</span><span class="detail-value">' + esc(value == null || value === '' ? '—' : value) + '</span></div>';
  }
  function country(value) {
    return typeof global.countryLabel === 'function' ? global.countryLabel(value) : (value || '—');
  }
  function logisticsStatus(value) {
    return typeof global.logisticsStatusLabelByKey === 'function'
      ? global.logisticsStatusLabelByKey(value)
      : (value || '—');
  }

  function renderLogisticsDetail(log, plData) {
    var mode = tr('logistics.mode.' + (log.transport_mode || ''), log.transport_mode || '—');
    var clearance = log.clearance_type === 'formal'
      ? tr('ci.clearance.formal', '正清')
      : log.clearance_type === 'non_formal'
        ? tr('ci.clearance.non_formal', '非正清')
        : tr('ci.clearance.unset', '未设置');
    var fields = [
      field(tr('logistics.detail.batch_no', '物流单号'), log.batch_no),
      field(tr('logistics.detail.pl_no', 'PL单号'), log.pl_no),
      field(tr('logistics.detail.related_ci', '关联CI'), log.related_ci_no),
      field(tr('logistics.detail.brand', '品牌'), log.brand),
      field(tr('logistics.detail.forwarder', '货代'), log.forwarder_name),
      field(tr('logistics.detail.transport_mode', '运输方式'), mode),
      field(tr('logistics.detail.target_country', '目标国家'), country(log.target_country)),
      field(tr('logistics.detail.target_warehouse', '目标仓库'), log.target_warehouse),
      field('清关方式', clearance),
      field(tr('logistics.detail.pickup_date', '提货日期'), date(log.pickup_date)),
      field(tr('logistics.detail.depart_date', '出发日期'), date(log.depart_date)),
      field(tr('logistics.detail.eta', '预计到港'), date(log.eta_date)),
      field(tr('logistics.detail.arrival_date', '到货日期'), date(log.actual_arrival_date)),
      field(tr('logistics.detail.logistics_status', '物流状态'), logisticsStatus(log.logistics_display_status)),
      field(tr('logistics.detail.batch_total_quantity', '批次总数量'), log.batch_total_quantity == null ? '—' : Number(log.batch_total_quantity).toLocaleString() + ' PCS'),
      field(tr('logistics.detail.cartons', '箱数'), log.total_cartons == null ? '—' : log.total_cartons),
      field(tr('logistics.detail.total_cbm', '总体积'), Number(log.total_cbm || 0).toFixed(3) + ' CBM'),
      field(tr('logistics.detail.actual_transit_days', '实际运输时效'), log.actual_transit_days == null ? '—' : log.actual_transit_days + ' 天')
    ].join('');

    var items = plData && Array.isArray(plData.items) ? plData.items : [];
    var plRows = items.length
      ? items.map(function (item) {
          return '<tr><td class="cell-id">' + esc(item.sku_code) + '</td>' +
            '<td>' + Number(item.cartons || 0).toLocaleString() + '</td>' +
            '<td>' + Number(item.total_qty || 0).toLocaleString() + '</td>' +
            '<td>' + Number(item.gross_weight || 0).toFixed(3) + '</td>' +
            '<td>' + Number(item.net_weight || 0).toFixed(3) + '</td>' +
            '<td>' + Number(item.cbm || 0).toFixed(3) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="6" style="color:var(--text-secondary);text-align:center;padding:16px">' +
          esc(tr('logistics.detail.no_pl_items', '无PL明细')) + '</td></tr>';

    var feeFields = [
      field(tr('logistics.detail.freight_currency', '运费币种'), log.freight_currency),
      field(tr('logistics.detail.freight', '国际运费'), money(log.international_freight, log.freight_currency)),
      field(tr('logistics.detail.local_charges', '本地费用'), money(log.local_charges, log.freight_currency)),
      field(tr('logistics.detail.customs_service_fee', '报关服务费'), money(log.customs_service_fee, log.freight_currency)),
      field(tr('logistics.detail.delivery_fee', '派送费'), money(log.delivery_fee, log.freight_currency)),
      field(tr('logistics.detail.total_freight', '综合运费'), money(log.total_freight, log.freight_currency)),
      field(tr('logistics.detail.customs_duty', '关税'), money(log.customs_duty, log.freight_currency)),
      field(tr('logistics.detail.other_fees', '其他费用'), money(log.other_fees, log.freight_currency))
    ].join('');

    return '<div class="detail-section ci-wac-logistics-section">' +
      '<h3>物流批次详情</h3><div class="detail-grid">' + fields + '</div></div>' +
      '<div class="detail-section ci-wac-logistics-section"><h3>PL装箱明细</h3>' +
      '<div class="table-container" style="box-shadow:none;border-radius:0;overflow:auto">' +
      '<table class="data-table" style="font-size:12px;min-width:620px"><thead><tr>' +
      '<th>SKU</th><th>CTN数量</th><th>总数量</th><th>总毛重(KG)</th><th>总净重(KG)</th><th>总体积(CBM)</th>' +
      '</tr></thead><tbody>' + plRows + '</tbody></table></div></div>' +
      '<div class="detail-section ci-wac-logistics-section"><h3>物流费用概览</h3>' +
      '<div class="detail-grid">' + feeFields + '</div></div>';
  }

  function openExcludedDetail(log, plData, reason) {
    var body = '<div class="form-card" style="box-shadow:none;padding:0">' +
      renderLogisticsDetail(log, plData) +
      '<div class="detail-section"><h3>WAC处理状态</h3>' +
      '<div style="padding:12px 14px;border:1px solid var(--border);border-radius:9px;background:var(--bg-secondary)">' +
      '<strong>无需计算</strong><div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">' +
      esc(reason || '该物流批次已标记为无需计算') + '</div></div></div></div>';
    global.openModal('物流批次详情 / WAC - ' + (log.batch_no || ''), body,
      '<button class="btn btn-secondary" onclick="closeModal()">' + esc(tr('common.close', '关闭')) + '</button>',
      'modal-wac');
  }

  function openNotReadyDetail(log, plData) {
    var body = '<div class="form-card" style="box-shadow:none;padding:0">' +
      renderLogisticsDetail(log, plData) +
      '<div class="detail-section"><h3>WAC处理状态</h3>' +
      '<div style="padding:12px 14px;border:1px solid #f5d6d3;border-radius:9px;background:#fff8f7">' +
      '<strong>暂不可计算</strong><div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">' +
      '该物流批次尚未进入 WAC 待确认阶段。请检查物流状态是否已到仓，以及 PL 是否存在有效商品数量；满足条件后系统会将状态更新为待确认 WAC。' +
      '</div></div></div></div>';
    global.openModal('物流批次详情 / WAC - ' + (log.batch_no || ''), body,
      '<button class="btn btn-secondary" onclick="closeModal()">' + esc(tr('common.close', '关闭')) + '</button>',
      'modal-wac');
  }

  async function viewLogWacDetail(batchId, ciId, wacStatus, exclusionReason) {
    var id = String(batchId || '');
    if (!id) return;
    var seq = (global.__ciWacDetailSeq || 0) + 1;
    global.__ciWacDetailSeq = seq;
    try {
      var log = await global.api('/api/logistics-batches/' + encodeURIComponent(id));
      var plData = log.pl_id
        ? await global.api('/api/packing-lists/' + encodeURIComponent(log.pl_id))
        : null;
      if (seq !== global.__ciWacDetailSeq) return;

      global.__ciWacActiveCiId = ciId || log.related_ci_id || '';
      if (wacStatus === 'excluded') {
        openExcludedDetail(log, plData, exclusionReason);
        return;
      }
      if (wacStatus === 'not_ready' || !wacStatus) {
        openNotReadyDetail(log, plData);
        return;
      }

      await global.wacConfirm(id);
      if (seq !== global.__ciWacDetailSeq) return;

      var modal = document.getElementById('modal-content');
      var body = modal && modal.querySelector('.modal-body');
      var card = body && body.querySelector('.form-card');
      if (modal && modal.classList.contains('modal-wac') && card) {
        if (!card.querySelector('.ci-wac-logistics-section')) {
          card.insertAdjacentHTML('afterbegin', renderLogisticsDetail(log, plData));
        }
        var title = modal.querySelector('.modal-title');
        if (title) title.textContent = '物流批次详情 / WAC成本详情 - ' + (log.batch_no || id);
      } else {
        global.openModal('物流批次详情 - ' + (log.batch_no || id),
          '<div class="form-card" style="box-shadow:none;padding:0">' + renderLogisticsDetail(log, plData) +
          '<div class="detail-section"><h3>WAC预览</h3><div style="color:var(--text-secondary);font-size:12px">当前批次暂时无法加载WAC计算详情，请检查物流批次、PL明细及WAC阻断原因后重试。</div></div></div>',
          '<button class="btn btn-secondary" onclick="closeModal()">' + esc(tr('common.close', '关闭')) + '</button>',
          'modal-wac');
      }
    } catch (error) {
      if (seq === global.__ciWacDetailSeq && typeof global.showToast === 'function') {
        global.showToast(error && error.message || '物流批次详情加载失败', 'danger');
      }
    }
  }

  var excludeContext = null;
  function openCIWacExclude(batchId, ciId, batchNo) {
    excludeContext = { batchId: String(batchId || ''), ciId: String(ciId || ''), batchNo: String(batchNo || '') };
    var body = '<div style="font-size:13px;margin-bottom:10px">确定将物流批次 <strong>' + esc(excludeContext.batchNo || excludeContext.batchId) +
      '</strong> 标记为无需计算吗？</div>' +
      '<label for="ci-wac-exclusion-reason" style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary)">处理原因（必填）</label>' +
      '<textarea id="ci-wac-exclusion-reason" rows="3" style="width:100%;box-sizing:border-box;border:1px solid var(--border-color);border-radius:8px;padding:9px 10px;resize:vertical">历史批次已人工核算，无需再次计算</textarea>' +
      '<div style="margin-top:9px;font-size:12px;color:var(--text-secondary)">不会删除物流批次、CI、PL、付款记录，也不会修改库存数量、当前WAC或WAC历史。</div>';
    global.openModal('标记无需计算 - ' + (excludeContext.batchNo || excludeContext.batchId), body,
      '<button class="btn btn-secondary" onclick="closeModal()">取消</button>' +
      '<button class="btn btn-primary" id="ci-wac-exclusion-submit" onclick="submitCIWacExclude()">确认标记无需计算</button>',
      'modal-wac');
  }

  async function submitCIWacExclude() {
    if (!excludeContext || !excludeContext.batchId) return;
    var reason = String((document.getElementById('ci-wac-exclusion-reason') || {}).value || '').trim();
    if (!reason) {
      global.showToast('请填写无需计算的原因', 'warning');
      return;
    }
    var button = document.getElementById('ci-wac-exclusion-submit');
    if (button) { button.disabled = true; button.textContent = '处理中…'; }
    try {
      await global.api('/api/wac/batches/exclude', 'POST', {
        batch_ids: [excludeContext.batchId],
        reason: reason
      });
      var ciId = excludeContext.ciId;
      global.closeModal();
      global.showToast('已标记为无需计算', 'success');
      excludeContext = null;
      if (ciId && typeof global.refreshCIListLogistics === 'function') {
        await global.refreshCIListLogistics(ciId);
      }
    } catch (error) {
      global.showToast(error && error.message || '标记无需计算失败', 'danger');
      if (button) { button.disabled = false; button.textContent = '确认标记无需计算'; }
    }
  }

  var restoreContext = null;
  function openCIWacRestore(batchId, ciId, batchNo) {
    restoreContext = { batchId: String(batchId || ''), ciId: String(ciId || ''), batchNo: String(batchNo || '') };
    var body = '<div style="font-size:13px">确定恢复物流批次 <strong>' + esc(restoreContext.batchNo || restoreContext.batchId) +
      '</strong> 的WAC待确认任务吗？恢复后需要重新导入原库存并手动确认，不会自动计算。</div>';
    global.openModal('恢复WAC待确认任务', body,
      '<button class="btn btn-secondary" onclick="closeModal()">取消</button>' +
      '<button class="btn btn-primary" id="ci-wac-restore-submit" onclick="submitCIWacRestore()">确认恢复</button>',
      'modal-wac');
  }

  async function submitCIWacRestore() {
    if (!restoreContext || !restoreContext.batchId) return;
    var button = document.getElementById('ci-wac-restore-submit');
    if (button) { button.disabled = true; button.textContent = '恢复中…'; }
    try {
      await global.api('/api/wac/batches/' + encodeURIComponent(restoreContext.batchId) + '/restore-exclusion', 'POST', {});
      var ciId = restoreContext.ciId;
      global.closeModal();
      global.showToast('批次已恢复到WAC待确认列表', 'success');
      restoreContext = null;
      if (ciId && typeof global.refreshCIListLogistics === 'function') {
        await global.refreshCIListLogistics(ciId);
      }
    } catch (error) {
      global.showToast(error && error.message || '恢复失败，请刷新后重试', 'danger');
      if (button) { button.disabled = false; button.textContent = '确认恢复'; }
    }
  }

  function openWacCcFromCI(batchId, ciId, batchNo) {
    global.__ciWacActiveCiId = ciId || '';
    var rows = Array.isArray(global._wacBatchRows) ? global._wacBatchRows.slice() : [];
    rows = rows.filter(function (row) { return String(row.id) !== String(batchId); });
    rows.push({ id: String(batchId), batch_no: String(batchNo || batchId), wac_status: 'confirmed' });
    global._wacBatchRows = rows;
    if (typeof global.openWacCcModal === 'function') global.openWacCcModal(batchId);
    else global.showToast('当前版本未加载WAC CC功能，请刷新页面后重试', 'warning');
  }

  // Replace the legacy empty-history hint: the standalone WAC queue is retired; CC now starts from CI.
  var originalRenderWacNotificationHistory = global.renderWacNotificationHistory;
  if (typeof originalRenderWacNotificationHistory === 'function' && !originalRenderWacNotificationHistory.__ciWacWrapped) {
    var wrappedRenderWacNotificationHistory = function () {
      return originalRenderWacNotificationHistory.apply(this, arguments)
        .replace('可以在WAC物流批次列表点击 CC 补充发送。', '可以在CI列表对应物流批次行点击 CC 补充发送。');
    };
    wrappedRenderWacNotificationHistory.__ciWacWrapped = true;
    wrappedRenderWacNotificationHistory.__original = originalRenderWacNotificationHistory;
    global.renderWacNotificationHistory = wrappedRenderWacNotificationHistory;
  }

  var originalSubmitWacConfirm = global.submitWacConfirm;
  if (typeof originalSubmitWacConfirm === 'function' && !originalSubmitWacConfirm.__ciWacWrapped) {
    var wrappedSubmitWacConfirm = async function (batchId) {
      var ciId = global.__ciWacActiveCiId || '';
      var wasOpen = !!(document.getElementById('modal-overlay') &&
        document.getElementById('modal-overlay').classList.contains('show'));
      var result;
      try {
        result = await originalSubmitWacConfirm.apply(this, arguments);
      } finally {
        var isOpen = !!(document.getElementById('modal-overlay') &&
          document.getElementById('modal-overlay').classList.contains('show'));
        if (ciId && wasOpen && !isOpen && typeof global.refreshCIListLogistics === 'function') {
          await global.refreshCIListLogistics(ciId);
          global.__ciWacActiveCiId = '';
        }
      }
      return result;
    };
    wrappedSubmitWacConfirm.__ciWacWrapped = true;
    wrappedSubmitWacConfirm.__original = originalSubmitWacConfirm;
    global.submitWacConfirm = wrappedSubmitWacConfirm;
  }

  function hideLegacyWacPage() {
    var item = document.querySelector('.sidebar-item[data-page="inbound"]');
    if (item) item.remove();
  }
  var originalRenderSidebar = global.renderSidebar;
  if (typeof originalRenderSidebar === 'function' && !originalRenderSidebar.__ciWacWrapped) {
    var wrappedRenderSidebar = function () {
      var result = originalRenderSidebar.apply(this, arguments);
      hideLegacyWacPage();
      return result;
    };
    wrappedRenderSidebar.__ciWacWrapped = true;
    wrappedRenderSidebar.__original = originalRenderSidebar;
    global.renderSidebar = wrappedRenderSidebar;
  }
  var originalShowPage = global.showPage;
  if (typeof originalShowPage === 'function' && !originalShowPage.__ciWacWrapped) {
    var wrappedShowPage = function (page) {
      if (page === 'inbound') return originalShowPage.call(this, 'ci');
      return originalShowPage.apply(this, arguments);
    };
    wrappedShowPage.__ciWacWrapped = true;
    wrappedShowPage.__original = originalShowPage;
    global.showPage = wrappedShowPage;
  }

  var style = document.getElementById('ci-wac-integration-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'ci-wac-integration-style';
    style.textContent = '.sidebar-item[data-page="inbound"]{display:none!important}' +
      '.ci-wac-logistics-section{margin-bottom:14px}' +
      '.ci-wac-logistics-section .detail-grid{gap:10px 16px}';
    document.head.appendChild(style);
  }
  hideLegacyWacPage();

  global.viewLogWacDetail = viewLogWacDetail;
  global.openCIWacExclude = openCIWacExclude;
  global.submitCIWacExclude = submitCIWacExclude;
  global.openCIWacRestore = openCIWacRestore;
  global.submitCIWacRestore = submitCIWacRestore;
  global.openWacCcFromCI = openWacCcFromCI;
})(typeof window !== 'undefined' ? window : globalThis);
