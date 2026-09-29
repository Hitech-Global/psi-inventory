'use strict';

const crypto = require('crypto');
const express = require('express');
const { ShopeeShopScopeRepository } = require('./shop-scope-repository');

const ROLE_SUPER_ADMIN = 'SUPER_ADMIN';
const ROLE_OPERATOR = 'OPERATOR';
const ROLE_REVIEWER = 'REVIEWER';
const STATUS_ACTIVE = 'ACTIVE';
const STATUS_DISABLED = 'DISABLED';
const DEFAULT_COOKIE = 'shopee_ops_session';
const DAY_MS = 24 * 60 * 60 * 1000;

function csvSet(value, { lower = false } = {}) {
  return new Set(String(value || '').split(',').map(v => v.trim()).filter(Boolean).map(v => lower ? v.toLowerCase() : v));
}

function authEnabled(env = process.env) {
  return env.FEISHU_AUTH_ENABLE === 'YES';
}

function normalizeReturnPath(value) {
  const path = String(value || '/').trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 2000) return '/';
  return path;
}

function loadFeishuAuthConfig(env = process.env) {
  const enabled = authEnabled(env);
  const externalBaseUrl = String(env.FEISHU_EXTERNAL_BASE_URL || '').trim().replace(/\/$/, '');
  const config = {
    enabled,
    appId: String(env.FEISHU_APP_ID || '').trim(),
    appSecret: String(env.FEISHU_APP_SECRET || '').trim(),
    externalBaseUrl,
    cookieName: String(env.FEISHU_SESSION_COOKIE || DEFAULT_COOKIE).trim() || DEFAULT_COOKIE,
    cookieSecure: env.FEISHU_COOKIE_SECURE === 'NO' ? false : true,
    sessionDays: Math.max(1, Number(env.FEISHU_SESSION_DAYS || 30)),
    absoluteDays: Math.max(1, Number(env.FEISHU_SESSION_MAX_DAYS || 90)),
    authorizeUrl: String(env.FEISHU_AUTHORIZE_URL || 'https://open.feishu.cn/open-apis/authen/v1/index').trim(),
    appTokenUrl: String(env.FEISHU_APP_TOKEN_URL || 'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal').trim(),
    userTokenUrl: String(env.FEISHU_USER_TOKEN_URL || 'https://open.feishu.cn/open-apis/authen/v1/access_token').trim(),
    userInfoUrl: String(env.FEISHU_USER_INFO_URL || 'https://open.feishu.cn/open-apis/authen/v1/user_info').trim(),
    bootstrapEmails: csvSet(env.FEISHU_BOOTSTRAP_SUPER_ADMIN_EMAILS, { lower: true }),
    bootstrapOpenIds: csvSet(env.FEISHU_BOOTSTRAP_SUPER_ADMIN_OPEN_IDS),
    bootstrapFirstUser: String(env.FEISHU_BOOTSTRAP_FIRST_USER || 'NO').trim().toUpperCase() === 'YES',
  };
  if (enabled) {
    if (!config.appId) throw new Error('FEISHU_APP_ID is required when FEISHU_AUTH_ENABLE=YES');
    if (!config.appSecret) throw new Error('FEISHU_APP_SECRET is required when FEISHU_AUTH_ENABLE=YES');
    if (!externalBaseUrl) throw new Error('FEISHU_EXTERNAL_BASE_URL is required when FEISHU_AUTH_ENABLE=YES');
    const parsed = new URL(externalBaseUrl);
    if (parsed.protocol !== 'https:' && env.FEISHU_ALLOW_INSECURE_HTTP !== 'YES') {
      throw new Error('FEISHU_EXTERNAL_BASE_URL must use HTTPS');
    }
  }
  return config;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function cookieHeader(name, value, { secure = true, maxAgeSeconds = null } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  if (maxAgeSeconds != null) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  return parts.join('; ');
}

function forbidden(message = 'You do not have access to this shop') {
  const error = new Error(message);
  error.code = 'SHOP_ACCESS_DENIED';
  error.status = 403;
  return error;
}

function toShopId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requestedShopIds(req) {
  const values = [];
  const add = value => {
    if (Array.isArray(value)) { value.forEach(add); return; }
    if (value == null || value === '') return;
    String(value).split(',').forEach(part => {
      const id = toShopId(part.trim());
      if (id) values.push(id);
    });
  };
  for (const key of ['shop_id', 'shopId', 'target_shop_id', 'targetShopId', 'shop_ids', 'shopIds']) {
    add(req.query && req.query[key]);
    add(req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body[key] : null);
  }
  const match = String(req.path || '').match(/^\/shops\/(\d+)(?:\/|$)/);
  if (match) add(match[1]);
  return Array.from(new Set(values));
}

function assertShopAccess(req, shopId) {
  if (!req.auth || !req.auth.enabled || req.auth.role === ROLE_SUPER_ADMIN) return true;
  const id = toShopId(shopId);
  if (!id || !req.auth.shopIds.includes(id)) throw forbidden(`Shop ${shopId} is not assigned to this operator`);
  return true;
}

function authorizedShopIds(req, requested = []) {
  const ids = Array.from(new Set((requested || []).map(toShopId).filter(Boolean)));
  if (!req.auth || !req.auth.enabled || req.auth.role === ROLE_SUPER_ADMIN) return ids;
  if (ids.length) { ids.forEach(id => assertShopAccess(req, id)); return ids; }
  return [...req.auth.shopIds];
}

class FeishuAuthRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async resolveSession(tokenHash) {
    const result = await this.pool.query(
      `SELECT s.token_hash,s.expires_at,s.absolute_expires_at,s.last_seen_at,
              u.id,u.feishu_open_id,u.feishu_union_id,u.feishu_user_id,u.email,u.name,u.avatar_url,u.role,u.status,
              COALESCE(array_agg(us.shop_id) FILTER (WHERE us.shop_id IS NOT NULL),'{}') AS shop_ids
       FROM shopee_auth_sessions s
       JOIN shopee_users u ON u.id=s.user_id
       LEFT JOIN shopee_user_shops us ON us.user_id=u.id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now()
       GROUP BY s.token_hash,s.expires_at,s.absolute_expires_at,s.last_seen_at,u.id`,
      [tokenHash],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    if (row.status !== STATUS_ACTIVE) return null;
    return {
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      absoluteExpiresAt: row.absolute_expires_at,
      lastSeenAt: row.last_seen_at,
      user: {
        id: Number(row.id), openId: row.feishu_open_id, unionId: row.feishu_union_id,
        userId: row.feishu_user_id, email: row.email, name: row.name, avatarUrl: row.avatar_url,
        role: row.role, status: row.status, shopIds: (row.shop_ids || []).map(Number),
      },
    };
  }

  async touchSession(tokenHash, { sessionDays = 30 } = {}) {
    await this.pool.query(
      `UPDATE shopee_auth_sessions
       SET last_seen_at=now(),
           expires_at=LEAST(absolute_expires_at, now() + ($2::text || ' days')::interval)
       WHERE token_hash=$1 AND last_seen_at < now() - interval '12 hours'`,
      [tokenHash, String(sessionDays)],
    );
  }

  async createSession({ userId, tokenHash, sessionDays, absoluteDays }) {
    await this.pool.query(
      `INSERT INTO shopee_auth_sessions(token_hash,user_id,expires_at,absolute_expires_at)
       VALUES ($1,$2,now() + ($3::text || ' days')::interval,now() + ($4::text || ' days')::interval)`,
      [tokenHash, userId, String(sessionDays), String(absoluteDays)],
    );
  }

  async revokeSession(tokenHash) {
    if (!tokenHash) return;
    await this.pool.query('UPDATE shopee_auth_sessions SET revoked_at=now() WHERE token_hash=$1', [tokenHash]);
  }

  async createLoginState({ stateHash, returnPath }) {
    await this.pool.query(
      `INSERT INTO shopee_auth_login_states(state_hash,return_path,expires_at)
       VALUES ($1,$2,now() + interval '10 minutes')`,
      [stateHash, normalizeReturnPath(returnPath)],
    );
  }

  async consumeLoginState(stateHash) {
    const result = await this.pool.query(
      `UPDATE shopee_auth_login_states SET consumed_at=now()
       WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>now()
       RETURNING return_path`,
      [stateHash],
    );
    return result.rows[0] ? result.rows[0].return_path : null;
  }

  async findMatchingUser(profile) {
    const values = [profile.openId || null, profile.unionId || null, profile.userId || null, profile.email || null];
    const result = await this.pool.query(
      `SELECT id,feishu_open_id,feishu_union_id,feishu_user_id,email,name,avatar_url,role,status
       FROM shopee_users
       WHERE ($1::text IS NOT NULL AND feishu_open_id=$1)
          OR ($2::text IS NOT NULL AND feishu_union_id=$2)
          OR ($3::text IS NOT NULL AND feishu_user_id=$3)
          OR ($4::text IS NOT NULL AND lower(email)=lower($4))
       ORDER BY CASE WHEN feishu_open_id=$1 THEN 0 WHEN feishu_union_id=$2 THEN 1 WHEN feishu_user_id=$3 THEN 2 ELSE 3 END
       LIMIT 1`,
      values,
    );
    return result.rows[0] || null;
  }

  async bindFeishuIdentity(userId, profile) {
    const result = await this.pool.query(
      `UPDATE shopee_users SET
         feishu_open_id=COALESCE(feishu_open_id,$2),
         feishu_union_id=COALESCE(feishu_union_id,$3),
         feishu_user_id=COALESCE(feishu_user_id,$4),
         email=COALESCE(NULLIF($5,''),email),
         name=COALESCE(NULLIF($6,''),name),
         avatar_url=COALESCE(NULLIF($7,''),avatar_url),
         last_login_at=now(),updated_at=now()
       WHERE id=$1 RETURNING id,feishu_open_id,feishu_union_id,feishu_user_id,email,name,avatar_url,role,status`,
      [userId, profile.openId || null, profile.unionId || null, profile.userId || null,
        profile.email || null, profile.name || null, profile.avatarUrl || null],
    );
    return result.rows[0] || null;
  }

  async bootstrapSuperAdmin(profile) {
    const result = await this.pool.query(
      `INSERT INTO shopee_users(feishu_open_id,feishu_union_id,feishu_user_id,email,name,avatar_url,role,status,last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6,'SUPER_ADMIN','ACTIVE',now())
       RETURNING *`,
      [profile.openId || null, profile.unionId || null, profile.userId || null,
        profile.email || null, profile.name || profile.email || 'Feishu Admin', profile.avatarUrl || null],
    );
    return result.rows[0];
  }

  async bootstrapFirstUserIfEmpty(profile) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [20260929]);
      const existing = await client.query('SELECT count(*)::int AS count FROM shopee_users');
      if (Number(existing.rows[0]?.count || 0) !== 0) {
        await client.query('COMMIT');
        return null;
      }
      const result = await client.query(
        `INSERT INTO shopee_users(feishu_open_id,feishu_union_id,feishu_user_id,email,name,avatar_url,role,status,last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6,'SUPER_ADMIN','ACTIVE',now()) RETURNING *`,
        [profile.openId || null, profile.unionId || null, profile.userId || null,
          profile.email || null, profile.name || profile.email || 'Feishu Admin', profile.avatarUrl || null],
      );
      await client.query('COMMIT');
      return result.rows[0] || null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async registerPendingUser(profile) {
    const result = await this.pool.query(
      `INSERT INTO shopee_users(feishu_open_id,feishu_union_id,feishu_user_id,email,name,avatar_url,role,status,last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6,'OPERATOR','DISABLED',now())
       ON CONFLICT (feishu_open_id) DO UPDATE SET name=EXCLUDED.name,email=COALESCE(EXCLUDED.email,shopee_users.email),avatar_url=COALESCE(EXCLUDED.avatar_url,shopee_users.avatar_url),updated_at=now()
       RETURNING *`,
      [profile.openId || null, profile.unionId || null, profile.userId || null,
        profile.email || null, profile.name || profile.email || 'Feishu User', profile.avatarUrl || null],
    );
    return result.rows[0];
  }

  async listUsers() {
    const result = await this.pool.query(
      `SELECT u.id,u.feishu_open_id,u.feishu_user_id,u.email,u.name,u.avatar_url,u.role,u.status,u.last_login_at,u.created_at,
              COALESCE(array_agg(us.shop_id ORDER BY us.shop_id) FILTER (WHERE us.shop_id IS NOT NULL),'{}') AS shop_ids
       FROM shopee_users u LEFT JOIN shopee_user_shops us ON us.user_id=u.id
       GROUP BY u.id ORDER BY CASE WHEN u.role='SUPER_ADMIN' THEN 0 ELSE 1 END,u.name,u.id`,
    );
    return result.rows.map(row => ({
      id: Number(row.id), openId: row.feishu_open_id, userId: row.feishu_user_id,
      email: row.email, name: row.name, avatarUrl: row.avatar_url, role: row.role,
      status: row.status, lastLoginAt: row.last_login_at, createdAt: row.created_at,
      shopIds: (row.shop_ids || []).map(Number),
    }));
  }

  async saveUser({ id = null, name, email = null, openId = null, role, status, shopIds = [] }) {
    const cleanRole = role === ROLE_SUPER_ADMIN ? ROLE_SUPER_ADMIN : ROLE_OPERATOR;
    const cleanStatus = status === STATUS_DISABLED ? STATUS_DISABLED : STATUS_ACTIVE;
    const shops = Array.from(new Set(shopIds.map(toShopId).filter(Boolean)));
    if (!String(name || '').trim()) throw new Error('name is required');
    if (!String(email || '').trim() && !String(openId || '').trim()) throw new Error('email or Feishu open_id is required');
    if (cleanRole === ROLE_OPERATOR && shops.length === 0) {
      const error = new Error('Operator must be assigned at least one shop'); error.status = 422; throw error;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let userId = id ? Number(id) : null;
      if (userId) {
        const updated = await client.query(
          `UPDATE shopee_users SET name=$2,email=NULLIF($3,''),feishu_open_id=COALESCE(NULLIF($4,''),feishu_open_id),role=$5,status=$6,updated_at=now()
           WHERE id=$1 RETURNING id`,
          [userId, String(name).trim(), String(email || '').trim(), String(openId || '').trim(), cleanRole, cleanStatus],
        );
        if (!updated.rows.length) { const error = new Error('User not found'); error.status = 404; throw error; }
      } else {
        const inserted = await client.query(
          `INSERT INTO shopee_users(name,email,feishu_open_id,role,status)
           VALUES ($1,NULLIF($2,''),NULLIF($3,''),$4,$5) RETURNING id`,
          [String(name).trim(), String(email || '').trim(), String(openId || '').trim(), cleanRole, cleanStatus],
        );
        userId = Number(inserted.rows[0].id);
      }
      await client.query('DELETE FROM shopee_user_shops WHERE user_id=$1', [userId]);
      if (cleanRole === ROLE_OPERATOR) {
        for (const shopId of shops) {
          await client.query('INSERT INTO shopee_user_shops(user_id,shop_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, shopId]);
        }
      }
      await client.query('COMMIT');
      return userId;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') {
        const conflict = new Error('该飞书账号或邮箱已经绑定其他用户'); conflict.status = 409; conflict.code = 'USER_IDENTITY_CONFLICT'; throw conflict;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async activeSuperAdminCount() {
    const result = await this.pool.query("SELECT count(*)::int AS count FROM shopee_users WHERE role='SUPER_ADMIN' AND status='ACTIVE'");
    return Number(result.rows[0]?.count || 0);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok || payload.code && Number(payload.code) !== 0) {
    const error = new Error(payload.msg || payload.message || `Feishu HTTP ${response.status}`);
    error.status = response.status >= 400 ? response.status : 502;
    error.code = 'FEISHU_AUTH_UPSTREAM';
    throw error;
  }
  return payload;
}

async function fetchFeishuProfile({ code, config }) {
  const appTokenPayload = await fetchJson(config.appTokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });
  const appAccessToken = appTokenPayload.app_access_token || appTokenPayload.data?.app_access_token;
  if (!appAccessToken) throw new Error('Feishu app_access_token is missing');
  const userTokenPayload = await fetchJson(config.userTokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${appAccessToken}` },
    body: JSON.stringify({ grant_type: 'authorization_code', code: String(code || '') }),
  });
  const tokenData = userTokenPayload.data || userTokenPayload;
  const userAccessToken = tokenData.access_token || tokenData.user_access_token;
  if (!userAccessToken) throw new Error('Feishu user_access_token is missing');
  const userPayload = await fetchJson(config.userInfoUrl, { headers: { authorization: `Bearer ${userAccessToken}` } });
  const data = userPayload.data || userPayload;
  return {
    openId: data.open_id || null, unionId: data.union_id || null, userId: data.user_id || data.employee_id || null,
    email: data.email || data.enterprise_email || null, name: data.name || data.en_name || null,
    avatarUrl: data.avatar_url || data.avatar || data.avatar_big || null,
  };
}

function sessionTokenFromRequest(req, config) {
  return parseCookies(req.headers.cookie || '')[config.cookieName] || null;
}

function createAuthContext(session, config) {
  if (session) {
    return { enabled: true, role: session.user.role, shopIds: session.user.shopIds, user: session.user };
  }
  if (!config.enabled) return { enabled: false, role: ROLE_SUPER_ADMIN, shopIds: [], user: null };
  return null;
}

function createFeishuAuth({ pool, env = process.env, reviewerAuth = null } = {}) {
  const config = loadFeishuAuthConfig(env);
  const repository = new FeishuAuthRepository({ pool });
  const shopScopeRepository = new ShopeeShopScopeRepository({ pool });

  const resolveRequestSession = async req => {
    const reviewSession = reviewerAuth && reviewerAuth.resolveSession ? reviewerAuth.resolveSession(req) : null;
    if (reviewSession) return reviewSession;
    if (!config.enabled) return null;
    const token = sessionTokenFromRequest(req, config);
    if (!token) return null;
    const session = await repository.resolveSession(hashToken(token));
    if (session) repository.touchSession(session.tokenHash, { sessionDays: config.sessionDays }).catch(() => {});
    return session;
  };

  const requireApiSession = async (req, res, next) => {
    try {
      if (req.path === '/health') { next(); return; }
      const session = await resolveRequestSession(req);
      if (!config.enabled && !(reviewerAuth && reviewerAuth.config && reviewerAuth.config.enabled)) { req.auth = createAuthContext(null, config); next(); return; }
      if (!session) { res.status(401).json({ error: 'AUTH_REQUIRED', message: '请登录后继续。' }); return; }
      req.auth = createAuthContext(session, config);
      next();
    } catch (error) { next(error); }
  };

  const enforceShopAccess = (req, res, next) => {
    try {
      if (!req.auth || !req.auth.enabled || req.auth.role === ROLE_SUPER_ADMIN) { next(); return; }
      for (const shopId of requestedShopIds(req)) assertShopAccess(req, shopId);
      next();
    } catch (error) { next(error); }
  };

  const requireWebSession = async (req, res, next) => {
    try {
      const session = await resolveRequestSession(req);
      if (!config.enabled && !(reviewerAuth && reviewerAuth.config && reviewerAuth.config.enabled)) { next(); return; }
      if (!session) {
        const returnPath = normalizeReturnPath(req.originalUrl || '/');
        res.redirect(`/login?return=${encodeURIComponent(returnPath)}`);
        return;
      }
      req.auth = createAuthContext(session, config);
      next();
    } catch (error) { next(error); }
  };

  const requireAdmin = (req, res, next) => {
    if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
      res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: '只有超级管理员可以执行此操作。' });
      return;
    }
    next();
  };

  const router = express.Router();
  router.use(express.json({ limit: '128kb' }));

  router.get('/me', async (req, res, next) => {
    try {
      const session = await resolveRequestSession(req);
      if (!config.enabled && !(reviewerAuth && reviewerAuth.config && reviewerAuth.config.enabled)) { res.json({ enabled: false, authenticated: false }); return; }
      if (!session) { res.status(401).json({ enabled: true, authenticated: false }); return; }
      req.auth = createAuthContext(session, config);
      res.json({ enabled: true, authenticated: true, user: session.user });
    } catch (error) { next(error); }
  });

  router.get('/login-url', async (req, res, next) => {
    try {
      if (!config.enabled) { res.json({ enabled: false, url: '/' }); return; }
      const returnPath = normalizeReturnPath(req.query.return);
      const existing = await resolveRequestSession(req);
      if (existing) { res.json({ enabled: true, authenticated: true, url: returnPath }); return; }
      const state = randomToken(24);
      await repository.createLoginState({ stateHash: hashToken(state), returnPath });
      const redirectUri = `${config.externalBaseUrl}/auth/feishu/callback`;
      const url = new URL(config.authorizeUrl);
      url.searchParams.set('app_id', config.appId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      res.json({ enabled: true, authenticated: false, url: url.toString() });
    } catch (error) { next(error); }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = sessionTokenFromRequest(req, config);
      if (token && config.enabled) await repository.revokeSession(hashToken(token));
      const cookies = [cookieHeader(config.cookieName, '', { secure: config.cookieSecure, maxAgeSeconds: 0 })];
      if (reviewerAuth && reviewerAuth.clearCookie) cookies.push(reviewerAuth.clearCookie());
      res.setHeader('Set-Cookie', cookies);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  const hydrateAdmin = async (req, res, next) => {
    try {
      if (!config.enabled) { res.status(404).json({ error: 'AUTH_DISABLED' }); return; }
      const session = await resolveRequestSession(req);
      if (!session) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
      req.auth = createAuthContext(session, config);
      requireAdmin(req, res, next);
    } catch (error) { next(error); }
  };

  router.get('/admin/users', hydrateAdmin, async (req, res, next) => {
    try { res.json({ users: await repository.listUsers() }); } catch (error) { next(error); }
  });

  router.get('/admin/shops', hydrateAdmin, async (req, res, next) => {
    try { res.json({ shops: await shopScopeRepository.list() }); } catch (error) { next(error); }
  });

  router.get('/admin/roles', hydrateAdmin, (req, res) => {
    res.json({ roles: [
      { key: ROLE_SUPER_ADMIN, name: '超级管理员', allShops: true, manageUsers: true, manageRoles: true },
      { key: ROLE_OPERATOR, name: '运营', allShops: false, manageUsers: false, manageRoles: false },
    ] });
  });

  async function saveAdminUser(req, res, next, id = null) {
    try {
      const currentUserId = Number(req.auth.user.id);
      const role = req.body && req.body.role === ROLE_SUPER_ADMIN ? ROLE_SUPER_ADMIN : ROLE_OPERATOR;
      const status = req.body && req.body.status === STATUS_DISABLED ? STATUS_DISABLED : STATUS_ACTIVE;
      if (id && Number(id) === currentUserId && (role !== ROLE_SUPER_ADMIN || status !== STATUS_ACTIVE)) {
        const error = new Error('不能通过当前会话停用或降级自己的超级管理员账号'); error.status = 409; throw error;
      }
      if (id) {
        const existing = (await repository.listUsers()).find(user => user.id === Number(id));
        if (existing && existing.role === ROLE_SUPER_ADMIN && existing.status === STATUS_ACTIVE && (role !== ROLE_SUPER_ADMIN || status !== STATUS_ACTIVE)) {
          if (await repository.activeSuperAdminCount() <= 1) {
            const error = new Error('系统至少需要保留一个启用中的超级管理员'); error.status = 409; throw error;
          }
        }
      }
      const userId = await repository.saveUser({
        id, name: req.body && req.body.name, email: req.body && req.body.email,
        openId: req.body && req.body.openId, role, status,
        shopIds: Array.isArray(req.body && req.body.shopIds) ? req.body.shopIds : [],
      });
      const user = (await repository.listUsers()).find(row => row.id === userId);
      res.status(id ? 200 : 201).json({ ok: true, user });
    } catch (error) { next(error); }
  }

  router.post('/admin/users', hydrateAdmin, (req, res, next) => saveAdminUser(req, res, next));
  router.put('/admin/users/:id', hydrateAdmin, (req, res, next) => saveAdminUser(req, res, next, req.params.id));

  const handleLogin = async (req, res, next) => {
    try {
      if (!config.enabled) { res.redirect('/'); return; }
      const returnPath = normalizeReturnPath(req.query.return);
      const existing = await resolveRequestSession(req);
      if (existing) { res.redirect(returnPath); return; }
      const state = randomToken(24);
      await repository.createLoginState({ stateHash: hashToken(state), returnPath });
      const url = new URL(config.authorizeUrl);
      url.searchParams.set('app_id', config.appId);
      url.searchParams.set('redirect_uri', `${config.externalBaseUrl}/auth/feishu/callback`);
      url.searchParams.set('state', state);
      res.redirect(url.toString());
    } catch (error) { next(error); }
  };

  const handleCallback = async (req, res, next) => {
    try {
      if (!config.enabled) { res.redirect('/'); return; }
      const state = String(req.query.state || '');
      const code = String(req.query.code || '');
      if (!state || !code) { res.redirect('/login?reason=invalid_callback'); return; }
      const returnPath = await repository.consumeLoginState(hashToken(state));
      if (!returnPath) { res.redirect('/login?reason=invalid_state'); return; }
      const profile = await fetchFeishuProfile({ code, config });
      let user = await repository.findMatchingUser(profile);
      if (!user) {
        const email = String(profile.email || '').toLowerCase();
        const explicitlyBootstrapped = (email && config.bootstrapEmails.has(email)) || (profile.openId && config.bootstrapOpenIds.has(profile.openId));
        if (explicitlyBootstrapped) {
          user = await repository.bootstrapSuperAdmin(profile);
        } else if (config.bootstrapFirstUser) {
          user = await repository.bootstrapFirstUserIfEmpty(profile);
        }
        if (!user) user = await repository.registerPendingUser(profile);
      }
      if (!user || user.status !== STATUS_ACTIVE) { res.redirect('/login?reason=unauthorized'); return; }
      user = await repository.bindFeishuIdentity(user.id, profile);
      const token = randomToken(32);
      await repository.createSession({ userId: user.id, tokenHash: hashToken(token), sessionDays: config.sessionDays, absoluteDays: config.absoluteDays });
      res.setHeader('Set-Cookie', cookieHeader(config.cookieName, token, { secure: config.cookieSecure, maxAgeSeconds: config.sessionDays * 86400 }));
      res.redirect(normalizeReturnPath(returnPath));
    } catch (error) { next(error); }
  };

  return {
    config,
    repository,
    router,
    resolveRequestSession,
    requireApiSession,
    enforceShopAccess,
    requireWebSession,
    handleLogin,
    handleCallback,
  };
}

module.exports = {
  ROLE_SUPER_ADMIN,
  ROLE_OPERATOR,
  ROLE_REVIEWER,
  STATUS_ACTIVE,
  STATUS_DISABLED,
  FeishuAuthRepository,
  authEnabled,
  loadFeishuAuthConfig,
  normalizeReturnPath,
  randomToken,
  hashToken,
  parseCookies,
  cookieHeader,
  requestedShopIds,
  assertShopAccess,
  authorizedShopIds,
  fetchFeishuProfile,
  createFeishuAuth,
};
