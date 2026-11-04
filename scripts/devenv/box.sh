#!/usr/bin/env bash
# Make a box a dev box this laptop hands agent tasks to, and later take only that layer off again. Run on the laptop,
# from any checkout of the repo.
#
#   box.sh enroll <box> [--gh-token-from <box>]       add the box layer. Rerun after any failure: it converges.
#   box.sh release <box> --dry-run [<flags>]          print exactly what release would do, ending in a plan id
#   box.sh release <box> --confirm <plan> [<flags>]   do it, if the live plan is still <plan>
#       --stop-before agent|owner|orca|link           release only the groups before it (release order: agent
#                                                     owner orca link); the link stays, so enroll can run again
#       --box-gone                                    the box will never answer: undo this laptop's side, list the rest
#   box.sh update <box>                               bring the box's dev environment in line with this laptop's
#
# The box layer is CATALOG below; enroll walks it top-down, release bottom-up, and --dry-run is release with every
# effect printed instead of run. Before enroll changes anything it records what it found, one value per item, in
# [layer "<box>"] of the box registry (scripts/devenv/boxes.sh); the first value recorded wins. Release puts each
# item back to that value (an adopted item to absent) and forgets the record only once it reads so; what the next
# user changed since is left alone. Only macOS boxes enroll. Agents get the read-only GitHub token of
# --gh-token-from (default: devbox.default). Release refuses while a task record names the box, while a box/* branch
# there has commits this laptop lacks, or while its Orca has live terminals.
# Release ends by cutting its own line (Remote Login off, Tailscale logged out), last, from one SSH session that asks
# for the box's password; this laptop then proves each from outside.
# Update leaves the box layer alone and runs with tasks on the box (their branches are box/*). It hands over master
# (fast-forward only, through handoff.sh), gives the dev root this laptop's devenv.sh and CLAUDE.md (its box-layer
# blocks swapped for the box's own, its paths for the box's), each only when it differs and keeping the old copy as
# <file>.bak-update-<date>, then runs bootstrap.sh's steps there (never compose) and doctor. Replacing
# docker-compose.yml and loading fresh data are the owner's: update prints the command for each.
# Exit 3: the box did not answer; run the same command again once it is awake. Exit 4: a step needs the owner at a
# terminal (the box's password, a pasted token); the message names the command to run there.
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

# act <effect> <what> <command...>: the only way release changes anything. Under --dry-run (DRY=1) it prints the
# plan line and runs nothing; otherwise it prints the same line as "do" and runs the command.
act() {
  local eff="$1" what="$2"; shift 2
  if [ "$DRY" = 1 ]; then echo "plan  $ITEM  $eff  $what${SIZE:+  [$SIZE]}"; return 0; fi
  echo "do    $ITEM  $eff  $what"
  "$@"
}
del() {   # box: <path under the home>; nothing to do when it is missing
  [ -e "$1" ] || return 0
  SIZE="$(du -sh "$1" 2>/dev/null | cut -f1 | tr -d ' ')" act delete "~/$1" rm -rf "$1"
}

# ---------------------------------------------------------------- the items: ob_<id> observe, ap_ apply, un_ undo
# ob_ prints the item's state as one line ("absent" when there is none). un_ <old> takes the item to its release
# state through act; it returns 2 when it left something as the next user set it. Functions marked "box" run on the
# box, in its home, through box_call. Most of this code runs inside $(...), where bash 3.2 drops set -e: failures
# that matter there are checked by hand.

ob_registry() { git config -f "$DEVBOX_REGISTRY" "box.$BOX_NAME.ssh" >/dev/null && echo present || echo absent; }
un_registry() { act edit "remove [box \"$BOX_NAME\"] from $DEVBOX_REGISTRY" git config -f "$DEVBOX_REGISTRY" --remove-section "box.$BOX_NAME"; }

ts_cli() { command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale; }
ob_tailscale() {   # box: "running <tailnet>", so release leaves a tailnet the next user joined
  local j; j="$("$(ts_cli)" status --json 2>/dev/null || true)"
  printf '%s' "$j" | python3 -c 'import json, sys
try: d = json.load(sys.stdin)
except ValueError: d = {}
print("running " + (d.get("CurrentTailnet") or {}).get("Name", "?") if d.get("BackendState") == "Running" else "absent")'
}

ob_remote_login() { echo on; }   # box: the SSH session this runs in is the proof

has_key() { awk -v b="$1" '{ for (i = 1; i <= NF; i++) if ($i == b) f = 1 } END { exit !f }' .ssh/authorized_keys 2>/dev/null; }
ob_ssh_key() {   # box: <laptop key blobs>: those found in authorized_keys
  local b k=""
  for b in "$@"; do has_key "$b" && k="$k${k:+ }$b"; done
  echo "${k:-absent}"
}
drop_keys() {   # box: <blobs>: authorized_keys without the lines holding them, mode kept
  local f=.ssh/authorized_keys
  awk -v keys="$1" 'BEGIN { n = split(keys, k, " ") } { for (i = 1; i <= NF; i++) for (j = 1; j <= n; j++) if ($i == k[j]) next; print }' "$f" > "$f.devbox-new"
  chmod "$(stat -f %Lp "$f")" "$f.devbox-new"; mv "$f.devbox-new" "$f"
}

# The session items (ssh-key, remote-login, tailscale) end the link, so release changes them together, last, from a
# copy of this file staged on the box: sudo needs the session's terminal as stdin, where box_call puts the script.
end_link_box() {   # box: the session items in release order; ssh-key is followed by its blobs
  local job="sleep 3" blobs=""
  if [ "$DRY" = 0 ]; then
    rm -f "$0"
    sudo -v || { echo "need  sudo on $BOX_NAME did not take the password; nothing was changed" >&2; exit 4; }
  fi
  while [ $# -gt 0 ]; do
    ITEM="$1"
    case "$1" in
      ssh-key) blobs="$2"; shift; act edit "remove this laptop's key from ~/.ssh/authorized_keys" drop_keys "$blobs" ;;
      remote-login) act off "Remote Login: sudo systemsetup -f -setremotelogin off, in a launchd job once this session ends" true
        job="$job; systemsetup -f -setremotelogin off; sleep 20" ;;
      tailscale) act logout "tailscale logout as $(id -un), 20 s after Remote Login is off" true
        job="$job; launchctl asuser $(id -u) sudo -u $(id -un) $(printf %q "$(ts_cli)") logout" ;;
    esac
    shift
  done
  [ "$DRY" = 0 ] || return 0
  [ -z "$blobs" ] || echo "ssh-key=$(ob_ssh_key $blobs)"
  # launchd, not nohup: turning sshd off ends this session's processes. A submitted job restarts until removed.
  [ "$job" = "sleep 3" ] || sudo launchctl submit -l app.devbox.end-link -- /bin/sh -c "$job; launchctl remove app.devbox.end-link"
  echo "ok    the rest runs in launchd on $BOX_NAME; this SSH session ends now"
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
un_keep_awake() {   # box
  if launchctl print "gui/$(id -u)/$KEEP_AWAKE" >/dev/null 2>&1; then
    act off "launchd job $KEEP_AWAKE and its own caffeinate (any other caffeinate is left running)" launchctl bootout "gui/$(id -u)/$KEEP_AWAKE"
  fi
  del "$(ka_plist)"
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
un_orca_app() {   # box
  del Applications/.devbox-incoming
  del Applications/Orca.app
  [ "$1" = absent-dir ] || return 0
  if [ -n "$(ls -A Applications 2>/dev/null | grep -vx -e Orca.app -e .devbox-incoming)" ]; then
    echo "left  orca-app  ~/Applications now holds more than Orca.app, so it stays"; return 2
  fi
  act delete "~/Applications (empty once Orca.app is gone; enroll made it)" rmdir Applications
}

ob_orca_data() {   # box: the paths of ORCA_DATA that exist, joined by ":"
  local p out=""
  while IFS= read -r p; do [ ! -e "$p" ] || out="$out${out:+:}$p"; done <<< "$ORCA_DATA"
  echo "${out:-absent}"
}
un_orca_data() {   # box: the ORCA_DATA paths that were not there before enroll
  local p
  while IFS= read -r p; do case ":$1:" in *":$p:"*) ;; *) del "$p" ;; esac; done <<< "$ORCA_DATA"
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
un_orca_pair() { act edit "orca environment rm $(pair_env): this laptop forgets $BOX_NAME's Orca" orca_forget; }
orca_forget() { "$ORCA" environment rm --environment "$(pair_env)" >/dev/null; }

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
un_orca_service() { act off "orca serve service uninstall, then stop what still runs from ~/Applications/Orca.app" service_off; }   # box
service_off() {   # box: uninstall leaves the terminal daemon and its sessions running
  "$(orca_bin)" serve service uninstall >/dev/null 2>&1 || true
  pair_stop
  pkill -f "$HOME/Applications/Orca.app/" || true
}

ob_git_identity() {   # box
  local n e; n="$(git config --global user.name || true)"; e="$(git config --global user.email || true)"
  if [ -n "$n$e" ]; then echo "$n <$e>"; else echo absent; fi
}
un_git_identity() { act edit "git config --global --unset user.name and user.email ($1)" git_identity_off; }   # box
git_identity_off() { git config --global --unset user.name || true; git config --global --unset user.email || true; }

ob_gh_login() {   # box: the keychain login's account; SSH sees the keychain locked, but the account name shows
  local s; s="$(gh auth status --hostname github.com 2>&1 || true)"
  s="$(printf '%s\n' "$s" | sed -n 's/.*github\.com account \([^ ]*\).*/\1/p' | awk 'NR == 1')"
  echo "${s:-absent}"
}

un_gh_login() { act logout "gh auth logout --user $1 (in an Orca terminal on $BOX_NAME; over SSH if that fails)" gui_or_ssh gh-login "gh auth logout --hostname github.com --user $1"; }

ob_claude_login() { security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1 && echo keychain || echo absent; }   # box
un_claude_login() { act logout "claude auth logout (in an Orca terminal on $BOX_NAME; over SSH if that fails)" gui_or_ssh claude-login "claude auth logout"; }

# gui_or_ssh <item> <command>: the keychain logins go where the keychain is open. The agent group, released first,
# took GH_TOKEN out of the shells, so gh logs out the keychain account.
gui_or_ssh() {
  ( box_gui "$2" ) >/dev/null 2>&1 || true
  [ "$(observe "$1" gui)" != absent ] || return 0
  box_ssh "$2" >/dev/null 2>&1 || true
  [ "$(observe "$1" gui)" = absent ] || die "$1 is still on $BOX_NAME (over SSH its login keychain is locked). At $BOX_NAME, in Terminal: $2   Then run this release again: the link stays up until then."
}

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
  # An SSH command gets only the system PATH, and task.sh runs devenv.sh (docker) over SSH; Homebrew holds gh, claude.
  printf '%s\n%s\n%s\n%s\n' "$ZSHENV_START" 'export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"' \
    "[ -r ~/$DEVBOX_DIR/agent.env ] && . ~/$DEVBOX_DIR/agent.env" "$ZSHENV_END" >> .zshenv
}
ap_agent_env() {
  local src="${GH_FROM:-$(git config -f "$DEVBOX_REGISTRY" devbox.default || true)}"
  [ -n "$src" ] && [ "$src" != "$BOX_NAME" ] || die "agents on $BOX_NAME need a read-only GitHub token from another box: pass --gh-token-from <box>"
  ( box_load "$src"; box_ssh "gh auth token --hostname github.com" ) | box_feed put_env GH_TOKEN
  box_call zshenv_on
  ok "agent-env     ~/$DEVBOX_DIR/agent.env (0600) holds GH_TOKEN, read-only, from box $src; ~/.zshenv sources it"
}
zshenv_rest() { awk -v s="$ZSHENV_START" -v e="$ZSHENV_END" '$0 == s { skip = 1; next } skip { if ($0 == e) skip = 0; next } { print }' .zshenv; }   # box
zshenv_off() { zshenv_rest > .zshenv.devbox-new; mv .zshenv.devbox-new .zshenv; }   # box
un_agent_env() {   # box
  local rest=""; [ ! -f .zshenv ] || rest="$(zshenv_rest)"
  if grep -qxF "$ZSHENV_START" .zshenv 2>/dev/null; then
    if [ "$1" = absent-nofile ] && [ -z "$rest" ]; then del .zshenv
    else act edit "remove the devbox block from ~/.zshenv" zshenv_off; fi
  fi
  del "$DEVBOX_DIR/agent.env"
  if [ -d "$DEVBOX_DIR" ] && [ -z "$(ls -A "$DEVBOX_DIR" | grep -vx agent.env)" ]; then
    act delete "~/$DEVBOX_DIR (empty once agent.env is gone)" rmdir "$DEVBOX_DIR"
  fi
  if [ "$1" = absent-nofile ] && [ -n "$rest" ]; then echo "left  agent-env  ~/.zshenv now holds more than the devbox block, so it stays"; return 2; fi
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
box_devroot() ( cd "$HOME/$CO/../.." && pwd )   # box: the dev root above the checkout, as task.sh finds it
get_file() { cat "$(box_devroot)/CLAUDE.md"; }   # box
put_file() { local f; f="$(box_devroot)/CLAUDE.md"; cat > "$f.devbox-new"; mv "$f.devbox-new" "$f"; }   # box: stdin after this script
host_name() { scutil --get LocalHostName; }   # box
box_file_edit() {   # [text]: the box's development/CLAUDE.md through block_edit
  local cur; cur="$(box_call get_file && echo x)" || die "no development/CLAUDE.md on $BOX_NAME to hold the box-layer block"
  printf '%s' "${cur%x}" | block_edit "$BOX_NAME" top "${1:-}" | box_feed put_file
}
ob_claude_md() { grep -qxF "<!-- box-layer $BOX_NAME -->" "$(box_devroot)/CLAUDE.md" 2>/dev/null && echo present || echo absent; }   # box
box_block_text() {   # <the box's LocalHostName>: what the block heading the box's development/CLAUDE.md says
  echo "**You are on box \`$BOX_NAME\` (\`$1.local\`), an agent box, not the owner's laptop.** This block wins over
anything below about which machine you are on. Never push, never open a PR, never touch GitHub issues. Run at most
${BOX_AGENTS:-1} implementers or browser walks at once. Code arrives from the owner's laptop through
\`scripts/devenv/handoff.sh\`. Data on this box older than 7 days: ask the owner before relying on it."
}
ap_claude_md() {
  local host; host="$(box_call host_name)"
  box_file_edit "$(box_block_text "$host")"
  ok "claude-md     the box-layer block heads $BOX_NAME's development/CLAUDE.md"
}
un_claude_md() { act edit "remove the <!-- box-layer $BOX_NAME --> block from $BOX_NAME's development/CLAUDE.md" box_file_edit; }

laptop_devroot() ( cd "$(git rev-parse --path-format=absolute --git-common-dir)/../../.." && pwd )
laptop_claude_md() { echo "$(laptop_devroot)/CLAUDE.md"; }
local_edit() { block_edit "$BOX_NAME" "$2" "${3:-}" < "$1" > "$1.devbox-new"; mv "$1.devbox-new" "$1"; }   # <file> <where> [text]
ob_laptop_row() { grep -qxF "<!-- box-layer $BOX_NAME -->" "$(laptop_claude_md)" 2>/dev/null && echo present || echo absent; }
ap_laptop_row() {
  local f host; f="$(laptop_claude_md)"
  [ -f "$f" ] || die "no CLAUDE.md at $f to hold the machine-table line"
  host="$(box_call host_name)"
  local_edit "$f" after-table "Also an agent box: \`$host.local\` is **$BOX_NAME** (macOS), enrolled by \`scripts/devenv/box.sh\`. Hand it work with \`task.sh start <name> --box $BOX_NAME\`."
  ok "laptop-row    $BOX_NAME's line follows the machine table in $f"
}
un_laptop_row() { act edit "remove the <!-- box-layer $BOX_NAME --> block from $(laptop_claude_md)" local_edit "$(laptop_claude_md)" after-table; }

ob_registry_orca() { git config -f "$DEVBOX_REGISTRY" "box.$BOX_NAME.orca" || echo absent; }
ap_registry_orca() {
  # task.sh routes agents on box.<box>.orca alone, so nothing reaches the box before the probe passed.
  prove
  git config -f "$DEVBOX_REGISTRY" "box.$BOX_NAME.orca" "env:$(pair_env)"
  ok "registry-orca box.$BOX_NAME.orca = env:$(pair_env): task.sh start <name> --box $BOX_NAME now starts agents there"
}
un_registry_orca() {
  if [ "$1" = absent ]; then
    act edit "git config --unset box.$BOX_NAME.orca: no new agent task goes to $BOX_NAME" git config -f "$DEVBOX_REGISTRY" --unset "box.$BOX_NAME.orca"
  else act edit "box.$BOX_NAME.orca back to $1" git config -f "$DEVBOX_REGISTRY" "box.$BOX_NAME.orca" "$1"; fi
}

branches() { git -C "$HOME/$CO" for-each-ref --format='%(objectname) %(refname:short)' 'refs/heads/box/*'; }   # box
co_branch() { git -C "$HOME/$CO" symbolic-ref -q --short HEAD || echo "a detached HEAD"; }   # box
master_firsts() { git -C "$HOME/$CO" rev-list --first-parent -n 1000 master; }   # box: newest first

sync_file() {   # box: <name in the dev root> [mode]: make it hold stdin after this script; a changed file is copied first
  local f b n=1 d new cur
  f="$(box_devroot)/$1" d="$(date +%Y%m%d)"
  new="$(cat; echo x)"; new="${new%x}"
  if [ -f "$f" ]; then
    cur="$(cat "$f"; echo x)"
    if [ "${cur%x}" = "$new" ]; then echo same
    else
      b="$f.bak-update-$d"
      while [ -e "$b" ]; do n=$((n + 1)); b="$f.bak-update-$d-$n"; done   # an earlier backup is never overwritten
      cp -p "$f" "$b"; cp -p "$f" "$f.devbox-new"
      printf '%s' "$new" > "$f.devbox-new"; mv "$f.devbox-new" "$f"
      echo "written; the old copy is $(basename "$b")"
    fi
  else printf '%s' "$new" > "$f"; echo "written (there was none)"; fi
  [ -z "${2:-}" ] || chmod "$2" "$f"
}
boot_steps() {   # box: <step>...: bootstrap.sh in the checkout, one after another, stopping at the first that fails
  local s; cd "$HOME/$CO"
  for s in "$@"; do
    bash scripts/devenv/bootstrap.sh "$s" || { echo "STOP  bootstrap.sh $s failed on $BOX_NAME; the steps after it did not run" >&2; return 1; }
  done
}
doctor_box() { cd "$HOME/$CO"; bash scripts/devenv/bootstrap.sh doctor || true; }   # box: it exits 1 when not ready

# box_gui <command>: run it in a new Orca terminal on the box's server, in the checkout, the way an agent starts;
# its output lands in GUI_OUT. The one route into the box's login session, where the keychain is open.
box_gui() {
  local BOX_ORCA="env:$(pair_env)" home n=0
  agent_route
  home="$(box_ssh 'printf %s "$HOME"')"
  box_call gui_reset
  "$ORCA" terminal create "${AGENT_ROUTE[@]}" --worktree "path:$home/$BOX_CO" --title devbox-probe \
    --command "{ $1 ; } > ~/$DEVBOX_DIR/gui.out 2>&1; echo __devbox_end >> ~/$DEVBOX_DIR/gui.out; exit" >/dev/null \
    || die "Orca on $BOX_NAME did not open a terminal (orca terminal create --environment $(pair_env))"
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
  # A non-login SSH command gets only the system PATH; gh and claude live in Homebrew. Without this, gh reads as
  # absent and release would leave the owner's GitHub login behind. Appended, so a PATH that already holds them wins.
  PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
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

RELEASE_ORDER='agent owner orca link'
in_scope() {   # <group>: released in this run (--stop-before ends the release order at its group)
  local g
  [ -n "$STOP_BEFORE" ] || return 0
  for g in $RELEASE_ORDER; do [ "$g" != "$STOP_BEFORE" ] || return 1; [ "$g" != "$1" ] || return 0; done
}
drop() { [ "$DRY" = 1 ] || git config -f "$DEVBOX_REGISTRY" --unset "layer.$BOX_NAME.$ID"; }
plan_id() { sed 's/  \[[^]]*\]$//' "$PLAN" | shasum | cut -c1-8; }
flags() { printf '%s' "${STOP_BEFORE:+ --stop-before $STOP_BEFORE}${BOX_GONE:+ --box-gone}"; }

by_hand() {   # <id>: how the owner takes the item off at the box itself
  case "$1" in
    tailscale) echo "Tailscale menu > Log Out" ;;
    remote-login) echo "System Settings > General > Sharing > Remote Login off" ;;
    ssh-key) echo "remove this laptop's key line from ~/.ssh/authorized_keys" ;;
    keep-awake) echo "launchctl bootout gui/\$(id -u)/$KEEP_AWAKE, then delete ~/$(ka_plist)" ;;
    orca-app) echo "delete ~/Applications/Orca.app" ;;
    orca-data) echo "delete Orca's data: $(sed 's|^|~/|' <<< "$ORCA_DATA" | tr '\n' ' ')" ;;
    orca-service) echo "~/$BOX_ORCA_BIN serve service uninstall" ;;
    git-identity) echo "git config --global --unset user.name; git config --global --unset user.email" ;;
    gh-login) echo "gh auth logout" ;;
    claude-login) echo "claude auth logout" ;;
    agent-env) echo "delete ~/$DEVBOX_DIR and the devbox block in ~/.zshenv" ;;
    claude-md) echo "remove the <!-- box-layer $BOX_NAME --> block from development/CLAUDE.md" ;;
  esac
}

refusals() {
  local t b sha ref ahead=""
  t="$(git config --get-regexp '^devbox-task\..*\.box$' | awk -v b="$BOX_NAME" '$2 == b { sub(/^devbox-task\./, "", $1); sub(/\.box$/, "", $1); print $1 }' || true)"
  [ -z "$t" ] || die "tasks still on box $BOX_NAME: $(echo $t). Finish each first (task.sh done <name>, then task.sh clean <name>)"
  [ -z "$BOX_GONE" ] || return 0
  box_reach
  b="$(box_call branches)"
  while read -r sha ref; do
    [ -n "$sha" ] || continue
    git cat-file -e "$sha^{commit}" 2>/dev/null && [ -n "$(git for-each-ref --contains "$sha" refs/heads)" ] || ahead="$ahead $ref"
  done <<< "$b"
  [ -z "$ahead" ] || die "box $BOX_NAME has commits this laptop lacks on:$ahead. Bring them back first (handoff.sh from $BOX_NAME <branch>)"
  if [ "$(ob_orca_pair)" = present ]; then
    local BOX_ORCA="env:$(pair_env)"; agent_route
    t="$("$ORCA" terminal list "${AGENT_ROUTE[@]}" 2>/dev/null | awk '/^term_/ { print $1 }' || true)"
    [ -z "$t" ] || die "Orca on $BOX_NAME has live terminals ($(echo $t)): an agent may be working. Close them first"
  fi
  echo "check no task record names $BOX_NAME; no box/* branch there has commits this laptop lacks; no live Orca terminal there"
}

release_item() {   # the catalog row in ID KIND VIA, its record in OLD
  local tgt=absent cur rc=0
  [ "$KIND" = adopt ] || tgt="$OLD"
  cur="$(observe "$ID" "$VIA")"
  if [ "$cur" = "$tgt" ]; then echo "ok    $ID  already released ($cur)"; drop; return; fi
  if [ "$KIND" = adopt ] && [ "$cur" != "$OLD" ]; then
    echo "left  $ID  reads '$cur', not '$OLD' as enroll found it: left as the next user set it"; drop; return
  fi
  if [ "$VIA" = ssh ]; then box_call "un_${ID//-/_}" "$OLD" || rc=$?; else "un_${ID//-/_}" "$OLD"; fi
  [ "$DRY" = 0 ] || return 0
  case "$rc" in 0) ;; 2) drop; return ;; *) exit "$rc" ;; esac
  cur="$(observe "$ID" "$VIA")"
  [ "$cur" = "$tgt" ] || die "$ID reads '$cur' after its release, not '$tgt'. Look at it on $BOX_NAME, then run release again"
  drop; ok "$ID  released"
}

port22() {   # open, refused (Remote Login off), or silent (off the tailnet)
  local o
  if o="$(nc -vz -G 3 "${BOX_SSH#*@}" 22 2>&1)"; then echo open
  else case "$o" in *refused*) echo refused ;; *) echo silent ;; esac; fi
}
wait_port() {   # <refused|silent>
  local n=0 s
  while s="$(port22)"; [ "$s" != "$1" ]; do
    [ "$1/$s" != refused/silent ] || return 1
    n=$((n + 1)); [ $n -le 90 ] || return 1
    sleep 1
  done
}

end_link() {   # the session items still recorded: one SSH session ends the link, then this laptop proves it
  local i cur want=() ids=() fails="" host="${BOX_SSH#*@}"
  for ((i = ${#CAT[@]} - 1; i >= 0; i--)); do
    row "$i"; [ "$VIA" = session ] && in_scope "$GROUP" || continue
    OLD="$(layer_get "$ID")" || continue
    ITEM="$ID"; cur="$(observe "$ID" "$VIA")"
    if [ "$cur" = absent ]; then echo "ok    $ID  already released"; drop
    elif [ "$cur" != "$OLD" ]; then echo "left  $ID  reads '$cur', not '$OLD' as enroll found it: left as the next user set it"; drop
    else ids+=("$ID"); want+=("$ID"); [ "$ID" != ssh-key ] || want+=("$OLD"); fi
  done
  [ ${#ids[@]} -gt 0 ] || return 0
  ITEM=-
  if [ "$DRY" = 1 ]; then box_call end_link_box "${want[@]}"; return; fi
  if [ ! -t 0 ]; then
    ( DRY=1; release_walk ) > "$PLAN"
    need_owner "$BOX_NAME's password, for sudo in the step that ends the link; everything else is released. In your own terminal run: scripts/devenv/box.sh release $BOX_NAME --confirm $(plan_id)$(flags)"
  fi
  box_ssh "cat > ~/.devbox-end-link.sh" < "$SELF"
  BOX_SSH_OPTS+=(-t)
  echo "need  $BOX_NAME's password, once, for sudo"
  box_ssh "bash ~/.devbox-end-link.sh $(box_args end_link_box "${want[@]}")" | tee "$PLAN"
  for ID in "${ids[@]}"; do
    case "$ID" in
      ssh-key) if grep -q 'ssh-key=absent' "$PLAN"; then drop; ok "ssh-key  this laptop's key is gone from $BOX_NAME"; else fails="$fails $ID"; fi ;;
      remote-login) if wait_port refused; then drop; ok "port 22 on $host refused: Remote Login is off"; else fails="$fails $ID"; fi ;;
      tailscale) if wait_port silent; then drop; ok "$host is silent: $BOX_NAME left the tailnet"; else fails="$fails $ID"; fi ;;
    esac
  done
  [ -z "$fails" ] || die "not proven from here:$fails. At $BOX_NAME: $(for ID in $fails; do printf '%s; ' "$(by_hand "$ID")"; done)then run: scripts/devenv/box.sh release $BOX_NAME --box-gone --dry-run"
}

finish() {   # the whole catalog is released: forget the layer
  ITEM=layer
  ! layer_get claude-token >/dev/null || echo "note  revoke the Claude setup-token made for $BOX_NAME (claude.ai settings): it outlives the file"
  [ -n "$BOX_GONE" ] || echo "note  delete $BOX_NAME's device in the Tailscale admin console: logging out keeps the node"
  act edit "remove [layer \"$BOX_NAME\"] (what enroll found) from $DEVBOX_REGISTRY" git config -f "$DEVBOX_REGISTRY" --remove-section "layer.$BOX_NAME"
}

release_walk() {   # the catalog bottom-up; under DRY=1 it prints the plan and changes nothing
  local i linked=""
  for ((i = ${#CAT[@]} - 1; i >= 0; i--)); do
    row "$i"; in_scope "$GROUP" || continue
    OLD="$(layer_get "$ID")" || continue
    ITEM="$ID"
    if [ -n "$BOX_GONE" ] && [ "$VIA" != laptop ]; then echo "todo  $ID  at $BOX_NAME: $(by_hand "$ID")"; continue; fi
    if [ "$VIA" = session ]; then [ -n "$linked" ] || { linked=1; end_link; }; continue; fi
    release_item
  done
  ITEM=-
  [ -n "$STOP_BEFORE" ] || finish
}

layer_exists() {   # <what that means for this command>
  git config -f "$DEVBOX_REGISTRY" --get-regexp "^layer\.$BOX_NAME\." >/dev/null \
    || die "box $BOX_NAME was not enrolled by box.sh ($DEVBOX_REGISTRY has no [layer \"$BOX_NAME\"]): $1"
}

release() {
  layer_exists "nothing to release"
  refusals
  PLAN="$(mktemp "${TMPDIR:-/tmp}/box-plan.XXXXXX")"; trap 'rm -f "$PLAN"' EXIT
  ( DRY=1; release_walk ) > "$PLAN"
  if [ -n "$DRY_RUN" ]; then
    echo; echo "Release plan for $BOX_NAME, the catalog bottom-up:"; cat "$PLAN"
    echo; echo "DELETES (the owner's \"yes delete\" covers exactly these, with plan $(plan_id)):"
    sed -n 's/^plan  [^ ]*  delete  /  /p' "$PLAN" | grep . || echo "  (nothing)"
    echo; echo "plan $(plan_id)    to run it: scripts/devenv/box.sh release $BOX_NAME --confirm $(plan_id)$(flags)"
    return
  fi
  [ -n "$CONFIRM" ] || die "release changes $BOX_NAME: run it with --dry-run first, show the owner the list, then pass --confirm <plan id>"
  if [ "$CONFIRM" != "$(plan_id)" ]; then
    cat "$PLAN"
    die "the plan is now $(plan_id), not $CONFIRM: $BOX_NAME or its record changed since that --dry-run. Show the owner the list above, then --confirm $(plan_id)$(flags)"
  fi
  export BOX_STARTED=1
  echo
  release_walk
  [ -n "$STOP_BEFORE" ] && ok "released $BOX_NAME up to the $STOP_BEFORE group; the rest stays, and enroll can run again" || ok "released $BOX_NAME"
}

# ---------------------------------------------------------------- update: the dev environment, not the box layer
BOOT_STEPS='bench link pylock frontend build playwright'
CODE="not reached" FILES="not reached" TOOLS="not reached" DATA="not reached"
summary() { echo; echo "== $BOX_NAME after update"; printf 'code   %s\nfiles  %s\ntools  %s\ndata   %s\n' "$CODE" "$FILES" "$TOOLS" "$DATA"; }

strip_blocks() {   # stdin to stdout without any box's block
  awk '/^<!-- box-layer [a-z0-9-]+ -->$/ { skip = 1; next } skip { if ($0 ~ /^<!-- \/box-layer [a-z0-9-]+ -->$/) skip = 0; next } { print }'
}
swap_path() {   # <from> <to>: stdin to stdout with every <from> read as <to>, literally
  FROM="$1" TO="$2" awk '{ out = ""
    while ((i = index($0, ENVIRON["FROM"])) > 0) { out = out substr($0, 1, i - 1) ENVIRON["TO"]; $0 = substr($0, i + length(ENVIRON["FROM"])) }
    print out $0 }'
}

diverged() {   # <verdict>: master on the box has commits this laptop lacks. Moving it by force is the owner's.
  local c fork="" firsts
  firsts="$(box_call master_firsts)" || exit $?
  while read -r c; do git merge-base --is-ancestor "$c" master 2>/dev/null && { fork="$c"; break; }; done <<< "$firsts"
  [ -n "$fork" ] || die "master on $BOX_NAME ($1) shares none of its last 1000 commits with this laptop's master; nothing was changed"
  die "master on $BOX_NAME has commits this laptop lacks ($1); nothing was changed. To make it this laptop's master,
      keep them on a backup branch, then step master back to $fork, the newest commit of it this laptop has.
      On $BOX_NAME, in ~/$BOX_CO:
      git branch $BOX_NAME-backup/master-$(date +%Y%m%d) master
      git checkout -B master $fork
      Then here: scripts/devenv/box.sh update $BOX_NAME (it hands master over as a fast-forward).$([ "$1" != BOX_AHEAD ] || printf '\n      Or keep those commits: scripts/devenv/handoff.sh from %s master' "$BOX_NAME")"
}

update() {
  local v st was from to host r doc days
  layer_exists "run box.sh enroll $BOX_NAME first"
  box_reach
  v="$(box_call co_branch)" || exit $?
  [ "$v" = master ] || die "~/$BOX_CO on $BOX_NAME has $v checked out, not master: update moves master and builds from it. There: git switch master, then run update again"

  step "code      master, fast-forward only"
  st="$("$(dirname "$SELF")/handoff.sh" status "$BOX_NAME" master)" || exit $?
  v="$(printf '%s\n' "$st" | sed -n 's/^verdict: //p')"
  export BOX_STARTED=1
  case "$v" in
    IN_SYNC) CODE="master already at $(git rev-parse --short master)" ;;
    LAPTOP_AHEAD|ONLY_LAPTOP)
      was="$(printf '%s\n' "$st" | sed -n 's/^box    master: \([^ ]*\).*/\1/p')"
      "$(dirname "$SELF")/handoff.sh" to "$BOX_NAME" master
      CODE="master fast-forwarded to $(git rev-parse --short master) (was $([ -n "$was" ] && echo "${was:0:9}" || echo none))" ;;
    DIVERGED|BOX_AHEAD) diverged "$v" ;;
    *) die "master: $v (scripts/devenv/handoff.sh status $BOX_NAME master)" ;;
  esac
  ok "$CODE"

  step "files     the dev root's devenv.sh and CLAUDE.md, this laptop's for $BOX_NAME"
  from="$(laptop_devroot)"; to="$(box_call box_devroot)" || exit $?
  [ -f "$from/devenv.sh" ] && [ -f "$from/CLAUDE.md" ] || die "this laptop's dev root $from lacks devenv.sh or CLAUDE.md"
  r="$(box_feed sync_file devenv.sh 755 < "$from/devenv.sh")" || exit $?
  ok "devenv.sh  $r"; FILES="devenv.sh $r"
  host="$(box_call host_name)" || exit $?
  r="$(strip_blocks < "$from/CLAUDE.md" | swap_path "$from" "$to" | block_edit "$BOX_NAME" top "$(box_block_text "$host")" \
    | box_feed sync_file CLAUDE.md)" || exit $?
  ok "CLAUDE.md  $r"; FILES="$FILES; CLAUDE.md $r"

  step "tools     bootstrap.sh on $BOX_NAME: $BOOT_STEPS, then doctor (never compose)"
  box_call boot_steps $BOOT_STEPS || { r=$?; TOOLS="stopped at the failing step above"; summary; exit "$r"; }
  doc="$(box_call doctor_box)" || exit $?
  printf '%s\n' "$doc"
  TOOLS="ran $BOOT_STEPS; $(printf '%s\n' "$doc" | sed -n 's/^doctor: //p')"
  case "$doc" in *"differs from compose.yml"*)
    echo "note  docker-compose.yml on $BOX_NAME differs from compose.yml. Replacing it recreates the containers, so only"
    echo "      with your OK, on $BOX_NAME in ~/$BOX_CO: scripts/devenv/bootstrap.sh compose --force"
    TOOLS="$TOOLS; docker-compose.yml differs (note above)" ;;
  esac

  step "data      the box's own; update never loads any"
  DATA="$(printf '%s\n' "$doc" | sed -nE 's/^(WARN|ok) +data is ([0-9]+ days old \([^)]*\)).*/\2/p')"
  days="${DATA%% *}"
  if [ -n "$DATA" ] && [ "$days" -le 7 ]; then ok "data on $BOX_NAME is $DATA"
  else
    [ -n "$DATA" ] || DATA="of unknown age (doctor found no data_stamp.json)"
    echo "note  data on $BOX_NAME is $DATA. To load a fresh backup, from this laptop: scripts/devenv/data.sh send $BOX_NAME <backup>"
    DATA="$DATA: send a fresh backup (note above)"
  fi
  summary
}

CMD="${1:-}"
case "$CMD" in
  enroll|release|update) ;;
  *) sed -n '2,/^# The whole body/p' "$SELF"; exit 1 ;;
esac
[ -n "${2:-}" ] || die "usage: box.sh $CMD <box>"
box_load "$2"; shift 2
DRY_RUN="" CONFIRM="" STOP_BEFORE="" BOX_GONE=""
while [ $# -gt 0 ]; do
  case "$CMD $1" in
    "enroll --gh-token-from") GH_FROM="${2:?--gh-token-from needs a box name}"; shift 2 ;;
    "release --dry-run") DRY_RUN=1; shift ;;
    "release --confirm") CONFIRM="${2:?--confirm needs the plan id that --dry-run printed}"; shift 2 ;;
    "release --stop-before") STOP_BEFORE="${2:-}"; shift 2 || die "--stop-before needs a group"
      case " $RELEASE_ORDER " in *" $STOP_BEFORE "*) ;; *) die "--stop-before takes one of: $RELEASE_ORDER" ;; esac ;;
    "release --box-gone") BOX_GONE=1; shift ;;
    *) die "unknown option $1 for $CMD" ;;
  esac
done
box_show named
"$CMD"
exit
}
