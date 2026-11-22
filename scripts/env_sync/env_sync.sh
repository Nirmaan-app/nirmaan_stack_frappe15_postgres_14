#!/usr/bin/env bash
# env_sync.sh -- the LAPTOP side of the owner's two-machine loop (docs/agents/environments.md).
# Runs on the laptop in Git Bash. Every transfer goes through the desktop's SSH server (scp + git bundles);
# nothing here talks to GitHub, and nothing here ever pushes to origin.
#
#   env_sync.sh status [--no-data]     code and data on both machines, and a verdict
#   env_sync.sh to-desktop             fast-forward the desktop to the laptop's commits, then destale it
#   env_sync.sh from-desktop           fast-forward the laptop to the desktop's commits, then destale it
#   env_sync.sh db-pull --yes [--covers STEP] [--chunked]
#                                      replace the laptop's database with a fresh, PROVED backup of the desktop's (the
#                                      master); STEP is written into the pull record (which step the copy covers). The normal
#                                      copy is tried once on any network; if it fails, the resumable chunked copy takes
#                                      over (--chunked forces it)
#   env_sync.sh db-pull --yes --hold | --restore
#                                      CKP-5: AWAY from the office the copy is only HELD (fetched + sha256-checked into
#                                      frappe-bench\envsync\backups\pending\<stamp>\, no Docker, nothing loaded); in the
#                                      office it is loaded as before. --hold / --restore force one or the other
#   env_sync.sh db-restore-held --yes [--dry-run]
#                                      load the newest HELD copy into the laptop's database (scratch proof, restore,
#                                      migrate, fingerprint); --dry-run only loads it into a scratch database and compares
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
#   env_sync.sh resume-on-laptop --slice <dev2 unit> --code-only [--dry-run | --yes]
#                                      a dev2 unit's newest CODE copy onto the laptop's dev2 checkout, on the owner's word:
#                                      no data, no container, no master record (dev2 = code copies only)
#
# The checkpoint poller - a Windows scheduled task on the laptop, so the copies go on without Claude Code (CKP-3):
#   env_sync.sh units                  CKP-4: which Claude Code sessions work in which Stack checkout on the desktop, read-only
#                                      (every worktree of main dev and dev2 = one unit; no `poller follow` needed)
#   env_sync.sh checkpoint-code --slice <unit> --checkout <desktop path> [--env main|dev2]
#                                      B1 of any checkout / branch (a unit), into checkpoints\<unit>\ on the laptop
#   env_sync.sh resume-on-laptop --units [--dry-run]
#                                      every unit's last checkpoint; --dry-run rebuilds each on a throw-away clone
#   env_sync.sh leaving                raise the shared "leaving" flag (the Desktop shortcut "Leaving" and chat-Claude do
#                                      the same); the copier then checkpoints every detected unit and writes READY
#   env_sync.sh poller install         register the task "BoQ Checkpoint Poller" (every 15 min, log-on, network connect,
#                                      resume from sleep; the logged-on user, no stored password, hidden, one at a time)
#   env_sync.sh poller follow --slice S --name N     OPTIONAL since CKP-4 (sessions are detected): names main dev's unit
#                                      after a slice while that session works (unfollow: back to the detected name)
#   env_sync.sh poller status          the task, what it follows, pause state, the last heartbeat
#   env_sync.sh poller pause | resume  the off switch (runs still write a PAUSED heartbeat)
#   env_sync.sh poller run             one run now, in this terminal
#   env_sync.sh poller remove          unregister the task (the undo of install)
#   env_sync.sh poller shortcuts       the owner's Desktop shortcuts "Copier - Pause / Resume / Status" (shortcuts-remove)
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
# env_sync's own run records, the report files copied from the desktop's Desktop and the poller's heartbeat go here, never
# into the laptop Desktop's root (owner 2026-11-18 00:39 clean-up, MEM-R0 D4, CKP-3 P6).
RUN_RECORDS="${ENV_SYNC_RUN_RECORDS:-$L_REPORTS/BoQ main lane/_run_records}"
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
# The network a database copy runs on is RECORDED, not gated (owner 2026-11-17 18:52: "even at home first we should try normal
# copy and resort to chunked copy only when it fails"). Tailscale says how it reaches the desktop: "via <private LAN address>"
# = direct on a LAN; "via DERP(...)" = the relay; a public address = direct over the internet. (The desktop's LAN address
# changes - it was 192.168.1.3, on 2026-11-17 it is 192.168.0.210 - so no fixed address is trusted.) Without Tailscale, a TCP
# probe of ENV_SYNC_DESKTOP_LAN is the fallback.
TAILSCALE="${ENV_SYNC_TAILSCALE:-/c/Program Files/Tailscale/tailscale.exe}"
DESKTOP_TS="${ENV_SYNC_DESKTOP_TS:-nitesh-desktop}"
DESKTOP_LAN="${ENV_SYNC_DESKTOP_LAN:-}"
DESKTOP_LAN_PORT="${ENV_SYNC_DESKTOP_LAN_PORT:-22}"
# The chunked route (rule 16, the VRF-6 lesson): parts of CHUNK_MB in envsync/chunks on each machine, each part sha-checked and
# re-sent alone up to CHUNK_TRIES times; the normal copy gets one try of at most COPY_TIMEOUT seconds per file.
CHUNK_MB="${ENV_SYNC_CHUNK_MB:-50}"
CHUNK_TRIES="${ENV_SYNC_CHUNK_TRIES:-4}"
COPY_TIMEOUT="${ENV_SYNC_COPY_TIMEOUT:-3600}"
CKPT_KEEP="${ENV_SYNC_CKPT_KEEP:-8}"                  # checkpoint folders kept per slice
BACKUP_KEEP="${ENV_SYNC_BACKUP_KEEP:-3}"              # envsync/backups folders kept per machine
# CKP-5 (owner 2026-11-19 00:16 "1,3, and 4 we will do"; 00:19 "just copy without docker....load later if required during
# takeover"): a database copy made for "leaving" or while AWAY is only HELD on the laptop's own disk - fetched and checked by
# size + sha256, Docker never started. It is loaded on a takeover or by db-restore-held. Never OneDrive, never private/backups.
PENDING_ROOT="${ENV_SYNC_PENDING_ROOT:-$BENCH_HOST/$STAGE/backups/pending}"
HELD_KEEP="${ENV_SYNC_HELD_KEEP:-2}"                  # held copies kept
# Any Docker start this tooling makes on the laptop (a restore, a takeover, the office db-pull) - DOCK-R0 fixes 3 and 4:
DOCKER_BIN="${ENV_SYNC_DOCKER:-docker}"
WSL_BIN="${ENV_SYNC_WSL:-wsl.exe}"
ENGINE_WAIT="${ENV_SYNC_ENGINE_WAIT:-90}"             # seconds a start may take before it counts as hung
ENGINE_STEP="${ENV_SYNC_ENGINE_STEP:-3}"
ENGINE_SETTLE="${ENV_SYNC_ENGINE_SETTLE:-20}"         # after the engine first answers, before large requests
WAKE_DELAY="${ENV_SYNC_WAKE_DELAY:-180}"              # no Docker start this soon after a wake from sleep / hibernate
MIN_FREE_MB="${ENV_SYNC_MIN_FREE_MB:-3000}"           # no Docker start with less free memory (owner: the gate stays 3 GB)
DK_T="${ENV_SYNC_DOCKER_TIMEOUT:-25}"                 # every docker probe has a time limit
# CKP-4: the second environment's checkout on each machine (code snapshots only; its containers are NEVER started here).
DEV2_D_CHECKOUT="${ENV_SYNC_DEV2_DESKTOP_CHECKOUT:-C:/Users/USER/Documents/frappe_docker_dev2/development/frappe-bench/apps/nirmaan_stack}"
DEV2_L_REPO="${ENV_SYNC_DEV2_LAPTOP_REPO:-$(cygpath -u "$USERPROFILE")/Documents/frappe_docker_dev2/development/frappe-bench/apps/nirmaan_stack}"
MASTER_REC="$BENCH_HOST/$STAGE/master.txt"            # present only while the laptop is the master (resume-on-laptop)
TURN_FILE="${ENV_SYNC_TURN_FILE:-$(cygpath -u "$USERPROFILE")/envsync_laptop_turn.txt}"
GITBASH="${ENV_SYNC_DESKTOP_GITBASH:-C:/Program Files/Git/bin/bash.exe}"   # the desktop host's Git Bash (hrun)
# The environment these settings belong to (BCS-T1): dev2 when the containers named above are dev2's or this is dev2's
# checkout, else main. The laptop containers a command may start follow it: main has its four by default, dev2 has NO
# default (2026-11-19 16:1x: a dev2 db-pull started main's) - it must name its own in .claude/state/env.local.
case "$FRAPPE_C|$PG_C|$REPO/" in *frappe_dev2-*|*/frappe_docker_dev2/*) ENV_NAME=dev2;; *) ENV_NAME=main;; esac
LAPTOP_CONTAINERS="${ENV_SYNC_LAPTOP_CONTAINERS:-}"
[ -n "$LAPTOP_CONTAINERS" ] || [ "$ENV_NAME" = dev2 ] || LAPTOP_CONTAINERS="frappe_docker_devcontainer-postgresql-1 frappe_docker_devcontainer-redis-cache-1 frappe_docker_devcontainer-redis-queue-1 frappe_docker_devcontainer-frappe-1"
SSH=/c/Windows/System32/OpenSSH/ssh.exe
SCP=/c/Windows/System32/OpenSSH/scp.exe
# ConnectTimeout only covers CONNECTING. A connection that stalls afterwards (CKP-4, 2026-11-18 18:25: the copier's first
# ssh hung for 10 minutes until it was killed by hand) is given up after 4 x 15 s without an answer from the desktop.
SSHO=(-o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

die() { printf 'env_sync: %b\n' "$*" >&2; exit 2; }
kv() { printf '%s\n' "$2" | sed -n "s/^$1=//p" | head -1; }
lgit() { git -C "$REPO" "$@"; }
dps() { "$SSH" "${SSHO[@]}" "$DESKTOP" "$@" 2>&1 | tr -d '\r'; }   # a PowerShell command on the desktop
TMPD="$(mktemp -d)"
# Whatever ends the command - an error included - the containers and the Docker Desktop THIS run started are put back
# (the laptop's standby), unless a takeover has just made the laptop the master (KEEP_LAPTOP_UP).
at_exit() {
  if [ "${KEEP_LAPTOP_UP:-0}" != 1 ] && { [ -n "${LAPTOP_STARTED:-}" ] || [ "${ENGINE_STARTED:-0}" = 1 ] || [ "${LAPTOP_TURN_OURS:-0}" = 1 ]; }; then
    echo "env_sync: the command ended early - putting the laptop back as it was" >&2; laptop_down >&2
  fi
  rm -rf "$TMPD"
}
trap at_exit EXIT

# stage_new <""|desktop/> <file>...: STAGE_NEW = the files the desktop does not already hold under that name with the same
# sha256 ($STAGE_HAVE, its own list). A file whose sha256 is unknown on either side counts as different.
stage_new() {
  local sub="$1" f h; shift
  local -A sum=(); STAGE_NEW=()
  while read -r h f; do [ -n "$f" ] && sum["${f#\*}"]="$h"; done <<< "$(sha256sum -- "$@" 2>/dev/null)"
  for f in "$@"; do
    h="${sum["$f"]:-unknown}"
    case $'\n'"$STAGE_HAVE"$'\n' in *$'\n'"staged=$h $sub${f##*/}"$'\n'*) ;; *) STAGE_NEW+=("$f");; esac
  done
}

# Copy remote/ into frappe-bench/envsync on both machines, once per run. On the desktop only what differs or is missing is
# copied (BCS-T1 F-1, 2026-11-22): Windows cannot overwrite a script that bash is running in the container, so while a backup
# ran - or waited for the backup lock - re-copying the same bytes failed and the copier read "the desktop did not answer".
ensure_stage() {
  [ -n "${STAGED:-}" ] && return 0
  mkdir -p "$BENCH_HOST/$STAGE" && cp "$HERE"/remote/* "$BENCH_HOST/$STAGE/" || die "cannot stage scripts on the laptop"
  # resume-on-laptop must work with the desktop gone: stage the laptop only
  [ "${STAGE_LAPTOP_ONLY:-0}" = 1 ] && { STAGED=1; return 0; }
  local STAGE_HAVE STAGE_NEW
  STAGE_HAVE=$(dps "New-Item -ItemType Directory -Force -Path '$D_BENCH/$STAGE/desktop', '$SDIR' | Out-Null; foreach (\$d in '', 'desktop/') { Get-ChildItem -LiteralPath ('$D_BENCH/$STAGE/' + \$d) -File | Where-Object { '.sh', '.py', '.ps1' -contains \$_.Extension } | ForEach-Object { 'staged=' + (Get-FileHash -Algorithm SHA256 -LiteralPath \$_.FullName).Hash.ToLower() + ' ' + \$d + \$_.Name } }")
  stage_new "" "$HERE"/remote/*
  [ "${#STAGE_NEW[@]}" = 0 ] || "$SCP" -q "${SSHO[@]}" "${STAGE_NEW[@]}" "$DESKTOP:$D_BENCH/$STAGE/" || die "cannot reach the desktop over SSH ($DESKTOP)"
  stage_new desktop/ "$HERE"/desktop/*.ps1
  [ "${#STAGE_NEW[@]}" = 0 ] || "$SCP" -q "${SSHO[@]}" "${STAGE_NEW[@]}" "$DESKTOP:$D_BENCH/$STAGE/desktop/" || die "cannot stage the desktop launch scripts"
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
  grep '^lock=' <<< "$out" | sed 's/^lock=/desktop: backup lock: /'
  PB_AFTER=$(d_counts "$PB_DB") || die "cannot count the desktop's rows after the backup"
  out=$(rrun desktop bash prove_backup.sh "$PB_PREFIX"); printf '%s\n' "$out" | sed 's/^/  /'
  [ "$(kv proof "$out")" = ok ] || die "the desktop backup did not prove whole (sizes, sha256, gzip -t, tar); the laptop is unchanged"
  PB_SHA=$(grep '^file=' <<< "$out")
  echo "desktop: backup $(basename "$PB_PREFIX") proved, $PB_TOOK s"
}

# pull_copy_prove_restore <covers>: copy PB_PREFIX's files to the laptop (sha256 + size equal), load the dump into a
# SCRATCH database on the laptop and check its counts against the desktop's, and only then replace the laptop's database
# (the replaced one stays as <db>_envsync_prev). Writes the pull record with what the copy covers.
# want_of <file name>: "<sha256> <size>" of a proved desktop backup file (PB_SHA).
want_of() { grep -F "file=$1 " <<< "$PB_SHA" | sed 's/.* size=\([0-9]*\) sha256=\([0-9a-f]*\)/\2 \1/'; }
# lfile <suffix>: where that backup file lives on the laptop - beside the desktop's path under sites/ for a copy that is
# loaded at once, in the held copy's own folder (HOLD_DIR) for a copy that is only held.
lfile() { if [ -n "${HOLD_DIR:-}" ]; then echo "$HOLD_DIR/$(basename "$PB_PREFIX")$1"; else echo "$BENCH_HOST/sites/$PB_PREFIX$1"; fi; }
# cprefix: the same place as the laptop's frappe container sees it, relative to sites/ (restore_files.sh takes it).
cprefix() { if [ -n "${HOLD_DIR:-}" ]; then echo "../${HOLD_DIR#"$BENCH_HOST"/}/$(basename "$PB_PREFIX")"; else echo "$PB_PREFIX"; fi; }
got_of() { echo "$(sha256sum < "$1" | cut -c1-64) $(stat -c %s "$1")"; }

# copy_normal: each backup file in one scp (one try, COPY_TIMEOUT each), sha256 + size checked. 0 = all three whole.
copy_normal() {
  local suf f
  for suf in -database.sql.gz -files.tar -private-files.tar; do
    f="$(lfile "$suf")"
    timeout "$COPY_TIMEOUT" "$SCP" -q "${SSHO[@]}" "$DESKTOP:$D_BENCH/sites/$PB_PREFIX$suf" "$f" || { COPY_WHY="scp of $(basename "$f") failed or timed out"; return 1; }
    [ "$(want_of "$(basename "$f")")" = "$(got_of "$f")" ] || { COPY_WHY="$(basename "$f") differs (desktop $(want_of "$(basename "$f")"), laptop $(got_of "$f"))"; return 1; }
    echo "  copied   $(basename "$f")  $(got_of "$f" | cut -c1-16) $(stat -c %s "$f")"
  done
}

# copy_chunked: the resumable route. The desktop splits each file into CHUNK_MB parts (envsync/chunks, local disk); each part
# is copied and sha-checked, a failed part is re-sent alone (CHUNK_TRIES); the laptop reassembles and checks the whole file
# (sha256 + size, and gzip -t for the dump). The parts are removed on both machines after the proved restore (chunks_cleanup).
copy_chunked() {
  local suf name f out parts p psize psha try ok cdir ldir
  CHUNK_STAMP=$(date +%Y%m%d_%H%M%S); CHUNK_PARTS=0; CHUNK_RESENT=0
  for suf in -database.sql.gz -files.tar -private-files.tar; do
    name="$(basename "$PB_PREFIX")$suf"; f="$(lfile "$suf")"
    cdir="$C_BENCH/$STAGE/chunks/$CHUNK_STAMP/$suf"; ldir="$BENCH_HOST/$STAGE/chunks/$CHUNK_STAMP/$suf"
    out=$(rrun desktop bash chunk_split.sh "$C_BENCH/sites/$PB_PREFIX$suf" "$cdir" "$CHUNK_MB")
    parts=$(kv parts "$out"); [ -n "$parts" ] || die "the desktop could not split $name; the laptop database is unchanged:
$out"
    mkdir -p "$ldir"
    while read -r line; do
      p=$(sed -n 's/^part=\([^ ]*\) .*/\1/p' <<< "$line"); [ -n "$p" ] || continue
      psize=$(sed -n 's/.* size=\([0-9]*\) .*/\1/p' <<< "$line"); psha=$(sed -n 's/.* sha256=\([0-9a-f]*\)$/\1/p' <<< "$line")
      ok=0
      for try in $(seq 1 "$CHUNK_TRIES"); do
        timeout 900 "$SCP" -q "${SSHO[@]}" "$DESKTOP:$D_BENCH/$STAGE/chunks/$CHUNK_STAMP/$suf/$p" "$ldir/$p" 2>/dev/null &&
          [ "$(got_of "$ldir/$p")" = "$psha $psize" ] && { ok=1; break; }
        CHUNK_RESENT=$((CHUNK_RESENT + 1)); echo "  part $suf/$p try $try failed; re-sending that part only"; sleep 5
      done
      [ "$ok" = 1 ] || die "the chunked copy failed at $name $p after $CHUNK_TRIES tries; the laptop database is unchanged (parts kept in $ldir for a later resume)"
      CHUNK_PARTS=$((CHUNK_PARTS + 1))
    done <<< "$(grep '^part=' <<< "$out")"
    cat "$ldir"/part_* > "$f" || die "reassembling $name failed; the laptop database is unchanged"
    [ "$(want_of "$name")" = "$(got_of "$f")" ] || die "the reassembled $name differs (desktop $(want_of "$name"), laptop $(got_of "$f")); the laptop database is unchanged"
    case "$suf" in *.gz) gzip -t "$f" 2>/dev/null || die "the reassembled $name fails gzip -t; the laptop database is unchanged";; esac
    echo "  chunked  $name  $parts part(s)  $(got_of "$f" | cut -c1-16) $(stat -c %s "$f")"
  done
}
chunks_cleanup() {
  [ -n "${CHUNK_STAMP:-}" ] || return 0
  rm -rf -- "$BENCH_HOST/$STAGE/chunks/$CHUNK_STAMP"
  dps "Remove-Item -LiteralPath '$D_BENCH/$STAGE/chunks/$CHUNK_STAMP' -Recurse -Force" > /dev/null
  echo "chunks: removed $CHUNK_STAMP on both machines (after the checked copy)"; CHUNK_STAMP=""
}

# pull_copy: the copy half (no Docker anywhere): every file sha256 + size equal to the desktop's proved backup.
pull_copy() {
  mkdir -p "$(dirname "$(lfile x)")"
  on_lan > /dev/null 2>&1; COPY_NET="${LAN_PATH:-unknown}"; is_lan_path "$COPY_NET" && COPY_NET="office LAN ($COPY_NET)" || COPY_NET="not the office LAN ($COPY_NET)"
  echo "network: $COPY_NET"
  local tc; tc=$(date +%s); COPY_ROUTE=normal
  if [ "${FORCE_CHUNKED:-0}" = 1 ]; then
    echo "copy: the chunked route (forced with --chunked)"; COPY_ROUTE="chunked (forced)"; copy_chunked
  elif ! copy_normal; then
    echo "copy: the normal copy failed ($COPY_WHY) - switching to the chunked route (no second normal try)"; COPY_ROUTE="chunked (after a failed normal copy: $COPY_WHY)"; copy_chunked
  fi
  COPY_SECS=$(( $(date +%s) - tc ))
  echo "copy: $COPY_ROUTE, $COPY_SECS s$( [ -n "${CHUNK_PARTS:-}" ] && echo ", ${CHUNK_PARTS} part(s), ${CHUNK_RESENT:-0} re-sent")"
}
# prove_restore <covers>: the Docker half. The dump goes into a SCRATCH database first; only when its counts are the
# desktop's does it replace the laptop's database. Works from wherever lfile points (a fresh copy or a held one).
prove_restore() {
  local covers="$1" db out
  [ -n "${HOLD_DIR:-}" ] || prune_local "$BENCH_HOST/$STAGE/backups" "$BACKUP_KEEP"
  db=$(kv db_name "$(rrun laptop bash get_db_name.sh)"); [ -n "$db" ] || die "cannot read the laptop's database name"
  MSYS_NO_PATHCONV=1 docker cp "$(cygpath -w "$(lfile -database.sql.gz)")" "$PG_C:/tmp/envsync_restore.sql.gz" || die "docker cp of the dump failed"
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
  rrun laptop bash restore_files.sh "$(cprefix)" | sed 's/^/  /' || die "files or migrate failed (bench is stopped)"
  start_services laptop
  # The laptop now holds exactly the desktop's backup: its fingerprint is the desktop's as of this pull. db-push
  # refuses later if the desktop has moved away from it (writes the laptop never saw). A HELD copy keeps the moment it
  # was made (HELD_MADE), not the moment it was loaded: it covers nothing the desktop did after that.
  { echo "# desktop fingerprint at the laptop's last db-pull (${HELD_MADE:-$(date '+%F %T')}, backup $(basename "$PB_PREFIX"))"
    echo "# covers: ${covers:-a db-pull on request}"
    echo "# backup: $PB_PREFIX"
    echo "# copy: ${HELD_COPY:-${COPY_ROUTE:-unknown}, ${COPY_SECS:-?} s; network: ${COPY_NET:-unknown}}"
    fp_of laptop; } > "$PULL_RECORD"
  echo "laptop: recorded the pulled fingerprint in $PULL_RECORD (covers: ${covers:-a db-pull on request})"
  chunks_cleanup
}
pull_copy_prove_restore() { pull_copy; prove_restore "$1"; }

# ---- CKP-5: a database copy that is HELD, not loaded ----------------------------------------------------------------
# hold_copy <covers>: after pull_backup. Fetches the three backup files into PENDING_ROOT/<the desktop backup's stamp>/
# (normal copy first, chunked on failure, each file sha256 + size equal), writes held.txt with everything a later restore
# needs (the desktop's counts before / after its backup, the file hashes, the desktop's fingerprint at backup time) and
# keeps the newest HELD_KEEP. Docker is not touched. Sets HOLD_DIR.
hold_copy() {
  local covers="$1" hstamp dfp
  # the folder is named after the backup FILE's own stamp (the laptop's local time), not the desktop's backup folder (its
  # container writes that one in UTC: on 2026-11-19 a fresh 01:08 backup read "20261118_193802" and looked a day old)
  hstamp=$(basename "$PB_PREFIX" | cut -d- -f1); [[ "$hstamp" =~ ^[0-9]{8}_[0-9]{6}$ ]] || hstamp=$(date +%Y%m%d_%H%M%S)
  HOLD_DIR="$PENDING_ROOT/$hstamp"
  mkdir -p "$HOLD_DIR" || die "cannot create $HOLD_DIR"
  dfp="${HOLD_DFP:-$(fp_of desktop)}"
  pull_copy
  { echo "held=$(date '+%F %T')"; echo "covers=${covers:-a db-pull on request}"; echo "backup=$PB_PREFIX"; echo "db=$PB_DB"
    echo "copy=$COPY_ROUTE, $COPY_SECS s; network: $COPY_NET"; echo "restored="
    printf '%s\n' "$PB_BEFORE" | sed 's/^/before_/'; printf '%s\n' "$PB_AFTER" | sed 's/^/after_/'
    printf '%s\n' "$PB_SHA" | sed 's/^/sha_/'; printf '%s\n' "$dfp" | sed 's/^/desktop_/'; } > "$HOLD_DIR/held.txt"
  chunks_cleanup
  prune_held
  echo "DB COPY HELD (not restored) $hstamp (a FRESH desktop backup made for this copy, in ${PB_TOOK:-?} s; the stamp is local time): $(du -sm "$HOLD_DIR" | cut -f1) MB in $HOLD_DIR; every file's size + sha256 equals the desktop's; Docker was not started; covers: ${covers:-a db-pull on request}"
  echo "  it is loaded only on a takeover (resume-on-laptop --takeover) or by: env_sync.sh db-restore-held --yes"
}
# prune_held: keep the newest HELD_KEEP complete held copies. A folder without held.txt is a copy that failed part-way:
# it is removed, so a failed copy can never take the place of a good one.
prune_held() {
  local d n=0
  for d in $(ls -1d "$PENDING_ROOT"/[0-9]*_[0-9]* 2>/dev/null | sort -r); do
    if [ -f "$d/held.txt" ]; then n=$((n + 1)); [ "$n" -le "$HELD_KEEP" ] && continue; fi
    [ "$d" = "${HOLD_DIR:-}" ] && continue
    rm -rf -- "$d" && echo "laptop: removed the $( [ -f "$d/held.txt" ] && echo old || echo incomplete ) held copy $(basename "$d")"
  done
}
# held_newest [unrestored]: the newest held copy's folder ("" when there is none; with "unrestored", the newest one that
# has not been loaded yet).
held_newest() {
  local d
  for d in $(ls -1d "$PENDING_ROOT"/[0-9]*_[0-9]* 2>/dev/null | sort -r); do
    [ -f "$d/held.txt" ] || continue
    if [ "${1:-}" = unrestored ] && [ -n "$(sed -n 's/^restored=//p' "$d/held.txt")" ]; then continue; fi
    echo "$d"; return 0
  done
}
# held_load <folder>: point the restore at a held copy and check its files again (size + sha256 as recorded).
held_load() {
  local suf f
  HOLD_DIR="$1"; [ -f "$HOLD_DIR/held.txt" ] || die "no held copy in $HOLD_DIR"
  PB_PREFIX=$(sed -n 's/^backup=//p' "$HOLD_DIR/held.txt"); PB_DB=$(sed -n 's/^db=//p' "$HOLD_DIR/held.txt")
  PB_BEFORE=$(sed -n 's/^before_//p' "$HOLD_DIR/held.txt"); PB_AFTER=$(sed -n 's/^after_//p' "$HOLD_DIR/held.txt")
  PB_SHA=$(sed -n 's/^sha_//p' "$HOLD_DIR/held.txt"); HELD_DFP=$(sed -n 's/^desktop_//p' "$HOLD_DIR/held.txt")
  HELD_MADE=$(sed -n 's/^held=//p' "$HOLD_DIR/held.txt"); HELD_COVERS=$(sed -n 's/^covers=//p' "$HOLD_DIR/held.txt")
  HELD_COPY=$(sed -n 's/^copy=//p' "$HOLD_DIR/held.txt"); HELD_COPY="${HELD_COPY:-held copy}"
  for suf in -database.sql.gz -files.tar -private-files.tar; do
    f="$(lfile "$suf")"
    [ -f "$f" ] && [ "$(want_of "$(basename "$f")")" = "$(got_of "$f")" ] || die "the held copy's $(basename "$f") is missing or no longer matches its recorded sha256; the laptop database is unchanged"
  done
  echo "held copy $(basename "$HOLD_DIR"): made $HELD_MADE, covers: $HELD_COVERS; files checked again (size + sha256)"
}
# held_scratch_check: load the held dump into a SCRATCH database on the laptop (never the live one), compare its counts
# with the desktop's and its fingerprint with the desktop's at backup time, drop it. 0 = both equal. Changes nothing real.
held_scratch_check() {
  local s out sfp
  MSYS_NO_PATHCONV=1 docker cp "$(cygpath -w "$(lfile -database.sql.gz)")" "$PG_C:/tmp/envsync_held_check.sql.gz" || { echo "  docker cp of the held dump failed"; return 1; }
  for s in scratch_counts.sh db_counts.sh; do MSYS_NO_PATHCONV=1 docker cp "$(cygpath -w "$HERE/remote/$s")" "$PG_C:/tmp/$s" > /dev/null || return 1; done
  out=$(MSYS_NO_PATHCONV=1 docker exec "$PG_C" bash /tmp/scratch_counts.sh "$PB_DB" /tmp/envsync_held_check.sql.gz fp)
  MSYS_NO_PATHCONV=1 docker exec "$PG_C" rm -f /tmp/envsync_held_check.sql.gz > /dev/null 2>&1
  grep -qx 'load=ok' <<< "$out" || { echo "  the held copy did not load into the scratch database:"; printf '%s\n' "$out" | head -5 | sed 's/^/    /'; return 1; }
  counts_check "$PB_BEFORE" "$PB_AFTER" "$(grep '^count_' <<< "$out")" || { echo "  the held copy's counts are not the desktop's"; return 1; }
  sfp=$(grep '^fp_' <<< "$out")
  if [ -n "$sfp" ] && [ "$sfp" = "$HELD_DFP" ]; then echo "  scratch fingerprint = the desktop's at backup time: $(tr '\n' ' ' <<< "$sfp")"; return 0; fi
  echo "  scratch fingerprint DIFFERS from the desktop's at backup time:"; echo "    scratch: $(tr '\n' ' ' <<< "$sfp")"; echo "    desktop: $(tr '\n' ' ' <<< "$HELD_DFP")"; return 1
}
# held_restore: prove_restore from the loaded held copy, then mark it restored. Needs the laptop's containers (laptop_up).
held_restore() {
  local t; t=$(date +%s)
  prove_restore "$HELD_COVERS (held $HELD_MADE, loaded $(date '+%F %T'))"
  sed -i "s/^restored=.*/restored=$(date '+%F %T')/" "$HOLD_DIR/held.txt"
  HELD_RESTORE_SECS=$(( $(date +%s) - t ))
  echo "DB RESTORED from the held copy $(basename "$HOLD_DIR") in $HELD_RESTORE_SECS s (scratch proof, restore, files, migrate, fingerprint recorded)"
}
cmd_db_restore_held() {
  local hd; hd=$(held_newest)
  [ -n "$hd" ] || die "there is no held database copy in $PENDING_ROOT"
  [ "${DRY_RUN:-0}" = 1 ] || [ "${YES:-0}" = 1 ] || die "db-restore-held REPLACES the laptop's database with the held copy $(basename "$hd"). Re-run with --yes (or --dry-run to load it into a scratch database only)."
  held_load "$hd"
  [ -n "$(sed -n 's/^restored=//p' "$hd/held.txt")" ] && echo "note: this copy was already loaded at $(sed -n 's/^restored=//p' "$hd/held.txt")"
  SLICE="${SLICE:-db-restore-held}"
  if ! LAPTOP_UP_SOFT=1 laptop_up; then echo "DATABASE RESTORE NOT DONE: $ENGINE_WHY. The held copy is kept ($hd); the laptop's database is unchanged."; return 3; fi
  if [ "${DRY_RUN:-0}" = 1 ]; then
    local rc=0; echo "dry run: loading the held copy into a scratch database (the laptop's database is not touched) ..."
    held_scratch_check || rc=1
    laptop_down
    echo "DRY RUN done: $( [ "$rc" = 0 ] && echo "the held copy loads, counts and fingerprint equal the desktop's" || echo "PROBLEM, see above" ); nothing real changed"; return $rc
  fi
  held_restore
  laptop_down
}
# where_db_goes: "hold" or "restore" for a database copy asked for without --hold / --restore. AWAY from the office the
# copy is only held (owner 2026-11-19 00:19); in the office it is loaded as before. Office = a direct private-LAN path.
where_db_goes() {
  if [ "${HOLD:-0}" = 1 ]; then echo hold; elif [ "${RESTORE:-0}" = 1 ]; then echo restore
  elif [ -n "${ENV_SYNC_LOCATION:-}" ]; then [ "$ENV_SYNC_LOCATION" = office ] && echo restore || echo hold
  elif on_lan > /dev/null 2>&1; then echo restore; else echo hold; fi
}

cmd_db_pull() {
  [ "${YES:-0}" = 1 ] || die "db-pull REPLACES the laptop's database with a fresh backup of the desktop's (the master).\nRe-run with --yes."
  local t0 goes; t0=$(date +%s)
  goes=$(where_db_goes)
  [ "$goes" = restore ] && need_laptop_list
  pull_backup
  if [ "$goes" = restore ]; then
    # the office: loaded as before. Docker is started here if it is off (time-limited, one recovery) and put back after.
    SLICE="${SLICE:-db-pull}"
    if LAPTOP_UP_SOFT=1 laptop_up; then
      pull_copy_prove_restore "${COVERS:-}"
      echo "db-pull took $(( $(date +%s) - t0 )) s (desktop backup $PB_TOOK s)"
      NO_DATA=0; cmd_status > "$TMPD/st" 2>&1; sed -n '/^data/,$p' "$TMPD/st"
      laptop_down; return 0
    fi
    echo "db-pull: $ENGINE_WHY - the copy is HELD instead of loaded (the laptop's database is unchanged)"
  else
    echo "db-pull: away from the office (or --hold) - the copy is HELD, not loaded: no Docker is started"
  fi
  hold_copy "${COVERS:-}"
  echo "db-pull took $(( $(date +%s) - t0 )) s (desktop backup $PB_TOOK s); result: held (not loaded)"
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
  # The laptop's backup sits in its own envsync/backups/<stamp>/ folder (backup_local.sh), which the desktop does not
  # have yet: make it there first, or scp has nowhere to write (SYNC-D4, 2026-11-18: the first db-push after CKP-2).
  dps "New-Item -ItemType Directory -Force -Path '$D_BENCH/sites/$(dirname "$lprefix")' | Out-Null" > /dev/null
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
  mkdir -p "$RUN_RECORDS"; run="$RUN_RECORDS/$(date +%F_%H%M)_env_sync_db-push.md"
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
  mkdir -p "$RUN_RECORDS"
  list=$(dps "Get-ChildItem -LiteralPath '$D_REPORTS' | Where-Object { \$_.Extension -ne '.lnk' } | ForEach-Object { if (\$_.PSIsContainer) { \$t = Get-ChildItem -LiteralPath \$_.FullName -Recurse -File | Sort-Object LastWriteTimeUtc | Select-Object -Last 1 -ExpandProperty LastWriteTimeUtc; if (-not \$t) { \$t = \$_.LastWriteTimeUtc }; 'D|' + \$_.Name + '|' + ([DateTimeOffset]\$t).ToUnixTimeSeconds() } else { 'F|' + \$_.Name + '|' + ([DateTimeOffset]\$_.LastWriteTimeUtc).ToUnixTimeSeconds() + '|' + \$_.Length } }")
  while IFS='|' read -r kind name epoch size; do
    [ -n "$name" ] || continue
    lp="$L_REPORTS/$name"
    if [ "$kind" = F ]; then
      lp="$RUN_RECORDS/$name"                        # a loose file never lands in the laptop Desktop's root (CKP-3 P6)
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
  echo "reports: $copied item(s) copied from the desktop (folders to $L_REPORTS/<same name>, loose files to $RUN_RECORDS)"
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
  echo "  environment         $(this_env)"
  echo "  laptop containers   $(laptop_list | grep . || echo "NOT SET - a command that needs the laptop's containers refuses; set ENV_SYNC_LAPTOP_CONTAINERS in .claude/state/env.local")"
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
# ckfail: a checkpoint failure NEVER stops or blocks the slice (owner 2026-11-17 19:11, F1 / F2). It is logged ONCE - in
# checkpoints/<slice>/failures.log and as ONE entry in the slice's relay to_chat.md - with the last good checkpoint and its
# age; during B3 a session waiting at its safe point is released at once ("CHECKPOINT FAILED ... carry on"); B1 / B2 / B4 are
# simply tried again at the next mark. Nothing is retried in a loop.
ckfail() {
  local msg good relay
  msg="CHECKPOINT FAILED ($SLICE, $(date '+%F %T')): $(printf '%b' "$*" | head -3 | tr '\n' ' ')"
  good=$(ls -1d "$(ckpt_dir)"/[0-9]*_[0-9]* 2>/dev/null | sort | tail -1)
  [ -n "$good" ] && good="last good checkpoint $(basename "$good") ($(sed -n 's/^kind=//p' "$good/ckpt.txt" 2>/dev/null)), $(( ($(date +%s) - $(stat -c %Y "$good")) / 60 )) min old" || good="no earlier checkpoint"
  echo "$msg" >&2; echo "  $good; the slice is not affected; next try at the next mark" >&2
  mkdir -p "$(ckpt_dir)" 2>/dev/null && echo "$msg | $good" >> "$(ckpt_dir)/failures.log"
  relay="$RELAY_ROOT/$SLICE/to_chat.md"
  [ -f "$relay" ] && printf '\n=== %s | %s | UPDATE | id %s-CKPFAIL ===\n- %s\n- %s; the slice carries on (a checkpoint failure never blocks it); next try at the next mark.\n' "$(date '+%F %H:%M')" "$SLICE" "$SLICE" "$msg" "$good" >> "$relay"
  [ "${CK_RELEASE_ON_FAIL:-0}" = 1 ] && tell_session "CHECKPOINT FAILED $(date '+%F %H:%M') | $good | carry on" && echo "  the waiting session was released (CHECKPOINT FAILED ... carry on)" >&2
  if [ "${CK_RELEASE_ON_FAIL:-0}" = 1 ]; then local also; for also in ${ALSO_TELL:-}; do NAME="$also" tell_session "CHECKPOINT FAILED $(date '+%F %H:%M') | $good | carry on"; done; fi
  laptop_down >&2; exit 3
}
# test_fail <point>: forces a failure at a named point for the rehearsals (ENV_SYNC_TEST_FAIL=b1|b3-capture|b3-copy|b3-silent).
# b3-silent stands for the laptop dying mid-checkpoint: it exits WITHOUT releasing the session, so the session's own ceiling
# must bring it back (F2).
test_fail() {
  [ "${ENV_SYNC_TEST_FAIL:-}" = "$1" ] || return 0
  if [ "$1" = b3-silent ]; then echo "TEST: laptop silent at $1 (exit without telling the session)" >&2; laptop_down >&2; exit 5; fi
  ckfail "TEST failure forced at $1 (ENV_SYNC_TEST_FAIL)"
}

# ---- the Docker engine on the laptop (CKP-5; DOCK-R0 2026-11-19) ---------------------------------------------------
# On standby the laptop's Docker Desktop is off. Whatever needs the laptop's containers (a restore, a takeover, the office
# db-pull) starts it here, by these rules:
#   - never with less than MIN_FREE_MB of memory free, and never within WAKE_DELAY seconds of a wake (F3: WSL answered
#     "Catastrophic failure" 46 s after a resume from hibernate) - the remaining seconds are waited out;
#   - a start that does not answer within ENGINE_WAIT seconds is HUNG (a good start answers in 3-16 s): Docker Desktop is
#     stopped (time-limited; force-closed if its own stop hangs too), WSL is shut down (`wsl --shutdown`, the owner's
#     2026-11-19 allowance for exactly this) and ONE more start is tried;
#   - never a second Docker Desktop on top of a hung one (F4's double start), and after a failed start nothing is left
#     running: both docker distros must read Stopped.
ENGINE_STARTED=0; ENGINE_WHY=""
dkt() { timeout "$DK_T" "$DOCKER_BIN" "$@"; }
engine_ok() { dkt info > /dev/null 2>&1; }
free_mb_now() { echo "${ENV_SYNC_FREE_MB:-$(powershell.exe -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)" 2>/dev/null | tr -d '\r')}"; }
# wake_age: seconds since the laptop last woke (resume from sleep / hibernate, or leaving Modern Standby); "" if unknown.
wake_age() {
  if [ -n "${ENV_SYNC_WAKE_AGE+x}" ]; then echo "$ENV_SYNC_WAKE_AGE"; return; fi
  powershell.exe -NoProfile -Command "\$e = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Power-Troubleshooter'; Id=1} -MaxEvents 1 -ErrorAction SilentlyContinue) + @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Kernel-Power'; Id=107,507} -MaxEvents 1 -ErrorAction SilentlyContinue) | Sort-Object TimeCreated | Select-Object -Last 1; if (\$e) { [int]((Get-Date) - \$e.TimeCreated).TotalSeconds }" 2>/dev/null | tr -d '\r'
}
engine_force_close() {
  if [ -n "${ENV_SYNC_ENGINE_KILL:-}" ]; then "$ENV_SYNC_ENGINE_KILL"; return; fi
  powershell.exe -NoProfile -Command "Get-Process | Where-Object { \$_.Name -match '^(Docker Desktop|com\.docker\..*|docker-desktop.*)\$' } | Stop-Process -Force -ErrorAction SilentlyContinue" > /dev/null 2>&1
}
engine_stop() {
  if timeout "${ENV_SYNC_ENGINE_STOP_T:-60}" "$DOCKER_BIN" desktop stop > /dev/null 2>&1; then echo "laptop: Docker Desktop stopped"
  else echo "laptop: Docker Desktop did not stop by itself in ${ENV_SYNC_ENGINE_STOP_T:-60} s - its processes are force-closed"; engine_force_close; fi
}
wsl_docker_running() { timeout 20 "$WSL_BIN" -l -v 2>/dev/null | tr -d '\0\r' | grep -E 'docker-desktop.*Running' > /dev/null; }
wsl_reset() {
  echo "laptop: wsl --shutdown (stops WSL's machines; on this laptop only Docker's two exist)"
  timeout 60 "$WSL_BIN" --shutdown > /dev/null 2>&1; sleep "${ENV_SYNC_WSL_PAUSE:-5}"
  if wsl_docker_running; then echo "laptop: WARNING a docker distro still reads Running after wsl --shutdown"; else echo "laptop: both docker distros read Stopped"; fi
}
engine_ensure() {
  local fm age try t0
  ENGINE_STARTED=0; ENGINE_WHY=""
  engine_ok && return 0
  fm=$(free_mb_now)
  if [[ "$fm" =~ ^[0-9]+$ ]] && [ "$fm" -lt "$MIN_FREE_MB" ]; then ENGINE_WHY="the laptop has only $fm MB of memory free (under $MIN_FREE_MB), so Docker is not started; close some programs and try again"; return 1; fi
  age=$(wake_age)
  if [[ "$age" =~ ^[0-9]+$ ]] && [ "$age" -lt "$WAKE_DELAY" ]; then
    echo "laptop: woke $age s ago - no Docker start within $WAKE_DELAY s of a wake; waiting $(( WAKE_DELAY - age )) s"
    sleep $(( WAKE_DELAY - age ))
  fi
  for try in 1 2; do
    echo "laptop: Docker Desktop is off - starting it (try $try of 2, at most $ENGINE_WAIT s)"
    t0=$(date +%s)
    if [ -n "${ENV_SYNC_ENGINE_START:-}" ]; then "$ENV_SYNC_ENGINE_START"; else timeout "$ENGINE_WAIT" "$DOCKER_BIN" desktop start > /dev/null 2>&1; fi
    while ! engine_ok; do [ $(( $(date +%s) - t0 )) -ge "$ENGINE_WAIT" ] && break; sleep "$ENGINE_STEP"; done
    if engine_ok; then ENGINE_STARTED=1; echo "laptop: the Docker engine answers after $(( $(date +%s) - t0 )) s"; sleep "$ENGINE_SETTLE"; return 0; fi
    echo "laptop: the Docker engine did not answer within $ENGINE_WAIT s (try $try of 2) - HUNG START"
    engine_stop
    if [ "$try" = 1 ]; then wsl_reset; fi
  done
  if wsl_docker_running; then timeout 60 "$WSL_BIN" --shutdown > /dev/null 2>&1; fi
  ENGINE_WHY="Docker on the laptop did not start (2 tries of $ENGINE_WAIT s, WSL shut down in between); nothing was left running ($(wsl_docker_running && echo "WARNING: a docker distro still reads Running" || echo "both docker distros read Stopped"))"
  return 1
}
engine_down() {
  [ "${ENGINE_STARTED:-0}" = 1 ] || return 0
  ENGINE_STARTED=0; engine_stop; echo "laptop: Docker Desktop is off again (it was off before)"
}

# laptop_up / laptop_down: the laptop's containers only for a database copy (owner 2026-10-26 / CKP-1 Q3), through the
# laptop's turn file (shared with the dev2 lane): claim it first, free it after. Refuses while another lane holds it.
# The turn file's tag is the environment the command was called for, and it never overwrites the other lane's line.
# With LAPTOP_UP_SOFT=1 a Docker that will not start returns 1 (ENGINE_WHY says why) instead of ending the command.
# this_env: the environment THIS command is for (--env when given, else this checkout's own).
this_env() { echo "${CK_ENV:-$ENV_NAME}"; }
# laptop_list: the laptop containers this command may start; "" when none is configured for its environment (a list set for
# the other environment is never used).
laptop_list() { if [ "$(this_env)" = "$ENV_NAME" ]; then echo "$LAPTOP_CONTAINERS"; fi; }
need_laptop_list() {
  [ -n "$(laptop_list)" ] && return 0
  local why="no laptop containers are configured for $(this_env): nothing was started (main's containers are never started for it). Set ENV_SYNC_LAPTOP_CONTAINERS in the .claude/state/env.local of the laptop's $(this_env) checkout and run the command from there"
  if [ "${CK_RELEASE_ON_FAIL:-0}" = 1 ]; then ckfail "$why"; fi
  die "$why"
}
laptop_up() {
  local t c e; need_laptop_list; e=$(this_env); t=$(head -1 "$TURN_FILE" 2>/dev/null)
  case "$t" in free*|"$e "*) ;; "") die "the laptop turn file $TURN_FILE is missing; ask the owner";; *) die "the laptop turn file says '$t'; wait until it is free";; esac
  case "$t" in "$e "*) LAPTOP_TURN_OURS=0;; *) echo "$e $SLICE $(date '+%F %T')" > "$TURN_FILE"; LAPTOP_TURN_OURS=1;; esac
  LAPTOP_STARTED=""
  if ! engine_ensure; then
    [ "${LAPTOP_TURN_OURS:-0}" = 1 ] && { echo "free $(date '+%F %T')" > "$TURN_FILE"; LAPTOP_TURN_OURS=0; }
    [ "${LAPTOP_UP_SOFT:-0}" = 1 ] && return 1
    if [ "${CK_RELEASE_ON_FAIL:-0}" = 1 ]; then ckfail "$ENGINE_WHY"; fi
    die "$ENGINE_WHY"
  fi
  for c in $(laptop_list); do
    [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || { docker start "$c" > /dev/null || die "cannot start $c"; LAPTOP_STARTED+="$c "; }
  done
  [ -n "$LAPTOP_STARTED" ] && { echo "laptop: started $LAPTOP_STARTED"; sleep 5; }
  return 0
}
laptop_down() {
  [ -n "${LAPTOP_STARTED:-}" ] && { docker stop $LAPTOP_STARTED > /dev/null; echo "laptop: stopped $LAPTOP_STARTED"; LAPTOP_STARTED=""; }
  engine_down
  [ "${LAPTOP_TURN_OURS:-0}" = 1 ] && { echo "free $(date '+%F %T')" > "$TURN_FILE"; echo "laptop: turn file free"; LAPTOP_TURN_OURS=0; }
  return 0
}

# unit_sdir: the desktop sessions folder of the unit this command is about. Main dev's units (any worktree) use main's bench,
# exactly as before; a dev2 unit (--env dev2) uses the dev2 bench its checkout belongs to - never main's, where a main session
# of the same name may keep its own files (BCS-T1).
unit_sdir() {
  if [ "${CK_ENV:-main}" != dev2 ]; then echo "$SDIR"; return; fi
  case "${CK_CHECKOUT:-}" in
    */apps/nirmaan_stack) echo "${CK_CHECKOUT%/apps/nirmaan_stack}/$STAGE/sessions";;
    *) echo "${DEV2_D_CHECKOUT%/apps/nirmaan_stack}/$STAGE/sessions";;      # another dev2 worktree: detect_units.ps1 uses the root's bench too
  esac
}

# resume_note <file> <kind>: the RESUME NOTE beside a code checkpoint - where the slice stands and what is open, read from
# the desktop session's own files (status file, newest line first; the resume note it keeps) and the laptop's relay file.
# Read-only on the desktop.
resume_note() {
  local f="$1" kind="$2" st="" rs="" relay last sd; sd=$(unit_sdir)
  if [ -n "${NAME:-}" ]; then
    st=$(dps "if (Test-Path -LiteralPath '$sd/$NAME.status.md') { Get-Content -LiteralPath '$sd/$NAME.status.md' -TotalCount 40 }")
    rs=$(dps "if (Test-Path -LiteralPath '$sd/$NAME.resume.md') { Get-Content -LiteralPath '$sd/$NAME.resume.md' }")
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

# dev2_held_tips: commits the laptop's dev2 checkout holds (HEAD first, then its newest branch and remote-tracking tips),
# joined by ":"; "" without a dev2 checkout. ckpt_code.sh bundles from the nearest one it shares when HEAD is no usable base.
dev2_held_tips() {
  { git -C "$DEV2_L_REPO" rev-parse HEAD; git -C "$DEV2_L_REPO" for-each-ref --sort=-committerdate --format='%(objectname)' refs/heads refs/remotes; } 2>/dev/null |
    grep -E '^[0-9a-f]{40}$' | awk '!seen[$0]++' | head -60 | paste -sd: -
}

# make_code_ckpt <kind> [<commit>]: build a code checkpoint on the desktop host, copy it to the laptop's slice folder, check
# every file's sha256 on both sides, add the resume note and ckpt.txt. Sets CK_DIR, CK_TREE, CK_SIZE, CK_OUT, D_HEAD, D_BRANCH.
make_code_ckpt() {
  local kind="$1" commit="${2:-}" stamp hdir ldir lsum dsum repo base held=""
  # CKP-4: a UNIT is any checkout / worktree of main dev or dev2 (--checkout, --env); without --checkout it is main dev's
  # own checkout, exactly as before. The bundle's base is what the laptop already has of that environment.
  repo="${CK_CHECKOUT:-$D_BENCH/apps/nirmaan_stack}"
  stamp=$(date +%Y%m%d_%H%M%S)
  [ "$kind" = B1 ] && test_fail b1
  hdir="$D_BENCH/$STAGE/ckpt_out/$SLICE/$stamp"; ldir="$(ckpt_dir)/$stamp"
  L_HEAD=$(lgit rev-parse HEAD); base="$L_HEAD"
  if [ "${CK_ENV:-main}" = dev2 ]; then base=$(git -C "$DEV2_L_REPO" rev-parse HEAD 2>/dev/null); base="${base:-none}"; held="--held=$(dev2_held_tips)"; fi
  CK_OUT=$(hrun ckpt_code.sh "$repo" "$hdir" "$base" "$commit" $held)
  [ -n "$(kv ckpt "$CK_OUT")" ] || ckfail "the desktop could not make the code checkpoint:\n$CK_OUT"
  CK_TREE=$(kv tree "$CK_OUT"); D_HEAD=$(kv head "$CK_OUT"); D_BRANCH=$(kv branch "$CK_OUT")
  [ -n "${CK_CHECKOUT:-}" ] || [ "$D_BRANCH" = "$(lgit rev-parse --abbrev-ref HEAD)" ] || ckfail "the desktop is on $D_BRANCH, the laptop on $(lgit rev-parse --abbrev-ref HEAD)"
  mkdir -p "$(ckpt_dir)" || ckfail "cannot create $(ckpt_dir)"
  "$SCP" -q -r "${SSHO[@]}" "$DESKTOP:$hdir" "$(ckpt_dir)/" || ckfail "copying the checkpoint to the laptop failed"
  dsum=$(dps "Get-ChildItem -LiteralPath '$hdir' -File | ForEach-Object { (Get-FileHash -Algorithm SHA256 -LiteralPath \$_.FullName).Hash.ToLower() + ' ' + \$_.Name }" | sort)
  lsum=$( (cd "$ldir" && sha256sum -- *) | sed 's/ \*/ /; s/  */ /' | sort)
  [ -n "$dsum" ] && [ "$dsum" = "$lsum" ] || ckfail "the laptop copy differs from the desktop's:\ndesktop:\n$dsum\nlaptop:\n$lsum"
  resume_note "$ldir/resume.md" "$kind"
  CK_SIZE=$(du -sb "$ldir" | cut -f1); CK_DIR="$ldir"
  { echo "kind=$kind"; echo "slice=$SLICE"; echo "session=${NAME:-}"; echo "made=$(date '+%F %T')"
    echo "desktop_head=$D_HEAD"; echo "laptop_head=$L_HEAD"; echo "tree=$CK_TREE"; echo "size=$CK_SIZE"
    echo "env=${CK_ENV:-main}"; echo "checkout=$repo"; echo "branch=$D_BRANCH"; } > "$ldir/ckpt.txt"
  if [ -n "${CK_CHECKOUT:-}" ]; then { echo "env=${CK_ENV:-main}"; echo "checkout=$repo"; echo "branch=$D_BRANCH"; } > "$(ckpt_dir)/unit.txt"; fi
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
  case "$(kv commits "$CK_OUT")" in "NOT carried: "*) echo "  commits $(kv commits "$CK_OUT")";; esac      # a dev2 unit only
  # the desktop's commits come across as after every commit (fast-forward only, no restart: nothing is served from
  # here). Only when the desktop is ahead - its git_state check in the container is the slow part.
  local ff=1
  if [ -n "${CK_CHECKOUT:-}" ]; then
    [ "${CK_ENV:-main}" = main ] && [ "$D_BRANCH" = "$(lgit rev-parse --abbrev-ref HEAD)" ] && [ "${CK_CHECKOUT,,}" = "$(tr '[:upper:]' '[:lower:]' <<< "$D_BENCH/apps/nirmaan_stack")" ] || ff=0
  fi
  if [ "$ff" = 1 ] && [ "$D_HEAD" != "$L_HEAD" ] && [ "$(kv base_is_ancestor "$CK_OUT")" = 1 ]; then
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
  local sd; sd=$(unit_sdir)
  printf '\n=== %s ===\n' "$1" > "$TMPD/msg"
  "$SCP" -q "${SSHO[@]}" "$TMPD/msg" "$DESKTOP:$sd/$NAME.msg_append.tmp" &&
    dps "Get-Content -LiteralPath '$sd/$NAME.msg_append.tmp' | Add-Content -LiteralPath '$sd/$NAME.message.md'; Remove-Item -LiteralPath '$sd/$NAME.msg_append.tmp'" > /dev/null
}

cmd_checkpoint() {
  need_slice
  # CKP-5: the "leaving" checkpoint HOLDS the database copy (no Docker, nothing loaded) unless --restore asks for the old
  # behaviour, which replaces the laptop's database and so needs --yes.
  local hold=1; [ "${RESTORE:-0}" = 1 ] && hold=0
  [ "$hold" = 1 ] || [ "${YES:-0}" = 1 ] || die "checkpoint --restore REPLACES the laptop's database with a proved copy of the desktop's. Re-run with --yes."
  local t0 t_code stamp out br commit parent tree lfp gottree
  t0=$(date +%s); stamp=$(date +%Y%m%d-%H%M)
  CK_RELEASE_ON_FAIL=1          # until CHECKPOINT TAKEN, a failure releases the waiting session at once (F2)
  test_fail b3-silent; test_fail b3-capture
  echo "desktop: checkpoint commit on a local branch (temporary index; the session's tree is not touched) ..."
  out=$(hrun ckpt_branch.sh "$D_BENCH/apps/nirmaan_stack" "$SLICE" "$stamp")
  br=$(kv branch "$out"); commit=$(kv commit "$out"); parent=$(kv parent "$out"); tree=$(kv tree "$out")
  [ -n "$commit" ] || ckfail "the checkpoint commit failed:\n$out"
  echo "  $br = ${commit:0:9} (parent ${parent:0:9}, tree ${tree:0:12})"
  [ "$hold" = 1 ] || laptop_up
  pull_backup
  [ "$hold" = 1 ] && HOLD_DFP=$(fp_of desktop)     # the desktop's fingerprint while the session is still at its safe point
  t_code=$(( $(date +%s) - t0 ))
  tell_session "CHECKPOINT TAKEN $(date '+%F %H:%M') | $br ${commit:0:9} + database backup $(basename "$PB_PREFIX") | carry on"
  # CKP-4: every OTHER session that paused for this "leaving" is released at the same moment (--also-tell "n1 n2"), not when
  # the laptop has finished its restore minutes later (AC3, 2026-11-18: two sessions waited out their ceiling).
  local also; for also in ${ALSO_TELL:-}; do NAME="$also" tell_session "CHECKPOINT TAKEN $(date '+%F %H:%M') | $br ${commit:0:9} + database backup $(basename "$PB_PREFIX") | carry on"; done
  echo "desktop: the code and the database are captured ($t_code s); the session may carry on"
  CK_RELEASE_ON_FAIL=0
  test_fail b3-copy
  make_code_ckpt B3 "$commit"
  { echo "ckpt_branch=$br"; echo "ckpt_commit=$commit"; echo "backup=$PB_PREFIX"; } >> "$CK_DIR/ckpt.txt"
  if [ "$hold" = 1 ]; then
    hold_copy "CHECKPOINT $SLICE $stamp ($br ${commit:0:9})"
    { echo "held=$HOLD_DIR"; printf '%s\n' "$HOLD_DFP" | sed 's/^/fingerprint=/'; } >> "$CK_DIR/ckpt.txt"
    git -C "$REPO" fetch -q "$CK_DIR/commits.bundle" "+refs/heads/$br:refs/ckpt/$br" 2>/dev/null || ckfail "the checkpoint bundle does not fetch on the laptop"
    gottree=$(git -C "$REPO" rev-parse "refs/ckpt/$br^{tree}")
    { [ "$gottree" = "$tree" ] && [ "$CK_TREE" = "$tree" ]; } || ckfail "code hash mismatch: desktop $tree, bundle $gottree, checkpoint $CK_TREE"
    grep -q "^# RESUME NOTE - $SLICE" "$CK_DIR/resume.md" || ckfail "the resume note is not readable"
    echo "CHECKPOINT READY $SLICE $(date '+%F %H:%M'): code $br ${commit:0:9} (tree ${tree:0:12} = bundle = checkpoint), database $(basename "$PB_PREFIX") HELD on the laptop (not loaded: every file's sha256 equals the desktop's; Docker not started; it is loaded only on a takeover), resume note $CK_DIR/resume.md; took $(( $(date +%s) - t0 )) s (desktop captured in $t_code s)"
    return 0
  fi
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
  # the record's first line carries the copy's moment, whether a db-pull or a db-push wrote it (after a db-push the old
  # pattern read nothing, and every old DBCOPY-POINT then looked newer than the copy - found in CKP-3)
  last=$(sed -n '1s/.*(\([0-9]\{4\}-[0-9-]* [0-9:]*\),.*/\1/p' "$PULL_RECORD" 2>/dev/null | head -1)
  echo "CAUGHT-UP $SLICE $(date '+%F %H:%M'): code = the checkpoint above; data = the last db-pull ${last:-never} ($(sed -n 's/^# covers: //p' "$PULL_RECORD" 2>/dev/null | head -1))"
  if [ -n "$last" ]; then echo "  the laptop's data is $(( ($(date +%s) - $(date -d "$last" +%s)) / 60 )) min behind that copy's moment (the desktop may have written since)"; fi
  # B4 data: a DBCOPY-POINT (paid run, catalogue load, migrate) newer than the last copy -> bring the data up to date too
  local lastpt pt_epoch rec_epoch
  lastpt=$([ -n "${NAME:-}" ] && dps "if (Test-Path -LiteralPath '$SDIR/$NAME.status.md') { Get-Content -LiteralPath '$SDIR/$NAME.status.md' | Select-String -Pattern '^DBCOPY-POINT' | Select-Object -First 1 | ForEach-Object { \$_.Line } }")
  if [ -n "$lastpt" ]; then
    pt_epoch=$(date -d "$(awk '{print $2" "$3}' <<< "$lastpt")" +%s 2>/dev/null || echo 0)
    rec_epoch=$( [ -n "$last" ] && date -d "$last" +%s || echo 0)
    local hd hm; hd=$(held_newest); hm=$( [ -n "$hd" ] && sed -n 's/^held=//p' "$hd/held.txt")
    if [ -n "$hm" ] && [ "$(date -d "$hm" +%s 2>/dev/null || echo 0)" -gt "$rec_epoch" ]; then rec_epoch=$(date -d "$hm" +%s); echo "  a newer HELD copy exists (made $hm, not loaded)"; fi
    if [ "$pt_epoch" -gt "$rec_epoch" ]; then
      echo "  the last costly step is newer than the last data copy: $lastpt"
      if [ "${YES:-0}" = 1 ] && [ "$(where_db_goes)" = hold ]; then echo "  copying the data WITHOUT Docker (held, not loaded) ..."; COVERS="catch-up after: $lastpt"; pull_backup; hold_copy "$COVERS"
      elif [ "${YES:-0}" = 1 ]; then echo "  bringing the data up to date (normal copy first, then chunked) ..."; COVERS="catch-up after: $lastpt"; laptop_up; pull_backup; pull_copy_prove_restore "$COVERS"; laptop_down
      else echo "  re-run with --yes to bring the data up to date (it replaces the laptop's database after the proofs)"; fi
    else echo "  data: no costly step after the last copy"; fi
  fi
}

# ---- resume on the laptop (CKP-1, B5) ----------------------------------------------------------------------------
desktop_alive() {   # prints the session's state lines; 0 when the desktop answers over SSH
  local out ps
  ps="\$s='$(unit_sdir)/${NAME:-none}.status.md'; 'ssh=ok'; if (Test-Path -LiteralPath \$s) { 'status=' + (Get-Item -LiteralPath \$s).LastWriteTime.ToString('HH:mm:ss') + ' ' + (Get-Content -LiteralPath \$s -TotalCount 1) }; Get-ChildItem (Join-Path \$env:USERPROFILE '.claude/jobs') -Directory -ErrorAction SilentlyContinue | ForEach-Object { \$j = Get-Content (Join-Path \$_.FullName 'state.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json; if (\$j.name -eq '${NAME:-none}') { 'job=' + \$_.Name + ' ' + \$j.state } }"
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

  # data (CKP-5): a held copy that was never loaded is loaded FIRST - that is what "held" is for. A dry run loads it into
  # a scratch database only and compares counts and fingerprint; nothing real changes.
  local hd held_bad=0; hd=$(held_newest unrestored)
  laptop_up
  if [ -n "$hd" ]; then
    held_load "$hd"; want="$HELD_DFP"
    if [ "$mode" = dry-run ]; then
      local ts; ts=$(date +%s)
      echo "data: a takeover would first load the held copy $(basename "$hd") - rehearsing it on a scratch database ..."
      held_scratch_check || held_bad=1
      echo "data: held copy rehearsal $( [ "$held_bad" = 0 ] && echo PASS || echo FAILED ) in $(( $(date +%s) - ts )) s (the laptop's database is not touched)"
    else
      echo "data: loading the held copy $(basename "$hd") first ..."
      held_restore
    fi
  fi
  fp=$(fp_of laptop)
  if [ -n "$hd" ] && [ "$mode" = dry-run ]; then :
  elif [ "$fp" = "$want" ]; then echo "data: the laptop holds the checkpoint's copy (fingerprint equal)"
  elif [ "$mode" = dry-run ]; then echo "data: DIFFERENT from the checkpoint's copy - a takeover would stop and ask for $(sed -n 's/^backup=//p' "$b3/ckpt.txt") to be restored first"
  else
    laptop_down
    die "the laptop's data is not the checkpoint's. Restore $(sed -n 's/^backup=//p' "$b3/ckpt.txt") first (the runbook's restore, with a proved backup of the laptop's current data), then re-run"
  fi

  # code: rebuild every checkpoint in order on the checkout (or, for a dry run, on a throw-away clone)
  if [ "$mode" = dry-run ]; then
    target="$TMPD/clone"; git clone -q --shared --branch "$(lgit rev-parse --abbrev-ref HEAD)" "$REPO" "$target" || die "cannot make the dry-run clone"
    # the rehearsal starts from the laptop as it was when the B3 checkpoint was taken (the owner leaving), not from any
    # commit made on the laptop since (a real takeover refuses a checkout that is ahead of the checkpoint)
    local lh; lh=$(sed -n 's/^laptop_head=//p' "$b3/ckpt.txt")
    if [ -n "$lh" ] && git -C "$target" cat-file -e "$lh^{commit}" 2>/dev/null; then git -C "$target" reset -q --hard "$lh"; echo "dry run: the clone starts at the laptop's head when B3 was taken (${lh:0:9})"; fi
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
  if [ -n "$hd" ] && [ "$mode" = dry-run ]; then echo "code: $target = $(basename "$prev") (tree $(sed -n 's/^tree=//p' "$prev/head.txt" | cut -c1-12)); data: held copy $(basename "$hd") $( [ "$held_bad" = 0 ] && echo "loads, counts and fingerprint equal the desktop's" || echo "FAILED its rehearsal")"
  else echo "code: $target = $(basename "$prev") (tree $(sed -n 's/^tree=//p' "$prev/head.txt" | cut -c1-12)); data fingerprint $( [ "$(fp_of laptop)" = "$want" ] && echo equal || echo DIFFERENT)"; fi
  if [ "$mode" = dry-run ]; then
    laptop_down
    echo "DRY RUN done: the checkout, the database and the master are unchanged; the desktop stays the master"; return $held_bad
  fi
  KEEP_LAPTOP_UP=1      # the laptop is the master now: its Docker and containers stay up
  echo "laptop $SLICE $(date '+%F %T') (resume-on-laptop from $(basename "$prev"))" > "$MASTER_REC"
  LAPTOP_TURN_OURS=0; echo "main $SLICE MASTER $(date '+%F %T')" > "$TURN_FILE"
  echo "RESUMED-ON-LAPTOP $SLICE $(date '+%F %H:%M'): the laptop is the master; continue from $prev/resume.md:"
  sed -n '1,12p' "$prev/resume.md" | sed 's/^/  /'
}

# resume-on-laptop --slice <dev2 unit> --code-only [--dry-run | --yes] (BCS-T1 P5d): the newest CODE copy of a dev2 unit onto
# the laptop's dev2 checkout. CODE ONLY: no database, no container, no turn file, no master record (dev2 = code copies only,
# owner 2026-11-21). --dry-run rebuilds it on a throw-away clone of that checkout; --yes does it, on the owner's word, and
# refuses while the desktop answers, on another branch, or over uncommitted tracked changes (nothing changed in each case).
cmd_resume_code() {
  need_slice
  local dir u env branch s newest="" target rc cur dirty up=0 clash
  dir=$(ckpt_dir); u="$dir/unit.txt"
  [ -f "$u" ] || die "no unit $SLICE in $CKPT_ROOT (resume-on-laptop --units lists them)"
  env=$(sed -n 's/^env=//p' "$u")
  [ "$env" = dev2 ] || die "--code-only is for a dev2 unit; $SLICE is a $env unit (its takeover is resume-on-laptop --slice $SLICE --takeover --yes)"
  for s in $(ls -1d "$dir"/[0-9]*_[0-9]* 2>/dev/null | sort); do if [ -f "$s/head.txt" ]; then newest="$s"; fi; done
  [ -n "$newest" ] || die "unit $SLICE has no code copy yet"
  branch=$(sed -n 's/^branch=//p' "$newest/head.txt")
  echo "unit $SLICE (dev2, $branch): newest code copy $(basename "$newest"), head $(sed -n 's/^head=//p' "$newest/head.txt" | cut -c1-9), tree $(sed -n 's/^tree=//p' "$newest/head.txt" | cut -c1-12), made $(sed -n 's/^made=//p' "$newest/head.txt"); commits: $(sed -n 's/^commits=//p' "$newest/head.txt" | grep . || echo "bundle $(sed -n 's/^bundle=//p' "$newest/head.txt")")"
  git -C "$DEV2_L_REPO" rev-parse --git-dir > /dev/null 2>&1 || die "the laptop has no dev2 checkout ($DEV2_L_REPO)"
  cur=$(git -C "$DEV2_L_REPO" rev-parse --abbrev-ref HEAD); dirty=$(git -C "$DEV2_L_REPO" status --porcelain --untracked-files=no)
  echo "the laptop's dev2 checkout: $cur @ $(git -C "$DEV2_L_REPO" rev-parse --short=9 HEAD), uncommitted tracked changes: $(grep -c . <<< "$dirty")"
  [ "$cur" = "$branch" ] || die "refusing: the laptop's dev2 checkout is on $cur, the copy is of $branch; nothing changed"
  [ -z "$dirty" ] || die "refusing: the laptop's dev2 checkout has uncommitted tracked changes; nothing changed"
  if desktop_alive > /dev/null; then up=1; echo "DESKTOP UP: it answers over SSH"; else echo "DESKTOP DOWN: no SSH answer in 30 s"; fi
  if [ "${DRY_RUN:-0}" = 1 ]; then
    target="$TMPD/clone_code"; git clone -q --shared --branch "$cur" "$DEV2_L_REPO" "$target" || die "cannot make the dry-run clone"
    clash=$(tar --force-local -tf "$newest/untracked.tar" | while IFS= read -r s; do case "$s" in */) ;; *) if [ -e "$DEV2_L_REPO/$s" ]; then echo "$s"; fi;; esac; done)
    bash "$HERE/remote/ckpt_apply.sh" apply "$target" "$newest" > "$TMPD/apply.out" 2>&1; rc=$?
    sed 's/^/  /' "$TMPD/apply.out"
    [ -z "$clash" ] || { echo "  CONFLICT: these new files of the copy already exist in the real checkout:"; head -10 <<< "$clash" | sed 's/^/    /'; rc=1; }
    if [ "$rc" = 0 ]; then echo "DRY RUN OK: rebuilt on a throw-away clone, tree equals the copy's; nothing was applied, no data, no container"
    else echo "DRY RUN FAILED (see above); nothing was applied, no data, no container"; fi
    return $rc
  fi
  if [ "${YES:-0}" != 1 ]; then echo "nothing done: add --dry-run to rehearse, or --yes on the owner's word (code only)"; return 0; fi
  [ "$up" = 0 ] || die "refusing: the desktop answers, so work continues there (owner 2026-11-17 14:13); nothing changed"
  bash "$HERE/remote/ckpt_apply.sh" apply "$DEV2_L_REPO" "$newest" > "$TMPD/apply.out" 2>&1; rc=$?
  sed 's/^/  /' "$TMPD/apply.out"
  [ "$rc" = 0 ] || die "STOPPED (see above): the laptop's dev2 checkout is left as the lines above say; no data, no container"
  echo "RESUMED-ON-LAPTOP (CODE ONLY) $SLICE $(date '+%F %H:%M'): the laptop's dev2 checkout holds $(basename "$newest"); NO dev2 data was loaded, no container was started, the master record and the turn file are untouched. Continue from $newest/resume.md:"
  sed -n '1,12p' "$newest/resume.md" | sed 's/^/  /'
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

# ---- CKP-4: units (any Stack dev work on the desktop), the shared "leaving" flag, a takeover of several units ------
# units: read-only. One line per unit (every existing worktree of main dev's and dev2's checkout) with the Claude Code
# sessions working there, plus each session's newest DBCOPY-POINT and how many dev2 containers run (desktop/detect_units.ps1).
cmd_units() {
  dps "powershell -NoProfile -ExecutionPolicy Bypass -File '$D_BENCH/$STAGE/desktop/detect_units.ps1' -Envs 'main=$D_BENCH/apps/nirmaan_stack;dev2=$DEV2_D_CHECKOUT'" | sed '1s/^\xEF\xBB\xBF//'
}
# tell --name N --text "<one line>": append `=== <text> ===` to that desktop session's message file (never overwrites). The
# copier uses it on "leaving" (CHECKPOINT ... / CHECKPOINT TAKEN ... carry on / CHECKPOINT FAILED ... carry on).
cmd_tell() {
  check_name "${NAME:-}"; [ -n "${TEXT:-}" ] || die "tell needs --text"
  tell_session "$TEXT" && echo "told $NAME: $TEXT"
}
LEAVING_FLAG="${ENV_SYNC_LEAVING_FLAG:-$RUN_RECORDS/ckp_leaving.flag}"
cmd_leaving() {
  mkdir -p "$RUN_RECORDS"
  if [ -f "$LEAVING_FLAG" ]; then echo "leaving: the flag is already up ($(head -1 "$LEAVING_FLAG"))"; return 0; fi
  echo "LEAVING $(date '+%F %T') raised by ${LEAVING_BY:-env_sync.sh leaving}" > "$LEAVING_FLAG"
  echo "leaving: flag raised ($LEAVING_FLAG); the copier checkpoints every detected unit at its next run and writes READY"
}
# resume-on-laptop --units: every unit's last checkpoint; --dry-run rebuilds each one on a throw-away clone (nothing real
# changes) and compares the laptop's data fingerprint with its last proved copy. A REAL takeover of the unit that is main
# dev's own checkout is the existing `resume-on-laptop --slice <unit> --takeover --yes`, on the owner's word only.
cmd_resume_units() {
  local u dir id env branch newest target src start head base ok=0 bad=0 fp
  for u in "$CKPT_ROOT"/*/unit.txt; do
    [ -f "$u" ] || continue
    dir=$(dirname "$u"); id=$(basename "$dir")
    [ -n "${SLICE:-}" ] && [ "$SLICE" != "$id" ] && continue
    env=$(sed -n 's/^env=//p' "$u"); branch=$(sed -n 's/^branch=//p' "$u")
    newest=$(ls -1d "$dir"/[0-9]*_[0-9]* 2>/dev/null | sort | tail -1)
    [ -n "$newest" ] || { echo "unit $id ($env, $branch): no checkpoint yet"; continue; }
    echo "unit $id ($env, $branch): last checkpoint $(basename "$newest") $(sed -n 's/^kind=//p' "$newest/ckpt.txt"), tree $(sed -n 's/^tree=//p' "$newest/head.txt" | cut -c1-12), $(( ($(date +%s) - $(stat -c %Y "$newest")) / 60 )) min old"
    [ "${DRY_RUN:-0}" = 1 ] || continue
    src="$REPO"; [ "$env" = dev2 ] && src="$DEV2_L_REPO"
    if ! git -C "$src" rev-parse --git-dir > /dev/null 2>&1; then echo "  DRY RUN SKIPPED: the laptop has no checkout of $env ($src)"; bad=$((bad + 1)); continue; fi
    target="$TMPD/clone_$id"; git clone -q --shared "$src" "$target" || { echo "  DRY RUN FAILED: cannot clone $src"; bad=$((bad + 1)); continue; }
    head=$(sed -n 's/^head=//p' "$newest/head.txt"); base=$(sed -n 's/^base=//p' "$newest/head.txt")
    [ -f "$newest/commits.bundle" ] && git -C "$target" fetch -q "$newest/commits.bundle" "+refs/heads/*:refs/ckpt-incoming/*" 2>/dev/null
    start=""
    for c in "$head" "$base"; do if [ -n "$c" ] && git -C "$target" cat-file -e "$c^{commit}" 2>/dev/null; then start="$c"; break; fi; done
    if [ -z "$start" ]; then echo "  DRY RUN FAILED: neither the checkpoint's base nor its head is on the laptop (no bundle)"; bad=$((bad + 1)); continue; fi
    git -C "$target" checkout -q -B "$branch" "$start" || { echo "  DRY RUN FAILED: cannot put the clone on $branch"; bad=$((bad + 1)); continue; }
    if bash "$HERE/remote/ckpt_apply.sh" apply "$target" "$newest" > "$TMPD/apply_$id.out" 2>&1 && grep -q '^applied: tree equals' "$TMPD/apply_$id.out"; then
      echo "  DRY RUN OK: rebuilt on a throw-away clone, tree equals the checkpoint's ($(sed -n 's/^tree=//p' "$TMPD/apply_$id.out" | cut -c1-12))"; ok=$((ok + 1))
    else echo "  DRY RUN FAILED:"; sed 's/^/    /' "$TMPD/apply_$id.out" | head -5; bad=$((bad + 1)); fi
  done
  [ "${DRY_RUN:-0}" = 1 ] || { echo "nothing done: add --dry-run to rehearse; a real takeover needs the owner's word (resume-on-laptop --slice <unit> --takeover --yes)"; return 0; }
  if [ "${SKIP_DATA:-0}" != 1 ]; then
    SLICE="${SLICE:-units}"; laptop_up; fp=$(fp_of laptop); laptop_down
    if [ "$fp" = "$(grep '^fp_' "$PULL_RECORD" 2>/dev/null)" ]; then echo "data: the laptop's fingerprint equals its last proved copy ($(sed -n '1s/.*(\([0-9]\{4\}-[0-9-]* [0-9:]*\),.*/\1/p' "$PULL_RECORD"))"
    else echo "data: the laptop's fingerprint DIFFERS from its last proved copy - a takeover would stop and ask for a restore first"; bad=$((bad + 1)); fi
  fi
  echo "DRY RUN done: $ok unit(s) rebuilt, $bad problem(s); the checkouts, the database and the master are unchanged"
  [ "$bad" = 0 ]
}

# ---- the checkpoint poller as a scheduled task (CKP-3) ------------------------------------------------------------
# The task runs poller_run.sh (through laptop/poller_hidden.vbs, no window). Which slice it copies for is DECLARED here on
# the laptop (poll/active.txt, written by `poller follow` when a slice is launched) and CHECKED at every run against the
# desktop session's own status file, read-only: a status of DONE / FAILED ends the following by itself.
POLL_ST="${POLLER_STATE:-$BENCH_HOST/$STAGE/poll}"
POLLER_PS1="$HERE/laptop/poller_task.ps1"
poller_ps() { powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$POLLER_PS1")" "$@" 2>&1 | tr -d '\r'; }
cmd_poller() {
  mkdir -p "$POLL_ST"
  case "${POLLER_SUB:-status}" in
    install) poller_ps -Action install;;
    remove) poller_ps -Action remove;;
    follow)
      need_slice; check_name "${NAME:-}"
      echo "$SLICE $NAME since $(date '+%F %T')" > "$POLL_ST/active.txt"; rm -f "$POLL_ST/offline"
      echo "poller: main dev's unit is named $SLICE while session $NAME works (OPTIONAL since CKP-4: the copier detects every session by itself); the name is dropped by itself when that session stops working";;
    unfollow) if [ -f "$POLL_ST/active.txt" ]; then mv -f "$POLL_ST/active.txt" "$POLL_ST/last_active.txt"; fi; echo "poller: no slice name set; the copier still detects and copies every working session by itself";;
    pause) date '+%F %T' > "$POLL_ST/paused"; echo "poller: paused (runs write a PAUSED heartbeat and copy nothing); undo: env_sync.sh poller resume";;
    resume) rm -f "$POLL_ST/paused"; echo "poller: resumed";;
    shortcuts) powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$HERE/laptop/copier_shortcuts.ps1")" -Action create 2>&1 | tr -d '\r';;
    shortcuts-remove) powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$HERE/laptop/copier_shortcuts.ps1")" -Action remove 2>&1 | tr -d '\r';;
    run) bash "$HERE/poller_run.sh"; echo "poller: one run done"; sed 's/^/  /' "$RUN_RECORDS/ckp_heartbeat.txt" 2>/dev/null;;
    status)
      poller_ps -Action status | sed 's/^/  /'
      echo "  slice name (optional follow)=$(cat "$POLL_ST/active.txt" 2>/dev/null || echo none - units are detected)"
      echo "  leaving flag=$([ -f "$LEAVING_FLAG" ] && head -1 "$LEAVING_FLAG" || echo not raised)"
      echo "  paused=$([ -f "$POLL_ST/paused" ] && echo "yes, since $(cat "$POLL_ST/paused")" || echo no)"
      echo "  heartbeat=$RUN_RECORDS/ckp_heartbeat.txt"
      sed 's/^/    /' "$RUN_RECORDS/ckp_heartbeat.txt" 2>/dev/null || echo "    (no heartbeat yet)"
      echo "  log=$BENCH_HOST/$STAGE/checkpoints/poller.log";;
    *) die "poller takes: install | status | follow --slice S --name N | unfollow | pause | resume | run | remove | shortcuts | shortcuts-remove";;
  esac
}

# The dispatch is one block that ends in exit: bash reads a script as it runs it, and from-desktop can fast-forward
# this very file, so nothing after the block may be read from the new copy.
{
CMD="${1:-}"; [ $# -gt 0 ] && shift
if [ "$CMD" = poller ]; then POLLER_SUB="${1:-status}"; [ $# -gt 0 ] && shift; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1;; --allow-dirty) ALLOW_DIRTY=1;; --no-restart) NO_RESTART=1;; --no-data) NO_DATA=1;;
    --discard-desktop-writes) DISCARD=1;;
    --slice) SLICE="${2:-}"; shift;; --if-older) IF_OLDER="${2:-}"; shift;; --covers) COVERS="${2:-}"; shift;;
    --takeover) TAKEOVER=1;; --dry-run) DRY_RUN=1;; --chunked) FORCE_CHUNKED=1;; --hold) HOLD=1;; --restore) RESTORE=1;;
    --text) TEXT="${2:-}"; shift;; --also-tell) ALSO_TELL="${2:-}"; shift;;
    --checkout) CK_CHECKOUT="${2:-}"; shift;; --env) CK_ENV="${2:-}"; shift;; --units) UNITS=1;; --no-data-check) SKIP_DATA=1;; --code-only) CODE_ONLY=1;;
    --logs) LOGS="${2:-}"; shift;; --lines) LINES_N="${2:-40}"; shift;;
    --name) NAME="${2:-}"; shift;; --brief) BRIEF="${2:-}"; shift;; --message) MESSAGE="${2:-}"; shift;;
    --interval) INTERVAL="${2:-60}"; shift;; --idle-limit) IDLE_LIMIT="${2:-5}"; shift;; --pull-back) PULL_BACK=1;;
    *) die "unknown flag $1";;
  esac
  shift
done
case "$CMD" in status|to-desktop|from-desktop|db-pull|db-push|watch|session-*|checkpoint-code|checkpoint|units) ensure_stage;; esac   # once, outside any $(...)
[ "$CMD" = resume-on-laptop ] && STAGE_LAPTOP_ONLY=1   # catch-up stages lazily too: it must first say whether the desktop answers   # once, outside any $(...)
case "$CMD" in
  status) cmd_status;; to-desktop) cmd_to_desktop;; from-desktop) cmd_from_desktop;;
  db-pull) cmd_db_pull;; db-restore-held) cmd_db_restore_held;; db-push) cmd_db_push;; reports) cmd_reports;; watch) cmd_watch;; print) cmd_print;;
  checkpoint-code) cmd_checkpoint_code;; checkpoint) cmd_checkpoint;; catch-up) cmd_catch_up;;
  resume-on-laptop) if [ "${UNITS:-0}" = 1 ]; then cmd_resume_units; elif [ "${CODE_ONLY:-0}" = 1 ]; then cmd_resume_code; else cmd_resume_on_laptop; fi;;
  units) cmd_units;; leaving) cmd_leaving;; tell) cmd_tell;;
  session-start) cmd_session_start;; session-send) cmd_session_send;;
  session-wait) cmd_session_wait;; session-stop) cmd_session_stop;;
  poller) cmd_poller;;
  *) sed -n '2,/^set -uo pipefail/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 1;;
esac
exit
}
