#!/bin/bash
# dst-steam-guard —— 保证饥荒面板与服务端只以 steam 用户身份运行
# 1) 杀掉非 steam 用户运行的 dst_panel (bun) 进程
# 2) 杀掉非 steam 用户运行的 DST 服务端/screen 进程
# 3) 修复饥荒相关目录中被 root 创建的文件属主

kill_non_steam() {
  local pattern="$1" desc="$2"
  local pid owner
  pgrep -f "$pattern" 2>/dev/null | while read -r pid; do
    owner=$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ -n "$owner" ] && [ "$owner" != "steam" ]; then
      kill "$pid" 2>/dev/null
      logger -t dst-steam-guard "killed non-steam $desc pid=$pid owner=$owner"
    fi
  done
}

kill_non_steam 'bun run src/server.ts' "panel"
kill_non_steam 'dontstarve_dedicated_server_nullrenderer' "dst-server"
kill_non_steam 'SCREEN -dmS dst_' "dst-screen"

# 修复属主（只处理属主为 root 的文件，开销小）
find /home/steam/.klei /home/steam/dst_mods /home/steam/dst_panel /home/steam/dst_server/ugc_mods /home/steam/dst_server/mods -user root -exec chown steam:steam {} + 2>/dev/null
