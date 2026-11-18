"""Tests for oxlint_settings_check.py: a PR may tighten frontend/.oxlintrc.json, never loosen it (#1702).

Each test edits the config of a made-up repo and runs frontend_ratchet_check.py, which CI runs (the same main()).
Stdlib only:  python3 -m unittest scripts.test_oxlint_settings_check
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from frontend_ratchet_check import OXLINT  # noqa: E402
from test_frontend_ratchet_check import CONFIG_TEXT, LintRepo, suppressions  # noqa: E402


class OxlintSettings(LintRepo, unittest.TestCase):
    """A PR that weakens .oxlintrc.json is refused, naming the loosening; a tightening passes."""

    def test_a_rule_set_to_warn_is_refused(self):
        self.edit_config('"typescript/no-explicit-any": "error"', '"typescript/no-explicit-any": "warn"')
        self.refused("typescript/no-explicit-any", "warn")

    def test_a_rule_turned_off_or_removed_is_refused(self):
        self.edit_config('"react/rules-of-hooks": "error",', '"react/rules-of-hooks": "off",')
        self.refused("react/rules-of-hooks", "off")
        self.edit_config('"react/rules-of-hooks": "off",', '')
        self.refused("react/rules-of-hooks", "removed")

    def test_a_ban_list_entry_dropped_is_refused(self):
        self.edit_config('{"paths": [{"name": "sdk-lib", "message": "Use \'@/lib/sdk\' // not this"}]}', '{"paths": []}')
        self.refused("no-restricted-imports", "options")

    def test_a_ban_list_emptied_by_a_new_negated_entry_is_refused(self):
        # oxlint reads a `!` entry as "but not these": ["sdk-lib/*", "!sdk-lib/**"] bans nothing.
        self.edit_config('{"paths": [{"name": "sdk-lib", "message": "Use \'@/lib/sdk\' // not this"}]}',
                         '{"paths": [{"name": "sdk-lib", "message": "Use \'@/lib/sdk\' // not this"}], '
                         '"patterns": [{"group": ["sdk-lib/*"], "message": "Use \'@/lib/sdk\'"}]}')
        self.commit("ban sdk-lib's subpaths")
        self.edit_config('"group": ["sdk-lib/*"]', '"group": ["sdk-lib/*", "!sdk-lib/**"]')
        self.refused("no-restricted-imports", "options")

    def test_a_negated_entry_in_a_new_ban_group_is_refused(self):
        # oxlint lets a `!` in one group lift another group's ban.
        self.edit_config('{"paths": [{"name": "sdk-lib", "message": "Use \'@/lib/sdk\' // not this"}]}',
                         '{"patterns": [{"group": ["sdk-lib/*"]}]}')
        self.commit("ban sdk-lib's subpaths")
        self.edit_config('[{"group": ["sdk-lib/*"]}]', '[{"group": ["sdk-lib/*"]}, {"group": ["!sdk-lib/a"]}]')
        self.refused("no-restricted-imports", "options")

    def test_a_negated_ban_entry_moved_after_the_entry_it_undoes_is_refused(self):
        # The last entry that matches wins: ["!sdk-lib/a", "sdk-lib/*"] bans sdk-lib/a, the reverse does not.
        self.edit_config('{"paths": [{"name": "sdk-lib", "message": "Use \'@/lib/sdk\' // not this"}]}',
                         '{"patterns": [{"group": ["!sdk-lib/a", "sdk-lib/*"]}]}')
        self.commit("ban all of sdk-lib's subpaths")
        self.edit_config('"group": ["!sdk-lib/a", "sdk-lib/*"]', '"group": ["sdk-lib/*", "!sdk-lib/a"]')
        self.refused("no-restricted-imports", "options")

    def test_a_negated_ban_entry_already_in_base_with_a_new_ban_entry_passes(self):
        self.edit_config('{"paths": [{"name": "sdk-lib", "message": "Use \'@/lib/sdk\' // not this"}]}',
                         '{"patterns": [{"group": ["sdk-lib/*", "!sdk-lib/types"]}]}')
        self.commit("ban sdk-lib's subpaths but its types")
        self.edit_config('"group": ["sdk-lib/*", "!sdk-lib/types"]', '"group": ["sdk-lib/*", "!sdk-lib/types", "old-lib/*"]')
        self.passes()

    def test_an_ignored_folder_with_its_suppressions_pruned_is_refused(self):
        self.edit_config('"ignorePatterns": ["src/components/ui/**"]', '"ignorePatterns": ["src/components/ui/**", "src/orders.tsx"]')
        (self.repo / OXLINT).write_text("{}")
        self.refused("ignorePatterns", "src/orders.tsx")

    def test_a_plugin_dropped_is_refused(self):
        self.edit_config('"plugins": ["eslint", "typescript", "react"]', '"plugins": ["eslint", "typescript"]')
        self.refused("plugin react")

    def test_a_category_turned_down_from_error_is_refused(self):
        self.edit_config('"categories": {"correctness": "off"}', '"categories": {"correctness": "error"}')
        self.commit("correctness on")
        self.edit_config('"categories": {"correctness": "error"}', '"categories": {"correctness": "warn"}')
        self.refused("category correctness", "warn")

    def test_an_unknown_top_level_key_added_is_refused(self):
        self.edit_config('"plugins"', '"extends": ["./loose.json"], "plugins"')
        self.refused("extends")

    def test_an_override_that_turns_a_rule_off_for_a_new_folder_is_refused(self):
        self.edit_config('{"files": ["src/lib/sdk.ts"], "rules": {"no-restricted-imports": "off"}}',
                         '{"files": ["src/lib/sdk.ts", "src/pages/**"], "rules": {"no-restricted-imports": "off"}}')
        self.refused("override", "no-restricted-imports", "src/pages/**")

    def test_a_new_override_that_sets_a_rule_to_warn_is_refused(self):
        self.edit_config('"overrides": [', '"overrides": [{"files": ["src/x/**"], "rules": {"typescript/no-explicit-any": "warn"}},')
        self.refused("override", "typescript/no-explicit-any", "warn", "src/x/**")

    def test_a_folder_taken_off_the_typed_path_is_refused(self):
        self.edit_config('"files": ["src/pages/orders/**/*.{ts,tsx}"]', '"files": ["src/pages/other/**/*.{ts,tsx}"]')
        self.refused("typescript/no-unsafe-call", "src/pages/orders/**/*.{ts,tsx}")

    def test_a_rule_dropped_from_the_typed_path_or_set_to_warn_there_is_refused(self):
        self.edit_config('"typescript/no-unsafe-call": "error", ', '')
        self.refused("typescript/no-unsafe-call", "src/pages/orders/**/*.{ts,tsx}")
        self.edit_config('"typescript/no-unsafe-return": "error"', '"typescript/no-unsafe-return": "warn"')
        self.refused("typescript/no-unsafe-return")

    def test_a_broken_config_or_a_malformed_rule_setting_is_refused_without_a_traceback(self):
        self.config(CONFIG_TEXT + "/* never closed")
        self.refused(".oxlintrc.json")
        self.config(CONFIG_TEXT.replace('"typescript/no-explicit-any": "error"', '"typescript/no-explicit-any": {"x": 1}'))
        self.refused("typescript/no-explicit-any")

    def test_an_exception_moved_after_the_override_that_turns_its_rule_on_is_refused(self):
        # oxlint applies overrides in order, the later winning: the exception first is beaten by the typed path.
        typed = '{"files": ["src/pages/orders/**/*.{ts,tsx}"], "rules": {"typescript/no-unsafe-call": "error"}}'
        exception = '{"files": ["src/pages/orders/**/*.{ts,tsx}"], "rules": {"typescript/no-unsafe-call": "off"}}'
        self.config('{"plugins": ["typescript"], "overrides": [' + exception + ", " + typed + "]}")
        self.commit("exception first")
        self.config('{"plugins": ["typescript"], "overrides": [' + typed + ", " + exception + "]}")
        self.refused("typescript/no-unsafe-call", "now comes after")

    def test_an_unknown_key_in_an_override_is_refused(self):
        self.edit_config('{"files": ["src/lib/sdk.ts"],', '{"files": ["src/lib/sdk.ts"], "extends": ["./loose.json"],')
        self.refused("override", "extends")

    def test_a_rule_turned_off_under_another_name_oxlint_reads_as_the_same_rule_is_refused(self):
        for alias in ("@typescript-eslint/no-explicit-any", "no-explicit-any", "eslint/no-explicit-any"):
            with self.subTest(alias):
                self.config(CONFIG_TEXT.replace('"react/rules-of-hooks": "error",',
                                                f'"react/rules-of-hooks": "error", "{alias}": "off",'))
                self.refused("no-explicit-any", "off")

    def test_a_negated_ignore_pattern_moved_before_the_pattern_it_undoes_is_refused(self):
        # The last pattern that matches a file wins: "!src/ui/b.ts" first is beaten by "src/ui/**", so b.ts is skipped.
        self.edit_config('"ignorePatterns": ["src/components/ui/**"]',
                         '"ignorePatterns": ["src/ui/**", "!src/ui/b.ts"]')
        self.commit("lint b.ts")
        self.edit_config('"ignorePatterns": ["src/ui/**", "!src/ui/b.ts"]',
                         '"ignorePatterns": ["!src/ui/b.ts", "src/ui/**"]')
        self.refused("ignorePatterns", "!src/ui/b.ts", "src/ui/**")

    def test_a_negated_ignore_pattern_moved_after_the_pattern_it_undoes_passes(self):
        self.edit_config('"ignorePatterns": ["src/components/ui/**"]',
                         '"ignorePatterns": ["!src/ui/b.ts", "src/ui/**"]')
        self.commit("b.ts not yet linted")
        self.edit_config('"ignorePatterns": ["!src/ui/b.ts", "src/ui/**"]',
                         '"ignorePatterns": ["src/ui/**", "!src/ui/b.ts"]')
        self.passes()

    def test_a_negated_ignore_pattern_lints_more_and_passes(self):
        self.edit_config('"ignorePatterns": ["src/components/ui/**"]',
                         '"ignorePatterns": ["src/components/ui/**", "!src/components/ui/button.tsx"]')
        self.passes()

    def test_a_folder_moved_to_the_typed_path_passes(self):
        self.edit_config('"files": ["src/pages/orders/**/*.{ts,tsx}"]',
                         '"files": ["src/pages/orders/**/*.{ts,tsx}", "src/pages/vendors/**/*.{ts,tsx}"]')
        (self.repo / OXLINT).write_text(json.dumps(suppressions(orders={"typescript/no-explicit-any": 1})))
        self.passes()

    def test_a_new_rule_switched_on_and_an_exception_narrowed_pass(self):
        self.edit_config('"react/rules-of-hooks": "error",', '"react/rules-of-hooks": "error", "no-debugger": "error",')
        self.edit_config('"typescript/no-unsafe-call": "error"', '"typescript/no-unsafe-call": "error", "typescript/no-unsafe-member-access": "error"')
        self.edit_config('"ignorePatterns": ["src/components/ui/**"]', '"ignorePatterns": []')
        self.edit_config('"no-restricted-imports": ["error", {"paths": [', '"no-restricted-imports": ["error", {"paths": [{"name": "other-lib"}, ')
        self.passes()

    def test_the_typed_path_list_replaced_by_the_rule_on_for_all_of_src_passes(self):
        self.edit_config('"react/rules-of-hooks": "error",', '"react/rules-of-hooks": "error", "typescript/no-unsafe-call": "error", "typescript/no-unsafe-return": "error",')
        self.edit_config('{\n      "files": ["src/pages/orders/**/*.{ts,tsx}"],\n      "rules": {"typescript/no-unsafe-call": "error", "typescript/no-unsafe-return": "error"}\n    },', '')
        self.passes()


if __name__ == "__main__":
    unittest.main()
