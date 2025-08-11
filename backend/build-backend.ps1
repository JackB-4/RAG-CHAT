Param(
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host 'Building backend (PyInstaller, onedir)'

# Ensure a local virtual environment to avoid polluting global Python
$venvPath = Join-Path $PSScriptRoot '.venv'
$python   = Join-Path $venvPath 'Scripts\python.exe'

if ($Clean) {
  if (Test-Path build) { Remove-Item -Recurse -Force build }
  if (Test-Path dist)  { Remove-Item -Recurse -Force dist }
  if (Test-Path $venvPath) { Remove-Item -Recurse -Force $venvPath }
}

if (!(Test-Path $python)) {
  Write-Host 'Creating backend venv...'
  try { & python -m venv $venvPath } catch { & py -3 -m venv $venvPath }
}
if (!(Test-Path $python)) { throw 'Failed to create Python venv for backend build. Ensure Python 3 is installed.' }

Write-Host 'Installing backend build dependencies into venv...'
& $python -m pip install --upgrade pip
& $python -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
& $python -m pip install pyinstaller==6.10.0

# Ensure output folders are clean
if (Test-Path build) { Remove-Item -Recurse -Force build }
if (Test-Path dist)  { Remove-Item -Recurse -Force dist }

# Package app.py into onedir folder steve-backend, include data folder next to modules
& $python -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name steve-backend `
  app.py

Write-Host 'Backend build complete -> backend/dist/steve-backend'
