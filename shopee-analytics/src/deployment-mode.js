'use strict';

const PRODUCTION = 'PRODUCTION';
const OFFLINE_BASELINE = 'OFFLINE_BASELINE';

function resolveDeploymentMode(env = process.env) {
  const value = env.SHOPEE_ANALYTICS_DEPLOYMENT_MODE;
  if (value === undefined || value === '') return PRODUCTION;
  if (value === PRODUCTION || value === OFFLINE_BASELINE) return value;
  throw new Error(
    `Unsupported SHOPEE_ANALYTICS_DEPLOYMENT_MODE: ${String(value)}. ` +
    `Use ${PRODUCTION} or ${OFFLINE_BASELINE} exactly.`,
  );
}

function isOfflineBaseline(env = process.env) {
  return resolveDeploymentMode(env) === OFFLINE_BASELINE;
}

function assertOnlineOperationAllowed(operation, env = process.env) {
  if (isOfflineBaseline(env)) {
    throw new Error(`${operation} is disabled in OFFLINE_BASELINE deployment mode.`);
  }
}

module.exports = {
  PRODUCTION,
  OFFLINE_BASELINE,
  resolveDeploymentMode,
  isOfflineBaseline,
  assertOnlineOperationAllowed,
};
