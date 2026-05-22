# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import unittest
from pathlib import Path

from nirmaan_stack.services.boq_parser.tests.fixtures.generate_synthetic import (
    generate_all,
    generate_multi_area_2row,
)
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


def _multi_area_2row_config() -> MappingConfig:
    """MappingConfig for synthetic_multi_area_2row.xlsx (2-row header, Pattern 2: Block A/B)."""
    return MappingConfig(
        project="test",
        master_boq=MasterBoqMetadata(boq_name="test_boq"),
        sheets=[SheetConfig(
            sheet_name="Multi Area 2Row",
            header_row=2,
            header_row_count=2,
            area_dimensions=["Block A", "Block B"],
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="qty", area="Block A"),
                "D": ColumnRole(role="amount_by_area", area="Block A"),
                "E": ColumnRole(role="qty", area="Block B"),
                "F": ColumnRole(role="amount_by_area", area="Block B"),
                "G": ColumnRole(role="rate_supply"),
                "H": ColumnRole(role="amount_total"),
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

        # Pattern 1 detected end-to-end (locks in now-passing behaviour per §9 #43 correction)
        self.assertIsNotNone(sheet.multi_area_pattern)
        self.assertEqual(sheet.multi_area_pattern.pattern, 1)
        self.assertEqual(sheet.multi_area_pattern.areas, ["Floor 1", "Floor 2"])

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
# Phase 2c caveats cleanup — 2-row Pattern 2 integration test      #
# ================================================================ #

class TestMultiAreaDetectionIntegration(unittest.TestCase):
    """Phase 2c §9 #43 — Pattern 2 end-to-end via parse_boq() on 2-row merged header fixture."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        generate_multi_area_2row()
        cls._result = parse_boq(_p("synthetic_multi_area_2row.xlsx"), _multi_area_2row_config())

    def test_pattern_2_detected_via_parse_boq_2row_fixture(self):
        """
        Pattern 2 detected end-to-end via parse_boq() with header_row_count=2.
        Verifies the orchestrator's 2-row routing path (never exercised before §9 #43).
        Also checks per-area qty_by_area populated for first LINE_ITEM row.
        """
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        sheet = self._result.sheets[0]
        self.assertIsNotNone(sheet.multi_area_pattern)
        self.assertEqual(sheet.multi_area_pattern.pattern, 2)
        self.assertEqual(sheet.multi_area_pattern.areas, ["Block A", "Block B"])

        line_items = [
            rr for rr in sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
        ]
        self.assertGreater(len(line_items), 0)
        first = line_items[0]
        self.assertIn("Block A", first.qty_by_area)
        self.assertIn("Block B", first.qty_by_area)


# ================================================================ #
# Phase 1.9g — Pre-header row skip guard                           #
# ================================================================ #


class TestPreHeaderSkip(unittest.TestCase):
    """Phase 1.9g — rows with row_number < header_row must not appear in resolved_rows."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from nirmaan_stack.services.boq_parser.tests.fixtures.generate_synthetic import (
            generate_multi_area_2row,
            generate_pattern_2_rate,
            generate_simple,
        )
        generate_multi_area_2row()
        generate_pattern_2_rate()
        generate_simple()
        cls._2row_result = parse_boq(_p("synthetic_multi_area_2row.xlsx"), _multi_area_2row_config())
        cls._rate_result = parse_boq(_p("synthetic_pattern_2_rate.xlsx"), _pattern_2_rate_config())
        cls._simple_result = parse_boq(_p("synthetic_simple.xlsx"), _simple_config())

    def test_pre_header_row_absent_from_resolved_rows(self):
        """
        synthetic_multi_area_2row.xlsx: header_row=2, so row 1 (top area-label row)
        is a pre-header row and must not appear in resolved_rows after the fix.
        """
        sheet = self._2row_result.sheets[0]
        pre_header = [
            rr for rr in sheet.resolved_rows
            if rr.classified_row.raw_row.row_number < 2
        ]
        self.assertEqual(pre_header, [], "Row 1 must not be in resolved_rows when header_row=2")

    def test_pre_header_row_absent_pattern_2_rate(self):
        """
        synthetic_pattern_2_rate.xlsx: header_row=2, so row 1 (PHASE-1/PHASE-2 merge row)
        is a pre-header row and must not appear in resolved_rows after the fix.
        """
        sheet = self._rate_result.sheets[0]
        pre_header = [
            rr for rr in sheet.resolved_rows
            if rr.classified_row.raw_row.row_number < 2
        ]
        self.assertEqual(pre_header, [], "Row 1 must not be in resolved_rows when header_row=2")

    def test_pre_header_skip_is_noop_for_header_row_1(self):
        """
        synthetic_simple.xlsx: header_row=1, so the guard row_number >= 1 accepts all rows
        and must not accidentally drop any data rows (rows 2, 3, 5).
        """
        sheet = self._simple_result.sheets[0]
        row_numbers = {rr.classified_row.raw_row.row_number for rr in sheet.resolved_rows}
        self.assertIn(2, row_numbers, "Row 2 (First item) must remain in resolved_rows")
        self.assertIn(3, row_numbers, "Row 3 (Second item) must remain in resolved_rows")
        self.assertIn(5, row_numbers, "Row 5 (Bold item) must remain in resolved_rows")


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
        """7. Light Fixtures resolves to exactly 15 rows (16 minus the pre-header disclaimer at Excel row 1)."""
        self.assertEqual(len(self.lf_sheet.resolved_rows), 15)

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

    def test_snitch_row_500_flagged_for_priced_preamble_with_children_review(self):
        """§9 #45: Snitch Electrical row 500 (sl_no=2.0, unit=LS, 5 children)
        must be flagged for wizard review by the §9 #45 post-pass."""
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        row = self.elec_sheet.resolved_rows[500]
        self.assertEqual(row.classified_row.classification, RowClassification.PREAMBLE,
                         "row 500 must remain PREAMBLE — not demoted")
        self.assertTrue(row.needs_classification_review,
                        "row 500 must have needs_classification_review=True")
        self.assertEqual(row.review_reason, "priced_preamble_with_children",
                         "review_reason must be 'priced_preamble_with_children'")

    def test_snitch_light_fixtures_row_16_preamble_anomaly(self):
        """
        PIR sensor row (resolved_idx=14): classifier set PREAMBLE (blank col D qty);
        B2f zero-children demotion then promotes it to LINE_ITEM(qty=0.0, is_rate_only=True)
        because it is a leaf node with unit='NOS'.
        """
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        rows = self.lf_sheet.resolved_rows
        exp = self.expected["sheets"]["7. Light Fixtures"]["row_16_preamble_anomaly"]
        idx = exp["row_index_in_resolved"]
        row = rows[idx]
        cr = row.classified_row
        self.assertEqual(cr.classification, RowClassification.LINE_ITEM, "PIR row must be LINE_ITEM after B2f demotion")
        self.assertEqual(cr.sl_no_value, exp["sl_no_value"], "PIR sl_no_value")
        self.assertEqual(cr.unit, exp["unit"], "PIR unit")
        self.assertEqual(cr.qty, exp["qty"], "PIR qty must be 0.0 after B2f demotion")
        self.assertTrue(cr.is_rate_only, "PIR is_rate_only must be True after B2f demotion")
        self.assertIsNone(row.level, "PIR level must be None (LINE_ITEM)")
        self.assertEqual(row.path, exp["path"], "PIR path")
        self.assertIn(
            "Silver Series Digital PIR",
            cr.description or "",
            "PIR description must contain expected prefix",
        )


class TestRateByAreaPostPass(unittest.TestCase):
    """Phase 1.9a — rate_by_area field on ResolvedRow, populated by _apply_multi_area_post_pass."""

    @staticmethod
    def _line_item_row_with_rate(
        qty_by_area_raw=None,
        rate_by_area_raw=None,
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
            qty_by_area_raw=qty_by_area_raw or {},
            rate_by_area_raw=rate_by_area_raw or {},
        )
        return ResolvedRow(
            classified_row=classified,
            qty_by_area_raw=qty_by_area_raw or {},
            amount_by_area_raw=amount_by_area_raw or {},
            qty_total=qty_total,
            amount_total=amount_total,
        )

    # ---------------------------------------------------------------- #
    # Test 10 — rate_by_area populated on ResolvedRow                  #
    # ---------------------------------------------------------------- #

    def test_per_area_rate_populated_on_resolved_row(self):
        """rate_by_area_raw on ClassifiedRow → rate_by_area copied to ResolvedRow after post-pass."""
        row = self._line_item_row_with_rate(
            qty_by_area_raw={"B1": 10.0, "B2": 20.0},
            rate_by_area_raw={
                "B1": {"combined_rate": 100.0},
                "B2": {"combined_rate": 110.0},
            },
            amount_by_area_raw={"B1": 1000.0, "B2": 2200.0},
        )
        _apply_multi_area_post_pass([row])
        self.assertEqual(row.rate_by_area, {
            "B1": {"combined_rate": 100.0},
            "B2": {"combined_rate": 110.0},
        })

    # ---------------------------------------------------------------- #
    # Test 11 — per-area amount auto-computed from qty × rate           #
    # ---------------------------------------------------------------- #

    def test_per_area_amount_auto_computed_from_qty_and_rate(self):
        """amount_by_area_raw empty + rate_by_area_raw present → amount_by_area auto-computed (qty×rate)."""
        row = self._line_item_row_with_rate(
            qty_by_area_raw={"B1": 10.0, "B2": 20.0},
            rate_by_area_raw={
                "B1": {"combined_rate": 100.0},
                "B2": {"combined_rate": 110.0},
            },
            # amount_by_area_raw intentionally empty → auto-compute triggered
        )
        _apply_multi_area_post_pass([row])
        self.assertAlmostEqual(row.amount_by_area.get("B1"), 1000.0)   # 10 × 100
        self.assertAlmostEqual(row.amount_by_area.get("B2"), 2200.0)   # 20 × 110


# ================================================================ #
# Phase 1.9a — Pattern 2-rate end-to-end integration test          #
# ================================================================ #

def _pattern_2_rate_config() -> MappingConfig:
    """MappingConfig for synthetic_pattern_2_rate.xlsx (2-row header, Pattern 2-rate: PHASE-1/PHASE-2)."""
    return MappingConfig(
        project="test",
        master_boq=MasterBoqMetadata(boq_name="test_boq"),
        sheets=[SheetConfig(
            sheet_name="Pattern 2 Rate",
            header_row=2,
            header_row_count=2,
            area_dimensions=["PHASE-1", "PHASE-2"],
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="qty", area="PHASE-1"),
                "D": ColumnRole(role="rate_combined_by_area", area="PHASE-1"),
                "E": ColumnRole(role="amount_by_area", area="PHASE-1"),
                "F": ColumnRole(role="qty", area="PHASE-2"),
                "G": ColumnRole(role="rate_combined_by_area", area="PHASE-2"),
                "H": ColumnRole(role="amount_by_area", area="PHASE-2"),
            },
        )],
    )


class TestPattern2RateIntegration(unittest.TestCase):
    """Phase 1.9a — end-to-end parse_boq() on synthetic_pattern_2_rate.xlsx."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from nirmaan_stack.services.boq_parser.tests.fixtures.generate_synthetic import generate_pattern_2_rate
        generate_pattern_2_rate()
        cls._result = parse_boq(_p("synthetic_pattern_2_rate.xlsx"), _pattern_2_rate_config())

    # ---------------------------------------------------------------- #
    # Test 12 — end-to-end: pattern detected + per-area data correct    #
    # ---------------------------------------------------------------- #

    def test_pattern_2_rate_end_to_end_synthetic_fixture(self):
        """
        parse_boq() on synthetic_pattern_2_rate.xlsx with header_row_count=2:
          - multi_area_pattern.pattern == 'pattern_2_rate'
          - areas == ['PHASE-1', 'PHASE-2']
          - At least one LINE_ITEM has qty_by_area, rate_by_area, and amount_by_area
            populated correctly for both areas (Civil works row: PHASE-1 qty=5,
            rate=200, amt=1000; PHASE-2 qty=8, rate=200, amt=1600).
        """
        from nirmaan_stack.services.boq_parser.classifier import RowClassification

        sheet = self._result.sheets[0]

        # Pattern detected
        self.assertIsNotNone(sheet.multi_area_pattern)
        self.assertEqual(sheet.multi_area_pattern.pattern, "pattern_2_rate")
        self.assertEqual(sheet.multi_area_pattern.areas, ["PHASE-1", "PHASE-2"])
        self.assertIsNotNone(sheet.multi_area_pattern.rate_columns)
        self.assertEqual(len(sheet.multi_area_pattern.rate_columns), 2)

        # Find the "Civil works" LINE_ITEM (row 4 in fixture, first real data row)
        civil_items = [
            rr for rr in sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
            and rr.classified_row.description == "Civil works"
        ]
        self.assertEqual(len(civil_items), 1, "Expected exactly one 'Civil works' LINE_ITEM")
        row = civil_items[0]

        # Per-area qty
        self.assertAlmostEqual(row.qty_by_area.get("PHASE-1"), 5.0)
        self.assertAlmostEqual(row.qty_by_area.get("PHASE-2"), 8.0)

        # Per-area rate (combined_rate)
        self.assertIn("PHASE-1", row.rate_by_area)
        self.assertIn("PHASE-2", row.rate_by_area)
        self.assertAlmostEqual(row.rate_by_area["PHASE-1"].get("combined_rate"), 200.0)
        self.assertAlmostEqual(row.rate_by_area["PHASE-2"].get("combined_rate"), 200.0)

        # Per-area amount (directly stored in fixture: 1000.0 and 1600.0)
        self.assertAlmostEqual(row.amount_by_area.get("PHASE-1"), 1000.0)
        self.assertAlmostEqual(row.amount_by_area.get("PHASE-2"), 1600.0)

        # No spurious combined!=supply+install warnings (only combined_rate present)
        self.assertEqual(row.validation_warnings, [])


# ================================================================ #
# Phase 1.9c — Real-fixture integration tests (Raheja + D-Tech)   #
# ================================================================ #

_RAHEJA_FIXTURE = _FIXTURES / "RAHEJA Commerzone  Chennai BOQ.xlsx"
_DTECH_FIXTURE = _FIXTURES / "RFQ for D-Tech Electrical BOQ - 05.05.2026 (2).xlsx"


class TestPhase19cRealFixturesRaheja(unittest.TestCase):
    """
    Phase 1.9c — Pattern 2-rate end-to-end against Raheja Commerzone Chennai
    'Electrical ' sheet (trailing space in sheet name preserved exactly).

    Sheet structure:
      Row 2: D2:F2 merged = 'PHASE-1 ' (strips to 'PHASE-1'), G2:I2 = 'PHASE-2'
      Row 3: bottom header — SLNO, DESCRIPTION, UNIT, QTY, RATES, AMOUNT, QTY, RATES, AMOUNT
      header_row=3, header_row_count=2

    This is an unpriced BOQ — all rate cells (E, H) are blank/None.
    Tests verify qty_by_area population rather than rate_by_area.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        config = MappingConfig(
            project="raheja_electrical_test",
            master_boq=MasterBoqMetadata(boq_name="Raheja Commerzone Electrical"),
            sheets=[SheetConfig(
                sheet_name="Electrical ",
                header_row=3,
                header_row_count=2,
                area_dimensions=["PHASE-1", "PHASE-2"],
                column_role_map={
                    "A": ColumnRole(role="sl_no"),
                    "B": ColumnRole(role="description"),
                    "C": ColumnRole(role="unit"),
                    "D": ColumnRole(role="qty", area="PHASE-1"),
                    "E": ColumnRole(role="rate_combined_by_area", area="PHASE-1"),
                    "F": ColumnRole(role="amount_by_area", area="PHASE-1"),
                    "G": ColumnRole(role="qty", area="PHASE-2"),
                    "H": ColumnRole(role="rate_combined_by_area", area="PHASE-2"),
                    "I": ColumnRole(role="amount_by_area", area="PHASE-2"),
                },
            )],
        )
        cls.result = parse_boq(str(_RAHEJA_FIXTURE), config)
        cls.sheet = cls.result.sheets[0]

    def test_electrical_pattern_2_rate_detected(self):
        """
        F3b CLOSED (§9 #62, Phase 1.9d 2026-05-17): _RATE_CELL_PATTERN widened from
        ^\\s*rate\\s*$ to ^\\s*rates?\\s*$ to accept RATES plural alongside RATE singular.
        Raheja Commerzone Electrical uses "RATES" in the bottom header row — now detects
        Pattern 2-rate directly instead of falling through to Pattern 1.
        """
        self.assertIsNotNone(self.sheet.multi_area_pattern)
        self.assertEqual(self.sheet.multi_area_pattern.pattern, "pattern_2_rate")
        self.assertIsNotNone(self.sheet.multi_area_pattern.rate_columns)
        self.assertEqual(len(self.sheet.multi_area_pattern.rate_columns), 2)

    def test_electrical_areas_captured(self):
        """Area names from merged cells: ['PHASE-1', 'PHASE-2'] — trailing space on 'PHASE-1 ' stripped."""
        self.assertEqual(self.sheet.multi_area_pattern.areas, ["PHASE-1", "PHASE-2"])

    def test_electrical_qty_by_area_populated_on_3_plus_rows(self):
        """At least 3 LINE_ITEM rows carry non-empty qty_by_area (unpriced BOQ; rate cells absent)."""
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        rows_with_qty = [
            rr for rr in self.sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
            and bool(rr.qty_by_area)
        ]
        self.assertGreaterEqual(len(rows_with_qty), 3)

    def test_electrical_hand_computed_cross_check_row_40(self):
        """
        Xlsx row 40 (sl_no='1.1.7', '4C x 25sqmm Al Ar cable'):
          D=180 → PHASE-1 qty, G=450 → PHASE-2 qty.
        Verifies end-to-end qty_by_area extraction for a row with both areas populated.
        """
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        matches = [
            rr for rr in self.sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
            and rr.classified_row.sl_no_value == "1.1.7"
            and rr.classified_row.description is not None
            and "4C x 25sqmm Al Ar cable" in rr.classified_row.description
        ]
        self.assertEqual(
            len(matches), 1,
            "Expected exactly one row with sl_no='1.1.7' / '4C x 25sqmm Al Ar cable'",
        )
        row = matches[0]
        self.assertAlmostEqual(row.qty_by_area.get("PHASE-1"), 180.0)
        self.assertAlmostEqual(row.qty_by_area.get("PHASE-2"), 450.0)


class TestPhase19cRealFixturesRahejaHVAC(unittest.TestCase):
    """
    Phase 1.9c — Deliberate stress test: Raheja HVAC sheet has merged area-name row (row 2)
    separated from bottom header row (row 15) by a 13-row summary table gap.
    Current SheetConfig (header_row + header_row_count) assumes the top area-name row is
    always header_row - 1. With that gap the orchestrator reads row 14 (a blank intermediate
    row) as the top header — no merged area names found, pattern detection returns None.

    Test is marked @unittest.expectedFailure (Finding F5). Phase 1.9d candidate.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        config = MappingConfig(
            project="raheja_hvac_test",
            master_boq=MasterBoqMetadata(boq_name="Raheja Commerzone HVAC"),
            sheets=[SheetConfig(
                sheet_name="HVAC ",
                header_row=15,
                header_row_count=2,
                top_header_rows_override=[2],
                area_dimensions=["PHASE-1", "PHASE-2"],
                column_role_map={
                    "A": ColumnRole(role="sl_no"),
                    "B": ColumnRole(role="description"),
                    "C": ColumnRole(role="unit"),
                    "D": ColumnRole(role="qty", area="PHASE-1"),
                    "E": ColumnRole(role="rate_combined_by_area", area="PHASE-1"),
                    "F": ColumnRole(role="amount_by_area", area="PHASE-1"),
                    "G": ColumnRole(role="qty", area="PHASE-2"),
                    "H": ColumnRole(role="rate_combined_by_area", area="PHASE-2"),
                    "I": ColumnRole(role="amount_by_area", area="PHASE-2"),
                },
            )],
        )
        cls.result = parse_boq(str(_RAHEJA_FIXTURE), config)
        cls.sheet = cls.result.sheets[0]

    def test_hvac_pattern_2_rate_with_header_gap(self):
        """
        F5-b CLOSED (§9 #63, Phase 1.9d 2026-05-17): SheetConfig.top_header_rows_override=[2]
        directs the orchestrator to read row 2 (merged area-name row) as the top header,
        bridging the 13-row gap between area names (row 2) and bottom header (row 15).
        Raheja HVAC now detects Pattern 2-rate and finds PHASE-1 / PHASE-2 areas.
        """
        self.assertIsNotNone(self.sheet.multi_area_pattern)
        self.assertEqual(self.sheet.multi_area_pattern.pattern, "pattern_2_rate")


class TestPhase19cRealFixturesDTechCivilWorks(unittest.TestCase):
    """
    Phase 1.9c — append_to_notes end-to-end against D-Tech 'CIVIL WORKS' sheet.

    Header at row 2: B=Floor, C=Area, D=Activity, E=Workitem, F=Description,
    G=Specs, H=Qty, I=Unit, J=Rate, K=Amount.

    Design notes:
      - Specs (G) is always blank in this fixture → Policy-X empty-cell-skip
        verified by asserting 'Specs'/'G' absent from every append_notes_raw.
      - Workitem (E) deliberately omitted from column_headers → its key falls
        back to the column letter 'E' (not 'Workitem').
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        config = MappingConfig(
            project="dtech_civil_works_test",
            master_boq=MasterBoqMetadata(boq_name="D-Tech CIVIL WORKS"),
            sheets=[SheetConfig(
                sheet_name="CIVIL WORKS",
                header_row=2,
                skip_top_rows_after_header=[1],
                column_role_map={
                    "A": ColumnRole(role="sl_no"),
                    "B": ColumnRole(role="append_to_notes"),
                    "C": ColumnRole(role="append_to_notes"),
                    "D": ColumnRole(role="append_to_notes"),
                    "E": ColumnRole(role="append_to_notes"),
                    "F": ColumnRole(role="description"),
                    "G": ColumnRole(role="append_to_notes"),
                    "H": ColumnRole(role="qty"),
                    "I": ColumnRole(role="unit"),
                    "J": ColumnRole(role="rate_combined"),
                    "K": ColumnRole(role="amount_total"),
                },
                # E (Workitem) deliberately omitted to test column-letter fallback
                column_headers={
                    "B": "Floor",
                    "C": "Area",
                    "D": "Activity",
                    "G": "Specs",
                },
            )],
        )
        cls.result = parse_boq(str(_DTECH_FIXTURE), config)
        cls.sheet = cls.result.sheets[0]

    def test_dtech_civil_works_sheet_found(self):
        """CIVIL WORKS sheet present in parse output with resolved rows populated."""
        self.assertEqual(self.sheet.sheet_name, "CIVIL WORKS")
        self.assertGreater(len(self.sheet.resolved_rows), 0)

    def test_dtech_append_notes_raw_populated_on_3_plus_rows(self):
        """At least 3 LINE_ITEM rows carry non-empty append_notes_raw (Floor/Area/Activity)."""
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        rows_with_notes = [
            rr for rr in self.sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
            and bool(rr.classified_row.append_notes_raw)
        ]
        self.assertGreaterEqual(len(rows_with_notes), 3)

    def test_dtech_four_columns_captured_when_four_populated(self):
        """
        Xlsx row 3: Floor='Fourth Floor', Area='CFO Cabin', Activity='Paint Work',
        Workitem (as 'E')='POP Punning', Specs=''.
        Asserts Floor, Area, Activity present; Specs absent (always blank in fixture).
        """
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        matches = [
            rr for rr in self.sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
            and rr.classified_row.append_notes_raw.get("Floor") == "Fourth Floor"
            and rr.classified_row.append_notes_raw.get("Area") == "CFO Cabin"
        ]
        self.assertGreaterEqual(
            len(matches), 1,
            "Expected at least one row with Floor='Fourth Floor', Area='CFO Cabin'",
        )
        row = matches[0]
        notes = row.classified_row.append_notes_raw
        self.assertEqual(notes.get("Floor"), "Fourth Floor")
        self.assertEqual(notes.get("Area"), "CFO Cabin")
        self.assertEqual(notes.get("Activity"), "Paint Work")
        self.assertNotIn("Specs", notes)
        self.assertNotIn("G", notes)

    def test_dtech_policy_x_empty_cell_skip_specs_absent(self):
        """
        Specs (G) is always blank in this fixture. Policy-X: blank/empty-string cells
        produce no key in append_notes_raw. Asserts no LINE_ITEM row ever has 'Specs'
        or 'G' in append_notes_raw.
        """
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        for rr in self.sheet.resolved_rows:
            if rr.classified_row.classification != RowClassification.LINE_ITEM:
                continue
            notes = rr.classified_row.append_notes_raw
            self.assertNotIn("Specs", notes, f"'Specs' should never appear (blank cell): {notes}")
            self.assertNotIn("G", notes, f"'G' should never appear (Specs blank): {notes}")

    def test_dtech_column_headers_fallback_to_column_letter(self):
        """
        Workitem (E) was omitted from column_headers. Its key in append_notes_raw
        must be the column letter 'E', not 'Workitem'.
        Xlsx row 3: E='POP Punning' → append_notes_raw['E'] == 'POP Punning'.
        """
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        matches = [
            rr for rr in self.sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
            and rr.classified_row.append_notes_raw.get("E") == "POP Punning"
        ]
        self.assertGreaterEqual(
            len(matches), 1,
            "Expected rows with append_notes_raw['E']='POP Punning' (column-letter fallback)",
        )
        row = matches[0]
        notes = row.classified_row.append_notes_raw
        self.assertIn("E", notes)
        self.assertEqual(notes["E"], "POP Punning")
        self.assertNotIn("Workitem", notes)


# ================================================================ #
# Bug 6 (sec 9 #84) - Inovalon real-fixture integration test       #
# ================================================================ #

_INOVALON_FIXTURE = _FIXTURES / "Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx"


def _inovalon_config() -> MappingConfig:
    """
    MappingConfig for Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx, sheet 'BOQ'.

    Header is on row 5. Column layout:
      A=sl_no (S. NO), B=description (Item Description), C=unit (UOM),
      D=qty (Total Qty), E=rate_supply (Supply Rate), F=rate_install (Install Rate),
      G=amount_supply (Supply Amount), H=amount_install (Install Amount).
    There is NO amount_total column in this workbook -- amount_total must be derived
    from supply + install via the Bug 6 priority cascade.
    """
    return MappingConfig(
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


class TestBug6InovalonIntegration(unittest.TestCase):
    """
    Bug 6 (sec 9 #84) -- real-fixture integration test against Inovalon HVAC BOQ.

    The Inovalon workbook has amount_supply (col G) and amount_install (col H) columns
    but NO amount_total column. Before Bug 6 fix, cr.amount_total was None for every
    line item. After fix, cr.amount_total = amount_supply + amount_install via Priority 2.

    Uses BoqReader via parse_boq() -- NOT _make_reader mock.
    parse_boq() is called ONCE in setUpClass; result shared across all test methods.

    Ground truth row: Excel row 13, sl_no='1.1.4', desc='CSU AHU -3000 CFM, 12.0 TR...'
      G (amount_supply) = 200000.0
      H (amount_install) = 25000.0
      Expected amount_total = 225000.0  (hand-verified via openpyxl direct read)
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.result = parse_boq(str(_INOVALON_FIXTURE), _inovalon_config())
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        boq_sheet = next(s for s in cls.result.sheets if s.sheet_name == "BOQ")
        cls.line_items = [
            rr for rr in boq_sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
        ]
        # Ground-truth row: sl_no='1.1.4'
        matches = [
            rr for rr in cls.line_items
            if rr.classified_row.sl_no_value == "1.1.4"
        ]
        cls.ground_truth_row = matches[0] if matches else None

    def test_inovalon_loads_and_parses(self):
        """Smoke: parse_boq() returns non-empty result with at least one LINE_ITEM."""
        self.assertIsNotNone(self.result)
        self.assertGreater(len(self.line_items), 0, "BOQ sheet must have at least one LINE_ITEM")

    def test_inovalon_amount_total_summed_from_supply_install(self):
        """
        Row sl_no='1.1.4' (Excel row 13): amount_supply=200000, amount_install=25000.
        After Bug 6 fix: cr.amount_total must equal 225000.0 (supply+install sum).
        """
        self.assertIsNotNone(
            self.ground_truth_row,
            "Row with sl_no='1.1.4' not found in Inovalon BOQ line items"
        )
        cr = self.ground_truth_row.classified_row
        # Verify source fields are populated (confirming the mapping is correct)
        self.assertEqual(cr.amount_supply, 200000.0)
        self.assertEqual(cr.amount_install, 25000.0)
        # Bug 6 fix: amount_total must be derived as supply + install
        self.assertEqual(cr.amount_total, 225000.0)  # ground truth: 200000 + 25000

    def test_inovalon_amount_total_raw_is_none_for_summed_rows(self):
        """
        Row sl_no='1.1.4': amount_total column is absent from the workbook.
        cr.amount_total_raw must be None (Priority 2 path, not Priority 1).
        """
        self.assertIsNotNone(self.ground_truth_row)
        cr = self.ground_truth_row.classified_row
        self.assertIsNone(cr.amount_total_raw,
                          "amount_total_raw must be None when no amount_total column exists")

    def test_inovalon_resolvedrow_amount_total_inherits_cascade(self):
        """
        ResolvedRow.amount_total is initialized from cr.amount_total in resolve_hierarchy().
        After Bug 6 fix, it must equal the cascaded value (225000.0), confirming hierarchy.py
        init propagates the cascade without any code change to hierarchy.py.
        """
        self.assertIsNotNone(self.ground_truth_row)
        rr = self.ground_truth_row
        self.assertEqual(rr.amount_total, 225000.0,
                         "ResolvedRow.amount_total must inherit cascaded value from cr.amount_total")



# -----------------------------------------------------------------------
# Bug 7 (sec 9 #85) — real-fixture integration: multi_area_single_header_v2.xlsx
# -----------------------------------------------------------------------

class TestBug7SingleHeaderV2Integration(unittest.TestCase):
    """
    Real-fixture integration test: multi_area_single_header_v2.xlsx, HVAC BOQ sheet.

    Row 2 header (1-indexed):
      H = "Rate Supply"  → must map to rate_supply  (Bug 7 new keyword)
      I = "Rate Install" → must map to rate_install  (Bug 7 new keyword)
      J = "Total Rate"   → must map to rate_combined (pre-existing keyword)
      F = "Total Qty"    → must map to qty_total     (pre-existing keyword)

    Uses BoqReader directly (not _make_reader mock) via auto_guess_sheet_config().
    parse_boq() smoke verifies end-to-end classification returns LINE_ITEMs.
    """

    _FIXTURE = _FIXTURES / "multi_area_single_header_v2.xlsx"
    _SHEET = "HVAC BOQ"
    _HEADER_ROW = 2

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from nirmaan_stack.services.boq_parser.reader import BoqReader
        from nirmaan_stack.services.boq_parser._auto_guess import auto_guess_sheet_config
        from nirmaan_stack.services.boq_parser.config import GlobalSettings

        kws = GlobalSettings().multi_area_reserved_keywords
        reader = BoqReader(str(cls._FIXTURE))
        cls.sc = auto_guess_sheet_config(
            reader, cls._SHEET, cls._HEADER_ROW,
            header_row_count=1, reserved_keywords=kws,
        )

    def test_fixture_exists(self):
        self.assertTrue(
            self._FIXTURE.exists(),
            f"Fixture not found: {self._FIXTURE}",
        )

    def test_rate_supply_column_h_resolved_correctly(self):
        """'Rate Supply' (col H, row 2) must map to rate_supply via Bug 7 keyword."""
        entry = self.sc.column_role_map.get("H")
        self.assertIsNotNone(entry, "Column H not found in column_role_map")
        self.assertEqual(entry.role, "rate_supply",
            f"Expected H=rate_supply, got {entry.role!r}")

    def test_rate_install_column_i_resolved_correctly(self):
        """'Rate Install' (col I, row 2) must map to rate_install via Bug 7 keyword."""
        entry = self.sc.column_role_map.get("I")
        self.assertIsNotNone(entry, "Column I not found in column_role_map")
        self.assertEqual(entry.role, "rate_install",
            f"Expected I=rate_install, got {entry.role!r}")

    def test_total_rate_column_j_resolved_correctly(self):
        """'Total Rate' (col J, row 2) must map to rate_combined (pre-existing keyword)."""
        entry = self.sc.column_role_map.get("J")
        self.assertIsNotNone(entry, "Column J not found in column_role_map")
        self.assertEqual(entry.role, "rate_combined",
            f"Expected J=rate_combined, got {entry.role!r}")

    def test_total_qty_column_f_resolved_correctly(self):
        """'Total Qty' (col F, row 2) must map to qty_total."""
        entry = self.sc.column_role_map.get("F")
        self.assertIsNotNone(entry, "Column F not found in column_role_map")
        self.assertEqual(entry.role, "qty_total",
            f"Expected F=qty_total, got {entry.role!r}")

    def test_parse_boq_returns_line_items(self):
        """End-to-end smoke: parse_boq() with auto-guessed SheetConfig returns >= 1 LINE_ITEM."""
        from nirmaan_stack.services.boq_parser.classifier import RowClassification

        mc = MappingConfig(
            project="test",
            master_boq=MasterBoqMetadata(boq_name="bug7_integration"),
            sheets=[self.sc],
        )
        result = parse_boq(str(self._FIXTURE), mc)
        boq_sheet = next(
            (s for s in result.sheets if s.sheet_name == self._SHEET), None
        )
        self.assertIsNotNone(boq_sheet, f"Sheet {self._SHEET!r} not found in parse result")
        line_items = [
            rr for rr in boq_sheet.resolved_rows
            if rr.classified_row.classification == RowClassification.LINE_ITEM
        ]
        self.assertGreater(
            len(line_items), 0,
            "Expected at least one LINE_ITEM in HVAC BOQ sheet",
        )


# ================================================================ #
# Bug 10 (sec 9 #86) -- VRF System real-fixture integration test   #
# ================================================================ #

_VRF_FIXTURE = _FIXTURES / "(Unpriced_R1)ES-CW-MS -6A-L1  L2-HVAC MODIFICATION 09.03.2026.xlsx"


def _vrf_config() -> MappingConfig:
    """
    MappingConfig for the VRF System sheet from the HVAC Modification workbook.

    Header rows 9-10 (2-row header; header_row=10 is the bottom row).
    Column layout (row 10 sub-header):
      B=SL. NO., C=DESCRIPTION, D=UNIT,
      E=L1 qty, F=L2 qty, G=TOTAL QTY,
      H=SUPPLY (rate), I=INSTALLATION (rate), J=TOTAL (rate combined),
      K=SUPPLY (amount), L=INSTALLATION (amount), M=TOTAL (amount_total).

    Column M carries =SUM(K<row>:L<row>) on every line item -- the Bug 10
    misfire pattern. After the fix these rows classify as LINE_ITEM.
    """
    return MappingConfig(
        project="vrf_bug10_test",
        master_boq=MasterBoqMetadata(boq_name="VRF System Bug10 Test"),
        sheets=[
            SheetConfig(sheet_name="Assumptions & Exclusions", skip=True, column_role_map={}),
            SheetConfig(sheet_name="SUMMARY-HVAC", skip=True, column_role_map={}),
            SheetConfig(
                sheet_name="VRF System",
                header_row=10,
                header_row_count=2,
                area_dimensions=["L1", "L2"],
                column_role_map={
                    "B": ColumnRole(role="sl_no"),
                    "C": ColumnRole(role="description"),
                    "D": ColumnRole(role="unit"),
                    "E": ColumnRole(role="qty", area="L1"),
                    "F": ColumnRole(role="qty", area="L2"),
                    "G": ColumnRole(role="qty_total"),
                    "H": ColumnRole(role="rate_supply"),
                    "I": ColumnRole(role="rate_install"),
                    "J": ColumnRole(role="rate_combined"),
                    "K": ColumnRole(role="amount_supply"),
                    "L": ColumnRole(role="amount_install"),
                    "M": ColumnRole(role="amount_total"),
                },
            ),
            SheetConfig(sheet_name="Lowside", skip=True, column_role_map={}),
            SheetConfig(sheet_name="Additional work", skip=True, column_role_map={}),
        ],
    )


class TestBug10VrfSameRowSumIntegration(unittest.TestCase):
    """
    Bug 10 (sec 9 #86) -- real-fixture integration test against the VRF System
    sheet from (Unpriced_R1)ES-CW-MS -6A-L1  L2-HVAC MODIFICATION 09.03.2026.xlsx.

    Pre-fix: 57 line items misclassified as SUBTOTAL_MARKER because column M
    carries =SUM(K<row>:L<row>) (supply amount + install amount, same row).
    Post-fix: _is_cross_row_sum() gate identifies same-row references and rows
    correctly classify as LINE_ITEM.

    Per agreement #29 (real-fixture integration required for new pattern logic).
    Per sec 12 unpriced-BoQ workflow: STRUCTURE assertions only -- no rate/amount values.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.result = parse_boq(str(_VRF_FIXTURE), _vrf_config())
        from nirmaan_stack.services.boq_parser.classifier import RowClassification
        cls._RC = RowClassification
        vrf = next(s for s in cls.result.sheets if s.sheet_name == "VRF System")
        cls.vrf_sheet = vrf
        cls.resolved = vrf.resolved_rows

    def test_vrf_fixture_exists(self):
        """Smoke: fixture file exists and parse_boq() returned a VRF System sheet."""
        self.assertTrue(_VRF_FIXTURE.exists(), f"VRF fixture missing: {_VRF_FIXTURE}")
        self.assertIsNotNone(self.result)
        self.assertIsNotNone(self.vrf_sheet)

    def test_vrf_row_1_1_classifies_as_line_item(self):
        """
        Excel row 20 (sl_no='1.1', '5 TR at 36 C ambient') has M20=SUM(K20:L20).
        After Bug 10 fix this row must classify as LINE_ITEM not SUBTOTAL_MARKER.
        """
        matches = [
            rr for rr in self.resolved
            if rr.classified_row.sl_no_value == "1.1"
        ]
        self.assertGreaterEqual(len(matches), 1, "Row with sl_no='1.1' not found in VRF System")
        row = matches[0]
        self.assertEqual(
            row.classified_row.classification,
            self._RC.LINE_ITEM,
            f"sl_no='1.1' must be LINE_ITEM after Bug 10 fix, got "
            f"{row.classified_row.classification}",
        )

    def test_vrf_row_1_2_classifies_as_line_item(self):
        """
        Excel row 21 (sl_no='1.2', '8 TR at 36 C ambient') has M21=SUM(K21:L21).
        After Bug 10 fix this row must classify as LINE_ITEM not SUBTOTAL_MARKER.
        """
        matches = [
            rr for rr in self.resolved
            if rr.classified_row.sl_no_value == "1.2"
        ]
        self.assertGreaterEqual(len(matches), 1, "Row with sl_no='1.2' not found in VRF System")
        row = matches[0]
        self.assertEqual(
            row.classified_row.classification,
            self._RC.LINE_ITEM,
            f"sl_no='1.2' must be LINE_ITEM after Bug 10 fix, got "
            f"{row.classified_row.classification}",
        )

    def test_vrf_line_item_count_increased(self):
        """
        Pre-fix: 57 rows misfired as SUBTOTAL_MARKER, leaving very few LINE_ITEMs.
        Post-fix: at least 30 LINE_ITEMs expected in the VRF System sheet.
        """
        line_item_count = sum(
            1 for rr in self.resolved
            if rr.classified_row.classification == self._RC.LINE_ITEM
        )
        self.assertGreaterEqual(
            line_item_count, 30,
            f"Expected >= 30 LINE_ITEMs post Bug 10 fix, got {line_item_count}",
        )


if __name__ == "__main__":
    unittest.main()
