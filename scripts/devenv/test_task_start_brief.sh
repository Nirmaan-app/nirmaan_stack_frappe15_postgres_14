#!/bin/bash
# Tests that task.sh start refuses a brief naming a skill only a person can start, before it touches the box or git.
# A temp laptop repo, a temp registry with one stub box whose ssh only logs and fails, and a fake Claude home.
# No network, no real box, nothing outside a fresh folder under $TMPDIR, which each run leaves in place.
# Run: /bin/bash scripts/devenv/test_task_start_brief.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
T="$(mktemp -d "${TMPDIR:-/tmp}/test_task_start_brief.XXXXXX")"
echo "scratch: $T"
OUT="" RC=0 N=0
fail() { echo "FAIL  $1"; echo "----- output (exit $RC):"; echo "$OUT"; exit 1; }
pass() { N=$((N + 1)); echo "ok    $1"; }
run() { RC=0; OUT="$("$@" 2>&1)" || RC=$?; }

mkdir -p "$T/bin"
cat > "$T/bin/ssh" <<'EOF'
#!/bin/bash
echo "ssh $*" >> "$SSH_LOG"
exit 255
EOF
cp "$T/bin/ssh" "$T/bin/scp"
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" SSH_LOG="$T/ssh.log" XDG_STATE_HOME="$T/state"

R="$T/boxes.conf"; export DEVBOX_REGISTRY="$R"
git config -f "$R" devbox.default air
git config -f "$R" box.air.ssh me@air-test
git config -f "$R" box.air.checkout work/y/variants/master

CH="$T/claude"; P="$T/cache/tools/1.0/skills"
mkdir -p "$CH/plugins" "$P/build-all" "$P/test-first"
printf -- '---\nname: build-all\ndescription: x\ndisable-model-invocation: true\n---\n' > "$P/build-all/SKILL.md"
printf -- '---\nname: test-first\ndescription: x\n---\n' > "$P/test-first/SKILL.md"
echo '{"enabledPlugins": {"tools@market": true}}' > "$CH/settings.json"
echo "{\"plugins\": {\"tools@market\": [{\"installPath\": \"$T/cache/tools/1.0\"}]}}" > "$CH/plugins/installed_plugins.json"
export DEVBOX_CLAUDE_HOME="$CH"

L="$T/laptop"; mkdir -p "$L/scripts/devenv"
cp "$HERE/boxes.sh" "$HERE/task.sh" "$HERE/brief_skills.py" "$L/scripts/devenv/"
git -C "$L" init -q -b master
git -C "$L" add -A
git -C "$L" -c user.name=test -c user.email=test@example.com commit -q --no-verify -m base
start() { : > "$SSH_LOG"; run /bin/bash "$L/scripts/devenv/task.sh" start "$@"; }

echo 'Call the Skill tool with `tools:build-all` to run the build.' > "$T/bad.md"
start t1 --box air --brief "$T/bad.md" --no-agent
[ "$RC" = 1 ] || fail "a brief naming a user-only skill exits 1 (exit $RC)"; pass "a brief naming a user-only skill exits 1"
echo "$OUT" | grep -q '^tools:build-all$' || fail "it names the skill"; pass "it names the skill"
echo "$OUT" | grep -q 'only a person can start' || fail "it says why"; pass "it says why"
[ ! -s "$SSH_LOG" ] || fail "it never reaches the box ($(cat "$SSH_LOG"))"; pass "it never reaches the box"
! git -C "$L" rev-parse -q --verify refs/heads/box/t1 >/dev/null || fail "it makes no branch"; pass "it makes no branch"
[ -z "$(git -C "$L" config devbox-task.t1.box || true)" ] || fail "it records no task"; pass "it records no task"

echo 'Call the Skill tool with `tools:test-first` before the first test.' > "$T/good.md"
start t2 --box air --brief "$T/good.md" --no-agent
! echo "$OUT" | grep -q 'only a person can start' || fail "a brief naming an agent skill passes the check"
pass "a brief naming an agent skill passes the check"
[ -s "$SSH_LOG" ] || fail "and goes on to the box"; pass "and goes on to the box"

echo "PASS  $N checks"
