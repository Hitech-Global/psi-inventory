#!/usr/bin/env node
/**
 * Phase 3 综合验证脚本
 * 测试：统一付款管理、CI费用归集、原库存导入、费用分摊、加权平均成本更新、成本更新日志
 */

const http = require('http');
const Database = require('better-sqlite3');

// 清理之前的测试数据
const db = new Database('./data/inventory.db');
db.exec("DELETE FROM inventory WHERE sku_code IN ('TEST-PHASE3-001', 'TEST-PHASE3-002')");
db.exec("DELETE FROM cost_update_logs WHERE sku_code IN ('TEST-PHASE3-001', 'TEST-PHASE3-002')");
db.exec("DELETE FROM cost_allocations WHERE sku_code IN ('TEST-PHASE3-001', 'TEST-PHASE3-002')");
db.exec("DELETE FROM original_inventory_imports WHERE sku_code IN ('TEST-PHASE3-001', 'TEST-PHASE3-002')");
db.exec("UPDATE skus SET weighted_avg_cost = 0 WHERE sku_code IN ('TEST-PHASE3-001', 'TEST-PHASE3-002')");
db.close();
console.log('[清理] 旧测试数据已清除\n');

const HEADERS = {
  'Content-Type': 'application/json',
  'x-user-id': 'user_admin',
  'x-user-name': encodeURIComponent('admin'),
  'x-user-role': encodeURIComponent('admin'),
  'x-user-permissions': 'dashboard_view,sku_view,sku_create,sku_edit,sku_delete,sku_import,sku_export,inventory_view,inventory_import,inventory_export,po_view,po_create,po_edit,po_approve,pi_view,pi_create,pi_edit,pi_approve,ci_view,ci_create,ci_edit,ci_approve,pl_view,pl_create,pl_edit,logistics_view,logistics_create,logistics_edit,inbound_view,inbound_create,inbound_edit,cost_view,payment_view,payment_create,payment_approve,payment_import,check_view,check_create,check_approve,report_view,system_config,user_manage,role_manage,outbound_view,outbound_create,outbound_edit,outbound_import,outbound_export,oplog_view,batch_view'
};

let passCount = 0;
let failCount = 0;
const results = [];

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: path,
      method: method,
      headers: { ...HEADERS }
    };
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(chunks) });
        } catch(e) {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function test(name, condition, detail = '') {
  if (condition) {
    passCount++;
    results.push(`✅ ${name}`);
  } else {
    failCount++;
    results.push(`❌ ${name} ${detail}`);
  }
}

async function main() {
  console.log('=== Phase 3 综合验证 ===\n');

  // ========== 1. 基础数据准备 ==========
  console.log('1. 基础数据准备...');

  // 获取或创建供应商
  let suppliersRes = await apiCall('GET', '/api/suppliers');
  let supplier = suppliersRes.body.find(s => s.name && s.name.includes('Phase3'));
  if (!supplier && suppliersRes.body.length > 0) {
    supplier = suppliersRes.body[0];
  }
  if (!supplier) {
    const createSupRes = await apiCall('POST', '/api/suppliers', {
      name: 'Phase3测试供应商',
      country: '中国',
      contact_person: '测试',
      phone: '13800000000'
    });
    supplier = createSupRes.body;
  }
  const supName = supplier.name;
  const supId = supplier.id;
  test('供应商存在', supName && supId, `supplier=${JSON.stringify(supplier).slice(0,100)}`);

  // 获取或创建SKU
  let skusRes = await apiCall('GET', '/api/skus?pageSize=100');
  let testSku = skusRes.body.find(s => s.sku_code === 'TEST-PHASE3-001');
  if (!testSku) {
    const createSkuRes = await apiCall('POST', '/api/skus', {
      sku_code: 'TEST-PHASE3-001',
      product_name: 'Phase3测试商品',
      brand: '测试品牌',
      category: '测试分类',
      unit: '个',
      specification: '测试规格'
    });
    testSku = createSkuRes.body;
  }
  test('测试SKU存在', testSku && testSku.sku_code);

  let testSku2 = skusRes.body.find(s => s.sku_code === 'TEST-PHASE3-002');
  if (!testSku2) {
    const createSkuRes2 = await apiCall('POST', '/api/skus', {
      sku_code: 'TEST-PHASE3-002',
      product_name: 'Phase3测试商品2',
      brand: '测试品牌',
      category: '测试分类',
      unit: '个',
      specification: '测试规格2'
    });
    testSku2 = createSkuRes2.body;
  }
  test('测试SKU2存在', testSku2 && testSku2.sku_code);

  // ========== 2. PO → PI → CI 创建 ==========
  console.log('2. PO → PI → CI 创建...');

  // 创建PO
  const poRes = await apiCall('POST', '/api/purchase-orders', {
    po_no: `PO-P3-${Date.now()}`,
    supplier_id: supId,
    supplier_name: supName,
    brand: '测试品牌',
    country: '中国',
    target_warehouse: '深圳仓',
    expected_delivery: '2026-08-01',
    currency: 'USD',
    remark: 'Phase3测试PO',
    items: [
      { sku_code: 'TEST-PHASE3-001', po_qty: 100 },
      { sku_code: 'TEST-PHASE3-002', po_qty: 50 }
    ]
  });
  test('PO创建成功', poRes.status === 200, `status=${poRes.status} body=${JSON.stringify(poRes.body).slice(0,200)}`);
  const poId = poRes.body.id;
  const poNo = poRes.body.po_no;

  // 创建PI (need_deposit=1, deposit_ratio=30)
  const piRes = await apiCall('POST', '/api/proforma-invoices', {
    pi_no: `PI-P3-${Date.now()}`,
    related_po_id: poId,
    related_po_no: poNo,
    supplier_id: supId,
    supplier_name: supName,
    country: '中国',
    brand: '测试品牌',
    target_warehouse: '深圳仓',
    currency: 'USD',
    need_deposit: 1,
    deposit_ratio: 30,
    payment_terms: '30% deposit, 70% balance',
    expected_delivery: '2026-08-15',
    items: [
      { sku_code: 'TEST-PHASE3-001', pi_confirmed_qty: 100, unit_price: 10 },
      { sku_code: 'TEST-PHASE3-002', pi_confirmed_qty: 50, unit_price: 20 }
    ]
  });
  test('PI创建成功', piRes.status === 200, `status=${piRes.status} body=${JSON.stringify(piRes.body).slice(0,300)}`);
  const piId = piRes.body.id;
  const piNo = piRes.body.pi_no;
  // PI total = 100*10 + 50*20 = 2000, deposit = 2000*30% = 600
  test('PI总金额=2000', piRes.body.total_amount === 2000, `total=${piRes.body.total_amount}`);
  test('PI应付定金=600', piRes.body.payable_deposit === 600, `deposit=${piRes.body.payable_deposit}`);

  // 创建CI (has_customs_duty and has_inspection_fee will be set via cost-flags API)
  const ciRes = await apiCall('POST', '/api/commercial-invoices', {
    ci_no: `CI-P3-${Date.now()}`,
    related_po_id: poId,
    related_po_no: poNo,
    related_pi_id: piId,
    related_pi_no: piNo,
    supplier_id: supId,
    supplier_name: supName,
    country: '中国',
    brand: '测试品牌',
    target_warehouse: '深圳仓',
    currency: 'USD',
    items: [
      { sku_code: 'TEST-PHASE3-001', shipped_qty: 100, unit_price: 10 },
      { sku_code: 'TEST-PHASE3-002', shipped_qty: 50, unit_price: 20 }
    ]
  });
  test('CI创建成功', ciRes.status === 200, `status=${ciRes.status} body=${JSON.stringify(ciRes.body).slice(0,300)}`);
  const ciId = ciRes.body.id;
  const ciNo = ciRes.body.ci_no;
  // CI goods_amount = 100*10 + 50*20 = 2000
  // should_deduct_deposit = min(600, 600, 2000) = 600
  // payable_balance = 2000 - 600 = 1400
  test('CI商品金额=2000', ciRes.body.goods_amount === 2000, `goods=${ciRes.body.goods_amount}`);
  test('CI应付尾款=1400', ciRes.body.payable_balance === 1400, `balance=${ciRes.body.payable_balance}`);

  // 设置CI有关税和商检费用
  const costFlagsRes = await apiCall('PUT', `/api/commercial-invoices/${ciId}/cost-flags`, {
    has_customs_duty: 1,
    has_inspection_fee: 1
  });
  test('CI费用标记设置(有关税+商检)', costFlagsRes.status === 200, `status=${costFlagsRes.status}`);

  // ========== 3. 统一付款管理 ==========
  console.log('3. 统一付款管理...');

  // 3.1 PI定金付款（带抵扣）
  // payable_deposit = 600, deduction = 100, actual_pay = 500
  const depositPayRes = await apiCall('POST', '/api/payment-requests/from-pi-deposit', {
    pi_id: piId,
    has_deduction: 1,
    deduction_amount: 100,
    deduction_source_type: 'other_payment',
    deduction_source_desc: '测试抵扣-其他付款多付',
    deduction_ref_no: 'DED-001'
  });
  test('PI定金付款申请创建成功', depositPayRes.status === 200, `status=${depositPayRes.status} body=${JSON.stringify(depositPayRes.body).slice(0,200)}`);
  test('PI定金付款-实际支付=500', depositPayRes.body.actual_pay_amount === 500, `actual=${depositPayRes.body.actual_pay_amount}`);
  const depositPayId = depositPayRes.body.id;

  // 3.2 CI尾款付款（无抵扣）
  // payable_balance = 1400
  const balancePayRes = await apiCall('POST', '/api/payment-requests/from-ci-balance', {
    ci_id: ciId,
    has_deduction: 0,
    deduction_amount: 0
  });
  test('CI尾款付款申请创建成功', balancePayRes.status === 200, `status=${balancePayRes.status} body=${JSON.stringify(balancePayRes.body).slice(0,200)}`);
  const balancePayId = balancePayRes.body.id;

  // 3.3 到仓费用付款（关联CI）
  const warehousePayRes = await apiCall('POST', '/api/payment-requests/warehouse-arrival', {
    ci_id: ciId,
    subcategory: 'freight',
    payee_name: '测试货代公司',
    payable_amount: 500,
    currency: 'USD',
    remark: '海运费',
    has_deduction: 0,
    include_in_landing_cost: true
  });
  test('到仓费用付款申请创建成功', warehousePayRes.status === 200, `status=${warehousePayRes.status} body=${JSON.stringify(warehousePayRes.body).slice(0,200)}`);
  const warehousePayId = warehousePayRes.body.id;

  // 3.4 关税付款
  const dutyPayRes = await apiCall('POST', '/api/payment-requests/customs-duty', {
    ci_id: ciId,
    payee_name: '海关',
    payable_amount: 300,
    currency: 'USD',
    remark: '关税',
    has_deduction: 0
  });
  test('关税付款申请创建成功', dutyPayRes.status === 200, `status=${dutyPayRes.status} body=${JSON.stringify(dutyPayRes.body).slice(0,200)}`);
  const dutyPayId = dutyPayRes.body.id;

  // 3.5 商检费用付款
  const inspectionPayRes = await apiCall('POST', '/api/payment-requests/inspection-fee', {
    ci_id: ciId,
    payee_name: '商检机构',
    payable_amount: 100,
    currency: 'USD',
    remark: '商检费',
    has_deduction: 0
  });
  test('商检费用付款申请创建成功', inspectionPayRes.status === 200, `status=${inspectionPayRes.status} body=${JSON.stringify(inspectionPayRes.body).slice(0,200)}`);
  const inspectionPayId = inspectionPayRes.body.id;

  // 3.6 查询付款列表 - 按类别筛选
  const payListRes = await apiCall('GET', '/api/payment-requests?category=goods');
  test('付款列表-货款类别查询', payListRes.status === 200 && Array.isArray(payListRes.body), `status=${payListRes.status}`);
  const goodsPayments = payListRes.body.filter(p => p.payment_category === 'goods');
  test('付款列表-货款至少2条(定金+尾款)', goodsPayments.length >= 2, `count=${goodsPayments.length}`);

  const warehousePayListRes = await apiCall('GET', '/api/payment-requests?category=warehouse_arrival');
  test('付款列表-到仓费用类别查询', warehousePayListRes.status === 200 && Array.isArray(warehousePayListRes.body));

  const dutyPayListRes = await apiCall('GET', '/api/payment-requests?category=customs_duty');
  test('付款列表-关税类别查询', dutyPayListRes.status === 200 && Array.isArray(dutyPayListRes.body));

  const inspPayListRes = await apiCall('GET', '/api/payment-requests?category=inspection_fee');
  test('付款列表-商检费用类别查询', inspPayListRes.status === 200 && Array.isArray(inspPayListRes.body));

  // 3.7 更新抵扣信息
  const updateDedRes = await apiCall('PUT', `/api/payment-requests/${balancePayId}/deduction`, {
    has_deduction: 1,
    deduction_amount: 200,
    deduction_source_type: 'price_diff',
    deduction_source_desc: '测试-价格差异抵扣',
    deduction_ref_no: 'DED-002'
  });
  test('更新抵扣信息成功', updateDedRes.status === 200, `status=${updateDedRes.status} body=${JSON.stringify(updateDedRes.body).slice(0,200)}`);
  // actual_pay = 1400 - 200 = 1200
  test('更新抵扣后实际支付=1200', updateDedRes.body.actual_pay_amount === 1200, `actual=${updateDedRes.body.actual_pay_amount}`);

  // 3.8 审批付款
  const approveDepositRes = await apiCall('POST', `/api/payment-requests/${depositPayId}/approve`, { action: 'approve' });
  test('付款审批-定金通过', approveDepositRes.status === 200, `status=${approveDepositRes.status}`);

  const approveWarehouseRes = await apiCall('POST', `/api/payment-requests/${warehousePayId}/approve`, { action: 'approve' });
  test('付款审批-到仓费用通过', approveWarehouseRes.status === 200, `status=${approveWarehouseRes.status}`);

  const approveDutyRes = await apiCall('POST', `/api/payment-requests/${dutyPayId}/approve`, { action: 'approve' });
  test('付款审批-关税通过', approveDutyRes.status === 200, `status=${approveDutyRes.status}`);

  const approveInspRes = await apiCall('POST', `/api/payment-requests/${inspectionPayId}/approve`, { action: 'approve' });
  test('付款审批-商检费用通过', approveInspRes.status === 200, `status=${approveInspRes.status}`);

  // ========== 4. CI费用归集 ==========
  console.log('4. CI费用归集...');

  // 4.1 获取CI费用汇总
  const costSummaryRes = await apiCall('GET', `/api/commercial-invoices/${ciId}/cost-summary`);
  test('CI费用汇总获取成功', costSummaryRes.status === 200, `status=${costSummaryRes.status} body=${JSON.stringify(costSummaryRes.body).slice(0,300)}`);
  test('CI费用汇总-商品金额=2000', costSummaryRes.body.goods_amount === 2000, `goods=${costSummaryRes.body.goods_amount}`);
  test('CI费用汇总-到仓费用=500', costSummaryRes.body.warehouse_arrival_total === 500, `warehouse=${costSummaryRes.body.warehouse_arrival_total}`);
  test('CI费用汇总-关税=300', costSummaryRes.body.customs_duty_total === 300, `duty=${costSummaryRes.body.customs_duty_total}`);
  test('CI费用汇总-商检=100', costSummaryRes.body.inspection_fee_total === 100, `inspection=${costSummaryRes.body.inspection_fee_total}`);
  // landing_cost = 2000 + 500 + 300 + 100 = 2900
  test('CI费用汇总-落地成本=2900', costSummaryRes.body.landing_cost_total === 2900, `landing=${costSummaryRes.body.landing_cost_total}`);
  test('CI费用汇总-有关税标记', costSummaryRes.body.has_customs_duty === 1);
  test('CI费用汇总-有商检标记', costSummaryRes.body.has_inspection_fee === 1);
  test('CI费用汇总-费用项列表≥3', Array.isArray(costSummaryRes.body.cost_items) && costSummaryRes.body.cost_items.length >= 3, `items=${costSummaryRes.body.cost_items?.length}`);

  // 4.2 确认CI费用完整
  const confirmCostsRes = await apiCall('POST', `/api/commercial-invoices/${ciId}/confirm-costs`);
  test('CI费用确认成功', confirmCostsRes.status === 200, `status=${confirmCostsRes.status}`);

  // ========== 5. 原库存数量导入 ==========
  console.log('5. 原库存数量导入...');

  // 5.1 检查导入前状态
  const checkBeforeRes = await apiCall('GET', `/api/original-inventory/${ciId}/check`);
  test('原库存检查-导入前未完成', checkBeforeRes.status === 200, `status=${checkBeforeRes.status}`);
  test('原库存检查-导入前缺2个SKU', checkBeforeRes.body.missing_skus && checkBeforeRes.body.missing_skus.length === 2, `missing=${JSON.stringify(checkBeforeRes.body.missing_skus)}`);

  // 5.2 导入原库存数量
  const importRes = await apiCall('POST', '/api/original-inventory/import', {
    ci_id: ciId,
    items: [
      { sku_code: 'TEST-PHASE3-001', original_qty: 200, country: '中国', warehouse: '深圳仓', remark: '原库存' },
      { sku_code: 'TEST-PHASE3-002', original_qty: 100, country: '中国', warehouse: '深圳仓', remark: '原库存' }
    ]
  });
  test('原库存导入成功', importRes.status === 200, `status=${importRes.status} body=${JSON.stringify(importRes.body).slice(0,200)}`);
  test('原库存导入-成功2条', importRes.body.success === 2, `success=${importRes.body.success}`);

  // 5.3 检查导入后状态
  const checkAfterRes = await apiCall('GET', `/api/original-inventory/${ciId}/check`);
  test('原库存检查-导入后已完成', checkAfterRes.body.all_imported === true, `all_imported=${checkAfterRes.body.all_imported}`);

  // 5.4 获取导入记录
  const getImportRes = await apiCall('GET', `/api/original-inventory/${ciId}`);
  test('获取原库存导入记录成功', getImportRes.status === 200 && Array.isArray(getImportRes.body) && getImportRes.body.length === 2, `status=${getImportRes.status} count=${getImportRes.body?.length}`);

  // 5.5 下载模板
  const templateRes = await apiCall('GET', '/api/original-inventory/template');
  test('原库存导入模板获取成功', templateRes.status === 200 && templateRes.body.columns, `status=${templateRes.status}`);

  // ========== 6. 费用分摊 ==========
  console.log('6. 费用分摊...');

  // 6.1 执行费用分摊
  const allocateRes = await apiCall('POST', `/api/cost-allocation/allocate/${ciId}`);
  test('费用分摊成功', allocateRes.status === 200, `status=${allocateRes.status} body=${JSON.stringify(allocateRes.body).slice(0,300)}`);
  test('费用分摊-分摊记录2条', allocateRes.body.allocations && allocateRes.body.allocations.length === 2, `count=${allocateRes.body.allocations?.length}`);

  // 验证分摊比例 (SKU1: 1000/2000=50%, SKU2: 1000/2000=50%)
  // SKU1: product_cost=1000, warehouse=250, duty=150, inspection=50, total=1450, unit=1450/100=14.5
  // SKU2: product_cost=1000, warehouse=250, duty=150, inspection=50, total=1450, unit=1450/50=29
  if (allocateRes.body.allocations && allocateRes.body.allocations.length === 2) {
    const alloc1 = allocateRes.body.allocations.find(a => a.sku_code === 'TEST-PHASE3-001');
    const alloc2 = allocateRes.body.allocations.find(a => a.sku_code === 'TEST-PHASE3-002');
    test('费用分摊-SKU1落地成本=1450', alloc1 && Math.abs(alloc1.total_landing_cost - 1450) < 0.01, `landing=${alloc1?.total_landing_cost}`);
    test('费用分摊-SKU2落地成本=1450', alloc2 && Math.abs(alloc2.total_landing_cost - 1450) < 0.01, `landing=${alloc2?.total_landing_cost}`);
    test('费用分摊-SKU1单位落地成本=14.5', alloc1 && Math.abs(alloc1.unit_landing_cost - 14.5) < 0.01, `unit=${alloc1?.unit_landing_cost}`);
    test('费用分摊-SKU2单位落地成本=29', alloc2 && Math.abs(alloc2.unit_landing_cost - 29) < 0.01, `unit=${alloc2?.unit_landing_cost}`);
  }

  // 6.2 获取分摊明细
  const getAllocRes = await apiCall('GET', `/api/cost-allocation/${ciId}`);
  test('获取分摊明细成功', getAllocRes.status === 200 && Array.isArray(getAllocRes.body) && getAllocRes.body.length === 2, `status=${getAllocRes.status} count=${getAllocRes.body?.length}`);

  // ========== 7. 加权平均成本更新 ==========
  console.log('7. 加权平均成本更新...');

  // 7.1 执行加权平均成本更新
  const updateWacRes = await apiCall('POST', `/api/cost-allocation/update-weighted-avg/${ciId}`, { remark: 'Phase3测试更新' });
  test('加权平均成本更新成功', updateWacRes.status === 200, `status=${updateWacRes.status} body=${JSON.stringify(updateWacRes.body).slice(0,300)}`);
  test('加权平均成本更新-更新2个SKU', updateWacRes.body.updated_count === 2, `count=${updateWacRes.body.updated_count}`);

  // 验证计算逻辑
  // SKU1: original_qty=200, old_cost=0(新), inbound_qty=100, unit_landing_cost=14.5
  // new_qty = 200+100 = 300, new_avg_cost = (200*0 + 100*14.5)/300 = 4.8333
  // SKU2: original_qty=100, old_cost=0(新), inbound_qty=50, unit_landing_cost=29
  // new_qty = 100+50 = 150, new_avg_cost = (100*0 + 50*29)/150 = 9.6667
  if (updateWacRes.body.logs && updateWacRes.body.logs.length === 2) {
    const log1 = updateWacRes.body.logs.find(l => l.sku_code === 'TEST-PHASE3-001');
    const log2 = updateWacRes.body.logs.find(l => l.sku_code === 'TEST-PHASE3-002');
    test('加权平均成本-SKU1新数量=300', log1 && log1.new_qty === 300, `qty=${log1?.new_qty}`);
    test('加权平均成本-SKU1新成本≈4.8333', log1 && Math.abs(log1.new_avg_cost - 4.8333) < 0.01, `cost=${log1?.new_avg_cost}`);
    test('加权平均成本-SKU2新数量=150', log2 && log2.new_qty === 150, `qty=${log2?.new_qty}`);
    test('加权平均成本-SKU2新成本≈9.6667', log2 && Math.abs(log2.new_avg_cost - 9.6667) < 0.01, `cost=${log2?.new_avg_cost}`);
  }

  // 7.2 验证库存表已更新
  const invRes = await apiCall('GET', '/api/inventory?sku_code=TEST-PHASE3-001');
  test('库存表查询成功', invRes.status === 200, `status=${invRes.status}`);
  if (invRes.status === 200) {
    const rows = Array.isArray(invRes.body) ? invRes.body : (invRes.body.rows || []);
    const inv1 = rows.find(r => r.sku_code === 'TEST-PHASE3-001');
    test('库存表-SKU1数量=300', inv1 && inv1.available_qty === 300, `qty=${inv1?.available_qty}`);
    test('库存表-SKU1加权成本≈4.8333', inv1 && Math.abs(inv1.weighted_avg_cost - 4.8333) < 0.01, `cost=${inv1?.weighted_avg_cost}`);
  }

  // ========== 8. 成本更新日志 ==========
  console.log('8. 成本更新日志...');

  // 8.1 查询日志 - 按CI
  const logsByCiRes = await apiCall('GET', `/api/cost-update-logs?ci_no=${ciNo}`);
  test('成本日志-按CI查询成功', logsByCiRes.status === 200 && Array.isArray(logsByCiRes.body), `status=${logsByCiRes.status}`);
  test('成本日志-至少2条', logsByCiRes.body && logsByCiRes.body.length >= 2, `count=${logsByCiRes.body?.length}`);

  // 8.2 查询日志 - 按SKU
  const logsBySkuRes = await apiCall('GET', '/api/cost-update-logs?sku_code=TEST-PHASE3-001');
  test('成本日志-按SKU查询成功', logsBySkuRes.status === 200 && Array.isArray(logsBySkuRes.body), `status=${logsBySkuRes.status}`);

  // 8.3 查询日志 - 关键词搜索
  const logsByKeywordRes = await apiCall('GET', `/api/cost-update-logs?keyword=${ciNo}`);
  test('成本日志-关键词搜索成功', logsByKeywordRes.status === 200 && Array.isArray(logsByKeywordRes.body), `status=${logsByKeywordRes.status}`);

  // 8.4 验证日志内容
  if (logsByCiRes.body && logsByCiRes.body.length > 0) {
    const log = logsByCiRes.body[0];
    test('成本日志-包含原库存数量', log.original_qty !== undefined, `original_qty=${log.original_qty}`);
    test('成本日志-包含旧成本', log.old_avg_cost !== undefined, `old_avg_cost=${log.old_avg_cost}`);
    test('成本日志-包含入库数量', log.inbound_qty !== undefined, `inbound_qty=${log.inbound_qty}`);
    test('成本日志-包含单位落地成本', log.unit_landing_cost !== undefined, `unit_landing_cost=${log.unit_landing_cost}`);
    test('成本日志-包含新成本', log.new_avg_cost !== undefined, `new_avg_cost=${log.new_avg_cost}`);
    test('成本日志-包含操作人', log.operator_name !== undefined, `operator=${log.operator_name}`);
  }

  // ========== 9. 异常场景验证 ==========
  console.log('9. 异常场景验证...');

  // 9.1 未确认费用时不能分摊
  const ci2Res = await apiCall('POST', '/api/commercial-invoices', {
    ci_no: `CI-P3-2-${Date.now()}`,
    related_po_id: poId,
    related_po_no: poNo,
    related_pi_id: piId,
    related_pi_no: piNo,
    supplier_id: supId,
    supplier_name: supName,
    country: '中国',
    brand: '测试品牌',
    target_warehouse: '深圳仓',
    currency: 'USD',
    items: [
      { sku_code: 'TEST-PHASE3-001', shipped_qty: 10, unit_price: 10 }
    ]
  });
  const ci2Id = ci2Res.body.id;
  test('CI2创建(用于异常测试)', ci2Res.status === 200, `status=${ci2Res.status}`);

  const allocFailRes = await apiCall('POST', `/api/cost-allocation/allocate/${ci2Id}`);
  test('未确认费用时不能分摊', allocFailRes.status === 400, `status=${allocFailRes.status}`);

  // 9.2 未导入原库存时不能更新加权平均成本
  await apiCall('POST', `/api/commercial-invoices/${ci2Id}/confirm-costs`);
  await apiCall('POST', `/api/cost-allocation/allocate/${ci2Id}`);
  const wacFailRes = await apiCall('POST', `/api/cost-allocation/update-weighted-avg/${ci2Id}`);
  test('未导入原库存时不能更新加权平均成本', wacFailRes.status === 400, `status=${wacFailRes.status}`);

  // 9.3 无关税CI不能创建关税付款
  const ci3Res = await apiCall('POST', '/api/commercial-invoices', {
    ci_no: `CI-P3-3-${Date.now()}`,
    related_po_id: poId,
    related_po_no: poNo,
    related_pi_id: piId,
    related_pi_no: piNo,
    supplier_id: supId,
    supplier_name: supName,
    country: '中国',
    brand: '测试品牌',
    target_warehouse: '深圳仓',
    currency: 'USD',
    items: [
      { sku_code: 'TEST-PHASE3-001', shipped_qty: 5, unit_price: 10 }
    ]
  });
  const ci3Id = ci3Res.body.id;
  // ci3 has has_customs_duty=0, has_inspection_fee=0 by default
  const dutyFailRes = await apiCall('POST', '/api/payment-requests/customs-duty', {
    ci_id: ci3Id,
    payee_name: '海关',
    payable_amount: 100,
    currency: 'USD'
  });
  test('无关税CI不能创建关税付款', dutyFailRes.status === 400, `status=${dutyFailRes.status}`);

  const inspFailRes = await apiCall('POST', '/api/payment-requests/inspection-fee', {
    ci_id: ci3Id,
    payee_name: '商检',
    payable_amount: 50,
    currency: 'USD'
  });
  test('无商检费用CI不能创建商检付款', inspFailRes.status === 400, `status=${inspFailRes.status}`);

  // 9.4 抵扣金额大于应付金额
  const dedFailRes = await apiCall('POST', '/api/payment-requests/from-pi-deposit', {
    pi_id: piId,
    has_deduction: 1,
    deduction_amount: 999999,
    deduction_source_type: 'test',
    deduction_source_desc: 'test'
  });
  test('抵扣金额大于应付金额被拒绝', dedFailRes.status === 400, `status=${dedFailRes.status}`);

  // 9.5 抵扣金额>0但缺少来源类型
  const dedFail2Res = await apiCall('POST', '/api/payment-requests/from-pi-deposit', {
    pi_id: piId,
    has_deduction: 1,
    deduction_amount: 50,
    deduction_source_type: '',
    deduction_source_desc: ''
  });
  test('抵扣无来源类型被拒绝', dedFail2Res.status === 400, `status=${dedFail2Res.status}`);

  // 9.6 到仓费用无效小类
  const invalidSubRes = await apiCall('POST', '/api/payment-requests/warehouse-arrival', {
    ci_id: ciId,
    subcategory: 'invalid_sub',
    payee_name: 'test',
    payable_amount: 100,
    currency: 'USD'
  });
  test('到仓费用无效小类被拒绝', invalidSubRes.status === 400, `status=${invalidSubRes.status}`);

  // ========== 10. 付款确认已付 ==========
  console.log('10. 付款确认已付...');

  const confirmPaidRes = await apiCall('POST', `/api/payment-requests/${warehousePayId}/approve`, {
    action: 'confirm-paid',
    paid_amount: 500
  });
  test('付款确认已付成功', confirmPaidRes.status === 200, `status=${confirmPaidRes.status} body=${JSON.stringify(confirmPaidRes.body).slice(0,200)}`);

  // 验证ci_cost_items同步更新
  const costSummaryAfterPaid = await apiCall('GET', `/api/commercial-invoices/${ciId}/cost-summary`);
  test('付款后CI费用汇总正常', costSummaryAfterPaid.status === 200, `status=${costSummaryAfterPaid.status}`);

  // ========== 11. 第二次加权平均成本更新（验证增量更新） ==========
  console.log('11. 第二次加权平均成本更新(增量)...');

  // 先导入原库存（用ci2Id，它已经有分摊了）
  await apiCall('POST', '/api/original-inventory/import', {
    ci_id: ci2Id,
    items: [
      { sku_code: 'TEST-PHASE3-001', original_qty: 300, country: '中国', warehouse: '深圳仓', remark: '第二次原库存' }
    ]
  });

  // CI2 商品: SKU1 shipped_qty=10, unit_price=10 → amount=100
  // CI2 无额外费用（没有到仓/关税/商检付款），所以 landing_cost = 100
  // unit_landing_cost = 100/10 = 10
  // old_cost (from previous update) = 4.8333
  // new_qty = 300 + 10 = 310
  // new_avg_cost = (300*4.8333 + 10*10) / 310 = (1450 + 100) / 310 = 1550/310 = 5.0
  const updateWac2Res = await apiCall('POST', `/api/cost-allocation/update-weighted-avg/${ci2Id}`, { remark: 'Phase3第二次更新' });
  test('第二次加权平均成本更新成功', updateWac2Res.status === 200, `status=${updateWac2Res.status} body=${JSON.stringify(updateWac2Res.body).slice(0,300)}`);

  if (updateWac2Res.body.logs && updateWac2Res.body.logs.length > 0) {
    const log = updateWac2Res.body.logs[0];
    test('第二次更新-SKU1新数量=310', log.new_qty === 310, `qty=${log.new_qty}`);
    // (300*4.8333 + 10*10)/310 = (1450 + 100)/310 = 1550/310 = 5.0
    test('第二次更新-SKU1新成本=5', Math.abs(log.new_avg_cost - 5.0) < 0.01, `cost=${log.new_avg_cost}`);
    test('第二次更新-SKU1旧成本≈4.8333', Math.abs(log.old_avg_cost - 4.8333) < 0.01, `old=${log.old_avg_cost}`);
  }

  // ========== 输出结果 ==========
  console.log('\n=== 验证结果 ===\n');
  results.forEach(r => console.log(r));
  console.log(`\n总计: ${passCount} 通过, ${failCount} 失败, 共 ${passCount + failCount} 项`);
  console.log(failCount === 0 ? '\n✅ 全部通过!' : `\n❌ 有 ${failCount} 项失败`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('验证脚本异常:', e);
  process.exit(1);
});
