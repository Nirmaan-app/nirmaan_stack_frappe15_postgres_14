#!/bin/bash
# Runs inside a frappe container: back up the site with files into frappe-bench/envsync/backups/<stamp>/ (local disk:
# never OneDrive, never sites/<site>/private/backups - CKP-1 owner rule) and keep only the newest $1 (default 3) folders.
# Prints prefix=<path relative to sites/> (the form backup.sh prints, so every caller works unchanged) and took=<s>.
cd /workspace/development/frappe-bench
SITE="${ENV_SYNC_SITE:-localhost}"
KEEP="${1:-3}"
ROOT=envsync/backups
D="$ROOT/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$D" || { echo "error=cannot create $D"; exit 1; }
t0=$(date +%s)
out=$(bench --site "$SITE" backup --with-files --backup-path "$PWD/$D" 2>&1) || { echo "$out"; exit 1; }
db=$(ls "$D"/*-database.sql.gz 2>/dev/null | head -1)
[ -n "$db" ] || { echo "$out"; echo "error=no database dump in $D"; exit 1; }
echo "prefix=../$D/$(basename "$db" -database.sql.gz)"
echo "took=$(( $(date +%s) - t0 ))"
# Keep the newest KEEP backup folders; older ones are removed by name (only folders this script made: <stamp> names).
ls -1d "$ROOT"/[0-9]*_[0-9]* 2>/dev/null | sort | head -n -"$KEEP" | while read -r old; do rm -rf -- "$old" && echo "pruned=$old"; done
