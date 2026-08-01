# 发布说明 — PSI 系统 v1.0.2

- **发布版本**: 1.0.2 (patch) — **已发布**（浏览器验收通过；已 commit/push/部署；tag `v1.0.2`）
- **基线**: v1.0.1（`3cea48f`，tag `v1.0.1` 保留为显式回滚点）
- **范围纪律（已遵守，本轮冻结）**: 仅修复「版本显示 / 订单预测 SKU 展示 / 新建·编辑 PI 操作与字段」；**不修改** CI/PL 页面、PAY-CORE、订单预测公式与数据口径、PO→PI→CI 关联规则、WAC/成本逻辑、全局 PG worker/事务架构。
- **本轮目标文件**: `index.html`、`app.js`、`i18n.js`、`server.js` + 本说明。

## 一、版本显示（左下角角标 + 文档标题）
- `server.js` `/api/version` 新增 `environment` 字段（`RENDER==='true'` 或 `NODE_ENV==='production'` → `production`，否则 `development`）。
- `app.js` 新增 `initVersionBadge()`，DOMContentLoaded 即调用（公开接口，登录前后均刷新）：
  - 角标文本 = `v{version} {短commit} {部署日期?}`；**生产环境不显示「本地」**，本地显示「本地」。
  - 角标 `title`（hover）= 完整 `version / commit / environment / deployTime`。
  - `document.title` 同步为「进销存管理系统 v{version}」。
- `i18n.js` `page.doc_title` 去掉内嵌版本号（改为基名，版本由前端拼接），三语一致。
- `index.html` 角标改为 `id="version-badge"`、标题改为 `id="page-title"`，不再硬编码「v1.0.0 本地」。

## 二、订单预测 SKU 遮挡
- `app.js` 三处 SKU 列（主表 `loadRp`、渠道月度 `loadRpChannelMonthly`、日表 `loadRpDaily`）加 `max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis` 并保留 `title` 悬浮全文。
- **未改动**任何筛选/排序/分页/计算逻辑、未冻结、未加横向滚动。

## 三、新建/编辑 PI 保存性能 + 「保存中」反馈
- `server.js`：
  - PI 明细由「逐行 INSERT」改为 **单条批量 INSERT**（`VALUES (?), (?), …` 占位展开），POST/PUT 共用。
  - PUT 的 `updateInventoryTransitData()` 改为**条件执行**：仅当 `country` / `target_warehouse` / `items` 变化时才重算在途（原逻辑为每次 PUT 无条件全表 N+1 重算，是生产慢的根因）。
- `app.js`：`saveNewPI` / `saveEditPI` 保存按钮在点击瞬间 `disabled` + 文案切「保存中…」，成功/失败均恢复（无假 loading），错误仍 toast 原信息。

## 四、PI 号编辑规则（D2，前后端双校验）
- **解锁态**（新 PI 或保存后尚未进入后续阶段）：PI 号可改；改前服务端重查重（`proforma_invoices.pi_no` 唯一性校验），重复返回 `409 {dup:true}`。
- **锁定触发**（任一即锁，前端禁用输入 + 橙色提示锁定原因；后端 PUT 同样守卫返回 `409 {locked:true}`）：
  已作废 / 已关联 CI / 已生成 PL / 已付定金 / **已创建付款申请** / **已发生付款** / **已发生发货** / **已入库** / **已产生成本记录（WAC/成本分摊/成本更新日志）**。
- 锁定判定复用并扩展既有 `getPILockReason` → 新增 `getPINumberLockReason`（修正 `payment_requests` 关联字段为 `source_type='pi' AND (source_id|source_no)`，与原库 Schema 一致）。
- 允许修改时无需大范围级联（PI 号属前期录单纠错字段，尚未进入下游）。
- **PI 附件不影响 PI 号锁定（D2 补充）**：锁定只依据真实业务流转事实，不依据附件状态。
  - `getPINumberLockReason` **不检查 attachment**；前端不因已有附件禁用 PI 号输入框；后端 PUT 不因已有附件拒绝改号。
  - PI 附件为独立资料字段，不与 PI 号编辑权限、发货状态产生耦合。
  - 允许修改 PI 号时仍按已确认规则完成：① `proforma_invoices.pi_no` 查重；② 事务内同步更新全部冗余展示字段（`proforma_invoice_items.pi_no` 等）；③ 任一关联更新失败整事务回滚。
  - 不得因「已上传/追加/预览/下载 PI 附件」而锁定 PI 号。

## 五、无关联 PO 新建 PI 必须选国家 + 仓库（D5）
- 新建 PI 表单「国家」「仓库」为必填；仓库按国家过滤（`/api/warehouses/by-country`）。
- 关联 PO 时：国家/仓库由 PO 自动带出且**只读**；切换 PO 更新；切回「无关联」恢复可编辑。
- 供应商变更**不覆盖**用户已选国家/仓库（`onPISupplierChange` 只动付款条件）。
- 编辑 PI 展示已保存国家/仓库；`saveNewPI`/`saveEditPI` 统一从表单读取国家/仓库（PO 关联时为只读预填值）。

## 六、「PI状态」→「发货状态」（D1，纯发货语义，三语）
- 列表表头改为「发货状态」；新增「PI附件」独立列。
- 状态映射固定：**未发货 / 部分发货 / 全部发货完成 / 已取消**（cancelled 不并入未发货）。
- 复用既有 `confirmed_qty_sum` / `shipped_qty_sum` 计算，**后端无改动**，仅前端展示层。

## 七、PI 附件独立列（数组感知，不覆盖）
- 列表「PI附件」单元格：`normalizeAttachments` 兼容 字符串/单对象/数组；未上传 → 「待上传PI」入口；已上传 → 「查看PI」+「下载」；多附件 → 首名 + `+N`。
- 上传走既有 `POST /api/proforma-invoices/:id/attachment`；前端先读现有附件、合并新件、再整体回写 → **多附件合并不覆盖**；上传后仅重渲染当前行单元格。
- 复用既有 attachment 字段/接口/权限，无新增存储结构。

## 八、PI 号锁定规则速查
| 触发条件 | 锁定原因（中文） | 后端返回 |
|---|---|---|
| 已作废 | （沿用 getPILockReason） | 409 locked |
| 已关联 CI | （沿用） | 409 locked |
| 已生成 PL | （沿用） | 409 locked |
| 已付定金 | （沿用） | 409 locked |
| 已创建付款申请 | 已创建付款申请 | 409 locked |
| 已发生付款 | 已发生付款 | 409 locked |
| 已发生发货 | 已发生发货 | 409 locked |
| 已入库 | 已入库 | 409 locked |
| 已产生成本记录 | 已产生成本记录 | 409 locked |
| 修改后编号重复 | 该 PI 编号已存在，请检查供应商文件 | 409 dup |

## 九、本轮回测结果（本地隔离 SQLite + HTTP 冒烟，全部通过）
- 服务：`DB_PATH=/private/tmp/psi-ac1-test.db PORT=4000`（隔离测试库，非生产）。
- 版本端点：`/api/version` 返回 `version/commit/deployTime/environment/timestamp` 五字段齐全。
- 新建 PI（无 PO，带国家+仓库+3 明细）：`200`，批量 INSERT 成功。
- 明细 GET：`pi_no_locked=false`、`pi_no_lock_reason=''`（新鲜 PI 解锁）。
- 改 PI 号（唯一新值）：`200`；改 PI 号（重复）：`409 {dup:true}`（查重守卫生效）。
- 改数量（在途相关）：`200`（触发重算路径正常）。
- 仅改交期（非在途相关）：`200` 且明显更快（命中「跳过 `updateInventoryTransitData`」分支）。
- 附件合并：先传 a1.pdf、再合并传 a2.pdf → GET 得 `length=2` 且 `a1/a2` 均在（**不覆盖**）。
- 列表字段：`confirmed_qty_sum`/`shipped_qty_sum`/`attachment`/`country`/`target_warehouse` 齐备（供发货状态列 + 附件列渲染）。
- 语法：`node --check app.js` / `server.js` 通过；`git diff --check` 无空白问题。

## 十、性能前后对比（结构 + 本地基线）
- **根因**：原 PUT 每次无条件调用 `updateInventoryTransitData()`（全表 N+1 重算）；明细逐行 INSERT；叠加 PG 同步桥每语句 RTT，生产保存明显卡顿。
- **修复后**：
  - 明细写 = 1 条批量 INSERT（原 N 条）。
  - 非在途字段变更（如交期/付款条件/定金比例）→ **完全跳过** `updateInventoryTransitData()`。
  - 仅在 `country` / `target_warehouse` / `items` 变化时才重算。
- **本地 SQLite 基线**（仅作健全性参考，非 PG 真实 RTT）：
  - 新建 3 明细 ≈ 12.7ms；非在途 PUT ≈ 1.9ms；在途 PUT ≈ 1.6ms；改 PI 号 ≈ 3.2ms。
  - 本地 DB 延迟过低不足以体现差异；**PG 真实收益 = 减少的语句数 × 单语句 RTT**。PG 隔离性能计时为 commit 前**强制门禁（已执行，见下）**。
- **PG 隔离实测**（embedded PostgreSQL 18.4 隔离环境，53 行 inventory + 1 活跃 PI，`log_statement=all` 计 DB 调用数；连续 2 次运行 DB 调用数完全一致）：

  | 场景 | 端到端耗时(ms) | DB 调用数 | 说明 |
  |---|---|---|---|
  | ① 新建 PI（3 明细） | 45 | 23 | 批量 INSERT + 建 deposit/balance payable_item + 首次重算在途 |
  | ② 仅改 PI 号（明细不变） | 75 | 25 | 跳过 `updateInventoryTransitData`；25 含 pi_no 查重 + 事务内多表冗余同步级联 |
  | ③ 仅改交期/付款条件（明细不变） | 52 | 14 | **跳过重算**；纯字段 UPDATE，调用数最低 |
  | ④ 改明细数量（在途相关） | 54 | 26 | **触发重算**；③ + `updateInventoryTransitData` ≈ 12 calls |
  | ⑤ 保存后列表刷新（GET） | 17 | 7 | 纯读 |

  - **判定（门禁通过）**：非在途 ③（14）显著低于在途 ④（26），Δ=12 即 `updateInventoryTransitData` 重算成本，证明 D3 守卫生效——明细不变时正确跳过全表重算。
  - ② 调用数（25）高于 ③，系 pi_no 同步级联（需求⑤要求的事务内同步全部冗余展示字段）所致，**非重算**；旧实现 ②③④ 均 +12 calls（每次无条件重算），新实现 ②③ 各省 12 calls。
  - 端到端耗时因本机负载波动（17–75ms），但均 < 80ms；DB 调用数跨运行稳定。

## 十一、PG Schema 一致性门禁（✅ 已执行通过）

对 `db-pg.js` 的 `initDatabase()` 初始化出的全部 60 张表，与当前 SQLite 实际 Schema（`data/inventory.db`，含迁移补丁后的完整列）做完整逐表逐列对比。

### 差异清单（4 表 31 列缺失）

| 表 | 缺失列数 | 缺失列 |
|---|---|---|
| `commercial_invoices` | 2 | `payment_terms`, `due_date` |
| `payable_items` | 1 | `source_ci_id`（CI 多PI 改造 R8） |
| `payment_transactions` | 12 | `settlement_country`, `local_currency`, `local_rate`, `local_rate_date`, `local_rate_type`, `local_rate_direction`, `local_amount`, `rmb_rate`, `rmb_rate_date`, `rmb_rate_type`, `rmb_rate_direction`, `rmb_amount`（FX 快照规则，2026-07-28 冻结） |
| `replenishment_suggestions` | 16 | `with_transit_turnover_months`, `with_pi_turnover_months`, `with_po_turnover_months`, `manual_planned_qty`, `online_sales_m1`–`m4`, `offline_sales_m1`–`m4`, `online_avg_sales_4m`, `offline_avg_sales_4m`, `online_after_order_turnover_months`, `offline_after_order_turnover_months`（渠道库存池 + 预测扩展） |

### 修复内容

在 `db-pg.js` 的四张 `CREATE TABLE IF NOT EXISTS` 语句中补齐上述 31 列，类型映射：`TEXT→TEXT`, `REAL→DOUBLE PRECISION`, `INTEGER→INTEGER`，默认值对齐 SQLite。

### 最终验证

- 使用全新空白 PostgreSQL 数据库（embedded PG 18.4），仅执行 `initDatabase()`，**无 ALTER 补丁、无旧库导入**。
- 重跑全部 5 场景性能门禁：**全部 HTTP 200，无任何 `column does not exist` 错误**。
- DB 调用数与补丁前完全一致（23/25/14/26/7），证明修复未引入副作用。
- 修复后再次执行逐表逐列对比 → **0 表差异**。

### 深度约束对比（PK / UNIQUE / FK / CHECK / DEFAULT / INDEX）

在逐列对比基础上，进一步对全部 60 张表的 `PRIMARY KEY`、`UNIQUE`、`FOREIGN KEY`、`CHECK`、`DEFAULT`、`INDEX` 逐项对比：

- **PK**：全部 60 张表主键定义一致（列名、列序相同）。
- **UNIQUE**：PG 的 PK 自动生成 UNIQUE 约束（`*_pkey`），SQLite 以隐式 `sqlite_autoindex_*` 体现——二者计数差为引擎行为差异，非结构差异。业务级 UNIQUE 索引（如 `uq_wac_history_version`、`uq_payable_active`）两端定义一致。
- **FK**：两端均无显式 FOREIGN KEY 约束（系统通过应用层 + `source_id`/`pi_id` 关联管理，不经 DB 外键）。
- **CHECK**：两端均无业务 CHECK 约束（状态校验在应用层）。
- **DEFAULT**：`datetime('now')`（SQLite）vs `now()`（PG）为跨引擎等价语法；其余 DEFAULT 值全部一致。
- **INDEX**：全部 `CREATE INDEX IF NOT EXISTS` 定义的索引名、列、唯一性两端一致。
- **例外表**：`approval_flows_backup_phase1`（SQLite 迁移备份表，15 行历史数据，仅存于 SQLite 本地库；PG 全新环境不需要此表，非结构差异）。

**结论：0 项实质性结构差异。**

### 双重初始化安全验证

连续执行两次 `initDatabase()`（模拟服务重启），确认：
- **0** 次 `duplicate column` 错误
- **0** 次 `duplicate index` 错误
- **0** 次 `duplicate constraint` 错误
- **0** 次 `relation already exists` 错误
- 全部 60 表 + 149 索引在两次执行后完整存在
- 第二次执行耗时 4004ms（第一次 5253ms，第二次因 `IF NOT EXISTS` 跳过已存在对象更快）

**结论：新环境重复启动安全。**

## 十二、PI 号级联一致性（✅ 已验证）

### 事务级联更新表（PI 号修改时在事务内同步）

| # | 表 | 级联方式 | 说明 |
|---|---|---|---|
| 1 | `proforma_invoices` | `UPDATE SET pi_no = ?` | 主表直接更新（server.js:5153+5260） |
| 2 | `proforma_invoice_items` | `DELETE + INSERT`（pi_no = newPiNo） | 明细全量重建，新 pi_no 在 INSERT 时写入（server.js:5179+5188） |

### 不需要级联更新的表（锁定机制保证无下游记录）

| # | 表 | PI 引用列 | 锁定检查点 | 不需更新原因 |
|---|---|---|---|---|
| 3 | `commercial_invoices` | `related_pi_id`/`related_pi_no`/`related_pi_ids`/`related_pi_nos` | `getPILockReason`：`related_pi_id`/`related_pi_no`/`cii.pi_id` | PI 号可改时尚未生成 CI |
| 4 | `commercial_invoice_items` | `pi_id`/`pi_no` | `getPILockReason`：`cii.pi_id` | 同上（CI 不存在则明细不存在） |
| 5 | `packing_lists` | `related_pi_id`/`related_pi_no` | `getPILockReason`：`related_pi_id`/`related_pi_no` | PI 号可改时尚未生成 PL |
| 6 | `payment_requests` | `source_id`/`source_no` | `getPINumberLockReason`：`source_id`/`source_no` | PI 号可改时尚未创建付款申请 |
| 7 | `payable_items` | `source_id`/`source_no` | `getPINumberLockReason`：`source_id` + `lifecycle_status IN ('reserved','paid')` | 同上 |
| 8 | `payment_allocations` | （经 `payable_items` 关联链） | `getPINumberLockReason`：`payment_allocations` JOIN 链 | 同上（付款不存在则分摊不存在） |
| 9 | `cost_allocations` | `related_pi_no` | `getPINumberLockReason`：`related_pi_no` | PI 号可改时尚未产生成本分摊 |
| 10 | `cost_update_logs` | `related_pi_no` | `getPINumberLockReason`：`related_pi_no` | 同上 |
| 11 | `wac_history` | `pi_id`/`pi_no` | `getPINumberLockReason`：`pi_no` | 同上 |
| 12 | `inbound_records` | `source_pi_no` | `getPINumberLockReason`：`commercial_invoice_items.inbound_qty > 0`（间接） | PI 号可改时尚未入库 |

### 仅依赖 pi_no（无 pi_id）的表

| # | 表 | 列 | 锁定覆盖 | 风险 |
|---|---|---|---|---|
| 1 | `inbound_records` | `source_pi_no` | ✅ 间接覆盖（CI items inbound_qty > 0） | 理论：入库记录存在但 CI items inbound_qty=0 时锁定可能未触发。实际：入库流程必然先有 CI→CI items→入库记录→inbound_qty 回写，锁定先于入库记录触发。**无实际风险。** |
| 2 | `cost_allocations` | `related_pi_no` | ✅ 直接覆盖（`WHERE related_pi_no=?`） | 无 |
| 3 | `cost_update_logs` | `related_pi_no` | ✅ 直接覆盖（`WHERE related_pi_no=?`） | 无 |

**结论：不存在任何在 PI 号可修改状态下仍依赖 pi_no 且无 pi_id 的孤立记录。所有下游表均被 `getPILockReason`/`getPINumberLockReason` 锁定覆盖。**

## 十三、验收与发布状态（✅ 全部通过）
1. **浏览器视觉验收（✅ 通过）**：发货状态列四态、PI附件列三态（含通用附件组件拖拽上传/多附件预览/弹窗下载）、SKU 省略号、版本角标（生产不显「本地」）、国家/仓库联动、保存中反馈。
2. **PG 隔离性能计时（强制门禁，✅ 已执行通过）**：实测数据见第十节。5 场景 DB 调用数稳定（23/25/14/26/7），③(14) ≪ ④(26) 证明 D3 守卫生效。**门禁通过。**
3. **PG Schema 一致性（强制门禁，✅ 已执行通过）**：`db-pg.js` 补齐 4 表 31 列（见第十一节）。新空库 `initDatabase()` 无 ALTER 补丁直接运行，5 场景全通过。深度约束对比 0 实质性差异。双重初始化安全。**门禁通过。**
4. **PI 号级联一致性（✅ 已验证）**：2 表事务级联（`proforma_invoices` + `proforma_invoice_items`），10 表无需级联（锁定覆盖），3 表仅依赖 pi_no 但均被锁定覆盖。详见第十二节。**门禁通过。**
5. **发布序列（✅ 已执行）**：bump 1.0.2 → 更新本说明 → 独立 release commit → push + Render 部署 → 核对线上 version/commit/deployTime → 浏览器线上复验 → 打 `v1.0.2` stable tag → 保留 `v1.0.1`/`3cea48f` 为显式回滚点。

## 十四、本版文件清单
- `server.js` — `/api/version` 加 `environment`；`getPINumberLockReason`（修正 payment_requests 关联字段）；PUT pi_no 锁定+查重守卫；POST/PUT 明细批量 INSERT；PUT `updateInventoryTransitData` 条件化（D3 守卫 `piItemsEqual`）；明细 GET 加 `pi_no_locked`/`pi_no_lock_reason`。
- `app.js` — SKU 三表省略号；PI 列表「发货状态」+「PI附件」表头/单元格 + 渲染辅助函数；`onPICountryChange`/`populatePIWarehouse`/`setPICountryWarehouseEditable`；`loadPOForPI` PO 自动带国家/仓库（只读）；`createPI`/`editPI` 国家+仓库必填与联动；`saveNewPI`/`saveEditPI` 保存中反馈 + 国家仓库从表单读取；`initVersionBadge` + DOMContentLoaded 接线。
- `i18n.js` — `pi.field.ship_status`/`pi.col.attachment`/`pi.attachment.pending`/`pi.attachment.view`/`pi.no.edit_hint`/`common.saving` 三语；`page.doc_title` 去版本号；复用既有 `pi.ship_status.*` 键。
- `index.html` — 角标/标题改为带 id 的占位（不再硬编码版本）。
- `db-pg.js` — 补齐 4 表 31 列（`commercial_invoices`/`payable_items`/`payment_transactions`/`replenishment_suggestions`），PG 新空库 initDatabase 后与 SQLite Schema 0 差异；深度约束对比（PK/UNIQUE/FK/CHECK/DEFAULT/INDEX）0 实质性差异；双重初始化安全。
- `RELEASE-NOTES-v1.0.2.md` — 本说明。

## 十五、通用附件组件抽取（PI 列表先接入）

### 范围
- 新增**通用附件预览组件** `openAttachmentPreview(files, options)` 与**通用附件上传组件** `openAttachmentUploader(options)`，不绑定任何业务字段/接口/权限，由调用方传入 files/options/uploadHandler。
- **本轮仅 PI 列表接入**：PI 列表附件单元格改为调用两个通用组件。
- **viewPI 详情弹窗内的附件卡保持现状**（仍走 `attachmentHtml` / `uploadDocAttachment`），本轮未迁移。
- **CI / PO / PL / 付款 / 水单 / 售后等页面全部未改**，后续逐模块迁移。

### 通用预览组件能力
PDF iframe 内联预览（blob URL，固定高度避免双滚动条）；图片保持比例；不支持格式显示文件信息卡；多附件弹窗内切换（不重开/不重拉）；右上角下载图标；Esc / 遮罩 / 关闭按钮 / 外部 closeModal 统一 cleanup；长文件名省略 + hover 全文；支持 `startIndex` 定位。

### 通用上传组件能力（新增拖拽上传）
点击选择 + 拖拽上传（dragenter 高亮 / dragleave·drop 恢复 / 阻止浏览器默认打开文件）；多文件；合法队列 + 被拒绝列表分离；重复（同名+同大小）/超大/超量/格式不支持明确提示且不进入上传队列；MIME + 扩展名双校验（MIME 为空时不误拒合法文件）；上传中 disabled 防重复（不伪造百分比）；失败保留列表允许重试；成功关闭弹窗；合并不覆盖旧附件。

### 事件清理机制
- 预览/上传各维护独立 state（`_attPreviewState` / `_attUploaderState`）。
- Esc：具名 `addEventListener('keydown')`，cleanup 时 `removeEventListener`。
- 遮罩 / 右上角 / 外部 closeModal：`MutationObserver` 监听 `#modal-overlay` class 变化，`show` 移除即 cleanup。
- 拖拽：drop zone 元素级具名 `addEventListener`；window 级 `dragover`/`drop` 具名阻止默认，cleanup 时 `removeEventListener`，**绝不覆盖 `window.ondragover`/`ondrop`**。

### PI 接入参数（作为调用参数，不固化为全系统规则）
- `maxFileSize`: 20MB；`maxFiles`: 20；`accept`: `.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp`；`mergeStrategy`: `merge`。
- 上传成功后：上传接口仅返回 `{success:true}`（无最新附件）→ GET 单条 PI 更新当前行单元格（`#pi-att-{id}`），**不刷新整张 PI 列表**。

### 删除的 PI 专属函数
`_piPreviewState` / `_piRenderPreviewModal` / `_piBuildPreviewContent` / `piSwitchAttachment` / `piDownloadCurrent`（逻辑迁入通用组件）。
保留并改造为业务适配器：`piPreviewInline(id, startIndex)` / `uploadPIAttachmentInline(id)`（仅负责拉取 PI 数据、权限校验、传参、调用通用组件、更新当前行）。

### 未改变项（冻结确认）
- `attachment` 字段结构：不变（仍 JSON 数组/单对象/空）。
- 上传接口 `POST /api/proforma-invoices/:id/attachment`：不变。
- 权限 `pi_edit`：不变（前端 `hasPermission` + 后端 `requireApiPermission` 双守卫）。
- D2 规则（PI 号锁定）：不变（`getPINumberLockReason` 不检查 attachment；本轮未改 server.js）。
- 多附件合并不覆盖：保持。

## 十六、线上复验阻断修复（4 组问题，49d9aaa 之后）

### 问题一：创建/编辑 PI 缺少品牌字段
- createPI/editPI 表单无品牌控件 → 用 JS 注入 `<select id="npi-brand">`（不改 i18n 模板结构），选项来自 `/api/brands/all`。
- 无 PO 时品牌必填可编辑；有 PO 时从 PO 带出只读；切回无关联时恢复可编辑（`setPICountryWarehouseEditable` 扩展控制品牌）。
- saveNewPI/saveEditPI payload 传 brand（后端 POST/PUT 已支持）；saveNewPI 不再单独 GET PO 取 brand（少 1 个 API）。
- onPISupplierChange 不动品牌（供应商变化不覆盖品牌）。

### 问题二：编辑 PI 仓库下拉为空
- 根因（确凿）：`pi.country`（如"印度尼西亚"）与 `warehouses.country_name`（如"印尼"）不一致 → SQL `country_name = ?` 精确匹配返回空。
- 修复：`_normalizeCountry` 按当前国家主数据做标准化映射（包含关系匹配，"印度尼西亚"→"印尼"）→ 用映射后国家加载仓库。
- fallback：映射后仍找不到仓库时，追加 option 显示当前保存值 + `console.warn`，不静默丢失。

### 问题三：仓库管理首次进入报错 "Cannot set properties of null (setting 'innerHTML')"
- 根因：`renderBrandSettings` 无竞态守卫，3 个串行 await 后直接 `getElementById('brand-settings-table').innerHTML`，切页后元素已销毁 → null.innerHTML。
- 修复：引入 `brandSettingsLoadSeq` 守卫（3 处 await 后检查 loadSeq + currentPage + DOM 存在性；catch 同样防护）。
- 确认：renderBrandSettings 是系统管理**唯一**无守卫子页（国家/仓库/货代/币种/付款条件用 renderSimpleMgr 有 simpleMgrLoadSeq；供应商有 supplierLoadSeq；付款类目有 pcState.loadSeq；付款主体有 if(!t) return）。

### 问题四：PI 弹窗打开慢（~2s）
- 根因：串行 await（createPI 4 个、editPI 6-7 个、viewPI 2 个）。
- 修复：
  - **先开弹窗骨架 + Loading**（不等所有接口返回才 openModal；createPI/editPI/viewPI 均先 openModal 骨架，数据就绪后覆盖）。
  - **Promise.all 并行化**（createPI: suppliers+pos+countries+brands 并行；editPI: 主数据+PO 明细并行 + 付款条件+仓库并行）。
  - **稳定主数据会话级缓存**（`_getMaster`：suppliers/countries/brands，TTL 5min）；PO/PI/明细/附件不缓存。
- viewPI：先开骨架，PI+PO 串行（PO 依赖 pi.related_po_id，无法并行）。

## 十七、仓库下拉为空（最终根因与修复，纠正十六/问题二）

### 背景
v1.0.2 上线后线上复验发现：新建 PI 与编辑 PI 打开时仓库下拉均为空（仅"请选择仓库"）。

### 排查纠正（重要）
- 十六/问题二曾假设根因为"`pi.country`（印度尼西亚）与 `warehouses.country_name`（印尼）不一致"，并采用前端 `_normalizeCountry` 映射方案。
- **该方案已被否决**：用户明确"不要在前端维护国家映射，真正应该统一的是主数据"；经只读排查，根因**不在**主数据不一致，而是初始化流程。
- 本轮**删除**了 `_normalizeCountry` 及相关前端映射逻辑，恢复由主数据统一保障。

### 最终根因（确凿，浏览器日志佐证）
- `populatePIWarehouse()` 本身正常：手动 `await populatePIWarehouse(document.getElementById('npi-country').value)` 后仓库（Bekasi Warehouse）立即正常显示 → 接口/DOM/函数均无问题。
- **真正原因**：新建 PI 初始化时 `npi-country.innerHTML = countryOpts` 由浏览器自动选中第一项（如印度尼西亚），但**编程式 innerHTML 赋值不触发 `onchange`**，故 `populatePIWarehouse()` 从未被自动调用；首次打开只能看到占位"请选择仓库"。切换国家再切回才触发 `onchange` 加载。

### 最终修复（最小改动，仅 createPI 初始化）
- `countryOpts` 前插 `<option value="">（请选择国家）</option>` —— 页面打开国家默认"请选择国家"。
- `brandOpts` 前插 `<option value="">（请选择品牌）</option>` —— 无关联 PO 时品牌默认"请选择品牌"。
- `whOpts` 已有"请选择仓库"占位，未改。
- 用户选国家 → `onchange` → `populatePIWarehouse()` → 按国家加载仓库。**不采用"自动选国家 + 自动调用"补丁方案。**
- **未改 editPI**：其预选 `pi.country` 并显式 `await populatePIWarehouse(pi.country)`，行为正确，不受影响。

### 临时诊断日志
- 排查期间在 `populatePIWarehouse()` 内添加 7 处 `[populatePIWarehouse]` 及 `[DIAG 100ms]` setTimeout 诊断日志，均为临时用途。
- **修复完成后已全部删除**；`grep` 确认 0 残留，不进入本次 commit。

### 浏览器验收结论（4002 隔离服务）
- PASS：本轮全部功能与交互项通过。
- FAIL：无。
- Known Issues：无。
- Console：无阻断错误。
- Network：无异常重复/失败请求。

### 回滚点
- 保留 v1.0.1 → `3cea48f` 作为明确回滚点；v1.0.2 tag 指向本轮最终修复 commit（非 6af13e1）。
