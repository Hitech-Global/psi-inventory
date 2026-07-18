# 方案 B：订单预测页「在途 / PI已确认未发货 / PO未确认PI」直接读 inventory 实时值

> 目标：订单预测页这 3 列不再依赖 `replenishment_suggestions` 的 generate 快照，改读 `inventory` 的实时值。
> 范围仅限这 3 个字段（及为一致性顺带重算的「总库存池」）。**不改 generate、不改三页口径、不改三周转、不改停采/失真/多维周转、不改自动重算挂载、不改采购链状态机。**

---

## 1. 现状（为什么现在是快照）

- `POST /api/purchase-orders` 创建 PO 时已在事务内调用 `updateInventoryTransitData()`（server.js:2535），把 `inventory.po_unconfirmed_pi_qty / pi_confirmed_unshipped_qty / in_transit_qty` **实时**全量重算写回（实测：新 PO `PO-2026-998922` 写后 `inventory.po_unconfirmed_pi_qty` 合计已变 **8225 = 8194 + 31**）。
- 但订单预测页（总预测 + 线上/线下）这 3 列的渲染数据源是 `GET /api/replenishment-suggestions`，该接口返回的是 `replenishment_suggestions` 表的行，其中这 3 个字段是 **上一次 `generate`（重新计算）时从 inventory 拷贝的快照**（最近一次 generate = 2026-07-08，早于 PO 创建 07-11）。
- 前端所有相关列/表尾都直接读 `r.in_transit_qty` / `r.pi_confirmed_unshipped_qty` / `r.po_unconfirmed_pi_qty`（见第 4 节），所以只要让这个 GET 接口把 3 个字段换成 inventory 实时值，全页（总预测 + 渠道两视图 + 表尾合计）都会即时变成实时，**无需前端改动**。

## 2. 关键事实（已核实）

`GET /api/replenishment-suggestions`（server.js:1937）当前 SQL：
```sql
SELECT rs.*, s.product_name, s.brand, s.category, s.model, s.standard_purchase_price, s.qty_per_carton, s.purchase_currency, i.last_inbound_date
FROM replenishment_suggestions rs
LEFT JOIN skus s ON rs.sku_code = s.sku_code
LEFT JOIN inventory i ON rs.sku_code = i.sku_code AND rs.country = i.country AND rs.target_warehouse = i.warehouse
WHERE 1=1
```
→ **`inventory i` 已经按 `(sku_code, country, target_warehouse)` 精确 JOIN 进来了**，只是 SELECT 没取 `i.*` 的 3 个在途字段。缺的只是「把快照换成实时值」这一步。

## 3. 改动点（唯一文件：`server.js`，仅 `GET /api/replenishment-suggestions` 一处）

### 3.1 SELECT 增加 4 个 inventory 实时字段
原（server.js:1939）：
```js
  let sql = `SELECT rs.*, s.product_name, s.brand, s.category, s.model, s.standard_purchase_price, s.qty_per_carton, s.purchase_currency, i.last_inbound_date FROM replenishment_suggestions rs LEFT JOIN skus s ON rs.sku_code = s.sku_code LEFT JOIN inventory i ON rs.sku_code = i.sku_code AND rs.country = i.country AND rs.target_warehouse = i.warehouse WHERE 1=1`;
```
改为：
```js
  let sql = `SELECT rs.*, s.product_name, s.brand, s.category, s.model, s.standard_purchase_price, s.qty_per_carton, s.purchase_currency, i.last_inbound_date,
    i.available_qty AS i_available_qty,
    i.in_transit_qty AS i_in_transit_qty,
    i.pi_confirmed_unshipped_qty AS i_pi_unshipped_qty,
    i.po_unconfirmed_pi_qty AS i_po_unconfirmed_pi_qty
    FROM replenishment_suggestions rs LEFT JOIN skus s ON rs.sku_code = s.sku_code LEFT JOIN inventory i ON rs.sku_code = i.sku_code AND rs.country = i.country AND rs.target_warehouse = i.warehouse WHERE 1=1`;
```

### 3.2 在 `.map(r => {...})` 末尾覆盖为实时值
原（server.js:1948-1958）：
```js
  const rows = query(sql, params).rows.map(r => {
    let daysSince = null;
    if (r.last_inbound_date) {
      const d = new Date(r.last_inbound_date);
      if (!isNaN(d.getTime())) {
        daysSince = Math.floor((today - d) / (1000 * 60 * 60 * 24));
      }
    }
    r.days_since_last_inbound = daysSince;
    return r;
  });
```
改为：
```js
  const rows = query(sql, params).rows.map(r => {
    let daysSince = null;
    if (r.last_inbound_date) {
      const d = new Date(r.last_inbound_date);
      if (!isNaN(d.getTime())) {
        daysSince = Math.floor((today - d) / (1000 * 60 * 60 * 24));
      }
    }
    r.days_since_last_inbound = daysSince;
    // B：订单预测页「在途 / PI已确认未发货 / PO未确认PI」直接读 inventory 实时值，不再依赖 generate 快照。
    // LEFT JOIN 无匹配行（已知限制 D3：SKU 无 inventory 行）时回退到 rs 原快照值，保持兼容。
    r.in_transit_qty            = (r.i_in_transit_qty != null)        ? r.i_in_transit_qty        : r.in_transit_qty;
    r.pi_confirmed_unshipped_qty = (r.i_pi_unshipped_qty != null)     ? r.i_pi_unshipped_qty     : r.pi_confirmed_unshipped_qty;
    r.po_unconfirmed_pi_qty     = (r.i_po_unconfirmed_pi_qty != null) ? r.i_po_unconfirmed_pi_qty : r.po_unconfirmed_pi_qty;
    // 一致性：总库存池用实时分量重算（available 取 inventory 实时值），避免与上面 3 列矛盾
    r.total_inventory_pool = (r.i_available_qty != null)
      ? (r.i_available_qty + r.in_transit_qty + r.pi_confirmed_unshipped_qty + r.po_unconfirmed_pi_qty)
      : r.total_inventory_pool;
    return r;
  });
```

> 说明：`!= null` 同时覆盖 `NULL` 与 `undefined`。inventory 行存在但值为 0（如尚未发货）时 `0 != null` 为真 → 取实时 0（正确）。inventory 行不存在（LEFT JOIN 为空）时字段为 `null` → 回退 rs 快照（兼容 D3）。

## 4. 数据流影响（为什么前端零改动即可生效）

前端所有相关列/表尾均直接读取上述 `r.*` 字段，接口返回实时值后自动生效：

| 视图 | 列 | 前端取值位置 |
|---|---|---|
| 总预测 | 在途库存 | `r.in_transit_qty`（app.js:3020 / 2981 / 3108 表尾） |
| 总预测 | PI已确认未发货 | `r.pi_confirmed_unshipped_qty`（app.js:2982 / 3032 / 3108 表尾） |
| 总预测 | PO未确认PI | `r.po_unconfirmed_pi_qty`（app.js:3023 / 3108 表尾） |
| 总预测 | 总库存池 | `r.total_inventory_pool`（app.js:2972 / 3108 表尾） |
| 线上/线下 | 分摊在途库存 | 由 `r.in_transit_qty` 按占比分摊（app.js:3166→3188） |
| 线上/线下 | PI已确认未发货 | `r.pi_confirmed_unshipped_qty`（app.js:3167 / 3180 / 3249） |
| 线上/线下 | PO未确认PI | `r.po_unconfirmed_pi_qty`（app.js:3237 / 3238 表尾） |
| 线上/线下 | 总库存池 | `r.total_inventory_pool`（app.js:3168 / 3189） |
| 明细弹窗 | PO未确认PI / PI已确认未发货 | `r.po_unconfirmed_pi_qty` / `c.piUnshipped`（app.js:3634-3635） |

→ 仅需改后端 GET 一处，**前端 0 改动**；总预测与渠道两视图、表尾合计、明细弹窗全部同步变成实时。

## 5. 明确不在范围内（保持不动）

- `generate` 公式 / `POST /api/replenishment-suggestions/generate`（server.js:1963）— 不碰；generate 仍照常把 inventory 值拷进 rs 快照（现在 GET 直接覆盖，二者最终一致）。
- 建议采购数量逻辑（`suggested_qty` / 三页口径统一）— 不碰（`suggested_qty` 来自 rs，与本次 3 字段无关）。
- 三周转口径（当前可用/在途后/下单后）— 不碰（其 transit 分量现在读实时值，属预期收益，非改动）。
- 停采品牌逻辑 / 销量失真修复 / 多维目标周转 — 不碰。
- 自动重算挂载 — 不碰（本方案让「创建 PO 后无需点重新计算即可看到」成为事实，但**不**在 PO 创建后自动触发 generate）。
- 采购链状态机（PO/PI/CI 的 PUT、取消端点等）— 不碰。
- 当前可用库存列（`r.available_qty`）— 不在 3 字段范围内，保持 rs 快照值（可用库存仍由导入/出库维护，非本次议题）。

## 6. 一致性提示（请你拍板是否纳入）

- **总库存池（pool）列**：第 3.2 节已把它同步重算为实时分量之和（推荐纳入，否则会出现「在途列已是实时、总库存池却是旧快照」的矛盾）。它仍只在 GET 读取层生效，不改 generate。
- **顶部 KPI 卡片（summary 接口）**：`/api/replenishment-suggestions/summary`（server.js:1831）的 `totalPool` / `overallTurnover` 仍读 `rs.total_inventory_pool` 快照。若希望顶部「总库存池 / 预计周转月数」也与列一致，需对 summary 接口做同样的 inventory 实时 JOIN 覆盖（第二个小改动，可后续单独做）。本最小方案**默认不含 summary 接口**，除非你要求一并改。

## 7. 验证清单（改完后）

1. `node --check server.js` 通过；重启服务 HTTP=200。
2. 不点「重新计算」，直接刷新订单预测页：
   - 总预测「PO未确认PI」表尾合计应为 **8225**（= 新 PO 8194 + 原有 31），单 SKU 行 RDM724B 应显示 **1752**（与 inventory 实时值吻合）。
   - 渠道（线上）页「PO未确认PI」同值；「分摊在途库存」随实时 `in_transit_qty` 变化。
3. 对比 generate 前后：本改动让 GET 始终返回实时值，故「重新计算」前后这 3 列应一致（不再有 31→8225 的跳变）。
4. 回归确认：建议采购数量三页口径、三周转、停采 SKU 显示、销量失真 SKU 数值均**无任何变化**（grep 已确认这些列不读本次改动的 3 字段）。
5. D3 兼容：对无 inventory 行的 SKU，3 列回退到 rs 快照值（行为不变，不报错）。

## 8. 回滚

仅 server.js 一处 SELECT + 一处 `.map` 覆盖，回滚 = 还原这两段即可，零数据迁移、零表结构变更。
