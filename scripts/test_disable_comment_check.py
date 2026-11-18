"""Tests for residence check D1 (scripts/disable_comment_check.py, #1705): lint disable comments frozen per file.

Stdlib only, plus node and frontend/node_modules for D1's parser:  python3 -m unittest scripts.test_disable_comment_check
"""

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from disable_comment_check import (  # noqa: E402
    EVERY_RULE,
    FILE_WIDE,
    disable_comment_sources,
    disable_comment_texts,
    disable_counts,
    disable_directive,
    ignored_by,
    override_glob_matches,
    rules_the_config_turns_on,
)
from oxlint_settings_check import parse_jsonc  # noqa: E402
from residence_check import main  # noqa: E402

REPO = Path(__file__).resolve().parent.parent


class DisableComments(unittest.TestCase):
    """D1 (#1705): a disable comment that can switch off an ADR-0049 rule is frozen per file and rule.

    The forms were measured on oxlint 1.94 (the report of box/disable-ratchet-1705 lists each probe)."""

    def test_reads_the_rules_a_disable_comment_names(self):
        self.assertEqual(disable_directive("// eslint-disable-next-line @typescript-eslint/no-explicit-any"),
                         ["@typescript-eslint/no-explicit-any"])
        self.assertEqual(disable_directive("// oxlint-disable-next-line typescript/no-explicit-any"),
                         ["typescript/no-explicit-any"])
        self.assertEqual(disable_directive("/* eslint-disable-line a, b */"), ["a", "b"])
        self.assertEqual(disable_directive("//\teslint-disable-next-line\tx y"), ["x", "y"])
        self.assertEqual(disable_directive("/* eslint-disable-next-line\n   x */"), ["x"])
        self.assertEqual(disable_directive("/*eslint-disable-next-line x*/"), ["x"])
        self.assertEqual(disable_directive("// eslint-disable-next-line ,x,,y"), ["x", "y"])

    def test_a_reason_after_two_dashes_names_no_rule(self):
        self.assertEqual(disable_directive("// eslint-disable-next-line x -- why, y"), ["x"])
        self.assertEqual(disable_directive("// eslint-disable-next-line x--y"), ["x"])
        self.assertEqual(disable_directive("// eslint-disable-next-line react-hooks/exhaustive-deps --x"),
                         ["react-hooks/exhaustive-deps"])

    def test_a_comment_that_names_no_rule_disables_every_rule(self):
        for text in ("/* eslint-disable */", "// eslint-disable", "/*eslint-disable*/", "// oxlint-disable-line",
                     "// eslint-disable-next-line", "// eslint-disable-next-line -- a reason only"):
            self.assertEqual(disable_directive(text), [], text)

    def test_text_oxlint_does_not_read_as_a_directive_is_none(self):
        for text in ("// ESLINT-DISABLE-NEXT-LINE x", "// a note eslint-disable-next-line x", "/** eslint-disable */",
                     "/*\n * eslint-disable\n */", "// eslint-disablefoo", "// eslint-disable-next-linex",
                     "// eslint-disable-next-line: x", "// eslint-enable x", "// a plain comment"):
            self.assertIsNone(disable_directive(text), text)

    def test_the_counted_rules_are_every_rule_the_config_turns_on(self):
        config = {"categories": {"correctness": "off"},
                  "rules": {"typescript/no-explicit-any": "error", "no-console": "off", "eqeqeq": ["warn"]},
                  "overrides": [{"files": ["a/**"], "rules": {"typescript/no-unsafe-call": "error"}},
                                {"files": ["b.ts"], "rules": {"no-restricted-imports": "off"}}]}
        self.assertEqual(rules_the_config_turns_on(config), {"no-explicit-any": "typescript/no-explicit-any",
                                                 "eqeqeq": "eqeqeq", "no-unsafe-call": "typescript/no-unsafe-call"})

    def test_the_real_config_counts_its_rules_and_not_exhaustive_deps(self):
        rules = rules_the_config_turns_on(parse_jsonc((REPO / "frontend/.oxlintrc.json").read_text()))
        for name in ("no-explicit-any", "use-unknown-in-catch-callback-variable", "rules-of-hooks",
                     "no-restricted-imports", "no-restricted-properties", "no-unsafe-assignment"):
            self.assertIn(name, rules)
        self.assertNotIn("exhaustive-deps", rules)

    def test_a_category_switched_on_is_refused_its_rules_cannot_be_listed(self):
        with self.assertRaisesRegex(ValueError, "suspicious"):
            rules_the_config_turns_on({"categories": {"suspicious": "error"}})

    def test_counts_per_file_and_rule_under_any_alias_and_comments_naming_no_rule(self):
        rules = {"rules": {"typescript/no-explicit-any": "error", "react/rules-of-hooks": "error"}}
        comments = {
            "src/a.ts": ["// eslint-disable-next-line @typescript-eslint/no-explicit-any -- why",
                         "// oxlint-disable-next-line typescript/no-explicit-any",
                         "// eslint-disable-next-line no-explicit-any, @typescript-eslint/no-explicit-any",
                         "// eslint-disable-next-line react-hooks/rules-of-hooks",
                         "// eslint-disable-line"],
            "src/b.tsx": ["// eslint-disable-next-line react-hooks/exhaustive-deps", "// a note", "/** eslint-disable */"],
        }
        self.assertEqual(disable_counts(comments, rules), {
            "src/a.ts": {"typescript/no-explicit-any": {"count": 3}, "react/rules-of-hooks": {"count": 1},
                         EVERY_RULE: {"count": 1}},
        })

    def test_a_file_wide_comment_counts_apart_from_a_line_comment_for_the_same_rule(self):
        rules = {"rules": {"typescript/no-explicit-any": "error"}}
        comments = {"src/a.ts": ["// eslint-disable-next-line typescript/no-explicit-any",
                                 "/* eslint-disable @typescript-eslint/no-explicit-any */",
                                 "// oxlint-disable no-explicit-any -- why", "/* eslint-disable */",
                                 "// eslint-disable-next-line"]}
        self.assertEqual(disable_counts(comments, rules), {"src/a.ts": {
            "typescript/no-explicit-any": {"count": 1}, f"typescript/no-explicit-any{FILE_WIDE}": {"count": 2},
            EVERY_RULE: {"count": 1}, f"{EVERY_RULE}{FILE_WIDE}": {"count": 1}}})

    CONFIG = {"rules": {"typescript/no-explicit-any": "error", "no-restricted-imports": "error"},
              "overrides": [{"files": ["src/pages/customers/**/*.{ts,tsx}"],
                             "rules": {"typescript/no-unsafe-call": "error"}},
                            {"files": ["src/lib/frappe.ts"], "rules": {"no-restricted-imports": "off"}}]}

    def test_a_rule_on_only_in_an_override_counts_only_in_the_files_it_matches(self):
        unsafe = ["// eslint-disable-next-line @typescript-eslint/no-unsafe-call"]
        counts = disable_counts({"src/pages/customers/a.tsx": unsafe, "src/pages/customers/x/b.ts": unsafe,
                                 "src/pages/other/c.tsx": unsafe, "src/pages/customers/d.js": unsafe}, self.CONFIG)
        self.assertEqual(sorted(counts), ["src/pages/customers/a.tsx", "src/pages/customers/x/b.ts"])

    def test_a_rule_an_override_turns_off_counts_only_where_it_is_on(self):
        imports = ["// eslint-disable-next-line no-restricted-imports"]
        self.assertEqual(disable_counts({"src/lib/frappe.ts": imports, "src/lib/other.ts": imports}, self.CONFIG),
                         {"src/lib/other.ts": {"no-restricted-imports": {"count": 1}}})

    def test_an_override_glob_matches_as_oxlint_does(self):
        # Measured on oxlint 1.94: an override whose `files` holds the glob switched a rule on in these files only.
        files = ["src/x.ts", "src/x.tsx", "src/a/y.ts", "src/a/b/z.ts", "src/a/b/c/w.tsx", "src/ab/v.ts", "src/a1.ts",
                 "src/a/b/z.js"]
        measured = {
            "*.ts": ["src/a/b/z.ts", "src/a/y.ts", "src/a1.ts", "src/ab/v.ts", "src/x.ts"],
            "src/*.ts": ["src/a1.ts", "src/x.ts"],
            "src/a/**": ["src/a/b/c/w.tsx", "src/a/b/z.js", "src/a/b/z.ts", "src/a/y.ts"],
            "./src/a/**": ["src/a/b/c/w.tsx", "src/a/b/z.js", "src/a/b/z.ts", "src/a/y.ts"],
            "src/a/**/*.ts": ["src/a/b/z.ts", "src/a/y.ts"],
            "src/a/b/**/*.{ts,tsx}": ["src/a/b/c/w.tsx", "src/a/b/z.ts"],
            "**/*.{ts,tsx}": ["src/a/b/c/w.tsx", "src/a/b/z.ts", "src/a/y.ts", "src/a1.ts", "src/ab/v.ts", "src/x.ts",
                              "src/x.tsx"],
            "**/z.ts": ["src/a/b/z.ts"], "z.ts": ["src/a/b/z.ts"], "src/a?.ts": ["src/a1.ts"],
            "src/[a]1.ts": ["src/a1.ts"], "src/a/": [], "a/**": [], "src/a": [], "src/!(x).ts": [],
        }
        for glob, matched in measured.items():
            self.assertEqual([f for f in sorted(files) if override_glob_matches(glob, f)], matched, glob)

    def test_an_ignore_pattern_matches_as_oxlint_does(self):
        # Measured on oxlint 1.94 over the same files: `ignorePatterns: [pattern]` left these linted.
        files = ["src/x.ts", "src/x.tsx", "src/a/y.ts", "src/a/b/z.ts", "src/a/b/c/w.tsx", "src/ab/v.ts", "src/a1.ts",
                 "src/a/b/z.js"]
        outside_a = ["src/a1.ts", "src/ab/v.ts", "src/x.ts", "src/x.tsx"]
        measured = {
            "*.ts": ["src/a/b/c/w.tsx", "src/a/b/z.js", "src/x.tsx"],
            "src/*.ts": ["src/a/b/c/w.tsx", "src/a/b/z.js", "src/a/b/z.ts", "src/a/y.ts", "src/ab/v.ts", "src/x.tsx"],
            "src/a/**": outside_a, "a": outside_a, "src/a": outside_a, "src/a/": outside_a, "/src/a": outside_a,
            "b": ["src/a/y.ts", "src/a1.ts", "src/ab/v.ts", "src/x.ts", "src/x.tsx"],
            "src/**/*.tsx": ["src/a/b/z.js", "src/a/b/z.ts", "src/a/y.ts", "src/a1.ts", "src/ab/v.ts", "src/x.ts"],
            "z.ts": ["src/a/b/c/w.tsx", "src/a/b/z.js", "src/a/y.ts", "src/a1.ts", "src/ab/v.ts", "src/x.ts",
                     "src/x.tsx"],
            "!src/a/y.ts": sorted(files),
            "src/a/**/*.ts": ["src/a/b/c/w.tsx", "src/a/b/z.js", "src/a1.ts", "src/ab/v.ts", "src/x.ts", "src/x.tsx"],
        }
        for pattern, linted in measured.items():
            self.assertEqual([f for f in sorted(files) if not ignored_by([pattern], f)], linted, pattern)

    def test_globs_and_ignore_patterns_read_names_braces_and_negations_as_oxlint_does(self):
        # Measured on oxlint 1.94 (review of #1705's fix round).
        files = ["src/a.test.ts", "src/a1.ts", "src/b.ts", "src/gen/keep.ts", "src/gen/other.ts", "src/x/y/c.ts",
                 "src/xqy.ts"]
        for glob, matched in {"src/x[!a]y.ts": ["src/xqy.ts"], "src/x**.ts": ["src/xqy.ts"],
                              "src/{a1,{b,xqy}}.ts": ["src/a1.ts", "src/b.ts", "src/xqy.ts"]}.items():
            self.assertEqual([f for f in files if override_glob_matches(glob, f)], matched, glob)
        everything_but = lambda *gone: [f for f in files if f not in gone]  # noqa: E731
        for patterns, linted in {("*.test.ts", "!src/"): everything_but("src/a.test.ts"),
                                 ("src/gen/", "!src/gen/keep.ts"): everything_but("src/gen/other.ts"),
                                 ("src/gen/*", "!src/gen/keep.ts"): everything_but("src/gen/other.ts"),
                                 ("src/x**.ts",): everything_but("src/xqy.ts")}.items():
            self.assertEqual([f for f in files if not ignored_by(list(patterns), f)], linted, patterns)

    def test_an_override_skips_the_files_its_exclude_files_match(self):
        # Measured on oxlint 1.94: excludeFiles reads globs as `files` does.
        config = {"overrides": [{"files": ["src/**/*.ts"], "excludeFiles": ["src/gen/**", "*.test.ts"],
                                 "rules": {"typescript/no-explicit-any": "error"}}]}
        comment = ["// eslint-disable-next-line typescript/no-explicit-any"]
        counts = disable_counts({"src/a.ts": comment, "src/gen/b.ts": comment, "src/x/c.test.ts": comment}, config)
        self.assertEqual(sorted(counts), ["src/a.ts"])

    def test_a_file_the_config_ignores_is_not_read(self):
        root = self.frontend_tree({"src/components/ui/button.tsx": self.DISABLE, "src/components/b.tsx": self.DISABLE})
        self.assertEqual(sorted(disable_comment_sources(root)[0]), ["src/components/b.tsx"])

    def comments(self, src, path="src/a.ts"):
        return disable_comment_texts({path: src})[path]

    def test_reads_the_comments_that_may_hold_a_directive_and_not_strings_templates_regexes_or_jsx_text(self):
        src = ('#!/usr/bin/env node\n// eslint-disable\n'
               'const s = "// eslint-disable-next-line";\n'
               'const t = `\n// eslint-disable-next-line\n${1 /* eslint-disable-line a */}`;\n'
               'const r = /\\/\\/ eslint-disable/;\n'
               'const a: any = 1; // eslint-disable-line b\n'
               '/* eslint-disable-next-line\n c */\nexport {};\n// eslint-disable-next-line d\n')
        self.assertEqual(self.comments(src), ["// eslint-disable", "/* eslint-disable-line a */",
                                              "// eslint-disable-line b", "/* eslint-disable-next-line\n c */",
                                              "// eslint-disable-next-line d"])

    def test_reads_a_comment_inside_jsx_braces_but_not_jsx_text(self):
        src = ("export const C = () => (<div>// eslint-disable-next-line x\n"
               "  {/* eslint-disable-next-line y */}\n  <b title=\"// eslint-disable z\" />\n</div>);\n")
        self.assertEqual(self.comments(src, "src/c.tsx"), ["/* eslint-disable-next-line y */"])

    def test_reads_js_and_jsx_files_as_jsx_and_mts_cts_files_as_typescript(self):
        jsx = ("export const C = () => (<div>// eslint-disable-next-line x\n"
               "  {/* eslint-disable-next-line y */}\n</div>);\n")
        for path in ("src/c.jsx", "src/c.js", "src/c.mjs", "src/c.cjs"):
            self.assertEqual(self.comments(jsx, path), ["/* eslint-disable-next-line y */"], path)
        ts = "const a = <T,>(x: T): T => x; // eslint-disable-line z\n"
        for path in ("src/c.mts", "src/c.cts"):
            self.assertEqual(self.comments(ts, path), ["// eslint-disable-line z"], path)

    def frontend_tree(self, files):
        """A made-up frontend/ folder in git, holding ``files`` ({path: text}), with the real oxlint config."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        files = {".oxlintrc.json": (REPO / "frontend/.oxlintrc.json").read_text(), **files}
        for path, text in files.items():
            (root / path).parent.mkdir(parents=True, exist_ok=True)
            (root / path).write_text(text)
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        return root

    DISABLE = "// eslint-disable-next-line typescript/no-explicit-any\nexport const a: any = 1;\n"

    def test_reads_every_file_type_oxlint_lints(self):
        # Measured on oxlint 1.94 (`oxlint src`): it lints these, and not .css, .json, .md or .html.
        linted = ["src/f.ts", "src/f.tsx", "src/f.mts", "src/f.cts", "src/f.js", "src/f.jsx", "src/f.mjs",
                  "src/f.cjs", "src/f.d.ts"]
        root = self.frontend_tree({p: self.DISABLE for p in linted + ["src/f.css", "src/f.json", "src/f.md",
                                                                       "src/f.html"]})
        sources, unreadable = disable_comment_sources(root)
        self.assertEqual(sorted(sources), sorted(linted))
        self.assertEqual(unreadable, [])

    def test_skips_only_the_files_git_ignores_as_oxlint_does(self):
        # Measured on oxlint 1.94: it lints folders named public, dist, node_modules or hidden ones unless a
        # .gitignore names them, and skips a git-ignored file even when it was added with `git add -f`.
        read = ["src/a/public/p.ts", "src/dist/d.ts", "src/node_modules/n.ts", "src/.hidden/h.ts", "src/untracked.ts"]
        ignored = ["src/gen/g.ts", "src/forced.gen.ts"]
        root = self.frontend_tree({".gitignore": "gen/\n*.gen.ts\n", **{p: self.DISABLE for p in read + ignored}})
        git = ["git", "-C", str(root), "-c", "user.name=x", "-c", "user.email=x@example.invalid"]
        subprocess.run([*git, "add", "-f", "src/forced.gen.ts", "src/a/public/p.ts"], check=True)
        subprocess.run([*git, "commit", "-qm", "x"], check=True)
        self.assertEqual(sorted(disable_comment_sources(root)[0]), sorted(read))

    def test_a_vue_svelte_or_astro_file_holding_disable_text_is_unreadable(self):
        # oxlint lints their script blocks; D1's TypeScript parser cannot read them, so each is a finding.
        root = self.frontend_tree({"src/f.vue": "<script>// eslint-disable</script>", "src/f.svelte": "",
                                   "src/f.astro": "---\n// oxlint-disable\n---\n"})
        self.assertEqual(disable_comment_sources(root)[1], ["src/f.astro", "src/f.vue"])

    def frozen_file(self, frozen):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "frozen.json"
        path.write_text(json.dumps(frozen))
        patcher = mock.patch("disable_comment_check.DISABLE_SUPPRESSIONS", str(path))
        patcher.start()
        self.addCleanup(patcher.stop)
        return path

    def run_d1(self, comments, frozen, *argv):
        path = self.frozen_file(frozen)
        out = io.StringIO()
        with mock.patch("disable_comment_check.disable_comment_texts", return_value=comments), redirect_stdout(out):
            rc = main([*argv] if argv[-1] == "--prune-disable-comments" else [*argv, "--only", "D1"])
        return rc, out.getvalue(), json.loads(path.read_text())

    ANY = "// eslint-disable-next-line @typescript-eslint/no-explicit-any"
    FROZEN = {"src/a.ts": {"typescript/no-explicit-any": {"count": 1}},
              "src/b.ts": {"typescript/no-explicit-any": {"count": 1}}}

    def test_a_new_disable_comment_fails_naming_the_file_and_rule_even_where_another_file_lost_one(self):
        rc, out, _ = self.run_d1({"src/a.ts": [self.ANY, "// oxlint-disable-next-line typescript/no-explicit-any"],
                                  "src/b.ts": []}, self.FROZEN, "--check")
        self.assertEqual(rc, 1, out)
        self.assertIn("frontend/src/a.ts: 2 disable comments for typescript/no-explicit-any, 1 frozen", out)

    def test_a_file_wide_disable_comment_fails(self):
        rc, out, _ = self.run_d1({"src/a.ts": [self.ANY], "src/b.ts": [self.ANY], "src/c.ts": ["/* eslint-disable */"]},
                                 self.FROZEN, "--check")
        self.assertEqual(rc, 1, out)
        self.assertIn(f"frontend/src/c.ts: 1 disable comments for {EVERY_RULE}{FILE_WIDE} (names no rule), 0 frozen",
                      out)

    def test_a_frozen_line_comment_widened_to_the_whole_file_fails(self):
        rc, out, _ = self.run_d1({"src/a.ts": ["/* eslint-disable @typescript-eslint/no-explicit-any */"],
                                  "src/b.ts": [self.ANY]}, self.FROZEN, "--check")
        self.assertEqual(rc, 1, out)
        self.assertIn(f"frontend/src/a.ts: 1 disable comments for typescript/no-explicit-any{FILE_WIDE}, 0 frozen", out)

    def test_a_new_exhaustive_deps_comment_passes(self):
        rc, out, _ = self.run_d1({"src/a.ts": [self.ANY, "// eslint-disable-next-line react-hooks/exhaustive-deps"],
                                  "src/b.ts": [self.ANY]}, self.FROZEN, "--check")
        self.assertEqual(rc, 0, out)

    def test_a_removed_comment_without_its_count_lowered_fails_and_names_the_flag(self):
        rc, out, after = self.run_d1({"src/a.ts": [self.ANY]}, self.FROZEN, "--check")
        self.assertEqual(rc, 1, out)
        self.assertIn("frontend/src/b.ts: 0 disable comments for typescript/no-explicit-any, 1 frozen", out)
        self.assertIn("--prune-disable-comments", out)
        self.assertEqual(after, self.FROZEN)

    def test_a_removed_comment_with_its_count_lowered_passes(self):
        rc, out, _ = self.run_d1({"src/a.ts": [self.ANY]},
                                 {"src/a.ts": {"typescript/no-explicit-any": {"count": 1}}}, "--check")
        self.assertEqual(rc, 0, out)

    def test_prune_lowers_the_frozen_counts_and_drops_empty_files(self):
        rc, out, after = self.run_d1({"src/a.ts": [self.ANY]}, self.FROZEN, "--prune-disable-comments")
        self.assertEqual(rc, 0, out)
        self.assertEqual(after, {"src/a.ts": {"typescript/no-explicit-any": {"count": 1}}})

    def test_prune_runs_alone_and_never_with_check(self):
        rc, _, after = self.run_d1({"src/a.ts": [self.ANY]}, self.FROZEN, "--check", "--prune-disable-comments")
        self.assertEqual(rc, 2)
        self.assertEqual(after, self.FROZEN)

    def test_prune_never_raises_a_count(self):
        rc, out, after = self.run_d1({"src/a.ts": [self.ANY, self.ANY], "src/b.ts": [self.ANY]}, self.FROZEN,
                                     "--prune-disable-comments")
        self.assertEqual(rc, 1, out)
        self.assertEqual(after, self.FROZEN)

    def path_without_node(self):
        """A PATH holding git and no node: D1 lists the files with git, then cannot parse them."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        os.symlink(shutil.which("git"), Path(tmp.name) / "git")
        return tmp.name

    def test_in_the_commit_hook_d1_warns_and_passes_when_node_is_missing(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"PATH": self.path_without_node()}), redirect_stdout(out):
            rc = main(["--hook", "--only", "D1"])
        self.assertEqual(rc, 0, out.getvalue())
        self.assertIn("⚠ D1 skipped: node could not run", out.getvalue())

    def test_d1_fails_when_node_is_missing_outside_the_hook(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"PATH": self.path_without_node()}), redirect_stdout(out):
            rc = main(["--check", "--only", "D1"])
        self.assertEqual(rc, 1, out.getvalue())

    def test_the_real_tree_holds_its_frozen_counts(self):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = main(["--check", "--only", "D1"])
        self.assertEqual(rc, 0, out.getvalue())


if __name__ == "__main__":
    unittest.main()
