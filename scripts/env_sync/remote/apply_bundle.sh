#!/bin/bash
# Runs inside a frappe container: fetch a git bundle and FAST-FORWARD the current branch to it.
# $1 bundle path (container), $2 branch, $3 name for the tracking ref (laptop | desktop).
# A fast-forward never rewrites history, and git refuses it if it would overwrite uncommitted local changes.
set -uo pipefail
cd /workspace/development/frappe-bench/apps/nirmaan_stack || exit 1
[ "$(git rev-parse --abbrev-ref HEAD)" = "$2" ] || { echo "error=this checkout is not on $2"; exit 1; }
git fetch -q "$1" "+refs/heads/$2:refs/remotes/$3/$2" || { echo "error=fetch from the bundle failed"; exit 1; }
before=$(git rev-parse HEAD)
if ! git merge --ff-only -q "$3/$2" 2>/tmp/envsync_merge.err; then
  echo "error=fast-forward refused"; cat /tmp/envsync_merge.err; exit 1
fi
echo "before=$before"
echo "after=$(git rev-parse HEAD)"
git diff --name-only "$before" HEAD | sed 's/^/changed=/'
rm -f "$1"
