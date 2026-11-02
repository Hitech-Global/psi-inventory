'use strict';

/**
 * 平台接入链接契约测试。
 * ============================================================================================
 * 背景：授权回调跳回前端时会带上查询参数。此前存在两个真实缺陷：
 *
 *   1. TikTok 回调跳到首页 `/?tiktok=connected`，但**只有接入页读这个参数**，
 *      首页从不读取 → 连接成功的提示被直接丢弃，用户看不到任何反馈；
 *   2. ERP / Brand Portal 的回调同样跳首页，而首页也从不读取
 *      → 三个平台的回调结果全部静默丢失。
 *
 * 本测试锁定：
 *   - 每个平台的回调都跳到**会读它那个参数**的页面；
 *   - 每个页面都真的读取了对应参数；
 *   - 参数消费后从地址栏移除，避免刷新时重复提示。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const webDir = path.join(ROOT, 'web');
const router = fs.readFileSync(path.join(ROOT, 'src', 'http-router.js'), 'utf8');
const indexJs = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
const connectionsHtml = fs.readFileSync(path.join(webDir, 'connections.html'), 'utf8');

/**
 * 取某个路由的完整实现块。
 */
function routeBlock(route) {
  const index = router.indexOf(`router.get('${route}'`);
  assert.ok(index > 0, `缺少路由 ${route}`);
  const start = router.lastIndexOf('router.get(', index);
  // 到下一个路由为止：路由块的长度会随代码变化，固定长度会把后面才写的
  // 断言漏在片段之外。
  const next = router.indexOf('router.get(', index + 1);
  return router.slice(start, next > index ? next : index + 900);
}

// ---- 每个回调都跳到会读它那个参数的页面 ----

// TikTok → 接入页（接入页读 tiktok 参数）
const tiktokCallback = routeBlock('/tiktok/oauth/callback');
assert.match(
  tiktokCallback,
  /res\.redirect\(302, '\/connections\?tiktok=connected/,
  'TikTok 回调必须跳到接入页 —— 首页不读 tiktok 参数',
);
assert.match(
  connectionsHtml,
  /params\.get\('tiktok'\) === 'connected'/,
  '接入页必须读取 tiktok 参数',
);

// ERP / Brand Portal → 首页（首页读 erp / brand_portal 参数）
const erpCallback = routeBlock('/erp/oauth/callback');
assert.match(
  erpCallback,
  /erp: 'connected'/,
  'ERP 回调必须跳到首页',
);
assert.match(
  erpCallback,
  /res\.redirect\(302, '\/\?' \+ params\.toString\(\)\)/,
  'ERP 回调必须跳到首页',
);
// 授权的店铺里没有读者要的那一家时，必须说出来，否则读者会以为那家也连上了
assert.match(
  erpCallback,
  /expectedShopConnected === false/,
  'ERP 回调必须说明期望店铺是否连上',
);
assert.match(
  erpCallback,
  /需要用能访问该店铺的账号重新授权/,
  'ERP 回调必须给出补救办法',
);
const brandPortalCallback = routeBlock('/brand-portal/oauth/callback');
assert.match(
  brandPortalCallback,
  /res\.redirect\(302, '\/\?brand_portal=connected/,
  'Brand Portal 回调必须跳到首页',
);

// ---- 首页必须读三个平台的参数 ----

for (const [param, label] of [
  ['erp', 'ERP'],
  ['brand_portal', 'Brand Portal'],
  ['tiktok', 'TikTok Shop'],
]) {
  assert.match(
    indexJs,
    new RegExp(`params\\.get\\('${param}'\\)`),
    `首页必须读取 ${param} 参数，否则 ${label} 的回调结果会被丢弃`,
  );
}

// ---- 回调提示函数存在且被调用 ----

assert.match(indexJs, /function showOauthCallbackNotice\(\)/, '首页缺少回调提示函数');
assert.match(
  indexJs,
  /async function init\(\)\s*\{[\s\S]{0,200}showOauthCallbackNotice\(\)/,
  'init 必须调用回调提示函数',
);

// ---- 参数消费后从地址栏移除 ----

assert.match(
  indexJs,
  /history\.replaceState/,
  '首页消费参数后必须清理地址栏，避免刷新时重复提示',
);
assert.match(
  connectionsHtml,
  /history\.replaceState/,
  '接入页消费参数后必须清理地址栏',
);

// ---- 首页入口指向接入页 ----

// 接入页入口搬到了设置菜单里
const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
const authUi = fs.readFileSync(path.join(webDir, 'auth-ui-v1.js'), 'utf8');
assert.match(indexHtml, /data-side-platform="shopee"/, '侧边栏必须有接入页入口');
assert.match(indexHtml, /href="\/connections"/, '侧边栏的入口必须指向接入页');
// 链接要留在侧边栏里，不能散落到别处
const sideNav = indexHtml.slice(indexHtml.indexOf('<nav class="side-nav"'), indexHtml.indexOf('</nav>'));
assert.match(sideNav, /href="\/connections"/, '接入页链接必须在侧边栏内');
assert.doesNotMatch(indexHtml.slice(0, indexHtml.indexOf('<aside')), /href="\/connections"/, '侧边栏之外不应再有接入页链接');

console.log('Shopee analytics platform connection links contract: ok');
