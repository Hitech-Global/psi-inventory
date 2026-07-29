# CI PI Available Fix Report

## 问题

新建运营CI → 选择供应商 Netac → 显示 "Netac (0 PI)" / "该供应商无可选PI"

实测数据库存在可关联PI（NHT260417A: 剩余235件, NHT260318B: 剩余4940件），
但前端过滤后全部被排除。

## 原因

**根因：前端过滤逻辑错误使用 `p.items` 迭代 PI item**

`/api/proforma-invoices` 列表端点（server.js:4644-4688）返回 PI summary 数据，
**不包含 `items` 数组**。`items` 仅在单条 PI 端点 `/api/proforma-invoices/:id`
（server.js:4700）返回。

```javascript
// 原代码（createOperationalCI, 6634-6641）
var avlPiMap={};
pis.forEach(function(p){
  var hasRemain=false;
  (p.items||[]).forEach(function(it){ if((it.unshipped_qty||0)>0) hasRemain=true; });
  // p.items === undefined → (p.items||[]) === [] → forEach 不执行 → hasRemain 恒为 false
  if(hasRemain && ...){ avlPiMap[p.id]=p; }
});
```

**连锁影响**：
1. `avlPiMap` 为空 → `window._allPis` 为空 → 所有供应商显示 "(0 PI)"
2. 供应商选择后`onCISupplierChange`中 `supPis` 为空 → 显示"该供应商无可选PI"
3. 即使手动勾选PI，`loadMultiPIItems` 也无法从 `_availPiMap` 获取 item 明细

## 修改位置

### 修改1: createOperationalCI() PI 可用性过滤（app.js:6633-6641）

**原来**：遍历不存在的 `p.items` 判断 `unshipped_qty > 0`

**修复后**：使用列表端点已返回的 PI 级汇总字段 `confirmed_qty_sum - shipped_qty_sum`，
配合精度阈值 `EPSILON=0.001` 避免浮点误差导致漏判：

```javascript
var avlPiMap={};
var EPSILON=0.001;
pis.forEach(function(p){
  var remainQty=(p.confirmed_qty_sum||0)-(p.shipped_qty_sum||0);
  if(remainQty>EPSILON && (p.need_deposit!==1||p.deposit_payment_status==='paid')){
    avlPiMap[p.id]=p;
  }
});
```

### 修改2: onCISupplierChange() PI 列表显示剩余数量（app.js:6705）

**原来**：`(p.items||[]).forEach(...)` 累加 → 恒为 0

**修复后**：`(p.confirmed_qty_sum||0)-(p.shipped_qty_sum||0)`

### 修改3: loadMultiPIItems() 获取 item 明细（app.js:6802-6804）

**原来**：`_availPiMap` 有 PI 就不用 API → 但 `_availPiMap` 无 items

**修复后**：无 items 时强制走单条 PI API 获取明细：

```javascript
var pi=window._availPiMap&&window._availPiMap[addedPiIds[i]];
if(!pi||!pi.items||pi.items.length===0){try{pi=await api('/api/proforma-invoices/'+addedPiIds[i]);}catch(e){continue;}}
```

## 修复逻辑

| 判断条件 | 修复前 | 修复后 |
|---------|--------|--------|
| 可出货量判断 | `p.items[].unshipped_qty > 0` (items 不存在) | `confirmed_qty_sum - shipped_qty_sum > 0.001` (PI 级汇总) |
| 精度处理 | 无 (`>0` 直接比较) | `EPSILON=0.001` 容差 |
| 多个PI多次出货 | 不支持（无 items 数据） | 支持（confirmed - shipped = 剩余可出货） |
| 已创建CI判断 | 不依赖此判断 | 不依赖此判断（由 shipped_qty_sum 自然反映） |
| item 明细获取 | 依赖不存在的数据 | 自动 fallback 单条 API |

## 业务规则保持

- ✅ 一个PI允许多次CI出货（通过 `confirmed_qty_sum - shipped_qty_sum` 剩余量）
- ✅ 供应商匹配
- ✅ 币种匹配  
- ✅ 定金条件（`need_deposit===1 → deposit_payment_status==='paid'`）
- ✅ 未修改 server.js / 数据库 / PAY-CORE / 库存 / WAC / 预测模块

## 验证结果

### 数据验证

| PI | confirmed | shipped | remain | deposit | 应可用? |
|----|-----------|---------|--------|---------|--------|
| NHT260518A | 390 | 390 | 0 | paid | ❌ (全部出货) |
| NHT260514A | 7540 | 7540 | 0 | partial_paid | ❌ (全部出货) |
| NHT260417A | 425 | 190 | 235 | paid | ✅ |
| NHT260318B | 4940 | 0 | 4940 | paid | ✅ |

### 语法检查

```
node --check app.js → SYNTAX OK
```

## 待人工验收

1. 浏览器打开运营CI创建 → 选择供应商 Netac
2. 确认 PI 复选框列表显示 NHT260417A (剩余235) 和 NHT260318B (剩余4940)
3. 勾选 PI → 确认明细表格正确加载 item
4. 确认同供应商同币种锁定正常
5. 正常创建 CI 并验证 PL 差异计算
