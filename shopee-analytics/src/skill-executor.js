'use strict';

const { SKILL_NAME, SKILL_VERSION } = require('./skill-runner');

const ALLOWED_TRIGGER_TYPES = new Set(['DAILY_AUTO', 'MANUAL', 'EVENT_REVIEW']);

function createSkillExecutor({ provider }) {
  if (!provider || typeof provider.generateStructuredReport !== 'function') {
    throw new Error('Skill executor provider must implement generateStructuredReport');
  }

  return async ({ skillName, skillVersion, analysisPackage }) => {
    if (skillName !== SKILL_NAME || skillVersion !== SKILL_VERSION) {
      throw new Error('Unsupported skill identity');
    }
    if (!analysisPackage || analysisPackage.schemaVersion !== '1.0') {
      throw new Error('Unsupported analysis package schema');
    }
    if (!ALLOWED_TRIGGER_TYPES.has(analysisPackage.trigger && analysisPackage.trigger.type)) {
      throw new Error('Unsupported analysis trigger');
    }

    return provider.generateStructuredReport({
      skill: { name: skillName, version: skillVersion },
      analysisPackage,
    });
  };
}

function disabledSkillProvider() {
  return {
    async generateStructuredReport() {
      throw new Error(
        'GMV Max skill runtime provider is not configured. Refusing to fabricate a report.',
      );
    },
  };
}

module.exports = { createSkillExecutor, disabledSkillProvider, ALLOWED_TRIGGER_TYPES };
