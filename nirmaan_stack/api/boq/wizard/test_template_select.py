"""
Tests for template_select.py (T3 / ADR-0013 D5 -- row selection + two-direction cascade).

Two groups:
  TestCascadeHelpers   -- PURE Python: _descendants / _ancestor_chain, cycle-safe.
  TestSetRowExcluded   -- DB: the set_row_excluded endpoint (both cascades, ride-along
                          non-eligible rows untouched, origin gate, missing-row, cycle-safe).
"""
import json
import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.template_select import (
    _ancestor_chain,
    _build_children_map,
    _descendants,
    set_row_excluded,
)


# ---------------------------------------------------------------------------
# Pure cascade helpers -- no frappe, no DB
# ---------------------------------------------------------------------------

class TestCascadeHelpers(unittest.TestCase):
    """The graph math that mirrors the frontend templateSelection.ts (F1 parity)."""

    def test_build_children_map_ignores_none_parents(self):
        # 0 is root (None parent); 1,2 are children of 0; 3 is child of 1.
        pm = {0: None, 1: 0, 2: 0, 3: 1}
        children = _build_children_map(pm)
        self.assertEqual(sorted(children.get(0, [])), [1, 2])
        self.assertEqual(children.get(1), [3])
        self.assertNotIn(None, children)  # None parents contribute no edge

    def test_descendants_full_subtree(self):
        # 0 -> {1,2}; 1 -> {3}; so descendants(0) = {1,2,3}, excludes 0 itself.
        pm = {0: None, 1: 0, 2: 0, 3: 1}
        self.assertEqual(_descendants(pm, 0), {1, 2, 3})

    def test_descendants_nested_only(self):
        # descendants of the nested preamble 1 is just its own child 3.
        pm = {0: None, 1: 0, 2: 0, 3: 1}
        self.assertEqual(_descendants(pm, 1), {3})

    def test_descendants_leaf_is_empty(self):
        pm = {0: None, 1: 0, 2: 0, 3: 1}
        self.assertEqual(_descendants(pm, 3), set())

    def test_ancestor_chain_walks_up(self):
        # ancestors of 3 = {1, 0}, excludes 3 itself.
        pm = {0: None, 1: 0, 2: 0, 3: 1}
        self.assertEqual(_ancestor_chain(pm, 3), {1, 0})

    def test_ancestor_chain_root_is_empty(self):
        pm = {0: None, 1: 0}
        self.assertEqual(_ancestor_chain(pm, 0), set())

    def test_descendants_cycle_safe(self):
        # A two-node cycle 0<->1 must terminate and never re-include the root.
        pm = {0: 1, 1: 0}
        self.assertEqual(_descendants(pm, 0), {1})
        self.assertEqual(_descendants(pm, 1), {0})

    def test_ancestor_chain_cycle_safe(self):
        # Same two-node cycle: walking up from 0 stops after visiting 1.
        pm = {0: 1, 1: 0}
        self.assertEqual(_ancestor_chain(pm, 0), {1})

    def test_self_loop_safe(self):
        # A row that is its own parent must not hang and yields no ancestors/descendants.
        pm = {0: 0}
        self.assertEqual(_descendants(pm, 0), set())
        self.assertEqual(_ancestor_chain(pm, 0), set())

    def test_longer_cycle_safe(self):
        # 0 -> 1 -> 2 -> 0 (three-node cycle) terminates for both walks.
        pm = {0: 2, 1: 0, 2: 1}
        self.assertEqual(_descendants(pm, 0), {1, 2})
        self.assertEqual(_ancestor_chain(pm, 0), {2, 1})


# ---------------------------------------------------------------------------
# DB helpers (co-located; mirror test_review_screen.py patterns)
# ---------------------------------------------------------------------------

_LIST_JSON_FIELDS = ("attached_notes", "classifier_warnings",
                     "preamble_candidate_signals", "edit_log")


def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_TMPLSEL_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


def _insert_rows(boq_name, row_dicts):
    for orig in row_dicts:
        d = dict(orig)
        d.setdefault("boq", boq_name)
        for key in _LIST_JSON_FIELDS:
            if isinstance(d.get(key), list):
                d[key] = json.dumps(d[key])
        doc = frappe.new_doc("BoQ Review Row")
        doc.update(d)
        doc.insert(ignore_permissions=True)
    frappe.db.commit()


def _row(sheet_name, row_index, classification, parent_index=-1, human_parent=-1):
    """Minimal BoQ Review Row dict. parent_index / human_parent use the -1 sentinel
    (Frappe coerces Int None->0, a valid index; -1 is the unambiguous 'no parent')."""
    return {
        "sheet_name": sheet_name,
        "row_index": row_index,
        "source_row_number": row_index + 2,
        "classification": classification,
        "parent_index": parent_index,
        "human_parent": human_parent,
        "human_is_root": 0,
        "is_excluded": 0,
        "ai_suggested_parent": -1,
        "attached_notes": [],
        "classifier_warnings": [],
        "preamble_candidate_signals": [],
        "edit_log": [],
    }


def _excluded(boq_name, sheet_name, row_index):
    """Read the stored is_excluded flag for one row."""
    return int(frappe.db.get_value(
        "BoQ Review Row",
        {"boq": boq_name, "sheet_name": sheet_name, "row_index": row_index},
        "is_excluded",
    ) or 0)


class TestSetRowExcluded(FrappeTestCase):
    """The set_row_excluded endpoint + both cascades on a real template BoQ.

    Tree in sheet MAIN (all in one BOQs, origin='template'):
        0  preamble  (root)
        1    preamble  (nested, parent 0)
        2      line_item  (parent 1)
        3    line_item  (parent 0)
        4    note       (parent 0)   <- non-eligible ride-along
    """

    SHEET = "MAIN"
    CYCLE_SHEET = "CYCLE"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Template Select Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.origin = "template"
        boq.append("sheet_drafts", {
            "sheet_name": cls.SHEET, "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

        _insert_rows(cls.boq_name, [
            _row(cls.SHEET, 0, "preamble", parent_index=-1),
            _row(cls.SHEET, 1, "preamble", parent_index=0),
            _row(cls.SHEET, 2, "line_item", parent_index=1),
            _row(cls.SHEET, 3, "line_item", parent_index=0),
            _row(cls.SHEET, 4, "note", parent_index=0),
        ])

        # A cyclic effective graph (inserted directly, bypassing save-time cycle guards):
        # row 10 <-> row 11 via human_parent overrides. Used to assert the endpoint
        # terminates (cycle-safe) rather than hanging.
        _insert_rows(cls.boq_name, [
            _row(cls.CYCLE_SHEET, 10, "preamble", parent_index=-1, human_parent=11),
            _row(cls.CYCLE_SHEET, 11, "preamble", parent_index=-1, human_parent=10),
        ])

        # An UPLOAD-origin BoQ to prove the origin gate rejects it.
        up = frappe.new_doc("BOQs")
        up.project = cls.test_project.name
        up.boq_name = "Upload Origin BoQ"
        up.tax_treatment = "Pre-tax"
        # origin left at its default ("upload")
        up.append("sheet_drafts", {
            "sheet_name": cls.SHEET, "sheet_order": 1, "wizard_status": "Parsed",
        })
        up.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.upload_boq_name = up.name
        _insert_rows(cls.upload_boq_name, [_row(cls.SHEET, 0, "preamble", parent_index=-1)])

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.delete("BoQ Review Row", {"boq": cls.upload_boq_name})
        frappe.delete_doc("BOQs", cls.boq_name, force=True, ignore_permissions=True)
        frappe.delete_doc("BOQs", cls.upload_boq_name, force=True, ignore_permissions=True)
        frappe.db.commit()
        frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        # Reset selection to all-included before each test for isolation.
        for idx in (0, 1, 2, 3, 4):
            frappe.db.set_value(
                "BoQ Review Row",
                {"boq": self.boq_name, "sheet_name": self.SHEET, "row_index": idx},
                "is_excluded", 0, update_modified=False,
            )
        frappe.db.commit()

    # --- DESELECT cascade ---------------------------------------------------

    def test_deselect_root_preamble_excludes_whole_subtree(self):
        res = set_row_excluded(
            boq_name=self.boq_name, sheet_name=self.SHEET, row_index=0, excluded=True,
        )
        self.assertEqual(res["status"], "saved")
        # Eligible rows 0,1,2,3 excluded; note (4) rides along -> stays included.
        self.assertEqual(res["excluded_indices"], [0, 1, 2, 3])
        self.assertEqual(res["included_indices"], [4])
        for idx in (0, 1, 2, 3):
            self.assertEqual(_excluded(self.boq_name, self.SHEET, idx), 1)
        # Ride-along non-eligible row is UNTOUCHED (stored 0).
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 4), 0)

    def test_deselect_nested_preamble_excludes_only_its_subtree(self):
        res = set_row_excluded(
            boq_name=self.boq_name, sheet_name=self.SHEET, row_index=1, excluded=True,
        )
        # Only the nested preamble 1 and its child line item 2 drop out.
        self.assertEqual(res["excluded_indices"], [1, 2])
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 0), 0)
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 1), 1)
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 2), 1)
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 3), 0)

    def test_deselect_leaf_line_item_only_itself(self):
        res = set_row_excluded(
            boq_name=self.boq_name, sheet_name=self.SHEET, row_index=3, excluded=True,
        )
        self.assertEqual(res["excluded_indices"], [3])

    # --- SELECT cascade -----------------------------------------------------

    def test_select_nested_line_item_reincludes_ancestor_preambles(self):
        # Start from all-excluded (deselect root).
        set_row_excluded(
            boq_name=self.boq_name, sheet_name=self.SHEET, row_index=0, excluded=True,
        )
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 0), 1)
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 1), 1)
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 2), 1)

        # Now SELECT the deeply nested line item 2 -> pulls back ancestors 1 and 0.
        res = set_row_excluded(
            boq_name=self.boq_name, sheet_name=self.SHEET, row_index=2, excluded=False,
        )
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 0), 0)  # root re-included
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 1), 0)  # nested re-included
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 2), 0)  # the line item itself
        # Sibling line item 3 stays excluded (not on the ancestor chain of 2).
        self.assertEqual(_excluded(self.boq_name, self.SHEET, 3), 1)
        self.assertIn(0, res["included_indices"])
        self.assertIn(1, res["included_indices"])
        self.assertIn(2, res["included_indices"])
        self.assertIn(3, res["excluded_indices"])

    def test_string_truthy_excluded_coercion(self):
        # HTTP sends "1"/"true"/"yes" as strings.
        res = set_row_excluded(
            boq_name=self.boq_name, sheet_name=self.SHEET, row_index=3, excluded="true",
        )
        self.assertIn(3, res["excluded_indices"])
        res2 = set_row_excluded(
            boq_name=self.boq_name, sheet_name=self.SHEET, row_index=3, excluded="0",
        )
        self.assertIn(3, res2["included_indices"])

    # --- Guards / edge cases ------------------------------------------------

    def test_reject_upload_origin(self):
        with self.assertRaises(frappe.ValidationError):
            set_row_excluded(
                boq_name=self.upload_boq_name, sheet_name=self.SHEET,
                row_index=0, excluded=True,
            )

    def test_reject_unknown_row_index(self):
        with self.assertRaises(frappe.ValidationError):
            set_row_excluded(
                boq_name=self.boq_name, sheet_name=self.SHEET,
                row_index=999, excluded=True,
            )

    def test_reject_missing_boq(self):
        with self.assertRaises(frappe.ValidationError):
            set_row_excluded(
                boq_name="NON_EXISTENT_BOQ", sheet_name=self.SHEET,
                row_index=0, excluded=True,
            )

    def test_cycle_graph_terminates(self):
        # A cyclic effective parent graph must not hang the cascade (cycle-safe DFS).
        res = set_row_excluded(
            boq_name=self.boq_name, sheet_name=self.CYCLE_SHEET,
            row_index=10, excluded=True,
        )
        self.assertEqual(res["status"], "saved")
        # Both nodes in the cycle are eligible preambles -> both excluded.
        self.assertEqual(res["excluded_indices"], [10, 11])
