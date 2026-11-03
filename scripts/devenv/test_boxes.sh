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

echo; echo "all $N checks passed"
