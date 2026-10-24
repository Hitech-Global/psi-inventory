$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..\..")
Set-Location $ScriptDir

function Require-Command([string]$Name) {
  if (!(Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Require-Command "docker"
Require-Command "node"
Require-Command "git"

docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required" }

Set-Location $RepoRoot
$env:SHOPEE_ANALYTICS_PREPARE_DESKTOP_RUNTIME = "YES"
node shopee-analytics/scripts/prepare-desktop-runtime.cjs
if ($LASTEXITCODE -ne 0) { throw "Runtime initialization failed" }

Set-Location $ScriptDir
$EnvFile = Join-Path $ScriptDir "runtime\.env"
node (Join-Path $RepoRoot "shopee-analytics\scripts\validate-desktop-env.cjs") $EnvFile
$envCheck = $LASTEXITCODE

Write-Host ""
Write-Host "Desktop bootstrap prepared."
Write-Host "Runtime env: $EnvFile"
Write-Host "Next: edit only the Shopee Partner credentials and SHOPEE_NAS_BACKUP_DIR."
Write-Host "Then rerun this script. It will not overwrite existing secrets."

if ($envCheck -eq 2) {
  exit 2
}
exit $envCheck
