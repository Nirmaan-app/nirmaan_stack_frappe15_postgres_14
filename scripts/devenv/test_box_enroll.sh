#!/bin/bash
# Tests box.sh against a fake laptop and fake boxes: stub ssh, nc, orca, gh, claude, tailscale, launchctl, sudo and
# the rest on PATH, each box a folder standing in for its user's home. No network, no real host, nothing outside a
# fresh folder under $TMPDIR, which each run leaves in place. Run: /bin/bash scripts/devenv/test_box_enroll.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -P)"
T="$(mktemp -d "${TMPDIR:-/tmp}/test_box_enroll.XXXXXX")"
echo "scratch: $T"
OUT="" RC=0 N=0
GH_SECRET="ghs_SENTINEL_gh_7Hq2"        # contabo's read-only GitHub token
CLAUDE_SECRET="sk-ant-oat01-SENTINEL_cl_9Zt4"   # a pasted setup-token
fail() { echo "FAIL  $1"; echo "----- output (exit $RC):"; echo "$OUT"; exit 1; }
pass() { N=$((N + 1)); echo "ok    $1"; }
keep() { printf '%s\n' "$OUT" >> "$T/transcript"; }
run() { RC=0; OUT="$("$@" 2>&1 < /dev/null)" || RC=$?; keep; }
run_fed() { local in="$1"; shift; RC=0; OUT="$(printf '%s\n' "$in" | "$@" 2>&1)" || RC=$?; keep; }
run_tty() { RC=0; OUT="$(script -q /dev/null "$@" < /dev/null 2>&1 | tr -d '\r\004\010')" || RC=$?; keep; }
rc_is() { [ "$RC" = "$1" ] || fail "$2 (exit $RC, want $1)"; pass "$2"; }
has() { case "$OUT" in *"$1"*) pass "$2" ;; *) fail "$2 (output lacks: $1)" ;; esac; }
lacks() { case "$OUT" in *"$1"*) fail "$2 (output has: $1)" ;; *) pass "$2" ;; esac; }
same() { [ "$1" = "$2" ] || fail "$3 (got '$1', want '$2')"; pass "$3"; }
log_has() { grep -qF -- "$1" "$STUB_LOG" || fail "$2 (stub log lacks: $1)"; pass "$2"; }
log_lacks() { ! grep -qF -- "$1" "$STUB_LOG" || fail "$2 (stub log has: $1)"; pass "$2"; }
fresh_log() { STUB_LOG="$W/stub-$((N + 1)).log"; : > "$STUB_LOG"; export STUB_LOG; }
bx() { run /bin/bash "$LAP/scripts/devenv/box.sh" "$@"; }
layer() { git config -f "$R" "layer.air.$1" || echo none; }

# ---- stubs. ssh runs the remote command locally with $STUB_BOXES/<ssh target> as the box user's home, after its
# ~/.zshenv as zsh would; it refuses (255) a box whose Remote Login is off, that left the tailnet, or lacks the key.
# A box's own state that these stubs keep lives in <home>/.stub.
mkdir -p "$T/bin" "$T/apps/Orca.app/Contents/Resources/bin"
cat > "$T/bin/ssh" <<'EOF'
#!/bin/bash
echo "ssh $*" >> "$STUB_LOG"
while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -t|-q) shift ;; *) break ;; esac; done
home="$STUB_BOXES/$1"; shift
[ "$(cat "$home/.stub/remote-login" 2>/dev/null)" != off ] && [ -s "$home/.stub/tailscale" ] || exit 255
grep -qF " $(awk '{print $2}' "$STUB_KEY")" "$home/.ssh/authorized_keys" 2>/dev/null || exit 255
case "$*" in *"${STUB_FAIL_ON:-^never^}"*) exit 255 ;; esac
cd "$home" && HOME="$home" exec bash -c "[ ! -f ~/.zshenv ] || . ~/.zshenv; $*"
EOF
cat > "$T/bin/nc" <<'EOF'
#!/bin/bash
echo "nc $*" >> "$STUB_LOG"
a=("$@"); host="${a[${#a[@]}-2]}"; home="$(echo "$STUB_BOXES"/*@"$host")"
[ -s "$home/.stub/tailscale" ] || { sleep 3; echo "nc: connectx to $host port 22 (tcp) failed: Operation timed out" >&2; exit 1; }
[ "$(cat "$home/.stub/remote-login")" != off ] || { echo "nc: connectx to $host port 22 (tcp) failed: Connection refused" >&2; exit 1; }
EOF
cat > "$T/bin/sleep" <<'EOF'
#!/bin/bash
exec /bin/sleep "$(awk -v s="$1" 'BEGIN { print s / 10 }')"
EOF
cat > "$T/bin/launchctl" <<'EOF'
#!/bin/bash
echo "launchctl $*" >> "$STUB_LOG"
d="$HOME/.stub/launchd"; mkdir -p "$d"
case "$1" in
  print) [ -f "$d/${2##*/}" ] ;;
  bootstrap) touch "$d/$(plutil -extract Label raw "$3")" ;;
  bootout) [ -f "$d/${2##*/}" ] || exit 3; rm -f "$d/${2##*/}" ;;
  submit) while [ "$1" != -- ]; do shift; done; shift; nohup "$@" >/dev/null 2>&1 & ;;
  remove) ;;
  asuser) shift 2; exec "$@" ;;
  *) exit 1 ;;
esac
EOF
cat > "$T/bin/sudo" <<'EOF'
#!/bin/bash
echo "sudo $*" >> "$STUB_LOG"
[ "$1" != -v ] || exit 0
[ "$1" != -u ] || shift 2
exec "$@"
EOF
cat > "$T/bin/systemsetup" <<'EOF'
#!/bin/bash
echo "systemsetup $*" >> "$STUB_LOG"
[ "$2" != -setremotelogin ] || echo "$3" > "$HOME/.stub/remote-login"
EOF
cat > "$T/bin/tailscale" <<'EOF'
#!/bin/bash
echo "tailscale $*" >> "$STUB_LOG"
t="$(cat "$HOME/.stub/tailscale" 2>/dev/null || true)"
case "$1" in
  status) if [ -n "$t" ]; then printf '{"BackendState":"Running","CurrentTailnet":{"Name":"%s"}}\n' "$t"; else echo '{"BackendState":"NeedsLogin"}'; fi ;;
  logout) : > "$HOME/.stub/tailscale" ;;
esac
EOF
cat > "$T/bin/gh" <<'EOF'
#!/bin/bash
echo "gh $*" >> "$STUB_LOG"
acct="$(cat "$HOME/.stub/gh-account" 2>/dev/null || true)"
case "$1 $2" in
  "auth status")
    lines=""
    [ -z "${GH_TOKEN:-}" ] || lines="  ✓ Logged in to github.com account reader-bot (GH_TOKEN)"
    if [ -n "$acct" ] && { [ -z "${GH_TOKEN:-}" ] || [[ " $* " != *" --active "* ]]; }; then
      if [ -n "${STUB_GUI:-}" ]; then l="  ✓ Logged in to github.com account $acct (keyring)"; else l="  X Failed to log in to github.com account $acct (keyring)"; fi
      lines="$lines${lines:+$'\n'}$l"
    fi
    [ -n "$lines" ] || { echo "You are not logged into any GitHub hosts." >&2; exit 1; }
    echo "github.com"; echo "$lines" ;;
  "auth logout")
    [ -z "${GH_TOKEN:-}" ] || { echo "GH_TOKEN is set" >&2; exit 1; }
    [ -n "${STUB_GUI:-}" ] && [ ! -s "$HOME/.stub/gh-logout-fails" ] || { echo "the keychain is locked" >&2; exit 1; }
    : > "$HOME/.stub/gh-account" ;;
  "auth token") cat "$HOME/.stub/gh-token" ;;
  *) exit 1 ;;
esac
EOF
cat > "$T/bin/claude" <<'EOF'
#!/bin/bash
echo "claude $*" >> "$STUB_LOG"
case "$1 $2" in
  "auth status") [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && exit 0
    [ -n "${STUB_GUI:-}" ] && [ -f "$HOME/.stub/keychain" ] && [ ! -s "$HOME/.stub/keychain-denied" ] ;;
  "auth logout") [ -n "${STUB_GUI:-}" ] || exit 1; rm -f "$HOME/.stub/keychain" ;;
  *) exit 1 ;;
esac
EOF
printf '#!/bin/bash\n[ -f "$HOME/.stub/keychain" ]\n' > "$T/bin/security"
printf '#!/bin/bash\necho Test-Air\n' > "$T/bin/scutil"
printf '#!/bin/bash\nif [ -f "$HOME/.stub/uname" ]; then cat "$HOME/.stub/uname"; else exec /usr/bin/uname "$@"; fi\n' > "$T/bin/uname"
# One orca: the laptop's CLI, and on a box (HOME under $STUB_BOXES) the copy of it in the box's Orca.app.
cat > "$T/apps/Orca.app/Contents/Resources/bin/orca" <<'EOF'
#!/bin/bash
echo "orca $*" >> "$STUB_LOG"
opt() { local k="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$k" ] && { echo "$2"; return; }; shift; done; }
case "$HOME" in "$STUB_BOXES"/*)
  svc="$HOME/.stub/launchd/com.stablyai.orca.serve"; plist="$HOME/Library/LaunchAgents/com.stablyai.orca.serve.plist"
  case "$1 $2 $3" in
    "serve service install")
      if [[ " $* " == *" --dry-run "* ]]; then echo "Would write $plist:"; exit 0; fi
      mkdir -p "$HOME/.stub/launchd" "$HOME/Library/LaunchAgents" "$HOME/Library/Application Support/orca" "$HOME/Library/Logs/Orca"
      printf '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>com.stablyai.orca.serve</string></dict></plist>\n' > "$plist"
      opt --command "$@" > "$svc"; exit 0 ;;
    "serve service status") if [ -f "$svc" ]; then echo '{"state":"live"}'; else echo '{"state":"not-installed"}'; fi; exit 0 ;;
    "serve service uninstall") rm -f "$svc" "$plist"; exit 0 ;;
  esac
  [ "$1" = serve ] || exit 1
  [ ! -f "$svc" ] || { echo "another Orca serves this profile" >&2; exit 3; }
  mkdir -p "$HOME/Library/Application Support/orca"; echo $$ > "$HOME/.stub/pairing-live"
  echo "{\"pairing\":{\"url\":\"orca://pair?code=STUB:$(basename "$HOME")\"}}"
  exec /bin/sleep 600 ;;
esac
env="$(opt --environment "$@")"
boxhome() { echo "$STUB_BOXES/$(cat "$STUB_STATE/envs/$1")"; }
live() { [ -f "$STUB_STATE/envs/$1" ] || return 1; local h; h="$(boxhome "$1")"
  [ -f "$h/.stub/launchd/com.stablyai.orca.serve" ] || kill -0 "$(cat "$h/.stub/pairing-live" 2>/dev/null)" 2>/dev/null; }
case "$1 $2" in
  "environment add") c="$(opt --pairing-code "$@")"; b="${c#*STUB:}"
    kill -0 "$(cat "$STUB_BOXES/$b/.stub/pairing-live" 2>/dev/null)" 2>/dev/null || { echo "pairing failed" >&2; exit 1; }
    echo "$b" > "$STUB_STATE/envs/$(opt --name "$@")" ;;
  "environment list") for f in "$STUB_STATE"/envs/*; do [ ! -f "$f" ] || echo "{\"name\":\"$(basename "$f")\"}"; done ;;
  "environment rm") rm -f "$STUB_STATE/envs/$env" ;;
  "status --environment") live "$env" ;;
  "repo list") cat "$(boxhome "$env")/.stub/orca-repos" 2>/dev/null || true ;;
  "repo add") opt --path "$@" >> "$(boxhome "$env")/.stub/orca-repos" ;;
  "terminal create") live "$env" || exit 1; h="$(boxhome "$env")"; wt="$(opt --worktree "$@")"; wt="${wt#path:}"
    [ -d "$wt" ] || { echo "no worktree $wt" >&2; exit 1; }
    src='[ ! -f ~/.zshenv ] || . ~/.zshenv'; [ ! -s "$h/.stub/terminal-skips-zshenv" ] || src=true
    ( cd "$wt" && HOME="$h" STUB_GUI=1 bash -c "$src; $(opt --command "$@")" ) >/dev/null 2>&1 || true
    echo '{"terminal":"term_probe"}' ;;
  "terminal list") [ ! -s "$(boxhome "$env")/.stub/live-terminal" ] || echo "term_live1  claude" ;;
  "terminal close") ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$T/bin/"* "$T/apps/Orca.app/Contents/Resources/bin/orca"
printf '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>1.4.246</string></dict></plist>\n' > "$T/apps/Orca.app/Contents/Info.plist"
echo "the app" > "$T/apps/Orca.app/Contents/Resources/app.asar"
export PATH="$T/bin:$T/apps/Orca.app/Contents/Resources/bin:$PATH"
unset STUB_FAIL_ON GH_TOKEN CLAUDE_CODE_OAUTH_TOKEN BOX_STARTED

# The owner's own caffeinate, running by hand on the machine: box.sh must neither count it nor stop it.
(exec -a caffeinate /bin/sleep 3000) & CAF=$!
trap 'kill $CAF 2>/dev/null || true' EXIT

# world <name>: a fresh laptop (its home, registry, repo and dev-root CLAUDE.md), the Air as the owner left it before
# the first enroll, and contabo holding the read-only token. Sets W, R, LAP, A.
world() {
  W="$T/$1"; mkdir -p "$W"
  export HOME="$W/home" STUB_BOXES="$W/boxes" STUB_STATE="$W/state" STUB_KEY="$W/home/.ssh/id_ed25519.pub"
  mkdir -p "$HOME/.ssh" "$HOME/.config/devbox" "$STUB_STATE/envs"; fresh_log
  echo "ssh-ed25519 AAAAC3TESTLAPTOPKEY me@laptop" > "$STUB_KEY"
  R="$HOME/.config/devbox/boxes.conf"
  git config -f "$R" devbox.default contabo
  git config -f "$R" box.contabo.ssh t@contabo-test; git config -f "$R" box.contabo.checkout work/x/variants/master
  git config -f "$R" box.contabo.orca env:test-orca
  git config -f "$R" box.air.ssh me@air-test; git config -f "$R" box.air.checkout work/y/variants/master
  git config -f "$R" box.air.agents 3
  LAP="$W/dev/variants/master"; mkdir -p "$LAP/scripts/devenv"
  cp "$HERE/box.sh" "$HERE/boxes.sh" "$LAP/scripts/devenv/"
  git -C "$LAP" init -q -b master; git -C "$LAP" add -A
  git -C "$LAP" -c user.name=test -c user.email=test@example.com commit -q --no-verify -m base
  printf '# Laptop overrides\n\n| `hostname` | Machine |\n|---|---|\n| `lap.local` | the laptop |\n\n**After the table.**\n' > "$W/dev/CLAUDE.md"
  A="$STUB_BOXES/me@air-test"; mkdir -p "$A/.ssh" "$A/.stub" "$A/.config/gh"
  for d in LaunchAgents "Application Support" Logs Caches Preferences HTTPStorages; do mkdir -p "$A/Library/$d"; done   # every macOS home has these
  printf 'ssh-rsa AAAAB3OTHERKEY next@user\nssh-ed25519 AAAAC3TESTLAPTOPKEY me@laptop\n' > "$A/.ssh/authorized_keys"
  echo owner-tailnet > "$A/.stub/tailscale"; echo on > "$A/.stub/remote-login"
  echo owner-gh > "$A/.stub/gh-account"; touch "$A/.stub/keychain"
  HOME="$A" git config --global user.name "Owner Name"; HOME="$A" git config --global user.email owner@example.com
  git clone -q "$LAP" "$A/work/y/variants/master"
  printf '# Dev overrides, copied from the laptop\n\nThis copy says you are on the laptop.\n' > "$A/work/y/CLAUDE.md"
  local C="$STUB_BOXES/t@contabo-test"; mkdir -p "$C/.ssh" "$C/.stub"
  cp "$A/.ssh/authorized_keys" "$C/.ssh/"; echo owner-tailnet > "$C/.stub/tailscale"; echo "$GH_SECRET" > "$C/.stub/gh-token"
}
# Every folder and file under a box home but the stub's own state and git internals, files by content, with the
# world's path masked.
tree_sum() { (cd "$1" && find . \( -path ./.stub -o -name .git \) -prune -o -print | LC_ALL=C sort | while IFS= read -r f; do
  if [ -f "$f" ]; then printf '%s %s\n' "$f" "$(sed "s|$W|W|g" "$f" | shasum | cut -c1-12)"; else echo "$f/"; fi; done) }
register() { git config -f "$R" --get-regexp '^(layer|box)\.air\.' | grep -v -e '^layer\.air\.started ' -e '^layer\.air\.proved ' | sed "s|$W|W|g"; }
state() { echo "== register"; register; echo "== air"; tree_sum "$A"; echo "== laptop"; shasum < "$W/dev/CLAUDE.md"; ls "$STUB_STATE/envs"; }

# ---- enroll
world first
bx update air
rc_is 1 "update is reserved"; has "STOP  update is not built yet (step 4)" "update says it is step 4"
bx enroll air --sudo
rc_is 1 "an unknown option STOPs"; same "$(layer started)" none "an unknown option records nothing"
echo Linux > "$A/.stub/uname"
bx enroll air
rc_is 1 "a Linux box is refused"; has "only macOS boxes enroll" "the refusal says macOS only"
same "$(layer started)" none "a refused box gets no record"
echo Darwin > "$A/.stub/uname"

fresh_log
bx enroll air
rc_is 0 "enroll air"
has "box   air (me@air-test), checkout ~/work/y/variants/master   [named]" "enroll prints the box line first"
same "$(layer registry)" present "the registry entry is adopted"
same "$(layer tailscale)" "running owner-tailnet" "Tailscale is recorded with its tailnet"
same "$(layer remote-login)" on "Remote Login is adopted"
same "$(layer ssh-key)" AAAAC3TESTLAPTOPKEY "the laptop's key is recorded by its blob"
same "$(layer keep-awake)" absent "keep-awake records absent although the owner's caffeinate runs"
same "$(layer orca-app)" absent-dir "orca-app records that there was no ~/Applications"
same "$(layer orca-data)" absent "no Orca data before enroll"
same "$(layer orca-pair) $(layer orca-service)" "absent absent" "no pairing and no service before enroll"
same "$(layer git-identity)" "Owner Name <owner@example.com>" "the git identity is adopted"
same "$(layer gh-login)" owner-gh "the gh login is read over SSH although the keychain is locked there"
same "$(layer claude-login)" keychain "the Claude keychain login is adopted"
same "$(layer agent-env)" absent-nofile "agent-env records that there was no ~/.zshenv"
same "$(layer claude-md) $(layer laptop-row) $(layer registry-orca)" "absent absent absent" "no blocks and no route before enroll"
[ "$(layer proved)" != none ] || fail "the probe is recorded"; pass "the probe is recorded"
same "$(git config -f "$R" box.air.orca)" env:air-dev "box.air.orca is written"
log_lacks "sudo" "enroll never runs sudo"
same "$(stat -f %Lp "$A/.config/devbox/agent.env")" 600 "agent.env is 0600"
grep -qxF "export GH_TOKEN=$GH_SECRET" "$A/.config/devbox/agent.env" || fail "agent.env holds contabo's token"; pass "agent.env holds contabo's token"
same "$(cat "$A/.stub/launchd/com.stablyai.orca.serve")" "$A/Applications/Orca.app/Contents/Resources/bin/orca" "the service runs the copied app's orca"
[ -f "$A/.stub/launchd/app.devbox.keep-awake" ] || fail "the keep-awake LaunchAgent is loaded"; pass "the keep-awake LaunchAgent is loaded"
has "gh auth status: the read-only GH_TOKEN is the active account" "the probe proves agents use the read-only token"
has "claude auth status: logged in" "the probe proves Claude works in an Orca terminal"
has "note  keep air plugged in with the lid open" "enroll says to keep the lid open"
has "until someone logs in at its screen" "enroll gives the reboot note"
same "$(sed -n 1p "$A/work/y/CLAUDE.md")" "<!-- box-layer air -->" "the box block heads the Air's CLAUDE.md"
grep -qF '3 implementers' "$A/work/y/CLAUDE.md" || fail "the box block carries the agent count"; pass "the box block carries the agent count"
same "$(sed -n '7,9p' "$W/dev/CLAUDE.md" | sed -n 1p)" "<!-- box-layer air -->" "the laptop line follows the table and its blank line"
grep -qF '`Test-Air.local` is **air**' "$W/dev/CLAUDE.md" || fail "the laptop line names the Air's hostname"; pass "the laptop line names the Air's hostname"
kill -0 $CAF || fail "the owner's caffeinate still runs"; pass "the owner's caffeinate still runs"
cp "$R" "$W/registry-after-enroll"

fresh_log
bx enroll air
rc_is 0 "a second enroll"
for i in keep-awake orca-app orca-pair orca-service agent-env claude-md laptop-row registry-orca; do has "$(printf 'ok    %-13s already' "$i")" "the rerun finds $i done"; done
cmp -s "$R" "$W/registry-after-enroll" || fail "the rerun leaves the registry byte-identical"; pass "the rerun leaves the registry byte-identical"
for p in keep_awake_on "tar -C" pair_start service_on put_env zshenv_on put_file "terminal create" "environment add"; do log_lacks "$p" "the rerun does not call $p"; done
state > "$W/snapshot"; CLEAN="$W/snapshot"

# ---- box.air.orca only after the probe; the Claude setup-token fallback
world gate
echo yes > "$A/.stub/terminal-skips-zshenv"
bx enroll air
rc_is 1 "enroll stops when agents do not get the read-only token"; has "gh does not use the read-only GH_TOKEN" "the stop names the token"
same "$(git config -f "$R" box.air.orca || echo none) $(layer proved)" "none none" "no box.air.orca and no probe record before the probe passes"
: > "$A/.stub/terminal-skips-zshenv"
bx enroll air
rc_is 0 "the rerun passes the probe"; same "$(git config -f "$R" box.air.orca)" env:air-dev "box.air.orca is written once the probe passed"

world token
echo yes > "$A/.stub/keychain-denied"
bx enroll air
rc_is 4 "no Claude login for agents and nobody to paste a token is exit 4"; has "need  a Claude token for agents on air" "exit 4 says what the owner must do"
same "$(git config -f "$R" box.air.orca || echo none)" none "no box.air.orca while Claude is missing"
run_fed "$CLAUDE_SECRET" /bin/bash "$LAP/scripts/devenv/box.sh" enroll air
rc_is 0 "enroll with a pasted setup-token"; lacks "$CLAUDE_SECRET" "the pasted token is never printed"
grep -qxF "export CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_SECRET" "$A/.config/devbox/agent.env" || fail "agent.env holds the setup-token"; pass "agent.env holds the setup-token"
case "$(layer claude-token)" in "issued "*) pass "the setup-token is recorded (no value)" ;; *) fail "the setup-token is recorded" ;; esac
same "$(git config -f "$R" box.air.orca)" env:air-dev "box.air.orca is written after the token fallback"

# ---- a crash at each step, then a rerun: the same end state as one clean run, the first recorded values kept
for c in "observe:ob_tailscale" "keep-awake:keep_awake_on" "orca-app:tar -C" "orca-pair:pair_url" "orca-service:service_on" \
         "agent-env:zshenv_on" "claude-md:put_file" "laptop-row:read-only" "registry-orca:gui_read"; do
  item="${c%%:*}" at="${c#*:}"
  world "crash-$item"
  if [ "$at" = read-only ]; then chmod 555 "$W/dev"; bx enroll air; chmod 755 "$W/dev"; want=1
  else run env STUB_FAIL_ON="$at" /bin/bash "$LAP/scripts/devenv/box.sh" enroll air; want=3; fi
  rc_is $want "a crash at $item stops enroll"
  [ "$item" = observe ] || HOME="$A" git config --global user.name "Next User"
  bx enroll air
  rc_is 0 "the rerun after a crash at $item finishes"
  [ "$item" = observe ] || same "$(layer git-identity)" "Owner Name <owner@example.com>" "after a crash at $item the first git identity stays recorded"
  HOME="$A" git config --global user.name "Owner Name"
  state > "$W/snapshot"
  diff "$CLEAN" "$W/snapshot" > "$W/snapshot.diff" || fail "a crash at $item then a rerun ends as one clean run did (see $W/snapshot.diff)"
  pass "a crash at $item then a rerun ends as one clean run did"
done

# ---- release
# Every file and folder of the world, so a dry run can be shown to change nothing.
everything() { (cd "$W" && find home boxes state dev | LC_ALL=C sort | while IFS= read -r f; do
  if [ -f "$f" ]; then echo "$f $(shasum < "$f")"; else echo "$f/"; fi; done) | shasum; }
plan_id() { printf '%s\n' "$OUT" | sed -n 's/^plan \([0-9a-f]\{8\}\) .*/\1/p'; }
# What the dry run says release will do, and what release then did, in the same shape.
planned() { printf '%s\n' "$OUT" | sed -n -e 's/^plan  //p' -e '/^left  /p' | sed 's/  \[[^]]*\]$//'; }
done_lines() { printf '%s\n' "$OUT" | sed -n -e 's/^do    //p' -e '/^left  /p'; }
release() { bx release air "$@"; }
confirm_tty() { run_tty /bin/bash "$LAP/scripts/devenv/box.sh" release air --confirm "$@"; }
last_session_ssh_is_last() { awk '/^ssh .*-t me@air-test/ { s = NR } /^ssh / { l = NR } END { exit !(s && s == l) }' "$STUB_LOG"; }

world rel
PRE_AIR="$(tree_sum "$A")"; PRE_LAP="$(shasum < "$W/dev/CLAUDE.md")"; PRE_AIR_MD="$(cat "$A/work/y/CLAUDE.md")"
bx enroll air; rc_is 0 "enroll before the release tests"

bx release contabo --dry-run
rc_is 1 "release refuses a box enroll never touched"; has "box contabo was not enrolled by box.sh" "the refusal says why"
release
rc_is 1 "release without --dry-run or --confirm refuses"; has "run it with --dry-run first" "it asks for the dry run"
release --dry-run --stop-before lunch
rc_is 1 "an unknown group refuses"; has "--stop-before takes one of: agent owner orca link" "it lists the groups"
git -C "$LAP" config devbox-task.t1.box air
release --dry-run
rc_is 1 "a task record naming the box refuses"; has "tasks still on box air: t1" "the refusal names the task"
git -C "$LAP" config --unset devbox-task.t1.box
BOXCO="$A/work/y/variants/master"
git -C "$BOXCO" checkout -q -b box/t9; git -C "$BOXCO" -c user.name=a -c user.email=a@example.com commit -q --allow-empty -m "agent work"
release --dry-run
rc_is 1 "a box branch with commits the laptop lacks refuses"; has "commits this laptop lacks on: box/t9" "the refusal names the branch"
git -C "$LAP" fetch -q "$BOXCO" box/t9:box/t9
echo yes > "$A/.stub/live-terminal"
release --dry-run
rc_is 1 "a live Orca terminal refuses"; has "live terminals (term_live1)" "the refusal names the terminal"
: > "$A/.stub/live-terminal"

BEFORE="$(everything)"; fresh_log
release --dry-run
rc_is 0 "release --dry-run"; P1="$(plan_id)"; [ -n "$P1" ] || fail "the dry run ends in a plan id"; pass "the dry run ends in a plan id"
has "DELETES" "the dry run lists what release deletes"; has "  ~/Applications/Orca.app  [" "the delete list gives the app with its size"
has "  ~/.config/devbox/agent.env" "the delete list gives the token file"
same "$(everything)" "$BEFORE" "the dry run changes nothing"
log_lacks "sudo" "the dry run never runs sudo"; log_lacks "-t me@air-test" "the dry run opens no terminal session"
release --confirm deadbeef
rc_is 1 "a stale plan id refuses"; has "the plan is now $P1, not deadbeef" "the refusal prints the live plan id"
same "$(everything)" "$BEFORE" "a refused release changes nothing"

# Release up to the owner group, then enroll again: what enroll records again equals what it first recorded.
M1="$(register)"
release --dry-run --stop-before owner; P2="$(plan_id)"
release --confirm "$P2" --stop-before owner
rc_is 0 "release --stop-before owner"
same "$(layer agent-env) $(layer claude-md) $(layer laptop-row) $(layer registry-orca)" "none none none none" "the agent group's records are gone"
same "$(layer gh-login)" owner-gh "the owner group stays recorded"
same "$(git config -f "$R" box.air.orca || echo none)" none "box.air.orca is gone first"
[ ! -e "$A/.config/devbox" ] || fail "~/.config/devbox is gone"; pass "~/.config/devbox is gone"
same "$(shasum < "$W/dev/CLAUDE.md")" "$PRE_LAP" "the laptop's CLAUDE.md is byte-identical again"
same "$(cat "$A/work/y/CLAUDE.md")" "$PRE_AIR_MD" "the Air's CLAUDE.md is as it was"
bx enroll air
rc_is 0 "enroll after a partial release"; has "claude auth status: logged in" "the second enroll proves again"
same "$(register)" "$M1" "enroll records the same values a second time"

# The whole release, by the owner at a terminal.
fresh_log
release --dry-run; P3="$(plan_id)"; planned > "$W/planned"
confirm_tty "$P3"
rc_is 0 "release air, the whole layer"
done_lines > "$W/done"
diff "$W/planned" "$W/done" > "$W/plan.diff" || fail "release did exactly what the dry run listed (see $W/plan.diff)"
pass "release did exactly what the dry run listed"
[ "$(wc -l < "$W/done")" -gt 15 ] || fail "the release did each item's work"; pass "the release did each item's work"
last_session_ssh_is_last || fail "the session that ends the link is the last SSH call"; pass "the session that ends the link is the last SSH call"
has "port 22 on air-test refused: Remote Login is off" "the laptop proves Remote Login is off"
has "air-test is silent: air left the tailnet" "the laptop proves the Air left the tailnet"
has "note  delete air's device in the Tailscale admin console" "release says to delete the device in the admin console"
POST_AIR="$(tree_sum "$A")"
same "$(printf '%s\n' "$POST_AIR" | grep -v -e '^./.ssh/authorized_keys ' -e '^./.gitconfig ')" \
     "$(printf '%s\n' "$PRE_AIR" | grep -v -e '^./.ssh/authorized_keys ' -e '^./.gitconfig ')" "every folder and file on the Air is as before enroll"
same "$(cat "$A/.ssh/authorized_keys")" "ssh-rsa AAAAB3OTHERKEY next@user" "only this laptop's key left authorized_keys"
same "$(HOME="$A" git config --global user.name || echo none)" none "the owner's git identity is gone"
same "$(cat "$A/.stub/remote-login") [$(cat "$A/.stub/tailscale")]" "off []" "Remote Login is off and Tailscale logged out"
same "$(cat "$A/.stub/gh-account")[$( [ -f "$A/.stub/keychain" ] && echo keychain)]" "[]" "the gh and Claude logins are gone"
same "$(shasum < "$W/dev/CLAUDE.md")" "$PRE_LAP" "the laptop's CLAUDE.md is byte-identical"
same "$(git config -f "$R" --get-regexp '^(box|layer)\.air\.' || echo none)" none "the registry holds nothing of air"
same "$(git config -f "$R" box.contabo.ssh)" t@contabo-test "contabo's entry stays"
same "$(ls "$STUB_STATE/envs")" "" "this laptop forgot the Air's Orca"
kill -0 $CAF || fail "the owner's caffeinate still runs after release"; pass "the owner's caffeinate still runs after release"

# Run by an agent: no terminal for the password, so release stops before the link and hands the owner a command.
world agent
bx enroll air; rc_is 0 "enroll the agent-run world"
release --dry-run; fresh_log
release --confirm "$(plan_id)"
rc_is 4 "with no terminal, release stops before the link"; has "need  air's password, for sudo" "it says what the owner must give"
log_lacks "sudo" "nothing asked for sudo"; log_lacks "-t me@air-test" "no session was opened"
same "$(layer registry) $(layer tailscale) $(layer remote-login) $(layer keep-awake)" "present running owner-tailnet on none" "only the link's records remain"
P4="$(printf '%s\n' "$OUT" | sed -n 's/.*--confirm \([0-9a-f]\{8\}\).*/\1/p')"
confirm_tty "$P4"
rc_is 0 "the owner runs the printed command"; same "$(git config -f "$R" --get-regexp '^layer\.air\.' || echo none)" none "the layer is released"

# A login that cannot be logged out: release stops before the link, so the owner can fix it and rerun.
world stuck
bx enroll air; rc_is 0 "enroll the stuck world"
echo yes > "$A/.stub/gh-logout-fails"
release --dry-run; fresh_log
confirm_tty "$(plan_id)"
rc_is 1 "a gh logout that fails stops release"; has "gh-login is still on air" "the stop names the login"
has "At air, in Terminal: gh auth logout --hostname github.com --user owner-gh" "the stop gives the at-the-box command"
log_lacks "-t me@air-test" "no link session after a failed logout"
same "$(layer gh-login) $(layer tailscale)" "owner-gh running owner-tailnet" "the login and the link stay recorded"

# What the next user changed since enroll stays as they set it.
world next
bx enroll air; rc_is 0 "enroll the next-user world"
HOME="$A" git config --global user.name "Next User"; echo next-tailnet > "$A/.stub/tailscale"
echo 'export EDITOR=vi' >> "$A/.zshenv"
release --dry-run
has "left  git-identity" "the plan leaves the next user's git identity"; has "left  tailscale" "the plan leaves the next user's tailnet"
has "left  agent-env  ~/.zshenv now holds more" "the plan keeps a ~/.zshenv the next user wrote in"
confirm_tty "$(plan_id)"
rc_is 0 "release with the next user's changes"
same "$(HOME="$A" git config --global user.name)" "Next User" "the next user's git name stays"
same "$(cat "$A/.stub/tailscale")" next-tailnet "the next user's tailnet stays"
same "$(cat "$A/.zshenv")" "export EDITOR=vi" "only the devbox block left ~/.zshenv"

# The box will never answer again.
world gone
bx enroll air; rc_is 0 "enroll the gone world"
echo off > "$A/.stub/remote-login"; fresh_log
release --dry-run --box-gone
rc_is 0 "release --box-gone --dry-run with the box unreachable"
has "todo  remote-login  at air: System Settings > General > Sharing > Remote Login off" "box items become at-the-box steps"
has "plan  orca-pair  edit  orca environment rm air-dev" "the laptop's pairing is in the plan"
release --box-gone --confirm "$(plan_id)"
rc_is 0 "release --box-gone"; log_lacks "ssh " "release --box-gone never uses SSH"
same "$(git config -f "$R" --get-regexp '^(box|layer)\.air\.' || echo none)" none "the registry holds nothing of air"
same "$(shasum < "$W/dev/CLAUDE.md")" "$(printf '# Laptop overrides\n\n| `hostname` | Machine |\n|---|---|\n| `lap.local` | the laptop |\n\n**After the table.**\n' | shasum)" "the laptop's CLAUDE.md is as before"

# ---- no secret anywhere but agent.env
for s in "$GH_SECRET" "$CLAUDE_SECRET"; do
  ! grep -rqF -- "$s" "$T/transcript" "$T"/*/stub*.log "$T"/*/home "$T"/*/dev "$T"/*/snapshot 2>/dev/null || fail "a secret leaked into output, a log, the register or a repo"
  ! grep -rlF -- "$s" "$T"/*/boxes/me@air-test 2>/dev/null | grep -v '/.config/devbox/agent.env$' | grep -q . || fail "a secret leaked into a box file other than agent.env"
done
pass "no secret in any output, stub log, register, repo or box file but agent.env"

echo; echo "all $N checks passed"
