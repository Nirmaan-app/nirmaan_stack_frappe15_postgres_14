# A task's start point against GitHub's develop. Sourced (never run) by task.sh on the laptop, and sent to a box ahead of
# handoff.sh, so both sides judge a start point by the same rule. The caller defines die. bash 3.2 safe.
#
# develop is always the org repo's, never a fork's or a mirror's: git config devbox.org-repo <url> when set, else the
# first remote whose URL is github.com's org repo (on the owner's laptop upstream, on a box origin). Its tip is read
# with git ls-remote, which writes nothing: a local upstream/develop may be stale.
#
# The start point against develop's tip, and what task.sh start does about it (start_point_verdict):
#   equal     start
#   ahead     start; the start point holds develop and adds commits of its own, which go to the box
#   behind    refuse: pull develop and update the branch first. A develop commit this repo lacks cannot be in the start
#             point, so it is behind too (a fetch shows the rest)
#   diverged  refuse: merge or rebase onto develop first

ORG_REPO_PATH="Nirmaan-app/nirmaan_stack_frappe15_postgres_14"

# org_repo: set ORG_REPO to the remote name (or the devbox.org-repo URL) develop is read from. Returns 1 when none.
org_repo() {
  ORG_REPO="$(git config devbox.org-repo || true)"
  [ -n "$ORG_REPO" ] && return 0
  ORG_REPO="$(git config --get-regexp '^remote\..*\.url$' | awk -v p="$(echo "$ORG_REPO_PATH" | tr A-Z a-z)" '
    tolower($2) ~ ("github\\.com[/:]" p "(\\.git)?/?$") {sub(/^remote\./, "", $1); sub(/\.url$/, "", $1); print $1; exit}' || true)"
  [ -n "$ORG_REPO" ]
}

# develop_tip: print the commit develop is at on GitHub now, or STOP.
develop_tip() {
  local out d
  org_repo || die "no remote of $(git rev-parse --show-toplevel) points at the org repo $ORG_REPO_PATH, so develop cannot be checked. Add one: git remote add upstream https://github.com/$ORG_REPO_PATH.git (or set git config devbox.org-repo <url>)"
  out="$(git ls-remote "$ORG_REPO" refs/heads/develop 2>&1 || true)"
  d="$(printf '%s\n' "$out" | awk '$2 == "refs/heads/develop" {print $1; exit}')"
  [ -n "$d" ] || die "could not read develop from $ORG_REPO (git ls-remote $ORG_REPO refs/heads/develop): $(printf '%s' "$out" | tr '\n' ' ')"
  echo "$d"
}

# start_vs_develop <start commit> <develop commit>: equal | ahead | behind | diverged (the table in the header).
start_vs_develop() {
  if [ "$1" = "$2" ]; then echo equal
  elif ! git cat-file -e "$2^{commit}" 2>/dev/null; then echo behind
  elif git merge-base --is-ancestor "$2" "$1"; then echo ahead
  elif git merge-base --is-ancestor "$1" "$2"; then echo behind
  else echo diverged; fi
}

# develop_fix: the commands that pull develop into the branch here, from this repo's own org remote (never a fork).
develop_fix() {
  org_repo || ORG_REPO="<the org remote>"
  echo "git fetch $ORG_REPO develop, then git merge FETCH_HEAD (or git rebase FETCH_HEAD)"
}

# start_point_verdict <class> <start commit> <develop commit> [--no-fix]: print what start does; return 1 when it
# refuses. A refusal ends with develop_fix's commands; with --no-fix (the box: its remotes are not the laptop's, so
# the laptop adds its own) it ends at the sentence.
start_point_verdict() {
  local fix
  if [ "${4:-}" = --no-fix ]; then fix="."; else fix=": $(develop_fix)"; fi
  case "$1" in
    equal) echo "${2:0:9} is develop's tip on GitHub" ;;
    ahead) echo "${2:0:9} holds develop (${3:0:9} on GitHub) and $(git rev-list --count "$3..$2") commits of its own, which go too" ;;
    behind) echo "${2:0:9} lacks develop's newest commits (develop is ${3:0:9} on GitHub). Pull develop and update the branch first$fix"; return 1 ;;
    diverged) echo "${2:0:9} has commits of its own but lacks develop's newest (develop is ${3:0:9} on GitHub). Merge or rebase it onto develop first$fix"; return 1 ;;
    *) echo "unknown start point class '$1'"; return 1 ;;
  esac
}
