$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$BackupScript = Join-Path $ScriptDir "backup-postgres.ps1"
$RestoreScript = Join-Path $ScriptDir "verify-restore.ps1"

# 任务名不带 NAS：共享盘是可选的，备份本来就落在本地，
# 共享盘只是额外一份副本。名字带上 NAS 会在共享盘没配时让人误以为备份没生效。
$backupAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$BackupScript`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At 3:30AM
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Shopee Analytics PostgreSQL Backup" -Action $backupAction -Trigger $backupTrigger -Settings $backupSettings -Description "Daily PostgreSQL backup to local disk (and the shared folder when it is configured)" -Force | Out-Null

$restoreAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RestoreScript`""
$restoreTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 4:30AM
$restoreSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Shopee Analytics Restore Verification" -Action $restoreAction -Trigger $restoreTrigger -Settings $restoreSettings -Description "Weekly restore test of latest Shopee Analytics PostgreSQL backup" -Force | Out-Null

Write-Host "Scheduled tasks installed:"
Write-Host "  Shopee Analytics PostgreSQL Backup    daily 03:30"
Write-Host "  Shopee Analytics Restore Verification Sunday 04:30"
Write-Host "Both tasks use StartWhenAvailable, so a missed run can execute after the desktop resumes."

# 立刻跑一次备份，确认任务真正能干活 —— 装了任务不等于备份在跑。
Write-Host ""
Write-Host "Running the backup once to confirm it works..."
& $BackupScript
if ($LASTEXITCODE -ne 0) { throw "First backup run failed" }
