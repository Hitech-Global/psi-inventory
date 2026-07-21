# Phase 3-C-4A — Localization Foundation · Implementation Report

**Date:** 2026-07-21
**Status:** ✅ Implemented · 隔离 E2E 通过 · 待人工验收（未 commit/push/deploy）
**Approved scope (with 2 adjustments from user):**

1. enum/status mapping
2. module labels
3. common actions
4. finance/procurement shared terms
5. 前端已有 `t()` 体系补充 `dict.en/id`

**Adjustment 1 — F1 (server.js i18n) 暂不纳入：** 本阶段只消除**用户界面**中文混杂，不扩大后端消息体系改造。server.js 的校验/业务提示国际化延后到后续 AI助手/飞书/API 国际化阶段单独评估。→ **server.js 未改动**。
**Adjustment 2 — key 命名优化：** 禁止使用 `txt.<module>.<function>.<n>`；全部采用稳定业务语义：`status.*` / `enum.*` / `nav.*` / `action.*` / `col.*` / `term.*`。页面专属提示一律按业务含义命名。

---

## 修改文件

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `i18n.js` | 纯新增（插入 `})();` 之前） | 新增 72 个语义 key 的 `dict.en` + `dict.id`（含中文 fallback 来自 `t()` 第二参） |
| `app.js` | 文本接线（不改结构） | 7 处 nav 模块标签包 `t()`；28 处独立中文文本（是/否/名称/备注/数量/编辑/新增等）包 `t()` |

**未改动：** `server.js`、`index.html`、数据库、i18n 架构、`STATUS_KEY_MAP`/`statusLabel` 机制、订单预测页（冻结）。

---

## 实施明细

### 1. enum / status mapping（已就绪，仅确认）
- `STATUS_KEY_MAP` + `statusLabel()` 早已把全部 27 个 `status.*` 值路由到 `t()`。
- 经核查 27 个 `status.*` 键**已存在于 dict 且 en/id 均已翻译**（如 `Active/Aktif`、`Paid/Dibayar`、`Pending Approval/Menunggu Persetujuan`）。
- → 本项无需新增工作，所有状态徽章在 en/id 模式下自动显示译文（E2E 已验证：payment 页 `Paid/Unpaid/Dibayar`、users 页 `Active/Aktif`，无中文残留）。

### 2. module labels（nav.*）
- dict 新增 8 个缺失 key：`nav.home`、`nav.forecast`、`nav.inventory_total`、`nav.sales`、`nav.sales_data`、`nav.finance`、`nav.payable_cockpit`、`nav.roles`（en/id 译文）。
- `app.js` 中 7 个硬编码模块标签包 `t()`（库存总表/销售/销售数据/订单预测/财务/应付驾驶舱/角色权限）。
- E2E 验证：zh→en 切换后 topnav 显示 `Inventory/Sales/Finance/Procurement/Approvals/System/Home`；展开各模块组侧边栏显示 `Inventory Total/Sales Data/Order Forecast/Payables Cockpit/Roles & Permissions`（id 模式对应 `Total Inventori/Data Penjualan/Kokpit Hutang/Peran & Izin`），原文中文均消失。

### 3. common actions（action.*）
- dict 新增 27 个通用动作 key（保存/取消/编辑/删除/确认/确定/提交/审批/审核/拒绝/搜索/重置/新增/添加/导出/关闭/返回/查看/打印/生成/刷新/筛选/是/否/应用/清空/下载/上传）。
- `app.js` 中以**安全 AST 方式**对纯文本（无 HTML/占位符/插值、非属性值、非对象 key、非冻结函数）的中文动作字面量包 `t()`，共 **28 处**（是×5/否×3/名称×5/备注×8/数量×5/编辑×1/新增×1）。

### 4. finance / procurement shared terms（term.*）+ 通用表头（col.*）
- `term.*` 新增 27 个共享术语（`term.fin.*` 9、`term.pur.*` 7、`term.inv.*` 4、`term.sales.*` 2、`term.approval.*` 2、`term.sys.*` 3），覆盖 付款/发票/成本/WAC/供应商/PO/PI/CI/仓库/SKU/库存/需求/预测/审批流/角色/权限/用户 等。
- `col.*` 新增 10 个纯表头 key（操作/状态/名称/备注/创建时间/操作人/编码/金额/数量/类型）。
- **本阶段仅建立词汇基础（dict），未全局接线 term.***：因 `供应商/付款/成本` 等词既可能是表头也可能是真实业务数据，全局替换会污染数据。term.* 将在 Phase B 各模块按上下文精确接线（避免数据歧义）。`col.*` 的纯表头部分已随 action.* 一同 AST 接线（28 处中含 col.* 项）。

---

## 验证（隔离 E2E · 端口 3002 · 副本 DB · user_admin session）

脚本：`/tmp/psi-e2e/p3c4a-e2e.js`（puppeteer + chrome-headless-shell）
**结果：PASS=true，JS 错误 0，失败检查 0。**

| 检查项 | 结果 |
|---|---|
| 9 页 × zh/en/id 渲染，无残留双重转义 `\"` | ✅ |
| 无字面 `t("key"` 泄漏 | ✅ |
| 切换语言后内容结构一致（表格行数 zh=en=id） | ✅ |
| nav 模块组 + 子项 en/id 翻译正确、原文中文消失 | ✅ |
| status 徽章 en/id 翻译正确、无中文 | ✅ |
| 全程无 JS 运行时错误 | ✅ |

---

## 风险与边界

- **风险等级：低。** 改动 = dict 纯新增 + `app.js` 文本字面量包 `t()`；未触及任何 `id/class/onclick/data-*/{vN}`、未改 render 逻辑、未改业务/计算逻辑、未改订单预测页。
- **结构快照纪律：** 7 维签名（ids/classes/onclick/data-*/placeholders/tags/{vN}）对 `html.*` 模板无影响（本阶段未改任何 `html.*` 键，仅追加 `dict.en/id` 赋值）；E2E 行数一致性已佐证结构未变。
- **F1 已按用户指示排除：** server.js 零改动，后端消息体系改造风险未引入。

---

## 本阶段**故意未做**（属后续独立任务）

- **界面内 HTML 按钮中的动作词**（如 `<button>保存</button>` 形式的 保存/取消/删除）：它们仅以“HTML 字符串内文本”形式出现，需按 Phase 2-B 的 decompose 方式逐模块接线；这是各业务模块的 B 阶段工作，消费本阶段已建立的 `action.*` 键，不在 foundation 范围。
- **server.js API 文案**（F1）：延后。
- **订单预测页（冻结）**：其生命周期/策略标签（`app.547`…）属 B-4 Sales 阶段，按冻结页纪律单独处理。
- **业务模块专属表头/提示/Modal 文案**：Finance/Procurement/Inventory/Sales/Approval 的 B 阶段。

---

## 下一步

1. **等待人工浏览器验收**（localhost:3002，token 见 `/tmp/psi-e2e/token.txt`；重点：侧边栏/顶栏模块名、状态徽章、确认弹窗 是/否、表头 名称/备注/数量 在 English / Bahasa 下正确）。
2. 验收通过后**仅本地 commit**（仍不 push/deploy，待你指示）。
3. 进入 **Phase 3-C-4B-1 Finance**（顺序：Finance → Procurement → Inventory → Sales → Approval/System），逐模块按 B 阶段纪律推进。
