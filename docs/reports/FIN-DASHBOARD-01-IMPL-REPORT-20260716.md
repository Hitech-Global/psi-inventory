# FIN-DASHBOARD-01 实施报告（财务应付驾驶舱）

- 日期：2026-07-16
- 范围：财务应付驾驶舱（只读聚合看板）
- 结论：**在不新增业务规则、不修改数据库结构、不触碰已冻结付款/审批/抵扣/冲销/汇率/WAC 链路的前提下完成实施**，隔离测试 + 回归通过。默认工作库全程未触碰。

---

## 1. 目标与页面范围

按任务定义交付三段式应付驾驶舱：

- **A 顶部核心指标**（按币种分组）：总应付 / 已结清 / 未结清 / 7天内到期 / 30天内到期 / 已逾期金额 / 逾期笔数 / 无到期日(未结清)。
- **B 按供应商应付总览**（可下钻）：供应商 / 币种 / 总应付 / 已结清 / 未结清 / 即将到期(30天) / 已逾期 / 最早到期日 / 未结笔数。
- **C 应付明细**：付款申请编号 / 供应商 / 来源类型 / 关联PI·CI / 费用类型 / 付款主体 / 币种 / 应付 / 已核销 / 未结清 / 到期日 / 逾期天数 / 状态。
- 附加：**按费用类型汇总**（费用类型 × 币种）。

## 2. 只读审计发现（关键事实）

- **应付唯一实体** = `payment_requests`（48 条，排除 rejected/cancelled 后 46 条：USD 44 / RMB 2）。
- **费用类型** = `payment_category`：货款 goods（定金14/尾款11）、关税 customs_duty(7)、商检 inspection_fee(7)、到仓 warehouse_arrival(9)。
- **付款主体** = `payee_type`：factory / customs / inspection_org / service_provider。
- **到期日底层缺口**：全部 `payable_date` 为空；关联 CI 的 `actual_ship_date=''`、`credit_days=0`（出货日/账期未录入）。
- **汇率缺口**：货款类确认付款时不锁定本币/RMB 汇率快照（`local_amount`/`rmb_amount` 恒 0），`exchange_rates` 无 USD→RMB 记录。
- **供应商无外键**：`payment_requests.supplier_name` 为冗余文本快照，无 `supplier_id` 外键。

## 3. 冻结口径对照核查（12 条，全部遵守）

| 冻结口径 | 落实方式 |
|---|---|
| payment_requests 是唯一应付实体 | 端点只读该表，无其它应付来源 |
| approve≠已付、confirm-paid 才形成实际付款 | 复用 `paymentSettlementFacts`，已结清=有效付款+抵扣+抹零（仅 status=applied） |
| 支持部分付款/抵扣/冲销/legacy | 全部由冻结的 `paymentSettlementFacts` 承担，未旁路 |
| 未结清用完整 payable outstanding 口径 | `outstanding = 应付 − 有效付款 − 有效抵扣 − 有效抹零`，与落库 `unpaid_amount` 精确一致 |
| 到期日=CI实际出货日+Credit天数 | 读持久化 `payable_date`（建单时由 `computePayableDate` 写入），**不再造** |
| 运营/历史 CI 均用实际出货日 | 到期日来源统一为持久化 payable_date，不区分口径 |
| 历史 CI 只进财务维度 | 端点仅聚合财务应付，明细标注"(历史)"，不碰库存/销售/预测 |
| 金额两位小数 | 服务端 `settlementMoney` + 前端 `fmtMoney` 两位 |
| 本币/RMB 用现有汇率快照 | 直接读 `local_amount`/`rmb_amount`，货款类为 0 时如实展示，**不臆造折算** |
| WAC 与应付不混 | 端点完全不读 WAC / cost_allocations |
| 供应商"总览+明细下钻" | B 段总览 + "下钻"按钮过滤 C 段明细 |
| 多币种不裸加 | 顶部指标 / 供应商 / 费用类型全部按币种独立分组 |

## 4. 最小实施方案（未新增规则、未改结构、未碰付款链）

- **后端**：新增**只读**端点 `GET /api/finance/payable-cockpit`（`requireApiPermission('payment_view')`）。逐条调用已冻结的 `paymentSettlementFacts` / `derivePaymentStatus`，读持久化 `payable_date` 做账龄分桶，按币种 + 供应商 + 费用类型聚合。**无任何写操作、无 SQL DDL、无迁移**。
- **前端**：财务模块新增"应付驾驶舱"页，`showPage` 路由 + 渲染函数；明细行点击复用既有 `viewPayment(id)` 弹窗下钻。

## 5. 实际修改文件（本轮）

- `server.js`：新增 `GET /api/finance/payable-cockpit` 只读端点 + 4 个纯展示标签常量（`PAYABLE_CATEGORY/SUBCAT/PAYEE/STATUS_LABELS`）。
- `app.js`：`NAV_MODULES.finance` 增加 `payable-cockpit` 项；`titles` 与 `R` 路由映射登记；新增 `renderPayableCockpit / renderCockpitView / renderCockpitDetails / cockpitDrill / cockpitCard / cockpitStatusBadge` 渲染函数。
- （说明：`.workbuddy/memory/*` 日志本轮追加，属项目记忆文件，被 .gitignore 忽略，一并如实列出。）
- 未改：`db.js`、`index.html`（其现存 diff 为此前会话遗留未提交改动，非本轮产生）。

## 6. 隔离测试结果（一次性副本，跑后即删）

- **口径一致性**（隔离副本 `data/L2-INTEGRATION/inventory.db`）：
  - USD：总应付 31285、已结清 6134、未结清 25151；RMB：143.52 / 23.52 / 120。
  - 恒等式 `总应付 − 已结清 = 未结清` 双币种成立；`未结清` 与落库 `SUM(unpaid_amount)` 精确吻合（USD 25151、RMB 120）。
- **账龄分桶**（一次性副本注入 3 条不同到期日，测试后删除）：
  - 逾期 3850（1 笔，逾期天数=10，与注入 -10 天精确一致）；
  - 7天内到期 1650；30天内到期 3300（累计含 7 天窗口）；
  - 无到期日(未结清) 18001 = 25151 − 3850 − 1650 − 1650；未结清总额不变 25151。
- 说明：临时测试库/脚本已删除，未保留于根目录（符合项目"一次性测试后删除"约定）。

## 7. 回归结果

隔离主服务（3001，DB_PATH→隔离副本）验证既有端点未受影响：

| 端点 | HTTP |
|---|---|
| GET /api/dashboard | 200 |
| GET /api/payment-requests | 200 |
| GET /api/payment-requests?status=paid | 200 |
| GET /api/finance/payable-cockpit（新） | 200 |

- `server.js` / `app.js` `node --check` 语法均通过。

## 8. 真实数据口径核对（当前隔离副本）

- 所有 `payable_date` 为空 → 全部未结清进入"无到期日"桶，7天/30天/逾期均为 0——这是**底层出货日/账期未录入**的如实结果，非看板缺陷。录入 CI 实际出货日 + Credit 天数后，`payable_date` 由既有 `computePayableDate` 自动写入，看板账龄桶即自动生效（已用注入场景验证）。
- 货款类 `rmb_amount`/`local_amount` 为 0 → 看板按币种独立展示，不做跨币种 RMB 折算合并。

## 9. 已知限制、未纳入项与保护范围确认

- **已知限制**（均为底层数据/既有规则约束，非看板问题，不在本任务修复范围）：
  1. 到期日依赖 CI 实际出货日 + Credit 天数录入，未录入则归"无到期日"。
  2. 货款类无锁定本币/RMB 汇率，看板不提供货款 RMB 折算总额。
  3. 供应商聚合以 `supplier_name` 文本为键（无 supplier_id 外键）。
- **未纳入**（遵任务边界）：飞书提醒 / AI 报告 / 会计总账 / 凭证 / 应收 / 现金流预测 / 新汇率规则 / 新 WAC / 系统管理优化 / 订单预测改版 / 云端部署。
- **保护范围确认（未触碰）**：PO→PI→CI→PL→Inbound、P1-PAY、抵扣/冲销/部分付款/尾款防重、汇率快照、WAC、历史 CI 隔离、飞书 OAuth/Session/Cookie/CSRF/RBAC、订单预测结构、默认工作库（未迁移、未写入）、稳定页面接口。

## 10. 下一步建议（供确认，未自行执行）

- 若需真正跑通到期日/账龄，需要另行任务录入 CI 实际出货日 + Credit 天数（属数据录入，不属本看板）。
- 若财务需要货款 RMB 折算总额，需先按已冻结汇率决策补充货款类汇率来源（属汇率核心，须单独授权）。
