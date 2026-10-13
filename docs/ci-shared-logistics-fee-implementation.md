# 合并派送费 / Shared logistics fee

## 业务规则
- 一笔货代账单关联同一 CI 的 2–50 个物流批次；一条 payable_items 应付台账、一笔 payment_requests、一个 payment_request_items 关联，不生成重复的 ci_cost_items。
- 费用选择系统币种表中已启用的币种；原币金额使用整数分保存，币种不推断。
- 批次运输方式 = sea 则 PL SKU CBM，air 则 PL SKU 总毛重 kg。
- 海空混合一张账单时必须输入两个模式金额，合计等于账单，不允许直接跨单位加总。
- 分摊的金额尾差给占比最大的批次；折算为 RMB/本币后再次做整数分尾差归整。
- CI 综合运费 = 同 CI 不重复批次的已有运费 + 每笔合并账单仅一次。未登记合并费用的 CI 保留旧列表计算与显示，不改变历史口径。
- CI 明细按批次展示分摊后的 RMB 综合运费和货值占比；无法确定汇率时显示待折算。
- 付款用 payment 审批流，不绕开结算核销。
- 缺少 applied 付款日志、有效本币金额、local_rate、local_rate_date、同日 realtime 非 fxauto 汇率时，跨币种金额不进成本。
- WAC 使用入库仓本币，保留原有产品成本到货日汇率及实际付款日运费汇率原则；合并分摊采用已经付款的本币金额。
- PL CBM/kg 发生变化时，CI 费用分摊与 WAC 在确认前 fail-closed；已确认 WAC 的批次不可追加入库费用。
- 旧数据不迁移、不自动回填、不可重写历史 WAC。

## 核心文件
- shared-logistics-fee-core.js：纯函数分摊（minor 整数分和余额守恒）
- shared-logistics-fee-server.js：财务请求、关联批次、原币/支付汇率换算、CI 汇总
- db.js（PG 同步 worker 实际生效的 fail-closed 迁移入口）+ db-pg.js / db-sqlite.js：新增 shared_logistics_fees、shared_logistics_fee_batches，幂等且无历史回填
- server.js：CI 到仓费用分摊接口和计价保护
- wac-calculator.js：每批共享费用从付款事实取得，不重复认列
- app.js / assets/ci-list-freight.js：CI 费用录入、详情和列表展示

## 隔离测试
- node test/shared-logistics-fee.test.cjs
- node test/shared-logistics-fee-api.test.cjs
- node wac-calculator.test.cjs
- node logistics-cost-sync.test.cjs
- npm run postinstall
以上在 Node 22 / SQLite 内存数据库已通过。另使用已有 Docker postgres:16 镜像、全新独立容器（127.0.0.1:55437，非 Shopee / 非 PSI 生产），完成：空白全量建表、db.js 生产生效迁移重复执行、真实 PG 事务与 HTTP 费用接口、台账唯一性、重复申请 409、跨币种汇率、撤销状态 fail-closed、CI RMB 运费及 WAC IDR 分摊守恒。运行：`node local-pg-gate.cjs`、`node local-pg-api-run.cjs`（本机脚本含环境保护，不提交凭据）。

付款部分付款/抹零、来源追溯、付款汇率解析三个独立回归测试通过。另有 AST 结算契约测试因本机缺少可选依赖 `acorn` 未运行，不能标记通过。

## 上线前严守的 Gate
- [x] PostgreSQL 空白迁移、生产同步迁移入口幂等、真实事务及费用 HTTP 接口（仅独立本地 PG；生产只读）
- [ ] 付款全流程：配置审批流、提交、审批、部分/全部付款、核销、汇率快照与反向退款验证
- [ ] 运营用户/财务权限界面测试（金额隐藏、海运/空运、多币种、切页）
- [ ] CI 大列表性能与缓存失效测试；无合并费用的历史 CI 使用旧展示口径
- [ ] 未付款/拒绝/取消的费用在真实系统中的处理流程验收
- [ ] GitHub CI、Render 健康与生产只读验收
