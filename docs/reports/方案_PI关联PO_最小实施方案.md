# 实施方案：PI 关联 PO 与 PO↔PI 差异对比（最小拆解，仅 PI 页）

> 基线：已定稿《方案_PI关联PO与差异对比_产品梳理.md》（5 决策点 + "PO 单价不依赖 SKU 主数据" 均成立）。
> 本文件只做**实施拆解**，不改代码。每一步标注：改哪些文件 / 是否触表结构 / 只前端 / 只后端。
> 边界（全程不可破）：只做 PI 页；不扩审批中心 / 订单预测 / CI·PL / 停采·失真·多维周转·三页口径·实时回写 / SKU 主数据；不自动生成 PI；不动已调顺逻辑。

---

## 总览（5 条线 → 拆解为 0+A+B+C+D+E+F 七步）

| 步骤 | 对应方案线 | 触表结构 | 只前端 | 只后端 | 改的文件 |
|---|---|---|---|---|---|
| 0 | （基础设施）discount 列 | ✅ 是 | ❌ | ✅ 后端 | db.js |
| A | ① discount 列落库 | ❌ | ❌ | ❌ 前后都动 | server.js + app.js |
| B | ② PO 参考区（只读，B1） | ❌ | ✅ 前端 | ❌ | app.js |
| C | ③ 供应商 PI 导入（模态框内） | ❌ | ✅ 前端 | ❌（首版） | app.js |
| D | ④ 差异引擎 | ❌ | ✅ 前端 | ❌ | app.js |
| E | ⑤ 合并对比表 + 汇总 | ❌ | ✅ 前端 | ❌ | app.js |
| F | ⑥ 弹窗放大 + 表头冻结 | ❌ | ✅ 前端 | ❌ | index.html + app.js |

> 唯一触表结构的是 Step 0。Step A 仅"使用"Step 0 加好的列。Step B/C/D/E/F 全部纯前端，不动后端、不动表。

---

## Step 0 — 加 discount 列（唯一表结构改动）

- **文件**：`db.js`
- **位置**：`initDatabase()` 末尾的「字段迁移（兼容旧数据库）」区
- **改动**：
  ```js
  try { d.exec("ALTER TABLE proforma_invoice_items ADD COLUMN discount REAL DEFAULT 0"); } catch(e) {}
  ```
- **触表结构**：✅ 是（本轮唯一一处）
- **只后端**：✅ 是（db.js 属 Node 后端）
- **风险**：极小。`DEFAULT 0` 向后兼容——已有 PI 明细 discount=0，行为与现在一致；`better-sqlite3` 在旧库上 `ALTER` 幂等（catch 吞掉已存在情况）。
- **验证点**：重启服务后，SQLite 内 `proforma_invoice_items` 表出现 `discount` 列，默认 0。

---

## Step A — discount 落库全链路（后端 + 前端表单）

### A.1 后端 `server.js`
- **`POST /api/proforma-invoices`**：
  - items 入库 INSERT 增加 `discount` 列与对应参数。
  - 金额口径改为含折扣：`amount = round(pi_confirmed_qty × unit_price × (1 - discount))`（discount 缺省 0 → 与现行为一致）。
  - 若请求体某 item 显式带 `pi_amount`，以显式值为准（决策：导入值优先，缺失时反算）。
  - 由此 `total_amount` / `payable_deposit` 自然按含折扣金额累计——discount=0 时数值不变，向后兼容。
- **可选（非必须，标注）**：`POST /api/proforma-invoices/batch-import` 同步读 `discount`。因决策 4 规定"供应商 PI 导入不共用批量导入模板"，批量导入模板本就不含折扣列，故**最小基线可不动** batch-import；如为一致性顺手支持也可，但属可选项，不在强制清单。

### A.2 前端 `app.js`
- **`addPIRow()`**：在 SKU/PO量/PI确认/单价 后增加"折扣"输入框（`type=number step=0.01`，0~1，默认 0）。
- **`saveNewPI()`**：读取折扣并入 `items` payload（字段 `discount`）。
- **`viewPI()`**：PI 明细表增加「折扣」列展示（已保存 PI 回显）。

- **触表结构**：❌（仅用 Step 0 列）
- **只前端**：❌（前后都动）
- **注意**：不碰 `PUT /api/proforma-invoices/:id`（该端点当前不处理 items，仅改 PI 头字段）——本轮不引入 PI 明细编辑后端，避免带坏已调顺逻辑。

### ✅ Step 0 + Step A = 第一个可验收里程碑（"折扣能存能看"）
建一张带折扣的 PI → 看金额是否含折扣、详情是否展示折扣列。此层独立、可单验。

---

## Step B — PO 参考区（仅前端，B1：只读，不写录入区）

- **文件**：`app.js`
- **改动**：关联 PO 下拉 `onchange` 触发 `loadPOForPI()`，**不再**把 PO 明细写进可编辑录入区（改掉旧自动写行为）。
  - 改为：拉取 `GET /api/purchase-orders/:id` 的 `po` 头信息 + `items`，存入 `window._poRef`（模态框内 JS 变量，不落库）。
  - 在明细区顶部渲染一块**只读 PO 信息摘要**（PO号 / 供应商 / 币种 / 品牌 / 国家 / 仓库）。
  - PO 明细本身以**只读列**形式出现在下方「合并对比表」的 PO 侧（见 Step E），不另起一张重复表——既满足"展示 PO 参考明细"，又与 PI 实际数据严格分区（列名已区分 PO / PI，不混淆）。
- **PO 单价约束**：只取 `item.unit_price`；为空/0 则显示空或 0，**不反算、不查 SKU 主数据**（决策 6）。
- **触表结构**：❌ ｜ **只前端**：✅
- **✅ B1 已拍板**：`loadPOForPI` 只渲染只读参考（PO 信息摘要 + 合并表 PO 列），不再向 PI 可编辑列写任何值。

---

## Step C — 供应商 PI 导入（模态框内，填充当前在编 PI 的 PI 列）

- **文件**：`app.js`
- **改动**：在 `createPI()` 模态框明细区新增独立按钮「📥 导入供应商 PI」（与列表页「📤 批量导入PI」并存不冲突）。
  - `DOC_TEMPLATES` 新增独立模板 `supplierPI`（**不共用** 批量导入模板，决策 4）：表头 `['SKU','PI确认数量','PI确认单价','PI折扣']`。
  - 新增 `importSupplierPI(type, file)`：读 Excel/CSV → 按 SKU 匹配合并对比表已有行：命中则填充该行的 PI确认数量 / PI确认单价 / PI折扣；未命中则追加新行（PI 侧有值、PO 侧空 → 状态"PI新增"）。
  - 填充后即时触发 Step D 重算（差异列 + 汇总刷新）。
  - 作用对象 = **当前模态框在编 PI 的 PI 列**，纯前端填充，无新接口；填充后走现有 `POST`（Step A 已支持 discount 落库）。
- **触表结构**：❌ ｜ **只前端**：✅（首版）
- **后端**：❌
- **可选增量（非最小基线）**：填充"已保存 PI"需扩展 `PUT` 处理 items，列为后续，不在本轮。

---

## Step D — 差异引擎（纯前端函数，无落库）

- **文件**：`app.js`（新增 `computePODiff(poRef, piRows)`）
- **输入**：
  - `poRef`：Step B 存入的 `window._poRef.items`（PO 侧，只读）。
  - `piRows`：合并对比表 PI 侧 DOM 行（新建时）或 `GET /api/proforma-invoices/:id` 的 `items`（详情时）。
- **输出**：合并行数组，每条 `{ sku, poQty, piQty, qtyDiff, poPrice, piPrice, priceDiff, poAmount, piAmount, amountDiff, status }`。
- **计算口径（符号约定：差异 = PI − PO，正值 = PI 多于/高于 PO）**：
  - `qtyDiff = piQty − poQty`（数量差异）
  - `priceDiff = piPrice − poPrice`（单价差异）
  - `piAmount = piQty × piPrice × (1 − piDiscount)`（PI金额，含折扣）
  - `poAmount = poQty × poPrice`（PO金额，PO 无折扣）
  - `amountDiff = piAmount − poAmount`（金额差异）
  - 状态枚举：一致 / 仅数量差 / 仅单价差 / 量价均差 / 缺SKU(PO有PI无) / 新增SKU(PI有PO无)
- **触表结构**：❌ ｜ **只前端**：✅ ｜ **落库**：❌（决策 3：首版不建 `pi_diff_snapshots`）
- **设计预留**：`poRef` 接收数组形态，为多张 PO（决策 5）留纯增量空间；本轮只传 1 个 PO。

---

## Step E — 合并对比表 + 汇总（仅前端）

- **文件**：`app.js`
- **改动**：`createPI()` 明细区以**一张**「PO vs PI 合并对比表」为核心（取代 M1 的纯 PI 录入表；M1 正式表头要求在此保留演进）。
  - **列（正式表头，固定 11 列）**：SKU | PO数量 | PI确认数量 | PO单价 | PI确认单价 | PI折扣 | PI金额 | 数量差异 | 单价差异 | 金额差异 | 操作
    - PO数量 / PO单价 / PO金额：只读，来自 `window._poRef`（Step B）；PO 未关联时为空。
    - PI确认数量 / PI确认单价 / PI折扣 / PI金额：可编辑（手动录入或 Step C 导入填充）。
    - 数量差异 / 单价差异 / 金额差异：只读，由 Step D 实时算。
    - 操作：删除该行（PI 侧）。
  - **汇总（`<tfoot>` 行）**：PO数量汇总 | PI确认数量汇总 | PI金额汇总（必含）；数量差异汇总 | 金额差异汇总（一并给出）。其余列汇总格留空。
  - **实时性**：任意 PI 侧输入变化或导入后，立即重算差异列与汇总（决策 2：零额外点击）。
  - `viewPI()` 详情内复用同一引擎与同一表结构（已保存 PI：PI 侧取 `items`，PO 侧按 `related_po_id` 现拉），新增"差异对比"区。
- **触表结构**：❌ ｜ **只前端**：✅
- **依赖**：Step B（PO 只读列）+ Step C（PI 导入填 PI 列）+ Step D（引擎）齐备后，本表才有意义；故 B/C/D/E 一起做、一起验。

---

## Step F — 弹窗放大 + 表头冻结（仅前端，承载 M2 大内容）

- **文件**：`index.html`（CSS）+ `app.js`（`openModal` 增加可选 `modalClass` 参数，`createPI` 传 `'modal-lg'`）
- **改动**：
  - `openModal(title, body, footer, modalClass='')` → `#modal-content` 加 `modalClass`。
  - 新增 CSS `.modal.modal-lg`：
    - `max-width:1120px; width:96%`（原 700px → 约 1.6 倍宽，减少两侧留白）；
    - `max-height:94vh`（原 90vh，略增）；
    - `display:flex; flex-direction:column; overflow:hidden`（原整框 `overflow-y:auto` 改为**仅 body 滚动**，header/footer 固定不滚）。
    - `.modal-lg .modal-body{overflow-y:auto; flex:1; max-height:none; padding:20px 24px}`（主体可滚动、多占空间）。
    - `.modal-lg .modal-header, .modal-lg .modal-footer{flex:0 0 auto}`。
  - **表头冻结（要求 2 落地）**：合并对比表 `thead th{position:sticky; top:0; background:var(--card-bg); z-index:2}`，滚动时表头固定；导入预览表、详情差异表复用同一 sticky 规则。
  - **隔离风险**：仅 `modal-lg` 受影响，默认 `.modal` 不变 → 其它弹窗（审批详情等）不受影响，不把已调顺逻辑带坏。
- **触表结构**：❌ ｜ **只前端**：✅

---

## 验收里程碑建议（你问的"先做哪层可开始验收"）

**里程碑 1（后端 + 前端，折扣全链路 + 正式表头）** = Step 0 + Step A + M1 补表头（已交付并验收）
- 折扣能存能看 + 新建/编辑 PI 已有正式表头 + 详情可看折扣。✅ 已完成。

**里程碑 2（纯前端六步，端到端）** = Step B + C + D + E + F
- 完成即可验收：关联 PO 出只读参考（PO 信息摘要 + 合并表 PO 只读列）→ 供应商 PI 在模态框内导入填充 PI 列 → 实时差异引擎（数量/单价/金额差异）→ 合并对比表（11 列正式表头 + tfoot 汇总）→ 弹窗放大 + 表头冻结。
- 这六步全在前端、共享同一份 PO 数据与 PI 录入数据，连动性强，建议**合并做完后一次性验收**。

> 两里程碑之间互不影响：里程碑 1 不改前端展示结构（只加折扣列/输入框/详情列/表头）；里程碑 2 不改后端、不改表，风险隔离清晰。

---

## 不改清单（再次明确保证）
- 审批中心 / 订单预测 / CI·PL / 停采·失真·多维周转·三页口径·实时回写 / 采购链状态机 / submit-approval·approve
- SKU 主数据（PO 参考区单价绝不回查 SKU 主数据表）
- 不引入"PO 审批通过自动生成 PI"
- `PUT /api/proforma-invoices/:id` 当前不处理 items（不扩 PI 明细编辑后端，除非你后续要求）
- 现有批量导入（`batch-import`）模板与逻辑保持不变，与供应商 PI 导入并存

---

## 新增两个展示要求（2026-07-11 用户补充，已并入实现）
- **要求 1 正式表头** → 已并入里程碑 1（新建/编辑 PI 表单改带 `<thead>` 表格；discount 不再是裸 0 输入框）。✅ 已交付。
- **要求 2 表头冻结(sticky)** → 已并入里程碑 2 Step F（合并对比表 / 导入预览表 / 详情差异表统一 sticky；弹窗放大仅作用于 `modal-lg`，不影响其它弹窗）。

> 两要求均**只动 PI 页**。不改审批中心 / 订单预测 / CI·PL / 停采·失真·多维周转·三页口径·实时回写 / SKU 主数据；不动 `loadPOForPI` 自动写行为（归 M2 Step B1，本轮改为只读参考）。

---

## 待你拍板后开改的开放项（M2 收口前确认）
1. **差异符号约定**：本方案采用 `差异 = PI − PO`（正值=PI 多于/高于 PO）。若你希望反过来（PO − PI，正值=PO 比 PI 多），请拍板。
2. **单表合并 vs 分表**：本方案采用「一张合并对比表」同时承载 PO 只读列 + PI 可编列 + 差异列（满足你列的 11 列同表）；不另起独立"PO 参考表"。是否认可此单表结构？
3. **汇总范围**：本方案 tfoot 含 PO数量汇总 / PI确认数量汇总 / PI金额汇总（必含）+ 数量差异汇总 / 金额差异汇总（一并给）。若只要前三项，请拍板。
4. ~~Step B 选项 B1 vs B2~~ —— **已拍板 B1**（只读参考，不写录入区）。

- 其余均按已定稿方案与本轮补充直接执行，无歧义。

---

## 里程碑2 方案收敛 v2（2026-07-11 深夜，用户两点补充）

### 一、合并对比表列结构调整（去掉行级"金额差异"，保留汇总"金额差异汇总"）

**当前行级 11 列**（createPI / viewPI 只读表同构）：
`SKU | PO数量 | PI确认数量 | PO单价 | PI确认单价 | PI折扣 | PI金额 | 数量差异 | 单价差异 | 金额差异 | 操作`

**调整后行级 10 列**（去掉"金额差异"）：
`SKU | PO数量 | PI确认数量 | PO单价 | PI确认单价 | PI折扣 | PI金额 | 数量差异 | 单价差异 | 操作`

- 理由：金额差异 = (PI确认数量×PI确认单价×(1−折扣)) − (PO数量×PO单价) 可由其它列推导，行级去掉更不挤。
- **汇总层保留"金额差异汇总"**，但行级已无对应列，故 footer 用 `colspan` 收口：
  - 新建态 footer：`<tr><td>汇总</td><td>PO数量汇总</td><td>PI确认数量汇总</td><td></td><td></td><td></td><td>PI金额汇总</td><td>数量差异汇总</td><td colspan="2">金额差异汇总</td></tr>`
    （数量差异汇总对齐"数量差异"列；金额差异汇总跨"单价差异+操作"两列，落在表尾）
  - 详情只读表 footer 同理，跨"单价差异+状态"两列放"金额差异汇总"。
- **两表一致**：createPI 合并表（列尾=操作）与 viewPI 只读对比表（列尾=状态）都做同样行级去列 + footer colspan 收口，保证视觉一致。

### 二、供应商 PI 导入交互 → 复用"销售数据导入"那套成熟交互

**销售数据导入交互要素（app.js 1427–1654，已确认成熟可用）**：
1. 入口：独立按钮 `openSalesBatchImport()` 打开独立导入弹窗
2. 上传区：虚线拖拽区 `sales-drop-zone`（🛒 图标 + "点击上传或拖拽文件" + 支持 dragover/drop）+ 隐藏 file input（accept .xlsx/.xls/.csv）
3. 说明区：蓝色边框"导入说明"框（唯一键 / 校验规则 / 注意事项）
4. 模板下载：页脚"下载模板"按钮 → `downloadSalesTemplate()` 用 `SALES_IMPORT_COLUMNS` 生成带示例行的 xlsx
5. 选文件后：`handleSalesFile()` 校验扩展名 → FileReader 读（csv readAsText / 其它 readAsArrayBuffer）→ XLSX 解析 `sheet_to_json(header:1)` → 逐行按列定义映射 + 校验收 `_errors` → `renderSalesPreview()` 预览（前 20 行 + 有效/无效计数 + 无效明细）+ 调后台预览统计
6. 结果反馈：`submitSalesBatchImport()` 显示"导入完成报告"（总/新增/更新/重复/失败 + 失败明细可"下载失败明细" xlsx）→ `showToast` → 刷新列表

**供应商 PI 导入对齐映射（功能仍属"新建 PI 页面"，交互复用上述）**：

| 销售数据导入 | 供应商 PI 导入（拟） |
|---|---|
| 入口 `openSalesBatchImport` | 入口：新建 PI 弹窗内「📥 导入供应商PI」按钮（保留在工具栏，与 ➕添加行 / 📄模板 并列） |
| 弹窗「批量导入销售数据」 | **嵌套导入弹窗**「导入供应商 PI」，叠在新建 PI 弹窗之上 |
| 拖拽上传区 + 说明 | 复用同款拖拽上传区 + 导入说明（列：SKU/PI确认数量/PI确认单价/PI折扣；按 SKU 匹配已关联 PO 行回填，未匹配则新增行；不单独入库，回填后随 PI 创建一并提交） |
| 列定义 + 校验 | `SUPPLIER_PI_IMPORT_COLUMNS`（SKU 必填；PI确认数量>0；PI确认单价≥0；PI折扣 0~1）+ 同款 `_errors` 校验 |
| 预览 `renderSalesPreview` | 复用同款预览（行号/SKU/PI确认数量/PI确认单价/校验状态 + 前 20 行 + 无效明细） |
| 模板 `downloadSalesTemplate` | `downloadSupplierPITemplate()` 同款 xlsx 生成（带示例行） |
| 结果报告 `submitSalesBatchImport` | 结果报告（成功回填 N 行 / 跳过 N 行 / 失败 N 行 + 失败明细下载）→ 回填到新建 PI 对比表 |
| 回填：写后台 DB | **回填：`window._piRows`**（SKU 匹配填 PI 列、未匹配新增行）→ `renderCmpTable()` 重算对比表 → 关闭导入弹窗 |

- **关键功能差异（仅此一处不同，交互形态一致）**：销售导入是"直接写后台"；供应商 PI 导入是"回填到新建 PI 弹窗的对比表，等用户点创建才落库"。这是你定的"放在新建 PI 页面里完成"的本质，保留。
- **合并逻辑不变**：沿用现有 `handleSupplierPIFile` 的 SKU 匹配（命中填 PI 列 / 未命中追加新行）+ `recomputeCmpFooter` 实时汇总。

### ⚠️ 唯一开放项：导入交互的"承载方式"（开改前请你拍板）

目标：既要"放在新建 PI 页面里完成"，又要"复用销售数据导入那套弹窗式交互"。两者需选一种承载：

- **方案 A（嵌套导入弹窗，最贴近销售导入交互）【推荐】**：从新建 PI 弹窗点「📥 导入供应商PI」→ 弹出一个**独立 overlay 导入弹窗**（动态创建、叠在新建 PI 弹窗之上，不破坏下层录入状态）→ 走完整拖拽/说明/预览/结果/失败明细下载/模板 → 成功后把数据回填 `window._piRows` 并重算对比表 → 关闭导入弹窗，**新建 PI 弹窗原样保留**。
  - 优点：交互与销售导入几乎完全一致；不丢失新建 PI 的录入。
  - 代价：需新增一个独立的 overlay 渲染（不复用单例 `openModal`，避免覆盖下层）。

- **方案 B（新建 PI 弹窗内联导入区）**：在新建 PI 弹窗 body 内（对比表下方或工具栏展开）直接内嵌同款拖拽上传区 + 预览 + 结果（视觉同销售导入），不另开弹窗；数据即时回填对比表。
  - 优点：严格"都在一个弹窗里"，最简单。
  - 代价：新建 PI 弹窗本就含表单 + 11 列大表，再内嵌完整导入区会偏挤；表头冻结/滚动区需重新平衡。

> 我推荐 **方案 A**：它最忠实于"复用销售数据导入那套成熟交互"，同时"入口与数据归属都在新建 PI 页面"，且不丢失已录入内容。若你更看重"全程单弹窗不叠加"，选 B。

### 收敛后落地文件（仅前端，零后端零表改动）
- `app.js`：
  - `cmpRowHTML` / `recomputeCmpFooter`（新建态）：去"金额差异"列，footer `colspan` 收口金额差异汇总
  - `renderCmpReadonly`（详情态）：同步去行级"金额差异"，footer `colspan` 收口
  - 替换 `importSupplierPI` / `handleSupplierPIFile` 为：嵌套导入弹窗 + `SUPPLIER_PI_IMPORT_COLUMNS` + `renderSupplierPIPreview` + `submitSupplierPIImport`（回填 `_piRows`）+ `downloadSupplierPITemplate`
  - 保留 `DOC_TEMPLATES.supplierPI`（或改为显式示例行生成，与销售模板一致）
- `index.html`：无需为方案 A 新增样式（复用 `.modal`/`.data-table` 类）；若方案 B 则微调新建 PI 弹窗内联区样式。
- 不改：server.js / db.js / 审批中心 / 订单预测 / CI·PL / 停采失真多维周转三页口径实时回写 / SKU 主数据 / `loadPOForPI` 只读参考（B1 已定）。

---

## 收敛 v2 实现状态（2026-07-11 收口后，已开改完成 ✅）

- **两决策已落地**：① 行级去"金额差异"列（10 列），footer 保留"金额差异汇总"（colspan 收口）；② 导入选方案 A（嵌套独立 overlay 弹窗，z-index 1500，叠在新建 PI 主弹窗之上）。
- **列结构（createPI + viewPI 只读表一致）**：`SKU | PO数量 | PI确认数量 | PO单价 | PI确认单价 | PI折扣 | PI金额 | 数量差异 | 单价差异 | 操作(新建态)/状态(详情态)`。
- **footer（10 列）**：汇总 / PO数量汇总 / PI确认数量汇总 / (空×3) / PI金额汇总 / 数量差异汇总 / colspan=2 金额差异汇总。
- **导入交互（对齐销售数据导入）**：`openSupplierPIImport()` 动态建 `#supplier-pi-import-overlay`（class `modal-overlay show` + `z-index:1500`，内嵌 `.modal.modal-lg`）；拖拽区 + 导入说明 + 预览（前 20 行 + 有效/无效 + 无效明细）+ 结果报告（匹配回填/新增行/跳过）+ 失败明细下载 + 模板下载（`downloadDocTemplate('supplierPI')`）。`closeSupplierPIImport()` 仅移除 overlay，新建 PI 主弹窗原样保留。
- **回填**：`submitSupplierPIImport()` 按 SKU 匹配 `window._piRows`（命中填 PI 列/未命中追加 newPO=false 行）→ `renderCmpTable()` 重算 → 关闭 overlay。零后端零表改动。
- `node --check app.js` 通过；无旧 `importSupplierPI`/`supplier-pi-file` 残留引用。
- 边界守住：审批中心 / 订单预测 / CI·PL / 停采失真多维周转三页口径实时回写 / SKU 主数据 / `loadPOForPI` 只读参考（B1）/ 后端 / 表结构 —— 均未动。

### 验收点（收敛 v2）
1. 新建 PI 关联 PO → 合并对比表行级**只有 10 列**（无"金额差异"列），footer 仍有"金额差异汇总"（跨尾列显示）
2. 详情页只读对比表同样行级去"金额差异"
3. 点「📥 导入供应商PI」→ 走与销售导入一致的交互（拖拽区/说明/预览校验/结果报告/失败明细下载/模板）→ 回填对比表 → 关闭后新建 PI 弹窗录入不变

---

# 下一轮方案收敛：供应商多条结构化付款条件（里程碑 3 草案）

> 触发：用户在里程碑 2 验收期间提出的新需求。本轮**只做方案收敛，不动代码**。目标：供应商可维护多条结构化付款条件；新建 PI 按供应商下拉选择；默认带出"上一次用的那条"但仍可改选；PI 负责条款、CI 负责金额（现有口径不变）。

## 0. 现状事实（已核查代码，非臆测）
- `createPI` 当前付款条件是一个**自由文本输入框** `npi-terms`（app.js:4534）；`saveNewPI`（app.js:4686）读它 → 以 `payment_terms` 文本存入 `proforma_invoices.payment_terms`。
- 系统**已有一个 `payment_terms` 表**（db.js:209）：字段 `name/payee_type/payment_type/payment_stage/payment_node/ratio/remind_days_before/is_enabled`，由 `renderPaymentTerms`（app.js:520）管理，是**付款申请单用的全局付款条件目录（定金/尾款/比例/节点）**——**与"供应商付款条件"是两回事，不能复用**，否则会带坏付款申请模块（边界红线）。
- `suppliers.payment_terms` TEXT 字段（db.js:148）当前**前端从未渲染/写入**（供应商弹窗无此输入），等于废弃可用。
- CI 侧只算 `goods_amount`/`payable_balance` 实际付款金额，与 PI 条款天然分离——本功能不碰 CI，口径延续。

## 1. 供应商管理页怎么维护"多条付款条件"（Q1）
- **新增独立表 `supplier_payment_terms`**（不碰现有 `payment_terms` 目录表）：
  ```
  id TEXT PK
  supplier_id TEXT NOT NULL
  term_name TEXT NOT NULL        -- 自由文本，如 "T/T 100% in advance" / "Credit"
  term_type TEXT DEFAULT 'advance'   -- 'advance'|'credit'|'other'（混合可由用户用 term_name 自由命名表达）
  credit_days INTEGER DEFAULT 0      -- 仅 term_type='credit'/'other' 中实际为信用时手动填天数，不做固定选项
  is_default INTEGER DEFAULT 0       -- 供应商级人工标记的默认项（1=默认）
  display_order INTEGER DEFAULT 0
  status TEXT DEFAULT 'active'
  created_at TEXT DEFAULT (datetime('now'))
  ```
- **供应商弹窗（`openSupplierModal`）新增"付款条件"分区**：
  - 内存数组 `window._supTerms` 维护；列出该供应商已有条件（term_name 输入框 + term_type 下拉 + credit_days 数字框[仅 credit/other 显示] + "默认"单选 + 删除按钮）+「➕ 添加付款条件」按钮。
  - 若 `term_type` 选 `credit` 或 `other`，显示"信用天数"数字输入框（手动填，非固定选项）。
  - `saveSupplier` 提交时多带 `payment_terms_list` 数组；后端 `POST /api/suppliers` 做**对账式 upsert**（删掉不在列表里的、更新/插入在列表里的），保持最小后端面。
- 维护入口权限复用 `system_config`（与供应商管理同级），不新增权限点。

## 2. 新建 PI 页面怎么下拉选择（Q2）
- `createPI` 把 `<input id="npi-terms">` 换成 `<select id="npi-term">`。
- `npi-sup` 加 `onchange="onPiSupplierChange()"`；`loadPOForPI` 在设完 `npi-sup.value` 后**手动调一次** `onPiSupplierChange()`（程序赋值不触发 onchange）。
- `onPiSupplierChange()`：`GET /api/suppliers/:id/payment-terms` → 填充下拉（选项文案 = `term_name` + 信用时追加 `(Credit N天)`）→ 按 Q3 规则预选默认值。
- 下拉选项始终列出该供应商**全部**条件，满足"可改选、不锁死"。

## 3. "默认带出上一次用的，但仍可改选"怎么设计最稳（Q3）
预选优先级（在 `onPiSupplierChange` 内）：
1. **上一次保存 PI 用过的那条**：`suppliers.last_used_payment_term_id` 命中且该 term 仍存在 → 预选它（用户明确诉求，权重最高）。
2. 否则 → 该供应商 `is_default=1` 的那条 → 预选。
3. 否则 → 空白（占位"请选择付款条件"）。
- 无论预选哪条，**下拉永远列出全部条件**，用户随时可改选，不锁死。
- **"上一次用的"如何记录**：PI 保存成功时，`POST /api/proforma-invoices` 在落库后用选中的 `payment_term_id` 回写 `suppliers.last_used_payment_term_id`。下次同供应商新建 PI 即自动带出。
- 鲁棒性：若 `last_used_payment_term_id` 指向已删除项 → 自动降级到第 2/3 条，不会报错。
- **存储双写**（保兼容）：PI 仍写 `payment_terms` 文本（= 选中项的**组合可读串**，如 "T/T 100% in advance" 或 "Credit (60天)"），同时新增 `proforma_invoices.payment_term_id` 列做追溯。这样即使条件日后被删，历史 PI 详情仍能显示条款文字（现有 `viewPI` 已展示 `payment_terms`，无需改视图）。

## 4. 最小范围接入，不带坏已调顺模块（Q4）
- **新增 1 张表** `supplier_payment_terms`（与付款申请用的 `payment_terms` 目录表完全独立，零耦合）。
- **ALTER 2 列**（均 `DEFAULT ''/0`，向后兼容，旧数据无影响）：
  - `suppliers.last_used_payment_term_id TEXT DEFAULT ''`
  - `proforma_invoices.payment_term_id TEXT DEFAULT ''`
- **后端新增端点**（仅供应商付款条件 CRUD + PI 保存时回写 last_used）：
  - `GET /api/suppliers/:id/payment-terms`
  - `POST /api/suppliers/:id/payment-terms`（新增一条）
  - `PUT /api/supplier-payment-terms/:id`
  - `DELETE /api/supplier-payment-terms/:id`（删默认项时把 `is_default` 置 0 即可，不做级联）
  - `POST /api/proforma-invoices` 已存在，仅扩展：接收 `payment_term_id`、组合 `payment_terms` 串、落库后 `UPDATE suppliers SET last_used_payment_term_id`。
- **前端改动**：供应商弹窗加付款条件分区 + `saveSupplier` 带 `payment_terms_list`；`createPI` 文本款改下拉 + `onPiSupplierChange`；`saveNewPI` 改读 `npi-term` 并传 `payment_term_id`；`viewPI` 基本不动（已显示 `payment_terms`）。
- **明确不动**：现有 `payment_terms` 目录表 / 付款申请模块 / CI·PL / 审批中心 / 订单预测 / 停采·失真·多维周转·三页口径·实时回写 / SKU 主数据 / 里程碑 2 已落地的合并对比表与导入弹窗。

## 5. 待你拍板的开放项
1. **term_type 枚举范围**：我拟 `预付(advance) / 信用(credit) / 其他(other)` 三类，混合条款用 term_name 自由命名表达。是否认可？（或你要显式加"混合(mixed)"？）
2. **供应商弹窗内维护方式**：我拟"弹窗内嵌子表（内存数组 `window._supTerms` + 保存时批量对账）"，不新开独立页面。认可？
3. **默认优先级**：上一次 PI 用过的 > 供应商 `is_default` > 空白。与你的描述一致，确认？
4. **`payment_term_id` 追溯列**：我建议加（低风险 ALTER），以便日后分析"某条件被哪些 PI 用过"。如想绝对最小，可只存 `payment_terms` 文本、不加此列——但会失去追溯能力。你选？

> 以上 4 项拍板后，再按"建表 → 供应商弹窗维护 → 新建 PI 下拉 + 默认带出 → PI 保存回写 last_used"顺序开改；仍先做完一轮交你验收，不自动续做别的。

---

## 6. 拍板确认（2026-07-12，用户定稿，后续不得推翻）

**4 个开放项结论：**
1. **term_type 枚举**：`advance(预付) / credit(信用) / other(其他)` 三类。**不加"混合"**，更复杂条款用 `term_name` 自由文本表达。
2. **维护方式**：放【供应商编辑弹窗】内嵌子表维护，**不新开页面**。
3. **默认优先级**：① 上一次该供应商保存 PI 时实际使用的付款条件 → ② 供应商默认付款条件 → ③ 空白。**下拉选项始终保留，可手动改选**。
4. **`payment_term_id` 追溯列**：**加**。前台继续显示可读文本，内部保留 `payment_term_id` 供追溯/计算。

**业务口径（钉死，不得混淆）：**
1. 一个供应商可维护多条付款条件。
2. 新建 PI 时：按当前供应商拉付款条件下拉；默认带出"上一次该供应商实际使用的付款条件"；下拉必须保留，可改选。
3. **Credit 天数不做固定选项**：直接数字输入框，手动填写天数。
4. **付款条件口径跟 PI 走**。
5. **付款金额口径跟 CI 走**：实际付款金额按 CI 金额算，不按 PI 金额算（PI 不一定完全出货，CI 才是实际出货金额依据）。

**边界（继续锁死）：** 本轮只做【供应商管理 + PI 付款条件】；不动付款申请模块现有 `payment_terms` 目录表 / 审批中心 / 订单预测 / CI·PL 现有逻辑 / 停采·失真·多维周转·三页口径·实时回写 / SKU 主数据；不带坏已调顺逻辑。

---

## 7. 实施拆解（4 层，逐层验收）

| 层 | 改什么 | 涉及文件 | 验收标志 |
|----|--------|----------|----------|
| **L1 建表** | 新建 `supplier_payment_terms` 表；ALTER `suppliers.last_used_payment_term_id`、`proforma_invoices.payment_term_id`（均低风险加列） | `db.js` | 服务启动无报错；新表与新列存在，旧数据不受影响 |
| **L2 供应商弹窗子表** | 供应商编辑弹窗内嵌"付款条件"分区（`window._supTerms` 增删改+默认单选+credit天数数字框）；`saveSupplier` 批量对账落库；新增供应商付款条件 CRUD 端点 | `app.js`、`server.js` | 能在供应商弹窗里加/删/改多条付款条件并保存、重开回显、设默认 |
| **L3 PI 下拉联动** | `createPI` 文本框改 `<select id="npi-term">`；`onPiSupplierChange` 按供应商拉条件并按优先级预选（下拉保留可改）；`saveNewPI` 改读下拉、传 `payment_term_id`+可读文本 | `app.js` | 换供应商→下拉刷新；默认按优先级带出；可手动改选；保存成功 |
| **L4 回写 last_used** | `POST /api/proforma-invoices` 落库后回写 `suppliers.last_used_payment_term_id`；PI 双写 `payment_terms` 文本 + `payment_term_id` | `server.js` | 保存一次 PI 后，同供应商再新建 PI 默认带出刚用过的那条 |

**执行策略**：L1 → 你验收 → L2 → 你验收 → L3+L4 一起（联动+回写强相关）→ 你验收。每层做完只回该层结果，不自动续做下一层。
