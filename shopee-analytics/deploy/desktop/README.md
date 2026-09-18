# Shopee Analytics desktop deployment

This is the production target for the always-on desktop + NAS architecture.

## Topology

- Desktop NVMe/SSD: Docker + PostgreSQL primary database.
- `app`: read-only analytics UI/API, bound to localhost port 3090.
- `worker`: scheduled Shopee API sync.
- NAS: backup destination only. PostgreSQL data files never run directly from the NAS.
- PSI stays on its existing infrastructure and is not modified by this stack.

## Files that stay outside Git

Create `runtime/.env` from `runtime.env.example`. The whole `runtime/` directory is gitignored.

Never commit Partner Keys, access/refresh tokens, token master key, PostgreSQL password, token bootstrap JSON, NAS credentials, or database dumps.

## First deployment sequence

From this directory:

1. Copy `runtime.env.example` to `runtime/.env`.
2. Fill the PostgreSQL password, token master key and Shopee Partner credentials.
3. Start PostgreSQL only: `docker compose --env-file runtime/.env up -d postgres`.
4. Apply schema explicitly: `docker compose --env-file runtime/.env --profile tools run --rm schema`.
5. Configure shop profiles and per-shop strategy with the gated scripts.
6. Bootstrap encrypted shop token bundles.
7. Start app + worker: `docker compose --env-file runtime/.env up -d app worker`.
8. Open `http://127.0.0.1:3090` on the desktop.
9. Run one real-shop sync and reconcile against Seller Centre.
10. Only after the pilot store passes reconciliation, run historical backfill.

The host port is intentionally bound to `127.0.0.1`. Later remote access should use a private layer such as Tailscale rather than exposing PostgreSQL or the web app directly to the public internet.

## Scheduled sync

Default worker schedule:

- hourly sync at minute 10 of each UTC hour
- daily sync at 02:30 UTC

02:30 UTC is 09:30 in Jakarta/Bangkok and 10:30 in Kuala Lumpur/Singapore. The values are configurable in `runtime/.env`.

## NAS backup

The host backup job creates a PostgreSQL custom-format `pg_dump`, validates the archive with `pg_restore --list`, copies it to the NAS, and updates `runtime/backup-status.json` for the Data Health page.

Default retention:

- desktop local backups: 30 days
- NAS daily copies: 30 days
- NAS Sunday weekly copies: 90 days
- NAS day-1 monthly copies: 730 days

Windows command:

`powershell -ExecutionPolicy Bypass -File .\backup-postgres.ps1`

Linux/macOS command:

`sh ./backup-postgres.sh`

Use Windows Task Scheduler or cron to run it at a fixed quiet-hour time, for example 03:00 local server time.

For a Windows NAS path, prefer a UNC path such as `\\NAS\Backups\ShopeeAnalytics` and store NAS authentication in Windows Credential Manager. Do not put NAS passwords in `runtime/.env`.

## Restore verification

A backup is not considered proven until it can be restored.

Windows:

`powershell -ExecutionPolicy Bypass -File .\verify-restore.ps1`

Linux/macOS:

`sh ./verify-restore.sh`

The verifier restores the newest local dump into a temporary PostgreSQL database, checks the Shopee table count, removes the temporary database, and records `restoreVerifiedAt` in the backup status file.

Recommended cadence: monthly, immediately after the monthly backup.

## Failure policy

- A failed backup must not delete older successful backups.
- A failed Shopee sync must not stop PostgreSQL or the UI.
- PostgreSQL has no host/public port in this compose file.
- NAS connectivity failure must not stop the primary database.
- Backup and restore status is visible in the application's Data Health view.


## Product Card drop folder

Until a complete item-level Business Insights API is verified, Product Card remains an export/import bridge.

The desktop worker can process a local drop folder automatically. Enable:

`SHOPEE_PRODUCT_CARD_INBOX_ENABLE=YES`

Use this filename convention so the worker can identify the shop and exact report period:

`shop-<shopId>__Product_Card.YYYYMMDD_YYYYMMDD.xlsx`

Example:

`shop-1101364305__Product_Card.20260901_20260907.xlsx`

Files are imported transactionally into PostgreSQL, then moved from `runtime/product-card/inbox` to `archive`. Invalid or failed files are moved to `failed` with an adjacent error text file. The worker never guesses the shop from product data.
