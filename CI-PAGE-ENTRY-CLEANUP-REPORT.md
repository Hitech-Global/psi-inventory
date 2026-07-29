# CI/PL 页面入口精简报告

**日期**: 2026-07-29  
**Commit**: (待填入)

---

## 背景

CI/PL 列表页面顶部存在大量导入/模板按钮，这些属于初始化/管理员工具，不属于日常 CI 业务流程。按以人为本设计，精简为仅保留日常业务入口。

---

## 移除的按钮（从主页面）

| 按钮 | 对应功能 | 说明 |
|------|---------|------|
| 📥 CI模板 | `downloadDocTemplate('ci')` | 管理员初始化工具 |
| 📤 导入CI | `openDocImport('ci')` | 批量导入工具 |
| 📥 PL模板 | `downloadDocTemplate('pl')` | 管理员初始化工具 |
| 📦 导入PL | `openDocImport('pl')` | 批量导入工具 |
| 📥 历史CI模板 | `downloadDocTemplate('historicalCI')` | 管理员初始化工具 |
| 📤 批量导入历史CI | `openDocImport('historicalCI')` | 批量导入工具 |
| ➕ 历史CI导入 | `createHistoricalCI()` | 已合并进"新建CI"→选择类型 |

## 保留的按钮

| 按钮 | 说明 |
|------|------|
| 🔍 搜索 | 触发 `loadCI()` |
| 单据类型/状态筛选 | 下拉筛选 |
| ➕ 新建CI | 弹出类型选择（运营CI/历史CI） |

## 修改文件

仅 `app.js` line 6422 — `renderCI()` 函数内两处模板替换：

1. `{v1}`: 5 个按钮 → 仅保留 `createCI()` 按钮
2. `{v2}`: 3 个按钮 → 空字符串

## 不变项

- `downloadDocTemplate()` 函数仍然存在（如需管理员入口可后续添加）
- `openDocImport()` 函数仍然存在
- `createHistoricalCI()` 函数仍然存在
- API 端点不受影响
- 数据库不受影响
- CI 业务逻辑不受影响
