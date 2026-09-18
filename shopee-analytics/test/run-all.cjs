'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(name => name.endsWith('.test.cjs'))
  .sort();

let failed = 0;
for (const file of files) {
  const full = path.join(dir, file);
  const result = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}

if (failed) {
  console.error(`Shopee analytics test files failed: ${failed}/${files.length}`);
  process.exitCode = 1;
} else {
  console.log(`Shopee analytics tests passed: ${files.length}/${files.length}`);
}
