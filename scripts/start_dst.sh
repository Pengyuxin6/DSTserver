#!/usr/bin/env bash
set -e

INSTALL_DIR="/home/steam/dst_server"
# 从面板配置读取集群名称，若不存在则回退到 MyDediServer
CLUSTER="MyDediServer"
PANEL_CONFIG="/home/steam/dst_panel/panel_config.json"
if [ -f "$PANEL_CONFIG" ]; then
  PARSED=$(grep -o '"cluster"\s*:\s*"[^"]*"' "$PANEL_CONFIG" | head -1 | sed 's/.*"cluster"\s*:\s*"//;s/"//')
  if [ -n "$PARSED" ]; then
    CLUSTER="$PARSED"
  fi
fi
BIN=""
BINDIR=""

# 自动检测 64 位或 32 位可执行文件
if [ -f "$INSTALL_DIR/bin64/dontstarve_dedicated_server_nullrenderer_x64" ]; then
  BIN="$INSTALL_DIR/bin64/dontstarve_dedicated_server_nullrenderer_x64"
  BINDIR="$INSTALL_DIR/bin64"
elif [ -f "$INSTALL_DIR/bin/dontstarve_dedicated_server_nullrenderer_x64" ]; then
  BIN="$INSTALL_DIR/bin/dontstarve_dedicated_server_nullrenderer_x64"
  BINDIR="$INSTALL_DIR/bin"
elif [ -f "$INSTALL_DIR/bin/dontstarve_dedicated_server_nullrenderer" ]; then
  BIN="$INSTALL_DIR/bin/dontstarve_dedicated_server_nullrenderer"
  BINDIR="$INSTALL_DIR/bin"
else
  echo "[错误] 未找到 DST 服务端可执行文件，请确认服务端已安装。"
  exit 1
fi

cd "$BINDIR"

echo "=== 启动饥荒联机版专用服务器 ==="
echo "可执行文件: $BIN"
echo "集群名称: $CLUSTER"
echo ""

# 启动地面世界 (Master)
screen -dmS dst_master "$BIN" -cluster "$CLUSTER" -shard Master
echo "[OK] 地面世界 (Master) 已在 screen 会话 dst_master 中启动"

# 启动洞穴世界 (Caves)
screen -dmS dst_caves "$BIN" -cluster "$CLUSTER" -shard Caves
echo "[OK] 洞穴世界 (Caves) 已在 screen 会话 dst_caves 中启动"

echo ""
echo "=== 启动完成 ==="
echo "查看地面世界控制台: screen -r dst_master"
echo "查看洞穴世界控制台: screen -r dst_caves"
echo "从 screen 中退出 (不关闭服务器): 按 Ctrl+A 然后按 D"
echo ""
echo "停止服务器: /home/steam/stop_dst.sh"
