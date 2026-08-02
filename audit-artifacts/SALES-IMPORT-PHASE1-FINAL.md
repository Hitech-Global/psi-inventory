# SALES-IMPORT-PHASE1-FINAL

## Scope and release discipline

Phase 1 Checkpoint 2 and Checkpoint 3 were completed in disposable SQLite and PostgreSQL 18.4 environments. The existing synchronous POST contract and final JSON result shape remain unchanged. Inventory recalculation remains synchronous and was measured only; no background worker or Render configuration was added.

No commit, push, deploy, production migration, tag, package change, or production database operation was performed.

The working tree contains unrelated pre-existing WIP (including `i18n.js`, PI/PAY-CORE work, and other audit files). This phase changed only the sales-import sections of `server.js`/`app.js`, the database adapters, the shared service, and the listed sales-import artifacts.

## Checkpoint 1 carry-forward

- The old formal row-by-row apply path remains the business baseline.
- 9/9 deterministic fixtures remain equivalent.
- `order_detail_id` identity is preferred; the business key is the fallback.
- `input_order` determines file-internal duplicate semantics; the last valid change wins, exact duplicates are skipped, and errors do not suppress later valid rows.
- `preview` and `apply` use the same normalize/validate/identity/classify/match service. Preview does not write `sales_records`.

## Checkpoint 2 — database equivalence and performance

- SQLite has a transactional batch path with shared classification and batched candidate loading/writes.
- PostgreSQL uses temporary staging, JSONB batch loading, set-based matching, and set-based update/insert in one transaction. No per-row `queryOne`/`run` loop remains in the new path.
- Live isolated PostgreSQL 18.4: fixture results equal the baseline; forced failure rollback left no sales rows; `queryOne=0`.
- 1,000-row live PG run: 750 inserted, 250 updated, 0 skipped, 0 failed; 34.17 ms total; 7 round trips (1 query, 6 run, 0 queryOne).
- SQLite 1,000-row run: 750 inserted, 250 updated, 0 failed; 191.99 ms; queryOne=0.
- EXPLAIN ANALYZE: point lookup used `idx_sales_records_source_detail_nonempty` with an Index Scan (1 actual row, ~0.023 ms). The staging `EXISTS` plan was a Hash Join (~1.003 ms). The prepared partial-index migration is not applied to production and adds no unique constraint.
- Shared preview/apply result fields and row numbers match the baseline on the required fixtures.

## Checkpoint 3 — progress, idempotency, and scale

- `sales_import_runs` control table is present in SQLite and PG adapters; the route also lazily ensures it for already-migrated PG databases.
- Phases persisted and observed: `validating`, `staging`, `matching`, `writing`, `committing`, `inventory_recalc`, `completed`.
- Terminal outcomes are represented and verified: `failed_uncommitted`, `unknown_pending_reconcile`, and `sales_committed_recalc_failed`.
- `import_id` plus request fingerprint prevents duplicate writes; a same-payload retry returns the stored result, an active retry returns current progress, and a different payload receives a conflict.
- The status endpoint is `GET /api/sales-records/bulk-import/:importId/status`.
- The sales import modal stores the active id in session storage, polls the status endpoint, renders phase/percent/processed counts, and stops polling on terminal states. A POST connection error does not trigger a second submit.
- Browser-level isolated SQLite verification rendered the progress UI and final report (`completed`, `100%`, `processed 1 / 1`) with page-console errors 0 and `null.innerHTML` 0.

### 30,000-row PG direct runs

| run | elapsed | validation | staging | matching | writing | committing | inventory recalc | round trips | queryOne | duplicates |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 662 ms | 24.87 ms | 150.99 ms | 69.16 ms | 367.57 ms | 14.52 ms | 8 ms | 65 | 0 | 0 |
| 2 | 603 ms | 19.25 ms | 157.95 ms | 61.85 ms | 307.44 ms | 19.45 ms | 7 ms | 65 | 0 | 0 |
| 3 | 652 ms | 13.86 ms | 166.32 ms | 48.59 ms | 369.95 ms | 13.42 ms | 8 ms | 65 | 0 | 0 |

### 30,000-row HTTP-backed PG runs

All three returned HTTP 200 with `completed`, 30,000 inserted, 0 failed, and no duplicate records or 502/reset. Elapsed times were 1,059 ms, 1,060 ms, and 867 ms. Inventory recalculation measured 61 ms, 43 ms, and 38 ms respectively. Each run used 65 DB round trips and 0 `queryOne`; ordinary `/api/sales-records?limit=1` probes remained responsive (25–30 probes per run, maximum latency 68/55/54 ms).

## Exact phase files

- `server.js`: sales import service wiring, preview/apply routes, persisted status route, `import_id` fingerprint/idempotency, progress persistence, outcome classification, and synchronous inventory-recalc timing. Other server WIP remains untouched.
- `app.js`: sales import modal progress area, status polling, refresh recovery, terminal-state rendering, and idempotent submit. Other page WIP remains untouched.
- `sales-import-service.js`: shared rule/classification service, SQLite/PG batch execution, progress callbacks, and run-store helpers.
- `db-pg.js`, `db-sqlite.js`: `sales_import_runs` table and indexes.
- `sales-import-runs.sql`: PG control-table migration/DDL.
- `sales-import-pg-index.sql`: prepared non-unique partial index migration; not applied to production.
- `scripts/verify-sales-import-rules.js`: Checkpoint 1 rule-equivalence fixtures.
- `scripts/verify-sales-import-bulk.js`: Checkpoint 2 SQLite/fake-PG equivalence and 1,000-row checks.
- `scripts/verify-sales-import-pg.js`: live PG 18.4, rollback, EXPLAIN, and 1,000-row checks.
- `scripts/verify-sales-import-checkpoint3.js`: persisted phases, terminal outcomes, 30k direct/HTTP runs, and ordinary API probes.
- `audit-artifacts/sales-import-checkpoint2.json`, `audit-artifacts/sales-import-checkpoint3.json`: machine-readable evidence.

## Remaining risks / Test Coverage Gaps

- The partial index migration has not been applied to production; no production schema was changed.
- SQLite 30,000-row scale was not required for the production-path gate; SQLite small/1,000-row equivalence and HTTP idempotency passed.
- The browser test used a one-row fixture; 30,000-row progress behavior was exercised through the real HTTP status path and persisted phase data, not through a browser upload of a 30,000-row file.
- `unknown_pending_reconcile` is only used for connection-like uncertainty; no automatic retry scheduler or worker was introduced.
- Inventory recalculation remains synchronous by design for this phase. Its measured share was small in the isolated 30,000-row runs, so no detach decision was made.

## Final gates

- Checkpoint 1: PASS (9/9).
- Checkpoint 2: PASS (SQLite/PG/baseline equivalence, rollback, 1,000-row performance, EXPLAIN).
- Checkpoint 3: PASS (import id, status recovery, idempotency, real progress, 30k x3, ordinary API responsiveness).
- Browser UI progress/result gate: PASS; page console errors 0.
- `node --check`: PASS for `app.js`, `server.js`, `sales-import-service.js`, `db-pg.js`, and `db-sqlite.js`.
- JSON parse: PASS for both checkpoint artifacts.
- `git diff --check`: PASS.

This work is intentionally stopped before commit, push, deploy, tag creation, or production migration.
