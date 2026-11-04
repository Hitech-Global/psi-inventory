(function () {
  'use strict';
  if (window.__WAC_MAC_CC_UI__) return;
  window.__WAC_MAC_CC_UI__ = true;

  function html(value) {
    return typeof window.esc === 'function'
      ? window.esc(value == null ? '' : String(value))
      : String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
          return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);
        });
  }
  function injectStyles() {
    if (document.getElementById('wac-mac-cc-styles')) return;
    var style = document.createElement('style');
    style.id = 'wac-mac-cc-styles';
    style.textContent = [
      '.modal.wac-cc-macos{width:min(760px,calc(100vw - 32px));max-width:760px;max-height:min(88vh,860px);max-height:min(88dvh,860px);border:1px solid rgba(120,130,145,.28);border-radius:13px;overflow:hidden;background:var(--card-bg,#fff);box-shadow:0 24px 70px rgba(0,0,0,.24)}',
      '.modal.wac-cc-macos .modal-header{position:relative;justify-content:center;min-height:44px;padding:10px 54px;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(242,244,247,.96));border-bottom:1px solid rgba(120,130,145,.22)}',
      '.modal.wac-cc-macos .modal-header:before{content:"";position:absolute;left:16px;top:50%;transform:translateY(-50%);width:42px;height:12px;background:radial-gradient(circle at 6px 6px,#ff5f57 0 5px,transparent 5.5px),radial-gradient(circle at 21px 6px,#febc2e 0 5px,transparent 5.5px),radial-gradient(circle at 36px 6px,#28c840 0 5px,transparent 5.5px)}',
      '.modal.wac-cc-macos .modal-title{font-size:13px;font-weight:650;text-align:center;color:var(--text,#202124)}',
      '.modal.wac-cc-macos .modal-close{position:absolute;right:12px;top:7px;font-size:21px}',
      '.modal.wac-cc-macos .modal-body{padding:16px 18px;overflow:auto;max-height:calc(88vh - 112px);max-height:calc(88dvh - 112px)}',
      '.modal.wac-cc-macos .modal-footer{padding:12px 18px;background:var(--bg-secondary,#f6f7f9);border-top:1px solid rgba(120,130,145,.18)}',
      '.wac-mac-cc-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 12px;margin-bottom:14px;border:1px solid var(--border,rgba(120,130,145,.2));border-radius:9px;background:var(--bg-secondary,#f6f7f9);font-size:12px}',
      '.wac-mac-cc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
      '.wac-mac-cc-panel{min-width:0;border:1px solid var(--border,rgba(120,130,145,.22));border-radius:10px;background:var(--bg-card,var(--card-bg,#fff));padding:12px}',
      '.wac-mac-cc-panel h3{margin:0 0 5px;font-size:13px;font-weight:650;color:var(--text,#202124)}',
      '.wac-mac-cc-hint{margin:0 0 10px;font-size:11px;line-height:1.5;color:var(--text-secondary,#7b8490)}',
      '.wac-mac-cc-options{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto}',
      '.wac-mac-cc-option{display:flex;align-items:center;gap:9px;min-width:0;padding:8px 9px;border:1px solid transparent;border-radius:8px;background:transparent;cursor:pointer;transition:background .12s,border-color .12s}',
      '.wac-mac-cc-option:hover{background:var(--bg-secondary,#f5f6f8);border-color:var(--border,rgba(120,130,145,.2))}',
      '.wac-mac-cc-option input{flex:0 0 auto;width:15px;height:15px;margin:0;accent-color:#0a84ff}',
      '.wac-mac-cc-option-name{min-width:0;flex:1 1 auto;font-size:13px;color:var(--text,#202124);overflow-wrap:anywhere}',
      '.wac-mac-cc-option.is-disabled{opacity:.48;cursor:not-allowed}',
      '.wac-mac-cc-option.is-disabled:hover{background:transparent;border-color:transparent}',
      '.wac-mac-cc-tag{flex:0 0 auto;padding:2px 7px;border-radius:999px;background:rgba(120,130,145,.12);color:var(--text-secondary,#68717d);font-size:10px;line-height:1.5}',
      '.wac-mac-cc-tag.en{background:rgba(10,132,255,.10);color:#1677d2}',
      '.wac-mac-cc-state{display:block;margin-top:2px;font-size:10px;color:var(--text-secondary,#8a929c)}',
      '.wac-mac-cc-history{margin-top:14px;padding-top:12px;border-top:1px solid var(--border,rgba(120,130,145,.2))}',
      '.wac-mac-cc-history h3{margin:0 0 8px;font-size:13px}',
      '.wac-mac-cc-history .data-table{font-size:11px}',
      '.wac-mac-cc-empty{padding:8px 2px;font-size:12px;color:var(--text-secondary,#858d98)}',
      '#wac-cc-section .wac-mac-cc-inline{margin-top:12px;padding:12px;border:1px solid var(--border,rgba(120,130,145,.22));border-radius:10px;background:var(--bg-card,var(--card-bg,#fff))}',
      '#wac-cc-section .cc-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));gap:6px;max-height:180px;overflow:auto;border:1px solid var(--border,rgba(120,130,145,.22));border-radius:10px;padding:8px;background:var(--bg-card,var(--card-bg,#fff))}',
      '#wac-cc-section .cc-check{display:flex;align-items:center;gap:9px;margin:0;padding:8px 10px;border:1px solid var(--border,rgba(120,130,145,.18));border-radius:8px;background:var(--bg-secondary,rgba(120,130,145,.05));cursor:pointer}',
      '#wac-cc-section .cc-check input{width:15px;height:15px;margin:0;accent-color:#0a84ff}',
      '#wac-cc-section .wac-mac-cc-inline .wac-mac-cc-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));max-height:180px}',
      '#wac-cc-section .wac-mac-cc-inline .wac-mac-cc-option{border:1px solid var(--border,rgba(120,130,145,.18));background:var(--bg-secondary,rgba(120,130,145,.05))}',
      '@media(max-width:640px){.wac-mac-cc-grid{grid-template-columns:1fr}.modal.wac-cc-macos{width:calc(100vw - 20px)}.modal.wac-cc-macos .modal-body{padding:12px}}'
    ].join('\n');
    document.head.appendChild(style);
  }
  function groupOptionsHtml(groups, checkboxClass) {
    var list = Array.isArray(groups) ? groups : [];
    if (!list.length) return '<div class="wac-mac-cc-empty">暂无群组配置</div>';
    return list.map(function (g) {
      var configured = !!g.configured;
      var remaining = Number(g.remaining_count == null ? g.chat_count : g.remaining_count) || 0;
      var disabled = !configured || remaining <= 0;
      var status = !configured ? '尚未配置群聊 ID' : (remaining <= 0 ? '本批次已发送' : ('已配置 ' + remaining + ' 个群'));
      var lang = g.language === 'en';
      return '<label class="wac-mac-cc-option' + (disabled ? ' is-disabled' : '') + '">' +
        '<input type="checkbox" class="' + checkboxClass + '" value="' + html(g.key) + '"' + (disabled ? ' disabled' : '') + '>' +
        '<span class="wac-mac-cc-option-name">' + html(g.label || g.name || g.key) + '<small class="wac-mac-cc-state">' + status + '</small></span>' +
        '<span class="wac-mac-cc-tag' + (lang ? ' en' : '') + '">' + (lang ? 'English' : '中文') + '</span>' +
      '</label>';
    }).join('');
  }
  function userOptionsHtml(users, existingIds, checkboxClass) {
    var existing = existingIds || new Set();
    var available = (Array.isArray(users) ? users : []).filter(function (u) {
      return u && u.status === 'active' && !existing.has(String(u.id));
    });
    if (!available.length) return '<div class="wac-mac-cc-empty">没有新的可抄送人员</div>';
    return available.map(function (u) {
      return '<label class="wac-mac-cc-option">' +
        '<input type="checkbox" class="' + checkboxClass + '" value="' + html(u.id) + '">' +
        '<span class="wac-mac-cc-option-name">' + html(u.name || u.id) + '</span>' +
      '</label>';
    }).join('');
  }
  function getChecked(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(function (el) { return el.checked; }).map(function (el) { return String(el.value); });
  }
  function renderGroupSection(groups, id, checkboxClass) {
    return '<div class="wac-mac-cc-inline" id="' + id + '">' +
      '<h3 style="margin:0 0 4px;font-size:13px">飞书群</h3>' +
      '<p class="wac-mac-cc-hint">深圳群接收中文报告，BIC 群接收英文报告。未配置或本批次已发送的群不可重复选择。</p>' +
      '<div class="wac-mac-cc-options">' + groupOptionsHtml(groups, checkboxClass) + '</div>' +
    '</div>';
  }

  injectStyles();

  // 首次确认：在现有 WAC 计算弹窗的人员选择下方追加群组选择，不改动 WAC 输入和校验。
  var originalWacConfirm = window.wacConfirm;
  if (typeof originalWacConfirm === 'function') {
    window.wacConfirm = async function (batchId) {
      await originalWacConfirm.apply(this, arguments);
      var section = document.getElementById('wac-cc-section');
      if (!section || section.querySelector('#wac-cc-group-list')) return;
      try {
        var data = await window.api('/api/wac/cc-groups');
        section.insertAdjacentHTML('beforeend', renderGroupSection(data && data.groups, 'wac-cc-group-list', 'wac-cc-group-cb'));
      } catch (error) {
        section.insertAdjacentHTML('beforeend', '<div class="wac-mac-cc-inline" style="color:#c33">群组列表加载失败：' + html(error && error.message || error) + '</div>');
      }
    };
  }

  // 通过统一 API 出口给首次 WAC 确认附加群组选择；原有库存校验、WAC 提交流程保持不变。
  var originalApi = window.api;
  if (typeof originalApi === 'function') {
    window.api = function (url, method, body, opts) {
      if (String(url || '').indexOf('/api/wac/confirm/') === 0 && String(method || 'GET').toUpperCase() === 'POST') {
        body = Object.assign({}, body || {}, { cc_group_keys: getChecked('#wac-cc-group-list .wac-cc-group-cb') });
      }
      return originalApi.call(this, url, method, body, opts);
    };
  }

  // 事后补充 CC：同一 macOS 风格选择面板支持人员和群组，可单独选择其中任一类。
  window.openWacCcModal = async function (batchId) {
    var id = String(batchId || '');
    if (!id) return;
    var row = (window._wacBatchRows || []).find(function (r) { return String(r.id) === id; });
    try {
      var encoded = encodeURIComponent(id);
      var results = await Promise.all([
        window.api('/api/wac/cc-candidates'),
        window.api('/api/wac/notifications/' + encoded),
        window.api('/api/wac/cc-groups?batch_id=' + encoded)
      ]);
      var candidates = Array.isArray(results[0]) ? results[0] : [];
      var history = results[1] || { logs: [] };
      var groupData = results[2] || { groups: [] };
      var logs = Array.isArray(history.logs) ? history.logs : [];
      var existingUsers = new Set(logs.map(function (log) { return String(log.recipient_user_id || ''); }).filter(function (key) { return key.indexOf('group:') !== 0; }));
      var userHtml = userOptionsHtml(candidates, existingUsers, 'wac-cc-add-cb');
      var groupHtml = groupOptionsHtml(groupData.groups, 'wac-cc-add-group-cb');
      var historyHtml = logs.length ? window.renderWacNotificationHistory(history, id) : '<div class="wac-mac-cc-empty">目前没有抄送记录。</div>';
      var body = '<div class="wac-mac-cc-meta"><span><strong>物流批次：</strong>' + html(row ? row.batch_no : id) + '</span><span style="color:var(--text-secondary)">补充 CC 只读取已保存的 WAC 历史，不会重新计算或修改成本。</span></div>' +
        '<div class="wac-mac-cc-grid">' +
          '<section class="wac-mac-cc-panel"><h3>人员</h3><p class="wac-mac-cc-hint">选择尚未收到本批次报告的飞书人员，可多选。</p><div class="wac-mac-cc-options" id="wac-cc-add-list">' + userHtml + '</div></section>' +
          '<section class="wac-mac-cc-panel"><h3>飞书群</h3><p class="wac-mac-cc-hint">按群语言发送报告；已配置的群才可选择。</p><div class="wac-mac-cc-options" id="wac-cc-add-group-list">' + groupHtml + '</div></section>' +
        '</div>' +
        '<section class="wac-mac-cc-history"><h3>已有抄送记录</h3><div id="wac-notification-history">' + historyHtml + '</div></section>';
      var footer = '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="wac-cc-add-submit" ' + ((candidates.some(function (u) { return u && u.status === 'active' && !existingUsers.has(String(u.id)); }) || (groupData.groups || []).some(function (g) { return g.configured && Number(g.remaining_count) > 0; })) ? '' : 'disabled ') + 'onclick="submitWacCc(\'' + html(id).replace(/'/g, '&#39;') + '\')">发送 CC</button>';
      window.openModal('选择抄送对象', body, footer);
      var modal = document.getElementById('modal-content');
      if (modal) modal.classList.add('wac-cc-macos');
    } catch (error) {
      window.showToast(error && error.message || '抄送对象加载失败', 'danger');
    }
  };

  window.submitWacCc = async function (batchId) {
    var userIds = getChecked('#wac-cc-add-list .wac-cc-add-cb');
    var groupKeys = getChecked('#wac-cc-add-group-list .wac-cc-add-group-cb');
    if (!userIds.length && !groupKeys.length) {
      window.showToast('请至少选择一位人员或一个群组', 'warning');
      return;
    }
    var button = document.getElementById('wac-cc-add-submit');
    if (button) { button.disabled = true; button.textContent = '发送中…'; }
    try {
      var result = await window.api('/api/wac/notifications/' + encodeURIComponent(batchId) + '/cc', 'POST', {
        cc_user_ids: userIds,
        cc_group_keys: groupKeys
      });
      window.closeModal();
      var users = Number(result.added_user_count == null ? userIds.length : result.added_user_count);
      var groups = Number(result.added_group_count || 0);
      if (Number(result.added_recipient_count || 0) > 0) {
        window.showToast('已新增 ' + users + ' 位人员、' + groups + ' 个群组，创建 ' + Number(result.notification_count || 0) + ' 条通知任务', 'success');
        await window.wacConfirm(batchId);
      } else {
        window.showToast('所选收件对象已有通知记录，未重复发送', 'warning');
      }
    } catch (error) {
      window.showToast(error && error.message || '补充 CC 失败', 'danger');
      if (button) { button.disabled = false; button.textContent = '发送 CC'; }
    }
  };

  // 通知历史中统一使用“收件对象”，人员与群组都在同一张状态表内。
  var originalRenderHistory = window.renderWacNotificationHistory;
  if (typeof originalRenderHistory === 'function') {
    window.renderWacNotificationHistory = function (data, batchId) {
      return originalRenderHistory.apply(this, arguments).replace('<th>抄送人员</th>', '<th>收件对象</th>');
    };
  }
})();