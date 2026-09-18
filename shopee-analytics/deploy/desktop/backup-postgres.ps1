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

function Write-Status([hashtable]$Status) {
  $runtime = Join-Path $ScriptDir "runtime"
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $statusPath = Join-Path $runtime "backup-status.json"
  $Status | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $statusPath
}

$cfg = Read-DotEnv $EnvFile
$db = $cfg["POSTGRES_DB"]
$user = $cfg["POSTGRES_USER"]
$localDir = $cfg["SHOPEE_BACKUP_LOCAL_DIR"]
$nasDir = $cfg["SHOPEE_NAS_BACKUP_DIR"]

if (!$db -or !$user) { throw "POSTGRES_DB / POSTGRES_USER missing in runtime\.env" }
if (!$localDir) { throw "SHOPEE_BACKUP_LOCAL_DIR missing in runtime\.env" }
if (!$nasDir) { throw "SHOPEE_NAS_BACKUP_DIR missing in runtime\.env" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fileName = "shopee-analytics-$stamp.dump"
$containerFile = "/tmp/$fileName"
$localFile = Join-Path $localDir $fileName

try {
  New-Item -ItemType Directory -Force -Path $localDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $nasDir "daily") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $nasDir "weekly") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $nasDir "monthly") | Out-Null

  docker compose --env-file $EnvFile exec -T postgres `
    pg_dump -U $user -d $db -Fc -f $containerFile
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }

  docker compose --env-file $EnvFile exec -T postgres `
    pg_restore --list $containerFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "pg_restore --list validation failed" }

  $containerId = (docker compose --env-file $EnvFile ps -q postgres).Trim()
  if (!$containerId) { throw "postgres container not found" }

  docker cp "$containerId`:$containerFile" $localFile
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed" }

  docker compose --env-file $EnvFile exec -T postgres rm -f $containerFile | Out-Null

  $hash = (Get-FileHash -Algorithm SHA256 $localFile).Hash.ToLower()
  $size = (Get-Item $localFile).Length
  $dailyFile = Join-Path (Join-Path $nasDir "daily") $fileName
  Copy-Item $localFile $dailyFile -Force

  $now = Get-Date
  if ($now.DayOfWeek -eq [DayOfWeek]::Sunday) {
    Copy-Item $localFile (Join-Path (Join-Path $nasDir "weekly") $fileName) -Force
  }
  if ($now.Day -eq 1) {
    Copy-Item $localFile (Join-Path (Join-Path $nasDir "monthly") $fileName) -Force
  }

  Get-ChildItem $localDir -Filter "shopee-analytics-*.dump" -File |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force

  Get-ChildItem (Join-Path $nasDir "daily") -Filter "shopee-analytics-*.dump" -File |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force

  Get-ChildItem (Join-Path $nasDir "weekly") -Filter "shopee-analytics-*.dump" -File |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
    Remove-Item -Force

  Get-ChildItem (Join-Path $nasDir "monthly") -Filter "shopee-analytics-*.dump" -File |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-730) } |
    Remove-Item -Force

  $completed = (Get-Date).ToUniversalTime().ToString("o")
  Write-Status @{
    ok = $true
    completedAt = $completed
    fileName = $fileName
    sizeBytes = $size
    sha256 = $hash
    nasCopiedAt = $completed
    error = $null
  }

  Write-Host "Backup OK: $fileName ($([math]::Round($size / 1MB, 1)) MB)"
}
catch {
  Write-Status @{
    ok = $false
    completedAt = $null
    fileName = $fileName
    sizeBytes = 0
    sha256 = $null
    nasCopiedAt = $null
    error = $_.Exception.Message
  }
  throw
}
