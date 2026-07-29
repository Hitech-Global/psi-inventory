# HISTORICAL-CI-MULTI-PI-FIX-REPORT

**Date**: 2026-07-29  
**Commit**: (pending)  
**Scope**: app.js / i18n.js only  
**Untouched**: server.js, DB, PAY-CORE, WAC, inventory, forecast

---

## 问题分析

Historical CI 创建页的 PI 选择逻辑与运营 CI 不一致：

| 问题 | 旧状态 | 根因 |
|------|--------|------|
| PI 选择 | checkbox 已多选，但 auto-fill 只取第一个 | `onHciPISelectionChange` 只用 `cbs[0]` |
| 国家 | 始终为空 | 无 country auto-fill 逻辑 |
| 品牌 | 仅 supplier select 触发 | PI 选择后不覆盖 |
| 明细聚合 | 不存在 | 缺少 `aggregateHciPIItems` |
| 用户感知 | 看起来像单选 | 因无明细展示+auto-fill 只用第一项 |

---

## 4 项修复

### Fix 1: `createHistoricalCI()` — 存储 countries 映射

```
window._hciCountries = {};
countries.forEach(function(c){ window._hciCountries[c.name] = c.code; });
```

用途：PI 的 `country` 字段存储名称（如 "印度尼西亚"），需要反向查找 code（如 "ID"）来设置 `<select>`。

### Fix 2: `createHistoricalCI()` — 新增明细表格占位

```html
<div id="hci-items-preview" style="margin-bottom:12px;display:none"></div>
```

位于 PI dropdown 和 Supplier snapshot 之间，PI 选择后由 `aggregateHciPIItems` 渲染。

### Fix 3: `onHciPISelectionChange()` — 完全重写为 async

```javascript
async function onHciPISelectionChange(){
  // 1. 收集所有选中 PI → window._hciSelectedPiIds[]
  // 2. 无选中 → 隐藏预览 → 清空 → return
  // 3. 从 _hciAllPis 取第一个有效 PI 的完整数据
  // 4. 自动填充：country（name→code 反向查找）、brand、currency、supplier_name
  // 5. 调用 aggregateHciPIItems(piIds)
}
```

**关键改进**：
- `country`：`_hciCountries[firstPi.country]` → country code，设置 `#hci-country` select
- `brand`：`firstPi.brand` → `#hci-brand` input
- `currency`：`firstPi.currency` → `#hci-currency` select
- `supplier_name`：`firstPi.supplier_name` → `#hci-supplier-name` input

### Fix 4: `aggregateHciPIItems(piIds)` — 新函数

```
fetch 每条 PI 的 items（单条端点）
  → 聚合：按 SKU 合并（sum qty, avg unit price）
  → 渲染 6 列表格：
    SKU | PI来源 | PI数量 | 剩余可出货 | 参考单价
  → 底部合计行：参考总金额
  → 提示文字：以上为参考信息
```

## 修改文件

### app.js
- **createHistoricalCI**: +2 行（countries 映射 + 表格占位 div）
- **onHciPISelectionChange**: 完全重写（15→45 行）
- **aggregateHciPIItems**: 新函数（~60 行）

### i18n.js
新增 3 key：

| key | zh（默认） | en | id |
|-----|-----------|----|-----|
| `hci.items_hint` | 以上为参考信息，请在下方填写实际历史货款金额 | Above is for reference... | Di atas untuk referensi... |
| `ci.items_from_pi` | 从PI带出的出货明细 | Items from PI | Item dari PI |
| `ci.summary.est_total` | 参考总金额 | Est. Total | Perkiraan Total |

---

## 验证

| 检查项 | 状态 |
|--------|------|
| `_hciCountries` 存储 | ✓ |
| `hci-items-preview` 占位 | ✓ |
| `async onHciPISelectionChange` | ✓ |
| `aggregateHciPIItems` 函数 | ✓ |
| country auto-fill（name→code） | ✓ |
| brand auto-fill | ✓ |
| currency auto-fill | ✓ |
| supplier snapshot auto-fill | ✓ |
| syntax check (app.js + i18n.js) | ✓ |
| 无 server.js/DB/PAY-CORE 修改 | ✓ |

---

## 人工验收要点

| 步骤 | 预期结果 |
|------|---------|
| 新建 CI → 历史 CI | 页面正常打开 |
| 选择供应商 Netac | 自动填充快照/品牌/币种 |
| 展开 PI dropdown | NHT260417A(235) + NHT260318B(4940) |
| 勾选 NHT260417A | 国家→印度尼西亚(ID)、品牌→Netac、明细表格出现 |
| 再勾选 NHT260318B | trigger→"2 PI已选择"，明细表格聚合两PI SKU |
| 取消全部勾选 | 明细隐藏，auto-fill 字段保留 |
| 切换 "无 PI 数据" | PI 选择区域隐藏 |
| 填写金额保存 | 正常提交 |
