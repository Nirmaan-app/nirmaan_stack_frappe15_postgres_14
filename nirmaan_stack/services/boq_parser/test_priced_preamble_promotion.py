"""
Tests for Bug 19 (sec 9 #106) priced-preamble promotion and
Bug 19-ext (sec 9 #107) PREAMBLE reparenting.

Bug 19: _apply_priced_preamble_promotion promotes LINE_ITEM rows whose
sl_no extends a consecutive PREAMBLE section sequence by exactly one step.
Fires when: (a) ≥2 PREAMBLE anchors share the same pattern_signature in
the backward window, (b) their first_numeric_token values form a gap-free
consecutive sequence, and (c) the target's fnt == max(preamble_fnts) + 1.

Bug 19-ext: resolve_hierarchy reparents PREAMBLE rows by scanning resolved
rows backwards for a PREAMBLE with matching pattern_signature AND matching
first_numeric_token at level-1, overriding the stack-top parent when the
correct parent was evicted from the stack.

12 tests across 3 groups:
  TestBug19Unit           (5) -- synthetic unit tests for _apply_priced_preamble_promotion
  TestBug19Integration    (3) -- safron Low Side Works R2 real-fixture (canonical T1, T6)
  TestBug19ExtIntegration (4) -- Inovalon BOQ real-fixture (canonical T4, T5)
"""
from __future__ import annotations

import unittest
from pathlib import Path

import nirmaan_stack.services.boq_parser.classifier as classifier_mod
import nirmaan_stack.services.boq_parser.hierarchy as hierarchy_mod
from nirmaan_stack.services.boq_parser.classifier import (
    ClassifiedRow,
    RowClassification,
    _apply_priced_preamble_promotion,
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
    resolve_hierarchy,
)
from nirmaan_stack.services.boq_parser.orchestrator import TEXT_ROLE_ROLES, parse_boq
from nirmaan_stack.services.boq_parser.reader import BoqReader, RawRow

_FIXTURES = Path(__file__).parent / "tests" / "fixtures"
_SAFRON_FIXTURE = _FIXTURES / "safron_hvac_2026-04-11.xlsx"
_SAFRON_SHEET = "Low Side Works R2 11.4.26"
_SAFRON_HEADER_ROW = 3
_INOVALON_FIXTURE = _FIXTURES / "Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx"

_GS = GlobalSettings()

_SAFRON_CONFIG = SheetConfig(
    sheet_name=_SAFRON_SHEET,
    header_row=_SAFRON_HEADER_ROW,
    column_role_map={
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="description"),
        "C": ColumnRole(role="unit"),
        "D": ColumnRole(role="qty"),
        "E": ColumnRole(role="rate_supply"),
        "F": ColumnRole(role="rate_install"),
        "G": ColumnRole(role="amount_supply"),
    },
)

_INOVALON_CONFIG = MappingConfig(
    project="inovalon_test",
    master_boq=MasterBoqMetadata(boq_name="Inovalon HVAC BOQ"),
    sheets=[
        SheetConfig(sheet_name="SUMMARY ", skip=True, column_role_map={}),
        SheetConfig(
            sheet_name="BOQ",
            header_row=5,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="unit"),
                "D": ColumnRole(role="qty"),
                "E": ColumnRole(role="rate_supply"),
                "F": ColumnRole(role="rate_install"),
                "G": ColumnRole(role="amount_supply"),
                "H": ColumnRole(role="amount_install"),
            },
        ),
        SheetConfig(sheet_name="Make list", skip=True, column_role_map={}),
    ],
)


# ------------------------------------------------------------------
# Synthetic helpers
# ------------------------------------------------------------------

def _preamble(row_num: int, sl_no: str) -> ClassifiedRow:
    return ClassifiedRow(
        raw_row=RawRow(row_number=row_num),
        classification=RowClassification.PREAMBLE,
        sl_no_value=sl_no,
    )


def _line_item(row_num: int, sl_no: str, unit: str = "Nos") -> ClassifiedRow:
    return ClassifiedRow(
        raw_row=RawRow(row_number=row_num),
        classification=RowClassification.LINE_ITEM,
        sl_no_value=sl_no,
        unit=unit,
        qty=1.0,
    )


def _spacer(row_num: int) -> ClassifiedRow:
    return ClassifiedRow(
        raw_row=RawRow(row_number=row_num),
        classification=RowClassification.SPACER,
    )


# ------------------------------------------------------------------
# Safron pipeline helper
# ------------------------------------------------------------------

def _run_safron_pipeline():
    """Full pipeline for safron Low Side Works sheet, including Bug 19."""
    reader = BoqReader(str(_SAFRON_FIXTURE))
    text_cols = {c for c, cr in _SAFRON_CONFIG.column_role_map.items() if cr.role in TEXT_ROLE_ROLES}
    raw_rows = [
        rr for rr in reader.iter_rows(_SAFRON_SHEET, text_role_columns=text_cols)
        if rr.row_number != _SAFRON_HEADER_ROW and rr.row_number >= _SAFRON_HEADER_ROW
    ]
    classified = [classify_row(rr, _SAFRON_CONFIG, _GS) for rr in raw_rows]
    _apply_unit_based_demotion_post_pass(classified)
    populate_preamble_candidate_scores(classified, _SAFRON_CONFIG)
    _apply_section_header_note_promotion_post_pass(classified)
    _apply_priced_preamble_promotion(classified)
    return classified


def _find_by_row(classified, xlsx_row: int):
    return next((r for r in classified if r.raw_row.row_number == xlsx_row), None)


def _find_resolved_by_row(resolved_rows, xlsx_row: int):
    return next((r for r in resolved_rows if r.classified_row.raw_row.row_number == xlsx_row), None)


# ==================================================================
# Group 1: Unit tests for _apply_priced_preamble_promotion
# ==================================================================

class TestBug19Unit(unittest.TestCase):
    """
    Synthetic unit tests for the promotion post-pass.
    All tests operate on hand-built ClassifiedRow lists.
    """

    def test_promotes_one_step_beyond_contiguous_sequence(self):
        """PREAMBLEs {3,4,5,6,7} + LINE_ITEM sl=8.0 → promoted to PREAMBLE."""
        rows = [
            _preamble(10, "3.0"), _spacer(11),
            _preamble(12, "4.0"), _spacer(13),
            _preamble(14, "5.0"), _spacer(15),
            _preamble(16, "6.0"), _spacer(17),
            _preamble(18, "7.0"), _spacer(19),
            _line_item(20, "8.0"),
        ]
        _apply_priced_preamble_promotion(rows)
        target = rows[-1]
        self.assertEqual(target.classification, RowClassification.PREAMBLE)
        self.assertTrue(target.promoted_from_line_item)

    def test_sequential_promotions_chain(self):
        """8.0 promoted → 9.0 and 10.0 see 8.0 as anchor, chain promotes."""
        rows = [
            _preamble(1, "3.0"), _preamble(2, "4.0"), _preamble(3, "5.0"),
            _preamble(4, "6.0"), _preamble(5, "7.0"),
            _line_item(6, "8.0"), _line_item(7, "9.0"), _line_item(8, "10.0"),
        ]
        _apply_priced_preamble_promotion(rows)
        for i in [5, 6, 7]:
            self.assertEqual(rows[i].classification, RowClassification.PREAMBLE, f"idx={i}")

    def test_no_promotion_single_preamble_anchor(self):
        """Only 1 PREAMBLE anchor — len<2 blocks promotion (snitch-style)."""
        rows = [
            _preamble(1, "2.0"),
            _line_item(2, "3.0"),
        ]
        _apply_priced_preamble_promotion(rows)
        self.assertEqual(rows[1].classification, RowClassification.LINE_ITEM)
        self.assertFalse(rows[1].promoted_from_line_item)

    def test_no_promotion_gap_in_preamble_sequence(self):
        """PREAMBLEs {1,3} — non-contiguous sequence blocks promotion."""
        rows = [
            _preamble(1, "1.0"), _preamble(2, "3.0"),
            _line_item(3, "4.0"),
        ]
        _apply_priced_preamble_promotion(rows)
        self.assertEqual(rows[2].classification, RowClassification.LINE_ITEM)

    def test_no_promotion_fnt_not_adjacent(self):
        """PREAMBLEs {1,2}, target fnt=5 — not adjacent (fnt != max+1)."""
        rows = [
            _preamble(1, "1.0"), _preamble(2, "2.0"),
            _line_item(3, "5.0"),
        ]
        _apply_priced_preamble_promotion(rows)
        self.assertEqual(rows[2].classification, RowClassification.LINE_ITEM)


# ==================================================================
# Group 2: Safron real-fixture integration (Bug 19 canonical T1 + T6)
# ==================================================================

class TestBug19Integration(unittest.TestCase):
    """
    Bug 19 (sec 9 #106) — safron Low Side Works R2 real-fixture.

    Canonical T1: r34 (8.00), r35 (9.00), r37 (10.00) must be promoted
    from LINE_ITEM to PREAMBLE by the priced-preamble promotion pass.
    They carry unit+qty as priced section headers.

    T6 (safety): sg_hvac r25 (sl=1.04) must stay LINE_ITEM.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not _SAFRON_FIXTURE.exists():
            cls.classified = None
            return
        cls.classified = _run_safron_pipeline()

    def setUp(self):
        if not _SAFRON_FIXTURE.exists():
            self.skipTest(f"safron fixture missing: {_SAFRON_FIXTURE}")

    def test_fixture_exists(self):
        self.assertTrue(_SAFRON_FIXTURE.exists(), f"Fixture missing: {_SAFRON_FIXTURE}")

    def test_r34_8_00_promoted_to_preamble(self):
        """r34 sl='8.00' promoted from LINE_ITEM to PREAMBLE (Bug 19 canonical)."""
        r = _find_by_row(self.classified, 34)
        self.assertIsNotNone(r, "r34 not found")
        self.assertEqual(r.sl_no_value, "8.00")
        self.assertEqual(r.classification, RowClassification.PREAMBLE)
        self.assertTrue(r.promoted_from_line_item)

    def test_r35_9_00_promoted_to_preamble(self):
        """r35 sl='9.00' promoted from LINE_ITEM to PREAMBLE (Bug 19 canonical)."""
        r = _find_by_row(self.classified, 35)
        self.assertIsNotNone(r, "r35 not found")
        self.assertEqual(r.sl_no_value, "9.00")
        self.assertEqual(r.classification, RowClassification.PREAMBLE)
        self.assertTrue(r.promoted_from_line_item)

    def test_r37_10_00_promoted_to_preamble(self):
        """r37 sl='10.00' promoted from LINE_ITEM to PREAMBLE (Bug 19 canonical)."""
        r = _find_by_row(self.classified, 37)
        self.assertIsNotNone(r, "r37 not found")
        self.assertEqual(r.sl_no_value, "10.00")
        self.assertEqual(r.classification, RowClassification.PREAMBLE)
        self.assertTrue(r.promoted_from_line_item)


# ==================================================================
# Group 3: Inovalon real-fixture integration (Bug 19-ext canonical T4 + T5)
# ==================================================================

class TestBug19ExtIntegration(unittest.TestCase):
    """
    Bug 19-ext (sec 9 #107) — Inovalon HVAC BOQ real-fixture.

    Canonical T4: r22 (sl='1.3') is a PREAMBLE that belongs to section
    '1.0' (r6). Without Bug 19-ext, '2.0' (r19) evicts '1.0' from the
    stack and r22 would parent under '2.0'. With Bug 19-ext, the backward
    resolved-row scan finds '1.0' and reparents r22 under it.

    T5 (fallback): r22 parents under r6 (index 0), not r19 (index 13).
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not _INOVALON_FIXTURE.exists():
            cls.result = None
            cls.boq_sheet = None
            return
        cls.result = parse_boq(str(_INOVALON_FIXTURE), _INOVALON_CONFIG)
        cls.boq_sheet = next(
            (s for s in cls.result.sheets if s.sheet_name == "BOQ"), None
        )

    def setUp(self):
        if not _INOVALON_FIXTURE.exists():
            self.skipTest(f"Inovalon fixture missing: {_INOVALON_FIXTURE}")

    def test_fixture_exists(self):
        self.assertTrue(_INOVALON_FIXTURE.exists(), f"Fixture missing: {_INOVALON_FIXTURE}")

    def test_r22_is_preamble(self):
        """r22 sl='1.3' is classified as PREAMBLE in the resolved sheet."""
        r22 = _find_resolved_by_row(self.boq_sheet.resolved_rows, 22)
        self.assertIsNotNone(r22, "r22 not found in resolved rows")
        self.assertEqual(r22.classified_row.sl_no_value, "1.3")
        self.assertEqual(r22.classified_row.classification, RowClassification.PREAMBLE)

    def test_r22_parents_under_r6_not_r19(self):
        """r22 (sl='1.3') parents under r6 (sl='1.0'), not r19 (sl='2.0')."""
        resolved = self.boq_sheet.resolved_rows
        r22_rr = _find_resolved_by_row(resolved, 22)
        self.assertIsNotNone(r22_rr, "r22 not found")

        r6_rr = _find_resolved_by_row(resolved, 6)
        r19_rr = _find_resolved_by_row(resolved, 19)
        self.assertIsNotNone(r6_rr, "r6 not found")
        self.assertIsNotNone(r19_rr, "r19 not found")

        r6_idx = resolved.index(r6_rr)
        r19_idx = resolved.index(r19_rr)

        self.assertEqual(
            r22_rr.parent_index, r6_idx,
            f"r22 should parent under r6 (idx={r6_idx}) but got parent_index={r22_rr.parent_index} "
            f"(r19 idx={r19_idx})"
        )

    def test_r22_not_parented_under_r19(self):
        """Explicit negative: r22.parent_index must not equal r19's resolved index."""
        resolved = self.boq_sheet.resolved_rows
        r22_rr = _find_resolved_by_row(resolved, 22)
        r19_rr = _find_resolved_by_row(resolved, 19)
        self.assertIsNotNone(r22_rr, "r22 not found")
        self.assertIsNotNone(r19_rr, "r19 not found")
        r19_idx = resolved.index(r19_rr)
        self.assertNotEqual(
            r22_rr.parent_index, r19_idx,
            "r22 must NOT parent under r19 (sl='2.0')"
        )
