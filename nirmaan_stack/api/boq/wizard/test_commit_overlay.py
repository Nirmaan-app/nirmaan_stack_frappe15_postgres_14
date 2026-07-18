"""S6/S8 (#1104, ADR-0014 D8) -- the commit-time overlay carry, integration.

Exercises `commit_overlay.carry_commit_overlay`: at a revision sheet's commit it stamps the D2
provenance triple and silently carries the re-arm-EXEMPT layers (amount formula, remark, color,
`remark` dismissal, category) onto the fresh committed version, while NEVER carrying the re-armed
set (the 4 computed dismissals + reconciliation choice). Formulas re-validate against the DEST
amount descriptors (role-axis) with `target_col` re-resolved; a role SWAP is correct for free; a
vanished column drops silently; category carries the whole layer (machine + human) with the field
split intact, per-discipline; NEW rows land blank.

The excel-row twin map is re-derived at commit from both sides' committed `BOQ Nodes` -- the
fixture shifts every revised row by +10 (an inserted block) so a naive same-row-number carry would
land on the WRONG row; the twin map must follow the description.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import commit_overlay, pricing
from nirmaan_stack.api.boq.wizard.test_revision_entry import (
    _cleanup_project,
    _make_boq,
    _make_project,
)
from nirmaan_stack.api.boq.wizard.test_revision_mapping import _make_revision

# A per-area amount role -> descriptor (value_field=amount_by_area, value_key=area,
# rate_subkey="total"). Two engines' role maps let us exercise the role SWAP + a dropped column.
_AREA_AMOUNT_ROLE = "amount_total_by_area"


def _role_map(area_by_col: dict) -> str:
    return json.dumps({col: {"role": _AREA_AMOUNT_ROLE, "area": area} for col, area in area_by_col.items()})


def _commit_sheet(boq, sheet_name, role_map_json, commit_version=1):
    bs = frappe.new_doc("BoQ Sheet")
    bs.boq = boq
    bs.sheet_name = sheet_name
    bs.sheet_order = 1
    bs.treat_as = "data"
    bs.is_current = 1
    bs.commit_version = commit_version
    bs.column_role_map = role_map_json
    bs.column_headers = json.dumps({})
    bs.area_dimensions = json.dumps([])
    bs.committed_at = frappe.utils.now()
    bs.insert(ignore_permissions=True)
    return bs.name


def _node(boq, sheet_docname, node_type, description, source_row_number, sort_order, level=None):
    n = frappe.new_doc("BOQ Nodes")
    n.sheet = sheet_docname
    n.boq = boq
    n.node_type = node_type
    n.row_class = "preamble" if node_type == "Preamble" else (
        "line_item" if node_type == "Line Item" else "note")
    n.description = description
    n.source_row_number = source_row_number
    n.sort_order = sort_order
    if level is not None:
        n.level = level
    if node_type == "Line Item":
        n.qty = 0
    n.commit_version = 1
    n.is_current = 1
    n.committed_at = frappe.utils.now()
    n.insert(ignore_permissions=True)
    return n.name


def _mk_formula(boq, sheet_name, cv, tvk, col):
    """A per-area amount formula. tvk = the concrete area (per-area OVERRIDE) or None (the
    area-WILDCARD default -- the shape of ALL 32 live prod formulas)."""
    d = frappe.new_doc("BoQ Cell Amount Formula")
    d.boq = boq
    d.sheet_name = sheet_name
    d.committed_version = cv
    d.target_value_field = "amount_by_area"
    d.target_value_key = tvk                 # concrete area = OVERRIDE; None = area WILDCARD default
    d.target_rate_subkey = "total"
    d.target_col = col
    d.formula = json.dumps({"ref": {"value_field": "qty_by_area", "value_key": tvk}})
    d.formula_version = 1
    d.is_current = 1
    d.defined_at = frappe.utils.now()
    d.is_finalized = 0
    d.insert(ignore_permissions=True)


def _mk_remark(boq, sheet_name, cv, row, text):
    d = frappe.new_doc("BoQ Cell Remark")
    d.boq = boq
    d.sheet_name = sheet_name
    d.excel_row = row
    d.committed_version = cv
    d.remark = text
    d.remark_version = 1
    d.is_current = 1
    d.remarked_at = frappe.utils.now()
    d.insert(ignore_permissions=True)


def _mk_color(boq, sheet_name, cv, row, col, color):
    d = frappe.new_doc("BoQ Cell Color")
    d.boq = boq
    d.sheet_name = sheet_name
    d.excel_row = row
    d.col_letter = col
    d.committed_version = cv
    d.color = color
    d.color_version = 1
    d.is_current = 1
    d.colored_at = frappe.utils.now()
    d.insert(ignore_permissions=True)


def _mk_dismissal(boq, sheet_name, cv, row, kind):
    d = frappe.new_doc("BoQ Cell Dismissal")
    d.boq = boq
    d.sheet_name = sheet_name
    d.excel_row = row
    d.flag_kind = kind
    d.committed_version = cv
    d.dismissal_version = 1
    d.is_current = 1
    d.dismissed_at = frappe.utils.now()
    d.is_finalized = 0
    d.insert(ignore_permissions=True)


def _mk_choice(boq, sheet_name, cv, row, col, choice):
    d = frappe.new_doc("BoQ Cell Reconciliation Choice")
    d.boq = boq
    d.sheet_name = sheet_name
    d.excel_row = row
    d.col_letter = col
    d.committed_version = cv
    d.choice = choice
    d.choice_version = 1
    d.is_current = 1
    d.chosen_at = frappe.utils.now()
    d.is_finalized = 0
    d.insert(ignore_permissions=True)


def _mk_category(boq, sheet_name, cv, row, discipline, final="", human=""):
    d = frappe.new_doc("BoQ Row Category")
    d.boq = boq
    d.sheet_name = sheet_name
    d.excel_row = row
    d.committed_version = cv
    d.discipline = discipline
    d.final_category_id = final
    d.human_category_id = human
    d.category_version = 1
    d.is_current = 1
    d.classified_at = frappe.utils.now()
    d.insert(ignore_permissions=True)


def _seed_revision_draft(rev_name, sheet_name, source_sheet_name):
    rev_doc = frappe.get_doc("BOQs", rev_name)
    rev_doc.append("sheet_drafts", {
        "sheet_name": sheet_name,
        "sheet_order": 1,
        "wizard_status": "Pending",
        "source_sheet_name": source_sheet_name,
    })
    rev_doc.save(ignore_permissions=True)


def _wipe_boqs(project_name):
    for boq in frappe.get_all("BOQs", filters={"project": project_name}, fields=["name"]):
        for dt in ("BoQ Cell Amount Formula", "BoQ Cell Remark", "BoQ Cell Color",
                   "BoQ Cell Dismissal", "BoQ Cell Reconciliation Choice", "BoQ Row Category",
                   "BOQ Nodes", "BoQ Sheet", "BoQ Review Row"):
            frappe.db.delete(dt, {"boq": boq.name})
    frappe.db.commit()


class TestCommitOverlayCarry(FrappeTestCase):
    """The rich end-to-end fixture: every carried + never-carried branch in ONE overlay run."""

    SRC = "Data"
    DEST = "Data Rev"            # a RENAME -- source read uses SRC, dest write uses DEST

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="OVERLAY ORIG")

        # SOURCE committed sheet v1: three per-area amount columns (D=Civil, E=MEP, F=Facade).
        cls.src_sheet = _commit_sheet(
            cls.original.name, cls.SRC, _role_map({"D": "Civil", "E": "MEP", "F": "Facade"}))
        # SOURCE nodes: a section + three items (rows 1-4).
        _node(cls.original.name, cls.src_sheet, "Preamble", "Section", 1, 0, level=1)
        _node(cls.original.name, cls.src_sheet, "Line Item", "Item Alpha", 2, 1)
        _node(cls.original.name, cls.src_sheet, "Line Item", "Item Beta", 3, 2)
        _node(cls.original.name, cls.src_sheet, "Line Item", "Item Gamma", 4, 3)  # REMOVED in rev

        # SOURCE annotations on v1.
        _mk_formula(cls.original.name, cls.SRC, 1, "Civil", "D")
        _mk_formula(cls.original.name, cls.SRC, 1, "MEP", "E")
        _mk_formula(cls.original.name, cls.SRC, 1, "Facade", "F")   # column vanishes -> dropped
        _mk_remark(cls.original.name, cls.SRC, 1, 2, "keep alpha")
        _mk_remark(cls.original.name, cls.SRC, 1, 4, "gamma gone")  # REMOVED row -> dropped
        _mk_color(cls.original.name, cls.SRC, 1, 2, "D", "green")    # letter survives
        _mk_color(cls.original.name, cls.SRC, 1, 2, "F", "red")      # letter vanishes -> dropped
        _mk_dismissal(cls.original.name, cls.SRC, 1, 2, "remark")        # carries
        _mk_dismissal(cls.original.name, cls.SRC, 1, 3, "needs_rate")    # COMPUTED -> never carries
        _mk_choice(cls.original.name, cls.SRC, 1, 3, "D", "keep_document")  # never carries
        # Category: Alpha classified by TWO engines; Electrical carries a distinct human verdict.
        _mk_category(cls.original.name, cls.SRC, 1, 2, "Electrical", final="elec_machine", human="elec_human")
        _mk_category(cls.original.name, cls.SRC, 1, 2, "HVAC", final="hvac_machine")

        # DEST (revision) -- role SWAP (D=MEP, E=Civil) + Facade DROPPED.
        cls.rev = _make_revision(cls.project.name, cls.original.name).name
        _seed_revision_draft(cls.rev, cls.DEST, cls.SRC)
        cls.dest_sheet = _commit_sheet(cls.rev, cls.DEST, _role_map({"D": "MEP", "E": "Civil"}))
        # DEST nodes: every row shifted +10 (an inserted block above) + a genuinely NEW item.
        _node(cls.rev, cls.dest_sheet, "Preamble", "Section", 11, 0, level=1)
        _node(cls.rev, cls.dest_sheet, "Line Item", "Item Alpha", 12, 1)
        _node(cls.rev, cls.dest_sheet, "Line Item", "Item Beta", 13, 2)
        _node(cls.rev, cls.dest_sheet, "Line Item", "Brand New Item", 99, 3)  # NEW -> blank
        frappe.db.commit()

        # Grid rows for the color survivor check: A/D/E present, F absent (Facade vanished).
        grid_rows = [
            {"row_number": 11, "cells": {"A": "Section"}},
            {"row_number": 12, "cells": {"A": "Item Alpha", "D": 1, "E": 2}},
            {"row_number": 13, "cells": {"A": "Item Beta", "D": 3, "E": 4}},
            {"row_number": 99, "cells": {"A": "Brand New Item", "D": 5, "E": 6}},
        ]
        # ONE overlay run (carried records are fresh v1 inserts -- re-running would duplicate).
        cls.summary = commit_overlay.carry_commit_overlay(
            cls.rev, cls.DEST, 1, cls.dest_sheet, grid_rows)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        _wipe_boqs(cls.project.name)
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    # ---- helpers reading the DEST side ----
    def _dest(self, doctype, **extra):
        filters = {"boq": self.rev, "sheet_name": self.DEST, "committed_version": 1,
                   "is_current": 1, **extra}
        return frappe.get_all(doctype, filters=filters, fields=["*"])

    # ---- provenance ----
    def test_provenance_triple_stamped(self):
        prov = frappe.db.get_value(
            "BoQ Sheet", self.dest_sheet,
            ["source_boq", "source_commit_version", "source_sheet_name"], as_dict=True)
        self.assertEqual(prov.source_boq, self.original.name)
        self.assertEqual(prov.source_commit_version, 1)
        self.assertEqual(prov.source_sheet_name, self.SRC)

    # ---- formula: role swap re-resolves target_col; vanished column drops ----
    def test_formulas_role_swapped_and_dropped(self):
        by_area = {f["target_value_key"]: f for f in self._dest("BoQ Cell Amount Formula")}
        self.assertEqual(set(by_area), {"Civil", "MEP"})       # Facade dropped (no dest column)
        self.assertEqual(by_area["Civil"]["target_col"], "E")  # re-resolved to the swapped letter
        self.assertEqual(by_area["MEP"]["target_col"], "D")

    def test_formula_carry_makes_sheet_formula_complete(self):
        # Both dest amount columns (Civil@E, MEP@D) are now covered -> the gate opens.
        self.assertTrue(pricing._sheet_formulas_complete(self.rev, self.DEST, 1))

    def test_carried_formula_body_preserved(self):
        civil = {f["target_value_key"]: f for f in self._dest("BoQ Cell Amount Formula")}["Civil"]
        self.assertEqual(json.loads(civil["formula"]),
                         {"ref": {"value_field": "qty_by_area", "value_key": "Civil"}})
        self.assertEqual(civil["is_current"], 1)
        self.assertEqual(civil["is_finalized"], 0)

    # ---- remark: twin-mapped to the shifted dest row; removed row drops ----
    def test_remark_carried_to_twin_row(self):
        remarks = {r["excel_row"]: r["remark"] for r in self._dest("BoQ Cell Remark")}
        self.assertEqual(remarks, {12: "keep alpha"})   # row 2 -> dest 12; Gamma (removed) absent

    # ---- color: survivor letter carries; vanished letter drops ----
    def test_color_survivor_carried_vanished_dropped(self):
        colors = {(c["excel_row"], c["col_letter"]): c["color"] for c in self._dest("BoQ Cell Color")}
        self.assertEqual(colors, {(12, "D"): "green"})   # (2,D)->(12,D); (2,F) dropped

    # ---- dismissal: only `remark` carries; the computed kind never does ----
    def test_only_remark_dismissal_carried(self):
        dis = self._dest("BoQ Cell Dismissal")
        self.assertEqual(len(dis), 1)
        self.assertEqual(dis[0]["flag_kind"], "remark")
        self.assertEqual(dis[0]["excel_row"], 12)

    def test_computed_dismissal_never_carried(self):
        needs = frappe.get_all("BoQ Cell Dismissal", filters={
            "boq": self.rev, "committed_version": 1, "flag_kind": "needs_rate"})
        self.assertEqual(needs, [])

    # ---- reconciliation choice: never carried ----
    def test_reconciliation_choice_never_carried(self):
        self.assertEqual(self._dest("BoQ Cell Reconciliation Choice"), [])

    # ---- category: whole layer, per-discipline, field split intact, NEW row blank ----
    def test_category_field_split_and_fanout(self):
        cats = {(c["excel_row"], c["discipline"]): c for c in self._dest("BoQ Row Category")}
        self.assertEqual(set(cats), {(12, "Electrical"), (12, "HVAC")})   # fan-out, twin-mapped
        elec = cats[(12, "Electrical")]
        self.assertEqual(elec["final_category_id"], "elec_machine")       # machine -> machine
        self.assertEqual(elec["human_category_id"], "elec_human")         # human -> human
        # The freeze-bug guard: a machine label NEVER lands in human_category_id.
        self.assertNotEqual(elec["human_category_id"], "elec_machine")
        hvac = cats[(12, "HVAC")]
        self.assertEqual(hvac["final_category_id"], "hvac_machine")
        self.assertIn(hvac["human_category_id"], (None, ""))              # no human verdict on HVAC

    def test_new_row_lands_blank(self):
        # The genuinely NEW dest row (99) has NO category record -> CL-6 amber, no auto-classify.
        new_cats = frappe.get_all("BoQ Row Category", filters={
            "boq": self.rev, "sheet_name": self.DEST, "committed_version": 1, "excel_row": 99})
        self.assertEqual(new_cats, [])

    # ---- summary ----
    def test_summary_counts(self):
        self.assertEqual(self.summary["provenance"], 1)
        self.assertEqual(self.summary["formulas"], 2)
        self.assertEqual(self.summary["remarks"], 1)
        self.assertEqual(self.summary["colors"], 1)
        self.assertEqual(self.summary["remark_dismissals"], 1)
        self.assertEqual(self.summary["categories"], 2)


class TestCommitOverlayFailClosed(FrappeTestCase):
    """An uncovered DEST amount column after carry keeps the formula gate CLOSED (fail-closed)."""

    SRC = "S"
    DEST = "S"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="FAILCLOSED ORIG")
        cls.src_sheet = _commit_sheet(cls.original.name, cls.SRC, _role_map({"D": "Civil"}))
        _node(cls.original.name, cls.src_sheet, "Line Item", "Only Item", 2, 0)
        _mk_formula(cls.original.name, cls.SRC, 1, "Civil", "D")

        cls.rev = _make_revision(cls.project.name, cls.original.name).name
        _seed_revision_draft(cls.rev, cls.DEST, cls.SRC)
        # DEST adds a SECOND amount column (E=MEP) the source never covered.
        cls.dest_sheet = _commit_sheet(cls.rev, cls.DEST, _role_map({"D": "Civil", "E": "MEP"}))
        _node(cls.rev, cls.dest_sheet, "Line Item", "Only Item", 2, 0)
        frappe.db.commit()

        commit_overlay.carry_commit_overlay(
            cls.rev, cls.DEST, 1, cls.dest_sheet,
            [{"row_number": 2, "cells": {"D": 1, "E": 2}}])
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        _wipe_boqs(cls.project.name)
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_civil_carried(self):
        f = frappe.get_all("BoQ Cell Amount Formula", filters={
            "boq": self.rev, "committed_version": 1, "is_current": 1}, fields=["target_value_key"])
        self.assertEqual([r["target_value_key"] for r in f], ["Civil"])

    def test_uncovered_column_keeps_gate_closed(self):
        # MEP@E has no carried formula -> the sheet is NOT formula-complete -> rates stay locked.
        self.assertFalse(pricing._sheet_formulas_complete(self.rev, self.DEST, 1))


class TestCommitOverlayWildcardFormula(FrappeTestCase):
    """The COMMON prod shape: a single area-WILDCARD formula (target_value_key None) covering
    every area. It carries once, re-resolving target_col to the first dest amount column, and
    makes the (multi-area) dest sheet formula-complete."""

    SHEET = "W"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="WILDCARD ORIG")
        # Source: two areas, ONE wildcard formula (declared with target_col E, the MEP column).
        cls.src_sheet = _commit_sheet(cls.original.name, cls.SHEET,
                                      _role_map({"D": "Civil", "E": "MEP"}))
        _node(cls.original.name, cls.src_sheet, "Line Item", "Item", 2, 0)
        _mk_formula(cls.original.name, cls.SHEET, 1, None, "E")   # WILDCARD (value_key None)

        cls.rev = _make_revision(cls.project.name, cls.original.name).name
        _seed_revision_draft(cls.rev, cls.SHEET, cls.SHEET)
        cls.dest_sheet = _commit_sheet(cls.rev, cls.SHEET, _role_map({"D": "Civil", "E": "MEP"}))
        _node(cls.rev, cls.dest_sheet, "Line Item", "Item", 2, 0)
        frappe.db.commit()

        cls.summary = commit_overlay.carry_commit_overlay(
            cls.rev, cls.SHEET, 1, cls.dest_sheet, [{"row_number": 2, "cells": {"D": 1, "E": 2}}])
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        _wipe_boqs(cls.project.name)
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_wildcard_carried_once_with_null_key(self):
        rows = frappe.get_all("BoQ Cell Amount Formula", filters={
            "boq": self.rev, "committed_version": 1, "is_current": 1},
            fields=["target_value_key", "target_col"])
        self.assertEqual(len(rows), 1)
        self.assertIn(rows[0]["target_value_key"], (None, ""))   # stays a wildcard default
        self.assertEqual(rows[0]["target_col"], "D")             # re-resolved to first amount col

    def test_wildcard_makes_multi_area_sheet_complete(self):
        # One wildcard covers BOTH Civil and MEP amount columns -> the gate opens.
        self.assertTrue(pricing._sheet_formulas_complete(self.rev, self.SHEET, 1))
        self.assertEqual(self.summary["formulas"], 1)


class TestCommitOverlayNonRevision(FrappeTestCase):
    """A non-revision (or unmapped) commit no-ops -> byte-identical: nothing carried, no stamp."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="NONREV ORIG")
        cls.sheet = _commit_sheet(cls.original.name, "Data", _role_map({"D": "Civil"}))
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        _wipe_boqs(cls.project.name)
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_upload_boq_is_a_noop(self):
        summary = commit_overlay.carry_commit_overlay(
            self.original.name, "Data", 1, self.sheet, [{"row_number": 2, "cells": {"D": 1}}])
        self.assertEqual(summary["provenance"], 0)
        self.assertEqual(summary["formulas"], 0)
        # No provenance stamped on a non-revision commit.
        self.assertIsNone(frappe.db.get_value("BoQ Sheet", self.sheet, "source_boq"))

    def test_unmapped_declared_new_sheet_is_a_noop(self):
        rev = _make_revision(self.project.name, self.original.name).name
        _seed_revision_draft(rev, "Fresh", None)   # declared-New: no source_sheet_name
        dest_sheet = _commit_sheet(rev, "Fresh", _role_map({"D": "Civil"}))
        frappe.db.commit()
        summary = commit_overlay.carry_commit_overlay(
            rev, "Fresh", 1, dest_sheet, [{"row_number": 2, "cells": {"D": 1}}])
        self.assertEqual(summary["provenance"], 0)
        self.assertIsNone(frappe.db.get_value("BoQ Sheet", dest_sheet, "source_boq"))


if __name__ == "__main__":
    frappe.init(site="localhost")
    frappe.connect()
    import unittest
    unittest.main()
