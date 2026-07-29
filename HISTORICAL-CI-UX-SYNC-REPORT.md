# Historical CI UX Sync Report

## 概述

将历史 CI 创建页面与运营 CI 统一交互模式，恢复以人为本的用户路径设计。

## 问题清单与修复

### 1. 供应商 — 手工快照 → 下拉选择+自动填充

**旧版**：`<select>` 第一项为 "手工填写快照"，选中后仅填充 supplier_name 到文本框。

**新版**：
- 供应商下拉 → 选择后自动填充：
  - 供应商快照（supplier_name，只读）
  - 品牌（自动从 `associated_brands` 填充，多品牌逗号分隔）
  - 币种（自动从 `default_currency` 填充）
  - PI 可选列表（按 supplier_id 过滤）
  - 付款条件（按供应商过滤）

### 2. 付款条件 — 统一供应商优先规则

**旧版**：纯文本 `<input id="hci-terms">` 自由填写。

**新版**：`<select>` 下拉，与运营 CI 一致：
- `onHistoricalPaymentTermsFilter(supId)` — 复用 `onCIPaymentTermsFilter` 逻辑
- 供应商付款条件 > 全局付款条件
- 选择供应商后即时过滤

### 3. 历史 CI 字段 — CI 日期 vs 实际出货日期

**保留**：
- `id="hci-date"` — CI 日期
- `id="hci-ship-date"` — 实际出货日期

**增强**：实际出货日期增加提示 "用于信用账期计算，与 CI 日期不同"

### 4. PI 关联 — 可选模式

新增 PI 关联切换：

```
○ 有关联 PI       ○ 无 PI 数据（手工录入）
```

**linked 模式**：
- 显示 PI dropdown（与运营 CI 同风格）
- checkbox 选择 + 两行布局（PI编号 / 剩余可出货：XXX 币种）
- 选择后自动关闭下拉，trigger 文字更新
- `saveHistoricalCI` 将 `related_pi_ids` + `related_pi_nos` 数组写入请求体

**manual 模式**：
- 隐藏 PI 区域
- 不发送 PI 数据
- 不强制要求 PI

### 5. UI 统一 — 与运营 CI 一致

布局结构对齐运营 CI：

| Row | 内容 |
|-----|------|
| 1 | CI 编号 + 供应商 |
| 2 | PI 关联 toggle + PI dropdown |
| 3 | 供应商快照（自动） + 品牌（自动） |
| 4 | 采购国家 + 币种（自动） |
| 5 | CI 日期 + 实际出货日期 |
| 6 | 货款总金额 + 导入前已付款 |
| 7 | 已付款日期 + 付款条件（过滤） |
| 8 | 到期日 + 凭证/备注 |

## 修改文件

### `app.js`
- **`createHistoricalCI()`** — 完全重写 UI 模板（~100 行），与 `createOperationalCI` 布局对齐
- **`onHistoricalSupplierChange()`** — 完全重写：自动填充品牌/币种、过滤 PI、过滤付款条件（~70 行）
- **新增函数（6 个）**：
  | 函数 | 用途 |
  |------|------|
  | `onHistoricalPIModeChange()` | 切换 linked/manual 模式，显示/隐藏 PI 区域 |
  | `toggleHciPiDropdown()` | 展开/收起 PI 下拉 |
  | `closeHciPiDropdown()` | 关闭 PI 下拉 |
  | `updateHciPiTriggerText()` | 更新 trigger 显示文字 |
  | `onHciPISelectionChange()` | PI 勾选后自动关闭，同步币种 |
  | `onHistoricalPaymentTermsFilter(supId)` | 供应商付款条件过滤 |
- **`saveHistoricalCI()`** — 新增 selected PI IDs/Nos 收集 + 写入请求体

### `i18n.js`
新增 18 个 i18n key（en/id）：

| Key | en | id |
|-----|----|----|
| `hci.pi_assoc` | PI Association | Asosiasi PI |
| `hci.pi_linked` | Linked PI | PI Terkait |
| `hci.pi_manual` | No PI Data (Manual) | Tidak Ada Data PI (Manual) |
| `hci.pi_selected` | PIs Selected | PI Dipilih |
| `hci.supplier_snapshot_hint` | Auto-filled after supplier selection | Terisi otomatis setelah pemilihan pemasok |
| `hci.brand_hint` | Auto-filled after supplier selection | Terisi otomatis setelah pemilihan pemasok |
| `hci.ship_date_hint` | Used for credit term calculation... | Digunakan untuk perhitungan... |
| `hci.paid_date_hint` | Leave empty if unknown... | Kosongkan jika tidak diketahui... |
| `hci.note_hint` | Optional | Opsional |
| `field.historical_ci_no` | Historical CI No. | No. CI Historis |
| `field.supplier_snapshot` | Supplier Snapshot | Snapshot Pemasok |
| `field.gross_amount` | Total Goods Amount | Total Nilai Barang |
| `field.historical_paid` | Historical Paid Before Import | Historis Dibayar Sebelum Impor |
| `field.paid_date` | Historical Paid Date | Tanggal Pembayaran Historis |
| `field.source_note` | Source Document / Notes | Dokumen Sumber / Catatan |
| `field.ci_date` | CI Date | Tanggal CI |
| `field.actual_ship_date` | Actual Ship Date | Tanggal Pengiriman Aktual |
| `field.due_date` | Due Date | Tanggal Jatuh Tempo |
| `field.payment_terms` | Payment Terms | Ketentuan Pembayaran |

## 未改动

- `server.js` — 0 行改动
- 数据库 — 未触碰
- PAY-CORE / WAC / 库存 / 预测 — 未触碰
- 历史 CI 附件 / 查看 / 实际出货日期编辑 — 保留不动

## 验证

- `node --check app.js` ✅
- `node --check i18n.js` ✅
- 所有 9 个新增/修改函数存在且签名一致 ✅
- 无 stale DOM ID 引用 ✅

## 人工验收清单

| 步骤 | 预期 |
|------|------|
| 新建 CI → 历史 CI | 新 UI 打开，布局与运营 CI 对齐 |
| 选择供应商 Netac | 自动填充：供应商快照 "Netac" + 品牌 + 币种 RMB |
| 付款条件 | 仅显示 Netac 的供应商付款条件 |
| 切换 "有关联 PI" | 展开 PI dropdown，显示 NHT260417A(235) + NHT260318B(4940) |
| 勾选 PI | dropdown 自动关闭，trigger 文字更新 |
| 切换 "无 PI 数据" | PI dropdown 隐藏 |
| 填写金额后保存 | 请求成功（含或不含 PI 数据） |
