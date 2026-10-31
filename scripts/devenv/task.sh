#!/usr/bin/env bash
# One command per stage of an agent task on a dev box. Run on the laptop, from any checkout of the repo.
#
#   task.sh start <name> [--brief <file>] [--from <ref>] [--no-agent]
#       branch box/<name> off <ref> (default: master) -> hand it to the box -> copy the brief to the box (private,
#       outside the repo) -> make the env (devenv.sh create <name> --on box/<name>) -> turn the Definition of Done on
#       -> start Claude in that env, visible in Orca. --no-agent stops before Claude.
#   task.sh status <name>    who has the branch, what the Definition of Done still lacks, where the report is
#   task.sh done <name>      bring the agent's commits back to the laptop and print its report (review, merge and
#                            push stay with you)
#   task.sh clean <name>     after you merged: remove the env and the branch on the box (refused while the box has
#                            commits the laptop lacks)
#
# <name>: lowercase letters, digits and dashes (it names the env, its site t-<name>.localhost and its DB).
# The box: $DEVBOX_HOST (default dev@contabo) and its Orca server $DEVBOX_ORCA_ENV (default contabo-dev). The box's
# checkout: $DEVBOX_CHECKOUT, as for handoff.sh. The brief and the report live on the box in
# ~/claude-artifacts/dod/box-<name>/ (the repo is public: a brief may describe what must not be published).
# The whole body sits in { ... } so bash parses it before running: editing this file mid-run is safe.
{
set -euo pipefail

die() { echo "STOP  $*" >&2; exit 1; }
ok() { echo "ok    $*"; }
step() { echo; echo "== $*"; }

SELF_DIR="$(cd "$(dirname "$0")" && pwd -P)"
cd "$(git -C "$SELF_DIR" rev-parse --show-toplevel)"
HOST="${DEVBOX_HOST:-dev@contabo}"
ORCA_ENV="${DEVBOX_ORCA_ENV:-contabo-dev}"
BOX_CO="${DEVBOX_CHECKOUT:-work/nirmaan/deploy_setup/frappe_docker/development/nirmaan_stack_variants/master}"
ORCA="$(command -v orca || echo "$HOME/Applications/Orca.app/Contents/Resources/bin/orca")"

CMD="${1:-}"; NAME="${2:-}"
case "$CMD" in start|status|done|clean) ;; *) sed -n '2,19p' "$0"; exit 1 ;; esac
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || die "name: lowercase letters, digits and dashes, at most 31 (got '$NAME')"
shift 2
BRANCH="box/$NAME"   # not agent/: a branch named "agent" exists, and git cannot have both
DIR="claude-artifacts/dod/box-$NAME"                    # on the box, under the box user's home
box() { ssh -o BatchMode=yes "$HOST" "$@"; }
box_root() { box "cd ~/$BOX_CO/../.. && pwd"; }            # the box's dev root (frappe_docker/development)

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

case "$CMD" in
  start)
    BRIEF=""; FROM="master"; AGENT=1
    while [ $# -gt 0 ]; do
      case "$1" in
        --brief) BRIEF="${2:?--brief needs a file}"; shift 2 ;;
        --from) FROM="${2:?--from needs a ref}"; shift 2 ;;
        --no-agent) AGENT=0; shift ;;
        *) die "unknown option $1" ;;
      esac
    done
    [ -z "$BRIEF" ] || [ -s "$BRIEF" ] || die "no brief at $BRIEF"

    step "1. branch $BRANCH"
    if git rev-parse -q --verify "refs/heads/$BRANCH" >/dev/null; then ok "$BRANCH exists (at $(git rev-parse --short "$BRANCH"))"
    else git branch "$BRANCH" "$FROM"; ok "made $BRANCH from $FROM ($(git rev-parse --short "$FROM"))"; fi

    step "2. hand it to $HOST"
    "$SELF_DIR/handoff.sh" to "$HOST" "$BRANCH" | tail -1

    step "3. brief"
    box "mkdir -p ~/$DIR && chmod 700 ~/claude-artifacts ~/claude-artifacts/dod ~/$DIR 2>/dev/null; true"
    if [ -n "$BRIEF" ]; then
      scp -q -o BatchMode=yes "$BRIEF" "$HOST:$DIR/BRIEF.md"; box "chmod 600 ~/$DIR/BRIEF.md"
      ok "copied to $HOST:~/$DIR/BRIEF.md"
    else
      box "test -s ~/$DIR/BRIEF.md" && ok "the box already has ~/$DIR/BRIEF.md" \
        || echo "note  no brief: the agent will stop and ask for one (pass --brief <file>)"
    fi

    step "4. env and Definition of Done"
    ROOT="$(box_root)"; WT="$ROOT/benches/$NAME/apps/nirmaan_stack"
    if box "test -d $WT"; then ok "env $NAME exists"
    else box "cd ~/$BOX_CO && scripts/devenv/devenv.sh create $NAME --on $BRANCH" 2>&1 | grep -E "data:|WARN|Ready|ERROR" || true
      box "test -d $WT" || die "the env was not made; run the create on the box to see why"
    fi
    box "cd $WT && ( [ -f \"\$(git rev-parse --absolute-git-dir)/devenv-proof/dod.json\" ] && echo 'ok    Definition of Done already on' || python3 scripts/devenv/dod.py start | sed -n 1p )"

    [ "$AGENT" = 1 ] || { echo; ok "env ready at $WT (no agent started: --no-agent)"; exit 0; }
    step "5. Claude in Orca ($ORCA_ENV)"
    [ -x "$ORCA" ] || die "no orca CLI at $ORCA (install Orca, or start Claude in the env yourself)"
    # Claude stops at a "trust this folder?" question whenever the folder's .claude/settings.local.json pre-approves
    # tools, and the question swallows the prompt. The repo commits one (a machine's own file). Hide it in this env
    # only: skip-worktree keeps git seeing it unchanged, so commits and the Definition of Done are unaffected. The
    # box's own deny rules apply either way.
    # Claude also reads it from the main checkout (the env is a worktree of it), so hide it in both.
    box "for d in $WT ~/$BOX_CO; do (cd \$d && if git ls-files --error-unmatch .claude/settings.local.json >/dev/null 2>&1 && [ -f .claude/settings.local.json ]; then git update-index --skip-worktree .claude/settings.local.json && rm .claude/settings.local.json; fi); done; python3 -c 'import json,os,sys; p=os.path.expanduser(\"~/.claude.json\"); c=json.load(open(p)) if os.path.exists(p) else {}; c.setdefault(\"projects\",{}).setdefault(sys.argv[1],{})[\"hasTrustDialogAccepted\"]=True; json.dump(c,open(p,\"w\"),indent=2)' $WT" \
      && ok "env ready for Claude (folder trusted, the committed settings.local.json hidden in this env)"
    # A long prompt takes a while to type in, and Orca may answer "could not confirm the launch outcome" although
    # the agent started. So the proof is a live terminal in the env, not the launch reply.
    "$ORCA" agent launch --environment "$ORCA_ENV" --agent claude --surface terminal --focus \
      --worktree "path:$WT" --prompt "$(prompt)" --json >/dev/null 2>&1 || true
    n=0; until "$ORCA" terminal list --environment "$ORCA_ENV" --worktree "path:$WT" 2>/dev/null | grep -q "^term_"; do
      n=$((n + 1)); [ $n -gt 20 ] && die "no Claude terminal in '$NAME' after 60 s; open the env in Orca and run claude there"; sleep 3
    done
    ok "Claude is working in '$NAME'. Watch it in Orca (server $ORCA_ENV). Next: task.sh status $NAME"
    ;;

  status)
    "$SELF_DIR/handoff.sh" status "$HOST" "$BRANCH" | tail -2
    ROOT="$(box_root)"; WT="$ROOT/benches/$NAME/apps/nirmaan_stack"
    box "test -d $WT" || die "no env $NAME on the box"
    echo; box "cd $WT && git log --oneline -5 && echo && python3 scripts/devenv/dod.py check" || true
    echo; echo "report: $HOST:~/$DIR/REPORT.md"
    ;;

  done)
    "$SELF_DIR/handoff.sh" from "$HOST" "$BRANCH"
    echo; box "cat ~/$DIR/REPORT.md 2>/dev/null" || echo "(no report on the box)"
    echo; echo "Review: git log --stat master..$BRANCH ; git diff master...$BRANCH"
    echo "Then merge and push yourself. Afterwards: task.sh clean $NAME"
    ;;

  clean)
    V="$("$SELF_DIR/handoff.sh" status "$HOST" "$BRANCH" | sed -n 's/^verdict: //p')"
    case "$V" in
      IN_SYNC|LAPTOP_AHEAD|ONLY_LAPTOP|NOWHERE) ;;
      *) die "$V: the box has commits on $BRANCH the laptop lacks. Run task.sh done $NAME first." ;;
    esac
    ROOT="$(box_root)"; WT="$ROOT/benches/$NAME/apps/nirmaan_stack"
    # Close the task's Orca terminals first: a finished agent would otherwise keep running in a deleted folder.
    if [ -x "$ORCA" ]; then
      for t in $("$ORCA" terminal list --environment "$ORCA_ENV" --worktree "path:$WT" 2>/dev/null | grep -oE '^term_[a-z0-9-]+'); do
        "$ORCA" terminal close --environment "$ORCA_ENV" --terminal "$t" >/dev/null 2>&1 && echo "closed Orca terminal $t"
      done
    fi
    box "cd ~/$BOX_CO && { [ ! -d $WT ] || { scripts/devenv/devenv.sh stop $NAME >/dev/null 2>&1; scripts/devenv/devenv.sh destroy $NAME | tail -1; }; } && { git branch -D $BRANCH 2>/dev/null && echo 'deleted the box branch $BRANCH' || true; }"
    ok "cleaned $NAME on the box. The report stays at $HOST:~/$DIR/ ; the laptop branch $BRANCH is yours to keep or delete."
    ;;
esac
exit
}
