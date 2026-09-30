'use strict';

const assert = require('assert');
const http = require('http');
const {
  createOllamaSkillProvider,
  compactAnalysisPackage,
  sanitizeOllamaReport,
  requestOllamaStreamOverHttp,
  parseOllamaStreamText,
  buildOllamaRequest,
  extractOllamaStructuredOutput,
} = require('../src/ollama-skill-provider');
const { createConfiguredSkillProvider } = require('../src/skill-provider');

const skillMarkdown = `---
name: shopee-gmv-max-analysis
version: 0.1.0
---
# Test Skill
Use FACT before INFERENCE.
`;
const outputSchema = {
  type: 'object',
  required: ['stage'],
  properties: {
    stage: { type: 'string' },
    limitations: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
};
function readFileSync(file) {
  if (String(file).endsWith('SKILL.md')) return skillMarkdown;
  if (String(file).endsWith('analysis-output.schema.json')) return JSON.stringify(outputSchema);
  throw new Error(`unexpected file: ${file}`);
}

(async () => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ message: { role: 'assistant', content: '{"stage":' } }) + '\n');
      res.end(JSON.stringify({ message: { role: 'assistant', content: '"STABLE"}' }, done: true }) + '\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const nativeResult = await requestOllamaStreamOverHttp(
      `http://127.0.0.1:${address.port}/api/chat`,
      { value: 42, stream: true },
      1000,
    );
    assert.strictEqual(nativeResult.ok, true);
    assert.strictEqual(nativeResult.status, 200);
    assert.strictEqual(nativeResult.payload.message.content, '{"stage":"STABLE"}');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const compact = compactAnalysisPackage({
    campaignDaily: [{ shop_id: 1, campaign_id: 2, event_date: '2026-09-28', impressions: 10, raw_json: { noisy: true }, synced_at: 'now' }],
    itemDaily: [{ item_id: 3, direct_orders: 2, raw_json: { noisy: true } }],
    campaign: { campaignId: 2, raw_json: { noisy: true } },
  });
  assert.deepStrictEqual(compact.campaignDaily, [{ event_date: '2026-09-28', impressions: 10 }]);
  assert.deepStrictEqual(compact.itemDaily, [{ item_id: 3, direct_orders: 2 }]);
  assert.deepStrictEqual(compact.campaign, { campaignId: 2 });
  assert.deepStrictEqual(compact.evidenceAvailability, {
    campaignDailyRows: 1,
    comparisonCampaignDailyRows: 0,
    itemDailyRows: 1,
    comparisonItemDailyRows: 0,
    itemAggregateRows: 0,
    dailyAllocationRows: 0,
    operationsRows: 0,
    hasItemLevelEvidence: true,
    hasAllocationEvidence: false,
    hasComparablePreviousWindow: false,
    hasComparableItemWindow: false,
    hasAddToCartEvidence: false,
    hasTargetRoasEvidence: false,
    hasBreakEvenEvidence: false,
    hasRecommendedRoasEvidence: false,
  });
  const dirtyReport = {
    skill: { name: 'shopee-gmv-max-analysis', version: '0.1.0' },
    stage: 'LEARNING',
    facts: [
      { id: 'f1', metric: 'campaignDailyRows', value: 14, unit: 'days', statement: '14 days available.' },
      { id: 'f1dup', metric: 'campaignDailyRows', value: 14, unit: 'days', statement: 'Campaign also has 14 days.' },
      { id: 'f2', metric: 'directCvr14d', value: 0.05, unit: 'ratio', statement: 'Direct CVR is 0.05.' },
      { id: 'f3', metric: 'roasVolatility', value: 0.15, unit: 'ratio', statement: 'ROAS volatility is 0.15.' },
      { id: 'f4', metric: 'leaderSwitchCount', value: 0, unit: 'times', statement: 'Leader switch count is zero.' },
    ],
    inferences: [
      { statement: 'The observation window contains 14 days.', evidenceIds: ['f1dup'] },
      { statement: 'Direct CVR is relatively stable.', evidenceIds: ['f2'] },
      { statement: 'ROAS shows instability.', evidenceIds: ['f3'] },
      { statement: 'No leader switching indicates consistent performance.', evidenceIds: ['f4'] },
      { statement: 'Lack of multi-SKU success prevents STABLE classification.', evidenceIds: ['f1'] },
      { statement: 'Spend Share above 80% maintains ROAS above 8.0.', evidenceIds: ['f3'] },
    ],
    hypotheses: [
      { statement: 'Keeping Spend Share above 80% will maintain ROAS above 8.0.', validation: 'Keep Spend Share above 80% for 7 days.' },
    ],
    skuAssessments: [{ itemId: 'none', trafficStage: 'C', candidateRole: 'WEAK_EXPLORER' }],
    actionGates: [{ code: 'LEARNING', allowed: true, reason: 'Learning stage.' }],
    nextValidation: [],
    limitations: [],
  };
  const guarded = sanitizeOllamaReport(dirtyReport, {
    evidenceAvailability: { hasItemLevelEvidence: false, hasAllocationEvidence: false },
  });
  assert.deepStrictEqual(guarded.skuAssessments, []);
  assert.strictEqual(guarded.facts.filter(row => row.metric === 'campaignDailyRows').length, 1);
  assert.strictEqual(guarded.facts.some(row => row.metric === 'leaderSwitchCount'), false);
  assert.strictEqual(guarded.inferences.some(row => /relatively stable/i.test(row.statement)), false);
  assert.strictEqual(guarded.inferences.some(row => /leader/i.test(row.statement)), false);
  assert.strictEqual(guarded.inferences.some(row => /ROAS shows instability/i.test(row.statement)), true);
  assert.strictEqual(guarded.inferences.some(row => /multi-SKU success prevents/i.test(row.statement)), false);
  assert.strictEqual(guarded.inferences.some(row => /Spend Share above 80%/i.test(row.statement)), false);
  assert.deepStrictEqual(guarded.hypotheses, []);
  assert.deepStrictEqual(guarded.inferences.find(row => /observation window/i.test(row.statement)).evidenceIds, ['f1']);
  assert.strictEqual(guarded.actionGates.length, 1);
  assert.strictEqual(guarded.actionGates[0].code, 'OBSERVE');
  assert(guarded.limitations.some(row => /SKU assessments are omitted/i.test(row)));
  assert(guarded.limitations.some(row => /leader-switch conclusions are omitted/i.test(row)));
  const belowConfiguredMaturity = sanitizeOllamaReport(dirtyReport, {
    deterministicMetrics: {
      maturity: { minimumObservationDays: 7, weeklyOrderReference: 40, observedDays7d: 7, directOrders7d: 30 },
      campaign: { directOrders7d: 30 },
    },
    evidenceAvailability: { campaignDailyRows: 14, hasItemLevelEvidence: false, hasAllocationEvidence: false },
  });
  assert.strictEqual(belowConfiguredMaturity.stage, 'LEARNING');

  const matureGuarded = sanitizeOllamaReport(dirtyReport, {
    deterministicMetrics: {
      maturity: { minimumObservationDays: 7, weeklyOrderReference: 40, observedDays7d: 7, directOrders7d: 41 },
      campaign: { directOrders7d: 41 },
    },
    evidenceAvailability: {
      campaignDailyRows: 14,
      hasItemLevelEvidence: false,
      hasAllocationEvidence: false,
    },
  });
  assert.strictEqual(matureGuarded.stage, 'CONVERGING');
  assert(matureGuarded.facts.some(row => row.metric === 'maturityDirectOrders' && row.value === 41));
  assert(matureGuarded.inferences.some(row => /40-Direct-Order reference/i.test(row.statement)));
  assert.strictEqual(matureGuarded.inferences.some(row => /LEARNING stage/i.test(row.statement)), false);
  assert.strictEqual(matureGuarded.actionGates[0].code, 'STRUCTURAL_CHANGE');
  assert.strictEqual(matureGuarded.actionGates[0].allowed, false);

  const resetLearning = sanitizeOllamaReport({
    ...dirtyReport,
    stage:'STABLE',
  }, {
    deterministicMetrics: {
      maturity: { minimumObservationDays:7, weeklyOrderReference:25, observedCalendarDays:3, directOrdersSinceEpoch:30, sampleMature:false, basis:'CURRENT_LEARNING_EPOCH' },
      timeContext: { learningEpoch:{ available:true, calendarDays:3 }, stabilityJudgmentBlocked:false },
      campaign: { directOrders7d:30 },
    },
    evidenceAvailability:{ campaignDailyRows:14, hasItemLevelEvidence:false, hasAllocationEvidence:false },
  });
  assert.strictEqual(resetLearning.stage, 'LEARNING');

  const unresolvedSource = sanitizeOllamaReport({
    ...dirtyReport,
    stage:'STABLE',
  }, {
    deterministicMetrics: {
      maturity: { minimumObservationDays:7, weeklyOrderReference:25, observedCalendarDays:10, directOrdersSinceEpoch:80, sampleMature:false, basis:'CURRENT_LEARNING_EPOCH' },
      timeContext: { learningEpoch:{ available:true, calendarDays:10 }, stabilityJudgmentBlocked:true },
      campaign: { directOrders7d:80 },
    },
    evidenceAvailability:{ campaignDailyRows:14, hasItemLevelEvidence:false, hasAllocationEvidence:false },
  });
  assert.strictEqual(unresolvedSource.stage, 'CONVERGING');
  assert(unresolvedSource.limitations.some(row => /Operation source is unresolved/i.test(row)));

  const skuGuarded = sanitizeOllamaReport({
    skill:{ name:'shopee-gmv-max-analysis', version:'0.2.0' }, stage:'STABLE',
    facts:[], inferences:[], hypotheses:[], actionGates:[], nextValidation:[], limitations:[],
    skuAssessments:[{
      itemId:'1', trafficStage:'A', candidateRole:'STABLE_CORE',
      signal:{ summary:'Strong Direct ROAS (9.79) with strong CVR.' },
      confidence:{ summary:'Good CTR and healthy CPC.' },
      scaleStability:{ summary:'Scale stability is supported by consistent performance.' },
    }],
  }, {
    items:[{ itemId:'1', directRoas:9.79, breakEvenRoas:null, recommendedRoas:null }],
    evidenceAvailability:{ hasItemLevelEvidence:true, hasAllocationEvidence:false },
  });
  assert(!/strong\s+Direct\s+ROAS/i.test(skuGuarded.skuAssessments[0].signal.summary));
  assert(!/strong\s+CVR/i.test(skuGuarded.skuAssessments[0].signal.summary));
  assert(!/Good\s+CTR|healthy\s+CPC/i.test(skuGuarded.skuAssessments[0].confidence.summary));
  assert(/^UNKNOWN\b/.test(skuGuarded.skuAssessments[0].scaleStability.summary));

  const chineseSignalGuarded = sanitizeOllamaReport({
    skill:{ name:'shopee-gmv-max-analysis', version:'0.2.0' }, stage:'STABLE',
    facts:[], inferences:[], hypotheses:[], actionGates:[], nextValidation:[], limitations:[],
    skuAssessments:[{ itemId:'2', trafficStage:'A', candidateRole:'CONVERSION_ANCHOR', signal:{ summary:'强转化信号，连续7天出单，直接ROAS 9.79。' }, confidence:{ summary:'样本充足。' }, scaleStability:{ summary:'已验证。' } }],
  }, {
    presentation:{ language:'zh-CN' },
    items:[{ itemId:'2', directOrders:134, directRoas:9.79, breakEvenRoas:null, recommendedRoas:null }],
    evidenceAvailability:{ hasItemLevelEvidence:true, hasAllocationEvidence:false },
  });
  assert(chineseSignalGuarded.skuAssessments[0].signal.summary.startsWith('已验证转化信号'));
  assert(!chineseSignalGuarded.skuAssessments[0].signal.summary.includes('强转化信号'));

  assert.strictEqual(createConfiguredSkillProvider({ env: {} }), null);
  assert.throws(
    () => createConfiguredSkillProvider({ env: { SHOPEE_SKILL_RUNTIME_PROVIDER: 'OTHER' } }),
    /Unsupported SHOPEE_SKILL_RUNTIME_PROVIDER/,
  );

  let captured = null;
  const provider = createOllamaSkillProvider({
    env: {
      SHOPEE_SKILL_OLLAMA_BASE_URL: 'http://ollama:11434/',
      SHOPEE_SKILL_OLLAMA_MODEL: 'qwen3:8b',
      SHOPEE_SKILL_OLLAMA_TIMEOUT_MS: '5000',
      SHOPEE_SKILL_OLLAMA_NUM_CTX: '16384',
      SHOPEE_SKILL_OLLAMA_MAX_OUTPUT_TOKENS: '2048',
    },
    readFileSync,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        status: 200,
        async text() {
          return [
            JSON.stringify({ message: { role: 'assistant', content: '{"stage":"CONVERGING",' } }),
            JSON.stringify({ message: { role: 'assistant', content: '"limitations":[]}' }, done: true }),
          ].join('\n') + '\n';
        },
      };
    },
  });

  const result = await provider.generateStructuredReport({
    skill: { name: 'shopee-gmv-max-analysis', version: '0.1.0' },
    analysisPackage: { schemaVersion: '1.0', campaign: { campaignId: 99 } },
  });
  assert.strictEqual(result.stage, 'CONVERGING');
  assert.strictEqual(captured.url, 'http://ollama:11434/api/chat');
  const body = JSON.parse(captured.options.body);
  assert.strictEqual(body.model, 'qwen3:8b');
  assert.strictEqual(body.stream, true);
  assert.strictEqual(body.keep_alive, '2m');
  assert.strictEqual(body.think, false);
  assert.strictEqual(body.options.num_ctx, 16384);
  assert.strictEqual(body.options.num_predict, 2048);
  assert.strictEqual(body.options.temperature, 0);
  assert.strictEqual(body.format.additionalProperties, false);
  assert.ok(body.messages[0].content.includes('Use FACT before INFERENCE.'));
  assert.ok(body.messages[0].content.includes('Do not infer stability from order volume alone'));
  assert.ok(body.messages[0].content.includes('do not require multi-SKU success for STABLE'));
  assert.ok(body.messages[0].content.includes('Spend Share is observed allocation, not a target'));
  assert.ok(body.messages[0].content.includes('Keep the report concise'));
  assert.ok(body.messages[1].content.includes('"campaignId":99'));

  const parsedStream = parseOllamaStreamText([
    JSON.stringify({ message: { content: '{"stage":' } }),
    JSON.stringify({ message: { content: '"STABLE"}' }, done: true }),
  ].join('\n') + '\n');
  assert.strictEqual(parsedStream.message.content, '{"stage":"STABLE"}');

  const routed = createConfiguredSkillProvider({
    env: { SHOPEE_SKILL_RUNTIME_PROVIDER: 'OLLAMA' },
    readFileSync,
    fetchImpl: async () => ({ ok: false, status: 500, async text() { return ''; } }),
  });
  assert.strictEqual(typeof routed.generateStructuredReport, 'function');

  assert.deepStrictEqual(
    extractOllamaStructuredOutput({ message: { content: '{"stage":"STABLE"}' } }),
    { stage: 'STABLE' },
  );

  console.log('shopee Ollama skill provider tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});