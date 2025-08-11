param(
  [string]$LmBaseUrl = "http://127.0.0.1:1234/v1",
  [string]$LmApiKey = "lm-studio",
  [string]$EmbeddingModel = "text-embedding-3-small",
  [string]$ChatModel = "gpt-3.5-turbo"
)

$ErrorActionPreference = 'Stop'

function Get-NpmPath {
  try { return (Get-Command npm.cmd -ErrorAction Stop).Path } catch {}
  $candidates = @(
    (Join-Path $env:ProgramFiles     'nodejs\npm.cmd'),
    (Join-Path $env:LOCALAPPDATA     'Programs\nodejs\npm.cmd')
  )
  foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
  $whereOut = cmd /c "where npm.cmd" 2>$null
  if ($LASTEXITCODE -eq 0 -and $whereOut) { return ($whereOut -split "`r?`n")[0] }
  throw "npm not found. Close and reopen PowerShell so PATH updates, or install Node.js LTS."
}

function Get-NodePath {
  try { return (Get-Command node.exe -ErrorAction Stop).Path } catch {}
  $candidates = @(
    (Join-Path $env:ProgramFiles     'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA     'Programs\nodejs\node.exe')
  )
  foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
  $whereOut = cmd /c "where node.exe" 2>$null
  if ($LASTEXITCODE -eq 0 -and $whereOut) { return ($whereOut -split "`r?`n")[0] }
  throw "node.exe not found. Close and reopen PowerShell so PATH updates, or reinstall Node.js LTS."
}

# Paths
$root   = Split-Path -Parent $PSScriptRoot
$venv   = Join-Path $root '.venv'
$python = Join-Path $venv 'Scripts\python.exe'

# Ensure venv
if (!(Test-Path $python)) {
  Write-Host 'Creating venv...'
  try { & python -m venv $venv } catch { & py -3 -m venv $venv }
}
if (!(Test-Path $python)) { throw "Virtualenv creation failed. Make sure Python 3 is installed." }

# Backend deps
Write-Host 'Installing backend dependencies (idempotent)...'
& $python -m pip install -r (Join-Path $root 'backend\requirements.txt') | Out-Host

# Env for backend
$env:OPENAI_BASE_URL = $LmBaseUrl
$env:OPENAI_API_KEY  = $LmApiKey
$env:EMBEDDING_MODEL = $EmbeddingModel
$env:CHAT_MODEL      = $ChatModel

# Health check
function Test-Health {
  try {
    $r = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2
    return $true
  } catch { return $false }
}

# Restart backend if already listening
if (Test-Health) {
  Write-Host 'Restarting backend to pick up changes...'
  try {
    $conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
  } catch {}
  Start-Sleep -Milliseconds 500
}

# Start backend
Write-Host 'Starting backend...'
Start-Process -FilePath $python `
  -ArgumentList '-m','uvicorn','app:app','--app-dir','backend','--host','127.0.0.1','--port','8000' `
  -WorkingDirectory $root `
  -WindowStyle Hidden | Out-Null

Start-Sleep -Seconds 2
if (-not (Test-Health)) { Write-Error 'Backend failed to start. Check logs and try again.' }

# Start Electron
Write-Host 'Starting Electron...'
Push-Location (Join-Path $root 'electron')
try { $npm  = Get-NpmPath }  catch { throw }
try { $node = Get-NodePath } catch { throw }

Write-Host "Using Node: $node"
Write-Host "Using npm : $npm"

# Ensure node.exe dir is on PATH so child scripts can find node
$nodeDir = Split-Path -Parent $node
if (-not ($env:Path -split ';' | Where-Object { $_ -eq $nodeDir })) {
  $env:Path = "$nodeDir;$env:Path"
}

# Install deps if missing
if (!(Test-Path (Join-Path (Get-Location) 'node_modules'))) {
  & $npm 'install'
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'npm install failed once; retrying after cleaning electron package...'
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path (Get-Location) 'node_modules\electron')
    & $npm 'install'
  }
}

# Ensure electron binary exists
$electronBin = Join-Path (Get-Location) 'node_modules\.bin\electron.cmd'
if (!(Test-Path $electronBin)) {
  Write-Host 'Electron binary missing; reinstalling dev dependencies...'
  & $npm 'install'
  if (!(Test-Path $electronBin)) {
    Write-Warning 'Electron still missing; cleaning node_modules and reinstalling...'
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path (Get-Location) 'node_modules')
    & $npm 'install'
  }
}

# Launch Electron via npm exec (avoids PATH/shim issues)
& $npm 'exec' 'electron' '.'

Pop-Location
