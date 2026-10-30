#!/usr/bin/env bash
# Hand a branch between the laptop and a dev box (a VM built with bootstrap.sh). Run on the laptop, from any checkout
# of the repo. Commits travel as git bundles over SSH; nothing here talks to GitHub, and nothing is a push.
#
#   handoff.sh status <host> <branch>   where the branch stands on both sides (read-only)
#   handoff.sh to <host> <branch>       give the box the laptop's commits on <branch>
#   handoff.sh from <host> <branch>     bring the box's commits on <branch> back to the laptop
#
# <host> is an SSH target, e.g. dev@contabo. The box's checkout is $DEVBOX_CHECKOUT (default, under the box user's
# home: work/nirmaan/deploy_setup/frappe_docker/development/nirmaan_stack_variants/master).
#
# Rules (the same as env_sync.sh's laptop/desktop loop):
# - Fast-forward only. A side whose branch has commits the other lacks is never overwritten: status says DIVERGED,
#   and to/from stop and ask the owner to decide. Nothing auto-merges.
# - One owner per branch at a time: hand it over, let that side work, hand it back.
# - A worktree that has the branch checked out moves with it, but only when it has no uncommitted changes to tracked
#   files; otherwise the transfer is refused and both sides stay as they were.
# - On the box, an agent works on a handed-over branch with: scripts/devenv/devenv.sh create <task> --on <branch>
#
# The script runs itself on the box (piped over SSH), so the box needs no copy of it.
# The whole body sits in { ... } so bash parses it before running: editing this file mid-run is safe.
{
set -euo pipefail

die() { echo "STOP  $*" >&2; exit 1; }
ok() { echo "ok    $*"; }

# Move refs/heads/$1 to commit $2 (its old value $3, or empty for a new branch), fast-forward only. A worktree that
# has the branch checked out is moved with it, if it is clean. Same on both sides.
ff_branch() {
  local br="$1" new="$2" old="$3" wt
  if [ -n "$old" ]; then git merge-base --is-ancestor "$old" "$new" || die "not a fast-forward: $br has commits the other side lacks"; fi
  wt="$(git worktree list --porcelain | awk -v ref="refs/heads/$br" '/^worktree /{p=substr($0,10)} $0=="branch "ref{print p}')"
  if [ -n "$wt" ]; then
    [ -z "$(git -C "$wt" status --porcelain --untracked-files=no)" ] \
      || die "$br is checked out at $wt with uncommitted changes; commit or set them aside first"
    git -C "$wt" merge -q --ff-only "$new"
  else
    git update-ref "refs/heads/$br" "$new" ${old:+"$old"}
  fi
}

# ---------------------------------------------------------------- on the box (piped in by the laptop)
if [ "${1:-}" = _box ]; then
  shift; cd "$HOME/$1" 2>/dev/null || cd "$1" || die "no checkout at $1 on the box"; shift
  case "$1" in
    sha) git rev-parse -q --verify "refs/heads/$2^{commit}" || true ;;
    has) git cat-file -e "$2^{commit}" 2>/dev/null && echo yes || echo no ;;
    ancestor) git merge-base --is-ancestor "$2" "$3" 2>/dev/null && echo yes || echo no ;;
    known) git for-each-ref --format='%(objectname)' refs/heads refs/remotes refs/tags | sort -u ;;
    dirty)    # the worktree holding branch $2, if it has uncommitted changes to tracked files
      wt="$(git worktree list --porcelain | awk -v ref="refs/heads/$2" '/^worktree /{p=substr($0,10)} $0=="branch "ref{print p}')"
      [ -n "$wt" ] && [ -n "$(git -C "$wt" status --porcelain --untracked-files=no)" ] && echo "$wt" || true ;;
    receive)  # $2 branch, $3 bundle file in the box user's home or "-" (the box has the commit), $4 commit, $5 old box commit or ""
      if [ "$3" != - ]; then
        f="$HOME/$3"
        git bundle verify -q "$f" >/dev/null 2>&1 || { rm -f "$f"; die "the bundle does not verify on the box"; }
        git fetch -q "$f" "refs/heads/$2:refs/handoff/$2" --force; rm -f "$f"
      fi
      [ "$(git rev-parse -q --verify "refs/heads/$2" || true)" = "${5:-}" ] || die "$2 moved on the box since the check; run status again"
      ff_branch "$2" "$4" "${5:-}"; git update-ref -d "refs/handoff/$2" 2>/dev/null || true
      echo "box $2 now at $(git rev-parse --short "refs/heads/$2")" ;;
    send)     # $2 branch, $3 output file in the box user's home, then the commits the laptop has: bundle what it lacks, or print "none"
      br="$2" out="$HOME/$3"; shift 3
      basis=(); for c in "$@"; do git cat-file -e "$c^{commit}" 2>/dev/null && basis+=("^$c"); done
      if git bundle create -q "$out" "refs/heads/$br" ${basis[@]+"${basis[@]}"} 2>/dev/null; then echo "$out"; else echo none; fi ;;
    *) die "unknown box command $1" ;;
  esac
  exit 0
fi

# ---------------------------------------------------------------- on the laptop
SELF="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"
cd "$(dirname "$SELF")"; cd "$(git rev-parse --show-toplevel)"
BOX_CO="${DEVBOX_CHECKOUT:-work/nirmaan/deploy_setup/frappe_docker/development/nirmaan_stack_variants/master}"
CMD="${1:-}"; HOST="${2:-}"; BR="${3:-}"
case "$CMD" in status|to|from) ;; *) sed -n '2,20p' "$SELF"; exit 1 ;; esac
[ -n "$HOST" ] && [ -n "$BR" ] || die "usage: handoff.sh $CMD <host> <branch>"
git check-ref-format --branch "$BR" >/dev/null || die "not a branch name: $BR"
box() { ssh -o BatchMode=yes "$HOST" bash -s -- _box "$BOX_CO" "$@" < "$SELF"; }
here_has() { git cat-file -e "$1^{commit}" 2>/dev/null; }
FILE="handoff-$(echo "$BR" | tr '/' '_')-$$.bundle"

L="$(git rev-parse -q --verify "refs/heads/$BR" || true)"
R="$(box sha "$BR")"

# IN_SYNC | ONLY_LAPTOP | ONLY_BOX | LAPTOP_AHEAD | BOX_AHEAD | DIVERGED
verdict() {
  if [ -z "$L" ] && [ -z "$R" ]; then echo NOWHERE
  elif [ "$L" = "$R" ]; then echo IN_SYNC
  elif [ -z "$R" ]; then echo ONLY_LAPTOP
  elif [ -z "$L" ]; then echo ONLY_BOX
  elif here_has "$R" && git merge-base --is-ancestor "$R" "$L"; then echo LAPTOP_AHEAD
  elif [ "$(box ancestor "$L" "$R")" = yes ]; then echo BOX_AHEAD
  else echo DIVERGED; fi
}
V="$(verdict)"

case "$CMD" in
  status)
    echo "laptop $BR: ${L:-(none)}"; echo "box    $BR: ${R:-(none)}   ($HOST)"
    echo "verdict: $V"
    case "$V" in
      LAPTOP_AHEAD|ONLY_LAPTOP) echo "next: handoff.sh to $HOST $BR" ;;
      BOX_AHEAD|ONLY_BOX) echo "next: handoff.sh from $HOST $BR" ;;
      DIVERGED) echo "next: STOP. Both sides have commits the other lacks; the owner decides (nothing auto-merges)." ;;
    esac ;;
  to)
    case "$V" in
      IN_SYNC) ok "box already has $BR at ${L:0:9}"; exit 0 ;;
      LAPTOP_AHEAD|ONLY_LAPTOP) ;;
      NOWHERE) die "no branch $BR on the laptop" ;;
      DIVERGED) die "DIVERGED: each side has commits on $BR the other lacks. The owner decides; nothing auto-merges." ;;
      *) die "$V: the box has commits on $BR the laptop lacks. Run 'handoff.sh from $HOST $BR' first." ;;
    esac
    if [ "$(box has "$L")" = yes ]; then box receive "$BR" - "$L" "$R"
    else
      tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
      basis=(); while read -r c; do here_has "$c" && basis+=("^$c"); done < <(box known)
      git bundle create -q "$tmp/$FILE" "refs/heads/$BR" ${basis[@]+"${basis[@]}"} || die "could not bundle $BR"
      scp -q -o BatchMode=yes "$tmp/$FILE" "$HOST:$FILE"
      box receive "$BR" "$FILE" "$L" "$R"
    fi
    ok "handed $BR to $HOST: box at ${L:0:9} (was $([ -n "$R" ] && echo "${R:0:9}" || echo none)). Work there with: devenv.sh create <task> --on $BR" ;;
  from)
    case "$V" in
      IN_SYNC) ok "laptop already has $BR at ${L:0:9}"; exit 0 ;;
      BOX_AHEAD|ONLY_BOX) ;;
      NOWHERE) die "no branch $BR on the box" ;;
      DIVERGED) die "DIVERGED: each side has commits on $BR the other lacks. The owner decides; nothing auto-merges." ;;
      *) die "$V: the laptop has commits on $BR the box lacks. Run 'handoff.sh to $HOST $BR' first." ;;
    esac
    d="$(box dirty "$BR")"; [ -z "$d" ] || die "the box has uncommitted changes in $d; they would stay behind. Commit them there first."
    if ! here_has "$R"; then
      tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
      got="$(box send "$BR" "$FILE" $(git for-each-ref --format='%(objectname)' refs/heads refs/remotes refs/tags | sort -u))"
      [ "$got" != none ] || die "the box could not bundle $BR"
      scp -q -o BatchMode=yes "$HOST:$FILE" "$tmp/$FILE"; ssh -o BatchMode=yes "$HOST" rm -f "$FILE"
      git bundle verify -q "$tmp/$FILE" >/dev/null 2>&1 || die "the bundle from the box does not verify"
      git fetch -q "$tmp/$FILE" "refs/heads/$BR:refs/handoff/$BR" --force
    fi
    ff_branch "$BR" "$R" "$L"; git update-ref -d "refs/handoff/$BR" 2>/dev/null || true
    ok "brought $BR back: laptop at ${R:0:9} (was $([ -n "$L" ] && echo "${L:0:9}" || echo none))" ;;
esac
exit
}
