'use strict';

const { persistPilotGmsDay } = require('./unified-promotion-writers');
const { normalizeCampaignMetric } = require('./sync-product-ads');

function hydrateCampaignDailySourceMetrics(row) {
  if (!row) return row;
  const metric = row.raw_json && row.raw_json.metric && typeof row.raw_json.metric === 'object'
    ? row.raw_json.metric
    : null;
  if (!metric) return row;

  // raw_json is the immutable Shopee audit source. Prefer its normalized source
  // metrics over legacy persisted derived values, so pre-migration rows become
  // accurate without another Shopee API request or a destructive backfill.
  const source = normalizeCampaignMetric(metric);
  return {
    ...row,
    ctr: source.ctr ?? (row.ctr == null ? null : Number(row.ctr)),
    broad_cvr: source.broadCvr ?? (row.broad_cvr == null ? null : Number(row.broad_cvr)),
    direct_cvr: source.directCvr ?? (row.direct_cvr == null ? null : Number(row.direct_cvr)),
    broad_roas: source.broadRoas ?? (row.broad_roas == null ? null : Number(row.broad_roas)),
    direct_roas: source.directRoas ?? (row.direct_roas == null ? null : Number(row.direct_roas)),
    add_to_cart: source.addToCart ?? (row.add_to_cart == null ? null : Number(row.add_to_cart)),
    add_to_cart_rate: source.addToCartRate ?? (row.add_to_cart_rate == null ? null : Number(row.add_to_cart_rate)),
    cost_per_conversion: source.costPerConversion ?? (row.cost_per_conversion == null ? null : Number(row.cost_per_conversion)),
    cost_per_direct_conversion: source.costPerDirectConversion ?? (row.cost_per_direct_conversion == null
      ? null
      : Number(row.cost_per_direct_conversion)),
    broad_acos: source.broadAcos ?? (row.broad_acos == null ? null : Number(row.broad_acos)),
    direct_acos: source.directAcos ?? (row.direct_acos == null ? null : Number(row.direct_acos)),
  };
}

class ShopeeAnalyticsRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
    this._campaignSourceColumnsAvailable = null;
  }

  async campaignSourceColumnsAvailable(queryable = this.pool) {
    if (this._campaignSourceColumnsAvailable !== null) return this._campaignSourceColumnsAvailable;
    const result = await queryable.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='shopee_ad_campaign_daily'
           AND column_name='ctr'
       ) AS available`,
    );
    this._campaignSourceColumnsAvailable = Boolean(result.rows[0] && result.rows[0].available);
    return this._campaignSourceColumnsAvailable;
  }

  async withTransaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  async insertRawSnapshot({
    appRole,
    endpointKey,
    shopId,
    eventDateFrom = null,
    eventDateTo = null,
    requestFingerprint,
    requestJson = {},
    responseJson,
    queryable = this.pool,
  }) {
    await queryable.query(
      `INSERT INTO shopee_raw_api_snapshots
       (app_role, endpoint_key, shop_id, event_date_from, event_date_to, request_fingerprint, request_json, response_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
      [
        appRole,
        endpointKey,
        shopId,
        eventDateFrom,
        eventDateTo,
        requestFingerprint,
        JSON.stringify(requestJson || {}),
        JSON.stringify(responseJson || {}),
      ],
    );
  }

  async upsertCampaign({
    shopId,
    campaignId,
    adType = null,
    campaignTypeRaw = null,
    campaignTypeNormalized = null,
    region = null,
    queryable = this.pool,
  }) {
    await queryable.query(
      `INSERT INTO shopee_ad_campaigns
       (shop_id, campaign_id, ad_type, campaign_type_raw, campaign_type_normalized, region)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (shop_id, campaign_id) DO UPDATE SET
         ad_type = COALESCE(EXCLUDED.ad_type, shopee_ad_campaigns.ad_type),
         campaign_type_raw = COALESCE(EXCLUDED.campaign_type_raw, shopee_ad_campaigns.campaign_type_raw),
         campaign_type_normalized = COALESCE(EXCLUDED.campaign_type_normalized, shopee_ad_campaigns.campaign_type_normalized),
         region = COALESCE(EXCLUDED.region, shopee_ad_campaigns.region),
         last_seen_at = now()`,
      [shopId, campaignId, adType, campaignTypeRaw, campaignTypeNormalized, region],
    );
  }

  async upsertCampaignDaily({ shopId, campaignId, eventDate, performance, rawJson = {}, queryable = this.pool }) {
    const p = performance || {};
    const hasSourceColumns = await this.campaignSourceColumnsAvailable(queryable);

    if (!hasSourceColumns) {
      await queryable.query(
        `INSERT INTO shopee_ad_campaign_daily
         (shop_id, campaign_id, event_date, impressions, clicks, expense,
          broad_gmv, broad_orders, broad_units, direct_gmv, direct_roas, direct_orders, direct_units, raw_json, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())
         ON CONFLICT (shop_id, campaign_id, event_date) DO UPDATE SET
          impressions=EXCLUDED.impressions,
          clicks=EXCLUDED.clicks,
          expense=EXCLUDED.expense,
          broad_gmv=EXCLUDED.broad_gmv,
          broad_orders=EXCLUDED.broad_orders,
          broad_units=EXCLUDED.broad_units,
          direct_gmv=EXCLUDED.direct_gmv,
          direct_roas=EXCLUDED.direct_roas,
          direct_orders=EXCLUDED.direct_orders,
          direct_units=EXCLUDED.direct_units,
          raw_json=EXCLUDED.raw_json,
          synced_at=now()`,
        [
          shopId, campaignId, eventDate,
          p.impressions || 0, p.clicks || 0, p.expense || 0,
          p.broadGmv || 0, p.broadOrders || 0, p.broadUnits || 0,
          p.directGmv ?? null, p.directRoas ?? null, p.directOrders || 0, p.directUnits || 0,
          JSON.stringify(rawJson || {}),
        ],
      );
      return;
    }

    await queryable.query(
      `INSERT INTO shopee_ad_campaign_daily
       (shop_id, campaign_id, event_date, impressions, clicks, expense,
        broad_gmv, broad_orders, broad_units, direct_gmv, direct_roas, direct_orders, direct_units,
        ctr, broad_cvr, direct_cvr, broad_roas, add_to_cart, add_to_cart_rate,
        cost_per_conversion, cost_per_direct_conversion, broad_acos, direct_acos,
        raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,now())
       ON CONFLICT (shop_id, campaign_id, event_date) DO UPDATE SET
        impressions=EXCLUDED.impressions,
        clicks=EXCLUDED.clicks,
        expense=EXCLUDED.expense,
        broad_gmv=EXCLUDED.broad_gmv,
        broad_orders=EXCLUDED.broad_orders,
        broad_units=EXCLUDED.broad_units,
        direct_gmv=EXCLUDED.direct_gmv,
        direct_roas=EXCLUDED.direct_roas,
        direct_orders=EXCLUDED.direct_orders,
        direct_units=EXCLUDED.direct_units,
        ctr=EXCLUDED.ctr,
        broad_cvr=EXCLUDED.broad_cvr,
        direct_cvr=EXCLUDED.direct_cvr,
        broad_roas=EXCLUDED.broad_roas,
        add_to_cart=EXCLUDED.add_to_cart,
        add_to_cart_rate=EXCLUDED.add_to_cart_rate,
        cost_per_conversion=EXCLUDED.cost_per_conversion,
        cost_per_direct_conversion=EXCLUDED.cost_per_direct_conversion,
        broad_acos=EXCLUDED.broad_acos,
        direct_acos=EXCLUDED.direct_acos,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        shopId, campaignId, eventDate,
        p.impressions || 0, p.clicks || 0, p.expense || 0,
        p.broadGmv || 0, p.broadOrders || 0, p.broadUnits || 0,
        p.directGmv ?? null, p.directRoas ?? null, p.directOrders || 0, p.directUnits || 0,
        p.ctr ?? null, p.broadCvr ?? null, p.directCvr ?? null, p.broadRoas ?? null,
        p.addToCart ?? null, p.addToCartRate ?? null,
        p.costPerConversion ?? null, p.costPerDirectConversion ?? null,
        p.broadAcos ?? null, p.directAcos ?? null,
        JSON.stringify(rawJson || {}),
      ],
    );
  }

  async upsertItemDaily({ shopId, campaignId, itemId, eventDate, performance, rawJson = {}, queryable = this.pool }) {
    const p = performance || {};
    await queryable.query(
      `INSERT INTO shopee_ad_item_daily
       (shop_id, campaign_id, item_id, event_date, impressions, clicks, expense,
        broad_gmv, broad_orders, broad_units, direct_gmv, direct_roas, direct_orders, direct_units, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,now())
       ON CONFLICT (shop_id, campaign_id, item_id, event_date) DO UPDATE SET
        impressions=EXCLUDED.impressions,
        clicks=EXCLUDED.clicks,
        expense=EXCLUDED.expense,
        broad_gmv=EXCLUDED.broad_gmv,
        broad_orders=EXCLUDED.broad_orders,
        broad_units=EXCLUDED.broad_units,
        direct_gmv=EXCLUDED.direct_gmv,
        direct_roas=EXCLUDED.direct_roas,
        direct_orders=EXCLUDED.direct_orders,
        direct_units=EXCLUDED.direct_units,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        shopId, campaignId, itemId, eventDate,
        p.impressions || 0, p.clicks || 0, p.expense || 0,
        p.broadGmv || 0, p.broadOrders || 0, p.broadUnits || 0,
        p.directGmv ?? null, p.directRoas ?? null, p.directOrders || 0, p.directUnits || 0,
        JSON.stringify(rawJson || {}),
      ],
    );
  }

  async replaceMembershipDay({ shopId, campaignId, eventDate, itemIds, queryable = this.pool }) {
    await queryable.query(
      'DELETE FROM shopee_ad_campaign_membership_daily WHERE shop_id=$1 AND campaign_id=$2 AND event_date=$3',
      [shopId, campaignId, eventDate],
    );
    for (const itemId of itemIds || []) {
      await queryable.query(
        `INSERT INTO shopee_ad_campaign_membership_daily
         (shop_id, campaign_id, event_date, item_id, membership_state)
         VALUES ($1,$2,$3,$4,'ACTIVE')
         ON CONFLICT DO NOTHING`,
        [shopId, campaignId, eventDate, itemId],
      );
    }
  }

  async saveGmsDay({ shopId, campaignId, eventDate, campaign, items, membershipItemIds = null, rawSnapshots = [], adPromotionRepository = null, env = process.env }) {
    return this.withTransaction(async client => {
      await this.upsertCampaign({ shopId, campaignId, campaignTypeRaw: 'GMS', campaignTypeNormalized: 'GMS', queryable: client });
      await this.upsertCampaignDaily({
        shopId,
        campaignId,
        eventDate,
        performance: campaign,
        rawJson: campaign.raw || {},
        queryable: client,
      });

      if (Array.isArray(membershipItemIds) && membershipItemIds.length) {
        await this.replaceMembershipDay({
          shopId,
          campaignId,
          eventDate,
          itemIds: membershipItemIds,
          queryable: client,
        });
      }

      for (const item of items || []) {
        if (item.itemId === null || item.itemId === undefined) continue;
        await this.upsertItemDaily({
          shopId,
          campaignId,
          itemId: item.itemId,
          eventDate,
          performance: item,
          rawJson: item.raw || {},
          queryable: client,
        });
      }

      for (const snapshot of rawSnapshots) {
        await this.insertRawSnapshot({ ...snapshot, shopId, queryable: client });
      }

      if (adPromotionRepository) {
        await persistPilotGmsDay({
          repository: {
            saveWithItems: (row, promotionItems) => adPromotionRepository.saveWithItems(row, promotionItems, { queryable: client }),
          },
          shopId,
          campaignId,
          eventDate,
          performance: campaign,
          items,
          raw: campaign.raw || {},
          env,
        });
      }
    });
  }

  async loadCampaignDaily({ shopId, campaignId, startDate, endDate }) {
    const result = await this.pool.query(
      `SELECT * FROM shopee_ad_campaign_daily
       WHERE shop_id=$1 AND campaign_id=$2 AND event_date BETWEEN $3 AND $4
       ORDER BY event_date ASC`,
      [shopId, campaignId, startDate, endDate],
    );
    return result.rows.map(hydrateCampaignDailySourceMetrics);
  }

  async loadItemDaily({ shopId, campaignId, startDate, endDate }) {
    const result = await this.pool.query(
      `SELECT * FROM shopee_ad_item_daily
       WHERE shop_id=$1 AND campaign_id=$2 AND event_date BETWEEN $3 AND $4
       ORDER BY item_id, event_date ASC`,
      [shopId, campaignId, startDate, endDate],
    );
    return result.rows;
  }

  async loadMembershipItemIds({ shopId, campaignId, eventDate }) {
    const result = await this.pool.query(
      `SELECT item_id FROM shopee_ad_campaign_membership_daily
       WHERE shop_id=$1 AND campaign_id=$2 AND event_date=$3
       ORDER BY item_id`,
      [shopId, campaignId, eventDate],
    );
    return result.rows.map(row => Number(row.item_id));
  }

  async getSyncState({ appRole, endpointKey, shopId }) {
    const result = await this.pool.query(
      `SELECT cursor_json,last_success_at,last_error
       FROM shopee_sync_state
       WHERE app_role=$1 AND endpoint_key=$2 AND shop_id=$3`,
      [appRole, endpointKey, shopId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      cursor: row.cursor_json || {},
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
    };
  }

  async markSyncSuccess({ appRole, endpointKey, shopId, cursor = {} }) {
    await this.pool.query(
      `INSERT INTO shopee_sync_state (app_role, endpoint_key, shop_id, cursor_json, last_success_at, last_error)
       VALUES ($1,$2,$3,$4::jsonb,now(),NULL)
       ON CONFLICT (app_role, endpoint_key, shop_id) DO UPDATE SET
         cursor_json=EXCLUDED.cursor_json,
         last_success_at=now(),
         last_error=NULL`,
      [appRole, endpointKey, shopId, JSON.stringify(cursor || {})],
    );
  }

  async markSyncFailure({ appRole, endpointKey, shopId, error }) {
    await this.pool.query(
      `INSERT INTO shopee_sync_state (app_role, endpoint_key, shop_id, cursor_json, last_error)
       VALUES ($1,$2,$3,'{}'::jsonb,$4)
       ON CONFLICT (app_role, endpoint_key, shop_id) DO UPDATE SET last_error=EXCLUDED.last_error`,
      [appRole, endpointKey, shopId, String(error && error.message || error).slice(0, 2000)],
    );
  }
}

module.exports = { hydrateCampaignDailySourceMetrics, ShopeeAnalyticsRepository };
