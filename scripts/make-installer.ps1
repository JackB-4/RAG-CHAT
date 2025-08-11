Param(
  [switch]$Clean,
  [switch]$SkipDevModeCheck
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Get-NpmPath {
  try { return (Get-Command npm.cmd -ErrorAction Stop).Path } catch {}
  $candidates = @(
    (Join-Path $env:ProgramFiles     'nodejs\npm.cmd'),
    (Join-Path $env:LOCALAPPDATA     'Programs\nodejs\npm.cmd')
  )
  foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
  $whereOut = cmd /c "where npm.cmd" 2>$null
  if ($LASTEXITCODE -eq 0 -and $whereOut) { return ($whereOut -split "`r?`n")[0] }
  throw "npm not found. Install Node.js LTS and reopen PowerShell."
}

if (-not $SkipDevModeCheck) {
  # Check Windows Developer Mode (allows non-admin symlinks required by electron-builder extraction)
  $devKey = 'HKLM:SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
  $allow = 0
  try {
    $allow = (Get-ItemProperty -Path $devKey -Name 'AllowDevelopmentWithoutDevLicense' -ErrorAction Stop).AllowDevelopmentWithoutDevLicense
  } catch { $allow = 0 }

  if ($allow -ne 1) {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Write-Warning 'Windows Developer Mode is OFF. Electron builder may fail to extract symlinks for winCodeSign.'
    if ($isAdmin) {
      Write-Host 'Enabling Developer Mode (requires admin)...'
      New-Item -Path $devKey -Force | Out-Null
      New-ItemProperty -Path $devKey -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -PropertyType DWord -Force | Out-Null
      Write-Host 'Developer Mode enabled. You may need to restart PowerShell if issues persist.'
    } else {
      Write-Host 'Tip: Enable Windows Developer Mode (Settings > System > For developers) or run this script as Administrator.' -ForegroundColor Yellow
    }
  }
}

Write-Host '==> Step 1/3: Build backend (PyInstaller)'
$backendBuild = Join-Path $root 'backend\build-backend.ps1'
if (!(Test-Path $backendBuild)) { throw "Missing backend/build-backend.ps1" }

if ($Clean) {
  & powershell -ExecutionPolicy Bypass -File $backendBuild -Clean
} else {
  & powershell -ExecutionPolicy Bypass -File $backendBuild
}

Write-Host '==> Step 2/3: Prepare Electron dependencies'
Push-Location (Join-Path $root 'electron')
try {
  $npm = Get-NpmPath
  if (!(Test-Path (Join-Path (Get-Location) 'node_modules'))) {
    & $npm 'install'
  }
} finally { Pop-Location }

Write-Host '==> Step 3/3: Build Windows installer (electron-builder)'
Push-Location (Join-Path $root 'electron')
try {
  # Avoid downloading/extracting winCodeSign (symlink errors) when we don't intend to sign locally
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  & $npm 'run' 'dist'
} finally {
  Pop-Location
}

# Locate resulting installer
$pkgJson = Get-Content -Raw (Join-Path $root 'electron\package.json') | ConvertFrom-Json
$version = $pkgJson.version
$glob    = Join-Path $root "electron\dist\*.exe"
$installer = Get-ChildItem $glob -ErrorAction SilentlyContinue | Select-Object -First 1
if ($installer) {
  Write-Host "==> Success. Offline installer created:" -ForegroundColor Green
  Write-Host $installer.FullName
} else {
  Write-Warning 'Installer not found in electron/dist. Check electron-builder output.'
}
