/**
 * The settings panel's shop connections view.
 *
 * Three Shopee roles each bring a different piece of the shop's data: the
 * shop report brings traffic and the shop total, the returns role brings
 * refunds, and the livestream figures come with the shop report. The panel
 * shows all of them for every shop in one place, so the reader can see
 * which shop is missing which connection without opening each shop's page.
 *
 * A source with no data reads as a dash and says why, rather than as a
 * zero. A shop that has never had its report fetched is in a different
 * position from one whose report says nothing happened on a given day.
 */
(function () {
  'use strict';

  const DASH = '—';

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function pill(text, kind) {
    return `<span class="pill ${kind || 'neutral'}">${esc(text)}</span>`;
  }

  function shopTitle(shop) {
    const parts = [shop.countryName, shop.brandName, shop.displayName]
      .filter(Boolean)
      .map(part => String(part));
    return parts.join(' · ') || `店铺 ${shop.shopId}`;
  }

  /**
   * The shop report: traffic, the shop total, and the livestream figures.
   *
   * The report and the livestream figures both come from the Brand Portal,
   * so they are described together. Whether the connection can be made is
   * said first: a reader whose App credential is missing needs to be told
   * that, not shown a button that leads nowhere.
   */
  function renderShopReport(shop) {
    const bi = shop.shopBi || {};
    if (bi.days > 0) {
      return {
        state: pill(`已同步 ${bi.days} 天`, 'good'),
        note: bi.latestDate ? `数据到 ${bi.latestDate}` : '',
        action: '',
      };
    }
    const portal = shop.brandPortal;
    if (!portal) {
      return {
        state: pill('不可用', 'neutral'),
        note: '店铺营业额、访客与转化率都来自 Brand Portal',
        action: '',
      };
    }
    if (!portal.credentialConfigured) {
      return {
        state: pill('未配置凭据', 'warn'),
        note: '需先在服务端配置 Brand Portal Partner ID / Key',
        action: '',
      };
    }
    if (!portal.redirectUrl) {
      return {
        state: pill('未配置回调', 'warn'),
        note: 'Brand Portal OAuth 回调地址尚未配置',
        action: '',
      };
    }
    if (portal.tokenPresent) {
      return {
        state: pill('已授权，待同步', 'warn'),
        note: '店铺营业额、访客与转化率都来自这里',
        action: '',
      };
    }
    return {
      state: pill('待授权', 'warn'),
      note: '店铺营业额、访客与转化率都来自这里',
      action: '<button type="button" class="connections-action" data-connect="brand-portal" data-shop-id="' + esc(shop.shopId) + '">连接 Brand Portal</button>',
    };
  }

  function renderErp(shop) {
    const erp = shop.erp;
    if (!erp) return { state: pill('不可用', 'neutral'), note: '', action: '' };
    if (erp.tokenPresent) {
      return {
        state: pill('已连接', 'good'),
        note: erp.tokenExpiresAt ? `令牌到期 ${String(erp.tokenExpiresAt).slice(0, 10)}` : '',
        action: '',
      };
    }
    if (!erp.credentialConfigured) {
      return { state: pill('未配置凭据', 'warn'), note: '需先在服务端配置 ERP Partner ID / Key', action: '' };
    }
    if (!erp.redirectUrl) {
      return { state: pill('未配置回调', 'warn'), note: 'ERP OAuth 回调地址尚未配置', action: '' };
    }
    return {
      state: pill('待授权', 'warn'),
      note: '退货与退款数据来自这里',
      action: '<button type="button" class="connections-action" data-connect="erp" data-shop-id="' + esc(shop.shopId) + '">连接 ERP</button>',
    };
  }

  function renderShop(shop) {
    const report = renderShopReport(shop);
    const erp = renderErp(shop);
    const livestream = shop.livestream || {};
    const rows = [
      ['店铺营业额 / 访客', report.state, report.note, report.action],
      ['退货退款', erp.state, erp.note, erp.action],
      [
        '直播表现',
        livestream.days > 0 ? pill(`已同步 ${livestream.days} 天`, 'good') : pill('未同步', 'neutral'),
        livestream.latestDate ? `数据到 ${livestream.latestDate}` : '随店铺营业额一并授权',
        '',
      ],
    ]
      .map(([role, state, note, action]) => `
        <li class="connections-row">
          <span class="connections-role">${esc(role)}</span>
          <span class="connections-state">${state}</span>
          <span class="connections-note">${esc(note)}</span>
          <span class="connections-action-slot">${action}</span>
        </li>`)
      .join('');

    return `
      <section class="connections-shop">
        <div class="connections-shop-head">
          <strong>${esc(shopTitle(shop))}</strong>
          <span class="connections-shop-id">${esc(shop.shopId)}</span>
        </div>
        <ul class="connections-list">${rows}</ul>
      </section>`;
  }

  function renderBody(payload) {
    const shops = payload && Array.isArray(payload.shops) ? payload.shops : [];
    if (!shops.length) {
      return '<div class="empty">还没有配置店铺档案。</div>';
    }
    return shops.map(renderShop).join('');
  }

  function ensureModal() {
    let modal = document.getElementById('shopConnectionsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'shopConnectionsModal';
    modal.className = 'connections-backdrop hidden';
    modal.innerHTML = `
      <div class="connections-modal" role="dialog" aria-modal="true" aria-labelledby="shopConnectionsTitle">
        <div class="connections-head">
          <div>
            <h2 id="shopConnectionsTitle">店铺接口</h2>
            <p>Shopee 的三个角色各管一段数据。授权后，同步与回填会自动把对应的数据带出来。</p>
          </div>
          <button type="button" class="connections-close" id="shopConnectionsClose" aria-label="关闭">✕</button>
        </div>
        <div class="connections-body" id="shopConnectionsBody"><div class="empty">读取中…</div></div>
        <div class="connections-foot">
          <span>TikTok 等其它平台在「平台接入」页授权。</span>
          <a class="connections-link" href="/connections">前往平台接入 →</a>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#shopConnectionsClose').addEventListener('click', close);
    modal.addEventListener('click', event => {
      if (event.target === modal) close();
      const button = event.target.closest('[data-connect]');
      if (!button) return;
      const shopId = button.dataset.shopId;
      if (button.dataset.connect === 'erp') {
        location.href = `/api/shopee-analytics/erp/oauth/start?shop_id=${encodeURIComponent(shopId)}`;
      } else {
        location.href = `/api/shopee-analytics/brand-portal/oauth/start?shop_id=${encodeURIComponent(shopId)}`;
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) close();
    });
    return modal;
  }

  function close() {
    const modal = document.getElementById('shopConnectionsModal');
    if (modal) modal.classList.add('hidden');
  }

  async function open() {
    const modal = ensureModal();
    modal.classList.remove('hidden');
    const body = modal.querySelector('#shopConnectionsBody');
    body.innerHTML = '<div class="empty">读取中…</div>';
    try {
      const response = await fetch('/api/shopee-analytics/shop-connections', {
        headers: { accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        location.href = `/login?return=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
      if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
      body.innerHTML = renderBody(payload);
    } catch (error) {
      body.innerHTML = `<div class="empty">读取失败：${esc(error.message)}</div>`;
    }
  }

  window.ShopeeShopConnections = { open, close, renderShop };
})();
