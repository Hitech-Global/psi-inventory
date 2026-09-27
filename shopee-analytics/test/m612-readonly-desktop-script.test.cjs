'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(
  path.join(__dirname, '..', 'deploy', 'desktop', 'verify-m612-readonly.ps1'),
  'utf8',
);
const reconcile = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'reconcile-m612-readonly.cjs'),
  'utf8',
);

for (const forbidden of [
  'git pull',
  'git reset',
  'git stash',
  'git clean',
  'docker compose down',
  'up -d worker',
  'apply-schema.cjs',
  'sync-all',
  'sync-one',
]) {
  assert(!script.toLowerCase().includes(forbidden.toLowerCase()), `read-only verifier must not contain ${forbidden}`);
}

assert(script.includes("build app"), 'verifier must rebuild only the app image');
assert(script.includes("up -d --no-deps app"), 'verifier must recreate app without touching dependencies/worker');
assert(script.includes('M612_SOURCE_PRECISION_RUNTIME=PASS'), 'verifier must prove the running container has the fixed ratio contract');
assert(script.includes('reconcile-m612-readonly.cjs'), 'verifier must execute the SELECT-only M612 reconciliation');
assert(script.includes('merge-base --is-ancestor'), 'verifier must require the local HEAD to contain the fix commit');
assert(script.includes('[long]$ShopId = 0'), 'shop id must be optional for normal M612 verification');
assert(script.includes("exit 3"), 'INCOMPLETE must remain distinct from PASS');

assert(reconcile.includes("source: 'AUTO_DETECTED'"), 'reconciliation must report automatic shop detection provenance');
assert(reconcile.includes('SELECT DISTINCT shop_id'), 'automatic shop detection must use stored database evidence');
assert(reconcile.includes('multiple shops'), 'ambiguous campaign ownership must fail closed instead of guessing a shop');
assert(reconcile.includes("databaseOperations: 'SELECT_ONLY'"), 'reconciliation safety contract must remain SELECT-only');

console.log('M612 desktop read-only verifier safety: ok');
