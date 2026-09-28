'use strict';

const { createOpenAISkillProvider } = require('./openai-skill-provider');
const { createOllamaSkillProvider } = require('./ollama-skill-provider');
const { createQwenSkillProvider } = require('./qwen-skill-provider');

function createConfiguredSkillProvider(options = {}) {
  const env = options.env || process.env;
  const providerName = String(env.SHOPEE_SKILL_RUNTIME_PROVIDER || '').trim().toUpperCase();
  if (!providerName) return null;
  if (providerName === 'OPENAI') return createOpenAISkillProvider({ ...options, env });
  if (providerName === 'OLLAMA') return createOllamaSkillProvider({ ...options, env });
  if (providerName === 'QWEN') return createQwenSkillProvider({ ...options, env });
  throw new Error(`Unsupported SHOPEE_SKILL_RUNTIME_PROVIDER: ${providerName}`);
}

module.exports = { createConfiguredSkillProvider };