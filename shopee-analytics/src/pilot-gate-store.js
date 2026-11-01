'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Real-shop pilot gate artifact store
 * ============================================================================================
 * Background: `src/pilot-gate.js` evaluates the four acceptance gates (sync, data health,
 * Seller Centre reconciliation, exact-period Product Card). The evaluation is pure, but the
 * result was never persisted, so nothing could enforce it. The desktop deployment and the
 * README both promise that historical backfill stays blocked until the pilot gate passes:
 *
 *   - deploy/desktop/README.md: "Only after the pilot store passes reconciliation, run
 *     historical backfill."
 *   - install-desktop.ps1: "Historical backfill remains disabled until the real-shop pilot
 *     gate passes."
 *
 * This module stores the evaluated gate as a per-shop artifact on disk and exposes an
 * assertion the backfill runner must satisfy. Design notes:
 *
 *   1. Per shop, not global. All four gate inputs are shop-scoped (the sync summary carries
 *      shopId, the validation report carries shop.shopId, the reconciliation report carries
 *      shopId), so the artifact is keyed by shop and the evidence must all agree on it.
 *   2. Fail closed. A missing artifact, a mismatched shop, a failed gate or an expired
 *      artifact all block backfill.
 *   3. Stored under the gitignored desktop runtime directory by default, so gate evidence
 *      never lands in Git.
 */

const GATE_ARTIFACT_VERSION = 1;
const DEFAULT_MAX_AGE_DAYS = 180;

/**
 * Default gate directory: inside the gitignored desktop runtime directory.
 * Resolved from this module's own location so it does not depend on the process CWD.
 */
function defaultGateDir() {
  return path.resolve(__dirname, '..', 'deploy', 'desktop', 'runtime', 'pilot-gate');
}

function resolveGateDir(env = process.env) {
  const configured = String(env.SHOPEE_PILOT_GATE_DIR || '').trim();
  return configured ? path.resolve(configured) : defaultGateDir();
}

function gateFilePath(shopId, { dir } = {}) {
  return path.join(dir || defaultGateDir(), `shop-${shopId}.json`);
}

function readJsonFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Pilot gate evidence is not valid JSON: ${file} (${error.message})`);
  }
}

/**
 * Accept either a single-shop sync summary or the aggregate output of sync-all-shops,
 * and return the summary of the requested shop.
 */
function extractShopSyncSummary(payload, shopId) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Sync summary evidence must be a JSON object');
  }
  if (payload.shopId !== undefined && payload.shopId !== null) return payload;
  if (Array.isArray(payload.summaries)) {
    const match = payload.summaries.find(row => Number(row.shopId) === Number(shopId));
    if (!match) throw new Error(`Sync summary evidence has no entry for shop ${shopId}`);
    return match;
  }
  throw new Error('Sync summary evidence must be a single-shop summary or an aggregate with summaries[]');
}

function extractProductCardRows(validationReport) {
  return Number(validationReport?.store?.productCardRows || 0);
}

/**
 * All three evidence documents must identify the same shop as the acceptance request.
 * Without this check an operator could accept shop A using shop B evidence.
 */
function assertEvidenceShopConsistency({ shopId, syncSummary, validationReport, reconciliation }) {
  const expected = Number(shopId);
  const actuals = [
    ['sync summary', syncSummary && syncSummary.shopId],
    ['validation report', validationReport && validationReport.shop && validationReport.shop.shopId],
    ['reconciliation report', reconciliation && reconciliation.shopId],
  ];
  for (const [label, value] of actuals) {
    if (value === undefined || value === null) {
      throw new Error(`${label} evidence does not identify a shop; refusing to build a pilot gate artifact`);
    }
    if (Number(value) !== expected) {
      throw new Error(
        `${label} evidence belongs to shop ${value}, not shop ${expected}; refusing to build a pilot gate artifact`,
      );
    }
  }
}

/**
 * Build the artifact. `evidence` carries the source file and digest of each input so the
 * stored decision can be traced back to the exact reports it was computed from.
 */
function buildPilotGateArtifact({
  shopId,
  startDate,
  endDate,
  gate,
  evidence = {},
  generatedAt = new Date().toISOString(),
}) {
  return {
    version: GATE_ARTIFACT_VERSION,
    kind: 'SHOPEE_ANALYTICS_PILOT_GATE',
    generatedAt,
    shopId: Number(shopId),
    period: { startDate, endDate },
    pass: gate && gate.pass === true,
    nextGate: gate ? gate.nextGate : 'FIX_PILOT_ACCEPTANCE',
    failedGates: (gate && gate.failedGates) || [],
    gates: (gate && gate.gates) || [],
    evidence,
  };
}

function writePilotGateArtifact(artifact, { dir } = {}) {
  const file = gateFilePath(artifact.shopId, { dir });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function readPilotGateArtifact(shopId, { dir } = {}) {
  const file = gateFilePath(shopId, { dir });
  if (!fs.existsSync(file)) return null;
  return readJsonFile(file);
}

/**
 * Gate that historical backfill must satisfy. Throws with an actionable message when the
 * pilot acceptance is missing, stale or failed.
 */
function assertPilotGateAllowsBackfill({ shopId, dir, env = process.env, now = new Date() } = {}) {
  const gateDir = dir || resolveGateDir(env);
  const file = gateFilePath(shopId, { dir: gateDir });
  if (!fs.existsSync(file)) {
    throw new Error(
      `Historical backfill is blocked for shop ${shopId}: the real-shop pilot gate has not been accepted yet.\n` +
      `Expected artifact: ${file}\n` +
      'Run scripts/pilot-acceptance.cjs for this shop before backfilling it.',
    );
  }

  const artifact = readPilotGateArtifact(shopId, { dir: gateDir });
  if (!artifact || artifact.kind !== 'SHOPEE_ANALYTICS_PILOT_GATE') {
    throw new Error(`Pilot gate artifact is not a Shopee Analytics pilot gate: ${file}`);
  }
  if (Number(artifact.version) !== GATE_ARTIFACT_VERSION) {
    throw new Error(
      `Pilot gate artifact version ${artifact.version} is not supported (expected ${GATE_ARTIFACT_VERSION}): ${file}`,
    );
  }
  if (Number(artifact.shopId) !== Number(shopId)) {
    throw new Error(`Pilot gate artifact belongs to shop ${artifact.shopId}, not shop ${shopId}: ${file}`);
  }
  if (artifact.pass !== true) {
    const failed = (artifact.failedGates || []).join(', ') || 'unknown';
    throw new Error(`Historical backfill is blocked for shop ${shopId}: pilot gate failed [${failed}]: ${file}`);
  }

  const maxAgeDays = Number(
    env.SHOPEE_PILOT_GATE_MAX_AGE_DAYS === undefined || env.SHOPEE_PILOT_GATE_MAX_AGE_DAYS === ''
      ? DEFAULT_MAX_AGE_DAYS
      : env.SHOPEE_PILOT_GATE_MAX_AGE_DAYS,
  );
  if (Number.isFinite(maxAgeDays) && maxAgeDays > 0) {
    const generated = new Date(artifact.generatedAt);
    if (Number.isNaN(generated.getTime())) {
      throw new Error(`Pilot gate artifact has an unreadable generatedAt: ${file}`);
    }
    const ageDays = (now.getTime() - generated.getTime()) / 86400000;
    if (ageDays > maxAgeDays) {
      throw new Error(
        `Historical backfill is blocked for shop ${shopId}: the pilot gate artifact is ${Math.floor(ageDays)} days old ` +
        `(limit ${maxAgeDays} days). Re-run scripts/pilot-acceptance.cjs to refresh it: ${file}`,
      );
    }
  }

  return artifact;
}

module.exports = {
  GATE_ARTIFACT_VERSION,
  DEFAULT_MAX_AGE_DAYS,
  defaultGateDir,
  resolveGateDir,
  gateFilePath,
  readJsonFile,
  extractShopSyncSummary,
  extractProductCardRows,
  assertEvidenceShopConsistency,
  buildPilotGateArtifact,
  writePilotGateArtifact,
  readPilotGateArtifact,
  assertPilotGateAllowsBackfill,
};
