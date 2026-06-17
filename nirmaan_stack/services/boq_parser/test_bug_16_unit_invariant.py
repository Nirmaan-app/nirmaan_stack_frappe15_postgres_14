# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""
Tests for Bug 16 -- classifier unit invariant (in-classifier flow).

A row cannot be LINE_ITEM unless it has a real (non-junk) unit.
Two clauses gated by BUG_16_UNIT_INVARIANT_ENABLED (default True):
  Clause 1 (SPACER broadening): sl_no AND description AND unit all junk -> SPACER.
  Clause 2 (LINE_ITEM unit gate): classified LINE_ITEM but unit junk -> re-evaluate.

~12 tests across 5 groups:
  A. TestBug16Helpers            (3) -- one per helper, 2-3 cases each
  B. TestBug16Clause1Spacer      (2) -- SPACER broadening
  C. TestBug16Clause2Gate        (2) -- LINE_ITEM unit gate
  D. TestBug16Toggle             (1) -- toggle off disables both clauses
  E. TestBug16SgHvacIntegration  (2) -- real-fixture rows 11+12
  F. TestBug16RegressionGuards   (2) -- Inovalon + BoQ ELV unchanged
"""
from __future__ import annotations

import unittest
from pathlib import Path

import nirmaan_stack.services.boq_parser.classifier as clf_mod
from nirmaan_stack.services.boq_parser.classifier import (
    BUG_16_UNIT_INVARIANT_ENABLED,
    RowClassification,
    _is_description_blank_or_junk,
    _is_sl_no_blank_or_junk,
    _is_unit_blank_or_junk,
    classify_row,
)
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.orchestrator import parse_boq
from nirmaan_stack.services.boq_parser.reader import BoqReader, CellInfo, RawRow

_FIXTURES = Path(__file__).parent / "tests" / "fixtures"
_SG_HVAC_FIXTURE = _FIXTURES / "RFQ_Societe Generale_Bangalore_HVAC_BOQ-26-02-2026 (1).xlsx"
_INOVALON_FIXTURE = _FIXTURES / "Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx"
_BOQ_ELV_FIXTURE = _FIXTURES / "Bill of Quantities.xlsx"

_GS = GlobalSettings()


# ------------------------------------------------------------------
# Synthetic row / config helpers (mirroring test_classifier.py)
# ------------------------------------------------------------------

def _make_row(row_number: int, cells: dict[str, dict]) -> RawRow:
    cell_objs: dict[str, CellInfo] = {}
    for col, props in cells.items():
        cell_objs[col] = CellInfo(
            value=props.get("value"),
            formula=props.get("formula"),
            is_formula=props.get("is_formula", False),
            is_merged_origin=False,
            merged_range=None,
            font_bold=props.get("bold", False),
            fill_color_rgb=None,
            indent=props.get("indent", 0),
        )
    return RawRow(row_number=row_number, cells=cell_objs)


def _basic_sheet_config(extra_columns: dict[str, ColumnRole] | None = None) -> SheetConfig:
    col_map: dict[str, ColumnRole] = {
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="description"),
        "C": ColumnRole(role="unit"),
        "D": ColumnRole(role="qty"),
        "E": ColumnRole(role="rate_supply"),
        "F": ColumnRole(role="amount_supply"),
    }
    if extra_columns:
        col_map.update(extra_columns)
    return SheetConfig(sheet_name="Test", header_row=1, column_role_map=col_map)


# ------------------------------------------------------------------
# Real-fixture configs
# ------------------------------------------------------------------

def _sg_hvac_config() -> MappingConfig:
    return MappingConfig(
        project="sg_hvac_bug16_test",
        master_boq=MasterBoqMetadata(boq_name="Societe Generale HVAC Bug16 Test"),
        sheets=[
            SheetConfig(sheet_name="Summary", skip=True, column_role_map={}),
            SheetConfig(
                sheet_name="BOQ_HVAC Lowside works",
                header_row=3,
                header_row_count=2,
                area_dimensions=["GF", "2F (Office)", "2F(Cafeteria)"],
                column_role_map={
                    "A": ColumnRole(role="sl_no"),
                    "B": ColumnRole(role="description"),
                    "C": ColumnRole(role="unit"),
                    "D": ColumnRole(role="qty", area="GF"),
                    "E": ColumnRole(role="qty", area="2F (Office)"),
                    "F": ColumnRole(role="qty", area="2F(Cafeteria)"),
                    "G": ColumnRole(role="qty_total"),
                    "H": ColumnRole(role="rate_supply"),
                    "I": ColumnRole(role="rate_install"),
                    "J": ColumnRole(role="amount_supply"),
                    "K": ColumnRole(role="amount_install"),
                    "L": ColumnRole(role="amount_total"),
                    "M": ColumnRole(role="append_to_notes"),
                },
            ),
            SheetConfig(sheet_name="BOQ_HVAC LEED & WELL", skip=True, column_role_map={}),
            SheetConfig(sheet_name="BOQ_LEED", skip=True, column_role_map={}),
            SheetConfig(sheet_name="Make List", skip=True, column_role_map={}),
        ],
    )


def _inovalon_config() -> MappingConfig:
    return MappingConfig(
        project="inovalon_bug16_test",
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


def _boq_elv_config() -> MappingConfig:
    return MappingConfig(
        project="boq_elv_bug16_test",
        master_boq=MasterBoqMetadata(boq_name="Bill Of Quantities ELV"),
        sheets=[
            SheetConfig(
                sheet_name="ELECTRICAL & ELV BOQ",
                header_row=2,
                header_row_count=2,
                column_role_map={
                    "A": ColumnRole(role="sl_no"),
                    "B": ColumnRole(role="append_to_notes"),
                    "C": ColumnRole(role="description"),
                    "D": ColumnRole(role="unit"),
                    "E": ColumnRole(role="qty"),
                    "F": ColumnRole(role="rate_supply"),
                    "G": ColumnRole(role="rate_install"),
                    "H": ColumnRole(role="amount_supply"),
                    "I": ColumnRole(role="amount_install"),
                },
            ),
        ],
    )


def _count_classifications(result) -> dict[str, int]:
    counts: dict[str, int] = {}
    for sheet in result.sheets:
        for rr in sheet.resolved_rows:
            label = rr.classified_row.classification.value
            counts[label] = counts.get(label, 0) + 1
    return counts


# ==================================================================
# A. Helper unit tests (3 tests)
# ==================================================================

class TestBug16Helpers(unittest.TestCase):

    def test_is_unit_blank_or_junk(self):
        self.assertTrue(_is_unit_blank_or_junk(None))
        self.assertTrue(_is_unit_blank_or_junk(""))
        self.assertTrue(_is_unit_blank_or_junk("  "))
        self.assertTrue(_is_unit_blank_or_junk("-"))
        self.assertTrue(_is_unit_blank_or_junk("0"))
        self.assertFalse(_is_unit_blank_or_junk("Nos."))
        self.assertFalse(_is_unit_blank_or_junk("m**2"))

    def test_is_sl_no_blank_or_junk(self):
        self.assertTrue(_is_sl_no_blank_or_junk(None))
        self.assertTrue(_is_sl_no_blank_or_junk(""))
        self.assertTrue(_is_sl_no_blank_or_junk("*"))
        self.assertFalse(_is_sl_no_blank_or_junk("1.0"))
        self.assertFalse(_is_sl_no_blank_or_junk("A."))

    def test_is_description_blank_or_junk(self):
        self.assertTrue(_is_description_blank_or_junk(None))
        self.assertTrue(_is_description_blank_or_junk(""))
        self.assertFalse(_is_description_blank_or_junk("Some text"))


# ==================================================================
# B. Clause 1: SPACER broadening (2 tests)
# ==================================================================

class TestBug16Clause1Spacer(unittest.TestCase):

    def test_all_three_junk_with_qty_yields_spacer(self):
        """sl_no, desc, unit all junk but qty=5.0 -> Clause 1 fires, SPACER."""
        row = _make_row(10, {
            "D": {"value": 5.0},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.SPACER)

    def test_partial_junk_does_not_yield_spacer(self):
        """desc present but no sl_no or unit -> Clause 1 does NOT fire."""
        row = _make_row(11, {
            "B": {"value": "Some description text"},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertNotEqual(result.classification, RowClassification.SPACER)


# ==================================================================
# C. Clause 2: LINE_ITEM unit gate (2 tests)
# ==================================================================

class TestBug16Clause2Gate(unittest.TestCase):

    def test_unit_none_with_qty_sl_no_desc_yields_preamble(self):
        """qty set + sl_no + desc + unit=None -> would be LINE_ITEM, blocked to PREAMBLE."""
        row = _make_row(20, {
            "A": {"value": "1.01"},
            "B": {"value": "Supply and erection of ductwork"},
            "D": {"value": 5.0},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.PREAMBLE)

    def test_unit_real_with_qty_yields_line_item(self):
        """qty set + sl_no + desc + unit='Sqm' -> LINE_ITEM (control; unit invariant satisfied)."""
        row = _make_row(21, {
            "A": {"value": "a)"},
            "B": {"value": "24 gauge GSS duct"},
            "C": {"value": "Sqm"},
            "D": {"value": 454.0},
            "E": {"value": 250.0},
        })
        result = classify_row(row, _basic_sheet_config(), _GS)
        self.assertEqual(result.classification, RowClassification.LINE_ITEM)
        self.assertEqual(result.qty, 454.0)


# ==================================================================
# D. Toggle test (1 test)
# ==================================================================

class TestBug16Toggle(unittest.TestCase):

    def test_toggle_off_disables_both_clauses(self):
        """With toggle False, a row with all-junk fields + qty=0 stays LINE_ITEM."""
        row = _make_row(30, {
            "D": {"value": 0.0},
            "E": {"value": 0.0},
        })
        try:
            clf_mod.BUG_16_UNIT_INVARIANT_ENABLED = False
            result = classify_row(row, _basic_sheet_config(), _GS)
            self.assertEqual(
                result.classification, RowClassification.LINE_ITEM,
                "Toggle=False must disable Clause 1 and leave ghost row as LINE_ITEM",
            )
        finally:
            clf_mod.BUG_16_UNIT_INVARIANT_ENABLED = True


# ==================================================================
# E. Real-fixture integration: sg_hvac rows 11 and 12 (2 tests)
# ==================================================================

class TestBug16SgHvacIntegration(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cfg = _sg_hvac_config()
        cls.sheet_config = cfg.sheets[1]  # BOQ_HVAC Lowside works
        cls.global_settings = cfg.global_settings
        reader = BoqReader(str(_SG_HVAC_FIXTURE))
        cls.rows_by_number = {
            rr.row_number: rr
            for rr in reader.iter_rows(cls.sheet_config.sheet_name)
        }

    def _classify(self, row_number: int):
        rr = self.rows_by_number[row_number]
        return classify_row(rr, self.sheet_config, self.global_settings)

    def test_sg_hvac_r11_classifies_as_spacer(self):
        """
        Row 11 is a ghost row: sl_no=None, desc='', unit=None, qty=0.0
        (rate-only formula with blank rate cells).
        Clause 1 must fire -> SPACER.
        Pre-fix baseline: LINE_ITEM.
        """
        result = self._classify(11)
        self.assertEqual(
            result.classification, RowClassification.SPACER,
            f"Row 11 should be SPACER via Clause 1; got {result.classification}",
        )

    def test_sg_hvac_r12_classifies_as_preamble(self):
        """
        Row 12 (sl_no='1.01', desc='Supply , fabrication, erection...', unit=None,
        qty=0.0 from blank rate-only path).
        Clause 2 must fire -> PREAMBLE (has sl_no + desc but unit junk).
        Pre-fix baseline: LINE_ITEM.
        """
        result = self._classify(12)
        self.assertEqual(
            result.classification, RowClassification.PREAMBLE,
            f"Row 12 should be PREAMBLE via Clause 2; got {result.classification}",
        )
        self.assertEqual(result.sl_no_value, "1.01")


# ==================================================================
# F. Cross-fixture regression guards (2 tests)
# ==================================================================

class TestBug16RegressionGuards(unittest.TestCase):

    def _compare_toggle(self, fixture_path: str, config_fn) -> tuple[dict, dict]:
        try:
            clf_mod.BUG_16_UNIT_INVARIANT_ENABLED = False
            baseline = _count_classifications(parse_boq(fixture_path, config_fn()))
        finally:
            clf_mod.BUG_16_UNIT_INVARIANT_ENABLED = True
        enabled = _count_classifications(parse_boq(fixture_path, config_fn()))
        return baseline, enabled

    def test_inovalon_unchanged(self):
        """
        Inovalon HVAC BOQ: all rows have real units on line items.
        Toggle on vs off must produce identical classification counts.
        """
        baseline, enabled = self._compare_toggle(str(_INOVALON_FIXTURE), _inovalon_config)
        self.assertEqual(
            baseline, enabled,
            f"Inovalon classification counts changed with Bug 16 toggle:\n"
            f"  toggle=off: {baseline}\n  toggle=on:  {enabled}",
        )

    def test_boq_elv_unchanged(self):
        """
        Bill of Quantities ELV: all line items have real units.
        Toggle on vs off must produce identical classification counts.
        """
        baseline, enabled = self._compare_toggle(str(_BOQ_ELV_FIXTURE), _boq_elv_config)
        self.assertEqual(
            baseline, enabled,
            f"BoQ ELV classification counts changed with Bug 16 toggle:\n"
            f"  toggle=off: {baseline}\n  toggle=on:  {enabled}",
        )


if __name__ == "__main__":
    unittest.main()
