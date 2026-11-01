'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluatePilotGate } = require('../src/pilot-gate');
const {
  GATE_ARTIFACT_VERSION,
  buildPilotGateArtifact,
  extractProductCardRows,
  extractShopSyncSummary,
  assertEvidenceShopConsistency,
  writePilotGateArtifact,
  readPilotGateArtifact,
  assertPilotGateAllowsBackfill,
} = require('../src/pilot-gate-store');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-gate-'));

// ---- evidence 抽取 --------------------------------------------------------------
const singleShopSummary = { shopId: 111, ok: true, failedRequiredSteps: [] };
assert.deepStrictEqual(
  extractShopSyncSummary(singleShopSummary, 111),
  singleShopSummary,
  '单店 sync summary 必须原样返回',
);
const aggregate = { summaries: [{ shopId: 111, ok: true }, { shopId: 222, ok: false }] };
assert.strictEqual(extractShopSyncSummary(aggregate, 222).ok, false, '聚合输出必须能按 shopId 取出对应店铺');
assert.throws(() => extractShopSyncSummary(aggregate, 333), /no entry for shop 333/, '缺少店铺必须报错');
assert.throws(() => extractShopSyncSummary({}, 111), /single-shop summary/, '无法识别的形状必须报错');

assert.strictEqual(extractProductCardRows({ store: { productCardRows: 7 } }), 7);
assert.strictEqual(extractProductCardRows({}), 0);
assert.strictEqual(extractProductCardRows(null), 0);

// ---- 证据一致性：必须三方指向同一店铺 --------------------------------------------
assert.doesNotThrow(() => assertEvidenceShopConsistency({
  shopId: 111,
  syncSummary: { shopId: 111 },
  validationReport: { shop: { shopId: 111 } },
  reconciliation: { shopId: 111 },
}), '三方同店必须通过');
assert.throws(() => assertEvidenceShopConsistency({
  shopId: 111,
  syncSummary: { shopId: 999 },
  validationReport: { shop: { shopId: 111 } },
  reconciliation: { shopId: 111 },
}), /belongs to shop 999/, '串店必须被拒绝');
assert.throws(() => assertEvidenceShopConsistency({
  shopId: 111,
  syncSummary: {},
  validationReport: { shop: { shopId: 111 } },
  reconciliation: { shopId: 111 },
}), /does not identify a shop/, '缺少 shopId 必须被拒绝');

// ---- artifact 构建与读写 ---------------------------------------------------------
const passingGate = evaluatePilotGate({
  syncSummary: { ok: true, failedRequiredSteps: [] },
  validationReport: { dataHealth: { ok: true, warnings: [] } },
  reconciliation: { pass: true, checks: [] },
  productCardRows: 10,
});
assert.strictEqual(passingGate.pass, true);
assert.strictEqual(passingGate.nextGate, 'HISTORICAL_BACKFILL_ALLOWED');

const artifact = buildPilotGateArtifact({
  shopId: 111,
  startDate: '2026-09-01',
  endDate: '2026-09-07',
  gate: passingGate,
  evidence: { syncReport: { file: '/tmp/sync.json', sha256: 'abc' } },
});
assert.strictEqual(artifact.version, GATE_ARTIFACT_VERSION);
assert.strictEqual(artifact.kind, 'SHOPEE_ANALYTICS_PILOT_GATE');
assert.strictEqual(artifact.shopId, 111);
assert.strictEqual(artifact.pass, true);
assert.deepStrictEqual(artifact.failedGates, []);

const written = writePilotGateArtifact(artifact, { dir: tmpDir });
assert.ok(fs.existsSync(written), 'artifact 必须落盘');
assert.strictEqual(fs.statSync(written).mode & 0o777, 0o600, 'artifact 必须 0600 权限');
const readBack = readPilotGateArtifact(111, { dir: tmpDir });
assert.strictEqual(readBack.shopId, 111);
assert.strictEqual(readBack.pass, true);
assert.strictEqual(readPilotGateArtifact(999, { dir: tmpDir }), null, '不存在的店铺必须返回 null');

// ---- backfill 门禁断言 ------------------------------------------------------------
// 1) 通过
const allowed = assertPilotGateAllowsBackfill({
  shopId: 111, dir: tmpDir, env: {}, now: new Date('2026-09-08T00:00:00Z'),
});
assert.strictEqual(allowed.pass, true, '已接受的店铺必须放行');

// 2) 缺少 artifact → 拒绝
assert.throws(
  () => assertPilotGateAllowsBackfill({ shopId: 222, dir: tmpDir, env: {} }),
  /pilot gate has not been accepted yet/,
  '没有 artifact 必须拒绝 backfill',
);

// 3) 门禁失败 → 拒绝
const failingGate = evaluatePilotGate({
  syncSummary: { ok: true },
  validationReport: { dataHealth: { ok: true } },
  reconciliation: { pass: false, checks: [] },
  productCardRows: 0,
});
writePilotGateArtifact(
  buildPilotGateArtifact({
    shopId: 333, startDate: '2026-09-01', endDate: '2026-09-07', gate: failingGate,
  }),
  { dir: tmpDir },
);
assert.throws(
  () => assertPilotGateAllowsBackfill({ shopId: 333, dir: tmpDir, env: {} }),
  /pilot gate failed \[seller_centre_reconciliation, product_card_exact_period\]/,
  '门禁失败的店铺必须拒绝 backfill',
);

// 4) artifact 属于别的店铺 → 拒绝（串店防护）
writePilotGateArtifact(
  buildPilotGateArtifact({
    shopId: 444, startDate: '2026-09-01', endDate: '2026-09-07', gate: passingGate,
  }),
  { dir: tmpDir },
);
assert.throws(
  () => assertPilotGateAllowsBackfill({ shopId: 555, dir: tmpDir, env: {} }),
  /has not been accepted yet/,
  '不能把别的店铺的 artifact 当作通过',
);

// 5) artifact 版本不支持 → 拒绝
const staleVersion = { ...artifact, version: 999, shopId: 666 };
writePilotGateArtifact(staleVersion, { dir: tmpDir });
assert.throws(
  () => assertPilotGateAllowsBackfill({ shopId: 666, dir: tmpDir, env: {} }),
  /version 999 is not supported/,
  '不支持的 artifact 版本必须拒绝',
);

// 6) artifact 过期 → 拒绝（默认 180 天）
const oldArtifact = {
  ...artifact,
  shopId: 777,
  generatedAt: '2020-01-01T00:00:00.000Z',
};
writePilotGateArtifact(oldArtifact, { dir: tmpDir });
assert.throws(
  () => assertPilotGateAllowsBackfill({
    shopId: 777, dir: tmpDir, env: {}, now: new Date('2026-10-31T00:00:00Z'),
  }),
  /days old \(limit 180 days\)/,
  '过期的 artifact 必须拒绝 backfill',
);
// 可通过环境变量放宽
assert.doesNotThrow(() => assertPilotGateAllowsBackfill({
  shopId: 777,
  dir: tmpDir,
  env: { SHOPEE_PILOT_GATE_MAX_AGE_DAYS: '0' },
  now: new Date('2026-10-31T00:00:00Z'),
}), '显式放宽上限后必须放行');

// 7) 不是 pilot gate 的文件 → 拒绝
fs.writeFileSync(path.join(tmpDir, 'shop-888.json'), JSON.stringify({ hello: 'world' }));
assert.throws(
  () => assertPilotGateAllowsBackfill({ shopId: 888, dir: tmpDir, env: {} }),
  /not a Shopee Analytics pilot gate/,
  '无关文件必须拒绝',
);

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('shopee pilot gate store tests: ok');
