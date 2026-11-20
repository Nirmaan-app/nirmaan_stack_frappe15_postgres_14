#!/bin/bash
# Tests that task.sh start takes a start point only when it holds GitHub's develop (equal or ahead starts, behind or
# diverged STOPs), warns about uncommitted changes, STOPs with no org remote, and that the box's own check refuses a
# branch whose tip lacks the develop it reads, leaving nothing made on either side.
# A temp laptop repo, bare repos as GitHub (the org repo and a fork, by path), one stub box whose ssh and scp run the
# box side locally. No network, no real box, nothing outside a fresh folder under $TMPDIR, which each run leaves in place.
# Run: /bin/bash scripts/devenv/test_task_start_point.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
T="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/test_task_start_point.XXXXXX")" && pwd -P)"
echo "scratch: $T"
OUT="" RC=0 N=0
fail() { echo "FAIL  $1"; echo "----- output (exit $RC):"; echo "$OUT"; exit 1; }
pass() { N=$((N + 1)); echo "ok    $1"; }
run() { RC=0; OUT="$("$@" 2>&1)" || RC=$?; }
rc_is() { [ "$RC" = "$1" ] || fail "$2 (exit $RC, want $1)"; pass "$2"; }
has() { case "$OUT" in *"$1"*) pass "$2" ;; *) fail "$2 (output lacks: $1)" ;; esac; }
lacks() { case "$OUT" in *"$1"*) fail "$2 (output has: $1)" ;; *) pass "$2" ;; esac; }
same() { [ "$1" = "$2" ] || fail "$3 (got '$1', want '$2')"; pass "$3"; }

mkdir -p "$T/bin"
ln -s /bin/bash "$T/bin/bash"
cat > "$T/bin/ssh" <<'EOF'
#!/bin/bash
echo "ssh $*" >> "$SSH_LOG"
while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -t|-q) shift ;; *) break ;; esac; done
home="$STUB_BOXES/$1"; shift
mkdir -p "$home"; cd "$home" && HOME="$home" exec bash -c "$*"
EOF
cat > "$T/bin/scp" <<'EOF'
#!/bin/bash
args=(); while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -q) shift ;; *) args+=("$1"); shift ;; esac; done
at() { case "$1" in *@*:*) p="${1#*:}"; echo "$STUB_BOXES/${1%%:*}/${p#\~/}" ;; *) echo "$1" ;; esac; }
cp "$(at "${args[0]}")" "$(at "${args[1]}")"
EOF
chmod +x "$T/bin/ssh" "$T/bin/scp"
export PATH="$T/bin:$PATH" STUB_BOXES="$T/boxes" SSH_LOG="$T/ssh.log" XDG_STATE_HOME="$T/state"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

R="$T/boxes.conf"; export DEVBOX_REGISTRY="$R"
git config -f "$R" box.box.ssh me@box-test
git config -f "$R" box.box.checkout work/co

L="$T/laptop"; mkdir -p "$L/scripts/devenv"
cp "$HERE/boxes.sh" "$HERE/task.sh" "$HERE/handoff.sh" "$HERE/landed.sh" "$HERE/develop.sh" "$L/scripts/devenv/"
cat > "$L/scripts/devenv/devenv.sh" <<'EOF'
#!/bin/bash
set -e
wt="$(cd ../.. && pwd)/benches/$2/apps/nirmaan_stack"
case "$1" in create) git worktree add -q "$wt" "$4"; echo "Ready $2" ;; esac
EOF
printf 'import sys\nprint("ok    test dod", sys.argv[1])\n' > "$L/scripts/devenv/dod.py"
chmod +x "$L/scripts/devenv/devenv.sh"
git -C "$L" init -q -b master
git -C "$L" config core.hooksPath "$T/no-hooks"
git -C "$L" add -A; git -C "$L" commit -q --no-verify -m base
BASE="$(git -C "$L" rev-parse HEAD)"

# GitHub: the org repo, and a fork whose develop is elsewhere, as bare repos that github.com URLs are rewritten to
# (url.<path>.insteadOf). The laptop lists the fork first, as origin.
GH="$T/gh/Nirmaan-app/nirmaan_stack_frappe15_postgres_14.git"; FORK="$T/gh/someone/nirmaan_stack_frappe15_postgres_14.git"
GH_URL="https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14.git"
GH_SSH="git@github.com:Nirmaan-app/nirmaan_stack_frappe15_postgres_14.git"
git init -q --bare "$GH"; git init -q --bare "$FORK"
git -C "$GH" fetch -q "$L" master:develop
git -C "$L" commit -q --allow-empty -m fork-only; git -C "$FORK" fetch -q "$L" master:develop; git -C "$L" reset -q --hard "$BASE"
git -C "$L" remote add origin https://github.com/someone/nirmaan_stack_frappe15_postgres_14.git
git -C "$L" config url."$FORK".insteadOf https://github.com/someone/nirmaan_stack_frappe15_postgres_14.git
git -C "$L" remote add upstream "$GH_URL"; git -C "$L" config url."$GH".insteadOf "$GH_URL"
# develop moves on GitHub with a commit the laptop has not fetched
gh_advance() { local w="$T/gh-work"; [ -d "$w" ] || git clone -q -b develop "$GH" "$w"; git -C "$w" commit -q --allow-empty -m "$1"; git -C "$GH" fetch -q "$w" develop:develop; }

BOX="$T/boxes/me@box-test/work/co"
git clone -q "$L" "$BOX"; git -C "$BOX" remote set-url origin "$GH_SSH"; git -C "$BOX" config url."$GH".insteadOf "$GH_SSH"
mkdir -p "$T/boxes/me@box-test/.claude"
wt() { echo "$(cd "$T/boxes/me@box-test" && pwd -P)/benches/$1/apps/nirmaan_stack"; }

start() { : > "$SSH_LOG"; run /bin/bash "$L/scripts/devenv/task.sh" start "$@"; }
made_nothing() {
  ! git -C "$L" rev-parse -q --verify "refs/heads/box/$1" >/dev/null || fail "$2: no laptop branch box/$1"
  [ -z "$(git -C "$L" config "devbox-task.$1.box" || true)" ] || fail "$2: no task record"
  ! git -C "$BOX" rev-parse -q --verify "refs/heads/box/$1" >/dev/null || fail "$2: no box branch box/$1"
  [ -z "$(git -C "$BOX" for-each-ref refs/handoff)" ] || fail "$2: no refs/handoff left on the box"
  [ ! -d "$(wt "$1")" ] || fail "$2: no env on the box"
  pass "$2: nothing made on either side"
}

start t-eq --box box --no-agent
rc_is 0 "equal: the checkout's HEAD is develop's tip, start goes ahead"
has "ok    start point, HEAD of $L: ${BASE:0:9} is develop's tip on GitHub" "equal: says the start point is develop"
same "$(git -C "$BOX" rev-parse box/t-eq)" "$BASE" "equal: the box got the branch at develop"
has "Ready t-eq" "equal: the env was made"

git -C "$L" commit -q --allow-empty -m a1; A1="$(git -C "$L" rev-parse HEAD)"
start t-ahead --box box --no-agent
rc_is 0 "ahead: start goes ahead"
has "holds develop (${BASE:0:9} on GitHub) and 1 commits of its own, which go too" "ahead: names the commits that go too"
same "$(git -C "$BOX" rev-parse box/t-ahead)" "$A1" "ahead: the box got the developer's own commit"

start t-from --box box --no-agent --from "$BASE"
rc_is 0 "--from picks the start point"
has "start point, --from $BASE:" "--from is named as the start point"
same "$(git -C "$L" rev-parse box/t-from)" "$BASE" "--from: the branch is made from it, not from HEAD"

gh_advance d2; D2="$(git -C "$GH" rev-parse develop)"
start t-unf --box box --no-agent --from "$BASE"
rc_is 1 "behind, develop not fetched: STOP"
has "lacks develop's newest commits (develop is ${D2:0:9} on GitHub). Pull develop and update the branch first: git fetch upstream develop" "behind: says to pull develop from the org remote"
[ ! -s "$SSH_LOG" ] || fail "behind: never reaches the box"; pass "behind: never reaches the box"
made_nothing t-unf "behind, not fetched"

git -C "$L" fetch -q upstream
start t-behind --box box --no-agent --from "$BASE"
rc_is 1 "behind, develop fetched: STOP"; has "Pull develop and update the branch first" "behind (fetched): says to pull develop"
made_nothing t-behind "behind, fetched"

start t-div --box box --no-agent
rc_is 1 "diverged: HEAD has its own commit and lacks develop's newest: STOP"
has "${A1:0:9} has commits of its own but lacks develop's newest (develop is ${D2:0:9} on GitHub). Merge or rebase it onto develop first" "diverged: says to merge or rebase"
made_nothing t-div "diverged"

git -C "$L" merge -q --no-edit upstream/develop
echo "# edit" >> "$L/scripts/devenv/dod.py"
start t-dirty --box box --no-agent
rc_is 0 "uncommitted changes do not stop start"
has "WARN  $L has uncommitted changes: only commits go to the box" "uncommitted changes WARN"
start t-dirty2 --box box --no-agent --from "$D2"
lacks "uncommitted changes" "no WARN when the start point is not the checkout's HEAD"
git -C "$L" checkout -q -- scripts/devenv/dod.py

start t-eq --box box --no-agent
rc_is 1 "a rerun checks the branch it already made, which now lacks develop"
has "start point, the existing box/t-eq (an earlier start made it; another name starts afresh): ${BASE:0:9} lacks develop's newest" "a rerun names the existing branch and how to start afresh"
start t-eq --box box --no-agent --from "$D2"
rc_is 1 "a rerun with a --from other than the existing branch STOPs"
has "box/t-eq already exists at ${BASE:0:9}, not at --from $D2: start under another name" "it says the --from is not used"

git -C "$L" remote set-url upstream "$T/mirror/Nirmaan-app/nirmaan_stack_frappe15_postgres_14.git"
start t-noorg --box box --no-agent
rc_is 1 "no remote points at github.com's org repo (a mirror by path does not count): STOP"
has "points at the org repo Nirmaan-app/nirmaan_stack_frappe15_postgres_14, so develop cannot be checked. Add one: git remote add upstream" "no org remote: says how to add one"
made_nothing t-noorg "no org remote"
git -C "$L" config devbox.org-repo "$T/gh/missing.git"
start t-cfg --box box --no-agent
rc_is 1 "develop that cannot be read: STOP"
has "could not read develop from $T/gh/missing.git (git ls-remote $T/gh/missing.git refs/heads/develop): fatal:" "it shows git's own reason"
made_nothing t-cfg "develop unreadable"
git -C "$L" config devbox.org-repo "$GH"
start t-cfg --box box --no-agent
rc_is 0 "git config devbox.org-repo names the org repo when no remote does"
git -C "$L" config --unset devbox.org-repo; git -C "$L" remote set-url upstream "$GH_URL"

# The box reads develop itself: a box whose origin's develop has moved past the laptop's view refuses the branch.
OTHER="$T/gh2/Nirmaan-app/nirmaan_stack_frappe15_postgres_14.git"; git clone -q --bare "$GH" "$OTHER"
git -C "$T/gh-work" commit -q --allow-empty -m d3; git -C "$OTHER" fetch -q "$T/gh-work" develop:develop
git -C "$BOX" config url."$OTHER".insteadOf "$GH_SSH"; git -C "$BOX" config --unset url."$GH".insteadOf
git -C "$L" commit -q --allow-empty -m race   # a tip the box lacks, so it arrives in a bundle
start t-race --box box --no-agent
rc_is 1 "box: a tip lacking the develop the box reads is refused"
has "STOP  the box refuses box/t-race:" "box: the refusal is the box's"
has "lacks develop's newest commits (develop is $(git -C "$OTHER" rev-parse --short=9 develop) on GitHub)" "box: names the develop it read"
has "this start took back box/t-race and its record" "box refusal: start says it took back what it made"
made_nothing t-race "box refusal"
git -C "$L" branch box/t-keep; git -C "$L" config devbox-task.t-keep.box box   # left by a start that lost the box
start t-keep --box box --no-agent
rc_is 1 "box: a rerun's existing branch is refused the same way"
has "box/t-keep and its record were there before this start, so they stay" "box refusal on a rerun keeps what was there"
same "$(git -C "$L" rev-parse -q --verify box/t-keep || true) $(git -C "$L" config devbox-task.t-keep.box || true)" "$(git -C "$L" rev-parse HEAD) box" "the earlier branch and record stay"
[ -z "$(git -C "$BOX" for-each-ref refs/handoff refs/heads/box/t-keep)" ] || fail "the box keeps no ref of the refused rerun"
pass "the box keeps no ref of the refused rerun"
git -C "$BOX" remote set-url origin "$T/gh/elsewhere.git"
start t-race --box box --no-agent
rc_is 1 "box: no org remote on the box refuses"; has "STOP  the box refuses box/t-race: no remote of " "box: the box names its checkout"; has "points at the org repo" "box: says the box lacks the org remote"
made_nothing t-race "box without an org remote"
git -C "$BOX" remote set-url origin "$GH_SSH"; git -C "$BOX" config --unset url."$OTHER".insteadOf
git -C "$BOX" config url."$GH".insteadOf "$GH_SSH"
start t-race --box box --no-agent
rc_is 0 "the same start, run again once the box agrees, goes ahead"
same "$(git -C "$BOX" rev-parse box/t-race)" "$(git -C "$L" rev-parse HEAD)" "the rerun handed the branch over"

run /bin/bash "$L/scripts/devenv/handoff.sh" to box box/t-race --other
rc_is 1 "handoff.sh refuses an unknown option"; has "usage: handoff.sh to <box> <branch> [--contains-develop]" "the usage names --contains-develop"

echo "PASS  $N checks"
