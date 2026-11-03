#!/usr/bin/env bash
# Push to a branch and check that the branch actually moved.
#
# Pushing to `HEAD:refs/<name>` creates a reference of its own, which is
# not the branch: the branch stays where it was and the checks that watch
# the branch never see the change. It looks like it worked — the output
# says the reference was updated — while the branch is untouched.
#
# So the reference is spelled out in full, and the branch is asked
# afterwards where it ended up. If the two differ, the push did not do
# what it said.
#
# Usage: scripts/push-branch.sh [branch]

set -euo pipefail

BRANCH="${1:-fix/shopee-brand-portal-modern-oauth-20261027}"
REMOTE="https://github.com/Hitech-Global/psi-inventory.git"
# 去掉协议前缀，留下的就是主机与路径。
REMOTE_HOST="${REMOTE#https://}"

USERNAME="martin0000118-dev"
PASSWORD="$(printf 'protocol=https\nhost=github.com\n\n' | git credential-osxkeychain get | sed -n 's/^password=//p')"
if [ -z "$PASSWORD" ]; then
  echo "没有可用的 GitHub 凭据。" >&2
  exit 1
fi

LOCAL="$(git rev-parse HEAD)"
echo "本地 HEAD: ${LOCAL:0:10}"

GIT_TERMINAL_PROMPT=0 git push \
  "https://${USERNAME}:${PASSWORD}@${REMOTE_HOST}" \
  "HEAD:refs/heads/${BRANCH}" 2>&1 | tail -2

REMOTE_HEAD="$(git ls-remote "https://${USERNAME}:${PASSWORD}@${REMOTE_HOST}" "refs/heads/${BRANCH}" | cut -f1)"
if [ -z "$REMOTE_HEAD" ]; then
  echo "❌ 远端没有分支 ${BRANCH}" >&2
  exit 1
fi
if [ "${REMOTE_HEAD:0:10}" != "${LOCAL:0:10}" ]; then
  echo "❌ 分支仍在 ${REMOTE_HEAD:0:10}，本地是 ${LOCAL:0:10} —— 推的不是这个分支" >&2
  exit 1
fi
echo "✅ 分支 ${BRANCH} 已是 ${REMOTE_HEAD:0:10}"
