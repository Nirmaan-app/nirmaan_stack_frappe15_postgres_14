#!/usr/bin/env bash
# poller_run.sh -- ONE run of the laptop's checkpoint poller (CKP-3, 2026-11-18). Started by the Windows scheduled task
# "BoQ Checkpoint Poller" (every 15 minutes, at log-on, on network connect, on resume from sleep), so it does NOT depend on
# Claude Code being open: Claude Code's memory reaper stopped slice_poll.sh on 2026-11-17 and no checkpoint was taken
# after it. `env_sync.sh poller run` runs it once by hand.
#
# Each run:
#   paused (env_sync.sh poller pause)       -> heartbeat PAUSED, nothing else
#   no slice followed (poller follow)       -> heartbeat IDLE, nothing copied, the desktop is not even asked
#   the desktop does not answer             -> heartbeat OFFLINE (logged once), no failure entry, B1 skipped
#   it answers again after OFFLINE          -> the B4 catch-up by itself, CAUGHT-UP in the log + one relay entry
#   otherwise                               -> B1 `checkpoint-code --if-older` (a no-op until it is due), then B2 when the
#                                              session's newest DBCOPY-POINT is newer than the laptop's last database copy
#   the session's status says DONE / FAILED -> one last B1, then the slice is no longer followed (IDLE from the next run)
# B2 follows the laptop-standby rule (MEM-R0 F3): Docker Desktop and the four main containers are started only for the
# copy and put back as they were. Never dev2.
# A failure never stops the slice (CKP-2 F1): it is written once to the heartbeat and the log (env_sync's ckfail adds the
# one <slice>-CKPFAIL relay entry), and the next run simply tries again at its next mark. No retry loop here.
#
# Heartbeat (overwritten each run, text only): <laptop Desktop>\BoQ main lane\_run_records\ckp_heartbeat.txt
# Log (appended, 30 days kept):                frappe-bench\envsync\checkpoints\poller.log
# State (laptop local disk):                   frappe-bench\envsync\poll\  (active.txt, paused, offline, last_b1.txt, lock)
# Rehearsals only: frappe-bench\envsync\poll\poller_test.env may set ENV_SYNC_DESKTOP (an alias that does not answer) or
# ENV_SYNC_TEST_FAIL=b1 for the runs while it exists. The POLLER_* variables are for scripts/env_sync/tests only.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BENCH_HOST="$(cd "$REPO/../.." && pwd)"
[ -f "$REPO/.claude/state/env.local" ] && . "$REPO/.claude/state/env.local"
ST="${POLLER_STATE:-$BENCH_HOST/envsync/poll}"; mkdir -p "$ST"
if [ -f "$ST/poller_test.env" ]; then set -a; . "$ST/poller_test.env"; set +a; fi

L_REPORTS="${ENV_SYNC_LAPTOP_REPORTS:-$(cygpath -u "$USERPROFILE")/OneDrive/Desktop}"
RUN_RECORDS="${ENV_SYNC_RUN_RECORDS:-$L_REPORTS/BoQ main lane/_run_records}"
RELAY_ROOT="${ENV_SYNC_RELAY_ROOT:-$L_REPORTS/BoQ main lane/_relay}"
HB="${POLLER_HEARTBEAT:-$RUN_RECORDS/ckp_heartbeat.txt}"
LOG="${POLLER_LOG:-$BENCH_HOST/envsync/checkpoints/poller.log}"
ENVSYNC="${POLLER_ENV_SYNC:-$HERE/env_sync.sh}"
SSH="${POLLER_SSH:-/c/Windows/System32/OpenSSH/ssh.exe}"
DOCKER="${POLLER_DOCKER:-docker}"
DOCKER_DESKTOP_EXE="${POLLER_DOCKER_DESKTOP_EXE:-/c/Program Files/Docker/Docker/Docker Desktop.exe}"
DESKTOP="${ENV_SYNC_DESKTOP:-desktop}"
D_BENCH="${ENV_SYNC_DESKTOP_BENCH:-C:/Users/USER/Documents/frappe_docker/development/frappe-bench}"
PULL_RECORD="${ENV_SYNC_PULL_RECORD:-$BENCH_HOST/envsync/last_pull_fingerprint.txt}"
TURN_FILE="${ENV_SYNC_TURN_FILE:-$(cygpath -u "$USERPROFILE")/envsync_laptop_turn.txt}"
LAPTOP_CONTAINERS="${ENV_SYNC_LAPTOP_CONTAINERS:-frappe_docker_devcontainer-postgresql-1 frappe_docker_devcontainer-redis-cache-1 frappe_docker_devcontainer-redis-queue-1 frappe_docker_devcontainer-frappe-1}"
B1_EVERY="${POLLER_B1_MINUTES:-13}"      # under the task's 15 minutes, so every scheduled run that finds work takes a B1
LOCK_STALE_MIN="${POLLER_LOCK_STALE_MIN:-180}"
B2_RETRY_MIN="${POLLER_B2_RETRY_MIN:-60}"          # a failed database copy is tried again for the same point after this long
B2_MIN_FREE_MB="${POLLER_B2_MIN_FREE_MB:-3000}"    # no database copy is started with less free memory than this on the laptop
mkdir -p "$(dirname "$HB")" "$(dirname "$LOG")"

now() { date '+%F %T'; }
say() { echo "$(now) $*" >> "$LOG"; }
one_line() { tr '\n' ' ' | sed 's/  */ /g' | cut -c1-"${1:-300}"; }
# The moment of the laptop's last database copy: the time in the pull record's first line (a db-pull or a db-push wrote it).
last_b2() { sed -n '1s/.*(\([0-9]\{4\}-[0-9-]* [0-9:]*\),.*/\1/p' "$PULL_RECORD" 2>/dev/null; }
# heartbeat <result> <active slice> <desktop reachable y/n/not asked>
heartbeat() {
  { echo "BoQ Checkpoint Poller - heartbeat (overwritten at every run; text only)"
    echo "run:               $(now)"
    echo "result:            $1"
    echo "active slice:      ${2:-none}"
    echo "desktop reachable: ${3:-not asked}"
    echo "last good B1:      $(cat "$ST/last_b1.txt" 2>/dev/null || echo none recorded)"
    echo "last good B2:      $(last_b2 | grep . || echo none recorded) (the laptop's last proved database copy)"
    echo "off switch:        bash scripts/env_sync/env_sync.sh poller pause | resume | remove"
  } > "$HB"
}
finish() { say "$1"; heartbeat "$1" "${2:-}" "${3:-}"; exit 0; }

# One instance at a time (the task also ignores a new start while one runs).
if ! mkdir "$ST/lock" 2>/dev/null; then
  age=$(( ($(date +%s) - $(stat -c %Y "$ST/lock" 2>/dev/null || date +%s)) / 60 ))
  if [ "$age" -ge "$LOCK_STALE_MIN" ]; then rmdir "$ST/lock" 2>/dev/null; mkdir "$ST/lock" 2>/dev/null || exit 0; say "a lock $age min old was removed"
  else say "SKIP another run holds the lock ($age min)"; exit 0; fi
fi
trap 'rmdir "$ST/lock" 2>/dev/null' EXIT
# keep 30 days of log
if [ -f "$LOG" ]; then cut_off=$(date -d '30 days ago' +%F); awk -v c="$cut_off" '$1 >= c' "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"; fi

[ -f "$ST/paused" ] && finish "PAUSED (since $(cat "$ST/paused"); env_sync.sh poller resume)"
read -r SLICE NAME _ < "$ST/active.txt" 2>/dev/null || true
if [ -z "${SLICE:-}" ] || [ -z "${NAME:-}" ]; then finish "IDLE (no slice followed)"; fi
ACTIVE="$SLICE (session $NAME)"
# EVERY run writes the heartbeat, and writes it FIRST: a stale heartbeat must only ever mean "the job did not run" (the
# laptop asleep or off, the user logged off, the task removed). A long step (a database copy takes 10-15 minutes) shows as
# RUNNING with its start time until the run's result replaces it. (CKP-3 AC3, 2026-11-18: a run that started at 16:09 showed
# nothing until 16:18.)
RUN_START=$(now)
heartbeat "RUNNING since $RUN_START - asking the desktop" "$ACTIVE" "not asked yet"

# One plain read over SSH (never `claude` over SSH): does the desktop answer, the status file's first line, its newest DBCOPY-POINT.
PS="\$s='$D_BENCH/envsync/sessions/$NAME.status.md'; 'ssh=ok'; if (Test-Path -LiteralPath \$s) { 'F=' + (Get-Content -LiteralPath \$s -TotalCount 1); 'P=' + (Get-Content -LiteralPath \$s | Select-String -Pattern '^DBCOPY-POINT' | Select-Object -First 1 | ForEach-Object { \$_.Line }) }"
OUT=$(timeout 40 "$SSH" -o BatchMode=yes -o ConnectTimeout=15 "$DESKTOP" "$PS" 2>/dev/null | tr -d '\r')
if ! grep -q '^ssh=ok' <<< "$OUT"; then
  if [ ! -f "$ST/offline" ]; then now > "$ST/offline"; say "OFFLINE the desktop does not answer ($DESKTOP); B1 is skipped, the catch-up runs by itself when it answers again"; fi
  heartbeat "OFFLINE (the desktop does not answer since $(cat "$ST/offline"))" "$ACTIVE" n
  exit 0
fi
FIRST=$(sed -n 's/^F=//p' <<< "$OUT" | head -1)
POINT=$(sed -n 's/^P=//p' <<< "$OUT" | head -1)
FINAL=0; case "$FIRST" in DONE*|FAILED*) FINAL=1;; esac

b1_good() { echo "$(now) $SLICE $(sed -n 's/^CHECKPOINT CODE [^:]*: //p' <<< "$1" | head -1 | sed 's#.*/##')" > "$ST/last_b1.txt"; }

RESULT=""
if [ -f "$ST/offline" ]; then
  since=$(cat "$ST/offline"); rm -f "$ST/offline"
  out=$(bash "$ENVSYNC" catch-up --slice "$SLICE" --name "$NAME" 2>&1); rc=$?
  if grep -q '^CAUGHT-UP' <<< "$out"; then
    grep -q '^CHECKPOINT CODE' <<< "$out" && b1_good "$out"
    RESULT="CAUGHT-UP (the desktop answers again; offline since $since)"
    relay="$RELAY_ROOT/$SLICE/to_chat.md"
    [ -f "$relay" ] && printf '\n=== %s | %s | UPDATE | id %s-CAUGHTUP ===\n- The checkpoint poller (scheduled job) could not reach the desktop since %s. It answers again: %s\n' "$(date '+%F %H:%M')" "$SLICE" "$SLICE" "$since" "$(grep '^CAUGHT-UP' <<< "$out" | head -1)" >> "$relay"
  else
    RESULT="FAILED catch-up after OFFLINE (rc $rc): $(one_line 200 <<< "$out")"
  fi
else
  if [ "$FINAL" = 1 ]; then ck=$(bash "$ENVSYNC" checkpoint-code --slice "$SLICE" --name "$NAME" 2>&1); rc=$?
  else ck=$(bash "$ENVSYNC" checkpoint-code --slice "$SLICE" --name "$NAME" --if-older "$B1_EVERY" 2>&1); rc=$?; fi
  case "$ck" in
    *"checkpoint not due"*) RESULT="B1 SKIP not due";;
    *"CHECKPOINT CODE"*) b1_good "$ck"; RESULT="B1 OK";;
    *) RESULT="FAILED B1 (rc $rc): $(one_line 200 <<< "$ck")";;
  esac
fi

# B2: a costly step (DBCOPY-POINT <date> <time> <step>) newer than the laptop's last database copy -> a proved copy now.
if [ -n "$POINT" ]; then
  pt_epoch=$(date -d "$(awk '{print $2" "$3}' <<< "$POINT")" +%s 2>/dev/null || echo 0)
  rec=$(last_b2); rec_epoch=$( [ -n "$rec" ] && date -d "$rec" +%s 2>/dev/null || echo 0)
  # No tight retry (CKP-3 P5; found in AC5, 2026-11-18: a failed B2 was tried again at every 15-minute run, a desktop backup
  # each time): after a failure the SAME point is tried again only after B2_RETRY_MIN. And a copy is not started while the
  # laptop is short of memory - both AC5 failures were the laptop's Docker falling over with ~2 GB free.
  B2_WAIT=""
  if [ "$pt_epoch" -gt "$rec_epoch" ]; then
    if [ -f "$ST/b2_failed.txt" ] && [ "$(sed -n 1p "$ST/b2_failed.txt")" = "$POINT" ]; then
      fail_age=$(( ($(date +%s) - $(stat -c %Y "$ST/b2_failed.txt")) / 60 ))
      [ "$fail_age" -lt "$B2_RETRY_MIN" ] && B2_WAIT="B2 PENDING (the copy failed $fail_age min ago; next try after $B2_RETRY_MIN min)"
    fi
    if [ -z "$B2_WAIT" ]; then
      free_mb="${POLLER_FREE_MB:-$(powershell.exe -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)" 2>/dev/null | tr -d '\r')}"
      if [ -n "$free_mb" ] && [ "$free_mb" -lt "$B2_MIN_FREE_MB" ] 2>/dev/null; then B2_WAIT="B2 PENDING (the laptop has only $free_mb MB of memory free, under $B2_MIN_FREE_MB; tried again at the next run)"; fi
    fi
    [ -n "$B2_WAIT" ] && RESULT="$RESULT + $B2_WAIT"
  fi
  if [ "$pt_epoch" -gt "$rec_epoch" ] && [ -z "$B2_WAIT" ]; then
    say "B2 due: $POINT (the last copy: ${rec:-none})"
    heartbeat "RUNNING since $RUN_START - $RESULT; B2 database copy started $(now) (10-15 minutes; this line is replaced by the result)" "$ACTIVE" y
    turn_before=$(head -1 "$TURN_FILE" 2>/dev/null)
    engine_was=up; "$DOCKER" info > /dev/null 2>&1 || engine_was=down
    if [ "$engine_was" = down ]; then
      say "B2: Docker Desktop is off (laptop standby) - starting it for the copy"
      if [ -n "${POLLER_ENGINE_START:-}" ]; then "$POLLER_ENGINE_START"          # tests: a stub, never the real Docker Desktop
      else
        # Docker's own CLI first (it waits until the engine runs); the program itself if that is not there or fails.
        timeout 240 "$DOCKER" desktop start > /dev/null 2>&1 ||
          cmd.exe //c start "" "$(cygpath -w "$DOCKER_DESKTOP_EXE" 2>/dev/null || echo "$DOCKER_DESKTOP_EXE")" > /dev/null 2>&1
      fi
      for _ in $(seq 1 "${POLLER_ENGINE_WAIT:-60}"); do "$DOCKER" info > /dev/null 2>&1 && break; sleep 5; done
      # A Docker Desktop that has only just answered still drops large requests (AC5, 2026-11-18: a 277 MB docker cp
      # got "502 Bad Gateway" 3 minutes after the start): let it settle before the copy.
      "$DOCKER" info > /dev/null 2>&1 && sleep "${POLLER_ENGINE_SETTLE:-45}"
    fi
    running_before=""
    for c in $LAPTOP_CONTAINERS; do [ "$("$DOCKER" inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] && running_before+=" $c"; done
    if "$DOCKER" info > /dev/null 2>&1; then
      find "$BENCH_HOST/sites/localhost/locks" -name '*.lock' -size 0 -delete 2>/dev/null   # a lock left by an earlier pull fails the migrate
      out=$(bash "$ENVSYNC" catch-up --slice "$SLICE" --name "$NAME" --yes 2>&1); rc=$?
      printf '%s
' "$(now) B2 for $SLICE (rc $rc)" "$out" > "$ST/b2_last_output.txt"     # the whole output of the last B2, for a failure
      rec2=$(last_b2); rec2_epoch=$( [ -n "$rec2" ] && date -d "$rec2" +%s 2>/dev/null || echo 0)
      if [ "$rec2_epoch" -ge "$pt_epoch" ]; then RESULT="$RESULT + B2 OK (covers: $(one_line 80 <<< "$POINT"))"; rm -f "$ST/b2_failed.txt"
      else RESULT="$RESULT + FAILED B2 (rc $rc): $(tail -3 <<< "$out" | one_line 200)"; echo "$POINT" > "$ST/b2_failed.txt"; fi
    else
      RESULT="$RESULT + FAILED B2: Docker did not start on the laptop"; echo "$POINT" > "$ST/b2_failed.txt"
    fi
    # Put the laptop back as it was: stop the main containers that were not running, free a turn-file claim a failed
    # copy left behind, and quit Docker Desktop if it was off. Never dev2.
    for c in $LAPTOP_CONTAINERS; do
      case " $running_before " in *" $c "*) ;; *) [ "$("$DOCKER" inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] && "$DOCKER" stop "$c" > /dev/null 2>&1;; esac
    done
    case "$turn_before" in free*) case "$(head -1 "$TURN_FILE" 2>/dev/null)" in "main $SLICE "*) echo "free $(now)" > "$TURN_FILE";; esac;; esac
    if [ "$engine_was" = down ]; then timeout 120 "$DOCKER" desktop stop > /dev/null 2>&1; say "B2: Docker Desktop stopped again (it was off before)"; fi
  fi
fi

if [ "$FINAL" = 1 ]; then
  mv -f "$ST/active.txt" "$ST/last_active.txt" 2>/dev/null
  RESULT="$RESULT; the session's status is '$(one_line 40 <<< "$FIRST")' - $SLICE is no longer followed (IDLE from the next run)"
fi
finish "$RESULT" "$ACTIVE" y
