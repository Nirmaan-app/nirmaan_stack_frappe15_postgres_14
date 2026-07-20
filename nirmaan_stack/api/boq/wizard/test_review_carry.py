"""Review-carry MERGE integration (ADR-0014 D6/D7 + **Amendment B** 2026-07-20).

The pure decisions are pinned in `services/boq_revision/test_row_match.py` (match) and
`.../test_carry.py` (payload). These tests exercise the WIRING in `merge_revision_review_carry`:
it reads the original's committed `BOQ Nodes` + the revision's freshly-parsed `BoQ Review Row`s,
matches on `same Excel row + same description`, and writes the original's EFFECTIVE classification
AND parenting into the revision's PARSER layer (`classification` / `parent_index`) plus the single
`Copied` stamp.

The fixture is one committed original DATA sheet whose carry surface covers every branch in ONE
merge: a plain copy, a brand-new row, an AI-ACCEPTED row (the Amendment A regression -- `row_class`
set with the human layer blank), a parser-only taxonomy value that could never ride the human layer
(`subtotal_marker`), a re-parented row (re-points to the twin's NEW row_index), an effective root,
a row whose PARENT was deleted (copies NOTHING -- both-or-neither), a row that MOVED (copies
nothing), and a blank spacer (no stamp).
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.review_carry import (
    merge_revision_review_carry,
    revision_review_counts,
    revision_source_boq,
)
from nirmaan_stack.api.boq.wizard.test_revision_entry import (
    _cleanup_project,
    _make_boq,
    _make_project,
)
from nirmaan_stack.api.boq.wizard.test_revision_mapping import _make_revision

_SHEET = "Data"


def _commit_node(boq, sheet_docname, node_type, row_class, description, source_row_number,
                 sort_order, level=None, parent_node=None):
    """A committed node. `row_class` + `parent_node` are the EFFECTIVE values commit folds down
    (human > AI-accepted > parser). The human_* fields are left at their blank defaults ON PURPOSE
    -- that is exactly the shape an AI-ACCEPTED row has on the committed tier, and the carry must
    work from `row_class` / `parent_node` alone."""
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
    node.human_classification = ""
    node.human_parent = -1
    node.human_is_root = 0
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
        rr.human_parent = -1          # fresh-parse defaults -- the carry must NOT touch these
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

        # Preambles / roots first (parent targets), then the rows that reference them.
        sec_a = _commit_node(cls.original.name, cls.sheet, "Preamble", "preamble",
                             "Section A", 1, 0, level=1)
        _commit_node(cls.original.name, cls.sheet, "Preamble", "preamble", "Section B", 10, 4, level=1)
        _commit_node(cls.original.name, cls.sheet, "Preamble", "preamble", "Root section", 20, 6,
                     level=1)
        _commit_node(cls.original.name, cls.sheet, "Line Item", "line_item", "Plain item", 2, 1,
                     parent_node=sec_a.name)
        # THE AMENDMENT-A REGRESSION: the human ACCEPTED an AI suggestion of 'preamble'. Commit
        # folded it into row_class and left human_classification blank -- an override-set carry saw
        # nothing. Amendment B still reads the effective value, so this must keep working.
        _commit_node(cls.original.name, cls.sheet, "Preamble", "preamble", "AI accepted item", 3, 2,
                     level=1, parent_node=sec_a.name)
        # A parser-only taxonomy value: NOT in _ASSIGNABLE_CLASSIFICATIONS, so it could never ride
        # the human layer -- the parser-layer write carries it fine.
        _commit_node(cls.original.name, cls.sheet, "Other", "subtotal_marker", "Subtotal row", 4, 3)
        # Effective parent = Section A (however decided); the revised parse will say Section B.
        # It keeps Excel row 15 in the revision, so it MATCHES and the re-point runs.
        _commit_node(cls.original.name, cls.sheet, "Line Item", "line_item", "PCC 1:4:8 backfill", 15, 5,
                     parent_node=sec_a.name)
        # A section GONE from the revision + its child -> the child fails condition 3 (both-or-neither).
        gone = _commit_node(cls.original.name, cls.sheet, "Preamble", "preamble",
                            "Deleted Section", 30, 7, level=1)
        _commit_node(cls.original.name, cls.sheet, "Line Item", "line_item", "Child of deleted", 31, 8,
                     parent_node=gone.name)
        # A row whose text survives but whose POSITION moves in the revision -> must not copy.
        _commit_node(cls.original.name, cls.sheet, "Preamble", "preamble", "Shifted item", 40, 9,
                     level=1)
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

    # row_index -> the fresh parse. `source_row_number` is the Excel row (the match key); note it is
    # deliberately NOT equal to row_index anywhere, so a positional confusion would show up.
    _REVISED = [
        {"row_index": 0, "source_row_number": 1, "classification": "preamble",
         "description": "Section A", "level": 1},
        {"row_index": 1, "source_row_number": 5, "classification": "line_item",
         "description": "New inserted item"},
        {"row_index": 2, "source_row_number": 2, "classification": "line_item",
         "description": "Plain item"},
        # The fresh parse repeats the mistake the AI accept had corrected.
        {"row_index": 3, "source_row_number": 3, "classification": "note",
         "description": "AI accepted item"},
        {"row_index": 4, "source_row_number": 4, "classification": "line_item",
         "description": "Subtotal row"},
        {"row_index": 5, "source_row_number": 10, "classification": "preamble",
         "description": "Section B", "level": 1},
        # The parser parents PCC under Section B (row_index 5); the carry re-points it to Section A
        # (row_index 0). Excel row 15 is unchanged, so it matches.
        {"row_index": 6, "source_row_number": 15, "classification": "line_item",
         "description": "PCC 1:4:8 backfill", "parent_index": 5},
        {"row_index": 7, "source_row_number": 20, "classification": "preamble",
         "description": "Root section", "level": 1},
        {"row_index": 8, "source_row_number": 99, "classification": "spacer", "description": ""},
        # Same Excel row + same text, but its original parent ("Deleted Section") is gone ->
        # condition 3 fails -> copies NOTHING (keeps the parse's own 'note' + parent 5).
        {"row_index": 9, "source_row_number": 31, "classification": "note",
         "description": "Child of deleted", "parent_index": 5},
        # Same text, MOVED from Excel row 40 to 41 -> no match -> copies nothing.
        {"row_index": 10, "source_row_number": 41, "classification": "note",
         "description": "Shifted item"},
    ]

    _COPIED_ROWS = (0, 2, 3, 4, 5, 6, 7)
    _NOT_COPIED_ROWS = (1, 9, 10)

    def _merge(self):
        rev, names = _seed_revision(self.project.name, self.original.name, self._REVISED)
        summary = merge_revision_review_carry(rev, _SHEET, self.original.name)
        frappe.db.commit()
        rows = {idx: frappe.db.get_value(
            "BoQ Review Row", name,
            ["revision_carry_status", "classification", "parent_index",
             "human_classification", "human_parent", "human_is_root"],
            as_dict=True,
        ) for idx, name in names.items()}
        return rev, summary, rows

    def test_copied_rows_are_stamped(self):
        _rev, _summary, rows = self._merge()
        for idx in self._COPIED_ROWS:
            self.assertEqual(rows[idx].revision_carry_status, "Copied", f"row {idx}")

    def test_non_copied_rows_get_no_stamp(self):
        # Blank status is what makes a non-copied row render "Original", identical to a fresh upload.
        _rev, _summary, rows = self._merge()
        for idx in self._NOT_COPIED_ROWS:
            self.assertIn(rows[idx].revision_carry_status, (None, ""), f"row {idx}")

    def test_retired_statuses_are_never_stamped(self):
        _rev, _summary, rows = self._merge()
        stamped = {r.revision_carry_status for r in rows.values()}
        self.assertFalse(stamped & {"Matched", "New", "Ambiguous", "Drifted"}, stamped)

    def test_blank_spacer_gets_no_stamp(self):
        _rev, _summary, rows = self._merge()
        self.assertIn(rows[8].revision_carry_status, (None, ""))

    def test_ai_accepted_classification_carries(self):
        # THE Amendment A regression: the fresh parse said 'note'; the accepted 'preamble' wins.
        _rev, _summary, rows = self._merge()
        self.assertEqual(rows[3].classification, "preamble")

    def test_parser_only_taxonomy_carries(self):
        # subtotal_marker is not human-assignable -- proof the parser-layer write has no vocab gate.
        _rev, _summary, rows = self._merge()
        self.assertEqual(rows[4].classification, "subtotal_marker")

    def test_parent_repoint_to_twin_row_index(self):
        # The effective parent was Section A; its twin is row_index 0 -- NOT the original's
        # sort_order, and NOT the parser's Section B (5).
        _rev, _summary, rows = self._merge()
        self.assertEqual(rows[6].parent_index, 0)

    def test_effective_root_carries_minus_one(self):
        _rev, _summary, rows = self._merge()
        self.assertEqual(rows[7].parent_index, -1)   # explicit -1, never null/0

    def test_unmatched_parent_copies_nothing_at_all(self):
        # BOTH-OR-NEITHER. The old rule kept this row "Matched" and still carried its
        # classification while flagging `parent_lost`; Amendment B leaves it completely alone.
        _rev, _summary, rows = self._merge()
        self.assertEqual(rows[9].classification, "note")   # the PARSE's value, not the node's
        self.assertEqual(rows[9].parent_index, 5)          # untouched fresh-parse value
        self.assertIn(rows[9].revision_carry_status, (None, ""))

    def test_moved_row_copies_nothing(self):
        _rev, _summary, rows = self._merge()
        self.assertEqual(rows[10].classification, "note")  # not the original's 'preamble'
        self.assertIn(rows[10].revision_carry_status, (None, ""))

    def test_human_layer_is_never_written(self):
        # The carry writes the PARSER layer only -- if it touched human_*, `_row_has_override`
        # would flip true on every copied row and block Apply-AI sheet-wide.
        _rev, _summary, rows = self._merge()
        for idx, row in rows.items():
            self.assertIn(row.human_classification, (None, ""), f"row {idx}")
            self.assertEqual(row.human_parent, -1, f"row {idx}")
            self.assertEqual(row.human_is_root, 0, f"row {idx}")

    def test_summary_counts(self):
        _rev, summary, _rows = self._merge()
        self.assertEqual(summary["copied"], len(self._COPIED_ROWS))
        self.assertEqual(summary["needs_review"], len(self._NOT_COPIED_ROWS))
        # total = CONTENT rows only; the blank spacer (row 8) is excluded.
        self.assertEqual(summary["total"],
                         len(self._COPIED_ROWS) + len(self._NOT_COPIED_ROWS))
        for retired in ("matched", "new", "ambiguous", "drifted", "parent_lost", "removed"):
            self.assertNotIn(retired, summary)

    def test_counts_read_path_agrees_with_the_merge_summary(self):
        # `revision_review_counts` derives from the PERSISTED stamp rather than re-running the
        # match -- the two must not be able to disagree.
        rev, summary, _rows = self._merge()
        self.assertEqual(revision_review_counts(rev, _SHEET), summary)


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
        self.assertEqual(summary, {"copied": 0, "needs_review": 0, "total": 0})

    def test_counts_are_zero_for_a_sheet_with_no_rows(self):
        rev = _make_revision(self.project.name, self.original.name)
        self.assertEqual(revision_review_counts(rev.name, "Nope"),
                         {"copied": 0, "needs_review": 0, "total": 0})


if __name__ == "__main__":
    frappe.init(site="localhost")
    frappe.connect()
    import unittest
    unittest.main()
