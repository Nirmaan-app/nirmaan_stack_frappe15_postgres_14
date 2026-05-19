# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import unittest

from nirmaan_stack.services.boq_parser.config import GlobalSettings
from nirmaan_stack.services.boq_parser.multi_area_detection import (
    MultiAreaPattern,
    _RATE_CELL_PATTERN,
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
        """Top-row merges with QUANTITY/RATE values: P2 skips (reserved), but Phase 1.9o
        tier_a_merged fires first, correctly picking up area names from the bottom row
        under the Qty-family merge. RATE merge over RATE/AMOUNT bottom cells does not
        produce rate_columns (Supply/Install bottom pattern not matched)."""
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
        self.assertEqual(result.pattern, "tier_a_merged")
        self.assertEqual(result.areas, ["Office", "Common Area"])
        self.assertIsNone(result.rate_columns)
        self.assertEqual(result.detected_on_row, top_row.row_number)

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


# ------------------------------------------------------------------
# Reserved-keyword expansion tests (Part B2b-keywords)
# Regression tests for the Snitch Light Fixtures false-positive and
# common Sl.No. / Item header variants.
# ------------------------------------------------------------------

class TestReservedKeywordExpansion(unittest.TestCase):
    """Part B2b-keywords: expanded keyword list — false-positive regression tests."""

    # ------------------------------------------------------------------ #
    # Test 1 — Snitch Light Fixtures regression                            #
    # The B2c verification session found that '7. Light Fixtures' row 2   #
    # triggered a false Pattern 1 match on 'S No.' + 'ITEM'.              #
    # ------------------------------------------------------------------ #

    def test_snitch_light_fixtures_header_no_false_positive(self):
        """Snitch '7. Light Fixtures' row 2 header → None (was false Pattern 1 before fix)."""
        row = _make_row(2, {
            "A": {"value": "S No."},
            "B": {"value": "ITEM"},
            "C": {"value": "UNIT"},
            "D": {"value": "Qty"},
            "E": {"value": "Supply Rate"},
            "F": {"value": "Installation Rate"},
            "G": {"value": "Total Rate (Rs.)"},
            "H": {"value": "As per SNITCH Approved RC Rates"},
            "I": {"value": "AMOUNT"},
            "J": {"value": "Remarks"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNone(result)

    # ------------------------------------------------------------------ #
    # Test 2 — 'Sl.No.' variant                                           #
    # ------------------------------------------------------------------ #

    def test_sl_no_dot_variant_not_detected_as_area(self):
        """Header with 'Sl.No.' as first column → None (reserved, not an area name)."""
        row = _make_row(1, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "UNIT"},
            "D": {"value": "QTY"},
            "E": {"value": "Rate"},
            "F": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNone(result)

    # ------------------------------------------------------------------ #
    # Test 3 — 'Sr No.' variant                                           #
    # ------------------------------------------------------------------ #

    def test_sr_no_variant_not_detected_as_area(self):
        """Header with 'Sr No.' as first column → None (reserved, not an area name)."""
        row = _make_row(1, {
            "A": {"value": "Sr No."},
            "B": {"value": "Description"},
            "C": {"value": "UNIT"},
            "D": {"value": "QTY"},
            "E": {"value": "Rate"},
            "F": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNone(result)

    # ------------------------------------------------------------------ #
    # Test 4 — 'Item Description' variant                                  #
    # ------------------------------------------------------------------ #

    def test_item_description_variant_not_detected_as_area(self):
        """'S.No.' + 'Item Description' header → None (both reserved, no area candidates)."""
        row = _make_row(1, {
            "A": {"value": "S.No."},
            "B": {"value": "Item Description"},
            "C": {"value": "UNIT"},
            "D": {"value": "QTY"},
            "E": {"value": "Rate"},
            "F": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNone(result)

    # ------------------------------------------------------------------ #
    # Test 5 — Case-insensitivity smoke for new keywords                   #
    # ------------------------------------------------------------------ #

    def test_new_keywords_case_insensitive(self):
        """Lowercase 'item' and 's no' are also reserved (case-insensitive match)."""
        row = _make_row(1, {
            "A": {"value": "s no"},
            "B": {"value": "item"},
            "C": {"value": "UNIT"},
            "D": {"value": "QTY"},
            "E": {"value": "Rate"},
            "F": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNone(result)


class TestReservedKeywordExpansionPhase2c(unittest.TestCase):
    """Phase 2c expansion: 71 new keywords (49→120) + _is_reserved normalization."""

    # ---------------------------------------------------------------------- #
    # Tests 1-2: Bucket 1 — quantity/measurement variants                     #
    # ---------------------------------------------------------------------- #

    def test_sqft_and_running_mt_not_detected_as_areas(self):
        """SQFT and RUNNING MT are reserved after expansion; false positive suppressed."""
        row = _make_row(1, {
            "A": {"value": "SL.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "UNIT"},
            "D": {"value": "SQFT"},
            "E": {"value": "RUNNING MT"},
            "F": {"value": "QTY"},
            "G": {"value": "AMOUNT"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    def test_sq_ft_space_variant_not_detected_as_area(self):
        """'SQ FT' (with space) is reserved after expansion."""
        row = _make_row(1, {
            "A": {"value": "S.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "SQ FT"},
            "D": {"value": "RUNNING FT"},
            "E": {"value": "QTY"},
            "F": {"value": "AMOUNT"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    # ---------------------------------------------------------------------- #
    # Tests 3-4: Bucket 4 — structural / specification columns                #
    # ---------------------------------------------------------------------- #

    def test_make_and_brand_not_detected_as_areas(self):
        """MAKE and BRAND are reserved after expansion; false positive suppressed."""
        row = _make_row(1, {
            "A": {"value": "S.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "UNIT"},
            "D": {"value": "MAKE"},
            "E": {"value": "BRAND"},
            "F": {"value": "QTY"},
            "G": {"value": "AMOUNT"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    def test_specification_variants_not_detected_as_areas(self):
        """SPECIFICATION and SPECS are reserved after expansion."""
        row = _make_row(1, {
            "A": {"value": "S.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "SPECIFICATION"},
            "D": {"value": "SPECS"},
            "E": {"value": "QTY"},
            "F": {"value": "AMOUNT"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    # ---------------------------------------------------------------------- #
    # Tests 5-6: Bucket 4 — structural (FLOOR, SUBJECT, PARTICULARS)         #
    # ---------------------------------------------------------------------- #

    def test_floor_and_location_not_detected_as_areas(self):
        """FLOOR and LOCATION are reserved after expansion."""
        row = _make_row(1, {
            "A": {"value": "SL.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "FLOOR"},
            "D": {"value": "LOCATION"},
            "E": {"value": "QTY"},
            "F": {"value": "AMOUNT"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    def test_subject_and_particulars_not_detected_as_areas(self):
        """SUBJECT and PARTICULARS are reserved after expansion."""
        row = _make_row(1, {
            "A": {"value": "S.NO"},
            "B": {"value": "SUBJECT"},
            "C": {"value": "PARTICULARS"},
            "D": {"value": "UNIT"},
            "E": {"value": "QTY"},
            "F": {"value": "AMOUNT"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    # ---------------------------------------------------------------------- #
    # Tests 7-8: Bucket 5 + 6 — DSR/SOR and SUMMARY/GRAND TOTAL              #
    # ---------------------------------------------------------------------- #

    def test_dsr_and_sor_not_detected_as_areas(self):
        """DSR and SOR are reserved after expansion."""
        row = _make_row(1, {
            "A": {"value": "SL.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "UNIT"},
            "D": {"value": "DSR"},
            "E": {"value": "SOR"},
            "F": {"value": "QTY"},
            "G": {"value": "AMOUNT"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    def test_summary_and_grand_total_not_detected_as_areas(self):
        """SUMMARY and GRAND TOTAL are reserved after expansion."""
        row = _make_row(1, {
            "A": {"value": "SL.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "UNIT"},
            "D": {"value": "SUMMARY"},
            "E": {"value": "GRAND TOTAL"},
            "F": {"value": "QTY"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    # ---------------------------------------------------------------------- #
    # Tests 9-11: _is_reserved normalization                                  #
    # ---------------------------------------------------------------------- #

    def test_parenthetical_amount_inr_is_reserved(self):
        """'AMOUNT (INR)' is reserved via trailing-parenthetical strip to 'AMOUNT'."""
        row = _make_row(1, {
            "A": {"value": "S.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "UNIT"},
            "D": {"value": "AMOUNT (INR)"},
            "E": {"value": "RATE (RS)"},
            "F": {"value": "QTY"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    def test_whitespace_normalization_double_space(self):
        """'GRAND  TOTAL' (double space) normalizes to 'GRAND TOTAL' and is reserved."""
        row = _make_row(1, {
            "A": {"value": "S.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "GRAND  TOTAL"},
            "D": {"value": "NET  TOTAL"},
            "E": {"value": "QTY"},
            "F": {"value": "AMOUNT"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    def test_whitespace_normalization_with_newline(self):
        """Embedded newline in 'GRAND\\nTOTAL' normalizes to 'GRAND TOTAL' and is reserved."""
        row = _make_row(1, {
            "A": {"value": "S.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "GRAND\nTOTAL"},
            "D": {"value": "NET\nAMOUNT"},
            "E": {"value": "QTY"},
            "F": {"value": "AMOUNT"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    # ---------------------------------------------------------------------- #
    # Tests 12-15: Legitimate area names preserved                            #
    # ---------------------------------------------------------------------- #

    def test_kitchen_and_master_bedroom_detected_as_areas(self):
        """Room names KITCHEN and MASTER BEDROOM are not reserved and are detected."""
        row = _make_row(1, {
            "A": {"value": "S.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "UNIT"},
            "D": {"value": "KITCHEN"},
            "E": {"value": "MASTER BEDROOM"},
            "F": {"value": "QTY"},
            "G": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertIn("KITCHEN", result.areas)
        self.assertIn("MASTER BEDROOM", result.areas)

    def test_ground_floor_and_first_floor_detected_as_areas(self):
        """'GROUND FLOOR' and 'FIRST FLOOR' are not reserved (only bare 'FLOOR' is)."""
        row = _make_row(1, {
            "A": {"value": "S.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "UNIT"},
            "D": {"value": "GROUND FLOOR"},
            "E": {"value": "FIRST FLOOR"},
            "F": {"value": "QTY"},
            "G": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertIn("GROUND FLOOR", result.areas)
        self.assertIn("FIRST FLOOR", result.areas)

    def test_jsw_mep_summary_excluded_legitimate_areas_preserved(self):
        """SUMMARY is reserved (Bucket 6) but B1/B2/B3/B6/CONTROL/LAB are not; 6 areas detected."""
        row = _make_row(1, {
            "A": {"value": "SL NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "UNIT"},
            "D": {"value": "SUMMARY"},
            "E": {"value": "B1"},
            "F": {"value": "B2"},
            "G": {"value": "B3"},
            "H": {"value": "B6"},
            "I": {"value": "CONTROL"},
            "J": {"value": "LAB"},
            "K": {"value": "QTY"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertEqual(sorted(result.areas), ["B1", "B2", "B3", "B6", "CONTROL", "LAB"])

    def test_zone_names_detected_as_areas(self):
        """ZONE A, ZONE B, ZONE C are not reserved and are detected as legitimate areas."""
        row = _make_row(1, {
            "A": {"value": "S.NO"},
            "B": {"value": "DESCRIPTION"},
            "C": {"value": "UNIT"},
            "D": {"value": "ZONE A"},
            "E": {"value": "ZONE B"},
            "F": {"value": "ZONE C"},
            "G": {"value": "QTY"},
            "H": {"value": "AMOUNT"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertIn("ZONE A", result.areas)
        self.assertIn("ZONE B", result.areas)


class TestReservedKeywordExpansionPhase2cSitcAndCombinedRoles(unittest.TestCase):
    """Phase 2c §9 #48 expansion — SITC/S&I, combined-role labels, IN INR variants."""

    # ---------------------------------------------------------------- #
    # Test 1 — SITC Rate / SITC Amount reserved                         #
    # ---------------------------------------------------------------- #

    def test_sitc_rate_amount_header_no_false_positive(self):
        """SITC Rate and SITC Amount are now reserved; no false-positive area detection."""
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty"},
            "E": {"value": "SITC Rate"},
            "F": {"value": "SITC Amount"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    # ---------------------------------------------------------------- #
    # Test 2 — Supply & Installation labels reserved                    #
    # ---------------------------------------------------------------- #

    def test_supply_and_installation_merged_header_no_false_positive(self):
        """'Supply & Installation Rate/Amount' are now reserved."""
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty"},
            "E": {"value": "Supply & Installation Rate"},
            "F": {"value": "Supply & Installation Amount"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    # ---------------------------------------------------------------- #
    # Test 3 — UOM header label reserved (pre-existing, regression)     #
    # ---------------------------------------------------------------- #

    def test_uom_header_label_reserved(self):
        """UOM column header is reserved; not detected as a candidate area."""
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "UOM"},
            "D": {"value": "Qty"},
            "E": {"value": "Rate"},
            "F": {"value": "Amount"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    # ---------------------------------------------------------------- #
    # Test 4 — Rate in INR / Amount in INR reserved                     #
    # ---------------------------------------------------------------- #

    def test_rate_in_inr_amount_in_inr_no_false_positive(self):
        """'Rate in INR' and 'Amount in INR' are now reserved."""
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty"},
            "E": {"value": "Rate in INR"},
            "F": {"value": "Amount in INR"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    # ---------------------------------------------------------------- #
    # Test 5 — AS PER BOQ TOTAL AMOUNT reserved                         #
    # ---------------------------------------------------------------- #

    def test_as_per_boq_total_amount_reserved(self):
        """'As Per BOQ Total Amount' compound is now reserved."""
        row = _make_row(1, {
            "A": {"value": "Sl. No."},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty"},
            "E": {"value": "Rate"},
            "F": {"value": "As Per BOQ Total Amount"},
        })
        self.assertIsNone(detect_multi_area_pattern(row, _KWS))

    # ---------------------------------------------------------------- #
    # Test 6 — Legitimate multi-area still detected (smoke)             #
    # ---------------------------------------------------------------- #

    def test_existing_legitimate_multi_area_still_detected(self):
        """Pattern 1 with non-reserved area names still detected after expansion."""
        row = _make_row(1, {
            "A": {"value": "Sl.No"},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Floor 1"},
            "E": {"value": "Floor 2"},
            "F": {"value": "Qty"},
        })
        result = detect_multi_area_pattern(row, _KWS)
        self.assertIsNotNone(result)
        self.assertIn("Floor 1", result.areas)
        self.assertIn("Floor 2", result.areas)


class TestPattern2Rate(unittest.TestCase):
    """Phase 1.9a — Pattern 2-rate: 3-col-per-area merged header [Qty | Rate | Amount]."""

    # ------------------------------------------------------------------ #
    # Test 1 — 2-area cluster detected                                    #
    # ------------------------------------------------------------------ #

    def test_pattern_2_rate_2_area_cluster_detected(self):
        """Two 3-col merges with [Qty|Rate|Amount] bottom labels → pattern_2_rate; rate_columns populated."""
        top_row = _make_row(1, {
            "C": {"value": "PHASE-1", "is_merged_origin": True,  "merged_range": "C1:E1"},
            "D": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "E": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "F": {"value": "PHASE-2", "is_merged_origin": True,  "merged_range": "F1:H1"},
            "G": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
            "H": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "Qty"},
            "D": {"value": "Rate"},
            "E": {"value": "Amount"},
            "F": {"value": "Qty"},
            "G": {"value": "Rate"},
            "H": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "pattern_2_rate")
        self.assertEqual(result.areas, ["PHASE-1", "PHASE-2"])
        self.assertIsNotNone(result.rate_columns)
        self.assertEqual(len(result.qty_columns), 2)
        self.assertEqual(len(result.rate_columns), 2)
        self.assertIsNotNone(result.amount_columns)
        self.assertEqual(len(result.amount_columns), 2)
        # Column index assertions (C=3, D=4, E=5, F=6, G=7, H=8)
        self.assertEqual(result.qty_columns[0], 3)
        self.assertEqual(result.rate_columns[0], 4)
        self.assertEqual(result.amount_columns[0], 5)
        self.assertEqual(result.qty_columns[1], 6)
        self.assertEqual(result.rate_columns[1], 7)
        self.assertEqual(result.amount_columns[1], 8)

    # ------------------------------------------------------------------ #
    # Test 2 — 3-area cluster detected, left-to-right order              #
    # ------------------------------------------------------------------ #

    def test_pattern_2_rate_3_area_cluster_detected(self):
        """Three 3-col merges → pattern_2_rate with all three areas in left-to-right order."""
        top_row = _make_row(1, {
            "C": {"value": "PHASE-1", "is_merged_origin": True,  "merged_range": "C1:E1"},
            "D": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "E": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "F": {"value": "PHASE-2", "is_merged_origin": True,  "merged_range": "F1:H1"},
            "G": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
            "H": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
            "I": {"value": "PHASE-3", "is_merged_origin": True,  "merged_range": "I1:K1"},
            "J": {"value": "PHASE-3", "is_merged_origin": False, "merged_range": "I1:K1"},
            "K": {"value": "PHASE-3", "is_merged_origin": False, "merged_range": "I1:K1"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "Qty"},
            "D": {"value": "Rate"},
            "E": {"value": "Amount"},
            "F": {"value": "Qty"},
            "G": {"value": "Rate"},
            "H": {"value": "Amount"},
            "I": {"value": "Qty"},
            "J": {"value": "Rate"},
            "K": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "pattern_2_rate")
        self.assertEqual(result.areas, ["PHASE-1", "PHASE-2", "PHASE-3"])
        self.assertEqual(len(result.qty_columns), 3)
        self.assertIsNotNone(result.rate_columns)
        self.assertEqual(len(result.rate_columns), 3)
        self.assertIsNotNone(result.amount_columns)
        self.assertEqual(len(result.amount_columns), 3)

    # ------------------------------------------------------------------ #
    # Test 3 — textbook Pattern 2 not false-positive as pattern_2_rate   #
    # ------------------------------------------------------------------ #

    def test_textbook_pattern_2_does_not_false_positive_as_pattern_2_rate(self):
        """Two 2-col merges with [Qty|Amount] only (not [Qty|Rate|Amount]) → Pattern 2, NOT pattern_2_rate."""
        top_row = _make_row(1, {
            "C": {"value": "PHASE-1", "is_merged_origin": True,  "merged_range": "C1:D1"},
            "D": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:D1"},
            "E": {"value": "PHASE-2", "is_merged_origin": True,  "merged_range": "E1:F1"},
            "F": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "E1:F1"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "Qty"},
            "D": {"value": "Amount"},
            "E": {"value": "Qty"},
            "F": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, 2)   # classic Pattern 2, not "pattern_2_rate"
        self.assertIsNone(result.rate_columns)

    # ------------------------------------------------------------------ #
    # Test 4 — RATES plural header accepted (F3b §9 #62 CLOSED)          #
    # ------------------------------------------------------------------ #

    def test_pattern_2_rate_detects_rates_plural_header(self):
        """F3b CLOSED (§9 #62, Phase 1.9d): RATES plural in rate header cell now matches."""
        top_row = _make_row(1, {
            "C": {"value": "PHASE-1", "is_merged_origin": True,  "merged_range": "C1:E1"},
            "D": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "E": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "F": {"value": "PHASE-2", "is_merged_origin": True,  "merged_range": "F1:H1"},
            "G": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
            "H": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "Qty"},
            "D": {"value": "RATES"},   # plural — was rejected before F3b fix
            "E": {"value": "Amount"},
            "F": {"value": "Qty"},
            "G": {"value": "RATES"},   # plural — was rejected before F3b fix
            "H": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "pattern_2_rate")
        self.assertEqual(result.areas, ["PHASE-1", "PHASE-2"])
        self.assertIsNotNone(result.rate_columns)
        self.assertEqual(len(result.rate_columns), 2)

    # ------------------------------------------------------------------ #
    # Test 5 — reserved keyword blocks detection (insufficient areas)    #
    # ------------------------------------------------------------------ #

    def test_pattern_2_rate_reserved_keyword_blocks_detection(self):
        """Top-row merge with reserved-keyword label ('AREA') skipped; only 1 valid area → None returned."""
        top_row = _make_row(1, {
            "C": {"value": "AREA",   "is_merged_origin": True,  "merged_range": "C1:E1"},
            "D": {"value": "AREA",   "is_merged_origin": False, "merged_range": "C1:E1"},
            "E": {"value": "AREA",   "is_merged_origin": False, "merged_range": "C1:E1"},
            "F": {"value": "PHASE-2","is_merged_origin": True,  "merged_range": "F1:H1"},
            "G": {"value": "PHASE-2","is_merged_origin": False, "merged_range": "F1:H1"},
            "H": {"value": "PHASE-2","is_merged_origin": False, "merged_range": "F1:H1"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "Qty"},
            "D": {"value": "Rate"},
            "E": {"value": "Amount"},
            "F": {"value": "Qty"},
            "G": {"value": "Rate"},
            "H": {"value": "Amount"},
        })
        # Pattern 2-rate: "AREA" is reserved → only PHASE-2 qualifies → 1 area < 2 → None.
        # Pattern 2: same issue + 3-col merges fail the span==2 guard → None.
        # Pattern 3/1 on bottom: all cells are reserved keywords → None.
        # Pattern 1 on top: only PHASE-2 origin is non-reserved → 1 area < 2 → None.
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNone(result)


class TestPhase1_9kF3cBroadenedRateCellPattern(unittest.TestCase):
    """Phase 1.9k F3c — _RATE_CELL_PATTERN broadened from anchored bare-word to
    word-boundary family (rate/cost/price). Empirical basis: 62 cases from Phase 1.9e."""

    # ---------------------------------------------------------------- #
    # Tests 1-5 — new rate/cost/price family matches                    #
    # ---------------------------------------------------------------- #

    def test_per_unit_rate_matches_rate_cell_pattern(self):
        """'Per Unit Rate' matches via word boundary on 'Rate'."""
        self.assertIsNotNone(_RATE_CELL_PATTERN.search("Per Unit Rate"))

    def test_supply_rate_matches_rate_cell_pattern(self):
        """'Supply Rate' matches via word boundary on 'Rate'."""
        self.assertIsNotNone(_RATE_CELL_PATTERN.search("Supply Rate"))

    def test_rate_inr_parenthetical_matches_rate_cell_pattern(self):
        """'Rate (INR)' matches — rate word is at start before parenthetical."""
        self.assertIsNotNone(_RATE_CELL_PATTERN.search("Rate (INR)"))

    def test_unit_cost_matches_rate_cell_pattern(self):
        """'Unit Cost' matches via word boundary on 'Cost'."""
        self.assertIsNotNone(_RATE_CELL_PATTERN.search("Unit Cost"))

    def test_unit_price_matches_rate_cell_pattern(self):
        """'Unit Price' matches via word boundary on 'Price'."""
        self.assertIsNotNone(_RATE_CELL_PATTERN.search("Unit Price"))

    # ---------------------------------------------------------------- #
    # Tests 6-7 — regression guards (bare Rate/Rates still match)       #
    # ---------------------------------------------------------------- #

    def test_bare_rate_still_matches(self):
        """'Rate' (bare) still matches — regression guard."""
        self.assertIsNotNone(_RATE_CELL_PATTERN.search("Rate"))

    def test_bare_rates_plural_still_matches(self):
        """'Rates' (plural) still matches — regression guard (F3b fix preserved)."""
        self.assertIsNotNone(_RATE_CELL_PATTERN.search("Rates"))

    # ---------------------------------------------------------------- #
    # Test 8 — word boundary: "Costing" does NOT match                  #
    # ---------------------------------------------------------------- #

    def test_costing_does_NOT_match_word_boundary_check(self):
        """'Costing' does NOT match — 'cost' is not a standalone word in 'Costing'."""
        self.assertIsNone(_RATE_CELL_PATTERN.search("Costing"))

    # ---------------------------------------------------------------- #
    # Test 9 — unrelated text does not match                            #
    # ---------------------------------------------------------------- #

    def test_unrelated_text_does_not_match(self):
        """'Description' does not match any rate/cost/price family word."""
        self.assertIsNone(_RATE_CELL_PATTERN.search("Description"))

    # ---------------------------------------------------------------- #
    # Test 10 — integration: "Per Unit Rate" in rate cell → pattern_2_rate detected
    # ---------------------------------------------------------------- #

    def test_per_unit_rate_in_bottom_row_triggers_pattern_2_rate(self):
        """'Per Unit Rate' in the rate-position of a 3-col merge → pattern_2_rate detected."""
        top_row = _make_row(1, {
            "C": {"value": "PHASE-1", "is_merged_origin": True,  "merged_range": "C1:E1"},
            "D": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "E": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "F": {"value": "PHASE-2", "is_merged_origin": True,  "merged_range": "F1:H1"},
            "G": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
            "H": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "Qty"},
            "D": {"value": "Per Unit Rate"},  # F3c: now accepted
            "E": {"value": "Amount"},
            "F": {"value": "Qty"},
            "G": {"value": "Per Unit Rate"},  # F3c: now accepted
            "H": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "pattern_2_rate")
        self.assertEqual(result.areas, ["PHASE-1", "PHASE-2"])
        self.assertIsNotNone(result.rate_columns)
        self.assertEqual(len(result.rate_columns), 2)

    # ---------------------------------------------------------------- #
    # Test 11 — "Unit Cost" in bottom row triggers pattern_2_rate       #
    # ---------------------------------------------------------------- #

    def test_unit_cost_in_bottom_row_triggers_pattern_2_rate(self):
        """'Unit Cost' in rate-position cell → pattern_2_rate (cost family match)."""
        top_row = _make_row(1, {
            "C": {"value": "PHASE-1", "is_merged_origin": True,  "merged_range": "C1:E1"},
            "D": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "E": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "F": {"value": "PHASE-2", "is_merged_origin": True,  "merged_range": "F1:H1"},
            "G": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
            "H": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "Qty"},
            "D": {"value": "Unit Cost"},    # F3c: cost family accepted
            "E": {"value": "Amount"},
            "F": {"value": "Qty"},
            "G": {"value": "Unit Cost"},    # F3c: cost family accepted
            "H": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "pattern_2_rate")


class TestTryTierAMerged(unittest.TestCase):
    """Phase 1.9o: _try_tier_a_merged and its routing in detect_multi_area_pattern."""

    # ------------------------------------------------------------------
    # Qty-merged-over-areas sub-shape
    # ------------------------------------------------------------------

    def test_qty_merged_two_areas_returns_pattern(self):
        """Merged 'Qty' over two area cells yields tier_a_merged with 2 areas."""
        top_row = _make_row(1, {
            "A": {"value": "Qty", "is_merged_origin": True, "merged_range": "A1:B1"},
            "B": {"value": "Qty", "is_merged_origin": False, "merged_range": "A1:B1"},
        })
        bottom_row = _make_row(2, {
            "A": {"value": "Area 1"},
            "B": {"value": "Area 2"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "tier_a_merged")
        self.assertEqual(result.areas, ["Area 1", "Area 2"])
        self.assertEqual(result.qty_columns, [1, 2])
        self.assertIsNone(result.rate_columns)
        self.assertIsNone(result.amount_columns)

    def test_qty_merged_three_areas(self):
        """Merged 'Quantity' over three area cells yields 3 areas."""
        top_row = _make_row(1, {
            "C": {"value": "Quantity", "is_merged_origin": True, "merged_range": "C1:E1"},
            "D": {"value": "Quantity", "is_merged_origin": False, "merged_range": "C1:E1"},
            "E": {"value": "Quantity", "is_merged_origin": False, "merged_range": "C1:E1"},
        })
        bottom_row = _make_row(2, {
            "C": {"value": "Block A"},
            "D": {"value": "Block B"},
            "E": {"value": "Block C"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "tier_a_merged")
        self.assertEqual(len(result.areas), 3)

    def test_qty_merged_fewer_than_two_area_cells_returns_none(self):
        """Merged 'Qty' spanning only 1 non-reserved bottom cell returns None."""
        top_row = _make_row(1, {
            "A": {"value": "Qty", "is_merged_origin": True, "merged_range": "A1:B1"},
            "B": {"value": "Qty", "is_merged_origin": False, "merged_range": "A1:B1"},
        })
        bottom_row = _make_row(2, {
            "A": {"value": "Area 1"},
            "B": {"value": "Qty"},   # reserved keyword — excluded
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNone(result)

    def test_qty_merged_reserved_area_cell_invalidates(self):
        """If any bottom cell under the Qty merge is reserved, the whole merge is rejected."""
        top_row = _make_row(1, {
            "A": {"value": "Qty", "is_merged_origin": True, "merged_range": "A1:C1"},
            "B": {"value": "Qty", "is_merged_origin": False, "merged_range": "A1:C1"},
            "C": {"value": "Qty", "is_merged_origin": False, "merged_range": "A1:C1"},
        })
        bottom_row = _make_row(2, {
            "A": {"value": "Area 1"},
            "B": {"value": "Amount"},   # reserved — breaks the run
            "C": {"value": "Area 2"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNone(result)

    def test_no_qty_merge_returns_none(self):
        """If the top row has no Qty/Rate/Amount merged cells, returns None (falls through)."""
        top_row = _make_row(1, {
            "A": {"value": "S.No.", "is_merged_origin": True, "merged_range": "A1:B1"},
            "B": {"value": "S.No.", "is_merged_origin": False, "merged_range": "A1:B1"},
        })
        bottom_row = _make_row(2, {
            "A": {"value": "Area 1"},
            "B": {"value": "Area 2"},
        })
        # No Qty-family merge -> tier_a_merged returns None; Pattern 1 may pick it up
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        # Result may be Pattern 1 or None; just not tier_a_merged
        if result is not None:
            self.assertNotEqual(result.pattern, "tier_a_merged")

    # ------------------------------------------------------------------
    # Rate/Amount-merged-over-Supply/Install sub-shape
    # ------------------------------------------------------------------

    def test_qty_plus_rate_supply_install_pairs_rate_columns(self):
        """Merged Rate over Supply+Install col is paired with 2 areas -> rate_columns set."""
        top_row = _make_row(1, {
            "A": {"value": "Qty", "is_merged_origin": True, "merged_range": "A1:B1"},
            "B": {"value": "Qty", "is_merged_origin": False, "merged_range": "A1:B1"},
            "C": {"value": "Rate (In Rs.)", "is_merged_origin": True, "merged_range": "C1:D1"},
            "D": {"value": "Rate (In Rs.)", "is_merged_origin": False, "merged_range": "C1:D1"},
        })
        bottom_row = _make_row(2, {
            "A": {"value": "Area 1"},
            "B": {"value": "Area 2"},
            "C": {"value": "Supply"},
            "D": {"value": "Installation"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "tier_a_merged")
        self.assertEqual(result.rate_columns, [3, 4])

    def test_qty_plus_amount_supply_install_pairs_amount_columns(self):
        """Merged Amount over Supply+Install is paired with 2 areas -> amount_columns set."""
        top_row = _make_row(1, {
            "A": {"value": "Qty", "is_merged_origin": True, "merged_range": "A1:B1"},
            "B": {"value": "Qty", "is_merged_origin": False, "merged_range": "A1:B1"},
            "C": {"value": "Amount (In Rs.)", "is_merged_origin": True, "merged_range": "C1:D1"},
            "D": {"value": "Amount (In Rs.)", "is_merged_origin": False, "merged_range": "C1:D1"},
        })
        bottom_row = _make_row(2, {
            "A": {"value": "Area 1"},
            "B": {"value": "Area 2"},
            "C": {"value": "Supply"},
            "D": {"value": "Installation"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "tier_a_merged")
        self.assertEqual(result.amount_columns, [3, 4])

    def test_rate_cols_not_paired_when_count_mismatch(self):
        """3 areas but only 2 rate supply/install cols -> rate_columns is None."""
        top_row = _make_row(1, {
            "A": {"value": "Qty", "is_merged_origin": True, "merged_range": "A1:C1"},
            "B": {"value": "Qty", "is_merged_origin": False, "merged_range": "A1:C1"},
            "C": {"value": "Qty", "is_merged_origin": False, "merged_range": "A1:C1"},
            "D": {"value": "Rate", "is_merged_origin": True, "merged_range": "D1:E1"},
            "E": {"value": "Rate", "is_merged_origin": False, "merged_range": "D1:E1"},
        })
        bottom_row = _make_row(2, {
            "A": {"value": "Zone A"},
            "B": {"value": "Zone B"},
            "C": {"value": "Zone C"},
            "D": {"value": "Supply"},
            "E": {"value": "Installation"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "tier_a_merged")
        self.assertEqual(len(result.areas), 3)
        self.assertIsNone(result.rate_columns)

    def test_rate_merge_wrong_order_install_supply_not_matched(self):
        """Install then Supply order does not match -> rate_columns is None."""
        top_row = _make_row(1, {
            "A": {"value": "Qty", "is_merged_origin": True, "merged_range": "A1:B1"},
            "B": {"value": "Qty", "is_merged_origin": False, "merged_range": "A1:B1"},
            "C": {"value": "Rate", "is_merged_origin": True, "merged_range": "C1:D1"},
            "D": {"value": "Rate", "is_merged_origin": False, "merged_range": "C1:D1"},
        })
        bottom_row = _make_row(2, {
            "A": {"value": "Area 1"},
            "B": {"value": "Area 2"},
            "C": {"value": "Installation"},   # reversed
            "D": {"value": "Supply"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "tier_a_merged")
        self.assertIsNone(result.rate_columns)

    # ------------------------------------------------------------------
    # Full v1-shape: Qty + Rate + Amount merges together
    # ------------------------------------------------------------------

    def test_full_v1_shape_qty_rate_amount_all_paired(self):
        """Full v1 fixture shape: QTY/Rate/Amount merges + Area 1/Area 2."""
        top_row = _make_row(1, {
            "E": {"value": "QTY.", "is_merged_origin": True, "merged_range": "E1:F1"},
            "F": {"value": "QTY.", "is_merged_origin": False, "merged_range": "E1:F1"},
            "G": {"value": "Rate (In Rs.)", "is_merged_origin": True, "merged_range": "G1:H1"},
            "H": {"value": "Rate (In Rs.)", "is_merged_origin": False, "merged_range": "G1:H1"},
            "I": {"value": "Amount (In Rs.)", "is_merged_origin": True, "merged_range": "I1:J1"},
            "J": {"value": "Amount (In Rs.)", "is_merged_origin": False, "merged_range": "I1:J1"},
        })
        bottom_row = _make_row(2, {
            "E": {"value": "Area 1"},
            "F": {"value": "Area 2"},
            "G": {"value": "Supply "},
            "H": {"value": "Installation"},
            "I": {"value": "Supply "},
            "J": {"value": "Installation"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertIsNotNone(result)
        self.assertEqual(result.pattern, "tier_a_merged")
        self.assertEqual(result.areas, ["Area 1", "Area 2"])
        self.assertEqual(result.qty_columns, [5, 6])
        self.assertEqual(result.rate_columns, [7, 8])
        self.assertEqual(result.amount_columns, [9, 10])
        self.assertEqual(result.detected_on_row, 1)

    # ------------------------------------------------------------------
    # Routing: tier_a_merged fires before pattern_2_rate
    # ------------------------------------------------------------------

    def test_tier_a_merged_fires_before_pattern_2_rate(self):
        """Tier A-merged is attempted before Pattern 2-rate in routing priority."""
        # Build a row that matches both tier_a_merged AND pattern_2_rate.
        # Pattern 2-rate expects 3-col merges with area name on top.
        # tier_a_merged expects Qty/Rate/Amount keyword on top.
        # Use the v1 shape which is unambiguously tier_a_merged.
        top_row = _make_row(1, {
            "E": {"value": "QTY.", "is_merged_origin": True, "merged_range": "E1:F1"},
            "F": {"value": "QTY.", "is_merged_origin": False, "merged_range": "E1:F1"},
            "G": {"value": "Rate (In Rs.)", "is_merged_origin": True, "merged_range": "G1:H1"},
            "H": {"value": "Rate (In Rs.)", "is_merged_origin": False, "merged_range": "G1:H1"},
            "I": {"value": "Amount (In Rs.)", "is_merged_origin": True, "merged_range": "I1:J1"},
            "J": {"value": "Amount (In Rs.)", "is_merged_origin": False, "merged_range": "I1:J1"},
        })
        bottom_row = _make_row(2, {
            "E": {"value": "Area 1"},
            "F": {"value": "Area 2"},
            "G": {"value": "Supply"},
            "H": {"value": "Installation"},
            "I": {"value": "Supply"},
            "J": {"value": "Installation"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=top_row)
        self.assertEqual(result.pattern, "tier_a_merged")

    # ------------------------------------------------------------------
    # Single-row mode: tier_a_merged not attempted
    # ------------------------------------------------------------------

    def test_single_row_mode_does_not_invoke_tier_a_merged(self):
        """Without top_header_row, routing stays in 1-row path (Pattern 3 or 1)."""
        bottom_row = _make_row(1, {
            "A": {"value": "Area 1"},
            "B": {"value": "Amount"},
            "C": {"value": "Area 2"},
            "D": {"value": "Amount"},
        })
        result = detect_multi_area_pattern(bottom_row, _KWS, top_header_row=None)
        # Pattern 3 should fire; definitely not tier_a_merged
        self.assertIsNotNone(result)
        self.assertNotEqual(result.pattern, "tier_a_merged")


if __name__ == "__main__":
    unittest.main()
