#!/usr/bin/env bash
# One command per stage of an agent task on a dev box. Run on the laptop, from any checkout of the repo.
#
#   task.sh start <name> [--box <box>] [--brief <file>] [--from <ref>] [--no-agent]
#       branch box/<name> off <ref> (default: master) -> hand it to the box -> copy the brief to the box (private,
#       outside the repo) -> make the env (devenv.sh create <name> --on box/<name>) -> turn the Definition of Done on
#       -> start Claude in that env, visible in Orca. --no-agent stops before Claude.
#       Write the brief from scripts/devenv/BRIEF_TEMPLATE.md, keeping the filled copy outside the repo.
#   task.sh status <name>    who has the branch, what the Definition of Done still lacks, where the report is
#   task.sh done <name>      bring the agent's commits back to the laptop and print its report (review, merge and
#                            push stay with you)
#   task.sh clean <name>     after you merged: remove the env and the branch on the box (refused while the box has
#                            commits the laptop lacks)
#   task.sh list             every task branch on the laptop and the box it is on (no SSH)
#   task.sh watch [--every <seconds>]
#                            each recorded task's agent: working, finished (its report's Status is DONE or BLOCKED),
#                            crashed (no agent in its env and no finished report) or unreachable (the box did not
#                            answer). One SSH per box, read only. A change prints ALERT and raises a macOS notification;
#                            the last state per task is kept in ${XDG_STATE_HOME:-~/.local/state}/devbox/watch/<name>.
#                            --every repeats until Ctrl-C.
#
# <name>: lowercase letters, digits and dashes (it names the env, its site t-<name>.localhost and its DB).
# <box>: a box in the registry (scripts/devenv/boxes.sh); without --box, the registry's default. start records the
# box in the repo's git config (devbox-task.<name>.box), and every later command goes to that box.
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

# The one rule for a task's state. alive: 1 or 0 for a claude process whose folder is the task's env, - when the box
# did not answer. A finished Claude session stays alive waiting for input, so alive alone never means working.
task_state() {
  case "$1:$2" in
    -:*) echo unreachable ;;
    ?:DONE|?:BLOCKED) echo finished ;;
    1:*) echo working ;;
    *) echo crashed ;;
  esac
}

# Runs on a box under bash -s (bash 3.2 on macOS), args <checkout> <task>...: per task "<name>\t<alive>\t<the first
# paragraph under ## Status in its report, joined: reports wrap it>". Paths are compared physical (pwd -P), as /proc
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
  alive=0; printf '%s\n' "$cwds" | grep -qxF "$root/benches/$n/apps/nirmaan_stack" && alive=1
  line="$(awk 'f && /^#/ {exit} f && NF {gsub(/\t/, " "); p = p (p == "" ? "" : " ") $0; next} f && p != "" {exit}
    /^## Status/ {f=1} END {print p}' ~/claude-artifacts/dod/box-"$n"/REPORT.md 2>/dev/null)"
  printf '%s\t%s\t%s\n' "$n" "$alive" "$line"
done
EOF
}

WATCH_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/devbox/watch"

watch_pass() {
  local recs box names n out rc note row alive line word state detail old alerts="" f
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
      alive=- line=""
      [ -z "$row" ] || IFS=$'\t' read -r _ alive line <<<"$row"
      word="$(printf '%s\n' "$line" | awk '{print toupper($1)}' | tr -cd 'A-Z0-9_')"
      state="$(task_state "$alive" "$word")"
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

CMD="${1:-}"
case "$CMD" in
  start|status|done|clean) ;;
  watch)
    [ $# = 1 ] || { [ $# = 3 ] && [ "$2" = --every ] && [[ "$3" =~ ^[1-9][0-9]*$ ]]; } \
      || die "usage: task.sh watch [--every <seconds>]"
    while :; do watch_pass; [ $# = 3 ] || break; sleep "$3"; done
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
  *) sed -n '2,27p' "$0"; exit 1 ;;
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
2. Write the failing tests first, then the change. Commit as you go, on $BRANCH only.
3. Prove it as the Definition of Done says: scripts/devenv/devenv.sh test --affected \$(python3 scripts/devenv/dod.py base); scripts/devenv/devenv.sh typecheck when frontend/src changed; walk each changed or named screen with the verify skill.
4. Fill in the report at ~/$DIR/REPORT.md. Run python3 scripts/devenv/dod.py check until it says done.
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
else TASK_BOX="$(box_default)"; FROM_WHERE="the default"; fi
box_load "$TASK_BOX"
box_show "$FROM_WHERE"

case "$CMD" in
  start)
    [ -z "$BRIEF" ] || [ -s "$BRIEF" ] || die "no brief at $BRIEF"
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
    echo; box_ssh "cat ~/$DIR/REPORT.md 2>/dev/null" || echo "(no report on the box)"
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
    echo "Then merge and push yourself. Afterwards: task.sh clean $NAME"
    ;;

  clean)
    V="$("$SELF_DIR/handoff.sh" status "$BOX_NAME" "$BRANCH" | sed -n 's/^verdict: //p')"
    case "$V" in
      IN_SYNC|LAPTOP_AHEAD|ONLY_LAPTOP|NOWHERE) ;;
      *) die "$V: the box has commits on $BRANCH the laptop lacks. Run task.sh done $NAME first." ;;
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
