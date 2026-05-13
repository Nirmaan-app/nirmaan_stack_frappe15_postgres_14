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


if __name__ == "__main__":
    unittest.main()
