# copier_shortcuts.ps1 -- makes (or removes) the three laptop Desktop shortcuts for the checkpoint copier (CKP-3, owner
# 2026-11-18 17:10 "yes add the shortcut"): "Copier - Pause", "Copier - Resume", "Copier - Status". Each starts
# wscript.exe copier_shortcut.vbs <action>: no console window, one message box. The .lnk files live only on the Desktop;
# the scripts they call stay in the repo. Called by `env_sync.sh poller shortcuts | shortcuts-remove`. No admin needed.
param([ValidateSet('create', 'remove')][string]$Action = 'create', [string]$Desktop = '')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $PSCommandPath
$vbs = Join-Path $here 'copier_shortcut.vbs'
if (-not $Desktop) { $Desktop = Join-Path $env:USERPROFILE 'OneDrive\Desktop' }
if (-not (Test-Path -LiteralPath $Desktop)) { "error=no Desktop folder at $Desktop"; exit 1 }
$items = @(
  @{ Name = 'Copier - Pause'; Arg = 'pause'; Tip = 'Pause the checkpoint copier (BoQ Checkpoint Poller)' },
  @{ Name = 'Copier - Resume'; Arg = 'resume'; Tip = 'Turn the checkpoint copier back on' },
  @{ Name = 'Copier - Status'; Arg = 'status'; Tip = 'Show what the checkpoint copier last did (read-only)' },
  @{ Name = 'Leaving'; Arg = 'leaving'; Tip = 'Leaving the office: checkpoint every running dev session now (wait for READY in the chat)' }
)
$ws = New-Object -ComObject WScript.Shell
foreach ($i in $items) {
  $lnk = Join-Path $Desktop ($i.Name + '.lnk')
  if ($Action -eq 'remove') {
    if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk; "removed=$lnk" } else { "absent=$lnk" }
    continue
  }
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $s.Arguments = '//Nologo "' + $vbs + '" ' + $i.Arg
  $s.WorkingDirectory = $here
  $s.Description = $i.Tip
  $s.WindowStyle = 7
  $s.Save()
  "shortcut=$lnk -> wscript.exe $($s.Arguments)"
}
