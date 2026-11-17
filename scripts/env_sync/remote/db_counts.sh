#!/bin/bash
# Runs inside a POSTGRES container, as the image's password-free local superuser: the table count and the key row counts
# of database $1, as count_<name>=<n> lines (CKP-1, B2: taken on the desktop just before and just after its backup).
# The table list is scratch_check.sh's.
set -uo pipefail
P() { psql -U postgres -v ON_ERROR_STOP=1 -tA -d "$1" -c "$2"; }
echo "count_tables=$(P "$1" "select count(*) from information_schema.tables where table_schema='public'")"
for t in 'tabBOQs' 'tabBOQ Nodes' 'tabBoQ Rate Suggestion Run' 'tabBoQ Rate Master Item' 'tabBoQ Rate Category Config' 'tabVersion' 'tabFile' '__Auth'; do
  echo "count_${t// /_}=$(P "$1" "select count(*) from \"$t\"" 2>/dev/null)"
done
