'use strict';

const crypto = require('crypto');
const express = require('express');

const REVIEW_COOKIE = 'shopee_review_session';
const ROLE_REVIEWER = 'REVIEWER';

function parseCsvIds(value) {
  return Array.from(new Set(String(value || '').split(',').map(x => Number(x.trim())).filter(Number.isSafeInteger).filter(x => x > 0)));
}

function hashReviewPassword(password, saltBase64) {
  const salt = Buffer.from(String(saltBase64 || ''), 'base64');
  if (!password || salt.length < 16) throw new Error('Reviewer password/salt is invalid');
  return crypto.scryptSync(String(password), salt, 64).toString('base64');
}

function loadReviewerConfig(env = process.env) {
  const enabled = env.SHOPEE_REVIEW_ENABLE === 'YES';
  const config = {
    enabled,
    username: String(env.SHOPEE_REVIEW_USERNAME || '').trim(),
    passwordSalt: String(env.SHOPEE_REVIEW_PASSWORD_SALT || '').trim(),
    passwordHash: String(env.SHOPEE_REVIEW_PASSWORD_HASH || '').trim(),
    sessionSecret: String(env.SHOPEE_REVIEW_SESSION_SECRET || '').trim(),
    shopIds: parseCsvIds(env.SHOPEE_REVIEW_SHOP_IDS),
    sessionHours: Math.min(336, Math.max(1, Number(env.SHOPEE_REVIEW_SESSION_HOURS || 72))),
  };
  if (!enabled) return config;
  if (!config.username) throw new Error('SHOPEE_REVIEW_USERNAME is required when review access is enabled');
  if (!config.passwordSalt || !config.passwordHash) throw new Error('Reviewer password hash configuration is required');
  if (Buffer.from(config.sessionSecret, 'base64').length < 32) throw new Error('SHOPEE_REVIEW_SESSION_SECRET must be at least 32 random bytes in base64');
  if (!config.shopIds.length) throw new Error('SHOPEE_REVIEW_SHOP_IDS requires at least one shop');
  return config;
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((out, pair) => {
    const i = pair.indexOf('='); if (i < 1) return out;
    try { out[pair.slice(0,i).trim()] = decodeURIComponent(pair.slice(i+1).trim()); } catch {}
    return out;
  }, {});
}

function signPayload(payloadB64, secretB64) {
  return crypto.createHmac('sha256', Buffer.from(secretB64, 'base64')).update(payloadB64).digest('base64url');
}

function makeSession(config, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: config.username, exp: now + config.sessionHours * 3600000 }), 'utf8').toString('base64url');
  return payload + '.' + signPayload(payload, config.sessionSecret);
}

function verifySession(value, config, now = Date.now()) {
  const [payload, signature] = String(value || '').split('.');
  if (!payload || !signature) return false;
  const expected = signPayload(payload, config.sessionSecret);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.u === config.username && Number(parsed.exp) > now;
  } catch { return false; }
}

function reviewCookie(value, maxAgeSeconds) {
  return REVIEW_COOKIE + '=' + encodeURIComponent(value) + '; Max-Age=' + maxAgeSeconds + '; Path=/; HttpOnly; Secure; SameSite=Lax';
}
function clearReviewCookie() { return REVIEW_COOKIE + '=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax'; }

function createReviewerAuth({ env = process.env, now = () => Date.now() } = {}) {
  const config = loadReviewerConfig(env);
  const failures = new Map();
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));
  router.get('/status', (req,res) => { res.set('Cache-Control','no-store'); res.json({ enabled: config.enabled }); });
  router.post('/login', (req,res) => {
    res.set('Cache-Control','no-store');
    if (!config.enabled) { res.status(404).json({ error:'REVIEW_ACCESS_DISABLED' }); return; }
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const entry = failures.get(key) || { count:0, resetAt:0 };
    const ts = now();
    if (entry.resetAt > ts && entry.count >= 8) { res.status(429).json({ error:'TOO_MANY_ATTEMPTS' }); return; }
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    let supplied = '';
    try { supplied = hashReviewPassword(password, config.passwordSalt); } catch {}
    const a = Buffer.from(supplied); const b = Buffer.from(config.passwordHash);
    const ok = username === config.username && a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a,b);
    if (!ok) {
      failures.set(key, { count: (entry.resetAt > ts ? entry.count : 0) + 1, resetAt: ts + 15 * 60 * 1000 });
      res.status(401).json({ error:'INVALID_REVIEW_CREDENTIALS' }); return;
    }
    failures.delete(key);
    const value = makeSession(config, ts);
    res.setHeader('Set-Cookie', reviewCookie(value, config.sessionHours * 3600));
    res.json({ ok:true, role:ROLE_REVIEWER });
  });
  router.post('/logout', (req,res) => { res.setHeader('Set-Cookie', clearReviewCookie()); res.json({ ok:true }); });

  function verifyCredentials(username, password) {
    if (!config.enabled) return false;
    let supplied = '';
    try { supplied = hashReviewPassword(String(password || ''), config.passwordSalt); } catch {}
    const a = Buffer.from(supplied); const b = Buffer.from(config.passwordHash);
    return String(username || '').trim() === config.username && a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a,b);
  }

  function handleEntry(req, res) {
    if (!config.enabled) { res.status(404).send('Review access is disabled.'); return; }
    const raw = String(req.headers.authorization || '');
    if (!raw.startsWith('Basic ')) { res.setHeader('WWW-Authenticate','Basic realm="Shopee Review"'); res.status(401).send('Authentication required.'); return; }
    let username = '', password = '';
    try {
      const decoded = Buffer.from(raw.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':'); username = i >= 0 ? decoded.slice(0,i) : ''; password = i >= 0 ? decoded.slice(i+1) : '';
    } catch {}
    if (!verifyCredentials(username,password)) { res.setHeader('WWW-Authenticate','Basic realm="Shopee Review"'); res.status(401).send('Invalid review credentials.'); return; }
    const value = makeSession(config, now());
    res.setHeader('Set-Cookie', reviewCookie(value, config.sessionHours * 3600));
    res.redirect(302, '/');
  }

  function resolveSession(req) {
    if (!config.enabled) return null;
    const value = parseCookies(req.headers?.cookie)[REVIEW_COOKIE];
    if (!verifySession(value, config, now())) return null;
    return { tokenHash:null, user:{ id:null, name:'Shopee Reviewer', email:null, avatarUrl:null, role:ROLE_REVIEWER, status:'ACTIVE', shopIds:[...config.shopIds] } };
  }
  return { config, router, resolveSession, handleEntry, verifyCredentials, clearCookie: clearReviewCookie };
}

module.exports = { REVIEW_COOKIE, ROLE_REVIEWER, parseCsvIds, hashReviewPassword, loadReviewerConfig, makeSession, verifySession, createReviewerAuth, clearReviewCookie };
