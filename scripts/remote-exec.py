#!/usr/bin/env python3
"""
通过 Desktop Commander Remote MCP 在已授权的设备上执行命令。

用法：
  python3 scripts/remote-exec.py "命令"                 # 在默认设备上执行
  python3 scripts/remote-exec.py --device <id> "命令"     # 指定设备
  python3 scripts/remote-exec.py --list                   # 列出设备
  python3 scripts/remote-exec.py --read <pid>             # 读某个进程的输出

实现要点：
- 服务端的工具调用是异步的：先返回 call_id，结果要再用 get_tool_result 取。
- start_process 的 HTTP 响应要等命令结束才回来，因此放到后台线程里发，
  主线程只轮询结果，避免整条链路被单个长请求卡住。
- 命令输出由设备侧写入临时文件，再读回来 —— 这样即使命令本身是长驻的，
  也能拿到中间输出。
"""

import json
import os
import ssl
import sys
import threading
import time
import urllib.request

ENDPOINT = "https://mcp.desktopcommander.app/mcp"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")
REMOTE_OUT = os.path.expanduser("~/dc-remote-out.txt")
REMOTE_SH = os.path.expanduser("~/dc-remote-cmd.sh")

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE


def _token():
    path = os.path.expanduser("~/.desktop-commander-device/device.json")
    if not os.path.exists(path):
        raise SystemExit(
            "找不到设备授权文件。请在目标机器上运行：\n"
            "  npx -y @wonderwhy-er/desktop-commander@latest remote\n"
            "并在浏览器里完成授权。"
        )
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["session"]["access_token"]


def _post(payload, timeout=40):
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


def _text(data):
    result = data.get("result", {})
    texts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
    return "\n".join(texts) if texts else json.dumps(result, ensure_ascii=False)


def _tool(name, args=None, timeout=40):
    return _text(_post({
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {"name": name, "arguments": args or {}},
    }, timeout))


def _await_result(call_id, tries=40, gap=3):
    """轮询异步结果。"""
    for _ in range(tries):
        time.sleep(gap)
        text = _tool("get_tool_result", {"call_id": call_id}, 40)
        if "still running" not in text:
            return text
    return "[超时] 结果未在预期时间内返回"


def _call_async(name, args=None, timeout=40):
    """发起调用；若返回 call_id 就等它完成，返回最终文本。"""
    text = _tool(name, args, timeout)
    if "call_id=" in text:
        call_id = text.split('call_id="', 1)[1].split('"', 1)[0]
        return _await_result(call_id)
    return text


def _background(name, args=None):
    """在后台线程里发起调用，主线程不等它。"""
    def run():
        try:
            _post({
                "jsonrpc": "2.0", "id": 9, "method": "tools/call",
                "params": {"name": name, "arguments": args or {}},
            }, 180)
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()


def run_command(command, device=None, wait=120):
    """
    执行命令并取回输出。

    设备侧把输出写进文件，本侧再读回。写与执行都用后台线程发，
    因为服务端要等命令结束才回 HTTP 响应；读取则同步轮询。
    """
    device_args = {"deviceId": device} if device else {}

    script = f"#!/bin/sh\n{command}\necho __EXIT__$?\n"
    _background("write_file", {**device_args, "path": REMOTE_SH, "content": script})
    time.sleep(3)

    _background("start_process", {
        **device_args,
        "command": f"nohup sh {REMOTE_SH} > {REMOTE_OUT} 2>&1 &",
        "timeout_ms": 8000,
    })
    time.sleep(3)

    for _ in range(max(wait // 3, 1)):
        try:
            text = _call_async("read_file", {**device_args, "path": REMOTE_OUT}, 40)
        except Exception:
            time.sleep(3)
            continue
        if "__EXIT__" in text:
            body, _, tail = text.partition("__EXIT__")
            code = next((line.strip() for line in tail.splitlines() if line.strip()), "?")
            # 去掉 read_file 加的 "[Reading N lines from start ...]" 头
            lines = body.splitlines()
            if lines and lines[0].startswith("[Reading"):
                lines = lines[1:]
            print("\n".join(lines).strip())
            print(f"[exit {code}]")
            return
        time.sleep(3)
    print("[超时] 命令未在预期时间内完成")


def main():
    args = sys.argv[1:]
    device = None
    if "--device" in args:
        idx = args.index("--device")
        device = args[idx + 1]
        args = args[:idx] + args[idx + 2:]
    if "--list" in args:
        print(_call_async("list_devices"))
        return
    if "--read" in args:
        idx = args.index("--read")
        print(_call_async("read_process_output", {"pid": int(args[idx + 1])}))
        return
    if not args:
        print(__doc__)
        return
    run_command(args[0], device)


if __name__ == "__main__":
    main()
