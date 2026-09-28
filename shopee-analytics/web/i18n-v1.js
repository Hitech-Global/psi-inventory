'use strict';

(() => {
  const STORAGE_KEY = 'shopee-analytics-locale';
  const SUPPORTED = new Set(['zh', 'en']);
  const requested = localStorage.getItem(STORAGE_KEY);
  const locale = SUPPORTED.has(requested) ? requested : 'zh';
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';

  const EXACT = new Map([
    ['Shopee 运营分析', 'Shopee Operations Analytics'],
    ['国家 × 品牌 × 店铺统一管理；先看经营，再下钻广告组与 SKU。', 'Country × Brand × Shop management; start with business performance, then drill down to ads and SKUs.'],
    ['检查数据源…', 'Checking data sources…'],
    ['经营总览', 'Business Overview'],
    ['店铺诊断', 'Shop Diagnosis'],
    ['广告诊断', 'Ads Diagnosis'],
    ['数据状态', 'Data Health'],
    ['国家', 'Country'], ['全部国家', 'All Countries'],
    ['品牌', 'Brand'], ['全部品牌', 'All Brands'],
    ['店铺', 'Shop'], ['全部店铺', 'All Shops'],
    ['开始日期', 'Start Date'], ['结束日期', 'End Date'],
    ['读取分析', 'Load Analysis'], ['刷新全部', 'Refresh All'], ['刷新单店', 'Refresh Shop'],
    ['等待数据。', 'Waiting for data.'], ['等待数据', 'Waiting for data'], ['等待', 'Waiting'],
    ['正在读取店铺配置…', 'Loading shop configuration…'], ['读取店铺状态中…', 'Loading shop status…'],
    ['经营变化诊断', 'Business Change Diagnosis'],
    ['与上一等长周期比较；这里显示经营信号，不把相关变化直接当作因果。', 'Compared with the previous equal-length period; signals show correlated changes, not assumed causation.'],
    ['国家 × 品牌汇总', 'Country × Brand Summary'],
    ['先看业务板块，再下钻到具体店铺。金额仍按当地币种展示。', 'Review business segments first, then drill down to shops. Monetary values remain in local currency.'],
    ['店铺经营矩阵', 'Shop Performance Matrix'],
    ['按国家、品牌和店铺比较；跨币种金额不会直接相加。', 'Compare by country, brand and shop; amounts in different currencies are not summed directly.'],
    ['币种', 'Currency'], ['销售额', 'Sales'], ['销售变化', 'Sales Change'], ['订单', 'Orders'],
    ['广告占比', 'Ad Spend Ratio'], ['销售金额占比', 'GMV Share'], ['退款金额', 'Refund Amount'],
    ['主要信号', 'Primary Signal'], ['退货/退款', 'Returns / Refunds'],
    ['销售额变化', 'Sales Change'], ['商品点击变化', 'Product Click Change'], ['点击→订单', 'Click → Order'],
    ['客单价变化', 'AOV Change'], ['估算非广告归因销售变化', 'Estimated Non-Ad Sales Change'], ['广告GMV变化', 'Ad GMV Change'],
    ['店铺诊断需要选择单个店铺', 'Shop Diagnosis requires one shop'],
    ['先按国家/品牌筛选，再选择具体店铺。', 'Filter by country/brand first, then select a shop.'],
    ['店铺经营诊断', 'Shop Performance Diagnosis'], ['与上一等长周期比较。', 'Compared with the previous equal-length period.'],
    ['每日经营趋势', 'Daily Business Trend'],
    ['双日和每月25日单独标记，避免把活动日直接当普通日基线。', 'Double-day campaigns and the 25th are flagged separately so event days are not treated as ordinary-day baselines.'],
    ['日期', 'Date'], ['事件', 'Event'], ['商品点击', 'Product Clicks'], ['客单价', 'AOV'],
    ['估算非广告归因销售', 'Estimated Non-Ad Sales'], ['商品经营矩阵', 'Product Performance Matrix'],
    ['商品总表现 × 广告表现；有 Product Card 时会补充总 CVR / 加购率。', 'Product performance × ad performance; Product Card adds total CVR / Add To Cart Rate when available.'],
    ['商品', 'Product'], ['总销售额', 'Total Sales'], ['总订单', 'Total Orders'], ['商品总转化率', 'Total Product Conversion Rate'],
    ['直接销售金额占比', 'Direct GMV Share'], ['保本ROAS', 'Break-even ROAS'], ['估算非直接归因销售', 'Estimated Non-Direct Sales'], ['商品信号', 'Product Signal'],
  ]);
  [
    ['广告诊断需要选择单个店铺', 'Ads Diagnosis requires one shop'],
    ['国家/品牌可以先筛选，再从“店铺”选择具体店铺。', 'Filter by country/brand first, then select a specific shop.'],
    ['单品广告', 'Single Product Ad'], ['广告组', 'Ad Group'], ['全店推', 'Shop GMV Max'],
    ['广告 Campaign', 'Ad Campaign'], ['按花费排序；点击查看所选周期诊断。', 'Sorted by Expense; click to view diagnosis for the selected period.'],
    ['广告组诊断', 'Ad Group Diagnosis'], ['选择左侧 Campaign。', 'Select a Campaign on the left.'],
    ['还没有选择 Campaign', 'No Campaign selected'],
    ['系统会按订单量 → ROAS → Funnel → SKU结构 → Action 分析。', 'The system analyzes Orders → ROAS → Funnel → SKU Structure → Action.'],
    ['Campaign 明细', 'Campaign Details'], ['单品广告 · Shopee API', 'Single Product Ad · Shopee API'],
    ['全店推 · Shopee API', 'Shop GMV Max · Shopee API'],
    ['广告组明细', 'Ad Group Details'],
    ['Shopee Ad Group 导出字段顺序 · 数据日期 / 商品数为系统补充', 'Shopee Ad Group export column order · Data Date / Product Count are system-added'],
    ['批量导入', 'Batch Import'], ['关闭', 'Close'],
    ['批量导入广告组', 'Batch Import Ad Groups'],
    ['先 preview 全部文件；只有全部通过正式范围校验后才可确认。', 'Preview all files first; confirmation is enabled only after every file passes formal scope validation.'],
    ['拖拽或选择 CSV / XLSX 文件', 'Drag or select CSV / XLSX files'],
    ['Preview 全部文件', 'Preview All Files'], ['确认批量导入', 'Confirm Batch Import'], ['继续导入未完成文件', 'Resume Unfinished Imports'],
    ['尚未选择文件。Preview 不会写入数据。', 'No files selected. Preview does not write data.'],
    ['注册新店铺 · Manual Import Only', 'Register New Shop · Manual Import Only'],
    ['注册店铺并继续', 'Register Shop and Continue'],
    ['全部店铺数据状态', 'All Shop Data Health'],
    ['先看哪个国家 / 品牌 / 店铺出现同步或 Token 异常，再下钻单店详情。', 'Identify sync or token issues by country / brand / shop, then drill into shop details.'],
    ['最后同步', 'Last Sync'], ['错误', 'Errors'], ['提醒', 'Warnings'],
    ['检查 API 同步、新鲜度与 Token 状态。', 'Check API sync, freshness and token status.'],
    ['历史数据完整度', 'History Coverage'], ['未配置起始日期', 'Start date not configured'],
    ['每日明细', 'Daily Details'], ['店铺级 Product Ads 汇总 · 环比上一日', 'Shop-level Product Ads summary · vs previous day'],
    ['等待店铺', 'Waiting for shop'], ['暂无API汇总', 'No API summary'],
    ['请选择单个店铺与日期范围。', 'Select one shop and a date range.'],
    ['当前周期暂无 Product Card 店铺级汇总。', 'No shop-level Product Card summary for the current period.'],
    ['选择店铺后读取 Product Card 总览。', 'Select a shop to load the Product Card overview.'],
    ['商品广告总览与下钻', 'Product Ads overview and drill-down'],
    ['总览', 'Overview'], ['商品明细', 'Product Details'], ['下一步', 'Next Step'],
    ['继续观察。', 'Continue observing.'], ['正在读取 Campaign 明细...', 'Loading Campaign details...'],
    ['单品广告明细', 'Single Product Ad Details'], ['广告明细', 'Ad Details'], ['关闭明细', 'Close details'],
  ].forEach(([zh, en]) => EXACT.set(zh, en));
  [
    ['下一步动作', 'Next Actions'],
    ['按利润约束、订单量和 SKU 结构生成；作为验证动作，不替代人工决策。', 'Generated from profit constraints, order volume and SKU structure; use as validation actions, not as a replacement for human decisions.'],
    ['普通日 BASELINE', 'Ordinary Day BASELINE'], ['双日 / 25日 EVENT', 'Double Day / 25th EVENT'],
    ['SKU 赛马', 'SKU Competition'],
    ['Direct 指标优先判断商品自身；Broad 用于看广告组整体贡献。', 'Use Direct metrics to judge the product itself first; Broad reflects overall ad contribution.'],
    ['状态', 'Status'], ['内部A/B/C', 'Internal A/B/C'], ['放大资格', 'Scale Eligibility'],
    ['最低可接受ROAS', 'Minimum Acceptable ROAS'], ['花费占比', 'Expense Share'], ['平台预估ROAS', 'Platform Estimated ROAS'],
    ['SKU 时间线', 'SKU Timeline'],
    ['点击上面的 SKU，查看 Voucher / Discount / 退款 / 平台预估 ROAS / 操作记录。', 'Click a SKU above to view Voucher / Discount / Refund / Platform Estimated ROAS / operation history.'],
    ['选择一个 SKU 查看时间线。', 'Select a SKU to view the timeline.'],
    ['等待成熟度证据。', 'Waiting for maturity evidence.'],
    ['目标达成', 'Target Met'], ['盈利但低于目标', 'Profitable but Below Target'], ['低于保本', 'Below Break-even'],
    ['盈利但广告占比超限', 'Profitable but Over Ad Spend Limit'], ['目标未设置', 'Target Not Set'],
    ['广告占比正常', 'Ad Spend Ratio Within Limit'], ['广告占比超限', 'Ad Spend Ratio Over Limit'],
    ['暂无归因GMV', 'No Attributed GMV'], ['订单参考量达标', 'Order Reference Met'], ['订单量不足', 'Low Order Volume'],
    ['主力候选', 'Core Candidate'], ['保留探索', 'Keep Exploring'], ['探索样本不足', 'Insufficient Exploration Sample'],
    ['高风险空烧', 'High-risk Spend with Zero Orders'], ['商品优化候选', 'Product Optimization Candidate'],
    ['零订单继续测试', 'Continue Testing with Zero Orders'], ['零订单 / 缺少AOV', 'Zero Orders / Missing AOV'],
    ['继续观察', 'Continue Observing'], ['学习期', 'Learning'], ['收敛观察期', 'Converging'], ['稳定期', 'Stable'], ['长期未稳定', 'Long-term Unstable'],
    ['普通日', 'Ordinary Day'], ['双日', 'Double Day'], ['25日', '25th'],
    ['暂无经营变化信号。', 'No business change signals.'],
    ['等待周期对比数据。', 'Waiting for period comparison data.'],
    ['当前筛选没有国家 × 品牌汇总数据。', 'No Country × Brand summary data for the current filters.'],
    ['这个周期没有每日店铺数据。', 'No daily shop data for this period.'],
    ['当前周期没有商品层数据。', 'No product-level data for the current period.'],
    ['当前周期暂无广告组数据。', 'No Ad Group data for the current period.'],
    ['这个广告组没有保存商品层明细。', 'No saved product-level details for this Ad Group.'],
    ['当前周期没有 GMS 商品层表现。', 'No GMS product-level performance for the current period.'],
    ['当前周期没有全店推 Campaign 数据。', 'No Shop GMV Max Campaign data for the current period.'],
    ['当前周期没有可展示的全店推商品表现。', 'No Shop GMV Max product performance available for display.'],
    ['全店推商品明细暂时读取失败。', 'Shop GMV Max product details could not be loaded.'],
  ].forEach(([zh, en]) => EXACT.set(zh, en));
  [
    ['只读分析服务正常', 'Read-only analytics service healthy'], ['分析服务不可用', 'Analytics service unavailable'],
    ['从未', 'Never'], ['未知', 'Unknown'], ['最新', 'Fresh'], ['待刷新', 'Refresh Due'], ['已过期', 'Stale'], ['无数据', 'No Data'],
    ['未配置', 'Not Configured'], ['正常', 'Healthy'], ['失败', 'Failed'], ['未确认', 'Unconfirmed'], ['需处理', 'Action Needed'],
    ['店铺数', 'Shops'], ['总订单', 'Total Orders'], ['总销量', 'Total Units Sold'], ['退货/退款单', 'Returns / Refunds'],
    ['来自 Shop BI', 'From Shop BI'], ['广告归因', 'Ad-attributed'], ['退款', 'Refund'],
    ['所选范围没有金额数据。', 'No monetary data for the selected scope.'],
    ['当前筛选没有店铺诊断数据。', 'No shop diagnosis data for the current filters.'], ['当前筛选没有店铺数据。', 'No shop data for the current filters.'],
    ['当前为单一币种，可直接比较金额与广告效率。', 'The current scope uses one currency, so amounts and ad efficiency are directly comparable.'],
    ['当前包含多个币种：金额按币种分别汇总，不直接做跨币种 GMV / ROAS 合计。', 'Multiple currencies are present: amounts are summarized by currency and cross-currency GMV / ROAS are not combined.'],
    ['未配置', 'Not Configured'], ['暂无经营变化信号。', 'No business change signals.'],
    ['有花费无订单', 'Spend with No Orders'], ['低于Target', 'Below Target'], ['订单样本较充分', 'Order Sample Sufficient'], ['继续积累样本', 'Keep Building Sample'],
    ['关联商品', 'Linked Product'], ['当前自动选品', 'Current Auto-selected Products'], ['无Target', 'No Target'],
    ['仅真实Membership', 'Real Membership Only'], ['不假设永远只有1个', 'Does not assume only one product'],
    ['当前没有可用的真实 Membership 快照；系统不会用广告表现反推自动选品。', 'No real Membership snapshot is available; the system does not infer auto-selected products from ad performance.'],
    ['读取中', 'Loading'], ['读取失败', 'Load Failed'], ['错误', 'Error'],
    ['当前没有结构性动作，继续观察完整周期。', 'No structural action now; continue observing a full period.'],
    ['最近结构性操作未触发冷却阻断。', 'Recent structural changes did not trigger a cooldown block.'],
    ['数据覆盖未发现明显异常。', 'No obvious data-coverage issue detected.'],
    ['没有商品层数据。', 'No product-level data.'], ['这个周期没有已记录的运营事件。', 'No recorded operational events in this period.'],
    ['加入广告组', 'Added to Ad Group'], ['移出广告组', 'Removed from Ad Group'],
    ['正常店铺', 'Healthy Shops'], ['异常店铺', 'Shops with Issues'], ['提醒数量', 'Warnings'], ['覆盖国家', 'Countries Covered'], ['最近NAS备份', 'Latest NAS Backup'],
    ['恢复验证尚未记录', 'Restore verification not recorded'], ['同步链路无严重错误；仍请关注单个数据源的新鲜度。', 'No critical sync-chain errors; continue monitoring individual source freshness.'],
    ['发现需要处理的数据连接问题，诊断结论可能不完整。', 'Data connection issues require attention; diagnosis may be incomplete.'],
  ].forEach(([zh, en]) => EXACT.set(zh, en));

  [
    ['1 直接转化', '1 Direct Conversions'], ['2 ROAS/盈亏', '2 ROAS / Profitability'], ['3 SKU分配', '3 SKU Allocation'],
    ['4 CTR/CVR', '4 CTR/CVR'], ['5 Signal×Confidence', '5 Signal × Confidence'], ['6 Action', '6 Action'],
    ['当前阶段', 'Current Stage'], ['稳定证据', 'Stability Evidence'], ['SKU花费日均变动', 'Avg Daily SKU Spend Change'],
    ['直接转化样本', 'Direct Conversion Sample'], ['SKU花费分配', 'SKU Spend Allocation'], ['订单来源持续性', 'Order Source Continuity'],
    ['CVR稳定性', 'CVR Stability'], ['ROAS稳定性', 'ROAS Stability'], ['扩量承接', 'Scale Absorption'],
    ['当前卡点', 'Current Blockers'], ['已形成证据', 'Evidence Established'], ['暂无主要稳定性卡点', 'No major stability blocker'], ['继续累计数据', 'Keep accumulating data'],
    ['连续主力 SKU', 'Continuous Core SKU'], ['主力连续率', 'Core Continuity'], ['扩量 CVR 保持', 'Scale CVR Retention'], ['扩量 ROAS 保持', 'Scale ROAS Retention'],
    ['商品层花费覆盖', 'Product-level Spend Coverage'], ['成员 Performance 覆盖', 'Member Performance Coverage'], ['广告组成员', 'Ad Group Members'], ['有表现商品', 'Products with Performance'],
    ['STRUCTURAL ACTION GATES · 结构性动作前置条件', 'STRUCTURAL ACTION GATES · Preconditions'], ['允许受控验证', 'Controlled Validation Allowed'], ['当前阻断', 'Currently Blocked'],
    ['操作观察期', 'Operation Observation Period'], ['可受控验证', 'Controlled Validation'], ['暂不放大', 'Do Not Scale Yet'],
    ['商品自身保本ROAS；0表示尚未配置', 'Product break-even ROAS; 0 means not configured'],
    ['内部分析模型，不是 Shopee 官方字段', 'Internal analysis model, not an official Shopee field'],
    ['Signal 与 Confidence 分开；高ROAS小样本不会自动成为主力', 'Signal and Confidence are separate; high ROAS with a small sample does not automatically become a core SKU'],
    ['用于观察广告商品自身', 'Used to assess the advertised product itself'], ['预算利用率', 'Budget Utilization'], ['未读取日预算', 'Daily budget unavailable'],
    ['MATURITY · 成熟度判断', 'MATURITY · Maturity Assessment'], ['已满足', 'Met'], ['未满足', 'Not Met'], ['待更多数据', 'More Data Needed'],
    ['7天仅为最低观察窗口；25 Direct Orders 为内部成熟度参考，不是 Shopee 官方“学习完成”规则。', '7 days is only the minimum observation window; 25 Direct Orders is an internal maturity reference, not an official Shopee learning-completion rule.'],
    ['国家 *（例如 MY）', 'Country * (e.g. MY)'], ['品牌 *', 'Brand *'], ['内部显示名称（可选）', 'Internal Display Name (Optional)'],
  ].forEach(([zh, en]) => EXACT.set(zh, en));

  const PATTERNS = [
    [/^(\d+) 需关注$/, '$1 need attention'],
    [/^(\d+) 组$/, '$1 groups'], [/^(\d+) 店$/, '$1 shops'], [/^(\d+) 商品$/, '$1 products'], [/^(\d+) 天$/, '$1 days'],
    [/^(\d+) 个$/, '$1'], [/^(\d+) SKU$/, '$1 SKU'],
    [/^较上期 (.+)$/, 'vs previous $1'], [/^环比 (.+)$/, 'vs previous $1'],
    [/^当前 (.+) → (.+)，对比上一等长周期 (.+) → (.+)。$/, 'Current $1 → $2; previous equal-length period $3 → $4.'],
    [/^Seller Centre 覆盖 (\d+)\/(\d+) 天$/, 'Seller Centre coverage $1/$2 days'],
    [/^当前周期没有单品广告数据。$/, 'No Single Product Ad data for the current period.'],
    [/^当前周期没有全店推数据。$/, 'No Shop GMV Max data for the current period.'],
    [/^(.+) · 环比上一周期 · (\d+) 商品$/, '$1 · vs previous period · $2 products'],
    [/^(\d{4}-\d{2}-\d{2}) · (\d+) 商品 · 环比上一周期$/, '$1 · $2 products · vs previous period'],
    [/^全店推 · GMS Item Performance · 环比上一周期 · (\d+) 商品$/, 'Shop GMV Max · GMS Item Performance · vs previous period · $1 products'],
    [/^Campaign #(\d+) · 正在读取$/, 'Campaign #$1 · Loading'],
    [/^最新数据：(.+)$/, 'Latest data: $1'], [/^同步：(.+)$/, 'Synced: $1'], [/^过期：(.+)$/, 'Expires: $1'], [/^上次刷新：(.+)$/, 'Last refresh: $1'],
    [/^最近成功：(.+)$/, 'Latest success: $1'], [/^最近失败：(.+)$/, 'Latest failure: $1'],
    [/^恢复验证 (.+)$/, 'Restore verified $1'], [/^日预算 (.+) \/ 日均花费 (.+)$/, 'Daily budget $1 / Avg daily spend $2'],
    [/^周等效 (.+)$/, 'Weekly equivalent $1'], [/^门槛 (.+)$/, 'Threshold $1'],
    [/^当前自动选品范围 · (\d+) 个商品$/, 'Current auto-selected scope · $1 products'],
    [/^当前 (\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})，对比上一等长周期 (\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})。经营信号用于定位下钻方向，不直接视为因果结论。$/, 'Current $1 → $2; previous equal-length period $3 → $4. Business signals guide drill-down and are not treated as causal conclusions.'],
    [/^已匹配当前周期 Product Card；店内总CVR中位数 (.+)，(\d+) 个商品需优先关注。$/, 'Product Card matched for the current period; shop median total CVR $1, $2 products need priority attention.'],
    [/^当前周期没有精确匹配的 Product Card；先显示 API 广告数据，(\d+) 个商品出现广告侧风险信号。$/, 'No exact Product Card match for the current period; API ad data is shown first, with $1 products showing ad-side risk signals.'],
  ];

  function translateCore(text) {
    if (locale !== 'en') return text;
    if (EXACT.has(text)) return EXACT.get(text);
    for (const [pattern, replacement] of PATTERNS) {
      if (pattern.test(text)) return text.replace(pattern, replacement);
    }
    return text;
  }

  function translateTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,[data-i18n-skip]')) return;
    const raw = node.nodeValue || '';
    const core = raw.trim();
    if (!core) return;
    const translated = translateCore(core);
    if (translated === core) return;
    const start = raw.slice(0, raw.indexOf(core));
    const end = raw.slice(raw.indexOf(core) + core.length);
    node.nodeValue = `${start}${translated}${end}`;
  }

  function translateElementAttributes(element) {
    if (!(element instanceof Element) || element.matches('[data-i18n-skip]')) return;
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const translated = translateCore(value.trim());
      if (translated !== value.trim()) element.setAttribute(attr, translated);
    }
  }
  function translateTree(root = document) {
    if (locale !== 'en' || !root) return;
    if (root.nodeType === Node.TEXT_NODE) translateTextNode(root);
    if (root.nodeType === Node.ELEMENT_NODE) translateElementAttributes(root);
    const scope = root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
    if (!scope?.querySelectorAll) return;
    scope.querySelectorAll('*').forEach(translateElementAttributes);
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) translateTextNode(walker.currentNode);
    window.ShopeeMetricLabels?.apply?.(scope);
  }

  function setLocale(next) {
    if (!SUPPORTED.has(next)) return;
    localStorage.setItem(STORAGE_KEY, next);
    window.location.reload();
  }

  function mountToggle() {
    const host = document.getElementById('languageSwitch');
    if (!host) return;
    host.querySelectorAll('[data-locale]').forEach(button => {
      const value = button.getAttribute('data-locale');
      button.classList.toggle('active', value === locale);
      button.setAttribute('aria-pressed', value === locale ? 'true' : 'false');
      button.addEventListener('click', () => {
        if (value !== locale) setLocale(value);
      });
    });
  }

  const api = Object.freeze({
    locale: () => locale,
    isEnglish: () => locale === 'en',
    translate: translateCore,
    apply: translateTree,
    setLocale,
  });
  window.ShopeeI18n = api;

  function boot() {
    if (locale === 'en') document.title = 'Shopee Operations Analytics';
    mountToggle();
    translateTree(document);
    if (locale === 'en') {
      const observer = new MutationObserver(records => {
        records.forEach(record => {
          if (record.type === 'characterData') translateTextNode(record.target);
          record.addedNodes.forEach(translateTree);
        });
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
