'use strict';

/**
 * Real-shop pilot acceptance runner
 * ============================================================================================
 * Evaluates the four pilot gates for one shop over one fixed period and stores the result
 * as the pilot gate artifact that historical backfill is gated on.
 *
 * Inputs are the JSON reports produced by the existing read-only tooling:
 *   - sync summary          node scripts/sync-readonly.cjs / sync-all-shops.cjs   (stdout JSON)
 *   - validation report     node scripts/validation-report.cjs                   (stdout JSON)
 *   - reconciliation report node scripts/reconcile-seller-centre.cjs              (stdout JSON)
 *
 * Each input is passed as a file path so the run stays reproducible and the stored artifact
 * can be traced back to the exact reports it was computed from.
 *
 * Usage:
 *   SHOPEE_PILOT_SHOP_ID=123 \
 *   SHOPEE_PILOT_START_DATE=2026-09-01 \
 *   SHOPEE_PILOT_END_DATE=2026-09-07 \
 *   SHOPEE_PILOT_SYNC_REPORT=/secure/sync.json \
 *   SHOPEE_PILOT_VALIDATION_REPORT=/secure/validation.json \
 *   SHOPEE_PILOT_RECONCILIATION_REPORT=/secure/reconciliation.json \
 *   node scripts/pilot-acceptance.cjs
 *
 * This script only reads reports and writes a local artifact. It never calls Shopee and
 * never writes to PostgreSQL.
 */

const fs = require('fs');
const { evaluatePilotGate } = require('../src/pilot-gate');
const {
  buildPilotGateArtifact,
  extractProductCardRows,
  extractShopSyncSummary,
  assertEvidenceShopConsistency,
  readJsonFile,
  resolveGateDir,
  writePilotGateArtifact,
} = require('../src/pilot-gate-store');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function isoDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  return String(value);
}

function fileDigest(file) {
  const hash = require('crypto').createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function main() {
  const shopId = positiveInt(required('SHOPEE_PILOT_SHOP_ID'), 'SHOPEE_PILOT_SHOP_ID');
  const startDate = isoDate(required('SHOPEE_PILOT_START_DATE'), 'SHOPEE_PILOT_START_DATE');
  const endDate = isoDate(required('SHOPEE_PILOT_END_DATE'), 'SHOPEE_PILOT_END_DATE');
  if (startDate > endDate) throw new Error('pilot start date must be <= end date');

  const syncFile = required('SHOPEE_PILOT_SYNC_REPORT');
  const validationFile = required('SHOPEE_PILOT_VALIDATION_REPORT');
  const reconciliationFile = required('SHOPEE_PILOT_RECONCILIATION_REPORT');

  const syncPayload = readJsonFile(syncFile);
  const validationReport = readJsonFile(validationFile);
  const reconciliationPayload = readJsonFile(reconciliationFile);

  // The reconciliation report wraps its result under `reconciliation`; the gate reads it flat.
  const reconciliation = reconciliationPayload && reconciliationPayload.reconciliation
    ? reconciliationPayload.reconciliation
    : reconciliationPayload;
  const syncSummary = extractShopSyncSummary(syncPayload, shopId);

  // Shop identity is checked against the whole reconciliation report, because `shopId` lives
  // on the report envelope while the gate reads the unwrapped `reconciliation` result.
  assertEvidenceShopConsistency({
    shopId,
    syncSummary,
    validationReport,
    reconciliation: reconciliationPayload,
  });

  const productCardRows = extractProductCardRows(validationReport);
  const gate = evaluatePilotGate({ syncSummary, validationReport, reconciliation, productCardRows });

  const artifact = buildPilotGateArtifact({
    shopId,
    startDate,
    endDate,
    gate,
    evidence: {
      syncReport: { file: syncFile, sha256: fileDigest(syncFile) },
      validationReport: { file: validationFile, sha256: fileDigest(validationFile) },
      reconciliationReport: { file: reconciliationFile, sha256: fileDigest(reconciliationFile) },
    },
  });

  const gateDir = resolveGateDir();
  const artifactFile = writePilotGateArtifact(artifact, { dir: gateDir });

  const output = {
    mode: 'PILOT_ACCEPTANCE',
    shopId,
    period: { startDate, endDate },
    pass: artifact.pass,
    nextGate: artifact.nextGate,
    failedGates: artifact.failedGates,
    gates: artifact.gates,
    artifactFile,
    limitations: [
      'Product Card coverage is reported as the count of SKU rows carrying Product Card data for the same period.',
      'The gate does not authorize any Shopee write; V1 stays read-only.',
    ],
  };
  console.log(JSON.stringify(output, null, 2));
  if (!artifact.pass) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 2;
}
