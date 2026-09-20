'use strict';

const SKILL_NAME = 'shopee-gmv-max-analysis';
const SKILL_VERSION = '0.1.0';

function validateReport(report) {
  if (!report || typeof report !== 'object') throw new Error('Skill report must be an object');
  if (!report.skill || report.skill.name !== SKILL_NAME) throw new Error('Skill report name mismatch');
  if (report.skill.version !== SKILL_VERSION) throw new Error('Skill report version mismatch');
  if (!['LEARNING','CONVERGING','STABLE','UNSTABLE'].includes(report.stage)) throw new Error('Invalid skill report stage');
  for (const key of ['facts','inferences','hypotheses','skuAssessments','actionGates','nextValidation']) {
    if (!Array.isArray(report[key])) throw new Error(`Skill report ${key} must be an array`);
  }
  const factIds = new Set(report.facts.map(f => f && f.id).filter(Boolean));
  for (const inference of report.inferences) {
    if (!Array.isArray(inference.evidenceIds) || !inference.evidenceIds.length) {
      throw new Error('Every inference requires evidenceIds');
    }
    if (inference.evidenceIds.some(id => !factIds.has(id))) {
      throw new Error('Inference references unknown FACT evidence');
    }
  }
  for (const hypothesis of report.hypotheses) {
    if (!hypothesis.validation) throw new Error('Every hypothesis requires a validation condition');
  }
  return report;
}

class SkillRunner {
  constructor({ executor, reportRepository }) {
    if (typeof executor !== 'function') throw new Error('SkillRunner requires an executor');
    this.executor = executor;
    this.reportRepository = reportRepository;
  }

  async run(analysisPackage) {
    const pending = this.reportRepository
      ? await this.reportRepository.createPending({ analysisPackage, skillName: SKILL_NAME, skillVersion: SKILL_VERSION })
      : null;
    try {
      const raw = await this.executor({
        skillName: SKILL_NAME,
        skillVersion: SKILL_VERSION,
        analysisPackage,
      });
      const report = validateReport(raw);
      if (this.reportRepository && pending) {
        await this.reportRepository.complete({ reportId: pending.id, report });
      }
      return { reportId: pending && pending.id || null, report };
    } catch (error) {
      if (this.reportRepository && pending) await this.reportRepository.fail({ reportId: pending.id, error });
      throw error;
    }
  }
}

module.exports = { SKILL_NAME, SKILL_VERSION, validateReport, SkillRunner };
