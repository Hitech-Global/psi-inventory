'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const testDir = __dirname;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let failed = 0;
const syntaxFiles = walk(root)
  .filter(file => /\.(js|cjs)$/.test(file))
  .filter(file => !file.includes(`${path.sep}node_modules${path.sep}`))
  .sort();

for (const file of syntaxFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}

const testFiles = fs.readdirSync(testDir)
  .filter(name => name.endsWith('.test.cjs'))
  .sort();

for (const file of testFiles) {
  const full = path.join(testDir, file);
  const result = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}

if (failed) {
  console.error(`Shopee analytics checks failed: ${failed}`);
  process.exitCode = 1;
} else {
  console.log(`Shopee analytics checks passed: ${syntaxFiles.length} syntax + ${testFiles.length} test files`);
}
