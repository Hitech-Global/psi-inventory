#!/usr/bin/env python3
"""
通过 Desktop Commander Remote MCP 与 Hitech 台式机对话。

用法：
  python3 scripts/dc.py devices                          # 列出设备
  python3 scripts/dc.py run "<命令>"                      # 执行命令（PowerShell）
  python3 scripts/dc.py ps "<命令>"                       # 执行命令（cmd）
  python3 scripts/dc.py ls "<Windows路径>"                # 列目录
  python3 scripts/dc.py cat "<Windows文件路径>"            # 读文件
  python3 scripts/dc.py info "<Windows路径>"               # 文件信息

说明：
- 命令输出写到设备上的临时文件，再读回 —— 因为服务端要等命令结束才回响应，
  长命令会让单次 HTTP 请求挂住。
- 路径用 Windows 形式。台式机用户目录是 C:\\Users\\hitec。
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

ENDPOINT = "https://mcp.desktopcommander.app/mcp"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")
DEVICE_NAME = "Hitech台式"
# 临时输出放在生产项目的 runtime 目录：那里一定可写，
# 而用户目录下建子目录会被 Windows 的受控文件夹访问挡掉。
OUT_DIR = r"D:\电商数据分析系统\psi-inventory-feishu-auth\shopee-analytics\deploy\desktop\runtime"

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE


_DEVICE_FILE = os.path.expanduser("~/.desktop-commander-device/device.json")


def _device_file():
    if not os.path.exists(_DEVICE_FILE):
        raise SystemExit(
            "找不到设备授权。请先在本机运行：\n"
            "  npx -y @wonderwhy-er/desktop-commander@latest remote"
        )
    with open(_DEVICE_FILE, encoding="utf-8") as fh:
        return json.load(fh)


def _token():
    return _device_file()["session"]["access_token"]


def _refresh_token():
    """
    Renew the access token.

    It lasts an hour and the device renews it for itself, but the copy on
    this machine is not always the one that gets renewed — the device
    writes its own file, and this one is shared with it. So the token
    here can lapse while the device is perfectly well online, and the only
    sign of it is that requests start being refused.

    The refresh token lasts far longer and is kept in the same place, so
    the lapse is repaired here rather than by asking for the device to be
    restarted.
    """
    device = _device_file()
    refresh = device.get("session", {}).get("refresh_token")
    if not refresh:
        return None
    try:
        req = urllib.request.Request(
            "https://mcp.desktopcommander.app/api/mcp-info",
            headers={"User-Agent": UA},
        )
        info = json.loads(urllib.request.urlopen(req, timeout=25, context=_ctx).read())
        body = json.dumps({"grant_type": "refresh_token", "refresh_token": refresh}).encode()
        req2 = urllib.request.Request(
            f"{info['supabaseUrl']}/auth/v1/token?grant_type=refresh_token",
            data=body,
            headers={
                "Content-Type": "application/json",
                "apikey": info["supabasePublishableKey"],
                "Authorization": f"Bearer {refresh}",
                "User-Agent": UA,
            },
        )
        data = json.loads(urllib.request.urlopen(req2, timeout=30, context=_ctx).read())
        if not data.get("access_token"):
            return None
        device["session"]["access_token"] = data["access_token"]
        if data.get("refresh_token"):
            device["session"]["refresh_token"] = data["refresh_token"]
        with open(_DEVICE_FILE, "w", encoding="utf-8") as fh:
            json.dump(device, fh, indent=2)
        os.chmod(_DEVICE_FILE, 0o600)
        return data["access_token"]
    except Exception:
        return None


def _post(payload, timeout=60, retries=3):
    last = None
    renewed = False
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
        except urllib.error.HTTPError as exc:
            # 401 means the token has lapsed, not that the device is gone:
            # renewing it is worth one attempt before giving up.
            if exc.code == 401 and not renewed:
                renewed = True
                if _refresh_token():
                    continue
            last = exc
            time.sleep(3 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError, ssl.SSLError) as exc:
            last = exc
            time.sleep(3 * (attempt + 1))
    raise SystemExit(f"连接远程服务失败：{last}")


def _text(data):
    result = data.get("result", {})
    texts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
    return "\n".join(texts) if texts else json.dumps(result, ensure_ascii=False)


def _tool(name, args=None, timeout=60):
    return _text(_post({
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {"name": name, "arguments": args or {}},
    }, timeout))


def call(name, args=None, timeout=60):
    """调用工具；异步结果自动轮询到完成。"""
    text = _tool(name, args, timeout)
    if "call_id=" in text:
        call_id = text.split('call_id="', 1)[1].split('"', 1)[0]
        for _ in range(20):
            time.sleep(4)
            text = _tool("get_tool_result", {"call_id": call_id}, timeout)
            if "still running" not in text:
                break
    return text


def _devices():
    """返回 {设备名: 设备id}，顺带打印状态。"""
    text = call("list_devices")
    devices = {}
    current = None
    for line in text.splitlines():
        stripped = line.strip()
        # 设备名行形如 "1. Hitech台式"
        if stripped and stripped[0].isdigit() and "." in stripped[:4]:
            current = stripped.split(".", 1)[1].strip()
        if "ID:" in line and current:
            devices[current] = line.split("ID:")[1].strip()
    return text, devices


def _device_id(explicit=None):
    text, devices = _devices()
    if explicit:
        return explicit, text
    for name, dev_id in devices.items():
        if DEVICE_NAME in name:
            return dev_id, text
    raise SystemExit(f"找不到设备「{DEVICE_NAME}」。当前账号下的设备：\n{text}")


def run_command(command, device=None, shell="powershell", timeout_ms=120000):
    """
    在设备上执行命令并取回输出。

    Windows 上不能用脚本文件带命令：脚本按系统 ANSI 码页解码，
    中文路径会变成乱码。因此把命令编码成 UTF-16LE 的 base64，
    交给 powershell -EncodedCommand —— PowerShell 原生按 UTF-16LE 解码，
    中文路径不会错。
    """
    import base64

    if device is None:
        device, _ = _device_id()
        print(f"[设备] {DEVICE_NAME} ({device})", file=sys.stderr)

    if shell == "powershell":
        inner = command
    else:
        inner = f"cmd /c {command}"

    # 每次用独立的输出文件：并发调用时共用一个文件会互相覆盖，
    # 结果就串到别的命令上。
    out_file = f"{OUT_DIR}\\dc-{os.getpid()}-{int(time.time()*1000)}.txt"

    # 采集输出与退出码。路径本身是 ASCII，不受编码影响。
    script = (
        "$ErrorActionPreference='Continue'\n"
        "New-Item -ItemType Directory -Force -Path '" + OUT_DIR + "' | Out-Null\n"
        f"$out = & {{ {inner} }} 2>&1 | Out-String\n"
        f"[IO.File]::WriteAllText('{out_file}', $out)\n"
        f"[IO.File]::AppendAllText('{out_file}', \"`n__EXIT__$LASTEXITCODE`n\")\n"
    )
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    call("start_process", {
        "command": f"powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand {encoded}",
        "timeout_ms": 10000,
        "deviceId": device,
    })

    for _ in range(40):
        time.sleep(3)
        text = call("read_file", {"path": out_file, "deviceId": device})
        if "__EXIT__" in text:
            body, _, tail = text.partition("__EXIT__")
            code = next((x.strip() for x in tail.splitlines() if x.strip()), "?")
            lines = body.splitlines()
            if lines and lines[0].startswith("[Reading"):
                lines = lines[1:]
            print("\n".join(lines).strip())
            print(f"[exit {code}]")
            return
    print("[超时] 命令未在预期时间内完成")


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    cmd = args[0]

    if cmd == "devices":
        text, _ = _devices()
        print(text)
        return

    if cmd == "run" and len(args) > 1:
        run_command(args[1], shell="powershell")
        return
    if cmd == "ps" and len(args) > 1:
        run_command(args[1], shell="cmd")
        return
    if cmd == "ls" and len(args) > 1:
        device, _ = _device_id()
        print(call("list_directory", {"path": args[1], "deviceId": device}))
        return
    if cmd == "cat" and len(args) > 1:
        device, _ = _device_id()
        print(call("read_file", {"path": args[1], "deviceId": device}))
        return
    if cmd == "info" and len(args) > 1:
        device, _ = _device_id()
        print(call("get_file_info", {"path": args[1], "deviceId": device}))
        return

    print(__doc__)


if __name__ == "__main__":
    main()
