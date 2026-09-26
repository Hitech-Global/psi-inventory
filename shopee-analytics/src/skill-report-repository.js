'use strict';

class SkillReportRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createPending({ analysisPackage, skillName, skillVersion }) {
    const p = analysisPackage;
    const result = await this.pool.query(
      `INSERT INTO shopee_skill_reports
       (shop_id,campaign_id,period_start,period_end,data_cutoff,trigger_type,trigger_reason,
        skill_name,skill_version,package_schema_version,input_snapshot_json,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'PENDING')
       RETURNING id, generated_at`,
      [
        p.shop.shopId, p.campaign.campaignId, p.period.startDate, p.period.endDate,
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

  async latest({ shopId, campaignId }) {
    const result = await this.pool.query(
      `SELECT id,shop_id,campaign_id,period_start,period_end,data_cutoff,trigger_type,
              trigger_reason,skill_name,skill_version,package_schema_version,
              report_json,status,error_text,generated_at
       FROM shopee_skill_reports
       WHERE shop_id=$1 AND campaign_id=$2
       ORDER BY generated_at DESC,id DESC LIMIT 1`,
      [shopId, campaignId],
    );
    return result.rows[0] || null;
  }
}

module.exports = { SkillReportRepository };
