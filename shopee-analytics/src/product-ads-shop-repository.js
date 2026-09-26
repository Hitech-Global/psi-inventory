'use strict';

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrZero(value) {
  return numberOrNull(value) ?? 0;
}

class ShopeeProductAdsShopRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async upsertMany({ shopId, rows = [], queryable = this.pool }) {
    if (!rows.length) return { rowCount: 0 };
    const payload = rows.map(row => ({
      event_date: row.eventDate,
      impressions: numberOrZero(row.impressions),
      clicks: numberOrZero(row.clicks),
      ctr: numberOrNull(row.ctr),
      direct_orders: numberOrZero(row.directOrders),
      broad_orders: numberOrZero(row.broadOrders),
      direct_units: numberOrZero(row.directUnits),
      broad_units: numberOrZero(row.broadUnits),
      direct_cvr: numberOrNull(row.directCvr),
      broad_cvr: numberOrNull(row.broadCvr),
      direct_gmv: numberOrNull(row.directGmv),
      broad_gmv: numberOrNull(row.broadGmv),
      expense: numberOrNull(row.expense),
      cpc: numberOrNull(row.cpc),
      cost_per_conversion: numberOrNull(row.costPerConversion),
      cost_per_direct_conversion: numberOrNull(row.costPerDirectConversion),
      direct_roas: numberOrNull(row.directRoas),
      broad_roas: numberOrNull(row.broadRoas),
      direct_acos: numberOrNull(row.directAcos),
      broad_acos: numberOrNull(row.broadAcos),
      raw_json: row.raw || {},
    }));

    await queryable.query(
      `INSERT INTO shopee_product_ads_shop_daily
        (shop_id,event_date,impressions,clicks,ctr,direct_orders,broad_orders,direct_units,broad_units,direct_cvr,broad_cvr,direct_gmv,broad_gmv,expense,cpc,cost_per_conversion,cost_per_direct_conversion,direct_roas,broad_roas,direct_acos,broad_acos,raw_json,synced_at)
       SELECT $1,x.event_date,x.impressions,x.clicks,x.ctr,x.direct_orders,x.broad_orders,x.direct_units,x.broad_units,x.direct_cvr,x.broad_cvr,x.direct_gmv,x.broad_gmv,x.expense,x.cpc,x.cost_per_conversion,x.cost_per_direct_conversion,x.direct_roas,x.broad_roas,x.direct_acos,x.broad_acos,x.raw_json,now()
       FROM jsonb_to_recordset($2::jsonb) AS x(
         event_date date,
         impressions bigint,
         clicks bigint,
         ctr numeric,
         direct_orders bigint,
         broad_orders bigint,
         direct_units bigint,
         broad_units bigint,
         direct_cvr numeric,
         broad_cvr numeric,
         direct_gmv numeric,
         broad_gmv numeric,
         expense numeric,
         cpc numeric,
         cost_per_conversion numeric,
         cost_per_direct_conversion numeric,
         direct_roas numeric,
         broad_roas numeric,
         direct_acos numeric,
         broad_acos numeric,
         raw_json jsonb
       )
       ON CONFLICT (shop_id,event_date) DO UPDATE SET
         impressions=EXCLUDED.impressions,
         clicks=EXCLUDED.clicks,
         ctr=EXCLUDED.ctr,
         direct_orders=EXCLUDED.direct_orders,
         broad_orders=EXCLUDED.broad_orders,
         direct_units=EXCLUDED.direct_units,
         broad_units=EXCLUDED.broad_units,
         direct_cvr=EXCLUDED.direct_cvr,
         broad_cvr=EXCLUDED.broad_cvr,
         direct_gmv=EXCLUDED.direct_gmv,
         broad_gmv=EXCLUDED.broad_gmv,
         expense=EXCLUDED.expense,
         cpc=EXCLUDED.cpc,
         cost_per_conversion=EXCLUDED.cost_per_conversion,
         cost_per_direct_conversion=EXCLUDED.cost_per_direct_conversion,
         direct_roas=EXCLUDED.direct_roas,
         broad_roas=EXCLUDED.broad_roas,
         direct_acos=EXCLUDED.direct_acos,
         broad_acos=EXCLUDED.broad_acos,
         raw_json=EXCLUDED.raw_json,
         synced_at=now()`,
      [shopId, JSON.stringify(payload)],
    );
    return { rowCount: rows.length };
  }

  async list({ shopId, startDate, endDate }) {
    const result = await this.pool.query(
      `SELECT shop_id,event_date,impressions,clicks,ctr,direct_orders,broad_orders,direct_units,broad_units,direct_cvr,broad_cvr,direct_gmv,broad_gmv,expense,cpc,cost_per_conversion,cost_per_direct_conversion,direct_roas,broad_roas,direct_acos,broad_acos,synced_at
       FROM shopee_product_ads_shop_daily
       WHERE shop_id=$1 AND event_date BETWEEN $2 AND $3
       ORDER BY event_date ASC`,
      [shopId, startDate, endDate],
    );
    return result.rows;
  }
}

function ratio(numerator, denominator) {
  const n = Number(numerator || 0);
  const d = Number(denominator || 0);
  return d ? n / d : 0;
}

function summarizeProductAdsRows(rows = []) {
  const totals = rows.reduce((acc, row) => {
    acc.impressions += Number(row.impressions || 0);
    acc.clicks += Number(row.clicks || 0);
    acc.directOrders += Number(row.direct_orders ?? row.directOrders ?? 0);
    acc.broadOrders += Number(row.broad_orders ?? row.broadOrders ?? 0);
    acc.directUnits += Number(row.direct_units ?? row.directUnits ?? 0);
    acc.broadUnits += Number(row.broad_units ?? row.broadUnits ?? 0);
    acc.directGmv += Number(row.direct_gmv ?? row.directGmv ?? 0);
    acc.broadGmv += Number(row.broad_gmv ?? row.broadGmv ?? 0);
    acc.expense += Number(row.expense || 0);
    return acc;
  }, {
    impressions: 0,
    clicks: 0,
    directOrders: 0,
    broadOrders: 0,
    directUnits: 0,
    broadUnits: 0,
    directGmv: 0,
    broadGmv: 0,
    expense: 0,
  });
  return {
    ...totals,
    ctr: ratio(totals.clicks, totals.impressions),
    directCvr: ratio(totals.directOrders, totals.clicks),
    broadCvr: ratio(totals.broadOrders, totals.clicks),
    directRoas: ratio(totals.directGmv, totals.expense),
    broadRoas: ratio(totals.broadGmv, totals.expense),
    cpc: ratio(totals.expense, totals.clicks),
    costPerConversion: ratio(totals.expense, totals.broadOrders),
    costPerDirectConversion: ratio(totals.expense, totals.directOrders),
    broadAcos: ratio(totals.expense, totals.broadGmv),
    directAcos: ratio(totals.expense, totals.directGmv),
  };
}

module.exports = { ShopeeProductAdsShopRepository, summarizeProductAdsRows };
