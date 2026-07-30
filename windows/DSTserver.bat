# DSTserver 管理面板（Windows 本地运行）
# 用法：双击运行。首次运行会自动安装 Bun，然后启动面板并打开浏览器。

@echo off
setlocal
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo [DSTserver] 未检测到 Bun，正在安装...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
  set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
)

if not exist panel\src\server.ts (
  echo [DSTserver] 未找到 panel 目录，请确认本 bat 位于 DSTserver 项目根目录。
  pause
  exit /b 1
)

echo [DSTserver] 启动管理面板: http://localhost:5323/
start "" "http://localhost:5323/"
cd panel
bun run src/server.ts
endlocal
