# Phase 3-C-4B-1b-1 实施报告 — Payment Request 页用户可见文本国际化

> 状态：**已实施完成，待验收**。未 commit / 未 push / 未 deploy。
> 实施严格遵循已批准的只读方案（`phase3c4b1b1-readonly-report.md`，即前序交付物）与用户冻结纪律。

---

## 1. 任务范围

**目标函数（15 个，全部属于 Payment Request 页用户可见文本）：**
`viewPayment` / `loadPay` / `createWarehousePay` / `saveWarehousePay` / `createCustomsDutyPay` / `createInspectionFeePay` / `saveCustomsDutyPay` / `saveInspectionFeePay` / `createFrtPay` / `editDeduction` / `saveDeduction` / `payUploadFiles` / `payDeleteAttachment` / `saveDepPay` / `saveBalPay`

**允许修改**
- `i18n.js`：新增语义 key + 补充 en/id 译文；modal body 模板允许新增 `modal.body.createCustomsDutyPay` / `modal.body.createInspectionFeePay`。
- `app.js`：仅展示文字接 `t()`、modal 标题接 `t()`、toast/validation/empty/title 接 `t()`、将 `createCustomsDutyPay`/`createInspectionFeePay` 裸 HTML body 转换为 i18n 模板调用。

**禁止（严守）**：业务/计算/状态判断/DB 字段/API/SQL/付款流程改动；`amount/currency/exchange_rate/cost/payable/deduction/settlement/reversal` 仅可改 label 文案；HTML 模板 7 维结构快照必须 100% 一致；不机器翻译覆盖 HTML、不重设计页面、不顺便修其他中文债务；不碰 Cost/WAC/Settlement/Reversal/Approval Flow/Exchange Rate 逻辑与 `server.js`。

---

## 2. 修改文件清单

| 文件 | 性质 | 说明 |
|------|------|------|
| `app.js` | 修改 | 7340 行不变（仅内部接线）；23 处 `t()` 接线，分布于 15 函数 |
| `i18n.js` | 修改 | 文件末尾「Phase 3-C-4B-1b-1」注释块新增 20 个语义键（en/id 共 40 条赋值） |
| `phase3c4b1b1-readonly-report.md` | 只读方案（前序） | 未改 |

基线备份：`/tmp/psi-c4/app.js.pre-b1b1.bak`（7340 行，修改前快照，用于 7 维对照）。

---

## 3. i18n.js 新增语义键（20 个 + en/id 译文）

新增块位置：`i18n.js` 文件末尾 `})();` 之前（注释 `// ===== Phase 3-C-4B-1b-1 =====`）。

| # | Key | zh(fallback) | en | id |
|---|-----|------|----|----|
| 1 | `modal.title.createWarehousePay` | 创建到仓费用付款 | Create Warehouse-Arrival Payment | Buat Pembayaran Biaya Gudang |
| 2 | `toast.warehousePayCreated` | 到仓费用付款申请已创建 | Warehouse-arrival fee payment request created | Permintaan pembayaran biaya gudang dibuat |
| 3 | `toast.customsDutyPayCreated` | 关税付款申请已创建 | Customs duty payment request created | Permintaan pembayaran bea cukai dibuat |
| 4 | `toast.inspectionFeePayCreated` | 商检费用付款申请已创建 | Inspection fee payment request created | Permintaan pembayaran biaya pemeriksaan dibuat |
| 5 | `toast.depPayCreated` | 定金付款申请已生成 | Deposit payment request generated | Permintaan pembayaran uang muka dibuat |
| 6 | `toast.balPayCreated` | 尾款付款申请已生成 | Balance payment request generated | Permintaan pembayaran sisa dibuat |
| 7 | `toast.frtPayNoCI` | 该物流批次未关联CI，无法生成运费付款 | This logistics batch is not linked to a CI; cannot create freight payment | Batch logistik ini tidak terhubung ke CI; tidak bisa buat pembayaran freight |
| 8 | `toast.paymentNotFound` | 未找到付款申请 | Payment request not found | Permintaan pembayaran tidak ditemukan |
| 9 | `toast.deductionSaved` | 抵扣信息已保存 | Deduction info saved | Info potongan tersimpan |
| 10 | `toast.uploadNoPermission` | 无附件上传权限 | No attachment upload permission | Tidak ada izin unggah lampiran |
| 11 | `toast.attachmentDeleted` | 附件已删除 | Attachment deleted | Lampiran dihapus |
| 12 | `validation.expenseCountryRequired` | 请选择费用归属国家 | Please select the expense country | Pilih negara biaya |
| 13 | `empty.noPaymentData` | 暂无付款数据 | No payment data | Tidak ada data pembayaran |
| 14 | `payment.attachments` | 付款申请附件 | Payment Request Attachments | Lampiran Permintaan Pembayaran |
| 15 | `empty.noAttachment` | 暂无附件 | No attachments | Tidak ada lampiran |
| 16 | `common.attachment` | 附件 | Attachment | Lampiran |
| 17 | `title.viewDetail` | 查看详情 | View Details | Lihat Detail |
| 18 | `title.editDeduction` | 编辑抵扣 | Edit Deduction | Edit Potongan |
| 19 | `modal.body.createCustomsDutyPay` | 关税付款表单（zh 裸 HTML，含 dut-payee 值="海关" 按既定风格保留中文） | 完整 en HTML 模板（Payee/Payable Amount/Currency/...） | 完整 id HTML 模板（Penerima Pembayaran/Jumlah Payable/...） |
| 20 | `modal.body.createInspectionFeePay` | 商检费用付款表单（zh 裸 HTML，ins-payee placeholder="商检机构"） | 完整 en HTML 模板（ins-payee placeholder="Inspection Authority"） | 完整 id HTML 模板（ins-payee placeholder="Otoritas Pemeriksaan"） |

> 注：`modal.body.*` 两条在 i18n.js 中以双引号键 `I18N.dict.en["modal.body.createCustomsDutyPay"]` 形式写入（en/id 全量 HTML），与 app.js 第二参数 zh 裸 HTML 构成「同结构多语言模板」。

---

## 4. app.js t() 接线点（23 处，按函数分组）

| 函数 | 接线位置（语义 key） | 说明 |
|------|------|------|
| `saveDepPay` | `toast.depPayCreated` | 成功 toast |
| `saveBalPay` | `toast.balPayCreated` | 成功 toast |
| `createWarehousePay` | `modal.title.createWarehousePay`（标题）、`term.fin.expense_country`（countryField label，仅 ciId 缺省时注入） | 标题 + 费用归属国家 label |
| `saveWarehousePay` | `validation.expenseCountryRequired`（校验）、`toast.warehousePayCreated`（成功） | — |
| `createCustomsDutyPay` | `modal.body.createCustomsDutyPay`（裸 HTML → i18n 模板调用） | **结构零改，仅加 t() 包装** |
| `saveCustomsDutyPay` | `toast.customsDutyPayCreated` | 成功 toast |
| `createInspectionFeePay` | `modal.body.createInspectionFeePay`（裸 HTML → i18n 模板调用） | **结构零改，仅加 t() 包装** |
| `saveInspectionFeePay` | `toast.inspectionFeePayCreated` | 成功 toast |
| `createFrtPay` | `toast.frtPayNoCI` | 无 CI 提示 toast |
| `viewPayment` | `term.fin.expense_country`（费用归属国家 fld label）、`payment.attachments`（附件区 h3） | — |
| `renderPayAttachmentListInner` | `empty.noAttachment`（空态）、`common.attachment`（name 兜底）、`action.delete`（删除按钮） | 附件列表 |
| `payUploadFiles` | `toast.uploadNoPermission` | 无权限 toast |
| `payDeleteAttachment` | `toast.attachmentDeleted` | 删除成功 toast |
| `loadPay` | `empty.noPaymentData`（空态）、`title.viewDetail`（👁️ title）、`term.fin.supplement_expense_country`（补国家 btn title）、`title.editDeduction`（✂️ btn title） | 列表区 |
| `editDeduction` | `toast.paymentNotFound` | 未找到 toast |
| `saveDeduction` | `toast.deductionSaved` | 保存成功 toast |

> `node --check` 对 `app.js` 与 `i18n.js` 均通过（语法零错误）。

---

## 5. 7 维结构快照验证（verify-b1b1.js）

脚本：`/tmp/psi-c4/verify-b1b1.js`（acorn AST 解析；已修复 `Literal` 类型识别、TemplateLiteral 处理、placeholder 比数量、residualCJK 整体跳过 `t()` 子树）。

**结论：`struct+parity all OK: YES`**

- app.js 内部 HTML 与基线 **100% 一致**：`createCustomsDutyPay`/`createInspectionFeePay` 裸串仅加 `t()` 包装，内容逐字节相同。
- 4 个 modal 模板 7 维结构（ids / classes / onclick / placeholder数量 / data-* / tagSeq / {vN}）**全部 PASS**。
- 范围内残留 CJK = 0（已接线文本全部进入 `t()`）。

---

## 6. 隔离 E2E 结果（Payment 页 zh/en/id）

环境：端口 **3002**（独立副本服务）+ 副本 DB `/tmp/psi-e2e/inventory.db` + `user_admin` session token；生产库零写入。
脚本：`/tmp/psi-e2e/p3c4b1b1-e2e.js` → 产物 `/tmp/psi-e2e/p3c4b1b1-e2e-report.json`。

**结论：PASS=true，73/73 检查通过，0 JS 错误。**

| 维度 | 结果 |
|------|------|
| 0 pageerror / console error | ✅ jsErrors=0 |
| 0 字面 `t("key"` 泄漏 | ✅ 所有页面/模态 leak=0 |
| 0 双重转义 `\"` | ✅ 所有页面/模态 dblEsc=false |
| 三语言中文消失（label 级） | ✅ en/id 中 `创建到仓费用付款`/`付款申请附件`/`付款对象` 均不再出现；对应译文 `Create Warehouse-Arrival Payment`/`Payment Request Attachments`/`Payee`(en)、`Buat Pembayaran Biaya Gudang`/`Lampiran Permintaan Pembayaran`/`Penerima Pembayaran`(id) 出现 |
| 列表行数一致 | ✅ zh=en=id=49（仅文本本地化，数据不变） |
| 三个目标 modal body 渲染 | ✅ `dut-payee` / `ins-payee` 字段存在；结构随语言切换 |

> 验证覆盖：Payment 列表页、viewPayment 模态（附件区）、createWarehousePay / createCustomsDutyPay / createInspectionFeePay 三个创建模态，三语言各一轮。

---

## 7. 已知残留（34 处，全部位于排除区）

按「不顺便修复其他中文债务」纪律，以下残留**刻意保留**，不在本任务范围：

- `viewPayment`：28 处 —— 结算记录表头/状态（有效/已冲销/冲销/付款/抹零等）、关联 PI/CI 摘要标题、审批意见区、附件上传拖拽提示（点击上传…）、关闭按钮等。属 **Settlement / Reversal / Approval Flow** 排除项。
- `loadPay`：5 处 —— 通过 / 驳回 / 确认付款 / 抹零 按钮文本及 `补国家` 按钮文本（仅其 `title` 属性已接线，`title.editDeduction` / `supplement_expense_country`；按钮文本属 Approval Flow / 其他债务，未动）。
- `createWarehousePay`：1 处 —— countryField 默认选项 `请选择`（仅 ciId 缺省时注入；按纪律保留）。

上述 34 处均不在本任务 23 处接线清单内，且符合用户「不顺便修其他中文债务」要求。

---

## 8. 排除范围（明确未改动）

- 任何业务逻辑 / 计算公式 / 状态判断 / 数据库字段 / API / SQL / 付款流程。
- `amount` `currency` `exchange_rate` `cost` `payable` `deduction` `settlement` `reversal` 相关代码（仅可改 label，本次仅改了可见 label 文案，未触碰计算）。
- Cost / WAC / Settlement / Reversal / Approval Flow / Exchange Rate 逻辑。
- `server.js`（F1 未动）。
- 页面 HTML 结构重设计、机器翻译覆盖 HTML。
- 其他中文债务（按纪律不顺便修）。

---

## 9. 生产影响与安全声明

- 隔离 E2E 全程使用端口 3002 副本服务 + 副本 DB，**生产库零写入**（所触发操作均为读模态 / 页面渲染，无 POST/写）。
- 代码修改仅文本接线，未引入任何写路径或逻辑分支变化。
- 未执行 commit / push / deploy。

---

## 10. 验收结论与下一步

✅ 代码实施完成（i18n.js 20 键 + app.js 23 处接线）
✅ node --check 双文件通过
✅ 7 维结构 100% 一致，parity OK
✅ 隔离 E2E 73/73 通过，0 错误 / 0 泄漏 / 0 双重转义 / 中文 label 正确消失 / 行数一致
⏸ **停止，等待验收**

验收通过后（未来动作，待用户确认）：本地 commit（仅 `i18n.js` + `app.js` + 本报告），再推进 B-1b-2。
