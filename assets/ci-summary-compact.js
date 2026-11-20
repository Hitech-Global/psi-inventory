(function () {
  'use strict';

  // The CI summary now renders three cards: total, paid, and unpaid.
  // The former operational/history compaction is obsolete. It scanned the whole
  // page after every DOM change and could block the browser while WAC was opening.
  // Keep only the display-only currency formatter; financial values are untouched.

  function formatCurrencyAmounts(markup, omitZero) {
    return String(markup || '').replace(/\b[A-Z]{3}\s+-?[\d,]+\.\d{2}(?:\s*·\s*[A-Z]{3}\s+-?[\d,]+\.\d{2})*/g, function (group) {
      var currencies = group.split(/\s*·\s*/).filter(function (part) {
        if (!omitZero) return true;
        var match = part.match(/^[A-Z]{3}\s+(-?[\d,]+\.\d{2})$/);
        if (!match) return true;
        return Math.abs(Number(match[1].replace(/,/g, ''))) > 0.000001;
      });
      return currencies.length ? currencies.join('<br>') : '—';
    });
  }

  function installCurrencyLineRenderer() {
    if (typeof window === 'undefined' || typeof window.renderPurchaseAmountSummary !== 'function') return;
    var original = window.renderPurchaseAmountSummary;
    if (original.__ciCurrencyLines) return;

    var wrapped = function () {
      var html = String(original.apply(this, arguments) || '');
      var statNumberIndex = 0;
      html = html.replace(/(<div class="stat-number"[^>]*>)([\s\S]*?)(<\/div>)/g, function (match, opening, content, closing) {
        var omitZero = statNumberIndex === 2; // third card: remaining unpaid
        statNumberIndex++;
        return opening + formatCurrencyAmounts(content, omitZero) + closing;
      });
      // Also split currency values in the paid-card breakdown: cash / deduction / rounding.
      return formatCurrencyAmounts(html, false);
    };
    wrapped.__ciCurrencyLines = true;
    wrapped.__original = original;
    window.renderPurchaseAmountSummary = wrapped;
  }

  installCurrencyLineRenderer();
})();
