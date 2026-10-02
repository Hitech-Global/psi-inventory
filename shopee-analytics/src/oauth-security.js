'use strict';

const crypto = require('crypto');

const STATE_COOKIE_NAME = 'shopee_oauth_state';
const CALLBACK_PATH = '/oauth/shopee/callback';
const DEFAULT_STATE_TTL_SECONDS = 600;
const SENSITIVE_NAMES = [
  'access_token', 'refresh_token', 'partner_key', 'code', 'sign',
  'authorization', 'cookie', 'shopee_token_master_key',
];

function generateState(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString('base64url');
}

function hashState(state) {
  if (!state || typeof state !== 'string') throw oauthError('OAUTH_INVALID_STATE', 400);
  return crypto.createHash('sha256').update(state, 'utf8').digest('hex');
}

function validateOAuthStateTtl(env = process.env) {
  const raw = env.SHOPEE_OAUTH_STATE_TTL_SECONDS;
  const ttl = raw === undefined || raw === '' ? DEFAULT_STATE_TTL_SECONDS : Number(raw);
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 3600) {
    throw new Error('SHOPEE_OAUTH_STATE_TTL_SECONDS must be an integer from 60 to 3600');
  }
  return ttl;
}

function loadLiveRedirectUrl(env = process.env) {
  const raw = String(env.SHOPEE_OAUTH_LIVE_REDIRECT_URL || '').trim();
  if (!raw) throw new Error('SHOPEE_OAUTH_LIVE_REDIRECT_URL is required when OAuth is enabled');
  let url;
  try { url = new URL(raw); }
  catch { throw new Error('SHOPEE_OAUTH_LIVE_REDIRECT_URL must be an absolute HTTPS URL'); }
  if (url.protocol !== 'https:' || url.hostname === 'localhost' || url.pathname !== CALLBACK_PATH || url.username || url.password || url.hash) {
    throw new Error(`SHOPEE_OAUTH_LIVE_REDIRECT_URL must be an HTTPS URL ending in ${CALLBACK_PATH}`);
  }
  return url.toString();
}

function oauthError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.safe = true;
  return error;
}

function redactSensitive(value) {
  let text = String(value || '');
  const keys = SENSITIVE_NAMES.join('|');
  text = text.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
  text = text.replace(new RegExp(`([?&]|\\b)(${keys})(=|%3D)([^&#\\s,;]+)`, 'gi'), '$1$2$3[REDACTED]');
  text = text.replace(new RegExp(`\\b(${keys})\\b\\s*[:=]\\s*([^\\s,;]+)`, 'gi'), '$1=[REDACTED]');
  return text;
}

function sanitizeForPersistence(error) {
  return redactSensitive(error && error.message ? error.message : error).slice(0, 2000) || 'SHOPEE_OPERATION_FAILED';
}

function safeError(error, fallbackCode = 'SHOPEE_OPERATION_FAILED') {
  if (error && error.safe) return error;
  return oauthError(fallbackCode, error && error.status && error.status >= 400 && error.status < 600 ? error.status : 502);
}

function serializeStateCookie(state, ttlSeconds) {
  return `${STATE_COOKIE_NAME}=${encodeURIComponent(state)}; Max-Age=${ttlSeconds}; Path=/oauth/shopee; HttpOnly; Secure; SameSite=Lax`;
}

function clearStateCookie() {
  return `${STATE_COOKIE_NAME}=; Max-Age=0; Path=/oauth/shopee; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, pair) => {
    const index = pair.indexOf('=');
    if (index < 1) return cookies;
    const name = pair.slice(0, index).trim();
    try { cookies[name] = decodeURIComponent(pair.slice(index + 1).trim()); }
    catch { cookies[name] = ''; }
    return cookies;
  }, {});
}

module.exports = {
  STATE_COOKIE_NAME,
  CALLBACK_PATH,
  DEFAULT_STATE_TTL_SECONDS,
  generateState,
  hashState,
  validateOAuthStateTtl,
  loadLiveRedirectUrl,
  oauthError,
  redactSensitive,
  sanitizeForPersistence,
  safeError,
  serializeStateCookie,
  clearStateCookie,
  parseCookies,
};
