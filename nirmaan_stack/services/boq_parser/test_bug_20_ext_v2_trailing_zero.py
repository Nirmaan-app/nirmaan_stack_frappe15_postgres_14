"""
Tests for Bug 20-ext-v2: _RE_NUMERIC trailing-zero tolerance fix.

Regression: _RE_NUMERIC = re.compile(r"^\\d+(\\.0)?$") accepted only one
trailing zero. "1.00" / "2.00" / "10.00" fell through to _RE_MULTI2,
classified as "multi_dot_numeric", and received level=2 instead of the
correct level=1. The Bug 20-ext level0_ancestor inheritance only fires
at level==1, so these rows ended up rootless (parent_index=None).

Fix: (\\.0)? -> (\\.0+)? -- one or more trailing zeros. "1", "1.0", "1.00",
"1.000" all classify identically as "numeric".

See: hierarchy.py:96, sec 9 #110.

Tests (5):
  TestCategorizeTrailingZero   (4) -- _categorize_sl_no_style unit tests
  TestSafronR7HierarchyCorrect (1) -- safron integration: r7 "1.00" at level=1
"""
from __future__ import annotations

import unittest
from pathlib import Path

from nirmaan_stack.services.boq_parser.hierarchy import _categorize_sl_no_style
from nirmaan_stack.services.boq_parser.classifier import RowClassification

_FIXTURES = Path(__file__).parent / "tests" / "fixtures"
_SAFRON_FIXTURE = _FIXTURES / "safron_hvac_2026-04-11.xlsx"


# ==================================================================
# Group 1: _categorize_sl_no_style unit tests (4 tests)
# ==================================================================

class TestCategorizeTrailingZero(unittest.TestCase):
    """Unit tests for _RE_NUMERIC trailing-zero tolerance."""

    def test_one_trailing_zero_still_numeric(self):
        """Regression guard: "1.0" must still be "numeric" after fix."""
        self.assertEqual(_categorize_sl_no_style("1.0"), "numeric")

    def test_two_trailing_zeros_now_numeric(self):
        """Core fix: "1.00" was "multi_dot_numeric", must now be "numeric"."""
        self.assertEqual(_categorize_sl_no_style("1.00"), "numeric")
        self.assertEqual(_categorize_sl_no_style("2.00"), "numeric")
        self.assertEqual(_categorize_sl_no_style("10.00"), "numeric")

    def test_three_trailing_zeros_now_numeric(self):
        """Fix extends beyond 2 zeros: "1.000" must also be "numeric"."""
        self.assertEqual(_categorize_sl_no_style("1.000"), "numeric")

    def test_multi_dot_numbering_unchanged(self):
        """Non-regression: real multi-dot codes must still be "multi_dot_numeric"."""
        self.assertEqual(_categorize_sl_no_style("1.1"), "multi_dot_numeric")
        self.assertEqual(_categorize_sl_no_style("2.3"), "multi_dot_numeric")
        self.assertEqual(_categorize_sl_no_style("2.3.4"), "multi_dot_numeric")
        # Two-dot with a zero sub-level is still multi-dot, not numeric
        self.assertEqual(_categorize_sl_no_style("1.0.0"), "multi_dot_numeric")


# ==================================================================
# Group 2: safron integration (1 test)
# ==================================================================

class TestSafronR7HierarchyCorrect(unittest.TestCase):
    """
    Integration test: safron xlsx row 7 (sl="1.00") must resolve to
    PREAMBLE level=1 parented under the PART-1 anchor (xlsx row 5, level=0).

    Uses parse_boq via orchestrator (full pipeline: Bug 16/17/18/19/20).
    The PART-1 anchor at row 5 is an Anchor-1 promoted section header
    (preamble_level_override=0). After the fix, "1.00" classifies as
    "numeric" -> level=1, and Bug 20-ext's level0_ancestor inheritance
    (resolve_hierarchy:599) makes it a child of the anchor.
    """

    @classmethod
    def setUpClass(cls):
        if not _SAFRON_FIXTURE.exists():
            cls._skip = True
            return
        cls._skip = False
        from nirmaan_stack.services.boq_parser.orchestrator import parse_boq
        from nirmaan_stack.services.boq_parser.config import (
            MappingConfig, MasterBoqMetadata, SheetConfig, ColumnRole,
        )
        cfg = MappingConfig(
            project="safron_test",
            master_boq=MasterBoqMetadata(boq_name="Safron HVAC test"),
            sheets=[SheetConfig(
                sheet_name="Low Side Works R2 11.4.26",
                header_row=3,
                column_role_map={
                    "A": ColumnRole(role="sl_no"),
                    "B": ColumnRole(role="description"),
                    "C": ColumnRole(role="unit"),
                    "D": ColumnRole(role="qty"),
                    "E": ColumnRole(role="rate_supply"),
                    "F": ColumnRole(role="rate_install"),
                    "G": ColumnRole(role="amount_total"),
                },
            )],
        )
        result = parse_boq(str(_SAFRON_FIXTURE), cfg)
        cls.resolved = result.sheets[0].resolved_rows

    def setUp(self):
        if self._skip:
            self.skipTest(f"Safron fixture not found: {_SAFRON_FIXTURE}")

    def _find(self, xlsx_row: int):
        for rr in self.resolved:
            if rr.classified_row.raw_row.row_number == xlsx_row:
                return rr
        return None

    def test_safron_r7_hierarchy_correct(self):
        """
        xlsx row 7 sl="1.00": must be PREAMBLE level=1 parented under
        the PART-1 section anchor (xlsx row 5, level=0, anchor-promoted).
        Pre-fix: level=2, parent=None (rootless orphan).
        Post-fix: level=1, parent=ridx of r5.
        """
        # Locate r7 and r5
        r7 = self._find(7)
        r5 = self._find(5)
        self.assertIsNotNone(r7, "xlsx row 7 (sl='1.00') not found in resolved output")
        self.assertIsNotNone(r5, "xlsx row 5 (PART-1 anchor) not found in resolved output")

        # r7 must be a PREAMBLE
        self.assertEqual(
            r7.classified_row.classification,
            RowClassification.PREAMBLE,
            f"Row 7 must be PREAMBLE; got {r7.classified_row.classification}",
        )

        # r7 must be at level 1 (was level 2 before fix)
        self.assertEqual(
            r7.level, 1,
            f"Row 7 (sl='1.00') must be level=1 after _RE_NUMERIC fix; got level={r7.level}",
        )

        # r7 must have a parent
        self.assertIsNotNone(
            r7.parent_index,
            "Row 7 must parent under the PART-1 anchor, not be rootless",
        )

        # The parent must be the PART-1 anchor (r5): level=0, anchor-promoted
        parent_rr = self.resolved[r7.parent_index]
        self.assertEqual(
            parent_rr.classified_row.raw_row.row_number, 5,
            f"Parent of row 7 must be xlsx row 5 (PART-1 anchor); got row {parent_rr.classified_row.raw_row.row_number}",
        )
        self.assertEqual(
            parent_rr.level, 0,
            "PART-1 anchor (row 5) must be at level=0",
        )
        self.assertEqual(
            parent_rr.classified_row.preamble_level_override, 0,
            "PART-1 anchor must carry preamble_level_override=0 (set by Anchor-1 post-pass)",
        )
