#!/bin/bash
# Runs inside a frappe container: back up the site with files into frappe-bench/envsync/backups/<stamp>/ (local disk:
# never OneDrive, never sites/<site>/private/backups - CKP-1 owner rule) and keep only the newest $1 (default 3) folders.
# Prints prefix=<path relative to sites/> (the form backup.sh prints, so every caller works unchanged) and took=<s>.
#
# ONE BACKUP AT A TIME (BCS-T1): envsync/backups/.backup.lock is taken first and is gone when this script ends - normally,
# after a failed backup, and when it is killed (a watcher then ends the backup it had started and removes the lock). A second
# caller waits up to ENV_SYNC_BACKUP_LOCK_WAIT seconds (300), then fails with a plain line. A lock whose process is gone is
# cleared at once with a lock= line here and in envsync/backups/backup_lock.log; one that names no process, after 15 s.
# A dev2 slice that backs up main calls THIS script in main's container, so it takes the same lock.
#
# The password never reaches a command line: backup_site.py runs the same `bench backup` with it in pg_dump's environment.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ENV_SYNC_BENCH:-/workspace/development/frappe-bench}" || { echo "error=no bench folder"; exit 1; }
SITE="${ENV_SYNC_SITE:-localhost}"
KEEP="${1:-3}"
ROOT=envsync/backups
mkdir -p "$ROOT" || { echo "error=cannot create $ROOT"; exit 1; }

LOCK="$ROOT/.backup.lock"
LOCK_WAIT="${ENV_SYNC_BACKUP_LOCK_WAIT:-300}"
LOCK_STEP="${ENV_SYNC_BACKUP_LOCK_STEP:-5}"
NAMELESS="${ENV_SYNC_BACKUP_LOCK_NAMELESS:-15}"         # seconds a lock that names no process may stand
# stat_of <pid> <n>: field n of /proc/<pid>/stat after the program name (2 = parent, 20 = start time); "" when it is gone.
stat_of() { local l; read -r l 2>/dev/null < "/proc/$1/stat" || return 1; l="${l##*) }"; set -- "$2" $l; shift "$1"; printf '%s' "${1:-}"; }
age_of() { local m; m=$(stat -c %Y "$1" 2>/dev/null) || { echo 0; return; }; echo $(( $(date +%s) - m )); }
MINE="pid=$$ start=$(stat_of $$ 20) host=$HOSTNAME site=$SITE since=$(date '+%F_%T')"
lock_note() { echo "lock=$1"; echo "$(date '+%F %T') $1" >> "$ROOT/backup_lock.log"; }
# owner_gone <lock line>: 0 when the process that wrote it no longer exists (or it is another process with the same number,
# or the container was made anew), or when the lock names nobody for NAMELESS seconds.
owner_gone() {
  local pid start host
  pid=$(sed -n 's/^pid=\([0-9]*\) .*/\1/p' <<< "$1"); start=$(sed -n 's/.* start=\([0-9]*\) .*/\1/p' <<< "$1"); host=$(sed -n 's/.* host=\([^ ]*\) .*/\1/p' <<< "$1")
  if [ -z "$pid" ] || [ -z "$start" ]; then [ "$(age_of "$LOCK")" -ge "$NAMELESS" ]; return; fi
  [ "$host" != "$HOSTNAME" ] || [ "$(stat_of "$pid" 20)" != "$start" ]
}
# clear_stale <lock line>: remove the lock only while it still holds that very line (another caller may have cleared it and
# taken its own meanwhile); one caller clears at a time.
clear_stale() {
  if ! mkdir "$LOCK.clear" 2>/dev/null; then [ "$(age_of "$LOCK.clear")" -ge 15 ] && rmdir "$LOCK.clear" 2>/dev/null; return 0; fi
  if [ -e "$LOCK" ] && [ "$(cat "$LOCK" 2>/dev/null)" = "$1" ]; then rm -f "$LOCK" && lock_note "cleared a stale lock: its backup is not running any more (${1:-it named no process})"; fi
  rmdir "$LOCK.clear" 2>/dev/null
}
take_lock() {
  local cur t0 told=0; t0=$(date +%s)
  while :; do
    if ( set -C; printf '%s\n' "$MINE" > "$LOCK" ) 2>/dev/null; then
      [ "$told" = 0 ] || lock_note "waited $(( $(date +%s) - t0 )) s for another backup of this site to end"
      return 0
    fi
    cur=$(cat "$LOCK" 2>/dev/null); [ -e "$LOCK" ] || { sleep 1; continue; }
    if owner_gone "$cur"; then clear_stale "$cur"; sleep 1; continue; fi
    told=1
    if [ $(( $(date +%s) - t0 )) -ge "$LOCK_WAIT" ]; then
      echo "error=another backup of this site is still running after $LOCK_WAIT s (${cur:-a lock just taken}); nothing was backed up - try again when it has ended"; return 1
    fi
    sleep "$LOCK_STEP"
  done
}
drop_lock() { if [ "$(cat "$LOCK" 2>/dev/null)" = "$MINE" ]; then rm -f "$LOCK"; fi; }
# end_tree <pid>: end a process and everything it started (bench backup -> a shell -> pg_dump | gzip).
end_tree() {
  local d p; for d in /proc/[0-9]*; do p="${d#/proc/}"; if [ "$(stat_of "$p" 2)" = "$1" ]; then end_tree "$p"; fi; done
  kill "$1" 2>/dev/null
}

take_lock || exit 1
CHILD="" WATCH="" OUTF=$(mktemp)
finish() {
  [ -n "$WATCH" ] && kill "$WATCH" 2>/dev/null
  if [ -n "$CHILD" ] && kill -0 "$CHILD" 2>/dev/null; then end_tree "$CHILD"; wait "$CHILD" 2>/dev/null; fi
  rm -f "$OUTF"; drop_lock
}
trap finish EXIT
trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

D="$ROOT/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$D" || { echo "error=cannot create $D"; exit 1; }
t0=$(date +%s)
env/bin/python -I "$HERE/backup_site.py" --site "$SITE" backup --with-files --backup-path "$PWD/$D" > "$OUTF" 2>&1 &
CHILD=$!
# the watcher: when this script is killed outright (no trap can run), end the backup it started and remove its lock
MAIN=$$ MAIN_START=$(stat_of $$ 20)
( trap - EXIT; trap '' HUP INT; while [ "$(stat_of "$MAIN" 20)" = "$MAIN_START" ]; do sleep 1; done
  end_tree "$CHILD"; while kill -0 "$CHILD" 2>/dev/null; do sleep 1; done; rm -f "$OUTF"; drop_lock ) > /dev/null 2>&1 &
WATCH=$!
wait "$CHILD"; rc=$?; CHILD=""
out=$(cat "$OUTF")
[ "$rc" = 0 ] || { echo "$out"; exit 1; }
db=$(ls "$D"/*-database.sql.gz 2>/dev/null | head -1)
[ -n "$db" ] || { echo "$out"; echo "error=no database dump in $D"; exit 1; }
echo "prefix=../$D/$(basename "$db" -database.sql.gz)"
echo "took=$(( $(date +%s) - t0 ))"
# Keep the newest KEEP backup folders; older ones are removed by name (only folders this script made: <stamp> names).
ls -1d "$ROOT"/[0-9]*_[0-9]* 2>/dev/null | sort | head -n -"$KEEP" | while read -r old; do rm -rf -- "$old" && echo "pruned=$old"; done
