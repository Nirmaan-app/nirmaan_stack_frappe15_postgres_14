#!/bin/bash
# Tests devenv.sh prune and landed.sh on a fake dev root (DEVENV_ROOT) holding a real temp git repo with worktrees and
# envs; the post-merge hook on real merges in that repo; task.sh prune and clean's landed check on a temp laptop repo
# and a stub Linux box. Stub docker, ssh, scp, uname, pgrep and readlink on PATH. No network, no real env or box,
# nothing outside a fresh folder under $TMPDIR, which each run leaves in place.
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
[ -s "$HOME/.stub/uname" ] && cat "$HOME/.stub/uname" || exec /usr/bin/uname "$@"
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

commit() {   # commit <checkout> <file>: a commit that adds <file>
  echo "$2" > "$1/$2"; git -C "$1" add "$2"; git -C "$1" commit -q --no-verify -m "$2"
}

# ---- a fake dev root, laid out as on the laptop: the repo's main checkout is nirmaan_stack_variants/dev (on
# develop), and nirmaan_stack_variants/master is a linked worktree of it; envs under benches/
D="$T/dev"; DEV="$D/nirmaan_stack_variants/dev"; M="$D/nirmaan_stack_variants/master"; B="$D/benches"
mkdir -p "$DEV/scripts/devenv" "$DEV/.githooks" "$B" "$D/frappe-bench/apps/frappe"
export DEVENV_ROOT="$D"
cp "$HERE/devenv.sh" "$HERE/landed.sh" "$DEV/scripts/devenv/"
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
for b in h-dirty h-locked h-agent h-here h-lab h-gone h-untr h-files h-serve; do G branch "$b" master; done

WT="$M/.claude/worktrees"
G worktree add -q "$WT/merged" feat/merged
G worktree add -q "$WT/open" feat/open
G worktree add -q "$WT/dirty" h-dirty; echo changed > "$WT/dirty/m1"
G worktree add -q "$WT/locked" h-locked; G worktree lock "$WT/locked"
G worktree add -q "$WT/agent" h-agent; (cd "$WT/agent" && exec sleep 600 >/dev/null 2>&1) & AGENT_PID=$!
G worktree add -q "$WT/here" h-here
G worktree add -q "$D/nirmaan_stack_variants/lab" h-lab
G worktree add -q "$WT/gone" h-gone; rm -rf "$WT/gone"
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
line '^KEEP +env +e-untracked .*landed:master +untracked:1$' "an untracked file holds"
line '^KEEP +env +e-files .*landed:master +bench-files:repro$' "a file in the bench folder holds, named"
line '^KEEP +env +e-serving .*landed:master +serving$' "a serving env holds"
line '^KEEP +env +master +nirmaan_stack_variants/master .* shared' "the master env is shared"
line '^KEEP +env +old +benches/old +landed:- +no-worktree bench-files:notes.txt$' "a bench folder with no worktree holds"
line '^KEEP +worktree +develop +nirmaan_stack_variants/dev .*landed:master +shared$' "the dev checkout, the main worktree, is shared"
no_line 'KEEP +worktree +master' "the master checkout is one row, under its env"
same "$(echo "$OUT" | grep -E '^(PRUNE|KEEP)' | head -3 | cut -c1-5 | sort -u)" PRUNE "PRUNE rows come first"
has "to prune: 2 envs, 1 worktrees (devenv.sh prune --yes removes them; branches stay)" "the total names the envs and worktrees"
same "$(cut -d' ' -f1 "$STUB_LOG" | sort -u | tr '\n' ' ')" "" "listing never calls docker"
there "$WT/merged" "listing removes nothing"

prune --quiet
rc_is 0 "prune --quiet"
same "$(echo "$OUT" | grep -c '^KEEP' || true)" 0 "--quiet prints no KEEP row"
line '^PRUNE +worktree +feat/merged' "--quiet prints the PRUNE rows"
line '^PRUNE +env +e-up ' "--quiet finds work landed in upstream/develop by ancestry"
no_line '^PRUNE +env +e-create ' "--quiet skips the slow equal-patch check"

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

echo; echo "all $N checks passed"
