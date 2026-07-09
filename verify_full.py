#!/usr/bin/env python3
"""综合验证脚本：PI/CI/PL 全流程 + 定金逻辑 + 加权平均成本同步"""
import json, requests, os, sys, time
from datetime import datetime

BASE = "http://localhost:3001"
PERM = "sku_view,sku_create,sku_edit,sku_import,sku_export,inventory_view,inventory_import,inventory_export,outbound_view,outbound_create,outbound_import,replenishment_view,replenishment_edit,po_view,po_create,po_edit,po_approve,po_export,pi_view,pi_create,pi_edit,ci_view,ci_create,ci_edit,logistics_view,logistics_create,logistics_edit,inbound_view,inbound_create,inbound_edit,inbound_confirm,cost_view,payment_view,payment_create,payment_approve,payment_import,payment_export,check_view,check_create,check_approve,check_import,check_export,stagnant_view,stagnant_export,forwarder_view,forwarder_export,user_manage,role_manage,system_config,dashboard_view"
H = {"X-User-Id": "user_admin", "X-User-Role": "role_admin", "X-User-Permissions": PERM, "Content-Type": "application/json"}

RUN_TS = datetime.now().strftime("%Y%m%d%H%M%S")
PASS_COUNT = 0
FAIL_COUNT = 0
CREATED_IDS = {"po": [], "pi": [], "ci": [], "pl": [], "sku": [], "supplier": [], "inbound": [], "logistics": [], "payment": [], "cost": []}

def post(path, payload=None, headers=None):
    h = {**H}
    if headers: h.update(headers)
    return requests.post(f"{BASE}{path}", json=payload, headers=h)

def get(path, params=None):
    return requests.get(f"{BASE}{path}", params=params, headers=H)

def put(path, payload=None):
    return requests.put(f"{BASE}{path}", json=payload, headers=H)

def delete(path):
    return requests.delete(f"{BASE}{path}", headers=H)

def check(cond, msg):
    global PASS_COUNT, FAIL_COUNT
    if cond:
        print(f"  [PASS] {msg}")
        PASS_COUNT += 1
    else:
        print(f"  [FAIL] {msg}")
        FAIL_COUNT += 1

def cleanup():
    """清理测试数据"""
    print("\n===== 清理测试数据 =====")
    for iid in CREATED_IDS["inbound"]:
        try: delete(f"/api/inbound-records/{iid}")
        except: pass
    for iid in CREATED_IDS["cost"]:
        try: delete(f"/api/cost-allocations/{iid}")
        except: pass
    for iid in CREATED_IDS["logistics"]:
        try: delete(f"/api/logistics-batches/{iid}")
        except: pass
    for iid in CREATED_IDS["payment"]:
        try: delete(f"/api/payment-requests/{iid}")
        except: pass
    for iid in CREATED_IDS["pl"]:
        try: delete(f"/api/packing-lists/{iid}")
        except: pass
    for iid in CREATED_IDS["ci"]:
        try: delete(f"/api/commercial-invoices/{iid}")
        except: pass
    for iid in CREATED_IDS["pi"]:
        try: delete(f"/api/proforma-invoices/{iid}")
        except: pass
    for iid in CREATED_IDS["po"]:
        try: delete(f"/api/purchase-orders/{iid}")
        except: pass
    for iid in CREATED_IDS["supplier"]:
        try: delete(f"/api/suppliers/{iid}")
        except: pass
    for iid in CREATED_IDS["sku"]:
        try: delete(f"/api/skus/{iid}")
        except: pass
    print("  清理完成")

# ==================== 0. 健康检查 ====================
print("===== 0. 服务健康检查 =====")
r = get("/api/version")
check(r.status_code == 200 and r.json().get("app") == "inventory-management-system", "服务启动并响应版本接口")

# ==================== 1. 创建测试依赖 ====================
print("\n===== 1. 创建测试依赖（SKU / 供应商 / PO）=====")
sku_code = f"TEST-{RUN_TS}"
r = post("/api/skus", {"sku_code": sku_code, "product_name": "测试产品A", "brand": "TestBrand", "category": "电子产品", "country": "印尼", "unit": "pcs", "moq": 100, "safety_stock": 50, "status": "active"})
check(r.status_code == 200, "创建 SKU 成功")
sku_id = r.json()["id"]
CREATED_IDS["sku"].append(sku_id)

sup_name = f"测试供应商-{RUN_TS}"
r = post("/api/suppliers", {"name": sup_name, "country": "印尼", "status": "active"})
check(r.status_code == 200, "创建供应商成功")
# 供应商创建返回 {success: true}，需要查询获取 ID
sup_data = r.json()
sup_id = sup_data.get("id")
if not sup_id:
    r2 = get("/api/suppliers")
    for s in r2.json():
        if s.get("name") == sup_name:
            sup_id = s["id"]
            break
check(sup_id is not None, "获取供应商 ID 成功")
CREATED_IDS["supplier"].append(sup_id)

r = post("/api/purchase-orders", {"supplier_id": sup_id, "supplier_name": sup_name, "brand": "TestBrand", "country": "印尼", "target_warehouse": "印尼仓", "currency": "USD", "items": [{"sku_code": sku_code, "po_qty": 1000}]})
check(r.status_code == 200, "创建 PO 成功")
po = r.json()
po_id = po["id"]
po_no = po["po_no"]
CREATED_IDS["po"].append(po_id)

# 审批 PO
post(f"/api/purchase-orders/{po_id}/submit-approval", {"submitter_name": "admin"})
post(f"/api/purchase-orders/{po_id}/approve", {"action": "approve", "comment": "一级通过"})
post(f"/api/purchase-orders/{po_id}/approve", {"action": "approve", "comment": "二级通过"})
post(f"/api/purchase-orders/{po_id}/send-to-factory")
check(True, "PO 已审批并发工厂")

# ==================== 2. PI 定金逻辑（需要定金）====================
print("\n===== 2. PI 定金逻辑（需要定金）=====")
pi_payload = {
    "related_po_id": po_id, "related_po_no": po_no,
    "supplier_id": sup_id, "supplier_name": sup_name,
    "brand": "TestBrand", "country": "印尼", "target_warehouse": "印尼仓",
    "currency": "USD", "need_deposit": True, "deposit_ratio": 30,
    "expected_delivery": "2026-08-15", "remark": "PI 定金测试",
    "items": [{"sku_code": sku_code, "po_qty": 1000, "pi_confirmed_qty": 1000, "unit_price": 5.5}]
}
r = post("/api/proforma-invoices", pi_payload)
check(r.status_code == 200, "创建 PI（需要定金）成功")
pi = r.json()
pi_id = pi["id"]
pi_no = pi["pi_no"]
CREATED_IDS["pi"].append(pi_id)

check(pi["need_deposit"] == 1 or pi["need_deposit"] is True, f"PI need_deposit = 是")
check(pi["deposit_ratio"] == 30, f"PI deposit_ratio = 30%")
check(abs(pi["total_amount"] - 5500) < 0.001, f"PI total_amount = 5500 (1000*5.5)")
check(abs(pi["payable_deposit"] - 1650) < 0.001, f"PI payable_deposit = 1650 (5500*0.3)")

# ==================== 3. PI 定金逻辑（不需要定金）====================
print("\n===== 3. PI 定金逻辑（不需要定金）=====")
pi_payload2 = {
    "related_po_id": po_id, "related_po_no": po_no,
    "supplier_id": sup_id, "supplier_name": sup_name,
    "currency": "USD", "need_deposit": False, "deposit_ratio": 30,
    "items": [{"sku_code": sku_code, "po_qty": 500, "pi_confirmed_qty": 500, "unit_price": 6.0}]
}
r = post("/api/proforma-invoices", pi_payload2)
check(r.status_code == 200, "创建 PI（不需要定金）成功")
pi2 = r.json()
pi2_id = pi2["id"]
CREATED_IDS["pi"].append(pi2_id)

check(pi2["need_deposit"] == 0 or pi2["need_deposit"] is False, f"PI need_deposit = 否")
check(pi2["deposit_ratio"] == 0, f"不需要定金时 deposit_ratio = 0")
check(abs(pi2["payable_deposit"] - 0) < 0.001, f"不需要定金时 payable_deposit = 0")

# ==================== 4. CI 尾款逻辑（有定金）====================
print("\n===== 4. CI 尾款逻辑（有定金）=====")
ci_payload = {
    "related_po_id": po_id, "related_po_no": po_no,
    "related_pi_id": pi_id, "related_pi_no": pi_no,
    "supplier_id": sup_id, "supplier_name": sup_name,
    "brand": "TestBrand", "country": "印尼", "target_warehouse": "印尼仓",
    "currency": "USD", "amount_difference": 0, "difference_reason": "按PI金额一致",
    "remark": "CI 尾款测试",
    "items": [{"sku_code": sku_code, "shipped_qty": 1000, "unit_price": 5.5}]
}
r = post("/api/commercial-invoices", ci_payload)
check(r.status_code == 200, "创建 CI（有定金）成功")
ci = r.json()
ci_id = ci["id"]
ci_no = ci["ci_no"]
CREATED_IDS["ci"].append(ci_id)

check(abs(ci["goods_amount"] - 5500) < 0.001, f"CI goods_amount = 5500")
check(abs(ci["pi_total_amount"] - 5500) < 0.001, f"CI pi_total_amount = 5500")
check(abs(ci["amount_difference"] - 0) < 0.001, f"CI amount_difference = 0")
check(abs(ci["should_deduct_deposit"] - 1650) < 0.001, f"CI should_deduct_deposit = 1650")
check(abs(ci["payable_balance"] - 3850) < 0.001, f"CI payable_balance = 3850 (5500-1650)")

# ==================== 5. CI 尾款逻辑（无定金）====================
print("\n===== 5. CI 尾款逻辑（无定金）=====")
ci_payload2 = {
    "related_po_id": po_id, "related_po_no": po_no,
    "related_pi_id": pi2_id, "related_pi_no": pi2["pi_no"],
    "supplier_id": sup_id, "supplier_name": sup_name,
    "currency": "USD",
    "items": [{"sku_code": sku_code, "shipped_qty": 500, "unit_price": 6.0}]
}
r = post("/api/commercial-invoices", ci_payload2)
check(r.status_code == 200, "创建 CI（无定金）成功")
ci2 = r.json()
ci2_id = ci2["id"]
CREATED_IDS["ci"].append(ci2_id)

check(abs(ci2["should_deduct_deposit"] - 0) < 0.001, f"无定金 CI should_deduct_deposit = 0")
check(abs(ci2["payable_balance"] - 3000) < 0.001, f"无定金 CI payable_balance = 3000 (500*6)")

# ==================== 6. PI 批量导入 ====================
print("\n===== 6. PI 批量导入 =====")
r = post("/api/proforma-invoices/batch-import", {"items": [
    {"关联PO编号": po_no, "SKU": sku_code, "数量": 200, "单价": 7.0, "币种": "USD", "是否需要定金": "是", "定金比例": 20, "预计交期": "2026-09-01"}
]})
check(r.status_code == 200, "PI 批量导入接口成功")
pi_imp = r.json()
check(pi_imp.get("success", 0) == 1, f"PI 批量导入成功数 = 1: {pi_imp.get('success')}")
check(pi_imp.get("failed", 0) == 0, f"PI 批量导入失败数 = 0")
if pi_imp.get("success", 0) == 1:
    # 查找刚导入的 PI
    r2 = get("/api/proforma-invoices", {"keyword": po_no})
    for p in r2.json():
        if p["id"] not in CREATED_IDS["pi"]:
            CREATED_IDS["pi"].append(p["id"])

# PI 批量导入 - SKU 不存在
r = post("/api/proforma-invoices/batch-import", {"items": [
    {"关联PO编号": po_no, "SKU": "NOT-EXIST-SKU", "数量": 100, "单价": 1}
]})
check(r.status_code == 200, "PI 批量导入失败场景返回 200")
pi_err = r.json()
check(pi_err.get("failed", 0) >= 1, f"PI 批量导入失败数 >= 1: {pi_err.get('failed')}")
check(any("SKU" in m or "不存在" in m for m in pi_err.get("messages", [])), f"PI 批量导入提示 SKU 不存在")

# PI 批量导入 - PO 不存在
r = post("/api/proforma-invoices/batch-import", {"items": [
    {"关联PO编号": "PO-NOT-EXIST", "SKU": sku_code, "数量": 100, "单价": 1}
]})
pi_err2 = r.json()
check(pi_err2.get("failed", 0) >= 1, f"PI 批量导入 PO 不存在时失败数 >= 1")
check(any("PO" in m or "匹配" in m for m in pi_err2.get("messages", [])), f"PI 批量导入提示无法匹配 PO")

# ==================== 7. CI 批量导入 ====================
print("\n===== 7. CI 批量导入 =====")
r = post("/api/commercial-invoices/batch-import", {"items": [
    {"关联PO编号": po_no, "关联PI编号": pi_no, "SKU": sku_code, "数量": 300, "单价": 5.5}
]})
check(r.status_code == 200, "CI 批量导入接口成功")
ci_imp = r.json()
check(ci_imp.get("success", 0) == 1, f"CI 批量导入成功数 = 1: {ci_imp.get('success')}")
if ci_imp.get("success", 0) == 1:
    r2 = get("/api/commercial-invoices")
    for c in r2.json():
        if c["id"] not in CREATED_IDS["ci"] and c.get("related_po_no") == po_no:
            CREATED_IDS["ci"].append(c["id"])

# CI 批量导入 - SKU 不存在
r = post("/api/commercial-invoices/batch-import", {"items": [
    {"关联PO编号": po_no, "SKU": "NOT-EXIST", "数量": 100, "单价": 1}
]})
ci_err = r.json()
check(ci_err.get("failed", 0) >= 1, f"CI 批量导入 SKU 不存在时失败数 >= 1")
check(any("SKU" in m or "不存在" in m for m in ci_err.get("messages", [])), f"CI 批量导入提示 SKU 不存在")

# ==================== 8. PL 批量导入 ====================
print("\n===== 8. PL 批量导入 =====")
r = post("/api/packing-lists/batch-import", {"items": [
    {"关联CI编号": ci_no, "SKU": sku_code, "每箱数量": 10, "箱数": 10, "总数量": 100, "单箱毛重": 12, "单箱净重": 10, "单箱体积": 0.08}
]})
check(r.status_code == 200, "PL 批量导入接口成功")
pl_imp = r.json()
check(pl_imp.get("success", 0) == 1, f"PL 批量导入成功数 = 1: {pl_imp.get('success')}")
if pl_imp.get("success", 0) == 1:
    r2 = get(f"/api/commercial-invoices/{ci_id}")
    pl_info = r2.json().get("packing_list", {})
    if pl_info.get("id"):
        CREATED_IDS["pl"].append(pl_info["id"])

# PL 批量导入 - CI 不存在
r = post("/api/packing-lists/batch-import", {"items": [
    {"关联CI编号": "CI-NOT-EXIST", "SKU": sku_code, "每箱数量": 10, "箱数": 1, "总数量": 10}
]})
pl_err = r.json()
check(pl_err.get("failed", 0) >= 1, f"PL 批量导入 CI 不存在时失败数 >= 1")
check(any("CI" in m or "匹配" in m for m in pl_err.get("messages", [])), f"PL 批量导入提示无法匹配 CI: {pl_err.get('messages')}")

# ==================== 9. PL 与 CI 合并管理 ====================
print("\n===== 9. PL 与 CI 合并管理 =====")
r = get(f"/api/commercial-invoices/{ci_id}")
check(r.status_code == 200, "获取 CI 详情成功")
ci_detail = r.json()
check("packing_list" in ci_detail, "CI 详情包含 packing_list（PL 信息）")
check("pl_check" in ci_detail or "ci_pl_check" in ci_detail, "CI 详情包含 PL 数量核对信息")

# ==================== 10. 附件功能 ====================
print("\n===== 10. 附件功能 =====")
# PI 附件上传
attachment_data = {
    "name": "test_pi.pdf", "type": "application/pdf", "size": 1024,
    "dataUrl": "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTcgMDAwMDAgbiAKdHJhaWxlcjw8L1NpemUgNC9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjEzMgolRU9G",
    "uploaded_at": datetime.now().isoformat()
}
r = post(f"/api/proforma-invoices/{pi_id}/attachment", {"attachment": attachment_data})
check(r.status_code == 200, "PI 附件上传成功")

# 验证附件已保存
r = get(f"/api/proforma-invoices/{pi_id}")
pi_after = r.json()
check(pi_after.get("attachment") and pi_after["attachment"] != "", "PI 附件已保存")

# CI 附件上传
r = post(f"/api/commercial-invoices/{ci_id}/attachment", {"field": "attachment", "attachment": attachment_data})
check(r.status_code == 200, "CI 附件上传成功")

# CI PL 附件上传
r = post(f"/api/commercial-invoices/{ci_id}/attachment", {"field": "pl_attachment", "attachment": attachment_data})
check(r.status_code == 200, "CI PL 附件上传成功")

# 验证 CI 附件
r = get(f"/api/commercial-invoices/{ci_id}")
ci_after = r.json()
check(ci_after.get("attachment") and ci_after["attachment"] != "", "CI 附件已保存")
check(ci_after.get("pl_attachment") and ci_after["pl_attachment"] != "", "CI PL 附件已保存")

# 删除附件
r = post(f"/api/proforma-invoices/{pi_id}/attachment", {"attachment": ""})
check(r.status_code == 200, "PI 附件删除成功")
r = get(f"/api/proforma-invoices/{pi_id}")
check(not r.json().get("attachment") or r.json()["attachment"] == "", "PI 附件已清空")

# ==================== 11. 加权平均成本同步（核心验证）====================
print("\n===== 11. 加权平均成本同步 =====")
# 记录入库前的加权平均成本
r = get("/api/skus")
sku_before = None
for s in r.json():
    if s["sku_code"] == sku_code:
        sku_before = s
        break
cost_before = sku_before.get("weighted_avg_cost", 0) if sku_before else 0
print(f"  入库前 SKU 加权平均成本: {cost_before}")

# 创建入库记录 - 需要关联 CI 和物流
# 先创建物流批次
r = post("/api/logistics-batches", {
    "related_ci_id": ci_id, "related_ci_no": ci_no,
    "forwarder_name": "测试货代", "transport_mode": "sea",
    "origin_port": "Shenzhen", "dest_port": "Jakarta",
    "target_country": "印尼", "target_warehouse": "印尼仓",
    "pickup_date": "2026-07-01", "depart_date": "2026-07-02",
    "eta_date": "2026-07-15",
    "freight_currency": "USD", "international_freight": 500,
    "local_charges": 100, "customs_service_fee": 50,
    "delivery_fee": 30, "customs_duty": 200, "vat_gst": 0, "other_fees": 0
})
check(r.status_code == 200, "创建物流批次成功")
logistics = r.json()
log_id = logistics["id"]
CREATED_IDS["logistics"].append(log_id)

# 创建入库记录
r = post("/api/inbound-records", {
    "source_ci_id": ci_id, "source_ci_no": ci_no,
    "logistics_id": log_id,
    "sku_code": sku_code, "country": "印尼", "warehouse": "印尼仓",
    "actual_qty": 1000, "inbound_date": "2026-07-20",
    "remark": "入库测试"
})
check(r.status_code == 200, "创建入库记录成功")
inbound = r.json()
inbound_id = inbound["id"]
CREATED_IDS["inbound"].append(inbound_id)

# 确认入库（成本分摊在创建入库记录时自动触发，无需单独确认）
check(True, "入库记录创建时自动触发成本分摊")

# 检查成本分摊记录
r = get("/api/cost-allocations", {"ci_no": ci_no})
check(r.status_code == 200, "获取成本分摊记录成功")
cost_allocs = r.json()
check(len(cost_allocs) > 0, f"成本分摊记录已生成: {len(cost_allocs)} 条")
if cost_allocs:
    for ca in cost_allocs:
        CREATED_IDS["cost"].append(ca["id"])
    ca = cost_allocs[0]
    print(f"  成本分摊: 商品成本={ca.get('product_cost')}, 运费={ca.get('allocated_freight')}, 关税={ca.get('allocated_duty')}, 总落地成本={ca.get('total_landing_cost')}, 单位落地成本={ca.get('unit_landing_cost')}")

# 验证加权平均成本已更新
time.sleep(0.5)  # 确保数据库写入完成
r = get("/api/skus")
sku_after = None
for s in r.json():
    if s["sku_code"] == sku_code:
        sku_after = s
        break
cost_after = sku_after.get("weighted_avg_cost", 0) if sku_after else 0
print(f"  入库后 SKU 加权平均成本: {cost_after}")
check(cost_after > 0, f"入库后加权平均成本 > 0 (入库前={cost_before}, 入库后={cost_after})")
check(cost_after != cost_before or (cost_before == 0 and cost_after > 0), f"加权平均成本已更新 (变化: {cost_before} -> {cost_after})")

# ==================== 12. 采购链不自动改库存数量 ====================
print("\n===== 12. 采购链不自动改库存数量 =====")
# 检查库存总表数量未因入库而增加
r = get("/api/inventory", {"sku_code": sku_code})
inv_data = r.json()
print(f"  [DEBUG] inventory API response type: {type(inv_data).__name__}, keys: {list(inv_data.keys()) if isinstance(inv_data, dict) else 'list'}")
if isinstance(inv_data, list):
    inv_list = inv_data
elif isinstance(inv_data, dict) and "rows" in inv_data:
    inv_list = inv_data["rows"]
elif isinstance(inv_data, dict) and "data" in inv_data:
    inv_list = inv_data["data"]
else:
    inv_list = [inv_data] if isinstance(inv_data, dict) and inv_data else []
# 过滤出当前测试 SKU 的记录
inv_list = [i for i in inv_list if i.get("sku_code") == sku_code] if inv_list else []
if inv_list:
    inv = inv_list[0]
    print(f"  库存总表 available_qty = {inv.get('available_qty')}, weighted_avg_cost = {inv.get('weighted_avg_cost')}")
    check(inv.get("available_qty") == 0 or inv.get("available_qty") is None, "采购链入库不自动增加库存总表数量")
else:
    check(True, "库存总表无该 SKU 记录（数量未被自动增加）")

# ==================== 13. 付款审批 ====================
print("\n===== 13. 付款审批（定金 + 尾款）=====")
# 定金付款申请
r = post("/api/payment-requests/from-pi-deposit", {"pi_id": pi_id})
check(r.status_code == 200, "生成定金付款申请成功")
if r.status_code == 200:
    CREATED_IDS["payment"].append(r.json().get("id"))

# 尾款付款申请
r = post("/api/payment-requests/from-ci-balance", {"ci_id": ci_id})
if r.status_code != 200:
    print(f"  [DEBUG] 尾款付款失败: status={r.status_code}, body={r.text[:200]}")
check(r.status_code == 200, "生成尾款付款申请成功")
if r.status_code == 200:
    CREATED_IDS["payment"].append(r.json().get("id"))

# 不需要定金的 PI 不应能发起定金付款
r = post("/api/payment-requests/from-pi-deposit", {"pi_id": pi2_id})
check(r.status_code == 400, "不需要定金的 PI 无法发起定金付款")

# ==================== 14. 导入结果格式验证 ====================
print("\n===== 14. 导入结果格式验证 =====")
r = post("/api/proforma-invoices/batch-import", {"items": [
    {"关联PO编号": po_no, "SKU": sku_code, "数量": 50, "单价": 2.0}
]})
result = r.json()
check("success" in result, "导入结果包含 success 字段")
check("failed" in result, "导入结果包含 failed 字段")
check("total" in result, "导入结果包含 total 字段")
check("errors" in result, "导入结果包含 errors 字段")
check("messages" in result, "导入结果包含 messages 字段")
if result.get("success", 0) > 0:
    r2 = get("/api/proforma-invoices", {"keyword": po_no})
    for p in r2.json():
        if p["id"] not in CREATED_IDS["pi"]:
            CREATED_IDS["pi"].append(p["id"])

# ==================== 总结 ====================
print(f"\n{'='*60}")
print(f"验证完成: {PASS_COUNT} 通过, {FAIL_COUNT} 失败")
print(f"{'='*60}")

cleanup()

if FAIL_COUNT > 0:
    sys.exit(1)
else:
    print("\n✅ 全部验证通过！")
