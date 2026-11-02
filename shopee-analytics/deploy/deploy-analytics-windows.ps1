<#
.SYNOPSIS
    把 shopee-analytics 模块更新到运行中的桌面栈。

.DESCRIPTION
    生产架构：Cloudflare → Tunnel → Hitech 台式机 → Docker → Shopee Analytics。
    app 跑在 127.0.0.1:3090，oauth 跑在 127.0.0.1:3091。

    与 bash 版的差别：
      - 代码是**打进镜像**的，卷只挂了 ./runtime（配置）。
        所以 git pull 之后**必须重建镜像**，前端才会更新 —— 这一点与
        「静态文件由应用直接托管、pull 即生效」的说法相反，因为那是
        源码直跑时的情形。
      - 分支是 fix/shopee-brand-portal-modern-oauth-20261027，不是 main。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File deploy-analytics-windows.ps1
    powershell -ExecutionPolicy Bypass -File deploy-analytics-windows.ps1 -NoRestart
#>
[CmdletBinding()]
param(
    [string]$Branch = 'fix/shopee-brand-portal-modern-oauth-20261027',
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

function Write-Step([string]$message) {
    Write-Host ''
    Write-Host "=== $message ===" -ForegroundColor Cyan
}

function Fail([string]$message) {
    Write-Host ""
    Write-Host "✗ $message" -ForegroundColor Red
    exit 1
}

Write-Step '1/6 当前版本'
git log --oneline -1
Write-Host "分支：$(git rev-parse --abbrev-ref HEAD)"

Write-Step '2/6 备份数据库'
$desktopDir = Join-Path $repoRoot 'shopee-analytics\deploy\desktop'
Set-Location $desktopDir
if (Test-Path 'runtime\.env') {
    # 备份不依赖 NAS：pg_dump 导出后用 pg_restore --list 校验，再取出到本地目录。
    # 仓库自带的 backup-postgres.ps1 要求 NAS 路径已配置，未配置时会直接失败。
    $cfg = @{}
    Get-Content 'runtime\.env' | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $parts = $line.Split('=', 2)
            if ($parts.Count -eq 2) { $cfg[$parts[0]] = $parts[1] }
        }
    }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $fileName = "shopee-analytics-$stamp.dump"
    $backupDir = Join-Path $desktopDir 'runtime\backups'
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $localFile = Join-Path $backupDir $fileName

    docker compose --env-file runtime/.env exec -T postgres `
        pg_dump -U $cfg['POSTGRES_USER'] -d $cfg['POSTGRES_DB'] -Fc -f "/tmp/$fileName"
    if ($LASTEXITCODE -ne 0) { Fail 'pg_dump 失败，中止部署' }

    docker compose --env-file runtime/.env exec -T postgres `
        pg_restore --list "/tmp/$fileName" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail '备份校验失败，中止部署' }

    $containerId = (docker compose --env-file runtime/.env ps -q postgres).Trim()
    docker cp "${containerId}:/tmp/$fileName" $localFile
    if ($LASTEXITCODE -ne 0) { Fail '备份文件取出失败，中止部署' }
    docker compose --env-file runtime/.env exec -T postgres rm -f "/tmp/$fileName" | Out-Null

    $hash = (Get-FileHash -Algorithm SHA256 $localFile).Hash.ToLower()
    Write-Host "  ✅ 备份完成: $fileName ($((Get-Item $localFile).Length) bytes)"
    Write-Host "     sha256: $hash"
}
else {
    Write-Host '  （未找到 runtime\.env，跳过备份）'
}

Write-Step '3/6 拉取代码'
Set-Location $repoRoot
git fetch origin --prune
if ((git status --porcelain | Where-Object { $_ -notmatch '^\?\?' }).Count -gt 0) {
    Write-Host '⚠️  工作区有已跟踪文件的本地改动，为避免覆盖，中止：' -ForegroundColor Yellow
    git status --short | Select-Object -First 10 | Out-Host
    Fail '请先确认这些改动是否还需要（stash / 提交 / 丢弃），再重新执行'
}
if ((git rev-parse --abbrev-ref HEAD) -ne $Branch) {
    git checkout $Branch
    if ($LASTEXITCODE -ne 0) { Fail "切换到 $Branch 失败" }
}
git pull --ff-only origin $Branch
if ($LASTEXITCODE -ne 0) { Fail '拉取失败' }

Write-Step '4/6 拉取后版本'
git log --oneline -1
Write-Host "分支：$(git rev-parse --abbrev-ref HEAD)"

if ($NoRestart) {
    Write-Step '已按要求跳过重建'
    exit 0
}

Write-Step '5/6 重建镜像、应用 schema、启动服务'
Set-Location $desktopDir

# ★ 必须带 --profile tools
# schema 与 preflight 服务在 profiles: ["tools"] 里，而 `docker compose build`
# 默认只构建当前 profile 下的服务 —— 不加 profile 时它们会被跳过，
# 导致 schema 容器跑的是旧镜像里的旧 schema.sql（新增的表不会建出来）。
docker compose --env-file runtime/.env --profile tools build
if ($LASTEXITCODE -ne 0) { Fail '镜像构建失败' }

# schema 要用刚构建的镜像，且要能跑通
docker compose --env-file runtime/.env --profile tools run --rm schema 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Fail 'schema 应用失败' }

# 只重启 app 与 oauth，数据库与 worker 不动
docker compose --env-file runtime/.env up -d app oauth
if ($LASTEXITCODE -ne 0) { Fail '重启失败' }

Write-Step '6/6 验证'
Start-Sleep -Seconds 8

function Probe([string]$path, [int]$expect) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:3090$path" -UseBasicParsing -TimeoutSec 10
        $code = $response.StatusCode
    }
    catch {
        $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    }
    $mark = if ($code -eq $expect) { '✅' } else { '⚠️ ' }
    Write-Host ("  {0} {1,-38} {2}" -f $mark, $path, $code)
}

Probe '/api/shopee-analytics/health' 200
Probe '/connections' 200
Probe '/connections.html' 200
Probe '/app.js' 200

Write-Host ''
Write-Host '✅ 部署完成。浏览器打开 https://analytics.hitechanalysis.top 刷新即可看到「平台接入」入口。' -ForegroundColor Green
