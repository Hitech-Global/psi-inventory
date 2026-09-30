'use strict';

class ShopeeOperationHistoryRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async saveImportedOperations({ shopId, campaignId, operations = [], queryable = this.pool }) {
    if (!operations.length) return { inserted: 0, skipped: 0 };
    const timezoneResult = await queryable.query(
      'SELECT timezone FROM shopee_shop_profiles WHERE shop_id=$1 LIMIT 1',
      [shopId],
    );
    const timezone = timezoneResult.rows[0]?.timezone || 'UTC';
    let inserted = 0;
    let skipped = 0;
    for (const row of operations) {
      const result = await queryable.query(
        `INSERT INTO shopee_operation_history
         (shop_id,campaign_id,item_id,operation_type,reason,before_json,after_json,effective_from,
          actor_type,operator_raw,platform_raw,event_type_raw,source_format,source_fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,($8::timestamp AT TIME ZONE $9),$10,$11,$12,$13,$14,$15)
         ON CONFLICT (source_fingerprint) WHERE source_fingerprint IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          shopId, campaignId, row.itemId ?? null, row.operationType, row.reason ?? null,
          JSON.stringify(row.before ?? null), JSON.stringify(row.after ?? null), row.effectiveFromLocal,
          timezone, row.actorType, row.operatorRaw ?? null, row.platformRaw ?? null,
          row.eventTypeRaw ?? null, row.sourceFormat, row.sourceFingerprint,
        ],
      );
      if (result.rows[0]) inserted += 1; else skipped += 1;
    }
    return { inserted, skipped };
  }
}

module.exports = { ShopeeOperationHistoryRepository };
