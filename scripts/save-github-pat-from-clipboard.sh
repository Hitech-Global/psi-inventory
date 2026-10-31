#!/usr/bin/env bash
# ============================================================================================
# 从剪贴板读取 GitHub PAT，校验后存入 macOS Keychain
# ============================================================================================
# 用途：GitHub 的令牌页只显示一次，手动粘贴容易出错（且会进 shell 历史）。
#       本脚本改从剪贴板读取：用户在网页上点「Copy token」后直接跑本脚本即可，
#       令牌不经过聊天记录、不进 shell 历史、不落盘明文。
#
# 用法：
#   1. 在 GitHub 生成令牌页面点「Copy token」
#   2. 回到终端执行：bash scripts/save-github-pat-from-clipboard.sh
#
# 校验分三关：
#   a. 令牌格式（ghp_/gho_/ghu_/ghs_/ghr_/github_pat_）
#   b. GitHub 是否接受（GET /user）
#   c. 是否具备目标仓库写权限（GET /repos 的 permissions.push）
# 任一关不过则自动从 Keychain 清理，并给出具体处置建议。
# ============================================================================================

set -euo pipefail

REPO_DIR="${REPO_DIR:-/Users/wwt46/WorkBuddy/2026-10-30-14-22-28}"
REPO_OWNER="${REPO_OWNER:-Hitech-Global}"
REPO_NAME="${REPO_NAME:-psi-inventory}"
GIT_USER="martin0000118-dev"

cd "$REPO_DIR"

# ---- 读取并清空剪贴板 ---------------------------------------------------------
# 读完立刻清空，避免令牌长期留在剪贴板里。
PAT="$(pbpaste 2>/dev/null | tr -d '\r\n' || true)"
if [ -z "${PAT}" ]; then
  echo "❌ 剪贴板是空的。请先在 GitHub 令牌页点「Copy token」，再重跑本脚本。" >&2
  exit 1
fi

case "$PAT" in
  ghp_*|gho_*|ghu_*|ghs_*|ghr_*|github_pat_*) ;;
  *)
    echo "❌ 剪贴板内容不像 GitHub 令牌（应以 ghp_/gho_/ghu_/ghs_/ghr_/github_pat_ 开头）。" >&2
    echo "   当前剪贴板开头：${PAT:0:12}…" >&2
    exit 1 ;;
esac

# 清空剪贴板（无论后续成功与否，令牌都不再留在剪贴板）
printf '' | pbcopy 2>/dev/null || true

CLEANUP_ON_EXIT=1
cleanup_on_exit() {
  if [ "${CLEANUP_ON_EXIT}" = "1" ]; then
    security delete-internet-password -s github.com -a "$GIT_USER" >/dev/null 2>&1 || true
    echo "❌ 已从 Keychain 清理本次写入的凭证。" >&2
  fi
}
trap cleanup_on_exit EXIT

echo "→ 写入 Keychain..."
printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n' "$GIT_USER" "$PAT" \
  | git credential-osxkeychain store

echo "→ 校验令牌有效性..."
USER_JSON="$(curl -s -m 20 -H "Authorization: Bearer $PAT" https://api.github.com/user)"
LOGIN="$(printf '%s' "$USER_JSON" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
print(d.get('login') or '')
" 2>/dev/null || true)"
if [ -z "${LOGIN}" ]; then
  REASON="$(printf '%s' "$USER_JSON" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('响应无法解析'); raise SystemExit
print(d.get('message') or '未知原因')
" 2>/dev/null || true)"
  echo "❌ GitHub 拒绝了该令牌：${REASON}" >&2
  unset PAT USER_JSON
  exit 1
fi
echo "   ✅ 有效，身份: ${LOGIN}"

# 令牌类型决定权限语义：classic 按 OAuth scope 授权，fine-grained 按 resource owner + 仓库权限授权。
case "$PAT" in
  github_pat_*) TOKEN_KIND="fine-grained" ;;
  *)            TOKEN_KIND="classic" ;;
esac
echo "   令牌类型: ${TOKEN_KIND}"

# classic 令牌会回显实际授予的 scope，这是最直接的凭据证据。
if [ "$TOKEN_KIND" = "classic" ]; then
  SCOPES="$(curl -s -m 20 -D - -o /dev/null -H "Authorization: Bearer $PAT" https://api.github.com/user \
    | tr -d '\r' | sed -n 's/^[Xx]-[Oo][Aa][Uu][Tt][Hh]-[Ss][Cc][Oo][Pp][Ee][Ss]: *//p')"
  if [ -n "${SCOPES}" ]; then
    echo "   已授予 scope: ${SCOPES}"
    case ",${SCOPES}," in
      *,repo,*|*",repo,"*) ;;
      *) echo "   ⚠️  scope 里没有 repo —— 大概率推不动该仓库" >&2 ;;
    esac
    case ",${SCOPES}," in
      *,workflow,*|*",workflow,"*) ;;
      *) echo "   ⚠️  scope 里没有 workflow —— 改 .github/workflows/ 会被 GitHub 拒推" >&2 ;;
    esac
  fi
fi

echo "→ 校验对 ${REPO_OWNER}/${REPO_NAME} 的写权限..."
REPO_JSON="$(curl -s -m 20 -H "Authorization: Bearer $PAT" "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}")"
MSG="$(printf '%s' "$REPO_JSON" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
print(d.get('message') or '')
" 2>/dev/null || true)"

if [ -n "${MSG}" ]; then
  case "$MSG" in
    *Not\ Found*)
      echo "   ❌ 404：令牌看不到该仓库。" >&2
      echo "      → 若是 classic PAT：确认勾了 repo scope" >&2
      echo "      → 若是 fine-grained PAT：Repository access 需包含 ${REPO_OWNER}/${REPO_NAME}" >&2 ;;
    *SAML*|*organization*|*protected*)
      echo "   ❌ ${MSG}" >&2
      echo "      → 需要在令牌页面点 'Authorize' 授权该主体" >&2 ;;
    *)
      echo "   ❌ ${MSG}" >&2 ;;
  esac
  unset PAT USER_JSON REPO_JSON
  exit 1
fi

CAN_PUSH="$(printf '%s' "$REPO_JSON" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('false'); raise SystemExit
print('true' if (d.get('permissions') or {}).get('push') else 'false')
" 2>/dev/null || true)"

if [ "$CAN_PUSH" != "true" ]; then
  echo "   ❌ 令牌对该仓库只有读权限。" >&2
  case "$PAT" in
    github_pat_*)
      echo "      → 这是 fine-grained 令牌：Resource owner 必须是 ${REPO_OWNER}" >&2
      echo "        （令牌只能改自己 owner 名下的资源；${REPO_OWNER} 是个人账号时无法被选中）" >&2
      echo "      → Repository access 不能选 Public repositories（那只有读权限）" >&2
      echo "      → Repository permissions 需勾 Contents / Workflows / Pull requests = Read and write" >&2 ;;
    *)
      echo "      → 这是 classic 令牌：需勾选 repo scope" >&2
      echo "      → 改 workflow 文件还需额外勾选 workflow scope" >&2 ;;
  esac
  unset PAT USER_JSON REPO_JSON
  exit 1
fi

echo "   ✅ 具备写权限"

echo "→ 校验 git 推送（dry-run）..."
if ! GIT_TERMINAL_PROMPT=0 git push --dry-run \
      "https://${GIT_USER}:${PAT}@github.com/${REPO_OWNER}/${REPO_NAME}.git" \
      "feat/shopee-analytics-v1-foundation" >/tmp/pat-probe.log 2>&1; then
  echo "   ❌ dry-run 推送失败：" >&2
  sed 's#https://[^@]*@#https://<redacted>@#g' /tmp/pat-probe.log >&2
  rm -f /tmp/pat-probe.log
  unset PAT USER_JSON REPO_JSON
  exit 1
fi
rm -f /tmp/pat-probe.log
echo "   ✅ 推送链路可用"

unset PAT USER_JSON REPO_JSON
CLEANUP_ON_EXIT=0

echo
echo "✅ 凭证已安全存入 Keychain，剪贴板已清空。"
echo "   下一步：bash scripts/push-with-pat.sh"
