# P1-INBOUND-01 《负数入库校验只读排查》

- 任务编号:P1-INBOUND-01
- 任务名称:负数入库校验只读排查
- 排查方式:严格只读(代码静态阅读 + better-sqlite3 `readonly:true` 抽样查询;临时脚本运行后已删除)
- 工作目录:/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app
- 本轮状态:**零修改**(见第 11 节)

---

## 1. 当前代码事实(相关路由、处理函数、行号)

### 1.1 入库相关 POST 路由清单(server.js)

| 路由 | 行号 | 数量字段 | 入口校验 |
|---|---|---|---|
| `POST /api/inventory-imports/bulk-import`(ERP 库存导入/批量库存导入) | server.js:1306 | `available_qty`、`weighted_avg_cost` | **仅校验 sku_code / import_date 非空** |
| `POST /api/inbound-records`(采购/到货入库单,单条) | server.js:3931 | `actual_qty`、`ci_shipped_qty`、`expected_qty` | **仅校验 sku_code / inbound_date 非空** |
| `POST /api/inbound-records/batch-import`(入库单批量导入) | server.js:3980 | `actual_qty` 等 | **已校验 `actualQty < 0` 抛错**(server.js:4000) |

### 1.2 关键处理细节

- **库存导入 bulk-import(server.js:1306-1326)**
  - server.js:1317 `parseInt(item.available_qty) || 0` —— `parseInt('-5')` 结果为 `-5`,而 `-5 || 0` 中 `-5` 为真,故**负数原样通过**,无任何符号校验。
  - server.js:1311-1321 外层 `transaction(() => { items.forEach(...) })`,但每个 item 内部 `try/catch` 仅 `result.failed++`,**异常被吞掉不向外传播**,因此单行失败不会让整个事务回滚(见第 4 节)。
  - server.js:1323 导入后调用 `refreshInventoryTotals(snapshotCutoffDate)`,将 `available_qty` 直接写入库存总表。
- **入库单单条 POST(server.js:3931-3977)**
  - server.js:3934 仅校验 `sku_code`、`inbound_date` 非空。
  - server.js:3951-3952 `d.actual_qty || 0` —— 同样**负数原样通过**,无 `>=0` 校验。
  - server.js:3945-3947 用 `actual_qty` 累加 `commercial_invoice_items.inbound_qty`,负数会**反向扣减**已入库累计;server.js:3952 `uninbound_qty = ci_shipped_qty - actual_qty` 负数会使未入库数变负/异常。
- **入库单批量导入(server.js:3980-4079)** ✅ 唯一有符号校验的入口
  - server.js:3997-4000 `const actualQty = parseInt(rec.actual_qty); if (isNaN(actualQty) || actualQty < 0) throw new Error('实际入库数量必须为非负整数');` —— 校验在 INSERT **之前**。
  - 仍属"逐行 try/catch 吞异常"模式(server.js:4067-4070),单行失败不回滚整批。
  - server.js:4050 `if (actualQty > 0) updateInventoryAfterInbound(...)`,但见 1.3。
- **更新库存总表的两个函数**
  - `refreshInventoryTotals`(server.js:1435):server.js:1440-1443 从 `inventory_imports` 读取 `available_qty`(含负值);server.js:1476 `invValue = available_qty * wac`;server.js:1483/1486 直接将 `available_qty` 与 `inventory_value` **原样写入 `inventory` 表,无符号校验**。
  - `updateInventoryAfterInbound`(server.js:4190):**首行 `return;` 已被禁用**(server.js:4191-4192),即当前入库单的任何数量**都不会**经此函数改写 `inventory.available_qty`。这是当前负面数据尚未直接污染库存总表的关键原因(见第 3 节)。
- **在途数据 `updateInventoryTransitData`(server.js:1497)**:聚合 `commercial_invoice_items` 的 `shipped_qty - inbound_qty`,因入库单负数会污染 `inbound_qty`,可间接导致在途统计失真。

### 1.3 前端校验现状(app.js)

| 入口 | 前端校验 | 行号 |
|---|---|---|
| 库存导入(bulk-import) | `INV_IMPORT_COLUMNS` 对 `available_qty` 仅 `format:parseInt`(app.js:2215),`handleInvFile` 只校验 sku/日期非空(app.js:2283-2288)——**无非负校验**,负数可直达后端 | app.js:2254-2372 |
| 入库单单条 POST | `if(q>0)` 仅在 q 为正时才提交(app.js:6066)——**前端有临时拦截,但后端无兜底** | app.js:6066 |
| 入库单批量导入 | `if(isNaN(n)\|\|n<0) rec._errors.push('实际入库数量必须为非负整数')`(app.js:6145-6149)——**前后端双重校验** | app.js:6111-6162 |

---

## 2. 当前数据库事实(相关表、数量字段、约束、样本)

### 2.1 表结构与 CHECK 约束(db.js)

| 表 | 数量字段 | 定义(db.js 行号) | 是否含非负 CHECK |
|---|---|---|---|
| `inventory_imports` | `available_qty INTEGER` / `weighted_avg_cost REAL` | db.js:343-356 | **否** |
| `inventory` | `available_qty INTEGER` / `inventory_value REAL` / 多个在途整数字段 | db.js:360-381 | **否** |
| `inbound_records` | `actual_qty`、`accumulated_qty`、`uninbound_qty`、`ci_shipped_qty`、`expected_qty`、`abnormal_qty` | db.js:836-861 | **否** |
| `commercial_invoice_items` | `shipped_qty`、`inbound_qty`、`uninbound_qty` | db.js:728-742 | **否** |
| `purchase_order_items` | `po_qty` 等 | db.js:621-635 | **否** |

结论:**所有库存/入库数量字段在 DB 层均无任何 `CHECK (... >= 0)` 约束**,完全依赖应用层。
(对照:付款类表 `payable_items`/`payment_request_items`/`payment_transactions`/`payment_allocations` 有 `CHECK (...>=0 / >0)`,说明团队对金额字段有意识加约束,但**遗漏了库存数量字段**。)

### 2.2 当前数据抽样(只读查询,better-sqlite3 readonly:true)

| 检查项 | 命中行数 | 说明 |
|---|---|---|
| `inventory_imports.available_qty < 0` | **0** | 当前无负库存导入快照 |
| `inventory_imports.available_qty <= 0` | 582 | 绝大多数为合法 0 库存 |
| `inventory.available_qty < 0` | **0** | 当前库存总表未被负数量污染 |
| `inventory.inventory_value < 0` | **0** | 当前库存金额未被污染 |
| `inbound_records.actual_qty < 0` | **1** ⚠️ | **已存在负数入库记录** |
| `inbound_records.actual_qty = 0` | 1 | 另有 1 条 0 数量入库 |
| `commercial_invoice_items.inbound_qty < 0` | 0 | 暂未扩散 |
| `commercial_invoice_items.shipped_qty < 0` | 0 | — |
| `purchase_order_items.po_qty < 0` | 0 | — |
| `proforma_invoice_items.pi_confirmed_qty < 0` | 0 | — |

**现有负数记录样本(确凿证据):**
```
inbound_records:
  id=inbound_1783998263598_ds7333
  inbound_no=IN-2026-263598
  sku_code=RDM731
  actual_qty=-1, accumulated_qty=-1, uninbound_qty=1
```
该记录证明:**单条入库 `POST /api/inbound-records` 的负数漏洞已被触发**(经直接 API 调用/测试脚本/历史代码路径写入,因为当前唯一 UI 入口有 `if(q>0)` 拦截)。同时 `accumulated_qty=-1` 表明它已反向污染了 `commercial_invoice_items` 的累计入库逻辑预期值。

---

## 3. 完整调用链(前端提交 → 接口 → DB 写入,负数如何流动)

### 路径 A:库存导入 bulk-import(最高风险,前后端均无符号校验)
```
[前端] handleInvFile(app.js:2254) 解析 Excel/CSV
        available_qty 仅经 parseInt,无 >=0 校验
                │
                ▼
[前端] submitInvBatchImport(app.js:2358) → POST /api/inventory-imports/bulk-import
                │
                ▼
[后端] server.js:1306  bulk-import 处理器
        server.js:1317  parseInt(item.available_qty) || 0   ← 负数(-5)原样通过
        server.js:1311-1321 transaction + 逐行 INSERT inventory_imports(无符号校验)
                │
                ▼
[后端] server.js:1323  refreshInventoryTotals(snapshotCutoffDate)
        server.js:1440-1443 读取 inventory_imports.available_qty(含负值)
        server.js:1476  invValue = available_qty * wac
        server.js:1483/1486 INSERT/UPDATE inventory.available_qty、inventory.inventory_value
                ← 负数直接写入库存总表(无符号校验)
```
**结果:负数会进入 `inventory.available_qty` 与 `inventory.inventory_value`,并随下游补货建议/周转/成本展示扩散。**

### 路径 B:入库单单条 POST(后端无校验,当前 UI 有临时拦截)
```
[前端] app.js:6066  const q=parseInt(...)||0; if(q>0) api(POST /api/inbound-records,{actual_qty:q})
        ← 仅当 q>0 才提交(前端拦截)
                │  (绕过 UI 直接调 API / 旧逻辑 即可注入负数)
                ▼
[后端] server.js:3931  仅校验 sku_code/inbound_date
        server.js:3951-3952  d.actual_qty || 0  ← 负数原样通过
        server.js:3945-3947  commercial_invoice_items.inbound_qty += actualQty(负数→反向扣减)
        server.js:3952  uninbound_qty = shipped - actualQty(负数→异常增大)
        server.js:3960-3968  CI 状态判定 allInbound = inbound_qty>=shipped_qty(被污染)
```
**结果:负数不直接进 `inventory` 总表(`updateInventoryAfterInbound` 已被禁用,server.js:4190),但会污染入库单、CI 累计入库/未入库数、CI 完成状态及在途统计。已发生 1 例(见 2.2)。**

### 路径 C:入库单批量导入(已被双重校验,低风险)
```
[前端] app.js:6145-6149  if(isNaN(n)||n<0) 标记错误行
        │
        ▼
[后端] server.js:3997-4000  if(isNaN(actualQty)||actualQty<0) throw  ← 校验在前
        server.js:4043  INSERT inbound_records(仅合法行到达此处)
```
**结果:负数在写入前被拦截,安全。**

---

## 4. 缺陷或风险

1. **R1(高危)库存导入 bulk-import 无负数校验(前后端均缺)**
   负数 `available_qty` 经 `refreshInventoryTotals` 直接写入 `inventory.available_qty` 与 `inventory.inventory_value`,是污染库存总表最直接的路径。当前 DB 虽暂无负快照(0 行),但代码路径完全允许,且历史上已诞生 1 条负入库记录,说明该类漏洞在生产环境可被触发。

2. **R2(中危)入库单单条 POST 无负数校验**
   `actual_qty || 0` 不过滤负数;虽当前 UI 有 `if(q>0)` 临时拦截,但**后端无兜底**,任何绕过 UI 的调用(脚本、历史代码、第三方集成)均可注入负数,并已实证发生 1 例,污染了 `inbound_records` 与 `commercial_invoice_items` 累计字段。

3. **R3(中危)DB 层缺非负 CHECK 约束**
   所有库存/入库数量字段无 `CHECK(>=0)`,完全依赖应用层。一旦应用层校验缺失或被绕过,负数直达落库。付款类表有同类约束而库存表没有,属约束遗漏。

4. **R4(设计风险)逐行吞异常 → 无整体回滚**
   `inventory-imports/bulk-import`(server.js:1319)与 `inbound-records/batch-import`(server.js:4067)均在 `transaction` 内对单行 `try/catch` 仅计数 `failed++`,异常不冒泡,**单行失败不会回滚整批**,成功行照常提交。这意味着即便加了符号校验,"部分成功"仍可能导致数据不一致,需明确整体回滚策略。

5. **R5(低危,关联)加权成本可负**
   `inventory_imports.weighted_avg_cost` 同样 `parseFloat(...) || 0` 无符号校验(server.js:1317),若成本为负且数量为正,`inventory_value = qty * wac` 也会变负。当前 0 行,但同源缺陷。

6. **R6(低危)校验不一致**
   三个入库入口校验强度不一(批量入库有、单条入库无、库存导入无),同一业务语义(数量非负)在不同入口表现不一致,维护易遗漏。

---

## 5. 受影响文件、函数、接口、表和字段

- **文件/函数(server.js)**
  - `POST /api/inventory-imports/bulk-import`(server.js:1306-1326)→ 字段 `available_qty`(server.js:1317)、`weighted_avg_cost`
  - `refreshInventoryTotals`(server.js:1435-1494)→ 字段 `available_qty`、`inventory_value`(server.js:1476、1483、1486)
  - `POST /api/inbound-records`(server.js:3931-3977)→ 字段 `actual_qty`(server.js:3951-3952)、`commercial_invoice_items.inbound_qty/uninbound_qty`(server.js:3945-3947、3952)
  - `POST /api/inbound-records/batch-import`(server.js:3980-4079)→ 字段 `actual_qty`(已校验,server.js:4000)
  - `updateInventoryTransitData`(server.js:1497)→ 间接受 `inbound_qty` 污染影响
- **文件/函数(app.js)**
  - 库存导入解析 `handleInvFile`(app.js:2254)与 `INV_IMPORT_COLUMNS` 的 `available_qty`(app.js:2215,仅 parseInt 无符号校验)
  - 入库单单条提交(app.js:6066,仅 `if(q>0)` 前端拦截)
  - 入库单批量解析 `handleInboundFile`(app.js:6111,actual_qty 已校验 server.js:6145-6149)
- **表/字段(db.js)**
  - `inventory_imports.available_qty`(db.js:350)、`weighted_avg_cost`(db.js:351,迁移列 db.js:1290-1297)
  - `inventory.available_qty`(db.js:365)、`inventory_value`(db.js:372)
  - `inbound_records.actual_qty`(db.js:850)、`accumulated_qty`(db.js:851)、`uninbound_qty`(db.js:852)
  - `commercial_invoice_items.inbound_qty`(db.js:738)、`uninbound_qty`(db.js:739)
- **已污染的现存数据**:`inbound_records` 中 1 条 `actual_qty=-1` 记录(见 2.2)。

---

## 6. 最小方案(仅设计,不实施)

只在**应用层**补最薄一道防线,不改变表结构、不加 DB 约束:

- 在 `POST /api/inventory-imports/bulk-import` 的逐行处理(server.js:1313)增加:`if (isNaN(parseInt(item.available_qty)) || parseInt(item.available_qty) < 0) { result.failed++; result.errors.push(...); return; }`。
- 在 `POST /api/inbound-records`(server.js:3934 后)增加:`const aq = parseInt(d.actual_qty); if (isNaN(aq) || aq < 0) return res.status(400).json({error:'实际入库数量必须为非负整数'});`。
- 同步在前端库存导入解析(app.js:2283 附近)增加 `available_qty` 非负校验,使非法行在预览阶段即标红。

作用:堵住 R1、R2 两条漏洞路径;最小改动,不碰 DB schema。

---

## 7. 完整方案(仅设计,不实施)

在最小方案基础上,补齐全部防线与一致性:

1. **接口层(全部入库入口统一符号校验)**
   - 统一封装一个 `validateNonNegativeQty(value, fieldName)` 工具,对 `available_qty`、`actual_qty`、`ci_shipped_qty`、`expected_qty`、`weighted_avg_cost` 等数量/金额字段在写入前校验(非负整数/非负实数),失败时 400 返回,不进入写入。
   - 三个入库入口(`inventory-imports/bulk-import`、`inbound-records`、`inbound-records/batch-import`)统一调用该工具,消除 R6 不一致。
2. **DB 层(加非负 CHECK 约束)**
   - 对 `inventory_imports.available_qty`、`inventory.available_qty`、`inbound_records.actual_qty/accumulated_qty/uninbound_qty`、`commercial_invoice_items.inbound_qty/uninbound_qty/shipped_qty` 等增加 `CHECK (col >= 0)`(SQLite 需通过"重建表/迁移"方式添加,因 ADD COLUMN 不支持加 CHECK;付款类表已有先例可参照)。
   - 作为最后兜底,即使应用层被绕过,DB 也会拒绝负数写入(R3)。
3. **库存总表刷新函数加固**
   - `refreshInventoryTotals` 在写 `inventory` 前对 `available_qty` 与 `inventory_value` 取 `>=0` 语义保护,并补充告警(R1)。
4. **现存脏数据治理**
   - 定位并修正 2.2 中 `actual_qty=-1` 的入库记录,并回溯其影响的 `commercial_invoice_items.inbound_qty/uninbound_qty` 与 CI 状态,必要时重算在途。
5. **事务边界策略(承接 R4)**
   - 明确批量导入"整体原子"策略:任一数量校验失败即整批回滚(而非逐行吞异常),或至少提供"严格模式"开关;失败行明细仍返回给用户。

---

## 8. 推荐方案(仅设计,不实施)

**采用"DB 约束兜底 + 接口层统一校验 + 前端预览拦截"三层防御,优先落地 DB 兜底与单条入库接口校验。**

理由与优先级:
1. **P0(必做)**:`inventory_imports.bulk-import` 与 `inbound-records`(单条)后端加非负校验 —— 直接堵住已被实证触发的漏洞,成本极低。
2. **P0(必做)**:`inventory` / `inbound_records` / `inventory_imports` / `commercial_invoice_items` 关键数量字段补 `CHECK(col >= 0)` —— 杜绝"应用层被绕过"的后门,与现有付款表约束风格一致。
3. **P1(建议)**:统一数量校验工具函数,消除三入口不一致(R6)。
4. **P1(建议)**:修复/回滚 2.2 中已存在的 `actual_qty=-1` 脏数据及其连锁影响。
5. **P2(可选)**:批量导入明确整体回滚策略(R4);前端库存导入增加非负预览校验。

> 说明:`updateInventoryAfterInbound` 当前被 `return;` 禁用(server.js:4190),故单条入库负数目前**不直接**改写 `inventory` 总表;但一旦未来启用该函数,负数将沿 server.js:4195 `available_qty + qty` 直接污染库存总表,因此 DB 层 `CHECK` 兜底尤为关键。

---

## 9. 实施修改范围(列出需改文件/表/字段/约束,但本轮不做)

- **server.js**
  - `POST /api/inventory-imports/bulk-import`(约 server.js:1312-1317):增加 `available_qty`、`weighted_avg_cost` 非负校验。
  - `refreshInventoryTotals`(约 server.js:1476、1483、1486):写入 `inventory` 前的数量/金额非负保护。
  - `POST /api/inbound-records`(约 server.js:3934、3951-3952):增加 `actual_qty` 非负校验。
  - `POST /api/inbound-records/batch-import`(server.js:3997-4000):沿用现有校验,可抽成统一工具。
  - 可选:新增 `validateNonNegativeQty` 工具并统一调用;批量导入事务回滚策略(server.js:1319、4067)。
- **app.js**
  - 库存导入解析 `handleInvFile`(约 app.js:2283)与 `INV_IMPORT_COLUMNS` 的 `available_qty`(app.js:2215):增加非负预览校验。
- **db.js(迁移脚本,非 DDL 直改线上表)**
  - 为 `inventory_imports.available_qty`、`inventory.available_qty`、`inventory.inventory_value`(可选)、`inbound_records.actual_qty/accumulated_qty/uninbound_qty`、`commercial_invoice_items.inbound_qty/uninbound_qty/shipped_qty` 增加 `CHECK (col >= 0)`(通过重建表迁移方式,参照付款表 CHECK 写法)。
- **数据治理**
  - 修正 `inbound_records` 中 `actual_qty=-1`(inbound_1783998263598_ds7333)及其连锁的 `commercial_invoice_items` 累计字段与 CI 状态。

> 以上均属"本轮不做"的设计范围,符合只读排查边界。

---

## 10. 针对性测试建议

1. **接口层负数用例(重点)**
   - `POST /api/inventory-imports/bulk-import` 提交 `available_qty = -5` / `-1` / `0` / `abc`:预期负数被拒(`failed` 计数 + errors 返回),不写入 `inventory_imports` 与 `inventory`;验证 `refreshInventoryTotals` 后 `inventory.available_qty` 未被污染。
   - `POST /api/inbound-records` 提交 `actual_qty = -1`:预期 400 拒绝(当前会 200 写入,系缺陷)。
   - `POST /api/inbound-records/batch-import` 提交含 `actual_qty=-1` 的混合批次:预期该行进 `failed`,其余成功(现有行为,需补断言)。
2. **DB 层约束用例**
   - 在加 CHECK 后,直接用 SQL 尝试 `UPDATE inventory SET available_qty = -1`:预期被 SQLite 拒绝(验证兜底生效)。
3. **回归用例**
   - 合法正数全流程(库存导入 → 入库 → 在途/成本/WAC)不受影响。
   - `available_qty = 0` 仍属合法零库存,不应被拦截。
4. **脏数据清理验证**
   - 修正 2.2 的 `actual_qty=-1` 后,校验 `commercial_invoice_items.inbound_qty/uninbound_qty` 与 CI 状态恢复一致,在途统计(`updateInventoryTransitData`)正确。
5. **事务边界用例**
   - 批量导入含 1 行负数、其余合法的批次,断言"整体回滚"或"部分提交且错误明细完整"符合既定策略,不允许静默成功。
6. **前端用例**
   - 库存导入模板填入负 `available_qty`,预览阶段即标红为无效行,无法提交。

> 所有测试须以**只读/隔离副本**进行,严禁在本轮对生产库执行任何写入型测试(见第 11 节)。

---

## 11. 明确本轮零修改

- 本报告为**严格只读排查**:仅通过阅读 `server.js` / `db.js` / `app.js` 源码,以及使用 `better-sqlite3` 以 `{ readonly: true }` 模式对 `./data/inventory.db` 执行只读抽样查询(临时 `.js` 脚本运行后已删除)。
- **未执行任何 DDL、未运行任何写入型测试、未修改任何代码/数据库/接口/页面/测试数据/日志/报告/`MEMORY.md`。**
- **唯一新建文件**即本报告:`P1-INBOUND-01-负数入库校验只读排查.md`。
- 未对 `.db`、`db.js`、`server.js`、`app.js`、任意 `.md` 及 `.workbuddy` 目录做任何 `Edit`/`Write` 修改。
- 第 6、7、8、9 节中的方案与修改范围**均为设计描述,本轮不予实施**。
