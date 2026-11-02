#!/usr/bin/env python3
"""
在远程设备上执行长时命令，并把输出写入日志供轮询。

用法：
  python3 scripts/dc-long.py start "<工作目录>" "<命令>"   # 后台启动，返回日志路径
  python3 scripts/dc-long.py log "<日志路径>"              # 读日志
  python3 scripts/dc-long.py wait "<日志路径>" "<完成标记>"   # 等到出现标记

原因：远程服务要等命令结束才回响应，构建镜像这类命令会跑好几分钟，
把请求挂在那里既超时又看不到进展。改成设备上后台跑、日志落盘，
这边轮询日志。
"""

import json
import os
import ssl
import sys
import time
import urllib.request

ENDPOINT = "https://mcp.desktopcommander.app/mcp"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")
LOG_DIR = r"C:\Users\hitech\dc-tmp"

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE


def _token():
    with open(os.path.expanduser("~/.desktop-commander-device/device.json"), encoding="utf-8") as fh:
        return json.load(fh)["session"]["access_token"]


def _post(payload, timeout=60, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                ENDPOINT,
                data=json.dumps(payload).encode(),
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    "Authorization": f"Bearer {_token()}",
                    "User-Agent": UA,
                    "MCP-Protocol-Version": "2024-11-05",
                },
            )
            resp = urllib.request.urlopen(req, timeout=timeout, context=_ctx)
            body = resp.read().decode("utf-8", "replace")
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                if "data: " in body:
                    return json.loads(body.split("data: ", 1)[1].split("\n\n")[0])
                raise
        except Exception as exc:
            last = exc
            time.sleep(3 * (attempt + 1))
    raise SystemExit(f"连接失败：{last}")


def _text(data):
    result = data.get("result", {})
    texts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
    return "\n".join(texts) if texts else json.dumps(result, ensure_ascii=False)


def call(name, args=None, timeout=60):
    text = _text(_post({
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {"name": name, "arguments": args or {}},
    }, timeout))
    if "call_id=" in text:
        call_id = text.split('call_id="', 1)[1].split('"', 1)[0]
        for _ in range(20):
            time.sleep(4)
            text = _text(_post({
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": {"name": "get_tool_result", "arguments": {"call_id": call_id}},
            }, timeout))
            if "still running" not in text:
                break
    return text


def device_id():
    text = call("list_devices")
    current = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and stripped[0].isdigit() and "." in stripped[:4]:
            current = stripped.split(".", 1)[1].strip()
        if "ID:" in line and current and "Hitech" in current:
            return line.split("ID:")[1].strip()
    raise SystemExit(f"找不到 Hitech台式：\n{text}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    action = sys.argv[1]
    dev = device_id()

    if action == "start":
        workdir = sys.argv[2]
        command = sys.argv[3]
        stamp = int(time.time() * 1000)
        log = f"{LOG_DIR}\\run-{stamp}.log"
        # 用 PowerShell 脚本包一层并自己重定向。cmd 的重定向经由远程服务传过去时
        # 引号会被吃掉，输出不落盘；PowerShell 内部重定向是可靠的。
        script = (
            "$ErrorActionPreference='Continue'\n"
            "New-Item -ItemType Directory -Force -Path '" + LOG_DIR + "' | Out-Null\n"
            f"Set-Location '{workdir}'\n"
            f"$out = & {{ {command} }} 2>&1 | Out-String\n"
            f"[IO.File]::WriteAllText('{log}', $out + \"`n__DONE__`$LASTEXITCODE`n\")\n"
        )
        call("write_file", {"path": f"{LOG_DIR}\\run-{stamp}.ps1", "content": script, "deviceId": dev})
        call("start_process", {
            "command": f'powershell -NoProfile -ExecutionPolicy Bypass -File "{LOG_DIR}\\run-{stamp}.ps1"',
            "timeout_ms": 8000,
            "deviceId": dev,
        })
        print(log)
        return

    if action == "log":
        path = sys.argv[2]
        print(call("read_file", {"path": path, "deviceId": dev}))
        return

    if action == "wait":
        path = sys.argv[2]
        marker = sys.argv[3] if len(sys.argv) > 3 else "__DONE__"
        tries = int(sys.argv[4]) if len(sys.argv) > 4 else 60
        for _ in range(tries):
            time.sleep(5)
            try:
                text = call("read_file", {"path": path, "deviceId": dev})
            except Exception:
                continue
            if marker in text:
                lines = text.splitlines()
                if lines and lines[0].startswith("[Reading"):
                    lines = lines[1:]
                print("\n".join(lines))
                return
        print("[超时] 未等到完成标记")
        return

    print(__doc__)


if __name__ == "__main__":
    main()
