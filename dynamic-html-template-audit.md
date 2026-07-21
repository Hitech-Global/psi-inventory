# Dynamic HTML Template Recovery — 全量扫描审计报告 (Phase 3-C-3)

> 只读扫描阶段 · 未修改任何源码 · 未补翻译 · 未 commit/push/deploy

## 1. 扫描概览

| 指标 | 数量 |
| --- | --- |
| 扫描 i18n 模板键 (html.*/modal.* 含 HTML 标签) | 126 |
| 扫描实例 (每键 en+id) | 252 |
| **PASS** | 78 |
| **FAIL** | 172 (86 个键) |
| **WARN** (无基线，不可验证) | 2 (1 个键) |
| app.js innerHTML 内联中文区域 (补充扫描) | 18 个函数 |

**失败根因分布（172 实例）：**
- **A 组 — 纯双重转义（高优先级）**: 76 实例 — en/id 模板被二次转义（运行时值含 `\"`），属性/标签解析失败；解除转义后结构 100% 匹配 zh 基线。
- **B 组 — 双重转义 + 占位符文本丢失**: 8 实例 — 同样存在双重转义，且翻译流程把占位符文本置空；解除转义后结构匹配 zh，仅占位符提示缺失（非渲染阻断）。
- **C 组 — 仅占位符文本不匹配（转义正确）**: 2 实例 — `\"` 数量=0，页面可正常渲染，仅 en/id 占位符值与 zh 基线不一致（提示缺失）。
- 残留中文（en/id 模板内）: **0**（en/id 模板文本均已翻译，无中文残留）。

## 2. 关键结论

1. **统一根因 = 双重转义**。与 Phase 3-C-2 修复的 `html.loadInv` 同源：en/id 的 HTML 模板值在写入 i18n.js 时被二次转义，运行时字符串含字面 `\"`，导致 `class="data-table"` 等属性无法被浏览器解析 → 表格/表单/筛选区不渲染或失去结构/样式。
2. **en/id 模板文本均已翻译**（en/id 内 CJK=0），问题纯属转义，不缺译文。修复转义即可恢复渲染，且结构对齐 zh 基线。
3. **16 个键**解除转义后结构正常，仅占位符文本在翻译流程中被置空（如 `数量`、`请填写作废原因（必填）`），属 P1 文本回填，不阻断渲染。
4. **中文残留真实来源**是 app.js 的 18 个内联 `innerHTML` 函数（如 renderUsers/loadFinanceApprovalList/renderDashboard 等），它们与语言无关、任何语言下都显示中文 —— 属独立 backlog（用 t() 包裹），不在本次 en/id 转义修复范围内。
5. `html.renderUsers` 在 i18n 中无 zh 基线，结构不可验证（已列为 WARN）。

## 3. 失败模板明细（i18n.js 双重转义）

| # | 文件 | key | 影响语言 | 影响页面 | 缺失结构 / 问题 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | i18n.js | `html.renderDashboard` | en+id | Dashboard/Finance (财务驾驶舱) | 双重转义：运行时值含 18 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 2 | i18n.js | `html.renderSuppliers` | en+id | Suppliers (供应商) | 双重转义：运行时值含 16 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 3 | i18n.js | `modal.footer.openSupplierModal` | en+id | Suppliers (供应商) | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 4 | i18n.js | `html.switchApprovalTab` | en+id | Approval Center (审批中心) | 双重转义：运行时值含 4 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 5 | i18n.js | `html.loadFinanceApprovalList` | en+id | Approval Center (审批中心) | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 6 | i18n.js | `modal.footer.approvePO` | en+id | Modal: footer.approvePO | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 7 | i18n.js | `modal.body.openApprovalDetail` | en+id | Approval Center (审批中心) | 双重转义：运行时值含 12 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 8 | i18n.js | `html.renderConfig` | en+id | Other (html.renderConfig) | 双重转义：运行时值含 14 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 9 | i18n.js | `html.renderBrandSettings` | en+id | Other (html.renderBrandSettings) | 双重转义：运行时值含 12 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 10 | i18n.js | `html.renderPaymentCategories` | en+id | Payment (付款管理) | 双重转义：运行时值含 26 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 11 | i18n.js | `html.pcRenderSubs` | en+id | Other (html.pcRenderSubs) | 双重转义：运行时值含 2 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 12 | i18n.js | `html.pcRenderMaps` | en+id | Other (html.pcRenderMaps) | 双重转义：运行时值含 2 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 13 | i18n.js | `html.renderPayerEntities` | en+id | Payment (付款管理) | 双重转义：运行时值含 16 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 14 | i18n.js | `html.renderPayerEntities.2` | en+id | Payment (付款管理) | 双重转义：运行时值含 4 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 15 | i18n.js | `html.peRenderTable` | en+id | Other (html.peRenderTable) | 双重转义：运行时值含 6 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 16 | i18n.js | `html.renderSKUs` | en+id | Products (商品/SKU) | 双重转义（50 处 \"）解除后结构匹配 zh，但占位符文本在翻译中丢失：zh 占位符=["missing placeholders: SKU/产品名/Model/EAN"] → en/id 为空或缺失 | High |
| 17 | i18n.js | `html.updateSkuBatchBar` | en+id | Products (商品/SKU) | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 18 | i18n.js | `modal.body.openBatchSkuEditModal` | en+id | Modal: body.openBatchSkuEditModal | 双重转义：运行时值含 6 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 19 | i18n.js | `modal.footer.openBatchSkuEditModal` | en+id | Modal: footer.openBatchSkuEditModal | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 20 | i18n.js | `modal.footer.editSKU` | en+id | Modal: footer.editSKU | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 21 | i18n.js | `html.renderInventory` | en+id | Inventory (库存管理) | 转义正确（0 处 \"），页面可正常渲染；但占位符值与 zh 基线不一致：zh 占位符=["missing placeholders: SKU/产品名"]，en/id 缺失或为空 | Medium |
| 22 | i18n.js | `html.renderOutbound` | en+id | Other (html.renderOutbound) | 双重转义：运行时值含 82 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 23 | i18n.js | `html.loadSales` | en+id | Other (html.loadSales) | 双重转义：运行时值含 22 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 24 | i18n.js | `modal.footer.openRpFieldConfig` | en+id | Modal: footer.openRpFieldConfig | 双重转义：运行时值含 12 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 25 | i18n.js | `html.renderReplenishment` | en+id | Other (html.renderReplenishment) | 双重转义（116 处 \"）解除后结构匹配 zh，但占位符文本在翻译中丢失：zh 占位符=["missing placeholders: SKU搜索"] → en/id 为空或缺失 | High |
| 26 | i18n.js | `html.loadRpFilterOptions` | en+id | Other (html.loadRpFilterOptions) | 双重转义：运行时值含 2 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 27 | i18n.js | `html.onRpCountryChange` | en+id | Other (html.onRpCountryChange) | 双重转义：运行时值含 2 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 28 | i18n.js | `html.onRpCountryChange.2` | en+id | Other (html.onRpCountryChange.2) | 双重转义：运行时值含 2 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 29 | i18n.js | `html.onRpBrandChange` | en+id | Other (html.onRpBrandChange) | 双重转义：运行时值含 2 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 30 | i18n.js | `html.addRpDimRow` | en+id | Other (html.addRpDimRow) | 双重转义（54 处 \"）解除后结构匹配 zh，但占位符文本在翻译中丢失：zh 占位符=["missing placeholders: (空=通配), (空=通配), (空=通配)"] → en/id 为空或缺失 | High |
| 31 | i18n.js | `modal.body.genPOModal` | en+id | Modal: body.genPOModal | 双重转义：运行时值含 4 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 32 | i18n.js | `modal.body.continueGenPO` | en+id | Modal: body.continueGenPO | 双重转义：运行时值含 64 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 33 | i18n.js | `modal.footer.openPOExportConfirm` | en+id | Modal: footer.openPOExportConfirm | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 34 | i18n.js | `html.renderPO` | en+id | Other (html.renderPO) | 双重转义：运行时值含 46 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 35 | i18n.js | `modal.body.viewPO` | en+id | Modal: body.viewPO | 双重转义：运行时值含 18 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 36 | i18n.js | `modal.body.createPO` | en+id | Modal: body.createPO | 双重转义：运行时值含 54 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 37 | i18n.js | `html.addPORow` | en+id | Other (html.addPORow) | 双重转义（24 处 \"）解除后结构匹配 zh，但占位符文本在翻译中丢失：zh 占位符=["missing placeholders: 数量"] → en/id 为空或缺失 | High |
| 38 | i18n.js | `modal.body.openVoidModal` | en+id | Modal: body.openVoidModal | 双重转义（18 处 \"）解除后结构匹配 zh，但占位符文本在翻译中丢失：zh 占位符=["missing placeholders: 请填写作废原因（必填）"] → en/id 为空或缺失 | High |
| 39 | i18n.js | `modal.footer.openVoidModal` | en+id | Modal: footer.openVoidModal | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 40 | i18n.js | `html.renderPI` | en+id | Other (html.renderPI) | 双重转义：运行时值含 50 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 41 | i18n.js | `modal.body.viewPI` | en+id | Modal: body.viewPI | 双重转义：运行时值含 16 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 42 | i18n.js | `modal.body.editPI` | en+id | Modal: body.editPI | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 43 | i18n.js | `modal.footer.editPI` | en+id | Modal: footer.editPI | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 44 | i18n.js | `modal.body.createPI` | en+id | Modal: body.createPI | 双重转义：运行时值含 90 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 45 | i18n.js | `html.onPISupplierChange` | en+id | Suppliers (供应商) | 双重转义：运行时值含 2 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 46 | i18n.js | `html.recomputeCmpFooter` | en+id | Other (html.recomputeCmpFooter) | 双重转义：运行时值含 14 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 47 | i18n.js | `modal.body.createDepPay` | en+id | Payment (付款管理) | 双重转义：运行时值含 74 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 48 | i18n.js | `modal.footer.createDepPay` | en+id | Payment (付款管理) | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 49 | i18n.js | `modal.body.openDocImport` | en+id | Modal: body.openDocImport | 双重转义：运行时值含 28 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 50 | i18n.js | `modal.footer.openDocImport` | en+id | Modal: footer.openDocImport | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 51 | i18n.js | `html.renderCI` | en+id | Other (html.renderCI) | 双重转义：运行时值含 58 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 52 | i18n.js | `html.loadCI` | en+id | Other (html.loadCI) | 双重转义：运行时值含 4 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 53 | i18n.js | `modal.body.createHistoricalCI` | en+id | Modal: body.createHistoricalCI | 双重转义：运行时值含 122 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 54 | i18n.js | `modal.body.editActualShipDate` | en+id | Modal: body.editActualShipDate | 双重转义：运行时值含 18 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 55 | i18n.js | `modal.body.viewHistoricalCI` | en+id | Modal: body.viewHistoricalCI | 双重转义：运行时值含 14 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 56 | i18n.js | `modal.footer.viewHistoricalCI` | en+id | Modal: footer.viewHistoricalCI | 双重转义：运行时值含 4 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 57 | i18n.js | `modal.body.viewCI` | en+id | Modal: body.viewCI | 双重转义：运行时值含 28 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 58 | i18n.js | `modal.body.createCI` | en+id | Modal: body.createCI | 双重转义：运行时值含 56 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 59 | i18n.js | `html.addCIRow` | en+id | Other (html.addCIRow) | 双重转义（46 处 \"）解除后结构匹配 zh，但占位符文本在翻译中丢失：zh 占位符=["missing placeholders: 发货量, 单价, 实际关税税率(%)"] → en/id 为空或缺失 | High |
| 60 | i18n.js | `modal.body.createBalPay` | en+id | Payment (付款管理) | 双重转义：运行时值含 74 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 61 | i18n.js | `modal.footer.createBalPay` | en+id | Payment (付款管理) | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 62 | i18n.js | `modal.body.viewCICost` | en+id | Dashboard/Finance (财务驾驶舱) | 双重转义：运行时值含 108 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 63 | i18n.js | `modal.body.createWarehousePay` | en+id | Payment (付款管理) | 双重转义（96 处 \"）解除后结构匹配 zh，但占位符文本在翻译中丢失：zh 占位符=["missing placeholders: 货代/服务商名称"] → en/id 为空或缺失 | High |
| 64 | i18n.js | `modal.footer.createWarehousePay` | en+id | Payment (付款管理) | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 65 | i18n.js | `modal.footer.createCustomsDutyPay` | en+id | Payment (付款管理) | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 66 | i18n.js | `modal.footer.createInspectionFeePay` | en+id | Payment (付款管理) | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 67 | i18n.js | `html.renderLogistics` | en+id | Other (html.renderLogistics) | 双重转义：运行时值含 42 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 68 | i18n.js | `modal.body.viewLog` | en+id | Modal: body.viewLog | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 69 | i18n.js | `modal.body.createLog` | en+id | Modal: body.createLog | 双重转义：运行时值含 146 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 70 | i18n.js | `html.renderInbound` | en+id | Other (html.renderInbound) | 双重转义：运行时值含 32 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 71 | i18n.js | `modal.body.createIn` | en+id | Modal: body.createIn | 双重转义：运行时值含 54 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 72 | i18n.js | `html.loadPLForIn` | en+id | Other (html.loadPLForIn) | 双重转义：运行时值含 6 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 73 | i18n.js | `html.loadCostOrigin` | en+id | Dashboard/Finance (财务驾驶舱) | 双重转义：运行时值含 18 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 74 | i18n.js | `html.loadCostOrigin.2` | en+id | Dashboard/Finance (财务驾驶舱) | 双重转义：运行时值含 2 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 75 | i18n.js | `html.loadOriginRecords` | en+id | Other (html.loadOriginRecords) | 双重转义：运行时值含 14 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 76 | i18n.js | `html.loadCostWac` | en+id | Dashboard/Finance (财务驾驶舱) | 双重转义：运行时值含 2 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 77 | i18n.js | `html.renderPayableCockpit` | en+id | Payment (付款管理) | 双重转义：运行时值含 4 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 78 | i18n.js | `html.renderPayment` | en+id | Payment (付款管理) | 转义正确（0 处 \"），页面可正常渲染；但占位符值与 zh 基线不一致：zh 占位符=["missing placeholders: 申请号/供应商/来源单号"]，en/id 缺失或为空 | Medium |
| 79 | i18n.js | `modal.body.confirmPaid` | en+id | Modal: body.confirmPaid | 双重转义：运行时值含 58 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 80 | i18n.js | `modal.footer.confirmPaid` | en+id | Modal: footer.confirmPaid | 双重转义：运行时值含 10 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 81 | i18n.js | `modal.body.openPaymentRounding` | en+id | Payment (付款管理) | 双重转义（44 处 \"）解除后结构匹配 zh，但占位符文本在翻译中丢失：zh 占位符=["missing placeholders: 请手动填写"] → en/id 为空或缺失 | High |
| 82 | i18n.js | `modal.footer.openPaymentRounding` | en+id | Payment (付款管理) | 双重转义：运行时值含 10 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 83 | i18n.js | `modal.body.openPaymentExpenseCountry` | en+id | Payment (付款管理) | 双重转义：运行时值含 16 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 84 | i18n.js | `modal.footer.openPaymentExpenseCountry` | en+id | Payment (付款管理) | 双重转义：运行时值含 10 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 85 | i18n.js | `modal.body.editDeduction` | en+id | Modal: body.editDeduction | 双重转义：运行时值含 70 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |
| 86 | i18n.js | `modal.footer.editDeduction` | en+id | Modal: footer.editDeduction | 双重转义：运行时值含 8 处 \"；解除转义后结构与 zh 基线 100% 一致（id/class/onclick/data/placeholder/{vN}/标签层级均匹配） | High |

### 3a. 无基线键（WARN）

- `html.renderUsers` (i18n.js, en+id) — 无 zh 基线，结构不可验证

## 4. 补充：app.js 内联中文残留（locale-independent，非 en/id 专属）

| # | 文件 | 函数 | 影响页面 | CJK 字符数 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 1 | app.js | `renderStagnant()` | Inventory (库存管理) | 32 | Medium |
| 2 | app.js | `renderForwarderAnalysis()` | Dashboard/Finance (财务驾驶舱) | 20 | Medium |
| 3 | app.js | `renderSupTerms()` | Dashboard/Finance (财务驾驶舱) | 18 | Medium |
| 4 | app.js | `renderCmpTable()` | Dashboard/Finance (财务驾驶舱) | 17 | Medium |
| 5 | app.js | `loadCostAlloc()` | Dashboard/Finance (财务驾驶舱) | 14 | Medium |
| 6 | app.js | `loadCostLogs()` | Dashboard/Finance (财务驾驶舱) | 13 | Medium |
| 7 | app.js | `renderDashboard()` | Dashboard/Finance (财务驾驶舱) | 9 | Medium |
| 8 | app.js | `loadFinanceApprovalList()` | Approval Center (审批中心) | 8 | Medium |
| 9 | app.js | `peRenderTable()` | Other (peRenderTable) | 8 | Medium |
| 10 | app.js | `renderFreezeLine()` | Inventory (库存管理) | 8 | Medium |
| 11 | app.js | `renderUsers()` | Users (系统管理/用户) | 6 | Medium |
| 12 | app.js | `renderOperationLogs()` | System (系统/操作日志) | 6 | Medium |
| 13 | app.js | `renderApprovalFlows()` | Approval Center (审批中心) | 5 | Medium |
| 14 | app.js | `loadApprovalFlows()` | Approval Center (审批中心) | 5 | Medium |
| 15 | app.js | `renderRoles()` | Users (系统管理/用户) | 4 | Medium |
| 16 | app.js | `loadCostWac()` | Dashboard/Finance (财务驾驶舱) | 4 | Medium |
| 17 | app.js | `onPISupplierChange()` | Suppliers (供应商) | 3 | Medium |
| 18 | app.js | `renderPayableCockpit()` | Payment (付款管理) | 3 | Medium |

## 5. 范围边界

- 本次仅扫描 html.*/modal.* 模板键 + app.js innerHTML 拼接区；纯文本键（app.*/toast.*/confirm.* 等）的文本级中文残留未纳入（需另起文本扫描）。
- 未改动任何源码；所有修复建议在 recovery-plan 中给出，待实施阶段确认。
