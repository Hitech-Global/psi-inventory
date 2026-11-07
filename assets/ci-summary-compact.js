(function () {
  'use strict';

  var STYLE_ID = 'psi-ci-summary-compact-style';
  var LABELS = {
    operational: ['运营采购金额', 'Operational Procurement Amount'],
    historical: ['历史采购金额', 'Historical Procurement Amount'],
    total: ['采购金额合计（按币种）', '采购金额合计 (按币种)', 'Total Procurement Amount']
  };

  function normalize(value) {
    return String(value || '').replace(/\s+/g, '').replace(/[()（）]/g, '').toLowerCase();
  }

  function hasLabel(element, labels) {
    var text = normalize(element && (element.innerText || element.textContent));
    return labels.some(function (label) { return text.indexOf(normalize(label)) !== -1; });
  }

  function findLabelNode(labels) {
    var nodes = document.querySelectorAll('body *');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!hasLabel(node, labels)) continue;
      var childHasLabel = false;
      for (var j = 0; j < node.children.length; j++) {
        if (hasLabel(node.children[j], labels)) {
          childHasLabel = true;
          break;
        }
      }
      if (!childHasLabel) return node;
    }
    return null;
  }

  function findCard(labelNode) {
    var node = labelNode;
    while (node && node !== document.body) {
      var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      if (rect && rect.width >= 220 && rect.height >= 85) return node;
      node = node.parentElement;
    }
    return null;
  }

  function lowestCommonAncestor(a, b, c) {
    if (!a || !b || !c) return null;
    var ancestors = [];
    var node = a;
    while (node) {
      ancestors.push(node);
      node = node.parentElement;
    }
    for (var i = 0; i < ancestors.length; i++) {
      var candidate = ancestors[i];
      if (candidate.contains(b) && candidate.contains(c)) return candidate;
    }
    return null;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.psi-ci-summary-grid{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:0!important;width:100%!important;}',
      '.psi-ci-summary-hidden{display:none!important;}',
      '.psi-ci-summary-total{display:flex!important;align-items:center!important;gap:18px!important;flex-wrap:wrap!important;box-sizing:border-box!important;width:100%!important;min-height:64px!important;padding:12px 20px!important;border:1px solid rgba(46,125,50,.12)!important;border-radius:14px!important;background:linear-gradient(100deg,#fff 0%,#f7fcf7 65%,#eef8ef 100%)!important;box-shadow:0 2px 8px rgba(0,0,0,.04)!important;}',
      '.psi-ci-summary-total .psi-ci-summary-content{display:flex!important;align-items:center!important;gap:18px!important;flex-wrap:wrap!important;width:100%!important;}',
      '.psi-ci-summary-total .psi-ci-summary-content>*{margin-top:0!important;margin-bottom:0!important;}',
      '.psi-ci-summary-total .psi-ci-summary-label{font-size:14px!important;font-weight:600!important;color:#555!important;white-space:nowrap!important;}',
      '.psi-ci-summary-total .psi-ci-summary-value{font-size:22px!important;font-weight:700!important;color:#2e7d32!important;white-space:nowrap!important;}',
      '.psi-ci-summary-total .psi-ci-summary-meta{font-size:13px!important;color:#888!important;white-space:nowrap!important;}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function findContentWrapper(card, labelNode) {
    var node = labelNode.parentElement;
    while (node && node !== card.parentElement) {
      var text = normalize(node.innerText || node.textContent);
      var meaningfulChildren = 0;
      for (var i = 0; i < node.children.length; i++) {
        var childText = String(node.children[i].innerText || node.children[i].textContent || '').trim();
        if (childText) meaningfulChildren++;
      }
      if (node !== labelNode && text.length > normalize(labelNode.innerText || labelNode.textContent).length && meaningfulChildren >= 2) {
        return node;
      }
      if (node === card) break;
      node = node.parentElement;
    }
    return card;
  }

  function applyCompactSummary() {
    var operationalLabel = findLabelNode(LABELS.operational);
    var historicalLabel = findLabelNode(LABELS.historical);
    var totalLabel = findLabelNode(LABELS.total);
    if (!operationalLabel || !historicalLabel || !totalLabel) return false;

    var operationalCard = findCard(operationalLabel);
    var historicalCard = findCard(historicalLabel);
    var totalCard = findCard(totalLabel);
    if (!operationalCard || !historicalCard || !totalCard) return false;

    var grid = lowestCommonAncestor(operationalCard, historicalCard, totalCard);
    if (!grid || grid === document.body) return false;

    ensureStyle();
    grid.classList.add('psi-ci-summary-grid');
    operationalCard.classList.add('psi-ci-summary-hidden');
    historicalCard.classList.add('psi-ci-summary-hidden');
    totalCard.classList.add('psi-ci-summary-total');

    var content = findContentWrapper(totalCard, totalLabel);
    if (content && content !== totalCard) content.classList.add('psi-ci-summary-content');

    totalLabel.classList.add('psi-ci-summary-label');

    // Identify the existing amount and supporting count text without changing their values.
    var descendants = totalCard.querySelectorAll('*');
    for (var i = 0; i < descendants.length; i++) {
      var text = String(descendants[i].innerText || descendants[i].textContent || '').trim();
      if (/^[A-Z]{3}\s*[\d,]+(?:\.\d{1,2})?$/.test(text)) {
        descendants[i].classList.add('psi-ci-summary-value');
      } else if (/张|待补|documents|pending/i.test(text) && text.length < 100) {
        descendants[i].classList.add('psi-ci-summary-meta');
      }
    }
    return true;
  }

  function start() {
    if (!document.body || !document.head) return;
    var queued = false;
    function schedule() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () {
        queued = false;
        applyCompactSummary();
      });
    }
    schedule();
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].addedNodes && records[i].addedNodes.length) {
          schedule();
          break;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();