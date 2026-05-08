# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import unittest
from pathlib import Path

from nirmaan_stack.services.boq_parser.tests.fixtures.generate_synthetic import (
    generate_all,
)
from nirmaan_stack.services.boq_parser.reader import BoqReader

_FIXTURES = Path(__file__).parent / "tests" / "fixtures"


def _p(name: str) -> str:
    return str(_FIXTURES / name)


class TestBoqReader(unittest.TestCase):
    """Group 2a-B: Reader functionality."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Ensure all fixture files exist (idempotent)
        generate_all()

    # ------------------------------------------------------------------ #
    # Test 7 — list_sheets() exact names                                   #
    # ------------------------------------------------------------------ #

    def test_list_sheets_returns_exact_names(self):
        """list_sheets() preserves trailing whitespace and capitalisation."""
        reader = BoqReader(_p("synthetic_trailing_spaces.xlsx"))
        sheets = reader.list_sheets()
        self.assertIn("Sheet One", sheets)
        self.assertIn("Trailing  ", sheets)   # two trailing spaces

    # ------------------------------------------------------------------ #
    # Test 8 — iter_rows() row numbers and cell counts                     #
    # ------------------------------------------------------------------ #

    def test_iter_rows_yields_correct_row_numbers(self):
        """iter_rows() yields RawRow with row_number 1..6 for the simple fixture."""
        reader = BoqReader(_p("synthetic_simple.xlsx"))
        rows = list(reader.iter_rows("Sheet1", start_row=1, end_row=6))
        self.assertEqual(len(rows), 6)
        for i, row in enumerate(rows, start=1):
            self.assertEqual(row.row_number, i)

    def test_iter_rows_cells_dict_keyed_by_column_letter(self):
        """Row 1 (header row) cells are keyed by uppercase column letters."""
        reader = BoqReader(_p("synthetic_simple.xlsx"))
        rows = list(reader.iter_rows("Sheet1", start_row=1, end_row=1))
        self.assertEqual(len(rows), 1)
        header_row = rows[0]
        self.assertIn("A", header_row.cells)
        self.assertIn("B", header_row.cells)
        self.assertEqual(header_row.cells["A"].value, "Sl.No.")
        self.assertEqual(header_row.cells["B"].value, "Description")

    # ------------------------------------------------------------------ #
    # Test 9 — computed values (data_only=True)                            #
    # ------------------------------------------------------------------ #

    def test_computed_value_read_correctly(self):
        """
        F2 contains the pre-computed value 500 (written directly, not as formula).
        data_only=True workbook returns 500.
        """
        reader = BoqReader(_p("synthetic_simple.xlsx"))
        rows = list(reader.iter_rows("Sheet1", start_row=2, end_row=2))
        f2 = rows[0].get_cell("F")
        self.assertIsNotNone(f2)
        self.assertEqual(f2.value, 500)
        self.assertFalse(f2.is_formula)

    # ------------------------------------------------------------------ #
    # Test 10 — formula detection                                          #
    # ------------------------------------------------------------------ #

    def test_formula_cell_detected(self):
        """
        G2 was written as '=D2*E2' (a raw string starting with '=').
        Reader reports is_formula=True and formula='=D2*E2'.
        """
        reader = BoqReader(_p("synthetic_simple.xlsx"))
        rows = list(reader.iter_rows("Sheet1", start_row=2, end_row=2))
        g2 = rows[0].get_cell("G")
        self.assertIsNotNone(g2)
        self.assertTrue(g2.is_formula)
        self.assertEqual(g2.formula, "=D2*E2")

    def test_non_formula_cell_not_marked_as_formula(self):
        """A plain text/numeric cell must have is_formula=False and formula=None."""
        reader = BoqReader(_p("synthetic_simple.xlsx"))
        rows = list(reader.iter_rows("Sheet1", start_row=1, end_row=1))
        a1 = rows[0].get_cell("A")
        self.assertIsNotNone(a1)
        self.assertFalse(a1.is_formula)
        self.assertIsNone(a1.formula)

    # ------------------------------------------------------------------ #
    # Test 11 — bold formatting                                            #
    # ------------------------------------------------------------------ #

    def test_bold_cell_detected(self):
        """B5 in synthetic_simple has bold=True; other B cells are not bold."""
        reader = BoqReader(_p("synthetic_simple.xlsx"))
        rows = {r.row_number: r for r in reader.iter_rows("Sheet1", start_row=1, end_row=6)}

        b5 = rows[5].get_cell("B")
        self.assertIsNotNone(b5)
        self.assertTrue(b5.font_bold)

        b1 = rows[1].get_cell("B")
        self.assertIsNotNone(b1)
        self.assertFalse(b1.font_bold)

    # ------------------------------------------------------------------ #
    # Test 12 — merged ranges                                              #
    # ------------------------------------------------------------------ #

    def test_merged_origin_detected(self):
        """A3 is the top-left of merged A3:A4 — is_merged_origin=True."""
        reader = BoqReader(_p("synthetic_merged_header.xlsx"))
        rows = {r.row_number: r for r in reader.iter_rows("Data", start_row=3, end_row=4)}

        a3 = rows[3].get_cell("A")
        self.assertIsNotNone(a3)
        self.assertTrue(a3.is_merged_origin)
        self.assertEqual(a3.merged_range, "A3:A4")

    def test_merged_non_origin_not_flagged(self):
        """A4 is inside the merge but not the origin — is_merged_origin=False."""
        reader = BoqReader(_p("synthetic_merged_header.xlsx"))
        rows = {r.row_number: r for r in reader.iter_rows("Data", start_row=3, end_row=4)}

        a4 = rows[4].get_cell("A")
        self.assertIsNotNone(a4)
        self.assertFalse(a4.is_merged_origin)

    # ------------------------------------------------------------------ #
    # Test 13 — detect_header_row on simple fixture                        #
    # ------------------------------------------------------------------ #

    def test_detect_header_row_simple(self):
        """Row 1 of synthetic_simple contains header keywords — must return 1."""
        reader = BoqReader(_p("synthetic_simple.xlsx"))
        result = reader.detect_header_row("Sheet1")
        self.assertEqual(result, 1)

    # ------------------------------------------------------------------ #
    # Test 14 — detect_header_row on merged-header fixture                 #
    # ------------------------------------------------------------------ #

    def test_detect_header_row_merged(self):
        """
        Row 3 of synthetic_merged_header has 'Sl.No.', 'Description', etc.
        Rows 1-2 are title/empty rows. Must return 3.
        """
        reader = BoqReader(_p("synthetic_merged_header.xlsx"))
        result = reader.detect_header_row("Data")
        self.assertEqual(result, 3)

    # ------------------------------------------------------------------ #
    # Test 15 — detect_blank_columns                                       #
    # ------------------------------------------------------------------ #

    def test_detect_blank_columns(self):
        """
        synthetic_blank_cols has content in B, C, D; columns A and Z are blank.
        detect_blank_columns() must include A and Z in the returned set.
        """
        reader = BoqReader(_p("synthetic_blank_cols.xlsx"))
        blank = reader.detect_blank_columns("Sheet1", scan_rows=10)
        self.assertIn("A", blank)
        self.assertIn("Z", blank)
        # Content columns must not appear as blank
        self.assertNotIn("B", blank)
        self.assertNotIn("C", blank)
        self.assertNotIn("D", blank)

    # ------------------------------------------------------------------ #
    # Test 16 — empty workbook edge case                                   #
    # ------------------------------------------------------------------ #

    def test_empty_workbook_iter_rows_returns_empty(self):
        """iter_rows() on an empty sheet must yield nothing and not raise."""
        reader = BoqReader(_p("synthetic_empty.xlsx"))
        rows = list(reader.iter_rows("Empty"))
        self.assertEqual(rows, [])

    def test_empty_workbook_detect_header_returns_none(self):
        """detect_header_row() on an empty sheet must return None."""
        reader = BoqReader(_p("synthetic_empty.xlsx"))
        result = reader.detect_header_row("Empty")
        self.assertIsNone(result)

    def test_empty_workbook_no_exception(self):
        """get_sheet_dimensions() on an empty sheet returns (0, 0) without raising."""
        reader = BoqReader(_p("synthetic_empty.xlsx"))
        dims = reader.get_sheet_dimensions("Empty")
        self.assertEqual(dims, (0, 0))

    # ------------------------------------------------------------------ #
    # Additional — is_blank() on RawRow                                    #
    # ------------------------------------------------------------------ #

    def test_blank_row_detected(self):
        """Row 4 of synthetic_simple is entirely empty — is_blank() must be True."""
        reader = BoqReader(_p("synthetic_simple.xlsx"))
        rows = {r.row_number: r for r in reader.iter_rows("Sheet1", start_row=4, end_row=4)}
        self.assertTrue(rows[4].is_blank())

    def test_non_blank_row_not_blank(self):
        """Row 1 (headers) must not be reported as blank."""
        reader = BoqReader(_p("synthetic_simple.xlsx"))
        rows = {r.row_number: r for r in reader.iter_rows("Sheet1", start_row=1, end_row=1)}
        self.assertFalse(rows[1].is_blank())

    # ------------------------------------------------------------------ #
    # Additional — get_master_preamble_text                                #
    # ------------------------------------------------------------------ #

    def test_get_master_preamble_text(self):
        """get_master_preamble_text() concatenates non-empty cells by newline."""
        reader = BoqReader(_p("synthetic_simple.xlsx"))
        text = reader.get_master_preamble_text("Sheet1")
        self.assertIn("Sl.No.", text)
        self.assertIn("First item", text)


if __name__ == "__main__":
    unittest.main()
