#!/usr/bin/env python3
"""
PreToolUse guard (matcher Bash): deny a foreground loop that waits on a log by reading it over and over.

frappe_docker/development/CLAUDE.md says to run a long command with run_in_background and act on its completion
notice, because a loop that polls its log spends the 10-minute tool limit and ends before the work does. A box agent
ran such loops four times in one task (login-role-fix, 2026-11-05) with that rule in its context, so the rule is
enforced here instead.

Denied: an `until`/`while` loop that sleeps and reads a file (grep, tail, cat, wc), when run_in_background is not set.
Allowed: the same loop in the background, a retry loop that reads no file (a readiness probe), any one-off read.
FAIL-OPEN: any parse error -> allow.
"""
import json
import re
import sys

LOOP = re.compile(r"\b(?:until|while)\b.*?\bdo\b.*?\bsleep\b.*?\bdone\b", re.S)
READS_FILE = re.compile(r"\b(?:grep|tail|cat|wc)\b")
# Text the shell does not run: heredoc bodies, then quoted strings (a loop written into a file or a JSON payload).
HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?\n\s*\2\s*(?:\n|$)", re.S)
QUOTED = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")


def ran(command):
    return QUOTED.sub("''", HEREDOC.sub("\n", command))

REASON = (
    "This loop waits on a log by reading it again and again, which spends the 10-minute tool limit. "
    "Run the long command itself with run_in_background: true and act on the completion notice "
    "(frappe_docker/development/CLAUDE.md, \"Long commands\"). Read its log once, after the notice."
)


def main():
    try:
        data = json.load(sys.stdin)
        if data.get("tool_name") != "Bash":
            return
        tool_input = data.get("tool_input") or {}
        if tool_input.get("run_in_background"):
            return
        command = tool_input.get("command") or ""
        if any(READS_FILE.search(m.group(0)) for m in LOOP.finditer(ran(command))):
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": REASON,
                }
            }))
    except Exception:
        return


if __name__ == "__main__":
    main()
