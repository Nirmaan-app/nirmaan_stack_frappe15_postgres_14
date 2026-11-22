#!/usr/bin/env python3
"""
PreToolUse guard: keep per-slice as-built detail OUT of the always-loaded CLAUDE.md files.

Enforces the DOCS-UPDATE RULE (CLAUDE.md, 2026-06-25 context-hygiene split): per-commit /
per-slice detail (test counts, feat hashes, 'Slice N' narratives, build logs, dated slice
stories) belongs in the commit message and in no doc, least of all the always-loaded CLAUDE.md. This hook
inspects edits to any project CLAUDE.md and DENIES the write when the *added* text carries
changelog signatures, and tells the author where that text goes instead (DESTINATIONS below).

It also DENIES every Edit / Write / MultiEdit call on the closed BoQ plan (FROZEN_PLAN below), so the
record stops growing. It is not registered for Bash, so a shell write is not caught.

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

# Where each kind of text goes instead. Shared by both denials below.
DESTINATIONS = (
    "  - what was built, test counts, hashes, build logs -> the commit message, and no doc\n"
    "  - a rule a later change must not break -> that domain doc's Load-bearing invariants section\n"
    "  - where BoQ work stands now -> frontend/.claude/plans/boq-status.md, rewritten in place\n"
)

REASON = (
    "This edit to CLAUDE.md looks like per-slice / per-commit as-built detail "
    "(test counts, feat hashes, 'Slice N', dates, or build logs).\n"
    "Per the DOCS-UPDATE RULE, that detail does not belong in the always-loaded CLAUDE.md:\n"
    + DESTINATIONS +
    "Touch CLAUDE.md ONLY for a STABLE convention or a load-bearing / owner-locked invariant, phrased "
    "WITHOUT per-commit metrics (no test counts, hashes, dates, or 'Slice N').\n"
    "If this is genuinely a stable convention and the match is incidental, rephrase to drop the "
    "changelog-style wording."
)

# The BoQ plan is a closed record: every author was once sent here to append, and it passed 4 MB.
FROZEN_PLAN = os.path.join("frontend", ".claude", "plans", "boq-upload-plan.md")

FROZEN_REASON = (
    "frontend/.claude/plans/boq-upload-plan.md is a closed record and takes no new text.\n"
    + DESTINATIONS +
    "To read the record, list its headings with grep and read one range."
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


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))


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
    if os.path.normpath(path).endswith(os.sep + FROZEN_PLAN):
        deny(FROZEN_REASON)
        return
    if os.path.basename(path) != "CLAUDE.md":
        return  # the diary check is for CLAUDE.md files only

    # Never interfere with the user's global ~/.claude config.
    home_claude = os.path.abspath(os.path.join(os.path.expanduser("~"), ".claude"))
    try:
        if os.path.abspath(path).startswith(home_claude + os.sep):
            return
    except Exception:
        pass

    try:
        if is_changelog(added_text(tool_name, tool_input)):
            deny(REASON)
    except Exception:
        return  # fail-open


if __name__ == "__main__":
    main()
