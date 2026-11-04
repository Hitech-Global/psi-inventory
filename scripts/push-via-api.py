#!/usr/bin/env python3
"""Push the current branch to GitHub through the API.

The git protocol talks to github.com; the API talks to api.github.com.
When a proxy lets one through and not the other — which happened with a
502 from the tunnel — `git push` fails while the API still works. This
pushes the same way, over the API, so the work goes out either way.

The commits are made through the API, which means the history of the
branch is rewritten as one commit carrying everything that was not yet
on the server. The tree is built on the server's own tree, so only the
files that changed are sent.

Usage: scripts/push-via-api.py [branch]
"""

import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

REPO = "Hitech-Global/psi-inventory"
API = "https://api.github.com"


def credentials():
    out = subprocess.run(
        ["git", "credential-osxkeychain", "get"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True, text=True, check=True,
    ).stdout
    for line in out.splitlines():
        if line.startswith("password="):
            return line[len("password="):].strip()
    raise SystemExit("没有可用的 GitHub 凭据。")


TOKEN = credentials()


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        API + path, data=data, method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "workbuddy-push-via-api",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode()[:400]
        raise SystemExit(f"{method} {path} → HTTP {error.code}\n{detail}")


def git(*args):
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True,
    ).stdout.strip()


def main():
    branch = sys.argv[1] if len(sys.argv) > 1 else git("rev-parse", "--abbrev-ref", "HEAD")
    local = git("rev-parse", "HEAD")
    message = git("log", "-1", "--pretty=%B").strip()

    reference = call("GET", f"/repos/{REPO}/git/ref/heads/{branch}")
    remote = reference["object"]["sha"]
    remote_commit = call("GET", f"/repos/{REPO}/git/commits/{remote}")
    base_tree = remote_commit["tree"]["sha"]

    if remote == local:
        print(f"分支 {branch} 已是 {local[:10]}")
        return

    # Only the files that differ are sent; the rest of the tree is the
    # server's own.
    changed = [
        line for line in git("diff", "--name-only", remote, local).splitlines() if line.strip()
    ]
    if not changed:
        print("没有文件差异。")
        return

    entries = []
    for path in changed:
        with open(path, "rb") as handle:
            content = handle.read()
        blob = call("POST", f"/repos/{REPO}/git/blobs", {
            "content": base64.b64encode(content).decode(),
            "encoding": "base64",
        })
        entries.append({
            "path": path,
            "mode": "100644",
            "type": "blob",
            "sha": blob["sha"],
        })

    tree = call("POST", f"/repos/{REPO}/git/trees", {
        "base_tree": base_tree,
        "tree": entries,
    })
    commit = call("POST", f"/repos/{REPO}/git/commits", {
        "message": message,
        "tree": tree["sha"],
        "parents": [remote],
    })
    call("PATCH", f"/repos/{REPO}/git/refs/heads/{branch}", {
        "sha": commit["sha"],
        "force": False,
    })

    check = call("GET", f"/repos/{REPO}/git/ref/heads/{branch}")["object"]["sha"]
    if check != commit["sha"]:
        raise SystemExit(f"分支仍在 {check[:10]}，推的不是这个分支")
    print(f"✅ 分支 {branch} 已是 {check[:10]}（{len(changed)} 个文件）")


if __name__ == "__main__":
    main()
