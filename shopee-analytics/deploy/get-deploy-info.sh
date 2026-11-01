#!/bin/bash
# 一行命令：在生产服务器上执行，自动打印部署所需的全部信息
echo "===== 源站地址（填进 DEPLOY_HOST）====="
curl -s --max-time 8 ifconfig.me 2>/dev/null || curl -s --max-time 8 https://api.ipify.org 2>/dev/null || echo "取不到"
echo ""
echo "===== 登录用户名（DEPLOY_USER）====="
whoami
echo ""
echo "===== 部署目录（DEPLOY_DIR）====="
for base in "$HOME" /home /root /opt /srv /var/www /data /app; do
  [ -d "$base" ] || continue
  hit=$(find "$base" -maxdepth 4 -type d -name .git 2>/dev/null | head -8 | while read -r g; do
    d=$(dirname "$g"); [ -d "$d/shopee-analytics" ] && echo "$d"
  done | head -1)
  if [ -n "$hit" ]; then echo "$hit"; break; fi
done
echo ""
echo "===== 当前版本 ====="
for base in "$HOME" /home /root /opt /srv /var/www /data /app; do
  [ -d "$base" ] || continue
  hit=$(find "$base" -maxdepth 4 -type d -name .git 2>/dev/null | head -8 | while read -r g; do
    d=$(dirname "$g"); [ -d "$d/shopee-analytics" ] && echo "$d"
  done | head -1)
  if [ -n "$hit" ]; then git -C "$hit" log --oneline -1 2>/dev/null; break; fi
done
echo ""
echo "===== 应用运行方式 ====="
command -v pm2 >/dev/null 2>&1 && echo "PM2" || (command -v docker >/dev/null 2>&1 && echo "Docker" || echo "需手动重启")
