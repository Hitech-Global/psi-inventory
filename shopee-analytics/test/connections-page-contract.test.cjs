'use strict';

/**
 * 平台接入页与 TikTok 路由契约测试。
 *
 * 覆盖：
 *   1. 前端页面存在且引用了双平台入口与正确的 API 路径；
 *   2. TikTok 路由已注册，且写操作要求超级管理员；
 *   3. 页面在服务端被正确托管（/connections 需要登录态）。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const webDir = path.join(ROOT, 'web');

// ---- 页面存在且内容正确 ----

const connectionsPath = path.join(webDir, 'connections.html');
assert.ok(fs.existsSync(connectionsPath), '缺少 web/connections.html');
const html = fs.readFileSync(connectionsPath, 'utf8');

// 双平台都要有卡片
assert.match(html, /data-platform="shopee"/, '页面必须有 Shopee 平台卡片');
assert.match(html, /data-platform="tiktok"/, '页面必须有 TikTok 平台卡片');

// API 路径必须正确
assert.match(html, /\/api\/shopee-analytics\/tiktok\/status/, '页面必须调用 TikTok 状态端点');
assert.match(html, /\/api\/shopee-analytics\/tiktok\/oauth\/start/, '页面必须跳到 TikTok 授权入口');

// 必须有中英双语
assert.match(html, /zh:\s*\{/, '页面必须有中文文案');
assert.match(html, /en:\s*\{/, '页面必须有英文文案');

// 不回显 cipher 明文 —— 那是内部标识，前端只需知道是否已绑定
assert.ok(!/shopCipher|shop_cipher/.test(html), '页面不得回显 cipher 明文');
// 只用 cipherBound 这类布尔状态
assert.match(html, /cipherBound/, '页面应只展示 cipher 是否已绑定');

// ---- 主应用有入口 ----

const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
assert.match(indexHtml, /href="\/connections"/, '主界面必须提供平台接入入口');

// ---- 服务端托管与路由 ----

const standalone = fs.readFileSync(path.join(ROOT, 'src', 'standalone-server.js'), 'utf8');
assert.match(
  standalone,
  /app\.get\('\/connections',\s*feishuAuth\.requireWebSession/,
  '平台接入页必须要求登录态',
);
assert.match(standalone, /new TikTokOAuthService\(\{ pool \}\)/, '必须实例化 TikTok 授权服务');
assert.match(
  standalone,
  /tiktokOAuthService,/,
  '必须把 TikTok 授权服务注入路由',
);

const router = fs.readFileSync(path.join(ROOT, 'src', 'http-router.js'), 'utf8');
assert.match(router, /router\.get\('\/tiktok\/status'/, '必须有 TikTok 状态端点');
assert.match(router, /router\.get\('\/tiktok\/oauth\/start'/, '必须有 TikTok 授权入口');
assert.match(router, /router\.get\('\/tiktok\/oauth\/callback'/, '必须有 TikTok 授权回调');

// 写操作（发起授权与回调）必须要求超级管理员
for (const route of ['/tiktok/oauth/start', '/tiktok/oauth/callback']) {
  const index = router.indexOf(`router.get('${route}'`);
  assert.ok(index > 0, `缺少路由 ${route}`);
  const block = router.slice(index, index + 900);
  assert.match(
    block,
    /ROLE_SUPER_ADMIN/,
    `${route} 必须限制为超级管理员`,
  );
}

// ---- i18n 有对应条目 ----

const i18n = fs.readFileSync(path.join(webDir, 'i18n-v1.js'), 'utf8');
assert.match(i18n, /'平台接入',\s*'Platform Connections'/, 'i18n 缺少平台接入条目');

console.log('Shopee analytics platform connections contract: ok');
