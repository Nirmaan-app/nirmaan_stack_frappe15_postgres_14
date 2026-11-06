#!/bin/bash
# Tests boxes.sh against a temp registry and stub ssh, scp and orca on PATH. No network, no real box, nothing outside
# a fresh folder under $TMPDIR, which each run leaves in place. Run: /bin/bash scripts/devenv/test_boxes.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
T="$(mktemp -d "${TMPDIR:-/tmp}/test_boxes.XXXXXX")"
echo "scratch: $T"
OUT="" RC=0 N=0
fail() { echo "FAIL  $1"; echo "----- output (exit $RC):"; echo "$OUT"; exit 1; }
pass() { N=$((N + 1)); echo "ok    $1"; }
run() { RC=0; OUT="$("$@" 2>&1)" || RC=$?; }
rc_is() { [ "$RC" = "$1" ] || fail "$2 (exit $RC, want $1)"; pass "$2"; }
has() { case "$OUT" in *"$1"*) pass "$2" ;; *) fail "$2 (output lacks: $1)" ;; esac; }
log_has() { grep -qF -- "$1" "$STUB_LOG" || fail "$2 (stub log lacks: $1)"; pass "$2"; }
log_lacks() { ! grep -qF -- "$1" "$STUB_LOG" || fail "$2 (stub log has: $1)"; pass "$2"; }
fresh_log() { STUB_LOG="$T/stub-$((N + 1)).log"; : > "$STUB_LOG"; export STUB_LOG; }

# ---- stubs. ssh and scp run the remote side locally, with $STUB_BOXES/<ssh target> as the box user's home.
mkdir -p "$T/bin" "$T/boxes"
ln -s /bin/bash "$T/bin/bash"
cat > "$T/bin/ssh" <<'EOF'
#!/bin/bash
echo "ssh $*" >> "$STUB_LOG"
while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -t|-q) shift ;; *) break ;; esac; done
home="$STUB_BOXES/$1"; shift
[ -z "${STUB_DOWN:-}" ] || exit 255
case "$*" in *"${STUB_FAIL_ON:-^never^}"*) exit "${STUB_FAIL_RC:-1}" ;; esac
mkdir -p "$home"; cd "$home" && HOME="$home" exec bash -c "$*"
EOF
cat > "$T/bin/scp" <<'EOF'
#!/bin/bash
echo "scp $*" >> "$STUB_LOG"
args=(); while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -q) shift ;; *) args+=("$1"); shift ;; esac; done
[ -z "${STUB_DOWN:-}" ] || exit 255
at() { case "$1" in *@*:*) p="${1#*:}"; echo "$STUB_BOXES/${1%%:*}/${p#\~/}" ;; *) echo "$1" ;; esac; }
cp "$(at "${args[0]}")" "$(at "${args[1]}")"
EOF
cat > "$T/bin/orca" <<'EOF'
#!/bin/bash
echo "orca $*" >> "$STUB_LOG"
[ "$1 $2" != "terminal list" ] || echo "term_t1  claude"
EOF
chmod +x "$T/bin/ssh" "$T/bin/scp" "$T/bin/orca"
export PATH="$T/bin:$PATH" STUB_BOXES="$T/boxes"
unset BOX_STARTED STUB_DOWN STUB_FAIL_ON STUB_FAIL_RC

R="$T/boxes.conf"; export DEVBOX_REGISTRY="$R"
git config -f "$R" devbox.default contabo
git config -f "$R" box.contabo.ssh t@contabo-test
git config -f "$R" box.contabo.checkout work/x/variants/master
git config -f "$R" box.contabo.orca env:test-orca
git config -f "$R" box.contabo.agents 2
git config -f "$R" box.air.ssh me@air-test
git config -f "$R" box.air.checkout work/y/variants/master
git config -f "$R" box.nock.ssh me@nock-test

lib() { ( die() { echo "STOP  $*" >&2; exit 1; }; . "$HERE/boxes.sh"; eval "$1" ); }

# ---- boxes.sh
fresh_log
run lib 'box_load mini'
rc_is 1 "unknown box STOPs"; has "no box 'mini' in $R (boxes: contabo air nock" "unknown box lists the boxes"
run lib 'box_load t@contabo-test'
rc_is 1 "an ssh target is not a box name"; has "no box 't@contabo-test'" "an ssh target gets the unknown-box STOP"
run lib 'box_load nock'
rc_is 1 "box without checkout STOPs"; has "git config -f $R box.nock.checkout <path under its home>" "missing checkout prints the fix line"
run env DEVBOX_REGISTRY="$T/none.conf" /bin/bash -c "$(declare -f lib); HERE='$HERE'; lib 'box_load air'"
rc_is 1 "no registry STOPs"; has "the setup is in scripts/devenv/boxes.sh's header" "no registry points at the setup"
cp "$R" "$T/bad.conf"; git config -f "$T/bad.conf" box.air.orca ssh:me@air-test; git config -f "$T/bad.conf" box.contabo.checkout /abs
run env DEVBOX_REGISTRY="$T/bad.conf" /bin/bash -c "$(declare -f lib); HERE='$HERE'; lib 'box_load air'"
rc_is 1 "an orca value other than env: STOPs"; has "box.air.orca: env:<paired Orca server name>" "bad orca names the key"
run env DEVBOX_REGISTRY="$T/bad.conf" /bin/bash -c "$(declare -f lib); HERE='$HERE'; lib 'box_load contabo'"
rc_is 1 "an absolute checkout STOPs"; has "relative to the box user's home" "absolute checkout says why"
run lib 'box_load contabo; box_show "the default"'
rc_is 0 "a full box loads"; has "box   contabo (t@contabo-test), checkout ~/work/x/variants/master   [the default]" "box line names box, target, checkout and source"

run lib 'box_default'
has contabo "box_default reads devbox.default"
git config -f "$T/one.conf" box.solo.ssh a@solo; git config -f "$T/one.conf" box.solo.checkout c
run env DEVBOX_REGISTRY="$T/one.conf" /bin/bash -c "$(declare -f lib); HERE='$HERE'; lib 'box_default'"
rc_is 0 "box_default with one box"; has solo "box_default with one box picks it"
git config -f "$T/one.conf" box.duo.ssh a@duo
run env DEVBOX_REGISTRY="$T/one.conf" /bin/bash -c "$(declare -f lib); HERE='$HERE'; lib 'box_default'"
rc_is 1 "two boxes and no default STOP"; has "pass --box <name>" "two boxes and no default ask for --box"

fresh_log
run env STUB_DOWN=1 /bin/bash -c "$(declare -f lib); HERE='$HERE'; lib 'box_load air; box_reach; echo after'"
rc_is 3 "ssh exit 255 becomes exit 3"; has "box air (me@air-test) did not answer over SSH" "unreachable names box and target"
has "Nothing was changed" "unreachable before a change says nothing changed"
case "$OUT" in *after*) fail "unreachable stops the script" ;; esac; pass "unreachable stops the script"
run env STUB_DOWN=1 BOX_STARTED=1 /bin/bash -c "$(declare -f lib); HERE='$HERE'; lib 'box_load air; box_reach'"
rc_is 3 "unreachable after a change is exit 3"; has "Steps already done stay done" "unreachable after a change says rerun"
run lib 'box_load air; box_ssh "exit 7"'
rc_is 7 "a remote command's own exit code passes through"
log_has "ssh -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 me@air-test" "box_ssh uses the box's target and options"
run lib 'box_load air; echo hi > "$STUB_BOXES/note"; box_scp "$STUB_BOXES/note" BOX:copied && cat "$STUB_BOXES/me@air-test/copied"'
rc_is 0 "box_scp copies to the box"; has hi "box_scp maps BOX: to the box"

fresh_log
run lib 'box_load air; agent_ready'
rc_is 1 "a box without orca refuses an agent"; has "box air has no Orca server" "no-orca STOP names the box"; has "use --no-agent" "no-orca STOP says --no-agent"
run lib 'box_load air; agent_stop /wt'
rc_is 0 "agent_stop on a box without orca is a no-op"; log_lacks "orca" "agent_stop on a box without orca calls no orca"
run lib 'box_load contabo; agent_ready; agent_launch /wt "the prompt"; agent_alive /wt && echo alive; agent_stop /wt'
rc_is 0 "agent route on an env: box"; has alive "agent_alive sees the terminal"; has "closed Orca terminal term_t1" "agent_stop closes the terminals"
log_has "orca agent launch --environment test-orca --agent claude --surface terminal --focus --worktree path:/wt --prompt the prompt --json" "agent_launch passes env: as --environment"
log_has "orca terminal close --environment test-orca --terminal term_t1" "agent_stop closes on the box's server"

# ---- task.sh and handoff.sh, on a temp laptop repo (it holds the task records) and a checkout of it per box
L="$T/laptop"; mkdir -p "$L/scripts/devenv"
cp "$HERE/boxes.sh" "$HERE/task.sh" "$HERE/handoff.sh" "$L/scripts/devenv/"
cat > "$L/scripts/devenv/devenv.sh" <<'EOF'
#!/bin/bash
# Stands in for devenv.sh on a test box: an env is a worktree of the box's checkout.
set -e
wt="$(cd ../.. && pwd)/benches/$2/apps/nirmaan_stack"
case "$1" in
  create) git worktree add -q "$wt" "$4"; echo "Ready $2" ;;
  destroy) git -C "$wt" checkout -q --detach; echo "destroyed $2" ;;
esac
EOF
printf 'import sys\nprint("ok    test dod", sys.argv[1])\n' > "$L/scripts/devenv/dod.py"
chmod +x "$L/scripts/devenv/devenv.sh"
git -C "$L" init -q -b master
git -C "$L" add -A
git -C "$L" -c user.name=test -c user.email=test@example.com commit -q --no-verify -m base
git -C "$L" branch box/legacy
AIR="$T/boxes/me@air-test/work/y/variants/master"
git clone -q "$L" "$T/boxes/t@contabo-test/work/x/variants/master"; git clone -q "$L" "$AIR"
echo "the brief" > "$T/brief.md"
task() { run env ${TASK_ENV:-} /bin/bash "$L/scripts/devenv/task.sh" "$@"; }
rec() { git -C "$L" config "devbox-task.$1.box" || echo none; }
branch() { git -C "$L" rev-parse -q --verify "refs/heads/box/$1" >/dev/null && echo yes || echo no; }
same() { [ "$1" = "$2" ] || fail "$3 (got '$1', want '$2')"; pass "$3"; }
line() { echo "$OUT" | grep -qE "$1" || fail "$2 (no line matching $1)"; pass "$2"; }

fresh_log
task start t1 --box mini --no-agent
rc_is 1 "start on an unknown box STOPs"; has "no box 'mini'" "start on an unknown box names it"
same "$(branch t1) $(rec t1)" "no none" "an unknown box leaves no branch and no record"
task start t1 --box nock --no-agent
rc_is 1 "start on a box without a checkout STOPs"; has "box.nock.checkout <path under its home>" "start prints the checkout fix line"
same "$(branch t1) $(rec t1)" "no none" "a box without a checkout leaves no branch and no record"
task start t1 --box air
rc_is 1 "start with an agent on a box without orca STOPs"; has "box air has no Orca server" "the refusal names the box"
has "use --no-agent" "the refusal says --no-agent"
same "$(branch t1) $(rec t1)" "no none" "the no-orca refusal leaves no branch and no record"
log_lacks "ssh" "the no-orca refusal never reaches the box"
TASK_ENV="STUB_DOWN=1" task start t1 --box contabo --no-agent
rc_is 3 "start on an unreachable box is exit 3"; has "box contabo (t@contabo-test) did not answer over SSH" "start names the unreachable box"
has "Nothing was changed" "start on an unreachable box says nothing changed"
same "$(branch t1) $(rec t1)" "no none" "an unreachable box leaves no branch and no record"

task status legacy
rc_is 1 "status of an unrecorded task STOPs"; has "git config devbox-task.legacy.box <box>" "status prints the one-line fix"
task status legacy --box air
rc_is 1 "status refuses --box"; has "takes no options" "status says the box comes from the record"
run /bin/bash "$L/scripts/devenv/handoff.sh" status t@contabo-test box/legacy
rc_is 1 "handoff.sh refuses an ssh target"; has "no box 't@contabo-test'" "handoff.sh asks for a box name"

task start t2 --box air --no-agent --brief "$T/brief.md"
rc_is 0 "start t2 on air"; has "box   air (me@air-test), checkout ~/work/y/variants/master   [--box]" "start prints the box line first"
same "$(rec t2)" air "start records the box"
same "$(git -C "$AIR" rev-parse box/t2)" "$(git -C "$L" rev-parse box/t2)" "the branch reached the air box"
same "$(cat "$T/boxes/me@air-test/claude-artifacts/dod/box-t2/BRIEF.md")" "the brief" "the brief reached the air box"
has "ok    test dod start" "the Definition of Done was turned on"
task start t2 --box contabo --no-agent
rc_is 1 "a --box that contradicts the record STOPs"; has "task t2 is on box air (git config devbox-task.t2.box)" "the STOP names the recorded box"
fresh_log
task start t2 --no-agent
rc_is 0 "a rerun of start goes to the recorded box"; has "box   air (me@air-test)" "the rerun names air"; has "[from the record]" "the rerun says the record chose"
log_lacks "t@contabo-test" "the rerun never touches the default box"
task status t2
rc_is 0 "status t2"; has "[from the record]" "status takes the box from the record"; has "verdict: IN_SYNC" "status reaches the recorded box"
has "ok    test dod check" "status runs the Definition of Done check"
task done t2
rc_is 0 "done t2"; has "laptop already has box/t2" "done asks the recorded box"

export DEVBOX_CLAUDE_HOME="$T/laptop-claude"; mkdir -p "$DEVBOX_CLAUDE_HOME"
fresh_log
task start t3 --brief "$T/brief.md"
rc_is 0 "start t3 with an agent on the default box"; has "[the default]" "start without --box takes the default"
same "$(rec t3)" contabo "the default box is recorded"
log_has "orca agent launch --environment test-orca --agent claude" "the agent is launched on contabo's Orca server"
log_has "--prompt You are an agent on a dev box, working on task 't3'" "the agent gets the task prompt"
has "Claude is working in 't3'" "start sees the agent's terminal"
has "Claude plugins and pstack-models.md match the laptop's" "start says when the box's Claude setup matches the laptop's"

mkdir -p "$DEVBOX_CLAUDE_HOME/plugins"
echo '{"enabledPlugins": {"pstack@p": true, "off@p": false}}' > "$DEVBOX_CLAUDE_HOME/settings.json"
echo '{"plugins": {"pstack@p": [{"version": "1.0"}]}}' > "$DEVBOX_CLAUDE_HOME/plugins/installed_plugins.json"
echo "session hook: off" > "$DEVBOX_CLAUDE_HOME/pstack-models.md"
task start t5 --box contabo --brief "$T/brief.md"
rc_is 0 "a box whose Claude setup differs still gets its agent"
has "WARN  box contabo's Claude setup differs from the laptop's" "start warns when the box lacks the laptop's setup"
has "laptop: plugin pstack@p" "the warning names the plugin the box lacks"
has "box:    pstack-models.md absent" "the warning names the missing pstack-models.md"
case "$OUT" in *"off@p"*) fail "a disabled plugin is not compared" ;; *) pass "a disabled plugin is not compared" ;; esac
has "Claude is working in 't5'" "the agent starts after the warning"
mkdir -p "$T/boxes/t@contabo-test/.claude"; cp -R "$DEVBOX_CLAUDE_HOME/." "$T/boxes/t@contabo-test/.claude/"
task start t6 --box contabo --brief "$T/brief.md"
has "Claude plugins and pstack-models.md match the laptop's" "the same setup on both sides matches"
case "$OUT" in *"note  plugin versions differ"*) fail "the same versions print no note" ;; *) pass "the same versions print no note" ;; esac
echo '{"plugins": {"pstack@p": [{"version": "2.0"}]}}' > "$T/boxes/t@contabo-test/.claude/plugins/installed_plugins.json"
task start t7 --box contabo --brief "$T/brief.md"
has "Claude plugins and pstack-models.md match the laptop's" "another version alone is no warning"
has "note  plugin versions differ (laptop -> box): pstack@p 1.0 -> 2.0" "another version is one note line"

task done t3
rc_is 0 "done t3"
has "Separate review (fills the report's ## Review): /mattpocock-skills:code-review $(git -C "$L" merge-base master box/t3 | cut -c1-9), on box/t3" "done names the separate review against the task's base"

TASK_ENV="STUB_FAIL_ON=_box STUB_FAIL_RC=255" task start t4 --box air --no-agent
rc_is 3 "a box lost mid-start is exit 3"; has "Steps already done stay done" "a box lost mid-start says rerun"
same "$(branch t4) $(rec t4)" "yes air" "the branch and record made before the loss stay"
task start t4 --no-agent
rc_is 0 "the rerun finishes start t4"; has "[from the record]" "the rerun of t4 finds its box in the record"

TASK_ENV="STUB_FAIL_ON=destroy" task clean t2
rc_is 1 "clean stops when the box side fails"; same "$(rec t2)" air "a failed clean keeps the record"
task clean t2
rc_is 0 "clean t2"; has "deleted the box branch box/t2" "clean removes the box branch"; has "cleaned t2 on box air" "clean names the box"
same "$(rec t2)" none "clean unsets the record"
git -C "$AIR" rev-parse -q --verify refs/heads/box/t2 >/dev/null && fail "the air box still has box/t2"; pass "the air box no longer has box/t2"
fresh_log
task clean t3
rc_is 0 "clean t3"; log_has "orca terminal close --environment test-orca --terminal term_t1" "clean closes the agent's terminal"
same "$(rec t3)" none "clean t3 unsets the record"

git -C "$L" config devbox-task.gone.box contabo
fresh_log
TASK_ENV="STUB_DOWN=1 DEVBOX_REGISTRY=$T/none.conf" task list
rc_is 0 "list works with every box down and no registry"
line '^t4 +air$' "list shows a recorded task"; line '^legacy +no record$' "list shows an unrecorded task"
line '^gone +contabo \(no laptop branch\)$' "list shows a record whose laptop branch is gone"
log_lacks "ssh" "list never uses SSH"

# ---- data.sh send; the air box's data.sh is a stand-in that reports what restore got
cp "$HERE/data.sh" "$L/scripts/devenv/"
printf '#!/bin/bash\necho "restore got $1 $2 $3"\n' > "$AIR/scripts/devenv/data.sh"; chmod +x "$AIR/scripts/devenv/data.sh"
echo "dump" > "$T/nirmaan-backup-test.tar.gz"
send() { run env ${TASK_ENV:-} /bin/bash "$L/scripts/devenv/data.sh" send "$@"; }
send t@contabo-test "$T/nirmaan-backup-test.tar.gz"
rc_is 1 "data.sh send refuses an ssh target"; has "no box 't@contabo-test'" "data.sh send asks for a box name"
TASK_ENV="STUB_DOWN=1" send air "$T/nirmaan-backup-test.tar.gz"
rc_is 3 "data.sh send to an unreachable box is exit 3"; has "Nothing was changed" "data.sh send says nothing changed"
fresh_log
send air "$T/nirmaan-backup-test.tar.gz"
rc_is 0 "data.sh send to air"; has "box   air (me@air-test), checkout ~/work/y/variants/master   [named]" "data.sh send prints the box line"
has "restore got restore $T/boxes/me@air-test/incoming/nirmaan-backup-test.tar.gz --yes" "restore runs from the box's checkout on the copied backup"
log_has "-t me@air-test" "restore gets a terminal"

echo; echo "all $N checks passed"
