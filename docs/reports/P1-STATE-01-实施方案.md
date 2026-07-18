# P1-STATE-01《PO 审批、PI 与生产状态顺序》实施方案

- 编制日期：2026-07-14
- 工作目录：`/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app`
- 依据报告：`P1-STATE-01-PO审批、PI与生产状态顺序只读排查.md`
- 优先级：**P1（业务一致性 / 审计合规红线）**
- 本轮性质：**仅出方案，零代码修改**（见第 8 节）

---

## 1. 目标与范围

- **目标**：把报告指出的 PO→PI→定金→CI 流转中的「前端软约束」升级为「后端硬校验」，消除可跳过 PO 审批、可注入任意 status、非法状态回退、需定金未付即生成 CI、作废不回滚上游在途等数据一致性缺陷。
- **范围**：单任务，仅后端 `server.js` 路由层加校验；**不新增业务规则、不改数据库表结构（无 DDL）、不改前端逻辑、不引入新接口**。
- **最小修改原则**：在原有各写入路由内就近插入前置校验，复用既有查询/事务机制；不重构状态机、不新增独立状态机服务。
- **完成即停**：本项落地即停，进入下一项须经用户批准。

---

## 2. 当前事实（报告关键证据 + 行号）

| 缺陷 | 代码事实 | 证据 |
|---|---|---|
| R1 PO 审批可被跳过 | `POST /api/proforma-invoices` 接受 `related_po_id` 并直接把 PO 翻 `transferred_pi/partial_pi`，**不校验 PO 审批状态**；批量导入同款 | server.js:3357、3387-3391、3722、3746、3755 |
| R2 任意 status 注入 | 新建 PI/CI 接受请求体 `d.pi_status`/`d.ci_status`，DB 无 ENUM/CHECK | server.js:3357、3586；db.js:664/662、712、653 |
| R3 无状态前置校验 | PI 附件上传、CI 附件上传、定金 confirm-paid、CI 新建均不判断「当前状态是否允许本次转换」 | server.js:3522、3653、4506、3586 |
| R4 定金非 CI 前置 | `need_deposit=1` 的 PI 仍可无条件生成 CI；库内已 10 条「需定金未付已生成 CI」 | 报告 §2.4；server.js:3572-3641 |
| R5 作废不回滚上游 | PI/CI 作废仅置 `cancelled`，不回退 PO `transferred_pi_qty` / PI `shipped_qty` | server.js:3538、3669 |
| R7 PO approve 无守卫 | `/approve` 不校验 `po_status==='pending_approval'` | server.js:3243-3278 |
| 游离值（数据） | 库内 `po_status='confirmed'`:1、`pi_status='confirmed'`:1、`ci_status='shipped'`:2 | 报告 §2.1-2.3 |

前端仅为软约束：`createPI()` 只拉 `?status=approved` 的 PO（app.js:5601），`createCI()` 拉全部 PI 无任何过滤（app.js:5867）；API/导入路径无对应硬约束。

---

## 3. 实施方案（精确落点）

### 3.0 统一状态枚举与校验辅助函数（新增，就近放在 `getPILockReason` 之后，约 server.js:3322）

```js
// 合法状态白名单（与报告 §1.1 字段口径一致）
const PO_STATUS_ENUM = ['draft','pending_approval','approved','sent_factory','transferred_pi','partial_pi','cancelled'];
const PI_STATUS_ENUM = ['pending','uploaded','deposit_paid','shipped_complete','partial_shipped','completed','cancelled'];
const CI_STATUS_ENUM = ['draft','uploaded','ci_pl_uploaded','completed','partial_inbound','cancelled'];
// 约定的「PO 已审批可转 PI」集合
const PO_APPROVED_FOR_PI = ['approved','sent_factory','transferred_pi','partial_pi'];

// 校验并归一：非法值 → 返回 null（调用方应 400 拒绝）
function asValidStatus(value, enumArr) {
  return enumArr.includes(value) ? value : null;
}
```

> 说明：`confirmed`（PO/PI）作为历史游离值保留在白名单中以避免破坏读取，但**新写入路径不再接受**；`ci_status='shipped'` 不在白名单（非代码路径产出），后端写入将拒绝，仅影响物流页读取（见第 5 节回归）。

### 3.1 R1 · PO 审批前置校验（转 PI 硬约束）

**路由 A：`POST /api/proforma-invoices`（server.js:3345）**
- 在 `if (!d.supplier_name)` 校验之后、`transaction` 之前插入：
  ```js
  if (d.related_po_id) {
    const po = queryOne('SELECT id, po_status, approval_status FROM purchase_orders WHERE id = ?', [d.related_po_id]);
    if (!po) return res.status(400).json({ error: '关联 PO 不存在' });
    if (!PO_APPROVED_FOR_PI.includes(po.po_status) || po.approval_status !== 'approved')
      return res.status(400).json({ error: '关联 PO 尚未审批通过，无法生成 PI' });
  }
  ```
- 对 `d.pi_status` 加白名单：`const piStatus = asValidStatus(d.pi_status, PI_STATUS_ENUM) || 'pending';`（拒绝游离值，默认 `pending`）。改 INSERT 的 `d.pi_status || 'pending'` → `piStatus`。

**路由 B：`POST /api/proforma-invoices/batch-import`（server.js:3722-3747）**
- 在 `if (!po) throw ...`（3734）之后、`if (!exist)` 之前插入同样的审批守卫（命中即 `throw new Error('关联 PO 尚未审批通过：' + poNo)`）。

### 3.2 R2 · PI/CI status 枚举约束（写入白名单）

- **PI 新建**（3.1 已含 `piStatus` 归一）。
- **CI 新建 `POST /api/commercial-invoices`（server.js:3572）**：在 `transaction` 前对 `d.ci_status` 归一：`const ciStatus = asValidStatus(d.ci_status, CI_STATUS_ENUM) || 'uploaded';`；INSERT 处 `d.ci_status || 'uploaded'` → `ciStatus`。
- **CI 批量导入（server.js:3792）**：`ci_status` 已硬编码 `'uploaded'`，无需改（天然安全）。
- **PI 批量导入（server.js:3746）**：`pi_status` 已硬编码 `'uploaded'`，无需改。

### 3.3 R3 · 状态前置守卫（禁止非法回退/跳跃）

**a. PI 附件上传 `POST /api/proforma-invoices/:id/attachment`（server.js:3520-3522）**
- 改为先读 PI，再决定 `pi_status`，**不覆写终态/已付状态**：
  ```js
  const pi = queryOne('SELECT pi_status FROM proforma_invoices WHERE id = ?', [req.params.id]);
  const TERMINAL_PI = ['deposit_paid','shipped_complete','partial_shipped','completed','cancelled'];
  const nextStatus = req.body.attachment
    ? (pi && TERMINAL_PI.includes(pi.pi_status) ? pi.pi_status : 'uploaded')
    : (pi ? pi.pi_status : 'pending');
  run('UPDATE proforma_invoices SET attachment = ?, pi_status = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [parseAttachment(req.body.attachment), nextStatus, req.params.id]);
  ```
  → 已 `deposit_paid` 的 PI 调附件接口不再被重置为 `uploaded`。

**b. CI 附件上传 `POST /api/commercial-invoices/:id/attachment`（server.js:3650-3653）**
- 同理先读 CI，保护 `completed/partial_inbound/ci_pl_uploaded`：
  ```js
  const ci = queryOne('SELECT ci_status FROM commercial_invoices WHERE id = ?', [req.params.id]);
  const PROTECT_CI = ['ci_pl_uploaded','completed','partial_inbound'];
  const nextStatus = req.body.attachment
    ? (ci && PROTECT_CI.includes(ci.ci_status) ? ci.ci_status : 'uploaded')
    : (ci && PROTECT_CI.includes(ci.ci_status) ? ci.ci_status : 'draft');
  run(`UPDATE commercial_invoices SET ${field} = ?, ci_status = ?, updated_at = datetime('now') WHERE id = ?`,
      [parseAttachment(req.body.attachment), nextStatus, req.params.id]);
  ```

**c. 定金 confirm-paid `POST /api/payment-requests/:id/approve`（server.js:4506）**
- `if (payment.source_type === 'pi')` 分支前加 PI 状态守卫：
  ```js
  const pi = queryOne('SELECT pi_status FROM proforma_invoices WHERE id = ?', [payment.source_id]);
  if (pi && ['cancelled','completed','shipped_complete','partial_shipped'].includes(pi.pi_status))
    return res.status(400).json({ error: '该 PI 处于终态/已发货，不可再确认定金' });
  ```
  → 任意 PI 状态均可被翻 `deposit_paid` 的漏洞关闭。

**d.（配套）发起定金 `POST /api/payment-requests/from-pi-deposit`（server.js:4303）**
- 已有 `need_deposit && payable_deposit>0` 校验；追加 `pi.pi_status` 守卫：拒绝 `cancelled/completed/shipped_complete/partial_shipped`，避免对终态 PI 发起付款。

### 3.4 R4 · CI 生成前置（PI 状态 + 定金已付）

**CI 新建 `POST /api/commercial-invoices`（server.js:3572-3586）**
- 在 `transaction` 前、已解析 `pi` 之后插入：
  ```js
  if (d.related_pi_id && pi) {
    if (['pending','cancelled'].includes(pi.pi_status))
      return res.status(400).json({ error: '关联 PI 状态不允许生成 CI（需至少 uploaded/deposit_paid）' });
    if (pi.need_deposit === 1 && pi.deposit_payment_status !== 'paid')
      return res.status(400).json({ error: '该 PI 需先付定金，定金未付不能生成 CI' });
  }
  ```
- 该硬校验将阻断库内现存 10 条「需定金未付已生成 CI」的同类**新建**路径；既有 10 条数据见第 7 节清理，需业务确认后再处理。

**CI 批量导入 `POST /api/commercial-invoices/batch-import`（server.js:3769-3791）**
- 在 `pi` 解析之后、`if (!exist)` 之前插入同样两道守卫。

### 3.5 R7 · PO approve 状态机守卫（拒绝/撤回/重提补全）

**`POST /api/purchase-orders/:id/approve`（server.js:3243）**
- 在 `const po = queryOne(...)`（3246）之后、`const approval = ...`（3249）之前插入：
  ```js
  if (po.po_status !== 'pending_approval')
    return res.status(400).json({ error: 'PO 未处于待审批状态，无法审批/驳回/撤回' });
  ```
  → 配合既有 reject→`draft`、withdraw→`draft`、approve 多级推进，状态机闭环完整。

### 3.6 R5 · 作废回滚上游在途

**PI 作废 `POST /api/proforma-invoices/:id/void`（server.js:3528-3538）**
- 置 `cancelled` 前，回退 PO 的 `transferred_pi_qty` 并重算 `po_status`：
  ```js
  if (pi.related_po_id) {
    const items = query('SELECT po_no, pi_confirmed_qty FROM proforma_invoice_items WHERE pi_id = ?', [pi.id]).rows;
    items.forEach(it => {
      const poItem = queryOne('SELECT id, po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ? AND sku_code = ?', [pi.related_po_id, it.sku_code]);
      if (poItem) {
        const nt = Math.max(0, (poItem.transferred_pi_qty || 0) - (it.pi_confirmed_qty || 0));
        run('UPDATE purchase_order_items SET transferred_pi_qty = ?, untransferred_pi_qty = ? WHERE id = ?',
            [nt, (poItem.po_qty || 0) - nt, poItem.id]);
      }
    });
    const poItems = query('SELECT po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ?', [pi.related_po_id]).rows;
    const anyT = poItems.some(i => (i.transferred_pi_qty || 0) > 0);
    run('UPDATE purchase_orders SET po_status = ? WHERE id = ?', [anyT ? 'partial_pi' : 'approved', pi.related_po_id]);
  }
  ```

**CI 作废 `POST /api/commercial-invoices/:id/void`（server.js:3659-3669）**
- 置 `cancelled` 前，回退 PI 的 `shipped_qty/amount` 并重算 `pi_status`：
  ```js
  if (ci.related_pi_id) {
    const items = query('SELECT sku_code, shipped_qty FROM commercial_invoice_items WHERE ci_id = ?', [ci.id]).rows;
    items.forEach(it => {
      const piItem = queryOne('SELECT id, pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [ci.related_pi_id, it.sku_code]);
      if (piItem) {
        const ns = Math.max(0, (piItem.shipped_qty || 0) - (it.shipped_qty || 0));
        run('UPDATE proforma_invoice_items SET shipped_qty = ?, unshipped_qty = ? WHERE id = ?',
            [ns, (piItem.pi_confirmed_qty || 0) - ns, piItem.id]);
      }
    });
    const piItems = query('SELECT pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ?', [ci.related_pi_id]).rows;
    const anyS = piItems.some(i => (i.shipped_qty || 0) > 0);
    const allS = piItems.length > 0 && piItems.every(i => (i.shipped_qty || 0) >= (i.pi_confirmed_qty || 0));
    const npStatus = allS ? 'shipped_complete' : (anyS ? 'partial_shipped' : 'deposit_paid');
    run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', [npStatus, ci.related_pi_id]);
  }
  ```

> 注意：`pi_status` 在作废 CI 后回退目标取 `deposit_paid`（而非 `uploaded`），以保留“已付定金”语义；若业务要求回退到 `uploaded` 见第 7 节数据清理时一并确认。

---

## 4. 验证与单项测试（仅设计，不执行）

1. **PO 审批守卫**：`draft`→提交成功；非 `draft` 提交被拒；`/approve` 对 `po_status≠pending_approval` 返回 400；reject→`draft` 可重提；withdraw→`draft` 可重提。
2. **R1 绕过审批**：对 `draft`/`pending_approval`/`cancelled` 的 PO 直接 `POST /api/proforma-invoices`（及 batch-import），断言 400 且 PO **不被**翻 `transferred_pi`，PO 的 `transferred_pi_qty` 不变。
3. **R2 状态注入**：新建 PI 传 `pi_status='producing'`、CI 传 `ci_status='shipped'`，断言归入 `pending`/`uploaded` 或 400（按 3.0 归一策略）。
4. **R3 非法回退**：已 `deposit_paid` 的 PI 调附件接口，断言 `pi_status` 保持 `deposit_paid`；已 `completed` 的 CI 调附件接口，断言保持 `completed`。
5. **R3 定金 confirm-paid 守卫**：对 `cancelled/shipped_complete` 的 PI 执行 `confirm-paid`，断言 400 且 `deposit_payment_status` 不变。
6. **R4 定金前置**：`need_deposit=1` 且 `deposit_payment_status≠'paid'` 的 PI 生成 CI，断言 400；付定金后置 `paid` 再生成 CI 成功。
7. **R4 CI 前置（PI 状态）**：对 `pi_status='pending'` 的 PI 生成 CI，断言 400；`uploaded`/`deposit_paid` 则成功。
8. **R5 作废回滚**：PI 作废后断言其 PO `transferred_pi_qty` 减少且 `po_status` 正确重算（`partial_pi`/`approved`）；CI 作废后断言 PI `shipped_qty/amount` 回退且 `pi_status` 重算。
9. **并发**：对同一 PO 并发两次转 PI（不同 SKU），断言 `transferred_pi_qty` 累加正确、无竞态；对未审批 PO 并发转 PI 两路均 400。
10. **端到端 happy path**：`draft→approved→(sent_factory)→PI(pending→uploaded→deposit_paid)→CI(uploaded→ci_pl_uploaded→completed)` 全链路断言每步状态与上游联动正确。

---

## 5. 回归影响

- **受影响功能**：PO 审批流（守卫收紧）、PI/CI 新建与导入、PI/CI 附件上传、定金发起与确认、PI/CI 作废、库存在途重算（`updateInventoryTransitData` 在作废时调用，回滚后须重新核对在途数字）。
- **需回归范围**：
  - 既有合法链路（已审批 PO 转 PI、已付定金生成 CI）应**完全无感**，校验均放行。
  - 物流页 `?status=shipped`（app.js:6020/6059）依赖游离值 `ci_status='shipped'`，后端白名单拒绝写入后该值不再新增；**既有 2 条 `shipped` 记录仍可读取**，但新建路径不再产生——需前端配合（不在本项范围，见报告第 7 项）。
  - `renderPI` 过滤器列出 `confirmed`/`producing`/`pending_deposit`/`pending_ci_pl`（app.js:5516）为前端枚举不一致，与后端白名单无关，不影响后端，但建议后续对齐。
  - 第 7 节数据清理执行后，相关统计/过滤口径会变（须业务确认）。

---

## 6. 完成即停原则

本实施方案为**单任务**。落地且仅落地第 3 节（3.0–3.6）的后端硬校验后，即视为本项完成，**停止扩展**至前端枚举对齐、DB CHECK 约束迁移、游离值清理等。进入下一项（如前端对齐、数据清理）须经用户明确批准。

---

## 7. 数据清理（须批准，**本轮不执行**）

报告 §2 指出以下违反约束的历史数据，本项代码落地后将阻断其**新增**，但既有数据仍需清理，**须业务确认语义后单独执行**：

- `purchase_orders.po_status='confirmed'`：1 条（非代码路径产出，疑历史/导入遗留）→ 归一到 `approved` 或 `draft`。
- `proforma_invoices.pi_status='confirmed'`：1 条 → 归一到 `uploaded` 或 `deposit_paid`。
- `commercial_invoices.ci_status='shipped'`：2 条（物流页依赖）→ 归一到 `ci_pl_uploaded` 或补齐合法语义。
- **需定金未付却已生成 CI**：10 条（含 `ci_pl_uploaded`、`completed`）→ 复核后或补付定金、或作废 CI 回滚、或标记为业务特批。

> 上述清理涉及 UPDATE（非 DDL），但**不在本轮执行**，须用户批准后另开数据修复任务，且应先备份 `/data/inventory.db`。

---

## 8. 明确本轮零修改

- 本文件为**纯方案文档**：唯一新增文件即 `P1-STATE-01-实施方案.md`。
- **未修改** `server.js` / `db.js` / `app.js` / `data/inventory.db` 任何内容；**未执行**任何 DDL、任何写入/变更型测试；未运行临时脚本（只读排查脚本已在报告编制阶段运行后删除）。
- 第 3 节所有代码均为**待实施描述**，第 4 节测试为**待执行建议**，第 7 节数据清理**待批准**。
