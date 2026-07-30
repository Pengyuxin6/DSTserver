#!/usr/bin/env bash
set -e

echo "=== 更新饥荒联机版专用服务器 ==="

STEAMCMD="/home/steam/steamcmd/steamcmd.sh"
INSTALL_DIR="/home/steam/dst_server"
PANEL_CONFIG="/home/steam/dst_panel/panel_config.json"

# 读取管理面板的内测设置（基本设置页「是否为内测」+ 内测分支）
BETA_ARGS=""
if [ -f "$PANEL_CONFIG" ]; then
  if grep -q '"beta"[[:space:]]*:[[:space:]]*true' "$PANEL_CONFIG"; then
    BRANCH=$(grep -o '"betaBranch"[[:space:]]*:[[:space:]]*"[^"]*"' "$PANEL_CONFIG" | sed 's/.*"\([^"]*\)"$/\1/')
    BETA_ARGS="-beta ${BRANCH:-public}"
    echo "[内测模式] 已开启，使用分支: ${BRANCH:-public}"
  fi
fi

"$STEAMCMD" +force_install_dir "$INSTALL_DIR" +login anonymous +app_update 343050 $BETA_ARGS validate +quit

echo ""
echo "=== 更新完成 ==="
echo "如需重启服务器，请执行:"
echo "  /home/steam/stop_dst.sh"
echo "  /home/steam/start_dst.sh"
