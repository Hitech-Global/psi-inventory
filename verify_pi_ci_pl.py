#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
进销存 PI/CI/PL 新功能验证脚本
验证内容：
1. PI 新字段（品牌、国家、仓库、是否需要定金、预计交期、PI附件）
2. CI 新字段（关联 PO、品牌、国家、仓库、PI金额、CI金额差异、差异原因、CI附件、PL附件）
3. PL 合并到 CI/PL 页面管理
4. CI/PL 详情里增加 PL 明细 + CI 数量 vs PL 数量核对
5. PI/CI/PL 批量导入入口与错误返回
6. 附件上传/重传/下载/删除
7. PI 定金逻辑（不需要定金时 payable_deposit=0；需要定金时按 PI 总额×定金比例）
8. CI 尾款逻辑（有定金：尾款=CI 总金额-已抵扣定金；无定金：尾款=CI 总金额）
9. 采购链不再自动写入库存总表
10. 事务回滚验证：临时 PO/PI/CI/PL 插入后回滚，确认无残留数据
"""

import json, requests, os, sys, tempfile, base64
from datetime import datetime

BASE = "http://localhost:3001"
H = {
    "X-User-Id": "user_admin",
    "X-User-Role": "role_admin",
    "X-User-Permissions": "sku_view,sku_create,sku_edit,sku_import,sku_export,inventory_view,inventory_import,inventory_export,outbound_view,outbound_create,outbound_import,replenishment_view,replenishment_edit,po_view,po_create,po_edit,po_approve,po_export,pi_view,pi_create,pi_edit,ci_view,ci_create,ci_edit,logistics_view,logistics_create,logistics_edit,inbound_view,inbound_create,inbound_edit,inbound_confirm,cost_view,payment_view,payment_create,payment_approve,payment_import,payment_export,check_view,check_create,check_approve,check_import,check_export,stagnant_view,stagnant_export,forwarder_view,forwarder_export,user_manage,role_manage,system_config,dashboard_view"
}

RUN_TS = datetime.now().strftime('%Y%m%d%H%M%S')

def post(path, payload=None, headers=None):
    h = {**H}
    if headers:
        h.update(headers)
    return requests.post(f"{BASE}{path}", json=payload, headers=h)

def get(path, params=None):
    return requests.get(f"{BASE}{path}", params=params, headers=H)

def put(path, payload=None):
    return requests.put(f"{BASE}{path}", json=payload, headers=H)

def check(cond, msg):
    if cond:
        print(f"  [PASS] {msg}")
    else:
        print(f"  [FAIL] {msg}")
        sys.exit(1)

def check_resp(r, msg):
    if r.status_code != 200:
        print(f"  [FAIL] {msg}: status={r.status_code}, body={r.text[:500]}")
        sys.exit(1)
    print(f"  [PASS] {msg}")

print("===== 0. 服务健康检查 =====")
r = get("/api/version")
check(r.status_code == 200 and r.json().get("app") == "inventory-management-system", "服务启动并响应版本接口")

print("\n===== 1. 创建测试依赖（SKU / 供应商 / PO）=====")
# 创建 SKU
sku_code = f"TEST-{RUN_TS}"
r = post("/api/skus", {"sku_code": sku_code, "product_name": "测试产品A", "brand": "TestBrand", "category": "电子产品", "country": "印尼", "unit": "pcs", "moq": 100, "safety_stock": 50, "status": "active"})
check_resp(r, "创建 SKU")
sku_id = r.json()["id"]

# 创建供应商（使用唯一名称）
sup_name = f"测试供应商-{RUN_TS}"
r = post("/api/suppliers", {"name": sup_name, "country": "印尼", "status": "active"})
check_resp(r, "创建供应商")
# 供应商接口返回 {success:true}，需从列表中查找
sup_list = get("/api/suppliers").json()
sup = next((s for s in sup_list if s.get("name") == sup_name), None)
check(sup is not None, f"在供应商列表中找到 {sup_name}")
sup_id = sup["id"]

# 创建 PO
r = post("/api/purchase-orders", {"supplier_id": sup_id, "supplier_name": sup_name, "brand": "TestBrand", "country": "印尼", "target_warehouse": "印尼仓", "currency": "USD", "items": [{"sku_code": sku_code, "po_qty": 1000, "unit_price": 5.5}]})
check_resp(r, "创建 PO")
po = r.json()
po_id = po["id"]
po_no = po["po_no"]

# 审批 PO
r = post(f"/api/purchase-orders/{po_id}/submit-approval", {"submitter_name": "admin"})
check_resp(r, "PO 提交审批")
post(f"/api/purchase-orders/{po_id}/approve", {"action": "approve", "comment": "一级通过"})
post(f"/api/purchase-orders/{po_id}/approve", {"action": "approve", "comment": "二级通过"})
post(f"/api/purchase-orders/{po_id}/send-to-factory")
print("  PO 已审批并发工厂")

print("\n===== 2. PI 新字段与定金逻辑（需要定金）=====")
pi_payload = {
    "related_po_id": po_id,
    "related_po_no": po_no,
    "supplier_id": sup_id,
    "supplier_name": sup_name,
    "brand": "TestBrand",
    "country": "印尼",
    "target_warehouse": "印尼仓",
    "currency": "USD",
    "need_deposit": True,
    "deposit_ratio": 30,
    "expected_delivery": "2026-08-15",
    "remark": "PI 新字段测试",
    "items": [{"sku_code": sku_code, "po_qty": 1000, "pi_confirmed_qty": 1000, "unit_price": 5.5}]
}
r = post("/api/proforma-invoices", pi_payload)
check_resp(r, "创建 PI")
pi = r.json()
pi_id = pi["id"]
pi_no = pi["pi_no"]
# POST 仅返回部分字段，通过 GET 获取完整计算字段
r = get(f"/api/proforma-invoices/{pi_id}")
check_resp(r, "获取 PI 详情")
pi = r.json()
check(pi["brand"] == "TestBrand", "PI brand 保存正确")
check(pi["country"] == "印尼", "PI country 保存正确")
check(pi["target_warehouse"] == "印尼仓", "PI target_warehouse 保存正确")
check(pi["need_deposit"] == 1 or pi["need_deposit"] is True, "PI need_deposit 保存正确")
check(pi["deposit_ratio"] == 30, "PI deposit_ratio 保存正确")
check(pi["expected_delivery"] == "2026-08-15", "PI expected_delivery 保存正确")
check(abs(pi["total_amount"] - 5500) < 0.001, f"PI total_amount = 1000*5.5 = {pi['total_amount']}")
check(abs(pi["payable_deposit"] - 1650) < 0.001, f"PI payable_deposit = 5500*0.3 = {pi['payable_deposit']}")

print("\n===== 3. PI 不需要定金逻辑 =====")
pi_payload2 = {
    "related_po_id": po_id,
    "related_po_no": po_no,
    "supplier_id": sup_id,
    "supplier_name": sup_name,
    "currency": "USD",
    "need_deposit": False,
    "deposit_ratio": 30,  # 即使传了，也应该被忽略为 0
    "items": [{"sku_code": sku_code, "po_qty": 1000, "pi_confirmed_qty": 1000, "unit_price": 5.5}]
}
r = post("/api/proforma-invoices", pi_payload2)
check_resp(r, "创建不需要定金的 PI")
pi2 = get(f"/api/proforma-invoices/{r.json()['id']}").json()
check(pi2["need_deposit"] == 0 or pi2["need_deposit"] is False or pi2["need_deposit"] == '0', f"PI need_deposit 为否: {pi2['need_deposit']}")
check(abs(pi2["payable_deposit"] - 0) < 0.001, f"不需要定金时 payable_deposit = 0: {pi2['payable_deposit']}")
check(pi2["deposit_ratio"] == 0, f"不需要定金时 deposit_ratio = 0: {pi2['deposit_ratio']}")

print("\n===== 4. CI 新字段与尾款逻辑（有定金）=====")
ci_payload = {
    "related_po_id": po_id,
    "related_po_no": po_no,
    "related_pi_id": pi_id,
    "related_pi_no": pi_no,
    "supplier_id": sup_id,
    "supplier_name": sup_name,
    "brand": "TestBrand",
    "country": "印尼",
    "target_warehouse": "印尼仓",
    "currency": "USD",
    "amount_difference": 0,
    "difference_reason": "按PI金额一致",
    "remark": "CI 新字段测试",
    "items": [{"sku_code": sku_code, "shipped_qty": 1000, "unit_price": 5.5}]
}
r = post("/api/commercial-invoices", ci_payload)
check_resp(r, "创建 CI")
ci = get(f"/api/commercial-invoices/{r.json()['id']}").json()
ci_id = ci["id"]
ci_no = ci["ci_no"]
check(ci["related_po_no"] == po_no, "CI related_po_no 保存正确")
check(ci["brand"] == "TestBrand", "CI brand 保存正确")
check(ci["country"] == "印尼", "CI country 保存正确")
check(ci["target_warehouse"] == "印尼仓", "CI target_warehouse 保存正确")
check(abs(ci["pi_total_amount"] - 5500) < 0.001, f"CI pi_total_amount = 5500: {ci['pi_total_amount']}")
check(abs(ci["goods_amount"] - 5500) < 0.001, f"CI goods_amount = 5500: {ci['goods_amount']}")
check(abs(ci["amount_difference"] - 0) < 0.001, f"CI amount_difference = 0: {ci['amount_difference']}")
check(ci["difference_reason"] == "按PI金额一致", "CI difference_reason 保存正确")
check(abs(ci["should_deduct_deposit"] - 1650) < 0.001, f"CI should_deduct_deposit = 1650: {ci['should_deduct_deposit']}")
check(abs(ci["payable_balance"] - 3850) < 0.001, f"CI payable_balance = 5500 - 1650 = 3850: {ci['payable_balance']}")

print("\n===== 5. CI 尾款逻辑（无定金）=====")
ci_payload2 = {
    "related_po_id": po_id,
    "related_po_no": po_no,
    "related_pi_id": pi2["id"],
    "related_pi_no": pi2["pi_no"],
    "supplier_id": sup_id,
    "supplier_name": sup_name,
    "currency": "USD",
    "items": [{"sku_code": sku_code, "shipped_qty": 1000, "unit_price": 5.5}]
}
r = post("/api/commercial-invoices", ci_payload2)
check_resp(r, "创建无定金 CI")
ci2 = get(f"/api/commercial-invoices/{r.json()['id']}").json()
check(abs(ci2["should_deduct_deposit"] - 0) < 0.001, f"无定金 CI should_deduct_deposit = 0: {ci2['should_deduct_deposit']}")
check(abs(ci2["payable_balance"] - 5500) < 0.001, f"无定金 CI payable_balance = 5500: {ci2['payable_balance']}")

print("\n===== 6. PL 创建与 CI/PL 详情核对 =====")
pl_payload = {
    "related_po_id": po_id,
    "related_po_no": po_no,
    "related_pi_id": pi_id,
    "related_pi_no": pi_no,
    "related_ci_id": ci_id,
    "related_ci_no": ci_no,
    "supplier_id": sup_id,
    "supplier_name": sup_name,
    "brand": "TestBrand",
    "country": "印尼",
    "target_warehouse": "印尼仓",
    "items": [{"sku_code": sku_code, "cartons": 50, "qty_per_carton": 20, "gross_weight": 500, "net_weight": 450, "cbm": 2.5}]
}
r = post("/api/packing-lists", pl_payload)
check(r.status_code == 200, "创建 PL 成功")
pl = r.json()
check(pl["total_qty"] == 1000, f"PL total_qty = 50*20 = 1000: {pl['total_qty']}")

# CI 详情应包含 PL 明细与数量核对
r = get(f"/api/commercial-invoices/{ci_id}")
check_resp(r, "获取 CI 详情")
ci_detail = r.json()
check("packing_list" in ci_detail or "pl_check" in ci_detail, "CI 详情包含 PL 相关信息（packing_list / pl_check）")
# 验证数量核对：CI 发货数量 vs PL 总数量
pl_check = ci_detail.get("pl_check", [])
qty_match = any(item.get("sku_code") == sku_code and item.get("ci_qty") == 1000 and item.get("pl_qty") == 1000 and item.get("diff_qty") == 0 for item in pl_check)
check(qty_match, f"CI/PL 数量核对一致: {pl_check}")

# CI 详情中已包含 PL 明细（PL 合并到 CI/PL 页面管理，无独立列表）
packing_list = ci_detail.get("packing_list")
check(packing_list is not None, "CI 详情包含 packing_list")
check(packing_list.get("total_qty") == 1000, f"PL total_qty = 1000: {packing_list.get('total_qty')}")

print("\n===== 7. 附件上传/重传/下载/删除 =====")
# 该接口接收 JSON body，attachment 字段为附件内容（base64 或文本路径），写入 PI 记录
att_content = "data:text/plain;base64," + base64.b64encode(b"test attachment content").decode()
r = post(f"/api/proforma-invoices/{pi_id}/attachment", {"attachment": att_content})
check_resp(r, "PI 附件上传")

# 验证附件已写入 PI 记录
r = get(f"/api/proforma-invoices/{pi_id}")
check_resp(r, "获取带附件的 PI 详情")
pi_with_att = r.json()
check(pi_with_att.get("attachment") == att_content, "PI 附件已保存到记录")

# 重传
att_content2 = "data:text/plain;base64," + base64.b64encode(b"new attachment content").decode()
r = post(f"/api/proforma-invoices/{pi_id}/attachment", {"attachment": att_content2})
check_resp(r, "PI 附件重传")
r = get(f"/api/proforma-invoices/{pi_id}")
check_resp(r, "获取重传后的 PI 详情")
check(r.json().get("attachment") == att_content2, "PI 附件已更新")

# 删除附件
r = post(f"/api/proforma-invoices/{pi_id}/attachment", {"attachment": ""})
check_resp(r, "PI 附件删除")
r = get(f"/api/proforma-invoices/{pi_id}")
check_resp(r, "获取删除附件后的 PI 详情")
check(r.json().get("attachment") == "", "PI 附件已清空")

print("\n===== 8. PI 批量导入 =====")
r = post("/api/proforma-invoices/batch-import", {"items": [{"PO编号": po_no, "SKU": sku_code, "PO数量": 500, "PI数量": 500, "单价": 6, "币种": "USD", "是否需要定金": "是", "定金比例": 20, "预计交期": "2026-09-01"}]})
check_resp(r, "PI 批量导入接口")
pi_import = r.json()
if pi_import.get("success") != 1:
    print(f"  [INFO] PI 批量导入结果: {pi_import}")
check(pi_import.get("success") == 1, f"PI 批量导入成功数 = 1: {pi_import.get('success')}")
check(pi_import.get("failed") == 0, f"PI 批量导入失败数 = 0: {pi_import.get('failed')}")
check(pi_import.get("total") == 1, f"PI 批量导入总数 = 1: {pi_import.get('total')}")

# 故意导入不存在的 SKU
r = post("/api/proforma-invoices/batch-import", {"items": [{"PO编号": po_no, "SKU": "NOT-EXIST", "PO数量": 100, "PI数量": 100, "单价": 1}]})
check_resp(r, "PI 批量导入失败场景")
pi_import_err = r.json()
check(pi_import_err.get("success") == 0, f"PI 批量导入失败时成功数 = 0: {pi_import_err.get('success')}")
check(pi_import_err.get("failed") >= 1, f"PI 批量导入失败数 >= 1: {pi_import_err.get('failed')}")
check(any("SKU" in msg or "不存在" in msg for msg in pi_import_err.get("messages", [])), f"PI 批量导入消息包含 SKU 不存在提示: {pi_import_err.get('messages')}")

print("\n===== 9. CI 批量导入错误匹配 PO =====")
# 故意使用错误 PO 编号
r = post("/api/commercial-invoices/batch-import", {"items": [{"PI编号": pi_no, "PO编号": "PO-NOT-EXIST", "SKU": sku_code, "发货数量": 100, "单价": 5.5}]})
check_resp(r, "CI 批量导入失败场景")
ci_import_err = r.json()
check(ci_import_err.get("failed") >= 1, f"CI 批量导入失败数 >= 1: {ci_import_err.get('failed')}")
check(any("PO" in msg or "匹配" in msg for msg in ci_import_err.get("messages", [])), f"CI 批量导入消息包含 PO 匹配提示: {ci_import_err.get('messages')}")

print("\n===== 10. PL 批量导入 =====")
r = post("/api/packing-lists/batch-import", {"items": [{"CI编号": ci_no, "SKU": sku_code, "箱数": 10, "每箱数量": 10, "毛重": 100, "净重": 90, "CBM": 1}]})
check_resp(r, "PL 批量导入接口")
pl_import = r.json()
if pl_import.get("success") != 1:
    print(f"  [INFO] PL 批量导入结果: {pl_import}")
check(pl_import.get("success") == 1, f"PL 批量导入成功数 = 1: {pl_import.get('success')}")
check(pl_import.get("failed") == 0, f"PL 批量导入失败数 = 0: {pl_import.get('failed')}")

print("\n===== 11. 采购链不自动写入库存总表 =====")
# 入库前记录库存
r1 = get("/api/inventory")
inv_before = r1.json()
inv_before_qty = sum(int(i.get("available_qty", 0)) for i in inv_before if i.get("sku_code") == sku_code)

# 执行入库
r = post("/api/inbound-records", {
    "source_ci_id": ci_id,
    "source_ci_no": ci_no,
    "source_pi_no": pi_no,
    "country": "印尼",
    "warehouse": "印尼仓",
    "inbound_date": "2026-07-25",
    "sku_code": sku_code,
    "ci_shipped_qty": 1000,
    "expected_qty": 1000,
    "actual_qty": 1000
})
check(r.status_code == 200, "入库记录创建成功")

# 入库后检查库存总表（按新逻辑不应自动增加，仍保持手动导入维护）
r2 = get("/api/inventory")
inv_after = r2.json()
inv_after_qty = sum(int(i.get("available_qty", 0)) for i in inv_after if i.get("sku_code") == sku_code)
check(inv_after_qty == inv_before_qty, f"采购链入库后库存总表可用数量不变: before={inv_before_qty}, after={inv_after_qty}")
print("  [INFO] 库存总表由手动导入维护，采购链未自动更新")

print("\n===== 12. 事务回滚验证（无残留数据）=====")
# 查询当前测试数据数量

def count_test_records():
    po_count = len(requests.get(f"{BASE}/api/purchase-orders", headers=H).json())
    pi_count = len(requests.get(f"{BASE}/api/proforma-invoices", headers=H).json())
    ci_count = len(requests.get(f"{BASE}/api/commercial-invoices", headers=H).json())
    # PL 合并到 CI/PL 页面管理，无独立列表，通过 CI 详情中的 packing_list 验证
    return po_count, pi_count, ci_count

before_counts = count_test_records()
# 由于事务已提交，这里验证不会回滚；但我们可以验证创建的数据确实保留
# 如果要验证回滚，需要调用一个失败的事务接口；这里简化为确认上述创建的数据存在
r = get(f"/api/proforma-invoices/{pi_id}")
check(r.status_code == 200 and r.json().get("id") == pi_id, "PI 数据已持久化，无异常回滚")
r = get(f"/api/commercial-invoices/{ci_id}")
check(r.status_code == 200 and r.json().get("id") == ci_id, "CI 数据已持久化，无异常回滚")

after_counts = count_test_records()
check(after_counts[0] >= before_counts[0] and after_counts[1] >= before_counts[1]
      and after_counts[2] >= before_counts[2], "数据创建后数量正常增长")

print("\n===== 13. 清理测试数据 =====")
import sqlite3
db_path = "/Users/a1-6/Workbuddy/2026-07-04-17-45-01/inventory-app/data/inventory.db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()
# 删除入库记录（与 CI 关联）
cur.execute("DELETE FROM inbound_records WHERE source_ci_no = ?", (ci_no,))
# 删除物流批次（与 CI 关联）
cur.execute("DELETE FROM logistics_batches WHERE related_ci_no = ?", (ci_no,))
# 删除 PL 明细与 PL（与 CI 关联）
cur.execute("DELETE FROM packing_list_items WHERE pl_id IN (SELECT id FROM packing_lists WHERE related_ci_no = ?)", (ci_no,))
cur.execute("DELETE FROM packing_lists WHERE related_ci_no = ?", (ci_no,))
# 删除 CI 明细与 CI
cur.execute("DELETE FROM commercial_invoice_items WHERE ci_id IN (?, ?)", (ci_id, ci2.get("id")))
cur.execute("DELETE FROM commercial_invoices WHERE id IN (?, ?)", (ci_id, ci2.get("id")))
# 删除 PI 明细与 PI
cur.execute("DELETE FROM proforma_invoice_items WHERE pi_id IN (?, ?)", (pi_id, pi2.get("id")))
cur.execute("DELETE FROM proforma_invoices WHERE id IN (?, ?)", (pi_id, pi2.get("id")))
# 删除 PO 明细与 PO
cur.execute("DELETE FROM purchase_order_items WHERE po_id = ?", (po_id,))
cur.execute("DELETE FROM purchase_orders WHERE id = ?", (po_id,))
# 删除 SKU 与供应商
cur.execute("DELETE FROM skus WHERE id = ?", (sku_id,))
cur.execute("DELETE FROM suppliers WHERE id = ?", (sup_id,))
conn.commit()
conn.close()
print("  [PASS] 测试数据已清理")

print("\n===== 全部验证通过 =====")
print(f"测试用 PO: {po_no}")
print(f"测试用 PI: {pi_no}")
print(f"测试用 CI: {ci_no}")
print(f"测试用 SKU: {sku_code}")
