#!/bin/bash
# A CODE CHECKPOINT of a checkout (CKP-1, B1 / B4): everything needed to rebuild its working tree somewhere else, without
# touching the checkout itself (no index, branch or file of it changes). Runs inside a frappe container (env_sync.sh,
# B1) or in Git Bash on the desktop host (a desktop session at a milestone, B4) - it needs only bash, git and tar.
#
#   ckpt_code.sh <repo> <out dir> [<base commit>] [<checkpoint commit>] [--held=<sha>:<sha>:...]
#
# With <checkpoint commit> (a ckpt_branch.sh commit, B3) the snapshot is that commit instead of the live tree: head = its
# parent, tracked.diff = parent..commit (new files included), untracked.tar empty, and the bundle carries its ckpt/ branch.
#
# Writes into <out dir> (created; must not exist yet):
#   head.txt        branch=, head=, base=, tree=, made= key lines. tree = the git tree of HEAD plus the uncommitted work
#                   (what a takeover must end equal to), built in a TEMPORARY index.
#   commits.bundle  the commits after <base> (only when <base> is given, known here, and behind HEAD); with no usable base,
#                   a bundle of the whole branch is NOT made (too big) and head.txt says bundle=none.
#                   --held= (a dev2 unit only, BCS-T1 2026-11-22) lists commits the LAPTOP holds (its dev2 HEAD, its branch and
#                   remote-tracking tips): when <base> is not usable, the bundle starts from the nearest commit this branch
#                   shares with one of them - an ancestor of a commit the laptop holds, so the laptop holds it too. head.txt
#                   then always has a commits= line: carried since ..., nothing to carry ..., or NOT carried: <reason>.
#                   Without --held (every main dev unit) head.txt and the bundle decision are exactly as before.
#   tracked.diff    git diff --binary HEAD (staged and unstaged changes to tracked files, deletions included)
#   untracked.tar   new files git does not ignore, minus the declared noise (ENV_SYNC_NOISE, newline-separated paths)
#   files.txt       the porcelain list the snapshot was taken from
# Prints ckpt=<out dir>, tree=, size= (bytes of the folder) and files= on success; error=... and exit 1 otherwise.
set -uo pipefail
CARRY=0 HELD="" ARGS=()
for a in "$@"; do case "$a" in --held=*) CARRY=1; HELD=${a#--held=};; *) ARGS+=("$a");; esac; done
set -- "${ARGS[@]}"
REPO=$1 OUT=$2 BASE=${3:-} COMMIT=${4:-}
NOISE=${ENV_SYNC_NOISE:-$'BOQ-26-00145_SOW_faithful.csv\nHandover doc.pdf\n_classification_review/\ntendering-won.patch'}
cd "$REPO" 2>/dev/null || { echo "error=no checkout at $REPO"; exit 1; }
# in a container the checkout belongs to another uid; on a host (Git Bash) the user's global config is left alone
[ -f /.dockerenv ] && { git config --global --get-all safe.directory 2>/dev/null | grep -qx '\*' || git config --global --add safe.directory '*'; }
[ -e "$OUT" ] && { echo "error=$OUT already exists"; exit 1; }
mkdir -p "$OUT" || { echo "error=cannot create $OUT"; exit 1; }

branch=$(git rev-parse --abbrev-ref HEAD)
if [ -n "$COMMIT" ]; then
  git cat-file -e "$COMMIT^{commit}" 2>/dev/null || { echo "error=no commit $COMMIT"; exit 1; }
  head=$(git rev-parse "$COMMIT^"); tree=$(git rev-parse "$COMMIT^{tree}")
  git diff --binary "$head" "$COMMIT" > "$OUT/tracked.diff" || { echo "error=git diff failed"; exit 1; }
  git diff --name-status "$head" "$COMMIT" > "$OUT/files.txt"
  tar --force-local -cf "$OUT/untracked.tar" -T /dev/null; n_untracked=0
  n_tracked=$(grep -c . "$OUT/files.txt")
else
  head=$(git rev-parse HEAD)
  # A noise entry ending in "/" is a folder (every path under it); any other entry is one exact path.
  is_noise() {
    local p
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      if [ "${p%/}" != "$p" ]; then [ "${1#"$p"}" != "$1" ] && return 0
      else [ "$1" = "$p" ] && return 0; fi
    done <<< "$NOISE"
    return 1
  }

  git status --porcelain > "$OUT/files.txt"
  git diff --binary HEAD > "$OUT/tracked.diff" || { echo "error=git diff failed"; exit 1; }
  : > "$OUT/untracked.list"
  while IFS= read -r -d '' f; do is_noise "$f" || printf '%s\0' "$f" >> "$OUT/untracked.list"; done < <(git ls-files -z --others --exclude-standard)
  if [ -s "$OUT/untracked.list" ]; then
    tar --force-local -cf "$OUT/untracked.tar" --null -T "$OUT/untracked.list" || { echo "error=tar of the untracked files failed"; exit 1; }
  else
    tar --force-local -cf "$OUT/untracked.tar" -T /dev/null
  fi
  n_untracked=$(tr -cd '\0' < "$OUT/untracked.list" | wc -c)

  # The tree a takeover must reproduce: HEAD + tracked changes + the untracked files above, in a throw-away index.
  TMPI="$OUT/.index"
  GIT_INDEX_FILE="$TMPI" git read-tree HEAD || { echo "error=read-tree failed"; exit 1; }
  GIT_INDEX_FILE="$TMPI" git add -u . || { echo "error=staging the tracked changes in the temporary index failed"; exit 1; }
  # plus files staged as NEW in the real index (in tracked.diff, but neither in HEAD nor "untracked")
  cp "$OUT/untracked.list" "$OUT/add.list"
  while IFS= read -r -d '' f; do is_noise "$f" || printf '%s\0' "$f" >> "$OUT/add.list"; done < <(git diff -z --cached --name-only --diff-filter=A HEAD)
  if [ -s "$OUT/add.list" ]; then
    GIT_INDEX_FILE="$TMPI" git add --pathspec-from-file="$OUT/add.list" --pathspec-file-nul || { echo "error=staging the new files in the temporary index failed"; exit 1; }
  fi
  tree=$(GIT_INDEX_FILE="$TMPI" git write-tree) || { echo "error=write-tree failed"; exit 1; }
  rm -f "$TMPI" "$OUT/untracked.list" "$OUT/add.list"

  n_tracked=$(git diff --name-only HEAD | grep -c .)
fi

bundle=none
if [ -n "$COMMIT" ]; then
  ref=$(git for-each-ref --format='%(refname)' --points-at "$COMMIT" refs/heads/ckpt/ | head -1)
  [ -n "$ref" ] || { echo "error=no ckpt/ branch points at $COMMIT"; exit 1; }
  if [ -n "$BASE" ] && git cat-file -e "$BASE^{commit}" 2>/dev/null && git merge-base --is-ancestor "$BASE" "$COMMIT"; then
    git bundle create -q "$OUT/commits.bundle" "^$BASE" "$ref" 2>/dev/null && bundle=commits.bundle
  else
    git bundle create -q "$OUT/commits.bundle" "$ref" 2>/dev/null && bundle=commits.bundle
  fi
  [ "$bundle" = commits.bundle ] || { echo "error=the checkpoint bundle failed"; exit 1; }
elif [ -n "$BASE" ] && git cat-file -e "$BASE^{commit}" 2>/dev/null && [ "$BASE" != "$head" ] && git merge-base --is-ancestor "$BASE" HEAD; then
  git bundle create -q "$OUT/commits.bundle" "^$BASE" "refs/heads/$branch" 2>/dev/null && bundle=commits.bundle
fi
# A dev2 unit: the branch's commits must reach the laptop, or the copy says why they do not - never silently.
commits=""
if [ "$CARRY" = 1 ] && [ -z "$COMMIT" ]; then
  if [ "$bundle" = commits.bundle ]; then commits="carried since ${BASE:0:9}"
  elif [ "$branch" = HEAD ]; then commits="NOT carried: the checkout is on no branch (detached HEAD)"
  else
    near="" nearn=0
    for c in ${HELD//:/ }; do
      [[ "$c" =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "$c^{commit}" 2>/dev/null || continue
      mb=$(git merge-base "$c" HEAD 2>/dev/null) || continue
      n=$(git rev-list --count "$mb..HEAD")
      if [ -z "$near" ] || [ "$n" -lt "$nearn" ]; then near=$mb nearn=$n; fi
    done
    if [ -z "$HELD" ]; then commits="NOT carried: the laptop has no dev2 checkout, so no common commit is known"
    elif [ -z "$near" ]; then commits="NOT carried: no commit the laptop holds is known here and shared with $branch"
    elif [ "$nearn" = 0 ]; then commits="nothing to carry: the laptop already holds ${head:0:9}"
    elif git bundle create -q "$OUT/commits.bundle" "^$near" "refs/heads/$branch" 2>/dev/null; then
      bundle=commits.bundle; commits="carried since ${near:0:9} (the laptop's HEAD ${BASE:0:9} is not a usable base)"; BASE=$near
    else commits="NOT carried: the bundle could not be made"; fi
  fi
fi
{ echo "branch=$branch"; echo "head=$head"; echo "base=${BASE:-none}"; echo "bundle=$bundle"; echo "tree=$tree"
  echo "tracked_files=$n_tracked"; echo "untracked_files=$n_untracked"; echo "made=$(date '+%F %T')"
  [ -n "$commits" ] && echo "commits=$commits"; } > "$OUT/head.txt"
echo "ckpt=$OUT"
echo "branch=$branch"
echo "head=$(git rev-parse HEAD)"
if [ -n "$BASE" ] && git cat-file -e "$BASE^{commit}" 2>/dev/null; then
  echo "base_known=1"; git merge-base --is-ancestor "$BASE" HEAD && echo "base_is_ancestor=1" || echo "base_is_ancestor=0"
else echo "base_known=0"; fi
echo "tree=$tree"
[ -n "$commits" ] && echo "commits=$commits"
echo "size=$(du -sb "$OUT" | cut -f1)"
echo "files=$(( n_tracked + n_untracked ))"
