# Phase 3-C-4 全系统动态文本国际化审计（只读）

**生成时间**: 2026-07-21 07:09:11  
**范围**: 只读扫描，未修改任何源码 / 未翻译 / 未 commit。  
**扫描对象**: `app.js` (前端渲染), `server.js` (API 文案)。  
**方法**: 使用 acorn 解析为 AST，提取所有含 CJK 的字符串字面量；排除注释、`console.*` 内部日志；区分「已接入 `t()` 的 fallback 中文」与「未接入 `t()` 的硬编码中文」。

## 0. 合规声明（遵守既有冻结规则）
- ✅ 本阶段**仅输出审计结果**，未改动任何代码。
- ✅ HTML 结构不可改变：后续若实施，i18n 修改只允许替换文字，不得改动 tag/id/class/onclick/data 属性/\{vN\}。
- ✅ 订单预测页面结构冻结（仅文本接线，不重构 render）。
- ✅ 所有后续修改必须先审计、再方案、经用户确认后实施（顺序门禁）。

## 1. 执行摘要（Executive Summary）

| 指标 | 数值 |
|---|---|
| 未接入 t() 的硬编码中文（用户可见）唯一文本数 | **1424** |
| 涉及函数数 | **396** |
| 类型 A（必须国际化） | 1320 |
| 类型 C（需确认：状态/枚举/生命周期值） | 104 |
| 类型 B（不需国际化，见附录 C） | 0（语言无关数据多为非 CJK，已被扫描自动排除） |
| 优先级 P0（高，状态/枚举/高频按钮表头） | 128 |
| 优先级 P1（中，表头/弹窗/表单/提示） | 936 |
| 优先级 P2（低，长描述/帮助/罕见提示） | 360 |
| 已接入 t() 但 fallback 为中文的唯一文本（二次覆盖检查项） | 753（共 1153 处） |

**按模块分布（唯一硬编码文本数）**:

| 模块 | 唯一文本数 |
|---|---|
| Inventory | 163 |
| Procurement | 236 |
| Finance | 660 |
| Sales | 118 |
| Approval | 33 |
| Cross-cutting | 213 |

> **根因说明**: 英文/印尼语模式下出现中文混杂，主要来自这 1424 处**未包 `t()`** 的硬编码中文（无论切到何种语言都显示中文）。另有 1153 处已包 `t()` 的字符串，仅在 `dict.en/dict.id` 缺失对应 key 时才回退中文（属覆盖缺口，见附录 D）。

## 2. 分类方法（A / B / C）

- **A. 必须国际化**：表头、按钮、状态标签、生命周期、风险等级、建议动作、空状态提示、Modal、筛选条件、字段配置、业务提示等所有用户可见文本。
- **B. 不需要国际化**：SKU 编码、品牌名、仓库名、国家真实数据值、供应商名称等语言无关数据。这些多为非 CJK（英文/编码），本 CJK 扫描天然不命中；附录 C 单列说明。
- **C. 需要确认**：业务状态值 / 数据库枚举 / 系统内部 code 的显示文本。已存在集中映射（`STATUS_KEY_MAP` → `status.*` 键、`SKU_LIFECYCLE_MAP` 等），建议沿用「DB 值不变、显示走 i18n key、缺失回退中文」模式，需确认键策略后实施。

## 3. 逐模块函数级清单（Dynamic Localization Inventory）

> 每行 = 一个函数。`代表性硬编码文本` 为该函数在扫描中命中的前若干唯一中文（格式：文本(出现次数)）。完整逐文本清单见 `dynamic-localization-plan.json`。

### 1. Inventory 模块 （61 个函数，唯一文本 163 处）

| 函数 | 文件 | 页面 | 类型 | 优先级 | 代表性硬编码文本（文本(次数)） |
|---|---|---|---|---|---|
| `classifySkuState` | server.js | SKU Master | C/A | P0 | 正常动销(3) · 销量与周转正常(2) · 清仓(2) · 停采/停产(2) · 新品/销售数据不足(2) |
| `invBuildBatchModal` | app.js | Inventory List | A | P1 | 📋 操作预览(1) · 影响记录数:(1) · 涉及SKU数:(1) · 涉及库存数量:(1) · 涉及国家:(1) |
| `submitInvBatchImport` | app.js | Inventory List | A | P1 | 条(2) · 没有可导入的有效数据(1) · 请填写库存快照截止日期(1) · 导入完成(1) · 已新增：(1) |
| `submitSkuBatchImport` | app.js | SKU Master | A | P1 | 条(3) · 没有可导入的有效数据(1) · 导入完成(1) · 已新增：(1) · 已更新：(1) |
| `showBatchResultModal` | app.js | Other | A/C | P0 | 📊 批量操作结果报告 ×(1) · 成功(1) · 失败(1) · 跳过(1) · % 成功率(1) |
| `showSkuImportRecords` | app.js | SKU Master | A/C | P0 | 加载中...(1) · 关闭(1) · 当前SKU主数据概况(1) · 指标 数量(1) · SKU总数(1) |
| `SKU_LIFECYCLE_MAP` | app.js | SKU Master | A/C | P0 | 新品导入(1) · 新品启动(1) · 成长期(1) · 成熟期(1) · 衰退期(1) |
| `OB_TYPE_MAP` | server.js | Other | C/A | P0 | 线上销售(1) · 线下销售(1) · MDF达人(1) · MDF活动(1) · 调拨(1) |
| `renderSkuPreview` | app.js | SKU Master | A | P1 | 条(2) · 共(1) · 条数据 ， 有效(1) · ， 无效(1) · 行 SKU编码 产品名称 品牌 型号 生命周期 状态 校验(1) |
| `openInvBatchImport` | app.js | Inventory List | A/C | P0 | 库存快照截止日期(1) · 当前导入的可用库存已经完整扣除出库数据的最后一天。例如今天是7月5日但当天还没结束，截止日期应填7月4日。 必填，不填写不允许导入。(1) · 加权平均成本说明(1) · 加权平均成本由系统按最新已确认成本版本自动匹配，导入文件中的加权成本列将被忽略。(1) · 点击上传或拖拽文件到此处(1) |
| `renderInvPreview` | app.js | Inventory List | A | P1 | 条(2) · 共(1) · 条数据 ， 有效(1) · ， 无效(1) · 行 SKU编码 品牌 导入日期 国家 仓库 可用数量 加权成本 最后入库日期 校验(1) |
| `shouldBlockReplenish` | app.js | Order Forecast | C/A | P0 | 清仓(2) · 慢销(2) · 停采/停产(1) · 无有效销售(1) · 呆滞(1) |
| `invBatchExport` | app.js | Inventory List | A/C | P0 | 可用库存(1) · 在途(1) · 库存状态(1) · 备注(1) · 是(1) |
| `COUNTRY_ALIAS_MAP` | server.js | Other | C | P0 | 印度尼西亚(1) · 印尼(1) · 印度尼西亚共和国(1) · 马来西亚(1) · 马来(1) |
| `loadSKUs` | app.js | SKU Master | A/C | P0 | 新品导入(1) · 品牌 Category Model SKU 产品名称 EAN(1) · 状态 生命周期 是否停采 创建时间 更新时间 操作(1) · 启用(1) · 是(1) |
| `loadInv` | app.js | Inventory List | A/C | P0 | 无汇率(1) · 汇率((1) · 🔄 刷新(1) · 可用(1) · 在途(1) |
| `batchSkuDelete` | app.js | SKU Master | A/C | P0 | 已删除(1) · 个(1) · ，失败(1) · 个（有关联业务数据）(1) · 删除失败的SKU：(1) |
| `SKU_STATUS_MAP` | app.js | SKU Master | C | P0 | 启用(1) · 正常(1) · 清仓(1) · 停用(1) · 停采(1) |
| `importOriginInventory` | app.js | Inventory List | A | P1 | 请先选择CI(1) · 文件为空(1) · 国家(1) · 仓库(1) · 备注(1) |
| `INVENTORY_STATUS_MAP` | server.js | Inventory List | C | P0 | 正常(1) · 断货风险(1) · 高库存(1) · 慢销(1) · 清仓(1) |
| `INVENTORY_STATUS_LABELS` | server.js | Inventory List | C | P0 | 正常(1) · 断货风险(1) · 高库存(1) · 慢销(1) · 清仓(1) |
| `editSimple` | app.js | Other | A | P1 | "> 是 否(1) · ')">全选(1) · ')">清空 不选 = 适用于所有品牌(1) · 编辑(1) · 新增(1) |
| `loadBatchTasks` | app.js | Other | A | P1 | 📭 暂无批量任务(1) · 任务名称 操作人 页面 状态 总数 成功 失败 跳过 开始时间 错误报告(1) · ')">📥 下载(1) · 📭 暂无操作日志(1) · 时间 操作人 页面 操作 影响数 原因 重算(1) |
| `downloadTaskErrors` | app.js | Other | A | P1 | 无错误数据(1) · XLSX库未加载(1) · 失败原因(1) · 任务错误报告_(1) · 下载失败:(1) |
| `renderSKUs` | app.js | SKU Master | A | P1 | 全部品牌(2) · 全部生命周期(2) · 全部状态(2) · 新品导入 新品启动 成长期 成熟期 衰退期 滞销 清仓期 停采/停产(1) · 启用 停用 清仓 停产(1) |
| `openSkuBatchImport` | app.js | SKU Master | A/C | P0 | 点击上传或拖拽文件到此处(1) · 支持 .xlsx / .xls / .csv 格式(1) · 下载模板(1) · 关闭(1) · 开始导入(1) |
| `invBatchExecute` | app.js | Inventory List | A | P1 | 请输入有效的安全库存(1) · 请输入有效的目标周转月数(1) · 调整原因不能为空(1) · 删除原因不能为空(1) · 批量操作失败:(1) |
| `renderBatchTasks` | app.js | Other | A | P1 | 页面 全部 库存总表 销售数据 SKU主数据(1) · 刷新(1) · 📋 批量任务(1) · 📜 操作日志(1) |
| `editSKU` | app.js | SKU Master | A | P1 | 类目(1) · 否(1) · 是(1) · 编辑SKU(1) |
| `loadStag` | app.js | Slow Moving Analysis | A | P1 | ✅ 暂无呆滞库存(1) · 呆滞库存总金额(1) · 呆滞SKU数 SKU 产品名 品牌 国家 仓库 库存 金额 最后销售 距今天数 30d 60d 90d 月预测 周转月 新品 生命周期 呆滞等级 建议(1) · 新品(1) |
| `downloadBatchErrors` | app.js | Other | A | P1 | XLSX库未加载(1) · 失败原因(1) · 批量操作错误报告_(1) |
| `handleSkuFile` | app.js | SKU Master | A | P1 | 仅支持 .xlsx / .xls / .csv 格式(1) · 文件为空或缺少数据行(1) · SKU编码不能为空(1) |
| `downloadSkuImportErrors` | app.js | SKU Master | A | P1 | 行号(1) · 失败原因(1) · 失败明细(1) |
| `handleInvFile` | app.js | Inventory List | A | P1 | 仅支持 .xlsx / .xls / .csv 格式(1) · 文件为空或缺少数据行(1) · SKU编码不能为空(1) |
| `downloadInvImportErrors` | app.js | Inventory List | A | P1 | 行号(1) · 失败原因(1) · 失败明细(1) |
| `loadChk` | app.js | Inventory Check | A | P1 | 🔍 暂无盘点数据(1) · 盘点单号 国家 仓库 日期 SKU 系统库存 实盘 差异 差异金额 原因 处理 审批 操作(1) · ')" title="审批">✅(1) |
| `exportChkTpl` | app.js | Inventory Check | A | P1 | ",差异原因:"",处理方式:"(1) · 盘点模板(1) · 盘点模板_(1) |
| `ensureSkuImportMenu` | app.js | SKU Master | A | P1 | 📥 新增/更新导入(1) · 📋 查看导入记录(1) |
| `openBatchSkuEditModal` | app.js | SKU Master | A | P2 | 新品导入 新品启动 成长期 成熟期 衰退期 滞销 清仓期 停采/停产(1) · 启用 停用 清仓 停产(1) |
| `batchSkuExport` | app.js | SKU Master | A | P1 | SKU批量导出_(1) · 条.xlsx(1) |
| `saveSKU` | app.js | SKU Master | A | P1 | 保存成功(1) · 创建成功(1) |
| `deleteSKU` | app.js | SKU Master | A | P1 | ⚠️ 删除SKU可能影响库存、出库、PO、PI、CI/PL等关联数据。 如果SKU已有业务数据，将不允许删除，只能停用。 确认删除吗？(1) · 已删除(1) |
| `downloadSkuTemplate` | app.js | SKU Master | A | P1 | 热销款(1) · 常规款(1) |
| `downloadInvTemplate` | app.js | Inventory List | A | P1 | 线上(1) · 线下(1) |
| `refreshInvRates` | app.js | Inventory List | A | P1 | 汇率已刷新(1) · 正在刷新汇率...(1) |
| `refreshInventoryTotals` | server.js | Inventory List | A | P2 | 未找到最新已确认加权平均成本，已保留原成本，请完成成本确认。(1) · 未找到已确认加权平均成本，成本与金额暂为 0，请尽快完成成本确认。(1) |
| `stockoutRisk` | server.js | Inventory List | C/A | P0 | 严重缺货(1) · 缺货风险(1) |
| `highStock` | server.js | Inventory List | A/C | P0 | 库存偏高(1) · 滞销(1) |
| `getCiSkuCostFacts` | server.js | SKU Master | A | P2 | CI明细为空，无法确认或分摊成本(1) · CI明细存在空SKU，无法分摊成本(1) |
| `OUTBOUND_STATUS_LABELS` | server.js | Other | C | P0 | 正常(1) · 已作废(1) |
| `out_of_stock_risk` | app.js | Inventory List | C | P0 | 断货风险(1) |
| `high_stock` | app.js | Inventory List | C | P0 | 高库存(1) |
| `slow_moving` | app.js | Slow Moving Analysis | C | P0 | 慢销(1) |
| `loadSimple` | app.js | Other | A | P1 | 全部品牌(1) |
| `saveSimple` | app.js | Other | A | P1 | 保存成功(1) |
| `renderCountries` | app.js | Other | A | P1 | 名称(1) |
| `confirmBatchSkuUpdate` | app.js | SKU Master | A | P1 | 值不能为空(1) |
| `invBatchAction` | app.js | Inventory List | A | P1 | 请先选择记录(1) |
| `renderStagnant` | app.js | Slow Moving Analysis | A | P2 | 国家 等级 全部呆滞 轻度 中度 重度 死亡库存(1) |
| `apprChk` | app.js | Inventory Check | A | P1 | 已审批(1) |
| `detectStockoutDistortion` | server.js | Inventory List | A | P2 | 销量失真：当前可用库存为0，近期销量可能被缺货压低，已按过去4个月最高月销量作为补货参考。(1) |

### 2. Procurement 模块 （100 个函数，唯一文本 236 处）

| 函数 | 文件 | 页面 | 类型 | 优先级 | 代表性硬编码文本（文本(次数)） |
|---|---|---|---|---|---|
| `normalizeHistoricalCI` | server.js | Commercial Invoice / Inbound | A/C | P0 | 到期日(2) · 实际出货日期(2) · 历史CI编号(1) · CI编号(1) · 历史 CI 编号不能为空(1) |
| `submitSalesBatchImport` | app.js | Purchase Order | A | P1 | 条(5) · 没有可导入的有效数据(1) · 导入完成报告(1) · 总行数：(1) · 新增：(1) |
| `editPI` | app.js | Proforma Invoice | C/A | P0 | 关闭(1) · 编辑模式：可修改表头与明细并实时预览差异；保存将调用后端 PUT（付款条件变更自动回写供应商上次使用项）。「PI号 / 关联PO / 供应商 / PI日期 / 币种」为锁定项不可改。(1) · PI号（锁定）(1) · 关联PO（锁定）(1) · 供应商（锁定）(1) |
| `renderOpsPrepSection` | app.js | Commercial Invoice / Inbound | A | P1 | 上架准备（电商运营）(2) · 计划上架日期(2) · 抄送(CC)(2) · ✔ 上架准备已完成（Ready），可安排上架。(2) · 上架准备（电商运营） 无法读取上架准备状态。(1) |
| `cockpitSupplierDrawer` | app.js | Supplier | A | P1 | 货款(1) · 运输费(1) · 关税(1) · 检验费(1) · 其他费用(1) |
| `openSupplierModal` | app.js | Supplier | A | P1 | 暂无品牌，请先维护 SKU 品牌(1) · 供应商名称 *(1) · 默认币种(1) · 联系人(1) · 联系方式(1) |
| `submitSupplierPIImport` | app.js | Reports / Demand Forecast | A | P1 | 没有可导入的有效数据(1) · 导入完成报告 总行数：(1) · 条 匹配回填：(1) · 条 新增行：(1) · 条 跳过（无效）：(1) |
| `openSalesBatchImport` | app.js | Purchase Order | A/C | P0 | 点击上传或拖拽文件到此处(1) · 支持 .xlsx / .xls / .csv 格式(1) · 导入说明(1) · • 来源系统+订单号+SKU+渠道 为唯一键，重复导入将自动更新而非新增(1) · • 是否有效订单=true 的订单计入销量预测、周转月、补货建议(1) |
| `loadPI` | app.js | Proforma Invoice | A | P1 | 📄 暂无PI(1) · PI号 关联PO 供应商 品牌 国家 仓库 日期 币种 总金额 是否定金 定金比例 定金金额 定金状态 PI状态 操作(1) · 是(1) · 否(1) · disabled title="已锁定，不可编辑：(1) |
| `openSupplierPIImport` | app.js | Reports / Demand Forecast | A/C | P0 | 导入供应商PI &times;(1) · 点击上传或拖拽文件到此处(1) · 支持 .xlsx / .xls / .csv 格式(1) · 导入说明(1) · • 列： SKU、PI确认数量、PI确认单价、PI折扣 （折扣填 0~1，如 0.1 表示 10%）(1) |
| `renderSupplierPIPreview` | app.js | Reports / Demand Forecast | A | P1 | 条(2) · 共(1) · 条数据 ， 有效(1) · ， 无效(1) · 行 SKU PI确认数量 PI确认单价 PI折扣 校验(1) |
| `renderOperationalCITable` | app.js | Commercial Invoice / Inbound | A | P1 | 🚚 暂无运营CI(1) · CI号 关联PO 关联PI 供应商 品牌 国家 仓库 日期 币种 CI金额 已付定金 应付尾款 差异 状态 操作(1) · ','attachment')" title="上传CI附件">📎(1) · ','pl_attachment')" title="上传PL附件">📦(1) · ')" title="尾款付款">💰(1) |
| `renderInboundPreview` | app.js | Commercial Invoice / Inbound | A | P1 | 条(2) · 共(1) · 条数据 ， 有效(1) · ， 无效(1) · 行 SKU 日期 数量 PL明细ID PL号 国家 仓库 状态(1) |
| `salesBatchExport` | app.js | Purchase Order | A | P1 | 请先选择记录(1) · 来源系统(1) · 下单日期(1) · 渠道(1) · 数量(1) |
| `loadPO` | app.js | Purchase Order | A | P1 | 🛒 暂无PO(1) · PO号 供应商 品牌 国家 仓库 PO日期 币种 明细 PO状态 审批 操作(1) · ')" title="提交审批">📤(1) · ')" title="发工厂">📨(1) · ')" title="导出Excel">📊(1) |
| `genPOModal` | app.js | Purchase Order | A | P1 | 当前没有需要生成 PO 的 SKU。(1) · SKU Model 建议采购数量 动销判断 建议动作 品牌 国家 仓库(1) · 共(1) · 个 SKU，建议采购总数量：(1) · 件(1) |
| `saveHistoricalCI` | app.js | Commercial Invoice / Inbound | A | P1 | 请填写历史 CI 编号、供应商、品牌、国家、日期和币种(1) · 历史货款总金额必须大于0(1) · 历史已付款金额不能小于0(1) · 历史已付款金额不能超过历史货款总金额(1) · 已识别为重复请求，未重复记账(1) |
| `importResultWithMessages` | server.js | Purchase Order | A | P1 | SKU不存在(1) · 部分 SKU 不存在，请先维护 SKU 或检查导入文件。(1) · 无法匹配PO(1) · 部分数据无法匹配 PO，请检查 PO 编号。(1) · 无法匹配CI(1) |
| `approvePO` | app.js | Purchase Order | A | P1 | 未找到该审批记录(1) · 审批人信息(1) · 通过后将最终生效。(1) · 通过后仍需第(1) · 级审批才最终生效。(1) |
| `continueGenPO` | app.js | Purchase Order | A | P1 | 部分 SKU 未配置品牌，请先在 SKU 管理中维护品牌信息。(1) · 部分品牌未匹配到唯一供应商，请先在供应商管理中维护品牌与供应商关系。(1) · 所选 SKU 属于不同供应商，请分开生成 PO。(1) · 生成PO(1) · 取消 创建PO(1) |
| `renderDocImportResult` | app.js | Purchase Order | A | P1 | 条(2) · 导入完成：成功(1) · ，幂等识别(1) · ，失败(1) · 行号 失败原因(1) |
| `openBatchImportInbound` | app.js | Purchase Order | A/C | P0 | 点击上传或拖拽文件到此处(1) · 支持 .xlsx / .csv 格式(1) · 下载模板(1) · 关闭(1) · 开始导入(1) |
| `submitBatchImportInbound` | app.js | Purchase Order | A | P1 | 条(2) · 没有可导入的有效数据(1) · 导入完成：成功(1) · ，失败(1) · 导入失败(1) |
| `validateCiCostInputs` | server.js | Commercial Invoice / Inbound | A | P1 | (空)(1) · 该CI存在运输类费用，请先明确选择本票实际运输计费基础（CBM或KG）(1) · CI Import Duty总金额必须为不小于0的数字(1) · CI Import Duty大于0，但全部SKU的关税权重合计为0(1) · CI实际商品金额合计为0，无法分摊成本(1) |
| `loadSuppliers` | app.js | Supplier | A/C | P0 | 🏢 暂无供应商(1) · 供应商名称 关联品牌 默认币种 联系人 联系方式 备注 状态 操作(1) · 启用(1) · 停用(1) |
| `submitPO` | app.js | Purchase Order | A | P1 | 提交后将进入审批流程。可选：勾选需要知会的抄送人（仅记录，不阻塞审批、不发送通知）。(1) · 暂无可用抄送人(1) · 取消(1) · ')">确认提交(1) |
| `renderHistoricalCITable` | app.js | Commercial Invoice / Inbound | A | P1 | 📚 暂无历史CI(1) · 仅用于历史采购金额和应付管理，不影响库存、WAC及订单预测。 历史CI号 供应商 品牌 国家 日期 币种 总货款 导入历史已付 后续已付 抵扣 抹零 未结金额 付款状态 到期日 操作(1) · ')" title="查看历史CI">👁️(1) · ')" title="付款与结算">💳(1) |
| `viewHistoricalCI` | app.js | Commercial Invoice / Inbound | A | P2 | ')">← 返回付款申请详情(1) · 历史 CI 附件（留痕）(1) · 原始 CI 历史付款凭证 对账单 账期证明 其他说明 上传附件(1) · 附件仅作为原始证据与审计留痕，不参与应付、抵扣、抹零、未结、WAC、库存或订单预测。(1) |
| `loadLog` | app.js | Logistics / Freight | A | P1 | 🚢 暂无物流数据(1) · 批次号 关联CI 货代 方式 起运港 目的港 国家 提货 出发 到港 清关完成 入库完成 箱数 CBM 综合运费 关税 状态 费用 操作(1) · ')" title="运费付款">💰(1) · ')" title="关税付款">🏛️(1) |
| `handleInboundFile` | app.js | Commercial Invoice / Inbound | A | P1 | 仅支持 .xlsx / .xls / .csv 格式(1) · 文件为空或缺少数据行(1) · 不能为空(1) · 实际入库数量必须为正整数（大于0）(1) |
| `cockpitSupplierStatus` | app.js | Supplier | C | P0 | 已逾期(1) · 即将到期(1) · 无到期日(1) · 正常(1) |
| `downloadSalesImportErrors` | app.js | Purchase Order | A | P1 | 行号(1) · 失败原因(1) · 失败明细(1) |
| `renderCmpReadonly` | app.js | Other | A | P1 | 汇总(1) · 金额差异：(1) · SKU PO数量 PI确认数量 PO单价 PI确认单价 PI折扣 PI金额 数量差异 单价差异 状态(1) |
| `handleSupplierPIFile` | app.js | Reports / Demand Forecast | A | P1 | 仅支持 .xlsx / .xls / .csv 格式(1) · 文件为空或缺少数据行(1) · SKU不能为空(1) |
| `attachmentHtml` | app.js | Other | A | P1 | ')">重传(1) · ')">删除(1) · ')">上传(1) |
| `renderPurchaseAmountSummary` | app.js | Reports / Demand Forecast | A | P1 | 张；人民币待补(1) · 张(1) · 历史采购金额(1) |
| `historicalAttachmentListHtml` | app.js | Other | A | P1 | 暂无附件(1) · 类型 文件名 大小 上传人 上传时间 操作(1) · 其他(1) |
| `saveSupplier` | app.js | Supplier | A | P1 | 供应商名称不能为空(1) · 保存成功(1) |
| `toggleSupplierStatus` | app.js | Supplier | C | P0 | 已启用(1) · 已停用(1) |
| `rejectPO` | app.js | Purchase Order | A | P1 | 请输入驳回原因（必填）：(1) · 驳回原因必填(1) |
| `openPOExportConfirm` | app.js | Purchase Order | A | P1 | PO 创建成功(1) · PO 已创建成功，是否立即导出 Excel 格式 PO？(1) |
| `deletePO` | app.js | Purchase Order | A | P1 | 确认删除该PO？此操作不可恢复，删除后对应的在途字段会自动回落。(1) · PO已删除(1) |
| `createPI` | app.js | Proforma Invoice | A | P1 | 新建PI(1) · 取消 创建(1) |
| `downloadSupplierPIImportErrors` | app.js | Reports / Demand Forecast | A | P1 | 行号(1) · 失败原因(1) |
| `downloadAttachment` | app.js | Other | A | P1 | 暂无附件(1) · 附件(1) |
| `createHistoricalCI` | app.js | Commercial Invoice / Inbound | A | P1 | 历史 CI 导入需要 CI 创建、付款创建和付款审批权限(1) · 取消 导入(1) |
| `downloadHistoricalAttachment` | app.js | Other | A | P1 | 附件不存在(1) · 附件(1) |
| `saveOpsPrep` | app.js | Commercial Invoice / Inbound | A | P1 | 请选择负责人(1) · 上架准备已保存(1) |
| `saveCiCostInputs` | app.js | Commercial Invoice / Inbound | A | P1 | Import Duty和实际关税税率不能小于0(1) · 分摊输入已保存(1) |
| `loadIn` | app.js | Commercial Invoice / Inbound | A | P1 | 📥 暂无入库数据(1) · 入库单号 来源CI 来源PL 物流批次 国家 仓库 日期 SKU 产品名 CI发货 应入库 实际入库 累计 未入库 异常 状态(1) |
| `loadOriginRecords` | app.js | Other | A | P1 | 📦 暂无原库存数据(1) · 📦 原库存记录 SKU 国家 仓库 原库存数量 备注 导入时间(1) |
| `loadFF` | app.js | Logistics / Freight | A | P2 | 📈 暂无货代分析数据(1) · 货代 国家 方式 批次 CI总额 总CBM 总重量 综合运费 关税 运费占比 每CBM 每KG 运输天 清关天 派送天(1) |
| `notifyApprovalParticipants` | server.js | Commercial Invoice / Inbound | A | P2 | [FEISHU-NOTIFY] 发送失败 open_id=(1) · [FEISHU-NOTIFY] 通知流程异常 event=(1) |
| `notifyBusinessParticipants` | server.js | Commercial Invoice / Inbound | A | P2 | [FEISHU-NOTIFY] 发送失败 open_id=(1) · [FEISHU-NOTIFY] 业务通知异常 event=(1) |
| `poNo` | server.js | Purchase Order | A | P1 | 关联PO编号(3) · PO编号(3) |
| `piNo` | server.js | Other | A | P1 | PI编号(2) · 关联PI编号(1) |
| `ciNo` | server.js | Commercial Invoice / Inbound | A | P1 | CI编号(2) · 关联CI编号(1) |
| `settlementIdempotencyKey` | server.js | Purchase Order | A | P1 | 付款幂等键不能为空(1) · 付款幂等键长度不能超过200个字符(1) |
| `partial` | app.js | Other | C | P0 | 部分(1) |
| `completed` | app.js | Other | C | P0 | 已完成(1) |
| `transferred_pi` | app.js | Proforma Invoice | C | P0 | 已转PI(1) |
| `renderCurrencies` | app.js | Commercial Invoice / Inbound | A | P1 | 名称(1) |
| `confirmApprovePO` | app.js | Purchase Order | A | P1 | 已通过（待后续级次）(1) |
| `doRejectPO` | app.js | Purchase Order | A | P2 | 已驳回，PO 已退回草稿(1) |
| `deposit` | app.js | Purchase Order | A | P1 | 定金(4) |
| `saveGenPO` | app.js | Purchase Order | A | P1 | PO创建成功(1) |
| `createPO` | app.js | Purchase Order | A | P1 | 取消 创建(1) |
| `saveNewPO` | app.js | Purchase Order | A | P1 | PO创建成功(1) |
| `viewPI` | app.js | Proforma Invoice | A | P2 | ')">← 返回付款申请详情 关闭(1) |
| `onPISupplierChange` | app.js | Supplier | A | P1 | （未选择）(1) |
| `saveNewPI` | app.js | Proforma Invoice | A | P1 | PI创建成功(1) |
| `parseAttachmentValue` | app.js | Other | A | P1 | 附件(1) |
| `uploadDocAttachment` | app.js | Other | A | P1 | 附件已上传(1) |
| `deleteDocAttachment` | app.js | Other | A | P1 | 附件已删除(1) |
| `editActualShipDate` | app.js | Other | A | P1 | 取消 保存(1) |
| `submitActualShipDate` | app.js | Other | A | P1 | 实际出货日期已保存(1) |
| `uploadHistoricalAttachment` | app.js | Other | A | P1 | 附件已上传(1) |
| `deleteHistoricalAttachment` | app.js | Other | A | P1 | 附件已删除（软删除）(1) |
| `viewCI` | app.js | Commercial Invoice / Inbound | A | P2 | ')">← 返回付款申请详情 关闭(1) |
| `setOpsReady` | app.js | Commercial Invoice / Inbound | A | P2 | 已标记上架准备完成（Ready）(1) |
| `createCI` | app.js | Commercial Invoice / Inbound | A | P1 | 取消 创建(1) |
| `saveNewCI` | app.js | Commercial Invoice / Inbound | A | P1 | CI创建成功(1) |
| `viewCICost` | app.js | Commercial Invoice / Inbound | C | P0 | 关闭(1) |
| `toggleCiCostFlag` | app.js | Commercial Invoice / Inbound | A | P1 | 费用标记已更新(1) |
| `createLog` | app.js | Logistics / Freight | A | P1 | 取消 创建(1) |
| `saveNewLog` | app.js | Logistics / Freight | A | P1 | 创建成功(1) |
| `createIn` | app.js | Commercial Invoice / Inbound | A | P1 | 取消 创建入库(1) |
| `saveNewIn` | app.js | Commercial Invoice / Inbound | A | P1 | 入库完成(1) |
| `confirmCiCosts` | app.js | Commercial Invoice / Inbound | A | P2 | 费用已确认完整，运输依据和实际税率已锁定(1) |
| `renderForwarderAnalysis` | app.js | Logistics / Freight | A | P2 | 国家 运输方式 全部 海运 空运 快递(1) |
| `ci_ops_assigned` | server.js | Commercial Invoice / Inbound | A | P1 | 待定(1) |
| `port_charges` | server.js | Purchase Order | A | P1 | 港口费(1) |
| `needDepositVal` | server.js | Purchase Order | A | P1 | 是否需要定金(1) |
| `needDeposit` | server.js | Purchase Order | A | P1 | 否(1) |
| `depositRatio` | server.js | Purchase Order | A | P1 | 定金比例(1) |
| `plNo` | server.js | Other | A | P1 | PL编号(1) |
| `paymentIdempotencyResult` | server.js | Purchase Order | A | P2 | 该付款幂等键已用于不同的付款申请、金额、付款日期或凭证，不能重复使用(1) |
| `historicalCIIdempotencyResult` | server.js | Purchase Order | A | P2 | 该历史 CI 幂等键已用于不同的单据内容，不能重复使用(1) |
| `supplier_name` | server.js | Supplier | A | P1 | （未填供应商）(1) |
| `getCiPlBasisFacts` | server.js | Commercial Invoice / Inbound | A | P1 | 毛重(1) |

### 3. Finance 模块 （169 个函数，唯一文本 660 处）

| 函数 | 文件 | 页面 | 类型 | 优先级 | 代表性硬编码文本（文本(次数)） |
|---|---|---|---|---|---|
| `error` | server.js | Other | A | P0 | 未选择记录(16) · CI不存在(15) · 第(6) · status 只允许 active 或 inactive(6) · PO不存在(6) |
| `openRpParams` | app.js | Reports / Demand Forecast | A | P1 | 国家(2) · 仓库(2) · 线上周转(2) · 线下周转(2) · " placeholder="(空=通配)" style="width:120px">(2) |
| `viewPayment` | app.js | Payment / Cost | A/C | P0 | 付款(2) · 关闭(2) · 无查看权限(1) · —（费用/无货物明细）(1) · 费用归属国家(1) |
| `loadRpChannelMonthly` | app.js | Reports / Demand Forecast | A | P1 | 按(2) · 销量统计周期占比(2) · 线上(1) · 线下(1) · 本月/(1) |
| `loadWacDetail` | app.js | Payment / Cost | A | P1 | ✅ 已确认(2) · 商品金额(1) · 到仓费用(1) · 关税(1) · 商检费用(1) |
| `peOpenModal` | app.js | Other | A | P1 | 请选择国家(1) · — 不指定 —(1) · 该付款主体代码已被业务数据引用，不可修改。(1) · 实体代码为稳定标识；当前无引用，允许修改。一旦被引用将锁定。(1) · 实体代码为稳定业务标识，建议使用英文小写加下划线，例如 id_company_a。(1) |
| `reason` | server.js | Other | A | P0 | 记录不存在(14) · 已作废记录不能修改(5) · SKU不存在(3) · SKU编码为空(2) · 可用数量必须为非负整数(2) |
| `pcOpenSubModal` | app.js | Other | A | P1 | 该付款大类当前已停用，新小类不会出现在新的付款申请中。(2) · 付款小类不存在(1) · 请选择付款大类(1) · 所属付款大类(1) · " readonly> 编辑状态下不允许移动小类到其他大类。(1) |
| `pcOpenMapModal` | app.js | Other | A/C | P0 | 请先选择付款大类(1) · 请先选择付款小类(1) · 所属一级类目“(1) · ”已停用(1) · 所属二级类目“(1) |
| `openRpReview` | app.js | Reports / Demand Forecast | A/C | P0 | 暂无记录(4) · 未找到该行数据，请刷新后重试(1) · 线上(1) · 线下(1) · 1. 系统判断(1) |
| `task_name` | server.js | Other | A | P1 | 批量设置库存状态(1) · 批量设置重点关注(1) · 批量设置安全库存(1) · 批量设置目标周转月数(1) · 批量设置补货规则(1) |
| `pcOpenCategoryModal` | app.js | Payment Category / Terms | A | P1 | 已被业务数据引用的code不能修改；如被引用，保存时系统会明确提示。(1) · code用于系统关联，建议使用英文小写和下划线，例如 warehouse_arrival。(1) · 大类名称 *(1) · 大类code *(1) · 排序(1) |
| `openLifecycleHelp` | app.js | Other | A/C | P0 | 📌 生命周期的作用(1) · 生命周期是辅助系统判断补货策略的字段，影响 建议补货量 和 建议动作 。(1) · 可在 商品管理 → 生命周期 字段手动调整。(1) · 标签 系统判断依据 补货策略 补货系数 是否补货(1) · 是(1) |
| `renderSupTerms` | app.js | Payment Category / Terms | A | P1 | 暂无付款条件，点击下方“添加付款条件”新增(1) · 名称(1) · " placeholder="如 T/T 100% in advance">(1) · 类型(1) · >预付 advance(1) |
| `openApprovalDetail` | app.js | Approval Flow | A | P1 | 未找到该审批记录(1) · 提交审批(1) · 通过(1) · 驳回(1) · 撤回(1) |
| `LIFECYCLE_MAP` | server.js | Other | A/C | P0 | 新品导入(2) · 新品启动(2) · 成长期(2) · 成熟期(2) · 衰退期(2) |
| `validateAttachmentItem` | server.js | Other | A | P1 | 附件对象缺失(1) · 附件数据格式非法（须为 data URL）(1) · 附件 data URL 非法(1) · 附件必须为 base64 编码(1) · 不支持的文件类型：(1) |
| `pcSaveMap` | app.js | Other | A | P1 | 当前付款大类不存在，请关闭弹窗后重新选择(1) · 当前付款小类不存在，请关闭弹窗后重新选择(1) · 请选择来源类型(1) · 请选择费用事件(1) · 状态值无效(1) |
| `createCustomsDutyPay` | app.js | Payment / Cost | A | P1 | 付款对象(1) · 应付金额(1) · 币种 USD RMB(1) · 备注(1) · 是否抵扣 否 是(1) |
| `createInspectionFeePay` | app.js | Payment / Cost | A | P1 | 付款对象(1) · 应付金额(1) · 币种 USD RMB(1) · 备注(1) · 是否抵扣 否 是(1) |
| `loadPay` | app.js | Payment / Cost | A | P1 | 💳 暂无付款数据(1) · ')" title="查看详情">👁️(1) · ')" title="补录费用归属国家">补国家(1) · ','approve')" title="通过">✅(1) · ','reject')" title="驳回">❌(1) |
| `badMsg` | server.js | Other | A | P0 | 第(6) · 级审批用户「(4) · 级审批人未配置具体用户(1) · 级审批用户不存在(1) · 」已停用(1) |
| `applyRoundingSettlement` | server.js | Payment / Cost | A | P1 | 付款申请不存在(1) · 付款申请尚未审批通过，不能执行抹零(1) · 该付款申请已有生效抹零，不能直接覆盖；请先撤销原抹零(1) · 该付款申请已结清，无需抹零(1) · 抹零金额不能小于0(1) |
| `peSave` | app.js | Other | A | P1 | 排序必须为整数(1) · 付款主体代码(entity_key)不能为空(1) · 法人名称(entity_name)不能为空(1) · 请选择所属国家(1) · 状态值无效(1) |
| `pcSaveSub` | app.js | Other | A | P1 | 所属付款大类不能为空(1) · 小类名称不能为空(1) · 小类code不能为空(1) · 排序必须为整数(1) · status无效(1) |
| `openRpFieldConfig` | app.js | Reports / Demand Forecast | A | P1 | 总预测(1) · 线上预测(1) · 线下预测(1) · ')">全部显示(1) · 显示(1) |
| `reversePaymentSettlement` | app.js | Payment / Cost | A | P1 | 付款(1) · 抹零(1) · 请输入(1) · 撤销(1) · 冲销(1) |
| `risk_level` | server.js | Other | C/A | P0 | 清仓(1) · 停产(1) · 无销量(1) · 严重缺货(1) · 缺货风险(1) |
| `applyDeductionSettlement` | server.js | Payment / Cost | A | P1 | 付款申请不存在(1) · 该付款申请已产生有效付款，不能通过普通编辑修改抵扣；如需调整请先冲销付款(1) · 该付款申请已有生效抵扣，不能直接覆盖；请先冲销原抵扣(1) · 该付款申请已结清，不能编辑抵扣(1) · 抵扣金额必须大于0(1) |
| `reverseSettlementEvent` | server.js | Payment / Cost | A | P1 | 付款申请不存在(1) · 冲销原因不能为空(1) · 必须指定要冲销的结算事件(1) · 结算事件不存在(1) · 该事件不是付款记录，不能作为付款冲销(1) |
| `openRoleEditor` | app.js | User / Role | A | P1 | 未找到该角色(1) · 角色名称（只读）：(1) · ｜ 角色说明（只读）：(1) · 超级管理员角色：关键管理权限（角色管理 / 用户管理 / 系统配置）已被锁定，不可取消，以避免系统失去管理入口。(1) · 取消(1) |
| `pcShowHelp` | app.js | Other | A | P1 | 本页维护三层结构：(1) · ① 付款大类 （如货款、到仓费用、关税）(1) · ② 付款小类 （如运费、清关费，归属某个大类）(1) · ③ 来源映射 （小类绑定「来源类型 + 费用类型」，如 CI + freight）(1) · 规则：同一个有效的「来源类型 + 费用类型」只能映射到一个付款小类。(1) |
| `pcSaveCategory` | app.js | Payment Category / Terms | A | P1 | 大类名称不能为空(1) · 大类code不能为空(1) · 排序必须为整数(1) · 状态值无效(1) · 付款大类已更新(1) |
| `module` | server.js | Other | A | P0 | 采购(18) · 库存(18) · 财务(6) · 系统管理(3) · 销售(3) |
| `STATUS_MAP` | server.js | Other | C | P0 | 启用(2) · 正常(2) · 清仓(2) · 停用(2) · 停采(2) |
| `applyPaymentSettlement` | server.js | Payment / Cost | A | P1 | 本次实际付款金额必须大于0(2) · 付款申请不存在(1) · 付款申请尚未审批通过，不能确认付款(1) · 当前付款申请状态不允许确认付款(1) · 该付款申请已结清，无需重复付款(1) |
| `loadApprovalFlows` | app.js | Approval Flow | A | P1 | ✅ 暂无审批流(1) · ',this.checked)"> 启用(1) · 非PO类型本轮只读(1) · ')">＋ 添加审批级次(1) · ')">💾 保存(1) |
| `afRenderLevels` | app.js | Approval Flow | A | P1 | 第(1) · 级(1) · ,-1)" title="上移">↑(1) · ,1)" title="下移">↓(1) · )" title="删除">✕(1) |
| `loadApprovalCenterList` | app.js | Approval Flow | A | P1 | ✅ 暂无待审批 PO(1) · PO号 提交人 品牌 国家 仓库 总数量 总金额 提交时间 审批级次 操作(1) · ')" title="查看详情">👁️(1) · ')" title="通过审批">✅ 通过(1) · ')" title="驳回">⛔ 驳回(1) |
| `rpChannelColMeta` | app.js | Reports / Demand Forecast | A | P1 | 渠道(1) · 天月均销量(1) · 当前可用周转(1) · 建议采购(1) · 复盘(1) |
| `updateWeightedAvg` | app.js | Other | A | P1 | 确认生成加权平均成本版本？ 这将生成并锁定的 WAC 历史版本，不会修改库存总表的数量、成本和金额。 库存总表的加权平均成本将在 ERP 库存导入时自动匹配最新已确认版本。(1) · 成本确认(1) · SKU 版本号 原库存 旧成本 入库量 单位落地成本 新加权平均成本(1) · 加权平均成本版本已生成(1) · 确定(1) |
| `showUnmatchedRules` | app.js | Other | A | P1 | 以下品牌未配置目标周转规则，无法重新计算。请先在「⚙ 预测参数设置」中为这些品牌添加规则后再重算：(1) · 品牌 未命中 SKU 数(1) · 提示：只需添加品牌级规则（国家/仓库留空）即可覆盖该品牌所有国家/仓库。(1) · 知道了(1) |
| `renderCost` | app.js | Payment / Cost | A | P1 | 📊 费用分摊(1) · 📦 原库存导入(1) · 💰 加权平均成本(1) · 📝 成本更新日志(1) |
| `saveConfirmedPayment` | app.js | Payment / Cost | A | P1 | 本次实际付款金额必须大于0(1) · 请选择实际付款日期(1) · 付款结果已保存(1) · 确认付款(1) |
| `savePaymentRounding` | app.js | Payment / Cost | A | P1 | 抹零金额不能小于0(1) · 抹零金额必须大于0(1) · 抹零原因或备注不能为空(1) · 抹零已生效(1) |
| `pcRowActions` | app.js | Payment / Cost | A | P1 | ">编辑(1) · ">停用(1) · ">启用(1) |
| `pcSubRowActions` | app.js | Payment / Cost | A | P1 | ')">编辑(1) · ')">停用(1) · ')">启用(1) |
| `pcFetchJSON` | app.js | Other | A | P1 | 付款大类(1) · 服务器错误（(1) · 没有系统配置权限，无法维护(1) |
| `pcToggleCategory` | app.js | Payment Category / Terms | A | P1 | 已停用该付款大类(1) · 操作失败(1) · 没有系统配置权限，无法维护付款大类。(1) |
| `pcToggleSub` | app.js | Other | A | P1 | 已停用该付款小类(1) · 操作失败(1) · 没有系统配置权限，无法维护付款小类。(1) |
| `renderOperationLogs` | app.js | Logistics / Freight | A | P1 | 📝 操作日志 🔄 刷新(1) · 📝 暂无操作日志(1) · 时间 操作人 页面 操作类型 影响数量 原因(1) |
| `openVoidModal` | app.js | Other | A | P1 | 采购订单(PO)(1) · 形式发票(PI)(1) · 商业发票(CI)(1) |
| `renderPayAttachmentListInner` | app.js | Reports / Demand Forecast | A | P1 | 暂无附件(1) · 附件(1) · )">删除(1) |
| `financeApprove` | app.js | Other | A/C | P0 | 驳回时审批意见必填(1) · 已通过(1) · 已驳回(1) |
| `apprPay` | app.js | Reports / Demand Forecast | A/C | P0 | 驳回原因：(1) · 已通过(1) · 已驳回(1) |
| `qty` | server.js | Other | A | P1 | 数量(2) · PI数量(1) · CI数量(1) |
| `ensureSettlementLegacyBaselines` | server.js | Payment / Cost | A | P1 | 历史付款基线（迁移前数据）(1) · 历史抵扣基线（迁移前数据）(1) · 历史抹零基线(1) |
| `paymentSettlementDisplayLogs` | server.js | Logistics / Freight | A | P1 | 历史付款基线（迁移前数据）(1) · 历史抵扣基线（迁移前数据）(1) · 历史抹零基线(1) |
| `approved` | app.js | Other | C/A | P0 | 已通过(1) · 已审批(1) |
| `afSaveFlow` | app.js | Approval Flow | A | P1 | 审批级次必须连续（1,2,3...）(1) · 审批流已保存(1) |
| `renderAllocationRules` | app.js | Payment / Cost | A | P1 | 名称(1) · 分摊依据(1) |
| `saveRolePermissions` | app.js | User / Role | A | P1 | 未找到该角色(1) · 角色权限已保存(1) |
| `pcStatusBadge` | app.js | Other | C | P0 | 启用(1) · 停用(1) |
| `pcMapRowActions` | app.js | Payment / Cost | A | P1 | ')">停用(1) · ')">启用(1) |
| `pcError` | app.js | Other | A | P1 | ⚠️ 加载失败：(1) · 重新加载(1) |
| `peFetchJSON` | app.js | Other | A | P1 | 服务器错误（(1) · 没有系统配置权限，无法维护付款主体。(1) |
| `peToggleStatus` | app.js | Other | A | P1 | 操作失败(1) · 没有系统配置权限，无法维护付款主体。(1) |
| `pcMapFeeOptions` | app.js | Other | A | P1 | 请先选择来源类型(1) · 请选择费用事件(1) |
| `pcToggleMap` | app.js | Other | A | P1 | 来源映射已停用(1) · 操作失败(1) |
| `buildRpCfgItem` | app.js | Reports / Demand Forecast | A | P1 | 固定(1) · ⠿(1) |
| `applyRpCollapseState` | app.js | Reports / Demand Forecast | A | P1 | ▸ 展开(1) · 展开 顶部筛选区与指标卡片(1) |
| `confirmVoid` | app.js | Other | A | P1 | 请填写作废原因(1) · 已作废(1) |
| `createWarehousePay` | app.js | Payment / Cost | A | P1 | 费用归属国家 * 请选择(1) · 创建到仓费用付款(1) |
| `saveWarehousePay` | app.js | Payment / Cost | A | P1 | 请选择费用归属国家(1) · 到仓费用付款申请已创建(1) |
| `createDutyPay` | app.js | Payment / Cost | A | P2 | 该物流批次未关联CI，请从CI费用管理页面创建关税付款(1) · 该CI未标记为有关税，请先在CI费用管理中设置(1) |
| `fetchCostAlloc` | app.js | Payment / Cost | A | P1 | 📊 暂无成本数据(1) · CI号 SKU 商品成本 分摊运费 分摊关税 分摊其他 总落地成本 入库量 单位商品成本 单位分摊成本 含费单位成本 原库存量 原成本 币种(1) |
| `fetchCostLogs` | app.js | Logistics / Freight | A | P1 | 📝 暂无日志数据(1) · 时间 SKU 国家 仓库 关联PO 关联CI 原库存 旧成本 入库量 CI单位成本 单位落地成本 新库存 新成本 操作人 备注(1) |
| `savePaymentExpenseCountry` | app.js | Payment / Cost | A | P1 | 请选择费用归属国家(1) · 费用归属国家已保存(1) |
| `scanPaymentReminders` | server.js | Payment / Cost | A | P2 | [FEISHU-NOTIFY] 付款提醒发送失败 open_id=(1) · [FEISHU-NOTIFY] 付款提醒扫描异常:(1) |
| `requireApiPermission` | server.js | User / Role | A | P1 | 未登录(1) · 没有该操作的权限(1) |
| `message` | server.js | Other | A | P2 | 没有有效的品牌状态记录(1) · 该停用来源映射已经存在，请直接重新启用原映射。(1) |
| `warehouse` | server.js | Other | A | P1 | 仓储费(1) · 仓库(1) |
| `inspection` | server.js | Payment / Cost | A | P1 | 商检费(1) · 商检(1) |
| `OB_CHANNEL_MAP` | server.js | Reports / Demand Forecast | C | P0 | 线上(1) · 线下(1) |
| `isValid` | server.js | Other | A/C | P0 | 是(2) · 有效(2) |
| `remark` | server.js | Other | A | P1 | 提交审批(1) · 备注(1) |
| `settlementDate` | server.js | Payment / Cost | A | P1 | 实际付款日期必须为 YYYY-MM-DD(1) · 实际付款日期无效(1) |
| `recalculatePaymentSettlement` | server.js | Payment / Cost | A | P1 | 付款申请不存在(1) · 有效付款、抵扣与抹零金额之和不能超过应付总额(1) |
| `recordInitialDeduction` | server.js | Payment / Cost | A | P1 | 付款申请不存在(1) · 创建付款申请时应用抵扣(1) |
| `pending` | app.js | Other | C | P0 | 待激活(1) |
| `draft` | app.js | Approval Flow | C | P0 | 草稿(1) |
| `open` | app.js | Other | C | P0 | 进行中(1) |
| `pending_approval` | app.js | Approval Flow | C | P0 | 待审批(2) |
| `partial_deduction` | app.js | Payment / Cost | A | P1 | 部分抵扣(2) |
| `deduction_settled` | app.js | Payment / Cost | A | P1 | 全额抵扣(2) |
| `partial_payment_partial_deduction` | app.js | Payment / Cost | A | P1 | 部分付款+部分抵扣(2) |
| `renderFreightForwarders` | app.js | Logistics / Freight | A | P1 | 名称(1) |
| `renderPaymentTerms` | app.js | Reports / Demand Forecast | A | P1 | 名称(1) |
| `renderApprovalFlows` | app.js | Approval Flow | A | P1 | ✅ 审批流管理(1) |
| `afRemoveLevel` | app.js | Approval Flow | A | P1 | 至少保留一个审批级次(1) |
| `loadFinanceApprovalList` | app.js | Approval Flow | A | P1 | ✅ 暂无待审付款申请(1) |
| `renderExpenseTypes` | app.js | Payment / Cost | A | P1 | 名称(1) |
| `saveConfig` | app.js | System Settings | A | P1 | 配置已保存(1) |
| `balance` | app.js | Other | A | P1 | 尾款(4) |
| `freight` | app.js | Logistics / Freight | A | P1 | 运费(4) |
| `pcPayeeLabel` | app.js | Payment / Cost | A | P1 | 未设置(1) |
| `pcPayeeOptions` | app.js | Payment / Cost | A | P1 | >未设置(1) |
| `pcSetLoading` | app.js | Other | A | P1 | ⏳ 加载中…(1) |
| `pcSubRow` | app.js | Other | A | P1 | 默认收款对象：(1) |
| `pcMapRow` | app.js | Other | A | P1 | ">费用事件：(1) |
| `pcHint` | app.js | Other | A | P2 | 同一个有效的「 来源类型 + 费用类型 」，只能映射到一个付款小类。(1) |
| `pcStub` | app.js | Other | A | P2 | 该层级功能将在后续开发中开放(1) |
| `peRenderTable` | app.js | Other | A | P2 | 📭 暂无付款主体数据(1) |
| `renderFreezeLine` | app.js | Other | A | P1 | 拖动调整冻结区域(1) |
| `onAdjReasonChange` | app.js | Other | A | P1 | 调整原因已保存(1) |
| `saveFinalQty` | app.js | Other | A | P1 | 已保存(1) |
| `sendFactory` | app.js | Other | A | P1 | 已标记发工厂(1) |
| `renderCmpTable` | app.js | Other | A | P2 | 暂无明细，点击「➕ 添加行」新增 SKU，或「📥 导入供应商PI」(1) |
| `saveDepPay` | app.js | Payment / Cost | A | P1 | 定金付款申请已生成(1) |
| `saveBalPay` | app.js | Payment / Cost | A | P1 | 尾款付款申请已生成(1) |
| `saveCustomsDutyPay` | app.js | Payment / Cost | A | P1 | 关税付款申请已创建(1) |
| `saveInspectionFeePay` | app.js | Payment / Cost | A | P2 | 商检费用付款申请已创建(1) |
| `createFrtPay` | app.js | Payment / Cost | A | P2 | 该物流批次未关联CI，请从CI费用管理页面创建到仓费用付款(1) |
| `loadCostAlloc` | app.js | Payment / Cost | A | P1 | CI号 SKU(1) |
| `loadCostWac` | app.js | Payment / Cost | A | P1 | 选择CI 选择CI(1) |
| `loadCostLogs` | app.js | Logistics / Freight | A | P2 | CI号 SKU 关键词(1) |
| `renderPayableCockpit` | app.js | Reports / Demand Forecast | A | P1 | 加载中…(1) |
| `payUploadFiles` | app.js | Payment / Cost | A | P1 | 无附件上传权限(1) |
| `payDeleteAttachment` | app.js | Payment / Cost | A | P1 | 附件已删除(1) |
| `onPayRemarkPaste` | app.js | Payment / Cost | A | P1 | 无附件上传权限(1) |
| `openPaymentExpenseCountry` | app.js | Payment / Cost | A | P2 | 货款付款申请不需要费用归属国家(1) |
| `editDeduction` | app.js | Payment / Cost | A | P1 | 未找到付款申请(1) |
| `saveDeduction` | app.js | Payment / Cost | A | P1 | 抵扣信息已保存(1) |
| `requireLogin` | server.js | Commercial Invoice / Inbound | A | P1 | 未登录(1) |
| `manual` | server.js | Other | A | P1 | 手动录入(1) |
| `customs_clearance` | server.js | Payment / Cost | A | P1 | 清关费(1) |
| `delivery` | server.js | Other | A | P1 | 派送费(1) |
| `other_local` | server.js | Other | A | P1 | 其他本地费(1) |
| `duty` | server.js | Other | A | P1 | 关税(2) |
| `key` | server.js | Other | A | P1 | (无品牌)(1) |
| `action_text` | server.js | Other | A | P1 | 停止采购，优先清库存(1) |
| `isStopped` | server.js | Other | A | P1 | 停采/清库存(4) |
| `actualShipDate` | server.js | Other | A | P1 | 实际出货日期(3) |
| `shipDate` | server.js | Other | A | P1 | 实际出货日期(2) |
| `price` | server.js | Other | A | P1 | 单价(2) |
| `rateRaw` | server.js | Other | A | P1 | 实际关税税率(1) |
| `cartons` | server.js | Other | A | P1 | 箱数(1) |
| `qtyPerCarton` | server.js | Other | A | P1 | 每箱数量(1) |
| `totalQty` | server.js | Other | A | P1 | 总数量(1) |
| `gross` | server.js | Other | A | P1 | 单箱毛重(1) |
| `net` | server.js | Other | A | P1 | 单箱净重(1) |
| `cbm` | server.js | Other | A | P1 | 单箱体积(1) |
| `activeExpenseCountry` | server.js | Payment / Cost | A | P2 | 无来源手工非货款必须选择费用归属国家(1) |
| `sanitizeAttachmentName` | server.js | Other | A | P1 | 未命名附件(1) |
| `rmb_note` | server.js | Other | A | P2 | 仅原币为 RMB 的单据计入已知人民币总额；其他币种未提供明确汇率证据时标记为待补，不做跨币种裸加。(1) |
| `warehouse_arrival` | server.js | Other | A | P1 | 到仓费用(1) |
| `customs_duty` | server.js | Payment / Cost | A | P1 | 关税(1) |
| `inspection_fee` | server.js | Payment / Cost | A | P1 | 商检费用(1) |
| `factory` | server.js | Other | A | P1 | 工厂(1) |
| `customs` | server.js | Payment / Cost | A | P1 | 海关(1) |
| `inspection_org` | server.js | Payment / Cost | A | P1 | 检验机构(1) |
| `service_provider` | server.js | Other | A | P1 | 服务商(1) |
| `currency` | server.js | Other | A | P2 | 各币种独立汇总，未提供 USD→RMB 等锁定汇率证据时不做跨币种折算或裸加(1) |
| `due_date` | server.js | Other | A | P2 | 到期日=CI实际出货日+Credit天数（computePayableDate 建单时写入 payable_date）；底层出货日/账期未录入的单据归入"无到期日"(1) |
| `outstanding` | server.js | Other | A | P2 | 未结清=应付-有效付款-有效抵扣-有效抹零（仅计 status=applied 的结算事件，与付款管理页/落库 unpaid_amount 同口径）(1) |
| `scope` | server.js | Other | A | P2 | 仅口径展示，未修改任何付款/审批/抵扣/冲销/汇率/WAC 业务规则与数据(1) |
| `origQty` | server.js | Other | A | P1 | 原库存数量(1) |
| `country` | server.js | Other | A | P1 | 国家(1) |
| `note` | server.js | Other | A | P2 | 如果当前采购单已绑定国家和仓库，模板只需 SKU、原库存数量、备注三列。(1) |

### 4. Sales 模块 （31 个函数，唯一文本 118 处）

| 函数 | 文件 | 页面 | 类型 | 优先级 | 代表性硬编码文本（文本(次数)） |
|---|---|---|---|---|---|
| `buildAiAdvice` | server.js | Other | A/C | P0 | 生命周期不适合正常补货，停止采购，优先消化库存。(2) · 清仓(1) · 停采/停产(1) · 新品/销售数据不足(1) · 销售时间不足，先人工复核目标周转，避免短期误判。(1) |
| `loadRp` | app.js | Reports / Demand Forecast | A | P1 | 天月均销量(3) · 按"预测参数设置"中的销量统计周期计算：近(3) · 天有效销量 ÷(3) · 线上(2) · 线下(2) |
| `renderCockpitLayers` | app.js | Analytics Cockpit | A/C | P0 | 笔(2) · CI出货日/Credit未录入，点击查看 ▼(1) · 应付概览(1) · 笔缺少应付日期(1) · 未结清(1) |
| `suggestion` | server.js | Other | A/C | P0 | 新品导入，不直接生成PO(1) · 新品启动，库存观察中(1) · 滞销SKU，暂缓补货(1) · 清仓中，不建议补货(1) · 停采/停产，不参与补货建议(1) |
| `renderSalesPreview` | app.js | Sales Data | A | P1 | 条(2) · 共(1) · 条数据 ， 有效(1) · ， 无效(1) · 行 来源系统 订单号 下单日期 SKU 数量 有效订单 校验(1) |
| `renderCockpitView` | app.js | Analytics Cockpit | A | P1 | 未设置(-)(1) · 🧭 财务应付驾驶舱(1) · 数据时间(1) · ｜ 今天(1) · 口径说明(1) |
| `loadRpDaily` | app.js | Reports / Demand Forecast | A | P1 | ">动销(1) · ">生命周期(1) · ">近7天(1) · ">近14天(1) · ">近30天(1) |
| `handleSalesFile` | app.js | Sales Data | A/C | P0 | 仅支持 .xlsx / .xls / .csv 格式(1) · 文件为空或缺少数据行(1) · 来源系统不能为空(1) · 订单号不能为空(1) · SKU不能为空(1) |
| `loadRpSummary` | app.js | Reports / Demand Forecast | A | P1 | 个(4) · 件(2) · SKU总数(1) · 天月均销量(1) · 按"预测参数设置"中的销量统计周期（近(1) |
| `requestSalesPreview` | app.js | Sales Data | A | P1 | 导入预览统计(1) · 总记录数：(1) · 将新增：(1) · 将更新：(1) · 重复无变化：(1) |
| `loadSales` | app.js | Sales Data | A | P1 | 来源系统(1) · 订单号(1) · 下单日期(1) · 渠道(1) · 数量(1) |
| `rpTotalColMeta` | app.js | Reports / Demand Forecast | A | P1 | 天月均销量(3) · 选择(1) · 线上(1) · 线下(1) · 在途库存(1) |
| `simplifyAction` | app.js | Other | C | P0 | 暂缓补货(3) · 优先补货(2) · 谨慎补货(1) · 正常补货(1) · 人工复核(1) |
| `saveRpParams` | app.js | Reports / Demand Forecast | A | P1 | 请选择有效的销量统计周期(1) · 周转值必须为正数(1) · 至少需要一条规则(1) · 目标周转多维默认值(JSON数组)：brand/country/warehouse/online_turnover/offline_turnover，空=通配；命中优先级 品牌+国家+仓库>品牌+国家>品牌+仓库>品牌>国家+仓库>国家>仓库>兜底(1) · 已保存预测参数，请点击「重新计算」使新参数生效(1) |
| `downloadSalesTemplate` | app.js | Sales Data | A | P1 | 正常订单(1) · 至速(1) · 取消订单不计入预测(1) · 销售数据(1) |
| `renderCockpitDetails` | app.js | Analytics Cockpit | A | P1 | 付款申请编号 供应商 来源 关联PI/CI 费用类型 付款主体 币种 应付 已核销 未结清 到期日 逾期天数 状态(1) · 无匹配记录(1) · (历史)(1) · 无到期日(1) |
| `sales_group` | server.js | Sales Data | C/A | P0 | 滞销(1) · 低动销(1) · 中动销(1) · 高动销(1) |
| `channelFilter` | server.js | Reports / Demand Forecast | A | P2 | AND (shop_platform LIKE '%线上%' OR lower(COALESCE(shop_platform, '')) = 'online')(1) · AND (shop_platform LIKE '%线下%' OR lower(COALESCE(shop_platform, '')) = 'offline')(1) |
| `paid` | app.js | Other | C | P0 | 已付款(2) |
| `unpaid` | app.js | Other | C | P0 | 未付款(1) |
| `partial_paid` | app.js | Other | C | P0 | 部分付款(2) |
| `saveRpFieldConfig` | app.js | Reports / Demand Forecast | A | P1 | 字段配置已保存(1) |
| `resetRpFieldConfig` | app.js | Reports / Demand Forecast | A | P1 | 已恢复默认字段配置(1) |
| `showRpSaveFailed` | app.js | Reports / Demand Forecast | A | P1 | 保存失败，请重试(1) |
| `saveChannelChanges` | app.js | Reports / Demand Forecast | A | P2 | 已保存，目标库存已回写总预测(1) |
| `onRpQtyChange` | app.js | Reports / Demand Forecast | A | P1 | 已更新(1) |
| `genRp` | app.js | Reports / Demand Forecast | A | P2 | 正在重新计算，请稍候...(1) |
| `dimScoreLabel` | app.js | Other | C | P0 | 得分(1) |
| `toggleCockpitDetail` | app.js | Analytics Cockpit | A | P1 | 收起 ▲(1) |
| `sales_status` | server.js | Sales Data | A | P1 | 停采/清库存(1) |
| `sales_reason` | server.js | Sales Data | A | P2 | 品牌已设为停采（停止合作），不参与补货建议，优先消化库存(1) |

### 5. Approval / System 模块 （14 个函数，唯一文本 33 处）

| 函数 | 文件 | 页面 | 类型 | 优先级 | 代表性硬编码文本（文本(次数)） |
|---|---|---|---|---|---|
| `api` | app.js | Proforma Invoice | A | P1 | ⚠️ 检测到您直接打开了 HTML 文件（file://）。本系统必须通过后端服务访问，请： ① 在终端运行 node server.js ② 浏览器打开 http://localhost:3001 （默认账号 admin / admin） 不要直接双击 index.html。(1) · ⚠️ 无法连接服务器（Failed to fetch）。请确认已运行 node server.js ，并通过 http://localhost:3001 访问本系统（不要使用静态文件服务器或 file:// 打开）。(1) · 未登录，请重新登录(1) · 没有操作权限(1) · 没有该操作的权限(1) |
| `renderUsers` | app.js | User / Role | A | P1 | 加载用户列表…(1) · disabled title="应急账号角色固定"(1) · 停用(1) · ','disabled')">停用(1) · ','active')">启用(1) |
| `ROLE_MODULE_ORDER` | app.js | User / Role | A | P1 | 系统管理(1) · 采购(1) · 库存(1) · 销售(1) · 财务(1) |
| `apiAuth` | server.js | Other | A | P1 | 未登录(1) · 会话无效或已过期(1) · 账号不存在(1) · 账号已停用(1) · 账号待管理员授权(1) |
| `loadRoles` | app.js | User / Role | A | P1 | 暂无角色(1) · 角色名 描述 权限数 系统 操作(1) · )" title="点击编辑权限">(1) · )">编辑权限(1) |
| `bootstrapBreakGlass` | server.js | Other | A | P1 | 超级管理员(2) · [AUTH] 未配置强密码 BREAKGLASS_ADMIN_PASSWORD（≥12位且含大小写与数字），启动失败（fail-closed）(1) · [AUTH] break-glass 密码已更新，旧 Session 已失效（user id 保持不变:(1) · [AUTH] break-glass 本地管理员已初始化（首次 INSERT，user id=user_admin）(1) |
| `getPILockReason` | server.js | Other | A | P1 | 已付定金(2) · 已作废(1) · 已生成CI(1) · 已生成PL(1) |
| `setUserStatus` | app.js | User / Role | C | P0 | 已启用(1) · 已停用(1) |
| `exchangeFeishuCode` | server.js | Other | A | P2 | 飞书配置或 code 缺失(1) · 获取 user_access_token 失败:(1) |
| `getFeishuTenantToken` | server.js | Other | A | P2 | 飞书应用配置缺失（FEISHU_APP_ID/FEISHU_APP_SECRET）(1) · 获取 tenant_access_token 失败:(1) |
| `sendFeishuTextMessage` | server.js | Other | A | P1 | open_id 为空(1) · 飞书消息发送失败:(1) |
| `setUserRole` | app.js | User / Role | A | P1 | 角色已更新(1) |
| `renderRoles` | app.js | User / Role | A | P1 | 🛡️ 角色管理(1) |
| `csrfGuard` | server.js | Other | A | P2 | 跨站请求被拒绝（CSRF 防护）(1) |

### 6. Cross-cutting / Shared UI（跨模块） （21 个函数，唯一文本 213 处）

| 函数 | 文件 | 页面 | 类型 | 优先级 | 代表性硬编码文本（文本(次数)） |
|---|---|---|---|---|---|
| `label` | app.js | Shared UI / Nav | A/C | P0 | 库存导入(4) · 出库记录(3) · 销售明细(3) · 渠道(2) · 库存(2) |
| `(global)` | app.js | Shared UI / Nav | A | P1 | 备注(4) · 无法匹配PO：(3) · SKU不存在：(3) · 币种(2) · ⚠️ 检测到您直接打开了 HTML 文件（file://）。进销存系统需要后端服务，请： ① 在终端运行 node server.js ② 浏览器访问 http://localhost:3001 不要直接双击 index.html。(1) |
| `headers` | app.js | Shared UI / Nav | A | P1 | 备注(3) · 数量(2) · 单价(2) · PI编号(1) · PI折扣(1) |
| `showPage` | app.js | Shared UI / Nav | A | P1 | 库存总表(1) · 销售数据(1) · 订单预测(1) · 应付驾驶舱(1) · 角色权限(1) |
| `preview` | server.js | Shared UI / Nav | A | P1 | SKU不能为空(1) · 下单日期不能为空(1) · 来源系统不能为空(1) · 订单号不能为空(1) · 下单日期格式无法识别：(1) |
| `sample` | app.js | Shared UI / Nav | A | P1 | 原库存数量(2) · 备注(2) · 是(1) |
| `columns` | server.js | Shared UI / Nav | A | P1 | 原库存数量(1) · 备注(1) |
| `active` | app.js | Shared UI / Nav | C | P0 | 启用(1) |
| `disabled` | app.js | Shared UI / Nav | C | P0 | 已停用(1) |
| `rejected` | app.js | Shared UI / Nav | C | P0 | 已驳回(2) |
| `cancelled` | app.js | Shared UI / Nav | C | P0 | 已取消(2) |
| `reversed` | app.js | Shared UI / Nav | C | P0 | 已冲销(2) |
| `normal` | app.js | Shared UI / Nav | C | P0 | 正常(1) |
| `clearance` | app.js | Shared UI / Nav | C | P0 | 清仓(1) |
| `abnormal` | app.js | Shared UI / Nav | C | P0 | 异常(1) |
| `in_transit` | app.js | Shared UI / Nav | C | P0 | 在途(1) |
| `partial_rounding` | app.js | Shared UI / Nav | A | P1 | 部分抹零(2) |
| `renderDashboard` | app.js | Shared UI / Nav | A | P2 | ⏳ 加载中... 运费占比趋势(1) |
| `other` | app.js | Shared UI / Nav | A | P1 | 其他(1) |
| `sheet` | app.js | Shared UI / Nav | A | P1 | 历史CI(1) |
| `goods` | app.js | Shared UI / Nav | A | P1 | 货款(2) |

## 4. 附录 A：Top 50 高频硬编码文本（导致混杂的主因）

| # | 当前硬编码文本 | 类型 | 建议 i18n key | 频次 | 主要模块 |
|---|---|---|---|---|---|
| 1 | 条 | A | `ui.txt.renderSkuPreview.25` | 25 | Cross |
| 2 | 第 | A | `ui.txt.afRenderLevels.22` | 22 | Cross |
| 3 | 备注 | A | `ui.txt.openSupplierModal.21` | 21 | Cross |
| 4 | 库存 | A | `ui.txt.ROLEMODULEORDER.21` | 21 | Cross |
| 5 | 采购 | A | `ui.txt.ROLEMODULEORDER.19` | 19 | Cross |
| 6 | 未选择记录 | A | `fin.txt.error.16` | 16 | Finance |
| 7 | CI不存在 | A | `fin.txt.error.15` | 15 | Finance |
| 8 | 关闭 | C | `ui.enum.showBatchResultModal.14` | 14 | Cross |
| 9 | 记录不存在 | A | `fin.txt.reason.14` | 14 | Finance |
| 10 | 清仓 | C | `ui.enum.clearance.12` | 12 | Cross |
| 11 | 正常 | C | `ui.enum.normal.10` | 10 | Cross |
| 12 | 是 | A | `ui.txt.loadSKUs.10` | 10 | Cross |
| 13 | 付款申请不存在 | A | `fin.txt.recalculatePaymentSettlement.10` | 10 | Finance |
| 14 | 行： | A | `ui.txt.renderSkuPreview.9` | 9 | Cross |
| 15 | 天月均销量 | A | `ui.txt.rpTotalColMeta.9` | 9 | Cross |
| 16 | 慢销 | C | `ui.enum.slowmoving.8` | 8 | Cross |
| 17 | 财务 | C | `ui.enum.label.8` | 8 | Cross |
| 18 | 级审批用户「 | A | `fin.txt.error.8` | 8 | Finance |
| 19 | 启用 | C | `ui.enum.active.7` | 7 | Cross |
| 20 | 名称 | A | `ui.txt.renderCountries.7` | 7 | Cross |
| 21 | 停用 | A | `ui.txt.loadSuppliers.7` | 7 | Cross |
| 22 | 停产 | C | `ui.enum.SKULIFECYCLEMAP.7` | 7 | Cross |
| 23 | 停采/停产 | C | `ui.enum.SKULIFECYCLEMAP.7` | 7 | Cross |
| 24 | 线上 | A | `ui.txt.downloadInvTemplate.7` | 7 | Cross |
| 25 | 线下 | A | `ui.txt.downloadInvTemplate.7` | 7 | Cross |
| 26 | 数量 | A | `ui.txt.label.7` | 7 | Cross |
| 27 | 实际出货日期 | A | `ui.txt.actualShipDate.7` | 7 | Cross |
| 28 | 失败原因 | A | `ui.txt.downloadBatchErrors.6` | 6 | Cross |
| 29 | 否 | A | `ui.txt.loadSKUs.6` | 6 | Cross |
| 30 | 停采 | C | `ui.enum.SKULIFECYCLEMAP.6` | 6 | Cross |
| 31 | 点击上传或拖拽文件到此处 | A | `ui.txt.openSkuBatchImport.6` | 6 | Cross |
| 32 | 共 | A | `ui.txt.renderSkuPreview.6` | 6 | Cross |
| 33 | 失败明细 | A | `ui.txt.submitSkuBatchImport.6` | 6 | Cross |
| 34 | status 只允许 active 或 inactive | A | `fin.txt.error.6` | 6 | Finance |
| 35 | SKU不存在 | A | `ui.txt.error.6` | 6 | Cross |
| 36 | PO不存在 | A | `fin.txt.error.6` | 6 | Finance |
| 37 | 抵扣金额大于0时必须填写抵扣来源类型和说明 | A | `fin.txt.applyDeductionSettlement.6` | 6 | Finance |
| 38 | 销售 | C | `ui.enum.label.5` | 5 | Cross |
| 39 | 状态 | A | `ui.txt.openSupplierModal.5` | 5 | Cross |
| 40 | 取消 | A | `ui.txt.openRoleEditor.5` | 5 | Cross |
| 41 | 个 | A | `ui.txt.batchSkuDelete.5` | 5 | Cross |
| 42 | 滞销 | C | `ui.enum.SKULIFECYCLEMAP.5` | 5 | Cross |
| 43 | 下载模板 | A | `ui.txt.openSkuBatchImport.5` | 5 | Cross |
| 44 | 开始导入 | A | `ui.txt.openSkuBatchImport.5` | 5 | Cross |
| 45 | 仅支持 .xlsx / .xls / .csv 格式 | A | `ui.txt.handleSkuFile.5` | 5 | Cross |
| 46 | 文件为空或缺少数据行 | A | `ui.txt.handleSkuFile.5` | 5 | Cross |
| 47 | 条数据 ， 有效 | A | `ui.txt.renderSkuPreview.5` | 5 | Cross |
| 48 | ， 无效 | A | `ui.txt.renderSkuPreview.5` | 5 | Cross |
| 49 | ... 还有 | A | `ui.txt.renderSkuPreview.5` | 5 | Cross |
| 50 | 无效行明细： | A | `ui.txt.renderSkuPreview.5` | 5 | Cross |

## 5. 附录 B：状态 / 生命周期 / 枚举（类型 C，需确认键策略）

这些文本是业务状态/枚举的显示值，已存在集中映射。建议：保持 DB 枚举值不变，显示统一走 i18n key（已有 `STATUS_KEY_MAP` 基础设施），缺失时回退中文。

| 当前文本 | 频次 | 主要函数 | 建议 key 前缀 |
|---|---|---|---|
| 关闭 | 14 | showBatchResultModal, showSkuImportRecords, batchSkuDelete | `ui.enum.showBatchResultModal.14` |
| 清仓 | 12 | clearance, SKU_STATUS_MAP, shouldBlockReplenish | `ui.enum.clearance.12` |
| 正常 | 10 | normal, SKU_STATUS_MAP, cockpitSupplierStatus | `ui.enum.normal.10` |
| 慢销 | 8 | slow_moving, shouldBlockReplenish, buildAiAdvice | `ui.enum.slowmoving.8` |
| 财务 | 8 | label, ROLE_MODULE_ORDER, module | `ui.enum.label.8` |
| 启用 | 7 | active, loadSuppliers, pcStatusBadge | `ui.enum.active.7` |
| 停产 | 7 | SKU_LIFECYCLE_MAP, SKU_STATUS_MAP, LIFECYCLE_MAP | `ui.enum.SKULIFECYCLEMAP.7` |
| 停采/停产 | 7 | SKU_LIFECYCLE_MAP, LIFECYCLE_MAP, buildAiAdvice | `ui.enum.SKULIFECYCLEMAP.7` |
| 停采 | 6 | SKU_LIFECYCLE_MAP, SKU_STATUS_MAP, LIFECYCLE_MAP | `ui.enum.SKULIFECYCLEMAP.6` |
| 销售 | 5 | label, ROLE_MODULE_ORDER, module | `ui.enum.label.5` |
| 滞销 | 5 | SKU_LIFECYCLE_MAP, LIFECYCLE_MAP, highStock | `ui.enum.SKULIFECYCLEMAP.5` |
| 渠道 | 5 | label, loadSales, salesBatchExport | `ui.enum.label.5` |
| 已驳回 | 4 | rejected, financeApprove, apprPay | `ui.enum.rejected.4` |
| 有效 | 4 | handleSalesFile, viewPayment, isValid | `ui.enum.handleSalesFile.4` |
| 已停用 | 3 | disabled, toggleSupplierStatus, setUserStatus | `ui.enum.disabled.3` |
| 已通过 | 3 | approved, financeApprove, apprPay | `fin.enum.approved.3` |
| 已付款 | 3 | paid, normalizeHistoricalCI | `ui.enum.paid.3` |
| 已冲销 | 3 | reversed, viewPayment | `ui.enum.reversed.3` |
| 断货风险 | 3 | out_of_stock_risk, INVENTORY_STATUS_MAP, INVENTORY_STATUS_LABELS | `inv.enum.outofstockrisk.3` |
| 高库存 | 3 | high_stock, INVENTORY_STATUS_MAP, INVENTORY_STATUS_LABELS | `inv.enum.highstock.3` |
| 异常 | 3 | abnormal, INVENTORY_STATUS_MAP, INVENTORY_STATUS_LABELS | `ui.enum.abnormal.3` |
| 在途 | 3 | in_transit, loadInv, invBatchExport | `ui.enum.intransit.3` |
| 库存总表 | 3 | label, showPage, invBatchExport | `ui.enum.label.3` |
| 销售数据 | 3 | label, showPage, downloadSalesTemplate | `ui.enum.label.3` |
| 新品启动 | 3 | SKU_LIFECYCLE_MAP, LIFECYCLE_MAP | `ui.enum.SKULIFECYCLEMAP.3` |
| 成长期 | 3 | SKU_LIFECYCLE_MAP, LIFECYCLE_MAP | `ui.enum.SKULIFECYCLEMAP.3` |
| 成熟期 | 3 | SKU_LIFECYCLE_MAP, LIFECYCLE_MAP | `ui.enum.SKULIFECYCLEMAP.3` |
| 衰退期 | 3 | SKU_LIFECYCLE_MAP, LIFECYCLE_MAP | `ui.enum.SKULIFECYCLEMAP.3` |
| 清仓期 | 3 | SKU_LIFECYCLE_MAP, LIFECYCLE_MAP | `ui.enum.SKULIFECYCLEMAP.3` |
| 暂缓补货 | 3 | simplifyAction | `sales.enum.simplifyAction.3` |
| 无到期日 | 3 | cockpitSupplierStatus, renderCockpitDetails, cockpitSupplierDrawer | `ui.enum.cockpitSupplierStatus.3` |
| 出库记录 | 3 | label | `ui.enum.label.3` |
| 销售明细 | 3 | label | `ui.enum.label.3` |
| 待审批 | 2 | pending_approval | `fin.enum.pendingapproval.2` |
| 已取消 | 2 | cancelled | `ui.enum.cancelled.2` |
| 部分付款 | 2 | partial_paid | `sales.enum.partialpaid.2` |
| 订单预测 | 2 | label, showPage | `ui.enum.label.2` |
| 应付驾驶舱 | 2 | label, showPage | `ui.enum.label.2` |
| 角色权限 | 2 | label, showPage | `ui.enum.label.2` |
| 已启用 | 2 | toggleSupplierStatus, setUserStatus | `ui.enum.toggleSupplierStatus.2` |
| 优先补货 | 2 | simplifyAction | `sales.enum.simplifyAction.2` |
| 补货预测 | 2 | label | `ui.enum.label.2` |
| 入库记录 | 2 | label | `ui.enum.label.2` |
| 销量与周转正常 | 2 | classifySkuState | `inv.enum.classifySkuState.2` |
| 严重缺货 | 2 | stockoutRisk, risk_level | `ui.enum.stockoutRisk.2` |
| 待激活 | 1 | pending | `fin.enum.pending.1` |
| 未付款 | 1 | unpaid | `sales.enum.unpaid.1` |
| 部分 | 1 | partial | `pur.enum.partial.1` |
| 草稿 | 1 | draft | `fin.enum.draft.1` |
| 进行中 | 1 | open | `fin.enum.open.1` |
| 已完成 | 1 | completed | `pur.enum.completed.1` |
| 已转PI | 1 | transferred_pi | `pur.enum.transferredpi.1` |
| 所属一级类目 | 1 | pcOpenMapModal | `fin.enum.pcOpenMapModal.1` |
| 所属二级类目 | 1 | pcOpenMapModal | `fin.enum.pcOpenMapModal.1` |
| 谨慎补货 | 1 | simplifyAction | `sales.enum.simplifyAction.1` |
| 正常补货 | 1 | simplifyAction | `sales.enum.simplifyAction.1` |
| 人工复核 | 1 | simplifyAction | `sales.enum.simplifyAction.1` |
| 暂停补货 | 1 | simplifyAction | `sales.enum.simplifyAction.1` |
| 得分 | 1 | dimScoreLabel | `sales.enum.dimScoreLabel.1` |
| 已逾期 | 1 | cockpitSupplierStatus | `pur.enum.cockpitSupplierStatus.1` |
| 即将到期 | 1 | cockpitSupplierStatus | `pur.enum.cockpitSupplierStatus.1` |
| 未结清 | 1 | renderCockpitLayers | `sales.enum.renderCockpitLayers.1` |
| 已结清 | 1 | renderCockpitLayers | `sales.enum.renderCockpitLayers.1` |
| 物流查看 | 1 | label | `ui.enum.label.1` |
| 物流创建 | 1 | label | `ui.enum.label.1` |
| 物流编辑 | 1 | label | `ui.enum.label.1` |
| 入库查看 | 1 | label | `ui.enum.label.1` |
| 入库创建 | 1 | label | `ui.enum.label.1` |
| 入库编辑 | 1 | label | `ui.enum.label.1` |
| 入库确认 | 1 | label | `ui.enum.label.1` |
| 库存查看 | 1 | label | `ui.enum.label.1` |
| 补货查看 | 1 | label | `ui.enum.label.1` |
| 补货编辑 | 1 | label | `ui.enum.label.1` |
| 盘点查看 | 1 | label | `ui.enum.label.1` |
| 盘点创建 | 1 | label | `ui.enum.label.1` |
| 呆滞查看 | 1 | label | `ui.enum.label.1` |
| 出库查看 | 1 | label | `ui.enum.label.1` |
| 出库创建 | 1 | label | `ui.enum.label.1` |
| 成本查看 | 1 | label | `ui.enum.label.1` |
| 付款查看 | 1 | label | `ui.enum.label.1` |
| 付款创建 | 1 | label | `ui.enum.label.1` |
| 仪表盘查看 | 1 | label | `ui.enum.label.1` |
| 货代查看 | 1 | label | `ui.enum.label.1` |
| 印度尼西亚 | 1 | COUNTRY_ALIAS_MAP | `inv.enum.COUNTRYALIASMAP.1` |
| 印尼 | 1 | COUNTRY_ALIAS_MAP | `inv.enum.COUNTRYALIASMAP.1` |
| 印度尼西亚共和国 | 1 | COUNTRY_ALIAS_MAP | `inv.enum.COUNTRYALIASMAP.1` |
| 马来西亚 | 1 | COUNTRY_ALIAS_MAP | `inv.enum.COUNTRYALIASMAP.1` |
| 马来 | 1 | COUNTRY_ALIAS_MAP | `inv.enum.COUNTRYALIASMAP.1` |
| 马来西亚联邦 | 1 | COUNTRY_ALIAS_MAP | `inv.enum.COUNTRYALIASMAP.1` |
| 泰王国 | 1 | COUNTRY_ALIAS_MAP | `inv.enum.COUNTRYALIASMAP.1` |
| 泰国 | 1 | COUNTRY_ALIAS_MAP | `inv.enum.COUNTRYALIASMAP.1` |
| 线上销售 | 1 | OB_TYPE_MAP | `inv.enum.OBTYPEMAP.1` |
| 线下销售 | 1 | OB_TYPE_MAP | `inv.enum.OBTYPEMAP.1` |
| 调拨 | 1 | OB_TYPE_MAP | `inv.enum.OBTYPEMAP.1` |
| 报废 | 1 | OB_TYPE_MAP | `inv.enum.OBTYPEMAP.1` |
| 样品 | 1 | OB_TYPE_MAP | `inv.enum.OBTYPEMAP.1` |
| 损坏 | 1 | OB_TYPE_MAP | `inv.enum.OBTYPEMAP.1` |
| 退货 | 1 | OB_TYPE_MAP | `inv.enum.OBTYPEMAP.1` |
| 手工调整 | 1 | OB_TYPE_MAP | `inv.enum.OBTYPEMAP.1` |
| 生命周期为清仓期 | 1 | classifySkuState | `inv.enum.classifySkuState.1` |
| 可用库存周转 | 1 | classifySkuState | `inv.enum.classifySkuState.1` |
| 人工复核后决定 | 1 | classifySkuState | `inv.enum.classifySkuState.1` |
| 无销量 | 1 | risk_level | `fin.enum.risklevel.1` |
| 库存调整单 | 1 | label | `ui.enum.label.1` |

**已知集中映射（代码中已存在，需逐项确认是否补齐 en/id 键）**:
- `STATUS_ZH` / `STATUS_KEY_MAP`（app.js 顶部）：PO/PI/CI/付款/库存/审批等全部 status 值。
- `SKU_LIFECYCLE_MAP` / `LIFECYCLE_MAP`：SKU 生命周期（正常/慢销/清仓/停产/停采…）。
- `SKU_STATUS_MAP`：SKU 业务状态。
- `OUTBOUND_STATUS_LABELS` / `OB_TYPE_MAP`：出库状态/类型。
- `COUNTRY_ALIAS_MAP`：国家别名（真实地理名，语言相关，建议 C/确认）。

## 6. 附录 C：类型 B（不需国际化）说明

本扫描为 CJK 字面量扫描，语言无关数据通常为非 CJK（英文/编码），不会被命中，故 B 计数为 0。下列为**应当保持原样**的典型数据，实施后亦不得翻译：

- SKU 编码（如 `SKU-AB12`）、PO/PI/CI 编号、ERP 单号
- 品牌名、仓库名、货代名、供应商名称（真实主数据）
- 国家/币种代码（`CN`/`ID`/`US`/`USD`/`CNY`）
- 系统内部 code / 枚举原始值（如 `pending_approval`、`partial_paid`）——注意：code 本身不翻译，但其**显示文本**属类型 C（见附录 B）。

## 7. 附录 D：已接入 t() 的 fallback 中文（二次覆盖检查）

共 1153 处（753 个唯一文本）已用 `t(key, '中文')` 包裹。它们**仅在 `dict.en` / `dict.id` 缺失该 key 时**回退中文，是英文/印尼语模式下残留中文的第二来源。

**建议**：将此 753 个 key 与 `i18n.js` 的 `dict.en` / `dict.id` 做覆盖比对，补齐缺失键即可消除此类混杂（不改动业务代码）。这属于独立的「覆盖补齐」任务，不在本次硬编码清单内。

## 8. 后续实施建议（须经 审计→方案→确认→实施 门禁）

1. **P0（128 项）**：先处理状态/枚举（C）与最高频按钮/表头（确定/取消/保存/删除/状态列等），消除最显眼混杂。
2. **P1（936 项）**：表头、Modal、表单字段、空状态、业务提示，按模块分批接线。
3. **P2（360 项）**：长描述/帮助文本/罕见提示。
4. **附录 D 覆盖补齐**：单独任务，比对并补齐 `dict.en/id` 缺失键。
5. **结构快照纪律**：每次 i18n 修改前后须做 7 维结构比对（id/class/onclick/data/placeholder/标签层级/转义），结构变化不得提交，先报告。
6. **禁止机器翻译覆盖 HTML 模板**：文字可变、结构不可变。

> 本文件与 `dynamic-localization-plan.json` 仅为审计交付物，未对任何源文件做改动。
