'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(
  path.join(__dirname, '..', 'deploy', 'desktop', 'verify-m612-readonly.ps1'),
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
assert(script.includes("exit 3"), 'INCOMPLETE must remain distinct from PASS');

console.log('M612 desktop read-only verifier safety: ok');
