#!/bin/bash
# 完整业务流程测试脚本
BASE=http://localhost:3001
H='-H X-User-Id:user_admin -H X-User-Role:role_admin -H X-User-Permissions:sku_view,sku_create,sku_edit,sku_import,sku_export,inventory_view,inventory_import,inventory_export,outbound_view,outbound_create,outbound_import,replenishment_view,replenishment_edit,po_view,po_create,po_edit,po_approve,po_export,pi_view,pi_create,pi_edit,ci_view,ci_create,ci_edit,logistics_view,logistics_create,logistics_edit,inbound_view,inbound_create,inbound_edit,inbound_confirm,cost_view,payment_view,payment_create,payment_approve,payment_import,payment_export,check_view,check_create,check_approve,check_import,check_export,stagnant_view,stagnant_export,forwarder_view,forwarder_export,user_manage,role_manage,system_config,dashboard_view'

sleep 3

echo "===== 1. 创建SKU ====="
SKU=$(curl -s -X POST $BASE/api/skus $H -H 'Content-Type: application/json' -d '{"sku_code":"TEST-001","product_name":"测试产品A","brand":"TestBrand","category":"电子产品","country":"印尼","unit":"pcs","moq":100,"safety_stock":50,"status":"active"}')
echo "$SKU"
SKU_ID=$(echo "$SKU" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

echo ""
echo "===== 2. 创建供应商 ====="
curl -s -X POST $BASE/api/suppliers $H -H 'Content-Type: application/json' -d '{"name":"测试供应商A","country":"印尼","status":"active"}' > /dev/null
SUP=$(curl -s $BASE/api/suppliers $H)
SUP_ID=$(echo "$SUP" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
echo "供应商ID: $SUP_ID"

echo ""
echo "===== 3. 创建PO ====="
PO=$(curl -s -X POST $BASE/api/purchase-orders $H -H 'Content-Type: application/json' -d "{\"supplier_id\":\"$SUP_ID\",\"supplier_name\":\"测试供应商A\",\"brand\":\"TestBrand\",\"country\":\"印尼\",\"target_warehouse\":\"印尼仓\",\"currency\":\"USD\",\"items\":[{\"sku_code\":\"TEST-001\",\"po_qty\":1000,\"unit_price\":5.5}]}")
echo "$PO"
PO_ID=$(echo "$PO" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
PO_NO=$(echo "$PO" | python3 -c "import sys,json;print(json.load(sys.stdin)['po_no'])")

echo ""
echo "===== 4. PO提交审批 ====="
curl -s -X POST $BASE/api/purchase-orders/$PO_ID/submit-approval $H -H 'Content-Type: application/json' -d '{"submitter_name":"admin"}' > /dev/null
echo "已提交"

echo ""
echo "===== 5. PO一级审批 ====="
curl -s -X POST $BASE/api/purchase-orders/$PO_ID/approve $H -H 'Content-Type: application/json' -d '{"action":"approve","comment":"一级通过"}' > /dev/null
echo "一级通过"

echo ""
echo "===== 6. PO二级审批 ====="
curl -s -X POST $BASE/api/purchase-orders/$PO_ID/approve $H -H 'Content-Type: application/json' -d '{"action":"approve","comment":"二级通过"}' > /dev/null
echo "二级通过"

echo ""
echo "===== 7. PO发工厂 ====="
curl -s -X POST $BASE/api/purchase-orders/$PO_ID/send-to-factory $H > /dev/null
echo "已发工厂"

echo ""
echo "===== 8. 创建PI (30%定金) ====="
PI=$(curl -s -X POST $BASE/api/proforma-invoices $H -H 'Content-Type: application/json' -d "{\"related_po_id\":\"$PO_ID\",\"related_po_no\":\"$PO_NO\",\"supplier_id\":\"$SUP_ID\",\"supplier_name\":\"测试供应商A\",\"currency\":\"USD\",\"deposit_ratio\":30,\"items\":[{\"sku_code\":\"TEST-001\",\"po_qty\":1000,\"pi_confirmed_qty\":1000,\"unit_price\":5.5}]}")
echo "$PI"
PI_ID=$(echo "$PI" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
PI_NO=$(echo "$PI" | python3 -c "import sys,json;print(json.load(sys.stdin)['pi_no'])")

echo ""
echo "===== 9. 创建CI (全部发货) ====="
CI=$(curl -s -X POST $BASE/api/commercial-invoices $H -H 'Content-Type: application/json' -d "{\"related_pi_id\":\"$PI_ID\",\"related_pi_no\":\"$PI_NO\",\"supplier_id\":\"$SUP_ID\",\"supplier_name\":\"测试供应商A\",\"currency\":\"USD\",\"items\":[{\"sku_code\":\"TEST-001\",\"shipped_qty\":1000,\"unit_price\":5.5}]}")
echo "$CI"
CI_ID=$(echo "$CI" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
CI_NO=$(echo "$CI" | python3 -c "import sys,json;print(json.load(sys.stdin)['ci_no'])")

echo ""
echo "===== 10. 创建PL ====="
curl -s -X POST $BASE/api/packing-lists $H -H 'Content-Type: application/json' -d "{\"related_ci_id\":\"$CI_ID\",\"related_ci_no\":\"$CI_NO\",\"items\":[{\"sku_code\":\"TEST-001\",\"cartons\":50,\"qty_per_carton\":20,\"gross_weight\":500,\"net_weight\":450,\"cbm\":2.5}]}" > /dev/null
echo "PL已创建"

echo ""
echo "===== 11. 创建物流批次 ====="
LOG=$(curl -s -X POST $BASE/api/logistics-batches $H -H 'Content-Type: application/json' -d "{\"related_ci_id\":\"$CI_ID\",\"related_ci_no\":\"$CI_NO\",\"forwarder_name\":\"测试货代\",\"transport_mode\":\"sea\",\"target_country\":\"印尼\",\"target_warehouse\":\"印尼仓\",\"international_freight\":800,\"local_charges\":200,\"customs_service_fee\":100,\"delivery_fee\":50,\"customs_duty\":275,\"logistics_status\":\"in_transit\"}")
echo "$LOG"
LOG_NO=$(echo "$LOG" | python3 -c "import sys,json;print(json.load(sys.stdin)['batch_no'])")

echo ""
echo "===== 12. 入库 ====="
INBOUND=$(curl -s -X POST $BASE/api/inbound-records $H -H 'Content-Type: application/json' -d "{\"source_ci_id\":\"$CI_ID\",\"source_ci_no\":\"$CI_NO\",\"source_pi_no\":\"$PI_NO\",\"source_logistics_batch_no\":\"$LOG_NO\",\"country\":\"印尼\",\"warehouse\":\"印尼仓\",\"inbound_date\":\"2026-07-25\",\"sku_code\":\"TEST-001\",\"ci_shipped_qty\":1000,\"expected_qty\":1000,\"actual_qty\":1000}")
echo "$INBOUND"

echo ""
echo "===== 13. 验证成本分摊 ====="
curl -s $BASE/api/cost-allocations $H | python3 -c "
import sys,json
data=json.load(sys.stdin)
for c in data:
    print(f'  分摊基准: {c[\"allocation_basis\"]}')
    print(f'  商品成本: {c[\"product_cost\"]}')
    print(f'  分摊运费: {c[\"allocated_freight\"]}')
    print(f'  分摊关税: {c[\"allocated_duty\"]}')
    print(f'  总到岸成本: {c[\"total_landing_cost\"]}')
    print(f'  单位成本: {c[\"unit_landing_cost\"]}')
    print(f'  入库号: {c[\"inbound_no\"]}')
"

echo ""
echo "===== 14. 验证库存 ====="
curl -s $BASE/api/inventory $H | python3 -c "
import sys,json
data=json.load(sys.stdin)
for i in data:
    print(f'  SKU: {i[\"sku_code\"]}')
    print(f'  可用库存: {i[\"available_qty\"]}')
    print(f'  加权平均成本: {i[\"weighted_avg_cost\"]}')
    print(f'  库存价值: {i[\"inventory_value\"]}')
"

echo ""
echo "===== 15. 验证PI定金抵扣 ====="
curl -s $BASE/api/proforma-invoices $H | python3 -c "
import sys,json
data=json.load(sys.stdin)
for p in data:
    print(f'  总金额: {p[\"total_amount\"]}')
    print(f'  应付定金: {p[\"payable_deposit\"]}')
    print(f'  已抵扣: {p[\"deducted_deposit\"]}')
    print(f'  可抵扣: {p[\"available_deduct_deposit\"]}')
    print(f'  PI状态: {p[\"pi_status\"]}')
"

echo ""
echo "===== 16. 验证CI尾款 ====="
curl -s $BASE/api/commercial-invoices $H | python3 -c "
import sys,json
data=json.load(sys.stdin)
for c in data:
    print(f'  货值: {c[\"goods_amount\"]}')
    print(f'  应抵扣定金: {c.get(\"should_deduct_deposit\",0)}')
    print(f'  应付尾款: {c.get(\"payable_balance\",0)}')
    print(f'  CI状态: {c[\"ci_status\"]}')
"

echo ""
echo "===== 17. 验证看板 ====="
curl -s $BASE/api/dashboard $H | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'  库存总价值: {d[\"total_inventory_value\"]}')
print(f'  可用库存价值: {d[\"available_inventory_value\"]}')
"

echo ""
echo "===== 测试完成 ====="
