# Finance Payment Overview / 财务付款总览 V1

## 目标与入口
- 复用原「应付驾驶舱」导航与 `payment_view` 权限；页面升级为「财务付款总览」。
- 页面只读，后台新接口 `GET /api/finance/payment-overview`；旧 `GET /api/finance/payable-cockpit` 保留供兼容，不改付款审批、收款方管理、CI/PI、费用分摊、WAC。
- 页面按单据原币展示，提供国家、费用类别、收款方、币种筛选。先看整体资金压力，再按费用/付款对象及明细穿透原应付单，并导出 Excel。

## 唯一金额来源
- **应付原值** = `payable_items.payable_amount_minor / 100`，涵盖 `active|reserved|partially_paid|paid`，排除 `cancelled`；包含已结清历史事实。
- **现金实际已付** = `payableItemsSettlementBreakdown(itemIDs).paidMinor /100`：已核销 allocation + 仍生效的旧款日志按原 SSOT 分摊；不可把 `payment_requests.paid_amount` 简单求和。
- **非现金结算** = `deductionMinor`（抵扣） + `roundingMinor`（抹零），两个分项必须展示。
- **未结** = `max(0,应付-现金已付-抵扣-抹零)`；若状态 paid 但余额不为零，标记待对账，不能凭状态虚构付款。
- **已到期应付** = 真实有效 `payable_date <= today` 的应付原值，包含历史已经结清的应付。
- **逾期未付** = 真实有效 `payable_date < today` 且还有未结余额。**今天到期**单独列示。
- 未来 7/30 天均不含当天（未来 30 天包含未来 7 天），这些指标重叠时不可相加。
- 空 `payable_date` 的未结金额单独列为“无到期日未结”，绝不误判逾期。
- **PI录入货值** 取 `proforma_invoices.total_amount` 按 supplier ID 汇总，单独展示并导出，**不加到应付**。PO 总额当前为零；历史 CI 与 PI 的归属和去重关系没有充分确认前，不能把 CI 加进 PI 或断言 PI=全历史采购。
- 所有金额按币种单独汇总，禁止 RMB + IDR 等无汇率裸相加。

## 真实数据预审（2026-10-19）
- 已有应付台账 40 条：RMB 39 条原值 5,886,885.27；IDR 1 条原值 950,000。含 22 条生命周期为 paid 的历史应付。
- PI 22 张、总原币货值 RMB 5,890,995.88（仅现存 PI 范围）。
- 未结生命周期中有 3 条无到期日：RMB 2、IDR 1。之前对 payable_date 直接字符串比较时将空日期误判为小于今天；修复口径仅有效 YYYY-MM-DD。
- 有效到期日且过去到期的未结项目 10 条 RMB，应付原值 2,944,532.57，实际逾期未付需用付款事实计算、不能拿原值替代。
- 底层类别目前仅登记货款和物流/到仓；关税/商检/其他类别若将来以 `payable_items` 正式入账，自动纳入分类，不虚构尚未录入的费用。

## 性能、权限与数据完整性
- 单独 read-only API：付款权限 `payment_view`；仅查询 `payable_items`、PI及来源国，不使用其他财务表的状态推算已付。
- 使用原结算 SSOT，按每批 250 个 payable item 分批读取，避免 N+1。
- 前端收到整张台账后筛选重算，无重复 GET、无滚动监听与克隆表格；原生 sticky 表头。
- 后端 `Cache-Control: private, no-store`；前端页面切换受 _cockpitLoadSeq/currentPage 保护，旧异步不得写已销毁 DOM。
- 结算事实矛盾（paid 状态无事实、超额核销、非法金额）发出对账提醒，金额仍以交易事实为准，不静默修账。
- 原生 Excel 导出：费用分类 / 付款对象 / 应付明细 / PI采购；受页面当前筛选约束。
- 验证 `gross = paid + deduction + rounding + outstanding`（无矛盾时）以及每币种按收款方、费用类和明细金额一致。

## 暂不做
- 历史 CI 与 PI 关系不清时不生成含历史 CI 的“全历史采购金额”；页面有范围说明。
- 不更改未进入应付台账的费用，不生成新付款请求，不改审批与付款交易。
- 不把过去已付的现金从 `paid` 生命周期状态“倒算”出来，也不把抵扣当成现金。
- 多语言完整 UI 文案后续可再优化，避免扩大本次账务口径改造的风险。
