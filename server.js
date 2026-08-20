/**
 * 进销存管理系统 - 后端服务
 * 
 * 功能模块：
 * 1. 认证与权限管理
 * 2. 系统管理（国家/仓库/供应商/货代/币种/汇率/付款条件/审批流/费用类型/分摊规则/系统配置）
 * 3. SKU 主数据
 * 4. 库存管理（导入/总表）
 * 5. 出库数据
 * 6. 订单预测/补货建议
 * 7. PO 管理
 * 8. PI 管理
 * 9. CI/PL 管理
 * 10. 物流/货代管理
 * 11. 入库管理
 * 12. 成本管理（分摊/加权平均成本）
 * 13. 付款管理
 * 14. 库存盘点
 * 15. 呆滞库存分析
 * 16. 货代分析
 * 17. 首页看板
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { query, queryOne, run, transaction, genId, initDatabase } = require('./db');
const { withGenerateClient, withAsyncPoolClient } = require('./pg-async'); // 专用异步 Pool：generate / 销售导入库存重算不阻塞主线程
const {
  createSqliteSalesImportAdapter,
  createPostgresSalesImportAdapter,
  createSalesImportRunStore,
  previewSalesImport,
  executeSalesImport
} = require('./sales-import-service');
const {
  LANGUAGE_COOKIE_NAME,
  normalizeLanguage,
  resolveRequestLanguage,
  localizeResponseBody,
  notifyT,
  forecastDisplayT,
  paymentBusinessTypeLabel,
  listingStatusLabel,
  logisticsDisplayStatusLabel,
  countryLabel
} = require('./server-i18n');

// ==================== AUTH-FEISHU-CORE 配置与工具 ====================
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_REDIRECT_URI = process.env.FEISHU_REDIRECT_URI || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== 'false' : true;
const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || '12', 10);
const SESSION_TTL_SECONDS = (isNaN(SESSION_TTL_HOURS) ? 12 : SESSION_TTL_HOURS) * 3600;
// 30 天免登录（remember-me）：可用 REMEMBER_ME_DAYS 环境变量覆盖
const REMEMBER_ME_DAYS = parseInt(process.env.REMEMBER_ME_DAYS || '30', 10);
const REMEMBER_ME_MS = (isNaN(REMEMBER_ME_DAYS) ? 30 : REMEMBER_ME_DAYS) * 24 * 3600 * 1000;
const BREAKGLASS_ADMIN_PASSWORD = process.env.BREAKGLASS_ADMIN_PASSWORD || '';
const TRUSTED_ORIGINS = (process.env.TRUSTED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const NODE_ENV = process.env.NODE_ENV || '';
// 飞书 mock 仅允许测试环境；非 test 环境绝不允许通过 FEISHU_MOCK 启用 mock（fail-closed 拒绝启动）
if (NODE_ENV !== 'test' && process.env.FEISHU_MOCK === '1') {
  throw new Error('[AUTH] FEISHU_MOCK=1 仅在测试环境(NODE_ENV=test)允许；非测试环境启用飞书 mock 被拒绝启动(fail-closed)');
}
// CSRF 强制测试开关：仅 NODE_ENV=test 时才可被 CSRF_FORCE=1 显式启用（用于生产等价隔离测试）；
// 其他环境（含 production）绝不允许用 CSRF_FORCE 关闭或绕过 CSRF 防护。
const CSRF_FORCE = process.env.CSRF_FORCE === '1' && NODE_ENV === 'test';
// 正式生产环境(NODE_ENV='production')强制开启 CSRF 且不可关闭；
// test 默认关闭(除非 CSRF_FORCE=1 显式开启)；其余环境保留 CSRF_DISABLE 逃生舱。
const CSRF_DISABLE = (NODE_ENV === 'production') ? false
  : (NODE_ENV === 'test') ? !CSRF_FORCE
  : (process.env.CSRF_DISABLE === 'true');
const SESSION_COOKIE_NAME = 'session_token';
const PERSISTENT_COOKIE_NAME = 'remember_token';

// 公共鉴权免拦截前缀（登录/OAuth/登出/健康检查）
const PUBLIC_AUTH_PREFIXES = [
  '/api/auth/feishu/login',
  '/api/auth/feishu/callback',
  '/api/auth/feishu/status',
  '/api/auth/local/login',
  '/api/logout',
  '/api/health',
  '/api/version'
];
function reqPath(req) { return (req.originalUrl || req.url || '').split('?')[0]; }

// --- 密码哈希（仅 break-glass 本地管理员，scrypt）---
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return 'scrypt$v1$16384$8$1$' + salt.toString('hex') + '$' + hash.toString('hex');
}
function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string' || stored.indexOf('scrypt$v1$') !== 0) return false;
  const parts = stored.split('$');
  if (parts.length < 7) return false;
  const salt = Buffer.from(parts[5], 'hex');
  const expected = Buffer.from(parts[6], 'hex');
  let actual;
  try { actual = crypto.scryptSync(plain, salt, 64); } catch (e) { return false; }
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}
function isStrongPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 12) return false;
  if (!/[a-z]/.test(pw)) return false;
  if (!/[A-Z]/.test(pw)) return false;
  if (!/[0-9]/.test(pw)) return false;
  return true;
}

// --- Cookie / Session 工具 ---
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}
function sessionCookieOpts() {
  return { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_SECONDS * 1000 };
}
function persistentCookieOpts() {
  return { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'Lax', path: '/', maxAge: REMEMBER_ME_MS };
}
function languageCookieOpts() {
  return { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'Lax', path: '/', maxAge: 365 * 24 * 3600 * 1000 };
}
function genSessionToken() { return crypto.randomBytes(32).toString('hex'); }
function createSessionForUser(res, user, userAgent, ip) {
  const token = genSessionToken();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const sessionId = genId('sess');
  try {
    run("DELETE FROM sessions WHERE expires_at < datetime('now')");
    const count = queryOne('SELECT COUNT(*) AS c FROM sessions WHERE user_id=?', [user.id]);
    if (count && count.c >= 10) {
      run("DELETE FROM sessions WHERE user_id=? AND id IN (SELECT id FROM sessions WHERE user_id=? ORDER BY created_at ASC LIMIT ?)",
        [user.id, user.id, count.c - 9]);
    }
  } catch (e) {}
  run('INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, user_agent, ip_address) VALUES (?,?,?,?,?,?,?)',
    [sessionId, tokenHash, user.id, now, expires, userAgent || '', ip || '']);
  run("UPDATE users SET last_login_at=? WHERE id=?", [now, user.id]);
  // 签发 30 天 remember 凭证（免登录机制）；同时覆盖飞书与 break-glass 本地登录
  mintPersistentLogin(res, user, userAgent, ip);
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOpts());
  return queryOne('SELECT * FROM sessions WHERE id=?', [sessionId]);
}

// --- 长期 remember 凭证（30 天免登录）---
// 签发 30 天 remember 凭证：写入 persistent_logins（token 哈希存储）+ 下发 HttpOnly cookie
function mintPersistentLogin(res, user, userAgent, ip) {
  const token = genSessionToken();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + REMEMBER_ME_MS).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  try {
    run("DELETE FROM persistent_logins WHERE expires_at < datetime('now')");
    const count = queryOne('SELECT COUNT(*) AS c FROM persistent_logins WHERE user_id=?', [user.id]);
    if (count && count.c >= 5) {
      run("DELETE FROM persistent_logins WHERE user_id=? AND id IN (SELECT id FROM persistent_logins WHERE user_id=? ORDER BY created_at ASC LIMIT ?)",
        [user.id, user.id, count.c - 4]);
    }
  } catch (e) {}
  // INSERT 也包裹 try/catch：表不存在或其他异常时不应阻断登录流程（remember-me 是 best-effort）
  try {
    run('INSERT INTO persistent_logins (id, token_hash, user_id, created_at, expires_at, user_agent, ip_address, revoked) VALUES (?,?,?,?,?,?,?,0)',
      [genId('pl'), tokenHash, user.id, now, expires, userAgent || '', ip || '']);
    res.cookie(PERSISTENT_COOKIE_NAME, token, persistentCookieOpts());
  } catch (e) {
    console.warn('[AUTH] mintPersistentLogin INSERT failed (non-fatal, login continues):', e.message);
  }
}
// 长期 remember 凭证自动恢复：有效则重建短期 session 并返回该行，否则 null
function tryRestoreFromPersistent(req, res) {
  const pToken = parseCookies(req)[PERSISTENT_COOKIE_NAME];
  if (!pToken) return null;
  const pHash = crypto.createHash('sha256').update(pToken).digest('hex');
  let row;
  try {
    row = queryOne("SELECT * FROM persistent_logins WHERE token_hash=? AND expires_at > datetime('now') AND revoked=0", [pHash]);
  } catch (e) {
    // 表不存在或其他异常时静默降级（不阻断正常请求）
    return null;
  }
  if (!row) return null;
  const user = queryOne('SELECT * FROM users WHERE id=?', [row.user_id]);
  if (!user || user.status === 'disabled') return null;
  const sess = createSessionForUser(res, user, req.headers['user-agent'], req.headers['x-forwarded-for'] || req.ip);
  try { run("UPDATE persistent_logins SET last_used_at=? WHERE id=?", [new Date().toISOString(), row.id]); } catch (e) {}
  return sess;
}

// --- 登录审计 ---
function auditLogin(userId, username, authSource, success, failReason, userAgent, ip) {
  try {
    run('INSERT INTO login_audit (id, user_id, username, auth_source, success, fail_reason, ip, user_agent, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [genId('la'), userId || null, username || '', authSource || '', success ? 1 : 0, failReason || '', ip || '', userAgent || '', new Date().toISOString()]);
  } catch (e) {}
}

// --- 飞书 OAuth 身份交换（test 环境使用内存 mock，绝不触真实飞书）---
async function exchangeFeishuCode(code) {
  if (process.env.NODE_ENV === 'test' && global.__FEISHU_TEST__) {
    const t = global.__FEISHU_TEST__;
    if (t.failExchange) throw new Error('mock: code exchange failed');
    return t.userinfo;
  }
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET || !code) throw new Error('飞书配置或 code 缺失');
  // Web 应用授权码流程：以 client_id + client_secret 直接换取 user_access_token（无需 app_access_token 层）
  const tokenResp = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: FEISHU_APP_ID,
      client_secret: FEISHU_APP_SECRET,
      code,
      redirect_uri: FEISHU_REDIRECT_URI
    })
  });
  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token || (tokenData.data && tokenData.data.access_token);
  if (!accessToken) throw new Error('获取 user_access_token 失败: ' + (tokenData.msg || tokenData.code || 'unknown'));
  // Web 应用流程 user_info 端点（响应包在 data 内）
  const infoResp = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    method: 'GET', headers: { Authorization: 'Bearer ' + accessToken }
  });
  const infoData = await infoResp.json();
  const info = infoData.data || infoData;
  return {
    open_id: info.open_id, union_id: info.union_id, user_id: info.user_id,
    name: info.name, email: info.email || '', mobile: info.mobile || '', avatar: info.avatar_url || info.avatar || ''
  };
}

// ==================== FEISHU-NOTIFY-01：应用级通知能力（复用同一独立飞书应用 FEISHU_APP_ID/SECRET） ====================
// 与登录链路隔离：登录用 user_access_token；通知用 tenant_access_token（应用级）。token 仅进程内存缓存，不落库。
let __feishuTenantToken = null;
let __feishuTenantTokenExpireAt = 0;
const __feishuDryRunLog = []; // 仅测试/演练模式（NODE_ENV=test 或 FEISHU_NOTIFY_DRYRUN=1）记录 payload；生产恒为空且不可经接口读出

// 获取应用级 tenant_access_token（带内存缓存，提前 5 分钟过期刷新）
async function getFeishuTenantToken() {
  if (__feishuTenantToken && Date.now() < __feishuTenantTokenExpireAt) return __feishuTenantToken;
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) throw new Error('飞书应用配置缺失（FEISHU_APP_ID/FEISHU_APP_SECRET）');
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET })
  });
  const data = await resp.json();
  const token = data.tenant_access_token || (data.data && data.data.tenant_access_token);
  if (!token) throw new Error('获取 tenant_access_token 失败: ' + (data.msg || data.code || 'unknown'));
  const ttl = (Number(data.expire) || 7200) - 300;
  __feishuTenantToken = token;
  __feishuTenantTokenExpireAt = Date.now() + ttl * 1000;
  return token;
}

// 发送文本消息到指定 open_id。best-effort：测试/演练模式只记录不真实发送；真实模式带 5s 超时。
// 从卡片反推纯文本（用于飞书 extErrCode=200621 临时降级）。仅取 header.title 与 div fields；跳过 button/action 段。
// 飞书 2026 偶发隐性卡片 schema 校验收紧导致所有 interactive 卡片 230099-200621，text 链路不受影响，自动降级可恢复业务可达性。
function cardToFallbackText(card) {
  if (!card || typeof card !== 'object') return '';
  const lines = [];
  if (card.header && card.header.title && card.header.title.content) lines.push(String(card.header.title.content));
  const elements = Array.isArray(card.elements) ? card.elements : [];
  for (const el of elements) {
    if (!el || el.tag !== 'div') continue;
    const fields = Array.isArray(el.fields) ? el.fields : [];
    for (const f of fields) {
      const c = f && f.text && f.text.content;
      if (!c) continue;
      const m = c.match(/^\*\*(.+?)\*\*\n([\s\S]+)$/);
      lines.push(m ? (m[1] + ': ' + m[2]) : c);
    }
  }
  return lines.join('\n');
}

// 通用飞书消息发送：支持 open_id（个人）与 chat_id（群）。best-effort：测试/演练模式只记录不真实发送。
// 抽象为统一出口 sendFeishuRaw（msgType + contentObj），text / interactive 共用同一 token、超时与 dry-run 逻辑。
// 卡片场景下若飞书返回 extErrCode=200621 (parse card json err)，自动以 cardToFallbackText 构造的纯文本走 text 通道同 receive_id 重发，确保运营可达；后续若飞书侧恢复，自动走回卡片（无需改动）。
async function sendFeishuRaw(receiveId, receiveIdType, msgType, contentObj) {
  if (process.env.NODE_ENV === 'test' || process.env.FEISHU_NOTIFY_DRYRUN === '1' || process.env.FEISHU_NOTIFY_FORCE_FAIL === '1') {
    __feishuDryRunLog.push({ open_id: receiveId, receive_id_type: receiveIdType, msg_type: msgType, content: contentObj, at: new Date().toISOString(), forced_fail: process.env.FEISHU_NOTIFY_FORCE_FAIL === '1' });
    if (process.env.FEISHU_NOTIFY_FORCE_FAIL === '1') throw new Error('forced feishu failure (test)');
    return { dryrun: true, receive_id: receiveId, receive_id_type: receiveIdType };
  }
  if (!receiveId) throw new Error('receive_id 为空');
  const token = await getFeishuTenantToken();
  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=' + receiveIdType, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ receive_id: receiveId, msg_type: msgType, content: JSON.stringify(contentObj) }),
    signal: AbortSignal.timeout(5000)
  });
  let data = await resp.json();
  // 卡片隐性故障 fallback：仅当 msgType=interactive 且飞书返回 parse card json err/200621 时降级为文本（text 链路不受影响）。
  if (data.code !== 0 && msgType === 'interactive' && /200621|parse card json/.test(String(data.msg || ''))) {
    const card = contentObj && contentObj.card;
    const fallbackText = card ? cardToFallbackText(card) : '';
    if (fallbackText) {
      try {
        const resp2 = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=' + receiveIdType, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ receive_id: receiveId, msg_type: 'text', content: JSON.stringify({ text: fallbackText }) }),
          signal: AbortSignal.timeout(5000)
        });
        const data2 = await resp2.json();
        if (data2 && data2.code === 0) {
          console.warn('[FEISHU-NOTIFY] 卡片降级为文本发送成功 (200621 fallback) receive_id=' + receiveId + ' type=' + receiveIdType + ' text_len=' + fallbackText.length);
          return data2;
        }
        console.warn('[FEISHU-NOTIFY] 卡片降级为文本发送仍失败 receive_id=' + receiveId + ' type=' + receiveIdType + ' code=' + (data2 && data2.code) + ' msg=' + (data2 && data2.msg));
      } catch (e2) {
        console.warn('[FEISHU-NOTIFY] 卡片降级文本重发异常 receive_id=' + receiveId + ' type=' + receiveIdType + ':', e2.message);
      }
    }
    // 降级失败也要回报原始卡片错误（不要吞掉卡片问题），便于定位
    throw new Error('飞书消息发送失败: ' + (data.msg || data.code || 'unknown') + ' (card fallback attempted)');
  }
  if (data.code !== 0) throw new Error('飞书消息发送失败: ' + (data.msg || data.code || 'unknown'));
  return data;
}

async function sendFeishuMessage(receiveId, receiveIdType, text) {
  return sendFeishuRaw(receiveId, receiveIdType, 'text', { text });
}

// 飞书 interactive card 发送（Listing 通知升级卡片展示）。与文本共用同一出口，权限无需新增。
async function sendFeishuInteractive(receiveId, receiveIdType, card) {
  return sendFeishuRaw(receiveId, receiveIdType, 'interactive', { card });
}

async function sendFeishuTextMessage(openId, text) {
  return sendFeishuMessage(openId, 'open_id', text);
}

// 飞书群通知（可选）：按群语言分别发送中/英正文；FEISHU_GROUP_CHAT_IDS（中文群）与 FEISHU_GROUP_CHAT_IDS_EN（英文群）均为空则跳过。
// 完全向后兼容（不配置英文群 env 即等同旧行为），不影响个人通知（个人按收件人 language_preference 各自语言）。
// 机器人需被加入对应群；复用现有 tenant token 与 im:message:send_as_bot 权限。
async function notifyFeishuGroups(zhText, enText) {
  const zhIds = (process.env.FEISHU_GROUP_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const enIds = (process.env.FEISHU_GROUP_CHAT_IDS_EN || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const chatId of zhIds) {
    try { await sendFeishuMessage(chatId, 'chat_id', zhText); }
    catch (e) { console.error('[FEISHU-NOTIFY] 群通知(中文)发送失败 chat_id=' + chatId + ':', e.message); }
  }
  for (const chatId of enIds) {
    try { await sendFeishuMessage(chatId, 'chat_id', enText); }
    catch (e) { console.error('[FEISHU-NOTIFY] 群通知(英文)发送失败 chat_id=' + chatId + ':', e.message); }
  }
}

// 飞书群卡片通知（可选）：与 notifyFeishuGroups 同源群配置（中文群/英文群），发送 interactive card；两 env 均空则跳过。
async function notifyFeishuGroupsCard(zhCard, enCard) {
  const zhIds = (process.env.FEISHU_GROUP_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const enIds = (process.env.FEISHU_GROUP_CHAT_IDS_EN || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const chatId of zhIds) {
    try { await sendFeishuInteractive(chatId, 'chat_id', zhCard); }
    catch (e) { console.error('[FEISHU-NOTIFY] 群通知(中文)卡片发送失败 chat_id=' + chatId + ':', e.message); }
  }
  for (const chatId of enIds) {
    try { await sendFeishuInteractive(chatId, 'chat_id', enCard); }
    catch (e) { console.error('[FEISHU-NOTIFY] 群通知(英文)卡片发送失败 chat_id=' + chatId + ':', e.message); }
  }
}

// Listing 上架准备通知：运营可读正文构造（物流批次/品牌/国家/仓库/货物信息/关联CI/当前负责人）
// 个人通知（owner_added / manual_reminder）与群通知共用同一份 ctx 与同一正文模板，保证信息一致。
// lang: 'zh' | 'en'；mode: 'manual'（手动提醒/创建同步）| 'owner_added'（编辑新增负责人）。
// 群通知按群语言分别构造中文/英文正文，个人通知按收件人 language_preference 走同一函数，互不干扰。
const LISTING_BLOCK_FIELDS = {
  zh: { batch: '物流批次', brand: '品牌', country: '国家', warehouse: '仓库', cargo: '货物信息', cartons: '总箱数', weight: '总重量', cbm: '总体积', ci: '关联CI', owners: '当前负责人', cartonUnit: '箱', weightUnit: 'KG', cbmUnit: 'CBM' },
  en: { batch: 'Logistics Batch', brand: 'Brand', country: 'Country', warehouse: 'Warehouse', cargo: 'Cargo Info', cartons: 'Total Cartons', weight: 'Total Weight', cbm: 'Total Volume', ci: 'Related CI', owners: 'Current Owners', cartonUnit: 'ctns', weightUnit: 'KG', cbmUnit: 'CBM' }
};
const LISTING_BLOCK_I18N = {
  zh: {
    manual: { title: '📦 上架准备提醒', footer: '请关注该物流单进度' },
    owner_added: { title: '📦 上架准备提醒', footer: '你已被加入该物流单负责人' },
    created: { title: '📦 上架准备提醒', footer: '新的物流单已创建，请开始上架准备' }
  },
  en: {
    manual: { title: '📦 Listing Preparation Reminder', footer: 'Please follow up on the progress of this batch.' },
    owner_added: { title: '📦 Listing Preparation Reminder', footer: 'You have been added as an owner of this logistics batch.' },
    created: { title: '📦 Listing Preparation Reminder', footer: 'A new logistics batch has been created. Please start the listing preparation.' }
  }
};
function buildListingNotifyBlock(batchNo, ctx, lang, mode) {
  const L = (LISTING_BLOCK_I18N[lang] && LISTING_BLOCK_I18N[lang][mode]) ? LISTING_BLOCK_I18N[lang][mode] : LISTING_BLOCK_I18N.zh.manual;
  const F = LISTING_BLOCK_FIELDS[lang] || LISTING_BLOCK_FIELDS.zh;
  const brand = (ctx && ctx.brand) || '-';
  const country = (ctx && ctx.country) || '-';
  const warehouse = (ctx && ctx.warehouse) || '-';
  const cartons = (ctx && typeof ctx.total_cartons !== 'undefined') ? (ctx.total_cartons || 0) : '-';
  const weight = (ctx && typeof ctx.total_weight !== 'undefined') ? (ctx.total_weight || 0) : '-';
  const cbm = (ctx && typeof ctx.total_cbm !== 'undefined') ? (ctx.total_cbm || 0) : '-';
  const ci = (ctx && ctx.related_ci) || '-';
  const owners = (ctx && ctx.current_owners) || '-';
  return L.title + '\n\n'
    + F.batch + '：\n' + (batchNo || '-')
    + '\n\n' + F.brand + '：\n' + brand
    + '\n\n' + F.country + '：\n' + country
    + '\n\n' + F.warehouse + '：\n' + warehouse
    + '\n\n' + F.cargo + '：\n' + F.cartons + '：' + cartons + ' ' + F.cartonUnit + '\n' + F.weight + '：' + weight + ' ' + F.weightUnit + '\n' + F.cbm + '：' + cbm + ' ' + F.cbmUnit
    + '\n\n' + F.ci + '：\n' + ci
    + '\n\n' + F.owners + '：\n' + owners
    + '\n\n' + L.footer;
}
// 同时构造中/英两份上架准备正文（群通知按群语言分别发送；个人通知走 notifyBusinessParticipants 按收件人语言）
function buildListingNotifyTexts(batchNo, ctx) {
  return {
    zh: buildListingNotifyBlock(batchNo, ctx, 'zh', 'manual'),
    en: buildListingNotifyBlock(batchNo, ctx, 'en', 'manual')
  };
}

// Listing 上架通知 interactive card（飞书卡片）。与 buildListingNotifyBlock 同源 ctx，字段完全一致：
// Logistics Batch / Brand / Country / Warehouse / Cargo Info(总箱数·总重量·总体积) / Related CI / Current Owners / Current Status。
// 国家按 lang 调 countryLabel（中文明文、英文 Indonesia），状态按 lang 调 listingStatusLabel（不显示 DB 原值）。
// 底部 View Logistics Detail 按钮：仅当 APP_BASE_URL 配置时生成（不硬编码域名；未配置则卡片不含按钮，URL 用内部 id 深链 ?page=logistics&batch=<id>）。
// statusChange（可选）：状态变化通知专用，{ statusType: 'logistics'|'listing', oldStatus: <展示键>, newStatus: <展示键> }。
// 提供时，「当前状态」字段与新增的 Status Update 段都展示本次变化的（物流展示状态或上架状态），并按 lang 输出对应语言。
function buildListingNotifyCard(batchNo, ctx, lang, mode, statusChange) {
  const L = (LISTING_BLOCK_I18N[lang] && LISTING_BLOCK_I18N[lang][mode]) ? LISTING_BLOCK_I18N[lang][mode] : LISTING_BLOCK_I18N.zh.manual;
  const F = LISTING_BLOCK_FIELDS[lang] || LISTING_BLOCK_FIELDS.zh;
  const statusField = (lang === 'zh') ? '当前状态' : 'Current Status';
  const brand = (ctx && ctx.brand) || '-';
  const country = (ctx && ctx.country) ? countryLabel(lang, ctx.country) : '-';
  const warehouse = (ctx && ctx.warehouse) || '-';
  const cartons = (ctx && typeof ctx.total_cartons !== 'undefined') ? (ctx.total_cartons || 0) : '-';
  const weight = (ctx && typeof ctx.total_weight !== 'undefined') ? (ctx.total_weight || 0) : '-';
  const cbm = (ctx && typeof ctx.total_cbm !== 'undefined') ? (ctx.total_cbm || 0) : '-';
  const ci = (ctx && ctx.related_ci) || '-';
  const owners = (ctx && ctx.current_owners) || '-';
  let statusValue;
  if (statusChange) {
    statusValue = (statusChange.statusType === 'logistics')
      ? logisticsDisplayStatusLabel(lang, statusChange.newStatus)
      : listingStatusLabel(lang, statusChange.newStatus);
  } else {
    statusValue = (ctx && typeof ctx.listing_status !== 'undefined') ? listingStatusLabel(lang, ctx.listing_status) : '-';
  }
  const fields = [
    { is_short: false, text: { tag: 'lark_md', content: '**' + F.batch + '**\n' + (batchNo || '-') } },
    { is_short: true, text: { tag: 'lark_md', content: '**' + F.brand + '**\n' + brand } },
    { is_short: true, text: { tag: 'lark_md', content: '**' + F.country + '**\n' + country } },
    { is_short: true, text: { tag: 'lark_md', content: '**' + F.warehouse + '**\n' + warehouse } },
    { is_short: true, text: { tag: 'lark_md', content: '**' + F.cartons + '**\n' + cartons + ' ' + F.cartonUnit } },
    { is_short: true, text: { tag: 'lark_md', content: '**' + F.weight + '**\n' + weight + ' ' + F.weightUnit } },
    { is_short: true, text: { tag: 'lark_md', content: '**' + F.cbm + '**\n' + cbm + ' ' + F.cbmUnit } },
    { is_short: true, text: { tag: 'lark_md', content: '**' + F.ci + '**\n' + ci } },
    { is_short: false, text: { tag: 'lark_md', content: '**' + F.owners + '**\n' + owners } },
    { is_short: true, text: { tag: 'lark_md', content: '**' + statusField + '**\n' + statusValue } }
  ];
  const elements = [{ tag: 'div', fields: fields }];
  if (statusChange) {
    const prevLabel = (lang === 'zh') ? '原状态' : 'Previous Status';
    const currLabel = (lang === 'zh') ? '新状态' : 'Current Status';
    const sectionTitle = (lang === 'zh') ? '状态更新' : 'Status Update';
    const prevVal = (statusChange.statusType === 'logistics')
      ? logisticsDisplayStatusLabel(lang, statusChange.oldStatus)
      : listingStatusLabel(lang, statusChange.oldStatus);
    const currVal = (statusChange.statusType === 'logistics')
      ? logisticsDisplayStatusLabel(lang, statusChange.newStatus)
      : listingStatusLabel(lang, statusChange.newStatus);
    elements.push({
      tag: 'div',
      fields: [
        { is_short: false, text: { tag: 'lark_md', content: '**' + sectionTitle + '**' } },
        { is_short: true, text: { tag: 'lark_md', content: '**' + prevLabel + '**\n' + prevVal } },
        { is_short: true, text: { tag: 'lark_md', content: '**' + currLabel + '**\n' + currVal } }
      ]
    });
  }
  const baseUrl = process.env.APP_BASE_URL;
  if (baseUrl) {
    const url = baseUrl.replace(/\/+$/, '') + '/?page=logistics&batch=' + encodeURIComponent(ctx && ctx.id ? ctx.id : (batchNo || ''));
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: (lang === 'zh' ? '查看物流详情' : 'View Logistics Detail') },
        type: 'primary',
        url: url
      }]
    });
  }
  return {
    config: { wide_screen_mode: true },
    header: { template: 'blue', title: { tag: 'plain_text', content: L.title } },
    elements: elements
  };
}

// 同时构造中/英两份上架准备卡片（群通知按群语言分别发送 interactive card；个人通知由 notifyBusinessParticipants 按收件人语言构造）
function buildListingNotifyCards(batchNo, ctx) {
  return {
    zh: buildListingNotifyCard(batchNo, ctx, 'zh', 'manual'),
    en: buildListingNotifyCard(batchNo, ctx, 'en', 'manual')
  };
}

// 从物流单主表 + 关联 CI 装载上架通知所需的全部运营字段——个人通知与群通知共用的唯一数据源。
// brand 来自 CI，其余来自物流单主表；同时返回 code(批次号) 与 plan_date(eta)，供 notifyBusinessParticipants 定位「物流批次」行。
function loadListingNotifyCtx(batchId) {
  const lbRow = queryOne(
    'SELECT lb.id, lb.batch_no, lb.eta_date, lb.target_country, lb.target_warehouse, lb.total_cartons, lb.total_weight, lb.total_cbm, lb.related_ci_no, lb.listing_owner_ids, lb.listing_status, ci.brand '
    + 'FROM logistics_batches lb LEFT JOIN commercial_invoices ci ON lb.related_ci_id = ci.id WHERE lb.id = ?',
    [batchId]
  );
  if (!lbRow) return null;
  return {
    id: lbRow.id,
    code: lbRow.batch_no || '',
    plan_date: lbRow.eta_date || '',
    brand: lbRow.brand || '-',
    country: lbRow.target_country || '-',
    warehouse: lbRow.target_warehouse || '-',
    total_cartons: lbRow.total_cartons || 0,
    total_weight: lbRow.total_weight || 0,
    total_cbm: lbRow.total_cbm || 0,
    related_ci: lbRow.related_ci_no || '-',
    listing_status: lbRow.listing_status || 'pending_plan',
    current_owners: resolveOwnerNames(splitIdCsv(lbRow.listing_owner_ids)).join('、') || '-'
  };
}

// V1 固定文案模板（不建模板管理）
// I18N-100P-B1：改为按收件人 language_preference 生成三语文本。
// 每个 build 函数接收 (lang, ...动态参数)，内部调用 notifyT 从 NOTIFY_TEMPLATE_CATALOG 取对应语言模板。
// 动态参数（po_no/ci_no/request_no/due_date/amount/level/plan_date）保持原样不翻译。
const FEISHU_NOTIFY_TEMPLATES = {
  submit: (lang, poNo) => notifyT(lang, 'notify.submit', { po_no: poNo }),
  approved_intermediate: (lang, poNo, level) => notifyT(lang, 'notify.approved_intermediate', { po_no: poNo, level: level }),
  approved_final: (lang, poNo) => notifyT(lang, 'notify.approved_final', { po_no: poNo }),
  reject: (lang, poNo) => notifyT(lang, 'notify.reject', { po_no: poNo }),
  ci_ops_assigned: (lang, ciNo, planDate) => planDate
    ? notifyT(lang, 'notify.ci_ops_assigned', { ci_no: ciNo, plan_date: planDate })
    : notifyT(lang, 'notify.ci_ops_assigned_tbd', { ci_no: ciNo }),
  ci_ops_ready: (lang, ciNo) => notifyT(lang, 'notify.ci_ops_ready', { ci_no: ciNo }),
  payment_due: (lang, prNo, dueDate, amt) => notifyT(lang, 'notify.payment_due', { request_no: prNo, due_date: dueDate, amount: amt }),
  payment_overdue: (lang, prNo, dueDate, amt) => notifyT(lang, 'notify.payment_overdue', { request_no: prNo, due_date: dueDate, amount: amt }),

  // LOGISTICS-LISTING 统一通知体系：创建个人通知与手动提醒/编辑增量/群通知共用同一份 ctx 与同一卡片模板（含品牌/国家/仓库/货物信息/关联CI/当前负责人/当前状态），仅 closing line 按 mode 不同（created/owner_added/manual）。返回 interactive card 对象；notifyBusinessParticipants 据此自动走卡片发送，非 listing 模板仍走文本（兼容不破坏）。
  logistics_listing_created: (lang, batchNo, planDate, ctx) => buildListingNotifyCard(batchNo, ctx, lang, 'created'),
  // Listing 编辑增量通知 / 手动提醒专用模板（不依赖 i18n 词条，正文在 server.js 内联构造；第 4 参 ctx 承载 related_ci / current_owners / listing_status）
  logistics_listing_owner_added: (lang, batchNo, planDate, ctx) => buildListingNotifyCard(batchNo, ctx, lang, 'owner_added'),
  logistics_listing_manual_reminder: (lang, batchNo, planDate, ctx) => buildListingNotifyCard(batchNo, ctx, lang, 'manual'),
  // 状态变化通知（物流展示状态 / 上架状态）专用模板：ctx.statusChange 承载 { statusType, oldStatus, newStatus }（均为展示键），卡片据此渲染 Status Update 段。
  // 个人通知由 notifyBusinessParticipants 按收件人语言构造；无 statusChange 时回退为普通手动提醒卡片。
  logistics_listing_status_changed: (lang, batchNo, planDate, ctx) => buildListingNotifyCard(batchNo, ctx, lang, 'manual', (ctx && ctx.statusChange) ? ctx.statusChange : null),
  // 以下两个仅供 scanListingReminders 直接调用（签名为 (lang, batchNo, ctx)），不经 notifyBusinessParticipants。
  logistics_listing_stalled: (lang, batchNo, ctx) => notifyT(lang, 'notify.logistics_listing_stalled', {
    batch_no: batchNo,
    status_label: listingStatusLabel(lang, (ctx && ctx.listing_status) || 'pending_plan'),
    days: (ctx && ctx.days) || 0
  }),
  logistics_listing_eta_due: (lang, batchNo, ctx) => notifyT(lang, 'notify.logistics_listing_eta_due', {
    batch_no: batchNo,
    eta_date: (ctx && ctx.eta_date) || '',
    status_label: listingStatusLabel(lang, (ctx && ctx.listing_status) || 'pending_plan')
  })
};

// LOGISTICS-LISTING-01：Listing 状态机常量（与 db 层 listing_status 取值、server-i18n LISTING_STATUS_LABEL_CATALOG 严格对齐）
// LISTING_TERMINAL：终态，停滞提醒不再打扰。
// LISTING_ETA_SAFE：达到这些状态即视为"已准备完成/已上架"，ETA 临近提醒放行。
const LISTING_STATUSES = ['pending_plan', 'preparing', 'ready', 'listed'];
const LISTING_TERMINAL = ['listed'];
const LISTING_ETA_SAFE = ['ready', 'listed'];
const LISTING_STALL_DAYS = 2;   // 需求：物流单创建后 2 天上架状态仍未更新即提醒
const LISTING_ETA_LEAD_DAYS = 3; // 需求：预计到货日期前 3 天未达 ready/listed 即催办

// ==================== PAY-CORE Phase 1：approval_records.approvers 快照规范化 ====================
// 老格式（纯数组）→ 包装为 { levels: [...], completion_cc_user_ids: [] }
// 新格式（对象）→ 原样规范化，补齐缺失字段默认值
// 仅用于 Payment 类审批；PO 保持原数组格式，不走此函数（Phase 2 TD）
function normalizeApprovalSnapshot(raw) {
  const empty = { levels: [], completion_cc_user_ids: [] };
  if (!raw) return empty;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return empty; }
  if (parsed === null || parsed === undefined) return empty;
  // 老格式：纯数组
  if (Array.isArray(parsed)) {
    return {
      levels: parsed.map(a => ({
        level: Number(a.level),
        approver_user_id: a.approver_user_id || '',
        approver_name: a.approver_name || '',
        approver_role_id: a.approver_role_id || '',
        cc_user_ids: Array.isArray(a.cc_user_ids) ? a.cc_user_ids : []
      })),
      completion_cc_user_ids: []
    };
  }
  // 新格式：对象
  return {
    levels: Array.isArray(parsed.levels) ? parsed.levels.map(a => ({
      level: Number(a.level),
      approver_user_id: a.approver_user_id || '',
      approver_name: a.approver_name || '',
      approver_role_id: a.approver_role_id || '',
      cc_user_ids: Array.isArray(a.cc_user_ids) ? a.cc_user_ids : []
    })) : [],
    completion_cc_user_ids: Array.isArray(parsed.completion_cc_user_ids) ? parsed.completion_cc_user_ids : []
  };
}

// 审批通知：事务外 best-effort；飞书异常不影响审批结果；仅向有 feishu_open_id 的用户发送；无收件人则静默返回。
// I18N-100P-B1：收件人 Map 存储 { name, lang }，按每位收件人的 language_preference 分别生成对应语言文本。
async function notifyApprovalParticipants(approvalId, eventType, ctx) {
  try {
    const approval = queryOne('SELECT * FROM approval_records WHERE id = ?', [approvalId]);
    if (!approval) return;
    const poNo = (ctx && ctx.po_no) || approval.business_code || '';
    const recipients = new Map(); // open_id -> { name, lang }
    const addUser = (userId) => {
      if (!userId) return;
      const u = queryOne('SELECT id, name, feishu_open_id, language_preference FROM users WHERE id = ?', [userId]);
      if (u && u.feishu_open_id) recipients.set(u.feishu_open_id, { name: u.name || '', lang: normalizeLanguage(u.language_preference) });
    };
    const ccRows = query('SELECT user_id FROM business_participants WHERE business_type=? AND business_id=? AND participant_type=?', ['approval', approvalId, 'cc']).rows;
    for (const r of ccRows) addUser(r.user_id);
    let approvers = [];
    try { approvers = JSON.parse(approval.approvers || '[]'); } catch (e) { approvers = []; }
    if (eventType === 'submit') {
      const first = approvers.find(a => a.level === 1);
      if (first) addUser(first.approver_user_id);
    } else if (eventType === 'approved_intermediate') {
      // 触发本通知时 current_level 已递增到“下一级待审”级次，故直接按该级次定位下一审批人
      const next = approvers.find(a => a.level === (approval.current_level || 1));
      if (next) addUser(next.approver_user_id);
    } else if (eventType === 'approved_final' || eventType === 'reject') {
      addUser(approval.submitter_id);
    }
    if (recipients.size === 0) return;
    const build = FEISHU_NOTIFY_TEMPLATES[eventType];
    for (const [openId, info] of recipients) {
      const text = build ? build(info.lang, poNo, approval.current_level) : notifyT(info.lang, 'notify.submit', { po_no: poNo });
      try { await sendFeishuTextMessage(openId, text); }
      catch (e) { console.error('[FEISHU-NOTIFY] 发送失败 open_id=' + openId + ' event=' + eventType + ':', e.message); }
    }
  } catch (e) {
    console.error('[FEISHU-NOTIFY] 通知流程异常 event=' + eventType + ' approvalId=' + approvalId + ':', e.message);
  }
}

// ==================== PAY-CORE Phase 1：付款审批通知（与 PO 通知解耦） ====================
// 通用 ctx 结构：{ business_no, business_type, business_type_label, amount, currency, applicant, approver, level, remark }
// business_type_label 由 paymentBusinessTypeLabel 按收件人 language_preference 派生，避免硬编码中文。
const PAYMENT_NOTIFY_TEMPLATES = {
  submit: (lang, ctx) => notifyT(lang, 'notify.payment.submit', ctx),
  approved_intermediate: (lang, ctx) => notifyT(lang, 'notify.payment.approved_intermediate', ctx),
  approved_final: (lang, ctx) => notifyT(lang, 'notify.payment.approved_final', ctx),
  reject: (lang, ctx) => notifyT(lang, 'notify.payment.reject', ctx)
};

// 付款审批通知：与 notifyApprovalParticipants 实现对齐，但使用 PAYMENT_NOTIFY_TEMPLATES 与通用 ctx。
// PAY-CORE Phase 1：收件人解析规则改造为按事件类型 + 当前节点从 approval_records.approvers 快照筛选
//   submit → 第 1 级审批人 + 第 1 级节点 CC
//   approved_intermediate → 下一级审批人 + 下一级节点 CC
//   approved_final → 申请人 + 完成 CC
//   reject → 申请人 + 当前节点 CC
// CC 来源：approval_records.approvers 快照（不读 business_participants，不读 approval_flows）
async function notifyPaymentApprovalParticipants(approvalId, eventType, ctx) {
  try {
    const approval = queryOne('SELECT * FROM approval_records WHERE id = ?', [approvalId]);
    if (!approval) return;
    const recipients = new Map(); // open_id -> { name, lang }
    const addUser = (userId) => {
      if (!userId) return;
      const u = queryOne('SELECT id, name, feishu_open_id, language_preference FROM users WHERE id = ?', [userId]);
      if (u && u.feishu_open_id) recipients.set(u.feishu_open_id, { name: u.name || '', lang: normalizeLanguage(u.language_preference) });
    };
    // PAY-CORE Phase 1：使用 normalizeApprovalSnapshot 兼容老数组格式 + 新对象格式
    const snapshot = normalizeApprovalSnapshot(approval.approvers);
    const approvers = snapshot.levels;
    const completionCcUserIds = snapshot.completion_cc_user_ids;

    if (eventType === 'submit') {
      // 提交时：第 1 级审批人 + 第 1 级节点 CC
      const first = approvers.find(a => a.level === 1);
      if (first) {
        addUser(first.approver_user_id);
        (first.cc_user_ids || []).forEach(uid => addUser(uid));
      }
    } else if (eventType === 'approved_intermediate') {
      // 中间级次通过：下一级审批人 + 下一级节点 CC
      // 触发本通知时 current_level 已递增到"下一级待审"级次，故直接按该级次定位下一审批人
      const next = approvers.find(a => a.level === (approval.current_level || 1));
      if (next) {
        addUser(next.approver_user_id);
        (next.cc_user_ids || []).forEach(uid => addUser(uid));
      }
    } else if (eventType === 'approved_final') {
      // 最终完成：申请人 + 完成 CC
      addUser(approval.submitter_id);
      completionCcUserIds.forEach(uid => addUser(uid));
    } else if (eventType === 'reject') {
      // 驳回：申请人 + 当前节点 CC
      addUser(approval.submitter_id);
      const cur = approvers.find(a => a.level === approval.current_level);
      if (cur) (cur.cc_user_ids || []).forEach(uid => addUser(uid));
    }
    if (recipients.size === 0) return;
    const build = PAYMENT_NOTIFY_TEMPLATES[eventType];
    // ctx 中的 business_type_label 按每位收件人语言重派；其他字段保持原值（动态参数不翻译）
    for (const [openId, info] of recipients) {
      const localizedCtx = Object.assign({}, ctx || {}, {
        business_type_label: paymentBusinessTypeLabel(info.lang, (ctx && ctx.business_type) || approval.business_type || ''),
        level: (ctx && typeof ctx.level !== 'undefined') ? ctx.level : (approval.current_level || 1)
      });
      const text = build ? build(info.lang, localizedCtx) : notifyT(info.lang, 'notify.payment.submit', localizedCtx);
      try { await sendFeishuTextMessage(openId, text); }
      catch (e) { console.error('[FEISHU-NOTIFY] 付款审批通知发送失败 open_id=' + openId + ' event=' + eventType + ':', e.message); }
    }
  } catch (e) {
    console.error('[FEISHU-NOTIFY] 付款审批通知流程异常 event=' + eventType + ' approvalId=' + approvalId + ':', e.message);
  }
}

// PAY-CORE Phase 1：payment_requests → business_type 派生函数
// 规则：approval_records.business_type 与 approval_flows.business_type 同名，由 payment_category + payment_subcategory 派生。
// warehouse_arrival 子类归并：freight/customs_clearance/port_charges/delivery → freight；warehouse/other_local → warehouse。
// 未覆盖类型返回 null，调用方据此拒绝提交。
function paymentRequestToBusinessType(pr) {
  // 2026-07-29：所有付款审批统一为一个审批流 business_type='payment'
  // 不再按 payment_category/subcategory/payment_mode 派生不同业务类型
  if (!pr) return null;
  // 只要是有 payment_mode（即付款类申请），统一走 'payment' 审批流
  if (pr.payment_mode || pr.payment_category) return 'payment';
  return null;
}

// PAY-CORE Phase 1 补充：审批流配置权限按 business_type 动态派生
// 规则：po → po_approve；其余 PAY-CORE 业务类型（pi_deposit/ci_balance/freight/warehouse/customs/inspection）→ payment_approve
// 仅用于审批人配置校验与候选人筛选；不影响 approval_flows 表结构，不影响 PO 既有审批流。
function approvalRequiredPermission(businessType) {
  if (businessType === 'po') return 'po_approve';
  // 2026-07-29：所有付款审��统一为 'payment' 业务类型
  if (businessType === 'payment') return 'payment_approve';
  // 兜底：未识别业务类型仍用 po_approve（保持向后兼容）
  return 'po_approve';
}

// PUR-OPS-COLLAB-01：通用业务参与人通知（复用 business_participants，支持 business_type='ci' 等；与审批通知解耦）
// I18N-100P-B1：按收件人 language_preference 分别生成对应语言文本。
async function notifyBusinessParticipants(businessType, businessId, eventType, ctx) {
  try {
    const code = (ctx && ctx.code) || businessId || '';
    const recipients = new Map(); // open_id -> { name, lang }
    const addUser = (userId) => {
      if (!userId) return;
      const u = queryOne('SELECT id, name, feishu_open_id, language_preference FROM users WHERE id = ?', [userId]);
      if (u && u.feishu_open_id) recipients.set(u.feishu_open_id, { name: u.name || '', lang: normalizeLanguage(u.language_preference) });
    };
    const rows = query('SELECT user_id FROM business_participants WHERE business_type=? AND business_id=? AND participant_type IN (?,?)', [businessType, businessId, 'cc', 'owner']).rows;
    for (const r of rows) addUser(r.user_id);
    if (recipients.size === 0) return;
    const build = FEISHU_NOTIFY_TEMPLATES[eventType];
    if (!build) return;
    for (const [openId, info] of recipients) {
      const content = build(info.lang, code, ctx && ctx.plan_date, ctx);
      try {
        // Listing 卡片模板返回 object（interactive card），其余模板返回 string（文本），自动分流，互不干扰
        if (content && typeof content === 'object') await sendFeishuInteractive(openId, 'open_id', content);
        else await sendFeishuTextMessage(openId, content);
      }
      catch (e) { console.error('[FEISHU-NOTIFY] 发送失败 open_id=' + openId + ' event=' + eventType + ':', e.message); }
    }
  } catch (e) {
    console.error('[FEISHU-NOTIFY] 业务通知异常 event=' + eventType + ' businessType=' + businessType + ' businessId=' + businessId + ':', e.message);
  }
}

// Listing 编辑增量通知：仅通知「新增」的上架负责人与抄送人，避免每次普通编辑都打扰。
// 模板 logistics_listing_owner_added（正文明确"你已被加入"，仅发给新增人员，不重复打扰既有负责人/CC）。
async function notifyListingDelta(batchId, batchNo, addedOwnerIds, addedCcIds, planDate) {
  try {
    const recipients = new Map(); // open_id -> { name, lang }
    const addUser = (userId) => {
      if (!userId) return;
      const u = queryOne('SELECT id, name, feishu_open_id, language_preference FROM users WHERE id = ?', [userId]);
      if (u && u.feishu_open_id) recipients.set(u.feishu_open_id, { name: u.name || '', lang: normalizeLanguage(u.language_preference) });
    };
    (addedOwnerIds || []).forEach(addUser);
    (addedCcIds || []).forEach(addUser);
    if (recipients.size === 0) return;
    const build = FEISHU_NOTIFY_TEMPLATES['logistics_listing_owner_added'];
    if (!build) return;
    // 关联CI + 当前上架负责人 + 品牌/国家/仓库/货物信息（用于正文展示），从物流单主表 + 关联 CI 读取
    const ctx = loadListingNotifyCtx(batchId);
    for (const [openId, info] of recipients) {
      const content = build(info.lang, batchNo, planDate, ctx);
      try {
        if (content && typeof content === 'object') await sendFeishuInteractive(openId, 'open_id', content);
        else await sendFeishuTextMessage(openId, content);
      }
      catch (e) { console.error('[FEISHU-NOTIFY] 物流编辑增量通知失败 open_id=' + openId + ' batch=' + batchId + ':', e.message); }
    }
  } catch (e) {
    console.error('[FEISHU-NOTIFY] 物流编辑增量通知异常 batch=' + batchId + ':', e.message);
  }
}

// 状态变化通知（物流展示状态 / 上架状态）：统一处理个人（上架负责人 + CC）与中文群/英文群。
// 入参 oldStatus/newStatus 为底层枚举值；内部先派生成「业务展示状态」再比较 —— 展示状态未变（如 arrived→customs 同属清关中）则不通知。
// statusType='logistics' → 用 deriveLogisticsDisplayStatus 派生展示桶；statusType='listing' → 直接用 listing_status 原值（其本身即展示状态）。
async function notifyListingStatusChanged(batchId, oldStatus, newStatus, statusType) {
  try {
    const ctx = loadListingNotifyCtx(batchId);
    if (!ctx) return;
    let oldDisplay, newDisplay;
    if (statusType === 'logistics') {
      oldDisplay = deriveLogisticsDisplayStatus(oldStatus || '');
      newDisplay = deriveLogisticsDisplayStatus(newStatus || '');
    } else {
      oldDisplay = oldStatus || '';
      newDisplay = newStatus || '';
    }
    if (oldDisplay === newDisplay) return; // 展示状态未变不通知（避免 arrived→customs 等底层枚举变化误触发）
    // 把变化上下文挂到 ctx，供个人卡片模板（logistics_listing_status_changed）渲染 Status Update 段
    ctx.statusChange = { statusType, oldStatus: oldDisplay, newStatus: newDisplay };
    // 个人通知：上架负责人 + 抄送（business_participants business_type='logistics'），按各自 language_preference 语言
    notifyBusinessParticipants('logistics', batchId, 'logistics_listing_status_changed', ctx).catch(() => {});
    // 群通知：中文群 / 英文群 分别发送中/英卡片（APP_BASE_URL 未配置时卡片不含按钮，由 buildListingNotifyCard 内部处理）
    const zhCard = buildListingNotifyCard(ctx.code, ctx, 'zh', 'manual', ctx.statusChange);
    const enCard = buildListingNotifyCard(ctx.code, ctx, 'en', 'manual', ctx.statusChange);
    notifyFeishuGroupsCard(zhCard, enCard).catch(() => {});
  } catch (e) {
    console.error('[FEISHU-NOTIFY] 状态变化通知异常 batch=' + batchId + ' statusType=' + statusType + ':', e.message);
  }
}

// ③ 应付到期/逾期提醒扫描（仅 server.js；复用 sendFeishuTextMessage；best-effort；不改付款状态）
// 收件人 = 具 payment_approve 权限的 active 用户（有 feishu_open_id）+ business_participants(payment_reminder) CC
// 去重 = 复用 remind_date 作"最后一次提醒日期"哨兵；同一天同一付款申请不重复发送
// I18N-100P-B1：按收件人 language_preference 分别生成对应语言文本。
async function scanPaymentReminders() {
  const result = { due_count: 0, overdue_count: 0, sent_count: 0, skipped: 0 };
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const d7 = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

    // 收件人：具 payment_approve 权限的 active 用户
    const recipients = new Map(); // open_id -> { name, lang }
    const addUser = (userId) => {
      if (!userId) return;
      const u = queryOne('SELECT id, name, feishu_open_id, status, language_preference FROM users WHERE id = ?', [userId]);
      if (u && u.feishu_open_id && u.status === 'active') recipients.set(u.feishu_open_id, { name: u.name || '', lang: normalizeLanguage(u.language_preference) });
    };
    const financeUsers = query(`SELECT u.id, r.permissions AS role_permissions FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.status = 'active'`).rows;
    for (const fu of financeUsers) {
      let perms = [];
      try { perms = perms.concat(JSON.parse(fu.role_permissions || '[]')); } catch (e) {}
      if (perms.includes('payment_approve') || perms.includes('*')) addUser(fu.id);
    }

    // 待提醒付款申请：逾期 或 7 日内到期，且今日未提醒
    const rows = query(`SELECT * FROM payment_requests WHERE approval_status IN ('pending','approved') AND payment_status NOT IN ('paid','deduction_settled','rejected','cancelled') AND unpaid_amount > 0 AND payable_date != '' AND remind_date != ? AND (payable_date < ? OR payable_date <= ?) ORDER BY payable_date ASC`, [today, today, d7]).rows;
    for (const pr of rows) {
      const isOverdue = pr.payable_date < today;
      result[isOverdue ? 'overdue_count' : 'due_count'] += 1;
      // CC（business_participants payment_reminder）
      const ccRows = query('SELECT user_id FROM business_participants WHERE business_type=? AND business_id=? AND participant_type=?', ['payment_reminder', pr.id, 'cc']).rows;
      for (const r of ccRows) addUser(r.user_id);
      if (recipients.size === 0) { result.skipped += 1; continue; }
      const amt = (pr.rmb_amount || pr.unpaid_amount || 0);
      let sentAny = false;
      for (const [openId, info] of recipients) {
        const text = isOverdue
          ? FEISHU_NOTIFY_TEMPLATES.payment_overdue(info.lang, pr.request_no, pr.payable_date, amt)
          : FEISHU_NOTIFY_TEMPLATES.payment_due(info.lang, pr.request_no, pr.payable_date, amt);
        try { await sendFeishuTextMessage(openId, text); sentAny = true; }
        catch (e) { console.error('[FEISHU-NOTIFY] 付款提醒发送失败 open_id=' + openId + ' pr=' + pr.id + ':', e.message); }
      }
      if (sentAny) {
        run('UPDATE payment_requests SET remind_date = ? WHERE id = ?', [today, pr.id]);
        result.sent_count += 1;
      }
    }
  } catch (e) {
    console.error('[FEISHU-NOTIFY] 付款提醒扫描异常:', e.message);
  }
  return result;
}

// LOGISTICS-LISTING-01：DB 时间串 → 毫秒。
// 库内时间统一为 UTC（SQLite datetime('now') 与 new Date().toISOString() 均为 UTC），
// 'YYYY-MM-DD HH:MM:SS' 无时区后缀，需显式补 Z，否则 V8 会按本地时区解析而产生 8 小时偏差。
function parseDbTimeMs(s) {
  if (!s) return 0;
  const str = String(s).trim();
  const norm = str.includes('T') ? str : str.replace(' ', 'T');
  const withZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(norm) ? norm : norm + 'Z';
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? 0 : ms;
}

// LOGISTICS-LISTING-01（2026-08-07 调整）：owner 多选，listing_owner_ids 为逗号分隔多 ID。
function splitIdCsv(s) {
  if (!s) return [];
  return String(s).split(',').map(x => String(x).trim()).filter(Boolean);
}
// LOGISTICS-LISTING-01（2026-08-07 修复）：批量解析 owner 姓名，仅一次查询，消除 N+1 连接风暴。
// 返回 id -> name 的映射，供列表/详情/创建/编辑统一回填。
function resolveOwnerNameMap(idList) {
  const ids = Array.from(new Set((idList || []).map(x => String(x).trim()).filter(Boolean)));
  const map = {};
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = query(`SELECT id, name FROM users WHERE id IN (${placeholders})`, ids).rows;
  rows.forEach(u => { map[String(u.id)] = u.name; });
  return map;
}
function namesFromMap(oids, map) {
  return (oids || []).map(id => (map[String(id)] != null ? map[String(id)] : id));
}
// 兼容单批调用（详情/创建返回/编辑留痕）；内部仍是单次批量查询。
function resolveOwnerNames(ids) {
  const map = resolveOwnerNameMap(ids);
  return namesFromMap(ids, map);
}

// ④ LOGISTICS-LISTING-01：Listing 上架状态提醒扫描（仅 server.js；复用 sendFeishuTextMessage；best-effort；不改 listing_status）
// 收件人 = 该物流单的上架负责人 + CC（business_participants business_type='logistics'），每单独立解析。
// 规则 A（停滞）：非终态且距 listing_status_updated_at（回退 created_at）≥ 2 天 → 提醒；哨兵 listing_remind_date。
// 规则 B（临近到货）：eta_date 非空、距今 ≤ 3 天（含已过期）且状态未达 ready/listed → 催办；哨兵 listing_eta_remind_date。
// 去重：两个哨兵各存"最后一次提醒日期"，同日不重发；状态一变即被清空 + 基准时间刷新，实现"按状态变化重新计算"。
async function scanListingReminders() {
  const result = { stalled_count: 0, eta_count: 0, sent_count: 0, skipped_no_owner: 0, skipped_no_feishu: 0 };
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const todayMs = Date.parse(today + 'T00:00:00Z');

    // 粗筛排除终态；精确日期判断放 JS 层，规避 SQLite/PG 日期函数方言差异
    const rows = query(
      `SELECT id, batch_no, eta_date, listing_status, listing_owner_ids, listing_status_updated_at,
              listing_remind_date, listing_eta_remind_date, created_at
       FROM logistics_batches
       WHERE listing_status IS NULL OR listing_status != ?`,
      ['listed']
    ).rows;

    for (const lb of rows) {
      const status = lb.listing_status || 'pending_plan';
      if (LISTING_TERMINAL.includes(status)) continue;
      const ownerIds = splitIdCsv(lb.listing_owner_ids);
      if (ownerIds.length === 0) { result.skipped_no_owner += 1; continue; }

      // 收件人每单独立解析，避免跨单累积（与付款扫描的全局 Map 写法刻意不同）
      const recipients = new Map(); // open_id -> { name, lang }
      const addUser = (userId) => {
        if (!userId) return;
        const u = queryOne('SELECT id, name, feishu_open_id, status, language_preference FROM users WHERE id = ?', [userId]);
        if (u && u.feishu_open_id && u.status === 'active') {
          recipients.set(u.feishu_open_id, { name: u.name || '', lang: normalizeLanguage(u.language_preference) });
        }
      };
      ownerIds.forEach(id => addUser(id));
      const ccRows = query('SELECT user_id FROM business_participants WHERE business_type=? AND business_id=? AND participant_type=?', ['logistics', lb.id, 'cc']).rows;
      for (const r of ccRows) addUser(r.user_id);
      if (recipients.size === 0) { result.skipped_no_feishu += 1; continue; }

      // ── 规则 A：状态停滞 ──
      const baseMs = parseDbTimeMs(lb.listing_status_updated_at || lb.created_at);
      const stalledDays = baseMs ? Math.floor((now.getTime() - baseMs) / 86400000) : 0;
      const needStalled = baseMs > 0 && stalledDays >= LISTING_STALL_DAYS && lb.listing_remind_date !== today;

      // ── 规则 B：预计到货临近（daysToEta ≤ 3，负数表示已过期，仍需催办） ──
      let needEta = false;
      let daysToEta = null;
      if (lb.eta_date && !LISTING_ETA_SAFE.includes(status) && lb.listing_eta_remind_date !== today) {
        const etaMs = Date.parse(String(lb.eta_date).slice(0, 10) + 'T00:00:00Z');
        if (!Number.isNaN(etaMs)) {
          daysToEta = Math.round((etaMs - todayMs) / 86400000);
          needEta = daysToEta <= LISTING_ETA_LEAD_DAYS;
        }
      }

      let touched = false;

      if (needStalled) {
        result.stalled_count += 1;
        let sentAny = false;
        for (const [openId, info] of recipients) {
          const text = FEISHU_NOTIFY_TEMPLATES.logistics_listing_stalled(info.lang, lb.batch_no, { listing_status: status, days: stalledDays });
          try { await sendFeishuTextMessage(openId, text); sentAny = true; }
          catch (e) { console.error('[FEISHU-NOTIFY] 上架停滞提醒发送失败 open_id=' + openId + ' batch=' + lb.batch_no + ':', e.message); }
        }
        if (sentAny) { run('UPDATE logistics_batches SET listing_remind_date = ? WHERE id = ?', [today, lb.id]); touched = true; }
      }

      if (needEta) {
        result.eta_count += 1;
        let sentAny = false;
        for (const [openId, info] of recipients) {
          const text = FEISHU_NOTIFY_TEMPLATES.logistics_listing_eta_due(info.lang, lb.batch_no, { listing_status: status, eta_date: lb.eta_date });
          try { await sendFeishuTextMessage(openId, text); sentAny = true; }
          catch (e) { console.error('[FEISHU-NOTIFY] 上架到货催办发送失败 open_id=' + openId + ' batch=' + lb.batch_no + ':', e.message); }
        }
        if (sentAny) { run('UPDATE logistics_batches SET listing_eta_remind_date = ? WHERE id = ?', [today, lb.id]); touched = true; }
      }

      if (touched) result.sent_count += 1;
    }
  } catch (e) {
    console.error('[FEISHU-NOTIFY] 上架提醒扫描异常:', e.message);
  }
  return result;
}

// --- break-glass 启动初始化（fail-closed；保留原 user id，仅密码变化时安全更新）---
function bootstrapBreakGlass() {
  if (!BREAKGLASS_ADMIN_PASSWORD || !isStrongPassword(BREAKGLASS_ADMIN_PASSWORD)) {
    throw new Error('[AUTH] 未配置强密码 BREAKGLASS_ADMIN_PASSWORD（≥12位且含大小写与数字），启动失败（fail-closed）');
  }
  // 优先按固定 id 定位，其次按唯一本地账号定位；绝不以“删除后重建”方式处理
  const existing = queryOne("SELECT * FROM users WHERE id='user_admin' OR (auth_source='local' AND username='admin') LIMIT 1");
  if (existing) {
    // 密码未变化（用 verifyPassword 校验哈希，忽略随机盐）：不重新生成哈希、不清除旧 Session、不改变 user id
    if (existing.password_hash && verifyPassword(BREAKGLASS_ADMIN_PASSWORD, existing.password_hash)) {
      return;
    }
    // 密码已变化（或首次设置）：安全 UPDATE（保留原 user id），并使旧 Session 立即失效
    const hash = hashPassword(BREAKGLASS_ADMIN_PASSWORD);
    run("UPDATE users SET password_hash=?, password='', name=?, status=?, auth_source='local' WHERE id=?",
      [hash, existing.name || '超级管理员', existing.status || 'active', existing.id]);
    run("DELETE FROM sessions WHERE user_id=?", [existing.id]);
    console.log('[AUTH] break-glass 密码已更新，旧 Session 已失效（user id 保持不变: ' + existing.id + '）');
    return;
  }
  // 首次：仅 INSERT，绝不替换（保留指定 user id）
  const hash = hashPassword(BREAKGLASS_ADMIN_PASSWORD);
  run("INSERT INTO users (id, username, name, password, role_id, status, email, auth_source, password_hash) VALUES (?,?,?,?,?,?,?,?,?)",
    ['user_admin', 'admin', '超级管理员', '', 'role_admin', 'active', '', 'local', hash]);
  console.log('[AUTH] break-glass 本地管理员已初始化（首次 INSERT，user id=user_admin）');
}

// --- break-glass 防暴力破解（仅保护唯一本地应急接口；内存计数，进程重启清零；不建设普通本地账号锁定体系）---
const bgFailTracker = new Map(); // key: ip|username -> { fails, cooldownUntil }
const BG_MAX_FAILS = 5;
const BG_COOLDOWN_MS = 15 * 60 * 1000; // 连续失败冷却 15 分钟
function bgFailKey(ip, username) { return (ip || 'unknown') + '|' + (username || ''); }
function bgIsCooling(ip, username) {
  const e = bgFailTracker.get(bgFailKey(ip, username));
  if (!e) return false;
  if (Date.now() < e.cooldownUntil) return true;
  if (e.fails < BG_MAX_FAILS) return false;
  bgFailTracker.delete(bgFailKey(ip, username)); // 冷却自然到期后自动复位
  return false;
}
// 返回剩余冷却秒数（0 表示未冷却或已到期）
function bgCooldownRemaining(ip, username) {
  const e = bgFailTracker.get(bgFailKey(ip, username));
  if (!e) return 0;
  return Math.max(0, Math.ceil((e.cooldownUntil - Date.now()) / 1000));
}
function bgRegisterFail(ip, username) {
  const k = bgFailKey(ip, username);
  const e = bgFailTracker.get(k) || { fails: 0, cooldownUntil: 0 };
  e.fails += 1;
  if (e.fails >= BG_MAX_FAILS) e.cooldownUntil = Date.now() + BG_COOLDOWN_MS;
  bgFailTracker.set(k, e);
}
function bgClear(ip, username) { bgFailTracker.delete(bgFailKey(ip, username)); }

// ==================== 配置 ====================
const PORT = process.env.PORT || 3001;
const APP_VERSION = '1.0.17';
// 发布可核对信息：部署时间（进程启动时间 ≈ 部署时间）+ git commit
// （Render 自动注入 RENDER_GIT_COMMIT；否则回退本地 git rev-parse；都不可用则标记 unknown）
const APP_STARTED_AT = new Date().toISOString();
let APP_COMMIT = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '';
if (!APP_COMMIT) {
  try { APP_COMMIT = require('child_process').execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim(); } catch (e) { APP_COMMIT = 'unknown'; }
}

console.log('========================================');
console.log('  进销存管理系统 - 后端服务');
console.log('========================================');
console.log(`  版本: ${APP_VERSION}`);
console.log(`  端口: ${PORT}`);
console.log('========================================\n');

// 初始化数据库
// P0-FIX-1：仅在直接运行 server.js 时初始化数据库，避免 require 时连接/seed 真实库
if (require.main === module) {
  initDatabase();
  // 库存导入日期归一化回填：修复 M/D/YY 文本导致快照 MAX 字典序误判（根因 A）
  normalizeImportDatesBackfill();
  // 日期归一化后重新计算库存快照，使修正后的"最新批次"立即生效
  // （已导入但停留在旧快照的批次无需手动重新导入即可修正）
  refreshInventoryTotals('').then(() => {
    console.log('[STARTUP] 库存快照已按修正后的最新导入日期重算完成');
  }).catch(e => console.error('[STARTUP] 库存快照重算失败:', e && e.message));
}

// PAY-CORE Phase 2 V2.1 第 12 节：为现有 role_admin 添加 payment_execute 权限（幂等迁移）
// 仅影响 role_admin；role_operator/role_viewer 不添加
// P0-FIX-1：仅在直接运行 server.js 时执行迁移，避免 require 时写入真实库
if (require.main === module) {
  (function ensureRoleAdminPaymentExecute() {
    try {
      const adminRole = queryOne("SELECT permissions FROM roles WHERE id = 'role_admin'");
      if (!adminRole || !adminRole.permissions) return;
      const perms = JSON.parse(adminRole.permissions);
      if (!Array.isArray(perms)) return;
      if (!perms.includes('payment_execute')) {
        perms.push('payment_execute');
        run("UPDATE roles SET permissions = ? WHERE id = 'role_admin'", [JSON.stringify(perms)]);
        console.log('[Migration] role_admin 已添加 payment_execute 权限');
      }
    } catch (e) {
      console.warn('[Migration] role_admin payment_execute 迁移失败（非致命）:', e.message);
    }
  })();
}

// P2：为现有 role_admin 添加 outbound_delete 权限（幂等迁移）
// 高风险删除权限仅限超级管理员；role_operator / role_viewer 不添加（B1）
// 沿用 payment_execute 迁移模式：仅在直接运行 server.js 时执行，避免 require 时写入真实库
if (require.main === module) {
  (function ensureRoleAdminOutboundDelete() {
    try {
      const adminRole = queryOne("SELECT permissions FROM roles WHERE id = 'role_admin'");
      if (!adminRole || !adminRole.permissions) return;
      const perms = JSON.parse(adminRole.permissions);
      if (!Array.isArray(perms)) return;
      // P2.1-1：即便已含 '*' 也显式追加 outbound_delete。
      // 原因：requireApiPermission 仅做字面 includes 校验（见其定义），'*' 不会通配授予该权限；
      // 若 role_admin 为 ['*'] 却未显式含 outbound_delete，则 requireApiPermission('outbound_delete') 会 403。
      // 约束：不覆盖其它权限、不删除 '*'、不修改其它角色、幂等（已含则跳过）。
      if (!perms.includes('outbound_delete')) {
        perms.push('outbound_delete');
        run("UPDATE roles SET permissions = ? WHERE id = 'role_admin'", [JSON.stringify(perms)]);
        console.log('[Migration] role_admin 已添加 outbound_delete 权限');
      }
    } catch (e) {
      console.warn('[Migration] role_admin outbound_delete 迁移失败（非致命）:', e.message);
    }
  })();
}

// Phase 2：为拥有审批权限的角色自动追加 approval_view（幂等迁移）
// 仅处理含 po_approve/payment_approve/check_approve 的角色，不处理含 '*' 的超级管理员（通配符已覆盖所有权限）
if (require.main === module) {
  (function ensureApprovalView() {
    try {
      const roles = query("SELECT id, permissions FROM roles").rows;
      const approvePerms = ['po_approve', 'payment_approve', 'check_approve'];
      let migrated = 0;
      roles.forEach(role => {
        let perms;
        try { perms = JSON.parse(role.permissions || '[]'); } catch(_) { return; }
        if (!Array.isArray(perms)) return;
        if (perms.includes('*')) return; // 超级管理员通配符已覆盖
        const hasApprovePerm = approvePerms.some(p => perms.includes(p));
        if (hasApprovePerm && !perms.includes('approval_view')) {
          perms.push('approval_view');
          run("UPDATE roles SET permissions = ? WHERE id = ?", [JSON.stringify(perms), role.id]);
          migrated++;
        }
      });
      if (migrated > 0) {
        console.log('[Migration] 已为 ' + migrated + ' 个角色追加 approval_view 权限');
      }
    } catch (e) {
      console.warn('[Migration] approval_view 迁移失败（非致命）:', e.message);
    }
  })();
}

// ==================== 寄售库存表迁移（CONSIGNMENT-INVENTORY） ====================
// 幂等建表：consignment_inventory_lots（寄售库存批次行）+ consignment_inventory_import_batches（导入批次）
// 仅在直接运行 server.js 时执行，避免 require 时写入真实库
if (require.main === module) {
  (function ensureConsignmentInventoryTables() {
    try {
      run(`CREATE TABLE IF NOT EXISTS consignment_inventory_lots (
        id TEXT PRIMARY KEY,
        country_name TEXT,
        warehouse_name TEXT NOT NULL,
        customer_name TEXT,
        outbound_no TEXT,
        outbound_date TEXT,
        sku_code TEXT NOT NULL,
        outbound_qty INTEGER,
        sold_qty INTEGER,
        returned_qty INTEGER,
        remaining_qty INTEGER,
        unit_cost NUMERIC(18,4),
        remaining_inventory_value NUMERIC(18,4),
        import_batch_id TEXT NOT NULL,
        source_line_no INTEGER,
        source_type TEXT DEFAULT 'excel',
        status TEXT DEFAULT 'active',
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      run(`CREATE TABLE IF NOT EXISTS consignment_inventory_import_batches (
        id TEXT PRIMARY KEY,
        warehouse_name TEXT NOT NULL,
        country_name TEXT,
        original_filename TEXT,
        total_rows INTEGER,
        valid_rows INTEGER,
        error_rows INTEGER,
        customer_count INTEGER,
        sku_count INTEGER,
        total_remaining_qty INTEGER,
        total_remaining_value NUMERIC(18,4),
        status TEXT DEFAULT 'pending',
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        activated_at TEXT
      )`);
      console.log('[Migration] 寄售库存表已就绪');
    } catch (e) {
      console.warn('[Migration] 寄售库存表迁移失败（非致命）:', e.message);
    }
  })();
}

// ==================== Express 初始化 ====================
const app = express();
app.set('trust proxy', 1); // Render 反向代理 TLS 终止后，使 req.protocol/req.secure 正确反映客户端原始协议

function asyncHandler(fn) {
  return function (req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
  req.i18nLang = resolveRequestLanguage(req, { preferCookie: reqPath(req) === '/api/auth/feishu/callback' });
  const json = res.json.bind(res);
  res.json = body => json(localizeResponseBody(req, body));
  next();
});

// 前端静态文件
function sendNoCacheHtml(res, fileName) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  // 注入 cache-busting 版本参数到 script/link 标签，确保浏览器始终加载最新 JS/CSS
  const fs = require('fs');
  let html = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
  const cacheBust = APP_COMMIT ? APP_COMMIT.slice(0, 12) : APP_STARTED_AT.replace(/[^0-9a-zA-Z]/g, '');
  html = html.replace(/(<script\s+src=")([^"]+)(")/g, function(m, prefix, src, suffix) {
    if (src.indexOf('?v=') !== -1) return m; // 已有版本参数则跳过
    return prefix + src + '?v=' + cacheBust + suffix;
  });
  html = html.replace(/(<link\s+[^>]*href=")([^"]+\.css)(")/g, function(m, prefix, src, suffix) {
    if (src.indexOf('?v=') !== -1) return m;
    return prefix + src + '?v=' + cacheBust + suffix;
  });
  res.send(html);
}

app.get('/', asyncHandler((req, res) => sendNoCacheHtml(res, 'index.html')));
app.get('/index.html', asyncHandler((req, res) => sendNoCacheHtml(res, 'index.html')));
app.use(express.static(path.join(__dirname), {
  index: false,
  // 所有静态资源（含 app.js / db.js / index.html）一律禁用缓存，
  // 避免浏览器复用旧构建导致“前端已改、页面仍跑旧代码”的诡异现象。
  setHeaders(res, filePath) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

app.get('/api/version', asyncHandler((req, res) => {
  res.json({
    version: APP_VERSION,
    app: 'inventory-management-system',
    commit: APP_COMMIT,
    deployTime: APP_STARTED_AT,
    environment: process.env.RENDER === 'true' ? 'production' : (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
    timestamp: new Date().toISOString()
  });
}));

// ==================== 认证与权限中间件 ====================
// 写请求可信 Origin 校验（CSRF 防护；test 环境自动绕过）
function csrfGuard(req, res, next) {
  if (CSRF_DISABLE) return next();
  const m = req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  const url = reqPath(req);
  if (PUBLIC_AUTH_PREFIXES.some(p => url === p || url.indexOf(p + '?') === 0)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const selfOrigin = req.protocol + '://' + (req.headers.host || '');
  const allowed = TRUSTED_ORIGINS.concat([selfOrigin]);
  let ok = false;
  try { ok = allowed.includes(new URL(origin).origin); } catch (e) { ok = false; }
  if (!ok) { return res.status(403).json({ error: '跨站请求被拒绝（CSRF 防护）' }); }
  next();
}
app.use(csrfGuard);

// 服务端会话鉴权：完全忽略 X-User-* 头，身份来自 HttpOnly Cookie → session → users → roles
function apiAuth(req, res, next) {
  const url = reqPath(req);
  if (PUBLIC_AUTH_PREFIXES.some(p => url === p || url.indexOf(p + '?') === 0)) return next();
  // 1) 短期 session（cookie 内 token）
  let sess = null;
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    sess = queryOne("SELECT * FROM sessions WHERE token_hash=? AND expires_at > datetime('now')", [tokenHash]);
  }
  // 2) 长期 remember 凭证：session 缺失/过期时透明自动恢复（30 天免登录）
  if (!sess) {
    sess = tryRestoreFromPersistent(req, res);
  }
  if (!sess) { return res.status(401).json({ error: '会话无效或已过期' }); }
  const user = queryOne('SELECT * FROM users WHERE id=?', [sess.user_id]);
  if (!user) {
    run('DELETE FROM sessions WHERE id=?', [sess.id]);
    return res.status(401).json({ error: '账号不存在' });
  }
  if (user.status === 'disabled') {
    run('DELETE FROM sessions WHERE id=?', [sess.id]);
    return res.status(401).json({ error: '账号已停用' });
  }
  if (user.status === 'pending') {
    // 已认证但零权限：仅允许 /api/me 探活
    if (url === '/api/me') {
      req.currentUserId = user.id;
      req.currentUserName = user.name;
      req.currentUserRole = user.role_id || '';
      req.currentUserPermissions = [];
      return next();
    }
    return res.status(403).json({ error: '账号待管理员授权' });
  }
  // active：每次从 DB 读角色/权限（角色变更即时生效）
  const role = queryOne('SELECT * FROM roles WHERE id=?', [user.role_id]);
  let perms = [];
  try { perms = role ? JSON.parse(role.permissions || '[]') : []; } catch (e) { perms = []; }
  req.currentUserId = user.id;
  req.currentUserName = user.name;
  req.currentUserRole = user.role_id || '';
  req.currentUserPermissions = perms;
  // DATA-SCOPE: 用户级 > 角色级 > 无限制（每次请求实时读取，变更即时生效）
  req.currentUserDataScope = getUserDataScope(user.id) || getRoleDataScope(user.role_id);
  next();
}

function requireApiPermission(...perms) {
  return (req, res, next) => {
    if (!req.currentUserId) return res.status(401).json({ error: '未登录' });
    const hasPerm = perms.some(p => (req.currentUserPermissions || []).includes(p));
    if (!hasPerm) return res.status(403).json({ error: '没有该操作的权限' });
    next();
  };
}

function requireLogin(req, res, next) {
  if (!req.currentUserId) return res.status(401).json({ error: '未登录' });
  next();
}

// ==================== 数据权限（Data Scope） ====================
// 独立于功能权限，控制销售模块数据可见范围（国家/品牌/仓库多选）
// admin 角色不受数据权限限制；普通角色若未配置 role_data_scope 行则也不限制（向后兼容）

function getRoleDataScope(roleId) {
  if (!roleId) return null;
  const row = queryOne('SELECT * FROM role_data_scope WHERE role_id=?', [roleId]);
  if (!row) return null;
  let countries = [], brands = [], warehouses = [];
  try { countries = JSON.parse(row.countries || '[]'); } catch (e) { countries = []; }
  try { brands = JSON.parse(row.brands || '[]'); } catch (e) { brands = []; }
  try { warehouses = JSON.parse(row.warehouses || '[]'); } catch (e) { warehouses = []; }
  return { countries, brands, warehouses };
}

// 用户级数据权限覆盖（优先于角色级）
// 存在 user_data_scope 行 → 使用用户配置；不存在 → 返回 null（由调用方回退到角色级）
function getUserDataScope(userId) {
  if (!userId) return null;
  const row = queryOne('SELECT * FROM user_data_scope WHERE user_id=?', [userId]);
  if (!row) return null;
  let countries = [], brands = [], warehouses = [];
  try { countries = JSON.parse(row.countries || '[]'); } catch (e) { countries = []; }
  try { brands = JSON.parse(row.brands || '[]'); } catch (e) { brands = []; }
  try { warehouses = JSON.parse(row.warehouses || '[]'); } catch (e) { warehouses = []; }
  return { countries, brands, warehouses };
}

// 判断当前用户是否需要数据权限过滤
function needsDataScopeFilter(req) {
  if (!req.currentUserId) return false;
  // admin 角色不受限
  if (req.currentUserRole === 'role_admin') return false;
  // 通配权限也跳过
  if ((req.currentUserPermissions || []).includes('*')) return false;
  // 未配置 data scope 则不限制
  const scope = req.currentUserDataScope;
  if (!scope) return false;
  // 三个维度都为空则不限制
  if ((!scope.countries || scope.countries.length === 0) &&
      (!scope.brands || scope.brands.length === 0) &&
      (!scope.warehouses || scope.warehouses.length === 0)) return false;
  return true;
}

// 构建销售数据权限 SQL 过滤片段（用于 sales_records 表查询）
// tablePrefix: 表别名前缀，默认 'sr'，传 '' 则无前缀
// 返回 { sql: ' AND ...', params: [...] } 或 { sql: '', params: [] }
function buildSalesDataScopeFilter(req, tablePrefix) {
  // tablePrefix 显式传 '' 表示无前缀；undefined 时默认 'sr'
  const tp = (tablePrefix !== undefined) ? tablePrefix : 'sr';
  const colPrefix = tp ? tp + '.' : '';
  if (!needsDataScopeFilter(req)) return { sql: '', params: [] };
  const scope = req.currentUserDataScope;
  const params = [];
  const conditions = [];

  // 国家过滤：country_ids → 解析为 country.name + country.code，与 sales_records.country 匹配
  // 仓库过滤：warehouse_ids → 解析为 country_id → 再追加到国家维度
  let effectiveCountryIds = [];
  if (scope.countries && scope.countries.length > 0) {
    effectiveCountryIds = effectiveCountryIds.concat(scope.countries);
  }
  if (scope.warehouses && scope.warehouses.length > 0) {
    const whRows = query('SELECT DISTINCT country_id FROM warehouses WHERE id IN (' +
      scope.warehouses.map(() => '?').join(',') + ") AND country_id != ''", scope.warehouses).rows;
    whRows.forEach(r => { if (r.country_id && effectiveCountryIds.indexOf(r.country_id) < 0) effectiveCountryIds.push(r.country_id); });
  }

  if (effectiveCountryIds.length > 0) {
    // 解析 country_ids → name + code 值列表，匹配 sales_records.country
    const countryRows = query('SELECT name, code FROM countries WHERE id IN (' +
      effectiveCountryIds.map(() => '?').join(',') + ')', effectiveCountryIds).rows;
    const countryValues = [];
    countryRows.forEach(r => {
      if (r.name && countryValues.indexOf(r.name) < 0) countryValues.push(r.name);
      if (r.code && countryValues.indexOf(r.code) < 0) countryValues.push(r.code);
    });
    // 同时也把 country_id 本身加入（sales_records.country 可能存储 id）
    effectiveCountryIds.forEach(cid => { if (countryValues.indexOf(cid) < 0) countryValues.push(cid); });
    if (countryValues.length > 0) {
      conditions.push(colPrefix + 'country IN (' + countryValues.map(() => '?').join(',') + ')');
      params.push(...countryValues);
    }
  }

  // 品牌过滤：直接匹配 sales_records.brand
  if (scope.brands && scope.brands.length > 0) {
    conditions.push(colPrefix + 'brand IN (' + scope.brands.map(() => '?').join(',') + ')');
    params.push(...scope.brands);
  }

  if (conditions.length === 0) return { sql: '', params: [] };
  return { sql: ' AND ' + conditions.join(' AND '), params };
}

// 构建订单预测数据权限 SQL 过滤片段（用于 replenishment_suggestions rs + skus s 表查询）
// country → rs.country, brand → s.brand, warehouse → rs.target_warehouse
// 返回 { sql: ' AND ...', params: [...] } 或 { sql: '', params: [] }
function buildReplenishmentDataScopeFilter(req) {
  if (!needsDataScopeFilter(req)) return { sql: '', params: [] };
  const scope = req.currentUserDataScope;
  const params = [];
  const conditions = [];

  // 国家过滤：country_ids → 解析为 name + code + id，匹配 rs.country
  if (scope.countries && scope.countries.length > 0) {
    const countryRows = query('SELECT name, code FROM countries WHERE id IN (' +
      scope.countries.map(() => '?').join(',') + ')', scope.countries).rows;
    const countryValues = [];
    countryRows.forEach(r => {
      if (r.name && countryValues.indexOf(r.name) < 0) countryValues.push(r.name);
      if (r.code && countryValues.indexOf(r.code) < 0) countryValues.push(r.code);
    });
    scope.countries.forEach(cid => { if (countryValues.indexOf(cid) < 0) countryValues.push(cid); });
    if (countryValues.length > 0) {
      conditions.push('rs.country IN (' + countryValues.map(() => '?').join(',') + ')');
      params.push(...countryValues);
    }
  }

  // 品牌过滤：s.brand（来自 skus JOIN）
  if (scope.brands && scope.brands.length > 0) {
    conditions.push('s.brand IN (' + scope.brands.map(() => '?').join(',') + ')');
    params.push(...scope.brands);
  }

  // 仓库过滤：rs.target_warehouse（直接列，解析 warehouse_ids → id + name）
  if (scope.warehouses && scope.warehouses.length > 0) {
    const whRows = query('SELECT id, name FROM warehouses WHERE id IN (' +
      scope.warehouses.map(() => '?').join(',') + ')', scope.warehouses).rows;
    const whValues = [];
    whRows.forEach(r => {
      if (r.id && whValues.indexOf(r.id) < 0) whValues.push(r.id);
      if (r.name && whValues.indexOf(r.name) < 0) whValues.push(r.name);
    });
    scope.warehouses.forEach(wid => { if (whValues.indexOf(wid) < 0) whValues.push(wid); });
    if (whValues.length > 0) {
      conditions.push('rs.target_warehouse IN (' + whValues.map(() => '?').join(',') + ')');
      params.push(...whValues);
    }
  }

  if (conditions.length === 0) return { sql: '', params: [] };
  return { sql: ' AND ' + conditions.join(' AND '), params };
}

// 构建首页看板数据权限过滤片段（用于 inventory / CI / PO / PI 表查询）
// 返回 { inventory: {sql, params}, ci: {sql, params}, po: {sql, params}, pi: {sql, params}, ciAlias: {sql, params} }
// ciAlias 用于 CI 表带别名的查询（如 ci.country）
function buildDashboardScopeFilters(req) {
  const empty = { sql: '', params: [] };
  if (!needsDataScopeFilter(req)) return { inventory: empty, ci: empty, po: empty, pi: empty, ciAlias: empty };
  const scope = req.currentUserDataScope;

  // 1. 解析国家：country_ids → country_names
  let effectiveCountryIds = [];
  if (scope.countries && scope.countries.length > 0) {
    effectiveCountryIds = effectiveCountryIds.concat(scope.countries);
  }
  // 仓库 → country_id 追加
  if (scope.warehouses && scope.warehouses.length > 0) {
    const whRows = query('SELECT DISTINCT country_id FROM warehouses WHERE id IN (' +
      scope.warehouses.map(() => '?').join(',') + ") AND country_id != ''", scope.warehouses).rows;
    whRows.forEach(r => { if (r.country_id && effectiveCountryIds.indexOf(r.country_id) < 0) effectiveCountryIds.push(r.country_id); });
  }
  let countryNames = [];
  if (effectiveCountryIds.length > 0) {
    const countryRows = query('SELECT name FROM countries WHERE id IN (' +
      effectiveCountryIds.map(() => '?').join(',') + ')', effectiveCountryIds).rows;
    countryNames = countryRows.map(r => r.name).filter(n => n);
  }

  // 2. 解析仓库：warehouse_ids → warehouse_names
  let warehouseNames = [];
  if (scope.warehouses && scope.warehouses.length > 0) {
    const whRows = query('SELECT name FROM warehouses WHERE id IN (' +
      scope.warehouses.map(() => '?').join(',') + ')', scope.warehouses).rows;
    warehouseNames = whRows.map(r => r.name).filter(n => n);
  }

  // 3. 构建 inventory 表过滤（country + warehouse 列，存的是 name）
  const invConds = [], invParams = [];
  if (countryNames.length > 0) {
    invConds.push('country IN (' + countryNames.map(() => '?').join(',') + ')');
    invParams.push(...countryNames);
  }
  if (warehouseNames.length > 0) {
    invConds.push('warehouse IN (' + warehouseNames.map(() => '?').join(',') + ')');
    invParams.push(...warehouseNames);
  }
  const inventory = invConds.length > 0 ? { sql: ' AND (' + invConds.join(' OR ') + ')', params: invParams } : empty;

  // 4. 构建 CI/PO/PI 表过滤（country + brand 列）
  const ciConds = [], ciParams = [];
  if (countryNames.length > 0) {
    ciConds.push('country IN (' + countryNames.map(() => '?').join(',') + ')');
    ciParams.push(...countryNames);
  }
  if (scope.brands && scope.brands.length > 0) {
    ciConds.push('brand IN (' + scope.brands.map(() => '?').join(',') + ')');
    ciParams.push(...scope.brands);
  }
  const ciFilter = ciConds.length > 0 ? { sql: ' AND (' + ciConds.join(' OR ') + ')', params: ciParams } : empty;
  const ciAliasConds = ciConds.map(c => c.replace('country ', 'ci.country ').replace('brand ', 'ci.brand '));
  const ciAlias = ciAliasConds.length > 0 ? { sql: ' AND (' + ciAliasConds.join(' OR ') + ')', params: ciParams } : empty;

  return { inventory, ci: ciFilter, po: ciFilter, pi: ciFilter, ciAlias };
}

// 把 inventory 的数据权限 scope 适配到 consignment_inventory_lots 表：
// 列名 country→country_name、warehouse→warehouse_name，参数顺序与 inventory scope 保持一致。
// 用于首页资产汇总时，寄售库存按与 inventory 相同的数据权限 scope 过滤 country_name。
function adaptScopeToLots(dsfInv) {
  const sql = (dsfInv && dsfInv.sql || '').replace(/\bcountry\b/g, 'country_name').replace(/\bwarehouse\b/g, 'warehouse_name');
  return { sql, params: (dsfInv && dsfInv.params) || [] };
}

// 所有 /api 路由需要认证（公共鉴权前缀已在 apiAuth 内放行）
app.use('/api', apiAuth);

// ==================== 认证：飞书 OAuth + break-glass 本地登录 ====================

// 飞书授权入口（生成一次性 state，跳转飞书；test 环境返回 state 供驱动）
app.get('/api/auth/feishu/login', asyncHandler((req, res) => {
  // 守卫：环境变量未配齐时不构造坏 URL（避免飞书 20028 "client_id 请求不合法"）
  if (!FEISHU_APP_ID || !FEISHU_REDIRECT_URI) {
    console.warn('[FEISHU] login 拒绝：环境变量未配齐 (FEISHU_APP_ID=' + (FEISHU_APP_ID ? '已设置' : '空') + ', FEISHU_REDIRECT_URI=' + (FEISHU_REDIRECT_URI ? '已设置' : '空') + ')');
    return res.status(503).json({ error: 'feishu_not_configured', message: '飞书登录未配置（请在 Render 设置 FEISHU_APP_ID 与 FEISHU_REDIRECT_URI）' });
  }
  const oauthLang = normalizeLanguage(req.query && req.query.lang);
  req.i18nLang = oauthLang;
  res.cookie(LANGUAGE_COOKIE_NAME, oauthLang, languageCookieOpts());
  const state = crypto.randomBytes(16).toString('hex');
  run("INSERT INTO oauth_states (state, created_at, expires_at) VALUES (?, datetime('now'), datetime('now', '+10 minutes'))", [state]);
  const redirect = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=' + encodeURIComponent(FEISHU_APP_ID)
    + '&redirect_uri=' + encodeURIComponent(FEISHU_REDIRECT_URI) + '&state=' + encodeURIComponent(state) + '&response_type=code';
  if (process.env.NODE_ENV === 'test') return res.json({ state, authorize_url: redirect });
  res.redirect(redirect);
}));

// 飞书配置状态（前端探活 + 登录页决定是否显示"飞书登录"按钮；不暴露密钥）
app.get('/api/auth/feishu/status', asyncHandler((req, res) => {
  res.json({
    configured: !!(FEISHU_APP_ID && FEISHU_REDIRECT_URI),
    has_app_id: !!FEISHU_APP_ID,
    has_app_secret: !!FEISHU_APP_SECRET,
    has_redirect_uri: !!FEISHU_REDIRECT_URI,
    redirect_uri: FEISHU_REDIRECT_URI || null,
  });
}));

// 飞书回调：校验 state → 换身份 → 按 union_id 匹配/创建 → 建 Session
app.get('/api/auth/feishu/callback', asyncHandler(async (req, res) => {
  // 守卫：环境变量未配齐时直接 503（与 /api/auth/feishu/login 守卫一致）
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET || !FEISHU_REDIRECT_URI) {
    console.warn('[FEISHU] callback 拒绝：环境变量未配齐');
    return res.status(503).json({ error: 'feishu_not_configured', message: '飞书登录未配置' });
  }
  try {
    const { code, state } = req.query;
    if (!state) { auditLogin(null, '', 'feishu', false, 'missing_state'); return res.status(401).json({ error: '缺少 state' }); }
    const st = queryOne("SELECT * FROM oauth_states WHERE state=? AND expires_at > datetime('now')", [state]);
    if (!st) { auditLogin(null, '', 'feishu', false, 'bad_or_expired_state'); return res.status(401).json({ error: 'state 无效或已过期' }); }
    run('DELETE FROM oauth_states WHERE state=?', [state]); // 一次性使用，防重放
    let info;
    try { info = await exchangeFeishuCode(code); }
    catch (e) { auditLogin(null, '', 'feishu', false, 'exchange_failed'); return res.status(401).json({ error: '飞书身份校验失败' }); }
    if (!info || !info.union_id) { auditLogin(null, '', 'feishu', false, 'no_union_id'); return res.status(401).json({ error: '飞书未返回有效用户标识' }); }

    // 匹配：union_id 主键 → open_id 回退（不使用 email，避免误合并）
    let user = queryOne('SELECT * FROM users WHERE feishu_union_id=? AND feishu_union_id<>?', [info.union_id, '']);
    if (!user) user = queryOne('SELECT * FROM users WHERE feishu_open_id=? AND feishu_open_id<>?', [info.open_id || '', '']);
    if (!user) {
      const userId = genId('user');
      run(`INSERT INTO users (id, username, name, role_id, status, email, auth_source, feishu_open_id, feishu_union_id, feishu_user_id)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [userId, info.user_id || info.union_id, info.name || '飞书用户', null, 'pending', info.email || '', 'feishu', info.open_id || '', info.union_id || '', info.user_id || '']);
      user = queryOne('SELECT * FROM users WHERE id=?', [userId]);
    } else {
      run('UPDATE users SET feishu_open_id=?, feishu_union_id=?, feishu_user_id=?, name=?, email=? WHERE id=?',
        [info.open_id || '', info.union_id || '', info.user_id || '', info.name || user.name, info.email || user.email, user.id]);
    }
    createSessionForUser(res, user, req.headers['user-agent'], req.headers['x-forwarded-for'] || req.ip);
    auditLogin(user.id, user.username, 'feishu', true, '');
    if (process.env.NODE_ENV === 'test') {
      return res.json({ ok: true, user: { id: user.id, status: user.status, role_id: user.role_id, username: user.username } });
    }
    res.redirect('/');
  } catch (e) {
    console.error('[FEISHU] callback exception:', e.message, '\n', e.stack);
    auditLogin(null, '', 'feishu', false, 'exception:' + (e.message || 'unknown'));
    return res.status(401).json({ error: '飞书登录失败' });
  }
}));

// 飞书通知演练记录查询（仅测试/演练模式可用；生产恒 404，不暴露任何内部状态）
app.get('/api/feishu/notify/dryrun-log', asyncHandler((req, res) => {
  if (process.env.NODE_ENV !== 'test' && process.env.FEISHU_NOTIFY_DRYRUN !== '1') return res.status(404).json({ error: 'not available' });
  res.json({ log: __feishuDryRunLog });
}));

// break-glass 本地应急登录（独立接口，强密码哈希校验，安全审计，防暴力破解）
app.post('/api/auth/local/login', asyncHandler((req, res) => {
  const { username, password } = req.body || {};
  const ua = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for'] || req.ip || '';
  // P0-3 防暴力破解：冷却期内统一返回 429，不暴露账号是否存在
  if (bgIsCooling(ip, username)) {
    const remainingSec = bgCooldownRemaining(ip, username);
    const remainingMin = Math.max(1, Math.ceil(remainingSec / 60));
    res.set('Retry-After', String(remainingSec));
    return res.status(429).json({ error: `请求过于频繁，请 ${remainingMin} 分钟后再试`, retry_after: remainingSec });
  }
  const user = queryOne("SELECT * FROM users WHERE username=? AND auth_source='local'", [username]);
  if (!user) { auditLogin(null, username || '', 'local', false, 'no_local_user', ua, ip); bgRegisterFail(ip, username); return res.status(401).json({ error: '账号或密码错误' }); }
  if (!user.password_hash) { auditLogin(user.id, username || '', 'local', false, 'no_password_hash', ua, ip); bgRegisterFail(ip, username); return res.status(401).json({ error: '本地账号未初始化' }); }
  if (!verifyPassword(password || '', user.password_hash)) { auditLogin(user.id, username || '', 'local', false, 'bad_password', ua, ip); bgRegisterFail(ip, username); return res.status(401).json({ error: '账号或密码错误' }); }
  if (user.status !== 'active') { auditLogin(user.id, username || '', 'local', false, 'not_active', ua, ip); bgRegisterFail(ip, username); return res.status(401).json({ error: '账号未启用' }); }
  bgClear(ip, username); // 成功：清除失败计数
  auditLogin(user.id, username || '', 'local', true, '', ua, ip);
  createSessionForUser(res, user, ua, ip);
  const role = queryOne('SELECT * FROM roles WHERE id=?', [user.role_id]);
  const perms = role ? JSON.parse(role.permissions || '[]') : [];
  res.json({ id: user.id, username: user.username, name: user.name, role_id: user.role_id, role_name: role ? role.name : '', status: user.status, permissions: perms, language_preference: normalizeLanguage(user.language_preference) });
}));

// 当前登录用户（pending 仅返回自身状态，业务接口由 apiAuth 拦截）
app.get('/api/me', asyncHandler((req, res) => {
  if (!req.currentUserId) return res.status(401).json({ error: '未登录' });
  const user = queryOne('SELECT id,username,name,role_id,status,email,auth_source,last_login_at,language_preference FROM users WHERE id=?', [req.currentUserId]);
  if (!user) return res.status(401).json({ error: '账号不存在' });
  const role = queryOne('SELECT * FROM roles WHERE id=?', [user.role_id]);
  res.json({
    id: user.id, username: user.username, name: user.name,
    role_id: user.role_id, role_name: role ? role.name : '',
    status: user.status, email: user.email, auth_source: user.auth_source,
    language_preference: normalizeLanguage(user.language_preference),
    permissions: req.currentUserPermissions || (role ? JSON.parse(role.permissions || '[]') : []),
    data_scope: req.currentUserDataScope || null
  });
}));

// I18N-100P-B1：自助语言偏好保存（仅登录用户；仅改自己；CSRF 由现有中间件保护；白名单 zh/en/id）
app.put('/api/users/me/language-preference', asyncHandler((req, res) => {
  try {
    if (!req.currentUserId) { return res.status(401).json({ error: '未登录' }); }
    const raw = req.body && req.body.language_preference;
    if (raw !== 'zh' && raw !== 'en' && raw !== 'id') {
      return res.status(400).json({ error: 'language_preference 仅允许 zh、en、id' });
    }
    run('UPDATE users SET language_preference=? WHERE id=?', [raw, req.currentUserId]);
    res.json({ language_preference: raw });
  } catch (e) {
    throw e;
  }
}));

// 登出：销毁 Session + 清除 Cookie（含 30 天 remember 凭证，登出即放弃免登录）
app.post('/api/logout', asyncHandler((req, res) => {
  let userId = null;
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const sess = queryOne('SELECT * FROM sessions WHERE token_hash=?', [tokenHash]);
    if (sess) userId = sess.user_id;
    run('DELETE FROM sessions WHERE token_hash=?', [tokenHash]);
  }
  const pToken = parseCookies(req)[PERSISTENT_COOKIE_NAME];
  if (pToken) {
    const pHash = crypto.createHash('sha256').update(pToken).digest('hex');
    run('DELETE FROM persistent_logins WHERE token_hash=?', [pHash]);
  }
  // 登出即放弃免登录：无论请求是否携带 remember cookie，均吊销该用户全部长期凭证
  if (userId) {
    run('DELETE FROM persistent_logins WHERE user_id=?', [userId]);
  }
  res.clearCookie(PERSISTENT_COOKIE_NAME, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'Lax', path: '/' });
  res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'Lax', path: '/' });
  res.json({ success: true });
}));

// ==================== 用户管理 ====================
app.get('/api/users', requireApiPermission('user_manage'), asyncHandler((req, res) => {
  try {
    const rows = query('SELECT id, username, name, role_id, status, email, auth_source, feishu_open_id, feishu_union_id, last_login_at, created_at, language_preference FROM users ORDER BY created_at DESC').rows;
    // USER-SCOPE: 获取有个人数据权限的用户ID集合（用于列表展示来源标识）
    const scopeUserIds = new Set(query('SELECT user_id FROM user_data_scope').rows.map(r => r.user_id));
    const masked = rows.map(u => ({
      ...u,
      has_personal_scope: scopeUserIds.has(u.id),
      language_preference: normalizeLanguage(u.language_preference),
      feishu_union_id: u.feishu_union_id ? ('****' + u.feishu_union_id.slice(-4)) : '',
      feishu_open_id: u.feishu_open_id ? ('****' + u.feishu_open_id.slice(-4)) : ''
    }));
    res.json(masked);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 管理员撤销某用户的全部登录凭证（session + 30 天 remember 凭证）→ 下次访问需重新飞书登录
app.post('/api/users/:id/revoke-sessions', requireApiPermission('user_manage'), asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const u = queryOne('SELECT id FROM users WHERE id=?', [userId]);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  run('DELETE FROM sessions WHERE user_id=?', [userId]);
  run('DELETE FROM persistent_logins WHERE user_id=?', [userId]);
  res.json({ success: true });
}));

app.post('/api/users', requireApiPermission('user_manage'), asyncHandler((req, res) => {
  try {
    const { id, username, name, role_id, status, email, auth_source, password, password_hash, language_preference } = req.body;
    if (!username || !name) return res.status(400).json({ error: '用户名和姓名不能为空' });
    if (password || password_hash || auth_source === 'local') {
      return res.status(400).json({ error: '不允许创建本地密码账号' });
    }
    // I18N-100P-B1：语言偏好白名单校验（缺失默认 zh）
    const lp = (language_preference === 'en' || language_preference === 'id') ? language_preference : 'zh';
    const exist = queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (exist) return res.status(400).json({ error: '用户名已存在' });
    const userId = id || genId('user');
    // 新建用户默认 pending + role_id=NULL（待管理员启用并分配角色）；仅飞书来源
    run(`INSERT INTO users (id, username, name, role_id, status, email, auth_source, language_preference) VALUES (?, ?, ?, ?, ?, ?, 'feishu', ?)`,
      [userId, username, name, null, status || 'pending', email || '', lp]);
    res.json({ id: userId, username, name, role_id: null, status: status || 'pending', email: email || '', language_preference: lp });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.put('/api/users/:id', requireApiPermission('user_manage'), asyncHandler((req, res) => {
  try {
    const { id } = req.params;
    const { username, name, role_id, status, email, password, auth_source, language_preference } = req.body;
    if (!username || !name) return res.status(400).json({ error: '用户名和姓名不能为空' });
    const user = queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (auth_source === 'local') return res.status(400).json({ error: '不允许设置为本地账号' });
    if (password) return res.status(400).json({ error: '不允许修改密码' });
    // 保护唯一 break-glass：不可停用/删除
    if (user.auth_source === 'local' && status && status !== 'active') {
      return res.status(400).json({ error: '不能停用 break-glass 应急账号' });
    }
    // I18N-100P-B1：管理员可修改语言偏好（白名单校验；缺失保留原值）
    const lp = (language_preference === 'zh' || language_preference === 'en' || language_preference === 'id')
      ? language_preference : (user.language_preference || 'zh');
    const exist = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
    if (exist) return res.status(400).json({ error: '用户名已存在' });
    // 仅更新安全字段；auth_source / 飞书身份字段 / 密码 一律不由此接口改动
    run('UPDATE users SET username=?, name=?, role_id=?, status=?, email=?, language_preference=? WHERE id=?',
      [username, name, role_id || user.role_id, status || user.status, email || '', lp, id]);
    res.json({ success: true, language_preference: lp });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.delete('/api/users/:id', requireApiPermission('user_manage'), asyncHandler((req, res) => {
  try {
    if (req.params.id === 'user_admin') return res.status(400).json({ error: '不能删除超级管理员' });
    const user = queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.auth_source === 'local') return res.status(400).json({ error: '不能删除 break-glass 应急账号' });
    run('DELETE FROM users WHERE id = ?', [req.params.id]);
    run('DELETE FROM sessions WHERE user_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 数据权限管理（角色级） ====================
// 获取角色数据权限配置
app.get('/api/roles/:id/data-scope', requireApiPermission('role_manage'), asyncHandler((req, res) => {
  try {
    const role = queryOne('SELECT id FROM roles WHERE id=?', [req.params.id]);
    if (!role) return res.status(404).json({ error: '角色不存在' });
    const scope = getRoleDataScope(req.params.id);
    res.json(scope || { countries: [], brands: [], warehouses: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 保存角色数据权限配置
app.put('/api/roles/:id/data-scope', requireApiPermission('role_manage'), asyncHandler((req, res) => {
  try {
    const role = queryOne('SELECT id FROM roles WHERE id=?', [req.params.id]);
    if (!role) return res.status(404).json({ error: '角色不存在' });
    const { countries, brands, warehouses } = req.body;
    const c = Array.isArray(countries) ? countries.filter(x => typeof x === 'string' && x) : [];
    const b = Array.isArray(brands) ? brands.filter(x => typeof x === 'string' && x) : [];
    const w = Array.isArray(warehouses) ? warehouses.filter(x => typeof x === 'string' && x) : [];
    // upsert
    run(`INSERT INTO role_data_scope (role_id, countries, brands, warehouses, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(role_id) DO UPDATE SET countries=excluded.countries, brands=excluded.brands, warehouses=excluded.warehouses, updated_at=excluded.updated_at`,
      [req.params.id, JSON.stringify(c), JSON.stringify(b), JSON.stringify(w)]);
    res.json({ success: true, countries: c, brands: b, warehouses: w });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 数据权限管理（用户级覆盖） ====================
// 获取用户数据权限配置（同时返回角色级作为参考）
app.get('/api/users/:id/data-scope', requireApiPermission('user_manage'), asyncHandler((req, res) => {
  try {
    const user = queryOne('SELECT id, role_id FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const userScope = getUserDataScope(req.params.id);
    const roleScope = getRoleDataScope(user.role_id);
    res.json({
      source: userScope ? 'personal' : 'role',
      personal: userScope,                           // null = 未配置个人覆盖
      role: roleScope || { countries: [], brands: [], warehouses: [] }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 保存用户个人数据权限（upsert）
app.put('/api/users/:id/data-scope', requireApiPermission('user_manage'), asyncHandler((req, res) => {
  try {
    const user = queryOne('SELECT id FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const { countries, brands, warehouses } = req.body;
    const c = Array.isArray(countries) ? countries.filter(x => typeof x === 'string' && x) : [];
    const b = Array.isArray(brands) ? brands.filter(x => typeof x === 'string' && x) : [];
    const w = Array.isArray(warehouses) ? warehouses.filter(x => typeof x === 'string' && x) : [];
    run(`INSERT INTO user_data_scope (user_id, countries, brands, warehouses, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET countries=excluded.countries, brands=excluded.brands, warehouses=excluded.warehouses, updated_at=excluded.updated_at`,
      [req.params.id, JSON.stringify(c), JSON.stringify(b), JSON.stringify(w)]);
    res.json({ success: true, countries: c, brands: b, warehouses: w });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 清除用户个人数据权限（删除行 → 回退到角色级）
app.delete('/api/users/:id/data-scope', requireApiPermission('user_manage'), asyncHandler((req, res) => {
  try {
    run('DELETE FROM user_data_scope WHERE user_id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 角色管理 ====================
// 权限目录（仅展示用 label 映射，非权限模型；key 集合必须与 db.js allPerms 完全一致）
const PERM_LABELS = {
  // 首页
  dashboard_view: { label: '查看', module: '首页', submodule: '' },
  // 销售
  outbound_view: { label: '查看', module: '销售', submodule: '销售数据' },
  outbound_create: { label: '新增/编辑', module: '销售', submodule: '销售数据' },
  outbound_import: { label: '导入', module: '销售', submodule: '销售数据' },
  outbound_delete: { label: '删除', module: '销售', submodule: '销售数据' },
  replenishment_view: { label: '查看', module: '销售', submodule: '订单预测' },
  replenishment_edit: { label: '生成/调参', module: '销售', submodule: '订单预测' },
  // 采购链
  po_view: { label: '查看', module: '采购链', submodule: 'PO管理' },
  po_create: { label: '创建', module: '采购链', submodule: 'PO管理' },
  po_edit: { label: '编辑', module: '采购链', submodule: 'PO管理' },
  po_export: { label: '导出', module: '采购链', submodule: 'PO管理' },
  pi_view: { label: '查看', module: '采购链', submodule: 'PI管理' },
  pi_create: { label: '创建', module: '采购链', submodule: 'PI管理' },
  pi_edit: { label: '编辑', module: '采购链', submodule: 'PI管理' },
  ci_view: { label: '查看', module: '采购链', submodule: 'CI管理' },
  ci_create: { label: '创建', module: '采购链', submodule: 'CI管理' },
  ci_edit: { label: '编辑', module: '采购链', submodule: 'CI管理' },
  logistics_view: { label: '查看', module: '采购链', submodule: '物流管理' },
  logistics_create: { label: '创建', module: '采购链', submodule: '物流管理' },
  logistics_edit: { label: '编辑', module: '采购链', submodule: '物流管理' },
  inbound_view: { label: '查看', module: '采购链', submodule: '入库管理' },
  inbound_create: { label: '创建', module: '采购链', submodule: '入库管理' },
  inbound_edit: { label: '编辑', module: '采购链', submodule: '入库管理' },
  inbound_confirm: { label: '确认', module: '采购链', submodule: '入库管理' },
  // 库存
  sku_view: { label: '查看', module: '库存', submodule: 'SKU主数据' },
  sku_create: { label: '创建', module: '库存', submodule: 'SKU主数据' },
  sku_edit: { label: '编辑', module: '库存', submodule: 'SKU主数据' },
  sku_delete: { label: '删除', module: '库存', submodule: 'SKU主数据' },
  sku_import: { label: '导入', module: '库存', submodule: 'SKU主数据' },
  sku_export: { label: '导出', module: '库存', submodule: 'SKU主数据' },
  inventory_view: { label: '查看', module: '库存', submodule: '库存总表' },
  inventory_import: { label: '导入', module: '库存', submodule: '库存总表' },
  inventory_export: { label: '导出', module: '库存', submodule: '库存总表' },
  check_view: { label: '查看', module: '库存', submodule: '库存盘点' },
  check_create: { label: '创建', module: '库存', submodule: '库存盘点' },
  check_import: { label: '导入', module: '库存', submodule: '库存盘点' },
  check_export: { label: '导出', module: '库存', submodule: '库存盘点' },
  stagnant_view: { label: '查看', module: '库存', submodule: '呆滞分析' },
  stagnant_export: { label: '导出', module: '库存', submodule: '呆滞分析' },
  // 财务
  cost_view: { label: '查看', module: '财务', submodule: '成本管理' },
  payment_view: { label: '查看', module: '财务', submodule: '付款管理' },
  payment_create: { label: '创建', module: '财务', submodule: '付款管理' },
  payment_execute: { label: '执行', module: '财务', submodule: '付款管理' },
  payment_import: { label: '导入', module: '财务', submodule: '付款管理' },
  payment_export: { label: '导出', module: '财务', submodule: '付款管理' },
  // 审批
  approval_view: { label: '审批中心入口', module: '审批', submodule: '审批中心' },
  po_approve: { label: '采购审批', module: '审批', submodule: '采购审批' },
  payment_approve: { label: '付款审批', module: '审批', submodule: '付款审批' },
  check_approve: { label: '库存审批', module: '审批', submodule: '库存审批' },
  // 系统管理
  user_manage: { label: '管理', module: '系统管理', submodule: '用户管理' },
  role_manage: { label: '管理', module: '系统管理', submodule: '角色管理' },
  system_config: { label: '配置', module: '系统管理', submodule: '系统配置' },
  forwarder_view: { label: '查看', module: '系统管理', submodule: '货代分析' },
  forwarder_export: { label: '导出', module: '系统管理', submodule: '货代分析' }
};
const ROLE_CRITICAL_PERMS = ['role_manage', 'user_manage', 'system_config'];

// 只读：暴露权限目录给角色管理 UI（不改变 RBAC 模型，不增表）
app.get('/api/permissions', requireApiPermission('role_manage'), asyncHandler((req, res) => {
  try {
    const list = Object.keys(PERM_LABELS).map(k => ({ key: k, label: PERM_LABELS[k].label, module: PERM_LABELS[k].module, submodule: PERM_LABELS[k].submodule || '' }));
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.get('/api/roles', requireApiPermission('role_manage'), asyncHandler((req, res) => {
  try {
    const result = query('SELECT * FROM roles ORDER BY created_at');
    res.json(result.rows.map(r => ({ ...r, permissions: JSON.parse(r.permissions || '[]') })));
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.post('/api/roles', requireApiPermission('role_manage'), asyncHandler((req, res) => {
  try {
    const { id, name, description, permissions } = req.body;
    const roleId = id || genId('role');
    let permsArr = Array.isArray(permissions) ? permissions.slice() : [];
    // 安全护栏：超级管理员角色必须保留关键管理权限，避免系统失去管理入口
    if (roleId === 'role_admin') {
      ROLE_CRITICAL_PERMS.forEach(p => { if (!permsArr.includes(p)) permsArr.push(p); });
    }
    run(`INSERT INTO roles (id, name, description, permissions) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, permissions=excluded.permissions`,
      [roleId, name, description || '', JSON.stringify(permsArr)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.delete('/api/roles/:id', requireApiPermission('role_manage'), asyncHandler((req, res) => {
  try {
    if (req.params.id === 'role_admin') return res.status(400).json({ error: '不能删除超级管理员角色' });
    run('DELETE FROM roles WHERE id = ? AND is_system = 0', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 国家管理 ====================
app.get('/api/countries', requireLogin, asyncHandler((req, res) => {
  res.json(query('SELECT * FROM countries ORDER BY sort_order').rows);
}));
app.post('/api/countries', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const { id, name, code, default_currency, status, sort_order } = req.body;
  const cId = id || genId('country');
  run(`INSERT INTO countries (id, name, code, default_currency, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, default_currency=excluded.default_currency, status=excluded.status, sort_order=excluded.sort_order`,
    [cId, name, code, default_currency || '', status || 'active', sort_order || 0]);
  res.json({ success: true });
}));
app.delete('/api/countries/:id', requireApiPermission('system_config'), asyncHandler((req, res) => {
  run('DELETE FROM countries WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

// ==================== 仓库管理 ====================
app.get('/api/warehouses', requireLogin, asyncHandler((req, res) => {
  const { country_id } = req.query;
  let sql = 'SELECT * FROM warehouses';
  const params = [];
  if (country_id) { sql += ' WHERE country_id = ?'; params.push(country_id); }
  sql += ' ORDER BY sort_order';
  res.json(query(sql, params).rows);
}));
app.post('/api/warehouses', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const { id, name, country_id, country_name, warehouse_type, address, status, brands, sort_order } = req.body;
  const wId = id || genId('wh');
  run(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, address, status, brands, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, country_id=excluded.country_id, country_name=excluded.country_name, warehouse_type=excluded.warehouse_type, address=excluded.address, status=excluded.status, brands=excluded.brands, sort_order=excluded.sort_order`,
    [wId, name, country_id || '', country_name || '', warehouse_type || 'self', address || '', status || 'active', brands || '', sort_order || 0]);
  res.json({ success: true, id: wId });
}));
// 获取仓库所属国家列表（用于下拉联动，数据来源为 warehouses 表）
// DATA-SCOPE: 根据角色数据权限过滤可见国家
app.get('/api/warehouses/countries', requireLogin, asyncHandler((req, res) => {
  let sql = "SELECT DISTINCT country_name FROM warehouses WHERE status = 'active' AND country_name IS NOT NULL AND country_name != ''";
  const params = [];
  if (needsDataScopeFilter(req)) {
    const scope = req.currentUserDataScope;
    const conditions = [];
    // 国家维度：解析 country_ids → country_name 列表
    let effectiveCountryIds = [];
    if (scope.countries && scope.countries.length > 0) {
      effectiveCountryIds = effectiveCountryIds.concat(scope.countries);
    }
    // 仓库维度：解析 warehouse_ids → country_id，追加到国家过滤
    if (scope.warehouses && scope.warehouses.length > 0) {
      const whRows = query('SELECT DISTINCT country_id FROM warehouses WHERE id IN (' +
        scope.warehouses.map(() => '?').join(',') + ") AND country_id != ''", scope.warehouses).rows;
      whRows.forEach(r => { if (r.country_id && effectiveCountryIds.indexOf(r.country_id) < 0) effectiveCountryIds.push(r.country_id); });
      // 同时直接限制 warehouse id
      conditions.push('id IN (' + scope.warehouses.map(() => '?').join(',') + ')');
      params.push(...scope.warehouses);
    }
    if (effectiveCountryIds.length > 0) {
      // 解析 country_ids → country_name，与 warehouses.country_name 匹配
      const countryRows = query('SELECT name FROM countries WHERE id IN (' +
        effectiveCountryIds.map(() => '?').join(',') + ')', effectiveCountryIds).rows;
      const countryNames = countryRows.map(r => r.name).filter(n => n);
      if (countryNames.length > 0) {
        conditions.push('country_name IN (' + countryNames.map(() => '?').join(',') + ')');
        params.push(...countryNames);
      }
    }
    if (conditions.length > 0) {
      sql += ' AND (' + conditions.join(' OR ') + ')';
    }
  }
  sql += ' ORDER BY country_name';
  const rows = query(sql, params).rows.map(r => r.country_name);
  res.json(rows);
}));
// 寄售仓权威清单：直接来自 consignment_inventory_lots.warehouse_name（寄售库存投影进 inventory 的仓库名）。
// 不写死任何仓库名，也不新增 warehouse_type / is_consignment 等 schema（仅解除寄售仓与订单预测的关联）。
// 权威清单双来源并集：
//   1) consignment_inventory_lots.warehouse_name（寄售库存投影进 inventory 的仓名）
//   2) warehouses 表中名称含 consign 的 active 仓（生产环境寄售仓实际登记处）
// 仅用于订单预测相关查询过滤，不影响库存模块 / WAC / 寄售库存本身。
// executor-aware：传 exec 时所有查询走 exec.all（同一事务连接）；
// 不传 exec 时保持现有 global query 行为（页面路由/ generate 现网路径不变）。
// 纯 SQL 构造：把寄售仓名单追加为 NOT IN 排除条件（名单为空时不拼接，避免 NOT IN () 非法 SQL）。
// 自动处理前导：有 WHERE 内容用 AND，尚无则用 WHERE 起头。
// 同步 reader（global query）与异步 transaction reader（exec.all）共用此纯函数，避免两套“哪些仓算寄售”口径漂移。
function buildConsignmentExclusion(names, sql, params, columnExpr) {
  if (names && names.length > 0) {
    sql += (sql ? ' AND' : ' WHERE') + ' ' + columnExpr + ' NOT IN (' + names.map(() => '?').join(',') + ')';
    params.push(...names);
  }
  return sql;
}
// 同步 reader：走 global query，供历史同步页面 / generate 调用（不进入事务连接）。
function getConsignmentWarehouseNames() {
  const names = new Set();
  const src = (sql) => (query(sql, []).rows || []);
  const res1 = src("SELECT DISTINCT warehouse_name FROM consignment_inventory_lots WHERE warehouse_name IS NOT NULL AND warehouse_name != ''");
  (res1 || []).forEach(r => { if (r.warehouse_name) names.add(r.warehouse_name); });
  const res2 = src("SELECT DISTINCT name FROM warehouses WHERE LOWER(name) LIKE '%consign%' AND status = 'active'");
  (res2 || []).forEach(r => { if (r.name) names.add(r.name); });
  return Array.from(names);
}
// 异步 transaction reader：经 exec.all（Promise）读取，仍使用同一事务连接，供 DELETE/refresh 等事务路径调用。
async function getConsignmentWarehouseNamesWithExec(exec) {
  const names = new Set();
  const res1 = await exec.all("SELECT DISTINCT warehouse_name FROM consignment_inventory_lots WHERE warehouse_name IS NOT NULL AND warehouse_name != ''", []);
  (res1 || []).forEach(r => { if (r.warehouse_name) names.add(r.warehouse_name); });
  const res2 = await exec.all("SELECT DISTINCT name FROM warehouses WHERE LOWER(name) LIKE '%consign%' AND status = 'active'", []);
  (res2 || []).forEach(r => { if (r.name) names.add(r.name); });
  return Array.from(names);
}
// 同步版：供同步页面 / generate 调用，口径与异步版完全一致（共用 buildConsignmentExclusion）。
function appendConsignmentExclusion(sql, params, columnExpr, exec) {
  const names = getConsignmentWarehouseNames();
  return buildConsignmentExclusion(names, sql, params, columnExpr);
}
// 异步事务版：DELETE / refresh 路径专用，所有查询经 await exec.all 走同一事务连接。
async function appendConsignmentExclusionWithExec(sql, params, columnExpr, exec) {
  const names = await getConsignmentWarehouseNamesWithExec(exec);
  return buildConsignmentExclusion(names, sql, params, columnExpr);
}

// 按国家筛选仓库（用于订单预测等页面的下拉联动）
// DATA-SCOPE: 根据角色数据权限过滤可见仓库
app.get('/api/warehouses/by-country', requireLogin, asyncHandler((req, res) => {
  const { country } = req.query;
  let sql = "SELECT id, name, country_name, brands, warehouse_type FROM warehouses WHERE status = 'active'";
  const params = [];
  if (country) { sql += ' AND country_name = ?'; params.push(country); }
  // 订单预测仓库选项排除寄售仓（“全部”=参与订单预测的正常仓库）
  sql = appendConsignmentExclusion(sql, params, 'name');
  if (needsDataScopeFilter(req)) {
    const scope = req.currentUserDataScope;
    const conditions = [];
    // 仓库维度：直接限制 warehouse id
    if (scope.warehouses && scope.warehouses.length > 0) {
      conditions.push('id IN (' + scope.warehouses.map(() => '?').join(',') + ')');
      params.push(...scope.warehouses);
    }
    // 国家维度：解析 country_ids → country_name
    let effectiveCountryIds = [];
    if (scope.countries && scope.countries.length > 0) {
      effectiveCountryIds = effectiveCountryIds.concat(scope.countries);
    }
    if (scope.warehouses && scope.warehouses.length > 0) {
      const whRows = query('SELECT DISTINCT country_id FROM warehouses WHERE id IN (' +
        scope.warehouses.map(() => '?').join(',') + ") AND country_id != ''", scope.warehouses).rows;
      whRows.forEach(r => { if (r.country_id && effectiveCountryIds.indexOf(r.country_id) < 0) effectiveCountryIds.push(r.country_id); });
    }
    if (effectiveCountryIds.length > 0) {
      const countryRows = query('SELECT name FROM countries WHERE id IN (' +
        effectiveCountryIds.map(() => '?').join(',') + ')', effectiveCountryIds).rows;
      const countryNames = countryRows.map(r => r.name).filter(n => n);
      if (countryNames.length > 0) {
        conditions.push('country_name IN (' + countryNames.map(() => '?').join(',') + ')');
        params.push(...countryNames);
      }
    }
    if (conditions.length > 0) {
      sql += ' AND (' + conditions.join(' OR ') + ')';
    }
  }
  sql += ' ORDER BY sort_order, name';
  res.json(query(sql, params).rows);
}));
// 按 (国家, 品牌) 筛选仓库
// DATA-SCOPE: 根据角色数据权限过滤可见仓库
app.get('/api/warehouses/by-country-brand', requireLogin, asyncHandler((req, res) => {
  const { country, brand } = req.query;
  let sql = `SELECT id, name, country_name, brands, warehouse_type FROM warehouses WHERE status = 'active'`;
  const params = [];
  if (country) { sql += ' AND country_name = ?'; params.push(country); }
  if (brand) {
    sql += ` AND (brands = '' OR brands LIKE ? OR brands LIKE ? OR brands LIKE ? OR brands LIKE ?)`;
    params.push('%'+brand+'%', brand+',%', '%,'+brand, '%,'+brand+',%');
  }
  // 订单预测仓库选项排除寄售仓（“全部”=参与订单预测的正常仓库）
  sql = appendConsignmentExclusion(sql, params, 'name');
  if (needsDataScopeFilter(req)) {
    const scope = req.currentUserDataScope;
    if (scope.warehouses && scope.warehouses.length > 0) {
      sql += ' AND id IN (' + scope.warehouses.map(() => '?').join(',') + ')';
      params.push(...scope.warehouses);
    }
  }
  sql += ' ORDER BY sort_order, name';
  res.json(query(sql, params).rows);
}));
// 获取系统中所有出现过的品牌（从 skus + po + pi + ci 聚合）
// DATA-SCOPE: 根据角色数据权限过滤可见品牌
app.get('/api/brands/all', requireLogin, asyncHandler((req, res) => {
  let rows = query(`
    SELECT DISTINCT brand FROM (
      SELECT brand FROM skus WHERE brand IS NOT NULL AND brand != ''
      UNION SELECT brand FROM purchase_orders WHERE brand IS NOT NULL AND brand != ''
      UNION SELECT brand FROM proforma_invoices WHERE brand IS NOT NULL AND brand != ''
      UNION SELECT brand FROM commercial_invoices WHERE brand IS NOT NULL AND brand != ''
    ) ORDER BY brand
  `).rows.map(r => r.brand);
  // DATA-SCOPE: 根据角色数据权限过滤可见品牌
  if (needsDataScopeFilter(req)) {
    const scope = req.currentUserDataScope;
    if (scope.brands && scope.brands.length > 0) {
      rows = rows.filter(b => scope.brands.includes(b));
    }
  }
  res.json(rows);
}));
// 品牌采购状态（停采品牌系统级规则）：读取/保存品牌级 可采购/停采
app.get('/api/brand-settings', requireApiPermission('system_config'), asyncHandler((req, res) => {
  try {
    const rows = query('SELECT brand, procurement_status, note FROM brand_settings ORDER BY brand').rows;
    res.json(rows);
  } catch (e) { res.json([]); }
}));
app.post('/api/brand-settings', requireApiPermission('system_config'), asyncHandler((req, res) => {
  try {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    const valid = items.filter(it => it && it.brand && (it.procurement_status === 'active' || it.procurement_status === 'stopped'));
    if (!valid.length) return res.json({ success: false, message: '没有有效的品牌状态记录' });
    transaction(() => {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      for (const it of valid) {
        run(`INSERT INTO brand_settings (brand, procurement_status, note, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(brand) DO UPDATE SET procurement_status=excluded.procurement_status, note=excluded.note, updated_at=excluded.updated_at`,
          [String(it.brand).trim(), it.procurement_status, (it.note || '').toString(), now]);
      }
    });
    res.json({ success: true, count: valid.length });
  } catch (e) { res.json({ success: false, message: e.message }); }
}));
app.delete('/api/warehouses/:id', requireApiPermission('system_config'), asyncHandler((req, res) => {
  run('DELETE FROM warehouses WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

// ==================== 供应商管理 ====================
app.get('/api/suppliers', requireLogin, asyncHandler((req, res) => {
  const rows = query('SELECT * FROM suppliers ORDER BY created_at DESC').rows;
  // 从 supplier_brand_configs 聚合品牌，覆盖旧 associated_brands 字段
  const brandRows = query(`
    SELECT supplier_id, brand
    FROM supplier_brand_configs
    WHERE status = 'active' AND brand != ''
    ORDER BY brand ASC
  `).rows;
  const brandMap = {};
  for (const r of brandRows) {
    if (!brandMap[r.supplier_id]) brandMap[r.supplier_id] = new Set();
    brandMap[r.supplier_id].add(r.brand);
  }
  // 获取每个供应商的默认付款条件 credit_days
  const creditRows = query(`
    SELECT supplier_id, credit_days, term_name
    FROM supplier_payment_terms
    WHERE is_default = 1 AND status = 'active'
  `).rows;
  const creditMap = {};
  for (const c of creditRows) {
    if (!creditMap[c.supplier_id]) creditMap[c.supplier_id] = { credit_days: c.credit_days, term_name: c.term_name };
  }
  for (const s of rows) {
    const brands = brandMap[s.id] ? Array.from(brandMap[s.id]) : [];
    s.associated_brands = JSON.stringify(brands);
    const credit = creditMap[s.id] || { credit_days: 0, term_name: '' };
    s.default_credit_days = credit.credit_days;
    s.default_term_name = credit.term_name;
  }
  res.json(rows);
}));
app.post('/api/suppliers', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body;
  const sId = d.id || genId('supplier');
  const associatedBrands = Array.isArray(d.associated_brands) ? JSON.stringify(d.associated_brands) : (d.associated_brands || '[]');
  run(`INSERT INTO suppliers (id, name, short_name, contact_person, phone, email, address, associated_brands, default_currency, payment_terms, remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, contact_person=excluded.contact_person, phone=excluded.phone, email=excluded.email, address=excluded.address, associated_brands=excluded.associated_brands, default_currency=excluded.default_currency, payment_terms=excluded.payment_terms, remark=excluded.remark, status=excluded.status`,
    [sId, d.name, d.short_name || '', d.contact_person || '', d.phone || '', d.email || '', d.address || '', associatedBrands, d.default_currency || 'USD', d.payment_terms || '', d.remark || '', d.status || 'active']);
  // 同步品牌关联到 supplier_brand_configs 表（GET 接口从该表读取品牌）
  run('DELETE FROM supplier_brand_configs WHERE supplier_id = ?', [sId]);
  const brandList = Array.isArray(d.associated_brands) ? d.associated_brands : (() => { try { return JSON.parse(associatedBrands); } catch (e) { return []; } })();
  for (const brand of brandList) {
    if (brand && String(brand).trim()) {
      run(`INSERT INTO supplier_brand_configs (id, supplier_id, brand, country, warehouse_id, status, created_at) VALUES (?, ?, ?, '', '', 'active', datetime('now'))`,
        [genId('sbc'), sId, String(brand).trim()]);
    }
  }
  res.json({ success: true, id: sId });
}));
app.delete('/api/suppliers/:id', requireApiPermission('system_config'), asyncHandler((req, res) => {
  run('DELETE FROM supplier_payment_terms WHERE supplier_id = ?', [req.params.id]);
  run('DELETE FROM supplier_brand_configs WHERE supplier_id = ?', [req.params.id]);
  run('DELETE FROM suppliers WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));
// PI 保存时回写"上一次实际使用的付款条件"，供下次新建 PI 默认带出
app.post('/api/suppliers/:id/last-payment-term', requireApiPermission('pi_create'), asyncHandler((req, res) => {
  const termId = req.body && req.body.payment_term_id ? String(req.body.payment_term_id) : '';
  run('UPDATE suppliers SET last_used_payment_term_id = ? WHERE id = ?', [termId, req.params.id]);
  res.json({ success: true, last_used_payment_term_id: termId });
}));

// ==================== 供应商付款条件（结构化多条，独立于付款申请 payment_terms 目录表） ====================
app.get('/api/suppliers/:id/payment-terms', requireLogin, asyncHandler((req, res) => {
  const rows = query('SELECT * FROM supplier_payment_terms WHERE supplier_id = ? AND status = ? ORDER BY display_order ASC, created_at ASC', [req.params.id, 'active']).rows;
  res.json(rows);
}));
app.post('/api/supplier-payment-terms', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body;
  if (!d.supplier_id) { res.status(400).json({ error: 'supplier_id 必填' }); return; }
  const tId = d.id || genId('spt');
  const termType = ['advance', 'credit', 'other'].includes(d.term_type) ? d.term_type : 'advance';
  const isDefault = d.is_default ? 1 : 0;
  if (isDefault) run('UPDATE supplier_payment_terms SET is_default = 0 WHERE supplier_id = ?', [d.supplier_id]);
  run(`INSERT INTO supplier_payment_terms (id, supplier_id, term_name, term_type, credit_days, is_default, display_order, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET term_name=excluded.term_name, term_type=excluded.term_type, credit_days=excluded.credit_days, is_default=excluded.is_default, display_order=excluded.display_order, status=excluded.status`,
    [tId, d.supplier_id, d.term_name || '', termType, d.credit_days || 0, isDefault, d.display_order || 0, d.status || 'active']);
  res.json({ success: true, id: tId });
}));
app.put('/api/supplier-payment-terms/:id', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body;
  const existing = queryOne('SELECT * FROM supplier_payment_terms WHERE id = ?', [req.params.id]);
  if (!existing) { res.status(404).json({ error: '未找到该付款条件' }); return; }
  const termType = ['advance', 'credit', 'other'].includes(d.term_type) ? d.term_type : existing.term_type;
  const isDefault = d.is_default ? 1 : 0;
  if (isDefault) run('UPDATE supplier_payment_terms SET is_default = 0 WHERE supplier_id = ?', [existing.supplier_id]);
  run(`UPDATE supplier_payment_terms SET term_name=?, term_type=?, credit_days=?, is_default=?, display_order=?, status=? WHERE id = ?`,
    [d.term_name || '', termType, d.credit_days || 0, isDefault, d.display_order != null ? d.display_order : existing.display_order, d.status || existing.status, req.params.id]);
  res.json({ success: true });
}));
app.delete('/api/supplier-payment-terms/:id', requireApiPermission('system_config'), asyncHandler((req, res) => {
  run('DELETE FROM supplier_payment_terms WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));
// 整供应商替换付款条件（保存供应商时调用：先删后插，保持数据纯净且支持新增/改名/删除/改默认）
app.post('/api/suppliers/:id/payment-terms', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const supplierId = req.params.id;
  const list = Array.isArray(req.body) ? req.body : (req.body.list || []);
  run('DELETE FROM supplier_payment_terms WHERE supplier_id = ?', [supplierId]);
  let hasDefault = false;
  list.forEach((t, idx) => {
    const isDefault = t.is_default ? 1 : 0;
    if (isDefault) hasDefault = true;
    const termType = ['advance', 'credit', 'other'].includes(t.term_type) ? t.term_type : 'advance';
    const tId = (t.id && !String(t.id).startsWith('_new_')) ? t.id : genId('spt');
    run(`INSERT INTO supplier_payment_terms (id, supplier_id, term_name, term_type, credit_days, is_default, display_order, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tId, supplierId, t.term_name || '', termType, t.credit_days || 0, isDefault, idx, t.status || 'active']);
  });
  res.json({ success: true, count: list.length });
}));

// ==================== 供应商供应关系配置（supplier+brand+country+warehouse 组合，一行一组） ====================
// 读取该供应商所有有效组合，LEFT JOIN warehouses 带出 warehouse_name 供前端展示
app.get('/api/suppliers/:id/brand-configs', requireLogin, asyncHandler((req, res) => {
  const rows = query(`
    SELECT c.id, c.supplier_id, c.brand, c.country, c.warehouse_id,
           w.name AS warehouse_name, w.country_name AS warehouse_country
    FROM supplier_brand_configs c
    LEFT JOIN warehouses w ON c.warehouse_id = w.id
    WHERE c.supplier_id = ? AND c.status = 'active'
    ORDER BY c.created_at ASC
  `, [req.params.id]).rows;
  res.json(rows);
}));
// 整供应商替换供应关系配置（保存供应商时调用：先删后插，参照 payment-terms 模式）
app.post('/api/suppliers/:id/brand-configs', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const supplierId = req.params.id;
  const list = Array.isArray(req.body) ? req.body : (req.body.list || []);
  run('DELETE FROM supplier_brand_configs WHERE supplier_id = ?', [supplierId]);
  list.forEach((item) => {
    if (!item || (!item.brand && !item.country && !item.warehouse_id)) return; // 跳过空行
    const cId = (item.id && !String(item.id).startsWith('_new_')) ? item.id : genId('sbc');
    run(`INSERT INTO supplier_brand_configs (id, supplier_id, brand, country, warehouse_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))`,
      [cId, supplierId, item.brand || '', item.country || '', item.warehouse_id || '']);
  });
  res.json({ success: true, count: list.length });
}));

// ==================== 货代管理 ====================
app.get('/api/freight-forwarders', requireLogin, asyncHandler((req, res) => {
  res.json(query('SELECT * FROM freight_forwarders ORDER BY created_at DESC').rows);
}));
app.post('/api/freight-forwarders', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body;
  const fId = d.id || genId('ff');
  run(`INSERT INTO freight_forwarders (id, name, short_name, contact_person, phone, email, service_types, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, contact_person=excluded.contact_person, phone=excluded.phone, email=excluded.email, service_types=excluded.service_types, status=excluded.status`,
    [fId, d.name, d.short_name || '', d.contact_person || '', d.phone || '', d.email || '', d.service_types || '', d.status || 'active']);
  res.json({ success: true });
}));
app.delete('/api/freight-forwarders/:id', requireApiPermission('system_config'), asyncHandler((req, res) => {
  run('DELETE FROM freight_forwarders WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

// ==================== 币种管理 ====================
app.get('/api/currencies', requireLogin, asyncHandler((req, res) => {
  res.json(query('SELECT * FROM currencies ORDER BY sort_order').rows);
}));
app.post('/api/currencies', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body;
  const cId = d.id || genId('cur');
  run(`INSERT INTO currencies (id, code, name, symbol, is_base, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, symbol=excluded.symbol, is_base=excluded.is_base, sort_order=excluded.sort_order, status=excluded.status`,
    [cId, d.code, d.name, d.symbol || '', d.is_base || 0, d.sort_order || 0, d.status || 'active']);
  res.json({ success: true });
}));
app.delete('/api/currencies/:id', requireApiPermission('system_config'), asyncHandler((req, res) => {
  run('DELETE FROM currencies WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

// ==================== 汇率管理 ====================
app.get('/api/exchange-rates', requireLogin, asyncHandler((req, res) => {
  const { from, to } = req.query;
  let sql = 'SELECT * FROM exchange_rates';
  const params = [];
  if (from && to) { sql += ' WHERE from_currency = ? AND to_currency = ?'; params.push(from, to); }
  sql += ' ORDER BY rate_date DESC LIMIT 100';
  res.json(query(sql, params).rows);
}));
app.post('/api/exchange-rates', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body;
  const rId = d.id || genId('rate');
  run(`INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)`,
    [rId, d.from_currency, d.to_currency, d.rate, d.rate_date, d.rate_type || 'realtime']);
  res.json({ success: true });
}));

// 获取最新汇率
app.get('/api/exchange-rates/latest', requireLogin, asyncHandler((req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.json({ rate: 1 });
  if (from === to) return res.json({ rate: 1 });
  const rate = queryOne('SELECT * FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY rate_date DESC LIMIT 1', [from, to]);
  if (rate) return res.json(rate);
  // 反向查找
  const reverse = queryOne('SELECT * FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY rate_date DESC LIMIT 1', [to, from]);
  if (reverse) return res.json({ ...reverse, rate: 1 / reverse.rate, from_currency: from, to_currency: to });
  return res.json({ rate: 1 });
}));

// 获取库存相关国家的货币信息 + 对人民币汇率（自动从免费API获取实时汇率并缓存）
const CURRENCY_API_MAP = { 'RMB': 'CNY' }; // 系统内部用RMB，API用CNY
// 国家名别名映射（库存数据中的名称 → countries表中的标准名）
const COUNTRY_ALIAS_MAP = {
  '印度尼西亚': '印尼', '印度尼西亚共和国': '印尼',
  '马来西亚': '马来', '马来西亚联邦': '马来',
  '泰王国': '泰国',
};
app.get('/api/inventory/currency-rates', requireLogin, asyncHandler(async (req, res) => {
  try {
    // 0. 获取countries表的标准国家名→货币映射
    const allCountries = query('SELECT name, default_currency FROM countries WHERE status = ? AND default_currency IS NOT NULL AND default_currency != ?', ['active', '']).rows;
    const countryToCurrency = {}; // 标准名 → {code, ...}
    allCountries.forEach(c => { countryToCurrency[c.name] = c.default_currency; });

    // 获取货币符号映射
    const allCurrencies = query('SELECT code, symbol, name FROM currencies WHERE status = ?', ['active']).rows;
    const currencyInfo = {}; // code → {symbol, name}
    allCurrencies.forEach(c => { currencyInfo[c.code] = { symbol: c.symbol, name: c.name }; });

    // 1. 查库存中涉及的国家
    const invCountries = query(`SELECT DISTINCT country FROM inventory WHERE country IS NOT NULL AND country != '' ORDER BY country`).rows.map(r => r.country);

    // 2. 为每个库存国家匹配货币（支持别名）
    const countries = [];
    invCountries.forEach(country => {
      // 先直接匹配标准名
      let currencyCode = countryToCurrency[country];
      // 再尝试别名匹配
      if (!currencyCode) {
        const alias = COUNTRY_ALIAS_MAP[country];
        if (alias) currencyCode = countryToCurrency[alias];
      }
      const ci = currencyCode ? currencyInfo[currencyCode] : null;
      countries.push({
        country,
        default_currency: currencyCode || null,
        symbol: ci ? ci.symbol : null,
        currency_name: ci ? ci.name : null
      });
    });

    // 2. 收集去重货币
    const currencySet = new Set();
    countries.forEach(c => { if (c.default_currency) currencySet.add(c.default_currency); });
    const currencies = Array.from(currencySet);

    // 3. 逐个查汇率（先查DB，无则从API获取）
    const today = new Date().toISOString().split('T')[0];
    const rates = {};

    for (const curr of currencies) {
      if (curr === 'RMB' || curr === 'CNY') { rates[curr] = { rate: 1, date: today, source: 'base' }; continue; }
      // 查DB中今天的汇率
      let row = queryOne('SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? ORDER BY created_at DESC LIMIT 1', [curr, 'RMB', today]);
      if (!row) {
        // 查DB中最新汇率（不限日期）
        row = queryOne('SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY rate_date DESC, created_at DESC LIMIT 1', [curr, 'RMB']);
      }
      if (row) {
        // DB中存的是 1外币=X人民币（foreignToRmb），转换为 1人民币=X外币（cnyToForeign）
        const cnyToForeign = row.rate > 0 ? Math.round((1 / row.rate) * 1000000) / 1000000 : 0;
        rates[curr] = { rate: cnyToForeign, date: row.rate_date, source: row.rate_date === today ? 'db_today' : 'db_cached' };
      } else {
        rates[curr] = null; // 标记为需要从API获取
      }
    }

    // 4. 对缺失的汇率，批量从免费API获取
    const missingCurrencies = currencies.filter(c => c !== 'RMB' && c !== 'CNY' && !rates[c]);
    if (missingCurrencies.length > 0) {
      try {
        const apiCode = 'CNY';
        const resp = await fetch(`https://open.er-api.com/v6/latest/${apiCode}`);
        const data = await resp.json();
        if (data && data.rates) {
          for (const curr of missingCurrencies) {
            const apiCurr = CURRENCY_API_MAP[curr] || curr;
            const cnyToForeign = data.rates[apiCurr]; // 1 CNY = X 外币（API直接返回）
            if (cnyToForeign && cnyToForeign > 0) {
              const foreignToRmb = 1 / cnyToForeign; // 换算为 1外币=X人民币 用于缓存
              rates[curr] = { rate: cnyToForeign, date: today, source: 'realtime' };
              // 缓存到DB（存foreignToRmb方便复用）
              run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',
                [genId('rate'), curr, 'RMB', foreignToRmb, today, 'realtime']);
            }
          }
        }
      } catch (fetchErr) {
        console.warn('[currency-rates] Failed to fetch real-time rates:', fetchErr.message);
      }
    }

    res.json({ countries, currencies, rates, base_currency: 'RMB', rate_date: today });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

// 强制刷新汇率（删除今天的缓存，重新从API获取）
app.post('/api/exchange-rates/refresh', requireApiPermission('inventory_view'), asyncHandler(async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    // 删除今天的汇率缓存
    run('DELETE FROM exchange_rates WHERE rate_date = ? AND rate_type = ?', [today, 'realtime']);
    // 获取库存中涉及的国家货币
    const countries = query(`
      SELECT DISTINCT c.default_currency FROM inventory i
      JOIN countries c ON i.country = c.name
      WHERE c.default_currency IS NOT NULL AND c.default_currency != '' AND c.default_currency NOT IN ('RMB','CNY')
    `).rows;
    const currencies = [...new Set(countries.map(c => c.default_currency))];
    const refreshed = {};
    if (currencies.length > 0) {
      try {
        const resp = await fetch('https://open.er-api.com/v6/latest/CNY');
        const data = await resp.json();
        if (data && data.rates) {
          for (const curr of currencies) {
            const apiCurr = CURRENCY_API_MAP[curr] || curr;
            const cnyToForeign = data.rates[apiCurr];
            if (cnyToForeign && cnyToForeign > 0) {
              const foreignToRmb = 1 / cnyToForeign;
              refreshed[curr] = Math.round(foreignToRmb * 1000000) / 1000000;
              run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',
                [genId('rate'), curr, 'RMB', foreignToRmb, today, 'realtime']);
            }
          }
        }
      } catch (fetchErr) {
        return res.status(503).json({ error: '获取实时汇率失败: ' + fetchErr.message });
      }
    }
    res.json({ success: true, refreshed, date: today });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

// ==================== 付款条件管理 ====================
app.get('/api/payment-terms', requireLogin, asyncHandler((req, res) => {
  res.json(query('SELECT * FROM payment_terms ORDER BY created_at').rows);
}));
app.post('/api/payment-terms', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body;
  const pId = d.id || genId('pt');
  run(`INSERT INTO payment_terms (id, name, payee_type, payment_type, payment_stage, payment_node, ratio, remind_days_before, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, payee_type=excluded.payee_type, payment_type=excluded.payment_type, payment_stage=excluded.payment_stage, payment_node=excluded.payment_node, ratio=excluded.ratio, remind_days_before=excluded.remind_days_before, is_enabled=excluded.is_enabled`,
    [pId, d.name, d.payee_type || 'factory', d.payment_type || 'goods', d.payment_stage || 'deposit', d.payment_node || 'after_pi', d.ratio || 0, d.remind_days_before || 7, d.is_enabled !== undefined ? d.is_enabled : 1]);
  res.json({ success: true });
}));
app.delete('/api/payment-terms/:id', requireApiPermission('system_config'), asyncHandler((req, res) => {
  run('DELETE FROM payment_terms WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

// 付款条件下拉选项（合并 payment_terms 全局目录 + supplier_payment_terms 供应商级）
app.get('/api/payment-term-options', requireLogin, asyncHandler((req, res) => {
  const global = query('SELECT DISTINCT name FROM payment_terms WHERE is_enabled = 1').rows.map(r => ({ name: r.name, credit_days: 0, source: 'global' }));
  const supplier = query("SELECT DISTINCT term_name as name, credit_days FROM supplier_payment_terms WHERE status = 'active'").rows.map(r => ({ ...r, source: 'supplier' }));
  // Merge unique by name, prefer supplier (has credit_days)
  const seen = new Set();
  const merged = [];
  for (const item of [...supplier, ...global]) {
    if (!seen.has(item.name)) { seen.add(item.name); merged.push(item); }
  }
  res.json(merged);
}));

// ==================== 审批流管理 ====================
app.get('/api/approval-flows', requireApiPermission('system_config'), asyncHandler((req, res) => {
  // PAY-CORE Phase 1：返回 completion_cc_user_ids；老库兼容（字段可能不存在时默认 []）
  res.json(query('SELECT * FROM approval_flows ORDER BY created_at').rows.map(f => ({
    ...f,
    levels: JSON.parse(f.levels || '[]'),
    completion_cc_user_ids: JSON.parse(f.completion_cc_user_ids || '[]')
  })));
}));
app.post('/api/approval-flows', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body;
  const fId = d.id || genId('flow');
  const name = (d.name || '').trim();
  const businessType = (d.business_type || '').trim();
  const isEnabled = d.is_enabled !== undefined ? d.is_enabled : 1;
  if (!name) return res.status(400).json({ error: '审批流名称不能为空' });
  if (!businessType) return res.status(400).json({ error: '业务类型不能为空' });

  // N5: 不可信前端提交的姓名/角色/状态/权限，必须从 DB 重新读取并校验
  let levels = d.levels;
  if (!Array.isArray(levels) || levels.length === 0) {
    return res.status(400).json({ error: '审批流至少需要配置一个审批级次' });
  }
  // 级次按升序校验：必须连续从 1 开始、无重复、无缺漏
  const sorted = levels.slice().sort((a, b) => Number(a.level) - Number(b.level));
  const validated = [];
  let expected = 1;
  for (const lv of sorted) {
    const lvl = Number(lv.level);
    if (!Number.isInteger(lvl) || lvl < 1) return res.status(400).json({ error: '审批级次必须为正整数' });
    if (lvl !== expected) return res.status(400).json({ error: '审批级次必须连续（从 1 开始，无重复/缺漏）' });
    expected++;
    const uid = (lv.approver_user_id || '').trim();
    if (!uid) return res.status(400).json({ error: '第 ' + lvl + ' 级审批人不能为空' });
    const u = queryOne('SELECT id, name, role_id, status FROM users WHERE id = ?', [uid]);
    if (!u) return res.status(400).json({ error: '第 ' + lvl + ' 级审批用户不存在（可能已被删除）' });
    if (u.status !== 'active') return res.status(400).json({ error: '第 ' + lvl + ' 级审批用户「' + u.name + '」状态非 active，不可选为审批人' });
    if (!u.role_id) return res.status(400).json({ error: '第 ' + lvl + ' 级审批用户「' + u.name + '」未绑定有效角色' });
    const role = queryOne('SELECT id, name, permissions FROM roles WHERE id = ?', [u.role_id]);
    if (!role) return res.status(400).json({ error: '第 ' + lvl + ' 级审批用户「' + u.name + '」绑定的角色不存在' });
    let perms = [];
    try { perms = JSON.parse(role.permissions || '[]'); } catch (e) { perms = []; }
    // PAY-CORE 补充：按 business_type 动态校验权限（po→po_approve；PAY-CORE 6 类→payment_approve）
    const requiredPerm = approvalRequiredPermission(businessType);
    if (!perms.includes(requiredPerm)) return res.status(400).json({ error: '第 ' + lvl + ' 级审批用户「' + u.name + '」的角色「' + role.name + '」不具备 ' + requiredPerm + ' 权限，不可选为审批人' });
    // PAY-CORE Phase 1：节点 CC 校验——必须是 active 用户的 id 数组（不要求 payment_approve 权限，仅作通知收件人）
    let ccUserIds = [];
    if (Array.isArray(lv.cc_user_ids)) {
      for (const ccUid of lv.cc_user_ids) {
        const ccU = queryOne('SELECT id, name, status FROM users WHERE id = ?', [ccUid]);
        if (!ccU) return res.status(400).json({ error: '第 ' + lvl + ' 级节点 CC 用户不存在（id=' + ccUid + '）' });
        if (ccU.status !== 'active') return res.status(400).json({ error: '第 ' + lvl + ' 级节点 CC 用户「' + ccU.name + '」状态非 active' });
        if (!ccUserIds.includes(ccU.id)) ccUserIds.push(ccU.id);
      }
    }
    // 后端写入真实快照，丢弃前端伪造的姓名/角色；保留规范化后的 cc_user_ids
    validated.push({ level: lvl, approver_user_id: u.id, approver_name: u.name, approver_role_id: u.role_id, cc_user_ids: ccUserIds });
  }

  // PAY-CORE Phase 1：完成 CC 校验——必须是 active 用户的 id 数组（不要求 payment_approve 权限）
  let completionCcUserIds = [];
  if (Array.isArray(d.completion_cc_user_ids)) {
    for (const ccUid of d.completion_cc_user_ids) {
      const ccU = queryOne('SELECT id, name, status FROM users WHERE id = ?', [ccUid]);
      if (!ccU) return res.status(400).json({ error: '完成 CC 用户不存在（id=' + ccUid + '）' });
      if (ccU.status !== 'active') return res.status(400).json({ error: '完成 CC 用户「' + ccU.name + '」状态非 active' });
      if (!completionCcUserIds.includes(ccU.id)) completionCcUserIds.push(ccU.id);
    }
  }

  run(`INSERT INTO approval_flows (id, name, business_type, levels, is_enabled, completion_cc_user_ids) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, business_type=excluded.business_type, levels=excluded.levels, is_enabled=excluded.is_enabled, completion_cc_user_ids=excluded.completion_cc_user_ids`,
    [fId, name, businessType, JSON.stringify(validated), isEnabled, JSON.stringify(completionCcUserIds)]);

  // 2026-07-29：审批流保存后，将待审的 approval_records 审批人快照同步为最新配置
  // 这样管理员修改审批流后，所有 pending 的付款申请自动更新审批人，无需重新提交
  try {
    const pendingRecords = query(
      `SELECT id, approvers FROM approval_records WHERE business_type = ? AND status = 'pending'`,
      [businessType]
    );
    if (pendingRecords && pendingRecords.length > 0) {
      const newSnapshot = { levels: validated, completion_cc_user_ids: completionCcUserIds };
      const newSnapshotJson = JSON.stringify(newSnapshot);
      for (const rec of pendingRecords) {
        // 保留原有 current_level 和 max_level，仅更新审批人快照
        // 如果新配置的级次数少于当前 current_level，不强制回退（由管理员自行判断）
        run(`UPDATE approval_records SET approvers = ?, max_level = ?, updated_at = datetime('now') WHERE id = ?`,
          [newSnapshotJson, validated.length, rec.id]);
        console.log('[APPROVAL-FLOW-SYNC] 已同步 pending approval_record ' + rec.id + ' 的审批人快照（business_type=' + businessType + '）');
      }
    }
  } catch (syncErr) {
    // 同步失败不阻断审批流保存，仅日志记录
    console.error('[APPROVAL-FLOW-SYNC] 同步 pending 审批记录失败：' + syncErr.message);
  }

  res.json({ success: true, id: fId });
}));

// N5: 审批流配置页下拉数据源——返回具备 po_approve 或 payment_approve 的 active 系统用户（复用系统管理用户）
// PAY-CORE 补充：原仅返回 po_approve 用户，付款审批流配置页拿不到候选人；现返回合集并附带权限标记，
// 前端可按 business_type 自行筛选（PO→po_approve；PAY-CORE 6 类→payment_approve）。不修改前端调用约定。
app.get('/api/approval-candidates', requireApiPermission('system_config'), asyncHandler((req, res) => {
  try {
    const users = query(`SELECT u.id, u.name, u.username, u.role_id, r.name AS role_name, r.permissions
      FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.status = 'active' AND u.role_id IS NOT NULL AND u.role_id != ''`).rows;
    const out = users
      .filter(u => {
        let perms = [];
        try { perms = JSON.parse(u.permissions || '[]'); } catch (e) { perms = []; }
        return perms.includes('po_approve') || perms.includes('payment_approve');
      })
      .map(u => {
        let perms = [];
        try { perms = JSON.parse(u.permissions || '[]'); } catch (e) { perms = []; }
        return {
          id: u.id, name: u.name, username: u.username, role_id: u.role_id, role_name: u.role_name || u.role_id || '',
          // 权限标记：前端按 business_type 筛选展示；后端 POST 校验仍以 approvalRequiredPermission 为准
          has_po_approve: perms.includes('po_approve'),
          has_payment_approve: perms.includes('payment_approve')
        };
      });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// CC 抄送候选：返回全部 active 系统用户（复用 users 表，不新建账号体系）
// 不要求 po_approve；供提交审批时选择抄送人。仅数据记录，不触发任何通知。
app.get('/api/cc-candidates', requireLogin, asyncHandler((req, res) => {
  try {
    const users = query(`SELECT u.id, u.name, u.username, u.role_id, r.name AS role_name
      FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.status = 'active'`).rows;
    res.json(users.map(u => ({ id: u.id, name: u.name, username: u.username, role_id: u.role_id, role_name: u.role_name || u.role_id || '' })));
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 费用类型管理 ====================
app.get('/api/expense-types', requireLogin, asyncHandler((req, res) => {
  res.json(query('SELECT * FROM expense_types ORDER BY sort_order').rows);
}));
app.post('/api/expense-types', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body;
  const eId = d.id || genId('exp');
  run(`INSERT INTO expense_types (id, name, code, is_freight, is_cost, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, is_freight=excluded.is_freight, is_cost=excluded.is_cost, sort_order=excluded.sort_order, status=excluded.status`,
    [eId, d.name, d.code || '', d.is_freight || 0, d.is_cost || 1, d.sort_order || 0, d.status || 'active']);
  res.json({ success: true });
}));
app.delete('/api/expense-types/:id', requireApiPermission('system_config'), asyncHandler((req, res) => {
  run('DELETE FROM expense_types WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

// ==================== 分摊规则管理 ====================
app.get('/api/allocation-rules', requireLogin, asyncHandler((req, res) => {
  res.json(query('SELECT * FROM allocation_rules ORDER BY created_at').rows);
}));
app.post('/api/allocation-rules', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body;
  const aId = d.id || genId('alloc');
  run(`INSERT INTO allocation_rules (id, name, transport_mode, expense_type, allocation_basis, is_enabled) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, transport_mode=excluded.transport_mode, expense_type=excluded.expense_type, allocation_basis=excluded.allocation_basis, is_enabled=excluded.is_enabled`,
    [aId, d.name, d.transport_mode || 'sea', d.expense_type || 'freight', d.allocation_basis || 'cbm', d.is_enabled !== undefined ? d.is_enabled : 1]);
  res.json({ success: true });
}));

// ==================== 付款类目管理（L1B：独立两表，复用 system_config 权限） ====================
// 大类：列表
app.get('/api/payment-categories', requireLogin, asyncHandler((req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM payment_categories WHERE 1=1';
  const args = [];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY sort_order, created_at';
  res.json(query(sql, args).rows);
}));
// 大类：新增/编辑（不提供物理删除，停用走 status=inactive）
app.post('/api/payment-categories', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body || {};
  const code = (d.code || '').trim();
  const name = (d.name || '').trim();
  const status = d.status || 'active';
  if (!code) return res.status(400).json({ error: '类目编码(code)不能为空' });
  if (!name) return res.status(400).json({ error: '类目名称(name)不能为空' });
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'status 只允许 active 或 inactive' });
  try {
    if (d.id) {
      const exist = queryOne('SELECT id, code FROM payment_categories WHERE id = ?', [d.id]);
      if (!exist) return res.status(404).json({ error: '类目不存在' });
      // code 稳定性保护：一旦被业务数据引用，禁止改 code（只允许改 name/sort_order/status）
      if (code !== exist.code) {
        const ref = queryOne('SELECT 1 FROM payment_requests WHERE payment_category = ? LIMIT 1', [exist.code])
                 || queryOne('SELECT 1 FROM payable_items WHERE category_code = ? LIMIT 1', [exist.code]);
        if (ref) return res.status(409).json({ error: '该类目code已被业务数据引用，不允许修改code（可改名称/排序/状态）' });
      }
      run(`UPDATE payment_categories SET code=?, name=?, sort_order=?, status=?, updated_at=datetime('now') WHERE id=?`,
        [code, name, d.sort_order || 0, status, d.id]);
      return res.json({ success: true, id: d.id });
    }
    const id = genId('paycat');
    run(`INSERT INTO payment_categories (id, code, name, sort_order, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, code, name, d.sort_order || 0, status, req.currentUserId || '']);
    res.json({ success: true, id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '类目编码(code)已存在' });
    res.status(500).json({ error: e.message });
  }
}));

// 子类：列表（可按 category_id / status 过滤；source_type 过滤按"拥有该 active 来源映射"匹配）
app.get('/api/payment-subcategories', requireLogin, asyncHandler((req, res) => {
  const { category_id, status, source_type } = req.query;
  let sql = 'SELECT * FROM payment_subcategories WHERE 1=1';
  const args = [];
  if (category_id) { sql += ' AND category_id = ?'; args.push(category_id); }
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (source_type) { sql += ` AND id IN (SELECT subcategory_id FROM payment_subcategory_sources WHERE source_type = ? AND status = 'active')`; args.push(source_type); }
  sql += ' ORDER BY sort_order, created_at';
  const rows = query(sql, args).rows;
  const ids = rows.map(r => r.id);
  const srcMap = {};
  if (ids.length) {
    query(`SELECT id, subcategory_id, source_type, fee_type, status FROM payment_subcategory_sources WHERE subcategory_id IN (${ids.map(() => '?').join(',')})`, ids).rows
      .forEach(s => { (srcMap[s.subcategory_id] = srcMap[s.subcategory_id] || []).push({ id: s.id, source_type: s.source_type, fee_type: s.fee_type, status: s.status }); });
  }
  res.json(rows.map(r => ({ ...r, sources: srcMap[r.id] || [] })));
}));
// 子类：新增/编辑（不提供物理删除，停用走 status=inactive）
// 注意：来源映射(source_type/fee_type)已分离到 payment_subcategory_sources，本接口只管理类目属性
app.post('/api/payment-subcategories', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body || {};
  const category_id = (d.category_id || '').trim();
  const code = (d.code || '').trim();
  const name = (d.name || '').trim();
  const status = d.status || 'active';
  if (!category_id) return res.status(400).json({ error: '所属大类(category_id)不能为空' });
  if (!code) return res.status(400).json({ error: '子类编码(code)不能为空' });
  if (!name) return res.status(400).json({ error: '子类名称(name)不能为空' });
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'status 只允许 active 或 inactive' });
  const cat = queryOne('SELECT id FROM payment_categories WHERE id = ?', [category_id]);
  if (!cat) return res.status(400).json({ error: '所属大类(category_id)不存在' });
  try {
    if (d.id) {
      const exist = queryOne('SELECT id, code FROM payment_subcategories WHERE id = ?', [d.id]);
      if (!exist) return res.status(404).json({ error: '子类不存在' });
      // code 稳定性保护：一旦被业务数据引用，禁止改 code（只允许改名称/排序/状态/映射）
      if (code !== exist.code) {
        const ref = queryOne('SELECT 1 FROM payment_requests WHERE payment_subcategory = ? LIMIT 1', [exist.code])
                 || queryOne('SELECT 1 FROM payable_items WHERE subcategory_code = ? LIMIT 1', [exist.code]);
        if (ref) return res.status(409).json({ error: '该子类code已被业务数据引用，不允许修改code（可改名称/排序/状态/映射）' });
      }
      run(`UPDATE payment_subcategories SET category_id=?, code=?, name=?, payee_type_default=?, sort_order=?, status=?, updated_at=datetime('now') WHERE id=?`,
        [category_id, code, name, d.payee_type_default || '', d.sort_order || 0, status, d.id]);
      return res.json({ success: true, id: d.id });
    }
    const id = genId('paysub');
    run(`INSERT INTO payment_subcategories (id, category_id, code, name, payee_type_default, sort_order, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, category_id, code, name, d.payee_type_default || '', d.sort_order || 0, status, req.currentUserId || '']);
    res.json({ success: true, id });
  } catch (e) {
    const msg = String(e.message);
    if (msg.includes('category_id') || msg.includes('code') || msg.includes('UNIQUE')) return res.status(409).json({ error: '同一大类下子类编码(code)已存在' });
    res.status(500).json({ error: msg });
  }
}));

// 启用类目嵌套（供后续付款申请使用）：仅返回真正可用的数据
// 过滤规则：
//   小类须同时满足 payment_subcategories.status='active' 且至少存在一条 status='active' 来源映射
//   大类须同时满足 payment_categories.status='active' 且过滤后至少还剩一个有效小类
// 每个小类只返回其 active 来源映射(source_mappings)；不返回 inactive 映射；不返回旧标量字段
app.get('/api/payment-categories/active', requireLogin, asyncHandler((req, res) => {
  const cats = query(`SELECT id, code, name, sort_order FROM payment_categories WHERE status='active' ORDER BY sort_order, created_at`).rows;
  const subs = query(`SELECT id, category_id, code, name, payee_type_default, sort_order FROM payment_subcategories WHERE status='active' ORDER BY sort_order, created_at`).rows;
  const srcs = query(`SELECT subcategory_id, source_type, fee_type FROM payment_subcategory_sources WHERE status='active' ORDER BY source_type, fee_type`).rows;
  const bySub = {};
  srcs.forEach(s => { (bySub[s.subcategory_id] = bySub[s.subcategory_id] || []).push({ source_type: s.source_type, fee_type: s.fee_type }); });
  // 仅保留“有至少一条 active 来源映射”的小类
  const validSubs = subs.filter(s => (bySub[s.id] || []).length > 0);
  const byCat = {};
  validSubs.forEach(s => {
    (byCat[s.category_id] = byCat[s.category_id] || []).push({
      id: s.id, code: s.code, name: s.name, payee_type_default: s.payee_type_default,
      source_mappings: bySub[s.id] || [],
    });
  });
  // 仅保留“过滤后至少还剩一个有效小类”的大类
  const result = cats
    .filter(c => (byCat[c.id] || []).length > 0)
    .map(c => ({
      id: c.id, code: c.code, name: c.name,
      subcategories: byCat[c.id],
    }));
  res.json(result);
}));

// ==================== 付款主体主数据维护（L2A-2A-3：仅主数据，不接入采购业务链） ====================
// 权限复用 system_config，不新增权限码；不提供物理删除；引用计数结构预留（当前未接入 PI/CI/payable_item）

// 引用计数：本轮付款主体尚未接入任何业务表，统一返回 0；
// 未来接入 PI/CI/payable_item 时，在 refSources 中追加 {table, col}（以 payer_entities.id 关联）即可自动累计
function payerEntityRefCount(id) {
  const refSources = []; // 例如 {table:'proforma_invoices', col:'payer_entity_id'}
  let total = 0;
  for (const s of refSources) {
    try { total += queryOne(`SELECT COUNT(*) AS c FROM ${s.table} WHERE ${s.col} = ?`, [id]).c || 0; } catch (e) {}
  }
  return total;
}

// 列表：可按 status / country_id 过滤；返回 country_name 与引用数量；按 sort_order、entity_name 排序
app.get('/api/payer-entities', requireLogin, asyncHandler((req, res) => {
  const { status, country_id } = req.query;
  let sql = `SELECT p.*, c.name AS country_name
             FROM payer_entities p
             LEFT JOIN countries c ON c.id = p.country_id
             WHERE 1=1`;
  const args = [];
  if (status) { sql += ' AND p.status = ?'; args.push(status); }
  if (country_id) { sql += ' AND p.country_id = ?'; args.push(country_id); }
  sql += ' ORDER BY p.sort_order, p.entity_name';
  const rows = query(sql, args).rows;
  res.json(rows.map(r => ({ ...r, ref_count: payerEntityRefCount(r.id) })));
}));

// 新增（不提供物理删除；entity_key 唯一；默认主体唯一；写权限需 system_config）
app.post('/api/payer-entities', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body || {};
  if (d.id) return res.status(400).json({ error: '新增操作不应携带 id，更新请使用 PUT /api/payer-entities/:id' });
  const entity_key = String(d.entity_key || '').trim();
  const entity_name = String(d.entity_name || '').trim();
  const country_id = String(d.country_id || '').trim();
  const default_currency = String(d.default_currency || '').trim();
  const is_default = d.is_default ? 1 : 0;
  const status = String(d.status || 'active').trim();
  const sort_order = Number.isInteger(d.sort_order) ? d.sort_order : (Number(d.sort_order) || 0);
  // 基础校验
  if (!entity_key) return res.status(400).json({ error: '付款主体代码(entity_key)不能为空' });
  if (!entity_name) return res.status(400).json({ error: '法人名称(entity_name)不能为空' });
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'status 只允许 active 或 inactive' });
  if (!country_id) return res.status(400).json({ error: '所属国家(country_id)不能为空' });
  const country = queryOne('SELECT id, status FROM countries WHERE id = ?', [country_id]);
  if (!country) return res.status(400).json({ error: '所属国家不存在（country_id 无效）' });
  if (default_currency) {
    const cur = queryOne('SELECT code, status FROM currencies WHERE code = ?', [default_currency]);
    if (!cur) return res.status(400).json({ error: '默认币种(default_currency)不存在' });
    if (cur.status !== 'active') return res.status(400).json({ error: '默认币种(default_currency)已停用，不可选为默认币种' });
  }
  // 停用主体不能设为默认
  if (is_default === 1 && status === 'inactive') {
    return res.status(400).json({ error: '停用(inactive)的主体不能设为默认(is_default=1)' });
  }
  try {
    // 同国家 active 默认主体冲突
    if (is_default === 1 && status === 'active') {
      const conflict = queryOne(
        'SELECT id FROM payer_entities WHERE country_id = ? AND is_default = 1 AND status = \'active\'',
        [country_id]
      );
      if (conflict) return res.status(409).json({ error: '该国家已存在一个启用中的默认付款主体，请先取消原默认主体再设置' });
    }
    const id = genId('payer');
    run(`INSERT INTO payer_entities (id, entity_key, entity_name, country_id, default_currency, is_default, status, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, entity_key, entity_name, country_id, default_currency, is_default, status, sort_order]);
    res.json({ success: true, id });
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('UNIQUE') || msg.includes('uq_payer_entity_key')) {
      return res.status(409).json({ error: '付款主体代码(entity_key)已存在' });
    }
    if (msg.includes('uq_payer_entity_default_per_country')) {
      return res.status(409).json({ error: '该国家已存在一个启用中的默认付款主体，请先取消原默认主体再设置' });
    }
    if (msg.includes('FOREIGN KEY') || msg.includes('country_id')) {
      return res.status(400).json({ error: '所属国家(country_id)不存在' });
    }
    res.status(500).json({ error: msg });
  }
}));

// 编辑（不提供物理删除；entity_key 未被引用时允许修改，已引用返回 409；默认主体唯一；写权限需 system_config）
app.put('/api/payer-entities/:id', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const id = req.params.id;
  const d = req.body || {};
  const entity_key = String(d.entity_key || '').trim();
  const entity_name = String(d.entity_name || '').trim();
  const country_id = String(d.country_id || '').trim();
  const default_currency = String(d.default_currency || '').trim();
  const is_default = d.is_default ? 1 : 0;
  const status = String(d.status || 'active').trim();
  const sort_order = Number.isInteger(d.sort_order) ? d.sort_order : (Number(d.sort_order) || 0);
  // 基础校验
  if (!entity_key) return res.status(400).json({ error: '付款主体代码(entity_key)不能为空' });
  if (!entity_name) return res.status(400).json({ error: '法人名称(entity_name)不能为空' });
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'status 只允许 active 或 inactive' });
  if (!country_id) return res.status(400).json({ error: '所属国家(country_id)不能为空' });
  const country = queryOne('SELECT id, status FROM countries WHERE id = ?', [country_id]);
  if (!country) return res.status(400).json({ error: '所属国家不存在（country_id 无效）' });
  if (default_currency) {
    const cur = queryOne('SELECT code, status FROM currencies WHERE code = ?', [default_currency]);
    if (!cur) return res.status(400).json({ error: '默认币种(default_currency)不存在' });
    if (cur.status !== 'active') return res.status(400).json({ error: '默认币种(default_currency)已停用，不可选为默认币种' });
  }
  // 停用主体不能设为默认
  if (is_default === 1 && status === 'inactive') {
    return res.status(400).json({ error: '停用(inactive)的主体不能设为默认(is_default=1)' });
  }
  try {
    const exist = queryOne('SELECT id, entity_key, country_id, status, is_default FROM payer_entities WHERE id = ?', [id]);
    if (!exist) return res.status(404).json({ error: '付款主体不存在' });
    // entity_key 稳定性保护：一旦被业务数据引用，禁止修改
    if (entity_key !== exist.entity_key) {
      if (payerEntityRefCount(exist.id) > 0) {
        return res.status(409).json({ error: '该付款主体代码(entity_key)已被业务数据引用，不允许修改' });
      }
      const dup = queryOne('SELECT id FROM payer_entities WHERE entity_key = ? AND id != ?', [entity_key, id]);
      if (dup) return res.status(409).json({ error: '付款主体代码(entity_key)已存在' });
    }
    // 同国家第二个 active 默认主体冲突（排除自身）
    if (is_default === 1 && status === 'active') {
      const conflict = queryOne(
        'SELECT id FROM payer_entities WHERE country_id = ? AND is_default = 1 AND status = \'active\' AND id != ?',
        [country_id, id]
      );
      if (conflict) return res.status(409).json({ error: '该国家已存在一个启用中的默认付款主体，请先取消原默认主体再设置' });
    }
    run(`UPDATE payer_entities SET entity_key=?, entity_name=?, country_id=?, default_currency=?, is_default=?, status=?, sort_order=?, updated_at=datetime('now') WHERE id=?`,
      [entity_key, entity_name, country_id, default_currency, is_default, status, sort_order, id]);
    res.json({ success: true, id });
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('UNIQUE') || msg.includes('uq_payer_entity_key')) {
      return res.status(409).json({ error: '付款主体代码(entity_key)已存在' });
    }
    if (msg.includes('uq_payer_entity_default_per_country')) {
      return res.status(409).json({ error: '该国家已存在一个启用中的默认付款主体，请先取消原默认主体再设置' });
    }
    if (msg.includes('FOREIGN KEY') || msg.includes('country_id')) {
      return res.status(400).json({ error: '所属国家(country_id)不存在' });
    }
    res.status(500).json({ error: msg });
  }
}));

// 启用 / 停用（独立状态接口，无物理删除；当前 active 默认主体不可直接停用）
app.post('/api/payer-entities/:id/status', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const id = req.params.id;
  const entity = queryOne('SELECT id, entity_key, status, is_default FROM payer_entities WHERE id = ?', [id]);
  if (!entity) return res.status(404).json({ error: '付款主体不存在' });
  const newStatus = String(req.body && req.body.status ? req.body.status : '').trim();
  if (!['active', 'inactive'].includes(newStatus)) return res.status(400).json({ error: 'status 只允许 active 或 inactive' });
  if (newStatus === entity.status) return res.json({ success: true, id });
  // 当前 active 默认主体不可直接停用
  if (newStatus === 'inactive' && entity.is_default === 1 && entity.status === 'active') {
    return res.status(409).json({ error: '该付款主体为当前启用中的默认主体，不能直接停用。请先取消其默认设置或改设其他默认主体后再停用。' });
  }
  try {
    run(`UPDATE payer_entities SET status=?, updated_at=datetime('now') WHERE id=?`, [newStatus, id]);
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}));

// 来源映射列表（只读，供维护页与校验使用；可按 subcategory_id / source_type / status 过滤）
app.get('/api/payment-subcategory-sources', requireLogin, asyncHandler((req, res) => {
  const { subcategory_id, source_type, status } = req.query;
  let sql = 'SELECT * FROM payment_subcategory_sources WHERE 1=1';
  const args = [];
  if (subcategory_id) { sql += ' AND subcategory_id = ?'; args.push(subcategory_id); }
  if (source_type) { sql += ' AND source_type = ?'; args.push(source_type); }
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY subcategory_id, source_type, fee_type';
  res.json(query(sql, args).rows);
}));

// 来源映射：新增/编辑/启用/停用（不提供物理删除；停用走 status=inactive）
// 唯一事实来源为 payment_subcategory_sources；唯一约束由部分唯一索引 uq_payment_subcategory_source_mapping
// (source_type, fee_type) WHERE status='active' 保证“同一有效来源组合只能映射到一个小类”
// 冲突统一转换为 409 明确提示；无效 subcategory_id 返回 400；写权限需 system_config
const PAYMENT_SOURCE_FEE_MATRIX = Object.freeze({
  pi: Object.freeze(['deposit']),
  ci: Object.freeze(['balance', 'freight', 'customs_clearance', 'port_charges', 'delivery', 'warehouse', 'other_local', 'duty', 'inspection']),
  manual: Object.freeze(['freight', 'customs_clearance', 'port_charges', 'delivery', 'warehouse', 'other_local']),
});
const PAYMENT_SOURCE_LABEL = Object.freeze({ pi: 'PI', ci: 'CI', manual: '手动录入' });
const PAYMENT_FEE_LABEL = Object.freeze({
  deposit: '定金', balance: '尾款', freight: '运费', customs_clearance: '清关费',
  port_charges: '港口费', delivery: '派送费', warehouse: '仓储费', other_local: '其他本地费',
  duty: '关税', inspection: '商检费',
});
app.post('/api/payment-subcategory-sources', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const d = req.body || {};
  const subcategory_id = String(d.subcategory_id || '').trim();
  const source_type = String(d.source_type || '').trim();
  const fee_type = String(d.fee_type || '').trim();
  const status = String(d.status || 'active').trim();
  if (!subcategory_id) return res.status(400).json({ error: '所属小类(subcategory_id)不能为空' });
  if (!source_type) return res.status(400).json({ error: 'source_type 不能为空' });
  if (!fee_type) return res.status(400).json({ error: 'fee_type 不能为空' });
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'status 只允许 active 或 inactive' });
  if (!PAYMENT_SOURCE_FEE_MATRIX[source_type]) {
    return res.status(400).json({ error: `不支持的来源类型：${source_type}` });
  }
  if (!PAYMENT_SOURCE_FEE_MATRIX[source_type].includes(fee_type)) {
    return res.status(400).json({ error: `${PAYMENT_SOURCE_LABEL[source_type]}（${source_type}）不支持费用事件${fee_type}` });
  }
  let exist = null;
  if (d.id) {
    exist = queryOne('SELECT id, subcategory_id, source_type, fee_type FROM payment_subcategory_sources WHERE id = ?', [d.id]);
    if (!exist) return res.status(404).json({ error: '来源映射不存在' });
    if (exist.subcategory_id !== subcategory_id || exist.source_type !== source_type || exist.fee_type !== fee_type) {
      return res.status(409).json({ error: '来源映射的所属小类、来源类型和费用事件不能直接修改。请停用旧映射后新增正确映射。' });
    }
  }
  const sub = queryOne(`SELECT s.id, s.name AS subcategory_name, s.code AS subcategory_code, s.status AS subcategory_status,
                               c.id AS category_id, c.name AS category_name, c.code AS category_code, c.status AS category_status
                          FROM payment_subcategories s
                          LEFT JOIN payment_categories c ON c.id = s.category_id
                         WHERE s.id = ?`, [subcategory_id]);
  if (!sub) return res.status(400).json({ error: '所属小类(subcategory_id)不存在' });
  if (!sub.category_id) return res.status(400).json({ error: '所属一级类目不存在' });
  if (status === 'active' && sub.category_status !== 'active') {
    return res.status(400).json({ error: `所属一级类目“${sub.category_name}（${sub.category_code}）”已停用，来源映射只能保存为停用状态。` });
  }
  if (status === 'active' && sub.subcategory_status !== 'active') {
    return res.status(400).json({ error: `所属二级类目“${sub.subcategory_name}（${sub.subcategory_code}）”已停用，来源映射只能保存为停用状态。` });
  }
  // 冲突预检（仅对将要成为 active 的映射）：查是否已有其他 active 行占用同一 (source_type, fee_type)
  const conflictCheck = (excludeId) => {
    let sql = `SELECT m.id, m.subcategory_id, s.name AS subcategory_name, s.code AS subcategory_code
                 FROM payment_subcategory_sources m
                 LEFT JOIN payment_subcategories s ON s.id = m.subcategory_id
                WHERE m.source_type = ? AND m.fee_type = ? AND m.status = 'active'`;
    const args = [source_type, fee_type];
    if (excludeId) { sql += ' AND m.id != ?'; args.push(excludeId); }
    return queryOne(sql, args);
  };
  const conflictError = (conflict) => {
    const targetName = conflict.subcategory_name || conflict.subcategory_id;
    const targetCode = conflict.subcategory_code || conflict.subcategory_id;
    const message = `${PAYMENT_SOURCE_LABEL[source_type]}（${source_type}）+ ${PAYMENT_FEE_LABEL[fee_type]}（${fee_type}）已经映射到‘${targetName}（${targetCode}）’，不能重复启用。`;
    return res.status(409).json({
      error: message,
      message,
      conflict_mapping_id: conflict.id,
      conflict_subcategory_id: conflict.subcategory_id,
      conflict_subcategory_name: targetName,
      conflict_subcategory_code: targetCode,
      source_type,
      fee_type,
    });
  };
  try {
    if (d.id) {
      if (status === 'active') {
        const conflict = conflictCheck(d.id);
        if (conflict) return conflictError(conflict);
      }
      run(`UPDATE payment_subcategory_sources SET status=?, updated_at=datetime('now') WHERE id=?`, [status, d.id]);
      return res.json({ success: true, id: d.id });
    }
    if (status === 'inactive') {
      const duplicateInactive = queryOne(`SELECT id FROM payment_subcategory_sources
                                           WHERE subcategory_id = ? AND source_type = ? AND fee_type = ? AND status = 'inactive'`,
        [subcategory_id, source_type, fee_type]);
      if (duplicateInactive) {
        const message = '该停用来源映射已经存在，请直接重新启用原映射。';
        return res.status(409).json({ error: message, message, existing_mapping_id: duplicateInactive.id });
      }
    }
    if (status === 'active') {
      const conflict = conflictCheck(null);
      if (conflict) return conflictError(conflict);
    }
    const id = genId('paysrc');
    run(`INSERT INTO payment_subcategory_sources (id, subcategory_id, source_type, fee_type, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, subcategory_id, source_type, fee_type, status, req.currentUserId || '']);
    res.json({ success: true, id });
  } catch (e) {
    const msg = String(e.message);
    // 兜底：部分唯一索引 / 主键唯一；以及外键拒绝
    if (msg.includes('UNIQUE') || msg.includes('uq_payment_subcategory_source_mapping')) {
      const conflict = conflictCheck(d.id || null);
      if (conflict) return conflictError(conflict);
      return res.status(409).json({ error: `有效来源映射冲突：${PAYMENT_SOURCE_LABEL[source_type]}（${source_type}）+ ${PAYMENT_FEE_LABEL[fee_type]}（${fee_type}）已被其他有效映射占用。` });
    }
    if (msg.includes('FOREIGN KEY')) {
      return res.status(400).json({ error: '所属小类(subcategory_id)不存在或外键校验失败' });
    }
    res.status(500).json({ error: msg });
  }
}));

// ==================== 系统配置 ====================
app.get('/api/system-config', requireApiPermission('system_config'), asyncHandler((req, res) => {
  res.json(query('SELECT * FROM system_config').rows);
}));
app.post('/api/system-config', requireApiPermission('system_config'), asyncHandler((req, res) => {
  const { configs } = req.body;
  if (Array.isArray(configs)) {
    transaction(() => {
      configs.forEach(c => {
        run(`INSERT INTO system_config (key, value, description, updated_at) VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, description=excluded.description, updated_at=datetime('now')`,
          [c.key, c.value, c.description || '']);
      });
    });
  }
  res.json({ success: true });
}));

// ==================== SKU 主数据 ====================
app.get('/api/skus', requireApiPermission('sku_view'), asyncHandler((req, res) => {
  const { keyword, status, brand, lifecycle_status, category } = req.query;
  let sql = 'SELECT * FROM skus WHERE 1=1';
  const params = [];
  if (keyword) { sql += ' AND (sku_code LIKE ? OR product_name LIKE ? OR model LIKE ? OR barcode LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (brand) { sql += ' AND brand = ?'; params.push(brand); }
  if (lifecycle_status) { sql += ' AND lifecycle_status = ?'; params.push(lifecycle_status); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY created_at DESC';
  res.json(query(sql, params).rows);
}));

app.get('/api/skus/:id', requireApiPermission('sku_view'), asyncHandler((req, res) => {
  const sku = queryOne('SELECT * FROM skus WHERE id = ?', [req.params.id]);
  if (!sku) return res.status(404).json({ error: 'SKU不存在' });
  res.json(sku);
}));

app.post('/api/skus', requireApiPermission('sku_create'), asyncHandler((req, res) => {
  try {
    const d = req.body;
    if (!d.sku_code) return res.status(400).json({ error: 'SKU编码不能为空' });
    const exist = queryOne('SELECT id FROM skus WHERE sku_code = ?', [d.sku_code]);
    if (exist) return res.status(400).json({ error: 'SKU编码已存在' });
    for (const f of ['purchase_price_rmb', 'purchase_price_usd']) {
      if (d[f] !== undefined && d[f] !== '' && d[f] !== null) {
        const v = Number(d[f]);
        if (isNaN(v) || v < 0) return res.status(400).json({ error: '采购单价必须为不小于0的数字' });
      }
    }
    if (d.reference_customs_rate !== undefined && d.reference_customs_rate !== '' && d.reference_customs_rate !== null) {
      const rate = Number(d.reference_customs_rate);
      if (!Number.isFinite(rate) || rate < 0) return res.status(400).json({ error: '参考关税税率必须为不小于0的数字' });
    }
    const sId = d.id || genId('sku');
    run(`INSERT INTO skus (id, sku_code, product_name, brand, category, model, color_spec, barcode, default_supplier_id, default_supplier_name, purchase_currency, standard_purchase_price, purchase_price_rmb, purchase_price_usd, reference_customs_rate, carton_spec, qty_per_carton, unit_weight, unit_cbm, is_new_product, launch_date, new_product_protection_days, lifecycle_status, auto_replenish, status, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sId, d.sku_code, d.product_name || '', d.brand || '', d.category || '', d.model || '', d.color_spec || '', d.barcode || '', d.default_supplier_id || '', d.default_supplier_name || '', d.purchase_currency || 'USD', d.standard_purchase_price || 0, parseFloat(d.purchase_price_rmb) || 0, parseFloat(d.purchase_price_usd) || 0, d.reference_customs_rate === '' || d.reference_customs_rate == null ? null : Number(d.reference_customs_rate), d.carton_spec || '', d.qty_per_carton || 0, d.unit_weight || 0, d.unit_cbm || 0, d.is_new_product || 0, d.launch_date || '', d.new_product_protection_days || 90, d.lifecycle_status || 'new_test', d.auto_replenish !== undefined ? d.auto_replenish : 1, d.status || 'normal', d.remark || '']);
    res.json({ id: sId, ...d });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.put('/api/skus/:id', requireApiPermission('sku_edit'), asyncHandler((req, res) => {
  try {
    const d = req.body;
    const { id } = req.params;
    if (d.reference_customs_rate !== undefined && d.reference_customs_rate !== '' && d.reference_customs_rate !== null) {
      const rate = Number(d.reference_customs_rate);
      if (!Number.isFinite(rate) || rate < 0) return res.status(400).json({ error: '参考关税税率必须为不小于0的数字' });
    }
    const fields = [];
    const values = [];
    const allowed = ['product_name', 'brand', 'category', 'model', 'color_spec', 'barcode', 'default_supplier_id', 'default_supplier_name', 'purchase_currency', 'standard_purchase_price', 'purchase_price_rmb', 'purchase_price_usd', 'reference_customs_rate', 'weighted_avg_cost', 'carton_spec', 'qty_per_carton', 'unit_weight', 'unit_cbm', 'is_new_product', 'launch_date', 'new_product_protection_days', 'lifecycle_status', 'auto_replenish', 'status', 'remark'];
    allowed.forEach(f => {
      if (d[f] !== undefined) {
        let val = d[f];
        if (f === 'purchase_price_rmb' || f === 'purchase_price_usd') {
          val = (d[f] === '' || d[f] === null) ? 0 : Number(d[f]);
          if (isNaN(val) || val < 0) throw new Error('采购单价必须为不小于0的数字');
        }
        if (f === 'reference_customs_rate') val = (d[f] === '' || d[f] === null) ? null : Number(d[f]);
        fields.push(`${f} = ?`); values.push(val);
      }
    });
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    run(`UPDATE skus SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.delete('/api/skus/:id', requireApiPermission('sku_delete'), asyncHandler((req, res) => {
  try {
    const sku = queryOne('SELECT sku_code FROM skus WHERE id = ?', [req.params.id]);
    if (!sku) return res.status(404).json({ error: 'SKU不存在' });
    const code = sku.sku_code;
    // 检查业务数据关联
    const checks = [
      { table: 'inventory', label: '库存' },
      { table: 'outbound_records', label: '出库记录' },
      { table: 'sales_records', label: '销售明细' },
      { table: 'inventory_imports', label: '库存导入' },
      { table: 'replenishment_suggestions', label: '补货预测' },
      { table: 'purchase_order_items', label: 'PO' },
      { table: 'proforma_invoice_items', label: 'PI' },
      { table: 'commercial_invoice_items', label: 'CI' },
      { table: 'packing_list_items', label: 'PL' },
      { table: 'inbound_records', label: '入库记录' },
    ];
    for (const c of checks) {
      try {
        const r = queryOne(`SELECT COUNT(*) as cnt FROM ${c.table} WHERE sku_code = ?`, [code]);
        if (r && r.cnt > 0) {
          return res.status(400).json({ error: `SKU已关联${c.label}数据（${r.cnt}条），不允许删除，请改为停用` });
        }
      } catch (e) { /* 表可能不存在，跳过 */ }
    }
    run('DELETE FROM skus WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// SKU 批量导入
app.post('/api/skus/bulk-import', requireApiPermission('sku_import'), asyncHandler((req, res) => {
  try {
    const items = req.body.items || [];
    const result = { created: 0, updated: 0, failed: 0, errors: [] };

    // 生命周期中文标签 → 代码
    const LIFECYCLE_MAP = {
      '新品导入':'new_test','新品启动':'new_launch','成长期':'growth','成熟期':'stable',
      '衰退期':'slow','滞销':'stagnant','清仓期':'clearance','停采':'stopped','停产':'stopped',
      '停采/停产':'stopped','new_test':'new_test','new_launch':'new_launch','growth':'growth',
      'stable':'stable','slow':'slow','stagnant':'stagnant','clearance':'clearance','stopped':'stopped'
    };
    // 状态中文标签 → 代码
    const STATUS_MAP = {
      '启用':'normal','正常':'normal','清仓':'clearance','停用':'stopped','停采':'stopped','停产':'discontinued',
      'normal':'normal','clearance':'clearance','stopped':'stopped','discontinued':'discontinued'
    };

    transaction(() => {
      items.forEach((item, i) => {
        try {
          const sku = String(item.sku_code || '').trim();
          if (!sku) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU编码为空' }); return; }
          if (!item.brand || !String(item.brand).trim()) { result.failed++; result.errors.push({ row: i + 2, reason: '品牌为空' }); return; }
          const rmbRaw = item.purchase_price_rmb, usdRaw = item.purchase_price_usd;
          const rmbVal = (rmbRaw === undefined || rmbRaw === '' || rmbRaw === null) ? 0 : parseFloat(rmbRaw);
          const usdVal = (usdRaw === undefined || usdRaw === '' || usdRaw === null) ? 0 : parseFloat(usdRaw);
          if (isNaN(rmbVal) || rmbVal < 0 || isNaN(usdVal) || usdVal < 0) {
            result.failed++; result.errors.push({ row: i + 2, reason: '采购单价必须为不小于0的数字' }); return;
          }

          // 映射生命周期和状态
          const lifecycle = LIFECYCLE_MAP[String(item.lifecycle_status||'').trim()] || (item.lifecycle_status || 'new_test');
          const status = STATUS_MAP[String(item.status||'').trim()] || (item.status || 'normal');

          const exist = queryOne('SELECT id FROM skus WHERE sku_code = ?', [sku]);
          if (exist) {
            run(`UPDATE skus SET product_name=?, brand=?, category=?, model=?, color_spec=?, barcode=?, purchase_price_rmb=?, purchase_price_usd=?, carton_spec=?, qty_per_carton=?, unit_weight=?, unit_cbm=?, lifecycle_status=?, launch_date=?, remark=?, status=?, updated_at=datetime('now') WHERE id=?`,
              [item.product_name || '', item.brand || '', item.category || '', item.model || '', item.color_spec || '', item.barcode || '', parseFloat(item.purchase_price_rmb) || 0, parseFloat(item.purchase_price_usd) || 0, item.carton_spec || '', parseInt(item.qty_per_carton) || 0, parseFloat(item.unit_weight) || 0, parseFloat(item.unit_cbm) || 0, lifecycle, item.launch_date || '', item.remark || '', status, exist.id]);
            result.updated++;
          } else {
            run(`INSERT INTO skus (id, sku_code, product_name, brand, category, model, color_spec, barcode, purchase_price_rmb, purchase_price_usd, carton_spec, qty_per_carton, unit_weight, unit_cbm, lifecycle_status, launch_date, remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [genId('sku'), sku, item.product_name || '', item.brand || '', item.category || '', item.model || '', item.color_spec || '', item.barcode || '', parseFloat(item.purchase_price_rmb) || 0, parseFloat(item.purchase_price_usd) || 0, item.carton_spec || '', parseInt(item.qty_per_carton) || 0, parseFloat(item.unit_weight) || 0, parseFloat(item.unit_cbm) || 0, lifecycle, item.launch_date || '', item.remark || '', status]);
            result.created++;
          }
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// SKU 批量更新
app.post('/api/skus/batch-update', requireApiPermission('sku_edit'), asyncHandler((req, res) => {
  try {
    const { ids, data } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择SKU' });
    if (!data || Object.keys(data).length === 0) return res.status(400).json({ error: '无更新字段' });
    const allowed = ['product_name', 'brand', 'category', 'model', 'color_spec', 'barcode', 'lifecycle_status', 'status', 'auto_replenish'];
    const fields = [];
    const values = [];
    const LIFECYCLE_MAP = {
      '新品导入':'new_test','新品启动':'new_launch','成长期':'growth','成熟期':'stable',
      '衰退期':'slow','滞销':'stagnant','清仓期':'clearance','停采/停产':'stopped',
      '停采':'stopped','停产':'stopped','new_test':'new_test','new_launch':'new_launch',
      'growth':'growth','stable':'stable','slow':'slow','stagnant':'stagnant','clearance':'clearance','stopped':'stopped'
    };
    const STATUS_MAP = { '启用':'normal','停用':'stopped','正常':'normal','清仓':'clearance','停采':'stopped','停产':'discontinued','normal':'normal','clearance':'clearance','stopped':'stopped','discontinued':'discontinued' };
    allowed.forEach(f => {
      if (data[f] !== undefined && data[f] !== null && data[f] !== '') {
        let val = data[f];
        if (f === 'lifecycle_status') val = LIFECYCLE_MAP[String(val).trim()] || val;
        if (f === 'status') val = STATUS_MAP[String(val).trim()] || val;
        fields.push(`${f} = ?`);
        values.push(val);
      }
    });
    if (fields.length === 0) return res.status(400).json({ error: '无有效更新字段' });
    fields.push(`updated_at = datetime('now')`);
    const placeholders = ids.map(() => '?').join(',');
    values.push(...ids);
    const result = run(`UPDATE skus SET ${fields.join(', ')} WHERE id IN (${placeholders})`, values);
    res.json({ success: true, updated: result.changes || ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// SKU 批量删除（带业务数据检查）
app.post('/api/skus/batch-delete', requireApiPermission('sku_delete'), asyncHandler((req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择SKU' });
    const result = { deleted: 0, failed: 0, errors: [] };
    const checks = [
      { table: 'inventory', label: '库存' },
      { table: 'outbound_records', label: '出库记录' },
      { table: 'sales_records', label: '销售明细' },
      { table: 'inventory_imports', label: '库存导入' },
      { table: 'replenishment_suggestions', label: '补货预测' },
      { table: 'purchase_order_items', label: 'PO' },
      { table: 'proforma_invoice_items', label: 'PI' },
      { table: 'commercial_invoice_items', label: 'CI' },
      { table: 'packing_list_items', label: 'PL' },
      { table: 'inbound_records', label: '入库记录' },
    ];
    transaction(() => {
      ids.forEach(id => {
        try {
          const sku = queryOne('SELECT sku_code FROM skus WHERE id = ?', [id]);
          if (!sku) { result.failed++; result.errors.push({ id, reason: 'SKU不存在' }); return; }
          for (const c of checks) {
            try {
              const r = queryOne(`SELECT COUNT(*) as cnt FROM ${c.table} WHERE sku_code = ?`, [sku.sku_code]);
              if (r && r.cnt > 0) {
                result.failed++;
                result.errors.push({ id, sku_code: sku.sku_code, reason: `已关联${c.label}数据（${r.cnt}条），不允许删除` });
                return;
              }
            } catch (e) { /* 表可能不存在 */ }
          }
          run('DELETE FROM skus WHERE id = ?', [id]);
          result.deleted++;
        } catch (e) { result.failed++; result.errors.push({ id, reason: e.message }); }
      });
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// SKU 导入记录
app.get('/api/skus/import-records', requireApiPermission('sku_view'), asyncHandler((req, res) => {
  try {
    const records = query(`
      SELECT 'sku_import' as type, 'SKU导入' as label, 
        COUNT(*) as total,
        SUM(CASE WHEN product_name != '' THEN 1 ELSE 0 END) as matched,
        MAX(created_at) as last_import
      FROM skus
    `).rows;
    res.json(records);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));
app.get('/api/inventory-imports', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  const { country, warehouse, import_date } = req.query;
  let sql = 'SELECT * FROM inventory_imports WHERE 1=1';
  const params = [];
  if (country) { sql += ' AND country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND warehouse = ?'; params.push(warehouse); }
  if (import_date) { sql += ' AND import_date = ?'; params.push(import_date); }
  sql += ' ORDER BY import_date DESC, created_at DESC LIMIT 500';
  res.json(query(sql, params).rows);
}));

app.post('/api/inventory-imports/bulk-import', requireApiPermission('inventory_import'), asyncHandler(async (req, res) => {
  try {
    const items = req.body.items || [];
    const snapshotCutoffDate = req.body.snapshot_cutoff_date || '';
    const result = { created: 0, updated: 0, failed: 0, errors: [] };
    transaction(() => {
      items.forEach((item, i) => {
        try {
          if (!item.sku_code || !item.import_date) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU或导入日期为空' }); return; }
          // P1-INBOUND-01: 可用数量必须是严格非负整数；拒绝小数/带尾随字符/空/null/undefined/负数；禁止截断或静默变 0
          const rawAvailQty = item.available_qty;
          if (rawAvailQty === null || rawAvailQty === undefined || String(rawAvailQty).trim() === '') {
            result.failed++; result.errors.push({ row: i + 2, reason: '可用数量必须为非负整数' }); return;
          }
          const availQty = Number(rawAvailQty);
          if (!Number.isFinite(availQty) || !Number.isInteger(availQty) || availQty < 0) {
            result.failed++; result.errors.push({ row: i + 2, reason: '可用数量必须为非负整数' }); return;
          }
          const id = genId('inv_imp');
          // 归一化导入日期为 ISO，避免 M/D/YY 文本再次混入导致快照 MAX 比较失真
          const importDate = normalizeImportDate(item.import_date);
          run(`INSERT INTO inventory_imports (id, import_date, country, warehouse, channel, sku_code, available_qty, remark, snapshot_cutoff_date, brand, weighted_avg_cost, last_inbound_date, first_inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, importDate, item.country || '', item.warehouse || '', item.channel || '', item.sku_code, availQty, item.remark || '', snapshotCutoffDate, item.brand || '', parseFloat(item.weighted_avg_cost) || 0, item.last_inbound_date || '', item.first_inbound_date || '']);
          result.created++;
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
    });
    // 更新库存总表，传入 snapshotCutoffDate
    const refreshResult = await refreshInventoryTotals(snapshotCutoffDate);
    res.json({ ...result, snapshot_cutoff_date: snapshotCutoffDate, wac_warnings: refreshResult.warnings || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 库存总表 ====================
app.get('/api/inventory', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  const { country, warehouse, brand, keyword } = req.query;
  let sql = `SELECT i.*, s.product_name, s.brand, s.category, s.model, s.lifecycle_status, s.is_new_product FROM inventory i LEFT JOIN skus s ON i.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND i.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND i.warehouse = ?'; params.push(warehouse); }
  if (brand) { sql += ' AND s.brand = ?'; params.push(brand); }
  if (keyword) { sql += ' AND (i.sku_code LIKE ? OR s.product_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY i.sku_code';
  res.json(query(sql, params).rows);
}));

// 库存总表筛选下拉选项（从实际数据动态聚合）
app.get('/api/inventory/filter-options', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  const { country, warehouse, brand } = req.query;
  const c = (country || '').trim();
  const w = (warehouse || '').trim();
  const b = (brand || '').trim();
  // 各维度选项基于「其他已选维度」过滤；已选值即使不在过滤结果中也保留，避免下拉变空白
  const countries = query(`SELECT DISTINCT country FROM inventory WHERE country IS NOT NULL AND country != ''`
    + (w ? ' AND warehouse = ?' : '') + (b ? ' AND sku_code IN (SELECT sku_code FROM skus WHERE brand = ?)' : '')
    + ' ORDER BY country', [...(w?[w]:[]), ...(b?[b]:[])]).rows.map(r => r.country);
  // 仓库选项来源：warehouses 主数据表 status='active'，不再依赖 inventory 是否有记录
  // 无品牌：返回所有启用仓库（按国家过滤）；有品牌：仅保留该品牌有库存记录的仓库
  let whSql = `SELECT DISTINCT w.name FROM warehouses w WHERE w.status = 'active' AND w.name IS NOT NULL AND w.name != ''`;
  const whParams = [];
  if (c) { whSql += ' AND w.country_name = ?'; whParams.push(c); }
  if (b) { whSql += ' AND w.name IN (SELECT DISTINCT i.warehouse FROM inventory i JOIN skus s ON i.sku_code = s.sku_code WHERE s.brand = ? AND i.warehouse IS NOT NULL AND i.warehouse != \'\')'; whParams.push(b); }
  whSql += ' ORDER BY w.name';
  const warehouses = query(whSql, whParams).rows.map(r => r.name);
  const brands = query(`SELECT DISTINCT s.brand FROM inventory i JOIN skus s ON i.sku_code = s.sku_code WHERE s.brand IS NOT NULL AND s.brand != ''`
    + (c ? ' AND i.country = ?' : '') + (w ? ' AND i.warehouse = ?' : '')
    + ' ORDER BY s.brand', [...(c?[c]:[]), ...(w?[w]:[])]).rows.map(r => r.brand);
  // 友好处理：保留当前已选值（后端 unshift），避免条件组合下下拉显示空白
  if (c && !countries.includes(c)) countries.unshift(c);
  if (w && !warehouses.includes(w)) warehouses.unshift(w);
  if (b && !brands.includes(b)) brands.unshift(b);
  res.json({ countries, warehouses, brands });
}));

// ==================== 寄售库存（CONSIGNMENT-INVENTORY） ====================
// projectConsignmentInventoryToInventory：把某仓库的活跃寄售库存批次聚合投影到库存总表。
// 独立函数（非路由）：按 sku_code 聚合 remaining_qty / remaining_inventory_value，
// 以加权方式计算 weighted_avg_cost = inventory_value / available_qty；
// 已存在则 UPDATE，不存在则 INSERT；仓库内已无活跃寄售批次的 SKU 清零。
// 注意：不调用 refreshInventoryTotals / projectWacToInventory / 任何 WAC 函数，不写 wac_history。
function projectConsignmentInventoryToInventory(warehouseName, countryName) {
  const warehouse = (warehouseName || '').trim();
  const country = (countryName || '').trim();
  if (!warehouse) return;
  transaction(() => {
    // 聚合该仓库的活跃寄售库存行（按 sku_code 汇总剩余数量与剩余库存价值）
    let lotsSql = `SELECT sku_code,
        COALESCE(SUM(remaining_qty), 0) AS available_qty,
        COALESCE(SUM(remaining_inventory_value), 0) AS inventory_value
      FROM consignment_inventory_lots
      WHERE warehouse_name = ? AND status = 'active'`;
    const lotsParams = [warehouse];
    if (country) { lotsSql += ' AND country_name = ?'; lotsParams.push(country); }
    lotsSql += ' GROUP BY sku_code';
    const lots = query(lotsSql, lotsParams).rows;

    const activeSkuSet = new Set();
    for (const lot of lots) {
      const skuCode = lot.sku_code;
      const availableQty = parseInt(lot.available_qty) || 0;
      const invValue = Number(lot.inventory_value) || 0;
      const wac = availableQty > 0 ? invValue / availableQty : 0;
      activeSkuSet.add(skuCode);
      const existing = queryOne('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
        [skuCode, country, warehouse]);
      if (existing) {
        run(`UPDATE inventory SET available_qty = ?, inventory_value = ?, weighted_avg_cost = ?, snapshot_cutoff_date = datetime('now'), updated_at = datetime('now') WHERE sku_code = ? AND country = ? AND warehouse = ?`,
          [availableQty, invValue, wac, skuCode, country, warehouse]);
      } else {
        run(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, snapshot_cutoff_date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [genId('inv'), skuCode, country, warehouse, availableQty, wac, invValue]);
      }
    }

    // 仓库内原本存在库存记录、但新活跃寄售批次中没有的 SKU：数量/金额/成本清零
    let invSql = 'SELECT sku_code FROM inventory WHERE warehouse = ?';
    const invParams = [warehouse];
    if (country) { invSql += ' AND country = ?'; invParams.push(country); }
    const invRows = query(invSql, invParams).rows;
    for (const row of invRows) {
      if (!activeSkuSet.has(row.sku_code)) {
        run(`UPDATE inventory SET available_qty = 0, inventory_value = 0, weighted_avg_cost = 0, updated_at = datetime('now') WHERE sku_code = ? AND country = ? AND warehouse = ?`,
          [row.sku_code, country, warehouse]);
      }
    }
  });
}

// 寄售库存导入预览：校验行数据并汇总，不落库
app.post('/api/consignment-inventory/preview', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const { warehouse_name, country_name, items } = req.body || {};
    const warehouse = (warehouse_name || '').toString().trim();
    const country = (country_name || '').toString().trim();
    const rows = Array.isArray(items) ? items : [];
    const errors = [];
    const validItems = [];

    if (!warehouse) {
      return res.status(400).json({ error: 'warehouse_name 不能为空' });
    }
    // 仓库必须存在且 status='active'
    const wh = queryOne("SELECT name FROM warehouses WHERE name = ? AND status = 'active'", [warehouse]);
    if (!wh) {
      return res.status(400).json({ error: `仓库不存在或未启用：${warehouse}` });
    }

    // 预取所有传入 SKU 的存在性，避免逐行查询
    const skuCodes = Array.from(new Set(rows.map(r => (r && r.sku_code ? String(r.sku_code).trim() : '')).filter(Boolean)));
    const skuExistMap = {};
    if (skuCodes.length) {
      const placeholders = skuCodes.map(() => '?').join(',');
      const skuRows = query(`SELECT sku_code FROM skus WHERE sku_code IN (${placeholders})`, skuCodes).rows;
      skuRows.forEach(r => { skuExistMap[r.sku_code] = true; });
    }

    const seenKeys = new Set();
    let duplicateCount = 0;

    rows.forEach((item, idx) => {
      const rowNo = idx + 1;
      const pushError = (field, value, reason) => errors.push({ row: rowNo, field, value, reason });

      const skuCode = (item && item.sku_code != null ? String(item.sku_code) : '').trim();
      if (!skuCode) { pushError('sku_code', item && item.sku_code, 'SKU编码不能为空'); return; }
      if (!skuExistMap[skuCode]) { pushError('sku_code', skuCode, 'SKU不存在于SKU主数据表'); return; }

      // 数量校验：outbound_qty / sold_qty / returned_qty 必须为数字且 >= 0
      const numFields = ['outbound_qty', 'sold_qty', 'returned_qty'];
      const nums = {};
      for (const f of numFields) {
        const raw = item ? item[f] : undefined;
        if (raw === null || raw === undefined || String(raw).trim() === '') {
          nums[f] = 0;
        } else {
          const v = Number(raw);
          if (!Number.isFinite(v) || v < 0) {
            pushError(f, raw, '数量必须为非负数字');
            return;
          }
          nums[f] = v;
        }
      }
      // sold_qty + returned_qty <= outbound_qty
      if (nums.sold_qty + nums.returned_qty > nums.outbound_qty) {
        pushError('outbound_qty', nums.outbound_qty, '已售+已退不能大于出库数量');
        return;
      }
      // unit_cost >= 0
      const rawCost = item ? item.unit_cost : undefined;
      let unitCost = 0;
      if (rawCost !== null && rawCost !== undefined && String(rawCost).trim() !== '') {
        const c = Number(rawCost);
        if (!Number.isFinite(c) || c < 0) {
          pushError('unit_cost', rawCost, '单位成本必须为非负数字');
          return;
        }
        unitCost = c;
      }

      const remainingQty = nums.outbound_qty - nums.sold_qty - nums.returned_qty;
      const remainingValue = Math.round((remainingQty * unitCost + Number.EPSILON) * 10000) / 10000;

      // 重复行检测：(sku_code, customer_name, outbound_no)
      const customerName = (item && item.customer_name != null ? String(item.customer_name) : '').trim();
      const outboundNo = (item && item.outbound_no != null ? String(item.outbound_no) : '').trim();
      const dupKey = `${skuCode}|${customerName}|${outboundNo}`;
      if (seenKeys.has(dupKey)) {
        duplicateCount++;
      } else {
        seenKeys.add(dupKey);
      }

      validItems.push({
        sku_code: skuCode,
        customer_name: customerName,
        outbound_no: outboundNo,
        outbound_date: (item && item.outbound_date != null ? String(item.outbound_date) : '').trim(),
        outbound_qty: nums.outbound_qty,
        sold_qty: nums.sold_qty,
        returned_qty: nums.returned_qty,
        unit_cost: unitCost,
        remaining_qty: remainingQty,
        remaining_inventory_value: remainingValue
      });
    });

    const customerSet = new Set();
    const skuSet = new Set();
    let totalRemainingQty = 0;
    let totalRemainingValue = 0;
    validItems.forEach(v => {
      if (v.customer_name) customerSet.add(v.customer_name);
      skuSet.add(v.sku_code);
      totalRemainingQty += v.remaining_qty;
      totalRemainingValue += v.remaining_inventory_value;
    });

    res.json({
      total_rows: rows.length,
      valid_rows: validItems.length,
      error_rows: errors.length,
      customer_count: customerSet.size,
      sku_count: skuSet.size,
      total_remaining_qty: totalRemainingQty,
      total_remaining_value: Math.round((totalRemainingValue + Number.EPSILON) * 10000) / 10000,
      duplicate_count: duplicateCount,
      errors,
      valid_items: validItems
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 寄售库存导入：事务内创建批次、写入批次行、作废旧批次、激活新批次、投影到库存总表、记录操作日志
app.post('/api/consignment-inventory/import', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const { warehouse_name, country_name, items, original_filename } = req.body || {};
    const warehouse = (warehouse_name || '').toString().trim();
    const country = (country_name || '').toString().trim();
    const rows = Array.isArray(items) ? items : [];

    if (!warehouse) return res.status(400).json({ error: 'warehouse_name 不能为空' });
    if (!rows.length) return res.status(400).json({ error: 'items 不能为空' });
    const wh = queryOne("SELECT name FROM warehouses WHERE name = ? AND status = 'active'", [warehouse]);
    if (!wh) return res.status(400).json({ error: `仓库不存在或未启用：${warehouse}` });

    // 复用预览校验逻辑（内联，避免副作用）
    const skuCodes = Array.from(new Set(rows.map(r => (r && r.sku_code ? String(r.sku_code).trim() : '')).filter(Boolean)));
    const skuExistMap = {};
    if (skuCodes.length) {
      const placeholders = skuCodes.map(() => '?').join(',');
      query(`SELECT sku_code FROM skus WHERE sku_code IN (${placeholders})`, skuCodes).rows.forEach(r => { skuExistMap[r.sku_code] = true; });
    }

    const validItems = [];
    const errors = [];
    rows.forEach((item, idx) => {
      const rowNo = idx + 1;
      const pushError = (field, value, reason) => errors.push({ row: rowNo, field, value, reason });
      const skuCode = (item && item.sku_code != null ? String(item.sku_code) : '').trim();
      if (!skuCode) { pushError('sku_code', item && item.sku_code, 'SKU编码不能为空'); return; }
      if (!skuExistMap[skuCode]) { pushError('sku_code', skuCode, 'SKU不存在于SKU主数据表'); return; }
      const nums = {};
      for (const f of ['outbound_qty', 'sold_qty', 'returned_qty']) {
        const raw = item ? item[f] : undefined;
        if (raw === null || raw === undefined || String(raw).trim() === '') { nums[f] = 0; }
        else { const v = Number(raw); if (!Number.isFinite(v) || v < 0) { pushError(f, raw, '数量必须为非负数字'); return; } nums[f] = v; }
      }
      if (nums.sold_qty + nums.returned_qty > nums.outbound_qty) { pushError('outbound_qty', nums.outbound_qty, '已售+已退不能大于出库数量'); return; }
      const rawCost = item ? item.unit_cost : undefined;
      let unitCost = 0;
      if (rawCost !== null && rawCost !== undefined && String(rawCost).trim() !== '') {
        const c = Number(rawCost); if (!Number.isFinite(c) || c < 0) { pushError('unit_cost', rawCost, '单位成本必须为非负数字'); return; } unitCost = c;
      }
      const remainingQty = nums.outbound_qty - nums.sold_qty - nums.returned_qty;
      const remainingValue = Math.round((remainingQty * unitCost + Number.EPSILON) * 10000) / 10000;
      validItems.push({
        sku_code: skuCode,
        customer_name: (item && item.customer_name != null ? String(item.customer_name) : '').trim(),
        outbound_no: (item && item.outbound_no != null ? String(item.outbound_no) : '').trim(),
        outbound_date: (item && item.outbound_date != null ? String(item.outbound_date) : '').trim(),
        outbound_qty: nums.outbound_qty,
        sold_qty: nums.sold_qty,
        returned_qty: nums.returned_qty,
        unit_cost: unitCost,
        remaining_qty: remainingQty,
        remaining_inventory_value: remainingValue
      });
    });

    if (!validItems.length) {
      return res.status(400).json({ error: '没有有效行可导入', errors });
    }

    const customerSet = new Set();
    const skuSet = new Set();
    let totalRemainingQty = 0;
    let totalRemainingValue = 0;
    validItems.forEach(v => {
      if (v.customer_name) customerSet.add(v.customer_name);
      skuSet.add(v.sku_code);
      totalRemainingQty += v.remaining_qty;
      totalRemainingValue += v.remaining_inventory_value;
    });

    const batchId = genId('cib');
    const userId = req.currentUserId || '';
    const userName = req.currentUserName || '';

    transaction(() => {
      // 1. 创建导入批次记录（status='pending'）
      run(`INSERT INTO consignment_inventory_import_batches
        (id, warehouse_name, country_name, original_filename, total_rows, valid_rows, error_rows, customer_count, sku_count, total_remaining_qty, total_remaining_value, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
        [batchId, warehouse, country, (original_filename || '').toString(), rows.length, validItems.length, errors.length,
         customerSet.size, skuSet.size, totalRemainingQty,
         Math.round((totalRemainingValue + Number.EPSILON) * 10000) / 10000, userId]);

      // 2. 写入所有批次行（status 默认 'active'）
      validItems.forEach((v, i) => {
        run(`INSERT INTO consignment_inventory_lots
          (id, country_name, warehouse_name, customer_name, outbound_no, outbound_date, sku_code,
           outbound_qty, sold_qty, returned_qty, remaining_qty, unit_cost, remaining_inventory_value,
           import_batch_id, source_line_no, source_type, status, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'excel', 'active', ?, datetime('now'))`,
          [genId('cil'), country, warehouse, v.customer_name, v.outbound_no, v.outbound_date, v.sku_code,
           v.outbound_qty, v.sold_qty, v.returned_qty, v.remaining_qty, v.unit_cost, v.remaining_inventory_value,
           batchId, i + 1, userId]);
      });

      // 3. 作废该仓库此前活跃的寄售批次行（保留新插入的本批次行）
      run(`UPDATE consignment_inventory_lots SET status = 'superseded', updated_at = datetime('now')
        WHERE warehouse_name = ? AND status = 'active' AND import_batch_id != ?`, [warehouse, batchId]);

      // 4. 激活新批次
      run(`UPDATE consignment_inventory_import_batches SET status = 'active', activated_at = datetime('now') WHERE id = ?`, [batchId]);

      // 5. [已解耦] 寄售库存不再投影进入 inventory 总表；寄售库存以 consignment_inventory_lots 为事实源，由首页资产汇总与寄售独立页读取。

      // 6. 记录操作日志
      logOperation({
        operator_id: userId,
        operator_name: userName,
        page: 'consignment_inventory',
        operation_type: 'import',
        target_ids: [batchId],
        affected_count: validItems.length,
        old_values: {},
        new_values: { warehouse_name: warehouse, country_name: country, original_filename: original_filename || '',
          total_rows: rows.length, valid_rows: validItems.length, total_remaining_qty: totalRemainingQty,
          total_remaining_value: totalRemainingValue },
        reason: '',
        triggered_recalc: 0,
        is_rollbackable: 0
      });
    });

    res.json({
      success: true,
      batch_id: batchId,
      stats: {
        total_rows: rows.length,
        valid_rows: validItems.length,
        total_remaining_qty: totalRemainingQty,
        total_remaining_value: Math.round((totalRemainingValue + Number.EPSILON) * 10000) / 10000
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 寄售库存批次行查询（活跃）
// 数据源：consignment_inventory_lots（寄售事实表），不读取 inventory。
// 筛选：warehouse / sku_code / country / customer_name；并套用与 inventory 相同的数据权限 scope。
app.get('/api/consignment-inventory/lots', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  try {
    const { warehouse, sku_code, country, customer_name } = req.query;
    // 数据权限 scope：与 inventory 一致（country/warehouse 维度），列名适配到 consignment_inventory_lots
    const dsf = buildDashboardScopeFilters(req);
    const lotScope = adaptScopeToLots(dsf.inventory);
    let sql = `SELECT * FROM consignment_inventory_lots WHERE status = 'active'` + lotScope.sql;
    const params = lotScope.params.slice();
    if (warehouse) { sql += ' AND warehouse_name = ?'; params.push(warehouse); }
    if (sku_code) { sql += ' AND sku_code = ?'; params.push(sku_code); }
    if (country) { sql += ' AND country_name = ?'; params.push(country); }
    if (customer_name) { sql += ' AND customer_name LIKE ?'; params.push('%' + customer_name + '%'); }
    sql += ' ORDER BY customer_name, outbound_no';
    res.json(query(sql, params).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 寄售库存导入批次历史
app.get('/api/consignment-inventory/batches', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  try {
    res.json(query(`SELECT * FROM consignment_inventory_import_batches ORDER BY created_at DESC LIMIT 50`).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 获取库存快照截止日期（按 国家+仓库 维度返回）
app.get('/api/inventory/snapshot-cutoff-date', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  const rows = query(`
    SELECT country, warehouse, snapshot_cutoff_date
    FROM inventory
    WHERE snapshot_cutoff_date IS NOT NULL AND snapshot_cutoff_date != ''
    GROUP BY country, warehouse, snapshot_cutoff_date
    ORDER BY country, warehouse
  `).rows;
  // 聚合为 country|warehouse -> snapshot_cutoff_date 的映射
  const cutoffMap = {};
  const cutoffList = [];
  rows.forEach(r => {
    const key = `${r.country || ''}|${r.warehouse || ''}`;
    // 如果同一 country+warehouse 有多个 cutoff_date，取最大的（最新的导入）
    if (!cutoffMap[key] || r.snapshot_cutoff_date > cutoffMap[key]) {
      cutoffMap[key] = r.snapshot_cutoff_date;
    }
  });
  Object.entries(cutoffMap).forEach(([key, date]) => {
    const [country, warehouse] = key.split('|');
    cutoffList.push({ country, warehouse, snapshot_cutoff_date: date });
  });
  res.json({ cutoff_dates: cutoffList, cutoff_map: cutoffMap });
}));

// 按 国家+仓库 获取 snapshot_cutoff_date 的辅助函数
function getSnapshotCutoffMap() {
  const rows = query(`
    SELECT country, warehouse, MAX(snapshot_cutoff_date) as snapshot_cutoff_date
    FROM inventory
    WHERE snapshot_cutoff_date IS NOT NULL AND snapshot_cutoff_date != ''
    GROUP BY country, warehouse
  `).rows;
  const map = {};
  rows.forEach(r => {
    map[`${r.country || ''}|${r.warehouse || ''}`] = r.snapshot_cutoff_date;
  });
  return map;
}

// P1-03-B: 查询最新已确认且锁定的 WAC 版本（唯一读取规则）
async function latestConfirmedWac(skuCode, country, warehouse) {
  return await queryOne(`
    SELECT * FROM wac_history
    WHERE sku_code = ? AND country = ? AND warehouse = ?
      AND confirmation_status = 'confirmed' AND is_locked = 1
    ORDER BY version_no DESC
    LIMIT 1
  `, [skuCode, country, warehouse]);
}

// P1-03-B: 在事务内生成下一版本号并插入锁定的 WAC 历史
// logistics_batch_id: 物流批次WAC确认时传入，CI手动确认时不传（默认''）
function generateWacVersion(params) {
  const { ci_id, ci_no, po_id, po_no, pi_id, pi_no, sku_code, model, brand, country, warehouse,
          original_qty, original_avg_cost, original_inventory_value,
          inbound_qty, unit_landing_cost, inbound_total_cost, new_avg_cost,
          settlement_date, confirmed_by, logistics_batch_id } = params;

  // 在事务内获取当前最大版本号
  const maxVersion = queryOne(`
    SELECT MAX(version_no) as max_ver FROM wac_history
    WHERE sku_code = ? AND country = ? AND warehouse = ?
  `, [sku_code, country, warehouse]);
  const nextVersionNo = (maxVersion && maxVersion.max_ver != null) ? maxVersion.max_ver + 1 : 1;

  const id = genId('wac');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  run(`INSERT INTO wac_history (id, version_no, ci_id, ci_no, po_id, po_no, pi_id, pi_no,
      sku_code, model, brand, country, warehouse,
      original_qty, original_avg_cost, original_inventory_value,
      inbound_qty, unit_landing_cost, inbound_total_cost, new_avg_cost,
      settlement_date, confirmation_status, is_locked, confirmed_by, confirmed_at, logistics_batch_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, nextVersionNo, ci_id || '', ci_no || '', po_id || '', po_no || '', pi_id || '', pi_no || '',
     sku_code, model || '', brand || '', country || '', warehouse || '',
     original_qty || 0, original_avg_cost || 0, original_inventory_value || 0,
     inbound_qty || 0, unit_landing_cost || 0, inbound_total_cost || 0, new_avg_cost || 0,
     settlement_date || '', 'confirmed', 1, confirmed_by || '', now, logistics_batch_id || null, now]);

  return { id, version_no: nextVersionNo };
}

// 库存导入日期归一化：inventory_imports.import_date 在历史数据中混存了
// M/D/YY（如 "8/2/26"）与 ISO（"2026-07-06"）两种文本格式，导致
// MAX(import_date) 在 TEXT 列上做字典序比较时选出错误的"最新"批次
// （'8/2/26' 字典序 > '8/11/26'），使库存快照截止日期停留在旧批次。
// 归一为 ISO(YYYY-MM-DD) 后，TEXT 字典序比较即等价于真实日期比较。
function normalizeImportDate(v) {
  if (v === null || v === undefined) return v;
  const s = String(v).trim();
  if (!s) return s;
  // 已是 ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // M/D/YY 或 M/D/YYYY（美式；2 位年份视为 20xx）
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    const mo = String(parseInt(m[1], 10)).padStart(2, '0');
    const d = String(parseInt(m[2], 10)).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  // 年在前、斜杠分隔（YYYY/M/D 或 YYYY/M/D）
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = String(parseInt(m[2], 10)).padStart(2, '0');
    const d = String(parseInt(m[3], 10)).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  // 无法识别则原样返回，避免破坏数据
  return s;
}

// 启动期一次性回填：把历史 inventory_imports.import_date 统一归一为 ISO。
// 幂等——已为 ISO 的行不改动；仅修正混存的 M/D/YY 文本。
function normalizeImportDatesBackfill() {
  try {
    const rows = query('SELECT id, import_date FROM inventory_imports WHERE import_date IS NOT NULL AND import_date <> \'\'').rows;
    let changed = 0;
    transaction(() => {
      for (const r of rows) {
        const norm = normalizeImportDate(r.import_date);
        if (norm && norm !== r.import_date) {
          run('UPDATE inventory_imports SET import_date = ? WHERE id = ?', [norm, r.id]);
          changed++;
        }
      }
    });
    if (changed) console.log(`[BACKFILL] 归一化 inventory_imports.import_date 共 ${changed} 行（M/D/YY → ISO）`);
  } catch (e) {
    console.error('[BACKFILL] import_date 归一化失败:', e.message);
  }
}

// 取每个 SKU+国家+仓库 最新批次的 SQL。
// 关键修复：原本 `import_date = (SELECT MAX(import_date) ...)` 在 TEXT 列上做字典序
// 比较，遇到 M/D/YY 文本会选错批次。改为按真实日期比较（PG 用 ::date，SQLite 用 date()），
// 即便历史数据未完全归一也能选出正确的"最新"导入日期。
function latestImportsSql() {
  const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
  if (driver === 'pg') {
    return `
      SELECT sku_code, country, warehouse, available_qty, import_date, snapshot_cutoff_date, weighted_avg_cost, last_inbound_date, first_inbound_date
      FROM inventory_imports i1
      WHERE i1.import_date IS NOT NULL AND i1.import_date <> ''
        AND i1.import_date::date = (
          SELECT MAX(i2.import_date::date)
          FROM inventory_imports i2
          WHERE i2.sku_code = i1.sku_code AND i2.country = i1.country AND i2.warehouse = i1.warehouse
            AND i2.import_date IS NOT NULL AND i2.import_date <> ''
        )`;
  }
  return `
    SELECT sku_code, country, warehouse, available_qty, import_date, snapshot_cutoff_date, weighted_avg_cost, last_inbound_date, first_inbound_date
    FROM inventory_imports i1
    WHERE i1.import_date IS NOT NULL AND i1.import_date <> ''
      AND date(i1.import_date) = (
        SELECT MAX(date(i2.import_date))
        FROM inventory_imports i2
        WHERE i2.sku_code = i1.sku_code AND i2.country = i1.country AND i2.warehouse = i1.warehouse
          AND i2.import_date IS NOT NULL AND i2.import_date <> ''
      )`;
}

// 刷新库存总表（根据导入记录和业务数据重新计算）
async function refreshInventoryTotals(snapshotCutoffDate) {
  // P1-03-B: WAC 不再从文件列读取，改为查 latest confirmed locked WAC 版本
  const warnings = [];
  // 获取每个 SKU+国家+仓库 的最新可用库存（连同 snapshot_cutoff_date）
  const latestImports = query(latestImportsSql()).rows;

  transaction(async () => {
    for (const imp of latestImports) {
      const cutoff = imp.snapshot_cutoff_date || snapshotCutoffDate || '';
      const existing = queryOne('SELECT id, weighted_avg_cost, last_inbound_date, first_inbound_date FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
        [imp.sku_code, imp.country, imp.warehouse]);

      // WAC 来源优先级（按权威性从高到低）：
      //   1. confirmed wac_history — 后续 CI 成本确认产生的正式 WAC
      //   2. existing inventory WAC (≠0) — 已存在有效成本，不覆盖
      //   3. opening import WAC (>0) — 库存导入时提供的加权平均成本，用于无正式 WAC 的新库存初始化
      //   4. 0 — 兜底，表示无有效成本
      const wacRecord = await latestConfirmedWac(imp.sku_code, imp.country, imp.warehouse);
      let wac, wacSource;
      if (wacRecord) {
        wac = wacRecord.new_avg_cost || 0;
        wacSource = 'confirmed';
      } else if (existing && (existing.weighted_avg_cost || 0) !== 0) {
        // 保留已有有效 WAC，不被新的库存同步覆盖
        wac = existing.weighted_avg_cost || 0;
        wacSource = 'existing';
        warnings.push({
          sku_code: imp.sku_code, country: imp.country, warehouse: imp.warehouse,
          priority: 'warning',
          message: '未找到最新已确认加权平均成本，已保留原成本，请完成成本确认。'
        });
      } else if (imp.weighted_avg_cost && Number(imp.weighted_avg_cost) > 0) {
        // 库存初始化：使用导入文件中的加权平均成本
        wac = Number(imp.weighted_avg_cost);
        wacSource = 'opening';
      } else {
        // 无有效成本，使用 0
        wac = 0;
        wacSource = 'none';
        warnings.push({
          sku_code: imp.sku_code, country: imp.country, warehouse: imp.warehouse,
          priority: 'high',
          message: '未找到已确认加权平均成本，成本与金额暂为 0，请尽快完成成本确认。'
        });
      }
      const invValue = (parseInt(imp.available_qty) || 0) * wac;

      // last_inbound_date 更新规则：导入文件有值则更新，否则保留原值
      const newLastInbound = (imp.last_inbound_date && String(imp.last_inbound_date).trim()) ? imp.last_inbound_date : (existing ? existing.last_inbound_date : '');
      // first_inbound_date 更新规则：导入文件填写新日期才更新；为空则保留旧值
      const newFirstInbound = (imp.first_inbound_date && String(imp.first_inbound_date).trim()) ? imp.first_inbound_date : (existing ? existing.first_inbound_date : '');
      if (existing) {
        run(`UPDATE inventory SET available_qty = ?, weighted_avg_cost = ?, inventory_value = ?, last_import_date = ?, snapshot_cutoff_date = ?, last_inbound_date = ?, first_inbound_date = ?, updated_at = datetime('now') WHERE id = ?`,
          [imp.available_qty, wac, invValue, imp.import_date, cutoff, newLastInbound, newFirstInbound, existing.id]);
      } else {
        run(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_import_date, snapshot_cutoff_date, last_inbound_date, first_inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [genId('inv'), imp.sku_code, imp.country, imp.warehouse, imp.available_qty, wac, invValue, imp.import_date, cutoff, newLastInbound, newFirstInbound]);
      }
    }
    // 更新在途、PI未发货、PO未确认等
    await updateInventoryTransitData();
  });
  return { warnings };
}

// 更新库存的在途数据
async function updateInventoryTransitData() {
  // 采购链状态变化自动回写库存总表的在途类字段：
  //   po_unconfirmed_pi_qty / pi_confirmed_unshipped_qty / in_transit_qty
  // 全量重算（SET 聚合值，非 +=），幂等，与导入流程不冲突。
  // 注：本函数只更新已存在的 inventory 行；新采购 SKU 若无 inventory 行则 transit 字段保持原值。
  // 整段重算包成单个事务：reset+逐行回写 原子提交，任何一步失败整体 ROLLBACK，
  // 避免出现「先清零、只写回一部分」的半更新状态。
  transaction(() => {
  // 在途口径（方案 B）：CI 已发货数量 - 已完成到仓(completed)物流批次对应 PL 的 SKU 数量
  // 不读取 inbound_qty；物理到仓由 logistics_status='completed' + PL items 决定。
  // 先全量清零（保证被作废/删除后贡献降为 0 的 SKU 也能回落，而非残留旧值），再按事实聚合写入
  run('UPDATE inventory SET in_transit_qty = 0');
  const transitData = (query(`
    WITH shipped AS (
      SELECT cii.ci_id, cii.sku_code,
             SUM(COALESCE(cii.shipped_qty, 0)) AS shipped_qty
      FROM commercial_invoice_items cii
      JOIN commercial_invoices ci ON ci.id = cii.ci_id
      WHERE ci.ci_status NOT IN ('cancelled')
      GROUP BY cii.ci_id, cii.sku_code
    ),
    arrived AS (
      SELECT lb.related_ci_id AS ci_id, pli.sku_code,
             SUM(COALESCE(pli.total_qty, 0)) AS arrived_qty
      FROM logistics_batches lb
      JOIN packing_lists pl ON pl.logistics_batch_id = lb.id
      JOIN packing_list_items pli ON pli.pl_id = pl.id
      WHERE lb.logistics_status = 'completed'
        AND lb.related_ci_id IS NOT NULL
      GROUP BY lb.related_ci_id, pli.sku_code
    ),
    per_ci_transit AS (
      SELECT s.sku_code, ci.country, ci.target_warehouse AS warehouse,
             CASE WHEN COALESCE(s.shipped_qty, 0) - COALESCE(a.arrived_qty, 0) < 0 THEN 0
                  ELSE COALESCE(s.shipped_qty, 0) - COALESCE(a.arrived_qty, 0) END AS in_transit_qty
      FROM shipped s
      JOIN commercial_invoices ci ON ci.id = s.ci_id
      LEFT JOIN arrived a ON a.ci_id = s.ci_id AND a.sku_code = s.sku_code
      WHERE ci.country != '' AND ci.target_warehouse != ''
    )
    SELECT sku_code, country, warehouse, SUM(in_transit_qty) AS in_transit_qty
    FROM per_ci_transit
    GROUP BY sku_code, country, warehouse
    HAVING SUM(in_transit_qty) > 0
  `)).rows;

  for (const td of transitData) {
    const inv = queryOne('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
      [td.sku_code, td.country, td.warehouse]);
    if (inv) {
      run('UPDATE inventory SET in_transit_qty = ? WHERE id = ?', [td.in_transit_qty || 0, inv.id]);
    }
  }

  // PI已确认未发货
  run('UPDATE inventory SET pi_confirmed_unshipped_qty = 0');
  const piData = (query(`
    SELECT pii.sku_code,
           COALESCE(NULLIF(pi.country,''), po.country) as country,
           COALESCE(NULLIF(pi.target_warehouse,''), po.target_warehouse) as warehouse,
           SUM(pii.pi_confirmed_qty - pii.shipped_qty) as pi_unshipped
    FROM proforma_invoice_items pii
    JOIN proforma_invoices pi ON pii.pi_id = pi.id
    LEFT JOIN purchase_orders po ON pi.related_po_id = po.id
    WHERE pi.pi_status NOT IN ('cancelled', 'completed')
      AND (pii.pi_confirmed_qty - pii.shipped_qty) > 0
    GROUP BY pii.sku_code,
             COALESCE(NULLIF(pi.country,''), po.country),
             COALESCE(NULLIF(pi.target_warehouse,''), po.target_warehouse)
  `)).rows;

  for (const pd of piData) {
    const inv = queryOne('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
      [pd.sku_code, pd.country, pd.warehouse]);
    if (inv) {
      run('UPDATE inventory SET pi_confirmed_unshipped_qty = ? WHERE id = ?', [pd.pi_unshipped || 0, inv.id]);
    }
  }

  // PO已生成未确认PI
  run('UPDATE inventory SET po_unconfirmed_pi_qty = 0');
  const poData = (query(`
    SELECT poi.sku_code, po.country, po.target_warehouse as warehouse,
           SUM(poi.po_qty - poi.transferred_pi_qty) as po_unconfirmed
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.po_id = po.id
    WHERE po.po_status NOT IN ('cancelled', 'transferred_pi') AND (poi.po_qty - poi.transferred_pi_qty) > 0
    GROUP BY poi.sku_code, po.country, po.target_warehouse
  `)).rows;

  for (const pd of poData) {
    const inv = queryOne('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
      [pd.sku_code, pd.country, pd.warehouse]);
    if (inv) {
      run('UPDATE inventory SET po_unconfirmed_pi_qty = ? WHERE id = ?', [pd.po_unconfirmed || 0, inv.id]);
    }
  }
  });
}

// ==================== 出库数据 ====================
app.get('/api/outbound-records', requireApiPermission('outbound_view'), asyncHandler((req, res) => {
  const { country, warehouse, brand, outbound_type, outbound_status, channel, start_date, end_date, inventory_effect, import_batch_id } = req.query;
  let sql = `SELECT o.*, s.brand FROM outbound_records o LEFT JOIN skus s ON o.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND o.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND o.warehouse = ?'; params.push(warehouse); }
  if (brand) { sql += ' AND s.brand = ?'; params.push(brand); }
  if (outbound_type) { sql += ' AND o.outbound_type = ?'; params.push(outbound_type); }
  if (outbound_status) { sql += ' AND o.outbound_status = ?'; params.push(outbound_status); }
  if (channel) { sql += ' AND o.channel = ?'; params.push(channel); }
  if (start_date) { sql += ' AND o.outbound_date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND o.outbound_date <= ?'; params.push(end_date); }
  if (inventory_effect) { sql += ' AND o.inventory_effect = ?'; params.push(inventory_effect); }
  if (import_batch_id) { sql += ' AND o.import_batch_id = ?'; params.push(import_batch_id); }
  sql += ' ORDER BY o.outbound_date DESC, o.created_at DESC LIMIT 500';
  res.json(query(sql, params).rows);
}));

// 出库数据筛选下拉选项（从实际数据动态聚合）
app.get('/api/outbound-records/filter-options', requireApiPermission('outbound_view'), asyncHandler((req, res) => {
  const countries = query(`SELECT DISTINCT country FROM outbound_records WHERE country IS NOT NULL AND country != '' ORDER BY country`).rows.map(r => r.country);
  const warehouses = query(`SELECT DISTINCT warehouse FROM outbound_records WHERE warehouse IS NOT NULL AND warehouse != '' ORDER BY warehouse`).rows.map(r => r.warehouse);
  const brands = query(`SELECT DISTINCT s.brand FROM outbound_records o JOIN skus s ON o.sku_code = s.sku_code WHERE s.brand IS NOT NULL AND s.brand != '' ORDER BY s.brand`).rows.map(r => r.brand);
  res.json({ countries, warehouses, brands });
}));

app.post('/api/outbound-records', requireApiPermission('outbound_create'), asyncHandler((req, res) => {
  try {
    const d = req.body;
    if (!d.sku_code || !d.outbound_date) return res.status(400).json({ error: 'SKU和出库日期不能为空' });
    const oId = genId('outbound');
    const oNo = d.outbound_no || `OUT-${Date.now()}`;
    const ci = d.consume_inventory !== undefined ? parseInt(d.consume_inventory) : 1;
    const invEffect = ci === 1 ? 'deducted' : 'none';
    run(`INSERT INTO outbound_records (id, outbound_no, outbound_date, country, warehouse, sku_code, quantity, outbound_type, channel, platform, mdf_type, related_project, count_for_forecast, consume_inventory, remark, import_mode, inventory_effect, applied_to_inventory, platform_order_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [oId, oNo, d.outbound_date, d.country || '', d.warehouse || '', d.sku_code, d.quantity || 0, d.outbound_type || '', d.channel || '', d.platform || '', d.mdf_type || '', d.related_project || '', d.count_for_forecast !== undefined ? d.count_for_forecast : 1, ci, d.remark || '', 'operational', invEffect, ci, d.platform_order_no || '']);
    // 扣减库存
    if (ci === 1) {
      const inv = queryOne('SELECT id FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [d.sku_code, d.country || '', d.warehouse || '']);
      if (inv) {
        run('UPDATE inventory SET available_qty=available_qty-?, updated_at=datetime(\'now\') WHERE id=?', [d.quantity || 0, inv.id]);
        recalcInventoryForSku(d.sku_code, d.country || '', d.warehouse || '');
      }
    }
    res.json({ id: oId, outbound_no: oNo, ...d });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 出库类型中文映射
const OB_TYPE_MAP = {'线上销售':'online_sale','线下销售':'offline_sale','MDF达人':'mdf_influencer','MDF活动':'mdf_event','调拨':'transfer','报废':'scrap','样品':'sample','损坏':'damage','退货':'return_out','手工调整':'manual_adjustment'};
const OB_CHANNEL_MAP = {'线上':'online','线下':'offline'};
const OB_FORECAST_TYPES = ['sale','online_sale','offline_sale'];

// 重复校验：检查出库记录是否已存在
// 优先用 platform_order_no(出库单号)+SKU 判断；如果没有出库单号，再用 SKU+日期+国家+仓库+数量+类型+渠道+平台 判断
function checkDuplicateOutbound(item) {
  // 先映射类型和渠道为英文值（与存储一致）
  const rawType = item.outbound_type || '';
  const outboundType = OB_TYPE_MAP[rawType] || rawType || 'online_sale';
  const rawChannel = item.channel || '';
  const channel = OB_CHANNEL_MAP[rawChannel] || rawChannel || 'online';
  const platformOrderNo = (item.platform_order_no || '').trim();

  // 优先用 出库单号+SKU 判断重复
  if (platformOrderNo) {
    const existingByOrder = queryOne(
      `SELECT id FROM outbound_records WHERE platform_order_no=? AND sku_code=? AND outbound_status='normal' LIMIT 1`,
      [platformOrderNo, item.sku_code]
    );
    if (existingByOrder) return true;
    // 即使没有完全匹配，也检查同出库单号是否已存在（不同SKU不算重复，但如果同SKU则重复）
    // 上面已检查 platform_order_no+sku_code 组合，如果没找到则不重复
    return false;
  }

  // 没有出库单号，使用复合键判断
  const existing = queryOne(
    `SELECT id FROM outbound_records WHERE sku_code=? AND outbound_date=? AND country=? AND warehouse=? AND quantity=? AND outbound_type=? AND channel=? AND platform=? AND (platform_order_no IS NULL OR platform_order_no='') AND outbound_status='normal' LIMIT 1`,
    [item.sku_code, item.outbound_date, item.country || '', item.warehouse || '', parseInt(item.quantity) || 0, outboundType, channel, item.platform || '']
  );
  return !!existing;
}

// 预览导入（不执行写入）
app.post('/api/outbound-records/bulk-import-preview', requireApiPermission('outbound_view'), asyncHandler((req, res) => {
  try {
    const items = req.body.items || [];
    const importMode = req.body.import_mode || 'auto_by_snapshot_date'; // historical / auto_by_snapshot_date / operational
    // 获取按 国家+仓库 维度的 snapshot_cutoff_date 映射
    const cutoffMap = importMode === 'auto_by_snapshot_date' ? getSnapshotCutoffMap() : {};
    const stats = { total: items.length, will_deduct: 0, not_deduct: 0, duplicate: 0, invalid: 0, errors: [] };
    items.forEach((item, i) => {
      if (!item.sku_code || !item.outbound_date) { stats.invalid++; stats.errors.push({ row: i + 2, reason: 'SKU或出库日期为空' }); return; }
      // 重复校验
      if (checkDuplicateOutbound(item)) { stats.duplicate++; return; }
      // 判断是否扣减
      let shouldDeduct = false;
      if (importMode === 'historical') {
        shouldDeduct = false;
      } else if (importMode === 'operational') {
        shouldDeduct = true;
      } else { // auto_by_snapshot_date
        // 按记录的 country+warehouse 查找 snapshot_cutoff_date
        const key = `${item.country || ''}|${item.warehouse || ''}`;
        const recordCutoff = cutoffMap[key];
        if (!recordCutoff) {
          // 找不到对应国家+仓库的 snapshot_cutoff_date，标记为异常
          stats.invalid++;
          stats.errors.push({ row: i + 2, reason: `找不到国家「${item.country || ''}」仓库「${item.warehouse || ''}」对应的库存快照截止日期，无法自动判断是否扣减库存。请先在库存总表导入该国家+仓库的库存快照。` });
          return;
        }
        shouldDeduct = item.outbound_date > recordCutoff;
      }
      if (shouldDeduct) stats.will_deduct++;
      else stats.not_deduct++;
    });
    res.json(stats);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 正式导入
app.post('/api/outbound-records/bulk-import', requireApiPermission('outbound_create'), asyncHandler((req, res) => {
  try {
    const items = req.body.items || [];
    const importMode = req.body.import_mode || 'auto_by_snapshot_date'; // historical / auto_by_snapshot_date / operational
    // 获取按 国家+仓库 维度的 snapshot_cutoff_date 映射
    const cutoffMap = importMode === 'auto_by_snapshot_date' ? getSnapshotCutoffMap() : {};
    const batchId = genId('ob_batch');
    const result = { created: 0, failed: 0, duplicate: 0, deducted: 0, not_deducted: 0, total_deducted_qty: 0, errors: [], import_batch_id: batchId };
    const affectedSkus = new Set();

    transaction(() => {
      items.forEach((item, i) => {
        try {
          if (!item.sku_code || !item.outbound_date) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU或出库日期为空' }); return; }
          // 重复校验
          if (checkDuplicateOutbound(item)) { result.duplicate++; return; }
          // 类型映射
          const rawType = item.outbound_type || '';
          const outboundType = OB_TYPE_MAP[rawType] || rawType || 'online_sale';
          const rawChannel = item.channel || '';
          const channel = OB_CHANNEL_MAP[rawChannel] || rawChannel || 'online';
          const defaultForecast = OB_FORECAST_TYPES.includes(outboundType) ? 1 : 0;
          // 判断是否扣减库存
          let shouldDeduct = false;
          let recordSnapshotCutoff = '';
          if (importMode === 'historical') {
            shouldDeduct = false;
          } else if (importMode === 'operational') {
            shouldDeduct = true;
          } else { // auto_by_snapshot_date
            // 按记录的 country+warehouse 查找 snapshot_cutoff_date
            const key = `${item.country || ''}|${item.warehouse || ''}`;
            recordSnapshotCutoff = cutoffMap[key] || '';
            if (!recordSnapshotCutoff) {
              // 找不到对应国家+仓库的 snapshot_cutoff_date，标记为异常并跳过
              result.failed++;
              result.errors.push({ row: i + 2, reason: `找不到国家「${item.country || ''}」仓库「${item.warehouse || ''}」对应的库存快照截止日期，无法自动判断是否扣减库存。请先在库存总表导入该国家+仓库的库存快照。` });
              return;
            }
            shouldDeduct = item.outbound_date > recordSnapshotCutoff;
          }
          const inventoryEffect = shouldDeduct ? 'deducted' : 'none';
          const appliedToInventory = shouldDeduct ? 1 : 0;
          const qty = parseInt(item.quantity) || 0;
          const platformOrderNo = (item.platform_order_no || '').trim();
          const oId = genId('outbound');
          run(`INSERT INTO outbound_records (id, outbound_no, outbound_date, country, warehouse, sku_code, quantity, outbound_type, channel, platform, mdf_type, related_project, count_for_forecast, consume_inventory, remark, import_mode, inventory_effect, applied_to_inventory, snapshot_cutoff_date, import_batch_id, platform_order_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [oId, `OUT-${Date.now()}-${i}`, item.outbound_date, item.country || '', item.warehouse || '', item.sku_code, qty, outboundType, channel, item.platform || '', item.mdf_type || '', item.related_project || '', defaultForecast, appliedToInventory, item.remark || '', importMode, inventoryEffect, appliedToInventory, recordSnapshotCutoff, batchId, platformOrderNo]);
          // 扣减库存
          if (shouldDeduct) {
            const inv = queryOne('SELECT id FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [item.sku_code, item.country || '', item.warehouse || '']);
            if (inv) {
              run('UPDATE inventory SET available_qty=available_qty-?, updated_at=datetime(\'now\') WHERE id=?', [qty, inv.id]);
              result.deducted++;
              result.total_deducted_qty += qty;
            }
          } else {
            result.not_deducted++;
          }
          affectedSkus.add(`${item.sku_code}|${item.country||''}|${item.warehouse||''}`);
          result.created++;
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
      // 导入后触发重算
      affectedSkus.forEach(key => {
        const [sku, country, warehouse] = key.split('|');
        recalcInventoryForSku(sku, country, warehouse);
      });
    });
    // 记录操作日志
    logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'bulk_import', target_ids:[], affected_count:result.created, old_values:{}, new_values:{import_mode:importMode, batch_id:batchId}, reason:'', triggered_recalc:1, is_rollbackable:0});
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 销量数据 ====================
app.get('/api/sales-data', requireApiPermission('outbound_view'), asyncHandler((req, res) => {
  const { sku_code, country, channel, start_date, end_date } = req.query;
  let sql = 'SELECT * FROM sales_data WHERE 1=1';
  const params = [];
  if (sku_code) { sql += ' AND sku_code = ?'; params.push(sku_code); }
  if (country) { sql += ' AND country = ?'; params.push(country); }
  if (channel) { sql += ' AND channel = ?'; params.push(channel); }
  if (start_date) { sql += ' AND date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND date <= ?'; params.push(end_date); }
  sql += ' ORDER BY date DESC LIMIT 1000';
  res.json(query(sql, params).rows);
}));

app.post('/api/sales-data/bulk-import', requireApiPermission('outbound_create'), asyncHandler((req, res) => {
  try {
    const items = req.body.items || [];
    const result = { created: 0, failed: 0, errors: [] };
    transaction(() => {
      items.forEach((item, i) => {
        try {
          if (!item.sku_code || !item.date) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU或日期为空' }); return; }
          run(`INSERT INTO sales_data (id, date, sku_code, country, channel, platform, quantity, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('sale'), item.date, item.sku_code, item.country || '', item.channel || '', item.platform || '', parseInt(item.quantity) || 0, parseFloat(item.amount) || 0]);
          result.created++;
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 销售明细数据（新） ====================

// 销售明细导入使用独立的异步批量适配器：SQLite 复用同一连接句柄，
// PostgreSQL 直接使用原生 async DAL，避免把 1,000 条导入重新送入
// db.js 的 Atomics.wait 同步包装器。其他业务模块仍走既有 db 接口。
function createSalesImportAdapter() {
  if ((process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'pg') {
    const pgSalesDb = require('./db-pg');
    return createPostgresSalesImportAdapter(pgSalesDb, { batchSize: 1000 });
  }
  const sqliteSalesDb = require('./db-sqlite');
  return createSqliteSalesImportAdapter(sqliteSalesDb, { batchSize: 80 });
}

function createSalesImportRunStoreForCurrentDb() {
  const isPg = (process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'pg';
  return createSalesImportRunStore(isPg ? require('./db-pg') : require('./db-sqlite'));
}

function salesImportFingerprint(items) {
  return crypto.createHash('sha256').update(JSON.stringify(Array.isArray(items) ? items : [])).digest('hex');
}

function salesImportResultBody(run) {
  const result = run && run.result && Object.keys(run.result).length ? run.result : {};
  return {
    ...result,
    total: run ? run.total_count : result.total,
    inserted: run ? run.inserted : result.inserted,
    updated: run ? run.updated : result.updated,
    skipped: run ? run.skipped : result.skipped,
    failed: run ? run.failed : result.failed,
    errors: run ? run.errors : (result.errors || []),
    import_id: run && run.import_id,
    status: run && run.status,
    phase: run && run.phase,
    percent: run && run.percent,
    processed_count: run && run.processed_count,
    total_count: run && run.total_count,
    timings: run && run.timings,
    metrics: run && run.metrics,
    commit_state: run && run.commit_state,
    recalc_status: run && run.recalc_status
  };
}

function isUncertainSalesImportError(error) {
  const code = String(error && error.code || '').toUpperCase();
  const message = String(error && error.message || '');
  return ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', '57P01', '08006', '08003'].includes(code) ||
    /connection (?:reset|terminated|closed)|socket hang up|network timeout|timeout.*connection/i.test(message);
}

function salesImportIdFactory() {
  return () => genId('sale');
}

// 销售明细统一筛选构造：生成 { sql, params }，供列表 / ids 接口共用，避免两套 WHERE 漂移。
function buildSalesRecordsWhere(req) {
  const q = (req && req.query) || {};
  const { source_system, order_no, shop_platform, brand, sku_code, is_valid, start_date, end_date, import_batch_id, country } = q;
  const parts = [];
  const params = [];
  if (source_system) { parts.push(' AND sr.source_system = ?'); params.push(source_system); }
  if (order_no) { parts.push(' AND sr.order_no LIKE ?'); params.push('%' + order_no + '%'); }
  if (shop_platform) { parts.push(' AND sr.shop_platform = ?'); params.push(shop_platform); }
  if (brand) { parts.push(' AND sr.brand = ?'); params.push(brand); }
  if (sku_code) { parts.push(' AND LOWER(sr.sku_code) LIKE ?'); params.push('%' + String(sku_code).toLowerCase() + '%'); }
  if (is_valid !== undefined && is_valid !== '') { parts.push(' AND sr.is_valid_order = ?'); params.push(parseInt(is_valid)); }
  if (start_date) { parts.push(' AND sr.order_date >= ?'); params.push(start_date); }
  if (end_date) { parts.push(' AND sr.order_date <= ?'); params.push(end_date); }
  if (import_batch_id) { parts.push(' AND sr.import_batch_id = ?'); params.push(import_batch_id); }
  if (country) { parts.push(' AND sr.country = ?'); params.push(country); }
  // DATA-SCOPE: 数据权限（国家/品牌/仓库），与列表接口完全一致
  const scope = buildSalesDataScopeFilter(req, 'sr');
  if (scope.sql) { parts.push(scope.sql); params.push.apply(params, scope.params); }
  return { sql: parts.join(''), params };
}

// 销售明细列表
app.get('/api/sales-records', requireApiPermission('outbound_view'), asyncHandler((req, res) => {
  const { limit, offset } = req.query;
  let sql = `SELECT sr.*, s.product_name FROM sales_records sr LEFT JOIN skus s ON sr.sku_code = s.sku_code WHERE 1=1`;
  const { sql: whereSql, params } = buildSalesRecordsWhere(req);
  sql += whereSql;

  // Count total matching records (for pagination metadata)
  let countSql = sql.replace(/^SELECT sr\.\*, s\.product_name FROM/, 'SELECT COUNT(*) as total FROM');
  countSql = countSql.replace(/ LEFT JOIN skus s ON sr\.sku_code = s\.sku_code/, '');
  const totalResult = query(countSql, params);
  const total = totalResult.rows[0]?.total || 0;

  sql += ' ORDER BY sr.order_date DESC, sr.created_at DESC';
  const pageLimit = Math.min(Math.max(parseInt(limit) || 500, 1), 10000);
  const pageOffset = Math.max(parseInt(offset) || 0, 0);
  sql += ' LIMIT ' + pageLimit + ' OFFSET ' + pageOffset;
  const rows = query(sql, params).rows;
  res.json({ rows, total, limit: pageLimit, offset: pageOffset });
}));

// 销售明细 ID 列表（全筛选结果，不分页）—— 供"全选全部"使用，复用统一筛选构造
app.get('/api/sales-records/ids', requireApiPermission('outbound_view'), asyncHandler((req, res) => {
  const { sql: whereSql, params } = buildSalesRecordsWhere(req);
  const rows = query('SELECT sr.id FROM sales_records sr WHERE 1=1' + whereSql, params).rows;
  const ids = rows.map(r => r.id); // 保持 TEXT 字符串，禁止 parseInt/Number
  res.json({ ids, total: ids.length });
}));

// ==================== P2：销售记录删除安全基础设施（仅 preflight，不执行 DELETE）====================
// 这些 helper 为 P3 真实删除事务复用：规范化 ID、数据权限复校、affected key 解析。
// 本阶段所有函数均只读（SELECT），不修改 sales_records / replenishment_suggestions / inventory。

// 批量删除上限：防止客户端一次性提交几十万 ID 导致语句过大或长事务。
const SALES_DELETE_MAX_BATCH = 10000;

// 将客户端传入的 ids 规范化为唯一 TEXT 数组（绝不数字化）。
// 非法输入直接抛出 400（statusCode 字段供路由使用）。
function normalizeSalesRecordIds(input) {
  if (!Array.isArray(input)) {
    const err = new Error('ids 必须是数组');
    err.statusCode = 400;
    throw err;
  }
  if (input.length === 0) {
    const err = new Error('ids 不能为空');
    err.statusCode = 400;
    throw err;
  }
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    // P2.1-4：高风险删除链路严格要求字符串 id。拒绝 number/boolean/object/array/null/undefined。
    // 不再接受 String(...) 隐式转换，避免模糊类型进入破坏性 API（即便最终只会 409，也没必要接收）。
    // sales_records.id 真实类型为 TEXT，前端提交的也是字符串；严禁 Number / parseInt 数字化。
    if (raw === null || raw === undefined) {
      const err = new Error('存在无效 id（null/undefined）');
      err.statusCode = 400;
      throw err;
    }
    if (typeof raw !== 'string') {
      const err = new Error('存在非字符串 id（类型=' + typeof raw + '）');
      err.statusCode = 400;
      throw err;
    }
    const s = raw.trim();
    if (s === '') {
      const err = new Error('存在空 id');
      err.statusCode = 400;
      throw err;
    }
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s); // 保持 TEXT 原样，禁止 parseInt / Number / String 隐式转换
    }
  }
  if (out.length > SALES_DELETE_MAX_BATCH) {
    const err = new Error('批量删除数量超过上限 ' + SALES_DELETE_MAX_BATCH);
    err.statusCode = 400;
    throw err;
  }
  return out;
}

// P2.1-2：纯函数，根据「已解析」的数据权限范围构造销售数据过滤 SQL 片段。
// scope: { countryValues: string[], brandValues: string[] } | null（null = 无需过滤）
// tablePrefix: 表别名前缀，传 '' 表示无前缀；undefined 默认 'sr'。
// 仅拼 SQL，不触碰任何数据库；范围「解析」（含仓库→国家、国家→name/code 的 DB 查询）
// 由 resolveSalesDataScope 负责，确保未来事务化时整条链路都用显式 executor。
function buildSalesDataScopeSql(scope, tablePrefix) {
  if (!scope) return { sql: '', params: [] };
  const tp = (tablePrefix !== undefined) ? tablePrefix : 'sr';
  const colPrefix = tp ? tp + '.' : '';
  const params = [];
  const conditions = [];
  if (scope.countryValues && scope.countryValues.length > 0) {
    conditions.push(colPrefix + 'country IN (' + scope.countryValues.map(() => '?').join(',') + ')');
    params.push(...scope.countryValues);
  }
  if (scope.brandValues && scope.brandValues.length > 0) {
    conditions.push(colPrefix + 'brand IN (' + scope.brandValues.map(() => '?').join(',') + ')');
    params.push(...scope.brandValues);
  }
  if (conditions.length === 0) return { sql: '', params: [] };
  return { sql: ' AND ' + conditions.join(' AND '), params };
}

// P2.1-2：异步，在给定 executor 上「解析」当前用户销售数据权限范围（国家/品牌具体值）。
// exec: { query(sql, params) -> { rows: [...] } }（P4 传入事务 executor，确保 scope 解析与后续
//       查询/DELETE/重算都在同一事务连接上，绝不偷偷切回全局 db.query）。
// 返回 scope: { countryValues, brandValues } | null（无需过滤）。
// 与 buildSalesDataScopeFilter(req,...) 产出等价过滤，但走显式 executor，为未来事务化铺路。
async function resolveSalesDataScope(req, exec) {
  if (!needsDataScopeFilter(req)) return null;
  const scope = req.currentUserDataScope;
  let effectiveCountryIds = [];
  if (scope.countries && scope.countries.length > 0) {
    effectiveCountryIds = effectiveCountryIds.concat(scope.countries);
  }
  if (scope.warehouses && scope.warehouses.length > 0) {
    const whRows = (await exec.query('SELECT DISTINCT country_id FROM warehouses WHERE id IN (' +
      scope.warehouses.map(() => '?').join(',') + ") AND country_id != ''", scope.warehouses)).rows;
    whRows.forEach(r => { if (r.country_id && effectiveCountryIds.indexOf(r.country_id) < 0) effectiveCountryIds.push(r.country_id); });
  }
  const countryValues = [];
  if (effectiveCountryIds.length > 0) {
    const countryRows = (await exec.query('SELECT name, code FROM countries WHERE id IN (' +
      effectiveCountryIds.map(() => '?').join(',') + ')', effectiveCountryIds)).rows;
    countryRows.forEach(r => {
      if (r.name && countryValues.indexOf(r.name) < 0) countryValues.push(r.name);
      if (r.code && countryValues.indexOf(r.code) < 0) countryValues.push(r.code);
    });
    // 同时也把 country_id 本身加入（sales_records.country 可能存储 id）
    effectiveCountryIds.forEach(cid => { if (countryValues.indexOf(cid) < 0) countryValues.push(cid); });
  }
  const brandValues = [];
  if (scope.brands && scope.brands.length > 0) {
    brandValues.push(...scope.brands);
  }
  return { countryValues, brandValues };
}

// 在「数据权限 scope 内」解析用户提交的 ids，仅做 SELECT（不 DELETE）。
// exec: 驱动无关查询接口 { query(sql, params) -> { rows: [...] } }（P3/P4 传入事务内 executor）
// P2.1-2：scope 解析现在显式走 exec（resolveSalesDataScope），不再偷偷调用全局
//         buildSalesDataScopeFilter / db.query；与列表接口过滤语义保持等价，避免权限判断漂移。
async function resolveSalesDeleteScope(exec, req, requestedIds) {
  if (!requestedIds.length) return [];
  const placeholders = requestedIds.map(() => '?').join(',');
  let sql = `SELECT sr.id, sr.sku_code, sr.country, sr.is_valid_order, sr.order_date
             FROM sales_records sr WHERE sr.id IN (${placeholders})`;
  const params = requestedIds.slice();
  const scope = await resolveSalesDataScope(req, exec);
  const scopeSql = buildSalesDataScopeSql(scope, 'sr');
  if (scopeSql.sql) { sql += scopeSql.sql; params.push(...scopeSql.params); }
  const rows = (await exec.query(sql, params)).rows;
  return rows;
}

// 判断销售 key 维度是否为「空白」（缺失 / 不可用于构造预测 key）
function isBlankSalesKey(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// 基于「已成功解析（=已通过数据权限）」的行计算 affected key。
// 仅 is_valid_order=1 的有效销售进入 affected（删除无效订单不触发预测重算）。
// P2.1-5：key 使用 JSON.stringify([sku_code, country])，避免 '|' delimiter 理论碰撞
//         （如 sku="A|B" country="C" 与 sku="A" country="B|C" 在 '|' 拼接下会误判为同一 key）。
// P2.1-6：有效销售若 sku_code / country 缺失（空白），无法可靠构造预测 key，计入 incompleteValid，
//         交由 preflight 整笔拒绝（0 数据修改，不泄露具体记录）。
// 返回去重后的 { sku_code, country } 列表与有效/无效/不完整计数。
function computeAffectedSalesKeys(resolvedRows) {
  const seen = new Set();
  const affectedKeys = [];
  let validCount = 0;
  let invalidCount = 0;
  let incompleteValid = 0;
  for (const r of resolvedRows) {
    const isInvalid = !(r.is_valid_order === 1 || r.is_valid_order === '1');
    if (isInvalid) {
      invalidCount++;
      continue;
    }
    validCount++;
    const sku = r.sku_code;
    const country = r.country;
    if (isBlankSalesKey(sku) || isBlankSalesKey(country)) {
      incompleteValid++;
      continue;
    }
    const key = JSON.stringify([sku, country]);
    if (!seen.has(key)) {
      seen.add(key);
      affectedKeys.push({ sku_code: sku, country: country });
    }
  }
  return { affectedKeys, validCount, invalidCount, incompleteValid };
}

// 销售记录删除预检（只读，不执行 DELETE）。
// 验证：权限（requireApiPermission 中间件）→ ID 规范化 → 数据权限复校 → affected 解析。
// whole-request 校验：去重后 requested 与 resolved 数量（及集合，因 resolved ⊆ requested）必须一致，
// 否则整笔拒绝（409），不泄露具体哪个 id 缺失/越权。
app.post('/api/sales-records/delete-preflight', requireApiPermission('outbound_delete'), asyncHandler(async (req, res) => {
  let requestedIds;
  try {
    requestedIds = normalizeSalesRecordIds(req.body && req.body.ids);
  } catch (e) {
    return res.status(e.statusCode || 400).json({ error: e.message });
  }
  const requestedCount = requestedIds.length;

  // §1 驱动感知：PG 走 withGenerateClient，SQLite 走 db 全局；与 DELETE 主流程保持一致
  async function doPreflight(exec) {
    const resolved = await resolveSalesDeleteScope(exec, req, requestedIds);
    const resolvedIds = resolved.map(r => r.id);
    if (resolvedIds.length !== requestedCount) {
      // whole-request 失败：不暴露具体越权/缺失 id（防权限信息泄露）
      return { status: 409, body: { error: '部分销售记录不存在、已被删除或无权访问，整笔请求已拒绝' } };
    }
    const { affectedKeys, validCount, invalidCount, incompleteValid } = computeAffectedSalesKeys(resolved);
    // P2.1-6：有效销售缺少 SKU/国家 → 整笔拒绝（0 数据修改，不泄露具体记录）
    if (incompleteValid > 0) {
      return { status: 409, body: { error: '存在有效销售记录缺少 SKU 或国家，无法可靠刷新关联预测，整笔请求已拒绝' } };
    }
    return {
      status: 200,
      body: {
        requested_count: requestedCount,
        resolved_count: resolved.length,
        valid_sales_count: validCount,
        invalid_sales_count: invalidCount,
        incomplete_valid_sales_count: incompleteValid,
        affected_key_count: affectedKeys.length
      }
    };
  }

  let result;
  if (process.env.DATABASE_URL) {
    result = await withGenerateClient(async (aq, aqOne, run) => doPreflight(buildPgExec(aq, aqOne, run)));
  } else {
    result = await doPreflight(buildSqliteExec());
  }
  return res.status(result.status).json(result.body);
}));

// ============ P4 真实销售删除闭环 ============
// selection → permission → scope → transaction → DELETE sales_records → refresh existing → COMMIT。
// 整笔操作全部在同一事务连接的 exec 上完成（§1/§3）：PG 走 withGenerateClient，SQLite 走 db.transaction。
// 禁止自行判断连接类型、禁止自开事务、禁止写 inventory、禁止 INSERT/DELETE suggestion。

function mapSalesDeleteError(e) {
  const msg = (e && e.message) || String(e);
  if (/SALES_DELETE_STALE_CONFLICT/.test(msg)) {
    // P4.1 并发/重复删除冲突：本事务实际删除行数 < 请求行数（另一事务已先行删除或并发改动），
    // 事务已整体回滚，销售数据未变更，对用户返回可理解文案。
    return { status: 409, body: { error: '删除冲突：部分销售记录已被其他操作删除或并发修改，本次删除已取消（数据未变更）。', code: 'SALES_DELETE_STALE_CONFLICT' } };
  }
  if (/SALES_DELETE_SCOPE_MISMATCH|SALES_DELETE_INCOMPLETE_VALID|SALES_REFRESH_ORPHAN_SUGGESTION|SALES_REFRESH_SKU_MISSING|SALES_REFRESH_SKU_STOPPED|SALES_REFRESH_DIM_UNMATCHED|SALES_REFRESH_UNEXPECTED_INSERT|SALES_REFRESH_MISSING_ID|SALES_DELETE_VERIFY_FAILED/.test(msg)) {
    // §8 refresh fail-closed / whole-request 校验失败：销售数据未删除（事务已回滚），对用户返回可理解文案
    return { status: 409, body: { error: '关联预测数据当前无法安全同步，销售数据未删除。', code: 'SALES_REFRESH_FAILED' } };
  }
  return { status: 500, body: { error: '销售记录删除失败，请稍后重试或联系管理员' } };
}

function buildSqliteExec() {
  return {
    query: (sql, p) => query(sql, p),
    all: (sql, p) => query(sql, p).rows,
    one: (sql, p) => queryOne(sql, p),
    run: (sql, p) => run(sql, p)
  };
}

function buildPgExec(aq, aqOne, run) {
  return {
    query: (sql, p) => ({ rows: aq(sql, p) }),
    all: (sql, p) => aq(sql, p),
    one: (sql, p) => aqOne(sql, p),
    run: (sql, p) => run(sql, p)
  };
}

// §3 事务内完整流程（DELETE 后调用 refresh，确保读到删除后的剩余销售）
async function execSalesDeletionFlow(exec, req, requestedIds, dialect) {
  const requestedCount = requestedIds.length;
  // §2/§3-2 解析 + whole-request 校验（resolved ⊆ requested，数量必须严格相等）
  const resolvedRows = await resolveSalesDeleteScope(exec, req, requestedIds);
  if (resolvedRows.length !== requestedCount) {
    throw new Error('SALES_DELETE_SCOPE_MISMATCH');
  }
  const { affectedKeys, validCount, invalidCount, incompleteValid } = computeAffectedSalesKeys(resolvedRows);
  if (incompleteValid > 0) {
    throw new Error('SALES_DELETE_INCOMPLETE_VALID');
  }
  // §3-5 refreshability precheck（fail-closed 尽早失败，而非跳过；此时尚未 DELETE）
  await resolveAndValidateRefreshTargets(exec, affectedKeys);

  // §3-6 DELETE（仅按 id；绝不按 sku/country/order_no/date/channel）
  // P4.1：使用 DELETE ... RETURNING id，以「本事务实际删除返回的行数」作为删除证明，
  // 而非「DELETE 后再次 SELECT 是否还存在」。这样在并发/重复删除场景下，若另一事务已先行
  // 删除部分行，本事务实际 RETURNING 行数 < requestedCount，会被判定为 stale conflict 并回滚，
  // 不会错误地报告 deleted_count = requestedIds.length。
  const placeholders = requestedIds.map(() => '?').join(',');
  const deletedRows = await exec.all('DELETE FROM sales_records WHERE id IN (' + placeholders + ') RETURNING id', requestedIds);
  const actualDeletedCount = Array.isArray(deletedRows) ? deletedRows.length : 0;

  // P4.1 §五：实际删除行数必须严格等于请求行数；否则视为并发冲突/已被其他操作改动，整体回滚。
  if (actualDeletedCount !== requestedCount) {
    throw new Error('SALES_DELETE_STALE_CONFLICT');
  }

  // §3-7 额外 sanity check（不能替代上面的实际行数证明）：DELETE 后这些 id 应已不存在。
  // 该检查仅作为兜底，正常路径下 actualDeletedCount === requestedCount 已保证 remaining 为空。
  const remaining = await exec.all('SELECT id FROM sales_records WHERE id IN (' + placeholders + ')', requestedIds);
  if (remaining.length > 0) {
    throw new Error('SALES_DELETE_VERIFY_FAILED');
  }

  // §3-8 删除后重算已有 suggestion（DELETE 之后读取剩余销售数据）
  let refreshedCount = 0;
  if (affectedKeys.length > 0) {
    const r = await refreshExistingSalesSuggestions({ exec, affectedKeys, dialect });
    refreshedCount = r.updated;
  }
  return { deletedCount: requestedCount, affectedKeyCount: affectedKeys.length, refreshedCount };
}

// §1 构造统一 exec + 选择正确驱动事务（PG: withGenerateClient / SQLite: db.transaction）
async function runSalesDeletionInTx(req, requestedIds) {
  if (process.env.DATABASE_URL) {
    return await withGenerateClient(async (aq, aqOne, run) => {
      const exec = buildPgExec(aq, aqOne, run);
      return await execSalesDeletionFlow(exec, req, requestedIds, 'pg');
    });
  }
  return await transaction(async () => {
    const exec = buildSqliteExec();
    return await execSalesDeletionFlow(exec, req, requestedIds, 'sqlite');
  });
}

// §2 真实 DELETE 接口（权限 outbound_delete）；复用 normalizeSalesRecordIds（不另写 ID 解析）
app.delete('/api/sales-records', requireApiPermission('outbound_delete'), asyncHandler(async (req, res) => {
  let requestedIds;
  try {
    requestedIds = normalizeSalesRecordIds(req.body && req.body.ids);
  } catch (e) {
    return res.status(e.statusCode || 400).json({ error: e.message });
  }
  try {
    const result = await runSalesDeletionInTx(req, requestedIds);
    return res.json({
      success: true,
      deleted_count: result.deletedCount,
      affected_key_count: result.affectedKeyCount,
      refreshed_suggestion_count: result.refreshedCount
    });
  } catch (e) {
    const mapped = mapSalesDeleteError(e);
    if (mapped.status >= 500) console.error('[SALES-DELETE-ERR]', e && e.message ? e.message : e);
    return res.status(mapped.status).json(mapped.body);
  }
}));

// 销售明细筛选下拉选项
app.get('/api/sales-records/filter-options', requireApiPermission('outbound_view'), asyncHandler((req, res) => {
  // DATA-SCOPE: 数据权限范围内构建基础 WHERE 子句
  const scopeFilter = buildSalesDataScopeFilter(req, '');
  const scopeWhere = scopeFilter.sql || '';
  const scopeParams = scopeFilter.params;

  const source_systems = query(`SELECT DISTINCT source_system FROM sales_records WHERE source_system IS NOT NULL AND source_system != ''` + scopeWhere + ` ORDER BY source_system`, scopeParams).rows.map(r => r.source_system);
  const shop_platforms = query(`SELECT DISTINCT shop_platform FROM sales_records WHERE shop_platform IS NOT NULL AND shop_platform != ''` + scopeWhere + ` ORDER BY shop_platform`, scopeParams).rows.map(r => r.shop_platform);
  const brands = query(`SELECT DISTINCT brand FROM sales_records WHERE brand IS NOT NULL AND brand != ''` + scopeWhere + ` ORDER BY brand`, scopeParams).rows.map(r => r.brand);
  const countries = query(`SELECT DISTINCT country FROM sales_records WHERE country IS NOT NULL AND country != ''` + scopeWhere + ` ORDER BY country`, scopeParams).rows.map(r => r.country);
  res.json({ source_systems, shop_platforms, brands, countries });
}));


// 销售明细导入预览：与正式导入共享 normalize / validate / candidate / classify。
// 只写入临时 staging，不写正式 sales_records。
app.post('/api/sales-records/bulk-import-preview', requireApiPermission('outbound_view'), asyncHandler(async (req, res) => {
  try {
    const items = req.body.items || [];
    const preview = await previewSalesImport(createSalesImportAdapter(), items, {
      importBatchId: '',
      idFactory: salesImportIdFactory()
    });
    res.json({ preview: preview.preview });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 销售导入状态：支持长导入期间进度轮询及刷新后恢复查看。
app.get('/api/sales-records/bulk-import/:importId/status', requireApiPermission('outbound_view'), asyncHandler(async (req, res) => {
  const run = await createSalesImportRunStoreForCurrentDb().get(String(req.params.importId || ''));
  if (!run) return res.status(404).json({ error: '导入任务不存在', import_id: req.params.importId });
  res.json(salesImportResultBody(run));
}));

// 销售明细导入（集合化 upsert；同步事务边界保持不变）
app.post('/api/sales-records/bulk-import', requireApiPermission('outbound_import'), asyncHandler(async (req, res) => {
  const items = req.body.items || [];
  const importId = String(req.body.import_id || genId('sales-import')).slice(0, 180);
  const fingerprint = salesImportFingerprint(items);
  const store = createSalesImportRunStoreForCurrentDb();
  const existing = await store.get(importId);
  const terminalStatuses = new Set(['completed', 'failed_uncommitted', 'sales_committed_recalc_failed']);
  const activeStatuses = new Set(['validating', 'staging', 'matching', 'writing', 'committing', 'inventory_recalc', 'unknown_pending_reconcile']);
  if (existing) {
    if (existing.request_fingerprint && existing.request_fingerprint !== fingerprint) {
      return res.status(409).json({ error: 'import_id 已存在且导入内容不一致', import_id: importId, status: existing.status });
    }
    if (terminalStatuses.has(existing.status)) return res.json({ ...salesImportResultBody(existing), duplicate: true });
    if (activeStatuses.has(existing.status)) return res.status(202).json({ ...salesImportResultBody(existing), duplicate: true });
  }
  if (!existing) {
    try {
      await store.create({
        import_id: importId, status: 'validating', phase: 'validating', percent: 0,
        total_count: Array.isArray(items) ? items.length : 0,
        request_fingerprint: fingerprint
      });
    } catch (createError) {
      // A concurrent retry may have won the unique import_id race. Re-read and
      // return its state rather than submitting the sales rows twice.
      const raced = await store.get(importId);
      if (raced) return res.status(202).json({ ...salesImportResultBody(raced), duplicate: true });
      throw createError;
    }
  }

  let salesCommitted = false;
  const progress = state => store.update(importId, {
    ...state,
    total_count: Array.isArray(items) ? items.length : 0,
    commit_state: state.commit_state || (salesCommitted ? 'committed' : 'uncommitted'),
    result: {
      total: Array.isArray(items) ? items.length : 0,
      inserted: state.inserted || 0,
      updated: state.updated || 0,
      skipped: state.skipped || 0,
      failed: state.failed || 0,
      errors: state.errors || []
    }
  });
  try {
    const batchId = genId('batch');
    const applied = await executeSalesImport(createSalesImportAdapter(), items, {
      importBatchId: batchId,
      idFactory: salesImportIdFactory(),
      progress
    });
    salesCommitted = true;

    // === 销售数据已提交 ===
    // PG 模式：立即返回导入完成，库存重算异步后台执行（不阻塞 HTTP 响应、不阻塞事件循环）
    // SQLite 模式：同步重算（本地快速，无阻塞问题）
    const affectedSkus = [...new Set(items.filter(i => i.sku_code).map(i => i.sku_code))];
    const isPg = (process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'pg';

    if (isPg) {
      const completed = await store.update(importId, {
        status: 'completed', phase: 'completed', percent: 100,
        processed_count: items.length, total_count: items.length,
        inserted: applied.result.inserted, updated: applied.result.updated,
        skipped: applied.result.skipped, failed: applied.result.failed,
        errors: applied.result.errors, timings: applied.timings, metrics: applied.metrics,
        result: applied.result, commit_state: 'committed', recalc_status: 'pending'
      });
      res.json(salesImportResultBody(completed));

      // 后台异步库存重算（不阻塞 HTTP 响应）
      recalcInventoryForSkusBackground(importId, affectedSkus).catch(e => {
        console.error('[sales-import] background recalc unhandled:', e.message);
      });
    } else {
      affectedSkus.forEach(sku => {
        const invs = query('SELECT country, warehouse FROM inventory WHERE sku_code = ?', [sku]).rows;
        invs.forEach(inv => recalcInventoryForSku(sku, inv.country, inv.warehouse));
      });
      const completed = await store.update(importId, {
        status: 'completed', phase: 'completed', percent: 100,
        processed_count: items.length, total_count: items.length,
        inserted: applied.result.inserted, updated: applied.result.updated,
        skipped: applied.result.skipped, failed: applied.result.failed,
        errors: applied.result.errors, timings: applied.timings, metrics: applied.metrics,
        result: applied.result, commit_state: 'committed', recalc_status: 'completed'
      });
      res.json(salesImportResultBody(completed));
    }
  } catch (e) {
    const uncertain = !salesCommitted && isUncertainSalesImportError(e);
    const status = salesCommitted ? 'sales_committed_recalc_failed' : (uncertain ? 'unknown_pending_reconcile' : 'failed_uncommitted');
    const commitState = salesCommitted ? 'committed' : (uncertain ? 'unknown' : 'uncommitted');
    const recalcStatus = salesCommitted ? 'failed' : 'not_started';
    const currentRun = await store.get(importId);
    const currentResult = currentRun && currentRun.result || {};
    const failedRun = await store.update(importId, {
      status, phase: status, percent: salesCommitted ? 95 : null,
      total_count: items.length, errors: [{ row: 0, reason: e.message }],
      commit_state: commitState, recalc_status: recalcStatus,
      result: { total: items.length, inserted: currentRun ? currentRun.inserted : (currentResult.inserted || 0),
        updated: currentRun ? currentRun.updated : (currentResult.updated || 0),
        skipped: currentRun ? currentRun.skipped : (currentResult.skipped || 0),
        failed: currentRun ? currentRun.failed : (currentResult.failed || 0), errors: [{ row: 0, reason: e.message }] }
    });
    const body = salesImportResultBody(failedRun || { import_id: importId, status, errors: [{ row: 0, reason: e.message }] });
    if (status === 'sales_committed_recalc_failed') return res.status(200).json(body);
    res.status(500).json({ ...body, error: e.message });
  }
}));

// ==================== 补货建议 ====================

// 销售日期统一规范化：写入数据库前必须调用，统一为 YYYY-MM-DD
// 兼容：Date对象 / YYYY-MM-DD / YYYY-MM / YYYY/M/D / YYYY/MM/DD / M/D/YYYY / M/D/YY / Excel序列号(20000-80000)
// 返回 null 表示无法识别（导入时应标记失败）
function normalizeOrderDate(value) {
  if (value === null || value === undefined || value === '') return null;
  // Date 对象
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (!s) return null;
  // Excel 日期序列号（限制范围 20000-80000，对应 1954-2119 年）
  if (/^\d+$/.test(s)) {
    const num = parseInt(s, 10);
    if (num >= 20000 && num <= 80000) {
      // Excel 序列号：1 = 1900-01-01（含闰年bug，1900-02-29 占位）
      // JS epoch: 1970-01-01 = Excel 25569
      const epochMs = (num - 25569) * 86400000;
      const dt = new Date(epochMs);
      if (!isNaN(dt.getTime())) {
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dt.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }
    return null;
  }
  // 标准 YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return _buildValidDate(isoMatch[1], isoMatch[2], isoMatch[3]);
  }
  // YYYY-MM（补 -01）
  const ymMatch = s.match(/^(\d{4})-(\d{1,2})$/);
  if (ymMatch) {
    return _buildValidDate(ymMatch[1], ymMatch[2], '01');
  }
  // 含斜杠的格式
  if (s.indexOf('/') >= 0) {
    const parts = s.split('/').map(p => p.trim());
    if (parts.length !== 3) return null;
    const a = parts[0], b = parts[1], c = parts[2];
    // 第一个段是4位 → YYYY/M/D 或 YYYY/MM/DD
    if (/^\d{4}$/.test(a)) {
      return _buildValidDate(a, b, c);
    }
    // 第一个段不是4位 → M/D/YYYY 或 M/D/YY
    if (/^\d{1,2}$/.test(a) && /^\d{1,2}$/.test(b)) {
      let year;
      if (/^\d{4}$/.test(c)) {
        year = c;
      } else if (/^\d{2}$/.test(c)) {
        const yy = parseInt(c, 10);
        year = String(yy <= 69 ? 2000 + yy : 1900 + yy);
      } else {
        return null;
      }
      return _buildValidDate(year, a, b);
    }
    return null;
  }
  return null;
}

// 内部：构造并校验真实日期（月份1-12，日期1-当月最大天数），非法返回 null
function _buildValidDate(yStr, mStr, dStr) {
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  // 校验是否回滚了（如 2月30日 会变成 3月2日）
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 历史脏数据兼容兜底：在 SQL 中动态把各种日期格式转成 YYYY-MM-DD
// 新数据写入前已由 normalizeOrderDate 统一，此函数仅用于兼容历史数据
// 判断逻辑：
//   1. 标准 YYYY-MM-DD → 直接返回前10位
//   2. YYYY-MM → 补 -01
//   3. 含 / 且第一段4位 → YYYY/M/D 或 YYYY/MM/DD
//   4. 含 / 且第一段非4位 → M/D/YYYY 或 M/D/YY（两位年份 00-69→2000s，70-99→1900s）
function salesOrderDateExpr(col = 'order_date') {
  // 截取第一段（到第一个 / 之前），用于判断年份在前还是后
  // 使用 strpos 以兼容 PostgreSQL；SQLite 通过 db-sqlite.js 注册同名函数
  const firstSeg = `substr(${col}, 1, strpos(${col} || '/', '/') - 1)`;
  // 第二段：去掉第一段后的剩余，取到下一个 / 之前
  const afterFirst = `substr(${col}, strpos(${col} || '/', '/') + 1)`;
  const secondSeg = `substr(${afterFirst}, 1, strpos(${afterFirst} || '/', '/') - 1)`;
  // 第三段：去掉第二段后的剩余
  const afterSecond = `substr(${afterFirst}, strpos(${afterFirst} || '/', '/') + 1)`;
  return `CASE
    WHEN ${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN substr(${col}, 1, 10)
    WHEN length(${col}) = 7 AND substr(${col}, 5, 1) = '-' THEN ${col} || '-01'
    WHEN ${col} LIKE '%/%' AND length(${firstSeg}) = 4 THEN
      printf('%04d-%02d-%02d',
        CAST(${firstSeg} AS INTEGER),
        CAST(${secondSeg} AS INTEGER),
        CAST(${afterSecond} AS INTEGER))
    WHEN ${col} LIKE '%/%' AND length(${firstSeg}) <= 2 AND length(${afterSecond}) = 4 THEN
      printf('%04d-%02d-%02d',
        CAST(${afterSecond} AS INTEGER),
        CAST(${firstSeg} AS INTEGER),
        CAST(${secondSeg} AS INTEGER))
    WHEN ${col} LIKE '%/%' AND length(${firstSeg}) <= 2 AND length(${afterSecond}) = 2 THEN
      printf('%s%02d-%02d-%02d',
        CASE WHEN CAST(${afterSecond} AS INTEGER) <= 69 THEN '20' ELSE '19' END,
        CAST(${afterSecond} AS INTEGER),
        CAST(${firstSeg} AS INTEGER),
        CAST(${secondSeg} AS INTEGER))
    ELSE substr(${col}, 1, 10)
  END`;
}

// ==================== 渠道分配模型（CHANNEL-ALLOCATION-MODEL）====================
// country 名称 → country_id 解析（兼容中英文别名）
function resolveCountryId(countryName, countriesCache) {
  if (!countryName) return null;
  for (const c of countriesCache) {
    if (c.name === countryName) return c.id;
    if (c.code && c.code.toUpperCase() === countryName.toUpperCase()) return c.id;
  }
  const ALIAS = { 'Indonesia': '印度尼西亚', 'Malaysia': '马来西亚', 'Thailand': '泰国', 'Vietnam': '越南' };
  const alias = ALIAS[countryName];
  if (alias) {
    for (const c of countriesCache) {
      if (c.name === alias) return c.id;
    }
  }
  return null;
}

// 独立缺货事实判断（不依赖 sales_status）
function isStockoutAffected(available, totalSalesEver, lastSaleDate, lastOutboundDate) {
  if (available > 0) return false;
  if (!totalSalesEver || totalSalesEver <= 0) return false;
  if (!lastSaleDate) return false;
  if (!lastOutboundDate) return false;
  const stockoutDay = new Date(lastOutboundDate);
  const lastSaleDay = new Date(lastSaleDate);
  if (isNaN(stockoutDay.getTime()) || isNaN(lastSaleDay.getTime())) return false;
  const diffDays = (lastSaleDay - stockoutDay) / (1000 * 60 * 60 * 24);
  // 出库日期应早于或接近最后销售日期（库存归零在前，残余销售在后），容忍7天前到30天后
  return diffDays >= -7 && diffDays <= 30;
}

// 缺货前最后有效销售月份的渠道占比
// 仅从4个月窗口(monthlyMap)取，窗口外不回退同步查询（PG async 上下文禁止 queryOne）
function resolvePreStockoutRatio(skuCode, country, monthlyMap) {
  const mapKey = skuCode + '|' + (country || '');
  const mo = monthlyMap[mapKey];
  if (mo) {
    for (const m of ['m1', 'm2', 'm3', 'm4']) {
      if (mo[m] && mo[m].total > 0) {
        return mo[m].online / mo[m].total * 100;
      }
    }
  }
  // 窗口外无数据，返回 null（SKU 将降级到 Level 3 或 unconfigured）
  return null;
}

// 渠道比例三级解析入口
// 返回: { source, allocationStatus, onlinePct (number|null), resolvedAt }
function resolveChannelRatio(opts) {
  const { skuCode, country, avgSalesPeriod, available, totalSalesEver,
          lastSaleDate, lastOutboundDate, aggObj, monthlyMap,
          channelConfigMap, countriesCache } = opts;

  const now = new Date();
  const resolvedAt = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' +
                     String(now.getDate()).padStart(2, '0') + ' ' +
                     String(now.getHours()).padStart(2, '0') + ':' +
                     String(now.getMinutes()).padStart(2, '0') + ':' +
                     String(now.getSeconds()).padStart(2, '0');

  // Level 1: 正常销售SKU — 当前周期存在有效销量
  if (avgSalesPeriod > 0 && aggObj) {
    const periodOnline = Number(aggObj.period_online) || 0;
    const periodOffline = Number(aggObj.period_offline) || 0;
    if (periodOnline + periodOffline > 0) {
      // 当前周期双渠道均有销量 → 直接使用当前周期占比
      if (periodOnline > 0 && periodOffline > 0) {
        const pct = periodOnline / (periodOnline + periodOffline) * 100;
        return { source: 'recent_sales', allocationStatus: 'allocated', onlinePct: Math.round(pct * 100) / 100, resolvedAt };
      }
      // 当前周期单渠道为0（可能因断货/缺货导致失真）→ 回退120天历史累计销量占比
      // 历史占比采用累计销量占比，不采用月份占比平均
      const s120Online = Number(aggObj.s120_online) || 0;
      const s120Offline = Number(aggObj.s120_offline) || 0;
      if (s120Online > 0 && s120Offline > 0) {
        const histPct = s120Online / (s120Online + s120Offline) * 100;
        return { source: 'historical_sales', allocationStatus: 'allocated', onlinePct: Math.round(histPct * 100) / 100, resolvedAt };
      }
      // 120天历史也是单渠道 → 当前周期占比反映真实渠道结构，直接使用
      const pct = periodOnline / (periodOnline + periodOffline) * 100;
      return { source: 'recent_sales', allocationStatus: 'allocated', onlinePct: Math.round(pct * 100) / 100, resolvedAt };
    }
  }

  // Level 2: 缺货影响SKU — 独立事实判断（当前周期无销量时）
  if (isStockoutAffected(available, totalSalesEver, lastSaleDate, lastOutboundDate)) {
    const prePct = resolvePreStockoutRatio(skuCode, country, monthlyMap);
    if (prePct !== null && !isNaN(prePct)) {
      return { source: 'pre_stockout', allocationStatus: 'allocated', onlinePct: Math.round(prePct * 100) / 100, resolvedAt };
    }
  }

  // Level 3: 无历史销量SKU — 人工配置
  const countryId = resolveCountryId(country, countriesCache);
  if (countryId) {
    const config = channelConfigMap[skuCode + '|' + countryId];
    if (config && config.status === 'active') {
      return { source: 'manual_config', allocationStatus: 'allocated', onlinePct: config.online_pct, resolvedAt };
    }
  }

  // 未配置 — 不猜测，不分配
  return { source: 'unconfigured', allocationStatus: 'unallocated', onlinePct: null, resolvedAt };
}

// ==================== 统一动销状态判定层 ====================
// 读取品牌目标周转配置（JSON）：Redragon=4, Netac=2, __default__=3
function loadBrandTargetConfig() {
  try {
    const row = queryOne("SELECT value FROM system_config WHERE key = 'brand_target_stock_months'");
    if (row && row.value) return JSON.parse(row.value);
  } catch (e) {}
  return {};
}

// 品牌目标周转月数：优先级 SKU手动目标 > 品牌默认 > 系统默认3
// cfg 可选：传入已读取的品牌配置避免重复查库
async function getBrandTargetMonths(brand, skuTargetTurnover, cfg) {
  if (skuTargetTurnover != null && !isNaN(skuTargetTurnover) && skuTargetTurnover > 0) return parseFloat(skuTargetTurnover);
  let c = cfg;
  if (!c) c = await loadBrandTargetConfig();
  c = c || {};
  const b = (brand || '').trim();
  if (b && c[b] != null) return parseFloat(c[b]);
  const found = Object.keys(c).find(k => k && k.toLowerCase() === b.toLowerCase());
  if (found) return parseFloat(c[found]);
  return parseFloat(c['__default__'] != null ? c['__default__'] : 3);
}

// A-Step1：多维目标周转配置（品牌/国家/仓库 命中）
// 读取 dim_default_config（JSON 数组），每条 = {brand,country,warehouse,online_turnover,offline_turnover}，空字符串=通配
function getDimTurnoverConfig() {
  try {
    const row = queryOne("SELECT value FROM system_config WHERE key = 'dim_default_config'");
    if (row && row.value) {
      const arr = JSON.parse(row.value);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) {}
  return null; // 返回 null → 调用方回退旧逻辑（兼容）
}

// 多维命中：评分法 brand=4/country=2/warehouse=1，8 组合得分 0~7 无平局
// 返回最高分规则对象，或 null（无匹配 → 回退旧逻辑）
function getDimTurnover(brand, country, warehouse, rules) {
  if (!rules || !rules.length) return null;
  const b = (brand || '').trim();
  const c = (country || '').trim();
  const w = (warehouse || '').trim();
  let best = null, bestScore = -1;
  for (const r of rules) {
    const rb = (r.brand || '').trim();
    const rc = (r.country || '').trim();
    const rw = (r.warehouse || '').trim();
    if ((rb === '' || rb === b) && (rc === '' || rc === c) && (rw === '' || rw === w)) {
      let score = 0;
      if (rb !== '') score += 4;
      if (rc !== '') score += 2;
      if (rw !== '') score += 1;
      if (score > bestScore) { bestScore = score; best = r; }
    }
  }
  return best;
}

// 品牌采购状态映射（停采品牌系统级规则）：一次查询，返回 { [brand]: 'active'|'stopped' }
// 未出现在 brand_settings 中的品牌一律视为 'active'（可采购）
function getBrandStatusMap() {
  const rows = query('SELECT brand, procurement_status FROM brand_settings').rows;
  const map = {};
  for (const r of rows) {
    map[(r.brand || '').trim()] = (r.procurement_status || 'active');
  }
  return map;
}

// 新品保护：按 SKU 保护期配置，以上市/首次入库/首次销售的最早可用业务日期为基准。
function isPassedNewProductProtection(o, now) {
  const days = (o.new_product_protection_days != null && !isNaN(o.new_product_protection_days)) ? o.new_product_protection_days : 90;
  const refRaw = (o.launch_date && String(o.launch_date).trim())
    || (o.first_inbound_date && String(o.first_inbound_date).trim())
    || (o.first_sale_date && String(o.first_sale_date).trim())
    || '';
  if (!refRaw) return !(o.is_new_product === 1);
  const ref = new Date(refRaw);
  if (isNaN(ref.getTime())) return !(o.is_new_product === 1);
  const diffDays = Math.floor((now - ref) / 86400000);
  return diffDays > days;
}

// AI经营建议（规则模板生成，不接外部AI，不重新判断状态）
function buildAiAdvice(sales_status, risk_tags, passedProtection) {
  const MAIN = {
    '清仓': '生命周期不适合正常补货，停止采购，优先消化库存。',
    '停采/停产': '生命周期不适合正常补货，停止采购，优先消化库存。',
    '新品/销售数据不足': '销售时间不足，先人工复核目标周转，避免短期误判。',
    '无有效销售': '暂无有效销量，先检查上架、价格、渠道和库存状态。',
    '缺货': '现货为0，先复核补货；低销量可能由缺货造成。',
    '缺货风险': '现货周转低于0.5个月，优先复核补货，避免断货压低销量。',
    '呆滞': '30天无销量且仍有库存，暂停补货，先清库存。',
    '慢销': '有销量但周转超目标2倍，谨慎补货，先消化库存。',
    '正常动销': '销量和周转正常，按目标周转正常补货。'
  };
  const RISK = {
    '高库存关注': '周转超目标1.5倍，控制采购，避免库存资金堆高。',
    '高库存严重': '周转超目标2倍，减少采购，优先消化库存。',
    '高库龄风险': '库龄超180天且周转偏高，排查老库存、价格和渠道问题。',
    '库龄未知': '缺少入库日期，先补全数据，避免库龄判断失真。'
  };
  let advice = MAIN[sales_status] || '数据不足，建议人工复核销量、库存、周转和生命周期。';
  if (Array.isArray(risk_tags) && risk_tags.length) {
    advice += ' ' + risk_tags.map(t => RISK[t] || '').filter(Boolean).join(' ');
  }
  return advice.trim();
}

// 缺货销量失真检测（纯函数）
// 判断近期销量骤降是否由缺货导致，返回修正基准销量
function detectStockoutDistortion(m1, m2, m3, m4, available) {
  const months = [m1, m2, m3, m4];   // m1=本月, m2=上月, m3=上上月, m4=4个月前
  const maxSales = Math.max(...months);
  const avg = (m1 + m2 + m3 + m4) / 4;
  const recentAvg = (m1 + m2) / 2;   // 最近2个月平均
  const earlyMax = Math.max(m3, m4); // 早期最高

  const isDistorted =
    available <= 0              &&  // 当前可用库存=0
    avg > 0                     &&  // 有销量数据（排除无销量SKU）
    maxSales >= avg * 2         &&  // 最高月销量 >= 月均×2
    recentAvg < earlyMax * 0.5;     // 最近销量 < 前期最高×50%

  return {
    isDistorted,
    adjustedAvg: isDistorted ? maxSales : avg,
    maxSales,
    reason: isDistorted
      ? '销量失真：当前可用库存为0，近期销量可能被缺货压低，已按过去4个月最高月销量作为补货参考。'
      : ''
  };
}

// 规范化 risk_tags（兼容数组和逗号字符串）
function normalizeRiskTags(risk_tags) {
  if (Array.isArray(risk_tags)) return risk_tags.map(t => String(t).trim()).filter(Boolean);
  if (typeof risk_tags === 'string') return risk_tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

// 业务拦截：判断是否应该阻止自动补货
function shouldBlockReplenish(sales_status, risk_tags) {
  const tags = normalizeRiskTags(risk_tags);
  if (['清仓','停采/停产','无有效销售','呆滞','慢销'].includes(sales_status)) return true;
  if (tags.includes('高库存严重') || tags.includes('高库存关注') || tags.includes('高库龄风险')) return true;
  if (tags.includes('新品无销量')) return true;
  return false;
}

// 冻结建议公式：总建议=max(0,线上目标+线下目标-库存池)，再拆分为线上/线下两个整型分量。
// 库存池是共享供应，不生成“其他渠道”需求；两个分量之和必须严格等于总建议。
function calculateSuggestion(onlineTargetStock, offlineTargetStock, totalInventoryPool, blocked) {
  const onlineTarget = Math.max(0, Math.round(Number(onlineTargetStock) || 0));
  const offlineTarget = Math.max(0, Math.round(Number(offlineTargetStock) || 0));
  const totalTarget = onlineTarget + offlineTarget;
  const totalSuggested = blocked ? 0 : Math.max(0, totalTarget - Math.max(0, Number(totalInventoryPool) || 0));
  const onlineSuggested = totalTarget > 0 ? Math.round(totalSuggested * onlineTarget / totalTarget) : 0;
  return {
    suggested_qty: totalSuggested,
    online_suggested_qty: onlineSuggested,
    offline_suggested_qty: totalSuggested - onlineSuggested,
    other_suggested_qty: 0
  };
}

function buildSuggestionText(salesStatus, lifecycleStatus, suggestedQty, brandStopped) {
  const lifecycle = lifecycleStatus || 'stable';
  if (brandStopped || salesStatus === '停采/清库存' || salesStatus === '停采/停产' || lifecycle === 'clearance' || lifecycle === 'stopped') {
    return '停止采购，优先消化现有库存';
  }
  if (lifecycle === 'new_test') return '新品测试期，暂不自动生成采购建议';
  if (lifecycle === 'new_launch') return '新品导入期，建议人工复核采购数量';
  if (salesStatus === '呆滞') return '近30天无销量，建议清库存并暂停采购';
  if (salesStatus === '慢销') return '库存周转偏高，建议观察并谨慎采购';
  return suggestedQty > 0 ? `建议采购 ${suggestedQty}` : '当前库存池充足，建议观察';
}

// 统一动销状态判定（纯函数，不查库）
// 输入 o: { lifecycle_status, is_new_product, launch_date, first_inbound_date, first_sale_date,
//          new_product_protection_days, available, avg_sales_period, sales_30d, sales_90d, total_sales_ever,
//          days_since_last_inbound, last_inbound_date, target_months }
// 输出: { sales_status, risk_tags[], sales_reason, action, ai_business_advice }
// 判断顺序：生命周期/新品保护 → 无有效销售 → 缺货/缺货风险 → 呆滞 → 慢销 → 正常
function classifySkuState(o) {
  const now = new Date();
  const lc = (o.lifecycle_status || 'stable').trim();
  const available = o.available || 0;
  const avg = o.avg_sales_period != null ? o.avg_sales_period : (o.avg_sales_4m || 0);
  const target = o.target_months || 3;
  const availTurnover = avg > 0 ? (available / avg) : null; // null=无销量无法计算
  const passedProtection = isPassedNewProductProtection(o, now);
  const stockout = available <= 0;
  const stockoutRisk = available > 0 && avg > 0 && availTurnover !== null && availTurnover < 0.5;
  const daysSinceInbound = (o.days_since_last_inbound != null) ? o.days_since_last_inbound : null;
  const hasInboundDate = !!(o.last_inbound_date && String(o.last_inbound_date).trim());
  const totalSalesEver = (o.total_sales_ever || 0);

  let sales_status = '正常动销';
  let sales_reason = '销量与周转正常';

  if (lc === 'clearance') {
    sales_status = '清仓'; sales_reason = '生命周期为清仓期';
  } else if (lc === 'stopped') {
    sales_status = '停采/停产'; sales_reason = '生命周期为停采/停产';
  } else if (!passedProtection) {
    sales_status = '新品/销售数据不足'; sales_reason = '尚在新品保护期内，销售时间不足';
  } else if (totalSalesEver === 0) {
    sales_status = '无有效销售'; sales_reason = '已过新品保护期，但历史无有效销量';
  } else if (stockout) {
    sales_status = '缺货'; sales_reason = '当前可用库存为0，近期销量可能被缺货压低';
  } else if (stockoutRisk) {
    sales_status = '缺货风险'; sales_reason = '可用库存周转<0.5个月，近期销量可能被缺货压低';
  } else if ((o.sales_30d || 0) === 0 && available > 0) {
    sales_status = '呆滞'; sales_reason = '近30天无有效销量且仍有库存';
  } else if ((o.sales_90d || 0) > 0 && availTurnover !== null && availTurnover > target * 2 && !stockoutRisk) {
    sales_status = '慢销'; sales_reason = '有销量但周转超目标2倍';
  } else {
    sales_status = '正常动销'; sales_reason = '销量与周转正常';
  }

  // 风险标签并行判断（缺货/缺货风险时不挂高库存/高库龄，避免销量失真误判）
  const risk_tags = [];
  if (!stockout && !stockoutRisk) {
    if (availTurnover !== null && availTurnover > target * 1.5) risk_tags.push('高库存关注');
    if (availTurnover !== null && availTurnover > target * 2) risk_tags.push('高库存严重');
    if (daysSinceInbound !== null && daysSinceInbound > 180 && available > 0 && availTurnover !== null && availTurnover > target * 2) {
      risk_tags.push('高库龄风险');
    }
  }
  if (!hasInboundDate) risk_tags.push('库龄未知');

  const ACTION_MAP = {
    '清仓': '停止采购，优先消化库存',
    '停采/停产': '停止采购，不参与补货',
    '新品/销售数据不足': '人工复核目标周转，暂缓补货',
    '无有效销售': '检查上架/价格/渠道，暂缓补货',
    '缺货': '优先复核补货，确认现货',
    '缺货风险': '优先复核补货，避免断货',
    '呆滞': '暂停补货，先清库存',
    '慢销': '谨慎补货，先消化库存',
    '正常动销': '按目标周转正常补货'
  };
  const action = ACTION_MAP[sales_status] || '人工复核后决定';
  const ai_business_advice = buildAiAdvice(sales_status, risk_tags, passedProtection);

  return { sales_status, risk_tags, sales_reason, action, ai_business_advice };
}

// 订单预测页面用户偏好：仅保存稳定筛选值与视图选择，不复用全局系统配置。
function normalizeForecastPagePreferences(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const cleanText = (value, maxLength = 200) => String(value || '').trim().slice(0, maxLength);
  const salesStatuses = new Set(['缺货风险', '呆滞', '慢销', '正常动销', '新品/销售数据不足', '无有效销售', '清仓', '停采/停产', '停采/清库存']);
  const lifecycleStatuses = new Set(['new_test', 'new_launch', 'growth', 'stable', 'slow', 'stagnant', 'clearance', 'stopped']);
  const tabs = new Set(['total', 'online', 'offline']);
  const modes = new Set(['monthly', 'daily']);
  const salesStatus = cleanText(source.sales_status, 40);
  const lifecycleStatus = cleanText(source.lifecycle_status, 40);
  const tab = cleanText(source.rpTab, 20);
  const mode = cleanText(source.rpMode, 20);
  return {
    country: cleanText(source.country),
    warehouse: cleanText(source.warehouse),
    brand: cleanText(source.brand),
    sales_status: salesStatuses.has(salesStatus) ? salesStatus : '',
    lifecycle_status: lifecycleStatuses.has(lifecycleStatus) ? lifecycleStatus : '',
    search: cleanText(source.search),
    rpTab: tabs.has(tab) ? tab : 'total',
    rpMode: modes.has(mode) ? mode : 'monthly'
  };
}

app.get('/api/replenishment-suggestions/preferences', requireApiPermission('replenishment_view'), asyncHandler((req, res) => {
  const row = queryOne('SELECT preferences FROM forecast_page_preferences WHERE user_id = ?', [req.currentUserId]);
  let parsed = {};
  try { parsed = row ? JSON.parse(row.preferences || '{}') : {}; } catch (e) {}
  res.json({ preferences: normalizeForecastPagePreferences(parsed) });
}));

app.put('/api/replenishment-suggestions/preferences', requireApiPermission('replenishment_view'), asyncHandler((req, res) => {
  const preferences = normalizeForecastPagePreferences(req.body && req.body.preferences);
  const now = new Date().toISOString();
  run(`INSERT INTO forecast_page_preferences (user_id, preferences, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET preferences=excluded.preferences, updated_at=excluded.updated_at`,
    [req.currentUserId, JSON.stringify(preferences), now]);
  res.json({ success: true, preferences });
}));

// 订单预测展示层统一读取 inventory 当前事实；不写回预测快照，不改变生成/分类/建议采购逻辑。
function applyLiveForecastInventory(row) {
  const hasInventoryRow = row.inv_row_id != null;
  const available = hasInventoryRow ? row.inv_available_qty : 0;
  const inTransit = hasInventoryRow ? row.inv_in_transit_qty : 0;
  const piUnshipped = hasInventoryRow ? row.inv_pi_confirmed_unshipped_qty : 0;
  const poUnconfirmed = hasInventoryRow ? row.inv_po_unconfirmed_pi_qty : 0;
  row.available_qty = available || 0;
  row.in_transit_qty = inTransit || 0;
  row.pi_confirmed_unshipped_qty = piUnshipped || 0;
  row.po_unconfirmed_pi_qty = poUnconfirmed || 0;
  // 冻结库存池展示口径：当前可用 + CI 已发货在途 + PI 已确认未发货；未确认 PO 不计入。
  row.total_inventory_pool = row.available_qty + row.in_transit_qty + row.pi_confirmed_unshipped_qty;
  delete row.inv_row_id;
  delete row.inv_available_qty;
  delete row.inv_in_transit_qty;
  delete row.inv_pi_confirmed_unshipped_qty;
  delete row.inv_po_unconfirmed_pi_qty;
  return row;
}

// 补货建议汇总统计（用于SKU动销与订单预测页面顶部指标卡）
app.get('/api/replenishment-suggestions/summary', requireApiPermission('replenishment_view'), asyncHandler((req, res) => {
  const { country, warehouse, brand, keyword, sales_status, lifecycle_status } = req.query;
  let where = '';
  const params = [];
  if (country) { where += (where ? ' AND' : ' WHERE') + ' rs.country = ?'; params.push(country); }
  if (warehouse) { where += (where ? ' AND' : ' WHERE') + ' rs.target_warehouse = ?'; params.push(warehouse); }
  if (brand) { where += (where ? ' AND' : ' WHERE') + ' s.brand = ?'; params.push(brand); }
  if (keyword) { where += (where ? ' AND' : ' WHERE') + ' (rs.sku_code LIKE ? OR s.product_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (sales_status) { where += (where ? ' AND' : ' WHERE') + ' rs.sales_status = ?'; params.push(sales_status); }
  if (lifecycle_status) { where += (where ? ' AND' : ' WHERE') + ' rs.lifecycle_status = ?'; params.push(lifecycle_status); }
  // 订单预测排除寄售仓：寄售库存不计入库存池/周转/建议采购（保证列表、底部合计、汇总口径一致）
  where = appendConsignmentExclusion(where, params, 'rs.target_warehouse');
  // DATA-SCOPE: 应用数据权限过滤（国家/品牌/仓库）
  const rsScopeFilterSum = buildReplenishmentDataScopeFilter(req);
  if (rsScopeFilterSum.sql) {
    const scopeConds = rsScopeFilterSum.sql.replace(/^ AND /, '');
    where += (where ? ' AND ' : ' WHERE ') + scopeConds;
    params.push(...rsScopeFilterSum.params);
  }
  const rows = query(`SELECT rs.*,
      i.id AS inv_row_id,
      i.available_qty AS inv_available_qty,
      i.in_transit_qty AS inv_in_transit_qty,
      i.pi_confirmed_unshipped_qty AS inv_pi_confirmed_unshipped_qty,
      i.po_unconfirmed_pi_qty AS inv_po_unconfirmed_pi_qty
    FROM replenishment_suggestions rs
    LEFT JOIN skus s ON rs.sku_code = s.sku_code
    LEFT JOIN inventory i ON rs.sku_code = i.sku_code AND rs.country = i.country AND rs.target_warehouse = i.warehouse${where}`, params).rows.map(applyLiveForecastInventory);
  const totalSkus = rows.length;
  const totalPool = rows.reduce((s, r) => s + (r.total_inventory_pool || 0), 0);
  const totalSales4m = rows.reduce((s, r) => s + (r.sales_m1 || 0) + (r.sales_m2 || 0) + (r.sales_m3 || 0) + (r.sales_m4 || 0), 0);
  const avgSales4m = rows.length > 0 ? rows.reduce((s, r) => s + (r.avg_sales_4m || 0), 0) / rows.length : 0;
  const salesStatsDays = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'sales_stats_days'")?.value || '90');
  const salesPeriodMonths = salesStatsDays > 0 ? salesStatsDays / 30 : 3;
  // 顶部周期总销量与周期月均必须来自同一批预测快照：
  // 60/90/120 天总销量 = 各 SKU 周期月均之和 × 2/3/4；
  // 页面月均 = 同一个周期总销量 ÷ 2/3/4，不再计算“每 SKU 平均月销”。
  const totalSalesPeriod = Math.round(rows.reduce((s, r) => s + (r.avg_sales_period || 0) * salesPeriodMonths, 0));
  const avgSalesPeriod = salesPeriodMonths > 0 ? totalSalesPeriod / salesPeriodMonths : 0;
  // 预计周转月数统一采用系统销量统计周期；无销量 SKU 不参与平均周转分母。
  const activeSkus = rows.filter(r => (r.avg_sales_period || 0) > 0);
  const activePool = activeSkus.reduce((s, r) => s + (r.total_inventory_pool || 0), 0);
  const activeAvgSales = activeSkus.reduce((s, r) => s + (r.avg_sales_period || 0), 0);
  const overallTurnover = activeAvgSales > 0 ? activePool / activeAvgSales : 99;
  // 顶部库存健康概览：仅基于现有预测快照做展示聚合，不写回、不参与建议采购或分类。
  const currentInventory = rows.reduce((s, r) => s + (r.available_qty || 0), 0);
  const inTransitInventory = rows.reduce((s, r) => s + (r.in_transit_qty || 0), 0);
  const confirmedUnshippedInventory = rows.reduce((s, r) => s + (r.pi_confirmed_unshipped_qty || 0), 0);
  const totalMonthlySales = rows.reduce((s, r) => s + (r.avg_sales_period || 0), 0);
  const displayTurnover = quantity => totalMonthlySales > 0 ? Math.round(quantity / totalMonthlySales * 10) / 10 : null;
  const currentInventoryTurnover = displayTurnover(currentInventory);
  const afterTransitTurnover = displayTurnover(currentInventory + inTransitInventory);
  const afterOrderTurnover = displayTurnover(currentInventory + inTransitInventory + confirmedUnshippedInventory);
  const needReplenish = rows.filter(r => (r.suggested_qty || 0) > 0 && (r.lifecycle_status || '') !== 'clearance').length;
  const stockoutRisk = rows.filter(r => (r.risk_level || '') === '严重缺货' || (r.risk_level || '') === '缺货风险').length;
  const stagnant = rows.filter(r => (r.sales_status || '') === '呆滞').length;
  const slowSales = rows.filter(r => (r.sales_status || '') === '慢销').length;
  const highStock = rows.filter(r => (r.risk_level || '') === '库存偏高' || normalizeRiskTags(r.risk_tags).some(t => t === '高库存关注' || t === '高库存严重')).length;
  res.json({
    totalSkus, totalPool, totalSales4m, totalSalesPeriod,
    salesStatsDays,
    avgSales4m: Math.round(avgSales4m * 100) / 100,
    avgSalesPeriod: Math.round(avgSalesPeriod * 100) / 100,
    overallTurnover: Math.round(overallTurnover * 10) / 10,
    currentInventory, inTransitInventory, confirmedUnshippedInventory,
    currentInventoryTurnover, afterTransitTurnover, afterOrderTurnover,
    needReplenish, stockoutRisk, stagnant, slowSales, highStock
  });
}));

// 按天销量明细
app.get('/api/replenishment-suggestions/daily-sales', requireApiPermission('replenishment_view'), asyncHandler((req, res) => {
  const { country, warehouse, brand, keyword, sales_status, lifecycle_status, start, end } = req.query;
  // 日期范围：优先使用「历史销售查看范围」(start/end 为 YYYY-MM-DD)，否则默认最近30天
  let dates = [];
  if (start && end) {
    const d0 = new Date(start + 'T00:00:00');
    const d1 = new Date(end + 'T00:00:00');
    if (!isNaN(d0.getTime()) && !isNaN(d1.getTime()) && d0 <= d1) {
      let cursor = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
      while (cursor <= d1) {
        dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }
  if (dates.length === 0) {
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
  }
  // 取所有补货建议的SKU列表
  let sql = `SELECT rs.*, s.product_name, s.brand, s.category, s.model, s.qty_per_carton,
      i.id AS inv_row_id,
      i.available_qty AS inv_available_qty,
      i.in_transit_qty AS inv_in_transit_qty,
      i.pi_confirmed_unshipped_qty AS inv_pi_confirmed_unshipped_qty,
      i.po_unconfirmed_pi_qty AS inv_po_unconfirmed_pi_qty
    FROM replenishment_suggestions rs
    LEFT JOIN skus s ON rs.sku_code = s.sku_code
    LEFT JOIN inventory i ON rs.sku_code = i.sku_code AND rs.country = i.country AND rs.target_warehouse = i.warehouse
    WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND rs.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND rs.target_warehouse = ?'; params.push(warehouse); }
  if (brand) { sql += ' AND s.brand = ?'; params.push(brand); }
  if (keyword) { sql += ' AND (rs.sku_code LIKE ? OR s.product_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (sales_status) { sql += ' AND rs.sales_status = ?'; params.push(sales_status); }
  if (lifecycle_status) { sql += ' AND rs.lifecycle_status = ?'; params.push(lifecycle_status); }
  // DATA-SCOPE: 应用数据权限过滤（国家/品牌/仓库）
  const rsScopeFilter = buildReplenishmentDataScopeFilter(req);
  if (rsScopeFilter.sql) { sql += rsScopeFilter.sql; params.push(...rsScopeFilter.params); }
  sql += ' ORDER BY CASE WHEN rs.lifecycle_status IN (\'stopped\',\'discontinued\') THEN 1 ELSE 0 END, rs.sku_code';
  const skus = query(sql, params).rows.map(applyLiveForecastInventory);

  // 查近30天出库记录，按SKU+日期聚合
  const skuCodes = skus.map(s => s.sku_code);
  if (skuCodes.length === 0) { return res.json({ dates, skus: [] }); }
  const placeholders = skuCodes.map(() => '?').join(',');
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  const isOnline = req.query.tab === 'online';
  const isOffline = req.query.tab === 'offline';
  let channelFilter = '';
  if (isOnline) { channelFilter = " AND (shop_platform LIKE '%线上%' OR lower(COALESCE(shop_platform, '')) = 'online')"; }
  else if (isOffline) { channelFilter = " AND (shop_platform LIKE '%线下%' OR lower(COALESCE(shop_platform, '')) = 'offline')"; }

  const salesDate = salesOrderDateExpr('order_date');
  // 国家筛选：如果指定了国家，仅匹配该国家的销售记录
  let countryFilter = '';
  const salesParams = [...skuCodes, startDate, endDate];
  if (country) { countryFilter = ' AND country = ?'; salesParams.push(country); }
  // DATA-SCOPE: 销售记录数据权限过滤
  const salesScopeFilter1 = buildSalesDataScopeFilter(req, '');
  salesParams.push(...salesScopeFilter1.params);
  const salesRows = query(
    `SELECT sku_code, ${salesDate} as normalized_order_date, SUM(quantity) as qty FROM sales_records WHERE sku_code IN (${placeholders}) AND ${salesDate} >= ? AND ${salesDate} <= ? AND is_valid_order = 1${channelFilter}${countryFilter}${salesScopeFilter1.sql} GROUP BY sku_code, normalized_order_date`,
    salesParams
  ).rows;

  // 构建 SKU+date → qty 映射
  const salesMap = {};
  salesRows.forEach(r => {
    if (!salesMap[r.sku_code]) salesMap[r.sku_code] = {};
    salesMap[r.sku_code][r.normalized_order_date] = r.qty;
  });

  // 组装结果
  const result = skus.map(sku => {
    const dailyMap = salesMap[sku.sku_code] || {};
    const daily = dates.map(d => dailyMap[d] || 0);
    const last7 = daily.slice(-7).reduce((a, b) => a + b, 0);
    const last14 = daily.slice(-14).reduce((a, b) => a + b, 0);
    const last30 = daily.slice(-30).reduce((a, b) => a + b, 0);
    const avgWindow = Math.min(daily.length, 30);
    const avgDaily = avgWindow > 0 ? Math.round((last30 / avgWindow) * 100) / 100 : 0;
    // 销量趋势：近7天 vs 前7天
    const recent7 = daily.slice(-7).reduce((a, b) => a + b, 0);
    const prev7 = daily.slice(-14, -7).reduce((a, b) => a + b, 0);
    let trend = 'flat';
    if (recent7 > prev7 * 1.1) trend = 'up';
    else if (recent7 < prev7 * 0.9 && prev7 > 0) trend = 'down';
    else if (recent7 === 0 && prev7 === 0) trend = 'flat';
    return {
      ...sku,
      daily_sales: daily,
      last_7_days: last7,
      last_14_days: last14,
      last_30_days: last30,
      avg_daily_sales: avgDaily,
      trend
    };
  });

  // 按请求语言翻译展示层字段：仅 sales_reason / ai_business_advice（确定性最终说明文案）
  // sales_status / action / risk_tags / sales_group / lifecycle_status 保持数据库原始值（前端按原始值格式化三语）
  const dLang = req.i18nLang || 'zh';
  if (dLang !== 'zh') {
    result.forEach(function(s) {
      if (s.sales_reason) s.sales_reason = forecastDisplayT(dLang, s.sales_reason);
      if (s.ai_business_advice) s.ai_business_advice = forecastDisplayT(dLang, s.ai_business_advice);
    });
  }

  res.json({ dates, skus: result });
}));

// 历史销售查看 — 仅用于字段配置面板中查看指定时间段销量，不参与任何预测计算
app.get('/api/replenishment-suggestions/historical-sales', requireApiPermission('replenishment_view'), asyncHandler((req, res) => {
  const { mode, start, end, country, warehouse, brand, keyword, sales_status, lifecycle_status } = req.query;
  if (!mode || !start || !end) {
    return res.status(400).json({ error: 'mode, start, end are required' });
  }
  if (mode !== 'monthly' && mode !== 'daily') {
    return res.status(400).json({ error: 'mode must be "monthly" or "daily"' });
  }

  // 获取当前筛选条件下的 SKU 列表
  let skuSql = `SELECT DISTINCT rs.sku_code, s.product_name, s.brand, s.model FROM replenishment_suggestions rs LEFT JOIN skus s ON rs.sku_code = s.sku_code WHERE 1=1`;
  const skuParams = [];
  if (country) { skuSql += ' AND rs.country = ?'; skuParams.push(country); }
  if (warehouse) { skuSql += ' AND rs.target_warehouse = ?'; skuParams.push(warehouse); }
  if (brand) { skuSql += ' AND s.brand = ?'; skuParams.push(brand); }
  if (keyword) { skuSql += ' AND (rs.sku_code LIKE ? OR s.product_name LIKE ?)'; skuParams.push(`%${keyword}%`, `%${keyword}%`); }
  if (sales_status) { skuSql += ' AND rs.sales_status = ?'; skuParams.push(sales_status); }
  if (lifecycle_status) { skuSql += ' AND rs.lifecycle_status = ?'; skuParams.push(lifecycle_status); }
  // DATA-SCOPE: 应用数据权限过滤（国家/品牌/仓库）
  const hsRsScopeFilter = buildReplenishmentDataScopeFilter(req);
  if (hsRsScopeFilter.sql) { skuSql += hsRsScopeFilter.sql; skuParams.push(...hsRsScopeFilter.params); }
  const skuRows = query(skuSql, skuParams).rows;
  const skuCodes = skuRows.map(r => r.sku_code);
  if (skuCodes.length === 0) {
    return res.json({ success: true, mode, range: { start, end }, columns: [], data: {} });
  }

  const salesDate = salesOrderDateExpr('order_date');
  const placeholders = skuCodes.map(() => '?').join(',');

  if (mode === 'monthly') {
    // 按月查看：解析年月范围，逐个查询
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    if (!sy || !sm || !ey || !em || sy > ey || (sy === ey && sm > em)) {
      return res.status(400).json({ error: 'Invalid month range' });
    }
    const monthCols = [];
    const cursor = new Date(sy, sm - 1, 1);
    const endDate = new Date(ey, em - 1, 1);
    while (cursor <= endDate) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      monthCols.push(`${y}-${m}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    // 批量查询：整个时间范围一次查（按国家筛选）
    const fullStart = `${monthCols[0]}-01`;
    const lastMonth = monthCols[monthCols.length - 1];
    const [ly, lm] = lastMonth.split('-').map(Number);
    const lastDay = new Date(ly, lm, 0).getDate();
    const fullEnd = `${lastMonth}-${String(lastDay).padStart(2, '0')}`;

    let monthlySalesSql = `SELECT sku_code, substr(${salesDate}, 1, 7) as ym, SUM(quantity) as qty FROM sales_records WHERE sku_code IN (${placeholders}) AND ${salesDate} >= ? AND ${salesDate} <= ? AND is_valid_order = 1`;
    const monthlySalesParams = [...skuCodes, fullStart, fullEnd];
    if (country) { monthlySalesSql += ' AND country = ?'; monthlySalesParams.push(country); }
    // DATA-SCOPE: 销售记录数据权限过滤
    const hsMonthlyScopeFilter = buildSalesDataScopeFilter(req, '');
    if (hsMonthlyScopeFilter.sql) { monthlySalesSql += hsMonthlyScopeFilter.sql; monthlySalesParams.push(...hsMonthlyScopeFilter.params); }
    monthlySalesSql += ` GROUP BY sku_code, substr(${salesDate}, 1, 7)`;
    const salesRows = query(monthlySalesSql, monthlySalesParams).rows;

    const data = {};
    skuCodes.forEach(code => {
      data[code] = {};
      monthCols.forEach(m => { data[code][m] = 0; });
    });
    salesRows.forEach(r => {
      if (data[r.sku_code] && data[r.sku_code][r.ym] !== undefined) {
        data[r.sku_code][r.ym] = r.qty;
      }
    });

    return res.json({ success: true, mode: 'monthly', range: { start, end }, columns: monthCols, data });
  }

  if (mode === 'daily') {
    // 按日查看：汇总指定日期范围的总销量
    const startDate = start.length === 10 ? start : `${start}-01`;
    const endDateCalc = end;
    let actualEnd = end;
    if (end.length === 10) {
      actualEnd = end;
    } else {
      const [ey2, em2] = end.split('-').map(Number);
      const ld = new Date(ey2, em2, 0).getDate();
      actualEnd = `${end}-${String(ld).padStart(2, '0')}`;
    }

    let dailySalesSql = `SELECT sku_code, SUM(quantity) as qty FROM sales_records WHERE sku_code IN (${placeholders}) AND ${salesDate} >= ? AND ${salesDate} <= ? AND is_valid_order = 1`;
    const dailySalesParams = [...skuCodes, start, actualEnd];
    if (country) { dailySalesSql += ' AND country = ?'; dailySalesParams.push(country); }
    // DATA-SCOPE: 销售记录数据权限过滤
    const hsDailyScopeFilter = buildSalesDataScopeFilter(req, '');
    if (hsDailyScopeFilter.sql) { dailySalesSql += hsDailyScopeFilter.sql; dailySalesParams.push(...hsDailyScopeFilter.params); }
    dailySalesSql += ' GROUP BY sku_code';
    const salesRows = query(dailySalesSql, dailySalesParams).rows;

    const data = {};
    skuCodes.forEach(code => { data[code] = { total: 0 }; });
    salesRows.forEach(r => { data[r.sku_code].total = r.qty; });

    return res.json({
      success: true,
      mode: 'daily',
      range: { start: start.length === 10 ? start : startDate, end: actualEnd },
      total: salesRows.reduce((sum, r) => sum + r.qty, 0),
      data
    });
  }
}));

// 月度销量矩阵（总预测月份列数据源）
// 口径与 replenishment_suggestions.sales_m1..m4 的生成逻辑完全一致（见本文件「销量聚合 A」）：
// 同一事实表 sales_records、同一日期归一化 salesOrderDateExpr、同一 is_valid_order = 1、
// 同一 SUM(quantity)、同一 sku_code + country 分组维度。仅把 4 个月的窗口拉长为任意月份区间。
// 纯查询接口，不参与也不改变任何预测计算。
app.get('/api/replenishment-suggestions/monthly-sales', requireApiPermission('replenishment_view'), asyncHandler((req, res) => {
  const { start, end, country, warehouse, brand, keyword, sales_status, lifecycle_status } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start, end are required (YYYY-MM)' });
  }
  const [sy, sm] = String(start).split('-').map(Number);
  const [ey, em] = String(end).split('-').map(Number);
  if (!sy || !sm || !ey || !em || sm < 1 || sm > 12 || em < 1 || em > 12 || sy > ey || (sy === ey && sm > em)) {
    return res.status(400).json({ error: 'Invalid month range' });
  }

  // 月份列（YYYY-MM）
  const columns = [];
  const cursor = new Date(sy, sm - 1, 1);
  const lastMonthDate = new Date(ey, em - 1, 1);
  while (cursor <= lastMonthDate) {
    columns.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // 与当前筛选条件一致的 SKU 范围（与 historical-sales 保持同样的筛选口径）
  let skuSql = `SELECT DISTINCT rs.sku_code FROM replenishment_suggestions rs LEFT JOIN skus s ON rs.sku_code = s.sku_code WHERE 1=1`;
  const skuParams = [];
  if (country) { skuSql += ' AND rs.country = ?'; skuParams.push(country); }
  if (warehouse) { skuSql += ' AND rs.target_warehouse = ?'; skuParams.push(warehouse); }
  if (brand) { skuSql += ' AND s.brand = ?'; skuParams.push(brand); }
  if (keyword) { skuSql += ' AND (rs.sku_code LIKE ? OR s.product_name LIKE ?)'; skuParams.push(`%${keyword}%`, `%${keyword}%`); }
  if (sales_status) { skuSql += ' AND rs.sales_status = ?'; skuParams.push(sales_status); }
  if (lifecycle_status) { skuSql += ' AND rs.lifecycle_status = ?'; skuParams.push(lifecycle_status); }
  // DATA-SCOPE: 应用数据权限过滤（国家/品牌/仓库）
  const msRsScopeFilter = buildReplenishmentDataScopeFilter(req);
  if (msRsScopeFilter.sql) { skuSql += msRsScopeFilter.sql; skuParams.push(...msRsScopeFilter.params); }
  const skuCodes = query(skuSql, skuParams).rows.map(r => r.sku_code);
  if (skuCodes.length === 0) {
    return res.json({ success: true, range: { start, end }, columns, data: {} });
  }

  const salesDate = salesOrderDateExpr('order_date');
  const placeholders = skuCodes.map(() => '?').join(',');
  const rangeStart = `${columns[0]}-01`;
  const [ly, lm] = columns[columns.length - 1].split('-').map(Number);
  const rangeEnd = `${columns[columns.length - 1]}-${String(new Date(ly, lm, 0).getDate()).padStart(2, '0')}`;

  // DATA-SCOPE: 销售记录数据权限过滤
  const msSalesScopeFilter = buildSalesDataScopeFilter(req, '');
  const rows = query(
    `SELECT sku_code,
            COALESCE(country, '') AS country,
            substr(${salesDate}, 1, 4) AS y,
            substr(${salesDate}, 6, 2) AS mo,
            COALESCE(SUM(quantity), 0) AS total
     FROM sales_records
     WHERE sku_code IN (${placeholders}) AND ${salesDate} >= ? AND ${salesDate} <= ? AND is_valid_order = 1${msSalesScopeFilter.sql}
     GROUP BY sku_code, COALESCE(country, ''), y, mo`,
    skuCodes.concat([rangeStart, rangeEnd]).concat(msSalesScopeFilter.params)
  ).rows;

  // 按 sku_code|country 组织，与总预测行粒度一致
  const data = {};
  const columnSet = {};
  columns.forEach(c => { columnSet[c] = true; });
  rows.forEach(r => {
    const ym = `${r.y}-${r.mo}`;
    if (!columnSet[ym]) return;
    const mapKey = `${r.sku_code}|${r.country || ''}`;
    if (!data[mapKey]) data[mapKey] = {};
    data[mapKey][ym] = Number(r.total) || 0;
  });

  return res.json({ success: true, range: { start, end }, columns, data });
}));

app.get('/api/replenishment-suggestions', requireApiPermission('replenishment_view'), asyncHandler(async (req, res) => {
  // 读取前兜底重算：物流状态(completed)是「是否在途」的唯一物理事实源，
  // inventory.in_transit_qty 只是可重新生成的派生数据。即便物流 PUT 后即时重算失败，
  // 用户刷新订单预测时此处必会按源事实校正，形成确定性自愈链路。
  await updateInventoryTransitData();
  const { country, warehouse, brand, keyword, sales_status, lifecycle_status } = req.query;
  let sql = `SELECT rs.*, s.product_name, s.brand, s.category, s.model, s.standard_purchase_price, s.qty_per_carton, s.purchase_currency, i.last_inbound_date,
      i.id AS inv_row_id,
      i.available_qty AS inv_available_qty,
      i.in_transit_qty AS inv_in_transit_qty,
      i.pi_confirmed_unshipped_qty AS inv_pi_confirmed_unshipped_qty,
      i.po_unconfirmed_pi_qty AS inv_po_unconfirmed_pi_qty
    FROM replenishment_suggestions rs LEFT JOIN skus s ON rs.sku_code = s.sku_code LEFT JOIN inventory i ON rs.sku_code = i.sku_code AND rs.country = i.country AND rs.target_warehouse = i.warehouse WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND rs.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND rs.target_warehouse = ?'; params.push(warehouse); }
  if (brand) { sql += ' AND s.brand = ?'; params.push(brand); }
  if (keyword) { sql += ' AND (rs.sku_code LIKE ? OR s.product_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (sales_status) { sql += ' AND rs.sales_status = ?'; params.push(sales_status); }
  if (lifecycle_status) { sql += ' AND rs.lifecycle_status = ?'; params.push(lifecycle_status); }
  // 订单预测排除寄售仓：寄售库存不计入库存池/周转/建议采购（页面上线后立即隐藏历史寄售行）
  sql = appendConsignmentExclusion(sql, params, 'rs.target_warehouse');
  // DATA-SCOPE: 应用数据权限过滤（国家/品牌/仓库）
  const rsScopeFilter2 = buildReplenishmentDataScopeFilter(req);
  if (rsScopeFilter2.sql) { sql += rsScopeFilter2.sql; params.push(...rsScopeFilter2.params); }
  sql += ' ORDER BY CASE WHEN rs.lifecycle_status IN (\'stopped\',\'discontinued\') THEN 1 ELSE 0 END, rs.sku_code';
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const rows = query(sql, params).rows.map(applyLiveForecastInventory).map(r => {
    let daysSince = null;
    if (r.last_inbound_date) {
      const d = new Date(r.last_inbound_date);
      if (!isNaN(d.getTime())) {
        daysSince = Math.floor((today - d) / (1000 * 60 * 60 * 24));
      }
    }
    r.days_since_last_inbound = daysSince;
    return r;
  });
  // 按请求语言翻译展示层字段：仅 sales_reason / ai_business_advice（确定性最终说明文案）
  // sales_status / action / risk_tags / sales_group / lifecycle_status / suggestion 保持数据库原始值
  const rLang = req.i18nLang || 'zh';
  if (rLang !== 'zh') {
    rows.forEach(function(r) {
      if (r.sales_reason) r.sales_reason = forecastDisplayT(rLang, r.sales_reason);
      if (r.ai_business_advice) r.ai_business_advice = forecastDisplayT(rLang, r.ai_business_advice);
    });
  }
  res.json(rows);
}));

// P3B-1：抽取「单个 suggestion target 的预测计算公式」为纯计算函数。
// 仅 MOVE + CALL，未改任何公式/业务规则（与 P3A.2 原始 forEach 体逐行一致）。
// 纯计算边界（详见 P3B-1 §4）：禁止 query/aq/run/transaction/INSERT/UPDATE/DELETE；
// 仅调用已确认无 DB side effect 的 helper（calculateSuggestion/resolveChannelRatio/
// getDimTurnover/detectStockoutDistortion/classifySkuState/shouldBlockReplenish/
// buildSuggestionText/genId）。
function computeSuggestionForTarget({ inv, sku, existing_rs, brandStopped, months, monthlyMap, aggMap, targetMonths, leadTimeMonths, salesStatsDays, dimCfg, channelConfigMap, countriesCache, now }) {
      // 计算近4个月销量（从销售明细表汇总，is_valid_order=1）
      const salesMap = {};
      const onlineSalesMap = {};
      const offlineSalesMap = {};
      months.forEach(m => {
        const invSalesKey = inv.sku_code + '|' + (inv.country || '');
        const bucket = (monthlyMap[invSalesKey] && monthlyMap[invSalesKey][m.key]) || { total: 0, online: 0, offline: 0 };
        salesMap[m.key] = bucket.total;
        onlineSalesMap[m.key] = bucket.online;
        offlineSalesMap[m.key] = bucket.offline;
      });

      const sales_m1 = salesMap.m1 || 0;
      const sales_m2 = salesMap.m2 || 0;
      const sales_m3 = salesMap.m3 || 0;
      const sales_m4 = salesMap.m4 || 0;
      const avg_sales_4m = (sales_m1 + sales_m2 + sales_m3 + sales_m4) / 4;

      // 线上/线下分月销量
      const online_sales_m1 = onlineSalesMap.m1 || 0;
      const online_sales_m2 = onlineSalesMap.m2 || 0;
      const online_sales_m3 = onlineSalesMap.m3 || 0;
      const online_sales_m4 = onlineSalesMap.m4 || 0;
      const online_avg_sales_4m = (online_sales_m1 + online_sales_m2 + online_sales_m3 + online_sales_m4) / 4;
      const offline_sales_m1 = offlineSalesMap.m1 || 0;
      const offline_sales_m2 = offlineSalesMap.m2 || 0;
      const offline_sales_m3 = offlineSalesMap.m3 || 0;
      const offline_sales_m4 = offlineSalesMap.m4 || 0;
      const offline_avg_sales_4m = (offline_sales_m1 + offline_sales_m2 + offline_sales_m3 + offline_sales_m4) / 4;

      // 销量统计周期月均：60/90/120 天有效销量分别 ÷ 2/3/4。（periodStart/periodEnd 已在集合化读取阶段计算）
      const invAggKey = inv.sku_code + '|' + (inv.country || '');
      const agg = aggMap[invAggKey];
      const totalPeriodSales = agg ? Number(agg.period_total) || 0 : 0;
      const onlinePeriodSales = agg ? Number(agg.period_online) || 0 : 0;
      const offlinePeriodSales = agg ? Number(agg.period_offline) || 0 : 0;
      const salesPeriodMonths = salesStatsDays > 0 ? salesStatsDays / 30 : 3;
      // 统一以落库精度参与后续计算，保证接口展示值可直接复算周转和建议量。
      const avg_sales_period = Math.round(totalPeriodSales / salesPeriodMonths * 100) / 100;
      const online_avg_sales_period = Math.round(onlinePeriodSales / salesPeriodMonths * 100) / 100;
      const offline_avg_sales_period = Math.round(offlinePeriodSales / salesPeriodMonths * 100) / 100;

      const avail = inv.available_qty || 0;
      const transit = inv.in_transit_qty || 0;
      const piUnshipped = inv.pi_confirmed_unshipped_qty || 0;
      const poUnconfirmed = inv.po_unconfirmed_pi_qty || 0;
      // 冻结库存池：可用 + CI 已发货在途 + PI/PO 已确认未发货。
      // poUnconfirmed 仅保留为参考字段，未确认 PO 不计入库存池，避免把潜在供应当成已确认供应。
      const total_inventory_pool = avail + transit + piUnshipped;

      // 统一判定层所需指标（d30/d90/ever/first_sale 已在集合化读取阶段计算）
      const agg2 = aggMap[invAggKey];
      const sales_30d = agg2 ? Number(agg2.s30) || 0 : 0;
      const sales_90d = agg2 ? Number(agg2.s90) || 0 : 0;
      const total_sales_ever = agg2 ? Number(agg2.ever_total) || 0 : 0;
      const first_sale_date = agg2 ? (agg2.first_sale || '') : '';
      const last_inbound_date = inv.last_inbound_date || '';
      const first_inbound_date = inv.first_inbound_date || '';
      let days_since_last_inbound = null;
      if (last_inbound_date) {
        const ld = new Date(last_inbound_date);
        if (!isNaN(ld.getTime())) days_since_last_inbound = Math.floor((now - ld) / 86400000);
      }

      // CHANNEL-ALLOCATION: 渠道比例三级解析
      const last_outbound_date = inv.last_outbound_date || '';
      const last_sale_date = agg2 ? (agg2.last_sale || '') : '';
      const channelRatio = resolveChannelRatio({
        skuCode: inv.sku_code,
        country: inv.country,
        avgSalesPeriod: avg_sales_period,
        available: avail,
        totalSalesEver: total_sales_ever,
        lastSaleDate: last_sale_date,
        lastOutboundDate: last_outbound_date,
        aggObj: agg,
        monthlyMap: monthlyMap,
        channelConfigMap: channelConfigMap,
        countriesCache: countriesCache
      });
      // A-Step1 收口：目标周转值来源——dim 命中（预检已保证非 null，不再回退旧逻辑/兜底值）
      // 品牌停采时可能无命中规则（预检已跳过），用中性兜底仅供展示列，不影响采购（建议采购会强制为 0）
      const dimHit = getDimTurnover(sku.brand, inv.country, inv.warehouse, dimCfg) || { online_turnover: 3, offline_turnover: 3 };
      const online_target_turnover = dimHit.online_turnover;
      const offline_target_turnover = dimHit.offline_turnover;
      const classifyTarget = dimHit.online_turnover;

      // 生命周期策略系数
      const lifecycle = sku.lifecycle_status || 'stable';
      const LIFECYCLE_COEFF = {
        'new_test': 0, 'new_launch': 0.5, 'growth': 0.8,
        'stable': 1.0, 'slow': 0.5, 'stagnant': 0,
        'clearance': 0, 'stopped': 0
      };
      const lifecycleCoeff = LIFECYCLE_COEFF[lifecycle] !== undefined ? LIFECYCLE_COEFF[lifecycle] : 1.0;

      // 当前周转（总月均=0时显示99，前端会处理为"无销量"）
      const current_turnover_months = avg_sales_period > 0 ? total_inventory_pool / avg_sales_period : 99;

      // existing_rs：读取历史 other_target_stock / final_order_qty（目标周转已在上文按维度命中/回退确定）
      // 当前业务仅有线上/线下；历史 other 字段保留兼容，但不参与本轮预测。
      const other_target_stock = 0;

      // 缺货销量失真检测：如果近期销量骤降由缺货导致，用断货前最高月销量修正基准
      const onlineDist = detectStockoutDistortion(online_sales_m1, online_sales_m2, online_sales_m3, online_sales_m4, avail);
      const offlineDist = detectStockoutDistortion(offline_sales_m1, offline_sales_m2, offline_sales_m3, offline_sales_m4, avail);

      // 目标库存计算：基数取销量统计周期月均；若命中缺货销量失真，则用断货前峰值修正基准（回归修复：P4 统一口径时误删的特殊分支）
      const online_base_avg = onlineDist.isDistorted ? onlineDist.adjustedAvg : online_avg_sales_period;
      const offline_base_avg = offlineDist.isDistorted ? offlineDist.adjustedAvg : offline_avg_sales_period;
      const online_target_stock = Math.round(online_base_avg * online_target_turnover);
      const offline_target_stock = Math.round(offline_base_avg * offline_target_turnover);
      const total_target_stock = online_target_stock + offline_target_stock;

      // suggested_qty 在 classifyResult 之后经过业务拦截重新计算，此处先用临时值
      let suggested_qty = Math.round(Math.max(0, total_target_stock - total_inventory_pool));

      // MOQ和箱规修正
      let moqQty = (sku.qty_per_carton > 0 && suggested_qty > 0) ? Math.ceil(suggested_qty / sku.qty_per_carton) * sku.qty_per_carton : suggested_qty;

      // 最终下单数量（默认=系统建议补货，保留用户已设置的值）
      let final_order_qty = (existing_rs && existing_rs.final_order_qty != null && existing_rs.final_order_qty >= 0) ? existing_rs.final_order_qty : suggested_qty;

      // 订单后周转 = (总库存池 + 最终下单数量) ÷ 总月均
      let after_order_turnover_months = avg_sales_period > 0 ? (total_inventory_pool + final_order_qty) / avg_sales_period : 99;
      let onlineAfterOrder = online_avg_sales_period > 0 ? (total_inventory_pool + final_order_qty) / online_avg_sales_period : 99;
      let offlineAfterOrder = offline_avg_sales_period > 0 ? (total_inventory_pool + final_order_qty) / offline_avg_sales_period : 99;

      // 风险等级
      let risk_level = '';
      if (sku.status === 'clearance' || lifecycle === 'clearance') {
        risk_level = '清仓';
      } else if (lifecycle === 'stopped') {
        risk_level = '停产';
      } else if (avg_sales_period === 0) {
        risk_level = '无销量';
      } else if (current_turnover_months < 1) {
        risk_level = '严重缺货';
      } else if (current_turnover_months < 2) {
        risk_level = '缺货风险';
      } else if (current_turnover_months > 6) {
        risk_level = '库存偏高';
      } else {
        risk_level = '正常';
      }

      // 预计到货月份
      const arrDate = new Date(now.getFullYear(), now.getMonth() + Math.ceil(leadTimeMonths), 1);
      const arrival_month = `${arrDate.getFullYear()}-${String(arrDate.getMonth() + 1).padStart(2, '0')}`;

      // 动销分组
      let sales_group = '';
      if (avg_sales_4m === 0) sales_group = '滞销';
      else if (avg_sales_4m < 10) sales_group = '低动销';
      else if (avg_sales_4m < 50) sales_group = '中动销';
      else sales_group = '高动销';

      // 统一判断层：动销状态/风险标签/动销原因/建议动作/AI经营建议（不影响建议采购数量）
      const classifyResult = classifySkuState({
        lifecycle_status: lifecycle,
        is_new_product: sku.is_new_product,
        launch_date: sku.launch_date,
        first_inbound_date,
        first_sale_date,
        new_product_protection_days: sku.new_product_protection_days,
        available: avail,
        avg_sales_period,
        sales_30d,
        sales_90d,
        total_sales_ever,
        days_since_last_inbound: days_since_last_inbound,
        last_inbound_date,
        target_months: classifyTarget
      });
      let sales_status = classifyResult.sales_status;
      // 缺货销量失真后处理：追加标签和说明
      if (onlineDist.isDistorted || offlineDist.isDistorted) {
        classifyResult.risk_tags.push('销量失真');
        classifyResult.sales_reason = onlineDist.isDistorted
          ? onlineDist.reason
          : offlineDist.reason;
      }
      // 新品无销量标记
      if (sales_status === '新品/销售数据不足' && sales_30d === 0 && sales_90d === 0) {
        classifyResult.risk_tags.push('新品无销量');
      }
      const risk_tags = classifyResult.risk_tags.join(',');
      let sales_reason = classifyResult.sales_reason;
      let action_text = classifyResult.action;
      const ai_business_advice = classifyResult.ai_business_advice;

      // === 最终建议采购数量（经过业务拦截）===
      // 冻结公式：max(0, 线上目标库存 + 线下目标库存 - 当前库存池)。
      const blocked = shouldBlockReplenish(sales_status, classifyResult.risk_tags);
      const suggestionParts = calculateSuggestion(online_target_stock, offline_target_stock, total_inventory_pool, blocked);
      let online_suggested_qty = suggestionParts.online_suggested_qty;
      let offline_suggested_qty = suggestionParts.offline_suggested_qty;
      let other_suggested_qty = 0;
      suggested_qty = suggestionParts.suggested_qty;

      // 用户可见建议说明必须随快照刷新，不能清空。
      let suggestion = buildSuggestionText(sales_status, lifecycle, suggested_qty, brandStopped);
      // 重新计算依赖 suggested_qty 的字段
      moqQty = (sku.qty_per_carton > 0 && suggested_qty > 0) ? Math.ceil(suggested_qty / sku.qty_per_carton) * sku.qty_per_carton : suggested_qty;
      final_order_qty = (existing_rs && existing_rs.final_order_qty != null && existing_rs.final_order_qty >= 0) ? existing_rs.final_order_qty : suggested_qty;
      after_order_turnover_months = avg_sales_period > 0 ? (total_inventory_pool + final_order_qty) / avg_sales_period : 99;
      onlineAfterOrder = online_avg_sales_period > 0 ? (total_inventory_pool + final_order_qty) / online_avg_sales_period : 99;
      offlineAfterOrder = offline_avg_sales_period > 0 ? (total_inventory_pool + final_order_qty) / offline_avg_sales_period : 99;

      // 品牌停采（系统级规则）后置覆盖：强制不补货、保持可见便于清库存
      if (brandStopped) {
        sales_status = '停采/清库存';
        sales_reason = '品牌已设为停采（停止合作），不参与补货建议，优先消化库存';
        action_text = '停止采购，优先清库存';
        suggestion = buildSuggestionText(sales_status, lifecycle, 0, true);
        suggested_qty = 0;
        online_suggested_qty = 0;
        offline_suggested_qty = 0;
        other_suggested_qty = 0;
        final_order_qty = 0;
        moqQty = 0;
        after_order_turnover_months = avg_sales_period > 0 ? total_inventory_pool / avg_sales_period : 99;
        onlineAfterOrder = online_avg_sales_period > 0 ? total_inventory_pool / online_avg_sales_period : 99;
        offlineAfterOrder = offline_avg_sales_period > 0 ? total_inventory_pool / offline_avg_sales_period : 99;
      }

      if (existing_rs) {
        return {
          mode: 'update',
          id: existing_rs.id,
          values: [
            avail, transit, piUnshipped, poUnconfirmed,
            total_inventory_pool, sales_m1, sales_m2, sales_m3, sales_m4, Math.round(avg_sales_4m * 100) / 100, Math.round(avg_sales_period * 100) / 100, Math.round(online_avg_sales_period * 100) / 100, Math.round(offline_avg_sales_period * 100) / 100,
            online_sales_m1, online_sales_m2, online_sales_m3, online_sales_m4, Math.round(online_avg_sales_4m * 100) / 100,
            offline_sales_m1, offline_sales_m2, offline_sales_m3, offline_sales_m4, Math.round(offline_avg_sales_4m * 100) / 100,
            Math.round(current_turnover_months * 10) / 10, suggested_qty, online_suggested_qty, offline_suggested_qty, other_suggested_qty, moqQty, moqQty,
            Math.round(after_order_turnover_months * 10) / 10, Math.round(onlineAfterOrder * 10) / 10, Math.round(offlineAfterOrder * 10) / 10,
            targetMonths, risk_level, arrival_month, suggestion,
            sku.is_new_product === 1 ? 1 : 0, sku.lifecycle_status || '', sales_group,
            online_target_turnover, offline_target_turnover,
            online_target_stock, offline_target_stock, other_target_stock,
            final_order_qty,
            sales_status, risk_tags, sales_reason, action_text, ai_business_advice,
            channelRatio.source, channelRatio.allocationStatus, channelRatio.onlinePct, channelRatio.resolvedAt
          ]
        };
      } else {
        return {
          mode: 'insert',
          values: [
            genId('rs'), inv.sku_code, inv.country, inv.warehouse, avail, transit,
            piUnshipped, poUnconfirmed, total_inventory_pool,
            sales_m1, sales_m2, sales_m3, sales_m4, Math.round(avg_sales_4m * 100) / 100, Math.round(avg_sales_period * 100) / 100, Math.round(online_avg_sales_period * 100) / 100, Math.round(offline_avg_sales_period * 100) / 100,
            online_sales_m1, online_sales_m2, online_sales_m3, online_sales_m4, Math.round(online_avg_sales_4m * 100) / 100,
            offline_sales_m1, offline_sales_m2, offline_sales_m3, offline_sales_m4, Math.round(offline_avg_sales_4m * 100) / 100,
            Math.round(current_turnover_months * 10) / 10, suggested_qty, moqQty, moqQty,
            online_suggested_qty, offline_suggested_qty, other_suggested_qty,
            Math.round(after_order_turnover_months * 10) / 10, Math.round(onlineAfterOrder * 10) / 10, Math.round(offlineAfterOrder * 10) / 10,
            targetMonths, risk_level, arrival_month, suggestion,
            sku.is_new_product === 1 ? 1 : 0, sku.lifecycle_status || '', sales_group, -1, 0,
            online_target_turnover, offline_target_turnover,
            online_target_stock, offline_target_stock, other_target_stock, final_order_qty,
            sales_status, risk_tags, sales_reason, action_text, ai_business_advice,
            channelRatio.source, channelRatio.allocationStatus, channelRatio.onlinePct, channelRatio.resolvedAt
          ]
        };
      }
}

// 刷新引擎与 full generate 共用的建议列（写入顺序与 computeSuggestionForTarget 的 update/insert values 完全一致）
const RS_SET_COLS = [
  'available_qty', 'in_transit_qty', 'pi_confirmed_unshipped_qty', 'po_unconfirmed_pi_qty',
  'total_inventory_pool', 'sales_m1', 'sales_m2', 'sales_m3', 'sales_m4', 'avg_sales_4m', 'avg_sales_period', 'online_avg_sales_period', 'offline_avg_sales_period',
  'online_sales_m1', 'online_sales_m2', 'online_sales_m3', 'online_sales_m4', 'online_avg_sales_4m',
  'offline_sales_m1', 'offline_sales_m2', 'offline_sales_m3', 'offline_sales_m4', 'offline_avg_sales_4m',
  'current_turnover_months', 'suggested_qty', 'online_suggested_qty', 'offline_suggested_qty', 'other_suggested_qty', 'moq_qty', 'carton_adjusted_qty',
  'after_order_turnover_months', 'online_after_order_turnover_months', 'offline_after_order_turnover_months',
  'target_stock_months', 'risk_level', 'arrival_month',
  'suggestion', 'is_new_product', 'lifecycle_status', 'sales_group',
  'online_target_turnover', 'offline_target_turnover',
  'online_target_stock', 'offline_target_stock', 'other_target_stock',
  'final_order_qty',
  'sales_status', 'risk_tags', 'sales_reason', 'action', 'ai_business_advice',
  'channel_ratio_source', 'channel_allocation_status', 'resolved_online_pct', 'resolved_at'
];

// ============ P3B-2 Refresh Existing Engine ============
// 内部函数（未暴露任何 HTTP route）。针对指定 affected [{sku_code,country}]，
// 根据删除后的当前 sales_records 重新计算【已存在】的 replenishment_suggestions。
// 硬约束：只 UPDATE existing；禁止 INSERT/DELETE suggestion、禁止新增/删除 target_warehouse、
// 禁止修改 inventory、禁止修改 manual 字段、禁止自行开启事务。
// 所有 DB 读写 100% 通过传入的 exec（exec.all / exec.one / exec.run）。
// P4 外层负责 transaction 与调用；dialect 由调用方明确传入（'pg' | 'sqlite'）。

// §11 防御：refresh 结果绝不允许意外 INSERT（compute 对已有 existing_rs 必返回 update，
// 但要求显式 assert 兜底，避免任何未来的公式改动悄悄变成写新行）。
function assertRefreshUpdateOnly(result, key) {
  if (!result || result.mode !== 'update') {
    throw new Error('SALES_REFRESH_UNEXPECTED_INSERT:' + key);
  }
  if (!result.id) {
    throw new Error('SALES_REFRESH_MISSING_ID:' + key);
  }
}

// §13 SQLite refresh writer：逐行 UPDATE，SQL 方言 = SQLite，复用 RS_SET_COLS 与
// computeSuggestionForTarget 的 values 顺序。不开启事务（依赖外层 SQLite transaction），
// 禁止 INSERT/DELETE。每行的 id 已在前置 assert 校验存在。
async function writeSuggestionRefreshSqlite(exec, updateRows) {
  for (const r of updateRows) {
    assertRefreshUpdateOnly(r, r.id || '(no-id)');
    const setClause = RS_SET_COLS.map(c => c + ' = ?').join(', ');
    const params = r.values.concat([r.id]);
    await exec.run('UPDATE replenishment_suggestions SET ' + setClause + ' WHERE id = ?', params);
  }
}

// §12 PG refresh writer：复用 generate 的 UPDATE ... FROM (VALUES ...) 形式，但不含 INSERT 分支。
// 列类型通过 information_schema 取（与 generate 一致）。exec.all 返回列类型行。
async function writeSuggestionRefreshPg(exec, updateRows) {
  if (!updateRows.length) return;
  for (const r of updateRows) assertRefreshUpdateOnly(r, r.id || '(no-id)');
  const colTypeRows = await exec.all(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'replenishment_suggestions'"
  );
  const typeMap = {};
  (colTypeRows || []).forEach(r => {
    const t = r.data_type;
    typeMap[r.column_name] = t === 'integer' ? 'integer' : t === 'double precision' ? 'double precision' : 'text';
  });
  const setClause = RS_SET_COLS.map(c => c + ' = v.' + c + '::' + (typeMap[c] || 'text')).join(', ');
  const valueRows = updateRows.map(r => '(' + Array(r.values.length + 1).fill('?').join(', ') + ')').join(', ');
  const params = [];
  updateRows.forEach(r => { params.push(r.id); r.values.forEach(v => params.push(v)); });
  await exec.run(
    'UPDATE replenishment_suggestions t SET ' + setClause +
    ' FROM (VALUES ' + valueRows + ') AS v(id, ' + RS_SET_COLS.join(', ') + ') WHERE t.id = v.id',
    params
  );
}

// §4/§6/§7/§8 共享校验（DELETE 前 precheck 与 refresh engine 共用，单一真源，杜绝规则漂移）：
// 读取 affected keys 的 existing suggestion 快照 + 当前 inventory（寄售排除）+ SKU master + brand 状态 + DIM，
// 构建经过 fail-closed 校验的 exact targets。任意 orphan / missing SKU / stopped / DIM 未命中 → 抛错。
// 仅 SELECT（不 DELETE / 不 INSERT / 不写 inventory）。空 affectedKeys 直接返回空（S6/S9 合法）。
async function resolveAndValidateRefreshTargets(exec, affectedKeys) {
  if (!affectedKeys || affectedKeys.length === 0) return { targets: [], existingCount: 0, dimCfg: null };

  const ors = affectedKeys.map(() => '(sku_code = ? AND country = ?)').join(' OR ');
  const exParams = [];
  affectedKeys.forEach(k => { exParams.push(k.sku_code); exParams.push(k.country); });
  const existingRows = await exec.all('SELECT * FROM replenishment_suggestions WHERE ' + ors, exParams);

  const skuCodes = Array.from(new Set(affectedKeys.map(k => k.sku_code)));
  const inPh = skuCodes.map(() => '?').join(',');
  const invParams = skuCodes.slice();
  let invSql = 'SELECT DISTINCT i.sku_code, i.country, i.warehouse, i.available_qty, i.in_transit_qty, i.pi_confirmed_unshipped_qty, i.po_unconfirmed_pi_qty, i.last_inbound_date, i.first_inbound_date, i.last_outbound_date, i.target_turnover_months FROM inventory i LEFT JOIN skus s ON i.sku_code = s.sku_code WHERE i.sku_code IN (' + inPh + ')';
  invSql = await appendConsignmentExclusionWithExec(invSql, invParams, 'i.warehouse', exec);
  const inventoryItems = await exec.all(invSql, invParams);
  const invMap = {};
  for (const it of inventoryItems) invMap[it.sku_code + '|' + it.country + '|' + it.warehouse] = it;

  const skuRows = await exec.all('SELECT * FROM skus WHERE sku_code IN (' + inPh + ')', skuCodes.slice());
  const skuMap = {};
  for (const s of skuRows) skuMap[s.sku_code] = s;

  const bsRows = await exec.all('SELECT brand, procurement_status FROM brand_settings');
  const bstatus = {};
  for (const r of bsRows) bstatus[(r.brand || '').trim()] = (r.procurement_status || 'active');

  const dimRaw = await exec.one("SELECT value FROM system_config WHERE key = 'dim_default_config'");
  const dimCfg = dimRaw ? JSON.parse(dimRaw.value) : null;

  const targets = [];
  for (const er of existingRows) {
    const sku = skuMap[er.sku_code];
    if (!sku) throw new Error('SALES_REFRESH_SKU_MISSING:' + er.sku_code); // §7 missing SKU master
    if (sku.status === 'stopped') throw new Error('SALES_REFRESH_SKU_STOPPED:' + er.sku_code); // §7 stopped SKU
    const inv = invMap[er.sku_code + '|' + er.country + '|' + er.target_warehouse];
    if (!inv) throw new Error('SALES_REFRESH_ORPHAN_SUGGESTION:' + er.sku_code + '|' + er.country + '|' + er.target_warehouse); // §6 orphan
    const brandStopped = (bstatus[(sku.brand || '').trim()] || 'active') === 'stopped';
    // §8 DIM precheck：仅对 existing ∩ inventory 的 exact target；品牌停采免检（与 generate 预检跳过一致），禁用 3/3 fallback
    if (!brandStopped) {
      const hit = getDimTurnover(sku.brand, er.country, er.target_warehouse, dimCfg);
      if (!hit) throw new Error('SALES_REFRESH_DIM_UNMATCHED:' + (sku.brand || '') + '|' + er.country + '|' + er.target_warehouse);
    }
    targets.push({ er, sku, inv, brandStopped });
  }
  return { targets, existingCount: targets.length, dimCfg };
}

// §1/§2/§5-§11 主入口：刷新已有 suggestion。transaction-bound（exec 由调用方提供）。
async function refreshExistingSalesSuggestions({ exec, affectedKeys, dialect }) {
  if (!exec) throw new Error('SALES_REFRESH_NO_EXEC');
  if (!Array.isArray(affectedKeys) || affectedKeys.length === 0) return { updated: 0 };

  // §4/§5/§6/§8 单一真源校验（orphan / missing SKU / stopped / DIM）；DELETE 后由调用方再次触发以最终保证边界
  const { targets, dimCfg } = await resolveAndValidateRefreshTargets(exec, affectedKeys);
  if (targets.length === 0) return { updated: 0 }; // §6 affected 无 existing suggestion → 0 行不 INSERT

  const skuCodes = Array.from(new Set(affectedKeys.map(k => k.sku_code)));
  const inPh = skuCodes.map(() => '?').join(',');
  // §10 context（仅 compute 所需；校验已由 helper 完成）
  const now = new Date();
  const oneVal = async (key) => { const r = await exec.one("SELECT value FROM system_config WHERE key = ?", [key]); return r ? r.value : null; };
  const targetMonths = Number(await oneVal('target_stock_months')) || 4;
  const leadTimeMonths = Number(await oneVal('lead_time_months')) || 2;
  const salesStatsDays = Number(await oneVal('sales_stats_days')) || 90;
  const countriesCache = await exec.all('SELECT id, name, code FROM countries ORDER BY sort_order');
  const channelConfigRows = await exec.all("SELECT sku_code, country_id, online_pct, offline_pct, status FROM sku_channel_configs WHERE status = 'active'");
  const channelConfigMap = {};
  for (const r of channelConfigRows) channelConfigMap[r.sku_code + '|' + r.country_id] = r;

  // §9 月份 + 日期口径（与 generate 完全一致；now 冻结由调用方环境保证）
  const months = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: String(d.getMonth() + 1).padStart(2, '0'), key: ['m1', 'm2', 'm3', 'm4'][i] });
  }
  const m4Start = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0];
  const periodEnd = now.toISOString().split('T')[0];
  const periodStart = new Date(now.getTime() - Math.max(0, salesStatsDays - 1) * 86400000).toISOString().split('T')[0];
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
  const d90 = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0];
  const d120 = new Date(now.getTime() - 120 * 86400000).toISOString().split('T')[0];
  const salesDate = salesOrderDateExpr('order_date');

  // §9 销量聚合（与 generate 逐字一致的 SQL：近4月按月 + 周期/d30/d90/累计；is_valid_order=1）
  const monthlyRows = await exec.all(
    'SELECT sku_code, COALESCE(country, \'\') AS country, substr(' + salesDate + ', 1, 4) AS y, substr(' + salesDate + ', 6, 2) AS mo, ' +
    'COALESCE(SUM(quantity), 0) AS total, ' +
    'COALESCE(SUM(CASE WHEN (shop_platform LIKE \'%线上%\' OR lower(shop_platform) = \'online\') THEN quantity END), 0) AS online, ' +
    'COALESCE(SUM(CASE WHEN (shop_platform LIKE \'%线下%\' OR lower(shop_platform) = \'offline\') THEN quantity END), 0) AS offline ' +
    'FROM sales_records WHERE sku_code IN (' + inPh + ') AND ' + salesDate + ' >= ? AND ' + salesDate + ' <= ? AND is_valid_order = 1 ' +
    'GROUP BY sku_code, COALESCE(country, \'\'), y, mo',
    skuCodes.concat([m4Start, periodEnd])
  );
  const monthlyMap = {};
  for (const r of monthlyRows) {
    const ry = String(r.y); const rmo = String(r.mo);
    let key = null;
    for (const m of months) { if (String(m.year) === ry && m.month === rmo) { key = m.key; break; } }
    if (!key) continue;
    const mapKey = r.sku_code + '|' + (r.country || '');
    if (!monthlyMap[mapKey]) monthlyMap[mapKey] = {};
    monthlyMap[mapKey][key] = { total: Number(r.total) || 0, online: Number(r.online) || 0, offline: Number(r.offline) || 0 };
  }
  const aggRows = await exec.all(
    'SELECT sku_code, COALESCE(country, \'\') AS country, ' +
    'COALESCE(SUM(CASE WHEN ' + salesDate + ' >= ? AND ' + salesDate + ' <= ? THEN quantity END), 0) AS period_total, ' +
    'COALESCE(SUM(CASE WHEN ' + salesDate + ' >= ? AND ' + salesDate + ' <= ? AND (shop_platform LIKE \'%线上%\' OR lower(shop_platform) = \'online\') THEN quantity END), 0) AS period_online, ' +
    'COALESCE(SUM(CASE WHEN ' + salesDate + ' >= ? AND ' + salesDate + ' <= ? AND (shop_platform LIKE \'%线下%\' OR lower(shop_platform) = \'offline\') THEN quantity END), 0) AS period_offline, ' +
    'COALESCE(SUM(CASE WHEN ' + salesDate + ' >= ? THEN quantity END), 0) AS s30, ' +
    'COALESCE(SUM(CASE WHEN ' + salesDate + ' >= ? THEN quantity END), 0) AS s90, ' +
    'COALESCE(SUM(CASE WHEN ' + salesDate + ' >= ? AND (shop_platform LIKE \'%线上%\' OR lower(shop_platform) = \'online\') THEN quantity END), 0) AS s120_online, ' +
    'COALESCE(SUM(CASE WHEN ' + salesDate + ' >= ? AND (shop_platform LIKE \'%线下%\' OR lower(shop_platform) = \'offline\') THEN quantity END), 0) AS s120_offline, ' +
    'COALESCE(SUM(quantity), 0) AS ever_total, MIN(' + salesDate + ') AS first_sale, MAX(' + salesDate + ') AS last_sale ' +
    'FROM sales_records WHERE sku_code IN (' + inPh + ') AND is_valid_order = 1 GROUP BY sku_code, COALESCE(country, \'\')',
    [periodStart, periodEnd, periodStart, periodEnd, periodStart, periodEnd, d30, d90, d120, d120].concat(skuCodes)
  );
  const aggMap = {};
  for (const r of aggRows) aggMap[r.sku_code + '|' + (r.country || '')] = r;

  // §6/§7/§8 targets 与 fail-closed 校验已由 resolveAndValidateRefreshTargets 构建（单一真源，无重复规则）

  // §10/§11 调用已验明等价的 computeSuggestionForTarget（禁止复制 per-row 公式）；assert 仅 update
  const updateRows = [];
  for (const t of targets) {
    const result = computeSuggestionForTarget({
      inv: t.inv, sku: t.sku, existing_rs: t.er, brandStopped: t.brandStopped,
      months, monthlyMap, aggMap,
      targetMonths, leadTimeMonths, salesStatsDays, dimCfg,
      channelConfigMap, countriesCache, now
    });
    assertRefreshUpdateOnly(result, t.er.sku_code + '|' + t.er.country + '|' + t.er.target_warehouse);
    updateRows.push(result);
  }

  // §14 dialect-aware writer（仅 UPDATE；dialect 由调用方明确传入，禁止在 pure compute 内判断连接类型）
  if (dialect === 'pg') {
    await writeSuggestionRefreshPg(exec, updateRows);
  } else {
    await writeSuggestionRefreshSqlite(exec, updateRows);
  }
  return { updated: updateRows.length };
}

// 生成/刷新补货建议
// 单进程级 generate 并发门禁：防止同进程重复启动全量事务（仅单实例级，非跨实例）。
let generateInProgress = false;
app.post('/api/replenishment-suggestions/generate', requireApiPermission('replenishment_edit'), asyncHandler(async (req, res) => {
  if (generateInProgress) {
    return res.json({ success: false, code: 'GENERATE_IN_PROGRESS', message: '订单预测正在重新计算，请稍后再试' });
  }
  generateInProgress = true;
  try {
    const { country, warehouse, brand } = req.body;
    const result = await withGenerateClient(async (aq, aqOne, run) => {
    const targetMonths = parseFloat((await aqOne("SELECT value FROM system_config WHERE key = 'target_stock_months'"))?.value || '4');
    const leadTimeMonths = parseFloat((await aqOne("SELECT value FROM system_config WHERE key = 'lead_time_months'"))?.value || '2');
    // 销量统计周期（天）：月均、周转、建议采购统一使用该口径。
    const salesStatsDays = parseInt((await aqOne("SELECT value FROM system_config WHERE key = 'sales_stats_days'"))?.value || '90');
    // 全局默认目标周转（预测参数设置维护），为空时回退品牌默认值
    const onlineDefault = parseFloat((await aqOne("SELECT value FROM system_config WHERE key = 'online_target_turnover_default'"))?.value || '0');
    const offlineDefault = parseFloat((await aqOne("SELECT value FROM system_config WHERE key = 'offline_target_turnover_default'"))?.value || '0');
    const btRow = await aqOne("SELECT value FROM system_config WHERE key = 'brand_target_stock_months'");
    const brandTargetCfg = (btRow && btRow.value) ? JSON.parse(btRow.value) : {}; // 品牌目标周转配置（Redragon=4,Netac=2,默认3）— 兼容回退用
    const dimRow = await aqOne("SELECT value FROM system_config WHERE key = 'dim_default_config'");
    const dimCfg = (dimRow && dimRow.value) ? JSON.parse(dimRow.value) : null; // A-Step1：多维目标周转配置（优先命中，未命中回退旧逻辑）

    // 获取所有有库存记录的SKU
    let invSql = `SELECT DISTINCT i.sku_code, i.country, i.warehouse, i.available_qty, i.in_transit_qty, i.pi_confirmed_unshipped_qty, i.po_unconfirmed_pi_qty, i.last_inbound_date, i.first_inbound_date, i.last_outbound_date, i.target_turnover_months FROM inventory i LEFT JOIN skus s ON i.sku_code = s.sku_code WHERE 1=1`;
    const invParams = [];
    if (country) { invSql += ' AND i.country = ?'; invParams.push(country); }
    if (warehouse) { invSql += ' AND i.warehouse = ?'; invParams.push(warehouse); }
    if (brand) { invSql += ' AND s.brand = ?'; invParams.push(brand); }
    // 订单预测排除寄售仓：寄售库存不生成预测行（不影响 inventory 中寄售库存本身）
    {
      const consignWh = getConsignmentWarehouseNames();
      if (consignWh.length > 0) {
        invSql += ' AND i.warehouse NOT IN (' + consignWh.map(() => '?').join(',') + ')';
        invParams.push(...consignWh);
      }
    }
    const inventoryItems = await aq(invSql, invParams);

    const now = new Date();
    const salesDate = salesOrderDateExpr('order_date');

    // 计算近4个月的年月
    const months = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        year: d.getFullYear(),
        month: String(d.getMonth() + 1).padStart(2, '0'),
        key: ['m1', 'm2', 'm3', 'm4'][i]
      });
    }

    // 品牌采购状态映射（停采品牌系统级规则）：品牌停采的 SKU 不要求命中 dim 规则、不阻止整页重算
    const bsRows = await aq('SELECT brand, procurement_status FROM brand_settings');
    const bstatus = {};
    for (const r of bsRows) bstatus[(r.brand || '').trim()] = (r.procurement_status || 'active');

    // ===== P0-1 集合化读取（消除 N+1）：一次性批量取 skus / existing_rs / 销量聚合 =====
    // 仅替换「读取」阶段为集合查询 + 内存 map；写阶段（UPDATE/INSERT）保持逐条不变。
    // 所有 SQL 使用 SQLite 方言 + IN(?,?,...) 占位列表，由 db-pg.js 翻译为 PG，两库通用。
    const genSkuCodes = inventoryItems.map(function(it) { return it.sku_code; });
    const genInPh = genSkuCodes.map(function() { return '?'; }).join(',');
    const skuRows = await aq('SELECT * FROM skus WHERE sku_code IN (' + genInPh + ')', genSkuCodes);
    const skuMap = {};
    for (const s of skuRows) skuMap[s.sku_code] = s;
    const existingRows = await aq('SELECT * FROM replenishment_suggestions WHERE sku_code IN (' + genInPh + ')', genSkuCodes);
    const existingMap = {};
    for (const r of existingRows) existingMap[r.sku_code + '|' + r.country + '|' + r.target_warehouse] = r;
    const m4Start = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0];
    const periodEnd = now.toISOString().split('T')[0];
    const periodStart = new Date(now.getTime() - Math.max(0, salesStatsDays - 1) * 86400000).toISOString().split('T')[0];
    const d30 = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
    const d90 = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0];
    // CHANNEL-ALLOCATION: 120天历史累计线上/线下销量（用于当前周期失真时的渠道比例修正）
    const d120 = new Date(now.getTime() - 120 * 86400000).toISOString().split('T')[0];
    // 销量聚合 A：按月 GROUP BY（m1=当月 … m4=3 个月前），online/offline 按现有谓词拆分
    // 国家维度：按 sku_code + country 分组，旧数据 country='' 不参与具体国家预测
    const monthlyRows = await aq(
      `SELECT sku_code,
              COALESCE(country, '') AS country,
              substr(${salesDate}, 1, 4) AS y,
              substr(${salesDate}, 6, 2) AS mo,
              COALESCE(SUM(quantity), 0) AS total,
              COALESCE(SUM(CASE WHEN (shop_platform LIKE '%线上%' OR lower(shop_platform) = 'online') THEN quantity END), 0) AS online,
              COALESCE(SUM(CASE WHEN (shop_platform LIKE '%线下%' OR lower(shop_platform) = 'offline') THEN quantity END), 0) AS offline
       FROM sales_records
       WHERE sku_code IN (${genInPh}) AND ${salesDate} >= ? AND ${salesDate} <= ? AND is_valid_order = 1
       GROUP BY sku_code, COALESCE(country, ''), y, mo`,
      genSkuCodes.concat([m4Start, periodEnd])
    );
    const monthlyMap = {};
    for (const r of monthlyRows) {
      let key = null;
      const ry = String(r.y);
      const rmo = String(r.mo);
      for (const m of months) { if (String(m.year) === ry && m.month === rmo) { key = m.key; break; } }
      if (!key) continue;
      const mapKey = r.sku_code + '|' + (r.country || '');
      if (!monthlyMap[mapKey]) monthlyMap[mapKey] = {};
      monthlyMap[mapKey][key] = { total: Number(r.total) || 0, online: Number(r.online) || 0, offline: Number(r.offline) || 0 };
    }
    // 销量聚合 B：按 sku + country GROUP BY，覆盖周期 / d30 / d90 / 累计 / 首售
    const aggRows = await aq(
      `SELECT sku_code,
              COALESCE(country, '') AS country,
              COALESCE(SUM(CASE WHEN ${salesDate} >= ? AND ${salesDate} <= ? THEN quantity END), 0) AS period_total,
              COALESCE(SUM(CASE WHEN ${salesDate} >= ? AND ${salesDate} <= ? AND (shop_platform LIKE '%线上%' OR lower(shop_platform) = 'online') THEN quantity END), 0) AS period_online,
              COALESCE(SUM(CASE WHEN ${salesDate} >= ? AND ${salesDate} <= ? AND (shop_platform LIKE '%线下%' OR lower(shop_platform) = 'offline') THEN quantity END), 0) AS period_offline,
              COALESCE(SUM(CASE WHEN ${salesDate} >= ? THEN quantity END), 0) AS s30,
              COALESCE(SUM(CASE WHEN ${salesDate} >= ? THEN quantity END), 0) AS s90,
              COALESCE(SUM(CASE WHEN ${salesDate} >= ? AND (shop_platform LIKE '%线上%' OR lower(shop_platform) = 'online') THEN quantity END), 0) AS s120_online,
              COALESCE(SUM(CASE WHEN ${salesDate} >= ? AND (shop_platform LIKE '%线下%' OR lower(shop_platform) = 'offline') THEN quantity END), 0) AS s120_offline,
              COALESCE(SUM(quantity), 0) AS ever_total,
              MIN(${salesDate}) AS first_sale,
              MAX(${salesDate}) AS last_sale
       FROM sales_records
       WHERE sku_code IN (${genInPh}) AND is_valid_order = 1
       GROUP BY sku_code, COALESCE(country, '')`,
      [periodStart, periodEnd, periodStart, periodEnd, periodStart, periodEnd, d30, d90, d120, d120].concat(genSkuCodes)
    );
    const aggMap = {};
    for (const r of aggRows) aggMap[r.sku_code + '|' + (r.country || '')] = r;

    // CHANNEL-ALLOCATION: 预加载国家表和渠道配置
    const countriesCache = await aq('SELECT id, name, code FROM countries ORDER BY sort_order');
    const channelConfigRows = await aq('SELECT sku_code, country_id, online_pct, offline_pct, status FROM sku_channel_configs WHERE status = ?', ['active']);
    const channelConfigMap = {};
    for (const r of channelConfigRows) channelConfigMap[r.sku_code + '|' + r.country_id] = r;

    // A-Step1 收口：预检——所有待处理 SKU 必须命中 dim_default_config，未命中则阻止重算（不偷偷用兜底值）
    const unmatchedMap = {};
    for (const inv of inventoryItems) {
      const skuPre = skuMap[inv.sku_code];
      if (!skuPre || skuPre.status === 'stopped') continue;
      if ((bstatus[(skuPre.brand || '').trim()] || 'active') === 'stopped') continue; // 品牌停采跳过预检
      const hit = getDimTurnover(skuPre.brand, inv.country, inv.warehouse, dimCfg);
      if (!hit) {
        const key = (skuPre.brand || '(无品牌)') + '|' + (inv.country || '') + '|' + (inv.warehouse || '');
        if (!unmatchedMap[key]) unmatchedMap[key] = { brand: skuPre.brand || '', country: inv.country || '', warehouse: inv.warehouse || '', count: 0 };
        unmatchedMap[key].count++;
      }
    }
    const unmatchedList = Object.values(unmatchedMap);
    if (unmatchedList.length) {
      return { unmatched: unmatchedList };
    }

    // P0-2 批量写：列定义（RS_SET_COLS 已提升至模块作用域，full generate 与刷新引擎共用）
    const RS_INSERT_COLS = [
      'id', 'sku_code', 'country', 'target_warehouse', 'available_qty', 'in_transit_qty',
      'pi_confirmed_unshipped_qty', 'po_unconfirmed_pi_qty', 'total_inventory_pool',
      'sales_m1', 'sales_m2', 'sales_m3', 'sales_m4', 'avg_sales_4m', 'avg_sales_period', 'online_avg_sales_period', 'offline_avg_sales_period',
      'online_sales_m1', 'online_sales_m2', 'online_sales_m3', 'online_sales_m4', 'online_avg_sales_4m',
      'offline_sales_m1', 'offline_sales_m2', 'offline_sales_m3', 'offline_sales_m4', 'offline_avg_sales_4m',
      'current_turnover_months', 'suggested_qty', 'moq_qty', 'carton_adjusted_qty',
      'online_suggested_qty', 'offline_suggested_qty', 'other_suggested_qty',
      'after_order_turnover_months', 'online_after_order_turnover_months', 'offline_after_order_turnover_months',
      'target_stock_months', 'risk_level', 'arrival_month', 'suggestion',
      'is_new_product', 'lifecycle_status', 'sales_group', 'user_adjusted_qty', 'generate_po',
      'online_target_turnover', 'offline_target_turnover',
      'online_target_stock', 'offline_target_stock', 'other_target_stock', 'final_order_qty',
      'sales_status', 'risk_tags', 'sales_reason', 'action', 'ai_business_advice',
      'channel_ratio_source', 'channel_allocation_status', 'resolved_online_pct', 'resolved_at'
    ];

    // 列类型：UPDATE ... FROM (VALUES ...) 时 PG 会把无类型 VALUES 列推断为 text，
    // 导致 integer/text 类型冲突。显式声明 CTE 列类型可让参数正确转型。
    // 用 current_schema() 兼容隔离 schema（p0_iso）与生产 schema（public）。
    async function getRsColTypesAsync(aq) {
      const rows = await aq("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'replenishment_suggestions'");
      const map = {};
      (rows || []).forEach(r => {
        const t = r.data_type;
        map[r.column_name] = t === 'integer' ? 'integer' : t === 'double precision' ? 'double precision' : 'text';
      });
      return map;
    }

      const batchRows = [];
      inventoryItems.forEach(inv => {
        const sku = skuMap[inv.sku_code];
        if (!sku) return;
        if (sku.status === 'stopped') return;
        // 品牌停采（系统级规则）：仍写入预测表保持可见，但建议采购强制为 0、不参与补货、不要求命中 dim 规则
        const brandStopped = (bstatus[(sku.brand || '').trim()] || 'active') === 'stopped';

        const existing_rs = existingMap[inv.sku_code + '|' + inv.country + '|' + inv.warehouse] || null;
        batchRows.push(computeSuggestionForTarget({
          inv, sku, existing_rs, brandStopped,
          months, monthlyMap, aggMap,
          targetMonths, leadTimeMonths, salesStatsDays, dimCfg,
          channelConfigMap, countriesCache, now
        }));
      });

      // ===== 单条批量写（同一事务内，async pg client） =====
      // 循环内仅收集计算结果（batchRows），此处统一写入：
      //  (A) 已有行按 id 单条批量 UPDATE（UPDATE ... FROM (VALUES ...) AS v(id, <cols>) WHERE t.id = v.id）
      //  (B) 新行单条多行 INSERT
      // 任一 SQL 失败 -> withGenerateClient 自动 ROLLBACK，保证整次原子。
      const colTypes = await getRsColTypesAsync(aq);
      const updRows = batchRows.filter(r => r.mode === 'update');
      const insRows = batchRows.filter(r => r.mode === 'insert');

      // (A) 批量 UPDATE 已有记录（按 id）
      // PG 的 VALUES 别名列表只能写列名、不能写类型，故在 SET 侧对每列显式转型（v.col::type），
      // 把无类型 VALUES 列正确转成 integer / double precision / text。
      if (updRows.length > 0) {
        const setClause = RS_SET_COLS.map(c => `${c} = v.${c}::${colTypes[c] || 'text'}`).join(', ');
        const valueRows = updRows.map(r => '(' + Array(r.values.length + 1).fill('?').join(', ') + ')').join(', ');
        const params = [];
        updRows.forEach(r => { params.push(r.id); r.values.forEach(v => params.push(v)); });
        await run(
          `UPDATE replenishment_suggestions t SET ${setClause} ` +
          `FROM (VALUES ${valueRows}) AS v(id, ${RS_SET_COLS.join(', ')}) ` +
          `WHERE t.id = v.id`,
          params
        );
      }

      // (B) 批量 INSERT 新记录
      if (insRows.length > 0) {
        const placeholders = insRows.map(r => '(' + r.values.map(() => '?').join(', ') + ')').join(', ');
        const params = [];
        insRows.forEach(r => r.values.forEach(v => params.push(v)));
        await run(
          `INSERT INTO replenishment_suggestions (${RS_INSERT_COLS.join(', ')}) VALUES ${placeholders}`,
          params
        );
      }

      return { count: inventoryItems.length };
    });

    if (result && result.unmatched) {
      return res.json({ success: false, unmatched: result.unmatched });
    }
    res.json({ success: true, count: result ? result.count : 0 });
  } catch (e) {
    console.error('[GENERATE-ERR]', e && e.code ? ('code=' + e.code) : (e && e.message ? e.message : e));
    res.status(500).json({ error: '订单预测生成失败，请稍后重试或联系管理员' });
  } finally {
    generateInProgress = false;
  }
}));

// 更新补货建议（目标周转、最终下单数量、备注等）
app.put('/api/replenishment-suggestions/:id', requireApiPermission('replenishment_edit'), asyncHandler((req, res) => {
  try {
    const d = req.body;
    const fields = [];
    const values = [];

    // generate_po
    if (d.generate_po !== undefined) { fields.push('generate_po = ?'); values.push(parseInt(d.generate_po) || 0); }

    // 线上目标周转 → 重算线上目标库存 + 三分量 + 系统建议补货 + 订单后周转（与 generate 同源）
    if (d.online_target_turnover !== undefined) {
      const rs = queryOne('SELECT online_avg_sales_period, offline_target_stock, total_inventory_pool, avg_sales_period, sales_status, risk_tags, final_order_qty, lifecycle_status FROM replenishment_suggestions WHERE id = ?', [req.params.id]);
      const onlineTurn = parseFloat(d.online_target_turnover) || 0;
      const onlineStock = Math.round((rs.online_avg_sales_period || 0) * onlineTurn);
      const pool = rs.total_inventory_pool || 0;
      const avgPeriod = rs.avg_sales_period || 0;
      const blocked = shouldBlockReplenish(rs.sales_status || '', rs.risk_tags || '');
      const isStopped = (rs.sales_status || '') === '停采/清库存';
      const parts = calculateSuggestion(onlineStock, rs.offline_target_stock || 0, pool, blocked || isStopped);
      const onComp = parts.online_suggested_qty;
      const offComp = parts.offline_suggested_qty;
      const otherComp = 0;
      const suggestedQty = parts.suggested_qty;
      const foq = (rs.final_order_qty != null && rs.final_order_qty >= 0) ? rs.final_order_qty : suggestedQty;
      const afterOrder = avgPeriod > 0 ? (pool + foq) / avgPeriod : 99;
      fields.push('online_target_turnover = ?', 'online_target_stock = ?', 'online_suggested_qty = ?', 'offline_suggested_qty = ?', 'other_suggested_qty = ?', 'suggested_qty = ?', 'after_order_turnover_months = ?', 'suggestion = ?');
      values.push(onlineTurn, onlineStock, onComp, offComp, otherComp, suggestedQty, Math.round(afterOrder * 10) / 10, buildSuggestionText(rs.sales_status, rs.lifecycle_status, suggestedQty, isStopped));
    }

    // 线下目标周转 → 重算线下目标库存 + 三分量 + 系统建议补货 + 订单后周转（与 generate 同源）
    if (d.offline_target_turnover !== undefined) {
      const rs = queryOne('SELECT offline_avg_sales_period, online_target_stock, total_inventory_pool, avg_sales_period, sales_status, risk_tags, final_order_qty, lifecycle_status FROM replenishment_suggestions WHERE id = ?', [req.params.id]);
      const offlineTurn = parseFloat(d.offline_target_turnover) || 0;
      const offlineStock = Math.round((rs.offline_avg_sales_period || 0) * offlineTurn);
      const pool = rs.total_inventory_pool || 0;
      const avgPeriod = rs.avg_sales_period || 0;
      const blocked = shouldBlockReplenish(rs.sales_status || '', rs.risk_tags || '');
      const isStopped = (rs.sales_status || '') === '停采/清库存';
      const parts = calculateSuggestion(rs.online_target_stock || 0, offlineStock, pool, blocked || isStopped);
      const onComp = parts.online_suggested_qty;
      const offComp = parts.offline_suggested_qty;
      const otherComp = 0;
      const suggestedQty = parts.suggested_qty;
      const foq = (rs.final_order_qty != null && rs.final_order_qty >= 0) ? rs.final_order_qty : suggestedQty;
      const afterOrder = avgPeriod > 0 ? (pool + foq) / avgPeriod : 99;
      fields.push('offline_target_turnover = ?', 'offline_target_stock = ?', 'online_suggested_qty = ?', 'offline_suggested_qty = ?', 'other_suggested_qty = ?', 'suggested_qty = ?', 'after_order_turnover_months = ?', 'suggestion = ?');
      values.push(offlineTurn, offlineStock, onComp, offComp, otherComp, suggestedQty, Math.round(afterOrder * 10) / 10, buildSuggestionText(rs.sales_status, rs.lifecycle_status, suggestedQty, isStopped));
    }

    // 最终下单数量 → 重算订单后周转
    if (d.final_order_qty !== undefined) {
      const rs = queryOne('SELECT total_inventory_pool, avg_sales_period, online_avg_sales_period, offline_avg_sales_period FROM replenishment_suggestions WHERE id = ?', [req.params.id]);
      const foq = parseInt(d.final_order_qty) || 0;
      const pool = rs.total_inventory_pool || 0;
      const afterOrder = (rs.avg_sales_period || 0) > 0 ? (pool + foq) / rs.avg_sales_period : 99;
      const onlineAfter = (rs.online_avg_sales_period || 0) > 0 ? (pool + foq) / rs.online_avg_sales_period : 99;
      const offlineAfter = (rs.offline_avg_sales_period || 0) > 0 ? (pool + foq) / rs.offline_avg_sales_period : 99;
      fields.push('final_order_qty = ?', 'after_order_turnover_months = ?', 'online_after_order_turnover_months = ?', 'offline_after_order_turnover_months = ?');
      values.push(foq, Math.round(afterOrder * 10) / 10, Math.round(onlineAfter * 10) / 10, Math.round(offlineAfter * 10) / 10);
    }

    // 线上建议采购数量（手动改线上目标库存）→ 重算线上分量 + 三分量（与 generate 同源）
    if (d.online_target_stock !== undefined) {
      const rs = queryOne('SELECT avg_sales_period, total_inventory_pool, offline_target_stock, sales_status, risk_tags, final_order_qty, lifecycle_status FROM replenishment_suggestions WHERE id = ?', [req.params.id]);
      const newOnlineStock = parseInt(d.online_target_stock) || 0;
      const pool = rs.total_inventory_pool || 0;
      const avgPeriod = rs.avg_sales_period || 0;
      const blocked = shouldBlockReplenish(rs.sales_status || '', rs.risk_tags || '');
      const isStopped = (rs.sales_status || '') === '停采/清库存';
      const parts = calculateSuggestion(newOnlineStock, rs.offline_target_stock || 0, pool, blocked || isStopped);
      const onComp = parts.online_suggested_qty;
      const offComp = parts.offline_suggested_qty;
      const otherComp = 0;
      const suggestedQty = parts.suggested_qty;
      const foq = (rs.final_order_qty != null && rs.final_order_qty >= 0) ? rs.final_order_qty : suggestedQty;
      const afterOrder = avgPeriod > 0 ? (pool + foq) / avgPeriod : 99;
      fields.push('online_target_stock = ?', 'online_suggested_qty = ?', 'offline_suggested_qty = ?', 'other_suggested_qty = ?', 'suggested_qty = ?', 'after_order_turnover_months = ?', 'suggestion = ?');
      values.push(newOnlineStock, onComp, offComp, otherComp, suggestedQty, Math.round(afterOrder * 10) / 10, buildSuggestionText(rs.sales_status, rs.lifecycle_status, suggestedQty, isStopped));
    }

    // 线下建议采购数量（手动改线下目标库存）→ 重算线下分量 + 三分量（与 generate 同源）
    if (d.offline_target_stock !== undefined) {
      const rs = queryOne('SELECT avg_sales_period, total_inventory_pool, online_target_stock, sales_status, risk_tags, final_order_qty, lifecycle_status FROM replenishment_suggestions WHERE id = ?', [req.params.id]);
      const newOfflineStock = parseInt(d.offline_target_stock) || 0;
      const pool = rs.total_inventory_pool || 0;
      const avgPeriod = rs.avg_sales_period || 0;
      const blocked = shouldBlockReplenish(rs.sales_status || '', rs.risk_tags || '');
      const isStopped = (rs.sales_status || '') === '停采/清库存';
      const parts = calculateSuggestion(rs.online_target_stock || 0, newOfflineStock, pool, blocked || isStopped);
      const onComp = parts.online_suggested_qty;
      const offComp = parts.offline_suggested_qty;
      const otherComp = 0;
      const suggestedQty = parts.suggested_qty;
      const foq = (rs.final_order_qty != null && rs.final_order_qty >= 0) ? rs.final_order_qty : suggestedQty;
      const afterOrder = avgPeriod > 0 ? (pool + foq) / avgPeriod : 99;
      fields.push('offline_target_stock = ?', 'online_suggested_qty = ?', 'offline_suggested_qty = ?', 'other_suggested_qty = ?', 'suggested_qty = ?', 'after_order_turnover_months = ?', 'suggestion = ?');
      values.push(newOfflineStock, onComp, offComp, otherComp, suggestedQty, Math.round(afterOrder * 10) / 10, buildSuggestionText(rs.sales_status, rs.lifecycle_status, suggestedQty, isStopped));
    }

    // 调整原因
    if (d.adjustment_reason !== undefined) {
      fields.push('adjustment_reason = ?');
      values.push(d.adjustment_reason);
    }

    // 备注
    if (d.online_remark !== undefined) { fields.push('online_remark = ?'); values.push(d.online_remark); }
    if (d.offline_remark !== undefined) { fields.push('offline_remark = ?'); values.push(d.offline_remark); }

    // 在途库存人工渠道分配（仅未分配SKU使用，存储人工指定的线上/线下在途数量）
    if (d.manual_online_transit_qty !== undefined) { fields.push('manual_online_transit_qty = ?'); values.push(parseInt(d.manual_online_transit_qty) || 0); }
    if (d.manual_offline_transit_qty !== undefined) { fields.push('manual_offline_transit_qty = ?'); values.push(parseInt(d.manual_offline_transit_qty) || 0); }

    if (fields.length === 0) return res.json({ success: true });
    values.push(req.params.id);
    run(`UPDATE replenishment_suggestions SET ${fields.join(', ')} WHERE id = ?`, values);
    const updated = queryOne('SELECT * FROM replenishment_suggestions WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== PO 管理 ====================
app.get('/api/purchase-orders', requireApiPermission('po_view'), asyncHandler((req, res) => {
  const { status, keyword, supplier_id } = req.query;
  let sql = `SELECT po.*, (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) as item_count,
    CASE WHEN EXISTS(SELECT 1 FROM purchase_order_items WHERE po_id = po.id AND (unit_price IS NULL OR unit_price = 0)) THEN 'pending_fob' ELSE 'confirmed' END as price_status
    FROM purchase_orders po WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND po.po_status = ?'; params.push(status); }
  if (supplier_id) { sql += ' AND po.supplier_id = ?'; params.push(supplier_id); }
  if (keyword) { sql += ' AND (po.po_no LIKE ? OR po.supplier_name LIKE ? OR po.brand LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY po.created_at DESC';
  res.json(query(sql, params).rows);
}));

// PO 待审批列表（审批中心 / 待我审批）
// 仅列表查询，JOIN approval_records + purchase_orders + 明细累加总数量；
// 不动 submit-approval / approve 端点，不写任何状态。
// 注册在 GET /api/purchase-orders/:id 之前，避免被 :id 参数路由抢匹配。
app.get('/api/purchase-orders/pending-approval', requireApiPermission('po_approve'), asyncHandler((req, res) => {
  try {
    const rows = query(`
      SELECT
        ar.id              AS approval_id,
        ar.business_id     AS po_id,
        ar.business_code   AS po_no,
        ar.submitter_name,
        ar.current_level,
        ar.max_level,
        ar.approvers,
        ar.approval_history,
        ar.created_at      AS submitted_at,
        po.brand,
        po.country,
        po.target_warehouse,
        po.total_amount,
        po.currency,
        po.po_status,
        (SELECT COALESCE(SUM(poi.po_qty), 0) FROM purchase_order_items poi WHERE poi.po_id = po.id) AS total_qty
      FROM approval_records ar
      JOIN purchase_orders po ON po.id = ar.business_id
      WHERE ar.business_type = 'po' AND ar.status = 'pending'
      ORDER BY ar.created_at DESC
    `).rows;
    // —— CC V1：组装每个审批实例的抄送人（通用参与人表，participant_type='cc'；仅展示，不影响审批逻辑/权限/状态机） ——
    const ccIds = rows.map(r => r.approval_id);
    const ccMap = {};
    if (ccIds.length > 0) {
      const ph = ccIds.map(() => '?').join(',');
      const ccRows = query(`SELECT business_id, user_id, user_name FROM business_participants WHERE business_type='approval' AND participant_type='cc' AND business_id IN (${ph})`, ccIds).rows;
      for (const c of ccRows) {
        (ccMap[c.business_id] = ccMap[c.business_id] || []).push({ user_id: c.user_id, user_name: c.user_name });
      }
    }
    for (const r of rows) { r.cc_users = ccMap[r.approval_id] || []; }
    // —— N3: 待我审批按当前登录用户 ID 过滤（仅可见性，不改状态机/权限） ——
    // 仅当前级次节点的 approver_user_id 等于当前用户时才可见；旧数据缺 approver_user_id 不进入“待我审批”，避免静默错绑。
    if (req.query.mine === '1' && req.currentUserId) {
      const uid = req.currentUserId;
      const filtered = [];
      for (const r of rows) {
        let approverList = [];
        try { approverList = JSON.parse(r.approvers || '[]'); } catch (e) { approverList = []; }
        const cur = approverList.find(a => a.level === r.current_level);
        if (cur && cur.approver_user_id === uid) filtered.push(r);
      }
      return res.json(filtered);
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.get('/api/purchase-orders/:id', requireApiPermission('po_view'), asyncHandler((req, res) => {
  const po = queryOne('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]);
  if (!po) return res.status(404).json({ error: 'PO不存在' });
  const items = query('SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY created_at', [req.params.id]).rows;
  res.json({ ...po, items });
}));

app.post('/api/purchase-orders', requireApiPermission('po_create'), asyncHandler((req, res) => {
  try {
    const d = req.body;
    if (!d.supplier_name) return res.status(400).json({ error: '供应商不能为空' });
    const currency = d.currency;
    if (currency !== 'RMB' && currency !== 'USD') {
      return res.status(400).json({ error: '采购币种必须为 RMB 或 USD' });
    }
    const priceCol = currency === 'RMB' ? 'purchase_price_rmb' : 'purchase_price_usd';
    const poId = genId('po');
    const poNo = d.po_no || `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

    // 价格校验：SKU 必须存在；价格缺失不阻断创建，记入 warnings
    const invalidItems = [];
    const priceWarnings = [];
    const itemRows = [];
    if (d.items && d.items.length > 0) {
      for (const item of d.items) {
        const sku = queryOne('SELECT sku_code, ' + priceCol + ' FROM skus WHERE sku_code = ?', [item.sku_code]);
        if (!sku) { invalidItems.push({ sku_code: item.sku_code, currency, reason: 'SKU不存在' }); continue; }
        const price = Number(sku[priceCol]);
        if (isNaN(price) || price <= 0) {
          priceWarnings.push({ sku_code: item.sku_code, currency, reason: currency + '采购价缺失，请后续补充FOB价格' });
        }
        const unitPrice = (isNaN(price) || price <= 0) ? 0 : price;
        itemRows.push({ sku_code: item.sku_code, po_qty: item.po_qty || 0, unit_price: unitPrice, remark: item.remark || '', forecast: item.forecast_turnover_months || 0 });
      }
    }
    // SKU 不存在仍为硬阻断（数据完整性问题，非价格问题）
    if (invalidItems.length > 0) {
      return res.status(400).json({ error: 'PO创建失败：SKU不存在', invalid_items: invalidItems });
    }

    let totalAmount = 0;
    transaction(async () => {
      run(`INSERT INTO purchase_orders (id, po_no, supplier_id, supplier_name, brand, country, target_warehouse, po_date, expected_delivery, currency, total_amount, created_by, created_by_name, po_status, approval_status, from_suggestion, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [poId, poNo, d.supplier_id || '', d.supplier_name, d.brand || '', d.country || '', d.target_warehouse || '', d.po_date || new Date().toISOString().split('T')[0], d.expected_delivery || '', currency, 0, d.created_by || '', d.created_by_name || '', 'draft', 'pending', d.from_suggestion || 0, d.remark || '']);

      if (itemRows.length > 0) {
        itemRows.forEach(it => {
          const amount = (it.po_qty || 0) * it.unit_price;
          totalAmount += amount;
          run(`INSERT INTO purchase_order_items (id, po_id, po_no, sku_code, po_qty, unit_price, po_amount, transferred_pi_qty, untransferred_pi_qty, forecast_turnover_months, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('poi'), poId, poNo, it.sku_code, it.po_qty, it.unit_price, amount, 0, it.po_qty, it.forecast, it.remark]);
        });
        run('UPDATE purchase_orders SET total_amount = ? WHERE id = ?', [totalAmount, poId]);
      }
      // 新建 PO 后刷新在途字段（po_unconfirmed_pi_qty 等）
      await updateInventoryTransitData();
    });
    res.json({ id: poId, po_no: poNo, ...d, currency, total_amount: totalAmount, price_warnings: priceWarnings });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.put('/api/purchase-orders/:id', requireApiPermission('po_create'), asyncHandler((req, res) => {
  try {
    const d = req.body;
    const { id } = req.params;
    // 读取已存在 PO 表头币种：币种属于价格快照，必须锁定；任何抓价均以数据库已锁定币种为准
    const origPo = queryOne('SELECT id, currency FROM purchase_orders WHERE id = ?', [id]);
    if (!origPo) return res.status(404).json({ error: 'PO不存在' });
    const origCurrency = origPo.currency;
    // 表头币种锁定：已创建 PO 的币种不可修改，写操作前拒绝（防止 RMB/USD 价格快照错配）
    if (d.currency !== undefined && d.currency !== origCurrency) {
      return res.status(400).json({ error: 'PO 创建后币种不可修改，如需更换币种请新建 PO' });
    }
    const fields = [];
    const values = [];
    // 注意：currency 已从可更新字段中移除，PUT 永远沿用数据库已锁定的 origCurrency
    ['supplier_id', 'supplier_name', 'brand', 'country', 'target_warehouse', 'expected_delivery', 'remark'].forEach(f => {
      if (d[f] !== undefined) { fields.push(`${f} = ?`); values.push(d[f]); }
    });
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    run(`UPDATE purchase_orders SET ${fields.join(', ')} WHERE id = ?`, values);

    if (d.items) {
      // 币种来源：始终使用数据库已锁定的 PO 币种，绝不信任请求体 currency
      const poCurrency = origCurrency;
      const priceCol = poCurrency === 'RMB' ? 'purchase_price_rmb' : (poCurrency === 'USD' ? 'purchase_price_usd' : null);
      // 读取现有明细，用稳定 id 识别原明细
      const existing = query('SELECT id, sku_code, unit_price, transferred_pi_qty FROM purchase_order_items WHERE po_id = ?', [id]).rows;
      const existMap = {};
      existing.forEach(e => { existMap[e.id] = e; });
      const invalidItems = [];
      const toUpsert = [];
      const seenIds = new Set();
      for (const item of d.items) {
        const ex = (item.id && existMap[item.id]) ? existMap[item.id] : null;
        let unitPrice, rowId;
        if (ex && ex.sku_code === item.sku_code) {
          // 同 SKU：保留历史快照，不重新抓价
          unitPrice = ex.unit_price;
          rowId = ex.id;
          seenIds.add(ex.id);
        } else {
          // 新增 SKU 或 更换 SKU：按 PO 表头币种抓当前对应采购价
          if (!priceCol) { invalidItems.push({ sku_code: item.sku_code, reason: 'PO币种缺失' }); continue; }
          const sku = queryOne('SELECT sku_code, ' + priceCol + ' FROM skus WHERE sku_code = ?', [item.sku_code]);
          if (!sku) { invalidItems.push({ sku_code: item.sku_code, currency: poCurrency, reason: 'SKU不存在' }); continue; }
          const price = Number(sku[priceCol]);
          // 价格缺失不阻断，使用 0；后续可在 PO 编辑中补充
          unitPrice = (isNaN(price) || price <= 0) ? 0 : price;
          rowId = genId('poi'); // 换新行，旧行稍后删除
        }
        toUpsert.push({ id: rowId, sku_code: item.sku_code, po_qty: item.po_qty || 0, unit_price: unitPrice, remark: item.remark || '', forecast: item.forecast_turnover_months || 0 });
      }
      // SKU 不存在仍为硬阻断（数据完整性问题，非价格问题）
      if (invalidItems.length > 0) {
        return res.status(400).json({ error: 'PO更新失败：SKU不存在', invalid_items: invalidItems });
      }
      // 删除被移除的明细（原 id 未出现）
      const removeIds = existing.filter(e => !seenIds.has(e.id)).map(e => e.id);
      if (removeIds.length > 0) {
        run('DELETE FROM purchase_order_items WHERE id IN (' + removeIds.map(() => '?').join(',') + ')', removeIds);
      }
      let totalAmount = 0;
      toUpsert.forEach(it => {
        const amount = (it.po_qty || 0) * it.unit_price;
        totalAmount += amount;
        if (existMap[it.id]) {
          const transferred = existMap[it.id].transferred_pi_qty || 0;
          run('UPDATE purchase_order_items SET po_qty=?, unit_price=?, po_amount=?, untransferred_pi_qty=?, forecast_turnover_months=?, remark=? WHERE id=?',
            [it.po_qty, it.unit_price, amount, (it.po_qty || 0) - transferred, it.forecast, it.remark, it.id]);
        } else {
          run(`INSERT INTO purchase_order_items (id, po_id, po_no, sku_code, po_qty, unit_price, po_amount, transferred_pi_qty, untransferred_pi_qty, forecast_turnover_months, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [it.id, id, d.po_no || '', it.sku_code, it.po_qty, it.unit_price, amount, 0, it.po_qty, it.forecast, it.remark]);
        }
      });
      run('UPDATE purchase_orders SET total_amount = ? WHERE id = ?', [totalAmount, id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.delete('/api/purchase-orders/:id', requireApiPermission('po_create'), asyncHandler(async (req, res) => {
  try {
    const po = queryOne('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]);
    if (!po) return res.status(404).json({ error: 'PO不存在' });
    // 守卫：仅允许 draft，或 transferred_pi/partial_pi 且无活跃(非cancelled/completed) PI
    let allow = po.po_status === 'draft';
    if (!allow) {
      const hasActivePi = queryOne("SELECT 1 FROM proforma_invoices WHERE related_po_id = ? AND pi_status NOT IN ('cancelled', 'completed')", [po.id]);
      allow = ['transferred_pi', 'partial_pi'].includes(po.po_status) && !hasActivePi;
    }
    if (!allow) {
      return res.status(400).json({ error: '该 PO 当前状态不允许硬删除；请先作废，或先作废其关联的活跃 PI' });
    }
    transaction(() => {
      run('DELETE FROM purchase_order_items WHERE po_id = ?', [req.params.id]);
      run('DELETE FROM purchase_orders WHERE id = ?', [req.params.id]);
    });
    await updateInventoryTransitData(); // 删除后回落 po_unconfirmed_pi_qty
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// PO 软作废（置 cancelled + 必填原因 + 回写在途）
app.post('/api/purchase-orders/:id/void', requireApiPermission('po_create'), asyncHandler(async (req, res) => {
  try {
    const { void_reason } = req.body;
    if (!void_reason) return res.status(400).json({ error: '作废原因不能为空' });
    const po = queryOne('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]);
    if (!po) return res.status(404).json({ error: 'PO不存在' });
    if (po.po_status === 'cancelled') return res.status(400).json({ error: '该 PO 已作废，不能重复作废' });
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const newRemark = (po.remark ? po.remark + '\n' : '') + `[作废 ${ts} by ${req.currentUserName || ''}] 原因: ${void_reason}`;
    run("UPDATE purchase_orders SET po_status = 'cancelled', remark = ?, updated_at = datetime('now') WHERE id = ?", [newRemark, po.id]);
    await updateInventoryTransitData();
    logOperation({ operator_id: req.currentUserId, operator_name: req.currentUserName, page: 'purchase_order', operation_type: 'void', target_ids: [po.id], affected_count: 1, old_values: { po_status: po.po_status }, new_values: { po_status: 'cancelled', void_reason }, reason: void_reason, triggered_recalc: 0, is_rollbackable: 0 });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// PO 提交审批
app.post('/api/purchase-orders/:id/submit-approval', requireApiPermission('po_create'), asyncHandler((req, res) => {
  try {
    const po = queryOne('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]);
    if (!po) return res.status(404).json({ error: 'PO不存在' });
    if (po.po_status !== 'draft') return res.status(400).json({ error: '只有草稿状态才能提交审批' });

    // —— N1/N2: 读取审批流配置，生成「具体审批用户」快照（不新增引擎/条件/金额规则） ——
    // 审批责任主体是具体系统用户（approver_user_id）；approver_role_id 仅作快照辅助，不用于责任判断。
    const flow = queryOne("SELECT id, levels, is_enabled FROM approval_flows WHERE business_type = 'po' AND is_enabled = 1 LIMIT 1");
    let maxLevel = 0, approvers = [];
    if (flow && flow.levels) {
      let levels = [];
      try { levels = JSON.parse(flow.levels); } catch (e) { levels = []; }
      if (Array.isArray(levels) && levels.length > 0) {
        // 提交时再次校验每个配置审批用户仍有效（存在/active/已绑定角色/po_approve）；不信任历史快照
        const built = [];
        let ok = true, badMsg = '';
        for (const lv of levels) {
          const lvl = Number(lv.level);
          const uid = (lv.approver_user_id || '').trim();
          if (!uid) { ok = false; badMsg = '第 ' + lvl + ' 级审批人未配置具体用户'; break; }
          const u = queryOne('SELECT id, name, role_id, status FROM users WHERE id = ?', [uid]);
          if (!u) { ok = false; badMsg = '第 ' + lvl + ' 级审批用户不存在'; break; }
          if (u.status !== 'active') { ok = false; badMsg = '第 ' + lvl + ' 级审批用户「' + u.name + '」已停用'; break; }
          if (!u.role_id) { ok = false; badMsg = '第 ' + lvl + ' 级审批用户「' + u.name + '」未绑定角色'; break; }
          const role = queryOne('SELECT id, name, permissions FROM roles WHERE id = ?', [u.role_id]);
          if (!role) { ok = false; badMsg = '第 ' + lvl + ' 级审批用户「' + u.name + '」绑定的角色不存在'; break; }
          let perms = [];
          try { perms = JSON.parse(role.permissions || '[]'); } catch (e) { perms = []; }
          if (!perms.includes('po_approve')) { ok = false; badMsg = '第 ' + lvl + ' 级审批用户「' + u.name + '」当前不具备 po_approve 权限'; break; }
          built.push({ level: lvl, approver_user_id: u.id, approver_name: u.name, approver_role_id: u.role_id });
        }
        if (ok) { maxLevel = built.length; approvers = built; }
        else {
          return res.status(400).json({ error: '审批流配置无效，无法提交：' + badMsg + '。请先在系统管理修正 PO 审批流配置（指定具体审批人）。' });
        }
      }
    }
    // 无有效启用配置时拒绝提交，不回退为“任意 po_approve 用户可审”（不重新引入角色池审批作为兜底）
    if (!approvers || maxLevel < 1) {
      return res.status(400).json({ error: 'PO 审批流未配置或未启用，无法提交审批。请先在系统管理（审批流管理）完成 PO 审批流的具体审批人配置。' });
    }

    // —— CC V1：可选抄送人；仅接受存在且 active 的系统用户，非法值直接拒绝（保证数据干净）；空数组即无抄送 ——
    const ccUserIds = Array.isArray(req.body.cc_user_ids) ? req.body.cc_user_ids : [];
    const ccList = [];
    if (ccUserIds.length > 0) {
      const seen = new Set();
      for (const raw of ccUserIds) {
        const uid = (raw || '').toString().trim();
        if (!uid || seen.has(uid)) continue;
        const u = queryOne('SELECT id, name, status FROM users WHERE id = ?', [uid]);
        if (!u) return res.status(400).json({ error: '抄送人「' + uid + '」不存在' });
        if (u.status !== 'active') return res.status(400).json({ error: '抄送人「' + (u.name || uid) + '」已停用，无法抄送' });
        seen.add(uid);
        ccList.push({ id: u.id, name: u.name });
      }
    }

    const approvalId = genId('appr');
    // 同事务原子写入：审批实例 + CC 关系 + PO 状态；任一步失败整体回滚，避免半截数据
    transaction(() => {
      run(`INSERT INTO approval_records (id, business_type, business_id, business_code, submitter_id, submitter_name, current_level, max_level, approvers, approval_history, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [approvalId, 'po', req.params.id, po.po_no, req.currentUserId, req.body.submitter_name || '', 1, maxLevel, JSON.stringify(approvers), JSON.stringify([{ level: 0, action: 'submit', user_id: req.currentUserId, user_name: req.body.submitter_name || '', time: new Date().toISOString(), remark: '提交审批' }]), 'pending']);
      // CC 关系落通用参与人表（participant_type='cc'）；无 CC 时跳过，保持原审批体验
      for (const c of ccList) {
        run(`INSERT INTO business_participants (id, business_type, business_id, participant_type, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)`,
          [genId('bp'), 'approval', approvalId, 'cc', c.id, c.name]);
      }
      run(`UPDATE purchase_orders SET po_status = ?, approval_status = ? WHERE id = ?`, ['pending_approval', 'pending', req.params.id]);
    });
    // —— FEISHU-NOTIFY-01：事务完成后 best-effort 通知（不阻塞、不影响审批结果）——
    notifyApprovalParticipants(approvalId, 'submit', { po_no: po.po_no }).catch(() => {});
    res.json({ success: true, approval_id: approvalId });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// PO 审批操作
app.post('/api/purchase-orders/:id/approve', requireApiPermission('po_approve'), asyncHandler((req, res) => {
  try {
    const { action, remark } = req.body; // action: approve / reject / withdraw
    if (!['approve', 'reject', 'withdraw'].includes(action)) {
      return res.status(400).json({ error: '非法的审批动作' });
    }
    const po = queryOne('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]);
    if (!po) return res.status(404).json({ error: 'PO不存在' });

    const approval = queryOne('SELECT * FROM approval_records WHERE business_id = ? AND business_type = ? ORDER BY created_at DESC LIMIT 1', [req.params.id, 'po']);
    if (!approval) return res.status(400).json({ error: '未找到审批记录' });

    // —— N4: PO approve/reject 双重校验（仅 PO 入口；不扩展到付款/其他业务；不重构状态模型；withdraw 保持历史现状不加节点校验） ——
    if (action === 'approve' || action === 'reject') {
      if (approval.status !== 'pending') {
        return res.status(403).json({ error: '当前审批实例不在可审批状态' });
      }
      const curLevel = approval.current_level;
      if (!Number.isInteger(curLevel) || curLevel < 1 || curLevel > approval.max_level) {
        return res.status(403).json({ error: '当前审批级次无效' });
      }
      let approverList = [];
      try { approverList = JSON.parse(approval.approvers || '[]'); } catch (e) { approverList = []; }
      const curNode = approverList.find(a => a.level === curLevel);
      if (!curNode || !curNode.approver_user_id) {
        return res.status(403).json({ error: '当前级次未配置具体审批人，无法审批' });
      }
      if (curNode.approver_user_id !== req.currentUserId) {
        return res.status(403).json({ error: '您不是当前审批级次的指定审批人，无权审批' });
      }
    }

    const history = JSON.parse(approval.approval_history || '[]');
    const user = queryOne('SELECT name FROM users WHERE id = ?', [req.currentUserId]);
    const userName = user ? user.name : '';

    if (action === 'approve') {
      const nextLevel = (approval.current_level || 1) + 1;
      if (nextLevel > approval.max_level) {
        // 最终审批通过
        history.push({ level: approval.current_level, action: 'approve', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: remark || '' });
        run('UPDATE approval_records SET status = ?, approval_history = ?, updated_at = datetime(\'now\') WHERE id = ?', ['approved', JSON.stringify(history), approval.id]);
        run('UPDATE purchase_orders SET po_status = ?, approval_status = ? WHERE id = ?', ['approved', 'approved', req.params.id]);
        // —— FEISHU-NOTIFY-01：事务外 best-effort 通知提交人 + CC ——
        notifyApprovalParticipants(approval.id, 'approved_final', { po_no: po.po_no }).catch(() => {});
      } else {
        history.push({ level: approval.current_level, action: 'approve', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: remark || '' });
        run('UPDATE approval_records SET current_level = ?, approval_history = ?, updated_at = datetime(\'now\') WHERE id = ?', [nextLevel, JSON.stringify(history), approval.id]);
        // —— FEISHU-NOTIFY-01：事务外 best-effort 通知下一级审批人 + CC ——
        notifyApprovalParticipants(approval.id, 'approved_intermediate', { po_no: po.po_no }).catch(() => {});
      }
    } else if (action === 'reject') {
      history.push({ level: approval.current_level, action: 'reject', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: remark || '' });
      run('UPDATE approval_records SET status = ?, approval_history = ?, updated_at = datetime(\'now\') WHERE id = ?', ['rejected', JSON.stringify(history), approval.id]);
      run('UPDATE purchase_orders SET po_status = ?, approval_status = ? WHERE id = ?', ['draft', 'rejected', req.params.id]);
      // —— FEISHU-NOTIFY-01：事务外 best-effort 通知提交人 + CC ——
      notifyApprovalParticipants(approval.id, 'reject', { po_no: po.po_no }).catch(() => {});
    } else if (action === 'withdraw') {
      history.push({ level: 0, action: 'withdraw', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: remark || '' });
      run('UPDATE approval_records SET status = ?, approval_history = ?, updated_at = datetime(\'now\') WHERE id = ?', ['withdrawn', JSON.stringify(history), approval.id]);
      run('UPDATE purchase_orders SET po_status = ?, approval_status = ? WHERE id = ?', ['draft', 'pending', req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// PO 标记为已发工厂
app.post('/api/purchase-orders/:id/send-to-factory', requireApiPermission('po_create'), asyncHandler((req, res) => {
  run('UPDATE purchase_orders SET po_status = ? WHERE id = ? AND po_status = ?', ['sent_factory', req.params.id, 'approved']);
  res.json({ success: true });
}));

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function s(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

function pick(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name];
  }
  return '';
}

function skuExists(sku) {
  return !!queryOne('SELECT id FROM skus WHERE sku_code = ?', [sku]);
}

function parseAttachment(value) {
  if (!value) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// 判断 PI 是否锁定（不可编辑）：CI/PL 已生成、已付定金、已作废
function getPILockReason(pi) {
  if (!pi) return null;
  if (pi.pi_status === 'cancelled') return '已作废';
  // 多 PI 改造：增加 ci_items.pi_id 维度（CI 明细来源 PI）
  const ci = queryOne(`
    SELECT ci.id FROM commercial_invoices ci
    LEFT JOIN commercial_invoice_items cii ON cii.ci_id = ci.id
    WHERE (ci.related_pi_id = ? OR ci.related_pi_no = ? OR cii.pi_id = ?)
      AND ci.ci_status != 'cancelled'
    LIMIT 1
  `, [pi.id, pi.pi_no, pi.id]);
  if (ci) return '已生成CI';
  const pl = queryOne('SELECT id FROM packing_lists WHERE related_pi_id = ? OR related_pi_no = ? LIMIT 1', [pi.id, pi.pi_no]);
  if (pl) return '已生成PL';
  if (pi.deposit_payment_status === 'paid') return '已付定金';
  if (n(pi.paid_deposit, 0) > 0) return '已付定金';
  return null;
}

// PI号编辑锁定（比通用编辑锁定 getPILockReason 更严格）：PI号作为前期录单纠错字段，
// 一旦进入后续业务阶段即锁定，不再允许修改。普通字段(pi日期/交期/付款条件等)沿用 getPILockReason。
// 允许修改时尚未进入后续阶段，因此无需大范围级联下游(ci/pl/wac/成本/付款)历史数据。
function getPINumberLockReason(pi) {
  if (!pi) return null;
  const base = getPILockReason(pi); // 已作废 / 已生成CI / 已生成PL / 已付定金
  if (base) return base;
  // 已创建付款申请（含待审批/审批中/已审批/已付款）：付款申请记录 或 reserved/paid 应付费用
  const pr = queryOne("SELECT id FROM payment_requests WHERE (source_type='pi' AND source_id=?) OR (source_type='pi' AND source_no=?) LIMIT 1", [pi.id, pi.pi_no]);
  if (pr) return '已创建付款申请';
  const reservedPay = queryOne("SELECT id FROM payable_items WHERE source_type='pi' AND source_id=? AND fee_type='deposit' AND lifecycle_status IN ('reserved','partially_paid','paid') LIMIT 1", [pi.id]);
  if (reservedPay) return '已创建付款申请';
  // 已付款 / 结算 / 抹零：存在付款分摊流水
  const paid = queryOne(`SELECT pa.id FROM payment_allocations pa
     JOIN payment_request_items pri ON pri.id = pa.payment_request_item_id
     JOIN payable_items pai ON pai.id = pri.payable_item_id
     WHERE pai.source_type='pi' AND pai.source_id=? LIMIT 1`, [pi.id]);
  if (paid) return '已发生付款';
  // 已发货
  const shipped = queryOne('SELECT COALESCE(SUM(shipped_qty),0) AS s FROM proforma_invoice_items WHERE pi_id=?', [pi.id]);
  if (shipped && Number(shipped.s) > 0) return '已发生发货';
  // 已入库（CI 入库回写到 CI 项）
  const inbound = queryOne('SELECT COALESCE(SUM(inbound_qty),0) AS s FROM commercial_invoice_items WHERE pi_id=?', [pi.id]);
  if (inbound && Number(inbound.s) > 0) return '已入库';
  // 已产生 WAC / 成本 / 成本分摊
  const cost = queryOne('SELECT id FROM cost_allocations WHERE related_pi_no=? LIMIT 1', [pi.pi_no])
    || queryOne('SELECT id FROM cost_update_logs WHERE related_pi_no=? LIMIT 1', [pi.pi_no])
    || queryOne('SELECT id FROM wac_history WHERE pi_no=? LIMIT 1', [pi.pi_no]);
  if (cost) return '已产生成本记录';
  return null;
}

// PI 明细是否真正变化（用于 PUT 的 updateInventoryTransitData 跳过重算判断）。
// 仅比较影响在途口径的维度：SKU / po_qty / pi_confirmed_qty；单价/折扣不影响库存在途。
function piItemsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const key = it => `${it.sku_code}|${it.po_qty || 0}|${it.pi_confirmed_qty || 0}`;
  const sa = a.map(key).sort();
  const sb = b.map(key).sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

// ==================== PI 管理 ====================
app.get('/api/proforma-invoices', requireApiPermission('pi_view'), asyncHandler((req, res) => {
  const { status, ship_status, keyword, related_po } = req.query;
  let sql = `SELECT pi.*,
      COALESCE((SELECT SUM(pii.pi_confirmed_qty) FROM proforma_invoice_items pii WHERE pii.pi_id = pi.id), 0) AS confirmed_qty_sum,
      COALESCE((SELECT SUM(pii.shipped_qty) FROM proforma_invoice_items pii WHERE pii.pi_id = pi.id), 0) AS shipped_qty_sum,
      COALESCE((SELECT pai.lifecycle_status FROM payable_items pai WHERE pai.source_id = pi.id AND pai.source_type = 'pi' AND pai.fee_type = 'deposit'), pi.deposit_payment_status) AS deposit_payment_status
    FROM proforma_invoices pi WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND pi.pi_status = ?'; params.push(status); }
  if (related_po) { sql += ' AND pi.related_po_no = ?'; params.push(related_po); }
  if (keyword) { sql += ' AND (pi.pi_no LIKE ? OR pi.supplier_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY pi.created_at DESC';
  let rows = query(sql, params).rows;
  if (ship_status) {
    rows = rows.filter(r => resolvePIShipStatus(r) === ship_status);
  }
  // Batch-calculate deposit_paid based on actual payment facts
  const depositPiIds = rows.filter(r => r.need_deposit).map(r => r.id);
  const depositPaidMap = {};
  if (depositPiIds.length > 0) {
    const placeholders = depositPiIds.map(() => '?').join(',');
    const depositRows = query(
      `SELECT pai.source_id,
        COALESCE(SUM(pa.allocated_amount_minor), 0) AS paid_minor,
        MAX(pai.payable_amount_minor) AS payable_minor,
        COALESCE(MAX(pr.rounding_amount), 0) AS rounding_amount
      FROM payable_items pai
      LEFT JOIN payment_request_items pri ON pri.payable_item_id = pai.id
      LEFT JOIN payment_allocations pa ON pa.payment_request_item_id = pri.id
      LEFT JOIN payment_requests pr ON pr.id = pri.payment_request_id
      WHERE pai.source_id IN (${placeholders})
        AND pai.source_type = 'pi' AND pai.fee_type = 'deposit'
      GROUP BY pai.source_id`,
      depositPiIds
    ).rows;
    depositRows.forEach(d => {
      depositPaidMap[d.source_id] = (d.paid_minor + Math.round(d.rounding_amount * 100)) >= d.payable_minor;
    });
  }
  res.json(rows.map(r => {
    const lr = getPILockReason(r);
    const deposit_paid = r.need_deposit ? (depositPaidMap[r.id] || false) : true;
    return { ...r, locked: !!lr, lock_reason: lr || '', deposit_paid };
  }));
}));

// 根据 PI 确认数量 vs 已出货数量解析纯发货状态（展示层语义，不写回 DB）
function resolvePIShipStatus(pi) {
  if (pi.pi_status === 'cancelled') return 'cancelled';
  const confirmed = Number(pi.confirmed_qty_sum || pi.total_confirmed_qty || 0);
  const shipped = Number(pi.shipped_qty_sum || pi.total_shipped_qty || 0);
  if (confirmed > 0 && shipped >= confirmed) return 'shipped_complete';
  if (shipped > 0 && shipped < confirmed) return 'partial_shipped';
  return 'pending_shipment';
}

app.get('/api/proforma-invoices/:id', requireApiPermission('pi_view'), asyncHandler((req, res) => {
  const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [req.params.id]);
  if (!pi) return res.status(404).json({ error: 'PI不存在' });
  const items = query(`SELECT pii.*, s.reference_customs_rate
    FROM proforma_invoice_items pii
    LEFT JOIN skus s ON s.sku_code = pii.sku_code
    WHERE pii.pi_id = ? ORDER BY pii.created_at, pii.id`, [req.params.id]).rows;
  const lr = getPILockReason(pi);
  // Build deposit progress from Payment Core
  let depositProgress = null;
  if (pi.need_deposit) {
    const depositItem = queryOne(
      `SELECT pai.id, pai.payable_amount_minor, pai.lifecycle_status
       FROM payable_items pai
       WHERE pai.source_id = ? AND pai.source_type = 'pi' AND pai.fee_type = 'deposit'`, [pi.id]);
    if (depositItem) {
      const payableMinor = depositItem.payable_amount_minor || 0;
      const paidResult = queryOne(
        `SELECT COALESCE(SUM(pa.allocated_amount_minor), 0) AS paid_minor
         FROM payment_allocations pa
         JOIN payment_request_items pri ON pa.payment_request_item_id = pri.id
         WHERE pri.payable_item_id = ?`, [depositItem.id]);
      const paidMinor = paidResult ? paidResult.paid_minor : 0;
      const roundingMinor = Math.max(0, payableMinor - paidMinor);
      const remainingMinor = Math.max(0, payableMinor - paidMinor - roundingMinor);
      const pct = payableMinor > 0 ? Math.min(100, Math.round((paidMinor / payableMinor) * 100 * 100) / 100) : 0;
      // Payment records: request_no, paid_date, amount
      const records = query(
        `SELECT DISTINCT pr.request_no, pr.supplier_name, pr.paid_date, pr.paid_amount, pr.currency,
                pr.rounding_amount, pr.rounding_reason
         FROM payment_requests pr
         JOIN payment_request_items pri ON pri.payment_request_id = pr.id
         WHERE pri.payable_item_id = ?
         ORDER BY pr.paid_date DESC`, [depositItem.id]).rows;
      depositProgress = {
        payable_amount_minor: payableMinor,
        paid_amount_minor: paidMinor,
        rounding_amount_minor: roundingMinor,
        remaining_amount_minor: remainingMinor,
        core_status: depositItem.lifecycle_status,
        payment_percentage: pct,
        payment_records: records.map(r => ({
          request_no: r.request_no,
          supplier_name: r.supplier_name,
          paid_date: r.paid_date,
          paid_amount: r.paid_amount,
          currency: r.currency,
          rounding_amount: r.rounding_amount,
          rounding_reason: r.rounding_reason || ''
        }))
      };
    }
  }
  // Calculate deposit_paid based on actual payment facts
  const depositPaid = depositProgress
    ? (depositProgress.paid_amount_minor + Math.round((depositProgress.payment_records.reduce((s, r) => s + (r.rounding_amount || 0), 0)) * 100)) >= depositProgress.payable_amount_minor
    : !pi.need_deposit;
  res.json({ ...pi, items, locked: !!lr, lock_reason: lr || '', deposit_progress: depositProgress,
    deposit_payment_status: depositProgress ? depositProgress.core_status : pi.deposit_payment_status,
    deposit_paid: depositPaid,
    pi_no_locked: !!getPINumberLockReason(pi), pi_no_lock_reason: getPINumberLockReason(pi) || '' });
}));

app.post('/api/proforma-invoices', requireApiPermission('pi_create'), asyncHandler(async (req, res) => {
  try {
    const d = req.body;
    if (!d.supplier_name) return res.status(400).json({ error: '供应商不能为空' });
    let poCurrency = null;
    if (d.related_po_id) {
      const po = queryOne(
        'SELECT id, approval_status, currency FROM purchase_orders WHERE id = ?',
        [d.related_po_id]
      );
      if (!po) {
        return res.status(400).json({ error: '关联的PO不存在' });
      }
      if (po.approval_status !== 'approved') {
        return res.status(400).json({
          error: 'PO 尚未审批通过，不能生成 PI'
        });
      }
      poCurrency = po.currency || 'USD';
    }
    // 关联 PO 时锁定币种为 PO 币种，避免跨币种比较；独立 PI 用请求币种
    const finalCurrency = d.related_po_id ? poCurrency : (d.currency || 'USD');
    const piId = genId('pi');
    const piNo = d.pi_no || `PI-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    let totalAmount = 0;
    const needDeposit = d.need_deposit === false || d.need_deposit === 0 || d.need_deposit === '0' ? 0 : 1;
    const depositRatio = needDeposit ? n(d.deposit_ratio, 0) : 0;

    transaction(() => {
      run(`INSERT INTO proforma_invoices (id, pi_no, related_po_id, related_po_no, supplier_id, supplier_name, brand, country, target_warehouse, pi_date, currency, total_amount, payment_terms, payment_term_id, need_deposit, deposit_ratio, balance_ratio, payable_deposit, pi_status, expected_delivery, attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [piId, piNo, d.related_po_id || '', d.related_po_no || '', d.supplier_id || '', d.supplier_name, d.brand || '', d.country || '', d.target_warehouse || '', d.pi_date || new Date().toISOString().split('T')[0], finalCurrency, 0, d.payment_terms || '', d.payment_term_id || '', needDeposit, depositRatio, 100 - depositRatio, 0, d.pi_status || 'pending', d.expected_delivery || '', parseAttachment(d.attachment), d.remark || '']);

      if (d.items && d.items.length > 0) {
        // P2-6 守卫：PI 累计数量不得超过 PO 数量（按 SKU 聚合本次 PI 数量，避免同 PI 内多行同 SKU 累加漏校验）
        if (d.related_po_id) {
          const piQtyMap = new Map();
          d.items.forEach(item => {
            const sku = item.sku_code;
            piQtyMap.set(sku, (piQtyMap.get(sku) || 0) + (item.pi_confirmed_qty || 0));
          });
          for (const [sku, thisPiQty] of piQtyMap) {
            const poItem = queryOne('SELECT id, po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ? AND sku_code = ?', [d.related_po_id, sku]);
            if (poItem) {
              const newTransferred = (poItem.transferred_pi_qty || 0) + thisPiQty;
              if (newTransferred > (poItem.po_qty || 0)) {
                throw new Error(`PI数量超过采购订单剩余数量（SKU: ${sku}, PO数量: ${poItem.po_qty || 0}, 已转PI数量: ${poItem.transferred_pi_qty || 0}, 本次PI数量: ${thisPiQty}），请检查后重新提交。`);
              }
            }
          }
        }
        // 明细批量 INSERT（性能优化：N 次单插 → 1 次多值插入）
        const itemRows = [];
        d.items.forEach(item => {
          const discount = n(item.discount, 0);
          const baseAmount = (item.pi_confirmed_qty || 0) * (item.unit_price || 0);
          // 金额口径含折扣：显式带 pi_amount 时以显式值为准（导入优先），否则反算 qty×price×(1-discount)
          const amount = (item.pi_amount !== undefined && item.pi_amount !== null && item.pi_amount !== '') ? n(item.pi_amount, 0) : baseAmount * (1 - discount);
          totalAmount += amount;
          itemRows.push([genId('pii'), piId, piNo, item.po_no || d.related_po_no || '', item.sku_code, item.po_qty || 0, item.pi_confirmed_qty || 0, item.unit_price || 0, discount, amount, 0, item.pi_confirmed_qty || 0]);
        });
        if (itemRows.length) {
          const placeholders = itemRows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
          const flat = []; itemRows.forEach(r => flat.push(...r));
          run(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, discount, pi_amount, shipped_qty, unshipped_qty) VALUES ${placeholders}`, flat);
        }

        // 更新PO明细的已转PI数量
        if (d.related_po_id) {
          d.items.forEach(item => {
            const poItem = queryOne('SELECT id, po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ? AND sku_code = ?', [d.related_po_id, item.sku_code]);
            if (poItem) {
              const newTransferred = (poItem.transferred_pi_qty || 0) + (item.pi_confirmed_qty || 0);
              run('UPDATE purchase_order_items SET transferred_pi_qty = ?, untransferred_pi_qty = ? WHERE id = ?',
                [newTransferred, (poItem.po_qty || 0) - newTransferred, poItem.id]);
            }
          });
        }
        const payableDeposit = needDeposit ? totalAmount * depositRatio / 100 : 0;
        run('UPDATE proforma_invoices SET total_amount = ?, payable_deposit = ?, available_deduct_deposit = ? WHERE id = ?', [totalAmount, payableDeposit, payableDeposit, piId]);

        // PAY-CORE Phase 1.5 Task 1：PI 创建时自动生成 payable_items（deposit）
        // V5 规则：needDeposit=true 且 payableDeposit > 0 才创建
        if (needDeposit && payableDeposit > 0) {
          createPayableItemFromSource({
            sourceType: 'pi',
            sourceId: piId,
            sourceNo: piNo,
            feeType: 'deposit',
            categoryCode: 'goods',
            subcategoryCode: 'deposit',
            payeeType: 'factory',
            payeeKey: `supplier:${d.supplier_id || d.supplier_name}`,
            payeeName: d.supplier_name,
            currency: finalCurrency,
            payableAmount: payableDeposit,
            createdBy: (req.currentUserId || req.user && req.user.id) || ''
          });
        }

        // 更新PO状态
        if (d.related_po_id) {
          const poItems = query('SELECT po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ?', [d.related_po_id]).rows;
          const allTransferred = poItems.every(i => i.transferred_pi_qty >= i.po_qty);
          const anyTransferred = poItems.some(i => i.transferred_pi_qty > 0);
          if (allTransferred) {
            run('UPDATE purchase_orders SET po_status = ? WHERE id = ?', ['transferred_pi', d.related_po_id]);
          } else if (anyTransferred) {
            run('UPDATE purchase_orders SET po_status = ? WHERE id = ?', ['partial_pi', d.related_po_id]);
          }
        }

        // 更新库存的PI未发货数量（派生/在途汇总刷新，已移到事务外、COMMIT 后执行）
      }
    });
    // —— COMMIT 后 read-back（事务外，走 pool，证明已真正持久化）——
    let verify = null;
    try {
      verify = queryOne('SELECT id, pi_no FROM proforma_invoices WHERE id = ?', [piId]);
    } catch (readErr) {
      // 读库本身异常：状态未知，不能告诉用户成功也不能说失败
      throw new Error('PI_CREATE_UNCONFIRMED_UNKNOWN');
    }
    if (!verify || verify.pi_no !== piNo) {
      // 查询成功但找不到刚写入的 PI：事务未真正落库
      throw new Error('PI_CREATE_UNCONFIRMED');
    }

    // 派生/在途汇总刷新（可重算，放事务外，确保原子 PI 已落库后再算）。
    // 失败属于「派生数据刷新失败」，绝不影响「PI 已创建成功」这一原子事实：
    // 改为记录 warning 并随响应返回非阻塞 transit_refresh_warning，不撤销 PI 创建。
    // 后续任意 PO/CI/PI 变更都会再次触发 updateInventoryTransitData，派生值会被重算补齐。
    let transitRefreshWarning = null;
    try {
      await updateInventoryTransitData();
    } catch (transitErr) {
      transitRefreshWarning = (transitErr && transitErr.message) ? transitErr.message : String(transitErr);
      console.error('[PI-CREATE] 派生在途数据刷新失败（PI 已落库，不影响创建成功）:', transitErr);
    }

    const payableDeposit = (d.items && d.items.length > 0) ? (needDeposit ? totalAmount * depositRatio / 100 : 0) : 0;
    res.json({
      id: piId,
      pi_no: piNo,
      ...d,
      total_amount: totalAmount,
      need_deposit: needDeposit,
      deposit_ratio: depositRatio,
      payable_deposit: payableDeposit,
      transit_refresh_warning: transitRefreshWarning
    });
  } catch (e) {
    const msg = e && e.message;
    if (msg === 'PI_CREATE_UNCONFIRMED') {
      return res.status(500).json({ error: 'PI 创建未成功，请勿重复提交' });
    }
    if (msg === 'PI_CREATE_UNCONFIRMED_UNKNOWN') {
      return res.status(500).json({ error: 'PI 创建状态未确认，请勿重复提交，请按 PI 号检查' });
    }
    console.error('PI 创建失败:', e);
    res.status(500).json({ error: 'PI 创建失败: ' + (msg || e) });
  }
}));

app.put('/api/proforma-invoices/:id', requireApiPermission('pi_edit'), asyncHandler(async (req, res) => {
  try {
    const d = req.body;
    const { id } = req.params;
    const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [id]);
    if (!pi) return res.status(404).json({ error: 'PI不存在' });

    // 锁定守卫：CI/PL 已生成 / 已付定金 / 已作废 → 拒绝编辑
    const lockReason = getPILockReason(pi);
    if (lockReason) return res.status(409).json({ error: '该 PI 当前不可编辑（' + lockReason + '）', locked: true, lock_reason: lockReason });

    // 定金/比例口径（优先取请求值，否则保持原值）
    const needDeposit = d.need_deposit !== undefined
      ? (d.need_deposit === false || d.need_deposit === 0 || d.need_deposit === '0' ? 0 : 1)
      : (pi.need_deposit ? 1 : 0);
    const depositRatio = needDeposit
      ? (d.deposit_ratio !== undefined ? n(d.deposit_ratio, 0) : n(pi.deposit_ratio, 0))
      : 0;
    const balanceRatio = 100 - depositRatio;

    const fields = [];
    const values = [];
    // PI号：允许编辑为供应商真实编号（仅未进入后续业务阶段时可改，前端+后端双重校验）
    if (d.pi_no !== undefined && d.pi_no !== '' && d.pi_no !== pi.pi_no) {
      const numLock = getPINumberLockReason(pi);
      if (numLock) return res.status(409).json({ error: 'PI号不可修改（' + numLock + '）', locked: true, lock_reason: numLock, field: 'pi_no' });
      const dup = queryOne('SELECT id FROM proforma_invoices WHERE pi_no = ? AND id != ?', [d.pi_no, id]);
      if (dup) return res.status(409).json({ error: '该 PI 编号已存在，请检查供应商文件', dup: true });
      fields.push('pi_no = ?'); values.push(d.pi_no);
      // 新明细的 pi_no 在事务内用 newPiNo 同步写入，无需单独 UPDATE 旧明细（旧明细会被 DELETE 后重建）
    }
    // PI 日期编辑规则与 brand/country/warehouse 一致：未进入后续业务链路即可改（getPILockReason 守卫）
    ['pi_date', 'payment_terms', 'payment_term_id', 'expected_delivery', 'remark'].forEach(f => {
      if (d[f] !== undefined) { fields.push(`${f} = ?`); values.push(d[f]); }
    });
    // brand/country/target_warehouse/currency 编辑规则：PI 未进入后续业务链路（未生成 CI/PL/未付定金/未作废）才可改，
    // 锁定守卫已在前面 getPILockReason 拦截；PO→PI 继承仅在 PI 创建时发生，编辑时 PI 作为供应商正式文件可独立修正
    // 字段级守卫：定金审批中（pending_approval）禁止修改 currency，避免 PI/应付/付款申请币种不一致
    if (d.currency !== undefined && d.currency !== pi.currency && pi.deposit_payment_status === 'pending_approval') {
      return res.status(409).json({ error: '该 PI 有定金付款审批中，不可修改币种', locked: true, field: 'currency' });
    }
    ['brand', 'country', 'target_warehouse', 'currency'].forEach(f => {
      if (d[f] !== undefined) { fields.push(`${f} = ?`); values.push(d[f]); }
    });
    if (d.need_deposit !== undefined) { fields.push('need_deposit = ?'); values.push(needDeposit); }
    if (d.deposit_ratio !== undefined) { fields.push('deposit_ratio = ?'); values.push(depositRatio); }
    fields.push('balance_ratio = ?'); values.push(balanceRatio);
    if (d.attachment !== undefined) { fields.push('attachment = ?'); values.push(parseAttachment(d.attachment)); }

    const oldItems = query('SELECT * FROM proforma_invoice_items WHERE pi_id = ? ORDER BY created_at', [id]).rows;
    let totalAmount = pi.total_amount || 0;
    let payableDeposit = 0;
    // 解析最新 PI号（若本次编辑修改了 pi_no，事务内新明细需用最新值）
    const newPiNo = (d.pi_no !== undefined && d.pi_no !== '' && d.pi_no !== pi.pi_no) ? d.pi_no : pi.pi_no;

    // 计算是否需要触发库存派生刷新（与事务内写入解耦，事务提交后在响应返回后执行）
    const itemsChanged = Array.isArray(d.items) && d.items.length > 0 && !piItemsEqual(d.items, oldItems);
    const invAffectingChanged =
      (d.country !== undefined && d.country !== pi.country) ||
      (d.target_warehouse !== undefined && d.target_warehouse !== pi.target_warehouse) ||
      itemsChanged;

    // P0-A：PI 主事实写入全部在同一同步事务内原子提交；回调内不再出现 async/await
    transaction(() => {
      // 明细全量替换（批量 INSERT）
      if (d.items && Array.isArray(d.items)) {
        run('DELETE FROM proforma_invoice_items WHERE pi_id = ?', [id]);
        totalAmount = 0;
        const itemRows = [];
        d.items.forEach(item => {
          const discount = n(item.discount, 0);
          const baseAmount = (item.pi_confirmed_qty || 0) * (item.unit_price || 0);
          // 金额口径与创建一致：显式带 pi_amount 以显式值为准，否则 qty×price×(1-discount)
          const amount = (item.pi_amount !== undefined && item.pi_amount !== null && item.pi_amount !== '') ? n(item.pi_amount, 0) : baseAmount * (1 - discount);
          totalAmount += amount;
          itemRows.push([genId('pii'), id, newPiNo, item.po_no || pi.related_po_no || '', item.sku_code, item.po_qty || 0, item.pi_confirmed_qty || 0, item.unit_price || 0, discount, amount, 0, item.pi_confirmed_qty || 0]);
        });
        if (itemRows.length) {
          const placeholders = itemRows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
          const flat = []; itemRows.forEach(r => flat.push(...r));
          run(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, discount, pi_amount, shipped_qty, unshipped_qty) VALUES ${placeholders}`, flat);
        }
      }

      // 总额 + 应付定金 + 可用抵扣定金 重算
      payableDeposit = needDeposit ? totalAmount * depositRatio / 100 : 0;
      fields.push('total_amount = ?', 'payable_deposit = ?', 'available_deduct_deposit = ?');
      values.push(totalAmount, payableDeposit, payableDeposit);

      // PAY-CORE Phase 1.5 Task 1：PI 更新时同步 payable_items 金额
      // V5 规则：仅 lifecycle_status='active' 的 payable_item 才同步；reserved/paid/cancelled 跳过
      if (needDeposit && payableDeposit > 0) {
        syncPayableItemAmount('pi', id, 'deposit', payableDeposit);
      }

      // PO transferred_pi_qty delta 同步（先回滚旧明细，再应用新明细）
      if (pi.related_po_id) {
        oldItems.forEach(it => {
          const poItem = queryOne('SELECT id, po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ? AND sku_code = ?', [pi.related_po_id, it.sku_code]);
          if (poItem) {
            const nt = Math.max(0, (poItem.transferred_pi_qty || 0) - (it.pi_confirmed_qty || 0));
            run('UPDATE purchase_order_items SET transferred_pi_qty = ?, untransferred_pi_qty = ? WHERE id = ?',
              [nt, (poItem.po_qty || 0) - nt, poItem.id]);
          }
        });
        if (d.items && Array.isArray(d.items)) {
          // P2-6 守卫：编辑 PI 后累计 PI 数量不得超过 PO 数量（按 SKU 聚合本次新明细数量，旧明细已回滚）
          const piQtyMap = new Map();
          d.items.forEach(item => {
            const sku = item.sku_code;
            piQtyMap.set(sku, (piQtyMap.get(sku) || 0) + (item.pi_confirmed_qty || 0));
          });
          for (const [sku, thisPiQty] of piQtyMap) {
            const poItem = queryOne('SELECT id, po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ? AND sku_code = ?', [pi.related_po_id, sku]);
            if (poItem) {
              const newTransferred = (poItem.transferred_pi_qty || 0) + thisPiQty;
              if (newTransferred > (poItem.po_qty || 0)) {
                throw new Error(`PI数量超过采购订单剩余数量（SKU: ${sku}, PO数量: ${poItem.po_qty || 0}, 已转PI数量: ${poItem.transferred_pi_qty || 0}, 本次PI数量: ${thisPiQty}），请检查后重新提交。`);
              }
            }
          }
          d.items.forEach(it => {
            const poItem = queryOne('SELECT id, po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ? AND sku_code = ?', [pi.related_po_id, it.sku_code]);
            if (poItem) {
              const nt = (poItem.transferred_pi_qty || 0) + (it.pi_confirmed_qty || 0);
              run('UPDATE purchase_order_items SET transferred_pi_qty = ?, untransferred_pi_qty = ? WHERE id = ?',
                [nt, (poItem.po_qty || 0) - nt, poItem.id]);
            }
          });
        }
        // 刷新 PO 状态
        const poItems = query('SELECT po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ?', [pi.related_po_id]).rows;
        if (poItems.length) {
          const allTransferred = poItems.every(i => i.transferred_pi_qty >= i.po_qty);
          const anyTransferred = poItems.some(i => i.transferred_pi_qty > 0);
          const newStatus = allTransferred ? 'transferred_pi' : (anyTransferred ? 'partial_pi' : 'approved');
          run('UPDATE purchase_orders SET po_status = ? WHERE id = ?', [newStatus, pi.related_po_id]);
        }
      }

      // 回写供应商 last_used_payment_term_id（仅当付款条件变更）
      if (d.payment_term_id !== undefined && d.payment_term_id && d.payment_term_id !== pi.payment_term_id) {
        run('UPDATE suppliers SET last_used_payment_term_id = ? WHERE id = ?', [d.payment_term_id, pi.supplier_id]);
      }

      fields.push(`updated_at = datetime('now')`);
      values.push(id);
      run(`UPDATE proforma_invoices SET ${fields.join(', ')} WHERE id = ?`, values);
      // 库存派生刷新（updateInventoryTransitData）已移出本事务，待 COMMIT 成功后执行（见下方 P0-B）
    });

    // 操作日志（编辑痕迹）—— 独立 try/catch，避免日志失败把"保存成功"误判为失败
    try {
      logOperation({
        operator_id: req.currentUserId,
        operator_name: req.currentUserName,
        page: 'proforma_invoice',
        operation_type: 'edit',
        target_ids: [id],
        affected_count: (d.items && d.items.length) || oldItems.length,
        old_values: { total_amount: pi.total_amount, payable_deposit: pi.payable_deposit, deposit_ratio: pi.deposit_ratio },
        new_values: { total_amount: totalAmount, payable_deposit: payableDeposit, deposit_ratio: depositRatio, balance_ratio: balanceRatio, items_count: (d.items ? d.items.length : oldItems.length) },
        reason: d.edit_reason || '',
        triggered_recalc: 1,
        is_rollbackable: 0
      });
    } catch (logErr) {
      console.error('[PI-LOG] operation log failed for ' + id + ':', logErr && logErr.message);
    }

    // P0-B：PI 主事务已 COMMIT 成功，先返回 success，再 best-effort 刷新库存派生数据。
    // 关键顺序约束（Gate 1）：必须等 response 真正 finish（已 flush 到 socket）后，
    // 才在下一个事件循环 tick 启动 refresh。否则 DB-SYNC + Atomics.wait 的同步刷新
    // 会在 response 完成边界前阻塞，导致前端仍可能收到 502 / 重复提交。
    res.once('finish', () => {
      if (!invAffectingChanged) return;
      setImmediate(() => {
        updateInventoryTransitData().catch((rfErr) => {
          // 仅记录刷新失败，绝不 throw / 不调用 next / 不再写 res。
          // PI 已成功提交，刷新失败不影响"PI 保存成功"的语义。
          console.error('[PI-REFRESH] inventory refresh failed for ' + id + ':', rfErr && rfErr.message);
        });
      });
    });
    res.status(200).json({ success: true, id, total_amount: totalAmount, payable_deposit: payableDeposit });
    return;
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.post('/api/proforma-invoices/:id/attachment', requireApiPermission('pi_edit'), asyncHandler((req, res) => {
  try {
    // PI-ATTACH-01：附件支持多文件数组存储；归一化为 JSON 字符串
    // 兼容历史单对象、dataUrl 字符串、空值
    const att = req.body.attachment;
    let normalized = '';
    if (Array.isArray(att)) normalized = att.length ? JSON.stringify(att) : '';
    else if (att && typeof att === 'object') normalized = JSON.stringify([att]);
    else if (typeof att === 'string' && att) {
      try { const p = JSON.parse(att); normalized = Array.isArray(p) ? att : JSON.stringify([p]); }
      catch(e) { normalized = JSON.stringify([{ name: '附件', dataUrl: att }]); }
    }
    // 保留 pi_status 联动：有附件 → uploaded；空 → pending
    const hasAttachment = Boolean(normalized);
    run('UPDATE proforma_invoices SET attachment = ?, pi_status = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [normalized, hasAttachment ? 'uploaded' : 'pending', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// PI 软作废（置 cancelled + 必填原因 + 回写在途）
app.post('/api/proforma-invoices/:id/void', requireApiPermission('pi_edit'), asyncHandler(async (req, res) => {
  try {
    const { void_reason } = req.body;
    if (!void_reason) return res.status(400).json({ error: '作废原因不能为空' });
    const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [req.params.id]);
    if (!pi) return res.status(404).json({ error: 'PI不存在' });
    if (pi.pi_status === 'cancelled') return res.status(400).json({ error: '该 PI 已作废，不能重复作废' });
    if (pi.pi_status === 'completed') return res.status(400).json({ error: '已完结的 PI 不允许作废' });
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const newRemark = (pi.remark ? pi.remark + '\n' : '') + `[作废 ${ts} by ${req.currentUserName || ''}] 原因: ${void_reason}`;
    run("UPDATE proforma_invoices SET pi_status = 'cancelled', remark = ?, updated_at = datetime('now') WHERE id = ?", [newRemark, pi.id]);
    await updateInventoryTransitData();
    logOperation({ operator_id: req.currentUserId, operator_name: req.currentUserName, page: 'proforma_invoice', operation_type: 'void', target_ids: [pi.id], affected_count: 1, old_values: { pi_status: pi.pi_status }, new_values: { pi_status: 'cancelled', void_reason }, reason: void_reason, triggered_recalc: 0, is_rollbackable: 0 });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== CI/PL 管理 ====================
// 物流阶段排序（业务阶段：待出运 < 运输中 < 清关中 < 待派送 < 已到仓）
// 底层值 → 阶段序号，用于取最高阶段
// 注意：物流状态纯粹由 logistics_status 映射，不依赖 Inbound 事实
const LOGISTICS_STAGE_RANK = {
  pending: 0, picked_up: 0,      // 待出运
  in_transit: 1,                 // 运输中
  arrived: 2, customs: 2,        // 清关中
  cleared: 3, delivering: 3,     // 待派送
  completed: 4                    // 已到仓
};
const STAGE_KEYS = ['pending_shipment', 'in_transit', 'customs_clearing', 'awaiting_delivery', 'warehouse_arrived'];

// 从底层 logistics_status 派生物流展示状态键（不依赖 Inbound 事实）
function deriveLogisticsDisplayStatus(rawStatus) {
  const rank = LOGISTICS_STAGE_RANK[rawStatus];
  if (rank === undefined) return 'pending_shipment';
  return STAGE_KEYS[rank];
}

app.get('/api/commercial-invoices', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  const { inbound_status, keyword, related_pi, country, warehouse, brand } = req.query;
  // 差异 = CI金额 - 已付定金 - 应付尾款（付款闭环校验）
  let sql = 'SELECT *, (goods_amount - COALESCE(actual_deducted_deposit, 0) - COALESCE(payable_balance, 0)) AS amount_difference FROM commercial_invoices WHERE 1=1';
  const params = [];
  if (related_pi) { sql += ' AND related_pi_no = ?'; params.push(related_pi); }
  if (keyword) { sql += ' AND (ci_no LIKE ? OR supplier_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (country) { const al = countryAliases(country); sql += ' AND country IN (' + al.map(() => '?').join(',') + ')'; al.forEach(a => params.push(a)); }
  if (warehouse) { sql += ' AND target_warehouse = ?'; params.push(warehouse); }
  if (brand) { sql += ' AND brand = ?'; params.push(brand); }
  sql += ' ORDER BY created_at DESC';
  let rows = query(sql, params).rows;

  // ── 展示层派生字段：关联物流单、物流展示状态、入库状态（不修改底层 ci_status） ──
  // 1. 批量查询每个 CI 关联的物流单
  const ciIds = rows.map(r => r.id);
  const logisticsMap = {}; // ci_id → { batch_nos: [], logistics_statuses: [] }
  if (ciIds.length > 0) {
    const placeholders = ciIds.map(() => '?').join(',');
    const lbRows = query(`SELECT id, batch_no, related_ci_id, logistics_status FROM logistics_batches WHERE related_ci_id IN (${placeholders})`, ciIds).rows;
    lbRows.forEach(lb => {
      if (!logisticsMap[lb.related_ci_id]) logisticsMap[lb.related_ci_id] = { batch_nos: [], logistics_statuses: [] };
      logisticsMap[lb.related_ci_id].batch_nos.push(lb.batch_no);
      logisticsMap[lb.related_ci_id].logistics_statuses.push(lb.logistics_status);
    });
  }

  // 2. 批量查询每个 CI 的入库状态（从 commercial_invoice_items 派生）
  const inboundMap = {}; // ci_id → 'none' | 'partial' | 'completed'
  if (ciIds.length > 0) {
    const placeholders = ciIds.map(() => '?').join(',');
    const itemRows = query(`SELECT ci_id, shipped_qty, inbound_qty FROM commercial_invoice_items WHERE ci_id IN (${placeholders})`, ciIds).rows;
    const ciItemMap = {}; // ci_id → { totalShipped, totalInbound }
    itemRows.forEach(it => {
      if (!ciItemMap[it.ci_id]) ciItemMap[it.ci_id] = { totalShipped: 0, totalInbound: 0 };
      ciItemMap[it.ci_id].totalShipped += (it.shipped_qty || 0);
      ciItemMap[it.ci_id].totalInbound += (it.inbound_qty || 0);
    });
    ciIds.forEach(cid => {
      const agg = ciItemMap[cid];
      if (!agg || agg.totalShipped === 0) { inboundMap[cid] = 'none'; return; }
      if (agg.totalInbound >= agg.totalShipped) { inboundMap[cid] = 'completed'; return; }
      if (agg.totalInbound > 0) { inboundMap[cid] = 'partial'; return; }
      inboundMap[cid] = 'none';
    });
  }

  // 3. 注入派生字段到每行 + 按 inbound_status 筛选
  rows = rows.filter(r => {
    const lbInfo = logisticsMap[r.id];
    const inboundDerived = inboundMap[r.id] || 'none';
    r.payable_date = String(r.due_date || '').trim() || computePayableDate(r.actual_ship_date, r.credit_days);
    r.related_logistics_batch_nos = lbInfo ? lbInfo.batch_nos.join(', ') : '';
    r.inbound_derived_status = inboundDerived;

    // 派生 ci_logistics_display_status：按业务阶段排序取最高阶段
    // 纯粹由 logistics_status 派生，不依赖 Inbound 事实
    if (lbInfo && lbInfo.logistics_statuses.length > 0) {
      let maxRank = -1;
      lbInfo.logistics_statuses.forEach(s => {
        const rank = LOGISTICS_STAGE_RANK[s] !== undefined ? LOGISTICS_STAGE_RANK[s] : 0;
        if (rank > maxRank) maxRank = rank;
      });
      r.ci_logistics_display_status = maxRank >= 0 ? STAGE_KEYS[maxRank] : '';
    } else {
      r.ci_logistics_display_status = '';
    }

    // 按 inbound_status 筛选（派生字段，post-query 过滤）
    if (inbound_status && inboundDerived !== inbound_status) return false;
    return true;
  });

  res.json(rows);
}));

// P2-LOGISTICS-CLOSED-LOOP: 可生成 PL 的 CI 列表（CI 创建即代表出货事实成立，不依赖 ci_status=shipped）
// 查询条件：CI 未取消。返回 CI 总数量、已生成 PL 数量、剩余可生成 PL 数量。
// 默认只返回 available_to_create_pl_qty > 0 的 CI（?all=true 返回全部）。
// 注意：SKU 级剩余数量以 GET /api/commercial-invoices/:id 的 pl_check 为最终依据。
app.get('/api/commercial-invoices/available-for-pl', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  const showAll = req.query.all === 'true';
  const sql = `SELECT ci.id, ci.ci_no, ci.supplier_name, ci.ci_date, ci.actual_ship_date, ci.country, ci.target_warehouse,
    COALESCE(ci_sum.total_ci_qty, 0) AS total_ci_qty,
    COALESCE(pl_sum.generated_pl_qty, 0) AS generated_pl_qty,
    COALESCE(ci_sum.total_ci_qty, 0) - COALESCE(pl_sum.generated_pl_qty, 0) AS available_to_create_pl_qty
  FROM commercial_invoices ci
  LEFT JOIN (
    SELECT ci_id, SUM(shipped_qty) AS total_ci_qty
    FROM commercial_invoice_items GROUP BY ci_id
  ) ci_sum ON ci_sum.ci_id = ci.id
  LEFT JOIN (
    SELECT pl.related_ci_id, SUM(pli.total_qty) AS generated_pl_qty
    FROM packing_lists pl
    JOIN packing_list_items pli ON pli.pl_id = pl.id
    GROUP BY pl.related_ci_id
  ) pl_sum ON pl_sum.related_ci_id = ci.id
  WHERE ci.ci_status != 'cancelled'
  ORDER BY ci.created_at DESC`;
  let rows = query(sql).rows;
  if (!showAll) {
    rows = rows.filter(r => (r.available_to_create_pl_qty || 0) > 0);
  }
  res.json(rows);
}));

app.get('/api/commercial-invoices/:id', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  const ci = queryOne('SELECT *, (goods_amount - COALESCE(actual_deducted_deposit, 0) - COALESCE(payable_balance, 0)) AS amount_difference FROM commercial_invoices WHERE id = ?', [req.params.id]);
  if (!ci) return res.status(404).json({ error: 'CI不存在' });
  ci.payable_date = String(ci.due_date || '').trim() || computePayableDate(ci.actual_ship_date, ci.credit_days);
  const items = query('SELECT * FROM commercial_invoice_items WHERE ci_id = ? ORDER BY created_at', [req.params.id]).rows;
  // LOGISTICS-CLOSED-LOOP-PHASE1: 改 queryOne→query，返回 packing_lists 数组（支持一 CI 多 PL）
  const pls = query('SELECT * FROM packing_lists WHERE related_ci_id = ? ORDER BY created_at', [req.params.id]).rows;
  const packing_lists = pls.map(pl => {
    const plItems = query('SELECT * FROM packing_list_items WHERE pl_id = ? ORDER BY created_at', [pl.id]).rows;
    return { ...pl, items: plItems };
  });
  // 兼容旧前端：packing_list 保留第一个 PL（如存在），新前端使用 packing_lists 数组
  const pl = pls.length > 0 ? packing_lists[0] : null;
  const plItems = pl ? pl.items : [];
  const ciQtyBySku = {};
  items.forEach(i => { ciQtyBySku[i.sku_code] = (ciQtyBySku[i.sku_code] || 0) + (i.shipped_qty || 0); });
  const plQtyBySku = {};
  packing_lists.forEach(p => {
    (p.items || []).forEach(i => { plQtyBySku[i.sku_code] = (plQtyBySku[i.sku_code] || 0) + (i.total_qty || 0); });
  });
  const checkSkus = [...new Set(Object.keys(ciQtyBySku).concat(Object.keys(plQtyBySku)))];
  const pl_check = checkSkus.map(sku => ({ sku_code: sku, ci_qty: ciQtyBySku[sku] || 0, pl_qty: plQtyBySku[sku] || 0, diff_qty: (plQtyBySku[sku] || 0) - (ciQtyBySku[sku] || 0) }));
  res.json({ ...ci, items, packing_list: pl, packing_lists, pl_check });
}));

// 多 PI 改造：查询 CI 关联的各 PI 尾款明细（供合并付款选择）
app.get('/api/commercial-invoices/:id/pi-balances', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
  if (!ci) return res.status(404).json({ error: 'CI不存在' });
  // 从 ci_items 取所有来源 PI
  let piIds = [...new Set(
    query('SELECT DISTINCT pi_id FROM commercial_invoice_items WHERE ci_id = ? AND pi_id != ?', [ci.id, '']).rows.map(r => r.pi_id)
  )];
  // 兼容存量：如果 ci_items.pi_id 为空，从 ci.related_pi_id 取
  if (piIds.length === 0 && ci.related_pi_id) piIds.push(ci.related_pi_id);
  const result = piIds.map(piId => {
    const pi = queryOne('SELECT id, pi_no, supplier_name, currency FROM proforma_invoices WHERE id = ?', [piId]);
    // per-PI balance payable_item（新建 CI）
    const payableItem = queryOne(
      `SELECT * FROM payable_items
       WHERE source_type = 'pi' AND source_id = ? AND source_ci_id = ? AND fee_type = 'balance'
         AND lifecycle_status = 'active'`,
      [piId, ci.id]
    );
    // 存量 CI 级 balance payable_item（兼容旧 CI）
    const legacyPayableItem = piIds.length === 1 ? queryOne(
      `SELECT * FROM payable_items
       WHERE source_type = 'ci' AND source_id = ? AND fee_type = 'balance'
         AND lifecycle_status = 'active'`,
      [ci.id]
    ) : null;
    const item = payableItem || legacyPayableItem || null;
    return {
      pi_id: piId,
      pi_no: pi ? pi.pi_no : '',
      supplier_name: pi ? pi.supplier_name : '',
      currency: pi ? pi.currency : ci.currency,
      payable_item_id: item ? item.id : null,
      payable_amount: item ? (item.payable_amount_minor / 100) : 0,
      lifecycle_status: item ? item.lifecycle_status : 'none'
    };
  });
  res.json(result);
}));

app.post('/api/commercial-invoices', requireApiPermission('ci_create'), asyncHandler(async (req, res) => {
  try {
    const d = req.body;
    if (!d.supplier_name) return res.status(400).json({ error: '供应商不能为空' });
    // CI-SHIP-DATE-01：实际出货日期必填（不允许默认填充今天）
    let actualShipDate;
    try { actualShipDate = historicalCIDate(d.actual_ship_date, '实际出货日期', true); }
    catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const ciId = genId('ci');
    const ciNo = d.ci_no || `CI-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    // R11: CI No 唯一校验（手动填写时）
    if (d.ci_no) {
      const existCi = queryOne('SELECT id FROM commercial_invoices WHERE ci_no = ?', [d.ci_no]);
      if (existCi) return res.status(400).json({ error: 'CI编号已存在，请使用其他编号' });
    }

    // 多 PI 支持：兼容旧 related_pi_id 单值
    let relatedPiIds = [];
    let relatedPiNos = [];
    if (Array.isArray(d.related_pi_ids) && d.related_pi_ids.length > 0) {
      relatedPiIds = d.related_pi_ids;
      relatedPiNos = Array.isArray(d.related_pi_nos) ? d.related_pi_nos : [];
    } else if (d.related_pi_id) {
      relatedPiIds = [d.related_pi_id];
      relatedPiNos = d.related_pi_no ? [d.related_pi_no] : [];
    }
    // P1-STATE-01B 守卫①：运营链路 CI 必须关联 PI（在任何 INSERT/UPDATE 之前）
    if (relatedPiIds.length === 0) return res.status(400).json({ error: 'CI 必须关联 PI，不能直接创建' });

    // 查询所有关联 PI
    const pis = relatedPiIds.map(pid => queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [pid])).filter(p => p);
    if (pis.length !== relatedPiIds.length) return res.status(400).json({ error: '关联的PI不存在' });

    // R4: 同供应商校验
    const supplierIds = new Set(pis.map(p => p.supplier_id || ''));
    if (supplierIds.size > 1) return res.status(400).json({ error: '多PI必须同供应商' });
    // R4: 同币种校验
    const piCurrencies = new Set(pis.map(p => p.currency || ''));
    if (piCurrencies.size > 1) return res.status(400).json({ error: '多PI必须同币种' });

    // P1-STATE-01B 守卫②：需定金且定金实际未付清（基于付款事实计算），禁止生成 CI
    for (const pi of pis) {
      if (pi.need_deposit) {
        const dpr = queryOne(
          `SELECT
            COALESCE(SUM(pa.allocated_amount_minor), 0) AS paid_minor,
            MAX(pai.payable_amount_minor) AS payable_minor,
            COALESCE(MAX(pr.rounding_amount), 0) AS rounding_amount
          FROM payable_items pai
          LEFT JOIN payment_request_items pri ON pri.payable_item_id = pai.id
          LEFT JOIN payment_allocations pa ON pa.payment_request_item_id = pri.id
          LEFT JOIN payment_requests pr ON pr.id = pri.payment_request_id
          WHERE pai.source_id = ? AND pai.source_type = 'pi' AND pai.fee_type = 'deposit'`,
          [pi.id]
        );
        const depositPaid = dpr && (dpr.paid_minor + Math.round(dpr.rounding_amount * 100)) >= dpr.payable_minor;
        if (!depositPaid) {
          return res.status(400).json({ error: `PI ${pi.pi_no} 定金尚未付清，不能生成 CI` });
        }
      }
    }

    const firstPi = pis[0];
    // PAY-CREDIT-DUE-01：优先使用前端传入的 credit_days；否则从 PI 已选付款条款获取
    const frontendCreditDays = (d.credit_days !== undefined && d.credit_days !== null) ? Number(d.credit_days) : 0;
    const ciCredit = resolveOperationalCiCreditSnapshot(firstPi.id);
    const effectiveCreditDays = frontendCreditDays > 0 ? frontendCreditDays : ciCredit.creditDays;
    const effectivePaymentTermId = frontendCreditDays > 0 ? '' : ciCredit.paymentTermId;
    const ciPaymentTerms = String(d.payment_terms || '').trim();
    const ciDueDate = String(d.due_date || '').trim();
    const payDueDate = computePayableDate(actualShipDate, effectiveCreditDays);
    // 应付日期：优先使用录入的 due_date（业务事实），否则按出货日+账期推算（与 CI 表头一致）
    const effectivePayableDate = ciDueDate || payDueDate;
    const relatedPoId = d.related_po_id || (firstPi ? firstPi.related_po_id : '');
    const relatedPoNo = d.related_po_no || (firstPi ? firstPi.related_po_no : '');
    const ciCurrency = d.currency || firstPi.currency || 'USD';
    const piTotalAmount = pis.reduce((s, p) => s + (p.total_amount || 0), 0);
    // 补全 relatedPiNos
    if (relatedPiNos.length !== relatedPiIds.length) {
      relatedPiNos = pis.map(p => p.pi_no);
    }

    let goodsAmount = 0;
    let totalShouldDeduct = 0;

    await transaction(async () => {
      // CI Header INSERT — related_pi_ids/related_pi_nos JSON 数组 + 旧字段首 PI 兼容
      const relatedPiIdsJson = JSON.stringify(relatedPiIds);
      const relatedPiNosJson = JSON.stringify(relatedPiNos);
      run(`INSERT INTO commercial_invoices (id, ci_no, related_po_id, related_po_no, related_pi_id, related_pi_no, related_pi_ids, related_pi_nos, supplier_id, supplier_name, brand, country, target_warehouse, ci_date, actual_ship_date, payment_term_id, credit_days, payment_terms, due_date, shipment_batch, currency, goods_amount, pi_total_amount, amount_difference, difference_reason, ci_status, attachment, pl_attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ciId, ciNo, relatedPoId || '', relatedPoNo || '', firstPi.id, firstPi.pi_no, relatedPiIdsJson, relatedPiNosJson, d.supplier_id || firstPi.supplier_id || '', d.supplier_name, d.brand || firstPi.brand || '', d.country || firstPi.country || '', d.target_warehouse || firstPi.target_warehouse || '', d.ci_date || new Date().toISOString().split('T')[0], actualShipDate, effectivePaymentTermId, effectiveCreditDays, ciPaymentTerms, ciDueDate || payDueDate, d.shipment_batch || 1, ciCurrency, 0, piTotalAmount, 0, d.difference_reason || '', d.ci_status || 'uploaded', parseAttachment(d.attachment), parseAttachment(d.pl_attachment), d.remark || '']);

      if (d.items && d.items.length > 0) {
        // P2-6 守卫：按 PI+SKU 聚合校验出货数量
        const piSkuQtyMap = new Map();
        d.items.forEach(item => {
          const itemPiId = item.pi_id || firstPi.id;
          const key = `${itemPiId}|${item.sku_code}`;
          piSkuQtyMap.set(key, (piSkuQtyMap.get(key) || 0) + (item.shipped_qty || 0));
        });
        for (const [key, thisCiQty] of piSkuQtyMap) {
          const [piId, sku] = key.split('|');
          const piItem = queryOne('SELECT id, pi_confirmed_qty, shipped_qty, discount FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [piId, sku]);
          if (piItem) {
            const newShipped = (piItem.shipped_qty || 0) + thisCiQty;
            if (newShipped > (piItem.pi_confirmed_qty || 0)) {
              throw new Error(`CI出货数量超过PI剩余数量（PI: ${piId}, SKU: ${sku}, PI确认数量: ${piItem.pi_confirmed_qty || 0}, 已发货数量: ${piItem.shipped_qty || 0}, 本次CI数量: ${thisCiQty}），请检查后重新提交。`);
            }
          }
        }

        // 遍历 items: INSERT CI items + 更新 PI shipped_qty + 按 PI 累计货值
        const perPiGoodsAmount = new Map();
        d.items.forEach(item => {
          const itemPiId = item.pi_id || firstPi.id;
          // 读取 PI 明细折扣，继承到 CI 成本事实快照
          const piItem = queryOne('SELECT id, pi_confirmed_qty, shipped_qty, discount FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [itemPiId, item.sku_code]);
          const discountRate = piItem ? (piItem.discount || 0) : 0;
          const netUnitPrice = (item.unit_price || 0) * (1 - discountRate);
          const amount = (item.shipped_qty || 0) * netUnitPrice;
          const sku = queryOne('SELECT reference_customs_rate FROM skus WHERE sku_code = ?', [item.sku_code]);
          const rateInput = item.actual_customs_rate;
          const actualCustomsRate = rateInput === '' || rateInput === null || rateInput === undefined
            ? (sku && sku.reference_customs_rate !== null ? Number(sku.reference_customs_rate) : null)
            : Number(rateInput);
          if (actualCustomsRate !== null && (!Number.isFinite(actualCustomsRate) || actualCustomsRate < 0)) {
            throw new Error(`SKU ${item.sku_code} 的实际关税税率必须为不小于0的数字`);
          }
          goodsAmount += amount;

          const itemPiNo = pis.find(p => p.id === itemPiId)?.pi_no || firstPi.pi_no;
          perPiGoodsAmount.set(itemPiId, (perPiGoodsAmount.get(itemPiId) || 0) + amount);

          run(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_no, pi_id, sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount, actual_customs_rate, inbound_qty, uninbound_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('cii'), ciId, ciNo, itemPiNo, itemPiId, item.sku_code, item.shipped_qty || 0, item.unit_price || 0, discountRate, netUnitPrice, amount, actualCustomsRate, 0, item.shipped_qty || 0]);

          // 更新PI明细的已发货数量
          if (piItem) {
            const newShipped = (piItem.shipped_qty || 0) + (item.shipped_qty || 0);
            run('UPDATE proforma_invoice_items SET shipped_qty = ?, unshipped_qty = ? WHERE id = ?',
              [newShipped, (piItem.pi_confirmed_qty || 0) - newShipped, piItem.id]);
          }
        });
        // 差异 = CI金额 - 已付定金 - 应付尾款（付款闭环校验），创建时为0
        run('UPDATE commercial_invoices SET goods_amount = ?, amount_difference = 0 WHERE id = ?', [goodsAmount, ciId]);

        // Per-PI 循环：R7 定金比例分摊 + per-PI balance payable_item + PI 更新
        for (const pi of pis) {
          const piGoodsAmount = perPiGoodsAmount.get(pi.id) || 0;
          if (piGoodsAmount <= 0) continue;

          // R7: 定金按实际出货货值比例分摊
          let shouldDeduct = 0;
          if (pi.need_deposit && (pi.available_deduct_deposit || 0) > 0) {
            const piRemainingUnshipped = (pi.total_amount || 0) - (pi.shipped_amount || 0);
            const newRemaining = piRemainingUnshipped - piGoodsAmount;
            if (piRemainingUnshipped <= 0.01 || newRemaining <= 0.01) {
              // 最后一次 CI — 吸收四舍五入残差（R9）
              shouldDeduct = pi.available_deduct_deposit || 0;
            } else {
              shouldDeduct = (pi.available_deduct_deposit || 0) * piGoodsAmount / piRemainingUnshipped;
            }
          }
          const payableBalance = piGoodsAmount - shouldDeduct;
          totalShouldDeduct += shouldDeduct;

          // per-PI balance payable_item（R5/R8: source_type='pi', source_ci_id=ciId）
          if (payableBalance > 0) {
            createPayableItemFromSource({
              sourceType: 'pi',
              sourceId: pi.id,
              sourceNo: pi.pi_no,
              sourceCiId: ciId,
              feeType: 'balance',
              categoryCode: 'goods',
              subcategoryCode: 'balance',
              payeeType: 'factory',
              payeeKey: `supplier:${pi.supplier_id || pi.supplier_name || d.supplier_name}`,
              payeeName: pi.supplier_name || d.supplier_name,
              currency: ciCurrency,
              payableAmount: payableBalance,
              payableDate: effectivePayableDate,
              createdBy: (req.currentUserId || req.user && req.user.id) || ''
            });
          }

          // 更新PI的已抵扣定金和已发货金额
          const newDeducted = (pi.deducted_deposit || 0) + shouldDeduct;
          const newAvailable = Math.max(0, (pi.payable_deposit || 0) - newDeducted);
          const newShippedAmount = (pi.shipped_amount || 0) + piGoodsAmount;
          const newUnshippedAmount = (pi.total_amount || 0) - newShippedAmount;
          run('UPDATE proforma_invoices SET deducted_deposit = ?, available_deduct_deposit = ?, shipped_amount = ?, unshipped_amount = ? WHERE id = ?',
            [newDeducted, newAvailable, newShippedAmount, newUnshippedAmount, pi.id]);

          // 更新PI状态
          const piItems = query('SELECT pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ?', [pi.id]).rows;
          const allShipped = piItems.every(i => i.shipped_qty >= i.pi_confirmed_qty);
          const anyShipped = piItems.some(i => i.shipped_qty > 0);
          if (allShipped) {
            run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['shipped_complete', pi.id]);
          } else if (anyShipped) {
            run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['partial_shipped', pi.id]);
          }
        }

        // CI Header 聚合
        const payableBalanceTotal = goodsAmount - totalShouldDeduct;
        run('UPDATE commercial_invoices SET should_deduct_deposit = ?, actual_deducted_deposit = ?, payable_balance = ?, unpaid_balance = ? WHERE id = ?',
          [totalShouldDeduct, totalShouldDeduct, payableBalanceTotal, payableBalanceTotal, ciId]);

        // 更新库存的在途数据
        await updateInventoryTransitData();
      }
    });
    const payableBalanceResp = goodsAmount - totalShouldDeduct;
    res.json({ id: ciId, ci_no: ciNo, ...d, goods_amount: goodsAmount, pi_total_amount: piTotalAmount, amount_difference: 0, should_deduct_deposit: totalShouldDeduct, payable_balance: payableBalanceResp });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.post('/api/commercial-invoices/:id/attachment', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
  try {
    const field = req.body.field === 'pl_attachment' ? 'pl_attachment' : 'attachment';
    run(`UPDATE commercial_invoices SET ${field} = ?, ci_status = ?, updated_at = datetime('now') WHERE id = ?`, [parseAttachment(req.body.attachment), req.body.attachment ? 'uploaded' : 'draft', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 出货附件（统一 CI/PL/报关/物流/其他） ====================
// 获取出货附件列表
app.get('/api/commercial-invoices/:id/shipping-attachments', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  const ci = queryOne('SELECT shipping_attachments FROM commercial_invoices WHERE id = ?', [req.params.id]);
  if (!ci) return res.status(404).json({ error: 'CI不存在' });
  try { res.json({ attachments: JSON.parse(ci.shipping_attachments || '[]') }); }
  catch(e) { res.json({ attachments: [] }); }
}));

// 上传出货附件��支持单个或多文件 base64）
app.post('/api/commercial-invoices/:id/shipping-attachments', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
  try {
    const { files } = req.body; // files: [{name, type, size, dataUrl, category}]
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: '请提供至少一个文件' });
    }
    const ci = queryOne('SELECT shipping_attachments FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });
    let existing = [];
    try { existing = JSON.parse(ci.shipping_attachments || '[]'); } catch(e) { existing = []; }
    const now = new Date().toISOString();
    const newFiles = files.map(f => ({
      id: 'att_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9),
      name: f.name || 'file',
      type: f.type || 'application/octet-stream',
      size: f.size || 0,
      dataUrl: f.dataUrl || '',
      category: f.category || 'other',
      uploaded_at: now
    }));
    const merged = existing.concat(newFiles);
    run('UPDATE commercial_invoices SET shipping_attachments = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [JSON.stringify(merged), req.params.id]);
    res.json({ success: true, attachments: merged, added: newFiles });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 删除出货附件
app.delete('/api/commercial-invoices/:id/shipping-attachments/:fileId', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
  try {
    const ci = queryOne('SELECT shipping_attachments FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });
    let existing = [];
    try { existing = JSON.parse(ci.shipping_attachments || '[]'); } catch(e) { existing = []; }
    const filtered = existing.filter(a => a.id !== req.params.fileId);
    if (filtered.length === existing.length) return res.status(404).json({ error: '文件不存在' });
    run('UPDATE commercial_invoices SET shipping_attachments = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [JSON.stringify(filtered), req.params.id]);
    res.json({ success: true, attachments: filtered });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// CI 软作废（置 cancelled + 必填原因 + 回写在途）
app.post('/api/commercial-invoices/:id/void', requireApiPermission('ci_edit'), asyncHandler(async (req, res) => {
  try {
    const { void_reason } = req.body;
    if (!void_reason) return res.status(400).json({ error: '作废原因不能为空' });
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });
    if (ci.ci_status === 'cancelled') return res.status(400).json({ error: '该 CI 已作废，不能重复作废' });
    if (ci.ci_status === 'completed' || ci.ci_status === 'partial_inbound') return res.status(400).json({ error: '已发货/入库的 CI 不允许作废' });
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const newRemark = (ci.remark ? ci.remark + '\n' : '') + `[作废 ${ts} by ${req.currentUserName || ''}] 原因: ${void_reason}`;
    run("UPDATE commercial_invoices SET ci_status = 'cancelled', remark = ?, updated_at = datetime('now') WHERE id = ?", [newRemark, ci.id]);
    await updateInventoryTransitData();
    logOperation({ operator_id: req.currentUserId, operator_name: req.currentUserName, page: 'commercial_invoice', operation_type: 'void', target_ids: [ci.id], affected_count: 1, old_values: { ci_status: ci.ci_status }, new_values: { ci_status: 'cancelled', void_reason }, reason: void_reason, triggered_recalc: 0, is_rollbackable: 0 });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// CI-REVERSE-01：冲销已入库 CI（反向恢复 PI 发货状态、库存、WAC、成本分摊等）
app.post('/api/commercial-invoices/:id/reverse', requireApiPermission('ci_edit'), asyncHandler(async (req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });
    if (ci.ci_status === 'reversed') return res.status(400).json({ error: '该 CI 已冲销，不能重复冲销' });
    if (ci.ci_status === 'cancelled') return res.status(400).json({ error: '已作废的 CI 不允许冲销' });
    if (ci.ci_status === 'draft' || ci.ci_status === 'uploaded' || ci.ci_status === 'ci_pl_uploaded' || ci.ci_status === 'shipped') {
      return res.status(400).json({ error: '仅已入库的 CI 允许冲销，请使用作废功能' });
    }

    // 前置检查：尾款 payable_item 是否有付款记录
    const paidBalances = query(
      `SELECT pi.id FROM payable_items pi
       JOIN payment_request_items pri ON pri.payable_item_id = pi.id
       JOIN payment_allocations pa ON pa.payment_request_item_id = pri.id AND pa.status = 'reconciled'
       WHERE pi.source_ci_id = ? AND pi.fee_type = 'balance' AND pi.lifecycle_status != 'released'
       LIMIT 1`,
      [ci.id]
    ).rows;
    if (paidBalances.length > 0) {
      return res.status(400).json({ error: '该 CI 的尾款已有付款记录，请先处理尾款付款后再冲销 CI' });
    }

    const operatorName = req.currentUserName || '';
    const operatorId = req.currentUserId || '';
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

    await transaction(async () => {
      // 1. 查询关联数据
      const ciItems = query('SELECT * FROM commercial_invoice_items WHERE ci_id = ?', [ci.id]).rows;
      const inbounds = query('SELECT * FROM inbound_records WHERE source_ci_id = ?', [ci.id]).rows;
      // LOGISTICS-CLOSED-LOOP-PHASE1: 适配多 PL，冲销所有关联 PL
      const pls = query('SELECT * FROM packing_lists WHERE related_ci_id = ?', [ci.id]).rows;
      const piIds = [...new Set(ciItems.map(i => i.pi_id).filter(Boolean))];

      // 2. 冲销入库记录
      for (const ib of inbounds) {
        run('UPDATE inbound_records SET inbound_status = ?, remark = ?, updated_at = datetime(\'now\') WHERE id = ?',
          ['reversed', (ib.remark ? ib.remark + '\n' : '') + `[冲销 ${ts} by ${operatorName}] CI ${ci.ci_no}`, ib.id]);
      }

      // 3. 冲销 PL（标记 remark）— 适配多 PL
      for (const pl of pls) {
        const plRemark = (pl.remark ? pl.remark + '\n' : '') + `[冲销 ${ts} by ${operatorName}] CI ${ci.ci_no} 已冲销`;
        run('UPDATE packing_lists SET remark = ? WHERE id = ?', [plRemark, pl.id]);
      }

      // 4. 回退库存（扣减 available_qty）
      for (const ib of inbounds) {
        const inv = queryOne('SELECT id, available_qty FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
          [ib.sku_code, ib.country || ci.country, ib.warehouse || ci.target_warehouse]);
        if (inv) {
          run('UPDATE inventory SET available_qty = available_qty - ?, updated_at = datetime(\'now\') WHERE id = ?',
            [ib.actual_qty || 0, inv.id]);
        }
      }

      // 5. 回退 WAC — 临时解除 lock 触发器约束后标记 reversed
      // PG 兼容：PG 触发器语法不同（需要 ON table / 不支持 CREATE TRIGGER IF NOT EXISTS SQLite 语法）
      // 使用 ALTER TABLE DISABLE/ENABLE TRIGGER（PG）或 DROP/CREATE TRIGGER（SQLite）
      var _isPg = process.env.DB_DRIVER === 'pg';
      if (_isPg) {
        run('ALTER TABLE wac_history DISABLE TRIGGER trg_wac_history_block_update');
        run('ALTER TABLE wac_history DISABLE TRIGGER trg_wac_history_block_delete');
      } else {
        run('DROP TRIGGER IF EXISTS trg_wac_history_block_update');
        run('DROP TRIGGER IF EXISTS trg_wac_history_block_delete');
      }
      run('UPDATE wac_history SET is_locked = 0, confirmation_status = \'reversed\' WHERE ci_id = ?', [ci.id]);
      if (_isPg) {
        run('ALTER TABLE wac_history ENABLE TRIGGER trg_wac_history_block_update');
        run('ALTER TABLE wac_history ENABLE TRIGGER trg_wac_history_block_delete');
      } else {
        run('CREATE TRIGGER IF NOT EXISTS trg_wac_history_block_update BEFORE UPDATE ON wac_history WHEN OLD.is_locked = 1 BEGIN SELECT RAISE(ABORT, \'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN\'); END');
        run('CREATE TRIGGER IF NOT EXISTS trg_wac_history_block_delete BEFORE DELETE ON wac_history WHEN OLD.is_locked = 1 BEGIN SELECT RAISE(ABORT, \'LOCKED_WAC_HISTORY_DELETE_FORBIDDEN\'); END');
      }

      // 6. 回退成本分摊 — 标记 reversed 并清除 ci_id 关联
      // PG 兼容：NULL || 'text' = NULL，需 COALESCE 防止丢失原值
      run('UPDATE cost_allocations SET allocation_basis = COALESCE(allocation_basis, \'\') || \' [reversed \' || ? || \']\', ci_id = \'\' WHERE ci_id = ?', [ts, ci.id]);

      // 7. 回退 PI items（shipped_qty / unshipped_qty）
      for (const citem of ciItems) {
        const piItem = queryOne('SELECT id, pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [citem.pi_id, citem.sku_code]);
        if (piItem) {
          const newShipped = Math.max(0, (piItem.shipped_qty || 0) - (citem.shipped_qty || 0));
          run('UPDATE proforma_invoice_items SET shipped_qty = ?, unshipped_qty = ? WHERE id = ?',
            [newShipped, Math.max(0, (piItem.pi_confirmed_qty || 0) - newShipped), piItem.id]);
        }
      }

      // 8. 回退 PI headers（deducted_deposit / available_deduct_deposit / shipped_amount / unshipped_amount / pi_status）
      const totalCiAmount = ciItems.reduce((s, i) => s + (i.ci_amount || 0), 0);
      for (const piId of piIds) {
        const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [piId]);
        if (!pi) continue;

        const piCiAmount = ciItems.filter(i => i.pi_id === piId).reduce((s, i) => s + (i.ci_amount || 0), 0);
        const piDeductRatio = totalCiAmount > 0 ? piCiAmount / totalCiAmount : 0;
        const piDeducted = Math.round((ci.actual_deducted_deposit || 0) * piDeductRatio * 100) / 100;

        const newDeducted = Math.max(0, (pi.deducted_deposit || 0) - piDeducted);
        const newAvailable = Math.max(0, (pi.payable_deposit || 0) - newDeducted);
        const newShippedAmount = Math.max(0, (pi.shipped_amount || 0) - piCiAmount);
        const newUnshippedAmount = Math.max(0, (pi.total_amount || 0) - newShippedAmount);

        run('UPDATE proforma_invoices SET deducted_deposit = ?, available_deduct_deposit = ?, shipped_amount = ?, unshipped_amount = ? WHERE id = ?',
          [newDeducted, newAvailable, newShippedAmount, newUnshippedAmount, piId]);

        // 重算 PI 状态（仅发货状态，不涉及付款/定金）
        const piItems2 = query('SELECT pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ?', [piId]).rows;
        if (pi.pi_status === 'cancelled') continue;
        const allShipped = piItems2.length > 0 && piItems2.every(i => i.shipped_qty >= i.pi_confirmed_qty);
        const anyShipped = piItems2.some(i => i.shipped_qty > 0);
        if (allShipped) {
          run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['shipped_complete', piId]);
        } else if (anyShipped) {
          run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['partial_shipped', piId]);
        } else {
          run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['pending', piId]);
        }
      }

      // 9. 释放 balance payable_items
      run('UPDATE payable_items SET lifecycle_status = \'released\' WHERE source_ci_id = ? AND fee_type = \'balance\' AND lifecycle_status = \'active\'', [ci.id]);

      // 10. CI 状态 → reversed
      const ciRemark = (ci.remark ? ci.remark + '\n' : '') + `[冲销 ${ts} by ${operatorName}]`;
      run('UPDATE commercial_invoices SET ci_status = \'reversed\', wac_confirmed = 0, wac_version_id = \'\', cost_confirmed = 0, cost_allocated = 0, original_inventory_imported = 0, remark = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [ciRemark, ci.id]);

      // 更新在途数据
      await updateInventoryTransitData();
    });

    logOperation({
      operator_id: operatorId, operator_name: operatorName,
      page: 'commercial_invoice', operation_type: 'reverse', target_ids: [ci.id], affected_count: 1,
      old_values: { ci_status: ci.ci_status }, new_values: { ci_status: 'reversed' },
      reason: '冲销已入库CI', triggered_recalc: 0, is_rollbackable: 0
    });

    res.json({ success: true, id: ci.id, ci_no: ci.ci_no });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// CI-SHIP-DATE-01：仅补充/更正运营 CI 的实际出货日期（不触发 payable_date、不动 due_date、不创建/修改 payment_request）
app.put('/api/commercial-invoices/:id/actual-ship-date', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
  try {
    const ci = queryOne('SELECT id, actual_ship_date FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });
    const shipDate = historicalCIDate(req.body.actual_ship_date, '实际出货日期', true);
    run('UPDATE commercial_invoices SET actual_ship_date = ?, updated_at = datetime(\'now\') WHERE id = ?', [shipDate, ci.id]);
    res.json({ success: true, id: ci.id, actual_ship_date: shipDate });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// ==================== PL 管理 ====================
app.post('/api/packing-lists', requireApiPermission('ci_create'), asyncHandler((req, res) => {
  try {
    const d = req.body;
    const plId = genId('pl');
    const plNo = d.pl_no || `PL-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    let totalCartons = 0, totalQtyAll = 0, totalGross = 0, totalNet = 0, totalCbm = 0;
    const ci = d.related_ci_id ? queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [d.related_ci_id]) : null;
    // P1-STATE-01C 守卫：运营链路 PL 必须关联真实存在的 CI，且 CI 不得为 cancelled（在任何 INSERT/UPDATE 之前）
    if (!d.related_ci_id) return res.status(400).json({ error: 'PL 必须关联 CI，不能直接创建' });
    if (!ci) return res.status(400).json({ error: '关联的CI不存在' });
    if (ci.ci_status === 'cancelled') return res.status(400).json({ error: '该 CI 已作废，不能创建 PL' });

    transaction(() => {
      run(`INSERT INTO packing_lists (id, pl_no, related_po_id, related_po_no, related_pi_id, related_pi_no, related_ci_id, related_ci_no, supplier_id, supplier_name, brand, country, target_warehouse, pl_date, total_qty, total_cartons, total_gross_weight, total_net_weight, total_cbm, attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [plId, plNo, d.related_po_id || (ci ? ci.related_po_id : ''), d.related_po_no || (ci ? ci.related_po_no : ''), d.related_pi_id || (ci ? ci.related_pi_id : ''), d.related_pi_no || (ci ? ci.related_pi_no : ''), d.related_ci_id || '', d.related_ci_no || '', d.supplier_id || (ci ? ci.supplier_id : ''), d.supplier_name || (ci ? ci.supplier_name : ''), d.brand || (ci ? ci.brand : ''), d.country || (ci ? ci.country : ''), d.target_warehouse || (ci ? ci.target_warehouse : ''), d.pl_date || new Date().toISOString().split('T')[0], 0, 0, 0, 0, 0, parseAttachment(d.attachment), d.remark || '']);

      if (d.items && d.items.length > 0) {
        // P2-7 守卫：PL 累计数量不得超过 CI shipped_qty（按 SKU 聚合本次 PL 数量，避免同 PL 内多行同 SKU 累加漏校验）
        if (d.related_ci_id) {
          const plQtyMap = new Map();
          d.items.forEach(item => {
            const sku = item.sku_code;
            const cartons = item.cartons || 0;
            const qtyPerCarton = item.qty_per_carton || 0;
            const totalQty = cartons * qtyPerCarton;
            plQtyMap.set(sku, (plQtyMap.get(sku) || 0) + (totalQty || 0));
          });
          for (const [sku, thisPlQty] of plQtyMap) {
            const ciItem = queryOne('SELECT id, shipped_qty FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [d.related_ci_id, sku]);
            if (ciItem) {
              const existPlSum = queryOne('SELECT COALESCE(SUM(pli.total_qty),0) as total FROM packing_list_items pli JOIN packing_lists pl ON pli.pl_id = pl.id WHERE pl.related_ci_id = ? AND pli.sku_code = ?', [d.related_ci_id, sku]);
              const newTotal = (existPlSum && existPlSum.total || 0) + thisPlQty;
              if (newTotal > (ciItem.shipped_qty || 0)) {
                throw new Error(`装箱单数量超过CI出货数量（SKU: ${sku}, CI出货数量: ${ciItem.shipped_qty || 0}, 已创建PL数量: ${existPlSum && existPlSum.total || 0}, 本次PL数量: ${thisPlQty}），请检查后重新提交。`);
              }
            }
          }
        }
        d.items.forEach(item => {
          const cartons = item.cartons || 0;
          const qtyPerCarton = item.qty_per_carton || 0;
          const totalQty = cartons * qtyPerCarton;
          const grossW = item.gross_weight || 0;
          const netW = item.net_weight || 0;
          const cbm = item.cbm || 0;
          totalCartons += cartons;
          totalQtyAll += totalQty;
          totalGross += grossW;
          totalNet += netW;
          totalCbm += cbm;
          run(`INSERT INTO packing_list_items (id, pl_id, pl_no, ci_no, sku_code, cartons, qty_per_carton, total_qty, gross_weight, net_weight, cbm, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('pli'), plId, plNo, d.related_ci_no || '', item.sku_code, cartons, qtyPerCarton, totalQty, grossW, netW, cbm, item.remark || '']);
        });
        run('UPDATE packing_lists SET total_qty = ?, total_cartons = ?, total_gross_weight = ?, total_net_weight = ?, total_cbm = ? WHERE id = ?',
          [totalQtyAll, totalCartons, totalGross, totalNet, totalCbm, plId]);
        if (d.related_ci_id) run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['ci_pl_uploaded', d.related_ci_id]);
      }
    });
    res.json({ id: plId, pl_no: plNo, ...d, total_qty: totalQtyAll, total_cartons: totalCartons, total_gross_weight: totalGross, total_net_weight: totalNet, total_cbm: totalCbm });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

function importResultWithMessages(result) {
  result.messages = [];
  if (result.errors.some(e => String(e.reason || '').includes('SKU不存在'))) result.messages.push('部分 SKU 不存在，请先维护 SKU 或检查导入文件。');
  if (result.errors.some(e => String(e.reason || '').includes('无法匹配PO'))) result.messages.push('部分数据无法匹配 PO，请检查 PO 编号。');
  if (result.errors.some(e => String(e.reason || '').includes('无法匹配CI'))) result.messages.push('部分数据无法匹配 CI，请检查 CI 编号。');
  return result;
}

app.post('/api/proforma-invoices/batch-import', requireApiPermission('pi_create'), asyncHandler((req, res) => {
  try {
    const rows = Array.isArray(req.body.items) ? req.body.items : [];
    const result = { success: 0, failed: 0, total: rows.length, errors: [] };
    transaction(async () => {
      rows.forEach((row, idx) => {
        // P0-FIX-2：每行独立 transaction（SAVEPOINT），单行失败只回滚当前行
        try {
          transaction(() => {
          const rowNo = idx + 2;
          const poNo = s(pick(row, ['关联PO编号', 'PO编号', 'related_po_no', 'po_no']));
          const sku = s(pick(row, ['SKU', 'sku_code']));
          if (!poNo) throw new Error('无法匹配PO：PO编号为空');
          const po = queryOne('SELECT * FROM purchase_orders WHERE po_no = ?', [poNo]);
          if (!po) throw new Error('无法匹配PO：' + poNo);
          if (po.approval_status !== 'approved') {
            throw new Error(
              'PO 尚未审批通过，不能生成 PI：' + poNo
            );
          }
          if (!skuExists(sku)) throw new Error('SKU不存在：' + sku);
          const piNo = s(pick(row, ['PI编号', 'pi_no'])) || `PI-${new Date().getFullYear()}-${String(Date.now() + idx).slice(-6)}`;
          const qty = n(pick(row, ['数量', 'PI数量', 'pi_confirmed_qty', 'qty']), 0);
          const price = n(pick(row, ['单价', 'unit_price']), 0);
          const amount = qty * price;
          const needDepositVal = s(pick(row, ['是否需要定金', 'need_deposit']));
          const needDeposit = needDepositVal === '否' || needDepositVal === '0' || needDepositVal.toLowerCase() === 'false' ? 0 : 1;
          const depositRatio = needDeposit ? n(pick(row, ['定金比例', 'deposit_ratio']), 0) : 0;
          // P2-6 守卫：批量导入 PI 累计数量不得超过 PO 数量（按 SKU 聚合已存在 PI items + 本次导入数量）
          const poItem = queryOne('SELECT id, po_qty FROM purchase_order_items WHERE po_id = ? AND sku_code = ?', [po.id, sku]);
          if (poItem) {
            const existPiSum = queryOne('SELECT COALESCE(SUM(pi_confirmed_qty),0) as total FROM proforma_invoice_items WHERE po_no = ? AND sku_code = ?', [po.po_no, sku]);
            const cumulativePi = (existPiSum && existPiSum.total || 0) + qty;
            if (cumulativePi > (poItem.po_qty || 0)) {
              throw new Error(`PI数量超过采购订单剩余数量（SKU: ${sku}, PO数量: ${poItem.po_qty || 0}, 已转PI数量: ${existPiSum && existPiSum.total || 0}, 本次PI数量: ${qty}），请检查后重新提交。`);
            }
          }
          const exist = queryOne('SELECT * FROM proforma_invoices WHERE pi_no = ?', [piNo]);
          let piId = exist ? exist.id : genId('pi');
          if (!exist) {
            run(`INSERT INTO proforma_invoices (id, pi_no, related_po_id, related_po_no, supplier_id, supplier_name, brand, country, target_warehouse, pi_date, currency, total_amount, need_deposit, deposit_ratio, balance_ratio, payment_terms, expected_delivery, attachment, remark, pi_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [piId, piNo, po.id, po.po_no, po.supplier_id || '', po.supplier_name || '', po.brand || '', po.country || '', po.target_warehouse || '', s(pick(row, ['PI日期', 'pi_date'])) || new Date().toISOString().split('T')[0], s(pick(row, ['币种', 'currency'])) || po.currency || 'USD', 0, needDeposit, depositRatio, 100 - depositRatio, s(pick(row, ['付款条件', 'payment_terms'])), s(pick(row, ['预计交期', 'expected_delivery'])), parseAttachment(row.attachment || ''), s(pick(row, ['备注', 'remark'])), 'uploaded']);
          }
          run(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('pii'), piId, piNo, po.po_no, sku, n(pick(row, ['PO数量', 'po_qty']), qty), qty, price, amount, 0, qty]);
          const totals = queryOne('SELECT COALESCE(SUM(pi_amount),0) as total FROM proforma_invoice_items WHERE pi_id = ?', [piId]);
          const totalAmount = totals.total || 0;
          const payableDeposit = needDeposit ? totalAmount * depositRatio / 100 : 0;
          run('UPDATE proforma_invoices SET total_amount=?, payable_deposit=?, available_deduct_deposit=? WHERE id=?', [totalAmount, payableDeposit, payableDeposit, piId]);
          run('UPDATE purchase_orders SET po_status=? WHERE id=?', ['transferred_pi', po.id]);
          // PAY-CORE P0-1：与单条 PI 创建路径对齐，生成/更新 deposit payable_item
          // createPayableItemFromSource 内部幂等：已存在 active 则跳过；金额通过 syncPayableItemAmount 同步
          if (needDeposit && payableDeposit > 0) {
            const finalCurrency = s(pick(row, ['币种', 'currency'])) || po.currency || 'USD';
            const payeeKey = `supplier:${po.supplier_id || po.supplier_name}`;
            const existingItem = findActivePayableItem('pi', piId, 'deposit');
            if (existingItem) {
              syncPayableItemAmount('pi', piId, 'deposit', payableDeposit);
            } else {
              createPayableItemFromSource({
                sourceType: 'pi',
                sourceId: piId,
                sourceNo: piNo,
                feeType: 'deposit',
                categoryCode: 'goods',
                subcategoryCode: 'deposit',
                payeeType: 'factory',
                payeeKey,
                payeeName: po.supplier_name || '',
                currency: finalCurrency,
                payableAmount: payableDeposit,
                createdBy: (req.currentUserId || req.user && req.user.id) || ''
              });
            }
          }
          });
          result.success++;
        } catch (e) {
          result.failed++;
          result.errors.push({ row: idx + 2, reason: e.message });
        }
      });
      // PI 批量导入后刷新在途字段（po_unconfirmed_pi_qty / pi_confirmed_unshipped_qty）
      await updateInventoryTransitData();
    });
    res.json(importResultWithMessages(result));
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.post('/api/commercial-invoices/batch-import', requireApiPermission('ci_create'), asyncHandler((req, res) => {
  try {
    const rows = Array.isArray(req.body.items) ? req.body.items : [];
    const result = { success: 0, failed: 0, total: rows.length, errors: [] };
    transaction(async () => {
      rows.forEach((row, idx) => {
        try {
          const poNo = s(pick(row, ['关联PO编号', 'PO编号', 'related_po_no', 'po_no']));
          const piNo = s(pick(row, ['关联PI编号', 'PI编号', 'related_pi_no', 'pi_no']));
          const sku = s(pick(row, ['SKU', 'sku_code']));
          if (!skuExists(sku)) throw new Error('SKU不存在：' + sku);
          // CI-SHIP-DATE-01：实际出货日期必填（批量导入也不得静默通过）
          const actualShipDate = historicalCIDate(s(pick(row, ['实际出货日期', 'actual_ship_date'])), '实际出货日期', true);
          let po = poNo ? queryOne('SELECT * FROM purchase_orders WHERE po_no = ?', [poNo]) : null;
          if (poNo && !po) throw new Error('无法匹配PO：' + poNo);
          const pi = piNo ? queryOne('SELECT * FROM proforma_invoices WHERE pi_no = ?', [piNo]) : null;
          // P1-STATE-01B 守卫①：运营链路 CI 必须关联 PI（在任何 INSERT/UPDATE 之前）
          if (!piNo) throw new Error('CI 必须关联 PI，不能直接创建');
          if (!pi) throw new Error('关联的PI不存在：' + piNo);
          // PAY-CREDIT-DUE-01：从 PI 已选付款条款快照 Credit 天数
          const ciCredit = resolveOperationalCiCreditSnapshot(pi ? pi.id : null);
          // P1-STATE-01B 守卫②：需定金且定金未付清，禁止生成 CI
          if (pi.need_deposit && pi.deposit_payment_status !== 'paid') throw new Error('PI 定金尚未付清，不能生成 CI：' + (pi.pi_no || pi.id));
          if (!po && pi?.related_po_no) po = queryOne('SELECT * FROM purchase_orders WHERE po_no = ?', [pi.related_po_no]);
          if (!po) throw new Error('无法匹配PO：PO编号为空或PI未关联PO');
          const ciNo = s(pick(row, ['CI编号', 'ci_no'])) || `CI-${new Date().getFullYear()}-${String(Date.now() + idx).slice(-6)}`;
          const qty = n(pick(row, ['数量', 'CI数量', 'shipped_qty', 'qty']), 0);
          const price = n(pick(row, ['单价', 'unit_price']), 0);
          // 读取 PI 明细折扣，继承到 CI 成本事实快照
          const piItemForDiscount = pi ? queryOne('SELECT discount FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [pi.id, sku]) : null;
          const discountRate = piItemForDiscount ? (piItemForDiscount.discount || 0) : 0;
          const netUnitPrice = price * (1 - discountRate);
          const amount = qty * netUnitPrice;
          const rateRaw = pick(row, ['实际关税税率', 'actual_customs_rate']);
          const skuRate = queryOne('SELECT reference_customs_rate FROM skus WHERE sku_code = ?', [sku]);
          const actualCustomsRate = rateRaw === '' || rateRaw === null || rateRaw === undefined
            ? (skuRate && skuRate.reference_customs_rate !== null ? Number(skuRate.reference_customs_rate) : null)
            : Number(rateRaw);
          if (actualCustomsRate !== null && (!Number.isFinite(actualCustomsRate) || actualCustomsRate < 0)) throw new Error('实际关税税率必须为不小于0的数字：' + sku);
          const exist = queryOne('SELECT * FROM commercial_invoices WHERE ci_no = ?', [ciNo]);
          if (exist && exist.cost_confirmed) throw new Error('该CI费用已确认，不能继续追加或修改CI明细：' + ciNo);
          // P2-6 守卫：批量导入 CI 累计 shipped_qty 不得超过 PI 确认数量（按 SKU 聚合已存在 CI items + 本次导入数量）
          if (pi) {
            const piItem = queryOne('SELECT id, pi_confirmed_qty, discount FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [pi.id, sku]);
            if (piItem) {
              const existCiSum = queryOne('SELECT COALESCE(SUM(shipped_qty),0) as total FROM commercial_invoice_items WHERE pi_no = ? AND sku_code = ?', [pi.pi_no, sku]);
              const cumulativeCi = (existCiSum && existCiSum.total || 0) + qty;
              if (cumulativeCi > (piItem.pi_confirmed_qty || 0)) {
                throw new Error(`CI出货数量超过PI剩余数量（SKU: ${sku}, PI确认数量: ${piItem.pi_confirmed_qty || 0}, 已发货数量: ${existCiSum && existCiSum.total || 0}, 本次CI数量: ${qty}），请检查后重新提交。`);
              }
            }
          }
          let ciId = exist ? exist.id : genId('ci');
          if (!exist) {
            run(`INSERT INTO commercial_invoices (id, ci_no, related_po_id, related_po_no, related_pi_id, related_pi_no, supplier_id, supplier_name, brand, country, target_warehouse, ci_date, actual_ship_date, payment_term_id, credit_days, currency, goods_amount, pi_total_amount, amount_difference, difference_reason, ci_status, attachment, pl_attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [ciId, ciNo, po.id, po.po_no, pi ? pi.id : '', pi ? pi.pi_no : '', po.supplier_id || '', po.supplier_name || '', po.brand || '', po.country || '', po.target_warehouse || '', s(pick(row, ['CI日期', 'ci_date'])) || new Date().toISOString().split('T')[0], actualShipDate, ciCredit.paymentTermId, ciCredit.creditDays, s(pick(row, ['币种', 'currency'])) || po.currency || 'USD', 0, pi ? (pi.total_amount || 0) : 0, 0, s(pick(row, ['差异原因', 'difference_reason'])), 'uploaded', parseAttachment(row.attachment || ''), parseAttachment(row.pl_attachment || ''), s(pick(row, ['备注', 'remark']))]);
          }
          run(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_no, pi_id, sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount, actual_customs_rate, inbound_qty, uninbound_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('cii'), ciId, ciNo, pi ? pi.pi_no : '', pi ? pi.id : '', sku, qty, price, discountRate, netUnitPrice, amount, actualCustomsRate, 0, qty]);
          const totals = queryOne('SELECT COALESCE(SUM(ci_amount),0) as total FROM commercial_invoice_items WHERE ci_id = ?', [ciId]);
          const goodsAmount = totals.total || 0;
          const piTotal = pi ? (pi.total_amount || 0) : 0;
          // R7: 定金按实际出货货值比例分摊
          let deduct = 0;
          if (pi && pi.need_deposit && (pi.available_deduct_deposit || 0) > 0) {
            const piRemainingUnshipped = (pi.total_amount || 0) - (pi.shipped_amount || 0);
            const newRemaining = piRemainingUnshipped - goodsAmount;
            if (piRemainingUnshipped <= 0.01 || newRemaining <= 0.01) {
              deduct = pi.available_deduct_deposit || 0;
            } else {
              deduct = (pi.available_deduct_deposit || 0) * goodsAmount / piRemainingUnshipped;
            }
          }
          run('UPDATE commercial_invoices SET goods_amount=?, amount_difference=0, should_deduct_deposit=?, actual_deducted_deposit=?, payable_balance=?, unpaid_balance=? WHERE id=?', [goodsAmount, deduct, deduct, goodsAmount - deduct, goodsAmount - deduct, ciId]);
          // PAY-CORE CI→付款事实闭环：CI batch import 补 per-PI balance payable_items（与单条 CI 6271 口径一致）
          // 复用 createPayableItemFromSource（幂等）；同 CI 同 PI 多行累积时直接 UPDATE 金额
          // （syncPayableItemAmount 不含 source_ci_id 维度，per-PI balance 不可用）
          const payableBalance = goodsAmount - deduct;
          if (pi && payableBalance > 0) {
            const ciCurrency = s(pick(row, ['币种', 'currency'])) || po.currency || 'USD';
            const balancePayeeKey = `supplier:${pi.supplier_id || pi.supplier_name || po.supplier_name}`;
            const existingBalanceItem = findActivePayableItem('pi', pi.id, 'balance', ciId);
            if (existingBalanceItem) {
              run('UPDATE payable_items SET payable_amount_minor = ? WHERE id = ? AND lifecycle_status = ?',
                [Math.round(payableBalance * 100), existingBalanceItem.id, 'active']);
            } else {
              createPayableItemFromSource({
                sourceType: 'pi', sourceId: pi.id, sourceNo: pi.pi_no, sourceCiId: ciId,
                feeType: 'balance', categoryCode: 'goods', subcategoryCode: 'balance',
                payeeType: 'factory', payeeKey: balancePayeeKey,
                payeeName: pi.supplier_name || po.supplier_name || '',
                currency: ciCurrency, payableAmount: payableBalance,
                payableDate: resolvePayableDate({ dueDate: '', creditDays: ciCredit.creditDays, baseDate: actualShipDate }),
                createdBy: (req.currentUserId || req.user && req.user.id) || ''
              });
            }
          }
          result.success++;
        } catch (e) {
          result.failed++;
          result.errors.push({ row: idx + 2, reason: e.message });
        }
      });
      // CI 批量导入（发货）后刷新在途字段（in_transit_qty / pi_confirmed_unshipped_qty）
      await updateInventoryTransitData();
    });
    res.json(importResultWithMessages(result));
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.post('/api/packing-lists/batch-import', requireApiPermission('ci_create'), asyncHandler((req, res) => {
  try {
    const rows = Array.isArray(req.body.items) ? req.body.items : [];
    const result = { success: 0, failed: 0, total: rows.length, errors: [] };
    transaction(() => {
      rows.forEach((row, idx) => {
        try {
          const ciNo = s(pick(row, ['关联CI编号', 'CI编号', 'related_ci_no', 'ci_no']));
          const poNo = s(pick(row, ['关联PO编号', 'PO编号', 'related_po_no', 'po_no']));
          const sku = s(pick(row, ['SKU', 'sku_code']));
          if (!skuExists(sku)) throw new Error('SKU不存在：' + sku);
          const ci = ciNo ? queryOne('SELECT * FROM commercial_invoices WHERE ci_no = ?', [ciNo]) : null;
          const po = poNo ? queryOne('SELECT * FROM purchase_orders WHERE po_no = ?', [poNo]) : null;
          if (poNo && !po) throw new Error('无法匹配PO：' + poNo);
          if (!ci) throw new Error('无法匹配CI：' + ciNo);
          // P1-STATE-01C 守卫：CI 已作废(cancelled)不允许创建 PL（保持逐行容忍，失败计入 errors）
          if (ci.ci_status === 'cancelled') throw new Error('该 CI 已作废，不能创建 PL：' + ciNo);
          const plNo = s(pick(row, ['PL编号', 'pl_no'])) || `PL-${new Date().getFullYear()}-${String(Date.now() + idx).slice(-6)}`;
          let pl = queryOne('SELECT * FROM packing_lists WHERE pl_no = ?', [plNo]);
          const plId = pl ? pl.id : genId('pl');
          if (!pl) {
            run(`INSERT INTO packing_lists (id, pl_no, related_po_id, related_po_no, related_pi_id, related_pi_no, related_ci_id, related_ci_no, supplier_id, supplier_name, brand, country, target_warehouse, pl_date, attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [plId, plNo, ci.related_po_id || (po ? po.id : ''), ci.related_po_no || poNo, ci.related_pi_id || '', ci.related_pi_no || '', ci.id, ci.ci_no, ci.supplier_id || '', ci.supplier_name || '', ci.brand || '', ci.country || '', ci.target_warehouse || '', s(pick(row, ['PL日期', 'pl_date'])) || new Date().toISOString().split('T')[0], parseAttachment(row.attachment || ''), s(pick(row, ['备注', 'remark']))]);
          }
          const cartons = n(pick(row, ['箱数', 'cartons']), 0);
          const qtyPerCarton = n(pick(row, ['每箱数量', 'qty_per_carton']), 0);
          const totalQty = n(pick(row, ['总数量', 'total_qty']), cartons * qtyPerCarton);
          // P2-7 守卫：批量导入 PL 累计数量不得超过 CI shipped_qty（按 CI + SKU 聚合已存在 PL 数量 + 本次导入数量）
          const ciItem = queryOne('SELECT id, shipped_qty FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [ci.id, sku]);
          if (ciItem) {
            const existPlSum = queryOne('SELECT COALESCE(SUM(pli.total_qty),0) as total FROM packing_list_items pli JOIN packing_lists pl ON pli.pl_id = pl.id WHERE pl.related_ci_id = ? AND pli.sku_code = ?', [ci.id, sku]);
            const cumulativePl = (existPlSum && existPlSum.total || 0) + totalQty;
            if (cumulativePl > (ciItem.shipped_qty || 0)) {
              throw new Error(`装箱单数量超过CI出货数量（SKU: ${sku}, CI出货数量: ${ciItem.shipped_qty || 0}, 已创建PL数量: ${existPlSum && existPlSum.total || 0}, 本次PL数量: ${totalQty}），请检查后重新提交。`);
            }
          }
          const gross = n(pick(row, ['单箱毛重', 'gross_weight']), 0) * (cartons || 1);
          const net = n(pick(row, ['单箱净重', 'net_weight']), 0) * (cartons || 1);
          const cbm = n(pick(row, ['单箱体积', 'cbm']), 0) * (cartons || 1);
          run(`INSERT INTO packing_list_items (id, pl_id, pl_no, ci_no, sku_code, cartons, qty_per_carton, total_qty, gross_weight, net_weight, cbm, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('pli'), plId, plNo, ci.ci_no, sku, cartons, qtyPerCarton, totalQty, gross, net, cbm, s(pick(row, ['备注', 'remark']))]);
          const totals = queryOne('SELECT COALESCE(SUM(total_qty),0) qty, COALESCE(SUM(cartons),0) cartons, COALESCE(SUM(gross_weight),0) gross, COALESCE(SUM(net_weight),0) net, COALESCE(SUM(cbm),0) cbm FROM packing_list_items WHERE pl_id=?', [plId]);
          run('UPDATE packing_lists SET total_qty=?, total_cartons=?, total_gross_weight=?, total_net_weight=?, total_cbm=? WHERE id=?', [totals.qty || 0, totals.cartons || 0, totals.gross || 0, totals.net || 0, totals.cbm || 0, plId]);
          run('UPDATE commercial_invoices SET ci_status=? WHERE id=?', ['ci_pl_uploaded', ci.id]);
          result.success++;
        } catch (e) {
          result.failed++;
          result.errors.push({ row: idx + 2, reason: e.message });
        }
      });
    });
    res.json(importResultWithMessages(result));
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 物流批次 ====================
app.get('/api/logistics-batches', requireApiPermission('logistics_view'), asyncHandler((req, res) => {
  const { logistics_display_status, keyword, forwarder_id, listing_status } = req.query;
  // LOGISTICS-LISTING-01（2026-08-07 owner 多选）：listing_owner_ids 为逗号分隔多 ID，姓名由 resolveOwnerNames 解析，避免对逗号列表做 JOIN
  let sql = 'SELECT lb.*, pl.pl_no, pl.id AS pl_id, pl.status AS pl_status FROM logistics_batches lb LEFT JOIN packing_lists pl ON pl.logistics_batch_id = lb.id WHERE 1=1';
  const params = [];
  if (forwarder_id) { sql += ' AND lb.forwarder_id = ?'; params.push(forwarder_id); }
  if (keyword) { sql += ' AND (lb.batch_no LIKE ? OR lb.forwarder_name LIKE ? OR lb.related_ci_no LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY lb.created_at DESC';
  let rows = query(sql, params).rows;

  // LOGISTICS-LISTING-01（2026-08-07 修复）：一次性批量解析所有上架负责人姓名，避免逐行 N+1 查询
  const ownerNameMap = resolveOwnerNameMap(rows.flatMap(r => splitIdCsv(r.listing_owner_ids)));

  // ── 派生 logistics_display_status + inbound_derived_status（不修改底层 logistics_status） ──
  // 物流展示状态纯粹由 logistics_status 映射，入库状态由 Inbound 事实派生
  const ciIds = [...new Set(rows.map(r => r.related_ci_id).filter(Boolean))];
  const ciInboundMap = {}; // ci_id → 'none' | 'partial' | 'completed'
  if (ciIds.length > 0) {
    const placeholders = ciIds.map(() => '?').join(',');
    const itemRows = query(`SELECT ci_id, shipped_qty, inbound_qty FROM commercial_invoice_items WHERE ci_id IN (${placeholders})`, ciIds).rows;
    const ciItemMap = {};
    itemRows.forEach(it => {
      if (!ciItemMap[it.ci_id]) ciItemMap[it.ci_id] = { totalShipped: 0, totalInbound: 0 };
      ciItemMap[it.ci_id].totalShipped += (it.shipped_qty || 0);
      ciItemMap[it.ci_id].totalInbound += (it.inbound_qty || 0);
    });
    ciIds.forEach(cid => {
      const agg = ciItemMap[cid];
      if (!agg || agg.totalShipped === 0) { ciInboundMap[cid] = 'none'; return; }
      if (agg.totalInbound >= agg.totalShipped) { ciInboundMap[cid] = 'completed'; return; }
      if (agg.totalInbound > 0) { ciInboundMap[cid] = 'partial'; return; }
      ciInboundMap[cid] = 'none';
    });
  }

  // 注入派生字段 + 按 logistics_display_status / listing_status 筛选
  rows = rows.filter(r => {
    r.logistics_display_status = deriveLogisticsDisplayStatus(r.logistics_status);
    r.inbound_derived_status = r.related_ci_id ? (ciInboundMap[r.related_ci_id] || 'none') : 'none';
    // LOGISTICS-LISTING-01（2026-08-07 owner 多选）：listing_owner_ids 解析为数组 + 姓名数组
    if (!r.listing_status) r.listing_status = 'pending_plan';
    const oids = splitIdCsv(r.listing_owner_ids);
    r.listing_owner_ids = oids;
    r.listing_owner_names = namesFromMap(oids, ownerNameMap);
    if (logistics_display_status && r.logistics_display_status !== logistics_display_status) return false;
    if (listing_status && r.listing_status !== listing_status) return false;
    return true;
  });

  res.json(rows);
}));

app.get('/api/logistics-batches/:id', requireApiPermission('logistics_view'), asyncHandler((req, res) => {
  const batch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [req.params.id]);
  if (!batch) return res.status(404).json({ error: '物流批次不存在' });
  // P2: 返回关联 PL 信息
  const pl = queryOne('SELECT * FROM packing_lists WHERE logistics_batch_id = ?', [req.params.id]);

  // 派生 logistics_display_status + inbound_derived_status
  let inboundDerivedStatus = 'none';
  if (batch.related_ci_id) {
    const itemRows = query('SELECT shipped_qty, inbound_qty FROM commercial_invoice_items WHERE ci_id = ?', [batch.related_ci_id]).rows;
    let totalShipped = 0, totalInbound = 0;
    itemRows.forEach(it => { totalShipped += (it.shipped_qty || 0); totalInbound += (it.inbound_qty || 0); });
    if (totalShipped > 0 && totalInbound >= totalShipped) inboundDerivedStatus = 'completed';
    else if (totalInbound > 0) inboundDerivedStatus = 'partial';
  }

  const gOwnerIds = splitIdCsv(batch.listing_owner_ids);

  // Freight payment facts: query real settlement records for this batch
  let freightPaymentFacts = null;
  if (batch.related_ci_id && batch.total_freight > 0) {
    const freightCostItems = query(
      `SELECT id, payment_request_id, payable_amount, currency
       FROM ci_cost_items
       WHERE ci_id = ? AND logistics_batch_id = ? AND include_in_landing_cost = 1
         AND cost_category = 'warehouse_arrival' AND cost_subcategory = 'freight'`,
      [batch.related_ci_id, batch.id]
    ).rows;
    const itemsWithPr = freightCostItems.filter(i => i.payment_request_id);
    const freightPrIds = [...new Set(itemsWithPr.map(i => i.payment_request_id))];
    if (freightPrIds.length > 0) {
      const ph = freightPrIds.map(() => '?').join(',');
      const freightLogs = query(
        `SELECT payment_request_id, amount, local_amount, local_rate, local_rate_date, local_currency, paid_date
         FROM payment_settlement_logs
         WHERE payment_request_id IN (${ph})
           AND event_type = 'payment' AND status = 'applied'
         ORDER BY paid_date`,
        freightPrIds
      ).rows;
      if (freightLogs.length > 0) {
        const localTotal = freightLogs.reduce((s, l) => s + (Number(l.local_amount) || 0), 0);
        const paidTotal = freightLogs.reduce((s, l) => s + (Number(l.amount) || 0), 0);
        const lastPaidDate = freightLogs.reduce((max, l) => (l.paid_date && l.paid_date > max ? l.paid_date : max), '');
        freightPaymentFacts = {
          has_real_settlement: true,
          payment_breakdown: freightLogs.map(l => ({
            payment_request_id: l.payment_request_id,
            amount: Number(l.amount) || 0,
            local_amount: Number(l.local_amount) || 0,
            local_rate: Number(l.local_rate) || 0,
            local_rate_date: l.local_rate_date || '',
            local_currency: l.local_currency || '',
            paid_date: l.paid_date || ''
          })),
          last_paid_date: lastPaidDate,
          effective_rate: batch.total_freight > 0 ? localTotal / batch.total_freight : null,
          paid_total: paidTotal,
          local_total: localTotal
        };
      }
    }
    if (!freightPaymentFacts) {
      freightPaymentFacts = { has_real_settlement: false };
    }
  }

  res.json({ ...batch, pl_id: pl ? pl.id : '', pl_no: pl ? pl.pl_no : '', pl_status: pl ? pl.status : '', logistics_display_status: deriveLogisticsDisplayStatus(batch.logistics_status), inbound_derived_status: inboundDerivedStatus, listing_owner_ids: gOwnerIds, listing_owner_names: resolveOwnerNames(gOwnerIds), freight_payment_facts: freightPaymentFacts });
}));

// 注意：这是无前端调用方的遗留裸接口（前端统一走 /create-with-pl）。
// LOGISTICS-LISTING-01：此处 listing_owner_ids 为「可选」而非必填，以免破坏未知的外部/脚本调用方；
// 传了才校验、写参与人并发通知，不传则 listing_owner_ids 留空、不发通知（扫描时会跳过无负责人的单）。
// 前端入口 /create-with-pl 才是必填校验所在。
app.post('/api/logistics-batches', requireApiPermission('logistics_create'), asyncHandler((req, res) => {
  try {
    const d = req.body;
    const bId = genId('log');
    const bNo = d.batch_no || `LOG-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const totalFreight = (d.international_freight || 0) + (d.local_charges || 0) + (d.customs_service_fee || 0) + (d.delivery_fee || 0);

    // LOGISTICS-LISTING-01（2026-08-07 owner 多选）：遗留裸接口保持可选——传了 listing_owner_ids 才校验/写参与人/通知
    const bareOwnerIds = Array.isArray(d.listing_owner_ids) ? d.listing_owner_ids.map(s => String(s).trim()).filter(Boolean) : [];
    const bareOwners = [];
    for (const oid of bareOwnerIds) {
      const u = queryOne('SELECT id, name, status FROM users WHERE id = ?', [oid]);
      if (!u) return res.status(400).json({ error: '上架负责人不存在' });
      if (u.status !== 'active') return res.status(400).json({ error: '上架负责人已停用' });
      bareOwners.push(u);
    }
    run(`INSERT INTO logistics_batches (id, batch_no, related_ci_id, related_ci_no, forwarder_id, forwarder_name, transport_mode, origin_port, dest_port, target_country, target_warehouse, pickup_date, depart_date, eta_date, actual_arrival_date, customs_start_date, customs_end_date, delivery_date, inbound_complete_date, logistics_status, total_cartons, total_weight, total_cbm, freight_currency, international_freight, local_charges, customs_service_fee, delivery_fee, total_freight, customs_duty, vat_gst, other_fees, fee_status, remark, listing_status, listing_owner_ids, listing_status_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bId, bNo, d.related_ci_id || '', d.related_ci_no || '', d.forwarder_id || '', d.forwarder_name || '', d.transport_mode || 'sea', d.origin_port || '', d.dest_port || '', d.target_country || '', d.target_warehouse || '', d.pickup_date || '', d.depart_date || '', d.eta_date || '', d.actual_arrival_date || '', d.customs_start_date || '', d.customs_end_date || '', d.delivery_date || '', d.inbound_complete_date || '', d.logistics_status || 'pending', d.total_cartons || 0, d.total_weight || 0, d.total_cbm || 0, d.freight_currency || 'USD', d.international_freight || 0, d.local_charges || 0, d.customs_service_fee || 0, d.delivery_fee || 0, totalFreight, d.customs_duty || 0, d.vat_gst || 0, d.other_fees || 0, d.fee_status || 'unpaid', d.remark || '', 'pending_plan', bareOwnerIds.join(','), new Date().toISOString().slice(0, 19).replace('T', ' ')]);

    if (bareOwners.length > 0) {
      for (const ow of bareOwners) {
        run('INSERT INTO business_participants (id, business_type, business_id, participant_type, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)',
          [genId('bp'), 'logistics', bId, 'owner', ow.id, ow.name || '']);
      }
      // 个人通知与群通知共用同一份物流通知 ctx（loadListingNotifyCtx 为唯一数据源），字段完全一致，避免两套格式
      const gctx = loadListingNotifyCtx(bId);
      if (gctx) {
        notifyBusinessParticipants('logistics', bId, 'logistics_listing_created', gctx).catch(() => {});
        // 群通知（可选）：中文群(FEISHU_GROUP_CHAT_IDS)发中文、英文群(FEISHU_GROUP_CHAT_IDS_EN)发英文；两 env 均空则跳过
        const gc = buildListingNotifyCards(bNo, gctx);
        notifyFeishuGroupsCard(gc.zh, gc.en).catch(() => {});
      }
    }
    res.json({ id: bId, batch_no: bNo, ...d, total_freight: totalFreight });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// LOGISTICS-CLOSED-LOOP-PHASE1: 合并创建事务 — PL + 物流批次在同一事务中创建
// 前端以"新建物流批次"为入口，后台保持 CI → PL → Logistics 三层独立事实
// PL → Logistics Batch 一对一模型（Phase 1）
app.post('/api/logistics-batches/create-with-pl', requireApiPermission('logistics_create'), asyncHandler((req, res) => {
  try {
    const d = req.body;

    // ====== 前置校验（事务外，快速失败） ======
    if (!d.related_ci_id) return res.status(400).json({ error: '必须关联 CI' });
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [d.related_ci_id]);
    if (!ci) return res.status(400).json({ error: '关联的 CI 不存在' });
    if (ci.ci_status === 'cancelled') return res.status(400).json({ error: '该 CI 已作废，不能创建 PL' });

    // PL 单号唯一性校验（如用户手动指定）
    const plNo = d.pl_no || `PL-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    if (d.pl_no) {
      const existPl = queryOne('SELECT id FROM packing_lists WHERE pl_no = ?', [plNo]);
      if (existPl) return res.status(409).json({ error: `PL 单号 ${plNo} 已存在` });
    }

    // 物流单号唯一性校验（如用户手动指定）
    const bNo = d.batch_no || `LOG-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    if (d.batch_no) {
      const existBatch = queryOne('SELECT id FROM logistics_batches WHERE batch_no = ?', [bNo]);
      if (existBatch) return res.status(409).json({ error: `物流单号 ${bNo} 已存在` });
    }

    // PL 明细非空校验
    if (!d.items || !Array.isArray(d.items) || d.items.length === 0) {
      return res.status(400).json({ error: 'PL 明细不能为空' });
    }

    // 零行和负数校验
    for (const item of d.items) {
      const qty = Number(item.total_qty) || 0;
      if (qty <= 0) return res.status(400).json({ error: `SKU ${item.sku_code} 的数量必须大于 0` });
    }

    // LOGISTICS-LISTING-01（2026-08-07 owner 多选）：上架负责人支持多选且至少选择 1 人（运营协作承担上架责任）。
    const ownerIds = Array.isArray(d.listing_owner_ids) ? d.listing_owner_ids.map(s => String(s).trim()).filter(Boolean) : [];
    if (ownerIds.length === 0) return res.status(400).json({ error: '上架负责人至少选择 1 人' });
    const listingOwners = [];
    for (const oid of ownerIds) {
      const u = queryOne('SELECT id, name, status FROM users WHERE id = ?', [oid]);
      if (!u) return res.status(400).json({ error: '上架负责人不存在' });
      if (u.status !== 'active') return res.status(400).json({ error: '上架负责人已停用' });
      listingOwners.push(u);
    }

    // CC 校验（可选，去重；停用用户直接拒绝，与 CI ops-prep 行为对齐）
    const listingCcRaw = Array.isArray(d.listing_cc_user_ids) ? d.listing_cc_user_ids : [];
    const listingCcList = [];
    const listingCcSeen = new Set(ownerIds);
    for (const raw of listingCcRaw) {
      const uid = (raw || '').toString().trim();
      if (!uid || listingCcSeen.has(uid)) continue;
      const u = queryOne('SELECT id, name, status FROM users WHERE id = ?', [uid]);
      if (!u) return res.status(400).json({ error: '抄送人「' + uid + '」不存在' });
      if (u.status !== 'active') return res.status(400).json({ error: '抄送人「' + (u.name || uid) + '」已停用，无法抄送' });
      listingCcSeen.add(uid);
      listingCcList.push({ id: u.id, name: u.name });
    }

    const plId = genId('pl');
    const bId = genId('log');
    let totalCartons = 0, totalQtyAll = 0, totalGross = 0, totalNet = 0, totalCbm = 0;
    const totalFreight = (d.international_freight || 0) + (d.local_charges || 0) + (d.customs_service_fee || 0) + (d.delivery_fee || 0);

    transaction(() => {
      // ====== 步骤 1: 校验 CI 仍存在足够的剩余数量（事务内，防并发占用） ======
      const plQtyMap = new Map();
      d.items.forEach(item => {
        const sku = item.sku_code;
        const qty = item.total_qty || ((item.cartons || 0) * (item.qty_per_carton || 0));
        plQtyMap.set(sku, (plQtyMap.get(sku) || 0) + (qty || 0));
      });
      for (const [sku, thisPlQty] of plQtyMap) {
        // 使用 SUM 聚合同一 SKU 的所有 CI 明细行（CI 可能包含同 SKU 多行）
        const ciSumRow = queryOne('SELECT COALESCE(SUM(shipped_qty),0) as total_qty FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [d.related_ci_id, sku]);
        const ciQty = ciSumRow ? (ciSumRow.total_qty || 0) : 0;
        if (ciQty <= 0) throw new Error(`SKU ${sku} 不在 CI 明细中，不能创建 PL`);
        const existPlSum = queryOne('SELECT COALESCE(SUM(pli.total_qty),0) as total FROM packing_list_items pli JOIN packing_lists pl ON pli.pl_id = pl.id WHERE pl.related_ci_id = ? AND pli.sku_code = ?', [d.related_ci_id, sku]);
        const newTotal = (existPlSum && existPlSum.total || 0) + thisPlQty;
        if (newTotal > ciQty) {
          throw new Error(`装箱单数量超过CI出货数量（SKU: ${sku}, CI出货数量: ${ciQty}, 已创建PL数量: ${existPlSum && existPlSum.total || 0}, 本次PL数量: ${thisPlQty}），请检查后重新提交。`);
        }
      }

      // ====== 步骤 2: 创建 PL Header ======
      run(`INSERT INTO packing_lists (id, pl_no, related_po_id, related_po_no, related_pi_id, related_pi_no, related_ci_id, related_ci_no, supplier_id, supplier_name, brand, country, target_warehouse, pl_date, total_qty, total_cartons, total_gross_weight, total_net_weight, total_cbm, attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [plId, plNo, d.related_po_id || ci.related_po_id || '', d.related_po_no || ci.related_po_no || '', d.related_pi_id || ci.related_pi_id || '', d.related_pi_no || ci.related_pi_no || '', d.related_ci_id, d.related_ci_no || ci.ci_no || '', d.supplier_id || ci.supplier_id || '', d.supplier_name || ci.supplier_name || '', d.brand || ci.brand || '', d.country || ci.country || '', d.target_warehouse || ci.target_warehouse || '', d.pl_date || new Date().toISOString().split('T')[0], 0, 0, 0, 0, 0, parseAttachment(d.attachment), d.remark || '']);

      // ====== 步骤 3: 创建 PL Items ======
      d.items.forEach(item => {
        const cartons = item.cartons || 0;
        const qtyPerCarton = item.qty_per_carton || 0;
        const totalQty = Number(item.total_qty) || 0;
        const grossW = item.gross_weight || 0;
        const netW = item.net_weight || 0;
        const cbm = item.cbm || 0;
        totalCartons += cartons;
        totalQtyAll += totalQty;
        totalGross += grossW;
        totalNet += netW;
        totalCbm += cbm;
        run(`INSERT INTO packing_list_items (id, pl_id, pl_no, ci_no, sku_code, cartons, qty_per_carton, total_qty, gross_weight, net_weight, cbm, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [genId('pli'), plId, plNo, d.related_ci_no || ci.ci_no || '', item.sku_code, cartons, qtyPerCarton, totalQty, grossW, netW, cbm, item.remark || '']);
      });

      // 前端可传入手动输入的总CTN数量，覆盖按明细行累加的值
      if (d.total_cartons !== undefined && d.total_cartons !== null && d.total_cartons !== '') {
        totalCartons = parseInt(d.total_cartons) || 0;
      }

      // ====== 步骤 4: 更新 PL Header 汇总 ======
      run('UPDATE packing_lists SET total_qty = ?, total_cartons = ?, total_gross_weight = ?, total_net_weight = ?, total_cbm = ? WHERE id = ?',
        [totalQtyAll, totalCartons, totalGross, totalNet, totalCbm, plId]);

      // ====== 步骤 5: 创建物流批次 ======
      // LOGISTICS-LISTING-01：listing_status 恒以 'pending_plan'（待提交上架计划）初始化，不接受前端指定；
      // listing_status_updated_at 以创建时刻为停滞提醒的首个计算基准。
      run(`INSERT INTO logistics_batches (id, batch_no, related_ci_id, related_ci_no, forwarder_id, forwarder_name, transport_mode, origin_port, dest_port, target_country, target_warehouse, pickup_date, depart_date, eta_date, actual_arrival_date, customs_start_date, customs_end_date, delivery_date, inbound_complete_date, logistics_status, total_cartons, total_weight, total_cbm, freight_currency, international_freight, local_charges, customs_service_fee, delivery_fee, total_freight, customs_duty, vat_gst, other_fees, fee_status, remark, listing_status, listing_owner_ids, listing_status_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bId, bNo, d.related_ci_id, d.related_ci_no || ci.ci_no || '', d.forwarder_id || '', d.forwarder_name || '', d.transport_mode || 'sea', d.origin_port || '', d.dest_port || '', d.target_country || ci.country || '', d.target_warehouse || ci.target_warehouse || '', d.pickup_date || '', d.depart_date || '', d.eta_date || '', d.actual_arrival_date || '', d.customs_start_date || '', d.customs_end_date || '', d.delivery_date || '', d.inbound_complete_date || '', d.logistics_status || 'pending', totalCartons, totalGross, totalCbm, d.freight_currency || 'USD', d.international_freight || 0, d.local_charges || 0, d.customs_service_fee || 0, d.delivery_fee || 0, totalFreight, d.customs_duty || 0, d.vat_gst || 0, d.other_fees || 0, d.fee_status || 'unpaid', d.remark || '', 'pending_plan', ownerIds.join(','), new Date().toISOString().slice(0, 19).replace('T', ' ')]);

      // LOGISTICS-LISTING-01（2026-08-07 owner 多选）：写入上架参与人（多个 owner + cc），复用通用 business_participants 表
      for (const ow of listingOwners) {
        run('INSERT INTO business_participants (id, business_type, business_id, participant_type, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)',
          [genId('bp'), 'logistics', bId, 'owner', ow.id, ow.name || '']);
      }
      for (const c of listingCcList) {
        run('INSERT INTO business_participants (id, business_type, business_id, participant_type, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)',
          [genId('bp'), 'logistics', bId, 'cc', c.id, c.name || '']);
      }

      // ====== 步骤 6: 关联 PL → 物流批次 + 更新 PL 状态为 confirmed ======
      run('UPDATE packing_lists SET logistics_batch_id = ?, status = ?, updated_at = ? WHERE id = ?',
        [bId, 'confirmed', new Date().toISOString().slice(0, 19).replace('T', ' '), plId]);

      // ====== 步骤 7: 更新 CI 状态 ======
      run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['ci_pl_uploaded', d.related_ci_id]);
    });

    // LOGISTICS-LISTING-01：物流单 Created 后立即通知上架负责人 + CC
    // 事务外 best-effort：飞书异常不回滚物流单，与既有 ci_ops_assigned 通知一致的容错策略。
    // 个人通知与群通知共用同一份物流通知 ctx（loadListingNotifyCtx 为唯一数据源），字段完全一致
    const gctx2 = loadListingNotifyCtx(bId);
    if (gctx2) {
      notifyBusinessParticipants('logistics', bId, 'logistics_listing_created', gctx2).catch(() => {});
      // 群通知（可选）：中文群(FEISHU_GROUP_CHAT_IDS)发中文、英文群(FEISHU_GROUP_CHAT_IDS_EN)发英文；两 env 均空则跳过
      const gc = buildListingNotifyCards(bNo, gctx2);
      notifyFeishuGroupsCard(gc.zh, gc.en).catch(() => {});
    }

    res.json({
      pl_id: plId,
      pl_no: plNo,
      logistics_batch_id: bId,
      batch_no: bNo,
      total_qty: totalQtyAll,
      total_cartons: totalCartons,
      total_gross_weight: totalGross,
      total_net_weight: totalNet,
      total_cbm: totalCbm,
      total_freight: totalFreight
    });
  } catch (e) {
    // 区分业务校验错误（400）和系统错误（500）
    const msg = e.message || '';
    if (msg.includes('超过CI') || msg.includes('不在 CI') || msg.includes('必须') || msg.includes('已存在') || msg.includes('不能为空')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
}));

app.put('/api/logistics-batches/:id', requireApiPermission('logistics_edit'), asyncHandler(async (req, res) => {
  try {
    const d = req.body;
    const { id } = req.params;

    // LOGISTICS-CLOSED-LOOP-PHASE1: 查询当前记录（用于状态门禁 + 运费重算）
    const existing = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '物流批次不存在' });

    // LOGISTICS-CLOSED-LOOP-PHASE1: batch_no 编辑 — 状态门禁 + 唯一性校验
    if (d.batch_no !== undefined && d.batch_no !== existing.batch_no) {
      if (existing.logistics_status === 'completed' || existing.logistics_status === 'cancelled') {
        return res.status(400).json({ error: '物流批次已完成或已取消，不能修改物流单号' });
      }
      const dup = queryOne('SELECT id FROM logistics_batches WHERE batch_no = ? AND id != ?', [d.batch_no, id]);
      if (dup) return res.status(409).json({ error: `物流单号 ${d.batch_no} 已存在` });
    }

    // 物流保存 + 费用事实同步 — 同一事务，原子保证
    const syncResult = await transaction(async () => {
      const fields = [];
      const values = [];
      const allowed = ['batch_no', 'forwarder_id', 'forwarder_name', 'transport_mode', 'origin_port', 'dest_port', 'target_country', 'target_warehouse', 'pickup_date', 'depart_date', 'eta_date', 'actual_arrival_date', 'customs_start_date', 'customs_end_date', 'delivery_date', 'inbound_complete_date', 'logistics_status', 'total_cartons', 'total_weight', 'total_cbm', 'freight_currency', 'international_freight', 'local_charges', 'customs_service_fee', 'delivery_fee', 'customs_duty', 'vat_gst', 'other_fees', 'fee_status', 'remark'];
      allowed.forEach(f => {
        if (d[f] !== undefined) { fields.push(`${f} = ?`); values.push(d[f]); }
      });
      if (d.international_freight !== undefined || d.local_charges !== undefined || d.customs_service_fee !== undefined || d.delivery_fee !== undefined) {
        const intl = d.international_freight !== undefined ? d.international_freight : existing.international_freight;
        const local = d.local_charges !== undefined ? d.local_charges : existing.local_charges;
        const customs = d.customs_service_fee !== undefined ? d.customs_service_fee : existing.customs_service_fee;
        const delivery = d.delivery_fee !== undefined ? d.delivery_fee : existing.delivery_fee;
        const total = (intl || 0) + (local || 0) + (customs || 0) + (delivery || 0);
        fields.push('total_freight = ?');
        values.push(total);
      }
      fields.push(`updated_at = datetime('now')`);
      values.push(id);
      run(`UPDATE logistics_batches SET ${fields.join(', ')} WHERE id = ?`, values);

      // Re-read updated batch and sync cost facts
      const updatedBatch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [id]);
      return syncLogisticsCostFactsCore(updatedBatch, {
        createdBy: (req.currentUserId || (req.user && req.user.id)) || '',
        payeeName: ''
      });
    });

    // Post-transaction: transit recalc + status logging (outside tx, failure-safe)
    if (d.logistics_status !== undefined && d.logistics_status !== existing.logistics_status) {
      const wasArrived = existing.logistics_status === LOGISTICS_STATUS_ARRIVED;
      const nowArrived = d.logistics_status === LOGISTICS_STATUS_ARRIVED;
      if (wasArrived !== nowArrived) {
        try {
          await updateInventoryTransitData();
        } catch (err) {
          console.error('[transit-recalc] 物流状态边界变更后重算在途失败:', err && err.message ? err.message : err);
        }
      }
    }
    if (d.logistics_status !== undefined) {
      const oldDisplay = deriveLogisticsDisplayStatus(existing.logistics_status);
      const newDisplay = deriveLogisticsDisplayStatus(d.logistics_status);
      if (oldDisplay !== newDisplay) {
        logOperation({
          operator_id: req.currentUserId, operator_name: req.currentUserName,
          page: 'logistics', operation_type: 'logistics_status_change',
          target_ids: [id], affected_count: 1,
          old_values: { logistics_status: existing.logistics_status, display_status: oldDisplay },
          new_values: { logistics_status: d.logistics_status, display_status: newDisplay, batch_no: existing.batch_no },
          reason: (d.reason || '').toString(), triggered_recalc: 0, is_rollbackable: 0
        });
        notifyListingStatusChanged(id, existing.logistics_status, d.logistics_status, 'logistics').catch(() => {});
      }
    }
    res.json({ success: true, cost_sync: (syncResult && syncResult.synced) || [] });
  } catch (e) {
    if (e.status) res.status(e.status).json({ error: e.message, code: e.code || '', detail: e.detail || {} });
    else res.status(500).json({ error: e.message });
  }
}));

// ==================== LOGISTICS-LISTING-01：Listing 上架状态管理 ====================
// 刻意不把 listing_status 并入上面的通用 PUT 白名单：状态变更必须经过本端点，
// 以保证「修改人/修改时间/原状态/新状态」100% 落 operation_logs，无绕过留痕的路径。
// 与 CI 的 PUR-OPS-COLLAB-01（ops_ready_status）完全独立，本端点不读写 commercial_invoices。

// 读取某物流单的上架状态（含 CC 列表与变更历史）
app.get('/api/logistics-batches/:id/listing', requireApiPermission('logistics_view'), asyncHandler((req, res) => {
  try {
    const lb = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [req.params.id]);
    if (!lb) return res.status(404).json({ error: '物流单不存在' });
    const cc = query('SELECT user_id, user_name FROM business_participants WHERE business_type=? AND business_id=? AND participant_type=?', ['logistics', lb.id, 'cc']).rows;
    const gOwnerIds = splitIdCsv(lb.listing_owner_ids);
    const ownerNames = resolveOwnerNames(gOwnerIds);
    // 变更历史：从 operation_logs 反查（target_ids 是 JSON 数组字符串，用 LIKE 匹配本单 id）
    const history = query(
      `SELECT operator_name, operation_type, old_values, new_values, created_at FROM operation_logs
       WHERE page = ? AND operation_type IN (?, ?) AND target_ids LIKE ? ORDER BY created_at DESC LIMIT 50`,
      ['logistics', 'listing_status_change', 'listing_owner_change', '%' + lb.id + '%']
    ).rows.map(r => {
      let ov = {}, nv = {};
      try { ov = JSON.parse(r.old_values || '{}'); } catch (e) {}
      try { nv = JSON.parse(r.new_values || '{}'); } catch (e) {}
      return { operator_name: r.operator_name || '', operation_type: r.operation_type, old_values: ov, new_values: nv, created_at: r.created_at };
    });
    res.json({
      batch_no: lb.batch_no,
      eta_date: lb.eta_date || '',
      listing_status: lb.listing_status || 'pending_plan',
      listing_owner_ids: gOwnerIds,
      listing_owner_names: ownerNames,
      listing_status_updated_at: lb.listing_status_updated_at || '',
      cc: cc.map(r => ({ user_id: r.user_id, user_name: r.user_name })),
      history
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 修改上架状态 / 上架负责人 / CC（运营手动操作入口）
app.post('/api/logistics-batches/:id/listing', requireApiPermission('logistics_edit'), asyncHandler((req, res) => {
  try {
    const lb = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [req.params.id]);
    if (!lb) return res.status(404).json({ error: '物流单不存在' });

    const hasStatus = Object.prototype.hasOwnProperty.call(req.body, 'listing_status');
    const hasOwner = Object.prototype.hasOwnProperty.call(req.body, 'listing_owner_ids');
    const hasCc = Object.prototype.hasOwnProperty.call(req.body, 'listing_cc_user_ids');
    if (!hasStatus && !hasOwner && !hasCc) return res.status(400).json({ error: '未提供任何可修改字段' });

    const oldStatus = lb.listing_status || 'pending_plan';
    const newStatus = hasStatus ? (req.body.listing_status || '').toString().trim() : oldStatus;
    if (hasStatus && !LISTING_STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: '非法的上架状态：' + newStatus });
    }

    const oldOwnerIds = splitIdCsv(lb.listing_owner_ids);
    const oldOwnerKey = oldOwnerIds.join(',');
    const oldCcIds = query('SELECT user_id FROM business_participants WHERE business_type=? AND business_id=? AND participant_type=?', ['logistics', lb.id, 'cc']).rows.map(r => r.user_id);
    let newOwnerIds = oldOwnerIds;
    let newOwners = [];
    if (hasOwner) {
      newOwnerIds = Array.isArray(req.body.listing_owner_ids) ? req.body.listing_owner_ids.map(s => String(s).trim()).filter(Boolean) : [];
      if (newOwnerIds.length === 0) return res.status(400).json({ error: '上架负责人至少选择 1 人' });
      for (const oid of newOwnerIds) {
        const u = queryOne('SELECT id, name, status FROM users WHERE id = ?', [oid]);
        if (!u) return res.status(400).json({ error: '上架负责人不存在' });
        if (u.status !== 'active') return res.status(400).json({ error: '上架负责人已停用' });
        newOwners.push(u);
      }
    }

    const ccList = [];
    if (hasCc) {
      const raws = Array.isArray(req.body.listing_cc_user_ids) ? req.body.listing_cc_user_ids : [];
      const seen = new Set(newOwnerIds);
      for (const raw of raws) {
        const uid = (raw || '').toString().trim();
        if (!uid || seen.has(uid)) continue;
        const u = queryOne('SELECT id, name, status FROM users WHERE id = ?', [uid]);
        if (!u) return res.status(400).json({ error: '抄送人「' + uid + '」不存在' });
        if (u.status !== 'active') return res.status(400).json({ error: '抄送人「' + (u.name || uid) + '」已停用，无法抄送' });
        seen.add(uid);
        ccList.push({ id: u.id, name: u.name });
      }
    }

    const statusChanged = hasStatus && newStatus !== oldStatus;
    const ownerChanged = hasOwner && newOwnerIds.join(',') !== oldOwnerKey;
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

    transaction(() => {
      if (statusChanged) {
        // 状态变化即刷新基准时间并清空两个提醒哨兵 —— 这就是需求「按状态变化重新计算」的落点：
        // 停滞计时从此刻重新起算，且当天可以再次触发提醒而不被昨日哨兵挡住。
        run('UPDATE logistics_batches SET listing_status = ?, listing_status_updated_at = ?, listing_remind_date = ?, listing_eta_remind_date = ?, updated_at = ? WHERE id = ?',
          [newStatus, nowStr, '', '', nowStr, lb.id]);
      }
      if (ownerChanged) {
        run('UPDATE logistics_batches SET listing_owner_ids = ?, updated_at = ? WHERE id = ?', [newOwnerIds.join(','), nowStr, lb.id]);
        run('DELETE FROM business_participants WHERE business_type=? AND business_id=? AND participant_type=?', ['logistics', lb.id, 'owner']);
        for (const ow of newOwners) {
          run('INSERT INTO business_participants (id, business_type, business_id, participant_type, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)',
            [genId('bp'), 'logistics', lb.id, 'owner', ow.id, ow.name || '']);
        }
      }
      if (hasCc) {
        run('DELETE FROM business_participants WHERE business_type=? AND business_id=? AND participant_type=?', ['logistics', lb.id, 'cc']);
        for (const c of ccList) {
          run('INSERT INTO business_participants (id, business_type, business_id, participant_type, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)',
            [genId('bp'), 'logistics', lb.id, 'cc', c.id, c.name || '']);
        }
      }
    });

    // 需求四：变更留痕（修改人 / 修改时间 / 原状态 / 新状态）。
    // operator_id + operator_name 来自当前登录态，created_at 由 operation_logs 表默认值写入。
    if (statusChanged) {
      logOperation({
        operator_id: req.currentUserId, operator_name: req.currentUserName,
        page: 'logistics', operation_type: 'listing_status_change',
        target_ids: [lb.id], affected_count: 1,
        old_values: { listing_status: oldStatus },
        new_values: { listing_status: newStatus, batch_no: lb.batch_no },
        reason: (req.body.reason || '').toString(), triggered_recalc: 0, is_rollbackable: 0
      });
    }
    // 状态变化通知（上架状态）：上架负责人 + 抄送 + 中文群/英文群，复用 Listing Card 并附 Status Update 段
    if (statusChanged) {
      notifyListingStatusChanged(lb.id, oldStatus, newStatus, 'listing').catch(() => {});
    }
    if (ownerChanged) {
      const oldOwnerNames = resolveOwnerNames(oldOwnerIds);
      const newOwnerNames = resolveOwnerNames(newOwnerIds);
      logOperation({
        operator_id: req.currentUserId, operator_name: req.currentUserName,
        page: 'logistics', operation_type: 'listing_owner_change',
        target_ids: [lb.id], affected_count: 1,
        old_values: { listing_owner_ids: oldOwnerIds, listing_owner_names: oldOwnerNames },
        new_values: { listing_owner_ids: newOwnerIds, listing_owner_names: newOwnerNames, batch_no: lb.batch_no },
        reason: (req.body.reason || '').toString(), triggered_recalc: 0, is_rollbackable: 0
      });
    }

    // Listing 编辑增量通知：仅当负责人或抄送发生变化且确有「新增」人员时，才通知新增的上架负责人 / 抄送人（不每次普通编辑都通知）。
    const addedOwnerIds = ownerChanged ? newOwnerIds.filter(id => !oldOwnerIds.includes(id)) : [];
    const addedCcIds = hasCc ? ccList.map(c => c.id).filter(id => !oldCcIds.includes(id)) : [];
    if (addedOwnerIds.length || addedCcIds.length) {
      notifyListingDelta(lb.id, lb.batch_no, addedOwnerIds, addedCcIds, lb.eta_date || '').catch(() => {});
    }

    res.json({ success: true, listing_status: newStatus, listing_owner_ids: newOwnerIds, status_changed: statusChanged, owner_changed: ownerChanged });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 手动发送上架提醒：收件人 = 当前物流单的上架负责人 + 抄送(CC)，复用现有 notifyBusinessParticipants（logistics_listing_manual_reminder 模板）。
// 正文含关联CI 与 当前负责人，供运营补发提醒 / 测试飞书链路 / 防止遗漏。不影响其他通知逻辑。
app.post('/api/logistics-batches/:id/notify', requireApiPermission('logistics_edit'), asyncHandler((req, res) => {
  try {
    const lb = queryOne('SELECT id, batch_no, eta_date FROM logistics_batches WHERE id = ?', [req.params.id]);
    if (!lb) return res.status(404).json({ error: '物流单不存在' });
    // 个人通知与群通知共用同一份物流通知 ctx（loadListingNotifyCtx 为唯一数据源），避免两套逻辑字段不一致
    const ctx = loadListingNotifyCtx(lb.id);
    if (ctx) {
      // 个人通知：按收件人 language_preference 各自语言；群通知：中文群/英文群分别发送中/英正文。两者共用同一 ctx 与同一正文模板，字段完全一致
      notifyBusinessParticipants('logistics', lb.id, 'logistics_listing_manual_reminder', ctx).catch(() => {});
      // 群通知（可选）：FEISHU_GROUP_CHAT_IDS(中文群)/FEISHU_GROUP_CHAT_IDS_EN(英文群) 为空则跳过
      const gc = buildListingNotifyCards(ctx.code, ctx);
      notifyFeishuGroupsCard(gc.zh, gc.en).catch(() => {});
    }
    res.json({ success: true, notified: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 历史事实补录 (Historical Backfill) ====================

// A. 补录到货事实：写回 logistics_batches.actual_arrival_date + remark
app.post('/api/logistics-batches/:id/backfill-arrival', requireApiPermission('logistics_edit'), asyncHandler(async (req, res) => {
  const batch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [req.params.id]);
  if (!batch) return res.status(404).json({ error: '物流批次不存在' });
  const { actual_arrival_date, evidence } = req.body;
  if (!actual_arrival_date) return res.status(400).json({ error: '实际到港日期不能为空' });
  const auditRemark = evidence ? `[补录凭证: ${evidence}]` : '';
  const newRemark = batch.remark
    ? batch.remark + (auditRemark ? ' ' + auditRemark : '')
    : auditRemark;
  await run('UPDATE logistics_batches SET actual_arrival_date = ?, remark = ? WHERE id = ?',
    [actual_arrival_date, newRemark, batch.id]);
  res.json({ success: true, actual_arrival_date, batch_id: batch.id });
}));

// B. 补录运费付款事实：写入 payment_requests + ci_cost_items + payment_settlement_logs
app.post('/api/logistics-batches/:id/backfill-freight-payment', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  const batch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [req.params.id]);
  if (!batch) return res.status(404).json({ error: '物流批次不存在' });
  if (!batch.related_ci_id) return res.status(400).json({ error: '物流批次未关联CI' });
  const d = req.body;
  if (!d.original_amount || !d.original_currency || !d.paid_date || !d.local_currency || !d.local_rate || !d.local_rate_date || !d.local_amount)
    return res.status(400).json({ error: '所有付款事实字段均为必填' });

  // Check if freight cost item already exists for this batch
  let costItem = queryOne(
    `SELECT * FROM ci_cost_items
     WHERE ci_id = ? AND logistics_batch_id = ? AND include_in_landing_cost = 1
       AND cost_category = 'warehouse_arrival' AND cost_subcategory = 'freight'`,
    [batch.related_ci_id, batch.id]
  );

  let paymentRequest = null;
  if (costItem && costItem.payment_request_id) {
    paymentRequest = queryOne('SELECT * FROM payment_requests WHERE id = ?', [costItem.payment_request_id]);
  }

  // Create payment_request if not exists
  if (!paymentRequest) {
    const prId = genId('pr');
    const prNo = `PR-FREIGHT-${batch.batch_no}-${Date.now().toString().slice(-6)}`;
    await run(
      `INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, payee_key, payee_name_snapshot, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_status, approval_status, remark)
       VALUES (?, ?, 'logistics', 'freight', 'logistics_batch', ?, ?, 'forwarder', ?, ?, ?, ?, 0, 0, ?, 'approved', 'approved', ?)`,
      [prId, prNo, batch.id, batch.batch_no, batch.forwarder_name || 'forwarder', batch.forwarder_name || 'forwarder', batch.forwarder_name || '',
       d.original_amount, d.original_currency, `[历史补录] ${d.evidence || ''}`]
    );
    paymentRequest = { id: prId, request_no: prNo, currency: d.original_currency };
  }

  // Create or update ci_cost_items
  if (!costItem) {
    const ciId = genId('ci');
    await run(
      `INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, logistics_batch_id, remark)
       VALUES (?, ?, ?, ?, ?, 'warehouse_arrival', 'freight', ?, ?, 1, ?, ?, ?, ?)`,
      [ciId, batch.related_ci_id, batch.related_ci_no || '', paymentRequest.id, paymentRequest.request_no,
       d.original_amount, d.original_amount, batch.forwarder_name || '', d.original_currency, batch.id, '[历史补录]']
    );
  } else if (!costItem.payment_request_id) {
    await run('UPDATE ci_cost_items SET payment_request_id = ?, request_no = ?, paid_amount = ? WHERE id = ?',
      [paymentRequest.id, paymentRequest.request_no, d.original_amount, costItem.id]);
  }

  // Check if settlement log already exists
  const existingLog = queryOne(
    'SELECT id FROM payment_settlement_logs WHERE payment_request_id = ? AND event_type = ? AND status = ? AND amount = ? AND paid_date = ?',
    [paymentRequest.id, 'payment', 'applied', d.original_amount, d.paid_date]
  );
  if (existingLog) {
    return res.status(409).json({ error: '相同的付款记录已存在', payment_request_id: paymentRequest.id });
  }

  // Create payment_settlement_log
  const logId = genId('psl');
  await run(
    `INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status, paid_date, original_currency, settlement_country, local_currency, local_rate, local_rate_date, local_rate_type, local_amount, reason, is_legacy)
     VALUES (?, ?, 'payment', ?, 'applied', ?, ?, ?, ?, ?, ?, 'realtime', ?, ?, 1)`,
    [logId, paymentRequest.id, d.original_amount, d.paid_date, d.original_currency, batch.target_country || '',
     d.local_currency, d.local_rate, d.local_rate_date, d.local_amount, `[历史补录] ${d.evidence || ''}`]
  );

  // Update payment_request paid/unpaid amounts
  const totalPaid = query(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM payment_settlement_logs WHERE payment_request_id = ? AND event_type = ? AND status = ?',
    [paymentRequest.id, 'payment', 'applied']
  ).rows[0].total;
  await run('UPDATE payment_requests SET paid_amount = ?, unpaid_amount = ?, payment_status = ? WHERE id = ?',
    [totalPaid, Math.max(0, d.original_amount - totalPaid), totalPaid >= d.original_amount ? 'paid' : 'partial', paymentRequest.id]);

  // Update ci_cost_items paid_amount
  await run('UPDATE ci_cost_items SET paid_amount = ? WHERE payment_request_id = ? AND logistics_batch_id = ?',
    [totalPaid, paymentRequest.id, batch.id]);

  res.json({
    success: true,
    payment_request_id: paymentRequest.id,
    settlement_log_id: logId,
    batch_id: batch.id
  });
}));

// ==================== 入库管理 ====================
app.get('/api/inbound-records', requireApiPermission('inbound_view'), asyncHandler((req, res) => {
  const { status, keyword, source_ci } = req.query;
  let sql = `SELECT ir.*, s.product_name, s.brand, pl.pl_no AS source_pl_no FROM inbound_records ir LEFT JOIN skus s ON ir.sku_code = s.sku_code LEFT JOIN packing_lists pl ON ir.source_pl_id = pl.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND ir.inbound_status = ?'; params.push(status); }
  if (source_ci) { sql += ' AND ir.source_ci_no = ?'; params.push(source_ci); }
  if (keyword) { sql += ' AND (ir.inbound_no LIKE ? OR ir.sku_code LIKE ? OR s.product_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY ir.inbound_date DESC, ir.created_at DESC';
  res.json(query(sql, params).rows);
}));

// P1-STATE-01D：只读 PL 列表（入库页面选择 PL 用，使用现有 ci_view 权限，不增加新业务状态）
app.get('/api/packing-lists', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  try {
    const rows = query(`SELECT p.id, p.pl_no, p.related_ci_id, p.related_ci_no, p.supplier_name, p.brand, p.country, p.target_warehouse, p.pl_date, p.total_qty,
      (SELECT COUNT(*) FROM packing_list_items WHERE pl_id = p.id) AS item_count
      FROM packing_lists p ORDER BY p.created_at DESC`).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// P1-STATE-01D：只读 PL 明细（含 item.id 与已入库/剩余累计，供入库选择定位 PL 明细）
// LOGISTICS-CLOSED-LOOP-PHASE1: 增加关联物流批次信息返回
app.get('/api/packing-lists/:id', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  try {
    const pl = queryOne('SELECT * FROM packing_lists WHERE id = ?', [req.params.id]);
    if (!pl) return res.status(404).json({ error: 'PL不存在' });
    const items = query('SELECT * FROM packing_list_items WHERE pl_id = ? ORDER BY created_at', [req.params.id]).rows;
    items.forEach(it => {
      const r = queryOne('SELECT COALESCE(SUM(actual_qty),0) AS s FROM inbound_records WHERE source_pl_item_id = ?', [it.id]);
      it.received_qty = r ? r.s : 0;
      it.remaining_qty = (it.total_qty || 0) - it.received_qty;
    });
    // 如果 PL 已关联物流批次，返回物流批次信息
    let logistics_batch = null;
    if (pl.logistics_batch_id) {
      logistics_batch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [pl.logistics_batch_id]);
    }
    res.json({ ...pl, items, logistics_batch });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// LOGISTICS-CLOSED-LOOP-PHASE1: PL 编辑接口（含状态门禁）
// 支持编辑 PL Header 字段 + PL Items（增/改/删），全部在同一事务中完成
// 状态门禁：已部分入库时 PL 数量不能低于已入库数量，已完全入库时禁止修改 SKU 和数量
app.put('/api/packing-lists/:id', requireApiPermission('logistics_edit'), asyncHandler((req, res) => {
  try {
    const d = req.body;
    const { id } = req.params;

    const pl = queryOne('SELECT * FROM packing_lists WHERE id = ?', [id]);
    if (!pl) return res.status(404).json({ error: 'PL不存在' });

    // pl_no 唯一性校验
    if (d.pl_no !== undefined && d.pl_no !== pl.pl_no) {
      const dup = queryOne('SELECT id FROM packing_lists WHERE pl_no = ? AND id != ?', [d.pl_no, id]);
      if (dup) return res.status(409).json({ error: `PL 单号 ${d.pl_no} 已存在` });
    }

    transaction(() => {
      // ====== 1. 更新 PL Header 字段（白名单） ======
      const headerAllowed = ['pl_no', 'target_warehouse', 'pl_date', 'remark', 'attachment'];
      const fields = [];
      const values = [];
      headerAllowed.forEach(f => {
        if (d[f] !== undefined) {
          fields.push(`${f} = ?`);
          values.push(f === 'attachment' ? parseAttachment(d[f]) : d[f]);
        }
      });

      // pl_no 变更时同步更新 packing_list_items.pl_no
      if (d.pl_no !== undefined && d.pl_no !== pl.pl_no) {
        run('UPDATE packing_list_items SET pl_no = ? WHERE pl_id = ?', [d.pl_no, id]);
      }

      if (fields.length > 0) {
        fields.push(`updated_at = datetime('now')`);
        values.push(id);
        run(`UPDATE packing_lists SET ${fields.join(', ')} WHERE id = ?`, values);
      }

      // ====== 2. 更新 PL Items（如果提供了 items 数组） ======
      if (d.items && Array.isArray(d.items)) {
        // 处理删除（已有入库记录的不允许删除）
        d.items.filter(i => i._delete && i.id).forEach(item => {
          const received = queryOne('SELECT COALESCE(SUM(actual_qty),0) AS s FROM inbound_records WHERE source_pl_item_id = ?', [item.id]);
          if (received && received.s > 0) {
            throw new Error(`已有入库记录的 PL 明细不能删除`);
          }
          run('DELETE FROM packing_list_items WHERE id = ? AND pl_id = ?', [item.id, id]);
        });

        // 处理新增和修改
        d.items.filter(i => !i._delete).forEach(item => {
          if (item.id) {
            // ====== 编辑现有 item ======
            const existing = queryOne('SELECT * FROM packing_list_items WHERE id = ? AND pl_id = ?', [item.id, id]);
            if (!existing) throw new Error(`PL 明细 ${item.id} 不存在`);

            // 查询已入库数量
            const received = queryOne('SELECT COALESCE(SUM(actual_qty),0) AS s FROM inbound_records WHERE source_pl_item_id = ?', [item.id]);
            const receivedQty = received ? received.s : 0;

            // 状态门禁：已完全入库时禁止修改 SKU 和数量
            if (receivedQty > 0 && receivedQty >= (existing.total_qty || 0)) {
              if ((item.sku_code !== undefined && item.sku_code !== existing.sku_code) ||
                  (item.total_qty !== undefined && item.total_qty !== existing.total_qty)) {
                throw new Error(`SKU ${existing.sku_code} 已完全入库，不能修改 SKU 或数量`);
              }
            }

            // 状态门禁：已部分入库时数量不能低于已入库数量
            if (receivedQty > 0 && item.total_qty !== undefined && item.total_qty < receivedQty) {
              throw new Error(`SKU ${existing.sku_code} 已入库 ${receivedQty} 件，PL 数量不能低于已入库数量`);
            }

            const itemAllowed = ['sku_code', 'cartons', 'qty_per_carton', 'total_qty', 'gross_weight', 'net_weight', 'cbm', 'remark'];
            const itemFields = [];
            const itemValues = [];
            itemAllowed.forEach(f => {
              if (item[f] !== undefined) { itemFields.push(`${f} = ?`); itemValues.push(item[f]); }
            });
            if (itemFields.length > 0) {
              itemValues.push(item.id);
              run(`UPDATE packing_list_items SET ${itemFields.join(', ')} WHERE id = ?`, itemValues);
            }
          } else {
            // ====== 新增 item ======
            if (!item.sku_code) throw new Error('新增 PL 明细必须提供 SKU');
            const ciItem = queryOne('SELECT id, shipped_qty FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [pl.related_ci_id, item.sku_code]);
            if (!ciItem) throw new Error(`SKU ${item.sku_code} 不在 CI 明细中，不能添加`);

            const cartons = item.cartons || 0;
            const qtyPerCarton = item.qty_per_carton || 0;
            const totalQty = Number(item.total_qty) || 0;
            if (totalQty <= 0) throw new Error(`SKU ${item.sku_code} 的数量必须大于 0`);

            // 校验 CI 剩余数量（排除当前 PL 自身已占用的）
            const existPlSum = queryOne('SELECT COALESCE(SUM(pli.total_qty),0) as total FROM packing_list_items pli JOIN packing_lists pl ON pli.pl_id = pl.id WHERE pl.related_ci_id = ? AND pli.sku_code = ? AND pli.pl_id != ?', [pl.related_ci_id, item.sku_code, id]);
            const newTotal = (existPlSum && existPlSum.total || 0) + totalQty;
            if (newTotal > (ciItem.shipped_qty || 0)) {
              throw new Error(`装箱单数量超过 CI 出货数量（SKU: ${item.sku_code}, CI 出货数量: ${ciItem.shipped_qty || 0}, 其他 PL 已占: ${existPlSum && existPlSum.total || 0}, 本次新增: ${totalQty}）`);
            }

            run(`INSERT INTO packing_list_items (id, pl_id, pl_no, ci_no, sku_code, cartons, qty_per_carton, total_qty, gross_weight, net_weight, cbm, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [genId('pli'), id, d.pl_no || pl.pl_no, pl.related_ci_no, item.sku_code, cartons, qtyPerCarton, totalQty, item.gross_weight || 0, item.net_weight || 0, item.cbm || 0, item.remark || '']);
          }
        });

        // ====== 3. 重算 PL Header 汇总 ======
        const totals = queryOne('SELECT COALESCE(SUM(total_qty),0) as qty, COALESCE(SUM(cartons),0) as cartons, COALESCE(SUM(gross_weight),0) as gw, COALESCE(SUM(net_weight),0) as nw, COALESCE(SUM(cbm),0) as cbm FROM packing_list_items WHERE pl_id = ?', [id]);
        run("UPDATE packing_lists SET total_qty = ?, total_cartons = ?, total_gross_weight = ?, total_net_weight = ?, total_cbm = ?, updated_at = datetime('now') WHERE id = ?",
          [totals.qty, totals.cartons, totals.gw, totals.nw, totals.cbm, id]);
      }
    });

    res.json({ success: true });
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('已存在') || msg.includes('不能') || msg.includes('超过') || msg.includes('不在') || msg.includes('必须') || msg.includes('已有入库')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
}));

// P1-STATE-01D：单笔入库——强制关联真实 PL 明细，写入前完成 18 步守卫
app.post('/api/inbound-records', requireApiPermission('inbound_create'), asyncHandler((req, res) => {
  try {
    const d = req.body;
    if (!d.sku_code || !d.inbound_date) return res.status(400).json({ error: 'SKU和入库日期不能为空' });

    // ===== P1-STATE-01D 守卫（任何 INSERT/UPDATE 前完成）=====
    // 1. actual_qty 必须 > 0
    const rawActualQty = d.actual_qty;
    if (rawActualQty === null || rawActualQty === undefined || String(rawActualQty).trim() === '') {
      return res.status(400).json({ error: '实际入库数量必须为正整数（大于0）' });
    }
    const actualQty = Number(rawActualQty);
    if (!Number.isFinite(actualQty) || !Number.isInteger(actualQty) || actualQty <= 0) {
      return res.status(400).json({ error: '实际入库数量必须为正整数（大于0）' });
    }

    // 2. source_pl_item_id 必填
    const sourcePlItemId = String(d.source_pl_item_id || '').trim();
    if (!sourcePlItemId) {
      return res.status(400).json({ error: '必须关联 PL 明细（source_pl_item_id 必填）' });
    }

    // 3. packing_list_items.id 必须存在
    const plItem = queryOne('SELECT * FROM packing_list_items WHERE id = ?', [sourcePlItemId]);
    if (!plItem) {
      return res.status(400).json({ error: 'PL明细不存在（source_pl_item_id 无效）' });
    }

    // 4. source_pl_id 由 pl_item.pl_id 获取或校验一致（不信任客户端传入值，若传了则须一致）
    const sourcePlId = String(plItem.pl_id || '').trim();
    if (!sourcePlId) {
      return res.status(400).json({ error: 'PL明细缺少所属 PL（pl_id 为空）' });
    }
    if (d.source_pl_id && String(d.source_pl_id).trim() && String(d.source_pl_id).trim() !== sourcePlId) {
      return res.status(400).json({ error: 'source_pl_id 与 PL明细所属 PL 不一致' });
    }

    // 5. packing_lists.id 必须存在
    const pl = queryOne('SELECT * FROM packing_lists WHERE id = ?', [sourcePlId]);
    if (!pl) {
      return res.status(400).json({ error: 'PL不存在（source_pl_id 无效）' });
    }

    // 6. sku_code 必须与 pl_item.sku_code 一致
    if (String(plItem.sku_code || '').trim() !== String(d.sku_code || '').trim()) {
      return res.status(400).json({ error: 'SKU与PL明细不一致' });
    }

    // 7. source_ci_id 必须由 packing_lists.related_ci_id 后端派生
    // 8. 不信任客户端传入的 source_ci_id/source_ci_no
    const sourceCiId = String(pl.related_ci_id || '').trim();
    const sourceCiNo = String(pl.related_ci_no || '').trim();
    if (!sourceCiId) {
      return res.status(400).json({ error: 'PL未关联CI（related_ci_id 为空），无法入库' });
    }

    // 9. CI 必须存在
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [sourceCiId]);
    if (!ci) {
      return res.status(400).json({ error: '关联CI不存在' });
    }

    // 10. CI 状态为 cancelled 时拒绝
    if (ci.ci_status === 'cancelled') {
      return res.status(400).json({ error: '关联CI已作废（cancelled），不可入库' });
    }

    // 11. 对应 commercial_invoice_items 必须存在
    const ciItem = queryOne('SELECT * FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [sourceCiId, d.sku_code]);
    if (!ciItem) {
      return res.status(400).json({ error: 'CI明细中不存在该SKU' });
    }

    // 12. PL 明细已入库累计 SUM(actual_qty) WHERE source_pl_item_id = 当前明细
    const plAcc = queryOne('SELECT COALESCE(SUM(actual_qty),0) AS s FROM inbound_records WHERE source_pl_item_id = ?', [sourcePlItemId]);
    const plReceived = plAcc ? plAcc.s : 0;
    // 13. PL 明细剩余
    const plRemaining = (plItem.total_qty || 0) - plReceived;
    // 14. CI 明细剩余
    const ciRemaining = (ciItem.shipped_qty || 0) - (ciItem.inbound_qty || 0);
    // 15. 本次最大可入库数量
    const maxInbound = Math.min(plRemaining, ciRemaining);
    // 16. 最大可入库数量 <= 0 时拒绝
    if (maxInbound <= 0) {
      return res.status(409).json({ error: '该SKU无可入库余量（PL或CI已收满）' });
    }
    // 17. actual_qty 超过最大可入库数量时拒绝
    if (actualQty > maxInbound) {
      return res.status(409).json({ error: `入库数量超过可入库余量（最大 ${maxInbound}）` });
    }
    // 18. 所有守卫通过 → 写入

    const iId = genId('inbound');
    const iNo = d.inbound_no || `IN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

    transaction(async () => {
      // 更新 CI 明细累计入库（异常件按全额 actual_qty 计入，与既有语义一致）
      const accumulated = (ciItem.inbound_qty || 0) + actualQty;
      const uninbound = (ciItem.shipped_qty || 0) - accumulated;
      run('UPDATE commercial_invoice_items SET inbound_qty = ?, uninbound_qty = ? WHERE id = ?', [accumulated, uninbound, ciItem.id]);

      run(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, source_pl_id, source_pl_item_id, source_pi_no, source_logistics_batch_no, delivery_batch_no, country, warehouse, inbound_date, sku_code, ci_shipped_qty, expected_qty, actual_qty, accumulated_qty, uninbound_qty, abnormal_qty, abnormal_reason, inbound_status, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [iId, iNo, sourceCiId, sourceCiNo, sourcePlId, sourcePlItemId, d.source_pi_no || '', d.source_logistics_batch_no || '', d.delivery_batch_no || '', d.country || '', d.warehouse || '', d.inbound_date, d.sku_code, ciItem.shipped_qty || 0, d.expected_qty || 0, actualQty, actualQty, (ciItem.shipped_qty || 0) - actualQty, d.abnormal_qty || 0, d.abnormal_reason || '', d.abnormal_qty > 0 ? 'abnormal' : 'completed', d.remark || '']);

      // 成本分摊和加权平均成本更新已改为手动触发（CI费用确认 → 费用分摊 → 原库存导入 → 更新加权平均成本）

      // 入库记录只做单据跟踪，不自动更新库存总表数量
      // updateInventoryAfterInbound 已禁用（采购链不自动改库存总表数量）

      // 更新CI状态
      const ciItems = query('SELECT shipped_qty, inbound_qty FROM commercial_invoice_items WHERE ci_id = ?', [sourceCiId]).rows;
      const allInbound = ciItems.every(i => i.inbound_qty >= i.shipped_qty);
      const anyInbound = ciItems.some(i => i.inbound_qty > 0);
      if (allInbound) {
        run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['completed', sourceCiId]);
      } else if (anyInbound) {
        run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['partial_inbound', sourceCiId]);
      }

      // 更新在途数据
      await updateInventoryTransitData();
    });

    res.json({ id: iId, inbound_no: iNo, source_pl_id: sourcePlId, source_pl_item_id: sourcePlItemId, source_ci_id: sourceCiId, source_ci_no: sourceCiNo, ...d });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 批量导入入库记录
// P1-STATE-01D：逐行容忍（单行失败计 failed，不整体回滚），但每行写入前完成与单笔一致的 PL 关联守卫
app.post('/api/inbound-records/batch-import', requireApiPermission('inbound_create'), asyncHandler((req, res) => {
  try {
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    if (records.length === 0) return res.status(400).json({ error: '没有可导入的数据' });
    if (records.length > 2000) return res.status(400).json({ error: '单次最多导入 2000 条' });

    const errors = [];
    let success = 0;
    let failed = 0;

    transaction(async () => {
      records.forEach((rec, idx) => {
        const rowNum = idx + 1;
        try {
          const sku = String(rec.sku_code || '').trim();
          const date = String(rec.inbound_date || '').trim().slice(0, 10);
          const actualQty = parseInt(rec.actual_qty);

          // 基础校验
          if (!sku) throw new Error('SKU编码不能为空');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('入库日期格式错误（应为 YYYY-MM-DD）');
          if (isNaN(actualQty) || actualQty <= 0) throw new Error('实际入库数量必须为正整数（大于0）');

          // ===== P1-STATE-01D 守卫（逐行，写入前完成）=====
          // 解析 source_pl_item_id（优先）；兼容 source_pl_no + sku_code 唯一解析（0→失败，1→解析，>1→不唯一失败）
          let sourcePlItemId = String(rec.source_pl_item_id || '').trim();
          if (!sourcePlItemId && rec.source_pl_no) {
            const plNo = String(rec.source_pl_no || '').trim();
            const plByNo = queryOne('SELECT id FROM packing_lists WHERE pl_no = ?', [plNo]);
            if (!plByNo) throw new Error('PL不存在（source_pl_no 无效）');
            const plItems = query('SELECT id FROM packing_list_items WHERE pl_id = ? AND sku_code = ?', [plByNo.id, sku]).rows;
            if (plItems.length === 0) throw new Error('PL明细不存在（source_pl_no+sku 无匹配）');
            if (plItems.length > 1) throw new Error('PL明细不唯一（source_pl_no+sku 命中多条）');
            sourcePlItemId = plItems[0].id;
          }
          if (!sourcePlItemId) throw new Error('必须关联 PL 明细（source_pl_item_id 或 source_pl_no+sku）');

          // 3. packing_list_items.id 必须存在
          const plItem = queryOne('SELECT * FROM packing_list_items WHERE id = ?', [sourcePlItemId]);
          if (!plItem) throw new Error('PL明细不存在（source_pl_item_id 无效）');
          // 6. sku_code 必须与 pl_item.sku_code 一致
          if (String(plItem.sku_code || '').trim() !== sku) throw new Error('SKU与PL明细不一致');

          // 4/5. source_pl_id 由 pl_item.pl_id 获取并校验 PL 存在
          const sourcePlId = String(plItem.pl_id || '').trim();
          if (!sourcePlId) throw new Error('PL明细缺少所属 PL（pl_id 为空）');
          const pl = queryOne('SELECT id, related_ci_id, related_ci_no FROM packing_lists WHERE id = ?', [sourcePlId]);
          if (!pl) throw new Error('PL不存在（source_pl_id 无效）');

          // 7/8. source_ci_id 由 packing_lists.related_ci_id 派生；不信任客户端传入
          const sourceCiId = String(pl.related_ci_id || '').trim();
          const sourceCiNo = String(pl.related_ci_no || '').trim();
          if (!sourceCiId) throw new Error('PL未关联CI，无法入库');

          // 9. CI 必须存在
          const ci = queryOne('SELECT id, ci_status FROM commercial_invoices WHERE id = ?', [sourceCiId]);
          if (!ci) throw new Error('关联CI不存在');
          // 10. CI 状态为 cancelled 时拒绝
          if (ci.ci_status === 'cancelled') throw new Error('关联CI已作废（cancelled），不可入库');

          // 11. 对应 commercial_invoice_items 必须存在
          const ciItem = queryOne('SELECT id, shipped_qty, inbound_qty FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [sourceCiId, sku]);
          if (!ciItem) throw new Error('CI明细中不存在该SKU');

          // 12/13. PL 明细已入库累计 + 剩余
          const plAcc = queryOne('SELECT COALESCE(SUM(actual_qty),0) AS s FROM inbound_records WHERE source_pl_item_id = ?', [sourcePlItemId]);
          const plRemaining = (plItem.total_qty || 0) - (plAcc ? plAcc.s : 0);
          // 14. CI 明细剩余
          const ciRemaining = (ciItem.shipped_qty || 0) - (ciItem.inbound_qty || 0);
          // 15. 本次最大可入库数量
          const maxInbound = Math.min(plRemaining, ciRemaining);
          // 16. <=0 拒绝
          if (maxInbound <= 0) throw new Error('该SKU无可入库余量（PL或CI已收满）');
          // 17. 超量拒绝
          if (actualQty > maxInbound) throw new Error(`入库数量超过可入库余量（最大 ${maxInbound}）`);
          // 18. 守卫通过 → 写入

          const iId = genId('inbound');
          const iNo = `IN-${new Date().getFullYear()}-${String(Date.now() + rowNum).slice(-6)}`;

          // 更新 CI 明细累计入库（异常件按全额计入）
          const accumulated = (ciItem.inbound_qty || 0) + actualQty;
          const uninbound = (ciItem.shipped_qty || 0) - accumulated;
          run('UPDATE commercial_invoice_items SET inbound_qty = ?, uninbound_qty = ? WHERE id = ?', [accumulated, uninbound, ciItem.id]);

          const abnormalQty = parseInt(rec.abnormal_qty) || 0;
          const abnormalReason = String(rec.abnormal_reason || '').trim();
          const country = String(rec.country || '').trim();
          const warehouse = String(rec.warehouse || '').trim();
          const sourceLogisticsBatchNo = String(rec.source_logistics_batch_no || '').trim();
          const deliveryBatchNo = String(rec.delivery_batch_no || '').trim();
          const remark = String(rec.remark || '').trim();

          run(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, source_pl_id, source_pl_item_id, source_pi_no, source_logistics_batch_no, delivery_batch_no, country, warehouse, inbound_date, sku_code, ci_shipped_qty, expected_qty, actual_qty, accumulated_qty, uninbound_qty, abnormal_qty, abnormal_reason, inbound_status, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [iId, iNo, sourceCiId, sourceCiNo, sourcePlId, sourcePlItemId, '', sourceLogisticsBatchNo, deliveryBatchNo, country, warehouse, date, sku, ciItem.shipped_qty || 0, 0, actualQty, actualQty, (ciItem.shipped_qty || 0) - actualQty, abnormalQty, abnormalReason, abnormalQty > 0 ? 'abnormal' : 'completed', remark]);

          // 成本分摊和加权平均成本更新已改为手动触发（CI费用确认 → 费用分摊 → 原库存导入 → 更新加权平均成本）
          // 入库记录只做单据跟踪，不自动触发成本计算

          // 更新CI状态
          const ciItems = query('SELECT shipped_qty, inbound_qty FROM commercial_invoice_items WHERE ci_id = ?', [sourceCiId]).rows;
          const allInbound = ciItems.every(i => i.inbound_qty >= i.shipped_qty);
          const anyInbound = ciItems.some(i => i.inbound_qty > 0);
          if (allInbound) {
            run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['completed', sourceCiId]);
          } else if (anyInbound) {
            run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['partial_inbound', sourceCiId]);
          }

          success++;
        } catch (e) {
          failed++;
          errors.push({ row: rowNum, sku: rec.sku_code || '', error: e.message });
        }
      });

      // 最后更新一次在途数据
      try { await updateInventoryTransitData(); } catch (e) { /* ignore */ }
    });

    res.json({ success, failed, total: records.length, errors: errors.slice(0, 50) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 成本分摊核心逻辑
function allocateCosts(ciId, inboundId, inboundNo, skuCode, inboundQty) {
  const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ciId]);
  if (!ci) return;

  const ciItem = queryOne('SELECT * FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [ciId, skuCode]);
  if (!ciItem) return;

  // 获取物流批次
  const logistics = queryOne('SELECT * FROM logistics_batches WHERE related_ci_id = ?', [ciId]);

  // 商品成本
  const productCost = ciItem.ci_amount || 0; // 该SKU的全部商品成本

  let allocatedFreight = 0;
  let allocatedDuty = 0;
  let allocatedOther = 0;
  let allocationBasis = 'cbm';

  if (logistics) {
    // 获取该CI所有SKU的PL数据
    const plItems = query(`
      SELECT pli.* FROM packing_list_items pli
      JOIN packing_lists pl ON pli.pl_id = pl.id
      WHERE pl.related_ci_id = ?
    `, [ciId]).rows;

    const totalCbm = plItems.reduce((sum, p) => sum + (p.cbm || 0), 0);
    const totalWeight = plItems.reduce((sum, p) => sum + (p.gross_weight || 0), 0);
    const totalGoodsAmount = ci.goods_amount || 0;

    const skuPl = plItems.find(p => p.sku_code === skuCode);
    const skuCbm = skuPl ? (skuPl.cbm || 0) : 0;
    const skuWeight = skuPl ? (skuPl.gross_weight || 0) : 0;
    const skuGoodsAmount = ciItem.ci_amount || 0;

    const totalFreight = logistics.total_freight || 0;
    const totalDuty = logistics.customs_duty || 0;
    const totalOther = (logistics.vat_gst || 0) + (logistics.other_fees || 0);

    // 运费分摊
    if (logistics.transport_mode === 'sea' && totalCbm > 0) {
      allocationBasis = 'cbm';
      allocatedFreight = totalFreight * (skuCbm / totalCbm);
    } else if ((logistics.transport_mode === 'air' || logistics.transport_mode === 'express') && totalWeight > 0) {
      allocationBasis = 'weight';
      allocatedFreight = totalFreight * (skuWeight / totalWeight);
    } else if (totalCbm > 0) {
      allocationBasis = 'cbm';
      allocatedFreight = totalFreight * (skuCbm / totalCbm);
    }

    // 关税分摊（按商品金额）
    if (totalDuty > 0 && totalGoodsAmount > 0) {
      allocatedDuty = totalDuty * (skuGoodsAmount / totalGoodsAmount);
    }

    // 其他费用分摊（按商品金额）
    if (totalOther > 0 && totalGoodsAmount > 0) {
      allocatedOther = totalOther * (skuGoodsAmount / totalGoodsAmount);
    }
  }

  const totalLandingCost = productCost + allocatedFreight + allocatedDuty + allocatedOther;
  const unitLandingCost = inboundQty > 0 ? totalLandingCost / inboundQty : 0;

  run(`INSERT INTO cost_allocations (id, inbound_id, inbound_no, logistics_batch_no, ci_no, sku_code, allocation_basis, product_cost, allocated_freight, allocated_duty, allocated_other, total_landing_cost, inbound_qty, unit_landing_cost, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [genId('cost'), inboundId, inboundNo, logistics ? logistics.batch_no : '', ci.ci_no, skuCode, allocationBasis, productCost, allocatedFreight, allocatedDuty, allocatedOther, totalLandingCost, inboundQty, unitLandingCost, ci.currency || 'USD']);

  // P1-03-B: 已废弃 — 不再调用 updateWeightedAvgCost（该方法直接写 inventory/skus，违反正式库存口径）
  // updateWeightedAvgCost(skuCode, inboundQty, unitLandingCost);
}

// @deprecated P1-03-B: 该函数直接写 inventory.weighted_avg_cost/inventory_value 和 skus.weighted_avg_cost，
// 违反正式库存口径。已移除 allocateCosts 对它的调用。成本确认改为生成 wac_history 版本。
// 不做物理删除（本轮不做无关代码清理），但全项目不再有调用方。
function updateWeightedAvgCost(skuCode, inboundQty, unitLandingCost) {
  const sku = queryOne('SELECT weighted_avg_cost FROM skus WHERE sku_code = ?', [skuCode]);
  if (!sku) return;
  if (!inboundQty || inboundQty <= 0) return;

  // 获取当前库存（不改数量，只用现有数量计算加权平均）
  const invRecords = query('SELECT id, available_qty, weighted_avg_cost, country, warehouse FROM inventory WHERE sku_code = ?', [skuCode]).rows;
  const currentQty = invRecords.reduce((sum, i) => sum + (i.available_qty || 0), 0);
  const currentAvgCost = invRecords.length > 0 ? (invRecords[0].weighted_avg_cost || 0) : 0;

  const newAvgCost = currentQty > 0
    ? (currentQty * currentAvgCost + inboundQty * unitLandingCost) / (currentQty + inboundQty)
    : unitLandingCost;
  const roundedAvgCost = Math.round(newAvgCost * 10000) / 10000;

  // 更新 SKU 表的加权平均成本
  run('UPDATE skus SET weighted_avg_cost = ? WHERE sku_code = ?', [roundedAvgCost, skuCode]);

  // 更新库存总表的加权平均成本和库存价值（不改 available_qty）
  if (invRecords.length > 0) {
    invRecords.forEach(inv => {
      run('UPDATE inventory SET weighted_avg_cost = ?, inventory_value = available_qty * ?, updated_at = datetime(\'now\') WHERE id = ?',
        [roundedAvgCost, roundedAvgCost, inv.id]);
    });
  } else {
    // 库存总表没有该 SKU 记录时，创建一条仅含成本的记录（数量为 0）
    run(`INSERT OR IGNORE INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_inbound_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [genId('inv'), skuCode, '', '', 0, roundedAvgCost, 0, new Date().toISOString().split('T')[0]]);
  }
}

// 入库后更新库存
function updateInventoryAfterInbound(skuCode, country, warehouse, qty, inboundDate) {
  // 入库记录只做单据跟踪，不自动增加库存总表数量。
  return;
  const inv = queryOne('SELECT id, available_qty FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?', [skuCode, country, warehouse]);
  if (inv) {
    run('UPDATE inventory SET available_qty = available_qty + ?, last_inbound_date = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [qty, inboundDate, inv.id]);
  } else {
    // 新记录：从SKU表获取刚更新的加权平均成本
    const sku = queryOne('SELECT weighted_avg_cost FROM skus WHERE sku_code = ?', [skuCode]);
    const avgCost = sku ? (sku.weighted_avg_cost || 0) : 0;
    run(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [genId('inv'), skuCode, country, warehouse, qty, avgCost, qty * avgCost, inboundDate]);
  }
  // 更新库存价值
  const updated = queryOne('SELECT available_qty, weighted_avg_cost FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?', [skuCode, country, warehouse]);
  if (updated) {
    run('UPDATE inventory SET inventory_value = ? WHERE sku_code = ? AND country = ? AND warehouse = ?',
      [(updated.available_qty || 0) * (updated.weighted_avg_cost || 0), skuCode, country, warehouse]);
  }
}

// ==================== 成本管理 ====================
app.get('/api/cost-allocations', requireApiPermission('cost_view'), asyncHandler((req, res) => {
  const { ci_no, sku_code, inbound_no } = req.query;
  let sql = `SELECT ca.*, s.product_name, s.brand FROM cost_allocations ca LEFT JOIN skus s ON ca.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (ci_no) { sql += ' AND ca.ci_no = ?'; params.push(ci_no); }
  if (sku_code) { sql += ' AND ca.sku_code = ?'; params.push(sku_code); }
  if (inbound_no) { sql += ' AND ca.inbound_no = ?'; params.push(inbound_no); }
  sql += ' ORDER BY ca.created_at DESC';
  res.json(query(sql, params).rows);
}));

// ==================== 付款管理 ====================
class SettlementError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SETTLEMENT_RATE_TYPE = 'realtime';
const ACTIVE_GOODS_PAYMENT_STATUSES = [
  'pending_approval', 'approved', 'pending_payment', 'partial_paid', 'partial_deduction',
  'partial_rounding', 'partial_payment_partial_deduction', 'deduction_settled', 'reversed', 'paid'
];
// PAY-CORE 多次付款：仅「仍在审批/付款流程中、未发生付款确认」的 PR 阻止同一来源新建 PR。
// 付款动作完成后（partial_paid / partial_payment_partial_deduction / paid / deduction_settled /
// partial_rounding / reversed），PR 退出审批中心，不再阻止剩余金额再次申请付款。
const BLOCKING_GOODS_PR_STATUSES = [
  'pending_approval', 'approved', 'pending_payment', 'partial_deduction'
];

function settlementMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return NaN;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function settlementDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new SettlementError(400, '实际付款日期必须为 YYYY-MM-DD');
  const parsed = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new SettlementError(400, '实际付款日期无效');
  }
  return date;
}

function settlementOperator(req) {
  const user = req.currentUserId ? queryOne('SELECT name FROM users WHERE id = ?', [req.currentUserId]) : null;
  return {
    id: req.currentUserId || '',
    name: req.currentUserName || (user ? user.name : '') || ''
  };
}

function settlementIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!key) throw new SettlementError(400, '付款幂等键不能为空');
  if (key.length > 200) throw new SettlementError(400, '付款幂等键长度不能超过200个字符');
  return key;
}

function bulkPaymentIdempotencyKey(item) {
  const supplied = String(item.idempotency_key || '').trim();
  if (supplied) return settlementIdempotencyKey(supplied);
  const normalized = JSON.stringify({
    request_no: String(item.request_no || '').trim(),
    paid_amount: settlementMoney(item.paid_amount),
    paid_date: String(item.paid_date || '').trim(),
    payment_voucher: String(item.payment_voucher || '').trim()
  });
  return `bulk:${crypto.createHash('sha256').update(normalized).digest('hex')}`;
}

function paymentSettlementLogs(paymentRequestId) {
  return query(`SELECT * FROM payment_settlement_logs
                WHERE payment_request_id = ?
                ORDER BY created_at, id`, [paymentRequestId]).rows;
}

async function ensureSettlementLegacyBaselines(payment) {
  const logs = await paymentSettlementLogs(payment.id);
  const hasPaymentLogs = logs.some(log => log.event_type === 'payment');
  const hasDeductionLogs = logs.some(log => log.event_type === 'deduction');
  const hasRoundingLogs = logs.some(log => log.event_type === 'rounding');
  const legacyPaid = settlementMoney(payment.paid_amount || 0);
  const legacyDeduction = settlementMoney(payment.deduction_amount || 0);
  const legacyRounding = settlementMoney(payment.rounding_amount || 0);

  if (!hasPaymentLogs && legacyPaid > 0) {
    await run(`INSERT INTO payment_settlement_logs
         (id, payment_request_id, event_type, amount, status, reason, paid_date,
          original_currency, operator_name, is_legacy, created_at)
         VALUES (?, ?, 'payment', ?, 'applied', ?, ?, ?, 'system', 1, ?)`,
      [await genId('settle'), payment.id, legacyPaid, '历史付款基线（迁移前数据）', payment.paid_date || '', payment.currency || '', payment.updated_at || payment.created_at || new Date().toISOString()]);
  }
  if (!hasDeductionLogs && legacyDeduction > 0) {
    const legacyReason = payment.deduction_source_desc || payment.deduction_source_type || '历史抵扣基线（迁移前数据）';
    await run(`INSERT INTO payment_settlement_logs
         (id, payment_request_id, event_type, amount, status, reason,
          original_currency, operator_name, is_legacy, created_at)
         VALUES (?, ?, 'deduction', ?, 'applied', ?, ?, 'system', 1, ?)`,
      [await genId('settle'), payment.id, legacyDeduction, legacyReason, payment.currency || '', payment.updated_at || payment.created_at || new Date().toISOString()]);
  }
  if (!hasRoundingLogs && legacyRounding > 0) {
    await run(`INSERT INTO payment_settlement_logs
         (id, payment_request_id, event_type, amount, status, reason,
          original_currency, operator_name, is_legacy, created_at)
         VALUES (?, ?, 'rounding', ?, 'applied', ?, ?, 'system', 1, ?)`,
      [await genId('settle'), payment.id, legacyRounding, payment.rounding_reason || '历史抹零基线', payment.currency || '', payment.updated_at || payment.created_at || new Date().toISOString()]);
  }
}

async function paymentSettlementFacts(payment) {
  const logs = await paymentSettlementLogs(payment.id);
  const paymentLogs = logs.filter(log => log.event_type === 'payment');
  const deductionLogs = logs.filter(log => log.event_type === 'deduction');
  const roundingLogs = logs.filter(log => log.event_type === 'rounding');
  const activePayments = paymentLogs.filter(log => log.status === 'applied');
  const activeDeductions = deductionLogs.filter(log => log.status === 'applied');
  const activeRoundings = roundingLogs.filter(log => log.status === 'applied');
  // PAY-CORE Phase 2 SSOT：effectivePaid 拆分为 newTransactionPaid + legacyPaid
  // 1. 新付款：从 payment_transactions 读取（唯一银行资金事实源）
  const txRows = await query(
    `SELECT paid_amount_minor FROM payment_transactions
     WHERE payment_request_id = ? AND trans_status = 'reconciled'`,
    [payment.id]
  );
  const newTransactionPaidMinor = (txRows.rows || []).reduce(
    (sum, r) => sum + Number(r.paid_amount_minor || 0), 0
  );
  const newTransactionPaid = minorToAmount(newTransactionPaidMinor);
  // 2. Legacy 付款：仅读取 is_legacy=1 的 payment settlement log（历史兼容基线）
  const legacyActivePayments = activePayments.filter(log => Number(log.is_legacy) === 1);
  const legacyPaid = legacyActivePayments.reduce((sum, log) => sum + Number(log.amount || 0), 0);
  // 3. effectivePaid = 新付款 + Legacy 付款；完全删除 paid_amount fallback
  //    新 PR 无 transaction + 无 legacy log → effectivePaid = 0（即使 paid_amount 被异常写入）
  const effectivePaid = settlementMoney(newTransactionPaid + legacyPaid);
  const effectiveDeduction = settlementMoney(deductionLogs.length
    ? activeDeductions.reduce((sum, log) => sum + Number(log.amount || 0), 0)
    : Number(payment.deduction_amount || 0));
  const effectiveRounding = settlementMoney(roundingLogs.length
    ? activeRoundings.reduce((sum, log) => sum + Number(log.amount || 0), 0)
    : Number(payment.rounding_amount || 0));
  const grossPayable = settlementMoney(payment.payable_amount || 0);
  const outstanding = settlementMoney(grossPayable - effectivePaid - effectiveDeduction - effectiveRounding);
  const latestPayment = activePayments.slice().sort((a, b) => {
    const dateCompare = String(b.paid_date || '').localeCompare(String(a.paid_date || ''));
    return dateCompare || String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id));
  })[0] || null;
  return {
    logs,
    activePayments,
    activeDeductions,
    activeRoundings,
    grossPayable,
    effectivePaid,
    effectiveDeduction,
    effectiveRounding,
    outstanding,
    latestPayment,
    hasReversal: logs.some(log => log.status === 'reversed' || log.event_type === 'rounding_reversal')
  };
}

function derivePaymentStatus(payment, facts) {
  if (payment.payment_status === 'cancelled') return 'cancelled';
  if (payment.approval_status === 'rejected') return 'rejected';
  if (facts.outstanding <= 0) return facts.effectivePaid > 0 || facts.effectiveRounding > 0 ? 'paid' : 'deduction_settled';
  if (facts.effectivePaid > 0 && facts.effectiveDeduction > 0) return 'partial_payment_partial_deduction';
  if (facts.effectivePaid > 0) return 'partial_paid';
  if (facts.effectiveDeduction > 0) return 'partial_deduction';
  if (facts.effectiveRounding > 0) return 'partial_rounding';
  if (facts.hasReversal) return 'reversed';
  return payment.approval_status === 'approved' ? 'approved' : 'pending_approval';
}

async function aggregateSourceSettlement(rows) {
    const entries = [];
  for (const row of rows) {
    entries.push({ row, facts: await paymentSettlementFacts(row) });
  }
  const effectivePaid = settlementMoney(entries.reduce((sum, entry) => sum + entry.facts.effectivePaid, 0));
  const effectiveDeduction = settlementMoney(entries.reduce((sum, entry) => sum + entry.facts.effectiveDeduction, 0));
  const effectiveRounding = settlementMoney(entries.reduce((sum, entry) => sum + entry.facts.effectiveRounding, 0));
  const outstanding = settlementMoney(entries.reduce((sum, entry) => sum + Math.max(0, entry.facts.outstanding), 0));
  const allSettled = entries.length > 0 && entries.every(entry => entry.facts.outstanding <= 0);
  const hasSettlement = effectivePaid > 0 || effectiveDeduction > 0 || effectiveRounding > 0;
  const hasPendingApproval = rows.some(row => row.approval_status === 'pending');
  return {
    effectivePaid,
    effectiveDeduction,
    effectiveRounding,
    outstanding,
    allSettled,
    hasSettlement,
    sourcePayStatus: allSettled ? 'paid' : (hasSettlement ? 'partial_paid' : (hasPendingApproval ? 'pending_approval' : 'unpaid'))
  };
}

function sourceGoodsPaymentRows(sourceType, sourceId, subcategory) {
  const relation = sourceType === 'ci'
    ? `((source_type = 'ci' AND source_id = ?) OR related_ci_id = ?)`
    : `(source_type = ? AND source_id = ?)`;
  const params = sourceType === 'ci' ? [sourceId, sourceId] : [sourceType, sourceId];
  return query(`SELECT * FROM payment_requests
                WHERE payment_category = 'goods' AND payment_subcategory = ?
                  AND approval_status != 'rejected'
                  AND payment_status NOT IN ('rejected', 'cancelled')
                  AND ${relation}`,
    [subcategory, ...params]).rows;
}

// PAY-CORE multi-PI-deposit：聚合某个 PI 下所有定金 payable_items 的实际付款状态
// 跨 multi/single PR 统一通过 payment_allocations 聚合，避免串单
async function aggregatePiDepositSettlement(piId) {
  const items = await query(
    `SELECT id, payable_amount_minor, lifecycle_status
     FROM payable_items
     WHERE source_type = 'pi' AND source_id = ?
       AND fee_type = 'deposit'
       AND lifecycle_status IN ('active', 'reserved', 'partially_paid', 'paid')`,
    [piId]
  );
  if (!items.rows || items.rows.length === 0) {
    return { effectivePaid: 0, payableAmount: 0, outstanding: 0, allSettled: false, hasSettlement: false, hasPendingApproval: false, sourcePayStatus: 'unpaid' };
  }
  let totalPayableMinor = 0;
  let totalPaidMinor = 0;
  let hasSettlement = false;
  let hasPendingApproval = false;
  for (const item of items.rows) {
    const itemPayableMinor = Number(item.payable_amount_minor || 0);
    totalPayableMinor += itemPayableMinor;
    const pris = await query(
      `SELECT pri.id, pri.payment_request_id
       FROM payment_request_items pri
       WHERE pri.payable_item_id = ?`,
      [item.id]
    );
    let itemPaidMinor = 0;
    for (const pri of pris.rows || []) {
      const pr = await queryOne('SELECT approval_status, payment_status FROM payment_requests WHERE id = ?', [pri.payment_request_id]);
      if (!pr) continue;
      if (pr.approval_status === 'rejected' || pr.payment_status === 'cancelled' || pr.payment_status === 'rejected') continue;
      if (pr.approval_status === 'pending') hasPendingApproval = true;
      const allocs = await query(
        `SELECT allocated_amount_minor FROM payment_allocations
         WHERE payment_request_item_id = ? AND status = 'reconciled'`,
        [pri.id]
      );
      const allocMinor = (allocs.rows || []).reduce((s, r) => s + Number(r.allocated_amount_minor || 0), 0);
      if (allocMinor > 0) hasSettlement = true;
      itemPaidMinor += allocMinor;
    }
    // PAY-CORE rounding：payable_item 已被 markPayableItemPaid 标记为 paid 时，
    // 补齐 PR 级抹零/抵扣分摊到本项产生的尾差，使 paid_deposit 与 payable_deposit 一致。
    if (item.lifecycle_status === 'paid' && itemPaidMinor > 0 && itemPaidMinor < itemPayableMinor) {
      itemPaidMinor = itemPayableMinor;
      hasSettlement = true;
    }
    totalPaidMinor += itemPaidMinor;
  }
  const effectivePaid = minorToAmount(totalPaidMinor);
  const payableAmount = minorToAmount(totalPayableMinor);
  const outstanding = settlementMoney(payableAmount - effectivePaid);
  const allSettled = totalPayableMinor > 0 && totalPaidMinor >= totalPayableMinor;
  const sourcePayStatus = allSettled ? 'paid' : (hasSettlement ? 'partial_paid' : (hasPendingApproval ? 'pending_approval' : 'unpaid'));
  return { effectivePaid, payableAmount, outstanding, allSettled, hasSettlement, hasPendingApproval, sourcePayStatus };
}

async function syncPaymentSource(payment, facts, paymentStatus) {
  const isSettled = facts.outstanding <= 0;
  const hasSettlement = facts.effectivePaid > 0 || facts.effectiveDeduction > 0 || facts.effectiveRounding > 0;

  // PAY-CORE multi-PI-deposit：multi 模式按 PI 维度分别回写
  // 原因：multi PR 主表 source_type/source_id 为空，原分支无法触发；需通过 payment_request_items JOIN payable_items
  // 找到关联的所有 PI，分别聚合其定金付款状态后回写
  if (payment.payment_mode === 'multi') {
    const piRows = await query(
      `SELECT DISTINCT pi.source_id AS pi_id
       FROM payment_request_items pri
       JOIN payable_items pi ON pi.id = pri.payable_item_id
       WHERE pri.payment_request_id = ?
         AND pi.source_type = 'pi' AND pi.source_id != ''`,
      [payment.id]
    );
    for (const piRow of piRows.rows || []) {
      const piId = piRow.pi_id;
      const aggregate = await aggregatePiDepositSettlement(piId);
      const pi = await queryOne('SELECT pi_status FROM proforma_invoices WHERE id = ?', [piId]);
      if (pi) {
        let piStatus = pi.pi_status;
        if (aggregate.allSettled && ['pending', 'uploaded', 'confirmed', 'pending_deposit'].includes(piStatus)) piStatus = 'deposit_paid';
        if (!aggregate.allSettled && piStatus === 'deposit_paid') piStatus = 'pending_deposit';
        await run(`UPDATE proforma_invoices
             SET deposit_payment_status = ?, paid_deposit = ?, pi_status = ?, updated_at = datetime('now')
             WHERE id = ?`, [aggregate.sourcePayStatus, aggregate.effectivePaid, piStatus, piId]);
      }
    }
  }

  if (payment.payment_category === 'goods' && payment.payment_subcategory === 'deposit' && payment.source_type === 'pi' && payment.source_id) {
    const aggregate = await aggregateSourceSettlement(await sourceGoodsPaymentRows('pi', payment.source_id, 'deposit'));
    const pi = await queryOne('SELECT pi_status FROM proforma_invoices WHERE id = ?', [payment.source_id]);
    if (pi) {
      let piStatus = pi.pi_status;
      if (aggregate.allSettled && ['pending', 'uploaded', 'confirmed', 'pending_deposit'].includes(piStatus)) piStatus = 'deposit_paid';
      if (!aggregate.allSettled && piStatus === 'deposit_paid') piStatus = 'pending_deposit';
      await run(`UPDATE proforma_invoices
           SET deposit_payment_status = ?, paid_deposit = ?, pi_status = ?, updated_at = datetime('now')
           WHERE id = ?`, [aggregate.sourcePayStatus, aggregate.effectivePaid, piStatus, payment.source_id]);
    }
  }

  const balanceCiId = payment.source_type === 'ci' ? payment.source_id : payment.related_ci_id;
  if (payment.payment_category === 'goods' && payment.payment_subcategory === 'balance' && balanceCiId) {
    const aggregate = await aggregateSourceSettlement(await sourceGoodsPaymentRows('ci', balanceCiId, 'balance'));
    await run(`UPDATE commercial_invoices
         SET balance_payment_status = ?, paid_balance = ?, unpaid_balance = ?, updated_at = datetime('now')
         WHERE id = ?`, [aggregate.sourcePayStatus, aggregate.effectivePaid, aggregate.outstanding, balanceCiId]);
  }

  if (payment.source_type === 'logistics' && payment.source_id) {
    await run('UPDATE logistics_batches SET fee_status = ? WHERE id = ?', [isSettled ? 'paid' : (hasSettlement ? 'partial_paid' : 'unpaid'), payment.source_id]);
  }

  await run('UPDATE ci_cost_items SET paid_amount = ? WHERE payment_request_id = ?', [facts.effectivePaid, payment.id]);
}

async function recalculatePaymentSettlement(paymentRequestId) {
  const payment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [paymentRequestId]);
  if (!payment) throw new SettlementError(404, '付款申请不存在');
  const facts = await paymentSettlementFacts(payment);
  if (facts.outstanding < 0 || settlementMoney(facts.effectivePaid + facts.effectiveDeduction + facts.effectiveRounding) > facts.grossPayable) {
    throw new SettlementError(409, '有效付款、抵扣与抹零金额之和不能超过应付总额');
  }
  const paymentStatus = derivePaymentStatus(payment, facts);
  const latest = facts.latestPayment;
  const latestRounding = facts.activeRoundings.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id)))[0] || null;
  const localAmount = settlementMoney(facts.activePayments.reduce((sum, log) => sum + Number(log.local_amount || 0), 0));
  const rmbAmount = settlementMoney(facts.activePayments.reduce((sum, log) => sum + Number(log.rmb_amount || 0), 0));
  const usdAmount = payment.currency === 'USD' ? facts.effectivePaid : 0;
  await run(`UPDATE payment_requests
       SET paid_amount = ?, deduction_amount = ?, has_deduction = ?, rounding_amount = ?, rounding_reason = ?, actual_pay_amount = ?,
           unpaid_amount = ?, payment_status = ?, paid_date = ?, actual_rate = ?,
           local_amount = ?, rmb_amount = ?, usd_amount = ?, payment_voucher = ?, updated_at = datetime('now')
       WHERE id = ?`,
    [facts.effectivePaid, facts.effectiveDeduction, facts.effectiveDeduction > 0 ? 1 : 0, facts.effectiveRounding, latestRounding ? latestRounding.reason || '' : '',
      settlementMoney(facts.grossPayable - facts.effectiveDeduction - facts.effectiveRounding), Math.max(0, facts.outstanding), paymentStatus,
      latest ? latest.paid_date || '' : '', latest ? Number(latest.local_rate || 0) : 0,
      localAmount, rmbAmount, usdAmount, latest ? latest.payment_voucher || '' : '', payment.id]);
  await syncPaymentSource(payment, facts, paymentStatus);
  return { ...facts, outstanding: Math.max(0, facts.outstanding), payment_status: paymentStatus };
}

function activeExpenseCountry(value) {
  const requested = String(value || '').trim();
  if (!requested) throw new SettlementError(400, '无来源手工非货款必须选择费用归属国家');
  let country = queryOne("SELECT * FROM countries WHERE status = 'active' AND (name = ? OR code = ?)", [requested, requested]);
  if (!country) {
    const alias = COUNTRY_ALIAS_MAP[requested];
    if (alias) country = queryOne("SELECT * FROM countries WHERE status = 'active' AND name = ?", [alias]);
  }
  if (!country) throw new SettlementError(400, `费用归属国家“${requested}”不存在或已停用`);
  return country.name;
}

function sourceExpenseCountry(value, sourceLabel) {
  const country = String(value || '').trim();
  if (!country) throw new SettlementError(400, `${sourceLabel}未设置国家，不能创建非货款付款申请`);
  return country;
}

function payableItemSourceExpenseCountry(item) {
  const sourceType = String(item && item.source_type || '').trim();
  const sourceId = String(item && item.source_id || '').trim();
  let source = null;
  if (sourceType === 'pi') {
    source = queryOne('SELECT pi_no AS source_no, country FROM proforma_invoices WHERE id = ?', [sourceId]);
  } else if (sourceType === 'ci') {
    source = queryOne('SELECT ci_no AS source_no, country FROM commercial_invoices WHERE id = ?', [sourceId]);
  } else if (sourceType === 'historical_ci') {
    source = queryOne('SELECT historical_ci_no AS source_no, country FROM historical_commercial_invoices WHERE id = ?', [sourceId]);
  } else if (sourceType === 'logistics') {
    // LOGISTICS-COST-LINK-V2: logistics 费用通过 source_ci_id 关联 CI，从 CI 获取国家
    const ciId = String(item && item.source_ci_id || '').trim();
    if (!ciId) {
      throw new SettlementError(400, `应付费用 ${item.fee_no || item.id || ''} 缺少来源CI，不能创建付款申请`);
    }
    source = queryOne('SELECT ci_no AS source_no, country FROM commercial_invoices WHERE id = ?', [ciId]);
    if (!source) {
      throw new SettlementError(400, `应付费用 ${item.fee_no || item.id || ''} 的来源CI不存在，不能创建付款申请`);
    }
    var batch = queryOne('SELECT related_ci_id FROM logistics_batches WHERE id = ?', [sourceId]);
    if (!batch) {
      throw new SettlementError(400, `应付费用 ${item.fee_no || item.id || ''} 的来源物流批次不存在，不能创建付款申请`);
    }
    if (String(batch.related_ci_id || '') !== ciId) {
      throw new SettlementError(400, `应付费用 ${item.fee_no || item.id || ''} 的来源CI与物流批次关联CI不一致，不能创建付款申请`);
    }
  } else {
    throw new SettlementError(400, `应付费用 ${item.fee_no || item.id || ''} 的来源类型无法确定国家，不能创建付款申请`);
  }
  if (!source) {
    throw new SettlementError(400, `应付费用 ${item.fee_no || item.id || ''} 的来源单据不存在，不能创建付款申请`);
  }
  const country = String(source.country || '').trim();
  if (!country) {
    throw new SettlementError(400, `来源费用 ${item.fee_no || item.id || ''}（${source.source_no || item.source_no || sourceId}）未设置国家，不能创建付款申请`);
  }
  return activeExpenseCountry(country);
}

function commonPayableItemsExpenseCountry(items) {
  const countries = items.map(payableItemSourceExpenseCountry);
  const uniqueCountries = [...new Set(countries)];
  if (uniqueCountries.length !== 1) {
    throw new SettlementError(400, `所选费用来源国家不一致（${uniqueCountries.join('、')}），不能合并创建付款申请`);
  }
  return uniqueCountries[0];
}

function existingActiveGoodsPayment(sourceType, sourceId, subcategory) {
  return queryOne(
    `SELECT id, request_no, payment_status FROM payment_requests
     WHERE payment_category = 'goods' AND payment_subcategory = ?
       AND source_type = ? AND source_id = ?
       AND payment_status IN (${BLOCKING_GOODS_PR_STATUSES.map(() => '?').join(',')})`,
    [subcategory, sourceType, sourceId, ...BLOCKING_GOODS_PR_STATUSES]
  );
}

function isActiveGoodsPaymentUniqueError(error) {
  return String(error && error.message || '').includes('uq_payment_request_active_goods_source') ||
    String(error && error.message || '').includes('payment_requests.source_type, payment_requests.source_id, payment_requests.payment_subcategory');
}

// ==================== PAY-CORE Phase 1.5 Task 1：payable_items 应付费用池辅助函数 ====================
// V5 修正 1：lifecycle_status 与 is_active 解耦，新代码以 lifecycle_status 为准
// V5 修正 2：payable_amount_minor <= 0 不创建 payable_item

/**
 * 查找当前 active 状态的应付费用（按来源 + 费用类型）
 * @param {string} [sourceCiId] - 可选，per-PI balance 的来源 CI；传入时按 source_ci_id 精确匹配
 */
function findActivePayableItem(sourceType, sourceId, feeType, sourceCiId) {
  if (sourceCiId !== undefined) {
    return queryOne(
      `SELECT * FROM payable_items
       WHERE source_type = ? AND source_id = ? AND fee_type = ? AND source_ci_id = ?
         AND lifecycle_status = 'active'`,
      [sourceType, sourceId, feeType, sourceCiId]
    );
  }
  return queryOne(
    `SELECT * FROM payable_items
     WHERE source_type = ? AND source_id = ? AND fee_type = ?
       AND lifecycle_status = 'active'`,
    [sourceType, sourceId, feeType]
  );
}

/**
 * 创建应付费用记录
 * 仅当 payableAmountMinor > 0 时才创建
 * 若已存在 active 记录则跳过（幂等）
 *
 * @param {Object} params
 * @param {string} params.sourceType - pi / ci
 * @param {string} params.sourceId - 来源 ID
 * @param {string} params.sourceNo - 来源编号（PI001/CI001）
 * @param {string} params.feeType - deposit / balance
 * @param {string} params.categoryCode - goods
 * @param {string} params.subcategoryCode - deposit / balance
 * @param {string} params.payeeType - factory
 * @param {string} params.payeeKey - supplier:xxx
 * @param {string} params.payeeName - 供应商名称
 * @param {string} params.currency - 币种
 * @param {number} params.payableAmount - 应付金额（元）
 * @param {string} [params.sourceCiId] - 来源 CI ID（per-PI balance 时传入，标记该尾款产生自哪个 CI）
 * @param {string} [params.createdBy] - 创建人
 * @returns {Object|null} 创建的 payable_item 或 null（跳过）
 */
function createPayableItemFromSource(params) {
  const {
    sourceType, sourceId, sourceNo, feeType,
    categoryCode, subcategoryCode,
    payeeType, payeeKey, payeeName,
    currency, payableAmount, sourceCiId = '', payableDate = '', createdBy = ''
  } = params;

  // V5 规则：应付金额 <= 0 不创建
  const amountMinor = Math.round((Number(payableAmount) || 0) * 100);
  if (amountMinor <= 0) {
    return null;
  }

  // 幂等：已存在 active 记录则返回已有记录，不重复创建
  const existing = findActivePayableItem(sourceType, sourceId, feeType, sourceCiId);
  if (existing) {
    return existing;
  }

  // P0-FIX-3：检查是否存在非 active 状态的历史记录（reserved / paid / cancelled）
  // UNIQUE 约束 (source_type, source_id, fee_type, source_ci_id) 会阻止创建重复记录
  // 必须前置判断，不得依赖数据库异常
  // 注意：payable_items 表无 updated_at 列，使用 created_at 排序
  const historicalItem = queryOne(
    `SELECT * FROM payable_items
     WHERE source_type = ? AND source_id = ? AND fee_type = ? AND source_ci_id = ?
       AND lifecycle_status != 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [sourceType, sourceId, feeType, sourceCiId]
  );
  if (historicalItem) {
    // 返回已有历史记录，附带明确状态，不创建新记录
    // 调用方可通过 lifecycle_status 判断当前状态
    return historicalItem;
  }

  const id = genId('payitem');
  const feeNo = `PAY-ITEM-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}-${Math.random().toString(36).substring(2, 5)}`;
  run(
    `INSERT INTO payable_items
     (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type,
      category_code, subcategory_code, payee_type, payee_key, payee_name_snapshot,
      payer_entity_key, payer_name_snapshot, currency, payable_amount_minor,
      is_active, lifecycle_status, payable_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)`,
    [id, feeNo, sourceType, sourceId, sourceNo, sourceCiId, feeType,
     categoryCode || '', subcategoryCode || '',
     payeeType || '', payeeKey, payeeName || '',
     'self', '', currency, amountMinor, payableDate || '', createdBy]
  );

  return { id, fee_no: feeNo, lifecycle_status: 'active', payable_amount_minor: amountMinor };
}

/**
 * 同步应付费用金额（仅 lifecycle_status='active' 时允许）
 * V5 修正 1：reserved/paid/cancelled 禁止自动修改
 *
 * @param {string} sourceType - pi / ci
 * @param {string} sourceId - 来源 ID
 * @param {string} feeType - deposit / balance
 * @param {number} newAmount - 新金额（元）
 * @returns {boolean} 是否同步成功
 */
function syncPayableItemAmount(sourceType, sourceId, feeType, newAmount) {
  const amountMinor = Math.round((Number(newAmount) || 0) * 100);
  // V5 规则：金额 <= 0 不自动取消，仅跳过同步
  if (amountMinor <= 0) {
    return false;
  }
  const result = run(
    `UPDATE payable_items
     SET payable_amount_minor = ?
     WHERE source_type = ? AND source_id = ? AND fee_type = ?
       AND lifecycle_status = 'active'`,
    [amountMinor, sourceType, sourceId, feeType]
  );
  return result.changes > 0;
}

/**
 * 取消应付费用（仅 lifecycle_status='active' 时允许）
 * V5 修正 1：不更新 is_active，仅更新 lifecycle_status
 *
 * @param {string} payableItemId - 应付费用 ID
 * @param {string} cancelledBy - 取消人
 * @param {string} cancelReason - 取消原因
 * @returns {boolean} 是否取消成功
 */
function cancelPayableItem(payableItemId, cancelledBy, cancelReason) {
  const result = run(
    `UPDATE payable_items
     SET lifecycle_status = 'cancelled',
         cancelled_by = ?,
         cancelled_at = datetime('now'),
         cancel_reason = ?
     WHERE id = ? AND lifecycle_status = 'active'`,
    [cancelledBy || '', cancelReason || '', payableItemId]
  );
  return result.changes > 0;
}

/**
 * 物流保存后自动同步财务应付费用事实
 * 核心：确保 payable_items + ci_cost_items 与物流费用一致
 * 自身不启动 transaction — 由调用方负责事务边界
 */
function syncLogisticsCostFactsCore(batch, context) {
  var ctx = context || {};
  var createdBy = ctx.createdBy || '';
  var payeeName = ctx.payeeName || '';

  if (!batch.related_ci_id) return { synced: [] };

  var ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [batch.related_ci_id]);
  if (!ci) return { synced: [] };

  // cost_confirmed 作为 flag 传递给 _syncOneFeeCategory，仅在需要 mutation 时检查
  // 不在此处无条件 throw — 否则会阻止用户修改 ETA 等非费用字段
  var costConfirmed = ci.cost_confirmed ? true : false;

  var currency = batch.freight_currency || 'USD';
  var defaultPayee = payeeName || batch.forwarder_name || '';

  var freightAmount = (Number(batch.international_freight) || 0) + (Number(batch.local_charges) || 0) +
                      (Number(batch.customs_service_fee) || 0) + (Number(batch.delivery_fee) || 0);
  var dutyAmount = (Number(batch.customs_duty) || 0) + (Number(batch.vat_gst) || 0);
  var otherAmount = Number(batch.other_fees) || 0;

  var categories = [
    { feeType: 'freight', categoryCode: 'warehouse_arrival', subcategoryCode: 'freight',
      payeeType: 'service_provider', payeeKey: 'service_provider:' + defaultPayee,
      amount: freightAmount, remark: '运费 ' + batch.batch_no },
    { feeType: 'duty', categoryCode: 'customs_duty', subcategoryCode: 'duty',
      payeeType: 'customs', payeeKey: 'customs:' + defaultPayee,
      amount: dutyAmount, remark: '关税 ' + batch.batch_no, isDuty: true },
    { feeType: 'other_local', categoryCode: 'warehouse_arrival', subcategoryCode: 'other_local',
      payeeType: 'service_provider', payeeKey: 'service_provider:' + defaultPayee,
      amount: otherAmount, remark: '其他费用 ' + batch.batch_no }
  ];

  var synced = [];
  for (var i = 0; i < categories.length; i++) {
    var cat = categories[i];
    var result = _syncOneFeeCategory(batch, ci, cat, currency, defaultPayee, createdBy, costConfirmed);
    if (result) synced.push(result);
  }

  // fee_status 只在真实 mutation 后更新（NO_CHANGE 返回 null，不进入 synced）
  var anyDuty = false;
  for (var j = 0; j < synced.length; j++) {
    if (synced[j].feeType === 'duty') { anyDuty = true; break; }
  }
  if (synced.length > 0) {
    run('UPDATE logistics_batches SET fee_status = ?, updated_at = datetime(\'now\') WHERE id = ?', ['cost_generated', batch.id]);
  }
  if (anyDuty && dutyAmount > 0) {
    run('UPDATE commercial_invoices SET import_duty_total = ?, has_customs_duty = 1, updated_at = datetime(\'now\') WHERE id = ?', [dutyAmount, ci.id]);
  }

  return { synced: synced };
}

function _syncOneFeeCategory(batch, ci, cat, currency, defaultPayee, createdBy, costConfirmed) {
  var amount = cat.amount;
  var amountMinor = Math.round((Number(amount) || 0) * 100);

  // Find the single payable for this source+fee_type+ci
  var payable = queryOne(
    'SELECT * FROM payable_items WHERE source_type = ? AND source_id = ? AND fee_type = ? AND source_ci_id = ?',
    ['logistics', batch.id, cat.feeType, ci.id]
  );

  // Find current ci_cost_item (enabled)
  var ciCost = queryOne(
    'SELECT * FROM ci_cost_items WHERE logistics_batch_id = ? AND cost_category = ? AND cost_subcategory = ? AND include_in_landing_cost = 1',
    [batch.id, cat.categoryCode, cat.subcategoryCode]
  );

  // Find disabled ci_cost_item (for reactivation)
  var disabledCiCost = queryOne(
    'SELECT * FROM ci_cost_items WHERE logistics_batch_id = ? AND cost_category = ? AND cost_subcategory = ? AND include_in_landing_cost = 0 ORDER BY created_at DESC LIMIT 1',
    [batch.id, cat.categoryCode, cat.subcategoryCode]
  );

  // Lifecycle classification
  var payableLifecycle = payable ? payable.lifecycle_status : null;
  var isPayableActive = payableLifecycle === 'active';
  var isPayableCancelled = payableLifecycle === 'cancelled';
  var isPayableInPaymentFlow = ['reserved', 'partially_paid', 'paid'].indexOf(payableLifecycle) >= 0;
  // "present" = exists and not cancelled (active or in payment flow)
  var isPayablePresent = payable && !isPayableCancelled;

  var hasCurrentCiCost = !!ciCost;
  var hasDisabledCiCost = !!disabledCiCost;

  // paymentFlowStarted = flag only, NOT an immediate error
  // A: only ACTIVE (non-terminal) payment_request_items linked to this payable
  //    Terminal PR states (rejected/cancelled/paid etc.) do NOT block editing —
  //    payment_request_items are retained for audit even after reject/cancel.
  // B: lifecycle in reserved/partially_paid/paid
  var paymentFlowStarted = false;
  if (payable) {
    var activePri = queryOne(
      `SELECT 1 FROM payment_request_items pri
       JOIN payment_requests pr ON pr.id = pri.payment_request_id
       WHERE pri.payable_item_id = ?
         AND pr.payment_status NOT IN ('cancelled','rejected','paid','partial_paid',
                                       'partial_payment_partial_deduction','deduction_settled','partial_rounding')
         AND pr.approval_status NOT IN ('cancelled','rejected')
       LIMIT 1`,
      [payable.id]
    );
    if (activePri) paymentFlowStarted = true;
    if (isPayableInPaymentFlow) paymentFlowStarted = true;
  }

  // ── CONFLICT checks (data integrity errors — always throw regardless of amount) ──

  // CONFLICT: payable present (active/payment-flow) but no ci_cost_item at all
  if (isPayablePresent && !hasCurrentCiCost && !hasDisabledCiCost) {
    throw { status: 409, code: 'COST_GENERATION_STATE_CONFLICT',
            message: '数据完整性异常：payable存在但ci_cost_item缺失',
            detail: { batch_id: batch.id, fee_type: cat.feeType, payable_count: 1, ci_cost_count: 0 } };
  }
  // CONFLICT: ci_cost_item exists (current) but no payable at all
  if (!payable && hasCurrentCiCost) {
    throw { status: 409, code: 'COST_GENERATION_STATE_CONFLICT',
            message: '数据完整性异常：ci_cost_item存在但payable缺失',
            detail: { batch_id: batch.id, fee_type: cat.feeType, payable_count: 0, ci_cost_count: 1 } };
  }
  // CONFLICT: cancelled payable + enabled ci_cost (normal cancel = cancelled + disabled)
  if (isPayableCancelled && hasCurrentCiCost) {
    throw { status: 409, code: 'COST_GENERATION_STATE_CONFLICT',
            message: '数据完整性异常：payable已取消但ci_cost_item仍启用',
            detail: { batch_id: batch.id, fee_type: cat.feeType, payable_lifecycle: 'cancelled', ci_cost_include_in_landing_cost: 1 } };
  }

  if (amount > 0) {
    // NONE: no payable, no ci_cost → CREATE new
    if (!payable && !hasCurrentCiCost && !hasDisabledCiCost) {
      if (costConfirmed) {
        throw { status: 409, code: 'CI_COST_CONFIRMED', message: '该CI费用已确认，不能继续新增/修改费用' };
      }
      // CI-level dup check
      var ciDup = queryOne(
        'SELECT id, logistics_batch_id FROM ci_cost_items WHERE ci_id = ? AND cost_category = ? AND cost_subcategory = ? AND include_in_landing_cost = 1 AND logistics_batch_id != ? LIMIT 1',
        [ci.id, cat.categoryCode, cat.subcategoryCode, batch.id]
      );
      if (ciDup) {
        throw { status: 409, code: 'CI_COST_ITEM_DUPLICATE',
                message: '该CI已存在相同类型的成本记录（来自其他物流批次）',
                detail: { ci_id: ci.id, fee_type: cat.feeType, existing_batch_id: ciDup.logistics_batch_id } };
      }
      var piResult = createPayableItemFromSource({
        sourceType: 'logistics', sourceId: batch.id, sourceNo: batch.batch_no,
        feeType: cat.feeType, categoryCode: cat.categoryCode, subcategoryCode: cat.subcategoryCode,
        payeeType: cat.payeeType, payeeKey: cat.payeeKey, payeeName: defaultPayee,
        currency: currency, payableAmount: amount, sourceCiId: ci.id, createdBy: createdBy
      });
      var payableItemId = (piResult && piResult.id) ? piResult.id : '';
      var cciId = genId('cci');
      run('INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, remark, logistics_batch_id, payable_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [cciId, ci.id, ci.ci_no, '', '', cat.categoryCode, cat.subcategoryCode, amount, 0, 1, defaultPayee, currency, cat.remark, batch.id, payableItemId]);
      return { feeType: cat.feeType, action: 'CREATE', payable_item_id: payableItemId, ci_cost_item_id: cciId, amount: amount, currency: currency };
    }

    // REACTIVATE: cancelled payable → active
    if (isPayableCancelled) {
      if (paymentFlowStarted) {
        throw { status: 409, code: 'LOGISTICS_COST_ALREADY_IN_PAYMENT_FLOW',
                message: '该费用已进入付款流程，不能修改金额/币种',
                detail: { batch_id: batch.id, fee_type: cat.feeType, payable_item_id: payable.id, lifecycle_status: payable.lifecycle_status } };
      }
      if (costConfirmed) {
        throw { status: 409, code: 'CI_COST_CONFIRMED', message: '该CI费用已确认，不能继续新增/修改费用' };
      }
      run('UPDATE payable_items SET lifecycle_status = ?, payable_amount_minor = ?, currency = ?, cancelled_by = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?',
        ['active', amountMinor, currency, '', '', '', payable.id]);
      if (hasDisabledCiCost) {
        run('UPDATE ci_cost_items SET include_in_landing_cost = 1, payable_amount = ?, currency = ? WHERE id = ?', [amount, currency, disabledCiCost.id]);
      } else if (!hasCurrentCiCost) {
        var cciId2 = genId('cci');
        run('INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, remark, logistics_batch_id, payable_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [cciId2, ci.id, ci.ci_no, '', '', cat.categoryCode, cat.subcategoryCode, amount, 0, 1, defaultPayee, currency, cat.remark, batch.id, payable.id]);
      }
      return { feeType: cat.feeType, action: 'REACTIVATE', payable_item_id: payable.id, amount: amount, currency: currency };
    }

    // Payable present (active / reserved / partially_paid / paid) + amount > 0
    if (isPayablePresent) {
      // ── NO_CHANGE check: payable + ci_cost + linkage all consistent ──
      // 全部使用 minor units (整数 cents) 比较，避免 float 精度问题
      if (hasCurrentCiCost) {
        var payableAmountMinor = Number(payable.payable_amount_minor);
        var ciCostAmountMinor = Math.round((Number(ciCost.payable_amount) || 0) * 100);

        var payableAmtOk = (payableAmountMinor === amountMinor);
        var payableCurOk = (payable.currency === currency);
        var ciCostAmtOk = (ciCostAmountMinor === amountMinor);
        var ciCostCurOk = (ciCost.currency === currency);
        var linkageOk = (ciCost.payable_item_id === payable.id);

        // NO_CHANGE: everything consistent → no mutation, no guards, no throw
        if (payableAmtOk && payableCurOk && ciCostAmtOk && ciCostCurOk && linkageOk) {
          return null;
        }

        // ── Drift: payable and ci_cost disagree with each other ──
        var drift = (payableAmountMinor !== ciCostAmountMinor
                     || payable.currency !== ciCost.currency
                     || !linkageOk);

        if (drift) {
          // Can't silently fix settlement-linked facts if payment flow started
          if (paymentFlowStarted) {
            throw { status: 409, code: 'COST_GENERATION_STATE_CONFLICT',
                    message: '数据完整性异常：payable与ci_cost_item金额/币种/linkage不一致',
                    detail: { batch_id: batch.id, fee_type: cat.feeType,
                              payable_amount_minor: payableAmountMinor, ci_cost_amount_minor: ciCostAmountMinor,
                              payable_currency: payable.currency, ci_cost_currency: ciCost.currency,
                              payable_item_id: payable.id, ci_cost_payable_item_id: ciCost.payable_item_id } };
          }
          // Not in payment flow → sync to fix drift
          if (costConfirmed) {
            throw { status: 409, code: 'CI_COST_CONFIRMED', message: '该CI费用已确认，不能继续新增/修改费用' };
          }
          run('UPDATE payable_items SET payable_amount_minor = ?, currency = ? WHERE id = ?',
            [amountMinor, currency, payable.id]);
          run('UPDATE ci_cost_items SET payable_amount = ?, currency = ?, payable_item_id = ? WHERE id = ?',
            [amount, currency, payable.id, ciCost.id]);
          return { feeType: cat.feeType, action: 'SYNC', payable_item_id: payable.id, amount: amount, currency: currency };
        }

        // Payable and ci_cost agree with each other, but differ from desired → needs UPDATE
        if (paymentFlowStarted) {
          throw { status: 409, code: 'LOGISTICS_COST_ALREADY_IN_PAYMENT_FLOW',
                  message: '该费用已进入付款流程，不能修改金额/币种',
                  detail: { batch_id: batch.id, fee_type: cat.feeType, payable_item_id: payable.id, lifecycle_status: payable.lifecycle_status } };
        }
        if (costConfirmed) {
          throw { status: 409, code: 'CI_COST_CONFIRMED', message: '该CI费用已确认，不能继续新增/修改费用' };
        }
        run('UPDATE payable_items SET payable_amount_minor = ?, currency = ? WHERE id = ?',
          [amountMinor, currency, payable.id]);
        run('UPDATE ci_cost_items SET payable_amount = ?, currency = ? WHERE id = ?',
          [amount, currency, ciCost.id]);
        return { feeType: cat.feeType, action: 'SYNC', payable_item_id: payable.id, amount: amount, currency: currency };
      }

      // payable present + disabled ci_cost (no current) → re-enable (recoverable)
      if (hasDisabledCiCost) {
        if (paymentFlowStarted) {
          throw { status: 409, code: 'LOGISTICS_COST_ALREADY_IN_PAYMENT_FLOW',
                  message: '该费用已进入付款流程，不能修改',
                  detail: { batch_id: batch.id, fee_type: cat.feeType, payable_item_id: payable.id, lifecycle_status: payable.lifecycle_status } };
        }
        if (costConfirmed) {
          throw { status: 409, code: 'CI_COST_CONFIRMED', message: '该CI费用已确认，不能继续新增/修改费用' };
        }
        run('UPDATE payable_items SET payable_amount_minor = ?, currency = ? WHERE id = ?',
          [amountMinor, currency, payable.id]);
        run('UPDATE ci_cost_items SET include_in_landing_cost = 1, payable_amount = ?, currency = ? WHERE id = ?',
          [amount, currency, disabledCiCost.id]);
        return { feeType: cat.feeType, action: 'SYNC', payable_item_id: payable.id, amount: amount, currency: currency };
      }
      // Should not reach here (CONFLICT check catches no ci_cost at all)
    }
  } else {
    // amount = 0: soft-cancel if payable present and no payment flow
    if (isPayablePresent && (hasCurrentCiCost || hasDisabledCiCost)) {
      if (paymentFlowStarted) {
        throw { status: 409, code: 'LOGISTICS_COST_ALREADY_IN_PAYMENT_FLOW',
                message: '该费用已进入付款流程，不能取消',
                detail: { batch_id: batch.id, fee_type: cat.feeType, payable_item_id: payable.id, lifecycle_status: payable.lifecycle_status } };
      }
      if (costConfirmed) {
        throw { status: 409, code: 'CI_COST_CONFIRMED', message: '该CI费用已确认，不能继续新增/修改费用' };
      }
      cancelPayableItem(payable.id, createdBy, '物流费用改为0');
      if (hasCurrentCiCost) {
        run('UPDATE ci_cost_items SET include_in_landing_cost = 0 WHERE id = ?', [ciCost.id]);
      }
      return { feeType: cat.feeType, action: 'CANCEL', payable_item_id: payable.id, amount: 0, currency: currency };
    }
    // No payable present (cancelled or absent) → nothing to do → NO_CHANGE
  }

  return null;
}

/**
 * 锁定应付费用（active / partially_paid → reserved）
 * 供 Task 2 payment_request_items 使用
 * PAY-CORE 多次付款：partially_paid（已付部分、仍有剩余）同样可被下一次付款申请锁定
 */
function reservePayableItem(payableItemId, paymentRequestId) {
  const result = run(
    `UPDATE payable_items
     SET lifecycle_status = 'reserved'
     WHERE id = ? AND lifecycle_status IN ('active', 'partially_paid')`,
    [payableItemId]
  );
  return result.changes > 0;
}

/**
 * 释放应付费用（reserved → active / partially_paid）
 * 供 Task 2 reject-approval 使用
 * PAY-CORE 多次付款：已发生过结算的费用释放后回到 partially_paid，避免被误取消或被来源单据金额同步覆盖
 */
function releasePayableItem(payableItemId) {
  const settledMinor = payableItemsSettledMinor([payableItemId]).get(payableItemId) || 0;
  const target = settledMinor > 0 ? 'partially_paid' : 'active';
  const result = run(
    `UPDATE payable_items
     SET lifecycle_status = ?
     WHERE id = ? AND lifecycle_status = 'reserved'`,
    [target, payableItemId]
  );
  return result.changes > 0;
}

/**
 * 释放付款申请关联的所有 payable_items（reserved → active）
 * PAY-CORE Phase 1.5 Task 2：reject-approval 时调用（业务规则 7）
 * 仅 multi 模式触发；single 模式 Task 1 未 reserve，保持兼容
 */
function releasePayableItemsByPR(prId) {
  const items = query(
    `SELECT payable_item_id FROM payment_request_items WHERE payment_request_id = ?`,
    [prId]
  );
  let released = 0;
  for (const row of items.rows || []) {
    // P0-FIX-5：释放前检查该 item 是否还被其他非终态 PR 有效关联
    // 若存在重复有效关联，抛出数据一致性错误，触发事务回滚
    // PAY-CORE 多次付款：已完成付款动作的历史 PR（partial_paid / paid 等）不再占用该费用，
    // 否则同一费用第二次申请后撤回会误判为"重复关联"。
    const otherActivePRs = query(
      `SELECT COUNT(*) AS cnt FROM payment_request_items pri
       JOIN payment_requests pr ON pr.id = pri.payment_request_id
       WHERE pri.payable_item_id = ? AND pri.payment_request_id != ?
         AND pr.payment_status NOT IN ('cancelled','rejected','paid','partial_paid',
                                       'partial_payment_partial_deduction','deduction_settled','partial_rounding')
         AND pr.approval_status NOT IN ('cancelled','rejected')`,
      [row.payable_item_id, prId]
    );
    if (otherActivePRs.rows[0] && otherActivePRs.rows[0].cnt > 0) {
      throw new Error(`数据一致性错误：应付费用 ${row.payable_item_id} 被多个有效付款申请关联，不得释放`);
    }
    if (releasePayableItem(row.payable_item_id)) released++;
  }
  return released;
}

/**
 * PAY-CORE P0-2：multi PR 来源 PI 状态同步
 * 从给定 payable_items 行中找出 source_type='pi' 且 fee_type='deposit' 的来源 PI（去重），
 * 将其 deposit_payment_status 更新为指定状态（pending_approval / unpaid）
 * 仅当当前状态匹配 fromStatus 时才更新，避免误覆盖已完成的状态
 * @param {Array} payableRows - payable_items 行（需含 source_type, source_id, fee_type）
 * @param {string} toStatus - 目标状态
 * @param {string} fromStatus - 仅当当前状态等于此值才更新（可选，默认不限）
 */
function syncMultiSourcePiStatus(payableRows, toStatus, fromStatus) {
  const piIds = new Set();
  for (const r of payableRows || []) {
    if (r.source_type === 'pi' && r.fee_type === 'deposit' && r.source_id) {
      piIds.add(r.source_id);
    }
  }
  if (piIds.size === 0) return 0;
  let updated = 0;
  for (const piId of piIds) {
    if (fromStatus) {
      const result = run(
        `UPDATE proforma_invoices SET deposit_payment_status = ?, updated_at = datetime('now')
         WHERE id = ? AND deposit_payment_status = ?`,
        [toStatus, piId, fromStatus]
      );
      if (result.changes > 0) updated++;
    } else {
      const result = run(
        `UPDATE proforma_invoices SET deposit_payment_status = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [toStatus, piId]
      );
      if (result.changes > 0) updated++;
    }
  }
  return updated;
}

/**
 * 标记应付费用已付款（reserved → paid）
 * V5 修正 1：不更新 is_active，paid 视为有效历史财务记录
 * 供 Task 4 applyPaymentSettlement 使用
 */
function markPayableItemPaid(payableItemId) {
  const result = run(
    `UPDATE payable_items
     SET lifecycle_status = 'paid'
     WHERE id = ? AND lifecycle_status IN ('reserved', 'partially_paid')`,
    [payableItemId]
  );
  return result.changes > 0;
}

/**
 * 标记应付费用部分已付（reserved → partially_paid）
 * PAY-CORE 多次付款：一笔应付事实可分多次付清，本次付款完成后释放剩余金额，
 * 费用继续留在应付列表并可再次发起付款申请，不新增尾款业务对象。
 */
function markPayableItemPartiallyPaid(payableItemId) {
  const result = run(
    `UPDATE payable_items
     SET lifecycle_status = 'partially_paid'
     WHERE id = ? AND lifecycle_status = 'reserved'`,
    [payableItemId]
  );
  return result.changes > 0;
}

/**
 * PAY-CORE Phase 2：金额转换 helper（统一口径，规避浮点误差）
 */
function amountToMinor(amount) {
  return Math.round((Number(amount) || 0) * 100 + Number.EPSILON);
}
function minorToAmount(minor) {
  return (Number(minor) || 0) / 100;
}

// PAY-CORE 多次付款：payable_item 已结算金额（minor）
// 业务模型：payable_item = 一笔应付事实，可被多次付款申请分次结清，不新增尾款对象。
// 口径：① 付款取 payment_allocations（reconciled）——真实资金分摊事实；
//       ② 抵扣/抹零为 PR 级事实，按本项 requested_amount_minor 在该 PR 内的占比分摊；
//       ③ 仅统计非 cancelled/rejected 的付款申请。
// 剩余可付 = payable_amount_minor - 已结算金额。
function payableItemsSettledMinor(itemIds) {
  const result = new Map();
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  if (!ids.length) return result;
  ids.forEach(id => result.set(id, 0));
  const priRows = query(
    `SELECT pri.id, pri.payable_item_id, pri.payment_request_id, pri.requested_amount_minor
     FROM payment_request_items pri
     JOIN payment_requests pr ON pr.id = pri.payment_request_id
     WHERE pri.payable_item_id IN (${ids.map(() => '?').join(',')})
       AND pr.payment_status NOT IN ('cancelled','rejected')
       AND pr.approval_status NOT IN ('cancelled','rejected')`,
    ids
  ).rows || [];
  if (!priRows.length) return result;
  const priIds = priRows.map(r => r.id);
  const prIds = [...new Set(priRows.map(r => r.payment_request_id))];
  // ① 付款分摊
  const paidByPri = new Map();
  const allocRows = query(
    `SELECT payment_request_item_id, SUM(allocated_amount_minor) AS paid_minor
     FROM payment_allocations
     WHERE status = 'reconciled' AND payment_request_item_id IN (${priIds.map(() => '?').join(',')})
     GROUP BY payment_request_item_id`,
    priIds
  ).rows || [];
  allocRows.forEach(r => paidByPri.set(r.payment_request_item_id, Number(r.paid_minor || 0)));
  // ② PR 级抵扣 + 抹零（applied 才计入，reversed 自动排除）
  const drByPr = new Map();
  const drRows = query(
    `SELECT payment_request_id, SUM(amount) AS amt
     FROM payment_settlement_logs
     WHERE status = 'applied' AND event_type IN ('deduction','rounding')
       AND payment_request_id IN (${prIds.map(() => '?').join(',')})
     GROUP BY payment_request_id`,
    prIds
  ).rows || [];
  drRows.forEach(r => drByPr.set(r.payment_request_id, amountToMinor(r.amt)));
  // ③ 各 PR 的 requested 总额（须取该 PR 全部明细，占比才正确）
  const totalByPr = new Map();
  const totRows = query(
    `SELECT payment_request_id, SUM(requested_amount_minor) AS total_minor
     FROM payment_request_items
     WHERE payment_request_id IN (${prIds.map(() => '?').join(',')})
     GROUP BY payment_request_id`,
    prIds
  ).rows || [];
  totRows.forEach(r => totalByPr.set(r.payment_request_id, Number(r.total_minor || 0)));
  for (const r of priRows) {
    const paidMinor = paidByPri.get(r.id) || 0;
    const drMinor = drByPr.get(r.payment_request_id) || 0;
    const totalMinor = totalByPr.get(r.payment_request_id) || 0;
    const share = totalMinor > 0 ? (Number(r.requested_amount_minor || 0) / totalMinor) : 0;
    const settled = paidMinor + Math.round(drMinor * share);
    result.set(r.payable_item_id, (result.get(r.payable_item_id) || 0) + settled);
  }
  return result;
}

// PAY-CORE 多次付款：payable_item 结算拆分（minor）
// 与 payableItemsSettledMinor 同源，但拆成三路，供应付费用列表按「已付款 / 抵扣 / 抹零」分别展示：
//   paidMinor     = 真实付款（payment_allocations reconciled）+ 历史 legacy 付款（按本项占比分摊）
//   deductionMinor= PR 级抵扣（applied，按本项在该 PR 内占比分摊）
//   roundingMinor = PR 级抹零（applied，按本项占比分摊）
// 剩余可付 = payable_amount_minor - paidMinor - deductionMinor - roundingMinor。
function payableItemsSettlementBreakdown(itemIds) {
  const result = new Map();
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  ids.forEach(id => result.set(id, { paidMinor: 0, deductionMinor: 0, roundingMinor: 0 }));
  if (!ids.length) return result;
  const priRows = query(
    `SELECT pri.id, pri.payable_item_id, pri.payment_request_id, pri.requested_amount_minor
     FROM payment_request_items pri
     JOIN payment_requests pr ON pr.id = pri.payment_request_id
     WHERE pri.payable_item_id IN (${ids.map(() => '?').join(',')})
       AND pr.payment_status NOT IN ('cancelled','rejected')
       AND pr.approval_status NOT IN ('cancelled','rejected')`,
    ids
  ).rows || [];
  if (!priRows.length) return result;
  const priIds = priRows.map(r => r.id);
  const prIds = [...new Set(priRows.map(r => r.payment_request_id))];
  // 真实付款（新事务，reconciled）
  const paidByPri = new Map();
  query(
    `SELECT payment_request_item_id, SUM(allocated_amount_minor) AS paid_minor
     FROM payment_allocations
     WHERE status = 'reconciled' AND payment_request_item_id IN (${priIds.map(() => '?').join(',')})
     GROUP BY payment_request_item_id`,
    priIds
  ).rows.forEach(r => paidByPri.set(r.payment_request_item_id, Number(r.paid_minor || 0)));
  // 历史 legacy 付款（applied 的 payment 事件，is_legacy=1），PR 级，需按占比分摊到各 pri
  const legacyPaidByPr = new Map();
  query(
    `SELECT payment_request_id, SUM(amount) AS amt
     FROM payment_settlement_logs
     WHERE status = 'applied' AND event_type = 'payment' AND is_legacy = 1
       AND payment_request_id IN (${prIds.map(() => '?').join(',')})
     GROUP BY payment_request_id`,
    prIds
  ).rows.forEach(r => legacyPaidByPr.set(r.payment_request_id, amountToMinor(r.amt)));
  // PR 级抵扣 + 抹零（applied），按本项占比分摊
  const dedByPr = new Map();
  const rndByPr = new Map();
  query(
    `SELECT payment_request_id, event_type, SUM(amount) AS amt
     FROM payment_settlement_logs
     WHERE status = 'applied' AND event_type IN ('deduction','rounding')
       AND payment_request_id IN (${prIds.map(() => '?').join(',')})
     GROUP BY payment_request_id, event_type`,
    prIds
  ).rows.forEach(r => {
    const m = amountToMinor(r.amt);
    if (r.event_type === 'deduction') dedByPr.set(r.payment_request_id, m);
    else rndByPr.set(r.payment_request_id, m);
  });
  const totalByPr = new Map();
  query(
    `SELECT payment_request_id, SUM(requested_amount_minor) AS total_minor
     FROM payment_request_items
     WHERE payment_request_id IN (${prIds.map(() => '?').join(',')})
     GROUP BY payment_request_id`,
    prIds
  ).rows.forEach(r => totalByPr.set(r.payment_request_id, Number(r.total_minor || 0)));
  for (const r of priRows) {
    const share = (totalByPr.get(r.payment_request_id) || 0) > 0
      ? (Number(r.requested_amount_minor || 0) / totalByPr.get(r.payment_request_id)) : 0;
    const legacyPaid = (legacyPaidByPr.get(r.payment_request_id) || 0) * share;
    const paid = (paidByPri.get(r.id) || 0) + Math.round(legacyPaid);
    const deduction = Math.round((dedByPr.get(r.payment_request_id) || 0) * share);
    const rounding = Math.round((rndByPr.get(r.payment_request_id) || 0) * share);
    const cur = result.get(r.payable_item_id);
    cur.paidMinor += paid;
    cur.deductionMinor += deduction;
    cur.roundingMinor += rounding;
  }
  return result;
}

// 单项剩余可付金额（minor），不足 0 时归 0
function payableItemRemainingMinor(item) {
  if (!item) return 0;
  const settled = payableItemsSettledMinor([item.id]).get(item.id) || 0;
  return Math.max(0, Number(item.payable_amount_minor || 0) - settled);
}

function finalPaymentApprovalInput(payment, body = {}) {
  // PAY-CORE Phase 2：读取付款账户，透传至 applyPaymentSettlement（与 confirm-paid 路径一致）
  const paymentAccount = body.payment_account != null ? String(body.payment_account) : '';
  const actualPaidAmount = settlementMoney(body.actual_paid_amount);
  if (!(actualPaidAmount > 0)) {
    throw new SettlementError(400, '最终审批必须填写有效的实际付款金额');
  }
  const actualPaidDate = settlementDate(body.actual_paid_date);
  const requestedAmount = settlementMoney(payment.payable_amount || 0);
  if (actualPaidAmount > requestedAmount) {
    throw new SettlementError(400, '实际付款金额不能大于申请金额');
  }
  // PAY-CORE Phase 2：支持部分付款（actualPaidAmount < requestedAmount 且无抹零）
  const isPartialPayment = actualPaidAmount < requestedAmount;
  const submittedRounding = body.rounding_amount != null ? settlementMoney(body.rounding_amount) : 0;

  let roundingAmount = 0;
  let applyRoundOff = false;

  if (isPartialPayment) {
    if (submittedRounding > 0) {
      throw new SettlementError(400, '部分付款不支持抹零，请清除抹零金额后重试');
    }
    roundingAmount = 0;
    applyRoundOff = false;
  } else {
    roundingAmount = settlementMoney(requestedAmount - actualPaidAmount);
    if (!Number.isFinite(submittedRounding) || submittedRounding < 0) {
      throw new SettlementError(400, '抹零金额无效');
    }
    if (Math.abs(submittedRounding - roundingAmount) > 0.005) {
      throw new SettlementError(400, '抹零金额必须等于申请金额减实际付款金额');
    }
    if (roundingAmount > 0 && Math.abs(actualPaidAmount - Math.floor(requestedAmount)) > 0.005) {
      throw new SettlementError(400, '现有付款核心仅支持小数尾差抹零');
    }
    applyRoundOff = roundingAmount > 0;
  }

  const attachmentValue = body.attachment !== undefined ? body.attachment : payment.attachment;
  const attachment = parseAttachment(attachmentValue);
  let hasAttachment = Boolean(String(attachment || '').trim());
  if (hasAttachment) {
    try {
      const parsed = JSON.parse(attachment);
      if (Array.isArray(parsed)) hasAttachment = parsed.length > 0;
      else if (parsed && typeof parsed === 'object') hasAttachment = Object.keys(parsed).length > 0;
    } catch (e) {
      // 历史字符串附件保持兼容，非空即视为已有付款凭证。
    }
  }
  if (!hasAttachment) {
    throw new SettlementError(400, '最终审批必须上传水单附件');
  }

  return {
    actualPaidAmount,
    actualPaidDate,
    roundingAmount,
    applyRoundOff,
    attachment,
    paymentAccount,
    idempotencyKey: String(body.idempotency_key || `approval:${payment.id}`).trim()
  };
}

async function settleFinalPaymentApproval(payment, body, req) {
  const input = finalPaymentApprovalInput(payment, body);
  await run(
    `UPDATE payment_requests
     SET attachment = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [input.attachment, payment.id]
  );
  // PAY-CORE Phase 2：透传 rounding_amount / rounding_reason / bank_ref_no，与 confirm-paid 路径一致
  // PAY-CORE 人工分摊：透传 allocations（合并付款确认时前端逐项填写），缺省则走原自动比例分摊
  return await applyPaymentSettlement(
    payment.id,
    input.actualPaidAmount,
    input.actualPaidDate,
    '',
    req,
    input.idempotencyKey,
    {
      voucher_attachment: input.attachment,
      apply_round_off: input.applyRoundOff,
      rounding_amount: input.roundingAmount,
      rounding_reason: body.rounding_reason || '',
      bank_ref_no: body.bank_ref_no || '',
      payment_account: input.paymentAccount || '',
      allocations: Array.isArray(body.allocations) ? body.allocations : undefined
    }
  );
}

/**
 * PAY-CORE Phase 2：single PR 关联 payable_item 并 reserve
 * 业务规则（V2.1 第 8 节）：
 *   1. 按 source_type + source_id + fee_type 查找 active / partially_paid payable_item
 *   2. 找到 >1 个候选 → 抛错冲突，事务回滚
 *   3. 找到 1 个 → 校验 currency/payee_key 一致 → 创建 payment_request_items（本次剩余金额）→ reserve
 *   4. 找到 0 个 → 历史兼容路径，跳过（不创建 items，不 reserve）
 *   5. 必须在 PR 创建事务内调用
 * PAY-CORE 多次付款：partially_paid 的费用仍有剩余可付，再次发起申请时只关联「剩余金额」，
 * 不动用已结算部分；remaining<=0 视为已付清，拒绝重复创建。
 * @returns {Object|null} 关联的 payable_item 或 null（历史兼容）
 */
function linkSinglePayableItem(prId, sourceType, sourceId, feeType, prCurrency, prPayeeKey) {
  const candidates = query(
    `SELECT * FROM payable_items
     WHERE source_type = ? AND source_id = ? AND fee_type = ?
       AND lifecycle_status IN ('active', 'partially_paid')`,
    [sourceType, sourceId, feeType]
  );
  const items = candidates.rows || [];
  if (items.length === 0) return null; // 历史兼容：PI/CI 在 Task 1 前创建，无 payable_item
  if (items.length > 1) {
    throw new SettlementError(409, `来源 ${sourceType}:${sourceId} 存在 ${items.length} 个 active/partially_paid 应付费用（${feeType}），无法自动关联，请先清理重复数据`);
  }
  const payableItem = items[0];
  // 校验 currency 一致
  if (String(payableItem.currency || '').toUpperCase() !== String(prCurrency || '').toUpperCase()) {
    throw new SettlementError(409, `应付费用币种 ${payableItem.currency} 与付款申请币种 ${prCurrency} 不一致，无法关联`);
  }
  // 校验 payee_key 一致
  if (String(payableItem.payee_key || '') !== String(prPayeeKey || '')) {
    throw new SettlementError(409, `应付费用收款方 ${payableItem.payee_key} 与付款申请收款方 ${prPayeeKey} 不一致，无法关联`);
  }
  // PAY-CORE 多次付款：本次可申请金额 = 应付 - 已结算（剩余可付）
  const payableMinor = Number(payableItem.payable_amount_minor || 0);
  const settledMinor = payableItemsSettledMinor([payableItem.id]).get(payableItem.id) || 0;
  const remainingMinor = payableMinor - settledMinor;
  if (remainingMinor <= 0) {
    throw new SettlementError(409, `应付费用 ${payableItem.fee_no} 已付清（剩余 ${minorToAmount(remainingMinor)}），无需再次付款`);
  }
  // 创建 payment_request_items（1 行，剩余金额）
  run(
    `INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor)
     VALUES (?, ?, ?, ?)`,
    [genId('pri'), prId, payableItem.id, remainingMinor]
  );
  // reserve payable_item（active / partially_paid → reserved）
  if (!reservePayableItem(payableItem.id, prId)) {
    throw new SettlementError(409, `应付费用 ${payableItem.fee_no} 状态已变更，无法锁定`);
  }
  return payableItem;
}

function resolveSettlementCountry(payment) {
  const countryName = String(payment.expense_country || '').trim();
  if (!countryName) throw new SettlementError(400, `付款申请 ${payment.request_no} 未设置费用归属国家，请先由财务补录后再付款`);

  let country = queryOne('SELECT * FROM countries WHERE name = ? OR code = ?', [countryName, countryName]);
  if (!country) {
    const alias = COUNTRY_ALIAS_MAP[countryName];
    if (alias) country = queryOne('SELECT * FROM countries WHERE name = ?', [alias]);
  }
  if (!country) {
    const standardName = Object.keys(COUNTRY_ALIAS_MAP).find(name => COUNTRY_ALIAS_MAP[name] === countryName);
    if (standardName) country = queryOne('SELECT * FROM countries WHERE name = ?', [standardName]);
  }
  if (!country || !country.default_currency) {
    throw new SettlementError(400, `来源国家“${countryName}”未配置本国货币，不能完成付款折算`);
  }
  return { name: country.name, currency: country.default_currency };
}

function exactSettlementRate(fromCurrency, toCurrency, paidDate) {
  if (fromCurrency === toCurrency) {
    return { rate: 1, rate_date: paidDate, rate_type: 'identity', direction: 'identity' };
  }
  const direct = queryOne(`SELECT * FROM exchange_rates
                           WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ?
                           ORDER BY created_at DESC, id DESC LIMIT 1`, [fromCurrency, toCurrency, paidDate, SETTLEMENT_RATE_TYPE]);
  if (direct && Number(direct.rate) > 0) {
    return { rate: Number(direct.rate), rate_date: direct.rate_date, rate_type: direct.rate_type || '', direction: 'direct' };
  }
  const reverse = queryOne(`SELECT * FROM exchange_rates
                            WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ?
                            ORDER BY created_at DESC, id DESC LIMIT 1`, [toCurrency, fromCurrency, paidDate, SETTLEMENT_RATE_TYPE]);
  if (reverse && Number(reverse.rate) > 0) {
    return { rate: 1 / Number(reverse.rate), rate_date: reverse.rate_date, rate_type: reverse.rate_type || '', direction: 'reverse' };
  }
  throw new SettlementError(400, `缺少 ${paidDate} ${fromCurrency}→${toCurrency} 的 realtime 付款汇率`);
}

var FX_PROVIDER_TIMEOUT_MS = 5000;

function isValidRateDate(s) {
  if (typeof s !== 'string') return false;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  return true;
}

async function resolvePaymentFxRate({ fromCurrency, toCurrency, rateDate, timeoutMs }) {
  if (fromCurrency === toCurrency) {
    return { rate: 1, rate_date: rateDate, rate_type: 'identity', direction: 'identity', source: 'identity' };
  }
  var direct = queryOne('SELECT * FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ? ORDER BY created_at DESC, id DESC LIMIT 1', [fromCurrency, toCurrency, rateDate, SETTLEMENT_RATE_TYPE]);
  if (direct && Number(direct.rate) > 0) {
    return { rate: Number(direct.rate), rate_date: direct.rate_date, rate_type: direct.rate_type || '', direction: 'direct', source: 'db_direct' };
  }
  var reverse = queryOne('SELECT * FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ? ORDER BY created_at DESC, id DESC LIMIT 1', [toCurrency, fromCurrency, rateDate, SETTLEMENT_RATE_TYPE]);
  if (reverse && Number(reverse.rate) > 0) {
    return { rate: 1 / Number(reverse.rate), rate_date: reverse.rate_date, rate_type: reverse.rate_type || '', direction: 'reverse', source: 'db_reverse' };
  }
  var apiFrom = CURRENCY_API_MAP[fromCurrency] || fromCurrency;
  var apiTo = CURRENCY_API_MAP[toCurrency] || toCurrency;
  var providerRate = null;
  var providerDate = null;
  var abortMs = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : FX_PROVIDER_TIMEOUT_MS;
  try {
    var resp = await fetch('https://api.frankfurter.dev/v1/' + rateDate + '?base=' + encodeURIComponent(apiFrom) + '&symbols=' + encodeURIComponent(apiTo), { signal: AbortSignal.timeout(abortMs) });
    if (resp.ok) {
      var data = await resp.json();
      if (data && data.rates && data.rates[apiTo]) {
        providerRate = Number(data.rates[apiTo]);
        providerDate = data.date;
      }
    }
  } catch (fetchErr) {
    // provider error/timeout/abort → fall through to blocker
  }
  if (!providerRate || !(providerRate > 0) || providerDate !== rateDate) {
    throw new SettlementError(400, '缺少 ' + rateDate + ' ' + fromCurrency + '→' + toCurrency + ' 的 realtime 付款汇率');
  }
  var cacheId = 'fxauto_' + rateDate + '_' + fromCurrency + '_' + toCurrency + '_' + SETTLEMENT_RATE_TYPE;
  try {
    run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      [cacheId, fromCurrency, toCurrency, providerRate, rateDate, SETTLEMENT_RATE_TYPE]);
  } catch (e) {
    // ON CONFLICT not supported or duplicate — ignore, reread will get existing
  }
  var cached = queryOne('SELECT * FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ? ORDER BY created_at DESC, id DESC LIMIT 1', [fromCurrency, toCurrency, rateDate, SETTLEMENT_RATE_TYPE]);
  if (cached && Number(cached.rate) > 0) {
    return { rate: Number(cached.rate), rate_date: cached.rate_date, rate_type: cached.rate_type || '', direction: 'direct', source: 'provider_cached' };
  }
  throw new SettlementError(400, '缺少 ' + rateDate + ' ' + fromCurrency + '→' + toCurrency + ' 的 realtime 付款汇率');
}

async function buildPaymentRateSnapshot(payment, amount, paidDate) {
  if (payment.payment_category === 'goods') {
    return {
      settlement_country: '', local_currency: '', local_rate: 0, local_rate_date: '', local_rate_type: '', local_rate_direction: '', local_amount: 0,
      rmb_rate: 0, rmb_rate_date: '', rmb_rate_type: '', rmb_rate_direction: '', rmb_amount: 0
    };
  }
  const country = await resolveSettlementCountry(payment);
  const originalCurrency = String(payment.currency || '').trim();
  if (!originalCurrency) throw new SettlementError(400, `付款申请 ${payment.request_no} 未配置原币币种`);
  const localRate = await exactSettlementRate(originalCurrency, country.currency, paidDate);
  const rmbRate = await exactSettlementRate(originalCurrency, 'RMB', paidDate);
  return {
    settlement_country: country.name,
    local_currency: country.currency,
    local_rate: localRate.rate,
    local_rate_date: localRate.rate_date,
    local_rate_type: localRate.rate_type,
    local_rate_direction: localRate.direction,
    local_amount: settlementMoney(amount * localRate.rate),
    rmb_rate: rmbRate.rate,
    rmb_rate_date: rmbRate.rate_date,
    rmb_rate_type: rmbRate.rate_type,
    rmb_rate_direction: rmbRate.direction,
    rmb_amount: settlementMoney(amount * rmbRate.rate)
  };
}

async function recordInitialDeduction(paymentRequestId, amount, reason, operator) {
  const deduction = settlementMoney(amount);
  if (!(deduction > 0)) return;
  const payment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [paymentRequestId]);
  if (!payment) throw new SettlementError(404, '付款申请不存在');
  await run(`INSERT INTO payment_settlement_logs
       (id, payment_request_id, event_type, amount, status, reason, original_currency, operator_id, operator_name)
       VALUES (?, ?, 'deduction', ?, 'applied', ?, ?, ?, ?)`,
    [await genId('settle'), payment.id, deduction, reason || '创建付款申请时应用抵扣', payment.currency || '', operator.id, operator.name]);
  return await recalculatePaymentSettlement(payment.id);
}

async function paymentIdempotencyResult(existing, payment, requestedAmount, paidDate, voucher) {
  const sameAmount = requestedAmount === null || settlementMoney(existing.amount) === requestedAmount;
  const sameContent = existing.payment_request_id === payment.id && sameAmount &&
    String(existing.paid_date || '') === paidDate && String(existing.payment_voucher || '') === voucher;
  if (!sameContent) {
    throw new SettlementError(409, '该付款幂等键已用于不同的付款申请、金额、付款日期或凭证，不能重复使用');
  }
  // PAY-CORE Phase 2 SSOT：通过 settlement_log_id 反查关联的 transaction
  const tx = await queryOne(
    'SELECT id, trans_no FROM payment_transactions WHERE settlement_log_id = ?',
    [existing.id]
  );
  const facts = await paymentSettlementFacts(payment);
  return {
    idempotent: true,
    log_id: existing.id,
    transaction_id: tx ? tx.id : null,
    trans_no: tx ? tx.trans_no : null,
    ...facts,
    outstanding: Math.max(0, facts.outstanding),
    payment_status: derivePaymentStatus(payment, facts)
  };
}

async function applyPaymentSettlement(paymentRequestId, rawAmount, rawPaidDate, voucher, req, rawIdempotencyKey, options = {}) {
  return await transaction(async () => {
    const payment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [paymentRequestId]);
    if (!payment) throw new SettlementError(404, '付款申请不存在');
    if (payment.approval_status !== 'approved') throw new SettlementError(409, '付款申请尚未审批通过，不能确认付款');
    if (['cancelled', 'rejected'].includes(payment.payment_status)) throw new SettlementError(409, '当前付款申请状态不允许确认付款');
    // PAY-CORE Phase 2：MULTI 隔离（V2.1 第 10 节）
    if (String(payment.currency || '').toUpperCase() === 'MULTI') {
      throw new SettlementError(400, '该付款申请币种无效（MULTI），无法确认付款。请重新创建符合币种规则的付款申请。');
    }
    const idempotencyKey = settlementIdempotencyKey(rawIdempotencyKey);
    const paidDate = settlementDate(rawPaidDate);
    const normalizedVoucher = String(voucher || '').trim();
    const bankRefNo = String(options.bank_ref_no || '').trim();
    const paymentAccount = String(options.payment_account || '').trim();
    const voucherAttachment = String(options.voucher_attachment || normalizedVoucher).trim();
    const applyRoundOff = options.apply_round_off === true;
    // PAY-CORE V3：人工抹零参数（独立于 apply_round_off 自动 floor 逻辑）
    const userRoundingAmount = options.rounding_amount != null ? settlementMoney(options.rounding_amount) : null;
    const userRoundingReason = String(options.rounding_reason || '').trim();
    const hasUserRounding = userRoundingAmount != null && userRoundingAmount > 0;
    const existing = await queryOne(`SELECT * FROM payment_settlement_logs
                               WHERE event_type = 'payment' AND idempotency_key = ?`, [idempotencyKey]);
    if (existing) return await paymentIdempotencyResult(existing, payment, null, paidDate, normalizedVoucher);
    await ensureSettlementLegacyBaselines(payment);
    const before = await paymentSettlementFacts(payment);
    if (before.outstanding <= 0) throw new SettlementError(409, '该付款申请已结清，无需重复付款');
    // PAY-CORE V3：三种互斥模式
    // 模式 C（人工抹零）：rounding_amount > 0，实际付款以用户填写为准，不反推
    // 模式 B（自动 floor）：apply_round_off=true 且无人工抹零，兼容历史
    // 模式 A（普通付款）：无抹零
    let actualPaidAmount, roundOffAmount = 0;
    if (hasUserRounding) {
      // ── 模式 C：人工抹零 ──
      roundOffAmount = userRoundingAmount;
      if (roundOffAmount > before.outstanding)
        throw new SettlementError(400, '抹零金额不能大于当前未付金额');
      const requestedAmount = (rawAmount === null || rawAmount === undefined || rawAmount === '')
        ? null : settlementMoney(rawAmount);
      actualPaidAmount = requestedAmount === null ? 0 : requestedAmount;
      if (actualPaidAmount < 0) actualPaidAmount = 0;
      // 累计结算 = 实际付款 + 抹零 + 抵扣，不能超过应付总额（非 outstanding，因 outstanding 已扣除抵扣）
      const totalSettlement = settlementMoney(actualPaidAmount + roundOffAmount + before.effectiveDeduction);
      if (totalSettlement > before.grossPayable)
        throw new SettlementError(400, '实际付款金额与抹零金额及抵扣金额之和不能大于应付总额');
    } else if (applyRoundOff) {
      // ── 模式 B：自动 floor（原有逻辑，不动） ──
      actualPaidAmount = Math.floor(before.outstanding);
      roundOffAmount = settlementMoney(before.outstanding - actualPaidAmount);
      if (roundOffAmount < 0) throw new SettlementError(400, '抹零金额不能小于0');
    } else {
      // ── 模式 A：普通付款（原有逻辑，不动） ──
      const requestedAmount = rawAmount === null || rawAmount === undefined || rawAmount === '' ? null : settlementMoney(rawAmount);
      if (requestedAmount !== null && !(requestedAmount > 0)) throw new SettlementError(400, '本次实际付款金额必须大于0');
      actualPaidAmount = requestedAmount === null ? before.outstanding : requestedAmount;
      if (!(actualPaidAmount > 0)) throw new SettlementError(400, '本次实际付款金额必须大于0');
      if (actualPaidAmount > before.outstanding) throw new SettlementError(400, '本次实际付款金额不能大于当前未付金额');
      // PAY-CORE V4：multi（多费用合并付款）允许部分付款，与 single 一致。
      // 仅保留“本次付款金额 <= 当前未付金额”守卫（上一行），不再强制全额/抹零一次结清。
      // 部分付款后由 derivePaymentStatus 置为 partial_paid / partial_payment_partial_deduction，
      // 剩余 outstanding 保留，可继续后续付款。
    }
    const operator = await settlementOperator(req);
    // PAY-CORE V3：纯抹零（actualPaidAmount=0）时跳过 payment log + transaction
    let logId = null, txId = null, transNo = null;
    let priRows = { rows: [] };
    if (actualPaidAmount > 0) {
      const snapshot = await buildPaymentRateSnapshot(payment, actualPaidAmount, paidDate);
      logId = await genId('settle');
      try {
        await run(`INSERT INTO payment_settlement_logs
             (id, payment_request_id, event_type, amount, status, reason, paid_date, payment_voucher,
              original_currency, settlement_country, local_currency, local_rate, local_rate_date, local_rate_type,
              local_rate_direction, local_amount, rmb_rate, rmb_rate_date, rmb_rate_type, rmb_rate_direction,
              rmb_amount, operator_id, operator_name, idempotency_key)
             VALUES (?, ?, 'payment', ?, 'applied', '付款确认', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [logId, payment.id, actualPaidAmount, paidDate, normalizedVoucher, payment.currency || '', snapshot.settlement_country,
            snapshot.local_currency, snapshot.local_rate, snapshot.local_rate_date, snapshot.local_rate_type,
            snapshot.local_rate_direction, snapshot.local_amount, snapshot.rmb_rate, snapshot.rmb_rate_date,
            snapshot.rmb_rate_type, snapshot.rmb_rate_direction, snapshot.rmb_amount, operator.id, operator.name, idempotencyKey]);
      } catch (e) {
        const raced = await queryOne(`SELECT * FROM payment_settlement_logs
                                WHERE event_type = 'payment' AND idempotency_key = ?`, [idempotencyKey]);
        if (raced) return await paymentIdempotencyResult(raced, payment, actualPaidAmount, paidDate, normalizedVoucher);
        throw e;
      }
      // PAY-CORE Phase 2 Step 5：事务内新增 transaction + allocation + payable_item lifecycle（V2.1 第 9 节）
      // 1. INSERT payment_transactions（关联 settlement_log_id）
      txId = genId('txn');
      transNo = `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const paidAmountMinor = amountToMinor(actualPaidAmount);
      await run(
        `INSERT INTO payment_transactions
         (id, trans_no, payment_request_id, paid_amount_minor, paid_date, payment_account, bank_ref_no,
          trans_status, operator_id, operator_name, voucher_attachment, settlement_log_id, currency,
          settlement_country, local_currency, local_rate, local_rate_date, local_rate_type, local_rate_direction,
          local_amount, rmb_rate, rmb_rate_date, rmb_rate_type, rmb_rate_direction, rmb_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'reconciled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [txId, transNo, payment.id, paidAmountMinor, paidDate, paymentAccount, bankRefNo,
         operator.id, operator.name, voucherAttachment, logId, payment.currency || '',
         snapshot.settlement_country, snapshot.local_currency, snapshot.local_rate, snapshot.local_rate_date,
         snapshot.local_rate_type, snapshot.local_rate_direction, snapshot.local_amount, snapshot.rmb_rate,
         snapshot.rmb_rate_date, snapshot.rmb_rate_type, snapshot.rmb_rate_direction, snapshot.rmb_amount]
      );
      // 2. INSERT payment_allocations（如有 payment_request_items）
      priRows = await query(
        `SELECT pri.id, pri.payable_item_id, pri.requested_amount_minor
         FROM payment_request_items pri
         WHERE pri.payment_request_id = ?`,
        [payment.id]
      );
      if (priRows.rows && priRows.rows.length > 0) {
        const items = priRows.rows;
        // 人工分摊优先：options.allocations = [{payment_request_item_id, amount}]（amount 单位：元）
        // 校验失败抛错 → 整个 transaction 回滚，不产生 settlement / allocation
        if (Array.isArray(options.allocations) && options.allocations.length > 0) {
          await insertHumanAllocations(items, options.allocations, txId, paidAmountMinor);
        } else {
          // 自动比例分摊：按 requested_amount_minor 比例，尾差归最大项（旧逻辑，单费用/旧流程保持不变）
          const totalRequestedMinor = items.reduce((s, r) => s + (r.requested_amount_minor || 0), 0);
          let allocated = 0;
          const sorted = items.slice().sort((a, b) => (b.requested_amount_minor || 0) - (a.requested_amount_minor || 0));
          for (let i = 0; i < sorted.length; i++) {
            const item = sorted[i];
            let allocMinor;
            if (i === 0) {
              // 最大项：paidAmountMinor - 其余项之和（吸收尾差）
              const othersSum = sorted.slice(1).reduce((s, r) => s + Math.floor(paidAmountMinor * (r.requested_amount_minor || 0) / totalRequestedMinor), 0);
              allocMinor = paidAmountMinor - othersSum;
            } else {
              allocMinor = Math.floor(paidAmountMinor * (item.requested_amount_minor || 0) / totalRequestedMinor);
            }
            if (allocMinor < 0) allocMinor = 0;
            allocated += allocMinor;
            await run(
              `INSERT INTO payment_allocations
               (id, transaction_id, payment_request_item_id, allocated_amount_minor, status)
               VALUES (?, ?, ?, ?, 'reconciled')`,
              [genId('alloc'), txId, item.id, allocMinor]
            );
          }
        }
      }
    } else {
      // 纯抹零场景：仍需读取 priRows 用于 payable_item lifecycle
      priRows = await query(
        `SELECT pri.id, pri.payable_item_id, pri.requested_amount_minor
         FROM payment_request_items pri
         WHERE pri.payment_request_id = ?`,
        [payment.id]
      );
    }
    // 3. Round-off：如有抹零差额，插入独立 rounding event（不关联 transaction）
    // PAY-CORE V3：支持人工抹零（模式 C）和自动 floor（模式 B），统一写入 rounding log
    if (roundOffAmount > 0) {
      const roundingReason = hasUserRounding
        ? (userRoundingReason || '人工抹零')
        : '付款抹零（小数部分舍去）';
      const roundingLogId = genId('settle');
      await run(
        `INSERT INTO payment_settlement_logs
         (id, payment_request_id, event_type, amount, status, reason, original_currency, operator_id, operator_name)
         VALUES (?, ?, 'rounding', ?, 'applied', ?, ?, ?, ?)`,
        [roundingLogId, payment.id, roundOffAmount, roundingReason, payment.currency || '', operator.id, operator.name]
      );
    }
    // 4. payable_item lifecycle：在 recalculatePaymentSettlement 后判断（V2.1 第 7 节）
    const result = await recalculatePaymentSettlement(payment.id);
    // 重新读取付款后状态，判断是否 outstanding=0 → paid
    const afterPayment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [payment.id]);
    const afterFacts = await paymentSettlementFacts(afterPayment);
    // PAY-CORE V3：纯抹零结清时 effectivePaid=0 但 effectiveRounding>0，也需标记 paid
    const payableItemIds = (priRows.rows || []).map(r => r.payable_item_id).filter(Boolean);
    if (afterFacts.outstanding <= 0 && (afterFacts.effectivePaid > 0 || afterFacts.effectiveRounding > 0)) {
      // PR 已结清 → 标记所有关联 payable_items 为 paid
      for (const payableItemId of payableItemIds) {
        markPayableItemPaid(payableItemId);
      }
    } else if (afterFacts.effectivePaid > 0 || afterFacts.effectiveRounding > 0) {
      // PAY-CORE 多次付款：本次付款动作已完成但仍有剩余未付。
      // 逐项按「应付 - 已结算」判定：结清 → paid；仍有剩余 → partially_paid（释放剩余金额，可再次发起申请）。
      if (payableItemIds.length > 0) {
        const settledMap = payableItemsSettledMinor(payableItemIds);
        const itemRows = await query(
          `SELECT id, payable_amount_minor FROM payable_items
           WHERE id IN (${payableItemIds.map(() => '?').join(',')})`,
          payableItemIds
        );
        for (const item of itemRows.rows || []) {
          const remainingMinor = Number(item.payable_amount_minor || 0) - (settledMap.get(item.id) || 0);
          if (remainingMinor <= 0) markPayableItemPaid(item.id);
          else markPayableItemPartiallyPaid(item.id);
        }
      }
    }
    return { idempotent: false, log_id: logId, transaction_id: txId, trans_no: transNo, rounding_amount: roundOffAmount, effectivePaid: actualPaidAmount, ...result };
  });
}

// PAY-CORE：合并付款「人工分摊」——确认付款时由前端逐项填写各费用单本次分摊金额
// allocations: [{ payment_request_item_id, amount }]，amount 单位：元
// 校验（任一失败抛 SettlementError，由调用方 transaction 回滚，不产生 settlement / allocation）：
//   ① 分摊合计 == 实际付款金额（minor 精度）
//   ② 单项分摊 <= 该费用剩余未付金额（payable_item 当前剩余未付 = 应付 − 已结算）
//   ③ 不允许负数
//   ④ 不遗漏本 PR 的任一 payment_request_item（且只能包含本 PR 的 item）
async function insertHumanAllocations(items, allocations, txId, paidAmountMinor) {
  const itemMap = new Map(items.map(r => [r.id, r]));
  // ①/④前置：传入的 payment_request_item_id 必须全部属于本 PR
  const settledMap = payableItemsSettledMinor(items.map(r => r.payable_item_id));
  const pRows = await query(
    `SELECT id, fee_no, payable_amount_minor FROM payable_items WHERE id IN (${items.map(() => '?').join(',')})`,
    items.map(r => r.payable_item_id)
  );
  const pMap = new Map((pRows.rows || []).map(r => [r.id, r]));
  const validated = [];
  let sumMinor = 0;
  for (const a of allocations) {
    const item = itemMap.get(a.payment_request_item_id);
    if (!item) throw new SettlementError(400, `分摊包含非本付款申请的费用项：${a.payment_request_item_id || ''}`);
    const amt = Number(a.amount);
    if (Number.isNaN(amt) || !(amt >= 0)) throw new SettlementError(400, '分摊金额不能为负数');
    const allocMinor = amountToMinor(amt);
    const pItem = pMap.get(item.payable_item_id);
    if (!pItem) throw new SettlementError(500, `费用项 ${item.payable_item_id} 关联的应付费用不存在`);
    const remainingMinor = Number(pItem.payable_amount_minor || 0) - (settledMap.get(item.payable_item_id) || 0);
    if (allocMinor > remainingMinor) {
      throw new SettlementError(400, `费用 ${pItem.fee_no || item.payable_item_id} 分摊金额 ${minorToAmount(allocMinor)} 超过剩余未付 ${minorToAmount(remainingMinor)}`);
    }
    validated.push({ itemId: item.id, allocMinor });
    sumMinor += allocMinor;
  }
  // ④ 不遗漏：本 PR 每个 payment_request_item 都必须出现在 allocations 中
  for (const r of items) {
    if (!allocations.some(a => a.payment_request_item_id === r.id)) {
      throw new SettlementError(400, `分摊遗漏了关联费用项：${r.fee_no || r.payable_item_id || r.id}`);
    }
  }
  // ① 总额校验（minor 精度）
  if (sumMinor !== paidAmountMinor) {
    throw new SettlementError(400, `分摊合计 ${minorToAmount(sumMinor)} 不等于实际付款金额 ${minorToAmount(paidAmountMinor)}`);
  }
  // 全部校验通过 → 写 payment_allocations（复用现有表结构，allocated_amount_minor 单位：分）
  for (const v of validated) {
    await run(
      `INSERT INTO payment_allocations
       (id, transaction_id, payment_request_item_id, allocated_amount_minor, status)
       VALUES (?, ?, ?, ?, 'reconciled')`,
      [genId('alloc'), txId, v.itemId, v.allocMinor]
    );
  }
}

async function applyDeductionSettlement(paymentRequestId, body, req) {
  return await transaction(async () => {
    const payment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [paymentRequestId]);
    if (!payment) throw new SettlementError(404, '付款申请不存在');
    await ensureSettlementLegacyBaselines(payment);
    const before = await paymentSettlementFacts(payment);
    if (before.effectivePaid > 0) throw new SettlementError(409, '该付款申请已产生有效付款，不能通过普通编辑修改抵扣；如需调整请先冲销付款');
    if (before.effectiveDeduction > 0) throw new SettlementError(409, '该付款申请已有生效抵扣，不能直接覆盖；请先冲销原抵扣');
    if (before.outstanding <= 0) throw new SettlementError(409, '该付款申请已结清，不能编辑抵扣');
    const hasDeduction = Number(body.has_deduction) === 1;
    const amount = hasDeduction ? settlementMoney(body.deduction_amount) : 0;
    if (!hasDeduction || amount === 0) {
      await run(`UPDATE payment_requests SET has_deduction = 0, deduction_amount = 0,
           deduction_source_type = '', deduction_source_desc = '', deduction_ref_no = '',
           deduction_attachment = '', updated_at = datetime('now') WHERE id = ?`, [payment.id]);
      return await recalculatePaymentSettlement(payment.id);
    }
    if (!(amount > 0)) throw new SettlementError(400, '抵扣金额必须大于0');
    if (amount > before.outstanding) throw new SettlementError(400, '抵扣金额不能大于当前未付金额');
    const sourceType = String(body.deduction_source_type || '').trim();
    const description = String(body.deduction_source_desc || '').trim();
    if (!sourceType || !description) throw new SettlementError(400, '抵扣金额大于0时必须填写抵扣来源类型和说明');
    const operator = await settlementOperator(req);
    await run(`INSERT INTO payment_settlement_logs
         (id, payment_request_id, event_type, amount, status, reason, original_currency, operator_id, operator_name)
         VALUES (?, ?, 'deduction', ?, 'applied', ?, ?, ?, ?)`,
      [await genId('settle'), payment.id, amount, description, payment.currency || '', operator.id, operator.name]);
    await run(`UPDATE payment_requests SET deduction_source_type = ?, deduction_source_desc = ?,
         deduction_ref_no = ?, deduction_attachment = ?, updated_at = datetime('now') WHERE id = ?`,
      [sourceType, description, String(body.deduction_ref_no || ''), String(body.deduction_attachment || ''), payment.id]);
    return await recalculatePaymentSettlement(payment.id);
  });
}

async function applyRoundingSettlement(paymentRequestId, rawAmount, reason, req) {
  return await transaction(async () => {
    const payment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [paymentRequestId]);
    if (!payment) throw new SettlementError(404, '付款申请不存在');
    if (payment.approval_status !== 'approved') throw new SettlementError(409, '付款申请尚未审批通过，不能执行抹零');
    await ensureSettlementLegacyBaselines(payment);
    const before = await paymentSettlementFacts(payment);
    if (before.activeRoundings.length) throw new SettlementError(409, '该付款申请已有生效抹零，不能直接覆盖；请先撤销原抹零');
    if (before.outstanding <= 0) throw new SettlementError(409, '该付款申请已结清，无需抹零');
    const amount = settlementMoney(rawAmount);
    if (!Number.isFinite(amount) || amount < 0) throw new SettlementError(400, '抹零金额不能小于0');
    if (!(amount > 0)) throw new SettlementError(400, '抹零金额必须大于0');
    if (amount > before.outstanding) throw new SettlementError(400, '抹零金额不能超过当前剩余未结金额');
    const roundingReason = String(reason || '').trim();
    if (!roundingReason) throw new SettlementError(400, '抹零原因或备注不能为空');
    const operator = await settlementOperator(req);
    const logId = await genId('settle');
    await run(`INSERT INTO payment_settlement_logs
         (id, payment_request_id, event_type, amount, status, reason, original_currency, operator_id, operator_name)
         VALUES (?, ?, 'rounding', ?, 'applied', ?, ?, ?, ?)`,
      [logId, payment.id, amount, roundingReason, payment.currency || '', operator.id, operator.name]);
    await run(`UPDATE payment_requests SET rounding_reason = ?, updated_at = datetime('now') WHERE id = ?`, [roundingReason, payment.id]);
    return { log_id: logId, ...await recalculatePaymentSettlement(payment.id) };
  });
}

async function reverseSettlementEvent(paymentRequestId, rawLogId, eventType, reason, req) {
  return await transaction(async () => {
    const payment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [paymentRequestId]);
    if (!payment) throw new SettlementError(404, '付款申请不存在');
    const reversalReason = String(reason || '').trim();
    if (!reversalReason) throw new SettlementError(400, '冲销原因不能为空');
    await ensureSettlementLegacyBaselines(payment);
    let logId = String(rawLogId || '').trim();
    if (logId === 'legacy-payment' || logId === 'legacy-deduction' || logId === 'legacy-rounding') {
      const legacyType = logId === 'legacy-payment' ? 'payment' : (logId === 'legacy-deduction' ? 'deduction' : 'rounding');
      const legacy = await queryOne(`SELECT id FROM payment_settlement_logs
                               WHERE payment_request_id = ? AND event_type = ? AND is_legacy = 1`, [payment.id, legacyType]);
      logId = legacy ? legacy.id : '';
    }
    if (!logId) throw new SettlementError(400, '必须指定要冲销的结算事件');
    const log = await queryOne('SELECT * FROM payment_settlement_logs WHERE id = ? AND payment_request_id = ?', [logId, payment.id]);
    if (!log) throw new SettlementError(404, '结算事件不存在');
    if (log.event_type !== eventType) throw new SettlementError(409, eventType === 'payment' ? '该事件不是付款记录，不能作为付款冲销' : '该事件不是抵扣记录，不能作为抵扣冲销');
    if (log.status !== 'applied') throw new SettlementError(409, '该结算事件已经冲销，不能重复操作');
    // PAY-CORE Phase 2 V2.1 第 11 节：reversal 安全门禁
    // 1. payment event：若已关联 payment_transactions，禁止 reverse（避免 transaction 悬空）
    if (eventType === 'payment') {
      const tx = await queryOne('SELECT id, trans_no FROM payment_transactions WHERE settlement_log_id = ?', [log.id]);
      if (tx) {
        throw new SettlementError(409, `该付款事件已关联银行流水 ${tx.trans_no || tx.id}，不能直接冲销。请先冲销对应交易记录。`);
      }
    }
    // 2. rounding event：若 PR 已有 payable_items 处于 paid 状态，禁止 reverse（避免状态分裂）
    //    现有 markPayableItemPaid 不会自动回退，reverse rounding 会导致 PR 未结清但 payable_item 仍为 paid
    if (eventType === 'rounding') {
      const paidItems = await query(
        `SELECT pri.payable_item_id, pi.fee_no, pi.lifecycle_status
         FROM payment_request_items pri
         JOIN payable_items pi ON pi.id = pri.payable_item_id
         WHERE pri.payment_request_id = ? AND pi.lifecycle_status = 'paid'`,
        [payment.id]
      );
      if (paidItems.rows && paidItems.rows.length > 0) {
        const feeNos = paidItems.rows.map(r => r.fee_no || r.payable_item_id).join(', ');
        throw new SettlementError(409, `该抹零事件已影响应付费用状态（${feeNos}），不能直接冲销。冲销抹零会导致付款申请未结清但应付费用仍为已付款，请通过完整冲销流程处理。`);
      }
    }
    const operator = await settlementOperator(req);
    await run(`UPDATE payment_settlement_logs
         SET status = 'reversed', reversed_at = datetime('now'), reversed_by = ?, reversal_reason = ?
         WHERE id = ?`, [operator.name || operator.id, reversalReason, log.id]);
    if (eventType === 'rounding') {
      await run(`INSERT INTO payment_settlement_logs
           (id, payment_request_id, event_type, amount, status, reason, original_currency,
            operator_id, operator_name, reversal_of)
           VALUES (?, ?, 'rounding_reversal', ?, 'applied', ?, ?, ?, ?, ?)`,
        [await genId('settle'), payment.id, log.amount, reversalReason, payment.currency || '', operator.id, operator.name, log.id]);
    }
    return { reversed_log_id: log.id, ...await recalculatePaymentSettlement(payment.id) };
  });
}

async function paymentSettlementDisplayLogs(payment) {
  const logs = await paymentSettlementLogs(payment.id);
  if (!logs.some(log => log.event_type === 'payment') && Number(payment.paid_amount || 0) > 0) {
    logs.push({ id: 'legacy-payment', payment_request_id: payment.id, event_type: 'payment', amount: payment.paid_amount, status: 'applied', reason: '历史付款基线（迁移前数据）', paid_date: payment.paid_date || '', operator_name: 'system', is_legacy: 1, created_at: payment.updated_at || payment.created_at });
  }
  if (!logs.some(log => log.event_type === 'deduction') && Number(payment.deduction_amount || 0) > 0) {
    logs.push({ id: 'legacy-deduction', payment_request_id: payment.id, event_type: 'deduction', amount: payment.deduction_amount, status: 'applied', reason: payment.deduction_source_desc || '历史抵扣基线（迁移前数据）', operator_name: 'system', is_legacy: 1, created_at: payment.updated_at || payment.created_at });
  }
  if (!logs.some(log => log.event_type === 'rounding') && Number(payment.rounding_amount || 0) > 0) {
    logs.push({ id: 'legacy-rounding', payment_request_id: payment.id, event_type: 'rounding', amount: payment.rounding_amount, status: 'applied', reason: payment.rounding_reason || '历史抹零基线', operator_name: 'system', is_legacy: 1, created_at: payment.updated_at || payment.created_at });
  }
  return logs.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
}

function historicalCIField(body, ...keys) {
  for (const key of keys) {
    if (body && body[key] !== undefined && body[key] !== null) return body[key];
  }
  return '';
}

function historicalCIDate(value, label, required) {
  const date = String(value || '').trim().slice(0, 10);
  if (!date && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new SettlementError(400, `${label}必须为 YYYY-MM-DD`);
  const parsed = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new SettlementError(400, `${label}无效`);
  }
  return date;
}

// PAY-CREDIT-DUE-01：日期加 n 天（基于 YYYY-MM-DD，无时区，返回 YYYY-MM-DD）
function addDays(dateStr, n) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + Number(n));
  return d.toISOString().slice(0, 10);
}

// PAY-CREDIT-DUE-01：运营 CI 从 PI 已选付款条款快照 Credit 天数（仅 term_type='credit'）；历史 CI 不调用此函数（避免用供应商当前默认配置回推）
function resolveOperationalCiCreditSnapshot(relatedPiId) {
  let paymentTermId = '';
  let creditDays = 0;
  if (relatedPiId) {
    const pi = queryOne('SELECT payment_term_id FROM proforma_invoices WHERE id = ?', [relatedPiId]);
    if (pi && pi.payment_term_id) {
      const term = queryOne("SELECT id, credit_days FROM supplier_payment_terms WHERE id = ? AND term_type = 'credit'", [pi.payment_term_id]);
      if (term) {
        paymentTermId = term.id;
        creditDays = Number(term.credit_days) || 0;
      }
    }
  }
  return { paymentTermId, creditDays };
}

// PAY-CREDIT-DUE-01：应付日期 = 实际出货日期 + Credit 天数；仅 goods+Credit（credit_days>0 且 actual_ship_date 合法），否则留空（待补充）
function computePayableDate(actualShipDate, creditDays) {
  if (!actualShipDate || !/^\d{4}-\d{2}-\d{2}$/.test(actualShipDate)) return '';
  if (!creditDays || Number(creditDays) <= 0) return '';
  return addDays(actualShipDate, Number(creditDays));
}

// 应付日期统一解析（FIN-DASHBOARD 修复）：
// 优先级 1：已录入的 due_date（业务事实，历史CI尤其如此，绝不被 credit_days=0 覆盖）
// 优先级 2：invoice_date(=出货日) + credit_days 推算
// 两者皆无：返回空（进入数据异常提醒），绝不臆造
// 说明：推算基准沿用既有 computePayableDate 的 actual_ship_date（本项目 Credit 账期从出货日起算），未改变任何既有计算口径
function resolvePayableDate({ dueDate, creditDays, baseDate }) {
  const due = String(dueDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  if (Number(creditDays) > 0 && baseDate && /^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
    return addDays(baseDate, Number(creditDays));
  }
  return '';
}

function normalizeHistoricalCI(body) {
  const historicalCiNo = String(historicalCIField(body, 'historical_ci_no', '历史CI编号', 'CI编号') || '').trim();
  if (!historicalCiNo) throw new SettlementError(400, '历史 CI 编号不能为空');
  const sourceMode = String(historicalCIField(body, 'source_mode', '来源模式') || 'historical').trim();
  if (sourceMode !== 'historical') throw new SettlementError(400, '历史 CI 的 source_mode 必须为 historical');

  const supplierId = String(historicalCIField(body, 'supplier_id', '供应商ID') || '').trim();
  const suppliedName = String(historicalCIField(body, 'supplier_name', 'supplier', '供应商') || '').trim();
  let supplierName = suppliedName;
  if (supplierId) {
    const supplier = queryOne('SELECT id, name FROM suppliers WHERE id = ?', [supplierId]);
    if (!supplier) throw new SettlementError(400, `供应商 ${supplierId} 不存在`);
    supplierName = supplier.name;
  }
  if (!supplierName) throw new SettlementError(400, '供应商或供应商快照不能为空');

  const brandId = String(historicalCIField(body, 'brand_id', '品牌ID') || '').trim();
  const brandName = String(historicalCIField(body, 'brand_name', 'brand', '品牌') || '').trim();
  if (!brandId && !brandName) throw new SettlementError(400, '品牌或品牌快照不能为空');

  const country = String(historicalCIField(body, 'country', '国家') || '').trim();
  if (!country) throw new SettlementError(400, '采购归属国家不能为空');
  const ciDate = historicalCIDate(historicalCIField(body, 'ci_date', 'CI日期'), '历史 CI 日期', true);
  const historicalPaidDate = historicalCIDate(historicalCIField(body, 'historical_paid_date', '历史付款日期'), '历史已付款日期', false);
  const dueDate = historicalCIDate(historicalCIField(body, 'due_date', '到期日'), '到期日', false);
  // CI-SHIP-DATE-01：实际出货日期必填（历史 CI 与运营 CI 同名字段，不允许默认填充今天）
  const actualShipDate = historicalCIDate(historicalCIField(body, 'actual_ship_date', '实际出货日期'), '实际出货日期', true);
  // PAY-CREDIT-DUE-01：历史 CI 仅接受导入时**明确提供**的 Credit 天数；不自动用供应商当前默认配置回推历史应付日期
  const explicitPaymentTermId = String(historicalCIField(body, 'payment_term_id', '付款条款ID') || '').trim();
  const rawCreditDays = historicalCIField(body, 'credit_days', 'Credit天数', '信用天数');
  const creditDays = (rawCreditDays !== '' && rawCreditDays !== null && rawCreditDays !== undefined && Number(rawCreditDays) > 0) ? Number(rawCreditDays) : 0;

  const currency = String(historicalCIField(body, 'currency', '币种') || '').trim().toUpperCase();
  const currencyRow = currency ? queryOne("SELECT code FROM currencies WHERE code = ? AND status = 'active'", [currency]) : null;
  if (!currencyRow) throw new SettlementError(400, `币种 ${currency || '（空）'} 不存在或已停用`);

  const grossGoodsAmount = settlementMoney(historicalCIField(body, 'gross_goods_amount', '历史货款总金额', '总货款'));
  const historicalPaidAmount = settlementMoney(historicalCIField(body, 'historical_paid_amount', '历史已付款', '已付款') || 0);
  if (!(grossGoodsAmount > 0)) throw new SettlementError(400, '历史货款总金额必须大于0');
  if (!Number.isFinite(historicalPaidAmount) || historicalPaidAmount < 0) throw new SettlementError(400, '历史已付款金额不能小于0');
  if (historicalPaidAmount > grossGoodsAmount) throw new SettlementError(400, '历史已付款金额不能超过历史货款总金额');

  const normalized = {
    historical_ci_no: historicalCiNo,
    supplier_id: supplierId,
    supplier_name: supplierName,
    supplier_identity: supplierName.trim().toLowerCase(),
    brand_id: brandId,
    brand_name: brandName || brandId,
    country,
    ci_date: ciDate,
    actual_ship_date: actualShipDate,
    currency,
    gross_goods_amount: grossGoodsAmount,
    historical_paid_amount: historicalPaidAmount,
    historical_paid_date: historicalPaidDate,
    payment_terms: String(historicalCIField(body, 'payment_terms', '付款条件') || '').trim(),
    due_date: dueDate || '',
    payment_term_id: explicitPaymentTermId,
    credit_days: creditDays,
    source_note: String(historicalCIField(body, 'source_note', '原始凭证或备注', '备注') || '').trim(),
    source_mode: 'historical'
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  const suppliedKey = String(historicalCIField(body, 'idempotency_key', '幂等键') || '').trim();
  const idempotencyKey = suppliedKey || `historical-ci:${fingerprint}`;
  if (idempotencyKey.length > 200) throw new SettlementError(400, '历史 CI 幂等键长度不能超过200个字符');
  return { ...normalized, idempotency_key: idempotencyKey, payload_hash: fingerprint };
}

function historicalCIIdempotencyResult(existing, normalized) {
  if (existing.payload_hash !== normalized.payload_hash) {
    throw new SettlementError(409, '该历史 CI 幂等键已用于不同的单据内容，不能重复使用');
  }
  return {
    idempotent: true,
    id: existing.id,
    historical_ci_no: existing.historical_ci_no,
    payment_request_id: existing.payment_request_id
  };
}

async function createHistoricalCI(body, req) {
  const normalized = await normalizeHistoricalCI(body);
  const idempotent = await queryOne('SELECT * FROM historical_commercial_invoices WHERE idempotency_key = ?', [normalized.idempotency_key]);
  if (idempotent) return historicalCIIdempotencyResult(idempotent, normalized);
  const duplicate = await queryOne(`SELECT id, historical_ci_no FROM historical_commercial_invoices
                              WHERE historical_ci_no = ? COLLATE NOCASE AND supplier_identity = ? AND country = ? COLLATE NOCASE`,
    [normalized.historical_ci_no, normalized.supplier_identity, normalized.country]);
  if (duplicate) throw new SettlementError(409, `历史 CI“${normalized.historical_ci_no}”在该供应商和国家下已存在，不能重复导入`);

  return await transaction(async () => {
    const racedKey = await queryOne('SELECT * FROM historical_commercial_invoices WHERE idempotency_key = ?', [normalized.idempotency_key]);
    if (racedKey) return historicalCIIdempotencyResult(racedKey, normalized);
    const racedIdentity = await queryOne(`SELECT id FROM historical_commercial_invoices
                                    WHERE historical_ci_no = ? COLLATE NOCASE AND supplier_identity = ? AND country = ? COLLATE NOCASE`,
      [normalized.historical_ci_no, normalized.supplier_identity, normalized.country]);
    if (racedIdentity) throw new SettlementError(409, `历史 CI“${normalized.historical_ci_no}”在该供应商和国家下已存在，不能重复导入`);

    const operator = await settlementOperator(req);
    const historicalId = await genId('hci');
    const paymentRequestId = await genId('pay');
    const paymentRequestNo = `PAY-HCI-${String(paymentRequestId).replace(/^pay_/, '').toUpperCase()}`;
    // PAY-CREDIT-DUE-01（修复）：优先使用录入的 due_date（历史CI已录业务事实），否则按出货日+Credit天数推算
    const historicalPayableDate = resolvePayableDate({ dueDate: normalized.due_date, creditDays: normalized.credit_days, baseDate: normalized.actual_ship_date });
    // HCI-DEPOSIT-DEDUCT: 历史CI尾款 = CI货值 − 关联PI当前可抵扣定金余额(available_deduct_deposit)
    // 复用正常CI同款口径：只读 PI.available_deduct_deposit（已含其他CI消费后的剩余），不回写PI定金列，不拆 per-PI。
    const hciLinkedPiIds = [...new Set([
      ...(Array.isArray(body.related_pi_ids) ? body.related_pi_ids : []),
      ...(Array.isArray(body.items) ? body.items : []).map(i => i && i.pi_id).filter(Boolean)
    ])];
    let hciDepositDeductMinor = 0;
    for (const piId of hciLinkedPiIds) {
      const pi = await queryOne('SELECT id, pi_no, available_deduct_deposit FROM proforma_invoices WHERE id = ?', [piId]);
      if (!pi) continue;
      hciDepositDeductMinor += Math.round((pi.available_deduct_deposit || 0) * 100);
    }
    const hciGrossMinor = Math.round(normalized.gross_goods_amount * 100);
    const hciBalanceMinor = Math.max(0, hciGrossMinor - hciDepositDeductMinor);
    const hciBalanceAmount = hciBalanceMinor / 100;
    await run(`INSERT INTO historical_commercial_invoices
         (id, historical_ci_no, supplier_id, supplier_name, supplier_identity, brand_id, brand_name,
          country, ci_date, actual_ship_date, payment_term_id, credit_days, currency, gross_goods_amount, historical_paid_amount, historical_paid_date,
          payment_terms, due_date, source_note, source_mode, idempotency_key, payload_hash,
          created_by, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'historical', ?, ?, ?, ?)`,
      [historicalId, normalized.historical_ci_no, normalized.supplier_id, normalized.supplier_name,
        normalized.supplier_identity, normalized.brand_id, normalized.brand_name, normalized.country,
        normalized.ci_date, normalized.actual_ship_date, normalized.payment_term_id, normalized.credit_days, normalized.currency, normalized.gross_goods_amount, normalized.historical_paid_amount,
        normalized.historical_paid_date, normalized.payment_terms, normalized.due_date, normalized.source_note,
        normalized.idempotency_key, normalized.payload_hash, operator.id, operator.name]);

    // PAY-CORE Phase 1.5 Task 2：派生 payee_key/payee_name_snapshot（格式 ${payee_type}:${identity}，与 payable_items 一致）
    const historicalPayeeKey = `supplier:${normalized.supplier_id || normalized.supplier_name}`;
    const historicalPayeeNameSnapshot = normalized.supplier_name || '';
    await run(`INSERT INTO payment_requests
         (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no,
          payee_type, payee_key, payee_name_snapshot, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_terms,
          payable_date, approval_status, approver_name, approved_at, remark, expense_country)
         VALUES (?, ?, 'goods', 'balance', 'historical_ci', ?, ?, 'factory', ?, ?, ?, ?, 0, ?, ?, ?, ?,
                 'approved', ?, datetime('now'), ?, ?)`,
      [paymentRequestId, paymentRequestNo, historicalId, normalized.historical_ci_no,
        historicalPayeeKey, historicalPayeeNameSnapshot, normalized.supplier_name,
        hciBalanceAmount, hciBalanceAmount, normalized.currency, normalized.payment_terms,
        historicalPayableDate, operator.name, normalized.source_note, normalized.country]);

    // PAY-CORE CI→付款事实闭环：Historical CI 补 payable_items（active + 关联 + reserve，与标准 PR 创建口径对齐）
    // 复用 createPayableItemFromSource；不改变历史付款事实（is_legacy settlement_logs 不动）
    const hciPayableItem = createPayableItemFromSource({
      sourceType: 'historical_ci', sourceId: historicalId, sourceNo: normalized.historical_ci_no,
      feeType: 'balance', categoryCode: 'goods', subcategoryCode: 'balance',
      payeeType: 'factory', payeeKey: historicalPayeeKey, payeeName: historicalPayeeNameSnapshot,
      currency: normalized.currency, payableAmount: hciBalanceAmount,
      payableDate: historicalPayableDate,
      createdBy: operator.id
    });
    if (hciPayableItem && hciPayableItem.id && hciPayableItem.lifecycle_status === 'active') {
      await run(
        `INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor) VALUES (?, ?, ?, ?)`,
        [await genId('pri'), paymentRequestId, hciPayableItem.id, hciPayableItem.payable_amount_minor || hciBalanceMinor]
      );
      reservePayableItem(hciPayableItem.id, paymentRequestId);
    }

    await run('UPDATE historical_commercial_invoices SET payment_request_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [paymentRequestId, historicalId]);

    if (normalized.historical_paid_amount > 0) {
      await run(`INSERT INTO payment_settlement_logs
           (id, payment_request_id, event_type, amount, status, reason, paid_date, original_currency,
            operator_id, operator_name, idempotency_key, is_legacy)
           VALUES (?, ?, 'payment', ?, 'applied', ?, ?, ?, ?, ?, ?, 1)`,
        [await genId('settle'), paymentRequestId, normalized.historical_paid_amount,
          normalized.source_note || `历史 CI ${normalized.historical_ci_no} 已付款导入`,
          normalized.historical_paid_date, normalized.currency, operator.id,
          operator.name || 'historical_import', `historical-ci-payment:${normalized.idempotency_key}`]);
    }

    // Historical CI with PI linkage: update PI shipped/unshipped quantities and ship status
    const hciItems = Array.isArray(body.items) ? body.items : [];
    // HCI-PI-LINK-01: 关联 PI 但无 CI 明细时禁止静默创建（避免 PI shipped_qty 不回写）
    const linkedPiIds = Array.isArray(body.related_pi_ids) ? body.related_pi_ids : [];
    if (linkedPiIds.length > 0 && hciItems.length === 0) {
      throw new SettlementError(400, '关联 PI 的历史 CI 必须填写 CI 明细，否则无法同步 PI 发货状态');
    }
    if (hciItems.length > 0) {
      const piIds = [...new Set(hciItems.map(i => i.pi_id))];
      for (const piId of piIds) {
        const pi = await queryOne('SELECT id, pi_no, total_amount, shipped_amount FROM proforma_invoices WHERE id = ?', [piId]);
        if (!pi) continue;
        let piGoodsAmount = 0;
        const piItemUpdates = hciItems.filter(i => i.pi_id === piId);
        for (const item of piItemUpdates) {
          const qty = item.shipped_qty || 0;
          if (qty <= 0) continue;
          await run(
            'UPDATE proforma_invoice_items SET shipped_qty = shipped_qty + ?, unshipped_qty = unshipped_qty - ? WHERE pi_id = ? AND sku_code = ?',
            [qty, qty, piId, item.sku_code]
          );
          const priceRow = await queryOne('SELECT unit_price, discount FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [piId, item.sku_code]);
          if (priceRow) {
            const disc = priceRow.discount || 0;
            const netUnitPrice = priceRow.unit_price * (1 - disc);
            piGoodsAmount += qty * netUnitPrice;
          }
        }
        // Update PI shipped/unshipped amounts
        if (piGoodsAmount > 0) {
          const newShippedAmount = (pi.shipped_amount || 0) + piGoodsAmount;
          const newUnshippedAmount = Math.max(0, (pi.total_amount || 0) - newShippedAmount);
          await run('UPDATE proforma_invoices SET shipped_amount = ?, unshipped_amount = ? WHERE id = ?',
            [newShippedAmount, newUnshippedAmount, piId]);
        }
        // Update PI ship status
        const piItems = query('SELECT pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ?', [piId]).rows;
        const allShipped = piItems.length > 0 && piItems.every(i => i.shipped_qty >= i.pi_confirmed_qty);
        const anyShipped = piItems.some(i => i.shipped_qty > 0);
        if (allShipped) {
          await run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['shipped_complete', piId]);
        } else if (anyShipped) {
          await run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['partial_shipped', piId]);
        }
      }
      // HCI-PI-LINK-01: PI 发货数量更新后刷新库存预测数据（在途/已确认未发货/PO未确认PI）
      await updateInventoryTransitData();
    }

    // 保存 SKU 级成交价格快照（后端计算，不信任前端传值）
    if (hciItems.length > 0) {
      for (const item of hciItems) {
        const qty = item.shipped_qty || 0;
        if (qty <= 0) continue;
        const priceRow = await queryOne('SELECT unit_price, discount FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [item.pi_id, item.sku_code]);
        if (!priceRow) continue;
        const up = priceRow.unit_price || 0;
        const disc = priceRow.discount || 0;
        const netUp = up * (1 - disc);
        const ciAmt = qty * netUp;
        const piRow = await queryOne('SELECT pi_no FROM proforma_invoices WHERE id = ?', [item.pi_id]);
        await run(
          `INSERT INTO historical_commercial_invoice_items
           (id, hci_id, hci_no, pi_id, pi_no, sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [await genId('hcii'), historicalId, normalized.historical_ci_no,
           item.pi_id || '', piRow ? piRow.pi_no : '', item.sku_code,
           qty, up, disc, netUp, ciAmt]
        );
      }
    }

    const settlement = await recalculatePaymentSettlement(paymentRequestId);
    return {
      idempotent: false,
      id: historicalId,
      historical_ci_no: normalized.historical_ci_no,
      payment_request_id: paymentRequestId,
      outstanding: settlement.outstanding,
      payment_status: settlement.payment_status
    };
  });
}

function historicalCISelectSql() {
  return `SELECT h.*, pr.request_no, pr.payable_amount, pr.paid_amount, pr.deduction_amount,
                 pr.rounding_amount, pr.unpaid_amount, pr.payment_status, pr.approval_status,
                 COALESCE((SELECT SUM(l.amount) FROM payment_settlement_logs l
                           WHERE l.payment_request_id = h.payment_request_id AND l.event_type = 'payment'
                             AND l.is_legacy = 1 AND l.status = 'applied'), 0) AS historical_paid_effective,
                 COALESCE((SELECT SUM(l.amount) FROM payment_settlement_logs l
                           WHERE l.payment_request_id = h.payment_request_id AND l.event_type = 'payment'
                             AND l.is_legacy = 0 AND l.status = 'applied'), 0) AS subsequent_paid_amount
          FROM historical_commercial_invoices h
          JOIN payment_requests pr ON pr.id = h.payment_request_id`;
}

app.get('/api/historical-commercial-invoices', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  try {
    let sql = historicalCISelectSql() + ' WHERE 1=1';
    const params = [];
    if (req.query.status) { sql += ' AND pr.payment_status = ?'; params.push(req.query.status); }
    if (req.query.keyword) {
      sql += ' AND (h.historical_ci_no LIKE ? OR h.supplier_name LIKE ? OR h.brand_name LIKE ?)';
      const pattern = `%${req.query.keyword}%`;
      params.push(pattern, pattern, pattern);
    }
    if (req.query.country) { const al = countryAliases(req.query.country); sql += ' AND h.country IN (' + al.map(() => '?').join(',') + ')'; al.forEach(a => params.push(a)); }
    if (req.query.brand) { sql += ' AND h.brand_name = ?'; params.push(req.query.brand); }
    sql += ' ORDER BY h.ci_date DESC, h.created_at DESC';
    res.json(query(sql, params).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== CI 筛选：国家字段兼容（仅查询/筛选层，不改动库与业务） ====================
// 已知不一致：commercial_invoices.country 存中文名（如“印度尼西亚”），historical_commercial_invoices.country 存代码（如“ID”）。
// 以下映射让两者在筛选/查询时视为同一国家；不修改任何历史数据、不触碰 CI/付款业务逻辑。
const COUNTRY_CANON = {
  'ID': 'ID', 'Indonesia': 'ID', '印度尼西亚': 'ID', '印尼': 'ID', 'IND': 'ID',
  'CN': 'CN', 'China': 'CN', '中国': 'CN', 'CHN': 'CN',
  'MY': 'MY', 'Malaysia': 'MY', '马来西亚': 'MY', 'MYS': 'MY',
  'TH': 'TH', 'Thailand': 'TH', '泰国': 'TH', 'THA': 'TH',
  'VN': 'VN', 'Vietnam': 'VN', '越南': 'VN', 'VNM': 'VN',
  'PH': 'PH', 'Philippines': 'PH', '菲律宾': 'PH', 'PHL': 'PH',
  'SG': 'SG', 'Singapore': 'SG', '新加坡': 'SG', 'SGP': 'SG'
};
const COUNTRY_DISPLAY = { 'ID': '印度尼西亚', 'CN': 'China', 'MY': '马来西亚', 'TH': '泰国', 'VN': '越南', 'PH': '菲律宾', 'SG': '新加坡' };
function canonCountry(v) { return COUNTRY_CANON[v] || v; }
function displayCountry(c) { return COUNTRY_DISPLAY[c] || c; }
function countryAliases(sel) {
  const c = canonCountry(sel);
  const set = new Set(Object.keys(COUNTRY_CANON).filter(k => COUNTRY_CANON[k] === c));
  set.add(c);
  return Array.from(set);
}

// CI-FILTER-OPTIONS：CI/PL 管理页联动筛选选项。
// 仅基于当前 CI 数据实际存在值生成（不读全量主数据），不修改任何 CI 业务/状态/付款逻辑。
// 枚举某维度时，应用「另外两个维度 + 单据类型」过滤、排除自身维度，实现联动。
app.get('/api/ci-filter-options', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  const mode = req.query.mode || 'all';
  const country = req.query.country || '';
  const warehouse = req.query.warehouse || '';
  const brand = req.query.brand || '';
  const distinctOp = (dim) => {
    let sql = `SELECT DISTINCT ${dim} FROM commercial_invoices WHERE 1=1`;
    const p = [];
    if (country && dim !== 'country') { const al = countryAliases(country); sql += ' AND country IN (' + al.map(() => '?').join(',') + ')'; al.forEach(a => p.push(a)); }
    if (warehouse && dim !== 'target_warehouse') { sql += ' AND target_warehouse = ?'; p.push(warehouse); }
    if (brand && dim !== 'brand') { sql += ' AND brand = ?'; p.push(brand); }
    return query(sql, p).rows.map(r => r[dim]).filter(v => v != null && String(v) !== '');
  };
  const distinctHist = (dim) => {
    let sql = `SELECT DISTINCT ${dim} FROM historical_commercial_invoices WHERE 1=1`;
    const p = [];
    if (country && dim !== 'country') { const al = countryAliases(country); sql += ' AND country IN (' + al.map(() => '?').join(',') + ')'; al.forEach(a => p.push(a)); }
    if (brand && dim !== 'brand_name') { sql += ' AND brand_name = ?'; p.push(brand); }
    return query(sql, p).rows.map(r => r[dim]).filter(v => v != null && String(v) !== '');
  };
  const countries = new Set();
  const warehouses = new Set();
  const brands = new Set();
  if (mode === 'operational' || mode === 'all') {
    distinctOp('country').forEach(v => countries.add(displayCountry(canonCountry(v))));
    distinctOp('target_warehouse').forEach(v => warehouses.add(v));
    distinctOp('brand').forEach(v => brands.add(v));
  }
  if (mode === 'historical' || mode === 'all') {
    distinctHist('country').forEach(v => countries.add(displayCountry(canonCountry(v))));
    distinctHist('brand_name').forEach(v => brands.add(v));
  }
  const sortArr = a => Array.from(a).sort((x, y) => String(x).localeCompare(String(y)));
  res.json({ countries: sortArr(countries), warehouses: sortArr(warehouses), brands: sortArr(brands) });
}));

app.get('/api/historical-commercial-invoices/:id', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  try {
    const historical = queryOne(historicalCISelectSql() + ' WHERE h.id = ?', [req.params.id]);
    if (!historical) return res.status(404).json({ error: '历史 CI 不存在' });
    historical.items = query('SELECT sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount FROM historical_commercial_invoice_items WHERE hci_id = ? ORDER BY created_at, id', [req.params.id]).rows;
    res.json(historical);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.post('/api/historical-commercial-invoices',
  requireApiPermission('ci_create'), requireApiPermission('payment_create'), requireApiPermission('payment_approve'),
  asyncHandler(async (req, res) => {
    try {
      const result = await createHistoricalCI(req.body || {}, req);
      res.json({ success: true, ...result });
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : '历史 CI 导入失败' }); }
  }));

app.post('/api/historical-commercial-invoices/batch-import',
  requireApiPermission('ci_create'), requireApiPermission('payment_create'), requireApiPermission('payment_approve'),
  asyncHandler(async (req, res) => {
    try {
      const items = Array.isArray(req.body.items) ? req.body.items : [];
      if (!items.length) return res.status(400).json({ error: '没有可导入的历史 CI 数据' });
      if (items.length > 2000) return res.status(400).json({ error: '单次最多导入 2000 条历史 CI' });
      const result = { success: 0, idempotent: 0, failed: 0, errors: [], messages: [] };
            let index = 0;
      for (const item of items) {

        try {
          const created = await createHistoricalCI(item, req);
          if (created.idempotent) result.idempotent++;
          else result.success++;
        } catch (e) {
          result.failed++;
          result.errors.push({ row: index + 2, reason: e.status ? e.message : '历史 CI 导入失败' });
        }
      
      index++;
      };
      if (result.idempotent) result.messages.push(`幂等识别 ${result.idempotent} 条，未重复记账`);
      res.json(result);
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : '历史 CI 批量导入失败' }); }
  }));

  // ==================== HCI-ATTACH-01 历史 CI 附件（复用 PI/CI 既有 dataUrl-in-DB 机制） ====================
  // 默认技术配置参数（非业务规则冻结，可后续配置调整）：单个附件 base64 解码后的技术安全大小上限。
  const HCI_ATTACH_MAX_BYTES = 10 * 1024 * 1024;
  const HCI_ATTACH_ALLOWED = {
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp']
  };
  const HCI_ATTACH_CATEGORIES = ['ci_document', 'payment_proof', 'statement', 'terms_proof', 'other'];

  function sanitizeAttachmentName(name) {
    if (!name) return '未命名附件';
    return String(name).replace(/[\/\\]/g, '_').replace(/\.{2,}/g, '_').slice(0, 200);
  }
  function parseStoredAttachments(str) {
    if (!str) return [];
    try { const v = typeof str === 'string' ? JSON.parse(str) : str; return Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : []); }
    catch (e) { return []; }
  }
  function normalizeAttachmentInput(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') { if (v === '') return []; try { const p = JSON.parse(v); return Array.isArray(p) ? p : [p]; } catch (e) { return null; } }
    if (typeof v === 'object') return [v];
    return null;
  }
  function validateAttachmentItem(item) {
    if (!item || typeof item !== 'object') return { ok: false, reason: '附件对象缺失' };
    const raw = typeof item.dataUrl === 'string' ? item.dataUrl : '';
    if (!raw.startsWith('data:')) return { ok: false, reason: '附件数据格式非法（须为 data URL）' };
    const comma = raw.indexOf(',');
    if (comma < 0) return { ok: false, reason: '附件 data URL 非法' };
    const meta = raw.slice(5, comma);
    if (!/;base64/i.test(meta)) return { ok: false, reason: '附件必须为 base64 编码' };
    const mime = meta.split(';')[0].toLowerCase();
    const allowedExts = HCI_ATTACH_ALLOWED[mime];
    if (!allowedExts) return { ok: false, reason: '不支持的文件类型：' + mime };
    const name = sanitizeAttachmentName(item.name);
    const lower = name.toLowerCase();
    const ext = lower.indexOf('.') >= 0 ? lower.slice(lower.lastIndexOf('.')) : '';
    if (!allowedExts.includes(ext)) return { ok: false, reason: '文件扩展名与类型不匹配：' + (ext || '(无扩展名)') };
    const b64 = raw.slice(comma + 1);
    let bytes; try { bytes = Buffer.from(b64, 'base64').length; } catch (e) { return { ok: false, reason: '附件 base64 解码失败' }; }
    if (bytes > HCI_ATTACH_MAX_BYTES) return { ok: false, reason: '文件超过 ' + (HCI_ATTACH_MAX_BYTES / 1024 / 1024) + ' MB 技术上限' };
    const category = HCI_ATTACH_CATEGORIES.includes(item.category) ? item.category : 'other';
    return { ok: true, item: { name, type: mime, size: bytes, dataUrl: raw, category } };
  }

  // 上传（支持单个对象或数组；相同 CI + 同名同内容自动幂等）
  app.post('/api/historical-commercial-invoices/:id/attachment', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
    try {
      const hci = queryOne('SELECT id, attachment FROM historical_commercial_invoices WHERE id = ?', [req.params.id]);
      if (!hci) return res.status(404).json({ error: '历史 CI 不存在' });
      const incoming = normalizeAttachmentInput(req.body && req.body.attachment);
      if (incoming === null) return res.status(400).json({ error: '附件格式不合法' });
      const existing = parseStoredAttachments(hci.attachment);
      const result = { success: true, added: 0, idempotent: 0, rejected: 0, errors: [] };
      for (const it of incoming) {
        const v = validateAttachmentItem(it);
        if (!v.ok) { result.rejected++; result.errors.push(v.reason); continue; }
        const hash = crypto.createHash('sha256').update(v.item.dataUrl + '|' + v.item.name).digest('hex');
        if (existing.some(a => !a.deleted && a.hash === hash)) { result.idempotent++; continue; }
        existing.push({ ...v.item, hash, uploaded_by: req.currentUserId || '', uploaded_by_name: req.currentUserName || '', uploaded_at: new Date().toISOString() });
        result.added++;
      }
      run('UPDATE historical_commercial_invoices SET attachment = ?, updated_at = datetime(\'now\') WHERE id = ?', [JSON.stringify(existing), hci.id]);
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  // 软删除（单条）
  app.post('/api/historical-commercial-invoices/:id/attachment/:index/delete', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
    try {
      const hci = queryOne('SELECT id, attachment FROM historical_commercial_invoices WHERE id = ?', [req.params.id]);
      if (!hci) return res.status(404).json({ error: '历史 CI 不存在' });
      const list = parseStoredAttachments(hci.attachment);
      const idx = parseInt(req.params.index, 10);
      if (isNaN(idx) || idx < 0 || idx >= list.length) return res.status(404).json({ error: '附件不存在' });
      list[idx].deleted = true;
      list[idx].deleted_by = req.currentUserId || '';
      list[idx].deleted_at = new Date().toISOString();
      run('UPDATE historical_commercial_invoices SET attachment = ?, updated_at = datetime(\'now\') WHERE id = ?', [JSON.stringify(list), hci.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  // CI-SHIP-DATE-01：仅补充/更正历史 CI 的实际出货日期（不触发 payable_date、不动 due_date、不创建/修改 payment_request）
  app.put('/api/historical-commercial-invoices/:id/actual-ship-date', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
    try {
      const hci = queryOne('SELECT id, due_date, actual_ship_date FROM historical_commercial_invoices WHERE id = ?', [req.params.id]);
      if (!hci) return res.status(404).json({ error: '历史 CI 不存在' });
      const shipDate = historicalCIDate(req.body.actual_ship_date, '实际出货日期', true);
      run('UPDATE historical_commercial_invoices SET actual_ship_date = ?, updated_at = datetime(\'now\') WHERE id = ?', [shipDate, hci.id]);
      res.json({ success: true, id: hci.id, actual_ship_date: shipDate });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));

function purchaseAmountScope(rows) {
  const byCurrency = {};
  let count = 0;
  rows.forEach(row => {
    const currency = String(row.currency || '').trim() || 'UNKNOWN';
    const amount = settlementMoney(row.amount || 0);
    byCurrency[currency] = settlementMoney((byCurrency[currency] || 0) + amount);
    count++;
  });
  const currencies = Object.keys(byCurrency).sort().map(currency => ({ currency, amount: byCurrency[currency] }));
  const rmbKnownAmount = byCurrency.RMB || 0;
  const rmbPendingCount = rows.filter(row => String(row.currency || '').trim() !== 'RMB').length;
  return { count, by_currency: currencies, rmb_known_amount: rmbKnownAmount, rmb_pending_count: rmbPendingCount };
}

app.get('/api/purchase-amount-summary', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  try {
    const operationalRows = query(`SELECT currency, goods_amount AS amount FROM commercial_invoices
                                   WHERE ci_status != 'cancelled'`).rows;
    const historicalRows = query(`SELECT currency, gross_goods_amount AS amount FROM historical_commercial_invoices`).rows;
    res.json({
      operational: purchaseAmountScope(operationalRows),
      historical: purchaseAmountScope(historicalRows),
      total: purchaseAmountScope(operationalRows.concat(historicalRows)),
      rmb_note: '仅原币为 RMB 的单据计入已知人民币总额；其他币种未提供明确汇率证据时标记为待补，不做跨币种裸加。'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== PAY-CORE Phase 1.5 Task 1：应付费用池 API ====================

// 应付费用池列表（支持按状态/费用类型/来源/收款方筛选）
// 应付来源编号派生（仅展示用，与财务驾驶舱同口径）：
//  - 定金(deposit, source_type='pi') → proforma_invoices.pi_no
//  - 尾款(balance) 及有 CI 关联 → commercial_invoices.ci_no / historical_commercial_invoices.historical_ci_no
//  - 历史CI 且 source_ci_id 为空 → 回退 source_no 关联 historical_commercial_invoices.historical_ci_no
// 不修改 payable_items / source_type / source_id / CI-PI 关联 / 付款流程，仅返回展示字段。
function derivePayableSourceRefs(rows) {
  const ciIds = [...new Set(rows.map(r => r.source_ci_id).filter(Boolean))];
  const ciMap = {};
  if (ciIds.length) {
    // commercial_invoices 含 related_pi_no；historical_commercial_invoices 不含该列（与驾驶舱现有查询一致）
    query(`SELECT id, ci_no, related_pi_no, country FROM commercial_invoices WHERE id IN (${ciIds.map(() => '?').join(',')})`, ciIds)
      .rows.forEach(c => { ciMap[c.id] = c; });
    query(`SELECT id, historical_ci_no AS ci_no, country FROM historical_commercial_invoices WHERE id IN (${ciIds.map(() => '?').join(',')})`, ciIds)
      .rows.forEach(c => { ciMap[c.id] = c; });
  }
  const hciByNo = {};
  query('SELECT historical_ci_no, historical_ci_no AS ci_no, country FROM historical_commercial_invoices')
    .rows.forEach(c => { if (c.historical_ci_no) hciByNo[c.historical_ci_no] = c; });
  const piIds = [...new Set(rows.map(r => r.source_id).filter(Boolean))];
  const piMap = {};
  if (piIds.length) {
    query(`SELECT id, pi_no, country FROM proforma_invoices WHERE id IN (${piIds.map(() => '?').join(',')})`, piIds)
      .rows.forEach(p => { piMap[p.id] = p; });
  }
  const out = new Map();
  for (const r of rows) {
    const ciCtx = r.source_ci_id ? ciMap[r.source_ci_id]
      : (r.source_type === 'historical_ci' && r.source_no ? (hciByNo[r.source_no] || null) : null);
    const piCtx = r.source_type === 'pi' ? piMap[r.source_id] : null;
    const relatedPiNo = r.source_type === 'pi'
      ? (piCtx ? (piCtx.pi_no || '') : (r.source_no || ''))
      : (ciCtx ? (ciCtx.related_pi_no || '') : '');
    const relatedCiNo = ciCtx ? (ciCtx.ci_no || '') : '';
    // 国家：定金→PI.country，尾款/其他→CI.country（无 CI 回退 PI），归一化显示（CI 历史表存代码、PI/CI 表存中文）
    const sub = r.subcategory_code || '';
    const rawCountry = sub === 'deposit'
      ? (piCtx ? (piCtx.country || '') : '')
      : (ciCtx ? (ciCtx.country || '') : (piCtx ? (piCtx.country || '') : ''));
    const countryDisplay = displayCountry(canonCountry(rawCountry));
    out.set(r.id, { related_pi_no: relatedPiNo, related_ci_no: relatedCiNo, country_display: countryDisplay });
  }
  return out;
}

app.get('/api/payable-items', requireApiPermission('payment_view'), asyncHandler((req, res) => {
  const { lifecycle_status, fee_type, source_type, source_id, payee_key, keyword } = req.query;
  // 关联来源单据取供应商名称（仅用于列表展示「供应商」列，不改任何业务规则/金额/状态）
  let sql = `SELECT pi.*,
      COALESCE(ci.supplier_name, hci.supplier_name, pii.supplier_name) AS supplier_name
    FROM payable_items pi
    LEFT JOIN commercial_invoices ci ON pi.source_ci_id = ci.id
    LEFT JOIN historical_commercial_invoices hci ON pi.source_ci_id = hci.id
    LEFT JOIN proforma_invoices pii ON pi.source_type = 'pi' AND pi.source_id = pii.id
    WHERE 1=1`;
  const params = [];
  // 业务规则：应付费用工作台只列出未结清项（active + reserved + partially_paid）。
  // 全部付清（paid）以及已取消（cancelled）移出本列表。
  // partially_paid = 已付一部分、仍有剩余未付，继续留在列表并可再次发起付款申请。
  // 调用方主动传 lifecycle_status 参数时按精确值查询（历史查询仍可用）。
  if (lifecycle_status) { sql += ' AND lifecycle_status = ?'; params.push(lifecycle_status); }
  else { sql += " AND lifecycle_status IN ('active','reserved','partially_paid')"; }
  if (fee_type) { sql += ' AND fee_type = ?'; params.push(fee_type); }
  if (source_type) { sql += ' AND source_type = ?'; params.push(source_type); }
  if (source_id) { sql += ' AND source_id = ?'; params.push(source_id); }
  if (payee_key) { sql += ' AND payee_key = ?'; params.push(payee_key); }
  if (keyword) { sql += ' AND (fee_no LIKE ? OR source_no LIKE ? OR payee_name_snapshot LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY created_at DESC';
  const rows = query(sql, params).rows;
  // PAY-CORE 多次付款：附加「已付款 / 抵扣 / 抹零 / 剩余未付」拆分（应付事实不变，金额动态推导）
  const breakdownMap = payableItemsSettlementBreakdown(rows.map(r => r.id));
  // 来源编号派生（仅展示用，与驾驶舱同口径：定金→PI号，尾款→CI号）
  const refMap = derivePayableSourceRefs(rows);
  // 金额转换为元（便于前端展示）
  const items = rows.map(r => {
    const b = breakdownMap.get(r.id) || { paidMinor: 0, deductionMinor: 0, roundingMinor: 0 };
    const payableMinor = Number(r.payable_amount_minor || 0);
    const paidMinor = b.paidMinor;
    const deductionMinor = b.deductionMinor;
    const roundingMinor = b.roundingMinor;
    const remainingMinor = Math.max(0, payableMinor - paidMinor - deductionMinor - roundingMinor);
    const refs = refMap.get(r.id) || { related_pi_no: '', related_ci_no: '', country_display: '' };
    return {
      ...r,
      related_pi_no: refs.related_pi_no,
      related_ci_no: refs.related_ci_no,
      country_display: refs.country_display,
      payable_amount: payableMinor / 100,
      paid_amount_minor: paidMinor,
      paid_amount: minorToAmount(paidMinor),
      deduction_amount_minor: deductionMinor,
      deduction_amount: minorToAmount(deductionMinor),
      rounding_amount_minor: roundingMinor,
      rounding_amount: minorToAmount(roundingMinor),
      settled_amount_minor: paidMinor + deductionMinor + roundingMinor,
      settled_amount: minorToAmount(paidMinor + deductionMinor + roundingMinor),
      remaining_amount_minor: remainingMinor,
      remaining_amount: minorToAmount(remainingMinor)
    };
  });
  res.json({ items, total: items.length });
}));

// 应付费用详情
app.get('/api/payable-items/:id', requireApiPermission('payment_view'), asyncHandler((req, res) => {
  const item = queryOne('SELECT * FROM payable_items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: '应付费用不存在' });
  // 来源编号派生（仅展示用，与驾驶舱/列表同口径：定金→PI号，尾款→CI号）
  const refMap = derivePayableSourceRefs([item]);
  const refs = refMap.get(item.id) || { related_pi_no: '', related_ci_no: '', country_display: '' };
  item.related_pi_no = refs.related_pi_no;
  item.related_ci_no = refs.related_ci_no;
  item.country_display = refs.country_display;
  item.payable_amount = item.payable_amount_minor / 100;
  const b = payableItemsSettlementBreakdown([item.id]).get(item.id) || { paidMinor: 0, deductionMinor: 0, roundingMinor: 0 };
  const payableMinor = Number(item.payable_amount_minor || 0);
  const paidMinor = b.paidMinor;
  const deductionMinor = b.deductionMinor;
  const roundingMinor = b.roundingMinor;
  const settledMinor = paidMinor + deductionMinor + roundingMinor;
  const remainingMinor = Math.max(0, payableMinor - settledMinor);
  item.paid_amount_minor = paidMinor;
  item.paid_amount = minorToAmount(paidMinor);
  item.deduction_amount_minor = deductionMinor;
  item.deduction_amount = minorToAmount(deductionMinor);
  item.rounding_amount_minor = roundingMinor;
  item.rounding_amount = minorToAmount(roundingMinor);
  item.settled_amount_minor = settledMinor;
  item.settled_amount = minorToAmount(settledMinor);
  item.remaining_amount_minor = remainingMinor;
  item.remaining_amount = minorToAmount(remainingMinor);
  res.json({ item });
}));

// 取消应付费用（仅 lifecycle_status='active' 状态可取消）
app.post('/api/payable-items/:id/cancel', requireApiPermission('payment_create'), asyncHandler((req, res) => {
  const { cancel_reason } = req.body;
  const item = queryOne('SELECT * FROM payable_items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: '应付费用不存在' });
  if (item.lifecycle_status !== 'active') {
    return res.status(409).json({ error: `当前状态为 ${item.lifecycle_status}，不能取消（仅 active 状态可取消）` });
  }
  const operatorId = (req.currentUserId || req.user && req.user.id) || '';
  const ok = cancelPayableItem(req.params.id, operatorId, cancel_reason || '手动取消');
  if (!ok) {
    return res.status(409).json({ error: '取消失败，应付费用可能已被锁定或付款' });
  }
  res.json({ success: true, id: req.params.id, lifecycle_status: 'cancelled' });
}));

app.get('/api/payment-requests', requireApiPermission('payment_view'), asyncHandler((req, res) => {
  const { status, category, keyword } = req.query;
  let sql = "SELECT * FROM payment_requests WHERE 1=1 AND (approval_status = 'approved' OR payment_status IN ('paid','partial_paid','cancelled'))";
  const params = [];
  if (status) { sql += ' AND payment_status = ?'; params.push(status); }
  if (category) { sql += ' AND payment_category = ?'; params.push(category); }
  if (keyword) { sql += ' AND (request_no LIKE ? OR supplier_name LIKE ? OR source_no LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY payable_date ASC, created_at DESC';
  res.json(query(sql, params).rows);
}));

// ==================== FIN-DASHBOARD-01：财务应付驾驶舱（只读聚合，不改任何业务规则/表结构/付款链）====================
// 口径全部复用已冻结实现：
//  - 未结清 = paymentSettlementFacts().outstanding（payable - 有效付款 - 有效抵扣 - 有效抹零，仅 status='applied'）
//  - 状态   = derivePaymentStatus()
//  - 到期日 = 持久化 payable_date（由 computePayableDate 在建单时写入；空则归入"无到期日"桶，不臆造）
//  - 币种   = 严格按币种分组，绝不跨币种裸加/臆造 RMB 折算
//  - 供应商 = supplier_name（冗余快照，全行可用；无 supplier_id 外键，不臆造）
//  - 费用类型 = payment_category；付款主体 = payee_type
const PAYABLE_CATEGORY_LABELS = { goods: '货款', warehouse_arrival: '到仓费用', customs_duty: '关税', inspection_fee: '商检费用' };
const PAYABLE_SUBCAT_LABELS = { deposit: '定金', balance: '尾款', duty: '关税', inspection: '商检', freight: '运费' };
const PAYABLE_PAYEE_LABELS = { factory: '工厂', customs: '海关', inspection_org: '检验机构', service_provider: '服务商' };
const PAYABLE_STATUS_LABELS = { pending_approval: '待审批', approved: '已审批', paid: '已付款', rejected: '已驳回', partial_paid: '部分付款', partial_deduction: '部分抵扣', partial_rounding: '部分抹零', deduction_settled: '全额抵扣', partial_payment_partial_deduction: '部分付款+部分抵扣', reversed: '已冲销', cancelled: '已取消' };

app.get('/api/finance/payable-cockpit', requireApiPermission('payment_view'), asyncHandler(async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    // 付款提前提醒天数改读 system_config（payment_remind_days，缺省 7）；30 天展示桶保持固定，不配置化
    const remindDays = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'payment_remind_days'")?.value || '7', 10);
    const d7 = addDays(today, remindDays);
    const d30 = addDays(today, 30);
    // ===== 应付驾驶舱：基于 payable_items 聚合（与「应付费用列表」同一套计算口径）=====
    // 业务规则：进入应付费用列表的数据即为企业真实应付；payment_requests 仅代表付款执行过程，
    // 不作为应付金额统计来源。故此处直接聚合 payable_items 的剩余未付（remaining），
    // 复用 payableItemsSettlementBreakdown() 与列表完全一致 —— 确保「驾驶舱供应商金额 = 应付列表供应商金额」。
    // 未结清口径与列表默认一致：仅 active / reserved / partially_paid（paid / cancelled 排除）。
    const rows = query(
      `SELECT pi.*,
          COALESCE(ci.supplier_name, hci.supplier_name, pii.supplier_name) AS supplier_name
       FROM payable_items pi
       LEFT JOIN commercial_invoices ci ON pi.source_ci_id = ci.id
       LEFT JOIN historical_commercial_invoices hci ON pi.source_ci_id = hci.id
       LEFT JOIN proforma_invoices pii ON pi.source_type = 'pi' AND pi.source_id = pii.id
       WHERE pi.lifecycle_status IN ('active','reserved','partially_paid')`
    ).rows;

    // 复用列表同款 settlement 拆算：已付款 / 抵扣 / 抹零 / 剩余未付（金额动态推导，不改变任何业务规则）
    const breakdownMap = payableItemsSettlementBreakdown(rows.map(r => r.id));

    // 关联付款申请（仅作辅助展示：是否已申请 / 审批状态 / 付款状态），一次查询避免 N+1
    const linkedPrs = rows.length ? query(
      `SELECT pri.payable_item_id AS payable_item_id, pr.id AS pr_id, pr.request_no,
              pr.approval_status, pr.payment_status, pr.paid_date
       FROM payment_request_items pri
       JOIN payment_requests pr ON pr.id = pri.payment_request_id
       WHERE pri.payable_item_id IN (${rows.map(() => '?').join(',')})
         AND pr.payment_status NOT IN ('cancelled','rejected')
         AND pr.approval_status NOT IN ('cancelled','rejected')`,
      rows.map(r => r.id)
    ).rows : [];
    const prByItem = {};
    linkedPrs.forEach(p => { (prByItem[p.payable_item_id] = prByItem[p.payable_item_id] || []).push(p); });

    // CI 上下文（供应商追溯 / 国家 / 信用条款），一次查询
    const ciIds = [...new Set(rows.map(r => r.source_ci_id).filter(Boolean))];
    const ciMap = {};
    if (ciIds.length) {
      query(
        `SELECT id, ci_no, related_pi_no, country, credit_days, actual_ship_date
         FROM commercial_invoices WHERE id IN (${ciIds.map(() => '?').join(',')})`,
        ciIds
      ).rows.forEach(c => { ciMap[c.id] = c; });
      query(
        `SELECT id, historical_ci_no AS ci_no, country, credit_days, actual_ship_date
         FROM historical_commercial_invoices WHERE id IN (${ciIds.map(() => '?').join(',')})`,
        ciIds
      ).rows.forEach(c => { ciMap[c.id] = c; });
    }
    // 历史 CI：额外按 historical_ci_no 建索引。
    // 历史类应付项的 source_ci_id 可能为 NULL，需借 source_no 关联 historical_commercial_invoices.historical_ci_no 才能取到来源编号与国家。
    const hciByNo = {};
    query('SELECT id, historical_ci_no, historical_ci_no AS ci_no, country, credit_days, actual_ship_date FROM historical_commercial_invoices')
      .rows.forEach(c => { if (c.historical_ci_no) hciByNo[c.historical_ci_no] = c; ciMap[c.id] = c; });

    // PI 上下文（来源编号 pi_no / 国家），一次查询（source_type='pi' 时 source_id 指向 PI）
    const piIds = [...new Set(rows.map(r => r.source_id).filter(Boolean))];
    const piMap = {};
    if (piIds.length) {
      query(`SELECT id, pi_no, country FROM proforma_invoices WHERE id IN (${piIds.map(() => '?').join(',')})`, piIds)
        .rows.forEach(p => { piMap[p.id] = p; });
    }

    const m2 = (v) => settlementMoney(v);
    const enriched = [];
    for (const pi of rows) {
      const b = breakdownMap.get(pi.id) || { paidMinor: 0, deductionMinor: 0, roundingMinor: 0 };
      const payableMinor = Number(pi.payable_amount_minor || 0);
      const paidMinor = b.paidMinor;
      const deductionMinor = b.deductionMinor;
      const roundingMinor = b.roundingMinor;
      const remainingMinor = Math.max(0, payableMinor - paidMinor - deductionMinor - roundingMinor);
      const grossPayable = minorToAmount(payableMinor);
      const settled = minorToAmount(paidMinor + deductionMinor + roundingMinor);
      const outstanding = minorToAmount(remainingMinor);

      // 到期日：持久化字段优先；空归入"无到期日"桶
      const payableDate = String(pi.payable_date || '').trim();
      const hasDue = /^\d{4}-\d{2}-\d{2}$/.test(payableDate);
      const overdueDays = (hasDue && remainingMinor > 0 && payableDate < today)
        ? Math.max(0, Math.floor((new Date(today + 'T00:00:00Z') - new Date(payableDate + 'T00:00:00Z')) / 86400000))
        : 0;

      // 信用条款上下文：仅「Credit 条款 + 已录入出货日 + 有 credit_days」却仍无应付日期，才属真实数据异常。
      // 非 Credit（如定金/预付）本就无需应付日期，不补、不报异常；绝不臆造日期。
      let creditMissingDue = false;
      // 统一来源解析：
      //  - source_ci_id 有效 → 运营CI / 历史CI（ciMap 已含两类）
      //  - 历史CI 且 source_ci_id 为空 → 回退 source_no 关联 historical_commercial_invoices.historical_ci_no
      const ciCtx0 = pi.source_ci_id ? ciMap[pi.source_ci_id] : null;
      const ciCtx = ciCtx0 || (pi.source_type === 'historical_ci' && pi.source_no ? (hciByNo[pi.source_no] || null) : null);
      const piCtx = pi.source_type === 'pi' ? piMap[pi.source_id] : null;
      if (ciCtx) {
        const cd = Number(ciCtx.credit_days) || 0;
        const ship = String(ciCtx.actual_ship_date || '').trim();
        creditMissingDue = cd > 0 && /^\d{4}-\d{2}-\d{2}$/.test(ship) && !hasDue;
      }

      // 关联付款申请（辅助展示）→ 派生态：是否已申请 / 审批状态 / 付款状态
      const prs = prByItem[pi.id] || [];
      let status = 'unpaid', status_label = '未申请';
      {
        let paid = false, partial = false, approved = false, pending = false, draft = false, rejected = false;
        prs.forEach(p => {
          const as = p.approval_status, ps = p.payment_status;
          if (as === 'rejected' || ps === 'rejected' || as === 'cancelled' || ps === 'cancelled') { rejected = true; return; }
          if (as === 'draft') { draft = true; return; }
          if (as === 'pending' || as === 'pending_approval') { pending = true; return; }
          if (as === 'approved') {
            if (ps === 'paid' || ps === 'deduction_settled') paid = true;
            else if (ps === 'partial_paid' || ps === 'partial_deduction' || ps === 'partial_rounding' || ps === 'partial_payment_partial_deduction') partial = true;
            else approved = true;
          }
        });
        if (paid) { status = 'paid'; status_label = '已付款'; }
        else if (partial) { status = 'approved'; status_label = '部分付款'; }
        else if (approved) { status = 'approved'; status_label = '已通过'; }
        else if (pending) { status = 'pending_approval'; status_label = '审批中'; }
        else if (draft) { status = 'pending_approval'; status_label = '草稿'; }
        else if (rejected) { status = 'rejected'; status_label = '已驳回'; }
      }
      const lastPaymentDate = (prs.map(p => p.paid_date).filter(Boolean).sort().slice(-1)[0]) || '';
      const requestNo = prs.map(p => p.request_no).filter(Boolean).join(' / ') || '';
      // 来源编号：
      //  - PI来源(source_type='pi') → proforma_invoices.pi_no
      //  - CI来源(source_ci_id 命中运营CI/历史CI) → commercial_invoices.ci_no / historical_commercial_invoices.historical_ci_no
      const ciNo = ciCtx ? (ciCtx.ci_no || '') : '';
      const relatedPiNo = pi.source_type === 'pi'
        ? (piCtx ? (piCtx.pi_no || '') : (pi.source_no || ''))
        : (ciCtx ? (ciCtx.related_pi_no || '') : '');
      const relatedCiNo = ciCtx ? ciNo : '';
      // 国家：优先 source_ci_id 关联 CI（运营/历史），其次 PI 来源回退 proforma_invoices.country
      const country = ciCtx ? (ciCtx.country || '') : (piCtx ? (piCtx.country || '') : '');
      // 国家展示归一化：商业 CI/PI 表的 country 存中文名（如「印度尼西亚」），historical_commercial_invoices 表的 country 存代码（如「ID」），
      // 同一供应商下两种格式并存会造成驾驶舱明细/头部列表显示不一致。仅在明细返回层归一化，不修改原 country 字段、DB 写逻辑及任何业务规则。
      // 复用既有 canonCountry/displayCountry（已在 CI 筛选接口用于兼容查询）。
      const countryDisplay = displayCountry(canonCountry(country));

      enriched.push({
        id: prs.length ? prs[0].pr_id : pi.id,
        request_no: requestNo,
        // 与应付费用列表「供应商」列展示口径一致：优先 JOIN 来源名称，缺失时回退收款方快照
        supplier_name: ((pi.supplier_name || '').trim()) || ((pi.payee_name_snapshot || '').trim()) || '（未填供应商）',
        country,
        country_display: countryDisplay,
        source_type: pi.source_type || '',
        related_pi_no: relatedPiNo,
        related_ci_no: relatedCiNo,
        payment_category: pi.category_code || '',
        category_label: PAYABLE_CATEGORY_LABELS[pi.category_code] || pi.category_code || '',
        subcategory: pi.subcategory_code || '',
        subcategory_label: PAYABLE_SUBCAT_LABELS[pi.subcategory_code] || pi.subcategory_code || '',
        payee_type: pi.payee_type || '',
        payee_label: PAYABLE_PAYEE_LABELS[pi.payee_type] || pi.payee_type || '',
        currency: pi.currency || '',
        gross_payable: grossPayable,
        settled,
        outstanding,
        last_payment_date: lastPaymentDate,
        payable_date: hasDue ? payableDate : '',
        has_due: hasDue,
        credit_missing_due: creditMissingDue,
        overdue_days: overdueDays,
        status,
        status_label,
        approval_status: status,
        source_mode: pi.source_type === 'historical_ci' ? 'historical' : 'operational'
      });
    }

    // 顶部核心指标：按币种分组（绝不跨币种合并）
    const metrics = {};
    const bump = (cur) => {
      if (!metrics[cur]) metrics[cur] = {
        currency: cur, request_count: 0, gross_payable: 0, settled: 0, outstanding: 0,
        due_7: 0, due_30: 0, overdue_amount: 0, overdue_count: 0, no_due_outstanding: 0
      };
      return metrics[cur];
    };
    enriched.forEach(r => {
      const mm = bump(r.currency);
      mm.request_count += 1;
      mm.gross_payable = m2(mm.gross_payable + r.gross_payable);
      mm.settled = m2(mm.settled + r.settled);
      mm.outstanding = m2(mm.outstanding + r.outstanding);
      if (r.outstanding > 0) {
        if (r.credit_missing_due) {
          mm.no_due_outstanding = m2(mm.no_due_outstanding + r.outstanding);
        } else if (r.has_due) {
          if (r.payable_date < today) {
            mm.overdue_amount = m2(mm.overdue_amount + r.outstanding);
            mm.overdue_count += 1;
          } else {
            if (r.payable_date <= d7) mm.due_7 = m2(mm.due_7 + r.outstanding);
            if (r.payable_date <= d30) mm.due_30 = m2(mm.due_30 + r.outstanding);
          }
        }
        // 无到期日且非 Credit 异常的未结项：不计入任何时间桶（与 by_supplier 口径一致）
      }
    });

    // 按供应商汇总（供应商 + 币种为聚合键，可下钻）
    const supMap = {};
    enriched.forEach(r => {
      const key = r.supplier_name + '||' + r.currency;
      if (!supMap[key]) supMap[key] = {
        supplier_name: r.supplier_name, currency: r.currency,
        gross_payable: 0, settled: 0, outstanding: 0, due_soon: 0, overdue_amount: 0,
        earliest_due_date: '', outstanding_count: 0, request_count: 0, ids: [], last_payment_date: ''
      };
      const s = supMap[key];
      s.request_count += 1;
      s.ids.push(r.id);
      s.gross_payable = m2(s.gross_payable + r.gross_payable);
      s.settled = m2(s.settled + r.settled);
      s.outstanding = m2(s.outstanding + r.outstanding);
      if (r.outstanding > 0) {
        s.outstanding_count += 1;
        if (r.has_due) {
          if (r.payable_date < today) s.overdue_amount = m2(s.overdue_amount + r.outstanding);
          else if (r.payable_date <= d30) s.due_soon = m2(s.due_soon + r.outstanding);
          if (!s.earliest_due_date || r.payable_date < s.earliest_due_date) s.earliest_due_date = r.payable_date;
        }
      }
      if (r.last_payment_date && (!s.last_payment_date || r.last_payment_date > s.last_payment_date)) s.last_payment_date = r.last_payment_date;
    });
    const by_supplier = Object.values(supMap).sort((a, b) => b.outstanding - a.outstanding);

    // 按费用类型汇总（费用类型 + 币种）
    const catMap = {};
    enriched.forEach(r => {
      const key = r.payment_category + '||' + r.currency;
      if (!catMap[key]) catMap[key] = {
        payment_category: r.payment_category, category_label: r.category_label, currency: r.currency,
        gross_payable: 0, settled: 0, outstanding: 0, request_count: 0
      };
      const c = catMap[key];
      c.request_count += 1;
      c.gross_payable = m2(c.gross_payable + r.gross_payable);
      c.settled = m2(c.settled + r.settled);
      c.outstanding = m2(c.outstanding + r.outstanding);
    });
    const by_category = Object.values(catMap).sort((a, b) => b.outstanding - a.outstanding);

    // 供应商关联品牌（仅展示用，不影响任何金额/状态/结算计算；空 associated_brands 解析为 ''）
    const supRows = query('SELECT name, associated_brands FROM suppliers').rows;
    const supplier_brands = {};
    supRows.forEach(s => {
      let arr = [];
      try { arr = JSON.parse(s.associated_brands || '[]'); } catch (e) { arr = []; }
      supplier_brands[s.name] = (Array.isArray(arr) && arr.length) ? arr.join(', ') : '';
    });

    // 明细：未结清优先 + 到期日升序
    const details = enriched.slice().sort((a, b) => {
      if ((b.outstanding > 0) !== (a.outstanding > 0)) return (b.outstanding > 0) - (a.outstanding > 0);
      const ad = a.payable_date || '9999-12-31', bd = b.payable_date || '9999-12-31';
      return ad.localeCompare(bd);
    });

    res.json({
      generated_at: new Date().toISOString(),
      today,
      currencies: Object.keys(metrics).sort(),
      metrics,
      by_supplier,
      by_category,
      supplier_brands,
      details,
      notes: {
        currency: '各币种独立汇总，未提供 USD→RMB 等锁定汇率证据时不做跨币种折算或裸加',
        due_date: '应付日期来自 payable_items.payable_date（与应付费用列表同字段）；非 Credit（如定金/预付）无需应付日期，保持为空且不计入异常。',
        outstanding: '未结清=应付费用列表同口径：payable_items 应付金额 − 已付款 − 抵扣 − 抹零（复用 payableItemsSettlementBreakdown）。payment_requests 仅作付款执行状态辅助展示，不参与金额汇总。',
        source: '驾驶舱直接基于 payable_items 聚合（真实应付事实）；进入应付费用列表的数据无论是否提交付款申请均计入。',
        scope: '仅口径调整，未修改任何付款/审批/抵扣/冲销/汇率/WAC 业务规则与数据'
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 计算付款申请"总数量"（按已确认口径：以 payment_category 为准）
// - 定金(goods+deposit, source pi)：proforma_invoice_items 按 pi_id=source_id 聚合 pi_confirmed_qty，全为 0 回退 po_qty
// - 尾款(goods+balance, source ci)：commercial_invoice_items 按 ci_id=source_id 聚合 shipped_qty
// - 费用类(warehouse_arrival/customs_duty/inspection_fee 等)及兜底：留空(null)
function computePaymentTotalQty(pr) {
  if (!pr) return null;
  if (pr.payment_category === 'goods') {
    if (pr.payment_subcategory === 'deposit' && pr.source_type === 'pi') {
      const items = query('SELECT pi_confirmed_qty, po_qty FROM proforma_invoice_items WHERE pi_id = ?', [pr.source_id]).rows;
      let sum = items.reduce((a, x) => a + (Number(x.pi_confirmed_qty) || 0), 0);
      if (sum === 0) sum = items.reduce((a, x) => a + (Number(x.po_qty) || 0), 0);
      return sum;
    }
    if (pr.payment_subcategory === 'balance' && pr.source_type === 'ci') {
      const items = query('SELECT shipped_qty FROM commercial_invoice_items WHERE ci_id = ?', [pr.source_id]).rows;
      return items.reduce((a, x) => a + (Number(x.shipped_qty) || 0), 0);
    }
  }
  return null;
}

// 待审付款申请（供审批中心 → 财务类审批读取）
// 审批中心只负责两件事：① 待审批（approval_status='pending'）；② 已审批但尚未做付款确认。
// 因此用白名单：approved 后仅 pending_approval / approved / partial_deduction（仅抵扣、未付款）保留；
// 一旦发生付款确认（partial_paid / partial_payment_partial_deduction / paid / deduction_settled / partial_rounding）
// 即视为本次付款动作完成，移出审批中心；剩余未付金额回到应付费用列表，由用户重新发起付款申请。
app.get('/api/payment-requests/pending', requireApiPermission('payment_approve'), asyncHandler((req, res) => {
  try {
    const rows = query(`
      SELECT id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no,
             payee_type, supplier_name, payable_amount, currency, related_ci_no, related_po_no,
             approval_status, payment_status, remark, created_at
      FROM payment_requests
      WHERE approval_status = 'pending'
         OR (approval_status = 'approved' AND payment_status IN ('pending_approval','approved','partial_deduction'))
      ORDER BY created_at DESC
    `).rows;
    // PAY-CORE Phase 2-B：附加只读 approval 摘要（与 Phase 2-A 详情接口同款模式）
    // 复用 paymentRequestToBusinessType 派生 bt，避免硬编码 business_type 列表
    rows.forEach(r => {
      r.total_qty = computePaymentTotalQty(r);
      const bt = paymentRequestToBusinessType(r);
      r.approval = null;
      if (bt) {
        const ar = queryOne(
          `SELECT id, current_level, max_level, submitter_id, submitter_name,
                  approvers, status, created_at AS submitted_at
           FROM approval_records
           WHERE business_id = ? AND business_type = ? AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1`,
          [r.id, bt]
        );
        if (ar) {
          // PAY-CORE Phase 1：使用 normalizeApprovalSnapshot 兼容老数组格式 + 新对象格式
          const snapshot = normalizeApprovalSnapshot(ar.approvers);
          const approverList = snapshot.levels;
          const curApprover = approverList.find(a => a.level === ar.current_level);
          r.approval = {
            approval_id: ar.id,
            current_level: ar.current_level,
            max_level: ar.max_level,
            submitter_name: ar.submitter_name,
            current_approver_name: curApprover ? (curApprover.approver_name || curApprover.approver_user_id || '') : '',
            current_approver_user_id: curApprover ? (curApprover.approver_user_id || '') : '',
            // PAY-CORE Phase 1：附加当前节点 CC 数量 + 完成 CC 数量（前端可选择性展示）
            current_node_cc_count: curApprover ? (Array.isArray(curApprover.cc_user_ids) ? curApprover.cc_user_ids.length : 0) : 0,
            completion_cc_count: snapshot.completion_cc_user_ids.length
          };
        }
      }
    });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// [2026-08-01] 固定路径 by-payable-items 必须注册在通用动态路由 /api/payment-requests/:id 之前，否则会被 :id 抢先匹配而 404。
app.get('/api/payment-requests/by-payable-items', requireApiPermission('payment_view'), asyncHandler(async (req, res) => {
  try {
    const idsRaw = req.query.ids || '';
    const ids = String(idsRaw).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return res.status(400).json({ error: '缺少 payable_item_ids' });
    }
    const includeHistory = String(req.query.include_history || '').toLowerCase() === 'true';
    const placeholders = ids.map(() => '?').join(',');
    // 默认排除 cancelled/rejected 历史，仅返回当前有效 PR
    let whereExtra = '';
    if (!includeHistory) {
      whereExtra = ` AND pr.payment_status NOT IN ('cancelled','rejected') AND pr.approval_status NOT IN ('cancelled','rejected')`;
    }
    const rows = query(
      `SELECT DISTINCT pr.id, pr.request_no, pr.payment_status, pr.approval_status, pr.payment_mode, pri.payable_item_id AS payable_item_id
       FROM payment_requests pr
       JOIN payment_request_items pri ON pri.payment_request_id = pr.id
       WHERE pri.payable_item_id IN (${placeholders})${whereExtra}
       ORDER BY pr.created_at DESC`,
      ids
    ).rows;
    res.json({ payment_requests: rows, include_history: includeHistory });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

// 付款申请详情（含按口径计算的 total_qty + 关联 PI/CI 摘要）
app.get('/api/payment-requests/:id', requireApiPermission('payment_view'), asyncHandler(async (req, res) => {
  try {
    const pr = queryOne('SELECT * FROM payment_requests WHERE id = ?', [req.params.id]);
    if (!pr) return res.status(404).json({ error: '付款申请不存在' });
    pr.total_qty = computePaymentTotalQty(pr);
    // PAY-CORE Phase 1.5 Task 2：multi 模式附加 items[]（从 payable_items 派生费用性质/原始币种/原始金额）
    let items = [];
    if (pr.payment_mode === 'multi') {
      const itemRows = await query(
        `SELECT pri.id, pri.payable_item_id, pri.requested_amount_minor,
                pi.fee_no, pi.source_type, pi.source_id, pi.source_no, pi.fee_type,
                pi.category_code, pi.subcategory_code,
                pi.payee_type, pi.payee_key, pi.payee_name_snapshot,
                pi.currency, pi.payable_amount_minor, pi.lifecycle_status
         FROM payment_request_items pri
         JOIN payable_items pi ON pi.id = pri.payable_item_id
         WHERE pri.payment_request_id = ?
         ORDER BY pi.fee_type, pi.created_at`,
        [req.params.id]
      );
      items = itemRows.rows;
    }
    let pi_summary = null, ci_summary = null, historical_ci_summary = null;
    if (pr.source_type === 'pi' && pr.source_id) {
      pi_summary = queryOne('SELECT id, pi_no, supplier_name, brand, country, target_warehouse, total_amount, currency, pi_status, pi_date FROM proforma_invoices WHERE id = ?', [pr.source_id]);
    }
    if (pr.source_type === 'ci' && pr.source_id) {
      ci_summary = queryOne('SELECT id, ci_no, supplier_name, brand, country, target_warehouse, goods_amount, currency, ci_status, ci_date, related_po_no FROM commercial_invoices WHERE id = ?', [pr.source_id]);
    } else if (pr.related_ci_id) {
      ci_summary = queryOne('SELECT id, ci_no, supplier_name, brand, country, target_warehouse, goods_amount, currency, ci_status, ci_date, related_po_no FROM commercial_invoices WHERE id = ?', [pr.related_ci_id]);
    }
    if (pr.source_type === 'historical_ci' && pr.source_id) {
      historical_ci_summary = queryOne(`SELECT id, historical_ci_no, supplier_name, brand_name, country,
                                               gross_goods_amount, historical_paid_amount, historical_paid_date,
                                               currency, ci_date, payment_terms, due_date, source_note, source_mode
                                        FROM historical_commercial_invoices WHERE id = ?`, [pr.source_id]);
    }
    const settlement_logs = await paymentSettlementDisplayLogs(pr);
    const settlement = await paymentSettlementFacts(pr);
    // PAY-CORE Phase 2-A：附加只读 approval 数据（仅展示，不修改状态机/通知/表结构）
    // 复用 paymentRequestToBusinessType 派生 business_type，避免硬编码列表；权限仍由 requireApiPermission('payment_view') 保证
    const bt = paymentRequestToBusinessType(pr);
    let approval = null;
    if (bt) {
      const ar = queryOne(
        `SELECT id, business_type, business_code, submitter_id, submitter_name,
                current_level, max_level, approvers, approval_history, status,
                created_at AS submitted_at, updated_at
         FROM approval_records
         WHERE business_id = ? AND business_type = ?
         ORDER BY created_at DESC LIMIT 1`,
        [pr.id, bt]
      );
      if (ar) {
        // PAY-CORE Phase 1：使用 normalizeApprovalSnapshot 兼容老数组格式 + 新对象格式
        const snapshot = normalizeApprovalSnapshot(ar.approvers);
        let historyList = [];
        try { historyList = JSON.parse(ar.approval_history || '[]'); } catch (e) { historyList = []; }
        approval = {
          approval_id: ar.id,
          business_type: ar.business_type,
          business_code: ar.business_code,
          submitter_id: ar.submitter_id,
          submitter_name: ar.submitter_name,
          submitted_at: ar.submitted_at,
          current_level: ar.current_level,
          max_level: ar.max_level,
          status: ar.status,
          // PAY-CORE Phase 1：返回规范化后的快照对象（含 levels + completion_cc_user_ids）
          approvers: snapshot.levels,
          completion_cc_user_ids: snapshot.completion_cc_user_ids,
          approval_history: historyList
        };
      }
    }
    res.json({ ...pr, pi_summary, ci_summary, historical_ci_summary, settlement_logs, effective_paid: settlement.effectivePaid, effective_deduction: settlement.effectiveDeduction, effective_rounding: settlement.effectiveRounding, outstanding: Math.max(0, settlement.outstanding), approval, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// PAY-CORE Phase 1.5 Task 2：付款申请明细查询（multi 模式专用，复用详情 JOIN 逻辑）
app.get('/api/payment-requests/:id/items', requireApiPermission('payment_view'), asyncHandler(async (req, res) => {
  try {
    const pr = queryOne('SELECT id, request_no, payment_mode, payee_key, payee_name_snapshot, currency FROM payment_requests WHERE id = ?', [req.params.id]);
    if (!pr) return res.status(404).json({ error: '付款申请不存在' });
    const rows = await query(
      `SELECT pri.id, pri.payable_item_id, pri.requested_amount_minor,
              pi.fee_no, pi.source_type, pi.source_id, pi.source_no, pi.fee_type,
              pi.category_code, pi.subcategory_code,
              pi.payee_type, pi.payee_key, pi.payee_name_snapshot,
              pi.currency, pi.payable_amount_minor, pi.lifecycle_status
       FROM payment_request_items pri
       JOIN payable_items pi ON pi.id = pri.payable_item_id
       WHERE pri.payment_request_id = ?
       ORDER BY pi.fee_type, pi.created_at`,
      [req.params.id]
    );
    res.json({
      payment_request_id: pr.id,
      request_no: pr.request_no,
      payment_mode: pr.payment_mode,
      payee_key: pr.payee_key,
      payee_name_snapshot: pr.payee_name_snapshot,
      currency: pr.currency,
      items: rows.rows
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.put('/api/payment-requests/:id/expense-country', requireApiPermission('payment_approve'), asyncHandler((req, res) => {
  try {
    const payment = queryOne('SELECT * FROM payment_requests WHERE id = ?', [req.params.id]);
    if (!payment) return res.status(404).json({ error: '付款申请不存在' });
    if (payment.payment_category === 'goods') return res.status(409).json({ error: '货款付款申请不需要补录费用归属国家' });
    const country = activeExpenseCountry(req.body.expense_country);
    const existing = String(payment.expense_country || '').trim();
    if (existing && existing !== country) {
      return res.status(409).json({ error: `费用归属国家已快照为“${existing}”，不能直接修改` });
    }
    if (!existing) {
      run("UPDATE payment_requests SET expense_country = ?, updated_at = datetime('now') WHERE id = ?", [country, payment.id]);
    }
    res.json({ success: true, expense_country: existing || country, idempotent: Boolean(existing) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// 付款申请附件上传（attachment 列：JSON 结构，与 PI/CI 附件同机制）
app.post('/api/payment-requests/:id/attachment', requireApiPermission('payment_create', 'payment_approve'), asyncHandler((req, res) => {
  try {
    const pr = queryOne('SELECT id FROM payment_requests WHERE id = ?', [req.params.id]);
    if (!pr) return res.status(404).json({ error: '付款申请不存在' });
    run('UPDATE payment_requests SET attachment = ?, updated_at = datetime(\'now\') WHERE id = ?', [parseAttachment(req.body.attachment), req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 生成付款申请（从PI定金）— 货款/定金
app.post('/api/payment-requests/from-pi-deposit', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  try {
    const { pi_id, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no } = req.body;
    const pi = await queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [pi_id]);
    if (!pi) return res.status(400).json({ error: 'PI不存在' });
    if (!pi.need_deposit || (pi.payable_deposit || 0) <= 0) {
      return res.status(400).json({ error: '该PI不需要定金，无需发起定金付款审批' });
    }
    if (await existingActiveGoodsPayment('pi', pi_id, 'deposit')) {
      return res.status(409).json({ error: '该 PI 已存在有效的定金付款申请，不能重复生成' });
    }

    const payableAmount = pi.payable_deposit || 0;
    const deductionEnabled = Number(has_deduction) === 1;
    const dedAmount = deductionEnabled ? settlementMoney(deduction_amount) : 0;
    if (!Number.isFinite(dedAmount) || dedAmount < 0) return res.status(400).json({ error: '抵扣金额不能小于0' });
    if (deductionEnabled && dedAmount > 0) {
      if (dedAmount > payableAmount) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    const actualPay = settlementMoney(payableAmount - dedAmount);

    const prId = await genId('pay');
    const prNo = `PAY-DEP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    // PAY-CORE Phase 1.5 Task 2：派生 payee_key/payee_name_snapshot（格式 ${payee_type}:${identity}，与 payable_items 一致）
    const payeeKey = `supplier:${pi.supplier_id || pi.supplier_name}`;
    const payeeNameSnapshot = pi.supplier_name || '';
    await transaction(async () => {
      await run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, payee_key, payee_name_snapshot, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_terms, payment_status, approval_status, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, actual_pay_amount, related_po_no, expense_country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [prId, prNo, 'goods', 'deposit', 'pi', pi_id, pi.pi_no, 'factory', payeeKey, payeeNameSnapshot, pi.supplier_name, payableAmount, 0, actualPay, pi.currency || 'USD', pi.payment_terms || '', 'pending_approval', 'pending', `PI定金 ${pi.pi_no}`, deductionEnabled ? 1 : 0, dedAmount, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', actualPay, pi.related_po_no || '', String(pi.country || '').trim()]);
      if (deductionEnabled && dedAmount > 0) await recordInitialDeduction(prId, dedAmount, deduction_source_desc, await settlementOperator(req));
      await run('UPDATE proforma_invoices SET deposit_payment_status = ? WHERE id = ?', ['pending_approval', pi_id]);
      // PAY-CORE Phase 2：关联 payable_item 并 reserve（V2.1 第 8 节）
      linkSinglePayableItem(prId, 'pi', pi_id, 'deposit', pi.currency || 'USD', payeeKey);
    });
    // PAY-CORE Phase 2：创建后自动提交审批
    let approvalInfo = {};
    try {
      const createdPayment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [prId]);
      const apprResult = await createApprovalInstance(prId, createdPayment, req);
      approvalInfo = { approval_id: apprResult.approvalId, auto_submitted: true };
    } catch (apprErr) {
      approvalInfo = { auto_submit_failed: true, approval_error: apprErr.message };
    }
    res.json({ id: prId, request_no: prNo, payable_amount: payableAmount, actual_pay_amount: actualPay, ...approvalInfo });
  } catch (e) {
    if (isActiveGoodsPaymentUniqueError(e)) return res.status(409).json({ error: '该 PI 已存在有效的定金付款申请，不能重复生成' });
    res.status(500).json({ error: e.message });
  }
}));

// 生成付款申请（从CI尾款）— 货款/尾款
app.post('/api/payment-requests/from-ci-balance', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  try {
    const { ci_id, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no } = req.body;
    const ci = await queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });

    // 一、未付金额校验：优先使用 unpaid_balance，否则用 payable_balance - paid_balance
    const unpaidBalance =
      ci.unpaid_balance !== null &&
      ci.unpaid_balance !== undefined &&
      Number.isFinite(Number(ci.unpaid_balance))
        ? Number(ci.unpaid_balance)
        : Math.max(
            0,
            Number(ci.payable_balance || 0) -
            Number(ci.paid_balance || 0)
          );
    if (unpaidBalance <= 0) {
      return res.status(409).json({ error: '该 CI 已无待付尾款，不能重复生成尾款申请' });
    }

    // 二、有效尾款防重：仅「仍在审批/付款流程中、未发生付款确认」的 PR 阻止新建（PAY-CORE 多次付款）
    const existingBalance = await queryOne(
      `SELECT id, request_no, payment_status FROM payment_requests
       WHERE payment_subcategory = 'balance'
         AND payment_status IN (${BLOCKING_GOODS_PR_STATUSES.map(() => '?').join(',')})
         AND ((source_type = 'ci' AND source_id = ?) OR related_ci_id = ?)`,
      [...BLOCKING_GOODS_PR_STATUSES, ci_id, ci_id]
    );
    if (existingBalance) {
      return res.status(409).json({ error: '该 CI 已存在有效的尾款付款申请，不能重复生成' });
    }

    const deductionEnabled = Number(has_deduction) === 1;
    const dedAmount = deductionEnabled ? settlementMoney(deduction_amount) : 0;
    if (!Number.isFinite(dedAmount) || dedAmount < 0) return res.status(400).json({ error: '抵扣金额不能小于0' });
    if (deductionEnabled && dedAmount > 0) {
      if (dedAmount > unpaidBalance) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    const actualPay = settlementMoney(unpaidBalance - dedAmount);
    // PAY-CREDIT-DUE-01（修复）：优先使用 CI 已有的 due_date，否则按出货日+Credit天数推算
    const balancePayableDate = resolvePayableDate({ dueDate: ci.due_date, creditDays: ci.credit_days, baseDate: ci.actual_ship_date });

    const prId = await genId('pay');
    const prNo = `PAY-BAL-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    // PAY-CORE Phase 1.5 Task 2：派生 payee_key/payee_name_snapshot（格式 ${payee_type}:${identity}，与 payable_items 一致）
    const payeeKey = `supplier:${ci.supplier_id || ci.supplier_name}`;
    const payeeNameSnapshot = ci.supplier_name || '';

    // 三、INSERT 付款申请 + 更新 CI 状态，必须处于同一事务（任一步失败整体回滚）
    await transaction(async () => {
      await run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, payee_key, payee_name_snapshot, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_terms, payable_date, payment_status, approval_status, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, actual_pay_amount, related_ci_id, related_ci_no, related_po_no, expense_country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [prId, prNo, 'goods', 'balance', 'ci', ci_id, ci.ci_no, 'factory', payeeKey, payeeNameSnapshot, ci.supplier_name, unpaidBalance, 0, actualPay, ci.currency || 'USD', '', balancePayableDate, 'pending_approval', 'pending', `CI尾款 ${ci.ci_no}`, deductionEnabled ? 1 : 0, dedAmount, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', actualPay, ci_id, ci.ci_no, ci.related_po_no || '', String(ci.country || '').trim()]);
      if (deductionEnabled && dedAmount > 0) await recordInitialDeduction(prId, dedAmount, deduction_source_desc, await settlementOperator(req));
      await run('UPDATE commercial_invoices SET balance_payment_status = ? WHERE id = ?', ['pending_approval', ci_id]);
      // PAY-CORE Phase 2：关联 payable_item 并 reserve（V2.1 第 8 节）
      // 多 PI 改造：先查存量 CI 级 balance payable_item（source_type='ci'），再查 per-PI（source_type='pi', source_ci_id）
      let linkedItem = linkSinglePayableItem(prId, 'ci', ci_id, 'balance', ci.currency || 'USD', payeeKey);
      if (!linkedItem) {
        // 新建 CI 使用 per-PI balance payable_item
        const piBalanceItems = query(
          `SELECT * FROM payable_items
           WHERE source_type = 'pi' AND source_ci_id = ? AND fee_type = 'balance'
             AND lifecycle_status IN ('active', 'partially_paid')`,
          [ci_id]
        ).rows;
        if (piBalanceItems.length === 1) {
          // 单 PI CI — 自动关联（PAY-CORE 多次付款：仅关联剩余金额）
          const payableItem = piBalanceItems[0];
          if (String(payableItem.currency || '').toUpperCase() !== String(ci.currency || 'USD').toUpperCase()) {
            throw new SettlementError(409, `应付费用币种 ${payableItem.currency} 与付款申请币种 ${ci.currency} 不一致，无法关联`);
          }
          if (String(payableItem.payee_key || '') !== String(payeeKey || '')) {
            throw new SettlementError(409, `应付费用收款方 ${payableItem.payee_key} 与付款申请收款方 ${payeeKey} 不一致，无法关联`);
          }
          const payableMinor = Number(payableItem.payable_amount_minor || 0);
          const settledMinor = payableItemsSettledMinor([payableItem.id]).get(payableItem.id) || 0;
          const remainingMinor = payableMinor - settledMinor;
          if (remainingMinor <= 0) {
            throw new SettlementError(409, `应付费用 ${payableItem.fee_no} 已付清（剩余 ${minorToAmount(remainingMinor)}），无需再次付款`);
          }
          run(
            `INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor) VALUES (?, ?, ?, ?)`,
            [genId('pri'), prId, payableItem.id, remainingMinor]
          );
          if (!reservePayableItem(payableItem.id, prId)) {
            throw new SettlementError(409, `应付费用 ${payableItem.fee_no} 状态已变更，无法锁定`);
          }
        } else if (piBalanceItems.length > 1) {
          // 多 PI CI — 提示使用合并付款
          throw new SettlementError(409, `该CI关联多个PI尾款(${piBalanceItems.length}个)，请使用合并付款功能选择具体PI尾款`);
        }
        // 0 条 → 历史兼容（跳过，不创建 items）
      }
    });
    // PAY-CORE Phase 2：创建后自动提交审批
    let approvalInfo = {};
    try {
      const createdPayment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [prId]);
      const apprResult = await createApprovalInstance(prId, createdPayment, req);
      approvalInfo = { approval_id: apprResult.approvalId, auto_submitted: true };
    } catch (apprErr) {
      approvalInfo = { auto_submit_failed: true, approval_error: apprErr.message };
    }
    res.json({ id: prId, request_no: prNo, payable_amount: unpaidBalance, actual_pay_amount: actualPay, ...approvalInfo });
  } catch (e) {
    if (isActiveGoodsPaymentUniqueError(e)) return res.status(409).json({ error: '该 CI 已存在有效的尾款付款申请，不能重复生成' });
    res.status(500).json({ error: e.message });
  }
}));

// ===== PAY-CORE Phase 1.5 Task 2：多费用付款申请创建 =====
// 业务规则：
//   1) 一个 payment_request 只能包含一个 payee_key（多费用但同收款方）
//   2) 允许同收款方的多个 payable_items 合并申请，允许多币种
//   3) payment_mode='multi'，currency='MULTI'（仅作展示标记，不自动换算）
//   4) payment_category/payment_subcategory 留空，费用性质通过 items → payable_items 派生
//   5) requested_amount_minor = payable_items 的剩余未付金额（应付 - 已付 - 已抵扣 - 已抹零），支持同一费用多次付款
//   6) 创建时立即 reserve payable_items（active / partially_paid → reserved）
//   7) reject 时由 Task 2.B.5 释放（reserved → active）
//   8) PAY-CORE Phase 2：所有 payable_items 必须同币种，currency 写入真实币种（不再 'MULTI'）
app.post('/api/payment-requests/multi-expense', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  try {
    const { payable_item_ids, remark } = req.body || {};
    // 1. 入参校验
    if (!Array.isArray(payable_item_ids) || payable_item_ids.length === 0) {
      return res.status(400).json({ error: '请至少选择一项应付费用' });
    }
    // 2. 查询所有 payable_items
    const placeholders = payable_item_ids.map(() => '?').join(',');
    const items = await query(
      `SELECT id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, category_code, subcategory_code,
              payee_type, payee_key, payee_name_snapshot, currency, payable_amount_minor, lifecycle_status
       FROM payable_items WHERE id IN (${placeholders})`,
      payable_item_ids
    );
    if (items.rows.length !== payable_item_ids.length) {
      const found = new Set(items.rows.map(r => r.id));
      const missing = payable_item_ids.filter(id => !found.has(id));
      return res.status(404).json({ error: `应付费用不存在: ${missing.join(', ')}` });
    }
    // 3. 校验所有 lifecycle_status 可申请（active 待处理 / partially_paid 部分已付、仍有剩余）
    const creatableStatuses = new Set(['active', 'partially_paid']);
    const nonActive = items.rows.filter(r => !creatableStatuses.has(r.lifecycle_status));
    if (nonActive.length > 0) {
      return res.status(409).json({ error: `所选费用中存在非待付状态，无法合并申请: ${nonActive.map(r => r.fee_no).join(', ')}` });
    }
    // PAY-CORE 多次付款：本次可申请金额 = 应付金额 - 已结算金额（已付 + 已抵扣 + 已抹零）
    const settledMap = payableItemsSettledMinor(items.rows.map(r => r.id));
    const remainingByItem = new Map();
    const exhausted = [];
    for (const r of items.rows) {
      const remainingMinor = Number(r.payable_amount_minor || 0) - (settledMap.get(r.id) || 0);
      if (remainingMinor <= 0) exhausted.push(r.fee_no);
      remainingByItem.set(r.id, remainingMinor);
    }
    if (exhausted.length > 0) {
      return res.status(409).json({ error: `所选费用已无剩余未付金额，无法再次申请: ${exhausted.join(', ')}` });
    }
    // 4. 校验所有 payee_key 一致（业务规则 1）
    const payeeKeys = new Set(items.rows.map(r => r.payee_key));
    if (payeeKeys.size > 1) {
      return res.status(409).json({ error: '所选费用收款方不一致，无法合并申请' });
    }
    // 5. PAY-CORE Phase 2：校验所有 currency 一致（V2.1 第 4 节，不再使用 'MULTI'）
    const currencies = new Set(items.rows.map(r => String(r.currency || '').toUpperCase()));
    if (currencies.size > 1) {
      return res.status(409).json({ error: '所选费用币种不一致，无法合并申请' });
    }
    const prCurrency = items.rows[0].currency || 'USD';
    // P0：multi PR 必须从所有来源单据取得同一国家并写入主表快照。
    // 缺失、来源不存在/不支持或多国家混合均在建单事务前拒绝，不锁定 payable_items。
    const expenseCountrySnapshot = commonPayableItemsExpenseCountry(items.rows);
    // 6. 派生字段
    const firstItem = items.rows[0];
    const payeeKey = firstItem.payee_key;
    const payeeNameSnapshot = firstItem.payee_name_snapshot || '';
    const payeeType = firstItem.payee_type || 'factory';
    // PAY-CORE 多次付款：申请金额按剩余未付金额汇总，避免第二次申请重复申请全额
    const totalAmountMinor = items.rows.reduce((s, r) => s + (remainingByItem.get(r.id) || 0), 0);
    const totalAmount = minorToAmount(totalAmountMinor); // 仅作展示参考，不作为审批/付款依据
    const itemCount = items.rows.length;
    // PAY-MULTI category 推导（创建逻辑修复）：合并来源全部为货款(pi/ci/historical_ci)时标记为 goods，
    // 审批时自动跳过付款日 realtime 汇率校验；含非货款来源时保持 ''（仍走付款日汇率校验，符合非货款费用要求）。
    // historical_ci 为 CI 历史形态，本质仍属 CI 货款，需纳入 goods 判定，否则会误判为 non-goods 触发汇率校验。
    const _goodsSources = new Set(['pi', 'ci', 'historical_ci']);
    const _allGoods = items.rows.length > 0 && items.rows.every(r => _goodsSources.has(String(r.source_type || '').toLowerCase()));
    const prCategory = _allGoods ? 'goods' : '';
    const prSubcategory = _allGoods
      ? (items.rows.every(r => String(r.fee_type || '') === 'deposit') ? 'deposit' : 'balance')
      : '';
    // 7. 事务内：INSERT payment_requests + INSERT payment_request_items + reserve payable_items
    const prId = await genId('pay');
    const prNo = `PAY-MULTI-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    await transaction(async () => {
      await run(
        `INSERT INTO payment_requests
           (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no,
           payee_type, payee_key, payee_name_snapshot, supplier_name,
            payable_amount, paid_amount, unpaid_amount, currency,
            payment_mode, payment_status, approval_status, remark, expense_country)
         VALUES (?, ?, ?, ?, '', '', '',
                 ?, ?, ?, ?,
                 ?, 0, ?, ?,
                 'multi', 'pending_approval', 'pending', ?, ?)`,
        [prId, prNo, prCategory, prSubcategory, payeeType, payeeKey, payeeNameSnapshot, payeeNameSnapshot,
         totalAmount, totalAmount, prCurrency,
         remark || '', expenseCountrySnapshot]
      );
      // 循环 INSERT payment_request_items（requested_amount_minor = 本项剩余未付金额）
      for (const item of items.rows) {
        await run(
          `INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor)
           VALUES (?, ?, ?, ?)`,
          [await genId('pri'), prId, item.id, remainingByItem.get(item.id) || 0]
        );
      }
      // 循环 reserve payable_items（业务规则 6：创建时立即 reserve）
      for (const item of items.rows) {
        const reserved = reservePayableItem(item.id, prId);
        if (!reserved) {
          // 状态被并发修改（active → 其他），触发事务回滚
          throw new Error(`应付费用 ${item.fee_no} 状态已变更，无法锁定`);
        }
      }
      // LOGISTICS-COST-LINK-V2：回写 ci_cost_items.payment_request_id，桥接成本流→资金流
      // 物流单生成成本时 ci_cost_items.payment_request_id 为空，付款申请创建后补填
      // 后续 syncPaymentSource 通过 payment_request_id 回写 paid_amount
      for (const item of items.rows) {
        await run(
          `UPDATE ci_cost_items SET payment_request_id = ?, request_no = ? WHERE payable_item_id = ? AND (payment_request_id = '' OR payment_request_id IS NULL)`,
          [prId, prNo, item.id]
        );
      }
      // PAY-CORE P0-2：同步所有来源 PI 的 deposit_payment_status → pending_approval
      // multi PR 不依赖 payment_requests.source_id，通过 payable_items.source_type/source_id 反查
      syncMultiSourcePiStatus(items.rows, 'pending_approval');
    });
    // PAY-CORE Phase 2：创建后自动提交审批
    let approvalInfo = {};
    try {
      const createdPayment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [prId]);
      const apprResult = await createApprovalInstance(prId, createdPayment, req);
      approvalInfo = { approval_id: apprResult.approvalId, auto_submitted: true };
    } catch (apprErr) {
      approvalInfo = { auto_submit_failed: true, approval_error: apprErr.message };
    }
    res.json({ id: prId, request_no: prNo, payment_mode: 'multi', currency: prCurrency, item_count: itemCount, payable_amount: totalAmount, ...approvalInfo });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}));

// PAY-CORE P0-3：通过 payable_item_ids 反查关联的付款申请
// 查询规则：
// 1. 默认只返回当前有效 PR（排除 cancelled/rejected 历史），避免前端误跳旧 PR
// 2. include_history=true 时返回全部历史记录（含 cancelled/rejected）
// 3. 多个 payable_items 同属一个 PR → 去重返回一条
// 4. 分属多个 PR → 返回多条
// 5. 未关联任何 PR → 返回空数组，不报错
// [2026-08-01] 此路由（/api/payment-requests/by-payable-items）已上移至 /api/payment-requests/:id 通用动态路由之前注册，
// 以修复被 :id 抢先匹配导致 404「付款申请不存在」的问题。请勿将其移回 :id 之后。

// PAY-CORE P0-3：批量撤回付款申请（仅 pending 审批 + 无 payment_transactions + 无有效 settlement_logs 可撤回）
// 付款日汇率解析 — 前端选择 actual_paid_date 后调用，解析并缓存汇率
// 货款付款跳过；非货款费用按 exact-date 规则解析，missing 时不 fallback
// 权限与 confirm-paid 一致：payment_approve / payment_execute 任一即可
app.post('/api/payment-requests/:id/payment-fx/resolve', requireApiPermission('payment_approve', 'payment_execute'), asyncHandler(async (req, res) => {
  var rateDate = String((req.body || {}).rate_date || '').trim();
  if (!rateDate) return res.status(400).json({ error: '缺少 rate_date' });
  if (!isValidRateDate(rateDate)) return res.status(400).json({ error: 'rate_date 格式无效，必须为 YYYY-MM-DD' });
  var payment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [req.params.id]);
  if (!payment) return res.status(404).json({ error: '付款申请不存在' });
  if (payment.payment_category === 'goods') {
    return res.json({ skip: true, reason: 'goods_payment' });
  }
  try {
    var country = resolveSettlementCountry(payment);
    var originalCurrency = String(payment.currency || '').trim();
    if (!originalCurrency) return res.status(400).json({ error: '付款申请未配置原币币种' });
    var localResult = await resolvePaymentFxRate({ fromCurrency: originalCurrency, toCurrency: country.currency, rateDate: rateDate });
    var rmbResult = { rate: 1, source: 'identity' };
    if (originalCurrency !== 'RMB') {
      rmbResult = await resolvePaymentFxRate({ fromCurrency: originalCurrency, toCurrency: 'RMB', rateDate: rateDate });
    }
    var originalAmount = Number(payment.payable_amount) || 0;
    res.json({
      rate: localResult.rate,
      rate_date: localResult.rate_date,
      source: localResult.source,
      direction: localResult.direction,
      local_currency: country.currency,
      local_amount: Math.round(originalAmount * localResult.rate * 100) / 100,
      rmb_rate: rmbResult.rate,
      rmb_source: rmbResult.source,
      original_currency: originalCurrency,
      original_amount: originalAmount
    });
  } catch (e) {
    if (e.name === 'SettlementError') {
      return res.status(400).json({ error: e.message, blocker: true });
    }
    throw e;
  }
}));

// 撤回事务内严格顺序：校验 → 释放 payable_items → 更新 PR → 更新 approval_records → 恢复 PI
// payment_request_items 保留（不删除），cancelled PR 仍可查看原关联费用
app.post('/api/payment-requests/batch-cancel', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  try {
    const { payable_item_ids } = req.body;
    if (!Array.isArray(payable_item_ids) || payable_item_ids.length === 0) {
      return res.status(400).json({ error: '请选择需要撤回的应付费用' });
    }
    const operatorId = (req.currentUserId || req.user && req.user.id) || '';
    const operatorName = (req.user && req.user.name) || '';

    const results = [];
    const skipped = [];
    const errors = [];

    await transaction(async () => {
      // P0-FIX-4：输入完整性校验 - 检查所有 payable_item_ids 是否存在
      const itemPlaceholders = payable_item_ids.map(() => '?').join(',');
      const existRows = query(
        `SELECT id FROM payable_items WHERE id IN (${itemPlaceholders})`,
        payable_item_ids
      ).rows;
      const existIds = new Set(existRows.map(r => r.id));
      const notExistIds = payable_item_ids.filter(id => !existIds.has(id));
      if (notExistIds.length > 0) {
        const err = new Error('以下应付费用不存在：' + notExistIds.join(', '));
        err.status = 400;
        throw err;
      }

      // 1. 通过 payable_item_ids 反查关联的 payment_request_ids（去重）
      const prRows = query(
        `SELECT DISTINCT pri.payment_request_id AS pr_id, pr.request_no, pr.payment_status, pr.approval_status, pr.payment_mode, pr.source_type, pr.source_id
         FROM payment_request_items pri
         JOIN payment_requests pr ON pr.id = pri.payment_request_id
         WHERE pri.payable_item_id IN (${itemPlaceholders})`,
        payable_item_ids
      ).rows;

      // P0-FIX-4：检查未关联 PR 的 payable_item_ids
      const linkedItemIds = new Set();
      const allPriRows = query(
        `SELECT DISTINCT payable_item_id FROM payment_request_items WHERE payable_item_id IN (${itemPlaceholders})`,
        payable_item_ids
      ).rows;
      allPriRows.forEach(r => linkedItemIds.add(r.payable_item_id));
      const unlinkedIds = payable_item_ids.filter(id => !linkedItemIds.has(id));
      if (unlinkedIds.length > 0) {
        const err = new Error('以下应付费用未关联任何付款申请：' + unlinkedIds.join(', '));
        err.status = 400;
        throw err;
      }

      if (prRows.length === 0) {
        const err = new Error('所选应付费用未关联任何付款申请');
        err.status = 400;
        throw err;
      }

      // 2. 先校验所有 PR 状态，不通过的分为 skipped（幂等跳过）和 validationErrors（不可撤回）
      // PAY-CORE P0-3：严格事务一致性，不允许部分成功
      const validationErrors = [];
      for (const prRow of prRows) {
        const prId = prRow.pr_id;
        // 状态校验：仅 pending_approval + pending 可撤回
        if (prRow.payment_status !== 'pending_approval' || prRow.approval_status !== 'pending') {
          // cancelled 状态幂等处理：已撤回的 PR 跳过，不触发整批失败
          if (prRow.payment_status === 'cancelled' && prRow.approval_status === 'cancelled') {
            skipped.push({
              pr_id: prId,
              request_no: prRow.request_no,
              reason: '该付款申请已撤回，无需重复操作'
            });
          } else {
            validationErrors.push({
              pr_id: prId,
              request_no: prRow.request_no,
              error: `付款申请状态不允许撤回（payment_status=${prRow.payment_status}, approval_status=${prRow.approval_status}）`
            });
          }
          continue;
        }
        // PAY-CORE P0-3：校验是否存在 payment_transactions（已付款不得撤回）
        const txCount = queryOne(
          `SELECT COUNT(*) AS cnt FROM payment_transactions WHERE payment_request_id = ? AND trans_status != 'cancelled'`,
          [prId]
        );
        if (txCount && txCount.cnt > 0) {
          validationErrors.push({
            pr_id: prId,
            request_no: prRow.request_no,
            error: `付款申请已存在付款记录（${txCount.cnt} 条），不得撤回`
          });
          continue;
        }
        // PAY-CORE P0-3：校验是否存在有效 payment_settlement_logs
        // schema CHECK (status IN ('applied','reversed'))，有效状态为 applied（reversed 为冲销后无效）
        const slCount = queryOne(
          `SELECT COUNT(*) AS cnt FROM payment_settlement_logs WHERE payment_request_id = ? AND status = 'applied'`,
          [prId]
        );
        if (slCount && slCount.cnt > 0) {
          validationErrors.push({
            pr_id: prId,
            request_no: prRow.request_no,
            error: `付款申请已存在有效付款结算记录（${slCount.cnt} 条），不得撤回`
          });
          continue;
        }
      }

      // 存在校验错误 → 整体失败，不允许部分撤回
      if (validationErrors.length > 0) {
        // 抛出错误触发事务回滚
        const err = new Error('部分付款申请状态不允许撤回，已整体回滚');
        err.status = 409;
        err.details = validationErrors;
        throw err;
      }

      // 3. 全部校验通过，逐个执行撤回
      for (const prRow of prRows) {
        const prId = prRow.pr_id;

        // 3.1 释放关联的 payable_items（reserved → active）
        // releasePayableItemsByPR 内部仅将 lifecycle_status='reserved' 的改为 active，
        // 不会误释放已被其他 PR 占用的费用（因为其他 PR 占用时状态为 reserved，而非本 PR 关联）
        releasePayableItemsByPR(prId);

        // 3.2 PAY-CORE P0-3：保留 payment_request_items，不删除
        // cancelled PR 仍可通过 payment_request_items 查看原关联费用，保证审计完整

        // 3.3 更新 payment_requests 状态为 cancelled
        run(`UPDATE payment_requests SET payment_status = 'cancelled', approval_status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [prId]);

        // 3.4 更新 approval_records：仅 pending 状态改为 withdrawn，已完成审批记录不得覆盖
        run(`UPDATE approval_records SET status = 'withdrawn', updated_at = datetime('now') WHERE business_id = ? AND status = 'pending'`, [prId]);

        // 3.5 恢复来源 PI 状态
        // single 模式：直接用 pr.source_id
        if (prRow.payment_mode === 'single' && prRow.source_type === 'pi' && prRow.source_id) {
          run(`UPDATE proforma_invoices SET deposit_payment_status = 'unpaid', updated_at = datetime('now') WHERE id = ? AND deposit_payment_status = 'pending_approval'`, [prRow.source_id]);
        }
        // multi 模式：通过 payment_request_items → payable_items 反查所有来源 PI
        if (prRow.payment_mode === 'multi') {
          const payableRows = query(
            `SELECT payit.source_type, payit.source_id, payit.fee_type
             FROM payment_request_items pri
             JOIN payable_items payit ON payit.id = pri.payable_item_id
             WHERE pri.payment_request_id = ?`,
            [prId]
          ).rows;
          // 仅恢复 pending_approval 状态的 PI，避免误覆盖已完成的 PI
          syncMultiSourcePiStatus(payableRows, 'unpaid', 'pending_approval');
        }

        results.push({
          pr_id: prId,
          request_no: prRow.request_no,
          status: 'cancelled'
        });
      }
    });

    res.json({
      success: true,
      cancelled: results,
      cancelled_count: results.length,
      skipped: skipped,
      skipped_count: skipped.length
    });
  } catch (e) {
    // 事务回滚后返回错误详情
    const status = e.status || 500;
    const body = { error: e.message };
    if (e.details) body.details = e.details;
    res.status(status).json(body);
  }
}));

// LOGISTICS-COST-LINK-V2：从物流单费用生成 ci_cost_items（成本事实）+ payable_items（应付费用）
// 成本流：logistics_batches → ci_cost_items（payable_amount，供 WAC 读取）
// 资金流：payable_items → payment_request（人工提交）→ payment_settlement_logs → ci_cost_items.paid_amount 回写
// 两条流独立，互不阻塞
// NOTE: 内部实现已统一调用 syncLogisticsCostFactsCore，与 PUT /api/logistics-batches/:id 共享同一逻辑。
//       不再有第二套 INSERT 逻辑。保留此端点用于"生成成本记录"按钮及 admin repair。
app.post('/api/logistics-batches/:id/generate-cost-items', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  try {
    const batch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [req.params.id]);
    if (!batch) return res.status(404).json({ error: '物流批次不存在' });

    if (!batch.related_ci_id) return res.status(400).json({ error: '该物流批次未关联CI，无法生成成本记录' });

    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [batch.related_ci_id]);
    if (!ci) return res.status(400).json({ error: '关联CI不存在' });

    if (ci.cost_confirmed) return res.status(409).json({ error: '该CI费用已确认，不能继续新增费用' });

    const { payee_name } = req.body;
    const createdBy = (req.currentUserId || (req.user && req.user.id)) || '';

    const syncResult = await transaction(async () => {
      return syncLogisticsCostFactsCore(batch, {
        createdBy: createdBy,
        payeeName: payee_name || ''
      });
    });

    const generated = (syncResult && syncResult.synced) || [];
    if (generated.length === 0) {
      return res.json({ generated: [], batch_no: batch.batch_no, ci_no: ci.ci_no, message: '物流单费用均为0，无需生成成本记录' });
    }
    res.json({ generated, batch_no: batch.batch_no, ci_no: ci.ci_no });
  } catch (e) {
    if (e.status) res.status(e.status).json({ error: e.message, code: e.code || '', detail: e.detail || {} });
    else res.status(500).json({ error: e.message });
  }
}));

// 生成付款申请（到仓费用）— 可关联CI
app.post('/api/payment-requests/warehouse-arrival', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  try {
    const { ci_id, subcategory, payee_name, payable_amount, currency, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, include_in_landing_cost, expense_country } = req.body;
    if (!payable_amount || payable_amount <= 0) return res.status(400).json({ error: '应付金额必须大于0' });
    const validSubs = ['freight', 'customs_clearance', 'port_charges', 'delivery', 'warehouse', 'other_local'];
    if (!validSubs.includes(subcategory)) return res.status(400).json({ error: '无效的到仓费用小类' });

    const deductionEnabled = Number(has_deduction) === 1;
    const dedAmount = deductionEnabled ? settlementMoney(deduction_amount) : 0;
    if (!Number.isFinite(dedAmount) || dedAmount < 0) return res.status(400).json({ error: '抵扣金额不能小于0' });
    if (deductionEnabled && dedAmount > 0) {
      if (dedAmount > payable_amount) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    const actualPay = settlementMoney(Number(payable_amount) - dedAmount);

    let ci = null, ciNo = '', poNo = '';
    if (ci_id) {
      ci = await queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]);
      if (!ci) return res.status(400).json({ error: 'CI不存在' });
      if (ci.cost_confirmed) return res.status(409).json({ error: '该CI费用已确认，不能继续新增计入落地成本的到仓费用' });
      ciNo = ci.ci_no;
      poNo = ci.related_po_no || '';
    }
    const expenseCountrySnapshot = ci
      ? sourceExpenseCountry(ci.country, `CI“${ci.ci_no}”`)
      : await activeExpenseCountry(expense_country);

    const prId = await genId('pay');
    const prNo = `PAY-WAR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    // PAY-CORE Phase 1.5 Task 2：派生 payee_key/payee_name_snapshot（格式 ${payee_type}:${identity}，与 payable_items 一致）
    const payeeKey = `service_provider:${payee_name || ''}`;
    const payeeNameSnapshot = payee_name || '';
    // P2-8 守卫：同 CI + 同 category + 同 subcategory 的 active payment_request 防重（仅 ci_id 存在时校验，保留无 CI 来源的手工非货款录入场景；rejected/cancelled 不阻挡）
    if (ci_id) {
      const existingWarehouseArrival = await queryOne(
        `SELECT id, request_no FROM payment_requests
         WHERE payment_category = 'warehouse_arrival' AND payment_subcategory = ?
           AND approval_status != 'rejected'
           AND payment_status NOT IN ('rejected', 'cancelled')
           AND ((source_type = 'ci' AND source_id = ?) OR related_ci_id = ?)`,
        [subcategory, ci_id, ci_id]
      );
      if (existingWarehouseArrival) return res.status(409).json({ error: '该CI已存在有效的到仓费用付款申请（' + subcategory + '），不能重复生成' });
    }
    await transaction(async () => {
      await run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, payee_key, payee_name_snapshot, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_status, approval_status, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, actual_pay_amount, related_ci_id, related_ci_no, related_po_no, include_in_landing_cost, expense_country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [prId, prNo, 'warehouse_arrival', subcategory, ci_id ? 'ci' : 'manual', ci_id || '', ciNo, 'service_provider', payeeKey, payeeNameSnapshot, payee_name || '', payable_amount, 0, actualPay, currency || 'USD', 'pending_approval', 'pending', remark || '', deductionEnabled ? 1 : 0, dedAmount, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', actualPay, ci_id || '', ciNo, poNo, include_in_landing_cost === false ? 0 : 1, expenseCountrySnapshot]);
      if (deductionEnabled && dedAmount > 0) await recordInitialDeduction(prId, dedAmount, deduction_source_desc, await settlementOperator(req));
      // 如果关联了CI，同时创建 ci_cost_items 记录
      if (ci) {
        await run(`INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [await genId('cci'), ci_id, ciNo, prId, prNo, 'warehouse_arrival', subcategory, payable_amount, 0, include_in_landing_cost === false ? 0 : 1, payee_name || '', currency || 'USD', remark || '']);
      }
    });

    // PAY-CORE Phase 2：创建后自动提交审批
    let approvalInfo = {};
    try {
      const createdPayment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [prId]);
      const apprResult = await createApprovalInstance(prId, createdPayment, req);
      approvalInfo = { approval_id: apprResult.approvalId, auto_submitted: true };
    } catch (apprErr) {
      approvalInfo = { auto_submit_failed: true, approval_error: apprErr.message };
    }
    res.json({ id: prId, request_no: prNo, actual_pay_amount: actualPay, ...approvalInfo });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// 生成付款申请（关税）— 只有CI选择"有关税"时才允许
app.post('/api/payment-requests/customs-duty', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  try {
    const { ci_id, payee_name, payable_amount, currency, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no } = req.body;
    if (!ci_id) return res.status(400).json({ error: '关税付款必须关联CI' });
    const ci = await queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });
    if (ci.cost_confirmed) return res.status(409).json({ error: '该CI费用已确认，不能继续新增Import Duty' });
    if (!ci.has_customs_duty) return res.status(400).json({ error: '该CI未标记为有关税，无法创建关税付款申请' });
    if (!payable_amount || payable_amount <= 0) return res.status(400).json({ error: '应付金额必须大于0' });
    const expenseCountrySnapshot = sourceExpenseCountry(ci.country, `CI“${ci.ci_no}”`);

    const deductionEnabled = Number(has_deduction) === 1;
    const dedAmount = deductionEnabled ? settlementMoney(deduction_amount) : 0;
    if (!Number.isFinite(dedAmount) || dedAmount < 0) return res.status(400).json({ error: '抵扣金额不能小于0' });
    if (deductionEnabled && dedAmount > 0) {
      if (dedAmount > payable_amount) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    const actualPay = settlementMoney(Number(payable_amount) - dedAmount);

    const prId = await genId('pay');
    const prNo = `PAY-DUT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    // PAY-CORE Phase 1.5 Task 2：派生 payee_key/payee_name_snapshot（格式 ${payee_type}:${identity}，与 payable_items 一致）
    const payeeKey = `customs:${payee_name || ''}`;
    const payeeNameSnapshot = payee_name || '';
    // P2-8 守卫：同 CI + 同 category + 同 subcategory 的 active payment_request 防重（rejected/cancelled 不阻挡）
    const existingDuty = await queryOne(
      `SELECT id, request_no FROM payment_requests
       WHERE payment_category = 'customs_duty' AND payment_subcategory = 'duty'
         AND approval_status != 'rejected'
         AND payment_status NOT IN ('rejected', 'cancelled')
         AND ((source_type = 'ci' AND source_id = ?) OR related_ci_id = ?)`,
      [ci_id, ci_id]
    );
    if (existingDuty) return res.status(409).json({ error: '该CI已存在有效的Import Duty付款申请，不能重复生成' });
    await transaction(async () => {
      await run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, payee_key, payee_name_snapshot, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_status, approval_status, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, actual_pay_amount, related_ci_id, related_ci_no, related_po_no, include_in_landing_cost, expense_country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [prId, prNo, 'customs_duty', 'duty', 'ci', ci_id, ci.ci_no, 'customs', payeeKey, payeeNameSnapshot, payee_name || '', payable_amount, 0, actualPay, currency || ci.currency || 'USD', 'pending_approval', 'pending', remark || `关税 ${ci.ci_no}`, deductionEnabled ? 1 : 0, dedAmount, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', actualPay, ci_id, ci.ci_no, ci.related_po_no || '', 1, expenseCountrySnapshot]);
      if (deductionEnabled && dedAmount > 0) await recordInitialDeduction(prId, dedAmount, deduction_source_desc, await settlementOperator(req));
      await run(`INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [await genId('cci'), ci_id, ci.ci_no, prId, prNo, 'customs_duty', 'duty', payable_amount, 0, 1, payee_name || '', currency || ci.currency || 'USD', remark || '']);
      await run('UPDATE commercial_invoices SET import_duty_total = ?, updated_at = datetime(\'now\') WHERE id = ?', [costMoney(payable_amount), ci.id]);
    });

    // PAY-CORE Phase 2：创建后自动提交审批
    let approvalInfo = {};
    try {
      const createdPayment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [prId]);
      const apprResult = await createApprovalInstance(prId, createdPayment, req);
      approvalInfo = { approval_id: apprResult.approvalId, auto_submitted: true };
    } catch (apprErr) {
      approvalInfo = { auto_submit_failed: true, approval_error: apprErr.message };
    }
    res.json({ id: prId, request_no: prNo, actual_pay_amount: actualPay, ...approvalInfo });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// 生成付款申请（商检费用）— 只有CI选择"有商检费用"时才允许
app.post('/api/payment-requests/inspection-fee', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  try {
    const { ci_id, payee_name, payable_amount, currency, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no } = req.body;
    if (!ci_id) return res.status(400).json({ error: '商检费用付款必须关联CI' });
    const ci = await queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });
    if (ci.cost_confirmed) return res.status(409).json({ error: '该CI费用已确认，不能继续新增商检费用' });
    if (!ci.has_inspection_fee) return res.status(400).json({ error: '该CI未标记为有商检费用，无法创建商检费用付款申请' });
    if (!payable_amount || payable_amount <= 0) return res.status(400).json({ error: '应付金额必须大于0' });
    const expenseCountrySnapshot = sourceExpenseCountry(ci.country, `CI“${ci.ci_no}”`);

    const deductionEnabled = Number(has_deduction) === 1;
    const dedAmount = deductionEnabled ? settlementMoney(deduction_amount) : 0;
    if (!Number.isFinite(dedAmount) || dedAmount < 0) return res.status(400).json({ error: '抵扣金额不能小于0' });
    if (deductionEnabled && dedAmount > 0) {
      if (dedAmount > payable_amount) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    const actualPay = settlementMoney(Number(payable_amount) - dedAmount);

    const prId = await genId('pay');
    const prNo = `PAY-INS-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    // PAY-CORE Phase 1.5 Task 2：派生 payee_key/payee_name_snapshot（格式 ${payee_type}:${identity}，与 payable_items 一致）
    const payeeKey = `inspection_org:${payee_name || ''}`;
    const payeeNameSnapshot = payee_name || '';
    // P2-8 守卫：同 CI + 同 category + 同 subcategory 的 active payment_request 防重（rejected/cancelled 不阻挡）
    const existingInspection = await queryOne(
      `SELECT id, request_no FROM payment_requests
       WHERE payment_category = 'inspection_fee' AND payment_subcategory = 'inspection'
         AND approval_status != 'rejected'
         AND payment_status NOT IN ('rejected', 'cancelled')
         AND ((source_type = 'ci' AND source_id = ?) OR related_ci_id = ?)`,
      [ci_id, ci_id]
    );
    if (existingInspection) return res.status(409).json({ error: '该CI已存在有效的商检费用付款申请，不能重复生成' });
    await transaction(async () => {
      await run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, payee_key, payee_name_snapshot, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_status, approval_status, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, actual_pay_amount, related_ci_id, related_ci_no, related_po_no, include_in_landing_cost, expense_country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [prId, prNo, 'inspection_fee', 'inspection', 'ci', ci_id, ci.ci_no, 'inspection_org', payeeKey, payeeNameSnapshot, payee_name || '', payable_amount, 0, actualPay, currency || ci.currency || 'USD', 'pending_approval', 'pending', remark || `商检费用 ${ci.ci_no}`, deductionEnabled ? 1 : 0, dedAmount, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', actualPay, ci_id, ci.ci_no, ci.related_po_no || '', 1, expenseCountrySnapshot]);
      if (deductionEnabled && dedAmount > 0) await recordInitialDeduction(prId, dedAmount, deduction_source_desc, await settlementOperator(req));
      await run(`INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [await genId('cci'), ci_id, ci.ci_no, prId, prNo, 'inspection_fee', 'inspection', payable_amount, 0, 1, payee_name || '', currency || ci.currency || 'USD', remark || '']);
    });

    // PAY-CORE Phase 2：创建后自动提交审批
    let approvalInfo = {};
    try {
      const createdPayment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [prId]);
      const apprResult = await createApprovalInstance(prId, createdPayment, req);
      approvalInfo = { approval_id: apprResult.approvalId, auto_submitted: true };
    } catch (apprErr) {
      approvalInfo = { auto_submit_failed: true, approval_error: apprErr.message };
    }
    res.json({ id: prId, request_no: prNo, actual_pay_amount: actualPay, ...approvalInfo });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// 更新付款申请抵扣信息
app.put('/api/payment-requests/:id/deduction', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  try {
    const result = await applyDeductionSettlement(req.params.id, req.body || {}, req);
    res.json({ success: true, actual_pay_amount: settlementMoney(result.grossPayable - result.effectiveDeduction), outstanding: result.outstanding, payment_status: result.payment_status });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// 最终审批时写入抵扣（供「通过并付款」弹窗复用 PAY-CORE deduction 能力）
// 与 PUT 区别：权限跟随审批动作，避免审批人没有 payment_create 时 403
app.post('/api/payment-requests/:id/deduction', requireApiPermission('payment_approve','payment_execute'), asyncHandler(async (req, res) => {
  try {
    const result = await applyDeductionSettlement(req.params.id, req.body || {}, req);
    res.json({ success: true, actual_pay_amount: settlementMoney(result.grossPayable - result.effectiveDeduction), outstanding: result.outstanding, payment_status: result.payment_status });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// PAY-CORE Phase 2：提取 createApprovalInstance — 供创建端点自动提交审批 和 submit-approval 端点共用
// 不修改 applyPaymentSettlement / settlement_logs / payment_transactions / payable_items 状态模型
// 仅负责：读取审批流配置 → 校验审批人 → 创建 approval_records → 通知第1级审批人
async function createApprovalInstance(prId, payment, req) {
  // 状态校验：仅 draft/pending/rejected/withdrawn 可提交
  if (!['draft', 'pending', 'rejected', 'withdrawn'].includes(payment.approval_status)) {
    throw Object.assign(new Error('当前付款申请审批状态不允许提交审批（approval_status=' + payment.approval_status + '）'), { status: 400 });
  }
  if (['paid', 'cancelled', 'reversed'].includes(payment.payment_status)) {
    throw Object.assign(new Error('付款申请当前 payment_status=' + payment.payment_status + '，不允许提交审批'), { status: 400 });
  }

  const businessType = paymentRequestToBusinessType(payment);
  if (!businessType) {
    throw Object.assign(new Error('该付款类型（category=' + payment.payment_category + ', subcategory=' + payment.payment_subcategory + '）未配置审批流映射，无法提交审批'), { status: 400 });
  }

  // 读取审批流配置
  const flow = await queryOne('SELECT id, levels, is_enabled, completion_cc_user_ids FROM approval_flows WHERE business_type = ? AND is_enabled = 1 LIMIT 1', [businessType]);
  let maxLevel = 0, approvers = [], completionCcUserIds = [];
  if (flow && flow.levels) {
    let levels = [];
    try { levels = JSON.parse(flow.levels); } catch (e) { levels = []; }
    if (Array.isArray(levels) && levels.length > 0) {
      const built = [];
      let ok = true, badMsg = '';
      for (const lv of levels) {
        const lvl = Number(lv.level);
        const uid = (lv.approver_user_id || '').trim();
        if (!uid) { ok = false; badMsg = '第 ' + lvl + ' 级审批人未配置具体用户'; break; }
        const u = await queryOne('SELECT id, name, role_id, status FROM users WHERE id = ?', [uid]);
        if (!u) { ok = false; badMsg = '第 ' + lvl + ' 级审批用户不存在'; break; }
        if (u.status !== 'active') { ok = false; badMsg = '第 ' + lvl + ' 级审批用户「' + u.name + '」已停用'; break; }
        if (!u.role_id) { ok = false; badMsg = '第 ' + lvl + ' 级审批用户「' + u.name + '」未绑定角色'; break; }
        const role = await queryOne('SELECT id, name, permissions FROM roles WHERE id = ?', [u.role_id]);
        if (!role) { ok = false; badMsg = '第 ' + lvl + ' 级审批用户「' + u.name + '」绑定的角色不存在'; break; }
        let perms = [];
        try { perms = JSON.parse(role.permissions || '[]'); } catch (e) { perms = []; }
        if (!perms.includes('payment_approve')) { ok = false; badMsg = '第 ' + lvl + ' 级审批用户「' + u.name + '」当前不具备 payment_approve 权限'; break; }
        let nodeCcIds = [];
        if (Array.isArray(lv.cc_user_ids)) {
          for (const ccUid of lv.cc_user_ids) {
            const ccU = await queryOne('SELECT id, name, status FROM users WHERE id = ?', [ccUid]);
            if (!ccU) { ok = false; badMsg = '第 ' + lvl + ' 级节点 CC 用户不存在'; break; }
            if (ccU.status !== 'active') { ok = false; badMsg = '第 ' + lvl + ' 级节点 CC 用户「' + ccU.name + '」已停用'; break; }
            if (!nodeCcIds.includes(ccU.id)) nodeCcIds.push(ccU.id);
          }
          if (!ok) break;
        }
        built.push({ level: lvl, approver_user_id: u.id, approver_name: u.name, approver_role_id: u.role_id, cc_user_ids: nodeCcIds });
      }
      if (ok) {
        maxLevel = built.length;
        approvers = built;
        try {
          const parsedCc = JSON.parse(flow.completion_cc_user_ids || '[]');
          if (Array.isArray(parsedCc)) {
            for (const ccUid of parsedCc) {
              const ccU = await queryOne('SELECT id, name, status FROM users WHERE id = ?', [ccUid]);
              if (!ccU) { ok = false; badMsg = '完成 CC 用户不存在（id=' + ccUid + '）'; break; }
              if (ccU.status !== 'active') { ok = false; badMsg = '完成 CC 用户「' + ccU.name + '」已停用'; break; }
              if (!completionCcUserIds.includes(ccU.id)) completionCcUserIds.push(ccU.id);
            }
          }
        } catch (e) { /* JSON 解析失败视为空数组 */ }
        if (!ok) {
          throw Object.assign(new Error('审批流配置无效，无法提交：' + badMsg + '。请先在系统管理修正 ' + businessType + ' 审批流配置。'), { status: 400 });
        }
      } else {
        throw Object.assign(new Error('审批流配置无效，无法提交：' + badMsg + '。请先在系统管理修正 ' + businessType + ' 审批流配置（指定具体审批人）。'), { status: 400 });
      }
    }
  }
  if (!approvers || maxLevel < 1) {
    throw Object.assign(new Error('业务类型 ' + businessType + ' 的审批流未配置或未启用，无法提交审批。请先在系统管理（审批流管理）完成具体审批人配置并启用。'), { status: 400 });
  }

  const submitterName = (req.body.submitter_name || req.currentUserName || '').toString();
  const approvalId = genId('appr');

  await transaction(async () => {
    await run(`DELETE FROM approval_records WHERE business_id = ? AND business_type = ? AND status IN ('pending','rejected','withdrawn')`, [prId, businessType]);
    const approversSnapshot = JSON.stringify({ levels: approvers, completion_cc_user_ids: completionCcUserIds });
    await run(`INSERT INTO approval_records (id, business_type, business_id, business_code, submitter_id, submitter_name, current_level, max_level, approvers, approval_history, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [approvalId, businessType, prId, payment.request_no, req.currentUserId, submitterName, 1, maxLevel, approversSnapshot,
       JSON.stringify([{ level: 0, action: 'submit', user_id: req.currentUserId, user_name: submitterName, time: new Date().toISOString(), remark: '提交审批' }]),
       'pending']);
    try {
      for (const lv of approvers) {
        for (const ccUid of (lv.cc_user_ids || [])) {
          await run(`INSERT INTO business_participants (id, business_type, business_id, participant_type, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)`,
            [genId('bp'), 'approval', approvalId, 'node_cc', ccUid, '']);
        }
      }
      for (const ccUid of completionCcUserIds) {
        await run(`INSERT INTO business_participants (id, business_type, business_id, participant_type, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)`,
          [genId('bp'), 'approval', approvalId, 'completion_cc', ccUid, '']);
      }
    } catch (bpErr) {
      console.error('[PAY-CORE] business_participants 写入失败 approvalId=' + approvalId + '：', bpErr.message);
    }
    await run(`UPDATE payment_requests SET approval_status = ?, approval_remark = ?, approver_name = ?, approved_at = ?, updated_at = datetime('now') WHERE id = ?`,
      ['pending', '', '', '', prId]);
  });

  // 事务外 best-effort 通知第 1 级审批人 + 第 1 级节点 CC
  const notifyCtx = {
    business_no: payment.request_no,
    business_type: businessType,
    amount: settlementMoney(payment.payable_amount),
    currency: payment.currency || 'USD',
    applicant: submitterName
  };
  notifyPaymentApprovalParticipants(approvalId, 'submit', notifyCtx).catch(() => {});

  return { approvalId, businessType, maxLevel };
}

// PAY-CORE Phase 1：付款申请提交审批（生成 approval_records 实例 + 审批人快照 + CC 抄送）
// 与 PO submit-approval 流程对齐；不修改 payment_requests 业务字段，仅同步 approval_status='pending'。
// 业务类型由 paymentRequestToBusinessType(payment) 派生；未配置审批流时拒绝提交（不降级）。
// PAY-CORE Phase 2：核心逻辑已提取到 createApprovalInstance，本端点仅做参数校验 + 调用
app.post('/api/payment-requests/:id/submit-approval', requireApiPermission('payment_create'), asyncHandler(async (req, res) => {
  try {
    const payment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [req.params.id]);
    if (!payment) return res.status(404).json({ error: '付款申请不存在' });
    const result = await createApprovalInstance(req.params.id, payment, req);
    res.json({ success: true, approval_id: result.approvalId, business_type: result.businessType, max_level: result.maxLevel });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// 付款审批（PAY-CORE Phase 1：approve/reject 内部优先走多级审批流，无实例时回退老单步逻辑以兼容历史调用方）
app.post('/api/payment-requests/:id/approve', requireApiPermission('payment_approve', 'payment_execute'), asyncHandler(async (req, res) => {
  try {
    const { action, remark } = req.body;
    const payment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [req.params.id]);
    if (!payment) return res.status(404).json({ error: '付款申请不存在' });

    const userName = (await settlementOperator(req)).name;
    const apprRemark = (remark || '').toString();

    // confirm-paid 与审批流解耦，直接走 applyPaymentSettlement 路径
    // PAY-CORE Phase 2 V2.1 第 12 节：confirm-paid 从 payment_approve 切换到 payment_execute
    // PAY-CORE Phase 2：新增 bank_ref_no / voucher_attachment / payment_account / apply_round_off 参数
    if (action === 'confirm-paid') {
      // 两级财务审批流程：第二级「付款确认」由财务审批人在审批中心执行，
      // 因此 payment_approve / payment_execute / 通配(*) 任一权限均可触发（原 V2.1 仅限 payment_execute 过严）。
      // 前置校验：仅已完成一级审批(approval_status='approved')的付款申请可走 confirm-paid，
      // 避免 pending 单子绕过一级审批直接结算。
      if (payment.approval_status !== 'approved') {
        return res.status(409).json({ error: '该付款申请尚未完成审批，不能确认付款' });
      }
      const hasExecutePerm = (req.currentUserPermissions || []).some(p => p === 'payment_execute' || p === 'payment_approve' || p === '*');
      if (!hasExecutePerm) {
        return res.status(403).json({ error: '确认付款需要 payment_approve 或 payment_execute 权限' });
      }
      const result = await applyPaymentSettlement(req.params.id, req.body.paid_amount, req.body.paid_date, req.body.payment_voucher, req, req.body.idempotency_key, {
        bank_ref_no: req.body.bank_ref_no,
        payment_account: req.body.payment_account,
        voucher_attachment: req.body.voucher_attachment,
        apply_round_off: req.body.apply_round_off === true || req.body.apply_round_off === 1,
        rounding_amount: req.body.rounding_amount,
        rounding_reason: req.body.rounding_reason,
        // 合并付款人工分摊：前端逐项填写的 allocations 透传到结算逻辑（无则走自动比例分摊）
        allocations: Array.isArray(req.body.allocations) ? req.body.allocations : undefined
      });
      return res.json({ success: true, idempotent: result.idempotent, log_id: result.log_id, transaction_id: result.transaction_id, trans_no: result.trans_no, rounding_amount: result.rounding_amount, paid_amount: result.effectivePaid, outstanding: result.outstanding, payment_status: result.payment_status });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: '无效的审批操作' });
    }
    // V2.1：approve/reject 必须有 payment_approve 权限（confirm-paid 走 payment_execute）
    const hasApprovePerm = (req.currentUserPermissions || []).includes('payment_approve') || (req.currentUserPermissions || []).includes('*');
    if (!hasApprovePerm) {
      return res.status(403).json({ error: '审批操作需要 payment_approve 权限' });
    }
    if (payment.approval_status !== 'pending') {
      return res.status(409).json({ error: '该付款申请已完成审批，不能重复操作' });
    }

    // 候选丁(PAY-MULTI-2026-227942 根因防护)：审批通过后自动结清需要 expense_country，
    // 非货款类别若未设置费用归属国家，结清阶段(resolveSettlementCountry)会抛错导致状态卡住。
    // 此处前置校验，在审批入口拦截数据缺失，避免“审批通过但结清失败”。
    if (action === 'approve' && payment.payment_category !== 'goods') {
      try {
        resolveSettlementCountry(payment);
      } catch (e) {
        return res.status(400).json({ error: '审批前置校验失败：' + e.message });
      }
    }

    // —— PAY-CORE Phase 1：查 approval_records 实例，若有 pending 实例则走多级审批逻辑 ——
    const businessType = paymentRequestToBusinessType(payment);
    const approval = businessType ? await queryOne(
      'SELECT * FROM approval_records WHERE business_id = ? AND business_type = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      [req.params.id, businessType, 'pending']
    ) : null;

    if (approval) {
      // —— 多级审批分支：与 PO approve/reject 流程对齐，双重校验当前级次 + 当前用户为该级次指定审批人 ——
      const curLevel = approval.current_level;
      if (!Number.isInteger(curLevel) || curLevel < 1 || curLevel > approval.max_level) {
        return res.status(403).json({ error: '当前审批级次无效' });
      }
      let approverList = [];
      // PAY-CORE Phase 1：使用 normalizeApprovalSnapshot 兼容老数组格式 + 新对象格式
      const paySnapshot = normalizeApprovalSnapshot(approval.approvers);
      approverList = paySnapshot.levels;
      const curNode = approverList.find(a => a.level === curLevel);
      if (!curNode || !curNode.approver_user_id) {
        return res.status(403).json({ error: '当前级次未配置具体审批人，无法审批' });
      }
      if (curNode.approver_user_id !== req.currentUserId) {
        return res.status(403).json({ error: '您不是当前审批级次的指定审批人，无权审批' });
      }

      const history = JSON.parse(approval.approval_history || '[]');
      const notifyCtx = {
        business_no: payment.request_no,
        business_type: businessType,
        amount: settlementMoney(payment.payable_amount),
        currency: payment.currency || 'USD',
        applicant: approval.submitter_name || ''
      };

      if (action === 'approve') {
        const nextLevel = (approval.current_level || 1) + 1;
        if (nextLevel > approval.max_level) {
          // 最终审批通过即完成付款：审批、结算事实、来源回写和 payable_items reserved→paid 同事务提交。
          // 进入事务前预检查汇率可用性，避免事务回滚
          if (payment.payment_category !== 'goods') {
            try {
              const country = resolveSettlementCountry(payment);
              const paidDate = (req.body || {}).actual_paid_date || payment.paid_date;
              if (paidDate && country.currency !== payment.currency) {
                const rateCheck = exactSettlementRate(payment.currency, country.currency, paidDate);
                if (!rateCheck || !(rateCheck.rate > 0)) {
                  return res.status(400).json({
                    error: `审批失败：缺少 ${paidDate} ${payment.currency}→${country.currency} 的付款汇率，请联系系统管理员在汇率管理中添加该日期的汇率后再审批`,
                    suggestion: { from: payment.currency, to: country.currency, date: paidDate, type: SETTLEMENT_RATE_TYPE }
                  });
                }
              }
              // 同时检查 RMB 汇率
              if (paidDate && payment.currency !== 'RMB') {
                exactSettlementRate(payment.currency, 'RMB', paidDate);
              }
            } catch (e) {
              if (e.name === 'SettlementError') {
                return res.status(400).json({
                  error: '审批前置校验失败（汇率）：' + e.message + '，请联系系统管理员在汇率管理中添加该日期的汇率后再审批'
                });
              }
              throw e;
            }
          }
          history.push({ level: approval.current_level, action: 'approve', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: apprRemark });
          await transaction(async () => {
            await ensureSettlementLegacyBaselines(payment);
            await run(`UPDATE approval_records SET status = ?, approval_history = ?, updated_at = datetime('now') WHERE id = ?`, ['approved', JSON.stringify(history), approval.id]);
            await run(`UPDATE payment_requests SET approval_status = ?, approval_remark = ?, approver_name = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, ['approved', apprRemark, userName, req.params.id]);
          });
          // 事务外 best-effort 通知提交人 + CC
          notifyPaymentApprovalParticipants(approval.id, 'approved_final', Object.assign({}, notifyCtx, { approver: userName })).catch(() => {});
          // PAY-CORE Phase 2：最终审批通过后，若附带付款信息则直接执行结算（创建→审批→付款闭环）
          if (req.body.actual_paid_amount != null) {
            try {
              const updatedPayment = await queryOne('SELECT * FROM payment_requests WHERE id = ?', [req.params.id]);
              const settleResult = await settleFinalPaymentApproval(updatedPayment, req.body, req);
              return res.json({
                success: true,
                settlement: {
                  idempotent: settleResult.idempotent,
                  log_id: settleResult.log_id,
                  transaction_id: settleResult.transaction_id,
                  trans_no: settleResult.trans_no,
                  rounding_amount: settleResult.rounding_amount,
                  paid_amount: settleResult.effectivePaid,
                  outstanding: settleResult.outstanding,
                  payment_status: settleResult.payment_status
                }
              });
            } catch (settleErr) {
              return res.status(settleErr.status || 500).json({
                error: '审批已通过，但付款结算失败：' + settleErr.message,
                approval_success: true,
                settlement_failed: true
              });
            }
          }
        } else {
          // 中间级次通过：approval_records.current_level=nextLevel，payment_requests.approval_status 保持 pending
          history.push({ level: approval.current_level, action: 'approve', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: apprRemark });
          await transaction(async () => {
            await run(`UPDATE approval_records SET current_level = ?, approval_history = ?, updated_at = datetime('now') WHERE id = ?`, [nextLevel, JSON.stringify(history), approval.id]);
            await run(`UPDATE payment_requests SET approval_remark = ?, approver_name = ?, updated_at = datetime('now') WHERE id = ?`, [apprRemark, userName, req.params.id]);
            await recalculatePaymentSettlement(req.params.id);
          });
          notifyPaymentApprovalParticipants(approval.id, 'approved_intermediate', Object.assign({}, notifyCtx, { approver: userName, level: nextLevel })).catch(() => {});
        }
      } else {
        // reject：approval_records.status='rejected' + payment_requests.approval_status='rejected'
        history.push({ level: approval.current_level, action: 'reject', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: apprRemark });
        await transaction(async () => {
          await ensureSettlementLegacyBaselines(payment);
          await run(`UPDATE approval_records SET status = ?, approval_history = ?, updated_at = datetime('now') WHERE id = ?`, ['rejected', JSON.stringify(history), approval.id]);
          await run(`UPDATE payment_requests SET approval_status = ?, approval_remark = ?, approver_name = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, ['rejected', apprRemark, userName, req.params.id]);
          await recalculatePaymentSettlement(req.params.id);
          // reject 时释放关联的 payable_items（reserved → active），single / multi 均执行
          releasePayableItemsByPR(req.params.id);
        });
        notifyPaymentApprovalParticipants(approval.id, 'reject', Object.assign({}, notifyCtx, { approver: userName, remark: apprRemark })).catch(() => {});
      }
      return res.json({ success: true });
    }

    // —— 老单步审批逻辑（兼容路径）：payment_requests 无对应 approval_records 实例 ——
    // Phase 1 兼容：前端未接入 submit-approval 时仍可使用旧 approve/reject 调用。
    // 响应头加 Deprecation 提示已弃用，后续 Phase 2 前端切换后下线。
    //
    // [PAY-CORE-TD-001] Technical Debt — 旧 approve 接口兼容路径
    // 现状：有 approval_record 时走新多级审批逻辑；无 approval_record 时允许旧单级审批逻辑
    // 风险：旧接口理论上可能绕过 approval_records，导致审批实例链不完整
    // 当前处理：不删除旧接口、不影响历史调用、保留兼容能力
    // 后续要求：Phase 2 前端完全切换到 approval_records 流程后，再限制新付款申请必须经过 approval_records，
    //          不允许新业务绕过审批实例（届时在此处加入 status=2 直接拒绝并引导走 submit-approval）
    if (action === 'approve') {
      await transaction(async () => {
        await ensureSettlementLegacyBaselines(payment);
        await run(`UPDATE payment_requests SET approval_status = ?, approval_remark = ?, approver_name = ?,
             approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
          ['approved', apprRemark, userName, req.params.id]);
        // 候选戊([PAY-CORE-TD-001] 补全)：旧单步兼容路径补写 approval_records，
        // 让审批链完整，详情接口可返回审批记录（修复 Bug B“暂无审批流程记录”）。
        await run(`INSERT INTO approval_records (id, business_type, business_id, business_code, submitter_id, submitter_name, current_level, max_level, approvers, approval_history, status) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, 'approved')`,
          [genId('appr'), paymentRequestToBusinessType(payment) || 'payment', payment.id, payment.request_no, req.currentUserId, userName,
           JSON.stringify([{level:1, approver_id: req.currentUserId, approver_name: userName}]),
           JSON.stringify([{level:1, action:'approve', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: apprRemark}])]);
      });
    } else { // reject
      await transaction(async () => {
        await ensureSettlementLegacyBaselines(payment);
        await run(`UPDATE payment_requests SET approval_status = ?, approval_remark = ?, approver_name = ?,
             approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
          ['rejected', apprRemark, userName, req.params.id]);
        // 候选戊([PAY-CORE-TD-001] 补全)：旧单步兼容路径补写 approval_records（reject）
        await run(`INSERT INTO approval_records (id, business_type, business_id, business_code, submitter_id, submitter_name, current_level, max_level, approvers, approval_history, status) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, 'rejected')`,
          [genId('appr'), paymentRequestToBusinessType(payment) || 'payment', payment.id, payment.request_no, req.currentUserId, userName,
           JSON.stringify([{level:1, approver_id: req.currentUserId, approver_name: userName}]),
           JSON.stringify([{level:1, action:'reject', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: apprRemark}])]);
        await recalculatePaymentSettlement(req.params.id);
        // reject 时释放关联的 payable_items（reserved → active），single / multi 均执行
        releasePayableItemsByPR(req.params.id);
      });
    }
    res.set('Deprecation', 'true');
    res.set('Link', '</api/payment-requests/:id/submit-approval>; rel="successor-version"');
    res.json({ success: true, deprecation: '该审批路径已弃用，请改用 submit-approval 创建审批实例后再调用 approve' });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

app.post('/api/payment-requests/:id/reverse-payment', requireApiPermission('payment_approve'), asyncHandler(async (req, res) => {
  try {
    const result = await reverseSettlementEvent(req.params.id, req.body.settlement_log_id, 'payment', req.body.reason, req);
    res.json({ success: true, reversed_log_id: result.reversed_log_id, paid_amount: result.effectivePaid, outstanding: result.outstanding, payment_status: result.payment_status });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

app.post('/api/payment-requests/:id/reverse-deduction', requireApiPermission('payment_approve'), asyncHandler(async (req, res) => {
  try {
    const result = await reverseSettlementEvent(req.params.id, req.body.settlement_log_id, 'deduction', req.body.reason, req);
    res.json({ success: true, reversed_log_id: result.reversed_log_id, deduction_amount: result.effectiveDeduction, outstanding: result.outstanding, payment_status: result.payment_status });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

app.post('/api/payment-requests/:id/rounding', requireApiPermission('payment_approve'), asyncHandler(async (req, res) => {
  try {
    const result = await applyRoundingSettlement(req.params.id, req.body.amount, req.body.reason, req);
    res.json({ success: true, log_id: result.log_id, rounding_amount: result.effectiveRounding, outstanding: result.outstanding, payment_status: result.payment_status });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

app.post('/api/payment-requests/:id/reverse-rounding', requireApiPermission('payment_approve'), asyncHandler(async (req, res) => {
  try {
    const result = await reverseSettlementEvent(req.params.id, req.body.settlement_log_id, 'rounding', req.body.reason, req);
    res.json({ success: true, reversed_log_id: result.reversed_log_id, rounding_amount: result.effectiveRounding, outstanding: result.outstanding, payment_status: result.payment_status });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// 导入付款结果
app.post('/api/payment-requests/bulk-import-result', requireApiPermission('payment_import'), asyncHandler(async (req, res) => {
  try {
    const items = req.body.items || [];
    const result = { updated: 0, idempotent: 0, failed: 0, errors: [] };
        let i = 0;
    for (const item of items) {

      try {
        if (!item.request_no) throw new SettlementError(400, '付款申请号为空');
        const payment = await queryOne('SELECT * FROM payment_requests WHERE request_no = ?', [item.request_no]);
        if (!payment) throw new SettlementError(404, `付款申请号 ${item.request_no} 不存在`);
        const paymentResult = await applyPaymentSettlement(payment.id, item.paid_amount, item.paid_date, item.payment_voucher, req, bulkPaymentIdempotencyKey(item));
        if (paymentResult.idempotent) result.idempotent++;
        else result.updated++;
      } catch (e) {
        result.failed++;
        result.errors.push({ row: i + 2, reason: e.message });
      }
    
    i++;
    };
    res.json(result);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// ==================== CI 费用归集 ====================

const TRANSPORT_COST_SUBCATEGORIES = new Set([
  'freight', 'port', 'port_charges', 'customs_agent', 'customs_clearance',
  'delivery', 'warehouse', 'other_local'
]);

class CostAllocationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function costMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return NaN;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function getCiSkuCostFacts(ciId) {
  const rows = query(`SELECT cii.*, s.id AS sku_id
    FROM commercial_invoice_items cii
    LEFT JOIN skus s ON s.sku_code = cii.sku_code
    WHERE cii.ci_id = ? ORDER BY cii.created_at, cii.id`, [ciId]).rows;
  if (!rows.length) throw new CostAllocationError(400, 'CI明细为空，无法确认或分摊成本');

  const grouped = new Map();
  rows.forEach((row, index) => {
    const skuCode = String(row.sku_code || '').trim();
    if (!skuCode) throw new CostAllocationError(400, 'CI明细存在空SKU，无法分摊成本');
    if (!grouped.has(skuCode)) {
      grouped.set(skuCode, {
        sku_code: skuCode,
        sku_id: row.sku_id || '',
        stable_sort_order: index,
        product_cost: 0,
        inbound_qty: 0,
        customs_weight: 0
      });
    }
    const fact = grouped.get(skuCode);
    const amount = Number(row.ci_amount);
    const qty = Number(row.shipped_qty);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(qty) || qty < 0) {
      throw new CostAllocationError(400, `SKU ${skuCode} 缺少有效的CI实际金额或数量`);
    }
    fact.product_cost += amount;
    fact.inbound_qty += qty;
    if (row.actual_customs_rate !== null && row.actual_customs_rate !== '') {
      const rate = Number(row.actual_customs_rate);
      if (!Number.isFinite(rate) || rate < 0) throw new CostAllocationError(400, `SKU ${skuCode} 的实际关税税率必须为不小于0的数字`);
      fact.customs_weight += amount * rate;
    }
  });
  return { itemRows: rows, skuFacts: [...grouped.values()] };
}

function getCiPlBasisFacts(ciId, basis, skuFacts) {
  const field = basis === 'cbm' ? 'cbm' : 'gross_weight';
  const rows = query(`SELECT pli.sku_code, COUNT(*) AS row_count, SUM(pli.${field}) AS basis_value
    FROM packing_list_items pli
    JOIN packing_lists pl ON pl.id = pli.pl_id
    WHERE pl.related_ci_id = ?
    GROUP BY pli.sku_code`, [ciId]).rows;
  const bySku = new Map(rows.map(row => [String(row.sku_code || '').trim(), row]));
  const missing = [];
  const values = new Map();
  skuFacts.forEach(fact => {
    const row = bySku.get(fact.sku_code);
    const value = row ? Number(row.basis_value) : NaN;
    if (!row || !Number.isFinite(value) || value < 0) missing.push(fact.sku_code);
    else values.set(fact.sku_code, value);
  });
  if (missing.length) {
    throw new CostAllocationError(400, `运输类费用使用${basis.toUpperCase()}分摊，以下SKU缺少PL实际${basis === 'cbm' ? 'CBM' : '毛重'}：${missing.join('、')}`);
  }
  const basisTotal = skuFacts.reduce((sum, fact) => sum + (values.get(fact.sku_code) || 0), 0);
  if (!(basisTotal > 0)) throw new CostAllocationError(400, `运输类费用使用${basis.toUpperCase()}分摊，但PL明细basis_total为0`);
  return { values, basisTotal };
}

async function validateCiCostInputs(ci) {
  const facts = getCiSkuCostFacts(ci.id);
  const costItems = (await query('SELECT * FROM ci_cost_items WHERE ci_id = ? AND include_in_landing_cost = 1 ORDER BY created_at, id', [ci.id])).rows;
  const transportItems = costItems.filter(item => item.cost_category === 'warehouse_arrival' && TRANSPORT_COST_SUBCATEGORIES.has(item.cost_subcategory) && Number(item.payable_amount) > 0);
  const unsupportedTransport = costItems.filter(item => item.cost_category === 'warehouse_arrival' && !TRANSPORT_COST_SUBCATEGORIES.has(item.cost_subcategory) && Number(item.payable_amount) > 0);
  if (unsupportedTransport.length) {
    throw new CostAllocationError(400, `不支持的运输费用小类：${unsupportedTransport.map(item => item.cost_subcategory || '(空)').join('、')}`);
  }

  let plBasis = null;
  if (transportItems.length) {
    if (!['cbm', 'kg'].includes(ci.transport_basis)) {
      throw new CostAllocationError(400, '该CI存在运输类费用，请先明确选择本票实际运输计费基础（CBM或KG）');
    }
    plBasis = getCiPlBasisFacts(ci.id, ci.transport_basis, facts.skuFacts);
  }

  const dutyTotal = costMoney(ci.import_duty_total || 0);
  if (!Number.isFinite(dutyTotal) || dutyTotal < 0) throw new CostAllocationError(400, 'CI Import Duty总金额必须为不小于0的数字');
  if (dutyTotal > 0) {
    const missingRates = facts.itemRows.filter(row => row.actual_customs_rate === null || row.actual_customs_rate === '').map(row => row.sku_code);
    if (missingRates.length) throw new CostAllocationError(400, `CI Import Duty大于0，以下SKU未填写本票实际关税税率：${[...new Set(missingRates)].join('、')}`);
    const totalWeight = facts.skuFacts.reduce((sum, fact) => sum + fact.customs_weight, 0);
    if (!(totalWeight > 0)) throw new CostAllocationError(400, 'CI Import Duty大于0，但全部SKU的关税权重合计为0');
  }

  const goodsTotal = facts.skuFacts.reduce((sum, fact) => sum + fact.product_cost, 0);
  if (!(goodsTotal > 0)) throw new CostAllocationError(400, 'CI实际商品金额合计为0，无法分摊成本');
  return { ...facts, costItems, transportItems, plBasis, dutyTotal, goodsTotal };
}

function allocateFeeWithRemainder(fee, skuFacts, basisValues) {
  const feeTotal = costMoney(fee.total);
  if (!Number.isFinite(feeTotal) || feeTotal < 0) throw new CostAllocationError(400, `${fee.label}金额必须为不小于0的数字`);
  const basisTotal = skuFacts.reduce((sum, fact) => sum + Number(basisValues.get(fact.sku_code) || 0), 0);
  if (!(basisTotal > 0)) throw new CostAllocationError(400, `${fee.label}使用${fee.basis}分摊，但basis_total为0`);

  const rows = skuFacts.map(fact => {
    const basisValue = Number(basisValues.get(fact.sku_code) || 0);
    const ratio = basisValue / basisTotal;
    const theoretical = feeTotal * ratio;
    const rounded = costMoney(theoretical);
    return { fact, basisValue, ratio, theoretical, rounded, final: rounded, adjustment: 0, anchor: 0 };
  });
  const anchor = rows.slice().sort((a, b) => {
    const theoreticalDiff = b.theoretical - a.theoretical;
    if (Math.abs(theoreticalDiff) > 1e-12) return theoreticalDiff;
    if (a.fact.stable_sort_order !== b.fact.stable_sort_order) return a.fact.stable_sort_order - b.fact.stable_sort_order;
    return String(a.fact.sku_id || a.fact.sku_code).localeCompare(String(b.fact.sku_id || b.fact.sku_code));
  })[0];
  const roundedTotalCents = rows.reduce((sum, row) => sum + Math.round(row.rounded * 100), 0);
  const remainderCents = Math.round(feeTotal * 100) - roundedTotalCents;
  anchor.adjustment = remainderCents / 100;
  anchor.final = costMoney(anchor.rounded + anchor.adjustment);
  anchor.anchor = 1;
  if (rows.some(row => row.final < 0)) throw new CostAllocationError(400, `${fee.label}分摊产生负金额，已拒绝`);
  const finalCents = rows.reduce((sum, row) => sum + Math.round(row.final * 100), 0);
  if (finalCents !== Math.round(feeTotal * 100)) throw new CostAllocationError(500, `${fee.label}分摊未守恒`);
  return { rows, basisTotal, feeTotal, remainder: remainderCents / 100 };
}

// 获取CI费用归集汇总
app.get('/api/commercial-invoices/:id/cost-summary', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });

    // 获取该CI的所有费用项
    const costItems = query('SELECT * FROM ci_cost_items WHERE ci_id = ? ORDER BY created_at', [req.params.id]).rows;

    // 按类别汇总
    const summary = {
      goods_amount: ci.goods_amount || 0,
      paid_deposit: ci.actual_deducted_deposit || 0,
      payable_balance: ci.payable_balance || 0,
      goods_paid: ci.paid_balance || 0,
      goods_unpaid: (ci.payable_balance || 0) - (ci.paid_balance || 0),
      warehouse_arrival_total: 0,
      customs_duty_total: costMoney(ci.import_duty_total || 0),
      inspection_fee_total: 0,
      landing_cost_total: 0,
      has_customs_duty: ci.has_customs_duty || 0,
      has_inspection_fee: ci.has_inspection_fee || 0,
      transport_basis: ci.transport_basis || '',
      import_duty_total: costMoney(ci.import_duty_total || 0),
      cost_confirmed: ci.cost_confirmed || 0,
      cost_allocated: ci.cost_allocated || 0,
      original_inventory_imported: ci.original_inventory_imported || 0,
      wac_version_id: ci.wac_version_id || '',
      wac_confirmed: ci.wac_confirmed || 0,
      wac_confirmed_at: ci.wac_confirmed_at || '',
      wac_confirmed_by: ci.wac_confirmed_by || ''
    };

    costItems.forEach(item => {
      if (!item.include_in_landing_cost) return;
      const amt = item.payable_amount || 0;
      if (item.cost_category === 'warehouse_arrival') summary.warehouse_arrival_total += amt;
      else if (item.cost_category === 'customs_duty') { /* Import Duty使用CI快照，避免与付款费用项双算 */ }
      else if (item.cost_category === 'inspection_fee') summary.inspection_fee_total += amt;
    });

    summary.landing_cost_total = summary.goods_amount + summary.warehouse_arrival_total + summary.customs_duty_total + summary.inspection_fee_total;
    summary.cost_items = costItems;
    summary.ci_items = query('SELECT id, sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount, actual_customs_rate FROM commercial_invoice_items WHERE ci_id = ? ORDER BY created_at, id', [req.params.id]).rows;

    res.json(summary);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 设置CI是否有关税/商检费用
app.put('/api/commercial-invoices/:id/cost-flags', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
  try {
    const { has_customs_duty, has_inspection_fee } = req.body;
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });
    if (ci.cost_confirmed) return res.status(409).json({ error: '该CI费用已确认，费用标记已锁定' });

    const updates = [];
    const params = [];
    if (has_customs_duty !== undefined) { updates.push('has_customs_duty = ?'); params.push(has_customs_duty ? 1 : 0); }
    if (has_inspection_fee !== undefined) { updates.push('has_inspection_fee = ?'); params.push(has_inspection_fee ? 1 : 0); }
    if (updates.length === 0) return res.json({ success: true });

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    run(`UPDATE commercial_invoices SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 保存运营 CI 的本票运输计费基础、Import Duty 总额和明细实际税率；成本确认后锁定。
app.put('/api/commercial-invoices/:id/cost-inputs', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });
    if (ci.cost_confirmed) return res.status(409).json({ error: '该CI费用已确认，运输计费基础和实际关税税率已锁定' });

    const basisRaw = req.body.transport_basis;
    const transportBasis = basisRaw === '' || basisRaw === null || basisRaw === undefined ? null : String(basisRaw).trim();
    if (transportBasis !== null && !['cbm', 'kg'].includes(transportBasis)) return res.status(400).json({ error: '运输计费基础只允许cbm或kg' });
    const importDutyTotal = costMoney(req.body.import_duty_total || 0);
    if (!Number.isFinite(importDutyTotal) || importDutyTotal < 0) return res.status(400).json({ error: 'CI Import Duty总金额必须为不小于0的数字' });
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    transaction(() => {
      run('UPDATE commercial_invoices SET transport_basis = ?, import_duty_total = ?, has_customs_duty = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [transportBasis, importDutyTotal, importDutyTotal > 0 ? 1 : ci.has_customs_duty, ci.id]);
      items.forEach(item => {
        const current = queryOne('SELECT id, sku_code FROM commercial_invoice_items WHERE id = ? AND ci_id = ?', [item.id, ci.id]);
        if (!current) throw new CostAllocationError(400, 'CI明细不存在或不属于当前CI');
        const raw = item.actual_customs_rate;
        const rate = raw === '' || raw === null || raw === undefined ? null : Number(raw);
        if (rate !== null && (!Number.isFinite(rate) || rate < 0)) throw new CostAllocationError(400, `SKU ${current.sku_code} 的实际关税税率必须为不小于0的数字`);
        run('UPDATE commercial_invoice_items SET actual_customs_rate = ? WHERE id = ?', [rate, current.id]);
      });
    });
    res.json({ success: true, transport_basis: transportBasis, import_duty_total: importDutyTotal });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// 确认CI费用完整
app.post('/api/commercial-invoices/:id/confirm-costs', requireApiPermission('ci_edit'), asyncHandler(async (req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });
    if (ci.cost_confirmed) return res.json({ success: true, already_confirmed: true });
    await validateCiCostInputs(ci);
    run('UPDATE commercial_invoices SET cost_confirmed = 1, updated_at = datetime(\'now\') WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// ==================== 原库存数量导入 ====================

// 原库存数量导入
app.post('/api/original-inventory/import', requireApiPermission('cost_view'), asyncHandler((req, res) => {
  try {
    const { ci_id, items } = req.body;
    if (!ci_id) return res.status(400).json({ error: '必须关联CI' });
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '导入数据不能为空' });
    }

    // ===== 阶段1：DELETE 前全量预校验（只读，不写库）=====
    const errors = [];
    const parsed = [];
    items.forEach((item, i) => {
      const rowNo = i + 2; // 表头占第1行
      const skuCode = item.sku_code || item['SKU'];
      const origQty = parseFloat(item.original_qty || item['原库存数量'] || 0);
      const country = item.country || item['国家'] || ci.country || '';
      const warehouse = item.warehouse || item['仓库'] || ci.target_warehouse || '';
      const remark = item.remark || item['备注'] || '';

      if (!skuCode) { errors.push({ row: rowNo, reason: 'SKU编码为空' }); return; }

      // 校验SKU存在
      const sku = queryOne('SELECT sku_code FROM skus WHERE sku_code = ?', [skuCode]);
      if (!sku) { errors.push({ row: rowNo, reason: `SKU ${skuCode} 不存在` }); return; }

      // 校验SKU属于CI明细
      const ciItem = queryOne('SELECT id FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [ci_id, skuCode]);
      if (!ciItem) { errors.push({ row: rowNo, reason: `SKU ${skuCode} 不属于该CI明细` }); return; }

      // 校验非负数
      if (origQty < 0) { errors.push({ row: rowNo, reason: `SKU ${skuCode} 原库存数量不能为负数` }); return; }

      parsed.push({ skuCode, origQty, country, warehouse, remark });
    });

    // 任一行校验失败 → 整体返回 400，完全不执行 DELETE（避免 DELETE-first 数据丢失）
    if (errors.length > 0) {
      return res.status(400).json({ success: 0, failed: errors.length, total: items.length, errors });
    }

    // ===== 阶段2：校验通过 → 事务内 DELETE → INSERT → UPDATE =====
    // 移除原逐行 try/catch：任一 INSERT 或后续 UPDATE 失败将自然抛出并整体回滚
    transaction(() => {
      // 先清除该CI之前的导入记录
      run('DELETE FROM original_inventory_imports WHERE ci_id = ?', [ci_id]);

      parsed.forEach(p => {
        run(`INSERT INTO original_inventory_imports (id, ci_id, ci_no, po_no, sku_code, country, warehouse, original_qty, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [genId('ori'), ci_id, ci.ci_no, ci.related_po_no || '', p.skuCode, p.country, p.warehouse, p.origQty, p.remark]);
      });

      // 检查CI明细中所有SKU是否都已导入
      const ciItems = query('SELECT sku_code FROM commercial_invoice_items WHERE ci_id = ?', [ci_id]).rows;
      const importedSkus = parsed.map(p => p.skuCode);
      const missingSkus = ciItems.filter(ci => !importedSkus.includes(ci.sku_code)).map(ci => ci.sku_code);

      const allImported = missingSkus.length === 0;
      run('UPDATE commercial_invoices SET original_inventory_imported = ? WHERE id = ?', [allImported ? 1 : 0, ci_id]);
    });

    // 事务提交后计算业务警告（部分 SKU 未导入为业务提示，不阻断）
    const ciItems = query('SELECT sku_code FROM commercial_invoice_items WHERE ci_id = ?', [ci_id]).rows;
    const importedRows = query('SELECT sku_code FROM original_inventory_imports WHERE ci_id = ?', [ci_id]).rows.map(r => r.sku_code);
    const missingSkus = ciItems.filter(ci => !importedRows.includes(ci.sku_code)).map(ci => ci.sku_code);
    const warnings = missingSkus.length > 0
      ? [`部分 SKU 缺少原库存数量，请补充后再更新加权平均成本: ${missingSkus.join(', ')}`]
      : [];

    res.json({ success: items.length, failed: 0, total: items.length, warnings });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 原库存数量导入模板下载（必须在 /:ci_id 路由之前）
app.get('/api/original-inventory/template', requireApiPermission('cost_view'), asyncHandler((req, res) => {
  res.json({
    columns: ['SKU', '原库存数量', '备注'],
    sample: [
      { 'SKU': 'SKU-001', '原库存数量': 500, '备注': '' },
      { 'SKU': 'SKU-002', '原库存数量': 300, '备注': '' }
    ],
    note: '如果当前采购单已绑定国家和仓库，模板只需 SKU、原库存数量、备注三列。'
  });
}));

// 获取CI的原库存数量导入记录
app.get('/api/original-inventory/:ci_id', requireApiPermission('cost_view'), asyncHandler((req, res) => {
  try {
    const rows = query('SELECT * FROM original_inventory_imports WHERE ci_id = ? ORDER BY sku_code', [req.params.ci_id]).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 检查CI是否所有SKU都已导入原库存数量
app.get('/api/original-inventory/:ci_id/check', requireApiPermission('cost_view'), asyncHandler((req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.ci_id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });

    const ciItems = query('SELECT sku_code FROM commercial_invoice_items WHERE ci_id = ?', [req.params.ci_id]).rows;
    const importedSkus = query('SELECT sku_code, original_qty FROM original_inventory_imports WHERE ci_id = ?', [req.params.ci_id]).rows;
    const importedSkuCodes = importedSkus.map(r => r.sku_code);

    const missing = ciItems.filter(ci => !importedSkuCodes.includes(ci.sku_code)).map(ci => ci.sku_code);
    res.json({
      all_imported: missing.length === 0 && ciItems.length > 0,
      total_skus: ciItems.length,
      imported_skus: importedSkus.length,
      missing_skus: missing
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 费用分摊 & 加权平均成本 ====================

// P1-WAC-07：每笔费用按其冻结依据独立分摊，两位小数守恒后汇总到 SKU。
app.post('/api/cost-allocation/allocate/:ci_id', requireApiPermission('ci_edit'), asyncHandler(async (req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });

    // 检查费用是否已确认
    if (!ci.cost_confirmed) {
      return res.status(400).json({ error: '请先确认该 CI 的到仓费用、关税、商检费用是否已录入完整。未录入的费用将不会计入落地成本。' });
    }
    if (ci.cost_allocated) return res.status(409).json({ error: '该CI已完成费用分摊，请勿重复执行' });

    const inputs = await validateCiCostInputs(ci);
    const amountBasis = new Map(inputs.skuFacts.map(fact => [fact.sku_code, fact.product_cost]));
    const customsBasis = new Map(inputs.skuFacts.map(fact => [fact.sku_code, fact.customs_weight]));
    const feeEvents = [];
    inputs.costItems.forEach(item => {
      const total = costMoney(item.payable_amount || 0);
      if (!(total > 0)) return;
      if (item.cost_category === 'warehouse_arrival') {
        feeEvents.push({
          key: `cost:${item.id}`,
          source_cost_item_id: item.id,
          category: item.cost_category,
          subcategory: item.cost_subcategory,
          label: `运输费用 ${item.cost_subcategory}`,
          total,
          currency: item.currency || ci.currency || 'USD',
          basis: ci.transport_basis,
          basisValues: inputs.plBasis.values
        });
      } else if (item.cost_category === 'inspection_fee') {
        feeEvents.push({
          key: `cost:${item.id}`,
          source_cost_item_id: item.id,
          category: item.cost_category,
          subcategory: item.cost_subcategory,
          label: '商检费',
          total,
          currency: item.currency || ci.currency || 'USD',
          basis: 'amount',
          basisValues: amountBasis
        });
      } else if (item.cost_category !== 'customs_duty') {
        throw new CostAllocationError(400, `费用 ${item.cost_category}/${item.cost_subcategory} 尚未配置分摊规则`);
      }
    });
    if (inputs.dutyTotal > 0) {
      feeEvents.push({
        key: `import-duty:${ci.id}`,
        source_cost_item_id: '',
        category: 'customs_duty',
        subcategory: 'duty',
        label: 'Import Duty',
        total: inputs.dutyTotal,
        currency: ci.currency || 'USD',
        basis: 'customs_weight',
        basisValues: customsBasis
      });
    }

    const allocationRunId = genId('car');
    const allocations = [];
    const details = [];
    transaction(() => {
      run('DELETE FROM cost_allocation_details WHERE ci_id = ?', [ci.id]);
      run('DELETE FROM cost_allocations WHERE ci_id = ?', [ci.id]);

      const summaryBySku = new Map(inputs.skuFacts.map(fact => [fact.sku_code, {
        fact,
        allocated_freight: 0,
        allocated_duty: 0,
        allocated_other: 0
      }]));

      feeEvents.forEach(fee => {
        const result = allocateFeeWithRemainder(fee, inputs.skuFacts, fee.basisValues);
        result.rows.forEach(row => {
          const summary = summaryBySku.get(row.fact.sku_code);
          if (fee.category === 'warehouse_arrival') summary.allocated_freight = costMoney(summary.allocated_freight + row.final);
          else if (fee.category === 'customs_duty') summary.allocated_duty = costMoney(summary.allocated_duty + row.final);
          else summary.allocated_other = costMoney(summary.allocated_other + row.final);

          const detail = {
            id: genId('cad'),
            allocation_run_id: allocationRunId,
            ci_id: ci.id,
            ci_no: ci.ci_no,
            source_cost_item_id: fee.source_cost_item_id,
            fee_key: fee.key,
            cost_category: fee.category,
            cost_subcategory: fee.subcategory,
            fee_total: result.feeTotal,
            currency: fee.currency,
            sku_code: row.fact.sku_code,
            allocation_basis: fee.basis,
            basis_value: row.basisValue,
            basis_total: result.basisTotal,
            ratio: row.ratio,
            theoretical_amount: row.theoretical,
            rounded_amount: row.rounded,
            rounding_adjustment: row.adjustment,
            final_allocated_amount: row.final,
            is_rounding_anchor: row.anchor,
            stable_sort_order: row.fact.stable_sort_order
          };
          run(`INSERT INTO cost_allocation_details (id, allocation_run_id, ci_id, ci_no, source_cost_item_id, fee_key, cost_category, cost_subcategory, fee_total, currency, sku_code, allocation_basis, basis_value, basis_total, ratio, theoretical_amount, rounded_amount, rounding_adjustment, final_allocated_amount, is_rounding_anchor, stable_sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [detail.id, detail.allocation_run_id, detail.ci_id, detail.ci_no, detail.source_cost_item_id, detail.fee_key, detail.cost_category, detail.cost_subcategory, detail.fee_total, detail.currency, detail.sku_code, detail.allocation_basis, detail.basis_value, detail.basis_total, detail.ratio, detail.theoretical_amount, detail.rounded_amount, detail.rounding_adjustment, detail.final_allocated_amount, detail.is_rounding_anchor, detail.stable_sort_order]);
          details.push(detail);
        });
      });

      inputs.skuFacts.forEach(fact => {
        const summary = summaryBySku.get(fact.sku_code);
        const productCost = costMoney(fact.product_cost);
        const allocatedFees = costMoney(summary.allocated_freight + summary.allocated_duty + summary.allocated_other);
        const totalLandingCost = costMoney(productCost + allocatedFees);
        const inboundQty = fact.inbound_qty || 0;
        const unitProductCost = inboundQty > 0 ? costMoney(productCost / inboundQty) : 0;
        const unitAllocatedCost = inboundQty > 0 ? costMoney(allocatedFees / inboundQty) : 0;
        const unitLandingCost = inboundQty > 0 ? costMoney(totalLandingCost / inboundQty) : 0;
        const bases = [...new Set(feeEvents.map(fee => fee.basis))];
        const allocationBasis = bases.length === 0 ? 'amount' : (bases.length === 1 ? bases[0] : 'mixed');
        const allocId = genId('cost');
        // 多 PI 改造：从 CI 明细取来源 PI（非 CI Header 的 related_pi_id）
        const ciItemForPi = queryOne('SELECT pi_id, pi_no FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ? LIMIT 1', [ci.id, fact.sku_code]);
        const itemPiNo = (ciItemForPi && ciItemForPi.pi_no) || ci.related_pi_no || '';
        run(`INSERT INTO cost_allocations (id, inbound_id, inbound_no, logistics_batch_no, allocation_run_id, ci_no, ci_id, related_po_no, related_pi_no, sku_code, allocation_basis, product_cost, allocated_freight, allocated_duty, allocated_other, total_landing_cost, inbound_qty, unit_landing_cost, currency, unit_product_cost, unit_allocated_cost, unit_landing_cost_with_fees, original_qty, original_avg_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [allocId, '', '', '', allocationRunId, ci.ci_no, ci.id, ci.related_po_no || '', itemPiNo, fact.sku_code, allocationBasis, productCost, summary.allocated_freight, summary.allocated_duty, summary.allocated_other, totalLandingCost, inboundQty, unitLandingCost, ci.currency || 'USD', unitProductCost, unitAllocatedCost, unitLandingCost, 0, 0]);
        allocations.push({ sku_code: fact.sku_code, product_cost: productCost, allocated_warehouse: summary.allocated_freight, allocated_duty: summary.allocated_duty, allocated_inspection: summary.allocated_other, total_landing_cost: totalLandingCost, inbound_qty: inboundQty, unit_landing_cost: unitLandingCost });
      });

      const landingTotal = costMoney(inputs.skuFacts.reduce((sum, fact) => sum + fact.product_cost, 0) + feeEvents.reduce((sum, fee) => sum + fee.total, 0));
      run('UPDATE commercial_invoices SET cost_allocated = 1, landing_total_cost = ?, updated_at = datetime(\'now\') WHERE id = ?', [landingTotal, ci.id]);
    });

    const updated = queryOne('SELECT landing_total_cost FROM commercial_invoices WHERE id = ?', [ci.id]);
    res.json({ success: true, allocation_run_id: allocationRunId, allocations, details, landing_total_cost: updated.landing_total_cost });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}));

// 更新加权平均成本（需要原库存数量已导入 + 费用已分摊）
// 确认加权平均成本（P1-03-B：只生成并锁定 WAC 版本，不修改库存总表）
app.post('/api/cost-allocation/update-weighted-avg/:ci_id', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });

    // 检查费用是否已确认
    if (!ci.cost_confirmed) {
      return res.status(400).json({ error: '请先确认该 CI 的到仓费用、关税、商检费用是否已录入完整。未录入的费用将不会计入落地成本。' });
    }

    // 检查费用是否已分摊
    if (!ci.cost_allocated) {
      return res.status(400).json({ error: '请先完成费用分摊' });
    }

    // P1-03-C: 重复确认检查 — 改用汇总状态 wac_confirmed
    if (ci.wac_confirmed) {
      return res.status(409).json({ error: '该 CI 已完成 WAC 确认，请勿重复确认。如需调整请使用冲销版本（尚未实现）。' });
    }

    // 获取原库存导入记录（供循环内按 SKU 匹配；缺失校验在事务内 throw）
    const importedSkus = query('SELECT sku_code, original_qty, country, warehouse FROM original_inventory_imports WHERE ci_id = ?', [req.params.ci_id]).rows;

    // 获取分摊记录（稳定业务排序，保证多 SKU 迭代顺序确定）
    const allocations = query('SELECT * FROM cost_allocations WHERE ci_id = ? ORDER BY sku_code ASC', [req.params.ci_id]).rows;
    if (allocations.length === 0) {
      return res.status(400).json({ error: '未找到费用分摊记录，请先执行费用分摊' });
    }

    const user = queryOne('SELECT name FROM users WHERE id = ?', [req.currentUserId]);
    const userName = user ? user.name : '';
    const logs = [];
    const today = new Date().toISOString().split('T')[0];

    transaction(() => {
      allocations.forEach(alloc => {
        const origInv = importedSkus.find(s => s.sku_code === alloc.sku_code);
        // P1-03-C: 缺失原库存导入记录必须在事务内抛出，触发整体回滚（而非事务外 400 拦截）
        if (!origInv) {
          throw new Error(`SKU ${alloc.sku_code} 缺少原库存导入记录，WAC 确认已整体回滚`);
        }

        const originalQty = origInv.original_qty || 0;
        const inboundQty = alloc.inbound_qty || 0;
        const unitLandingCost = alloc.unit_landing_cost_with_fees || alloc.unit_landing_cost || 0;
        const inboundTotalCost = inboundQty * unitLandingCost;

        // 读取旧加权平均成本（仅读取，不写入）
        const invRecord = queryOne('SELECT id, available_qty, weighted_avg_cost FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
          [alloc.sku_code, origInv.country, origInv.warehouse]);
        const oldAvgCost = invRecord ? (invRecord.weighted_avg_cost || 0) : 0;
        const originalInventoryValue = originalQty * oldAvgCost;

        // 计算新加权平均成本
        const newQty = originalQty + inboundQty;
        const newAvgCost = newQty > 0
          ? (originalQty * oldAvgCost + inboundQty * unitLandingCost) / newQty
          : unitLandingCost;
        const roundedAvgCost = Math.round(newAvgCost * 10000) / 10000;

        // P1-03-B: 获取 SKU 的 model 信息
        const skuInfo = queryOne('SELECT model, brand FROM skus WHERE sku_code = ?', [alloc.sku_code]);

        // P1-03-B: 生成并锁定 WAC 历史版本（不写 inventory/skus）
        // 多 PI 改造：从 CI 明细取来源 PI（非 CI Header 的 related_pi_id）
        const ciItemForWac = queryOne('SELECT pi_id, pi_no FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ? LIMIT 1', [ci.id, alloc.sku_code]);
        const wacPiId = (ciItemForWac && ciItemForWac.pi_id) || ci.related_pi_id || '';
        const wacPiNo = (ciItemForWac && ciItemForWac.pi_no) || ci.related_pi_no || '';
        const wacVer = generateWacVersion({
          ci_id: ci.id,
          ci_no: ci.ci_no,
          po_id: ci.related_po_id || '',
          po_no: ci.related_po_no || '',
          pi_id: wacPiId,
          pi_no: wacPiNo,
          sku_code: alloc.sku_code,
          model: skuInfo ? (skuInfo.model || '') : '',
          brand: ci.brand || (skuInfo ? (skuInfo.brand || '') : ''),
          country: origInv.country || '',
          warehouse: origInv.warehouse || '',
          original_qty: originalQty,
          original_avg_cost: oldAvgCost,
          original_inventory_value: originalInventoryValue,
          inbound_qty: inboundQty,
          unit_landing_cost: unitLandingCost,
          inbound_total_cost: inboundTotalCost,
          new_avg_cost: roundedAvgCost,
          settlement_date: today,
          confirmed_by: req.currentUserId
        });

        // 更新分摊记录的原库存信息（不改 inventory）
        run('UPDATE cost_allocations SET original_qty = ?, original_avg_cost = ? WHERE id = ?', [originalQty, oldAvgCost, alloc.id]);

        // 记录成本更新日志
        const logId = genId('cul');
        run(`INSERT INTO cost_update_logs (id, sku_code, country, warehouse, related_po_no, related_pi_no, related_ci_no, original_qty, old_avg_cost, inbound_qty, ci_unit_cost, unit_landing_cost, new_qty, new_avg_cost, operator_id, operator_name, import_file, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [logId, alloc.sku_code, origInv.country, origInv.warehouse, ci.related_po_no || '', wacPiNo, ci.ci_no, originalQty, oldAvgCost, inboundQty, alloc.unit_product_cost || 0, unitLandingCost, newQty, roundedAvgCost, req.currentUserId, userName, '', req.body.remark || '']);

        logs.push({ sku_code: alloc.sku_code, version_no: wacVer.version_no, wac_id: wacVer.id, original_qty: originalQty, old_avg_cost: oldAvgCost, inbound_qty: inboundQty, unit_landing_cost: unitLandingCost, new_avg_cost: roundedAvgCost });
      });

      // P1-03-C: 全部 SKU 成功才置汇总确认状态；否则整体回滚
      if (logs.length !== allocations.length) {
        throw new Error('WAC 确认 SKU 数量不一致，已整体回滚');
      }
      // 注意：不再写入 wac_version_id（P1-03-C 已废弃一对一版本关联）
      run('UPDATE commercial_invoices SET wac_confirmed = 1, wac_confirmed_at = datetime(\'now\'), wac_confirmed_by = ? WHERE id = ?', [req.currentUserId || userName, ci.id]);
    });

    res.json({ success: true, updated_count: logs.length, logs, wac_confirmed: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== WAC 确认（物流批次 → WAC → 库存成本） ====================
// 物流批次到货后 → WAC确认 → 更新库存成本
// 不做传统ERP入库闭环，只打通「物流 → WAC → 库存成本」
// WAC是否确认以 wac_history 记录作为事实来源，不增加第二套状态
// WAC确认只更新 inventory.weighted_avg_cost，不更新 available_qty
const LOGISTICS_STATUS_ARRIVED = 'completed'; // 已到仓

// ==================== WAC Shared Calculator (Phase 1 Design Freeze) ====================
// computeWacCostFacts: single source of truth for WAC cost computation.
// Used by both /api/wac/preview and /api/wac/confirm.
// Fail-closed: any data integrity issue produces a blocker; blockers > 0 → no DB writes.
const { computeWacCostFacts, resolveExactFxRate, allocateByWeight, WAC_MONETARY_TOLERANCE } = require('./wac-calculator');

// 查询待WAC确认的物流批次（已到仓 且 wac_history 中无该批次的确认记录）
app.get('/api/wac/pending-batches', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  try {
    const rows = query(`SELECT lb.id, lb.batch_no, lb.related_ci_id, lb.related_ci_no, lb.forwarder_name,
      lb.target_country, lb.target_warehouse, lb.logistics_status, lb.actual_arrival_date,
      lb.international_freight, lb.local_charges, lb.customs_service_fee,
      lb.delivery_fee, lb.customs_duty, lb.vat_gst, lb.other_fees, lb.freight_currency,
      lb.total_cartons, pl.pl_no, pl.id AS pl_id, pl.status AS pl_status, pl.total_qty AS pl_total_qty,
      ci.goods_amount, ci.currency AS ci_currency, ci.ci_no
      FROM logistics_batches lb
      LEFT JOIN packing_lists pl ON pl.logistics_batch_id = lb.id
      LEFT JOIN commercial_invoices ci ON ci.id = lb.related_ci_id
      WHERE lb.logistics_status = ?
      AND pl.id IS NOT NULL
      AND EXISTS (SELECT 1 FROM packing_list_items pli WHERE pli.pl_id = pl.id AND COALESCE(pli.total_qty, 0) > 0)
      AND NOT EXISTS (SELECT 1 FROM wac_history wh WHERE wh.logistics_batch_id = lb.id)
      ORDER BY lb.actual_arrival_date DESC, lb.created_at DESC`, [LOGISTICS_STATUS_ARRIVED]).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 查询已完成 WAC 确认的物流批次历史（从 wac_history 派生，不依赖 logistics_batches 状态字段）
app.get('/api/wac/confirmed-batches', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  try {
    const rows = query(`SELECT lb.id, lb.batch_no, lb.related_ci_no, lb.forwarder_name,
      lb.target_country, lb.target_warehouse, lb.actual_arrival_date,
      wh.confirmed_at, wh.ci_no,
      pl.pl_no, pl.total_qty AS pl_total_qty,
      (SELECT COUNT(DISTINCT wh2.sku_code) FROM wac_history wh2 WHERE wh2.logistics_batch_id = lb.id) AS sku_count
      FROM logistics_batches lb
      INNER JOIN wac_history wh ON wh.logistics_batch_id = lb.id
      LEFT JOIN packing_lists pl ON pl.logistics_batch_id = lb.id
      WHERE lb.logistics_status = ?
      GROUP BY lb.id
      ORDER BY wh.confirmed_at DESC`, [LOGISTICS_STATUS_ARRIVED]).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// WAC 确认预览：调用共享计算器，返回成本事实 + blockers（允许展示 blockers，blockers > 0 时不可确认）
app.get('/api/wac/preview/:logistics_batch_id', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  try {
    const result = computeWacCostFacts(req.params.logistics_batch_id);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// WAC 确认：重新读取 DB facts + 重新调用计算器。前端只传 items[{sku_code, old_qty}]。
// blockers > 0 时不可确认（0 DB writes）。成功后只写 wac_history + 更新 inventory.weighted_avg_cost。
// 不修改 available_qty、inventory_value、不创建入库数量事实、不修改 SKU reference price、不写 cost_update_logs。
app.post('/api/wac/confirm/:logistics_batch_id', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
  try {
    // ── 1. Re-read DB facts via shared calculator ──
    const { blockers, items, meta } = computeWacCostFacts(req.params.logistics_batch_id);

    // ── 2. Blockers > 0 → no DB writes ──
    if (blockers.length > 0) {
      return res.status(422).json({ error: '存在阻断器，无法确认WAC', blockers, meta });
    }

    // ── 3. Already confirmed check ──
    if (meta.already_confirmed) {
      return res.status(409).json({ error: '该物流批次已完成WAC确认' });
    }

    // ── 4. Validate old_qty from frontend ──
    const userItems = req.body.items || [];
    if (!Array.isArray(userItems) || userItems.length === 0) {
      return res.status(400).json({ error: '请提供库存数量数据 (items[{sku_code, old_qty}])' });
    }

    // Build old_qty map with strict validation — no auto-zeroing
    const oldQtyMap = new Map();
    const oldQtyErrors = [];
    for (const ui of userItems) {
      const skuCode = String(ui.sku_code || '').trim();
      if (!skuCode) continue;
      const raw = ui.old_qty;
      if (raw === null || raw === undefined || raw === '') {
        oldQtyErrors.push({ sku_code: skuCode, code: 'OLD_QTY_MISSING', message: `SKU ${skuCode} 缺少 old_qty` });
        continue;
      }
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0) {
        oldQtyErrors.push({ sku_code: skuCode, code: 'OLD_QTY_INVALID', message: `SKU ${skuCode} 的 old_qty="${raw}" 无效 (非有限数或负数)` });
        continue;
      }
      oldQtyMap.set(skuCode, num);
    }
    if (oldQtyErrors.length > 0) {
      return res.status(400).json({ error: 'old_qty 数据校验失败', errors: oldQtyErrors });
    }

    // Ensure every SKU in items has an old_qty
    const missingOldQty = items.filter(it => !oldQtyMap.has(it.sku_code)).map(it => it.sku_code);
    if (missingOldQty.length > 0) {
      return res.status(400).json({ error: `以下SKU缺少 old_qty: ${missingOldQty.join(', ')}` });
    }

    // ── 4b. WAC_DENOMINATOR_ZERO: old_qty + batch_qty <= 0 → reject ──
    const denomErrors = [];
    for (const item of items) {
      const oldQty = oldQtyMap.get(item.sku_code) ?? 0;
      if (oldQty + item.batch_qty <= 0) {
        denomErrors.push({ sku_code: item.sku_code, code: 'WAC_DENOMINATOR_ZERO', message: `SKU ${item.sku_code}: old_qty(${oldQty}) + batch_qty(${item.batch_qty}) <= 0` });
      }
    }
    if (denomErrors.length > 0) {
      return res.status(422).json({ error: 'WAC分母为零或负数', errors: denomErrors });
    }

    // ── 5. Write WAC history + update inventory.weighted_avg_cost only ──
    const batch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [req.params.logistics_batch_id]);
    const user = queryOne('SELECT name FROM users WHERE id = ?', [req.currentUserId]);
    const userName = user ? user.name : '';
    const today = new Date().toISOString().split('T')[0];
    const logs = [];

    // Load CI for wac_history fields
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [meta.ci_id]);

    transaction(() => {
      for (const item of items) {
        const skuCode = item.sku_code;
        const batchQty = item.batch_qty;
        if (batchQty <= 0) continue;

        const oldQty = oldQtyMap.get(skuCode) ?? 0; // 0 is legal
        const unitLandingCost = item.unit_landing_cost;
        const totalLandingCost = item.total_landing_cost_local;
        const oldAvgCost = item.current_wac;
        const originalInventoryValue = oldQty * oldAvgCost;

        // WAC moving weighted average formula
        const newQty = oldQty + batchQty;
        const newAvgCost = newQty > 0
          ? (oldQty * oldAvgCost + batchQty * unitLandingCost) / newQty
          : unitLandingCost;
        const roundedAvgCost = Math.round(newAvgCost * 10000) / 10000;

        const skuInfo = queryOne('SELECT model, brand FROM skus WHERE sku_code = ?', [skuCode]);

        // Write wac_history
        const wacVer = generateWacVersion({
          ci_id: meta.ci_id,
          ci_no: meta.ci_no,
          po_id: ci ? (ci.related_po_id || '') : '',
          po_no: ci ? (ci.related_po_no || '') : '',
          pi_id: ci ? (ci.related_pi_id || '') : '',
          pi_no: ci ? (ci.related_pi_no || '') : '',
          sku_code: skuCode,
          model: skuInfo ? (skuInfo.model || '') : '',
          brand: ci ? (ci.brand || '') : (skuInfo ? (skuInfo.brand || '') : ''),
          country: item.country,
          warehouse: item.warehouse,
          original_qty: oldQty,
          original_avg_cost: oldAvgCost,
          original_inventory_value: originalInventoryValue,
          inbound_qty: batchQty,
          unit_landing_cost: unitLandingCost,
          inbound_total_cost: totalLandingCost,
          new_avg_cost: roundedAvgCost,
          settlement_date: today,
          confirmed_by: req.currentUserId,
          logistics_batch_id: batch.id
        });

        // Only update inventory.weighted_avg_cost — NOT available_qty, NOT inventory_value
        const invRecord = queryOne('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
          [skuCode, item.country, item.warehouse]);
        if (invRecord) {
          run('UPDATE inventory SET weighted_avg_cost = ?, updated_at = datetime(\'now\') WHERE id = ?',
            [roundedAvgCost, invRecord.id]);
        }

        logs.push({
          sku_code: skuCode,
          version_no: wacVer.version_no,
          wac_id: wacVer.id,
          original_qty: oldQty,
          old_avg_cost: oldAvgCost,
          inbound_qty: batchQty,
          unit_landing_cost: unitLandingCost,
          new_avg_cost: roundedAvgCost
        });
      }
    });

    res.json({ success: true, confirmed_count: logs.length, logs });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== PUR-OPS-COLLAB-01：电商运营上架准备（V1） ====================
// 仅新增/挂载，不修改 ci_status 机、采购链、WAC、库存逻辑；「CI 确认」门槛 = wac_confirmed = 1。

// 读取某 CI 的上架准备状态（含 CC 列表）
app.get('/api/commercial-invoices/:id/ops-prep', requireApiPermission('ci_view'), asyncHandler((req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI 不存在' });
    const cc = query('SELECT user_id, user_name FROM business_participants WHERE business_type=? AND business_id=? AND participant_type=?', ['ci', ci.id, 'cc']).rows;
    const ownerName = ci.ops_owner_id ? ((queryOne('SELECT name FROM users WHERE id=?', [ci.ops_owner_id]) || {}).name || '') : '';
    res.json({
      ci_no: ci.ci_no,
      wac_confirmed: ci.wac_confirmed === 1,
      ops_owner_id: ci.ops_owner_id || '',
      ops_owner_name: ownerName,
      ops_plan_listing_date: ci.ops_plan_listing_date || '',
      ops_ready_status: ci.ops_ready_status || 'pending',
      cc: cc.map(r => ({ user_id: r.user_id, user_name: r.user_name }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 保存上架准备（分配负责人 + CC + 计划上架日期），事务内写库 + 通知
app.post('/api/commercial-invoices/:id/ops-prep', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI 不存在' });
    if (ci.wac_confirmed !== 1) return res.status(400).json({ error: 'CI 尚未确认（wac_confirmed=1），无法安排上架准备' });

    const ownerId = (req.body.owner_user_id || '').toString().trim();
    const planDate = (req.body.plan_listing_date || '').toString().trim();
    const ccIds = Array.isArray(req.body.cc_user_ids) ? req.body.cc_user_ids : [];
    if (!ownerId) return res.status(400).json({ error: '负责人不能为空' });
    const owner = queryOne('SELECT id, name, status FROM users WHERE id = ?', [ownerId]);
    if (!owner) return res.status(400).json({ error: '负责人不存在' });
    if (owner.status !== 'active') return res.status(400).json({ error: '负责人已停用' });

    const ccList = [];
    const seen = new Set();
    for (const raw of ccIds) {
      const uid = (raw || '').toString().trim();
      if (!uid || seen.has(uid)) continue;
      const u = queryOne('SELECT id, name, status FROM users WHERE id = ?', [uid]);
      if (!u) return res.status(400).json({ error: '抄送人「' + uid + '」不存在' });
      if (u.status !== 'active') return res.status(400).json({ error: '抄送人「' + (u.name || uid) + '」已停用，无法抄送' });
      seen.add(uid);
      ccList.push({ id: u.id, name: u.name });
    }

    transaction(() => {
      run('UPDATE commercial_invoices SET ops_owner_id = ?, ops_plan_listing_date = ?, ops_ready_status = ? WHERE id = ?', [ownerId, planDate, 'pending', ci.id]);
      run('DELETE FROM business_participants WHERE business_type=? AND business_id=? AND participant_type IN (?,?)', ['ci', ci.id, 'cc', 'owner']);
      run('INSERT INTO business_participants (id, business_type, business_id, participant_type, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)', [genId('bp'), 'ci', ci.id, 'owner', ownerId, owner.name]);
      for (const c of ccList) {
        run('INSERT INTO business_participants (id, business_type, business_id, participant_type, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)', [genId('bp'), 'ci', ci.id, 'cc', c.id, c.name]);
      }
    });

    // 事务外 best-effort 通知负责人 + CC（不阻塞、不影响写库结果）
    notifyBusinessParticipants('ci', ci.id, 'ci_ops_assigned', { code: ci.ci_no, plan_date: planDate }).catch(() => {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 标记上架准备完成（Ready）——仅负责人或管理员
app.post('/api/commercial-invoices/:id/ops-ready', requireApiPermission('ci_edit'), asyncHandler((req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI 不存在' });
    if (ci.wac_confirmed !== 1) return res.status(400).json({ error: 'CI 尚未确认，无法标记上架准备' });
    if (!ci.ops_owner_id) return res.status(400).json({ error: '尚未分配负责人，无法标记就绪' });
    const isOwner = ci.ops_owner_id === req.currentUserId;
    const isAdmin = (req.currentUserRole === 'role_admin') || (req.currentUserPermissions && req.currentUserPermissions.includes('*'));
    if (!isOwner && !isAdmin) return res.status(403).json({ error: '仅负责人或管理员可标记上架准备完成' });

    run('UPDATE commercial_invoices SET ops_ready_status = ? WHERE id = ?', ['ready', ci.id]);
    // best-effort 通知 CC
    notifyBusinessParticipants('ci', ci.id, 'ci_ops_ready', { code: ci.ci_no }).catch(() => {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 成本更新日志查询
app.get('/api/cost-update-logs', requireApiPermission('cost_view'), asyncHandler((req, res) => {
  try {
    const { ci_no, sku_code, keyword } = req.query;
    let sql = 'SELECT * FROM cost_update_logs WHERE 1=1';
    const params = [];
    if (ci_no) { sql += ' AND related_ci_no = ?'; params.push(ci_no); }
    if (sku_code) { sql += ' AND sku_code = ?'; params.push(sku_code); }
    if (keyword) { sql += ' AND (related_ci_no LIKE ? OR sku_code LIKE ? OR related_po_no LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
    sql += ' ORDER BY created_at DESC';
    res.json(query(sql, params).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// P1-03-B: WAC 历史版本查询（只读，按 CI 或 SKU+国家+仓库）
app.get('/api/wac-history', requireApiPermission('cost_view'), asyncHandler((req, res) => {
  try {
    const { ci_id, sku_code, country, warehouse } = req.query;
    let sql = 'SELECT * FROM wac_history WHERE 1=1';
    const params = [];
    if (ci_id) { sql += ' AND ci_id = ?'; params.push(ci_id); }
    if (sku_code) { sql += ' AND sku_code = ?'; params.push(sku_code); }
    if (country) { sql += ' AND country = ?'; params.push(country); }
    if (warehouse) { sql += ' AND warehouse = ?'; params.push(warehouse); }
    sql += ' ORDER BY version_no DESC';
    res.json(query(sql, params).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 获取CI的费用分摊明细
app.get('/api/cost-allocation/:ci_id', requireApiPermission('cost_view'), asyncHandler((req, res) => {
  try {
    const rows = query('SELECT * FROM cost_allocations WHERE ci_id = ? ORDER BY sku_code', [req.params.ci_id]).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

app.get('/api/cost-allocation/:ci_id/details', requireApiPermission('cost_view'), asyncHandler((req, res) => {
  try {
    const rows = query('SELECT * FROM cost_allocation_details WHERE ci_id = ? ORDER BY fee_key, stable_sort_order, sku_code', [req.params.ci_id]).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 库存盘点 ====================
app.get('/api/inventory-checks', requireApiPermission('check_view'), asyncHandler((req, res) => {
  const { country, warehouse, status } = req.query;
  let sql = `SELECT ic.*, s.product_name, s.brand FROM inventory_checks ic LEFT JOIN skus s ON ic.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND ic.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND ic.warehouse = ?'; params.push(warehouse); }
  if (status) { sql += ' AND ic.approval_status = ?'; params.push(status); }
  sql += ' ORDER BY ic.check_date DESC, ic.created_at DESC';
  res.json(query(sql, params).rows);
}));

// 生成盘点模板数据
app.get('/api/inventory-checks/template', requireApiPermission('check_view'), asyncHandler((req, res) => {
  const { country, warehouse } = req.query;
  let sql = `SELECT i.sku_code, s.product_name, s.brand, i.country, i.warehouse, i.available_qty as system_qty FROM inventory i LEFT JOIN skus s ON i.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND i.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND i.warehouse = ?'; params.push(warehouse); }
  sql += ' ORDER BY i.sku_code';
  res.json(query(sql, params).rows);
}));

// 导入盘点数据
app.post('/api/inventory-checks/bulk-import', requireApiPermission('check_create'), asyncHandler((req, res) => {
  try {
    const items = req.body.items || [];
    const result = { created: 0, failed: 0, errors: [] };
    transaction(() => {
      items.forEach((item, i) => {
        try {
          if (!item.sku_code || !item.check_date) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU或盘点日期为空' }); return; }
          const systemQty = parseInt(item.system_qty) || 0;
          const actualQty = parseInt(item.actual_qty) || 0;
          const diffQty = actualQty - systemQty;
          const inv = queryOne('SELECT weighted_avg_cost FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?', [item.sku_code, item.country, item.warehouse]);
          const avgCost = inv ? inv.weighted_avg_cost : 0;
          run(`INSERT INTO inventory_checks (id, check_no, country, warehouse, check_date, sku_code, system_qty, actual_qty, diff_qty, diff_amount, diff_reason, handle_method, approval_status, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('check'), `CHK-${Date.now()}-${i}`, item.country || '', item.warehouse || '', item.check_date, item.sku_code, systemQty, actualQty, diffQty, diffQty * avgCost, item.diff_reason || '', item.handle_method || 'pending', 'pending', item.remark || '']);
          result.created++;
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 盘点审批通过后调整库存
app.post('/api/inventory-checks/:id/approve', requireApiPermission('check_approve'), asyncHandler((req, res) => {
  try {
    const check = queryOne('SELECT * FROM inventory_checks WHERE id = ?', [req.params.id]);
    if (!check) return res.status(404).json({ error: '盘点记录不存在' });
    if (check.approval_status !== 'pending') return res.status(400).json({ error: '只能审批待处理记录' });

    run('UPDATE inventory_checks SET approval_status = ? WHERE id = ?', ['approved', req.params.id]);

    // 如果处理方式是调整库存
    if (check.handle_method === 'adjust' && check.diff_qty !== 0) {
      const inv = queryOne('SELECT id, available_qty FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?', [check.sku_code, check.country, check.warehouse]);
      if (inv) {
        run('UPDATE inventory SET available_qty = available_qty + ?, updated_at = datetime(\'now\') WHERE id = ?', [check.diff_qty, inv.id]);
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 呆滞库存分析 ====================
app.get('/api/stagnant-analysis', requireApiPermission('stagnant_view'), asyncHandler((req, res) => {
  const { country, warehouse, level } = req.query;
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
  const d60 = new Date(now.getTime() - 60 * 86400000).toISOString().split('T')[0];
  const d90 = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0];

  let sql = `SELECT i.sku_code, i.country, i.warehouse, i.available_qty, i.weighted_avg_cost, i.available_qty * i.weighted_avg_cost as inventory_value,
    s.product_name, s.brand, s.category, s.lifecycle_status, s.is_new_product,
    (SELECT MAX(order_date) FROM sales_records WHERE sku_code = i.sku_code AND is_valid_order = 1) as last_sale_date
    FROM inventory i LEFT JOIN skus s ON i.sku_code = s.sku_code WHERE i.available_qty > 0`;
  const params = [];
  if (country) { sql += ' AND i.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND i.warehouse = ?'; params.push(warehouse); }
  sql += ' ORDER BY i.sku_code';

  const items = query(sql, params).rows;
  const result = items.map(item => {
    const lastSaleDate = item.last_sale_date;
    const daysSinceSale = lastSaleDate ? Math.floor((now - new Date(lastSaleDate)) / 86400000) : 9999;

    const sales30 = queryOne('SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND is_valid_order = 1 AND order_date >= ?',
      [item.sku_code, d30])?.cnt || 0;
    const sales60 = queryOne('SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND is_valid_order = 1 AND order_date >= ?',
      [item.sku_code, d60])?.cnt || 0;
    const sales90 = queryOne('SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND is_valid_order = 1 AND order_date >= ?',
      [item.sku_code, d90])?.cnt || 0;

    const monthlyForecast = Math.ceil(sales90 / 3);
    const turnoverMonths = monthlyForecast > 0 ? item.available_qty / monthlyForecast : 999;

    let stagnantLevel = '';
    let suggestion = '';
    // 呆滞阈值改读 system_config（保持原有分级规则，仅让配置生效；缺省兜底原硬编码值）
    const cDead = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'stagnant_dead_days'")?.value || '180', 10);
    const cHeavy = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'stagnant_heavy_days'")?.value || '90', 10);
    const cMedium = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'stagnant_medium_days'")?.value || '60', 10);
    const cLight = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'stagnant_light_days'")?.value || '30', 10);
    if (item.is_new_product === 1) {
      stagnantLevel = 'new_product';
      suggestion = '新品数据不足，需人工判断';
    } else if (daysSinceSale >= cDead) {
      stagnantLevel = 'dead';
      suggestion = '死亡库存，建议报废或清仓';
    } else if (daysSinceSale >= cHeavy) {
      stagnantLevel = 'heavy';
      suggestion = '重度呆滞，建议清仓处理';
    } else if (daysSinceSale >= cMedium) {
      stagnantLevel = 'medium';
      suggestion = '中度呆滞，建议促销清仓';
    } else if (daysSinceSale >= cLight) {
      stagnantLevel = 'light';
      suggestion = '轻度呆滞，关注销售趋势';
    } else if (turnoverMonths > 12) {
      stagnantLevel = 'severe_backlog';
      suggestion = '严重积压，建议清仓';
    } else if (turnoverMonths > 6) {
      stagnantLevel = 'backlog';
      suggestion = '库存偏高，暂缓补货';
    } else {
      stagnantLevel = 'normal';
      suggestion = '正常';
    }

    return {
      ...item,
      days_since_sale: daysSinceSale >= 9999 ? null : daysSinceSale,
      sales_30d: sales30, sales_60d: sales60, sales_90d: sales90,
      monthly_forecast: monthlyForecast,
      turnover_months: Math.round(turnoverMonths * 10) / 10,
      stagnant_level: stagnantLevel,
      suggestion
    };
  });

  // 筛选呆滞等级
  let filtered = result;
  if (level && level !== 'all') {
    filtered = result.filter(r => r.stagnant_level === level);
  } else {
    filtered = result.filter(r => r.stagnant_level !== 'normal');
  }
  res.json(filtered);
}));

// ==================== 货代分析 ====================
app.get('/api/freight-forwarder-analysis', requireApiPermission('forwarder_view'), asyncHandler((req, res) => {
  const { country, forwarder_id, transport_mode } = req.query;
  let sql = `SELECT forwarder_id, forwarder_name, target_country, transport_mode,
    COUNT(*) as batch_count,
    SUM(goods_amount) as total_ci_amount,
    SUM(total_cbm) as total_cbm,
    SUM(total_weight) as total_weight,
    SUM(total_freight) as total_freight,
    SUM(customs_duty) as total_duty,
    AVG(CASE WHEN actual_arrival_date != '' AND depart_date != '' THEN (julianday(actual_arrival_date) - julianday(depart_date)) END) as avg_transport_days,
    AVG(CASE WHEN customs_end_date != '' AND customs_start_date != '' THEN (julianday(customs_end_date) - julianday(customs_start_date)) END) as avg_customs_days,
    AVG(CASE WHEN inbound_complete_date != '' AND delivery_date != '' THEN (julianday(inbound_complete_date) - julianday(delivery_date)) END) as avg_delivery_days
    FROM (
      SELECT lb.forwarder_id, lb.forwarder_name, lb.target_country, lb.transport_mode,
        lb.total_cbm, lb.total_weight, lb.total_freight, lb.customs_duty,
        lb.actual_arrival_date, lb.depart_date, lb.customs_start_date, lb.customs_end_date, lb.delivery_date, lb.inbound_complete_date,
        ci.goods_amount
      FROM logistics_batches lb
      LEFT JOIN commercial_invoices ci ON lb.related_ci_id = ci.id
      WHERE lb.logistics_status = 'completed'
    ) WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND target_country = ?'; params.push(country); }
  if (forwarder_id) { sql += ' AND forwarder_id = ?'; params.push(forwarder_id); }
  if (transport_mode) { sql += ' AND transport_mode = ?'; params.push(transport_mode); }
  sql += ' GROUP BY forwarder_id, forwarder_name, target_country, transport_mode ORDER BY total_freight DESC';

  const items = query(sql, params).rows;
  const result = items.map(item => {
    const freightRatio = item.total_ci_amount > 0 ? item.total_freight / item.total_ci_amount : 0;
    const freightPerCbm = item.total_cbm > 0 ? item.total_freight / item.total_cbm : 0;
    const freightPerKg = item.total_weight > 0 ? item.total_freight / item.total_weight : 0;
    return {
      ...item,
      freight_ratio: Math.round(freightRatio * 10000) / 100,
      freight_per_cbm: Math.round(freightPerCbm * 100) / 100,
      freight_per_kg: Math.round(freightPerKg * 100) / 100,
      avg_transport_days: item.avg_transport_days ? Math.round(item.avg_transport_days * 10) / 10 : null,
      avg_customs_days: item.avg_customs_days ? Math.round(item.avg_customs_days * 10) / 10 : null,
      avg_delivery_days: item.avg_delivery_days ? Math.round(item.avg_delivery_days * 10) / 10 : null,
    };
  });
  res.json(result);
}));

// ③ 应付到期/逾期提醒手动/外部 cron 触发端点（不增加定时任务/进程内 cron；best-effort）
app.post('/api/finance/payment-reminders/scan', requireApiPermission('payment_approve'), asyncHandler(async (req, res) => {
  try {
    const result = await scanPaymentReminders();
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ④ LOGISTICS-LISTING-01：上架状态提醒外部 cron 触发端点
// 与付款提醒同构：不引入进程内 cron/setInterval（Render Free 实例休眠会导致定时器停摆），
// 由外部调度器（Render Cron Job / cron-job.org 等）每日调用一次。
// 幂等：同一天重复调用不会重复发送（两个哨兵日期拦截）。
app.post('/api/logistics/listing-reminders/scan', requireApiPermission('logistics_edit'), asyncHandler(async (req, res) => {
  try {
    const result = await scanListingReminders();
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 首页看板 ====================
app.get('/api/dashboard', requireApiPermission('dashboard_view'), asyncHandler((req, res) => {
  try {
    // DATA-SCOPE: 首页看板数据权限过滤
    const dsf = buildDashboardScopeFilters(req);
    const rsScope = buildReplenishmentDataScopeFilter(req);

    // 总库存金额（普通库存，原币口径，不折 CNY）
    const totalInvBase = queryOne('SELECT COALESCE(SUM(available_qty * weighted_avg_cost), 0) as val FROM inventory WHERE 1=1' + dsf.inventory.sql, dsf.inventory.params)?.val || 0;
    // 寄售库存资产（原币口径，叠加 active 批次 remaining_inventory_value；与 inventory 相同数据权限 scope 过滤 country_name）
    const consignScope = adaptScopeToLots(dsf.inventory);
    const totalConsign = queryOne('SELECT COALESCE(SUM(remaining_inventory_value), 0) as val FROM consignment_inventory_lots WHERE status = \'active\'' + consignScope.sql, consignScope.params)?.val || 0;
    const totalInv = (Number(totalInvBase) || 0) + (Number(totalConsign) || 0);

    // 在途库存金额（用标准采购价估算）
    const transitInv = queryOne(`
      SELECT COALESCE(SUM((cii.shipped_qty - cii.inbound_qty) * cii.unit_price), 0) as val
      FROM commercial_invoice_items cii
      JOIN commercial_invoices ci ON cii.ci_id = ci.id
      WHERE ci.ci_status NOT IN ('cancelled', 'completed')
    ` + dsf.ciAlias.sql, dsf.ciAlias.params)?.val || 0;

    // 呆滞库存金额
    const stagnantInv = queryOne(`
      SELECT COALESCE(SUM(i.available_qty * i.weighted_avg_cost), 0) as val
      FROM inventory i
      WHERE i.available_qty > 0 AND i.sku_code IN (
        SELECT sku_code FROM skus WHERE lifecycle_status IN ('stagnant', 'clearance')
      )
    ` + dsf.inventory.sql.replace(/country/g, 'i.country').replace(/warehouse/g, 'i.warehouse'), dsf.inventory.params)?.val || 0;

    // 缺货风险SKU数量
    const shortageSkus = queryOne(`
      SELECT COUNT(DISTINCT i.sku_code) as cnt FROM inventory i
      WHERE i.available_qty <= 0 OR (i.weighted_avg_cost > 0 AND i.available_qty > 0
        AND NOT EXISTS (SELECT 1 FROM sales_records WHERE sku_code = i.sku_code AND is_valid_order = 1 AND order_date >= date('now', '-30 days')))
    ` + dsf.inventory.sql.replace(/country/g, 'i.country').replace(/warehouse/g, 'i.warehouse'), dsf.inventory.params)?.cnt || 0;

    // 建议采购金额
    const suggestAmount = queryOne(`
      SELECT COALESCE(SUM(rs.suggested_qty * s.standard_purchase_price), 0) as val
      FROM replenishment_suggestions rs
      LEFT JOIN skus s ON rs.sku_code = s.sku_code
      WHERE rs.suggested_qty > 0
    ` + rsScope.sql, rsScope.params)?.val || 0;

    // 7天内待付款金额
    const now = new Date();
    const d7 = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];
    const pay7 = queryOne(`SELECT COALESCE(SUM(unpaid_amount), 0) as val FROM payment_requests WHERE approval_status IN ('pending', 'approved') AND payment_status NOT IN ('paid', 'deduction_settled', 'rejected', 'cancelled') AND unpaid_amount > 0 AND payable_date != '' AND payable_date <= ?`, [d7])?.val || 0;

    // 30天内待付款金额
    const d30 = new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0];
    const pay30 = queryOne(`SELECT COALESCE(SUM(unpaid_amount), 0) as val FROM payment_requests WHERE approval_status IN ('pending', 'approved') AND payment_status NOT IN ('paid', 'deduction_settled', 'rejected', 'cancelled') AND unpaid_amount > 0 AND payable_date != '' AND payable_date <= ?`, [d30])?.val || 0;

    // 逾期付款金额
    const today = now.toISOString().split('T')[0];
    const overdue = queryOne(`SELECT COALESCE(SUM(unpaid_amount), 0) as val FROM payment_requests WHERE approval_status IN ('pending', 'approved') AND payment_status NOT IN ('paid', 'deduction_settled', 'rejected', 'cancelled') AND unpaid_amount > 0 AND payable_date != '' AND payable_date < ?`, [today])?.val || 0;

    // PO/PI/CI 未完成数量
    const poPending = queryOne("SELECT COUNT(*) as cnt FROM purchase_orders WHERE po_status NOT IN ('cancelled', 'transferred_pi')" + dsf.po.sql, dsf.po.params)?.cnt || 0;
    const piPending = queryOne("SELECT COUNT(*) as cnt FROM proforma_invoices WHERE pi_status NOT IN ('cancelled', 'shipped_complete')" + dsf.pi.sql, dsf.pi.params)?.cnt || 0;
    const ciPending = queryOne("SELECT COUNT(*) as cnt FROM commercial_invoices WHERE ci_status NOT IN ('cancelled', 'completed')" + dsf.ci.sql, dsf.ci.params)?.cnt || 0;

    // 运费占比趋势
    const freightTrend = query(`
      SELECT strftime('%Y-%m', lb.depart_date) as month,
        SUM(lb.total_freight) as freight,
        SUM(ci.goods_amount) as goods
      FROM logistics_batches lb
      LEFT JOIN commercial_invoices ci ON lb.related_ci_id = ci.id
      WHERE lb.depart_date != '' AND lb.depart_date >= date('now', '-6 months')
      GROUP BY month ORDER BY month
    ` + dsf.ciAlias.sql, dsf.ciAlias.params).rows.map(r => ({
      month: r.month,
      freight: r.freight || 0,
      goods: r.goods || 0,
      ratio: r.goods > 0 ? Math.round(r.freight / r.goods * 10000) / 100 : 0
    }));

    res.json({
      total_inventory_value: Math.round(totalInv * 100) / 100,
      available_inventory_value: Math.round(totalInv * 100) / 100,
      in_transit_value: Math.round(transitInv * 100) / 100,
      stagnant_value: Math.round(stagnantInv * 100) / 100,
      shortage_sku_count: shortageSkus,
      suggest_purchase_amount: Math.round(suggestAmount * 100) / 100,
      pay_7d_amount: Math.round(pay7 * 100) / 100,
      pay_30d_amount: Math.round(pay30 * 100) / 100,
      overdue_amount: Math.round(overdue * 100) / 100,
      freight_trend: freightTrend,
      po_pending: poPending,
      pi_pending: piPending,
      ci_pending: ciPending
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 资金风险总览 V1 ====================
// 口径（用户冻结 2026-08-05）：
// 1. 库存资产(CNY) = SUM(available_qty × weighted_avg_cost × foreignToRmb)
//    - 按 inventory.country → countries.default_currency 确定本币（与库存总表完全一致）
//    - 复用 exchange_rates 表中 from_currency=curr, to_currency='RMB' 的 foreignToRmb
//    - 缺失汇率时跳过该行（与库存总表 renderInvCards 行为一致）
// 2. 在途资产(CNY) = SUM(CI item 人民币货值 × 未入库比例)
//    - 按 CI 明细行计算：未入库比例 = (shipped_qty - inbound_qty) / shipped_qty
//    - 仅统计已发货(shipped_qty>0)且未完全入库的 CI item
//    - 不计入：仅 PO、仅 PI、未发货、已完全入库
// 3. 未来应付资金压力(CNY)：累计口径 today~today+7 / today~today+30 / today~today+90
//    - 排除逾期付款(payable_date < today)
//    - 优先使用 PAY-CORE 已确认人民币金额(rmb_amount/paid_amount 推算汇率)
// 不修改：库存逻辑、采购链逻辑、CI/PL业务逻辑、PAY-CORE业务逻辑
app.get('/api/financial-risk/overview', requireApiPermission('dashboard_view'), asyncHandler(async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // --- 国家→货币映射（与库存总表 /api/inventory/currency-rates 完全一致） ---
    const allCountries = query("SELECT name, default_currency FROM countries WHERE status = 'active' AND default_currency IS NOT NULL AND default_currency != ''").rows;
    const countryToCurrency = {};
    for (const c of allCountries) { countryToCurrency[c.name] = c.default_currency; }

    // --- 收集所有涉及币种（库存国家→币种 + CI 币种 + 付款申请币种） ---
    const invCountries = query("SELECT DISTINCT country FROM inventory WHERE country IS NOT NULL AND country != ''").rows.map(r => r.country);
    const ciCurrencies = query("SELECT DISTINCT currency FROM commercial_invoices WHERE currency IS NOT NULL AND currency != ''").rows.map(r => r.currency);
    const payCurrencies = query("SELECT DISTINCT currency FROM payment_requests WHERE currency IS NOT NULL AND currency != ''").rows.map(r => r.currency);
    // 未来应付口径已切换到 payable_items，需覆盖应付项币种用于 RMB 折算
    const payableItemCurrencies = query("SELECT DISTINCT currency FROM payable_items WHERE currency IS NOT NULL AND currency != ''").rows.map(r => r.currency);

    const allCurrenciesSet = new Set();
    // 库存国家→币种（与库存总表一致，支持别名）
    invCountries.forEach(country => {
      let curr = countryToCurrency[country];
      if (!curr && COUNTRY_ALIAS_MAP[country]) curr = countryToCurrency[COUNTRY_ALIAS_MAP[country]];
      if (curr) allCurrenciesSet.add(curr);
    });
    // CI币种
    ciCurrencies.forEach(curr => allCurrenciesSet.add(curr));
    // 付款申请币种
    payCurrencies.forEach(curr => allCurrenciesSet.add(curr));
    payableItemCurrencies.forEach(curr => allCurrenciesSet.add(curr));
    allCurrenciesSet.add('RMB');
    allCurrenciesSet.add('CNY');

    // --- foreignToRmb 汇率映射（与库存总表 /api/inventory/currency-rates 完全一致） ---
    // 库存总表逻辑：先查DB今天汇率 → 再查DB最新汇率 → 最后从API获取并缓存
    const foreignToRmbMap = {};
    foreignToRmbMap['RMB'] = 1;
    foreignToRmbMap['CNY'] = 1;

    for (const curr of allCurrenciesSet) {
      if (curr === 'RMB' || curr === 'CNY') continue;
      // 查DB中今天的汇率（与库存总表一致：只查 from_currency=curr, to_currency='RMB'）
      let row = queryOne('SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? ORDER BY created_at DESC LIMIT 1', [curr, 'RMB', today]);
      if (!row) {
        // 查DB中最新汇率（不限日期）
        row = queryOne('SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY rate_date DESC, created_at DESC LIMIT 1', [curr, 'RMB']);
      }
      if (row && Number(row.rate) > 0) {
        foreignToRmbMap[curr] = Number(row.rate);
      }
    }

    // 对缺失的汇率，从API获取（与库存总表 /api/inventory/currency-rates 步骤4完全一致）
    const missingCurrencies = Array.from(allCurrenciesSet).filter(c => c !== 'RMB' && c !== 'CNY' && !foreignToRmbMap[c]);
    if (missingCurrencies.length > 0) {
      try {
        const apiCode = 'CNY';
        const resp = await fetch(`https://open.er-api.com/v6/latest/${apiCode}`);
        const data = await resp.json();
        if (data && data.rates) {
          for (const curr of missingCurrencies) {
            const apiCurr = CURRENCY_API_MAP[curr] || curr;
            const cnyToForeign = data.rates[apiCurr]; // 1 CNY = X 外币（API直接返回）
            if (cnyToForeign && cnyToForeign > 0) {
              const foreignToRmb = 1 / cnyToForeign; // 换算为 1外币=X人民币
              foreignToRmbMap[curr] = foreignToRmb;
              // 缓存到DB（与库存总表一致，存foreignToRmb方便复用）
              run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',
                [genId('rate'), curr, 'RMB', foreignToRmb, today, 'realtime']);
            }
          }
        }
      } catch (fetchErr) {
        console.warn('[financial-risk] Failed to fetch real-time rates:', fetchErr.message);
      }
    }

    // --- 1. 库存资产(CNY) ---
    // 与库存总表 renderInvCards 完全一致：
    //   invVal = available_qty × weighted_avg_cost（本币）
    //   rmbTotal += invVal × foreignToRmb（按 inventory.country 确定本币）
    //   缺失汇率时跳过（与库存总表 if(ci.rate) 行为一致）
    const invRows = query(`
      SELECT i.available_qty, i.weighted_avg_cost, i.country
      FROM inventory i
      WHERE i.available_qty > 0 AND i.weighted_avg_cost > 0
    `).rows;
    let inventoryAssets = 0;
    const invMissingRates = []; // 记录缺失汇率的库存行
    for (const r of invRows) {
      let currency = countryToCurrency[r.country] || '';
      // 别名匹配（与 /api/inventory/currency-rates 一致）
      if (!currency && COUNTRY_ALIAS_MAP[r.country]) {
        currency = countryToCurrency[COUNTRY_ALIAS_MAP[r.country]] || '';
      }
      const rate = currency ? (foreignToRmbMap[currency] || null) : null;
      if (rate) {
        inventoryAssets += Number(r.available_qty) * Number(r.weighted_avg_cost) * rate;
      } else {
        // rate 缺失时跳过该行并记录（与库存总表一致，不fallback=1）
        invMissingRates.push({ country: r.country, currency: currency || '(unknown)' });
      }
    }
    // 寄售库存资产（CNY，与公司资产口径一致）：按 country_name 折算，复用同一汇率表与缺失汇率跳过逻辑
    // 注：本接口 inventory 查询未套用数据权限 scope，寄售此处同样不套用，保持与 inventory 完全一致
    const consignAssetRows = query(`SELECT country_name, COALESCE(SUM(remaining_inventory_value), 0) as v FROM consignment_inventory_lots WHERE status = 'active' GROUP BY country_name`).rows;
    for (const l of consignAssetRows) {
      const rate = getInventoryRate({ country: l.country_name }, countryToCurrency, foreignToRmbMap);
      if (rate) {
        inventoryAssets += Number(l.v) * rate;
      } else {
        invMissingRates.push({ country: l.country_name, currency: countryToCurrency[l.country_name] || '(unknown)' });
      }
    }
    if (invMissingRates.length > 0) {
      console.warn('[financial-risk] 库存资产：' + invMissingRates.length + ' 行缺失汇率，已跳过:', JSON.stringify(invMissingRates.slice(0, 5)));
    }

    // --- 2. 在途资产(CNY) ---
    // 按 CI 明细行计算：ci_amount × foreignToRmb × (shipped_qty - inbound_qty) / shipped_qty
    // 仅统计已发货且未完全入库的 CI item，不计入 PO/PI/未发货/已入库
    const transitRows = query(`
      SELECT cii.ci_amount, cii.shipped_qty, cii.inbound_qty, ci.currency
      FROM commercial_invoice_items cii
      JOIN commercial_invoices ci ON cii.ci_id = ci.id
      WHERE ci.ci_status NOT IN ('cancelled', 'completed')
        AND cii.shipped_qty > 0
        AND (cii.shipped_qty - COALESCE(cii.inbound_qty, 0)) > 0
    `).rows;
    let inTransitAssets = 0;
    const transitMissingRates = []; // 记录缺失汇率的CI明细（禁止 fallback=1）
    for (const r of transitRows) {
      const curr = (r.currency || '').toUpperCase();
      const rate = foreignToRmbMap[curr];
      if (!rate) {
        // 缺失汇率：禁止 fallback=1，跳过该行并记录
        transitMissingRates.push({ ci_currency: r.currency, ci_amount: r.ci_amount });
        continue;
      }
      const shippedQty = Number(r.shipped_qty);
      const inboundQty = Number(r.inbound_qty || 0);
      const uninboundRatio = (shippedQty - inboundQty) / shippedQty;
      const ciAmountRmb = Number(r.ci_amount || 0) * rate;
      inTransitAssets += ciAmountRmb * uninboundRatio;
    }
    if (transitMissingRates.length > 0) {
      console.warn('[financial-risk] 在途资产：' + transitMissingRates.length + ' 条 CI 明细缺失汇率，已跳过:', JSON.stringify(transitMissingRates.slice(0, 5)));
    }

    // --- 3. 未来应付资金压力(CNY) ---
    // 口径对齐「应付费用列表 / 驾驶舱」：数据源 = payable_items，不再用 payment_requests。
    //   payment_requests 仅代表付款执行过程（审批中/已批准待付款），不作为应付预测金额来源。
    // remaining = payable_amount_minor - 已付(payment_allocations reconciled) - 抵扣(deduction) - 抹零(rounding)
    //   （复用 payableItemsSettlementBreakdown，与应付列表/驾驶舱完全一致）
    // 过滤：remaining > 0 且 payable_date 存在且 >= today（排除逾期/无日期；逾期归入"已逾期未结"但不计入未来）
    // 时间桶：today~today+7 / +30 / +90
    // 币种：复用 foreignToRmbMap（缺失汇率跳过并告警，与库存/在途一致，禁止 fallback=1）
    // 付款申请状态（审批中/已批准待付款）仅作辅助展示拆分，不影响未来应付金额统计。
    const d7 = addDays(today, 7);
    const d30 = addDays(today, 30);
    const d90 = addDays(today, 90);

    const payItemRows = query(`
      SELECT pi.id, pi.payable_amount_minor, pi.currency, pi.payable_date, pi.lifecycle_status
      FROM payable_items pi
      WHERE pi.lifecycle_status IN ('active','reserved','partially_paid')
    `).rows;

    const piIds = payItemRows.map(r => r.id);
    const breakdownMap = payableItemsSettlementBreakdown(piIds);

    // 关联付款申请（仅辅助展示：已批准待付款 / 审批中），一次查询避免 N+1
    const linkedPrs = piIds.length ? query(`
      SELECT pri.payable_item_id AS payable_item_id, pr.approval_status
      FROM payment_request_items pri
      JOIN payment_requests pr ON pr.id = pri.payment_request_id
      WHERE pri.payable_item_id IN (${piIds.map(() => '?').join(',')})
        AND pr.payment_status NOT IN ('cancelled','rejected')
        AND pr.approval_status NOT IN ('cancelled','rejected')
    `, piIds).rows : [];
    const approvedItemIds = new Set();
    linkedPrs.forEach(p => { if (p.approval_status === 'approved') approvedItemIds.add(p.payable_item_id); });

    let pay7 = 0, pay30 = 0, pay90 = 0;
    let pay7Pending = 0, pay30Pending = 0, pay90Pending = 0;
    let pay7Approved = 0, pay30Approved = 0, pay90Approved = 0;
    const payMissingRates = []; // 记录缺失汇率的应付项（不静默按1计算）
    for (const pi of payItemRows) {
      // 复用应付列表同款 settlement 拆算：已付款 / 抵扣 / 抹零 / 剩余未付
      const b = breakdownMap.get(pi.id) || { paidMinor: 0, deductionMinor: 0, roundingMinor: 0 };
      const settledMinor = b.paidMinor + b.deductionMinor + b.roundingMinor;
      const remainingMinor = Math.max(0, Number(pi.payable_amount_minor || 0) - settledMinor);
      if (remainingMinor <= 0) continue;                       // 已结清 / 超额付清
      if (!pi.payable_date || pi.payable_date < today) continue; // 无日期或逾期 → 不计入"未来"
      const curr = (pi.currency || '').toUpperCase();
      const rate = foreignToRmbMap[curr];
      if (!rate) {
        // 缺失汇率：禁止 fallback=1，跳过并记录
        payMissingRates.push({ id: pi.id, currency: pi.currency, remaining_minor: remainingMinor });
        continue;
      }
      // 方案A：按审批状态拆分（已批准待付款=approved / 审批中=pending），总额不变（不影响预测）
      const rmb = (remainingMinor / 100) * rate;
      const isApproved = approvedItemIds.has(pi.id);
      if (pi.payable_date <= d7)  { pay7  += rmb; if (isApproved) pay7Approved  += rmb; else pay7Pending  += rmb; }
      if (pi.payable_date <= d30) { pay30 += rmb; if (isApproved) pay30Approved += rmb; else pay30Pending += rmb; }
      if (pi.payable_date <= d90) { pay90 += rmb; if (isApproved) pay90Approved += rmb; else pay90Pending += rmb; }
    }
    if (payMissingRates.length > 0) {
      console.warn('[financial-risk] 未来应付：' + payMissingRates.length + ' 条应付项缺失汇率，已跳过:', JSON.stringify(payMissingRates.slice(0, 5)));
    }

    const totalAssets = inventoryAssets + inTransitAssets;
    const round2 = (v) => Math.round(v * 100) / 100;

    res.json({
      total_assets: { value: round2(totalAssets), currency: 'CNY' },
      inventory_assets: { value: round2(inventoryAssets), currency: 'CNY' },
      in_transit_assets: { value: round2(inTransitAssets), currency: 'CNY' },
      future_payables: {
        days_7: { value: round2(pay7), currency: 'CNY', pending: round2(pay7Pending), approved: round2(pay7Approved) },
        days_30: { value: round2(pay30), currency: 'CNY', pending: round2(pay30Pending), approved: round2(pay30Approved) },
        days_90: { value: round2(pay90), currency: 'CNY', pending: round2(pay90Pending), approved: round2(pay90Approved) }
      },
      as_of: today
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== financial-risk 下钻接口 ====================

// 共用：构建 foreignToRmb 汇率映射（与 overview + 库存总表完全一致）
async function buildForeignToRmbMap(today, allCurrenciesSet) {
  const foreignToRmbMap = {};
  foreignToRmbMap['RMB'] = 1;
  foreignToRmbMap['CNY'] = 1;

  for (const curr of allCurrenciesSet) {
    if (curr === 'RMB' || curr === 'CNY') continue;
    let row = queryOne('SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? ORDER BY created_at DESC LIMIT 1', [curr, 'RMB', today]);
    if (!row) {
      row = queryOne('SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY rate_date DESC, created_at DESC LIMIT 1', [curr, 'RMB']);
    }
    if (row && Number(row.rate) > 0) {
      foreignToRmbMap[curr] = Number(row.rate);
    }
  }

  const missingCurrencies = Array.from(allCurrenciesSet).filter(c => c !== 'RMB' && c !== 'CNY' && !foreignToRmbMap[c]);
  if (missingCurrencies.length > 0) {
    try {
      const resp = await fetch(`https://open.er-api.com/v6/latest/CNY`);
      const data = await resp.json();
      if (data && data.rates) {
        for (const curr of missingCurrencies) {
          const apiCurr = CURRENCY_API_MAP[curr] || curr;
          const cnyToForeign = data.rates[apiCurr];
          if (cnyToForeign && cnyToForeign > 0) {
            const foreignToRmb = 1 / cnyToForeign;
            foreignToRmbMap[curr] = foreignToRmb;
            run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',
              [genId('rate'), curr, 'RMB', foreignToRmb, today, 'realtime']);
          }
        }
      }
    } catch (fetchErr) {
      console.warn('[financial-risk] Failed to fetch real-time rates:', fetchErr.message);
    }
  }
  return foreignToRmbMap;
}

// 共用：库存行 → 本币汇率（与 overview + 库存总表一致，支持别名）
function getInventoryRate(row, countryToCurrency, foreignToRmbMap) {
  let currency = countryToCurrency[row.country] || '';
  if (!currency && COUNTRY_ALIAS_MAP[row.country]) {
    currency = countryToCurrency[COUNTRY_ALIAS_MAP[row.country]] || '';
  }
  return currency ? (foreignToRmbMap[currency] || null) : null;
}

// 1. 库存资产下钻：国家 → 品牌 → 仓库 → SKU
app.get('/api/financial-risk/inventory-breakdown', requireApiPermission('dashboard_view'), asyncHandler(async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { country, brand, warehouse } = req.query;

    // 国家→币种映射
    const allCountries = query("SELECT name, default_currency FROM countries WHERE status = 'active' AND default_currency IS NOT NULL AND default_currency != ''").rows;
    const countryToCurrency = {};
    for (const c of allCountries) { countryToCurrency[c.name] = c.default_currency; }

    // 收集涉及币种
    const invCountries = query("SELECT DISTINCT country FROM inventory WHERE country IS NOT NULL AND country != ''").rows.map(r => r.country);
    const allCurrenciesSet = new Set(['RMB', 'CNY']);
    invCountries.forEach(c => {
      let curr = countryToCurrency[c];
      if (!curr && COUNTRY_ALIAS_MAP[c]) curr = countryToCurrency[COUNTRY_ALIAS_MAP[c]];
      if (curr) allCurrenciesSet.add(curr);
    });

    const foreignToRmbMap = await buildForeignToRmbMap(today, allCurrenciesSet);

    // 查库存数据（带 JOIN skus 获取 product_name + brand）
    const invRows = query(`
      SELECT i.sku_code, i.available_qty, i.weighted_avg_cost, i.country, i.warehouse,
             s.product_name, s.brand
      FROM inventory i
      LEFT JOIN skus s ON i.sku_code = s.sku_code
      WHERE i.available_qty > 0 AND i.weighted_avg_cost > 0
    `).rows;

    // 计算每行人民币金额 + 过滤
    const items = [];
    let total = 0;
    for (const r of invRows) {
      const rate = getInventoryRate(r, countryToCurrency, foreignToRmbMap);
      if (!rate) continue; // 缺失汇率跳过（与 overview 一致）

      // 下钻过滤
      if (country && r.country !== country) continue;
      if (brand && (s => s || '')(r.brand) !== brand) continue;
      if (warehouse && r.warehouse !== warehouse) continue;

      const amountCny = Number(r.available_qty) * Number(r.weighted_avg_cost) * rate;
      total += amountCny;
      items.push({
        sku_code: r.sku_code,
        product_name: r.product_name || '',
        available_qty: Number(r.available_qty),
        weighted_avg_cost: Number(r.weighted_avg_cost),
        country: r.country,
        brand: r.brand || '',
        warehouse: r.warehouse,
        amount_cny: amountCny
      });
    }

    // 寄售库存资产（CNY）：计入 total（明细下钻暂未扩展；本接口 inventory 未套 scope，寄售同样不套，与 inventory 一致）
    const consignBreakRows = query(`SELECT country_name, COALESCE(SUM(remaining_inventory_value), 0) as v FROM consignment_inventory_lots WHERE status = 'active' GROUP BY country_name`).rows;
    for (const l of consignBreakRows) {
      const rate = getInventoryRate({ country: l.country_name }, countryToCurrency, foreignToRmbMap);
      if (rate) total += Number(l.v) * rate;
    }

    // 确定当前维度
    let dimension;
    if (!country) dimension = 'country';
    else if (!brand) dimension = 'brand';
    else if (!warehouse) dimension = 'warehouse';
    else dimension = 'sku';

    if (dimension === 'sku') {
      // SKU 明细
      const sortedItems = items.sort((a, b) => b.amount_cny - a.amount_cny);
      const result = sortedItems.map(it => ({
        ...it,
        percentage: total > 0 ? Math.round(it.amount_cny / total * 1000) / 10 : 0
      }));
      return res.json({ total: Math.round(total * 100) / 100, dimension, items: result });
    }

    // 维度聚合
    const groupMap = {};
    for (const it of items) {
      let key, label;
      if (dimension === 'country') { key = it.country; label = it.country; }
      else if (dimension === 'brand') { key = it.brand || ''; label = it.brand || ''; }
      else { key = it.warehouse || ''; label = it.warehouse || ''; }

      if (!groupMap[key]) groupMap[key] = { key, label, amount_cny: 0 };
      groupMap[key].amount_cny += it.amount_cny;
    }

    const groups = Object.values(groupMap)
      .sort((a, b) => b.amount_cny - a.amount_cny)
      .map(g => ({
        ...g,
        amount_cny: Math.round(g.amount_cny * 100) / 100,
        percentage: total > 0 ? Math.round(g.amount_cny / total * 1000) / 10 : 0
      }));

    res.json({ total: Math.round(total * 100) / 100, dimension, groups });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// 2. 在途资产下钻：CI 级明细列表
app.get('/api/financial-risk/in-transit-breakdown', requireApiPermission('dashboard_view'), asyncHandler(async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 国家→币种映射
    const allCountries = query("SELECT name, default_currency FROM countries WHERE status = 'active' AND default_currency IS NOT NULL AND default_currency != ''").rows;
    const countryToCurrency = {};
    for (const c of allCountries) { countryToCurrency[c.name] = c.default_currency; }

    // 收集 CI 币种
    const ciCurrencies = query("SELECT DISTINCT currency FROM commercial_invoices WHERE currency IS NOT NULL AND currency != ''").rows.map(r => r.currency);
    const allCurrenciesSet = new Set(['RMB', 'CNY']);
    ciCurrencies.forEach(curr => allCurrenciesSet.add(curr));

    const foreignToRmbMap = await buildForeignToRmbMap(today, allCurrenciesSet);

    // 查在途 CI 明细（与 overview 相同条件）
    const transitRows = query(`
      SELECT cii.ci_id, cii.ci_amount, cii.shipped_qty, cii.inbound_qty,
             ci.ci_no, ci.currency, ci.brand, ci.country, ci.target_warehouse, ci.ci_status
      FROM commercial_invoice_items cii
      JOIN commercial_invoices ci ON cii.ci_id = ci.id
      WHERE ci.ci_status NOT IN ('cancelled', 'completed')
        AND cii.shipped_qty > 0
        AND (cii.shipped_qty - COALESCE(cii.inbound_qty, 0)) > 0
    `).rows;

    // 查关联物流批次状态（用于 logistics_display_status）
    const ciIds = [...new Set(transitRows.map(r => r.ci_id))];
    const lbMap = {}; // ci_id → 最高阶段 logistics_display_status
    if (ciIds.length > 0) {
      const lbRows = query(`SELECT related_ci_id, logistics_status FROM logistics_batches WHERE related_ci_id IN (${ciIds.map(() => '?').join(',')})`, ciIds).rows;
      for (const lb of lbRows) {
        const displayStatus = deriveLogisticsDisplayStatus(lb.logistics_status);
        lbMap[lb.related_ci_id] = displayStatus;
      }
    }

    // 按 CI 聚合
    const ciMap = {}; // ci_id → 聚合数据
    let total = 0;
    for (const r of transitRows) {
      const curr = (r.currency || '').toUpperCase();
      const rate = foreignToRmbMap[curr];
      if (!rate) continue; // 缺失汇率跳过（与 overview 一致）

      const shippedQty = Number(r.shipped_qty);
      const inboundQty = Number(r.inbound_qty || 0);
      const uninboundRatio = (shippedQty - inboundQty) / shippedQty;
      const ciAmountRmb = Number(r.ci_amount || 0) * rate;
      const amountCny = ciAmountRmb * uninboundRatio;

      total += amountCny;

      if (!ciMap[r.ci_id]) {
        // 派生入库状态
        let inboundStatus = 'none';
        if (inboundQty >= shippedQty) inboundStatus = 'completed';
        else if (inboundQty > 0) inboundStatus = 'partial';

        ciMap[r.ci_id] = {
          ci_no: r.ci_no,
          country: r.country || '',
          brand: r.brand || '',
          warehouse: r.target_warehouse || '',
          logistics_display_status: lbMap[r.ci_id] || 'pending_shipment',
          inbound_derived_status: inboundStatus,
          amount_cny: 0,
          _totalShipped: 0,
          _totalInbound: 0
        };
      }
      ciMap[r.ci_id].amount_cny += amountCny;
      ciMap[r.ci_id]._totalShipped += shippedQty;
      ciMap[r.ci_id]._totalInbound += inboundQty;
    }

    // 重新计算 CI 级入库状态（基于所有明细行的汇总）
    const items = Object.values(ciMap).map(ci => {
      let inboundStatus = 'none';
      if (ci._totalInbound > 0 && ci._totalInbound >= ci._totalShipped) inboundStatus = 'completed';
      else if (ci._totalInbound > 0) inboundStatus = 'partial';

      delete ci._totalShipped;
      delete ci._totalInbound;
      return {
        ...ci,
        inbound_derived_status: inboundStatus,
        amount_cny: Math.round(ci.amount_cny * 100) / 100
      };
    }).sort((a, b) => b.amount_cny - a.amount_cny);

    res.json({
      total: Math.round(total * 100) / 100,
      items
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ==================== 批量操作辅助函数 ====================

const INVENTORY_STATUS_MAP = {
  '正常':'normal','断货风险':'out_of_stock_risk','高库存':'high_stock',
  '慢销':'slow_moving','清仓':'clearance','异常':'abnormal',
  'normal':'normal','out_of_stock_risk':'out_of_stock_risk','high_stock':'high_stock',
  'slow_moving':'slow_moving','clearance':'clearance','abnormal':'abnormal'
};

const INVENTORY_STATUS_LABELS = {
  'normal':'正常','out_of_stock_risk':'断货风险','high_stock':'高库存',
  'slow_moving':'慢销','clearance':'清仓','abnormal':'异常'
};

const OUTBOUND_STATUS_LABELS = {
  'normal':'正常','voided':'已作废'
};

// 出库类型默认是否参与预测
const OUTBOUND_TYPE_FORECAST_DEFAULT = {
  'sale':1,'online_sale':1,'offline_sale':1,
  'transfer':0,'sample':0,'damage':0,'return_out':0,'manual_adjustment':0,
  'mdf_influencer':0,'mdf_event':0,'scrap':0
};

function logOperation({operator_id, operator_name, page, operation_type, target_ids, affected_count, old_values, new_values, reason, triggered_recalc, is_rollbackable}) {
  try {
    run(`INSERT INTO operation_logs (id, operator_id, operator_name, page, operation_type, target_ids, affected_count, old_values, new_values, reason, triggered_recalc, is_rollbackable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [genId('oplog'), operator_id||'', operator_name||'', page||'', operation_type||'', JSON.stringify(target_ids||[]), affected_count||0, JSON.stringify(old_values||{}), JSON.stringify(new_values||{}), reason||'', triggered_recalc?1:0, is_rollbackable?1:0]);
  } catch(e) { console.error('[logOperation]', e.message); }
}

function createBatchTask({task_name, operation_type, operator_id, operator_name, page, total_count, is_rollbackable}) {
  const taskId = genId('batch');
  run(`INSERT INTO batch_tasks (id, task_name, operation_type, operator_id, operator_name, page, status, total_count, is_rollbackable) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
    [taskId, task_name, operation_type||'', operator_id||'', operator_name||'', page||'', total_count||0, is_rollbackable?1:0]);
  return taskId;
}

function finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable}) {
  run(`UPDATE batch_tasks SET status='completed', success_count=?, failed_count=?, skipped_count=?, error_report=?, finished_at=datetime('now'), is_rollbackable=? WHERE id=?`,
    [success||0, failed||0, skipped||0, JSON.stringify(errors||[]), is_rollbackable?1:0, taskId]);
}

// 重新计算指定SKU+国家+仓库的库存相关数据
function recalcInventoryForSku(sku_code, country, warehouse, options = {}) {
  try {
    const skipStatus = options.skipStatus || false; // 手动设置状态时不覆盖
    // 计算最近销售日期（从销售明细表）
    const lastOut = queryOne(`SELECT MAX(order_date) as d FROM sales_records WHERE sku_code=? AND is_valid_order=1`, [sku_code]);
    // 计算最近90天有效销量
    const sales90 = queryOne(`SELECT COALESCE(SUM(quantity),0) as qty FROM sales_records WHERE sku_code=? AND is_valid_order=1 AND order_date >= date('now','-90 days')`, [sku_code]);
    // 月均销量 = 90天/3
    const avgMonthly = Math.round((sales90?.qty || 0) / 3);
    // 可用库存（P2-9-A：同步读取 weighted_avg_cost 用于重算 inventory_value，避免库存数量变更后 inventory_value 与 available_qty * wac 不一致）
    const inv = queryOne('SELECT available_qty, safety_stock, target_turnover_months, inventory_status, weighted_avg_cost FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [sku_code, country, warehouse]);
    if (inv) {
      const available = inv.available_qty || 0;
      const turnover = avgMonthly > 0 ? Math.round((available / avgMonthly) * 10) / 10 : 0;
      // P2-9-A：同步重算 inventory_value（WAC 保持不变，仅数量变化触发价值重算）
      const inventoryValue = Math.round(((available * (Number(inv.weighted_avg_cost) || 0)) + Number.EPSILON) * 100) / 100;
      if (skipStatus) {
        // 只更新周转/出库日期，不覆盖手动设置的库存状态
        run(`UPDATE inventory SET last_outbound_date=?, turnover_months=?, inventory_value=?, updated_at=datetime('now') WHERE sku_code=? AND country=? AND warehouse=?`,
          [lastOut?.d || '', turnover, inventoryValue, sku_code, country, warehouse]);
      } else {
        // 自动判断库存状态
        let autoStatus = 'normal';
        if (available <= 0) autoStatus = 'out_of_stock_risk';
        else if (inv.target_turnover_months > 0 && turnover > inv.target_turnover_months * 1.5) autoStatus = 'high_stock';
        else if (avgMonthly > 0 && turnover > inv.target_turnover_months * 2) autoStatus = 'slow_moving';
        else if (available <= (inv.safety_stock || 0)) autoStatus = 'out_of_stock_risk';
        run(`UPDATE inventory SET last_outbound_date=?, turnover_months=?, inventory_status=?, inventory_value=?, updated_at=datetime('now') WHERE sku_code=? AND country=? AND warehouse=?`,
          [lastOut?.d || '', turnover, autoStatus, inventoryValue, sku_code, country, warehouse]);
      }
    }
  } catch(e) { console.error('[recalcInventoryForSku]', e.message); }
}

// 异步库存重算（PG 模式专用）：复用 pg-async.js 连接池，不阻塞事件循环。
// 业务逻辑与 recalcInventoryForSku 完全一致，仅将同步 queryOne/run 替换为异步 aqOne/arun。
async function recalcInventoryForSkuPg(aqOne, arun, sku_code, country, warehouse) {
  try {
    const lastOut = await aqOne(`SELECT MAX(order_date) as d FROM sales_records WHERE sku_code=? AND is_valid_order=1`, [sku_code]);
    const sales90 = await aqOne(`SELECT COALESCE(SUM(quantity),0) as qty FROM sales_records WHERE sku_code=? AND is_valid_order=1 AND order_date >= date('now','-90 days')`, [sku_code]);
    const avgMonthly = Math.round((sales90?.qty || 0) / 3);
    const inv = await aqOne('SELECT available_qty, safety_stock, target_turnover_months, inventory_status, weighted_avg_cost FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [sku_code, country, warehouse]);
    if (inv) {
      const available = inv.available_qty || 0;
      const turnover = avgMonthly > 0 ? Math.round((available / avgMonthly) * 10) / 10 : 0;
      const inventoryValue = Math.round(((available * (Number(inv.weighted_avg_cost) || 0)) + Number.EPSILON) * 100) / 100;
      let autoStatus = 'normal';
      if (available <= 0) autoStatus = 'out_of_stock_risk';
      else if (inv.target_turnover_months > 0 && turnover > inv.target_turnover_months * 1.5) autoStatus = 'high_stock';
      else if (avgMonthly > 0 && turnover > inv.target_turnover_months * 2) autoStatus = 'slow_moving';
      else if (available <= (inv.safety_stock || 0)) autoStatus = 'out_of_stock_risk';
      await arun(`UPDATE inventory SET last_outbound_date=?, turnover_months=?, inventory_status=?, inventory_value=?, updated_at=datetime('now') WHERE sku_code=? AND country=? AND warehouse=?`,
        [lastOut?.d || '', turnover, autoStatus, inventoryValue, sku_code, country, warehouse]);
    }
  } catch(e) { console.error('[recalcInventoryForSkuPg]', e.message); }
}

// 销售导入后后台库存重算：PG 模式下异步执行，不阻塞导入响应。
// 逐 SKU 执行，单个 SKU 失败不影响其他 SKU（与同步版行为一致）。
async function recalcInventoryForSkusBackground(importId, affectedSkus) {
  const store = createSalesImportRunStoreForCurrentDb();
  try {
    await store.update(importId, { recalc_status: 'running' });
    console.log('[sales-import] background recalc started for', affectedSkus.length, 'SKUs');

    const recalcStart = Date.now();
    await withAsyncPoolClient(async (aq, aqOne, arun) => {
      for (const sku of affectedSkus) {
        try {
          const invRows = await aq('SELECT country, warehouse FROM inventory WHERE sku_code = ?', [sku]);
          for (const inv of invRows) {
            await recalcInventoryForSkuPg(aqOne, arun, sku, inv.country, inv.warehouse);
          }
        } catch (e) {
          console.error('[recalc-bg] SKU=' + sku + ':', e.message);
        }
      }
    });

    const elapsed = Date.now() - recalcStart;
    await store.update(importId, { recalc_status: 'completed' });
    console.log('[sales-import] background recalc completed in', elapsed, 'ms for', affectedSkus.length, 'SKUs');
  } catch (e) {
    console.error('[sales-import] background recalc failed:', e.message);
    try { await store.update(importId, { recalc_status: 'failed' }); } catch (_) {}
  }
}

// ==================== 库存总表批量操作 ====================

// 批量设置库存状态
app.post('/api/inventory/batch-set-status', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const { ids, status, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const statusVal = INVENTORY_STATUS_MAP[status] || status;
    if (!INVENTORY_STATUS_MAP[statusVal]) return res.status(400).json({ error: '无效的库存状态' });

    const taskId = createBatchTask({task_name:'批量设置库存状态', operation_type:'set_status', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;

    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.inventory_status;
          run('UPDATE inventory SET inventory_status=?, updated_at=datetime(\'now\') WHERE id=?', [statusVal, id]);
          // 触发重算（跳过状态覆盖，保留手动设置的状态）
          recalcInventoryForSku(inv.sku_code, inv.country, inv.warehouse, {skipStatus: true});
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_status', target_ids:[id], affected_count:1, old_values:{inventory_status:oldVal}, new_values:{inventory_status:statusVal}, reason:reason||'', triggered_recalc:1, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量设置是否重点关注
app.post('/api/inventory/batch-set-focused', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const { ids, is_focused, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量设置重点关注', operation_type:'set_focused', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.is_focused;
          run('UPDATE inventory SET is_focused=?, updated_at=datetime(\'now\') WHERE id=?', [is_focused?1:0, id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_focused', target_ids:[id], affected_count:1, old_values:{is_focused:oldVal}, new_values:{is_focused:is_focused?1:0}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量设置安全库存
app.post('/api/inventory/batch-set-safety-stock', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const { ids, safety_stock, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const val = parseInt(safety_stock);
    if (isNaN(val) || val < 0) return res.status(400).json({ error: '安全库存必须为非负整数' });
    const taskId = createBatchTask({task_name:'批量设置安全库存', operation_type:'set_safety_stock', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.safety_stock;
          run('UPDATE inventory SET safety_stock=?, updated_at=datetime(\'now\') WHERE id=?', [val, id]);
          recalcInventoryForSku(inv.sku_code, inv.country, inv.warehouse);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_safety_stock', target_ids:[id], affected_count:1, old_values:{safety_stock:oldVal}, new_values:{safety_stock:val}, reason:reason||'', triggered_recalc:1, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量设置目标周转月数
app.post('/api/inventory/batch-set-turnover', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const { ids, target_turnover_months, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const val = parseFloat(target_turnover_months);
    if (isNaN(val) || val < 0) return res.status(400).json({ error: '目标周转月数必须为非负数' });
    const taskId = createBatchTask({task_name:'批量设置目标周转月数', operation_type:'set_turnover', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.target_turnover_months;
          run('UPDATE inventory SET target_turnover_months=?, updated_at=datetime(\'now\') WHERE id=?', [val, id]);
          recalcInventoryForSku(inv.sku_code, inv.country, inv.warehouse);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_turnover', target_ids:[id], affected_count:1, old_values:{target_turnover_months:oldVal}, new_values:{target_turnover_months:val}, reason:reason||'', triggered_recalc:1, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量设置补货规则
app.post('/api/inventory/batch-set-replenish-rule', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const { ids, replenishment_rule, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量设置补货规则', operation_type:'set_replenish_rule', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.replenishment_rule;
          run('UPDATE inventory SET replenishment_rule=?, updated_at=datetime(\'now\') WHERE id=?', [replenishment_rule||'', id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_replenish_rule', target_ids:[id], affected_count:1, old_values:{replenishment_rule:oldVal}, new_values:{replenishment_rule:replenishment_rule||''}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量设置库存备注
app.post('/api/inventory/batch-set-remark', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const { ids, inventory_remark, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量设置库存备注', operation_type:'set_remark', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.inventory_remark;
          run('UPDATE inventory SET inventory_remark=?, updated_at=datetime(\'now\') WHERE id=?', [inventory_remark||'', id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_remark', target_ids:[id], affected_count:1, old_values:{inventory_remark:oldVal}, new_values:{inventory_remark:inventory_remark||''}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量发起库存调整单
app.post('/api/inventory/batch-adjust', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const { ids, adjust_type, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    if (!reason) return res.status(400).json({ error: '调整原因不能为空' });
    const taskId = createBatchTask({task_name:'批量发起库存调整单', operation_type:'inventory_adjust', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:false});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          // 创建调整单记录（待审批，不直接修改库存）
          const adjNo = `ADJ-${Date.now()}-${Math.random().toString(36).substring(2,6)}`;
          run(`INSERT INTO inventory_adjustments (id, adj_no, inventory_id, sku_code, country, warehouse, before_qty, adjust_qty, after_qty, adjust_type, reason, operator_id, operator_name, approval_status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'pending')`,
            [genId('adj'), adjNo, id, inv.sku_code, inv.country, inv.warehouse, inv.available_qty, inv.available_qty, adjust_type||'manual', reason, req.currentUserId, req.currentUserName]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'inventory_adjust', target_ids:[id], affected_count:1, old_values:{available_qty:inv.available_qty}, new_values:{adjustment_no:adjNo}, reason, triggered_recalc:0, is_rollbackable:0});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:false});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 库存批量删除（带关联数据检查，强制 reason）
app.post('/api/inventory/batch-delete', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const { ids, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    if (!reason || !reason.trim()) return res.status(400).json({ error: '删除原因不能为空' });
    // 关联数据检查
    const checks = [
      { table: 'inventory_imports', label: '库存导入' },
      { table: 'outbound_records', label: '出库记录' },
      { table: 'sales_records', label: '销售明细' },
      { table: 'inventory_adjustments', label: '库存调整单' }
    ];
    const result = { deleted: 0, failed: 0, errors: [] };
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { result.failed++; result.errors.push({id, reason:'记录不存在'}); return; }
          // 检查关联数据
          for (const c of checks) {
            const keyCol = c.table === 'inventory_imports' || c.table === 'inventory_adjustments' ? 'sku_code' : 'sku_code';
            const r = queryOne(`SELECT COUNT(*) as cnt FROM ${c.table} WHERE sku_code=? AND country=? AND warehouse=?`, [inv.sku_code, inv.country, inv.warehouse]);
            if (r.cnt > 0) {
              result.failed++;
              result.errors.push({id, sku_code:inv.sku_code, country:inv.country, warehouse:inv.warehouse, reason:`已关联${c.label}（${r.cnt}条），不允许删除`});
              return;
            }
          }
          run('DELETE FROM inventory WHERE id=?', [id]);
          logOperation({
            operator_id:req.currentUserId, operator_name:req.currentUserName,
            page:'inventory', operation_type:'delete',
            target_ids:[id], affected_count:1,
            old_values:{sku_code:inv.sku_code, country:inv.country, warehouse:inv.warehouse, available_qty:inv.available_qty},
            new_values:{},
            reason:reason.trim(), triggered_recalc:1, is_rollbackable:0
          });
          result.deleted++;
        } catch(e) { result.failed++; result.errors.push({id, reason:e.message}); }
      });
    });
    res.json(result);
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 库存批量操作预览
app.post('/api/inventory/batch-preview', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const placeholders = ids.map(()=>'?').join(',');
    const rows = query(`SELECT i.*, s.product_name, s.brand FROM inventory i LEFT JOIN skus s ON i.sku_code=s.sku_code WHERE i.id IN (${placeholders})`, ids).rows;
    const skuSet = new Set(rows.map(r=>r.sku_code));
    const totalQty = rows.reduce((s,r)=>s+(r.available_qty||0), 0);
    res.json({
      total_records: rows.length,
      total_records: rows.length,
      sku_count: skuSet.size,
      total_available_qty: totalQty,
      countries: [...new Set(rows.map(r=>r.country))],
      warehouses: [...new Set(rows.map(r=>r.warehouse))]
    });
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// ==================== 出库数据批量操作 ====================

// 批量作废
app.post('/api/outbound-records/batch-void', requireApiPermission('outbound_create'), asyncHandler((req, res) => {
  try {
    const { ids, void_reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    if (!void_reason) return res.status(400).json({ error: '作废原因不能为空' });
    const taskId = createBatchTask({task_name:'批量作废出库记录', operation_type:'void', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:false});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    const affectedSkus = []; // 需要重算的SKU+国家+仓库

    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能重复作废'}); return; }
          // 作废
          run('UPDATE outbound_records SET outbound_status=?, void_reason=?, voided_at=datetime(\'now\'), voided_by=? WHERE id=?',
            ['voided', void_reason, req.currentUserName, id]);
          // 回滚库存：只有 inventory_effect='deducted'（当初扣减了库存）才回滚
          if (ob.inventory_effect === 'deducted' || (ob.consume_inventory === 1 && !ob.inventory_effect)) {
            const inv = queryOne('SELECT * FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [ob.sku_code, ob.country, ob.warehouse]);
            if (inv) {
              run('UPDATE inventory SET available_qty=available_qty+?, updated_at=datetime(\'now\') WHERE id=?', [ob.quantity, inv.id]);
              affectedSkus.push({sku_code: ob.sku_code, country: ob.country, warehouse: ob.warehouse});
            }
          }
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'void', target_ids:[id], affected_count:1, old_values:{outbound_status:'normal', inventory_effect: ob.inventory_effect}, new_values:{outbound_status:'voided', void_reason}, reason:void_reason, triggered_recalc:1, is_rollbackable:0});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
      // 重算受影响的库存
      affectedSkus.forEach(s => recalcInventoryForSku(s.sku_code, s.country, s.warehouse));
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:false});
    res.json({success, failed, skipped, errors, task_id:taskId, recalc_count: affectedSkus.length});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量修改出库类型
app.post('/api/outbound-records/batch-set-type', requireApiPermission('outbound_create'), asyncHandler((req, res) => {
  try {
    const { ids, outbound_type, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    if (!outbound_type) return res.status(400).json({ error: '出库类型不能为空' });
    const taskId = createBatchTask({task_name:'批量修改出库类型', operation_type:'set_type', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    const affectedSkus = [];
    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能修改'}); return; }
          const oldType = ob.outbound_type;
          // 根据新类型自动设置预测参与
          const newForecast = OUTBOUND_TYPE_FORECAST_DEFAULT[outbound_type] !== undefined ? OUTBOUND_TYPE_FORECAST_DEFAULT[outbound_type] : ob.count_for_forecast;
          run('UPDATE outbound_records SET outbound_type=?, count_for_forecast=? WHERE id=?', [outbound_type, newForecast, id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'set_type', target_ids:[id], affected_count:1, old_values:{outbound_type:oldType, count_for_forecast:ob.count_for_forecast}, new_values:{outbound_type, count_for_forecast:newForecast}, reason:reason||'', triggered_recalc:1, is_rollbackable:1});
          if (ob.count_for_forecast !== newForecast) affectedSkus.push({sku_code: ob.sku_code, country: ob.country, warehouse: ob.warehouse});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
      affectedSkus.forEach(s => recalcInventoryForSku(s.sku_code, s.country, s.warehouse));
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量修改渠道
app.post('/api/outbound-records/batch-set-channel', requireApiPermission('outbound_create'), asyncHandler((req, res) => {
  try {
    const { ids, channel, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量修改渠道', operation_type:'set_channel', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能修改'}); return; }
          const oldVal = ob.channel;
          run('UPDATE outbound_records SET channel=? WHERE id=?', [channel||'', id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'set_channel', target_ids:[id], affected_count:1, old_values:{channel:oldVal}, new_values:{channel:channel||''}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量修改平台
app.post('/api/outbound-records/batch-set-platform', requireApiPermission('outbound_create'), asyncHandler((req, res) => {
  try {
    const { ids, platform, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量修改平台', operation_type:'set_platform', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能修改'}); return; }
          const oldVal = ob.platform;
          run('UPDATE outbound_records SET platform=? WHERE id=?', [platform||'', id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'set_platform', target_ids:[id], affected_count:1, old_values:{platform:oldVal}, new_values:{platform:platform||''}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量设置是否参与预测
app.post('/api/outbound-records/batch-set-forecast', requireApiPermission('outbound_create'), asyncHandler((req, res) => {
  try {
    const { ids, count_for_forecast, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const forecastVal = count_for_forecast ? 1 : 0;
    const taskId = createBatchTask({task_name:'批量设置是否参与预测', operation_type:'set_forecast', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    const affectedSkus = [];
    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能修改'}); return; }
          const oldVal = ob.count_for_forecast;
          run('UPDATE outbound_records SET count_for_forecast=? WHERE id=?', [forecastVal, id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'set_forecast', target_ids:[id], affected_count:1, old_values:{count_for_forecast:oldVal}, new_values:{count_for_forecast:forecastVal}, reason:reason||'', triggered_recalc:1, is_rollbackable:1});
          if (oldVal !== forecastVal) affectedSkus.push({sku_code: ob.sku_code, country: ob.country, warehouse: ob.warehouse});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
      affectedSkus.forEach(s => recalcInventoryForSku(s.sku_code, s.country, s.warehouse));
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 批量修改备注
app.post('/api/outbound-records/batch-set-remark', requireApiPermission('outbound_create'), asyncHandler((req, res) => {
  try {
    const { ids, remark, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量修改备注', operation_type:'set_remark', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能修改'}); return; }
          const oldVal = ob.remark;
          run('UPDATE outbound_records SET remark=? WHERE id=?', [remark||'', id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'set_remark', target_ids:[id], affected_count:1, old_values:{remark:oldVal}, new_values:{remark:remark||''}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 出库批量操作预览
app.post('/api/outbound-records/batch-preview', requireApiPermission('outbound_view'), asyncHandler((req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const placeholders = ids.map(()=>'?').join(',');
    const rows = query(`SELECT o.*, s.brand FROM outbound_records o LEFT JOIN skus s ON o.sku_code=s.sku_code WHERE o.id IN (${placeholders})`, ids).rows;
    const skuSet = new Set(rows.map(r=>r.sku_code));
    const totalQty = rows.reduce((s,r)=>s+(r.quantity||0), 0);
    const voidedCount = rows.filter(r=>r.outbound_status==='voided').length;
    const forecastCount = rows.filter(r=>r.count_for_forecast===1).length;
    res.json({
      total_records: rows.length,
      sku_count: skuSet.size,
      total_quantity: totalQty,
      voided_count: voidedCount,
      forecast_count: forecastCount
    });
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// ==================== 批量任务中心 & 操作日志 ====================

app.get('/api/batch-tasks', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  try {
    const { page, limit } = req.query;
    let sql = 'SELECT * FROM batch_tasks';
    const params = [];
    if (page) { sql += ' WHERE page = ?'; params.push(page); }
    sql += ' ORDER BY started_at DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
    else { sql += ' LIMIT 100'; }
    res.json(query(sql, params).rows);
  } catch(e) { res.status(500).json({error:e.message}); }
}));

app.get('/api/batch-tasks/:id', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  try {
    const task = queryOne('SELECT * FROM batch_tasks WHERE id=?', [req.params.id]);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json(task);
  } catch(e) { res.status(500).json({error:e.message}); }
}));

app.get('/api/operation-logs', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  try {
    const { page, operation_type, limit } = req.query;
    let sql = 'SELECT * FROM operation_logs';
    const params = [];
    const conditions = [];
    if (page) { conditions.push('page = ?'); params.push(page); }
    if (operation_type) { conditions.push('operation_type = ?'); params.push(operation_type); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit) || 100);
    res.json(query(sql, params).rows);
  } catch(e) { res.status(500).json({error:e.message}); }
}));

app.get('/api/inventory-adjustments', requireApiPermission('inventory_view'), asyncHandler((req, res) => {
  try {
    const { approval_status } = req.query;
    let sql = 'SELECT * FROM inventory_adjustments';
    const params = [];
    if (approval_status) { sql += ' WHERE approval_status = ?'; params.push(approval_status); }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    res.json(query(sql, params).rows);
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// 库存调整单审批
app.post('/api/inventory-adjustments/:id/approve', requireApiPermission('inventory_import'), asyncHandler((req, res) => {
  try {
    const adj = queryOne('SELECT * FROM inventory_adjustments WHERE id=?', [req.params.id]);
    if (!adj) return res.status(404).json({ error: '调整单不存在' });
    if (adj.approval_status !== 'pending') return res.status(400).json({ error: '调整单状态不允许审批' });
    // 审批通过：执行库存调整
    if (req.body.action === 'approve') {
      const inv = queryOne('SELECT * FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [adj.sku_code, adj.country, adj.warehouse]);
      if (inv) {
        const afterQty = (inv.available_qty || 0) + (req.body.adjust_qty || 0);
        run('UPDATE inventory SET available_qty=?, updated_at=datetime(\'now\') WHERE id=?', [afterQty, inv.id]);
        run('UPDATE inventory_adjustments SET approval_status=?, after_qty=?, executed_at=datetime(\'now\') WHERE id=?', ['approved', afterQty, adj.id]);
        recalcInventoryForSku(adj.sku_code, adj.country, adj.warehouse);
      }
    } else {
      run('UPDATE inventory_adjustments SET approval_status=? WHERE id=?', ['rejected', adj.id]);
    }
    logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'adjust_approve', target_ids:[adj.id], affected_count:1, old_values:{approval_status:'pending'}, new_values:{approval_status:req.body.action==='approve'?'approved':'rejected'}, reason:req.body.reason||'', triggered_recalc:req.body.action==='approve'?1:0, is_rollbackable:0});
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
}));

// ==================== 启动服务 ====================
// 顶层异常保护：避免未捕获异常导致进程静默退出（进程退出后前端会 Failed to fetch）
process.on('uncaughtException', (err) => {
  console.error('[FATAL] 未捕获异常，服务即将退出:', err && err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] 未处理的 Promise 拒绝:', reason);
});

// ==================== 启动前环境诊断（Render 部署排查用）====================
// 在任何 DB 操作之前检查所有必需环境变量，避免进程静默退出导致 Render 只显示 "Application exited early"
if (require.main === module) {
  console.log('\n========== 启动前环境诊断 ==========');
  console.log(`[DIAG] NODE_ENV = ${NODE_ENV || '(未设置)'}`);
  console.log(`[DIAG] DB_DRIVER = ${process.env.DB_DRIVER || '(默认 sqlite)'}`);
  console.log(`[DIAG] PORT = ${PORT}`);
  console.log(`[DIAG] DATABASE_URL = ${process.env.DATABASE_URL ? '已设置 (长度=' + process.env.DATABASE_URL.length + ')' : '❌ 未设置'}`);
  console.log(`[DIAG] BREAKGLASS_ADMIN_PASSWORD = ${BREAKGLASS_ADMIN_PASSWORD ? '已设置 (长度=' + BREAKGLASS_ADMIN_PASSWORD.length + ', 强度=' + (isStrongPassword(BREAKGLASS_ADMIN_PASSWORD) ? '合格' : '❌不合格') + ')' : '❌ 未设置'}`);
  console.log(`[DIAG] FEISHU_APP_ID = ${FEISHU_APP_ID ? '已设置' : '(未设置)'}`);
  console.log(`[DIAG] FEISHU_APP_SECRET = ${FEISHU_APP_SECRET ? '已设置' : '(未设置)'}`);
  console.log(`[DIAG] FEISHU_REDIRECT_URI = ${FEISHU_REDIRECT_URI || '(未设置)'}`);
  console.log(`[DIAG] TRUSTED_ORIGINS = ${TRUSTED_ORIGINS.length > 0 ? TRUSTED_ORIGINS.join(', ') : '(未设置)'}`);
  console.log(`[DIAG] COOKIE_SECURE = ${COOKIE_SECURE}`);
  console.log(`[DIAG] CSRF_DISABLE = ${CSRF_DISABLE}`);

  // PG 模式下 DATABASE_URL 是必需的
  if ((process.env.DB_DRIVER || '').toLowerCase() === 'pg' && !process.env.DATABASE_URL) {
    console.error('\n[FATAL] DB_DRIVER=pg 但 DATABASE_URL 未设置！请在 Render Dashboard → Environment 中配置 DATABASE_URL（Supabase 直连串）。');
    console.error('[FATAL] 格式：postgresql://postgres:<密码>@db.<项目ref>.supabase.co:5432/postgres');
    process.exit(1);
  }

  // BREAKGLASS_ADMIN_PASSWORD 缺失或弱密码会导致 bootstrapBreakGlass 抛异常
  if (!BREAKGLASS_ADMIN_PASSWORD || !isStrongPassword(BREAKGLASS_ADMIN_PASSWORD)) {
    console.error('\n[FATAL] BREAKGLASS_ADMIN_PASSWORD 未设置或强度不足（需≥12位且含大小写与数字）！');
    console.error('[FATAL] 请在 Render Dashboard → Environment 中配置 BREAKGLASS_ADMIN_PASSWORD。');
    console.error('[FATAL] bootstrapBreakGlass() 会在 app.listen() 之前抛出异常，导致进程立即退出。');
    process.exit(1);
  }

  console.log('[DIAG] 环境变量检查通过 ✓');
  console.log('=====================================\n');
}

// break-glass 本地管理员初始化（fail-closed：缺强密码则启动失败）
// P0-FIX-1：仅在直接运行 server.js 时执行启动副作用（app.listen / bootstrapBreakGlass / initDatabase）
// require(server.js) 作为模块时不执行，避免脚本污染真实库
if (require.main === module) {
  // 用 try-catch 包裹启动序列，确保任何异常都有清晰的日志输出（Render 排查用）
  try {
    console.log('[STARTUP] 开始初始化 break-glass 管理员...');
    bootstrapBreakGlass();
    console.log('[STARTUP] break-glass 管理员初始化完成 ✓');
  } catch (e) {
    console.error('\n[FATAL] bootstrapBreakGlass() 失败:', e.message);
    console.error(e.stack);
    console.error('\n[FATAL] 服务无法启动。请检查上述错误并修正环境变量配置。');
    process.exit(1);
  }

  console.log('[STARTUP] 正在启动 HTTP 服务 (端口 ' + PORT + ')...');
  const server = app.listen(PORT, () => {
    console.log(`\n[Server] 进销存管理系统已启动: http://localhost:${PORT}`);
    console.log(`[Server] 登录方式：飞书 OAuth（中国/印尼团队统一）；应急入口：登录页底部"应急登录入口"`);
    console.log(`[Server] 默认账号 admin/admin 已停用；break-glass 本地管理员须通过 BREAKGLASS_ADMIN_PASSWORD 初始化\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[ERROR] 端口 ${PORT} 已被占用，服务无法启动。`);
      console.error(`        请先停止占用该端口的程序，或修改 server.js 中的 PORT 后重试。`);
      console.error(`        否则前端访问时会提示 "Failed to fetch"（连不上后端）。\n`);
    } else {
      console.error('[ERROR] 服务启动失败:', err && err.stack || err);
    }
    process.exit(1);
  });
}

// PAY-CORE P0-1：供 scripts/backfill-payable-items.js 复用，不影响运行时
module.exports = {
  syncLogisticsCostFactsCore,
  createPayableItemFromSource,
  findActivePayableItem,
  syncPayableItemAmount,
  reservePayableItem,
  releasePayableItem,
  releasePayableItemsByPR,
  syncMultiSourcePiStatus,
  recalculatePaymentSettlement,
  payableItemSourceExpenseCountry,
  resolvePaymentFxRate,
  exactSettlementRate,
  buildPaymentRateSnapshot,
  isValidRateDate,
  app
};
