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
    suppression_loosenings,
    threshold_loosenings,
)
from oxlint_settings_check import CONFIG  # noqa: E402

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


class GitRepo:
    """A temporary git repo (self.repo) and the script run on it with --base-ref base. Mixed into a TestCase."""

    def git(self, *args):
        subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True)

    def commit(self, message):
        """Commit everything in the working tree, as a made-up author (a CI runner has no git identity)."""
        self.git("add", "-A", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", message)

    def run_script(self):
        return subprocess.run([sys.executable, str(SCRIPT), "--base-ref", "base", "--root", str(self.repo)],
                              capture_output=True, text=True)


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


class CommandLine(GitRepo, unittest.TestCase):
    """The script reads the base side with `git show <ref>:<path>` and the head side from the working tree."""

    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.repo)
        self.git("init", "-q", "-b", "base")
        self.write(BASE, package(97.47))
        self.commit("base")

    def write(self, supp, pkg, json_calls=None, name=OXLINT):
        (self.repo / "frontend").mkdir(exist_ok=True)
        (self.repo / name).write_text(json.dumps(supp))
        (self.repo / JSON_CALLS).write_text(json.dumps(json_calls or JSON_BASE))
        (self.repo / "frontend/package.json").write_text(json.dumps(pkg))

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


# The lint settings (#1702): a made-up config in .oxlintrc.json's shape, with JSONC comments and a trailing comma.
CONFIG_TEXT = """{
  // the frontend's type ratchet
  "plugins": ["eslint", "typescript", "react"],
  "categories": {"correctness": "off"},
  "ignorePatterns": ["src/components/ui/**"],
  "rules": {
    "typescript/no-explicit-any": "error",
    "react/rules-of-hooks": "error", /* a block comment */
    "no-restricted-imports": ["error", {"paths": [{"name": "sdk-lib", "message": "Use '@/lib/sdk' // not this"}]}],
  },
  "overrides": [
    {
      "files": ["src/pages/orders/**/*.{ts,tsx}"],
      "rules": {"typescript/no-unsafe-call": "error", "typescript/no-unsafe-return": "error"}
    },
    {"files": ["src/lib/sdk.ts"], "rules": {"no-restricted-imports": "off"}}
  ]
}
"""
LINT_PACKAGE = {"scripts": {"lint": "oxlint --type-aware src",
                            "type-coverage": "type-coverage --strict --at-least 97.47"}}
BASELINE = {"s1_oversized_files": {"count": 3, "rule": "S1", "description": "big files"},
            "b3_workflow_state_writers": {"count": 5, "rule": "B3", "description": "local only"}}


class LintRepo(GitRepo):
    """A git repo with a made-up frontend at commit `base`; the test edits the working tree and runs the script.

    Mixed into a unittest.TestCase (here and in test_oxlint_settings_check.py).
    """

    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.repo)
        self.git("init", "-q", "-b", "base")
        (self.repo / "frontend/src/pages/orders").mkdir(parents=True)
        (self.repo / "scripts").mkdir()
        (self.repo / OXLINT).write_text(json.dumps(BASE))
        (self.repo / JSON_CALLS).write_text(json.dumps(JSON_BASE))
        self.config(CONFIG_TEXT)
        self.package(LINT_PACKAGE)
        self.baseline(BASELINE)
        self.commit("base")

    def config(self, text, where=CONFIG):
        (self.repo / where).write_text(text)

    def edit_config(self, old, new):
        text = (self.repo / CONFIG).read_text()
        self.assertIn(old, text)
        self.config(text.replace(old, new))

    def package(self, pkg):
        (self.repo / "frontend/package.json").write_text(json.dumps(pkg))

    def lint_script(self, script):
        """frontend/package.json with LINT_PACKAGE's scripts, its `lint` script set to <script>."""
        self.package({"scripts": {**LINT_PACKAGE["scripts"], "lint": script}})

    def baseline(self, data):
        (self.repo / "scripts/residence_baseline.json").write_text(json.dumps(data))

    def refused(self, *named):
        result = self.run_script()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        for words in named:
            self.assertIn(words, result.stderr)

    def passes(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class LintSettings(LintRepo, unittest.TestCase):
    """A PR that weakens the lint itself, without touching a suppressions file, is refused, naming the loosening."""

    def test_a_nested_config_anywhere_under_frontend_is_refused(self):
        for name in (".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts"):
            with self.subTest(name):
                nested = self.repo / "frontend/src/pages/orders" / name
                nested.write_text('{"rules": {"typescript/no-explicit-any": "off"}}')
                self.refused(f"frontend/src/pages/orders/{name}")
                nested.unlink()

    def test_a_nested_config_in_a_folder_whose_name_only_ends_in_node_modules_is_refused(self):
        nested = self.repo / "frontend/src/pages/old_node_modules/.oxlintrc.json"
        nested.parent.mkdir()
        nested.write_text('{"rules": {"typescript/no-explicit-any": "off"}}')
        self.refused("frontend/src/pages/old_node_modules/.oxlintrc.json")

    def test_a_config_inside_an_installed_package_in_node_modules_passes(self):
        # oxlint never walks into a node_modules folder, so a package's own config there changes nothing.
        packaged = self.repo / "frontend/node_modules/some-pkg/.oxlintrc.json"
        packaged.parent.mkdir(parents=True)
        packaged.write_text('{"rules": {"typescript/no-explicit-any": "off"}}')
        self.passes()

    def test_an_eslintignore_or_a_gitignore_that_hides_a_linted_file_is_refused(self):
        (self.repo / "frontend/src/pages/orders/list.tsx").write_text("export {};\n")
        self.commit("a page")
        (self.repo / "frontend/.eslintignore").write_text("src/pages/\n")
        self.refused("frontend/.eslintignore")
        (self.repo / "frontend/.eslintignore").unlink()
        (self.repo / "frontend/src/pages/.gitignore").write_text("orders/\n")
        self.refused("frontend/src/pages/orders/list.tsx", "gitignore")

    def test_a_narrowed_lint_script_is_refused(self):
        for script, named in [("oxlint --type-aware src/pages", "drops src"),
                              ("oxlint src", "drops --type-aware"),
                              ("oxlint --type-aware -A no-explicit-any src", "adds -A"),
                              ("oxlint --type-aware --ignore-pattern=src/pages src", "adds --ignore-pattern=src/pages"),
                              ("oxlint --type-aware src || true", "adds ||"),
                              ("oxlint --type-aware --disable-nested-config -c loose.json src", "-c loose.json")]:
            with self.subTest(script):
                self.lint_script(script)
                self.refused("lint script", named)

    def test_a_removed_lint_script_or_a_new_prelint_is_refused(self):
        self.package({"scripts": {"type-coverage": LINT_PACKAGE["scripts"]["type-coverage"]}})
        self.refused("lint script was removed")
        self.package({"scripts": {**LINT_PACKAGE["scripts"], "prelint": "cp loose.json .oxlintrc.json"}})
        self.refused("prelint")

    def test_a_lint_script_that_denies_warnings_too_passes(self):
        self.lint_script("oxlint --type-aware --deny-warnings src")
        self.passes()

    def test_a_lint_script_that_sets_max_warnings_to_0_either_way_passes(self):
        for flag in ("--max-warnings=0", "--max-warnings 0"):
            with self.subTest(flag):
                self.lint_script(f"oxlint --type-aware {flag} src")
                self.passes()

    def test_the_lint_path_written_as_dot_src_or_src_slash_passes(self):
        for script in ("oxlint --type-aware ./src", "oxlint --type-aware src/", "oxlint --type-aware ./src/"):
            with self.subTest(script):
                self.lint_script(script)
                self.passes()

    def test_a_narrower_lint_path_written_with_dot_or_slash_is_refused(self):
        for script in ("oxlint --type-aware ./src/pages", "oxlint --type-aware src/pages/"):
            with self.subTest(script):
                self.lint_script(script)
                self.refused("lint script", "drops src")

    def test_a_lint_script_that_allows_warnings_is_refused(self):
        self.lint_script("oxlint --type-aware --max-warnings 5 src")
        self.refused("lint script", "--max-warnings")

    def test_a_raised_residence_baseline_entry_that_ci_reads_is_refused(self):
        self.baseline({**BASELINE, "s1_oversized_files": {**BASELINE["s1_oversized_files"], "count": 4}})
        self.refused("scripts/residence_baseline.json", "s1_oversized_files", "3 -> 4")

    def test_a_lowered_ci_entry_or_a_raised_local_only_entry_passes(self):
        # B3 is an ADR-0010 rule: CI does not run it, so its entry is the commit hook's to tighten.
        self.baseline({"s1_oversized_files": {**BASELINE["s1_oversized_files"], "count": 2},
                       "b3_workflow_state_writers": {**BASELINE["b3_workflow_state_writers"], "count": 6}})
        self.passes()

    def test_a_lint_script_word_dropped_once_of_two_is_refused(self):
        self.lint_script("oxlint --type-aware src src/pages")
        self.commit("two paths")
        self.lint_script("oxlint --type-aware src src")
        self.refused("drops src/pages")
        self.lint_script("oxlint --type-aware src/pages src/pages")
        self.refused("drops src")


if __name__ == "__main__":
    unittest.main()
