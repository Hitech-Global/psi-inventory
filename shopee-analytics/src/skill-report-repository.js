'use strict';

class SkillReportRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createPending({ analysisPackage, skillName, skillVersion }) {
    const p = analysisPackage;
    const promotionKey = p.campaign && p.campaign.promotionKey
      ? String(p.campaign.promotionKey)
      : null;
    const campaignId = promotionKey ? null : Number(p.campaign && p.campaign.campaignId);
    if (!promotionKey && (!Number.isSafeInteger(campaignId) || campaignId <= 0)) {
      throw new Error('Skill report requires a numeric campaignId or promotionKey');
    }
    const result = await this.pool.query(
      `INSERT INTO shopee_skill_reports
       (shop_id,campaign_id,promotion_key,period_start,period_end,data_cutoff,trigger_type,trigger_reason,
        skill_name,skill_version,package_schema_version,input_snapshot_json,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'PENDING')
       RETURNING id, generated_at`,
      [
        p.shop.shopId, campaignId, promotionKey, p.period.startDate, p.period.endDate,
        p.period.dataCutoff, p.trigger.type, p.trigger.reason || null,
        skillName, skillVersion, p.schemaVersion, JSON.stringify(p),
      ],
    );
    return result.rows[0];
  }

  async complete({ reportId, report }) {
    const result = await this.pool.query(
      `UPDATE shopee_skill_reports
       SET report_json=$2::jsonb,status='COMPLETED',error_text=NULL
       WHERE id=$1 RETURNING *`,
      [reportId, JSON.stringify(report)],
    );
    return result.rows[0] || null;
  }

  async fail({ reportId, error }) {
    await this.pool.query(
      `UPDATE shopee_skill_reports
       SET status='FAILED',error_text=$2
       WHERE id=$1`,
      [reportId, String(error && error.message || error).slice(0, 4000)],
    );
  }

  async latest({
    shopId,
    campaignId = null,
    promotionKey = null,
    completedOnly = false,
    periodStart = null,
    periodEnd = null,
  }) {
    const numericCampaignId = campaignId == null ? null : Number(campaignId);
    const normalizedPromotionKey = promotionKey == null ? null : String(promotionKey);
    if (numericCampaignId == null && !normalizedPromotionKey) {
      throw new Error('Skill report lookup requires campaignId or promotionKey');
    }
    if (numericCampaignId != null && (!Number.isSafeInteger(numericCampaignId) || numericCampaignId <= 0)) {
      throw new Error('campaignId must be a positive integer');
    }
    const result = await this.pool.query(
      `SELECT id,shop_id,campaign_id,promotion_key,period_start,period_end,data_cutoff,trigger_type,
              trigger_reason,skill_name,skill_version,package_schema_version,
              report_json,status,error_text,generated_at,
              input_snapshot_json->'deterministicMetrics'->'maturity' AS maturity_json,
              input_snapshot_json->'deterministicMetrics'->'timeContext' AS time_context_json,
              input_snapshot_json->'deterministicMetrics'->'itemCurrentWindow' AS item_current_window_json,
              input_snapshot_json->'deterministicMetrics'->'campaign' AS campaign_metrics_json,
              input_snapshot_json->'dataQuality' AS data_quality_json,
              input_snapshot_json->'campaign' AS campaign_context_json
       FROM shopee_skill_reports
       WHERE shop_id=$1
         AND (($2::bigint IS NOT NULL AND campaign_id=$2)
           OR ($3::text IS NOT NULL AND promotion_key=$3))
         AND ($4::boolean=false OR status='COMPLETED')
         AND ($5::date IS NULL OR period_start=$5::date)
         AND ($6::date IS NULL OR period_end=$6::date)
       ORDER BY generated_at DESC,id DESC LIMIT 1`,
      [
        shopId,
        numericCampaignId,
        normalizedPromotionKey,
        completedOnly === true,
        periodStart,
        periodEnd,
      ],
    );
    return result.rows[0] || null;
  }
}

module.exports = { SkillReportRepository };
