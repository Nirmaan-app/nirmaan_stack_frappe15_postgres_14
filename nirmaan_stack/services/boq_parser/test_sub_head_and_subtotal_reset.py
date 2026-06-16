"""
Tests for Fix 1 (SUB HEAD pattern detection) and Fix 2 (universal subtotal-reset)
-- Phase 2c bug-fix cycle close, sec 9 #100 + #101.

~20 tests across 4 groups:
  TestSubHeadMarkerHelper      (6) -- _is_sub_head_marker() helper
  TestFix1SubHeadLevel1        (4) -- Fix 1 unit: level=1 forcing via _determine_preamble_level
  TestFix2UniversalReset       (5) -- Fix 2 unit: universal stack reset on SUBTOTAL_MARKER
  TestBoqElvIntegration        (5) -- BoQ ELV real-fixture integration
"""
from __future__ import annotations

import unittest
from pathlib import Path

from nirmaan_stack.services.boq_parser.classifier import (
    ClassifiedRow,
    RowClassification,
    _apply_section_header_note_promotion_post_pass,
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
    ResolvedRow,
    _determine_preamble_level,
    _is_sub_head_marker,
    resolve_hierarchy,
)
from nirmaan_stack.services.boq_parser.reader import BoqReader, RawRow

_FIXTURES = Path(__file__).parent / "tests" / "fixtures"


# ------------------------------------------------------------------
# Shared helpers
# ------------------------------------------------------------------

def _make_preamble_cr(sl_no: str, row_num: int) -> ClassifiedRow:
    return ClassifiedRow(
        raw_row=RawRow(row_number=row_num),
        classification=RowClassification.PREAMBLE,
        sl_no_value=sl_no,
    )


def _make_subtotal_cr(description: str, row_num: int) -> ClassifiedRow:
    return ClassifiedRow(
        raw_row=RawRow(row_number=row_num),
        classification=RowClassification.SUBTOTAL_MARKER,
        description=description,
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


def _gs() -> GlobalSettings:
    return GlobalSettings()


def _find_by_xlsx_row(resolved_rows, xlsx_row: int):
    for rr in resolved_rows:
        if rr.classified_row.raw_row.row_number == xlsx_row:
            return rr
    return None


# ------------------------------------------------------------------
# BoQ ELV fixture config (mirrors test_approach_a_rules._boq_elv_config)
# ------------------------------------------------------------------

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


def _run_elv_pipeline():
    cfg = _boq_elv_config()
    sheet_config = cfg.sheets[0]
    global_settings = cfg.global_settings
    reader = BoqReader(str(_FIXTURES / "Bill of Quantities.xlsx"))
    header_row = sheet_config.header_row
    skip_rows = {header_row, header_row + 1}
    raw_rows = [
        rr for rr in reader.iter_rows(sheet_config.sheet_name)
        if rr.row_number not in skip_rows and rr.row_number >= header_row
    ]
    classified = [classify_row(rr, sheet_config, global_settings) for rr in raw_rows]
    _apply_unit_based_demotion_post_pass(classified)
    populate_preamble_candidate_scores(classified, sheet_config)
    _apply_section_header_note_promotion_post_pass(classified)  # Bug 20 post-pass
    return resolve_hierarchy(
        classified, sheet_config, global_settings, approach_a_enabled=True,
    ).rows


# ==================================================================
# Group 1: _is_sub_head_marker() helper (6 tests)
# ==================================================================

class TestSubHeadMarkerHelper(unittest.TestCase):

    def test_sub_head_marker_basic_match(self):
        self.assertTrue(_is_sub_head_marker("SUB HEAD A"))
        self.assertTrue(_is_sub_head_marker("SUB HEAD B"))
        self.assertTrue(_is_sub_head_marker("SUB HEAD K1"))

    def test_sub_head_marker_embedded_newline(self):
        # "SUB\nHEAD F" occurs literally in Bill of Quantities.xlsx row 272.
        self.assertTrue(_is_sub_head_marker("SUB\nHEAD F"))

    def test_sub_head_marker_multi_space(self):
        self.assertTrue(_is_sub_head_marker("SUB  HEAD A"))

    def test_sub_head_marker_case_insensitive(self):
        self.assertTrue(_is_sub_head_marker("sub head a"))
        self.assertTrue(_is_sub_head_marker("Sub Head B"))

    def test_sub_head_marker_rejects_other(self):
        self.assertFalse(_is_sub_head_marker("HEAD A"))
        self.assertFalse(_is_sub_head_marker("SUB ITEM A"))
        self.assertFalse(_is_sub_head_marker("SUBTOTAL"))
        self.assertFalse(_is_sub_head_marker("foo SUB HEAD A bar"))

    def test_sub_head_marker_rejects_empty(self):
        self.assertFalse(_is_sub_head_marker(""))
        self.assertFalse(_is_sub_head_marker("   "))


# ==================================================================
# Group 2: Fix 1 unit tests -- level=1 forcing (4 tests)
# ==================================================================

class TestFix1SubHeadLevel1(unittest.TestCase):

    def _call_determine(
        self,
        sl_no: str,
        stack: list[int | None] | None = None,
        resolved: list[ResolvedRow] | None = None,
        stack_depth: int = 0,
        level_1_style="letter",
    ) -> tuple[int, list[str]]:
        cr = _make_preamble_cr(sl_no, row_num=10)
        if stack is None:
            stack = []
        if resolved is None:
            resolved = []
        return _determine_preamble_level(
            classified_row=cr,
            level_1_style=level_1_style,
            stack_depth=stack_depth,
            stack_top_index=None,
            classified_rows=[cr],
            raw_row=cr.raw_row,
            sheet_config=_sheet_cfg(),
            approach_a_enabled=True,
            stack=stack,
            resolved=resolved,
        )

    def test_sub_head_forces_level_1_with_empty_stack(self):
        level, warns = self._call_determine("SUB HEAD A", stack=[], resolved=[])
        self.assertEqual(level, 0)  # Bug 20-ext calibration -- SUB HEAD now level=0 per BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED
        self.assertEqual(warns, [])

    def test_sub_head_forces_level_1_with_non_empty_stack(self):
        # Stack already has L1 + L2 entries; "SUB HEAD B" must still return level 0.
        p1 = _make_preamble_cr("1.0", row_num=1)
        p2 = _make_preamble_cr("1.1", row_num=2)
        rr1 = ResolvedRow(classified_row=p1, level=1, parent_index=None, path="0")
        rr2 = ResolvedRow(classified_row=p2, level=2, parent_index=0, path="0/1")
        level, warns = self._call_determine(
            "SUB HEAD B",
            stack=[0, 1],
            resolved=[rr1, rr2],
            stack_depth=2,
        )
        self.assertEqual(level, 0)  # Bug 20-ext calibration -- SUB HEAD now level=0 per BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED
        self.assertEqual(warns, [])

    def test_sub_head_with_embedded_newline_still_level_1(self):
        level, warns = self._call_determine("SUB\nHEAD F", stack=[], resolved=[])
        self.assertEqual(level, 0)  # Bug 20-ext calibration -- SUB HEAD now level=0 per BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED
        self.assertEqual(warns, [])

    def test_sub_head_returns_empty_warnings(self):
        level, warns = self._call_determine("SUB HEAD K1", stack=[], resolved=[])
        self.assertIsInstance(warns, list)
        self.assertEqual(len(warns), 0)


# ==================================================================
# Group 3: Fix 2 unit tests -- universal subtotal-reset (5 tests)
# ==================================================================

class TestFix2UniversalReset(unittest.TestCase):
    """
    Key distinction from old behaviour: old code only reset the stack when
    SUBTOTAL_MARKER.description matched _MID_SHEET_RESET_RE
    (pattern: total + item + no + digits).  All tests below use descriptions
    that do NOT match that pattern, so they would have silently NOT reset
    under the old gated code.

    Stack-depth sensitivity is exposed via empty-sl_no preambles whose
    level = stack_depth + 1: if the stack was cleared, they land at level 1;
    if the stack was not cleared, they land at level 2 or deeper.
    """

    def test_subtotal_marker_clears_non_empty_stack(self):
        """SUBTOTAL_MARKER clears the stack: empty-sl_no preamble after it gets level 1."""
        rows = [
            _make_preamble_cr("A", 1),   # level 1, stack=[0]
            _make_preamble_cr("", 2),     # empty sl_no -> stack_depth+1=2, stack=[0,1]
            _make_subtotal_cr("TOTAL CARRIED OVER TO SUMMARY", 3),  # universal reset
            _make_preamble_cr("", 4),     # empty sl_no -> stack_depth=0 -> level 1
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _gs())
        last_preamble = _find_by_xlsx_row(result.rows, 4)
        self.assertIsNotNone(last_preamble)
        self.assertEqual(last_preamble.level, 1)
        self.assertIsNone(last_preamble.parent_index)

    def test_subtotal_marker_clears_empty_stack_noop(self):
        """SUBTOTAL_MARKER on empty stack does not error; next preamble is still level 1."""
        rows = [
            _make_subtotal_cr("SOME TOTAL", 1),
            _make_preamble_cr("A", 2),
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _gs())
        a_row = _find_by_xlsx_row(result.rows, 2)
        self.assertIsNotNone(a_row)
        self.assertEqual(a_row.level, 1)
        self.assertIsNone(a_row.parent_index)

    def test_multiple_subtotal_markers_in_sequence(self):
        """Multiple consecutive SUBTOTAL_MARKERs do not error; final preamble is level 1."""
        rows = [
            _make_preamble_cr("A", 1),
            _make_preamble_cr("", 2),    # level 2
            _make_subtotal_cr("CARRIED OVER TO SUMMARY", 3),
            _make_subtotal_cr("GRAND TOTAL", 4),
            _make_preamble_cr("", 5),    # after reset: level 1
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _gs())
        last = _find_by_xlsx_row(result.rows, 5)
        self.assertIsNotNone(last)
        self.assertEqual(last.level, 1)
        self.assertIsNone(last.parent_index)

    def test_subtotal_marker_with_arbitrary_description(self):
        """Arbitrary description not matching old _MID_SHEET_RESET_RE still resets stack."""
        rows = [
            _make_preamble_cr("A", 1),   # level 1, stack=[0]
            _make_preamble_cr("", 2),    # level 2, stack=[0,1]
            _make_subtotal_cr("ARBITRARY TEXT XYZ", 3),
            _make_preamble_cr("", 4),    # old code: level 3 (stack_depth=2); new: level 1
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _gs())
        last = _find_by_xlsx_row(result.rows, 4)
        self.assertIsNotNone(last)
        self.assertEqual(last.level, 1)
        self.assertIsNone(last.parent_index)

    def test_subtotal_marker_with_empty_description(self):
        """SUBTOTAL_MARKER with empty description still resets stack."""
        rows = [
            _make_preamble_cr("A", 1),
            _make_preamble_cr("", 2),    # level 2
            _make_subtotal_cr("", 3),
            _make_preamble_cr("", 4),    # after reset: level 1
        ]
        result = resolve_hierarchy(rows, _sheet_cfg(), _gs())
        last = _find_by_xlsx_row(result.rows, 4)
        self.assertIsNotNone(last)
        self.assertEqual(last.level, 1)
        self.assertIsNone(last.parent_index)


# ==================================================================
# Group 4: BoQ ELV integration tests (5 tests)
# ==================================================================

class TestBoqElvIntegration(unittest.TestCase):
    """
    Integration tests on Bill of Quantities.xlsx 'ELECTRICAL & ELV BOQ'.
    Fixture empirical summary (post Fix 1 + Fix 2):
      - 21 PREAMBLE rows with SUB HEAD pattern, all level=1
      - 21 SUBTOTAL_MARKER rows, all desc='TOTAL CARRIED OVER TO SUMMARY'
        (none matched old _MID_SHEET_RESET_RE pattern)
      - row 272 has embedded newline: sl='SUB\nHEAD F'
    """

    @classmethod
    def setUpClass(cls):
        fixture = _FIXTURES / "Bill of Quantities.xlsx"
        if not fixture.exists():
            raise unittest.SkipTest(f"Fixture not found: {fixture}")
        cls.resolved = _run_elv_pipeline()

    def test_boq_elv_sub_head_b_at_level_1(self):
        """xlsx row 62 sl='SUB HEAD B' -> level=0, parent_index=None.
        Bug 20-ext calibration -- SUB HEAD now level=0 per BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED."""
        rr = _find_by_xlsx_row(self.resolved, 62)
        self.assertIsNotNone(rr, "Row 62 not found in resolved output")
        self.assertEqual(rr.classified_row.sl_no_value, "SUB HEAD B")
        self.assertEqual(rr.level, 0)  # Bug 20-ext calibration -- was level=1
        self.assertIsNone(rr.parent_index)

    def test_boq_elv_sub_head_with_newline_at_level_1(self):
        """xlsx row 272 sl='SUB\\nHEAD F' (embedded newline) -> level=0, parent_index=None.
        Bug 20-ext calibration -- SUB HEAD now level=0 per BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED."""
        rr = _find_by_xlsx_row(self.resolved, 272)
        self.assertIsNotNone(rr, "Row 272 not found in resolved output")
        sl = rr.classified_row.sl_no_value or ""
        self.assertIn("\n", sl, f"Row 272 sl_no has no embedded newline: {sl!r}")
        self.assertTrue(_is_sub_head_marker(sl.strip()))
        self.assertEqual(rr.level, 0)  # Bug 20-ext calibration -- was level=1
        self.assertIsNone(rr.parent_index)

    def test_boq_elv_all_sub_heads_at_level_1(self):
        """Every PREAMBLE matching _is_sub_head_marker has level=0 and parent_index=None.
        Bug 20-ext calibration -- all 21 SUB HEAD rows now level=0 per BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED."""
        sub_heads = [
            rr for rr in self.resolved
            if rr.classified_row.classification == RowClassification.PREAMBLE
            and _is_sub_head_marker((rr.classified_row.sl_no_value or "").strip())
        ]
        self.assertGreaterEqual(
            len(sub_heads), 20,
            f"Expected >= 20 SUB HEAD rows, got {len(sub_heads)}",
        )
        for rr in sub_heads:
            row_num = rr.classified_row.raw_row.row_number
            with self.subTest(xlsx_row=row_num, sl=rr.classified_row.sl_no_value):
                self.assertEqual(rr.level, 0)  # Bug 20-ext calibration -- was level=1
                self.assertIsNone(rr.parent_index)

    def test_boq_elv_subtotal_reset_decouples_sections(self):
        """A SUBTOTAL_MARKER immediately followed by a SUB HEAD yields parent_index=None."""
        found = False
        for i, rr in enumerate(self.resolved):
            if rr.classified_row.classification != RowClassification.SUBTOTAL_MARKER:
                continue
            for candidate in self.resolved[i + 1:]:
                if candidate.classified_row.classification == RowClassification.SPACER:
                    continue
                if (
                    candidate.classified_row.classification == RowClassification.PREAMBLE
                    and _is_sub_head_marker(
                        (candidate.classified_row.sl_no_value or "").strip()
                    )
                ):
                    row_num = candidate.classified_row.raw_row.row_number
                    self.assertIsNone(
                        candidate.parent_index,
                        f"SUB HEAD at row {row_num} after subtotal still has a parent",
                    )
                    found = True
                break
        self.assertTrue(found, "No SUB HEAD found immediately after any SUBTOTAL_MARKER")

    def test_boq_elv_numeric_preamble_after_sub_head_b_is_clean_root(self):
        """
        xlsx row 64 sl='1.0' -> level=1, parent is SUB HEAD B (row 62).

        Bug 20-ext calibration: previously parent_index=None (rootless). Now sl='1.0'
        correctly parents under the preceding level=0 SUB HEAD B via level0_ancestor
        tracking in resolve_hierarchy (BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED).
        """
        rr = _find_by_xlsx_row(self.resolved, 64)
        self.assertIsNotNone(rr, "Numeric preamble at row 64 not found")
        self.assertEqual(rr.classified_row.sl_no_value, "1.0")
        self.assertEqual(rr.level, 1)
        # Bug 20-ext calibration -- parent_index was None; now points to SUB HEAD B
        self.assertIsNotNone(rr.parent_index, "Row 64 sl='1.0' should parent under SUB HEAD B (level=0)")
        parent_rr = self.resolved[rr.parent_index]
        self.assertTrue(
            _is_sub_head_marker((parent_rr.classified_row.sl_no_value or "").strip()),
            f"Parent of sl='1.0' must be a SUB HEAD; got {parent_rr.classified_row.sl_no_value!r}",
        )


if __name__ == "__main__":
    unittest.main()
