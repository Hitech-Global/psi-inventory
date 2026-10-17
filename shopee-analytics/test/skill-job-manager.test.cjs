'use strict';
const assert = require('assert');
const { SkillJobManager, normalizeReportLanguage } = require('../src/skill-job-manager');

(async () => {
  assert.strictEqual(normalizeReportLanguage('zh'), 'zh-CN');
  assert.strictEqual(normalizeReportLanguage('en'), 'en-US');
  assert.throws(() => normalizeReportLanguage('fr'), /language must be/);

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const manager = new SkillJobManager({ ttlMs: 60000 });
  const created = manager.create({
    shopId: 123,
    language: 'zh-CN',
    task: async onProgress => {
      onProgress(25, 'PACKAGE_READY', 'ready');
      await gate;
      onProgress(90, 'MODEL_VALIDATED', 'validated');
      return { report:{ stage:'STABLE' } };
    },
  });
  assert.strictEqual(created.status, 'QUEUED');
  assert.strictEqual(created.language, 'zh-CN');
  await new Promise(resolve => setImmediate(resolve));
  const running = manager.get(created.id, { shopId:123 });
  assert.strictEqual(running.status, 'RUNNING');
  assert.strictEqual(running.progress, 25);
  assert.strictEqual(running.stage, 'PACKAGE_READY');
  assert.strictEqual(manager.get(created.id, { shopId:999 }), null);

  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  const completed = manager.get(created.id, { shopId:123 });
  assert.strictEqual(completed.status, 'SUCCEEDED');
  assert.strictEqual(completed.progress, 100);
  assert.strictEqual(completed.result.report.stage, 'STABLE');

  const failed = manager.create({
    shopId:123,
    language:'en-US',
    task: async () => { throw new Error('boom'); },
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  const failedState = manager.get(failed.id, { shopId:123 });
  assert.strictEqual(failedState.status, 'FAILED');
  assert.match(failedState.errorMessage, /boom/);
  console.log('shopee skill job manager tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });