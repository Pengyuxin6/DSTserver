# Windows 版说明（开发中）

## 当前状态

`DSTserver.bat` 是一个本地启动器：双击后自动安装 Bun（如缺失）、启动 Web 管理面板并打开浏览器（http://localhost:5323/）。

## 路线图

Windows 完整支持分两步走：

1. **第一阶段（当前）**：面板可在 Windows 本地运行，用于管理**远程 Linux 服务器**（面板内的服务器目录/存档目录等路径配置项指向远程）。
2. **第二阶段（计划中）**：完整 Windows 部署——
   - 使用 Windows 版 SteamCMD 下载 `Don't Starve Together Dedicated Server` 工具
   - 面板路径/进程管理适配 Windows（计划任务替代 systemd、防火墙规则脚本化）
   - 打包为单一可执行应用（计划用 Bun 的 `bun build --compile` 生成 `DSTserver.exe`，双击即用，无需安装环境）

## 为什么先用 .bat

面板后端（`panel/src/server.ts`）目前硬编码了 Linux 路径（`/home/steam`）与 screen/systemd 进程模型，直接跑在 Windows 上无法管理游戏服务端。在第二阶段完成前，**推荐的生产部署方式仍是 Linux 一键脚本**（见项目根 README）。
