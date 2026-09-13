# BULK-1 v2 candidate validation — 2026-09-13

Issue: https://github.com/Hitech-Global/psi-inventory/issues/1

Base: `4d321aace20505c567066076726e56d3a52a9356`.
Branch: `candidate/bulk-import-stability-v2-20260913`.

The scoped PostgreSQL query now selects max calendar import day, filters that
day, then selects max stored TEXT `created_at`. Null-safe equality preserves
every exact-event tie. This intentionally changes differing-event same-day
results; fixtures sharing one event still match the frozen legacy query.
The defensive trimmed 10-character date cast, key scope, tombstones and both
downstream duplicate fallback paths are retained. No transit or WAC logic changed.

## Tests

170 distinct tests passed, zero failures/skips in the final runs: 166 across
the import/P0-C1/P0-C2/WAC/date/UI/guardrail/index-safety suites, followed by
the final PG suite with one additional event-oracle test and three PG index
tests (16 passed including 12 previously run tests).

- 200 legacy multiset differential fixtures with a common event timestamp.
- 100 additional randomized event fixtures checked against an independent JS oracle.
- Latest-day precedence over creation time, date prefixes, null and empty creation
  times, tombstones, duplicate input keys, conflicting exact-event ties.
- Real PG: 577 keys × 14 same-day events return 577 latest rows.
- P0-C2 production-helper harness: 2 and 577 keys require the same number of DB
  calls (at most four), with zero per-row `queryOne` calls; exact-event conflict
  actually takes the row fallback. This harness measures scoped refresh calls,
  not the asynchronous transit subsystem.
- Local PG index migration: missing table rejection, idempotent small-table
  creation, and >250k-row stale-statistics guard.

Runtime: Node 24.19.0, SQLite fallback `node:sqlite`, local PostgreSQL 16.15 on
Apple ARM64. Tests used `--test-force-exit` because the existing DB worker stays
referenced after tests. Node 22 (package engine) was not separately exercised.

## Index benchmark

`scripts/benchmark-bulk1-v2.cjs` reproduces the comparison using local-only
session TEMP tables and the actual SQL factory from `server.js`. Set
`BULK1_PG_DSN` to an isolated local PostgreSQL instance and run the script.

M=500,000; K=5,000; 100 historical events/key; five days with 20 events/day;
`work_mem=4MB`; ANALYZE after data load/index creation. Alternating index order
4/5/5/4, each with a correctness warmup and three EXPLAIN ANALYZE samples.
Every sample returned exactly 5,000 rows, each with the newest event quantity.

| Index columns | Six execution samples (ms) | Median (ms) | Index bytes |
| --- | --- | ---: | ---: |
| sku_code,country,warehouse,import_date | 1288.740, 1339.143, 1325.730, 1264.015, 1259.963, 1270.856 | 1279.798 | 4,825,088 |
| sku_code,country,warehouse,import_date,created_at | 1358.611, 1323.249, 1310.111, 1255.263, 1258.571, 1270.548 | 1290.330 | 42,352,640 |

Both plans chose a sequential scan/hash join for all affected keys, followed by
an external merge sort (45,528 KiB disk) and two window stages. Both reported
11,374 temporary blocks read and 11,390 written. The expanded index was about
8.78× larger and did not improve median latency. Keep the existing four-column
candidate index and migration unchanged. This is a local synthetic full-key
benchmark, not a production latency measurement or a small-key index study.

Raw benchmark plans/output remain local in `/tmp`, excluded from the candidate.
No production database access, deployment, main change or PR was performed.
