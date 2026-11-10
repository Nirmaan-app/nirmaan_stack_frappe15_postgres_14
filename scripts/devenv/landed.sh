# landed <sha> [--ancestry-only]: print the first ref that already holds the work of commit <sha>, in the repo git
# runs in, and return 0; return 1 when none does. Sourced (never run) by devenv.sh and task.sh; bash 3.2 safe.
#
# A ref holds the work when <sha> is its ancestor (a merge or a fast-forward), or, unless --ancestry-only, when every
# commit <sha> adds has an equal patch in the ref (`git cherry` prints no + line: a cherry-pick or a rebase merge).
# A squash of several commits into one is not recognised, so such a branch stays not landed. Only refs as of the
# last fetch count; nothing here fetches. A commit this repo does not have is not landed.
#
# The refs, in order. The fork base differs per branch: on 2026-11-10 fix/claude-review-error-text was in
# upstream/develop but not in master.
LANDED_REFS="refs/heads/master refs/remotes/upstream/develop refs/remotes/upstream/main refs/remotes/origin/develop refs/remotes/origin/main"

landed() {
  local sha="$1" mode="${2:-}" ref refs="" out
  git cat-file -e "$sha^{commit}" 2>/dev/null || return 1
  for ref in $LANDED_REFS; do git rev-parse -q --verify "$ref^{commit}" >/dev/null && refs="$refs $ref"; done
  # Every ref by ancestry first: it is cheap, and `git cherry` against a far-off ref takes up to half a second
  # (measured 2026-11-10: a branch 2,985 commits behind master).
  for ref in $refs; do
    git merge-base --is-ancestor "$sha" "$ref" && { landed_name "$ref"; return 0; }
  done
  [ "$mode" != --ancestry-only ] || return 1
  for ref in $refs; do
    out="$(git cherry "$ref" "$sha" 2>/dev/null)" || continue
    case $'\n'"$out" in *$'\n+'*) ;; *) landed_name "$ref"; return 0 ;; esac
  done
  return 1
}

landed_name() { local r="${1#refs/heads/}"; echo "${r#refs/remotes/}"; }
