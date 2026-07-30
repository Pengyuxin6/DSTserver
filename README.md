# DSTserver — 饥荒联机版专用服务器 + Web 管理面板（傻瓜式一键部署）

一个命令在任意主流 Linux 上部署完整的饥荒联机版（Don't Starve Together）专用服务器和全功能 Web 管理面板。Windows 支持开发中（见 `windows/`）。

## 功能一览

- 🖥️ **Web 管理面板**：基本设置、编辑世界（原版+大型模组世界）、mod 设置（搜索/预览/批量下载）、服务器管理、控制台（物品生成/传送/公告）、聊天记录、帮助中心
- 🌏 **大型模组支持**：海难/哈姆雷特/三合一等地图模组的世界预设自动识别、自动应用、冲突检测、专属设置项中文翻译
- 🎨 **皮肤系统**：3 套主题 + 自定义颜色 + 自定义登录背景图 + 粒子特效，手机自适应
- 🛡️ **身份看门狗**：保证服务只以 steam 用户运行，自动修复文件属主
- 📦 **一键部署**：单脚本搞定依赖、用户、密码、Bun、游戏服务端、面板、系统服务

## 一键安装（Linux）

支持 Debian / Ubuntu / CentOS / Rocky / Alma / Arch / openSUSE（x86_64 与 ARM64）。

```bash
git clone https://github.com/Pengyuxin6/DSTserver.git
cd DSTserver
sudo bash install.sh
```

交互模式会引导你设置 `steam` 用户密码；也可以全参数免交互：

```bash
sudo bash install.sh --password=你的密码 --with-nginx
```

| 参数 | 说明 |
|------|------|
| `--password=xxx` | 指定运行用户（steam）密码，不指定则交互询问或随机生成 |
| `--with-nginx` | 安装并配置 nginx：80 端口 `/dst/` 映射到面板 |
| `--skip-game` | 跳过 3GB 游戏服务端下载（只装面板） |
| `--user=xxx` | 自定义运行用户名（默认 steam） |
| `--port=xxxx` | 面板端口（默认 5323） |

安装结束会打印：**面板地址、面板密码、steam 用户密码**（只显示一次，请保存）。

## 安装后三步开服

1. **放行端口**（防火墙 + 云安全组）：`11000-11001`(TCP+UDP)、`27018-27019`(UDP)、`8768-8769`(UDP)
2. **填服务器令牌**：面板「基本设置」→ 服务器令牌（在你的电脑饥荒游戏内 Klei 账号页面生成，粘贴进去）
3. 面板「服务器管理」→ **▶ 启动服务器**

## 目录结构

```
DSTserver/
├── install.sh          # 一键安装脚本（本项目的核心）
├── panel/              # Web 面板源码（Bun + TypeScript，无外部依赖）
│   ├── src/            #   后端 server.ts + 数据表
│   ├── public/         #   前端（主题/粒子/响应式）
│   └── docs/           #   模组管理文档
├── scripts/            # start/stop/update_dst.sh 运维脚本
├── systemd/            # dst-panel 服务、看门狗、sudoers 规则
├── nginx/              # nginx 站点配置样例
├── windows/            # Windows 版（开发中）
└── docs/               # 模组迁移指南、服务器维护手册
```

## 运维命令

```bash
systemctl status dst-panel        # 面板状态
journalctl -u dst-panel -f        # 面板日志
systemctl status dst-steam-guard.timer   # 看门狗
su - steam && ~/start_dst.sh      # 手动开服（一般用面板即可）
```

## 面板密码 / steam 密码忘记怎么办

```bash
sudo cat /home/steam/dst_panel/.panel_password   # 面板密码（安装时随机生成）
sudo passwd steam                                 # 重置 steam 密码
```

## 许可证

本项目采用 **CC BY-NC-SA 4.0**（署名-非商业性使用-相同方式共享）许可：可自由使用、修改、分享，但须署名、**禁止商用**、衍生作品须同许可发布。详见 [LICENSE](LICENSE)。饥荒版权归 Klei Entertainment 所有。
