# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""S7a / plan-slice S9 (#1105, ADR-0014 D9) -- cross-BOQ RATE carry backend.

Exercises `cross_boq_carry`: a source-driven, destination-keyed, per-cell carry plan across TWO
BOQs (an original + its revision), and a long-job worker with per-sheet failure isolation.

The rich fixture: an ORIGINAL committed sheet "Data" v1 with priced cells crafted to hit EVERY
plan outcome, and a REVISION committed sheet "Data Rev" (a RENAME) whose rows are SHIFTED +100
(proving the dest Excel row differs from the source's) with a column MOVE (rate D -> E, proving
`(area, rate_kind)` re-resolution + that the source col_letter is never a write target). A second
tiny "Amt Rev" sheet (an amount column, no formula) drives the per-sheet formula-gate isolation.

  source row  desc            priced          dest twin  -> outcome
    10        Item A          combined 100      110         clean copy
    11        Item B          combined 200      111 (filled) conflict
    12        Header (Pre)    combined 300      112          non_priceable
    13        Item Removed    combined 400      (none)       removed
    14/15     Dup (x2)        combined 500/550  114 (x1)     ambiguous (N=2, M=1)
    16        Item NoCol      supply   600      116          no_rate_column (dest has no supply col)
    (dest 199 Brand New = NEW -> not in the plan; needs_new_value_count = 1)
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import cross_boq_carry, pricing
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
                {"srn": 14, "node_type": "Line Item", "description": "Dup", "qty": 5.0},
                {"srn": 15, "node_type": "Line Item", "description": "Dup", "qty": 5.0},
                {"srn": 16, "node_type": "Line Item", "description": "Item NoCol", "qty": 5.0},
            ])
        _price(cls.orig, cls.SRC, 1, 10, "D", "combined_rate", 100.0)  # clean
        _price(cls.orig, cls.SRC, 1, 11, "D", "combined_rate", 200.0)  # conflict
        _price(cls.orig, cls.SRC, 1, 12, "D", "combined_rate", 300.0)  # non_priceable
        _price(cls.orig, cls.SRC, 1, 13, "D", "combined_rate", 400.0)  # removed
        _price(cls.orig, cls.SRC, 1, 14, "D", "combined_rate", 500.0)  # ambiguous
        _price(cls.orig, cls.SRC, 1, 15, "D", "combined_rate", 550.0)  # ambiguous
        _price(cls.orig, cls.SRC, 1, 16, "D", "supply_rate", 600.0)    # no_rate_column

        # REVISION "Data Rev" v1 -- rows shifted +100, rate MOVED to col E, NO supply column.
        cls.dest_sheet = _seed_sheet(cls.rev, cls.DEST, 1, 1,
            {"B": _DESC, "C": _UNIT, "E": _SCALAR_RATE}, [
                {"srn": 110, "node_type": "Line Item", "description": "Item A", "qty": 5.0},
                {"srn": 111, "node_type": "Line Item", "description": "Item B", "qty": 5.0},
                {"srn": 112, "node_type": "Preamble", "description": "Header"},
                {"srn": 114, "node_type": "Line Item", "description": "Dup", "qty": 5.0},
                {"srn": 116, "node_type": "Line Item", "description": "Item NoCol", "qty": 5.0},
                {"srn": 199, "node_type": "Line Item", "description": "Brand New", "qty": 5.0},
            ])
        _stamp_provenance(cls.dest_sheet, cls.orig, cls.SRC)
        _price(cls.rev, cls.DEST, 1, 111, "E", "combined_rate", 999.0)  # dest already filled

        # A SECOND revision sheet with an amount column + NO formula -> formula gate fails.
        cls.amt_src_sheet = _seed_sheet(cls.orig, cls.AMT_SRC, 1, 1,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE}, [
                {"srn": 20, "node_type": "Line Item", "description": "Amt Item", "qty": 5.0},
            ], sheet_order=2)
        _price(cls.orig, cls.AMT_SRC, 1, 20, "D", "combined_rate", 700.0)
        cls.amt_dest_sheet = _seed_sheet(cls.rev, cls.AMT_DEST, 1, 1,
            {"B": _DESC, "C": _UNIT, "E": _SCALAR_RATE,
             "F": {"role": "amount_total", "area": None}}, [
                {"srn": 120, "node_type": "Line Item", "description": "Amt Item", "qty": 5.0},
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
        _price(self.rev, self.DEST, 1, 111, "E", "combined_rate", 999.0)
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
        self.assertEqual(r["dest_excel_row"], 110, "dest row differs from source (D6 remap)")
        self.assertEqual(r["target_col_letter"], "E", "rate column re-resolved after the move")
        self.assertNotEqual(r["target_col_letter"], "D", "source col_letter is never a write target")
        self.assertEqual(r["source_rate"], 100.0)

    def test_plan_conflict_carries_current_rate(self):
        _, by = self._plan_by_dest()
        r = by[11]
        self.assertEqual(r["outcome"], pricing._CF_CONFLICT)
        self.assertEqual(r["dest_excel_row"], 111)
        self.assertEqual(r["current_rate"], 999.0)

    def test_plan_removed_and_ambiguous_split(self):
        _, by = self._plan_by_dest()
        self.assertEqual(by[13]["skip_reason"], "removed")     # no twin, D6 REMOVED
        self.assertEqual(by[14]["skip_reason"], "ambiguous")   # dup cluster, D6 AMBIGUOUS
        self.assertEqual(by[15]["skip_reason"], "ambiguous")
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
        # "Brand New" (dest 199) is a NEW row -> never in the source-driven plan.
        self.assertNotIn(199, {r["dest_excel_row"] for r in sheet["plan"]})
        self.assertEqual(sheet["needs_new_value_count"], 1)

    def test_plan_counts(self):
        sheet, _ = self._plan_by_dest()
        self.assertEqual(sheet["counts"], {
            "clean": 1, "conflict": 1, "removed": 1, "ambiguous": 2,
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
                {"dest_excel_row": 110, "area": None, "rate_kind": "combined_rate"},
                {"dest_excel_row": 111, "area": None, "rate_kind": "combined_rate",
                 "overwrite": True},
            ]},
            user="Administrator",
        )
        self.assertEqual(self._dest_rate(110), 100.0, "clean copy landed at the re-resolved col E")
        self.assertEqual(self._dest_rate(111), 200.0, "conflict overwritten")
        self.assertIsNone(self._dest_rate(110, "D"), "nothing written at the source col_letter")
        term = cross_boq_carry.get_cross_boq_carry_status(dest_boq=self.rev)
        self.assertEqual(term["state"], "done")
        self.assertEqual(term["carried"], 2)
        self.assertEqual(term["failed"], [])

    def test_worker_conflict_kept_by_default(self):
        cross_boq_carry._carry_rates_worker(
            dest_boq=self.rev,
            decisions_by_sheet={self.DEST: [
                {"dest_excel_row": 111, "area": None, "rate_kind": "combined_rate"},  # no overwrite
            ]},
            user="Administrator",
        )
        self.assertEqual(self._dest_rate(111), 999.0, "conflict kept -> existing rate untouched")
        term = cross_boq_carry.get_cross_boq_carry_status(dest_boq=self.rev)
        self.assertEqual(term["carried"], 0)
        self.assertEqual(term["conflicts_kept"], 1)

    def test_worker_never_trusts_a_crafted_skip_decision(self):
        # A crafted POST for a server-classified SKIP (non_priceable / no_rate_column) writes NOTHING.
        cross_boq_carry._carry_rates_worker(
            dest_boq=self.rev,
            decisions_by_sheet={self.DEST: [
                {"dest_excel_row": 112, "area": None, "rate_kind": "combined_rate"},   # non_priceable
                {"dest_excel_row": 116, "area": None, "rate_kind": "supply_rate"},     # no_rate_column
                {"dest_excel_row": 99999, "area": None, "rate_kind": "combined_rate"}, # invalid
            ]},
            user="Administrator",
        )
        self.assertIsNone(self._dest_rate(112))
        self.assertIsNone(self._dest_rate(116))
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
                self.DEST: [{"dest_excel_row": 110, "area": None, "rate_kind": "combined_rate"}],
                self.AMT_DEST: [{"dest_excel_row": 120, "area": None, "rate_kind": "combined_rate"}],
            },
            user="Administrator",
        )
        self.assertEqual(self._dest_rate(110), 100.0, "the good sheet carried despite the bad one")
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
            ctx, [{"dest_excel_row": 110, "area": None, "rate_kind": "combined_rate"}],
            "Guest")
        self.assertIsNone(summary)
        self.assertEqual(reason, "locked")
        self.assertIsNone(self._dest_rate(110), "a rejected carry mutates nothing")
