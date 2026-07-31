# Install Bun runtime for DSTserver panel (Windows).
# China-friendly: tries npmmirror binary mirror first, falls back to official installer.
# Pure ASCII on purpose: avoids any script-encoding issues on Chinese Windows.
$ErrorActionPreference = 'Stop'
$ver = '1.3.14'
$dst = Join-Path $env:USERPROFILE '.bun\bin'
$zip = Join-Path $env:TEMP 'bun-windows-x64.zip'
$tmp = Join-Path $env:TEMP 'bunx'

function Install-FromZip($url) {
    Write-Host "Downloading: $url"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Force $zip $tmp
    New-Item -ItemType Directory -Force $dst | Out-Null
    Copy-Item (Join-Path $tmp 'bun-windows-x64\bun.exe') $dst -Force
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
}

try {
    Install-FromZip "https://registry.npmmirror.com/-/binary/bun/bun-v$ver/bun-windows-x64.zip"
} catch {
    Write-Host 'Mirror download failed, trying official install script...'
    try {
        irm bun.sh/install.ps1 | iex
    } catch {
        Write-Error 'Bun installation failed.'
        exit 1
    }
}

$bun = Join-Path $dst 'bun.exe'
if (-not (Test-Path $bun)) {
    Write-Error "bun.exe not found at $bun"
    exit 1
}
& $bun --version | Out-Null
Write-Host "Bun installed: $bun"
exit 0
