'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const app = path.join(root, 'app.js');
const feature = path.join(root, 'ci-list-inline-logistics.js');
const index = path.join(root, 'index.html');

execFileSync(process.execPath, ['--check', app], { stdio: 'pipe' });
execFileSync(process.execPath, ['--check', feature], { stdio: 'pipe' });

const featureSrc = fs.readFileSync(feature, 'utf8');
const indexSrc = fs.readFileSync(index, 'utf8');

assert.ok(featureSrc.includes('__ciListInlineLogisticsInstalled'), 'install guard missing');
assert.ok(featureSrc.includes("'/api/commercial-invoices/' + ciId + '/logistics-batches'"), 'CI-scoped lazy endpoint missing');
assert.ok(featureSrc.includes("data-ci-logi-toggle"), 'row toggle missing');
assert.ok(featureSrc.includes("data-ci-logi-create"), 'inline create action missing');
assert.ok(featureSrc.includes("data-ci-logi-edit"), 'inline edit action missing');
assert.ok(featureSrc.includes("wrapSave('saveLogWithPL')"), 'create save refresh wrapper missing');
assert.ok(featureSrc.includes("wrapSave('saveEditLog')"), 'edit save refresh wrapper missing');

const appPos = indexSrc.indexOf('<script src="app.js"></script>');
const featurePos = indexSrc.indexOf('<script src="ci-list-inline-logistics.js"></script>');
assert.ok(appPos >= 0 && featurePos > appPos, 'inline logistics script must load after app.js');

console.log('ci-list-inline-logistics static integration: PASS');
