# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""
Tests for nirmaan_stack.services.boq_parser._auto_guess.

Phase 1.9h: validates auto_guess_sheet_config() for all four multi-area
patterns at header_row_count=2, single-area at header_row_count=1, override
semantics, singleton guard, and area_dimensions population.
"""

import unittest
from unittest.mock import MagicMock

from nirmaan_stack.services.boq_parser._auto_guess import auto_guess_sheet_config
from nirmaan_stack.services.boq_parser.config import GlobalSettings
from nirmaan_stack.services.boq_parser.reader import CellInfo, RawRow


# -----------------------------------------------------------------------
# Shared helpers
# -----------------------------------------------------------------------

def _make_row(row_number: int, cells: dict[str, dict]) -> RawRow:
    """Build a RawRow from a plain dict of column → property dicts."""
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


def _make_reader(rows: dict[int, RawRow]) -> MagicMock:
    """Return a mock BoqReader that yields pre-built RawRows by row number."""
    reader = MagicMock()
    def _iter(sheet_name, start_row, end_row):
        return [rows[r] for r in range(start_row, end_row + 1) if r in rows]
    reader.iter_rows.side_effect = _iter
    return reader


_KWS = GlobalSettings().multi_area_reserved_keywords
_SHEET = "TestSheet"


def _call(reader, header_row: int, header_row_count: int):
    return auto_guess_sheet_config(reader, _SHEET, header_row, header_row_count, _KWS)


# -----------------------------------------------------------------------
# Single-area (header_row_count=1)
# -----------------------------------------------------------------------

class TestAutoGuessSingleArea(unittest.TestCase):

    def setUp(self):
        self.bottom = _make_row(1, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty"},
            "E": {"value": "Rate"},
            "F": {"value": "Amount"},
        })
        self.reader = _make_reader({1: self.bottom})
        self.sc = _call(self.reader, header_row=1, header_row_count=1)

    def test_single_area_assigns_universal_roles_only(self):
        """hrc=1: standard header row gets universal roles assigned."""
        crm = self.sc.column_role_map
        role_names = {cr.role for cr in crm.values()}
        self.assertIn("sl_no", role_names)
        self.assertIn("description", role_names)
        self.assertIn("unit", role_names)

    def test_single_area_does_not_assign_per_area_roles(self):
        """hrc=1: no per-area roles (area=None on every ColumnRole)."""
        for cr in self.sc.column_role_map.values():
            self.assertIsNone(
                cr.area,
                f"role={cr.role} unexpectedly has area set in single-area mode",
            )
        self.assertEqual(self.sc.area_dimensions, [])


# -----------------------------------------------------------------------
# Pattern 2 — two-row merged header, 2 cols per area (qty + amount)
# -----------------------------------------------------------------------

class TestAutoGuessPattern2(unittest.TestCase):
    """
    Layout:
      Row 1 (top): A="Sl.No." B="Description" C:D="Block A" E:F="Block B" G="Rate" H="Total"
      Row 2 (bottom, header_row=2): A B C="Qty" D="Amount" E="Qty" F="Amount" G="Rate" H="Total"
    """

    def setUp(self):
        self.top = _make_row(1, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Block A", "is_merged_origin": True, "merged_range": "C1:D1"},
            "D": {"value": "Block A", "is_merged_origin": False, "merged_range": "C1:D1"},
            "E": {"value": "Block B", "is_merged_origin": True, "merged_range": "E1:F1"},
            "F": {"value": "Block B", "is_merged_origin": False, "merged_range": "E1:F1"},
            "G": {"value": "Rate"},
            "H": {"value": "Total"},
        })
        self.bottom = _make_row(2, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Qty"},
            "D": {"value": "Amount"},
            "E": {"value": "Qty"},
            "F": {"value": "Amount"},
            "G": {"value": "Rate"},
            "H": {"value": "Total"},
        })
        self.reader = _make_reader({1: self.top, 2: self.bottom})
        self.sc = _call(self.reader, header_row=2, header_row_count=2)

    def test_pattern_2_assigns_qty_by_area_per_area(self):
        """Pattern 2: qty columns get role='qty' with the correct area name."""
        crm = self.sc.column_role_map
        self.assertEqual(crm["C"].role, "qty")
        self.assertEqual(crm["C"].area, "Block A")
        self.assertEqual(crm["E"].role, "qty")
        self.assertEqual(crm["E"].area, "Block B")

    def test_pattern_2_assigns_amount_by_area_per_area(self):
        """Pattern 2: amount columns get role='amount_by_area' with the correct area name."""
        crm = self.sc.column_role_map
        self.assertEqual(crm["D"].role, "amount_by_area")
        self.assertEqual(crm["D"].area, "Block A")
        self.assertEqual(crm["F"].role, "amount_by_area")
        self.assertEqual(crm["F"].area, "Block B")

    def test_pattern_2_preserves_universal_roles_outside_area_spans(self):
        """Pattern 2: columns outside area spans keep their universal role (area=None)."""
        crm = self.sc.column_role_map
        self.assertEqual(crm["A"].role, "sl_no")
        self.assertIsNone(crm["A"].area)
        self.assertEqual(crm["B"].role, "description")
        self.assertIsNone(crm["B"].area)
        self.assertEqual(crm["G"].role, "rate_combined")
        self.assertIsNone(crm["G"].area)


# -----------------------------------------------------------------------
# Pattern 2-rate — 3 cols per area (qty + rate + amount)
# -----------------------------------------------------------------------

class TestAutoGuessPattern2Rate(unittest.TestCase):
    """
    Layout:
      Row 1 (top): A="Sl.No." B="Description" C:E="PHASE-1" F:H="PHASE-2"
      Row 2 (bottom, header_row=2): A B C="Qty" D="Rate" E="Amount" F="Qty" G="Rate" H="Amount"
    """

    def setUp(self):
        self.top = _make_row(1, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "PHASE-1", "is_merged_origin": True, "merged_range": "C1:E1"},
            "D": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "E": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "F": {"value": "PHASE-2", "is_merged_origin": True, "merged_range": "F1:H1"},
            "G": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
            "H": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
        })
        self.bottom = _make_row(2, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Qty"},
            "D": {"value": "Rate"},
            "E": {"value": "Amount"},
            "F": {"value": "Qty"},
            "G": {"value": "Rate"},
            "H": {"value": "Amount"},
        })
        self.reader = _make_reader({1: self.top, 2: self.bottom})
        self.sc = _call(self.reader, header_row=2, header_row_count=2)

    def test_pattern_2_rate_assigns_qty_by_area_per_area(self):
        """Pattern 2-rate: qty columns get role='qty' with area set."""
        crm = self.sc.column_role_map
        self.assertEqual(crm["C"].role, "qty")
        self.assertEqual(crm["C"].area, "PHASE-1")
        self.assertEqual(crm["F"].role, "qty")
        self.assertEqual(crm["F"].area, "PHASE-2")

    def test_pattern_2_rate_assigns_rate_combined_by_area_when_combined_label(self):
        """Pattern 2-rate: rate columns get role='rate_combined_by_area' (all rates default to combined)."""
        crm = self.sc.column_role_map
        self.assertEqual(crm["D"].role, "rate_combined_by_area")
        self.assertEqual(crm["D"].area, "PHASE-1")
        self.assertEqual(crm["G"].role, "rate_combined_by_area")
        self.assertEqual(crm["G"].area, "PHASE-2")

    def test_pattern_2_rate_assigns_amount_by_area_per_area(self):
        """Pattern 2-rate: amount columns get role='amount_by_area' with area set."""
        crm = self.sc.column_role_map
        self.assertEqual(crm["E"].role, "amount_by_area")
        self.assertEqual(crm["E"].area, "PHASE-1")
        self.assertEqual(crm["H"].role, "amount_by_area")
        self.assertEqual(crm["H"].area, "PHASE-2")


# -----------------------------------------------------------------------
# Pattern 3 — alternating [area][AMOUNT] pairs (hrc=2, detected on bottom row)
# -----------------------------------------------------------------------

class TestAutoGuessPattern3(unittest.TestCase):
    """
    Top row (row 1): only reserved keywords — Pattern 2/2-rate/1(top) all fail.
    Bottom row (row 2): alternating [area_name][AMOUNT] pairs → Pattern 3.

    Layout:
      Row 1 (top):   B="Sl.No." C="Description"  (both reserved, no area names)
      Row 2 (bottom, header_row=2):
        A="Sl.No." B="Description" C="Zone A" D="AMOUNT" E="Zone B" F="AMOUNT" G="TOTAL QTY"
    """

    def setUp(self):
        self.top = _make_row(1, {
            "B": {"value": "Sl.No."},
            "C": {"value": "Description"},
        })
        self.bottom = _make_row(2, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Zone A"},
            "D": {"value": "AMOUNT"},
            "E": {"value": "Zone B"},
            "F": {"value": "AMOUNT"},
            "G": {"value": "TOTAL QTY"},
        })
        self.reader = _make_reader({1: self.top, 2: self.bottom})
        self.sc = _call(self.reader, header_row=2, header_row_count=2)

    def test_pattern_3_assigns_qty_and_amount_by_area_no_rate(self):
        """Pattern 3: area-name column gets role='qty'+area; AMOUNT column gets amount_by_area; no rate_by_area."""
        crm = self.sc.column_role_map
        # Per-area qty (area-name column acts as qty column)
        self.assertEqual(crm["C"].role, "qty")
        self.assertEqual(crm["C"].area, "Zone A")
        self.assertEqual(crm["E"].role, "qty")
        self.assertEqual(crm["E"].area, "Zone B")
        # Per-area amount
        self.assertEqual(crm["D"].role, "amount_by_area")
        self.assertEqual(crm["D"].area, "Zone A")
        self.assertEqual(crm["F"].role, "amount_by_area")
        self.assertEqual(crm["F"].area, "Zone B")
        # No per-area rate (Pattern 3 has no rate columns)
        rate_area_roles = {
            cr.role for cr in crm.values()
            if cr.role in {"rate_combined_by_area", "rate_supply_by_area", "rate_install_by_area"}
        }
        self.assertEqual(rate_area_roles, set())
        # area_dimensions must include both zones
        self.assertEqual(sorted(self.sc.area_dimensions), ["Zone A", "Zone B"])


# -----------------------------------------------------------------------
# Pattern 1 in 2-row mode — areas on top row, qty only, no amount/rate
# -----------------------------------------------------------------------

class TestAutoGuessPattern1TwoRow(unittest.TestCase):
    """
    Pattern 1 top-row fallback (TS-T2-WEX shape):
      Row 1 (top):   C="Office" D="Common Area"  (non-reserved, Pattern 1 top-row fallback)
      Row 2 (bottom, header_row=2):
        A="Sl.No." B="Description" C="QTY" D="QTY" E="TOTAL QTY" F="Rate" G="Amount"

    Priority: P2-rate fails → P2 fails → P3 fails (bottom) → P1 bottom fails (QTY is reserved)
              → P1 TOP succeeds: areas=["Office", "Common Area"] at columns C,D.
    """

    def setUp(self):
        self.top = _make_row(1, {
            "C": {"value": "Office"},
            "D": {"value": "Common Area"},
        })
        self.bottom = _make_row(2, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "QTY"},
            "D": {"value": "QTY"},
            "E": {"value": "TOTAL QTY"},
            "F": {"value": "Rate"},
            "G": {"value": "Amount"},
        })
        self.reader = _make_reader({1: self.top, 2: self.bottom})
        self.sc = _call(self.reader, header_row=2, header_row_count=2)

    def test_pattern_1_2row_assigns_qty_by_area_only(self):
        """Pattern 1 top-row fallback: qty columns get area assignment; no amount or rate by area."""
        crm = self.sc.column_role_map
        self.assertEqual(crm["C"].role, "qty")
        self.assertEqual(crm["C"].area, "Office")
        self.assertEqual(crm["D"].role, "qty")
        self.assertEqual(crm["D"].area, "Common Area")
        # No per-area amount or rate
        area_non_qty = [cr for cr in crm.values() if cr.area and cr.role != "qty"]
        self.assertEqual(area_non_qty, [])
        self.assertEqual(sorted(self.sc.area_dimensions), ["Common Area", "Office"])


# -----------------------------------------------------------------------
# Edge cases
# -----------------------------------------------------------------------

class TestAutoGuessEdgeCases(unittest.TestCase):

    def test_per_area_role_overrides_universal_singleton_when_column_overlaps(self):
        """
        Phase 3 overrides Phase 1 singleton assignments for columns inside an area span.

        Pattern 2-rate: Phase 1 assigns rate_combined (singleton) to D and
        amount_total (singleton) to E from the bottom row. Phase 3 then
        overrides D → rate_combined_by_area/PHASE-1 and E → amount_by_area/PHASE-1.
        """
        top = _make_row(1, {
            "C": {"value": "PHASE-1", "is_merged_origin": True, "merged_range": "C1:E1"},
            "D": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "E": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "F": {"value": "PHASE-2", "is_merged_origin": True, "merged_range": "F1:H1"},
            "G": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
            "H": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
        })
        bottom = _make_row(2, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Qty"},
            "D": {"value": "Rate"},    # Phase 1: rate_combined (singleton)
            "E": {"value": "Amount"},  # Phase 1: amount_total (singleton)
            "F": {"value": "Qty"},
            "G": {"value": "Rate"},    # Phase 1: skipped (rate_combined already taken)
            "H": {"value": "Amount"},  # Phase 1: skipped (amount_total already taken)
        })
        reader = _make_reader({1: top, 2: bottom})
        sc = _call(reader, header_row=2, header_row_count=2)
        crm = sc.column_role_map
        # D was rate_combined singleton; Phase 3 overrides with per-area rate
        self.assertEqual(crm["D"].role, "rate_combined_by_area")
        self.assertEqual(crm["D"].area, "PHASE-1")
        # E was amount_total singleton; Phase 3 overrides with per-area amount
        self.assertEqual(crm["E"].role, "amount_by_area")
        self.assertEqual(crm["E"].area, "PHASE-1")
        # G and H: Phase 1 skipped them (singletons taken), but Phase 3 assigns them
        self.assertEqual(crm["G"].role, "rate_combined_by_area")
        self.assertEqual(crm["G"].area, "PHASE-2")
        self.assertEqual(crm["H"].role, "amount_by_area")
        self.assertEqual(crm["H"].area, "PHASE-2")

    def test_no_pattern_detected_no_per_area_roles(self):
        """
        hrc=2 but pattern detection returns None → Phase 3 skipped.
        Top row has reserved-keyword merges; no valid area names detected.
        """
        top = _make_row(1, {
            "C": {"value": "QUANTITY", "is_merged_origin": True, "merged_range": "C1:D1"},
            "D": {"value": "QUANTITY", "is_merged_origin": False, "merged_range": "C1:D1"},
            "E": {"value": "RATE", "is_merged_origin": True, "merged_range": "E1:F1"},
            "F": {"value": "RATE", "is_merged_origin": False, "merged_range": "E1:F1"},
        })
        bottom = _make_row(2, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Qty"},
            "D": {"value": "Rate"},
            "E": {"value": "Amount"},
        })
        reader = _make_reader({1: top, 2: bottom})
        sc = _call(reader, header_row=2, header_row_count=2)
        # No per-area roles
        for cr in sc.column_role_map.values():
            self.assertIsNone(cr.area)
        self.assertEqual(sc.area_dimensions, [])

    def test_area_dimensions_populated_with_detected_areas(self):
        """area_dimensions on SheetConfig must include all detected area names."""
        top = _make_row(1, {
            "C": {"value": "PHASE-1", "is_merged_origin": True, "merged_range": "C1:E1"},
            "D": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "E": {"value": "PHASE-1", "is_merged_origin": False, "merged_range": "C1:E1"},
            "F": {"value": "PHASE-2", "is_merged_origin": True, "merged_range": "F1:H1"},
            "G": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
            "H": {"value": "PHASE-2", "is_merged_origin": False, "merged_range": "F1:H1"},
        })
        bottom = _make_row(2, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Qty"},
            "D": {"value": "Rate"},
            "E": {"value": "Amount"},
            "F": {"value": "Qty"},
            "G": {"value": "Rate"},
            "H": {"value": "Amount"},
        })
        reader = _make_reader({1: top, 2: bottom})
        sc = _call(reader, header_row=2, header_row_count=2)
        self.assertEqual(sorted(sc.area_dimensions), ["PHASE-1", "PHASE-2"])

    def test_singleton_guard_prevents_duplicate_assignment(self):
        """
        When two columns both match a singleton role, only the first (leftmost)
        column is assigned that role. The second match is silently skipped.

        Locks the singleton guard behaviour so future refactors cannot silently
        remove it without a failing test.

        Column B = "Description" → matches role='description'.
        Column F = "Item Description" → also matches role='description'
          (substring 'description' is in both the cell text and the keyword set).
        Only B should receive the role; F must be absent from column_role_map
        (or at least not carry role='description').
        """
        bottom = _make_row(1, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": "Unit"},
            "D": {"value": "Qty"},
            "E": {"value": "Rate"},
            "F": {"value": "Item Description"},  # second description match
            "G": {"value": "Amount"},
        })
        reader = _make_reader({1: bottom})
        sc = _call(reader, header_row=1, header_row_count=1)
        crm = sc.column_role_map
        desc_cols = [col for col, cr in crm.items() if cr.role == "description"]
        self.assertEqual(len(desc_cols), 1, "description singleton must be assigned exactly once")
        self.assertEqual(desc_cols[0], "B", "first column (B) wins; F is skipped by singleton guard")
        # F must not carry the description role
        if "F" in crm:
            self.assertNotEqual(crm["F"].role, "description")


# -----------------------------------------------------------------------
# Phase 1.9l Mode D --- longest-match-wins precedence
# -----------------------------------------------------------------------

class TestPhase1_9lModeDPrecedence(unittest.TestCase):
    """
    Phase 1.9l Mode D: longest matched keyword wins over shorter keyword
    in competing roles.

    Headline fix (1.9i Mode D, target 8): 'Supply Rate' cell text matches
    both 'rate' (rate_combined, 4 chars) and 'supply rate' (rate_supply,
    11 chars). Old first-match-wins by iteration order gave rate_combined.
    New longest-match-wins gives rate_supply.

    All tests use hrc=1 (single-area) so only Phase 1 assignment is active.
    """

    def _crm(self, header_text: str) -> dict:
        """Build a single test column C with given header; return column_role_map."""
        row = _make_row(1, {
            "A": {"value": "Sl.No."},
            "B": {"value": "Description"},
            "C": {"value": header_text},
        })
        reader = _make_reader({1: row})
        sc = _call(reader, header_row=1, header_row_count=1)
        return sc.column_role_map

    def test_supply_rate_classifies_as_rate_supply_not_rate_combined(self):
        """'Supply Rate' -> rate_supply: 'supply rate' (11c) beats 'rate' (4c) in rate_combined."""
        crm = self._crm("Supply Rate")
        self.assertEqual(crm["C"].role, "rate_supply")

    def test_installation_rate_classifies_as_rate_install(self):
        """'Installation Rate' -> rate_install: 'installation rate' (17c) beats 'rate' (4c)."""
        crm = self._crm("Installation Rate")
        self.assertEqual(crm["C"].role, "rate_install")

    def test_install_rate_classifies_as_rate_install(self):
        """'Install Rate' -> rate_install: 'install rate' (12c) beats 'rate' (4c)."""
        crm = self._crm("Install Rate")
        self.assertEqual(crm["C"].role, "rate_install")

    def test_supply_amount_classifies_as_amount_supply(self):
        """'Supply Amount' -> amount_supply: 'supply amount' (13c) beats 'amount' (6c)."""
        crm = self._crm("Supply Amount")
        self.assertEqual(crm["C"].role, "amount_supply")

    def test_installation_amount_classifies_as_amount_install(self):
        """'Installation Amount' -> amount_install: 'installation amount' (19c) beats 'amount' (6c)."""
        crm = self._crm("Installation Amount")
        self.assertEqual(crm["C"].role, "amount_install")

    def test_combined_rate_classifies_as_rate_combined(self):
        """'Combined Rate' -> rate_combined: 'combined rate' (13c) in rate_combined. Regression guard."""
        crm = self._crm("Combined Rate")
        self.assertEqual(crm["C"].role, "rate_combined")

    def test_bare_rate_still_classifies_as_rate_combined(self):
        """'Rate' alone -> rate_combined: only matches rate_combined keywords. Regression guard."""
        crm = self._crm("Rate")
        self.assertEqual(crm["C"].role, "rate_combined")

    def test_sitc_rate_classifies_as_rate_combined(self):
        """'SITC Rate' -> rate_combined: 'sitc rate' (9c) is longest match in rate_combined."""
        crm = self._crm("SITC Rate")
        self.assertEqual(crm["C"].role, "rate_combined")

    def test_dsr_rate_classifies_as_rate_supply(self):
        """'DSR Rate' -> rate_supply: 'dsr rate' (8c) beats 'rate' (4c) in rate_combined."""
        crm = self._crm("DSR Rate")
        self.assertEqual(crm["C"].role, "rate_supply")

    def test_ndsr_rate_classifies_as_rate_install(self):
        """'NDSR Rate' -> rate_install: 'ndsr rate' (9c) beats 'rate' (4c) in rate_combined."""
        crm = self._crm("NDSR Rate")
        self.assertEqual(crm["C"].role, "rate_install")


if __name__ == "__main__":
    unittest.main()
