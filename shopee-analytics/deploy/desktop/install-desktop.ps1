$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir
$EnvFile = Join-Path $ScriptDir "runtime\.env"
if (!(Test-Path $EnvFile)) { throw "Missing runtime\.env. Run prepare-desktop.ps1 first." }

node (Join-Path $ScriptDir "..\..\scripts\validate-desktop-env.cjs") $EnvFile
if ($LASTEXITCODE -ne 0) { throw "Desktop env validation failed. Fix runtime\.env before install." }

docker compose --env-file $EnvFile up -d postgres
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL startup failed" }

docker compose --env-file $EnvFile --profile tools run --rm schema
if ($LASTEXITCODE -ne 0) { throw "Schema apply failed" }

docker compose --env-file $EnvFile --profile tools run --rm preflight
$preflight = $LASTEXITCODE
if ($preflight -ne 0) {
  Write-Host ""
  Write-Host "Infrastructure is installed, but pilot preflight is not complete."
  Write-Host "Configure shop profiles and encrypted shop tokens, then rerun preflight."
  exit $preflight
}

docker compose --env-file $EnvFile up -d app worker
if ($LASTEXITCODE -ne 0) { throw "App/worker startup failed" }

docker compose --env-file $EnvFile ps
Write-Host ""
Write-Host "Shopee Analytics desktop stack is running on http://127.0.0.1:3090"
Write-Host "Historical backfill remains disabled until the real-shop pilot gate passes."
