"""Tests for frontend_ratchet_check.py: a pull request may shrink the frontend ratchet, never loosen it (#1687).

Stdlib only, like the script:  python3 -m unittest scripts.test_frontend_ratchet_check
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from frontend_ratchet_check import loosenings  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "frontend_ratchet_check.py"


def package(at_least):
    return {"scripts": {"type-coverage": f"type-coverage --strict --at-least {at_least}"}}


def suppressions(**files):
    """suppressions(a={"rule-x": 2}) -> the eslint-suppressions.json shape for src/a.tsx."""
    return {f"src/{name}.tsx": {rule: {"count": n} for rule, n in rules.items()} for name, rules in files.items()}


BASE = suppressions(orders={"@typescript-eslint/no-explicit-any": 3, "no-restricted-imports": 1})


class Suppressions(unittest.TestCase):
    def test_a_grown_count_is_refused(self):
        head = suppressions(orders={"@typescript-eslint/no-explicit-any": 4, "no-restricted-imports": 1})
        problems = loosenings(BASE, head, package(97.47), package(97.47))
        self.assertEqual(len(problems), 1)
        self.assertIn("src/orders.tsx", problems[0])
        self.assertIn("@typescript-eslint/no-explicit-any", problems[0])
        self.assertIn("3 -> 4", problems[0])

    def test_a_new_file_or_a_new_rule_is_refused(self):
        head = suppressions(
            orders={"@typescript-eslint/no-explicit-any": 3, "no-restricted-imports": 1, "no-restricted-syntax": 1},
            vendors={"@typescript-eslint/no-explicit-any": 1},
        )
        problems = loosenings(BASE, head, package(97.47), package(97.47))
        self.assertEqual(len(problems), 2)
        self.assertIn("new", problems[0])
        self.assertIn("src/orders.tsx no-restricted-syntax", problems[0])
        self.assertIn("new", problems[1])
        self.assertIn("src/vendors.tsx @typescript-eslint/no-explicit-any", problems[1])


class TypeCoverageThreshold(unittest.TestCase):
    def test_a_lowered_threshold_is_refused(self):
        problems = loosenings(BASE, BASE, package(97.47), package(97.2))
        self.assertEqual(len(problems), 1)
        self.assertIn("--at-least", problems[0])
        self.assertIn("97.47 -> 97.2", problems[0])

    def test_a_removed_threshold_is_refused(self):
        head_pkg = {"scripts": {"type-coverage": "type-coverage --strict"}}
        problems = loosenings(BASE, BASE, package(97.47), head_pkg)
        self.assertEqual(len(problems), 1)
        self.assertIn("--at-least", problems[0])


class Tightening(unittest.TestCase):
    def test_a_pure_shrink_and_a_raised_threshold_pass(self):
        head = suppressions(orders={"@typescript-eslint/no-explicit-any": 1})
        self.assertEqual(loosenings(BASE, head, package(97.47), package(97.6)), [])


class CommandLine(unittest.TestCase):
    """The script reads the base side with `git show <ref>:<path>` and the head side from the working tree."""

    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.repo)
        self.git("init", "-q", "-b", "base")
        self.write(BASE, package(97.47))
        self.git("add", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base")

    def git(self, *args):
        subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True)

    def write(self, supp, pkg):
        (self.repo / "frontend").mkdir(exist_ok=True)
        (self.repo / "frontend/eslint-suppressions.json").write_text(json.dumps(supp))
        (self.repo / "frontend/package.json").write_text(json.dumps(pkg))

    def run_script(self):
        return subprocess.run([sys.executable, str(SCRIPT), "--base-ref", "base", "--root", str(self.repo)],
                              capture_output=True, text=True)

    def test_a_loosened_working_tree_exits_1_and_names_the_loosening(self):
        self.write(suppressions(orders={"@typescript-eslint/no-explicit-any": 9, "no-restricted-imports": 1}),
                   package(97.47))
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("3 -> 9", result.stderr)

    def test_an_unchanged_working_tree_exits_0(self):
        self.assertEqual(self.run_script().returncode, 0)

    def test_a_deleted_suppressions_file_exits_1_and_says_so(self):
        (self.repo / "frontend/eslint-suppressions.json").unlink()
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("eslint-suppressions.json was deleted", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_no_suppressions_file_on_either_side_exits_0(self):
        self.git("rm", "-q", "frontend/eslint-suppressions.json")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "no ratchet")
        self.assertEqual(self.run_script().returncode, 0)

    def test_the_change_that_first_adds_the_ratchet_exits_0(self):
        self.git("rm", "-q", "frontend/eslint-suppressions.json")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "no ratchet")
        self.write(BASE, package(97.47))
        self.assertEqual(self.run_script().returncode, 0)


if __name__ == "__main__":
    unittest.main()
