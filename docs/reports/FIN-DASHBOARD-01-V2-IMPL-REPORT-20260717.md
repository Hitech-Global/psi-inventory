# FIN-DASHBOARD-01-V2 · 展示优化实施报告

> 日期：2026-07-17 ｜ 状态：**已实施 + 隔离测试通过，等待用户真实验收**
> 前置：V1 数据口径已验收通过；V2 仅调整展示层，不触任何冻结项。

---

## 一、架构调整确认（用户 2026-07-17）

**取消**：供应商风险排序、风险评分、AI 风险标签、财务风险模型。
**保留**：简单基础状态（已逾期 / 即将到期 / 无到期日 / 正常）。
**定位**：清楚展示当前应付款、帮助采购/运营安排付款、快速查看供应商/费用类型/付款状态、为后续飞书应付提醒提供数据基础——非财务分析系统、非 CFO 驾驶舱。

## 二、实施内容（仅展示层 + 1 只读派生字段）

### 后端 server.js
- **新增只读派生字段 `last_payment_date`**：
  - enriched 行：`last_payment_date = (facts.latestPayment && facts.latestPayment.paid_date) || pr.paid_date || ''`（复用 `paymentSettlementFacts` 已算好的 `latestPayment`，无 logs 回退 `paid_amount` 伴生的 `paid_date`）
  - `by_supplier` 聚合：取同供应商 MAX（字符串日期比较）
  - **未改** `paymentSettlementFacts` 计算逻辑（仅读取其产出）、状态机、汇率、WAC、表结构、付款链
- by_supplier 排序保持原有 `outstanding desc`（非风险排序，未引入新排序算法）

### 前端 app.js（五层布局）
| 层 | 内容 | 说明 |
|---|---|---|
| Layer 1 经营风险 | USD未结清 / RMB未结清 / 未来7天压力 / 未来30天压力 / 已逾期 / 数据异常提醒 | 7天/30天/逾期卡内按币种分列「USD xx ｜ RMB yy」，**不跨币种合并**；数据异常提醒为 alert 样式（笔数为主），点击→展开明细并过滤无到期日 |
| Layer 2 金额构成 | 总应付 / 已结清（按币种，次要条） | 由顶部主位降级 |
| Layer 3 供应商总览 | 供应商/币种/总应付/已结清/未结清/最早到期日/**最近付款日期**/未结清笔数/状态 | 状态=基础四态（已逾期/即将到期/无到期日/正常），前端派生无新接口字段；**无风险排序/评分/模型** |
| Layer 4 费用类型 | 费用类型/币种/总应付/已结清/未结清/笔数 | 位置下移至供应商之后 |
| Layer 5 应付明细 | 13列，**默认折叠** | 折叠条显示「共N条，未结清M条」；展开后含 仅看未结清/仅看无到期日/关键词 过滤；下钻自动展开 |

新增前端函数：`cockpitCurBreakdown`（按币种分列）、`cockpitSupplierStatus`（基础四态）、`toggleCockpitDetail`（折叠）、`cockpitShowAnomaly`（异常下钻）。

## 三、隔离测试结果（隔离副本 data/L2-INTEGRATION，DB_PATH 覆盖，默认工作库未触碰）

| 项 | 结果 |
|---|---|
| server.js / app.js 语法 | 均通过 |
| 口径不变（与 V1 一致） | USD 未结清 25151 / RMB 120 ✓ |
| `last_payment_date` 字段返回 | by_supplier + details 均含 ✓ |
| 注入 paid_date 验证字段生效 | details 各行返回对应日期；by_supplier 取 MAX（同供应商 3 条中最新 2026-07-01）✓ |
| 回归 /api/dashboard | 200 ✓ |
| 回归 /api/payment-requests | 200 ✓ |
| 回归 /api/finance/payable-cockpit | 200 ✓ |

## 四、真实数据现状（如实，非缺陷）

- 隔离副本 `payable_date` 全空（CI 出货日/Credit 未录入）→ Layer 1 7天/30天/逾期为 0，全部落"无到期日"
- 隔离副本 `paid_date` 全空（已结清金额来自 `paid_amount` legacy 回退）→ `last_payment_date` 显示"—"
- 待录入 CI 出货日+Credit / 真实付款事件落库后，账龄桶与最近付款日期自动生效（已用注入场景验证）

## 五、范围冻结确认

**仅展示层**：卡片/表格重排、明细折叠、1 只读派生字段、前端派生基础状态。
**禁止项未触**：不改 `paymentSettlementFacts` 逻辑 / `derivePaymentStatus` 状态机 / 汇率规则 / WAC / 数据库结构 / 付款链；不跨币种合计；不引入风险排序/评分/模型。

## 六、本轮改动文件

- `server.js`（enriched + by_supplier 新增 `last_payment_date` 只读派生）
- `app.js`（五层布局 + 4 个新前端函数 + 明细折叠）
- 本报告 + `.workbuddy/memory/2026-07-17.md`（日志，.gitignore 忽略）

未做 commit；默认工作库 `data/inventory.db` 全程未触碰。

## 七、后续

- 等待用户对 V2 页面真实验收
- 验收通过后按既定顺序进入 SYS-MGMT-AUDIT-01（不扩大 FIN-DASHBOARD 范围）
