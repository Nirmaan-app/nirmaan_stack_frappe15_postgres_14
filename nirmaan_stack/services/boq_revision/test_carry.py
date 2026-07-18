"""S5a/S6 (#1102, ADR-0014 D7) -- pure review-carry payload tests.

No Frappe: the caller reads the committed nodes + review rows; this module only decides the
override carry + status stamp. Cases mirror the plan's S6 acceptance list: the PCC worked
example (a re-parented row's override lands on the twin's NEW row_index after an insert shifts
it); root override; the `-1` sentinel; `level` never in the payload; a missing twin -> parent
dropped; drift detection; a non-matched row carries nothing but its status.
"""

import unittest
from dataclasses import fields as dataclass_fields

from nirmaan_stack.services.boq_revision.carry import (
    DRIFTED,
    ReviewCarryWrite,
    build_review_carry,
)
from nirmaan_stack.services.boq_revision.row_match import (
    AMBIGUOUS,
    MATCHED,
    NEW,
    MatchRow,
    match_rows,
)


def _node(name, desc, order, level=None, row_class="line_item",
          human_classification="", human_parent=-1, human_is_root=0, parent_node=None):
    return {
        "name": name, "description": desc, "source_row_number": order, "level": level,
        "row_class": row_class, "human_classification": human_classification,
        "human_parent": human_parent, "human_is_root": human_is_root, "parent_node": parent_node,
    }


def _mr(node):
    return MatchRow(row_id=node["name"], description=node["description"],
                    order=node["source_row_number"], level=node["level"])


def _rev(row_id, desc, order, classification="line_item", level=None):
    return {"row_id": row_id, "description": desc, "order": order,
            "classification": classification, "level": level}


def _rev_mr(rev):
    return MatchRow(row_id=rev["row_id"], description=rev["description"],
                    order=rev["order"], level=rev["level"])


def _run(nodes, revs):
    match = match_rows([_mr(n) for n in nodes], [_rev_mr(r) for r in revs])
    carries = build_review_carry(revs, {n["name"]: n for n in nodes}, match)
    return match, carries


class TestParentRepoint(unittest.TestCase):
    def test_pcc_reparented_override_lands_on_twin_new_row_index(self):
        # ORIGINAL: the human re-parented "PCC 1:4:8 backfill" from Section B to Section A.
        nodes = [
            _node("secA", "Section A", 1, level=1, row_class="preamble"),
            _node("secB", "Section B", 10, level=1, row_class="preamble"),
            _node("pcc", "PCC 1:4:8 backfill", 15,
                  human_parent=0, parent_node="secA"),  # override -> Section A
        ]
        # REVISED: an inserted row shifts everything; the parser repeats the mistake (B again).
        revs = [
            _rev(0, "Section A", 1, "preamble", level=1),
            _rev(1, "New inserted item", 5),           # NEW
            _rev(2, "Section B", 10, "preamble", level=1),
            _rev(3, "PCC 1:4:8 backfill", 16),          # parser would parent under B
        ]
        _match, carries = _run(nodes, revs)
        # The override re-points to Section A's TWIN row_index (0), not the original's.
        self.assertEqual(carries[3].human_parent, 0)
        self.assertEqual(carries[3].revision_carry_status, MATCHED)
        self.assertIsNone(carries[3].human_is_root)
        self.assertEqual(carries[1].revision_carry_status, NEW)  # inserted row

    def test_parent_repoint_never_uses_sort_order(self):
        # The parent's ORIGINAL row_index (sort_order) is 99; carry must use the TWIN's index.
        # A NEW row (row_index 0) shifts the section's twin to 1, distinct from both 0 and 99.
        nodes = [
            _node("sec", "The Section", 1, level=1, row_class="preamble"),
            _node("child", "The child item", 2, human_parent=99, parent_node="sec"),
        ]
        revs = [
            _rev(0, "Intro line", 0, "note"),          # NEW -> shifts indexes down
            _rev(1, "The Section", 1, "preamble", level=1),
            _rev(2, "The child item", 2),
        ]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[2].human_parent, 1)  # sec's twin row_index, NOT 99 or 0

    def test_missing_parent_twin_drops_the_parent(self):
        # The override points at a section that was REMOVED (no twin) -> parent not carried.
        nodes = [
            _node("goneSec", "Deleted Section", 1, level=1, row_class="preamble"),
            _node("child", "Child item", 2, human_parent=0, parent_node="goneSec"),
        ]
        revs = [_rev(0, "Child item", 2)]  # the section is gone from the revised file
        _match, carries = _run(nodes, revs)
        self.assertIsNone(carries[0].human_parent)  # dropped -> keeps parser default (-1)
        self.assertEqual(carries[0].revision_carry_status, MATCHED)


class TestRootOverride(unittest.TestCase):
    def test_root_writes_is_root_and_minus_one_parent(self):
        nodes = [_node("r", "Root row", 1, level=1, row_class="preamble",
                       human_is_root=1, human_parent=-1)]
        revs = [_rev(0, "Root row", 1, "preamble", level=1)]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].human_is_root, 1)
        self.assertEqual(carries[0].human_parent, -1)  # explicit -1, never null/0

    def test_root_takes_precedence_over_parent(self):
        # A contradictory node (root + a parent index) resolves to ROOT (mirrors resolve_effective).
        nodes = [_node("r", "Root row", 1, level=1, row_class="preamble",
                       human_is_root=1, human_parent=5, parent_node="whatever")]
        revs = [_rev(0, "Root row", 1, "preamble", level=1)]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].human_is_root, 1)
        self.assertEqual(carries[0].human_parent, -1)


class TestClassificationCarryAndDrift(unittest.TestCase):
    def test_classification_override_carries(self):
        nodes = [_node("n", "Some item", 1, row_class="preamble",
                       human_classification="line_item")]
        revs = [_rev(0, "Some item", 1, "preamble")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].human_classification, "line_item")
        # A carried classification masks drift even though row_class(preamble)!=classification.
        self.assertEqual(carries[0].revision_carry_status, MATCHED)

    def test_drift_when_parser_reclassifies_and_no_override(self):
        # Original ended up a note (row_class), the fresh parse now says line_item -> Drifted.
        nodes = [_node("n", "Ambiguous text", 1, row_class="note")]
        revs = [_rev(0, "Ambiguous text", 1, "line_item")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].revision_carry_status, DRIFTED)
        self.assertIsNone(carries[0].human_classification)

    def test_no_drift_when_classification_agrees(self):
        nodes = [_node("n", "Steady item", 1, row_class="line_item")]
        revs = [_rev(0, "Steady item", 1, "line_item")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].revision_carry_status, MATCHED)

    def test_carried_parent_override_suppresses_drift(self):
        # A row that carried a human parent override is calm "Matched" even if its parser
        # classification drifted -- the human already engaged (Edited != Drifted, disjoint sets).
        nodes = [
            _node("sec", "The Section", 1, level=1, row_class="preamble"),
            _node("child", "Child item", 2, row_class="note", human_parent=0, parent_node="sec"),
        ]
        revs = [_rev(0, "The Section", 1, "preamble", level=1), _rev(1, "Child item", 2, "line_item")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[1].human_parent, 0)
        self.assertEqual(carries[1].revision_carry_status, MATCHED)  # NOT Drifted


class TestPayloadShape(unittest.TestCase):
    def test_level_never_in_the_payload(self):
        # Structural guarantee: ReviewCarryWrite has no `level` field, so level can't carry.
        self.assertNotIn("level", {f.name for f in dataclass_fields(ReviewCarryWrite)})

    def test_plain_matched_row_carries_only_status(self):
        nodes = [_node("n", "Plain row", 1, row_class="line_item")]
        revs = [_rev(0, "Plain row", 1, "line_item")]
        _match, carries = _run(nodes, revs)
        w = carries[0]
        self.assertEqual(w.revision_carry_status, MATCHED)
        self.assertIsNone(w.human_classification)
        self.assertIsNone(w.human_parent)  # keeps the fresh-parse -1
        self.assertIsNone(w.human_is_root)

    def test_new_and_ambiguous_carry_no_override(self):
        nodes = [_node("a", "Dup", 2), _node("b", "Dup", 3)]
        revs = [_rev(0, "Dup", 2), _rev(1, "Dup", 3), _rev(2, "Dup", 4), _rev(3, "Fresh", 9)]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[3].revision_carry_status, NEW)
        self.assertEqual(carries[0].revision_carry_status, AMBIGUOUS)
        for rid in (0, 1, 2, 3):
            self.assertIsNone(carries[rid].human_classification)
            self.assertIsNone(carries[rid].human_parent)


if __name__ == "__main__":
    unittest.main()
