'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const skill = fs.readFileSync(path.join(root, 'skills', 'shopee-gmv-max', 'SKILL.md'), 'utf8');
const runner = fs.readFileSync(path.join(__dirname, '..', 'src', 'skill-runner.js'), 'utf8');
const analysisPackage = fs.readFileSync(path.join(__dirname, '..', 'src', 'analysis-package.js'), 'utf8');

assert(skill.includes('version: 0.2.0'));
assert(runner.includes("SKILL_VERSION = '0.2.0'"));
assert(skill.includes('Multi-SKU success is NOT required for STABLE'));
assert(skill.includes('Spend Share is observed allocation behavior'));
assert(skill.includes('Impressions -> Clicks -> CTR -> Add to Cart -> Add-to-Cart Rate -> Direct CVR -> Direct Orders'));
assert(skill.includes('Zero orders alone is not enough'));
assert(skill.includes('No expansion episode -> Scale Stability is UNKNOWN, not PASS'));
assert(skill.includes('Ad Group validation -> evidence maturity -> stable A core -> controlled single-product scaling'));
assert(analysisPackage.includes('weeklyOrderReference'));
assert(analysisPackage.includes('windowComparison'));
assert(analysisPackage.includes('directRoasVsTarget'));
assert(analysisPackage.includes('requiredBroadRoasForSpendLimit'));

console.log('Shopee Skill v0.2 campaign-first contract: ok');
