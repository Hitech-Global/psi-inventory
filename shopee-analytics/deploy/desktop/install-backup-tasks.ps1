$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$BackupScript = Join-Path $ScriptDir "backup-postgres.ps1"
$RestoreScript = Join-Path $ScriptDir "verify-restore.ps1"

$backupAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$BackupScript`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At 3:30AM
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Shopee Analytics NAS Backup" -Action $backupAction -Trigger $backupTrigger -Settings $backupSettings -Description "Daily PostgreSQL backup to local disk and NAS" -Force | Out-Null

$restoreAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RestoreScript`""
$restoreTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 4:30AM
$restoreSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Shopee Analytics Restore Verification" -Action $restoreAction -Trigger $restoreTrigger -Settings $restoreSettings -Description "Weekly restore test of latest Shopee Analytics PostgreSQL backup" -Force | Out-Null

Write-Host "Scheduled tasks installed:"
Write-Host "  Shopee Analytics NAS Backup          daily 03:30"
Write-Host "  Shopee Analytics Restore Verification Sunday 04:30"
Write-Host "Both tasks use StartWhenAvailable, so a missed run can execute after the desktop resumes."
