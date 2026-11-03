#!/usr/bin/env bash
# Make a box a dev box this laptop hands agent tasks to, and later take only that layer off again. Run on the laptop,
# from any checkout of the repo.
#
#   box.sh enroll <box> [--gh-token-from <box>]       add the box layer. Rerun after any failure: it converges.
#   box.sh update <box>                               reserved (step 4)
#
# The box layer is CATALOG below; enroll walks it top-down. Before enroll changes anything it records what it found,
# one value per item, in [layer "<box>"] of the box registry (scripts/devenv/boxes.sh); the first value recorded
# wins. Only macOS boxes enroll. Agents get the read-only GitHub token of --gh-token-from (default: devbox.default).
# Exit 3: the box did not answer; run the same command again once it is awake. Exit 4: a step needs the owner at a
# terminal (a pasted token); the message names the command to run there.
#
# Before the first enroll, at the box, by hand (SSH cannot turn SSH on): Tailscale logged in to the owner's tailnet,
# Remote Login on, this laptop's key in ~/.ssh/authorized_keys, and the box.<box>.* entry in the registry. Enroll
# adopts them into the layer.
# The whole body sits in { ... } so bash parses it before running: editing this file mid-run is safe.
{
set -euo pipefail

die() { echo "STOP  $*" >&2; exit 1; }
ok() { echo "ok    $*"; }
need_owner() { echo "need  $*" >&2; exit 4; }
step() { echo; echo "== $*"; }

# kind  adopt: there before enroll; release takes it away.  change: enroll sets it; release puts back what enroll
#       found.  track: changes as a side effect of another item; release puts back what enroll found.
# via   where release changes it.  laptop: here.  ssh: this file's box half, over SSH.  pull: here, editing a file
#       on the box over SSH.  gui: an Orca terminal on the box, where its login keychain is open.  session:
#       release's last SSH session, the one that ends the link.
# Observing runs where the state lives (the box unless via is laptop). Applying a change item always runs here.
CATALOG='
registry       link   adopt   laptop
tailscale      link   adopt   session
remote-login   link   adopt   session
ssh-key        link   adopt   session
keep-awake     link   change  ssh
orca-app       orca   change  ssh
orca-data      orca   track   ssh
orca-pair      orca   change  laptop
orca-service   orca   change  ssh
git-identity   owner  adopt   ssh
gh-login       owner  adopt   gui
claude-login   owner  adopt   gui
agent-env      agent  change  ssh
claude-md      agent  change  pull
laptop-row     agent  change  laptop
registry-orca  agent  change  laptop
'

DEVBOX_DIR=.config/devbox                 # on the box, under its home
KEEP_AWAKE=app.devbox.keep-awake          # the LaunchAgent label
ORCA_PORT=6768                            # fixed: the laptop stores the server's endpoint when it pairs
BOX_ORCA_BIN=Applications/Orca.app/Contents/Resources/bin/orca
ZSHENV_START='# >>> devbox agent env (scripts/devenv/box.sh) >>>'
ZSHENV_END='# <<< devbox agent env <<<'
# What Orca writes under the box home, beside the app (measured on the laptop; the Air's first serve may differ).
ORCA_DATA='Library/Application Support/orca
Library/Logs/Orca
Library/Caches/com.stablyai.orca
Library/Caches/com.stablyai.orca.ShipIt
Library/Caches/orca-updater
Library/HTTPStorages/com.stablyai.orca
Library/Preferences/com.stablyai.orca.plist
.orca'
# Typed into an Orca terminal on the box, which runs the login shell as an agent's does.
PROBE='claude auth status >/dev/null 2>&1 && echo claude=ok || echo claude=no; gh auth status --active --hostname github.com 2>&1 | grep -qF "(GH_TOKEN)" && echo gh=ok || echo gh=no; echo "git=$(git config user.name)"'

# ---------------------------------------------------------------- the items: ob_<id> observe, ap_<id> apply
# ob_ prints the item's state as one line ("absent" when there is none). Functions marked "box" run on the box, in
# its home, through box_call. Most of this code runs inside $(...), where bash 3.2 drops set -e: failures that
# matter there are checked by hand.

ob_registry() { git config -f "$DEVBOX_REGISTRY" "box.$BOX_NAME.ssh" >/dev/null && echo present || echo absent; }

ts_cli() { command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale; }
ob_tailscale() {   # box: "running <tailnet>", so release leaves a tailnet the next user joined
  local j; j="$("$(ts_cli)" status --json 2>/dev/null || true)"
  printf '%s' "$j" | python3 -c 'import json, sys
try: d = json.load(sys.stdin)
except ValueError: d = {}
print("running " + (d.get("CurrentTailnet") or {}).get("Name", "?") if d.get("BackendState") == "Running" else "absent")'
}

ob_remote_login() { echo on; }   # box: the SSH session this runs in is the proof

ob_ssh_key() {   # box: <laptop key blobs>: those found in authorized_keys
  local b k=""
  for b in "$@"; do grep -qF " $b" .ssh/authorized_keys 2>/dev/null && k="$k${k:+ }$b"; done
  echo "${k:-absent}"
}

ka_plist() { echo "Library/LaunchAgents/$KEEP_AWAKE.plist"; }
ob_keep_awake() {   # box: only this label counts; a caffeinate the owner runs by hand is not the box layer's
  if launchctl print "gui/$(id -u)/$KEEP_AWAKE" >/dev/null 2>&1; then echo present
  elif [ -f "$(ka_plist)" ]; then echo stopped; else echo absent; fi
}
keep_awake_on() {   # box
  mkdir -p Library/LaunchAgents
  cat > "$(ka_plist)" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$KEEP_AWAKE</string>
  <key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-i</string><string>-s</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$KEEP_AWAKE" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$HOME/$(ka_plist)"
}
ap_keep_awake() {
  box_call keep_awake_on
  ok "keep-awake    LaunchAgent $KEEP_AWAKE runs caffeinate -i -s (no sudo; pmset, battery and lid settings unchanged)"
}

orca_version() { plutil -extract CFBundleShortVersionString raw "$1/Contents/Info.plist" 2>/dev/null || echo "?"; }
ob_orca_app() {   # box: absent-dir when there is no ~/Applications either, so release can take that away too
  if [ -d Applications/Orca.app ]; then echo present; elif [ -d Applications ]; then echo absent; else echo absent-dir; fi
}
ap_orca_app() {
  [ "$(basename "$ORCA_APP")" = Orca.app ] && [ -d "$ORCA_APP" ] || die "no Orca.app on this laptop to copy (the orca CLI is $ORCA)"
  echo "      copying Orca $(orca_version "$ORCA_APP") ($(du -sh "$ORCA_APP" | cut -f1 | tr -d ' ')) to $BOX_NAME"
  # Same version on both ends, so client and server speak one protocol; a tar stream adds no quarantine flag.
  tar -C "$(dirname "$ORCA_APP")" -cf - Orca.app | box_ssh "mkdir -p ~/Applications/.devbox-incoming && tar -C ~/Applications/.devbox-incoming -xf - && mv ~/Applications/.devbox-incoming/Orca.app ~/Applications/ && rmdir ~/Applications/.devbox-incoming"
  ok "orca-app      ~/Applications/Orca.app on $BOX_NAME, from this laptop"
}

ob_orca_data() {   # box: the paths of ORCA_DATA that exist, joined by ":"
  local p out=""
  while IFS= read -r p; do [ ! -e "$p" ] || out="$out${out:+:}$p"; done <<< "$ORCA_DATA"
  echo "${out:-absent}"
}

pair_env() { echo "$BOX_NAME-dev"; }
ob_orca_pair() {
  local l; l="$("$ORCA" environment list --json 2>/dev/null || true)"
  case "$l" in *"\"$(pair_env)\""*) echo present ;; *) echo absent ;; esac
}
orca_bin() { echo "$HOME/$BOX_ORCA_BIN"; }
pair_start() {   # box: <address the laptop reaches it at>: a foreground orca serve that prints a pairing link
  pair_stop
  mkdir -p "$DEVBOX_DIR"; chmod 700 "$DEVBOX_DIR"
  nohup "$(orca_bin)" serve --port "$ORCA_PORT" --pairing-address "$1" --json > "$DEVBOX_DIR/pair.out" 2>&1 < /dev/null &
  echo $! > "$DEVBOX_DIR/pair.pid"
}
pair_url() {   # box: the live pairing link (a server's, or one pasted at the box), "dead", or nothing yet
  local u p="$DEVBOX_DIR/pair.pid"
  if [ -f "$p" ] && ! kill -0 "$(cat "$p")" 2>/dev/null; then echo dead; return; fi
  u="$(grep -oE 'orca://pair[^"[:space:]]*' "$DEVBOX_DIR/pair.out" 2>/dev/null | awk 'NR == 1' || true)"
  echo "$u"
}
pair_stop() {   # box: stop a pairing server a run started (a crashed run's too) and forget its link
  local p="$DEVBOX_DIR/pair.pid" n=0
  if [ -f "$p" ]; then
    kill "$(cat "$p")" 2>/dev/null || true
    while kill -0 "$(cat "$p")" 2>/dev/null && [ $n -lt 20 ]; do n=$((n + 1)); sleep 0.5; done
  fi
  rm -f "$p" "$DEVBOX_DIR/pair.out"
  rmdir "$DEVBOX_DIR" 2>/dev/null || true
}
pair_help() {
  cat <<EOF
no pairing link from orca serve on $BOX_NAME (over SSH a packaged macOS Orca may refuse to start: exit 78).
      At $BOX_NAME: open ~/Applications/Orca.app, Settings > Remote Orca Servers > New Link, pick the Tailscale
      address, Generate, then in Terminal run: mkdir -p ~/$DEVBOX_DIR && pbpaste > ~/$DEVBOX_DIR/pair.out
      Quit Orca.app, then run this enroll again.
EOF
}
ap_orca_pair() {
  local url n=0
  # The docs: a running service never pairs, so pair through a foreground server first, then install the service.
  # A live server a crashed run started still holds an unused link; a dead one is replaced.
  url="$(box_call pair_url)"
  case "$url" in ""|dead) box_call pair_start "${BOX_SSH#*@}" ;; esac
  while url="$(box_call pair_url)" || exit $?; [ -z "$url" ]; do
    n=$((n + 1)); [ $n -le 15 ] || die "$(pair_help)"
    sleep 2
  done
  [ "$url" != dead ] || die "$(pair_help)"
  "$ORCA" environment add --name "$(pair_env)" --pairing-code "$url" >/dev/null
  "$ORCA" status --environment "$(pair_env)" >/dev/null || die "Orca environment $(pair_env) does not answer right after pairing"
  box_call pair_stop
  ok "orca-pair     this laptop paired with Orca on $BOX_NAME as environment $(pair_env)"
}

service_plist() { "$(orca_bin)" serve service install --dry-run 2>/dev/null | sed -n 's/^Would write \(.*\):$/\1/p' || true; }
ob_orca_service() {   # box
  [ -x "$(orca_bin)" ] || { echo absent; return; }
  local s p; s="$("$(orca_bin)" serve service status --json 2>/dev/null || true)"
  case "$s" in *'"live"'*) echo present; return ;; esac
  p="$(service_plist)"
  if [ -n "$p" ] && [ -f "$p" ]; then echo stopped; else echo absent; fi
}
service_on() {   # box: <pairing address>
  local n=0
  pair_stop
  # --command: the copied app is not on PATH, and the default must not be a launcher tied to one Orca version.
  "$(orca_bin)" serve service install --port "$ORCA_PORT" --pairing-address "$1" --command "$(orca_bin)" >/dev/null
  until [ "$(ob_orca_service)" = present ]; do
    n=$((n + 1)); [ $n -le 10 ] || die "the Orca service on $BOX_NAME is not live after 20 s (orca serve service status)"
    # Over SSH the install may miss the login session's launchd domain; load the unit there once.
    [ $n != 3 ] || launchctl bootstrap "gui/$(id -u)" "$(service_plist)" 2>/dev/null || true
    sleep 2
  done
}
ap_orca_service() {
  box_call service_on "${BOX_SSH#*@}"
  ok "orca-service  orca serve runs as a LaunchAgent on $BOX_NAME (port $ORCA_PORT), with the pairing kept"
}

ob_git_identity() {   # box
  local n e; n="$(git config --global user.name || true)"; e="$(git config --global user.email || true)"
  if [ -n "$n$e" ]; then echo "$n <$e>"; else echo absent; fi
}

ob_gh_login() {   # box: the keychain login's account; SSH sees the keychain locked, but the account name shows
  local s; s="$(gh auth status --hostname github.com 2>&1 || true)"
  s="$(printf '%s\n' "$s" | sed -n 's/.*github\.com account \([^ ]*\).*/\1/p' | awk 'NR == 1')"
  echo "${s:-absent}"
}

ob_claude_login() { security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1 && echo keychain || echo absent; }   # box

ob_agent_env() {   # box: absent-nofile when there is no ~/.zshenv either
  local f=0 z=0
  [ ! -f "$DEVBOX_DIR/agent.env" ] || f=1
  ! grep -qxF "$ZSHENV_START" .zshenv 2>/dev/null || z=1
  case "$f$z" in 11) echo present ;; 00) if [ -e .zshenv ]; then echo absent; else echo absent-nofile; fi ;; *) echo partial ;; esac
}
put_env() {   # box: <name>; its value is the line on stdin after this script. Never in argv, never printed.
  local v f="$DEVBOX_DIR/agent.env"; IFS= read -r v || true
  [ -n "$v" ] || die "no value for $1 reached $BOX_NAME"
  mkdir -p "$DEVBOX_DIR"; chmod 700 "$DEVBOX_DIR"
  ( umask 077; { grep -v "^export $1=" "$f" 2>/dev/null || true; printf 'export %s=%q\n' "$1" "$v"; } > "$f.new" )
  mv "$f.new" "$f"
}
zshenv_on() {   # box: every zsh reads ~/.zshenv, the login shells Orca terminals start included
  grep -qxF "$ZSHENV_START" .zshenv 2>/dev/null && return
  printf '%s\n%s\n%s\n' "$ZSHENV_START" "[ -r ~/$DEVBOX_DIR/agent.env ] && . ~/$DEVBOX_DIR/agent.env" "$ZSHENV_END" >> .zshenv
}
ap_agent_env() {
  local src="${GH_FROM:-$(git config -f "$DEVBOX_REGISTRY" devbox.default || true)}"
  [ -n "$src" ] && [ "$src" != "$BOX_NAME" ] || die "agents on $BOX_NAME need a read-only GitHub token from another box: pass --gh-token-from <box>"
  ( box_load "$src"; box_ssh "gh auth token --hostname github.com" ) | box_feed put_env GH_TOKEN
  box_call zshenv_on
  ok "agent-env     ~/$DEVBOX_DIR/agent.env (0600) holds GH_TOKEN, read-only, from box $src; ~/.zshenv sources it"
}

# Marker blocks in CLAUDE.md files. block_edit <box> <top|after-table> [text]: stdin to stdout without <box>'s
# block, and with [text] as a new block at the top, or before the first line after the first table and its blank.
block_edit() {
  BLOCK_TEXT="${3:-}" awk -v s="<!-- box-layer $1 -->" -v e="<!-- /box-layer $1 -->" -v where="$2" '
    function put() { if (ENVIRON["BLOCK_TEXT"] != "" && !done) { print s; print ENVIRON["BLOCK_TEXT"]; print e }; done = 1 }
    $0 == s { skip = 1; next }
    skip { if ($0 == e) skip = 0; next }
    where == "top" { put() }
    /^\|/ { table = 1 }
    where == "after-table" && table && $0 !~ /^\|/ && $0 != "" { put() }
    { print }
    END { put() }'
}
box_devroot() { echo "$HOME/$CO/../.."; }   # box: the dev root above the checkout, as task.sh finds it
get_file() { cat "$(box_devroot)/CLAUDE.md"; }   # box
put_file() { local f; f="$(box_devroot)/CLAUDE.md"; cat > "$f.devbox-new"; mv "$f.devbox-new" "$f"; }   # box: stdin after this script
host_name() { scutil --get LocalHostName; }   # box
box_file_edit() {   # [text]: the box's development/CLAUDE.md through block_edit
  local cur; cur="$(box_call get_file && echo x)" || die "no development/CLAUDE.md on $BOX_NAME to hold the box-layer block"
  printf '%s' "${cur%x}" | block_edit "$BOX_NAME" top "${1:-}" | box_feed put_file
}
ob_claude_md() { grep -qxF "<!-- box-layer $BOX_NAME -->" "$(box_devroot)/CLAUDE.md" 2>/dev/null && echo present || echo absent; }   # box
ap_claude_md() {
  local host; host="$(box_call host_name)"
  box_file_edit "**You are on box \`$BOX_NAME\` (\`$host.local\`), an agent box, not the owner's laptop.** This block wins over
anything below about which machine you are on. Never push, never open a PR, never touch GitHub issues. Run at most
${BOX_AGENTS:-1} implementers or browser walks at once. Code arrives from the owner's laptop through
\`scripts/devenv/handoff.sh\`. Data on this box older than 7 days: ask the owner before relying on it."
  ok "claude-md     the box-layer block heads $BOX_NAME's development/CLAUDE.md"
}

laptop_claude_md() { echo "$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/../../.." && pwd)/CLAUDE.md"; }
local_edit() { block_edit "$BOX_NAME" "$2" "${3:-}" < "$1" > "$1.devbox-new"; mv "$1.devbox-new" "$1"; }   # <file> <where> [text]
ob_laptop_row() { grep -qxF "<!-- box-layer $BOX_NAME -->" "$(laptop_claude_md)" 2>/dev/null && echo present || echo absent; }
ap_laptop_row() {
  local f host; f="$(laptop_claude_md)"
  [ -f "$f" ] || die "no CLAUDE.md at $f to hold the machine-table line"
  host="$(box_call host_name)"
  local_edit "$f" after-table "Also an agent box: \`$host.local\` is **$BOX_NAME** (macOS), enrolled by \`scripts/devenv/box.sh\`. Hand it work with \`task.sh start <name> --box $BOX_NAME\`."
  ok "laptop-row    $BOX_NAME's line follows the machine table in $f"
}

ob_registry_orca() { git config -f "$DEVBOX_REGISTRY" "box.$BOX_NAME.orca" || echo absent; }
ap_registry_orca() {
  # task.sh routes agents on box.<box>.orca alone, so nothing reaches the box before the probe passed.
  layer_get proved >/dev/null || prove
  git config -f "$DEVBOX_REGISTRY" "box.$BOX_NAME.orca" "env:$(pair_env)"
  ok "registry-orca box.$BOX_NAME.orca = env:$(pair_env): task.sh start <name> --box $BOX_NAME now starts agents there"
}

# box_gui <command>: run it in a new Orca terminal on the box's server, in the checkout, the way an agent starts;
# its output lands in GUI_OUT. The one route into the box's login session, where the keychain is open.
box_gui() {
  local BOX_ORCA="env:$(pair_env)" home n=0
  agent_route
  home="$(box_ssh 'printf %s "$HOME"')"
  box_call gui_reset
  "$ORCA" terminal create "${AGENT_ROUTE[@]}" --worktree "path:$home/$BOX_CO" --title devbox-probe \
    --command "{ $1 ; } > ~/$DEVBOX_DIR/gui.out 2>&1; echo __devbox_end >> ~/$DEVBOX_DIR/gui.out; exit" >/dev/null
  while GUI_OUT="$(box_call gui_read)" || exit $?; [ -z "$GUI_OUT" ]; do
    n=$((n + 1)); [ $n -le 30 ] || die "no answer from the Orca terminal on $BOX_NAME after 60 s: look at its screen for a macOS dialog (click Always Allow), then rerun"
    sleep 2
  done
}
gui_reset() { mkdir -p "$DEVBOX_DIR"; chmod 700 "$DEVBOX_DIR"; rm -f "$DEVBOX_DIR/gui.out"; }   # box
gui_read() {   # box: the output once the command finished, then forget it
  local f="$DEVBOX_DIR/gui.out"
  [ "$(tail -1 "$f" 2>/dev/null)" = __devbox_end ] || return 0
  sed '$d' "$f"; rm -f "$f"; rmdir "$DEVBOX_DIR" 2>/dev/null || true
}

# ---------------------------------------------------------------- on the box (this file, piped in by box_call)
if [ "${1:-}" = _box ]; then
  CO="$2" BOX_NAME="$3" DRY="$4" ITEM="$5"; shift 5
  # ~/.zshenv hands every SSH command the agents' tokens; the box half reads the owner's own logins.
  unset GH_TOKEN CLAUDE_CODE_OAUTH_TOKEN
  cd "$HOME"
  "$@"
  exit
fi

# ---------------------------------------------------------------- on the laptop
SELF="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"
cd "$(git -C "$(dirname "$SELF")" rev-parse --show-toplevel)"
. "$(dirname "$SELF")/boxes.sh"
ORCA_APP="${ORCA%/Contents/Resources/bin/orca}"
DRY=0 ITEM=- GH_FROM=""
CAT=(); while read -r l; do [ -z "$l" ] || CAT+=("$l"); done <<< "$CATALOG"
row() { set -- ${CAT[$1]}; ID="$1" GROUP="$2" KIND="$3" VIA="$4"; }

# The before-register. One writer (this file, on the laptop), through git config -f.
layer_get() { git config -f "$DEVBOX_REGISTRY" "layer.$BOX_NAME.$1"; }
layer_put() {   # <key> <value>: record it unless a value is already there (the first one is the truth)
  layer_get "$1" >/dev/null && return
  [ -n "$2" ] || die "no value to record for $1"
  git config -f "$DEVBOX_REGISTRY" "layer.$BOX_NAME.$1" "$2"
}

# box_call <function> [args]: run a function of this file on the box, in its home, the way handoff.sh runs itself.
# box_feed: the same, with this function's stdin following the script, for a value that must stay out of argv.
box_args() { local q a; q="_box $(printf %q "$BOX_CO") $BOX_NAME $DRY $ITEM"; for a in "$@"; do q="$q $(printf %q "$a")"; done; echo "$q"; }
box_call() { box_ssh "bash -s -- $(box_args "$@")" < "$SELF"; }
box_feed() { { cat "$SELF"; cat; } | box_ssh "bash -s -- $(box_args "$@")"; }
laptop_keys() { cat "$HOME"/.ssh/*.pub 2>/dev/null | awk '{ print $2 }' || true; }

observe() {   # <id> <via>
  local v
  if [ "$2" = laptop ]; then v="$("ob_${1//-/_}")" || exit $?
  elif [ "$1" = ssh-key ]; then v="$(box_call ob_ssh_key $(laptop_keys))" || exit $?
  else v="$(box_call "ob_${1//-/_}")" || exit $?; fi
  [ -n "$v" ] || die "observing $1 on $BOX_NAME printed nothing"
  echo "$v"
}
enrolled() { case "$1" in registry-orca) echo "env:$(pair_env)" ;; *) echo present ;; esac; }

converge() {   # a change item: apply only the difference, then read it back
  local want cur; want="$(enrolled "$ID")"
  cur="$(observe "$ID" "$VIA")"
  if [ "$cur" = "$want" ]; then ok "$(printf '%-13s' "$ID") already"; return; fi
  "ap_${ID//-/_}" "$(layer_get "$ID")"
  cur="$(observe "$ID" "$VIA")"
  [ "$cur" = "$want" ] || die "$ID reads '$cur' after enroll set it, not '$want'"
}

prove() {
  local co l name
  step "prove     a terminal on Orca environment $(pair_env), in the checkout, the way an agent starts"
  co="$(box_ssh 'printf %s "$HOME"')/$BOX_CO"
  l="$("$ORCA" repo list --environment "$(pair_env)" 2>/dev/null || true)"
  case "$l" in *"$co"*) ;; *) "$ORCA" repo add --environment "$(pair_env)" --path "$co" >/dev/null ;; esac
  box_gui "$PROBE"
  case "$GUI_OUT" in *claude=ok*) ;; *) claude_token; box_gui "$PROBE" ;; esac
  case "$GUI_OUT" in *claude=ok*) ok "claude auth status: logged in" ;; *) die "agents on $BOX_NAME still have no Claude login" ;; esac
  case "$GUI_OUT" in
    *gh=ok*) ok "gh auth status: the read-only GH_TOKEN is the active account, so agents have no push credential" ;;
    *) die "in an Orca terminal on $BOX_NAME, gh does not use the read-only GH_TOKEN (a ~/.zshenv that agents' shells skip?)" ;;
  esac
  name="$(printf '%s\n' "$GUI_OUT" | sed -n 's/^git=//p')"
  [ -n "$name" ] || die "git has no user.name for agents on $BOX_NAME"
  ok "git user.name: $name (agents commit as you)"
  layer_put proved "$(date +%Y-%m-%dT%H:%M:%S%z)"
}

claude_token() {   # agents cannot use the keychain login: a setup-token into agent.env, pasted at a hidden prompt
  local tok=""
  echo "need  agents on $BOX_NAME cannot use your keychain Claude login."
  echo "      In another laptop terminal run \`claude setup-token\`, then paste the token here (hidden, never printed):"
  if [ -t 0 ]; then printf 'token: '; IFS= read -rs tok || true; echo; else IFS= read -r tok || true; fi
  [ -n "$tok" ] || need_owner "a Claude token for agents on $BOX_NAME. In your own terminal run: scripts/devenv/box.sh enroll $BOX_NAME"
  printf '%s\n' "$tok" | box_feed put_env CLAUDE_CODE_OAUTH_TOKEN
  layer_put claude-token "issued $(date +%F)"
  ok "agent-env     CLAUDE_CODE_OAUTH_TOKEN added (release reminds you to revoke it)"
}

enroll() {
  local i v group=""
  v="$(box_ssh uname -s)"
  [ "$v" = Darwin ] || die "box $BOX_NAME runs $v: only macOS boxes enroll"
  layer_put started "$(date +%Y-%m-%dT%H:%M:%S%z)"
  for i in "${!CAT[@]}"; do
    row "$i"; layer_get "$ID" >/dev/null && continue
    v="$(observe "$ID" "$VIA")"; layer_put "$ID" "$v"
  done
  echo "ok    every item's state before enroll is recorded in [layer \"$BOX_NAME\"] of $DEVBOX_REGISTRY"
  export BOX_STARTED=1
  for i in "${!CAT[@]}"; do
    row "$i"
    [ "$GROUP" = "$group" ] || { group="$GROUP"; step "$group"; }
    case "$KIND" in
      change) converge ;;
      *) ok "$(printf '%-13s' "$ID") $KIND: $(layer_get "$ID")" ;;
    esac
  done
  echo
  ok "enrolled $BOX_NAME. Next: scripts/devenv/task.sh start <name> --box $BOX_NAME"
  echo "note  keep $BOX_NAME plugged in with the lid open: caffeinate cannot stop lid-close sleep"
  echo "note  a reboot (a macOS update, say) takes $BOX_NAME offline until someone logs in at its screen: no auto-login is set up"
}

CMD="${1:-}"
case "$CMD" in
  enroll) ;;
  update) die "update is not built yet (step 4)" ;;
  *) sed -n '2,17p' "$SELF"; exit 1 ;;
esac
[ -n "${2:-}" ] || die "usage: box.sh $CMD <box>"
box_load "$2"; shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --gh-token-from) GH_FROM="${2:?--gh-token-from needs a box name}"; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
box_show named
enroll
exit
}
