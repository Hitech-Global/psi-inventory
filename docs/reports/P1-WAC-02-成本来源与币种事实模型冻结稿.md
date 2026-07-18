# P1-WAC-02 成本来源与币种事实模型冻结稿

> 本文件为 P1-WAC-02 任务交付物（只读排查 + 冻结稿）。P1-WAC-01 / R1 / R2 / R3 至此关闭。
> 本轮**未修改**任何代码 / 数据库 / 接口 / 页面 / 测试数据 / 日志 / MEMORY.md / 原报告 / R1-R3。
> 本稿仅冻结事实模型与设计边界，**不进入实施**；须全部冻结并经批准后，方可启动 P1-WAC-03 及后续实施。

---

## 0. 对 R3 的两处更正（本稿为最新权威冻结，覆盖 R3 对应表述）

1. **汇率快照存储结构不得预先定为字段方案**（更正 R3 §3.4 / §3.5）
   - 接受业务关系：一条 `wac_history` 可关联多笔成本来源、每笔成本来源可关联各自汇率快照。
   - **但不得预先冻结为** `snapshot_ids` 数组 / JSON 列 / 逗号分隔 ID / 单字段多 ID。
   - 本稿仅冻结**能力要求**：① 一条 wac_history 可追溯到多笔成本来源；② 每笔成本来源可追溯到对应汇率快照；③ 数据库可建外键、唯一约束、防重复约束；④ 支持按 WAC 版本 / 成本来源 / 快照独立查询与审计。
   - 具体采用关联表、成本换算证据表或其他规范化结构，**留至 P1-WAC-04 与 P1-WAC-07 设计**，本稿不决定。

2. **Vietnam / China 范围更正**（更正 R3 §3.2 的"待裁断/显式排除"表述）
   - 按最新业务裁断，Vietnam 与 China **不纳入本轮库存 WAC 范围**（非"永久排除"，也非"当前待裁断"）。
   - 详见 §8。后续如遇未纳入范围国家，成本确认**阻断**并提示"当前国家未纳入 WAC 业务范围"。

---

## 1. 业务范围冻结（库存 WAC 国家范围）

本轮库存 WAC 国家范围**仅限**：

| 国家 | country_id | code | 本国货币 |
|---|---|---|---|
| 印度尼西亚 | country_id | ID | IDR |
| 马来西亚 | country_my | MY | MYR |
| 泰国 | country_th | TH | THB |

**边界（来自业务裁断）**：
1. Vietnam 不参与本轮 WAC；China 不参与本轮 WAC。
2. 不配置 VND 或中国库存 RMB 的 WAC 映射。
3. 不设计越南 / 中国库存的成本换算、WAC、库存价值或 ERP 投影。
4. 不做越南 / 中国库存相关历史数据迁移。
5. 不为越南 / 中国库存预留复杂兼容模型。
6. `warehouses` 表即使存在 Vietnam / China 仓库记录（实际仅出现在 `inventory.warehouse` 自由文本，见 §4），也**不得据此推断当前存在对应库存业务**。
7. 当前 WAC 只允许处理归属于印度尼西亚 / 马来西亚 / 泰国的库存仓库。
8. 成本确认遇未纳入范围国家 → **阻断**并提示"**当前国家未纳入 WAC 业务范围**"，不得静默使用 USD / RMB 或其他默认币种。
9. 未来若开展越南 / 中国库存业务，作为独立项目新增，不影响当前冻结模型。

---

## 2. 国家主数据现状（只读事实）

- `countries` 表：主键 `id`（TEXT）；列 `id / name / code / default_currency / status / sort_order / created_at`。
- 当前仅 3 行，全部 `status='active'`，且全部在 WAC 范围内：

| id | name | code | default_currency |
|---|---|---|---|
| country_id | 印度尼西亚 | ID | IDR |
| country_my | 马来西亚 | MY | MYR |
| country_th | 泰国 | TH | THB |

- **结论**：`countries.id` 是稳定国家键；`default_currency` 已正确配置为 IDR/MYR/THB；Vietnam/China **不在** `countries` 主数据中（故其"仓库"记录仅以自由文本散落于 `inventory.warehouse`，不具国家主数据身份）。

---

## 3. 国家别名冲突矩阵（只读事实）

当前各表实际出现的国家文本表达：

| 规范国 | countries.name | 其他文本变体（实测） | 是否在 alias 映射 | 当前可否解析到本币 |
|---|---|---|---|---|
| 印度尼西亚 | 印度尼西亚 | 印尼、印度尼西亚共和国、Indonesia | 仅"印尼/印度尼西亚共和国"在 `COUNTRY_ALIAS_MAP`，但**映射方向错误**（long→short，而查找表按键为 long） | 仅"印度尼西亚"可直接解析；"印尼/印度尼西亚共和国/Indonesia"**无法解析** |
| 马来西亚 | 马来西亚 | 马来、马来西亚联邦、Malaysia | 同上方向错误 | 仅"马来西亚"可解析 |
| 泰国 | 泰国 | 泰王国、Thailand | 同上方向错误 | 仅"泰国"可解析 |
| （范围外）中国 | — | 中国、China | 无 | 不可（且不在范围） |
| （范围外）越南 | — | Vietnam | 无 | 不可（且不在范围） |

- **代码事实（server.js:432-442）**：`COUNTRY_ALIAS_MAP` 将 `印度尼西亚→印尼`、`马来西亚→马来`、`泰王国→泰国`；但 `countryToCurrency` 以 `countries.name`（长中文）为键。别名目标（短名）与查找键（长名）**不匹配**，导致别名分支实际失效；英文与中短名均无覆盖。
- **结论**：当前国家文本表达至少存在**三套并存**（长中文 / 短中文 / 英文），且别名解析逻辑方向错误、覆盖不全。必须以 `country_id` 替代文本作为正式关联键。

---

## 4. country_id 与文本 country 的使用位置（只读事实）

| 表 | 是否有 country_id | 国家表达字段 | 实测 |
|---|---|---|---|
| countries | 是（主键 id） | id / name / code | 稳定键存在 |
| warehouses | **有列但全部为空** | country_name（文本） | 3 行 country_id 均为 `''`；仅 country_name 有值（印度尼西亚/泰国/马来西亚） |
| inventory | **无 country_id 列** | country（文本） | 混用 印度尼西亚(391)/Indonesia(2)/Malaysia(1)/Thailand(1)/Vietnam(1)/中国(2)；3 行空 |
| commercial_invoices | **无 country_id 列** | country（文本）+ target_warehouse（文本） | 混用 印尼(14)/中国(21)/印度尼西亚(1)/Indonesia(1)/Malaysia(1)；10 行空 |
| cost_allocations | 无 | 仅 currency | 无国家/仓库维度（单 CI 内推导） |
| wac_history | 无 | country + warehouse（文本） | 已具国家/仓库维度 |
| original_inventory_imports | 无 | country + warehouse（文本） | 已具国家/仓库维度 |
| logistics_batches | 无 | target_country + target_warehouse + freight_currency | 已具目标国家/仓库 |

- **关键发现**：
  - `warehouses.country_id` **全部为空** → 仓库→国家当前靠 `country_name` 文本，且未规范化。
  - `inventory.warehouse` 含自由文本 `Hanoi-WH`(Vietnam)、`深圳仓`(China)、`Jakarta-WH`/`Kuala-Lumpur-WH`/`Bangkok-WH` 等，**其中多个不在 `warehouses` 主表**（主表仅 3 行：至速仓×2、Bekasi Warehouse）→ 属孤儿引用，按 §1 边界不得视为有效库存业务。
  - `commercial_invoices.country=中国` 出现 21 次，属**采购/供应商端来源国**，不代表中国库存；库存 WAC 国家须由 `target_warehouse` 推导（见 §6）。

---

## 5. 仓库→国家→本币唯一事实链（冻结目标链）

**当前（脆弱）链**：
`warehouse.country_name`（文本，未规范化） →（需别名解析，且解析逻辑有误）→ `countries.name` → `default_currency`

**冻结目标链（实施后）**：
`目标仓库.id` → `warehouses.country_id`（须回填，当前空）→ `countries.id` → `default_currency`（唯一本币）

- 仓库必须通过 `country_id` 归属唯一国家（规则 11）。
- 国家确定后本币自动唯一（规则 12），无人工选币。
- **本轮不回填** `warehouses.country_id`（只读冻结）；回填列入实施任务（P1-WAC-04 / 实施），须基于 `country_name`→`countries.id` 规范化映射，且不得改写历史文本（仅新增/补全 `country_id`）。

---

## 6. CI 国家 / 目标仓库国家 / 库存国家 冲突处理原则

- **库存 WAC 国家以"目标仓库国家"为唯一事实锚点**（规则 11 + 仓库→国家链）。
- `commercial_invoices.country` 表达**采购/来源国**（可为中国等），**不得用于决定库存 WAC 本币**。
- `inventory.country`（ERP 导入时写入）应等于目标仓库国家；若导入时 `inventory.country` 与目标仓库国家不一致，**必须阻断**，不得静默选择其中一个。
- `logistics_batches.target_country / target_warehouse` 已具目标维度，费用换算以此为准。
- 统一流程（冻结）：
  ```
  目标仓库 → 唯一库存国家(country_id) → 唯一本国货币
  → 每笔成本按冻结规则换算为本币
  → 同一国家内部按 SKU / 仓库分摊
  → 计算本币 WAC → 锁定 wac_history
  → ERP 最新库存导入时再投影 inventory 三字段
  ```

---

## 7. 未配置本币国家的阻断规则

- 成本确认时，先由目标仓库解析 `country_id`：
  - 若 `country_id` ∉ {country_id, country_my, country_th}（含 Vietnam / China / 空 / 无法解析）→ **阻断**，返回明确错误"**当前国家未纳入 WAC 业务范围**"。
  - **禁止**静默回退到 USD / RMB / 系统默认币种。
  - **禁止**因 `commercial_invoices.country` 为中国而误判为库存国家（来源国≠库存国）。
- 该阻断为成本确认前置校验，列入实施设计（非本轮实现）。

---

## 8. Vietnam / China 排除（非待裁断）

- Vietnam、China **不纳入本轮库存 WAC**（§1）。
- `warehouses` 主表不含 Vietnam/China；`inventory.warehouse` 自由文本中的 `Hanoi-WH` / `深圳仓` 等属孤儿引用，**不推断**为有效库存业务。
- 不为二者设计本币映射、成本换算、WAC、库存价值、ERP 投影、历史迁移或兼容预留。
- 未来若开展其库存业务，作为独立项目新增，不影响当前冻结模型。
- 因此 Vietnam/China **不是"当前待裁断项"**，而是"本轮范围外、未来独立立项"。

---

## 9. 禁止使用文本国家名称作为长期正式关联键

- 国家身份最终使用稳定 `country_id`（规范键）。
- `country_name` 仅用于展示。
- 别名（印尼/印度尼西亚/Indonesia 等）仅用于**输入解析**，不作为正式关联键、不作为 JOIN 键。
- 仓库必须通过 `country_id` 归属国家；CI 目标仓库与库存国家必须一致；三者冲突以目标仓库国家为准并阻断（§6）。
- 历史文本国家字段保留兼容，但**不得自动改写历史数据**（仅可新增 `country_id` 补全）。

---

## 10. 成本来源与币种事实模型（单国家内）

在单一 CI → 单一目标仓库 → 单一国家 → 单一本币前提下，成本来源与币种事实模型如下（详细逐类锚点/rate_type 见 R1 §二，待 P1-WAC-03 冻结）：

- **每笔成本来源须记录**：原币（original_currency）、冻结锚点日期（按成本类型，P1-WAC-03）、rate_type、原币金额。
- **每笔成本来源独立换算**为目标国本币（独立汇率快照，结构留 P1-WAC-04/07）。
- **汇率快照仍须按每笔成本来源独立锁定**：不同费用可能原币/付款日/rate_type/rate_source 不同（R2 §2.4）。
- **本币成本汇总**后，在同一国家内部按 SKU / 仓库分摊（R2 §2.6；先换算后分摊，R1 §四）。
- **当前未进入分摊的费用**（R1 已列）：清关费 / 港杂费 / 派送费 / 其他本地费（落 `logistics_batches.other_fees`/`vat_gst`）、抵扣 / 定金 / 尾款 —— 其原币与进入规则须在 P1-WAC-03 明确。
- **禁止**：原币金额直接进入 WAC 公式（原报告核心缺陷）；不同币种混算；USD/RMB 单位成本与本币 WAC 直接相加。

---

## 11. 后续任务与停止声明

- 本稿（P1-WAC-02）已完成并冻结：国家主数据、别名冲突矩阵、country_id/文本使用位置、仓库→国家→本币事实链、冲突处理原则、未配置本币阻断规则、Vietnam/China 排除、禁止文本国家键、单国内成本来源模型。
- **下一任务为 P1-WAC-03**（各成本类型汇率锚点与 rate_type 映射冻结），**本轮不进入**。
- 全部 P1-WAC-02~09 冻结并经批准后，方可启动实施。
- 本轮未修改任何文件 / 数据库 / 接口 / 页面 / 测试数据 / 日志 / MEMORY.md。

> P1-WAC-02 成本来源与币种事实模型冻结稿完。
