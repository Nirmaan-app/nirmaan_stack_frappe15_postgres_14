#!/usr/bin/env python3
"""Definition of Done for an agent task: proof stamps, the check, and the Claude Code Stop hook that runs it.

    dod.py start [--base <ref>]      in a task's worktree: turn the check on (base = HEAD unless given) and write the
                                     report template; prints the report's path
    dod.py check                     list what the task still lacks; exit 1 if anything is missing
    dod.py base                      print the task's base commit (for devenv.sh test --affected)
    dod.py stop                      turn the check off for this worktree (the owner ends or abandons the task)
    dod.py hook                      the Stop hook (.claude/settings.json): reads the hook input on stdin
    dod.py stamp <worktree> <kind> PASS|FAIL [json]
                                     record a proof; devenv.sh (test, unit, typecheck) and the verify skill's drive.py
                                     call this, never an agent

The rules are in docs/agents/definition-of-done.md. Nothing here takes the agent's word: a proof counts only when it
was stamped by the tool that ran it, for the exact code at HEAD (the stamp holds a tree hash of the worktree as it
was tested, uncommitted changes included; HEAD's tree must equal it).

State lives in the worktree's own git dir (<git dir>/devenv-proof/), so it is never committed and each worktree has
its own. A worktree without dod.json is not a task: check and hook do nothing there, so ordinary sessions are
untouched.
"""

from __future__ import annotations

import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

PROTECTED = {"master", "main", "develop"}
REPORT_SECTIONS = ("Status", "What changed", "Evidence", "Data", "Open questions")
MAX_BLOCKS = 3  # consecutive Stop-hook blocks before a stuck agent is let go (the report then says what is missing)


def git(wt: Path, *args: str, ok: bool = False) -> str:
    r = subprocess.run(["git", "-C", str(wt), *args], capture_output=True, text=True)
    if r.returncode and not ok:
        raise SystemExit(f"dod: git {' '.join(args)} failed in {wt}: {r.stderr.strip()}")
    return r.stdout.strip()


def toplevel(path: Path) -> Path | None:
    r = subprocess.run(["git", "-C", str(path), "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return Path(r.stdout.strip()) if r.returncode == 0 else None


def state_dir(wt: Path, create: bool = True) -> Path:
    d = Path(git(wt, "rev-parse", "--absolute-git-dir")) / "devenv-proof"
    if create:
        d.mkdir(exist_ok=True)
    return d


def load(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def save(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=1) + "\n")


def now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def worktree_tree(wt: Path) -> str:
    """Tree hash of the worktree as it is now: tracked changes and untracked, not-ignored files included."""
    index = Path(git(wt, "rev-parse", "--git-path", "index"))
    if not index.is_absolute():
        index = wt / index
    with tempfile.TemporaryDirectory() as tmp:
        tmp_index = Path(tmp) / "index"
        if index.exists():
            tmp_index.write_bytes(index.read_bytes())
        env = {**os.environ, "GIT_INDEX_FILE": str(tmp_index)}
        subprocess.run(["git", "-C", str(wt), "add", "-A"], env=env, capture_output=True, check=True)
        return subprocess.run(["git", "-C", str(wt), "write-tree"], env=env, capture_output=True, text=True,
                              check=True).stdout.strip()


# ---------------------------------------------------------------- stamps

def stamp(wt: Path, kind: str, verdict: str, extra: dict) -> None:
    wt = toplevel(wt) or wt
    entry = {"tree": worktree_tree(wt), "head": git(wt, "rev-parse", "HEAD"), "verdict": verdict, "at": now(), **extra}
    path = state_dir(wt) / f"{kind}.json"
    if kind == "verify":  # every walk counts; keep them all
        walks = load(path, [])
        save(path, [*walks, entry])
    else:
        save(path, entry)


# ---------------------------------------------------------------- the check

def changed_files(wt: Path, base: str) -> list[str]:
    return [f for f in git(wt, "diff", "--name-only", base, "HEAD").splitlines() if f]


def report_problems(path: Path, head_short: str) -> tuple[list[str], str | None]:
    """Problems with the report, and its Status (DONE, BLOCKED or None)."""
    if not path.exists():
        return [f"write the report at {path} (dod.py start made a template)"], None
    text = path.read_text()
    problems = []
    if "TODO" in text:
        problems.append(f"fill every TODO in {path}")
    if head_short not in text:
        problems.append(f"the report must name the commit it describes: {head_short} (git rev-parse --short HEAD)")
    for section in REPORT_SECTIONS:
        m = re.search(rf"^## {re.escape(section)}\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
        if not m or not m.group(1).strip():
            problems.append(f"the report needs a non-empty '## {section}' section")
    m = re.search(r"^## Status\s*\n\s*(\w+)", text, re.M)
    status = m.group(1).upper() if m else None
    if status not in ("DONE", "BLOCKED"):
        problems.append("'## Status' must start with DONE or BLOCKED")
    return problems, status


def check(wt: Path) -> list[str] | None:
    """None when the worktree is not a DoD task; else the list of what is missing (empty = done)."""
    sd = state_dir(wt, create=False)   # the hook runs at every stop: leave non-task worktrees untouched
    task = load(sd / "dod.json")
    if not task:
        return None
    missing = []
    base = task["base"]
    head = git(wt, "rev-parse", "HEAD")
    head_tree = git(wt, "rev-parse", "HEAD^{tree}")
    branch = git(wt, "branch", "--show-current", ok=True)

    if not branch:
        missing.append("work on a named branch, not a detached HEAD (devenv.sh create <task> --on <branch>, or --branch <new>)")
    elif branch in PROTECTED:
        missing.append(f"work on a task branch, not {branch}")
    if git(wt, "status", "--porcelain"):
        missing.append("commit every change (git status shows uncommitted or untracked files); nothing is done until it is committed")

    report, status = report_problems(Path(task["report"]), head[:9])
    missing += report
    if status == "BLOCKED":
        return missing  # the report explains why; no proofs are owed for work that could not be done

    if head == base:
        missing.append("no commit since the task started; commit the work, or set the report's Status to BLOCKED and say why")
    files = changed_files(wt, base)
    backend = [f for f in files if f.startswith("nirmaan_stack/")]
    frontend = [f for f in files if f.startswith("frontend/src/") and re.search(r"\.(tsx?|jsx?|css)$", f)]
    screens = [f for f in frontend if not re.search(r"\.test\.(tsx?|jsx?)$", f)]

    def proof(kind: str, what: str, cmd: str, ok_extra=lambda p: True) -> None:
        p = load(sd / f"{kind}.json")
        if not p:
            missing.append(f"{what}: none yet. Run: {cmd}")
        elif p["tree"] != head_tree:
            missing.append(f"{what}: the last run tested other code than HEAD (changed since). Run again: {cmd}")
        elif p["verdict"] != "PASS":
            missing.append(f"{what}: the last run FAILED. Fix it, commit, run again: {cmd}")
        elif not ok_extra(p):
            missing.append(f"{what}: run it with --affected {base[:9]} (the task's base) or an older base: {cmd}")

    def covers_base(p) -> bool:
        b = p.get("affected_base")
        return bool(b) and subprocess.run(["git", "-C", str(wt), "merge-base", "--is-ancestor", b, base]).returncode == 0

    if backend:
        proof("test", f"backend tests ({len(backend)} file(s) under nirmaan_stack/ changed)",
              f"scripts/devenv/devenv.sh test --affected {base[:9]}", covers_base)
    if frontend:
        proof("typecheck", "type check (frontend/src changed)", "scripts/devenv/devenv.sh typecheck")
    if screens:
        walks = [w for w in load(sd / "verify.json", []) if w["tree"] == head_tree and w["verdict"] == "PASS"]
        if not walks:
            missing.append("verify: no walk of the app at HEAD (frontend/src changed). Walk each changed screen with the "
                           "verify skill (.claude/skills/verify/SKILL.md); its drive.py stamps the walk")
    return missing


def report_template(task_name: str, base: str) -> str:
    return f"""# Report: {task_name}

Commit: TODO (the commit this report describes: git rev-parse --short HEAD)
Base: {base[:9]}

## Status
TODO: DONE or BLOCKED, then one line on the outcome

## What changed
TODO: what the change does for its user, and the files that matter

## Evidence
TODO: the test and type-check verdicts, and every verify evidence folder (one line per screen walked)

## Data
TODO: the data the env ran on (devenv.sh up prints its backup date)

## Review
TODO: the separate checker's verdict, or "pending"

## Open questions
TODO: or "none"
"""


# ---------------------------------------------------------------- commands

def cmd_start(args: list[str]) -> int:
    wt = toplevel(Path.cwd()) or sys.exit("dod: run this inside the task's worktree")
    base_ref = args[args.index("--base") + 1] if "--base" in args else "HEAD"
    base = git(wt, "rev-parse", base_ref)
    name = git(wt, "branch", "--show-current", ok=True) or wt.name
    report = Path.home() / "claude-artifacts" / "dod" / re.sub(r"[^A-Za-z0-9._-]+", "-", name) / "REPORT.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    if not report.exists():
        report.write_text(report_template(name, base))
    sd = state_dir(wt)
    save(sd / "dod.json", {"base": base, "base_ref": base_ref, "report": str(report), "started_at": now()})
    (sd / "hook_blocks").unlink(missing_ok=True)
    print(f"DoD on for {wt} (base {base[:9]}).\nReport: {report}\nRules: docs/agents/definition-of-done.md")
    return 0


def cmd_check(_args) -> int:
    wt = toplevel(Path.cwd()) or sys.exit("dod: run this inside a worktree")
    missing = check(wt)
    if missing is None:
        print("not a DoD task (no dod.py start here)")
        return 0
    if not missing:
        print("DoD met: done.")
        return 0
    print("DoD not met:\n" + "\n".join(f"- {m}" for m in missing))
    return 1


def cmd_hook(args) -> int:
    """Never fails a session: any error here is reported and the stop is allowed."""
    try:
        return _hook(args)
    except (Exception, SystemExit) as e:  # noqa: BLE001 - a broken check must not trap every session in the repo
        print(f"dod hook error (stop allowed): {e}", file=sys.stderr)
        return 0


def _hook(_args) -> int:
    data = json.loads(sys.stdin.read() or "{}")
    wt = toplevel(Path(data.get("cwd") or os.getcwd()))
    if not wt:
        return 0
    missing = check(wt)
    if not missing:  # not a task, or done
        if missing is not None:
            (state_dir(wt) / "hook_blocks").unlink(missing_ok=True)
        return 0
    counter = state_dir(wt) / "hook_blocks"
    blocks = int(counter.read_text()) if counter.exists() else 0
    blocks = blocks + 1 if data.get("stop_hook_active") else 1
    counter.write_text(str(blocks))
    if blocks > MAX_BLOCKS:
        print(f"dod: still not done after {MAX_BLOCKS} attempts; letting the session end. Missing:\n"
              + "\n".join(f"- {m}" for m in missing), file=sys.stderr)
        return 0
    reason = ("Definition of Done not met (docs/agents/definition-of-done.md). Before finishing:\n"
              + "\n".join(f"- {m}" for m in missing)
              + "\nIf the task cannot be done, set the report's Status to BLOCKED and explain why.")
    print(json.dumps({"decision": "block", "reason": reason}))
    return 0


def main() -> int:
    cmd, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ("", [])
    if cmd == "start":
        return cmd_start(args)
    if cmd == "check":
        return cmd_check(args)
    if cmd == "hook":
        return cmd_hook(args)
    if cmd == "base":
        wt = toplevel(Path.cwd()) or sys.exit("dod: run this inside a worktree")
        task = load(state_dir(wt) / "dod.json") or sys.exit("dod: not a DoD task (no dod.py start here)")
        print(task["base"])
        return 0
    if cmd == "stop":
        wt = toplevel(Path.cwd()) or sys.exit("dod: run this inside a worktree")
        (state_dir(wt) / "dod.json").unlink(missing_ok=True)
        print(f"DoD off for {wt}")
        return 0
    if cmd == "stamp" and len(args) >= 3:
        stamp(Path(args[0]), args[1], args[2], json.loads(args[3]) if len(args) > 3 else {})
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
