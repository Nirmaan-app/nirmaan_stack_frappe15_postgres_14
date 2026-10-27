#!/usr/bin/env bash
# env_sync.sh -- the LAPTOP side of the owner's two-machine loop (docs/agents/environments.md).
# Runs on the laptop in Git Bash. Every transfer goes through the desktop's SSH server (scp + git bundles);
# nothing here talks to GitHub, and nothing here ever pushes to origin.
#
#   env_sync.sh status [--no-data]     code and data on both machines, and a verdict
#   env_sync.sh to-desktop             fast-forward the desktop to the laptop's commits, then destale it
#   env_sync.sh from-desktop           fast-forward the laptop to the desktop's commits, then destale it
#   env_sync.sh db-pull --yes          replace the laptop's database with a fresh backup of the desktop's (the master)
#   env_sync.sh db-push --yes [--discard-desktop-writes]
#                                      after a desktop drop (the laptop was the master): replace the DESKTOP's database
#                                      with a fresh backup of the laptop's, after a proved desktop backup
#   env_sync.sh reports               copy new or newer files from the desktop's Desktop to the laptop's Desktop
#   env_sync.sh watch [--logs NAME]    one monitoring snapshot: desktop commits, changes, servers, Claude sessions
#
# Delegating work to a Claude session on the desktop (the session runs in the owner's console session through Task
# Scheduler, so no SSH connection has to stay open):
#   env_sync.sh session-start --brief FILE [--name N]     hand over the code if needed, then start a session on FILE
#   env_sync.sh session-wait --name N [--pull-back]       poll until it writes DONE / BLOCKED / FAILED (or stalls);
#                                                         with --pull-back, DONE runs from-desktop and reports
#   env_sync.sh session-send --name N --message FILE      relay an answer and resume the session
#   env_sync.sh session-stop --name N
#
# Flags: --allow-dirty (transfer although uncommitted tracked changes stay behind), --no-restart (skip the destale),
# --discard-desktop-writes (db-push although the desktop changed since the laptop's last pull: those writes are lost).
# Overrides: .claude/state/env.local (git-ignored) may set the ENV_SYNC_* variables below.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BENCH_HOST="$(cd "$REPO/../.." && pwd)"            # the laptop's frappe-bench, bind-mounted into its container
[ -f "$REPO/.claude/state/env.local" ] && . "$REPO/.claude/state/env.local"

DESKTOP="${ENV_SYNC_DESKTOP:-desktop}"                 # an alias in ~/.ssh/config (key login)
D_BENCH="${ENV_SYNC_DESKTOP_BENCH:-C:/Users/USER/Documents/frappe_docker/development/frappe-bench}"
D_REPORTS="${ENV_SYNC_DESKTOP_REPORTS:-C:/Users/USER/Desktop}"
L_REPORTS="${ENV_SYNC_LAPTOP_REPORTS:-$(cygpath -u "$USERPROFILE")/OneDrive/Desktop}"
FRAPPE_C="${ENV_SYNC_FRAPPE_CONTAINER:-frappe_docker_devcontainer-frappe-1}"
PG_C="${ENV_SYNC_PG_CONTAINER:-frappe_docker_devcontainer-postgresql-1}"
C_BENCH=/workspace/development/frappe-bench           # the same path inside both machines' containers
STAGE=envsync                                          # frappe-bench/envsync: seen by the host and the container
SDIR="$D_BENCH/$STAGE/sessions"                       # the desktop's brief / message / status / launch files
# The desktop's fingerprint as of the laptop's last db-pull (db-pull writes it, db-push checks it, db-push refreshes it).
PULL_RECORD="${ENV_SYNC_PULL_RECORD:-$BENCH_HOST/$STAGE/last_pull_fingerprint.txt}"
SSH=/c/Windows/System32/OpenSSH/ssh.exe
SCP=/c/Windows/System32/OpenSSH/scp.exe
SSHO=(-o BatchMode=yes -o ConnectTimeout=20)

die() { printf 'env_sync: %b\n' "$*" >&2; exit 2; }
kv() { printf '%s\n' "$2" | sed -n "s/^$1=//p" | head -1; }
lgit() { git -C "$REPO" "$@"; }
dps() { "$SSH" "${SSHO[@]}" "$DESKTOP" "$@" 2>&1 | tr -d '\r'; }   # a PowerShell command on the desktop
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

# Copy remote/ into frappe-bench/envsync on both machines, once per run.
ensure_stage() {
  [ -n "${STAGED:-}" ] && return 0
  mkdir -p "$BENCH_HOST/$STAGE" && cp "$HERE"/remote/* "$BENCH_HOST/$STAGE/" || die "cannot stage scripts on the laptop"
  dps "New-Item -ItemType Directory -Force -Path '$D_BENCH/$STAGE/desktop', '$SDIR' | Out-Null" > /dev/null
  "$SCP" -q "${SSHO[@]}" "$HERE"/remote/* "$DESKTOP:$D_BENCH/$STAGE/" || die "cannot reach the desktop over SSH ($DESKTOP)"
  "$SCP" -q "${SSHO[@]}" "$HERE"/desktop/*.ps1 "$DESKTOP:$D_BENCH/$STAGE/desktop/" || die "cannot stage the desktop launch scripts"
  STAGED=1
}

# rrun <laptop|desktop> <bash|py> <script> [plain-token args...]: run a staged script in that machine's frappe container.
rrun() {
  local m="$1" kind="$2" s="$3"; shift 3
  local interp=bash; [ "$kind" = py ] && interp=env/bin/python
  ensure_stage
  if [ "$m" = laptop ]; then
    MSYS_NO_PATHCONV=1 docker exec -u frappe -w "$C_BENCH" "$FRAPPE_C" $interp "$C_BENCH/$STAGE/$s" "$@" 2>&1
  else
    dps "docker exec -u frappe -w $C_BENCH $FRAPPE_C $interp $C_BENCH/$STAGE/$s $*"
  fi
}

start_services() {
  local m="$1" out
  if [ "$m" = laptop ]; then
    MSYS_NO_PATHCONV=1 docker exec -d -u frappe "$FRAPPE_C" bash "$C_BENCH/$STAGE/start_bench.sh"
  else
    dps "docker exec -d -u frappe $FRAPPE_C bash $C_BENCH/$STAGE/start_bench.sh" > /dev/null
  fi
  for _ in $(seq 1 60); do
    out=$(rrun "$m" bash ports.sh)
    if echo "$out" | grep -q '8000 open' && echo "$out" | grep -q '8080 open'; then echo "$m: bench :8000 and vite :8080 are up"; return 0; fi
    sleep 5
  done
  echo "$m: WARNING the servers are not up after 5 minutes; see /tmp/envsync_logs/ in its container"
}

# fp_of <laptop|desktop>: that machine's data fingerprint, the fp_* lines of db_fingerprint.py.
fp_of() { rrun "$1" py db_fingerprint.py | grep '^fp_'; }

# wait_ping <laptop|desktop>: wait until bench answers /api/method/ping (not merely listens); 0 on pong.
wait_ping() {
  local m="$1" r=""
  for _ in $(seq 1 60); do
    if [ "$m" = laptop ]; then r=$(MSYS_NO_PATHCONV=1 docker exec "$FRAPPE_C" curl -s -m 5 http://127.0.0.1:8000/api/method/ping 2>/dev/null)
    else r=$(dps "docker exec $FRAPPE_C curl -s -m 5 http://127.0.0.1:8000/api/method/ping"); fi
    case "$r" in *pong*) echo "$m: /api/method/ping answers"; return 0;; esac
    sleep 5
  done
  echo "$m: WARNING /api/method/ping did not answer in 5 minutes"; return 1
}

# d_cp_to_pg <folder on the desktop host> <file name> <container path>: copy a desktop file into its postgres container.
# Docker on Windows reads a C:\... source as container:path, so go to the folder and copy ./file.
d_cp_to_pg() {
  dps "Set-Location -LiteralPath '$1'; docker cp ./$2 ${PG_C}:$3; if (\$LASTEXITCODE -ne 0) { 'error=docker cp failed' }"
}

# After new code lands on a machine: migrate when schema-shaped files changed, destale unless only docs changed.
after_transfer() {
  local m="$1" changed="$2" mig=""
  echo "$changed" | grep -qE '(/doctype/.*\.json|patches\.txt|hooks\.py|/fixtures/.*\.json)$' && mig="--migrate"
  if ! echo "$changed" | grep -qvE '(\.md$|^\.claude/|^docs/|^scripts/)'; then echo "$m: nothing served changed (docs / scripts only), no restart needed"; return 0; fi
  if [ "${NO_RESTART:-0}" = 1 ]; then echo "$m: --no-restart given; destale it yourself before trusting what it serves"; return 0; fi
  echo "$m: destaling${mig:+ with migrate} ..."
  rrun "$m" bash destale.sh $mig | grep -vE '^(8000|8080) closed$' || die "$m: destale failed"
  start_services "$m"
}

# Fills L_* / D_* and VERDICT.
collect() {
  L_BRANCH=$(lgit rev-parse --abbrev-ref HEAD); L_HEAD=$(lgit rev-parse HEAD)
  L_DIRTY=$(lgit status --porcelain --untracked-files=no)
  local out; out=$(rrun desktop bash git_state.sh "$L_HEAD")
  D_BRANCH=$(kv branch "$out"); D_HEAD=$(kv head "$out")
  [ -n "$D_HEAD" ] || die "could not read the desktop's git state:\n$out"
  D_DIRTY=$(printf '%s\n' "$out" | sed -n 's/^dirtyfile=//p')
  D_AHEAD=$(kv ahead "$out"); D_LOG=$(printf '%s\n' "$out" | sed -n 's/^log=//p')
  if [ "$L_BRANCH" != "$D_BRANCH" ]; then VERDICT=BRANCH_MISMATCH
  elif [ "$L_HEAD" = "$D_HEAD" ]; then VERDICT=IN_SYNC
  elif lgit cat-file -e "$D_HEAD^{commit}" 2>/dev/null && lgit merge-base --is-ancestor "$D_HEAD" "$L_HEAD"; then VERDICT=LAPTOP_AHEAD
  elif [ "$(kv has_other "$out")" = 1 ] && [ "$(kv other_is_ancestor "$out")" = 1 ]; then VERDICT=DESKTOP_AHEAD
  else VERDICT=DIVERGED; fi
}

print_code() {
  local ln dn; ln=$(printf '%s' "$L_DIRTY" | grep -c .); dn=$(printf '%s' "$D_DIRTY" | grep -c .)
  echo "code"
  echo "  laptop   $L_BRANCH @ ${L_HEAD:0:9}   uncommitted tracked changes: $ln"
  [ "$ln" -gt 0 ] && printf '%s\n' "$L_DIRTY" | sed 's/^/             /'
  echo "  desktop  $D_BRANCH @ ${D_HEAD:0:9}   uncommitted tracked changes: $dn"
  [ "$dn" -gt 0 ] && printf '%s\n' "$D_DIRTY" | sed 's/^/             /'
  case $VERDICT in
    IN_SYNC)         echo "  verdict  IN_SYNC";;
    LAPTOP_AHEAD)    echo "  verdict  LAPTOP_AHEAD by $(lgit rev-list --count "$D_HEAD..$L_HEAD") commit(s)   next: env_sync.sh to-desktop";;
    DESKTOP_AHEAD)   echo "  verdict  DESKTOP_AHEAD by $D_AHEAD commit(s)   next: env_sync.sh from-desktop"
                     printf '%s\n' "$D_LOG" | sed 's/^/             /';;
    BRANCH_MISMATCH) echo "  verdict  BRANCH_MISMATCH: the machines are on different branches. STOP and ask the owner.";;
    DIVERGED)        echo "  verdict  DIVERGED: each machine has commits the other lacks. STOP and ask the owner; never auto-merge.";;
  esac
}

cmd_status() {
  collect; print_code
  if [ "${NO_DATA:-0}" != 1 ]; then
    local lf df; lf=$(rrun laptop py db_fingerprint.py | grep '^fp_'); df=$(rrun desktop py db_fingerprint.py | grep '^fp_')
    echo "data"
    printf '%s\n' "$lf" | sed 's/^fp_/  laptop   /'
    printf '%s\n' "$df" | sed 's/^fp_/  desktop  /; 1s/$/   (master)/'
    if [ "$lf" = "$df" ]; then echo "  verdict  SAME"
    else echo "  verdict  DIFFERENT: the laptop's copy is not the master's. Run env_sync.sh db-pull --yes before laptop work that needs live data."; fi
    echo "  master   the desktop; after a desktop drop the laptop, until db-push (docs/agents/environments.md, Desktop drop)"
  fi
  case $VERDICT in IN_SYNC) return 0;; LAPTOP_AHEAD) return 10;; DESKTOP_AHEAD) return 11;; *) return 20;; esac
}

cmd_to_desktop() {
  collect; print_code
  case $VERDICT in IN_SYNC) echo "nothing to send"; return 0;; LAPTOP_AHEAD) ;; *) die "refusing: the verdict is $VERDICT, to-desktop needs LAPTOP_AHEAD";; esac
  [ -z "$L_DIRTY" ] || [ "${ALLOW_DIRTY:-0}" = 1 ] || die "the laptop has uncommitted tracked changes, which would NOT travel.\nCommit or stash them, or pass --allow-dirty."
  local b="to-desktop-${L_HEAD:0:9}.bundle" out
  lgit bundle create -q "$TMPD/$b" "^$D_HEAD" "refs/heads/$L_BRANCH" || die "git bundle failed"
  "$SCP" -q "${SSHO[@]}" "$TMPD/$b" "$DESKTOP:$D_BENCH/$STAGE/$b" || die "copying the bundle to the desktop failed"
  out=$(rrun desktop bash apply_bundle.sh "$C_BENCH/$STAGE/$b" "$L_BRANCH" laptop)
  [ "$(kv after "$out")" = "$L_HEAD" ] || die "the desktop did not reach ${L_HEAD:0:9}; it is unchanged.\n$out"
  echo "desktop: fast-forwarded ${D_HEAD:0:9} -> ${L_HEAD:0:9}"
  after_transfer desktop "$(printf '%s\n' "$out" | sed -n 's/^changed=//p')"
}

cmd_from_desktop() {
  collect; print_code
  case $VERDICT in IN_SYNC) echo "nothing to fetch"; return 0;; DESKTOP_AHEAD) ;; *) die "refusing: the verdict is $VERDICT, from-desktop needs DESKTOP_AHEAD";; esac
  [ -z "$L_DIRTY" ] || die "the laptop has uncommitted tracked changes; commit or stash them before taking the desktop's commits."
  [ -z "$D_DIRTY" ] || [ "${ALLOW_DIRTY:-0}" = 1 ] || die "the desktop has uncommitted changes that would stay behind.\nCommit them on the desktop first, or pass --allow-dirty to bring only the commits."
  local b="from-desktop-${D_HEAD:0:9}.bundle" out before="$L_HEAD"
  out=$(rrun desktop bash make_bundle.sh "$L_HEAD" "$D_BRANCH" "$C_BENCH/$STAGE/$b")
  [ -n "$(kv bundle "$out")" ] || die "the desktop could not make the bundle:\n$out"
  "$SCP" -q "${SSHO[@]}" "$DESKTOP:$D_BENCH/$STAGE/$b" "$TMPD/$b" || die "copying the bundle back failed"
  dps "Remove-Item -LiteralPath '$D_BENCH/$STAGE/$b'" > /dev/null
  lgit fetch -q "$TMPD/$b" "+refs/heads/$D_BRANCH:refs/remotes/desktop/$D_BRANCH" || die "fetching the bundle failed"
  lgit merge --ff-only -q "desktop/$D_BRANCH" || die "the laptop refused the fast-forward; it is unchanged."
  echo "laptop: fast-forwarded ${before:0:9} -> $(lgit rev-parse --short=9 HEAD)"
  lgit log --oneline "$before..HEAD" | sed 's/^/  /'
  after_transfer laptop "$(lgit diff --name-only "$before" HEAD)"
  local ahead; ahead=$(lgit rev-list --count "origin/$L_BRANCH..HEAD" 2>/dev/null || echo "?")
  echo "the laptop is $ahead commit(s) ahead of origin/$L_BRANCH. The owner pushes to GitHub by hand."
}

cmd_db_pull() {
  [ "${YES:-0}" = 1 ] || die "db-pull REPLACES the laptop's database with a fresh backup of the desktop's (the master).\nRe-run with --yes."
  local out prefix db
  echo "desktop: backing up ..."
  out=$(rrun desktop bash backup.sh); prefix=$(kv prefix "$out")
  [ -n "$prefix" ] || die "the desktop backup failed:\n$out"
  mkdir -p "$BENCH_HOST/sites/$(dirname "$prefix")"
  for suf in -database.sql.gz -files.tar -private-files.tar; do
    "$SCP" -q "${SSHO[@]}" "$DESKTOP:$D_BENCH/sites/$prefix$suf" "$BENCH_HOST/sites/$prefix$suf" || die "copying $prefix$suf failed"
  done
  echo "laptop: copied $(basename "$prefix") ($(du -h "$BENCH_HOST/sites/$prefix-database.sql.gz" | cut -f1) database)"
  db=$(kv db_name "$(rrun laptop bash get_db_name.sh)"); [ -n "$db" ] || die "cannot read the laptop's database name"
  rrun laptop bash stop_bench.sh > /dev/null
  MSYS_NO_PATHCONV=1 docker cp "$(cygpath -w "$BENCH_HOST/sites/$prefix-database.sql.gz")" "$PG_C:/tmp/envsync_restore.sql.gz" || die "docker cp of the dump failed"
  MSYS_NO_PATHCONV=1 docker cp "$(cygpath -w "$HERE/remote/restore_db.sh")" "$PG_C:/tmp/envsync_restore_db.sh" || die "docker cp of restore_db.sh failed"
  echo "laptop: restoring the database ..."
  MSYS_NO_PATHCONV=1 docker exec "$PG_C" bash /tmp/envsync_restore_db.sh "$db" /tmp/envsync_restore.sql.gz || die "the database restore failed (bench is stopped)"
  rrun laptop bash restore_files.sh "$prefix" || die "files or migrate failed (bench is stopped)"
  start_services laptop
  # The laptop now holds exactly the desktop's backup: its fingerprint is the desktop's as of this pull. db-push
  # refuses later if the desktop has moved away from it (writes the laptop never saw).
  { echo "# desktop fingerprint at the laptop's last db-pull ($(date '+%F %T'), backup $(basename "$prefix"))"; fp_of laptop; } > "$PULL_RECORD"
  echo "laptop: recorded the pulled fingerprint in $PULL_RECORD"
  NO_DATA=0; cmd_status > "$TMPD/st" 2>&1; sed -n '/^data/,$p' "$TMPD/st"
}

# db-push: the laptop -> desktop twin of db-pull, for the owner's desktop-drop rule (2026-10-26): while the desktop was
# unreachable the laptop was the master, and on reconnect its data goes back BEFORE any desktop work. It wraps the hand
# procedure proven in SYNC-R (2026-10-26). Every guard runs before anything on the desktop changes.
cmd_db_push() {
  [ "${YES:-0}" = 1 ] || die "db-push REPLACES the DESKTOP's database (the master) with a fresh backup of the laptop's.\nUse it only after a desktop drop (docs/agents/environments.md, Desktop drop). Re-run with --yes."
  local t0 rec dfp lfp dfp2 lfp2 dprefix lprefix db out suf f lh dh run
  t0=$(date '+%F %T')
  collect; print_code
  [ "$VERDICT" = IN_SYNC ] || die "refusing: the code verdict is $VERDICT; bring the code over first (to-desktop) so both machines run the same migrations"
  dfp=$(fp_of desktop); lfp=$(fp_of laptop)
  [ -n "$dfp" ] && [ -n "$lfp" ] || die "could not read a fingerprint (laptop:\n$lfp\ndesktop:\n$dfp)"
  if [ ! -f "$PULL_RECORD" ]; then
    [ "${DISCARD:-0}" = 1 ] || die "refusing: there is no record of the laptop's last pull ($PULL_RECORD), so desktop writes since then cannot be ruled out.\nthe desktop now:\n$dfp\nIf the owner accepts losing any such writes, re-run with --discard-desktop-writes."
    echo "WARNING: no pull record; going on because --discard-desktop-writes was given"
  else
    rec=$(grep '^fp_' "$PULL_RECORD")
    if [ "$rec" != "$dfp" ]; then
      [ "${DISCARD:-0}" = 1 ] || die "refusing: the desktop has changed since the laptop's last pull, and its writes would be lost.\nrecorded at the last pull ($PULL_RECORD):\n$rec\nthe desktop now:\n$dfp\nAsk the owner. To overwrite anyway, re-run with --discard-desktop-writes."
      echo "WARNING: the desktop changed since the last pull; overwriting it because --discard-desktop-writes was given"
    fi
  fi
  echo "fingerprints before"; printf '%s\n' "$lfp" | sed 's/^fp_/  laptop   /'; printf '%s\n' "$dfp" | sed 's/^fp_/  desktop  /'

  db=$(kv db_name "$(rrun desktop bash get_db_name.sh)"); [ -n "$db" ] || die "cannot read the desktop's database name"
  echo "desktop: backing up (the safety copy) ..."
  out=$(rrun desktop bash backup.sh); dprefix=$(kv prefix "$out")
  [ -n "$dprefix" ] || die "the desktop backup failed; nothing changed:\n$out"
  out=$(rrun desktop bash prove_backup.sh "$dprefix"); printf '%s\n' "$out" | sed 's/^/  /'
  [ "$(kv proof "$out")" = ok ] || die "the desktop backup did not prove whole; nothing changed"
  out=$(d_cp_to_pg "$D_BENCH/sites/$(dirname "$dprefix")" "$(basename "$dprefix")-database.sql.gz" /tmp/envsync_check.sql.gz)
  printf '%s\n' "$out" | grep -q '^error=' && die "copying the desktop dump into its postgres container failed; nothing changed:\n$out"
  out=$(d_cp_to_pg "$D_BENCH/$STAGE" scratch_check.sh /tmp/envsync_scratch_check.sh)
  printf '%s\n' "$out" | grep -q '^error=' && die "copying scratch_check.sh failed; nothing changed:\n$out"
  echo "desktop: test-restoring the safety copy into a scratch database ..."
  out=$(dps "docker exec $PG_C bash /tmp/envsync_scratch_check.sh $db /tmp/envsync_check.sql.gz"); printf '%s\n' "$out" | sed 's/^/  /'
  printf '%s\n' "$out" | grep -qx 'check=PASS' || die "the desktop backup's test restore did not pass; nothing changed"

  echo "laptop: backing up ..."
  out=$(rrun laptop bash backup.sh); lprefix=$(kv prefix "$out")
  [ -n "$lprefix" ] || die "the laptop backup failed; nothing changed on the desktop:\n$out"
  out=$(rrun laptop bash prove_backup.sh "$lprefix")
  [ "$(kv proof "$out")" = ok ] || die "the laptop backup did not prove whole; nothing changed on the desktop:\n$out"
  for suf in -database.sql.gz -files.tar -private-files.tar; do
    f="$BENCH_HOST/sites/$lprefix$suf"
    "$SCP" -q "${SSHO[@]}" "$f" "$DESKTOP:$D_BENCH/sites/$lprefix$suf" || die "copying $lprefix$suf to the desktop failed; nothing changed on the desktop"
    lh="$(sha256sum < "$f" | cut -c1-64) $(stat -c %s "$f")"
    dh=$(dps "\$i = Get-Item -LiteralPath '$D_BENCH/sites/$lprefix$suf'; (Get-FileHash -Algorithm SHA256 -LiteralPath \$i.FullName).Hash.ToLower() + ' ' + \$i.Length")
    [ "$lh" = "$dh" ] || die "the copy of $lprefix$suf differs on the desktop (laptop $lh, desktop $dh); nothing changed on the desktop"
    echo "  copied   $(basename "$f")  ${lh:0:16} $(stat -c %s "$f")"
  done

  [ "$(fp_of desktop)" = "$dfp" ] || die "refusing: the desktop's data changed during the push; nothing changed. Re-run when it is idle."
  [ "$(fp_of laptop)" = "$lfp" ] || die "refusing: the laptop's data changed during the push; nothing changed on the desktop. Re-run when it is idle."

  echo "desktop: stopping bench and restoring the laptop's backup ..."
  rrun desktop bash stop_bench.sh > /dev/null
  out=$(d_cp_to_pg "$D_BENCH/sites/$(dirname "$lprefix")" "$(basename "$lprefix")-database.sql.gz" /tmp/envsync_restore.sql.gz)
  printf '%s\n' "$out" | grep -q '^error=' && die "copying the laptop dump into the desktop's postgres failed; the desktop database is unchanged (bench is stopped):\n$out"
  out=$(d_cp_to_pg "$D_BENCH/$STAGE" restore_db.sh /tmp/envsync_restore_db.sh)
  printf '%s\n' "$out" | grep -q '^error=' && die "copying restore_db.sh failed; the desktop database is unchanged (bench is stopped):\n$out"
  out=$(dps "docker exec $PG_C bash /tmp/envsync_restore_db.sh $db /tmp/envsync_restore.sql.gz"); printf '%s\n' "$out" | grep -v '^NOTICE' | sed 's/^/  /'
  printf '%s\n' "$out" | grep -q "^restored $db" || die "the desktop restore failed; bench is stopped. Recover with the runbook rollback (the previous database is ${db}_envsync_prev)."
  out=$(rrun desktop bash restore_files.sh "$lprefix"); printf '%s\n' "$out" | sed 's/^/  /'
  printf '%s\n' "$out" | grep -qx 'migrate ok' || die "files or migrate failed on the desktop; bench is stopped. The previous database is ${db}_envsync_prev, the old file folders *.envsync_prev."
  start_services desktop
  wait_ping desktop || die "the desktop restored, but bench does not answer; see /tmp/envsync_logs/ in its container"

  dfp2=$(fp_of desktop); lfp2=$(fp_of laptop)
  echo "fingerprints after"; printf '%s\n' "$lfp2" | sed 's/^fp_/  laptop   /'; printf '%s\n' "$dfp2" | sed 's/^fp_/  desktop  /'
  [ "$dfp2" = "$lfp2" ] || die "the desktop does not match the laptop after the restore. The previous desktop database is ${db}_envsync_prev; follow the runbook rollback."
  { echo "# desktop fingerprint after the laptop's db-push ($(date '+%F %T'), backup $(basename "$lprefix"))"; printf '%s\n' "$dfp2"; } > "$PULL_RECORD"
  run="$L_REPORTS/$(date +%F_%H%M)_env_sync_db-push.md"
  { echo "# env_sync db-push - $(date '+%F %T')"; echo
    echo "- started $t0, ended $(date '+%F %T')"
    echo "- code: IN_SYNC at $(lgit rev-parse --short=9 HEAD) on $L_BRANCH"
    echo "- desktop safety backup (proved by a scratch restore, kept): $(basename "$dprefix") in sites/localhost/private/backups"
    echo "- laptop backup restored on the desktop: $(basename "$lprefix")"
    echo "- the desktop's previous database: ${db}_envsync_prev (file folders *.envsync_prev)"
    if [ "${DISCARD:-0}" = 1 ]; then echo "- --discard-desktop-writes was given"; fi
    echo; echo "| | laptop | desktop |"; echo "|---|---|---|"
    echo "| before | $(printf '%s' "$lfp" | tr '\n' ';') | $(printf '%s' "$dfp" | tr '\n' ';') |"
    echo "| after | $(printf '%s' "$lfp2" | tr '\n' ';') | $(printf '%s' "$dfp2" | tr '\n' ';') |"
  } > "$run"
  echo "run record: $run"
  NO_DATA=0; cmd_status > "$TMPD/st" 2>&1; sed -n '/^data/,$p' "$TMPD/st"
}

cmd_reports() {
  local list name epoch lp copied=0
  list=$(dps "Get-ChildItem -LiteralPath '$D_REPORTS' | Where-Object { \$_.Extension -ne '.lnk' } | ForEach-Object { if (\$_.PSIsContainer) { \$t = Get-ChildItem -LiteralPath \$_.FullName -Recurse -File | Sort-Object LastWriteTimeUtc | Select-Object -Last 1 -ExpandProperty LastWriteTimeUtc; if (-not \$t) { \$t = \$_.LastWriteTimeUtc }; 'D|' + \$_.Name + '|' + ([DateTimeOffset]\$t).ToUnixTimeSeconds() } else { 'F|' + \$_.Name + '|' + ([DateTimeOffset]\$_.LastWriteTimeUtc).ToUnixTimeSeconds() + '|' + \$_.Length } }")
  while IFS='|' read -r kind name epoch size; do
    [ -n "$name" ] || continue
    lp="$L_REPORTS/$name"
    if [ "$kind" = F ]; then
      [ -f "$lp" ] && [ "$(stat -c %Y "$lp")" -ge "$epoch" ] && continue
      if [ -f "$lp" ] && [ "$(stat -c %s "$lp")" = "$size" ] && [ "$(sha256sum < "$lp" | cut -c1-64)" = \
          "$(dps "(Get-FileHash -Algorithm SHA256 -LiteralPath '$D_REPORTS/$name').Hash.ToLower()")" ]; then
        continue                                     # same bytes, only a newer timestamp on the desktop
      fi
      "$SCP" -q "${SSHO[@]}" "$DESKTOP:$D_REPORTS/$name" "$lp" && touch -d "@$epoch" "$lp" && echo "  copied   $name" && copied=$((copied + 1))
    elif [ "$kind" = D ]; then
      [ -d "$lp" ] && [ "$(find "$lp" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)" -ge "$epoch" ] 2>/dev/null && continue
      "$SCP" -q -r "${SSHO[@]}" "$DESKTOP:$D_REPORTS/$name" "$L_REPORTS/" && echo "  copied   $name/" && copied=$((copied + 1))
    fi
  done <<< "$list"
  echo "reports: $copied item(s) copied from the desktop to $L_REPORTS"
}

cmd_watch() {
  collect; print_code
  echo "desktop servers: $(rrun desktop bash ports.sh | tr '\n' ' ')"
  echo "desktop Claude sessions:"
  dps "claude agents --json" | python3 -c '
import json, sys, datetime
try: rows = json.load(sys.stdin)
except Exception: print("  (could not read claude agents --json)"); sys.exit()
for r in rows or []:
    t = r.get("startedAt"); t = datetime.datetime.fromtimestamp(t / 1000).strftime("%m-%d %H:%M") if t else "?"
    print("  %-18s %-12s %-8s started %s  %s" % (r.get("name", "?"), r.get("kind", "?"), r.get("status", "?"), t, r.get("cwd", "")))
if not rows: print("  none")'
  if [ -n "${LOGS:-}" ]; then
    echo "--- claude logs $LOGS (last ${LINES_N:-40} lines)"
    dps "claude logs '$LOGS'" | sed -e 's/\x1b\[[0-9;?]*[A-Za-z]//g' -e 's/\x1b\][^\x07]*\x07//g' | grep -v '^\s*$' | tail -n "${LINES_N:-40}"
  fi
}

# ---- delegated desktop sessions ---------------------------------------------------------------------------------

check_name() { [[ "${1:-}" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,40}$ ]] || die "--name takes letters, digits and dashes (got '${1:-}')"; }

# agent_field <name> <field>: that field of the newest background session with this display name, "" if there is none.
# --all also lists sessions that have exited.
agent_field() {
  dps "claude agents --json --all" | python3 -c '
import json, sys
try: rows = json.load(sys.stdin) or []
except Exception: rows = []
rows = [r for r in rows if r.get("name") == sys.argv[1] and r.get("kind") != "interactive"]
rows.sort(key=lambda r: r.get("startedAt") or 0)
print(rows[-1].get(sys.argv[2], "") if rows else "")' "$1" "$2"
}

show_logs() {
  echo "--- claude logs $1 (last ${LINES_N:-40} lines)"
  dps "claude logs '$1'" | sed -e 's/\x1b\[[0-9;?]*[A-Za-z]//g' -e 's/\x1b\][^\x07]*\x07//g' | grep -v '^\s*$' | tail -n "${LINES_N:-40}"
}

# run_task <name> <start|resume> [session-id]: the launch itself, through Task Scheduler (desktop/start_task.ps1).
run_task() {
  local extra="" out; [ -n "${3:-}" ] && extra=" -SessionId $3"     # PowerShell 5.1 drops an empty '' argument
  out=$(dps "powershell -NoProfile -ExecutionPolicy Bypass -File '$D_BENCH/$STAGE/desktop/start_task.ps1' -Name $1 -Mode $2$extra" | sed '1s/^\xEF\xBB\xBF//')
  printf '%s\n' "$out" | sed 's/^/  /'
  printf '%s\n' "$out" | grep -q '^done=' || die "the desktop launch failed"
}

cmd_session_start() {
  [ -n "${BRIEF:-}" ] && [ -f "$BRIEF" ] || die "session-start needs --brief FILE: what the desktop session should do"
  NAME="${NAME:-nirmaan-$(date +%m%d-%H%M)}"; check_name "$NAME"
  [ "$(agent_field "$NAME" status)" = "" ] || [ "${REUSE_NAME:-0}" = 1 ] || die "the desktop already has a session named $NAME; pick another --name"
  collect
  case $VERDICT in
    IN_SYNC) print_code;;
    LAPTOP_AHEAD) cmd_to_desktop;;
    *) print_code; die "refusing: the verdict is $VERDICT; the desktop must hold the laptop's code before it gets work";;
  esac
  { cat "$BRIEF"; sed "s|{{STATUS_FILE}}|$SDIR/$NAME.status.md|g" "$HERE/desktop/brief_footer.md"; } > "$TMPD/$NAME.brief.md"
  dps "Remove-Item -LiteralPath '$SDIR/$NAME.status.md' -ErrorAction SilentlyContinue" > /dev/null
  "$SCP" -q "${SSHO[@]}" "$TMPD/$NAME.brief.md" "$DESKTOP:$SDIR/$NAME.brief.md" || die "copying the brief to the desktop failed"
  echo "desktop: starting session $NAME ..."
  run_task "$NAME" start
  local sid=""
  for _ in 1 2 3 4 5 6; do sid=$(agent_field "$NAME" sessionId); [ -n "$sid" ] && break; sleep 5; done
  [ -n "$sid" ] || die "the launch reported success but no background session named $NAME is listed; see env_sync.sh watch"
  echo "desktop: session $NAME is running (session id $sid)"
  echo "next: env_sync.sh session-wait --name $NAME --pull-back   (in the background)"
}

cmd_session_send() {
  check_name "${NAME:-}"; [ -n "${MESSAGE:-}" ] && [ -f "$MESSAGE" ] || die "session-send needs --name N --message FILE"
  local sid; sid=$(agent_field "$NAME" sessionId)
  [ -n "$sid" ] || die "the desktop has no session named $NAME"
  { cat "$MESSAGE"
    printf '\n\n---\n(Relayed from the owner by the laptop. The protocol in your brief still applies: carry on end to end, and write %s, first line DONE, BLOCKED or FAILED, as your last action.)\n' "$SDIR/$NAME.status.md"
  } > "$TMPD/$NAME.message.md"
  dps "Remove-Item -LiteralPath '$SDIR/$NAME.status.md' -ErrorAction SilentlyContinue" > /dev/null
  "$SCP" -q "${SSHO[@]}" "$TMPD/$NAME.message.md" "$DESKTOP:$SDIR/$NAME.message.md" || die "copying the message to the desktop failed"
  echo "desktop: resuming $NAME ($sid) with the message ..."
  run_task "$NAME" resume "$sid"
  echo "next: env_sync.sh session-wait --name $NAME --pull-back   (in the background)"
}

cmd_session_wait() {
  check_name "${NAME:-}"
  local interval="${INTERVAL:-60}" idle=0 fails=0 st first state
  echo "waiting on desktop session $NAME, polling every ${interval}s, since $(date +%T)"
  while :; do
    if ! st=$(dps "if (Test-Path -LiteralPath '$SDIR/$NAME.status.md') { Get-Content -Raw -LiteralPath '$SDIR/$NAME.status.md' } else { 'NO_STATUS' }") || [ -z "$st" ]; then
      fails=$((fails + 1)); [ "$fails" -ge 30 ] && die "the desktop has not answered for 30 polls in a row"
      sleep "$interval"; continue
    fi
    fails=0
    st=$(printf '%s\n' "$st" | sed '1s/^\xEF\xBB\xBF//')
    first=$(printf '%s\n' "$st" | head -1 | tr -d '[:space:]')
    case "$first" in
      DONE|BLOCKED|FAILED)
        echo "=== $NAME: $first (seen $(date +%T))"; printf '%s\n' "$st"
        if [ "$first" = DONE ] && [ "${PULL_BACK:-0}" = 1 ]; then
          echo "=== pulling the work back"; cmd_from_desktop; cmd_reports
        fi
        case "$first" in DONE) return 0;; BLOCKED) return 5;; FAILED) return 6;; esac;;
    esac
    state=$(agent_field "$NAME" status)
    if [ -z "$state" ]; then echo "=== $NAME is not listed on the desktop and wrote no status file"; show_logs "$NAME"; return 7; fi
    if [ "$state" = idle ]; then idle=$((idle + 1)); else idle=0; fi
    if [ "$idle" -ge "${IDLE_LIMIT:-5}" ]; then
      echo "=== $NAME has been idle for $idle polls without a status file (waiting on a prompt or a question?)"
      show_logs "$NAME"; return 4
    fi
    sleep "$interval"
  done
}

cmd_session_stop() {
  check_name "${NAME:-}"
  local ids; ids=$(dps "claude agents --json" | python3 -c '
import json, sys
try: rows = json.load(sys.stdin) or []
except Exception: rows = []
print(" ".join(r["sessionId"][:8] for r in rows if r.get("name") == sys.argv[1] and r.get("kind") != "interactive" and r.get("sessionId")))' "$NAME")
  [ -n "$ids" ] || { echo "the desktop has no running session named $NAME"; return 0; }
  for id in $ids; do dps "claude stop $id"; done        # claude stop takes the short id
}

CMD="${1:-}"; [ $# -gt 0 ] && shift
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1;; --allow-dirty) ALLOW_DIRTY=1;; --no-restart) NO_RESTART=1;; --no-data) NO_DATA=1;;
    --discard-desktop-writes) DISCARD=1;;
    --logs) LOGS="${2:-}"; shift;; --lines) LINES_N="${2:-40}"; shift;;
    --name) NAME="${2:-}"; shift;; --brief) BRIEF="${2:-}"; shift;; --message) MESSAGE="${2:-}"; shift;;
    --interval) INTERVAL="${2:-60}"; shift;; --idle-limit) IDLE_LIMIT="${2:-5}"; shift;; --pull-back) PULL_BACK=1;;
    *) die "unknown flag $1";;
  esac
  shift
done
case "$CMD" in status|to-desktop|from-desktop|db-pull|db-push|watch|session-*) ensure_stage;; esac   # once, outside any $(...)
case "$CMD" in
  status) cmd_status;; to-desktop) cmd_to_desktop;; from-desktop) cmd_from_desktop;;
  db-pull) cmd_db_pull;; db-push) cmd_db_push;; reports) cmd_reports;; watch) cmd_watch;;
  session-start) cmd_session_start;; session-send) cmd_session_send;;
  session-wait) cmd_session_wait;; session-stop) cmd_session_stop;;
  *) sed -n "2,26p" "$0" | sed 's/^# \{0,1\}//'; exit 1;;
esac
