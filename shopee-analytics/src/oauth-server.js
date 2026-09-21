'use strict';

const express = require('express');
const { createAnalyticsPool } = require('./pg');
const { loadAppCredential } = require('./config');
const { loadMasterKey } = require('./token-crypto');
const { ShopeeTokenRepository } = require('./token-repository');
const { ShopeeOAuthStateRepository } = require('./oauth-state-repository');
const { ShopeeOAuthService } = require('./oauth-service');
const { createOAuthRouter } = require('./oauth-router');

function resolveOAuthBindAddress(env = process.env) {
  const requested = env.SHOPEE_OAUTH_HOST || '127.0.0.1';
  const isLoopback = requested === '127.0.0.1' || requested === 'localhost' || requested === '::1';
  if (!isLoopback && env.SHOPEE_OAUTH_ALLOW_REMOTE !== 'YES') {
    throw new Error('Refusing remote OAuth bind. Set SHOPEE_OAUTH_ALLOW_REMOTE=YES explicitly.');
  }
  return requested;
}

function resolveOAuthPort(env = process.env) {
  const value = Number(env.SHOPEE_OAUTH_PORT || 3091);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error('SHOPEE_OAUTH_PORT must be 1..65535');
  }
  return value;
}

function createOAuthApp({ pool, env = process.env, logger = console, fetchImpl = global.fetch, now, randomBytes } = {}) {
  if (!pool) throw new Error('pool is required');
  const stateRepository = new ShopeeOAuthStateRepository({ pool });
  const service = new ShopeeOAuthService({
    stateRepository,
    tokenRepositoryFactory: () => new ShopeeTokenRepository({ pool, masterKey: loadMasterKey(env) }),
    credentialLoader: role => loadAppCredential(role, { requireToken: false }),
    env,
    logger,
    fetchImpl,
    now,
    randomBytes,
  });
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (req, res) => res.json({ ok: true, module: 'shopee-oauth', mode: 'oauth-only' }));
  app.use(createOAuthRouter({ oauthService: service, logger }));
  return app;
}

async function main() {
  const host = resolveOAuthBindAddress();
  const port = resolveOAuthPort();
  const pool = createAnalyticsPool();
  const app = createOAuthApp({ pool });
  const server = app.listen(port, host, () => console.log(`Shopee OAuth: http://${host}:${port}`));
  const close = signal => server.close(async () => { await pool.end(); process.exit(0); });
  process.on('SIGTERM', () => close('SIGTERM'));
  process.on('SIGINT', () => close('SIGINT'));
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { createOAuthApp, resolveOAuthBindAddress, resolveOAuthPort };
