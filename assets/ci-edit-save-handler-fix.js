'use strict';
/*
 * CI editor action binding fix.
 * The editor currently builds onclick="saveCIEdit("...")" by placing
 * JSON.stringify() output inside a double-quoted HTML attribute. The nested
 * quotes terminate the attribute early, leaving a broken inline handler.
 * Rebind both footer actions as DOM properties after the editor opens.
 */
(function (global) {
  'use strict';
  if (!global || typeof global.editCI !== 'function' || !global.document) return;

  var originalEditCI = global.editCI;
  if (originalEditCI.__ciSafeFooterActions) return;

  function bindFooterActions(id, backPay, backMode) {
    var save = global.document.getElementById('eci-save');
    if (!save) return;

    var footer = typeof save.closest === 'function'
      ? save.closest('.modal-footer')
      : save.parentNode;
    var cancel = footer && footer.querySelector
      ? footer.querySelector('button:not(#eci-save)')
      : null;

    save.removeAttribute('onclick');
    save.type = 'button';
    save.onclick = function (event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (typeof global.saveCIEdit === 'function') {
        return global.saveCIEdit(id, backPay, backMode);
      }
    };

    if (cancel) {
      cancel.removeAttribute('onclick');
      cancel.type = 'button';
      cancel.onclick = function (event) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (typeof global.viewCI === 'function') {
          return global.viewCI(id, backPay, backMode);
        }
      };
    }
  }

  async function editCIWithSafeFooterActions(id, backPay, backMode) {
    var result = await originalEditCI.apply(this, arguments);
    bindFooterActions(id, backPay, backMode);
    return result;
  }

  editCIWithSafeFooterActions.__ciSafeFooterActions = true;
  editCIWithSafeFooterActions.__original = originalEditCI;
  global.editCI = editCIWithSafeFooterActions;
})(typeof window !== 'undefined' ? window : this);
