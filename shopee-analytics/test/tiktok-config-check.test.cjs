'use strict';

/**
 * TikTok 开放平台配置自检的测试。
 *
 * ★ 为什么要有这个
 *   之前点「授权」只会得到一个 TIKTOK_APP_KEY_MISSING 错误码 ——
 *   读的人不知道还缺哪些、去哪拿。
 *   现在页面会先自检，把缺哪几项、去哪取、填进去会怎样说清楚。
 *
 * 这个测试锁住三件事：
 *   1. 自检端点存在，且**只回「配没配」，不回值**（密钥不能进响应）；
 *   2. 点授权前会先自检，缺配置时不跳转；
 *   3. 店铺授权与广告授权是**两套独立变量**，清单里不混。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const router = fs.readFileSync(path.join(__dirname, '..', 'src', 'http-router.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'platform-connections-ui-v1.js'), 'utf8');
const envExample = fs.readFileSync(
  path.join(__dirname, '..', 'deploy', 'desktop', 'runtime.env.example'), 'utf8',
);

function testConfigEndpointExists() {
  assert.match(router, /router\.get\('\/tiktok\/config'/, '缺少 TikTok 配置自检端点');
  // 端点必须列出店铺授权与广告授权两套 —— 它们是独立的应用。
  assert.match(router, /TIKTOK_APP_KEY/, '自检清单里应有店铺授权的 app_key');
  assert.match(router, /TIKTOK_MARKETING_APP_ID/, '自检清单里应有广告授权的 app_id');
  // 每项都要说明去哪拿 —— 只说「缺了」没用。
  assert.match(router, /where:/, '配置项要说明去哪里取得');
}

function testConfigEndpointNeverReturnsSecrets() {
  // ★ 响应里只能有「配没配」，不能有值本身。
  //   这里检查代码里没有把 process.env 的值放进响应。
  const endpoint = router.slice(
    router.indexOf("router.get('/tiktok/config'"),
    router.indexOf("router.get('/tiktok/status'"),
  );
  assert.ok(endpoint.length > 100, '找不到配置端点的实现');
  // 允许用 process.env[key] 做判断，但不允许把值塞进响应字段。
  assert.doesNotMatch(
    endpoint,
    /value:\s*process\.env|secret:\s*process\.env|key:\s*process\.env\[/,
    '响应里不能回传环境变量的值 —— 密钥不能进响应',
  );
  assert.match(
    endpoint,
    /configured:\s*Boolean\(String\(process\.env\[item\.key\]/,
    '应当只回 configured 布尔值',
  );
}

function testShopAndMarketingVariablesAreSeparate() {
  // 两套凭据不能混 —— 这是整个广告线设计的前提。
  const shopKeys = ['TIKTOK_APP_KEY', 'TIKTOK_APP_SECRET', 'TIKTOK_SERVICE_ID', 'TIKTOK_REDIRECT_URL'];
  const marketingKeys = ['TIKTOK_MARKETING_APP_ID', 'TIKTOK_MARKETING_APP_SECRET', 'TIKTOK_MARKETING_REDIRECT_URL'];
  for (const key of shopKeys) {
    assert.ok(router.includes(key), `缺少店铺授权变量 ${key}`);
    assert.ok(envExample.includes(key), `runtime.env.example 里缺少 ${key}`);
  }
  for (const key of marketingKeys) {
    assert.ok(router.includes(key), `缺少广告授权变量 ${key}`);
    assert.ok(envExample.includes(key), `runtime.env.example 里缺少 ${key}`);
  }
  // ★ 营销变量不能被误当成店铺变量用 —— TIKTOK_MARKETING_APP_ID 不是 TIKTOK_APP_KEY。
  assert.doesNotMatch(
    envExample,
    /^TIKTOK_MARKETING_APP_ID=.*TIKTOK_APP_KEY/m,
    '示例里不要把两套凭据写成同一个值',
  );
}

function testAuthorizeStartGivesActionableError() {
  // 授权前要检查配置，缺了就给清单 —— 而不是让用户撞错误码。
  const start = router.slice(
    router.indexOf("router.get('/tiktok/oauth/start'"),
    router.indexOf("router.get('/tiktok/oauth/callback'"),
  );
  assert.match(start, /TIKTOK_CONFIG_INCOMPLETE/, '缺配置时应给专门的错误码');
  assert.match(start, /missing/, '应列出缺了哪些变量');
  assert.match(start, /hint/, '应给出下一步该做什么');
}

function testUiChecksConfigBeforeNavigating() {
  // 点授权前先自检；缺配置时留在原地并显示清单。
  assert.match(ui, /renderTiktokConfig/, '前端应有配置清单的渲染函数');
  assert.match(ui, /id="platformTiktokConfig"/, '应有配置清单的容器');
  const click = ui.slice(
    ui.indexOf("event.target.closest('#platformTiktokConnect')"),
    ui.indexOf("event.target.closest('#platformTiktokConnect')") + 1400,
  );
  assert.match(click, /tiktok\/config/, '点授权前应先查配置');
  assert.match(click, /shop\.ready/, '应根据配置是否齐全决定是否跳转');
  assert.match(click, /renderTiktokConfig/, '缺配置时应就地显示清单');
}

function testUiHasItsOwnEscapeHtml() {
  // ★ app.js 里的 escapeHtml 是局部函数，没挂到 window ——
  //   跨文件用它是未定义引用，渲染时才炸。
  assert.match(
    ui,
    /function escapeHtml\s*\(/,
    '本文件必须自带 escapeHtml，不能依赖别的文件的局部实现',
  );
}

function testEnvExampleDocumentsEveryVariable() {
  // 示例配置要说明每个变量是干什么的 —— 空着的一行没人知道填什么。
  assert.match(envExample, /# ===== TikTok Shop 开放平台/, '示例里应有店铺授权的分节说明');
  assert.match(envExample, /# ===== TikTok Marketing API/, '示例里应有广告授权的分节说明');
  assert.match(envExample, /TIKTOK_REDIRECT_URL=https/, '示例里回调地址应给出可用的默认值');
}

const tests = [
  ['配置自检端点存在', testConfigEndpointExists],
  ['自检不回传密钥', testConfigEndpointNeverReturnsSecrets],
  ['店铺与广告两套变量分开', testShopAndMarketingVariablesAreSeparate],
  ['授权前给可操作的错误', testAuthorizeStartGivesActionableError],
  ['前端点授权前先自检', testUiChecksConfigBeforeNavigating],
  ['前端自带 escapeHtml', testUiHasItsOwnEscapeHtml],
  ['示例配置有说明', testEnvExampleDocumentsEveryVariable],
];

async function main() {
  let passed = 0;
  const failures = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
    } catch (error) {
      failures.push({ name, error });
    }
  }
  if (failures.length) {
    for (const f of failures) {
      process.stderr.write(`❌ ${f.name}\n   ${f.error && f.error.message}\n`);
    }
    throw new Error(`${failures.length} 个测试失败（共 ${tests.length} 个）`);
  }
  process.stdout.write(`tiktok config check tests passed (${passed} cases)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
