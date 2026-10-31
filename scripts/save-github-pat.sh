#!/usr/bin/env bash
# ============================================================================================
# 把 GitHub PAT 存入 macOS Keychain（供 git push 使用）
# ============================================================================================
# 用法：
#   bash scripts/save-github-pat.sh
#
# 脚本会提示你粘贴 PAT（不回显、不进 shell 历史、不落盘明文），存入 Keychain 后立即校验：
#   - 令牌是否被 GitHub 接受
#   - 是否具备目标仓库的写权限（dry-run push 探测）
# 校验不通过会删除刚写入的条目，避免留下无效凭证。
#
# 注意：不要用 `read -rs ... < <(...)` 或管道喂给 read —— read 只从终端读，管道会让它拿到空值。
# ============================================================================================

set -euo pipefail

REPO_DIR="${REPO_DIR:-/Users/wwt46/WorkBuddy/2026-10-30-14-22-28}"
BRANCH="${BRANCH:-feat/shopee-analytics-v1-foundation}"
REMOTE_REPO="${REMOTE_REPO:-Hitech-Global/psi-inventory}"
GIT_USER="martin0000118-dev"

cd "$REPO_DIR"

echo "请粘贴 GitHub PAT（输入不可见，回车确认）："
# stty 关回显，read 从终端读；用 </dev/tty 保证读到的是终端而不是管道。
if [ -t 0 ]; then
  stty -echo
  IFS= read -r PAT
  stty echo
  echo
else
  IFS= read -r PAT
fi

if [ -z "${PAT:-}" ]; then
  echo "❌ 没有读到任何内容，请重新运行。" >&2
  exit 1
fi

case "$PAT" in
  ghp_*|gho_*|ghu_*|ghs_*|ghr_*|github_pat_*) ;;
  *) echo "❌ 看起来不像 GitHub 令牌（应以 ghp_/gho_/ghu_/ghs_/ghr_/github_pat_ 开头）。" >&2
     unset PAT; exit 1 ;;
esac

echo "→ 写入 Keychain..."
printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n' "$GIT_USER" "$PAT" \
  | git credential-osxkeychain store

# 任何后续失败都要清掉刚写入的条目，避免留下无效凭证。
# 用 EXIT trap 而非 ERR trap：脚本用 `exit 1` 退出时 ERR 不会触发。
CLEANUP_ON_EXIT=1
cleanup_on_exit() {
  if [ "${CLEANUP_ON_EXIT}" = "1" ]; then
    security delete-internet-password -s github.com -a "$GIT_USER" >/dev/null 2>&1 || true
    echo "❌ 已从 Keychain 清理本次写入的凭证。" >&2
  fi
}
trap cleanup_on_exit EXIT

echo "→ 校验令牌有效性..."
CRED="$(printf 'protocol=https\nhost=github.com\n\n' | git credential-osxkeychain get)"
STORED="$(printf '%s\n' "$CRED" | sed -n 's/^password=//p')"
if [ -z "$STORED" ]; then
  echo "❌ Keychain 写入后读回为空。" >&2
  unset PAT STORED CRED
  exit 1
fi

AUTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 20 -H "Authorization: Bearer $STORED" https://api.github.com/user)"
if [ "$AUTH_CODE" != "200" ]; then
  echo "❌ GitHub 拒绝了该令牌（HTTP ${AUTH_CODE}）。" >&2
  unset PAT STORED CRED
  exit 1
fi
echo "✅ 令牌有效"

echo "→ 校验写权限（dry-run push）..."
if ! GIT_TERMINAL_PROMPT=0 git push --dry-run \
      "https://${GIT_USER}:${STORED}@github.com/${REMOTE_REPO}.git" "$BRANCH" >/tmp/pat-probe.log 2>&1; then
  echo "❌ 写权限校验失败。错误信息：" >&2
  sed 's#https://[^@]*@#https://<redacted>@#g' /tmp/pat-probe.log >&2
  echo >&2
  echo "请确认该令牌勾选了 Contents: Read and write、Workflows: Read and write。" >&2
  rm -f /tmp/pat-probe.log
  unset PAT STORED CRED
  exit 1
fi
rm -f /tmp/pat-probe.log
echo "✅ 写权限校验通过"

unset PAT STORED CRED
# 校验全部通过，保留 Keychain 条目。
CLEANUP_ON_EXIT=0
echo
echo "✅ 凭证已安全存入 Keychain。现在可以推送："
echo "   bash scripts/push-with-pat.sh"
