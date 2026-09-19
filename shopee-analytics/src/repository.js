'use strict';

class ShopeeAnalyticsRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
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
    await queryable.query(
      `INSERT INTO shopee_ad_campaign_daily
       (shop_id, campaign_id, event_date, impressions, clicks, expense,
        broad_gmv, broad_orders, broad_units, direct_gmv, direct_orders, direct_units, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now())
       ON CONFLICT (shop_id, campaign_id, event_date) DO UPDATE SET
        impressions=EXCLUDED.impressions,
        clicks=EXCLUDED.clicks,
        expense=EXCLUDED.expense,
        broad_gmv=EXCLUDED.broad_gmv,
        broad_orders=EXCLUDED.broad_orders,
        broad_units=EXCLUDED.broad_units,
        direct_gmv=EXCLUDED.direct_gmv,
        direct_orders=EXCLUDED.direct_orders,
        direct_units=EXCLUDED.direct_units,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        shopId, campaignId, eventDate,
        p.impressions || 0, p.clicks || 0, p.expense || 0,
        p.broadGmv || 0, p.broadOrders || 0, p.broadUnits || 0,
        p.directGmv || 0, p.directOrders || 0, p.directUnits || 0,
        JSON.stringify(rawJson || {}),
      ],
    );
  }

  async upsertItemDaily({ shopId, campaignId, itemId, eventDate, performance, rawJson = {}, queryable = this.pool }) {
    const p = performance || {};
    await queryable.query(
      `INSERT INTO shopee_ad_item_daily
       (shop_id, campaign_id, item_id, event_date, impressions, clicks, expense,
        broad_gmv, broad_orders, broad_units, direct_gmv, direct_orders, direct_units, raw_json, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())
       ON CONFLICT (shop_id, campaign_id, item_id, event_date) DO UPDATE SET
        impressions=EXCLUDED.impressions,
        clicks=EXCLUDED.clicks,
        expense=EXCLUDED.expense,
        broad_gmv=EXCLUDED.broad_gmv,
        broad_orders=EXCLUDED.broad_orders,
        broad_units=EXCLUDED.broad_units,
        direct_gmv=EXCLUDED.direct_gmv,
        direct_orders=EXCLUDED.direct_orders,
        direct_units=EXCLUDED.direct_units,
        raw_json=EXCLUDED.raw_json,
        synced_at=now()`,
      [
        shopId, campaignId, itemId, eventDate,
        p.impressions || 0, p.clicks || 0, p.expense || 0,
        p.broadGmv || 0, p.broadOrders || 0, p.broadUnits || 0,
        p.directGmv || 0, p.directOrders || 0, p.directUnits || 0,
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

  async saveGmsDay({ shopId, campaignId, eventDate, campaign, items, membershipItemIds = null, rawSnapshots = [] }) {
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

      // GMS item-performance only returns items with performance. It must never be
      // treated as a complete campaign-membership snapshot when historical membership
      // is unavailable.
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
    });
  }

  async loadCampaignDaily({ shopId, campaignId, startDate, endDate }) {
    const result = await this.pool.query(
      `SELECT * FROM shopee_ad_campaign_daily
       WHERE shop_id=$1 AND campaign_id=$2 AND event_date BETWEEN $3 AND $4
       ORDER BY event_date ASC`,
      [shopId, campaignId, startDate, endDate],
    );
    return result.rows;
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

module.exports = { ShopeeAnalyticsRepository };
