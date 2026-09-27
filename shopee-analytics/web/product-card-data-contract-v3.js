'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  const TAB_META = Object.freeze({
    gms: { label: '总览', source: 'SHOPEE API', sourceClass: 'good' },
    gmvmax: { label: 'GMV Max', source: 'SHOPEE API', sourceClass: 'good' },
    manual: { label: '单品广告', source: 'SHOPEE API', sourceClass: 'good' },
    auto: { label: '全店推', source: 'SHOPEE API', sourceClass: 'good' },
    groups: { label: '广告组', source: 'MANUAL IMPORT', sourceClass: 'warn' },
  });

  function addStyles() {
    if ($('#productCardDataContractStyles')) return;
    const style = document.createElement('style');
    style.id = 'productCardDataContractStyles';
    style.textContent = `
      .ads-type-tab .source-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#16843c;margin-left:6px;vertical-align:1px}
      .ads-type-tab[data-ads-type="groups"] .source-dot{background:#c98200}
    `;
    document.head.appendChild(style);
  }

  function syncContext(type) {
    const meta = TAB_META[type] || TAB_META.gms;
    const context = $('#productCardContextV2');
    const source = $('#productCardSourceV2');
    if (context) context.textContent = meta.label;
    if (source) {
      source.textContent = meta.source;
      source.className = `pill ${meta.sourceClass}`;
    }
  }

  function annotateTabs() {
    $$('.ads-type-tab').forEach(button => {
      const meta = TAB_META[button.dataset.adsType];
      if (!meta) return;
      button.innerHTML = `${meta.label}<span class="source-dot" title="${meta.source}"></span>`;
      if (button.dataset.sourceBound === '1') return;
      button.dataset.sourceBound = '1';
      button.addEventListener('click', () => syncContext(button.dataset.adsType));
    });
  }

  function alignCopy() {
    const parent = $('#productCardParent');
    const parentP = parent && parent.querySelector('p');
    if (parentP) parentP.textContent = '商品广告总览与下钻';
    const groupDescription = $('#adsGroupImportPanel .panel-head p');
    if (groupDescription) groupDescription.textContent = 'Seller Centre 报表 · 手动导入';
  }

  function init() {
    addStyles();
    annotateTabs();
    alignCopy();
    syncContext($('.ads-type-tab.active')?.dataset.adsType || 'gms');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
