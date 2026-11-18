# detect_units.ps1 -- runs on the DESKTOP host over SSH, READ-ONLY (CKP-4 D1, 2026-11-18): which Claude Code sessions are
# working in a Stack checkout right now, whichever chat or project started them. It reads process command lines, Claude's
# own job / transcript files, the start_task status files and git state. It starts nothing, stops nothing, writes nothing.
#
#   powershell -File detect_units.ps1 [-Envs "main=<checkout>;dev2=<checkout>"] [-ActiveMinutes 10]
#
# Output, one line each ('|' separated):
#   ssh=ok
#   unit|<env>|<checkout path>|<branch>|<head>|<state key>|<changed files>|<sessions>
#       <sessions> = name:shortid:state:status-first-word, comma separated; empty when no session works there
#       <state key> = HEAD + a hash of the uncommitted work (the declared noise left out): it changes when the tree does
#   point|<env>|<session name>|<the newest DBCOPY-POINT line of that session's status file>
#   dev2_containers=<n running>
# A unit is every git worktree of an environment's checkout that exists on this machine (so a second branch in a separate
# worktree is its own unit). Sessions are matched to the worktree whose path is the longest prefix of their folder.
param(
  [string]$Envs = 'main=C:\Users\USER\Documents\frappe_docker\development\frappe-bench\apps\nirmaan_stack;dev2=C:\Users\USER\Documents\frappe_docker_dev2\development\frappe-bench\apps\nirmaan_stack',
  [int]$ActiveMinutes = 10
)
$ErrorActionPreference = 'SilentlyContinue'
'ssh=ok'
$noise = @('BOQ-26-00145_SOW_faithful.csv', 'Handover doc.pdf', '_classification_review/', 'tendering-won.patch')
function Norm($p) { ($p -replace '/', '\').TrimEnd('\').ToLower() }
function Enc($p) { ($p -replace '[^A-Za-z0-9]', '-') }                 # Claude's projects-folder name for a working folder

# ---- live sessions: (id, folder, name, state) -------------------------------------------------------------------
$procs = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^claude' })
$ids = @{}
foreach ($p in $procs) {
  if ($p.CommandLine -match '--bg-pty-host') { continue }
  if ($p.CommandLine -match '--session-id\s+([0-9a-f]{8})-[0-9a-f-]{27}') { $ids[$Matches[1]] = $true }
}
$sessions = @()
$jobs = Join-Path $env:USERPROFILE '.claude\jobs'
foreach ($short in $ids.Keys) {
  $j = Get-Content (Join-Path $jobs "$short\state.json") -Raw | ConvertFrom-Json
  if ($j -and $j.cwd) { $sessions += [pscustomobject]@{ Id = $short; Cwd = (Norm $j.cwd); Name = "$($j.name)"; State = "$($j.state)" } }
}
# Sessions with no job file (typed at the console, or another launcher): a transcript written in the last few minutes while a
# claude process without a job is alive. The folder is recognised by Claude's own projects-folder name.
$loose = @($procs | Where-Object { $_.CommandLine -notmatch '--session-id|--bg-pty-host|daemon run' }).Count
$recent = @()
if ($loose -gt 0 -or $ids.Count -gt $sessions.Count) {
  $cut = (Get-Date).AddMinutes(-$ActiveMinutes)
  $recent = @(Get-ChildItem (Join-Path $env:USERPROFILE '.claude\projects') -Directory | ForEach-Object {
    $d = $_; Get-ChildItem $d.FullName -Filter '*.jsonl' | Where-Object { $_.LastWriteTime -gt $cut } | ForEach-Object { [pscustomobject]@{ Folder = $d.Name; Id = $_.BaseName.Substring(0, 8) } } })
}

# ---- units: every existing worktree of every environment ----------------------------------------------------------
foreach ($pair in ($Envs -split ';')) {
  $env_name, $root = $pair -split '=', 2
  if (-not (Test-Path -LiteralPath $root)) { continue }
  $bench = Split-Path (Split-Path $root -Parent) -Parent
  $trees = @()
  $cur = $null
  foreach ($l in (git -C $root worktree list --porcelain)) {
    if ($l -match '^worktree (.+)$') { $cur = $Matches[1] }
    elseif ($l -eq '' -and $cur) { if (Test-Path -LiteralPath $cur) { $trees += $cur }; $cur = $null }
  }
  if ($cur -and (Test-Path -LiteralPath $cur)) { $trees += $cur }
  if ($trees.Count -eq 0) { $trees = @($root) }
  $normed = @($trees | ForEach-Object { Norm $_ })
  foreach ($t in $trees) {
    $nt = Norm $t
    $branch = git -C $t rev-parse --abbrev-ref HEAD
    $head = git -C $t rev-parse HEAD
    $por = @(git -C $t status --porcelain | Where-Object { $line = $_; -not ($noise | Where-Object { $line.Substring(3).Trim('"').StartsWith($_) }) })
    $diff = (git -C $t diff HEAD --stat | Out-String)
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $key = $head.Substring(0, 12) + '-' + ([BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes(($por -join "`n") + $diff))) -replace '-', '').Substring(0, 12).ToLower()
    $mine = @()
    foreach ($s in $sessions) {
      # the session belongs to the worktree with the LONGEST path that is a prefix of its folder
      $best = $normed | Where-Object { $s.Cwd -eq $_ -or $s.Cwd.StartsWith($_ + '\') } | Sort-Object Length -Descending | Select-Object -First 1
      if ($best -eq $nt) {
        $first = ''
        $sf = Join-Path $bench "envsync\sessions\$($s.Name).status.md"
        if ($s.Name -and (Test-Path -LiteralPath $sf)) {
          $first = ((Get-Content -LiteralPath $sf -TotalCount 1) -split ' ')[0]
          $pt = Get-Content -LiteralPath $sf | Select-String -Pattern '^DBCOPY-POINT' | Select-Object -First 1
          if ($pt) { "point|$env_name|$($s.Name)|$($pt.Line)" }
        }
        $mine += ($(if ($s.Name) { $s.Name } else { 'unnamed' }) + ':' + $s.Id + ':' + $s.State + ':' + $first)
      }
    }
    $encT = Enc $t
    foreach ($r in $recent) {
      if ($r.Folder -eq $encT -and -not ($sessions | Where-Object { $_.Id -eq $r.Id })) { $mine += ('console:' + $r.Id + ':active:') }
    }
    "unit|$env_name|$($t -replace '\\', '/')|$branch|$head|$key|$($por.Count)|$($mine -join ',')"
  }
}
"dev2_containers=" + @(docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match '^frappe_dev2-' }).Count
