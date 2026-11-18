# poller_task.ps1 -- the LAPTOP's scheduled task "BoQ Checkpoint Poller" (CKP-3, 2026-11-18; owner 2026-11-18 02:42
# "rest yes" = MEM-R0 F11). Called by `env_sync.sh poller install | status | remove`. It is the ONE Windows change of
# CKP-3: a task for the logged-on user, "run only when the user is logged on" (no password is stored), least privilege.
#   triggers : every 15 minutes; at log-on; on network connect (NetworkProfile event 10000); on resume from sleep
#              (Power-Troubleshooter event 1)
#   action   : wscript.exe poller_hidden.vbs -> Git Bash poller_run.sh, hidden (no console window)
#   settings : one instance at a time (a new start is ignored while one runs); runs on battery; 3 h limit
# -PrintOnly prints the task XML and registers nothing.
param(
  [ValidateSet('install', 'status', 'remove')][string]$Action = 'status',
  [string]$TaskName = 'BoQ Checkpoint Poller',
  [switch]$PrintOnly
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $PSCommandPath
$vbs = Join-Path $here 'poller_hidden.vbs'
$user = "$env:USERDOMAIN\$env:USERNAME"

function TaskXml {
  $start = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
  $net = '<QueryList><Query Id="0" Path="Microsoft-Windows-NetworkProfile/Operational"><Select Path="Microsoft-Windows-NetworkProfile/Operational">*[System[(EventID=10000)]]</Select></Query></QueryList>'
  $wake = '<QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name=''Microsoft-Windows-Power-Troubleshooter''] and (EventID=1)]]</Select></Query></QueryList>'
  $esc = { param($s) [System.Security.SecurityElement]::Escape($s) }
  @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>CKP-3: the laptop's checkpoint poller (scripts/env_sync/poller_run.sh). Copies the desktop slice's work to the laptop without Claude Code being open. Off switch: bash scripts/env_sync/env_sync.sh poller pause | resume | remove.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger><Repetition><Interval>PT15M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$start</StartBoundary><Enabled>true</Enabled></TimeTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>$(& $esc $user)</UserId></LogonTrigger>
    <EventTrigger><Enabled>true</Enabled><Subscription>$(& $esc $net)</Subscription></EventTrigger>
    <EventTrigger><Enabled>true</Enabled><Subscription>$(& $esc $wake)</Subscription></EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>$(& $esc $user)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT3H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>wscript.exe</Command><Arguments>//B //Nologo "$(& $esc $vbs)"</Arguments></Exec>
  </Actions>
</Task>
"@
}

if ($PrintOnly) { TaskXml; exit 0 }
switch ($Action) {
  'install' {
    if (-not (Test-Path -LiteralPath $vbs)) { "error=$vbs is missing"; exit 1 }
    Register-ScheduledTask -TaskName $TaskName -Xml (TaskXml) -Force | Out-Null
    "installed=$TaskName"
  }
  'remove' {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; "removed=$TaskName"
    } else { "removed=none (no task named $TaskName)" }
    exit 0
  }
}
$t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $t) { "task=not registered ($TaskName)"; exit 0 }
$i = Get-ScheduledTaskInfo -TaskName $TaskName
"task=$TaskName"
"state=$($t.State)"
"user=$($t.Principal.UserId)"
"logon_type=$($t.Principal.LogonType) (Interactive = run only when the user is logged on; no stored password)"
"run_level=$($t.Principal.RunLevel)"
"multiple_instances=$($t.Settings.MultipleInstances)"
"execution_time_limit=$($t.Settings.ExecutionTimeLimit)"
"action=$($t.Actions[0].Execute) $($t.Actions[0].Arguments)"
$n = 0
foreach ($g in $t.Triggers) {
  $n++
  $kind = $g.CimClass.CimClassName -replace '^MSFT_Task', ''
  $more = ''
  if ($g.Repetition -and $g.Repetition.Interval) { $more = " every $($g.Repetition.Interval)" }
  if ($g.Subscription) { if ($g.Subscription -match 'NetworkProfile') { $more = ' network connect (NetworkProfile 10000)' } elseif ($g.Subscription -match 'Power-Troubleshooter') { $more = ' resume from sleep (Power-Troubleshooter 1)' } }
  "trigger_$n=$kind$more"
}
"last_run=$($i.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss'))"
"last_result=$($i.LastTaskResult)"
"next_run=$(if ($i.NextRunTime) { $i.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { 'none' })"
