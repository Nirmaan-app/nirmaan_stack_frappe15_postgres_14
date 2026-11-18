#!/usr/bin/env bash
# slice_poll.sh -- the LAPTOP session's poller while a delegated slice runs on the desktop (CKP-2 B1 + automatic B4).
#
#   bash scripts/env_sync/slice_poll.sh --slice S --name N [--minutes 29]
#
# Polls once a minute with plain reads over SSH (never `claude` over SSH) and EXITS on the first event, so the laptop
# session wakes, relays it and starts the poller again:
#   STATUS <first line>   the desktop session's status file has a new first line (HEARTBEAT lines do not wake)
#   CAUGHT-UP ...         the desktop answers again after the laptop could not reach it (back home, link back): catch-up
#                         ran by itself (owner 2026-11-17 20:00, R2: the owner does not have to say "home")
#   OFFLINE <time>        the desktop stopped answering (laptop offline or desktop down) - printed once; polling goes on
#   TICK                  nothing happened for --minutes
# Every poll also runs `env_sync.sh checkpoint-code --if-older 15` (B1: a no-op until 15 minutes after the last checkpoint or
# attempt). While the desktop does not answer, B1 is skipped (no failure entry every 15 minutes) - the catch-up covers it.
# A checkpoint failure never stops the slice (CKP-2 F1): it is logged by env_sync and the poller carries on.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_HOST="$(cd "$HERE/../../../.." && pwd)"
SLICE="" NAME="" MINUTES=29
while [ $# -gt 0 ]; do
  case "$1" in --slice) SLICE="$2"; shift;; --name) NAME="$2"; shift;; --minutes) MINUTES="$2"; shift;; *) echo "unknown flag $1"; exit 2;; esac
  shift
done
[[ "$SLICE" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,40}$ ]] && [[ "$NAME" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,40}$ ]] || { echo "usage: slice_poll.sh --slice S --name N [--minutes M]"; exit 2; }
SSH=/c/Windows/System32/OpenSSH/ssh.exe
DESKTOP="${ENV_SYNC_DESKTOP:-desktop}"
D_BENCH="${ENV_SYNC_DESKTOP_BENCH:-C:/Users/USER/Documents/frappe_docker/development/frappe-bench}"
ST="$BENCH_HOST/envsync/poll/$SLICE"; mkdir -p "$ST"
LOG="$ST/poll.log"
say() { echo "$(date '+%F %T') $*" >> "$LOG"; }

for _ in $(seq 1 "$MINUTES"); do
  out=$(timeout 40 "$SSH" -o BatchMode=yes -o ConnectTimeout=15 "$DESKTOP" "\$s='$D_BENCH/envsync/sessions/$NAME.status.md'; 'ssh=ok'; if (Test-Path -LiteralPath \$s) { 'F=' + (Get-Content -LiteralPath \$s -TotalCount 1) }" 2>/dev/null | tr -d '\r')
  if ! grep -q '^ssh=ok' <<< "$out"; then
    if [ ! -f "$ST/offline" ]; then date '+%F %T' > "$ST/offline"; say "OFFLINE"; echo "OFFLINE $(date '+%F %T') - the desktop does not answer; polling goes on, catch-up runs by itself when it answers again"; exit 0; fi
    sleep 60; continue
  fi
  if [ -f "$ST/offline" ]; then
    since=$(cat "$ST/offline"); rm -f "$ST/offline"; say "BACK (offline since $since) - catch-up"
    bash "$HERE/env_sync.sh" catch-up --slice "$SLICE" --name "$NAME" 2>&1 | tee -a "$LOG"
    echo "(automatic catch-up after reconnecting; the laptop could not reach the desktop since $since)"; exit 0
  fi
  first=$(sed -n 's/^F=//p' <<< "$out")
  if [ -n "$first" ] && [ "$first" != "$(cat "$ST/last_first" 2>/dev/null)" ]; then
    echo "$first" > "$ST/last_first"
    case "$first" in HEARTBEAT*) ;; *) say "STATUS $first"; echo "STATUS $first"; exit 0;; esac
  fi
  ck=$(bash "$HERE/env_sync.sh" checkpoint-code --slice "$SLICE" --name "$NAME" --if-older 15 2>&1)
  case "$ck" in *"not due"*) ;; *) say "B1: $(tr '\n' ' ' <<< "$ck" | cut -c1-300)";; esac
  sleep 60
done
echo "TICK $(date '+%F %T') - no event in $MINUTES min"
