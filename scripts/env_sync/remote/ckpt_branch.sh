#!/bin/bash
# The "leaving" CHECKPOINT COMMIT (CKP-1, B3): HEAD plus every uncommitted change and new file (minus the declared noise)
# as ONE commit on a LOCAL branch ckpt/<slice>-<yyyymmdd-hhmm>. Built in a temporary index with commit-tree, so the
# checkout's working tree, index and current branch are never touched and a running session can carry on at once.
# Never pushed (env_sync never pushes; only the owner pushes, by hand, and never a ckpt/ branch).
#
#   ckpt_branch.sh <repo> <slice> [<stamp yyyymmdd-hhmm>]
#
# Prints branch=, commit=, parent=, tree= on success; error=... and exit 1 otherwise.
set -uo pipefail
REPO=$1 SLICE=$2 STAMP=${3:-$(date +%Y%m%d-%H%M)}
NOISE=${ENV_SYNC_NOISE:-$'BOQ-26-00145_SOW_faithful.csv\nHandover doc.pdf\n_classification_review/\ntendering-won.patch'}
[[ "$SLICE" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,40}$ ]] || { echo "error=the slice name takes letters, digits and dashes"; exit 1; }
cd "$REPO" 2>/dev/null || { echo "error=no checkout at $REPO"; exit 1; }
# in a container the checkout belongs to another uid; on a host (Git Bash) the user's global config is left alone
[ -f /.dockerenv ] && { git config --global --get-all safe.directory 2>/dev/null | grep -qx '\*' || git config --global --add safe.directory '*'; }
BR="ckpt/$SLICE-$STAMP"
git show-ref --verify -q "refs/heads/$BR" && { echo "error=$BR already exists"; exit 1; }

is_noise() {
  local p
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ "${p%/}" != "$p" ]; then [ "${1#"$p"}" != "$1" ] && return 0
    else [ "$1" = "$p" ] && return 0; fi
  done <<< "$NOISE"
  return 1
}

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export GIT_INDEX_FILE="$T/index"
git read-tree HEAD || { echo "error=read-tree failed"; exit 1; }
git add -u . || { echo "error=staging the tracked changes failed"; exit 1; }
: > "$T/list"
while IFS= read -r -d '' f; do is_noise "$f" || printf '%s\0' "$f" >> "$T/list"; done < <(git ls-files -z --others --exclude-standard)
if [ -s "$T/list" ]; then git add --pathspec-from-file="$T/list" --pathspec-file-nul || { echo "error=staging the new files failed"; exit 1; }; fi
tree=$(git write-tree) || { echo "error=write-tree failed"; exit 1; }
unset GIT_INDEX_FILE

parent=$(git rev-parse HEAD)
msg="checkpoint $SLICE $STAMP: HEAD $(git rev-parse --short=9 HEAD) + uncommitted work (local branch, never pushed)"
# A neutral identity: this commit lives only on the machines, and no personal detail belongs in it.
commit=$(GIT_AUTHOR_NAME="envsync checkpoint" GIT_AUTHOR_EMAIL="envsync@localhost" \
         GIT_COMMITTER_NAME="envsync checkpoint" GIT_COMMITTER_EMAIL="envsync@localhost" \
         git commit-tree "$tree" -p "$parent" -m "$msg") || { echo "error=commit-tree failed"; exit 1; }
git update-ref "refs/heads/$BR" "$commit" "" || { echo "error=could not create $BR"; exit 1; }
echo "branch=$BR"
echo "commit=$commit"
echo "parent=$parent"
echo "tree=$tree"
