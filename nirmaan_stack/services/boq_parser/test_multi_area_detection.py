# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import unittest

from nirmaan_stack.services.boq_parser.config import GlobalSettings
from nirmaan_stack.services.boq_parser.multi_area_detection import (
    MultiAreaPattern,
    detect_multi_area_pattern,
)
from nirmaan_stack.services.boq_parser.reader import CellInfo, RawRow


# ------------------------------------------------------------------
# Synthetic row helper
# ------------------------------------------------------------------

def _make_row(row_number: int, cells: dict[str, dict]) -> RawRow:
    """
    Build a RawRow from a plain dict.

    Each key is a column letter; each value is a dict with optional fields:
      value             — cell value (default None)
      is_merged_origin  — bool (default False)
      merged_range      — range string e.g. "D1:E1" (default None)
      bold              — font_bold (default False)
    """
    cell_objs: dict[str, CellInfo] = {}
    for col, props in cells.items():
        cell_objs[col] = CellInfo(
            value=props.get("value"),
            formula=None,
            is_formula=False,
            is_merged_origin=props.get("is_merged_origin", False),
            merged_range=props.get("merged_range"),
            font_bold=props.get("bold", False),
            fill_color_rgb=None,
            indent=0,
        )
    return RawRow(row_number=row_number, cells=cell_objs)


_KWS = GlobalSettings().multi_area_reserved_keywords


# ------------------------------------------------------------------
# Smoke tests — one per pattern, happy-path only
# (Rejection cases, priority verification, edge cases → Part A3b)
# ------------------------------------------------------------------

class TestMultiAreaDetectionSmoke(unittest.TestCase):
    """Group A3a: multi-area pattern detection — smoke tests."""

    # ------------------------------------------------------------------ #
    # Test 1 — Pattern 1 (adjacent area-only labels)                       #
    # ------------------------------------------------------------------ #

    def test_pattern_1_two_adjacent_areas_detected(self):
        """Two adjacent non-reserved cells followed by TOTAL QTY → Pattern 1."""
        row = _make_row(1, {
            "A": {"value": "DESCRIPTION"},
            "B": {"value": "UNIT"},
            "C": {"value": "Office"},
            "D": {"value": "Common Area"},
            "E": {"value": "TOTAL QTY"},
            "F": {"value": "RATE"},
            "G": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 1)
        self.assertEqual(result.areas, ["Office", "Common Area"])
        self.assertEqual(len(result.qty_columns), 2)
        self.assertIsNone(result.amount_columns)

    # ------------------------------------------------------------------ #
    # Test 2 — Pattern 2 (two-row merged header)                           #
    # ------------------------------------------------------------------ #

    def test_pattern_2_two_merged_areas_detected(self):
        """Top row has two 2-column merges; bottom row has QTY/AMOUNT → Pattern 2."""
        top_row = _make_row(1, {
            "D": {"value": "Office",      "is_merged_origin": True,  "merged_range": "D1:E1"},
            "E": {"value": "Office",      "is_merged_origin": False, "merged_range": "D1:E1"},
            "F": {"value": "Common Area", "is_merged_origin": True,  "merged_range": "F1:G1"},
            "G": {"value": "Common Area", "is_merged_origin": False, "merged_range": "F1:G1"},
        })
        bottom_row = _make_row(2, {
            "D": {"value": "QTY"},
            "E": {"value": "AMOUNT"},
            "F": {"value": "QTY"},
            "G": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 2)
        self.assertEqual(len(result.areas), 2)
        self.assertEqual(len(result.qty_columns), 2)
        self.assertIsNotNone(result.amount_columns)
        self.assertEqual(len(result.amount_columns), 2)
        self.assertEqual(result.detected_on_row, 1)

    # ------------------------------------------------------------------ #
    # Test 3 — Pattern 3 (single-row alternating label/AMOUNT pairs)       #
    # ------------------------------------------------------------------ #

    def test_pattern_3_alternating_areas_detected(self):
        """Alternating [area][AMOUNT] pairs followed by TOTAL QTY → Pattern 3."""
        row = _make_row(1, {
            "A": {"value": "DESCRIPTION"},
            "B": {"value": "UNIT"},
            "C": {"value": "Office"},
            "D": {"value": "AMOUNT"},
            "E": {"value": "Common Area"},
            "F": {"value": "AMOUNT"},
            "G": {"value": "TOTAL QTY"},
            "H": {"value": "RATE"},
            "I": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 3)
        self.assertEqual(result.areas, ["Office", "Common Area"])
        self.assertIsNotNone(result.amount_columns)
        self.assertEqual(len(result.qty_columns), 2)
        self.assertEqual(len(result.amount_columns), 2)


# ------------------------------------------------------------------
# Comprehensive tests — rejection, priority, fallback, edge cases
# (Part A3b — 11 tests)
# ------------------------------------------------------------------

class TestMultiAreaDetectionComprehensive(unittest.TestCase):
    """Group A3b: rejection cases, priority routing, fallback, and edge cases."""

    # ------------------------------------------------------------------ #
    # Pattern 1 additional cases                                           #
    # ------------------------------------------------------------------ #

    def test_pattern_1_liberal_no_terminator_still_detected(self):
        """Three adjacent area names with no TOTAL QTY terminator → Pattern 1 (liberal mode)."""
        row = _make_row(1, {
            "A": {"value": "DESCRIPTION"},
            "B": {"value": "UNIT"},
            "C": {"value": "Office"},
            "D": {"value": "Common Area"},
            "E": {"value": "Lobby"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 1)
        self.assertEqual(result.areas, ["Office", "Common Area", "Lobby"])
        self.assertEqual(len(result.qty_columns), 3)
        self.assertIsNone(result.amount_columns)

    def test_pattern_1_single_area_rejected(self):
        """Only one non-reserved area candidate → minimum-2-areas threshold rejects it."""
        row = _make_row(1, {
            "A": {"value": "DESCRIPTION"},
            "B": {"value": "UNIT"},
            "C": {"value": "Office"},
            "D": {"value": "TOTAL QTY"},
            "E": {"value": "RATE"},
            "F": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNone(result)

    # ------------------------------------------------------------------ #
    # Pattern 2 additional cases                                           #
    # ------------------------------------------------------------------ #

    def test_pattern_2_three_merged_areas_detected(self):
        """Three side-by-side 2-column merges each with QTY/AMOUNT in bottom row → Pattern 2."""
        top_row = _make_row(1, {
            "C": {"value": "Office",      "is_merged_origin": True,  "merged_range": "C1:D1"},
            "D": {"value": "Office",      "is_merged_origin": False, "merged_range": "C1:D1"},
            "E": {"value": "Common Area", "is_merged_origin": True,  "merged_range": "E1:F1"},
            "F": {"value": "Common Area", "is_merged_origin": False, "merged_range": "E1:F1"},
            "G": {"value": "Lobby",       "is_merged_origin": True,  "merged_range": "G1:H1"},
            "H": {"value": "Lobby",       "is_merged_origin": False, "merged_range": "G1:H1"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "QTY"},
            "D": {"value": "AMOUNT"},
            "E": {"value": "QTY"},
            "F": {"value": "AMOUNT"},
            "G": {"value": "QTY"},
            "H": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 2)
        self.assertEqual(result.areas, ["Office", "Common Area", "Lobby"])
        self.assertEqual(len(result.qty_columns), 3)
        self.assertIsNotNone(result.amount_columns)
        self.assertEqual(len(result.amount_columns), 3)

    def test_pattern_2_qty_amount_pairing_required(self):
        """Pattern 2 rejected when bottom row under first merge has QTY+QTY (not QTY+AMOUNT);
        P1 on top falls back successfully and returns the two areas via merge origins.
        """
        top_row = _make_row(1, {
            "D": {"value": "Office",      "is_merged_origin": True,  "merged_range": "D1:E1"},
            "E": {"value": "Office",      "is_merged_origin": False, "merged_range": "D1:E1"},
            "F": {"value": "Common Area", "is_merged_origin": True,  "merged_range": "F1:G1"},
            "G": {"value": "Common Area", "is_merged_origin": False, "merged_range": "F1:G1"},
        })
        bottom_row = _make_row(2, {
            "D": {"value": "QTY"},
            "E": {"value": "QTY"},     # breaks pairing — must be AMOUNT
            "F": {"value": "QTY"},
            "G": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 1)
        self.assertEqual(result.areas, ["Office", "Common Area"])
        self.assertIsNone(result.amount_columns)
        self.assertEqual(result.detected_on_row, top_row.row_number)

    # ------------------------------------------------------------------ #
    # Pattern 3 additional cases                                           #
    # ------------------------------------------------------------------ #

    def test_pattern_3_two_pairs_canonical_detected(self):
        """Canonical two-pair shape with three trailing summary columns → Pattern 3."""
        row = _make_row(1, {
            "A": {"value": "DESCRIPTION"},
            "B": {"value": "UNIT"},
            "C": {"value": "Block A"},
            "D": {"value": "AMOUNT"},
            "E": {"value": "Block B"},
            "F": {"value": "AMOUNT"},
            "G": {"value": "TOTAL QTY"},
            "H": {"value": "RATE"},
            "I": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 3)
        self.assertEqual(result.areas, ["Block A", "Block B"])
        self.assertEqual(len(result.qty_columns), 2)
        self.assertIsNotNone(result.amount_columns)
        self.assertEqual(len(result.amount_columns), 2)

    # ------------------------------------------------------------------ #
    # Priority routing                                                     #
    # ------------------------------------------------------------------ #

    def test_priority_pattern_2_beats_pattern_3(self):
        """In 2-row mode, Pattern 2 is checked before Pattern 3; P2 wins on a P2-valid input."""
        top_row = _make_row(1, {
            "D": {"value": "Office",      "is_merged_origin": True,  "merged_range": "D1:E1"},
            "E": {"value": "Office",      "is_merged_origin": False, "merged_range": "D1:E1"},
            "F": {"value": "Common Area", "is_merged_origin": True,  "merged_range": "F1:G1"},
            "G": {"value": "Common Area", "is_merged_origin": False, "merged_range": "F1:G1"},
        })
        bottom_row = _make_row(2, {
            "D": {"value": "QTY"},
            "E": {"value": "AMOUNT"},
            "F": {"value": "QTY"},
            "G": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 2)

    def test_priority_pattern_3_beats_pattern_1(self):
        """In 1-row mode, Pattern 3 is checked before Pattern 1; P3 wins when pairs are found."""
        row = _make_row(1, {
            "A": {"value": "DESCRIPTION"},
            "B": {"value": "UNIT"},
            "C": {"value": "Office"},
            "D": {"value": "AMOUNT"},
            "E": {"value": "Common Area"},
            "F": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 3)

    # ------------------------------------------------------------------ #
    # Pattern 1 top-row last-resort fallback (TS_T2_WEX shape)            #
    # ------------------------------------------------------------------ #

    def test_pattern_1_top_row_fallback_when_bottom_only_reinforces(self):
        """In 2-row mode: P2/P3/P1-bottom all fail; P1 detects areas from top row (last resort)."""
        top_row = _make_row(1, {
            "C": {"value": "Office"},
            "D": {"value": "Common Area"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "QTY"},
            "D": {"value": "QTY"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 1)
        self.assertEqual(result.areas, ["Office", "Common Area"])
        self.assertIsNone(result.amount_columns)
        self.assertEqual(result.detected_on_row, top_row.row_number)

    # ------------------------------------------------------------------ #
    # Reserved-keyword rejection on top-row merges (Morgan Stanley shape) #
    # ------------------------------------------------------------------ #

    def test_reserved_keyword_top_row_merges_rejected_for_pattern_2(self):
        """Top-row merges carrying reserved-keyword values (QUANTITY, RATE) are skipped by P2; P1 on bottom catches the real area names."""
        top_row = _make_row(1, {
            "D": {"value": "QUANTITY", "is_merged_origin": True,  "merged_range": "D1:E1"},
            "E": {"value": "QUANTITY", "is_merged_origin": False, "merged_range": "D1:E1"},
            "F": {"value": "RATE",     "is_merged_origin": True,  "merged_range": "F1:G1"},
            "G": {"value": "RATE",     "is_merged_origin": False, "merged_range": "F1:G1"},
        })
        bottom_row = _make_row(2, {
            "D": {"value": "Office"},
            "E": {"value": "Common Area"},
            "F": {"value": "RATE"},
            "G": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 1)
        self.assertEqual(result.areas, ["Office", "Common Area"])
        self.assertEqual(result.detected_on_row, bottom_row.row_number)

    # ------------------------------------------------------------------ #
    # Defensive cases                                                      #
    # ------------------------------------------------------------------ #

    def test_no_area_columns_returns_none(self):
        """Row containing only reserved keywords has no area candidates → None."""
        row = _make_row(1, {
            "A": {"value": "DESCRIPTION"},
            "B": {"value": "UNIT"},
            "C": {"value": "QTY"},
            "D": {"value": "RATE"},
            "E": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNone(result)

    def test_reserved_keywords_case_insensitive(self):
        """Reserved-keyword matching and TOTAL_QTY_PATTERN are both case-insensitive."""
        row = _make_row(1, {
            "A": {"value": "description"},  # lowercase reserved keyword
            "B": {"value": "Unit"},          # mixed-case reserved keyword
            "C": {"value": "Office"},
            "D": {"value": "Common Area"},
            "E": {"value": "total qty"},     # lowercase terminator
            "F": {"value": "rate"},
            "G": {"value": "Amount"},        # mixed-case reserved keyword
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 1)
        self.assertEqual(result.areas, ["Office", "Common Area"])

    # ------------------------------------------------------------------ #
    # Covered-cell skip regression tests (A3c)                            #
    # ------------------------------------------------------------------ #

    def test_pattern_1_skips_merge_covered_cells_on_top_row(self):
        """P1 top-row fallback skips covered cells; only merge origins contribute area names.

        Regression for the A3b latent bug where _try_pattern_1 would collect
        N x merge_width copies of each area name from a propagated top row.
        """
        top_row = _make_row(1, {
            "C": {"value": "Office",      "is_merged_origin": True,  "merged_range": "C1:D1"},
            "D": {"value": "Office",      "is_merged_origin": False, "merged_range": "C1:D1"},
            "E": {"value": "Common Area", "is_merged_origin": True,  "merged_range": "E1:F1"},
            "F": {"value": "Common Area", "is_merged_origin": False, "merged_range": "E1:F1"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "QTY"},
            "D": {"value": "QTY"},
            "E": {"value": "QTY"},
            "F": {"value": "QTY"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 1)
        self.assertEqual(result.areas, ["Office", "Common Area"])
        self.assertEqual(len(result.qty_columns), 2)
        self.assertIsNone(result.amount_columns)
        self.assertEqual(result.detected_on_row, top_row.row_number)

    def test_pattern_1_treats_origin_cells_normally(self):
        """Origin cells and regular non-merged cells are both collected; only covered cells skipped."""
        row = _make_row(1, {
            "A": {"value": "DESCRIPTION"},
            "B": {"value": "UNIT"},
            "C": {"value": "Office", "is_merged_origin": True, "merged_range": "C1:C1"},
            "D": {"value": "Lobby"},
            "E": {"value": "TOTAL QTY"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 1)
        self.assertEqual(result.areas, ["Office", "Lobby"])
        self.assertEqual(len(result.qty_columns), 2)


if __name__ == "__main__":
    unittest.main()
