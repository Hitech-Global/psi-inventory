#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"
ENV_FILE="$SCRIPT_DIR/runtime/.env"
[ -f "$ENV_FILE" ] || { echo "Missing runtime/.env" >&2; exit 1; }

set -a
. "$ENV_FILE"
set +a

: "${POSTGRES_USER:?POSTGRES_USER missing}"
: "${SHOPEE_BACKUP_LOCAL_DIR:?SHOPEE_BACKUP_LOCAL_DIR missing}"

LATEST="$(find "$SHOPEE_BACKUP_LOCAL_DIR" -maxdepth 1 -type f -name 'shopee-analytics-*.dump' -print | sort | tail -n 1)"
[ -n "$LATEST" ] || { echo "No local backup found" >&2; exit 1; }

CONTAINER_ID="$(docker compose --env-file "$ENV_FILE" ps -q postgres)"
[ -n "$CONTAINER_ID" ] || { echo "postgres container not found" >&2; exit 1; }

BASE="$(basename "$LATEST")"
CONTAINER_FILE="/tmp/verify-$BASE"
TEMP_DB="shopee_restore_verify_$(date +%Y%m%d%H%M%S)"
STATUS_FILE="$SCRIPT_DIR/runtime/backup-status.json"

docker cp "$LATEST" "$CONTAINER_ID:$CONTAINER_FILE"
cleanup() {
  docker compose --env-file "$ENV_FILE" exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$TEMP_DB" >/dev/null 2>&1 || true
  docker compose --env-file "$ENV_FILE" exec -T postgres rm -f "$CONTAINER_FILE" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose --env-file "$ENV_FILE" exec -T postgres createdb -U "$POSTGRES_USER" "$TEMP_DB"
docker compose --env-file "$ENV_FILE" exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$TEMP_DB" --no-owner --no-privileges "$CONTAINER_FILE"

TABLES="$(docker compose --env-file "$ENV_FILE" exec -T postgres psql -U "$POSTGRES_USER" -d "$TEMP_DB" -Atc "select count(*) from information_schema.tables where table_schema='public' and table_name like 'shopee_%';" | tr -d '\r\n ')"
[ "$TABLES" -ge 20 ] || { echo "Restore verification found only $TABLES Shopee tables" >&2; exit 1; }

VERIFIED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node - "$STATUS_FILE" "$VERIFIED" "$BASE" "$TABLES" <<'NODE'
const fs = require("fs");
const [file, verifiedAt, fileName, tableCount] = process.argv.slice(2);
let status = {};
try { status = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
status.restoreVerifiedAt = verifiedAt;
status.restoreVerifiedFileName = fileName;
status.restoreVerifiedTableCount = Number(tableCount);
fs.writeFileSync(file, JSON.stringify(status, null, 2));
NODE

echo "Restore verification OK: $BASE, tables=$TABLES"
