'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  ROLE_SUPER_ADMIN, ROLE_OPERATOR, loadFeishuAuthConfig, normalizeReturnPath,
  hashToken, parseCookies, cookieHeader, requestedShopIds, authorizedShopIds, assertShopAccess,
} = require('../src/feishu-auth');

assert.strictEqual(normalizeReturnPath('/ads?x=1'), '/ads?x=1');
assert.strictEqual(normalizeReturnPath('//evil.example'), '/');
assert.strictEqual(hashToken('same'), hashToken('same'));
assert.deepStrictEqual(parseCookies('a=1; shopee_ops_session=abc%201'), { a:'1', shopee_ops_session:'abc 1' });
const cookie = cookieHeader('session', 'secret', { secure:true, maxAgeSeconds:60 });
assert(cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Lax'));

const disabled = loadFeishuAuthConfig({ FEISHU_AUTH_ENABLE:'NO' });
assert.strictEqual(disabled.enabled, false);
assert.throws(() => loadFeishuAuthConfig({ FEISHU_AUTH_ENABLE:'YES' }), /FEISHU_APP_ID/);
const enabled = loadFeishuAuthConfig({ FEISHU_AUTH_ENABLE:'YES', FEISHU_APP_ID:'cli_test', FEISHU_APP_SECRET:'secret', FEISHU_EXTERNAL_BASE_URL:'https://analytics.example.com' });
assert.strictEqual(enabled.sessionDays, 30);
assert.strictEqual(enabled.absoluteDays, 90);
assert.strictEqual(enabled.bootstrapFirstUser, false);
const firstUserBootstrap = loadFeishuAuthConfig({ FEISHU_AUTH_ENABLE:'YES', FEISHU_APP_ID:'cli_test', FEISHU_APP_SECRET:'secret', FEISHU_EXTERNAL_BASE_URL:'https://analytics.example.com', FEISHU_BOOTSTRAP_FIRST_USER:'YES' });
assert.strictEqual(firstUserBootstrap.bootstrapFirstUser, true);

const req = { path:'/shops/30/detail', query:{ shop_id:'10', shop_ids:'20,30' }, body:{ targetShopId:40 } };
assert.deepStrictEqual(requestedShopIds(req).sort((a,b) => a-b), [10,20,30,40]);
const operatorReq = { auth:{ enabled:true, role:ROLE_OPERATOR, shopIds:[10,20] } };
assert.deepStrictEqual(authorizedShopIds(operatorReq, []), [10,20]);
assert.deepStrictEqual(authorizedShopIds(operatorReq, [10]), [10]);
assert.throws(() => assertShopAccess(operatorReq, 30), error => error.status === 403 && error.code === 'SHOP_ACCESS_DENIED');
assert.deepStrictEqual(authorizedShopIds({ auth:{ enabled:true, role:ROLE_SUPER_ADMIN, shopIds:[] } }, []), []);

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
for (const table of ['shopee_users','shopee_user_shops','shopee_auth_sessions','shopee_auth_login_states']) {
  assert(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must exist in schema`);
}
const server = fs.readFileSync(path.join(root, 'src', 'standalone-server.js'), 'utf8');
assert(server.includes("createFeishuAuth({ pool, reviewerAuth })"));
assert(server.includes("app.get('/auth/feishu/login', feishuAuth.handleLogin)"));
assert(server.includes("app.get('/auth/feishu/callback', feishuAuth.handleCallback)"));
assert(server.includes('feishuAuth.requireApiSession, feishuAuth.enforceShopAccess'));
assert(server.indexOf("app.get('/api/shopee-analytics/health'") < server.indexOf('feishuAuth.requireApiSession, feishuAuth.enforceShopAccess'), 'health endpoint must stay outside auth middleware for Docker healthchecks');
const ui = fs.readFileSync(path.join(root, 'web', 'auth-ui-v1.js'), 'utf8');
assert(ui.includes('settings-menu-wrap'));
assert(ui.includes('/api/shopee-auth/admin/users'));
assert(ui.includes("role:'OPERATOR'"));
console.log('Feishu auth and shop authorization contract: ok');
