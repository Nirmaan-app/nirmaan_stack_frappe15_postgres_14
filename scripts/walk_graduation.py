"""Rule W1: a merged PR's walk is graduated before the merge or commit that brings it in.

A PR walk (`.claude/skills/pr-walk/bin/walk_pr_<n>.py`) proves the PR's claimed changes once, on throwaway envs. Once
the PR merges, each claimed change must become a rerunnable feature walk under the verify skill, or carry a written
reason it has none, so the proof outlives the PR (pr-walk SKILL.md step 9). The ledger
`.claude/skills/verify/features/graduated.json` records which:

    {"<PR number>": {"<claim id from w.change>": "walk_<feature>.py" | "skip: <reason>"}}

`graduation_gaps` lists what is missing, one `"<path>: <what is wrong>"` per gap. Stdlib only; git is the one
outside call, through an injectable runner.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Callable, Mapping

PR_WALKS = ".claude/skills/pr-walk/bin"
VERIFY_BIN = ".claude/skills/verify/bin"
FEATURES = ".claude/skills/verify/features"
LEDGER = f"{FEATURES}/graduated.json"
README = f"{FEATURES}/README.md"
# The README's "Feature entry contract", in its order.
CONTRACT_SECTIONS = ("Sub-features", "How to get to it (user POV)", "Driving it with drive.py", "Gotchas")

Git = Callable[..., tuple[int, str]]

_HEAD = re.compile(r"""["']head["']\s*:\s*["']([0-9a-f]{7,40})["']""")
_CLAIM = re.compile(r"""\.change\(\s*["']([^"']+)["']""")
_PR_ENV = re.compile(r"""["']pr-\d+(?:-base)?["']""")
_WALK_NAME = re.compile(r"walk_[A-Za-z0-9_]+\.py")


def stamp_pattern(walk: str) -> re.Pattern:
    """The `Last walked` line record.py's Walk.finish writes into a feature file for one walk script."""
    return re.compile(rf"^Last walked \({re.escape(walk)}\): (\d{{4}}-\d{{2}}-\d{{2}}) UTC at ([0-9a-f]{{7,40}}), "
                      r"(passed|failed)\.$", re.MULTILINE)


def git_runner(repo_root: Path) -> Git:
    def git(*args: str) -> tuple[int, str]:
        r = subprocess.run(["git", "-C", str(repo_root), *args], capture_output=True, text=True)
        return r.returncode, r.stdout
    return git


class History:
    """What the commit being made will hold: HEAD and the heads a merge brings in. A merge git commits by itself has
    no MERGE_HEAD file yet when pre-merge-commit runs; git names each merged head in a GITHEAD_<commit> variable
    instead. A merge stopped on conflicts is committed with `git commit`, whose pre-commit sees MERGE_HEAD."""

    def __init__(self, git: Git, env: Mapping[str, str] = os.environ):
        self.git = git
        merging = [k[len("GITHEAD_"):] for k in env if re.fullmatch(r"GITHEAD_[0-9a-f]{40,64}", k)]
        self.tips = ["HEAD", *merging] + (["MERGE_HEAD"] if git("rev-parse", "-q", "--verify", "MERGE_HEAD")[0] == 0
                                          else [])
        self.shallow = git("rev-parse", "--is-shallow-repository")[1].strip() == "true"

    def holds(self, commit: str) -> bool | None:
        """True when commit is in a tip's history, False when not, None when a shallow clone cannot tell.
        A full clone holds every commit of its tips' history, so a commit it does not know is not in it. A shallow
        clone can tell too when it holds the commit and the commit is newer than every shallow cut: only a commit
        older than a cut can hide in the history below it."""
        if any(self.git("merge-base", "--is-ancestor", commit, tip)[0] == 0 for tip in self.tips):
            return True
        if not self.shallow:
            return False
        rc, out = self.git("log", "-1", "--format=%ct", f"{commit}^{{commit}}", "--")
        if rc != 0 or not out.strip():
            return None
        cut = self._newest_cut()
        return False if cut is not None and int(out.strip()) > cut else None

    def _newest_cut(self) -> int | None:
        """The committer time of the newest shallow cut commit, or None when the cut cannot be read."""
        rc, out = self.git("rev-parse", "--path-format=absolute", "--git-path", "shallow")
        path = Path(out.strip())
        if rc != 0 or not path.is_file():
            return None
        cuts = path.read_text(encoding="utf-8").split()
        if not cuts:
            return None
        rc, out = self.git("log", "--no-walk", "--format=%ct", *cuts, "--")
        times = [int(t) for t in out.split()]
        return max(times) if rc == 0 and len(times) == len(cuts) else None

    def has_merge_of(self, pr: str) -> bool:
        """A merge commit of the PR in a tip's history: GitHub's "Merge pull request #<n>" or "Merge PR #<n>"."""
        return any(self.git("log", "--merges", "-E", f"--grep=^Merge (PR|pull request) #{pr}([^0-9]|$)",
                            "--format=%H", "-1", tip)[1].strip() for tip in self.tips)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _ledger(repo_root: Path) -> tuple[dict, list[str]]:
    path = repo_root / LEDGER
    if not path.exists():
        return {}, []
    try:
        data = json.loads(_read(path))
    except json.JSONDecodeError as e:
        return {}, [f"{LEDGER}: not valid JSON ({e})"]
    if not isinstance(data, dict) or not all(isinstance(v, dict) for v in data.values()):
        return {}, [f"{LEDGER}: must map each PR number to an object of claim id -> walk or \"skip: <reason>\""]
    return data, []


def _sections(md: str) -> list[str]:
    return [line[3:].strip() for line in md.splitlines() if line.startswith("## ")]


def _walk_gaps(repo_root: Path, walk: str, history: History) -> list[str]:
    """What keeps one graduated walk script from counting: missing, unlisted, PR-bound, unstamped or misfiled."""
    path = f"{VERIFY_BIN}/{walk}"
    if not (repo_root / path).is_file():
        return [f"{path}: named in {LEDGER}, but there is no such file"]
    src = _read(repo_root / path)
    gaps = []
    readme = repo_root / README
    if not re.search(rf"(?<!\w){re.escape(walk)}", _read(readme) if readme.exists() else ""):
        gaps.append(f"{README}: does not name {walk} under Features")
    for n, line in enumerate(src.splitlines(), 1):
        if m := _PR_ENV.search(line):
            gaps.append(f"{path}: line {n} hard-codes the PR env {m.group(0)}; take the env as an argument")
    if ".finish(" not in src:
        gaps.append(f"{path}: never calls w.finish(<feature file>), so no run stamps its feature file")
    stamps = [(md, m) for md in sorted((repo_root / FEATURES).glob("*.md"))
              for m in stamp_pattern(walk).finditer(_read(md))]
    if not stamps:
        return gaps + [f"{path}: no feature file in {FEATURES} holds \"Last walked ({walk}): <date> UTC at <commit>, "
                       "passed.\"; run it on an env until it passes and commit the stamp"]
    md, m = stamps[0]
    md_rel = md.relative_to(repo_root).as_posix()
    if m.group(3) != "passed":
        gaps.append(f"{md_rel}: {walk} last walked {m.group(1)} and failed; fix it and run it until it passes")
    held = history.holds(m.group(2))
    if held is None:
        gaps.append(f"{md_rel}: cannot tell whether {walk}'s stamp commit {m.group(2)} is in this history (shallow "
                    "clone); fetch full history (git fetch --unshallow)")
    elif not held:
        gaps.append(f"{md_rel}: {walk}'s stamp commit {m.group(2)} is not in this history; walk it on this code")
    if [s for s in _sections(_read(md)) if s in CONTRACT_SECTIONS] != list(CONTRACT_SECTIONS):
        gaps.append(f"{md_rel}: needs the H2 sections {', '.join(CONTRACT_SECTIONS)} in that order "
                    f"({README}, Feature entry contract)")
    return gaps


def graduation_gaps(repo_root: Path, git: Git | None = None) -> list[str]:
    """Every gap in the graduation of the merged PR walks in the working tree. An unmerged PR's walk is ignored."""
    history = History(git or git_runner(repo_root))
    ledger, gaps = _ledger(repo_root)
    walks_to_check: set[str] = set()
    for walk in sorted((repo_root / PR_WALKS).glob("walk_pr_*.py")):
        rel, pr = walk.relative_to(repo_root).as_posix(), walk.stem.removeprefix("walk_pr_")
        src = _read(walk)
        head = _HEAD.search(src)
        if head is None:
            gaps.append(f"{rel}: no \"head\": \"<commit>\" in its pr dict, so W1 cannot tell whether PR {pr} merged")
            continue
        merged = history.holds(head.group(1))
        if not merged and history.has_merge_of(pr):
            merged = True
        if merged is None:
            gaps.append(f"{rel}: cannot tell whether PR {pr}'s head {head.group(1)} is merged (shallow clone); fetch "
                        "full history (git fetch --unshallow)")
            continue
        if not merged:
            continue
        claims = list(dict.fromkeys(_CLAIM.findall(src)))
        entries = ledger.get(pr, {})
        for claim in claims:
            value = entries.get(claim)
            if value is None:
                gaps.append(f"{rel}: PR {pr} merged, and claim '{claim}' is not graduated: add a walk_<feature>.py or "
                            f"\"skip: <reason>\" for it to {LEDGER}")
            elif not isinstance(value, str):
                gaps.append(f"{LEDGER}: PR {pr} claim '{claim}' must be a string")
            elif value.startswith("skip:"):
                if not value[len("skip:"):].strip():
                    gaps.append(f"{LEDGER}: PR {pr} claim '{claim}' is skipped with no reason")
            elif _WALK_NAME.fullmatch(value):
                walks_to_check.add(value)
            else:
                gaps.append(f"{LEDGER}: PR {pr} claim '{claim}' is {value!r}, neither a walk_<feature>.py in "
                            f"{VERIFY_BIN} nor \"skip: <reason>\"")
        gaps.extend(f"{LEDGER}: PR {pr} claim '{stale}' is not a claim of {rel}"
                    for stale in entries if stale not in claims)
    for walk in sorted(walks_to_check):
        gaps.extend(_walk_gaps(repo_root, walk, history))
    return gaps
