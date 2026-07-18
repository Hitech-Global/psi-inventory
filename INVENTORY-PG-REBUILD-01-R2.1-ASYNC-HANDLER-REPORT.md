# INVENTORY-PG-REBUILD-01 · R2.1 AsyncHandler 安全层 — 实施报告

> 阶段：R2.1（按用户 2026-07-18 授权，将原 R2.2 安全网前移为 R2.1）
> 目标：建立 async 错误捕获基础，修复 Express 4 不捕获 async handler rejection 的 P0-2 稳定风险
> 纪律：只读→方案→确认→实施→隔离验证→独立 commit；不 push、不部署、不进入 R2.2

---

## 1. 范围与冻结遵守

仅做两件事：
1. `server.js` 新增**手写** `asyncHandler` 工具；
2. 将 211 条 `app.get/post/put/delete` 路由的**末端 handler** 用 `asyncHandler(...)` 包裹。

冻结边界（严格遵守用户补充要求，零违反）：

| 约束 | 遵守情况 |
|---|---|
| 采用手写 asyncHandler，不新增依赖 | ✅ 手写；acorn 仅装在**隔离受管 node workspace**，未写入项目 `package.json` |
| 不新增文件 | ✅ `asyncHandler` 内联 `server.js`（置于 `const app = express();` 之后） |
| 不改变 Express 路由结构 | ✅ 路由路径 / 签名 / 中间件链不变 |
| 仅包装末端 handler | ✅ 每个 `app.METHOD(path, mw1, mw2, handler)` 仅包裹最后的 `handler` |
| 不修改 middleware | ✅ `requireApiPermission` / `apiAuth` / `csrfGuard` 等保持原样 |
| 不处理 `app.use` | ✅ 5 处 `app.use` 未触碰 |
| 不修改任何 DAL 调用 | ✅ |
| 不增加 await | ✅ |
| 不修改 SQL | ✅ |
| 不修改业务逻辑 / 接口返回 / 权限规则 / 冻结模块 | ✅ |

---

## 2. 实施方式（AST 可靠脚本，非正则）

- 使用 **acorn**（标准 JS 解析器）在隔离受管 workspace 解析 `server.js` 为 AST。选用 AST 原因：`server.js` 含 **223 个模板字符串**，正则 / 朴素平衡括号扫描在 `${...}` 含括号时会误判；AST 由解析器正确处理所有 JS 语法。
- 遍历 AST 收集所有 `CallExpression`，筛选 callee 为 `app.get / post / put / delete` 的调用。
- 对每个调用取**最后一个参数**（末端 handler）：
  - 为 `ArrowFunctionExpression` / `FunctionExpression` / `Identifier`（命名 handler）→ 包裹 `asyncHandler(...)`；
  - 已包裹（`asyncHandler(...)`）→ 跳过（幂等）；
  - 非函数末端参数 → **中止并报错**（本次未触发）。
- 插入策略：收集全部插入点（末端 handler 起点插 `asyncHandler(`、调用闭合 `)` 前插 `)`），按索引**倒序**插入，保证字符串位置有效。
- acorn 安装在隔离 workspace，不写入项目 `package.json`，运行后脚本即删（遵守"一次性脚本运行后删除"）。

**异常中止条件（满足用户"无法可靠识别即停止报告"要求，全部未触发）**：
解析失败 / 嵌套路由定义 / 非函数末端参数 / 锚点缺失 / `asyncHandler` 已存在 → 均 `exit!=0` 并报告。

---

## 3. 验证结果

| 检查项 | 结果 |
|---|---|
| `node --check server.js` | ✅ SYNTAX_OK |
| 路由总数 `app.get/post/put/delete(` | 211（与 R2.0 只读扫描一致，未增删路由） |
| 实际包裹数 | **211 / 211**（0 跳过、0 异常） |
| `asyncHandler(` 出现次数 | 212（1 定义 + 211 包裹） |
| `app.use(` 数量 | 5（未触碰） |
| git diff 性质 | 纯增量：420 删除 / 426 新增，全部为 wrap 相关（209 路由开头行 + 209 `});`→`))` 闭合行 + 2 个多 middleware 路由的 handler 起始行 + 7 行 `asyncHandler` 定义）；**0 行业务逻辑 / SQL / DAL / 权限变更** |
| asyncHandler rejection 捕获单测 | ✅ ALL PASS（TEST1：async 拒绝→`next` 命中；TEST2/3：成功路径不误调 `next`） |
| SQLite 启动冒烟（隔离临时库 `DB_PATH=/tmp/r21-smoke.db`，端口 3305） | ✅ `/api/version`=200、`/`=200、`/api/auth/feishu/login`=302（wrapped async 路由正常运行）；启动日志无 error，58 表初始化完成 |
| 已有 async handler 包裹确认 | ✅ 3 处现行未保护 async 路由现已包裹（见第 4 节） |

> 行号说明：因插入 `asyncHandler` 定义 7 行（含空行），报告/验证中涉及的行号相对原文件 **+6**（如原 `:471` → `:477`）。

**diff 审查结论**：逐一确认 diff 仅含 `asyncHandler(...)` 包裹与定义插入，无任何逻辑、SQL、DAL、权限、接口结构改动。`server.js` 相对其上一个提交（`8bf33b6` 已含此前各验收阶段业务功能）的差异**完全等同于本次 R2.1 变更**，无意外混杂。

---

## 4. 即时收益（现行潜在崩溃点已修复）

`server.js` 中原本已存在 **3 个 `async` 路由但无 try/catch、且未被任何错误捕获包裹**，在 Express 4 下其 rejection 会逃逸为未处理 Promise rejection（进程级不稳定）。本次包裹后立即受 `asyncHandler` 保护：

- `:477 /api/auth/feishu/callback`（原 `:471`）
- `:980 /api/inventory/currency-rates`（`requireLogin` 之后）
- `:1072 /api/exchange-rates/refresh`（`requireApiPermission('inventory_view')` 之后）

同时为 **R2.3+（路由内联 DAL 转 async/await）** 建立统一错误捕获基础：届时 handler 返回的 rejected promise 将由 `.catch(next)` 路由至 Express 错误中间件，避免未处理 rejection。

---

## 5. 提交

- **独立 commit**：仅 `server.js` + 本报告。
- **不 push**、**不部署**。
- commit hash：`ccd6439`（amend 后实际 HEAD 以 `git rev-parse HEAD` 为准）

```
git add server.js INVENTORY-PG-REBUILD-01-R2.1-ASYNC-HANDLER-REPORT.md
git commit -m "feat(pg-rebuild R2.1): 新增 asyncHandler 安全网并包裹 211 条路由 handler"
```

---

## 6. 停点

R2.1 完成即停止，**不进入 R2.2**。等待用户确认后进入下一子阶段（helper 层 async/await 转换，原 R2.1 顺延为 R2.2）。

---

## 附：统计明细

- 路由方法分布（与 R2.0 只读统计一致）：GET 89 / POST 96 / PUT 14 / DELETE 12 = **211**
- 包裹覆盖：211 / 211 = 100%
- 跳过：0（已包裹 0、非函数末端 0、嵌套路由 0）
- 新增依赖：0（acorn 仅隔离 workspace，未入项目）
- 受影响文件：`server.js`（+ `asyncHandler` 定义 7 行、211 处 `asyncHandler(...)` 包裹）
