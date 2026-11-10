#!/usr/bin/env bash
# One command per stage of an agent task on a dev box. Run on the laptop, from any checkout of the repo.
#
#   task.sh start <name> [--box <box>] [--brief <file>] [--from <ref>] [--no-agent]
#       branch box/<name> off <ref> (default: master) -> hand it to the box -> copy the brief to the box (private,
#       outside the repo) -> make the env (devenv.sh create <name> --on box/<name>) -> turn the Definition of Done on
#       -> start Claude in that env, visible in Orca. --no-agent stops before Claude.
#       Write the brief from scripts/devenv/BRIEF_TEMPLATE.md, keeping the filled copy outside the repo.
#   task.sh status <name>    who has the branch, what the Definition of Done still lacks, where the report is
#   task.sh done <name>      bring the agent's commits back to the laptop and print its report, kept at
#                            ${XDG_STATE_HOME:-~/.local/state}/devbox/reports/<name>.md (review, merge and
#                            push stay with you)
#   task.sh clean <name>     after you merged: remove the env and the branch on the box (refused while the box has
#                            commits the laptop lacks, unless a laptop ref already holds the box tip: landed.sh)
#   task.sh prune [--yes]    each recorded task, one line: PRUNE when a laptop ref holds its box tip (landed.sh:
#                            master, upstream/ or origin/ develop and main) and nothing holds it, else KEEP with the
#                            holds: unreachable, working (its agent, as watch counts it), tracked-changes, untracked,
#                            status-failed (git status failed; these three in its env on the box), unfetched (the
#                            laptop lacks the box tip: task.sh done first), off-branch (the env's HEAD is off
#                            box/<name> and no laptop ref holds it).
#                            One SSH pair per box, read only. --yes runs task.sh clean on each PRUNE task.
#   task.sh list             every task branch on the laptop and the box it is on (no SSH)
#   task.sh pick             the box the next start without --box would get, and why (one SSH per box, read only)
#   task.sh watch [--every <seconds>]
#                            each recorded task's agent: working, finished (its report's Status is DONE or BLOCKED),
#                            crashed (no agent in its env and no finished report) or unreachable (the box did not
#                            answer). One SSH per box, read only. A change prints ALERT and raises a macOS notification;
#                            the last state per task is kept in ${XDG_STATE_HOME:-~/.local/state}/devbox/watch/<name>.
#                            --every repeats until Ctrl-C.
#
# <name>: lowercase letters, digits and dashes (it names the env, its site t-<name>.localhost and its DB).
# <box>: a box in the registry (scripts/devenv/boxes.sh). Without --box, start picks one: with devbox.order in the
# registry, the first box in that order whose working agents (as watch counts them) are fewer than its
# box.<name>.agents (1 when unset), passing over a box that does not answer; without devbox.order, devbox.default.
# start records the box in the repo's git config (devbox-task.<name>.box), and every later command goes to that box.
# Exit 3: the box did not answer; run the same command again once it is awake (watch reports it as a state instead).
# The brief and the report live on the box in ~/claude-artifacts/dod/box-<name>/ (the repo is public: a brief may
# describe what must not be published).
# The whole body sits in { ... } so bash parses it before running: editing this file mid-run is safe.
{
set -euo pipefail

die() { echo "STOP  $*" >&2; exit 1; }
ok() { echo "ok    $*"; }
step() { echo; echo "== $*"; }

SELF_DIR="$(cd "$(dirname "$0")" && pwd -P)"
cd "$(git -C "$SELF_DIR" rev-parse --show-toplevel)"
. "$SELF_DIR/boxes.sh"
. "$SELF_DIR/landed.sh"

# The one rule for a task's state: task_state <alive> <report word> <dod>. alive: 1 or 0 for a claude process whose
# folder is the task's env, - when the box did not answer. A finished Claude session stays alive waiting for input,
# so alive alone never means working. dod: 1 or 0 for `dod.py check` in the env, - when the env has no dod.py. A
# report says DONE before its last test run ends ("DONE (draft, ...)", #1611), so DONE counts only with the check.
task_state() {
  case "$1:$2:$3" in
    -:*) echo unreachable ;;
    ?:DONE:1|?:BLOCKED:1|?:DONE:-|?:BLOCKED:-) echo finished ;;
    1:*) echo working ;;
    *) echo crashed ;;
  esac
}

# Runs on a box under bash -s (bash 3.2 on macOS), args <checkout> <task>...: per task "<name>\t<alive>\t<dod>\t<the
# first paragraph under ## Status in its report, joined: reports wrap it>". Paths are compared physical (pwd -P), as /proc
# and lsof report them, and exactly: the macOS box also runs spare claude daemons in other folders.
watch_probe() {
  cat <<'EOF'
co="$1"; shift
root="$(cd ~/"$co"/../.. && pwd -P)" || exit 4
case "$(uname)" in
  Linux) cwds="$(for p in $(pgrep '^claude'); do readlink "/proc/$p/cwd"; done 2>/dev/null)" ;;
  *) cwds="$(lsof -a -c claude -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" ;;
esac
for n in "$@"; do
  wt="$root/benches/$n/apps/nirmaan_stack"
  alive=0; printf '%s\n' "$cwds" | grep -qxF "$wt" && alive=1
  dod=-; [ ! -f "$wt/scripts/devenv/dod.py" ] || { dod=0; (cd "$wt" && python3 scripts/devenv/dod.py check) >/dev/null 2>&1 && dod=1; }
  line="$(awk 'f && /^#/ {exit} f && NF {gsub(/\t/, " "); p = p (p == "" ? "" : " ") $0; next} f && p != "" {exit}
    /^## Status/ {f=1} END {print p}' ~/claude-artifacts/dod/box-"$n"/REPORT.md 2>/dev/null)"
  printf '%s\t%s\t%s\t%s\n' "$n" "$alive" "$dod" "$line"
done
EOF
}

# Runs under python3 - <claude home>, on the laptop and on a box: the enabled plugins with their installed versions,
# and a hash of pstack-models.md (its model roles and its SessionStart hook switch). A box that lacked pstack ran 13
# agent tasks without it, and nothing said so.
claude_setup() {
  cat <<'EOF'
import hashlib, json, os, sys
home = sys.argv[1]
def load(name):
    try:
        with open(os.path.join(home, name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}
enabled = sorted(k for k, v in (load("settings.json").get("enabledPlugins") or {}).items() if v)
installed = load("plugins/installed_plugins.json").get("plugins") or {}
for name in enabled:
    versions = sorted({str(e.get("version", "?")) for e in installed.get(name, [])})
    print("plugin", name, ",".join(versions) or "not-installed")
try:
    with open(os.path.join(home, "pstack-models.md"), "rb") as f:
        print("pstack-models.md", hashlib.sha256(f.read()).hexdigest()[:12])
except OSError:
    print("pstack-models.md absent")
EOF
}

WATCH_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/devbox/watch"

watch_pass() {
  local recs box names n out rc note row alive dod line word state detail old alerts="" f
  mkdir -p "$WATCH_DIR"
  recs="$(git config --get-regexp '^devbox-task\..*\.box$' | sed 's/^devbox-task\.\(.*\)\.box /\1 /' | sort -k2,2 -k1,1 || true)"
  echo; echo "== $(date '+%Y-%m-%d %H:%M:%S')  task watch"
  [ -n "$recs" ] || echo "no task records (task.sh start makes them)"
  for box in $(printf '%s\n' "$recs" | awk 'NF {print $2}' | sort -u); do
    names="$(printf '%s\n' "$recs" | awk -v b="$box" '$2 == b {print $1}')"
    out="" note=""
    if ! note="$(box_load "$box" 2>&1)"; then note="${note#STOP  }"
    else
      box_load "$box"; rc=0
      out="$(watch_probe | ssh "${BOX_SSH_OPTS[@]}" "$BOX_SSH" bash -s -- "$BOX_CO" $names 2>/dev/null)" || rc=$?
      case "$rc" in 0) ;; 255) note="did not answer over SSH" ;; *) note="the probe failed on the box (exit $rc)" ;; esac
    fi
    for n in $names; do
      row="$(printf '%s\n' "$out" | awk -F'\t' -v n="$n" '$1 == n {print; exit}')"
      alive=- dod=- line=""
      [ -z "$row" ] || IFS=$'\t' read -r _ alive dod line <<<"$row"
      word="$(printf '%s\n' "$line" | awk '{print toupper($1)}' | tr -cd 'A-Z0-9_')"
      state="$(task_state "$alive" "$word" "$dod")"
      case "$state" in
        finished) detail="$(printf '%s\n' "$line" | sed 's/\([.!?]\)[[:space:]].*/\1/')" ;;
        unreachable) detail="${note:-no answer for this task}" ;;
        *) detail="" ;;
      esac
      printf '%-28s %-10s %-11s %s\n' "$n" "$box" "$state" "$detail"
      old="$(cat "$WATCH_DIR/$n" 2>/dev/null || echo unseen)"
      # A first sight alerts only when something is wrong; a working or finished task is just shown.
      if [ "$old" != "$state" ] && { [ "$old" != unseen ] || [ "$state" = crashed ] || [ "$state" = unreachable ]; }; then
        alerts="$alerts$n on $box: $old -> $state"$'\n'
      fi
      echo "$state" > "$WATCH_DIR/$n.new" && mv "$WATCH_DIR/$n.new" "$WATCH_DIR/$n"
    done
  done
  printf '%s' "$alerts" | while IFS= read -r a; do
    echo "ALERT $a"
    if command -v osascript >/dev/null; then
      osascript -e "display notification \"$a\" with title \"task.sh watch\"" >/dev/null 2>&1 || true
    fi
  done
  for f in "$WATCH_DIR"/*; do
    [ -e "$f" ] || continue
    n="${f##*/}"
    printf '%s\n' "$recs" | awk -v n="$n" '$1 == n {f=1} END {exit !f}' && continue
    rm -f "$f"; echo "gone  $n: no task record, its watch state removed"
  done
}

# box_pick: set PICK and PICK_WHY for a start without --box (the rule is in the header, under <box>).
box_pick() {
  local order b names out rc busy cap alive dod line word
  PICK="" PICK_WHY=""
  box_registry
  order="$(git config -f "$DEVBOX_REGISTRY" devbox.order || true)"
  if [ -z "$order" ]; then PICK="$(box_default)"; PICK_WHY="the default"; return 0; fi
  for b in $order; do
    if ! out="$(box_load "$b" 2>&1)"; then echo "  $b: ${out#STOP  }"; continue; fi
    box_load "$b"
    names="$(git config --get-regexp '^devbox-task\..*\.box$' | awk -v b="$b" '$2 == b {print $1}' | sed 's/^devbox-task\.//; s/\.box$//' || true)"
    rc=0; out="$(watch_probe | ssh "${BOX_SSH_OPTS[@]}" "$BOX_SSH" bash -s -- "$BOX_CO" $names 2>/dev/null)" || rc=$?
    if [ "$rc" != 0 ]; then echo "  $b: did not answer over SSH (exit $rc)"; continue; fi
    busy=0
    while IFS=$'\t' read -r _ alive dod line; do
      [ -n "$alive" ] || continue
      word="$(printf '%s\n' "$line" | awk '{print toupper($1)}' | tr -cd 'A-Z0-9_')"
      [ "$(task_state "$alive" "$word" "$dod")" != working ] || busy=$((busy + 1))
    done <<<"$out"
    cap="${BOX_AGENTS:-1}"
    echo "  $b: $busy of $cap agents working"
    if [ "$busy" -lt "$cap" ]; then
      PICK="$b"; PICK_WHY="picked by devbox.order ($order): $busy of $cap agents working"; return 0
    fi
  done
  die "no box in devbox.order ($order) has a free agent (lines above). Pass --box <name> to start on one anyway."
}

# Runs on a box under bash -s, args <checkout> <task>...: per task
# "<name>\t<env worktree>\t<tip>\t<tracked>\t<untracked>\t<status rc>\t<head>".
# tip: box/<name>'s commit, else the env worktree's HEAD, else - (nothing of the task is left on the box). The counts
# are git status lines in the env worktree; status rc is that git status's exit status. head: the env worktree's HEAD,
# else -.
prune_probe() {
  cat <<'EOF'
co="$1"; shift
cd ~/"$co" || exit 4
root="$(cd ../.. && pwd -P)"
for n in "$@"; do
  wt="$root/benches/$n/apps/nirmaan_stack" st="" src=0 head=""
  tip="$(git rev-parse -q --verify "refs/heads/box/$n^{commit}" || true)"
  if [ -d "$wt" ]; then
    head="$(git -C "$wt" rev-parse -q --verify HEAD || true)"
    [ -n "$tip" ] || tip="$head"
    st="$(git -C "$wt" status --porcelain 2>/dev/null)" || src=$?
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$n" "$wt" "${tip:--}" "$(printf '%s\n' "$st" | grep -c '^[^?]')" "$(printf '%s\n' "$st" | grep -c '^??')" "$src" "${head:--}"
done
EOF
}

# The holds of a box task, one check per name, each printing the hold when it applies to the task in the T_* globals.
TASK_HOLDS="unreachable working tracked-changes untracked status-failed unfetched off-branch"
task_hold_unreachable() { [ -z "$T_NOTE" ] || echo unreachable; }
task_hold_working() { [ "$T_STATE" != working ] || echo working; }
task_hold_tracked_changes() { [ "$T_TRACKED" = 0 ] || echo "tracked-changes:$T_TRACKED"; }
task_hold_untracked() { [ "$T_UNTRACKED" = 0 ] || echo "untracked:$T_UNTRACKED"; }
task_hold_status_failed() { [ "$T_STATUS_RC" = 0 ] || echo status-failed; }
task_hold_unfetched() {
  [ -z "$T_NOTE" ] && [ "$T_TIP" != - ] && ! git cat-file -e "$T_TIP^{commit}" 2>/dev/null && echo unfetched || true
}
# The env worktree's HEAD away from box/<name> (a side branch, a detached commit): clean's destroy removes the worktree
# and its HEAD reflog, so commits only that HEAD reaches would be lost unless a laptop ref already holds them.
task_hold_off_branch() {
  [ -z "$T_NOTE" ] && [ "$T_HEAD" != - ] && [ "$T_HEAD" != "$T_TIP" ] && ! landed "$T_HEAD" >/dev/null     && echo "off-branch:${T_HEAD:0:9}" || true
}

# prune_tasks <yes>: one row per recorded task (see the header). Exit 3 when a box did not answer.
prune_tasks() {
  local yes="$1" recs box names n out wout rc row alive dod line word h d where rows="" keep="" todo="" down=0 failed=0
  recs="$(git config --get-regexp '^devbox-task\..*\.box$' | sed 's/^devbox-task\.\(.*\)\.box /\1 /' | sort -k2,2 -k1,1 || true)"
  echo "== $(date '+%Y-%m-%d %H:%M:%S')  task prune: box tasks whose box tip a laptop ref holds"
  [ -n "$recs" ] || echo "no task records (task.sh start makes them)"
  for box in $(printf '%s\n' "$recs" | awk 'NF {print $2}' | sort -u); do
    names="$(printf '%s\n' "$recs" | awk -v b="$box" '$2 == b {print $1}')"
    out="" wout="" T_NOTE=""
    if ! T_NOTE="$(box_load "$box" 2>&1)"; then T_NOTE="${T_NOTE#STOP  }"
    else
      box_load "$box"; rc=0
      out="$(prune_probe | ssh "${BOX_SSH_OPTS[@]}" "$BOX_SSH" bash -s -- "$BOX_CO" $names 2>/dev/null)" || rc=$?
      [ "$rc" != 0 ] || wout="$(watch_probe | ssh "${BOX_SSH_OPTS[@]}" "$BOX_SSH" bash -s -- "$BOX_CO" $names 2>/dev/null)" || rc=$?
      case "$rc" in 0) ;; 255) T_NOTE="did not answer over SSH"; down=1 ;; *) T_NOTE="the probe failed on the box (exit $rc)" ;; esac
    fi
    [ -z "$T_NOTE" ] || echo "box $box: $T_NOTE"
    for n in $names; do
      T_WT="" T_TIP=- T_TRACKED=0 T_UNTRACKED=0 T_STATUS_RC=0 T_HEAD=- alive=- dod=- line=""
      row="$(printf '%s\n' "$out" | awk -F'\t' -v n="$n" '$1 == n {print; exit}')"
      [ -z "$row" ] || IFS=$'\t' read -r _ T_WT T_TIP T_TRACKED T_UNTRACKED T_STATUS_RC T_HEAD <<<"$row"
      row="$(printf '%s\n' "$wout" | awk -F'\t' -v n="$n" '$1 == n {print; exit}')"
      [ -z "$row" ] || IFS=$'\t' read -r _ alive dod line <<<"$row"
      word="$(printf '%s\n' "$line" | awk '{print toupper($1)}' | tr -cd 'A-Z0-9_')"
      T_STATE="$(task_state "$alive" "$word" "$dod")"
      d=""; for h in $TASK_HOLDS; do d="$d $(task_hold_${h//-/_})"; done; d="$(echo $d)"
      where=""
      if [ -z "$T_NOTE" ]; then
        if [ "$T_TIP" = - ]; then where="nothing-on-box"; else where="$(landed "$T_TIP")" || where=""; fi
      fi
      if [ -n "$where" ] && [ -z "$d" ]; then
        rows="$rows$(printf 'PRUNE  box-task %-28s %-60s landed:%s' "$n" "$box:$T_WT" "$where")"$'\n'
        todo="$todo $n"
      else
        keep="$keep$(printf 'KEEP   box-task %-28s %-60s landed:%-18s %s' "$n" "$box:${T_WT:-?}" "${where:--}" "$d")"$'\n'
      fi
    done
  done
  printf '%s%s' "$rows" "$keep"
  if [ -z "$todo" ]; then echo "to prune: 0 tasks"
  elif [ "$yes" = 0 ]; then echo "to prune:$todo (task.sh prune --yes cleans them; laptop branches stay)"
  else
    for n in $todo; do echo; echo "== clean $n"; bash "$SELF_DIR/task.sh" clean "$n" </dev/null || failed=1; done
  fi
  [ "$down" = 0 ] || exit 3
  return "$failed"
}

CMD="${1:-}"
case "$CMD" in
  start|status|done|clean) ;;
  prune)
    [ $# = 1 ] || { [ $# = 2 ] && [ "$2" = --yes ]; } || die "usage: task.sh prune [--yes]"
    prune_tasks "$([ $# = 2 ] && echo 1 || echo 0)"
    exit ;;
  watch)
    [ $# = 1 ] || { [ $# = 3 ] && [ "$2" = --every ] && [[ "$3" =~ ^[1-9][0-9]*$ ]]; } \
      || die "usage: task.sh watch [--every <seconds>]"
    while :; do watch_pass; [ $# = 3 ] || break; sleep "$3"; done
    exit 0 ;;
  pick)
    [ $# = 1 ] || die "usage: task.sh pick"
    box_pick; box_load "$PICK"; box_show "$PICK_WHY"
    exit 0 ;;
  list)
    # Records outlive a laptop branch the owner removed after merging, and those tasks still sit on their box.
    { git for-each-ref --format='%(refname:short)' 'refs/heads/box/*' | sed 's|^box/||'
      git config --get-regexp '^devbox-task\..*\.box$' | sed 's/^devbox-task\.\(.*\)\.box .*/\1/' || true
    } | sort -u | while read -r n; do
      b="$(git config "devbox-task.$n.box" || echo "no record")"
      git rev-parse -q --verify "refs/heads/box/$n" >/dev/null || b="$b (no laptop branch)"
      printf '%-28s %s\n' "$n" "$b"
    done
    exit 0 ;;
  *) sed -n '2,38p' "$0"; exit 1 ;;
esac
NAME="${2:-}"
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || die "name: lowercase letters, digits and dashes, at most 31 (got '$NAME')"
shift 2
BRANCH="box/$NAME"   # not agent/: a branch named "agent" exists, and git cannot have both
DIR="claude-artifacts/dod/box-$NAME"                    # on the box, under the box user's home
RECORD="devbox-task.$NAME.box"
box_root() { box_ssh "cd ~/$BOX_CO/../.. && pwd"; }     # the box's dev root (frappe_docker/development)

prompt() {
  cat <<EOF
You are an agent on a dev box, working on task '$NAME' in this worktree (branch $BRANCH, its own env and DB).
1. Read the brief: ~/$DIR/BRIEF.md (if it is missing, stop and say so). Then read CLAUDE.md and docs/agents/definition-of-done.md.
2. Call the Skill tool with mattpocock-skills:tdd before the first test, and build the change through it (red first). Commit as you go, on $BRANCH only.
3. Prove it as the Definition of Done says: scripts/devenv/devenv.sh test --affected \$(python3 scripts/devenv/dod.py base); scripts/devenv/devenv.sh typecheck when frontend/src changed; walk each changed or named screen with the verify skill.
4. Call the Skill tool with mattpocock-skills:code-review against \$(python3 scripts/devenv/dod.py base), and fix its findings that are inside the task. A skill the brief names is called the same way, with the Skill tool, by its exact name.
5. Fill in the report at ~/$DIR/REPORT.md. Run python3 scripts/devenv/dod.py check until it says done (it checks that tdd and code-review were loaded).
Never push, never open a PR, never touch GitHub issues. If the task cannot be done, set the report's Status to BLOCKED and say what the owner must decide.
EOF
}

BRIEF=""; FROM="master"; AGENT=1; FLAG_BOX=""
while [ $# -gt 0 ]; do
  [ "$CMD" = start ] || die "task.sh $CMD takes no options (the box comes from the record)"
  case "$1" in
    --box) FLAG_BOX="${2:?--box needs a box name}"; shift 2 ;;
    --brief) BRIEF="${2:?--brief needs a file}"; shift 2 ;;
    --from) FROM="${2:?--from needs a ref}"; shift 2 ;;
    --no-agent) AGENT=0; shift ;;
    *) die "unknown option $1" ;;
  esac
done

# The record wins. Only start may pick a box, and only for a task with no record yet.
REC="$(git config "$RECORD" || true)"
if [ -n "$REC" ]; then
  [ -z "$FLAG_BOX" ] || [ "$FLAG_BOX" = "$REC" ] || die "task $NAME is on box $REC (git config $RECORD). Finish it there (task.sh done, task.sh clean $NAME), or pick another name."
  TASK_BOX="$REC"; FROM_WHERE="from the record"
elif [ "$CMD" != start ]; then
  die "task $NAME has no box record, so its box is unknown. If you know it: git config $RECORD <box>"
elif [ -n "$FLAG_BOX" ]; then TASK_BOX="$FLAG_BOX"; FROM_WHERE="--box"
else box_pick; TASK_BOX="$PICK"; FROM_WHERE="$PICK_WHY"; fi
box_load "$TASK_BOX"
box_show "$FROM_WHERE"

case "$CMD" in
  start)
    [ -z "$BRIEF" ] || [ -s "$BRIEF" ] || die "no brief at $BRIEF"
    # A placeholder left from BRIEF_TEMPLATE.md would hand the agent a wrong base, ticket or env.
    [ -z "$BRIEF" ] || ! grep -n '<<FILL' "$BRIEF" >&2 || die "the brief still holds a <<FILL: …>> from the template (lines above): fill it first"
    # The title names the task's GitHub issue, so its merge and its closing have one to name (fix #1655 had none
    # until after it was built). An experiment, which never merges, says so instead. An issue number has three digits
    # or more, so a step number ("#2") does not pass for one.
    [ -z "$BRIEF" ] || head -n 1 "$BRIEF" | grep -Eq '^# Task: (experiment: |.*#[0-9]{3,}([^0-9]|$))' \
      || die "the brief's first line names no issue: write '# Task: … #<issue> …' (file the issue first), or '# Task: experiment: …'"
    [ -z "$BRIEF" ] || python3 -I "$SELF_DIR/brief_skills.py" "$BRIEF" "${DEVBOX_CLAUDE_HOME:-$HOME/.claude}" >&2 \
      || die "the brief names a skill only a person can start (above): the box agent's Skill tool refuses it. Name the steps it should take instead"
    [ "$AGENT" = 0 ] || agent_ready
    box_reach

    step "1. branch $BRANCH"
    if git rev-parse -q --verify "refs/heads/$BRANCH" >/dev/null; then ok "$BRANCH exists (at $(git rev-parse --short "$BRANCH"))"
    else git branch "$BRANCH" "$FROM"; ok "made $BRANCH from $FROM ($(git rev-parse --short "$FROM"))"; fi
    git config "$RECORD" "$BOX_NAME"
    export BOX_STARTED=1

    step "2. hand it to box $BOX_NAME"
    "$SELF_DIR/handoff.sh" to "$BOX_NAME" "$BRANCH" | tail -1

    step "3. brief"
    box_ssh "mkdir -p ~/$DIR && chmod 700 ~/claude-artifacts ~/claude-artifacts/dod ~/$DIR 2>/dev/null; true"
    if [ -n "$BRIEF" ]; then
      box_scp "$BRIEF" "BOX:$DIR/BRIEF.md"; box_ssh "chmod 600 ~/$DIR/BRIEF.md"
      ok "copied to $BOX_NAME:~/$DIR/BRIEF.md"
    else
      box_ssh "test -s ~/$DIR/BRIEF.md" && ok "the box already has ~/$DIR/BRIEF.md" \
        || echo "note  no brief: the agent will stop and ask for one (pass --brief <file>)"
    fi

    step "4. env and Definition of Done"
    ROOT="$(box_root)"; WT="$ROOT/benches/$NAME/apps/nirmaan_stack"
    if box_ssh "test -d $WT"; then ok "env $NAME exists"
    else box_ssh "cd ~/$BOX_CO && scripts/devenv/devenv.sh create $NAME --on $BRANCH" 2>&1 | grep -E "data:|WARN|Ready|ERROR" || true
      box_ssh "test -d $WT" || die "the env was not made; run the create on the box to see why"
    fi
    box_ssh "cd $WT && ( [ -f \"\$(git rev-parse --absolute-git-dir)/devenv-proof/dod.json\" ] && echo 'ok    Definition of Done already on' || python3 scripts/devenv/dod.py start | sed -n 1p )"

    [ "$AGENT" = 1 ] || { echo; ok "env ready at $WT (no agent started: --no-agent)"; exit 0; }
    step "5. Claude in Orca (box $BOX_NAME)"
    # Claude stops at a "trust this folder?" question whenever the folder's .claude/settings.local.json pre-approves
    # tools, and the question swallows the prompt. The repo commits one (a machine's own file). Hide it in this env
    # only: skip-worktree keeps git seeing it unchanged, so commits and the Definition of Done are unaffected. The
    # box's own deny rules apply either way.
    # Claude also reads it from the main checkout (the env is a worktree of it), so hide it in both.
    box_ssh "for d in $WT ~/$BOX_CO; do (cd \$d && if git ls-files --error-unmatch .claude/settings.local.json >/dev/null 2>&1 && [ -f .claude/settings.local.json ]; then git update-index --skip-worktree .claude/settings.local.json && rm .claude/settings.local.json; fi); done; python3 -c 'import json,os,sys; p=os.path.expanduser(\"~/.claude.json\"); c=json.load(open(p)) if os.path.exists(p) else {}; c.setdefault(\"projects\",{}).setdefault(sys.argv[1],{})[\"hasTrustDialogAccepted\"]=True; json.dump(c,open(p,\"w\"),indent=2)' $WT" \
      && ok "env ready for Claude (folder trusted, the committed settings.local.json hidden in this env)"
    HERE_SETUP="$(claude_setup | python3 - "${DEVBOX_CLAUDE_HOME:-$HOME/.claude}")"
    BOX_SETUP="$(claude_setup | box_ssh 'python3 - ~/.claude')"
    # A missing plugin or another pstack-models.md changes what the agent can do: WARN. Versions drift between
    # machines all the time (measured 2026-11-05: three pstack versions on three machines), so they get one note line.
    names() { printf '%s\n' "$1" | awk '$1 == "plugin" {print $1, $2; next} {print}'; }
    if [ "$(names "$HERE_SETUP")" != "$(names "$BOX_SETUP")" ]; then
      echo "WARN  box $BOX_NAME's Claude setup differs from the laptop's: its agent may lack a skill the brief names"
      diff <(names "$HERE_SETUP") <(names "$BOX_SETUP") | sed -n 's/^< /        laptop: /p; s/^> /        box:    /p' || true
    else ok "Claude plugins and pstack-models.md match the laptop's"; fi
    [ "$(names "$HERE_SETUP")" != "$(names "$BOX_SETUP")" ] || [ "$HERE_SETUP" = "$BOX_SETUP" ] \
      || echo "note  plugin versions differ (laptop -> box): $(join -j 2 <(printf '%s\n' "$HERE_SETUP" | awk '$1 == "plugin"' | sort -k2,2) <(printf '%s\n' "$BOX_SETUP" | awk '$1 == "plugin"' | sort -k2,2) | awk '$3 != $5 {printf "%s%s %s -> %s", s, $1, $3, $5; s = "; "}')"
    agent_launch "$WT" "$(prompt)"
    n=0; until agent_alive "$WT"; do
      n=$((n + 1)); [ $n -gt 20 ] && die "no Claude terminal in '$NAME' after 60 s; open the env in Orca and run claude there"; sleep 3
    done
    ok "Claude is working in '$NAME'. Watch it in Orca (box $BOX_NAME). Next: task.sh status $NAME"
    ;;

  status)
    "$SELF_DIR/handoff.sh" status "$BOX_NAME" "$BRANCH" | tail -2
    ROOT="$(box_root)"; WT="$ROOT/benches/$NAME/apps/nirmaan_stack"
    box_ssh "test -d $WT" || die "no env $NAME on box $BOX_NAME"
    echo; box_ssh "cd $WT && git log --oneline -5 && echo && python3 scripts/devenv/dod.py check" || true
    echo; echo "report: $BOX_SSH:~/$DIR/REPORT.md"
    ;;

  done)
    "$SELF_DIR/handoff.sh" from "$BOX_NAME" "$BRANCH"
    export BOX_STARTED=1
    # The report is also kept as a file on the laptop, outside ~/claude-artifacts (no .md there), so a reviewer
    # agent has a path to read.
    REPORT_COPY="${XDG_STATE_HOME:-$HOME/.local/state}/devbox/reports/$NAME.md"
    mkdir -p "$(dirname "$REPORT_COPY")"
    # box_unreachable exits the shell mid-copy: the half-written file goes with it.
    trap 'rm -f "$REPORT_COPY.tmp"' EXIT
    echo
    if box_ssh "cat ~/$DIR/REPORT.md 2>/dev/null" > "$REPORT_COPY.tmp" && [ -s "$REPORT_COPY.tmp" ]; then
      mv "$REPORT_COPY.tmp" "$REPORT_COPY"; cat "$REPORT_COPY"; ok "report kept at $REPORT_COPY"
    else
      rm -f "$REPORT_COPY.tmp"; echo "(no report on the box)"
    fi
    # Bring the task's walk evidence (screenshots, pages) home: the owner's phone link serves only the laptop's
    # ~/claude-artifacts. A copy, so the box keeps its own; reruns only add what changed. Markdown stays on the box
    # (no .md in ~/claude-artifacts, the owner's page rules); the report is printed above.
    HOME_COPY="$HOME/claude-artifacts/box/$BOX_NAME/$NAME"
    mkdir -p "$HOME_COPY"
    for d in "$DIR" "claude-artifacts/verify/$NAME"; do
      box_ssh "test -d ~/$d" || continue
      rsync -a --exclude '*.md' -e "ssh ${BOX_SSH_OPTS[*]}" "$BOX_SSH:$d/" "$HOME_COPY/$(basename "$d")/" \
        && ok "copied the box's ~/$d to $HOME_COPY/$(basename "$d")/"
    done
    echo; echo "Review: git log --stat master..$BRANCH ; git diff master...$BRANCH"
    # The report's ## Review is the runner's step (docs/agents/definition-of-done.md): a fresh read against the task's
    # own base, which the box knows (a branch cut --from another ref has a base master does not).
    ROOT="$(box_root)"
    BASE="$(box_ssh "cd $ROOT/benches/$NAME/apps/nirmaan_stack 2>/dev/null && python3 scripts/devenv/dod.py base" 2>/dev/null || true)"
    git rev-parse -q --verify "${BASE}^{commit}" >/dev/null 2>&1 || BASE="$(git merge-base master "$BRANCH")"
    echo "Separate review (fills the report's ## Review): /mattpocock-skills:code-review ${BASE:0:9}, on $BRANCH"
    echo "Then merge and push yourself. After the merge: task.sh prune (lists what can go; --yes cleans it)"
    ;;

  clean)
    S="$("$SELF_DIR/handoff.sh" status "$BOX_NAME" "$BRANCH")"
    V="$(printf '%s\n' "$S" | sed -n 's/^verdict: //p')"
    case "$V" in
      IN_SYNC|LAPTOP_AHEAD|ONLY_LAPTOP|NOWHERE) ;;
      *) # The verdict compares with the laptop's $BRANCH only: a task merged under another branch name has none.
        R="$(printf '%s\n' "$S" | sed -n "s|^box    $BRANCH: \([0-9a-f]*\) .*|\1|p")"
        WHERE="$(landed "$R")" || die "$V: the box has commits on $BRANCH the laptop lacks. Run task.sh done $NAME first."
        ok "$V, but the box tip ${R:0:9} is already in $WHERE" ;;
    esac
    ROOT="$(box_root)"; WT="$ROOT/benches/$NAME/apps/nirmaan_stack"
    export BOX_STARTED=1
    # Close the task's Orca terminals first: a finished agent would otherwise keep running in a deleted folder.
    agent_stop "$WT"
    box_ssh "cd ~/$BOX_CO && { [ ! -d $WT ] || { scripts/devenv/devenv.sh stop $NAME >/dev/null 2>&1; scripts/devenv/devenv.sh destroy $NAME | tail -1; }; } && { git branch -D $BRANCH 2>/dev/null && echo 'deleted the box branch $BRANCH' || true; }"
    # Last, so a clean that stopped on the box can be rerun and still finds its box.
    git config --unset "$RECORD"
    ok "cleaned $NAME on box $BOX_NAME. The report stays at $BOX_SSH:~/$DIR/ ; the laptop branch $BRANCH is yours to keep or delete."
    ;;
esac
exit
}
