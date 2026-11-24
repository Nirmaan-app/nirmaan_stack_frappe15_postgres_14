"""Tests dod.py's rules against a throwaway git repo, fake Claude Code session logs and fake briefs. No bench, no
network.

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


class TaskRepo(unittest.TestCase):
    """A task's worktree after `dod.py start`, with HOME and the Claude home in a throwaway folder."""

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


class SkillRule(TaskRepo):
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


class BlockerBypassHunt(TaskRepo):
    """A task whose brief says `Blocker: yes` is done only once a fresh bypass hunt has finished (#1702, #1705 and
    #1698: each laptop review of a blocker found one more hole, over three rounds each)."""

    def setUp(self):
        super().setUp()
        self.commit("docs/a.md", "words\n")
        self.task_dir = self.root / "home" / "claude-artifacts" / "dod" / "box-t"

    def check(self, brief, hunt, status="DONE. built"):
        if brief is not None:
            (self.task_dir / "BRIEF.md").write_text(f"# Task: build ticket #1702\n\n## Goal\nx\n\n{brief}\n")
        head = subprocess.run(["git", "-C", str(self.wt), "rev-parse", "--short=9", "HEAD"], capture_output=True,
                              text=True, check=True).stdout.strip()
        hunt_line = f"{hunt}\n" if hunt is not None else ""
        (self.task_dir / "REPORT.md").write_text(
            f"# Report\n\nCommit: {head}\n\n## Status\n{status}\n\n## What changed\nx\n\n## Evidence\nx\n\n"
            f"## Data\nnone\n\n## Review\nOwn code-review: finished, no findings\n{hunt_line}"
            f"Separate review: pending\n\n## Open questions\nnone\n")
        return self.dod("check")

    def test_a_blocker_without_the_hunt_line_is_not_done(self):
        for brief in ("Blocker: yes", "**Blocker:** Yes, a CI gate", "Blocker: a lint ratchet"):
            out = self.check(brief, None)
            self.assertIn("Bypass hunt:", out, brief)
            self.assertNotIn("DoD met", out, brief)

    def test_a_blocker_whose_hunt_has_not_finished_is_not_done(self):
        for hunt in ("Bypass hunt: pass 2 running", "Bypass hunt: pending", "Bypass hunt: skipped, no time",
                     "Bypass hunt: TBD", "Bypass hunt:", "Bypass hunt: finished", "Bypass hunt: finished.",
                     "Bypass hunt: Finished - nothing", "Bypass hunt: **finished**", "Bypass hunt: finished, ok"):
            out = self.check("Blocker: yes", hunt)
            self.assertIn("'Bypass hunt:' line must read 'Bypass hunt: finished, <each pass and what it found>'", out,
                          hunt)

    def test_a_blocker_whose_hunt_finished_is_done(self):
        out = self.check("Blocker: yes", "Bypass hunt: finished, pass 1 found a symlinked config (fixed in 1a2b3c4), "
                                         "pass 2 found nothing")
        self.assertIn("DoD met", out)
        out = self.check("Blocker: yes", "**Bypass hunt:** **finished**, pass 1 found nothing")
        self.assertIn("DoD met", out)

    def test_a_task_that_is_not_a_blocker_owes_no_hunt(self):
        for brief in ("Blocker: no", "Blocker: No. It adds a column", "## How\n1. build it", None):
            out = self.check(brief, None)
            self.assertIn("DoD met", out, brief)

    def test_a_blocked_blocker_owes_no_hunt(self):
        out = self.check("Blocker: yes", None, status="BLOCKED. the owner must decide X")
        self.assertIn("DoD met", out)


class UnfinishedReport(unittest.TestCase):
    """A DONE report whose own code-review is still going is not done (#1699's fix round said DONE with its review
    "pending ... is running", and "running when this was written" in Evidence)."""

    def problems(self, review, evidence="all tests pass", status="DONE. built"):
        import importlib.util
        spec = importlib.util.spec_from_file_location("dod", DOD)
        dod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(dod)
        text = (f"# Report\n\nCommit: abc1234\n\n## Status\n{status}\n\n## What changed\nx\n\n"
                f"## Evidence\n{evidence}\n\n## Data\nnone\n\n## Review\n{review}\n\n## Open questions\nnone\n")
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "REPORT.md"
            path.write_text(text)
            return dod.report_problems(path, "abc1234")[0]

    def test_a_finished_review_in_the_templates_shape_is_done(self):
        for line in ("- Own code-review: finished, no findings", "**Own code-review:** finished, no findings"):
            self.assertEqual(self.problems(f"{line}\nSeparate review: pending"), [], line)
        for value in ("finished, two findings fixed in abc1234, against 03d44ec3e", "**Finished**: no findings",
                      "finished. Running it found nothing; the Pending-status filter finding is fixed"):
            out = self.problems(f"Own code-review: {value}\nSeparate review: pending")
            self.assertEqual(out, [], value)

    def test_an_own_review_still_going_is_not_done(self):
        for value in ("pending: code-review against 03d44ec3e is running", "**pending**", "(pending)", "in progress",
                      "review started, results soon", "waiting for subagents", "queued", "unfinished", ""):
            out = self.problems(f"Own code-review: {value}\nSeparate review: pending")
            self.assertTrue(any("must read 'Own code-review: finished, " in p for p in out), (value, out))

    def test_a_done_report_without_the_own_review_line_is_not_done(self):
        out = self.problems("code-review: no findings")
        self.assertTrue(any("Own code-review" in p for p in out), out)

    def test_a_run_left_going_in_evidence_is_not_done(self):
        out = self.problems("Own code-review: finished, no findings\nSeparate review: pending",
                            evidence="vitest (full): running when this was written")
        self.assertTrue(any("still going" in p for p in out), out)

    def test_honest_words_elsewhere_are_not_flagged(self):
        review = ("Own code-review: finished, no findings pending; one about the Pending PR filter, fixed\n"
                  "Separate review: pending")
        out = self.problems(review, evidence="the worker is still running after restart, as the walk saw")
        self.assertEqual(out, [])

    def test_a_blocked_report_owes_no_own_review(self):
        out = self.problems("none: blocked before review", status="BLOCKED. the owner must decide X")
        self.assertEqual(out, [])


if __name__ == "__main__":
    unittest.main()
