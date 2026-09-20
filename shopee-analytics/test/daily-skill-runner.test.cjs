'use strict';

const assert = require('assert');
const { positiveWindowDays } = require('../scripts/run-daily-skill-reports.cjs');

assert.strictEqual(positiveWindowDays(undefined), 14);
assert.strictEqual(positiveWindowDays('14'), 14);
assert.strictEqual(positiveWindowDays('1'), 1);
assert.strictEqual(positiveWindowDays('90'), 90);
assert.throws(() => positiveWindowDays('0'), /1 to 90/);
assert.throws(() => positiveWindowDays('91'), /1 to 90/);
assert.throws(() => positiveWindowDays('14.5'), /1 to 90/);

console.log('shopee daily skill runner config tests: ok');
