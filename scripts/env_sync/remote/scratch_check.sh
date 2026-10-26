#!/bin/bash
# Runs inside a POSTGRES container, as the image's password-free local superuser: load dump $2 into a SCRATCH
# database (never the live one), compare its table count and key row counts with the live database $1, then drop it.
# Prints check=PASS or check=FAIL. The scratch database and the dump are always removed.
set -uo pipefail
LIVE=$1
DUMP=$2
SCRATCH=envsync_check
P() { psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"; }
cleanup() { P -c "DROP DATABASE IF EXISTS \"$SCRATCH\"" > /dev/null 2>&1; rm -f "$DUMP" /tmp/envsync_check.log; }
trap cleanup EXIT

test -s "$DUMP" || { echo "check=FAIL no dump at $DUMP"; exit 1; }
P -c "DROP DATABASE IF EXISTS \"$SCRATCH\"" > /dev/null 2>&1
P -c "CREATE DATABASE \"$SCRATCH\" OWNER \"$LIVE\" ENCODING 'UTF8' TEMPLATE template0" > /dev/null || { echo "check=FAIL cannot create the scratch database"; exit 1; }
# pg_dump 17.6+ writes \restrict / \unrestrict meta-commands that psql 14 does not know: strip them (as restore_db.sh).
if ! gunzip -c "$DUMP" | sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
    | psql -U postgres -d "$SCRATCH" -q -v ON_ERROR_STOP=1 > /tmp/envsync_check.log 2>&1; then
  echo "check=FAIL the dump did not load"; head -c 600 /tmp/envsync_check.log; echo; exit 1
fi
T="select count(*) from information_schema.tables where table_schema='public'"
a=$(P -d "$LIVE" -c "$T"); b=$(P -d "$SCRATCH" -c "$T")
echo "tables live=$a scratch=$b"
bad=0; [ "$a" = "$b" ] || bad=1
for t in 'tabBOQs' 'tabBOQ Nodes' 'tabBoQ Rate Suggestion Run' 'tabBoQ Rate Master Item' 'tabBoQ Rate Category Config' 'tabVersion' 'tabFile' '__Auth'; do
  a=$(P -d "$LIVE" -c "select count(*) from \"$t\"" 2>/dev/null)
  b=$(P -d "$SCRATCH" -c "select count(*) from \"$t\"" 2>/dev/null)
  if [ -n "$a" ] && [ "$a" = "$b" ]; then echo "rows $t live=$a scratch=$b EQUAL"; else echo "rows $t live=$a scratch=$b DIFF"; bad=1; fi
done
echo "scratch_size=$(P -c "select pg_size_pretty(pg_database_size('$SCRATCH'))")"
if [ "$bad" = 0 ]; then echo "check=PASS"; else echo "check=FAIL counts differ"; exit 1; fi
