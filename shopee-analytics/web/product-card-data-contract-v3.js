'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  function addStyles() {
    if ($('#productCardDataContractStyles')) return;
    const style = document.createElement('style');
    style.id = 'productCardDataContractStyles';
    style.textContent = `
      .product-card-source-matrix{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 12px}
      .product-card-source-card{background:#fff;border:1px solid #e6e6e8;border-radius:12px;padding:10px 12px;min-width:0}
      .product-card-source-card strong{display:block;font-size:12px;margin-bottom:3px}.product-card-source-card span{font-size:10px;color:#86868b;line-height:1.45}
      .product-card-source-card.manual{border-style:dashed}.product-card-source-card .source-kind{display:inline-flex;margin-top:6px;border-radius:999px;padding:3px 7px;background:#eef6ff;color:#0567c5;font-size:9px;font-weight:800}
      .product-card-source-card.manual .source-kind{background:#fff4d9;color:#966300}
      .ads-type-tab .source-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#16843c;margin-left:6px;vertical-align:1px}
      .ads-type-tab[data-ads-type="groups"] .source-dot{background:#c98200}
      @media(max-width:900px){.product-card-source-matrix{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:560px){.product-card-source-matrix{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function annotateTabs() {
    const labels = {
      gms: ['总览', 'API'],
      manual: ['单品广告', 'API'],
      auto: ['全店推', 'API'],
      groups: ['广告组', '手动导入'],
    };
    $$('.ads-type-tab').forEach(button => {
      const entry = labels[button.dataset.adsType];
      if (!entry) return;
      button.innerHTML = `${entry[0]}<span class="source-dot" title="${entry[1]}"></span>`;
    });
  }

  function addSourceMatrix() {
    const tabs = $('.ads-type-tabs');
    if (!tabs || $('#productCardSourceMatrix')) return;
    const matrix = document.createElement('div');
    matrix.id = 'productCardSourceMatrix';
    matrix.className = 'product-card-source-matrix';
    matrix.innerHTML = `
      <div class="product-card-source-card">
        <strong>Product Card 总览</strong>
        <span>Shopee 店铺级 CPC 广告汇总；直接来自 Shopee API，不用任何 Campaign 子类型反推。</span>
        <span class="source-kind">SHOPEE API</span>
      </div>
      <div class="product-card-source-card">
        <strong>单品广告</strong>
        <span>Campaign 级 Product Ads API 数据；展示、订单、GMV、花费、ROAS 等按所选周期读取。</span>
        <span class="source-kind">SHOPEE API</span>
      </div>
      <div class="product-card-source-card">
        <strong>全店推</strong>
        <span>Campaign 级自动 Product Ads API 数据；与单品广告独立，不混入广告组导入数据。</span>
        <span class="source-kind">SHOPEE API</span>
      </div>
      <div class="product-card-source-card manual">
        <strong>广告组</strong>
        <span>当前唯一数据源为 Seller Centre 广告组报表手动批量导入；系统不调用 API 伪造广告组数据。</span>
        <span class="source-kind">MANUAL IMPORT</span>
      </div>`;
    tabs.parentNode.insertBefore(matrix, tabs);
  }

  function alignCopy() {
    const groupPanel = $('#adsGroupImportPanel');
    const groupDescription = groupPanel && groupPanel.querySelector('.panel-head p');
    if (groupDescription) groupDescription.textContent = 'Seller Centre 广告组报表 · 手动批量导入。先看广告组整体，再点击下钻组内商品。';

    const parent = $('#productCardParent');
    const parentP = parent && parent.querySelector('p');
    if (parentP) parentP.textContent = 'Product Card 先保证数据源准确：总览/单品广告/全店推来自 Shopee API；广告组来自 Seller Centre 手动批量导入。';
  }

  function init() {
    addStyles();
    annotateTabs();
    addSourceMatrix();
    alignCopy();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
