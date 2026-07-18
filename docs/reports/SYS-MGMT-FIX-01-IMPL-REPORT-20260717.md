# SYS-MGMT-FIX-01 配置生效修复 · 实施报告

> 日期：2026-07-17
> 性质：收敛实施（仅修读取逻辑，不改业务规则/公式/表结构/RBAC）
> 流程：只读排查 → 架构确认 → 最小实施 → 隔离测试 → 报告

---

## 一、范围（架构确认收敛）

| 项 | 决策 |
|---|---|
| 呆滞阈值（stagnant_*_days） | ✅ 修复读取，让 system_config 生效；保持原分级规则 |
| 付款提醒天数（payment_remind_days） | ✅ 修复读取，作为提醒阈值来源 |
| 30 天展示桶 | 保持固定硬编码，不新增配置键 |
| 慢销阈值 | ❌ 不改，保持 `slow_moving = target_turnover × 2` |
| large_payment_threshold | ❌ 不实现（无对应业务流程） |
| 新增配置项 / 改预测公式 / 改付款流程 / 改审批规则 | ❌ 全部禁止 |

---

## 二、修改内容（server.js，仅 2 处）

### 2.1 呆滞阈值读取（/api/stagnant-analysis，约 7090-7106 行）
原代码硬编码 `180/90/60/30`：
```js
} else if (daysSinceSale >= 180) { stagnantLevel = 'dead'; ... }
else if (daysSinceSale >= 90)  { stagnantLevel = 'heavy'; ... }
else if (daysSinceSale >= 60)  { stagnantLevel = 'medium'; ... }
else if (daysSinceSale >= 30)  { stagnantLevel = 'light'; ... }
```
改为读取 system_config（缺省兜底原值，分级规则与 suggestion 文案完全不变）：
```js
const cDead   = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'stagnant_dead_days'")?.value   || '180', 10);
const cHeavy  = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'stagnant_heavy_days'")?.value  || '90', 10);
const cMedium = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'stagnant_medium_days'")?.value || '60', 10);
const cLight  = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'stagnant_light_days'")?.value  || '30', 10);
...
} else if (daysSinceSale >= cDead)   { stagnantLevel = 'dead'; ... }
else if (daysSinceSale >= cHeavy)    { stagnantLevel = 'heavy'; ... }
else if (daysSinceSale >= cMedium)   { stagnantLevel = 'medium'; ... }
else if (daysSinceSale >= cLight)    { stagnantLevel = 'light'; ... }
```
> 前端仅展示 API 返回的 `stagnant_level`，无独立阈值计算，改 API 即全链路生效。

### 2.2 付款提醒天数读取（/api/finance/payable-cockpit，约 5756-5757 行）
原代码：
```js
const d7 = addDays(today, 7);
const d30 = addDays(today, 30);
```
改为（d7 读配置，d30 固定 30 不动）：
```js
const remindDays = parseInt(queryOne("SELECT value FROM system_config WHERE key = 'payment_remind_days'")?.value || '7', 10);
const d7 = addDays(today, remindDays);
const d30 = addDays(today, 30);
```
> `d7` 仅用于到期桶 `due_7`（原 5827 行 `r.payable_date <= d7`）；`d30` 用于 `due_30`/`due_soon`，按用户要求保持固定。

---

## 三、隔离测试（10/10 全绿）

- 环境：干净复制主库 → `/tmp/fix01_test.db`；独立端口 3103；BREAKGLASS 登录；**主库零污染**；临时脚本跑完即删。
- 断言与结果：

| # | 验证项 | 结果 |
|---|---|---|
| 1 | break-glass 登录 200 | ✅ |
| 2-6 | 种子配置 stagnant_dead=180 / heavy=90 / medium=60 / light=30 / payment_remind=7 | ✅ 全部一致 |
| 7 | 呆滞阈值配置化生效：四阈值设 9999 后 light(9)+medium(7)+heavy(1) 全归零，改按周转重分类（severe_backlog 59→73、backlog 40→41） | ✅ |
| 8 | 付款提醒=7 时 +8 天注入行被排除（due_7_USD=0） | ✅ |
| 9 | 付款提醒=10 时 +8 天注入行被纳入（due_7_USD=1650） | ✅ |
| 10 | 付款提醒天数配置化生效（due_7 随配置扩大） | ✅ |

- 测试后配置已还原；临时 DB 与脚本已删除。

---

## 四、未改动项（合规）
- app.js / index.html / db.js / 表结构 / 写库逻辑 / 付款链 / WAC / 审批规则 / RBAC 模型：均未触碰。
- 慢销阈值（×2 硬编码）、大额付款提醒（未实现）、30 天桶（固定）：均按架构确认保持。
- 代码改动前副本：`/.backup-fix01/server.js`。

---

## 五、已知边界（非本次范围，待用户后续决定）
- **首页看板付款汇总**（server.js:7220-7225）另有硬编码 `now+7天 / now+30天` 的「待付7天/30天」卡片，未纳入本次修复（收敛范围仅限应付驾驶舱 `payment_remind_days`）。如需看板也跟随配置，请另行确认。
- 呆滞阈值若被误配为非降序（如 light>medium），分级会异常；当前未加校验（属配置责任，非代码缺陷）。

---

## 六、验收与下一步
- 实施+隔离测试已完成，**等待用户真实验收**（在系统参数页修改呆滞/提醒天数 → 呆滞分析页与应付驾驶舱 7 天压力卡应即时跟随）。
- 验收通过后，按既定顺序进入 **SYS-MGMT-FIX-02**（roles / system-config / approval-flows 读接口权限收口，不改动 RBAC 模型）。
