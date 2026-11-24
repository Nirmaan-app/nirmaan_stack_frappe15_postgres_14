#!/usr/bin/env bash
# Who may send agent tasks to a shared box (box.<box>.launch = box), as which Claude account, committing as whom. The
# box's owner runs it on his laptop; it works on the box over SSH (box_launch.py people, piped like task.sh's box
# launches), so the box's own copy of the scripts does not matter. <box> comes from the registry
# (scripts/devenv/boxes.sh); --box defaults to r7.
#
#   people.sh add <name> [--key <public key line or .pub file>]... [--account <Orca Claude account id or email, or
#                 system>] [--git-name "<name>"] [--git-email <email>] [--email <signed-in email>] [--prefix <p>]
#                 [--box <box>]
#       Write <name>'s record in the box's ~/.config/devbox/people.conf, and each of their keys once in its
#       ~/.ssh/authorized_keys (with the key's comment; <name>-to-<box> when it has none). Rerunnable: a rerun with the
#       same values changes nothing, a changed value is updated, a new --key is added beside the old ones, and a key
#       missing from authorized_keys is put back. Refuses a key people.conf gives someone else, and a record left
#       without a key, an account or a git identity (--git-name, --git-email: the author of their tasks' commits).
#       --email: the email the account must be signed in as. --prefix: each of their task names starts with it
#       (--prefix '' drops it). Ends with the person's check.
#   people.sh check [<name>] [--box <box>]
#       Per person: key in authorized_keys, record complete, Claude account in the box's Orca and signed in as the
#       expected email, git identity set. Each missing step comes with the command that fixes it, or the steps to do
#       by hand. Exit 1 while anything is missing.
#   people.sh remove <name> [--box <box>] [--yes]
#       Offboard: take <name>'s key lines out of authorized_keys and their record out of people.conf. Without --yes it
#       prints exactly that and changes nothing. It never removes an Orca account or a Tailscale share (it prints how)
#       and refuses the key this session logged in with.
#   people.sh list [--box <box>]
#       Everyone in people.conf, and any authorized_keys line no one in it owns.
#
# Everyone logs in to the box as the same Linux user. people.conf keeps people's usage, billing and authorship apart,
# not their secrets: anyone with a shell there can read or change whatever that user can, people.conf included.
#
# Onboarding a developer:
#   1. The developer runs scripts/devenv/join.sh on their Mac, from their checkout of the repo. It makes their SSH key,
#      the Host <box> block, the registry entry, switches off pushing to the org repo, and prints one block for the
#      owner: their public key and the people.sh add command to run.
#   2. The owner shares the box with them in Tailscale: admin console, Machines > <box> > Share. They accept the invite.
#   3. If they get a Claude account of their own on the box, the owner signs it in there:
#        ssh -t <box> '~/.local/opt/orca-server-<version>/bin/orca-ide account add --agent claude'
#      opens a sign-in link: open it in a private browser window and sign in as that account. orca-ide account list
#      --json then shows its id. (On Linux /usr/bin/orca is a screen reader, not Orca.)
#   4. The owner runs the people.sh add command from step 1, with --account filled in (the id from step 3, or an
#      existing account, or system for the box's own login). Its check, or people.sh check <name>, says what is left.
#   5. The developer reruns join.sh until every line says ok, then starts tasks: task.sh start <prefix><task>.
# Offboarding: people.sh remove <name> (read what it would remove), then again with --yes; then, by hand, the Tailscale
# share and, when no one else uses it, the Orca account (remove prints the command).
#
# Exit 1: refused, or check found something missing. Exit 2: wrong usage. Exit 3: the box did not answer over SSH.
# The whole body sits in { ... } so bash parses it before running: editing this file mid-run is safe.
{
set -euo pipefail

die() { echo "STOP  $*" >&2; exit 1; }
usage() { sed -n '2,/^# Exit 1/p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

SELF_DIR="$(cd "$(dirname "$0")" && pwd -P)"
. "$SELF_DIR/boxes.sh"

BOX=r7 ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --box) [ $# -ge 2 ] || usage; BOX="$2"; shift 2 ;;
    --key)
      [ $# -ge 2 ] || usage
      k="$2"
      if [ -f "$k" ]; then k="$(grep -m 1 -v '^[[:space:]]*$' "$k" || true)"; fi
      ARGS+=(--key "$k"); shift 2 ;;
    -h|--help) usage ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
[ ${#ARGS[@]} -gt 0 ] || usage
box_load "$BOX"
# One SSH word for the whole argument list: names and git names carry spaces.
PAYLOAD="$(python3 -I -c 'import base64, json, sys; print(base64.b64encode(json.dumps(sys.argv[1:]).encode()).decode())' \
  "$BOX_NAME" "$BOX_SSH" "${ARGS[@]}")"
RC=0; box_agent people "$PAYLOAD" || RC=$?
[ -z "$BOX_AGENT_OUT" ] || printf '%s\n' "$BOX_AGENT_OUT"
exit "$RC"
}
