'use strict';

/**
 * The platform connections, in a window over the page.
 *
 * They were a page of their own, reached by leaving the system and coming
 * back afterwards — for a thing the reader only wants to glance at: which
 * platforms are connected, and which one is not. The shop connections
 * beside it are already a window over the page, and these belong with
 * them.
 *
 * The page is still there for the one moment that needs a page of its
 * own: coming back from the platform's own authorization page.
 */
(() => {
  const API = '/api/shopee-analytics';

  /**
 * The applications the shop holds beyond the shop side and the ERP.
 *
 * Each is a partner of its own, so each has its own line: whether its
 * credentials are set, and whether a shop has been authorized for it.
 */
const SHOPEE_APPS = [
  { role: 'MARKETING', name: '联盟营销', nameEn: 'Affiliate Marketing', category: '联盟活动、绩效与对账' },
  { role: 'VIDEO', name: '视频与直播', nameEn: 'Video & Livestream', category: '视频与直播表现' },
  { role: 'ONLINE', name: '短视频', nameEn: 'Short Video', category: '短视频数据' },
  { role: 'STORE_OPS_BRAIN', name: '运营大脑', nameEn: 'Store Operations Brain', category: '店铺运营与履约质量' },
  { role: 'ORDER_ANALYSIS', name: '订单分析', nameEn: 'Order Analysis', category: '订单表现与分析' },
];

const TEXT = {
    zh: {
      title: '平台接入',
      sub: '分别授权 Shopee 与 TikTok Shop 的开放平台 API。授权后会记录店铺台账与令牌状态。',
      checking: '检查中…',
      ready: '已连接',
      pending: '待授权',
      off: '未配置',
      error: '异常',
      connect: '连接店铺',
      refresh: '刷新状态',
      credential: '应用凭据',
      shops: '已授权店铺',
      token: '令牌状态',
      expires: '令牌到期',
      region: '区域组',
      sellerType: '卖家类型',
      cipher: 'cipher 绑定',
      none: '（无）',
      notConfigured: '尚未在服务端配置该平台的应用凭据。',
      shopeeNote: 'Shopee 侧按店铺逐个授权 ERP 与 Brand Portal，入口在「店铺接口」页；这里显示的是整体可用性。',
      tiktokNote: 'TikTok 的 auth_code 30 分钟内有效且只能用一次，兑换后会自动建立「店铺 ID + cipher」台账 —— cipher 是调用店铺级接口的必要凭据。',
      empty: '暂无店铺',
      close: '关闭',
      appsTitle: '其它应用',
      appsSub: '每个应用是独立的合作伙伴，需要按店铺单独授权。',
      colCountry: '国家',
      colShop: '店铺',
      colApp: '应用名称',
      colScope: '说明',
      colState: '授权状态',
      colAction: '连接',
      pickShop: '选择店铺',
      connect: '连接',
      notConfigured: '未配置凭据',
      notAuthorized: '未授权',
      authorized: '已授权',
      needToken: '需先在开放平台上线该应用',
    },
    en: {
      title: 'Platform connections',
      sub: 'Authorize the Shopee and TikTok Shop open platform APIs separately. The ledger and the tokens are recorded so that a failed sync can be traced.',
      checking: 'Checking…',
      ready: 'Connected',
      pending: 'Pending',
      off: 'Not configured',
      error: 'Error',
      connect: 'Connect shop',
      refresh: 'Refresh',
      credential: 'Credentials',
      shops: 'Authorized shops',
      token: 'Token',
      expires: 'Token expires',
      region: 'Region',
      sellerType: 'Seller type',
      cipher: 'Cipher',
      none: '(none)',
      notConfigured: 'The credentials for this platform have not been configured on the server.',
      shopeeNote: 'The ERP and Brand Portal on the Shopee side are authorized shop by shop, from the shop connections panel; what is shown here is whether the side is available at all.',
      tiktokNote: "TikTok's auth_code is good for thirty minutes and can be used once; redeeming it establishes the shop and cipher ledger — the cipher is what the shop-level calls need.",
      empty: 'No shops',
      close: 'Close',
      appsTitle: 'Other applications',
      colCountry: 'Country',
      colShop: 'Shop',
      colApp: 'Application',
      colScope: 'What it covers',
      colState: 'Authorized',
      colAction: 'Connect',
      appsSub: 'Each application is a partner of its own and needs the shop authorized for it.',
      pickShop: 'Choose a shop',
      connect: 'Connect',
      notConfigured: 'Credentials not set',
      notAuthorized: 'Not authorized',
      authorized: 'Authorized',
      needToken: 'The application must be live on the platform first',
    },
  };

  function locale() {
    const saved = localStorage.getItem('shopee-analytics-locale');
    return saved === 'en' ? 'en' : 'zh';
  }

  function t(key) {
    const pack = TEXT[locale()];
    return pack[key] || TEXT.zh[key] || key;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  async function request(path, options) {
    const response = await fetch(path, {
      headers: { accept: 'application/json' },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
    return payload;
  }

  /**
   * The window itself.
   */
  function ensureModal() {
    let modal = document.getElementById('platformConnectionsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'platformConnectionsModal';
    modal.className = 'connections-backdrop hidden';
    modal.innerHTML = `
      <div class="connections-modal platform-modal" role="dialog" aria-modal="true"
           aria-labelledby="platformConnectionsTitle">
        <div class="connections-head">
          <div>
            <h2 id="platformConnectionsTitle"></h2>
            <p id="platformConnectionsSub"></p>
          </div>
          <div class="connections-head-actions">
            <button type="button" class="connections-refresh" id="platformConnectionsRefresh"></button>
            <button type="button" class="connections-close" id="platformConnectionsClose" aria-label="关闭">✕</button>
          </div>
        </div>
        <div class="connections-body" id="platformConnectionsBody">
          <!-- 两个平台各占一页：它们各有各的应用、各有各的凭据，
               并排放在一起时每一边都被压得很窄，而读者一次只会接一个。 -->
          <div class="platform-tabs" role="tablist" aria-label="选择平台">
            <button type="button" class="platform-tab is-active" role="tab" id="platformTabShopee"
                    data-platform-tab="shopee" aria-selected="true" aria-controls="platformPanelShopee">Shopee</button>
            <button type="button" class="platform-tab" role="tab" id="platformTabTiktok"
                    data-platform-tab="tiktok" aria-selected="false" aria-controls="platformPanelTiktok">TikTok Shop</button>
          </div>
          <div class="platform-panel" role="tabpanel" id="platformPanelShopee" data-platform-panel="shopee">
          <div class="connect-grid">
            <section class="platform-card" data-platform="shopee">
              <div class="platform-card-head">
                <div>
                  <h2 class="platform-name">Shopee Open Platform</h2>
                  <p class="platform-scope">ADS / STORE_OPS / ERP / BRAND_PORTAL</p>
                </div>
                <span class="platform-state off" id="platformShopeeState">
                  <span class="dot"></span><span class="label"></span>
                </span>
              </div>
              <div class="platform-detail">
                <dl id="platformShopeeDetail"></dl>
                <p class="platform-detail" id="platformShopeeNote"></p>
              </div>
              <div class="platform-actions">
                <button type="button" class="ghost" id="platformShopeeRefresh"></button>
              </div>
            </section>

          <div class="apps" id="platformShopeeApps"></div>
          </div>

          <div class="platform-panel hidden" role="tabpanel" id="platformPanelTiktok" data-platform-panel="tiktok">
            <div class="connect-grid">
            <section class="platform-card" data-platform="tiktok">
              <div class="platform-card-head">
                <div>
                  <h2 class="platform-name">TikTok Shop Open API</h2>
                  <p class="platform-scope" id="platformTiktokScope"></p>
                </div>
                <span class="platform-state off" id="platformTiktokState">
                  <span class="dot"></span><span class="label"></span>
                </span>
              </div>
              <div class="platform-detail">
                <dl id="platformTiktokDetail"></dl>
                <div id="platformTiktokConfig" class="platform-config hidden"></div>
                <ul class="shop-list" id="platformTiktokShops"></ul>
              </div>
              <div class="platform-actions">
                <button type="button" class="primary" id="platformTiktokConnect"></button>
                <button type="button" class="ghost" id="platformTiktokRefresh"></button>
              </div>
            </section>
            </div>
          </div>
          <p class="connect-note" id="platformConnectionsNote"></p>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  /**
   * 显示 TikTok 的配置清单。
   *
   * ★ 只显示「配没配」，不显示值 —— 密钥不能出现在页面上。
   *
   * @param {object} config /tiktok/config 的返回
   */
  function renderTiktokConfig(config) {
    const host = document.getElementById('platformTiktokConfig');
    if (!host) return;
    const shop = (config && config.shop) || {};
    const items = shop.items || [];
    const missing = shop.missing || [];
    if (!items.length || !missing.length) {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }
    const lines = items.map(item => `
      <li class="${item.configured ? 'ok' : 'missing'}">
        <span class="platform-config-key">${escapeHtml(item.key)}</span>
        <span class="platform-config-label">${escapeHtml(item.label)}</span>
        <span class="platform-config-where">${escapeHtml(item.where)}</span>
        <span class="platform-config-note">${escapeHtml(item.note || '')}</span>
      </li>`).join('');
    host.innerHTML = '<div class="platform-config-box">'
      + '<strong>店铺授权还差 ' + missing.length + ' 项配置</strong>'
      + '<p class="platform-config-lead">这些值要填进生产机 runtime/.env，然后重启 app 容器。填齐之前点「授权」只会报错。</p>'
      + '<ul class="platform-config-list">' + lines + '</ul>'
      + '</div>';
    host.classList.remove('hidden');
  }

  /**
   * 转义 HTML。
   *
   * ★ 本文件自带，不依赖别处的全局版本 ——
   *   app.js 里的 escapeHtml 是模块内的局部函数，没挂到 window，
   *   跨文件用它是未定义引用（会在渲染时才炸）。
   *
   * @param {*} value
   * @returns {string}
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setState(element, kind, label) {
    if (!element) return;
    element.className = `platform-state ${kind}`;
    const text = element.querySelector('.label');
    if (text) text.textContent = label;
  }

  function renderRows(target, rows) {
    if (!target) return;
    target.innerHTML = rows
      .filter(row => row && row[1] !== null && row[1] !== undefined && row[1] !== '')
      .map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`)
      .join('');
  }

  function renderShopList(target, shops) {
    if (!target) return;
    if (!shops.length) {
      target.innerHTML = `<li class="muted">${esc(t('empty'))}</li>`;
      return;
    }
    target.innerHTML = shops
      .map(shop => `<li><span>${esc(shop.name || shop.shopId || '')}</span>`
        + `<span class="muted">${esc(shop.shopId || '')}</span></li>`)
      .join('');
  }

  async function loadShopee() {
    const state = document.getElementById('platformShopeeState');
    setState(state, 'off', t('checking'));
    try {
      const payload = await request(`${API}/shops`).catch(() => null);
      const shops = payload && Array.isArray(payload.shops) ? payload.shops : [];
      const configured = shops.length > 0;
      setState(state, configured ? 'ready' : 'pending', configured ? t('ready') : t('pending'));
      renderRows(document.getElementById('platformShopeeDetail'), [
        [t('shops'), configured ? String(shops.length) : t('none')],
        [t('credential'), configured ? 'ADS / STORE_OPS / ERP / BRAND_PORTAL' : t('notConfigured')],
      ]);
      const note = document.getElementById('platformShopeeNote');
      if (note) note.textContent = t('shopeeNote');
    } catch (error) {
      setState(state, 'error', t('error'));
      renderRows(document.getElementById('platformShopeeDetail'), [[t('token'), error.message]]);
    }
  }

  async function loadTiktok() {
    const state = document.getElementById('platformTiktokState');
    setState(state, 'off', t('checking'));
    try {
      // 配置清单与状态一起取 —— 状态说「有没有授权过」，
      // 配置清单说「还缺什么才能授权」，两件事都要看得见。
      const [payload, config] = await Promise.all([
        request(`${API}/tiktok/status`),
        request(`${API}/tiktok/config`).catch(() => null),
      ]);
      const shops = payload.shops || [];
      const configured = Boolean(payload.credentialsConfigured);
      setState(state, configured ? 'ready' : 'off', configured ? t('ready') : t('off'));
      const scope = document.getElementById('platformTiktokScope');
      if (scope) scope.textContent = payload.scope || '';
      renderRows(document.getElementById('platformTiktokDetail'), [
        [t('credential'), configured ? (payload.credentialLabel || '') : t('notConfigured')],
        [t('region'), payload.region || t('none')],
        [t('sellerType'), payload.sellerType || t('none')],
        [t('cipher'), payload.cipherBound ? (payload.cipherLabel || '') : t('none')],
      ]);
      renderShopList(document.getElementById('platformTiktokShops'), shops);
      if (config) renderTiktokConfig(config);
    } catch (error) {
      setState(state, 'error', t('error'));
      renderRows(document.getElementById('platformTiktokDetail'), [[t('token'), error.message]]);
    }
  }

  /**
   * The applications beyond the shop side, one line each.
   *
   * The state says three things: whether the partner's credentials are
   * set here at all, whether this shop has been authorized for it, and
   * whether it is worth authorizing — an application that has not gone
   * live on the platform cannot be, whatever is set here.
   */
  /**
   * The little badge that says how an application stands.
   */
  function stateBadge(label, tone) {
    return `<span class="platform-state ${esc(tone)}"><span class="dot"></span>`
      + `<span class="label">${esc(label)}</span></span>`;
  }

  /**
   * Every application, for every shop, in one table.
   *
   * The rows are shop by shop and application by application, so that a
   * reader can see at a glance which shop is missing which connection
   * without having to pick a shop first and read one application at a
   * time.
   *
   * The columns are the country, the shop, the application, what it
   * covers, whether it is authorized, and the door to make it so.
   */
  function renderShopeeApps(statuses, shops) {
    const host = document.querySelector('#platformAppsTable');
    if (!host) return;
    const shopList = shops || [];
    const byShopRole = new Map((statuses || []).map(entry => [`${entry.shopId}:${entry.role}`, entry]));
    const rows = [];
    for (const shop of shopList) {
      for (const app of SHOPEE_APPS) {
        const status = byShopRole.get(`${shop.shopId}:${app.role}`) || {};
        const configured = status.credentialConfigured !== false;
        const authorized = Boolean(status.tokenPresent);
        let state = stateBadge(t('notAuthorized'), 'off');
        if (!configured) state = stateBadge(t('notConfigured'), 'error');
        else if (authorized) state = stateBadge(t('authorized'), 'ready');
        const action = configured && !authorized
          ? `<button type="button" class="primary" data-connect-app="${esc(app.role)}" data-shop-id="${esc(shop.shopId)}">${esc(t('connect'))}</button>`
          : '';
        rows.push(`<tr>
          <td class="apps-country">${esc(shop.countryName || shop.countryCode || '')}</td>
          <td class="apps-shop">${esc(shop.displayName || shop.shopId)}</td>
          <td class="apps-app">${esc(locale() === 'en' ? app.nameEn : app.name)}
            <small>${esc(app.role)}</small></td>
          <td class="apps-note">${esc(app.category)}</td>
          <td class="apps-state">${state}</td>
          <td class="apps-action">${action}</td>
        </tr>`);
      }
    }
    const head = document.querySelector('#platformAppsHead');
    if (head) {
      head.innerHTML = `<tr>
        <th scope="col">${esc(t('colCountry'))}</th>
        <th scope="col">${esc(t('colShop'))}</th>
        <th scope="col">${esc(t('colApp'))}</th>
        <th scope="col">${esc(t('colScope'))}</th>
        <th scope="col">${esc(t('colState'))}</th>
        <th scope="col">${esc(t('colAction'))}</th>
      </tr>`;
    }
    host.innerHTML = rows.join('')
      || `<tr><td class="empty" colspan="6">${esc(t('empty'))}</td></tr>`;
  }

  /**
   * The shops the reader may connect an application for, and the state of
   * each application for the shop chosen.
   */
  async function loadShopeeApps() {
    const host = document.querySelector('#platformShopeeApps');
    if (!host) return;
    let shops = [];
    try {
      const payload = await request('/api/shopee-analytics/shops');
      shops = Array.isArray(payload && payload.shops) ? payload.shops : [];
    } catch (error) {
      host.innerHTML = `<p class="apps-empty">${esc(String(error.message || error))}</p>`;
      return;
    }
    if (!shops.length) {
      host.innerHTML = `<p class="apps-empty">${esc(t('empty'))}</p>`;
      return;
    }
    host.innerHTML = `
      <div class="apps-head">
        <h3>${esc(t('appsTitle'))}</h3>
        <p>${esc(t('appsSub'))}</p>
      </div>
      <div class="apps-table-wrap">
        <table class="apps-table">
          <thead id="platformAppsHead"></thead>
          <tbody id="platformAppsTable"></tbody>
        </table>
      </div>`;
    let statuses = [];
    try {
      // 一次读全部店铺 —— 表格要的就是这个，而不是一个店一个店地读。
      const payload = await request('/api/shopee-analytics/app/status-all');
      statuses = (payload && payload.apps) || [];
    } catch (error) {
      statuses = [];
    }
    renderShopeeApps(statuses, shops);
  }

  function label() {
    const modal = ensureModal();
    const title = modal.querySelector('#platformConnectionsTitle');
    const sub = modal.querySelector('#platformConnectionsSub');
    const refresh = modal.querySelector('#platformConnectionsRefresh');
    const shopeeRefresh = modal.querySelector('#platformShopeeRefresh');
    const tiktokRefresh = modal.querySelector('#platformTiktokRefresh');
    const tiktokConnect = modal.querySelector('#platformTiktokConnect');
    const note = modal.querySelector('#platformConnectionsNote');
    if (title) title.textContent = t('title');
    if (sub) sub.textContent = t('sub');
    if (refresh) refresh.textContent = t('refresh');
    if (shopeeRefresh) shopeeRefresh.textContent = t('refresh');
    if (tiktokRefresh) tiktokRefresh.textContent = t('refresh');
    if (tiktokConnect) tiktokConnect.textContent = t('connect');
    if (note) note.textContent = t('tiktokNote');
  }

  /**
   * Which platform's page is being read.
   *
   * The last one read is remembered, so a reader who came to connect
   * TikTok yesterday finds TikTok there today rather than being put
   * back on the other platform.
   */
  function currentTab() {
    const active = document.querySelector('.platform-tab.is-active');
    return active ? active.dataset.platformTab : 'shopee';
  }

  /**
   * Show one platform's page.
   */
  function showTab(name) {
    const tab = name === 'tiktok' ? 'tiktok' : 'shopee';
    document.querySelectorAll('.platform-tab').forEach(button => {
      const on = button.dataset.platformTab === tab;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.platform-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.dataset.platformPanel !== tab);
    });
    try { sessionStorage.setItem('platformConnectionsTab', tab); } catch (error) { /* a browser that will not remember still gets a page */ }
  }

  /**
   * Read what the page being looked at holds.
   *
   * Only the page in front is read: the other one is not needed yet, and
   * asking for it would make the reader wait for something they are not
   * looking at.
   */
  function loadCurrentTab() {
    if (currentTab() === 'tiktok') loadTiktok();
    else {
      loadShopee();
      loadShopeeApps();
    }
  }

  function open() {
    const modal = ensureModal();
    label();
    modal.classList.remove('hidden');
    // 回到上次看的那一页。
    let remembered = '';
    try { remembered = sessionStorage.getItem('platformConnectionsTab') || ''; } catch (error) { remembered = ''; }
    showTab(remembered === 'tiktok' ? 'tiktok' : 'shopee');
    loadCurrentTab();
  }

  function close() {
    const modal = document.getElementById('platformConnectionsModal');
    if (modal) modal.classList.add('hidden');
  }

  document.addEventListener('click', event => {
    // One entry opens both platforms: the window shows each of them, so
    // two entries would have opened the same window twice.
    const trigger = event.target.closest('[data-open-platform-connections]');
    if (trigger) {
      event.preventDefault();
      open();
      return;
    }
    if (event.target.closest('#platformConnectionsClose')) {
      close();
      return;
    }
    if (event.target.closest('[data-platform-tab]')) {
      event.preventDefault();
      showTab(event.target.closest('[data-platform-tab]').dataset.platformTab);
      loadCurrentTab();
      return;
    }
    if (event.target.closest('#platformConnectionsRefresh, #platformShopeeRefresh, #platformTiktokRefresh')) {
      event.preventDefault();
      loadCurrentTab();
      return;
    }
    const connectApp = event.target.closest('[data-connect-app]');
    if (connectApp) {
      event.preventDefault();
      const role = connectApp.dataset.connectApp;
      const shopId = connectApp.dataset.shopId;
      location.href = `/api/shopee-analytics/app/oauth/start?app=${encodeURIComponent(role)}`
        + `&shop_id=${encodeURIComponent(shopId)}`;
      return;
    }
    if (event.target.closest('#platformTiktokConnect')) {
      event.preventDefault();
      // ★ 先看配置齐不齐。
      //   缺配置时留在这里、把缺哪几项和去哪拿说清楚 ——
      //   跳到平台的授权页只会得到一个读不懂的错误码。
      request(`${API}/tiktok/config`)
        .then(config => {
          const shop = (config && config.shop) || {};
          if (shop.ready) {
            // The platform's own authorization page is somewhere else entirely,
            // so where to come back to is kept before leaving.
            try {
              sessionStorage.setItem('platformConnectionsReturn', location.pathname + location.hash);
            } catch (error) { /* a browser that will not remember is not a reason to stop */ }
            location.href = `${API}/tiktok/oauth/start`;
            return;
          }
          renderTiktokConfig(config);
        })
        .catch(() => {
          // 连配置都取不到时不拦着 —— 让平台自己回错误，比这里猜要准。
          location.href = `${API}/tiktok/oauth/start`;
        });
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const modal = document.getElementById('platformConnectionsModal');
      if (modal && !modal.classList.contains('hidden')) close();
    }
  });

  window.ShopeePlatformConnections = { open, close, showTab, currentTab, loadShopee, loadTiktok };
})();
