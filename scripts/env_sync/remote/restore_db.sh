#!/bin/bash
# Runs inside a POSTGRES container, as the image's password-free local superuser: replace database $1 with the dump $2.
# The database being replaced is kept as <name>_envsync_prev (one generation; the older one is dropped).
# Bench must be stopped first.
set -euo pipefail
DB=$1
DUMP=$2
PREV=${DB}_envsync_prev
P() { psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"; }

P -c 'select 1' > /dev/null || { echo "error=no password-free local superuser access in this container"; exit 1; }
test -s "$DUMP" || { echo "error=no dump at $DUMP"; exit 1; }
COLL=$(P -c "select datcollate from pg_database where datname='$DB'")
CTYPE=$(P -c "select datctype from pg_database where datname='$DB'")
[ -n "$COLL" ] || { echo "error=database $DB not found"; exit 1; }

P -c "select count(pg_terminate_backend(pid)) from pg_stat_activity where datname in ('$DB','$PREV') and pid<>pg_backend_pid()" > /dev/null
P -c "DROP DATABASE IF EXISTS \"$PREV\""
P -c "ALTER DATABASE \"$DB\" RENAME TO \"$PREV\""
P -c "CREATE DATABASE \"$DB\" OWNER \"$DB\" ENCODING 'UTF8' LC_COLLATE '$COLL' LC_CTYPE '$CTYPE' TEMPLATE template0"

# pg_dump 17.6+ writes \restrict / \unrestrict meta-commands that psql 14 does not know: strip them.
if ! gunzip -c "$DUMP" | sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
    | psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 > /tmp/envsync_restore.log 2>&1; then
  echo "error=LOAD FAILED; the replaced database is intact as $PREV (rename it back to recover)"
  tail -20 /tmp/envsync_restore.log
  exit 1
fi
rm -f "$DUMP"
echo "restored $DB; the replaced one is kept as $PREV"
