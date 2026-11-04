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

  /**
   * Why the Brand Portal connection may refuse to be made.
   *
   * Shopee only opens Brand Portal to official and mall sellers. A shop that
   * is neither has no principal to authorize, and the page says so in terms
   * that do not help the reader: "all linked principals are inactive". Saying
   * it here, before they go and meet that page, saves them the round trip —
   * and points at where the same figures can be read instead.
   */
  /**
   * The markets a shop can trade in, and what to call them.
   *
   * The country decides the timezone the shop's days are counted in, so it
   * is not a free-text field: a shop in the wrong one would have its
   * figures counted against the wrong midnight.
   */
  const MARKETS = [
    { code: 'ID', label: '印度尼西亚' },
    { code: 'MY', label: '马来西亚' },
    { code: 'TH', label: '泰国' },
    { code: 'VN', label: '越南' },
    { code: 'PH', label: '菲律宾' },
    { code: 'SG', label: '新加坡' },
    { code: 'TW', label: '中国台湾' },
    { code: 'BR', label: '巴西' },
    { code: 'MX', label: '墨西哥' },
  ];

  /**
   * How to get past Brand Portal's own sign-in page.
   *
   * The page asks for credentials in a way that differs from every other
   * Shopee sign-in, and saying so here saves a reader from trying the
   * credentials that work everywhere else. The three cases are the ones
   * Shopee itself sets out: an account that used the older marketing
   * portal, one that has never used it, and one whose password has been
   * forgotten.
   */
  const BRAND_PORTAL_HINT = 'Brand Portal 仅对官方店 / Mall 卖家开放。'
    + '授权页要填「能访问本店铺」的 Shopee 账号 —— 与卖家中心同一套账号密码，'
    + '主账号格式为「账号名:main」（页面可切换）；密码忘了点「Forgot Password」重置。'
    + '若用主账号登录后提示「principals 不可用」，说明品牌主体尚未在 Brand Portal 开通，'
    + '需联系 Shopee 的 Key Account Manager 申请。'
    + '访客与转化率也可改从卖家中心 Business Insights 导出。';

  /**
   * Why a returns connection may not reach the shop it was asked for.
   *
   * A returns token belongs to one shop. When the reader authorizes a main
   * account, Shopee offers the shops under it, and the token covers only
   * those — so a shop under a different account never appears and never
   * connects, however many times the authorization is repeated.
   */
  const ERP_HINT = 'ERP 授权按店铺独立生效：令牌只覆盖授权页里勾选的店铺。若本店铺没出现在授权列表中，说明它不在该账号下，需要换用能访问它的账号授权。';

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
   * The details that tell two shops apart.
   *
   * Two shops can be registered from the same store under different names,
   * and the names alone are often indistinguishable — "Redragon Indonesia
   * Official" and "Redragon Indonesia OS" say nothing about why there are
   * two of them. The name the shop was registered under, its number, and
   * where it trades do.
   */
  function shopDetails(shop) {
    const parts = [];
    if (shop.importSourceShopName) parts.push(`来源店铺 ${shop.importSourceShopName}`);
    if (shop.countryName) parts.push(shop.countryName);
    if (shop.brandName) parts.push(shop.brandName);
    if (shop.dataSourceCapability === 'MANUAL_IMPORT') parts.push('仅手动导入');
    return parts.join(' · ');
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
        note: '营业额、访客与转化率',
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
      if (portal.tokenRefreshError) {
        return {
          state: pill('需重新授权', 'warn'),
          note: '最近一次自动续期失败，授权可能已过期',
          action: '<button type="button" class="connections-action" data-connect="brand-portal" data-shop-id="' + esc(shop.shopId) + '">重新授权</button>',
        };
      }
      return {
        state: pill('已授权，待同步', 'warn'),
        note: '营业额、访客与转化率',
        action: '',
      };
    }
    return {
      state: pill('待授权', 'warn'),
      note: '营业额、访客与转化率',
      action: '<button type="button" class="connections-action" data-connect="brand-portal" data-shop-id="' + esc(shop.shopId) + '">连接 Brand Portal</button>',
      hint: BRAND_PORTAL_HINT,
    };
  }

  function renderErp(shop) {
    const erp = shop.erp;
    if (!erp) return { state: pill('不可用', 'neutral'), note: '', action: '' };
    if (erp.tokenPresent) {
      // A token that has gone stale shows as needing the authorization again.
      // The access token's own expiry is not worth showing: it is replaced
      // every few hours and the reader has nothing to do about it.
      if (erp.tokenRefreshError) {
        return {
          state: pill('需重新授权', 'warn'),
          note: '最近一次自动续期失败，授权可能已过期',
          action: '<button type="button" class="connections-action" data-connect="erp" data-shop-id="' + esc(shop.shopId) + '">重新授权</button>',
        };
      }
      return {
        state: pill('已连接', 'good'),
        note: '令牌每 4 小时自动续期，无需手动操作',
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
      hint: ERP_HINT,
      hintClass: 'info',
    };
  }

  function renderShop(shop) {
    const report = renderShopReport(shop);
    const erp = renderErp(shop);
    const livestream = shop.livestream || {};
    const rows = [
      ['店铺营业额 · 访客 · 转化率', report.state, report.note, report.action],
      ['退货退款', erp.state, erp.note, erp.action],
      [
        '直播表现',
        livestream.days > 0 ? pill(`已同步 ${livestream.days} 天`, 'good') : pill('未同步', 'neutral'),
        livestream.latestDate
          ? `数据到 ${livestream.latestDate}`
          : '与营业额同一套授权，独立接口同步',
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

    const details = shopDetails(shop);
    return `
      <section class="connections-shop">
        <div class="connections-shop-head">
          <strong>${esc(shopTitle(shop))}</strong>
          <span class="connections-shop-id">${esc(shop.shopId)}</span>
        </div>
        ${details ? `<div class="connections-shop-details">${esc(details)}</div>` : ''}
        <ul class="connections-list">${rows}</ul>
      </section>`;
  }

  /**
   * What each application covers, said once.
   *
   * The same paragraph under every shop is a paragraph nobody reads: by
   * the third shop the eye has gone past it. And it is not the same
   * paragraph each time — one is about an application, not about a shop,
   * so it belongs above the shops rather than inside each of them.
   */
  function renderSources(payload) {
    const apps = (payload && payload.apps) || {};
    const partner = name => (apps[name] ? `Partner ID ${apps[name]}` : '');
    return `<section class="connections-sources">
      <div class="connections-source">
        <div class="connections-source-head">
          <strong>Brand Portal</strong>
          <span>${esc(partner('brandPortal'))}</span>
        </div>
        <p class="connections-source-scope">
          覆盖：店铺营业额 · 访客与转化率 · 销售明细 · 直播表现 · 联盟营销 · 商品级广告表现
        </p>
        <p class="connections-hint warn">${esc(BRAND_PORTAL_HINT)}</p>
      </div>
      <div class="connections-source">
        <div class="connections-source-head">
          <strong>ERP</strong>
          <span>${esc(partner('erp'))}</span>
        </div>
        <p class="connections-source-scope">覆盖：退货与退款数据</p>
        <p class="connections-hint info">${esc(ERP_HINT)}</p>
      </div>
    </section>`;
  }

  function renderBody(payload) {
    const shops = payload && Array.isArray(payload.shops) ? payload.shops : [];
    if (!shops.length) {
      return '<div class="empty">还没有配置店铺档案。</div>';
    }
    return renderSources(payload) + shops.map(renderShop).join('');
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
          <div class="connections-head-actions">
            <button type="button" class="connections-refresh" id="shopConnectionsRefresh">刷新</button>
            <button type="button" class="connections-close" id="shopConnectionsClose" aria-label="关闭">✕</button>
          </div>
        </div>
        <div class="connections-body" id="shopConnectionsBody"><div class="empty">读取中…</div></div>
        <form class="connections-add" id="shopConnectionsAdd" hidden>
          <div class="connections-add-head">
            <strong>新增店铺</strong>
            <span>授权后系统会自动登记该店铺并建立连接。</span>
          </div>
          <div class="connections-add-fields">
            <label>国家
              <select id="shopAddCountry"></select>
            </label>
            <label>品牌
              <input type="text" id="shopAddBrand" placeholder="REDRAGON" autocomplete="off" />
            </label>
            <label>显示名
              <input type="text" id="shopAddName" placeholder="Redragon Indonesia Official" autocomplete="off" />
            </label>
            <button type="submit" class="connections-action primary" id="shopAddSubmit">开始授权</button>
          </div>
          <p class="connections-add-note" id="shopAddError" hidden></p>
        </form>
        <p class="connections-apps" id="shopConnectionsApps" hidden></p>
        <div class="connections-foot">
          <button type="button" class="connections-add-trigger" id="shopAddTrigger">＋ 新增店铺</button>
          <span>访问令牌每 4 小时自动续期；授权有效期由 Shopee 授权页决定（最长 365 天），到期后才需重新授权。TikTok 等其它平台在「平台接入」页授权。</span>
          <a class="connections-link" href="/connections">前往平台接入 →</a>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#shopConnectionsClose').addEventListener('click', close);
    modal.querySelector('#shopConnectionsRefresh').addEventListener('click', () => open());
    wireAddShop(modal);
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

  /**
   * Adding a shop that is not known here yet.
   *
   * The reader says where it trades and what to call it, then goes to
   * Shopee to authorize it. The shop's own number is only known on the
   * way back, so the details travel with the request and the shop is
   * registered then.
   */
  function wireAddShop(modal) {
    const trigger = modal.querySelector('#shopAddTrigger');
    const form = modal.querySelector('#shopConnectionsAdd');
    const country = modal.querySelector('#shopAddCountry');
    const brand = modal.querySelector('#shopAddBrand');
    const name = modal.querySelector('#shopAddName');
    const submit = modal.querySelector('#shopAddSubmit');
    const error = modal.querySelector('#shopAddError');
    if (!trigger || !form) return;

    if (country && !country.options.length) {
      country.innerHTML = MARKETS
        .map(market => `<option value="${esc(market.code)}">${esc(market.label)}（${esc(market.code)}）</option>`)
        .join('');
    }

    trigger.addEventListener('click', () => {
      const showing = !form.hidden;
      form.hidden = showing;
      trigger.textContent = showing ? '＋ 新增店铺' : '收起';
      if (!showing) name.focus();
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const payload = {
        country_code: (country.value || '').trim(),
        brand_code: (brand.value || '').trim(),
        display_name: (name.value || '').trim(),
      };
      if (!payload.country_code || !payload.brand_code || !payload.display_name) {
        error.hidden = false;
        error.textContent = '国家、品牌与显示名都要填。';
        return;
      }
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = '正在跳转…';
      try {
        const response = await fetch('/api/shopee-analytics/shop-connections/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
        location.href = body.authorizationUrl;
      } catch (submitError) {
        error.hidden = false;
        error.textContent = submitError.message || String(submitError);
        submit.disabled = false;
        submit.textContent = '开始授权';
      }
    });
  }

  function close() {
    const modal = document.getElementById('shopConnectionsModal');
    if (modal) modal.classList.add('hidden');
  }

  async function open() {
    const modal = ensureModal();
    modal.classList.remove('hidden');
    const body = modal.querySelector('#shopConnectionsBody');
    // 刷新时保留原来的内容，只在第一次打开时显示读取中 ——
    // 清空再填会让屏幕闪一下，反而看不出数据变了没有。
    if (!body.childElementCount) body.innerHTML = '<div class="empty">读取中…</div>';
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
      renderAppNote(modal, payload.apps);
    } catch (error) {
      body.innerHTML = `<div class="empty">读取失败：${esc(error.message)}</div>`;
    }
  }

  /**
   * Which applications the reader should open in the console.
   *
   * When a connection is refused because the platform has not finished
   * preparing it, the next step is in the console — and the reader needs
   * to know which of the partner's applications to open to do that.
   */
  function renderAppNote(modal, apps) {
    const note = modal.querySelector('#shopConnectionsApps');
    if (!note || !apps) return;
    const parts = [];
    if (apps.brandPortal) parts.push(`Brand Portal ${apps.brandPortal}`);
    if (apps.erp) parts.push(`ERP ${apps.erp}`);
    if (apps.ads) parts.push(`ADS ${apps.ads}`);
    if (!parts.length) {
      note.hidden = true;
      return;
    }
    note.hidden = false;
    note.textContent = `开放平台应用 Partner ID：${parts.join(' · ')}`;
  }

  window.ShopeeShopConnections = { open, close, renderShop, renderBody };
})();
