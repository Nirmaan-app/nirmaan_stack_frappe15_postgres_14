"""Pure review-carry payload tests (D6 + the 2026-07-20 owner amendment).

No Frappe: the caller reads the committed nodes + review rows; this module only decides what to
carry + the status stamp. Cases mirror the amended acceptance list: the PCC worked example (a
re-parented row lands on the twin's NEW row_index after an insert shifts it); the AI-ACCEPTED
REGRESSION (the whole reason for the amendment); effective-root; the `-1` sentinel; `level` never
in the payload; a missing parent twin -> `parent_lost` advisory; the full taxonomy carries; a
non-matched row carries nothing but its status; `Drifted` is never produced.

Every `_node` fixture deliberately leaves the human layer EMPTY (`human_classification=""`,
`human_parent=-1`, `human_is_root=0`) -- the exact shape commit writes for an AI-accepted row.
The carry must work anyway; that is the regression this file guards.
"""

import unittest
from dataclasses import fields as dataclass_fields

from nirmaan_stack.services.boq_revision.carry import (
    NO_PARENT,
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


def _node(name, desc, order, level=None, row_class="line_item", parent_node=None):
    """A committed BOQ Nodes row. `row_class` + `parent_node` are the EFFECTIVE values commit
    folded down (human > AI-accepted > parser). The human_* fields are included ONLY to prove the
    carry ignores them -- they are pinned at the blank/AI-accepted shape in every fixture."""
    return {
        "name": name, "description": desc, "source_row_number": order, "level": level,
        "row_class": row_class, "parent_node": parent_node,
        "human_classification": "", "human_parent": -1, "human_is_root": 0,
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


class TestAiAcceptedRegression(unittest.TestCase):
    """THE bug this amendment fixes: commit folds an accepted Claude/Gemini suggestion into
    `row_class` / `parent_node` and leaves `human_*` blank, so the old override-set carry read
    nothing and every AI-accepted decision was silently dropped."""

    def test_ai_accepted_classification_carries(self):
        # The parser said "note"; the human ACCEPTED the AI's "preamble" -> row_class=preamble,
        # human_classification="". The revised parse repeats the parser's mistake.
        nodes = [_node("n", "Supply and fix conduit", 1, row_class="preamble", level=1)]
        revs = [_rev(0, "Supply and fix conduit", 1, "note")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].classification, "preamble")
        self.assertEqual(carries[0].revision_carry_status, MATCHED)

    def test_ai_accepted_parent_carries(self):
        # An accepted AI parent lands on parent_node with human_parent still -1.
        nodes = [
            _node("secA", "Section A", 1, level=1, row_class="preamble"),
            _node("item", "Cable tray 300mm", 5, parent_node="secA"),
        ]
        revs = [
            _rev(0, "Section A", 1, "preamble", level=1),
            _rev(1, "Inserted line", 3),
            _rev(2, "Cable tray 300mm", 6),
        ]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[2].parent_index, 0)
        self.assertFalse(carries[2].parent_lost)


class TestParentRepoint(unittest.TestCase):
    def test_pcc_reparented_row_lands_on_twin_new_row_index(self):
        # ORIGINAL: "PCC 1:4:8 backfill" ended up under Section A (however that was decided).
        nodes = [
            _node("secA", "Section A", 1, level=1, row_class="preamble"),
            _node("secB", "Section B", 10, level=1, row_class="preamble"),
            _node("pcc", "PCC 1:4:8 backfill", 15, parent_node="secA"),
        ]
        # REVISED: an inserted row shifts everything; the parser repeats the mistake (B again).
        revs = [
            _rev(0, "Section A", 1, "preamble", level=1),
            _rev(1, "New inserted item", 5),           # NEW
            _rev(2, "Section B", 10, "preamble", level=1),
            _rev(3, "PCC 1:4:8 backfill", 16),          # parser would parent under B
        ]
        _match, carries = _run(nodes, revs)
        # Re-points to Section A's TWIN row_index (0), not the original's.
        self.assertEqual(carries[3].parent_index, 0)
        self.assertEqual(carries[3].revision_carry_status, MATCHED)
        self.assertEqual(carries[1].revision_carry_status, NEW)  # inserted row

    def test_parent_repoint_never_uses_sort_order(self):
        # A NEW row (row_index 0) shifts the section's twin to 1 -- distinct from the original's
        # own position, so a sort_order-based carry would land on the wrong row.
        nodes = [
            _node("sec", "The Section", 1, level=1, row_class="preamble"),
            _node("child", "The child item", 2, parent_node="sec"),
        ]
        revs = [
            _rev(0, "Intro line", 0, "note"),          # NEW -> shifts indexes down
            _rev(1, "The Section", 1, "preamble", level=1),
            _rev(2, "The child item", 2),
        ]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[2].parent_index, 1)

    def test_missing_parent_twin_flags_parent_lost(self):
        # The parent section was REMOVED (no twin) -> parent not carried, advisory flag raised,
        # and the row stays a calm MATCHED (its classification still carried).
        nodes = [
            _node("goneSec", "Deleted Section", 1, level=1, row_class="preamble"),
            _node("child", "Child item", 2, row_class="preamble", parent_node="goneSec"),
        ]
        revs = [_rev(0, "Child item", 2, "note")]  # the section is gone from the revised file
        _match, carries = _run(nodes, revs)
        self.assertIsNone(carries[0].parent_index)   # keeps the fresh parser's parent
        self.assertTrue(carries[0].parent_lost)
        self.assertEqual(carries[0].classification, "preamble")  # classification still carried
        self.assertEqual(carries[0].revision_carry_status, MATCHED)


class TestRoot(unittest.TestCase):
    def test_effective_root_writes_explicit_minus_one(self):
        # parent_node NULL on a committed node IS effective-root (commit links parent_node from
        # effective_parent_index) -> carry the explicit -1 sentinel, never null/0.
        nodes = [_node("r", "Root row", 1, level=1, row_class="preamble", parent_node=None)]
        revs = [_rev(0, "Root row", 1, "preamble", level=1)]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].parent_index, NO_PARENT)
        self.assertEqual(carries[0].parent_index, -1)
        self.assertFalse(carries[0].parent_lost)

    def test_twin_at_row_index_zero_is_a_real_parent_not_the_sentinel(self):
        nodes = [
            _node("sec", "Section", 1, level=1, row_class="preamble"),
            _node("child", "Child", 2, parent_node="sec"),
        ]
        revs = [_rev(0, "Section", 1, "preamble", level=1), _rev(1, "Child", 2)]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[1].parent_index, 0)  # a REAL parent at index 0
        self.assertNotEqual(carries[1].parent_index, NO_PARENT)


class TestClassificationCarry(unittest.TestCase):
    def test_effective_classification_always_carries_on_a_matched_row(self):
        nodes = [_node("n", "Some item", 1, row_class="preamble", level=1)]
        revs = [_rev(0, "Some item", 1, "line_item")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].classification, "preamble")

    def test_parser_only_taxonomy_carries(self):
        # subtotal_marker / header_repeat are NOT in _ASSIGNABLE_CLASSIFICATIONS -- they could
        # never ride the human layer. The parser layer carries them fine.
        for cls in ("subtotal_marker", "header_repeat", "note"):
            with self.subTest(cls=cls):
                nodes = [_node("n", f"Row {cls}", 1, row_class=cls)]
                revs = [_rev(0, f"Row {cls}", 1, "line_item")]
                _match, carries = _run(nodes, revs)
                self.assertEqual(carries[0].classification, cls)

    def test_agreeing_classification_is_a_harmless_no_op_write(self):
        nodes = [_node("n", "Steady item", 1, row_class="line_item")]
        revs = [_rev(0, "Steady item", 1, "line_item")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].classification, "line_item")
        self.assertEqual(carries[0].revision_carry_status, MATCHED)

    def test_blank_row_class_leaves_classification_untouched(self):
        nodes = [_node("n", "Odd row", 1, row_class="")]
        revs = [_rev(0, "Odd row", 1, "line_item")]
        _match, carries = _run(nodes, revs)
        self.assertIsNone(carries[0].classification)


class TestPayloadShape(unittest.TestCase):
    def test_level_never_in_the_payload(self):
        # Structural guarantee (ADR-0009): ReviewCarryWrite has no `level` field.
        self.assertNotIn("level", {f.name for f in dataclass_fields(ReviewCarryWrite)})

    def test_human_fields_never_in_the_payload(self):
        # The amendment writes the PARSER layer only -- no human_* field may be writable, or
        # `_row_has_override` would flip true sheet-wide and block Apply-AI.
        names = {f.name for f in dataclass_fields(ReviewCarryWrite)}
        self.assertFalse({n for n in names if n.startswith("human_")}, names)

    def test_drifted_is_never_produced(self):
        # A matched row whose fresh classification disagrees is simply CARRIED, not flagged.
        nodes = [_node("n", "Ambiguous text", 1, row_class="note")]
        revs = [_rev(0, "Ambiguous text", 1, "line_item")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].revision_carry_status, MATCHED)
        self.assertEqual(carries[0].classification, "note")

    def test_new_and_ambiguous_carry_nothing_but_status(self):
        nodes = [_node("a", "Dup", 2), _node("b", "Dup", 3)]
        revs = [_rev(0, "Dup", 2), _rev(1, "Dup", 3), _rev(2, "Dup", 4), _rev(3, "Fresh", 9)]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[3].revision_carry_status, NEW)
        self.assertEqual(carries[0].revision_carry_status, AMBIGUOUS)
        for rid in (0, 1, 2, 3):
            self.assertIsNone(carries[rid].classification)
            self.assertIsNone(carries[rid].parent_index)
            self.assertFalse(carries[rid].parent_lost)

    def test_unmatched_non_content_row_gets_no_stamp(self):
        nodes = [_node("n", "Real row", 1)]
        revs = [_rev(0, "Real row", 1), _rev(1, "", 2)]  # blank row skipped by the matcher
        _match, carries = _run(nodes, revs)
        self.assertIn(0, carries)
        self.assertNotIn(1, carries)


if __name__ == "__main__":
    unittest.main()
