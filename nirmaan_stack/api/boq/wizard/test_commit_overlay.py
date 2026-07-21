"""S6/S8 (#1104, ADR-0014 D8) -- the commit-time overlay carry, integration.

Exercises `commit_overlay.carry_commit_overlay`: at a revision sheet's commit it stamps the D2
provenance triple and silently carries the re-arm-EXEMPT layers (amount formula, remark, color,
`remark` dismissal, category) onto the fresh committed version, while NEVER carrying the re-armed
set (the 4 computed dismissals + reconciliation choice). Formulas re-validate against the DEST
amount descriptors (role-axis) with `target_col` re-resolved; a role SWAP is correct for free; a
vanished column drops silently; category carries the whole layer (machine + human) with the field
split intact, per-discipline; NEW rows land blank.

The excel-row twin map is re-derived at commit from both sides' committed `BOQ Nodes`.

⚠️ REBUILT FOR **ADR-0014 Amendment B** (2026-07-20). This fixture previously shifted every revised
row by +10 to prove the twin map followed the DESCRIPTION rather than the row number. Amendment B
inverts that: the key is `same Excel row + same description`, so an unchanged row keeps its
position and a SHIFTED row deliberately does NOT carry. The dest rows therefore sit at the SAME
Excel rows as their source twins, and the shift case is now pinned by
`TestCommitOverlayShiftStopsCarry` as a NON-carry.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import commit_overlay, commit_pipeline, pricing
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


def _commit_sheet(boq, sheet_name, role_map_json, commit_version=1, is_current=1):
    """A committed `BoQ Sheet`. `is_current=0` seeds a SUPERSEDED version (what a re-commit leaves
    behind) -- only `TestCommitOverlayCrossVersionSource` needs that; every other fixture is the
    default single current v1."""
    bs = frappe.new_doc("BoQ Sheet")
    bs.boq = boq
    bs.sheet_name = sheet_name
    bs.sheet_order = 1
    bs.treat_as = "data"
    bs.is_current = is_current
    bs.commit_version = commit_version
    bs.column_role_map = role_map_json
    bs.column_headers = json.dumps({})
    bs.area_dimensions = json.dumps([])
    bs.committed_at = frappe.utils.now()
    bs.insert(ignore_permissions=True)
    return bs.name


def _node(boq, sheet_docname, node_type, description, source_row_number, sort_order, level=None,
          commit_version=1, is_current=1):
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
    n.commit_version = commit_version
    n.is_current = is_current
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
        # DEST nodes: the surviving rows keep their Excel positions (Amendment B's key), Item Gamma
        # (row 4) is gone, and there is a genuinely NEW item appended well below.
        _node(cls.rev, cls.dest_sheet, "Preamble", "Section", 1, 0, level=1)
        _node(cls.rev, cls.dest_sheet, "Line Item", "Item Alpha", 2, 1)
        _node(cls.rev, cls.dest_sheet, "Line Item", "Item Beta", 3, 2)
        _node(cls.rev, cls.dest_sheet, "Line Item", "Brand New Item", 99, 3)  # NEW -> blank
        frappe.db.commit()

        # Grid rows for the color survivor check: A/D/E present, F absent (Facade vanished).
        grid_rows = [
            {"row_number": 1, "cells": {"A": "Section"}},
            {"row_number": 2, "cells": {"A": "Item Alpha", "D": 1, "E": 2}},
            {"row_number": 3, "cells": {"A": "Item Beta", "D": 3, "E": 4}},
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
        self.assertEqual(remarks, {2: "keep alpha"})   # row 2 -> dest 2; Gamma (removed) absent

    # ---- color: survivor letter carries; vanished letter drops ----
    def test_color_survivor_carried_vanished_dropped(self):
        colors = {(c["excel_row"], c["col_letter"]): c["color"] for c in self._dest("BoQ Cell Color")}
        self.assertEqual(colors, {(2, "D"): "green"})   # (2,D)->(2,D); (2,F) dropped

    # ---- dismissal: only `remark` carries; the computed kind never does ----
    def test_only_remark_dismissal_carried(self):
        dis = self._dest("BoQ Cell Dismissal")
        self.assertEqual(len(dis), 1)
        self.assertEqual(dis[0]["flag_kind"], "remark")
        self.assertEqual(dis[0]["excel_row"], 2)

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
        self.assertEqual(set(cats), {(2, "Electrical"), (2, "HVAC")})   # fan-out, twin-mapped
        elec = cats[(2, "Electrical")]
        self.assertEqual(elec["final_category_id"], "elec_machine")       # machine -> machine
        self.assertEqual(elec["human_category_id"], "elec_human")         # human -> human
        # The freeze-bug guard: a machine label NEVER lands in human_category_id.
        self.assertNotEqual(elec["human_category_id"], "elec_machine")
        hvac = cats[(2, "HVAC")]
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


class TestCommitOverlayShiftStopsCarry(FrappeTestCase):
    """⚠️ ADR-0014 Amendment B. A row whose Excel position SHIFTED does not carry its annotations,
    even though its description is byte-identical.

    This is the inverse of what this file used to assert. Under the old description-only key a +10
    shift still paired, which is precisely how annotations (and, at the review tier, parenting)
    could follow a row that the revision had actually moved. The row-level carry and the
    committed-tier annotation carry share ONE matcher, so this property must hold on both.
    """

    SHEET = "Shift"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="SHIFT ORIG")
        cls.src_sheet = _commit_sheet(cls.original.name, cls.SHEET, _role_map({"D": "Civil"}))
        _node(cls.original.name, cls.src_sheet, "Line Item", "Stable Item", 2, 0)
        _node(cls.original.name, cls.src_sheet, "Line Item", "Moved Item", 3, 1)
        _mk_remark(cls.original.name, cls.SHEET, 1, 2, "stays")
        _mk_remark(cls.original.name, cls.SHEET, 1, 3, "should NOT follow the move")

        cls.rev = _make_revision(cls.project.name, cls.original.name).name
        _seed_revision_draft(cls.rev, cls.SHEET, cls.SHEET)
        cls.dest_sheet = _commit_sheet(cls.rev, cls.SHEET, _role_map({"D": "Civil"}))
        # "Stable Item" holds row 2; "Moved Item" has slipped to row 7 (same text, new place).
        _node(cls.rev, cls.dest_sheet, "Line Item", "Stable Item", 2, 0)
        _node(cls.rev, cls.dest_sheet, "Line Item", "Moved Item", 7, 1)
        frappe.db.commit()

        commit_overlay.carry_commit_overlay(
            cls.rev, cls.SHEET, 1, cls.dest_sheet,
            [{"row_number": 2, "cells": {"D": 1}}, {"row_number": 7, "cells": {"D": 2}}])
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        _wipe_boqs(cls.project.name)
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_only_the_unmoved_row_carries_its_remark(self):
        remarks = {
            r["excel_row"]: r["remark"]
            for r in frappe.get_all(
                "BoQ Cell Remark",
                filters={"boq": self.rev, "sheet_name": self.SHEET,
                         "committed_version": 1, "is_current": 1},
                fields=["excel_row", "remark"])
        }
        self.assertEqual(remarks, {2: "stays"})

    def test_the_moved_rows_remark_did_not_follow_it(self):
        self.assertEqual(
            frappe.get_all("BoQ Cell Remark", filters={
                "boq": self.rev, "sheet_name": self.SHEET,
                "committed_version": 1, "excel_row": 7}),
            [],
        )


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


class TestCommitOverlayCrossVersionSource(FrappeTestCase):
    """⚠️ DOCUMENTED ASYMMETRY -- ADR-0014 Amendment B W6, and it is NOT an oversight.

    W6 fixed the CROSS-BOQ RATE carry to read its source cross-version: pricing identity includes
    `committed_version`, so `is_current` is scoped PER VERSION, and re-committing a source sheet
    mints a new version and ORPHANS the prior version's records onto the now-frozen one (the
    BOQ_DOWNSTREAM_ORPHAN guard warns, it never migrates). `pricing.current_sheet_pricing_any_version`
    now takes each cell's newest current row instead.

    The five OVERLAY layers this module carries (formula / remark / color / `remark` dismissal /
    category) have the IDENTICAL exposure -- every source read here is pinned to `ctx.source_version`
    (the source sheet's current `commit_version`) and every one of those doctypes carries
    `committed_version` in its identity exactly like `BoQ Cell Pricing` does -- and they were
    DELIBERATELY LEFT version-pinned. W6 as the owner resolved it (ADR-0014 A10) is about RATES ONLY;
    annotations are a different risk profile (a stale remark or category silently following a
    revision forward is arguably worse than one that does not follow at all).

    So this class asserts the KNOWN-INCOMPLETE behaviour ON PURPOSE, the same way
    `services/boq_revision/test_carry.py::TestKnownHole` pins the ADR §8 net-zero hole: a source
    sheet whose CURRENT committed version is 2 while its overlay layers still sit on the frozen v1
    carries ZERO of those layers today. If you are here because these tests failed, you have made
    the annotation layers follow rates cross-version -- that is an OWNER CALL, not a bug fix. Read
    `docs/boq/HANDOFF-revised-boq-amendment-b-w3-w6.md` §5 W6 before deciding it is correct.

    The fixture is deliberately symmetric so the version is provably the ONLY cause: rows 2 and 3
    are both MATCHED twins of the revision, they differ only in which committed version their
    annotations were written on. Row 2's layers (orphaned on v1) all drop; row 3's (live on v2) all
    carry. The sharpest live consequence is the FORMULA line: the only formula sits on v1, so the
    committed revision arrives NOT formula-complete -> the mandatory amount-formula gate keeps every
    rate locked, and S9's own cross-BOQ rate carry then fails that sheet with `formulas_incomplete`
    -- i.e. this hole can defeat the very rate carry W6 repaired.
    """

    SRC = "CV"
    DEST = "CV Rev"          # a RENAME -- source read uses SRC, dest write uses DEST

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="OVERLAY CROSSVER ORIG")

        # The SOURCE was committed TWICE: v1 is frozen, v2 is current. `carry_commit_overlay`
        # resolves the source sheet by is_current=1 -> it will read v2 and only v2.
        cls.src_v1 = _commit_sheet(cls.original.name, cls.SRC, _role_map({"D": "Civil"}),
                                   commit_version=1, is_current=0)
        _node(cls.original.name, cls.src_v1, "Line Item", "Item Alpha", 2, 0,
              commit_version=1, is_current=0)
        _node(cls.original.name, cls.src_v1, "Line Item", "Item Beta", 3, 1,
              commit_version=1, is_current=0)
        cls.src_v2 = _commit_sheet(cls.original.name, cls.SRC, _role_map({"D": "Civil"}),
                                   commit_version=2, is_current=1)
        _node(cls.original.name, cls.src_v2, "Line Item", "Item Alpha", 2, 0, commit_version=2)
        _node(cls.original.name, cls.src_v2, "Line Item", "Item Beta", 3, 1, commit_version=2)

        # ORPHANED on the frozen v1 -- the human annotated BEFORE the source's re-commit. Every
        # record is still is_current=1: `is_current` is scoped per committed version, so nothing
        # ever un-flagged them.
        _mk_formula(cls.original.name, cls.SRC, 1, "Civil", "D")
        _mk_remark(cls.original.name, cls.SRC, 1, 2, "orphaned on v1")
        _mk_color(cls.original.name, cls.SRC, 1, 2, "D", "green")
        _mk_dismissal(cls.original.name, cls.SRC, 1, 2, "remark")
        _mk_category(cls.original.name, cls.SRC, 1, 2, "Electrical",
                     final="elec_machine", human="elec_human")

        # LIVE on the current v2 -- annotated AFTER the re-commit. Same layers, different row, so
        # any drop below is attributable to the version and nothing else. Deliberately NO formula
        # on v2: that is the gate consequence this class exists to pin.
        _mk_remark(cls.original.name, cls.SRC, 2, 3, "written after the re-commit")
        _mk_color(cls.original.name, cls.SRC, 2, 3, "D", "red")
        _mk_dismissal(cls.original.name, cls.SRC, 2, 3, "remark")
        _mk_category(cls.original.name, cls.SRC, 2, 3, "Electrical", final="beta_machine")

        cls.rev = _make_revision(cls.project.name, cls.original.name).name
        _seed_revision_draft(cls.rev, cls.DEST, cls.SRC)
        cls.dest_sheet = _commit_sheet(cls.rev, cls.DEST, _role_map({"D": "Civil"}))
        # Both source rows survive the revision at their original Excel positions -> both are
        # MATCHED twins under Amendment B (same Excel row + same description).
        _node(cls.rev, cls.dest_sheet, "Line Item", "Item Alpha", 2, 0)
        _node(cls.rev, cls.dest_sheet, "Line Item", "Item Beta", 3, 1)
        frappe.db.commit()

        cls.summary = commit_overlay.carry_commit_overlay(
            cls.rev, cls.DEST, 1, cls.dest_sheet,
            [{"row_number": 2, "cells": {"A": "Item Alpha", "D": 1}},
             {"row_number": 3, "cells": {"A": "Item Beta", "D": 2}}])
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        _wipe_boqs(cls.project.name)
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def _dest(self, doctype, **extra):
        filters = {"boq": self.rev, "sheet_name": self.DEST, "committed_version": 1,
                   "is_current": 1, **extra}
        return frappe.get_all(doctype, filters=filters, fields=["*"])

    def _src_current(self, doctype, committed_version=None, fields=None):
        """Source-side records. `committed_version=None` = the CROSS-VERSION read (what a W6-style
        fix would do); an int = the version-PINNED read the product actually performs. `fields`
        defaults to the row-addressed shape -- the formula layer is column-addressed and has no
        `excel_row`, so it passes its own."""
        filters = {"boq": self.original.name, "sheet_name": self.SRC, "is_current": 1}
        if committed_version is not None:
            filters["committed_version"] = committed_version
        return frappe.get_all(doctype, filters=filters,
                              fields=fields or ["excel_row", "committed_version"])

    # ── the fixture's own preconditions ────────────────────────────────────────────
    def test_fixture_is_genuinely_cross_version(self):
        """Guards the guard. If someone "simplifies" this fixture back to a single committed
        version, every assertion below would keep passing while testing nothing -- so pin the
        precondition explicitly and in BOTH directions: the source sheet really has two committed
        versions (v1 frozen, v2 current), and its annotations really straddle them, with the
        version-PINNED read (what the product performs) blind to the v1 half."""
        sheets = frappe.get_all(
            "BoQ Sheet", filters={"boq": self.original.name, "sheet_name": self.SRC},
            fields=["commit_version", "is_current"], order_by="commit_version asc")
        self.assertEqual([(s["commit_version"], s["is_current"]) for s in sheets],
                         [(1, 0), (2, 1)], "source must be a frozen v1 + a current v2")

        # Annotations straddle the two versions and every one of them is still is_current=1.
        self.assertEqual(
            sorted((r["committed_version"], r["excel_row"]) for r in self._src_current("BoQ Cell Remark")),
            [(1, 2), (2, 3)])
        # ...but the version-pinned read the carry actually performs sees only the v2 half.
        self.assertEqual([r["excel_row"] for r in self._src_current("BoQ Cell Remark", 2)], [3])
        self.assertEqual(
            [f["target_value_key"] for f in self._src_current(
                "BoQ Cell Amount Formula", None, ["target_value_key", "committed_version"])],
            ["Civil"], "exactly one source formula exists, and it is on v1")
        self.assertEqual(
            self._src_current("BoQ Cell Amount Formula", 2, ["target_value_key"]), [],
            "...so the v2-pinned read the carry performs is blind to it")

    def test_both_rows_are_matched_twins(self):
        """Isolates the version as the sole cause of the drops below: rows 2 and 3 are BOTH matched
        twins, so the D6 row match cannot explain why one row's layers carry and the other's do not.
        (The twin map itself is immune to this whole problem -- it reads nodes by the source sheet
        DOCNAME, which was resolved from is_current=1, so it is inherently current.)"""
        twin = commit_overlay._excel_twin_map(
            self.original.name, self.src_v2, self.rev, self.dest_sheet)
        self.assertEqual(twin, {2: 2, 3: 3})

    # ── provenance: correct, and honest about which version it read ────────────────
    def test_provenance_records_the_sources_current_version(self):
        # Structure stays per-commit (the deliberate W6 asymmetry): the overlay read v2, and the
        # stamp says v2 -- so S9 later resolves the same source sheet this carry used.
        prov = frappe.db.get_value(
            "BoQ Sheet", self.dest_sheet,
            ["source_boq", "source_commit_version", "source_sheet_name"], as_dict=True)
        self.assertEqual(prov.source_boq, self.original.name)
        self.assertEqual(prov.source_commit_version, 2)
        self.assertEqual(prov.source_sheet_name, self.SRC)

    # ── ⚠️ THE PINNED HOLE: v1-orphaned layers do NOT carry ────────────────────────
    def test_orphaned_remark_does_not_carry(self):
        # ⚠️ KNOWN-INCOMPLETE ON PURPOSE (see the class docstring). Flipping this to
        # {2: "orphaned on v1", 3: ...} is the owner-call fix, not a bug fix.
        self.assertEqual({r["excel_row"]: r["remark"] for r in self._dest("BoQ Cell Remark")},
                         {3: "written after the re-commit"})

    def test_orphaned_color_does_not_carry(self):
        # ⚠️ KNOWN-INCOMPLETE ON PURPOSE. (2,"D") green is orphaned on v1; only the v2 red lands.
        self.assertEqual(
            {(c["excel_row"], c["col_letter"]): c["color"] for c in self._dest("BoQ Cell Color")},
            {(3, "D"): "red"})

    def test_orphaned_remark_dismissal_does_not_carry(self):
        # ⚠️ KNOWN-INCOMPLETE ON PURPOSE. The re-armed computed kinds are a SEPARATE rule (D8) and
        # are not what this asserts -- both fixture dismissals are the carry-eligible `remark` kind.
        self.assertEqual([d["excel_row"] for d in self._dest("BoQ Cell Dismissal")], [3])

    def test_orphaned_category_does_not_carry(self):
        # ⚠️ KNOWN-INCOMPLETE ON PURPOSE, and the loudest of the five in the product: row 2 lands
        # blank, so a revision of an already-classified sheet shows CL-6 amber on a row whose
        # verdict a human had already given -- including the human verdict, not just the machine one.
        cats = {(c["excel_row"], c["discipline"]): c for c in self._dest("BoQ Row Category")}
        self.assertEqual(set(cats), {(3, "Electrical")})
        self.assertEqual(cats[(3, "Electrical")]["final_category_id"], "beta_machine")

    def test_orphaned_formula_leaves_the_committed_revision_rate_locked(self):
        """⚠️ KNOWN-INCOMPLETE ON PURPOSE, and the sharpest consequence. The source's ONLY amount
        formula sits on the frozen v1, so nothing carries and the dest's Civil@D amount column is
        uncovered -> `_sheet_formulas_complete` is false -> the MANDATORY amount-formula gate keeps
        EVERY rate on the committed revision read-only, and S9's cross-BOQ carry rejects the whole
        sheet with `formulas_incomplete`. That is this hole defeating the rate carry W6 repaired."""
        self.assertEqual(self.summary["formulas"], 0)
        self.assertEqual(self._dest("BoQ Cell Amount Formula"), [])
        self.assertFalse(pricing._sheet_formulas_complete(self.rev, self.DEST, 1))

    def test_summary_counts_the_current_behaviour(self):
        # One of each layer carried (the v2 half), none of the v1 half. When the owner decides the
        # annotation layers should follow rates cross-version, these become 1/2/2/2/2.
        self.assertEqual(
            {k: self.summary[k] for k in
             ("formulas", "remarks", "colors", "remark_dismissals", "categories")},
            {"formulas": 0, "remarks": 1, "colors": 1, "remark_dismissals": 1, "categories": 1})


class TestCommitPipelineReportsTheOverlay(FrappeTestCase):
    """W5 (A8): `_commit_one_sheet` must REPORT the overlay carry in its result envelope.

    Every other test in this module calls `carry_commit_overlay` DIRECTLY and asserts on the
    persisted rows, so all of them stay green even if the pipeline throws the returned
    summary away -- which is exactly what it used to do. A carried layer was then invisible
    to the user and, worse, a layer that FAILED was invisible too (`_guarded` swallows the
    exception and returns 0), leaving the Error Log as the only trace. W5 captures the
    summary into `overlay_summary` and adds `result["revision_overlay"]`.

    These tests therefore drive the REAL seam -- `commit_pipeline._commit_one_sheet` over a
    seeded revision -- and assert on the returned dict, so they fail if the capture, the
    None-ing, or the conditional key is removed.

    Three branches, matching the three ways `overlay_summary` can end up None:
      * finalized + mapped + committed source -> present, with the CONCRETE per-layer counts;
      * finalized + declared-NEW (unmapped)   -> the carry no-ops, provenance 0 -> key absent;
      * general_specs (the grid_only tier)    -> the carry never runs at all -> key absent.
    The non-revision branch is pinned in `test_commit_pipeline.py`, next to that file's
    existing non-revision envelope tests.
    """

    SRC = "Data"
    DEST = "Data Rev"
    NEW_SHEET = "Fresh Scope"
    GS_SHEET = "SOW Rev"

    # The dest column config, snapshotted onto the committed BoQ Sheet from the draft. One
    # per-area amount column (Civil@D) so the source's single formula re-validates and carries.
    _CFG = {
        "header_row": 1,
        "header_row_count": 1,
        "column_role_map": {
            "A": {"role": "description", "area": None},
            "D": {"role": _AREA_AMOUNT_ROLE, "area": "Civil"},
        },
        "column_headers": {"A": "Description", "D": "Amount Civil"},
        "area_dimensions": ["Civil"],
    }

    # The faithful grid handed to _commit_one_sheet. Column D is present on every content row,
    # which is what lets the source's (row 2, col D) color pass the survivor check.
    _GRID_ROWS = [
        {"row_number": 1, "cells": {"A": "Section"}},
        {"row_number": 2, "cells": {"A": "Item Alpha", "D": 1000}},
        {"row_number": 3, "cells": {"A": "Item Beta", "D": 2000}},
    ]

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="PIPELINE ORIG")

        # SOURCE: one committed sheet (Civil@D) + three nodes at Excel rows 1-3.
        cls.src_sheet = _commit_sheet(cls.original.name, cls.SRC, _role_map({"D": "Civil"}))
        _node(cls.original.name, cls.src_sheet, "Preamble", "Section", 1, 0, level=1)
        _node(cls.original.name, cls.src_sheet, "Line Item", "Item Alpha", 2, 1)
        _node(cls.original.name, cls.src_sheet, "Line Item", "Item Beta", 3, 2)

        # SOURCE overlay: exactly ONE record per carried layer, all on row 2 / column D, so the
        # expected summary is 1/1/1/1/1 and a layer that stopped carrying shows up as a 0.
        _mk_formula(cls.original.name, cls.SRC, 1, "Civil", "D")
        _mk_remark(cls.original.name, cls.SRC, 1, 2, "keep alpha")
        _mk_color(cls.original.name, cls.SRC, 1, 2, "D", "green")
        _mk_dismissal(cls.original.name, cls.SRC, 1, 2, "remark")
        _mk_category(cls.original.name, cls.SRC, 1, 2, "Electrical",
                     final="elec_machine", human="elec_human")

        # DEST: the revision + its three drafts (mapped data / declared-New / general specs).
        cls.rev = _make_revision(cls.project.name, cls.original.name).name
        rev_doc = frappe.get_doc("BOQs", cls.rev)
        rev_doc.append("sheet_drafts", {
            "sheet_name": cls.DEST, "sheet_order": 1, "wizard_status": "Finalized",
            "sheet_config": json.dumps(cls._CFG), "source_sheet_name": cls.SRC,
        })
        rev_doc.append("sheet_drafts", {
            "sheet_name": cls.NEW_SHEET, "sheet_order": 2, "wizard_status": "Finalized",
            "sheet_config": json.dumps(cls._CFG), "source_sheet_name": None,
        })
        rev_doc.append("sheet_drafts", {
            "sheet_name": cls.GS_SHEET, "sheet_order": 3, "wizard_status": "Finalized",
            "sheet_config": json.dumps(cls._CFG), "source_sheet_name": cls.SRC,
        })
        rev_doc.save(ignore_permissions=True)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        _wipe_boqs(cls.project.name)
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def tearDown(self):
        # _commit_one_sheet ends in frappe.db.commit(), so its three tiers outlive
        # FrappeTestCase's rollback. Purge everything the revision wrote (NOT the source) so
        # each test starts at commit_version 1 and the tests stay order-independent.
        for n in frappe.get_all("BOQ Nodes", filters={"boq": self.rev}, pluck="name"):
            frappe.db.delete("BOQ Node Qty By Area", {"parent": n})
        frappe.db.delete("BOQ Nodes", {"boq": self.rev})
        for g in frappe.get_all("BoQ Committed Sheet Grid", filters={"boq": self.rev},
                                pluck="name"):
            frappe.db.delete("BoQ Committed Sheet Grid Row", {"parent": g})
        frappe.db.delete("BoQ Committed Sheet Grid", {"boq": self.rev})
        for s in frappe.get_all("BoQ Sheet", filters={"boq": self.rev}, pluck="name"):
            frappe.db.delete("BoQ Sheet Work Package", {"parent": s})
        frappe.db.delete("BoQ Sheet", {"boq": self.rev})
        for dt in ("BoQ Cell Amount Formula", "BoQ Cell Remark", "BoQ Cell Color",
                   "BoQ Cell Dismissal", "BoQ Row Category", "BoQ Review Row"):
            frappe.db.delete(dt, {"boq": self.rev})
        frappe.db.commit()
        super().tearDown()

    # ---- fixture helpers ----------------------------------------------

    def _seed_review_rows(self, sheet_name):
        """Three review rows whose Excel rows + descriptions mirror the source nodes, so the
        committed dest nodes become the source rows' twins. `source_row_number` is the durable
        Excel address the whole overlay carry addresses by."""
        specs = [
            (0, 1, "preamble", "Section", -1, {"level": 1}),
            (1, 2, "line_item", "Item Alpha", 0, {"qty_total": 10.0, "rate_combined": 100.0}),
            (2, 3, "line_item", "Item Beta", 0, {"qty_total": 20.0, "rate_combined": 100.0}),
        ]
        for row_index, excel_row, classification, description, parent_index, extra in specs:
            rr = frappe.new_doc("BoQ Review Row")
            rr.boq = self.rev
            rr.sheet_name = sheet_name
            rr.row_index = row_index
            rr.source_row_number = excel_row
            rr.classification = classification
            rr.description = description
            rr.parent_index = parent_index
            rr.human_parent = -1
            rr.human_is_root = 0
            for field, value in extra.items():
                setattr(rr, field, value)
            rr.insert(ignore_permissions=True)
        frappe.db.commit()

    def _draft(self, sheet_name):
        for d in frappe.get_doc("BOQs", self.rev).sheet_drafts:
            if d.sheet_name == sheet_name:
                return d
        raise AssertionError(f"draft {sheet_name!r} not found")

    def _commit(self, sheet_name, disposition):
        return commit_pipeline._commit_one_sheet(
            self.rev, sheet_name, disposition, self._GRID_ROWS, self._draft(sheet_name)
        )

    # ---- (a) a REVISION commit reports real per-layer numbers ----------

    def test_finalized_revision_sheet_reports_the_overlay_counts(self):
        """The envelope carries the overlay's own per-layer summary, with real counts.

        The fixture seeds exactly one carryable record per layer, so 1/1/1/1/1 (+ provenance)
        is a value assertion, not a presence check: a threading rewired to `_empty_summary()`
        or to a constant fails, and so does a layer that silently stopped carrying.
        """
        self._seed_review_rows(self.DEST)

        res = self._commit(self.DEST, "finalized")

        self.assertIn("revision_overlay", res,
                      "W5 dropped the overlay summary from the commit result")
        self.assertEqual(res["revision_overlay"], {
            "provenance": 1, "formulas": 1, "remarks": 1, "colors": 1,
            "remark_dismissals": 1, "categories": 1,
        })

    def test_reported_counts_match_what_actually_landed(self):
        """The reported numbers must equal the rows the carry actually persisted.

        A summary that drifts from the DB is worse than no summary -- the commit-results modal
        would tell the user their annotations carried when they did not. Counting the dest
        rows independently is the check the return value cannot fake.
        """
        self._seed_review_rows(self.DEST)

        res = self._commit(self.DEST, "finalized")

        summary = res["revision_overlay"]
        for doctype, key in (("BoQ Cell Amount Formula", "formulas"),
                             ("BoQ Cell Remark", "remarks"),
                             ("BoQ Cell Color", "colors"),
                             ("BoQ Row Category", "categories")):
            landed = frappe.get_all(doctype, filters={
                "boq": self.rev, "sheet_name": self.DEST,
                "committed_version": res["commit_version"], "is_current": 1})
            self.assertEqual(len(landed), summary[key], f"{doctype} count disagrees")
        dismissals = frappe.get_all("BoQ Cell Dismissal", filters={
            "boq": self.rev, "sheet_name": self.DEST,
            "committed_version": res["commit_version"], "is_current": 1,
            "flag_kind": "remark"})
        self.assertEqual(len(dismissals), summary["remark_dismissals"])

    def test_report_does_not_disturb_the_pre_w5_envelope(self):
        """`revision_overlay` is ADDITIVE -- every pre-W5 key still comes back unchanged.

        W5 must not have reshaped the envelope the commit loop and the results modal already
        consume; the new key is the only difference.
        """
        self._seed_review_rows(self.DEST)

        res = self._commit(self.DEST, "finalized")

        self.assertEqual(
            set(res) - {"revision_overlay"},
            {"sheet_name", "disposition", "sheet_disposition", "grid_name", "boq_sheet_name",
             "commit_version", "row_count", "froze_prior", "froze_prior_sheet", "node_count",
             "froze_nodes"},
        )

    # ---- (b) the branches where the key must be ABSENT -----------------

    def test_declared_new_sheet_omits_the_key(self):
        """A declared-NEW (unmapped) revision sheet has no provenance -> no report.

        `carry_commit_overlay` returns the zero summary (provenance 0) for an unmapped sheet;
        `_commit_one_sheet` nulls that out rather than reporting an all-zeros overlay the user
        would misread as "your annotations were dropped".
        """
        self._seed_review_rows(self.NEW_SHEET)

        res = self._commit(self.NEW_SHEET, "finalized")

        self.assertNotIn("revision_overlay", res)

    def test_general_specs_sheet_omits_the_key(self):
        """A general-specs sheet (grid_only tier) never enters the overlay branch at all.

        The carry is gated on `disposition == "finalized"` because it needs the priceable node
        tier the overlays sit on -- a general-specs sheet has none. Its envelope must therefore
        look exactly like a non-revision one.
        """
        res = self._commit(self.GS_SHEET, "general_specs")

        self.assertNotIn("revision_overlay", res)
        self.assertEqual(res["node_count"], 0)


if __name__ == "__main__":
    frappe.init(site="localhost")
    frappe.connect()
    import unittest
    unittest.main()
