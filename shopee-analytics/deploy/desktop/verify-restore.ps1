$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir
$EnvFile = Join-Path $ScriptDir "runtime\.env"
if (!(Test-Path $EnvFile)) { throw "Missing runtime\.env" }

function Read-DotEnv([string]$Path) {
  $map = @{}
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith("#")) { return }
    $parts = $line.Split("=", 2)
    if ($parts.Count -eq 2) { $map[$parts[0]] = $parts[1] }
  }
  return $map
}

$cfg = Read-DotEnv $EnvFile
$dbUser = $cfg["POSTGRES_USER"]
$localDir = $cfg["SHOPEE_BACKUP_LOCAL_DIR"]
if (!$dbUser -or !$localDir) { throw "Backup settings missing" }

$latest = Get-ChildItem $localDir -Filter "shopee-analytics-*.dump" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (!$latest) { throw "No local backup found" }

$containerId = (docker compose --env-file $EnvFile ps -q postgres).Trim()
if (!$containerId) { throw "postgres container not found" }

$containerFile = "/tmp/verify-$($latest.Name)"
$tempDb = "shopee_restore_verify_$((Get-Date).ToString('yyyyMMddHHmmss'))"

docker cp $latest.FullName "$containerId`:$containerFile"
if ($LASTEXITCODE -ne 0) { throw "docker cp failed" }

try {
  docker compose --env-file $EnvFile exec -T postgres createdb -U $dbUser $tempDb
  if ($LASTEXITCODE -ne 0) { throw "createdb failed" }

  docker compose --env-file $EnvFile exec -T postgres pg_restore -U $dbUser -d $tempDb --no-owner --no-privileges $containerFile
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }

  $tableCount = docker compose --env-file $EnvFile exec -T postgres psql -U $dbUser -d $tempDb -Atc "select count(*) from information_schema.tables where table_schema='public' and table_name like 'shopee_%';"
  if ($LASTEXITCODE -ne 0) { throw "verification query failed" }
  if ([int]$tableCount -lt 20) { throw "restore verification found only $tableCount Shopee tables" }

  $statusPath = Join-Path $ScriptDir "runtime\backup-status.json"
  $status = @{}
  if (Test-Path $statusPath) {
    $existing = Get-Content $statusPath -Raw | ConvertFrom-Json
    $existing.PSObject.Properties | ForEach-Object {
      $status[$_.Name] = $_.Value
    }
  }
  $status["restoreVerifiedAt"] = (Get-Date).ToUniversalTime().ToString("o")
  $status["restoreVerifiedFileName"] = $latest.Name
  $status["restoreVerifiedTableCount"] = [int]$tableCount
  $status | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $statusPath

  Write-Host "Restore verification OK: $($latest.Name), tables=$tableCount"
}
finally {
  docker compose --env-file $EnvFile exec -T postgres dropdb -U $dbUser --if-exists $tempDb | Out-Null
  docker compose --env-file $EnvFile exec -T postgres rm -f $containerFile | Out-Null
}
