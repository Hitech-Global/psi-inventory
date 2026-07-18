# P1-INBOUND-01 《负数入库校验》实施方案

- 任务编号:P1-INBOUND-01
- 文档类型:实施方案(仅文档,本轮不实施)
- 输入报告:`P1-INBOUND-01-负数入库校验只读排查.md`
- 优先级:**P0(数据安全)**
- 工作目录:/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app
- 本轮状态:**零修改**(见第 8 节)

---

## 1. 目标与范围

**目标**:堵住“负数入库/负数库存数量”经接口写入并污染库存数据的漏洞,建立“应用层校验 + DB 层兜底”双层防御。

**范围(最小修改,单任务)**:
- 本项只做一件事:为库存/入库数量字段补齐非负校验与兜底约束。
- 仅改动 `server.js`(两处后端入口校验)、`db.js`(一次迁移补 CHECK)、`app.js`(前端预览校验,可选 P2)。
- **不新增任何业务规则**,仅增加“非负整数/非负实数”这一现已被 batch-import 公认的既有规则(`actual_qty` 必须 ≥ 0),将其推广到其余入口,保持三入口语义一致。
- **本项完成即停**,进入下一项须经用户批准。

**不在本项范围**:
- 不重算、不修正现存 `actual_qty=-1` 脏数据(单列第 7 节,须批准)。
- 不调整事务逐行吞异常策略(R4,本期保持现状,仅确保校验在写入前抛错)。
- 不改动 `updateInventoryAfterInbound` 的禁用状态(保持禁用)。

---

## 2. 当前事实(关键证据与行号)

**两条入口无负数校验(核心证据)**:
- `POST /api/inventory-imports/bulk-import`(server.js:1306-1326):逐行 `parseInt(item.available_qty) || 0`(server.js:1317),`parseInt('-5')` 得 `-5` 且为真,**负数原样通过**,无符号校验;随后 server.js:1323 调 `refreshInventoryTotals`,将 `available_qty` 直接写库存总表。
- `POST /api/inbound-records`(单条,server.js:3931-3977):仅校验 `sku_code`/`inbound_date`(server.js:3934);`d.actual_qty || 0`(server.js:3951-3952)**负数原样通过**,并据此反向扣减 `commercial_invoice_items.inbound_qty`(server.js:3945-3947)。

**唯一有校验的入口(对照基准)**:
- `POST /api/inbound-records/batch-import`(server.js:3980-4079):server.js:3997-4000 已含 `if (isNaN(actualQty) || actualQty < 0) throw new Error('实际入库数量必须为非负整数')`,校验在 INSERT 之前。本项不重复造轮子,复用同一规则文本。

**DB 层无非负 CHECK 约束**:
- `inventory_imports.available_qty`(db.js:350)、`inventory.available_qty`(db.js:365)、`inventory.inventory_value`(db.js:372)、`inbound_records.actual_qty/accumulated_qty/uninbound_qty`(db.js:850-852)、`commercial_invoice_items.inbound_qty/uninbound_qty/shipped_qty`(db.js:738-739)均**无 `CHECK`。**
- 对照付款类表已有先例:`payable_items.payable_amount_minor` 有 `CHECK (payable_amount_minor > 0)`(db.js:947)、`payment_request_items.requested_amount_minor` 有 `CHECK (... >= 0)`(db.js:972)等。库存数量字段属同类遗漏。

**已实证 1 条污染数据(读库证据)**:
- `inbound_records` 中 `id=inbound_1783998263598_ds7333`,`inbound_no=IN-2026-263598`,`sku_code=RDM731`,`actual_qty=-1`、`accumulated_qty=-1`、`uninbound_qty=1`。
- 证明单条入库 `POST /api/inbound-records` 的负数漏洞已被触发,并已反向污染 `commercial_invoice_items` 累计入库预期值。
- 当前 `inventory.available_qty < 0` 命中 0 行,因 `updateInventoryAfterInbound` 已被 `return;` 禁用(server.js:4190-4192),负数尚未直达库存总表——**但 DB 无 CHECK 兜底,一旦未来启用该函数,负数将沿 server.js:4195 `available_qty + qty` 直接污染库存总表**。

---

## 3. 实施方案(精确修改点)

### 3.1 接口层(必做,P0)—— 堵住两条无校验入口

**(A) `POST /api/inventory-imports/bulk-import`(server.js:1313 起,逐行 try 内)**
在现有 SKU/日期非空校验(server.js:1314)之后、INSERT 之前(server.js:1316),增加非负校验:
```js
const availQty = parseInt(item.available_qty);
const wac = parseFloat(item.weighted_avg_cost);
if (isNaN(availQty) || availQty < 0) {
  result.failed++;
  result.errors.push({ row: i + 2, reason: '可用库存数量必须为非负整数' });
  return;                       // 跳过该行,不写 inventory_imports
}
if (isNaN(wac) || wac < 0) {
  result.failed++;
  result.errors.push({ row: i + 2, reason: '加权平均成本必须为非负实数' });
  return;
}
```
原 server.js:1317 的 `parseInt(item.available_qty) || 0` 改为使用上面的 `availQty`,避免再走 `|| 0` 吞掉负数。校验在 INSERT 之前,失败行计入 `failed` 且 `errors` 返回,符合该接口既有的“逐行失败计数”风格;因失败行不 INSERT,故不会经 `refreshInventoryTotals`(server.js:1323)污染库存总表。

**(B) `POST /api/inbound-records`(单条,server.js:3934 之后)**
在 `sku_code`/`inbound_date` 非空校验后,INSERT 前(server.js:3938 `transaction` 之前或之内首行)增加:
```js
const actualQty = parseInt(d.actual_qty);
if (isNaN(actualQty) || actualQty < 0) {
  return res.status(400).json({ error: '实际入库数量必须为非负整数' });
}
```
后续 server.js:3945-3947、3951-3952 中的 `d.actual_qty || 0` 替换为已校验的 `actualQty`。失败即 400 返回,不进入 `commercial_invoice_items` 改写,不污染累计字段。

**(C) `POST /api/inbound-records/batch-import`(server.js:3997-4000)**
已具备正确校验,**本项不改**;仅作为统一规则基准(见 3.3)。

### 3.2 DB 层兜底(必做,P0)—— 补非负 CHECK

通过**迁移脚本**为关键数量字段加 `CHECK (col >= 0)`(SQLite 不支持 `ALTER TABLE ADD CHECK`,须用重建表迁移;付款类表 `payment_subcategories` 已有“重建表剥离旧列”先例,见 db.js:1140-1141)。

迁移作用于以下字段(保持与付款表 CHECK 风格一致):
- `inventory_imports.available_qty >= 0`,`weighted_avg_cost >= 0`
- `inventory.available_qty >= 0`,`inventory_value >= 0`,在途整数字段 (`in_transit_qty`/`pi_confirmed_unshipped_qty`/`po_unconfirmed_pi_qty`/`after_sales_defective_qty`/`mdf_outbound_qty`) `>= 0`
- `inbound_records.actual_qty/accumulated_qty/uninbound_qty/ci_shipped_qty/expected_qty/abnormal_qty >= 0`
- `commercial_invoice_items.inbound_qty/uninbound_qty/shipped_qty >= 0`

迁移须**幂等**:执行前先查 `PRAGMA table_info` / `PRAGMA foreign_key_list` 或 `sql` 列是否含 `CHECK`,已含则跳过;现存 `actual_qty=-1` 行会使迁移 `INSERT ... SELECT` 失败——迁移脚本须先对脏数据报错并中止(或隔离),由第 7 节治理流程处理,**不可静默跳过**。

> 迁移属 DDL,**本轮不执行**,列入实施阶段(需用户批准并备份后运行)。

### 3.3 校验一致性(P1,建议)

新增统一工具 `validateNonNegativeQty(value, fieldName)`(放 `server.js` 顶部工具区),对数量/金额字段返回 `{ ok, value }`;`bulk-import`(A)、单条 `inbound-records`(B)、`batch-import`(C)三入口统一调用,消除 R6 不一致。本项最小修复不强制包含,但若顺手实现可一并提交。

### 3.4 前端预览校验(P2,可选)

`handleInvFile`(app.js:2254)中 `INV_IMPORT_COLUMNS` 的 `available_qty`(app.js:2215)仅 `format:parseInt`,无符号校验;在 app.js:2283 附近增加 `available_qty < 0` 标红为无效行,使非法行在预览阶段即拦截(后端校验(A)才是硬防线,前端仅为体验)。

---

## 4. 验证与单项测试

> 所有测试须以**只读/隔离副本**进行,严禁在生产库执行写入型测试;本轮不跑任何测试(见第 8 节)。以下为实施阶段的测试清单。

**4.1 接口层负数用例(重点)**
- `POST /api/inventory-imports/bulk-import` 提交 `available_qty = -5 / -1 / abc / 0`:
  - 负数与 `abc`(NaN)应进 `failed` 计数并返回 `errors`,不写入 `inventory_imports` 与 `inventory`;
  - `refreshInventoryTotals` 后断言 `inventory.available_qty` 未被污染(读隔离副本)。
- `POST /api/inbound-records` 提交 `actual_qty = -1`:预期 **400** 拒绝(修复前为 200 写入,系缺陷)。
- `POST /api/inbound-records/batch-import` 提交含 `actual_qty=-1` 的混合批次:预期该行进 `failed`,其余成功(沿用现有行为并补断言)。

**4.2 边界用例**
- `available_qty = 0` / `actual_qty = 0`:属合法零值,**不应被拦截**(注意用 `|| 0` 会在 `0` 与 `NaN` 时都落 0,但校验应区分“显式 0 合法”与“缺失/负数非法”)。
- `actual_qty` 为非整数(如 `2.5`):`parseInt` 截断为 2,按非负整数规则通过(与 batch-import 现有语义一致,不新增规则)。

**4.3 DB 层兜底用例(迁移后)**
- 在隔离副本直接 `UPDATE inventory SET available_qty = -1`:预期被 SQLite CHECK 拒绝(验证兜底生效)。

**4.4 批量逐行失败回滚场景**
- `bulk-import` 提交“1 行负数 + 1 行合法”批次:断言负数行 `failed`、合法行正常 `created`,且负数未出现在 `inventory` 中;失败明细(reason)完整返回前端。
- (R4 现状:逐行吞异常不整体回滚,本项保持该行为,仅确保“校验失败行不写库”。)

**4.5 脏数据清理验证(仅在第 7 节批准后)**
- 修正 `actual_qty=-1` 后,校验 `commercial_invoice_items.inbound_qty/uninbound_qty` 与 CI 状态恢复一致;重算 `updateInventoryTransitData` 后在途统计正确。

---

## 5. 回归影响

**可能受影响的功能 / 需回归范围**:
- 库存导入全流程:`inventory-imports/bulk-import` → `refreshInventoryTotals` → `inventory` 总表(数量、WAC、金额)。回归点:合法正数导入、零库存(`available_qty=0`)、批量混合合法批次。
- 入库单录入:`inbound-records` 单条与批量 → `commercial_invoice_items` 累计/未入库数、CI 完成状态(`completed`/`partial_inbound`)、在途统计(`updateInventoryTransitData`)。
- 前端:`handleInvFile` 库存导入预览、`app.js:6066` 单条入库提交已有 `if(q>0)` 拦截(兼容,无冲突)。
- 下游展示:补货建议、周转、成本、库存金额报表均依赖 `inventory.available_qty >= 0`,加固后无负输入,输出更安全。

**不回归**:付款/成本分摊链路(`allocateCosts` 等)、出库链路、DB 其他无关表。

---

## 6. 完成即停原则

- 本项交付物为“接口校验(A/B)+ DB 迁移(3.2)+ 一致性(3.3 可选)”三处最小改动,经第 4 节测试通过后即**视为完成并停止**。
- 不自动顺延到脏数据清理(第 7 节)、不自动顺延到事务回滚策略(R4)、不自动顺延到前端 P2 校验。
- 进入下一项(包括第 7 节数据清理)**须经用户明确批准**。

---

## 7. 数据清理(须批准,本轮不执行)

现存脏数据(读库实证):
- `inbound_records`:`id=inbound_1783998263598_ds7333`,`actual_qty=-1`、`accumulated_qty=-1`、`uninbound_qty=1`,`sku_code=RDM731`,`inbound_no=IN-2026-263598`。

清理步骤(需用户批准 + 备份后,在单独实施任务执行):
1. 定位该记录影响的 `commercial_invoice_items` 行(`source_ci_id` 关联),核查 `inbound_qty`/`uninbound_qty` 是否被反向扣减。
2. 依据业务确认该入库真实数量(如应为 1 或 0),修正 `inbound_records.actual_qty/accumulated_qty/uninbound_qty`。
3. 重算对应 CI 明细 `inbound_qty = 原值 - (-1) + 真实值`、回写 `uninbound_qty`,并据 `shipped_qty` 重新判定 CI 状态。
4. 重跑 `updateInventoryTransitData()` 校对在途。
5. 清理完成后再运行第 3.2 节 DB 迁移(此时已无负行,迁移可顺利 `INSERT ... SELECT`)。

**本轮严禁执行上述任何写入操作。**

---

## 8. 明确本轮零修改

- 本文档为**实施方案(仅文档)**,遵循只读边界:仅阅读 `server.js` / `db.js` / `app.js` 源码,及使用 `better-sqlite3` 以 `{ readonly: true }` 对 `./data/inventory.db` 抽样(临时脚本已删除)。
- **未执行任何 DDL、未运行写入型测试、未修改任何代码/数据库/接口/页面/测试数据/日志/报告/`MEMORY.md`。**
- **唯一新建文件**即本文档:`P1-INBOUND-01-实施方案.md`。
- 第 3、4、7 节的改动与迁移**均为设计描述,本轮不予实施**;DB CHECK 迁移与脏数据清理须在后续经批准的单独任务中执行。
