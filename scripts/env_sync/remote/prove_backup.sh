#!/bin/bash
# Runs inside a frappe container: prove a `backup.sh` backup's files are whole before anything relies on them.
# $1 = the backup prefix under sites/ (backup.sh prints it). Prints size + sha256 per file, then proof=ok or error=...
set -uo pipefail
cd /workspace/development/frappe-bench/sites || { echo "error=no sites folder"; exit 1; }
for suf in -database.sql.gz -files.tar -private-files.tar; do
  f="$1$suf"
  test -s "$f" || { echo "error=missing or empty $f"; exit 1; }
  echo "file=$(basename "$f") size=$(stat -c %s "$f") sha256=$(sha256sum "$f" | cut -c1-64)"
done
gzip -t "$1-database.sql.gz" 2>/dev/null || { echo "error=gzip -t failed on the database dump"; exit 1; }
tar tf "$1-files.tar" > /dev/null 2>&1 || { echo "error=the public files archive does not list"; exit 1; }
tar tf "$1-private-files.tar" > /dev/null 2>&1 || { echo "error=the private files archive does not list"; exit 1; }
echo "files_private=$(tar tf "$1-private-files.tar" | grep -vc '/$') files_public=$(tar tf "$1-files.tar" | grep -vc '/$')"
echo "proof=ok"
