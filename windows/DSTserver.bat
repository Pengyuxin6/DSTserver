@echo off
REM ============================================================
REM  DSTserver 管理面板（Windows 版）
REM  全部使用 Windows 自带命令（cmd + PowerShell），无需第三方软件
REM  功能：启动面板 / 打包 exe（询问管理员权限）/ 防火墙规则 / 安装 DST 服务端
REM  注意：本文件必须为 GBK(ANSI) 编码 + CRLF 换行，否则中文 cmd 解析会错乱
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
title DSTserver 管理面板

REM ---------- 定位项目根目录（bat 可放在项目根目录或 windows\ 子目录） ----------
set "ROOT=%~dp0"
if not exist "%ROOT%panel\src\server.ts" (
  if exist "%ROOT%..\panel\src\server.ts" set "ROOT=%ROOT%..\"
)
cd /d "%ROOT%"

REM 内部入口（管理员模式回调）
if "%~1"==":dobuild" goto dobuild
if "%~1"==":dofw" goto dofw

REM ---------- 检查 Bun（面板运行时，内存/CPU 占用极小） ----------
where bun >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.bun\bin\bun.exe" (
    set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
  ) else (
    echo [DSTserver] 未检测到 Bun，正在从国内镜像安装（仅首次，约 30MB）...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%windows\install_bun.ps1"
    if errorlevel 1 (
      echo [DSTserver] Bun 安装失败，请检查网络后重试。
      pause
      exit /b 1
    )
    set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
  )
)

if not exist panel\src\server.ts (
  echo [DSTserver] 未找到 panel\src\server.ts，请确认本 bat 位于 DSTserver 项目内。
  pause
  exit /b 1
)

REM ---------- 首次运行：设置面板密码 ----------
if not exist panel\.panel_password (
  echo [DSTserver] 首次运行，请设置面板访问密码（登录网页管理面板用）：
  set /p PANELPW=密码:
  if "!PANELPW!"=="" (
    echo [DSTserver] 密码不能为空，请重新运行本程序。
    pause
    exit /b 1
  )
  > panel\.panel_password echo !PANELPW!
)

:menu
cls
echo ================== DSTserver 管理面板 ==================
echo.
echo   1. 启动管理面板 ( http://localhost:5323/ )
echo   2. 打包为 DSTserver.exe ( 询问管理员权限 )
echo   3. 添加防火墙规则 ( DST UDP 10999-11001, 需管理员 )
echo   4. 安装/更新 DST 专用服务器 ( SteamCMD, 约 3GB )
echo   0. 退出
echo.
echo ======================================================
set /p choice=请选择 [0-4]:
if "%choice%"=="1" goto run
if "%choice%"=="2" goto build
if "%choice%"=="3" goto firewall
if "%choice%"=="4" goto steamcmd
if "%choice%"=="0" exit /b 0
goto menu

:run
echo [DSTserver] 启动管理面板: http://localhost:5323/  (关闭本窗口即停止面板)
start "" "http://localhost:5323/"
cd panel
bun run src/server.ts
cd /d "%ROOT%"
pause
goto menu

:build
echo [DSTserver] 打包需要管理员权限（将弹出 UAC 确认框）...
powershell -NoProfile -Command "Start-Process -Verb RunAs -Wait cmd -ArgumentList '/c \"\"%~f0\" :dobuild\"'"
goto menu

:dobuild
title DSTserver 打包（管理员）
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
where bun >nul 2>nul
if errorlevel 1 (
  echo 未找到 Bun，请先在普通模式运行一次本程序完成 Bun 安装。
  pause
  exit /b 1
)
if not exist dist mkdir dist
echo 正在编译 DSTserver.exe ...
bun build --compile panel\src\server.ts --outfile dist\DSTserver.exe
if errorlevel 1 (
  echo 打包失败，请检查错误信息。
  pause
  exit /b 1
)
echo 复制面板资源（public / data）...
xcopy /E /I /Y /Q panel\public dist\public >nul
xcopy /E /I /Y /Q panel\data dist\data >nul
if exist panel\.panel_password copy /Y panel\.panel_password dist\.panel_password >nul
echo.
echo 打包完成: dist\DSTserver.exe
echo 双击即用（资源已配套放在 dist 目录），面板地址 http://localhost:5323/
pause
exit /b 0

:firewall
echo [DSTserver] 添加防火墙规则需要管理员权限（将弹出 UAC 确认框）...
powershell -NoProfile -Command "Start-Process -Verb RunAs -Wait cmd -ArgumentList '/c \"\"%~f0\" :dofw\"'"
goto menu

:dofw
title DSTserver 防火墙规则（管理员）
for %%P in (10999 11000 11001) do (
  netsh advfirewall firewall add rule name="DST UDP %%P" dir=in action=allow protocol=UDP localport=%%P >nul 2>nul
  echo 已放行 UDP %%P
)
echo 防火墙规则添加完成。
pause
exit /b 0

:steamcmd
if not exist panel\steamcmd\steamcmd.exe (
  echo [DSTserver] 下载 SteamCMD ...
  if not exist panel\steamcmd mkdir panel\steamcmd
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' -OutFile \"$env:TEMP\steamcmd.zip\""
  powershell -NoProfile -Command "Expand-Archive -Force \"$env:TEMP\steamcmd.zip\" '%ROOT%panel\steamcmd'"
)
echo [DSTserver] 安装/更新 DST 专用服务器（app 343050）到 panel\dst_server ...
panel\steamcmd\steamcmd.exe +force_install_dir "%ROOT%panel\dst_server" +login anonymous +app_update 343050 validate +quit
echo 完成。启动面板后在「基本设置」确认服务器目录: %ROOT%panel\dst_server
pause
goto menu
