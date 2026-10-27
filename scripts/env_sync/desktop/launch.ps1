# Runs on the DESKTOP host inside the owner's console session, started by the envsync-claude-launch task
# (start_task.ps1). Starts, or resumes with a relayed message, a Claude background session in the repo, then writes
# <sessions>\<Name>.launch.txt for start_task.ps1. The session keeps running in Claude's background service after
# this script exits.
param(
  [Parameter(Mandatory)][string]$Name,
  [ValidateSet('start', 'resume')][string]$Mode = 'start',
  [string]$SessionId = ''
)
$here = Split-Path -Parent $PSCommandPath                    # <bench>\envsync\desktop
$bench = Split-Path (Split-Path $here -Parent) -Parent
$repo = Join-Path $bench 'apps\nirmaan_stack'
$sdir = Join-Path $bench 'envsync\sessions'
$out = Join-Path $sdir "$Name.launch.txt"
$log = @()
try {
  $claude = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
  if (-not (Test-Path $claude)) { $claude = (Get-Command claude -ErrorAction Stop).Source }
  $file = if ($Mode -eq 'start') { "$sdir\$Name.brief.md" } else { "$sdir\$Name.message.md" }
  if (-not (Test-Path -LiteralPath $file)) { throw "missing $file" }
  # The prompt stays a single line with no quotes: PowerShell 5.1 mangles embedded quotes passed to native programs.
  $prompt = "Read the file $($file -replace '\\', '/') and follow it."
  Set-Location $repo
  # Claude prints progress notes on stderr; turn each line into plain text, not a PowerShell error record.
  function Run { & $claude @args 2>&1 | ForEach-Object { "$_" } }
  if ($Mode -eq 'resume') {
    if (-not $SessionId) { throw 'resume needs -SessionId' }
    # `claude stop` takes the short id (the first 8 characters), not the full session id. A session still running
    # would make --resume start a copy instead of continuing it.
    $log += Run stop $SessionId.Substring(0, 8)
    for ($i = 0; $i -lt 30; $i++) {
      $live = (& $claude agents --json 2>$null | Out-String | ConvertFrom-Json) | Where-Object { $_.sessionId -eq $SessionId }
      if (-not $live) { break }
      Start-Sleep 1
    }
    # No other flags: a background session keeps its own saved options, and any flag here would start a copy.
    $log += Run --bg --resume $SessionId $prompt
  } else {
    $log += Run --bg -n $Name --permission-mode auto $prompt
  }
  if ($LASTEXITCODE -ne 0) { throw "claude --bg exited with code $LASTEXITCODE" }
  (($log -join "`n").Trim() + "`ndone=$((Get-Date).ToString('HH:mm:ss'))") | Out-File -Encoding utf8 -LiteralPath $out
} catch {
  (($log -join "`n").Trim() + "`nerror=$($_.Exception.Message)") | Out-File -Encoding utf8 -LiteralPath $out
}
