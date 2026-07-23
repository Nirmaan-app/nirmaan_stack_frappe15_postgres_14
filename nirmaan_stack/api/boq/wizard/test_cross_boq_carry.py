# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""S7a / plan-slice S9 (#1105, ADR-0014 D9) -- cross-BOQ RATE carry backend.

Exercises `cross_boq_carry`: a source-driven, destination-keyed, per-cell carry plan across TWO
BOQs (an original + its revision), and a long-job worker with per-sheet failure isolation.

The rich fixture: an ORIGINAL committed sheet "Data" v1 with priced cells crafted to hit EVERY
plan outcome, and a REVISION committed sheet "Data Rev" (a RENAME) with a column MOVE (rate D -> E,
proving `(area, rate_kind)` re-resolution + that the source col_letter is never a write target). A
second tiny "Amt Rev" sheet (an amount column, no formula) drives the per-sheet formula-gate
isolation.

⚠️ REBUILT FOR **ADR-0014 Amendment B** (2026-07-20). The dest rows were previously SHIFTED +100 to
prove the twin map ignored row numbers. Amendment B makes `same Excel row + same description` the
key, so a carried pair now ALWAYS shares its Excel row -- `source_excel_row == dest_excel_row` for
every non-skip plan entry. The two rows that used to prove "ambiguous" are repurposed to prove the
two ways position/text can now break a pair.

  source row  desc            priced          dest      -> outcome
    10        Item A          combined 100     10           clean copy
    11        Item B          combined 200     11 (filled)  conflict
    12        Header (Pre)    combined 300     12           non_priceable
    13        Item Removed    combined 400     (none)       removed -- gone entirely
    14        Item Moved      combined 500     20           removed -- same text, MOVED row
    15        Item Reworded   combined 550     15 (retext)  removed -- same row, NEW text
    16        Item NoCol      supply   600     16           no_rate_column (dest has no supply col)
    (dest 20 / 15 / 99 are unmatched and priceable -> needs_new_value_count = 3)
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import committed_carry, cross_boq_carry, pricing
from nirmaan_stack.api.boq.wizard.pricing_lock import acquire_or_refresh
from nirmaan_stack.api.boq.wizard.test_revision_entry import (
    _cleanup_project,
    _make_boq,
    _make_project,
)
from nirmaan_stack.api.boq.wizard.test_revision_mapping import _make_revision

_PRICING = "BoQ Cell Pricing"
_LOCK_DT = "BoQ Sheet Pricing Lock"
_SHEET = "BoQ Sheet"

_SCALAR_RATE = {"role": "rate_combined", "area": None}
_DESC = {"role": "description", "area": None}
_UNIT = {"role": "unit", "area": None}


def _seed_sheet(boq, sheet, version, is_current, role_map, nodes, sheet_order=1):
    """A committed BoQ Sheet + its BOQ Nodes (scalar role map; sheet_name VERBATIM #152)."""
    bs = frappe.new_doc(_SHEET)
    bs.boq = boq
    bs.sheet_name = sheet
    bs.sheet_order = sheet_order
    bs.treat_as = "data"
    bs.header_row = 1
    bs.header_row_count = 1
    bs.column_role_map = role_map
    bs.column_headers = {}
    bs.area_dimensions = json.dumps([])
    bs.commit_version = version
    bs.is_current = is_current
    bs.committed_at = frappe.utils.now()
    bs.insert(ignore_permissions=True)
    for i, n in enumerate(nodes):
        nd = frappe.new_doc("BOQ Nodes")
        nd.sheet = bs.name
        nd.node_type = n["node_type"]
        nd.row_class = "line_item" if n["node_type"] == "Line Item" else "preamble"
        if n["node_type"] != "Line Item":
            nd.level = 1  # the controller forbids `level` on Line Item nodes
        nd.description = n["description"]
        nd.source_row_number = n["srn"]
        nd.sort_order = i
        nd.qty = n.get("qty", 0.0)
        nd.commit_version = version
        nd.is_current = is_current
        nd.committed_at = frappe.utils.now()
        nd.insert(ignore_permissions=True)
    return bs.name


def _price(boq, sheet, version, excel_row, col_letter, rate_kind, rate, area=None):
    d = frappe.new_doc(_PRICING)
    d.boq = boq
    d.sheet_name = sheet
    d.excel_row = excel_row
    d.col_letter = col_letter
    d.committed_version = version
    d.area = area
    d.rate_kind = rate_kind
    d.rate = rate
    d.is_filled = 1
    d.pricing_version = 1
    d.is_current = 1
    d.priced_at = frappe.utils.now()
    d.insert(ignore_permissions=True)



def _formula(boq, sheet, version, target_col, value_field="amount_total", value_key=""):
    """A current amount-FORMULA record for one committed (boq, sheet, version)."""
    d = frappe.new_doc("BoQ Cell Amount Formula")
    d.boq = boq
    d.sheet_name = sheet
    d.committed_version = version
    d.target_value_field = value_field
    d.target_value_key = value_key
    d.target_rate_subkey = ""
    d.target_col = target_col
    d.formula = json.dumps({"op": "mul", "args": [{"ref": "qty"}, {"ref": "rate_combined"}]})
    d.formula_version = 1
    d.is_current = 1
    d.defined_at = frappe.utils.now()
    d.insert(ignore_permissions=True)
    return d


def _stamp_provenance(dest_sheet_docname, source_boq, source_sheet_name, source_version=1):
    frappe.db.set_value(_SHEET, dest_sheet_docname, {
        "source_boq": source_boq,
        "source_commit_version": source_version,
        "source_sheet_name": source_sheet_name,
    }, update_modified=False)


class TestCrossBoqRateCarry(FrappeTestCase):
    SRC = "Data"
    DEST = "Data Rev"           # a RENAME
    AMT_SRC = "Amt"
    AMT_DEST = "Amt Rev"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.orig = _make_boq(cls.project.name, origin="upload", boq_name="CARRY ORIG").name
        cls.rev = _make_revision(cls.project.name, cls.orig).name

        # ORIGINAL "Data" v1 -- rate at col D (scalar combined).
        cls.src_sheet = _seed_sheet(cls.orig, cls.SRC, 1, 1,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE}, [
                {"srn": 10, "node_type": "Line Item", "description": "Item A", "qty": 5.0},
                {"srn": 11, "node_type": "Line Item", "description": "Item B", "qty": 5.0},
                {"srn": 12, "node_type": "Preamble", "description": "Header"},
                {"srn": 13, "node_type": "Line Item", "description": "Item Removed", "qty": 5.0},
                {"srn": 14, "node_type": "Line Item", "description": "Item Moved", "qty": 5.0},
                {"srn": 15, "node_type": "Line Item", "description": "Item Reworded", "qty": 5.0},
                {"srn": 16, "node_type": "Line Item", "description": "Item NoCol", "qty": 5.0},
            ])
        _price(cls.orig, cls.SRC, 1, 10, "D", "combined_rate", 100.0)  # clean
        _price(cls.orig, cls.SRC, 1, 11, "D", "combined_rate", 200.0)  # conflict
        _price(cls.orig, cls.SRC, 1, 12, "D", "combined_rate", 300.0)  # non_priceable
        _price(cls.orig, cls.SRC, 1, 13, "D", "combined_rate", 400.0)  # removed (gone)
        _price(cls.orig, cls.SRC, 1, 14, "D", "combined_rate", 500.0)  # removed (row moved)
        _price(cls.orig, cls.SRC, 1, 15, "D", "combined_rate", 550.0)  # removed (text changed)
        _price(cls.orig, cls.SRC, 1, 16, "D", "supply_rate", 600.0)    # no_rate_column

        # REVISION "Data Rev" v1 -- surviving rows KEEP their Excel positions (Amendment B's key),
        # rate MOVED to col E, NO supply column. Row 14's text reappears at row 20 (a MOVE) and
        # row 15 keeps its position with NEW text (a REWORD) -- neither may pair.
        cls.dest_sheet = _seed_sheet(cls.rev, cls.DEST, 1, 1,
            {"B": _DESC, "C": _UNIT, "E": _SCALAR_RATE}, [
                {"srn": 10, "node_type": "Line Item", "description": "Item A", "qty": 5.0},
                {"srn": 11, "node_type": "Line Item", "description": "Item B", "qty": 5.0},
                {"srn": 12, "node_type": "Preamble", "description": "Header"},
                {"srn": 15, "node_type": "Line Item", "description": "Item Reworded v2", "qty": 5.0},
                {"srn": 16, "node_type": "Line Item", "description": "Item NoCol", "qty": 5.0},
                {"srn": 20, "node_type": "Line Item", "description": "Item Moved", "qty": 5.0},
                {"srn": 99, "node_type": "Line Item", "description": "Brand New", "qty": 5.0},
            ])
        _stamp_provenance(cls.dest_sheet, cls.orig, cls.SRC)
        _price(cls.rev, cls.DEST, 1, 11, "E", "combined_rate", 999.0)  # dest already filled

        # A SECOND revision sheet with an amount column + NO formula -> formula gate fails.
        cls.amt_src_sheet = _seed_sheet(cls.orig, cls.AMT_SRC, 1, 1,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE}, [
                {"srn": 20, "node_type": "Line Item", "description": "Amt Item", "qty": 5.0},
            ], sheet_order=2)
        _price(cls.orig, cls.AMT_SRC, 1, 20, "D", "combined_rate", 700.0)
        cls.amt_dest_sheet = _seed_sheet(cls.rev, cls.AMT_DEST, 1, 1,
            {"B": _DESC, "C": _UNIT, "E": _SCALAR_RATE,
             "F": {"role": "amount_total", "area": None}}, [
                {"srn": 20, "node_type": "Line Item", "description": "Amt Item", "qty": 5.0},
            ], sheet_order=2)
        _stamp_provenance(cls.amt_dest_sheet, cls.orig, cls.AMT_SRC)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for boq in (cls.rev, cls.orig):
            for dt in (_PRICING, _LOCK_DT, "BOQ Nodes", _SHEET):
                frappe.db.delete(dt, {"boq": boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def setUp(self):
        # Reset the DEST writable state each test: drop carried cells (keep the seeded conflict),
        # clear locks + any Redis terminal payload.
        frappe.db.delete(_PRICING, {"boq": self.rev, "sheet_name": self.DEST})
        _price(self.rev, self.DEST, 1, 11, "E", "combined_rate", 999.0)
        frappe.db.delete(_LOCK_DT, {"boq": self.rev})
        frappe.cache().delete_value(cross_boq_carry._status_key(self.rev))
        cross_boq_carry._clear_marker(self.rev)
        frappe.db.commit()

    # ── helpers ──────────────────────────────────────────────────────────────────
    def _plan_by_dest(self, sheet=None):
        res = cross_boq_carry.get_cross_boq_carry_plan(dest_boq=self.rev)
        sheet = sheet or self.DEST
        rows = next(s for s in res["sheets"] if s["sheet_name"] == sheet)
        return rows, {r["source_excel_row"]: r for r in rows["plan"]}

    def _dest_rate(self, excel_row, col_letter="E"):
        return frappe.db.get_value(_PRICING, {
            "boq": self.rev, "sheet_name": self.DEST, "committed_version": 1,
            "excel_row": excel_row, "col_letter": col_letter, "is_current": 1, "is_filled": 1,
        }, "rate")

    # ── pair-aware version guard (the TDD seam) ─────────────────────────────────────
    def test_guard_rejects_same_boq_same_version(self):
        with self.assertRaises(frappe.ValidationError):
            pricing._assert_carry_versions_distinct("BOQ-A", 1, "BOQ-A", 1)

    def test_guard_accepts_cross_boq_same_version(self):
        # Two DIFFERENT BOQs both at v1 -- the commonest cross-BOQ case -> must NOT throw (D9).
        pricing._assert_carry_versions_distinct("BOQ-A", 1, "BOQ-B", 1)

    def test_guard_accepts_same_boq_different_version(self):
        pricing._assert_carry_versions_distinct("BOQ-A", 1, "BOQ-A", 2)

    # ── the plan: skip taxonomy + destination keying ────────────────────────────────
    def test_plan_clean_copy_reresolves_moved_column(self):
        _, by = self._plan_by_dest()
        r = by[10]
        self.assertEqual(r["outcome"], pricing._CF_CLEAN)
        self.assertEqual(r["dest_excel_row"], 10,
                         "Amendment B: a carried pair always shares its Excel row")
        self.assertEqual(r["target_col_letter"], "E", "rate column re-resolved after the move")
        self.assertNotEqual(r["target_col_letter"], "D", "source col_letter is never a write target")
        self.assertEqual(r["source_rate"], 100.0)

    def test_plan_conflict_carries_current_rate(self):
        _, by = self._plan_by_dest()
        r = by[11]
        self.assertEqual(r["outcome"], pricing._CF_CONFLICT)
        self.assertEqual(r["dest_excel_row"], 11)
        self.assertEqual(r["current_rate"], 999.0)

    def test_plan_unmatched_rows_all_report_removed(self):
        # Amendment B retired the ambiguity class: gone / moved / reworded are ONE reason now.
        _, by = self._plan_by_dest()
        self.assertEqual(by[13]["skip_reason"], "removed")  # absent from the revision
        self.assertEqual(by[14]["skip_reason"], "removed")  # same text, but the row MOVED
        self.assertEqual(by[15]["skip_reason"], "removed")  # same row, but the text CHANGED
        for srn in (13, 14, 15):
            self.assertEqual(by[srn]["outcome"], pricing._CF_SKIP)
            self.assertIsNone(by[srn]["dest_excel_row"])
            self.assertIsNone(by[srn]["target_col_letter"])

    def test_plan_non_priceable_and_no_rate_column(self):
        _, by = self._plan_by_dest()
        self.assertEqual(by[12]["skip_reason"], "non_priceable")  # dest Preamble, zero qty
        self.assertEqual(by[16]["skip_reason"], "no_rate_column")  # dest has no supply column
        self.assertIsNone(by[12]["target_col_letter"])
        self.assertIsNone(by[16]["target_col_letter"])

    def test_plan_new_rows_absent_but_counted(self):
        sheet, by = self._plan_by_dest()
        # "Brand New" (dest 99) is unmatched -> never in the source-driven plan.
        self.assertNotIn(99, {r["dest_excel_row"] for r in sheet["plan"]})
        # Unmatched AND priceable dest rows: 15 (reworded), 20 (moved), 99 (brand new).
        self.assertEqual(sheet["needs_new_value_count"], 3)

    def test_plan_counts(self):
        sheet, _ = self._plan_by_dest()
        self.assertEqual(sheet["counts"], {
            "clean": 1, "conflict": 1, "removed": 3,
            "no_rate_column": 1, "non_priceable": 1,
        })
        self.assertTrue(sheet["formulas_complete"])
        self.assertEqual(sheet["source_sheet_name"], self.SRC)

    def test_plan_endpoint_shape(self):
        res = cross_boq_carry.get_cross_boq_carry_plan(dest_boq=self.rev)
        self.assertEqual(res["source_boq"], self.orig)
        self.assertEqual({s["sheet_name"] for s in res["sheets"]}, {self.DEST, self.AMT_DEST})

    def test_require_revision_rejects_non_revision(self):
        with self.assertRaises(frappe.ValidationError):
            cross_boq_carry.get_cross_boq_carry_plan(dest_boq=self.orig)  # origin=upload

    def test_client_source_boq_mismatch_rejected(self):
        # An advisory source_boq that disagrees with BOQs.source_boq is rejected (identity never
        # trusted); the correct one (or none) passes.
        with self.assertRaises(frappe.ValidationError):
            cross_boq_carry.get_cross_boq_carry_plan(source_boq="NOT-THE-ORIGINAL", dest_boq=self.rev)
        res = cross_boq_carry.get_cross_boq_carry_plan(source_boq=self.orig, dest_boq=self.rev)
        self.assertEqual(res["source_boq"], self.orig)

    # ── apply (via the worker, called synchronously) ───────────────────────────────
    def test_worker_clean_and_overwrite(self):
        cross_boq_carry._carry_rates_worker(
            dest_boq=self.rev,
            decisions_by_sheet={self.DEST: [
                {"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"},
                {"dest_excel_row": 11, "area": None, "rate_kind": "combined_rate",
                 "overwrite": True},
            ]},
            user="Administrator",
        )
        self.assertEqual(self._dest_rate(10), 100.0, "clean copy landed at the re-resolved col E")
        self.assertEqual(self._dest_rate(11), 200.0, "conflict overwritten")
        self.assertIsNone(self._dest_rate(10, "D"), "nothing written at the source col_letter")
        term = cross_boq_carry.get_cross_boq_carry_status(dest_boq=self.rev)
        self.assertEqual(term["state"], "done")
        self.assertEqual(term["carried"], 2)
        self.assertEqual(term["failed"], [])

    def test_worker_conflict_kept_by_default(self):
        cross_boq_carry._carry_rates_worker(
            dest_boq=self.rev,
            decisions_by_sheet={self.DEST: [
                {"dest_excel_row": 11, "area": None, "rate_kind": "combined_rate"},  # no overwrite
            ]},
            user="Administrator",
        )
        self.assertEqual(self._dest_rate(11), 999.0, "conflict kept -> existing rate untouched")
        term = cross_boq_carry.get_cross_boq_carry_status(dest_boq=self.rev)
        self.assertEqual(term["carried"], 0)
        self.assertEqual(term["conflicts_kept"], 1)

    def test_worker_never_trusts_a_crafted_skip_decision(self):
        # A crafted POST for a server-classified SKIP (non_priceable / no_rate_column) writes NOTHING.
        cross_boq_carry._carry_rates_worker(
            dest_boq=self.rev,
            decisions_by_sheet={self.DEST: [
                {"dest_excel_row": 12, "area": None, "rate_kind": "combined_rate"},   # non_priceable
                {"dest_excel_row": 16, "area": None, "rate_kind": "supply_rate"},     # no_rate_column
                {"dest_excel_row": 99999, "area": None, "rate_kind": "combined_rate"}, # invalid
            ]},
            user="Administrator",
        )
        self.assertIsNone(self._dest_rate(12))
        self.assertIsNone(self._dest_rate(16))
        term = cross_boq_carry.get_cross_boq_carry_status(dest_boq=self.rev)
        self.assertEqual(term["carried"], 0)
        self.assertEqual(term["skipped"]["non_priceable"], 1)
        self.assertEqual(term["skipped"]["no_rate_column"], 1)
        self.assertEqual(term["skipped"]["invalid"], 1)

    def test_worker_per_sheet_isolation_formula_gate(self):
        # "Amt Rev" has an amount column with no formula -> it fails ISOLATED; "Data Rev" carries.
        cross_boq_carry._carry_rates_worker(
            dest_boq=self.rev,
            decisions_by_sheet={
                self.DEST: [{"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"}],
                self.AMT_DEST: [{"dest_excel_row": 20, "area": None, "rate_kind": "combined_rate"}],
            },
            user="Administrator",
        )
        self.assertEqual(self._dest_rate(10), 100.0, "the good sheet carried despite the bad one")
        term = cross_boq_carry.get_cross_boq_carry_status(dest_boq=self.rev)
        self.assertEqual(term["carried"], 1)
        self.assertEqual(term["failed"], [{"sheet_name": self.AMT_DEST,
                                           "reason": "formulas_incomplete"}])
        # Nothing was written on the failed sheet.
        self.assertIsNone(frappe.db.get_value(_PRICING, {
            "boq": self.rev, "sheet_name": self.AMT_DEST, "is_current": 1, "is_filled": 1}, "name"))

    def test_apply_sheet_fails_on_held_single_editor_lock(self):
        # Another user holds the single-editor lock on "Data Rev" -> this carry fails isolated.
        # (Lock "Locked By" is a User Link -> use two REAL users: Administrator holds, Guest tries.)
        acquire_or_refresh(self.rev, self.DEST, 1, "Administrator", frappe.utils.now_datetime())
        frappe.db.commit()
        ctx = cross_boq_carry._resolve_sheet_carry(
            self.rev,
            frappe.db.get_value(_SHEET, self.dest_sheet,
                                ["name", "sheet_name", "commit_version",
                                 "source_boq", "source_sheet_name"], as_dict=True),
        )
        summary, reason = cross_boq_carry._apply_sheet_carry(
            ctx, [{"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"}],
            "Guest")
        self.assertIsNone(summary)
        self.assertEqual(reason, "locked")
        self.assertIsNone(self._dest_rate(10), "a rejected carry mutates nothing")


class TestCrossVersionSourcePricing(FrappeTestCase):
    """W6 / ADR-0014 A10 -- the SOURCE rate read must follow `is_current`, not a version pin.

    ⚠️ This class exists because the suite above is green ONLY because its fixture is
    same-version (source sheet v1, pricing at committed_version 1), which is exactly why it
    could not see the defect. Here the source sheet's CURRENT committed version is 2 while its
    pricing still sits on the now-frozen version 1 -- the shape a re-commit leaves behind
    (`commit_pipeline`'s BOQ_DOWNSTREAM_ORPHAN guard warns about it but never migrates it).

    Live-observed on BOQ-26-00023 / sheet 'LMS ': the mapping screen promised rates and the
    carry landed zero. Do NOT "simplify" this fixture back to one version.
    """

    SRC = "CV"
    DEST = "CV Rev"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.orig = _make_boq(cls.project.name, origin="upload", boq_name="CROSSVER ORIG").name
        cls.rev = _make_revision(cls.project.name, cls.orig).name

        # The ORIGINAL was committed twice: v1 is frozen, v2 is current. Structure reads v2.
        _seed_sheet(cls.orig, cls.SRC, 1, 0,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE}, [
                {"srn": 10, "node_type": "Line Item", "description": "Item A", "qty": 5.0},
            ])
        cls.src_sheet = _seed_sheet(cls.orig, cls.SRC, 2, 1,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE}, [
                {"srn": 10, "node_type": "Line Item", "description": "Item A", "qty": 5.0},
                {"srn": 11, "node_type": "Line Item", "description": "Item B", "qty": 5.0},
            ])
        # ...but the human priced BEFORE that re-commit, so the rates are ORPHANED on v1.
        _price(cls.orig, cls.SRC, 1, 10, "D", "combined_rate", 100.0)
        # Row 11 was priced on v1 AND re-priced after the re-commit -> two current rows, one cell.
        _price(cls.orig, cls.SRC, 1, 11, "D", "combined_rate", 200.0)
        _price(cls.orig, cls.SRC, 2, 11, "D", "combined_rate", 250.0)

        cls.dest_sheet = _seed_sheet(cls.rev, cls.DEST, 1, 1,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE}, [
                {"srn": 10, "node_type": "Line Item", "description": "Item A", "qty": 5.0},
                {"srn": 11, "node_type": "Line Item", "description": "Item B", "qty": 5.0},
            ])
        _stamp_provenance(cls.dest_sheet, cls.orig, cls.SRC, source_version=2)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for boq in (cls.rev, cls.orig):
            for dt in (_PRICING, _LOCK_DT, "BOQ Nodes", _SHEET):
                frappe.db.delete(dt, {"boq": boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def _plan(self):
        res = cross_boq_carry.get_cross_boq_carry_plan(dest_boq=self.rev)
        sheet = next(s for s in res["sheets"] if s["sheet_name"] == self.DEST)
        return sheet, {r["source_excel_row"]: r for r in sheet["plan"]}

    def test_source_sheet_resolves_to_its_current_committed_version(self):
        # Structure stays per-commit: the carry context points at v2, the CURRENT sheet.
        sheet, _ = self._plan()
        self.assertEqual(sheet["source_version"], 2)

    def test_fixture_is_genuinely_cross_version(self):
        """Guards the guard. If someone "simplifies" this fixture to one version, the tests below
        would keep passing while testing nothing -- so pin the precondition explicitly: the
        version-PINNED read (the old source read) sees NOTHING at the sheet's current version
        for row 10, and the cross-version read sees it."""
        pinned = pricing.get_sheet_pricing(
            boq_name=self.orig, sheet_name=self.SRC, committed_version=2
        )["pricing"]
        self.assertNotIn(10, [p["excel_row"] for p in pinned])
        across = pricing.current_sheet_pricing_any_version(self.orig, self.SRC)
        self.assertIn(10, [p["excel_row"] for p in across])

    def test_rate_orphaned_on_a_frozen_version_still_carries(self):
        """THE defect. Under a version-pinned source read this row is invisible and the plan is
        empty; the mapping screen still promised it."""
        _, by_src = self._plan()
        self.assertIn(10, by_src, "an orphaned v1 rate must still be carryable")
        self.assertEqual(by_src[10]["outcome"], pricing._CF_CLEAN)
        self.assertEqual(by_src[10]["source_rate"], 100.0)
        self.assertEqual(by_src[10]["dest_excel_row"], 10)

    def test_cell_current_on_two_versions_carries_once_at_the_newest(self):
        """`is_current` is scoped per committed version, so one cell can hold two current rows.
        Highest committed_version wins -- the latest human pricing work, counted once."""
        _, by_src = self._plan()
        rows_for_11 = [r for r in self._plan()[0]["plan"] if r["source_excel_row"] == 11]
        self.assertEqual(len(rows_for_11), 1, "one cell must not produce two plan rows")
        self.assertEqual(by_src[11]["source_rate"], 250.0)

    def test_current_committed_version_beats_a_higher_stranded_one(self):
        """The dedup is anchored to the committed SHEET (`is_current=1`), not to
        `MAX(committed_version)`. The two only agree while nothing has been superseded.

        Here the live sheet is v2 but a pricing row is stranded on v3 (a commit that was later
        rolled back / superseded, so its `BoQ Sheet` is no longer current). A bare max would
        carry the v3 rate -- a number NOBODY can see on the current sheet. Anchoring makes the
        visible v2 price win."""
        _price(self.orig, self.SRC, 3, 50, "D", "combined_rate", 999.0)   # stranded ABOVE current
        _price(self.orig, self.SRC, 2, 50, "D", "combined_rate", 222.0)   # the visible one
        frappe.db.commit()
        try:
            picked = {
                (p["excel_row"], p["col_letter"]): p
                for p in pricing.current_sheet_pricing_any_version(self.orig, self.SRC)
            }[(50, "D")]
            self.assertEqual(picked["committed_version"], 2)
            self.assertEqual(picked["rate"], 222.0, "the price on the CURRENT sheet wins")
        finally:
            frappe.db.delete(_PRICING, {"boq": self.orig, "sheet_name": self.SRC,
                                        "excel_row": 50})
            frappe.db.commit()

    def test_falls_back_to_highest_version_when_no_current_sheet_row(self):
        """Degrade path: with no `is_current=1` BoQ Sheet to anchor to, the newest stranded work
        is still the best available answer -- it must not return nothing."""
        rows = pricing.current_sheet_pricing_any_version(
            self.orig, self.SRC, current_version=None
        )
        by_row = {p["excel_row"]: p for p in rows}
        # Row 11 is priced on BOTH v1 (200) and v2 (250) -> highest wins in the degrade path too.
        self.assertEqual(by_row[11]["rate"], 250.0)

    def test_plan_row_reports_the_version_the_rate_actually_lives_on(self):
        # Honest provenance: the sheet is at v2 but this rate came from v1.
        _, by_src = self._plan()
        self.assertEqual(by_src[10]["source_version"], 1)
        self.assertEqual(by_src[11]["source_version"], 2)

    def test_counts_see_both_carryable_rates(self):
        sheet, _ = self._plan()
        self.assertEqual(sheet["counts"]["clean"], 2)


class TestOrphanedFormulaBlocksTheRateCarry(FrappeTestCase):
    """⚠️ W6 FOLLOW-UP: does the un-fixed FORMULA orphaning defeat the fixed RATE carry?

    W6 made the source RATE read cross-version, but deliberately left `committed_carry`'s five
    overlay layers version-pinned (A10 scoped the owner's call to rates). `BoQ Cell Amount
    Formula` carries `committed_version` + `is_current` exactly like `BoQ Cell Pricing`, so the
    SAME re-commit that orphans the rates orphans the formulas.

    The objection to this concern is that a rate can only be entered once a formula is declared
    (the mandatory amount-formula gate), so a priced source ALWAYS has formulas. That is true and
    is not a rebuttal: the formulas exist, they are just stranded on the same frozen version the
    rates were, so the version-pinned formula carry copies none of them forward.

    This class walks the whole chain on ONE fixture and asserts each link, so the answer is
    measured rather than argued -- and so that if the owner later widens the formula carry, the
    exact assertions that must flip are written down.
    """

    SRC = "FX"
    DEST = "FX Rev"
    _AMOUNT = {"role": "amount_total", "area": None}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.orig = _make_boq(cls.project.name, origin="upload", boq_name="FORMULA ORIG").name
        cls.rev = _make_revision(cls.project.name, cls.orig).name

        role_map = {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE, "F": cls._AMOUNT}
        nodes = [{"srn": 10, "node_type": "Line Item", "description": "Item A", "qty": 5.0}]

        # The ORIGINAL was committed twice: v1 frozen, v2 current.
        _seed_sheet(cls.orig, cls.SRC, 1, 0, role_map, nodes)
        cls.src_sheet = _seed_sheet(cls.orig, cls.SRC, 2, 1, role_map, nodes)

        # The human worked on v1: declared the amount formula, THEN priced (the gate's order).
        # The re-commit to v2 stranded BOTH on v1.
        _formula(cls.orig, cls.SRC, 1, "F")
        _price(cls.orig, cls.SRC, 1, 10, "D", "combined_rate", 100.0)

        # The REVISION's committed sheet: same shape, no formulas of its own (a fresh commit
        # declares none -- they were supposed to arrive via the overlay carry).
        cls.dest_sheet = _seed_sheet(cls.rev, cls.DEST, 1, 1, role_map, nodes)
        _stamp_provenance(cls.dest_sheet, cls.orig, cls.SRC, source_version=2)
        # `carry_commit_overlay` resolves its source through the DRAFT pointer
        # (`BoQ Sheet Draft.source_sheet_name`), not the committed stamp -- unlike
        # `cross_boq_carry._resolve_sheet_carry`, which falls back to it. Seed the mapped draft
        # the way `confirm_revision_mapping` would, or the carry no-ops as "declared New".
        rev_doc = frappe.get_doc("BOQs", cls.rev)
        rev_doc.append("sheet_drafts", {
            "sheet_name": cls.DEST, "sheet_order": 1,
            "wizard_status": "Pending", "source_sheet_name": cls.SRC,
        })
        rev_doc.save(ignore_permissions=True)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for boq in (cls.rev, cls.orig):
            for dt in (_PRICING, _LOCK_DT, "BOQ Nodes", _SHEET, "BoQ Cell Amount Formula"):
                frappe.db.delete(dt, {"boq": boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    # ── link 1: the source DOES have a formula, just not on its current version ──────
    def test_source_formula_exists_but_is_stranded_on_the_frozen_version(self):
        """Pins the rebuttal precisely: the formula was declared (it had to be, or the rate
        could not have been entered) -- it is simply not visible at the current version."""
        self.assertEqual(
            len(pricing._current_formula_records(self.orig, self.SRC, 1)), 1,
            "the formula the human declared is still there, on v1",
        )
        self.assertEqual(
            pricing._current_formula_records(self.orig, self.SRC, 2), [],
            "...and the version-pinned read the overlay carry performs sees NOTHING",
        )

    # ── link 2: W6 works -- the rate itself is found ─────────────────────────────────
    def test_the_rate_is_found_because_w6_reads_cross_version(self):
        found = pricing.current_sheet_pricing_any_version(self.orig, self.SRC)
        self.assertEqual([p["excel_row"] for p in found if p["is_filled"]], [10])

    # ── link 3: the formula carry copies nothing forward ─────────────────────────────
    def test_overlay_carry_copies_no_formula_forward(self):
        summary = committed_carry.carry_commit_overlay(
            self.rev, self.DEST, 1, self.dest_sheet,
            [{"row_number": 10, "cells": {"B": "Item A", "F": 500}}],
        )
        frappe.db.commit()
        self.assertEqual(summary["provenance"], 1, "this IS a revision sheet")
        self.assertEqual(
            summary["formulas"], 0,
            "the stranded v1 formula does not carry -- the layer is still version-pinned",
        )

    # ── link 4: the revision is therefore not formula-complete ───────────────────────
    def test_revision_sheet_is_not_formula_complete(self):
        self.assertFalse(
            pricing._sheet_formulas_complete(self.rev, self.DEST, 1),
            "an amount column with no covering formula -> the mandatory gate fails closed",
        )

    # ── link 5: THE ANSWER -- the rate carry is refused despite having the rate ──────
    def test_rate_carry_is_refused_even_though_w6_found_the_rate(self):
        """The concern, confirmed end to end: W6 fixed the read, and the sheet still carries
        nothing, because the gate the formula carry was supposed to satisfy fails closed.

        If the owner widens the formula carry cross-version, THIS is the assertion that flips
        (to a successful summary) -- and `test_overlay_carry_copies_no_formula_forward` flips
        with it. Both are deliberate, not incidental."""
        ctx = cross_boq_carry._resolve_sheet_carry(
            self.rev,
            frappe.db.get_value(_SHEET, self.dest_sheet,
                                ["name", "sheet_name", "commit_version",
                                 "source_boq", "source_sheet_name"], as_dict=True),
        )
        plan = cross_boq_carry._classify_carry(
            ctx, cross_boq_carry.committed_excel_row_match(
                ctx.source_boq, ctx.source_sheet_docname, ctx.dest_boq, ctx.dest_sheet_docname
            ),
        )
        self.assertEqual(
            [r["outcome"] for r in plan], [pricing._CF_CLEAN],
            "the PLAN is healthy -- W6 resolved the rate to a clean copy",
        )
        summary, reason = cross_boq_carry._apply_sheet_carry(
            ctx, [{"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"}],
            "Administrator",
        )
        self.assertIsNone(summary)
        self.assertEqual(reason, "formulas_incomplete")
        self.assertIsNone(
            frappe.db.get_value(_PRICING, {
                "boq": self.rev, "sheet_name": self.DEST, "is_current": 1, "is_filled": 1,
            }, "name"),
            "and so the revision receives NO rate at all",
        )
