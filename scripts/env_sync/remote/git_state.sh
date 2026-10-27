#!/bin/bash
# Runs inside a frappe container. Prints this checkout's git state as key=value lines for env_sync.sh.
# $1 (optional): the other machine's HEAD, to say whether this checkout already contains it.
cd /workspace/development/frappe-bench/apps/nirmaan_stack || exit 1
git config --global --get-all safe.directory 2>/dev/null | grep -qx '\*' || git config --global --add safe.directory '*'

echo "branch=$(git rev-parse --abbrev-ref HEAD)"
echo "head=$(git rev-parse HEAD)"
git status --porcelain --untracked-files=no | sed 's/^/dirtyfile=/'
if [ -n "${1:-}" ]; then
  if git cat-file -e "$1^{commit}" 2>/dev/null; then
    echo "has_other=1"
    if git merge-base --is-ancestor "$1" HEAD; then
      echo "other_is_ancestor=1"
      echo "ahead=$(git rev-list --count "$1..HEAD")"
      git log --format='log=%h %s' "$1..HEAD" | cut -c1-160 | head -20
    else
      echo "other_is_ancestor=0"
    fi
  else
    echo "has_other=0"
  fi
fi
