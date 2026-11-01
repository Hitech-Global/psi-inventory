'use strict';

/**
 * TikTok 凭据存储测试。
 *
 * 重点覆盖两处安全约束：
 *   1. **cipher 与 shop_id 必须成对** —— 这是防止串店（读到别的品牌数据）的核心；
 *   2. **Marketing API 凭据独立分区** —— 24 小时过期与 Shop API 的长周期不同，
 *      混在一起会导致刷新调度误判。
 */

const assert = require('assert');
const {
  MARKETING_TOKEN_REFRESH_MARGIN_SECONDS,
  MARKETING_TOKEN_TTL_SECONDS,
  SHOP_TOKEN_REFRESH_MARGIN_SECONDS,
  TikTokMarketingTokenRepository,
  TikTokTokenRepository,
  isExpired,
  sanitizeTikTokError,
} = require('../src/tiktok-token-repository');
const { encryptTokenBundle } = require('../src/token-crypto');

const MASTER_KEY = Buffer.alloc(32, 7);

/**
 * 记录所有 SQL 与参数的假 pool。
 */
function fakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
}

function encryptedBundle() {
  const encrypted = encryptTokenBundle(
    { accessToken: 'access-1', refreshToken: 'refresh-1' },
    MASTER_KEY,
  );
  return { ...encrypted, expires_at: new Date('2026-12-01T00:00:00Z') };
}

// ---- 过期判定 ----

const now = Date.parse('2026-11-01T00:00:00Z');
assert.strictEqual(isExpired(null, 0, now), true, '无过期时间视为已过期');
assert.strictEqual(isExpired('2026-11-01T00:10:00Z', 0, now), false);
assert.strictEqual(isExpired('2026-11-01T00:10:00Z', 600, now), true, '提前量内视为需刷新');
assert.strictEqual(isExpired(new Date('2026-11-01T00:10:00Z'), 0, now), false);
assert.strictEqual(isExpired('not-a-date', 0, now), true);
assert.strictEqual(isExpired(0, 0, now), true, '时间戳 0 视为已过期');

// Marketing API token 是 24 小时有效，Shop API 的提前量是 300 秒
assert.strictEqual(MARKETING_TOKEN_TTL_SECONDS, 86400);
assert.strictEqual(MARKETING_TOKEN_REFRESH_MARGIN_SECONDS, 3600);
assert.strictEqual(SHOP_TOKEN_REFRESH_MARGIN_SECONDS, 300);

// ---- Shop Open API 凭据 ----

(async () => {
  const pool = fakePool();
  const repository = new TikTokTokenRepository({ pool, masterKey: MASTER_KEY });

  await repository.save({
    appKey: 'ROW_APP',
    regionGroup: 'ROW',
    shopId: 'shop-1',
    shopCipher: 'CIPHER-1',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: new Date('2026-12-01T00:00:00Z'),
  });

  const insert = pool.calls[0];
  assert.ok(insert.sql.includes('INSERT INTO tiktok_shop_tokens'));
  // cipher 与 shop_id 必须同时出现在插入参数里
  const paramIndex = text => insert.params.indexOf(text);
  assert.ok(paramIndex('shop-1') >= 0, 'shop_id 必须入库');
  assert.ok(paramIndex('CIPHER-1') >= 0, 'shop_cipher 必须入库');
  // 令牌必须是密文
  assert.ok(!insert.params.includes('access-1'), 'access token 不得明文入库');
  assert.ok(!insert.params.includes('refresh-1'), 'refresh token 不得明文入库');

  // 缺 cipher 时必须拒绝保存 —— 成对是硬约束
  await assert.rejects(
    () => repository.save({
      appKey: 'ROW_APP',
      regionGroup: 'ROW',
      shopId: 'shop-1',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: new Date(),
    }),
    /shopCipher is required/,
  );

  // 缺 shop_id 时同样拒绝
  await assert.rejects(
    () => repository.save({
      appKey: 'ROW_APP',
      regionGroup: 'ROW',
      shopId: '',
      shopCipher: 'CIPHER-1',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: new Date(),
    }),
    /shopId is required/,
  );

  // 读取时校验 cipher 绑定
  // 密文只生成一次：每次调用都会产生新的随机 IV，三份密文无法互相解密。
  const bundle = encryptedBundle();
  const readPool = {
    async query() {
      return {
        rows: [{
          shop_cipher: 'CIPHER-1',
          token_blob: bundle.tokenBlob,
          token_iv: bundle.tokenIv,
          token_tag: bundle.tokenTag,
          expires_at: new Date('2026-12-01T00:00:00Z'),
          last_refresh_at: null,
          refresh_error: null,
          seller_type: 'LOCAL',
          region: 'MY',
          updated_at: new Date('2026-11-01T00:00:00Z'),
        }],
      };
    },
  };
  const readRepository = new TikTokTokenRepository({ pool: readPool, masterKey: MASTER_KEY });

  const loaded = await readRepository.load({
    appKey: 'ROW_APP', regionGroup: 'ROW', shopId: 'shop-1',
  });
  assert.strictEqual(loaded.shopCipher, 'CIPHER-1');
  assert.strictEqual(loaded.shopId, 'shop-1');
  assert.strictEqual(loaded.accessToken, 'access-1');
  assert.strictEqual(loaded.refreshToken, 'refresh-1');
  assert.strictEqual(loaded.sellerType, 'LOCAL');
  assert.strictEqual(loaded.region, 'MY');

  // cipher 不匹配时必须拒绝 —— 这是串店防护
  await assert.rejects(
    () => readRepository.load({
      appKey: 'ROW_APP', regionGroup: 'ROW', shopId: 'shop-1',
      expectedCipher: 'CIPHER-OTHER-SHOP',
    }),
    error => {
      assert.strictEqual(error.kind, 'SHOP_CIPHER_MISMATCH');
      return true;
    },
  );

  // 匹配的 cipher 正常通过
  const matched = await readRepository.load({
    appKey: 'ROW_APP', regionGroup: 'ROW', shopId: 'shop-1',
    expectedCipher: 'CIPHER-1',
  });
  assert.strictEqual(matched.shopCipher, 'CIPHER-1');

  // 列表返回 cipher 与 shop_id 的配对台账
  const listPool = {
    async query() {
      return {
        rows: [
          { shop_id: 'shop-1', shop_cipher: 'CIPHER-1', seller_type: 'LOCAL', region: 'MY', expires_at: null, updated_at: null },
          { shop_id: 'shop-2', shop_cipher: 'CIPHER-2', seller_type: 'CROSS_BORDER', region: 'SG', expires_at: null, updated_at: null },
        ],
      };
    },
  };
  const listRepository = new TikTokTokenRepository({ pool: listPool, masterKey: MASTER_KEY });
  const shops = await listRepository.listShops({ appKey: 'ROW_APP', regionGroup: 'ROW' });
  assert.strictEqual(shops.length, 2);
  assert.strictEqual(shops[0].shopId, 'shop-1');
  assert.strictEqual(shops[0].shopCipher, 'CIPHER-1');
  assert.strictEqual(shops[1].sellerType, 'CROSS_BORDER');

  // ---- Marketing API 凭据（独立分区）----

  const marketingPool = fakePool();
  const marketing = new TikTokMarketingTokenRepository({
    pool: marketingPool,
    masterKey: MASTER_KEY,
  });

  await marketing.save({
    appId: 'ADS_APP_ID',
    advertiserId: 'ADV-1',
    accessToken: 'ads-access',
    refreshToken: 'ads-refresh',
    expiresAt: new Date('2026-11-02T00:00:00Z'),
  });
  const marketingInsert = marketingPool.calls[0];
  assert.ok(marketingInsert.sql.includes('INSERT INTO tiktok_marketing_tokens'));
  assert.ok(!marketingInsert.sql.includes('tiktok_shop_tokens'), '不得写进 Shop API 的表');
  assert.ok(!marketingInsert.params.includes('ads-access'), 'access token 不得明文入库');

  // 扫描待刷新的 advertiser
  const expiringPool = {
    async query() {
      return {
        rows: [
          { advertiser_id: 'ADV-1', expires_at: new Date('2026-11-01T00:30:00Z') }, // 提前量内
          { advertiser_id: 'ADV-2', expires_at: new Date('2026-11-05T00:00:00Z') }, // 还早
        ],
      };
    },
  };
  const expiringRepository = new TikTokMarketingTokenRepository({
    pool: expiringPool,
    masterKey: MASTER_KEY,
  });
  const expiring = await expiringRepository.listExpiring({
    appId: 'ADS_APP_ID',
    now: Date.parse('2026-11-01T00:00:00Z'),
  });
  assert.strictEqual(expiring.length, 1);
  assert.strictEqual(expiring[0].advertiserId, 'ADV-1');

  // ---- 错误脱敏 ----

  // shop_cipher 不得出现在落库的错误信息里
  const sanitized = sanitizeTikTokError(
    new Error('request failed for shop_cipher=CIPHER-SECRET and sign=abc123'),
  );
  assert.ok(!sanitized.includes('CIPHER-SECRET'), 'cipher 不得出现在错误信息里');
  assert.ok(sanitized.includes('[REDACTED]'));

  // Bearer token 也要脱敏
  const bearer = sanitizeTikTokError(new Error('Authorization: Bearer TOKEN-SECRET failed'));
  assert.ok(!bearer.includes('TOKEN-SECRET'));

  // 空错误也要有兜底值
  assert.strictEqual(sanitizeTikTokError(null), 'TIKTOK_OPERATION_FAILED');

  console.log('tiktok token repository tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
