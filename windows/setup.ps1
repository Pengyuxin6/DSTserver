# ============================================================
#  DSTserver 安装向导（Windows 版）
#  用法：双击运行，或 powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1
#  参数：-Source <dist目录>  安装源（默认：本脚本同级的 dist，或脚本所在目录若含 DSTserver.exe）
#        -InstallDir <目录>  安装目录（默认：C:\DSTserver）
#  特点：安装时【保留已有数据文件】——目标目录中已存在的面板配置/存档/模组/服务器数据不会被覆盖
#  编码：UTF-8 with BOM（PowerShell 5.1 正确识别中文）
# ============================================================
param(
  [string]$Source = "",
  [string]$InstallDir = ""
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ---------- 定位安装源 ----------
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Source -eq "") {
  if (Test-Path (Join-Path $scriptDir "DSTserver.exe")) {
    $Source = $scriptDir                      # setup.ps1 与 exe 同目录（发布包形态）
  } elseif (Test-Path (Join-Path $scriptDir "..\dist\DSTserver.exe")) {
    $Source = (Resolve-Path (Join-Path $scriptDir "..\dist")).Path   # 源码仓库形态
  } elseif (Test-Path (Join-Path $scriptDir "dist\DSTserver.exe")) {
    $Source = (Resolve-Path (Join-Path $scriptDir "dist")).Path
  }
}
if ($Source -eq "" -or -not (Test-Path (Join-Path $Source "DSTserver.exe"))) {
  [System.Windows.Forms.MessageBox]::Show(
    "未找到 DSTserver.exe。请把 setup.ps1 与 DSTserver.exe 放在同一目录，或使用 -Source 参数指定安装源目录。",
    "DSTserver 安装", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
  exit 1
}
$Source = (Resolve-Path $Source).Path

# ---------- 安装目标目录 ----------
if ($InstallDir -eq "") { $InstallDir = "C:\DSTserver" }
$InstallDir = $InstallDir.TrimEnd("\")

# ---------- 保留数据清单（安装时若目标已存在则不覆盖） ----------
$dataFiles = @("panel_config.json", ".panel_password", ".panel_salt", "mod_cache.json")
$dataDirs  = @("dst_mods", "dst_server", "steamcmd", "data")

# ============================================================
#  WinForms 向导
# ============================================================
$form = New-Object System.Windows.Forms.Form
$form.Text = "DSTserver 安装向导"
$form.Size = New-Object System.Drawing.Size(560, 420)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

# 顶部标题
$title = New-Object System.Windows.Forms.Label
$title.Text = "DSTserver 服务器管理面板 - 安装"
$title.Font = New-Object System.Drawing.Font("微软雅黑", 15, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(20, 15)
$title.AutoSize = $true
$form.Controls.Add($title)

# 步骤说明
$step = New-Object System.Windows.Forms.Label
$step.Text = "第 1 步 / 共 3 步：请选择安装目录"
$step.Font = New-Object System.Drawing.Font("微软雅黑", 10)
$step.Location = New-Object System.Drawing.Point(20, 58)
$step.AutoSize = $true
$form.Controls.Add($step)

# 安装目录输入
$lblDir = New-Object System.Windows.Forms.Label
$lblDir.Text = "安装目录："
$lblDir.Location = New-Object System.Drawing.Point(20, 92)
$lblDir.AutoSize = $true
$form.Controls.Add($lblDir)

$txtDir = New-Object System.Windows.Forms.TextBox
$txtDir.Text = $InstallDir
$txtDir.Location = New-Object System.Drawing.Point(110, 88)
$txtDir.Size = New-Object System.Drawing.Size(320, 24)
$form.Controls.Add($txtDir)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "浏览…"
$btnBrowse.Location = New-Object System.Drawing.Point(440, 86)
$btnBrowse.Size = New-Object System.Drawing.Size(80, 28)
$form.Controls.Add($btnBrowse)

# 数据保留说明
$note = New-Object System.Windows.Forms.Label
$note.Text = "说明：安装会【保留已有数据】——目标目录中已存在的`n面板配置、密码、模组、服务器文件不会被覆盖。"
$note.Font = New-Object System.Drawing.Font("微软雅黑", 9)
$note.ForeColor = [System.Drawing.Color]::DimGray
$note.Location = New-Object System.Drawing.Point(20, 130)
$note.Size = New-Object System.Drawing.Size(500, 44)
$form.Controls.Add($note)

# 源目录显示
$srcLbl = New-Object System.Windows.Forms.Label
$srcLbl.Text = "安装源：$Source"
$srcLbl.Font = New-Object System.Drawing.Font("微软雅黑", 8.5)
$srcLbl.ForeColor = [System.Drawing.Color]::DimGray
$srcLbl.Location = New-Object System.Drawing.Point(20, 180)
$srcLbl.Size = New-Object System.Drawing.Size(500, 20)
$form.Controls.Add($srcLbl)

# 进度条
$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Minimum = 0
$progress.Maximum = 100
$progress.Value = 0
$progress.Location = New-Object System.Drawing.Point(20, 220)
$progress.Size = New-Object System.Drawing.Size(500, 22)
$progress.Visible = $false
$form.Controls.Add($progress)

# 状态文本
$status = New-Object System.Windows.Forms.Label
$status.Text = ""
$status.Location = New-Object System.Drawing.Point(20, 250)
$status.Size = New-Object System.Drawing.Size(500, 90)
$status.Font = New-Object System.Drawing.Font("微软雅黑", 9)
$form.Controls.Add($status)

# 按钮
$btnPrev = New-Object System.Windows.Forms.Button
$btnPrev.Text = "< 上一步"
$btnPrev.Location = New-Object System.Drawing.Point(260, 335)
$btnPrev.Size = New-Object System.Drawing.Size(90, 32)
$btnPrev.Enabled = $false
$form.Controls.Add($btnPrev)

$btnNext = New-Object System.Windows.Forms.Button
$btnNext.Text = "安装 >"
$btnNext.Location = New-Object System.Drawing.Point(360, 335)
$btnNext.Size = New-Object System.Drawing.Size(90, 32)
$form.Controls.Add($btnNext)

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "取消"
$btnCancel.Location = New-Object System.Drawing.Point(460, 335)
$btnCancel.Size = New-Object System.Drawing.Size(70, 32)
$form.Controls.Add($btnCancel)

# ---------- 安装执行 ----------
function Do-Install {
  $target = $txtDir.Text.Trim().TrimEnd("\")
  if ($target -eq "") {
    [System.Windows.Forms.MessageBox]::Show("安装目录不能为空。", "DSTserver 安装",
      [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    return
  }
  # 目标目录非空但已有安装 → 确认升级/覆盖
  if ((Test-Path $target) -and (Test-Path (Join-Path $target "DSTserver.exe"))) {
    $r = [System.Windows.Forms.MessageBox]::Show(
      "目标目录已安装 DSTserver。`n`n继续将更新程序文件，并【保留】已有的面板配置、密码、模组与服务器数据。`n`n是否继续？",
      "检测到已有安装", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($r -ne "Yes") { return }
  }
  $btnPrev.Enabled = $false
  $btnNext.Enabled = $false
  $btnCancel.Enabled = $false
  $step.Text = "第 2 步 / 共 3 步：正在复制文件…"
  $progress.Visible = $true
  $progress.Value = 5
  $form.Refresh()

  try {
    # 收集文件清单：全部文件按「数据 / 程序」分类
    $all = Get-ChildItem -Path $Source -Recurse -File
    $total = $all.Count
    $idx = 0
    $copied = 0; $skipped = 0

    if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }

    foreach ($f in $all) {
      $idx++
      $rel = $f.FullName.Substring($Source.Length).TrimStart("\", "/")
      $destPath = Join-Path $target $rel
      $destDir = Split-Path -Parent $destPath
      $firstSeg = $rel.Split("\", "/")[0]

      $isData = ($dataDirs -contains $firstSeg) -or ($dataFiles -contains $rel)

      if ($isData) {
        # 数据文件：目标已存在 → 跳过保留；不存在 → 复制
        if (Test-Path $destPath) { $skipped++; continue }
      }
      New-Item -ItemType Directory -Path $destDir -Force | Out-Null
      Copy-Item -Path $f.FullName -Destination $destPath -Force
      $copied++
      if ($idx % 40 -eq 0) {
        $progress.Value = [Math]::Min(80, 10 + [int]($idx / $total * 70))
        $status.Text = "已复制 $idx / $total 个文件（保留已有数据 $skipped 个）…"
        $form.Refresh()
      }
    }
    $progress.Value = 90

    # ---------- 创建桌面快捷方式 ----------
    $exePath = Join-Path $target "DSTserver.exe"
    $desktop = [Environment]::GetFolderPath("Desktop")
    $lnkPath = Join-Path $desktop "DSTserver 管理面板.lnk"
    try {
      $ws = New-Object -ComObject WScript.Shell
      $lnk = $ws.CreateShortcut($lnkPath)
      $lnk.TargetPath = $exePath
      $lnk.WorkingDirectory = $target
      $lnk.Description = "DSTserver 饥荒服务器管理面板"
      $lnk.Save()
      $shortcutCreated = $true
    } catch { $shortcutCreated = $false }

    $progress.Value = 100
    $step.Text = "第 3 步 / 共 3 步：安装完成"
    $pwdFile = Join-Path $target ".panel_password"
    $status.Text = "✔ 安装完成！`n`n安装目录：$target`n面板地址：http://localhost:5323/`n面板密码文件：$pwdFile`n桌面快捷方式：$($(if ($shortcutCreated) {"已创建"} else {"创建失败（可手动创建）"}))`n已保留已有数据：$skipped 个文件"
    $btnCancel.Text = "关闭"
  } catch {
    $step.Text = "安装失败"
    $status.Text = "错误：$($_.Exception.Message)`n安装目录：$target`n可手动删除该目录后重试。"
    $btnCancel.Text = "关闭"
    $btnNext.Enabled = $false
  }
}

$btnBrowse.Add_Click({
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = "选择安装目录"
  $d.SelectedPath = $txtDir.Text
  if ($d.ShowDialog() -eq "OK") { $txtDir.Text = $d.SelectedPath }
})

$btnNext.Add_Click({ Do-Install })
$btnCancel.Add_Click({ $form.Close() })

$form.ShowDialog() | Out-Null
