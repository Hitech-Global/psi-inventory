# P1-WAC-06A《本批货物目标仓库事实来源只读核查报告》

- 任务编号:P1-WAC-06A
- 任务名称:本批货物目标仓库事实来源只读核查
- 工作目录:/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app
- 数据库:./data/inventory.db(WAL,以 `better-sqlite3` **readonly:true** 连接只读查询)
- 技术栈:Node.js + Express + better-sqlite3
- 核查性质:**纯只读**。未执行任何 DDL / 写入 / 写入型测试;本报告为唯一新建文件。
- 关联任务:P1-WAC-06(本币换算/成本分摊/精度与尾差规则冻结稿)——本任务不冻结规则,仅列事实、冲突、候选事实源与待裁断项。

---

## 0. 四类仓库事实层 —— 先行厘清(全报告基准)

| 层 | 字段 / 表 | 语义 | 谁填 | 是否本批入仓事实 |
|---|---|---|---|---|
| ① 计划目标仓库 | `commercial_invoices.target_warehouse`(db.js:704)、`packing_lists.target_warehouse`(db.js:759) | 下单/计划要去的仓库(文案名) | 用户在 CI/PL 表单选(自由文本) | 否(计划) |
| ② 物流目的仓库 | `logistics_batches.target_warehouse`(db.js:804)+`target_country`(db.js:803) | 物流批次计划送达仓库 | 物流批次表单 | 否(物流计划) |
| ③ 实际入库仓库 | `inbound_records.warehouse`(db.js:845)+`country`(db.js:844) | 货物真实入仓的仓库 | 入库单人工录入 | **是(本批入仓事实)** |
| ④ 原库存所在仓库 | `original_inventory_imports.warehouse`(db.js:1479)+`country`(db.js:1478) | **本批到仓前**该 SKU 已存在的旧库存仓库 | 原库存导入(默认=CI.target_warehouse) | **严禁作为本批入仓来源** |
| ⑤ ERP 最新库存仓库 | `inventory_imports.warehouse/country`(db.js:347-348)、`inventory.warehouse/country`(db.js:363-364) | ERP 全量库存快照仓库 | ERP 导入 | 否(ERP 快照,非本批) |

> **硬约束(任务要求)**:`original_inventory_imports`(④)是入仓前旧库存数量,**不得作为本批入仓事实来源**。下文将证明:当前 WAC 成本确认恰恰误用了④的 warehouse/country 作为本批仓库归属,这是核心风险。

---

## 1. 当前代码事实

### 1.1 字段定义(db.js)
- `warehouses`(db.js:120-132):`id`(TEXT PK)、`name`、`country_id`(默认'')、`country_name`(TEXT)、`warehouse_type`、`brands`。**无任何业务表外键指向 `warehouses.id`**;`country_id` 实测全为空(见 §2.4)。
- `commercial_invoices.target_warehouse`(db.js:704):**文案文本字段**,无约束;同一 CI 仅单列(粒度=CI 级,非 SKU 级)。
- `commercial_invoice_items`(db.js:729-742):列仅 `id,ci_id,ci_no,pi_no,sku_code,shipped_qty,unit_price,ci_amount,inbound_qty,uninbound_qty,created_at`。**无 SKU 级仓库字段**。
- `logistics_batches.target_warehouse`(db.js:804)、`target_country`(db.js:803):文案文本。
- `inbound_records.warehouse`(db.js:845)、`country`(db.js:844):文案文本;`source_ci_no`(db.js:841)关联 CI。
- `cost_allocations`(db.js:865-883):列含 `inbound_id,inbound_no,logistics_batch_no,ci_no,sku_code,...,unit_landing_cost,currency`。**无 warehouse / country 列**(实测 `pragma` 计数=0,见 §2.6)。
- `original_inventory_imports`(db.js:1472-1484):`ci_id,ci_no,po_no,sku_code,country,warehouse,original_qty,remark`。
- `wac_history`(db.js:1488-1516):`country,warehouse,original_qty,original_avg_cost,inbound_qty,unit_landing_cost,new_avg_cost...`。
- `inventory_imports`(db.js:343-356)、`inventory`(db.js:360-381):均为 `country,warehouse` 文案文本。

### 1.2 关键函数 / 路由(server.js)
- `COUNTRY_ALIAS_MAP`(server.js:432-436):国家名别名映射(印度尼西亚→印尼 等),用于汇率匹配,属文本匹配。
- CI 创建(server.js:3585-3586):写入 `ci.target_warehouse`(来自请求体)。
- 物流批次创建(server.js:3880-3884):`target_warehouse/target_country` 来自请求体。
- 入库单创建 `POST /api/inbound-records`(server.js:3931-3952):`warehouse` 取自 `d.warehouse`(server.js:3952),`country` 取自 `d.country`,**即人工录入的实际仓库**;无默认回退到 CI 目标仓。入库仅更新单据与 CI 状态,**不再自动改库存数量**(server.js:3954-3957)。
- 原库存导入 `POST /api/original-inventory/import`(server.js:4629-4683):
  - server.js:4645-4646 `country = item.country || item['国家'] || ci.country || ''`,`warehouse = item.warehouse || item['仓库'] || ci.target_warehouse || ''` ——**仓库默认回退到 `ci.target_warehouse`(计划层①),不是实际入仓③**。
  - 写入 `original_inventory_imports`(server.js:4662)。
- 费用分摊 `POST /api/cost-allocation/allocate/:ci_id`(server.js:4728-4786):按 `commercial_invoice_items.shipped_qty` 与商品金额分摊;插入 `cost_allocations` 时 `inbound_id,inbound_no,logistics_batch_no` 均为空(server.js:4774)。**该表不含 warehouse,cost 分摊本身不带仓库维度**。
- WAC 成本确认 `POST /api/cost-allocation/update-weighted-avg/:ci_id`(server.js:4790-4898):
  - server.js:4811 读取 `original_inventory_imports`(含 country/warehouse);
  - server.js:4838 以 `(sku_code, origInv.country, origInv.warehouse)` 查 `inventory` 取旧加权成本;
  - server.js:4865、4883 将 `origInv.country/warehouse` 写入 `wac_history` 与 `cost_update_logs`。**即用④(原库存仓库)作为本批仓库归属**。
- 已废弃 `updateWeightedAvgCost`(server.js:4157-4187):直接写 `inventory/skus`,**全项目已无调用方**(server.js:4150-4151 注释),且其按 `sku_code` 全仓聚合、无仓库过滤,不纳入现行链路。

### 1.3 前端(app.js)
- 仓库下拉:`fw.warehouses.forEach(w=>{o.value=w;o.textContent=w;})`(app.js:2703)——**value=仓库文案名**,非 `warehouses.id`。
- 国家下拉来自 `warehouses.country_name`(app.js:3927、`/api/warehouses/by-country` 按 `country_name` 文本过滤,server.js:234、243)。
- PO/CI 表单提交 `target_warehouse: <select>.value`(app.js:5452、5774)——均为文案名。

---

## 2. 当前数据库事实(只读查询样本)

### 2.1 warehouses 主表(实测 country_id 全空)
```
id=wh_my       name=至速仓    country_name=马来西亚   country_id=''
id=wh_th       name=至速仓    country_name=泰国       country_id=''
id=wh_178...   name=Bekasi Warehouse  country_name=印度尼西亚  country_id=''
```
→ 主表仅 3 行,且 `country_id` 恒为 '';业务表从未引用 `warehouses.id`。

### 2.2 commercial_invoices.target_warehouse 取值分布
```
'' (空)          = 10
印尼仓            = 14
深圳仓            = 21
Bekasi Warehouse = 1
Jakarta-WH       = 1
Kuala-Lumpur-WH  = 1
```
→ 与 `warehouses.name`(至速仓/至速仓/Bekasi Warehouse)对比,**"印尼仓/深圳仓/Jakarta-WH/Kuala-Lumpur-WH" 均不在主表中**(4/5 取值无主表对应)。

### 2.3 logistics_batches.target_warehouse
```
印尼仓 = 3, Bekasi Warehouse = 1
```
→ 与 CI.target_warehouse 文案一致(计划层①≈物流层②,文本同源)。

### 2.4 入库实际仓库 inbound_records.warehouse(实际层③)
```
Bekasi Warehouse = 4, 印尼仓 = 5
```
样本(逐条):
```
IN-2026-040552  CI-2026-040488  国家=印尼  仓库=印尼仓  实收=1000
IN-2026-993506  CI-2026-885093  国家=印度尼西亚 仓库=Bekasi Warehouse 实收=3
...
CI-2026-885093 → 4 条入库,仓库均为 Bekasi Warehouse(同仓分批)
```
→ **当前样本每个 CI 仅落入单一仓库**(CI→distinct warehouse 均=1),但表结构允许一个 CI 多条入库记录分到不同仓(无约束阻止)。

### 2.5 original_inventory_imports(原库存层④,样本)
```
CI-P3-...    TEST-PHASE3-001  国家=中国      仓库=深圳仓
P103B-TEST-CI-001  SKU-001    国家=Indonesia 仓库=Jakarta-WH
P103B-TEST-CI-002  SKU-001    国家=Malaysia  仓库=Kuala-Lumpur-WH
```
→ 仓库/国家均为**自由文本且中英混用**(中国/Indonesia/Malaysia/印度尼西亚),与本批实际入仓③并非同一事实。

### 2.6 cost_allocations 无仓库列
`SELECT COUNT(*) FROM pragma_table_info('cost_allocations') WHERE name IN ('warehouse','country')` → **0**。确认成本分摊记录不携带仓库维度。

### 2.7 wac_history(成本确认产出)样本
```
ci_no=P103B-TEST-CI-001  sku=SKU-001  国家=Indonesia  仓库=Jakarta-WH
ci_no=P103B-TEST-CI-002  sku=SKU-001  国家=Malaysia   仓库=Kuala-Lumpur-WH
```
→ 与 `original_inventory_imports`(④)的国家/仓库一致,证实 WAC 版本按④归属,而非按③(实际入库)。

### 2.8 ERP / inventory 仓库维度
- `inventory_imports` 国家/仓库:`Indonesia/Jakarta-WH`、`Thailand/Bangkok-WH`、`Vietnam/Hanoi-WH`、`印度尼西亚/Bekasi Warehouse`(1169 行)——**中英文国家名并存**。
- `inventory.warehouse` 分布:`Bekasi Warehouse=391`、空=3、`Jakarta-WH/Bangkok-WH/Hanoi-WH/Kuala-Lumpur-WH/深圳仓` 少量。

---

## 3. 完整调用链(各节点读取的仓库字段)

```
① 计划层:  PO.target_warehouse ──(填写)──▶ CI.target_warehouse (db.js:704 / server.js:3586)
                                       └─▶ PL.target_warehouse (db.js:759)
② 物流层:  CI.target_warehouse ──(复制)──▶ logistics_batches.target_warehouse (db.js:804, server.js:3884)
③ 实际层:  入库单人工录入 ──▶ inbound_records.warehouse/country (db.js:845/844, server.js:3952)
                                    │(source_ci_no 关联 CI)
④ 原库存层: 原库存导入 ──▶ original_inventory_imports.warehouse
              [默认= ci.target_warehouse] (server.js:4646, db.js:1479)

成本分摊:  /cost-allocation/allocate  (server.js:4728)
           读: commercial_invoice_items.shipped_qty, ci.goods_amount, ci.currency
           写: cost_allocations (inbound_no 空, 无仓库列)
                              │
WAC 确认:  /cost-allocation/update-weighted-avg (server.js:4790)
           读: ★ original_inventory_imports.country/warehouse (④)  ★  (server.js:4811)
           查: inventory WHERE sku=? AND country=origInv.country AND warehouse=origInv.warehouse (server.js:4838)
           写: wac_history.country/warehouse = origInv (④)  (server.js:4865)
                cost_update_logs.country/warehouse = origInv (④)  (server.js:4883)

库存导入(ERP 快照): inventory_imports.warehouse/country ──▶ inventory.warehouse/country (db.js:347-348,360-364)
```

**链路结论**:本批"实际目标仓库"在 WAC 成本确认环节被**④ original_inventory_imports 覆盖**,而非③ inbound_records。③(实际入库仓库)在系统中存在,但 WAC 确认未读取它。

---

## 4. 缺陷或风险

1. **仓库归属误用(高危)**:WAC 确认(server.js:4811/4838/4865/4883)以 `original_inventory_imports`(④,入仓前旧库存)的 country/warehouse 作为本批仓库归属与 `inventory` 查找键,**违反任务硬约束**(④≠本批入仓③)。正确事实源应为 `inbound_records.warehouse`(③)。
2. **计划仓 vs 实际仓可能不一致**:④ 默认回退到 `ci.target_warehouse`(①,计划),若实际入仓③因分批/改仓与计划不符,WAC 会错配到计划仓,且 `inventory` 按①查找可能命中空/错仓 → `oldAvgCost=0` 或算错加权。
3. **文本匹配脆弱、无稳定外键**:全链路仓库均为自由文案名;无 `warehouse_id`,无 FK;`warehouses.country_id` 恒空;国家名中英混用(印度尼西亚/Indonesia、中国/China)。`COUNTRY_ALIAS_MAP`(server.js:432)仅覆盖汇率,**不覆盖仓库归属**,存在别名未对齐即错配风险。
4. **CI.target_warehouse 与 warehouses 主表大量不一致**:4/5 取值(印尼仓/深圳仓/Jakarta-WH/Kuala-Lumpur-WH)在主表无对应行,无法稳定解析。
5. **CI 级单仓粒度**:`commercial_invoice_items` 无 SKU 级仓库字段(db.js:729-742);若一张 CI 分批进多仓(③ 允许),当前数据模型无法在 CI 明细层表达 SKU→仓库,只能靠多条 `inbound_records` 体现。
6. **country 文本歧义**：④ 中 `Indonesia` 与 `inventory_imports` 中 `印度尼西亚` 并存,`inventory` 查找(server.js:4838)按精确文本相等,跨来源易 miss。

---

## 5. 受影响文件、函数、接口、表和字段

| 类别 | 标识 | 位置 |
|---|---|---|
| 路由 | `POST /api/cost-allocation/update-weighted-avg/:ci_id` | server.js:4790-4898 |
| 路由 | `POST /api/original-inventory/import` | server.js:4629-4683(行4646 默认回退) |
| 路由 | `POST /api/inbound-records` | server.js:3931-3952(实际仓录入) |
| 路由 | `POST /api/cost-allocation/allocate/:ci_id` | server.js:4728-4786 |
| 路由 | `POST /api/logistics-batches` / `PUT` | server.js:3880-3917 |
| 函数 | `COUNTRY_ALIAS_MAP` | server.js:432-436 |
| 表 | `commercial_invoices.target_warehouse` | db.js:704 |
| 表 | `commercial_invoice_items`(无仓库列) | db.js:729-742 |
| 表 | `logistics_batches.target_warehouse/target_country` | db.js:803-804 |
| 表 | `inbound_records.warehouse/country` | db.js:844-845 |
| 表 | `cost_allocations`(无仓库列) | db.js:865-883 |
| 表 | `original_inventory_imports.warehouse/country` | db.js:1478-1479 |
| 表 | `wac_history.country/warehouse` | db.js:1500-1501 |
| 表 | `warehouses`(country_id 空、无 FK) | db.js:120-132 |
| 前端 | 仓库下拉 value=name;国家按 country_name 过滤 | app.js:2703、3927、3945、5452、5774 |

---

## 6. 最小方案(仅设计,不实施)

- **候选事实源裁决**:明确"本批实际目标仓库"的唯一事实源 = **③ `inbound_records.warehouse/country`**(实际入仓),④ `original_inventory_imports` 仅作"入仓前旧库存量/旧成本"输入,**禁止**再作为其仓库归属。
- 不动表结构,仅改代码:`update-weighted-avg` 改为**先按 `inbound_records`(经 ci_no/sku 聚合)取实际仓**,再用该实际仓查 `inventory` 与写 `wac_history`;当一 CI 多仓时分 SKU/仓分别归集。
- 仅做事实厘清与字段语义注释,不引入新表/新列。

## 7. 完整方案(仅设计,不实施)

- 在 `warehouses` 补全 `country_id`(关联 `countries.id`),并在所有业务表引入 `warehouse_id` + `warehouse_name` 冗余(稳定外键 + 可读名),逐步替换自由文案。
- 新增 SKU 级仓库能力:`commercial_invoice_items` 增加可选 `target_warehouse`,`inbound_records` 已有 `warehouse` 作为权威;WAC 以 `inbound_records` 聚合为 `(sku, country, warehouse)` 维度归集。
- `cost_allocations` 增加 `country, warehouse` 列(从 inbound 带入),使成本记录自带仓库维度,避免二次推断。
- 统一国家/仓库命名:用 `COUNTRY_ALIAS_MAP` 思路扩展为双向规范化(入库/导入时即归一化到 `countries.name` / `warehouses.name`),消除中英文混用。
- 明确 `original_inventory_imports` 仅用于"旧库存数量+旧加权成本"输入,其 `country/warehouse` 仅用于定位旧库存行,**不**代表本批入仓。

## 8. 推荐方案(仅设计,不实施)

采用 **"实际入仓层③为唯一事实源 + 稳定 warehouse_id 外键"** 组合:
1. 立即(低风险):修改 `update-weighted-avg`(server.js:4790)改为读取 `inbound_records`(按 ci_no+sku 聚合实际仓),WAC 版本与 `inventory` 查找均用③;`original_inventory_imports` 仍只供旧量/旧成本。单仓 CI 行为不变,多仓 CI 正确分仓。
2. 中期:引入 `warehouse_id` 外键与命名归一化,消除文本匹配风险(对应 §4.3/4.4)。
3. 长期:`cost_allocations` 落 `country/warehouse`,成本与库存维度一致。

> 待用户裁断项:① 是否接受③为唯一事实源;② 一 CI 多仓时 WAC 按 (sku,仓) 拆分还是按主仓;③ 是否启动 warehouse_id 外键迁移。

## 9. 实施修改范围(若未来实施;本轮不做)

- **文件**:server.js、db.js、app.js(仓库下拉与表单)
- **server.js 函数/路由**:
  - `POST /api/cost-allocation/update-weighted-avg/:ci_id`(server.js:4790-4898)——改读 `inbound_records`
  - 新增/复用"按 CI+SKU 聚合实际仓"辅助函数
  - `POST /api/original-inventory/import`(server.js:4646)——保持④仅作旧库存定位,注释澄清语义
  - `allocate`(server.js:4728)与 `cost_allocations` 写入可补 `country/warehouse`
- **db.js 表/列**:
  - `cost_allocations` 增加 `country, warehouse`(db.js:865)
  - `commercial_invoice_items` 可选 `target_warehouse`(db.js:729)
  - `warehouses` 补全 `country_id`(db.js:123)
  - 业务表增加 `warehouse_id`(多表)
- **数据迁移**:历史 `inbound_records`/`wac_history` 仓库文本归一化;补 `warehouses.country_id`
- **app.js**:仓库下拉改为 value=`warehouses.id` 并展示 name;CI/PO 表单提交 `warehouse_id`

## 10. 针对性测试建议

1. **事实源断言测试(只读/单元)**:给定一张 CI,断言 `wac_history.country/warehouse` 等于该 CI 对应 `inbound_records.warehouse/country`(③),而不等于 `original_inventory_imports.warehouse`(④)。
2. **多仓分批用例**:构造一 CI 分两仓入库(两条 `inbound_records`,不同 `warehouse`),验证 WAC 按 (sku,仓) 分别归集、不串仓。
3. **计划≠实际用例**:CI.target_warehouse=印尼仓,实际 inbound.warehouse=Bekasi Warehouse,验证 WAC 以实际仓归属、`inventory` 查找命中实际仓。
4. **别名/中英文用例**:`original_inventory_imports.country='Indonesia'` 时,确认是否仍能正确定位 `inventory`(国家名归一化),不因文本差异导致 `oldAvgCost=0`。
5. **FK 一致性测试**:断言所有业务表 `warehouse` 文本 ∈ `warehouses.name`(暴露 4/5 不一致)。
6. **回归**:确认 `original_inventory_imports` 仍仅影响旧量/旧成本,不污染本批仓库归属。

## 11. 本轮零修改声明

本次核查为**严格只读**:
- 未修改任何代码(server.js / db.js / app.js)、数据库(.db / WAL / SHM)、接口、页面、测试、日志、报告或 `MEMORY.md`;
- 未执行任何 DDL,未运行任何写入型测试;
- 数据库仅以 `new Database('./data/inventory.db', { readonly: true })` 只读连接查询;
- 仅新建本报告文件 `P1-WAC-06A-本批货物目标仓库事实来源只读核查报告.md`;
- 临时只读探针脚本(`_tmp_ro_probe.js`、`_tmp_ro_probe2.js`)查询后已删除,工作区无残留。

> 未冻结任何最终规则;事实、冲突、候选事实源与待用户裁断项均列于 §0/§4/§8。
