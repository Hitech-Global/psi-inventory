'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SkillReportRepository } = require('../src/skill-report-repository');

(async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/INSERT INTO shopee_skill_reports/.test(sql)) {
        return { rows:[{ id:101, generated_at:new Date('2026-10-13T00:00:00Z') }] };
      }
      if (/FROM shopee_skill_reports/.test(sql)) {
        return { rows:[{ id:101, shop_id:1, campaign_id:null, promotion_key:'PK-1', status:'COMPLETED' }] };
      }
      return { rows:[] };
    },
  };
  const repo = new SkillReportRepository(pool);

  await repo.createPending({
    analysisPackage:{
      schemaVersion:'1.0',
      shop:{ shopId:1 },
      campaign:{ campaignId:'AD_GROUP:PK-1', promotionKey:'PK-1' },
      period:{ startDate:'2026-09-22', endDate:'2026-09-28', dataCutoff:'2026-09-28T23:59:59Z' },
      trigger:{ type:'MANUAL', reason:'TEST' },
    },
    skillName:'shopee-gmv-max-analysis',
    skillVersion:'0.2.0',
  });
  assert.strictEqual(calls[0].params[1], null, 'Ad Group report must not write a fake bigint campaign id');
  assert.strictEqual(calls[0].params[2], 'PK-1', 'Ad Group report must persist promotion_key');

  await repo.latest({
    shopId:1,
    promotionKey:'PK-1',
    completedOnly:true,
    periodStart:'2026-09-22',
    periodEnd:'2026-09-28',
  });
  assert.strictEqual(calls[1].params[1], null);
  assert.strictEqual(calls[1].params[2], 'PK-1');
  assert.strictEqual(calls[1].params[3], true);
  assert.strictEqual(calls[1].params[4], '2026-09-22');
  assert.strictEqual(calls[1].params[5], '2026-09-28');

  calls.length = 0;
  await repo.createPending({
    analysisPackage:{
      schemaVersion:'1.0',
      shop:{ shopId:1 },
      campaign:{ campaignId:278179506 },
      period:{ startDate:'2026-09-22', endDate:'2026-09-28', dataCutoff:'2026-09-28T23:59:59Z' },
      trigger:{ type:'MANUAL', reason:'TEST' },
    },
    skillName:'shopee-gmv-max-analysis',
    skillVersion:'0.2.0',
  });
  assert.strictEqual(calls[0].params[1], 278179506, 'numeric campaigns must keep campaign_id');
  assert.strictEqual(calls[0].params[2], null, 'numeric campaigns must not write promotion_key');

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  assert(schema.includes('promotion_key TEXT'), 'schema must support Ad Group report promotion_key');
  assert(schema.includes('idx_shopee_skill_reports_promotion_time'), 'schema must index Ad Group reports');

  console.log('shopee skill report repository scope-key tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
