
## Windows first-install shortcut

For the always-on Windows desktop, the normal path is now:

1. Install Git, Node.js LTS and Docker Desktop once.
2. Clone the repository and open PowerShell in `shopee-analytics/deploy/desktop`.
3. Run `.\\prepare-desktop.ps1`. It creates the gitignored runtime folders and generates the database/token-encryption secrets locally.
4. Fill the Shopee Partner credentials and the NAS backup path in `runtime/.env`, then rerun `.\\prepare-desktop.ps1` until the env check passes.
5. Configure the pilot shop profile and encrypted tokens.
6. Run `.\\install-desktop.ps1`. It starts PostgreSQL, applies the schema, runs preflight, and only starts app/worker after the gate passes.
7. Run `.\\install-backup-tasks.ps1` once from an elevated PowerShell. It schedules daily 03:30 backup and Sunday 04:30 restore verification, both with missed-run recovery.

Do not paste Partner Keys, access tokens, refresh tokens, database passwords, or the token master key into chat. They stay in `runtime/.env` or the encrypted token store on the desktop.

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

1. Prepare the gitignored runtime directory: `SHOPEE_ANALYTICS_PREPARE_DESKTOP_RUNTIME=YES node ../../scripts/prepare-desktop-runtime.cjs`. This generates the local PostgreSQL password and token master key without printing their values.
2. Edit `runtime/.env`: fill only the Shopee Partner credentials and the desktop/NAS backup paths. Keep the generated PostgreSQL password and token master key.
3. Run the offline env check before starting containers: `node ../../scripts/validate-desktop-env.cjs runtime/.env`.
4. Start PostgreSQL only: `docker compose --env-file runtime/.env up -d postgres`.
5. Apply schema explicitly: `docker compose --env-file runtime/.env --profile tools run --rm schema`.
6. Configure shop profiles and per-shop strategy with the gated scripts.
7. Bootstrap encrypted shop token bundles.
8. Run the full deployment preflight: `docker compose --env-file runtime/.env --profile tools run --rm preflight`.
9. Start app + worker: `docker compose --env-file runtime/.env up -d app worker`.
10. Open `http://127.0.0.1:3090` on the desktop.
11. Run one real-shop sync and reconcile against Seller Centre.
12. Only after the pilot store passes reconciliation, run historical backfill.

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


## First live-shop pilot gate

Use exactly one shop for the first real-data acceptance. Do not start historical backfill yet.

1. Run a daily sync filtered to the pilot shop.
2. Use a fixed 7-day period that has finished in the shop timezone.
3. Run `validation-report.cjs` and confirm there are no blocking token/source errors.
4. In Seller Centre, record the same fixed-period Shop BI Sales/Orders and Ads Broad/Direct metrics into a local copy of `config/seller-centre-reconciliation.example.json`.
5. Run `reconcile-seller-centre.cjs`. The default tolerance is 1% per supplied metric; any failure blocks backfill and must be explained by timezone, attribution, pagination, or source completeness before proceeding.
6. Import the Product Card export for exactly the same period, then rerun the validation report to validate item-level CVR/funnel coverage.
7. Only after fixed-period reconciliation passes should historical backfill be enabled.

Example:

```bash
SHOPEE_RECONCILE_SHOP_ID=<shopId> \
SHOPEE_RECONCILE_START_DATE=2026-09-01 \
SHOPEE_RECONCILE_END_DATE=2026-09-07 \
SHOPEE_RECONCILE_EXPECTED_FILE=/secure/local/seller-centre-expected.json \
node shopee-analytics/scripts/reconcile-seller-centre.cjs
```

The expected-values file is local acceptance evidence. Do not commit real shop exports, credentials, or token files.
