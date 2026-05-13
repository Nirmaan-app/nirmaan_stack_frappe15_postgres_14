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
from nirmaan_stack.services.boq_parser.orchestrator import ParsedBoq, ParsedSheet, parse_boq

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


if __name__ == "__main__":
    unittest.main()
