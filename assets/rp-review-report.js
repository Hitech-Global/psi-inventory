/*
 * rp-review-report.js — 「订单预测 → 库存周转复盘报告 V1」纯逻辑层
 *
 * 设计红线（严格，不得越界）：
 *   1) 不接任何 AI / LLM / OpenAI API。所有文案由固定模板生成。
 *   2) 不重新创建任何预测口径。报告只「读」订单预测页面已生成的视图模型
 *      （总预测 r._totalC / 线上·线下 r._channelC[tab]），只做分类与总结。
 *      禁止重写库存池 / 建议采购 / 周转 / blocked / target turnover 算法。
 *   3) 不触碰数据库、不发请求、不写库、不改任何既有业务状态。
 *   4) 销量趋势（recentAvg / previousAvg / trendRate）仅用于复盘展示与动作提示，
 *      绝不反馈进 suggested_qty / target turnover / blocked 的判断链路。
 *
 * 无 DOM / 无 DB 依赖 → 可在 node 中确定性测试（见 test/rp-review-report.test.cjs）。
 * 浏览器挂 window.RpReviewReport，node 走 module.exports（与 assets/inv-import-rules.js 同构）。
 */
(function (root) {
  'use strict';

  // ==================== 报告常量（禁止在业务逻辑内散落 magic number）====================
  // 趋势判定阈值：近两月均值 vs 前两月均值的变化率
  var TREND_UP_THRESHOLD = 0.10;    // 变化率 > +10% → 上升
  var TREND_DOWN_THRESHOLD = -0.10; // 变化率 < -10% → 下滑
  // 「显著偏高」倍数：当前周转 >= 目标周转 × 该值 且销量下滑 → 升级为促销/分销级建议
  var OVERSTOCK_SEVERE_FACTOR = 1.5;
  // 管理行动清单每个优先级最多展示条数（复制文本用；完整表格不受限）
  var COPY_ACTION_LIMIT_PER_PRIORITY = 5;

  // 趋势枚举（展示层，不参与任何预测计算）
  var TREND = {
    UP: 'up',       // ↑ 上升
    DOWN: 'down',   // ↓ 下滑
    FLAT: 'flat',   // → 稳定
    NEW: 'new',     // ↑ 新增/恢复销量（previousAvg = 0 且 recentAvg > 0）
    NONE: 'none'    // 无销量（previousAvg = 0 且 recentAvg = 0）
  };

  // 分类枚举（互斥分区，每个 SKU 只归入一类，保证摘要计数可加总）
  var CATEGORY = {
    NO_SALES: 'noSales',
    PURCHASE: 'purchase',
    OVERSTOCK: 'overstock',
    BLOCKED: 'blocked',
    NORMAL: 'normal'
  };

  var PRIORITY = { P0: 'P0', P1: 'P1', P2: 'P2' };

  // 系统权威「高库存」信号（复用 classifySkuState / shouldBlockReplenish 的既有产出，
  // 本模块不复制一套判断，只识别这些既有状态）
  var OVERSTOCK_RISK_TAGS = ['高库存关注', '高库存严重'];
  var OVERSTOCK_SALES_STATUS = ['慢销', '呆滞'];
  // 系统权威「库存不足」信号
  var STOCKOUT_SALES_STATUS = ['缺货', '缺货风险'];
  // 系统对该状态已给出「明确非通用」动作文案的状态集合 → 报告原样复用，不另造一套。
  // 注意：正常动销的系统动作为通用文案「按目标周转正常补货」，若 SKU 因库存池周转偏高
  // 被报告归入高库存，则该通用文案不适用，应由下方展示型规则给出消化库存建议。
  var SYSTEM_ACTION_REUSE_STATUS = [
    '清仓', '停采/停产', '停采/清库存', '无有效销售', '呆滞', '慢销',
    '缺货', '缺货风险', '新品/销售数据不足'
  ];

  var NO_SALES_TEXT = '无销量';

  // ==================== 通用小工具 ====================
  function nz(v) { return Number(v) || 0; }
  function round1(v) { return Math.round(Number(v) * 10) / 10; }
  // 默认 i18n：无词典时返回中文 fallback 并替换 {var} 占位
  // （与 i18n.js t(key, fallbackZh, vars) 行为一致，保证 node 测试与浏览器展示同形）
  function defaultT(key, fallback, vars) {
    var s = (fallback != null) ? fallback : key;
    if (vars && typeof s === 'string') {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return (vars[k] != null) ? vars[k] : m;
      });
    }
    return s;
  }

  // 逗号字符串 / 数组 → 标签数组（仅为展示解析，不产生任何新判断）
  function parseRiskTags(riskTags) {
    if (Array.isArray(riskTags)) {
      return riskTags.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    }
    return String(riskTags || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function hasAny(list, values) {
    for (var i = 0; i < values.length; i++) {
      if (list.indexOf(values[i]) >= 0) return true;
    }
    return false;
  }

  // ==================== 销量趋势（展示型 helper）====================
  // recentAvg  = (m1 + m2) / 2
  // previousAvg = (m3 + m4) / 2
  // trendRate  = previousAvg > 0 ? (recentAvg - previousAvg) / previousAvg : null
  // 本函数纯展示，结果绝不回流到任何预测 / 建议采购 / blocked 判断。
  function rpReviewTrend(m1, m2, m3, m4) {
    var a = nz(m1), b = nz(m2), c = nz(m3), d = nz(m4);
    var recentAvg = (a + b) / 2;
    var previousAvg = (c + d) / 2;
    if (previousAvg > 0) {
      var rate = (recentAvg - previousAvg) / previousAvg;
      var trend = rate > TREND_UP_THRESHOLD ? TREND.UP
        : (rate < TREND_DOWN_THRESHOLD ? TREND.DOWN : TREND.FLAT);
      return { recentAvg: recentAvg, previousAvg: previousAvg, trendRate: rate, trend: trend };
    }
    return {
      recentAvg: recentAvg,
      previousAvg: previousAvg,
      trendRate: null,
      trend: recentAvg > 0 ? TREND.NEW : TREND.NONE
    };
  }

  // ==================== 行上下文适配（唯一数据入口）====================
  // 把订单预测页面已生成的视图模型投影为报告 DTO。
  // 只读取、不重算：当前周转 / 库存池 / 月均销量 / 建议采购 / 采购后周转 全部取自页面视图模型。
  //
  // row  : GET /api/replenishment-suggestions 的单行（已带 _totalC / _channelC）
  // tab  : 'total' | 'online' | 'offline'
  // opts : {
  //   effectiveQtyFn(tab, row) -> number|null   // 手工 override 优先的建议采购数量；
  //                                            // 未提供时回退服务端落库分量（不重算）
  //   blockedFn(row) -> boolean                 // 权威 blocked 判定（调用方传入既有的 shouldBlockReplenish）
  // }
  function rpReviewRowContext(row, tab, opts) {
    opts = opts || {};
    if (!row) return null;
    var view = tab === 'total' ? row._totalC : (row._channelC ? row._channelC[tab] : null);
    if (!view) return null;

    var pool, avgSales, currentTurnover, targetTurn, suggestedQty, afterTurn, m1, m2, m3, m4;
    var onlineTargetTurn = null, offlineTargetTurn = null;
    var onlineQty = null, offlineQty = null, otherQty = null;

    if (tab === 'total') {
      // 总预测：库存池 = 页面 c.pool；月均 = 页面 c.taPeriod(avg_sales_period)
      pool = nz(view.pool);
      avgSales = nz(view.taPeriod);
      // 与页面 c.ct 同式同精度（pool / avg_sales_period，1 位小数）。无销量 → null，绝不展示为 99。
      currentTurnover = avgSales > 0 ? round1(pool / avgSales) : null;
      //
      // 【总预测目标周转权威口径】
      // 总预测页面（loadRp / _totalC）**没有单一「目标周转」列**，而是两个并列列：
      //   c.ot  = r.online_target_turnover  → 页面列「线上目标周转」(key: online_target_turn)
      //   c.oft = r.offline_target_turnover → 页面列「线下目标周转」(key: offline_target_turn)
      // 后端两者由同一条 DIM 规则的两个独立字段给出，可分别配置（app.js dim 规则
      // {brand,country,warehouse,online_turnover,offline_turnover}），因此**允许不相等**，
      // 不能假设 online === offline 而只取其一冒充「总目标周转」。
      //
      // 报告取值策略（严格读取 view model，不新建任何品牌 hardcode）：
      //   onlineTargetTurn  = view.ot   —— 线上目标周转
      //   offlineTargetTurn = view.oft  —— 线下目标周转
      //   targetTurn        = view.ot   —— 「分类判定口径」目标周转。
      //       权威依据：后端 classifySkuState 的 target_months 入参为
      //       classifyTarget = dimHit.online_turnover（server.js:6663/6750），
      //       而 sales_status（慢销 = availTurnover > target*2）与
      //       risk_tags（高库存关注 > target*1.5 / 高库存严重 > target*2）均由它产出。
      //       报告的高库存/慢销判定复用这些既有信号，故基准必须同为 online_turnover，
      //       才能保证「报告分类」与「系统分类」同源。
      //       注意：采购决策口径（suggested_qty）是 online/offline 加权合成
      //       （total_target_stock = round(online_avg*ot) + round(offline_avg*oft)），
      //       不是任何单一字段；报告只读 c.sq（服务端落库值），绝不回算。
      targetTurn = nz(view.ot);
      onlineTargetTurn = nz(view.ot);
      offlineTargetTurn = nz(view.oft);
      suggestedQty = nz(view.sq);
      onlineQty = nz(row.online_suggested_qty);
      offlineQty = nz(row.offline_suggested_qty);
      // other 由恒等式反推：suggested_qty = online + offline + other（服务端 other_suggested_qty 恒为 0）
      otherQty = suggestedQty - onlineQty - offlineQty;
      afterTurn = (view.afterOrderTurnover === null || view.afterOrderTurnover === undefined)
        ? null : nz(view.afterOrderTurnover);
      m1 = nz(row.sales_m1); m2 = nz(row.sales_m2); m3 = nz(row.sales_m3); m4 = nz(row.sales_m4);
    } else {
      // 线上/线下：库存池 = 页面 c.poolAllocatedPeriod；月均 = 页面 c.avgSalesPeriod
      pool = nz(view.poolAllocatedPeriod);
      avgSales = nz(view.avgSalesPeriod);
      // 与页面 c.currentTurn 同式同精度（页面在无销量时直接写死字符串「无销量」，此处统一为 null）
      currentTurnover = avgSales > 0 ? round1(pool / avgSales) : null;
      // 渠道视图只有单一目标周转列（页面列 key: target_turn，后端字段
      // online_target_turnover（线上）/ offline_target_turnover（线下），
      // 取值见 loadRpChannelMonthly：targetTurn = r.<channel>_target_turnover||2）。
      targetTurn = nz(view.targetTurn);
      onlineTargetTurn = nz(view.targetTurn);
      offlineTargetTurn = nz(view.targetTurn);
      suggestedQty = nz(view.suggestedQty);
      afterTurn = (view.afterOrderTurnover === null || view.afterOrderTurnover === undefined)
        ? null : nz(view.afterOrderTurnover);
      m1 = nz(view.salesM1); m2 = nz(view.salesM2); m3 = nz(view.salesM3); m4 = nz(view.salesM4);
    }

    // 手工 override：仅在此处取值，绝不重算（未提供则沿用服务端落库分量）
    if (typeof opts.effectiveQtyFn === 'function' && tab !== 'total') {
      var eff = opts.effectiveQtyFn(tab, row);
      if (eff !== null && eff !== undefined) suggestedQty = nz(eff);
      // 采购后周转跟随 effectiveQty 重算，公式与页面 rpComputeChannelAfterOrderTurnover 完全一致：
      // (poolAllocatedPeriod + effectiveQty) / avgSalesPeriod，1 位小数；avgSalesPeriod<=0 → null。
      afterTurn = avgSales > 0 ? round1((pool + suggestedQty) / avgSales) : null;
    }

    var riskTags = parseRiskTags(row.risk_tags);
    var dto = {
      id: row.id,
      sku: row.sku_code || '',
      model: row.model || '',
      brand: row.brand || '',
      country: row.country || '',
      warehouse: row.target_warehouse || row.warehouse || '',
      pool: pool,
      avgSales: avgSales,
      currentTurnover: currentTurnover,
      targetTurn: targetTurn,
      // 总预测：线上/线下目标周转分列（页面两个列的实际值），二者可能不相等
      onlineTargetTurn: onlineTargetTurn,
      offlineTargetTurn: offlineTargetTurn,
      // 同一 SKU 内 online/offline 目标周转是否一致；不一致时不得对外展示单一"总目标周转"
      targetTurnSplit: (onlineTargetTurn !== null && offlineTargetTurn !== null
        && onlineTargetTurn !== offlineTargetTurn),
      suggestedQty: suggestedQty,
      onlineQty: onlineQty,
      offlineQty: offlineQty,
      otherQty: otherQty,
      // 总预测恒等式自检：suggested = online + offline + other
      splitOk: (onlineQty === null) ? true
        : (onlineQty + offlineQty + otherQty === suggestedQty),
      afterOrderTurnover: afterTurn,
      m1: m1, m2: m2, m3: m3, m4: m4,
      salesStatus: (row.sales_status || '').trim(),
      riskTags: riskTags,
      // 权威 blocked：由调用方传入既有 shouldBlockReplenish 的结果（本模块不复制判断）
      blocked: typeof opts.blockedFn === 'function' ? !!opts.blockedFn(row) : false,
      // 权威建议动作 / 建议说明（系统既有文案，直接透传展示）
      systemAction: row.action || '',
      systemSuggestion: row.suggestion || ''
    };
    dto.trend = rpReviewTrend(m1, m2, m3, m4);
    return dto;
  }

  // ==================== 分类（互斥分区）====================
  // 优先级：无销量 → 建议采购 → 高库存 → blocked/慢销 → 正常
  // 高库存信号优先复用系统既有状态（风险标签 / 动销状态），再用页面自身周转做补充。
  function rpReviewIsOverstock(dto) {
    if (dto.currentTurnover === null) return false; // 无销量不进高库存
    if (hasAny(dto.riskTags, OVERSTOCK_RISK_TAGS)) return true;
    if (OVERSTOCK_SALES_STATUS.indexOf(dto.salesStatus) >= 0) return true;
    return dto.currentTurnover > dto.targetTurn;
  }

  function rpReviewClassify(dto) {
    if (dto.avgSales <= 0) return CATEGORY.NO_SALES;         // 无销量（含 avg_sales_period = 0）
    if (dto.suggestedQty > 0) return CATEGORY.PURCHASE;      // 建议采购
    if (rpReviewIsOverstock(dto)) return CATEGORY.OVERSTOCK; // 高库存 / 积压
    if (dto.blocked) return CATEGORY.BLOCKED;                // 慢销/停采/blocked
    return CATEGORY.NORMAL;
  }

  // ==================== 高库存建议动作（固定规则，优先复用系统权威状态）====================
  function rpReviewOverstockAction(dto, t) {
    t = t || defaultT;
    // 1) 系统已就该状态给出明确动作（慢销/呆滞/清仓/停采/无有效销售等）→ 原样复用，不另造一套
    if (dto.systemAction && SYSTEM_ACTION_REUSE_STATUS.indexOf(dto.salesStatus) >= 0) {
      return dto.systemAction;
    }
    // 2) 系统动作为通用文案时的固定兜底（按既有状态取值，不重新判断状态）
    if (dto.salesStatus === '呆滞') {
      return t('rp.review.action.stale', '暂停补货，优先清库存（近30天无销量）');
    }
    if (dto.riskTags.indexOf('高库龄风险') >= 0) {
      return t('rp.review.action.aged', '排查老库存/价格/渠道，优先清库存');
    }
    if (dto.salesStatus === '慢销') {
      return t('rp.review.action.slow', '谨慎补货，先消化库存（周转超目标2倍）');
    }
    // 3) 展示型补充规则（仅影响建议措辞，不改任何系统状态）
    var severe = dto.targetTurn > 0 && dto.currentTurnover >= dto.targetTurn * OVERSTOCK_SEVERE_FACTOR;
    if (dto.trend.trend === TREND.DOWN && severe) {
      return t('rp.review.action.promote', '高库存风险，建议促销/线下分销');
    }
    if (dto.trend.trend === TREND.DOWN) {
      return t('rp.review.action.reduce_declining', '库存偏高且销量下滑，建议控制补货并加快消化');
    }
    return t('rp.review.action.reduce', '暂停/减少补货，优先消化库存');
  }

  // ==================== 管理行动清单（确定性规则）====================
  // P0：有销量且库存不足 / 系统已有建议采购数量 > 0
  // P1：周转明显高于目标且销量下降 / blocked / slow-moving / stale
  // P2：一般性高库存、无销量待检查、其他需观察异常
  function rpReviewActionFor(dto, t) {
    t = t || defaultT;
    var isStockout = hasAny([dto.salesStatus], STOCKOUT_SALES_STATUS);

    if (dto.avgSales > 0 && (dto.suggestedQty > 0 || isStockout)) {
      var qtyTxt = dto.suggestedQty > 0
        ? t('rp.review.issue.understock_qty', '库存不足，建议采购 {qty}', { qty: Math.round(dto.suggestedQty) })
        : t('rp.review.issue.understock', '库存不足（{status}），系统建议采购为 0，请人工复核', { status: dto.salesStatus });
      return {
        priority: PRIORITY.P0,
        issue: qtyTxt,
        data: rpReviewActionData(dto, t),
        action: dto.systemSuggestion || t('rp.review.action.purchase_now', '按建议采购数量下单')
      };
    }
    if (dto.avgSales <= 0) {
      return {
        priority: PRIORITY.P2,
        issue: t('rp.review.issue.no_sales', '无销量'),
        data: rpReviewActionData(dto, t),
        action: t('rp.review.action.check_no_sales', '检查是否停采 / 是否新品 / 是否缺少销售数据')
      };
    }
    var declining = dto.trend.trend === TREND.DOWN;
    var aboveTarget = dto.currentTurnover !== null && dto.currentTurnover > dto.targetTurn;
    if (dto.blocked || (aboveTarget && declining)) {
      return {
        priority: PRIORITY.P1,
        issue: t('rp.review.issue.overstock_declining', '周转 {cur} 个月高于目标 {target} 个月{suffix}', {
          cur: rpReviewTurnText(dto.currentTurnover, t),
          target: dto.targetTurn,
          suffix: declining
            ? t('rp.review.issue.suffix_declining', '，近两月销量下滑 {pct}', { pct: rpReviewPctText(dto.trend.trendRate) })
            : ''
        }),
        data: rpReviewActionData(dto, t),
        action: rpReviewOverstockAction(dto, t)
      };
    }
    if (aboveTarget) {
      return {
        priority: PRIORITY.P2,
        issue: t('rp.review.issue.overstock', '周转 {cur} 个月高于目标 {target} 个月', {
          cur: rpReviewTurnText(dto.currentTurnover, t),
          target: dto.targetTurn
        }),
        data: rpReviewActionData(dto, t),
        action: rpReviewOverstockAction(dto, t)
      };
    }
    return null; // 正常 SKU 不进管理行动清单
  }

  function rpReviewPctText(rate) {
    if (rate === null || rate === undefined) return '0%';
    return (Math.round(rate * 1000) / 10).toFixed(1) + '%';
  }

  function rpReviewTurnText(v, t) {
    t = t || defaultT;
    if (v === null || v === undefined) return t('rp.review.no_sales', NO_SALES_TEXT);
    return String(v);
  }

  // 目标周转展示：总预测线上/线下目标周转不同时并列展示「线上 X / 线下 Y」，
  // 绝不用线上单值冒充「总目标周转」（页面本就是两个独立列，DIM 两字段可分别配置）。
  // 前端表格与 Excel 必须共用本函数，保证两者数值完全一致。
  function rpReviewTargetText(dto, t) {
    t = t || defaultT;
    if (!dto) return '';
    if (dto.targetTurnSplit && dto.onlineTargetTurn !== null && dto.offlineTargetTurn !== null) {
      return String(dto.onlineTargetTurn) + ' / ' + String(dto.offlineTargetTurn);
    }
    return String(dto.targetTurn === null || dto.targetTurn === undefined ? '' : dto.targetTurn);
  }

  // 行动清单「核心数据」列：库存池 / 月均 / 当前周转 / 目标周转 / 建议采购 / 趋势
  function rpReviewActionData(dto, t) {
    t = t || defaultT;
    return t('rp.review.data.line',
      '库存池 {pool} / 月均 {avg} / 周转 {cur} / 目标 {target} / 建议采购 {qty} / 趋势 {trend}',
      {
        pool: Math.round(dto.pool),
        avg: Math.round(dto.avgSales),
        cur: rpReviewTurnText(dto.currentTurnover, t),
        target: dto.targetTurn,
        qty: Math.round(dto.suggestedQty),
        trend: rpReviewTrendLabel(dto.trend, t)
      });
  }

  function rpReviewTrendLabel(trend, t) {
    t = t || defaultT;
    switch (trend.trend) {
      case TREND.UP: return t('rp.review.trend.up', '↑ 上升');
      case TREND.DOWN: return t('rp.review.trend.down', '↓ 下滑');
      case TREND.FLAT: return t('rp.review.trend.flat', '→ 稳定');
      case TREND.NEW: return t('rp.review.trend.new', '↑ 新增/恢复销量');
      default: return t('rp.review.trend.none', '无销量');
    }
  }

  function rpReviewTrendRateText(trend) {
    if (trend.trendRate === null || trend.trendRate === undefined) return '-';
    return (trend.trendRate >= 0 ? '+' : '') + rpReviewPctText(trend.trendRate);
  }

  // ==================== 报告主构建 ====================
  // input: {
  //   rows: [...],                 // 订单预测原始行（带视图模型）
  //   tab: 'total'|'online'|'offline',
  //   filters: {country, warehouse, brand, keyword, salesStatus, lifecycleStatus},
  //   t: fn,                       // 可选 i18n（默认返回中文 fallback）
  //   effectiveQtyFn / blockedFn   // 透传给 rpReviewRowContext
  // }
  function rpReviewBuildReport(input) {
    var src = input || {};
    var t = src.t || defaultT;
    var tab = src.tab || 'total';
    var rawRows = src.rows || [];
    var filters = src.filters || {};

    var dtos = [];
    for (var i = 0; i < rawRows.length; i++) {
      var dto = rpReviewRowContext(rawRows[i], tab, {
        effectiveQtyFn: src.effectiveQtyFn,
        blockedFn: src.blockedFn
      });
      if (!dto) continue;
      dto.category = rpReviewClassify(dto);
      dtos.push(dto);
    }

    var buckets = {};
    buckets[CATEGORY.NO_SALES] = [];
    buckets[CATEGORY.PURCHASE] = [];
    buckets[CATEGORY.OVERSTOCK] = [];
    buckets[CATEGORY.BLOCKED] = [];
    buckets[CATEGORY.NORMAL] = [];
    dtos.forEach(function (d) { buckets[d.category].push(d); });

    // ---- 目标周转（读取页面 view model 的线上/线下目标周转列，不另建任何品牌配置）----
    // 品牌档位按「线上/线下目标周转」成对归并：同一品牌若 online≠offline，必须同时展示两个值，
    // 绝不用 online 单值冒充「品牌目标周转」（DIM 规则两个字段可独立配置）。
    var brandMap = {};
    dtos.forEach(function (d) {
      var b = d.brand || t('rp.review.brand_empty', '(未填品牌)');
      if (!brandMap[b]) {
        brandMap[b] = {
          brand: b,
          onlineTarget: d.onlineTargetTurn,
          offlineTarget: d.offlineTargetTurn,
          // 兼容字段：online===offline 时=该值；不等时=null（调用方必须展示双值）
          target: d.targetTurnSplit ? null : d.targetTurn,
          split: !!d.targetTurnSplit,
          count: 0
        };
      }
      brandMap[b].count++;
    });
    var brandList = Object.keys(brandMap).map(function (k) { return brandMap[k]; })
      .sort(function (a, b) { return b.count - a.count; });

    // 统一目标周转：仅当「全量 SKU 的线上目标唯一」且「线下目标唯一」时才可给出单一值；
    // 两者不等时给出 null，由 targetTurnoverText 展示「线上 X / 线下 Y」，避免误导。
    var distinctOnline = {}, distinctOffline = {}, distinctPrimary = {};
    dtos.forEach(function (d) {
      distinctOnline[d.onlineTargetTurn] = (distinctOnline[d.onlineTargetTurn] || 0) + 1;
      distinctOffline[d.offlineTargetTurn] = (distinctOffline[d.offlineTargetTurn] || 0) + 1;
      distinctPrimary[d.targetTurn] = (distinctPrimary[d.targetTurn] || 0) + 1;
    });
    var onlineKeys = Object.keys(distinctOnline), offlineKeys = Object.keys(distinctOffline);
    var unifiedOnline = onlineKeys.length === 1 ? Number(onlineKeys[0]) : null;
    var unifiedOffline = offlineKeys.length === 1 ? Number(offlineKeys[0]) : null;
    var primaryKeys = Object.keys(distinctPrimary);
    var unifiedTarget = primaryKeys.length === 1 ? Number(primaryKeys[0]) : null;

    var targetTurnoverText;
    if (!dtos.length) {
      // 空报告（筛选无匹配）：不存在任何目标周转档位，不能显示「多档」误导
      targetTurnoverText = t('rp.review.none', '-');
    } else if (unifiedOnline !== null && unifiedOffline !== null && unifiedOnline === unifiedOffline) {
      targetTurnoverText = t('rp.review.months', '{n} 个月', { n: unifiedOnline });
    } else if (unifiedOnline !== null && unifiedOffline !== null) {
      // 线上/线下目标周转不同 —— 总预测本就没有单一总目标周转，必须并列展示
      targetTurnoverText = t('rp.review.target.split', '线上 {on} / 线下 {off} 个月',
        { on: unifiedOnline, off: unifiedOffline });
    } else {
      targetTurnoverText = t('rp.review.multi_target', '多档（按品牌/国家/仓库命中）');
    }

    var purchaseQty = 0;
    buckets[CATEGORY.PURCHASE].forEach(function (d) { purchaseQty += d.suggestedQty; });

    var blockedFlagCount = dtos.filter(function (d) { return d.blocked; }).length;
    // 高库存 ∩ 系统拦截补货：真实数据里两者高度重叠（被判高库存的 SKU 大多同时被 blocked），
    // 因此「Blocked / 慢销」作为独立维度统计，避免分区口径把它恒算成 0。
    var blockedOverlapCount = buckets[CATEGORY.OVERSTOCK].filter(function (d) { return d.blocked; }).length;

    var health = {
      skuTotal: dtos.length,
      // 单一目标周转：仅当线上/线下目标周转全量唯一且相等时才有意义；
      // 否则为 null，调用方必须改用 targetTurnoverText（"线上 X / 线下 Y"）。
      targetTurnover: (unifiedOnline !== null && unifiedOnline === unifiedOffline)
        ? unifiedOnline : null,
      targetTurnoverText: targetTurnoverText,
      // 分类判定口径（= classifySkuState 的 target_months = DIM online_turnover）唯一值，
      // 供「高库存 = 当前周转 > 目标周转」等判定与测试断言使用；多档时为 null。
      classifyTargetTurnover: unifiedTarget,
      onlineTargetTurnover: unifiedOnline,
      offlineTargetTurnover: unifiedOffline,
      targetTurnoverByBrand: brandList,
      purchaseCount: buckets[CATEGORY.PURCHASE].length,
      overstockCount: buckets[CATEGORY.OVERSTOCK].length,
      // 独立维度：系统拦截补货（慢销/呆滞/停采/清仓/高库存标签）的 SKU 总数
      blockedCount: blockedFlagCount,
      // 分区残差：被拦截但未落入高库存/无销量/建议采购的 SKU 数
      blockedOnlyCount: buckets[CATEGORY.BLOCKED].length,
      // 高库存 ∩ 被拦截（用于说明两个维度的重叠程度）
      blockedOverlapCount: blockedOverlapCount,
      noSalesCount: buckets[CATEGORY.NO_SALES].length,
      normalCount: buckets[CATEGORY.NORMAL].length,
      purchaseQty: purchaseQty
    };

    // ---- 管理摘要（固定模板，无 AI）----
    var summary = rpReviewBuildSummary(health, buckets, dtos, t);

    // ---- 管理行动清单 ----
    var actions = [];
    dtos.forEach(function (d) {
      var a = rpReviewActionFor(d, t);
      if (!a) return;
      actions.push({
        priority: a.priority,
        sku: d.sku,
        brand: d.brand,
        issue: a.issue,
        data: a.data,
        action: a.action,
        _sortQty: d.suggestedQty,
        _sortGap: (d.currentTurnover === null ? 0 : (d.currentTurnover - d.targetTurn))
      });
    });
    var pOrder = { P0: 0, P1: 1, P2: 2 };
    actions.sort(function (a, b) {
      var d = pOrder[a.priority] - pOrder[b.priority];
      if (d !== 0) return d;
      if (a.priority === PRIORITY.P0) return b._sortQty - a._sortQty;
      return b._sortGap - a._sortGap;
    });
    actions.forEach(function (a) { delete a._sortQty; delete a._sortGap; });

    var now = src.generatedAt instanceof Date ? src.generatedAt : new Date();
    return {
      meta: {
        tab: tab,
        tabLabel: rpReviewTabLabel(tab, t),
        country: filters.country || '',
        warehouse: filters.warehouse || '',
        brand: filters.brand || '',
        keyword: filters.keyword || '',
        salesStatus: filters.salesStatus || '',
        lifecycleStatus: filters.lifecycleStatus || '',
        generatedAt: now,
        generatedAtText: rpReviewFormatDateTime(now),
        skuTotal: dtos.length
      },
      health: health,
      summary: summary,
      purchase: buckets[CATEGORY.PURCHASE].slice(),
      overstock: buckets[CATEGORY.OVERSTOCK].slice(),
      noSales: buckets[CATEGORY.NO_SALES].slice(),
      blocked: buckets[CATEGORY.BLOCKED].slice(),
      normal: buckets[CATEGORY.NORMAL].slice(),
      actions: actions,
      rows: dtos
    };
  }

  function rpReviewTabLabel(tab, t) {
    t = t || defaultT;
    if (tab === 'online') return t('gen.L3578.2', '线上预测');
    if (tab === 'offline') return t('gen.L3578.3', '线下预测');
    return t('gen.L3578.1', '总预测');
  }

  function rpReviewFormatDateTime(d) {
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 管理摘要：1 句总览 + 2~4 条重点结论（确定性模板）
  function rpReviewBuildSummary(health, buckets, dtos, t) {
    t = t || defaultT;
    // 「高库存」与「Blocked」是两个独立维度（被判高库存的 SKU 大多同时被系统拦截补货），
    // 因此摘要句不把它们写成互斥分区：前四项为分区计数（可加总），Blocked 单列为重叠维度。
    var headline = t('rp.review.summary.headline',
      '当前共 {total} 个 SKU，其中 {purchase} 个需要补货，{overstock} 个库存偏高，{noSales} 个无销量，{normal} 个周转正常；另有 {blocked} 个被系统标记为拦截补货（慢销/呆滞/停采/高库存，与上述分类存在重叠）。',
      {
        total: health.skuTotal,
        purchase: health.purchaseCount,
        overstock: health.overstockCount,
        noSales: health.noSalesCount,
        normal: health.normalCount,
        blocked: health.blockedCount
      });

    var highlights = [];
    if (health.skuTotal === 0) {
      return {
        headline: t('rp.review.summary.empty', '当前筛选条件下没有可复盘的 SKU 数据。'),
        highlights: [t('rp.review.summary.empty_hint', '请调整国家 / 仓库 / 品牌 / SKU 搜索等筛选条件后重新生成报告。')]
      };
    }

    if (health.purchaseCount > 0) {
      highlights.push(t('rp.review.hl.purchase',
        '建议采购 {n} 个 SKU，合计 {qty} 件，需优先安排下单。',
        { n: health.purchaseCount, qty: Math.round(health.purchaseQty) }));
    }
    if (health.overstockCount > 0) {
      var maxGap = null;
      buckets[CATEGORY.OVERSTOCK].forEach(function (d) {
        if (d.currentTurnover === null) return;
        var gap = d.currentTurnover - d.targetTurn;
        if (maxGap === null || gap > maxGap.gap) maxGap = { gap: gap, dto: d };
      });
      if (maxGap && maxGap.dto) {
        highlights.push(t('rp.review.hl.overstock_max',
          '{n} 个 SKU 当前周转高于目标，最高为 {sku}（{cur} 个月 / 目标 {target} 个月），建议暂停补货并优先消化库存。',
          {
            n: health.overstockCount,
            sku: maxGap.dto.sku,
            cur: maxGap.dto.currentTurnover,
            target: maxGap.dto.targetTurn
          }));
      } else {
        highlights.push(t('rp.review.hl.overstock',
          '{n} 个 SKU 被系统判定为高库存/慢销，建议暂停补货并优先消化库存。',
          { n: health.overstockCount }));
      }
      var declining = buckets[CATEGORY.OVERSTOCK].filter(function (d) { return d.trend.trend === TREND.DOWN; });
      if (declining.length > 0) {
        highlights.push(t('rp.review.hl.overstock_declining',
          '其中 {n} 个高库存 SKU 近两月销量下滑，存在积压风险，建议促销或转线下分销。',
          { n: declining.length }));
      }
    }
    if (health.noSalesCount > 0) {
      highlights.push(t('rp.review.hl.no_sales',
        '{n} 个 SKU 无销量，建议核查是否停采 / 是否新品 / 是否缺少销售数据。',
        { n: health.noSalesCount }));
    }
    if (health.blockedCount > 0) {
      highlights.push(t('rp.review.hl.blocked',
        '{n} 个 SKU 被系统拦截补货（慢销/呆滞/停采/清仓等），不建议自动下单；其中 {m} 个同时属于高库存。',
        { n: health.blockedCount, m: health.blockedOverlapCount }));
    }
    if (highlights.length === 0) {
      highlights.push(t('rp.review.hl.all_normal',
        '所有 SKU 周转均在目标范围内，暂无需特别处理，保持按目标周转正常补货。'));
    }
    // 固定输出 2~4 条
    if (highlights.length < 2) {
      highlights.push(t('rp.review.hl.normal_tail',
        '其余 {n} 个 SKU 周转正常，按目标周转正常补货即可。', { n: health.normalCount }));
    }
    return { headline: headline, highlights: highlights.slice(0, 4) };
  }

  // ==================== 复制文本（适合直接发飞书/聊天）====================
  function rpReviewText(report, opts) {
    opts = opts || {};
    var t = opts.t || defaultT;
    var m = report.meta, h = report.health;
    function val(v, fallback) {
      var s = String(v === null || v === undefined ? '' : v).trim();
      return s || fallback;
    }
    var lines = [];
    lines.push('库存周转复盘｜' + [val(m.country, '全部国家'), val(m.brand, '全部品牌')].join(' / '));
    lines.push('预测维度：' + m.tabLabel + '　仓库：' + val(m.warehouse, '全部仓库') + '　生成时间：' + m.generatedAtText);
    lines.push('');
    lines.push('SKU总数：' + h.skuTotal);
    lines.push('目标周转：' + (h.targetTurnover !== null
      ? t('rp.review.months', '{n} 个月', { n: h.targetTurnover })
      : h.targetTurnoverText));
    lines.push('建议采购：' + h.purchaseCount);
    lines.push('高库存：' + h.overstockCount);
    lines.push('慢销/Blocked：' + h.blockedCount);
    lines.push('无销量：' + h.noSalesCount);
    lines.push('');
    lines.push('重点问题：');
    var hl = report.summary.highlights || [];
    if (!hl.length) {
      lines.push('1. ' + t('rp.review.hl.all_normal', '所有 SKU 周转均在目标范围内，暂无需特别处理。'));
    } else {
      hl.forEach(function (x, i) { lines.push((i + 1) + '. ' + x); });
    }
    lines.push('');

    ['P0', 'P1', 'P2'].forEach(function (p) {
      var list = report.actions.filter(function (a) { return a.priority === p; });
      if (!list.length) return;
      lines.push(p + '：');
      list.slice(0, COPY_ACTION_LIMIT_PER_PRIORITY).forEach(function (a) {
        lines.push('* ' + a.sku + '：' + a.issue);
        lines.push('  ' + a.data);
        lines.push('  → ' + a.action);
      });
      if (list.length > COPY_ACTION_LIMIT_PER_PRIORITY) {
        lines.push(t('rp.review.copy.more', '  …另有 {n} 条，详见报告表格',
          { n: list.length - COPY_ACTION_LIMIT_PER_PRIORITY }));
      }
      lines.push('');
    });
    return lines.join('\n').replace(/\n+$/, '\n');
  }

  // ==================== Excel Sheet 模型（与报告同源，数值完全一致）====================
  function rpReviewSheets(report, opts) {
    opts = opts || {};
    var t = opts.t || defaultT;
    var isTotal = report.meta.tab === 'total';
    var sheets = [];

    // 1) Summary
    var summaryRows = [
      [t('rp.review.sheet.summary', '库存周转复盘报告'), ''],
      [t('rp.review.meta.country', '国家'), report.meta.country || t('common.all', '全部')],
      [t('rp.review.meta.warehouse', '仓库'), report.meta.warehouse || t('common.all', '全部')],
      [t('rp.review.meta.brand', '品牌'), report.meta.brand || t('common.all', '全部')],
      [t('rp.review.meta.dim', '预测维度'), report.meta.tabLabel],
      [t('rp.review.meta.generated', '生成时间'), report.meta.generatedAtText],
      [t('rp.review.meta.sku_total', 'SKU 总数'), report.health.skuTotal],
      [t('rp.review.meta.target', '目标周转'), report.health.targetTurnoverText],
      [t('rp.review.health.purchase', '建议采购 SKU 数'), report.health.purchaseCount],
      [t('rp.review.health.purchase_qty', '建议采购数量合计'), Math.round(report.health.purchaseQty)],
      [t('rp.review.health.overstock', '高库存 SKU 数'), report.health.overstockCount],
      [t('rp.review.health.blocked', 'Blocked / 慢销 SKU 数'), report.health.blockedCount],
      [t('rp.review.health.no_sales', '无销量 SKU 数'), report.health.noSalesCount],
      [t('rp.review.health.normal', '正常 SKU 数'), report.health.normalCount],
      [t('rp.review.health.blocked_overlap', '其中：高库存且被拦截补货'), report.health.blockedOverlapCount],
      [t('rp.review.health.overlap_note', '注：Blocked 为独立维度，与「高库存」存在重叠，不可与其余分类直接相加'), ''],
      [],
      [t('rp.review.summary.title', '管理摘要'), ''],
      [report.summary.headline, '']
    ].concat((report.summary.highlights || []).map(function (x, i) {
      return [(i + 1) + '. ' + x, ''];
    }));
    // 多档目标周转时补一份品牌明细
    if (report.health.targetTurnover === null && report.health.targetTurnoverByBrand.length) {
      summaryRows = summaryRows.concat([
        [],
        [t('rp.review.target.by_brand', '目标周转（按品牌）'), ''],
        [t('rp.review.col.brand', 'Brand'), t('rp.review.col.online_turn', '线上目标周转'),
          t('rp.review.col.offline_turn', '线下目标周转'), t('rp.review.col.sku_total', 'SKU 数')]
      ]).concat(report.health.targetTurnoverByBrand.map(function (b) {
        return [b.brand, b.onlineTarget, b.offlineTarget, b.count];
      }));
    }
    sheets.push({
      name: 'Summary',
      headers: [t('rp.review.col.item', '项目'), t('rp.review.col.value', '数值')],
      rows: summaryRows
    });

    // 2) Purchase Suggestions
    var pHeaders = [
      t('rp.review.col.sku', 'SKU'),
      t('rp.review.col.brand', 'Brand'),
      t('rp.review.col.pool', '当前库存池'),
      t('rp.review.col.avg_sales', '月均销量'),
      t('rp.review.col.current_turn', '当前周转'),
      t('rp.review.col.target_turn', '目标周转')
    ];
    if (isTotal) {
      pHeaders.push(t('rp.review.col.online_qty', 'online_suggested_qty'));
      pHeaders.push(t('rp.review.col.offline_qty', 'offline_suggested_qty'));
    }
    pHeaders.push(t('rp.review.col.suggested', '建议采购数量'));
    if (isTotal) pHeaders.push(t('rp.review.col.other_qty', 'other_suggested_qty'));
    pHeaders.push(t('rp.review.col.after_turn', '采购后预计周转'));
    pHeaders.push(t('rp.review.col.judgement', '判断'));
    sheets.push({
      name: 'Purchase Suggestions',
      headers: pHeaders,
      rows: report.purchase.map(function (d) {
        var row = [
          d.sku, d.brand, Math.round(d.pool), Math.round(d.avgSales),
          rpReviewTurnText(d.currentTurnover, t), rpReviewTargetText(d, t)
        ];
        if (isTotal) row.push(Math.round(d.onlineQty), Math.round(d.offlineQty));
        row.push(Math.round(d.suggestedQty));
        if (isTotal) row.push(Math.round(d.otherQty));
        row.push(rpReviewTurnText(d.afterOrderTurnover, t));
        row.push(d.systemSuggestion || '');
        return row;
      })
    });

    // 3) Overstock
    sheets.push({
      name: 'Overstock',
      headers: [
        t('rp.review.col.sku', 'SKU'),
        t('rp.review.col.brand', 'Brand'),
        t('rp.review.col.pool', '当前库存池'),
        t('rp.review.col.avg_sales', '月均销量'),
        t('rp.review.col.current_turn', '当前周转'),
        t('rp.review.col.target_turn', '目标周转'),
        t('rp.review.col.trend', '最近销量趋势'),
        t('rp.review.col.trend_rate', '趋势变化率'),
        t('rp.review.col.sales_status', '动销状态'),
        t('rp.review.col.risk_tags', '风险标签'),
        t('rp.review.col.action', '建议动作')
      ],
      rows: report.overstock.map(function (d) {
        return [
          d.sku, d.brand, Math.round(d.pool), Math.round(d.avgSales),
          rpReviewTurnText(d.currentTurnover, t), rpReviewTargetText(d, t),
          rpReviewTrendLabel(d.trend, t), rpReviewTrendRateText(d.trend),
          d.salesStatus, d.riskTags.join(', '),
          rpReviewOverstockAction(d, t)
        ];
      })
    });

    // 4) No Sales
    sheets.push({
      name: 'No Sales',
      headers: [
        t('rp.review.col.sku', 'SKU'),
        t('rp.review.col.brand', 'Brand'),
        t('rp.review.col.pool', '当前库存池'),
        t('rp.review.col.avg_sales', '月均销量'),
        t('rp.review.col.current_turn', '当前周转'),
        t('rp.review.col.target_turn', '目标周转'),
        t('rp.review.col.sales_status', '动销状态'),
        t('rp.review.col.risk_tags', '风险标签'),
        t('rp.review.col.action', '建议动作')
      ],
      rows: report.noSales.map(function (d) {
        return [
          d.sku, d.brand, Math.round(d.pool), Math.round(d.avgSales),
          NO_SALES_TEXT, rpReviewTargetText(d, t),
          d.salesStatus, d.riskTags.join(', '),
          t('rp.review.action.check_no_sales', '检查是否停采 / 是否新品 / 是否缺少销售数据')
        ];
      })
    });

    // 5) Action List
    sheets.push({
      name: 'Action List',
      headers: [
        t('rp.review.col.priority', '优先级'),
        t('rp.review.col.sku', 'SKU'),
        t('rp.review.col.brand', 'Brand'),
        t('rp.review.col.issue', '问题'),
        t('rp.review.col.data', '核心数据'),
        t('rp.review.col.action', '建议动作')
      ],
      rows: report.actions.map(function (a) {
        return [a.priority, a.sku, a.brand, a.issue, a.data, a.action];
      })
    });

    return sheets;
  }

  var api = {
    // 常量
    TREND_UP_THRESHOLD: TREND_UP_THRESHOLD,
    TREND_DOWN_THRESHOLD: TREND_DOWN_THRESHOLD,
    OVERSTOCK_SEVERE_FACTOR: OVERSTOCK_SEVERE_FACTOR,
    COPY_ACTION_LIMIT_PER_PRIORITY: COPY_ACTION_LIMIT_PER_PRIORITY,
    TREND: TREND,
    CATEGORY: CATEGORY,
    PRIORITY: PRIORITY,
    OVERSTOCK_RISK_TAGS: OVERSTOCK_RISK_TAGS,
    OVERSTOCK_SALES_STATUS: OVERSTOCK_SALES_STATUS,
    STOCKOUT_SALES_STATUS: STOCKOUT_SALES_STATUS,
    SYSTEM_ACTION_REUSE_STATUS: SYSTEM_ACTION_REUSE_STATUS,
    NO_SALES_TEXT: NO_SALES_TEXT,
    // 函数
    parseRiskTags: parseRiskTags,
    rpReviewTrend: rpReviewTrend,
    rpReviewRowContext: rpReviewRowContext,
    rpReviewClassify: rpReviewClassify,
    rpReviewIsOverstock: rpReviewIsOverstock,
    rpReviewOverstockAction: rpReviewOverstockAction,
    rpReviewActionFor: rpReviewActionFor,
    rpReviewTrendLabel: rpReviewTrendLabel,
    rpReviewTrendRateText: rpReviewTrendRateText,
    rpReviewTurnText: rpReviewTurnText,
    rpReviewTargetText: rpReviewTargetText,
    rpReviewTabLabel: rpReviewTabLabel,
    rpReviewBuildReport: rpReviewBuildReport,
    rpReviewText: rpReviewText,
    rpReviewSheets: rpReviewSheets
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RpReviewReport = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
