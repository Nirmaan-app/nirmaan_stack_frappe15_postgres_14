#!/usr/bin/env bash
# Tests scripts/fork_swap.sh against local bare repos standing in for GitHub, and a fake `gh`. No network.
# Usage: bash scripts/test_fork_swap.sh   (FORK_SWAP_TEST_DIR picks the work folder; it is left in place)
set -uo pipefail

SWAP="$(cd "$(dirname "$0")" && pwd)/fork_swap.sh"
T=${FORK_SWAP_TEST_DIR:-$(mktemp -d)}
R=nirmaan_stack_frappe15_postgres_14
fails=0
ok() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fails=$((fails + 1)); fi; }
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=main "$@"; }
sha() { git --git-dir="$1" rev-parse --verify --quiet "refs/heads/$2"; }
swap() { FORK_SWAP_UPSTREAM_URL="$T/Nirmaan-app/$R.git" bash "$SWAP" swap "$@" 2>&1; }
says() { printf '%s\n' "$out" | grep -qx "$1"; }
refuse_branch() { printf '#!/bin/sh\n[ "$1" = "refs/heads/%s" ] && exit 1\nexit 0\n' "$2" > "$1/hooks/update"; chmod +x "$1/hooks/update"; }

mkdir -p "$T/Nirmaan-app" "$T/dev" && cd "$T" || exit 2
OLDF="$T/dev/$R.git" NEW="$T/dev/$R-private.git"
g init -q seed && (cd seed && g commit -q --allow-empty -m base)
g clone -q --bare seed "Nirmaan-app/$R.git"
g clone -q --bare seed "$OLDF"

g clone -q "$OLDF" work && cd work
g switch -q -c feat-a && g commit -q --allow-empty -m "feat-a on the old fork" && g push -q origin feat-a
g switch -q --detach && g commit -q --allow-empty -m "only on the old fork" && g push -q origin HEAD:refs/heads/old-only
g switch -q -c behind feat-a && g push -q origin behind
g commit -q --allow-empty -m "behind is newer on the old fork" && g push -q origin behind && g reset -q --hard HEAD~1
g switch -q feat-a && g commit -q --allow-empty -m "feat-a, local and not pushed"
g switch -q -c local-only && g commit -q --allow-empty -m "local only"
g switch -q -c refused && g commit -q --allow-empty -m "the new fork refuses this branch"
git update-ref refs/remotes/origin/refused "$(git rev-parse refused)"
git config remote.origin.pushurl "$OLDF"
git remote add upstream "$T/Nirmaan-app/$R.git" && git remote set-url --push upstream "$OLDF"
cd ..

g clone -q --bare "Nirmaan-app/$R.git" "$NEW"
g clone -q "$NEW" ahead && (cd ahead && g commit -q --allow-empty -m "newer main on the new fork" && g push -q origin main)
refuse_branch "$NEW" refused
new_refs() { git --git-dir="$NEW" for-each-ref; }
old_refs_before=$(git --git-dir="$OLDF" for-each-ref)

cd work
before=$(new_refs)
out=$(swap --new "$NEW")
ok "a dry run says what it would push" '[[ "$out" == *"would run: git push"* ]]'
ok "a dry run lists the old fork's branches" '[[ "$out" == *"the old fork has these branches:"*"old-only"* ]]'
ok "a dry run pushes nothing" '[ "$(new_refs)" = "$before" ]'
ok "a dry run adds no remote and keeps origin" '! git remote get-url old-public >/dev/null 2>&1 && [ "$(git remote get-url origin)" = "$OLDF" ]'

out=$(swap --new "$NEW" --apply); rc=$?
echo "$out" | sed 's/^/      /'
ok "the local-only branch is on the new fork" '[ "$(sha "$NEW" local-only)" = "$(git rev-parse local-only)" ]'
ok "feat-a's unpushed commit is on the new fork" '[ "$(sha "$NEW" feat-a)" = "$(git rev-parse feat-a)" ]'
ok "the branch found only on the old fork is on the new fork, same commit" '[ "$(sha "$NEW" old-only)" = "$(sha "$OLDF" old-only)" ]'
ok "a branch newer on the old fork than locally arrives at the old fork's commit" '[ "$(sha "$NEW" behind)" = "$(sha "$OLDF" behind)" ]'
ok "the new fork's newer main is kept" '[[ "$(git --git-dir="$NEW" log -1 --format=%s main)" == "newer main on the new fork" ]]'
ok "a branch the new fork refused fails the check, despite a stale tracking ref" \
  '[ $rc -ne 0 ] && says "FAIL  refused: not on the new fork"'
ok "exactly one branch fails" 'says "1 failed"'
ok "origin now fetches from and pushes to the new fork" \
  '[ "$(git remote get-url origin)" = "$NEW" ] && [ "$(git remote get-url --push origin)" = "$NEW" ]'
ok "an org remote that pushed to the old fork (join.sh's setup) now pushes to the new fork and still fetches the org repo" \
  '[ "$(git remote get-url --push upstream)" = "$NEW" ] && [ "$(git remote get-url upstream)" = "$T/Nirmaan-app/$R.git" ]'
ok "pushes to the old fork go to a dead URL" '[ "$(git remote get-url --push old-public)" = "no-push://the-old-public-fork-is-retired" ]'
ok "the old fork is untouched, though origin had a push URL pointing at it" '[ "$(git --git-dir="$OLDF" for-each-ref)" = "$old_refs_before" ]'

refuse_branch "$NEW" nothing
out=$(swap --new "$NEW" --apply); rc=$?
ok "a second run pushes what failed before and passes" '[ $rc -eq 0 ] && says "0 failed"'
before=$(new_refs)
out=$(swap --new "$NEW" --apply); rc=$?
ok "a third run changes nothing on the new fork and passes" '[ $rc -eq 0 ] && [ "$(new_refs)" = "$before" ]'

g switch -q -c diverged feat-a~1 && g commit -q --allow-empty -m "rewritten"
git --git-dir="$NEW" update-ref refs/heads/diverged "$(git rev-parse feat-a)"
out=$(swap --new "$NEW" --apply); rc=$?
ok "a branch the new fork holds with other commits is reported, not overwritten" \
  '[ $rc -ne 0 ] && says "FAIL  diverged: the new fork has other commits; push it by hand after a look" && [ "$(sha "$NEW" diverged)" = "$(git rev-parse feat-a)" ]'
cd ..

g clone -q "$OLDF" gone && cd gone
NEW2="$T/dev/second-private.git" && g clone -q --bare "$T/Nirmaan-app/$R.git" "$NEW2"
git remote set-url origin "$T/dev/deleted.git"
out=$(swap --new "$NEW2" --apply); rc=$?
ok "an unreadable old fork falls back to the checkout's copy of its branches" \
  '[ $rc -eq 0 ] && [[ "$out" == *"using this checkout'"'"'s last copy"* ]] && [ "$(sha "$NEW2" old-only)" = "$(sha "$OLDF" old-only)" ]'
ok "a checkout with no org remote gets one as upstream" '[ "$(git remote get-url upstream)" = "$T/Nirmaan-app/$R.git" ]'
cd ..

g init -q bare-checkout && cd bare-checkout && git remote add origin "$T/dev/deleted.git"
out=$(swap --new "$NEW2" --apply); rc=$?
ok "an unreadable old fork with no copy in the checkout refuses" '[ $rc -eq 2 ] && [[ "$out" == *"has no copy of its branches"* ]]'
cd ..

g clone -q "$OLDF" fresh && cd fresh
out=$(swap --new "$T/dev/missing.git" --apply); rc=$?
ok "a swap before prepare refuses" '[ $rc -eq 2 ] && [[ "$out" == *"run prepare first"* ]]'
out=$(swap --new "$T/Nirmaan-app/$R.git" --apply); rc=$?
ok "a swap onto the main repo refuses" '[ $rc -eq 2 ] && [[ "$out" == *"is the main repo"* ]]'
cd ..

mkdir -p bin
cat > bin/gh <<'EOF'
#!/bin/sh
case "$*" in
  "api user -q .login") echo dev1 ;;
  "api repos/Nirmaan-app/$R") ;;
  "api repos/Nirmaan-app/$R -q .private") echo true ;;
  "api repos/Nirmaan-app/$R -q .allow_forking") echo true ;;
  "api repos/dev1/$R -q .parent.full_name") echo "$OLD_PARENT" ;;
  "api repos/dev1/$R -q .private") echo false ;;
  "api repos/dev1/$R-private") [ -f "$T/forked" ] || exit 1 ;;
  "api repos/dev1/$R-private -q .parent.full_name") [ -f "$T/forked" ] && echo "$FAKE_PARENT" ;;
  "api repos/dev1/$R-private -q .private") [ -f "$T/forked" ] && echo "$FAKE_PRIVATE" ;;
  "repo fork Nirmaan-app/$R --clone=false --remote=false --fork-name $R-private") touch "$T/forked" ;;
  *) echo "fake gh: unexpected: $*" >&2; exit 1 ;;
esac
EOF
chmod +x bin/gh
prep() {
  PATH="$T/bin:$PATH" T="$T" R="$R" FORK_SWAP_POLL_SECONDS=0 OLD_PARENT="${OLD_PARENT:-}" \
    FAKE_PARENT="$1" FAKE_PRIVATE="$2" bash "$SWAP" prepare dev1 --apply 2>&1
}
out=$(OLD_PARENT="Nirmaan-app/$R" prep "Nirmaan-app/$R" true); rc=$?
ok "prepare refuses while the old fork is still attached to the main repo" '[ $rc -eq 2 ] && [[ "$out" == *"still attached"* ]] && [ ! -f "$T/forked" ]'
out=$(prep "someone/$R" true); rc=$?
ok "prepare fails when GitHub's new repo is not a fork of the main repo" '[ $rc -eq 2 ] && [[ "$out" == *"did not create dev1/$R-private as a private fork"* ]]'
out=$(prep "Nirmaan-app/$R" false); rc=$?
ok "prepare fails when the fork is public" '[ $rc -eq 2 ] && [[ "$out" == *"is not a private fork"* ]]'
out=$(prep "Nirmaan-app/$R" true); rc=$?
ok "prepare accepts a private fork, warns about the old public one, and prints the swap command" \
  '[ $rc -eq 0 ] && [[ "$out" == *"gh repo delete dev1/$R"* ]] && [[ "$out" == *"swap --new https://github.com/dev1/$R-private.git --apply"* ]]'

echo "$fails failed (work folder: $T)"
[ "$fails" -eq 0 ]
