'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const deploy = path.join(root, 'deploy', 'desktop');
const compose = fs.readFileSync(path.join(deploy, 'docker-compose.yml'), 'utf8');
const dockerfile = fs.readFileSync(path.join(deploy, 'Dockerfile'), 'utf8');
const envExample = fs.readFileSync(path.join(deploy, 'runtime.env.example'), 'utf8');
const dockerIgnore = fs.readFileSync(path.join(deploy, 'Dockerfile.dockerignore'), 'utf8');
const preparePs1 = fs.readFileSync(path.join(deploy, 'prepare-desktop.ps1'), 'utf8');
const installPs1 = fs.readFileSync(path.join(deploy, 'install-desktop.ps1'), 'utf8');
const backupTasksPs1 = fs.readFileSync(path.join(deploy, 'install-backup-tasks.ps1'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '..', '.gitignore'), 'utf8');

const postgresSection = compose.slice(
  compose.indexOf('  postgres:'),
  compose.indexOf('\n  app:'),
);
assert(!postgresSection.includes('\n    ports:'), 'PostgreSQL must not expose a host port');

assert(
  compose.includes('"127.0.0.1:${SHOPEE_ANALYTICS_HOST_PORT:-3090}:3090"'),
  'analytics app must bind host port to loopback by default',
);
const oauthSection = compose.slice(
  compose.indexOf('  oauth:'),
  compose.indexOf('\n  worker:'),
);
assert(oauthSection.includes('command: ["node", "shopee-analytics/src/oauth-server.js"]'), 'desktop stack must expose a dedicated OAuth server');
assert(
  oauthSection.includes('"127.0.0.1:${SHOPEE_OAUTH_HOST_PORT:-3091}:3091"'),
  'OAuth server must bind its host port to loopback',
);
assert(oauthSection.includes('SHOPEE_OAUTH_HOST: 0.0.0.0'), 'OAuth server must listen on the container interface only');
assert(oauthSection.includes('SHOPEE_OAUTH_ALLOW_REMOTE: "YES"'), 'OAuth container must explicitly permit its isolated container bind');
assert(oauthSection.includes("fetch('http://127.0.0.1:3091/health')"), 'OAuth server must have a localhost healthcheck');
assert(
  compose.includes('SHOPEE_BACKUP_STATUS_FILE: /runtime/backup-status.json'),
  'backup status file must be visible to the app',
);
assert(
  compose.includes('command: ["node", "shopee-analytics/scripts/sync-scheduler.cjs"]'),
  'worker must use the recurring sync scheduler',
);
assert(
  compose.includes('command: ["node", "shopee-analytics/scripts/deployment-preflight.cjs"]'),
  'desktop stack must expose the explicit deployment preflight gate',
);
assert(
  dockerfile.includes('FROM node:22.22.2-bookworm-slim'),
  'desktop image should match the repository Node runtime',
);
assert(
  dockerfile.includes('npm ci --omit=dev --ignore-scripts'),
  'analytics image must not execute PSI repository postinstall scripts',
);
assert(
  dockerfile.includes('COPY skills/shopee-gmv-max ./skills/shopee-gmv-max'),
  'desktop image must copy the versioned GMV Max Skill artifact',
);
for (const rule of ['!skills/', '!skills/shopee-gmv-max/', '!skills/shopee-gmv-max/**']) {
  assert(
    dockerIgnore.split(/\r?\n/).includes(rule),
    `Docker build context must allow ${rule} required by the Dockerfile COPY instruction`,
  );
}
assert(
  gitignore.includes('shopee-analytics/deploy/desktop/runtime/'),
  'desktop runtime secrets must be gitignored',
);
assert(
  envExample.includes('POSTGRES_PASSWORD=CHANGE_TO_A_LONG_RANDOM_PASSWORD'),
  'runtime env example must not contain a real database password',
);
assert(envExample.includes('SHOPEE_OAUTH_ENABLE=NO'), 'OAuth must default disabled');
assert(envExample.includes('SHOPEE_OAUTH_LIVE_REDIRECT_URL='), 'OAuth live redirect config must be documented');
assert(
  dockerIgnore.includes('shopee-analytics/deploy/desktop/runtime/'),
  'Docker build context must exclude desktop runtime secrets',
);
assert(
  dockerIgnore.startsWith('*\n'),
  'Docker build context should deny everything by default and opt in only required files',
);
assert(preparePs1.includes('prepare-desktop-runtime.cjs'), 'Windows preparation must use safe runtime initializer');
assert(installPs1.includes('--profile tools run --rm preflight'), 'Windows installer must run deployment preflight');
assert(installPs1.includes('Historical backfill remains disabled'), 'Windows installer must keep backfill gated');
assert(backupTasksPs1.includes('Shopee Analytics NAS Backup'), 'Windows task installer must schedule NAS backup');
assert(backupTasksPs1.includes('Shopee Analytics Restore Verification'), 'Windows task installer must schedule restore verification');
assert(backupTasksPs1.includes('-StartWhenAvailable'), 'Scheduled backups must recover from missed runs');

console.log('shopee desktop deployment contract tests: ok');
