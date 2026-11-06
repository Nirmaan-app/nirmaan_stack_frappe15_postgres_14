"""Tests guard_log_polling.py by feeding it hook input on stdin.

Run: python3 -I .claude/hooks/test_guard_log_polling.py
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent / "guard_log_polling.py"


def decide(command, background=False, tool="Bash"):
    data = {"tool_name": tool, "tool_input": {"command": command, "run_in_background": background}}
    out = subprocess.run([sys.executable, "-I", str(HOOK)], input=json.dumps(data), capture_output=True, text=True).stdout
    return json.loads(out)["hookSpecificOutput"]["permissionDecision"] if out.strip() else "allow"


class LogPolling(unittest.TestCase):
    def test_an_until_loop_waiting_on_a_log_is_denied(self):
        # The loop a box agent ran on 2026-11-05 (login-role-fix); it nearly hit the 10-minute tool limit.
        cmd = 'L=/tmp/x/affected2.log; until grep -qE "^devenv: (PASS|FAIL)" $L || [ $SECONDS -gt 570 ]; do sleep 20; done; grep -c "^Ran" $L'
        self.assertEqual(decide(cmd), "deny")

    def test_a_while_loop_tailing_a_log_is_denied(self):
        self.assertEqual(decide("while ! tail -1 run.log | grep -q done; do sleep 5; done"), "deny")

    def test_the_same_loop_in_the_background_is_allowed(self):
        self.assertEqual(decide('until grep -q PASS run.log; do sleep 20; done', background=True), "allow")

    def test_a_readiness_retry_with_no_log_read_is_allowed(self):
        self.assertEqual(decide("until curl -sf http://localhost:8000/api/ping; do sleep 1; done"), "allow")

    def test_a_plain_grep_of_a_log_is_allowed(self):
        self.assertEqual(decide('grep -c "^Ran" run.log; tail -5 run.log'), "allow")

    def test_a_loop_written_into_a_file_by_a_heredoc_is_allowed(self):
        self.assertEqual(decide("cat > t.sh <<'EOF'\nuntil grep -q PASS x.log; do sleep 5; done\nEOF\nbash -n t.sh"), "allow")

    def test_a_loop_inside_a_quoted_string_is_allowed(self):
        self.assertEqual(decide("""echo '{"command": "until grep -q PASS x.log; do sleep 5; done"}' | python3 hook.py"""), "allow")

    def test_other_tools_are_ignored(self):
        self.assertEqual(decide("until grep -q x f; do sleep 1; done", tool="Read"), "allow")

    def test_bad_input_fails_open(self):
        out = subprocess.run([sys.executable, "-I", str(HOOK)], input="not json", capture_output=True, text=True)
        self.assertEqual((out.returncode, out.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
