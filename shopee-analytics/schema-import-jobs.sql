-- Dedicated Ad Group import queue. Heavy CSV/XLSX parsing runs in a separate
-- worker process; the web app only stages uploads and waits on lightweight job
-- state. File bytes are never stored in PostgreSQL.

CREATE TABLE IF NOT EXISTS shopee_ad_group_import_jobs (
  id UUID PRIMARY KEY,
  batch_id UUID,
  operation TEXT NOT NULL CHECK (operation IN ('PREVIEW','IMPORT')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','BLOCKED')),
  fingerprint TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  sha256 TEXT NOT NULL,
  target_shop_id BIGINT,
  source_shop_id BIGINT,
  period_start DATE,
  period_end DATE,
  granularity TEXT CHECK (granularity IN ('DAY','RANGE')),
  request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB,
  error_code TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopee_ad_group_import_jobs_queue
  ON shopee_ad_group_import_jobs(status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_shopee_ad_group_import_jobs_batch
  ON shopee_ad_group_import_jobs(batch_id, created_at, id)
  WHERE batch_id IS NOT NULL;

-- A duplicate browser submit must not create parallel heavy work.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shopee_ad_group_import_jobs_active_fingerprint
  ON shopee_ad_group_import_jobs(fingerprint)
  WHERE status IN ('QUEUED','RUNNING');

-- Hard global gate: even if more than one import-worker process is started,
-- PostgreSQL permits only one heavy job to be RUNNING at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shopee_ad_group_import_jobs_one_running
  ON shopee_ad_group_import_jobs ((1))
  WHERE status='RUNNING';
