# P1-ORIINV-01 原库存导入 DELETE-first 数据丢失风险 · 实施方案

- **任务编号**:P1-ORIINV-01
- **任务名称**:修复《原库存导入 DELETE-first 确定性数据丢失窗口》
- **文档性质**:实施方案(仅文档,不实施)
- **工作目录**:`/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app`
- **依据报告**:`P1-ORIINV-01-原库存导入DELETE-first数据丢失风险只读排查.md`
- **优先级**:**P0 数据安全**

---

## 1. 目标与范围

**目标**:消除 `POST /api/original-inventory/import` 中"先删后校验、删后失败不回滚"的确定性数据丢失窗口。

**范围(最小修改原则)**:
- **单任务**:仅修复本缺陷,不扩展任何业务规则、不新增字段含义、不重构其他接口。
- **单文件**:改动集中在 `server.js` 的 `POST /api/original-inventory/import` 路由处理器(`server.js:4629-4683`)一个函数内。
- **不触碰**:`db.js`(表结构、事务辅助 `transaction`/`run` 保持不动)、`app.js`、其他路由、其他脚本;不引入任何 DDL(不加 UNIQUE 索引、不加审计表)。
- **本项完成即停**:修复落地并验证后停止,进入下一项须经用户批准。

**约束**:保持接口请求体契约不变(`{ ci_id, items:[{ sku_code|SKU, original_qty|原库存数量, country?, warehouse?, remark? }] }`)。

---

## 2. 当前事实(关键证据与行号)

依据排查报告 §1/§3/§4,代码事实如下:

1. **DELETE 与 INSERT 同事务**:`transaction(() => {…})` 包裹于 `server.js:4637`,DELETE 在 `:4639`,INSERT 在 `:4662`,事务结束于 `:4679`(`fn` 未抛错则提交)。
2. **DELETE-first(删在校验前)**:`server.js:4639` 的 DELETE 先于逐行校验执行,且位于事务内。
3. **逐行 try/catch 吞异常 → 事务原子性被架空**:`server.js:4642-4665`,每行独立 `try{…}catch(e){ result.failed++; result.errors.push(…) }`,校验失败(4649/4653/4657/4661)仅计数并 `return`,INSERT 异常(4665)被吞。**任何失败都不会向上抛到事务回调** → 回调永远"正常返回" → `transaction` 永远**提交**。
4. **确定性丢失窗口**:DELETE 必然提交,失败/非法的行不被插回。
   - 部分非法行 → 对应 SKU 原库存永久丢失(返回 HTTP 200 + `failed>0`,用户误判为"已保存")(报告 R3)。
   - 全部非法行 → 该 CI 原库存被整体清空(静默返回 200 + `success:0`)(报告 R4,最危险静默全损)。
5. **接口语义缺陷**:校验失败返回 HTTP 200 而非 4xx(`server.js:4681` 始终 `res.json(result)`),调用方无法区分"保存成功"与"部分/全部未保存"。
6. **并发风险**:无 `(ci_id, sku_code)` UNIQUE、无幂等令牌,并发双提交"最后写入者胜",后到者失败/不完整 payload 会抹掉先到者数据(报告 R5)。(属增强项,本次以应用层防护为主,UNIQUE 索引列入后续迭代,本轮不做 DDL。)

> 结论:事务包裹存在,但回滚机制对业务失败完全失效。修复核心是**恢复事务原子性**,而非新增业务规则。

---

## 3. 实施方案(精确改动)

**改动对象**:`server.js` 的 `POST /api/original-inventory/import`(`server.js:4629-4683`),仅此一个函数。

### 3.1 删除前全量预校验(新增,在事务之外 / 事务首段 gate)

在 `server.js:4636` 构造 `result` 之后、`server.js:4637` 进入 `transaction` 之前(或事务内 DELETE 之前),**先遍历 `items` 做一次完整预校验**,任一失败立即以 4xx 返回,**完全不执行 DELETE**:

- 校验项(复用现有逻辑,照搬报告 §1 的 4649/4653/4657/4661):
  1. `skuCode` 非空;
  2. SKU 存在于 `skus`;
  3. SKU 属于该 CI 明细 `commercial_invoice_items`;
  4. `original_qty >= 0`(`parseFloat` 后,注意 `NaN` 也应判为非法)。
- 预校验阶段**收集全部错误**(不 `return` 跳过,而是先穷尽校验再决定),若存在任一错误:`res.status(400).json({ error:'导入数据校验失败', total, failed, errors })`,然后 `return`——此时事务未开启、DELETE 未执行,旧数据零风险。

> 预校验可在事务外完成(纯 `queryOne` 只读查询,不写),更符合"删前先确认"的最小风险设计。

### 3.2 事务内:校验通过后再 DELETE → INSERT,失败上抛回滚

- 预校验全部通过后,才进入 `transaction(() => {…})`。
- `server.js:4639` 的 DELETE 维持事务内、保持 DELETE-first 语句顺序(不动语句顺序,只动"是否允许提交")。
- **移除 `server.js:4642-4665` 的逐行 `try/catch` 吞异常**:改为校验失败即 `throw`(或预校验已保证通过,事务内仅保留 INSERT)。若 INSERT 抛错(约束、唯一冲突等),异常**自然上抛**至 `transaction` 回调 → 整段回滚 → 旧数据自动恢复。
- `server.js:4673-4674` 的 `UPDATE commercial_invoices SET original_inventory_imported` 维持,若抛错同样上抛回滚。
- `server.js:4679` 事务结束:仅当全部成功才提交;任何非空/约束异常 → 回滚。

### 3.3 接口语义修正(4xx)

- 校验失败 / 预校验未通过 → HTTP `400`,响应体保留 `total/failed/errors`(便于前端展示具体行错误)。
- 仅当全量成功 → HTTP `200` + `result`。
- 事务内意外异常 → 维持外层 `catch` 返回 `500`(`server.js:4682`)。

### 3.4 校验增强(NaN 处理,属最小必要)

- `parseFloat(item.original_qty || …)` 结果若为 `NaN`,按"数量为负/非法"处理,在预校验阶段判失败(避免 `NaN` 入库或漏校验)。

### 3.5 不改部分(明确边界)

- **不改** `db.js` 表结构、`transaction`/`run`/`queryOne` 辅助函数。
- **不引入** `(ci_id, sku_code)` UNIQUE 索引 / 审计表 / 幂等令牌(报告 R5/R6 增强项,列为后续迭代,本轮不做 DDL)。
- **不改变** 请求体契约、字段名、响应字段名。

---

## 4. 验证与单项测试

> 以下测试由实施方在**隔离测试库**(非生产库)执行;本轮零执行。

**单元测试 / 集成测试要点**(针对 `POST /api/original-inventory/import`):

1. **全量非法输入(对应 R4/静默全损)**:向某 CI 提交全部 SKU 不存在的 `items` → 断言:**返回 400**、该 CI 旧行数**不变**(DELETE 未执行或被回滚)、`commercial_invoices.original_inventory_imported` 不被误置。
2. **部分非法输入(对应 R3)**:提交 9 合法 + 1 非法 → 断言:整体**不保存**(旧数据完整,行数不变),或明确 400 拒绝;不得出现"旧 7 行被删、仅 9 行新数据落库"的丢失态。
3. **INSERT 约束异常**:构造触发 NOT NULL / 唯一冲突的 INSERT → 断言事务**回滚**、旧数据可查、`original_inventory_imported` 不翻转。
4. **正常全量(基线)**:全部合法 → 断言 DELETE+INSERT 生效、目标 CI 行数=items 数、`original_inventory_imported=1`。
5. **并发双提交(对应 R5)**:两个事务同时导入同 `ci_id`,分别带完整 / 不完整 payload → 断言最终状态一致、无部分丢失、无重复叠加(本次不依赖 UNIQUE,需验证"最后写入者"不会留下中间态;若引入 `INSERT OR REPLACE` 则校验无重复行)。
6. **WAC 锁定守卫(对应 R6,可选增强)**:对 `wac_history.is_locked=1` 的 CI 重导入 → 断言被拒绝(建议本轮一并加 minimal 守卫:`queryOne` 检查 `wac_history` 锁定后返回 400;如用户不同意则留作后续)。
7. **NaN/负数数量**:`original_qty` 为非法字符串或负数 → 预校验阶段 400 拒绝。

**只读回归基线(已建立)**:当前 `original_inventory_imports` 共 7 行,分布于 5 个 CI(报告 §2);测试前快照行数,测试后比对,确保无污染。

---

## 5. 回归影响

- **直接影响功能**:原库存数量导入功能(`POST /api/original-inventory/import`),前端导入交互(需同步:校验失败改判 4xx 而非"success+failed")。
- **关联功能**:
  - 加权平均成本(WAC)计算依赖 `original_inventory_imports` 与 `original_inventory_imported` 标记 → 修复后"部分丢失"消失,成本分母更准确(正向修复)。
  - CI 列表 / 详情页展示 `original_inventory_imported` 状态(`:4674` 写入)→ 行为不变,仅不再被非法状态翻转。
- **需回归范围**:
  1. 原库存导入正常流程(模板下载 + 导入 + 状态展示);
  2. WAC 重算路径(确认导入成功后才标记);
  3. 前端导入错误提示(从"failed 计数"改为捕获 4xx 弹错)。
- **不受影响**:`original_inventory_imports` 的只读查询路由(`:4700/4712/4811`)、`db.js`、其他业务模块。

---

## 6. 完成即停原则

- 本项(修复 `POST /api/original-inventory/import` 数据丢失窗口)**完成即停**。
- 完成判据:代码按 §3 改动落地、§4 测试在隔离库全部通过、§5 回归范围确认无污染。
- 进入下一项(如 R5 并发幂等、R6 WAC 锁定守卫、UNIQUE 索引迁移)**须经用户批准**,不在本轮自动展开。

---

## 7. 数据清理(须批准 · 本轮不执行)

> 当前库仅有 7 行样例/测试数据(报告 §2),**无任何污染或生产级风险数据**,无需清理。本节仅占位,供后续若发现真实污染数据时按用户批准执行。

- 若后续发现 `original_inventory_imports` 存在因本次缺陷造成的历史丢失/重复/不一致数据,需:
  1. 先经用户确认与授权;
  2. 在隔离库演练修复 SQL;
  3. 由用户批准后于生产库执行,并保留操作前快照。
- **本轮严禁执行任何清理 / 写入 / DDL**。

---

## 8. 明确本轮零修改

- 本文档 `P1-ORIINV-01-实施方案.md` 为**本轮唯一新建文件**。
- 未使用 Edit/Write 修改任何已有文件(含 `server.js` / `db.js` / `app.js` / `.db` / 任何 `.md` / `.workbuddy`)。
- 未执行任何 DDL、未运行任何写入型查询或测试。
- 所有结论与行号引用均来自只读排查报告与 `server.js` 静态代码复核,未对系统状态产生任何影响。
- 实施方案待用户批准后,方可进入实施阶段。

---

**一句话核心修复**:在 `server.js:4629-4683` 的导入路由中,将逐行校验从"删后吞异常"上移为**删除前全量预校验**,校验失败直接返回 4xx 且**完全不执行 DELETE**;预校验通过后,事务内维持 DELETE→INSERT 但**移除逐行 try/catch 吞异常**,使任何失败自然上抛触发 `transaction` 回滚,从而恢复事务原子性,根除"删后校验、删后失败不回滚"的确定性数据丢失窗口。
