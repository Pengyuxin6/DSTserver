#!/usr/bin/env bash
# DSTserver 一键卸载（保留存档与模组，可随时重装）
set -euo pipefail
DST_USER="${DST_USER:-steam}"
DST_HOME="${DST_HOME:-/home/steam}"

if [ "$(id -u)" -ne 0 ]; then echo "请用 root 或 sudo 运行"; exit 1; fi

echo "停止并禁用服务…"
systemctl disable --now dst-panel dst-steam-guard.timer 2>/dev/null || true
su - "$DST_USER" -s /bin/bash -c 'screen -S dst_master -X quit; screen -S dst_caves -X quit' 2>/dev/null || true

rm -f /etc/systemd/system/dst-panel.service \
      /etc/systemd/system/dst-steam-guard.service \
      /etc/systemd/system/dst-steam-guard.timer \
      /usr/local/sbin/dst-steam-guard.sh \
      /etc/sudoers.d/dst-panel \
      /etc/nginx/conf.d/dst-panel.conf
systemctl daemon-reload
systemctl reload nginx 2>/dev/null || true

echo "已卸载面板与服务。"
echo "保留内容（不需要可手动删除）:"
echo "  游戏服务端:  $DST_HOME/dst_server"
echo "  存档:        $DST_HOME/.klei"
echo "  模组仓库:    $DST_HOME/dst_mods"
echo "  面板目录:    $DST_HOME/dst_panel"
