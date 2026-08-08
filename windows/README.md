# DSTserver 管理面板（Windows 版）

Windows 版与网页版功能一致：基本设置、编辑世界、mod 设置、服务器管理、控制台、聊天记录、日志、公告，外加 Windows 专属能力。

## 安装向导（推荐）

把 `windows/setup.ps1` 和 `dist/` 里的 `DSTserver.exe` 放在同一目录（或直接用源码仓库形态），双击 `setup.ps1` 即可运行图形安装向导：

1. 选择安装目录（默认 `C:\DSTserver`）；
2. 自动复制程序文件，**保留已有数据**——目标目录中已存在的面板配置（`panel_config.json`）、密码（`.panel_password`）、模组（`dst_mods`）、服务器文件（`dst_server`）、缓存（`mod_cache.json`）**不会被覆盖**（升级安装安全）；
3. 自动创建桌面快捷方式「DSTserver 管理面板」；
4. 完成页显示安装目录、面板地址与密码文件位置。

命令行方式：`powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1 -Source <dist目录> -InstallDir <目标目录>`

## 快速开始

1. 双击 `windows/DSTserver.bat` 即可（自动定位项目根目录；也可以复制到项目根目录使用）。
   注意：bat 文件为 GBK(ANSI) 编码 + CRLF 换行，请勿用编辑器另存为 UTF-8，否则中文 cmd 会解析错乱。
2. 双击运行，菜单选择：
   - **1. 启动管理面板** — 开发模式（`bun run`），自动打开 http://localhost:5323/
   - **2. 打包为 DSTserver.exe** — 弹出 UAC 询问管理员权限，生成 `dist/DSTserver.exe`（单文件 + 配套 public/data 资源，双击即用，无需安装环境）
   - **3. 添加防火墙规则** — 放行 DST UDP 10999-11001（管理员）
   - **4. 安装/更新 DST 专用服务器** — 用 SteamCMD 下载 app 343050 到 `panel/dst_server`
3. 首次运行会要求设置面板密码（存 `panel/.panel_password`，完整路径会提示；忘记密码可查看该文件，或在面板「基本设置」页面修改）。

只使用 Windows 自带命令（cmd + PowerShell），运行时仅需 Bun（首次经 `windows/install_bun.ps1` 自动安装到 `%USERPROFILE%\.bun`，优先走 npmmirror 国内镜像，失败自动回退官方脚本）。面板进程为 Bun 单进程，内存/CPU 占用极小（空闲时内存 < 100MB）。

## Windows 专属功能

- **进程直连**：启动/停止 DST 服务器无需 screen/systemd，面板直接拉起 `dontstarve_dedicated_server_nullrenderer.exe`，控制台命令经 stdin 注入。
- **客户端位置**：基本设置页可设置/自动检测 DST 客户端安装目录（如 `D:\steam\steamapps\common\Don't Starve Together`，留空=自动检测 Steam 库）。客户端模组在两个位置：客户端 `mods\` 和 `steamapps\workshop\content\322330\<id>`；面板会直接读取这两个位置。服务器目录一般是另一个库（如 `E:\SteamLibrary\steamapps\common\Don't Starve Together Dedicated Server`）。
- **存档位置切换**：基本设置页默认用科雷存档位置（`文档\Klei\DoNotStarveTogether`，可一键恢复），也可填自定义位置；用过的位置会记录在历史下拉里，随时切换。
- **客户端存档直接导入**：游戏客户端生成的存档（世界文件夹里没有 server.ini）会被直接识别；点「添加地上/地下世界」即导入既有文件夹并自动补全 server.ini（端口自动分配），世界数据原样保留；启动服务器时也会自动补全。
- **资源监控**：服务器管理页实时显示 CPU 使用率、系统内存、DST 进程内存（PowerShell Get-Process 汇总）。
- **本地模组库**（mod 设置页顶部）：自动扫描本机 Steam 库（含 `libraryfolders.vdf` 里的附加库）中已下载的 DST 模组：
  - 创意工坊缓存 `steamapps/workshop/content/322330/<id>`
  - 游戏/专用服务器 `steamapps/common/.../mods/workshop-<id>`
  - **链接加载（推荐）**：在模组存放目录建立目录联接（Junction）直接指向客户端模组文件夹——不复制、不占额外磁盘、随 Steam 客户端自动更新，无需管理员权限；清单见存放目录的 `_链接模组来源.txt`（标明每个链接指向的客户端地址），取消链接不删客户端文件。
  - **复用（复制）**：复制一份到面板模组统一目录并写入 `SOURCE.txt` 标明来源地址，客户端卸载后仍可用。
  - 模组统一存放目录（默认 `panel/dst_mods`）内含 `_模组存放目录说明.txt` 标明地址，面板界面也显示该地址，可一键打开文件夹。
- **图片解析**：模组物品图标（KTEX → PNG）在 Windows 上同样可用，与网页版一致。
- **多开保护**：空余内存不足 4G 时禁止多开；端口冲突时列出需要修改的端口、配置文件与键名。

## 打包说明

`bun build --compile` 生成单 exe，但面板网页资源不内嵌：`DSTserver.exe` 需与 `public/`、`data/` 同目录（打包脚本已自动复制到 `dist/`）。分发时整个 `dist/` 目录一起拷贝即可。

## 默认路径

| 内容 | 路径 |
| --- | --- |
| 存档根目录 | `文档\Klei\DoNotStarveTogether`（科雷默认，可改并记录历史切换） |
| 客户端位置 | 自动检测 Steam 库中的 `steamapps\common\Don't Starve Together`（可手动指定） |
| 客户端模组 | `<客户端>\mods` 与 `<库>\steamapps\workshop\content\322330\<id>`（面板直接读取） |
| 模组统一目录 | `panel/dst_mods`（exe 版：`dist/dst_mods`） |
| DST 服务端 | `panel/dst_server`（菜单 4 安装，可在基本设置修改；如已装在 `E:\SteamLibrary\...Dedicated Server` 可直接填该目录） |
| 面板密码/配置 | `panel/.panel_password`、`panel/panel_config.json` |
