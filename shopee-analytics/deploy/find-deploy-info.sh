#!/bin/bash
# 在生产服务器上执行，找出部署所需的全部信息。
#
# 用法：登录服务器后运行本脚本（可直接粘贴，不含 Markdown 标记）：
#   bash find-deploy-info.sh
#
# 输出三件事：DEPLOY_HOST / DEPLOY_USER / DEPLOY_DIR
# 前两件填进仓库的 secret，后一件可以不填（部署 workflow 会自动找）。

echo "===== DEPLOY_HOST（源站地址，填进 secret）====="
echo "公网 IP: $(curl -s --max-time 8 ifconfig.me 2>/dev/null || echo '取不到，检查是否有外网')"
echo "主机内网 IP:"
hostname -I 2>/dev/null | tr ' ' '\n' | head -5
echo ""
echo "提示：Cloudflare 控制台 → 你的域名 → DNS → 查看 analytics 那条记录的「内容」"
echo "      如果是 172.67.x / 104.21.x 这种，那是 Cloudflare 的 IP，不是源站。"
echo ""

echo "===== DEPLOY_USER（登录用户名，可留空让 workflow 探测）====="
whoami
echo ""

echo "===== DEPLOY_DIR（部署目录，可留空让 workflow 探测）====="
found=""
for base in "$HOME" /home /root /opt /srv /var/www /data /app; do
  [ -d "$base" ] || continue
  hit=$(find "$base" -maxdepth 4 -type d -name .git 2>/dev/null | head -8 | while read -r g; do
    d=$(dirname "$g")
    [ -d "$d/shopee-analytics" ] && echo "$d"
  done | head -1)
  if [ -n "$hit" ]; then
    echo "$hit"
    found="$hit"
    break
  fi
done
if [ -z "$found" ]; then
  echo "（没找到。下面手动找一下）"
  echo "  ps aux | grep -i standalone-server"
  echo "  输出里的路径就是部署目录"
fi

echo ""
echo "===== 当前运行的版本 ====="
if [ -n "$found" ]; then
  git -C "$found" log --oneline -1 2>/dev/null
  git -C "$found" rev-parse --short HEAD 2>/dev/null
fi

echo ""
echo "===== 应用怎么跑的（决定部署时如何重启）====="
if command -v pm2 >/dev/null 2>&1; then
  echo "PM2 —— 进程名："
  pm2 list 2>/dev/null | head -12
elif command -v docker >/dev/null 2>&1; then
  echo "Docker —— 容器："
  docker ps --format '{{.Names}}	{{.Image}}' 2>/dev/null | head -12
else
  echo "既没有 PM2 也没有 Docker —— 需要手动重启进程"
fi
