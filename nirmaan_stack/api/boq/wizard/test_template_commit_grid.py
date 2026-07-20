# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""
T5b -- committed grid rebuilt from review rows for template-origin BoQs (ADR-0013).

A template-cloned BoQ has NO source workbook, so commit_pipeline reconstructs the committed
grid by inverting sheet_config.column_role_map over the review rows instead of reading Excel.
These tests pin the pure inverter (_invert_rows_to_grid) and the DB wrapper
(_template_grid_rows), including the is_excluded filter and the grid_only preamble seed.
"""
import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.commit_pipeline import (
    _invert_rows_to_grid,
    _template_grid_rows,
    _as_json_dict,
)
from nirmaan_stack.api.boq.wizard.test_review_screen import _make_project, _cleanup_project


# A config exercising a scalar column, an area qty column, and an area rate column.
_CFG = {
    "header_row": 1,
    "header_row_count": 1,
    "column_role_map": {
        "A": {"role": "sl_no", "area": None},
        "B": {"role": "description", "area": None},
        "C": {"role": "unit", "area": None},
        "D": {"role": "qty_total", "area": None},
        "E": {"role": "rate_supply", "area": None},
        "F": {"role": "amount_total", "area": None},
        "G": {"role": "qty", "area": "Zone A"},
        "H": {"role": "rate_supply_by_area", "area": "Zone A"},
    },
    "column_headers": {},
    "area_dimensions": ["Zone A"],
}


class TestInvertRowsToGrid(FrappeTestCase):
    """Pure (DB-free) tests of the column_role_map inversion."""

    def test_scalar_roles_placed_in_their_columns(self):
        rows = [{
            "row_index": 0, "source_row_number": 7,
            "sl_no_value": "1.0", "description": "Supply duct", "unit": "Rmt",
            "qty_total": 50, "rate_supply": 100.5, "amount_total": 5025,
            "make_model": "ACME",
        }]
        grid = _invert_rows_to_grid(rows, _CFG)
        self.assertEqual(len(grid), 1)
        self.assertEqual(grid[0]["row_number"], 7)
        self.assertEqual(grid[0]["cells"], {
            "A": "1.0", "B": "Supply duct", "C": "Rmt",
            "D": 50, "E": 100.5, "F": 5025,
        })

    def test_area_qty_and_rate_from_by_area_dicts(self):
        rows = [{
            "row_index": 0, "source_row_number": 3,
            "qty_by_area": {"Zone A": 12},
            "rate_by_area": {"Zone A": {"supply_rate": 88, "install_rate": 9}},
        }]
        grid = _invert_rows_to_grid(rows, _CFG)
        self.assertEqual(grid[0]["cells"].get("G"), 12)          # qty area
        self.assertEqual(grid[0]["cells"].get("H"), 88)          # rate_supply_by_area

    def test_by_area_json_string_is_coerced(self):
        # frappe.db.get_all may return JSON columns as raw strings.
        rows = [{
            "row_index": 0, "source_row_number": 3,
            "qty_by_area": json.dumps({"Zone A": 5}),
            "rate_by_area": json.dumps({"Zone A": {"supply_rate": 7}}),
        }]
        grid = _invert_rows_to_grid(rows, _CFG)
        self.assertEqual(grid[0]["cells"].get("G"), 5)
        self.assertEqual(grid[0]["cells"].get("H"), 7)

    def test_none_values_are_omitted_from_cells(self):
        rows = [{
            "row_index": 0, "source_row_number": 1,
            "description": "Only me", "unit": None, "qty_total": None,
        }]
        grid = _invert_rows_to_grid(rows, _CFG)
        self.assertEqual(grid[0]["cells"], {"B": "Only me"})
        self.assertNotIn("C", grid[0]["cells"])
        self.assertNotIn("D", grid[0]["cells"])

    def test_synthetic_row_falls_back_to_row_index_for_row_number(self):
        rows = [{"row_index": 4, "source_row_number": None, "description": "New row"}]
        grid = _invert_rows_to_grid(rows, _CFG)
        self.assertEqual(grid[0]["row_number"], 4)

    def test_zero_source_row_number_falls_back_to_row_index(self):
        # source_row_number is a NOT-NULL Int coerced to 0 for un-healed old synthetic rows;
        # a 0 must fall back to row_index (a row 0 crashes the from-scratch priced export).
        rows = [{"row_index": 6, "source_row_number": 0, "description": "Stray zero"}]
        grid = _invert_rows_to_grid(rows, _CFG)
        self.assertEqual(grid[0]["row_number"], 6)

    def test_empty_role_map_yields_empty_cells(self):
        grid = _invert_rows_to_grid(
            [{"row_index": 0, "source_row_number": 1, "description": "x"}],
            {"column_role_map": {}},
        )
        self.assertEqual(grid[0]["cells"], {})

    def test_as_json_dict_helper(self):
        self.assertEqual(_as_json_dict(None), {})
        self.assertEqual(_as_json_dict("not json"), {})
        self.assertEqual(_as_json_dict("[1,2]"), {})          # list -> {}
        self.assertEqual(_as_json_dict('{"a": 1}'), {"a": 1})
        self.assertEqual(_as_json_dict({"a": 1}), {"a": 1})


class TestTemplateGridRows(FrappeTestCase):
    """DB-backed tests of _template_grid_rows: the is_excluded filter + grid_only seed."""

    SHEET = "T5b Grid "  # VERBATIM trailing space (#152)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project.name
        boq.boq_name = "T5b Template Grid BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.origin = "template"
        boq.append("sheet_drafts", {
            "sheet_name": cls.SHEET,
            "sheet_order": 1,
            "wizard_status": "Finalized",
            "sheet_config": json.dumps(_CFG),
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def tearDown(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq})
        frappe.db.commit()
        super().tearDown()

    def _seed(self, row_index, is_excluded, **kw):
        doc = frappe.new_doc("BoQ Review Row")
        doc.boq = self.boq
        doc.sheet_name = self.SHEET
        doc.row_index = row_index
        doc.source_row_number = kw.pop("source_row_number", row_index + 1)
        doc.classification = kw.pop("classification", "line_item")
        doc.parent_index = -1
        doc.is_excluded = is_excluded
        for k, v in kw.items():
            setattr(doc, k, v)
        doc.insert(ignore_permissions=True)
        frappe.db.commit()

    def _draft(self):
        return next(d for d in frappe.get_doc("BOQs", self.boq).sheet_drafts
                    if d.sheet_name == self.SHEET)

    def test_excluded_rows_are_filtered_out(self):
        self._seed(0, 0, description="Included A", qty_total=10)
        self._seed(1, 1, description="Excluded B", qty_total=20)  # deselected
        self._seed(2, 0, description="Included C", qty_total=30)
        grid = _template_grid_rows(self.boq, self.SHEET, self._draft(), "grid_and_nodes",
                                   frappe.get_doc("BOQs", self.boq))
        descriptions = [r["cells"].get("B") for r in grid]
        self.assertEqual(descriptions, ["Included A", "Included C"])
        self.assertEqual([r["cells"].get("D") for r in grid], [10, 30])

    def test_grid_only_sheet_seeds_from_preamble_text(self):
        boq_doc = frappe.get_doc("BOQs", self.boq)
        boq_doc.append("general_specs_sheets", {
            "source_sheet_name": self.SHEET,
            "preamble_text": "General specifications apply.",
        })
        boq_doc.save(ignore_permissions=True)
        frappe.db.commit()
        grid = _template_grid_rows(self.boq, self.SHEET, self._draft(), "grid_only", boq_doc)
        self.assertEqual(len(grid), 1)
        self.assertEqual(grid[0]["cells"], {"A": "General specifications apply."})
