'use strict';

const assert = require('assert');
const {
  OPENAI_RESPONSES_URL,
  toOpenAIStrictSchema,
  createOpenAISkillProvider,
  createConfiguredSkillProvider,
} = require('../src/openai-skill-provider');

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
    stage: { type: 'string', enum: ['LEARNING', 'CONVERGING', 'STABLE', 'UNSTABLE'] },
    limitations: { type: 'array', items: { type: 'string' } },
    signal: { type: 'object' },
  },
  additionalProperties: false,
};

function readFileSync(file) {
  if (String(file).endsWith('SKILL.md')) return skillMarkdown;
  if (String(file).endsWith('analysis-output.schema.json')) return JSON.stringify(outputSchema);
  throw new Error(`unexpected file: ${file}`);
}

(async () => {
  const strict = toOpenAIStrictSchema(outputSchema);
  assert.deepStrictEqual(strict.required, ['stage', 'limitations', 'signal']);
  assert.strictEqual(strict.additionalProperties, false);
  assert.deepStrictEqual(strict.signal, undefined);
  assert.strictEqual(strict.properties.signal.additionalProperties, false);
  assert.deepStrictEqual(strict.properties.signal.required, ['summary']);

  assert.strictEqual(createConfiguredSkillProvider({ env:{} }), null);
  assert.throws(
    () => createConfiguredSkillProvider({ env:{ SHOPEE_SKILL_RUNTIME_PROVIDER:'OTHER' } }),
    /Unsupported SHOPEE_SKILL_RUNTIME_PROVIDER/,
  );
  assert.throws(
    () => createConfiguredSkillProvider({
      env:{ SHOPEE_SKILL_RUNTIME_PROVIDER:'OPENAI' },
      readFileSync,
    }),
    /SHOPEE_SKILL_OPENAI_API_KEY is required/,
  );

  let captured = null;
  const provider = createOpenAISkillProvider({
    env:{
      SHOPEE_SKILL_OPENAI_API_KEY:'secret-test-key',
      SHOPEE_SKILL_OPENAI_MODEL:'gpt-5.6-terra',
      SHOPEE_SKILL_OPENAI_REASONING_EFFORT:'medium',
      SHOPEE_SKILL_OPENAI_MAX_OUTPUT_TOKENS:'4000',
      SHOPEE_SKILL_OPENAI_TIMEOUT_MS:'5000',
    },
    readFileSync,
    fetchImpl:async (url, options) => {
      captured = { url, options };
      return {
        ok:true,
        status:200,
        headers:{ get() { return null; } },
        async json() {
          return {
            status:'completed',
            output:[{
              type:'message',
              content:[{
                type:'output_text',
                text:JSON.stringify({
                  stage:'CONVERGING',
                  limitations:[],
                  signal:{ summary:'Evidence is still forming.' },
                }),
              }],
            }],
          };
        },
      };
    },
  });

  const result = await provider.generateStructuredReport({
    skill:{ name:'shopee-gmv-max-analysis', version:'0.1.0' },
    analysisPackage:{
      schemaVersion:'1.0',
      trigger:{ type:'MANUAL' },
      campaign:{ campaignId:99 },
    },
  });

  assert.strictEqual(result.stage, 'CONVERGING');
  assert.strictEqual(captured.url, OPENAI_RESPONSES_URL);
  assert.strictEqual(captured.options.headers.Authorization, 'Bearer secret-test-key');

  const body = JSON.parse(captured.options.body);
  assert.strictEqual(body.model, 'gpt-5.6-terra');
  assert.strictEqual(body.store, false);
  assert.strictEqual(body.reasoning.effort, 'medium');
  assert.strictEqual(body.max_output_tokens, 4000);
  assert.strictEqual(body.text.format.type, 'json_schema');
  assert.strictEqual(body.text.format.strict, true);
  assert.ok(body.input[0].content.includes('Use FACT before INFERENCE.'));
  assert.ok(body.input[1].content.includes('"campaignId":99'));
  assert.ok(!captured.options.body.includes('secret-test-key'));

  const refusalProvider = createOpenAISkillProvider({
    env:{ SHOPEE_SKILL_OPENAI_API_KEY:'secret-test-key' },
    readFileSync,
    fetchImpl:async () => ({
      ok:true,
      status:200,
      headers:{ get() { return null; } },
      async json() {
        return {
          status:'completed',
          output:[{
            type:'message',
            content:[{ type:'refusal', refusal:'no' }],
          }],
        };
      },
    }),
  });
  await assert.rejects(
    () => refusalProvider.generateStructuredReport({
      skill:{ name:'shopee-gmv-max-analysis', version:'0.1.0' },
      analysisPackage:{ schemaVersion:'1.0', trigger:{ type:'MANUAL' } },
    }),
    /refused/,
  );

  console.log('shopee OpenAI skill provider tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
