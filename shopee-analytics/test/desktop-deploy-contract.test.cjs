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
assert(
  compose.includes('SHOPEE_BACKUP_STATUS_FILE: /runtime/backup-status.json'),
  'backup status file must be visible to the app',
);
assert(
  compose.includes('command: ["node", "shopee-analytics/scripts/sync-scheduler.cjs"]'),
  'worker must use the recurring sync scheduler',
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
  gitignore.includes('shopee-analytics/deploy/desktop/runtime/'),
  'desktop runtime secrets must be gitignored',
);
assert(
  envExample.includes('POSTGRES_PASSWORD=CHANGE_TO_A_LONG_RANDOM_PASSWORD'),
  'runtime env example must not contain a real database password',
);
assert(
  dockerIgnore.includes('shopee-analytics/deploy/desktop/runtime/'),
  'Docker build context must exclude desktop runtime secrets',
);
assert(
  dockerIgnore.startsWith('*\n'),
  'Docker build context should deny everything by default and opt in only required files',
);

console.log('shopee desktop deployment contract tests: ok');
