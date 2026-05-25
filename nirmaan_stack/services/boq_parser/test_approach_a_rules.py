"""
Tests for Rule A1 (lowercase-letter cascade fix) and Rule A2-reframed
(sibling numeric peer fix) — Approach A-reframed landing, sec 9 #99.

24 tests across 5 groups:
  TestHelpers            (5) — pattern_signature / first_numeric_token
  TestRuleA1Unit         (7) — A1 fires / disabled / F5 carveouts
  TestRuleA2Unit         (7) — A2 fires / disabled / no-fire conditions
  TestSnitchIntegration  (3) — real snitch_electrical.xlsx
  TestBoqElvIntegration  (2) — real Bill of Quantities.xlsx
"""
from __future__ import annotations

import unittest
from pathlib import Path

from nirmaan_stack.services.boq_parser.classifier import (
    ClassifiedRow,
    RowClassification,
    _apply_unit_based_demotion_post_pass,
    classify_row,
    populate_preamble_candidate_scores,
)
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.hierarchy import (
    first_numeric_token,
    pattern_signature,
    resolve_hierarchy,
)
from nirmaan_stack.services.boq_parser.orchestrator import parse_boq
from nirmaan_stack.services.boq_parser.reader import BoqReader, RawRow

_FIXTURES = Path(__file__).parent / "tests" / "fixtures"


# ------------------------------------------------------------------
# Shared helpers
# ------------------------------------------------------------------

def _make_preamble(sl_no: str, row_num: int) -> ClassifiedRow:
    return ClassifiedRow(
        raw_row=RawRow(row_number=row_num),
        classification=RowClassification.PREAMBLE,
        sl_no_value=sl_no,
    )


def _make_line_item(sl_no: str, row_num: int) -> ClassifiedRow:
    return ClassifiedRow(
        raw_row=RawRow(row_number=row_num),
        classification=RowClassification.LINE_ITEM,
        sl_no_value=sl_no,
    )


def _sheet_cfg() -> SheetConfig:
    return SheetConfig(
        sheet_name="Test",
        header_row=1,
        column_role_map={
            "A": ColumnRole(role="sl_no"),
            "B": ColumnRole(role="description"),
        },
    )


def _find_by_xlsx_row(resolved_rows, xlsx_row: int):
    for rr in resolved_rows:
        if rr.classified_row.raw_row.row_number == xlsx_row:
            return rr
    return None


def _parent_sl_no(rr, resolved_rows) -> str | None:
    if rr is None or rr.parent_index is None:
        return None
    return resolved_rows[rr.parent_index].classified_row.sl_no_value


# ------------------------------------------------------------------
# Fixture configs
# ------------------------------------------------------------------

def _snitch_config() -> MappingConfig:
    _elec_cols = {
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="description"),
        "C": ColumnRole(role="unit"),
        "D": ColumnRole(role="qty"),
        "E": ColumnRole(role="rate_supply"),
        "F": ColumnRole(role="rate_install"),
        "G": ColumnRole(role="rate_combined"),
        "I": ColumnRole(role="amount_total"),
    }
    return MappingConfig(
        project="snitch",
        master_boq=MasterBoqMetadata(boq_name="Snitch Electrical"),
        sheets=[
            SheetConfig(sheet_name="OVERALL SUMMARY", skip=True, column_role_map={}),
            SheetConfig(sheet_name="SUMMARY MEP", skip=True, column_role_map={}),
            SheetConfig(sheet_name="6. Electrical", header_row=1, column_role_map=_elec_cols),
            SheetConfig(sheet_name="7. Light Fixtures", header_row=2, column_role_map=_elec_cols),
            SheetConfig(sheet_name="MAKE LIST (to be updated)", skip=True, column_role_map={}),
        ],
    )


def _boq_elv_config() -> MappingConfig:
    _cols = {
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="append_to_notes"),
        "C": ColumnRole(role="description"),
        "D": ColumnRole(role="unit"),
        "E": ColumnRole(role="qty"),
        "F": ColumnRole(role="rate_supply"),
        "G": ColumnRole(role="rate_install"),
        "H": ColumnRole(role="amount_supply"),
        "I": ColumnRole(role="amount_install"),
    }
    return MappingConfig(
        project="boq_elv",
        master_boq=MasterBoqMetadata(boq_name="Bill Of Quantities ELV"),
        sheets=[
            SheetConfig(
                sheet_name="ELECTRICAL & ELV BOQ",
                header_row=2,
                header_row_count=2,
                column_role_map=_cols,
            ),
        ],
    )


def _run_elv_pipeline(approach_a_enabled: bool):
    """Classify + resolve ELECTRICAL & ELV BOQ with the approach_a toggle."""
    cfg = _boq_elv_config()
    sheet_config = cfg.sheets[0]
    global_settings = cfg.global_settings
    reader = BoqReader(str(_FIXTURES / "Bill of Quantities.xlsx"))
    header_row = sheet_config.header_row
    skip_rows = {header_row, header_row + 1}  # 2-row header; row 3 blank
    raw_rows = [
        rr for rr in reader.iter_rows(sheet_config.sheet_name)
        if rr.row_number not in skip_rows and rr.row_number >= header_row
    ]
    classified = [classify_row(rr, sheet_config, global_settings) for rr in raw_rows]
    _apply_unit_based_demotion_post_pass(classified)
    populate_preamble_candidate_scores(classified, sheet_config)
    return resolve_hierarchy(
        classified, sheet_config, global_settings,
        approach_a_enabled=approach_a_enabled,
    ).rows


def _run_snitch_elec_pipeline(approach_a_enabled: bool):
    """Classify + resolve Snitch '6. Electrical' with the approach_a toggle."""
    cfg = _snitch_config()
    sheet_config = next(s for s in cfg.sheets if s.sheet_name == "6. Electrical")
    global_settings = cfg.global_settings
    reader = BoqReader(str(_FIXTURES / "snitch_electrical.xlsx"))
    header_row = sheet_config.header_row
    skip_rows = {header_row}
    raw_rows = [
        rr for rr in reader.iter_rows(sheet_config.sheet_name)
        if rr.row_number not in skip_rows and rr.row_number >= header_row
    ]
    classified = [classify_row(rr, sheet_config, global_settings) for rr in raw_rows]
    _apply_unit_based_demotion_post_pass(classified)
    populate_preamble_candidate_scores(classified, sheet_config)
    return resolve_hierarchy(
        classified, sheet_config, global_settings,
        approach_a_enabled=approach_a_enabled,
    ).rows


# ==================================================================
# Group 1: Helper unit tests
# ==================================================================

class TestHelpers(unittest.TestCase):

    def test_pattern_signature_known_examples(self):
        self.assertEqual(pattern_signature("1.0"), "D.D")
        self.assertEqual(pattern_signature("a."), "l.")
        self.assertEqual(pattern_signature("A."), "U.")
        self.assertEqual(pattern_signature("10.3"), "D.D")
        self.assertEqual(pattern_signature("1a"), "Dl")

    def test_pattern_signature_empty(self):
        self.assertEqual(pattern_signature(""), "")

    def test_first_numeric_token_leading_digits(self):
        self.assertEqual(first_numeric_token("1.0"), 1)
        self.assertEqual(first_numeric_token("10.3"), 10)
        self.assertEqual(first_numeric_token("2.0"), 2)

    def test_first_numeric_token_no_leading_digit(self):
        self.assertIsNone(first_numeric_token("a."))
        self.assertIsNone(first_numeric_token(""))

    def test_first_numeric_token_leading_space(self):
        self.assertEqual(first_numeric_token("  2.0"), 2)


# ==================================================================
# Group 2: Rule A1 unit tests
# ==================================================================

class TestRuleA1Unit(unittest.TestCase):
    """
    Rule A1 fires when the PREAMBLE sl_no (after stripping trailing
    punctuation) consists ENTIRELY of lowercase characters.  It looks for
    the nearest non-lowercase ancestor in the stack and returns level =
    anchor.level + 1 instead of the standard stack_depth + 1.
    """

    def _run(self, rows, approach_a_enabled: bool = True):
        return resolve_hierarchy(
            rows, _sheet_cfg(), GlobalSettings(),
            approach_a_enabled=approach_a_enabled,
        ).rows

    def test_a1_fires_single_lowercase_b(self):
        """
        A.(level 1) / a(level 2) / b:
        Without A1 'b' cascades to stack_depth+1=3.
        With A1 'b' finds 'A.' at level 1, returns 1+1=2.
        """
        rows = [
            _make_preamble("A.", 1),  # level 1
            _make_preamble("a", 2),   # level 2
            _make_preamble("b", 3),   # A1 -> level 2
        ]
        resolved = self._run(rows)
        self.assertEqual(resolved[2].level, 2)

    def test_a1_fires_trailing_dot(self):
        """sl_no 'b.' — trailing dot stripped before A1 check, fires."""
        rows = [
            _make_preamble("A.", 1),
            _make_preamble("a", 2),
            _make_preamble("b.", 3),
        ]
        resolved = self._run(rows)
        self.assertEqual(resolved[2].level, 2)

    def test_a1_fires_multi_char_lowercase_iv(self):
        """'iv' is all-lowercase multi-char — A1 fires."""
        rows = [
            _make_preamble("A.", 1),
            _make_preamble("a", 2),
            _make_preamble("iv", 3),
        ]
        resolved = self._run(rows)
        self.assertEqual(resolved[2].level, 2)

    def test_a1_disabled_falls_to_standard_level(self):
        """With approach_a_enabled=False 'b' uses standard lowercase_letter path -> level 3."""
        rows = [
            _make_preamble("A.", 1),
            _make_preamble("a", 2),
            _make_preamble("b", 3),
        ]
        resolved = self._run(rows, approach_a_enabled=False)
        self.assertEqual(resolved[2].level, 3)

    def test_a1_carveout_alphanumeric_code(self):
        """
        'a1' has sig 'lD' — NOT all-lowercase — A1 must not fire.
        Standard unknown-code fallback gives stack_depth+1=3, not A1's 2.
        """
        rows = [
            _make_preamble("A.", 1),  # level 1
            _make_preamble("a", 2),   # level 2
            _make_preamble("a1", 3),  # NOT all-lowercase -> standard path
        ]
        resolved = self._run(rows)
        # If A1 wrongly fired: level 2. Standard unknown path: stack_depth+1=3.
        self.assertEqual(resolved[2].level, 3, "A1 must not absorb 'a1' (contains digit)")

    def test_a1_carveout_hyphen_code(self):
        """
        'custom-code-xyz' has hyphens — NOT all-lowercase.
        A1 must not fire (F5 tightening, sec 9 #99).
        """
        rows = [
            _make_preamble("A.", 1),
            _make_preamble("a", 2),
            _make_preamble("custom-code-xyz", 3),
        ]
        resolved = self._run(rows)
        # A1 wrongly firing would give level 2; standard gives 3.
        self.assertEqual(resolved[2].level, 3,
                         "A1 must not absorb 'custom-code-xyz' (F5 tightening)")

    def test_a1_no_non_lowercase_ancestor_falls_through(self):
        """
        When the entire stack has only lowercase entries, A1 cannot find
        a non-lowercase anchor and falls through to standard logic.
        Must not raise; must return a valid level.
        """
        rows = [
            _make_preamble("a", 1),
            _make_preamble("b", 2),
        ]
        resolved = self._run(rows)
        # A1 falls through; standard lowercase_letter gives stack_depth+1=2.
        self.assertEqual(resolved[1].level, 2)


# ==================================================================
# Group 3: Rule A2 unit tests
# ==================================================================

class TestRuleA2Unit(unittest.TestCase):
    """
    Rule A2-reframed fires when a LINE_ITEM's sl_no has the same pattern
    signature AND a different first numeric token compared to the stack-top
    PREAMBLE.  The LINE_ITEM is attached to the stack-top's parent (sibling
    relationship) rather than to the stack top itself (child relationship).
    """

    def _run(self, rows, approach_a_enabled: bool = True):
        return resolve_hierarchy(
            rows, _sheet_cfg(), GlobalSettings(),
            approach_a_enabled=approach_a_enabled,
        ).rows

    def test_a2_fires_same_sig_diff_fnt(self):
        """
        A.(preamble) / 1.0(preamble) / 2.0(line_item):
        sig match + fnt diff -> 2.0 parents to A., not 1.0.
        """
        rows = [
            _make_preamble("A.", 1),
            _make_preamble("1.0", 2),
            _make_line_item("2.0", 3),
        ]
        resolved = self._run(rows)
        li = resolved[2]
        parent = resolved[li.parent_index]
        self.assertEqual(parent.classified_row.sl_no_value, "A.")

    def test_a2_disabled_line_item_parents_to_stack_top(self):
        """With approach_a_enabled=False, 2.0 parents to 1.0 (stack top, standard path)."""
        rows = [
            _make_preamble("A.", 1),
            _make_preamble("1.0", 2),
            _make_line_item("2.0", 3),
        ]
        resolved = self._run(rows, approach_a_enabled=False)
        li = resolved[2]
        parent = resolved[li.parent_index]
        self.assertEqual(parent.classified_row.sl_no_value, "1.0")

    def test_a2_no_fire_same_fnt(self):
        """
        '1.1' after '1.0': sig match (D.D==D.D) but fnt both==1 -> A2 does not fire.
        1.1 parents to stack top 1.0.
        """
        rows = [
            _make_preamble("A.", 1),
            _make_preamble("1.0", 2),
            _make_line_item("1.1", 3),
        ]
        resolved = self._run(rows)
        li = resolved[2]
        parent = resolved[li.parent_index]
        self.assertEqual(parent.classified_row.sl_no_value, "1.0")

    def test_a2_no_fire_sig_differs(self):
        """
        '2' vs '1.0': sig 'D' != 'D.D' -> A2 does not fire.
        2 parents to stack top 1.0.
        """
        rows = [
            _make_preamble("A.", 1),
            _make_preamble("1.0", 2),
            _make_line_item("2", 3),
        ]
        resolved = self._run(rows)
        li = resolved[2]
        parent = resolved[li.parent_index]
        self.assertEqual(parent.classified_row.sl_no_value, "1.0")

    def test_a2_no_fire_fnt_none_for_letter_top(self):
        """
        Stack top is PREAMBLE 'A.' -> fnt('A.')=None -> A2 does not fire.
        LINE_ITEM '2.0' parents to 'A.' via standard path.
        """
        rows = [
            _make_preamble("A.", 1),
            _make_line_item("2.0", 2),
        ]
        resolved = self._run(rows)
        li = resolved[1]
        parent = resolved[li.parent_index]
        self.assertEqual(parent.classified_row.sl_no_value, "A.")

    def test_a2_sibling_gets_grandparent_path(self):
        """
        When A2 fires, 2.0 is assigned parent_index = 1.0's parent_index (A.'s idx=0).
        Path for 2.0 (resolved idx=2) must be '0/2' (relative to A., not 1.0).
        """
        rows = [
            _make_preamble("A.", 1),
            _make_preamble("1.0", 2),
            _make_line_item("2.0", 3),
        ]
        resolved = self._run(rows)
        li = resolved[2]
        self.assertEqual(li.path, "0/2")

    def test_a2_empty_stack_no_crash(self):
        """
        LINE_ITEM '2.0' arrives with no preambles on the stack.
        A2 block must not crash (approach_a_enabled=True, stack empty).
        """
        rows = [_make_line_item("2.0", 1)]
        resolved = self._run(rows)
        self.assertEqual(len(resolved), 1)
        self.assertIsNone(resolved[0].parent_index)


# ==================================================================
# Group 4: Snitch integration tests
# ==================================================================

class TestSnitchIntegration(unittest.TestCase):
    """
    Integration tests on snitch_electrical.xlsx '6. Electrical'.
    Audit reference: diagnostic_snapshots/approach_a_reframed_audit_snitch.json
      - 30 total firings: A1=3 (xlsx 458/475/491), A2=27.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        result = parse_boq(
            str(_FIXTURES / "snitch_electrical.xlsx"),
            _snitch_config(),
        )
        cls.elec_sheet = next(
            s for s in result.sheets if s.sheet_name == "6. Electrical"
        )
        cls.resolved = cls.elec_sheet.resolved_rows

    def test_snitch_a2_first_firing_parent_is_section_header(self):
        """
        xlsx row 29: sl_no '2.0' LINE_ITEM.
        Audit: A2 fires, proposed_parent='A.' (current_parent='1.0').
        After A2 landing, parent of '2.0' must be the 'A.' section header.
        """
        rr = _find_by_xlsx_row(self.resolved, 29)
        self.assertIsNotNone(rr, "xlsx row 29 not found in resolved rows")
        self.assertEqual(rr.classified_row.sl_no_value, "2.0")
        parent_sl = _parent_sl_no(rr, self.resolved)
        self.assertEqual(parent_sl, "A.",
                         f"Expected parent 'A.' (A2 sibling fix), got {parent_sl!r}")

    def test_snitch_a1_b_c_d_at_level_4(self):
        """
        xlsx rows 458/475/491: sl_nos 'b','c','d' (PREAMBLEs).
        Audit: A1 fires, proposed_level=4 (current 5/6/7 respectively).
        After A1 landing, all three must be at level 4.
        """
        for xlsx_row, sl_no in [(458, "b"), (475, "c"), (491, "d")]:
            with self.subTest(xlsx_row=xlsx_row, sl_no=sl_no):
                rr = _find_by_xlsx_row(self.resolved, xlsx_row)
                self.assertIsNotNone(rr, f"xlsx row {xlsx_row} not found")
                self.assertEqual(rr.classified_row.sl_no_value, sl_no)
                self.assertEqual(
                    rr.level, 4,
                    f"Expected level 4 after A1 for '{sl_no}' at xlsx {xlsx_row}, "
                    f"got {rr.level}",
                )

    def test_snitch_approach_a_off_a2_does_not_fire(self):
        """
        With approach_a_enabled=False, A2 does not fire.
        xlsx row 29 ('2.0') must parent to '1.0' (the stack top without A2).
        """
        resolved = _run_snitch_elec_pipeline(approach_a_enabled=False)
        rr = _find_by_xlsx_row(resolved, 29)
        self.assertIsNotNone(rr)
        parent_sl = _parent_sl_no(rr, resolved)
        self.assertEqual(parent_sl, "1.0",
                         f"Without A2 '2.0' must parent to '1.0', got {parent_sl!r}")


# ==================================================================
# Group 5: BoQ ELV integration tests
# ==================================================================

class TestBoqElvIntegration(unittest.TestCase):
    """
    Integration tests on Bill of Quantities.xlsx 'ELECTRICAL & ELV BOQ'.
    Audit reference: diagnostic_snapshots/approach_a_reframed_audit_bill_of_quantities.json
      - 31 total firings: A1=0, A2=31.
      - First firing: xlsx row 9, sl_no '2.0', current_parent='1.0', proposed_parent=''
        (empty proposed_parent means parent_index=None after A2).
    """

    def test_boq_elv_a2_first_firing_root_level(self):
        """
        xlsx row 9: sl_no '2.0' LINE_ITEM.
        A2 fires: sig match + fnt diff -> parent_index = '1.0'.parent_index = None.
        With A2 ON, '2.0' must have parent_index=None (root level).
        """
        resolved = _run_elv_pipeline(approach_a_enabled=True)
        rr = _find_by_xlsx_row(resolved, 9)
        self.assertIsNotNone(rr, "xlsx row 9 not found in resolved rows")
        self.assertEqual(rr.classified_row.sl_no_value, "2.0")
        self.assertIsNone(
            rr.parent_index,
            f"Expected root-level (parent_index=None) after A2, got {rr.parent_index}",
        )

    def test_boq_elv_approach_a_off_nested(self):
        """
        With approach_a_enabled=False, A2 does not fire.
        xlsx row 9 ('2.0') must parent to '1.0' (current_parent per audit).
        """
        resolved = _run_elv_pipeline(approach_a_enabled=False)
        rr = _find_by_xlsx_row(resolved, 9)
        self.assertIsNotNone(rr)
        parent_sl = _parent_sl_no(rr, resolved)
        self.assertEqual(parent_sl, "1.0",
                         f"Without A2 '2.0' must parent to '1.0', got {parent_sl!r}")


if __name__ == "__main__":
    unittest.main()
