'use strict';

const { ShopeeAnalyticsRepository } = require('./repository');
const { ShopeeStrategyRepository } = require('./strategy-repository');
const { ShopeeQueryRepository } = require('./query-repository');
const { ShopeeAdPromotionRepository } = require('./ad-promotion-repository');
const { SkillReportRepository } = require('./skill-report-repository');
const { SkillRunner } = require('./skill-runner');
const { createSkillExecutor, disabledSkillProvider } = require('./skill-executor');
const { buildCampaignSkillPackage, buildAdGroupSkillPackage } = require('./skill-analysis-service');
const { assertOnlineOperationAllowed } = require('./deployment-mode');

function createSkillRuntime({
  pool,
  skillProvider = null,
  now = () => new Date(),
}) {
  if (!pool) throw new Error('Skill runtime requires a database pool');

  const repository = new ShopeeAnalyticsRepository({ pool });
  const strategyRepository = new ShopeeStrategyRepository({ pool });
  const queryRepository = new ShopeeQueryRepository({ pool });
  const adPromotionRepository = new ShopeeAdPromotionRepository({ pool });
  const skillReportRepository = new SkillReportRepository(pool);
  const skillExecutor = createSkillExecutor({
    provider: skillProvider || disabledSkillProvider(),
  });
  const skillRunner = new SkillRunner({
    executor: skillExecutor,
    reportRepository: skillReportRepository,
  });
  const adGroupSkillRunner = new SkillRunner({
    executor: skillExecutor,
    reportRepository: null,
  });

  const runSkillAnalysis = async ({
    shopId,
    campaignId,
    startDate,
    endDate,
    triggerType,
    triggerReason,
  }) => {
    assertOnlineOperationAllowed('Skill Runtime analysis');
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

  const runAdGroupSkillAnalysis = async ({
    shopId,
    promotionKey,
    startDate,
    endDate,
    triggerType,
    triggerReason,
  }) => {
    assertOnlineOperationAllowed('Ad Group Skill Runtime analysis');
    const analysisPackage = await buildAdGroupSkillPackage({
      adPromotionRepository,
      queryRepository,
      strategyRepository,
      shopId,
      promotionKey,
      startDate,
      endDate,
      dataCutoff: now().toISOString(),
      triggerType,
      triggerReason,
    });
    return adGroupSkillRunner.run(analysisPackage);
  };

  return {
    repository,
    strategyRepository,
    queryRepository,
    adPromotionRepository,
    skillReportRepository,
    skillRunner,
    runSkillAnalysis,
    runAdGroupSkillAnalysis,
  };
}

module.exports = { createSkillRuntime };
