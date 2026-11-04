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
                <ul class="shop-list" id="platformTiktokShops"></ul>
              </div>
              <div class="platform-actions">
                <button type="button" class="primary" id="platformTiktokConnect"></button>
                <button type="button" class="ghost" id="platformTiktokRefresh"></button>
              </div>
            </section>
          </div>
          <p class="connect-note" id="platformConnectionsNote"></p>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
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
      const payload = await request(`${API}/tiktok/status`);
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
    } catch (error) {
      setState(state, 'error', t('error'));
      renderRows(document.getElementById('platformTiktokDetail'), [[t('token'), error.message]]);
    }
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

  function open() {
    const modal = ensureModal();
    label();
    modal.classList.remove('hidden');
    loadShopee();
    loadTiktok();
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
    if (event.target.closest('#platformConnectionsRefresh, #platformShopeeRefresh, #platformTiktokRefresh')) {
      event.preventDefault();
      loadShopee();
      loadTiktok();
      return;
    }
    if (event.target.closest('#platformTiktokConnect')) {
      event.preventDefault();
      // The platform's own authorization page is somewhere else entirely,
      // so where to come back to is kept before leaving.
      try {
        sessionStorage.setItem('platformConnectionsReturn', location.pathname + location.hash);
      } catch (error) { /* a browser that will not remember is not a reason to stop */ }
      location.href = `${API}/tiktok/oauth/start`;
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const modal = document.getElementById('platformConnectionsModal');
      if (modal && !modal.classList.contains('hidden')) close();
    }
  });

  window.ShopeePlatformConnections = { open, close, loadShopee, loadTiktok };
})();
