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
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import committed_carry, cross_boq_carry, pricing
from nirmaan_stack.api.boq.wizard.pricing_lock import acquire_or_refresh
from nirmaan_stack.services.boq_category import persist
from nirmaan_stack.api.boq.wizard.test_revision_entry import (
    _cleanup_project,
    _make_boq,
    _make_project,
)
from nirmaan_stack.api.boq.wizard.test_revision_mapping import _make_revision
# Slice G2c: reuse the SAVE-path fixture categoriser (ONE source of truth for "categorise the
# rate-editable rows through the live persist path"), rather than mirroring it here -- the dest of a
# carry must satisfy the same category gate a save does, so the same helper applies.
from nirmaan_stack.api.boq.wizard.test_pricing import _categorise_fixture_eligible_rows

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
        # Slice G2c: the DESTINATION now governs the category gate on apply. Categorise the dest's
        # rate-editable rows (through the live persist path, never the override -- owner ruling) so
        # the apply/lock tests below reach the behaviour they assert instead of a category block.
        # The dedicated gate coverage is TestCrossBoqCarryCategoryGate. (The "Amt Rev" formula-gate
        # sheet is deliberately NOT categorised -- the formula gate must fire before the category
        # gate there.)
        _categorise_fixture_eligible_rows(cls.rev, cls.DEST, 1)

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
            for dt in (_PRICING, _LOCK_DT, "BoQ Row Category", "BOQ Nodes", _SHEET):
                frappe.db.delete(dt, {"boq": boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def setUp(self):
        # Reset the DEST writable state each test: drop carried cells (keep the seeded conflict)
        # and clear locks. AMENDMENT C (C6): there is no Redis marker to clear any more -- the
        # long job it belonged to is gone.
        frappe.db.delete(_PRICING, {"boq": self.rev, "sheet_name": self.DEST})
        _price(self.rev, self.DEST, 1, 11, "E", "combined_rate", 999.0)
        frappe.db.delete(_LOCK_DT, {"boq": self.rev})
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

    # ── apply (AMENDMENT C: per-sheet is the unit of work) ────────────────────────
    # These four properties were covered THROUGH the whole-BoQ worker (`_carry_rates_worker`),
    # which C6 removed along with the hub action. The per-sheet failure isolation it provided IS
    # the new unit of work, so they are asserted directly on `_apply_sheet_carry` -- same
    # properties, one less layer of indirection.
    def _ctx(self, sheet_docname):
        return cross_boq_carry._resolve_sheet_carry(
            self.rev,
            frappe.db.get_value(_SHEET, sheet_docname,
                                ["name", "sheet_name", "commit_version",
                                 "source_boq", "source_sheet_name"], as_dict=True),
        )

    def test_apply_clean_and_overwrite(self):
        summary, reason = cross_boq_carry._apply_sheet_carry(
            self._ctx(self.dest_sheet),
            [{"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"},
             {"dest_excel_row": 11, "area": None, "rate_kind": "combined_rate", "overwrite": True}],
            "Administrator",
        )
        self.assertIsNone(reason)
        self.assertEqual(summary["copied"], 1)
        self.assertEqual(summary["conflicts_overwritten"], 1)
        self.assertEqual(self._dest_rate(10), 100.0)
        self.assertEqual(self._dest_rate(11), 200.0)

    def test_apply_keeps_a_conflict_by_default(self):
        summary, reason = cross_boq_carry._apply_sheet_carry(
            self._ctx(self.dest_sheet),
            [{"dest_excel_row": 11, "area": None, "rate_kind": "combined_rate"}],
            "Administrator",
        )
        self.assertIsNone(reason)
        self.assertEqual(summary["conflicts_kept"], 1)
        self.assertEqual(self._dest_rate(11), 999.0, "the dest rate is untouched")

    def test_apply_never_writes_a_hard_skip(self):
        """A crafted decision naming an outcome-1 cell is counted and NEVER written -- the server
        re-derives the plan, so the client cannot promote a skip."""
        summary, reason = cross_boq_carry._apply_sheet_carry(
            self._ctx(self.dest_sheet),
            [{"dest_excel_row": 12, "area": None, "rate_kind": "combined_rate"}],
            "Administrator",
        )
        self.assertIsNone(reason)
        self.assertEqual(summary["skipped"]["non_priceable"], 1)
        self.assertEqual(summary["copied"], 0)

    def test_apply_blocks_a_sheet_whose_formulas_are_incomplete(self):
        """"Amt Rev" has an amount column with no covering formula -> the mandatory gate refuses
        the WHOLE apply and writes nothing."""
        summary, reason = cross_boq_carry._apply_sheet_carry(
            self._ctx(self.amt_dest_sheet),
            [{"dest_excel_row": 20, "area": None, "rate_kind": "combined_rate"}],
            "Administrator",
        )
        self.assertIsNone(summary)
        self.assertEqual(reason, "formulas_incomplete")
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
    """AMENDMENT C (2026-07-23) -- the SOURCE rate read is VERSION-PINNED, reversing W6/A10.

    Owner's rule: once a revision exists the original is not edited further, so its CURRENT
    committed version is its final state and the carry moves exactly what a user looking at the
    original can see. Rates and structure are symmetric again.

    ⚠️ This class was written for W6 to prove the OPPOSITE (an orphaned rate must still carry).
    The fixture is kept EXACTLY as it was -- the source sheet's current committed version is 2
    while some pricing still sits on the frozen v1, the shape a re-commit leaves behind
    (`commit_pipeline`'s BOQ_DOWNSTREAM_ORPHAN guard warns about it but never migrates it) --
    and only the ASSERTIONS are inverted, so the behaviour change is legible in one diff and the
    cost of the ruling stays measured rather than argued.

    THE ACCEPTED COST, pinned below: a rate entered BEFORE the original's last re-commit does NOT
    carry. Live-observed shape: BOQ-26-00023 / sheet 'LMS '. It is now VISIBLE rather than silent
    -- `revision._carry_counts` is pinned identically, so the mapping screen promises zero and the
    carry lands zero. Do NOT "simplify" this fixture back to one version.
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
        """Guards the guard. If someone "simplifies" this fixture to one version the tests below
        would keep passing while testing nothing, so pin the precondition explicitly: row 10's
        rate is NOT visible at the sheet's current committed version (it is stranded on v1), and
        row 11's IS. Everything below follows from that."""
        pinned_rows = [
            p["excel_row"]
            for p in pricing.get_sheet_pricing(
                boq_name=self.orig, sheet_name=self.SRC, committed_version=2
            )["pricing"]
        ]
        self.assertNotIn(10, pinned_rows, "row 10 must be stranded on the frozen v1")
        self.assertIn(11, pinned_rows, "row 11 must be live on the current v2")

    def test_rate_orphaned_on_a_frozen_version_does_not_carry(self):
        """THE ACCEPTED COST of Amendment C's pin (this assertion is W6's, inverted). A rate
        entered before the original's last re-commit is stranded on the frozen version, is not
        visible on the original's current sheet, and therefore does not carry."""
        _, by_src = self._plan()
        self.assertNotIn(10, by_src, "a rate stranded on a frozen version must not carry")

    def test_the_count_promises_exactly_what_the_carry_lands(self):
        """The invariant W6 established, preserved through the reversal: BOTH sides moved to the
        pinned read together. The mapping screen must never promise a rate the carry cannot land
        -- that divergence IS the defect W6 was written for."""
        from nirmaan_stack.api.boq.wizard import revision as revision_api

        counted = revision_api._carry_counts(self.orig, [self.SRC])["rates"]
        sheet, _ = self._plan()
        carryable = sheet["counts"]["clean"] + sheet["counts"]["conflict"]
        self.assertEqual(counted, 1, "only row 11's live v2 rate is countable")
        self.assertEqual(carryable, counted)

    def test_cell_current_on_two_versions_carries_once_at_the_current_version(self):
        """`is_current` is scoped per committed version, so one cell can hold two current rows.
        The pinned read sees only the CURRENT sheet version's row -- one plan entry, at the price
        a user looking at the original actually sees."""
        _, by_src = self._plan()
        rows_for_11 = [r for r in self._plan()[0]["plan"] if r["source_excel_row"] == 11]
        self.assertEqual(len(rows_for_11), 1, "one cell must not produce two plan rows")
        self.assertEqual(by_src[11]["source_rate"], 250.0)
        self.assertEqual(by_src[11]["source_version"], 2)

    def test_a_rate_stranded_ABOVE_the_current_version_never_carries(self):
        """A pricing row on a version HIGHER than the current sheet (a commit later rolled back or
        superseded) is not visible on the current sheet either, so the pin excludes it too. W6's
        reader had to rank these explicitly; pinning makes the question disappear."""
        _price(self.orig, self.SRC, 3, 50, "D", "combined_rate", 999.0)   # stranded ABOVE current
        _price(self.orig, self.SRC, 2, 50, "D", "combined_rate", 222.0)   # the visible one
        frappe.db.commit()
        try:
            _, by_src = self._plan()
            # The plan is SOURCE-driven, so row 50 appears -- as a hard skip, because the dest has
            # no such row. The load-bearing assertion is WHICH rate it was read from: the visible
            # v2 price (222), never the v3 row stranded ABOVE the current sheet (999).
            self.assertEqual(by_src[50]["source_rate"], 222.0, "the v2 price is the visible one")
            self.assertEqual(by_src[50]["source_version"], 2)
            self.assertEqual(by_src[50]["outcome"], pricing._CF_SKIP)
            self.assertEqual(by_src[50]["skip_reason"], "removed")
        finally:
            frappe.db.delete(_PRICING, {"boq": self.orig, "sheet_name": self.SRC,
                                        "excel_row": 50})
            frappe.db.commit()

    def test_plan_row_reports_the_version_the_rate_actually_lives_on(self):
        # Under the pin every carried rate lives on the sheet's current committed version.
        _, by_src = self._plan()
        self.assertEqual(by_src[11]["source_version"], 2)

    def test_counts_see_only_the_rate_live_on_the_current_version(self):
        sheet, _ = self._plan()
        self.assertEqual(sheet["counts"]["clean"], 1)


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

    # ── link 2: under Amendment C's pin the rate is not found either ─────────────────
    def test_the_rate_is_stranded_too_now_that_the_read_is_pinned(self):
        """W6 made this read cross-version so the stranded rate WAS found; Amendment C pinned it
        back (owner-directed, 2026-07-23), so the rate is stranded exactly like its formula. The
        chain below is unchanged -- the carry is refused -- but link 5's reason is now "there is
        no rate to carry" as well as "the formulas are incomplete"."""
        found = pricing.get_sheet_pricing(
            boq_name=self.orig, sheet_name=self.SRC, committed_version=2
        )["pricing"]
        self.assertEqual([p["excel_row"] for p in found if p["is_filled"]], [])

    # ── link 3: the commit copies no formula forward ─────────────────────────────────
    def test_commit_copies_no_formula_forward(self):
        """Under AMENDMENT C (C5) the commit carries NOTHING but provenance, so this link holds
        for a stronger reason than before: it is not that the stranded v1 formula failed to
        re-resolve, it is that no formula carries at all."""
        provenance = committed_carry.stamp_revision_provenance(
            self.rev, self.DEST, self.dest_sheet
        )
        frappe.db.commit()
        self.assertEqual(provenance, 1, "this IS a revision sheet -- the stamp still lands")
        self.assertEqual(
            frappe.get_all("BoQ Cell Amount Formula",
                           filters={"boq": self.rev, "sheet_name": self.DEST, "is_current": 1}),
            [],
            "no formula carries at commit, stranded or otherwise",
        )

    # ── link 4: the revision is therefore not formula-complete ───────────────────────
    def test_revision_sheet_is_not_formula_complete(self):
        self.assertFalse(
            pricing._sheet_formulas_complete(self.rev, self.DEST, 1),
            "an amount column with no covering formula -> the mandatory gate fails closed",
        )

    # ── link 5: THE ANSWER -- the rate carry is refused, now doubly ──────────────────
    def test_rate_carry_is_refused_for_a_re_committed_source(self):
        """The chain, confirmed end to end. Under W6 the plan was healthy (the rate was found
        cross-version) and only the formula gate refused it. Under AMENDMENT C's pin the rate is
        stranded too, so the plan is EMPTY *and* the gate refuses -- the sheet carries nothing,
        for two independent reasons.

        If the owner ever widens either read cross-version, THIS is the assertion that flips --
        and `test_overlay_carry_copies_no_formula_forward` flips with it. Both are deliberate."""
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
            plan, [],
            "the plan is EMPTY -- the source rate is stranded on the frozen version too",
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


def _remark(boq, sheet, version, excel_row, text):
    d = frappe.new_doc("BoQ Cell Remark")
    d.boq = boq
    d.sheet_name = sheet
    d.excel_row = excel_row
    d.committed_version = version
    d.remark = text
    d.remark_version = 1
    d.is_current = 1
    d.remarked_at = frappe.utils.now()
    d.insert(ignore_permissions=True)


def _category(boq, sheet, version, excel_row, discipline, final="", human=""):
    d = frappe.new_doc("BoQ Row Category")
    d.boq = boq
    d.sheet_name = sheet
    d.excel_row = excel_row
    d.committed_version = version
    d.discipline = discipline
    d.final_category_id = final
    d.human_category_id = human
    d.category_version = 1
    d.is_current = 1
    d.classified_at = frappe.utils.now()
    d.insert(ignore_permissions=True)


class TestApplySheetCarrySynchronous(FrappeTestCase):
    """AMENDMENT C / C2 -- the synchronous per-sheet endpoint, RATES ONLY since AMENDMENT D.

    One sheet, one call, one transaction. This replaces the hub's whole-BoQ long job (removed at
    C6): the pricing editor is the launch point, so the caller is on-screen and gets the summary
    back directly rather than a job id.

    Fixture: two matched rows (10, 11) plus one source-only row (13). Row 10's rate is clean, row
    11's is a conflict (the dest is already priced), row 13 has no twin. The source ALSO carries a
    remark on 10 and 13 and a category on 10 -- deliberately RETAINED after Amendment D, because
    the point of the fixture is now that none of it moves.
    """

    SRC = "Sync"
    DEST = "Sync Rev"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.orig = _make_boq(cls.project.name, origin="upload", boq_name="SYNC ORIG").name
        cls.rev = _make_revision(cls.project.name, cls.orig).name

        cls.src_sheet = _seed_sheet(cls.orig, cls.SRC, 1, 1,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE}, [
                {"srn": 10, "node_type": "Line Item", "description": "Item A", "qty": 5.0},
                {"srn": 11, "node_type": "Line Item", "description": "Item B", "qty": 5.0},
                {"srn": 13, "node_type": "Line Item", "description": "Item Gone", "qty": 5.0},
            ])
        _price(cls.orig, cls.SRC, 1, 10, "D", "combined_rate", 100.0)   # clean
        _price(cls.orig, cls.SRC, 1, 11, "D", "combined_rate", 200.0)   # conflict
        _remark(cls.orig, cls.SRC, 1, 10, "carry me")                   # carries
        _remark(cls.orig, cls.SRC, 1, 13, "no twin")                    # unmatched
        _category(cls.orig, cls.SRC, 1, 10, "Electrical",
                  final="elec_machine", human="elec_human")

        cls.dest_sheet = _seed_sheet(cls.rev, cls.DEST, 1, 1,
            {"B": _DESC, "C": _UNIT, "E": _SCALAR_RATE}, [
                {"srn": 10, "node_type": "Line Item", "description": "Item A", "qty": 5.0},
                {"srn": 11, "node_type": "Line Item", "description": "Item B", "qty": 5.0},
            ])
        _stamp_provenance(cls.dest_sheet, cls.orig, cls.SRC)
        _price(cls.rev, cls.DEST, 1, 11, "E", "combined_rate", 999.0)   # dest already filled
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for boq in (cls.rev, cls.orig):
            for dt in (_PRICING, _LOCK_DT, "BoQ Cell Remark", "BoQ Cell Color",
                       "BoQ Cell Dismissal", "BoQ Row Category", "BOQ Nodes", _SHEET):
                frappe.db.delete(dt, {"boq": boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def setUp(self):
        # Categorise the destination before each test (tearDown wipes it). Under G2c this was a
        # PRECONDITION -- an uncategorised dest refused the carry. Amendment E removed that gate
        # from this path, so it is now here for a different and still necessary reason: it gives
        # the destination a pre-existing category on row 10, which is what makes the Keep-vs-
        # Overwrite branches testable at all. Written through the live persist path, never the
        # admin override.
        _categorise_fixture_eligible_rows(self.rev, self.DEST, 1)
        frappe.db.commit()

    def tearDown(self):
        # Each test starts from the seeded state: drop anything a carry landed.
        frappe.db.delete("BoQ Cell Remark", {"boq": self.rev})
        frappe.db.delete("BoQ Row Category", {"boq": self.rev})
        frappe.db.delete(_LOCK_DT, {"boq": self.rev})
        frappe.db.delete(_PRICING, {"boq": self.rev, "excel_row": 10})
        frappe.db.sql(
            """update "tabBoQ Cell Pricing" set is_current = 1, rate = 999.0
               where boq = %s and excel_row = 11 and pricing_version = 1""",
            (self.rev,),
        )
        frappe.db.delete(_PRICING, {"boq": self.rev, "excel_row": 11, "pricing_version": (">", 1)})
        frappe.db.commit()

    def _plan_sheet(self):
        plan = cross_boq_carry.get_cross_boq_carry_plan(
            dest_boq=self.rev, sheet_names=json.dumps([self.DEST])
        )
        return plan["sheets"][0]

    # ── the plan ───────────────────────────────────────────────────────────────
    def test_plan_scopes_to_one_sheet_and_reports_layer_counts(self):
        """AMENDMENT E: the plan carries a `layers` block again -- the dialog cannot offer a layer
        it has no counts for. This REPLACES the Amendment D assertion that the key was absent.

        The category walk runs with overwrite=False (Keep is the planning assumption), so this
        fixture's matched row -- which the dest already classifies -- reports as `kept`, not
        `carried`. Arming Overwrite in the dialog moves it without changing the total, which is
        exactly the trade the counts have to let the user see."""
        sheet = self._plan_sheet()
        self.assertEqual(sheet["sheet_name"], self.DEST)
        # EVERY layer is planned, ticked or not -- the dialog cannot offer a choice it has no
        # counts for, and the layer the user has not considered is the one whose numbers they need.
        self.assertEqual(set(sheet["layers"]), set(committed_carry.LAYER_KEYS))
        # ONE outcome shape across every layer, so the client reads a uniform result.
        self.assertEqual(
            set(sheet["layers"]["categories"]),
            {"carried", "replaced", "kept", "unmatched", "ineligible", "dropped"},
        )
        self.assertEqual(sheet["counts"]["clean"], 1)      # row 10
        self.assertEqual(sheet["counts"]["conflict"], 1)   # row 11, dest already priced
        # Row 13 is source-only, but it holds a REMARK and no rate. The plan is source-RATE-driven,
        # so a row with nothing to carry never enters it -- under Amendment C its remark was still
        # reported (as `layers.remarks.unmatched`); now nothing reports it, which is correct.
        self.assertEqual(sheet["counts"]["removed"], 0)

    def test_plan_is_read_only(self):
        self._plan_sheet()
        self.assertEqual(
            frappe.db.count("BoQ Cell Remark", {"boq": self.rev, "is_current": 1}), 0
        )

    # ── the apply ──────────────────────────────────────────────────────────────
    def test_apply_carries_the_rate_onto_the_re_resolved_column(self):
        out = cross_boq_carry.apply_sheet_carry(
            dest_boq=self.rev, sheet_name=self.DEST,
            decisions=json.dumps([
                {"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"},
            ]),
        )
        self.assertTrue(out["ok"])
        self.assertEqual(out["copied"], 1)
        # AMENDMENT E: the key is back and is ALWAYS present, empty when no layer ran. Always-
        # present-possibly-empty beats sometimes-absent: the client reads one shape either way.
        self.assertEqual(out["layers"], {})
        # The rate landed on the RE-RESOLVED dest column (E), never the source's D.
        rate = frappe.db.get_value(
            _PRICING,
            {"boq": self.rev, "sheet_name": self.DEST, "excel_row": 10, "is_current": 1},
            ["col_letter", "rate"], as_dict=True,
        )
        self.assertEqual(rate.col_letter, "E")
        self.assertEqual(float(rate.rate), 100.0)

    # ── AMENDMENT E: the DEFAULT-OFF guard (was Amendment D's absolute one) ────
    def test_a_carry_with_no_layers_selected_writes_rates_only(self):
        """AMENDMENT E REFRAMES this test rather than deleting it. Under Amendment D it asserted an
        ABSOLUTE property -- no seam ever carries an annotation. That is no longer true: the caller
        can now ask for the category layer. What survives, and is still worth guarding, is the
        DEFAULT: a carry that selects no layers writes rates and nothing else.

        That default matters more than it looks. The layer choice travels from the client, so a
        request that loses it -- an older frontend, a retry that drops a field, a hand-made call --
        must degrade to the Amendment D behaviour rather than silently carrying categories nobody
        asked for. Un-asked-for arrival is the exact complaint Amendment D was written about.

        Remark / Colour / Dismissal remain absolute here: they are not in LAYER_KEYS yet, so no
        request can carry them at all. The CATEGORY leg keeps G2c's two-sided form -- (1) the count
        is unchanged (catches an ADD) and (2) the source's distinctive ids never appear (catches an
        OVERWRITE). Neither alone suffices: count-only misses an overwrite, value-only misses an
        addition."""
        cat_before = frappe.db.count("BoQ Row Category", {"boq": self.rev, "is_current": 1})
        cross_boq_carry.apply_sheet_carry(
            dest_boq=self.rev, sheet_name=self.DEST,
            decisions=json.dumps([
                {"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"},
            ]),
        )
        # The three layers the carry never writes AND the dest never pre-holds stay 0 (unchanged).
        for doctype in ("BoQ Cell Remark", "BoQ Cell Color", "BoQ Cell Dismissal"):
            self.assertEqual(
                frappe.db.count(doctype, {"boq": self.rev, "is_current": 1}), 0,
                f"{doctype} must not be written by a carry",
            )
        # CATEGORY leg (G2c) -- (1) the carry ADDED no category row to the destination.
        self.assertEqual(
            frappe.db.count("BoQ Row Category", {"boq": self.rev, "is_current": 1}),
            cat_before, "a carry must not ADD a category row to the destination",
        )
        # (2) the carry OVERWROTE none with the source's distinctive ids ('elec_machine'/'elec_human'
        # -- the fixture's source category on the matched row 10; the dest's own cats are 'db_switchgear').
        for row in frappe.get_all(
            "BoQ Row Category",
            filters={"boq": self.rev, "is_current": 1},
            fields=["final_category_id", "human_category_id"],
        ):
            self.assertNotIn(row.final_category_id, ("elec_machine", "elec_human"),
                             "the source's final category must not land on the destination")
            self.assertNotIn(row.human_category_id, ("elec_machine", "elec_human"),
                             "the source's human category must not land on the destination")

    def test_an_unknown_layer_key_is_dropped_silently(self):
        """AMENDMENT E: `layers` is a real parameter again, so the old "frappe.call filters it out"
        tolerance is gone -- and something better replaces it. `_coerce_layers` keeps only the keys
        in `LAYER_KEYS`, so a client asking for a layer this backend does not implement (a frontend
        deployed ahead of the server, or one built against a later slice) is IGNORED for that layer
        and still gets its rates.

        The alternative -- throwing on an unknown key -- would make every layer addition a
        lock-step deploy.

        `formulas` is the example on purpose rather than a nonsense string: it is a REAL layer
        concept a client could plausibly ask for, and one that ADR-0014 Amendment C rules never
        carries in either seam. So the correct answer is a silent drop, and this test doubles as
        the guard that a formula carry cannot be smuggled in through the layers payload.

        ⚠️ Keep this key OUT of `LAYER_KEYS`. If a future slice implements it, this test needs a
        different unknown key -- it was written against `remarks` and silently stopped testing
        anything the moment R5 implemented that layer."""
        self.assertNotIn("formulas", committed_carry.LAYER_KEYS)
        out = cross_boq_carry.apply_sheet_carry(
            dest_boq=self.rev, sheet_name=self.DEST,
            decisions=json.dumps([
                {"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"},
            ]),
            layers=json.dumps({"formulas": {"carry": True, "overwrite": True}}),
        )
        self.assertTrue(out["ok"])
        self.assertEqual(out["copied"], 1)
        self.assertEqual(out["layers"], {}, "an unknown layer runs nothing and reports nothing")
        self.assertEqual(
            frappe.db.count("BoQ Cell Remark", {"boq": self.rev, "is_current": 1}), 0
        )

    def test_categories_and_rates_land_in_one_action(self):
        """THE Amendment E outcome, end to end: one call, both layers, one transaction.

        The dest already classifies row 10 (setUp), so Overwrite is armed -- otherwise the fixture
        would report `kept` and prove nothing about writing. `elec_machine`/`elec_human` are the
        SOURCE's distinctive ids, so finding them on the destination is unambiguous evidence they
        travelled rather than being coincidentally present."""
        out = cross_boq_carry.apply_sheet_carry(
            dest_boq=self.rev, sheet_name=self.DEST,
            decisions=json.dumps([
                {"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"},
            ]),
            layers=json.dumps({"categories": {"carry": True, "overwrite": True}}),
        )
        self.assertTrue(out["ok"])
        self.assertEqual(out["copied"], 1)
        self.assertEqual(out["layers"]["categories"]["replaced"], 1)
        landed = frappe.get_all(
            "BoQ Row Category",
            filters={"boq": self.rev, "sheet_name": self.DEST, "excel_row": 10,
                     "is_current": 1},
            fields=["final_category_id", "human_category_id", "carried_from_boq"],
        )
        self.assertEqual([r.final_category_id for r in landed], ["elec_machine"])
        self.assertEqual([r.human_category_id for r in landed], ["elec_human"])
        self.assertEqual([r.carried_from_boq for r in landed], [self.orig])

    def test_annotation_layers_carry_only_when_asked_for(self):
        """R5, at the endpoint. The source holds a remark on row 10 (matched) and row 13 (no twin).
        Asking for `remarks` carries the matched one, stamped; NOT asking carries nothing --
        which is the pair of facts Amendment D's incident turned on.

        Note the request selects remarks and NOT colors/dismissals: opt-in is per layer, so a
        request must not drag its neighbours along."""
        out = cross_boq_carry.apply_sheet_carry(
            dest_boq=self.rev, sheet_name=self.DEST,
            decisions=json.dumps([
                {"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"},
            ]),
            layers=json.dumps({"remarks": {"carry": True, "overwrite": False}}),
        )
        self.assertEqual(set(out["layers"]), {"remarks"})
        self.assertEqual(out["layers"]["remarks"]["carried"], 1)
        self.assertEqual(out["layers"]["remarks"]["unmatched"], 1)   # row 13
        landed = frappe.get_all(
            "BoQ Cell Remark",
            filters={"boq": self.rev, "is_current": 1},
            fields=["excel_row", "remark", "carried_from_boq"])
        self.assertEqual([(r.excel_row, r.remark) for r in landed], [(10, "carry me")])
        self.assertEqual(landed[0].carried_from_boq, self.orig)
        # the un-asked-for layers did not run
        self.assertEqual(frappe.db.count("BoQ Cell Color", {"boq": self.rev}), 0)
        self.assertEqual(frappe.db.count("BoQ Row Category", {
            "boq": self.rev, "carried_from_boq": self.orig}), 0)

    def test_a_failing_layer_rolls_the_rates_back_too(self):
        """The docstring promises 'one commit, one rollback, never a half-state where the rates
        landed and the categories did not'. Proving it needs a failure INSIDE the transaction after
        the rates are written, which only a fault injection can produce -- and an unproven
        atomicity claim is exactly the kind that turns out to be false under load.

        The layer runs after the rate loop, so a raise here is the worst case: rates written,
        layer not. If the rollback did not cover them, row 10 would be priced with no category and
        no error -- the silent half-state."""
        with patch.object(
            cross_boq_carry.committed_carry, "carry_category_layer",
            side_effect=RuntimeError("boom"),
        ):
            with self.assertRaises(RuntimeError):
                cross_boq_carry.apply_sheet_carry(
                    dest_boq=self.rev, sheet_name=self.DEST,
                    decisions=json.dumps([
                        {"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"},
                    ]),
                    layers=json.dumps({"categories": {"carry": True, "overwrite": True}}),
                )
        self.assertEqual(
            frappe.db.count(_PRICING, {
                "boq": self.rev, "sheet_name": self.DEST, "excel_row": 10, "is_current": 1}),
            0, "the rate must roll back with the failed layer -- no half-state",
        )

    def test_no_decisions_writes_nothing(self):
        out = cross_boq_carry.apply_sheet_carry(dest_boq=self.rev, sheet_name=self.DEST)
        self.assertEqual(out["copied"], 0)
        self.assertEqual(
            frappe.db.count("BoQ Cell Remark", {"boq": self.rev, "is_current": 1}), 0
        )

    def test_conflict_is_kept_unless_overwrite_is_asserted(self):
        out = cross_boq_carry.apply_sheet_carry(
            dest_boq=self.rev, sheet_name=self.DEST,
            decisions=json.dumps([
                {"dest_excel_row": 11, "area": None, "rate_kind": "combined_rate"},
            ]),
        )
        self.assertEqual(out["conflicts_kept"], 1)
        self.assertEqual(out["conflicts_overwritten"], 0)
        self.assertEqual(
            float(frappe.db.get_value(
                _PRICING,
                {"boq": self.rev, "excel_row": 11, "is_current": 1}, "rate")),
            999.0,
        )

    # ── gates ──────────────────────────────────────────────────────────────────
    def test_a_lock_held_by_another_user_throws_and_writes_nothing(self):
        # "Locked By" is a User Link, so the holder must be a REAL user: Guest holds it, and the
        # endpoint runs as the test session's Administrator -> rejected, nothing written.
        acquire_or_refresh(self.rev, self.DEST, 1, "Guest", frappe.utils.now_datetime())
        frappe.db.commit()
        try:
            with self.assertRaises(frappe.ValidationError):
                cross_boq_carry.apply_sheet_carry(
                    dest_boq=self.rev, sheet_name=self.DEST,
                    decisions=json.dumps([
                        {"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"},
                    ]),
                )
            self.assertEqual(
                frappe.db.count(_PRICING, {"boq": self.rev, "excel_row": 10, "is_current": 1}), 0
            )
        finally:
            frappe.db.delete(_LOCK_DT, {"boq": self.rev})
            frappe.db.commit()

    def test_an_uncommitted_sheet_name_throws(self):
        with self.assertRaises(frappe.ValidationError):
            cross_boq_carry.apply_sheet_carry(dest_boq=self.rev, sheet_name="No Such Sheet")

    def test_a_non_revision_boq_throws(self):
        with self.assertRaises(frappe.ValidationError):
            cross_boq_carry.apply_sheet_carry(dest_boq=self.orig, sheet_name=self.SRC)


class TestCrossBoqCarryCategoryGate(FrappeTestCase):
    """⚠️ INVERTED at ADR-0014 AMENDMENT E (owner decision). This class was Slice G2c's guard that
    the CROSS-BoQ revision carry is gated on the DESTINATION's categories. **That gate is removed
    from this path**, and the class now guards the removal -- fixture intact, assertions flipped,
    the same shape the Amendment D inversions took.

    WHY the gate had to go: the carry now moves categories too, so gating it on categories being
    complete blocked its own remedy -- a freshly committed revision has ZERO category rows, so the
    gate was shut, so the carry that would populate them could not run. And a revision containing
    even one genuinely NEW line item could never satisfy a post-carry re-check either: that row has
    no source to carry from, by definition.

    WHAT REPLACES IT: nothing on this path. The gate keeps working everywhere else and does its
    normal job on what follows -- the revision arrives with rates visible but rate EDITING locked,
    the banner names the rows still missing a category, the user categorises them, and editing
    opens sheet-wide. `pricing.save_cell_price` and `pricing.apply_copy_forward` are UNTOUCHED and
    keep their own G2c coverage; the distinction is that those write HAND-TYPED rates, while this
    moves known values from a known-good source.

    STILL GATED HERE, and now the only gate: the deliberate sheet lock and the mandatory
    amount-formula declaration.

    Fixture (unchanged): original "Gate Src" (priced) + its revision "Gate Rev" (uncategorised,
    scalar rate at D on both, no drift). A second dest "Gate Amt Rev" has an amount column with NO
    formula, for the formula-gate check. sheet_name VERBATIM (#152)."""

    SRC = "Gate Src"
    DEST = "Gate Rev"
    AMT_SRC = "Gate Amt"
    AMT_DEST = "Gate Amt Rev"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.orig = _make_boq(cls.project.name, origin="upload", boq_name="GATE ORIG").name
        cls.rev = _make_revision(cls.project.name, cls.orig).name

        _seed_sheet(cls.orig, cls.SRC, 1, 1,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE}, [
                {"srn": 10, "node_type": "Line Item", "description": "Item A", "qty": 5.0},
                {"srn": 11, "node_type": "Line Item", "description": "Item B", "qty": 5.0},
            ])
        _price(cls.orig, cls.SRC, 1, 10, "D", "combined_rate", 100.0)
        _price(cls.orig, cls.SRC, 1, 11, "D", "combined_rate", 200.0)

        cls.dest_sheet = _seed_sheet(cls.rev, cls.DEST, 1, 1,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE}, [
                {"srn": 10, "node_type": "Line Item", "description": "Item A", "qty": 5.0},
                {"srn": 11, "node_type": "Line Item", "description": "Item B", "qty": 5.0},
                # G2e: a qty-less Preamble on the DEST (not carried) -- an uncategorised one gates the
                # carry under the widened eligible gate (test_i).
                {"srn": 12, "node_type": "Preamble", "description": "Header"},
            ])
        _stamp_provenance(cls.dest_sheet, cls.orig, cls.SRC)

        # Precedence sheet: an amount column with NO formula -> the formula gate must win.
        _seed_sheet(cls.orig, cls.AMT_SRC, 1, 1,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE}, [
                {"srn": 20, "node_type": "Line Item", "description": "Amt A", "qty": 5.0},
            ], sheet_order=2)
        _price(cls.orig, cls.AMT_SRC, 1, 20, "D", "combined_rate", 300.0)
        cls.amt_dest_sheet = _seed_sheet(cls.rev, cls.AMT_DEST, 1, 1,
            {"B": _DESC, "C": _UNIT, "D": _SCALAR_RATE,
             "F": {"role": "amount_total", "area": None}}, [
                {"srn": 20, "node_type": "Line Item", "description": "Amt A", "qty": 5.0},
            ], sheet_order=2)
        _stamp_provenance(cls.amt_dest_sheet, cls.orig, cls.AMT_SRC)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for boq in (cls.rev, cls.orig):
            for dt in (_PRICING, _LOCK_DT, "BoQ Row Category", "BOQ Nodes", _SHEET):
                frappe.db.delete(dt, {"boq": boq})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def setUp(self):
        # Reset each test: no dest pricing, no categories, override OFF, no locks.
        frappe.db.delete(_PRICING, {"boq": self.rev})
        frappe.db.delete("BoQ Row Category", {"boq": self.rev})
        frappe.db.set_value(_SHEET, self.dest_sheet, "category_gate_override", 0,
                            update_modified=False)
        frappe.db.delete(_LOCK_DT, {"boq": self.rev})
        frappe.db.commit()

    # ── helpers ──────────────────────────────────────────────────────────────────
    def _ctx(self, sheet_docname):
        return cross_boq_carry._resolve_sheet_carry(
            self.rev,
            frappe.db.get_value(_SHEET, sheet_docname,
                                ["name", "sheet_name", "commit_version",
                                 "source_boq", "source_sheet_name"], as_dict=True),
        )

    def _apply_inner_10(self):
        return cross_boq_carry._apply_sheet_carry(
            self._ctx(self.dest_sheet),
            [{"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"}],
            "Administrator",
        )

    def _apply_endpoint_10(self):
        return cross_boq_carry.apply_sheet_carry(
            dest_boq=self.rev, sheet_name=self.DEST,
            decisions=json.dumps(
                [{"dest_excel_row": 10, "area": None, "rate_kind": "combined_rate"}]),
        )

    def _dest_rate(self, excel_row, col="D"):
        return frappe.db.get_value(_PRICING, {
            "boq": self.rev, "sheet_name": self.DEST, "committed_version": 1,
            "excel_row": excel_row, "col_letter": col, "is_current": 1, "is_filled": 1}, "rate")

    def _categorise_dest(self):
        _categorise_fixture_eligible_rows(self.rev, self.DEST, 1)

    # (a) INVERTED -- a blank DESTINATION no longer refuses the carry.
    def test_a_uncategorised_destination_no_longer_refuses(self):
        """Was `test_a_refused_when_destination_blank`. The destination has NO categories at all --
        the state every freshly committed revision is in -- and the carry proceeds."""
        summary, reason = self._apply_inner_10()
        self.assertIsNone(reason)
        self.assertEqual(summary["copied"], 1)

    # (b) INVERTED -- and the rate actually lands.
    def test_b_rate_lands_despite_blank_categories(self):
        self._apply_inner_10()
        self.assertEqual(self._dest_rate(10), 100.0)

    # (c) UNCHANGED -- a categorised destination still works (no regression the other way).
    def test_c_succeeds_once_categorised(self):
        self._categorise_dest()
        summary, reason = self._apply_inner_10()
        self.assertIsNone(reason)
        self.assertEqual(summary["copied"], 1)
        self.assertEqual(self._dest_rate(10), 100.0)

    # (d) INVERTED -- the admin override is now IRRELEVANT to this path.
    def test_d_admin_override_is_irrelevant_here(self):
        """The override still exists and still governs `save_cell_price` / `apply_copy_forward`.
        It simply has nothing left to unlock on THIS path, so the carry behaves identically with
        it and without it. Asserted rather than assumed: an override that silently became a
        precondition again would be invisible otherwise."""
        without = self._apply_inner_10()
        frappe.db.delete(_PRICING, {"boq": self.rev})
        pricing.set_category_override(
            boq_name=self.rev, sheet_name=self.DEST, committed_version=1,
            reason="should change nothing",
        )
        with_override = self._apply_inner_10()
        self.assertIsNone(without[1])
        self.assertIsNone(with_override[1])
        self.assertEqual(without[0]["copied"], with_override[0]["copied"], 1)

    # (e) SOURCE IRRELEVANT -- an uncategorised SOURCE does not block either.
    def test_e_uncategorised_source_does_not_block(self):
        self.assertEqual(frappe.db.count("BoQ Row Category", {
            "boq": self.orig, "is_current": 1}), 0, "the SOURCE carries no categories")
        summary, reason = self._apply_inner_10()
        self.assertIsNone(reason)
        self.assertEqual(summary["copied"], 1)

    # (f) REPLAY -- re-running must not double-apply. (The refusal step is gone; the rest stands.)
    def test_f_replay_and_no_double_apply(self):
        self._apply_inner_10()
        self.assertEqual(self._dest_rate(10), 100.0)
        self._apply_inner_10()  # re-run must not double-apply the value
        self.assertEqual(self._dest_rate(10), 100.0)
        self.assertEqual(frappe.db.count(_PRICING, {
            "boq": self.rev, "sheet_name": self.DEST, "committed_version": 1,
            "excel_row": 10, "col_letter": "D", "is_current": 1}), 1,
            "exactly one current row after replay (freeze-and-supersede)")

    # (g) THE REMAINING GATE -- formulas. Now the only thing that blocks this path.
    def test_g_formula_gate_still_blocks(self):
        """The formula gate is UNTOUCHED by Amendment E and is now the sole blocker. Note the
        destination here is also uncategorised: before, either gate could have produced this
        refusal and the test could not tell them apart. Now only one can, which makes the
        assertion sharper than it was as a precedence check."""
        summary, reason = cross_boq_carry._apply_sheet_carry(
            self._ctx(self.amt_dest_sheet),
            [{"dest_excel_row": 20, "area": None, "rate_kind": "combined_rate"}],
            "Administrator",
        )
        self.assertIsNone(summary)
        self.assertEqual(reason, "formulas_incomplete")

    # (h) INVERTED -- the categories block is gone from the message family entirely.
    def test_h_categories_block_is_gone_from_the_message_family(self):
        """A leftover entry in these maps would be dead copy that reads as a live behaviour to the
        next person -- and, worse, would let a re-added `return None, "categories_incomplete"`
        surface a friendly message instead of failing loudly in review."""
        self.assertNotIn("categories_incomplete", cross_boq_carry._APPLY_BLOCK_MESSAGE)
        self.assertNotIn("categories_incomplete", cross_boq_carry._APPLY_BLOCK_TITLE)
        self.assertEqual(
            set(cross_boq_carry._APPLY_BLOCK_MESSAGE),
            set(cross_boq_carry._APPLY_BLOCK_TITLE),
            "the two maps must stay in lockstep or a block throws with a KeyError",
        )
        # and the endpoint completes rather than raising.
        self.assertTrue(self._apply_endpoint_10()["ok"])

    # (i) INVERTED -- a blank qty-less Preamble on the DEST no longer refuses the carry.
    def test_i_qtyless_preamble_no_longer_gates_carry(self):
        """G2e widened "blank" to include a qty-less Preamble, which made this the STRICTEST
        version of the gate -- and the one most likely to be unsatisfiable on a real revision.
        It now carries."""
        persist.write_row_categories(self.rev, self.DEST, 1, "Electrical", [
            {"excel_row": er, "rule_category_id": "", "ai_category_id": "",
             "final_category_id": "db_switchgear", "routing": "Auto-accepted"} for er in (10, 11)])
        summary, reason = self._apply_inner_10()
        self.assertIsNone(reason)
        self.assertEqual(self._dest_rate(10), 100.0)

    # (j) RE-POINTED -- "your existing rates are untouched" now tested against the FORMULA refusal.
    def test_j_preexisting_dest_rate_survives_a_refused_carry(self):
        """The promise is unchanged; only which gate can still make it is. Seed the formula-blocked
        destination with a rate on the very row a carry targets, let the formula gate refuse, and
        assert the rate is byte-identical with NO superseded history row minted.

        Kept rather than deleted with the category gate: the property under test is that a
        SHEET-LEVEL refusal returns before any write, and that is a property of the refusal path
        itself, not of which gate raised it."""
        _price(self.rev, self.AMT_DEST, 1, 20, "D", "combined_rate", 555.0)
        frappe.db.commit()
        rows_before = frappe.db.count(_PRICING, {
            "boq": self.rev, "sheet_name": self.AMT_DEST, "committed_version": 1,
            "excel_row": 20, "col_letter": "D"})
        summary, reason = cross_boq_carry._apply_sheet_carry(
            self._ctx(self.amt_dest_sheet),
            [{"dest_excel_row": 20, "area": None, "rate_kind": "combined_rate"}],
            "Administrator",
        )
        self.assertIsNone(summary)
        self.assertEqual(reason, "formulas_incomplete")
        self.assertEqual(
            float(frappe.db.get_value(_PRICING, {
                "boq": self.rev, "sheet_name": self.AMT_DEST, "committed_version": 1,
                "excel_row": 20, "col_letter": "D", "is_current": 1, "is_filled": 1}, "rate")),
            555.0, "the pre-existing rate survived byte-identically")
        self.assertEqual(
            frappe.db.count(_PRICING, {
                "boq": self.rev, "sheet_name": self.AMT_DEST, "committed_version": 1,
                "excel_row": 20, "col_letter": "D"}),
            rows_before, "the refused carry minted no superseded history row")
