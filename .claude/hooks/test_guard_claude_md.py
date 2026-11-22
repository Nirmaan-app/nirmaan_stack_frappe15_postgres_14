"""Tests guard_claude_md.py by feeding it hook input on stdin.

Run: python3 -I .claude/hooks/test_guard_claude_md.py
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent / "guard_claude_md.py"
PLAN = "frontend/.claude/plans/boq-upload-plan.md"
DIARY = "Slice 4c shipped: vitest 320 -> 323, feat 5c095b34."


def run(path, new_string, tool="Edit"):
    data = {"tool_name": tool, "tool_input": {"file_path": path, "new_string": new_string, "content": new_string}}
    out = subprocess.run([sys.executable, "-I", str(HOOK)], input=json.dumps(data), capture_output=True, text=True).stdout
    if not out.strip():
        return "allow", ""
    answer = json.loads(out)["hookSpecificOutput"]
    return answer["permissionDecision"], answer["permissionDecisionReason"]


class DiaryInClaudeMd(unittest.TestCase):
    def test_diary_text_added_to_a_claude_md_is_denied(self):
        self.assertEqual(run("/repo/CLAUDE.md", DIARY)[0], "deny")

    def test_the_denial_sends_the_diary_to_the_commit_message(self):
        reason = run("/repo/frontend/CLAUDE.md", DIARY)[1]
        self.assertIn("commit message", reason)

    def test_the_denial_sends_no_one_to_the_frozen_plan(self):
        # The plan grew to 4 MB because this message once told every author to append to it.
        reason = run("/repo/CLAUDE.md", DIARY)[1]
        self.assertNotIn("boq-upload-plan.md", reason)

    def test_the_denial_names_the_status_file(self):
        self.assertIn("boq-status.md", run("/repo/CLAUDE.md", DIARY)[1])

    def test_a_stable_convention_is_allowed(self):
        self.assertEqual(run("/repo/CLAUDE.md", "Cast a bound SUBSTRING offset to integer.")[0], "allow")

    def test_one_date_alone_is_allowed(self):
        self.assertEqual(run("/repo/CLAUDE.md", "The owner ruled on 2026-09-15 that Paid means reconciled.")[0], "allow")

    def test_a_rewrite_that_only_keeps_old_diary_lines_is_allowed(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "CLAUDE.md"
            path.write_text(DIARY + "\nA stable line.\n")
            self.assertEqual(run(str(path), DIARY + "\n", tool="Write")[0], "allow")

    def test_the_global_claude_md_is_left_alone(self):
        self.assertEqual(run(str(Path.home() / ".claude" / "CLAUDE.md"), DIARY)[0], "allow")


class FrozenPlan(unittest.TestCase):
    def test_an_edit_to_the_plan_is_denied(self):
        decision, reason = run("/repo/" + PLAN, "## Slice DU-4 - as built")
        self.assertEqual(decision, "deny")
        self.assertIn("commit message", reason)
        self.assertIn("boq-status.md", reason)

    def test_a_write_to_the_plan_is_denied(self):
        self.assertEqual(run("/repo/" + PLAN, "anything", tool="Write")[0], "deny")

    def test_the_status_file_beside_it_is_allowed(self):
        self.assertEqual(run("/repo/frontend/.claude/plans/boq-status.md", DIARY)[0], "allow")

    def test_another_plan_is_allowed(self):
        self.assertEqual(run("/repo/frontend/.claude/plans/outflow-import-plan.md", DIARY)[0], "allow")


class Safety(unittest.TestCase):
    def test_other_tools_are_ignored(self):
        self.assertEqual(run("/repo/CLAUDE.md", DIARY, tool="Read")[0], "allow")

    def test_bad_input_fails_open(self):
        out = subprocess.run([sys.executable, "-I", str(HOOK)], input="not json", capture_output=True, text=True)
        self.assertEqual((out.returncode, out.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
