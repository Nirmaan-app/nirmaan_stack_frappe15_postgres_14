#!/bin/bash
# Runs inside a frappe container: bundle the commits after $1 on branch $2 into $3.
set -euo pipefail
cd /workspace/development/frappe-bench/apps/nirmaan_stack
[ "$(git rev-parse --abbrev-ref HEAD)" = "$2" ] || { echo "error=this checkout is not on $2"; exit 1; }
git bundle create -q "$3" "^$1" "refs/heads/$2"
git bundle verify -q "$3" >/dev/null 2>&1 || { echo "error=bundle failed to verify"; exit 1; }
echo "bundle=$3"
