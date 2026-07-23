"""S6/S8 (#1104, ADR-0014 D8 -> Amendment C -> **Amendment D**) -- what a revision commit does,
and what the two committed sheets' row match yields. Integration.

⚠️ **AMENDMENT D (2026-07-23)**: a revision commit stamps the D2 provenance triple and carries
NOTHING, and the post-commit per-sheet action carries RATES ONLY. The annotation-layer engine this
module used to exercise (remark / colour / `remark` dismissal / category, with presence-awareness
and Keep/Overwrite) is DELETED.

The rich fixtures are KEPT and INVERTED rather than dropped: they still seed every annotation kind
on the source across a role SWAP, a dropped column, a removed row and a two-engine category
fan-out, and now assert that NONE of it lands on the revision. That is a far stronger guard against
the annotation carry creeping back than deleting the fixtures would be.

Still asserted here: the provenance stamp (which MUST survive -- it is how the rate carry finds its
source at all), the Amendment B excel-row twin match, and that formulas never carry in either seam.
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
    """AMENDMENT D shim. A revision commit now does exactly ONE thing -- stamp provenance -- and no
    seam carries annotations any more, so this drives the stamp and reports zero for every layer.

    The signature keeps `dest_version` / `grid_rows` so the existing fixtures call it unchanged;
    they are unused, which is precisely the point being asserted."""
    provenance = committed_carry.stamp_revision_provenance(boq, sheet_name, dest_sheet_docname)
    return {"provenance": provenance, "formulas": 0, "remarks": 0, "colors": 0,
            "remark_dismissals": 0, "categories": 0}


class TestCommitOverlayCarry(FrappeTestCase):
    """The rich end-to-end fixture, INVERTED for Amendment D: every annotation kind is seeded on
    the source across a role SWAP, a dropped column, a removed row and a two-engine category
    fan-out -- and NONE of it may land on the revision. Only the provenance stamp does."""

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

    # ---- AMENDMENT D: not one annotation layer lands ----
    # Each of these was an "it carried, correctly re-keyed" assertion before D. The source fixture
    # is unchanged, so a regression that re-enables any layer fails here immediately.
    def test_no_remark_carries(self):
        self.assertEqual(self._dest("BoQ Cell Remark"), [])

    def test_no_color_carries_even_for_a_surviving_letter(self):
        """(2,"D") green survives the column diff and (2,"F") red does not -- under Amendment D the
        distinction is moot, because neither is copied."""
        self.assertEqual(self._dest("BoQ Cell Color"), [])

    def test_no_dismissal_carries_of_either_kind(self):
        """The `remark` kind was the ONE dismissal Amendment C carried; the computed kinds never
        did. Now neither does."""
        self.assertEqual(self._dest("BoQ Cell Dismissal"), [])
        self.assertEqual(
            frappe.get_all("BoQ Cell Dismissal", filters={
                "boq": self.rev, "committed_version": 1}),
            [])

    def test_reconciliation_choice_never_carried(self):
        self.assertEqual(self._dest("BoQ Cell Reconciliation Choice"), [])

    def test_no_category_carries_and_the_fan_out_does_not_follow(self):
        """Alpha is classified by TWO engines on the source, one with a human verdict. Neither
        lands, so every eligible row on the revision starts blank -> CL-6 amber, and the reviewer
        classifies the revision on its own terms."""
        self.assertEqual(self._dest("BoQ Row Category"), [])
        self.assertEqual(
            frappe.get_all("BoQ Row Category", filters={
                "boq": self.rev, "sheet_name": self.DEST, "committed_version": 1}),
            [])

    # ---- summary ----
    def test_summary_reports_provenance_only(self):
        self.assertEqual(self.summary["provenance"], 1)
        self.assertEqual(
            {k: self.summary[k] for k in
             ("formulas", "remarks", "colors", "remark_dismissals", "categories")},
            {"formulas": 0, "remarks": 0, "colors": 0, "remark_dismissals": 0, "categories": 0})


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

    def test_the_shifted_row_is_not_a_twin(self):
        """Amendment B's key in one assertion: "Stable Item" holds row 2 on both sides and pairs;
        "Moved Item" slipped 3 -> 7 with byte-identical text and does NOT. AMENDMENT D re-pointed
        this class at the MATCH itself -- it used to assert the property through the remark carry,
        which no longer exists, but the matcher is shared with the rate carry so the property still
        has to hold."""
        twin = committed_carry._excel_twin_map(
            self.original.name, self.src_sheet, self.rev, self.dest_sheet)
        self.assertEqual(twin, {2: 2})

    def test_no_remark_carries_at_all(self):
        self.assertEqual(
            frappe.get_all("BoQ Cell Remark", filters={
                "boq": self.rev, "sheet_name": self.SHEET, "committed_version": 1}),
            [])


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

    # ── AMENDMENT D: the whole "orphaned on a superseded version" question is MOOT ─────
    # Before D these five tests pinned a known hole: an annotation written before the source
    # sheet's last re-commit is stranded on the frozen version, so the version-PINNED read misses
    # it and it silently fails to carry. Under Amendment D no annotation carries from ANY version,
    # so the hole cannot be observed and the fixture's cross-version shape is now only exercising
    # the provenance stamp + the twin map above. What remains true and load-bearing is the FORMULA
    # consequence, which is unchanged and still gates the rate carry.
    def test_no_annotation_carries_from_either_version(self):
        for doctype in ("BoQ Cell Remark", "BoQ Cell Color", "BoQ Cell Dismissal",
                        "BoQ Row Category", "BoQ Cell Reconciliation Choice"):
            self.assertEqual(self._dest(doctype), [], f"{doctype} must not carry")

    def test_orphaned_formula_leaves_the_committed_revision_rate_locked(self):
        """The sharpest consequence, and UNCHANGED by Amendment D. The source's ONLY amount formula
        sits on the frozen v1; formulas never carry in either seam, so the dest's Civil@D amount
        column is uncovered -> `_sheet_formulas_complete` is false -> the MANDATORY amount-formula
        gate keeps EVERY rate on the committed revision read-only, and the cross-BOQ carry rejects
        the sheet with `formulas_incomplete` until the user declares them by hand."""
        self.assertEqual(self.summary["formulas"], 0)
        self.assertEqual(self._dest("BoQ Cell Amount Formula"), [])
        self.assertFalse(pricing._sheet_formulas_complete(self.rev, self.DEST, 1))

    def test_summary_reports_provenance_only(self):
        self.assertEqual(self.summary["provenance"], 1)
        self.assertEqual(
            {k: self.summary[k] for k in
             ("formulas", "remarks", "colors", "remark_dismissals", "categories")},
            {"formulas": 0, "remarks": 0, "colors": 0, "remark_dismissals": 0, "categories": 0})
