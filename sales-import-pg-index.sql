-- Phase 1 / Checkpoint 2 preparation only.
-- Do not run against production in this checkpoint.  The existing PG schema
-- has the business-key unique index but no partial source/detail lookup index.
-- Apply in an isolated PG database first and compare EXPLAIN (ANALYZE, BUFFERS)
-- for the staging candidate query before scheduling production migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_records_source_detail_nonempty
  ON sales_records (source_system, order_detail_id)
  WHERE order_detail_id <> '';

