# CI 创建页面 UI 优化报告

**日期**: 2026-07-29  
**Commit**: (待填入)

---

## 背景

CI 创建页面功能正确，但 UI 不符合之前确认的用户路径设计。4 项优化，不改业务逻辑。

---

## 修改明细

### 1. PI Dropdown 项布局优化

**现状**: checkbox 与 PI 编号分离，剩余数量挤在右侧单行。

**修复**: 每个 PI 改为两行卡片布局：
```
☑ NHT260318B
  剩余可出货：4940 RMB
```
- 第一行: checkbox + PI 编号（white-space: nowrap 防止换行）
- 第二行: "剩余可出货：XXX 币种"（24px 左缩进对齐 checkbox）
- 移除币种分组标题（`RMB (2 PI)` 等 header）
- 移除交替背景色，改为 hover 高亮 (`#f5f5f5`)

**影响文件**: `app.js` — `onCISupplierChange()` 内 PI 渲染块（~15 行替换）

### 2. 供应商下拉移除 PI 计数

**现状**: `Netac (2 PI)` / `Netac (0 PI)`

**修复**: 仅显示供应商名称 `Netac`，PI 数量只在选择框中显示（trigger text 已显示 "2 PI已选择"）。

**影响文件**: `app.js` line 6652 移除 `(count>0?' ('+count+' PI)':' (0 PI)')`

### 3. Dropdown 选择完成后自动关闭

**现状**: 勾选 PI 后 dropdown 保持展开。

**修复**: `onCIPISelectionChange()` 末尾调用 `closeNciPiDropdown()`。

**影响文件**: `app.js` line 6775

### 4. CI 明细删除按钮弱化

**现状**: 红色 `✕` `color:#ff4d4f` `font-size:16px`

**修复**: 灰色 `×` `color:#bbb` `font-size:13px` `padding:2px 4px`（不显眼的操作按钮）

**影响文件**: `app.js` line 6867 — `buildCIItemRow()`

### i18n 补充

新增 key `ci.pi.remain`：
- zh: "剩余可出货："
- en: "Remaining shippable: "
- id: "Sisa dapat dikirim: "

**影响文件**: `i18n.js` line 1681

---

## 验证清单

| # | 验证项 | 预期 | 状态 |
|---|--------|------|------|
| 1 | 供应商下拉 | 仅显示 "Netac"，无 PI 计数 | ✅ |
| 2 | PI dropdown 展开 | 每个 PI 两行：checkbox+编号 / 剩余数量+币种 | ✅ |
| 3 | PI dropdown hover | 背景变浅灰 | ✅ |
| 4 | PI 编号 | 不换行 | ✅ |
| 5 | 勾选 PI 后 | dropdown 自动关闭 | ✅ |
| 6 | 删除按钮 | 浅灰色 ×，不突出 | ✅ |
| 7 | 语法检查 | app.js + i18n.js 均通过 | ✅ |

---

## 不变项（确认）

- 多 PI 选择逻辑
- SKU 删除功能
- CI 数量 ≤ 剩余未出货数量
- 一个 PI 多次 CI 出货
- 付款条件过滤
- server.js / DB / PAY-CORE / WAC / 预测模块
