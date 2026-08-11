-- ============================================================================
-- 生产环境：历史 CI 尾款回补（PostgreSQL 版）
-- ============================================================================
-- 业务规则（与 createHistoricalCI 修正后逻辑一致）：
--   historical_ci balance payable_item 新金额
--     = CI货值(gross_goods_amount)
--     - 关联PI当前可抵扣定金余额(available_deduct_deposit)
--
-- 红线（不修改）：
--   payment_requests / payment_request_items / payment_allocations
--   payment_settlement_logs / PI 的定金数据(available_deduct_deposit 只读)
--
-- 关联 PI 来源：
--   1) historical_commercial_invoice_items.pi_no
--   2) 解析 historical_ci_no 字符串（按 & + , / ， 、 空格 拆分）
--
-- 用法：
--   Step 1: 跑下方 "DRY-RUN 查询"（只读，确认 A/B/C 分类与金额）
--   Step 2: 仅对 A 类执行底部 "A 类 UPDATE"（确认无误后删除注释运行）
-- ============================================================================


-- ---------------------------------------------------------------------------
-- DRY-RUN 查询（只读，不写库）
-- ---------------------------------------------------------------------------
WITH hci_balance AS (
  SELECT pi.id            AS payable_item_id,
         pi.source_id     AS hci_id,
         pi.source_no     AS ci_no,
         pi.payable_amount_minor AS old_minor,
         h.gross_goods_amount
  FROM payable_items pi
  JOIN historical_commercial_invoices h ON h.id = pi.source_id
  WHERE pi.source_type = 'historical_ci' AND pi.fee_type = 'balance'
),
linked_pi AS (
  -- 来源1：明细表
  SELECT hb.payable_item_id, pi.pi_no, pi.available_deduct_deposit
  FROM hci_balance hb
  LEFT JOIN historical_commercial_invoice_items hi ON hi.hci_id = hb.hci_id
  LEFT JOIN proforma_invoices pi ON pi.pi_no = hi.pi_no
  WHERE hi.pi_no IS NOT NULL
  UNION
  -- 来源2：解析 historical_ci_no 字符串
  SELECT hb.payable_item_id, pi.pi_no, pi.available_deduct_deposit
  FROM hci_balance hb
  LEFT JOIN proforma_invoices pi
    ON pi.pi_no = ANY (regexp_split_to_array(hb.ci_no, '[&+,/，、[:space:]]+'))
),
deduct AS (
  SELECT payable_item_id,
         COALESCE(SUM(ROUND(available_deduct_deposit * 100)), 0) AS deduct_minor
  FROM linked_pi
  WHERE pi_no IS NOT NULL
  GROUP BY payable_item_id
),
guard AS (
  SELECT pi.id AS payable_item_id,
    (SELECT COUNT(*) FROM payment_request_items pri
       JOIN payment_requests pr ON pr.id = pri.payment_request_id
       WHERE pri.payable_item_id = pi.id
         AND pr.payment_status NOT IN ('cancelled','rejected')
         AND pr.approval_status NOT IN ('cancelled','rejected')) AS pr_cnt,
    (SELECT COUNT(*) FROM payment_allocations pa
       JOIN payment_request_items pri ON pri.id = pa.payment_request_item_id
       WHERE pri.payable_item_id = pi.id) AS alloc_cnt,
    (SELECT COUNT(*) FROM payment_settlement_logs l
       JOIN payment_request_items pri ON pri.payment_request_id = l.payment_request_id
       WHERE pri.payable_item_id = pi.id) AS settle_cnt,
    (SELECT COUNT(*) FROM payment_request_items pri
       JOIN payment_requests pr ON pr.id = pri.payment_request_id
       WHERE pri.payable_item_id = pi.id AND pr.payment_status = 'paid') AS paid_cnt
  FROM payable_items pi
  WHERE pi.source_type = 'historical_ci' AND pi.fee_type = 'balance'
)
SELECT hb.ci_no,
       CASE
         WHEN g.alloc_cnt > 0 OR g.settle_cnt > 0 OR g.paid_cnt > 0 THEN 'C'
         WHEN g.pr_cnt > 0 THEN 'B'
         ELSE 'A'
       END AS category,
       ROUND(hb.gross_goods_amount * 100)               AS gross_minor,
       COALESCE(d.deduct_minor, 0)                      AS deduct_minor,
       hb.old_minor,
       GREATEST(0, ROUND(hb.gross_goods_amount * 100)
                  - COALESCE(d.deduct_minor, 0))        AS new_minor,
       g.pr_cnt, g.alloc_cnt, g.settle_cnt, g.paid_cnt
FROM hci_balance hb
LEFT JOIN deduct d ON d.payable_item_id = hb.payable_item_id
LEFT JOIN guard g ON g.payable_item_id = hb.payable_item_id
ORDER BY hb.ci_no;


-- ---------------------------------------------------------------------------
-- A 类 UPDATE（仅 A 类：无有效付款申请 / 无 payment_allocations / 无结算日志）
-- 确认上方 DRY-RUN 结果无误后，删除下面 -- 注释运行。
-- ---------------------------------------------------------------------------
/*
WITH hci_balance AS (
  SELECT pi.id AS payable_item_id, pi.source_id AS hci_id, h.gross_goods_amount
  FROM payable_items pi
  JOIN historical_commercial_invoices h ON h.id = pi.source_id
  WHERE pi.source_type = 'historical_ci' AND pi.fee_type = 'balance'
),
linked_pi AS (
  SELECT hb.payable_item_id, pi.available_deduct_deposit
  FROM hci_balance hb
  LEFT JOIN historical_commercial_invoice_items hi ON hi.hci_id = hb.hci_id
  LEFT JOIN proforma_invoices pi ON pi.pi_no = hi.pi_no
  WHERE hi.pi_no IS NOT NULL
  UNION
  SELECT hb.payable_item_id, pi.available_deduct_deposit
  FROM hci_balance hb
  LEFT JOIN proforma_invoices pi
    ON pi.pi_no = ANY (regexp_split_to_array(hb.ci_no, '[&+,/，、[:space:]]+'))
),
deduct AS (
  SELECT payable_item_id,
         COALESCE(SUM(ROUND(available_deduct_deposit * 100)), 0) AS deduct_minor
  FROM linked_pi WHERE pi_no IS NOT NULL GROUP BY payable_item_id
),
guard AS (
  SELECT pi.id AS payable_item_id,
    (SELECT COUNT(*) FROM payment_request_items pri JOIN payment_requests pr ON pr.id=pri.payment_request_id WHERE pri.payable_item_id=pi.id AND pr.payment_status NOT IN ('cancelled','rejected') AND pr.approval_status NOT IN ('cancelled','rejected')) AS pr_cnt,
    (SELECT COUNT(*) FROM payment_allocations pa JOIN payment_request_items pri ON pri.id=pa.payment_request_item_id WHERE pri.payable_item_id=pi.id) AS alloc_cnt,
    (SELECT COUNT(*) FROM payment_settlement_logs l JOIN payment_request_items pri ON pri.payment_request_id=l.payment_request_id WHERE pri.payable_item_id=pi.id) AS settle_cnt,
    (SELECT COUNT(*) FROM payment_request_items pri JOIN payment_requests pr ON pr.id=pri.payment_request_id WHERE pri.payable_item_id=pi.id AND pr.payment_status='paid') AS paid_cnt
  FROM payable_items pi WHERE pi.source_type='historical_ci' AND pi.fee_type='balance'
)
UPDATE payable_items pi
SET payable_amount_minor = GREATEST(0,
      ROUND(h.gross_goods_amount * 100) - COALESCE(d.deduct_minor, 0))
FROM hci_balance hb
JOIN historical_commercial_invoices h ON h.id = hb.source_id
LEFT JOIN deduct d ON d.payable_item_id = hb.payable_item_id
LEFT JOIN guard g ON g.payable_item_id = hb.payable_item_id
WHERE pi.id = hb.payable_item_id
  AND g.alloc_cnt = 0 AND g.settle_cnt = 0 AND g.paid_cnt = 0 AND g.pr_cnt = 0;
*/
