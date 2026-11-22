#!/bin/bash
# Tests that task.sh start says "Claude is working" only once the agent's first real reply is in its session log,
# stops at once on a synthetic one (an error Claude Code wrote itself, such as "Not logged in"), and shows the
# terminal's last lines when no reply comes in DEVBOX_REPLY_WAIT seconds. A temp laptop repo, a temp registry with
# one stub box, and stub ssh, scp and orca on PATH: the orca stub writes the box's session log on launch, as the
# real one leaves it under ~/.claude/projects/<worktree path with every non-alphanumeric character as ->/.
# No network, no real box, nothing outside a fresh folder under $TMPDIR, which each run leaves in place.
# Run: /bin/bash scripts/devenv/test_task_start_reply.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
T="$(mktemp -d "${TMPDIR:-/tmp}/test_task_start_reply.XXXXXX")"
echo "scratch: $T"
OUT="" RC=0 N=0
fail() { echo "FAIL  $1"; echo "----- output (exit $RC):"; echo "$OUT"; exit 1; }
pass() { N=$((N + 1)); echo "ok    $1"; }
run() { RC=0; OUT="$("$@" 2>&1)" || RC=$?; }
rc_is() { [ "$RC" = "$1" ] || fail "$2 (exit $RC, want $1)"; pass "$2"; }
has() { case "$OUT" in *"$1"*) pass "$2" ;; *) fail "$2 (output lacks: $1)" ;; esac; }
lacks() { case "$OUT" in *"$1"*) fail "$2 (output has: $1)" ;; *) pass "$2" ;; esac; }
log_has() { grep -qF -- "$1" "$STUB_LOG" || fail "$2 (stub log lacks: $1)"; pass "$2"; }

# ---- stubs. ssh and scp run the remote side locally, with $STUB_BOXES/<ssh target> as the box user's home.
mkdir -p "$T/bin" "$T/boxes"
ln -s /bin/bash "$T/bin/bash"
cat > "$T/bin/ssh" <<'EOF'
#!/bin/bash
echo "ssh $*" >> "$STUB_LOG"
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
# STUB_REPLY: what the launch leaves in the session log: real, synthetic, or none. STUB_SCREEN: the terminal's screen.
cat > "$T/bin/orca" <<'EOF'
#!/bin/bash
echo "orca $*" >> "$STUB_LOG"
case "$1 $2" in
  "terminal list") echo "term_t1  claude" ;;
  "terminal read") printf '%s\n' "$STUB_SCREEN" ;;
  "agent launch")
    for a in "$@"; do case "$a" in path:*) wt="${a#path:}" ;; esac; done
    d="$STUB_CLAUDE_HOME/projects/$(cd "$wt" && pwd -P | sed 's/[^A-Za-z0-9]/-/g')"; mkdir -p "$d"
    case "$STUB_REPLY" in
      real) echo '{"type":"assistant","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"Reading the brief."}]}}' > "$d/s1.jsonl" ;;
      synthetic) printf '%s\n%s\n' '{"type":"user","message":{"role":"user","content":"the prompt"}}' \
        '{"type":"assistant","message":{"model":"<synthetic>","content":[{"type":"text","text":"Not logged in · Please run /login"}]},"error":"authentication_failed"}' > "$d/s1.jsonl" ;;
    esac ;;
esac
EOF
chmod +x "$T/bin/ssh" "$T/bin/scp" "$T/bin/orca"
export PATH="$T/bin:$PATH" STUB_BOXES="$T/boxes" STUB_LOG="$T/stub.log" STUB_REPLY=real STUB_SCREEN="> claude"
export STUB_CLAUDE_HOME="$T/boxes/t@contabo-test/.claude" DEVBOX_CLAUDE_HOME="$T/laptop-claude" XDG_STATE_HOME="$T/state"
mkdir -p "$DEVBOX_CLAUDE_HOME" "$STUB_CLAUDE_HOME"
: > "$STUB_LOG"

R="$T/boxes.conf"; export DEVBOX_REGISTRY="$R"
git config -f "$R" devbox.default contabo
git config -f "$R" box.contabo.ssh t@contabo-test
git config -f "$R" box.contabo.checkout work/x/variants/master
git config -f "$R" box.contabo.orca env:test-orca

L="$T/laptop"; mkdir -p "$L/scripts/devenv"
cp "$HERE/boxes.sh" "$HERE/task.sh" "$HERE/handoff.sh" "$HERE/landed.sh" "$HERE/brief_skills.py" "$L/scripts/devenv/"
cat > "$L/scripts/devenv/devenv.sh" <<'EOF'
#!/bin/bash
# Stands in for devenv.sh on a test box: an env is a worktree of the box's checkout.
set -e
wt="$(cd ../.. && pwd)/benches/$2/apps/nirmaan_stack"
case "$1" in create) git worktree add -q "$wt" "$4"; echo "Ready $2" ;; esac
EOF
printf 'import sys\nprint("ok    test dod", sys.argv[1])\n' > "$L/scripts/devenv/dod.py"
chmod +x "$L/scripts/devenv/devenv.sh"
git -C "$L" init -q -b master
git -C "$L" add -A
git -C "$L" -c user.name=test -c user.email=test@example.com commit -q --no-verify -m base
git clone -q "$L" "$T/boxes/t@contabo-test/work/x/variants/master"
echo "# Task: experiment: the brief" > "$T/brief.md"
start() { : > "$STUB_LOG"; run env ${TASK_ENV:-} /bin/bash "$L/scripts/devenv/task.sh" start "$@" --brief "$T/brief.md"; }
wt() { echo "$(cd "$T/boxes/t@contabo-test/work/x" && pwd -P)/benches/$1/apps/nirmaan_stack"; }
project() { echo "$STUB_CLAUDE_HOME/projects/$(wt "$1" | sed 's/[^A-Za-z0-9]/-/g')"; }

# ---- a real first reply
start t1
rc_is 0 "start with a real first reply exits 0"
has "Claude is working in 't1'" "a real first reply is Claude working"
[ -f "$(project t1)/s1.jsonl" ] || fail "the stub left the session log where Claude Code does"; pass "the stub left the session log where Claude Code does"

# ---- a synthetic reply: Claude Code's own error, the prompt dropped (#1698: "Not logged in", one idle hour)
STUB_REPLY=synthetic start t2
rc_is 1 "a synthetic first reply exits 1"
lacks "Claude is working" "a synthetic first reply is not Claude working"
has "STOP  Claude in 't2' stopped before the task: Not logged in · Please run /login" "the stop quotes Claude Code's own text"
has "in Orca (box contabo)" "the stop says where to fix it"
has "rerun task.sh start t2" "the stop says how to resend the task"
has "reuses the branch, record, brief and env" "the stop says why the rerun is safe"

# ---- no reply at all: an old session log does not count, and the terminal's last lines are shown
mkdir -p "$(project t3)"
echo '{"type":"assistant","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"old"}]}}' > "$(project t3)/old.jsonl"
touch -t "$(date -v-10M '+%Y%m%d%H%M' 2>/dev/null || date -d '10 minutes ago' '+%Y%m%d%H%M')" "$(project t3)/old.jsonl"
STUB_REPLY=none STUB_SCREEN=$'Welcome to Claude Code\n> ' TASK_ENV="DEVBOX_REPLY_WAIT=1" start t3
rc_is 1 "no reply within DEVBOX_REPLY_WAIT exits 1"
lacks "Claude is working" "no reply is not Claude working"
has "STOP  no reply from Claude in 't3' after 1 s" "the stop names the wait"
has "Welcome to Claude Code" "the stop shows the terminal's last lines"
log_has "orca terminal read --environment test-orca --terminal term_t1 --screen --limit 15" "the last lines come from the env's terminal on the box's Orca server"
has "rerun task.sh start t3" "the stop says how to resend the task"
[ "$(grep -c '^ssh .*python3 - ' "$STUB_LOG")" -ge 1 ] || fail "the reply is read over SSH"; pass "the reply is read over SSH"

# ---- a rerun after the fix reuses everything and only starts Claude again
STUB_REPLY=real start t3
rc_is 0 "a rerun of start after a timeout exits 0"
has "box/t3 exists" "the rerun reuses the branch"; has "env t3 exists" "the rerun reuses the env"
has "Claude is working in 't3'" "the rerun sees the new reply"

echo; echo "all $N checks passed"
