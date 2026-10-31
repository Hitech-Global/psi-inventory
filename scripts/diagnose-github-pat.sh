#!/usr/bin/env bash
# ============================================================================================
# 诊断 GitHub 令牌对目标仓库的实际权限
# ============================================================================================
# 用途：git push 报 "Permission to <repo>.git denied" 时，区分以下几种成因：
#   1. 令牌根本没被接受            → GET /user 返回 401
#   2. 令牌看不到该仓库（未选仓库）→ GET /repos/{o}/{r} 返回 404
#   3. 令牌能读不能写              → GET 正常但 permissions.push 为 false
#   4. 仓库受组织 SSO 保护        → 响应含 "protected by organization SAML enforcement"
#   5. 权限齐全                    → permissions.push 为 true，此时 403 才可能是别的原因
#
# 用法：bash scripts/diagnose-github-pat.sh
# 令牌从终端读取，不回显、不落盘明文。
# ============================================================================================

set -euo pipefail

REPO_OWNER="${REPO_OWNER:-Hitech-Global}"
REPO_NAME="${REPO_NAME:-psi-inventory}"
GIT_USER="martin0000118-dev"

echo "请粘贴 GitHub PAT（输入不可见，回车确认）："
if [ -r /dev/tty ] && [ -w /dev/tty ]; then TTY=/dev/tty; else TTY=/dev/stdin; fi
stty -echo 2>/dev/null || true
IFS= read -r PAT < "$TTY" || true
stty echo 2>/dev/null || true
echo

if [ -z "${PAT:-}" ]; then
  echo "❌ 没有读到内容。" >&2
  exit 1
fi

echo "→ 1) 令牌是否被 GitHub 接受"
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
    print(''); raise SystemExit
print(d.get('message') or '响应无法解析')
" 2>/dev/null || true)"
  echo "   ❌ 令牌未被接受：${REASON}"
  unset PAT USER_JSON
  exit 1
fi
echo "   ✅ 有效，身份: ${LOGIN}"

echo "→ 2) 令牌能否看到仓库 ${REPO_OWNER}/${REPO_NAME}"
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
    *Not\ Found*) echo "   ❌ 404：令牌看不到该仓库 → 创建令牌时 Repository access 没有勾选它" ;;
    *SAML*|*organization*|*protected*) echo "   ❌ ${MSG} → 需要在令牌页面点 'Authorize' 授权该组织" ;;
    *) echo "   ❌ ${MSG}" ;;
  esac
  unset PAT USER_JSON REPO_JSON
  exit 1
fi
echo "   ✅ 可读仓库"

echo "→ 3) 令牌在该仓库的实际权限"
printf '%s' "$REPO_JSON" | python3 -c "
import json,sys
d = json.load(sys.stdin)
p = d.get('permissions', {})
print('   private       :', d.get('private'))
print('   default_branch:', d.get('default_branch'))
print('   permissions.push    :', p.get('push'))
print('   permissions.maintain:', p.get('maintain'))
print('   permissions.admin   :', p.get('admin'))
print('   permissions.pull    :', p.get('pull'))
if p.get('push'):
    print()
    print('   >>> 令牌具备写权限。若 git push 仍报 403，问题不在令牌，而在 git 协议层。')
else:
    print()
    print('   >>> 令牌只有读权限。请编辑该令牌的 Repository permissions，')
    print('       把 Contents 改为 \"Read and write\"、Workflows 改为 \"Read and write\"，')
    print('       并确认 Repository access 已勾选该仓库，然后保存。')
"

echo "→ 4) 账号自身对该仓库的角色（用令牌之外的视角：令牌有效即代表账号）"
printf '%s' "$REPO_JSON" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('   owner type:', (d.get('owner') or {}).get('type'), '| login:', (d.get('owner') or {}).get('login'))
"

unset PAT USER_JSON REPO_JSON
echo
echo "（诊断完成，令牌未写入任何存储）"
