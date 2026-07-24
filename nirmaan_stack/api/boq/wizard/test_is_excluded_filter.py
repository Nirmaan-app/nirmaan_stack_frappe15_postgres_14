"""
Tests for the ADR-0013 D5 `is_excluded` filter -- the "Create from Template" selection
subset (T5): excluded rows (is_excluded=1) must NOT block the finalize gate and must NOT be
committed as BOQ Nodes.

The filter was added at EXACTLY the finalize-gate + commit read sites, and is UNIVERSALLY
INERT for the upload flow (every upload/existing row is is_excluded=0). These tests set
is_excluded directly on seeded `BoQ Review Row`s -- isolating the filter itself, independent
of the (sibling-task) template-clone machinery.

Coverage (each edited read site):
  * commit_validation.build_sheet_node_plan (:~291) -- the node-plan read that feeds BOTH the
    real commit's node tree AND the shared finalize validator: excluded rows are dropped from
    the plan; an all-included sheet keeps every row (filter inert).
  * commit_validation.structural_errors_for_sheet (:543, via build_sheet_node_plan) +
    review_screen.get_structural_breaks (:~2691) -- an excluded row that WOULD be a blocking
    #8 (item under a non-heading) produces no break; the INCLUDED control DOES break (proves
    the filter is load-bearing, not vacuous).
  * review_screen.mark_sheet_parsed_check_done (:~2783) -- the whitelisted finalize gate:
    an included #8 row blocks (status stays Parsed); deselecting it lets the sheet finalize.
  * commit_pipeline._commit_node_tree (:~704, via _commit_one_sheet) -- the excluded line
    item is not written as a BOQ Node (node_count omits it); an all-included sheet commits
    every node (filter inert -- identical to before).

get_review_rows is deliberately NOT tested for filtering -- by design it must still return
ALL rows (incl. excluded) so the review/selection UI can show them greyed/unchecked.

Fixture conventions reused from the BoQ wizard suites: the Projects-row fixture
(``_make_project`` / ``_cleanup_project`` from test_review_screen), sheet_name carried
VERBATIM with a trailing space (#152), and the -1 "no parent" sentinel on review rows.
"""
from __future__ import annotations

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import commit_pipeline
from nirmaan_stack.api.boq.wizard.commit_validation import (
    build_sheet_node_plan,
    structural_errors_for_sheet,
)
from nirmaan_stack.api.boq.wizard.review_screen import (
    get_structural_breaks,
    mark_sheet_parsed_check_done,
)
from nirmaan_stack.api.boq.wizard.test_review_screen import (
    _cleanup_project,
    _make_project,
)

_NODE = "BOQ Nodes"
_GRID = "BoQ Committed Sheet Grid"
_SHEET = "BoQ Sheet"

# Draft sheet_config blob -- the snapshot source pinned onto the committed BoQ Sheet.
_CFG = {
    "header_row": 5,
    "header_row_count": 2,
    "column_role_map": {
        "A": {"role": "sl_no", "area": None},
        "C": {"role": "description", "area": None},
    },
    "column_headers": {"A": "Sl. No", "C": "Description"},
    "area_dimensions": ["Zone A", "Zone B"],
}

# Synthetic faithful grid rows for the commit path (grid is built from these, NOT from the
# review rows -- so it is independent of is_excluded; supplied verbatim to _commit_one_sheet).
_GRID_ROWS = [
    {"row_number": 1, "cells": {"A": "Sl", "B": "Description", "C": "Qty"}},
    {"row_number": 2, "cells": {"A": 1, "B": "Cement OPC 53", "C": 50}},
    {"row_number": 3, "cells": {"B": "EARTHWORK"}},
]


class TestIsExcludedFilter(FrappeTestCase):

    # VERBATIM trailing spaces (#152). One sheet per read-site so the tests stay independent.
    PLAN_SHEET = "Excl Plan "
    BREAKS_SHEET = "Excl Breaks "
    GATE_SHEET = "Excl Gate "
    COMMIT_SHEET = "Excl Commit "
    _PARSED_SHEETS = (PLAN_SHEET, BREAKS_SHEET, GATE_SHEET)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Is-Excluded Filter BoQ"
        boq.tax_treatment = "Pre-tax"
        for order, (sheet, status) in enumerate(
            [
                (cls.PLAN_SHEET, "Parsed"),
                (cls.BREAKS_SHEET, "Parsed"),
                (cls.GATE_SHEET, "Parsed"),
                (cls.COMMIT_SHEET, "Finalized"),
            ],
            start=1,
        ):
            boq.append("sheet_drafts", {
                "sheet_name": sheet,       # VERBATIM (#152)
                "sheet_order": order,
                "wizard_status": status,
                "sheet_config": json.dumps(_CFG),
            })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def tearDown(self):
        self._purge()
        # Restore the Parsed-sheet statuses (the gate test finalizes GATE_SHEET).
        for s in self._PARSED_SHEETS:
            self._set_status(s, "Parsed")
        frappe.db.commit()
        super().tearDown()

    # ----- fixture helpers ------------------------------------------------ #

    def _purge(self):
        """Delete this BoQ's review rows + any committed tiers a commit test wrote."""
        for n in frappe.get_all(_NODE, filters={"boq": self.boq}, pluck="name"):
            frappe.db.delete("BOQ Node Qty By Area", {"parent": n})
        frappe.db.delete(_NODE, {"boq": self.boq})
        for g in frappe.get_all(_GRID, filters={"boq": self.boq}, pluck="name"):
            frappe.db.delete("BoQ Committed Sheet Grid Row", {"parent": g})
        frappe.db.delete(_GRID, {"boq": self.boq})
        for bs in frappe.get_all(_SHEET, filters={"boq": self.boq}, pluck="name"):
            frappe.db.delete("BoQ Sheet Work Package", {"parent": bs})
        frappe.db.delete(_SHEET, {"boq": self.boq})
        frappe.db.delete("BoQ Review Row", {"boq": self.boq})

    def _seed(self, sheet, row_index, classification, **kw):
        """Insert ONE BoQ Review Row. parent_index / human_parent default to the -1
        "no parent" sentinel; is_excluded defaults (unset) to the doctype default 0."""
        doc = frappe.new_doc("BoQ Review Row")
        doc.boq = self.boq
        doc.sheet_name = sheet  # VERBATIM (#152)
        doc.row_index = row_index
        doc.source_row_number = kw.get("source_row_number", row_index + 2)
        doc.classification = classification
        doc.parent_index = kw.get("parent_index", -1)
        doc.human_parent = kw.get("human_parent", -1)
        for f in ("level", "description", "qty_total", "is_excluded",
                  "human_classification", "human_is_root"):
            if f in kw:
                setattr(doc, f, kw[f])
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return doc.name

    def _draft(self, sheet):
        boq = frappe.get_doc("BOQs", self.boq)
        for d in boq.sheet_drafts:
            if d.sheet_name == sheet:
                return d
        raise AssertionError(f"draft {sheet!r} not found")

    def _draft_status(self, sheet):
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq, "parenttype": "BOQs", "sheet_name": sheet},
            "wizard_status",
        )

    def _set_status(self, sheet, status):
        name = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq, "parenttype": "BOQs", "sheet_name": sheet},
            "name",
        )
        if name:
            frappe.db.set_value("BoQ Sheet Draft", name, "wizard_status", status)

    # ======================================================================
    # build_sheet_node_plan -- the read that feeds the commit node tree + validator.
    # ======================================================================

    def test_build_sheet_node_plan_drops_excluded_rows(self):
        s = self.PLAN_SHEET
        self._seed(s, 0, "preamble", level=1, description="HEAD")
        self._seed(s, 1, "line_item", parent_index=0, description="Kept", qty_total=10.0)
        self._seed(s, 2, "line_item", parent_index=0, description="Excluded",
                   qty_total=5.0, is_excluded=1)

        plan, _warns = build_sheet_node_plan(self.boq, s)

        self.assertEqual(
            sorted(p["row_index"] for p in plan), [0, 1],
            "the excluded row is dropped from the node plan (=> never committed as a node)",
        )

    def test_build_sheet_node_plan_all_included_keeps_every_row(self):
        s = self.PLAN_SHEET
        self._seed(s, 0, "preamble", level=1, description="HEAD")
        self._seed(s, 1, "line_item", parent_index=0, qty_total=10.0)
        self._seed(s, 2, "line_item", parent_index=0, qty_total=5.0)  # is_excluded default 0

        plan, _warns = build_sheet_node_plan(self.boq, s)

        self.assertEqual(
            sorted(p["row_index"] for p in plan), [0, 1, 2],
            "no exclusion -> the filter is inert; every row survives (identical to before)",
        )

    # ======================================================================
    # Finalize structural gate -- excluded rows must not block; included ones still do.
    # ======================================================================

    def test_excluded_break_producer_yields_no_structural_break(self):
        """A line_item filed UNDER a line_item is a blocking #8 -- but excluded, so it is
        filtered from both the shared validator and the gate endpoint."""
        s = self.BREAKS_SHEET
        self._seed(s, 0, "preamble", level=1, description="HEAD")
        self._seed(s, 1, "line_item", parent_index=0, description="Valid item")
        self._seed(s, 2, "line_item", parent_index=1, description="Item under an item",
                   is_excluded=1)

        self.assertEqual(
            structural_errors_for_sheet(self.boq, s), [],
            "excluded #8 row is filtered out of the shared structural validator",
        )
        self.assertEqual(
            get_structural_breaks(boq_name=self.boq, sheet_name=s)["breaks"], [],
            "excluded #8 row produces no finalize break on the gate endpoint",
        )

    def test_included_break_producer_still_breaks_control(self):
        """Sanity/control: the SAME row, INCLUDED, DOES break -- proving the filter above is
        load-bearing (the sheet is not trivially clean)."""
        s = self.BREAKS_SHEET
        self._seed(s, 0, "preamble", level=1, description="HEAD")
        self._seed(s, 1, "line_item", parent_index=0, description="Valid item")
        self._seed(s, 2, "line_item", parent_index=1, description="Item under an item")

        errs = structural_errors_for_sheet(self.boq, s)
        self.assertTrue(
            any(e["type"] == "line_item_parent_not_preamble" for e in errs),
            "an INCLUDED item under a non-heading is a #8 break",
        )
        breaks = get_structural_breaks(boq_name=self.boq, sheet_name=s)["breaks"]
        self.assertTrue(
            any(b["type"] == "line_item_parent_not_preamble" for b in breaks),
            "the gate endpoint surfaces the #8 break for the included row",
        )

    def test_finalize_gate_blocks_included_then_passes_when_excluded(self):
        """The whitelisted mark_sheet_parsed_check_done gate: an included #8 row blocks
        finalize (status stays Parsed); deselecting the row lets the sheet finalize."""
        s = self.GATE_SHEET
        self._seed(s, 0, "preamble", level=1, description="HEAD")
        self._seed(s, 1, "line_item", parent_index=0)
        row2 = self._seed(s, 2, "line_item", parent_index=1)  # #8, INCLUDED

        blocked = mark_sheet_parsed_check_done(boq_name=self.boq, sheet_name=s)
        self.assertFalse(blocked["ok"], "an included #8 row blocks finalize")
        self.assertTrue(blocked["breaks"])
        self.assertEqual(self._draft_status(s), "Parsed",
                         "a blocked finalize leaves the sheet at Parsed")

        # Deselect the offending row -> the gate must now pass.
        frappe.db.set_value("BoQ Review Row", row2, "is_excluded", 1)
        frappe.db.commit()

        ok = mark_sheet_parsed_check_done(boq_name=self.boq, sheet_name=s)
        self.assertTrue(ok["ok"], "excluding the offending row lets the sheet finalize")
        self.assertEqual(ok["status"], "Finalized")

    # ======================================================================
    # Commit node tree -- excluded rows are not written as BOQ Nodes.
    # ======================================================================

    def test_commit_omits_excluded_rows_from_the_node_tree(self):
        s = self.COMMIT_SHEET
        self._seed(s, 0, "preamble", level=1, description="HEAD")
        self._seed(s, 1, "line_item", parent_index=0, description="Committed item",
                   qty_total=10.0)
        self._seed(s, 2, "line_item", parent_index=0, description="Excluded item",
                   qty_total=5.0, is_excluded=1)

        res = commit_pipeline._commit_one_sheet(
            self.boq, s, "finalized", _GRID_ROWS, self._draft(s)
        )

        self.assertEqual(res["node_count"], 2,
                         "the excluded line item is not committed as a node")
        descs = {
            n["description"]
            for n in frappe.get_all(
                _NODE,
                filters={"boq": self.boq, "sheet": res["boq_sheet_name"]},
                fields=["description"],
            )
        }
        self.assertIn("Committed item", descs)
        self.assertNotIn("Excluded item", descs,
                         "an excluded row must appear in NEITHER the grid nor the nodes")

    def test_commit_all_included_commits_every_node(self):
        s = self.COMMIT_SHEET
        self._seed(s, 0, "preamble", level=1, description="HEAD")
        self._seed(s, 1, "line_item", parent_index=0, description="Item A", qty_total=10.0)
        self._seed(s, 2, "line_item", parent_index=0, description="Item B", qty_total=5.0)

        res = commit_pipeline._commit_one_sheet(
            self.boq, s, "finalized", _GRID_ROWS, self._draft(s)
        )

        self.assertEqual(res["node_count"], 3,
                         "no exclusion -> the filter is inert; every node commits as before")
