# CI Create UX Regression Fix Report

## 问题

CI 创建页面两个交互回退：

### 回退 1：PI 选择交互

- **当前**：供应商选择后显示 checkbox 平铺列表（`#ci-pi-list` div）
- **之前验收版本**：下拉多选组件（trigger 按钮 + dropdown 面板）
- 需要恢复下拉交互，不重新设计

### 回退 2：CI 明细 SKU 删除

- **当前**：选择 PI 后自动加载全部 SKU，无删除按钮
- **之前验收版本**：用户可删除本次不出货的 SKU
- 业务规则：PI = 采购计划，CI = 实际出货。用户可以删除不出货 SKU

## 修复 1：PI 下拉多选组件

### 涉及函数

| 函数 | 修改内容 |
|------|---------|
| `createOperationalCI()` | 替换 `#ci-pi-list` checkbox 平铺区 → 自定义下拉组件（trigger + dropdown panel） |
| `onCISupplierChange()` | `getElementById('ci-pi-list')` → `getElementById('nci-pi-dropdown')`；添加 `updateNciPiTriggerText()` |
| `onCIPISelectionChange()` | 末尾添加 `updateNciPiTriggerText()` |
| `toggleNciPiDropdown()` | **新增** — toggle dropdown 显示/隐藏 |
| `closeNciPiDropdown(e)` | **新增** — 关闭 dropdown，含 trigger 排除判断 |
| `updateNciPiTriggerText()` | **新增** — 更新 trigger 文字：无选→"请选择PI"，单选→PI编号，多选→"{N} PI已选择" |

### 交互流程

```
供应商选择 → trigger 文字更新
           → dropdown panel 填充 checkbox PI列表
           → 点击 trigger 展开/收起 dropdown
           → 点击页面任意位置关闭 dropdown
           → 勾选 PI → trigger 文字实时更新
           → 勾选 PI → 加载 CI 明细表格
```

### DOM 结构

```html
<div class="form-group" style="position:relative">
  <div id="nci-pi-trigger" onclick="toggleNciPiDropdown()">
    <span id="nci-pi-trigger-text">请先选���供应商</span>
    <span>▼</span>
  </div>
  <div id="nci-pi-dropdown" style="display:none;position:absolute;...">
    <!-- PI checkbox 列表（onCISupplierChange 动态填充） -->
  </div>
</div>
```

### 文档点击监听

`createOperationalCI()` 中通过 `window._nciPiDocListener` 去重注册全局 click 监听，点击 trigger 和 dropdown 内部时���关闭。

## 修复 2：CI 明细 SKU 删除

### 涉及函数

| 函数 | 修改内容 |
|------|---------|
| `buildCIItemRow()` | 6列 → 7列，新增 "操作" 列含 ✕ 删除按钮 |
| `loadMultiPIItems()` | 表头新增 `<th>操作</th>` |
| `deleteCIRow(idx)` | **新增** — 从 `window._ciAllItems` 过滤 + DOM 移除行 + 更新汇总；全部删除后重置为空白提示 |
| `saveNewCI()` | 修复：遍历 `window._ciAllItems` 直接迭代，替代基于 `_ciR` 计数+索引访问（删除后索引移位 bug） |

### 删除逻辑

```
用户点击 ✕
  → deleteCIRow(idx)
    1. window._ciAllItems = allItems.filter(it.idx !== idx)
    2. document.getElementById('ci-r-'+idx).remove()
    3. updateCISummary() — 刷新底部合计
    4. 若全部删除 → 预览区重置为空提示、隐藏汇总
```

### saveNewCI 修复（附带修复）

**原逻辑**：`for(i=0; i<_ciR; i++) { it = allItems[i]; ... }`

删除后 `allItems` 数组收缩但 `_ciR` 不变+索引错位，导致 `allItems[2]` 取到错误 item。

**修复后**：`for(i=0; i<allItems.length; i++) { it = allItems[i]; qe = getElementById('ci-rq-'+it.idx); ... }`

直接遍历 `allItems`，用 `it.idx` 定位 DOM，删除安全。

## 业务规则保持

- ✅ PI 选择 → 自动带出该 PI 全部未出货 SKU
- ✅ 用户可删除不出货 SKU（PI 仍保持选中）
- ✅ CI 数量 ≤ PI 剩余未出货数量（input max 属性 + 后端 P2-6 守卫）
- ✅ 一个 PI 可多次 CI 出货
- ✅ 同供应商+同币种锁定
- ✅ 未修改 server.js / 数据库 / PAY-CORE

## 验证

- `node --check app.js` → SYNTAX OK
- 函数签名完整：toggleNciPiDropdown / closeNciPiDropdown / updateNciPiTriggerText / deleteCIRow
- 所有 DOM ID 引用一致（nci-pi-trigger / nci-pi-trigger-text / nci-pi-dropdown / ci-r-{idx}）
- i18n key：ci.041 / ci.042 / common.delete / app.operation 均有 en/id 翻译

## 待人工验收

1. 选择供应商 Netac → trigger 文字更新，dropdown 可展开
2. 勾选 NHT260417A → trigger 显示 "NHT260417A"，CI 明细表格加载
3. 勾选 NHT260318B → trigger 显示 "2 PI已选择"，明细追加
4. 展开 dropdown → 同币种 RMB 锁定，不同币种 PI disabled
5. 点击 CI 明细表格某行 ✕ 按钮 → 该行消失，底部合计更新
6. 删除所有行 → 预览区显示空白提示，汇总隐藏
7. 正常提交创建 CI → 验证 PL 差异计算正确
