#!/bin/bash
# Runs inside a frappe container: back up the site with files; prints prefix=<path under sites/> for the four files.
cd /workspace/development/frappe-bench
out=$(bench --site localhost backup --with-files 2>&1) || { echo "$out"; exit 1; }
prefix=$(echo "$out" | sed -n 's|^Database *: *\./\(.*\)-database\.sql\.gz.*|\1|p')
[ -n "$prefix" ] || { echo "$out"; echo "error=could not read the backup file names"; exit 1; }
echo "prefix=$prefix"
