#!/bin/bash
# Tests devenv.sh prune and landed.sh on a fake dev root (DEVENV_ROOT) holding a real temp git repo with worktrees and
# envs; the post-merge hook on real merges in that repo; task.sh prune and clean's landed check on a temp laptop repo
# and a stub Linux box. Stub docker, ssh, scp, uname, pgrep, readlink and lsof on PATH, and a fake /proc. No network,
# no real env or box, nothing outside a fresh folder under $TMPDIR, which each run leaves in place.
# Run: /bin/bash scripts/devenv/test_prune.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
SRC="$(cd "$HERE/../.." && pwd -P)"
T="$(mktemp -d "${TMPDIR:-/tmp}/test_prune.XXXXXX")"; T="$(cd "$T" && pwd -P)"
echo "scratch: $T"
OUT="" RC=0 N=0 AGENT_PID=""
trap '[ -z "$AGENT_PID" ] || kill "$AGENT_PID" 2>/dev/null || true' EXIT
fail() { echo "FAIL  $1"; echo "----- output (exit $RC):"; echo "$OUT"; exit 1; }
pass() { N=$((N + 1)); echo "ok    $1"; }
run() { RC=0; OUT="$("$@" 2>&1)" || RC=$?; }
rc_is() { [ "$RC" = "$1" ] || fail "$2 (exit $RC, want $1)"; pass "$2"; }
has() { case "$OUT" in *"$1"*) pass "$2" ;; *) fail "$2 (output lacks: $1)" ;; esac; }
line() { echo "$OUT" | grep -qE "$1" || fail "$2 (no line matching $1)"; pass "$2"; }
no_line() { ! echo "$OUT" | grep -qE "$1" || fail "$2 (a line matches $1)"; pass "$2"; }
same() { [ "$1" = "$2" ] || fail "$3 (got '$1', want '$2')"; pass "$3"; }
gone() { [ ! -e "$1" ] || fail "$2 ($1 still exists)"; pass "$2"; }
there() { [ -e "$1" ] || fail "$2 ($1 is missing)"; pass "$2"; }

# ---- stubs. docker plays the container half of devenv.sh destroy; ssh runs a box's side locally with
# $STUB_BOXES/<ssh target> as the box user's home; uname, pgrep and readlink answer from <home>/.stub/ on a box.
mkdir -p "$T/bin" "$T/boxes"
export STUB_LOG="$T/stub.log"; : > "$STUB_LOG"
cat > "$T/bin/docker" <<'EOF'
#!/bin/bash
echo "docker $*" >> "$STUB_LOG"
a=("$@"); cmd="" task=""
for i in "${!a[@]}"; do [ "${a[$i]}" != _in ] || { cmd="${a[$((i + 1))]}"; task="${a[$((i + 2))]:-}"; }; done
if [ "$cmd" = destroy ]; then
  b="$DEVENV_ROOT/benches/$task"
  rm -rf "$b/sites" "$b/logs" "$b/config" "$b/env" "$b/Procfile" "$b/.vite-cache" "$b/tmp" "$b/.migrated-schema"
  find "$b/apps" -maxdepth 1 -type l ! -name nirmaan_stack -exec rm {} +
fi
EOF
cat > "$T/bin/ssh" <<'EOF'
#!/bin/bash
echo "ssh $*" >> "$STUB_LOG"
while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -t|-q) shift ;; *) break ;; esac; done
home="$STUB_BOXES/$1"; shift
[ ! -e "$home/.stub/down" ] || exit 255
mkdir -p "$home"; cd "$home" && HOME="$home" exec bash -c "$*"
EOF
cat > "$T/bin/scp" <<'EOF'
#!/bin/bash
args=(); while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -q) shift ;; *) args+=("$1"); shift ;; esac; done
at() { case "$1" in *@*:*) p="${1#*:}"; echo "$STUB_BOXES/${1%%:*}/${p#\~/}" ;; *) echo "$1" ;; esac; }
cp "$(at "${args[0]}")" "$(at "${args[1]}")"
EOF
cat > "$T/bin/uname" <<'EOF'
#!/bin/bash
[ -z "${STUB_UNAME:-}" ] || { echo "$STUB_UNAME"; exit; }
[ -s "$HOME/.stub/uname" ] && cat "$HOME/.stub/uname" || exec /usr/bin/uname "$@"
EOF
cat > "$T/bin/lsof" <<'EOF'
#!/bin/bash
[ -z "${STUB_LSOF_FAIL:-}" ] || exit 1
exec /usr/sbin/lsof "$@"
EOF
# <home>/.stub/procs: one process per line, "<pid> <comm> <cwd>"
cat > "$T/bin/pgrep" <<'EOF'
#!/bin/bash
[ -f "$HOME/.stub/procs" ] || exec /usr/bin/pgrep "$@"
awk -v re="$1" '$2 ~ re {print $1; f=1} END {exit !f}' "$HOME/.stub/procs"
EOF
cat > "$T/bin/readlink" <<'EOF'
#!/bin/bash
case "$1" in
  /proc/*/cwd) [ -f "$HOME/.stub/procs" ] || exec /usr/bin/readlink "$@"
    p="${1#/proc/}"; awk -v p="${p%/cwd}" '$1 == p {sub(/^[^ ]+ [^ ]+ /, ""); print; f=1} END {exit !f}' "$HOME/.stub/procs" ;;
  *) exec /usr/bin/readlink "$@" ;;
esac
EOF
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" STUB_BOXES="$T/boxes" XDG_STATE_HOME="$T/state"
# Every reflog entry (git dates them by the committer date) is two days old unless a step unsets this.
export GIT_COMMITTER_DATE="@$(( $(date +%s) - 172800 )) +0000"

commit() {   # commit <checkout> <file>: a commit that adds <file>
  echo "$2" > "$1/$2"; git -C "$1" add "$2"; git -C "$1" commit -q --no-verify -m "$2"
}

# ---- a fake dev root, laid out as on the laptop: the repo's main checkout is nirmaan_stack_variants/dev (on
# develop), and nirmaan_stack_variants/master is a linked worktree of it; envs under benches/
D="$T/dev"; DEV="$D/nirmaan_stack_variants/dev"; M="$D/nirmaan_stack_variants/master"; B="$D/benches"
mkdir -p "$DEV/scripts/devenv" "$DEV/.githooks" "$B" "$D/frappe-bench/apps/frappe"
export DEVENV_ROOT="$D"
cp "$HERE/devenv.sh" "$HERE/landed.sh" "$DEV/scripts/devenv/"; cp "$SRC/.githooks/post-merge" "$DEV/.githooks/"
git -C "$DEV" init -q -b master
git -C "$DEV" config user.name test; git -C "$DEV" config user.email test@example.com
git -C "$DEV" config core.hooksPath "$T/no-hooks"
git -C "$DEV" add -A; git -C "$DEV" commit -q --no-verify -m base
git -C "$DEV" checkout -q -b develop; git -C "$DEV" worktree add -q "$M" master
G() { git -C "$M" "$@"; }
G checkout -q -b feat/merged; commit "$M" m1; G checkout -q master; G merge -q --no-ff --no-edit feat/merged
G checkout -q -b feat/picked; commit "$M" p1; commit "$M" p2; G checkout -q master
G checkout -q --detach master; commit "$M" d0
G cherry-pick feat/picked~1 feat/picked >/dev/null; commit "$M" d1
G update-ref refs/remotes/upstream/develop HEAD; G checkout -q master
G checkout -q -b feat/open; commit "$M" o1; G checkout -q master
for b in h-dirty h-locked h-agent h-here h-lab h-gone h-untr h-files h-serve h-broken; do G branch "$b" master; done

WT="$M/.claude/worktrees"
G worktree add -q "$WT/merged" feat/merged
G worktree add -q "$WT/open" feat/open
G worktree add -q "$WT/dirty" h-dirty; echo changed > "$WT/dirty/m1"
G worktree add -q "$WT/locked" h-locked; G worktree lock "$WT/locked"
G worktree add -q "$WT/agent" h-agent; (cd "$WT/agent" && exec sleep 600 >/dev/null 2>&1) & AGENT_PID=$!
G worktree add -q "$WT/here" h-here
G worktree add -q "$D/nirmaan_stack_variants/lab" h-lab
G worktree add -q "$WT/gone" h-gone; rm -rf "$WT/gone"
G worktree add -q "$WT/broken" h-broken; echo "gitdir: $T/nowhere" > "$WT/broken/.git"
env_create() {   # env_create <task> <ref>: the layout `devenv.sh create` leaves
  mkdir -p "$B/$1/apps" "$B/$1/sites" "$B/$1/logs"; touch "$B/$1/.slot"; ln -s ../../../frappe-bench/apps/frappe "$B/$1/apps/frappe"
  G worktree add -q "$B/$1/apps/nirmaan_stack" "$2"
}
env_create e-create feat/picked
G worktree add -q --detach "$WT/up-wt" upstream/develop
mkdir -p "$B/e-up/apps" "$B/e-up/sites"; ln -s ../../../nirmaan_stack_variants/master/.claude/worktrees/up-wt "$B/e-up/apps/nirmaan_stack"
env_create e-untracked h-untr; echo x > "$B/e-untracked/apps/nirmaan_stack/ops_tmp.py"
env_create e-files h-files; mkdir -p "$B/e-files/repro"; echo r > "$B/e-files/repro/report.html"
env_create e-serving h-serve; echo "ports=8001 8081" > "$B/e-serving/.serve"
mkdir -p "$B/master/apps" "$B/master/sites"; ln -s ../../../nirmaan_stack_variants/master "$B/master/apps/nirmaan_stack"
mkdir -p "$B/old"; echo n > "$B/old/notes.txt"
(
  unset GIT_COMMITTER_DATE
  env_create e-new "$(G rev-parse master)"
  G worktree add -q -b h-new "$WT/new" master
  G worktree add -q -b h-young "$WT/young" master; commit "$WT/young" y1; G update-ref refs/remotes/origin/main h-young
)

prune() { RC=0; OUT="$(cd "$WT/here" && bash "$M/scripts/devenv/devenv.sh" prune "$@" 2>&1)" || RC=$?; }

# ---- landed.sh
lnd() { (cd "$M" && . "$M/scripts/devenv/landed.sh" && landed "$1") || echo "-"; }
same "$(lnd feat/merged)" master "landed: a merged branch is in master by ancestry"
same "$(lnd feat/picked)" upstream/develop "landed: cherry-picked commits are in upstream/develop by equal patch"
same "$(lnd upstream/develop)" upstream/develop "landed: a commit only upstream/develop holds names upstream/develop"
same "$(lnd feat/open)" - "landed: an unmerged commit is not landed"
same "$(lnd 0123456789012345678901234567890123456789)" - "landed: a commit the repo lacks is not landed"

# ---- devenv.sh prune, list only
prune
rc_is 0 "prune lists"
line '^PRUNE +env +e-create +benches/e-create/apps/nirmaan_stack +landed:upstream/develop$' "a create env landed by equal patch is PRUNE"
line '^PRUNE +env +e-up +nirmaan_stack_variants/master/.claude/worktrees/up-wt +landed:upstream/develop$' "an up env joins its worktree and is PRUNE"
line '^PRUNE +worktree +feat/merged +.*worktrees/merged +landed:master$' "a merged worktree is PRUNE"
line '^KEEP +worktree +feat/open .*landed:- *$' "an unmerged worktree is KEEP, not landed"
line '^KEEP +worktree +h-dirty .*landed:master +tracked-changes:1$' "a changed tracked file holds"
line '^KEEP +worktree +h-locked .*landed:master +locked$' "a locked worktree holds"
line "^KEEP +worktree +h-agent .*landed:master +agent:sleep/$AGENT_PID\$" "a process working in a worktree holds, named"
line '^KEEP +worktree +h-here .*landed:master +here$' "the caller's cwd holds"
line '^KEEP +worktree +h-lab +nirmaan_stack_variants/lab .*landed:master +shared$' "the lab checkout is shared"
line '^KEEP +worktree +h-gone .*landed:master +missing:git-worktree-prune$' "a worktree whose folder is gone holds"
line '^KEEP +worktree +h-broken .*landed:master +status-failed$' "a worktree git status cannot read holds"
line '^KEEP +env +e-untracked .*landed:master +untracked:1$' "an untracked file holds"
line '^KEEP +env +e-files .*landed:master +bench-files:repro$' "a file in the bench folder holds, named"
line '^KEEP +env +e-serving .*landed:master +serving$' "a serving env holds"
line '^KEEP +env +master +nirmaan_stack_variants/master .* shared' "the master env is shared"
line '^KEEP +env +old +benches/old +landed:- +no-worktree bench-files:notes.txt$' "a bench folder with no worktree holds"
line '^KEEP +worktree +develop +nirmaan_stack_variants/dev .*landed:master +shared$' "the dev checkout, the main worktree, is shared"
line '^KEEP +env +e-new .*landed:master +new:0h$' "a fresh create env, detached at master, holds"
line '^KEEP +worktree +h-new .*landed:master +new:0h$' "a fresh worktree on a branch with no commits holds"
line '^PRUNE +worktree +h-young .*landed:origin/main$' "a fresh worktree whose own commit landed is PRUNE"
no_line 'KEEP +worktree +master' "the master checkout is one row, under its env"
same "$(echo "$OUT" | grep -E '^(PRUNE|KEEP)' | head -3 | cut -c1-5 | sort -u)" PRUNE "PRUNE rows come first"
has "to prune: 2 envs, 2 worktrees (devenv.sh prune --yes removes them; branches stay)" "the total names the envs and worktrees"
same "$(cut -d' ' -f1 "$STUB_LOG" | sort -u | tr '\n' ' ')" "" "listing never calls docker"
there "$WT/merged" "listing removes nothing"

prune --quiet
rc_is 0 "prune --quiet"
same "$(echo "$OUT" | grep -c '^KEEP' || true)" 0 "--quiet prints no KEEP row"
line '^PRUNE +worktree +feat/merged' "--quiet prints the PRUNE rows"
line '^PRUNE +env +e-up ' "--quiet finds work landed in upstream/develop by ancestry"
no_line '^PRUNE +env +e-create ' "--quiet skips the slow equal-patch check"

# A fake Linux /proc: a process in a worktree, then a pid of another user, whose cwd readlink refuses (EACCES)
mkdir -p "$T/proc/4242" "$T/proc/99999"; echo claude > "$T/proc/4242/comm"; ln -s "$WT/agent" "$T/proc/4242/cwd"
chmod 000 "$T/proc/99999"
STUB_UNAME=Linux DEVENV_PROC="$T/proc" prune
chmod 755 "$T/proc/99999"
rc_is 0 "prune on Linux, past a pid it cannot read"
line '^KEEP +worktree +h-agent .*landed:master +agent:claude/4242$' "on Linux a process's /proc cwd holds"
STUB_LSOF_FAIL=1 prune
rc_is 1 "prune stops when the process listing fails"; has "could not list" "the stop says why"; no_line '^PRUNE' "nothing is listed for removal"
STUB_UNAME=Linux DEVENV_PROC="$T/no-proc" prune
rc_is 1 "prune stops when the process listing is empty"

# ---- devenv.sh prune --yes
prune --yes
rc_is 0 "prune --yes"
gone "$B/e-create" "--yes destroys a create env and its folder"
gone "$B/e-up" "--yes destroys an up env"
gone "$WT/up-wt" "--yes removes the up env's worktree"
gone "$WT/merged" "--yes removes a merged worktree"
same "$(G rev-parse -q --verify feat/merged >/dev/null && G rev-parse -q --verify feat/picked >/dev/null && echo kept)" kept "--yes keeps the branches"
there "$WT/open" "--yes leaves a KEEP worktree"; there "$B/e-files/repro/report.html" "--yes leaves the owner's bench files"
there "$WT/dirty/m1" "--yes leaves a worktree with changes"
OUT="$(cat "$STUB_LOG")"
line '^docker exec .* _in destroy e-create$' "the create env went through destroy"
line '^docker exec .* _in destroy e-up$' "the up env went through destroy"
prune --yes
rc_is 0 "a second --yes"
no_line '^PRUNE' "a second run finds nothing to prune"; has "to prune: 0 envs, 0 worktrees" "a second run totals zero"
prune --quiet
rc_is 0 "--quiet with nothing to prune"; same "$OUT" "" "--quiet prints nothing when nothing can go"

# ---- the post-merge hook, on real merges
G config core.hooksPath .githooks
G worktree lock "$WT/here"   # the hook runs from the master checkout, so `here` no longer holds it
merge_in() {   # merge_in <checkout> <commit>, as the owner would (no DEVENV_ROOT)
  RC=0; OUT="$(cd "$1" && env -u DEVENV_ROOT git merge --no-ff --no-edit "$2" 2>&1)" || RC=$?
}
c1="$(G commit-tree -p master -m h1 'master^{tree}')"
merge_in "$M" "$c1"
rc_is 0 "a merge into master with the hook"; no_line 'PRUNE|KEEP|to prune|==' "the hook is silent when nothing can go"
G worktree add -q -b feat/h2 "$WT/h2" master; commit "$WT/h2" h2
G worktree add -q --detach "$WT/first" "$(G rev-list --max-parents=0 master)"
merge_in "$M" feat/h2
rc_is 0 "merging feat/h2 into master"
line '^PRUNE +worktree +feat/h2 .*landed:master$' "after a merge into master the hook lists what it landed"
# git sets GIT_DIR for a hook in a linked worktree; read against master's index, this older worktree looks changed.
line '^PRUNE +worktree +detached .*worktrees/first +landed:master$' "the hook reads each worktree's own status"
no_line '^KEEP' "the hook lists only PRUNE rows"
there "$WT/h2" "the hook removes nothing"
c3="$(G commit-tree -p h-here -m h3 'h-here^{tree}')"
merge_in "$WT/here" "$c3"
rc_is 0 "a merge on another branch"; no_line 'PRUNE' "the hook is silent off master"
if PATH=/usr/bin:/bin command -v docker >/dev/null; then echo "skip  no-docker case: /usr/bin or /bin has docker"
else
  c4="$(G commit-tree -p master -m h4 'master^{tree}')"
  RC=0; OUT="$(cd "$M" && env -u DEVENV_ROOT PATH=/usr/bin:/bin git merge --no-ff --no-edit "$c4" 2>&1)" || RC=$?
  rc_is 0 "a merge without docker"; no_line 'PRUNE' "the hook is silent without docker"
fi
E="$T/elsewhere"; mkdir -p "$E/scripts/devenv" "$E/.githooks"
cp "$HERE/devenv.sh" "$HERE/landed.sh" "$E/scripts/devenv/"; cp "$SRC/.githooks/post-merge" "$E/.githooks/"
git -C "$E" init -q -b master; git -C "$E" config user.name test; git -C "$E" config user.email test@example.com
git -C "$E" config core.hooksPath .githooks; git -C "$E" add -A; git -C "$E" commit -q --no-verify -m base
c5="$(git -C "$E" commit-tree -p master -m h5 'master^{tree}')"
merge_in "$E" "$c5"
rc_is 0 "a merge in a checkout with no dev root"; same "$(echo "$OUT" | grep -cvE '^(Merge made|$)' || true)" 0 "the hook is silent with no dev root"

# ---- task.sh prune and clean, on a temp laptop repo and a stub Linux box
R="$T/boxes.conf"; export DEVBOX_REGISTRY="$R"
git config -f "$R" devbox.default contabo
git config -f "$R" box.contabo.ssh t@contabo-test
git config -f "$R" box.contabo.checkout work/x/variants/master
L="$T/laptop"; mkdir -p "$L/scripts/devenv"
cp "$HERE/boxes.sh" "$HERE/task.sh" "$HERE/handoff.sh" "$HERE/landed.sh" "$L/scripts/devenv/"
cat > "$L/scripts/devenv/devenv.sh" <<'EOF'
#!/bin/bash
# Stands in for devenv.sh on a test box: an env is a worktree of the box's checkout.
set -e
wt="$(cd ../.. && pwd)/benches/$2/apps/nirmaan_stack"
case "$1" in
  create) git worktree add -q "$wt" "$4"; echo "Ready $2" ;;
  stop) ;;
  destroy) [ -z "$(git -C "$wt" status --porcelain)" ] || { echo "ERROR: worktree has uncommitted changes." >&2; exit 1; }
    git worktree remove "$wt"; echo "Destroyed env $2. Commits stay in git." ;;
esac
EOF
printf 'import sys\nprint("ok    test dod", sys.argv[1])\n' > "$L/scripts/devenv/dod.py"
chmod +x "$L/scripts/devenv/devenv.sh"
git -C "$L" init -q -b master; git -C "$L" config user.name test; git -C "$L" config user.email test@example.com
git -C "$L" config core.hooksPath "$T/no-hooks"
git -C "$L" add -A; git -C "$L" commit -q --no-verify -m base
CH="$T/boxes/t@contabo-test"; CO="$CH/work/x/variants/master"
git clone -q "$L" "$CO"; git -C "$CO" config user.name box; git -C "$CO" config user.email box@example.com
mkdir -p "$CH/.stub"; echo Linux > "$CH/.stub/uname"; : > "$CH/.stub/procs"
CROOT="$(cd "$CH/work/x" && pwd -P)"
bwt() { echo "$CROOT/benches/$1/apps/nirmaan_stack"; }
task() { RC=0; OUT="$(bash "$L/scripts/devenv/task.sh" "$@" 2>&1)" || RC=$?; }
rec() { git -C "$L" config "devbox-task.$1.box" || echo none; }

for n in ta tb tc td te tf tg th; do task start "$n" --box contabo --no-agent; rc_is 0 "start $n"; done
commit "$(bwt ta)" a1; commit "$(bwt tb)" b1; commit "$(bwt tc)" c1
echo x > "$(bwt td)/stray.txt"; echo "# changed" >> "$(bwt tf)/scripts/devenv/handoff.sh"
echo "gitdir: $T/nowhere" > "$(bwt tg)/.git"
git -C "$(bwt th)" checkout -q -b side; commit "$(bwt th)" h1   # the agent committed off box/th
echo "4101 claude $(bwt te)" > "$CH/.stub/procs"
# ta: merged on the laptop under another name, so no laptop box/ta (contabo's bulk-tds-1571 on 2026-11-10)
git -C "$L" fetch -q "$CO" box/ta; git -C "$L" merge -q --ff-only FETCH_HEAD; git -C "$L" branch -D box/ta >/dev/null
git -C "$L" branch -D box/tb >/dev/null
task done tc; rc_is 0 "done tc brings its commit to the laptop"
has "After the merge: task.sh prune" "done ends by naming task.sh prune"

task clean tb
rc_is 1 "clean refuses ONLY_BOX when no laptop ref holds the box tip"; has "ONLY_BOX: the box has commits on box/tb the laptop lacks" "the refusal says why"
same "$(rec tb)" contabo "a refused clean keeps the record"

task prune
rc_is 0 "task.sh prune lists"
line "^PRUNE +box-task +ta +contabo:$(bwt ta) +landed:master\$" "a task merged under another name is PRUNE"
line '^KEEP +box-task +tb .*landed:- +unfetched$' "a box tip the laptop lacks is KEEP"
line '^KEEP +box-task +tc .*landed:- *$' "an unmerged task is KEEP, not landed"
line '^KEEP +box-task +td .*landed:master +untracked:1$' "an untracked file in the box env holds"
line '^KEEP +box-task +te .*landed:master +working$' "a working agent holds"
line '^KEEP +box-task +tf .*landed:master +tracked-changes:1$' "a tracked change in the box env holds"
line '^KEEP +box-task +tg .*landed:master +status-failed$' "a box env git status cannot read holds"
line '^KEEP +box-task +th .*landed:master +off-branch:[0-9a-f]{9}$' "a commit in the box env off its box branch holds"
has "to prune: ta (task.sh prune --yes cleans them; laptop branches stay)" "the total names the tasks"
same "$(rec ta)" contabo "listing cleans nothing"

task prune --yes
rc_is 0 "task.sh prune --yes"
has "ok    ONLY_BOX, but the box tip" "clean accepts ONLY_BOX when a laptop ref holds the box tip"
has "cleaned ta on box contabo" "--yes cleans the PRUNE task"
same "$(rec ta) $(rec tc)" "none contabo" "--yes cleans only the PRUNE task"
git -C "$CO" rev-parse -q --verify refs/heads/box/ta >/dev/null && fail "the box still has box/ta"; pass "the box branch of ta is gone"
task prune
rc_is 0 "a second task.sh prune"; no_line '^PRUNE' "a second task.sh prune finds nothing"; has "to prune: 0 tasks" "a second run totals zero"

task clean td
rc_is 1 "clean fails when the box refuses destroy"; has "uncommitted changes" "the box's refusal is shown"
no_line '^ok +cleaned' "a refused destroy is not reported cleaned"
same "$(rec td)" contabo "a refused destroy keeps the record"; there "$(bwt td)" "a refused destroy leaves the env"
git -C "$CO" rev-parse -q --verify refs/heads/box/td >/dev/null || fail "a refused destroy deleted box/td"; pass "a refused destroy keeps the box branch"

# Picked into the laptop's master by equal patch: ti after the box went on past the laptop's box/ti (BOX_AHEAD), tj
# while the laptop's box/tj has a commit of its own (DIVERGED)
for n in ti tj; do task start "$n" --box contabo --no-agent; rc_is 0 "start $n"; done
commit "$(bwt ti)" i1; task done ti; rc_is 0 "done ti"; commit "$(bwt ti)" i2
commit "$(bwt tj)" j1
git -C "$L" update-ref refs/heads/box/tj "$(git -C "$L" commit-tree -p box/tj -m jl 'box/tj^{tree}')"
for n in ti tj; do git -C "$L" fetch -q "$CO" "box/$n"; git -C "$L" cherry-pick "master..FETCH_HEAD" >/dev/null; done
task clean ti
rc_is 0 "clean ti"; has "ok    BOX_AHEAD, but the box tip" "clean accepts BOX_AHEAD when a laptop ref holds the box tip"
same "$(rec ti)" none "clean ti unsets the record"
task clean tj
rc_is 0 "clean tj"; has "ok    DIVERGED, but the box tip" "clean accepts DIVERGED when a laptop ref holds the box tip"
same "$(rec tj)" none "clean tj unsets the record"

touch "$CH/.stub/down"
task prune
rc_is 3 "an unreachable box is exit 3"; has "box contabo: did not answer over SSH" "the unreachable box is named"
line '^KEEP +box-task +tc .*unreachable$' "an unreachable box's tasks are KEEP"

echo; echo "all $N checks passed"
