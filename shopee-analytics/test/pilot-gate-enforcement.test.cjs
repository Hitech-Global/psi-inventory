'use strict';

/**
 * Pilot gate enforcement contract
 * ============================================================================================
 * `src/pilot-gate.js` evaluates the four acceptance gates, but the evaluation alone does not
 * block anything. The desktop deployment and the README both promise that historical backfill
 * stays blocked until the real-shop pilot gate passes:
 *
 *   - deploy/desktop/README.md: "Only after the pilot store passes reconciliation, run
 *     historical backfill."
 *   - install-desktop.ps1: "Historical backfill remains disabled until the real-shop pilot
 *     gate passes."
 *
 * This test asserts the wiring actually exists in the backfill entry point, so the promise
 * cannot silently regress back to "advisory only".
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const backfill = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backfill-all-shops.cjs'), 'utf8');
const acceptance = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'pilot-acceptance.cjs'), 'utf8');
const desktopReadme = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'README.md'), 'utf8');
const installScript = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'install-desktop.ps1'), 'utf8');

// ---- backfill 必须真正调用门禁断言 ------------------------------------------------
assert.match(
  backfill,
  /require\('\.\.\/src\/pilot-gate-store'\)/,
  'backfill 必须引入 pilot-gate-store',
);
assert.match(
  backfill,
  /assertPilotGateAllowsBackfill\(\{\s*shopId:\s*shop\.shopId\s*\}\)/,
  'backfill 必须按店铺调用 assertPilotGateAllowsBackfill',
);

// 门禁断言必须在真正写数据之前（runBackfillShop 之前）
const gateIndex = backfill.indexOf('assertPilotGateAllowsBackfill({');
const writeIndex = backfill.indexOf('runBackfillShop({');
assert.ok(gateIndex > 0, 'backfill 必须包含门禁断言');
assert.ok(writeIndex > 0, 'backfill 必须包含写入调用');
assert.ok(gateIndex < writeIndex, '门禁断言必须在写入历史数据之前执行');

// 所有店铺的门禁必须在任何写入之前一次性检查完 —— 否则多店铺运行会先写完已验收店铺，
// 再在未验收店铺上失败，留下半完成状态。
// 用括号配平精确定位「包含写入调用的那个循环体」，断言门禁断言不在其中。
function loopBodyContaining(source, needle) {
  const needleIndex = source.indexOf(needle);
  if (needleIndex < 0) return null;
  const loopStart = source.lastIndexOf('for (const shop of shops) {', needleIndex);
  if (loopStart < 0) return null;
  let depth = 0;
  for (let i = source.indexOf('{', loopStart); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(loopStart, i + 1);
    }
  }
  return null;
}

const writeLoopBody = loopBodyContaining(backfill, 'runBackfillShop({');
assert.ok(writeLoopBody, '必须能定位包含写入调用的店铺循环');
assert.ok(
  !writeLoopBody.includes('assertPilotGateAllowsBackfill({'),
  '门禁检查不得位于写入循环内：多店铺运行必须先全部校验再开始写入，否则会留下半完成状态',
);

// 门禁断言必须位于写入循环之前的一个独立预检循环中
const preflightLoopBody = loopBodyContaining(backfill, 'assertPilotGateAllowsBackfill({');
assert.ok(preflightLoopBody, '必须能定位包含门禁断言的店铺循环');
assert.ok(
  !preflightLoopBody.includes('runBackfillShop('),
  '门禁预检循环中不得包含写入调用',
);
assert.ok(
  backfill.indexOf('assertPilotGateAllowsBackfill({') < backfill.indexOf('runBackfillShop({'),
  '门禁预检必须整体排在写入之前',
);

// 门禁失败必须导致整个 run 失败，而不是被吞掉
assert.ok(
  !/try\s*\{[^}]*assertPilotGateAllowsBackfill/.test(backfill),
  '门禁断言不得被 try/catch 吞掉',
);

// ---- acceptance 脚本必须真的评估四道门禁 -----------------------------------------
assert.match(
  acceptance,
  /evaluatePilotGate\(\{\s*syncSummary,\s*validationReport,\s*reconciliation,\s*productCardRows\s*\}\)/,
  'acceptance 脚本必须调用 evaluatePilotGate 并传入四路输入',
);
assert.match(
  acceptance,
  /writePilotGateArtifact\(/,
  'acceptance 脚本必须落盘 gate artifact',
);
assert.match(
  acceptance,
  /assertEvidenceShopConsistency\(/,
  'acceptance 脚本必须校验三方证据指向同一店铺',
);

// ---- 文档承诺与实现一致 -----------------------------------------------------------
assert.match(
  desktopReadme,
  /Only after the pilot store passes reconciliation, run historical backfill/,
  '桌面部署文档必须保留 backfill 门禁承诺',
);
assert.match(
  installScript,
  /Historical backfill remains disabled until the real-shop pilot gate passes/,
  '安装脚本必须保留 backfill 门禁提示',
);

console.log('Shopee pilot gate enforcement contract: ok');
