#!/bin/bash
# 进销存系统 - 本地启动脚本（在 Mac 终端运行，常驻不受 WorkBuddy 沙箱影响）
cd "$(dirname "$0")"
# 优先用 WorkBuddy 托管 node22（与已编译的 better-sqlite3 ABI127 匹配）；不存在则回退系统 node
NODE=/Users/a1-6/.workbuddy/binaries/node/versions/22.22.2/bin/node
[ -x "$NODE" ] || NODE=node
PORT=3001 "$NODE" server.js
