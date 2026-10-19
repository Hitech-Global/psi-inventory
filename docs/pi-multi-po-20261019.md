# PI 可关联多张 PO（2026-10-19）

## 业务约束
- PI 创建仍先选国家、供应商，再在「关联 PO」区勾选多张已审批且尚有未转 PI 数量的 PO；**同一 PI 的所有 PO 必须属于同一供应商、国家、品牌、币种、目标仓库**。
- 支持一张 PI 无 PO / 单 PO / 多 PO；原 `related_po_id/no` 保存首 PO 兼容旧 CI、PL、库存预测读取；新增 `related_po_ids/nos` JSON 字段保留全部关系。
- PI 每个 SKU 仅一条记录（同 SKU 来自多个 PO 时合并）；额外的 `pi_po_allocations` 按 `pi_id + po_id + sku_code` 逐 PO 保存确认数量，不用金额比例推算 PO 数量，也不能靠 PI 明细 `po_no` 判断唯一来源。
- UI 展示所选 PO 与合计未转数量；同 SKU 聚合；保存时后端按用户的 PO 勾选顺序分配 PI 确认数量，先占用第一张的剩余量，再占用第二张。PI 详情提供每张 PO 的 SKU 数量实际分配。
- 即使前端绕过筛选，后端会核验所选 PO 的存在/审批/属性一致性，数量必须为非负整数、唯一 SKU；超出 PO 剩余量返回 400。
- 占用数量的 UPDATE 是 `... WHERE transferred_pi_qty + :qty <= po_qty`，避免并发或历史状态变化造成超占；整个 PI/PO/来源分配/应付定金在一个事务内成功或回滚。
- 现有 CI 从 PI 逐 SKU 发货，保持一条 PI SKU 数据，不产生二次发货数量加算；采购预测仍依照 `po_unconfirmed_pi_qty + pi_confirmed_unshipped_qty`，不叠加关联记录。
- 单 PO/独立 PI 创建走原有路径；无任何历史数据回填、更改或删改。

## 编辑与作废
- 编辑多 PO PI 的 SKU 数量先按真实 `pi_po_allocations` 在同一个事务内归还原来的占用，再按现有 PO 剩余数量重新分配；若任何操作失败整次回滚。仓库、币种、国家和品牌在多 PO 关联后锁定，避免冲破唯一 PI 抬头财务/库存归属。
- 作废多 PO PI 且尚未进入 CI/历史 CI/已申请或已支付定金：回退来源分配+PO 状态、取消 active 的定金 payable（同事务）再将 PI 设为 cancelled；禁止历史/实际发货与付款流程中作废。
- 原有单 PO 编辑及作废逻辑不扩大修改范围。

## 数据库
- PG 生效迁移入口：`db.js` 硬编码 migrations（PG worker 桥）；同步补齐 `db-pg.js` 的独立初始化定义、`db-sqlite.js`（内存与本地SQLite），全部幂等。
- 新列：`proforma_invoices.related_po_ids, related_po_nos TEXT DEFAULT ''`。
- 新表：`pi_po_allocations(id, pi_id, po_id, po_no, sku_code, allocated_qty, created_at)`，唯一索引 `(pi_id,po_id,sku_code)`，`po_id` 索引。旧 PI 两列默认空，保持首 PO 不变。
- 不写任何生产 PO/PI 历史数据；生产仅在部署初始化时新建列/表/索引。真实业务数量只在用户创建/编辑/作废时写入。

## 验收
- 本地 SQLite 动态服务端 create/PUT/void 路由测试：多 PO 同 SKU 合并、数量分配、回滚、超额拒绝、历史单 PO 无回归、合同同属条件校验、作废回款与作废支付保护。
- 前端模拟 DOM：多选、搜索、错币种禁选、手工行保留、异步竞态处理。
- 旧国家/供应商联动专项测试同步更新，保留原功能兼容。
- 合并前必须通过 postinstall、旧 CI/PI 回归、无非目标文件 staged，且 Render Live/version 只读验收；由用户登录后进行一张无资金影响的小批 PO→PI 人工验收。
