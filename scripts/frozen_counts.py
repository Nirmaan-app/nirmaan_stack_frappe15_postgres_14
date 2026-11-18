"""What residence checks J1 and D1 share: TypeScript's parser run by node, for counts frozen per file.

J1 (`.json()` calls, scripts/residence_check.py) and D1 (disable comments, scripts/disable_comment_check.py) each read
the frontend with a node script under frontend/scripts/ that uses frontend/node_modules/typescript.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

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
