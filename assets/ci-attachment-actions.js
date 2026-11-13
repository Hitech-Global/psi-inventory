(function (global) {
  'use strict';

  if (!global || global.__ciAttachmentActionsInstalled) return;
  global.__ciAttachmentActionsInstalled = true;

  var translations = {
    zh: {
      'ci.attachments': 'CI / PL / 清关文件',
      'ci.attachments.manage': '附件管理',
      'ci.attachments.upload_ci': '上传 CI 附件',
      'ci.attachments.upload_pl': '上传 PL 附件',
      'ci.attachments.customs': '清关文件',
      'ci.attachments.upload_customs': '上传清关文件',
      'ci.attachments.empty_customs': '暂无清关文件',
      'ci.attachments.preview_customs': '清关文件预览',
      'ci.attachments.delete_customs': '删除清关文件',
      'ci.attachments.confirm_delete_customs': '确定删除这份清关文件吗？',
      'ci.attachments.upload_ok_customs': '清关文件已上传'
    },
    en: {
      'ci.attachments': 'CI / PL / Customs Documents',
      'ci.attachments.manage': 'Manage Attachments',
      'ci.attachments.upload_ci': 'Upload CI Attachment',
      'ci.attachments.upload_pl': 'Upload PL Attachment',
      'ci.attachments.customs': 'Customs Clearance Documents',
      'ci.attachments.upload_customs': 'Upload Customs Documents',
      'ci.attachments.empty_customs': 'No customs documents uploaded',
      'ci.attachments.preview_customs': 'Customs Document Preview',
      'ci.attachments.delete_customs': 'Delete Customs Document',
      'ci.attachments.confirm_delete_customs': 'Delete this customs document?',
      'ci.attachments.upload_ok_customs': 'Customs documents uploaded'
    },
    id: {
      'ci.attachments': 'Lampiran CI / PL / Kepabeanan',
      'ci.attachments.manage': 'Kelola Lampiran',
      'ci.attachments.upload_ci': 'Unggah Lampiran CI',
      'ci.attachments.upload_pl': 'Unggah Lampiran PL',
      'ci.attachments.customs': 'Dokumen Kepabeanan',
      'ci.attachments.upload_customs': 'Unggah Dokumen Kepabeanan',
      'ci.attachments.empty_customs': 'Belum ada dokumen kepabeanan',
      'ci.attachments.preview_customs': 'Pratinjau Dokumen Kepabeanan',
      'ci.attachments.delete_customs': 'Hapus Dokumen Kepabeanan',
      'ci.attachments.confirm_delete_customs': 'Hapus dokumen kepabeanan ini?',
      'ci.attachments.upload_ok_customs': 'Dokumen kepabeanan berhasil diunggah'
    }
  };

  if (global.I18N && global.I18N.dict) {
    Object.keys(translations).forEach(function (lang) {
      Object.keys(translations[lang]).forEach(function (key) {
        global.I18N.dict[lang][key] = translations[lang][key];
      });
    });
  }

  function tr(key, fallback) {
    return typeof global.t === 'function' ? global.t(key, fallback) : fallback;
  }
  function esc(value) {
    return typeof global.esc === 'function'
      ? global.esc(value)
      : String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
  }
  function canEdit() {
    return typeof global.hasPermission !== 'function' || global.hasPermission('ci_edit');
  }
  function notify(message, type) {
    if (typeof global.showToast === 'function') global.showToast(message, type || 'warning');
  }

  // 列表仅保留一个回形针按钮；CI/PL 原有上传字段和接口不变。
  function replaceListAttachmentButtons(html) {
    var box = document.createElement('div');
    box.innerHTML = String(html || '');
    Array.prototype.forEach.call(box.querySelectorAll('tr'), function (row) {
      var buttons = Array.prototype.slice.call(row.querySelectorAll('button.action-btn'));
      for (var i = 0; i < buttons.length - 1; i++) {
        var ciAction = String(buttons[i].getAttribute('onclick') || '')
          .match(/uploadDocAttachment\(['"]ci['"],\s*['"]([^'"]+)['"],\s*['"]attachment['"]\)/);
        var plAction = String(buttons[i + 1].getAttribute('onclick') || '')
          .match(/uploadDocAttachment\(['"]ci['"],\s*['"]([^'"]+)['"],\s*['"]pl_attachment['"]\)/);
        if (!ciAction || !plAction || ciAction[1] !== plAction[1]) continue;

        var merged = document.createElement('button');
        merged.type = 'button';
        merged.className = buttons[i].className || 'action-btn';
        merged.title = tr('ci.attachments.manage', '附件管理');
        merged.setAttribute('aria-label', merged.title);
        merged.setAttribute('onclick', "event.stopPropagation();openCIAttachmentMenu('" + ciAction[1] + "')");
        merged.textContent = '📎';
        buttons[i].replaceWith(merged);
        buttons[i + 1].remove();
        break;
      }
    });
    return box.innerHTML;
  }

  if (typeof global.renderOperationalCITable === 'function') {
    var originalRenderOperationalCITable = global.renderOperationalCITable;
    global.renderOperationalCITable = function () {
      return replaceListAttachmentButtons(originalRenderOperationalCITable.apply(this, arguments));
    };
  }

  function openCIAttachmentMenu(id) {
    if (!canEdit()) {
      notify(tr('toast.uploadNoPermission', '无附件上传权限'), 'danger');
      return;
    }
    var safeId = esc(id);
    var body = '<div class="ci-attachment-menu">'
      + '<button type="button" class="ci-attachment-choice" onclick="ciSelectAttachmentUpload(\'' + safeId + '\',\'ci\')"><span>📎</span><span>' + tr('ci.attachments.upload_ci', '上传 CI 附件') + '</span><span class="ci-attachment-chevron">›</span></button>'
      + '<button type="button" class="ci-attachment-choice" onclick="ciSelectAttachmentUpload(\'' + safeId + '\',\'pl\')"><span>📦</span><span>' + tr('ci.attachments.upload_pl', '上传 PL 附件') + '</span><span class="ci-attachment-chevron">›</span></button>'
      + '<button type="button" class="ci-attachment-choice" onclick="ciSelectAttachmentUpload(\'' + safeId + '\',\'customs\')"><span>📄</span><span>' + tr('ci.attachments.upload_customs', '上传清关文件') + '</span><span class="ci-attachment-chevron">›</span></button>'
      + '</div><style>.ci-attachment-menu{display:flex;flex-direction:column;gap:9px}.ci-attachment-choice{display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;text-align:left;font-size:14px;cursor:pointer}.ci-attachment-choice:hover{border-color:#238636;background:#f5fbf6}.ci-attachment-chevron{margin-left:auto;color:#999;font-size:20px}</style>';
    var footer = '<button class="btn btn-secondary" onclick="closeModal()">' + tr('common.cancel', '取消') + '</button>';
    global.openModal(tr('ci.attachments.manage', '附件管理'), body, footer, 'modal-sm');
  }

  function selectCIAttachmentUpload(id, type) {
    global.closeModal();
    if (type === 'customs') return uploadCICustomsAttachments(id);
    if (typeof global.uploadDocAttachment !== 'function') {
      notify(tr('api.unavailable', '附件上传功能暂不可用'), 'danger');
      return;
    }
    global.uploadDocAttachment('ci', id, type === 'pl' ? 'pl_attachment' : 'attachment');
  }

  function uploadCICustomsAttachments(id) {
    if (!canEdit()) {
      notify(tr('toast.uploadNoPermission', '无附件上传权限'), 'danger');
      return;
    }
    if (typeof global.openAttachmentUploader !== 'function') {
      notify(tr('api.unavailable', '附件上传功能暂不可用'), 'danger');
      return;
    }
    global.openAttachmentUploader({
      multiple: true,
      accept: '.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.doc,.docx',
      maxFileSize: 10 * 1024 * 1024,
      maxFiles: 3,
      businessLabel: tr('ci.attachments.upload_customs', '上传清关文件'),
      uploadHandler: async function (files) {
        var payload = (files || []).map(function (file) {
          return {
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl: file.dataUrl,
            category: 'customs'
          };
        });
        if (!payload.length) throw new Error(tr('att.empty_queue', '请先添加文件'));
        await global.api('/api/commercial-invoices/' + encodeURIComponent(id) + '/shipping-attachments', 'POST', { files: payload });
      },
      onSuccess: async function () {
        if (typeof global.viewCI === 'function') await global.viewCI(id);
        notify(tr('ci.attachments.upload_ok_customs', '清关文件已上传'), 'success');
      }
    });
  }

  function getCustomsAttachments(ci) {
    var value = ci && ci.shipping_attachments;
    if (typeof value === 'string') {
      try { value = JSON.parse(value || '[]'); } catch (e) { value = []; }
    }
    if (!Array.isArray(value)) return [];
    return value.filter(function (file) {
      return file && file.category === 'customs' && file.dataUrl;
    });
  }

  function customsAttachmentSlot(ci) {
    var files = getCustomsAttachments(ci);
    var safeId = esc(ci && ci.id);
    var rows = files.length ? files.map(function (file, index) {
      var actions = '<button type="button" class="btn btn-secondary btn-sm" onclick="ciPreviewShippingAttachment(\'' + safeId + '\',' + index + ')">' + tr('att.preview', '预览') + '</button>';
      if (canEdit() && file.id) {
        actions += ' <button type="button" class="btn btn-danger btn-sm" onclick="ciDeleteShippingAttachment(\'' + safeId + '\',\'' + esc(file.id) + '\')">' + tr('common.delete', '删除') + '</button>';
      }
      return '<div class="ci-customs-file"><span class="ci-customs-file-name" title="' + esc(file.name || '') + '" onclick="ciPreviewShippingAttachment(\'' + safeId + '\',' + index + ')">' + esc(file.name || tr('ci.attachments.customs', '清关文件')) + '</span><span class="ci-customs-file-actions">' + actions + '</span></div>';
    }).join('') : '<div class="ci-customs-empty">' + tr('ci.attachments.empty_customs', '暂无清关文件') + '</div>';
    var upload = canEdit()
      ? '<button type="button" class="btn btn-secondary btn-sm" onclick="uploadCICustomsAttachments(\'' + safeId + '\')">＋ ' + tr('ci.attachments.upload_customs', '上传清关文件') + '</button>'
      : '';
    return '<div class="ci-attach-slot ci-customs-attach-slot"><div class="ci-attach-label">' + tr('ci.attachments.customs', '清关文件') + ' (' + files.length + ')</div><div class="ci-attach-body ci-customs-files">' + rows + '</div><div style="margin-top:8px">' + upload + '</div></div>';
  }

  // 清关文件使用既有 shipping_attachments 字段及 CI 附件 API，不新增表、不改变 CI/PL 原附件。
  if (typeof global.ciUnifiedAttachmentHtml === 'function') {
    var originalCIUnifiedAttachmentHtml = global.ciUnifiedAttachmentHtml;
    global.ciUnifiedAttachmentHtml = function (ci) {
      var html = originalCIUnifiedAttachmentHtml.apply(this, arguments);
      var slot = '<style>.ci-customs-files{display:flex;flex-direction:column;align-items:stretch;gap:7px}.ci-customs-file{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}.ci-customs-file-name{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1677d2;cursor:pointer}.ci-customs-file-actions{display:flex;gap:5px;flex-shrink:0}.ci-customs-empty{font-size:12px;color:#999;padding:5px 0}</style>'
        + customsAttachmentSlot(ci);
      var end = html.lastIndexOf('</div>');
      return end >= 0 ? html.slice(0, end) + slot + html.slice(end) : html + slot;
    };
  }

  global.openCIAttachmentMenu = openCIAttachmentMenu;
  global.ciSelectAttachmentUpload = selectCIAttachmentUpload;
  global.uploadCICustomsAttachments = uploadCICustomsAttachments;
  global.ciPreviewShippingAttachment = async function (id, index) {
    try {
      var result = await global.api('/api/commercial-invoices/' + encodeURIComponent(id) + '/shipping-attachments');
      var files = (result && Array.isArray(result.attachments) ? result.attachments : []).filter(function (file) {
        return file && file.category === 'customs' && file.dataUrl;
      });
      var file = files[Number(index)];
      if (!file) {
        notify(tr('ci.attachments.empty_customs', '暂无清关文件'), 'warning');
        return;
      }
      global.openAttachmentPreview([file], {
        title: tr('ci.attachments.preview_customs', '清关文件预览'),
        businessLabel: tr('ci.attachments.customs', '清关文件'),
        canDownload: true
      });
    } catch (error) {
      notify(error.message || tr('att.preview_failed', '附件预览失败'), 'danger');
    }
  };
  global.ciDeleteShippingAttachment = async function (id, fileId) {
    if (!canEdit()) {
      notify(tr('toast.uploadNoPermission', '无附件删除权限'), 'danger');
      return;
    }
    if (!global.confirm(tr('ci.attachments.confirm_delete_customs', '确定删除这份清关文件吗？'))) return;
    try {
      await global.api('/api/commercial-invoices/' + encodeURIComponent(id) + '/shipping-attachments/' + encodeURIComponent(fileId), 'DELETE');
      notify(tr('common.deleteSuccess', '附件已删除'), 'success');
      if (typeof global.viewCI === 'function') await global.viewCI(id);
    } catch (error) {
      notify(error.message || tr('api.error', '操作失败'), 'danger');
    }
  };

})(window);
