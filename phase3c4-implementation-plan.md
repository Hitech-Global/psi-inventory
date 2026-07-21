# Phase 3-C-4 实施计划（Dynamic Localization · 补齐全系统动态文本）

**文档类型**：实施计划（仅规划，未改动任何代码）  
**上游审计**：`dynamic-localization-audit.md` + `dynamic-localization-plan.json`（2026-07-21 确认）  
**生成时间**：2026-07-21  
**合规边界**：本计划本身只读；实施后亦须遵守「只改文字、不改结构」原则。

---

## 0. 合规边界（最高优先级，贯穿全阶段）

1. **不修改任何代码**：本计划文档不写代码、不翻译、不 commit/push/deploy。
2. **不新增业务规则**：所有包装仅替换用户可见文字，不增删字段、不改校验逻辑、不改金额/汇率/WAC/抵扣/冲销/审批口径。
3. **不重构 i18n 架构**：复用现有 `t(key, fallbackZh, vars)` 单一注入点与 `dict.en/dict.id`；新增枚举映射沿用已落地的 `STATUS_KEY_MAP` 模式（扩展，非重构）。
4. **HTML 结构不可变**：实施只允许更换文字，不得改动 tag / id / class / onclick / data-* 属性 / `{vN}` 占位符 / 标签层级 / 转义。
5. **顺序门禁**：每阶段须 审计(已有) → 本计划方案 → 用户确认 → 实施 → 隔离验收。禁止跨阶段批量实施。
6. **订单预测页面结构冻结**：Sales 模块中「订单预测 / 预测参数设置 / 字段配置 / 复盘的 render 函数」仅做文本接线，绝对不重构 render、不改 DOM、不改计算/补货逻辑。

---

## 1. 既有基础与架构事实（来自代码核实）

| 事实 | 现状 | 对实施的影响 |
|---|---|---|
| `t()` 定义位置 | `i18n.js` 内 `function t(...)` | 前端唯一翻译入口，复用即可。 |
| `dict.en` / `dict.id` | 各 **2046** 个 key（已含 `auth.*` / `status.*` / `html.*` / `modal.*` / 部分 `toast.*` 等） | 新增枚举/动作/术语 key 仅追加，不删不改既有 key。 |
| 状态映射模式 | `app.js` 顶部 `STATUS_KEY_MAP`（DB status → `status.*` 键），配 `statusLabel()` 显示 | 其它枚举照搬此模式，新增 `ENUM_KEY_MAPS` 与 `enumLabel()` 泛型 helper。 |
| 前端 API 调用 | `app.js` 现有 fetch 封装，未携带语言 | 需前端 fetch 附加 `x-locale` 头（见 §3 确认点 F1）。 |
| `server.js` 文案 | 127 个函数含硬编码中文（校验/业务提示），**未引入 dict**，无 `t()` | 需服务端 `t()` 桥接（见 §3 确认点 F1）。 |
| 结构快照纪律 | 7 维签名（ids/classes/onclick/data*/placeholders/tags/{vN}）+ 隔离 E2E（端口 3002 + 副本 DB）已在 3-C-3 验证可用 | 每阶段实施前后强制复用。 |

---

## 2. 总体策略

### 2.1 三类处理规则（与审计一致）
- **A（必须国际化，1320 处）**：表头/按钮/状态标签/生命周期/风险/建议动作/空状态/Modal/筛选/字段/业务提示 → 包 `t()` 或走枚举 map。
- **C（需确认，104 处）**：业务状态/枚举/生命周期显示值 → 走集中 map（`STATUS_KEY_MAP` 同构），DB 枚举值不变，显示文本走 `enum.*` 键，缺失回退中文。
- **B（不需国际化，0 命中）**：SKU/品牌/仓库/国家代码/供应商名/系统内部 code 本身 → **永不翻译**，仅其显示层（若有中文显示）按 C 处理。

### 2.2 Key 命名规范（新增）
| 前缀 | 用途 | 示例 |
|---|---|---|
| `status.*` | 已存在 DB status（PO/PI/CI/付款/审批…） | `status.pending_approval` |
| `enum.*` | 其它枚举（生命周期/库存状态/出库类型/国家/渠道/销售分组/动作文本/风险/结算状态） | `enum.sku_lifecycle.new_launch` |
| `mod.*` | 模块标签（采购/库存/财务/销售/系统管理） | `mod.procurement` |
| `action.*` | 通用动作（确定/取消/保存/删除/关闭/启用/停用/编辑/新增/刷新/导出/上传/下载/导入/重置/搜索） | `action.confirm` |
| `term.fin.*` / `term.pur.*` | 财务/采购共享术语（货款/运费/关税/商检费/到仓费用/尾款/定金/应付/未结清/抵扣/抹零/冲销/PO/PI/CI/成本确认/WAC/落地成本） | `term.fin.payable` |
| `txt.<module>.<fn>.<n>` | 模块内具体文本（沿用审计建议 key 风格） | `txt.fin.error.no_record` |

### 2.3 服务端消息 i18n 方案（确认点 F1）
为 i18n `server.js` 校验/业务提示（约 140+ 唯一文本，集中在 Finance/Procurement），采用最小扩展：
1. 前端 `app.js` 的 API fetch 封装附加 `x-locale: <I18N.lang>`（从 `localStorage`/当前语言读取）。
2. `server.js` 启动期 `require` 共享字典（从 `i18n.js` 抽取出的 `dict.en/dict.id` 纯数据，或新增 `i18n-core.js` 供前后端共用），新增 `serverT(locale, key, zh, vars)` 与请求级 `t()`（locale 取自 `x-locale`，缺省 `zh`）。
3. `server.js` 文案改为 `serverT(req, '...', '中文', vars)` 形式。
> 这是**扩展现有 dict 体系**，非重构；但涉及前后端各一处小改动，须经用户确认后方可纳入 Phase A。

---

## 3. Phase 3-C-4A：Localization Foundation（本地化地基）

**目标**：建立跨模块共享词汇层 + 枚举集中映射基础设施，使 3-C-4B 各模块只需做"包 t()"的机械接线，不再各自发明 key。

**范围**：枚举/状态映射、模块标签、通用动作、财务/采购共享术语（对应审计附录 B 的 Top 枚举 + Cross-cutting Top-50 + 共享术语）。

### 3-A-1 枚举 / 状态映射（enum & status maps）
- **修改文件**：`app.js`（新增 map + `enumLabel()` helper）、`i18n.js`（追加 `enum.*` / 补全 `status.*` 中个别缺失键）、`server.js`（如确认 F1，则接 `serverT`）。
- **修改范围**：
  - 新增集中 map（照搬 `STATUS_KEY_MAP` 同构）：
    `SKU_LIFECYCLE_KEY_MAP` / `SKU_STATUS_KEY_MAP` / `INVENTORY_STATUS_KEY_MAP` / `OB_TYPE_KEY_MAP` / `COUNTRY_KEY_MAP`（C 确认，真实国名）/ `OB_CHANNEL_KEY_MAP`（线上/线下）/ `SALES_GROUP_KEY_MAP`（滞销/低/中/高动销）/ `PAYMENT_SETTLEMENT_KEY_MAP`（部分付款/部分抵扣/全额抵扣/部分抹零/部分付款+部分抵扣）/ `ACTION_TEXT_KEY_MAP` / `RISK_LEVEL_KEY_MAP` / `SIMPLIFY_ACTION_KEY_MAP` / `COCKPIT_STATUS_KEY_MAP`（已逾期/即将到期/无到期日）/ `MODULE_KEY_MAP`（采购/库存/财务/销售/系统管理）。
  - 新增泛型 helper：`enumLabel(value, map, fallbackZh)` → `t(map[value] || map[String(value).toLowerCase()] || '', fallbackZh)`。
  - `i18n.js` 追加上述 `enum.*` 键的 en/id 译文（zh 走 `t()` fallback）。
- **预计影响**：覆盖审计附录 B 全部高/中频枚举（关闭/清仓/正常/慢销/启用/停产/停采/滞销/线上/线下/已驳回/已付款/已冲销/断货风险/高库存/异常/在途/待审批/草稿/进行中/已完成/已转PI/暂缓补货/优先补货/各生命周期值等），消除最显眼混杂。
- **风险**：低。仅新增常量与 helper，不改既有渲染逻辑；DB 枚举值不变。
- **回归测试**：
  1. `node --check app.js i18n.js server.js` 语法通过。
  2. 7 维结构快照：map/helper 为纯数据，页面 HTML 不变 → 结构签名零变化。
  3. 隔离 E2E（端口 3002）：切换 zh/en/id，确认清单/状态下拉/状态徽章显示正确且无 key 泄漏、无破版。
  4. 单元测试：对每新增 map 跑 `enumLabel` 往返（中文输入→对应语言输出，缺失→回退中文）。

### 3-A-2 模块标签（module labels）
- **修改文件**：`app.js`（`ROLE_MODULE_ORDER` / `module` 相关显示）、`i18n.js`（`mod.*`）、`server.js`（如确认 F1，`module` 字段返回值）。
- **修改范围**：将 `采购/库存/财务/销售/系统管理` 等模块名经 `MODULE_KEY_MAP` → `mod.*` 输出；角色权限页、审批流模块列、操作日志模块列统一走 map。
- **预计影响**：角色管理 / 审批中心 / 操作日志 / 系统设置 等处的模块名一致本地化。
- **风险**：低。显示层替换。
- **回归测试**：同上 7 维 + E2E 切语言验证角色/审批/日志页模块列。

### 3-A-3 通用动作（common actions）
- **修改文件**：`app.js`（按钮/确认框文案）、`i18n.js`（`action.*`）、`server.js`（如确认 F1）。
- **修改范围**：确定/取消/保存/删除/关闭/启用/停用/编辑/新增/刷新/导出/上传/下载/导入/重置/搜索 等高频词建立 `action.*` 并替换散布各处字面量。优先替换审计附录 A Top-50 中的 `关闭(14)/启用(7)/停用(7)/取消(5)` 等。
- **预计影响**：全局按钮/Modal 操作词统一，消除最普遍混杂。
- **风险**：低-中。须逐处确认上下文（如"删除"在 SKU/PO/附件语义一致）；不建议做成跨语义合并的歧义词。
- **回归测试**：7 维结构快照（按钮 onclick 不变，仅文字）+ E2E 全页点击关键 Modal 确认文字随语言切换。

### 3-A-4 财务 / 采购共享术语（finance & procurement shared terms）
- **修改文件**：`app.js`（付款/成本/CI/PI 相关显示）、`i18n.js`（`term.fin.*` / `term.pur.*`）、`server.js`（如确认 F1，校验/业务提示中的术语）。
- **修改范围**：货款/运费/关税/商检费/到仓费用/尾款/定金/应付/未结清/抵扣/抹零/冲销/PO/PI/CI/成本确认/WAC/落地成本/加权成本 等术语建立 `term.*` 并替换。覆盖 `error`/`reason`/`applyPaymentSettlement`/`applyDeductionSettlement`/`recalculatePaymentSettlement` 等高 P0 函数。
- **预计影响**：付款/成本/CI/PI 全链路术语一致；Finance 模块 P0 混杂大幅消除。
- **风险**：中。术语在 Finance 与 Procurement 间复用，需保证同一术语 key 统一（避免 Finance 与 Procurement 各译各的）。
- **回归测试**：7 维 + E2E 重点页 Payment/Cost/CI/PI 切语言；核对应付驾驶舱/付款申请/成本分摊页术语无中文残留。

### Phase A 交付验收标准（门禁）
- [ ] 所有新增 map/helper 通过 `node --check` 与 `enumLabel` 单元往返。
- [ ] 7 维结构快照：Foundation 阶段页面结构签名零变化。
- [ ] 隔离 E2E：zh/en/id 切换下，状态/枚举/模块名/通用动作/财务采购术语无中文混杂、无 key 泄漏、无破版。
- [ ] 用户确认 Foundation 验收后，方可进入 3-C-4B。

---

## 4. Phase 3-C-4B：Business Module Localization（业务模块接线）

> 顺序固定：**Finance → Procurement → Inventory → Sales → Approval/System**。  
> 每模块阶段仅做"包 t() / 走 Foundation 枚举 map"的机械接线（A 类直接包、C 类走 map、B 类不动）。  
> 每个阶段结构：修改文件 / 修改范围 / 预计影响 / 风险 / 回归测试。

### 4-B-1 Finance（169 函数 / 660 唯一文本 — 最大模块，优先）
- **修改文件**：`app.js`（付款/成本/审批流/应付驾驶舱/报表相关 render）、`server.js`（付款/抵扣/抹零/冲销/校验提示，如确认 F1）、`i18n.js`（追加 `txt.fin.*` + 复用 `term.fin.*`/`action.*`/`status.*`）。
- **修改范围**：
  - P0（约 60+ 项）：`error`/`reason`/`badMsg`/`module`/`STATUS_MAP`/`LIFECYCLE_MAP`/`risk_level`/`financeApprove`/`apprPay`/`approved`/`isValid`/`openRpReview` 等校验与状态。
  - P1（约 480 项）：付款列表/成本分摊/WAC 明细/审批流级次/字段配置/Modal 表单/空状态（📭 暂无付款数据 等）。
  - P2（约 120 项）：长描述/帮助（如 `rmb_note`/`currency`/`due_date`/`outstanding`/`scope` 口径说明）。
- **预计影响**：付款申请、成本确认、WAC、审批流、应付驾驶舱、预测参数页全部去中文混杂。
- **风险**：中。Finance 术语与计算强相关，必须只换文字不改 `recalculatePaymentSettlement`/`applyDeductionSettlement` 等业务函数逻辑；`updateWeightedAvg` 的提示文案仅改显示。
- **回归测试**：
  1. 7 维结构快照（付款/成本/审批/驾驶舱页）。
  2. 隔离 E2E：12 页×3 语，重点 Payment/Cost/Approval/WAC/应付驾驶舱；断言 0 key 泄漏、0 破版、数据行数一致、Modal 文字随语言切换。
  3. 业务回归：跑一遍付款确认→抵扣→抹零→冲销流程，确认金额/状态不变（仅文字变）。

### 4-B-2 Procurement（100 函数 / 236 唯一文本）
- **修改文件**：`app.js`（PO/PI/CI/Inbound/Logistics/Supplier render）、`server.js`（PO/CI/PI 校验与状态提示，如确认 F1）、`i18n.js`（追加 `txt.pur.*` + 复用 `term.pur.*`/`status.*`/`action.*`/`enum.*`）。
- **修改范围**：
  - P0（约 30 项）：`editPI`/`openSalesBatchImport`/`openBatchImportInbound`/`loadSuppliers`/`cockpitSupplierStatus`/`toggleSupplierStatus`/`partial`/`completed`/`transferred_pi`/`viewCICost`/`OB_TYPE_MAP`/`COUNTRY_ALIAS_MAP` 等。
  - P1（约 170 项）：PO/PI/CI/Inbound/Logistics 表头、导入预览、Modal、操作按钮、空状态。
  - P2（约 36 项）：长提示/帮助。
- **预计影响**：采购全链路（PO→PI→CI→入库→物流）表头/状态/按钮/Modal 去混杂。
- **风险**：中。`editPI` 锁定项提示、`normalizeHistoricalCI` 日期字段等含内联 HTML，须用 acorn AST 精准包装，禁止破坏结构（沿用 3-C-3 方法）。
- **回归测试**：7 维快照 + E2E 重点 PO/PI/CI/Inbound/Logistics/Supplier；核对 PI 锁定提示、CI 费用 Modal、物流状态文字随语言切换且结构不变。

### 4-B-3 Inventory（61 函数 / 163 唯一文本）
- **修改文件**：`app.js`（SKU Master/Inventory List/Inventory Check/Slow Moving render）、`server.js`（库存状态/分类提示，如确认 F1）、`i18n.js`（追加 `txt.inv.*` + 复用 `enum.*`/`action.*`/`status.*`）。
- **修改范围**：
  - P0（约 25 项）：`classifySkuState`/`SKU_LIFECYCLE_MAP`/`SKU_STATUS_MAP`/`INVENTORY_STATUS_MAP`/`INVENTORY_STATUS_LABELS`/`loadSKUs`/`loadInv`/`shouldBlockReplenish`/`stockoutRisk`/`highStock`/`OUTBOUND_STATUS_LABELS`/`COUNTRY_ALIAS_MAP` 等。
  - P1（约 120 项）：SKU/库存/盘点/呆滞 表头、导入预览、Modal、筛选、空状态。
  - P2（约 18 项）：`refreshInventoryTotals`/`detectStockoutDistortion` 等长说明。
- **预计影响**：SKU 主数据、库存总表、盘点、呆滞分析去混杂。
- **风险**：中。`loadInv`/`loadSKUs` 含 `🔄 刷新`、汇率提示、`{vN}` 插值，须保留占位符；`openInvBatchImport` 长说明含内联 HTML。
- **回归测试**：7 维快照 + E2E 重点 SKU/Inventory/Check/Stagnant；核对生命周期/库存状态徽章、汇率提示、批量导入 Modal 随语言切换。

### 4-B-4 Sales（31 函数 / 118 唯一文本 — 含订单预测冻结页）
- **修改文件**：`app.js`（Sales Data/Reports/Demand Forecast/Analytics Cockpit render）、`server.js`（销售分组/建议动作提示，如确认 F1）、`i18n.js`（追加 `txt.sales.*` + 复用 `enum.*`/`action.*`/`status.*`）。
- **修改范围**：
  - P0（约 20 项）：`buildAiAdvice`/`suggestion`/`simplifyAction`/`sales_group`/`renderCockpitLayers`/`handleSalesFile`/`paid`/`unpaid`/`partial_paid`/`dimScoreLabel` 等。
  - P1（约 85 项）：销售数据/报表/复盘 表头、渠道筛选、字段配置、空状态。
  - P2（约 13 项）：长提示。
- **预计影响**：销售数据、需求预测、应付驾驶舱、复盘页去混杂。
- **⚠️ 订单预测页结构冻结（特别确认）**：`loadRp` / `loadRpDaily` / `loadRpSummary` / `loadRpChannelMonthly` / `openRpParams` / `openRpFieldConfig` / `saveRpParams` / `saveChannelChanges` / `genRp` 等**仅做文本接线**：
  - 禁止重构 render 函数、禁止改 DOM、禁止改 id/class/onclick、禁止改计算/补货/周转逻辑、禁止改 `{vN}` 占位符。
  - 只把中文表头/提示/筛选标签包 `t()`，译文经 `i18n.js` 注入。
- **风险**：中-高（因冻结约束）。任何对 render 结构的触碰都视为违规，须 7 维快照硬性拦截。
- **回归测试**：7 维快照强制（订单预测相关 render 结构签名必须与基线逐字节一致）+ E2E 重点 Sales Data/Reports/Demand Forecast/Cockpit；核对预测参数/字段配置/复盘文字随语言切换且表格结构、数据量、补货建议值不变。

### 4-B-5 Approval / System（14 函数 / 33 唯一文本 — 最小模块，末位）
- **修改文件**：`app.js`（User/Role/System Settings render）、`server.js`（auth/权限/break-glass 提示，如确认 F1）、`i18n.js`（追加 `txt.sys.*` + 复用 `mod.*`/`action.*`/`status.*`）。
- **修改范围**：
  - P0/P1（约 30 项）：`renderUsers`/`loadRoles`/`renderRoles`/`ROLE_MODULE_ORDER`/`setUserStatus`/`openRoleEditor`/`api`(连接提示)/`apiAuth`/`bootstrapBreakGlass`/`csrfGuard`/`getPILockReason` 等。
  - `bootstrapBreakGlass`/`csrfGuard`/`apiAuth` 等为安全/连接关键提示，译文须谨慎（不影响 fail-closed 语义）。
- **预计影响**：用户管理、角色权限、系统设置、登录/连接/安全提示去混杂。
- **风险**：中。安全提示（break-glass/CSRF/未登录）译文不得改变语义或弱化告警；建议译文经人工审校。
- **回归测试**：7 维快照 + E2E 重点 User/Role/System Settings；模拟未登录/无权限/断连，确认提示随语言切换且 fail-closed 行为不变。

---

## 5. 订单预测页特别处理（结构冻结重申）

- 涉及函数见 §4-B-4。本计划**严禁**任何 DOM/结构改动。
- 唯一允许变更：`t("app.NNN","中文")` 或 `t("txt.sales.xxx","中文",{vars})` 文字接线 + `i18n.js` 注入译文。
- 每提交前必须 7 维结构快照比对（ids/classes/onclick/data*/placeholders/tags/{vN}），任一维度变化 → **禁止提交，先报告**。

---

## 6. 实施纪律与门禁（复用 3-C-3 机制）

1. **顺序门禁**：A 完成验收 → B-1 → B-2 → B-3 → B-4(冻结) → B-5，逐阶段确认。
2. **结构快照（强制）**：每阶段实施前后跑 7 维签名比对，生成快照文件与 diff；结构变化不得提交。
3. **隔离验收**：沿用 3-C-3 隔离环境（端口 3002 + 副本 DB + user_admin session），每阶段跑 12 页×3 语 E2E（0 key 泄漏 / 0 破版 / 数据行数一致 / Modal 正常）。
4. **禁止机器翻译覆盖 HTML 模板**：文字可变、结构不可变；译文须由既有翻译流程（ChatGPT 中→英/印尼，WorkBuddy 仅按确认表替换）提供，不得自动机翻覆盖含标签的模板。
5. **不 commit/push/deploy**：每阶段仅本地修改 + 隔离验收；全部模块验收通过后，再统一本地 commit（仍不 push/deploy，待用户指令）。

---

## 7. 附录：规模核对（来源 = 审计交付物）

| 阶段 | 模块 | 函数数 | 唯一文本 | 优先级分布(P0/P1/P2) |
|---|---|---|---|---|
| A | 地基（跨模块共享） | — | 约 320（枚举/动作/术语/模块名） | — |
| B-1 | Finance | 169 | 660 | ~60 / ~480 / ~120 |
| B-2 | Procurement | 100 | 236 | ~30 / ~170 / ~36 |
| B-3 | Inventory | 61 | 163 | ~25 / ~120 / ~18 |
| B-4 | Sales（含冻结页） | 31 | 118 | ~20 / ~85 / ~13 |
| B-5 | Approval/System | 14 | 33 | ~30 / — / — |
| 合计 | — | 396（函数去重） | 1424（A+C，不含 B） | 128 / 936 / 360 |

> 注：地基阶段覆盖的枚举/动作/术语在 B 各模块中以"复用 map / action.* / term.*"形式被引用，不再重复计入 B 的函数级接线量；B 阶段实际新增包装量 = 模块独有文本（表头/Modal/表单/长描述）。  
> 另：`server.js` 文案是否纳入取决于确认点 F1；若 F1 不通过，则 server.js 消息改为"前端按 key 映射翻译"的替代方案（同样不重构架构，需在 Phase A 确认时定夺）。

---

**本计划为只读规划文档，未对任何源文件（app.js / server.js / i18n.js）做任何改动。**
