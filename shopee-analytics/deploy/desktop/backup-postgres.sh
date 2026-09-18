#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/runtime/.env"
[ -f "$ENV_FILE" ] || { echo "Missing runtime/.env" >&2; exit 1; }

set -a
. "$ENV_FILE"
set +a

: "${POSTGRES_DB:?POSTGRES_DB missing}"
: "${POSTGRES_USER:?POSTGRES_USER missing}"
: "${SHOPEE_BACKUP_LOCAL_DIR:?SHOPEE_BACKUP_LOCAL_DIR missing}"
: "${SHOPEE_NAS_BACKUP_DIR:?SHOPEE_NAS_BACKUP_DIR missing}"

mkdir -p "$SHOPEE_BACKUP_LOCAL_DIR"
mkdir -p "$SHOPEE_NAS_BACKUP_DIR/daily" "$SHOPEE_NAS_BACKUP_DIR/weekly" "$SHOPEE_NAS_BACKUP_DIR/monthly"
mkdir -p "$SCRIPT_DIR/runtime"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="shopee-analytics-$STAMP.dump"
CONTAINER_FILE="/tmp/$FILE"
LOCAL_FILE="$SHOPEE_BACKUP_LOCAL_DIR/$FILE"
STATUS_FILE="$SCRIPT_DIR/runtime/backup-status.json"

write_fail() {
  MSG="$1"
  printf '{"ok":false,"completedAt":null,"fileName":"%s","sizeBytes":0,"sha256":null,"nasCopiedAt":null,"error":"%s"}\n' "$FILE" "$MSG" > "$STATUS_FILE"
}

cleanup_container_file() {
  docker compose --env-file "$ENV_FILE" exec -T postgres rm -f "$CONTAINER_FILE" >/dev/null 2>&1 || true
}

trap 'write_fail "backup script interrupted"; cleanup_container_file' INT TERM HUP

if ! docker compose --env-file "$ENV_FILE" exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$CONTAINER_FILE"; then
  write_fail "pg_dump failed"
  cleanup_container_file
  exit 1
fi

if ! docker compose --env-file "$ENV_FILE" exec -T postgres pg_restore --list "$CONTAINER_FILE" >/dev/null; then
  write_fail "pg_restore list validation failed"
  cleanup_container_file
  exit 1
fi

CONTAINER_ID="$(docker compose --env-file "$ENV_FILE" ps -q postgres)"
[ -n "$CONTAINER_ID" ] || { write_fail "postgres container not found"; cleanup_container_file; exit 1; }

if ! docker cp "$CONTAINER_ID:$CONTAINER_FILE" "$LOCAL_FILE"; then
  write_fail "docker cp failed"
  cleanup_container_file
  exit 1
fi
cleanup_container_file

HASH="$(sha256sum "$LOCAL_FILE" | awk '{print $1}')"
SIZE="$(wc -c < "$LOCAL_FILE" | tr -d ' ')"
cp "$LOCAL_FILE" "$SHOPEE_NAS_BACKUP_DIR/daily/$FILE"

DOW="$(date +%u)"
DOM="$(date +%d)"
[ "$DOW" = "7" ] && cp "$LOCAL_FILE" "$SHOPEE_NAS_BACKUP_DIR/weekly/$FILE"
[ "$DOM" = "01" ] && cp "$LOCAL_FILE" "$SHOPEE_NAS_BACKUP_DIR/monthly/$FILE"

find "$SHOPEE_BACKUP_LOCAL_DIR" -type f -name 'shopee-analytics-*.dump' -mtime +30 -delete
find "$SHOPEE_NAS_BACKUP_DIR/daily" -type f -name 'shopee-analytics-*.dump' -mtime +30 -delete
find "$SHOPEE_NAS_BACKUP_DIR/weekly" -type f -name 'shopee-analytics-*.dump' -mtime +90 -delete
find "$SHOPEE_NAS_BACKUP_DIR/monthly" -type f -name 'shopee-analytics-*.dump' -mtime +730 -delete

COMPLETED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"ok":true,"completedAt":"%s","fileName":"%s","sizeBytes":%s,"sha256":"%s","nasCopiedAt":"%s","error":null}\n' "$COMPLETED" "$FILE" "$SIZE" "$HASH" "$COMPLETED" > "$STATUS_FILE"

echo "Backup OK: $FILE"
