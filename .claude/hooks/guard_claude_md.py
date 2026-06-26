#!/usr/bin/env python3
"""
PreToolUse guard: keep per-slice as-built detail OUT of the always-loaded CLAUDE.md files.

Enforces the DOCS-UPDATE RULE (CLAUDE.md, 2026-06-25 context-hygiene split): per-commit /
per-slice detail (test counts, feat hashes, 'Slice N' narratives, build logs, dated slice
stories) belongs in the on-demand reference docs, NOT the always-loaded CLAUDE.md. This hook
inspects edits to any project CLAUDE.md and DENIES the write when the *added* text carries
changelog signatures, redirecting the author to the domain docs.

Registered as a PreToolUse hook (matcher Edit|Write|MultiEdit) in:
  - .claude/settings.json            (when Claude Code is launched from the app root)
  - frontend/.claude/settings.json   (when launched from frontend/ -- points back here via ../)

Design notes:
  * FAIL-OPEN: any parse/IO error -> exit 0. Never block real work because of a hook bug.
  * DELTA-AWARE: a full-file Write of an existing CLAUDE.md re-supplies all the pre-existing
    changelog; only genuinely-new lines are evaluated, so a legitimate dedup/cleanup pass
    (which REMOVES lines) is never blocked.
  * SCOPED: only basename == "CLAUDE.md", and never the user's global ~/.claude config.
  * TUNABLE: edit the STRONG / WEAK lists below. STRONG = any one match blocks;
    WEAK = two or more matches block (keeps single incidental mentions from false-positiving).
"""
import json
import os
import re
import sys

# Any ONE strong signal blocks the edit -- these only ever appear in as-built changelog prose.
STRONG = [
    r"vitest\s+\d+",                                       # "vitest 323", "vitest 320 -> 323"
    r"test_pricing\s+\d+",                                 # backend suite counts
    r"\b\d{1,4}\s*->\s*\d{1,4}\b",                         # test-count deltas e.g. 303 -> 307
    r"\bfeat\s+[0-9a-f]{7,}\b",                            # "feat 5c095b34" (commit hash)
    r"(?:feat|fix|docs|refactor)\([a-z0-9._-]+\):.*\brecord\b",  # the docs(record) ritual line
    r"in-container build exit\s+\d",                       # build-log noise
]

# Two or more weak signals together block; one alone is tolerated.
WEAK = [
    r"\bSlice\s+\d",
    r'§"',                                            # section-ref like  §"Slice ..."
    r"\b20\d\d-\d\d-\d\d\b",                               # date stamp
    r"\bsee plan\b",
    r"\bvitest\b",
    r"\btsc\s+\d{3,}",
    r"\bbench migrate\b",
]

STRONG_RE = [re.compile(p, re.IGNORECASE) for p in STRONG]
WEAK_RE = [re.compile(p, re.IGNORECASE) for p in WEAK]

REASON = (
    "This edit to CLAUDE.md looks like per-slice / per-commit as-built detail "
    "(test counts, feat hashes, 'Slice N', dates, or build logs).\n"
    "Per the DOCS-UPDATE RULE (context-hygiene split, 2026-06-25), that detail belongs in the "
    "on-demand reference docs, NOT the always-loaded CLAUDE.md:\n"
    "  - backend slices  -> .claude/context/domain/boq-backend.md\n"
    "  - frontend slices -> frontend/.claude/context/domain/boq-frontend.md\n"
    "  - live status / full narrative -> frontend/.claude/plans/boq-upload-plan.md\n"
    "Write the slice detail in the domain doc / plan instead. Touch CLAUDE.md ONLY for a STABLE "
    "convention or a load-bearing / owner-locked invariant, phrased WITHOUT per-commit metrics "
    "(no test counts, hashes, dates, or 'Slice N').\n"
    "If this is genuinely a stable convention and the match is incidental, rephrase to drop the "
    "changelog-style wording."
)


def added_text(tool_name, tool_input):
    """Best-effort text this tool would ADD to the file."""
    if tool_name == "Edit":
        return tool_input.get("new_string", "") or ""
    if tool_name == "MultiEdit":
        return "\n".join(
            (e.get("new_string", "") or "") for e in (tool_input.get("edits") or [])
        )
    if tool_name == "Write":
        content = tool_input.get("content", "") or ""
        path = tool_input.get("file_path", "") or ""
        # Only the lines NOT already present are genuinely "added" -> a cleanup that removes
        # changelog lines supplies no new changelog lines and is never blocked.
        try:
            if path and os.path.isfile(path):
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    existing = set(fh.read().splitlines())
                return "\n".join(ln for ln in content.splitlines() if ln not in existing)
        except OSError:
            pass
        return content
    return ""


def is_changelog(text):
    if not text:
        return False
    if any(rx.search(text) for rx in STRONG_RE):
        return True
    return sum(1 for rx in WEAK_RE if rx.search(text)) >= 2


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return  # fail-open

    tool_name = data.get("tool_name", "")
    if tool_name not in ("Edit", "Write", "MultiEdit"):
        return

    tool_input = data.get("tool_input") or {}
    path = tool_input.get("file_path", "") or ""
    if os.path.basename(path) != "CLAUDE.md":
        return  # only guard CLAUDE.md files

    # Never interfere with the user's global ~/.claude config.
    home_claude = os.path.abspath(os.path.join(os.path.expanduser("~"), ".claude"))
    try:
        if os.path.abspath(path).startswith(home_claude + os.sep):
            return
    except Exception:
        pass

    try:
        if is_changelog(added_text(tool_name, tool_input)):
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": REASON,
                }
            }))
    except Exception:
        return  # fail-open


if __name__ == "__main__":
    main()
