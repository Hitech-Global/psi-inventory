#!/usr/bin/env bash
# ============================================================================================
# Shopee Analytics — 用 Keychain 中的 GitHub PAT 推送当前分支
# ============================================================================================
# 用途：GitHub 连接器的 OAuth 授权当前只有读权限（scope 不含写能力），无法 push。
#       本脚本从 macOS Keychain 读取一枚含 `repo` scope 的 PAT，用它完成 git push，
#       并可选择性地把同一枚 PAT 注入 WorkBuddy 连接器，使 MCP 写工具恢复可用。
#
# 用法：
#   1) 首次存入 PAT（在你自己的终端里执行，PAT 不会进入任何聊天记录）：
#        read -rs "PAT" PAT && printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n' \
#          "martin0000118-dev" "$PAT" | git credential-osxkeychain store && unset PAT
#
#   2) 推送：
#        bash scripts/push-with-pat.sh
#
# 脚本行为：
#   - 从 Keychain 取凭证，取不到则直接报错退出，不做任何猜测；
#   - 先验证 PAT 是否有效且具备写权限（对目标仓库做一次 dry-run 探测）；
#   - 校验通过后执行 push，并打印远端 HEAD 供核对。
# ============================================================================================

set -euo pipefail

REPO_DIR="${REPO_DIR:-/Users/wwt46/WorkBuddy/2026-10-30-14-22-28}"
BRANCH="${BRANCH:-feat/shopee-analytics-v1-foundation}"
REMOTE_REPO="${REMOTE_REPO:-Hitech-Global/psi-inventory}"

cd "$REPO_DIR"

# ---- 取凭证 ----------------------------------------------------------------------
CRED="$(printf 'protocol=https\nhost=github.com\n\n' | git credential-osxkeychain get || true)"
USERNAME="$(printf '%s\n' "$CRED" | sed -n 's/^username=//p')"
PASSWORD="$(printf '%s\n' "$CRED" | sed -n 's/^password=//p')"

if [ -z "$PASSWORD" ]; then
  echo "❌ Keychain 中没有 github.com 的凭证。请先按本文件头部的说明存入一枚含 repo scope 的 PAT。" >&2
  exit 1
fi

echo "→ 使用凭证用户: ${USERNAME:-<未指定>}"

# ---- 验证有效性与写权限 ------------------------------------------------------------
# 用目标分支做 dry-run：能走到远端并算出对象即说明具备写权限。
echo "→ 校验写权限（dry-run push）..."
if ! GIT_TERMINAL_PROMPT=0 git push --dry-run \
      "https://${USERNAME}:${PASSWORD}@github.com/${REMOTE_REPO}.git" "$BRANCH" >/tmp/pat-probe.log 2>&1; then
  echo "❌ 写权限校验失败，输出如下：" >&2
  sed 's/https:\/\/[^@]*@/https:\/\/<redacted>@/g' /tmp/pat-probe.log >&2
  echo >&2
  # git 的 "Permission denied" 不说明原因，用 API 补一层判定。
  echo "→ 用 API 进一步定位原因..." >&2
  REPO_JSON="$(curl -s -m 20 -H "Authorization: Bearer $PASSWORD" "https://api.github.com/repos/${REMOTE_REPO}")"
  printf '%s' "$REPO_JSON" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('   （响应无法解析）'); raise SystemExit
msg = d.get('message')
if msg:
    print('   GitHub API 返回：', msg)
    if 'Not Found' in msg:
        print('   → 令牌看不到该仓库：创建令牌时 Repository access 没有勾选它。')
    elif 'SAML' in msg or 'protected' in msg.lower():
        print('   → 仓库受组织 SAML 保护：需在令牌页面点 Authorize 授权该组织。')
else:
    p = d.get('permissions', {})
    print('   仓库可读，但 permissions.push =', p.get('push'))
    if not p.get('push'):
        print('   → 令牌只有读权限：把 Contents 改为 Read and write、Workflows 改为 Read and write。')
    else:
        print('   → 令牌具备写权限，问题在 git 传输层而非令牌。')
" >&2
  echo >&2
  echo "详细诊断可运行：bash scripts/diagnose-github-pat.sh" >&2
  rm -f /tmp/pat-probe.log
  exit 1
fi
rm -f /tmp/pat-probe.log
echo "✅ 写权限校验通过"

# ---- 推送 -------------------------------------------------------------------------
echo "→ 推送 $BRANCH ..."
# refspec 只写一次：`git push <url> <branch> <branch>` 会让同一个远端 ref 收到两个 src，
# git 直接拒绝（"receives from more than one src"）。
GIT_TERMINAL_PROMPT=0 git push \
  "https://${USERNAME}:${PASSWORD}@github.com/${REMOTE_REPO}.git" "HEAD:refs/heads/${BRANCH}"

echo "✅ 推送完成"
echo
echo "远端 HEAD:"
GIT_TERMINAL_PROMPT=0 git ls-remote \
  "https://${USERNAME}:${PASSWORD}@github.com/${REMOTE_REPO}.git" "refs/heads/$BRANCH" \
  | sed 's/^/  /'
echo "本地 HEAD:"
echo "  $(git rev-parse HEAD)"
