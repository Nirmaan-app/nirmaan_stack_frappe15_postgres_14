"""S5a/S6 (#1102, ADR-0014 D6/D7) -- review-carry MERGE integration.

The pure decisions are pinned in `services/boq_revision/test_row_match.py` (match) and
`.../test_carry.py` (override payload). These tests exercise the WIRING in
`merge_revision_review_carry`: it reads the original's committed `BOQ Nodes` + the revision's
freshly-parsed `BoQ Review Row`s, matches by D6, and stamps `revision_carry_status` + carries
the human override set (classification, relational parent re-point, root) onto the review rows.

The fixture is one committed original DATA sheet whose review-carry surface covers every branch
in ONE merge: a plain match, a New row, a carried classification, drift, a re-parented row
(override lands on the twin's NEW row_index), a root, and a blank spacer (no stamp).
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.review_carry import (
    revision_source_boq,
    merge_revision_review_carry,
)
from nirmaan_stack.api.boq.wizard.test_revision_entry import (
    _cleanup_project,
    _make_boq,
    _make_project,
)
from nirmaan_stack.api.boq.wizard.test_revision_mapping import _make_revision

_SHEET = "Data"


def _commit_node(boq, sheet_docname, node_type, row_class, description, source_row_number,
                 sort_order, level=None, human_classification="", human_parent=-1,
                 human_is_root=0, parent_node=None):
    node = frappe.new_doc("BOQ Nodes")
    node.sheet = sheet_docname          # boq auto-fills from the sheet
    node.boq = boq
    node.node_type = node_type
    node.row_class = row_class
    node.description = description
    node.source_row_number = source_row_number
    node.sort_order = sort_order
    if level is not None:
        node.level = level
    if node_type == "Line Item":
        node.qty = 0                    # required (0 for rate-only)
    node.human_classification = human_classification
    node.human_parent = human_parent
    node.human_is_root = human_is_root
    if parent_node:
        node.parent_node = parent_node
    node.commit_version = 1
    node.is_current = 1
    node.committed_at = frappe.utils.now()
    node.insert(ignore_permissions=True)
    return node


def _seed_revision(project, original, review_specs, source_sheet_name=_SHEET, sheet=_SHEET):
    """A revision doc with one mapped draft + the given review rows; returns (name, {idx: name})."""
    rev = _make_revision(project, original)
    rev_doc = frappe.get_doc("BOQs", rev.name)
    rev_doc.append("sheet_drafts", {
        "sheet_name": sheet,
        "sheet_order": 1,
        "wizard_status": "Pending",
        "source_sheet_name": source_sheet_name,
    })
    rev_doc.save(ignore_permissions=True)

    names: dict[int, str] = {}
    for spec in review_specs:
        rr = frappe.new_doc("BoQ Review Row")
        rr.boq = rev.name
        rr.sheet_name = sheet
        rr.row_index = spec["row_index"]
        rr.source_row_number = spec["source_row_number"]
        rr.classification = spec["classification"]
        rr.description = spec.get("description", "")
        rr.parent_index = spec.get("parent_index", -1)
        rr.human_parent = -1          # fresh-parse defaults (the carry overwrites when carried)
        rr.human_is_root = 0
        if spec.get("level") is not None:
            rr.level = spec["level"]
        rr.insert(ignore_permissions=True)
        names[spec["row_index"]] = rr.name
    frappe.db.commit()
    return rev.name, names


class TestReviewCarryMerge(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="CARRY ORIG")

        bs = frappe.new_doc("BoQ Sheet")
        bs.boq = cls.original.name
        bs.sheet_name = _SHEET
        bs.sheet_order = 1
        bs.treat_as = "data"
        bs.is_current = 1
        bs.commit_version = 1
        bs.committed_at = frappe.utils.now()
        bs.insert(ignore_permissions=True)
        cls.sheet = bs.name

        # Preambles / roots first (parent targets), then the items that reference them.
        sec_a = _commit_node(cls.original.name, cls.sheet, "Preamble", "preamble",
                             "Section A", 1, 0, level=1)
        _commit_node(cls.original.name, cls.sheet, "Preamble", "preamble", "Section B", 10, 4, level=1)
        _commit_node(cls.original.name, cls.sheet, "Preamble", "preamble", "Root section", 20, 6,
                     level=1, human_is_root=1)
        _commit_node(cls.original.name, cls.sheet, "Line Item", "line_item", "Plain item", 2, 1,
                     parent_node=sec_a.name)
        # A human RECLASSIFIED this row -> committed effective row_class = the human value.
        _commit_node(cls.original.name, cls.sheet, "Line Item", "line_item", "Reclassified item", 3, 2,
                     human_classification="line_item", parent_node=sec_a.name)
        # No override; committed row_class 'note' (an "Other" node).
        _commit_node(cls.original.name, cls.sheet, "Other", "note", "Drift item", 4, 3)
        # Human re-parented PCC to Section A (parent_node = sec_a); human_parent >= 0.
        _commit_node(cls.original.name, cls.sheet, "Line Item", "line_item", "PCC 1:4:8 backfill", 15, 5,
                     human_parent=0, parent_node=sec_a.name)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for boq in frappe.get_all("BOQs", filters={"project": cls.project.name}, fields=["name"]):
            frappe.db.delete("BoQ Review Row", {"boq": boq.name})
            frappe.db.delete("BOQ Nodes", {"boq": boq.name})
            frappe.db.delete("BoQ Sheet", {"boq": boq.name})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    _REVISED = [
        {"row_index": 0, "source_row_number": 1, "classification": "preamble",
         "description": "Section A", "level": 1},
        {"row_index": 1, "source_row_number": 5, "classification": "line_item",
         "description": "New inserted item"},
        {"row_index": 2, "source_row_number": 2, "classification": "line_item",
         "description": "Plain item"},
        {"row_index": 3, "source_row_number": 3, "classification": "note",
         "description": "Reclassified item"},
        {"row_index": 4, "source_row_number": 4, "classification": "line_item",
         "description": "Drift item"},
        {"row_index": 5, "source_row_number": 10, "classification": "preamble",
         "description": "Section B", "level": 1},
        {"row_index": 6, "source_row_number": 16, "classification": "line_item",
         "description": "PCC 1:4:8 backfill"},
        {"row_index": 7, "source_row_number": 20, "classification": "preamble",
         "description": "Root section", "level": 1},
        {"row_index": 8, "source_row_number": 99, "classification": "spacer", "description": ""},
    ]

    def _merge(self):
        rev, names = _seed_revision(self.project.name, self.original.name, self._REVISED)
        summary = merge_revision_review_carry(rev, _SHEET, self.original.name)
        frappe.db.commit()
        rows = {idx: frappe.db.get_value(
            "BoQ Review Row", name,
            ["revision_carry_status", "human_classification", "human_parent", "human_is_root"],
            as_dict=True,
        ) for idx, name in names.items()}
        return summary, rows

    def test_statuses_stamped(self):
        _summary, rows = self._merge()
        self.assertEqual(rows[0].revision_carry_status, "Matched")
        self.assertEqual(rows[1].revision_carry_status, "New")
        self.assertEqual(rows[2].revision_carry_status, "Matched")
        self.assertEqual(rows[3].revision_carry_status, "Matched")   # override masks drift
        self.assertEqual(rows[4].revision_carry_status, "Drifted")
        self.assertEqual(rows[5].revision_carry_status, "Matched")
        self.assertEqual(rows[6].revision_carry_status, "Matched")
        self.assertEqual(rows[7].revision_carry_status, "Matched")

    def test_blank_spacer_gets_no_stamp(self):
        _summary, rows = self._merge()
        self.assertIn(rows[8].revision_carry_status, (None, ""))

    def test_classification_override_carried(self):
        _summary, rows = self._merge()
        self.assertEqual(rows[3].human_classification, "line_item")

    def test_parent_repoint_to_twin_row_index(self):
        # PCC's override pointed at Section A; Section A's twin is row_index 0, so human_parent=0
        # -- NOT the original's sort_order, and NOT the parser's Section B.
        _summary, rows = self._merge()
        self.assertEqual(rows[6].human_parent, 0)
        self.assertEqual(rows[6].human_is_root, 0)

    def test_root_override_carried(self):
        _summary, rows = self._merge()
        self.assertEqual(rows[7].human_is_root, 1)
        self.assertEqual(rows[7].human_parent, -1)   # explicit -1, never null/0

    def test_plain_matched_row_carries_no_override(self):
        _summary, rows = self._merge()
        self.assertIn(rows[2].human_classification, (None, ""))
        self.assertEqual(rows[2].human_parent, -1)   # kept the fresh-parse default
        self.assertEqual(rows[2].human_is_root, 0)

    def test_summary_counts(self):
        summary, _rows = self._merge()
        self.assertEqual(summary["new"], 1)
        self.assertEqual(summary["drifted"], 1)
        self.assertEqual(summary["matched"], 6)      # rows 0,2,3,5,6,7
        # 'Reclassified item' and 'Drift item' both exist on the original -> no removed rows.
        self.assertEqual(summary["removed"], 0)


class TestRevisionSourceGuard(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="GUARD ORIG")

    @classmethod
    def tearDownClass(cls):
        for boq in frappe.get_all("BOQs", filters={"project": cls.project.name}, fields=["name"]):
            frappe.db.delete("BoQ Review Row", {"boq": boq.name})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def test_upload_boq_is_not_a_revision_source(self):
        # The seam is skipped for a non-revision parse (byte-identical) -- the guard returns None.
        self.assertIsNone(revision_source_boq(self.original.name))

    def test_revision_boq_returns_its_source(self):
        rev = _make_revision(self.project.name, self.original.name)
        self.assertEqual(revision_source_boq(rev.name), self.original.name)

    def test_merge_noops_for_unmapped_sheet(self):
        # A revision draft with no source_sheet_name (declared New) carries nothing.
        rev = _make_revision(self.project.name, self.original.name)
        rev_doc = frappe.get_doc("BOQs", rev.name)
        rev_doc.append("sheet_drafts", {"sheet_name": "Fresh", "sheet_order": 1,
                                        "wizard_status": "Pending", "source_sheet_name": None})
        rev_doc.save(ignore_permissions=True)
        frappe.db.commit()
        summary = merge_revision_review_carry(rev.name, "Fresh", self.original.name)
        self.assertEqual(summary["matched"], 0)
        self.assertEqual(summary["new"], 0)


if __name__ == "__main__":
    frappe.init(site="localhost")
    frappe.connect()
    import unittest
    unittest.main()
