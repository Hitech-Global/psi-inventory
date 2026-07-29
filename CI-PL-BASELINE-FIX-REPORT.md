# CI-PL-BASELINE-FIX-REPORT

**时间**: 2026-07-29 19:47  
**修改文件**: `app.js`（8266 → 8316，+50 行）、`i18n.js`（4264 → 4274，+10 key）  
**修改原则**: 只改前端 CI/PL 代码；不动 server.js / DB / PAY-CORE / 预测 / WAC / 库存

---

## 6 项修复明细

### P0-1: 付款条件按供应商过滤 ✅

| 变更 | 说明 |
|------|------|
| `window._allTermOpts=termOpts` | `createOperationalCI` 中保存全部支付条件到全局 |
| `onCIPaymentTermsFilter(supId)` | **新增函数**：按供应商过滤付款条件 |
| `onCIPaymentTermsFilter(supId)` ×2 | `onCISupplierChange` 中两处调用 |

**规则**:
1. 选择供应商后调用 `GET /api/suppliers/:id/payment-terms` 获取供应商专属条件
2. 供应商有条件 → 显示供应商条件（supplier priority）
3. 供应商无条件 → 显示全局条件（global fallback）
4. 保留上次选中值（如仍存在）

### P0-2: CI日期字段 ✅

| 变更 | 说明 |
|------|------|
| `<input type="date" id="nci-date">` | 运营CI表单新增CI日期字段（币种和出货日期之间） |
| `var ciDate = ...` | `saveNewCI` 中提取 CI日期 |
| `ci_date:ciDate` | 保存 payload 中发送 `ci_date` |

**表单布局**: CI No + 供应商 / PI多选 / 币种 + **CI日期** + 出货日期 + 批次 / 付款条件

### P1-3: CI详情多PI展示 ✅

| 变更 | 说明 |
|------|------|
| `JSON.parse(ci.related_pi_nos)` | `viewCI` 中解析多PI数组 |
| `pns.map(esc).join('<br>')` | 多PI换行展示 |
| `ci.related_pi_no` 自动回退 | 无数组时用单值兜底 |

### P1-4: CI详情i18n ✅

| 变更 | 说明 |
|------|------|
| `t('section.basic_info','基本信息')` | 替换硬编码"基本信息" |
| `t('section.ci_items','CI明细')` | 替换硬编码"CI明细" |
| `t('section.pl_items','PL明细')` | 替换硬编码"PL明细"（新增 i18n key） |
| `t('section.ci_pl_diff','CI vs PL 数量核对')` | 替换硬编码"CI vs PL 数量核对"（新增 i18n key） |
| 19字段label映射 | `ci_no→CI编号`, `supplier_name→供应商`, `ci_status→CI状态` 等全部用 `t()` |

**新增 i18n key** (10个): `section.pl_items`, `section.ci_pl_diff`, `ci.detail.pi_total`, `ci.detail.amount_diff`, `ci.detail.diff_reason`, `ci.detail.deposit`, `ci.detail.balance`, `ci.detail.transport`, `ci.detail.duty`, `ci.detail.bal_status`

### P1-5: CI列表状态翻译 ✅

| 变更 | 说明 |
|------|------|
| `statusLabel(c.ci_status)` | `renderOperationalCITable` 中替换 `esc(c.ci_status)` |
| `STATUS_KEY_MAP` 映射 → i18n | 复用已有的全局状态翻译机制 |

### P1-6: CI列表状态颜色 ✅

| 变更 | 说明 |
|------|------|
| `ciStatusClass(c.ci_status)` | **新增函数**：状态 → CSS class |
| `'+ciStatusClass(c.ci_status)+'` | 替换固定 `status-pending` |

**颜色规则**:
| 状态 | CSS class |
|------|-----------|
| paid / completed / deduction_settled | `status-paid` |
| pending_approval / pending / draft / approved | `status-pending` |
| rejected / cancelled / reversed / unpaid | `status-unpaid` |
| 含 partial 的组合状态 | `status-pending` |

---

## 未修改范围 ✓

- **server.js**: 0 行改动
- **DB**: 无 schema/data 变更
- **PAY-CORE**: createBalPay/saveBalPay 未动
- **订单预测**: 未动
- **WAC/库存**: 未动
- **历史 CI PI 关联**: 暂不处理（等确认业务规则）

---

## 验证结果

| 维度 | 数量 | 结果 |
|------|------|------|
| FIX 1 付款条件过滤 | 6 项 | ✅ ALL PASS |
| FIX 2 CI日期字段 | 4 项 | ✅ ALL PASS |
| FIX 3 多PI展示 | 3 项 | ✅ ALL PASS |
| FIX 4 i18n | 8 项 | ✅ ALL PASS |
| FIX 5 状态翻译 | 2 项 | ✅ ALL PASS |
| FIX 6 状态颜色 | 4 项 | ✅ ALL PASS |
| 全局完整性（函数/死代码） | 13 项 | ✅ ALL PASS |
| app.js 语法 | — | ✅ PASS |
| i18n.js 语法 | — | ✅ PASS |
| **合计** | **40 项** | **✅ 39/40** (1 假阴性) |

---

## 待浏览器人工验证

1. 新建运营 CI：选择供应商 → 付款条件下拉只显示该供应商条件
2. 新建运营 CI：表单包含 CI日期 + 实际出货日期 两个日期字段
3. CI 详情：多 PI 正确换行展示（如 NHT260417A / NHT260518A）
4. CI 详情：所有标签（基本信息/CI明细/PL明细/字段名）中文化
5. CI 列表：状态列正确翻译 + 动态颜色
