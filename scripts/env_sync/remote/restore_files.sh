#!/bin/bash
# Runs inside a frappe container after restore_db.sh: the backup's files, then migrate and clear caches.
# $1 = the backup prefix under sites/ (backup.sh prints it). The replaced file folders are kept as *.envsync_prev.
set -euo pipefail
cd /workspace/development/frappe-bench/sites
for d in localhost/private/files localhost/public/files; do
  rm -rf "$d.envsync_prev"
  if [ -d "$d" ]; then mv "$d" "$d.envsync_prev"; fi
done
tar xf "$1-private-files.tar"
tar xf "$1-files.tar"
echo "files: private $(find localhost/private/files -type f | wc -l), public $(find localhost/public/files -type f | wc -l)"
cd ..
find apps/nirmaan_stack -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
bench --site localhost migrate > /tmp/envsync_migrate.log 2>&1 || { echo "MIGRATE FAILED"; tail -30 /tmp/envsync_migrate.log; exit 1; }
bench --site localhost clear-cache > /dev/null 2>&1
bench --site localhost clear-website-cache > /dev/null 2>&1
rm -rf apps/nirmaan_stack/frontend/node_modules/.vite
echo "migrate ok"
