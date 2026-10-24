'use strict';

(() => {
  const ROLE_ADMIN = 'SUPER_ADMIN';
  const ROLE_REVIEWER = 'REVIEWER';
  const state = { me: null, users: [], shops: [], editing: null };
  const dict = {
    zh: { settings:'设置', users:'用户管理', roles:'角色管理', logout:'退出登录', add:'添加用户', edit:'编辑', userTitle:'用户管理', userSub:'管理飞书用户、角色和可访问店铺', roleTitle:'角色管理', roleSub:'系统固定两个角色；运营的店铺范围在用户管理中设置。', name:'姓名', account:'飞书账号', role:'角色', shops:'店铺权限', status:'状态', active:'启用', disabled:'禁用', admin:'超级管理员', operator:'运营', allShops:'全部店铺', save:'保存', cancel:'取消', close:'关闭', selectShop:'运营角色必须至少分配一个店铺', accountHint:'邮箱或 Open ID', noUsers:'暂无用户', shopCount:'家店铺' },
    en: { settings:'Settings', users:'Users', roles:'Roles', logout:'Sign out', add:'Add user', edit:'Edit', userTitle:'User Management', userSub:'Manage Feishu users, roles and assigned shops', roleTitle:'Role Management', roleSub:'Two fixed roles. Operator shop scope is managed per user.', name:'Name', account:'Feishu account', role:'Role', shops:'Shop access', status:'Status', active:'Active', disabled:'Disabled', admin:'Super Admin', operator:'Operator', allShops:'All shops', save:'Save', cancel:'Cancel', close:'Close', selectShop:'Operators need at least one assigned shop', accountHint:'Email or Open ID', noUsers:'No users', shopCount:'shops' },
  };
  const lang = () => document.documentElement.lang === 'en' ? 'en' : 'zh';
  const t = key => dict[lang()][key] || dict.zh[key] || key;
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  async function request(url, options = {}) {
    const response = await fetch(url, { headers: { accept:'application/json', ...(options.body ? {'content-type':'application/json'} : {}) }, ...options });
    if (response.status === 401) { location.href='/login?return='+encodeURIComponent(location.pathname+location.search+location.hash); throw new Error('AUTH_REQUIRED'); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function ensureModal() {
    let root = document.getElementById('adminModalRoot');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'adminModalRoot';
    root.className = 'admin-modal-backdrop hidden';
    root.innerHTML = '<div class="admin-modal" role="dialog" aria-modal="true"><div id="adminModalBody"></div></div>';
    root.addEventListener('click', event => { if (event.target === root) closeModal(); });
    document.body.appendChild(root);
    return root;
  }

  function closeModal() {
    const root = ensureModal();
    root.classList.add('hidden');
    state.editing = null;
  }

  function openModal(html) {
    const root = ensureModal();
    root.querySelector('#adminModalBody').innerHTML = html;
    root.classList.remove('hidden');
  }

  function renderToolbar() {
    if (!state.me?.enabled || !state.me?.authenticated) return;
    const tools = document.querySelector('.topbar-tools');
    if (!tools || document.getElementById('authUserChip')) return;
    const user = state.me.user;
    if (user.role === ROLE_ADMIN) {
      const settings = document.createElement('div');
      settings.className = 'settings-menu-wrap';
      settings.id = 'settingsMenuWrap';
      settings.innerHTML = `<button class="settings-trigger" type="button">⚙ ${t('settings')}</button><div class="settings-popover"><button type="button" data-admin-action="users">👤 ${t('users')}</button><button type="button" data-admin-action="roles">🛡 ${t('roles')}</button></div>`;
      tools.appendChild(settings);
      settings.querySelector('[data-admin-action="users"]').addEventListener('click', openUsers);
      settings.querySelector('[data-admin-action="roles"]').addEventListener('click', openRoles);
    }
    const chip = document.createElement('div');
    chip.className = 'auth-user-menu'; chip.id = 'authUserChip';
    chip.innerHTML = `<button type="button" class="auth-user-chip">${user.avatarUrl ? `<img src="${esc(user.avatarUrl)}" alt="">` : '<span class="auth-avatar-fallback">👤</span>'}<span>${esc(user.name || user.email || 'Feishu')}</span><span class="auth-chevron">⌄</span></button><div class="auth-user-popover"><div class="auth-user-meta">${esc(user.email || '')}</div><button type="button" id="logoutBtn">${t('logout')}</button></div>`;
    tools.appendChild(chip);
    chip.querySelector('#logoutBtn').addEventListener('click', logout);
  }

  async function logout() {
    try { await request('/api/shopee-auth/logout', { method:'POST', body:'{}' }); } catch {}
    location.href='/login';
  }

  function userRows() {
    if (!state.users.length) return `<tr><td colspan="5" class="empty">${t('noUsers')}</td></tr>`;
    return state.users.map(user => {
      const shopText = user.role === ROLE_ADMIN ? t('allShops') : `${user.shopIds.length} ${t('shopCount')}`;
      return `<tr><td><div class="admin-user-name">${esc(user.name)}</div><div class="admin-user-account">${esc(user.email || user.openId || '')}</div></td><td>${user.role === ROLE_ADMIN ? t('admin') : t('operator')}</td><td>${esc(shopText)}</td><td><span class="admin-status ${user.status === 'ACTIVE' ? 'active' : 'disabled'}">${user.status === 'ACTIVE' ? t('active') : t('disabled')}</span></td><td><button class="admin-link" type="button" data-edit-user="${user.id}">${t('edit')}</button></td></tr>`;
    }).join('');
  }

  function renderUsersModal() {
    openModal(`<div class="admin-modal-head"><div><h2>${t('userTitle')}</h2><p>${t('userSub')}</p></div><button class="admin-close" type="button" data-close-admin>×</button></div><div class="admin-toolbar"><button class="primary admin-add-user" type="button" data-add-user>＋ ${t('add')}</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>${t('name')}</th><th>${t('role')}</th><th>${t('shops')}</th><th>${t('status')}</th><th></th></tr></thead><tbody>${userRows()}</tbody></table></div>`);
    document.querySelector('[data-close-admin]').addEventListener('click', closeModal);
    document.querySelector('[data-add-user]').addEventListener('click', () => editUser(null));
    document.querySelectorAll('[data-edit-user]').forEach(button => button.addEventListener('click', () => editUser(Number(button.dataset.editUser))));
  }

  async function openUsers() {
    try {
      const [users, shops] = await Promise.all([request('/api/shopee-auth/admin/users'), request('/api/shopee-auth/admin/shops')]);
      state.users = users.users || []; state.shops = shops.shops || [];
      renderUsersModal();
    } catch (error) { alert(error.message); }
  }

  function shopCheckboxes(selected = []) {
    const selectedSet = new Set((selected || []).map(Number));
    const groups = new Map();
    for (const shop of state.shops) {
      const key = `${shop.countryName || shop.countryCode || 'Other'} · ${shop.brandName || shop.brandCode || 'Other'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(shop);
    }
    return Array.from(groups.entries()).map(([label, shops]) => `<div class="admin-shop-group"><div class="admin-shop-group-title">${esc(label)}</div>${shops.map(shop => `<label class="admin-shop-option"><input type="checkbox" data-user-shop value="${shop.shopId}" ${selectedSet.has(shop.shopId) ? 'checked' : ''}><span>${esc(shop.displayName || `Shop ${shop.shopId}`)}</span></label>`).join('')}</div>`).join('');
  }

  function editUser(id) {
    const existing = id ? state.users.find(user => user.id === id) : null;
    state.editing = existing || { role:'OPERATOR', status:'ACTIVE', shopIds:[] };
    const user = state.editing;
    const emailLabel = lang() === 'en' ? 'Feishu email' : '飞书邮箱';
    const openIdLabel = lang() === 'en' ? 'Open ID (optional)' : 'Open ID（可选）';
    openModal(`<div class="admin-modal-head"><div><h2>${existing ? t('edit') : t('add')}</h2><p>${t('userSub')}</p></div><button class="admin-close" type="button" data-close-admin>×</button></div><form id="adminUserForm" class="admin-user-form"><label>${t('name')}<input name="name" maxlength="120" value="${esc(user.name || '')}" required></label><label>${emailLabel}<input name="email" type="email" value="${esc(user.email || '')}" placeholder="name@company.com"></label><label>${openIdLabel}<input name="openId" value="${esc(user.openId || '')}" placeholder="ou_xxx"></label><div class="admin-form-grid"><label>${t('role')}<select name="role"><option value="OPERATOR" ${user.role !== ROLE_ADMIN ? 'selected' : ''}>${t('operator')}</option><option value="SUPER_ADMIN" ${user.role === ROLE_ADMIN ? 'selected' : ''}>${t('admin')}</option></select></label><label>${t('status')}<select name="status"><option value="ACTIVE" ${user.status !== 'DISABLED' ? 'selected' : ''}>${t('active')}</option><option value="DISABLED" ${user.status === 'DISABLED' ? 'selected' : ''}>${t('disabled')}</option></select></label></div><section id="operatorShopSection"><div class="admin-section-title">${t('shops')} <span>${t('selectShop')}</span></div><div class="admin-shop-picker">${shopCheckboxes(user.shopIds)}</div></section><div id="adminUserError" class="admin-form-error hidden"></div><div class="admin-modal-actions"><button type="button" class="ghost" data-cancel-user>${t('cancel')}</button><button type="submit" class="primary">${t('save')}</button></div></form>`);
    const form = document.getElementById('adminUserForm');
    const syncRole = () => document.getElementById('operatorShopSection').classList.toggle('hidden', form.role.value === ROLE_ADMIN);
    form.role.addEventListener('change', syncRole); syncRole();
    document.querySelector('[data-close-admin]').addEventListener('click', closeModal);
    document.querySelector('[data-cancel-user]').addEventListener('click', renderUsersModal);
    form.addEventListener('submit', saveUser);
  }

  async function saveUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = document.getElementById('adminUserError');
    const shopIds = Array.from(form.querySelectorAll('[data-user-shop]:checked')).map(input => Number(input.value));
    const body = { name:form.name.value.trim(), email:form.email.value.trim(), openId:form.openId.value.trim(), role:form.role.value, status:form.status.value, shopIds };
    if (body.role === 'OPERATOR' && !shopIds.length) { error.textContent=t('selectShop'); error.classList.remove('hidden'); return; }
    try {
      const id = state.editing?.id;
      await request(id ? `/api/shopee-auth/admin/users/${id}` : '/api/shopee-auth/admin/users', { method:id ? 'PUT' : 'POST', body:JSON.stringify(body) });
      state.users = (await request('/api/shopee-auth/admin/users')).users || [];
      renderUsersModal();
    } catch (e) { error.textContent=e.message; error.classList.remove('hidden'); }
  }

  async function openRoles() {
    try {
      const data = await request('/api/shopee-auth/admin/roles');
      const roles = data.roles || [];
      openModal(`<div class="admin-modal-head"><div><h2>${t('roleTitle')}</h2><p>${t('roleSub')}</p></div><button class="admin-close" type="button" data-close-admin>×</button></div><div class="role-card-grid">${roles.map(role => `<article class="role-card"><div class="role-card-head"><strong>${role.key === ROLE_ADMIN ? t('admin') : t('operator')}</strong><span>${role.key}</span></div><ul>${role.allShops ? `<li>✓ ${t('allShops')}</li>` : `<li>✓ ${lang()==='en'?'Assigned shops only':'仅已分配店铺'}</li>`}<li>${role.manageUsers ? '✓' : '×'} ${t('users')}</li><li>${role.manageRoles ? '✓' : '×'} ${t('roles')}</li></ul></article>`).join('')}</div><div class="admin-modal-actions"><button type="button" class="primary" data-close-admin-bottom>${t('close')}</button></div>`);
      document.querySelector('[data-close-admin]').addEventListener('click', closeModal);
      document.querySelector('[data-close-admin-bottom]').addEventListener('click', closeModal);
    } catch (error) { alert(error.message); }
  }

  async function init() {
    try {
      const me = await request('/api/shopee-auth/me');
      state.me = me;
      if (me?.user?.role === ROLE_REVIEWER) document.documentElement.classList.add('reviewer-mode');
      if (me.enabled && me.authenticated) renderToolbar();
    } catch (error) { if (error.message !== 'AUTH_REQUIRED') console.warn('[Auth UI]', error.message); }
  }

  window.addEventListener('shopee:localechange', () => {
    const settings = document.getElementById('settingsMenuWrap');
    const chip = document.getElementById('authUserChip');
    if (settings) settings.remove(); if (chip) chip.remove();
    renderToolbar();
  });
  document.addEventListener('DOMContentLoaded', init);
})();
