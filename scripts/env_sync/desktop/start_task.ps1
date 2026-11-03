# Runs on the DESKTOP host, over SSH, from env_sync.sh session-start / session-send.
# A process started inside an SSH session dies when that session closes, and so would a Claude background service
# started from it. So the launch is handed to Task Scheduler: a task in the owner's logged-on console session runs
# launch.ps1, exactly as if it had been typed at the desktop. This script registers that task, runs it, and waits
# for launch.ps1's result file. -PrintOnly prints the task name and its arguments and changes nothing.
param(
  [Parameter(Mandatory)][string]$Name,
  [ValidateSet('start', 'resume')][string]$Mode = 'start',
  [string]$SessionId = '',
  [switch]$PrintOnly
)
$here = Split-Path -Parent $PSCommandPath                    # <bench>\envsync\desktop
$sdir = Join-Path (Split-Path $here -Parent) 'sessions'
$out = Join-Path $sdir "$Name.launch.txt"
# One task per environment, so a main launch and a dev2 launch never overwrite each other's arguments. Every bench
# folder is called frappe-bench, so the name carries the folder that holds development/frappe-bench instead:
# envsync-claude-launch-frappe_docker (main), envsync-claude-launch-frappe_docker_dev2 (dev2).
$root = $here
foreach ($i in 1..4) { $root = Split-Path $root -Parent }
$task = 'envsync-claude-launch-' + (Split-Path $root -Leaf)
$argList = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$here\launch.ps1`" -Name $Name -Mode $Mode -SessionId `"$SessionId`""
if ($PrintOnly) { "task=$task"; "args=$argList"; exit 0 }
Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue

$console = (query user 2>$null) -match "^\s*>?$([regex]::Escape($env:USERNAME))\s+console\s+\d+\s+Active"
if (-not $console) { "error=$env:USERNAME is not logged on at the desktop console; log on there once, then retry"; exit 1 }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argList
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances Queue
Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $task

for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Milliseconds 1000
  if (Test-Path -LiteralPath $out) {
    $t = Get-Content -LiteralPath $out -Raw
    if ($t -match '(?m)^(done|error)=') { $t; exit 0 }
  }
}
"error=the launch task wrote no result within 120 s (task result $((Get-ScheduledTaskInfo -TaskName $task).LastTaskResult))"
exit 1
