'use strict';

const assert = require('assert');
const {
  localIsoDate,
  addDays,
  startOfUtcDayEpoch,
  endOfUtcDayEpoch,
  parseCampaignIds,
  mergeCampaignIds,
} = require('../src/sync-cycle-utils');

assert.strictEqual(
  localIsoDate(new Date('2026-09-18T00:30:00Z'), 'Asia/Jakarta'),
  '2026-09-18',
);
assert.strictEqual(
  localIsoDate(new Date('2026-09-17T17:30:00Z'), 'Asia/Jakarta'),
  '2026-09-18',
);
assert.strictEqual(addDays('2026-09-01', -1), '2026-08-31');
assert.strictEqual(endOfUtcDayEpoch('2026-09-18') - startOfUtcDayEpoch('2026-09-18'), 86399);
assert.deepStrictEqual(parseCampaignIds('7, 2,7,bad'), [7, 2]);
assert.deepStrictEqual(mergeCampaignIds([7, 2], [9, 2]), [2, 7, 9]);

console.log('shopee sync cycle utility tests: ok');
