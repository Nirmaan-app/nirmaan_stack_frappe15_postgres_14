#!/usr/bin/env bash
# Moves a developer's checkout from their old public fork to a new private fork, keeping every branch.
#
# Usage, from the checkout, once the main repo is private:
#   bash scripts/fork_swap.sh prepare <github-login> [--apply]
#       On GitHub: forks the private main repo as <login>/<repo>-private and checks that it is a private fork
#       of it. The old fork is left alone: GitHub keeps it public and it cannot be made private.
#   bash scripts/fork_swap.sh swap --new <new-fork-url> [--remote <name>] [--apply]
#       In this checkout. <name> (default origin) is the remote of your old fork. Copies the old fork's
#       branches to remote old-public with pushes blocked, points <name> at the new fork, adds the main repo
#       as upstream if missing, pushes every local branch and every branch found only on the old fork to the
#       new fork, then asks the new fork for each branch and prints PASS or FAIL.
#
# Without --apply it prints what it would do and changes nothing. It is safe to run again.
# It never force-pushes and never deletes a branch or a repo. Runs on macOS bash 3.2, Linux and Git Bash.
set -uo pipefail

REPO_NAME=nirmaan_stack_frappe15_postgres_14
MAIN_REPO=Nirmaan-app/$REPO_NAME
NEW_NAME=$REPO_NAME-private
UPSTREAM_URL=${FORK_SWAP_UPSTREAM_URL:-https://github.com/$MAIN_REPO.git}
OLD=old-public
BLOCKED_PUSH_URL=no-push://the-old-public-fork-is-retired

apply=0
die() { echo "fork_swap: $*" >&2; exit 2; }
run() { if [ "$apply" = 1 ]; then "$@" || die "failed: $*"; else echo "would run: $*"; fi; }
try() { if [ "$apply" = 1 ]; then "$@" || echo "warning: failed: $*; the check below shows what is missing"; else echo "would run: $*"; fi; }
field() { gh api "repos/$1" -q "$2" 2>/dev/null; }
is_private_fork() { [ "$(field "$1" .parent.full_name)" = "$MAIN_REPO" ] && [ "$(field "$1" .private)" = true ]; }
# GitHub owner and repo names ignore case, so github.com/nirmaan-app/... is the main repo too.
names_main_repo() {
  local u m; u=$(printf '%s' "$1" | tr 'A-Z' 'a-z'); m=$(printf '%s' "$MAIN_REPO" | tr 'A-Z' 'a-z')
  case "$u" in *"$m"*) return 0 ;; esac; return 1
}

prepare() {
  local login=$1 fork=$1/$NEW_NAME old=$1/$REPO_NAME
  command -v gh >/dev/null || die "install the GitHub CLI (gh) first"
  local who; who=$(gh api user -q .login) || die "log in first: gh auth login"
  [ "$who" = "$login" ] || die "gh is logged in as $who, not $login"
  gh api "repos/$MAIN_REPO" >/dev/null 2>&1 || die "cannot read $MAIN_REPO; ask the owner for access"
  [ "$(field "$MAIN_REPO" .private)" = true ] || die "$MAIN_REPO is still public; run this after the switch"
  [ "$(field "$MAIN_REPO" .allow_forking)" = true ] || die "$MAIN_REPO does not allow forks; ask the owner to allow them"
  [ "$(field "$old" .parent.full_name)" != "$MAIN_REPO" ] ||
    die "$old is still attached to $MAIN_REPO, so forking would rename it; ask the owner"

  if gh api "repos/$fork" >/dev/null 2>&1; then
    is_private_fork "$fork" || die "$fork exists but is not a private fork of $MAIN_REPO"
    echo "ok: $fork is a private fork of $MAIN_REPO"
  else
    run gh repo fork "$MAIN_REPO" --clone=false --remote=false --fork-name "$NEW_NAME"
    if [ "$apply" = 1 ]; then
      local i
      for i in 1 2 3 4 5; do is_private_fork "$fork" && break; sleep "${FORK_SWAP_POLL_SECONDS:-3}"; done
      is_private_fork "$fork" || die "GitHub did not create $fork as a private fork of $MAIN_REPO"
      echo "ok: forked $fork"
    fi
  fi
  if [ "$(field "$old" .private)" = false ]; then
    echo "note: your old fork $old is still public. Run swap in every clone on every machine you use. Once each"
    echo "      ends with '0 failed', delete the old fork: gh auth refresh -s delete_repo && gh repo delete $old"
  fi
  echo "next: bash scripts/fork_swap.sh swap --new https://github.com/$fork.git --apply"
}

is_local_path() { case "$1" in /*|file://*|[A-Za-z]:*) return 0 ;; esac; return 1; }
github_repo() { printf '%s' "${1%/}" | sed -n 's#^.*github[^:/]*[:/]\([^/]*/[^/]*\)$#\1#p' | sed 's#\.git$##'; }
# One spelling per repo, so git@github.com:me/R.git, https://github.com/me/R and file:///x/R.git match their twins.
same_repo_key() {
  local u=${1%/}; u=${u#file://}; u=${u%.git}; u=${u%/}
  if is_local_path "$u"; then printf '%s' "$u"; else
    local r; r=$(github_repo "$u"); if [ -n "$r" ]; then printf 'github:%s' "$r" | tr 'A-Z' 'a-z'; else printf '%s' "$u"; fi
  fi
}
same_repo() { [ "$(same_repo_key "$1")" = "$(same_repo_key "$2")" ]; }
# Remotes other than old-public with any push URL (first or later, any spelling) naming the old fork.
remotes_pushing_to() {
  local r p
  for r in $(git remote); do
    [ "$r" = "$OLD" ] && continue
    while IFS= read -r p; do
      if [ -n "$p" ] && same_repo "$p" "$1"; then echo "$r"; break; fi
    done < <(git remote get-url --push --all "$r" 2>/dev/null)
  done
}

swap() {
  local remote=$1 new_url=$2
  git rev-parse --git-dir >/dev/null 2>&1 || die "run this inside your checkout"
  local url; url=$(git remote get-url "$remote" 2>/dev/null) || die "no remote named $remote"
  local old_url first=0
  if git remote get-url "$OLD" >/dev/null 2>&1; then
    old_url=$(git remote get-url "$OLD")
    [ "$url" = "$new_url" ] || die "remote $OLD exists, but $remote is $url, not $new_url"
  else
    first=1 old_url=$url
    [ "$old_url" != "$new_url" ] || die "$remote already points at $new_url and there is no $OLD remote"
    ! names_main_repo "$old_url" ||
      die "$remote is the main repo; pass --remote <your old fork's remote>, or add one first: git remote add origin <old fork url>"
  fi
  ! names_main_repo "$new_url" || die "--new is the main repo; pass your new fork"
  git ls-remote "$new_url" HEAD >/dev/null 2>&1 || die "cannot read the new fork at $new_url; run prepare first"
  if ! is_local_path "$new_url"; then
    local gh_repo; gh_repo=$(github_repo "$new_url")
    [ -n "$gh_repo" ] || die "cannot read owner/repo from $new_url; pass https://github.com/<login>/$NEW_NAME.git"
    is_private_fork "$gh_repo" || die "$gh_repo is not a private fork of $MAIN_REPO"
  fi

  if git ls-remote "$old_url" HEAD >/dev/null 2>&1; then
    if [ "$apply" = 1 ]; then
      git fetch --quiet --no-prune "$old_url" "+refs/heads/*:refs/remotes/$OLD/*" || die "cannot fetch $old_url"
    else
      echo "the old fork has these branches: $(git ls-remote --heads "$old_url" | sed 's#.*refs/heads/##' | tr '\n' ' ')"
    fi
  elif [ "$first" = 1 ] && [ -n "$(git for-each-ref "refs/remotes/$remote")" ]; then
    echo "warning: cannot read the old fork at $old_url; using this checkout's last copy of its branches"
    local ref
    git for-each-ref --format='%(refname:lstrip=3)' "refs/remotes/$remote" | while read -r ref; do
      [ "$ref" = HEAD ] || run git update-ref "refs/remotes/$OLD/$ref" "refs/remotes/$remote/$ref"
    done
  elif [ "$first" = 1 ]; then
    die "cannot read the old fork at $old_url and this checkout has no copy of its branches"
  fi

  git remote get-url "$OLD" >/dev/null 2>&1 || run git remote add "$OLD" "$old_url"
  run git config "remote.$OLD.fetch" "+refs/heads/*:refs/remotes/$OLD/*"
  run git remote set-url --push "$OLD" "$BLOCKED_PUSH_URL"
  [ "$url" = "$new_url" ] || run git remote set-url "$remote" "$new_url"
  git config --get-all "remote.$remote.pushurl" >/dev/null && run git config --unset-all "remote.$remote.pushurl"
  if [ "$apply" = 1 ] && [ "$(git remote get-url --push "$remote")" != "$new_url" ]; then
    die "$remote still pushes to $(git remote get-url --push "$remote"); fix it before pushing"
  fi
  local r p
  for r in $(remotes_pushing_to "$old_url"); do
    [ "$r" = "$remote" ] && continue
    local pushurls; pushurls=$(git remote get-url --push --all "$r" | while IFS= read -r p; do
      if same_repo "$p" "$old_url"; then echo "$new_url"; else echo "$p"; fi
    done | awk '!seen[$0]++')
    git config --get-all "remote.$r.pushurl" >/dev/null && run git config --unset-all "remote.$r.pushurl"
    while IFS= read -r p; do run git config --add "remote.$r.pushurl" "$p"; done <<<"$pushurls"
  done
  if [ "$apply" = 1 ]; then
    r=$(remotes_pushing_to "$old_url" | tr '\n' ' ')
    [ -z "$r" ] || die "remote(s) $r still push to the old fork $old_url; fix them before pushing"
  fi
  if ! names_main_repo "$(git remote -v)"; then
    if git remote get-url upstream >/dev/null 2>&1; then die "remote upstream exists but is not $MAIN_REPO"; fi
    run git remote add upstream "$UPSTREAM_URL"
  fi

  try git push --quiet "$remote" 'refs/heads/*:refs/heads/*'
  local b old_sha mine
  while read -r b old_sha; do
    [ "$b" = HEAD ] && continue
    mine=$(git rev-parse --verify --quiet "refs/heads/$b")
    if [ -z "$mine" ] || { [ "$mine" != "$old_sha" ] && git merge-base --is-ancestor "$mine" "$old_sha"; }; then
      try git push --quiet "$remote" "refs/remotes/$OLD/$b:refs/heads/$b"
    fi
  done < <(git for-each-ref --format='%(refname:lstrip=3) %(objectname)' "refs/remotes/$OLD")

  [ "$apply" = 1 ] || { echo "dry run: nothing changed. Add --apply to do it."; return 0; }
  verify "$remote"
}

verify() {
  local remote=$1 fails=0 b sha theirs heads
  heads=$(git ls-remote --heads "$remote") || die "cannot read the new fork"
  git fetch --quiet --no-prune "$remote" "+refs/heads/*:refs/remotes/$remote/*" || die "cannot fetch the new fork"
  while read -r b sha; do
    theirs=$(printf '%s\n' "$heads" | awk -v r="refs/heads/$b" '$2 == r { print $1 }')
    if [ -z "$theirs" ]; then echo "FAIL  $b: not on the new fork"; fails=$((fails + 1))
    elif [ "$theirs" = "$sha" ]; then echo "PASS  $b"
    elif git merge-base --is-ancestor "$sha" "$theirs"; then echo "PASS  $b (the new fork is ahead)"
    else echo "FAIL  $b: the new fork has other commits; push it by hand after a look"; fails=$((fails + 1)); fi
  done < <(git for-each-ref --format='%(refname) %(objectname)' refs/heads "refs/remotes/$OLD" |
    sed -e 's#^refs/heads/##' -e "s#^refs/remotes/$OLD/##" | grep -v '^HEAD ' | sort -u)
  echo "$fails failed"
  [ "$fails" -eq 0 ]
}

cmd=${1:-}; shift || true
case "$cmd" in
  prepare)
    login=${1:-}; [ -n "$login" ] || die "usage: prepare <github-login> [--apply]"; shift
    [ "${1:-}" = --apply ] && apply=1
    prepare "$login" ;;
  swap)
    remote=origin new_url=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --apply) apply=1; shift ;;
        --remote) remote=$2; shift 2 ;;
        --new) new_url=$2; shift 2 ;;
        *) die "unknown argument: $1" ;;
      esac
    done
    [ -n "$new_url" ] || die "usage: swap --new <new-fork-url> [--remote <name>] [--apply]"
    swap "$remote" "$new_url" ;;
  *) die "usage: fork_swap.sh prepare <github-login> [--apply] | swap --new <new-fork-url> [--apply]" ;;
esac
