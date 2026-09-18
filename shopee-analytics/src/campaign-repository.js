'use strict';

function comparableSetting(row) {
  if (!row) return null;
  return {
    status: row.status ?? row.campaign_status ?? row.campaignStatus ?? null,
    biddingMethod: row.bidding_method ?? row.biddingMethod ?? null,
    campaignBudget: row.campaign_budget === null || row.campaign_budget === undefined
      ? (row.campaignBudget ?? null)
      : Number(row.campaign_budget),
    targetRoas: row.target_roas === null || row.target_roas === undefined
      ? (row.targetRoas ?? null)
      : Number(row.target_roas),
  };
}

function changedSettingFields(before, after) {
  if (!before || !after) return [];
  const keys = ['status', 'biddingMethod', 'campaignBudget', 'targetRoas'];
  return keys.filter(key => {
    const a = before[key] === undefined ? null : before[key];
    const b = after[key] === undefined ? null : after[key];
    return String(a) !== String(b);
  });
}

function setDiff(beforeIds, afterIds) {
  const before = new Set((beforeIds || []).map(Number).filter(Number.isSafeInteger));
  const after = new Set((afterIds || []).map(Number).filter(Number.isSafeInteger));
  return {
    added: Array.from(after).filter(id => !before.has(id)).sort((a, b) => a - b),
    removed: Array.from(before).filter(id => !after.has(id)).sort((a, b) => a - b),
  };
}

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
        const previousSettingResult = await client.query(
          `SELECT status,bidding_method,campaign_budget,target_roas
           FROM shopee_ad_campaign_setting_history
           WHERE shop_id=$1 AND campaign_id=$2
           ORDER BY observed_at DESC
           LIMIT 1`,
          [shopId, setting.campaignId],
        );
        const previousSetting = comparableSetting(previousSettingResult.rows[0]);
        const nextSetting = comparableSetting(setting);
        const changedFields = changedSettingFields(previousSetting, nextSetting);

        let previousMembership = [];
        if (eventDate) {
          const previousMembershipResult = await client.query(
            `WITH latest AS (
               SELECT MAX(event_date) AS event_date
               FROM shopee_ad_campaign_membership_daily
               WHERE shop_id=$1 AND campaign_id=$2 AND event_date <= $3
             )
             SELECT item_id
             FROM shopee_ad_campaign_membership_daily m
             JOIN latest l ON l.event_date=m.event_date
             WHERE m.shop_id=$1 AND m.campaign_id=$2
             ORDER BY item_id`,
            [shopId, setting.campaignId, eventDate],
          );
          previousMembership = previousMembershipResult.rows.map(row => Number(row.item_id));
        }

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

        if (previousSetting && changedFields.length) {
          const memberIds = Array.from(new Set((setting.itemIds || []).map(Number).filter(Number.isSafeInteger)));
          const targetItemIds = memberIds.length ? memberIds : [null];
          for (const itemId of targetItemIds) {
            await client.query(
              `INSERT INTO shopee_operation_history
               (shop_id,campaign_id,item_id,operation_type,reason,before_json,after_json,effective_from)
               VALUES ($1,$2,$3,'CAMPAIGN_SETTING_CHANGE',$4,$5::jsonb,$6::jsonb,$7)`,
              [
                shopId,
                setting.campaignId,
                itemId,
                `Campaign settings changed: ${changedFields.join(', ')}`,
                JSON.stringify(previousSetting),
                JSON.stringify(nextSetting),
                observedAt,
              ],
            );
          }
        }

        if (eventDate) {
          const currentMembership = Array.from(new Set(
            (setting.itemIds || []).map(Number).filter(Number.isSafeInteger),
          ));
          const membershipDiff = setDiff(previousMembership, currentMembership);

          await client.query(
            'DELETE FROM shopee_ad_campaign_membership_daily WHERE shop_id=$1 AND campaign_id=$2 AND event_date=$3',
            [shopId, setting.campaignId, eventDate],
          );
          for (const itemId of currentMembership) {
            await client.query(
              `INSERT INTO shopee_ad_campaign_membership_daily
               (shop_id, campaign_id, event_date, item_id, membership_state)
               VALUES ($1,$2,$3,$4,'ACTIVE') ON CONFLICT DO NOTHING`,
              [shopId, setting.campaignId, eventDate, itemId],
            );
          }

          // Do not create artificial "added" operations on the very first observed
          // membership snapshot. Only record a diff when we have a previous snapshot.
          if (previousMembership.length) {
            for (const itemId of membershipDiff.added) {
              await client.query(
                `INSERT INTO shopee_operation_history
                 (shop_id,campaign_id,item_id,operation_type,reason,before_json,after_json,effective_from)
                 VALUES ($1,$2,$3,'SKU_ADDED_TO_CAMPAIGN','SKU added to campaign',$4::jsonb,$5::jsonb,$6)`,
                [
                  shopId, setting.campaignId, itemId,
                  JSON.stringify({ membership: false }),
                  JSON.stringify({ membership: true }),
                  observedAt,
                ],
              );
            }
            for (const itemId of membershipDiff.removed) {
              await client.query(
                `INSERT INTO shopee_operation_history
                 (shop_id,campaign_id,item_id,operation_type,reason,before_json,after_json,effective_from)
                 VALUES ($1,$2,$3,'SKU_REMOVED_FROM_CAMPAIGN','SKU removed from campaign',$4::jsonb,$5::jsonb,$6)`,
                [
                  shopId, setting.campaignId, itemId,
                  JSON.stringify({ membership: true }),
                  JSON.stringify({ membership: false }),
                  observedAt,
                ],
              );
            }
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

module.exports = {
  comparableSetting,
  changedSettingFields,
  setDiff,
  ShopeeCampaignRepository,
};
