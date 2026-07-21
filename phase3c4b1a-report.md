# Phase 3-C-4B-1a 实施报告：Finance Low-Risk CRUD Localization

**状态**：实施完成，隔离验证全绿，**等待人工验收**（`未 commit / 未 push / 未 deploy`）。

## 1. 修改文件

| 文件 | 改动 | 性质 |
|---|---|---|
| `i18n.js` | 新增 **124 个语义键**（en+id 各 124 条赋值，248 行）；复用既有 8 个键（`action.save`/`action.cancel`/`action.refresh`/`action.edit`/`col.name`/`col.status`/`col.actions`/`col.operator`）。共 132 个语义键用于本阶段。 | 纯新增字典，无结构改动 |
| `app.js` | **100 处**动态文本字符串接线（`t()` 包装），涉及 25 个函数，178 行变更。 | 仅展示层文本接线 |

**未改动**：`server.js`、`DB`、API、SQL、WAC/付款结算/抵扣/冲销/汇率等任何业务/计算逻辑；订单预测相关代码；HTML 结构（id/class/onclick/data/{vN} 全部保留）。

## 2. 范围（按用户确认）

✅ 5 个 Finance 低风配置页：**付款类目 / 账期配置 / 付款主体 / 费用类型 / 货代( Freight) / 操作日志**。
❌ 排除（按纪律）：server.js 消息体系（F1 延后）、订单预测冻结页、WAC/结算/抵扣/冲销/汇率逻辑。

## 3. 新增 Key 分类（语义命名，无 `txt.*` 编号键）

- `action.*` 新增 7（disable/enable/toggle_enable/add_payer_entity/manage_category/edit_payment_category/reload）
- `col.*` 新增 20（payment_category/subcategory/entity_code/payer_code/legal_name/default_currency/is_default/source_type/source_mapping/category_name/reference_count/affected_count/country/time/sort/operation_type/expense_type/expense_event/expense_source/reason 等）
- `status.*` 新增 2（not_set / no_reference）
- `enum.*` 新增 3（yes / no / not_specified）
- `term.fin.*` 新增 92（付款类目管理、付款主体管理、小类及其费用来源映射、实体代码、默认收款对象、费用归属国家、只读模式、系统配置、权限、各类提示与帮助文本等）

全部使用 `status.* / action.* / col.* / enum.* / term.fin.*` 稳定业务语义键。

## 4. 修改函数清单（25 个，均为展示层函数）

`renderPaymentCategories` `pcOpenCategoryModal` `pcSaveCategory` `pcToggleCategory` `pcSubRow` `pcMapRow` `pcStatusBadge` `pcRowActions` `pcSubRowActions` `pcMapRowActions` `pcHint` `pcError` `pcStub` `pcShowHelp` `pcPayeeLabel` `pcPayeeOptions` · `renderPaymentTerms` · `renderPayerEntities` `peRenderTable` `peOpenModal` `peSave` `peToggleStatus` · `renderExpenseTypes` 相关 `openPaymentExpenseCountry` `savePaymentExpenseCountry` · `renderOperationLogs`。

> 说明：`renderFreightForwarders` / `renderExpenseTypes` 早已由 `renderSimpleMgr` 全量接线，本阶段 0 改动；其标题等文本已在本阶段 `col.*` 键覆盖。

## 5. 结构快照结果（7 维，修改前 vs 修改后）

| 维度 | id / class / onclick / data-* / placeholder(存在性) / {vN} / tags |
|---|---|
| 结果 | **100% 一致，0 处差异**（25 个函数逐一比对） |

> onclick 中的 `\'` 转义在源层被原样保留（运行时值等价），结构快照按字节级一致通过。

## 6. 隔离 E2E 结果（端口 3002 · 副本 DB · 生产零写入）

- 覆盖 **6 个 Finance 页 × zh/en/id = 18 次渲染** + 行数一致性检查 = **67 项检查，全部 PASS**。
- **0 个 JS 运行时错误**（唯一控制台噪声为 `favicon.ico` 404，环境性，与改动无关）。
- **0 处 `t()` 字面泄漏**，**0 处双重转义**（`\"`）。
- 中文混杂消除：en/id 下 125 条范围内客户端渲染文本（付款类目管理 / 付款主体管理 / 维护付款大类 / 停用项目不会出现在新的付款申请中 / 但不影响历史记录 / 刷新 / 页面说明 / 加载失败 / 暂无付款主体数据 / 费用归属国家 / 新增付款主体 / 默认收款对象 / 法人名称 …）**全部不再出现**，替换为 English / Bahasa。
- 数据行数三语言一致（结构未变）。

## 7. 已知剩余问题 / 后续任务（非本次范围，预期内）

1. **server.js F1 延后**：Finance 后端校验/业务提示（约 60 函数）仍为中文，属后端消息体系改造，按用户决定延至 AI助手/飞书/API 国际化阶段。en/id 下这些来源文本仍为中文——**不计入本次失败**。
2. **代码注释保留中文**：`//` 注释（如 `// 只读守卫：即便 DOM 残留也不打开写弹窗`）非用户可见展示文本，按纪律未改（不在 i18n 范围）。
3. **付款列表页按钮 title**：`title="补录费用归属国家"` 位于 Payment 列表页（非 5 个 CRUD 配置页核心函数），不在 B-1a 范围，留待后续 B 阶段统一处理。

## 8. 合规确认

- ✅ 仅改文字，未改业务逻辑 / DOM 结构 / 订单预测页结构。
- ✅ 未修改 server.js / DB / API / SQL / WAC / 结算 / 抵扣 / 冲销 / 汇率逻辑。
- ✅ Key 全部语义化（`status./action./col./enum./term.fin.*`），无 `txt.*` 编号键。
- ✅ 每处 HTML 修改前记录 7 维、修改后 100% 一致；未发生 Phase 2-B 类型结构破坏。
- ⛔ 当前未 commit / push / deploy，等待人工验收通过后进入 **Phase 3-C-4B-1b**（中风险：付款/成本/WAC 模态文本）。

---
*生成脚本存档：`/tmp/psi-c4/b1a-vocab.js`（词表）、`/tmp/psi-c4/decompose-b1a.js`（接线）、`/tmp/psi-c4/add-dict-b1a.js`（字典）、`/tmp/psi-c4/struct-diff.js`（结构快照）、`/tmp/psi-e2e/p3c4b1a-e2e.js`（E2E）。原始备份 `/tmp/psi-c4/app.js.pre-b1a.bak`。*
