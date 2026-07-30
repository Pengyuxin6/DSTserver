#!/usr/bin/env bash
# =============================================================
#  DSTserver 饥荒联机版专用服务器 + Web 管理面板 一键安装脚本
#  支持: Debian/Ubuntu (apt) / CentOS-Rocky-Alma (dnf|yum) / Arch (pacman) / openSUSE (zypper)
#  用法:
#    sudo bash install.sh                     # 交互式安装（推荐）
#    sudo bash install.sh --password 你的密码  # 指定 steam 用户密码（免交互）
#    sudo bash install.sh --skip-game         # 只装面板，不下载 3GB 游戏服务端
#    sudo bash install.sh --with-nginx        # 同时配置 nginx 80 端口 /dst/ 映射
# =============================================================
set -euo pipefail

# ---------- 可配置项（也可用同名环境变量覆盖） ----------
DST_USER="${DST_USER:-steam}"            # 运行用户
DST_HOME="${DST_HOME:-/home/steam}"      # 用户主目录（所有文件都在这里）
PANEL_PORT="${PANEL_PORT:-5323}"         # 面板监听端口（仅 127.0.0.1）
DST_PASS="${DST_PASS:-}"                 # 运行用户密码（空=交互询问/随机生成）
SKIP_GAME=0
WITH_NGINX=0

for arg in "$@"; do
  case "$arg" in
    --skip-game) SKIP_GAME=1 ;;
    --with-nginx) WITH_NGINX=1 ;;
    --password=*) DST_PASS="${arg#*=}" ;;
    --password) echo "--password 需要写成 --password=你的密码"; exit 1 ;;
    --user=*) DST_USER="${arg#*=}"; DST_HOME="/home/${DST_USER}" ;;
    --port=*) PANEL_PORT="${arg#*=}" ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数: $arg（用 --help 查看用法）"; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then echo "请用 root 或 sudo 运行: sudo bash install.sh"; exit 1; fi

log() { echo -e "\033[1;33m[DSTserver]\033[0m $*"; }
ok()  { echo -e "\033[1;32m[  OK  ]\033[0m $*"; }
warn(){ echo -e "\033[1;31m[注意!]\033[0m $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- 1. 识别发行版并安装依赖 ----------
log "步骤 1/8：安装系统依赖…"
PKG=""
if   command -v apt-get >/dev/null 2>&1; then PKG=apt
elif command -v dnf     >/dev/null 2>&1; then PKG=dnf
elif command -v yum     >/dev/null 2>&1; then PKG=yum
elif command -v pacman  >/dev/null 2>&1; then PKG=pacman
elif command -v zypper  >/dev/null 2>&1; then PKG=zypper
else warn "未识别的包管理器，请手动安装: curl unzip screen sudo tar xz"; fi

case "$PKG" in
  apt)
    export DEBIAN_FRONTEND=noninteractive
    dpkg --add-architecture i386 2>/dev/null || true
    apt-get update -qq
    apt-get install -y -qq curl unzip screen sudo tar xz-utils ca-certificates \
      lib32gcc-s1 lib32stdc++6 libcurl-gnutls4 2>/dev/null || \
    apt-get install -y -qq curl unzip screen sudo tar xz-utils ca-certificates lib32gcc-s1 lib32stdc++6
    ;;
  dnf|yum)
    $PKG install -y -q curl unzip screen sudo tar xz ca-certificates \
      glibc.i686 libstdc++.i686 libcurl.i686 2>/dev/null || \
    $PKG install -y -q curl unzip screen sudo tar xz ca-certificates
    ;;
  pacman)
    pacman -Sy --noconfirm --needed curl unzip screen sudo tar xz ca-certificates lib32-gcc-libs 2>/dev/null || \
    pacman -Sy --noconfirm --needed curl unzip screen sudo tar xz ca-certificates
    ;;
  zypper)
    zypper --non-interactive install -y curl unzip screen sudo tar xz ca-certificates 2>/dev/null || true
    ;;
esac
ok "依赖安装完成"

# ---------- 2. 创建运行用户并设置密码 ----------
log "步骤 2/8：创建运行用户 ${DST_USER}…"
if ! id "$DST_USER" >/dev/null 2>&1; then
  useradd -m -d "$DST_HOME" -s /bin/bash "$DST_USER"
  ok "用户 ${DST_USER} 已创建"
else
  ok "用户 ${DST_USER} 已存在"
fi
if [ -z "$DST_PASS" ]; then
  if [ -t 0 ]; then
    read -r -s -p "为 ${DST_USER} 设置密码（留空=随机生成）: " DST_PASS; echo
  fi
  if [ -z "$DST_PASS" ]; then
    DST_PASS="$(tr -dc 'A-Za-z0-9!@#%^&*-_=+' </dev/urandom | head -c 20)"
    log "已随机生成 ${DST_USER} 密码（最后会显示，请保存）"
  fi
fi
echo "${DST_USER}:${DST_PASS}" | chpasswd
ok "密码已设置"

# ---------- 3. 安装 Bun 运行时 ----------
log "步骤 3/8：安装 Bun…"
if ! command -v bun >/dev/null 2>&1; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  BUN_ZIP="bun-linux-x64.zip" ;;
    aarch64|arm64) BUN_ZIP="bun-linux-aarch64.zip" ;;
    *) echo "暂不支持的架构: $ARCH"; exit 1 ;;
  esac
  curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/latest/download/${BUN_ZIP}"
  unzip -o -q /tmp/bun.zip -d /tmp
  cp /tmp/bun-linux-*/bun /usr/local/bin/bun
  chmod +x /usr/local/bin/bun
  rm -f /tmp/bun.zip
fi
ok "Bun $(bun --version) 就绪"

# ---------- 4. 安装 SteamCMD + 游戏服务端 ----------
STEAMCMD_DIR="$DST_HOME/steamcmd"
SERVER_DIR="$DST_HOME/dst_server"
CLUSTER_DIR="$DST_HOME/.klei/DoNotStarveTogether/MyDediServer"

install -d -o "$DST_USER" -g "$DST_USER" "$STEAMCMD_DIR" "$SERVER_DIR" "$CLUSTER_DIR/Master" "$CLUSTER_DIR/Caves"

if [ ! -f "$STEAMCMD_DIR/steamcmd.sh" ]; then
  log "下载 SteamCMD…"
  curl -fsSL -o /tmp/steamcmd.tar.gz "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz"
  tar -xzf /tmp/steamcmd.tar.gz -C "$STEAMCMD_DIR"
  rm -f /tmp/steamcmd.tar.gz
  chown -R "$DST_USER:$DST_USER" "$STEAMCMD_DIR"
fi

if [ "$SKIP_GAME" -eq 0 ] && [ ! -f "$SERVER_DIR/bin64/dontstarve_dedicated_server_nullrenderer_x64" ]; then
  log "步骤 4/8：下载 DST 服务端（约 3GB，耐心等待）…"
  su - "$DST_USER" -s /bin/bash -c "'$STEAMCMD_DIR/steamcmd.sh' +force_install_dir '$SERVER_DIR' +login anonymous +app_update 343050 validate +quit"
  # 常见缺失库软链接
  if [ -f /usr/lib/x86_64-linux-gnu/libcurl-gnutls.so.4 ] && [ ! -e "$SERVER_DIR/bin64/libcurl-gnutls.so.4" ]; then
    ln -sf /usr/lib/x86_64-linux-gnu/libcurl-gnutls.so.4 "$SERVER_DIR/bin64/libcurl-gnutls.so.4" || true
  fi
else
  log "步骤 4/8：跳过游戏下载（--skip-game 或已安装）"
fi
ok "游戏服务端就绪"

# ---------- 5. 初始化存档配置 ----------
if [ ! -f "$CLUSTER_DIR/cluster.ini" ]; then
  log "生成默认存档配置…"
  su - "$DST_USER" -s /bin/bash -c "cat > '$CLUSTER_DIR/cluster.ini'" <<'EOF'
[GAMEPLAY]
game_mode = survival
max_players = 6
pvp = false
pause_when_empty = true
vote_kick_enabled = true

[NETWORK]
cluster_name = My DST Server
cluster_description = A dedicated server for friends
cluster_password =

[MISC]
console_enabled = true

[SHARD]
shard_enabled = true
bind_ip = 127.0.0.1
master_ip = 127.0.0.1
master_port = 10889
cluster_key = supersecretkey
EOF
fi
su - "$DST_USER" -s /bin/bash -c "cat > '$CLUSTER_DIR/Master/server.ini'" <<'EOF'
[NETWORK]
server_port = 11000

[SHARD]
is_master = true

[STEAM]
master_server_port = 27018
authentication_port = 8768

[ACCOUNT]
encode_user_path = true
EOF
su - "$DST_USER" -s /bin/bash -c "cat > '$CLUSTER_DIR/Caves/server.ini'" <<'EOF'
[NETWORK]
server_port = 11001

[SHARD]
is_master = false
name = Caves

[STEAM]
master_server_port = 27019
authentication_port = 8769

[ACCOUNT]
encode_user_path = true
EOF
if [ ! -f "$CLUSTER_DIR/cluster_token.txt" ]; then
  echo "# 在此粘贴 Klei 服务器令牌（在线模式必须，见 README 第 3 步）" > "$CLUSTER_DIR/cluster_token.txt"
fi
chown -R "$DST_USER:$DST_USER" "$DST_HOME/.klei"
ok "存档配置就绪: $CLUSTER_DIR"

# ---------- 6. 安装 Web 管理面板 ----------
log "步骤 5/8：安装 Web 管理面板…"
PANEL_DIR="$DST_HOME/dst_panel"
install -d -o "$DST_USER" -g "$DST_USER" "$PANEL_DIR" "$PANEL_DIR/data"
cp -r "$SCRIPT_DIR/panel/." "$PANEL_DIR/"
# 面板数据文件（字符串库/语言包/prefab 全集）从游戏 scripts.zip 提取
if [ -f "$SERVER_DIR/data/databundles/scripts.zip" ]; then
  su - "$DST_USER" -s /bin/bash -c "cd '$PANEL_DIR/data' && unzip -o -q -j '$SERVER_DIR/data/databundles/scripts.zip' 'scripts/strings.lua' 'scripts/languages/chinese_s.po' 2>/dev/null || true"
fi
# 原版 prefab 全集（面板识别模组新增物品用）
if [ -f "$SERVER_DIR/data/databundles/scripts.zip" ] && [ ! -f "$PANEL_DIR/data/vanilla_prefabs.json" ]; then
  su - "$DST_USER" -s /bin/bash -c "
    cd /tmp && rm -rf dst_prefab_x && mkdir dst_prefab_x && cd dst_prefab_x &&
    unzip -o -q '$SERVER_DIR/data/databundles/scripts.zip' 'scripts/prefabs/*.lua' &&
    cd scripts/prefabs &&
    { ls | sed 's/\.lua$//'; grep -ho 'Prefab(\"[a-z0-9_]*\"' *.lua | sed 's/Prefab(\"//'; } | sort -u > /tmp/dst_prefab_x/list.txt
  "
  su - "$DST_USER" -s /bin/bash -c "cd /tmp/dst_prefab_x && printf '[%s]\n' \"\$(sed 's/.*/\"&\"/' list.txt | paste -sd, -)\" > '$PANEL_DIR/data/vanilla_prefabs.json' && cd /tmp && rm -rf dst_prefab_x"
fi
# 面板登录密码：随机生成并保存
PANEL_PASS="$(tr -dc 'A-Za-z0-9!@#%^&*-_=+' </dev/urandom | head -c 20)"
install -m 600 -o "$DST_USER" -g "$DST_USER" /dev/null "$PANEL_DIR/.panel_password"
echo "$PANEL_PASS" > "$PANEL_DIR/.panel_password"
# 面板端口
sed -i "s/^const PORT = [0-9]*;/const PORT = ${PANEL_PORT};/" "$PANEL_DIR/src/server.ts" || true
chown -R "$DST_USER:$DST_USER" "$PANEL_DIR"
ok "面板安装完成"

# ---------- 7. 运维脚本 / systemd / sudoers / 看门狗 ----------
log "步骤 6/8：安装运维脚本与系统服务…"
cp "$SCRIPT_DIR/scripts/"*.sh "$DST_HOME/"
chmod +x "$DST_HOME/"*.sh
chown "$DST_USER:$DST_USER" "$DST_HOME/"*.sh

# dst-panel 服务（替换端口占位）
sed "s/ExecStart=.*/ExecStart=\/usr\/local\/bin\/bun run src\/server.ts/; s/User=.*/User=${DST_USER}/; s/Group=.*/Group=${DST_USER}/; s|WorkingDirectory=.*|WorkingDirectory=${PANEL_DIR}|" \
  "$SCRIPT_DIR/systemd/dst-panel.service" > /etc/systemd/system/dst-panel.service
cp "$SCRIPT_DIR/systemd/dst-steam-guard.service" "$SCRIPT_DIR/systemd/dst-steam-guard.timer" /etc/systemd/system/
sed "s|/home/steam|$DST_HOME|g" "$SCRIPT_DIR/systemd/dst-steam-guard.sh" > /usr/local/sbin/dst-steam-guard.sh
chmod +x /usr/local/sbin/dst-steam-guard.sh
# sudoers（允许运行用户控制看门狗与查看状态）
sed "s/^steam /${DST_USER} /" "$SCRIPT_DIR/systemd/sudoers.dst-panel" > /etc/sudoers.d/dst-panel
chmod 440 /etc/sudoers.d/dst-panel

systemctl daemon-reload
systemctl enable --now dst-panel dst-steam-guard.timer >/dev/null 2>&1
ok "系统服务已启动（dst-panel + dst-steam-guard.timer）"

# ---------- 8. nginx 映射（可选） ----------
if [ "$WITH_NGINX" -eq 1 ]; then
  log "步骤 7/8：配置 nginx 80 端口 /dst/ 映射…"
  if ! command -v nginx >/dev/null 2>&1; then
    case "$PKG" in
      apt) apt-get install -y -qq nginx ;;
      dnf|yum) $PKG install -y -q nginx ;;
      pacman) pacman -Sy --noconfirm --needed nginx ;;
      zypper) zypper --non-interactive install -y nginx ;;
    esac
  fi
  mkdir -p /etc/nginx/conf.d
  cat > /etc/nginx/conf.d/dst-panel.conf <<EOF
server {
    listen 80;
    server_name _;

    location ^~ /dst/ {
        proxy_pass http://127.0.0.1:${PANEL_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }
}
EOF
  nginx -t >/dev/null 2>&1 && systemctl enable --now nginx && systemctl reload nginx
  ok "nginx 已配置: http://<服务器IP>/dst/"
else
  log "步骤 7/8：未指定 --with-nginx，跳过 nginx 配置"
fi

# ---------- 完成 ----------
IP="$(curl -fsSL -m 5 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
cat <<DONE

============================================================
  ✅ DSTserver 安装完成！
============================================================
  面板地址:     http://${IP:-<服务器IP>}${WITH_NGINX:+/dst/} $([ "$WITH_NGINX" -eq 0 ] && echo "（未配 nginx，直连 http://127.0.0.1:${PANEL_PORT} 或自行映射）")
  面板密码:     ${PANEL_PASS}
  运行用户:     ${DST_USER}（密码: ${DST_PASS}）

  ⚠️ 两个密码只显示这一次，请立即保存！

  下一步（开服）:
  1. 防火墙/云安全组放行: 11000-11001(TCP+UDP), 27018-27019(UDP), 8768-8769(UDP)
  2. 在面板「基本设置」粘贴 Klei 服务器令牌（游戏内 Klei 账号页生成）
  3. 面板「服务器管理」点 ▶ 启动服务器

  运维:  systemctl status dst-panel ｜ journalctl -u dst-panel -f
  文档:  ${PANEL_DIR}/docs/ ｜ 面板「一脸懵逼」帮助中心
============================================================
DONE
