#!/bin/bash
# Runs inside a frappe container after new code lands: host-side file changes fire no inotify in the container, so
# bench and vite keep serving the old code until restarted. Stops the servers and clears every cache; env_sync.sh
# then starts them again with start_bench.sh. $1 = --migrate when doctypes, patches or hooks changed.
set -uo pipefail
cd /workspace/development/frappe-bench
bash "$(dirname "$0")/stop_bench.sh"
find apps/nirmaan_stack -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null
if [ "${1:-}" = "--migrate" ]; then
  bench --site localhost migrate > /tmp/envsync_migrate.log 2>&1 || { echo "MIGRATE FAILED"; tail -30 /tmp/envsync_migrate.log; exit 1; }
  echo "migrate ok"
fi
bench --site localhost clear-cache > /dev/null 2>&1
bench --site localhost clear-website-cache > /dev/null 2>&1
rm -rf apps/nirmaan_stack/frontend/node_modules/.vite
echo "destaled"
