"""Tests for frontend_ratchet_check.py: a pull request may shrink the frontend ratchet, never loosen it (#1687, #1699).

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

from frontend_ratchet_check import (  # noqa: E402
    JSON_CALLS,
    OXLINT,
    from_eslint,
    suppression_loosenings,
    threshold_loosenings,
)

SCRIPT = Path(__file__).resolve().parent / "frontend_ratchet_check.py"


def package(at_least):
    return {"scripts": {"type-coverage": f"type-coverage --strict --at-least {at_least}"}}


def suppressions(**files):
    """suppressions(a={"rule-x": 2}) -> the oxlint-suppressions.json shape for src/a.tsx."""
    return {f"src/{name}.tsx": {rule: {"count": n} for rule, n in rules.items()} for name, rules in files.items()}


BASE = suppressions(orders={"typescript/no-explicit-any": 3, "no-restricted-imports": 1})
JSON_BASE = {"src/orders.tsx": {"no-json-call": {"count": 1}}}


def loosenings(base, head, base_pkg=None, head_pkg=None):
    """Both checks over oxlint's file, as main() runs them."""
    pkgs = (base_pkg or package(97.47), head_pkg or package(97.47))
    return suppression_loosenings(OXLINT, base, head) + threshold_loosenings(*pkgs)


class Suppressions(unittest.TestCase):
    def test_a_grown_count_is_refused(self):
        head = suppressions(orders={"typescript/no-explicit-any": 4, "no-restricted-imports": 1})
        problems = loosenings(BASE, head, package(97.47), package(97.47))
        self.assertEqual(len(problems), 1)
        self.assertIn("src/orders.tsx", problems[0])
        self.assertIn("typescript/no-explicit-any", problems[0])
        self.assertIn("3 -> 4", problems[0])

    def test_a_new_file_or_a_new_rule_is_refused(self):
        head = suppressions(
            orders={"typescript/no-explicit-any": 3, "no-restricted-imports": 1, "react-hooks/rules-of-hooks": 1},
            vendors={"typescript/no-explicit-any": 1},
        )
        problems = loosenings(BASE, head, package(97.47), package(97.47))
        self.assertEqual(len(problems), 2)
        self.assertIn("new", problems[0])
        self.assertIn("src/orders.tsx react-hooks/rules-of-hooks", problems[0])
        self.assertIn("new", problems[1])
        self.assertIn("src/vendors.tsx typescript/no-explicit-any", problems[1])


class RenamedFile(unittest.TestCase):
    def test_a_renamed_file_is_still_refused_and_named_as_a_likely_rename(self):
        moved = {"src/orders/index.tsx": BASE["src/orders.tsx"]}
        problems = loosenings(BASE, moved, package(97.47), package(97.47))
        self.assertTrue(problems)
        self.assertTrue(all("new" in p for p in problems))
        self.assertTrue(any("looks like a rename of src/orders.tsx" in p for p in problems))

    def test_a_new_file_with_other_counts_gets_no_rename_hint(self):
        head = {"src/orders.tsx": BASE["src/orders.tsx"],
                "src/vendors.tsx": {"typescript/no-explicit-any": {"count": 3}}}
        problems = loosenings(BASE, head, package(97.47), package(97.47))
        self.assertEqual(len(problems), 1)
        self.assertNotIn("rename", problems[0])

    def test_a_file_already_in_base_gets_no_rename_hint(self):
        base = {**BASE, "src/vendors.tsx": {"no-restricted-imports": {"count": 1}}}
        head = {"src/vendors.tsx": {"no-restricted-imports": {"count": 1}, "react-hooks/rules-of-hooks": {"count": 1}}}
        base_gone = {**base, "src/gone.tsx": {"no-restricted-imports": {"count": 1}, "react-hooks/rules-of-hooks": {"count": 1}}}
        problems = loosenings(base_gone, head, package(97.47), package(97.47))
        self.assertEqual(len(problems), 1)
        self.assertNotIn("rename", problems[0])


class TypeCoverageThreshold(unittest.TestCase):
    def test_a_malformed_threshold_raises_a_value_error_naming_it(self):
        bad = {"scripts": {"type-coverage": "type-coverage --strict --at-least 97.4."}}
        with self.assertRaisesRegex(ValueError, "97.4."):
            loosenings(BASE, BASE, package(97.47), bad)

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
        head = suppressions(orders={"typescript/no-explicit-any": 1})
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

    def write(self, supp, pkg, json_calls=None, name=OXLINT):
        (self.repo / "frontend").mkdir(exist_ok=True)
        (self.repo / name).write_text(json.dumps(supp))
        (self.repo / JSON_CALLS).write_text(json.dumps(json_calls or JSON_BASE))
        (self.repo / "frontend/package.json").write_text(json.dumps(pkg))

    def commit(self, message):
        self.git("add", "-A", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", message)

    def run_script(self):
        return subprocess.run([sys.executable, str(SCRIPT), "--base-ref", "base", "--root", str(self.repo)],
                              capture_output=True, text=True)

    def test_a_loosened_working_tree_exits_1_and_names_the_loosening(self):
        self.write(suppressions(orders={"typescript/no-explicit-any": 9, "no-restricted-imports": 1}),
                   package(97.47))
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("3 -> 9", result.stderr)

    def test_a_malformed_threshold_exits_1_and_names_the_value(self):
        self.write(BASE, {"scripts": {"type-coverage": "type-coverage --strict --at-least 97.4."}})
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("97.4.", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_a_commit_sha_is_accepted_as_the_base_ref(self):
        sha = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "HEAD"],
                             capture_output=True, text=True, check=True).stdout.strip()
        result = subprocess.run([sys.executable, str(SCRIPT), "--base-ref", sha, "--root", str(self.repo)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_an_unchanged_working_tree_exits_0(self):
        self.assertEqual(self.run_script().returncode, 0)

    def test_a_deleted_suppressions_file_exits_1_and_says_so(self):
        for name in (OXLINT, JSON_CALLS):
            with self.subTest(name):
                self.write(BASE, package(97.47))
                (self.repo / name).unlink()
                result = self.run_script()
                self.assertEqual(result.returncode, 1)
                self.assertIn(f"{name} was deleted", result.stderr)
                self.assertNotIn("Traceback", result.stderr)

    def test_a_grown_json_call_count_exits_1(self):
        self.write(BASE, package(97.47), json_calls={"src/orders.tsx": {"no-json-call": {"count": 2}}})
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("src/orders.tsx no-json-call rose 1 -> 2", result.stderr)

    def test_no_suppressions_file_on_either_side_exits_0(self):
        self.git("rm", "-q", OXLINT, JSON_CALLS)
        self.commit("no ratchet")
        self.assertEqual(self.run_script().returncode, 0)

    def test_the_change_that_first_adds_the_ratchet_exits_0(self):
        self.git("rm", "-q", OXLINT, JSON_CALLS)
        self.commit("no ratchet")
        self.write(BASE, package(97.47))
        self.assertEqual(self.run_script().returncode, 0)

    def test_the_switch_from_eslint_is_held_to_eslints_counts(self):
        self.git("rm", "-q", OXLINT, JSON_CALLS)
        eslint = {"src/orders.tsx": {"@typescript-eslint/no-explicit-any": {"count": 3},
                                     "no-restricted-imports": {"count": 1}, "no-restricted-syntax": {"count": 1}}}
        (self.repo / "frontend/eslint-suppressions.json").write_text(json.dumps(eslint))
        self.commit("eslint ratchet")
        (self.repo / "frontend/eslint-suppressions.json").unlink()
        self.write(BASE, package(97.47))
        self.assertEqual(self.run_script().returncode, 0, self.run_script().stderr)
        self.write(BASE, package(97.47), json_calls={"src/orders.tsx": {"no-json-call": {"count": 2}},
                                                      "src/new.tsx": {"no-json-call": {"count": 1}}})
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("rose 1 -> 2", result.stderr)
        self.assertIn("src/new.tsx no-json-call is new", result.stderr)


if __name__ == "__main__":
    unittest.main()
