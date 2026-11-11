"""Tests dod.py's skill rule against a throwaway git repo and fake Claude Code session logs. No bench, no network.

Run: python3 -I scripts/devenv/test_dod.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

DOD = Path(__file__).resolve().parent / "dod.py"


class SkillRule(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        self.wt = self.root / "wt"
        self.wt.mkdir()
        self.env = {**os.environ, "HOME": str(self.root / "home"), "CLAUDE_CONFIG_DIR": str(self.root / "claude"),
                    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
                    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}
        self.git("init", "-q", "-b", "box/t")
        self.commit("README", "start")
        self.dod("start")

    def tearDown(self):
        self._tmp.cleanup()

    def git(self, *args):
        subprocess.run(["git", "-C", str(self.wt), *args], env=self.env, check=True, capture_output=True)

    def commit(self, path, text):
        f = self.wt / path
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", text)

    def dod(self, *args):
        r = subprocess.run([sys.executable, "-I", str(DOD), *args], cwd=self.wt, env=self.env, capture_output=True,
                           text=True)
        return r.stdout + r.stderr

    def log(self, *entries, name="s1.jsonl", at="2999-01-01T00:00:00.000Z"):
        folder = self.root / "claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(self.wt))
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            for message in entries:
                f.write(json.dumps({"timestamp": at, "message": message}) + "\n")

    def assertNoSkillOwed(self, out):
        self.assertNotIn("skill tdd:", out)
        self.assertNotIn("skill code-review:", out)

    @staticmethod
    def skill_call(skill):
        return {"role": "assistant", "content": [{"type": "tool_use", "name": "Skill", "input": {"skill": skill}}]}

    def test_a_code_change_without_the_skills_is_not_done(self):
        self.commit("nirmaan_stack/x.py", "x = 1\n")
        out = self.dod("check")
        self.assertIn("skill tdd: not loaded", out)
        self.assertIn("skill code-review: not loaded", out)

    def test_skills_called_by_the_agent_or_a_subagent_count(self):
        self.commit("nirmaan_stack/x.py", "x = 1\n")
        self.log(self.skill_call("mattpocock-skills:tdd"), name="s1/subagents/agent-1.jsonl")
        self.log(self.skill_call("mattpocock-skills:code-review"))
        self.assertNoSkillOwed(self.dod("check"))

    def test_a_slash_command_typed_by_the_person_counts(self):
        self.commit("frontend/src/a.tsx", "export {}\n")
        self.log({"role": "user", "content": "<command-name>/mattpocock-skills:tdd</command-name>"},
                 {"role": "user", "content": [{"type": "text", "text": "<command-name>/code-review</command-name>"}]})
        self.assertNoSkillOwed(self.dod("check"))

    def test_a_call_from_before_the_task_started_does_not_count(self):
        self.commit("nirmaan_stack/x.py", "x = 1\n")
        self.log(self.skill_call("mattpocock-skills:tdd"), self.skill_call("mattpocock-skills:code-review"),
                 at="2000-01-01T00:00:00.000Z")
        self.assertIn("skill tdd: not loaded", self.dod("check"))

    def test_a_change_outside_the_code_owes_no_skill(self):
        self.commit("docs/a.md", "words\n")
        self.assertNoSkillOwed(self.dod("check"))


if __name__ == "__main__":
    unittest.main()
