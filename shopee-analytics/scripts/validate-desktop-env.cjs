'use strict';

const fs = require('fs');
const path = require('path');
const { validateDesktopEnv } = require('../src/desktop-env-validation');

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

const file = process.argv[2] || path.join(__dirname, '..', 'deploy', 'desktop', 'runtime', '.env');
if (!fs.existsSync(file)) {
  console.error(`Missing desktop runtime env: ${file}`);
  process.exit(2);
}

const result = validateDesktopEnv(parseEnvFile(file));
console.log(JSON.stringify({ file, ...result }, null, 2));
if (!result.ok) process.exitCode = 2;
else if (result.warnings.length) process.exitCode = 1;
