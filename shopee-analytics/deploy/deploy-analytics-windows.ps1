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
    # 用 compose 里的 schema 容器做逻辑备份（pg_dump），不依赖宿主机装客户端。
    docker compose --env-file runtime/.env --profile tools run --rm schema 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Fail '数据库备份失败，中止部署'
    }
    Write-Host '  ✅ 备份完成'
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

Write-Step '5/6 重建并启动应用'
Set-Location $desktopDir
# 代码在镜像里，必须重建；只重建 app 与 oauth，数据库与 worker 不动。
docker compose --env-file runtime/.env up -d --build app oauth
if ($LASTEXITCODE -ne 0) { Fail '重建失败' }

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
