'use strict';
/**
 * RP-P0-R1 — 订单预测接口 response 投影 / 序列化瘦身。
 *
 * 设计约束（严格遵守，不越界）：
 *   - 只做 response 投影，不动任何预测计算公式 / suggested_qty / turnover /
 *     pool / sales calculation / channel allocation / WAC / inventory refresh /
 *     transit logic / 事务 / DB schema。
 *   - 不修改 endpoint URL / method / 顶层结构 / rid / 字段名 / 字段含义。
 *
 * 主接口（GET /api/replenishment-suggestions）：
 *   采用 deny-list 删除经 FIELD USAGE MATRIX（全 app.js 零引用）审计确认的
 *   30 个死字段。deny-list 而非 SQL 显式列枚举，是为了杜绝本地/生产
 *   ALTER 历史漂移导致误删前端实际需要的列——最坏情况只是少瘦身，绝不破坏前端。
 *
 * daily-sales 接口（GET /api/replenishment-suggestions/daily-sales）：
 *   采用显式白名单，彻底切断原 `...sku` 全字段 spread 自动把主对象所有列
 *   （含未来新增列）泄漏进 daily 响应的风险。
 */

// 经审计：前端所有消费者（total/online/offline/monthly 渲染、daily 渲染、
// Excel export、建议量保存、筛选、override replay、tooltip/title）均零引用。
// 其中 28 个为 rs 表列，2 个为 sku 关联列（standard_purchase_price / purchase_currency）。
const RP_UNUSED_RESPONSE_FIELDS = [
  // 历史线上/线下分周期销量（被 avg_sales_period 系列取代，前端未引用）
  'online_sales_30d', 'online_sales_60d', 'online_sales_90d',
  'offline_sales_30d', 'offline_sales_60d', 'offline_sales_90d',
  // 旧手动/月度预测口径（被 channel allocation / 按月重构取代）
  'manual_forecast_online', 'manual_forecast_offline',
  'mdf_forecast_monthly', 'total_monthly_forecast',
  // 旧周转口径（被 after_order_turnover_months + 视图模型 c.* 取代）
  'current_turnover_months',
  'with_transit_turnover_months', 'with_pi_turnover_months', 'with_po_turnover_months',
  // 旧下单/MOQ 口径（被 carton_adjusted_qty / user_adjusted_qty / 视图模型取代）
  'manual_planned_qty', 'moq_qty', 'carton_adjusted_qty', 'generate_po',
  // 旧目标库存（被 *_target_stock 取代）
  'target_stock_months',
  // 旧风险等级（被 risk_tags 并行标签取代，rpCellText 只用 risk_tags）
  'risk_level',
  // 旧线上/线下预留（被 *_reservation_qty / remark 取代，前端未引用）
  'online_reservation_method', 'online_reservation_months', 'online_reservation_qty',
  'offline_reservation_method', 'offline_reservation_months', 'offline_reservation_qty',
  // 旧其它建议量（被 other_target_stock 取代）
  'other_suggested_qty',
  // 旧对账时间戳（前端未引用）
  'resolved_at',
  // sku 关联：采购价/币种（订单预测页面不展示，采购价在 SKU 管理页展示）
  'standard_purchase_price', 'purchase_currency'
];

/**
 * 主接口行投影：删除经审计零引用的死字段。
 * **非变异（non-mutating）**：先浅拷贝 `out = { ...row }`，仅在副本上 delete，
 * 返回新对象。输入对象保持完全不变（FINAL CORRECTION GATE 要求）。
 * @param {Object} row 单行响应对象（已含 applyLiveForecastInventory 派生字段）
 * @returns {Object} 新对象（!== input），30 个 deny-list 字段被移除，其余（含未来新增字段）原样保留
 */
function slimReplenishmentRow(row) {
  const out = { ...row };
  for (const f of RP_UNUSED_RESPONSE_FIELDS) delete out[f];
  return out;
}

/**
 * daily-sales 接口行投影：显式白名单，仅返回 daily 视图真实需要的字段。
 * 彻底替代原 `return { ...sku, daily_sales, ... }` 全字段 spread。
 * @param {Object} sku 单行补货建议对象（含 id/sku_code/sales_group/lifecycle_status/model 等）
 * @param {number[]} daily 按 dates 顺序的每日销量数组
 * @param {number} last7 近7天合计
 * @param {number} last14 近14天合计
 * @param {number} last30 近30天合计
 * @param {number} avg 日均销量
 * @param {string} trend 趋势 'up'|'down'|'flat'
 * @returns {Object}
 */
function projectDailySalesRow(sku, daily, last7, last14, last30, avg, trend) {
  return {
    id: sku.id,
    sku_code: sku.sku_code,
    sales_group: sku.sales_group,
    lifecycle_status: sku.lifecycle_status,
    model: sku.model,
    daily_sales: daily,
    last_7_days: last7,
    last_14_days: last14,
    last_30_days: last30,
    avg_daily_sales: avg,
    trend
  };
}

module.exports = { RP_UNUSED_RESPONSE_FIELDS, slimReplenishmentRow, projectDailySalesRow };
