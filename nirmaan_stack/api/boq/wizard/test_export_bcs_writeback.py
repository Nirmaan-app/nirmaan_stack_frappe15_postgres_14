# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for the INTERNAL priced workbook -- the client export PLUS the cost block.

TWO THINGS ARE UNDER TEST HERE, and the second matters as much as the first:

  1. THE BLOCK IS RIGHT -- the cost columns land where the remark column would have, carry
     the grid's own headers, hold values read straight off `BoQ Row BCS Rate`, and the Total
     column holds an EXCEL FORMULA that blanks exactly where the screen blanks.
  2. THE SEPARATION IS REAL -- the client export is untouched, still leaks nothing, and the
     two exports over the SAME fixture differ in exactly the intended way. A guard saying
     "the client file has no BCS" is only worth something beside one saying "and this file
     does", or the first could be passing because there was nothing to find.

Run:
    bench --site localhost run-tests --module \\
        nirmaan_stack.api.boq.wizard.test_export_bcs_writeback
"""
import base64
import io
import json
import os
import tempfile

import frappe
import openpyxl
from frappe.tests.utils import FrappeTestCase
from openpyxl import load_workbook

from nirmaan_stack.api.boq.wizard.export_bcs_writeback import (
    _builtin_total,
    _next_empty_col,
    _generate_internal_workbook,
    _guarded,
    _next_empty_col,
    _ref_to_excel,
    _tree_to_excel,
    export_priced_workbook_with_bcs,
)
from nirmaan_stack.api.boq.wizard.export_writeback import _generate_priced_workbook
from nirmaan_stack.api.boq.wizard.test_export_writeback import _seed_committed_sheet
from nirmaan_stack.api.boq.wizard.test_review_screen import _cleanup_project, _make_project

_ROLE_MAP = {
    "A": {"role": "description", "area": None},
    "B": {"role": "unit", "area": None},
    "C": {"role": "qty_total", "area": None},
    "D": {"role": "rate_supply", "area": None},
    "E": {"role": "rate_install", "area": None},
    "F": {"role": "amount_total", "area": None},
}
# Deliberately absurd sentinels, so a hit in the produced workbook can only be ours.
_SUPPLY = 987654.21
_INSTALL = 123456.78


def _ref(value_field):
    return {"ref": {"value_field": value_field, "value_key": None, "rate_subkey": None}}


def _declared_total_tree():
    """`(bcs_supply + bcs_install) * qty_total` -- the exact shape all four declared
    `bcs_total` formulas on the live bench carry (measured 2026-08-19)."""
    return {"op": "*", "operands": [
        {"op": "+", "operands": [_ref("bcs_supply"), _ref("bcs_install")]},
        _ref("qty_total"),
    ]}


# ===========================================================================
# Group 1: the pure Excel-emitting helpers -- no site data at all
# ===========================================================================
class TestExcelEmitters(FrappeTestCase):
    """The formula writer, at its own seam. Nothing here needs a BoQ."""

    _COST = {"supply": "G", "install": "H"}
    _ROLE = _ROLE_MAP

    def test_a_cost_operand_resolves_to_the_column_we_wrote(self):
        body, cells = _ref_to_excel(_ref("bcs_supply")["ref"], 5, self._COST, ["C"], self._ROLE)
        self.assertEqual(body, "G5")
        self.assertEqual(cells, [], "a cost cell WE wrote is never a sheet cell to guard on")

    def test_the_qty_operand_sums_the_sheets_quantity_cells(self):
        """`bcs_qty` has no column of its own -- it IS the derived quantity columns, summed,
        which is what `bcsRowQuantity` does on screen."""
        body, cells = _ref_to_excel(_ref("bcs_qty")["ref"], 5, self._COST, ["C", "K"], self._ROLE)
        self.assertEqual(body, "(C5+K5)")
        self.assertEqual(cells, ["C5", "K5"])

    def test_a_sheet_column_ref_goes_through_the_shared_resolver(self):
        """A sheet-column ref must mean the SAME thing in both exports, so it resolves through
        `export_template_workbook.resolve_ref_col` rather than a second role-map walk."""
        body, cells = _ref_to_excel(_ref("qty_total")["ref"], 9, self._COST, ["C"], self._ROLE)
        self.assertEqual(body, "C9")
        self.assertEqual(cells, ["C9"], "a CLIENT cell can be blank, so it must be guarded on")

    def test_an_unresolvable_ref_fails_safe_to_blank(self):
        for ref in (
            _ref("make_model")["ref"],          # a real field, not mapped on this sheet
            _ref("not_a_field_at_all")["ref"],
            {"value_field": "bcs_combined"},    # a kind this sheet has no column for
        ):
            body, cells = _ref_to_excel(ref, 5, self._COST, ["C"], self._ROLE)
            self.assertIsNone(body, ref)
            self.assertEqual(cells, [])

    def test_the_qty_operand_with_no_quantity_columns_fails_safe(self):
        body, _ = _ref_to_excel(_ref("bcs_qty")["ref"], 5, self._COST, [], self._ROLE)
        self.assertIsNone(body)

    def test_a_declared_tree_becomes_the_expected_excel(self):
        body, cells = _tree_to_excel(_declared_total_tree(), 5, self._COST, ["C"], self._ROLE)
        self.assertEqual(body, "((G5+H5)*C5)")
        self.assertEqual(cells, ["C5"])

    def test_every_operator_node_is_bracketed_so_the_fold_survives(self):
        """`-` and `/` fold LEFT TO RIGHT from operands[0], so the list order IS the
        arithmetic. Bracketing every node is what makes Excel read an n-ary `(A-B-C)` the way
        `foldOperands` folds it."""
        tree = {"op": "-", "operands": [_ref("bcs_supply"), _ref("bcs_install"),
                                        _ref("qty_total")]}
        body, _ = _tree_to_excel(tree, 2, self._COST, ["C"], self._ROLE)
        self.assertEqual(body, "(G2-H2-C2)")

    def test_an_unsupported_operator_blanks_the_whole_cell(self):
        tree = {"op": "^", "operands": [_ref("bcs_supply"), _ref("bcs_install")]}
        self.assertEqual(_tree_to_excel(tree, 2, self._COST, ["C"], self._ROLE), (None, []))

    def test_one_unresolvable_operand_blanks_the_whole_cell(self):
        """Fail-safe, never partial: half a cost formula is worse than none."""
        tree = {"op": "*", "operands": [_ref("bcs_supply"), _ref("make_model")]}
        self.assertEqual(_tree_to_excel(tree, 2, self._COST, ["C"], self._ROLE), (None, []))

    def test_a_malformed_node_blanks_rather_than_raising(self):
        for node in (None, [], {}, {"operands": []}, {"op": "*", "operands": []}):
            self.assertEqual(_tree_to_excel(node, 2, self._COST, ["C"], self._ROLE), (None, []))

    def test_the_builtin_rule_is_costs_summed_times_quantity_summed(self):
        body, cells = _builtin_total(7, ["supply", "install"], self._COST, ["C"])
        self.assertEqual(body, "(G7+H7)*(C7)")
        self.assertEqual(cells, ["C7"])

    def test_the_builtin_rule_needs_both_sides(self):
        self.assertEqual(_builtin_total(7, ["supply"], self._COST, []), (None, []))
        self.assertEqual(_builtin_total(7, [], self._COST, ["C"]), (None, []))

    # -- the guard, which is where a blank stays a blank -------------------
    def test_the_builtin_guard_blanks_only_when_NOTHING_is_numeric(self):
        """`bcsRowQuantity` sums whatever resolves and returns null only when nothing does, so
        the built-in guard is `COUNT = 0`. A genuine 0 quantity still computes and still reads
        0 -- which is what the screen shows for it."""
        self.assertEqual(
            _guarded("(G5+H5)*(C5)", ["C5"], False), '=IF(COUNT(C5)=0,"",(G5+H5)*(C5))'
        )

    def test_the_declared_guard_blanks_when_ANY_operand_is_missing(self):
        """`evaluateBcsTotalFormula` returns on the FIRST unresolved ref, so a declared formula
        blanks when any of its sheet operands is non-numeric -- `COUNT < n`, not `COUNT = 0`.
        The two shapes are not interchangeable."""
        self.assertEqual(
            _guarded("((G5+H5)*C5)", ["C5", "K5"], True),
            '=IF(COUNT(C5,K5)<2,"",((G5+H5)*C5))',
        )

    def test_a_formula_reading_no_client_cell_needs_no_guard(self):
        """Every cell it reads is one WE wrote, and those exist whenever the row is costed."""
        self.assertEqual(_guarded("(G5+H5)", [], False), "=(G5+H5)")

    def test_the_column_scan_steps_past_anything_that_carries_data(self):
        """★ THE SAFETY PROPERTY OF THE WHOLE PLACEMENT RULE, and it had no test until now.
        The block starts at the TRUE data edge and scans RIGHT past any column that carries
        real content -- a stray estimator note, or a trailing column the role map never
        covered. Without the scan the block would silently overwrite it."""
        ws = openpyxl.Workbook().active
        ws["G2"] = "an estimator note one past the mapped edge"
        ws["H5"] = 0                      # a genuine 0 is CONTENT, not emptiness
        ws["I3"] = ""                     # an empty string is NOT content
        self.assertEqual(_next_empty_col(ws, 7), 9, "G and H are taken; I is free")
        self.assertEqual(_next_empty_col(ws, 9), 9, "an already-empty start is returned as is")
        self.assertEqual(_next_empty_col(ws, 20), 20)

    def test_every_emitted_formula_starts_with_an_equals_sign(self):
        """openpyxl types a cell as a formula from the leading `=`. Without it the workbook
        would carry a string that LOOKS like a formula and computes nothing -- and the fidelity
        delta would be wrong too, since the cell would not count as a formula."""
        for out in (
            _guarded("(G5+H5)*(C5)", ["C5"], False),
            _guarded("((G5+H5)*C5)", ["C5"], True),
            _guarded("(G5+H5)", [], False),
        ):
            self.assertTrue(out.startswith("="), out)


# ===========================================================================
# Group 2 + 3: end to end on a synthetic workbook, and the separation
# ===========================================================================
class TestInternalWorkbookEndToEnd(FrappeTestCase):
    """One upload-origin BoQ, three sheets, exported BOTH ways from the SAME fixture.

    The workbook is synthetic and `_generate_internal_workbook` is called directly -- the same
    seam `export_writeback` created so a test can inject a workbook and bypass the S3 fetch.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._tmps = []
        cls.project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project.name
        boq.boq_name = "Internal Export BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.source_file_url = "/files/synthetic.xlsx"  # never read: we inject the path
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        now = frappe.utils.now()

        grid = [{"row_number": r, "cells": json.dumps({})} for r in range(1, 7)]
        for sheet in ("Elec ", "HVAC "):
            _seed_committed_sheet(
                cls.boq, sheet, "data", 1, _ROLE_MAP, [], 1, sheet.strip(), now,
                grid,
                [{"excel_row": 2, "col_letter": "D", "rate": 25}],
                None,
            )
            frappe.db.set_value("BoQ Sheet",
                                {"boq": cls.boq, "sheet_name": sheet, "is_current": 1},
                                "bcs_enabled", 1, update_modified=False)
        # A grid-only general-specs sheet: no rates, no nodes, no costs.
        _seed_committed_sheet(cls.boq, "Specs ", "master_preamble", 1, _ROLE_MAP, [], 3,
                              "Specs", now, grid, [], None, sheet_disposition="grid_only")

        # HVAC declares a bcs_total formula; Elec does not, so it takes the built-in rule.
        af = frappe.new_doc("BoQ Cell Amount Formula")
        af.boq = cls.boq
        af.sheet_name = "HVAC "
        af.committed_version = 1
        af.target_value_field = "bcs_total"
        af.target_col = None
        af.formula = json.dumps(_declared_total_tree())
        af.formula_version = 1
        af.is_current = 1
        af.defined_at = now
        af.insert(ignore_permissions=True)

        # Costs on rows 2 and 3 of both sheets. Row 4 is UNCOSTED and row 5 is costed but has
        # NO quantity -- the two rows that must come out blank, for different reasons.
        for sheet in ("Elec ", "HVAC "):
            for excel_row in (2, 3, 5):
                doc = frappe.new_doc("BoQ Row BCS Rate")
                doc.boq = cls.boq
                doc.sheet_name = sheet
                doc.excel_row = excel_row
                doc.committed_version = 1
                doc.supply_rate = _SUPPLY
                doc.install_rate = _INSTALL
                doc.combined_rate = 0.0
                doc.is_filled = 1
                doc.bcs_version = 1
                doc.is_current = 1
                doc.bcs_rated_at = now
                doc.insert(ignore_permissions=True)

        # A remark, so the remark column's placement relative to the block is under test.
        rm = frappe.new_doc("BoQ Cell Remark")
        rm.boq = cls.boq
        rm.sheet_name = "Elec "
        rm.excel_row = 2
        rm.committed_version = 1
        rm.remark = "a remark"
        rm.remark_version = 1
        rm.is_current = 1
        rm.remarked_at = now
        rm.insert(ignore_permissions=True)
        frappe.db.commit()

        cls.sheets = ["Elec ", "HVAC ", "Specs "]
        cls.result = _generate_internal_workbook(
            cls.boq, cls.sheets, cls._synthetic_workbook(), "Internal Export BoQ"
        )
        cls.wb = load_workbook(
            io.BytesIO(base64.b64decode(cls.result["content_base64"])), data_only=False
        )
        # ⚠️ CAPTURED BEFORE THE CLIENT EXPORT RUNS. The client export STAMPS
        # `last_exported_at` and commits -- that is its correct behaviour -- so reading the
        # field afterwards would tell us nothing about ours. This is the only moment the
        # question can be asked honestly.
        cls.stamp_after_internal = frappe.db.get_value(
            "BoQ Sheet", {"boq": cls.boq, "sheet_name": "HVAC ", "is_current": 1},
            "last_exported_at")

        # The CLIENT export over the very same fixture, for the separation guards. Called at
        # its own injectable seam (the one its docstring says exists so a test can supply a
        # synthetic workbook) -- the public endpoint would go to S3 for the source file.
        cls.client_result = _generate_priced_workbook(
            cls.boq, cls.sheets, cls._synthetic_workbook(), "Internal Export BoQ"
        )

    @classmethod
    def _synthetic_workbook(cls):
        """A minimal three-sheet workbook shaped like _ROLE_MAP, written to a tempfile the
        caller stamps. F holds a real formula, so the fidelity guard has something to protect."""
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        for title in ("Elec ", "HVAC ", "Specs "):
            ws = wb.create_sheet(title=title)
            ws["A1"], ws["B1"], ws["C1"] = "Description", "Unit", "Qty"
            ws["D1"], ws["E1"], ws["F1"] = "Rate (S)", "Rate (I)", "Amount"
            for r in (2, 3, 4):
                ws[f"A{r}"] = f"item {r}"
                ws[f"C{r}"] = 10 * r
                ws[f"F{r}"] = f"=C{r}*(D{r}+E{r})"
            ws["A5"] = "no quantity on this row"   # C5 deliberately EMPTY
        fd, path = tempfile.mkstemp(suffix=".xlsx")
        os.close(fd)
        wb.save(path)
        cls._tmps.append(path)  # every copy is tracked, so none is leaked
        return path

    @classmethod
    def tearDownClass(cls):
        for path in cls._tmps:
            try:
                os.unlink(path)
            except OSError:
                pass
        for dt in ("BoQ Row BCS Rate", "BoQ Cell Remark", "BoQ Cell Amount Formula",
                   "BoQ Cell Pricing", "BoQ Committed Sheet Grid", "BoQ Sheet"):
            frappe.db.delete(dt, {"boq": cls.boq})
        frappe.db.delete("BOQs", {"name": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    # -- placement ---------------------------------------------------------
    def test_the_block_lands_immediately_after_the_true_data_edge(self):
        """F is the rightmost MAPPED column, so the block starts at G -- the same rule the
        remark column uses, and deliberately NOT openpyxl's max_column."""
        block = self.result["cost_blocks"]["Elec "]
        self.assertEqual(block["cost_columns"], {"supply": "G", "install": "H"})
        self.assertEqual(block["total_column"], "I")

    def test_the_headers_read_exactly_as_the_grids_columns_read(self):
        ws = self.wb["Elec "]
        self.assertEqual(ws["G1"].value, "BCS Cost (Supply)")
        self.assertEqual(ws["H1"].value, "BCS Cost (Installation)")
        self.assertEqual(ws["I1"].value, "BCS Total Amount")

    def test_the_remark_column_comes_after_the_block(self):
        """Owner ruling: the block first, `Nirmaan Remarks` last -- the position people already
        know it by. It falls out of the pass order, because the remark scan steps right past
        anything non-empty."""
        self.assertEqual(self.result["remark_columns"]["Elec "], "J")
        self.assertEqual(self.wb["Elec "]["J1"].value, "Nirmaan Remarks")

    # -- values + formulas -------------------------------------------------
    def test_the_cost_cells_hold_the_stored_numbers_verbatim(self):
        ws = self.wb["Elec "]
        self.assertEqual(ws["G2"].value, _SUPPLY)
        self.assertEqual(ws["H2"].value, _INSTALL)
        self.assertEqual(ws["G3"].value, _SUPPLY)

    def test_the_total_is_a_formula_and_not_a_number(self):
        """The whole design: no server code computes a BCS number."""
        cell = self.wb["Elec "]["I2"]
        self.assertEqual(cell.data_type, "f")
        self.assertEqual(cell.value, '=IF(COUNT(C2)=0,"",(G2+H2)*(C2))')

    def test_a_declared_formula_is_translated_rather_than_replaced_by_the_builtin(self):
        """HVAC declares `(bcs_supply + bcs_install) * qty_total`, so its Total must read that
        shape -- and take the ANY-operand-missing guard, not the built-in's NOTHING-numeric
        one."""
        self.assertEqual(self.wb["HVAC "]["I2"].value, '=IF(COUNT(C2)<1,"",((G2+H2)*C2))')

    def test_an_uncosted_row_gets_no_cost_and_no_total(self):
        """Row 4 has no `BoQ Row BCS Rate` record, so the screen shows a blank. `(blank+blank)
        x qty` would be a confident 0 -- a claim that the row costs nothing."""
        ws = self.wb["Elec "]
        for addr in ("G4", "H4", "I4"):
            self.assertIsNone(ws[addr].value, addr)

    def test_a_costed_row_with_no_quantity_blanks_through_the_guard(self):
        """Row 5 IS costed but C5 is empty. Excel reads an empty cell as 0, so without the
        guard the Total would render 0 where the screen renders blank + `no quantity`."""
        ws = self.wb["Elec "]
        self.assertEqual(ws["G5"].value, _SUPPLY, "the cost itself is still written")
        self.assertEqual(ws["I5"].value, '=IF(COUNT(C5)=0,"",(G5+H5)*(C5))')

    # -- skips, reported not silent ---------------------------------------
    def test_a_grid_only_sheet_gets_no_block_and_says_why(self):
        self.assertNotIn("Specs ", self.result["cost_blocks"])
        self.assertIn("general-specs", self.result["cost_skipped"]["Specs "])

    def test_a_bcs_disabled_sheet_is_exported_plain_and_says_why(self):
        """Owner ruling: a sheet with cost tracking off is still exportable, just without the
        block -- you often want the whole book with cost on the sheets that have it."""
        frappe.db.set_value("BoQ Sheet",
                            {"boq": self.boq, "sheet_name": "HVAC ", "is_current": 1},
                            "bcs_enabled", 0, update_modified=False)
        frappe.db.commit()
        try:
            out = _generate_internal_workbook(self.boq, ["HVAC "], self._synthetic_workbook(),
                                              "x")
            self.assertNotIn("HVAC ", out["cost_blocks"])
            self.assertIn("switched off", out["cost_skipped"]["HVAC "])
            self.assertEqual(out["exported_sheets"], ["HVAC "])
        finally:
            frappe.db.set_value("BoQ Sheet",
                                {"boq": self.boq, "sheet_name": "HVAC ", "is_current": 1},
                                "bcs_enabled", 1, update_modified=False)
            frappe.db.commit()

    # -- the client export is untouched -----------------------------------
    def test_the_client_export_still_carries_no_cost_from_the_same_fixture(self):
        """★ THE PAIRING. The standing guard in test_export_writeback says the client file has
        no BCS in it; on its own that could pass because there was nothing to find. Here the
        SAME BoQ produces both files, and only one of them carries the cost."""
        client = load_workbook(
            io.BytesIO(base64.b64decode(self.client_result["content_base64"])), data_only=False
        )
        for sentinel in (_SUPPLY, _INSTALL):
            rendered = repr(sentinel)
            hits = [str(c.value) for ws in client.worksheets for row in ws.iter_rows()
                    for c in row if c.value is not None and rendered in str(c.value)]
            self.assertEqual(hits, [], f"{sentinel} leaked into the CLIENT workbook")

    def test_the_internal_export_really_does_carry_it(self):
        """The anti-vacuity half of the pairing."""
        hits = [str(c.value) for ws in self.wb.worksheets for row in ws.iter_rows()
                for c in row if c.value is not None and repr(_SUPPLY) in str(c.value)]
        self.assertTrue(hits, "the internal workbook must carry the cost")

    def test_the_client_export_has_no_extra_columns(self):
        """G/H/I exist only in the internal file. The client's remark column still lands at G,
        which is where it landed before this module existed."""
        client = load_workbook(
            io.BytesIO(base64.b64decode(self.client_result["content_base64"])), data_only=False
        )
        self.assertEqual(self.client_result["remark_columns"]["Elec "], "G")
        self.assertIsNone(client["Elec "]["H1"].value)

    def test_this_export_writes_nothing_to_the_database(self):
        """Owner ruling: `last_exported_at` means 'when the CLIENT last got this sheet'. An
        internal download stamping it would make the changed-since-export chip claim the client
        holds something they have never been sent. The payload does not even carry the key."""
        self.assertNotIn("last_exported_at", self.result)
        self.assertIsNone(self.stamp_after_internal)

    def test_the_fidelity_delta_is_really_exercised(self):
        """★ THE GUARD IS ONLY WORTH SOMETHING IF THIS EXPORT ADDS FORMULAS, and it does: the
        source carries 9 (three amount formulas on each of three sheets) and the product
        carries 15, the six Totals on the two costed sheets. Without this, `before + 0` would
        be the plain equality guard and the delta path would be untested -- a guard that looks
        adjusted and is not. Miscounting fails LOUDLY: dropping the count aborts the export
        with `formulas: 9 -> 15` and produces no file, which is the reject-mutates-nothing
        behaviour the client export already has."""
        produced = [c for ws in self.wb.worksheets for row in ws.iter_rows()
                    for c in row if c.data_type == "f"]
        self.assertEqual(len(produced), 15)
        ours = [c for c in produced if str(c.value).startswith("=IF(COUNT(")]
        self.assertEqual(len(ours), 6, "three costed rows on each of the two costed sheets")

    def test_the_filename_says_the_file_is_internal(self):
        self.assertIn("priced_bcs_internal", self.result["filename"])
        self.assertTrue(self.result["filename"].endswith(".xlsx"))

    def test_the_clients_own_formulas_survive_the_round_trip(self):
        """The fidelity guard's real job. F still holds the client's amount formula, and the
        rate stamped into D is there beside it."""
        ws = self.wb["Elec "]
        self.assertEqual(ws["F2"].value, "=C2*(D2+E2)")
        self.assertEqual(ws["D2"].value, 25)


# ===========================================================================
# Group 4: the refusals, and the construction that keeps the wall standing
# ===========================================================================
class TestRefusalsAndConstruction(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project.name
        boq.boq_name = "Template Origin BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.origin = "template"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BOQs", {"name": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_a_template_origin_boq_is_refused_by_name(self):
        """A template BoQ has no source workbook -- its priced export is BUILT FROM SCRATCH by
        a different generator. v1 says so out loud rather than failing obscurely on a missing
        source_file_url."""
        with self.assertRaises(frappe.ValidationError) as ctx:
            export_priced_workbook_with_bcs(boq_name=self.boq,
                                            sheet_names=json.dumps(["Any Sheet"]))
        self.assertIn("master template", str(ctx.exception))

    def test_the_gate_runs_before_anything_is_looked_up(self):
        """A user outside admin + estimation is refused, and refused FIRST -- the BoQ is never
        even resolved, so the refusal cannot leak whether it exists."""
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                export_priced_workbook_with_bcs(boq_name="does-not-exist",
                                                sheet_names=json.dumps(["x"]))
        finally:
            frappe.set_user("Administrator")

    def test_the_client_export_module_is_untouched_and_still_names_no_cost(self):
        """★ THE SEPARATION, asserted from this side too. `test_export_writeback` greps its own
        module; this pins the same property from the module that DOES name BCS, so the pair
        cannot both be deleted by someone merging the two exports."""
        import inspect

        from nirmaan_stack.api.boq.wizard import export_bcs_writeback, export_writeback

        client_src = inspect.getsource(export_writeback).lower()
        for token in ("boq row bcs rate", "supply_rate", "install_rate", "combined_rate", "bcs"):
            self.assertNotIn(token, client_src,
                             f"the CLIENT export must never name {token!r}")
        ours = inspect.getsource(export_bcs_writeback).lower()
        self.assertIn("boq row bcs rate", ours,
                      "and this module must -- or the guard above is vacuous")

    def test_this_module_never_stamps_the_client_export_marker(self):
        """`last_exported_at` is the client's staleness signal. Grepping for the assignment is
        cheap insurance against it being reintroduced by a copy-paste from the client path."""
        import inspect

        from nirmaan_stack.api.boq.wizard import export_bcs_writeback

        src = inspect.getsource(export_bcs_writeback)
        self.assertNotIn('"last_exported_at"', src)
        self.assertNotIn("frappe.db.commit()", src,
                         "this export writes nothing, so it needs no commit")


# ===========================================================================
# Group 5: placement against real content, the combined-rate shape, and every
#          skip branch
# ===========================================================================
_COMBINED_ROLE_MAP = {
    "A": {"role": "description", "area": None},
    "C": {"role": "qty_total", "area": None},
    "D": {"role": "rate_combined", "area": None},
    "F": {"role": "amount_total", "area": None},
}
_NO_RATE_ROLE_MAP = {
    "A": {"role": "description", "area": None},
    "C": {"role": "qty_total", "area": None},
    "F": {"role": "amount_total", "area": None},
}
_NO_QTY_ROLE_MAP = {
    "A": {"role": "description", "area": None},
    "D": {"role": "rate_supply", "area": None},
    "E": {"role": "rate_install", "area": None},
    "F": {"role": "amount_total", "area": None},
}
# ⚠️ A ROLE MAP IN WHICH NO KEY IS AN EXCEL LETTER. `_build_column_descriptors` accepts ANY key
# (it never parses one), while `_rightmost_mapped_col_index` skips what it cannot parse -- so
# this is the ONE shape that reaches the "no mapped columns" branch with rate columns present.
#
# ⚠️ EVERY key has to be unparseable, and the first draft of this fixture got that wrong: it
# also mapped a description on "A", which parses, so the edge resolved to 1, the block started
# at B, and the branch never fired. The test caught it. A single valid column anywhere in the
# map is enough to define an edge.
_BAD_LETTER_ROLE_MAP = {
    "??": {"role": "rate_supply", "area": None},
}


class TestPlacementCombinedRateAndEverySkip(FrappeTestCase):
    """The branches Group 2 does not reach: the block landing beside PRE-EXISTING content, the
    single-box combined-rate sheet, and each of the four remaining skip reasons.

    Every skip carries a REASON to the results modal, and each is asserted by its own case --
    a shared "some reason was returned" assertion would let two branches swap without a test
    noticing, and the reason is the whole difference between "this sheet costs nothing" and
    "this sheet was never costed"."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._tmps = []
        cls.project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project.name
        boq.boq_name = "Placement And Skips BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.source_file_url = "/files/synthetic.xlsx"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        now = frappe.utils.now()
        grid = [{"row_number": r, "cells": json.dumps({})} for r in range(1, 7)]

        for sheet, role_map, costed in (
            ("Stray ", _ROLE_MAP, True),          # a workbook column already holds a note
            ("Combined ", _COMBINED_ROLE_MAP, True),
            ("NoRate ", _NO_RATE_ROLE_MAP, True),
            ("NoCosts ", _ROLE_MAP, False),
            ("NoQty ", _NO_QTY_ROLE_MAP, True),
            ("BadLetter ", _BAD_LETTER_ROLE_MAP, True),
        ):
            _seed_committed_sheet(cls.boq, sheet, "data", 1, role_map, [], 1, sheet.strip(),
                                  now, grid, [], None)
            frappe.db.set_value("BoQ Sheet",
                                {"boq": cls.boq, "sheet_name": sheet, "is_current": 1},
                                "bcs_enabled", 1, update_modified=False)
            if not costed:
                continue
            for excel_row in (2, 3):
                doc = frappe.new_doc("BoQ Row BCS Rate")
                doc.boq = cls.boq
                doc.sheet_name = sheet
                doc.excel_row = excel_row
                doc.committed_version = 1
                doc.supply_rate = _SUPPLY
                doc.install_rate = _INSTALL
                doc.combined_rate = _SUPPLY + _INSTALL
                doc.is_filled = 1
                doc.bcs_version = 1
                doc.is_current = 1
                doc.bcs_rated_at = now
                doc.insert(ignore_permissions=True)
        frappe.db.commit()

        cls.sheets = ["Stray ", "Combined ", "NoRate ", "NoCosts ", "NoQty ", "BadLetter "]
        cls.result = _generate_internal_workbook(
            cls.boq, cls.sheets, cls._workbook(), "Placement And Skips BoQ"
        )
        cls.wb = load_workbook(
            io.BytesIO(base64.b64decode(cls.result["content_base64"])), data_only=False
        )

    @classmethod
    def _workbook(cls):
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        for title in ("Stray ", "Combined ", "NoRate ", "NoCosts ", "NoQty ", "BadLetter "):
            ws = wb.create_sheet(title=title)
            for r in (2, 3):
                ws[f"A{r}"] = f"item {r}"
                ws[f"C{r}"] = 10 * r
        # ONE sheet already carries a note in the first column past the mapped edge.
        wb["Stray "]["G2"] = "estimator note -- must survive"
        fd, path = tempfile.mkstemp(suffix=".xlsx")
        os.close(fd)
        wb.save(path)
        cls._tmps.append(path)
        return path

    @classmethod
    def tearDownClass(cls):
        for path in cls._tmps:
            try:
                os.unlink(path)
            except OSError:
                pass
        for dt in ("BoQ Row BCS Rate", "BoQ Cell Amount Formula", "BoQ Cell Pricing",
                   "BoQ Committed Sheet Grid", "BoQ Sheet"):
            frappe.db.delete(dt, {"boq": cls.boq})
        frappe.db.delete("BOQs", {"name": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    # -- placement against real content -----------------------------------
    def test_the_block_steps_past_a_pre_existing_column_and_never_overwrites_it(self):
        """★ The mapped edge is F, so the block WOULD start at G -- but G already holds an
        estimator note. It must step to H, and the note must still be there afterwards."""
        ws = self.wb["Stray "]
        self.assertEqual(ws["G2"].value, "estimator note -- must survive")
        self.assertEqual(self.result["cost_blocks"]["Stray "]["cost_columns"],
                         {"supply": "H", "install": "I"})
        self.assertEqual(self.result["cost_blocks"]["Stray "]["total_column"], "J")
        self.assertEqual(ws["H1"].value, "BCS Cost (Supply)")

    def test_the_total_formula_follows_the_shifted_columns(self):
        """The shift has to reach the FORMULA too, or the Total would read the note's column."""
        self.assertEqual(self.wb["Stray "]["J2"].value, '=IF(COUNT(C2)=0,"",(H2+I2)*(C2))')

    # -- the combined-rate shape ------------------------------------------
    def test_a_combined_rate_sheet_gets_ONE_undifferentiated_box(self):
        """`live_rate_kinds` returns ["combined"] for a sheet that quotes one figure, so the
        block is two columns, not three, and the box is headed `BCS Cost` with no qualifier."""
        block = self.result["cost_blocks"]["Combined "]
        self.assertEqual(block["cost_columns"], {"combined": "G"})
        self.assertEqual(block["total_column"], "H")
        self.assertEqual(self.wb["Combined "]["G1"].value, "BCS Cost")

    def test_the_combined_total_multiplies_the_ONE_box(self):
        """⚠️ And it must never also add the halves. `bcs.py` forbids summing combined_rate
        with them -- the fixture stores all three, so a formula naming more than G would be
        double-counting numbers that are genuinely present in the row."""
        self.assertEqual(self.wb["Combined "]["H2"].value, '=IF(COUNT(C2)=0,"",(G2)*(C2))')
        self.assertEqual(self.wb["Combined "]["G2"].value, _SUPPLY + _INSTALL)

    # -- every remaining skip branch, each by its own reason ---------------
    def test_a_sheet_with_no_rate_column_is_skipped_by_name(self):
        self.assertNotIn("NoRate ", self.result["cost_blocks"])
        self.assertIn("maps no rate column", self.result["cost_skipped"]["NoRate "])

    def test_a_sheet_nobody_has_costed_is_skipped_by_name(self):
        """Distinct from 'no rate column': this sheet COULD be costed and simply has not
        been. Collapsing the two would tell a pricer to fix the wrong thing."""
        self.assertNotIn("NoCosts ", self.result["cost_blocks"])
        self.assertIn("no costs have been entered", self.result["cost_skipped"]["NoCosts "])

    def test_a_sheet_whose_quantity_cannot_be_resolved_still_gets_its_COST_columns(self):
        """★ A PARTIAL BLOCK, DELIBERATELY. The costs are facts we hold and can write; only
        the Total needs a quantity. Withholding the cost columns too would discard information
        that is perfectly good, and the reason says exactly what is missing."""
        block = self.result["cost_blocks"]["NoQty "]
        self.assertEqual(block["cost_columns"], {"supply": "G", "install": "H"})
        self.assertIsNone(block["total_column"], "no quantity, so no Total")
        self.assertIn("quantity columns could not be resolved",
                      self.result["cost_skipped"]["NoQty "])
        self.assertEqual(self.wb["NoQty "]["G2"].value, _SUPPLY)

    def test_an_unparseable_column_key_reaches_the_undefined_data_edge_branch(self):
        """The ONE shape that gets here: `_build_column_descriptors` accepts any role-map key
        and never parses it, while `_rightmost_mapped_col_index` skips what it cannot parse.
        So rate columns exist while the data edge does not, and the block has nowhere to
        start. Pinned rather than assumed -- the branch reads as dead code otherwise.

        ⚠️ IT NEEDS EVERY KEY TO BE UNPARSEABLE. One valid column anywhere in the map defines
        an edge and the block places normally -- which is what the first version of this
        fixture did, mapping a description on "A" beside the bad key and never reaching the
        branch at all."""
        self.assertNotIn("BadLetter ", self.result["cost_blocks"])
        self.assertIn("no mapped columns", self.result["cost_skipped"]["BadLetter "])

    def test_every_sheet_is_still_reported_as_exported(self):
        """A skipped BLOCK is not a skipped SHEET -- each of these still went through the
        client-facing passes and still belongs in the file."""
        self.assertEqual(sorted(self.result["exported_sheets"]), sorted(self.sheets))

    def test_every_skip_reason_in_the_module_is_covered_by_one_of_these_cases(self):
        """★ ANTI-DRIFT. A branch added later with a new reason must come with a case, or this
        goes red -- otherwise a silent skip reappears exactly where the whole point is that a
        missing cost block must never be silent. `general-specs` and `switched off` are pinned
        in Group 2, so the union of both groups is what is compared."""
        import inspect
        import re

        from nirmaan_stack.api.boq.wizard import export_bcs_writeback

        src = inspect.getsource(export_bcs_writeback)
        reasons = set(re.findall(r'"reason": "([^"]+)', src))
        reasons |= set(re.findall(r'"reason": None if bodies else "([^"]+)', src))
        covered = set(self.result["cost_skipped"].values()) | {
            "this is a general-specs sheet, which carries no priced rows",
            "cost tracking is switched off for this sheet",
        }
        for reason in reasons:
            with self.subTest(reason=reason):
                self.assertTrue(any(c.startswith(reason[:40]) for c in covered),
                                f"no test exercises the skip reason {reason!r}")
