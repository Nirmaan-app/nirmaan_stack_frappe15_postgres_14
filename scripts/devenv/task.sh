#!/usr/bin/env bash
# One command per stage of an agent task on a dev box. Run on the laptop, from any checkout of the repo.
#
#   task.sh start <name> [--box <box>] [--brief <file>] [--from <ref>] [--no-agent]
#       branch box/<name> off the start point -> hand it to the box -> copy the brief to the box (private, outside
#       the repo) -> make the env (devenv.sh create <name> --on box/<name>) -> turn the Definition of Done on -> start
#       Claude in that env, visible in Orca, and wait up to DEVBOX_REPLY_WAIT seconds (180) for its first reply in its
#       session log; an error Claude Code wrote itself ("Not logged in") stops at once, with what to do.
#       --no-agent stops before Claude.
#       The start point is <ref>, else the HEAD of the checkout you run task.sh from (only commits travel: start WARNs
#       when that checkout has uncommitted changes); on a rerun, the box/<name> already made. It must hold GitHub's
#       develop as it is now (scripts/devenv/develop.sh: how develop is found, and the rule). Equal or ahead starts;
#       behind or diverged STOPs before anything changes, saying what to do. The box reads develop itself when the
#       branch arrives and refuses it by the same rule, before any env; start then takes back the branch and record
#       it made, so a rerun begins from the updated start point.
#       Write the brief from scripts/devenv/BRIEF_TEMPLATE.md, keeping the filled copy outside the repo.
#   task.sh status <name>    who has the branch, what the Definition of Done still lacks, where the report is
#   task.sh done <name>      bring the agent's commits back to the laptop and print its report, kept at
#                            ${XDG_STATE_HOME:-~/.local/state}/devbox/reports/<name>.md (review, merge and
#                            push stay with you)
#   task.sh clean <name>     after you merged: remove the env and the branch on the box (refused while the box has
#                            commits the laptop lacks, unless a laptop ref already holds the box tip: landed.sh).
#                            When the env is already gone, it removes the benches/<name> folder left behind if that is
#                            empty (rmdir), and stops, keeping the record, while that folder still holds files.
#   task.sh prune [--yes]    each recorded task, one line: PRUNE when a laptop ref holds its box tip (landed.sh:
#                            master, upstream/ or origin/ develop and main) and nothing holds it, else KEEP with the
#                            holds: unreachable, working or stalled (its agent, as watch counts it), tracked-changes, untracked,
#                            status-failed (git status failed; these three in its env on the box), unfetched (the
#                            laptop lacks the box tip: task.sh done first), off-branch (the env's HEAD is off
#                            box/<name> and no laptop ref holds it).
#                            One SSH pair per box, read only. --yes runs task.sh clean on each PRUNE task, and prints
#                            "FAIL  clean <name>" for each clean that stopped.
#   task.sh list             every task branch on the laptop and the box it is on (no SSH)
#   task.sh pick             the box the next start without --box would get, and why (one SSH per box, read only)
#   task.sh watch [--clean] [--every <seconds>] | --install | --uninstall
#                            each recorded task's agent: working, stalled (alive, not finished, and nothing written to
#                            its session log for DEVBOX_STALL_SECONDS, 1200), finished (its report's Status is DONE or
#                            BLOCKED), crashed (no agent in its env and no finished report) or unreachable (the box
#                            did not answer). One SSH per box, read only. A change prints ALERT and raises a macOS
#                            notification;
#                            the last state per task is kept in ${XDG_STATE_HOME:-~/.local/state}/devbox/watch/<name>.
#                            It also WARNs while a box checkout's core.hooksPath is not .githooks (its worktrees
#                            would run another checkout's hooks), and alerts when that path changes; and WARNs while
#                            a task's base (the commit start cut box/<name> from) is no longer in the ref it came
#                            from (someone reset or rebased it; rebase box/<name> onto it before merging), alerting
#                            when that changes. done prints the same WARN.
#                            Plain watch changes nothing on the boxes. --clean then does what task.sh prune --yes does:
#                            it cleans each PRUNE task (on 2026-11-24 air held 14 merged tasks, 3.9 GB of idle chats
#                            and about 36 GiB of disk, because nothing ran prune). A clean that fails alerts, naming the
#                            task (its output is in the pass), and WARNs on each later pass while it still fails. A box
#                            that did not answer is left alone: the watch rows above already show it unreachable.
#                            --every repeats until Ctrl-C. --install (macOS) runs watch --clean every 300 s as the
#                            launchd user agent app.nirmaan.task-watch, from this task.sh (so from the checkout whose
#                            records you want watched), its last pass in ${XDG_STATE_HOME:-~/.local/state}/devbox/watch.log;
#                            a chat then needs no watch loop of its own (one died with its chat on #1698). A rerun
#                            replaces the job. --uninstall boots it out and keeps its plist as .off.
#
# <name>: lowercase letters, digits and dashes (it names the env, its site t-<name>.localhost and its DB).
# <box>: a box in the registry (scripts/devenv/boxes.sh). Without --box, start picks one: with devbox.order in the
# registry, the first box in that order whose working or stalled agents (as watch counts them) are fewer than its
# box.<name>.agents (1 when unset), passing over a box that does not answer; without devbox.order, devbox.default.
# start records the box in the repo's git config (devbox-task.<name>.box), with the ref and commit it cut the branch
# from (.from, .base), and every later command goes to that box. clean removes the record.
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
HERE_CO="$(git rev-parse --show-toplevel 2>/dev/null || true)"
cd "$(git -C "$SELF_DIR" rev-parse --show-toplevel)"
# The checkout whose HEAD start takes: the one task.sh runs from, when it is a checkout of this repo; else its own.
[ -n "$HERE_CO" ] && [ "$(git -C "$HERE_CO" rev-parse --path-format=absolute --git-common-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ] \
  || HERE_CO="$PWD"
. "$SELF_DIR/boxes.sh"
. "$SELF_DIR/landed.sh"
. "$SELF_DIR/develop.sh"

# The one rule for a task's state: task_state <alive> <report word> <dod> <idle>. alive: 1 or 0 for a claude process
# whose folder is the task's env, - when the box did not answer. A finished Claude session stays alive waiting for
# input, so alive alone never means working. dod: 1 or 0 for `dod.py check` in the env, - when the env has no dod.py.
# A report says DONE before its last test run ends ("DONE (draft, ...)", #1611), so DONE counts only with the check.
# idle: seconds since the agent last wrote to its session log, - when it has none. An alive, unfinished agent quiet
# for DEVBOX_STALL_SECONDS (1200) is stalled: on #1698 one sat an hour at "Not logged in" while alive said working.
task_state() {
  local stale=0
  [ "${4:--}" = - ] || [ "$4" -lt "${DEVBOX_STALL_SECONDS:-1200}" ] || stale=1
  case "$1:$2:$3:$stale" in
    -:*) echo unreachable ;;
    ?:DONE:1:*|?:BLOCKED:1:*|?:DONE:-:*|?:BLOCKED:-:*) echo finished ;;
    1:*:1) echo stalled ;;
    1:*) echo working ;;
    *) echo crashed ;;
  esac
}

# base_check <name>: BASED=ok while the commit the task was cut from (devbox-task.<name>.base) is still in the ref it
# was cut from (.from), rewound when it is not, - when the task has no base record (started before 2026-11-22) or the
# ref is gone. Also sets T_FROM and T_BASE. Laptop git only. #1698 was cut from master at 032fab717; another chat
# then reset master to fd2c67255, and the merge found out only by reflog.
base_check() {
  T_FROM="$(git config "devbox-task.$1.from" || true)"; T_BASE="$(git config "devbox-task.$1.base" || true)"; BASED=-
  [ -n "$T_FROM" ] && [ -n "$T_BASE" ] && git rev-parse -q --verify "$T_FROM^{commit}" >/dev/null || return 0
  git merge-base --is-ancestor "$T_BASE" "$T_FROM" && BASED=ok || BASED=rewound
}

# base_warn <name>: the WARN line for a rewound base; prints nothing otherwise.
base_warn() {
  base_check "$1"; [ "$BASED" = rewound ] || return 0
  echo "WARN  $1: its base ${T_BASE:0:9} is no longer in $T_FROM (reset or rebased): rebase box/$1 onto $T_FROM before merging"
}

# Runs on a box under bash -s (bash 3.2 on macOS), args <checkout> <task>...: per task "<name>\t<alive>\t<dod>\t<idle>
# \t<the first paragraph under ## Status in its report, joined: reports wrap it>". Paths are compared physical (pwd
# -P), as /proc and lsof report them, and exactly: the macOS box also runs spare claude daemons in other folders.
# idle: seconds since the newest file anywhere under the env's session logs, ~/.claude/projects/<the env worktree's
# path with every non-alphanumeric character as ->/ (subagent logs sit in <session>/subagents/ below it), - with none.
watch_probe() {
  cat <<'EOF'
co="$1"; shift
root="$(cd ~/"$co"/../.. && pwd -P)" || exit 4
case "$(uname)" in
  Linux) cwds="$(for p in $(pgrep '^claude'); do readlink "/proc/$p/cwd"; done 2>/dev/null)" ;;
  *) cwds="$(lsof -a -c claude -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" ;;
esac
idles="$(python3 - "$root" "$@" <<'PY'
import os, re, sys, time
root, now = sys.argv[1], time.time()
for n in sys.argv[2:]:
    wt = os.path.join(root, "benches", n, "apps", "nirmaan_stack")
    d = os.path.join(os.path.expanduser("~/.claude/projects"), re.sub(r"[^A-Za-z0-9]", "-", wt))
    newest = 0
    for folder, dirs, files in os.walk(d):
        for f in files:
            try:
                newest = max(newest, os.path.getmtime(os.path.join(folder, f)))
            except OSError:
                pass
    print("%s\t%s" % (n, int(now - newest) if newest else "-"))
PY
)"
for n in "$@"; do
  wt="$root/benches/$n/apps/nirmaan_stack"
  alive=0; printf '%s\n' "$cwds" | grep -qxF "$wt" && alive=1
  dod=-; [ ! -f "$wt/scripts/devenv/dod.py" ] || { dod=0; (cd "$wt" && python3 scripts/devenv/dod.py check) >/dev/null 2>&1 && dod=1; }
  idle="$(printf '%s\n' "$idles" | awk -F'\t' -v n="$n" '$1 == n {print $2; exit}')"
  line="$(awk 'f && /^#/ {exit} f && NF {gsub(/\t/, " "); p = p (p == "" ? "" : " ") $0; next} f && p != "" {exit}
    /^## Status/ {f=1} END {print p}' ~/claude-artifacts/dod/box-"$n"/REPORT.md 2>/dev/null)"
  printf '%s\t%s\t%s\t%s\t%s\n' "$n" "$alive" "$dod" "${idle:--}" "$line"
done
# One more row, "@hooks\t<core.hooksPath>", from the box checkout's shared git config. Anything but the relative
# .githooks makes every worktree there run another checkout's hooks (on air an absolute dev/.githooks came back
# after it was fixed, 2026-11-19, and the #1705 agent's commits skipped its own new check).
if git -C ~/"$co" rev-parse --git-dir >/dev/null 2>&1; then
  printf '@hooks\t%s\n' "$(git -C ~/"$co" config --get core.hooksPath || echo unset)"
fi
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

# Runs under python3 - <env worktree> <epoch seconds> on a box: the agent's first reply since that time, from the
# session logs Claude Code keeps under ~/.claude/projects/<the worktree's real path, every non-alphanumeric character
# as ->/*.jsonl. Prints real (an assistant entry from a model), "synthetic<tab><its text>" (an assistant entry whose
# model is <synthetic>: an error Claude Code wrote itself, such as "Not logged in · Please run /login", after which
# the prompt is dropped), or none. A real reply wins over a synthetic one.
reply_probe() {
  cat <<'EOF'
import json, os, re, sys
wt, since = sys.argv[1], int(sys.argv[2])
d = os.path.join(os.path.expanduser("~/.claude/projects"), re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(wt)))
try:
    names = sorted(os.listdir(d))
except OSError:
    names = []
verdict, text = "none", ""
for name in names:
    p = os.path.join(d, name)
    if not name.endswith(".jsonl") or os.path.getmtime(p) < since:
        continue
    with open(p, errors="replace") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("type") != "assistant":
                continue
            m = e.get("message") or {}
            if m.get("model") != "<synthetic>":
                verdict = "real"
                break
            if verdict == "none":
                verdict = "synthetic"
                text = " ".join(c.get("text", "") for c in m.get("content") or [] if isinstance(c, dict))
    if verdict == "real":
        break
print(verdict + ("\t" + " ".join(text.split()) if verdict == "synthetic" else ""))
EOF
}

WATCH_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/devbox/watch"

watch_pass() {
  local recs box names n out rc note row alive dod idle line word state detail old alerts="" f hooks
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
      alive=- dod=- idle=- line=""
      [ -z "$row" ] || IFS=$'\t' read -r _ alive dod idle line <<<"$row"
      word="$(printf '%s\n' "$line" | awk '{print toupper($1)}' | tr -cd 'A-Z0-9_')"
      state="$(task_state "$alive" "$word" "$dod" "$idle")"
      case "$state" in
        finished) detail="$(printf '%s\n' "$line" | sed 's/\([.!?]\)[[:space:]].*/\1/')" ;;
        stalled) detail="quiet for $((idle / 60)) min" ;;
        unreachable) detail="${note:-no answer for this task}" ;;
        *) detail="" ;;
      esac
      printf '%-28s %-10s %-11s %s\n' "$n" "$box" "$state" "$detail"
      old="$(cat "$WATCH_DIR/$n" 2>/dev/null || echo unseen)"
      # A first sight alerts only when something is wrong; a working or finished task is just shown.
      if [ "$old" != "$state" ] && { [ "$old" != unseen ] || [ "$state" = crashed ] || [ "$state" = unreachable ] || [ "$state" = stalled ]; }; then
        alerts="$alerts$n on $box: $old -> $state"$'\n'
      fi
      echo "$state" > "$WATCH_DIR/$n.new" && mv "$WATCH_DIR/$n.new" "$WATCH_DIR/$n"
      base_warn "$n"
      if [ "$BASED" != - ]; then
        old="$(cat "$WATCH_DIR/.base-$n" 2>/dev/null || echo ok)"
        [ "$old" = "$BASED" ] || case "$BASED" in
          rewound) alerts="$alerts$n: base ${T_BASE:0:9} left $T_FROM"$'\n' ;;
          *) alerts="$alerts$n: base ${T_BASE:0:9} is back in $T_FROM"$'\n' ;;
        esac
        echo "$BASED" > "$WATCH_DIR/.base-$n.new" && mv "$WATCH_DIR/.base-$n.new" "$WATCH_DIR/.base-$n"
      fi
    done
    hooks="$(printf '%s\n' "$out" | awk -F'\t' '$1 == "@hooks" {print $2; exit}')"
    if [ -n "$hooks" ]; then
      [ "$hooks" = .githooks ] || echo "WARN  $box: core.hooksPath is $hooks, not .githooks: its worktrees run those hooks, not their own"
      old="$(cat "$WATCH_DIR/.hooks-$box" 2>/dev/null || echo .githooks)"
      [ "$old" = "$hooks" ] || alerts="$alerts$box: core.hooksPath $old -> $hooks"$'\n'
      echo "$hooks" > "$WATCH_DIR/.hooks-$box.new" && mv "$WATCH_DIR/.hooks-$box.new" "$WATCH_DIR/.hooks-$box"
    fi
  done
  notify "$alerts"
  for f in "$WATCH_DIR"/*; do
    [ -e "$f" ] || continue
    n="${f##*/}"
    printf '%s\n' "$recs" | awk -v n="$n" '$1 == n {f=1} END {exit !f}' && continue
    rm -f "$f" "$WATCH_DIR/.base-$n" "$WATCH_DIR/.clean-$n"; echo "gone  $n: no task record, its watch state removed"
  done
}

# notify <alerts, one per line>: an ALERT line and a macOS notification for each.
notify() {
  printf '%s' "$1" | while IFS= read -r a; do
    echo "ALERT $a"
    if command -v osascript >/dev/null; then
      osascript -e "display notification \"$a\" with title \"task.sh watch\"" >/dev/null 2>&1 || true
    fi
  done
}

# watch_clean: watch --clean's step after the pass. prune_tasks decides and cleans; it runs in a command substitution
# because it exits 3 when a box did not answer, which would end a --every loop. Each failing clean alerts once and
# WARNs on later passes, the way a wrong hooksPath does: the launchd job retries it every 300 s.
watch_clean() {
  local out rc=0 failed n f msg alerts=""
  out="$(prune_tasks 1 2>&1)" || rc=$?
  printf '%s\n' "$out"
  failed="$(printf '%s\n' "$out" | sed -n 's/^FAIL  clean \([a-z0-9-]*\) .*/\1/p')"
  # 1 with no FAIL line, or any code but 0, 1 and 3: prune itself stopped, so nothing past that point was cleaned.
  [ -n "$failed" ] || [ "$rc" = 0 ] || [ "$rc" = 3 ] || failed="@prune"
  for f in "$WATCH_DIR"/.clean-*; do
    [ -e "$f" ] || continue
    printf '%s\n' "$failed" | grep -qxF "${f##*/.clean-}" || rm -f "$f"
  done
  for n in $failed; do
    if [ "$n" = @prune ]; then msg="task.sh prune stopped (exit $rc), so the tasks after that point were not cleaned"
    else msg="$n on $(git config "devbox-task.$n.box" || echo '?'): task.sh clean failed, its record kept"; fi
    if [ -e "$WATCH_DIR/.clean-$n" ]; then echo "WARN  $msg, again (output above)"
    else
      alerts="$alerts$msg (output: above, or $WATCH_LOG for the launchd job)"$'\n'
      : > "$WATCH_DIR/.clean-$n"
    fi
  done
  notify "$alerts"
}

# The watch as a launchd user agent (macOS): a pass every 300 s, so no chat has to keep a loop alive. On #1698 the
# chat's background `watch --every 300` died with the chat when the laptop ran low on memory, and no alert came.
WATCH_LABEL="app.nirmaan.task-watch"
WATCH_PLIST="$HOME/Library/LaunchAgents/$WATCH_LABEL.plist"
WATCH_LOG="${XDG_STATE_HOME:-$HOME/.local/state}/devbox/watch.log"

watch_launchd_only() { [ "$(uname)" = Darwin ] || die "task.sh watch --install and --uninstall are macOS only (launchd). Elsewhere, run task.sh watch --every 300 under a service of your own."; }
xml() { sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }

# Written whole each time and bootstrapped after a bootout, so a rerun converges on the same job. The job's PATH is
# fixed here: launchd gives it none of the shell's, and it needs ssh, git, python3 and orca.
watch_install() {
  local path orca_dir uid
  watch_launchd_only
  path="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  orca_dir="$(dirname "$(command -v orca || echo /nowhere/orca)")"
  [ "$orca_dir" = /nowhere ] || case ":$path:" in *":$orca_dir:"*) ;; *) path="$orca_dir:$path" ;; esac
  uid="$(id -u)"
  mkdir -p "$(dirname "$WATCH_PLIST")" "$(dirname "$WATCH_LOG")"
  {
    cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$WATCH_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>$(printf '"%s" watch --clean > "%s" 2>&1' "$SELF_DIR/task.sh" "$WATCH_LOG" | xml)</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(printf '%s' "$path" | xml)</string>
EOF
    [ -z "${XDG_STATE_HOME:-}" ] || printf '    <key>XDG_STATE_HOME</key>\n    <string>%s</string>\n' "$(printf '%s' "$XDG_STATE_HOME" | xml)"
    cat <<EOF
  </dict>
</dict>
</plist>
EOF
  } > "$WATCH_PLIST.new"
  mv "$WATCH_PLIST.new" "$WATCH_PLIST"
  launchctl bootout "gui/$uid/$WATCH_LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$uid" "$WATCH_PLIST"
  ok "installed $WATCH_PLIST: task.sh watch --clean every 300 s, its last pass in $WATCH_LOG (launchctl print gui/$uid/$WATCH_LABEL shows the job)"
}

watch_uninstall() {
  watch_launchd_only
  launchctl bootout "gui/$(id -u)/$WATCH_LABEL" >/dev/null 2>&1 || true
  if [ -f "$WATCH_PLIST" ]; then mv "$WATCH_PLIST" "$WATCH_PLIST.off"; ok "removed the job; its plist is kept at $WATCH_PLIST.off"
  else echo "nothing installed at $WATCH_PLIST"; fi
}

# box_pick: set PICK and PICK_WHY for a start without --box (the rule is in the header, under <box>).
box_pick() {
  local order b names n out rc busy cap alive dod idle line word
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
    while IFS=$'\t' read -r n alive dod idle line; do
      case "$n" in @*) continue ;; esac
      [ -n "$alive" ] || continue
      word="$(printf '%s\n' "$line" | awk '{print toupper($1)}' | tr -cd 'A-Z0-9_')"
      case "$(task_state "$alive" "$word" "$dod" "$idle")" in working|stalled) busy=$((busy + 1)) ;; esac
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
# A stalled agent still occupies the box and its work, so it holds under its own name.
task_hold_working() { case "$T_STATE" in working|stalled) echo "$T_STATE" ;; esac; }
task_hold_tracked_changes() { [ "$T_TRACKED" = 0 ] || echo "tracked-changes:$T_TRACKED"; }
task_hold_untracked() { [ "$T_UNTRACKED" = 0 ] || echo "untracked:$T_UNTRACKED"; }
task_hold_status_failed() { [ "$T_STATUS_RC" = 0 ] || echo status-failed; }
task_hold_unfetched() {
  [ -z "$T_NOTE" ] && [ "$T_TIP" != - ] && ! git cat-file -e "$T_TIP^{commit}" 2>/dev/null && echo unfetched || true
}
# The env worktree's HEAD away from box/<name> (a side branch, a detached commit): clean's destroy removes the worktree
# and its HEAD reflog, so commits only that HEAD reaches would be lost unless a laptop ref already holds them.
task_hold_off_branch() {
  [ -z "$T_NOTE" ] && [ "$T_HEAD" != - ] && [ "$T_HEAD" != "$T_TIP" ] && ! landed "$T_HEAD" >/dev/null \
    && echo "off-branch:${T_HEAD:0:9}" || true
}

# prune_tasks <yes>: one row per recorded task (see the header). Exit 3 when a box did not answer.
prune_tasks() {
  local yes="$1" recs box names n out wout rc row alive dod idle line word h d where rows="" keep="" todo="" down=0 failed=0
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
      T_WT="" T_TIP=- T_TRACKED=0 T_UNTRACKED=0 T_STATUS_RC=0 T_HEAD=- alive=- dod=- idle=- line=""
      row="$(printf '%s\n' "$out" | awk -F'\t' -v n="$n" '$1 == n {print; exit}')"
      [ -z "$row" ] || IFS=$'\t' read -r _ T_WT T_TIP T_TRACKED T_UNTRACKED T_STATUS_RC T_HEAD <<<"$row"
      row="$(printf '%s\n' "$wout" | awk -F'\t' -v n="$n" '$1 == n {print; exit}')"
      [ -z "$row" ] || IFS=$'\t' read -r _ alive dod idle line <<<"$row"
      word="$(printf '%s\n' "$line" | awk '{print toupper($1)}' | tr -cd 'A-Z0-9_')"
      T_STATE="$(task_state "$alive" "$word" "$dod" "$idle")"
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
    for n in $todo; do
      echo; echo "== clean $n"
      bash "$SELF_DIR/task.sh" clean "$n" </dev/null || { failed=1; echo "FAIL  clean $n stopped (above); its record stays"; }
    done
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
    case "$#:${2:-}" in 2:--install) watch_install; exit 0 ;; 2:--uninstall) watch_uninstall; exit 0 ;; esac
    shift; CLEAN=0 EVERY=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --clean) [ "$CLEAN" = 0 ] || break; CLEAN=1; shift ;;
        --every) [ -z "$EVERY" ] && [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || break; EVERY="$2"; shift 2 ;;
        *) break ;;
      esac
    done
    [ $# = 0 ] || die "usage: task.sh watch [--clean] [--every <seconds>] | --install | --uninstall"
    while :; do watch_pass; [ "$CLEAN" = 0 ] || watch_clean; [ -n "$EVERY" ] || break; sleep "$EVERY"; done
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
  *) sed -n '2,64p' "$0"; exit 1 ;;
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

BRIEF=""; FROM=""; AGENT=1; FLAG_BOX=""
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
    if START="$(git rev-parse -q --verify "refs/heads/$BRANCH")"; then
      START_IS="the existing $BRANCH (an earlier start made it; another name starts afresh)"
      [ -z "$FROM" ] || [ "$(git -C "$HERE_CO" rev-parse -q --verify "$FROM^{commit}" || true)" = "$START" ] \
        || die "$BRANCH already exists at ${START:0:9}, not at --from $FROM: start under another name"
    else
      START="$(git -C "$HERE_CO" rev-parse -q --verify "${FROM:-HEAD}^{commit}")" || die "no commit '${FROM:-HEAD}' in $HERE_CO"
      if [ -n "$FROM" ]; then START_IS="--from $FROM"; else START_IS="HEAD of $HERE_CO"; fi
      if [ "$START" = "$(git -C "$HERE_CO" rev-parse -q --verify HEAD || true)" ] && [ -n "$(git -C "$HERE_CO" status --porcelain)" ]; then
        echo "WARN  $HERE_CO has uncommitted changes: only commits go to the box, so the agent will not see them"
      fi
    fi
    DEVELOP="$(develop_tip)"
    if V="$(start_point_verdict "$(start_vs_develop "$START" "$DEVELOP")" "$START" "$DEVELOP")"; then ok "start point, $START_IS: $V"
    else die "start point, $START_IS: $V"; fi
    box_reach

    step "1. branch $BRANCH"
    MADE=0
    if git rev-parse -q --verify "refs/heads/$BRANCH" >/dev/null; then ok "$BRANCH exists (at ${START:0:9})"
    else
      git branch "$BRANCH" "$START"; MADE=1; ok "made $BRANCH from $START_IS (${START:0:9})"
      # watch and done compare them with the ref later: a reset of the ref under the task is found before the merge.
      # Without --from the ref is the branch HEAD was on (none when detached: then nothing is recorded).
      FROM_REF="${FROM:-$(git -C "$HERE_CO" symbolic-ref -q --short HEAD || true)}"
      [ -z "$FROM_REF" ] || { git config "devbox-task.$NAME.from" "$FROM_REF"; git config "devbox-task.$NAME.base" "$START"; }
    fi
    git config "$RECORD" "$BOX_NAME"
    export BOX_STARTED=1

    step "2. hand it to box $BOX_NAME"
    RC=0; "$SELF_DIR/handoff.sh" to "$BOX_NAME" "$BRANCH" --contains-develop | tail -1 || RC=$?
    if [ "$RC" = 4 ] || [ "$RC" = 5 ]; then
      # The box refused before its branch moved. Take back what this run made here, so the rerun branches afresh.
      [ "$MADE" = 0 ] || git update-ref -d "refs/heads/$BRANCH" "$START"
      [ -n "$REC" ] || git config --unset "$RECORD"
      [ "$MADE" = 0 ] || { git config --unset "devbox-task.$NAME.from" || true; git config --unset "devbox-task.$NAME.base" || true; }
      TOOK=""; [ "$MADE" = 0 ] || TOOK="$BRANCH"; [ -n "$REC" ] || TOOK="${TOOK:+$TOOK and }its record"
      [ -n "$TOOK" ] && V="this start took back $TOOK" || V="$BRANCH and its record were there before this start, so they stay"
      # 5: the tip lacks develop. The box's message names no commands (its remotes are not this laptop's): give ours.
      FIX="Fix what it names"; [ "$RC" != 5 ] || FIX="Pull develop into the start point ($START_IS) here: $(develop_fix)"
      die "box $BOX_NAME refused $BRANCH (above); $V. $FIX, then start again."
    fi
    [ "$RC" = 0 ] || exit "$RC"

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
    SINCE="$(box_ssh 'date +%s')"
    agent_launch "$WT" "$(prompt)"
    n=0; until agent_alive "$WT"; do
      n=$((n + 1)); [ $n -gt 20 ] && die "no Claude terminal in '$NAME' after 60 s; open the env in Orca and run claude there"; sleep 3
    done
    # A terminal is not a working agent. On #1698 Claude's login had expired: it wrote "Not logged in" into its
    # session log as a synthetic entry, dropped the prompt, and sat an hour while watch said working. The proof is
    # its first real reply in that log.
    WAIT="${DEVBOX_REPLY_WAIT:-180}"; n=0
    RERUN="close that terminal and rerun task.sh start $NAME: it reuses the branch, record, brief and env, and only starts Claude again"
    while :; do
      REPLY="$(reply_probe | box_ssh "python3 - $WT $SINCE")"
      case "$REPLY" in
        real) break ;;
        synthetic*) die "Claude in '$NAME' stopped before the task: ${REPLY#*$'\t'}. Fix it in Orca (box $BOX_NAME): open the env's terminal there and do what it says (/login for an expired login), then $RERUN" ;;
      esac
      n=$((n + 5))
      [ "$n" -lt "$WAIT" ] || { agent_tail "$WT"; die "no reply from Claude in '$NAME' after $WAIT s (its terminal's last lines above). Look at it in Orca (box $BOX_NAME); if it is stuck, $RERUN"; }
      sleep 5
    done
    ok "Claude is working in '$NAME' (its first reply is in). Watch it in Orca (box $BOX_NAME). Next: task.sh status $NAME"
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
    base_warn "$NAME"
    echo; echo "Review: git log --stat master..$BRANCH ; git diff master...$BRANCH"
    # The report's ## Review is the runner's step (docs/agents/definition-of-done.md): a fresh read against the task's
    # own base, which the box knows (a branch cut --from another ref has a base master does not), else the laptop's
    # record of it, else master (which a rewound master no longer shares with the branch).
    ROOT="$(box_root)"
    BASE="$(box_ssh "cd $ROOT/benches/$NAME/apps/nirmaan_stack 2>/dev/null && python3 scripts/devenv/dod.py base" 2>/dev/null || true)"
    git rev-parse -q --verify "${BASE}^{commit}" >/dev/null 2>&1 || BASE="$T_BASE"
    [ -n "$BASE" ] || BASE="$(git merge-base master "$BRANCH" || true)"
    echo "Separate review (fills the report's 'Separate review:' line): /mattpocock-skills:code-review ${BASE:0:9}, on $BRANCH"
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
    # No pipe after destroy: its status is what stops the branch delete. The login shell may be zsh (air).
    # With the env gone, a benches/<name> folder is what a destroy left when its last rmdir met files an agent left
    # there (air, 2026-11-24): removed when empty, so a rerun converges; never forced.
    RC=0; OUT="$(box_ssh "cd ~/$BOX_CO || exit 1
      if [ -d $WT ]; then
        scripts/devenv/devenv.sh stop $NAME >/dev/null 2>&1
        o=\"\$(scripts/devenv/devenv.sh destroy $NAME 2>&1)\" || { printf '%s\n' \"\$o\"; exit 1; }
        printf '%s\n' \"\$o\" | tail -1
      else
        if [ -d $ROOT/benches/$NAME ]; then
          rmdir $ROOT/benches/$NAME/apps 2>/dev/null
          rmdir $ROOT/benches/$NAME 2>/dev/null || { echo 'The env is gone, but $ROOT/benches/$NAME still holds files: look at them, move or remove them yourself:'; ls -A $ROOT/benches/$NAME; exit 1; }
          echo 'removed the empty folder $ROOT/benches/$NAME'
        fi
        echo 'No env $NAME on the box.'
      fi
      git branch -D $BRANCH 2>/dev/null && echo 'deleted the box branch $BRANCH' || true")" || RC=$?
    [ -z "$OUT" ] || printf '%s\n' "$OUT"
    [ "$RC" != 3 ] || exit 3
    [ "$RC" = 0 ] && grep -qE "^(Destroyed env|No env) $NAME[ .]" <<<"$OUT" \
      || die "the box did not destroy env $NAME (above). The record stays: fix it there, then run task.sh clean $NAME again."
    # Last, so a clean that stopped on the box can be rerun and still finds its box. The section holds the task's
    # whole record (box, from, base).
    git config --remove-section "devbox-task.$NAME"
    ok "cleaned $NAME on box $BOX_NAME. The report stays at $BOX_SSH:~/$DIR/ ; the laptop branch $BRANCH is yours to keep or delete."
    ;;
esac
exit
}
