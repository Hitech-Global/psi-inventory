# CI-CREATE-UI-FIX-REPORT

## 概述
修复 CI 创建页面 3 个 UI 问题，涵盖运营 CI 和历史 CI 共 9 处修改。

## 修改内容

### Fix 1: PI 选择显示 — 去掉币种，改用数量单位

**问题**：PI 下拉选项中 "剩余可出货：235 RMB" 误把 RMB 标记为数量单位。

**修复**：`"剩余可出货：235 RMB"` → `"剩余可出货：235 件"`

| 文件 | 位置 | 修改 |
|------|------|------|
| app.js | `onHistoricalSupplierChange()` ~L6627 | `esc(p.currency)` → `t('unit.pcs','件')` |
| app.js | `onCISupplierChange()` ~L7047 | 同上 |
| i18n.js | `unit.pcs` | 新增 key：`件` / `pcs` / `pcs` |

### Fix 2: CI 明细列扩展 — 增加 PI 出货状态信息

**问题**：旧 7 列表头仅含 SKU/PI来源/PI数量/CI数量/单价/金额/操作，无法判断 PI 已出货/未出货。

**修复**：扩展为 9 列（8 数据列 + 1 操作列）

```
旧列： SKU | PI来源 | PI数量(unshipped) | CI数量 | 单价 | 金额 | 操作
新列： SKU | PI来源 | PI总数量 | 已出货 | 未出货 | 本次CI数量 | 单价 | 金额 | 操作
       ↑       ↑       ↑(confirmed) ↑(shipped) ↑(unshipped) ↑(editable)  ↑      ↑      ↑
```

| 文件 | 位置 | 修改 |
|------|------|------|
| app.js | `loadMultiPIItems()` ~L7147 | item 结构增加 `pi_confirmed_qty` / `shipped_qty` / `currency` |
| app.js | 表头渲染 ~L7166 | 表头从 6 列扩展为 8 列，新增 `ci.col.pi_confirmed` / `ci.col.pi_shipped` / `ci.col.pi_unshipped`，`ci.col.ci_qty` 文案改为 "本次CI数量" |
| app.js | `buildCIItemRow()` ~L7199 | 行渲染增加 cQty / sQty / uQty 三列只读展示，CI 数量输入框宽度从 85px 缩小为 70px |
| i18n.js | 新增 3 个列 key | `ci.col.pi_confirmed` / `ci.col.pi_shipped` / `ci.col.pi_unshipped` |

### Fix 3: CI 弹窗尺寸扩大 + 合计区域优化

**问题 A**：默认 modal 宽度 700px，多 PI 选择 + 9 列表格空间不足。

**修复**：运营 CI 和历史 CI 弹窗均使用已有 CSS class `.modal-ci-create { max-width: 1200px }`

| 文件 | 位置 | 修改 |
|------|------|------|
| app.js | `createOperationalCI()` ~L7011 | `openModal(...)` 第四参数增加 `'modal-ci-create'` |
| app.js | `createHistoricalCI()` ~L6565 | 同上 |

**问题 B**：合计显示 "合计：235 件 | 29,918.00"，金额无币种、格式紧凑。

**修复**：两行 flex 布局

```
旧： 合计：235 件 | 29,918.00
新： 合计数量：235 件        CI金额：RMB 29,918.00
```

| 文件 | 位置 | 修改 |
|------|------|------|
| app.js | `updateCISummary()` ~L7223 | 两行 flex 布局，金额取 `allItems[0].currency` |
| i18n.js | `ci.summary.qty` / `ci.summary.amt` | 新增 2 个 summary key |

## 修改文件

| 文件 | 行数变化 | 说明 |
|------|---------|------|
| `app.js` | ~20 行修改 | PI 显示 / 明细列 / 弹窗尺寸 / 合计 |
| `i18n.js` | +6 key | unit.pcs / ci.col.*×3 / ci.summary.*×2 |

## 验证结果

| 验证项 | 结果 |
|--------|------|
| app.js 语法 | ✅ PASS |
| i18n.js 语法 | ✅ PASS |
| PI 下拉无币种 (`esc(p.currency)`) | ✅ 0 处残留 |
| `unit.pcs` 使用 | ✅ 3 处（2×PI 下拉 + 1×合计） |
| 新增列 key (`ci.col.pi_*`) | ✅ 表头 + i18n 均存在 |
| `modal-ci-create` 使用 | ✅ 2 处（运营 CI + 历史 CI） |
| 合计双行格式 | ✅ `ci.summary.qty` + `ci.summary.amt` |

## 人工验收要点

| 步骤 | 预期 |
|------|------|
| 运营 CI → 选择 Netac → 展开 PI 下拉 | 每项显示 "剩余可出货：XXX 件"（无 RMB） |
| 勾选 PI → 明细表 | 9 列：SKU/PI来源/PI总数量/已出货/未出货/本次CI数量/单价/金额/操作 |
| 输入 CI 数量 → 底部合计 | "合计数量：XXX 件" | "CI金额：RMB XXX" |
| 弹窗宽度 | ~1200px，充分展示 9 列 |
| 历史 CI → 选择 Netac → PI 下拉 | 同样显示 "剩余可出货：XXX 件" |
