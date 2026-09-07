'use strict';
// =============================================================================
// Wave 2A — CI batch-import PG async path
// =============================================================================
// 设计依据：WAVE2-BATCH-IMPORT-ASYNC-DESIGN.md + 用户 Wave 2A 指令
//
// 核心原则：
//   1. 完全脱离 sync bridge（db.query/queryOne/run/transaction = 0）
//   2. partial-success 语义：expected validation failure → 该行 failed，其他行可成功；
//      unexpected mutation/DB failure → 整个 mutation ROLLBACK
//   3. set-based mutations（无 N-dependent SQL calls）
//   4. 金额/rounding 在 JS 内计算（Math.round 保持不动），SQL 只消费规范化值
//   5. PI/PI item 锁序与 Wave 1 reverse 兼容：PI headers ORDER BY id → PI items ORDER BY id
//   6. PAY-CORE 在同一 withGenerateClient 事务内完成
//   7. after-COMMIT 才触发 updateInventoryTransitDataAsync
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

// 日期校验（复刻 historicalCIDate 语义）
function validateDate(value, label, required) {
  var date = String(value || '').trim().slice(0, 10);
  if (!date && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(label + '必须为 YYYY-MM-DD');
  var parsed = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(label + '无效');
  }
  return date;
}

function addDays(dateStr, days) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  var d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function resolvePayableDate(opts) {
  var due = String(opts.dueDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  if (Number(opts.creditDays) > 0 && opts.baseDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.baseDate)) {
    return addDays(opts.baseDate, Number(opts.creditDays));
  }
  return '';
}

function ph(n) { return Array(n).fill('?').join(','); }

var DEBUG_PERF = process.env.WAVE2A_CI_DEBUG === '1';

// =============================================================================
// Layer 1: 纯 JS 预处理
// =============================================================================
function preprocessRows(rows) {
  var validRows = [];
  var invalidRows = [];
  var seen = new Set(); // (ci_no, sku_code) 重复检测
  var dupKeys = new Set(); // 所有重复 key（含首现）
  var ciIdByNo = {}; // ci_no → 共享 ci_id（同一 CI 多行用同一 id）

  // 第一遍预扫描：统计 (ci_no, sku) 出现次数，找出所有重复 key
  var keyCounts = {};
  for (var pi = 0; pi < rows.length; pi++) {
    var prow = rows[pi];
    var pSku = s(pick(prow, ['SKU', 'sku_code']));
    var pCiNo = s(pick(prow, ['CI编号', 'ci_no']));
    if (pSku && pCiNo) {
      var pk = pCiNo + '\u0000' + pSku;
      keyCounts[pk] = (keyCounts[pk] || 0) + 1;
    }
  }
  for (var dk in keyCounts) {
    if (keyCounts[dk] > 1) dupKeys.add(dk);
  }

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var idx = i;
    var sourceRowNo = idx + 2; // 与 legacy 一致（跳过表头行）

    try {
      var sku = s(pick(row, ['SKU', 'sku_code']));
      if (!sku) throw new Error('SKU不能为空');

      var actualShipDate = validateDate(
        s(pick(row, ['实际出货日期', 'actual_ship_date'])), '实际出货日期', true
      );

      var poNo = s(pick(row, ['关联PO编号', 'PO编号', 'related_po_no', 'po_no']));
      var piNo = s(pick(row, ['关联PI编号', 'PI编号', 'related_pi_no', 'pi_no']));
      if (!piNo) throw new Error('CI 必须关联 PI，不能直接创建');

      var ciNo = s(pick(row, ['CI编号', 'ci_no'])) ||
        ('CI-' + new Date().getFullYear() + '-' + String(Date.now() + idx).slice(-6));

      var qty = n(pick(row, ['数量', 'CI数量', 'shipped_qty', 'qty']), 0);
      var price = n(pick(row, ['单价', 'unit_price']), 0);

      var rateRaw = pick(row, ['实际关税税率', 'actual_customs_rate']);
      var actualCustomsRate = (rateRaw === '' || rateRaw === null || rateRaw === undefined)
        ? null : Number(rateRaw);
      if (actualCustomsRate !== null &&
          (!Number.isFinite(actualCustomsRate) || actualCustomsRate < 0)) {
        throw new Error('实际关税税率必须为不小于0的数字：' + sku);
      }

      // 重复检测：(ci_no, sku_code) fail-closed —— 所有重复行（含首现）都标记失败
      var dedupKey = ciNo + '\u0000' + sku;
      if (dupKeys.has(dedupKey)) {
        throw new Error('输入重复：同一导入内 CI ' + ciNo + ' + SKU ' + sku + ' 重复');
      }
      seen.add(dedupKey);

      validRows.push({
        source_row_no: sourceRowNo,
        ci_no: ciNo,
        ci_id: ciIdByNo[ciNo] || (ciIdByNo[ciNo] = genId('ci')),
        cii_id: genId('cii'),
        po_no: poNo,
        pi_no: piNo,
        sku_code: sku,
        quantity: qty,
        unit_price: price,
        actual_customs_rate: actualCustomsRate,
        actual_ship_date: actualShipDate,
        ci_date: s(pick(row, ['CI日期', 'ci_date'])) || new Date().toISOString().split('T')[0],
        currency: s(pick(row, ['币种', 'currency'])),
        difference_reason: s(pick(row, ['差异原因', 'difference_reason'])),
        attachment: parseAttachment(row.attachment || ''),
        pl_attachment: parseAttachment(row.pl_attachment || ''),
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
async function importCommercialInvoicesPg(rows, req) {
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

  // ---- Layer 2: withGenerateClient ----
  var txResult = await withGenerateClient(async function (aq, aqOne, run) {
    var tValidation = DEBUG_PERF ? Date.now() : 0;
    var sqlCalls = 0;

    // ---- 2a. 验证查询（jsonb_to_recordset + LEFT JOIN，单次获取所有解析数据）----
    var inputJson = JSON.stringify(validRows.map(function (r) {
      return {
        source_row_no: r.source_row_no, ci_no: r.ci_no, ci_id: r.ci_id,
        po_no: r.po_no, pi_no: r.pi_no, sku_code: r.sku_code,
        quantity: r.quantity, unit_price: r.unit_price,
        actual_customs_rate: r.actual_customs_rate !== null ? String(r.actual_customs_rate) : null,
        actual_ship_date: r.actual_ship_date, ci_date: r.ci_date, currency: r.currency,
        difference_reason: r.difference_reason, attachment: r.attachment,
        pl_attachment: r.pl_attachment, remark: r.remark
      };
    }));

    var validationRows = await aq(
      'WITH input_rows AS (' +
      '  SELECT * FROM jsonb_to_recordset($1::jsonb) AS j(' +
      '    source_row_no int, ci_no text, ci_id text, po_no text, pi_no text, sku_code text,' +
      '    quantity int, unit_price numeric,' +
      '    actual_customs_rate text, actual_ship_date text, ci_date text, currency text,' +
      '    difference_reason text, attachment text, pl_attachment text, remark text' +
      '  )' +
      ') SELECT ' +
      '  i.source_row_no, i.ci_no, i.ci_id, i.po_no, i.pi_no, i.sku_code,' +
      '  i.quantity, i.unit_price, i.actual_ship_date, i.ci_date, i.currency,' +
      '  i.difference_reason, i.attachment, i.pl_attachment, i.remark,' +
      '  COALESCE(NULLIF(i.actual_customs_rate, \'\')::numeric, NULL) AS actual_customs_rate,' +
      '  s.id AS sku_exists, s.reference_customs_rate AS sku_reference_customs_rate,' +
      '  pi.id AS pi_id, pi.pi_no AS pi_pi_no, pi.total_amount AS pi_total_amount,' +
      '  pi.shipped_amount AS pi_shipped_amount, pi.need_deposit AS pi_need_deposit,' +
      '  pi.deposit_payment_status AS pi_deposit_payment_status,' +
      '  pi.available_deduct_deposit AS pi_available_deduct_deposit,' +
      '  pi.related_po_no AS pi_related_po_no, pi.payment_term_id AS pi_payment_term_id,' +
      '  pi.supplier_id AS pi_supplier_id, pi.supplier_name AS pi_supplier_name,' +
      '  po.id AS po_id, po.po_no AS po_po_no, po.supplier_id AS po_supplier_id,' +
      '  po.supplier_name AS po_supplier_name, po.brand AS po_brand,' +
      '  po.country AS po_country, po.target_warehouse AS po_target_warehouse,' +
      '  po.currency AS po_currency,' +
      '  pii.id AS pii_id, pii.pi_confirmed_qty AS pii_pi_confirmed_qty,' +
      '  pii.discount AS pii_discount, pii.shipped_qty AS pii_shipped_qty,' +
      '  ci.id AS existing_ci_id, ci.cost_confirmed AS ci_cost_confirmed,' +
      '  ci.ci_status AS ci_ci_status,' +
      '  COALESCE(ci_amt.existing_amount, 0) AS existing_ci_goods_amount,' +
      '  COALESCE(ci_shipped_sum.existing_shipped_qty, 0) AS existing_ci_shipped_qty,' +
      '  spt.id AS credit_payment_term_id, spt.credit_days AS credit_days' +
      ' FROM input_rows i' +
      ' LEFT JOIN skus s ON s.sku_code = i.sku_code' +
      ' LEFT JOIN proforma_invoices pi ON pi.pi_no = i.pi_no' +
      ' LEFT JOIN purchase_orders po ON po.po_no = COALESCE(NULLIF(i.po_no, \'\'), pi.related_po_no)' +
      ' LEFT JOIN proforma_invoice_items pii ON pii.pi_id = pi.id AND pii.sku_code = i.sku_code' +
      ' LEFT JOIN commercial_invoices ci ON ci.ci_no = i.ci_no' +
      ' LEFT JOIN supplier_payment_terms spt ON spt.id = pi.payment_term_id AND spt.term_type = \'credit\'' +
      ' LEFT JOIN (SELECT ci_id, SUM(ci_amount) AS existing_amount FROM commercial_invoice_items GROUP BY ci_id) ci_amt ON ci_amt.ci_id = ci.id' +
      ' LEFT JOIN (SELECT pi_no, sku_code, SUM(shipped_qty) AS existing_shipped_qty FROM commercial_invoice_items GROUP BY pi_no, sku_code) ci_shipped_sum ON ci_shipped_sum.pi_no = i.pi_no AND ci_shipped_sum.sku_code = i.sku_code' +
      ' ORDER BY i.source_row_no',
      [inputJson]
    );
    sqlCalls++;

    // ---- 2b. JS: 验证 + 分区 ----
    var validated = [];
    var validationErrors = [];
    var newCiFirstRowNo = {}; // ci_no -> source_row_no of the first row（仅第一行用于 header INSERT）
    var batchQtyByKey = {}; // (pi_no, sku_code) -> total batch qty

    // 预计算 batch qty per (pi_no, sku_code) for shipped limit check
    for (var bi = 0; bi < validationRows.length; bi++) {
      var br = validationRows[bi];
      var bk = br.pi_no + '\u0000' + br.sku_code;
      batchQtyByKey[bk] = (batchQtyByKey[bk] || 0) + br.quantity;
    }

    for (var vi = 0; vi < validationRows.length; vi++) {
      var vr = validationRows[vi];
      var rowNo = vr.source_row_no;
      var errs = [];

      // SKU 存在性
      if (!vr.sku_exists) errs.push('SKU不存在：' + vr.sku_code);

      // PI 存在性 + 定金守卫
      if (!vr.pi_id) {
        errs.push('关联的PI不存在：' + vr.pi_no);
      } else {
        if (vr.pi_need_deposit && vr.pi_deposit_payment_status !== 'paid') {
          errs.push('PI 定金尚未付清，不能生成 CI：' + vr.pi_pi_no);
        }
      }

      // PO 验证
      if (!vr.po_id) {
        if (vr.po_no) {
          errs.push('无法匹配PO：' + vr.po_no);
        } else {
          errs.push('无法匹配PO：PO编号为空或PI未关联PO');
        }
      }

      // CI cost_confirmed 守卫
      if (vr.existing_ci_id && vr.ci_cost_confirmed) {
        errs.push('该CI费用已确认，不能继续追加或修改CI明细：' + vr.ci_no);
      }

      // PI item 存在性 + shipped limit check
      if (vr.pi_id && vr.pii_id) {
        var bk2 = vr.pi_no + '\u0000' + vr.sku_code;
        var batchQty = batchQtyByKey[bk2] || 0;
        var cumulativeCi = Number(vr.existing_ci_shipped_qty) + batchQty;
        if (cumulativeCi > (vr.pii_pi_confirmed_qty || 0)) {
          errs.push('CI出货数量超过PI剩余数量（SKU: ' + vr.sku_code +
            ', PI确认数量: ' + (vr.pii_pi_confirmed_qty || 0) +
            ', 已发货数量: ' + (Number(vr.existing_ci_shipped_qty) || 0) +
            ', 本次CI数量: ' + batchQty + '），请检查后重新提交。');
        }
      }

      if (errs.length > 0) {
        validationErrors.push({ row: rowNo, reason: errs[0] });
      } else {
        // 解析 discount + 计算金额（pure JS，保持 Math 语义）
        var discountRate = vr.pii_discount ? Number(vr.pii_discount) : 0;
        var netUnitPrice = vr.unit_price * (1 - discountRate);
        var amount = vr.quantity * netUnitPrice;

        // 确定 actual_customs_rate
        var actualCustomsRate = vr.actual_customs_rate;
        if (actualCustomsRate === null) {
          actualCustomsRate = (vr.sku_reference_customs_rate !== null &&
            vr.sku_reference_customs_rate !== undefined)
            ? Number(vr.sku_reference_customs_rate) : null;
        }

        var isNewCi = !vr.existing_ci_id;
        var ciId = isNewCi ? vr.ci_id : vr.existing_ci_id;

        // 标记新 CI 的第一行用于 header INSERT（按 source_row_no 精确定位）
        if (isNewCi && !newCiFirstRowNo[vr.ci_no]) {
          newCiFirstRowNo[vr.ci_no] = vr.source_row_no;
        }

        validated.push({
          source_row_no: rowNo,
          ci_no: vr.ci_no,
          ci_id: ciId,
          cii_id: genId('cii'),
          is_new_ci: isNewCi,
          po_id: vr.po_id,
          po_no: vr.po_po_no,
          pi_id: vr.pi_id,
          pi_no: vr.pi_pi_no,
          sku_code: vr.sku_code,
          quantity: vr.quantity,
          unit_price: vr.unit_price,
          discount: discountRate,
          net_unit_price: netUnitPrice,
          amount: amount,
          actual_customs_rate: actualCustomsRate,
          actual_ship_date: vr.actual_ship_date,
          ci_date: vr.ci_date,
          currency: vr.currency || vr.po_currency || 'USD',
          difference_reason: vr.difference_reason,
          attachment: vr.attachment,
          pl_attachment: vr.pl_attachment,
          remark: vr.remark,
          pi_total_amount: Number(vr.pi_total_amount) || 0,
          pi_shipped_amount_pre: Number(vr.pi_shipped_amount) || 0,
          pi_need_deposit: vr.pi_need_deposit,
          pi_available_deduct_deposit: Number(vr.pi_available_deduct_deposit) || 0,
          pi_supplier_id: vr.pi_supplier_id,
          pi_supplier_name: vr.pi_supplier_name,
          po_supplier_id: vr.po_supplier_id,
          po_supplier_name: vr.po_supplier_name,
          po_brand: vr.po_brand,
          po_country: vr.po_country,
          po_target_warehouse: vr.po_target_warehouse,
          existing_ci_goods_amount: Number(vr.existing_ci_goods_amount) || 0,
          credit_payment_term_id: vr.credit_payment_term_id || '',
          credit_days: vr.credit_days ? Number(vr.credit_days) : 0
        });
      }
    }

    // 第二遍：验证 duplicate DB item（同 CI + 同 SKU 在 DB 中已有 item）
    var dbDupCheck = {};
    for (var di = 0; di < validated.length; di++) {
      var dv = validated[di];
      var dbKey = dv.ci_id + '\u0000' + dv.sku_code;
      if (dbDupCheck[dbKey]) {
        validationErrors.push({
          row: dv.source_row_no,
          reason: '该CI已存在相同SKU明细：' + dv.ci_no + ' / ' + dv.sku_code
        });
        dv._invalid = true;
      } else {
        dbDupCheck[dbKey] = true;
      }
    }
    validated = validated.filter(function (r) { return !r._invalid; });

    // ---- 2b-2. PAY MUTABILITY 验证（mutation 前；按 CI identity 分组 fail-closed）----
    // 业务事实：balance payable 的 identity = (source_type='pi', source_id=pi_id,
    //   source_ci_id=ci_id, fee_type='balance')，它是**整条 CI 的事实**，不是单个 SKU row 的事实。
    //   active                                        → 允许导入创建 / 同步金额
    //   partially_paid / reserved / paid / cancelled / released → 终态/锁定态，导入不可修改，
    //     且不可新增第二条（uq_payable_identity 全生命周期唯一，二次 INSERT 会撞唯一约束）。
    // 顺序红线：本检查必须早于 2c（sequential deposit deduct）与 2d~2l（任何 business mutation）。
    //   - 若晚于 2c：被拒行会先消耗 PI 定金池，导致其余行的 deduct 分摊错误；
    //   - 若晚于 2f/2g/2h：会出现「failed=1 但 CI header/item 已插入、PI shipped_qty 已改变」，
    //     违反 Wave 2A 已锁定的 partial-success 标准：expected validation failure → 该行 DB mutation = 0。
    // 分组规则（§四）：同一 CI（pi_id + ci_id）本批所有 source rows 命运一致，要么全过要么全拒，
    //   避免 CI total 与 payable business fact 分裂；errors 仍按 source_row_no 逐行回报。
    var PAY_LOCKED_STATES = { partially_paid: 1, reserved: 1, paid: 1, cancelled: 1, released: 1 };

    // 仅已存在的 CI 才可能已有 payable（新 CI 的 ci_id 是本批新生成，DB 中不可能有对应 payable）
    var existingCiPairs = [];
    var existingCiPairSeen = {};
    for (var mi = 0; mi < validated.length; mi++) {
      var mr = validated[mi];
      if (mr.is_new_ci) continue;
      var mk = mr.pi_id + '\u0000' + mr.ci_id;
      if (existingCiPairSeen[mk]) continue;
      existingCiPairSeen[mk] = true;
      existingCiPairs.push({ pi_id: mr.pi_id, ci_id: mr.ci_id, ci_no: mr.ci_no });
    }

    // 一次性 set-based lookup（SQL 调用数不随行数增长）
    var lockedCiKey = {}; // (pi_id \0 ci_id) -> lifecycle_status
    if (existingCiPairs.length) {
      var mutJson = JSON.stringify(existingCiPairs.map(function (p) {
        return { pi_id: p.pi_id, ci_id: p.ci_id };
      }));
      var lockedRows = await aq(
        'SELECT pi.source_id AS pi_id, pi.source_ci_id AS ci_id, pi.lifecycle_status AS lifecycle_status ' +
        'FROM payable_items pi ' +
        'JOIN jsonb_to_recordset($1::jsonb) AS k(pi_id text, ci_id text) ' +
        'ON pi.source_id = k.pi_id AND pi.source_ci_id = k.ci_id ' +
        'WHERE pi.source_type = \'pi\' AND pi.fee_type = \'balance\'',
        [mutJson]
      );
      sqlCalls++;
      for (var li = 0; li < lockedRows.length; li++) {
        var lr = lockedRows[li];
        if (PAY_LOCKED_STATES[lr.lifecycle_status]) {
          lockedCiKey[lr.pi_id + '\u0000' + lr.ci_id] = lr.lifecycle_status;
        }
      }
    }

    // 按 CI group 拒绝：命中锁定态的 CI，其本批所有 source rows 全部标记 invalid
    if (Object.keys(lockedCiKey).length) {
      for (var mj = 0; mj < validated.length; mj++) {
        var mrow = validated[mj];
        var mstat = lockedCiKey[mrow.pi_id + '\u0000' + mrow.ci_id];
        if (!mstat) continue;
        mrow._invalid = true;
        validationErrors.push({
          row: mrow.source_row_no,
          reason: '该CI的尾款应付已处于' + mstat + '状态，导入不可修改或新增应付（该CI未做任何变更）：' + mrow.ci_no
        });
      }
      validated = validated.filter(function (r) { return !r._invalid; });
    }

    if (validated.length === 0) {
      return {
        success: 0,
        failed: validationErrors.length + invalidRows.length,
        total: rows.length,
        errors: invalidRows.concat(validationErrors)
      };
    }

    // ---- 2c. JS 模拟 sequential deduct 计算 ----
    // 跟踪 PI shipped_amount（从 pre-batch 值开始，随新 CI 行递增）
    var piShipMap = {}; // pi_id -> current shipped_amount
    var ciGoodsMap = {}; // ci_id -> cumulative goods_amount

    for (var pi = 0; pi < validated.length; pi++) {
      var vr2 = validated[pi];
      if (piShipMap[vr2.pi_id] === undefined) {
        piShipMap[vr2.pi_id] = vr2.pi_shipped_amount_pre;
      }
      if (ciGoodsMap[vr2.ci_id] === undefined) {
        ciGoodsMap[vr2.ci_id] = vr2.existing_ci_goods_amount;
      }
    }

    // 按 source_row_no 排序（保持输入顺序）
    validated.sort(function (a, b) { return a.source_row_no - b.source_row_no; });

    var ciFinalValues = {}; // ci_id -> final values

    for (var si = 0; si < validated.length; si++) {
      var row = validated[si];

      // 累加 CI goods_amount
      ciGoodsMap[row.ci_id] = (ciGoodsMap[row.ci_id] || 0) + row.amount;
      var goodsAmount = ciGoodsMap[row.ci_id];

      // piRemaining 使用当前 piShipMap 值（= pre-batch + 前面所有新 CI 行的 amount）
      var piShipBefore = piShipMap[row.pi_id];
      var piRemaining = row.pi_total_amount - piShipBefore;

      // R7: 定金按实际出货货值比例分摊
      var deduct = 0;
      if (row.pi_need_deposit && row.pi_available_deduct_deposit > 0) {
        var newRemaining = piRemaining - goodsAmount;
        if (piRemaining <= 0.01 || newRemaining <= 0.01) {
          deduct = row.pi_available_deduct_deposit;
        } else {
          deduct = row.pi_available_deduct_deposit * goodsAmount / piRemaining;
        }
      }

      var payableBalance = goodsAmount - deduct;

      // 更新 ciFinalValues（最后一条覆盖，与 legacy 逐行 UPDATE 一致）
      ciFinalValues[row.ci_id] = {
        ci_id: row.ci_id,
        ci_no: row.ci_no,
        goods_amount: goodsAmount,
        deduct: deduct,
        payable_balance: payableBalance,
        pi_id: row.pi_id,
        pi_no: row.pi_no,
        currency: row.currency,
        actual_ship_date: row.actual_ship_date,
        credit_days: row.credit_days,
        credit_payment_term_id: row.credit_payment_term_id,
        pi_supplier_id: row.pi_supplier_id,
        pi_supplier_name: row.pi_supplier_name,
        po_supplier_name: row.po_supplier_name
      };

      // 更新 PI shipped_amount（仅新 CI）
      if (row.is_new_ci) {
        piShipMap[row.pi_id] = piShipBefore + row.amount;
      }
    }

    // ---- 2d. 创建 TEMP staging 表 ----
    var tStaging = DEBUG_PERF ? Date.now() : 0;
    var stagingJson = JSON.stringify(validated.map(function (r) {
      return {
        source_row_no: r.source_row_no, ci_no: r.ci_no, ci_id: r.ci_id, is_new_ci: r.is_new_ci,
        po_id: r.po_id, po_no: r.po_no, pi_id: r.pi_id, pi_no: r.pi_no, sku_code: r.sku_code,
        quantity: r.quantity, unit_price: r.unit_price, discount: r.discount, net_unit_price: r.net_unit_price, amount: r.amount,
        actual_customs_rate: r.actual_customs_rate !== null ? String(r.actual_customs_rate) : null,
        actual_ship_date: r.actual_ship_date, ci_date: r.ci_date, currency: r.currency,
        difference_reason: r.difference_reason, attachment: r.attachment, pl_attachment: r.pl_attachment, remark: r.remark,
        pi_total_amount: r.pi_total_amount, pi_supplier_id: r.pi_supplier_id, pi_supplier_name: r.pi_supplier_name,
        po_supplier_id: r.po_supplier_id, po_supplier_name: r.po_supplier_name, po_brand: r.po_brand, po_country: r.po_country, po_target_warehouse: r.po_target_warehouse,
        credit_payment_term_id: r.credit_payment_term_id, credit_days: r.credit_days
      };
    }));

    await run(
      'CREATE TEMP TABLE ci_import_staging ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset($1::jsonb) AS j(' +
      '  source_row_no int, ci_no text, ci_id text, is_new_ci boolean,' +
      '  po_id text, po_no text, pi_id text, pi_no text, sku_code text,' +
      '  quantity int, unit_price numeric, discount numeric, net_unit_price numeric, amount numeric,' +
      '  actual_customs_rate text, actual_ship_date text, ci_date text, currency text,' +
      '  difference_reason text, attachment text, pl_attachment text, remark text,' +
      '  pi_total_amount numeric, pi_supplier_id text, pi_supplier_name text,' +
      '  po_supplier_id text, po_supplier_name text, po_brand text, po_country text, po_target_warehouse text,' +
      '  credit_payment_term_id text, credit_days int' +
      ')',
      [stagingJson]
    );
    sqlCalls++;

    // ---- 2e. 锁 PI headers + PI items（Wave 1 兼容锁序）----
    var tLock = DEBUG_PERF ? Date.now() : 0;
    var piIds = Object.keys(piShipMap);

    if (piIds.length) {
      await aq(
        'SELECT * FROM proforma_invoices WHERE id IN (' + ph(piIds.length) + ') ORDER BY id FOR UPDATE',
        piIds
      );
      sqlCalls++;
      await aq(
        'SELECT id FROM proforma_invoice_items WHERE pi_id IN (' + ph(piIds.length) + ') ORDER BY id FOR UPDATE',
        piIds
      );
      sqlCalls++;
    }

    // ---- 2f. INSERT 新 CI headers（仅 newCiFirstRow 标记的行）----
    var tMutation = DEBUG_PERF ? Date.now() : 0;
    var headerRows = validated.filter(function (r) {
      return r.is_new_ci && newCiFirstRowNo[r.ci_no] === r.source_row_no;
    });
    if (headerRows.length) {
      var headerJson = JSON.stringify(headerRows.map(function (r) {
        return {
          ci_id: r.ci_id, ci_no: r.ci_no, po_id: r.po_id, po_no: r.po_no, pi_id: r.pi_id, pi_no: r.pi_no,
          supplier_id: r.pi_supplier_id || r.po_supplier_id || '',
          supplier_name: r.pi_supplier_name || r.po_supplier_name || '',
          brand: r.po_brand || '', country: r.po_country || '', target_warehouse: r.po_target_warehouse || '',
          ci_date: r.ci_date, actual_ship_date: r.actual_ship_date,
          payment_term_id: r.credit_payment_term_id, credit_days: r.credit_days,
          currency: r.currency, pi_total_amount: r.pi_total_amount, difference_reason: r.difference_reason,
          attachment: r.attachment, pl_attachment: r.pl_attachment, remark: r.remark
        };
      }));
      await run(
        'INSERT INTO commercial_invoices (' +
        '  id, ci_no, related_po_id, related_po_no, related_pi_id, related_pi_no,' +
        '  supplier_id, supplier_name, brand, country, target_warehouse,' +
        '  ci_date, actual_ship_date, payment_term_id, credit_days,' +
        '  currency, goods_amount, pi_total_amount, amount_difference, difference_reason,' +
        '  ci_status, attachment, pl_attachment, remark' +
        ') SELECT ' +
        '  j.ci_id, j.ci_no, j.po_id, j.po_no, j.pi_id, j.pi_no,' +
        '  j.supplier_id, j.supplier_name, j.brand, j.country, j.target_warehouse,' +
        '  j.ci_date, j.actual_ship_date, j.payment_term_id, j.credit_days,' +
        '  j.currency, 0, j.pi_total_amount, 0, j.difference_reason,' +
        '  \'uploaded\', j.attachment, j.pl_attachment, j.remark' +
        ' FROM jsonb_to_recordset($1::jsonb) AS j(' +
        '  ci_id text, ci_no text, po_id text, po_no text, pi_id text, pi_no text,' +
        '  supplier_id text, supplier_name text, brand text, country text, target_warehouse text,' +
        '  ci_date text, actual_ship_date text, payment_term_id text, credit_days int,' +
        '  currency text, pi_total_amount numeric, difference_reason text,' +
        '  attachment text, pl_attachment text, remark text' +
        ')',
        [headerJson]
      );
      sqlCalls++;
    }

    // ---- 2g. INSERT CI items ----
    var itemJson = JSON.stringify(validated.map(function (r) {
      return {
        id: r.cii_id, ci_id: r.ci_id, ci_no: r.ci_no, pi_no: r.pi_no, pi_id: r.pi_id, sku_code: r.sku_code,
        shipped_qty: r.quantity, unit_price: r.unit_price, discount: r.discount, net_unit_price: r.net_unit_price, ci_amount: r.amount,
        actual_customs_rate: r.actual_customs_rate !== null ? String(r.actual_customs_rate) : null,
        inbound_qty: 0, uninbound_qty: r.quantity
      };
    }));
    await run(
      'INSERT INTO commercial_invoice_items (' +
      '  id, ci_id, ci_no, pi_no, pi_id, sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount, actual_customs_rate, inbound_qty, uninbound_qty' +
      ') SELECT ' +
      '  j.id, j.ci_id, j.ci_no, j.pi_no, j.pi_id, j.sku_code,' +
      '  j.shipped_qty, j.unit_price, j.discount, j.net_unit_price, j.ci_amount,' +
      '  NULLIF(j.actual_customs_rate, \'\')::numeric, j.inbound_qty, j.uninbound_qty' +
      ' FROM jsonb_to_recordset($1::jsonb) AS j(' +
      '  id text, ci_id text, ci_no text, pi_no text, pi_id text, sku_code text,' +
      '  shipped_qty int, unit_price numeric, discount numeric, net_unit_price numeric, ci_amount numeric,' +
      '  actual_customs_rate text, inbound_qty int, uninbound_qty int' +
      ')',
      [itemJson]
    );
    sqlCalls++;

    // ---- 2h. UPDATE PI items shipped_qty（仅新 CI，按 pi_id+sku_code 聚合）----
    await run(
      'UPDATE proforma_invoice_items pit SET ' +
      '  shipped_qty = pit.shipped_qty + src.qty,' +
      '  unshipped_qty = pit.pi_confirmed_qty - (pit.shipped_qty + src.qty) ' +
      'FROM (' +
      '  SELECT pi_id, sku_code, SUM(quantity) AS qty FROM ci_import_staging WHERE is_new_ci GROUP BY pi_id, sku_code' +
      ') src WHERE pit.pi_id = src.pi_id AND pit.sku_code = src.sku_code'
    );
    sqlCalls++;

    // ---- 2i. UPDATE PI headers shipped_amount/unshipped_amount（仅新 CI）----
    var piAgg = {};
    for (var ai = 0; ai < validated.length; ai++) {
      var ar = validated[ai];
      if (ar.is_new_ci) {
        if (!piAgg[ar.pi_id]) {
          piAgg[ar.pi_id] = { pi_id: ar.pi_id, total_amount: ar.pi_total_amount, amount: 0 };
        }
        piAgg[ar.pi_id].amount += ar.amount;
      }
    }
    var piAggList = Object.keys(piAgg).map(function (k) { return piAgg[k]; });
    if (piAggList.length) {
      var piAggJson = JSON.stringify(piAggList.map(function (r) {
        return { pi_id: r.pi_id, new_amount: r.amount, total_amount: r.total_amount };
      }));
      await run(
        'UPDATE proforma_invoices p SET ' +
        '  shipped_amount = p.shipped_amount + v.new_amount,' +
        '  unshipped_amount = v.total_amount - (p.shipped_amount + v.new_amount) ' +
        'FROM jsonb_to_recordset($1::jsonb) AS v(' +
        '  pi_id text, new_amount numeric, total_amount numeric' +
        ') WHERE p.id = v.pi_id',
        [piAggJson]
      );
      sqlCalls++;
    }

    // ---- 2j. UPDATE PI status ----
    if (piIds.length) {
      await run(
        'UPDATE proforma_invoices p SET pi_status = CASE ' +
        '  WHEN agg.n = 0 THEN \'pending\' ' +
        '  WHEN agg.allshipped THEN \'shipped_complete\' ' +
        '  WHEN agg.anyshipped THEN \'partial_shipped\' ' +
        '  ELSE \'pending\' END ' +
        'FROM (' +
        '  SELECT p2.id AS pi_id, COUNT(pit.id) AS n,' +
        '    bool_and(COALESCE(pit.shipped_qty >= pit.pi_confirmed_qty, false)) AS allshipped,' +
        '    bool_or(COALESCE(pit.shipped_qty > 0, false)) AS anyshipped ' +
        '  FROM proforma_invoices p2 ' +
        '  LEFT JOIN proforma_invoice_items pit ON pit.pi_id = p2.id ' +
        '  WHERE p2.id IN (' + ph(piIds.length) + ') ' +
        '  GROUP BY p2.id' +
        ') agg WHERE p.id = agg.pi_id AND p.pi_status <> \'cancelled\'',
        piIds
      );
      sqlCalls++;
    }

    // ---- 2k. UPDATE CI totals（goods_amount, deduct, payable_balance）----
    var ciFinalList = Object.keys(ciFinalValues).map(function (k) { return ciFinalValues[k]; });
    if (ciFinalList.length) {
      var ciUpdateJson = JSON.stringify(ciFinalList.map(function (r) {
        return { ci_id: r.ci_id, goods_amount: r.goods_amount, deduct: r.deduct, payable_balance: r.payable_balance, unpaid_balance: r.payable_balance };
      }));
      await run(
        'UPDATE commercial_invoices SET ' +
        '  goods_amount = v.goods_amount,' +
        '  amount_difference = 0,' +
        '  should_deduct_deposit = v.deduct,' +
        '  actual_deducted_deposit = v.deduct,' +
        '  payable_balance = v.payable_balance,' +
        '  unpaid_balance = v.unpaid_balance ' +
        'FROM jsonb_to_recordset($1::jsonb) AS v(' +
        '  ci_id text, goods_amount numeric, deduct numeric, payable_balance numeric, unpaid_balance numeric' +
        ') WHERE commercial_invoices.id = v.ci_id',
        [ciUpdateJson]
      );
      sqlCalls++;
    }

    // ---- 2l. PAY-CORE: payable_items balance upsert ----
    // 业务模型（与 legacy findActivePayableItem + createPayableItemFromSource 等价）：
    //   balance payable = per-(pi_id, ci_id)：每个 CI 发货产生各自独立的尾款 payable
    //   source_ci_id 是真实业务维度（CI reverse / payment / 台账 都按 source_ci_id 区分）
    // 权威 identity（已随 PAY-SCHEMA-CORRECTION-01 上线）：
    //   uq_payable_identity = (source_type, source_id, COALESCE(source_ci_id,''), fee_type)
    //   —— 无 partial predicate，全生命周期唯一（db-pg.js / db-sqlite.js / db.js 三处 source-of-truth 一致）
    // MUTABILITY（§4，已在本模块落地 P1-PAY-CURRENT-ITEM-SEMANTICS）：
    //   active          → 允许导入自动同步金额（authoritative UPDATE，本段执行）
    //   partially_paid / reserved / paid / cancelled / released → 终态/锁定态，导入不可修改，
    //     也不能插第二条（uq_payable_identity 全生命周期唯一，二次 INSERT 会撞唯一约束）。
    //   强制点在 **2b-2（mutation 之前）**：命中锁定态的 CI 整组在 staging/mutation 前就被剔除，
    //     因此本段（2l）在正常情况下只会见到 active —— 见不到被拒的 CI。
    //   本段保留 race guard：若 payable 在 validation→mutation 之间被并发推进到锁定态，则 throw
    //     触发整批 ROLLBACK（unexpected failure），绝不 half-commit。
    //   server.js legacy helpers（findActivePayableItem / syncPayableItemAmount）的同语义修复属 §17 独立轮，本轮不动。
    var payPairs = ciFinalList.filter(function (r) { return r.payable_balance > 0; });

    // 查找已存在的 balance payables：按 (pi_id, ci_id) pair 精确匹配（不限定 is_active，
    // 以便识别终态/锁定态行并 fail-closed 拒绝，避免二次 INSERT 撞 uq_payable_identity 致整批 ROLLBACK）
    var existingPayables = [];
    if (payPairs.length) {
      var payQueryJson = JSON.stringify(payPairs.map(function (r) {
        return { pi_id: r.pi_id, ci_id: r.ci_id };
      }));
      existingPayables = await aq(
        'SELECT pi.* FROM payable_items pi ' +
        'JOIN jsonb_to_recordset($1::jsonb) AS k(pi_id text, ci_id text) ' +
        'ON pi.source_id = k.pi_id AND pi.source_ci_id = k.ci_id ' +
        'WHERE pi.source_type = \'pi\' AND pi.fee_type = \'balance\'',
        [payQueryJson]
      );
      sqlCalls++;
    }

    // 按 (pi_id, ci_id) 建索引
    var existingByKey = {};
    for (var ep = 0; ep < existingPayables.length; ep++) {
      var epRow = existingPayables[ep];
      existingByKey[epRow.source_id + '\u0000' + epRow.source_ci_id] = epRow;
    }

    var toUpdate = [];
    var toInsert = [];
    for (var pp = 0; pp < payPairs.length; pp++) {
      var pair = payPairs[pp];
      var payableAmountMinor = Math.round(pair.payable_balance * 100);
      if (payableAmountMinor <= 0) continue;

      var pkey = pair.pi_id + '\u0000' + pair.ci_id;
      var payableDate = resolvePayableDate({
        dueDate: '', creditDays: pair.credit_days, baseDate: pair.actual_ship_date
      });

      if (existingByKey[pkey]) {
        var exRow = existingByKey[pkey];
        if (exRow.lifecycle_status !== 'active') {
          // 防御性 race guard（MUTABILITY §4）：
          //   2b-2 已在任何 mutation 之前按 CI identity 拒绝锁定态 payable，正常路径到不了这里。
          //   若仍命中，说明 validation 与 mutation 之间该 payable 被并发事务推进到锁定态
          //   （payable_items 未加锁，READ COMMITTED 下后发起的查询可见新提交）。
          //   此时三个选择都不安全：UPDATE 会改终态、INSERT 会撞 uq_payable_identity、
          //   静默跳过会造成 half-commit。
          //   → 按 partial-success 模型的 unexpected failure 处理：throw → 整个 mutation ROLLBACK。
          throw new Error('PAY-MUTABILITY-RACE: 应付在导入过程中被并发修改为' +
            exRow.lifecycle_status + '状态，本批已整体回滚：' + pair.ci_no);
        }
        // active → authoritative update 金额（与 legacy UPDATE 语义一致）
        toUpdate.push({
          id: exRow.id,
          amount_minor: payableAmountMinor,
          payable_date: payableDate
        });
      } else {
        // 无 active balance payable → 新建（per-CI）
        var payeeKey = 'supplier:' + (pair.pi_supplier_id || pair.pi_supplier_name || pair.po_supplier_name || '');
        var payeeName = pair.pi_supplier_name || pair.po_supplier_name || '';
        // fee_no 唯一性（原有缺陷修复，独立于 P1 MUTABILITY）：
        //   原实现随机段仅 3 位（36^3 ≈ 4.6万），单批创建上百条 payable 时按生日问题
        //   碰撞概率约 14% → 撞 payable_items_fee_no_key → 整批 500（大批量导入真实风险）。
        //   改为复用本行 id 的随机后缀（genId = 毫秒时间戳 + 6 位随机，批内碰撞概率 ~3e-6），
        //   保证批内唯一，且 fee_no 格式不变。
        var payItemId = genId('payitem');
        toInsert.push({
          id: payItemId,
          fee_no: 'PAY-ITEM-' + new Date().getFullYear() + '-' +
            String(Date.now()).slice(-6) + '-' + payItemId.slice(-6),
          source_id: pair.pi_id,
          source_no: pair.pi_no,
          source_ci_id: pair.ci_id,
          payee_key: payeeKey,
          payee_name: payeeName,
          currency: pair.currency,
          amount_minor: payableAmountMinor,
          payable_date: payableDate,
          created_by: userCtx.userId
        });
      }
    }

    // UPDATE existing — 金额 + payable_date（source_ci_id 不变，保持与 legacy UPDATE 语义一致）
    if (toUpdate.length) {
      var updateJson = JSON.stringify(toUpdate.map(function (r) {
        return { id: r.id, amount_minor: r.amount_minor, payable_date: r.payable_date };
      }));
      await run(
        'UPDATE payable_items SET payable_amount_minor = v.amount_minor, payable_date = v.payable_date ' +
        'FROM jsonb_to_recordset($1::jsonb) AS v(id text, amount_minor int, payable_date text) ' +
        'WHERE payable_items.id = v.id AND payable_items.is_active = 1',
        [updateJson]
      );
      sqlCalls++;
    }

    // INSERT new
    if (toInsert.length) {
      var insertJson = JSON.stringify(toInsert.map(function (r) {
        return {
          id: r.id, fee_no: r.fee_no, source_id: r.source_id, source_no: r.source_no, source_ci_id: r.source_ci_id,
          payee_key: r.payee_key, payee_name: r.payee_name, currency: r.currency, amount_minor: r.amount_minor,
          payable_date: r.payable_date, created_by: r.created_by
        };
      }));
      await run(
        'INSERT INTO payable_items (' +
        '  id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type,' +
        '  category_code, subcategory_code, payee_type, payee_key, payee_name_snapshot,' +
        '  payer_entity_key, payer_name_snapshot, currency, payable_amount_minor,' +
        '  is_active, lifecycle_status, payable_date, created_by' +
        ') SELECT ' +
        '  j.id, j.fee_no, \'pi\', j.source_id, j.source_no, j.source_ci_id, \'balance\',' +
        '  \'goods\', \'balance\', \'factory\', j.payee_key, j.payee_name,' +
        '  \'self\', \'\', j.currency, j.amount_minor,' +
        '  1, \'active\', j.payable_date, j.created_by ' +
        'FROM jsonb_to_recordset($1::jsonb) AS j(' +
        '  id text, fee_no text, source_id text, source_no text, source_ci_id text,' +
        '  payee_key text, payee_name text, currency text, amount_minor int,' +
        '  payable_date text, created_by text' +
        ')',
        [insertJson]
      );
      sqlCalls++;
    }

    var tEnd = DEBUG_PERF ? Date.now() : 0;
    if (DEBUG_PERF) {
      console.log('[CI IMPORT PERF]', JSON.stringify({
        rows_total: rows.length,
        rows_valid: validated.length,
        rows_invalid: invalidRows.length + validationErrors.length,
        validation_ms: tStaging - tValidation,
        lock_ms: tMutation - tLock,
        staging_ms: tLock - tStaging,
        mutation_ms: tEnd - tMutation,
        transaction_total_ms: tEnd - tValidation,
        total_ms: tEnd - t0,
        fixed_sql_calls: sqlCalls
      }));
    }

    return {
      success: validated.length,
      failed: invalidRows.length + validationErrors.length,
      total: rows.length,
      errors: invalidRows.concat(validationErrors)
    };
  });

  // ---- Layer 3: after-COMMIT（由调用方处理 updateInventoryTransitDataAsync）----
  var result = {
    success: txResult.success,
    failed: txResult.failed,
    total: txResult.total,
    errors: txResult.errors
  };
  return result;
}

module.exports = { importCommercialInvoicesPg };
