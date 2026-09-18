'use strict';

class ShopeeCampaignRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new Error('pg Pool with query/connect is required');
    }
    this.pool = pool;
  }

  async saveCampaignSettingsSnapshot({
    shopId,
    region = null,
    observedAt = new Date(),
    eventDate,
    settings,
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const setting of settings || []) {
        await client.query(
          `INSERT INTO shopee_ad_campaigns
           (shop_id, campaign_id, ad_type, campaign_type_raw, region, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,now())
           ON CONFLICT (shop_id, campaign_id) DO UPDATE SET
            ad_type=COALESCE(EXCLUDED.ad_type,shopee_ad_campaigns.ad_type),
            region=COALESCE(EXCLUDED.region,shopee_ad_campaigns.region),
            last_seen_at=now()`,
          [shopId, setting.campaignId, setting.adType, setting.biddingMethod, region],
        );
        await client.query(
          `INSERT INTO shopee_ad_campaign_setting_history
           (shop_id, campaign_id, observed_at, status, bidding_method, campaign_budget, target_roas, raw_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
           ON CONFLICT (shop_id, campaign_id, observed_at) DO NOTHING`,
          [
            shopId, setting.campaignId, observedAt, setting.campaignStatus,
            setting.biddingMethod, setting.campaignBudget, setting.targetRoas,
            JSON.stringify(setting.raw || {}),
          ],
        );

        if (eventDate) {
          await client.query(
            'DELETE FROM shopee_ad_campaign_membership_daily WHERE shop_id=$1 AND campaign_id=$2 AND event_date=$3',
            [shopId, setting.campaignId, eventDate],
          );
          for (const itemId of setting.itemIds || []) {
            await client.query(
              `INSERT INTO shopee_ad_campaign_membership_daily
               (shop_id, campaign_id, event_date, item_id, membership_state)
               VALUES ($1,$2,$3,$4,'ACTIVE') ON CONFLICT DO NOTHING`,
              [shopId, setting.campaignId, eventDate, itemId],
            );
          }
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { ShopeeCampaignRepository };
