#!/bin/bash
# Tests task.sh watch against a temp laptop repo (it holds the task records), a temp registry and two stub boxes: a
# Linux one (contabo) and a macOS one (air). Stub ssh runs the probe locally with the box folder as the box user's
# home; stub uname, pgrep, readlink and lsof answer from <home>/.stub/, and stub osascript logs each notification.
# No network, no real box, nothing outside a fresh folder under $TMPDIR, which each run leaves in place.
# Run: /bin/bash scripts/devenv/test_task_watch.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
T="$(mktemp -d "${TMPDIR:-/tmp}/test_task_watch.XXXXXX")"
echo "scratch: $T"
OUT="" RC=0 N=0
fail() { echo "FAIL  $1"; echo "----- output (exit $RC):"; echo "$OUT"; exit 1; }
pass() { N=$((N + 1)); echo "ok    $1"; }
run() { RC=0; OUT="$("$@" 2>&1)" || RC=$?; }
rc_is() { [ "$RC" = "$1" ] || fail "$2 (exit $RC, want $1)"; pass "$2"; }
same() { [ "$1" = "$2" ] || fail "$3 (got '$1', want '$2')"; pass "$3"; }
line() { echo "$OUT" | grep -qE "$1" || fail "$2 (no line matching $1)"; pass "$2"; }
no_line() { ! echo "$OUT" | grep -qE "$1" || fail "$2 (a line matches $1)"; pass "$2"; }
alerts() { echo "$OUT" | grep -c '^ALERT' || true; }
notes() { grep -c . "$T/osascript.log" || true; }
fresh_log() { STUB_LOG="$T/stub-$((N + 1)).log"; : > "$STUB_LOG"; export STUB_LOG; }

# ---- stubs
mkdir -p "$T/bin" "$T/boxes"
ln -s /bin/bash "$T/bin/bash"
cat > "$T/bin/ssh" <<'EOF'
#!/bin/bash
echo "ssh $*" >> "$STUB_LOG"
while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -t|-q) shift ;; *) break ;; esac; done
home="$STUB_BOXES/$1"; shift
[ ! -e "$home/.stub/down" ] || exit 255
cd "$home" && HOME="$home" exec bash -c "$*"
EOF
cat > "$T/bin/uname" <<'EOF'
#!/bin/bash
[ -s "$HOME/.stub/uname" ] && cat "$HOME/.stub/uname" || exec /usr/bin/uname "$@"
EOF
# <home>/.stub/procs: one process per line, "<pid> <comm> <cwd>"
cat > "$T/bin/pgrep" <<'EOF'
#!/bin/bash
awk -v re="$1" '$2 ~ re {print $1; f=1} END {exit !f}' "$HOME/.stub/procs" 2>/dev/null
EOF
cat > "$T/bin/readlink" <<'EOF'
#!/bin/bash
case "$1" in
  /proc/*/cwd) p="${1#/proc/}"; awk -v p="${p%/cwd}" '$1 == p {sub(/^[^ ]+ [^ ]+ /, ""); print; f=1} END {exit !f}' "$HOME/.stub/procs" ;;
  *) exec /usr/bin/readlink "$@" ;;
esac
EOF
cat > "$T/bin/lsof" <<'EOF'
#!/bin/bash
[ "$*" = "-a -c claude -d cwd -Fn" ] || { echo "stub lsof: unexpected $*" >&2; exit 2; }
awk 'index($2, "claude") == 1 {c=$0; sub(/^[^ ]+ [^ ]+ /, "", c); printf "p%s\nfcwd\nn%s\n", $1, c; f=1} END {exit !f}' "$HOME/.stub/procs" 2>/dev/null
EOF
cat > "$T/bin/osascript" <<'EOF'
#!/bin/bash
echo "$*" >> "$OSA_LOG"
EOF
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" STUB_BOXES="$T/boxes" OSA_LOG="$T/osascript.log" XDG_STATE_HOME="$T/state"
: > "$OSA_LOG"
STATE="$T/state/devbox/watch"

R="$T/boxes.conf"; export DEVBOX_REGISTRY="$R"
git config -f "$R" devbox.default contabo
git config -f "$R" box.contabo.ssh t@contabo-test
git config -f "$R" box.contabo.checkout work/x/variants/master
git config -f "$R" box.air.ssh me@air-test
git config -f "$R" box.air.checkout work/y/variants/master

CH="$T/boxes/t@contabo-test"; AH="$T/boxes/me@air-test"
mkdir -p "$CH/.stub" "$CH/work/x/variants/master" "$AH/.stub" "$AH/work/y/variants/master"
echo Linux > "$CH/.stub/uname"; echo Darwin > "$AH/.stub/uname"
CROOT="$(cd "$CH/work/x" && pwd -P)"; AROOT="$(cd "$AH/work/y" && pwd -P)"
wt() { echo "$1/benches/$2/apps/nirmaan_stack"; }
report() {   # report <box home> <task> <first line under ## Status>, or no third argument for no report
  local d="$1/claude-artifacts/dod/box-$2"; mkdir -p "$d"
  [ $# -ge 3 ] || { rm -f "$d/REPORT.md"; return; }
  printf '# Report: %s\n\nBase: abc1234\n\n## Status\n\n%s\n\n## What changed\nTODO: what\n' "$2" "$3" > "$d/REPORT.md"
}

# contabo: w1 working, f1 alive with a DONE report, c1 dead with a TODO report
cat > "$CH/.stub/procs" <<EOF
4101 claude $(wt "$CROOT" w1)
4102 claude $(wt "$CROOT" f1)
4103 bash $(wt "$CROOT" c1)
EOF
report "$CH" w1 "TODO: DONE or BLOCKED, then one line on the outcome"
report "$CH" f1 "Done: task.sh watch reports
each agent. Tests pass, see Evidence."
report "$CH" c1 "TODO: DONE or BLOCKED, then one line on the outcome"
# air: m1 alive with no report, b1 dead and BLOCKED, x1 has only a claude in its subfolder and a spare daemon
cat > "$AH/.stub/procs" <<EOF
5101 claude.exe $(wt "$AROOT" m1)
5102 claude.exe $(wt "$AROOT" x1)/frontend
5103 claude.exe /private/tmp/cc-daemon-501/$(wt "$AROOT" x1)
EOF
report "$AH" m1
report "$AH" b1 "BLOCKED. The owner must pick the rate source."
report "$AH" x1 "TODO: DONE or BLOCKED, then one line on the outcome"

L="$T/laptop"; mkdir -p "$L/scripts/devenv"
cp "$HERE/boxes.sh" "$HERE/task.sh" "$L/scripts/devenv/"
git -C "$L" init -q -b master
git -C "$L" add -A
git -C "$L" -c user.name=test -c user.email=test@example.com commit -q --no-verify -m base
for t in w1:contabo f1:contabo c1:contabo m1:air b1:air x1:air; do git -C "$L" config "devbox-task.${t%%:*}.box" "${t#*:}"; done
watch() { run /bin/bash "$L/scripts/devenv/task.sh" watch "$@"; }
boxes_sum() { (cd "$T/boxes" && find . -print0 | sort -z | xargs -0 ls -ld | awk '{print $1, $5, $NF}'; find . -type f -print0 | sort -z | xargs -0 cat) | cksum; }

# ---- usage
watch --every
rc_is 1 "--every without seconds is a usage error"
watch --every 0
rc_is 1 "--every 0 is a usage error"
watch --every soon
rc_is 1 "--every with a word is a usage error"
watch now
rc_is 1 "an unknown argument is a usage error"
[ ! -e "$STATE" ] || [ -z "$(ls "$STATE")" ] || fail "a usage error saves no state"; pass "a usage error saves no state"

# ---- the first pass: every row of the classification table
fresh_log
before="$(boxes_sum)"
watch
rc_is 0 "a pass exits 0"
line '^w1 +contabo +working *$' "alive and TODO is working"
line '^f1 +contabo +finished +Done: task.sh watch reports each agent\.$' "alive and DONE is finished, with the first sentence of a wrapped Status"
line '^c1 +contabo +crashed *$' "dead and TODO is crashed"
line '^m1 +air +working *$' "alive and no report is working"
line '^b1 +air +finished +BLOCKED\.$' "dead and BLOCKED is finished"
line '^x1 +air +crashed *$' "a claude in a subfolder or a spare daemon's folder does not count as the task's agent"
line '^ALERT c1 on contabo: unseen -> crashed$' "the first sight of a crashed task alerts"
line '^ALERT x1 on air: unseen -> crashed$' "the first sight of the other crashed task alerts"
same "$(alerts)" 2 "the first sight of a working or finished task raises no alert"
same "$(notes)" 2 "each alert raises one notification"
grep -qF 'display notification "c1 on contabo: unseen -> crashed"' "$OSA_LOG" || fail "the notification names the task and its change"; pass "the notification names the task and its change"
same "$(grep -c '^ssh ' "$STUB_LOG")" 2 "one SSH per box per pass"
same "$(boxes_sum)" "$before" "a pass changes nothing on the boxes"

# ---- a rerun with nothing changed
watch
rc_is 0 "a rerun exits 0"
line '^w1 +contabo +working *$' "a rerun still prints every task"
same "$(alerts)" 0 "a rerun with no change raises no alert"
same "$(notes)" 2 "a rerun with no change raises no notification"

# ---- an agent dies; the other box goes down
grep -v '^4101 ' "$CH/.stub/procs" > "$T/p" && mv "$T/p" "$CH/.stub/procs"
watch
line '^ALERT w1 on contabo: working -> crashed$' "a killed agent alerts working -> crashed"
same "$(alerts)" 1 "only the changed task alerts"
same "$(notes)" 3 "the change raises a notification"

touch "$AH/.stub/down"
watch
rc_is 0 "a pass with a box down exits 0"
line '^m1 +air +unreachable +did not answer over SSH$' "a task on a box that did not answer is unreachable"
line '^b1 +air +unreachable' "every task on that box is unreachable"
line '^f1 +contabo +finished' "the other box still reports"
line '^ALERT m1 on air: working -> unreachable$' "a box going down alerts its tasks"
line '^ALERT b1 on air: finished -> unreachable$' "a finished task on a down box alerts too"
same "$(alerts)" 3 "only the down box's tasks alert"
rm "$AH/.stub/down"
watch
line '^ALERT m1 on air: unreachable -> working$' "a box coming back alerts its tasks' real state"

# ---- the agent finishes
report "$CH" c1 "BLOCKED: the template is stale."
watch
line '^ALERT c1 on contabo: crashed -> finished$' "a report set to BLOCKED alerts crashed -> finished"
line '^c1 +contabo +finished +BLOCKED: the template is stale\.$' "a one-sentence Status line is shown whole"

# ---- records come and go
git -C "$L" config devbox-task.z1.box mini
watch
rc_is 0 "a record naming an unknown box does not stop the pass"
line '^z1 +mini +unreachable +no box .mini.' "a record naming an unknown box is unreachable, with the reason"
line '^w1 +contabo +crashed' "the known boxes still report beside an unknown one"
[ -e "$STATE/c1" ] || fail "a recorded task keeps its state file"; pass "a recorded task keeps its state file"
git -C "$L" config --unset devbox-task.c1.box
git -C "$L" config --unset devbox-task.z1.box
watch
rc_is 0 "a pass after a record is gone"
[ ! -e "$STATE/c1" ] || fail "the state of a task whose record is gone is removed"; pass "the state of a task whose record is gone is removed"
no_line '^c1 ' "a task whose record is gone is not shown"
same "$(alerts)" 0 "a record going away raises no alert"
report "$CH" c1 "TODO: DONE or BLOCKED, then one line on the outcome"
git -C "$L" config devbox-task.c1.box contabo
watch
line '^ALERT c1 on contabo: unseen -> crashed$' "a task recorded again starts from unseen"

# ---- --every repeats the pass
OUT="$(/bin/bash "$L/scripts/devenv/task.sh" watch --every 1 2>&1 & p=$!; sleep 2.5; kill $p; wait $p 2>/dev/null)" || true
[ "$(echo "$OUT" | grep -c '^== ')" -ge 2 ] || fail "--every repeats the pass"; pass "--every repeats the pass"

# ---- a DONE report counts only once the env's Definition of Done passes (#1611's "DONE (draft, ...)")
dod_stub() {   # dod_stub <box home root> <task> <exit code of dod.py check>
  local d; d="$(wt "$1" "$2")/scripts/devenv"; mkdir -p "$d"
  printf 'import sys\nsys.exit(%s)\n' "$3" > "$d/dod.py"
}
dod_stub "$CROOT" f1 1
watch
line '^f1 +contabo +working *$' "alive with a DONE report but a failing Definition of Done is still working"
line '^ALERT f1 on contabo: finished -> working$' "a task found unfinished alerts"
dod_stub "$CROOT" f1 0
watch
line '^f1 +contabo +finished +Done: task.sh watch reports each agent\.$' "alive with DONE and a passing Definition of Done is finished"
grep -v '^4102 ' "$CH/.stub/procs" > "$T/p" && mv "$T/p" "$CH/.stub/procs"
dod_stub "$CROOT" f1 1
watch
line '^f1 +contabo +crashed *$' "an agent gone with DONE but a failing Definition of Done crashed"
rm -rf "$(wt "$CROOT" f1)"
echo "4102 claude $(wt "$CROOT" f1)" >> "$CH/.stub/procs"

# ---- pick: the box a start without --box gets
pick() { run /bin/bash "$L/scripts/devenv/task.sh" pick "$@"; }
# contabo: f1 alive and finished, w1 and c1 dead. air: m1 working, b1 finished, x1 crashed.
pick
rc_is 0 "pick without devbox.order exits 0"
line '^box +contabo .*\[the default\]$' "without devbox.order the default box is picked"
same "$(echo "$OUT" | grep -c '^  ')" 0 "without devbox.order no box is asked"

git -C "$L" config devbox-task.m2.box air
cat >> "$AH/.stub/procs" <<EOF
5104 claude.exe $(wt "$AROOT" m2)
EOF
report "$AH" m2
git config -f "$R" devbox.order "air contabo"
git config -f "$R" box.air.agents 3
fresh_log
pick
rc_is 0 "pick with a free agent on the first box exits 0"
line '^  air: 2 of 3 agents working$' "only working agents count: a finished or crashed one frees its place"
line '^box +air .*\[picked by devbox.order \(air contabo\): 2 of 3 agents working\]$' "the first box in the order with a free agent is picked, with why"
no_line '^  contabo:' "a later box is not asked once one is picked"
same "$(grep -c '^ssh ' "$STUB_LOG")" 1 "one SSH for the one box asked"

git config -f "$R" box.air.agents 2
pick
line '^  air: 2 of 2 agents working$' "a full box says so"
line '^  contabo: 0 of 1 agents working$' "the next box in the order is asked"
line '^box +contabo .*\[picked by devbox.order \(air contabo\): 0 of 1 agents working\]$' "a full first box passes the task to the next"

touch "$AH/.stub/down"
pick
line '^  air: did not answer over SSH \(exit 255\)$' "a box that does not answer is named"
line '^box +contabo ' "a box that does not answer is passed over"
rm "$AH/.stub/down"

git config -f "$R" devbox.order "mini air"
pick
line '^  mini: no box .mini.' "a box missing from the registry is named and passed over"

git config -f "$R" devbox.order "air"
pick
rc_is 1 "pick exits 1 when no box in the order has a free agent"
line '^STOP  no box in devbox.order \(air\) has a free agent' "the refusal says why and what to do"

echo; echo "all $N checks passed"
