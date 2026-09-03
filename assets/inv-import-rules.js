/*
 * inv-import-rules.js — 库存导入预检查「前端状态 / 品牌严格比较」纯函数层
 *
 * 设计目的：
 *   1) 把前端闭环逻辑（按钮 enabled 判定、fingerprint 强绑定、422 兜底、seq 竞态守卫）
 *      抽成无 DOM 依赖的纯函数，使其可在 node 测试中确定性验证（见 test/inv-import-ui-rules.test.cjs）；
 *   2) 品牌严格比较规则（逐字符 ===，禁 trim / 大小写 / 空格压缩 / alias）与此处单一来源，
 *      与 server.js validateInventoryImportRows 的口径保持一致。
 *
 * 注意：本文件不触碰任何业务逻辑 / 既有 WIP（db-*.js / WAC / SKU 主数据写入等）。
 */
(function (root) {
  'use strict';

  // 品牌是否“未维护”：NULL / undefined / 空串 / 纯空格 一律视为未维护。
  // 仅用于“是否提示去补 SKU 主数据”，不参与一致性比较。
  function isBrandUnmaintained(v) {
    return v === null || v === undefined || String(v).trim() === '';
  }

  // Excel brand 与 SKU 主数据 brand 是否“不一致”（需阻断）。
  // 入参为原始字符串（调用方不得提前 trim）：
  //   · Excel brand 为空（null / undefined / ''）→ 视为未填写 → 允许（返回 false）；
  //   · Excel brand 为纯空格等“已填写但非空白”内容 → 必须参与比较（返回 true）；
  //   · 一旦 Excel 有填值，必须与 masterBrand 逐字符 === 完全一致，否则不一致。
  function isBrandMismatch(excelBrand, masterBrand) {
    var eb = (excelBrand === null || excelBrand === undefined) ? '' : String(excelBrand);
    var mb = (masterBrand === null || masterBrand === undefined) ? '' : String(masterBrand);
    if (eb === '') return false; // 未填写 → 允许
    return eb !== mb;             // 已填写 → 严格逐字符比较
  }

  // 当前提交 payload 的 fingerprint：覆盖 records（sku/brand 原始值/import_date/country/warehouse/qty/wac）
  // 以及页面级 snapshot_cutoff_date。任何会改变实际写库内容的动作都会改变 fingerprint。
  // 用不可见分隔符（\u0001 行内、\u0000 行间、\u0002 截止日期）避免字段值拼接歧义。
  function computeInvImportFingerprint(records, snapshotCutoffDate) {
    var rows = (records || []).map(function (r) {
      return [
        r.sku_code, r.brand, r.import_date, r.country, r.warehouse,
        r.available_qty, r.weighted_avg_cost, r.snapshot_cutoff_date
      ].join('\u0001');
    }).join('\u0000');
    return rows + '\u0002' + (snapshotCutoffDate || '');
  }

  // 按钮是否可点击（enabled）的纯判定。
  // opts: { hasRows, hasLocalError, precheckOk, blockingCount, fingerprintMatch, hasDate }
  function invImportShouldEnable(opts) {
    opts = opts || {};
    if (!opts.hasRows) return false;
    if (opts.hasLocalError) return false;
    if (!opts.hasDate) return false;
    if (!opts.precheckOk) return false;
    if ((opts.blockingCount || 0) > 0) return false;
    if (!opts.fingerprintMatch) return false;
    return true;
  }

  // 异步竞态守卫：过期的旧 precheck 响应（returnedSeq）不得覆盖最新一次请求（latestSeq）。
  function invPrecheckSeqAccepted(returnedSeq, latestSeq) {
    return returnedSeq === latestSeq;
  }

  // bulk-import 返回 blocked:true 时，统一把前端状态恢复为“阻断态”。
  // 返回新状态：precheck.ok=false、blocking 保留、passedFingerprint 失效。
  function applyBlockedFallback(payload, prevState) {
    var pl = payload || {};
    var blocking = pl.blocking || (pl.precheck && pl.precheck.blocking) || [];
    var summary = pl.summary || (pl.precheck && pl.precheck.summary) || [];
    var totalRows = pl.total_rows || (pl.precheck && pl.precheck.total_rows) ||
      (prevState && prevState.total_rows) || 0;
    return {
      precheck: {
        ok: false,
        blocking: blocking,
        summary: summary,
        blocking_count: blocking.length,
        total_rows: totalRows
      },
      passedFingerprint: null
    };
  }

  var api = {
    isBrandUnmaintained: isBrandUnmaintained,
    isBrandMismatch: isBrandMismatch,
    computeInvImportFingerprint: computeInvImportFingerprint,
    invImportShouldEnable: invImportShouldEnable,
    invPrecheckSeqAccepted: invPrecheckSeqAccepted,
    applyBlockedFallback: applyBlockedFallback
  };

  // 浏览器：挂到 window；node（测试）：module.exports
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.InvImportRules = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
