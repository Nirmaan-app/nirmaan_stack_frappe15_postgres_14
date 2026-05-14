# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import unittest
from pathlib import Path

from nirmaan_stack.services.boq_parser.tests.fixtures.generate_synthetic import generate_all
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.orchestrator import (
    ParsedBoq,
    ParsedSheet,
    _apply_multi_area_post_pass,
    parse_boq,
)

_FIXTURES = Path(__file__).parent / "tests" / "fixtures"


def _p(name: str) -> str:
    return str(_FIXTURES / name)


def _simple_config() -> MappingConfig:
    """MappingConfig for synthetic_simple.xlsx (Sheet1, single-area layout)."""
    return MappingConfig(
        project="test",
        master_boq=MasterBoqMetadata(boq_name="test_boq"),
        sheets=[SheetConfig(
            sheet_name="Sheet1",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="unit"),
                "D": ColumnRole(role="qty"),
                "E": ColumnRole(role="rate_supply"),
                "F": ColumnRole(role="amount_supply"),
            },
        )],
    )


def _trailing_spaces_config(skip_second: bool = False) -> MappingConfig:
    """
    MappingConfig for synthetic_trailing_spaces.xlsx.

    Both sheets have only a header row (A='data') and no data rows.
    Column map is empty — only header_row matters for the skip_rows logic.
    """
    return MappingConfig(
        project="test",
        master_boq=MasterBoqMetadata(boq_name="test_boq"),
        sheets=[
            SheetConfig(
                sheet_name="Sheet One",
                header_row=1,
                column_role_map={},
            ),
            SheetConfig(
                sheet_name="Trailing  ",
                header_row=1,
                skip=skip_second,
                column_role_map={},
            ),
        ],
    )


class TestOrchestrator(unittest.TestCase):
    """Phase 2b.2 Part B1 — parse_boq() orchestrator tests."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        generate_all()

    # ---------------------------------------------------------------- #
    # Test 1 — parse_boq() returns ParsedBoq from synthetic_simple      #
    # ---------------------------------------------------------------- #

    def test_parse_boq_returns_parsed_boq(self):
        """parse_boq() on synthetic_simple.xlsx returns a ParsedBoq with one sheet."""
        result = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        self.assertIsInstance(result, ParsedBoq)
        self.assertEqual(result.file_path, _p("synthetic_simple.xlsx"))
        self.assertEqual(len(result.sheets), 1)
        sheet = result.sheets[0]
        self.assertIsInstance(sheet, ParsedSheet)
        self.assertEqual(sheet.sheet_name, "Sheet1")
        self.assertEqual(sheet.validation_warnings, [])
        self.assertEqual(result.validation_warnings, [])
        self.assertIsNone(result.master_preamble)

    # ---------------------------------------------------------------- #
    # Test 2 — multi-sheet workbook: both sheets in output               #
    # ---------------------------------------------------------------- #

    def test_multi_sheet_workbook_both_sheets_present(self):
        """parse_boq() on a 2-sheet workbook returns ParsedSheet for each sheet."""
        config = _trailing_spaces_config(skip_second=False)
        result = parse_boq(_p("synthetic_trailing_spaces.xlsx"), config)
        self.assertEqual(len(result.sheets), 2)
        sheet_names = [s.sheet_name for s in result.sheets]
        self.assertIn("Sheet One", sheet_names)
        self.assertIn("Trailing  ", sheet_names)

    # ---------------------------------------------------------------- #
    # Test 3 — skipped sheet not in output                               #
    # ---------------------------------------------------------------- #

    def test_skipped_sheet_excluded_from_output(self):
        """Sheet with skip=True is not included in parsed_boq.sheets."""
        config = _trailing_spaces_config(skip_second=True)
        result = parse_boq(_p("synthetic_trailing_spaces.xlsx"), config)
        self.assertEqual(len(result.sheets), 1)
        self.assertEqual(result.sheets[0].sheet_name, "Sheet One")

    # ---------------------------------------------------------------- #
    # Test 4 — no multi-area columns → multi_area_pattern is None       #
    # ---------------------------------------------------------------- #

    def test_no_multi_area_columns_pattern_is_none(self):
        """synthetic_simple.xlsx has no area columns; multi_area_pattern must be None."""
        result = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        self.assertIsNone(result.sheets[0].multi_area_pattern)

    # ---------------------------------------------------------------- #
    # Test 5 — resolved_rows in source row order                        #
    # ---------------------------------------------------------------- #

    def test_resolved_rows_in_row_order(self):
        """
        synthetic_simple.xlsx has 3 data rows (First item, Second item, Bold item).
        resolved_rows must list them in that order (classified as LINE_ITEMs).
        """
        result = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())
        sheet = result.sheets[0]

        # Filter to LINE_ITEM rows only (skip any SPACERs, etc.)
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        line_items = [
            rr for rr in sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
        ]
        self.assertGreaterEqual(len(line_items), 3)

        descriptions = [li.classified_row.description for li in line_items]
        self.assertEqual(descriptions[0], "First item")
        self.assertEqual(descriptions[1], "Second item")
        self.assertEqual(descriptions[2], "Bold item")


def _multi_area_config() -> MappingConfig:
    """MappingConfig for synthetic_multi_area.xlsx (2 areas: Floor 1, Floor 2; qty + amount cols).

    Per-area qty uses role='qty' with area set (classifier looks for role=='qty' with area).
    Per-area amount uses role='amount_by_area' with area set.
    """
    return MappingConfig(
        project="test",
        master_boq=MasterBoqMetadata(boq_name="test_boq"),
        sheets=[SheetConfig(
            sheet_name="Multi Area",
            header_row=1,
            area_dimensions=["Floor 1", "Floor 2"],
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="unit"),
                "D": ColumnRole(role="qty", area="Floor 1"),
                "E": ColumnRole(role="qty", area="Floor 2"),
                "F": ColumnRole(role="qty_total"),
                "G": ColumnRole(role="rate_supply"),
                "H": ColumnRole(role="amount_by_area", area="Floor 1"),
                "I": ColumnRole(role="amount_by_area", area="Floor 2"),
                "J": ColumnRole(role="amount_total"),
            },
        )],
    )


class TestMultiAreaPostPass(unittest.TestCase):
    """Phase 2b.2 Part B2a — _apply_multi_area_post_pass unit tests."""

    @staticmethod
    def _line_item_row(
        qty_by_area_raw=None,
        amount_by_area_raw=None,
        qty_total=None,
        amount_total=None,
    ):
        from nirmaan_stack.services.boq_parser.classifier import ClassifiedRow, RowClassification
        from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
        from nirmaan_stack.services.boq_parser.reader import RawRow
        classified = ClassifiedRow(
            raw_row=RawRow(row_number=1, cells={}),
            classification=RowClassification.LINE_ITEM,
        )
        return ResolvedRow(
            classified_row=classified,
            qty_by_area_raw=qty_by_area_raw or {},
            amount_by_area_raw=amount_by_area_raw or {},
            qty_total=qty_total,
            amount_total=amount_total,
        )

    @staticmethod
    def _preamble_row():
        from nirmaan_stack.services.boq_parser.classifier import ClassifiedRow, RowClassification
        from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
        from nirmaan_stack.services.boq_parser.reader import RawRow
        classified = ClassifiedRow(
            raw_row=RawRow(row_number=1, cells={}),
            classification=RowClassification.PREAMBLE,
        )
        return ResolvedRow(classified_row=classified)

    # ---------------------------------------------------------------- #
    # Test 1 — Policy X copy: raw dicts → resolved dicts populated     #
    # ---------------------------------------------------------------- #

    def test_policy_x_raw_dicts_copied_to_resolved(self):
        """LINE_ITEM with populated qty_by_area_raw → qty_by_area copied after post-pass."""
        row = self._line_item_row(
            qty_by_area_raw={"Floor 1": 5.0, "Floor 2": 3.0},
            amount_by_area_raw={"Floor 1": 500.0, "Floor 2": 300.0},
            qty_total=8.0,
            amount_total=800.0,
        )
        _apply_multi_area_post_pass([row])
        self.assertEqual(row.qty_by_area, {"Floor 1": 5.0, "Floor 2": 3.0})
        self.assertEqual(row.amount_by_area, {"Floor 1": 500.0, "Floor 2": 300.0})

    # ---------------------------------------------------------------- #
    # Test 2 — Policy X: explicit 0.0 preserved in resolved dicts      #
    # ---------------------------------------------------------------- #

    def test_policy_x_explicit_zeros_preserved_in_resolved(self):
        """Explicit 0.0 in raw dict → 0.0 key present in resolved dict (Policy X)."""
        row = self._line_item_row(
            qty_by_area_raw={"Floor 1": 0.0, "Floor 2": 5.0},
            amount_by_area_raw={"Floor 1": 0.0, "Floor 2": 500.0},
            qty_total=5.0,
            amount_total=500.0,
        )
        _apply_multi_area_post_pass([row])
        self.assertIn("Floor 1", row.qty_by_area)
        self.assertEqual(row.qty_by_area["Floor 1"], 0.0)
        self.assertIn("Floor 1", row.amount_by_area)
        self.assertEqual(row.amount_by_area["Floor 1"], 0.0)

    # ---------------------------------------------------------------- #
    # Test 3 — non-LINE_ITEM rows untouched                            #
    # ---------------------------------------------------------------- #

    def test_non_line_item_rows_not_modified(self):
        """PREAMBLE rows are skipped; qty_by_area/amount_by_area stay {} and no warnings."""
        row = self._preamble_row()
        _apply_multi_area_post_pass([row])
        self.assertEqual(row.qty_by_area, {})
        self.assertEqual(row.amount_by_area, {})
        self.assertEqual(row.validation_warnings, [])

    # ---------------------------------------------------------------- #
    # Test 4 — qty_total fallback when None + per-area populated       #
    # ---------------------------------------------------------------- #

    def test_qty_total_fallback_when_none_no_warning(self):
        """qty_total=None with populated per-area dict → computed from sum; no warning."""
        row = self._line_item_row(
            qty_by_area_raw={"Floor 1": 4.0, "Floor 2": 6.0},
            qty_total=None,
        )
        _apply_multi_area_post_pass([row])
        self.assertEqual(row.qty_total, 10.0)
        self.assertEqual(row.validation_warnings, [])

    # ---------------------------------------------------------------- #
    # Test 5 — amount_total fallback when None + per-area populated    #
    # ---------------------------------------------------------------- #

    def test_amount_total_fallback_when_none_no_warning(self):
        """amount_total=None with populated per-area dict → computed from sum; no warning."""
        row = self._line_item_row(
            amount_by_area_raw={"Floor 1": 200.0, "Floor 2": 300.0},
            amount_total=None,
        )
        _apply_multi_area_post_pass([row])
        self.assertEqual(row.amount_total, 500.0)
        self.assertEqual(row.validation_warnings, [])

    # ---------------------------------------------------------------- #
    # Test 6 — qty sum within ±1 tolerance → no warning                #
    # ---------------------------------------------------------------- #

    def test_qty_sum_within_tolerance_no_warning(self):
        """qty per-area sum == total → no validation warning."""
        row = self._line_item_row(
            qty_by_area_raw={"A": 5.0, "B": 3.0},
            qty_total=8.0,
        )
        _apply_multi_area_post_pass([row])
        self.assertEqual(row.validation_warnings, [])

    # ---------------------------------------------------------------- #
    # Test 7 — qty sum outside ±1 tolerance → warning with values      #
    # ---------------------------------------------------------------- #

    def test_qty_sum_outside_tolerance_emits_warning(self):
        """qty per-area sum differs from total by >1 → warning appended."""
        row = self._line_item_row(
            qty_by_area_raw={"A": 5.0, "B": 3.0},  # sum=8
            qty_total=10.0,                          # diff=2 > ±1
        )
        _apply_multi_area_post_pass([row])
        self.assertEqual(len(row.validation_warnings), 1)
        self.assertIn("qty", row.validation_warnings[0])
        self.assertIn("8.00", row.validation_warnings[0])
        self.assertIn("10.00", row.validation_warnings[0])

    # ---------------------------------------------------------------- #
    # Test 8 — amount sum outside ±1 tolerance → warning               #
    # ---------------------------------------------------------------- #

    def test_amount_sum_outside_tolerance_emits_warning(self):
        """amount per-area sum differs from total by >1 → warning appended."""
        row = self._line_item_row(
            amount_by_area_raw={"A": 100.0, "B": 200.0},  # sum=300
            amount_total=305.0,                             # diff=5 > ±1
        )
        _apply_multi_area_post_pass([row])
        self.assertEqual(len(row.validation_warnings), 1)
        self.assertIn("amount", row.validation_warnings[0])

    # ---------------------------------------------------------------- #
    # Test 9 — both qty and amount mismatch → two separate warnings    #
    # ---------------------------------------------------------------- #

    def test_both_mismatches_produce_two_warnings(self):
        """Both qty and amount mismatches → two warnings, one each."""
        row = self._line_item_row(
            qty_by_area_raw={"A": 5.0, "B": 3.0},       # sum=8
            amount_by_area_raw={"A": 100.0, "B": 200.0},  # sum=300
            qty_total=10.0,     # diff=2
            amount_total=400.0,  # diff=100
        )
        _apply_multi_area_post_pass([row])
        self.assertEqual(len(row.validation_warnings), 2)
        self.assertTrue(any("qty" in w for w in row.validation_warnings))
        self.assertTrue(any("amount" in w for w in row.validation_warnings))


class TestMultiAreaIntegration(unittest.TestCase):
    """Phase 2b.2 Part B2a — full pipeline integration against synthetic_multi_area.xlsx."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        generate_all()

    def test_multi_area_post_pass_full_pipeline(self):
        """
        Full parse_boq() on synthetic_multi_area.xlsx verifies post-pass outcomes:
          Row 2 — clean: per-area dicts populated, no warnings.
          Row 3 — qty mismatch (sum=8 vs total=10): one qty warning.
          Row 4 — blank totals: qty_total/amount_total computed via fallback, no warnings.
        """
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        result = parse_boq(_p("synthetic_multi_area.xlsx"), _multi_area_config())
        self.assertEqual(len(result.sheets), 1)
        sheet = result.sheets[0]

        line_items = [
            rr for rr in sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
        ]
        self.assertEqual(len(line_items), 3, "Expected exactly 3 LINE_ITEM rows")

        painting, tiling, plumbing = line_items

        # Row 2 — clean row: dicts populated, totals match, no warnings
        self.assertEqual(painting.qty_by_area, {"Floor 1": 5.0, "Floor 2": 3.0})
        self.assertEqual(painting.amount_by_area, {"Floor 1": 500.0, "Floor 2": 300.0})
        self.assertEqual(painting.qty_total, 8.0)
        self.assertEqual(painting.amount_total, 800.0)
        self.assertEqual(painting.validation_warnings, [])

        # Row 3 — qty mismatch: per-area sum=8, total=10, diff=2 > ±1 → one warning
        self.assertEqual(tiling.qty_by_area, {"Floor 1": 5.0, "Floor 2": 3.0})
        self.assertEqual(tiling.qty_total, 10.0)
        self.assertEqual(len(tiling.validation_warnings), 1)
        self.assertIn("qty", tiling.validation_warnings[0])

        # Row 4 — blank totals: fallback applied from per-area sums, no warnings
        self.assertEqual(plumbing.qty_by_area, {"Floor 1": 4.0, "Floor 2": 6.0})
        self.assertEqual(plumbing.qty_total, 10.0)   # fallback: 4+6
        self.assertEqual(plumbing.amount_total, 500.0)  # fallback: 200+300
        self.assertEqual(plumbing.validation_warnings, [])


# ================================================================ #
# Phase 2b.2 Part B2c — Snitch real-fixture integration tests      #
# ================================================================ #

_SNITCH_FIXTURE = _FIXTURES / "snitch_electrical.xlsx"
_SNITCH_EXPECTED = _FIXTURES / "snitch_electrical_expected.json"


def _snitch_config() -> MappingConfig:
    """MappingConfig for the Snitch Electrical workbook (5 sheets, 2 active BoQ sheets)."""
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
            SheetConfig(
                sheet_name="6. Electrical",
                header_row=1,
                column_role_map=_elec_cols,
            ),
            SheetConfig(
                sheet_name="7. Light Fixtures",
                header_row=2,
                column_role_map=_elec_cols,
            ),
            SheetConfig(
                sheet_name="MAKE LIST (to be updated)",
                skip=True,
                column_role_map={},
            ),
        ],
    )


class TestSnitchIntegration(unittest.TestCase):
    """
    Phase 2b.2 Part B2c — integration tests against the real Snitch Electrical workbook.

    parse_boq() is called ONCE in setUpClass; the result is shared across all test methods.
    Expected values are loaded from snitch_electrical_expected.json.
    """

    @classmethod
    def setUpClass(cls):
        import json
        super().setUpClass()
        cls.result = parse_boq(str(_SNITCH_FIXTURE), _snitch_config())
        with open(_SNITCH_EXPECTED, encoding="utf-8") as f:
            cls.expected = json.load(f)
        cls.elec_sheet = next(
            s for s in cls.result.sheets if s.sheet_name == "6. Electrical"
        )
        cls.lf_sheet = next(
            s for s in cls.result.sheets if s.sheet_name == "7. Light Fixtures"
        )

    # ---------------------------------------------------------------- #
    # Test 1 — skip sheets absent from output                          #
    # ---------------------------------------------------------------- #

    def test_snitch_skip_sheets_filtered_out(self):
        """OVERALL SUMMARY, SUMMARY MEP, MAKE LIST (to be updated) must not appear in sheets."""
        sheet_names = {s.sheet_name for s in self.result.sheets}
        for absent in self.expected["skip_sheets_expected_absent_from_output"]:
            self.assertNotIn(absent, sheet_names, f"skip sheet {absent!r} should be absent")

    # ---------------------------------------------------------------- #
    # Test 2 — workbook parsed sheet count                             #
    # ---------------------------------------------------------------- #

    def test_snitch_workbook_parsed_sheet_count(self):
        """After skip-filter exactly 2 sheets remain in result.sheets."""
        self.assertEqual(
            len(self.result.sheets),
            self.expected["workbook_assertions"]["parsed_sheet_count_after_skip_filter"],
        )

    # ---------------------------------------------------------------- #
    # Test 3 — master_preamble is empty                                #
    # ---------------------------------------------------------------- #

    def test_snitch_workbook_master_preamble_empty(self):
        """No master_preamble sheet configured; result.master_preamble must be None."""
        self.assertIsNone(self.result.master_preamble)

    # ---------------------------------------------------------------- #
    # Test 4 — no validation warnings anywhere                         #
    # ---------------------------------------------------------------- #

    def test_snitch_workbook_no_validation_warnings(self):
        """
        Snitch has no per-area qty columns; the sum-validation post-pass cannot fire.
        Every resolved row must have an empty validation_warnings list.
        """
        self.assertEqual(self.result.validation_warnings, [])
        for sheet in self.result.sheets:
            self.assertEqual(sheet.validation_warnings, [], f"sheet={sheet.sheet_name}")
            for i, row in enumerate(sheet.resolved_rows):
                self.assertEqual(
                    row.validation_warnings,
                    [],
                    f"sheet={sheet.sheet_name} resolved_idx={i}",
                )

    # ---------------------------------------------------------------- #
    # Test 5 — Electrical total resolved row count + classification    #
    # ---------------------------------------------------------------- #

    def test_snitch_electrical_total_resolved_row_count(self):
        """6. Electrical resolves to 521 rows with correct per-classification breakdown."""
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        rows = self.elec_sheet.resolved_rows
        self.assertEqual(len(rows), 521)
        counts = {}
        for r in rows:
            cls = r.classified_row.classification
            counts[cls] = counts.get(cls, 0) + 1
        exp = self.expected["sheets"]["6. Electrical"]["count_by_classification"]
        self.assertEqual(counts.get(RowClassification.LINE_ITEM, 0), exp["LINE_ITEM"])
        self.assertEqual(counts.get(RowClassification.PREAMBLE, 0), exp["PREAMBLE"])
        self.assertEqual(counts.get(RowClassification.NOTE, 0), exp["NOTE"])
        self.assertEqual(counts.get(RowClassification.SPACER, 0), exp["SPACER"])
        self.assertEqual(counts.get(RowClassification.SUBTOTAL_MARKER, 0), exp["SUBTOTAL_MARKER"])

    # ---------------------------------------------------------------- #
    # Test 6 — Electrical first 5 line items                          #
    # ---------------------------------------------------------------- #

    def test_snitch_electrical_first_5_line_items(self):
        """First 5 LINE_ITEM rows in 6. Electrical match expected sl_no/desc/unit/qty/path."""
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        rows = self.elec_sheet.resolved_rows
        for exp in self.expected["sheets"]["6. Electrical"]["first_5_line_items"]:
            idx = exp["resolved_idx"]
            row = rows[idx]
            cr = row.classified_row
            self.assertEqual(cr.classification, RowClassification.LINE_ITEM, f"idx={idx}")
            self.assertEqual(cr.sl_no_value, exp["sl_no_value"], f"idx={idx} sl_no_value")
            self.assertEqual(cr.description, exp["description"], f"idx={idx} description")
            self.assertEqual(cr.unit, exp["unit"], f"idx={idx} unit")
            self.assertEqual(cr.qty, exp["qty"], f"idx={idx} qty")
            self.assertEqual(row.path, exp["path"], f"idx={idx} path")
            self.assertIsNone(row.level, f"idx={idx} level")

    # ---------------------------------------------------------------- #
    # Test 7 — Electrical subtotal markers                             #
    # ---------------------------------------------------------------- #

    def test_snitch_electrical_subtotal_markers(self):
        """6. Electrical has 9 SUBTOTAL_MARKER rows at the expected resolved indices."""
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        rows = self.elec_sheet.resolved_rows
        actual_subtotals = [
            i for i, r in enumerate(rows)
            if r.classified_row.classification == RowClassification.SUBTOTAL_MARKER
        ]
        self.assertEqual(len(actual_subtotals), 9)
        for exp in self.expected["sheets"]["6. Electrical"]["subtotal_markers"]:
            idx = exp["resolved_idx"]
            row = rows[idx]
            cr = row.classified_row
            self.assertEqual(cr.classification, RowClassification.SUBTOTAL_MARKER, f"idx={idx}")
            self.assertEqual(cr.sl_no_value, exp["sl_no_value"], f"idx={idx} sl_no_value")
            self.assertEqual(cr.description, exp["description"], f"idx={idx} description")
            self.assertIsNone(row.path, f"idx={idx} path")
            self.assertIsNone(row.level, f"idx={idx} level")

    # ---------------------------------------------------------------- #
    # Test 8 — Electrical preamble level transitions                  #
    # ---------------------------------------------------------------- #

    def test_snitch_electrical_preamble_level_transitions(self):
        """First preambles at levels 1, 2, 3 in 6. Electrical have expected sl_no/level/path."""
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        rows = self.elec_sheet.resolved_rows
        for exp in self.expected["sheets"]["6. Electrical"]["preamble_level_transitions"]:
            idx = exp["resolved_idx"]
            row = rows[idx]
            cr = row.classified_row
            self.assertEqual(cr.classification, RowClassification.PREAMBLE, f"idx={idx}")
            self.assertEqual(cr.sl_no_value, exp["sl_no_value"], f"idx={idx} sl_no_value")
            self.assertEqual(row.level, exp["level"], f"idx={idx} level")
            self.assertEqual(row.path, exp["path"], f"idx={idx} path")
            if "description" in exp:
                self.assertEqual(cr.description, exp["description"], f"idx={idx} description")
            elif "description_contains_substring" in exp:
                self.assertIn(
                    exp["description_contains_substring"],
                    cr.description or "",
                    f"idx={idx} description_contains_substring",
                )

    # ---------------------------------------------------------------- #
    # Test 9 — Light Fixtures total resolved row count                 #
    # ---------------------------------------------------------------- #

    def test_snitch_light_fixtures_total_resolved_row_count(self):
        """7. Light Fixtures resolves to exactly 16 rows."""
        self.assertEqual(len(self.lf_sheet.resolved_rows), 16)

    # ---------------------------------------------------------------- #
    # Test 10 — Light Fixtures first 5 line items                     #
    # ---------------------------------------------------------------- #

    def test_snitch_light_fixtures_first_5_line_items(self):
        """First 5 LINE_ITEM rows in 7. Light Fixtures match expected sl_no/desc/unit/qty/path."""
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        rows = self.lf_sheet.resolved_rows
        for exp in self.expected["sheets"]["7. Light Fixtures"]["first_5_line_items"]:
            idx = exp["resolved_idx"]
            row = rows[idx]
            cr = row.classified_row
            self.assertEqual(cr.classification, RowClassification.LINE_ITEM, f"idx={idx}")
            self.assertEqual(cr.sl_no_value, exp["sl_no_value"], f"idx={idx} sl_no_value")
            self.assertEqual(cr.description, exp["description"], f"idx={idx} description")
            self.assertEqual(cr.unit, exp["unit"], f"idx={idx} unit")
            self.assertEqual(cr.qty, exp["qty"], f"idx={idx} qty")
            self.assertEqual(row.path, exp["path"], f"idx={idx} path")
            self.assertIsNone(row.level, f"idx={idx} level")

    # ---------------------------------------------------------------- #
    # Test 11 — Light Fixtures subtotal marker                         #
    # ---------------------------------------------------------------- #

    def test_snitch_light_fixtures_subtotal_marker(self):
        """7. Light Fixtures has exactly 1 SUBTOTAL_MARKER: 'TOTAL - SUPPLY OF LIGHTS'."""
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        rows = self.lf_sheet.resolved_rows
        for exp in self.expected["sheets"]["7. Light Fixtures"]["subtotal_markers"]:
            idx = exp["resolved_idx"]
            row = rows[idx]
            cr = row.classified_row
            self.assertEqual(cr.classification, RowClassification.SUBTOTAL_MARKER, f"idx={idx}")
            self.assertEqual(cr.sl_no_value, exp["sl_no_value"], f"idx={idx} sl_no_value")
            self.assertEqual(cr.description, exp["description"], f"idx={idx} description")
            self.assertIsNone(row.path, f"idx={idx} path")
            self.assertIsNone(row.level, f"idx={idx} level")

    # ---------------------------------------------------------------- #
    # Test 12 — Light Fixtures row 16 PREAMBLE anomaly                 #
    # ---------------------------------------------------------------- #

    def test_snitch_light_fixtures_row_16_preamble_anomaly(self):
        """
        PIR sensor row (resolved_idx=14) is PREAMBLE because col D qty is absent
        (blank-qty-no-rate classifier rule). Level=1, path='14', unit='NOS', qty=None.
        """
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        rows = self.lf_sheet.resolved_rows
        exp = self.expected["sheets"]["7. Light Fixtures"]["row_16_preamble_anomaly"]
        idx = exp["row_index_in_resolved"]
        row = rows[idx]
        cr = row.classified_row
        self.assertEqual(cr.classification, RowClassification.PREAMBLE, "PIR row must be PREAMBLE")
        self.assertEqual(cr.sl_no_value, exp["sl_no_value"], "PIR sl_no_value")
        self.assertEqual(cr.unit, exp["unit"], "PIR unit")
        self.assertIsNone(cr.qty, "PIR qty must be None (blank col D)")
        self.assertEqual(row.level, exp["level"], "PIR level")
        self.assertEqual(row.path, exp["path"], "PIR path")
        self.assertIn(
            "Silver Series Digital PIR",
            cr.description or "",
            "PIR description must contain expected prefix",
        )


if __name__ == "__main__":
    unittest.main()
