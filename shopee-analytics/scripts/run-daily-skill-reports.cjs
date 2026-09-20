'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { createConfiguredSkillProvider } = require('../src/openai-skill-provider');
const { createSkillRuntime } = require('../src/skill-runtime');
const { runDailySkillReports } = require('../src/skill-scheduler');
const { localIsoDate } = require('../src/sync-cycle-utils');

function positiveWindowDays(value) {
  if (value === undefined || value === null || value === '') return 14;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 90) {
    throw new Error('SHOPEE_SKILL_DAILY_WINDOW_DAYS must be an integer from 1 to 90');
  }
  return parsed;
}

async function main() {
  const skillProvider = createConfiguredSkillProvider();
  if (!skillProvider) {
    throw new Error('Skill runtime provider is not configured');
  }

  const pool = createAnalyticsPool();
  try {
    const runtime = createSkillRuntime({ pool, skillProvider });
    const shops = await runtime.queryRepository.listShops({ activeOnly: true });
    const windowDays = positiveWindowDays(process.env.SHOPEE_SKILL_DAILY_WINDOW_DAYS);

    const results = await runDailySkillReports({
      shops,
      queryRepository: runtime.queryRepository,
      runSkillAnalysis: runtime.runSkillAnalysis,
      localDateForShop:shop => localIsoDate(new Date(), shop.timezone),
      windowDays,
    });

    const succeeded = results.filter(row => row.ok).length;
    const failed = results.length - succeeded;
    console.log(JSON.stringify({
      event:'skill-daily-complete',
      shopCount:shops.length,
      campaignCount:results.length,
      succeeded,
      failed,
      windowDays,
      completedAt:new Date().toISOString(),
    }));

    if (failed > 0) {
      const failedCampaigns = results
        .filter(row => !row.ok)
        .map(row => ({ shopId:row.shopId, campaignId:row.campaignId, error:row.error }));
      console.error(JSON.stringify({
        event:'skill-daily-campaign-failures',
        failedCampaigns,
      }));
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      event:'skill-daily-failure',
      failedAt:new Date().toISOString(),
      error:error && error.message ? error.message : String(error),
    }));
    process.exitCode = 1;
  });
}

module.exports = { positiveWindowDays, main };
