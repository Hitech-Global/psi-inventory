#!/bin/bash
# 平台接入页部署脚本（TikTok analytics 模块）
# 用法：在生产服务器的部署目录里执行  bash /tmp/deploy-analytics.sh
set -e

# --- 定位部署目录 ---
# 优先用当前目录；若当前目录不是 git 仓库，则自动搜索
# 「同时含 .git 与 shopee-analytics/」的目录，这样不必先 cd。
find_deploy_dir() {
  if git rev-parse --show-toplevel >/dev/null 2>&1; then
    local root
    root="$(git rev-parse --show-toplevel)"
    [ -d "$root/shopee-analytics" ] && { echo "$root"; return 0; }
  fi
  for base in "$HOME" /home /root /opt /srv /var/www /data /app; do
    [ -d "$base" ] || continue
    local hit
    hit="$(find "$base" -maxdepth 4 -type d -name .git 2>/dev/null | head -8 | while read -r g; do
      d="$(dirname "$g")"
      [ -d "$d/shopee-analytics" ] && echo "$d"
    done | head -1)"
    [ -n "$hit" ] && { echo "$hit"; return 0; }
  done
  return 1
}

DEPLOY_DIR="$(find_deploy_dir || true)"
if [ -z "$DEPLOY_DIR" ]; then
  cat <<'MSG'
✗ 找不到部署目录。

需要找到一个同时包含 .git 与 shopee-analytics/ 的目录。可用这些命令找：
  ps aux | grep -i standalone-server
  pm2 list
  docker ps --format '{{.Names}}	{{.Image}}'
找到后 cd 进去，再执行本脚本。
MSG
  exit 1
fi

cd "$DEPLOY_DIR"
echo "部署目录：$DEPLOY_DIR"

echo "=== 1/6 当前版本 ==="
git log --oneline -1
git rev-parse --short HEAD

echo ""
echo "=== 2/6 备份数据库 ==="
if [ -f scripts/backup.js ]; then
  node scripts/backup.js || { echo "备份失败，中止"; exit 1; }
else
  echo "（未找到 scripts/backup.js，跳过 —— 若生产用 PostgreSQL 请改用 pg_dump）"
fi

echo ""
echo "=== 3/6 拉取代码 ==="
# 生产可能停在任意分支（feat 分支或 main）。统一切到 main 再拉，
# 因为合并 PR#5 后 main 才是最新的那份。
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
echo "当前分支：$CURRENT_BRANCH"

# 工作区有本地改动时不能直接切分支 —— 先报告，不覆盖。
DIRTY="$(git status --porcelain | grep -v '^??' | head -5)"
if [ -n "$DIRTY" ]; then
  echo ""
  echo "⚠️  工作区有已跟踪文件的本地改动，为避免覆盖，中止："
  git status --short | head -10
  echo ""
  echo "请先确认这些改动是否还需要（git stash / 提交 / 丢弃），再重新执行。"
  exit 1
fi

git fetch origin --prune
if [ "$CURRENT_BRANCH" != "main" ]; then
  git checkout main 2>/dev/null || { echo "切换到 main 失败 —— 该分支可能有本地提交，改为直接拉取当前分支"; }
fi
git pull --ff-only origin main 2>/dev/null || git pull origin main

echo ""
echo "=== 4/6 拉取后版本 ==="
git log --oneline -1
echo "分支：$(git rev-parse --abbrev-ref HEAD)"
echo "分支：$(git rev-parse --abbrev-ref HEAD)"

echo ""
echo "=== 5/6 前端是否已生效 ==="
# 静态文件由 Express 直接托管（express.static 指向 shopee-analytics/web/），
# 所以 pull 完前端立即生效，无需重启。下面确认线上内容是否已是新版本。
NEW_SHA=$(git show HEAD:shopee-analytics/web/app.js | shasum -a 256 | cut -d' ' -f1 | cut -c1-16)
echo "仓库 app.js sha: $NEW_SHA"
curl -s --max-time 15 https://analytics.hitechanalysis.top/app.js -o /tmp/prod_app.js 2>/dev/null || true
if [ -s /tmp/prod_app.js ]; then
  PROD_SHA=$(shasum -a 256 /tmp/prod_app.js | cut -d' ' -f1 | cut -c1-16)
  echo "线上 app.js sha: $PROD_SHA"
  if [ "$NEW_SHA" = "$PROD_SHA" ]; then
    echo "✅ 前端已同步（静态文件由应用直接托管，pull 即生效）"
  else
    echo "⚠️  线上还是旧版 —— 若应用在容器里，需要重建镜像；否则检查静态目录指向"
  fi
else
  echo "（无法访问线上，跳过检查）"
fi

echo ""
echo "=== 6/6 重启应用（/connections 路由需要） ==="
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
  echo ""
  echo "提示：前端（顶栏「平台接入」按钮）已经生效，只有 /connections 路由需要重启"
fi

echo ""
echo "=== 完成。验证 ==="
echo "本地: git log --oneline -1"
echo "远端: curl -sI https://analytics.hitechanalysis.top/app.js | grep -i last-modified"
