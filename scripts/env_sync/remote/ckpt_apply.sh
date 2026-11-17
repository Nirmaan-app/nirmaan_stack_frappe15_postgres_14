#!/bin/bash
# Rebuild a CODE CHECKPOINT (ckpt_code.sh output) on a checkout (CKP-1, B5). Used by `env_sync.sh resume-on-laptop` on the
# laptop's checkout, or on a throw-away clone for a dry run. Needs bash, git and tar.
#
#   ckpt_apply.sh apply <repo> <checkpoint dir>   bring <repo> to the checkpoint: fast-forward to its head commit (from its
#                                                 bundle if needed), apply tracked.diff, unpack untracked.tar; then check
#                                                 the working tree's git tree equals head.txt's tree=
#   ckpt_apply.sh undo  <repo> <checkpoint dir>   take that checkpoint's uncommitted work back off (tracked files back to
#                                                 HEAD, the files its untracked.tar added removed BY NAME); commits stay
#   ckpt_apply.sh tree  <repo>                    print tree= for the working tree as it is (HEAD + changes + new files)
#
# apply refuses (error=..., exit 1, nothing changed) when the checkout has uncommitted changes or new files that the
# checkpoint would overwrite, when its branch differs, or when its HEAD is not an ancestor of the checkpoint's head.
# A failed diff or unpack is a CONFLICT: it stops (exit 1) and says what it left; it never forces.
set -uo pipefail
MODE=$1 REPO=$2 CK=${3:-}
NOISE=${ENV_SYNC_NOISE:-$'BOQ-26-00145_SOW_faithful.csv\nHandover doc.pdf\n_classification_review/\ntendering-won.patch'}
cd "$REPO" 2>/dev/null || { echo "error=no checkout at $REPO"; exit 1; }
# in a container the checkout belongs to another uid; on a host (Git Bash) the user's global config is left alone
[ -f /.dockerenv ] && { git config --global --get-all safe.directory 2>/dev/null | grep -qx '\*' || git config --global --add safe.directory '*'; }
kv() { sed -n "s/^$1=//p" "$CK/head.txt" | head -1; }

is_noise() {
  local p
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ "${p%/}" != "$p" ]; then [ "${1#"$p"}" != "$1" ] && return 0
    else [ "$1" = "$p" ] && return 0; fi
  done <<< "$NOISE"
  return 1
}

worktree_tree() {   # the same construction as ckpt_code.sh: HEAD + tracked changes + new non-noise files
  local T; T=$(mktemp -d)
  GIT_INDEX_FILE="$T/i" git read-tree HEAD && GIT_INDEX_FILE="$T/i" git add -u . || { rm -rf "$T"; return 1; }
  : > "$T/l"
  while IFS= read -r -d '' f; do is_noise "$f" || printf '%s\0' "$f" >> "$T/l"; done < <(git ls-files -z --others --exclude-standard)
  while IFS= read -r -d '' f; do is_noise "$f" || printf '%s\0' "$f" >> "$T/l"; done < <(git diff -z --cached --name-only --diff-filter=A HEAD)
  [ -s "$T/l" ] && { GIT_INDEX_FILE="$T/i" git add --pathspec-from-file="$T/l" --pathspec-file-nul || { rm -rf "$T"; return 1; }; }
  GIT_INDEX_FILE="$T/i" git write-tree; rm -rf "$T"
}

case "$MODE" in
  tree) echo "tree=$(worktree_tree)"; exit 0;;
  apply|undo) [ -f "$CK/head.txt" ] || { echo "error=no head.txt in $CK"; exit 1; };;
  *) echo "error=mode is apply, undo or tree"; exit 1;;
esac

if [ "$MODE" = undo ]; then
  git checkout -q -- . || { echo "error=could not put the tracked files back to HEAD"; exit 1; }
  n=0
  # files the diff CREATED (a B3 snapshot carries its new files in tracked.diff), removed by name if git does not track them
  if [ -s "$CK/tracked.diff" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] && [ -e "$f" ] && ! git ls-files --error-unmatch -- "$f" > /dev/null 2>&1 && rm -f -- "$f" && n=$((n + 1))
    done < <(git apply --summary "$CK/tracked.diff" | sed -n 's/^ create mode [0-7]* //p')
  fi
  while IFS= read -r f; do
    [ -n "$f" ] || continue; case "$f" in */) continue;; esac
    if [ -e "$f" ] && ! git ls-files --error-unmatch -- "$f" > /dev/null 2>&1; then rm -f -- "$f" && n=$((n + 1)); fi
  done < <(tar --force-local -tf "$CK/untracked.tar")
  echo "undone: tracked files back to HEAD, $n new file(s) removed"; exit 0
fi

want_branch=$(kv branch) want_head=$(kv head) want_tree=$(kv tree) bundle=$(kv bundle)
[ "$(git rev-parse --abbrev-ref HEAD)" = "$want_branch" ] || { echo "error=this checkout is on $(git rev-parse --abbrev-ref HEAD), the checkpoint on $want_branch"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "error=CONFLICT: the checkout has uncommitted changes to tracked files; nothing changed"; git status --short --untracked-files=no | head; exit 1; }
clash=""
while IFS= read -r f; do
  [ -n "$f" ] || continue; case "$f" in */) continue;; esac
  [ -e "$f" ] && clash+="$f"$'\n'
done < <(tar --force-local -tf "$CK/untracked.tar")
[ -z "$clash" ] || { echo "error=CONFLICT: these new files of the checkpoint already exist here; nothing changed"; printf '%s' "$clash" | head; exit 1; }

before=$(git rev-parse HEAD)
if [ "$before" != "$want_head" ]; then
  if ! git cat-file -e "$want_head^{commit}" 2>/dev/null; then
    [ "$bundle" = commits.bundle ] && [ -f "$CK/commits.bundle" ] || { echo "error=the checkpoint's head ${want_head:0:9} is not here and it carries no bundle; nothing changed"; exit 1; }
    git fetch -q "$CK/commits.bundle" "+refs/heads/*:refs/ckpt-incoming/*" || { echo "error=fetching the checkpoint bundle failed; nothing changed"; exit 1; }
  fi
  git merge-base --is-ancestor "$before" "$want_head" || { echo "error=this checkout's HEAD ${before:0:9} is not an ancestor of the checkpoint's ${want_head:0:9}; nothing changed"; exit 1; }
  git merge --ff-only -q "$want_head" || { echo "error=fast-forward to ${want_head:0:9} refused; nothing changed"; exit 1; }
  echo "fast-forwarded ${before:0:9} -> ${want_head:0:9}"
fi
if [ -s "$CK/tracked.diff" ]; then
  git apply --check --binary "$CK/tracked.diff" 2> /tmp/ckpt_apply.err || { echo "error=CONFLICT: tracked.diff does not apply on ${want_head:0:9} (HEAD is now ${want_head:0:9}; no file changed)"; head -5 /tmp/ckpt_apply.err; exit 1; }
  git apply --binary "$CK/tracked.diff" || { echo "error=CONFLICT: tracked.diff failed part-way"; exit 1; }
fi
tar --force-local -xf "$CK/untracked.tar" || { echo "error=CONFLICT: unpacking untracked.tar failed part-way"; exit 1; }
got=$(worktree_tree)
echo "tree=$got"
[ "$got" = "$want_tree" ] || { echo "error=the rebuilt tree $got differs from the checkpoint's $want_tree"; exit 1; }
echo "applied: tree equals the checkpoint's"
