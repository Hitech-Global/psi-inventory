'use strict';

const { ShopeeAnalyticsRepository } = require('./repository');
const { ShopeeStrategyRepository } = require('./strategy-repository');
const { ShopeeQueryRepository } = require('./query-repository');
const { SkillReportRepository } = require('./skill-report-repository');
const { SkillRunner } = require('./skill-runner');
const { createSkillExecutor, disabledSkillProvider } = require('./skill-executor');
const { buildCampaignSkillPackage } = require('./skill-analysis-service');

function createSkillRuntime({
  pool,
  skillProvider = null,
  now = () => new Date(),
}) {
  if (!pool) throw new Error('Skill runtime requires a database pool');

  const repository = new ShopeeAnalyticsRepository({ pool });
  const strategyRepository = new ShopeeStrategyRepository({ pool });
  const queryRepository = new ShopeeQueryRepository({ pool });
  const skillReportRepository = new SkillReportRepository(pool);
  const skillExecutor = createSkillExecutor({
    provider: skillProvider || disabledSkillProvider(),
  });
  const skillRunner = new SkillRunner({
    executor: skillExecutor,
    reportRepository: skillReportRepository,
  });

  const runSkillAnalysis = async ({
    shopId,
    campaignId,
    startDate,
    endDate,
    triggerType,
    triggerReason,
  }) => {
    const analysisPackage = await buildCampaignSkillPackage({
      repository,
      queryRepository,
      strategyRepository,
      shopId,
      campaignId,
      startDate,
      endDate,
      dataCutoff: now().toISOString(),
      triggerType,
      triggerReason,
    });
    return skillRunner.run(analysisPackage);
  };

  return {
    repository,
    strategyRepository,
    queryRepository,
    skillReportRepository,
    skillRunner,
    runSkillAnalysis,
  };
}

module.exports = { createSkillRuntime };
