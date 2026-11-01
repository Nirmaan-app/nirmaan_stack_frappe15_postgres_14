#!/bin/bash
# Runs inside a frappe container: back up the site with files; prints prefix=<path under sites/> for the four files.
cd /workspace/development/frappe-bench
SITE="${ENV_SYNC_SITE:-localhost}"     # env_sync.sh passes ENV_SYNC_SITE only for a second environment (dev2)
out=$(bench --site "$SITE" backup --with-files 2>&1) || { echo "$out"; exit 1; }
prefix=$(echo "$out" | sed -n 's|^Database *: *\./\(.*\)-database\.sql\.gz.*|\1|p')
[ -n "$prefix" ] || { echo "$out"; echo "error=could not read the backup file names"; exit 1; }
echo "prefix=$prefix"
