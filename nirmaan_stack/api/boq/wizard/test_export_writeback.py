# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for the priced-workbook export -- specifically the TEMPLATE-ORIGIN from-scratch
branch (ADR-0013 A2-D2 / R4).

A template-cloned BoQ has NO source workbook, so export_priced_workbook GENERATES the priced
.xlsx from the committed tier (grid + pricing + amount formulas) instead of stamping a copy of
the S3 original. Coverage:

  PURE helpers (no DB): header synthesis, the formula-AST -> Excel translator, ref resolution,
  and the regenerated Summary / GST builder (Pre-tax vs Post-tax).

  DB end-to-end: seed a committed template BoQ (single-area data sheet + multi-area data sheet
  + a Make-List general-specs sheet), call export_priced_workbook, decode the base64, load the
  produced workbook, and assert the sheet set, grid cells, overlaid rates, amount cells being
  live Excel formulas, the multi-area Total = =SUM, the per-sheet grand-total row, and the
  Summary's live cross-sheet refs + GST line.

  GUARD: the upload path branch is unchanged (an origin='upload' BoQ with no source_file_url
  still throws the original "has no source_file_url set").

sheet_name carries a trailing space (#152) throughout.
"""
import base64
import io
import json

import frappe
from frappe.tests.utils import FrappeTestCase
from openpyxl import Workbook, load_workbook

from nirmaan_stack.api.boq.wizard import export_template_workbook as etw
from nirmaan_stack.api.boq.wizard.export_writeback import export_priced_workbook
from nirmaan_stack.api.boq.wizard.test_review_screen import _make_project, _cleanup_project


# The canonical stored amount formula: a simple qty_total * scalar-rate multiply.
def _multiply_ast(rate_field="rate_combined"):
    return {
        "op": "*",
        "operands": [
            {"ref": {"value_field": "qty_total", "value_key": None, "rate_subkey": None}},
            {"ref": {"value_field": rate_field, "value_key": None, "rate_subkey": None}},
        ],
    }


# ---------------------------------------------------------------------------
# PURE helper tests (no DB)
# ---------------------------------------------------------------------------
class TestTemplateExportPureHelpers(FrappeTestCase):

    _RM = {
        "A": {"role": "sl_no", "area": None},
        "B": {"role": "description", "area": None},
        "C": {"role": "unit", "area": None},
        "D": {"role": "qty_total", "area": None},
        "E": {"role": "rate_combined", "area": None},
        "F": {"role": "amount_total", "area": None},
    }
    _RM_AREA = {
        **_RM,
        "G": {"role": "qty", "area": "Zone A"},
        "H": {"role": "rate_supply_by_area", "area": "Zone A"},
    }

    def test_header_label_synthesis(self):
        self.assertEqual(etw.header_label_for("sl_no", None), "Sl. No.")
        self.assertEqual(etw.header_label_for("description", None), "Description")
        self.assertEqual(etw.header_label_for("unit", None), "Unit")
        self.assertEqual(etw.header_label_for("qty_total", None), "Total Quantity")
        self.assertEqual(etw.header_label_for("rate_supply", None), "Rate (Supply)")
        self.assertEqual(etw.header_label_for("rate_install", None), "Rate (Install)")
        self.assertEqual(etw.header_label_for("rate_combined", None), "Rate")
        self.assertEqual(etw.header_label_for("amount_supply", None), "Amount (Supply)")
        self.assertEqual(etw.header_label_for("amount_install", None), "Amount (Install)")
        self.assertEqual(etw.header_label_for("amount_total", None), "Amount")
        self.assertEqual(etw.header_label_for("row_notes", None), "Notes")
        # per-area qty column -> the AREA name.
        self.assertEqual(etw.header_label_for("qty", "Block B"), "Block B")
        # by-area rate/amount -> base label + area.
        self.assertEqual(etw.header_label_for("rate_supply_by_area", "Z1"), "Rate (Supply) - Z1")
        # unknown / non-display role -> empty.
        self.assertEqual(etw.header_label_for("ignore", None), "")
        self.assertEqual(etw.header_label_for(None, None), "")

    def test_resolve_ref_col(self):
        self.assertEqual(
            etw.resolve_ref_col({"value_field": "qty_total", "value_key": None}, self._RM), "D")
        self.assertEqual(
            etw.resolve_ref_col({"value_field": "rate_combined", "value_key": None}, self._RM), "E")
        # a scalar field with no matching column -> None.
        self.assertIsNone(
            etw.resolve_ref_col({"value_field": "rate_supply", "value_key": None}, self._RM))
        # area-bound refs resolve via (role, area).
        self.assertEqual(
            etw.resolve_ref_col(
                {"value_field": "qty_by_area", "value_key": "Zone A"}, self._RM_AREA), "G")
        self.assertEqual(
            etw.resolve_ref_col(
                {"value_field": "rate_by_area", "value_key": "Zone A", "rate_subkey": "supply_rate"},
                self._RM_AREA), "H")
        # an area-bound WILDCARD (no value_key) is unresolvable -> None (fail-safe).
        self.assertIsNone(
            etw.resolve_ref_col(
                {"value_field": "rate_by_area", "value_key": None, "rate_subkey": "supply_rate"},
                self._RM_AREA))

    def test_ast_to_excel_multiply(self):
        ast = _multiply_ast()
        self.assertEqual(etw.ast_to_excel(ast, 5, self._RM), "(D5*E5)")
        self.assertEqual(etw.ast_to_excel(ast, 42, self._RM), "(D42*E42)")

    def test_ast_to_excel_single_leaf(self):
        leaf = {"ref": {"value_field": "qty_total", "value_key": None}}
        self.assertEqual(etw.ast_to_excel(leaf, 3, self._RM), "D3")

    def test_ast_to_excel_failsafe_on_unresolvable_operand(self):
        # rate_supply has no column in _RM -> the WHOLE formula fails safe to None -> BLANK cell.
        ast = _multiply_ast(rate_field="rate_supply")
        self.assertIsNone(etw.ast_to_excel(ast, 5, self._RM))

    def test_ast_to_excel_unsupported_op_and_bad_shape(self):
        self.assertIsNone(etw.ast_to_excel({"op": "/", "operands": []}, 5, self._RM))
        self.assertIsNone(etw.ast_to_excel({"op": "*", "operands": []}, 5, self._RM))
        self.assertIsNone(etw.ast_to_excel("not a dict", 5, self._RM))
        self.assertIsNone(etw.ast_to_excel({}, 5, self._RM))

    def test_ast_to_excel_nested_add_inside_multiply(self):
        ast = {
            "op": "*",
            "operands": [
                {"ref": {"value_field": "qty_total", "value_key": None}},
                {"op": "+", "operands": [
                    {"ref": {"value_field": "rate_combined", "value_key": None}},
                    {"ref": {"value_field": "rate_combined", "value_key": None}},
                ]},
            ],
        }
        self.assertEqual(etw.ast_to_excel(ast, 7, self._RM), "(D7*(E7+E7))")

    def test_quote_sheet(self):
        self.assertEqual(etw._quote_sheet("My Sheet"), "'My Sheet'")
        self.assertEqual(etw._quote_sheet("Sheet "), "'Sheet '")           # trailing space kept
        self.assertEqual(etw._quote_sheet("O'Brien"), "'O''Brien'")        # internal quote doubled

    def test_excel_title_sanitizes_and_bounds(self):
        self.assertEqual(etw._excel_title("Normal"), "Normal")
        self.assertEqual(etw._excel_title("A/B*C?[x]"), "A B C  x ")       # illegal chars -> spaces
        self.assertEqual(len(etw._excel_title("x" * 40)), 31)              # bounded to 31
        self.assertEqual(etw._excel_title(""), "Sheet")

    def test_fill_summary_pretax(self):
        wb = Workbook()
        ws = wb.active
        data = [
            {"title": "Elec ", "label": "Electrical",
             "grand": {"amount_supply": "D20", "amount_install": "E20", "amount_total": "F20"}},
            {"title": "Plumb", "label": "Plumbing", "grand": {"amount_total": "F15"}},
        ]
        etw.fill_summary_sheet(ws, data, "Pre-tax")
        self.assertEqual(ws["A1"].value, "SL. No.")
        self.assertEqual(ws["E1"].value, "Total")
        self.assertEqual(ws["B2"].value, "Electrical")
        self.assertEqual(ws["C2"].value, "='Elec '!D20")   # trailing-space title quoted
        self.assertEqual(ws["D2"].value, "='Elec '!E20")
        self.assertEqual(ws["E2"].value, "='Elec '!F20")
        self.assertEqual(ws["E3"].value, "='Plumb'!F15")
        # subtotal row 4, GST 5, GRAND 6.
        self.assertEqual(ws["B4"].value, "Total Amount Excluding Taxes")
        self.assertEqual(ws["E4"].value, "=SUM(E2:E3)")
        self.assertEqual(ws["B5"].value, "GST @ 18%")
        self.assertEqual(ws["E5"].value, "=E4*0.18")
        self.assertEqual(ws["B6"].value, "GRAND TOTAL")
        self.assertEqual(ws["E6"].value, "=E4*1.18")

    def test_fill_summary_posttax_has_no_gst(self):
        wb = Workbook()
        ws = wb.active
        data = [{"title": "Elec", "label": "Electrical", "grand": {"amount_total": "F20"}}]
        etw.fill_summary_sheet(ws, data, "Post-tax")
        self.assertEqual(ws["B3"].value, "Total Amount Excluding Taxes")
        self.assertEqual(ws["B4"].value, "GRAND TOTAL")
        self.assertEqual(ws["E4"].value, "=E3")            # grand == subtotal, no GST multiplier
        labels = [ws.cell(row=r, column=2).value for r in range(1, 8)]
        self.assertNotIn("GST @ 18%", labels)

    def test_fill_summary_total_falls_back_to_supply_plus_install(self):
        # A sheet with only split amount columns (no scalar amount_total) -> Total = C+D.
        wb = Workbook()
        ws = wb.active
        etw.fill_summary_sheet(
            ws, [{"title": "S", "label": "Split",
                  "grand": {"amount_supply": "D9", "amount_install": "E9"}}], "Post-tax")
        self.assertEqual(ws["E2"].value, "=C2+D2")


# ---------------------------------------------------------------------------
# DB-backed seeding helper
# ---------------------------------------------------------------------------
def _seed_template_boq(project_name):
    """Create a committed TEMPLATE BoQ with: a single-area data sheet, a multi-area data sheet,
    and a Make-List general-specs sheet -- each with its committed grid (+ pricing + amount
    formula for the data sheets). Returns the BOQs docname."""
    boq = frappe.new_doc("BOQs")
    boq.project = project_name
    boq.boq_name = "Template Export Test BoQ"
    boq.tax_treatment = "Pre-tax"
    boq.origin = "template"
    boq.area_dimensions = json.dumps(["Zone A", "Zone B"])
    boq.append("general_specs_sheets", {
        "source_sheet_name": "Make List ",
        "preamble_text": "Line 1\nLine 2\nLine 3",
    })
    boq.insert(ignore_permissions=True)
    frappe.db.commit()
    boq_name = boq.name
    now = frappe.utils.now()

    # ---- single-area data sheet "Electrical " ----
    elec_map = {
        "A": {"role": "sl_no", "area": None},
        "B": {"role": "description", "area": None},
        "C": {"role": "unit", "area": None},
        "D": {"role": "qty_total", "area": None},
        "E": {"role": "rate_combined", "area": None},
        "F": {"role": "amount_total", "area": None},
    }
    _seed_committed_sheet(
        boq_name, "Electrical ", "data", 1, elec_map, [], sheet_order=1,
        sheet_label="Electrical", now=now,
        grid=[
            {"row_number": 2, "row_order": 0,
             "cells": {"A": "1", "B": "Wire", "C": "Rmt", "D": 100}},
            {"row_number": 3, "row_order": 1,
             "cells": {"A": "2", "B": "Switch", "C": "Nos", "D": 50}},
        ],
        pricing=[{"excel_row": 2, "col_letter": "E", "rate": 25},
                 {"excel_row": 3, "col_letter": "E", "rate": 200}],
        formula={"target_col": "F", "target_value_field": "amount_total",
                 "formula": _multiply_ast()},
    )

    # ---- multi-area data sheet "HVAC " (Zone A=D, Zone B=E, Total=F) ----
    hvac_map = {
        "A": {"role": "sl_no", "area": None},
        "B": {"role": "description", "area": None},
        "C": {"role": "unit", "area": None},
        "D": {"role": "qty", "area": "Zone A"},
        "E": {"role": "qty", "area": "Zone B"},
        "F": {"role": "qty_total", "area": None},
        "G": {"role": "rate_combined", "area": None},
        "H": {"role": "amount_total", "area": None},
    }
    _seed_committed_sheet(
        boq_name, "HVAC ", "data", 1, hvac_map, ["Zone A", "Zone B"], sheet_order=2,
        sheet_label="HVAC", now=now,
        grid=[
            {"row_number": 2, "row_order": 0,
             "cells": {"A": "1", "B": "AC unit", "C": "Nos", "D": 3, "E": 2, "F": 5}},
            {"row_number": 3, "row_order": 1,
             "cells": {"A": "2", "B": "Duct", "C": "Rmt", "D": 10, "E": 20, "F": 30}},
        ],
        pricing=[{"excel_row": 2, "col_letter": "G", "rate": 1000},
                 {"excel_row": 3, "col_letter": "G", "rate": 50}],
        formula={"target_col": "H", "target_value_field": "amount_total",
                 "formula": _multiply_ast()},
    )

    # ---- Make-List general-specs sheet (grid-only, no pricing/formula) ----
    _seed_committed_sheet(
        boq_name, "Make List ", "master_preamble", 1, {}, [], sheet_order=3,
        sheet_label="Make List", now=now,
        grid=[{"row_number": 1, "row_order": 0, "cells": {"A": "Line 1\nLine 2\nLine 3"}}],
        pricing=[], formula=None, sheet_disposition="grid_only",
    )
    frappe.db.commit()
    return boq_name


def _seed_committed_sheet(boq_name, sheet_name, treat_as, cv, role_map, area_dims,
                          sheet_order, sheet_label, now, grid, pricing, formula,
                          sheet_disposition="grid_and_nodes"):
    sheet = frappe.new_doc("BoQ Sheet")
    sheet.boq = boq_name
    sheet.sheet_name = sheet_name
    sheet.sheet_order = sheet_order
    sheet.sheet_label = sheet_label
    sheet.treat_as = treat_as
    sheet.header_row = 1
    sheet.header_row_count = 1
    sheet.column_role_map = json.dumps(role_map)
    sheet.column_headers = json.dumps({})
    sheet.area_dimensions = json.dumps(area_dims)
    sheet.commit_version = cv
    sheet.is_current = 1
    sheet.committed_at = now
    sheet.insert(ignore_permissions=True)

    g = frappe.new_doc("BoQ Committed Sheet Grid")
    g.boq = boq_name
    g.source_sheet_name = sheet_name
    g.sheet_disposition = sheet_disposition
    g.commit_version = cv
    g.is_current = 1
    g.committed_at = now
    for row in grid:
        g.append("rows", row)
    g.insert(ignore_permissions=True)

    for p in pricing:
        pr = frappe.new_doc("BoQ Cell Pricing")
        pr.boq = boq_name
        pr.sheet_name = sheet_name
        pr.excel_row = p["excel_row"]
        pr.col_letter = p["col_letter"]
        pr.committed_version = cv
        pr.rate = p["rate"]
        pr.is_filled = 1
        pr.pricing_version = 1
        pr.is_current = 1
        pr.priced_at = now
        pr.insert(ignore_permissions=True)

    if formula:
        af = frappe.new_doc("BoQ Cell Amount Formula")
        af.boq = boq_name
        af.sheet_name = sheet_name
        af.committed_version = cv
        af.target_value_field = formula["target_value_field"]
        af.target_col = formula["target_col"]
        af.formula = json.dumps(formula["formula"])
        af.formula_version = 1
        af.is_current = 1
        af.defined_at = now
        af.insert(ignore_permissions=True)


class TestTemplateExportEndToEnd(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.boq = _seed_template_boq(cls.project.name)
        result = export_priced_workbook(
            boq_name=cls.boq,
            sheet_names=json.dumps(["Electrical ", "HVAC ", "Make List "]),
        )
        cls.result = result
        cls.wb = load_workbook(
            io.BytesIO(base64.b64decode(result["content_base64"])), data_only=False
        )

    @classmethod
    def tearDownClass(cls):
        for dt, flt in (
            ("BoQ Cell Amount Formula", {"boq": cls.boq}),
            ("BoQ Cell Pricing", {"boq": cls.boq}),
            ("BoQ Committed Sheet Grid", {"boq": cls.boq}),
            ("BoQ Sheet", {"boq": cls.boq}),
        ):
            frappe.db.delete(dt, flt)
        frappe.db.delete("BOQs", {"name": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    # -- workbook shape --------------------------------------------------------
    def test_sheet_set_and_order(self):
        names = self.wb.sheetnames
        self.assertEqual(names[0], "Summary")               # Summary is FIRST
        self.assertIn("Electrical ", names)                 # trailing-space title (#152)
        self.assertIn("HVAC ", names)
        self.assertIn("Make List ", names)
        # data sheets in sheet_order after Summary.
        self.assertLess(names.index("Electrical "), names.index("HVAC "))

    def test_return_payload_shape(self):
        self.assertEqual(
            set(self.result["exported_sheets"]), {"Electrical ", "HVAC ", "Make List "})
        self.assertEqual(self.result["skipped_formula_columns"], {})   # formulas WRITTEN, none skipped
        self.assertTrue(self.result["filename"].endswith(".xlsx"))
        self.assertEqual(self.result["content_type"], etw._XLSX_CONTENT_TYPE)

    # -- single-area data sheet ------------------------------------------------
    def test_electrical_grid_header_rates_and_amounts(self):
        ws = self.wb["Electrical "]
        # synthesized header row.
        self.assertEqual(ws["A1"].value, "Sl. No.")
        self.assertEqual(ws["B1"].value, "Description")
        self.assertEqual(ws["D1"].value, "Total Quantity")
        self.assertEqual(ws["E1"].value, "Rate")
        self.assertEqual(ws["F1"].value, "Amount")
        # grid cells + static single-area qty (untouched).
        self.assertEqual(ws["B2"].value, "Wire")
        self.assertEqual(ws["D2"].value, 100)
        # overlaid rate.
        self.assertEqual(ws["E2"].value, 25)
        # AMOUNT is a live Excel formula qty*rate.
        self.assertEqual(ws["F2"].value, "=(D2*E2)")
        self.assertEqual(ws["F3"].value, "=(D3*E3)")

    def test_electrical_grand_total_row(self):
        ws = self.wb["Electrical "]
        # data rows 2..3 -> grand-total row 4.
        self.assertEqual(ws["B4"].value, "TOTAL")
        self.assertEqual(ws["F4"].value, "=SUM(F2:F3)")

    # -- multi-area data sheet -------------------------------------------------
    def test_hvac_total_quantity_is_sum_of_areas(self):
        ws = self.wb["HVAC "]
        # area qty columns D (Zone A) + E (Zone B); Total qty F = live SUM.
        self.assertEqual(ws["D1"].value, "Zone A")
        self.assertEqual(ws["E1"].value, "Zone B")
        self.assertEqual(ws["F2"].value, "=SUM(D2:E2)")
        self.assertEqual(ws["F3"].value, "=SUM(D3:E3)")
        # per-area qty grid cells preserved.
        self.assertEqual(ws["D2"].value, 3)
        self.assertEqual(ws["E2"].value, 2)

    def test_hvac_amount_formula_over_total_and_rate(self):
        ws = self.wb["HVAC "]
        self.assertEqual(ws["G2"].value, 1000)             # overlaid rate
        self.assertEqual(ws["H2"].value, "=(F2*G2)")       # amount = Total-qty * rate
        self.assertEqual(ws["H4"].value, "=SUM(H2:H3)")    # grand total

    # -- Make List -------------------------------------------------------------
    def test_make_list_dumps_preamble_lines(self):
        ws = self.wb["Make List "]
        self.assertEqual(ws["A1"].value, "Line 1")
        self.assertEqual(ws["A2"].value, "Line 2")
        self.assertEqual(ws["A3"].value, "Line 3")

    # -- Summary ---------------------------------------------------------------
    def test_summary_cross_sheet_formulas_and_gst(self):
        ws = self.wb["Summary"]
        self.assertEqual(ws["B2"].value, "Electrical")
        self.assertEqual(ws["B3"].value, "HVAC")
        # Electrical grand-total amount cell is F4; quoted trailing-space title.
        self.assertEqual(ws["E2"].value, "='Electrical '!F4")
        self.assertEqual(ws["E3"].value, "='HVAC '!H4")
        # tax block (Pre-tax): subtotal, GST, grand total.
        self.assertEqual(ws["B4"].value, "Total Amount Excluding Taxes")
        self.assertEqual(ws["E4"].value, "=SUM(E2:E3)")
        self.assertEqual(ws["B5"].value, "GST @ 18%")
        self.assertEqual(ws["E5"].value, "=E4*0.18")
        self.assertEqual(ws["B6"].value, "GRAND TOTAL")
        self.assertEqual(ws["E6"].value, "=E4*1.18")

    # -- last_exported_at stamped ----------------------------------------------
    def test_last_exported_at_stamped_on_each_sheet(self):
        for sn in ("Electrical ", "HVAC ", "Make List "):
            val = frappe.db.get_value(
                "BoQ Sheet", {"boq": self.boq, "sheet_name": sn, "is_current": 1},
                "last_exported_at")
            self.assertIsNotNone(val)


class TestUploadPathBranchUnchanged(FrappeTestCase):
    """The is_template branch is a NO-OP for origin != 'template': an upload-origin BoQ with no
    source_file_url still hits the ORIGINAL guard throw (byte-identical upload path)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project.name
        boq.boq_name = "Upload Guard BoQ"
        boq.tax_treatment = "Pre-tax"
        # origin defaults to "upload"; source_file_url left unset.
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BOQs", {"name": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_upload_origin_without_source_file_throws(self):
        with self.assertRaises(frappe.ValidationError):
            export_priced_workbook(boq_name=self.boq, sheet_names=json.dumps(["Any Sheet"]))
