#!/usr/bin/env bash
# env_sync.sh -- the LAPTOP side of the owner's two-machine loop (docs/agents/environments.md).
# Runs on the laptop in Git Bash. Every transfer goes through the desktop's SSH server (scp + git bundles);
# nothing here talks to GitHub, and nothing here ever pushes to origin.
#
#   env_sync.sh status [--no-data]     code and data on both machines, and a verdict
#   env_sync.sh to-desktop             fast-forward the desktop to the laptop's commits, then destale it
#   env_sync.sh from-desktop           fast-forward the laptop to the desktop's commits, then destale it
#   env_sync.sh db-pull --yes [--covers STEP]
#                                      replace the laptop's database with a fresh, PROVED backup of the desktop's (the
#                                      master); STEP is written into the pull record (which step the copy covers)
#   env_sync.sh db-push --yes [--discard-desktop-writes]
#                                      after a desktop drop (the laptop was the master): replace the DESKTOP's database
#                                      with a fresh backup of the laptop's, after a proved desktop backup
#   env_sync.sh reports               copy new or newer files from the desktop's Desktop to the laptop's Desktop
#   env_sync.sh watch [--logs NAME]    one monitoring snapshot: desktop commits, changes, servers, Claude sessions
#   env_sync.sh print                  the settings this checkout resolves to (env.local included); runs nothing
#
# Checkpoints - keep the laptop close behind the desktop, over this SSH route only, never a cloud drive
# (CKP-1 / CKP-2; scripts/env_sync/README.md):
#   env_sync.sh checkpoint-code --slice S [--name N] [--if-older MIN]
#                                      B1: the desktop's commits (fast-forward, as after a commit) + its UNCOMMITTED work
#                                      + a resume note into frappe-bench\envsync\checkpoints\<slice>\<stamp>\ on the
#                                      laptop (local disk); never applied
#   env_sync.sh checkpoint --slice S [--name N] --yes
#                                      B3 "leaving": a local ckpt/<slice>-<stamp> commit on the desktop, its code and a
#                                      proved database copy on the laptop, both verified; prints CHECKPOINT READY
#   env_sync.sh catch-up --slice S [--name N]
#                                      B4 back home: a fresh B1 checkpoint of everything the desktop made since, then
#                                      CAUGHT-UP with the age of the last database copy (and any copy still pending)
#   env_sync.sh resume-on-laptop --slice S [--name N] [--dry-run | --takeover --yes]
#                                      B5: desktop up -> report only; down -> on the owner's word, rebuild the newest
#                                      checkpoint on the laptop and make the laptop the master
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
# Overrides: .claude/state/env.local (git-ignored) may set the ENV_SYNC_* variables below. A second environment (dev2)
# sets its containers, desktop bench, site, vite port and start scripts there (docs/agents/environments.md, dev2).
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
SITE="${ENV_SYNC_SITE:-localhost}"                    # the Frappe site (dev2: dev2.localhost)
VITE_PORT="${ENV_SYNC_VITE_PORT:-8080}"               # vite's port inside the container (dev2: 8180)
START_BENCH="${ENV_SYNC_START_BENCH:-$C_BENCH/$STAGE/start_bench.sh}"   # run with docker exec -d; main's starts bench, then vite
START_VITE="${ENV_SYNC_START_VITE:-}"                 # a separate vite start script, run once :8000 is open (dev2)
STOP_PATTERN="${ENV_SYNC_STOP_PATTERN:-}"             # empty: stop_bench.sh's own process pattern
# The settings the remote scripts read go into the container only when they differ from main dev's defaults, so main's
# command lines stay exactly as they were. CENV is for a local docker exec, DENV for one typed into the desktop's
# PowerShell (single quotes keep a pattern's '|' and spaces literal there).
CENV=(); DENV=""
cenv() { CENV+=(-e "$1=$2"); DENV+=" -e '$1=$2'"; }
[ "$SITE" != localhost ] && cenv ENV_SYNC_SITE "$SITE"
[ "$VITE_PORT" != 8080 ] && cenv ENV_SYNC_VITE_PORT "$VITE_PORT"
[ -n "$STOP_PATTERN" ] && cenv ENV_SYNC_STOP_PATTERN "$STOP_PATTERN"
PING_H=(); D_PING=""                                   # a Host header only for a site that is not the default
[ "$SITE" != localhost ] && PING_H=(-H "Host: $SITE") && D_PING=" -H 'Host: $SITE'"
# The desktop's fingerprint as of the laptop's last db-pull (db-pull writes it, db-push checks it, db-push refreshes it).
PULL_RECORD="${ENV_SYNC_PULL_RECORD:-$BENCH_HOST/$STAGE/last_pull_fingerprint.txt}"
# Checkpoints (CKP-2): NO cloud drive anywhere - code checkpoints on the laptop's LOCAL disk (envsync/checkpoints), env_sync's
# database backups on each machine's local disk (envsync/backups, never sites/<site>/private/backups), the master record.
# The relay folder (where the laptop session's to_chat.md lives) is only READ, for the resume note's last relay id.
CKPT_ROOT="${ENV_SYNC_CKPT_ROOT:-$BENCH_HOST/$STAGE/checkpoints}"
RELAY_ROOT="${ENV_SYNC_RELAY_ROOT:-$L_REPORTS/BoQ main lane/_relay}"
# Rule 16: database copies only on the office LAN (big copies fail over the Tailscale relay). Tailscale says how it reaches the
# desktop: "via <private LAN address>" = direct on a LAN; "via DERP(...)" = the relay. (The desktop's LAN address changes - it
# was 192.168.1.3, on 2026-11-17 it is 192.168.0.210 - so no fixed address is trusted.) Without Tailscale, a TCP probe of
# ENV_SYNC_DESKTOP_LAN is the fallback. Away from the LAN a copy is recorded as pending and done at the next LAN chance.
TAILSCALE="${ENV_SYNC_TAILSCALE:-/c/Program Files/Tailscale/tailscale.exe}"
DESKTOP_TS="${ENV_SYNC_DESKTOP_TS:-nitesh-desktop}"
DESKTOP_LAN="${ENV_SYNC_DESKTOP_LAN:-}"
DESKTOP_LAN_PORT="${ENV_SYNC_DESKTOP_LAN_PORT:-22}"
PENDING_REC="$BENCH_HOST/$STAGE/data_copy_pending.txt"
CKPT_KEEP="${ENV_SYNC_CKPT_KEEP:-8}"                  # checkpoint folders kept per slice
BACKUP_KEEP="${ENV_SYNC_BACKUP_KEEP:-3}"              # envsync/backups folders kept per machine
MASTER_REC="$BENCH_HOST/$STAGE/master.txt"            # present only while the laptop is the master (resume-on-laptop)
TURN_FILE="${ENV_SYNC_TURN_FILE:-$(cygpath -u "$USERPROFILE")/envsync_laptop_turn.txt}"
GITBASH="${ENV_SYNC_DESKTOP_GITBASH:-C:/Program Files/Git/bin/bash.exe}"   # the desktop host's Git Bash (hrun)
LAPTOP_CONTAINERS="${ENV_SYNC_LAPTOP_CONTAINERS:-frappe_docker_devcontainer-postgresql-1 frappe_docker_devcontainer-redis-cache-1 frappe_docker_devcontainer-redis-queue-1 frappe_docker_devcontainer-frappe-1}"
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
  # resume-on-laptop must work with the desktop gone: stage the laptop only
  [ "${STAGE_LAPTOP_ONLY:-0}" = 1 ] && { STAGED=1; return 0; }
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
    MSYS_NO_PATHCONV=1 docker exec -u frappe -w "$C_BENCH" "${CENV[@]}" "$FRAPPE_C" $interp "$C_BENCH/$STAGE/$s" "$@" 2>&1
  else
    dps "docker exec -u frappe -w $C_BENCH$DENV $FRAPPE_C $interp $C_BENCH/$STAGE/$s $*"
  fi
}

# start_detached <laptop|desktop> <container path of a start script>
start_detached() {
  if [ "$1" = laptop ]; then
    MSYS_NO_PATHCONV=1 docker exec -d -u frappe "${CENV[@]}" "$FRAPPE_C" bash "$2"
  else
    dps "docker exec -d -u frappe$DENV $FRAPPE_C bash $2" > /dev/null
  fi
}

start_services() {
  local m="$1" out
  start_detached "$m" "$START_BENCH"
  if [ -n "$START_VITE" ]; then                         # vite second, so it never proxies to a bench that isn't there
    for _ in $(seq 1 60); do grep -q '8000 open' <<< "$(rrun "$m" bash ports.sh)" && break; sleep 5; done
    start_detached "$m" "$START_VITE"
  fi
  for _ in $(seq 1 60); do
    out=$(rrun "$m" bash ports.sh)
    if grep -q '8000 open' <<< "$out" && grep -q "$VITE_PORT open" <<< "$out"; then echo "$m: bench :8000 and vite :$VITE_PORT are up"; return 0; fi
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
    if [ "$m" = laptop ]; then r=$(MSYS_NO_PATHCONV=1 docker exec "$FRAPPE_C" curl -s -m 5 "${PING_H[@]}" http://127.0.0.1:8000/api/method/ping 2>/dev/null)
    else r=$(dps "docker exec $FRAPPE_C curl -s -m 5$D_PING http://127.0.0.1:8000/api/method/ping"); fi
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
  grep -qE '(/doctype/.*\.json|patches\.txt|hooks\.py|/fixtures/.*\.json)$' <<< "$changed" && mig="--migrate"
  if ! grep -qvE '(\.md$|^\.claude/|^docs/|^scripts/)' <<< "$changed"; then echo "$m: nothing served changed (docs / scripts only), no restart needed"; return 0; fi
  if [ "${NO_RESTART:-0}" = 1 ]; then echo "$m: --no-restart given; destale it yourself before trusting what it serves"; return 0; fi
  echo "$m: destaling${mig:+ with migrate} ..."
  rrun "$m" bash destale.sh $mig | grep -vE "^(8000|$VITE_PORT) closed\$" || die "$m: destale failed"
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
    if [ -f "$MASTER_REC" ]; then echo "  master   THE LAPTOP ($(head -1 "$MASTER_REC")) - resume-on-laptop took over; db-push hands it back to the desktop"
    else echo "  master   the desktop; after a desktop drop the laptop, until db-push (docs/agents/environments.md, Desktop drop)"; fi
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

# ---- db-pull with proofs (CKP-1, B2) -----------------------------------------------------------------------------
# d_counts: the desktop database's table + key row counts (db_counts.sh in its postgres container).
d_counts() {
  local db="$1" out
  out=$(d_cp_to_pg "$D_BENCH/$STAGE" db_counts.sh /tmp/envsync_db_counts.sh); grep -q '^error=' <<< "$out" && { echo "$out"; return 1; }
  dps "docker exec $PG_C bash /tmp/envsync_db_counts.sh $db" | grep '^count_'
}

# counts_check <before> <after> <copy>: every count of the copy lies between the desktop's counts just before and just
# after its backup (the dump is a snapshot taken in between). 0 = all within.
counts_check() {
  local k s b a lo hi bad=0
  while IFS='=' read -r k s; do
    case "$k" in count_*) ;; *) continue;; esac
    b=$(kv "$k" "$1"); a=$(kv "$k" "$2")
    if [[ "$b" =~ ^[0-9]+$ && "$a" =~ ^[0-9]+$ && "$s" =~ ^[0-9]+$ ]]; then
      lo=$(( b < a ? b : a )); hi=$(( b > a ? b : a ))
      if [ "$s" -ge "$lo" ] && [ "$s" -le "$hi" ]; then echo "  ${k#count_} desktop $b..$a copy $s OK"; continue; fi
    fi
    echo "  ${k#count_} desktop $b..$a copy $s DIFF"; bad=1
  done <<< "$3"
  [ -n "$3" ] || { echo "  no counts from the copy"; bad=1; }
  return $bad
}

# prune_local <dir> <keep>: keep the newest <keep> stamp-named folders under <dir> on the laptop; the rest by name.
prune_local() {
  [ -d "$1" ] || return 0
  ls -1d "$1"/[0-9]*_[0-9]* 2>/dev/null | sort | head -n -"$2" | while read -r old; do rm -rf -- "$old" && echo "laptop: pruned $(basename "$old")"; done
}

# pull_backup: back up the desktop into its envsync/backups and prove it. Sets PB_PREFIX, PB_DB, PB_BEFORE, PB_AFTER,
# PB_SHA (file=... sha256=... lines) and PB_TOOK. The desktop keeps working throughout: only the backup itself loads it.
pull_backup() {
  local out t
  PB_DB=$(kv db_name "$(rrun desktop bash get_db_name.sh)"); [ -n "$PB_DB" ] || die "cannot read the desktop's database name"
  PB_BEFORE=$(d_counts "$PB_DB") || die "cannot count the desktop's rows:\n$PB_BEFORE"
  echo "desktop: backing up into envsync/backups (local disk) ..."
  t=$(date +%s)
  out=$(rrun desktop bash backup_local.sh "$BACKUP_KEEP"); PB_PREFIX=$(kv prefix "$out")
  [ -n "$PB_PREFIX" ] || die "the desktop backup failed; the laptop is unchanged:\n$out"
  PB_TOOK=$(( $(date +%s) - t ))
  grep '^pruned=' <<< "$out" | sed 's/^pruned=/desktop: pruned /'
  PB_AFTER=$(d_counts "$PB_DB") || die "cannot count the desktop's rows after the backup"
  out=$(rrun desktop bash prove_backup.sh "$PB_PREFIX"); printf '%s\n' "$out" | sed 's/^/  /'
  [ "$(kv proof "$out")" = ok ] || die "the desktop backup did not prove whole (sizes, sha256, gzip -t, tar); the laptop is unchanged"
  PB_SHA=$(grep '^file=' <<< "$out")
  echo "desktop: backup $(basename "$PB_PREFIX") proved, $PB_TOOK s"
}

# pull_copy_prove_restore <covers>: copy PB_PREFIX's files to the laptop (sha256 + size equal), load the dump into a
# SCRATCH database on the laptop and check its counts against the desktop's, and only then replace the laptop's database
# (the replaced one stays as <db>_envsync_prev). Writes the pull record with what the copy covers.
pull_copy_prove_restore() {
  local covers="$1" suf f want got db out
  mkdir -p "$BENCH_HOST/sites/$(dirname "$PB_PREFIX")"
  for suf in -database.sql.gz -files.tar -private-files.tar; do
    f="$BENCH_HOST/sites/$PB_PREFIX$suf"
    "$SCP" -q "${SSHO[@]}" "$DESKTOP:$D_BENCH/sites/$PB_PREFIX$suf" "$f" || die "copying $(basename "$f") failed; the laptop database is unchanged"
    want=$(grep -F "file=$(basename "$f") " <<< "$PB_SHA" | sed 's/.* size=\([0-9]*\) sha256=\([0-9a-f]*\)/\2 \1/')
    got="$(sha256sum < "$f" | cut -c1-64) $(stat -c %s "$f")"
    [ "$want" = "$got" ] || die "the laptop copy of $(basename "$f") differs (desktop $want, laptop $got); the laptop database is unchanged"
    echo "  copied   $(basename "$f")  ${got:0:16} $(stat -c %s "$f")"
  done
  prune_local "$BENCH_HOST/$STAGE/backups" "$BACKUP_KEEP"
  db=$(kv db_name "$(rrun laptop bash get_db_name.sh)"); [ -n "$db" ] || die "cannot read the laptop's database name"
  MSYS_NO_PATHCONV=1 docker cp "$(cygpath -w "$BENCH_HOST/sites/$PB_PREFIX-database.sql.gz")" "$PG_C:/tmp/envsync_restore.sql.gz" || die "docker cp of the dump failed"
  for s in restore_db.sh scratch_counts.sh db_counts.sh; do
    MSYS_NO_PATHCONV=1 docker cp "$(cygpath -w "$HERE/remote/$s")" "$PG_C:/tmp/$s" > /dev/null || die "docker cp of $s failed"
  done
  echo "laptop: test-restoring the copy into a scratch database ..."
  out=$(MSYS_NO_PATHCONV=1 docker exec "$PG_C" bash /tmp/scratch_counts.sh "$db" /tmp/envsync_restore.sql.gz)
  grep -qx 'load=ok' <<< "$out" || die "the copy did not load into the scratch database; the laptop database is unchanged:\n$out"
  counts_check "$PB_BEFORE" "$PB_AFTER" "$(grep '^count_' <<< "$out")" || die "the copy's counts are not the desktop's; the laptop database is unchanged"
  echo "laptop: scratch restore PASS; replacing the laptop database ..."
  rrun laptop bash stop_bench.sh > /dev/null
  out=$(MSYS_NO_PATHCONV=1 docker exec "$PG_C" bash /tmp/restore_db.sh "$db" /tmp/envsync_restore.sql.gz 2>&1)
  grep -q "^restored $db" <<< "$out" || die "the database restore failed (bench is stopped):\n$out"
  rrun laptop bash restore_files.sh "$PB_PREFIX" | sed 's/^/  /' || die "files or migrate failed (bench is stopped)"
  start_services laptop
  # The laptop now holds exactly the desktop's backup: its fingerprint is the desktop's as of this pull. db-push
  # refuses later if the desktop has moved away from it (writes the laptop never saw).
  { echo "# desktop fingerprint at the laptop's last db-pull ($(date '+%F %T'), backup $(basename "$PB_PREFIX"))"
    echo "# covers: ${covers:-a db-pull on request}"
    echo "# backup: $PB_PREFIX"
    fp_of laptop; } > "$PULL_RECORD"
  echo "laptop: recorded the pulled fingerprint in $PULL_RECORD (covers: ${covers:-a db-pull on request})"
}

cmd_db_pull() {
  [ "${YES:-0}" = 1 ] || die "db-pull REPLACES the laptop's database with a fresh backup of the desktop's (the master).\nRe-run with --yes."
  local t0; t0=$(date +%s)
  lan_or_pending "db-pull: ${COVERS:-on request}"
  pull_backup
  pull_copy_prove_restore "${COVERS:-}"
  [ -f "$PENDING_REC" ] && mv "$PENDING_REC" "$PENDING_REC.done_$(date +%Y%m%d_%H%M%S)" && echo "laptop: the pending data copies are covered by this pull"
  echo "db-pull took $(( $(date +%s) - t0 )) s (desktop backup $PB_TOOK s)"
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
  out=$(rrun desktop bash backup_local.sh "$BACKUP_KEEP"); dprefix=$(kv prefix "$out")
  [ -n "$dprefix" ] || die "the desktop backup failed; nothing changed:\n$out"
  out=$(rrun desktop bash prove_backup.sh "$dprefix"); printf '%s\n' "$out" | sed 's/^/  /'
  [ "$(kv proof "$out")" = ok ] || die "the desktop backup did not prove whole; nothing changed"
  out=$(d_cp_to_pg "$D_BENCH/sites/$(dirname "$dprefix")" "$(basename "$dprefix")-database.sql.gz" /tmp/envsync_check.sql.gz)
  grep -q '^error=' <<< "$out" && die "copying the desktop dump into its postgres container failed; nothing changed:\n$out"
  out=$(d_cp_to_pg "$D_BENCH/$STAGE" scratch_check.sh /tmp/envsync_scratch_check.sh)
  grep -q '^error=' <<< "$out" && die "copying scratch_check.sh failed; nothing changed:\n$out"
  echo "desktop: test-restoring the safety copy into a scratch database ..."
  out=$(dps "docker exec $PG_C bash /tmp/envsync_scratch_check.sh $db /tmp/envsync_check.sql.gz"); printf '%s\n' "$out" | sed 's/^/  /'
  grep -qx 'check=PASS' <<< "$out" || die "the desktop backup's test restore did not pass; nothing changed"

  echo "laptop: backing up ..."
  out=$(rrun laptop bash backup_local.sh "$BACKUP_KEEP"); lprefix=$(kv prefix "$out")
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
  grep -q '^error=' <<< "$out" && die "copying the laptop dump into the desktop's postgres failed; the desktop database is unchanged (bench is stopped):\n$out"
  out=$(d_cp_to_pg "$D_BENCH/$STAGE" restore_db.sh /tmp/envsync_restore_db.sh)
  grep -q '^error=' <<< "$out" && die "copying restore_db.sh failed; the desktop database is unchanged (bench is stopped):\n$out"
  out=$(dps "docker exec $PG_C bash /tmp/envsync_restore_db.sh $db /tmp/envsync_restore.sql.gz"); printf '%s\n' "$out" | grep -v '^NOTICE' | sed 's/^/  /'
  grep -q "^restored $db" <<< "$out" || die "the desktop restore failed; bench is stopped. Recover with the runbook rollback (the previous database is ${db}_envsync_prev)."
  out=$(rrun desktop bash restore_files.sh "$lprefix"); printf '%s\n' "$out" | sed 's/^/  /'
  grep -qx 'migrate ok' <<< "$out" || die "files or migrate failed on the desktop; bench is stopped. The previous database is ${db}_envsync_prev, the old file folders *.envsync_prev."
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
    echo "- desktop safety backup (proved by a scratch restore, kept): $(basename "$dprefix") in frappe-bench/envsync/backups"
    echo "- laptop backup restored on the desktop: $(basename "$lprefix")"
    echo "- the desktop's previous database: ${db}_envsync_prev (file folders *.envsync_prev)"
    if [ "${DISCARD:-0}" = 1 ]; then echo "- --discard-desktop-writes was given"; fi
    echo; echo "| | laptop | desktop |"; echo "|---|---|---|"
    echo "| before | $(printf '%s' "$lfp" | tr '\n' ';') | $(printf '%s' "$dfp" | tr '\n' ';') |"
    echo "| after | $(printf '%s' "$lfp2" | tr '\n' ';') | $(printf '%s' "$dfp2" | tr '\n' ';') |"
  } > "$run"
  echo "run record: $run"
  if [ -f "$MASTER_REC" ]; then rm -f "$MASTER_REC" && echo "master: the desktop again (the laptop's master record is removed)"; fi
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

cmd_print() {
  echo "env_sync settings for $REPO"
  echo "  env.local           $([ -f "$REPO/.claude/state/env.local" ] && echo "$REPO/.claude/state/env.local" || echo "none (main dev's defaults)")"
  echo "  desktop             $DESKTOP   bench $D_BENCH"
  echo "  laptop bench        $BENCH_HOST"
  echo "  containers          $FRAPPE_C / $PG_C"
  echo "  site                $SITE"
  echo "  vite port           $VITE_PORT"
  echo "  start               $START_BENCH${START_VITE:+, then (once :8000 is open) $START_VITE}"
  echo "  stop pattern        ${STOP_PATTERN:-the default in remote/stop_bench.sh}"
  echo "  ping                curl -s -m 5${PING_H[*]:+ ${PING_H[*]}} http://127.0.0.1:8000/api/method/ping"
  echo "  container env       ${CENV[*]:-none}"
  echo "  launcher task       envsync-claude-launch-$(basename "$(dirname "$(dirname "$D_BENCH")")")"
  echo "  pull record         $PULL_RECORD"
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

# ---- checkpoints (CKP-1): keep the laptop close behind the desktop -----------------------------------------------
need_slice() { [[ "${SLICE:-}" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,40}$ ]] || die "--slice takes letters, digits and dashes (got '${SLICE:-}')"; }
ckpt_dir() { echo "$CKPT_ROOT/$SLICE"; }
# on_lan: 0 when the laptop reaches the desktop DIRECTLY over a private LAN address; prints the path it saw (LAN_PATH).
on_lan() {
  local out
  if [ -x "$TAILSCALE" ]; then
    out=$(timeout 20 "$TAILSCALE" ping -c 1 "$DESKTOP_TS" 2>&1 | tr -d '\r' | tail -1)
    LAN_PATH="${out:-no answer from tailscale ping}"
    is_lan_path "$out"
  elif [ -n "$DESKTOP_LAN" ]; then
    LAN_PATH="tcp $DESKTOP_LAN:$DESKTOP_LAN_PORT"
    timeout 5 bash -c "exec 3<>/dev/tcp/$DESKTOP_LAN/$DESKTOP_LAN_PORT" 2>/dev/null
  else
    LAN_PATH="no tailscale and no ENV_SYNC_DESKTOP_LAN"; return 1
  fi
}
# is_lan_path <tailscale ping line>: a direct path over an RFC 1918 address (10/8, 172.16/12, 192.168/16); DERP = relay.
is_lan_path() { grep -qE ' via (10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)[0-9.]+:[0-9]+' <<< "$1"; }
# lan_or_pending <what>: go on when on the LAN; otherwise record "data copy pending" once and stop (exit 4).
lan_or_pending() {
  if on_lan; then echo "office LAN: $LAN_PATH"; return 0; fi
  echo "$(date '+%F %T') ${SLICE:-?} $1" >> "$PENDING_REC"
  echo "DATA COPY PENDING: not on the office LAN ($LAN_PATH); recorded in $PENDING_REC - do it at the next LAN chance (rule 16)"
  exit 4
}
ckfail() {
  local msg; msg="CHECKPOINT FAILED ($SLICE, $(date '+%F %T')): $*"
  echo "$msg" >&2; echo "not retried now: the next try is at the next 15-minute mark (--if-older counts this attempt)" >&2
  mkdir -p "$(ckpt_dir)" 2>/dev/null && printf '%s\n' "$msg" | head -3 >> "$(ckpt_dir)/failures.log"
  laptop_down >&2; exit 3
}

# laptop_up / laptop_down: the laptop's containers only for a database copy (owner 2026-10-26 / CKP-1 Q3), through the
# laptop's turn file (shared with the dev2 lane): claim it first, free it after. Refuses while another lane holds it.
laptop_up() {
  local t c; t=$(head -1 "$TURN_FILE" 2>/dev/null)
  case "$t" in free*|"main "*) ;; "") die "the laptop turn file $TURN_FILE is missing; ask the owner";; *) die "the laptop turn file says '$t'; wait until it is free";; esac
  case "$t" in "main "*) LAPTOP_TURN_OURS=0;; *) echo "main $SLICE $(date '+%F %T')" > "$TURN_FILE"; LAPTOP_TURN_OURS=1;; esac
  LAPTOP_STARTED=""
  for c in $LAPTOP_CONTAINERS; do
    [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || { docker start "$c" > /dev/null || die "cannot start $c"; LAPTOP_STARTED+="$c "; }
  done
  [ -n "$LAPTOP_STARTED" ] && { echo "laptop: started $LAPTOP_STARTED"; sleep 5; }
  return 0
}
laptop_down() {
  [ -n "${LAPTOP_STARTED:-}" ] && { docker stop $LAPTOP_STARTED > /dev/null; echo "laptop: stopped $LAPTOP_STARTED"; LAPTOP_STARTED=""; }
  [ "${LAPTOP_TURN_OURS:-0}" = 1 ] && { echo "free $(date '+%F %T')" > "$TURN_FILE"; echo "laptop: turn file free"; LAPTOP_TURN_OURS=0; }
  return 0
}

# resume_note <file> <kind>: the RESUME NOTE beside a code checkpoint - where the slice stands and what is open, read from
# the desktop session's own files (status file, newest line first; the resume note it keeps) and the laptop's relay file.
# Read-only on the desktop.
resume_note() {
  local f="$1" kind="$2" st="" rs="" relay last
  if [ -n "${NAME:-}" ]; then
    st=$(dps "if (Test-Path -LiteralPath '$SDIR/$NAME.status.md') { Get-Content -LiteralPath '$SDIR/$NAME.status.md' -TotalCount 40 }")
    rs=$(dps "if (Test-Path -LiteralPath '$SDIR/$NAME.resume.md') { Get-Content -LiteralPath '$SDIR/$NAME.resume.md' }")
  fi
  relay="$RELAY_ROOT/$SLICE/to_chat.md"
  last=$([ -f "$relay" ] && grep -o "id $SLICE-[0-9]*" "$relay" | tail -1)
  { echo "# RESUME NOTE - $SLICE - $kind checkpoint $(date '+%F %T')"; echo
    echo "- desktop: ${D_BRANCH:-?} @ ${D_HEAD:0:9}; session: ${NAME:-none named}"
    echo "- last relay entry from the laptop: ${last:-none found} ($relay)"
    echo "- open questions (QUESTION-READY lines in the status file; check each for a later ANSWER READ):"
    printf '%s\n' "$st" | grep '^QUESTION-READY' | sed 's/^/    /'
    printf '%s\n' "$st" | grep '^ANSWER [0-9]* READ' | sed 's/^/    answered: /'
    echo; echo "## The session's own resume note (${NAME:-?}.resume.md)"; echo
    if [ -n "$rs" ]; then printf '%s\n' "$rs"; else echo "(none written)"; fi
    echo; echo "## The session's status file, newest line first (first 40 lines)"; echo
    if [ -n "$st" ]; then printf '%s\n' "$st" | sed 's/^/    /'; else echo "(none)"; fi
  } > "$f"
}

# hrun <script> [plain-token args...]: run a staged script with the DESKTOP HOST's Git Bash, not in its container. git on
# the container's Windows bind mount takes ~51 s per status (measured CKP-1) against ~2 s on the host, and a checkpoint
# scans the tree several times. The checkpoint scripts leave the host's git config alone (they touch it only in a container).
hrun() {
  local s="$1"; shift
  ensure_stage
  dps "& '$GITBASH' '$D_BENCH/$STAGE/$s' $*"
}

# make_code_ckpt <kind> [<commit>]: build a code checkpoint on the desktop host, copy it to the laptop's slice folder, check
# every file's sha256 on both sides, add the resume note and ckpt.txt. Sets CK_DIR, CK_TREE, CK_SIZE, CK_OUT, D_HEAD, D_BRANCH.
make_code_ckpt() {
  local kind="$1" commit="${2:-}" stamp hdir ldir lsum dsum
  stamp=$(date +%Y%m%d_%H%M%S)
  hdir="$D_BENCH/$STAGE/ckpt_out/$SLICE/$stamp"; ldir="$(ckpt_dir)/$stamp"
  L_HEAD=$(lgit rev-parse HEAD)
  CK_OUT=$(hrun ckpt_code.sh "$D_BENCH/apps/nirmaan_stack" "$hdir" "$L_HEAD" "$commit")
  [ -n "$(kv ckpt "$CK_OUT")" ] || ckfail "the desktop could not make the code checkpoint:\n$CK_OUT"
  CK_TREE=$(kv tree "$CK_OUT"); D_HEAD=$(kv head "$CK_OUT"); D_BRANCH=$(kv branch "$CK_OUT")
  [ "$D_BRANCH" = "$(lgit rev-parse --abbrev-ref HEAD)" ] || ckfail "the desktop is on $D_BRANCH, the laptop on $(lgit rev-parse --abbrev-ref HEAD)"
  mkdir -p "$(ckpt_dir)" || ckfail "cannot create $(ckpt_dir)"
  "$SCP" -q -r "${SSHO[@]}" "$DESKTOP:$hdir" "$(ckpt_dir)/" || ckfail "copying the checkpoint to the laptop failed"
  dsum=$(dps "Get-ChildItem -LiteralPath '$hdir' -File | ForEach-Object { (Get-FileHash -Algorithm SHA256 -LiteralPath \$_.FullName).Hash.ToLower() + ' ' + \$_.Name }" | sort)
  lsum=$( (cd "$ldir" && sha256sum -- *) | sed 's/ \*/ /; s/  */ /' | sort)
  [ -n "$dsum" ] && [ "$dsum" = "$lsum" ] || ckfail "the laptop copy differs from the desktop's:\ndesktop:\n$dsum\nlaptop:\n$lsum"
  resume_note "$ldir/resume.md" "$kind"
  CK_SIZE=$(du -sb "$ldir" | cut -f1); CK_DIR="$ldir"
  { echo "kind=$kind"; echo "slice=$SLICE"; echo "session=${NAME:-}"; echo "made=$(date '+%F %T')"
    echo "desktop_head=$D_HEAD"; echo "laptop_head=$L_HEAD"; echo "tree=$CK_TREE"; echo "size=$CK_SIZE"; } > "$ldir/ckpt.txt"
  # keep the newest CKPT_KEEP on both machines
  prune_local "$(ckpt_dir)" "$CKPT_KEEP"
  dps "Get-ChildItem -LiteralPath '$D_BENCH/$STAGE/ckpt_out/$SLICE' -Directory | Sort-Object Name | Select-Object -SkipLast $CKPT_KEEP | Remove-Item -Recurse -Force" > /dev/null
}

cmd_checkpoint_code() {
  need_slice
  local t0 newest age
  if [ -n "${IF_OLDER:-}" ]; then
    newest=$(ls -1td "$(ckpt_dir)"/[0-9]*_[0-9]* "$(ckpt_dir)/.last_attempt" 2>/dev/null | head -1)
    if [ -n "$newest" ]; then
      age=$(( ($(date +%s) - $(stat -c %Y "$newest")) / 60 ))
      [ "$age" -lt "$IF_OLDER" ] && { echo "checkpoint not due: the newest ($(basename "$newest")) is $age min old (< $IF_OLDER)"; return 0; }
    fi
  fi
  t0=$(date +%s)
  mkdir -p "$(ckpt_dir)" && touch "$(ckpt_dir)/.last_attempt"
  make_code_ckpt B1
  echo "CHECKPOINT CODE $SLICE: $CK_DIR"
  echo "  desktop ${D_HEAD:0:9}, tree $CK_TREE, $(( CK_SIZE / 1024 )) KiB, $(sed -n 's/^tracked_files=//p' "$CK_DIR/head.txt") tracked + $(sed -n 's/^untracked_files=//p' "$CK_DIR/head.txt") new file(s), took $(( $(date +%s) - t0 )) s; nothing applied on the laptop"
  # the desktop's commits come across as after every commit (fast-forward only, no restart: nothing is served from
  # here). Only when the desktop is ahead - its git_state check in the container is the slow part.
  if [ "$D_HEAD" != "$L_HEAD" ] && [ "$(kv base_is_ancestor "$CK_OUT")" = 1 ]; then
    if [ -z "$(lgit status --porcelain --untracked-files=no)" ]; then
      ( ALLOW_DIRTY=1 NO_RESTART=1 cmd_from_desktop ) 2>&1 | sed 's/^/  /' || true
    else
      echo "  the desktop is ahead but the laptop has uncommitted changes: commits not fast-forwarded (they are in the checkpoint's bundle)"
    fi
  fi
}

# tell_session <text>: append an ANSWER-style entry to the desktop session's message file (never overwrites).
tell_session() {
  [ -n "${NAME:-}" ] || return 0
  printf '\n=== %s ===\n' "$1" > "$TMPD/msg"
  "$SCP" -q "${SSHO[@]}" "$TMPD/msg" "$DESKTOP:$SDIR/$NAME.msg_append.tmp" &&
    dps "Get-Content -LiteralPath '$SDIR/$NAME.msg_append.tmp' | Add-Content -LiteralPath '$SDIR/$NAME.message.md'; Remove-Item -LiteralPath '$SDIR/$NAME.msg_append.tmp'" > /dev/null
}

cmd_checkpoint() {
  need_slice
  [ "${YES:-0}" = 1 ] || die "checkpoint REPLACES the laptop's database with a proved copy of the desktop's. Re-run with --yes."
  local t0 t_code stamp out br commit parent tree lfp gottree
  t0=$(date +%s); stamp=$(date +%Y%m%d-%H%M)
  lan_or_pending "CHECKPOINT $SLICE $stamp (leaving): needs the office LAN - do it before unplugging"
  echo "desktop: checkpoint commit on a local branch (temporary index; the session's tree is not touched) ..."
  out=$(hrun ckpt_branch.sh "$D_BENCH/apps/nirmaan_stack" "$SLICE" "$stamp")
  br=$(kv branch "$out"); commit=$(kv commit "$out"); parent=$(kv parent "$out"); tree=$(kv tree "$out")
  [ -n "$commit" ] || ckfail "the checkpoint commit failed:\n$out"
  echo "  $br = ${commit:0:9} (parent ${parent:0:9}, tree ${tree:0:12})"
  laptop_up
  pull_backup
  t_code=$(( $(date +%s) - t0 ))
  tell_session "CHECKPOINT TAKEN $(date '+%F %H:%M') | $br ${commit:0:9} + database backup $(basename "$PB_PREFIX") | carry on"
  echo "desktop: the code and the database are captured ($t_code s); the session may carry on"
  make_code_ckpt B3 "$commit"
  { echo "ckpt_branch=$br"; echo "ckpt_commit=$commit"; echo "backup=$PB_PREFIX"; } >> "$CK_DIR/ckpt.txt"
  pull_copy_prove_restore "CHECKPOINT $SLICE $stamp ($br ${commit:0:9})"
  lfp=$(fp_of laptop); printf '%s\n' "$lfp" | sed 's/^/fingerprint=/' >> "$CK_DIR/ckpt.txt"
  # verify: the code (the bundle rebuilds the checkpoint commit's tree on the laptop), the data, the resume note
  git -C "$REPO" fetch -q "$CK_DIR/commits.bundle" "+refs/heads/$br:refs/ckpt/$br" 2>/dev/null || ckfail "the checkpoint bundle does not fetch on the laptop"
  gottree=$(git -C "$REPO" rev-parse "refs/ckpt/$br^{tree}")
  { [ "$gottree" = "$tree" ] && [ "$CK_TREE" = "$tree" ]; } || ckfail "code hash mismatch: desktop $tree, bundle $gottree, checkpoint $CK_TREE"
  [ "$(grep '^fp_' "$PULL_RECORD")" = "$lfp" ] || ckfail "the laptop's data fingerprint is not the pulled one"
  grep -q "^# RESUME NOTE - $SLICE" "$CK_DIR/resume.md" || ckfail "the resume note is not readable"
  laptop_down
  echo "CHECKPOINT READY $SLICE $(date '+%F %H:%M'): code $br ${commit:0:9} (tree ${tree:0:12} = bundle = checkpoint), data $(basename "$PB_PREFIX") restored on the laptop (fingerprint recorded), resume note $CK_DIR/resume.md; took $(( $(date +%s) - t0 )) s (desktop captured in $t_code s)"
}

# ---- back home (CKP-2, B4) -----------------------------------------------------------------------------------
cmd_catch_up() {
  need_slice
  local st last
  st=$(desktop_alive) || { echo "NOT CAUGHT UP: the desktop does not answer over SSH (laptop offline, or the desktop is down - then see resume-on-laptop)"; return 3; }
  echo "desktop answers: $(printf '%s' "$st" | tr '\n' ' ')"
  IF_OLDER="" cmd_checkpoint_code
  last=$(sed -n 's/^# desktop fingerprint at the laptop.s last db-pull (\([^,]*\),.*/\1/p' "$PULL_RECORD" 2>/dev/null | head -1)
  echo "CAUGHT-UP $SLICE $(date '+%F %H:%M'): code = the checkpoint above; data = the last db-pull ${last:-never} ($(sed -n 's/^# covers: //p' "$PULL_RECORD" 2>/dev/null | head -1))"
  if [ -n "$last" ]; then echo "  the laptop's data is $(( ($(date +%s) - $(date -d "$last" +%s)) / 60 )) min behind that copy's moment (the desktop may have written since)"; fi
  if [ -f "$PENDING_REC" ]; then echo "  DATA COPY PENDING (do it on the office LAN):"; sed 's/^/    /' "$PENDING_REC"; fi
}

# ---- resume on the laptop (CKP-1, B5) ----------------------------------------------------------------------------
desktop_alive() {   # prints the session's state lines; 0 when the desktop answers over SSH
  local out ps
  ps="\$s='$SDIR/${NAME:-none}.status.md'; 'ssh=ok'; if (Test-Path -LiteralPath \$s) { 'status=' + (Get-Item -LiteralPath \$s).LastWriteTime.ToString('HH:mm:ss') + ' ' + (Get-Content -LiteralPath \$s -TotalCount 1) }; Get-ChildItem (Join-Path \$env:USERPROFILE '.claude/jobs') -Directory -ErrorAction SilentlyContinue | ForEach-Object { \$j = Get-Content (Join-Path \$_.FullName 'state.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json; if (\$j.name -eq '${NAME:-none}') { 'job=' + \$_.Name + ' ' + \$j.state } }"
  out=$(timeout 30 "$SSH" "${SSHO[@]}" "$DESKTOP" "$ps" 2>&1 | tr -d '\r')
  grep -q '^ssh=ok' <<< "$out" || return 1
  printf '%s\n' "$out" | grep -v '^ssh=ok'
  return 0
}

cmd_resume_on_laptop() {
  need_slice
  local st b3 snaps s prev target fp want mode=report
  [ "${DRY_RUN:-0}" = 1 ] && mode=dry-run
  [ "${TAKEOVER:-0}" = 1 ] && mode=takeover
  if st=$(desktop_alive); then
    echo "DESKTOP UP: it answers over SSH. $(printf '%s' "$st" | tr '\n' ' ')"
    [ "$mode" = takeover ] && die "refusing the takeover: the desktop is up, so work continues there (owner 2026-11-17 14:13)"
    [ "$mode" = report ] && { echo "nothing done: the desktop stays the master"; return 0; }
  else
    echo "DESKTOP DOWN: no SSH answer in 30 s"
  fi
  b3=$(grep -l '^kind=B3' "$(ckpt_dir)"/*/ckpt.txt 2>/dev/null | sort | tail -1)
  [ -n "$b3" ] || die "no B3 checkpoint for $SLICE in $(ckpt_dir); a takeover needs one"
  b3=$(dirname "$b3")
  snaps="$b3"
  for s in $(ls -1d "$(ckpt_dir)"/[0-9]*_[0-9]* 2>/dev/null | sort); do
    [[ "$(basename "$s")" > "$(basename "$b3")" ]] && grep -q '^kind=B1' "$s/ckpt.txt" 2>/dev/null && snaps+=$'\n'"$s"
  done
  echo "checkpoints to rebuild, in order:"
  while read -r s; do echo "  $(basename "$s") $(sed -n 's/^kind=//p' "$s/ckpt.txt") tree $(sed -n 's/^tree=//p' "$s/head.txt" | cut -c1-12)"; done <<< "$snaps"
  want=$(sed -n 's/^fingerprint=//p' "$b3/ckpt.txt")
  if [ "$mode" = report ]; then echo "nothing done: re-run with --takeover --yes on the owner's word (or --dry-run to rehearse)"; return 3; fi
  [ "$mode" = takeover ] && [ "${YES:-0}" != 1 ] && die "the takeover makes the laptop the master; re-run with --yes"

  # data: the laptop must hold the B3 copy (the checkpoint restored it); a takeover never overwrites a database itself
  laptop_up
  fp=$(fp_of laptop)
  if [ "$fp" = "$want" ]; then echo "data: the laptop holds the checkpoint's copy (fingerprint equal)"
  elif [ "$mode" = dry-run ]; then echo "data: DIFFERENT from the checkpoint's copy - a takeover would stop and ask for $(sed -n 's/^backup=//p' "$b3/ckpt.txt") to be restored first"
  else
    laptop_down
    die "the laptop's data is not the checkpoint's. Restore $(sed -n 's/^backup=//p' "$b3/ckpt.txt") first (the runbook's restore, with a proved backup of the laptop's current data), then re-run"
  fi

  # code: rebuild every checkpoint in order on the checkout (or, for a dry run, on a throw-away clone)
  if [ "$mode" = dry-run ]; then
    target="$TMPD/clone"; git clone -q --shared --branch "$(lgit rev-parse --abbrev-ref HEAD)" "$REPO" "$target" || die "cannot make the dry-run clone"
  else target="$REPO"; fi
  prev=""
  while read -r s; do
    if [ -n "$prev" ]; then bash "$HERE/remote/ckpt_apply.sh" undo "$target" "$prev" | sed 's/^/  /'; fi
    echo "applying $(basename "$s") ..."
    bash "$HERE/remote/ckpt_apply.sh" apply "$target" "$s" > "$TMPD/apply.out" 2>&1; local rc=$?
    sed 's/^/  /' "$TMPD/apply.out"
    [ "$rc" = 0 ] || { laptop_down; die "STOPPED at $(basename "$s") (see above); $target is left as it is"; }
    prev="$s"
  done <<< "$snaps"
  echo "code: $target = $(basename "$prev") (tree $(sed -n 's/^tree=//p' "$prev/head.txt" | cut -c1-12)); data fingerprint $( [ "$(fp_of laptop)" = "$want" ] && echo equal || echo DIFFERENT)"
  if [ "$mode" = dry-run ]; then
    laptop_down
    echo "DRY RUN done: the checkout, the database and the master are unchanged; the desktop stays the master"; return 0
  fi
  echo "laptop $SLICE $(date '+%F %T') (resume-on-laptop from $(basename "$prev"))" > "$MASTER_REC"
  LAPTOP_TURN_OURS=0; echo "main $SLICE MASTER $(date '+%F %T')" > "$TURN_FILE"
  echo "RESUMED-ON-LAPTOP $SLICE $(date '+%F %H:%M'): the laptop is the master; continue from $prev/resume.md:"
  sed -n '1,12p' "$prev/resume.md" | sed 's/^/  /'
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
  grep -q '^done=' <<< "$out" || die "the desktop launch failed"
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

# The dispatch is one block that ends in exit: bash reads a script as it runs it, and from-desktop can fast-forward
# this very file, so nothing after the block may be read from the new copy.
{
CMD="${1:-}"; [ $# -gt 0 ] && shift
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1;; --allow-dirty) ALLOW_DIRTY=1;; --no-restart) NO_RESTART=1;; --no-data) NO_DATA=1;;
    --discard-desktop-writes) DISCARD=1;;
    --slice) SLICE="${2:-}"; shift;; --if-older) IF_OLDER="${2:-}"; shift;; --covers) COVERS="${2:-}"; shift;;
    --takeover) TAKEOVER=1;; --dry-run) DRY_RUN=1;;
    --logs) LOGS="${2:-}"; shift;; --lines) LINES_N="${2:-40}"; shift;;
    --name) NAME="${2:-}"; shift;; --brief) BRIEF="${2:-}"; shift;; --message) MESSAGE="${2:-}"; shift;;
    --interval) INTERVAL="${2:-60}"; shift;; --idle-limit) IDLE_LIMIT="${2:-5}"; shift;; --pull-back) PULL_BACK=1;;
    *) die "unknown flag $1";;
  esac
  shift
done
case "$CMD" in status|to-desktop|from-desktop|db-pull|db-push|watch|session-*|checkpoint-code|checkpoint|catch-up) ensure_stage;; esac   # once, outside any $(...)
[ "$CMD" = resume-on-laptop ] && STAGE_LAPTOP_ONLY=1   # once, outside any $(...)
case "$CMD" in
  status) cmd_status;; to-desktop) cmd_to_desktop;; from-desktop) cmd_from_desktop;;
  db-pull) cmd_db_pull;; db-push) cmd_db_push;; reports) cmd_reports;; watch) cmd_watch;; print) cmd_print;;
  checkpoint-code) cmd_checkpoint_code;; checkpoint) cmd_checkpoint;; catch-up) cmd_catch_up;; resume-on-laptop) cmd_resume_on_laptop;;
  session-start) cmd_session_start;; session-send) cmd_session_send;;
  session-wait) cmd_session_wait;; session-stop) cmd_session_stop;;
  *) sed -n '2,/^set -uo pipefail/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 1;;
esac
exit
}
