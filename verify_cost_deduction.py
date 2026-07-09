#!/usr/bin/env python3
"""
综合验证脚本：采购链、付款管理、CI费用归集、落地成本、加权平均成本和抵扣逻辑
"""
import json, requests, os, sys, tempfile
from datetime import datetime

BASE = "http://localhost:3001"
RUN_TS = datetime.now().strftime('%Y%m%d%H%M%S')
PERMS = "sku_view,sku_create,sku_edit,sku_import,sku_export,inventory_view,inventory_import,inventory_export,outbound_view,outbound_create,outbound_import,replenishment_view,replenishment_edit,po_view,po_create,po_edit,po_approve,po_export,pi_view,pi_create,pi_edit,ci_view,ci_create,ci_edit,logistics_view,logistics_create,logistics_edit,inbound_view,inbound_create,inbound_edit,inbound_confirm,cost_view,payment_view,payment_create,payment_approve,payment_import,payment_export,check_view,check_create,check_approve,check_import,check_export,stagnant_view,stagnant_export,forwarder_view,forwarder_export,user_manage,role_manage,system_config,dashboard_view"
H = {"X-User-Id": "user_admin", "X-User-Role": "role_admin", "X-User-Permissions": PERMS}

PASS_COUNT = 0
FAIL_COUNT = 0
CREATED_IDS = {"po": [], "pi": [], "ci": [], "sku": [], "supplier": [], "payment": [], "ci_cost": [], "inbound": [], "orig_inv": [], "cost_alloc": [], "cost_log": []}

def post(path, payload=None, headers=None):
    h = {**H}
    if headers: h.update(headers)
    return requests.post(f"{BASE}{path}", json=payload, headers=h)

def get(path, params=None):
    return requests.get(f"{BASE}{path}", params=params, headers=H)

def put(path, payload=None):
    return requests.put(f"{BASE}{path}", json=payload, headers=H)

def check(cond, msg):
    global PASS_COUNT, FAIL_COUNT
    if cond:
        PASS_COUNT += 1
        print(f"  [PASS] {msg}")
    else:
        FAIL_COUNT += 1
        print(f"  [FAIL] {msg}")

def check_resp(r, msg, expected=200):
    global PASS_COUNT, FAIL_COUNT
    if r.status_code == expected:
        PASS_COUNT += 1
        print(f"  [PASS] {msg}")
    else:
        FAIL_COUNT += 1
        print(f"  [FAIL] {msg} (status={r.status_code}, body={r.text[:200]})")

print("=" * 60)
print("  采购链/付款/CI费用归集/落地成本/加权平均成本/抵扣 验证")
print("=" * 60)

# ===== 0. 服务健康检查 =====
print("\n===== 0. 服务健康检查 =====")
r = get("/api/version")
check(r.status_code == 200 and r.json().get("app") == "inventory-management-system", "服务启动并响应版本接口")

# ===== 1. 创建测试依赖 =====
print("\n===== 1. 创建测试依赖（SKU / 供应商 / PO / PI / CI）=====")
sku_code = f"TEST-COST-{RUN_TS}"
r = post("/api/skus", {"sku_code": sku_code, "product_name": "成本测试产品", "brand": "TestBrand", "category": "电子产品", "country": "印尼", "unit": "pcs", "moq": 100, "safety_stock": 50, "status": "active"})
check_resp(r, "创建 SKU")
sku_id = r.json().get("id")
CREATED_IDS["sku"].append(sku_code)

r = post("/api/suppliers", {"name": f"成本测试供应商-{RUN_TS}", "country": "印尼", "status": "active"})
check_resp(r, "创建供应商")
sup_resp = r.json()
sup_id = sup_resp.get("id") or sup_resp.get("last_insert_id") or sup_resp.get("supplier_id", "")
CREATED_IDS["supplier"].append(sup_id)

r = post("/api/purchase-orders", {"supplier_id": sup_id, "supplier_name": f"成本测试供应商-{RUN_TS}", "brand": "TestBrand", "country": "印尼", "target_warehouse": "印尼仓", "currency": "USD", "items": [{"sku_code": sku_code, "po_qty": 1000}]})
check_resp(r, "创建 PO")
po = r.json()
po_id = po["id"]
po_no = po["po_no"]
CREATED_IDS["po"].append(po_id)

# 审批 PO
post(f"/api/purchase-orders/{po_id}/submit-approval", {"submitter_name": "admin"})
post(f"/api/purchase-orders/{po_id}/approve", {"action": "approve", "comment": "一级通过"})
post(f"/api/purchase-orders/{po_id}/approve", {"action": "approve", "comment": "二级通过"})
post(f"/api/purchase-orders/{po_id}/send-to-factory")
print("  PO 已审批并发工厂")

# 创建 PI（需要定金）
pi_payload = {
    "related_po_id": po_id, "related_po_no": po_no,
    "supplier_id": sup_id, "supplier_name": f"成本测试供应商-{RUN_TS}",
    "brand": "TestBrand", "country": "印尼", "target_warehouse": "印尼仓",
    "currency": "USD", "need_deposit": True, "deposit_ratio": 30,
    "expected_delivery": "2026-08-15",
    "items": [{"sku_code": sku_code, "po_qty": 1000, "pi_confirmed_qty": 1000, "unit_price": 5.5}]
}
r = post("/api/proforma-invoices", pi_payload)
check_resp(r, "创建 PI（需要定金）")
pi = r.json()
pi_id = pi["id"]
pi_no = pi["pi_no"]
CREATED_IDS["pi"].append(pi_id)
check(abs(pi.get("payable_deposit", 0) - 1650) < 0.001, f"PI 定金金额 = 5500*0.3 = 1650: {pi.get('payable_deposit')}")

# 创建 CI（有定金）
ci_payload = {
    "related_po_id": po_id, "related_po_no": po_no,
    "related_pi_id": pi_id, "related_pi_no": pi_no,
    "supplier_id": sup_id, "supplier_name": f"成本测试供应商-{RUN_TS}",
    "brand": "TestBrand", "country": "印尼", "target_warehouse": "印尼仓",
    "currency": "USD",
    "items": [{"sku_code": sku_code, "shipped_qty": 1000, "unit_price": 5.5}]
}
r = post("/api/commercial-invoices", ci_payload)
check_resp(r, "创建 CI")
ci = r.json()
ci_id = ci["id"]
ci_no = ci["ci_no"]
CREATED_IDS["ci"].append(ci_id)
check(abs(ci.get("payable_balance", 0) - 3850) < 0.001, f"CI 尾款 = 5500-1650 = 3850: {ci.get('payable_balance')}")

# ===== 2. CI 费用归集 - 关税/商检费用可选 =====
print("\n===== 2. CI 费用归集 - 关税/商检费用可选 =====")

# 默认没有关税和商检费用
r = get(f"/api/commercial-invoices/{ci_id}/cost-summary")
check_resp(r, "获取CI费用归集汇总")
summary = r.json()
check(summary.get("has_customs_duty") == 0, "CI 默认无关税")
check(summary.get("has_inspection_fee") == 0, "CI 默认无商检费用")
check(summary.get("warehouse_arrival_total") == 0, "CI 默认无到仓费用")
check(summary.get("landing_cost_total") == summary.get("goods_amount"), "CI 默认落地成本 = 商品金额")

# 设置有关税
r = put(f"/api/commercial-invoices/{ci_id}/cost-flags", {"has_customs_duty": True, "has_inspection_fee": True})
check_resp(r, "设置CI有关税和商检费用")

r = get(f"/api/commercial-invoices/{ci_id}/cost-summary")
summary = r.json()
check(summary.get("has_customs_duty") == 1, "CI 已标记有关税")
check(summary.get("has_inspection_fee") == 1, "CI 已标记有商检费用")

# ===== 3. 付款四大类 =====
print("\n===== 3. 付款四大类（货款/到仓费用/关税/商检费用）=====")

# 3.1 货款 - 定金（从PI）
r = post("/api/payment-requests/from-pi-deposit", {"pi_id": pi_id})
check_resp(r, "货款-定金付款申请")
dep_pay = r.json()
CREATED_IDS["payment"].append(dep_pay.get("id"))

# 3.2 货款 - 尾款（从CI）
r = post("/api/payment-requests/from-ci-balance", {"ci_id": ci_id})
check_resp(r, "货款-尾款付款申请")
bal_pay = r.json()
CREATED_IDS["payment"].append(bal_pay.get("id"))

# 3.3 到仓费用
r = post("/api/payment-requests/warehouse-arrival", {
    "ci_id": ci_id, "subcategory": "freight", "payee_name": "货代A",
    "payable_amount": 800, "currency": "USD", "remark": "海运费"
})
check_resp(r, "到仓费用-运费付款申请")
war_pay = r.json()
CREATED_IDS["payment"].append(war_pay.get("id"))

# 3.4 到仓费用 - 清关费
r = post("/api/payment-requests/warehouse-arrival", {
    "ci_id": ci_id, "subcategory": "customs_clearance", "payee_name": "清关公司B",
    "payable_amount": 300, "currency": "USD", "remark": "清关费"
})
check_resp(r, "到仓费用-清关费付款申请")
cc_pay = r.json()
CREATED_IDS["payment"].append(cc_pay.get("id"))

# 3.5 关税（CI已标记有关税）
r = post("/api/payment-requests/customs-duty", {
    "ci_id": ci_id, "payee_name": "海关",
    "payable_amount": 550, "currency": "USD"
})
check_resp(r, "关税付款申请")
duty_pay = r.json()
CREATED_IDS["payment"].append(duty_pay.get("id"))

# 3.6 商检费用（CI已标记有商检费用）
r = post("/api/payment-requests/inspection-fee", {
    "ci_id": ci_id, "payee_name": "商检机构C",
    "payable_amount": 200, "currency": "USD"
})
check_resp(r, "商检费用付款申请")
ins_pay = r.json()
CREATED_IDS["payment"].append(ins_pay.get("id"))

# 验证关税付款单不能在未标记有关税时创建
r = put(f"/api/commercial-invoices/{ci_id}/cost-flags", {"has_customs_duty": False})
r2 = post("/api/payment-requests/customs-duty", {"ci_id": ci_id, "payable_amount": 100})
check(r2.status_code == 400, "未标记有关税时拒绝创建关税付款申请")
# 恢复
put(f"/api/commercial-invoices/{ci_id}/cost-flags", {"has_customs_duty": True})

# 验证商检费用付款单不能在未标记时创建
r = put(f"/api/commercial-invoices/{ci_id}/cost-flags", {"has_inspection_fee": False})
r2 = post("/api/payment-requests/inspection-fee", {"ci_id": ci_id, "payable_amount": 100})
check(r2.status_code == 400, "未标记有商检费用时拒绝创建商检费用付款申请")
# 恢复
put(f"/api/commercial-invoices/{ci_id}/cost-flags", {"has_inspection_fee": True})

# ===== 4. CI费用归集汇总验证 =====
print("\n===== 4. CI费用归集汇总验证 =====")
r = get(f"/api/commercial-invoices/{ci_id}/cost-summary")
check_resp(r, "获取更新后的CI费用归集")
summary = r.json()
check(abs(summary.get("warehouse_arrival_total", 0) - 1100) < 0.001, f"到仓费用合计 = 800+300 = 1100: {summary.get('warehouse_arrival_total')}")
check(abs(summary.get("customs_duty_total", 0) - 550) < 0.001, f"关税合计 = 550: {summary.get('customs_duty_total')}")
check(abs(summary.get("inspection_fee_total", 0) - 200) < 0.001, f"商检费用合计 = 200: {summary.get('inspection_fee_total')}")
expected_landing = 5500 + 1100 + 550 + 200  # 7350
check(abs(summary.get("landing_cost_total", 0) - expected_landing) < 0.001, f"CI落地总成本 = 5500+1100+550+200 = {expected_landing}: {summary.get('landing_cost_total')}")
check(len(summary.get("cost_items", [])) >= 4, f"CI费用项 >= 4条: {len(summary.get('cost_items', []))}")

# ===== 5. 抵扣功能 =====
print("\n===== 5. 抵扣功能 =====")

# 5.1 创建带抵扣的尾款付款申请（重新设置CI尾款状态）
# 先审批通过之前的尾款付款
r = post(f"/api/payment-requests/{bal_pay['id']}/approve", {"action": "reject"})
# 直接创建新的带抵扣的到仓费用付款
r = post("/api/payment-requests/warehouse-arrival", {
    "ci_id": ci_id, "subcategory": "other_local", "payee_name": "仓库D",
    "payable_amount": 500, "currency": "USD", "remark": "仓储费",
    "has_deduction": True, "deduction_amount": 100,
    "deduction_source_type": "supplier_refund", "deduction_source_desc": "供应商退款100美元"
})
check_resp(r, "创建带抵扣的到仓费用付款申请")
ded_pay = r.json()
CREATED_IDS["payment"].append(ded_pay.get("id"))
check(abs(ded_pay.get("actual_pay_amount", 0) - 400) < 0.001, f"抵扣后实际付款 = 500-100 = 400: {ded_pay.get('actual_pay_amount')}")

# 5.2 抵扣校验：抵扣金额>应付金额
r = post("/api/payment-requests/warehouse-arrival", {
    "ci_id": ci_id, "subcategory": "other_local", "payable_amount": 200,
    "has_deduction": True, "deduction_amount": 300,
    "deduction_source_type": "other", "deduction_source_desc": "测试"
})
check(r.status_code == 400, "抵扣金额>应付金额时拒绝创建")

# 5.3 抵扣校验：抵扣>0但无来源类型
r = post("/api/payment-requests/warehouse-arrival", {
    "ci_id": ci_id, "subcategory": "other_local", "payable_amount": 200,
    "has_deduction": True, "deduction_amount": 50
})
check(r.status_code == 400, "抵扣>0但无来源类型时拒绝创建")

# 5.4 抵扣更新API
r = put(f"/api/payment-requests/{war_pay['id']}/deduction", {
    "has_deduction": True, "deduction_amount": 200,
    "deduction_source_type": "quality_deduction", "deduction_source_desc": "质量问题扣款200美元"
})
check_resp(r, "更新付款申请抵扣信息")
check(abs(r.json().get("actual_pay_amount", 0) - 600) < 0.001, f"更新后实际付款 = 800-200 = 600: {r.json().get('actual_pay_amount')}")

# 5.5 抵扣金额=应付金额 → 已抵扣结清
r = put(f"/api/payment-requests/{cc_pay['id']}/deduction", {
    "has_deduction": True, "deduction_amount": 300,
    "deduction_source_type": "overpayment_balance", "deduction_source_desc": "多付款余额抵扣"
})
check_resp(r, "全额抵扣付款申请")
check(r.json().get("payment_status") == "deduction_settled", f"全额抵扣状态 = deduction_settled: {r.json().get('payment_status')}")

# ===== 6. 费用确认 =====
print("\n===== 6. CI费用确认 =====")
r = post(f"/api/commercial-invoices/{ci_id}/confirm-costs", {})
check_resp(r, "确认CI费用完整")

r = get(f"/api/commercial-invoices/{ci_id}/cost-summary")
summary = r.json()
check(summary.get("cost_confirmed") == 1, "CI费用已确认")

# ===== 7. 费用分摊 =====
print("\n===== 7. 费用分摊（按商品金额）=====")
# 没确认费用时分摊应失败
# 先测试未确认的情况（创建新CI测试）
ci2_payload = {**ci_payload, "items": [{"sku_code": sku_code, "shipped_qty": 500, "unit_price": 5.5}]}
r = post("/api/commercial-invoices", ci2_payload)
ci2_id = r.json()["id"]
CREATED_IDS["ci"].append(ci2_id)
r = post(f"/api/cost-allocation/allocate/{ci2_id}", {})
check(r.status_code == 400, "未确认费用时分摊失败")

# 对已确认的CI执行分摊
r = post(f"/api/cost-allocation/allocate/{ci_id}", {})
check_resp(r, "费用分摊成功")
alloc_result = r.json()
allocations = alloc_result.get("allocations", [])
check(len(allocations) >= 1, f"分摊记录 >= 1条: {len(allocations)}")
if allocations:
    a = allocations[0]
    check(a["sku_code"] == sku_code, f"分摊SKU = {sku_code}")
    check(abs(a["product_cost"] - 5500) < 0.001, f"商品成本 = 5500: {a['product_cost']}")
    check(abs(a["allocated_warehouse"] - 1100) < 0.001, f"分摊到仓费用 = 1100: {a['allocated_warehouse']}")
    check(abs(a["allocated_duty"] - 550) < 0.001, f"分摊关税 = 550: {a['allocated_duty']}")
    check(abs(a["allocated_inspection"] - 200) < 0.001, f"分摊商检费用 = 200: {a['allocated_inspection']}")
    expected_total = 5500 + 1100 + 550 + 200  # 7350
    check(abs(a["total_landing_cost"] - expected_total) < 0.001, f"落地总成本 = {expected_total}: {a['total_landing_cost']}")
    check(abs(a["unit_landing_cost"] - expected_total / 1000) < 0.001, f"含费用单位成本 = {expected_total / 1000}: {a['unit_landing_cost']}")

# 验证分摊明细
r = get(f"/api/cost-allocation/{ci_id}")
check_resp(r, "获取分摊明细")
alloc_detail = r.json()
check(len(alloc_detail) >= 1, f"分摊明细 >= 1条: {len(alloc_detail)}")
if alloc_detail:
    d = alloc_detail[0]
    check(abs(d.get("unit_product_cost", 0) - 5.5) < 0.001, f"不含费用单位成本 = 5.5: {d.get('unit_product_cost')}")
    expected_unit_allocated = (1100 + 550 + 200) / 1000  # 1.85
    check(abs(d.get("unit_allocated_cost", 0) - expected_unit_allocated) < 0.001, f"单位分摊费用 = {expected_unit_allocated}: {d.get('unit_allocated_cost')}")
    expected_unit_landing = 5.5 + expected_unit_allocated  # 7.35
    check(abs(d.get("unit_landing_cost_with_fees", 0) - expected_unit_landing) < 0.001, f"含费用单位成本 = {expected_unit_landing}: {d.get('unit_landing_cost_with_fees')}")

# ===== 8. 原库存数量导入 =====
print("\n===== 8. 原库存数量导入 =====")

# 8.1 未导入时检查
r = get(f"/api/original-inventory/{ci_id}/check")
check_resp(r, "检查原库存导入状态")
check_data = r.json()
check(not check_data.get("all_imported"), "未导入时 all_imported = false")
check(len(check_data.get("missing_skus", [])) >= 1, "未导入时有缺失SKU")

# 8.2 导入原库存数量
r = post("/api/original-inventory/import", {
    "ci_id": ci_id,
    "items": [{"sku_code": sku_code, "original_qty": 500, "remark": "原库存500件"}]
})
check_resp(r, "导入原库存数量")
import_result = r.json()
check(import_result.get("success") == 1, f"导入成功数 = 1: {import_result.get('success')}")
check(import_result.get("failed") == 0, f"导入失败数 = 0: {import_result.get('failed')}")

# 8.3 导入后检查
r = get(f"/api/original-inventory/{ci_id}/check")
check_data = r.json()
check(check_data.get("all_imported") == True, "导入后 all_imported = true")
check(len(check_data.get("missing_skus", [])) == 0, "导入后无缺失SKU")

# 8.4 导入不存在的SKU
r = post("/api/original-inventory/import", {
    "ci_id": ci_id,
    "items": [{"sku_code": "NOT-EXIST", "original_qty": 100}]
})
check(r.json().get("failed") >= 1, "导入不存在的SKU时失败数 >= 1")

# 8.5 导入不属于CI明细的SKU
r = post("/api/original-inventory/import", {
    "ci_id": ci_id,
    "items": [{"sku_code": sku_code, "original_qty": 500}, {"sku_code": "OTHER-SKU", "original_qty": 100}]
})
check(r.json().get("failed") >= 1, "导入不属于CI明细的SKU时失败数 >= 1")

# 恢复正确导入
post("/api/original-inventory/import", {"ci_id": ci_id, "items": [{"sku_code": sku_code, "original_qty": 500}]})

# 8.6 模板下载
r = get("/api/original-inventory/template")
check_resp(r, "原库存数量导入模板下载")
check("columns" in r.json(), "模板包含列定义")

# ===== 9. 更新加权平均成本 =====
print("\n===== 9. 更新加权平均成本 =====")

# 9.1 未导入原库存时不允许更新（用ci2测试）
r = post(f"/api/cost-allocation/update-weighted-avg/{ci2_id}", {})
check(r.status_code == 400, "未导入原库存时不允许更新加权平均成本")

# 9.2 未分摊时不允许更新（用ci2测试 - 先导入但不分摊）
post("/api/original-inventory/import", {"ci_id": ci2_id, "items": [{"sku_code": sku_code, "original_qty": 200}]})
r = post(f"/api/cost-allocation/update-weighted-avg/{ci2_id}", {})
check(r.status_code == 400, "未分摊费用时不允许更新加权平均成本")

# 9.3 正常更新加权平均成本
r = post(f"/api/cost-allocation/update-weighted-avg/{ci_id}", {})
check_resp(r, "更新加权平均成本成功")
update_result = r.json()
check(update_result.get("success") == True, "更新成功")
check(update_result.get("updated_count") >= 1, f"更新SKU数 >= 1: {update_result.get('updated_count')}")
logs = update_result.get("logs", [])
if logs:
    log = logs[0]
    check(log["sku_code"] == sku_code, f"日志SKU = {sku_code}")
    check(log["original_qty"] == 500, f"原库存数量 = 500: {log['original_qty']}")
    check(log["inbound_qty"] == 1000, f"入库数量 = 1000: {log['inbound_qty']}")
    expected_new_qty = 500 + 1000  # 1500
    check(log["new_qty"] == expected_new_qty, f"新库存数量 = {expected_new_qty}: {log['new_qty']}")
    # 含费用单位成本 = 7.35, 旧成本 = 0, 原库存 = 500
    # 新加权平均 = (500*0 + 1000*7.35) / 1500 = 7350/1500 = 4.9
    expected_new_avg = (500 * 0 + 1000 * 7.35) / 1500
    check(abs(log["new_avg_cost"] - round(expected_new_avg, 4)) < 0.01, f"新加权平均成本 = {round(expected_new_avg, 4)}: {log['new_avg_cost']}")
    check(abs(log["unit_landing_cost"] - 7.35) < 0.01, f"含费用单位成本 = 7.35: {log['unit_landing_cost']}")

# 9.4 验证库存总表已更新
r = get("/api/inventory", {"sku_code": sku_code})
inv_data = r.json()
inv_rows = inv_data if isinstance(inv_data, list) else inv_data.get("rows", [])
if inv_rows:
    inv = inv_rows[0]
    check(inv.get("available_qty") == 1500, f"库存总表数量 = 1500: {inv.get('available_qty')}")
    expected_avg = round((500 * 0 + 1000 * 7.35) / 1500, 4)
    check(abs(inv.get("weighted_avg_cost", 0) - expected_avg) < 0.01, f"库存总表加权平均成本 = {expected_avg}: {inv.get('weighted_avg_cost')}")
else:
    check(False, "库存总表有记录")

# ===== 10. 成本更新日志 =====
print("\n===== 10. 成本更新日志 =====")
r = get("/api/cost-update-logs", {"ci_no": ci_no})
check_resp(r, "查询成本更新日志")
log_rows = r.json()
check(len(log_rows) >= 1, f"日志记录 >= 1条: {len(log_rows)}")
if log_rows:
    lg = log_rows[0]
    check(lg["sku_code"] == sku_code, f"日志SKU = {sku_code}")
    check(lg["related_ci_no"] == ci_no, f"日志关联CI = {ci_no}")
    check(lg["original_qty"] == 500, f"日志原库存数量 = 500: {lg['original_qty']}")
    check(lg["inbound_qty"] == 1000, f"日志入库数量 = 1000: {lg['inbound_qty']}")
    check(abs(lg["ci_unit_cost"] - 5.5) < 0.001, f"日志CI单位成本 = 5.5: {lg['ci_unit_cost']}")
    check(abs(lg["unit_landing_cost"] - 7.35) < 0.01, f"日志含费用单位成本 = 7.35: {lg['unit_landing_cost']}")

# ===== 11. 抵扣不影响落地成本 =====
print("\n===== 11. 抵扣不影响落地成本 =====")
# 到仓费用有抵扣（仓储费500，抵扣100），但落地成本仍应按500计算
r = get(f"/api/commercial-invoices/{ci_id}/cost-summary")
summary = r.json()
# 到仓费用 = 800(运费,抵扣200) + 300(清关费,全额抵扣) + 500(仓储费,抵扣100) + 300(清关费) = 1100 + 500 + 300 = 1900?
# 实际上 ci_cost_items 记录的是 payable_amount（应付金额），不含抵扣
# 到仓费用 = 800 + 300 + 500 + 300 = 1900
check(abs(summary.get("warehouse_arrival_total", 0) - 1900) < 0.001, f"到仓费用按应付金额计算 = 1900（不含抵扣）: {summary.get('warehouse_arrival_total')}")
check(abs(summary.get("landing_cost_total", 0) - (5500 + 1900 + 550 + 200)) < 0.001, f"落地成本按应付金额计算 = 8150: {summary.get('landing_cost_total')}")

# ===== 12. 付款管理 - 查询验证 =====
print("\n===== 12. 付款管理查询验证 =====")
r = get("/api/payment-requests", {"category": "warehouse_arrival"})
check_resp(r, "按到仓费用查询付款申请")
war_payments = r.json()
check(len(war_payments) >= 3, f"到仓费用付款申请 >= 3条: {len(war_payments)}")

r = get("/api/payment-requests", {"category": "customs_duty"})
duty_payments = r.json()
check(len(duty_payments) >= 1, f"关税付款申请 >= 1条: {len(duty_payments)}")

r = get("/api/payment-requests", {"category": "inspection_fee"})
ins_payments = r.json()
check(len(ins_payments) >= 1, f"商检费用付款申请 >= 1条: {len(ins_payments)}")

r = get("/api/payment-requests", {"category": "goods"})
goods_payments = r.json()
check(len(goods_payments) >= 2, f"货款付款申请 >= 2条: {len(goods_payments)}")

# ===== 13. 数据清理 =====
print("\n===== 13. 数据清理 =====")
# 删除测试数据
for pid in CREATED_IDS.get("payment", []):
    try: requests.delete(f"{BASE}/api/payment-requests/{pid}", headers=H)
    except: pass
# 删除CI费用项
try:
    for ci_id_clean in CREATED_IDS.get("ci", []):
        run_sql = f"DELETE FROM ci_cost_items WHERE ci_id='{ci_id_clean}'"
        # 直接通过API删除不太可能，跳过
        pass
except: pass

print(f"\n{'=' * 60}")
print(f"  验证结果: {PASS_COUNT} 通过, {FAIL_COUNT} 失败")
print(f"{'=' * 60}")

if FAIL_COUNT > 0:
    sys.exit(1)
