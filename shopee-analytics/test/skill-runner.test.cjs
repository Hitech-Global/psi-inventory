'use strict';

const assert = require('assert');
const { SkillRunner, validateReport } = require('../src/skill-runner');

function report() {
  return {
    skill:{ name:'shopee-gmv-max-analysis', version:'0.1.0' },
    period:{ dataCutoff:'2026-09-20T23:59:59+07:00' },
    trigger:'MANUAL',
    stage:'CONVERGING',
    facts:[{ id:'f1', statement:'Direct Orders = 18' }],
    inferences:[{ statement:'Evidence is still converging.', evidenceIds:['f1'] }],
    hypotheses:[{ statement:'Scale may remain efficient.', validation:'Observe the next expansion window.' }],
    skuAssessments:[],
    actionGates:[],
    nextValidation:['Collect more Direct Orders.'],
    limitations:[],
  };
}

assert.strictEqual(validateReport(report()).stage, 'CONVERGING');
assert.throws(() => validateReport({ ...report(), inferences:[{ statement:'bad', evidenceIds:['missing'] }] }), /unknown FACT/);

(async () => {
  const calls = [];
  const repository = {
    async createPending(args) { calls.push(['pending', args.skillVersion]); return { id: 7 }; },
    async complete(args) { calls.push(['complete', args.reportId]); },
    async fail() { calls.push(['fail']); },
  };
  const runner = new SkillRunner({ executor: async () => report(), reportRepository: repository });
  const result = await runner.run({
    schemaVersion:'1.0',
    shop:{ shopId:1 },
    campaign:{ campaignId:2 },
    period:{ startDate:'2026-09-14', endDate:'2026-09-20', dataCutoff:'2026-09-20T23:59:59+07:00' },
    trigger:{ type:'MANUAL' },
  });
  assert.strictEqual(result.reportId, 7);
  assert.deepStrictEqual(calls, [['pending','0.1.0'],['complete',7]]);
  console.log('shopee skill runner tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
