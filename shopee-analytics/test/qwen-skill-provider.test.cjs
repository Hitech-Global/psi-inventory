'use strict';

const assert = require('assert');
const { createQwenSkillProvider, buildQwenRequest, extractQwenStructuredOutput } = require('../src/qwen-skill-provider');
const { createConfiguredSkillProvider } = require('../src/skill-provider');

const skillMarkdown = `---\nname: shopee-gmv-max-analysis\nversion: 0.1.0\n---\n# Test Skill\nUse FACT before INFERENCE.\n`;
const outputSchema = {
  type: 'object',
  required: ['skill','stage','facts','inferences','hypotheses','skuAssessments','actionGates','nextValidation','limitations'],
  properties: {
    skill: { type:'object', required:['name','version'], properties:{ name:{type:'string'}, version:{type:'string'} }, additionalProperties:false },
    stage: { type: 'string' },
    facts: { type:'array', items:{type:'object'} },
    inferences: { type:'array', items:{type:'object'} },
    hypotheses: { type:'array', items:{type:'object'} },
    skuAssessments: { type:'array', items:{type:'object'} },
    actionGates: { type:'array', items:{type:'object'} },
    nextValidation: { type:'array', items:{type:'string'} },
    limitations: { type:'array', items:{type:'string'} },
  },
  additionalProperties: false,
};
function readFileSync(file) {
  if (String(file).endsWith('SKILL.md')) return skillMarkdown;
  if (String(file).endsWith('analysis-output.schema.json')) return JSON.stringify(outputSchema);
  throw new Error(`unexpected file: ${file}`);
}

(async () => {
  assert.throws(() => createQwenSkillProvider({ env:{}, readFileSync }), /QWEN_API_KEY/);
  assert.throws(() => createQwenSkillProvider({ env:{ SHOPEE_SKILL_QWEN_API_KEY:'secret' }, readFileSync }), /QWEN_BASE_URL/);

  let captured = null;
  const progress = [];
  const report = {
    skill:{ name:'shopee-gmv-max-analysis', version:'0.1.0' },
    stage:'CONVERGING', facts:[], inferences:[], hypotheses:[], skuAssessments:[], actionGates:[], nextValidation:[], limitations:[],
  };
  const provider = createQwenSkillProvider({
    env:{
      SHOPEE_SKILL_QWEN_API_KEY:'qwen-secret',
      SHOPEE_SKILL_QWEN_BASE_URL:'https://workspace.example.com/compatible-mode/v1/',
      SHOPEE_SKILL_QWEN_MODEL:'qwen3.7-plus',
      SHOPEE_SKILL_QWEN_TIMEOUT_MS:'5000',
      SHOPEE_SKILL_QWEN_MAX_OUTPUT_TOKENS:'4096',
    },
    readFileSync,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok:true, status:200,
        async json(){ return { choices:[{ message:{ content:JSON.stringify(report) } }] }; },
      };
    },
  });
  const result = await provider.generateStructuredReport({
    skill:{ name:'shopee-gmv-max-analysis', version:'0.1.0' },
    analysisPackage:{ schemaVersion:'1.0', presentation:{language:'zh-CN'}, campaignDaily:[], itemDaily:[], items:[], deterministicMetrics:{ campaign:{}, dailyAllocation:[] } },
    onProgress:(...args) => progress.push(args),
  });
  assert.strictEqual(result.stage, 'CONVERGING');
  assert.strictEqual(captured.url, 'https://workspace.example.com/compatible-mode/v1/chat/completions');
  assert.strictEqual(captured.options.headers.Authorization, 'Bearer qwen-secret');
  const body = JSON.parse(captured.options.body);
  assert.strictEqual(body.model, 'qwen3.7-plus');
  assert.strictEqual(body.enable_thinking, false);
  assert.strictEqual(body.max_completion_tokens, 4096);
  assert.strictEqual(body.response_format.type, 'json_schema');
  assert.strictEqual(body.response_format.json_schema.strict, true);
  assert.strictEqual(body.response_format.json_schema.schema.additionalProperties, false);
  assert(body.messages[0].content.includes('Use FACT before INFERENCE.'));
  assert(body.messages[0].content.includes('Simplified Chinese'));
  assert.deepStrictEqual(progress.map(row => row[0]), [40,82,90]);

  const routed = createConfiguredSkillProvider({
    env:{
      SHOPEE_SKILL_RUNTIME_PROVIDER:'QWEN',
      SHOPEE_SKILL_QWEN_API_KEY:'qwen-secret',
      SHOPEE_SKILL_QWEN_BASE_URL:'https://workspace.example.com/compatible-mode/v1',
    },
    readFileSync,
    fetchImpl: async () => ({ ok:true, status:200, async json(){ return { choices:[{message:{content:JSON.stringify(report)}}] }; } }),
  });
  assert.strictEqual(typeof routed.generateStructuredReport, 'function');
  assert.deepStrictEqual(extractQwenStructuredOutput({ choices:[{ message:{ content:'{"stage":"STABLE"}' } }] }), { stage:'STABLE' });

  const request = buildQwenRequest({ model:'qwen3.7-plus', maxOutputTokens:1000, skill:{name:'x',version:'1'}, skillMarkdown:'skill', strictOutputSchema:{type:'object'}, analysisPackage:{} });
  assert.strictEqual(request.enable_thinking, false);
  assert.strictEqual(request.response_format.json_schema.strict, true);
  const englishRequest = buildQwenRequest({ model:'qwen3.7-plus', maxOutputTokens:1000, skill:{name:'x',version:'1'}, skillMarkdown:'skill', strictOutputSchema:{type:'object'}, analysisPackage:{presentation:{language:'en-US'}} });
  assert(englishRequest.messages[0].content.includes('free-text field in English'));
  console.log('shopee Qwen skill provider tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });