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

    执行顺序（7 步）：
      1 当前版本 → 2 清理已退出的一次性容器 → 3 备份数据库（pg_dump）
      → 4 拉取代码 → 5 拉取后版本 → 6 重建镜像/应用 schema/启动服务 → 7 验证
      备份在第 3 步、改表结构在第 6 步 —— 顺序不能颠倒，
      否则 DDL 出问题时没有可回退的备份点。

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

# ★★ 为什么所有 docker 调用都要走这个函数
# 这台机器跑的是 Windows PowerShell 5.1。PS 5.1 有个老毛病：
# 当 $ErrorActionPreference = 'Stop' 时，**native command 的 stderr 输出会被当成
# terminating error**。而 docker compose 的正常输出走的就是 stderr ——
# 比如 "Container shopee-analytics-postgres-1 Running" 这类状态行。
# 结果是：schema 那一步明明成功了，却因为一行状态输出被当成失败，
# ps1 直接退出，容器不重建，线上一直停在旧版本。
#
# 做法：用 cmd /c 包一层，stderr 不再被 PowerShell 特殊对待，
# 退出码照常从 $LASTEXITCODE 取。输出照常显示，判断照常生效，两边都不失真。
function Invoke-DockerCompose {
    param(
        [string[]]$Arguments,
        [switch]$Quiet   # 只看退出码，不打印输出（用于输出很长的命令）
    )

    # ★ 重定向必须发生在 cmd 内部。若写成 PowerShell 层的 2>&1，
    #   docker 的 stderr 会被 PowerShell 当成 error record（PS 5.1 下会终止脚本）。
    #   放进 cmd 的命令行里，重定向由 cmd 完成，docker 的 stderr 变成 cmd 的 stdout。
    $cmd = 'docker compose ' + ($Arguments -join ' ') + ' 2>&1'
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & cmd /c $cmd
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if (-not $Quiet) { $output | Out-Host }
    if ($code -ne 0) {
        # 失败时一定要看到输出 —— 那才是原因。
        $output | Out-Host
        Fail "docker compose $($Arguments -join ' ') 失败（退出码 $code）"
    }
    return $code
}

Write-Step '1/7 当前版本'
$prevLog = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    git log --oneline -1
    $ErrorActionPreference = $prevLog
Write-Host "分支：$(git rev-parse --abbrev-ref HEAD)"

Write-Step '2/7 清理已退出的一次性容器'
# 为什么需要这一步：像 shopee-oauth-bootstrap-1101364305 这类一次性 bootstrap 容器
# 退出后仍留在容器列表里，每次 docker compose 都会为它输出一行 stderr warning。
# 而本脚本设了 $ErrorActionPreference='Stop'，PowerShell 会把 native command 的
# stderr 输出当成 terminating error —— 于是部署在第一步就假失败，实际什么都没做。
# 只删除已退出的容器（Exited 状态），绝不碰正在运行的服务容器。
$exitedContainers = docker ps -a --filter 'status=exited' --format '{{.ID}} {{.Names}}' 2>$null
if ($exitedContainers) {
    foreach ($line in $exitedContainers) {
        $parts = $line -split '\s+', 2
        if ($parts.Count -lt 2) { continue }
        $cid = $parts[0].Trim()
        $cname = $parts[1].Trim()
        if (-not $cid) { continue }
        Write-Host "  清理已退出容器: $cname ($cid)"
        # 同样避开 2>&1 —— docker rm 的正常输出走 stderr。
        $previousRm = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        docker rm -f $cid | Out-Null
        $ErrorActionPreference = $previousRm
    }
}

Write-Step '3/7 备份数据库'
# 注意：这一步是**真正的备份**（pg_dump + pg_restore --list 校验）。
# 第 5 步里那个 schema 容器执行的是 DDL（建表/改表），不是备份 —— 别把两者混为一谈。
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

    # ★ 备份也走 Invoke-DockerCompose —— 理由同上：PS 5.1 会把 docker 的
    #   stderr 状态输出当成 terminating error。这里失败更致命（备份中断整个部署）。
    Invoke-DockerCompose -Arguments @('--env-file', 'runtime/.env', 'exec', '-T', 'postgres',
        'pg_dump', '-U', $cfg['POSTGRES_USER'], '-d', $cfg['POSTGRES_DB'], '-Fc', '-f', "/tmp/$fileName") | Out-Null

    # 校验用的 pg_restore --list 会列出每个表，输出很长 —— 只看退出码，不刷屏。
    Invoke-DockerCompose -Quiet -Arguments @('--env-file', 'runtime/.env', 'exec', '-T', 'postgres',
        'pg_restore', '--list', "/tmp/$fileName") | Out-Null

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

Write-Step '4/7 拉取代码'
Set-Location $repoRoot

# ★ 网络重试
# 这台机器走代理访问 github.com，git 协议会间歇性失败（CONNECT tunnel 502）。
# 那属于瞬时故障，重试通常就过去了 —— 不重试的话，一次抖动就会让整次部署失败，
# 而仓库里的改动还静静躺在远端。fetch 与 pull 都重试。
function Invoke-GitWithRetry {
    param(
        [string[]]$Arguments,
        [int]$MaxAttempts = 5,
        [int]$BaseDelaySeconds = 3
    )
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        # ★ 绝不能用 2>&1 —— PS 5.1 会把 native command 的 stderr 当成
        #   terminating error，而 git fetch 的正常输出（"From https://github.com/..."）
        #   就走 stderr。于是明明拉取成功，却被判成失败直接退出。
        #   改成局部把 ErrorActionPreference 降到 Continue：stderr 不再终止脚本，
        #   真实失败仍由退出码判断。
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = & git @Arguments
            $code = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previous
        }
        # 用 $code 而不是 $LASTEXITCODE —— 后者在 try/finally 之后可能已被重置。
        if ($code -eq 0) { return $output }
        if ($attempt -lt $MaxAttempts) {
            $delay = $BaseDelaySeconds * $attempt
            Write-Host ("  git {0} 失败（第 {1}/{2} 次），{3}s 后重试" -f ($Arguments -join ' '), $attempt, $MaxAttempts, $delay)
            Start-Sleep -Seconds $delay
        }
        else {
            Write-Host $output | Out-Host
        }
    }
    return $output
}

Invoke-GitWithRetry -Arguments @('fetch', 'origin', '--prune') | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'git fetch 失败（网络不通，重试后仍失败）' }

if ((git status --porcelain | Where-Object { $_ -notmatch '^\?\?' }).Count -gt 0) {
    Write-Host '⚠️  工作区有已跟踪文件的本地改动，为避免覆盖，中止：' -ForegroundColor Yellow
    git status --short | Select-Object -First 10 | Out-Host
    Fail '请先确认这些改动是否还需要（stash / 提交 / 丢弃），再重新执行'
}
if ((git rev-parse --abbrev-ref HEAD) -ne $Branch) {
    Invoke-GitWithRetry -Arguments @('checkout', $Branch) | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "切换到 $Branch 失败" }
}
# pull 同样走重试 —— 网络抖动时不该让整次部署失败。
Invoke-GitWithRetry -Arguments @('pull', '--ff-only', 'origin', $Branch) | Out-Null
if ($LASTEXITCODE -ne 0) { Fail '拉取失败（网络不通，重试后仍失败）' }

Write-Step '5/7 拉取后版本'
$prevLog = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    git log --oneline -1
    $ErrorActionPreference = $prevLog
Write-Host "分支：$(git rev-parse --abbrev-ref HEAD)"

if ($NoRestart) {
    Write-Step '已按要求跳过重建'
    exit 0
}

Write-Step '6/7 重建镜像、应用 schema、启动服务'
Set-Location $desktopDir

# （docker 调用统一走上面定义的 Invoke-DockerCompose —— 那里写了为什么：
#  PS 5.1 会把 native command 的 stderr 当成 terminating error，
#  docker 的正常状态输出走 stderr，会让这一步假失败。）

# ★ 必须带 --profile tools
# schema 与 preflight 服务在 profiles: ["tools"] 里，而 `docker compose build`
# 默认只构建当前 profile 下的服务 —— 不加 profile 时它们会被跳过，
# 导致 schema 容器跑的是旧镜像里的旧 schema.sql（新增的表不会建出来）。
Invoke-DockerCompose -Arguments @('--env-file', 'runtime/.env', '--profile', 'tools', 'build') | Out-Null

# ★ 这一步是**执行 schema（DDL）**，不是备份。
# 它会用刚构建的镜像跑 schema.sql 等 DDL 文件（事务包裹 + ROLLBACK 保护，幂等），
# 把新增的表建出来。真正的备份在第 3 步的 pg_dump —— 两者别混为一谈。
# 顺序很重要：先备份（第 3 步）再改表结构（这里），万一 DDL 出问题还有回退点。
Invoke-DockerCompose -Arguments @('--env-file', 'runtime/.env', '--profile', 'tools', 'run', '--rm', 'schema') | Out-Null

# ★ 必须重建 worker
# 原来这里只 `up -d app oauth`，worker 与 oauth 的传递依赖会落后于代码改动 ——
# 表现为「前端已更新但后台同步任务还是旧代码」。
# 上面第 6 步的 build 已经把镜像建好了，所以这里的 --build 只会命中缓存，
# 不会重复构建 —— 它只是确保 app/oauth/worker 三者用的是同一批新镜像。
Invoke-DockerCompose -Arguments @('--env-file', 'runtime/.env', 'up', '-d', '--build', 'app', 'oauth', 'worker') | Out-Null

Write-Step '7/7 验证'
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
