# CI-CREATE-UI-FIX-REPORT

## 修改概览

| 项目 | 文件 | 变更量 |
|------|------|--------|
| Fix 1: PI多选体验 | app.js | -2 lines |
| Fix 2: 明细表优化 | app.js, i18n.js, index.html | +1 key, +2 CSS rules |
| Fix 3: Modal布局 | app.js, index.html | +12 lines JS, +8 lines CSS |

提交：`2266266dc7fb880d195830a1bfa7466c19e9a148`

---

## Fix 1 — PI选择改为真正多选体验

### 问题
选择PI后下拉列表自动关闭��需重新打开才能继续勾选其他PI。

### 修改
- `onCIPISelectionChange()`（运营CI）：移除末尾的 `closeNciPiDropdown()`
- `onHciPISelectionChange()`（历史CI）：移除末尾的 `closeHciPiDropdown()`

### 效果
- 展开PI下拉后保持打开状态
- checkbox连续勾选多个PI
- 已选PI保持☑勾选
- 点击区域外或再次点击触发器关闭
- 运营CI和历史CI行为一致

### 验证
```
✓ closeNciPiDropdown removed from onCIPISelectionChange
✓ closeHciPiDropdown removed from onHciPISelectionChange
```
点击PI checkbox → onChange触发 → 三角函数不调用close → 下拉保持打开 → 继续选择。

---

## Fix 2 — CI明细数据展示调整

### 明细字段（9列）
| 列 | 说明 | 数据源 |
|----|------|--------|
| SKU | SKU编码 | item.sku_code |
| PI来源 | PI编号 | item.pi_no |
| PI总数量 | 原PI确认数量 | item.pi_confirmed_qty |
| 已出货 | 历史CI已出货量 | item.shipped_qty |
| 未出货 | 剩余可出货量 | item.unshipped_qty |
| 本次CI数量 | 默认=未出货数量，可编辑 | input value=unshipped_qty |
| 单价 | PI单价，可编辑 | item.unit_price |
| 金额 | 数量×单价，实时计算 | computed |
| 操作 | 删除按钮 | × |

### 修改
1. **i18n.js**：新增 `app.operation` 键（zh=操作/en=Action/id=Aksi）
2. **index.html CSS**：
   - `#ci-items-preview { max-height: min(350px, 38vh); overflow-y: auto }`
   - `#hci-items-preview { max-height: min(300px, 38vh); overflow-y: auto }`

### 已有功能验证
- 默认CI数量 = 未出货数量 ✓（`buildCIItemRow` value=uQty）
- 删除SKU后重算数量和金额 ✓（`deleteCIRow` 调用 `updateCISummary`）
- qty/price变更实时更新金额 ✓（onchange/oninput → updateCISummary）
- 9列 `<td>` 完整 ✓

---

## Fix 3 — CI创建Modal布局优化

### 问题
Modal全屏覆盖，遮挡顶部导航栏和左侧菜单栏。

### 修改

#### index.html CSS（新增 8 条规则）
```css
/* CI modal positioned within workspace */
.modal-overlay.ci-mode {
  top: 48px; left: 220px; right: 0; bottom: 0;
  width: auto; height: auto;
  align-items: flex-start; justify-content: flex-start;
  padding: 12px 16px; z-index: 100;
}
.modal-overlay.ci-mode.ci-sb-collapsed { left: 54px; }

/* CI modal flex column layout */
.modal-overlay.ci-mode .modal-ci-create {
  width: 100%; max-width: none;
  max-height: calc(100vh - 48px - 24px);
  display: flex; flex-direction: column; overflow: hidden;
}
.modal-overlay.ci-mode .modal-ci-create .modal-header { flex: 0 0 auto; }
.modal-overlay.ci-mode .modal-ci-create .modal-body   { flex: 1 1 auto; overflow-y: auto; min-height: 0; }
.modal-overlay.ci-mode .modal-ci-create .modal-footer { flex: 0 0 auto; }
```

#### app.js（修改 openModal / closeModal）
```js
// openModal: 检测 modal-ci-create → 添加 ci-mode + sidebar 状态类
if(size==='modal-ci-create'){
  ov.classList.add('ci-mode');
  if(sb&&sb.classList.contains('collapsed')) ov.classList.add('ci-sb-collapsed');
}

// closeModal: 移除所有 CI 相关类
ov.classList.remove('show','ci-mode','ci-sb-collapsed');
```

### 效果
| 特性 | 说明 |
|------|------|
| 不覆盖导航栏 | top:48px 留出 topbar |
| 不覆盖侧边栏 | left:220px (展开) / 54px (折叠) |
| Header固定 | flex:0 0 auto |
| Footer固定 | flex:0 0 auto |
| Body滚动 | flex:1 1 auto + overflow-y:auto + min-height:0 |
| CI明细表内滚 | max-height + overflow-y:auto |

### 兼容性
- 其他 Modal（non-CI）不受影响：`openModal` 先 remove `ci-mode` 再根据 `size` 添加
- Sidebar 折叠/展开自动适配：`ci-sb-collapsed` 类动态切换

---

## 修改清单

### app.js
- `openModal()`: +7 lines（ci-mode 检测 + sidebar 状态类）
- `closeModal()`: 1 line changed（追加 remove ci-mode 类）
- `onCIPISelectionChange()`: -1 line（移除 closeNciPiDropdown）
- `onHciPISelectionChange()`: -1 line（移除 closeHciPiDropdown）

### index.html
- 新增 10 条 CSS 规则（ci-mode 定位 / flex 布局 / 明细表滚动）

### i18n.js
- 新增 1 行：`app.operation` (en/id)

### 未修改
- server.js
- 数据库
- PAY-CORE
- 库存预测
- WAC
- 其他模块

---

## 验证结果

运行 `/tmp/verify-ci-ui-fix.js` — **22 项全部 PASS**：

| 类别 | 检查项 | 结果 |
|------|--------|------|
| 语法 | app.js --check | ✓ |
| Fix 1 | closeNciPiDropdown 移除 | ✓ |
| Fix 1 | closeHciPiDropdown 移除 | ✓ |
| Fix 2 | buildCIItemRow 9列 | ✓ |
| Fix 2 | 默认CI数量 = 未出货 | ✓ |
| Fix 2 | deleteCIRow 重算 | ✓ |
| Fix 2 | CSS #ci-items-preview max-height | ✓ |
| Fix 2 | CSS #hci-items-preview max-height | ✓ |
| Fix 3 | openModal ci-mode | ✓ |
| Fix 3 | openModal sidebar collapsed | ✓ |
| Fix 3 | closeModal 清理 ci-mode | ✓ |
| Fix 3 | CSS .ci-mode | ✓ |
| Fix 3 | CSS .ci-sb-collapsed | ✓ |
| i18n | ci.col.* (6 keys) | ✓ |
| i18n | ci.summary.* (2 keys) | ✓ |
| i18n | app.operation | ✓ |
