# P1-ORIINV-01 原库存导入 DELETE-first 数据丢失风险只读排查报告

- **任务编号**:P1-ORIINV-01
- **任务名称**:《原库存导入 DELETE-first 数据丢失风险只读排查》
- **排查性质**:纯只读(static 代码审计 + 只读 DB 查询,零写入)
- **工作目录**:`/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app`
- **排查时间**:2026-07-14
- **结论等级**:**高危**(存在确定性的数据丢失窗口,且当前实现无法在失败时回滚已删除的旧数据)

---

## 1. 当前代码事实(导入路由、DELETE/INSERT 顺序、事务包裹情况、行号)

**目标路由**:`POST /api/original-inventory/import`
**文件/行号**:`server.js:4629`(路由入口) ~ `server.js:4683`(路由结束)

关键代码顺序(行号精确):

| 行号 | 代码片段 | 说明 |
|---|---|---|
| 4629 | `app.post('/api/original-inventory/import', requireApiPermission('cost_view'), (req, res) => {` | 路由定义,权限 `cost_view` |
| 4630 | `try {` | 外层 try(捕获后返回 500) |
| 4631 | `const { ci_id, items } = req.body;` | 取参;**若 `items` 为 undefined,4636 行 `items.length` 抛错 → 500,且发生在事务之前** |
| 4632-4634 | `if (!ci_id) …; const ci = …; if (!ci) …` | **事务外预检**:仅校验 `ci_id` 必填、CI 是否存在 |
| 4636 | `const result = { success:0, failed:0, total: items.length, errors:[] };` | 构造返回体 |
| **4637** | `transaction(() => {` | **事务开始**(better-sqlite3 `d.transaction(fn)()`,不抛错则提交,抛错则回滚) |
| **4639** | `run('DELETE FROM original_inventory_imports WHERE ci_id = ?', [ci_id]);` | **DELETE 旧数据 —— 位于事务内、位于校验之前(DELETE-first)** |
| 4641 | `items.forEach((item, i) => {` | 逐行处理 |
| 4642 | `try {` | **每行独立 try(异常被吞)** |
| 4643-4647 | 读取 `sku_code / original_qty / country / warehouse / remark` | 字段解析 |
| 4649 | `if (!skuCode) { result.failed++; …; return; }` | 校验1:SKU 空 → **仅计数,继续,不抛错、不回滚** |
| 4652-4653 | `if (!sku) { … return; }` | 校验2:SKU 不存在 → 仅计数 |
| 4656-4657 | `if (!ciItem) { … return; }` | 校验3:SKU 不属于该 CI 明细 → 仅计数 |
| 4660 | `if (origQty < 0) { … return; }` | 校验4:数量为负 → 仅计数 |
| 4662-4663 | `run('INSERT INTO original_inventory_imports (…) VALUES (…)', […])` | **逐行 INSERT**(事务内) |
| 4664 | `result.success++;` | 成功计数 |
| 4665 | `} catch (e) { result.failed++; result.errors.push(…); }` | **捕获所有异常并吞掉(含 INSERT 抛错)** |
| 4666 | `});` | forEach 结束 |
| 4668-4671 | 查询 CI 明细 / 已导入 SKU,计算 `missingSkus` | 后置完整性检查 |
| 4673-4674 | `run('UPDATE commercial_invoices SET original_inventory_imported = ? …', …)` | 标记 CI 导入状态 |
| 4676-4678 | 拼装 `result.warnings` | 部分缺失告警 |
| **4679** | `});` | **事务结束**:`fn` 未抛错 → **提交**(DELETE 与已成功的 INSERT 一并落库) |
| 4681 | `res.json(result);` | 返回结果(即使有失败行也返回 200 + result) |
| 4682 | `} catch (e) { res.status(500).json({ error: e.message }); }` | 外层 catch |

**事务定义事实**(`db.js:59-62`):
```js
function transaction(fn) {
  const d = getDB();
  return d.transaction(fn)();   // better-sqlite3 语义:fn 正常返回→提交;fn 抛错→回滚
}
```

**关键结论(事实层面)**:
1. DELETE(4639)与 INSERT(4662)**确实在同一事务内**(4637-4679)。
2. 但 DELETE 发生在**逐行校验之前**(DELETE-first);校验失败与 INSERT 异常均被**逐行 `try/catch`(4642-4665)吞掉**,不会向上抛到事务回调。
3. 因此事务回调几乎**总是正常返回并提交** → 已执行的 DELETE **必然提交**,而失败/非法的行不被插入。
4. 校验发生在**删除之后、插入之中**(post-delete, in-loop),**不是删除前的整体预校验**。

---

## 2. 当前数据库事实(original_inventory_imports 结构、样本、当前行数)

**表结构**(`db.js:1471-1484`,`CREATE TABLE IF NOT EXISTS original_inventory_imports`):

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PRIMARY KEY | 主键(`genId('ori')` 生成) |
| ci_id | TEXT | DEFAULT '' | 关联商业发票 |
| ci_no | TEXT | DEFAULT '' | CI 号(冗余) |
| po_no | TEXT | DEFAULT '' | PO 号(冗余) |
| sku_code | TEXT | **NOT NULL** | SKU |
| country | TEXT | DEFAULT '' | 国家 |
| warehouse | TEXT | DEFAULT '' | 仓库 |
| original_qty | REAL | DEFAULT 0 | 原库存数量 |
| remark | TEXT | DEFAULT '' | 备注 |
| imported_at | TEXT | DEFAULT datetime('now') | 导入时间 |

索引:`idx_orig_inv_ci(ci_id)`(db.js:1536)、`idx_orig_inv_sku(sku_code)`(db.js:1537)。**无唯一约束**(如 `(ci_id, sku_code)` 无 UNIQUE 索引)。

**当前数据(只读查询,`readonly:true` 临时脚本,运行后已删除)**:
- 总行数:**7 行**
- 跨 ci_id 分布(5 个 CI):`ci_1783314304883_jximb7`(2)、`ci_1784004228741_lj5j6i`(2)、`ci_1783314304914_tyo9mn`(1)、`ci_1783996885092_xs7th0`(1)、`ci_1784004228741_lblfy1`(1)
- 样本(前 5 行):`TEST-PHASE3-001/002`(中国/深圳仓)、`RDM731`(印度尼西亚/Bekasi Warehouse, original_qty=111)、`P103B-TEST-SKU-001`(Indonesia/Jakarta-WH)等
- `original_qty` 负值:**0**;零/空值:**0**(当前数据健康,但属测试/样例数据,无生产量级验证)
- `commercial_invoices.original_inventory_imported` 列:**存在**(db.js 迁移补齐)
- `wac_history` 表:**存在**(含 `is_locked` 等字段)

**重要观察**:当前库仅有 7 行样例/测试数据,无法用真实生产量级复现,但代码路径风险是确定性的,与数据量无关。

---

## 3. 完整调用链(触发导入 → 删旧 → 校验 → 插新 → 失败路径)

```
前端/接口调用 POST /api/original-inventory/import { ci_id, items:[...] }
  │
  ├─(事务外) 权限校验 cost_view                       [server.js:4629]
  ├─(事务外) ci_id 必填校验 → 缺则 400 返回            [4632]
  ├─(事务外) CI 存在校验 → 缺则 400 返回              [4633-4634]
  │   ⚠ 注意:此处只校验 ci_id / CI 是否存在,
  │          不校验 items 内容合法性、不校验 items.length
  │
  └─ 进入 transaction 回调 [4637]
        │
        ├─ A. DELETE FROM original_inventory_imports WHERE ci_id=?  [4639]
        │      → 该 CI 全部旧"原库存导入"被物理删除(仍在事务内,WAL 未提交)
        │
        ├─ B. items.forEach 逐行 [4641]
        │      └─ try [4642]
        │           ├─ 解析字段 [4643-4647]
        │           ├─ 校验 SKU 非空 [4649] → 失败:failed++、return(继续下一行)
        │           ├─ 校验 SKU 存在 [4652] → 失败:failed++、return
        │           ├─ 校验 SKU 属该 CI [4656] → 失败:failed++、return
        │           ├─ 校验 qty≥0 [4660] → 失败:failed++、return
        │           └─ INSERT 新行 [4662] → 若抛错:被 catch 吞掉 [4665]
        │
        ├─ C. 后置完整性检查 + UPDATE commercial_invoices.original_inventory_imported [4668-4674]
        ├─ D. 拼装 warnings [4676-4678]
        │
        └─ 回调正常返回 → 事务【提交】 [4679]
              → DELETE 永久生效,仅成功行落库;失败行不复存在
  │
  └─ res.json(result) 返回 200 + {success, failed, errors, warnings} [4681]
```

**失败路径矩阵**:

| 失败场景 | 是否触发回滚 | 旧数据命运 | 结果 |
|---|---|---|---|
| 单行 SKU 不合法(空/不存在/不属 CI) | 否(被吞) | 已被 DELETE 提交 | 该行旧数据**永久丢失**;其余成功行保留 |
| 单行 qty 为负 | 否(被吞) | 已被 DELETE 提交 | 该行旧数据**永久丢失** |
| 单行 INSERT 抛错(约束等) | 否(被吞) | 已被 DELETE 提交 | 该行旧数据**永久丢失** |
| **全部行均不合法** | 否(被吞) | 已被 DELETE 提交 | **该 CI 原库存被整体清空(TOTAL LOSS)** |
| 事务内非 forEach 位置抛错(如 4674 UPDATE 异常) | **是** | 随事务回滚 | 旧数据可恢复(但此路径极难触发) |
| 事务外抛错(items 为 undefined 的 4636) | 不涉及 DELETE | 不受影响 | 返回 500,旧数据完好(但属隐性 bug) |

---

## 4. 缺陷或风险(数据丢失窗口、无回滚、部分成功)

**R1(核心·高危)DELETE-first 且校验在删后 → 提交即丢失窗口**
DELETE(4639)在整体校验之前执行。一旦 DELETE 提交(而它会,因为错误被吞),旧数据即不可恢复。这是经典的"先删后插、删完才校验"反模式。提交后若发现新数据非法,旧数据已消失。

**R2(核心·高危)逐行 try/catch 吞掉异常 → 事务原子性被架空**
`transaction` 本可提供"全部成功或全部回滚"的原子保证,但 4642-4665 的逐行 `try/catch` 把所有校验失败与 INSERT 错误就地吞掉,使事务回调永远"正常返回"→ 永远提交。结果:DELETE 必然落库,失败行永远不插回。**事务包裹存在,但回滚机制对业务失败完全失效**。

**R3(部分成功 = 数据丢失)**
批量导入中只要存在任意非法行,该 CI 旧数据被整体删除后,仅合法行被插回。非法行对应的原库存数量**永久消失**(而非"保留旧值")。即"部分成功"对调用方表现为 `failed>0` 但 HTTP 200,用户往往误以为"已保存",实则部分 SKU 原库存归零/缺失。

**R4(全量失败 = 整体清空)**
若一次提交的 `items` 全部不合法(例如模板列名传错、SKU 编码批量错误),DELETE 仍照常执行 → 该 CI 原库存被**整体删除且零插入**,返回 200 + `success:0`。这是最危险的静默全损场景。

**R5(幂等/并发风险)无去重、无锁、最后写入者胜**
- DELETE-first 按 `ci_id` 删除后重插,使**重复单击不会累积重复行**(无重复叠加),但属于"覆盖式"幂等。
- **并发双提交**:两个请求的事务在 SQLite 下串行化,后者在前者的提交结果上再次 DELETE+INSERT → **最后写入者胜**。若后到请求 payload 更不完整(或中途失败),先到请求写入的数据会被后到的 DELETE 抹掉 → 数据丢失。
- 无请求幂等令牌、`ci_id` 无唯一约束(表结构无 `(ci_id,sku_code)` UNIQUE),无法防抖/防重放。

**R6(二次风险)WAC 已确认后仍可重导入,造成成本不一致**
路由未检查 `wac_history` 是否已对该 CI 锁定(`is_locked=1`)/已确认。若 WAC 已确认后再次导入(尤其部分失败场景),`original_inventory_imports` 改变而 `wac_history` 不变 → 加权成本分母与实际原库存脱节,且 `original_inventory_imported` 标记可能误置。属派生风险,标记但不计入本任务主缺陷。

---

## 5. 受影响文件、函数、接口、表和字段

- **文件**:`server.js`(唯一含 `DELETE FROM original_inventory_imports` 的路由;另有只读查询在 4700/4712/4811)、`db.js`(表定义 1471-1484、索引 1536-1537、事务辅助 59-62)
- **函数/路由**:`POST /api/original-inventory/import`(`server.js:4629`),权限 `cost_view`
- **事务辅助**:`transaction`(`db.js:59`),`run`(`db.js:49`)
- **接口契约**:请求体 `{ ci_id:string, items:[{ sku_code|SKU, original_qty|原库存数量, country?, warehouse?, remark? }] }`;响应 `{ success, failed, total, errors, warnings }`(HTTP 始终 200,除非 500)
- **表**:`original_inventory_imports`(被删/插)、`commercial_invoices`(被 UPDATE `original_inventory_imported`,4674)
- **字段**:`original_inventory_imports.id/ci_id/ci_no/po_no/sku_code/country/warehouse/original_qty/remark/imported_at`;`commercial_invoices.original_inventory_imported`
- **衍生影响表**:`wac_history`(R6 成本一致性)
- **不受影响**:其他 `DELETE FROM original_inventory_imports` 出现在 `sanitize-copy.js`、`verify_phase3.js`、`p103c/p103b-test.js` 等脚本/测试中,**非生产路由**,不在本次风险范围内(但均属写入型脚本,不应在生产库运行)。

---

## 6. 最小方案(仅设计,不实施)

> 目标:以最小改动消除"删后校验、删后失败不回滚"的数据丢失窗口。

**方案 M(事务内先全量校验,失败则整体回滚)**:
1. 将逐行校验(4649/4652/4656/4660)从"失败即 `return` 并计数"改为"失败即 `throw`",把 `try/catch` 上移到整个批量之前(或在 `items.forEach` 外先做一次全量预校验循环)。
2. 仅当**所有行均通过校验**后,才执行 4639 的 DELETE + 4662 的 INSERT。
3. 任一校验失败 → 抛出异常 → 事务回滚 → 旧数据完整保留,接口返回 4xx。

该方案**不改变 DELETE-first 的语句顺序**,仅改变"是否允许在 DELETE 之后还提交",从而恢复事务原子性。改动集中在 `server.js:4629-4683` 一个函数内,无需改表结构、无需改 db.js。

---

## 7. 完整方案(同上)

**方案 F(先预校验全部 → 再删 → 再插,且失败全回滚,并加防护)**:
1. **删除前全量预校验(事务外或事务内首段)**:遍历 `items`,逐行校验 SKU 非空/存在/属于该 CI/qty≥0;任一失败立即收集全部错误、返回 400,**完全不执行 DELETE**。
2. **事务内**:DELETE(按 ci_id)→ 逐行 INSERT。若 INSERT(或后续 UPDATE)抛错,异常自然上抛至 `transaction` 回调 → 整段回滚 → 旧数据恢复。
3. **去掉逐行 `try/catch` 吞异常**,或仅用于"预期可恢复的解析"而业务校验失败必须上抛。
4. **接口语义修正**:校验失败返回 HTTP 4xx(而非 200 + `failed` 计数),让前端明确"未保存"。
5. **并发与幂等**:
   - 对 `(ci_id, sku_code)` 增加 UNIQUE 约束(需 db.js 迁移 + 处理历史重复),或导入时用 `INSERT OR REPLACE`;
   - 增加请求幂等令牌 / 前端提交防抖,避免重复双提交;
   - 可选:导入前检查 `wac_history` 是否已锁定该 CI,若已锁定则拒绝重导入(R6)。
6. 可加**软删除/审计**:DELETE 前将旧行快照写入审计表,便于极端情况下的手工恢复(可选增强)。

---

## 8. 推荐方案(同上)

**推荐 = 方案 M(最小)立即落地 + 方案 F 第 1、2、3、4 条作为完整修复**。

理由:
- 最小方案 M 用极小改动即可消除"删后失败不回滚"这一根因,风险最低、可立即上线;
- 完整方案 F 的"删除前全量预校验 + 4xx 语义 + 去掉吞异常"是根治,且不影响现有表结构,向后兼容;
- `(ci_id,sku_code)` UNIQUE 与并发防抖为增强项,建议在 F 落地后下一迭代补;
- 不建议为本次任务引入 DDL(UNIQUE 索引需迁移),保持"纯应用层修复"以最小化回归面。

---

## 9. 实施修改范围(列出需改文件/表/字段/事务,但本轮不做)

| 类别 | 对象 | 改动说明 | 本轮 |
|---|---|---|---|
| 文件 | `server.js` | 重写 `POST /api/original-inventory/import`(4629-4683):现"删除前全量校验 + 失败上抛 + DELETE→INSERT 事务 + 4xx 语义" | **不做** |
| 函数 | 同上路由处理器 | 移除 4642-4665 的吞异常 `try/catch`,或改为校验失败 `throw` | **不做** |
| 语句顺序 | `server.js:4639` | DELETE 维持事务内,但前置于一个"全量校验通过"的 gate | **不做** |
| 接口契约 | 响应码 | 校验失败由 200→4xx;响应体保留 errors | **不做** |
| 表(可选/增强) | `original_inventory_imports` | 增加 `(ci_id, sku_code)` UNIQUE 索引(需 db.js 迁移,注意历史重复数据) | **不做** |
| 表(可选/增强) | 新增审计表 `original_inventory_imports_audit` | 删除前快照,用于极端恢复 | **不做** |
| 辅助 | `db.js` | 仅当引入 UNIQUE 时才需改迁移段;本次纯应用层修复可不动 | **不做** |
| 并发 | 前端/接口 | 幂等令牌、提交防抖、WAC 锁定检查 | **不做** |

> 本轮严格零修改:未改动 `server.js` / `db.js` / `app.js` / `.db` / 任何 `.md` / `.workbuddy`,仅创建本报告文件。

---

## 10. 针对性测试建议

以下为**只读/非写入**的验证思路与(未来实施后的)**写入型测试**建议,本轮不执行任何写入测试:

**A. 静态/只读验证(本轮可做,且已部分完成)**
- 复核 `server.js:4629-4683` 确认 DELETE 在事务内、校验在删后、异常被吞(已完成,见 §1)。
- 只读统计 `original_inventory_imports` 行数/分布(已完成,见 §2),作为回归基线。

**B. 实施后的写入型测试(由实施方在隔离测试库执行)**
1. **全量非法输入测试**:向某 CI 提交全部不合法的 `items`(SKU 不存在)→ 断言:接口返回 4xx、该 CI 旧行数不变(DELETE 被回滚)。
2. **部分非法输入测试**:提交 9 合法 + 1 非法 → 断言:整体回滚或明确不保存,旧数据完整;不得出现"7 行旧数据被删、9 行新数据只插 9 行"的丢失态。
3. **INSERT 约束异常测试**:构造触发 NOT NULL/唯一冲突的 INSERT → 断言事务回滚、旧数据可查。
4. **正常全量测试**:全部合法 → 断言 DELETE+INSERT 生效、`original_inventory_imported=1`。
5. **并发双提交测试**:两个事务同时导入同 `ci_id`,分别带完整/不完整 payload → 断言最终状态一致、无部分丢失、无重复叠加(UNIQUE 生效)。
6. **WAC 锁定守卫测试**(对应 R6):对 `wac_history.is_locked=1` 的 CI 重导入 → 断言被拒绝。
7. **幂等测试**:同一合法 payload 重复提交两次 → 断言结果与单次一致、行数不翻倍。

---

## 11. 明确本轮零修改

- 本报告为**本任务唯一新建文件**,文件名:`P1-ORIINV-01-原库存导入DELETE-first数据丢失风险只读排查.md`。
- 未使用 Edit/Write 修改任何已有文件(含 `.md` / `db.js` / `server.js` / `app.js` / `.db` / `.workbuddy`)。
- 未执行任何 DDL、未运行任何写入型查询或测试。
- 数据库只读查询通过临时脚本(`better-sqlite3` + `{ readonly: true }`)完成,脚本运行后**已删除**,未留痕。
- 所有结论均来自代码静态审计与只读查询,属事实陈述,未对系统状态产生任何影响。

---

**一句话总结**:`POST /api/original-inventory/import` 虽将 DELETE(4639)与 INSERT(4662)包在同一 better-sqlite3 事务内,但因逐行 `try/catch`(4642-4665)吞掉了全部校验失败与 INSERT 异常,事务回调始终"正常返回→提交",DELETE 必然落库而失败行永不被插回——形成"删后校验、删后失败不回滚"的确定性数据丢失窗口:部分非法行导致对应 SKU 原库存永久丢失,全部非法行导致该 CI 原库存被整体清空(静默返回 200),且存在并发双提交最后写入者胜的丢失风险。修复核心是"删除前全量预校验 + 校验失败上抛触发回滚 + 4xx 语义"。
