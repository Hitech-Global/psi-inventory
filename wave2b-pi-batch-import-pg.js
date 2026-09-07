'use strict';
// =============================================================================
// Wave 2B — PI batch-import PG async path
// =============================================================================
// 设计依据：WAVE2-BATCH-IMPORT-ASYNC-DESIGN.md + 用户 Wave 2B 指令 + Wave 2A 模块（镜像）
//
// 核心原则（与 Wave 2A 一致）：
//   1. 完全脱离 sync bridge（db.query/queryOne/run/transaction = 0）
//   2. partial-success 语义：expected validation failure → 该行 failed，其他行可成功；
//      unexpected mutation/DB failure → 整个 mutation ROLLBACK
//   3. set-based mutations（无 N-dependent SQL calls）
//   4. 金额/rounding 在 JS 内计算（Math.round 保持不动），SQL 只消费规范化值
//   5. 锁序 PO(id ASC) → PI(id ASC) FOR UPDATE（PI 路由不碰其他 PI 的 items）
//   6. PAY-CORE（deposit payable upsert）在同一 withGenerateClient 事务内完成
//   7. after-COMMIT 才触发 updateInventoryTransitDataAsync
//
// PAY 模型（复用已闭环规则，不重议）：
//   deposit payable identity = (source_type='pi', source_id=pi_id, COALESCE(source_ci_id,''), fee_type='deposit')，永久唯一
//   active                              → 金额变化可同步（authoritative UPDATE）
//   reserved/partially_paid/paid        → S2 MUTABILITY 守卫：金额变化 fail-closed 行拒（零 mutation）；金额一致放行
//   cancelled                           → 不进 S2 守卫（Round 5 结论）；createPayableItemFromSource 返回历史行不重建
//   getPILockReason 等价                → 拒「向 cancelled/有CI/有PL/定金已付 PI 追加 item」（§A 追加债，与 S2 正交）
//   duplicate(pi_id, sku)              → staging 自连接 fail-closed（§A 债，本次补）
// =============================================================================

const { withGenerateClient } = require('./pg-async');
const { genId } = require('./db');

// -----------------------------------------------------------------------------
// 纯 JS 工具函数（复刻 server.js 语义，不依赖 sync bridge）
// -----------------------------------------------------------------------------
function s(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function n(v, fallback) {
  if (fallback === undefined) fallback = 0;
  var x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function pick(row, names) {
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name];
  }
  return '';
}
function parseAttachment(value) {
  if (!value) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
function ph(n) { return Array(n).fill('?').join(','); }

var DEBUG_PERF = process.env.WAVE2B_PI_DEBUG === '1';

// =============================================================================
// Layer 1: 纯 JS 预处理
// =============================================================================
function preprocessRows(rows) {
  var validRows = [];
  var invalidRows = [];
  var dupKeys = new Set(); // (pi_no, sku_code) 重复 key（含首现）
  var keyCounts = {};
  var piIdByNo = {}; // pi_no → 共享 pi_id（同一新 PI 多行用同一 id，与 Wave 2A ciIdByNo 等价）
  for (var i = 0; i < rows.length; i++) {
    var prow = rows[i];
    var pSku = s(pick(prow, ['SKU', 'sku_code']));
    var pPiNo = s(pick(prow, ['PI编号', 'pi_no']));
    if (pSku && pPiNo) {
      var pk = pPiNo + '\u0000' + pSku;
      keyCounts[pk] = (keyCounts[pk] || 0) + 1;
    }
  }
  for (var dk in keyCounts) {
    if (keyCounts[dk] > 1) dupKeys.add(dk);
  }

  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    var idx = j;
    var sourceRowNo = idx + 2; // 与 legacy 一致（跳过表头行）
    try {
      var sku = s(pick(row, ['SKU', 'sku_code']));
      if (!sku) throw new Error('SKU不能为空');

      var poNo = s(pick(row, ['关联PO编号', 'PO编号', 'related_po_no', 'po_no']));
      if (!poNo) throw new Error('无法匹配PO：PO编号为空');

      var piNo = s(pick(row, ['PI编号', 'pi_no'])) ||
        ('PI-' + new Date().getFullYear() + '-' + String(Date.now() + idx).slice(-6));

      var qty = n(pick(row, ['数量', 'PI数量', 'pi_confirmed_qty', 'qty']), 0);
      if (!(qty > 0)) throw new Error('PI数量必须大于0：' + sku);

      var price = n(pick(row, ['单价', 'unit_price']), 0);

      var needDepositVal = s(pick(row, ['是否需要定金', 'need_deposit']));
      var needDeposit = (needDepositVal === '否' || needDepositVal === '0' || needDepositVal.toLowerCase() === 'false') ? 0 : 1;
      var depositRatio = needDeposit ? n(pick(row, ['定金比例', 'deposit_ratio']), 0) : 0;

      // 批内重复 (pi_no, sku) fail-closed —— 所有重复行（含首现）都标记失败
      var dedupKey = piNo + '\u0000' + sku;
      if (dupKeys.has(dedupKey)) {
        throw new Error('输入重复：同一导入内 PI ' + piNo + ' + SKU ' + sku + ' 重复');
      }

      validRows.push({
        source_row_no: sourceRowNo,
        pi_no: piNo,
        pi_id: piIdByNo[piNo] || (piIdByNo[piNo] = genId('pi')),
        pii_id: genId('pii'),
        po_no: poNo,
        sku_code: sku,
        quantity: qty,
        unit_price: price,
        amount: qty * price,
        need_deposit: needDeposit,
        deposit_ratio: depositRatio,
        pi_date: s(pick(row, ['PI日期', 'pi_date'])) || new Date().toISOString().split('T')[0],
        currency: s(pick(row, ['币种', 'currency'])),
        payment_terms: s(pick(row, ['付款条件', 'payment_terms'])),
        expected_delivery: s(pick(row, ['预计交期', 'expected_delivery'])),
        attachment: parseAttachment(row.attachment || ''),
        remark: s(pick(row, ['备注', 'remark']))
      });
    } catch (e) {
      invalidRows.push({ row: sourceRowNo, reason: e.message });
    }
  }

  return { validRows: validRows, invalidRows: invalidRows };
}

// =============================================================================
// Layer 2: withGenerateClient 事务
// =============================================================================
async function importProformaInvoicesPg(rows, req) {
  var t0 = DEBUG_PERF ? Date.now() : 0;
  var userCtx = {
    userId: (req.currentUserId || (req.user && req.user.id)) || '',
    userName: (req.currentUserName || '') || ''
  };

  // ---- Layer 1: 纯 JS 预处理 ----
  var pre = preprocessRows(rows);
  var validRows = pre.validRows;
  var invalidRows = pre.invalidRows;

  if (validRows.length === 0) {
    return {
      success: 0,
      failed: invalidRows.length,
      total: rows.length,
      errors: invalidRows
    };
  }

  var txResult = await withGenerateClient(async function (aq, aqOne, run) {
    var tValidation = DEBUG_PERF ? Date.now() : 0;
    var sqlCalls = 0;

    // ---- 2a. 验证查询（jsonb_to_recordset + LEFT JOIN，单次获取所有解析数据）----
    var inputJson = JSON.stringify(validRows.map(function (r) {
      return {
        source_row_no: r.source_row_no, pi_no: r.pi_no, pi_id: r.pi_id, pii_id: r.pii_id,
        po_no: r.po_no, sku_code: r.sku_code, quantity: r.quantity, unit_price: r.unit_price,
        amount: r.amount, need_deposit: r.need_deposit, deposit_ratio: r.deposit_ratio,
        pi_date: r.pi_date, currency: r.currency, payment_terms: r.payment_terms,
        expected_delivery: r.expected_delivery, attachment: r.attachment, remark: r.remark
      };
    }));

    var validationRows = await aq(
      'WITH input_rows AS (' +
      '  SELECT * FROM jsonb_to_recordset($1::jsonb) AS j(' +
      '    source_row_no int, pi_no text, pi_id text, pii_id text, po_no text, sku_code text,' +
      '    quantity int, unit_price numeric, amount numeric, need_deposit int, deposit_ratio numeric,' +
      '    pi_date text, currency text, payment_terms text, expected_delivery text, attachment text, remark text' +
      '  )' +
      ') SELECT ' +
      '  i.source_row_no, i.pi_no, i.pi_id, i.pii_id, i.po_no, i.sku_code,' +
      '  i.quantity, i.unit_price, i.amount, i.need_deposit, i.deposit_ratio, i.pi_date, i.currency,' +
      '  i.payment_terms, i.expected_delivery, i.attachment, i.remark,' +
      '  s.id AS sku_exists,' +
      '  po.id AS po_id, po.po_no AS po_po_no, po.approval_status AS po_approval_status,' +
      '  po.supplier_id AS po_supplier_id, po.supplier_name AS po_supplier_name,' +
      '  po.brand AS po_brand, po.country AS po_country, po.target_warehouse AS po_target_warehouse,' +
      '  po.currency AS po_currency,' +
      '  poi.po_qty AS poi_po_qty,' +
      '  pi.id AS existing_pi_id, pi.pi_no AS pi_pi_no, pi.pi_status AS pi_status,' +
      '  pi.related_po_no AS pi_related_po_no, pi.total_amount AS pi_total_amount,' +
      '  pi.need_deposit AS pi_need_deposit, pi.deposit_ratio AS pi_deposit_ratio,' +
      '  pi.deposit_payment_status AS pi_deposit_payment_status, pi.paid_deposit AS pi_paid_deposit,' +
      '  pi.available_deduct_deposit AS pi_available_deduct_deposit, pi.supplier_id AS pi_supplier_id, pi.supplier_name AS pi_supplier_name,' +
      '  pii.id AS existing_pii_id,' +
      '  (SELECT COALESCE(SUM(pi_confirmed_qty),0) FROM proforma_invoice_items WHERE po_no = COALESCE(NULLIF(i.po_no, \'\'), pi.related_po_no) AND sku_code = i.sku_code) AS existing_pi_sum,' +
      '  (SELECT COALESCE(SUM(pi_amount),0) FROM proforma_invoice_items WHERE pi_id = pi.id) AS pi_exist_items_total,' +
      '  (SELECT lifecycle_status FROM payable_items WHERE source_type=\'pi\' AND source_id=pi.id AND fee_type=\'deposit\' AND COALESCE(source_ci_id,\'\')=\'\' ORDER BY created_at DESC LIMIT 1) AS dep_lifecycle,' +
      '  (SELECT payable_amount_minor FROM payable_items WHERE source_type=\'pi\' AND source_id=pi.id AND fee_type=\'deposit\' AND COALESCE(source_ci_id,\'\')=\'\' ORDER BY created_at DESC LIMIT 1) AS dep_amount_minor,' +
      '  CASE' +
      '    WHEN pi.pi_status = \'cancelled\' THEN \'已作废\'' +
      '    WHEN EXISTS (SELECT 1 FROM commercial_invoices ci LEFT JOIN commercial_invoice_items cii ON cii.ci_id = ci.id WHERE (ci.related_pi_id = pi.id OR ci.related_pi_no = pi.pi_no OR cii.pi_id = pi.id) AND ci.ci_status != \'cancelled\') THEN \'已生成CI\'' +
      '    WHEN EXISTS (SELECT 1 FROM packing_lists pl WHERE pl.related_pi_id = pi.id OR pl.related_pi_no = pi.pi_no) THEN \'已生成PL\'' +
      '    WHEN pi.deposit_payment_status = \'paid\' OR COALESCE(pi.paid_deposit,0) > 0 THEN \'已付定金\'' +
      '    ELSE NULL END AS pi_locked_reason' +
      ' FROM input_rows i' +
      ' LEFT JOIN skus s ON s.sku_code = i.sku_code' +
      ' LEFT JOIN proforma_invoices pi ON pi.pi_no = i.pi_no' +
      ' LEFT JOIN purchase_orders po ON po.po_no = COALESCE(NULLIF(i.po_no, \'\'), pi.related_po_no)' +
      ' LEFT JOIN purchase_order_items poi ON poi.po_id = po.id AND poi.sku_code = i.sku_code' +
      ' LEFT JOIN proforma_invoice_items pii ON pii.pi_id = pi.id AND pii.sku_code = i.sku_code' +
      ' ORDER BY i.source_row_no',
      [inputJson]
    );
    sqlCalls++;

    // ---- 2b. JS: 验证 + 分区 ----
    var validated = [];
    var validationErrors = [];
    var newPiFirstRowNo = {}; // pi_no -> source_row_no of the first row（仅第一行用于 header INSERT）

    // PAY_LOCKED_STATES（S2 MUTABILITY）：终态/锁定态，金额变化 fail-closed 行拒
    // 注意：cancelled 不在此集合（Round 5 结论：deposit payable 被 cancel 后身份永久占用，
    //   加 S2 守卫会永久卡死「拒 PR→改 PI→重申」，故 cancelled 放行由 createPayableItemFromSource 返回历史行处理）。
    var PAY_LOCKED_STATES = { partially_paid: 1, reserved: 1, paid: 1 };

    for (var vi = 0; vi < validationRows.length; vi++) {
      var vr = validationRows[vi];
      var rowNo = vr.source_row_no;
      var errs = [];

      // SKU 存在性
      if (!vr.sku_exists) errs.push('SKU不存在：' + vr.sku_code);

      // PO 存在性 + 审批
      if (!vr.po_id) {
        errs.push('无法匹配PO：' + vr.po_no);
      } else if (vr.po_approval_status !== 'approved') {
        errs.push('PO 尚未审批通过，不能生成 PI：' + vr.po_no);
      }

      // P2-6 守卫：本批累计 + 已存在 PI items 不得超过 PO item 数量
      if (vr.po_id && vr.poi_po_qty !== null && vr.poi_po_qty !== undefined) {
        var cumulativePi = Number(vr.existing_pi_sum || 0) + vr.quantity;
        if (cumulativePi > (vr.poi_po_qty || 0)) {
          errs.push('PI数量超过采购订单剩余数量（SKU: ' + vr.sku_code +
            ', PO数量: ' + (vr.poi_po_qty || 0) +
            ', 已转PI数量: ' + (Number(vr.existing_pi_sum) || 0) +
            ', 本次PI数量: ' + vr.quantity + '），请检查后重新提交。');
        }
      }

      // getPILockReason 等价（§A 追加债）：拒向锁定 PI 追加 item
      if (vr.existing_pi_id && vr.pi_locked_reason) {
        errs.push('PI已锁定(' + vr.pi_locked_reason + ')，不能追加明细：' + vr.pi_pi_no);
      }

      // duplicate(pi_id, sku) 守卫（§A 债）：既有 PI 已有同 SKU item → 拒绝
      if (vr.existing_pi_id && vr.existing_pii_id) {
        errs.push('该PI已存在相同SKU明细：' + vr.pi_pi_no + ' / ' + vr.sku_code);
      }

      // S2 MUTABILITY（deposit）：既有 PI + 需定金 + deposit payable 锁定态 + 金额变化 → 行拒（零 mutation）
      // cancelled 不在此（Round 5）；金额完全一致 → 放行（NO_CHANGE 语义，与物流一致）
      if (vr.existing_pi_id && vr.need_deposit) {
        var existItemsTotal = Number(vr.pi_exist_items_total) || 0;
        var prospectiveDeposit = (existItemsTotal + vr.amount) * vr.deposit_ratio / 100;
        if (vr.dep_lifecycle && PAY_LOCKED_STATES[vr.dep_lifecycle] &&
            Math.round(prospectiveDeposit * 100) !== Number(vr.dep_amount_minor || 0)) {
          errs.push('定金应付已进入付款流程（' + vr.dep_lifecycle + '），本次导入将改变定金金额（' +
            (Number(vr.dep_amount_minor || 0) / 100).toFixed(2) + ' → ' + prospectiveDeposit.toFixed(2) +
            '），导入不可修改，该行已拒绝（零变更）');
        }
      }

      if (errs.length > 0) {
        validationErrors.push({ row: rowNo, reason: errs[0] });
      } else {
        var isNewPi = !vr.existing_pi_id;
        var piId = isNewPi ? vr.pi_id : vr.existing_pi_id;

        if (isNewPi && !newPiFirstRowNo[vr.pi_no]) {
          newPiFirstRowNo[vr.pi_no] = vr.source_row_no;
        }

        validated.push({
          source_row_no: rowNo,
          pi_no: vr.pi_no,
          pi_id: piId,
          pii_id: vr.pii_id,
          is_new_pi: isNewPi,
          po_id: vr.po_id,
          po_no: vr.po_po_no,
          sku_code: vr.sku_code,
          quantity: vr.quantity,
          unit_price: vr.unit_price,
          amount: vr.amount,
          need_deposit: isNewPi ? vr.need_deposit : (vr.pi_need_deposit || vr.need_deposit),
          deposit_ratio: isNewPi ? vr.deposit_ratio : (vr.pi_deposit_ratio || vr.deposit_ratio),
          pi_date: vr.pi_date,
          currency: vr.currency || vr.po_currency || 'USD',
          payment_terms: vr.payment_terms,
          expected_delivery: vr.expected_delivery,
          attachment: vr.attachment,
          remark: vr.remark,
          pi_total_amount_pre: Number(vr.pi_total_amount) || 0,
          pi_supplier_id: isNewPi ? vr.po_supplier_id : vr.pi_supplier_id,
          pi_supplier_name: isNewPi ? vr.po_supplier_name : vr.pi_supplier_name,
          po_supplier_id: vr.po_supplier_id,
          po_supplier_name: vr.po_supplier_name,
          po_brand: vr.po_brand,
          po_country: vr.po_country,
          po_target_warehouse: vr.po_target_warehouse
        });
      }
    }

    if (validated.length === 0) {
      return {
        success: 0,
        failed: validationErrors.length + invalidRows.length,
        total: rows.length,
        errors: invalidRows.concat(validationErrors)
      };
    }

    // ---- 2c. JS 聚合：per-PI 新总额 + payableDeposit ----
    var piAgg = {}; // pi_id -> { pi_no, amountSum, depositRatio, currency, supplier_id, supplier_name, brand, country, warehouse }
    var piPreTotal = {}; // pi_id -> pre-batch total_amount
    for (var ai = 0; ai < validated.length; ai++) {
      var ar = validated[ai];
      if (!piAgg[ar.pi_id]) {
        piAgg[ar.pi_id] = {
          pi_id: ar.pi_id,
          pi_no: ar.pi_no,
          amountSum: 0,
          depositRatio: ar.deposit_ratio,
          currency: ar.currency,
          supplier_id: ar.pi_supplier_id || ar.po_supplier_id || '',
          supplier_name: ar.pi_supplier_name || ar.po_supplier_name || '',
          brand: ar.po_brand || '',
          country: ar.po_country || '',
          target_warehouse: ar.po_target_warehouse || ''
        };
        piPreTotal[ar.pi_id] = ar.pi_total_amount_pre;
      }
      piAgg[ar.pi_id].amountSum += ar.amount;
    }
    var piAggList = Object.keys(piAgg).map(function (k) { return piAgg[k]; });
    for (var pb = 0; pb < piAggList.length; pb++) {
      var pbg = piAggList[pb];
      var preT = Number(piPreTotal[pbg.pi_id] || 0);
      pbg.newTotal = preT + pbg.amountSum;
      pbg.payableDeposit = pbg.depositRatio > 0 ? pbg.newTotal * pbg.depositRatio / 100 : 0;
    }

    // ---- 2d. 创建 TEMP staging 表 ----
    var tStaging = DEBUG_PERF ? Date.now() : 0;
    var stagingJson = JSON.stringify(validated.map(function (r) {
      return {
        source_row_no: r.source_row_no, pi_no: r.pi_no, pi_id: r.pi_id, pii_id: r.pii_id,
        is_new_pi: r.is_new_pi, po_id: r.po_id, po_no: r.po_no, sku_code: r.sku_code,
        quantity: r.quantity, unit_price: r.unit_price, amount: r.amount,
        need_deposit: r.need_deposit, deposit_ratio: r.deposit_ratio,
        pi_date: r.pi_date, currency: r.currency, payment_terms: r.payment_terms,
        expected_delivery: r.expected_delivery, attachment: r.attachment, remark: r.remark,
        pi_supplier_id: r.pi_supplier_id, pi_supplier_name: r.pi_supplier_name,
        po_supplier_id: r.po_supplier_id, po_supplier_name: r.po_supplier_name,
        po_brand: r.po_brand, po_country: r.po_country, po_target_warehouse: r.po_target_warehouse
      };
    }));

    await run(
      'CREATE TEMP TABLE pi_import_staging ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset($1::jsonb) AS j(' +
      '  source_row_no int, pi_no text, pi_id text, pii_id text, is_new_pi boolean,' +
      '  po_id text, po_no text, sku_code text,' +
      '  quantity int, unit_price numeric, amount numeric,' +
      '  need_deposit int, deposit_ratio numeric,' +
      '  pi_date text, currency text, payment_terms text, expected_delivery text,' +
      '  attachment text, remark text,' +
      '  pi_supplier_id text, pi_supplier_name text,' +
      '  po_supplier_id text, po_supplier_name text, po_brand text, po_country text, po_target_warehouse text' +
      ')',
      [stagingJson]
    );
    sqlCalls++;

    // ---- 2e. 锁 PO + PI headers（锁序：PO id → PI id，id ASC）----
    var tLock = DEBUG_PERF ? Date.now() : 0;
    var poIds = Array.from(new Set(validated.map(function (r) { return r.po_id; })));
    var piIds = Array.from(new Set(validated.map(function (r) { return r.pi_id; })));

    if (poIds.length) {
      await aq(
        'SELECT id FROM purchase_orders WHERE id IN (' + ph(poIds.length) + ') ORDER BY id FOR UPDATE',
        poIds
      );
      sqlCalls++;
    }
    if (piIds.length) {
      await aq(
        'SELECT id FROM proforma_invoices WHERE id IN (' + ph(piIds.length) + ') ORDER BY id FOR UPDATE',
        piIds
      );
      sqlCalls++;
    }

    // ---- 2f. INSERT 新 PI headers（仅 newPiFirstRow 标记的行）----
    var tMutation = DEBUG_PERF ? Date.now() : 0;
    var headerRows = validated.filter(function (r) {
      return r.is_new_pi && newPiFirstRowNo[r.pi_no] === r.source_row_no;
    });
    if (headerRows.length) {
      var headerJson = JSON.stringify(headerRows.map(function (r) {
        return {
          pi_id: r.pi_id, pi_no: r.pi_no, po_id: r.po_id, po_no: r.po_no,
          supplier_id: r.pi_supplier_id || r.po_supplier_id || '',
          supplier_name: r.pi_supplier_name || r.po_supplier_name || '',
          brand: r.po_brand || '', country: r.po_country || '', target_warehouse: r.po_target_warehouse || '',
          pi_date: r.pi_date, currency: r.currency, payment_terms: r.payment_terms,
          expected_delivery: r.expected_delivery, attachment: r.attachment, remark: r.remark,
          need_deposit: r.need_deposit, deposit_ratio: r.deposit_ratio
        };
      }));
      await run(
        'INSERT INTO proforma_invoices (' +
        '  id, pi_no, related_po_id, related_po_no, supplier_id, supplier_name, brand, country, target_warehouse,' +
        '  pi_date, currency, total_amount, need_deposit, deposit_ratio, balance_ratio, payment_terms, expected_delivery, attachment, remark, pi_status' +
        ') SELECT ' +
        '  j.pi_id, j.pi_no, j.po_id, j.po_no, j.supplier_id, j.supplier_name, j.brand, j.country, j.target_warehouse,' +
        '  j.pi_date, j.currency, 0, j.need_deposit, j.deposit_ratio, 100 - j.deposit_ratio, j.payment_terms, j.expected_delivery, j.attachment, j.remark,' +
        '  \'uploaded\'' +
        ' FROM jsonb_to_recordset($1::jsonb) AS j(' +
        '  pi_id text, pi_no text, po_id text, po_no text, supplier_id text, supplier_name text,' +
        '  brand text, country text, target_warehouse text, pi_date text, currency text,' +
        '  payment_terms text, expected_delivery text, attachment text, remark text,' +
        '  need_deposit int, deposit_ratio numeric' +
        ')',
        [headerJson]
      );
      sqlCalls++;
    }

    // ---- 2g. INSERT PI items（所有合法行）----
    var itemJson = JSON.stringify(validated.map(function (r) {
      return {
        id: r.pii_id, pi_id: r.pi_id, pi_no: r.pi_no, po_no: r.po_no, sku_code: r.sku_code,
        po_qty: r.quantity, quantity: r.quantity, unit_price: r.unit_price, amount: r.amount
      };
    }));
    await run(
      'INSERT INTO proforma_invoice_items (' +
      '  id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty' +
      ') SELECT ' +
      '  j.id, j.pi_id, j.pi_no, j.po_no, j.sku_code, j.po_qty, j.quantity, j.unit_price, j.amount, 0, j.quantity' +
      ' FROM jsonb_to_recordset($1::jsonb) AS j(' +
      '  id text, pi_id text, pi_no text, po_no text, sku_code text, po_qty int, quantity int, unit_price numeric, amount numeric' +
      ')',
      [itemJson]
    );
    sqlCalls++;

    // ---- 2h. UPDATE PI totals（set-based，per PI；并发安全：从锁定的 items SUM 计算）----
    if (piAggList.length) {
      var piTotalsJson = JSON.stringify(piAggList.map(function (g) {
        return { pi_id: g.pi_id, deposit_ratio: g.depositRatio };
      }));
      await run(
        'UPDATE proforma_invoices p SET ' +
        '  total_amount = s.total,' +
        '  payable_deposit = CASE WHEN v.deposit_ratio > 0 THEN s.total * v.deposit_ratio / 100 ELSE 0 END,' +
        '  available_deduct_deposit = CASE WHEN v.deposit_ratio > 0 THEN s.total * v.deposit_ratio / 100 ELSE 0 END ' +
        'FROM jsonb_to_recordset($1::jsonb) AS v(pi_id text, deposit_ratio numeric) ' +
        'CROSS JOIN LATERAL (SELECT COALESCE(SUM(pi_amount),0) AS total FROM proforma_invoice_items WHERE pi_id = v.pi_id) s ' +
        'WHERE p.id = v.pi_id',
        [piTotalsJson]
      );
      sqlCalls++;
    }

    // ---- 2i. UPDATE purchase_orders po_status='transferred_pi' ----
    if (poIds.length) {
      await run(
        'UPDATE purchase_orders SET po_status = \'transferred_pi\' WHERE id IN (' + ph(poIds.length) + ')',
        poIds
      );
      sqlCalls++;
    }

    // ---- 2j. PAY-CORE: deposit payable upsert（per PI）----
    // 业务模型（与 legacy findActivePayableItem + createPayableItemFromSource + syncPayableItemAmount 等价）：
    //   deposit payable identity = (source_type='pi', source_id=pi_id, COALESCE(source_ci_id,''), fee_type='deposit')，永久唯一
    //   active   → authoritative UPDATE 金额（与 legacy syncPayableItemAmount 语义一致）
    //   非 active → 跳过（createPayableItemFromSource 返回历史行不重建；P0-FIX-3 语义）
    //   无 active/非 active 且需创建 → INSERT（仅当 payableDeposit>0）
    // S2 MUTABILITY 已在 2b 前置拒绝「金额变化 + 锁定态」行；此处正常只见到 active 或 cancelled（后者跳过创建）。
    // 用提交的 PI 总额（items-sum，含本次导入）计算定金，避免并发 stale-read（与 2h 一致）：
    //   deposit payable 金额 = total_amount * deposit_ratio / 100（仅当 need_deposit 且 ratio>0 且金额>0）
    var payPiList = [];
    if (piIds.length) {
      var finalPis = await aq(
        'SELECT id, total_amount, deposit_ratio, need_deposit, currency FROM proforma_invoices WHERE id IN (' + ph(piIds.length) + ')',
        piIds
      );
      sqlCalls++;
      for (var fp = 0; fp < finalPis.length; fp++) {
        var fpRow = finalPis[fp];
        var nd = Number(fpRow.need_deposit) || 0;
        var dr = Number(fpRow.deposit_ratio) || 0;
        if (nd && dr > 0) {
          var pd = Number(fpRow.total_amount) * dr / 100;
          if (pd > 0) payPiList.push({ pi_id: fpRow.id, payableDeposit: pd, currency: fpRow.currency || 'USD' });
        }
      }
    }

    var existingPayables = [];
    if (payPiList.length) {
      var payQueryJson = JSON.stringify(payPiList.map(function (g) {
        return { pi_id: g.pi_id };
      }));
      existingPayables = await aq(
        'SELECT * FROM payable_items pi ' +
        'JOIN jsonb_to_recordset($1::jsonb) AS k(pi_id text) ON pi.source_id = k.pi_id ' +
        'WHERE pi.source_type = \'pi\' AND pi.fee_type = \'deposit\' AND COALESCE(pi.source_ci_id, \'\') = \'\'',
        [payQueryJson]
      );
      sqlCalls++;
    }

    var existingByPi = {};
    for (var ep = 0; ep < existingPayables.length; ep++) {
      var epRow = existingPayables[ep];
      if (existingByPi[epRow.source_id] === undefined) existingByPi[epRow.source_id] = epRow;
    }

    var toUpdate = [];
    var toInsert = [];
    for (var pp = 0; pp < payPiList.length; pp++) {
      var pg = payPiList[pp];
      var amountMinor = Math.round(pg.payableDeposit * 100);
      if (amountMinor <= 0) continue;

      var exRow = existingByPi[pg.pi_id];
      if (exRow) {
        if (exRow.lifecycle_status === 'active') {
          toUpdate.push({ id: exRow.id, amount_minor: amountMinor });
        }
        // 非 active（含 cancelled）：跳过（不创建、不更新），与 legacy createPayableItemFromSource 返回历史行一致
        continue;
      }
      // 无 deposit payable → 新建
      var payItemId = genId('payitem');
      var payeeKey = 'supplier:' + (pg.supplier_id || pg.supplier_name || '');
      toInsert.push({
        id: payItemId,
        fee_no: 'PAY-ITEM-' + new Date().getFullYear() + '-' +
          String(Date.now()).slice(-6) + '-' + payItemId.slice(-6),
        source_id: pg.pi_id,
        source_no: pg.pi_no,
        payee_key: payeeKey,
        payee_name: pg.supplier_name || '',
        currency: pg.currency,
        amount_minor: amountMinor,
        created_by: userCtx.userId
      });
    }

    if (toUpdate.length) {
      var updateJson = JSON.stringify(toUpdate.map(function (r) {
        return { id: r.id, amount_minor: r.amount_minor };
      }));
      await run(
        'UPDATE payable_items SET payable_amount_minor = v.amount_minor ' +
        'FROM jsonb_to_recordset($1::jsonb) AS v(id text, amount_minor int) ' +
        'WHERE payable_items.id = v.id AND payable_items.is_active = 1',
        [updateJson]
      );
      sqlCalls++;
    }

    if (toInsert.length) {
      var insertJson = JSON.stringify(toInsert.map(function (r) {
        return {
          id: r.id, fee_no: r.fee_no, source_id: r.source_id, source_no: r.source_no,
          payee_key: r.payee_key, payee_name: r.payee_name, currency: r.currency, amount_minor: r.amount_minor,
          created_by: r.created_by
        };
      }));
      await run(
        'INSERT INTO payable_items (' +
        '  id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type,' +
        '  category_code, subcategory_code, payee_type, payee_key, payee_name_snapshot,' +
        '  payer_entity_key, payer_name_snapshot, currency, payable_amount_minor,' +
        '  is_active, lifecycle_status, payable_date, created_by' +
        ') SELECT ' +
        '  j.id, j.fee_no, \'pi\', j.source_id, j.source_no, \'\', \'deposit\',' +
        '  \'goods\', \'deposit\', \'factory\', j.payee_key, j.payee_name,' +
        '  \'self\', \'\', j.currency, j.amount_minor,' +
        '  1, \'active\', \'\', j.created_by ' +
        'FROM jsonb_to_recordset($1::jsonb) AS j(' +
        '  id text, fee_no text, source_id text, source_no text,' +
        '  payee_key text, payee_name text, currency text, amount_minor int,' +
        '  created_by text' +
        ')',
        [insertJson]
      );
      sqlCalls++;
    }

    var tEnd = DEBUG_PERF ? Date.now() : 0;
    if (DEBUG_PERF) {
      console.log('[PI IMPORT PERF]', JSON.stringify({
        rows_total: rows.length,
        rows_valid: validated.length,
        rows_invalid: invalidRows.length + validationErrors.length,
        fixed_sql_calls: sqlCalls,
        validation_ms: tStaging - tValidation,
        staging_ms: tLock - tStaging,
        lock_ms: tMutation - tLock,
        mutation_ms: tEnd - tMutation,
        transaction_total_ms: tEnd - tValidation
      }));
    }

    return {
      success: validated.length,
      failed: invalidRows.length + validationErrors.length,
      total: rows.length,
      errors: invalidRows.concat(validationErrors)
    };
  });

  return {
    success: txResult.success,
    failed: txResult.failed,
    total: txResult.total,
    errors: txResult.errors
  };
}

module.exports = { importProformaInvoicesPg };
