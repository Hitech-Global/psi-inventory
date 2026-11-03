'use strict';

/**
 * TikTok Shop 定时同步脚本。
 * ============================================================================================
 * 这个脚本被调度器（scripts/sync-scheduler.cjs）周期性调用，把 TikTok 店铺的数据
 * 拉回来落库。它自己**不做调度决策**，只做一次同步 —— 调度周期由外部决定。
 *
 * 时间窗与 30 天上限
 * ------------------
 * TikTok 的报表端点带 stat_time_day 维度时，单次跨度不得超过 30 天
 * （见 src/tiktok-sync-service.js 的 splitDateRange）。
 * 本脚本默认同步"最近 N 天"，N 由环境变量控制且**不允许超过 30** ——
 * 超过就得拆窗，而拆窗会让"这一轮同步到哪儿了"变得难以解释。
 * 更长的历史回补交给手动同步接口（它内部会拆窗）。
 *
 * 店铺范围
 * --------
 * 一次 TikTok 授权覆盖卖家名下全部店铺，因此这里是"同步已授权的所有店铺"，
 * 而不是像 Shopee 那样按店铺逐个配置。可以用 TIKTOK_SYNC_SHOP_IDS 缩小范围。
 *
 * 只读约束：只调用查询类端点。
 */

const { createAnalyticsPool } = require('../src/pg');
const { TikTokSyncRunner } = require('../src/tiktok-sync-runner');
const { TikTokTokenRepository } = require('../src/tiktok-token-repository');
const { TikTokTokenManager } = require('../src/tiktok-token-manager');
const { loadMasterKey } = require('../src/token-crypto');
const { assertOnlineOperationAllowed } = require('../src/deployment-mode');

/** 单次同步允许的最大跨度（天）。与报表端点的 30 天上限一致。 */
const MAX_SYNC_WINDOW_DAYS = 30;

/** 默认回看天数。订单数据有延迟，回看 3 天能覆盖延迟。 */
const DEFAULT_LOOKBACK_DAYS = 3;

/**
 * 解析回看天数。
 *
 * 上限是 30 天 —— 超过就得拆窗，而拆窗会让"这一轮同步到哪儿了"变得难以解释。
 *
 * @param {object} env
 * @returns {number}
 */
function resolveLookbackDays(env = process.env) {
  const raw = String(env.TIKTOK_SYNC_LOOKBACK_DAYS || '').trim();
  if (!raw) return DEFAULT_LOOKBACK_DAYS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('TIKTOK_SYNC_LOOKBACK_DAYS must be a positive integer');
  }
  if (value > MAX_SYNC_WINDOW_DAYS) {
    throw new Error(
      `TIKTOK_SYNC_LOOKBACK_DAYS cannot exceed ${MAX_SYNC_WINDOW_DAYS} days; ` +
      'use the manual sync endpoint for longer backfills',
    );
  }
  return value;
}

/**
 * 解析要同步的店铺过滤。
 *
 * @param {object} env
 * @returns {Set<string>|null} null 表示不过滤（同步全部已授权店铺）
 */
function resolveShopFilter(env = process.env) {
  const raw = String(env.TIKTOK_SYNC_SHOP_IDS || '').trim();
  if (!raw) return null;
  const ids = raw.split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (!ids.length) return null;
  return new Set(ids);
}

/**
 * 计算同步区间。
 *
 * 结束日取"昨天"：今天的订单还在变，今天的数据明天再拉一次更稳。
 *
 * @param {object} options
 * @returns {{startDate: string, endDate: string}}
 */
function resolveSyncWindow({ env = process.env, now = new Date() }) {
  const lookbackDays = resolveLookbackDays(env);
  const today = new Date(now.getTime());
  const end = new Date(today.getTime() - 86400000);
  const start = new Date(end.getTime() - (lookbackDays - 1) * 86400000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/**
 * 列出已授权的 TikTok 店铺。
 *
 * @returns {Promise<Array<object>>}
 */
async function listAuthorizedShops({ pool, env }) {
  const repository = new TikTokTokenRepository({ pool, masterKey: loadMasterKey(env) });
  const appKey = String(env.TIKTOK_APP_KEY || '').trim();
  if (!appKey) throw new Error('TIKTOK_APP_KEY is required');
  const regionGroup = String(env.TIKTOK_REGION_GROUP || 'ROW').trim().toUpperCase();
  if (regionGroup !== 'ROW' && regionGroup !== 'US') {
    throw new Error('TIKTOK_REGION_GROUP must be ROW or US');
  }
  return repository.listShops({ appKey, regionGroup });
}

/**
 * 同步前先刷新临近过期的凭据。
 *
 * 为什么要单独刷一遍：runner 在取凭据时也会按需刷新，
 * 但那是"用到才刷"。这里提前刷是为了让**整批店铺**都在同一套有效凭据下跑，
 * 也让刷新失败在同步开始前就暴露出来（而不是拖到某一家店取凭据时才报）。
 *
 * 单店刷新失败不影响整批 —— 刷新器自己处理了这件事。
 */
async function refreshExpiringCredentials({ pool, env }) {
  const repository = new TikTokTokenRepository({ pool, masterKey: loadMasterKey(env) });
  const manager = new TikTokTokenManager({ tokenRepository: repository, env });
  return manager.refreshExpiring();
}

async function main() {
  if (process.env.TIKTOK_ANALYTICS_ENABLE_SYNC !== 'YES') {
    throw new Error('Refusing TikTok sync. Set TIKTOK_ANALYTICS_ENABLE_SYNC=YES explicitly.');
  }
  assertOnlineOperationAllowed('TikTok multi-shop sync');

  const env = process.env;
  const { startDate, endDate } = resolveSyncWindow({ env });
  const filter = resolveShopFilter(env);

  const pool = createAnalyticsPool();
  try {
    const shops = await listAuthorizedShops({ pool, env });
    const shopIds = shops
      .map(shop => shop.shopId)
      .filter(shopId => !filter || filter.has(shopId));

    if (!shopIds.length) {
      console.log(JSON.stringify({
        event: 'tiktok-sync-skipped',
        reason: filter ? 'no authorized shop matches the filter' : 'no authorized TikTok shop',
        startDate,
        endDate,
      }));
      return;
    }

    const runner = new TikTokSyncRunner({ pool, env });

    // 先刷凭据，再同步。刷新失败会在这一步就体现出来。
    const refresh = await refreshExpiringCredentials({ pool, env });

    const result = await runner.runAll({ shopIds, startDate, endDate });

    console.log(JSON.stringify({
      event: 'tiktok-sync-complete',
      startDate,
      endDate,
      refreshedCredentials: refresh.refreshed.length,
      failedCredentialRefreshes: refresh.failed.map(item => item.shopId),
      shopCount: result.shopCount,
      okShopCount: result.okShopCount,
      failedShopCount: result.failedShopCount,
      summaries: result.summaries,
    }, null, 2));

    if (result.failedShopCount) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_LOOKBACK_DAYS,
  MAX_SYNC_WINDOW_DAYS,
  listAuthorizedShops,
  main,
  refreshExpiringCredentials,
  resolveLookbackDays,
  resolveShopFilter,
  resolveSyncWindow,
};
