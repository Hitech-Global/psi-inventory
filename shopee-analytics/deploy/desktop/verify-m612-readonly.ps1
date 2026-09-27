param(
  [long]$ShopId = 0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RequiredCommit = '205567d689422b328a043e492b1bda01a3d941b2'
$ExpectedBranch = 'feat/shopee-analytics-v1-foundation'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir '../../..')).Path
$RuntimeEnv = Join-Path $ScriptDir 'runtime/.env'

function Fail([string]$Message, [int]$Code = 1) {
  Write-Error $Message
  exit $Code
}

function Run-Git([string[]]$Args) {
  $output = & git -C $RepoRoot @Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail ("git {0} failed:`n{1}" -f ($Args -join ' '), ($output -join "`n")) 10
  }
  return @($output)
}

if (-not (Test-Path $RuntimeEnv)) {
  Fail "Missing runtime/.env. Refusing to guess credentials or database settings." 11
}

$branch = (Run-Git @('branch', '--show-current') | Select-Object -First 1).Trim()
if ($branch -ne $ExpectedBranch) {
  Fail "Wrong branch: $branch. Expected $ExpectedBranch. No checkout/pull/merge will be performed automatically." 12
}

$status = Run-Git @('status', '--porcelain')
if ($status.Count -gt 0 -and ($status -join '').Trim().Length -gt 0) {
  Fail "Git worktree is not clean. Refusing to rebuild the runtime. No stash/reset/clean was performed." 13
}

$head = (Run-Git @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
& git -C $RepoRoot cat-file -e "$RequiredCommit^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) {
  Fail "Required commit $RequiredCommit is not present in this local clone. Refusing to fetch/pull automatically." 14
}

& git -C $RepoRoot merge-base --is-ancestor $RequiredCommit HEAD
if ($LASTEXITCODE -ne 0) {
  Fail "Local HEAD $head does not contain required M612 fix $RequiredCommit. Update the local branch first; this script will not pull/merge/reset." 15
}

Write-Host "M612 read-only verification"
Write-Host "  branch : $branch"
Write-Host "  HEAD   : $head"
if ($ShopId -gt 0) {
  Write-Host "  shopId : $ShopId (explicit)"
} else {
  Write-Host "  shopId : auto-detect from stored M612 campaign data"
}
Write-Host "Safety: app-only rebuild; worker untouched; no Shopee API call; no sync; no schema; reconciliation uses SELECT only."

Push-Location $ScriptDir
try {
  & docker compose --env-file runtime/.env build app
  if ($LASTEXITCODE -ne 0) { Fail 'docker compose build app failed.' 20 }

  & docker compose --env-file runtime/.env up -d --no-deps app
  if ($LASTEXITCODE -ne 0) { Fail 'docker compose app recreation failed.' 21 }

  $healthy = $false
  for ($i = 0; $i -lt 30; $i += 1) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3090/api/shopee-analytics/health' -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $healthy) { Fail 'App health did not become HTTP 200 after app-only recreation.' 22 }

  $runtimeCheck = @'
const { adsPercentToFraction, normalizeCampaignMetric } = require('./shopee-analytics/src/sync-product-ads');
const row = normalizeCampaignMetric({
  impression: 697,
  click: 36,
  ctr: 0.0516,
  cr: 0.0278,
  direct_cr: 0.0278,
  broad_order: 1,
  direct_order: 1,
  broad_gmv: 98,
  direct_gmv: 98,
  expense: 21.89,
  broad_roi: 4.48,
  direct_roi: 4.48,
  cpc: 21.89,
  cpdc: 21.89
});
if (adsPercentToFraction(0.0516) !== 0.0516) process.exit(31);
if (row.ctr !== 0.0516 || row.broadCvr !== 0.0278 || row.directCvr !== 0.0278) process.exit(32);
if (row.addToCart !== null || row.addToCartRate !== null) process.exit(33);
console.log('M612_SOURCE_PRECISION_RUNTIME=PASS');
'@

  & docker compose --env-file runtime/.env exec -T app node -e $runtimeCheck
  if ($LASTEXITCODE -ne 0) { Fail 'Running app container does not have the required M612 source-precision contract.' 23 }

  Write-Host 'Running SELECT-only reconciliation against the existing PostgreSQL data...'
  if ($ShopId -gt 0) {
    & docker compose --env-file runtime/.env exec -T -e "SHOPEE_VERIFY_SHOP_ID=$ShopId" app node shopee-analytics/scripts/reconcile-m612-readonly.cjs
  } else {
    & docker compose --env-file runtime/.env exec -T app node shopee-analytics/scripts/reconcile-m612-readonly.cjs
  }
  $reconcileExit = $LASTEXITCODE

  if ($reconcileExit -eq 0) {
    Write-Host 'M612 reconciliation status: PASS'
    exit 0
  }
  if ($reconcileExit -eq 3) {
    Write-Host 'M612 reconciliation status: INCOMPLETE (one or more expected source metrics are unavailable, typically historical ATC).'
    exit 3
  }
  Fail "M612 reconciliation failed with exit code $reconcileExit." 24
} finally {
  Pop-Location
}
