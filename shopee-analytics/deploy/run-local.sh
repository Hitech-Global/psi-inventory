#!/usr/bin/env bash
# 在本机起一个只读的 Shopee Analytics 实例，用于开发与验收。
#
# 用法（从仓库根目录）：
#   bash shopee-analytics/deploy/run-local.sh          # 起服务
#   bash shopee-analytics/deploy/run-local.sh --check  # 只跑一遍验证
#
# 数据落在 /tmp，不碰 PSI 的 data/ 与生产库。
# 端口默认 3091，与生产的 3090 区分开。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="$REPO_ROOT/.pgtest/pg16bin/bin"
PG_DIR="${SHOPEE_LOCAL_PG_DIR:-/tmp/shopee-local-pg}"
PG_PORT="${SHOPEE_LOCAL_PG_PORT:-55432}"
PG_DB="shopee_local"
APP_PORT="${SHOPEE_ANALYTICS_PORT:-3091}"

cd "$REPO_ROOT"

if [ ! -x "$PG_BIN/pg_ctl" ]; then
  echo "✗ 找不到嵌入式 PostgreSQL：$PG_BIN"
  echo "  它由仓库的测试流程准备。若缺失，先跑一次带数据库的测试以生成它。"
  exit 1
fi

start_pg() {
  if [ ! -d "$PG_DIR/data" ]; then
    echo "=== 初始化本地 PostgreSQL ==="
    mkdir -p "$PG_DIR"
    "$PG_BIN/initdb" -D "$PG_DIR/data" -U postgres --auth=trust >"$PG_DIR/initdb.log" 2>&1
    echo "  ✅ 初始化完成"
  fi
  if "$PG_BIN/pg_ctl" -D "$PG_DIR/data" status >/dev/null 2>&1; then
    echo "  ✅ PostgreSQL 已在运行"
    return 0
  fi
  # 端口可能已被上一次遗留的实例占着（pg_ctl 状态与实际监听可能不一致）。
  # 先探测端口，端口在就说明已有可用实例，不必再起。
  if port_in_use "$PG_PORT"; then
    echo "  ✅ 端口 ${PG_PORT} 上已有 PostgreSQL 在运行，复用它"
    return 0
  fi
  echo "=== 启动本地 PostgreSQL（端口 ${PG_PORT}）==="
  "$PG_BIN/pg_ctl" -D "$PG_DIR/data" -o "-p ${PG_PORT} -k ${PG_DIR}" -l "$PG_DIR/pg.log" start >/dev/null
  sleep 3
  echo "  ✅ PostgreSQL 就绪"
}

# 端口是否已被占用。
port_in_use() {
  node -e "
    const net = require('net');
    const s = net.connect({ host: '127.0.0.1', port: $1 });
    s.on('connect', () => { s.destroy(); process.exit(0); });
    s.on('error', () => process.exit(1));
    setTimeout(() => { s.destroy(); process.exit(1); }, 1200);
  " 2>/dev/null
}

apply_schema() {
  echo "=== 应用 schema ==="
  node -e "
    const { Client } = require('pg');
    (async () => {
      const admin = new Client({ host: '127.0.0.1', port: $PG_PORT, user: 'postgres', database: 'postgres' });
      await admin.connect();
      const found = await admin.query(\"SELECT 1 FROM pg_database WHERE datname='$PG_DB'\");
      if (!found.rows.length) await admin.query('CREATE DATABASE $PG_DB');
      await admin.end();
      const c = new Client({ host: '127.0.0.1', port: $PG_PORT, user: 'postgres', database: '$PG_DB' });
      await c.connect();
      await c.query(require('fs').readFileSync('shopee-analytics/schema.sql','utf8'));
      const t = await c.query(\"SELECT count(*) n FROM information_schema.tables WHERE table_schema='public'\");
      console.log('  ✅ 表数:', t.rows[0].n);
      await c.end();
    })().catch(e => { console.error('  ❌', e.message); process.exit(1); });
  "
}

start_pg
apply_schema

export SHOPEE_ANALYTICS_DATABASE_URL="postgresql://postgres@localhost:$PG_PORT/$PG_DB"
export SHOPEE_TOKEN_MASTER_KEY="${SHOPEE_TOKEN_MASTER_KEY:-$(openssl rand -base64 32)}"
export SHOPEE_ANALYTICS_HOST=127.0.0.1
export SHOPEE_ANALYTICS_PORT="$APP_PORT"

if [ "${1:-}" = "--check" ]; then
  echo "=== 验证（起服务 → 探测 → 关闭）==="
  node shopee-analytics/src/standalone-server.js &
  APP_PID=$!
  trap 'kill $APP_PID 2>/dev/null || true' EXIT
  sleep 6
  for path in /api/shopee-analytics/health /login /connections /connections.html /app.js; do
    printf "  %-34s " "$path"
    curl -s -m 10 -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$APP_PORT$path"
  done
  echo ""
  echo "  浏览器打开 http://127.0.0.1:$APP_PORT/connections"
  exit 0
fi

echo ""
echo "=== 启动应用（端口 ${APP_PORT}）==="
echo "  浏览器打开 http://127.0.0.1:$APP_PORT/connections"
echo "  停止：Ctrl+C"
echo ""
exec node shopee-analytics/src/standalone-server.js
