'use strict';

const fs = require('fs');
const path = require('path');

function parseEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    out[line.slice(0, index)] = line.slice(index + 1);
  }
  return out;
}

function writeEnvFile(file, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value ?? ''}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  if (process.env.SHOPEE_ANALYTICS_PREPARE_DESKTOP_RUNTIME !== 'YES') {
    throw new Error(
      'Refusing runtime preparation. Set SHOPEE_ANALYTICS_PREPARE_DESKTOP_RUNTIME=YES explicitly.',
    );
  }

  const deployDir = path.join(__dirname, '..', 'deploy', 'desktop');
  const runtimeDir = path.join(deployDir, 'runtime');
  const envFile = path.join(runtimeDir, '.env');
  const example = path.join(deployDir, 'runtime.env.example');

  if (!fs.existsSync(envFile)) {
    const env = parseEnvFile(example);
    if (!env.POSTGRES_PASSWORD || /^CHANGE_/i.test(env.POSTGRES_PASSWORD)) {
      env.POSTGRES_PASSWORD = require('crypto').randomBytes(32).toString('base64url');
    }
    if (!env.SHOPEE_TOKEN_MASTER_KEY) {
      env.SHOPEE_TOKEN_MASTER_KEY = require('crypto').randomBytes(32).toString('base64');
    }
    writeEnvFile(envFile, env);
  }

  for (const name of [
    'product-card/inbox',
    'product-card/archive',
    'product-card/failed',
    'backup-local',
  ]) {
    ensureDir(path.join(runtimeDir, name));
  }

  console.log(JSON.stringify({
    runtimeDir,
    envFile,
    createdDirectories: [
      'product-card/inbox',
      'product-card/archive',
      'product-card/failed',
      'backup-local',
    ],
    reminder: 'PostgreSQL password and token master key are generated locally. Fill Shopee Partner credentials and NAS paths before deployment.',
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
