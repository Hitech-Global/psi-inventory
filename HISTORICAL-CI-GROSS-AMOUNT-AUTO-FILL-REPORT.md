# HISTORICAL-CI-GROSS-AMOUNT-AUTO-FILL-REPORT

日期：2026-07-29
范围：历史 CI 导入页面（`createHistoricalCI` 相关前端逻辑）
目标：linked 模式由 CI 明细自动汇总 `gross_goods_amount` 并锁定币种；manual 模式保留手工录入。

---

## 一、修改文件

| 文件 | 改动 | 是否触碰付款核心 |
|------|------|------------------|
| `app.js` | 仅历史 CI 导入页面逻辑（5 处 + 1 处边界） | 否 |

**未修改**：`server.js` / DB schema / `payment_request` 生成逻辑 / 运营 CI / CI 列表 / CI 详情 / WAC / 库存 / 订单预测。
**保留字段**：`historical_commercial_invoices.gross_goods_amount` 原样保留，仍作为 `payment_request.payable_amount` 来源。

---

## 二、修改内容（app.js）

### 1. Row 6 容器加 id + 提示框（~6550）
- “历史货款总金额”外层 `form-group` 增加 `id="hci-gross-group"`
- 新增提示框 `id="hci-gross-hint"`（用于显示自动汇总说明）

### 2. `onHistoricalPIModeChange()`（~6643）— 模式切换
- **linked**：`hci-gross-group` 隐藏；`hci-currency` 锁定（`disabled=true` + 灰底）；提示写“由 CI 明细金额自动汇总”
- **manual**：`hci-gross-group` 显示；`hci-currency` 解锁；清空 `hci-gross` 值，强制用户手工填写

### 3. `aggregateHciPIItems()`（~6785）— 选 PI 后币种同步
- linked 模式下，选 PI 后读取明细首行币种（多 PI 同币种，符合 R4），写入并锁定 `hci-currency`

### 4. 新增 `getHciItemTotal()` + 改写 `updateHciCISummary()`（~6789）
- `getHciItemTotal()`：`∑(本次CI数量 × 单价)`（按当前输入实时计算）
- `updateHciCISummary()`：linked 模式把合计回填到隐藏的 `hci-gross`（`gi.value=totalAmt`），作为 `gross_goods_amount`

### 5. `saveHistoricalCI()`（~6861 / 6872）— 保存分叉
- `isLinked` 为真 → `gross=getHciItemTotal()`；否则 `gross=parseFloat(hci-gross.value)`
- 校验文案按模式区分：linked 提示“请选择关联 PI 并填写 CI 明细数量与单价…”，manual 提示“历史货款总金额必须大于0”

### 6. `createHistoricalCI()` 末尾（~6569）— 默认状态应用
- `openModal` 后调用 `onHistoricalPIModeChange()`，使默认 linked 状态（隐藏金额框 + 锁定币种）开局即生效

---

## 三、linked 模式验证（逻辑自测）

| 步骤 | 预期 | 结论 |
|------|------|------|
| 打开历史 CI 导入页（默认 linked） | 金额输入框隐藏、币种下拉灰显锁定 | ✅ |
| 选择供应商 → 选择 PI | 明细表出现，默认 `本次CI数量=未出货`、`单价=PI单价` | ✅ |
| 选 PI 后 | 币种自动带出 PI 币种并锁定；汇总条显示“CI金额” | ✅ |
| 修改某行数量/单价 | 汇总条“CI金额”与 `hci-gross` 实时更新 | ✅ |
| 不填明细直接保存 | `gross=0` → 报错“请选择关联 PI 并填写…” | ✅ |
| 填好明细保存 | `gross_goods_amount=明细合计`，`payment_request.payable_amount` 同源，付款链不变 | ✅ |
| 删除某行 / 全删 | 汇总与 `hci-gross` 归零，保存被拦截 | ✅ |

## 四、manual 模式验证（逻辑自测）

| 步骤 | 预期 | 结论 |
|------|------|------|
| 切换到“无 PI 数据（手工录入）” | 金额输入框出现、币种下拉可编辑、`hci-gross` 清空 | ✅ |
| 手工填金额 + 选币种 | 行为与改前一致 | ✅ |
| 保存 | `gross=手工输入`，`>0` 校验生效，`paid ≤ gross` 校验生效 | ✅ |

## 五、币种验证（逻辑自测）

| 场景 | 预期 | 结论 |
|------|------|------|
| linked 选 PI（PI 币种 USD） | `hci-currency` → USD 且 `disabled`，用户不可改 | ✅ |
| linked 切换 manual 再切回 | 切回 linked 选 PI 后币种重新按 PI 锁定 | ✅ |
| manual 自选币种（如 EUR） | 可编辑，保存以 EUR 落库 | ✅ |
| 明细合计币种 vs 表单币种 | linked 下两者强制一致（均来自 PI），消除币种错配风险 | ✅ |

---

## 六、隔离合规确认

- ✅ 仅改 `app.js`（历史 CI 导入页面）
- ✅ 未改 `server.js` / DB / `payment_request` 逻辑
- ✅ `gross_goods_amount` 字段保留
- ✅ 未影响运营 CI / CI 列表 / CI 详情 / PAY-CORE / WAC / 库存 / 预测
- ✅ `node --check app.js` 通过

## 七、后续可选项（非本次范围）

- 将两个新文案 `hci.gross_auto_hint` / `hci.gross_auto_required` 接入 `i18n.js` 做 en/id 翻译（当前为前端内联中文兜底，与既有 `gen.L5793.*` 写法一致）。
