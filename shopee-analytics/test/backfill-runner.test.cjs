'use strict';

const assert = require('assert');
const { runChunked } = require('../src/backfill-runner');

(async () => {
  const marks = [];
  const runtime = {
    rawRepository: {
      async getSyncState() {
        return {
          cursor: {
            requestedStartDate: '2026-09-01',
            requestedEndDate: '2026-09-20',
            completedThrough: '2026-09-07',
          },
        };
      },
      async markSyncSuccess(input) { marks.push({ type: 'ok', ...input }); },
      async markSyncFailure(input) { marks.push({ type: 'fail', ...input }); },
    },
  };

  const calls = [];
  const result = await runChunked({
    runtime,
    shopId: 1,
    appRole: 'ADS',
    endpointKey: 'BACKFILL_TEST',
    requestedStartDate: '2026-09-01',
    requestedEndDate: '2026-09-20',
    chunkDays: 7,
    async runner(chunk) {
      calls.push(chunk);
      return { count: 1 };
    },
  });

  assert.strictEqual(result.resumed, true);
  assert.strictEqual(result.resumedFrom, '2026-09-07');
  assert.deepStrictEqual(calls, [
    { startDate: '2026-09-08', endDate: '2026-09-14' },
    { startDate: '2026-09-15', endDate: '2026-09-20' },
  ]);
  assert.strictEqual(marks.filter(row => row.type === 'ok').length, 2);
  assert.strictEqual(
    marks[marks.length - 1].cursor.completedThrough,
    '2026-09-20',
  );

  let failed = false;
  const failureRuntime = {
    rawRepository: {
      async getSyncState() { return null; },
      async markSyncSuccess() {},
      async markSyncFailure(input) {
        failed = true;
        assert.strictEqual(input.endpointKey, 'BACKFILL_FAIL');
      },
    },
  };

  await assert.rejects(
    () => runChunked({
      runtime: failureRuntime,
      shopId: 1,
      appRole: 'ADS',
      endpointKey: 'BACKFILL_FAIL',
      requestedStartDate: '2026-09-01',
      requestedEndDate: '2026-09-02',
      chunkDays: 1,
      async runner() { throw new Error('boom'); },
    }),
    /boom/,
  );
  assert.strictEqual(failed, true);

  console.log('shopee backfill runner tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
