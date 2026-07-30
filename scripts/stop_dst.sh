#!/usr/bin/env bash

echo "=== 停止饥荒联机版专用服务器 ==="

# 停止 screen 会话中的服务端进程
screen -S dst_master -X quit 2>/dev/null && echo "[OK] 地面世界 (Master) 已停止" || echo "[跳过] 地面世界未在运行"
screen -S dst_caves -X quit 2>/dev/null && echo "[OK] 洞穴世界 (Caves) 已停止" || echo "[跳过] 洞穴世界未在运行"

# 兜底：直接杀进程
pkill -f "dontstarve_dedicated_server_nullrenderer.*Master" 2>/dev/null || true
pkill -f "dontstarve_dedicated_server_nullrenderer.*Caves" 2>/dev/null || true

echo "=== 服务器已停止 ==="
