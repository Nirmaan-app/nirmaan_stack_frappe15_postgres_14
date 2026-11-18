"""What residence checks J1 and D1 share: TypeScript's parser run by node, for counts frozen per file.

J1 (`.json()` calls, scripts/residence_check.py) and D1 (disable comments, scripts/disable_comment_check.py) each read
the frontend with a node script under frontend/scripts/ that uses frontend/node_modules/typescript.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Callable

REPO_ROOT = Path(__file__).resolve().parent.parent


class TsParserError(RuntimeError):
    """J1's or D1's parser could not run (no node, or no frontend/node_modules/typescript)."""


# Set by --hook: in a commit hook J1 and D1 warn and pass when their parser cannot run (a worktree with no
# frontend/node_modules, a box with no node); CI and every other run still fail.
NODE_MAY_SKIP = False


def run_ts_parser(parser: str, sources: dict[str, str]):
    """What node script ``parser`` (J1's or D1's, under frontend/scripts/) prints for ``sources``, read as JSON.

    Raises TsParserError when node or TypeScript is missing: neither check passes by not running.
    """
    try:
        run = subprocess.run(["node", str(REPO_ROOT / parser)], input=json.dumps(sources),
                             capture_output=True, text=True, encoding="utf-8")
    except OSError as e:
        raise TsParserError(f"node could not run ({e}); install Node.js so 'node' is on PATH") from e
    if run.returncode != 0:
        raise TsParserError(f"{parser} failed (exit {run.returncode}; run 'yarn install' in "
                                  f"frontend/ if typescript is missing): {run.stderr.strip()[:2000]}")
    try:
        return json.loads(run.stdout)
    except ValueError as e:
        raise TsParserError(f"{parser} printed no result: {run.stdout.strip()[:2000]}") from e


def node_cannot_run(check: str, what: str, error: TsParserError) -> list[str]:
    """A check's findings when its parser cannot run: none in a commit hook (NODE_MAY_SKIP), after a warning; else one
    that says why, so the check fails and never passes by not running."""
    if NODE_MAY_SKIP:
        print(f"⚠ {check} skipped: {error}. CI counts {what} on every pull request.")
        return []
    return [f"{check} could not count {what}: {error}"]


def read_frozen(path: str) -> dict[str, dict]:
    """A frozen-counts file (``path`` from the repo root), in oxlint's suppressions shape; {} when there is none."""
    file = REPO_ROOT / path
    return json.loads(file.read_text(encoding="utf-8")) if file.exists() else {}


def frozen_drift(found: dict[str, dict], frozen: dict[str, dict],
                 describe: Callable[[str, str, int, int], str]) -> tuple[list[str], list[str]]:
    """(over, under): ``describe(path, rule, now, was)`` for each file and rule counted above its frozen count, and
    for each counted below it, by path then rule.

    ``found`` and ``frozen`` are in oxlint's suppressions shape ({path: {rule: {"count": n}}}). Both lists fail J1
    and D1, file by file: over, so a new one fails even where another file lost one; under, so the change that removes
    one also lowers its frozen count, as a stale lint suppression fails `yarn lint`. scripts/frontend_ratchet_check.py
    refuses a frozen count that rises in a pull request."""
    over, under = [], []
    for path in sorted(set(found) | set(frozen)):
        now_rules, was_rules = found.get(path, {}), frozen.get(path, {})
        for rule in sorted(set(now_rules) | set(was_rules)):
            now, was = now_rules.get(rule, {}).get("count", 0), was_rules.get(rule, {}).get("count", 0)
            if now != was:
                (over if now > was else under).append(describe(path, rule, now, was))
    return over, under
