#!/bin/bash
# Runs inside a POSTGRES container, as the image's password-free local superuser: load dump $2 into a SCRATCH database
# (never a live one; owned by role $1, the site's database user), print its counts as db_counts.sh does, then drop it.
# CKP-1, B2: the laptop proves a pulled backup this way BEFORE it replaces its own database. The dump is kept (the caller
# restores from it next). Prints load=ok then the count_ lines, or error=... and exit 1.
set -uo pipefail
OWNER=$1 DUMP=$2 SCRATCH=envsync_ckpt_check
P() { psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"; }
cleanup() { P -c "DROP DATABASE IF EXISTS \"$SCRATCH\"" > /dev/null 2>&1; rm -f /tmp/envsync_ckpt_check.log; }
trap cleanup EXIT
test -s "$DUMP" || { echo "error=no dump at $DUMP"; exit 1; }
P -c "DROP DATABASE IF EXISTS \"$SCRATCH\"" > /dev/null 2>&1
P -c "CREATE DATABASE \"$SCRATCH\" OWNER \"$OWNER\" ENCODING 'UTF8' TEMPLATE template0" > /dev/null || { echo "error=cannot create the scratch database"; exit 1; }
# pg_dump 17.6+ writes \restrict / \unrestrict meta-commands that psql 14 does not know: strip them (as restore_db.sh).
if ! gunzip -c "$DUMP" | sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
    | psql -U postgres -d "$SCRATCH" -q -v ON_ERROR_STOP=1 > /tmp/envsync_ckpt_check.log 2>&1; then
  echo "error=the dump did not load"; head -c 600 /tmp/envsync_ckpt_check.log; echo; exit 1
fi
echo "load=ok"
bash "$(dirname "$0")/db_counts.sh" "$SCRATCH"
# CKP-5: with a third argument "fp", also the scratch copy's data fingerprint, in db_fingerprint.py's exact words, so a HELD
# copy can be compared with the desktop's fingerprint at backup time without touching the laptop's live database.
if [ "${3:-}" = fp ]; then
  Q() { P -d "$SCRATCH" -c "$1" 2>/dev/null; }
  # Python prints a timestamp with all six microsecond digits (or none when they are zero); psql drops trailing zeros
  # (found live in CKP-5 AC3: ...38.60228 against ...38.602280). TS writes it Python's way.
  TS() { echo "case when $1 is null then 'None' when to_char($1, 'US') = '000000' then to_char($1, 'YYYY-MM-DD HH24:MI:SS') else to_char($1, 'YYYY-MM-DD HH24:MI:SS.US') end"; }
  echo "fp_rm_items=$(Q "select count(*) || ' (newest ' || $(TS "max(modified)") || ')' from \"tabBoQ Rate Master Item\"")"
  echo "fp_rm_snapshot=$(Q "select name from \"tabBoQ Rate Master Snapshot\" order by modified desc limit 1")"
  echo "fp_versions=$(Q "select count(*) || ' (newest ' || $(TS "max(creation)") || ')' from \"tabVersion\"")"
fi
