"""Tests for rule W1 (walk_graduation.py): a merged PR's walk is graduated before a commit or merge brings it in.

Stdlib and git only, each test in a made-up git repo of its own:
    python3 -I -m unittest discover -s scripts -p 'test_walk_graduation.py'
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from walk_graduation import graduation_gaps  # noqa: E402

PR_WALK = ".claude/skills/pr-walk/bin/walk_pr_42.py"
LEDGER = ".claude/skills/verify/features/graduated.json"
README = ".claude/skills/verify/features/README.md"
FEATURE = ".claude/skills/verify/features/orders.md"
WALK = ".claude/skills/verify/bin/walk_orders.py"

GRADUATED_WALK = """import sys
from pathlib import Path
from record import Walk
env, only = sys.argv[1], sys.argv[3:]
w = Walk(Path(sys.argv[2]), {"number": 0}, {"after": env}, "made up")
w.change("list", "Orders list", "shows every order")
w.finish(Path(__file__).resolve().parents[1] / "features/orders.md", stamp=not only)
"""

FEATURE_BODY = """# Orders

The orders list and its export.

{stamp}

## Sub-features

## How to get to it (user POV)

## Driving it with drive.py

## Gotchas
"""


def pr_walk(head: str, claims=("list", "export")) -> str:
    changes = "".join(f'w.change("{c}", "{c} title", "{c} claim")\n' for c in claims)
    pr = f'{{"number": 42, "head": "{head}", "base": "0000000"}}'
    return f'w = Walk(out, pr={pr}, envs={{}}, data_note="")\n{changes}'


class Repo:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir()
        self.git("init", "-q", "-b", "main")

    def git(self, *args: str) -> str:
        return subprocess.run(["git", "-C", str(self.root), "-c", "user.name=t", "-c", "user.email=t@example.com",
                               *args], capture_output=True, text=True, check=True).stdout.strip()

    def write(self, rel: str, text: str) -> None:
        (self.root / rel).parent.mkdir(parents=True, exist_ok=True)
        (self.root / rel).write_text(text)

    def commit(self, message: str = "change", rel: str | None = None, text: str = "") -> str:
        if rel:
            self.write(rel, text)
        self.git("add", "-A")
        self.git("commit", "-q", "--allow-empty", "-m", message)
        return self.git("rev-parse", "--short=9", "HEAD")

    def side_commit(self, branch: str) -> str:
        """A commit on a new branch that main does not hold; main stays checked out."""
        self.git("switch", "-q", "-c", branch)
        head = self.commit(f"work on {branch}", f"{branch}.txt", branch)
        self.git("switch", "-q", "main")
        return head

    def gaps(self) -> list[str]:
        return graduation_gaps(self.root)


class W1Case(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.repo = Repo(Path(tmp.name) / "repo")
        self.base = self.repo.commit("first", "app.txt", "app")
        self.repo.write(README, "# Map\n\n## Features\n\n- [Orders](./orders.md): walked by `BIN/walk_orders.py`.\n")

    def graduate(self, ledger: dict | None = None, walk: str = GRADUATED_WALK, result: str = "passed",
                 stamp_at: str | None = None, feature: str = FEATURE_BODY) -> None:
        """PR 42 merged with claims list and export, list walked by walk_orders.py and export skipped."""
        self.repo.write(PR_WALK, pr_walk(self.base))
        self.repo.write(LEDGER, json.dumps({"42": {"list": "walk_orders.py", "export": "skip: no screen"}}
                                           if ledger is None else ledger))
        self.repo.write(WALK, walk)
        stamp = f"Last walked (walk_orders.py): 2026-11-23 UTC at {stamp_at or self.base}, {result}."
        self.repo.write(FEATURE, feature.format(stamp=stamp))
        self.repo.commit("graduate PR 42")

    def assert_one_gap(self, path: str, words: str) -> None:
        gaps = self.repo.gaps()
        self.assertEqual(len(gaps), 1, gaps)
        self.assertTrue(gaps[0].startswith(f"{path}: "), gaps[0])
        self.assertIn(words, gaps[0])


class WhenAWalkCounts(W1Case):
    def test_an_unmerged_prs_walk_is_ignored(self):
        head = self.repo.side_commit("pr-42")
        self.repo.commit("walk PR 42", PR_WALK, pr_walk(head))
        self.assertEqual(self.repo.gaps(), [])

    def test_a_walk_whose_head_is_in_head_history_is_merged(self):
        self.repo.commit("walk PR 42", PR_WALK, pr_walk(self.base))
        gaps = self.repo.gaps()
        self.assertEqual(len(gaps), 2, gaps)
        self.assertTrue(all(g.startswith(f"{PR_WALK}: ") for g in gaps), gaps)
        self.assertIn("'list'", gaps[0])
        self.assertIn("'export'", gaps[1])

    def test_a_merge_commit_naming_the_pr_marks_it_merged_when_its_head_was_rewritten(self):
        head = self.repo.side_commit("pr-42")
        rewritten = self.repo.side_commit("pr-42-rebased")
        self.repo.git("merge", "-q", "--no-ff", "-m", "Merge pull request #42 from team/pr-42", "pr-42-rebased")
        self.repo.commit("walk PR 42", PR_WALK, pr_walk(head))
        self.assertNotEqual(head, rewritten)
        self.assertEqual(len(self.repo.gaps()), 2)

    def test_a_merge_of_another_pr_whose_number_starts_the_same_does_not_count(self):
        head = self.repo.side_commit("pr-42")
        self.repo.side_commit("pr-420")
        self.repo.git("merge", "-q", "--no-ff", "-m", "Merge PR #420 from team/pr-420", "pr-420")
        self.repo.commit("walk PR 42", PR_WALK, pr_walk(head))
        self.assertEqual(self.repo.gaps(), [])

    def test_a_merge_stopped_before_its_commit_is_checked_against_merge_head(self):
        head = self.repo.side_commit("pr-42")
        self.repo.commit("walk PR 42", PR_WALK, pr_walk(head))
        self.assertEqual(self.repo.gaps(), [])
        self.repo.git("merge", "-q", "--no-ff", "--no-commit", "pr-42")
        self.assertEqual(len(self.repo.gaps()), 2)

    def test_a_pre_merge_commit_hook_refuses_the_merge_that_brings_an_ungraduated_pr_in(self):
        head = self.repo.side_commit("pr-42")
        self.repo.commit("walk PR 42", PR_WALK, pr_walk(head))
        hooks = self.repo.root / ".git/hooks"
        (hooks / "w1.py").write_text(f"import sys\nsys.path.insert(0, {str(SCRIPTS)!r})\nfrom pathlib import Path\n"
                                     "from walk_graduation import graduation_gaps\n"
                                     "gaps = graduation_gaps(Path.cwd())\nprint(*gaps, sep='\\n')\n"
                                     "sys.exit(1 if gaps else 0)\n")
        (hooks / "pre-merge-commit").write_text(f'#!/bin/sh\nexec "{sys.executable}" -I "{hooks / "w1.py"}"\n')
        (hooks / "pre-merge-commit").chmod(0o755)
        before = self.repo.git("rev-parse", "HEAD")
        with self.assertRaises(subprocess.CalledProcessError) as refused:
            self.repo.git("merge", "-q", "--no-ff", "-m", "Merge branch pr-42", "pr-42")
        self.assertIn("claim 'list' is not graduated", refused.exception.stderr)
        self.assertEqual(self.repo.git("rev-parse", "HEAD"), before)

    def test_a_walk_with_no_head_is_a_gap(self):
        self.repo.commit("walk PR 42", PR_WALK, 'w.change("list", "t", "c")\n')
        self.assert_one_gap(PR_WALK, "no \"head\"")

    def test_a_shallow_clone_that_cannot_see_the_head_is_a_gap_saying_so(self):
        self.repo.commit("walk PR 42", PR_WALK, pr_walk(self.base))
        shallow = self.repo.root.parent / "shallow"
        subprocess.run(["git", "clone", "-q", "--depth=1", f"file://{self.repo.root}", str(shallow)], check=True)
        gaps = graduation_gaps(shallow)
        self.assertEqual(len(gaps), 1, gaps)
        self.assertIn("cannot tell", gaps[0])
        self.assertIn("--unshallow", gaps[0])

    def test_a_shallow_clone_holding_an_unmerged_head_newer_than_its_cut_ignores_the_walk(self):
        shallow = self.repo.root.parent / "shallow"
        subprocess.run(["git", "clone", "-q", "--depth=1", f"file://{self.repo.root}", str(shallow)], check=True)
        with mock.patch.dict(os.environ, GIT_COMMITTER_DATE="2099-01-01T00:00:00 +0000"):
            head = self.repo.side_commit("pr-42")
            self.repo.commit("walk PR 42", PR_WALK, pr_walk(head))
        subprocess.run(["git", "-C", str(shallow), "fetch", "-q", "origin", "main", "pr-42:pr-42"], check=True)
        subprocess.run(["git", "-C", str(shallow), "merge", "-q", "--ff-only", "origin/main"], check=True)
        self.assertEqual(subprocess.run(["git", "-C", str(shallow), "rev-parse", "--is-shallow-repository"],
                                        capture_output=True, text=True).stdout.strip(), "true")
        self.assertEqual(graduation_gaps(shallow), [])


class TheLedger(W1Case):
    def test_a_fully_graduated_walk_has_no_gaps(self):
        self.graduate()
        self.assertEqual(self.repo.gaps(), [])

    def test_a_claim_with_no_entry_is_a_gap(self):
        self.graduate(ledger={"42": {"list": "walk_orders.py"}})
        self.assert_one_gap(PR_WALK, "'export'")

    def test_an_entry_for_a_claim_the_walk_does_not_make_is_stale(self):
        self.graduate(ledger={"42": {"list": "walk_orders.py", "export": "skip: no screen", "gone": "skip: old"}})
        self.assert_one_gap(LEDGER, "'gone'")

    def test_a_skip_with_no_reason_is_a_gap(self):
        self.graduate(ledger={"42": {"list": "walk_orders.py", "export": "skip:  "}})
        self.assert_one_gap(LEDGER, "no reason")

    def test_an_entry_that_is_neither_a_walk_nor_a_skip_is_a_gap(self):
        self.graduate(ledger={"42": {"list": "walk_orders.py", "export": "later"}})
        self.assert_one_gap(LEDGER, "'later'")


class TheNamedWalk(W1Case):
    def test_a_walk_file_that_does_not_exist_is_a_gap(self):
        self.graduate(ledger={"42": {"list": "walk_orders.py", "export": "walk_export.py"}})
        self.assert_one_gap(".claude/skills/verify/bin/walk_export.py", "no such file")

    def test_a_walk_the_features_readme_does_not_name_is_a_gap(self):
        self.repo.write(README, "# Map\n")
        self.graduate()
        self.assert_one_gap(README, "walk_orders.py")

    def test_a_readme_naming_only_a_longer_walk_name_does_not_name_the_walk(self):
        self.repo.write(README, "# Map\n\n- [Orders](./orders.md): walked by `BIN/walk_old_orders.py`.\n")
        self.graduate()
        self.assert_one_gap(README, "walk_orders.py")

    def test_a_walk_bound_to_the_prs_env_is_a_gap(self):
        self.graduate(walk=GRADUATED_WALK.replace("sys.argv[1], sys.argv[3:]", '"pr-1731", sys.argv[3:]'))
        self.assert_one_gap(WALK, "pr-1731")

    def test_a_walk_bound_to_the_base_env_is_a_gap(self):
        self.graduate(walk=GRADUATED_WALK + 'BEFORE = "pr-1731-base"\n')
        self.assert_one_gap(WALK, "pr-1731-base")

    def test_a_walk_that_never_calls_finish_is_a_gap(self):
        self.graduate(walk=GRADUATED_WALK.replace("w.finish(", "w.save(#"))
        self.assert_one_gap(WALK, "finish")

    def test_a_walk_no_feature_file_stamps_is_a_gap(self):
        self.graduate(feature=FEATURE_BODY.replace("{stamp}", "Not walked yet."))
        self.assert_one_gap(WALK, "Last walked")

    def test_a_walk_last_stamped_failed_is_a_gap(self):
        self.graduate(result="failed")
        self.assert_one_gap(FEATURE, "failed")

    def test_a_stamp_at_a_commit_outside_this_history_is_a_gap(self):
        self.graduate(stamp_at="abcdef123")
        self.assert_one_gap(FEATURE, "abcdef123")

    def test_a_feature_file_missing_a_contract_section_is_a_gap(self):
        self.graduate(feature=FEATURE_BODY.replace("## Gotchas\n", ""))
        self.assert_one_gap(FEATURE, "Gotchas")

    def test_a_feature_file_with_the_sections_out_of_order_is_a_gap(self):
        self.graduate(feature=FEATURE_BODY.replace("## Sub-features\n\n", "") + "\n## Sub-features\n")
        self.assert_one_gap(FEATURE, "in that order")


if __name__ == "__main__":
    unittest.main()
