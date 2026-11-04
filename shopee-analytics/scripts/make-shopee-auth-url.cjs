#!/usr/bin/env node
'use strict';

/**
 * The link that asks a seller to authorize an application.
 *
 * The authorization is not done in the open platform's console — the
 * console shows which applications exist and what their keys are, but
 * the shop itself is authorized on Shopee's own page, and the way there
 * is a link.
 *
 * The link is signed and it carries a time, so it is made fresh each time
 * rather than written down. The key never leaves this machine: only the
 * signature does.
 *
 * Usage:
 *   node scripts/make-shopee-auth-url.cjs --app MARKETING --partner 1244910 --key <key>
 *   node scripts/make-shopee-auth-url.cjs --app MARKETING --partner 1244910 --key <key> --redirect <url>
 *
 * The key may be left out, in which case it is read from the
 * environment variable of the application.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const AUTH_PATH = '/api/v2/shop/auth_partner';
const BASE_URL = 'https://partner.shopeemobile.com';

const ENV_PREFIX = {
  ADS: 'SHOPEE_ADS',
  STORE_OPS: 'SHOPEE_STORE_OPS',
  ERP: 'SHOPEE_ERP',
  BRAND_PORTAL: 'SHOPEE_BRAND_PORTAL',
  MARKETING: 'SHOPEE_MARKETING',
  VIDEO: 'SHOPEE_VIDEO',
  ONLINE: 'SHOPEE_ONLINE',
  STORE_OPS_BRAIN: 'SHOPEE_STORE_OPS_BRAIN',
  ORDER_ANALYSIS: 'SHOPEE_ORDER_ANALYSIS',
};

function parseArgs(argv) {
  const args = { app: null, partner: null, key: null, redirect: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--app') args.app = argv[++index];
    else if (value === '--partner') args.partner = argv[++index];
    else if (value === '--key') args.key = argv[++index];
    else if (value === '--redirect') args.redirect = argv[++index];
  }
  return args;
}

function signPublicRequest({ partnerId, partnerKey, path: endpoint, timestamp }) {
  const baseString = `${partnerId}${endpoint}${timestamp}`;
  return crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

function readEnvFile(file) {
  const values = {};
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return values; }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 0) continue;
    values[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return values;
}

function buildUrl({ partnerId, partnerKey, redirectUri }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signPublicRequest({ partnerId, partnerKey, path: AUTH_PATH, timestamp });
  const params = new URLSearchParams({
    partner_id: String(partnerId),
    timestamp: String(timestamp),
    redirect: redirectUri,
    sign,
  });
  return `${BASE_URL}${AUTH_PATH}?${params.toString()}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.app || !args.partner) {
    console.error('用法: node scripts/make-shopee-auth-url.cjs --app ROLE --partner ID [--key KEY] [--redirect URL]');
    process.exit(1);
  }
  const prefix = ENV_PREFIX[args.app];
  if (!prefix) {
    console.error(`未知的应用: ${args.app}`);
    process.exit(1);
  }

  const env = { ...readEnvFile(path.join(__dirname, '..', 'deploy', 'desktop', 'runtime', '.env')), ...process.env };
  const partnerKey = args.key || env[`${prefix}_PARTNER_KEY`] || '';
  if (!partnerKey) {
    console.error(`没有 ${prefix}_PARTNER_KEY —— 请用 --key 传，或先把密钥写进 runtime/.env`);
    process.exit(1);
  }
  // The redirect must match the domain the application declared, and the
  // path is counted too — a trailing slash is a different path.
  const redirectUri = args.redirect
    || env[`${prefix}_REDIRECT_URL`]
    || env.SHOPEE_OAUTH_LIVE_REDIRECT_URL
    || '';
  if (!redirectUri) {
    console.error('没有回调地址 —— 请用 --redirect 传');
    process.exit(1);
  }

  const url = buildUrl({ partnerId: args.partner, partnerKey, redirectUri });
  console.log(url);
}

if (require.main === module) main();

module.exports = { buildUrl, signPublicRequest, AUTH_PATH, BASE_URL };
