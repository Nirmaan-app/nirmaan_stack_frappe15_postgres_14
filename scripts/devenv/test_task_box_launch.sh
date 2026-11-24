#!/bin/bash
# Tests box launches (box.<box>.launch = box): the box names the person by the SSH key that connected, refuses an
# unknown key, a missing or signed-out account and a task name without the person's prefix before anything changes,
# starts Claude as that person's Orca account under a lock, proves the process uses that account's config dir (else
# stops it), puts Orca's selection back, records who and which account, and finds the first reply in that account's
# session logs. A person without a git identity is refused before anything changes; a launch sets the person's git
# identity in that env only, so its commits carry it and the box's main checkout and other envs keep theirs. The laptop runs with no orca CLI. A box without the key still launches through the laptop's Orca.
# A temp laptop repo, a temp registry, stub ssh (it hands the box side $SSH_USER_AUTH as sshd's ExposeAuthInfo does),
# scp, orca-ide on the box and orca on the laptop, and a fake /proc (DEVBOX_PROC). No network, no real box, nothing
# outside a fresh folder under $TMPDIR, which each run leaves in place.
# Run: /bin/bash scripts/devenv/test_task_box_launch.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
T="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/test_task_box_launch.XXXXXX")" && pwd -P)"
echo "scratch: $T"
OUT="" RC=0 N=0
fail() { echo "FAIL  $1"; echo "----- output (exit $RC):"; echo "$OUT"; exit 1; }
pass() { N=$((N + 1)); echo "ok    $1"; }
run() { RC=0; OUT="$("$@" 2>&1)" || RC=$?; }
rc_is() { [ "$RC" = "$1" ] || fail "$2 (exit $RC, want $1)"; pass "$2"; }
has() { case "$OUT" in *"$1"*) pass "$2" ;; *) fail "$2 (output lacks: $1)" ;; esac; }
lacks() { case "$OUT" in *"$1"*) fail "$2 (output has: $1)" ;; *) pass "$2" ;; esac; }
log_has() { grep -qF -- "$1" "$STUB_LOG" || fail "$2 (stub log lacks: $1)"; pass "$2"; }
log_lacks() { ! grep -qF -- "$1" "$STUB_LOG" || fail "$2 (stub log has: $1)"; pass "$2"; }
same() { [ "$1" = "$2" ] || fail "$3 (got '$1', want '$2')"; pass "$3"; }

BOXH="$T/boxes/t@r7-test"; CO="$BOXH/work/x/variants/master"; PROC="$T/proc"
PROFILES="$BOXH/.config/orca/claude-profiles"
mkdir -p "$T/bin" "$T/laptop-orca" "$T/laptop-home" "$PROC" "$BOXH/.claude"
ln -s /bin/bash "$T/bin/bash"
# ---- stubs. ssh runs the box side locally with $STUB_BOXES/<target> as home, and, when STUB_KEY is set, writes the
# file sshd's ExposeAuthInfo names in $SSH_USER_AUTH.
cat > "$T/bin/ssh" <<'EOF'
#!/bin/bash
echo "ssh $*" >> "$STUB_LOG"
while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -t|-q) shift ;; *) break ;; esac; done
home="$STUB_BOXES/$1"; shift
unset SSH_USER_AUTH
if [ -n "${STUB_KEY:-}" ]; then
  export SSH_USER_AUTH="$STUB_BOXES/.auth-$$"; printf 'publickey ssh-ed25519 %s\n' "$STUB_KEY" > "$SSH_USER_AUTH"
fi
mkdir -p "$home"; cd "$home" && HOME="$home" exec bash -c "$*"
EOF
cat > "$T/bin/scp" <<'EOF'
#!/bin/bash
args=(); while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -q) shift ;; *) args+=("$1"); shift ;; esac; done
at() { case "$1" in *@*:*) p="${1#*:}"; echo "$STUB_BOXES/${1%%:*}/${p#\~/}" ;; *) echo "$1" ;; esac; }
cp "$(at "${args[0]}")" "$(at "${args[1]}")"
EOF
# orca-ide on the box. Its account selection is one file, as Orca's is one setting per host. A launch waits
# STUB_LAUNCH_SLEEP seconds, then starts a fake claude process (an entry in $DEVBOX_PROC) with the config dir of the
# account selected at that moment (STUB_WRONG_HOME overrides it) and writes the session log STUB_REPLY says there.
cat > "$T/bin/orca-ide" <<'EOF'
#!/bin/bash
echo "orca-ide $*" >> "$STUB_LOG"
sel="$(cat "$HOME/.orca-selected" 2>/dev/null || echo system)"
case "$1 $2" in
  "account list")
    active=null; [ "$sel" = system ] || active="\"$sel\""
    sed "s|@ACTIVE@|$active|; s|@P@|$HOME/.config/orca/claude-profiles|g" "$HOME/.orca-accounts.json" ;;
  "account select")
    for a in "$@"; do [ "${prev:-}" = --account ] && echo "$a" > "$HOME/.orca-selected"; prev="$a"; done ;;
  "agent launch")
    # Real Orca answers at once and starts Claude in the background; STUB_SEED does the same.
    if [ -n "${STUB_SEED:-}" ] && [ -z "${STUB_CHILD:-}" ]; then STUB_CHILD=1 "$0" "$@" >/dev/null 2>&1 & exit 0; fi
    for a in "$@"; do case "$a" in path:*) wt="${a#path:}" ;; esac; [ "${prev:-}" = --prompt ] && printf '%s' "$a" > "$HOME/.last-prompt"; prev="$a"; done
    if [ -n "${STUB_SEED:-}" ]; then   # Orca's first, short-lived claude that seeds the session; it ends after 1 s
      seed="$DEVBOX_PROC/${$}9"; mkdir -p "$seed"; echo claude > "$seed/comm"; ln -s "$wt" "$seed/cwd"; printf 'PATH=/bin\0' > "$seed/environ"
      sleep 1; echo exited > "$seed/comm"; sleep 1
    fi
    sleep "${STUB_LAUNCH_SLEEP:-0}"
    sel="$(cat "$HOME/.orca-selected" 2>/dev/null || echo system)"
    cfg=""; [ "$sel" = system ] || cfg="$HOME/.config/orca/claude-profiles/$sel/home"
    cfg="${STUB_WRONG_HOME:-$cfg}"
    echo "spawned $(basename "$(dirname "$(dirname "$wt")")") as $sel" >> "$STUB_LOG"
    pid=$$; mkdir -p "$DEVBOX_PROC/$pid"; echo claude > "$DEVBOX_PROC/$pid/comm"; ln -s "$wt" "$DEVBOX_PROC/$pid/cwd"
    if [ -n "$cfg" ]; then printf 'PATH=/bin\0CLAUDE_CONFIG_DIR=%s\0' "$cfg"; else printf 'PATH=/bin\0'; fi > "$DEVBOX_PROC/$pid/environ"
    d="${cfg:-$HOME/.claude}/projects/$(cd "$wt" && pwd -P | sed 's/[^A-Za-z0-9]/-/g')"; mkdir -p "$d"
    case "${STUB_REPLY:-real}" in
      real) echo '{"type":"assistant","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"Reading the brief."}]}}' > "$d/s1.jsonl" ;;
      synthetic) echo '{"type":"assistant","message":{"model":"<synthetic>","content":[{"type":"text","text":"Not logged in · Please run /login"}]}}' > "$d/s1.jsonl" ;;
    esac ;;
  "terminal list")
    for p in "$DEVBOX_PROC"/*; do [ -L "$p/cwd" ] || continue
      for a in "$@"; do [ "$a" = "path:$(readlink "$p/cwd")" ] && echo "term_${p##*/}  claude"; done; done ;;
  "terminal close")
    for a in "$@"; do case "$a" in term_*) rm -rf "${DEVBOX_PROC:?}/${a#term_}" ;; esac; done ;;
  "terminal read") printf '%s\n' "${STUB_SCREEN:-> claude}" ;;
esac
EOF
# orca on the laptop, for the box that still launches through it. Box launches run with a PATH that lacks it.
cat > "$T/laptop-orca/orca" <<'EOF'
#!/bin/bash
echo "laptop-orca $*" >> "$STUB_LOG"
case "$1 $2" in
  "terminal list") echo "term_t1  claude" ;;
  "agent launch")
    for a in "$@"; do case "$a" in path:*) wt="${a#path:}" ;; esac; done
    d="$STUB_BOXES/t@air-test/.claude/projects/$(cd "$wt" && pwd -P | sed 's/[^A-Za-z0-9]/-/g')"; mkdir -p "$d"
    echo '{"type":"assistant","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"hi"}]}}' > "$d/s1.jsonl" ;;
esac
EOF
chmod +x "$T/bin/ssh" "$T/bin/scp" "$T/bin/orca-ide" "$T/laptop-orca/orca"
export PATH="$T/bin:/usr/bin:/bin" HOME="$T/laptop-home" STUB_BOXES="$T/boxes" STUB_LOG="$T/stub.log" DEVBOX_PROC="$PROC"
export DEVBOX_CLAUDE_HOME="$T/laptop-claude" XDG_STATE_HOME="$T/state" DEVBOX_LAUNCH_SETTLE=0
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
mkdir -p "$DEVBOX_CLAUDE_HOME"
: > "$STUB_LOG"
command -v orca >/dev/null && { echo "FAIL  an orca CLI is on the test PATH"; exit 1; }
[ ! -e "$HOME/Applications/Orca.app" ] || { echo "FAIL  an Orca.app in the test HOME"; exit 1; }

# ---- the box's people and accounts
cat > "$BOXH/.orca-accounts.json" <<'EOF'
{"ok": true, "result": {"claude": {"accounts": [
  {"id": "acct-madhu", "email": "madhu@example.com", "home": "@P@/acct-madhu/home"},
  {"id": "acct-late", "email": "late@example.com", "home": "@P@/acct-late/home"}],
  "activeAccountId": @ACTIVE@}}}
EOF
mkdir -p "$PROFILES/acct-madhu/home" "$PROFILES/acct-late/home"
echo '{"oauthAccount": {"emailAddress": "owner@example.com"}}' > "$BOXH/.claude.json"
echo '{"oauthAccount": {"emailAddress": "madhu@example.com"}}' > "$PROFILES/acct-madhu/home/.claude.json"
echo '{"projects": {}}' > "$PROFILES/acct-late/home/.claude.json"
P="$BOXH/.config/devbox/people.conf"; mkdir -p "$(dirname "$P")"
git config -f "$P" person.abhishek.key "ssh-ed25519 AAAAowner owner-laptop"
git config -f "$P" person.abhishek.account system
git config -f "$P" person.madhu.key AAAAmadhu
git config -f "$P" person.madhu.account madhu@example.com
git config -f "$P" person.madhu.email madhu@example.com
git config -f "$P" person.madhu.prefix madhu-
git config -f "$P" person.late.key AAAAlate
git config -f "$P" person.late.account acct-late
git config -f "$P" person.gone.key AAAAgone
git config -f "$P" person.gone.account acct-gone
git config -f "$P" person.nogit.key AAAAnogit
git config -f "$P" person.nogit.account system
for p in abhishek:'Abhishek Kumar' madhu:'Madhu Balan' late:'Late Comer' gone:'Gone Away'; do
  git config -f "$P" "person.${p%%:*}.git-name" "${p#*:}"; git config -f "$P" "person.${p%%:*}.git-email" "${p%%:*}@commits.example.com"
done
printf '[user]\n\tname = Box Owner\n\temail = box-owner@example.com\n' > "$BOXH/.gitconfig"
chmod 600 "$P"

R="$T/boxes.conf"; export DEVBOX_REGISTRY="$R"
git config -f "$R" box.r7.ssh t@r7-test
git config -f "$R" box.r7.checkout work/x/variants/master
git config -f "$R" box.r7.launch box
git config -f "$R" box.air.ssh t@air-test
git config -f "$R" box.air.checkout work/x/variants/master
git config -f "$R" box.air.orca env:test-orca
git config -f "$R" devbox.default r7

L="$T/laptop"; mkdir -p "$L/scripts/devenv"
cp "$HERE/boxes.sh" "$HERE/task.sh" "$HERE/handoff.sh" "$HERE/landed.sh" "$HERE/develop.sh" "$HERE/brief_skills.py" \
  "$HERE/box_launch.py" "$L/scripts/devenv/"
cat > "$L/scripts/devenv/devenv.sh" <<'EOF'
#!/bin/bash
set -e
wt="$(cd ../.. && pwd)/benches/$2/apps/nirmaan_stack"
case "$1" in create) git worktree add -q "$wt" "$4"; echo "Ready $2" ;; esac
EOF
printf 'import sys\nprint("ok    test dod", sys.argv[1])\n' > "$L/scripts/devenv/dod.py"
chmod +x "$L/scripts/devenv/devenv.sh"
git -C "$L" init -q -b master; git -C "$L" config core.hooksPath "$T/no-hooks"
git -C "$L" add -A; git -C "$L" commit -q --no-verify -m base
git clone -q "$L" "$CO"; git clone -q "$L" "$T/boxes/t@air-test/work/x/variants/master"
git init -q --bare "$T/github.git"; git -C "$T/github.git" fetch -q "$L" master:develop
for c in "$L" "$CO" "$T/boxes/t@air-test/work/x/variants/master"; do git -C "$c" config devbox.org-repo "$T/github.git"; done
mkdir -p "$T/boxes/t@air-test/.claude"
echo "# Task: experiment: the brief" > "$T/brief.md"

start() { : > "$STUB_LOG"; run env ${TASK_ENV:-} /bin/bash "$L/scripts/devenv/task.sh" start "$@" --brief "$T/brief.md"; }
wt() { echo "$BOXH/work/x/benches/$1/apps/nirmaan_stack"; }
made() { git -C "$L" rev-parse -q --verify "refs/heads/box/$1" >/dev/null && echo branch || echo none; }
launch_file() { cat "$BOXH/claude-artifacts/dod/box-$1/LAUNCH" 2>/dev/null || true; }
procs() { ls "$PROC" | wc -l | tr -d ' '; }

# ---- refusals before anything changes: no branch, no record, nothing past the check on the box
STUB_KEY=AAAAstranger start s1
rc_is 1 "an unknown key is refused"
has "your SSH key is not in the box's people.conf" "the refusal says the key is unknown"
has "nothing was changed" "the refusal says nothing changed"
same "$(made s1)" none "an unknown key leaves no branch"
log_lacks "orca-ide" "an unknown key never reaches Orca"

STUB_KEY="" start s2
rc_is 1 "a session sshd does not name is refused"; has "ExposeAuthInfo yes" "the refusal names the sshd setting"

STUB_KEY=AAAAmadhu start t3
rc_is 1 "a name without the person's prefix is refused"; has "start it as madhu-t3" "the refusal gives the prefixed name"
same "$(made t3)" none "a name without the prefix leaves no branch"
[ -z "$(git -C "$L" config devbox-task.t3.box || true)" ] || fail "no record for t3"; pass "a name without the prefix leaves no record"

STUB_KEY=AAAAgone start s4
rc_is 1 "an account Orca lacks is refused"; has "account 'acct-gone' is not in the box's Orca" "the refusal names the account"

STUB_KEY=AAAAnogit start s16
rc_is 1 "a person without a git identity is refused"
has "people.conf gives nogit no git identity" "the refusal names the missing git identity"
has "scripts/devenv/people.sh add nogit --git-name '<name>' --git-email <email>" "the refusal gives the owner's fix"
has "nothing was changed" "the refusal says nothing changed"
same "$(made s16)" none "a person without a git identity leaves no branch"
log_lacks "orca-ide" "a person without a git identity never reaches Orca"

STUB_KEY=AAAAlate start s5
rc_is 1 "a signed-out account is refused"; has "is not signed in on the box" "the refusal says it is signed out"
same "$(made s5)" none "a signed-out account leaves no branch"

# ---- the owner: the box's own login (system)
STUB_KEY=AAAAowner start t6
rc_is 0 "the owner's start exits 0"
has "you are abhishek (people.conf); Claude runs as system, signed in as owner@example.com" "the check names the person and account"
has "Claude is working in 't6'" "the first reply in ~/.claude is found"
log_has "orca-ide account select --agent claude --account system --json" "the owner's account is selected on the box"
log_has "spawned t6 as system" "Claude starts as the selected account"
log_lacks "laptop-orca" "the laptop's orca is never called"
case "$(launch_file t6)" in *"requester=abhishek"*"account=system"*"email=owner@example.com"*"config=$BOXH/.claude"*) pass "LAUNCH records the owner and his login" ;; *) fail "LAUNCH records the owner and his login: $(launch_file t6)" ;; esac
case "$(cat "$BOXH/.last-prompt")" in *"task 't6'"*"Never push"*) pass "the prompt arrives whole on the box" ;; *) fail "the prompt arrives whole on the box" ;; esac

# ---- madhu: an Orca account; the selection goes back to what it was
STUB_KEY=AAAAmadhu start madhu-t7
rc_is 0 "madhu's start exits 0"
log_has "orca-ide account select --agent claude --account acct-madhu --json" "madhu's account is selected by its id"
log_has "spawned madhu-t7 as acct-madhu" "Claude starts as madhu's account"
same "$(cat "$BOXH/.orca-selected")" system "the box's selection is put back after the launch"
has "Claude is working in 'madhu-t7'" "the first reply is found in the account's own session logs"
case "$(launch_file madhu-t7)" in *"requester=madhu"*"email=madhu@example.com"*"config=$PROFILES/acct-madhu/home"*) pass "LAUNCH records madhu and the account" ;; *) fail "LAUNCH records madhu and the account: $(launch_file madhu-t7)" ;; esac
case "$(launch_file madhu-t7)" in *"git-name=Madhu Balan"*"git-email=madhu@commits.example.com"*) pass "LAUNCH records madhu's git identity" ;; *) fail "LAUNCH records madhu's git identity: $(launch_file madhu-t7)" ;; esac
has "commits as Madhu Balan <madhu@commits.example.com>" "the check says whom the commits will name"
python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); assert any(v.get("hasTrustDialogAccepted") for v in c["projects"].values())' \
  "$PROFILES/acct-madhu/home/.claude.json" || fail "the env is trusted in the account's .claude.json"; pass "the env is trusted in the account's .claude.json"
log_has "python3 - $(wt madhu-t7)" "the reply is read on the box"
grep -q "python3 - .*madhu-t7.* [0-9]* $PROFILES/acct-madhu/home" "$STUB_LOG" || fail "the reply probe reads the account's config dir"; pass "the reply probe reads the account's config dir"

STUB_KEY=AAAAmadhu start madhu-t7
rc_is 1 "a rerun while Claude still runs in the env is refused"; has "a Claude already runs in" "the refusal says why"

# Commits as the box makes them: the box user's HOME (its global identity is the owner's), no identity in the env.
box_git() { env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL HOME="$BOXH" git "$@"; }
box_git -C "$(wt madhu-t7)" commit -q --no-verify --allow-empty -m "madhu's work"
same "$(git -C "$(wt madhu-t7)" log -1 --format='%an <%ae> / %cn <%ce>')" \
  "Madhu Balan <madhu@commits.example.com> / Madhu Balan <madhu@commits.example.com>" "a commit in madhu's env carries madhu's identity"
same "$(box_git -C "$CO" var GIT_AUTHOR_IDENT | sed 's/>.*/>/')" "Box Owner <box-owner@example.com>" "the box's main checkout keeps the box's identity"
same "$(box_git -C "$(wt t6)" var GIT_AUTHOR_IDENT | sed 's/>.*/>/')" "Abhishek Kumar <abhishek@commits.example.com>" "another person's env keeps that person's identity"

run env STUB_KEY=AAAAmadhu /bin/bash "$L/scripts/devenv/task.sh" done madhu-t7
rc_is 0 "done exits 0"; has "launch  requester=madhu" "done shows who launched it"; has "launch  account=madhu@example.com" "done shows the account"
has "launch  git-email=madhu@commits.example.com" "done shows the git identity"
same "$(git -C "$L" log -1 --format='%an <%ae>' box/madhu-t7)" "Madhu Balan <madhu@commits.example.com>" "the commit reaches the laptop with madhu's identity"

# watch reads the agent's idle time from the account's session logs, not ~/.claude's
sed -n '/^watch_probe() {/,/^}/p' "$L/scripts/devenv/task.sh" > "$T/watch_probe.sh"
idle="$(bash -c ". '$T/watch_probe.sh'; watch_probe" | ssh t@r7-test bash -s -- work/x/variants/master madhu-t7 | awk -F'\t' '$1 == "madhu-t7" {print $4}')"
case "$idle" in [0-9]*) pass "watch finds a box launch's session log" ;; *) fail "watch finds a box launch's session log (idle '$idle')" ;; esac

# ---- Orca's two-step start: the selection stays until the resumed Claude has run unbroken for the settle time
: > "$STUB_LOG"
STUB_KEY=AAAAmadhu TASK_ENV="STUB_SEED=1 DEVBOX_LAUNCH_SETTLE=2" start madhu-t15
rc_is 0 "a two-step start (seed process, then the real one) exits 0"
log_has "spawned madhu-t15 as acct-madhu" "the real Claude starts as madhu's account, not the owner's"
same "$(cat "$BOXH/.orca-selected")" system "the selection still goes back after the settle time"

# ---- the started Claude is not the person's account: stopped and refused
n="$(procs)"
STUB_KEY=AAAAmadhu TASK_ENV="STUB_WRONG_HOME=$PROFILES/acct-late/home" start madhu-t8
rc_is 1 "a Claude on the wrong account exits 1"
has "uses $PROFILES/acct-late/home, not madhu's account madhu@example.com" "the stop names both config dirs"
has "it was stopped" "the stop says the agent was stopped"
log_has "orca-ide terminal close --terminal term_" "its terminal is closed"
same "$(procs)" "$n" "no Claude is left running in the env"
same "$(launch_file madhu-t8)" "" "a refused launch records nothing"
lacks "Claude is working" "a wrong account is not Claude working"
has "rerun task.sh start madhu-t8" "the stop says how to start again"

# ---- the first-reply wait still reads the account's session logs
STUB_KEY=AAAAmadhu TASK_ENV="STUB_REPLY=synthetic" start madhu-t9
rc_is 1 "a synthetic first reply in the account's logs exits 1"
has "Claude in 'madhu-t9' stopped before the task: Not logged in" "the synthetic reply is read from the account's logs"
STUB_KEY=AAAAmadhu TASK_ENV="STUB_REPLY=none DEVBOX_REPLY_WAIT=1 STUB_SCREEN=Welcome-to-Claude" start madhu-t10
rc_is 1 "no reply exits 1"; has "Welcome-to-Claude" "the terminal's last lines come from the box"
log_has "orca-ide terminal read --terminal term_" "the box reads its own terminal"

# ---- two launches at once: the lock keeps each select next to its own spawn
for n in t11 madhu-t12; do git -C "$CO" worktree add -q --detach "$(wt $n)"; done; echo 0 > "$T/a.rc"; echo 0 > "$T/b.rc"
: > "$STUB_LOG"
b64() { printf 'go %s' "$1" | base64 | tr -d '\n'; }
( STUB_LAUNCH_SLEEP=2 STUB_KEY=AAAAowner ssh t@r7-test python3 - launch t11 "$(wt t11)" "$(b64 t11)" < "$L/scripts/devenv/box_launch.py" > "$T/a.out" 2>&1 || echo $? > "$T/a.rc" ) &
sleep 0.5
( STUB_LAUNCH_SLEEP=2 STUB_KEY=AAAAmadhu ssh t@r7-test python3 - launch madhu-t12 "$(wt madhu-t12)" "$(b64 madhu-t12)" < "$L/scripts/devenv/box_launch.py" > "$T/b.out" 2>&1 || echo $? > "$T/b.rc" ) &
wait
OUT="$(cat "$T/a.out" "$T/b.out")"; RC="$(cat "$T/a.rc")/$(cat "$T/b.rc")"
same "$RC" "0/0" "two launches at once both prove their accounts"
has "wait  another launch is starting its Claude on the box" "the second launch waits for the first"
log_has "spawned t11 as system" "the first spawns as its own account"; log_has "spawned madhu-t12 as acct-madhu" "the second spawns as its own account"
same "$(grep -E '^(orca-ide account select|spawned)' "$STUB_LOG" | sed 's/ --json//; s/orca-ide account select --agent claude --account/select/' | tr '\n' ',')" \
  "select system,spawned t11 as system,select acct-madhu,spawned madhu-t12 as acct-madhu,select system," "select and spawn never interleave"

# ---- a launch into a folder that is not a worktree of its own sets no one's identity
mkdir -p "$CO/not-an-env"; : > "$STUB_LOG"
run env STUB_KEY=AAAAmadhu ssh t@r7-test python3 - launch madhu-t17 "$CO/not-an-env" "$(b64 madhu-t17)" < "$L/scripts/devenv/box_launch.py"
rc_is 1 "a launch into a plain folder is refused"; has "is not a git worktree of its own" "the refusal says why"
same "$(box_git -C "$CO" var GIT_AUTHOR_IDENT | sed 's/>.*/>/')" "Box Owner <box-owner@example.com>" "the enclosing checkout keeps its identity"
log_lacks "orca-ide" "a refused identity never reaches Orca"

# ---- a box without launch = box: the laptop's Orca, as before
: > "$STUB_LOG"
run env PATH="$T/laptop-orca:$PATH" /bin/bash "$L/scripts/devenv/task.sh" start t13 --box air --brief "$T/brief.md"
rc_is 0 "a laptop-launch box still starts"
log_has "laptop-orca agent launch --environment test-orca --agent claude --surface terminal --focus --worktree path:" "it launches through the laptop's Orca as before"
log_lacks "python3 - check" "it never runs box_launch.py"
log_lacks "orca-ide" "it never touches the box's orca-ide"

git config -f "$R" box.air.launch sometimes
run /bin/bash "$L/scripts/devenv/task.sh" start t14 --box air --no-agent
rc_is 1 "a bad launch value STOPs"; has "box.air.launch: laptop or box (got sometimes)" "the STOP names the key"

echo; echo "all $N checks passed"
