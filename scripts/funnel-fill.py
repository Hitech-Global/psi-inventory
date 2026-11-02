#!/usr/bin/env python3
"""
在 Hitech 台式机上跑：授权状态检查 → 历史回填 → 漏斗数据验证。

用法（在台式机上执行，或通过 scripts/dc.py 转发）：
  python3 scripts/funnel-fill.py --check
  python3 scripts/funnel-fill.py --fill 2026-08-01 2026-11-01
  python3 scripts/funnel-fill.py --verify

说明：
- 回填走系统自带的 POST /data/sync-range（sources: shop-bi, returns），
  不直接调 API —— 走同一条路径才能保证游标与状态记录正确。
- 需要超级管理员会话才能触发回填；脚本在容器内直接调用服务层，
  绕开 HTTP 鉴权，仅在台式机本地执行。
"""

import json
import os
import sys
import urllib.request

BASE = "http://127.0.0.1:3090"
SHOPS = {"1326456001": "Shop 1326456001 (ID)", "1770037299": "Shop 1770037299 (MY)"}


def post(path, body, timeout=600):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def get(path, timeout=60):
    req = urllib.request.Request(f"{BASE}{path}", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def check():
    """授权状态与前置条件。"""
    print("=== 授权状态 ===")
    for shop_id in SHOPS:
        for role, path in (("ERP", "/erp/status"), ("BRAND_PORTAL", "/brand-portal/status")):
            try:
                status = get(f"/api/shopee-analytics{path}?shop_id={shop_id}")
            except Exception as exc:
                print(f"  {shop_id} {role:14s} 查询失败: {exc}")
                continue
            credential = status.get("credentialConfigured")
            token = status.get("tokenPresent")
            redirect = bool(status.get("redirectUrl"))
            principal = status.get("principalId")
            mark = "✅ 已就绪" if token else ("⚠️ 待授权" if credential and redirect else "❌ 配置缺失")
            extra = f" principal={principal}" if principal else ""
            print(f"  {shop_id} {role:14s} {mark}  凭据={'有' if credential else '无'} "
                  f"token={'有' if token else '无'} 回调={'已配' if redirect else '未配'}{extra}")
    print()
    print("提示：授权入口在「店铺诊断」页的「连接 ERP」/「连接 Brand Portal」按钮。")
    print("      两者都需要超级管理员身份。")


def fill(start_date, end_date, shop_ids=None, sources=("shop-bi", "returns")):
    """触发历史回填。"""
    targets = shop_ids or list(SHOPS)
    for shop_id in targets:
        print(f"=== 回填 {shop_id} {start_date} → {end_date} sources={list(sources)} ===")
        try:
            result = post("/api/shopee-analytics/data/sync-range", {
                "shop_id": int(shop_id),
                "start_date": start_date,
                "end_date": end_date,
                "sources": list(sources),
            })
        except Exception as exc:
            print(f"  ❌ 失败: {exc}")
            continue
        summary = result.get("summary", {})
        print(f"  ok={result.get('ok')}")
        for step in summary.get("steps", []):
            flag = "✅" if step.get("ok") else ("⏭" if step.get("skipped") else "❌")
            detail = step.get("error") or step.get("skipped") or ""
            print(f"    {flag} {step.get('name'):26s} {detail}")
        print()


def verify():
    """看漏斗接口现在的输出。"""
    for shop_id in SHOPS:
        try:
            data = get(
                f"/api/shopee-analytics/funnel?shop_id={shop_id}"
                "&start_date=2026-08-01&end_date=2026-11-01"
            )
        except Exception as exc:
            print(f"  {shop_id} 查询失败: {exc}")
            continue
        dates = data.get("dates", [])
        rows = data.get("rows", [])
        print(f"=== {shop_id} {data.get('shop', {}).get('displayName')} ({len(dates)} 天) ===")
        for row in rows:
            values = row.get("values", [])
            filled = sum(1 for v in values if v is not None)
            print(f"  {row.get('label'):18s} {filled:>3}/{len(values)} 有数据")
        missing = data.get("missingSources", [])
        if missing:
            print("  未就绪的数据源：")
            for entry in missing:
                print(f"    - {entry['source']} → {', '.join(entry['metrics'])}")
        print()


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "--check"
    if action == "--check":
        check()
    elif action == "--fill":
        start = sys.argv[2] if len(sys.argv) > 2 else "2026-08-01"
        end = sys.argv[3] if len(sys.argv) > 3 else "2026-11-01"
        fill(start, end)
    elif action == "--verify":
        verify()
    else:
        print(__doc__)
