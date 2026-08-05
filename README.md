# DSTserver — 饥荒联机版专用服务器 + Web 管理面板（傻瓜式一键部署）

一个命令在任意主流 Linux 上部署完整的饥荒联机版（Don't Starve Together）专用服务器和全功能 Web 管理面板。Windows 支持开发中（见 `windows/`）。

## 功能一览

- 🖥️ **Web 管理面板**：基本设置、编辑世界（原版+大型模组世界）、mod 设置（搜索/预览/批量下载）、服务器管理、控制台（物品生成/传送/公告）、聊天记录、帮助中心
- 🌏 **大型模组支持**：海难/哈姆雷特/三合一等地图模组的世界预设自动识别、自动应用、冲突检测、专属设置项中文翻译
- 🎨 **皮肤系统**：3 套主题 + 自定义颜色 + 自定义登录背景图 + 粒子特效，手机自适应
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
├── systemd/            # dst-panel 服务
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

本项目依据 **Apache License 2.0** 许可发布：允许自由使用、修改、分发（含商业与闭源使用），惟须保留版权声明与本许可声明。详见 [LICENSE](LICENSE)。

## 免责声明

1. **非官方声明**：本项目是第三方开源工具，与 Klei Entertainment、Valve Corporation / Steam 无任何隶属、授权或合作关系。"Don't Starve Together"、"饥荒"、Steam 及相关商标归各自权利人所有，项目名称及描述仅为兼容性说明，不暗示官方认可。

2. **版权归属**：游戏资源、创意工坊模组、模组图标与预览图等版权归原作者或对应权利人所有。本项目仅做本地管理与运行时引用，不存储、再分发或聚合任何第三方受版权保护的内容。

3. **网络中转功能**：项目的 Steam 搜索中转（steamProxy）仅用于自建服务器管理面板之间的技术性请求转发，不提供任何面向公众的网络加速、代理或 VPN 服务。使用者应遵守所在国家/地区的法律法规及 Steam 服务条款。

4. **服务器管理功能**：控制台的物品发放、传送、公告等管理功能仅面向**自建服务器**的管理员，用于服务器日常管理。请勿用于他人服务器或任何形式的作弊、破坏游戏公平性的用途。

5. **数据与隐私**：面板记录的游戏日志（玩家昵称、聊天记录、IP 等）仅存储在自建服务器本地，用于服务器管理，不会上传至任何第三方。请妥善保管服务器令牌、面板密码等凭据，因泄露造成的一切后果由使用者自行承担。

6. **风险自负**：本项目按"现状"提供，不提供任何明示或暗示的担保。使用本项目搭建、运营服务器，应遵守游戏服务条款及所在国家/地区的法律法规；因使用本项目产生的任何直接或间接损失，项目作者不承担责任。
