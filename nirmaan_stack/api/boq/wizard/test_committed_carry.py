"""S6/S8 (#1104, ADR-0014 D8) -- the commit-time overlay carry, integration.

Exercises `committed_carry.carry_commit_overlay`: at a revision sheet's commit it stamps the D2
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

from nirmaan_stack.api.boq.wizard import committed_carry, commit_pipeline, pricing
from nirmaan_stack.api.boq.wizard.review_carry import _source_sheet_name, revision_source_boq
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


def _carry_all(boq, sheet_name, dest_version, dest_sheet_docname, grid_rows):
    """AMENDMENT C shim. The commit seam no longer carries anything (C5), but the LAYER semantics
    this module has always covered -- twin mapping, the colour survivor check, the category field
    split, the re-armed set never carrying -- are unchanged; they simply moved to the post-commit
    action. So: stamp provenance the way the commit does, then drive the SAME `carry_layers` engine
    the action drives, and return the old summary shape.

    `formulas` is pinned at 0 here because formulas NEVER carry now, in either seam. The classes
    that used to assert the opposite are replaced by `TestFormulasNeverCarryAtCommit`."""
    provenance = committed_carry.stamp_revision_provenance(boq, sheet_name, dest_sheet_docname)
    summary = {"provenance": provenance, "formulas": 0, "remarks": 0, "colors": 0,
               "remark_dismissals": 0, "categories": 0}
    if not provenance:
        return summary

    source_boq = revision_source_boq(boq)
    source_sheet_name = _source_sheet_name(boq, sheet_name)
    src = frappe.db.get_value(
        "BoQ Sheet",
        {"boq": source_boq, "sheet_name": source_sheet_name, "is_current": 1},
        ["name", "commit_version"], as_dict=True,
    )
    ctx = committed_carry.build_carry_ctx(
        source_boq=source_boq, source_sheet_name=source_sheet_name,
        source_version=src.commit_version,
        dest_boq=boq, dest_sheet_name=sheet_name, dest_version=dest_version,
        twin=committed_carry._excel_twin_map(source_boq, src.name, boq, dest_sheet_docname),
        grid_rows=grid_rows,
    )
    out = committed_carry.carry_layers(
        ctx, {k: {"carry": True, "overwrite": False} for k in committed_carry.LAYER_KEYS}
    )
    for key, bucket in out.items():
        summary[key] = bucket["carried"] + bucket["replaced"]
    return summary


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
        cls.summary = _carry_all(
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

    # ---- formula: AMENDMENT C -- never carries, in either seam ----
    # These three assertions are the INVERSE of what this class asserted before C5 (a role SWAP
    # re-resolving `target_col`, the gate opening, the body preserved). The fixture still seeds
    # three source formulas across a swapped-role dest, so what changed is the ruling, not the
    # inputs. `TestFormulasNeverCarryAtCommit` covers the same ground on a dedicated fixture.
    def test_no_formula_carries_even_when_the_role_axis_would_re_resolve(self):
        self.assertEqual(self._dest("BoQ Cell Amount Formula"), [])

    def test_the_revision_is_not_formula_complete(self):
        """The gate the whole feature hangs on: with no carried formula, every rate on this sheet
        is locked until the user declares them by hand."""
        self.assertFalse(pricing._sheet_formulas_complete(self.rev, self.DEST, 1))

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
        self.assertEqual(self.summary["formulas"], 0)  # AMENDMENT C: formulas never carry
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

        _carry_all(
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


class TestFormulasNeverCarryAtCommit(FrappeTestCase):
    """AMENDMENT C (C5): a revision commit carries NO formulas -- the sheet arrives NOT
    formula-complete and every rate is locked until the user declares them by hand, exactly as in
    the normal phase after a re-commit.

    This class REPLACES `TestCommitOverlayFailClosed` and `TestCommitOverlayWildcardFormula`, which
    asserted the opposite (a per-area override and an area-wildcard formula each carrying). Their
    fixture is kept -- source formulas on both shapes -- so the reversal is what changed, not the
    coverage: the same inputs now land nothing.
    """

    SRC = "FX"
    DEST = "FX Rev"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="FORMULA ORIG")
        cls.src_sheet = _commit_sheet(
            cls.original.name, cls.SRC, _role_map({"D": "Civil", "E": "MEP"}))
        _node(cls.original.name, cls.src_sheet, "Line Item", "Item Alpha", 2, 1)
        _mk_formula(cls.original.name, cls.SRC, 1, "Civil", "D")  # per-area OVERRIDE
        _mk_formula(cls.original.name, cls.SRC, 1, None, "E")     # area WILDCARD (all 32 live ones)

        cls.rev = _make_revision(cls.project.name, cls.original.name).name
        _seed_revision_draft(cls.rev, cls.DEST, cls.SRC)
        cls.dest_sheet = _commit_sheet(
            cls.rev, cls.DEST, _role_map({"D": "Civil", "E": "MEP"}))
        _node(cls.rev, cls.dest_sheet, "Line Item", "Item Alpha", 2, 1)
        frappe.db.commit()

        cls.summary = _carry_all(cls.rev, cls.DEST, 1, cls.dest_sheet, [
            {"row_number": 2, "cells": {"A": "Item Alpha", "D": 1, "E": 2}},
        ])
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        _wipe_boqs(cls.project.name)
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_provenance_still_lands(self):
        """The one thing a commit still does -- and it MUST, or the post-commit carry cannot find
        its source at all."""
        self.assertEqual(self.summary["provenance"], 1)
        prov = frappe.db.get_value(
            "BoQ Sheet", self.dest_sheet,
            ["source_boq", "source_commit_version", "source_sheet_name"], as_dict=True)
        self.assertEqual(prov.source_boq, self.original.name)
        self.assertEqual(prov.source_sheet_name, self.SRC)

    def test_no_formula_record_lands_on_the_revision(self):
        self.assertEqual(
            frappe.get_all("BoQ Cell Amount Formula",
                           filters={"boq": self.rev, "sheet_name": self.DEST, "is_current": 1}),
            [],
            "neither the per-area override nor the wildcard may carry",
        )

    def test_the_revision_is_not_formula_complete(self):
        """THE consequence, and the gate the whole feature hangs on: rates are locked until the
        user declares the formulas, and the carry button stays disabled until then."""
        self.assertFalse(
            pricing._sheet_formulas_complete(self.rev, self.DEST, 1),
            "an amount column with no covering formula -> the mandatory gate fails closed",
        )


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
        summary = _carry_all(
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
        summary = _carry_all(
            rev, "Fresh", 1, dest_sheet, [{"row_number": 2, "cells": {"D": 1}}])
        self.assertEqual(summary["provenance"], 0)
        self.assertIsNone(frappe.db.get_value("BoQ Sheet", dest_sheet, "source_boq"))


class TestCommitOverlayCrossVersionSource(FrappeTestCase):
    """⚠️ DOCUMENTED ASYMMETRY -- ADR-0014 Amendment B W6, and it is NOT an oversight.

    Pricing identity includes `committed_version`, so `is_current` is scoped PER VERSION, and
    re-committing a source sheet mints a new version and ORPHANS the prior version's records onto
    the now-frozen one (the BOQ_DOWNSTREAM_ORPHAN guard warns, it never migrates). W6 briefly made
    the cross-BOQ RATE carry read its source cross-version to dodge this; AMENDMENT C (2026-07-23,
    owner-directed) pinned it back, so rates and every layer below share the same exposure again.

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

        cls.summary = _carry_all(
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
        twin = committed_carry._excel_twin_map(
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


class TestCarryLayersPresenceAndOverwrite(FrappeTestCase):
    """AMENDMENT C / C1 -- the layer engine's post-commit semantics.

    Every test above drives the layer carry through `carry_commit_overlay`, where the destination
    is a BRAND-NEW committed version and therefore always empty. This class drives `carry_layers`
    and `plan_layer_counts` DIRECTLY against a destination that already holds work -- the
    post-commit reality Amendment C introduces, and the exact assumption the pre-Amendment-C code
    hardcoded away ("fresh dest triple -> no prior -> v1").

    The fixture is deliberately minimal: two matched rows, one source annotation of each layer, and
    a destination that starts EMPTY so a single class can walk it through carry -> re-carry ->
    overwrite in order.
    """

    SRC = "Layers"
    DEST = "Layers Rev"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="LAYERS ORIG")

        cls.src_sheet = _commit_sheet(cls.original.name, cls.SRC, _role_map({"D": "Civil"}))
        _node(cls.original.name, cls.src_sheet, "Line Item", "Item Alpha", 2, 1)
        _node(cls.original.name, cls.src_sheet, "Line Item", "Item Beta", 3, 2)

        _mk_remark(cls.original.name, cls.SRC, 1, 2, "source remark")
        _mk_color(cls.original.name, cls.SRC, 1, 2, "D", "green")
        _mk_dismissal(cls.original.name, cls.SRC, 1, 2, "remark")
        _mk_category(cls.original.name, cls.SRC, 1, 2, "Electrical",
                     final="elec_machine", human="elec_human")

        cls.rev = _make_revision(cls.project.name, cls.original.name).name
        _seed_revision_draft(cls.rev, cls.DEST, cls.SRC)
        cls.dest_sheet = _commit_sheet(cls.rev, cls.DEST, _role_map({"D": "Civil"}))
        _node(cls.rev, cls.dest_sheet, "Line Item", "Item Alpha", 2, 1)
        _node(cls.rev, cls.dest_sheet, "Line Item", "Item Beta", 3, 2)

        # A real committed grid -- `grid_rows=None` below exercises the POST-COMMIT read path
        # (`_dest_column_universe` reading BoQ Committed Sheet Grid Row), not the in-flight list
        # the commit seam passes.
        grid = frappe.new_doc("BoQ Committed Sheet Grid")
        grid.boq = cls.rev
        grid.source_sheet_name = cls.DEST
        grid.commit_version = 1
        grid.is_current = 1
        grid.committed_at = frappe.utils.now()
        for row_number, cells in ((2, {"A": "Item Alpha", "D": 1}), (3, {"A": "Item Beta", "D": 2})):
            grid.append("rows", {
                "row_number": row_number, "row_order": row_number, "cells": json.dumps(cells),
            })
        grid.insert(ignore_permissions=True)
        frappe.db.commit()

        cls.ctx = committed_carry._CarryCtx(
            source_boq=cls.original.name,
            source_sheet_name=cls.SRC,
            source_version=1,
            dest_boq=cls.rev,
            dest_sheet_name=cls.DEST,
            dest_version=1,
            twin=committed_carry._excel_twin_map(
                cls.original.name, cls.src_sheet, cls.rev, cls.dest_sheet
            ),
            grid_rows=None,  # post-commit: read the persisted grid
        )

    @classmethod
    def tearDownClass(cls):
        _wipe_boqs(cls.project.name)
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    @staticmethod
    def _all_on():
        return {key: {"carry": True, "overwrite": False} for key in committed_carry.LAYER_KEYS}

    def _dest_rows(self, doctype, **extra):
        """EVERY dest record (current AND frozen) -- a supersede must be visible, not just the tip."""
        return frappe.get_all(
            doctype,
            filters={"boq": self.rev, "sheet_name": self.DEST, "committed_version": 1, **extra},
            fields=["*"],
        )

    def test_01_plan_is_read_only_and_reports_carryable(self):
        plan = committed_carry.plan_layer_counts(self.ctx)
        for key in committed_carry.LAYER_KEYS:
            self.assertEqual(plan[key]["carried"], 1, f"{key} should report 1 carryable")
            self.assertEqual(plan[key]["kept"], 0, f"{key} has nothing present yet")
        # PURE READ -- the plan must not have written anything.
        self.assertEqual(len(self._dest_rows("BoQ Cell Remark")), 0)
        self.assertEqual(len(self._dest_rows("BoQ Row Category")), 0)

    def test_02_first_carry_lands_every_layer(self):
        out = committed_carry.carry_layers(self.ctx, self._all_on())
        frappe.db.commit()
        for key in committed_carry.LAYER_KEYS:
            self.assertEqual(out[key]["carried"], 1, f"{key} should have landed")
            self.assertEqual(out[key]["replaced"], 0)
        remarks = self._dest_rows("BoQ Cell Remark")
        self.assertEqual(len(remarks), 1)
        self.assertEqual(remarks[0].excel_row, 2)
        self.assertEqual(remarks[0].remark, "source remark")
        self.assertEqual(remarks[0].remark_version, 1)
        # The colour landed via the DB grid read (grid_rows=None) -- "D" survives in the grid.
        self.assertEqual(len(self._dest_rows("BoQ Cell Color")), 1)

    def test_03_carrying_twice_is_a_no_op(self):
        """The whole point of Amendment C's presence-awareness: the post-commit action is
        idempotent. Pre-Amendment-C this inserted a SECOND is_current=1 record per identity,
        breaking the one-current invariant."""
        out = committed_carry.carry_layers(self.ctx, self._all_on())
        frappe.db.commit()
        for key in committed_carry.LAYER_KEYS:
            self.assertEqual(out[key]["kept"], 1, f"{key} should be kept, not re-inserted")
            self.assertEqual(out[key]["carried"], 0)
            self.assertEqual(out[key]["replaced"], 0)
        self.assertEqual(len(self._dest_rows("BoQ Cell Remark")), 1)

    def test_04_user_work_is_never_clobbered_by_default(self):
        pricing.save_row_remark(
            boq_name=self.rev, sheet_name=self.DEST, excel_row=3,
            committed_version=1, remark="the user's own note",
        )
        out = committed_carry.carry_layers(self.ctx, self._all_on())
        frappe.db.commit()
        self.assertEqual(out["remarks"]["kept"], 1)
        row3 = [r for r in self._dest_rows("BoQ Cell Remark", is_current=1) if r.excel_row == 3]
        self.assertEqual(len(row3), 1)
        self.assertEqual(row3[0].remark, "the user's own note")

    def test_05_overwrite_freezes_the_prior_and_supersedes(self):
        choices = self._all_on()
        choices["remarks"]["overwrite"] = True
        out = committed_carry.carry_layers(self.ctx, choices)
        frappe.db.commit()
        self.assertEqual(out["remarks"]["replaced"], 1)
        self.assertEqual(out["remarks"]["carried"], 0)
        row2 = sorted(
            [r for r in self._dest_rows("BoQ Cell Remark") if r.excel_row == 2],
            key=lambda r: r.remark_version,
        )
        self.assertEqual(len(row2), 2, "the prior must be superseded, not deleted")
        self.assertEqual(row2[0].is_current, 0)
        self.assertEqual(row2[1].is_current, 1)
        self.assertEqual(row2[1].remark_version, 2, "max(prior) + 1, never a hardcoded 1")

    def test_06_a_cleared_annotation_leaves_a_frozen_prior_and_the_carry_does_not_collide(self):
        """save_row_remark's CLEAR branch freezes without inserting, so the dest has a frozen
        record and NO current one. The carry must treat it as carryable AND must not re-use the
        frozen record's version number."""
        pricing.save_row_remark(
            boq_name=self.rev, sheet_name=self.DEST, excel_row=3,
            committed_version=1, remark=None,  # CLEAR
        )
        self.assertEqual(
            len([r for r in self._dest_rows("BoQ Cell Remark", is_current=1) if r.excel_row == 3]),
            0,
        )
        out = committed_carry.carry_layers(
            self.ctx, {"remarks": {"carry": True, "overwrite": False}}
        )
        frappe.db.commit()
        # Row 3's source has no remark, so nothing lands there -- the assertion that matters is
        # that row 2 (which DOES have one, already present) is kept and nothing collided.
        self.assertEqual(out["remarks"]["kept"], 1)
        versions = [r.remark_version for r in self._dest_rows("BoQ Cell Remark") if r.excel_row == 3]
        self.assertEqual(len(versions), len(set(versions)), "version numbers must never collide")

    def test_07_category_overwrite_preserves_the_field_split(self):
        choices = {"categories": {"carry": True, "overwrite": True}}
        out = committed_carry.carry_layers(self.ctx, choices)
        frappe.db.commit()
        self.assertEqual(out["categories"]["replaced"], 1)
        current = [
            r for r in self._dest_rows("BoQ Row Category", is_current=1) if r.excel_row == 2
        ]
        self.assertEqual(len(current), 1)
        # machine -> machine, human -> human. NEVER collapsed (that is #1096's freeze bug).
        self.assertEqual(current[0].final_category_id, "elec_machine")
        self.assertEqual(current[0].human_category_id, "elec_human")
        self.assertGreater(current[0].category_version, 1)

    def test_08_a_frozen_classification_blocks_categories_but_not_the_rest(self):
        frappe.db.set_value(
            "BoQ Sheet", self.dest_sheet, "classification_frozen", 1, update_modified=False
        )
        frappe.db.commit()
        try:
            choices = self._all_on()
            choices["categories"]["overwrite"] = True
            choices["remarks"]["overwrite"] = True
            out = committed_carry.carry_layers(self.ctx, choices)
            frappe.db.commit()
            self.assertEqual(out["categories"], committed_carry._zero_layer_outcome())
            # The freeze is category-only -- remarks still carry (the owner-locked separation
            # between the classification freeze and the pricing lock).
            self.assertEqual(out["remarks"]["replaced"], 1)
        finally:
            frappe.db.set_value(
                "BoQ Sheet", self.dest_sheet, "classification_frozen", 0, update_modified=False
            )
            frappe.db.commit()

    def test_09_an_unselected_layer_is_untouched(self):
        out = committed_carry.carry_layers(self.ctx, {"remarks": {"carry": False}})
        for key in committed_carry.LAYER_KEYS:
            self.assertEqual(out[key], committed_carry._zero_layer_outcome())


if __name__ == "__main__":
    frappe.init(site="localhost")
    frappe.connect()
    import unittest
    unittest.main()
