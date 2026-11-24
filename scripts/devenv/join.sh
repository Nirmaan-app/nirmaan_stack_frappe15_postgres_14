#!/usr/bin/env bash
# Join a shared dev box (r7) as a developer: run it on your Mac, from your checkout of the repo. Rerunnable: each run
# does only what is missing, changes nothing that is already set (a value that differs is reported, not overwritten),
# and ends with one block to send to the box's owner. Rerun it after the owner's reply until every line says ok.
#
#   scripts/devenv/join.sh [--name <you>] [--box r7] [--host 100.80.71.39] [--user abhishek_nirmaan]
#
#   --name  your name on the box: lowercase letters, digits and dashes (default: your Mac login name). Your task
#           names start with <name>- and your key's comment is <name>-to-<box>.
#   --box, --host, --user: the box's name, Tailscale address and Linux user (defaults: r7's).
#
# What it does, in order:
#   1. Tailscale reaches the box (tailscale ping). Until the owner shares the box with you and you accept, it WAITs.
#   2. Your SSH key ~/.ssh/id_ed25519_<box> (ed25519, comment <name>-to-<box>), made if missing.
#   3. A Host <box> block in ~/.ssh/config (HostName, User, IdentityFile, IdentitiesOnly), added if missing; then
#      ssh -G checks that the box's address, user and key are what ssh really uses.
#   4. ssh <box> logs in (accepting the box's host key the first time). Until the owner adds your key, it WAITs.
#   5. In this checkout: the remote pointing at github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14 (added as
#      upstream only when none does; remotes are never renamed) has pushing switched off (its push URL becomes
#      DISABLED-push-to-your-fork): you push to your fork.
#   6. The box's entry in ~/.config/devbox/boxes.conf (scripts/devenv/boxes.sh): ssh <user>@<box> (the Host block's
#      key applies), the box's checkout, launch box, agents 2, and devbox.default.
#   7. Your git user.name and user.email: the box writes them into each of your tasks, so its commits are yours.
# Orca is not needed on your Mac. The owner's side of onboarding: scripts/devenv/people.sh's header.
#
# Each line says ok, made (done now), WAIT (the owner's step), DIFF (left as is: check it) or FIX (yours to fix).
# Exit 1 while a FIX remains, else 0.
# The whole body sits in { ... } so bash parses it before running: editing this file mid-run is safe. bash 3.2 safe.
{
set -euo pipefail

die() { echo "STOP  $*" >&2; exit 1; }
usage() { sed -n '2,/^# Exit 1/p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

BOX=r7 HOST=100.80.71.39 BOX_USER=abhishek_nirmaan NAME=""
BOX_CHECKOUT=work/nirmaan/deploy_setup/frappe_docker/development/nirmaan_stack_variants/master
while [ $# -gt 0 ]; do
  case "$1" in
    --name|--box|--host|--user)
      [ $# -ge 2 ] || usage
      case "$1" in --name) NAME="$2" ;; --box) BOX="$2" ;; --host) HOST="$2" ;; --user) BOX_USER="$2" ;; esac
      shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$NAME" ] || NAME="$(id -un | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-\n' '-')"
re='^[a-z][a-z0-9-]{0,30}$'
[[ "$NAME" =~ $re ]] || die "--name $NAME: lowercase letters, digits and dashes, starting with a letter"
[[ "$BOX" =~ $re ]] || die "--box $BOX: lowercase letters, digits and dashes"

SELF_DIR="$(cd "$(dirname "$0")" && pwd -P)"
CO="$(git -C "$SELF_DIR" rev-parse --show-toplevel)"
. "$SELF_DIR/develop.sh"
REGISTRY="${DEVBOX_REGISTRY:-$HOME/.config/devbox/boxes.conf}"
KEY="$HOME/.ssh/id_ed25519_$BOX"
SSH_CONFIG="$HOME/.ssh/config"
NO_PUSH=DISABLED-push-to-your-fork

RESULTS="" FIXES=0
step() {
  RESULTS="$RESULTS$(printf '  %-5s %s' "$1" "$2")"$'\n'
  [ "$1" != FIX ] || FIXES=$((FIXES + 1))
}
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# 1. Tailscale
TS="$(command -v tailscale || true)"
[ -n "$TS" ] || [ ! -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] || TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
REACHED=0
if [ -z "$TS" ]; then
  step FIX "Tailscale: no tailscale CLI here. Install Tailscale, sign in, then rerun"
elif "$TS" ping -c 1 --until-direct=false --timeout 5s "$HOST" >/dev/null 2>&1; then   # a relayed (DERP) pong counts
  REACHED=1; step ok "Tailscale reaches $BOX ($HOST)"
else
  step WAIT "Tailscale does not reach $BOX ($HOST): the owner shares $BOX with you, you accept the invite, Tailscale runs"
fi

# 2. the SSH key
mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
if [ -f "$KEY" ] && [ -f "$KEY.pub" ]; then
  step ok "key $KEY"
elif [ -f "$KEY" ]; then
  printf '%s %s\n' "$(ssh-keygen -y -f "$KEY" | awk '{print $1, $2}')" "$NAME-to-$BOX" > "$KEY.pub"
  step made "public key $KEY.pub, from the private key there"
else
  ssh-keygen -q -t ed25519 -N '' -C "$NAME-to-$BOX" -f "$KEY"
  step made "key $KEY (ed25519, comment $NAME-to-$BOX)"
fi

# 3. the Host block
[ -f "$SSH_CONFIG" ] || { : > "$SSH_CONFIG"; chmod 600 "$SSH_CONFIG"; }
if grep -Eiq "^[[:space:]]*Host[[:space:]]+(.*[[:space:]])?$BOX([[:space:]]|\$)" "$SSH_CONFIG"; then
  step ok "~/.ssh/config has a Host $BOX block (left as is)"
else
  {
    [ ! -s "$SSH_CONFIG" ] || [ -z "$(tail -c 1 "$SSH_CONFIG")" ] || echo
    [ ! -s "$SSH_CONFIG" ] || echo
    printf 'Host %s\n  HostName %s\n  User %s\n  IdentityFile ~/.ssh/id_ed25519_%s\n  IdentitiesOnly yes\n' \
      "$BOX" "$HOST" "$BOX_USER" "$BOX"
  } >> "$SSH_CONFIG"
  step made "~/.ssh/config: Host $BOX block (HostName $HOST, User $BOX_USER, IdentityFile ~/.ssh/id_ed25519_$BOX)"
fi
G="$(ssh -G -F "$SSH_CONFIG" "$BOX" 2>/dev/null || true)"
GOT_HOST="$(printf '%s\n' "$G" | awk '$1 == "hostname" {print $2; exit}')"
GOT_USER="$(printf '%s\n' "$G" | awk '$1 == "user" {print $2; exit}')"
[ "$GOT_HOST" = "$HOST" ] || step FIX "ssh $BOX goes to '$GOT_HOST', not $HOST: an earlier Host or Match block in ~/.ssh/config wins"
[ "$GOT_USER" = "$BOX_USER" ] || step FIX "ssh $BOX logs in as '$GOT_USER', not $BOX_USER: an earlier Host or Match block in ~/.ssh/config wins"
printf '%s\n' "$G" | awk '$1 == "identityfile" {print $2}' | grep -qxF -e "~/.ssh/id_ed25519_$BOX" -e "$KEY" \
  || step FIX "ssh $BOX does not offer ~/.ssh/id_ed25519_$BOX: set IdentityFile in its Host block"

# 4. logging in
if [ "$REACHED" = 0 ]; then
  step WAIT "ssh $BOX: not tried until Tailscale reaches it"
elif ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new "$BOX" true >/dev/null 2>&1; then
  step ok "ssh $BOX logs in"
else
  step WAIT "ssh $BOX does not log in yet: the owner adds your key (the people.sh add command below)"
fi

# 5. the org repo's remote: never a push target
REMOTES="$(cd "$CO" && org_remotes)"
if [ -z "$REMOTES" ]; then
  if URL="$(git -C "$CO" remote get-url upstream 2>/dev/null)"; then
    step FIX "no remote points at github.com/$ORG_REPO_PATH, and upstream is $URL: add it under another name (git remote add <name> https://github.com/$ORG_REPO_PATH.git) and rerun"
  else
    git -C "$CO" remote add upstream "https://github.com/$ORG_REPO_PATH.git"
    REMOTES=upstream; step made "remote upstream: github.com/$ORG_REPO_PATH"
  fi
fi
for r in $REMOTES; do
  if [ "$(git -C "$CO" config --get-all "remote.$r.pushurl" || true)" = "$NO_PUSH" ]; then
    step ok "remote $r (the org repo): pushing is off"
  else
    git -C "$CO" config --unset-all "remote.$r.pushurl" || true   # set-url --push refuses a remote with several
    git -C "$CO" remote set-url --push "$r" "$NO_PUSH"
    step made "remote $r (the org repo): pushing switched off; push to your fork"
  fi
done

# 6. the registry
[ -d "$(dirname "$REGISTRY")" ] || mkdir -p -m 700 "$(dirname "$REGISTRY")"
registry() {
  local cur
  cur="$(git config -f "$REGISTRY" "$1" 2>/dev/null || true)"
  if [ -z "$cur" ]; then git config -f "$REGISTRY" "$1" "$2"; step made "registry $1 = $2"
  elif [ "$cur" = "$2" ]; then step ok "registry $1 = $2"
  else step DIFF "registry $1 is $cur, not $2: left as is (git config -f $REGISTRY $1 $2 changes it)"; fi
}
registry "box.$BOX.ssh" "$BOX_USER@$BOX"
registry "box.$BOX.checkout" "$BOX_CHECKOUT"
registry "box.$BOX.launch" box
registry "box.$BOX.agents" 2
registry devbox.default "$BOX"
chmod 600 "$REGISTRY"

# 7. git identity
GIT_NAME="$(git -C "$CO" config user.name || true)" GIT_EMAIL="$(git -C "$CO" config user.email || true)"
if [ -n "$GIT_NAME" ] && [ -n "$GIT_EMAIL" ]; then
  step ok "git identity $GIT_NAME <$GIT_EMAIL>: your task commits on $BOX carry it"
else
  step FIX "no git user.name or user.email: git config --global user.name '<your name>'; git config --global user.email <your email>; rerun"
fi

PUB="$(cat "$KEY.pub")"
echo "==== for the owner of $BOX: send everything up to the closing line ===="
echo "public key: $PUB"
echo "the owner runs, with the Claude account he gives you:"
echo "  scripts/devenv/people.sh add $NAME --key $(q "$PUB") --account '<Orca account id or email, or system>' \\"
echo "    --git-name $(q "${GIT_NAME:-<your name>}") --git-email $(q "${GIT_EMAIL:-<your email>}") --prefix $NAME- --box $BOX"
echo "join.sh on $(hostname -s 2>/dev/null || hostname), $(date '+%Y-%m-%d %H:%M'):"
printf '%s' "$RESULTS"
echo "==== end ===="
if [ "$FIXES" -gt 0 ]; then echo "FIX the lines marked FIX above, then rerun join.sh"; exit 1; fi
case "$RESULTS" in
  *"  WAIT "*) echo "Send the block to the owner; rerun join.sh after he replies" ;;
  *) echo "Ready: start a task with scripts/devenv/task.sh start $NAME-<task> --brief <file>" ;;
esac
exit 0
}
