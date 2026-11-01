#!/bin/bash
# 平台接入页部署脚本（TikTok analytics 模块）
# 用法：在生产服务器的部署目录里执行  bash /tmp/deploy-analytics.sh
set -e

# --- 守卫：必须在 git 仓库里 ---
if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  cat <<'MSG'
✗ 当前目录不是 git 仓库。

请先 cd 到生产部署目录（那个包含 .git 和 shopee-analytics/ 的目录），再执行本脚本。

不确定在哪？可以用这些命令找：
  # 看有哪些进程在跑 analytics
  pm2 list
  # 或
  ps aux | grep -i standalone-server
  # 找到它的路径后 cd 过去
MSG
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

if [ ! -d shopee-analytics ]; then
  echo "✗ 这个仓库里没有 shopee-analytics/ 目录 —— 可能不是部署 analytics 的那个仓库。"
  exit 1
fi

echo "=== 1/5 当前版本 ==="
git log --oneline -1
git rev-parse --short HEAD

echo ""
echo "=== 2/5 备份数据库 ==="
if [ -f scripts/backup.js ]; then
  node scripts/backup.js || { echo "备份失败，中止"; exit 1; }
else
  echo "（未找到 scripts/backup.js，跳过 —— 若生产用 PostgreSQL 请改用 pg_dump）"
fi

echo ""
echo "=== 3/5 拉取代码 ==="
git fetch origin
git pull origin main

echo ""
echo "=== 4/5 拉取后版本（应为 c934572 或更新）==="
git log --oneline -1

echo ""
echo "=== 5/5 重启应用 ==="
if command -v pm2 >/dev/null 2>&1; then
  echo "检测到 PM2，正在列出进程："
  pm2 list
  echo ""
  echo "请确认进程名后执行：pm2 reload <上面显示的名字>"
elif command -v docker >/dev/null 2>&1 && [ -f shopee-analytics/deploy/desktop/docker-compose.yml ]; then
  echo "检测到 Docker 栈，正在重建："
  cd shopee-analytics/deploy/desktop
  docker compose --env-file runtime/.env up -d --build app oauth worker
else
  echo "未检测到 PM2 或 Docker 栈 —— 请手动重启 analytics 进程"
fi

echo ""
echo "=== 完成。验证 ==="
echo "本地: git log --oneline -1"
echo "远端: curl -sI https://analytics.hitechanalysis.top/app.js | grep -i last-modified"
