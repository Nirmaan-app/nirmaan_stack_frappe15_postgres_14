# The dev boxes, as the laptop knows them. Sourced (never run) by task.sh, handoff.sh and data.sh send on the
# laptop; the caller defines die. The registry is the only place a box's address, user and checkout live: the
# repo is public.
#
# Registry: ~/.config/devbox/boxes.conf, git config syntax, written with `git config -f`.
#   box.<name>.ssh       required  SSH target, <user>@<host>
#   box.<name>.checkout  required  the repo's main checkout on the box, relative to the box user's home
#   box.<name>.orca      optional  env:<paired Orca server name>. A box without it takes tasks only with --no-agent
#   box.<name>.agents    optional  how many agents the box takes at once (task.sh start counts it with devbox.order;
#                                  1 when unset)
#   devbox.order         optional  boxes in order of preference, space-separated: task.sh start without --box takes
#                                  the first with a free agent (task.sh pick shows which and why)
#   devbox.default       optional  the box for task.sh start without --box when devbox.order is unset (with a single
#                                  box, that box)
# <name>: lowercase letters, digits and dashes. Other keys under box.<name>. are ignored here.
#
# Setup, once, on the laptop. Fill in your own values:
#   install -d -m 700 ~/.config/devbox; R=~/.config/devbox/boxes.conf
#   git config -f $R devbox.default        contabo
#   git config -f $R box.contabo.ssh       <user>@<host>
#   git config -f $R box.contabo.checkout  <checkout path under the box user's home>
#   git config -f $R box.contabo.orca      env:<paired Orca server name>
#   git config -f $R box.contabo.agents    2
#   git config -f $R box.air.ssh           <user>@<host>
#   git config -f $R box.air.checkout      <checkout path under the box user's home>
#   chmod 600 $R
# Every task started before task.sh recorded boxes ran on contabo. Record them once, from any checkout of the repo
# (a task that already has a record is left alone):
#   for b in $(git for-each-ref --format='%(refname:short)' 'refs/heads/box/*'); do n="${b#box/}"
#     git config "devbox-task.$n.box" >/dev/null || git config "devbox-task.$n.box" contabo; done
#
# Exit 3 means the box did not answer over SSH. box_unreachable exits the shell it runs in. Inside a pipeline stage
# or $(...) that is a subshell: set -e and pipefail carry the 3 out of a plain assignment or pipeline, but a test
# such as [ "$(box_ssh ...)" = yes ] drops it.

DEVBOX_REGISTRY="${DEVBOX_REGISTRY:-$HOME/.config/devbox/boxes.conf}"   # set it only in tests
BOX_TIMEOUT=8
BOX_SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=$BOX_TIMEOUT -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
BOX_NAME="" BOX_SSH="" BOX_CO="" BOX_ORCA="" BOX_AGENTS=""
ORCA="$(command -v orca || echo "$HOME/Applications/Orca.app/Contents/Resources/bin/orca")"

box_registry() {
  # `git config -f` exits 1 both for a missing file and for a missing key, so the file is tested first.
  [ -f "$DEVBOX_REGISTRY" ] || die "no box registry at $DEVBOX_REGISTRY (the setup is in scripts/devenv/boxes.sh's header)"
}

box_names() {
  git config -f "$DEVBOX_REGISTRY" --get-regexp '^box\..*\.ssh$' | sed 's/^box\.\(.*\)\.ssh .*/\1/' || true
}

# box_load <name>: fill the BOX_* globals for <name>, or STOP naming what is missing. Callers trust them after this.
box_load() {
  local name="$1" re='^[a-z][a-z0-9-]{0,30}$' k v
  box_registry
  BOX_NAME="$name" BOX_SSH="" BOX_CO="" BOX_ORCA="" BOX_AGENTS=""
  if [[ "$name" =~ $re ]]; then
    while read -r k v; do
      case "${k#box.$name.}" in
        ssh) BOX_SSH="$v" ;; checkout) BOX_CO="$v" ;; orca) BOX_ORCA="$v" ;; agents) BOX_AGENTS="$v" ;;
      esac
    done < <(git config -f "$DEVBOX_REGISTRY" --get-regexp "^box\.$name\." || true)
  fi
  [ -n "$BOX_SSH" ] || die "no box '$name' in $DEVBOX_REGISTRY (boxes: $(box_names | tr '\n' ' '))"
  [ -n "$BOX_CO" ] || die "box $name has no checkout: git config -f $DEVBOX_REGISTRY box.$name.checkout <path under its home>"
  case "$BOX_CO" in /*|"~"*) die "box.$name.checkout is relative to the box user's home (got $BOX_CO)" ;; esac
  case "$BOX_ORCA" in ""|env:?*) ;; *) die "box.$name.orca: env:<paired Orca server name> (got $BOX_ORCA)" ;; esac
  case "$BOX_AGENTS" in *[!0-9]*) die "box.$name.agents: a number (got $BOX_AGENTS)" ;; esac
}

# box_default: print the box for a task started without --box: devbox.default, else the only box.
box_default() {
  local d n
  box_registry
  d="$(git config -f "$DEVBOX_REGISTRY" devbox.default || true)"
  if [ -n "$d" ]; then echo "$d"; return; fi
  n="$(box_names)"
  [ -n "$n" ] && [ "$(echo "$n" | wc -l)" -eq 1 ] || die "no devbox.default and more than one box ($(echo $n)): pass --box <name>"
  echo "$n"
}

# box_show <where the box came from>: the first line every command prints.
box_show() { echo "box   $BOX_NAME ($BOX_SSH), checkout ~/$BOX_CO   [$1]"; }

# ssh exits 255 only when it could not connect or the connection dropped; any other status is the remote command's.
box_ssh() {
  local rc=0
  ssh "${BOX_SSH_OPTS[@]}" "$BOX_SSH" "$@" || rc=$?
  [ "$rc" != 255 ] || box_unreachable
  return "$rc"
}

# box_scp <args>: scp with the box's options; an argument BOX:<path> means <path> on the box.
box_scp() {
  local a args=()
  for a in "$@"; do case "$a" in BOX:*) args+=("$BOX_SSH:${a#BOX:}") ;; *) args+=("$a") ;; esac; done
  scp -q "${BOX_SSH_OPTS[@]}" "${args[@]}"
}

# Every command calls it before it changes anything, on either side.
box_reach() { box_ssh true; }

# The caller sets BOX_STARTED (exported, so handoff.sh sees it) once it has changed something.
box_unreachable() {
  echo "STOP  box $BOX_NAME ($BOX_SSH) did not answer over SSH: asleep, off Tailscale, Remote Login off, or the key refused." >&2
  if [ -n "${BOX_STARTED:-}" ]; then echo "      Steps already done stay done. Wake it and run the same command again." >&2
  else echo "      Nothing was changed. Wake it and run the same command again." >&2; fi
  exit 3
}

# The one reader of BOX_ORCA: the orca CLI flags that reach the box's Orca server, into AGENT_ROUTE.
# Returns 1 when the box has no Orca server.
agent_route() {
  case "$BOX_ORCA" in
    env:*) AGENT_ROUTE=(--environment "${BOX_ORCA#env:}") ;;
    *) return 1 ;;
  esac
}

# start calls it before any change, so a box with no agent route leaves no trace.
agent_ready() {
  agent_route || die "box $BOX_NAME has no Orca server (box.$BOX_NAME.orca in $DEVBOX_REGISTRY); use --no-agent"
  [ -x "$ORCA" ] || die "no orca CLI at $ORCA (install Orca, or use --no-agent and start Claude in the env yourself)"
}

# agent_launch <worktree on the box> <prompt>
agent_launch() {
  agent_route
  # A long prompt takes a while to type in, and Orca may answer "could not confirm the launch outcome" although
  # the agent started. So the proof is a live terminal in the env (agent_alive), not the launch reply.
  "$ORCA" agent launch "${AGENT_ROUTE[@]}" --agent claude --surface terminal --focus \
    --worktree "path:$1" --prompt "$2" --json >/dev/null 2>&1 || true
}

# agent_alive <worktree on the box>: a terminal is open there.
agent_alive() {
  agent_route && "$ORCA" terminal list "${AGENT_ROUTE[@]}" --worktree "path:$1" 2>/dev/null | grep -q "^term_"
}

# agent_stop <worktree on the box>: close its terminals. A box with no Orca server has none.
agent_stop() {
  local t
  agent_route && [ -x "$ORCA" ] || return 0
  for t in $("$ORCA" terminal list "${AGENT_ROUTE[@]}" --worktree "path:$1" 2>/dev/null | grep -oE '^term_[a-z0-9-]+'); do
    "$ORCA" terminal close "${AGENT_ROUTE[@]}" --terminal "$t" >/dev/null 2>&1 && echo "closed Orca terminal $t"
  done
}
