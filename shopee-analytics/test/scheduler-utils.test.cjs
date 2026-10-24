'use strict';

const assert = require('assert');
const { schedulerConfig, dueJobs, utcKeys } = require('../src/scheduler-utils');

const config = schedulerConfig({
  SHOPEE_SYNC_HOURLY_MINUTE: '10',
  SHOPEE_SYNC_DAILY_UTC_HOUR: '2',
  SHOPEE_SYNC_DAILY_UTC_MINUTE: '30',
  SHOPEE_SYNC_RUN_ON_START: 'YES',
});
assert.strictEqual(config.hourlyMinute, 10);
assert.strictEqual(config.dailyUtcHour, 2);
assert.strictEqual(config.runOnStart, true);

assert.deepStrictEqual(
  utcKeys(new Date('2026-09-18T02:31:00Z')),
  { date: '2026-09-18', hourKey: '2026-09-18T02', minute: 31, hour: 2 },
);

assert.deepStrictEqual(
  dueJobs(
    new Date('2026-09-18T02:31:00Z'),
    config,
    { lastHourlyKey: null, lastDailyDate: null },
  ),
  [{ mode: 'daily', key: '2026-09-18' }],
);

assert.deepStrictEqual(
  dueJobs(
    new Date('2026-09-18T03:11:00Z'),
    config,
    { lastHourlyKey: null, lastDailyDate: '2026-09-18' },
  ),
  [{ mode: 'hourly', key: '2026-09-18T03' }],
);

assert.deepStrictEqual(
  dueJobs(
    new Date('2026-09-18T03:11:00Z'),
    config,
    { lastHourlyKey: '2026-09-18T03', lastDailyDate: '2026-09-18' },
  ),
  [],
);

console.log('shopee scheduler utility tests: ok');
