'use strict';

const assert = require('assert');
const { createSkillExecutor, disabledSkillProvider } = require('../src/skill-executor');
const { dailyAnalysisWindow, runDailySkillReports } = require('../src/skill-scheduler');

(async () => {
  const pkg = {
    schemaVersion:'1.0',
    trigger:{ type:'MANUAL' },
  };
  const executor = createSkillExecutor({
    provider:{ async generateStructuredReport({ skill, analysisPackage }) {
      return { skill, trigger:analysisPackage.trigger.type };
    } },
  });
  const report = await executor({
    skillName:'shopee-gmv-max-analysis', skillVersion:'0.1.0', analysisPackage:pkg,
  });
  assert.strictEqual(report.trigger, 'MANUAL');

  const disabled = createSkillExecutor({ provider:disabledSkillProvider() });
  await assert.rejects(
    () => disabled({ skillName:'shopee-gmv-max-analysis', skillVersion:'0.1.0', analysisPackage:pkg }),
    /not configured/,
  );

  assert.deepStrictEqual(dailyAnalysisWindow('2026-09-20', 14), {
    startDate:'2026-09-07', endDate:'2026-09-20',
  });

  const calls = [];
  const results = await runDailySkillReports({
    shops:[{ shopId:1, timezone:'Asia/Jakarta' }],
    queryRepository:{ async listCampaignOverview() { return [{ campaignId:11 }, { campaignId:12 }]; } },
    localDateForShop:() => '2026-09-20',
    runSkillAnalysis:async args => { calls.push(args); return { reportId:args.campaignId + 100 }; },
  });
  assert.strictEqual(results.length, 2);
  assert.strictEqual(calls[0].triggerType, 'DAILY_AUTO');
  assert.strictEqual(calls[0].startDate, '2026-09-07');
  console.log('shopee skill execution/scheduler tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
