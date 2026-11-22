#!/usr/bin/env bash
# poller_run.sh -- ONE run of the laptop's checkpoint copier (CKP-3 2026-11-18; CKP-4 the same day: any Stack dev work,
# several at once). Started by the Windows scheduled task "BoQ Checkpoint Poller" (every 15 minutes, at log-on, on network
# connect, on resume from sleep), so it does NOT depend on Claude Code being open. `env_sync.sh poller run` = one run by hand.
#
# Each run:
#   paused (poller pause / the Desktop shortcut)  -> heartbeat PAUSED, nothing else
#   the desktop does not answer                   -> heartbeat OFFLINE (logged once), nothing copied, no failure entry
#   otherwise DETECT (env_sync.sh units, read-only): every worktree of main dev's and dev2's checkout on the desktop is a
#     UNIT; the Claude Code sessions working in it are found from their processes and Claude's own job files, whichever chat
#     or project started them. No `poller follow` is needed (it still works: it only names main dev's unit after a slice).
#   per unit with a working session               -> B1 code copy `checkpoint-code --if-older` (two sessions in one checkout
#                                                    share the copy; any branch; local-only commits travel in a bundle)
#   per unit whose tree changed and nobody works  -> one more B1, so the last state is on the laptop
#   back after OFFLINE                            -> every such unit is copied at once (CAUGHT-UP, one relay entry)
#   OFFICE (a direct private-LAN path)            -> code only: no database copy, the laptop's Docker is never started
#   AWAY                                          -> also B2 for MAIN DEV when a session's newest DBCOPY-POINT is newer than
#                                                    the last copy (memory guard, one retry an hour, Docker standby)
#   dev2                                          -> code copies only. Its containers are NEVER started; if they run on the
#                                                    desktop and dev2 has work, ONE question goes to the relay, no copy.
#                                                    Commits that could not travel are said in its unit line
#   the shared LEAVING flag (chat-Claude, `env_sync.sh leaving`, the Desktop shortcut "Leaving")
#                                                 -> every detected unit is checkpointed NOW, office or away: sessions that
#                                                    honour CHECKPOINT (a status file from our brief footer) are asked to
#                                                    pause at their safe point (main dev's and dev2's, each in its own
#                                                    sessions folder), any other is copied as it stands; ONE
#                                                    database copy for main dev; READY / FAILED per unit in the heartbeat
#                                                    and ONE relay entry; the flag is cleared
# A failure never stops any session (CKP-2 F1): it is written once per unit to the heartbeat, the log and the relay, the
# other units are still copied, and the next run tries again at its next mark. No retry loop here.
#
# Heartbeat (rewritten FIRST at every run, text only): <laptop Desktop>\BoQ main lane\_run_records\ckp_heartbeat.txt
# Log (appended, 30 days kept):                         frappe-bench\envsync\checkpoints\poller.log
# State (laptop local disk):                            frappe-bench\envsync\poll\  (units\, paused, offline, lock, ...)
# Rehearsals only: frappe-bench\envsync\poll\poller_test.env may set ENV_SYNC_DESKTOP (an alias that does not answer),
# ENV_SYNC_TEST_FAIL=b1, POLLER_B1_MINUTES, POLLER_LOCATION, POLLER_FAIL_UNIT or POLLER_LEAVING_SKIP for the runs while it
# exists (POLLER_LEAVING_ONLY names the only sessions a rehearsal may pause). The other POLLER_* variables are for
# scripts/env_sync/tests only.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BENCH_HOST="$(cd "$REPO/../.." && pwd)"
[ -f "$REPO/.claude/state/env.local" ] && . "$REPO/.claude/state/env.local"
ST="${POLLER_STATE:-$BENCH_HOST/envsync/poll}"; mkdir -p "$ST/units"
if [ -f "$ST/poller_test.env" ]; then set -a; . "$ST/poller_test.env"; set +a; fi

L_REPORTS="${ENV_SYNC_LAPTOP_REPORTS:-$(cygpath -u "$USERPROFILE")/OneDrive/Desktop}"
RUN_RECORDS="${ENV_SYNC_RUN_RECORDS:-$L_REPORTS/BoQ main lane/_run_records}"
RELAY_ROOT="${ENV_SYNC_RELAY_ROOT:-$L_REPORTS/BoQ main lane/_relay}"
HB="${POLLER_HEARTBEAT:-$RUN_RECORDS/ckp_heartbeat.txt}"
LOG="${POLLER_LOG:-$BENCH_HOST/envsync/checkpoints/poller.log}"
LEAVING_FLAG="${ENV_SYNC_LEAVING_FLAG:-$RUN_RECORDS/ckp_leaving.flag}"
ENVSYNC="${POLLER_ENV_SYNC:-$HERE/env_sync.sh}"
D_BENCH="${ENV_SYNC_DESKTOP_BENCH:-C:/Users/USER/Documents/frappe_docker/development/frappe-bench}"
MAIN_ROOT="$(tr '[:upper:]' '[:lower:]' <<< "$D_BENCH/apps/nirmaan_stack")"
PULL_RECORD="${ENV_SYNC_PULL_RECORD:-$BENCH_HOST/envsync/last_pull_fingerprint.txt}"
# CKP-5: the copier NEVER starts Docker. A database copy is fetched and sha256-checked into this folder on the laptop's own
# disk and HELD there; it is loaded only on a takeover or by `env_sync.sh db-restore-held`.
PENDING_ROOT="${ENV_SYNC_PENDING_ROOT:-$BENCH_HOST/envsync/backups/pending}"
TURN_FILE="${ENV_SYNC_TURN_FILE:-$(cygpath -u "$USERPROFILE")/envsync_laptop_turn.txt}"
LAPTOP_CONTAINERS="${ENV_SYNC_LAPTOP_CONTAINERS:-frappe_docker_devcontainer-postgresql-1 frappe_docker_devcontainer-redis-cache-1 frappe_docker_devcontainer-redis-queue-1 frappe_docker_devcontainer-frappe-1}"
B1_EVERY="${POLLER_B1_MINUTES:-13}"      # under the task's 15 minutes, so every scheduled run that finds work takes a B1
LOCK_STALE_MIN="${POLLER_LOCK_STALE_MIN:-180}"
B2_RETRY_MIN="${POLLER_B2_RETRY_MIN:-60}"          # a failed database copy is tried again for the same point after this long
LEAVING_WAIT="${POLLER_LEAVING_WAIT:-600}"         # seconds the copier waits for the sessions' CHECKPOINT SAFE on "leaving"
# The relay entry for things no single slice owns (a "leaving" result, a failure, CAUGHT-UP, the dev2 question): a fixed
# folder _relay\_checkpoints\ once it exists, CKP-4's folder until then.
OPS_RELAY="${POLLER_OPS_RELAY:-$( [ -d "$RELAY_ROOT/_checkpoints" ] && echo "$RELAY_ROOT/_checkpoints/to_chat.md" || echo "$RELAY_ROOT/CKP-4/to_chat.md" )}"
mkdir -p "$(dirname "$HB")" "$(dirname "$LOG")"

now() { date '+%F %T'; }
# es <seconds> <env_sync arguments...>: every env_sync call goes through here. It gets a time limit (a stalled ssh is given
# up, never left hanging) and its stdin from /dev/null: ssh reads stdin, and inside the per-unit loop it swallowed the rest
# of the unit list, so only the first unit was copied (CKP-4 AC1, 2026-11-18 18:36).
es() { local t="$1"; shift; timeout "$t" bash "$ENVSYNC" "$@" < /dev/null; }
say() { echo "$(now) $*" >> "$LOG"; }
one_line() { tr '\n' ' ' | sed 's/  */ /g' | cut -c1-"${1:-300}"; }
relay() { [ -f "$OPS_RELAY" ] && printf '\n=== %s | CKP | UPDATE | id %s ===\n%s\n' "$(date '+%F %H:%M')" "$1" "$2" >> "$OPS_RELAY"; return 0; }
# The moment of the laptop's last LOADED database copy: the time in the pull record's first line (a db-pull, a db-push or
# a restore of a held copy wrote it).
last_b2() { sed -n '1s/.*(\([0-9]\{4\}-[0-9-]* [0-9:]*\),.*/\1/p' "$PULL_RECORD" 2>/dev/null; }
# The newest HELD copy: "<made> <folder>" and whether it was loaded since.
held_dir() { local d; for d in $(ls -1d "$PENDING_ROOT"/[0-9]*_[0-9]* 2>/dev/null | sort -r); do [ -f "$d/held.txt" ] && { echo "$d"; return; }; done; }
last_held() { local d; d=$(held_dir); [ -n "$d" ] && sed -n 's/^held=//p' "$d/held.txt"; }
held_line() {
  local d r; d=$(held_dir); [ -n "$d" ] || { echo "none"; return; }
  r=$(sed -n 's/^restored=//p' "$d/held.txt")
  echo "$(sed -n 's/^held=//p' "$d/held.txt") ($(basename "$d"); $( [ -n "$r" ] && echo "loaded $r" || echo "held, NOT loaded - it is loaded only on a takeover or by db-restore-held" ))"
}
# The newest database copy of either kind, as a moment (what a costly step is compared with).
newest_db() { { last_b2; last_held; } | sort | tail -1; }
newest_b1() { cat "$ST"/units/*.last 2>/dev/null | sort | tail -1; }
UNIT_LINES=""; DETECTED="not checked"; LOCATION=""
# heartbeat <result> <desktop reachable y/n/not asked>
heartbeat() {
  { echo "BoQ Checkpoint Poller - heartbeat v2 (rewritten at every run; text only)"
    echo "run:               $(now)"
    echo "result:            $1"
    echo "detected:          $DETECTED"
    echo "desktop reachable: ${2:-not asked}"
    echo "location:          ${LOCATION:-not checked} (office = code copies only; away = code + the database file, held)"
    [ -n "$UNIT_LINES" ] && printf '%s' "$UNIT_LINES"
    echo "last good B1:      $(newest_b1 | grep . || echo none recorded)"
    echo "last held db copy: $(held_line)"
    echo "last restored db copy: $(last_b2 | grep . || echo none recorded) (what the laptop's database holds now)"
    echo "off switch:        Desktop shortcuts Copier - Pause / Resume / Status, or env_sync.sh poller pause | resume | remove"
  } > "$HB"
}
finish() { say "$1"; heartbeat "$1" "${2:-}"; exit 0; }
# Where the laptop is (owner 2026-11-18 16:42 "ok option a"): "office" = a DIRECT private-LAN path to the desktop
# (tailscale ping "via 192.168.x.x:port" and the like); the relay, a public address, no answer or no Tailscale = "away".
TAILSCALE="${POLLER_TAILSCALE:-${ENV_SYNC_TAILSCALE:-/c/Program Files/Tailscale/tailscale.exe}}"
DESKTOP_TS="${ENV_SYNC_DESKTOP_TS:-nitesh-desktop}"
where_am_i() {
  local out
  if [ -n "${POLLER_LOCATION:-}" ]; then echo "$POLLER_LOCATION"; return; fi          # rehearsals and tests only
  out=$(timeout 20 "$TAILSCALE" ping -c 1 "$DESKTOP_TS" 2>&1 | tr -d '\r' | tail -1)
  if grep -qE ' via (10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)[0-9.]+:[0-9]+' <<< "$out"; then echo office; else echo away; fi
}
unit_id() { printf 'u-%s-%s' "$1" "$2" | sed 's/[^A-Za-z0-9-]/-/g' | cut -c1-41; }
# One instance at a time (the task also ignores a new start while one runs).
if ! mkdir "$ST/lock" 2>/dev/null; then
  age=$(( ($(date +%s) - $(stat -c %Y "$ST/lock" 2>/dev/null || date +%s)) / 60 ))
  if [ "$age" -ge "$LOCK_STALE_MIN" ]; then rmdir "$ST/lock" 2>/dev/null; mkdir "$ST/lock" 2>/dev/null || exit 0; say "a lock $age min old was removed"
  else say "SKIP another run holds the lock ($age min)"; exit 0; fi
fi
# DEV2_ASKED (BCS-T1): the dev2 sessions sent a CHECKPOINT by a "leaving" run and not yet released, one "name|path" line each.
# The release is unconditional: after its unit's copy - paused, not paused or timed out - and if this run ends in any other way.
# A request that could not be confirmed as written (DEV2_UNSURE) is not waited for, but released all the same at the end.
DEV2_ASKED=""; DEV2_UNSURE=""
asked_of() { local n p; while IFS='|' read -r n p; do if [ "$p" = "$1" ]; then echo "$n"; fi; done <<< "$DEV2_ASKED"; }
tell_dev2() { es 120 tell --name "$1" --text "$3" --checkout "$2" --env dev2 > /dev/null 2>&1; }
# release_dev2 <path or "all"> <TAKEN|FAILED> [<why it failed>]: "CHECKPOINT TAKEN <time> - carry on"
release_dev2() {
  local n p left=""
  while IFS='|' read -r n p; do
    [ -n "$n" ] || continue
    if [ "$1" != all ] && [ "$p" != "$1" ]; then left+="$n|$p"$'\n'; continue; fi
    tell_dev2 "$n" "$p" "CHECKPOINT $2 $(date '+%F %H:%M')$( [ "$2" = TAKEN ] || echo " | $3 |" ) - carry on" || say "LEAVING: the release of $n (dev2) could not be written"
  done <<< "$DEV2_ASKED"
  DEV2_ASKED="$left"
}
# dev2_pending [<path>]: how many asked dev2 sessions (of that unit) are not at their safe point in the units output $UNOW.
dev2_pending() {
  local n p k=0 lines; lines=$(grep '^unit|dev2|' <<< "$UNOW")
  while IFS='|' read -r n p; do
    [ -n "$n" ] || continue; if [ -n "${1:-}" ] && [ "$p" != "$1" ]; then continue; fi
    grep -q "[|,]$n:[0-9a-f]*:[a-z]*:CHECKPOINT" <<< "$lines" || k=$((k + 1))
  done <<< "$DEV2_ASKED"
  echo "$k"
}
on_exit() { DEV2_ASKED+="$DEV2_UNSURE"; if [ -n "$DEV2_ASKED" ]; then release_dev2 all FAILED "the copier ended before this unit was copied"; fi; rmdir "$ST/lock" 2>/dev/null; }
trap on_exit EXIT
if [ -f "$LOG" ]; then cut_off=$(date -d '30 days ago' +%F); awk -v c="$cut_off" '$1 >= c' "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"; fi

[ -f "$ST/paused" ] && finish "PAUSED (since $(cat "$ST/paused"); env_sync.sh poller resume)"
# EVERY run writes the heartbeat, and writes it FIRST: a stale heartbeat only ever means "the job did not run".
RUN_START=$(now)
heartbeat "RUNNING since $RUN_START - asking the desktop which sessions are working" "not asked yet"

# ---- detect -------------------------------------------------------------------------------------------------------
# ONE failed call is not "offline": on 2026-11-18 20:27 a real "leaving" run gave up after a single call that failed in 4 s
# (the desktop was up; most likely its script staging collided with another session's copy) and nothing happened until the
# next 15-minute slot. The call is retried inside the run - 3 tries, or 8 over about 2.5 minutes while the leaving flag is up
# - and the heartbeat says so while it does.
LEAVING=0; [ -f "$LEAVING_FLAG" ] && LEAVING=1
TRIES="${POLLER_DETECT_TRIES:-3}"; [ "$LEAVING" = 1 ] && TRIES="${POLLER_DETECT_TRIES_LEAVING:-8}"
UOUT=""; try=1
while :; do
  UOUT=$(es 180 units 2>/dev/null | tr -d '\r')
  grep -q '^ssh=ok' <<< "$UOUT" && break
  [ "$try" -ge "$TRIES" ] && break
  heartbeat "RUNNING since $RUN_START - $( [ "$LEAVING" = 1 ] && echo "LEAVING: " )the desktop did not answer (try $try of $TRIES) - retrying by itself in ${POLLER_DETECT_SLEEP:-20} s; do not click again" "not yet"
  sleep "${POLLER_DETECT_SLEEP:-20}"; try=$((try + 1))
done
if ! grep -q '^ssh=ok' <<< "$UOUT"; then
  if [ ! -f "$ST/offline" ]; then now > "$ST/offline"; say "OFFLINE the desktop does not answer ($TRIES tries); nothing is copied, everything is caught up by itself when it answers again"; fi
  DETECTED="unknown (the desktop does not answer)"
  if [ "$LEAVING" = 1 ]; then
    heartbeat "OFFLINE - LEAVING NOT DONE: the desktop did not answer in $TRIES tries since $(cat "$ST/offline"). The flag stays up; the copier tries again at every run (at most 15 minutes apart). Nothing was copied yet." n
    [ -f "$ST/leaving_offline_told" ] || { now > "$ST/leaving_offline_told"; relay "LEAVING-WAITING" "- \"Leaving\" was asked ($(head -1 "$LEAVING_FLAG" | one_line 100)) but the desktop did not answer the copier in $TRIES tries. NOTHING is copied yet. The flag stays up and the copier tries again at every run."; }
  else heartbeat "OFFLINE (the desktop does not answer since $(cat "$ST/offline"))" n; fi
  exit 0
fi
rm -f "$ST/leaving_offline_told"
LOCATION=$(where_am_i)
BACK=""; if [ -f "$ST/offline" ]; then BACK=$(cat "$ST/offline"); rm -f "$ST/offline"; fi
FOLLOW_SLICE="" FOLLOW_NAME=""; if [ -f "$ST/active.txt" ]; then read -r FOLLOW_SLICE FOLLOW_NAME _ < "$ST/active.txt" || true; fi

# ---- "leaving": ask the sessions that honour CHECKPOINT to stop at their safe point, and wait for them -------------
PAUSED_NAMES=""; LEAVE_T0=$(date +%s)
if [ "$LEAVING" = 1 ]; then
  say "LEAVING flag found ($(head -1 "$LEAVING_FLAG" | one_line 120)) - every detected unit is checkpointed now"
  heartbeat "RUNNING since $RUN_START - LEAVING: asking the sessions to pause at their safe point" y
  while IFS='|' read -r tag env path branch head key changed sess; do
    [ "$tag" = unit ] || continue; [ "$env" = main ] || [ "$env" = dev2 ] || continue
    for s in ${sess//,/ }; do
      IFS=: read -r sname sid sstate sfirst <<< "$s"
      # a session honours CHECKPOINT when it keeps a status file (our brief footer); a rehearsal may leave named ones alone
      [ "$sstate" = working ] && [ -n "$sfirst" ] && [ "$sname" != console ] || continue
      case " ${POLLER_LEAVING_SKIP:-} " in *" $sname "*) continue;; esac
      # a rehearsal names the ONLY sessions it may pause, so it can never reach a session it did not start
      if [ -n "${POLLER_LEAVING_ONLY:-}" ]; then case " $POLLER_LEAVING_ONLY " in *" $sname "*) ;; *) continue;; esac; fi
      # a dev2 session gets the same message in ITS OWN sessions folder; main's checkpoint, its wait and its release are as before
      if [ "$env" = dev2 ]; then
        if tell_dev2 "$sname" "$path" "CHECKPOINT $(date '+%F %H:%M') | the owner is leaving"; then DEV2_ASKED+="$sname|$path"$'\n'; else DEV2_UNSURE+="$sname|$path"$'\n'; fi
        continue
      fi
      es 120 tell --name "$sname" --text "CHECKPOINT $(date '+%F %H:%M') | the owner is leaving" > /dev/null 2>&1 && PAUSED_NAMES+=" $sname"
    done
  done <<< "$UOUT"
  ASK_T0=$(date +%s)
  if [ -n "$PAUSED_NAMES" ]; then
    waited=0
    while [ "$waited" -lt "$LEAVING_WAIT" ]; do
      pending=0; UNOW=$(es 180 units 2>/dev/null | tr -d '\r')
      for n in $PAUSED_NAMES; do grep '^unit|main|' <<< "$UNOW" | grep -q "[|,]$n:[0-9a-f]*:[a-z]*:CHECKPOINT" || pending=$((pending + 1)); done
      [ "$pending" = 0 ] && break
      sleep "${POLLER_LEAVING_STEP:-20}"; waited=$((waited + ${POLLER_LEAVING_STEP:-20}))
    done
    say "LEAVING: asked$PAUSED_NAMES to pause; $( [ "$pending" = 0 ] && echo "all at their safe point after $waited s" || echo "$pending not at a safe point after $waited s - copied as they stand" )"
    UOUT=$(es 180 units 2>/dev/null | tr -d '\r')
  fi
fi

# ---- per unit: the code copy ----------------------------------------------------------------------------------------
RESULT=""; NDET=0; NFAIL=0; MAIN_ID=""; MAIN_PATH=""; MAIN_NAME=""; LEAVE_LINES=""; DEV2_WORK=0
# On "leaving" a dev2 unit whose asked session is not at its safe point yet is left for after main dev's checkpoint
# (DEFERRED), so main never waits for it; it is then waited for under the same time limit and copied.
DEFERRED=""; UNOW="$UOUT"
copy_units() {   # copy_units first|deferred
while IFS='|' read -r tag env path branch head key changed sess; do
  [ "$tag" = unit ] || continue
  if [ "$1" = deferred ]; then case $'\n'"$DEFERRED" in *$'\n'"$path"$'\n'*) ;; *) continue;; esac; fi
  id=$(unit_id "$env" "$branch"); is_root=0
  [ "$env" = main ] && [ "$(tr '[:upper:]' '[:lower:]' <<< "$path")" = "$MAIN_ROOT" ] && is_root=1
  working=0; names=""; first=""
  for s in ${sess//,/ }; do
    IFS=: read -r sname sid sstate sfirst <<< "$s"
    names+="${names:+, }$sname($sstate)"
    if [ "$sstate" = working ] || [ "$sstate" = active ]; then working=$((working + 1)); [ -z "$first" ] && [ "$sname" != console ] && first="$sname"; fi
  done
  if [ "$is_root" = 1 ] && [ -n "$FOLLOW_SLICE" ]; then     # `poller follow` only names main dev's unit after a slice
    if grep -q "$FOLLOW_NAME:[0-9a-f]*:working" <<< "$sess"; then id="$FOLLOW_SLICE"; first="$FOLLOW_NAME"
    else mv -f "$ST/active.txt" "$ST/last_active.txt" 2>/dev/null; say "$FOLLOW_SLICE ($FOLLOW_NAME) is no longer working - the follow is cleared; detection carries on"; fi
  fi
  [ "$is_root" = 1 ] && { MAIN_ID="$id"; MAIN_PATH="$path"; MAIN_NAME="$first"; }
  lastkey=$(cat "$ST/units/$id.key" 2>/dev/null); mode=""
  if [ "$working" -gt 0 ]; then mode=due; NDET=$((NDET + 1))
  elif [ -n "$lastkey" ] && [ "$key" != "$lastkey" ]; then mode=final          # nobody works there now, but the tree moved since the last copy
  elif [ -z "$lastkey" ]; then echo "$key" > "$ST/units/$id.key"; fi           # first sight of an idle unit: remember it, copy nothing
  [ "$env" = dev2 ] && [ -n "$mode" ] && DEV2_WORK=1
  [ "$LEAVING" = 1 ] && [ "$working" -gt 0 ] && mode=leave
  [ -n "$BACK" ] && [ -n "$mode" ] && mode=final
  asked=""; [ "$env" = dev2 ] && asked=$(asked_of "$path" | tr '\n' ' ' | sed 's/ *$//')
  if [ -n "$asked" ]; then
    mode=leave; DEV2_WORK=1; npend=$(dev2_pending "$path")
    if [ "$1" = first ] && [ "$npend" -gt 0 ] && [ "$LEAVING_WAIT" -gt 0 ]; then
      [ "$working" -gt 0 ] && NDET=$((NDET - 1))      # counted when it is copied
      DEFERRED+="$path"$'\n'; RESULT+="${RESULT:+; }$id: waiting for its safe point"; continue
    fi
    if [ "$npend" = 0 ]; then asked_say="paused at its safe point: $asked"; else asked_say="asked to pause: $asked; $npend not at a safe point after $(( $(date +%s) - ASK_T0 )) s - copied as it stands"; fi
  fi
  [ -n "$mode" ] || continue
  args=(checkpoint-code --slice "$id" --checkout "$path" --env "$env"); [ -n "$first" ] && args+=(--name "$first")
  [ "$mode" = due ] && args+=(--if-older "$B1_EVERY")
  if [ -n "${POLLER_FAIL_UNIT:-}" ] && [ "$POLLER_FAIL_UNIT" = "$id" ]; then ck="CHECKPOINT FAILED ($id): TEST failure forced on this unit (POLLER_FAIL_UNIT)"; rc=3
  else ck=$(es 900 "${args[@]}" 2>&1); rc=$?; fi   # a stalled copy is given up, never left hanging
  case "$ck" in
    *"checkpoint not due"*) r="B1 SKIP not due";;
    *"CHECKPOINT CODE"*) r="B1 OK"; echo "$key" > "$ST/units/$id.key"; rm -f "$ST/units/$id.failed"
        echo "$(now) $id $(sed -n 's/^CHECKPOINT CODE [^:]*: //p' <<< "$ck" | head -1 | sed 's#.*/##')" > "$ST/units/$id.last"
        # dev2 only: the branch's commits could not travel; said in the unit line until a copy carries them
        if grep -q '^  commits NOT carried: ' <<< "$ck"; then sed -n 's/^  commits NOT carried: //p' <<< "$ck" | head -1 > "$ST/units/$id.nocommits"; else rm -f "$ST/units/$id.nocommits"; fi;;
    *) r="FAILED B1 (rc $rc): $(one_line 160 <<< "$ck")"; NFAIL=$((NFAIL + 1))
       if [ ! -f "$ST/units/$id.failed" ]; then now > "$ST/units/$id.failed"; relay "CKPFAIL-$id" "- The checkpoint copier could not copy unit $id ($env, $branch): $(one_line 200 <<< "$ck")
- Last good copy of it: $(cat "$ST/units/$id.last" 2>/dev/null || echo none). No session is stopped or blocked; the other units are still copied; next try at the next run."; fi;;
  esac
  [ "$mode" = final ] && [ "$r" = "B1 OK" ] && r="B1 OK (last state; no session working)"
  if [ "$1" = deferred ]; then w="$id: waiting for its safe point"; RESULT="${RESULT%%"$w"*}$id: $r${RESULT#*"$w"}"; else RESULT+="${RESULT:+; }$id: $r"; fi
  nocommits=$(cat "$ST/units/$id.nocommits" 2>/dev/null | one_line 200)
  [ "$mode" = leave ] && [ "$is_root" != 1 ] && LEAVE_LINES+="- $id ($env, $branch; ${names:-no session}): $( [ "${r%% (*}" = "B1 OK" ] && echo "READY - code copied $( [ -n "$asked" ] && echo "($asked_say)" || echo "as it stands (best effort)" )${nocommits:+; commits NOT carried: $nocommits}" || echo "FAILED - $r${asked:+ ($asked_say)}" )"$'\n'
  UNIT_LINES+="unit:              $id | $env | $branch | sessions: ${names:-none} | last code copy: $(cat "$ST/units/$id.last" 2>/dev/null | cut -d' ' -f1,2,4 || echo none) | this run: $r${asked:+ | leaving: $asked_say}${nocommits:+ | commits NOT carried: $nocommits}"$'\n'
  if [ -n "$asked" ]; then   # the release: after the copy, whatever the session did
    if [ "${r%% (*}" = "B1 OK" ]; then release_dev2 "$path" TAKEN; else release_dev2 "$path" FAILED "the code copy failed"; fi
  fi
done <<< "$UOUT"
}
copy_units first
DETECTED="$NDET unit(s) with a working session"
[ -n "$RESULT" ] || RESULT="IDLE (detected 0: no Claude Code session is working in a Stack checkout on the desktop)"
if [ -n "$BACK" ]; then
  RESULT="CAUGHT-UP (the desktop answers again; offline since $BACK): $RESULT"
  relay "CAUGHTUP" "- The checkpoint copier could not reach the desktop since $BACK. It answers again and every unit with work was copied at once: $RESULT"
fi

# ---- dev2: code only; its database is never copied without the owner's word, its containers are never started --------
DEV2_UP=$(sed -n 's/^dev2_containers=//p' <<< "$UOUT" | head -1)
if [ "${DEV2_UP:-0}" -gt 0 ] 2>/dev/null && [ "$DEV2_WORK" = 1 ]; then
  RESULT="$RESULT; dev2: code copied, its database copy needs the owner's word"
  if [ "$(cat "$ST/dev2_asked.txt" 2>/dev/null)" != "$(date +%F)" ]; then date +%F > "$ST/dev2_asked.txt"
    relay "DEV2-QUESTION" "- QUESTION for the owner: dev2 is running on the desktop ($DEV2_UP containers) and has work in its checkout. The copier copies its CODE only. A dev2 DATABASE copy needs the owner's word (the copier never starts a dev2 container on either machine). Copy the dev2 database too?"; fi
fi

# ---- the database copy for main dev: on "leaving" always; otherwise only AWAY and only after a costly step ------------
POINT=$(sed -n 's/^point|main|//p' <<< "$UOUT" | awk -F'|' '{ print $2 "|" $1 }' | sort | tail -1)   # "<DBCOPY-POINT line>|<session>"
PT_NAME="${POINT##*|}"; POINT="${POINT%|*}"
if [ "$LEAVING" = 1 ] && [ -n "$MAIN_ID" ] && grep -q "^unit|main|" <<< "$UOUT"; then
  heartbeat "RUNNING since $RUN_START - LEAVING: checkpoint of main dev started $(now): code + the database FILE copied to the laptop (no Docker; a few minutes)" y
  lname="${PAUSED_NAMES# }"; lname="${lname%% *}"; lname="${lname:-$MAIN_NAME}"
  # The code of every unit is already on the laptop (the loop above). The database is copied as a FILE and held (CKP-5):
  # no Docker is started, so "leaving" cannot hang on it. If even that copy fails, "leaving" still ends by itself as
  # READY (CODE ONLY) with every paused session released (owner 2026-11-18 20:5x, a real leaving).
  args=(checkpoint --slice "$MAIN_ID" --hold); [ -n "$lname" ] && args+=(--name "$lname")
  # every other paused session is released by the checkpoint itself, the moment the desktop side is captured
  others=""; for n in $PAUSED_NAMES; do [ "$n" = "$lname" ] || others+="${others:+ }$n"; done
  [ -n "$others" ] && args+=(--also-tell "$others")
  out=$(es "${POLLER_LEAVING_DB_LIMIT:-5400}" "${args[@]}" 2>&1); rc=$?
  printf '%s\n' "$(now) leaving checkpoint for $MAIN_ID (rc $rc)" "$out" > "$ST/b2_last_output.txt"
  if grep -q '^CHECKPOINT READY' <<< "$out"; then
    echo "$(now) $MAIN_ID leaving-checkpoint" > "$ST/units/$MAIN_ID.last"
    LEAVE_LINES="- $MAIN_ID (main dev's checkout; paused at a safe point:${PAUSED_NAMES:- none}; every other session there copied as it stands): READY - code + the database file HELD on the laptop (not loaded; it is loaded only if you take over). $(grep '^CHECKPOINT READY' <<< "$out" | one_line 330)"$'\n'"$LEAVE_LINES"
    RESULT="LEAVING READY: main dev code + database copy held (not loaded); $RESULT"
  else
    # No database copy. Every waiting session is released at once (F2). If the code copy above worked, this is still READY.
    db_why="the database copy failed: $(tail -2 <<< "$out" | one_line 160)"
    code_ok=0; grep -q "$MAIN_ID: B1 OK" <<< "$RESULT" && code_ok=1
    for n in $PAUSED_NAMES; do es 120 tell --name "$n" --text "CHECKPOINT $( [ "$code_ok" = 1 ] && echo "TAKEN $(date '+%F %H:%M') | CODE ONLY (the database copy was NOT taken: $db_why)" || echo "FAILED $(date '+%F %H:%M')" ) | carry on" > /dev/null 2>&1; done
    if [ "$code_ok" = 1 ]; then
      LEAVE_LINES="- $MAIN_ID (main dev's checkout; paused at a safe point:${PAUSED_NAMES:- none}): READY (CODE ONLY) - the database copy was NOT taken: $db_why. The laptop's last database copies: held $(last_held | grep . || echo none), loaded $(last_b2 | grep . || echo none). The sessions were told to carry on."$'\n'"$LEAVE_LINES"
      RESULT="LEAVING READY (CODE ONLY - database copy NOT taken: $db_why); $RESULT"
    else
      LEAVE_LINES="- $MAIN_ID (main dev's checkout): FAILED - neither the code nor the database was copied ($db_why). The sessions were told to carry on."$'\n'"$LEAVE_LINES"
      RESULT="LEAVING FAILED for main dev (rc $rc); $RESULT"; NFAIL=$((NFAIL + 1))
    fi
  fi
elif [ -n "$POINT" ] && [ -n "$MAIN_ID" ]; then
  pt_epoch=$(date -d "$(awk '{print $2" "$3}' <<< "$POINT")" +%s 2>/dev/null || echo 0)
  rec=$(newest_db); rec_epoch=$( [ -n "$rec" ] && date -d "$rec" +%s 2>/dev/null || echo 0)
  if [ "$pt_epoch" -gt "$rec_epoch" ]; then
    B2_WAIT=""
    if [ "$LOCATION" = office ]; then B2_WAIT="B2 not in office (a database copy is due; it is made once the laptop is away, or by 'leaving' / the slice-end db-pull)"
    elif [ -f "$ST/b2_failed.txt" ] && [ "$(sed -n 1p "$ST/b2_failed.txt")" = "$POINT" ] && [ $(( ($(date +%s) - $(stat -c %Y "$ST/b2_failed.txt")) / 60 )) -lt "$B2_RETRY_MIN" ]; then
      B2_WAIT="B2 PENDING (the copy failed $(( ($(date +%s) - $(stat -c %Y "$ST/b2_failed.txt")) / 60 )) min ago; next try after $B2_RETRY_MIN min)"
    fi
    if [ -n "$B2_WAIT" ]; then RESULT="$RESULT + $B2_WAIT"
    else
      say "B2 due: $POINT (the last copy: ${rec:-none})"
      heartbeat "RUNNING since $RUN_START - $RESULT; B2: the database FILE of main dev is being copied to the laptop since $(now) (no Docker; this line is replaced by the result)" y
      # CKP-5: the copy is HELD - fetched and sha256-checked, Docker never started, nothing loaded
      out=$(es "${POLLER_B2_LIMIT:-5400}" catch-up --slice "$MAIN_ID" --name "$PT_NAME" --checkout "$MAIN_PATH" --env main --yes --hold 2>&1); rc=$?
      printf '%s\n' "$(now) B2 for $MAIN_ID (rc $rc)" "$out" > "$ST/b2_last_output.txt"
      rec2=$(last_held); rec2_epoch=$( [ -n "$rec2" ] && date -d "$rec2" +%s 2>/dev/null || echo 0)
      if [ "$rec2_epoch" -ge "$pt_epoch" ]; then RESULT="$RESULT + B2 HELD (database file copied, not loaded; covers: $(one_line 80 <<< "$POINT"))"; rm -f "$ST/b2_failed.txt"
      else RESULT="$RESULT + FAILED B2 (rc $rc): $(tail -3 <<< "$out" | one_line 200)"; echo "$POINT" > "$ST/b2_failed.txt"; fi
    fi
  fi
fi

# ---- "leaving": the dev2 units whose session was still on its way to a safe point ------------------------------------
if [ -n "$DEFERRED" ]; then
  heartbeat "RUNNING since $RUN_START - LEAVING: waiting for a dev2 session's safe point (at most $LEAVING_WAIT s from the request), then its code is copied" y
  while UNOW=$(es 180 units 2>/dev/null | tr -d '\r'); [ "$(dev2_pending)" != 0 ] && [ $(( $(date +%s) - ASK_T0 )) -lt "$LEAVING_WAIT" ]; do sleep "${POLLER_LEAVING_STEP:-20}"; done
  if grep -q '^unit|dev2|' <<< "$UNOW"; then UOUT="$UNOW"; fi      # an answer that did not come keeps the units as first seen
  say "LEAVING: the dev2 sessions asked to pause: $(dev2_pending) not at a safe point after $(( $(date +%s) - ASK_T0 )) s"
  copy_units deferred
  DETECTED="$NDET unit(s) with a working session"
fi
if [ -n "$DEV2_ASKED" ]; then release_dev2 all FAILED "its checkout is no longer listed, so it was not copied"; fi
if [ -n "$DEV2_UNSURE" ]; then DEV2_ASKED="$DEV2_UNSURE"; DEV2_UNSURE=""; release_dev2 all TAKEN; fi      # its unit was copied as it stands above

# ---- "leaving": the result, ONE relay entry, the flag cleared -------------------------------------------------------
if [ "$LEAVING" = 1 ]; then
  took=$(( $(date +%s) - LEAVE_T0 ))
  [ -n "$LEAVE_LINES" ] || LEAVE_LINES="- nothing was running on the desktop: no unit to checkpoint"$'\n'
  verdict="READY (code + database copy held, not loaded)"; grep -q "main dev's checkout" <<< "$LEAVE_LINES" || verdict=READY
  grep -q 'READY (CODE ONLY)' <<< "$LEAVE_LINES" && verdict="READY (CODE ONLY - no database copy)"
  grep -q ': FAILED' <<< "$LEAVE_LINES" && verdict="READY WITH FAILURES - read each line"
  relay "LEAVING" "CHECKPOINT $verdict $(date '+%F %H:%M') - \"leaving\" took $took s. Per unit:
$LEAVE_LINES- flag: $(head -1 "$LEAVING_FLAG" | one_line 120). It is cleared now."
  UNIT_LINES+="leaving:           $verdict at $(now), took $took s (one line per unit is in the relay entry)"$'\n'
  mv -f "$LEAVING_FLAG" "${LEAVING_FLAG%.flag}.last" 2>/dev/null || rm -f "$LEAVING_FLAG"
  say "LEAVING $verdict, took $took s"
fi
finish "$RESULT" y
