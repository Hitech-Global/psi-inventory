'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  const CHANNELS = [
    { key: 'product-card', label: 'Product Card', note: '商品广告总览与下钻' },
    { key: 'shop-plus', label: 'Shop+ Ads', note: '店铺级广告' },
    { key: 'brand', label: 'Brand Ads', note: '品牌广告' },
    { key: 'live', label: 'Live Ads', note: '直播广告' },
  ];

  let activeChannel = 'product-card';

  function injectStyles() {
    if ($('#adChannelUiV3Styles')) return;
    const style = document.createElement('style');
    style.id = 'adChannelUiV3Styles';
    style.textContent = `
      .ad-channel-tabs{display:flex;gap:6px;padding:4px;margin:0 0 12px;background:#eaeaed;border-radius:12px;width:max-content;max-width:100%;overflow:auto}
      .ad-channel-tab{height:36px;padding:0 15px;border:0;border-radius:9px;background:transparent;color:#6e6e73;font-weight:750;cursor:pointer;white-space:nowrap}
      .ad-channel-tab.active{background:#fff;color:#1d1d1f;box-shadow:0 1px 4px rgba(0,0,0,.08)}
      .ad-channel-placeholder{background:#fff;border:1px solid #e6e6e8;border-radius:18px;box-shadow:0 8px 28px rgba(0,0,0,.035);overflow:hidden}
      .ad-channel-placeholder-head{padding:20px;border-bottom:1px solid #ececef;display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
      .ad-channel-placeholder-head h2{margin:3px 0 6px;font-size:20px}.ad-channel-placeholder-head p{margin:0;color:#6e6e73;font-size:12px;line-height:1.6}
      .ad-channel-placeholder-body{padding:18px 20px 22px;display:grid;gap:12px}
      .ad-channel-placeholder-grid{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:10px}
      .ad-channel-placeholder-card{border:1px solid #ececef;border-radius:14px;padding:14px;background:#fbfbfc;min-height:92px}
      .ad-channel-placeholder-card span{display:block;font-size:10px;color:#86868b;margin-bottom:6px}.ad-channel-placeholder-card strong{font-size:15px}.ad-channel-placeholder-card p{font-size:10px;line-height:1.55;color:#86868b;margin:7px 0 0}
      .ad-channel-interface-note{border:1px dashed #c9c9ce;border-radius:12px;padding:13px 14px;color:#6e6e73;font-size:11px;line-height:1.65;background:#fafafa}
      @media(max-width:900px){.ad-channel-placeholder-grid{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:620px){.ad-channel-tabs{width:100%}.ad-channel-placeholder-grid{grid-template-columns:1fr}.ad-channel-placeholder-head{flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function productCardElements() {
    return [
      $('#productCardParent'),
      $('.ads-type-tabs'),
      $('#adsGmsPanel'),
      $('#adsManualPanel'),
      $('#adsAutoPanel'),
      $('#adsGroupImportPanel'),
    ].filter(Boolean);
  }

  function placeholderMeta(channel) {
    if (channel === 'shop-plus') return {
      title: 'Shop+ Ads',
      description: '店铺级广告分析入口。当前先保留页面结构，接口能力待核对 Shopee Open Platform 后再接入真实数据。',
      cards: [
        ['花费', '—', '等待 Shopee 数据源'],
        ['订单 / GMV', '—', '不使用其他广告类型数据代填'],
        ['ROAS', '—', '保持与 Seller Centre 口径一致'],
        ['趋势', '—', '接入后按日期范围展示'],
      ],
    };
    if (channel === 'brand') return {
      title: 'Brand Ads',
      description: '品牌广告分析入口。前端先建立独立业务板块，后续只有确认官方接口或可靠数据源后才展示实际指标。',
      cards: [
        ['花费', '—', '等待真实 Brand Ads 数据'],
        ['曝光 / 点击', '—', '不从 Product Card 推算'],
        ['GMV / 订单', '—', '不与其他广告类型混用'],
        ['ROAS', '—', '接入后保留 Shopee 原始精度'],
      ],
    };
    return {
      title: 'Live Ads',
      description: '直播广告分析入口。与 Product Card、Shop+ Ads、Brand Ads 分开管理，避免把直播投流结果混入商品广告。',
      cards: [
        ['花费', '—', '等待 Live Ads 数据源'],
        ['直播观看', '—', '接口确认后接入'],
        ['订单 / GMV', '—', '仅展示直播广告归因数据'],
        ['ROAS', '—', '接入后与后台精度对齐'],
      ],
    };
  }

  function ensureShell() {
    const adsView = $('#view-ads');
    const productCardParent = $('#productCardParent');
    if (!adsView || !productCardParent) return;

    if (!$('#adChannelTabsV3')) {
      const tabs = document.createElement('div');
      tabs.id = 'adChannelTabsV3';
      tabs.className = 'ad-channel-tabs';
      tabs.setAttribute('aria-label', '广告一级类型');
      tabs.innerHTML = CHANNELS.map(channel => `
        <button type="button" class="ad-channel-tab${channel.key === activeChannel ? ' active' : ''}" data-ad-channel="${channel.key}">${channel.label}</button>
      `).join('');
      productCardParent.parentNode.insertBefore(tabs, productCardParent);
    }

    if (!$('#adChannelPlaceholderV3')) {
      const placeholder = document.createElement('section');
      placeholder.id = 'adChannelPlaceholderV3';
      placeholder.className = 'ad-channel-placeholder hidden';
      productCardParent.parentNode.insertBefore(placeholder, productCardParent.nextSibling);
    }

    $$('[data-ad-channel]').forEach(button => {
      if (button.dataset.bound === '1') return;
      button.dataset.bound = '1';
      button.addEventListener('click', () => selectChannel(button.dataset.adChannel));
    });
  }

  function renderPlaceholder(channel) {
    const box = $('#adChannelPlaceholderV3');
    if (!box) return;
    const meta = placeholderMeta(channel);
    box.innerHTML = `
      <div class="ad-channel-placeholder-head">
        <div>
          <div class="section-label">AD CHANNEL</div>
          <h2>${meta.title}</h2>
          <p>${meta.description}</p>
        </div>
        <span class="pill warn">接口状态待确认</span>
      </div>
      <div class="ad-channel-placeholder-body">
        <div class="ad-channel-placeholder-grid">
          ${meta.cards.map(([label, value, sub]) => `
            <div class="ad-channel-placeholder-card">
              <span>${label}</span><strong>${value}</strong><p>${sub}</p>
            </div>`).join('')}
        </div>
        <div class="ad-channel-interface-note">
          当前页面只建立业务结构，不伪造数据。后续确认 Shopee 官方接口或 Seller Centre 可稳定导出的数据源后，再接入同步、存储和诊断逻辑。
        </div>
      </div>`;
  }

  function selectChannel(channel) {
    if (!CHANNELS.some(row => row.key === channel)) return;
    activeChannel = channel;
    $$('[data-ad-channel]').forEach(button => button.classList.toggle('active', button.dataset.adChannel === channel));

    const showProductCard = channel === 'product-card';
    productCardElements().forEach(el => {
      if (showProductCard) {
        // V2 owns which Product Card child panel is active; only release the
        // top-level hide here and let its sub-tab logic decide the rest.
        if (el.id === 'productCardParent' || el.classList.contains('ads-type-tabs')) el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });

    const placeholder = $('#adChannelPlaceholderV3');
    if (placeholder) placeholder.classList.toggle('hidden', showProductCard);

    if (showProductCard) {
      const activeSub = $('.ads-type-tab.active');
      if (activeSub) activeSub.click();
    } else {
      renderPlaceholder(channel);
    }
  }

  function init() {
    injectStyles();
    ensureShell();
    selectChannel('product-card');

    // V2 builds Product Card after DOMContentLoaded. If scripts execute in the
    // same tick and its container is not ready yet, retry briefly without
    // introducing a permanent observer or render loop.
    if (!$('#adChannelTabsV3')) {
      window.setTimeout(() => {
        ensureShell();
        selectChannel(activeChannel);
      }, 120);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
