-- F1 sales import control metadata.  No sales business rows or rules change.
CREATE TABLE IF NOT EXISTS sales_import_runs (
  import_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT '',
  percent INTEGER,
  processed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  timings_json TEXT NOT NULL DEFAULT '{}',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  commit_state TEXT NOT NULL DEFAULT 'uncommitted',
  recalc_status TEXT NOT NULL DEFAULT 'pending',
  request_fingerprint TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_import_runs_status ON sales_import_runs(status);
CREATE INDEX IF NOT EXISTS idx_sales_import_runs_updated ON sales_import_runs(updated_at);
