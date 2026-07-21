# Phase 3-C-3 恢复报告 — Dynamic HTML Template Recovery (A+B 组)

> 只读审计已通过（见 `dynamic-html-template-audit.md` + `dynamic-html-template-recovery-plan.json`）。
> 本阶段为**恢复实施**：仅修改 `i18n.js`，修复 A+B 组 `html.*`/`modal.*` 模板双重转义。
> 未修改 `app.js` / `server.js` / 数据库 / i18n 架构 / 任何 render 函数。未 commit/push/deploy。

---

## 1. 修改范围与纪律

| 项 | 值 |
| --- | --- |
| 修改文件 | `i18n.js`（唯一） |
| 修改键值 | 84 个键 × en+id = **168 个模板实例**（A 组 76 键 + B 组 8 键） |
| 根因 | i18n 转换阶段引入：en/id 模板值含字面 `\\\"`（3 反斜杠+引号）= 运行时 `\"`（双重转义），导致浏览器无法解析 `class="data-table"` 等属性 → 表格/表单/筛选区不渲染 |
| 修改方法 | 源级转换 `\\\"` → `\"`（3 反斜杠+引号 → 1 反斜杠+引号），解除双重转义 |
| 替换实例 | **4588 处** broken 序列（全部在 168 个赋值内） |
| 占位符/译文 | **未改动**：B 组 8 键的 en/id 占位符文本经核验已是正确译文（如 `renderSKUs` en=`"SKU/Product Name/Model/EAN"`、id=`"SKU/Nama Produk/Model/EAN"`），仅解除转义即与 zh 基线结构一致；无需补文本 |
| 备份 | `/tmp/psi-e2e/i18n.js.pre-p3c3.bak`（修改前完整备份，可一键回滚） |

**禁止项确认（全部遵守）**：未改 app.js；未改 server.js；未改 DB；未重设计 i18n 架构；未重构 render 函数；未引入新译文。

---

## 2. 修改后结构对比复核（7 维度）

脚本：`/tmp/psi-e2e/p3c3-verify.js`（以 app.js 的 zh/fallback 中文模板为唯一结构基准，对 84 键en/id 逐实例比较）

| 维度 | 方法 | 结果 |
| --- | --- | --- |
| HTML 标签层级 | 标签序列签名 | ✅ 一致 |
| id | `id="..."` 提取 | ✅ 一致 |
| class | `class="..."` 提取 | ✅ 一致 |
| onclick | `onclick="..."` 提取 | ✅ 一致 |
| data-* 属性 | `data-*` 提取 | ✅ 一致 |
| placeholder | `placeholder="..."` 提取 | ✅ 一致（含已译占位符） |
| 变量占位符 {v1…} | `{vN}` 提取 | ✅ 一致 |

**结果：168/168 实例 PASS，残留双重转义 = 0。**

---

## 3. 隔离浏览器 E2E（zh/en/id 三语言）

- 环境：端口 **3002** + 副本 DB `/tmp/psi-e2e/inventory.db` + `user_admin` session；生产库零写入。
- 脚本：`/tmp/psi-e2e/p3c3-e2e.js` + `/tmp/psi-e2e/p3c3-modal-e2e.js`。
- 覆盖页面：`dashboard` / `skus` / `replenishment` / `payment` / `inventory` / `check` / `approval-center` / `suppliers` / `users` / `po` / `pi` / `ci`（每个 zh/en/id）。
- 额外模态测试：`modal.body.createWarehousePay`（原 96 处转义，最大模板）实际打开验证。

### 3.1 主页面结果（zh/en/id 数据行一致）

| 页面 | zh | en | id | 残留转义 | t() 泄漏 | JS error |
| --- | --- | --- | --- | --- | --- | --- |
| dashboard | ok(3 cards) | ok | ok | 0/0/0 | 0 | 无 |
| skus | 420 | 420 | 420 | 0 | 0 | 无 |
| replenishment | 376 | 376 | 376 | 0 | 0 | 无 |
| payment | 49 | 49 | 49 | 0 | 0 | 无 |
| inventory | 401 | 401 | 401 | 0 | 0 | 无 |
| suppliers | 20 | 20 | 20 | 0 | 0 | 无 |
| users | 2 | 2 | 2 | 0 | 0 | 无 |
| po | 27 | 27 | 27 | 0 | 0 | 无 |
| pi | 44 | 44 | 44 | 0 | 0 | 无 |
| ci | 48 | 48 | 48 | 0 | 0 | 无 |
| **汇总** | | | | **0（全页面）** | **0（全页面）** | **0** |

### 3.2 模态实测（createWarehousePay）

| 语言 | 模态打开 | 残留转义 | form-card | 关键控件(war-sub/payee/amt/cur/lic) | select/input 数 | JS error |
| --- | --- | --- | --- | --- | --- | --- |
| zh | ✅ | 0 | ✅ | 全 ✅ | 5/5 | 无 |
| en | ✅ | 0 | ✅ | 全 ✅ | 5/5 | 无 |
| id | ✅ | 0 | ✅ | 全 ✅ | 5/5 | 无 |

### 3.3 单条判定说明

- `check` 页面 E2E 断言 `rows>0` 为 **False Negative（误报）**：`renderCheck` 默认渲染筛选栏 + 空 `table-section`，数据表仅在点击「搜索」(loadChk) 后出现；该页 `broken=false / leak=0 / 内容已渲染（len≈780）`，属正确默认行为，**非回归**。已核验 `html.renderCheck` 已在修复集合内。

---

## 4. 源级变更范围确认

- 备份 vs 当前 `i18n.js` 比对：字符数差 **−9176**（= 4588 × 2，每处 `\\\"`→`\"` 移 2 字符），broken 三重转义序列 **4588 → 0**。
- 确认：**整个 i18n.js 已无任何 `\\\"` 残留**（`/tmp/psi-e2e/p3c3-check-fixed2.js` 全量扫描 = 0）。
- 无任何其他字符变更（无逻辑/译文/结构改动）。

---

## 5. 范围外（本次未处理，按审计 plan 留待后续）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| C 组 2 键（`html.renderInventory`/`html.renderPayment`） | 未改 | 转义本正确、页面可渲染；仅 en/id 占位符值与 zh 不一致（Medium/P1），不在 A+B 修复范围 |
| app.js 18 个内联 `innerHTML` 中文函数 | 未改 | 与语言无关的中文残留（renderStagnant/loadFinanceApprovalList 等），需单独用 `t()` 包裹，不在 en/id 转义修复范围 |
| `html.renderUsers` | 未改 | i18n 无 zh 基线，结构不可验证（WARN） |

---

## 6. 结论

A+B 组 84 键（168 实例）的双重转义已**全部修复**，结构与 zh 基线 100% 一致，隔离浏览器 E2E 在 zh/en/id 三语言下**零 JS error、零残留转义、零 t() 泄漏、数据行数完全一致**。修改严格限于 `i18n.js` 转义还原，未触碰任何业务逻辑/数据库/架构。

**下一步（待你确认）**：可 commit/push/deploy；或继续处理范围外项（C 组占位符、18 内联中文、renderUsers 基线）。
