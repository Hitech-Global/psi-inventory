'use strict';

class ShopeeAdPromotionRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  static key({ dataSource, campaignId, campaignName, groupStartDate = null }) {
    if (campaignId) return `${dataSource}:campaign:${campaignId}`;
    const name = String(campaignName || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!name) throw new Error('campaignName is required when campaignId is unavailable');
    return `${dataSource}:group:${name}:${groupStartDate || 'unknown'}`;
  }

  async withTransaction(fn) {
    if (typeof this.pool.connect !== 'function') return fn(this.pool);
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
    catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
    finally { client.release(); }
  }

  async upsertDaily(row, queryable = this.pool) {
    const promotionKey = row.promotionKey || ShopeeAdPromotionRepository.key(row);
    const periodStart = row.periodStart || row.eventDate;
    const periodEnd = row.periodEnd || periodStart;
    const granularity = row.granularity || (periodStart === periodEnd ? 'DAY' : 'RANGE');
    await queryable.query(
      `INSERT INTO shopee_ad_promotion_daily
       (shop_id,promotion_key,period_start,period_end,granularity,event_date,promotion_type,data_source,campaign_id,campaign_name,source_ad_type,campaign_status,campaign_budget,target_roas,estimated_roas,impressions,clicks,expense,orders,gmv,source_roas,direct_gmv,direct_roas,ctr,cvr,add_to_cart,item_count,data_quality_status,quality_flags,remark,raw_json,synced_at)
       VALUES ($1,$2,$3,$4,$5,$3,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb,$29,$30::jsonb,now())
       ON CONFLICT (shop_id,promotion_key,period_start,period_end) DO UPDATE SET
          granularity=EXCLUDED.granularity,event_date=EXCLUDED.event_date,promotion_type=EXCLUDED.promotion_type,data_source=EXCLUDED.data_source,campaign_id=EXCLUDED.campaign_id,campaign_name=EXCLUDED.campaign_name,source_ad_type=EXCLUDED.source_ad_type,campaign_status=EXCLUDED.campaign_status,campaign_budget=EXCLUDED.campaign_budget,target_roas=EXCLUDED.target_roas,estimated_roas=EXCLUDED.estimated_roas,impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,expense=EXCLUDED.expense,orders=EXCLUDED.orders,gmv=EXCLUDED.gmv,source_roas=EXCLUDED.source_roas,direct_gmv=EXCLUDED.direct_gmv,direct_roas=EXCLUDED.direct_roas,ctr=EXCLUDED.ctr,cvr=EXCLUDED.cvr,add_to_cart=EXCLUDED.add_to_cart,item_count=EXCLUDED.item_count,data_quality_status=EXCLUDED.data_quality_status,quality_flags=EXCLUDED.quality_flags,remark=EXCLUDED.remark,raw_json=EXCLUDED.raw_json,synced_at=now()`,
       [row.shopId,promotionKey,periodStart,periodEnd,granularity,row.promotionType,row.dataSource,row.campaignId ?? null,row.campaignName ?? null,row.sourceAdType ?? null,row.campaignStatus ?? null,row.campaignBudget ?? null,row.targetRoas ?? null,row.estimatedRoas ?? null,row.impressions ?? null,row.clicks ?? null,row.expense ?? null,row.orders ?? null,row.gmv ?? null,row.sourceRoas ?? null,row.directGmv ?? null,row.directRoas ?? null,row.ctr ?? null,row.cvr ?? null,row.addToCart ?? null,row.itemCount ?? null,row.dataQualityStatus,JSON.stringify(row.qualityFlags || []),row.remark ?? null,JSON.stringify(row.raw || {})],
    );
    return { promotionKey, periodStart, periodEnd };
  }

  async replaceItems({ shopId, promotionKey, periodStart, periodEnd = periodStart, items = [], queryable = this.pool }) {
    await queryable.query(
      'DELETE FROM shopee_ad_promotion_item_daily WHERE shop_id=$1 AND promotion_key=$2 AND period_start=$3 AND period_end=$4',
      [shopId, promotionKey, periodStart, periodEnd],
    );
    if (!items.length) return;

    const payload = items.map(item => ({
      item_id: item.itemId,
      item_sku: item.itemSku ?? null,
      product_name: item.productName ?? null,
      impressions: item.impressions ?? null,
      clicks: item.clicks ?? null,
      expense: item.expense ?? null,
      orders: item.orders ?? null,
      gmv: item.gmv ?? null,
      source_roas: item.sourceRoas ?? null,
      direct_gmv: item.directGmv ?? null,
      direct_roas: item.directRoas ?? null,
      ctr: item.ctr ?? null,
      cvr: item.cvr ?? null,
      add_to_cart: item.addToCart ?? null,
      weekly_sales: item.weeklySales ?? null,
      data_quality_status: item.dataQualityStatus || 'PARTIAL',
      quality_flags: item.qualityFlags || [],
      remark: item.remark ?? null,
      raw_json: item.raw || {},
    }));

    // One set-based insert per group keeps import DB pressure bounded.  The old
    // implementation executed one PostgreSQL round-trip per child item, which
    // scales poorly for large multi-group Seller Centre exports.
    await queryable.query(
      `INSERT INTO shopee_ad_promotion_item_daily
        (shop_id,promotion_key,period_start,period_end,event_date,item_id,item_sku,product_name,impressions,clicks,expense,orders,gmv,source_roas,direct_gmv,direct_roas,ctr,cvr,add_to_cart,weekly_sales,data_quality_status,quality_flags,remark,raw_json,synced_at)
       SELECT $1,$2,$3::date,$4::date,$3::date,
              x.item_id,x.item_sku,x.product_name,x.impressions,x.clicks,x.expense,x.orders,x.gmv,x.source_roas,x.direct_gmv,x.direct_roas,x.ctr,x.cvr,x.add_to_cart,x.weekly_sales,x.data_quality_status,x.quality_flags,x.remark,x.raw_json,now()
       FROM jsonb_to_recordset($5::jsonb) AS x(
         item_id bigint,
         item_sku text,
         product_name text,
         impressions bigint,
         clicks bigint,
         expense numeric,
         orders bigint,
         gmv numeric,
         source_roas numeric,
         direct_gmv numeric,
         direct_roas numeric,
         ctr numeric,
         cvr numeric,
         add_to_cart bigint,
         weekly_sales numeric,
         data_quality_status text,
         quality_flags jsonb,
         remark text,
         raw_json jsonb
       )
       ON CONFLICT (shop_id,promotion_key,period_start,period_end,item_id) DO UPDATE SET
         item_sku=EXCLUDED.item_sku,
         product_name=EXCLUDED.product_name,
         impressions=EXCLUDED.impressions,
         clicks=EXCLUDED.clicks,
         expense=EXCLUDED.expense,
         orders=EXCLUDED.orders,
         gmv=EXCLUDED.gmv,
         source_roas=EXCLUDED.source_roas,
         direct_gmv=EXCLUDED.direct_gmv,
         direct_roas=EXCLUDED.direct_roas,
         ctr=EXCLUDED.ctr,
         cvr=EXCLUDED.cvr,
         add_to_cart=EXCLUDED.add_to_cart,
         weekly_sales=EXCLUDED.weekly_sales,
         data_quality_status=EXCLUDED.data_quality_status,
         quality_flags=EXCLUDED.quality_flags,
         remark=EXCLUDED.remark,
         raw_json=EXCLUDED.raw_json,
         synced_at=now()`,
      [shopId, promotionKey, periodStart, periodEnd, JSON.stringify(payload)],
    );
  }

  async saveWithItems(row, items = [], { queryable = null } = {}) {
    if (queryable) {
      const saved = await this.upsertDaily(row, queryable);
      await this.replaceItems({ shopId: row.shopId, promotionKey: saved.promotionKey, periodStart: saved.periodStart, periodEnd: saved.periodEnd, items, queryable });
      return saved;
    }
    return this.withTransaction(async queryable => {
      const saved = await this.upsertDaily(row, queryable);
      await this.replaceItems({ shopId: row.shopId, promotionKey: saved.promotionKey, periodStart: saved.periodStart, periodEnd: saved.periodEnd, items, queryable });
      return saved;
    });
  }

  async list({ shopId, startDate, endDate, promotionType = null, dataSource = null, campaignStatus = null, productId = null }) {
    const result = await this.pool.query(
      `SELECT d.*, CASE WHEN COUNT(i.item_id) FILTER (WHERE i.item_id IS NOT NULL) > 0 THEN jsonb_agg(jsonb_build_object('itemId',i.item_id,'productName',i.product_name) ORDER BY i.item_id) FILTER (WHERE i.item_id IS NOT NULL) ELSE '[]'::jsonb END AS items
       FROM shopee_ad_promotion_daily d
       LEFT JOIN shopee_ad_promotion_item_daily i ON i.shop_id=d.shop_id AND i.promotion_key=d.promotion_key AND i.period_start=d.period_start AND i.period_end=d.period_end
       WHERE d.shop_id=$1 AND d.period_start >= $2 AND d.period_end <= $3 AND ($4::text IS NULL OR d.promotion_type=$4) AND ($5::text IS NULL OR d.data_source=$5) AND ($6::text IS NULL OR d.campaign_status=$6) AND ($7::bigint IS NULL OR i.item_id=$7)
       GROUP BY d.shop_id,d.promotion_key,d.period_start,d.period_end
       ORDER BY d.period_start DESC,d.period_end DESC,d.promotion_key`,
      [shopId,startDate,endDate,promotionType,dataSource,campaignStatus,productId],
    );
    return result.rows;
  }
}

module.exports = { ShopeeAdPromotionRepository };
