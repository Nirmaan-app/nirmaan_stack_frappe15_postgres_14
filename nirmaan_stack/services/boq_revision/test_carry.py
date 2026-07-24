"""Pure review-carry payload tests (ADR-0014 D7 + **Amendment B** 2026-07-20).

No Frappe: the caller reads the committed nodes + review rows; this module only decides what to
copy. Cases mirror the amendment's acceptance list:

  * the AI-ACCEPTED REGRESSION (Amendment A's reason for existing) still holds;
  * the INVERSE of the old PCC test -- an inserted row means the rows below are NOT carried
    (`test_pcc_reparented_row_lands_on_twin_new_row_index` is DELETED: it asserted the carry BEATS
    the fresh parser, which is exactly the defect Amendment B removes);
  * BOTH-OR-NEITHER -- an unmatched parent means the row copies nothing at all, not even its
    classification (this replaces the retired `parent_lost` advisory);
  * effective-root -> the explicit `-1`; a twin at row_index 0 is a REAL parent;
  * the full taxonomy carries (the parser layer has no `_ASSIGNABLE_CLASSIFICATIONS` gate);
  * `level` and the human_* fields are structurally absent from the payload;
  * a non-copied row is ABSENT from the result entirely -- the caller must not touch it.

Every `_node` fixture deliberately leaves the human layer EMPTY (`human_classification=""`,
`human_parent=-1`, `human_is_root=0`) -- the exact shape commit writes for an AI-accepted row. The
carry must work anyway; that is the Amendment A regression this file still guards.
"""

import unittest
from dataclasses import fields as dataclass_fields

from nirmaan_stack.services.boq_revision.carry import (
    COPIED,
    NO_PARENT,
    ReviewCarryWrite,
    build_review_carry,
    decide_review_carry,
    explain_non_carry,
)
from nirmaan_stack.services.boq_revision.reasons import (
    PARENT_NOT_CARRIED,
    SOURCE_UNCLASSIFIED,
)
from nirmaan_stack.services.boq_revision.row_match import MatchRow, match_rows


def _node(name, desc, excel_row, row_class="line_item", parent_node=None):
    """A committed BOQ Nodes row. `row_class` + `parent_node` are the EFFECTIVE values commit folded
    down (human > AI-accepted > parser). The human_* fields are included ONLY to prove the carry
    ignores them -- they are pinned at the blank/AI-accepted shape in every fixture."""
    return {
        "name": name, "description": desc, "source_row_number": excel_row,
        "row_class": row_class, "parent_node": parent_node,
        "human_classification": "", "human_parent": -1, "human_is_root": 0,
    }


def _rev(row_id, desc, excel_row, classification="line_item"):
    """A freshly-parsed revision review row. `row_id` IS the `row_index` (what `parent_index` points
    at); `excel_row` is `source_row_number` (the match key). They are deliberately different numbers
    in most fixtures so a sort_order-style carry would visibly land wrong."""
    return {"row_id": row_id, "description": desc, "excel_row": excel_row,
            "classification": classification}


def _run(nodes, revs):
    match = match_rows(
        [MatchRow(row_id=n["name"], excel_row=n["source_row_number"],
                  description=n["description"]) for n in nodes],
        [MatchRow(row_id=r["row_id"], excel_row=r["excel_row"],
                  description=r["description"]) for r in revs],
    )
    carries = build_review_carry(revs, {n["name"]: n for n in nodes}, match)
    return match, carries


class TestAiAcceptedRegression(unittest.TestCase):
    """Amendment A's bug: commit folds an accepted Claude/Gemini suggestion into `row_class` /
    `parent_node` and leaves `human_*` blank, so an override-set carry read nothing. Amendment B
    keeps reading the effective value -- these must not regress."""

    def test_ai_accepted_classification_carries(self):
        # The parser said "note"; the human ACCEPTED the AI's "preamble" -> row_class=preamble,
        # human_classification="". The revised parse repeats the parser's mistake.
        nodes = [_node("n", "Supply and fix conduit", 1, row_class="preamble")]
        revs = [_rev(0, "Supply and fix conduit", 1, "note")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].classification, "preamble")
        self.assertEqual(carries[0].revision_carry_status, COPIED)

    def test_ai_accepted_parent_carries_when_nothing_moved(self):
        # An accepted AI parent lands on parent_node with human_parent still -1. Both rows sit at
        # their original Excel positions, so both match and the parent re-points.
        nodes = [
            _node("secA", "Section A", 1, row_class="preamble"),
            _node("item", "Cable tray 300mm", 5, parent_node="secA"),
        ]
        revs = [
            _rev(0, "Section A", 1, "preamble"),
            _rev(1, "Cable tray 300mm", 5),
        ]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[1].parent_index, 0)


class TestInsertStopsTheCarry(unittest.TestCase):
    """THE Amendment B behaviour. The deleted `test_pcc_reparented_row_lands_on_twin_new_row_index`
    asserted the opposite -- that the carry beats the fresh parser after an insert. It does not any
    more, and must not."""

    def test_inserted_row_means_rows_below_are_not_carried(self):
        # ORIGINAL: "PCC 1:4:8 backfill" sat at Excel row 15 under Section A.
        nodes = [
            _node("secA", "Section A", 1, row_class="preamble"),
            _node("secB", "Section B", 10, row_class="preamble"),
            _node("pcc", "PCC 1:4:8 backfill", 15, parent_node="secA"),
        ]
        # REVISED: a row is inserted above it, so PCC now sits at Excel row 16. Its position no
        # longer matches -> it copies NOTHING and the fresh parser owns it entirely.
        revs = [
            _rev(0, "Section A", 1, "preamble"),
            _rev(1, "New inserted item", 5),
            _rev(2, "Section B", 10, "preamble"),
            _rev(3, "PCC 1:4:8 backfill", 16),
        ]
        _match, carries = _run(nodes, revs)
        self.assertNotIn(3, carries, "a shifted row must not carry -- this is the whole amendment")
        self.assertNotIn(1, carries, "an inserted row has no original to copy from")
        # The rows ABOVE the insert are untouched by the shift and still carry.
        self.assertEqual(carries[0].revision_carry_status, COPIED)
        self.assertEqual(carries[2].revision_carry_status, COPIED)

    def test_new_heading_keeps_its_children_because_they_shifted(self):
        # The defect scenario: a heading inserted above a section. Every row below shifts by one,
        # so none of them can match -> none can be dragged back under the OLD heading, and the
        # parser's parenting (under the new heading) survives.
        nodes = [
            _node("old", "Old Heading", 1, row_class="preamble"),
            _node("a", "Item A", 2, parent_node="old"),
            _node("b", "Item B", 3, parent_node="old"),
        ]
        revs = [
            _rev(0, "Old Heading", 1, "preamble"),
            _rev(1, "Newly Inserted Heading", 2, "preamble"),
            _rev(2, "Item A", 3),
            _rev(3, "Item B", 4),
        ]
        _match, carries = _run(nodes, revs)
        self.assertNotIn(2, carries)
        self.assertNotIn(3, carries)

    def test_deleted_row_stops_the_carry_below_it_too(self):
        nodes = [
            _node("sec", "Section", 1, row_class="preamble"),
            _node("gone", "Deleted row", 2),
            _node("tail", "Trailing item", 3, parent_node="sec"),
        ]
        revs = [_rev(0, "Section", 1, "preamble"), _rev(1, "Trailing item", 2)]
        _match, carries = _run(nodes, revs)
        self.assertNotIn(1, carries)


class TestBothOrNeither(unittest.TestCase):
    def test_unmatched_parent_means_the_row_copies_nothing(self):
        # The parent section was removed, so it has no twin. Under the OLD rule this row stayed
        # MATCHED, kept the fresh parser's parent, and still carried its classification (flagged
        # `parent_lost`). Amendment B: it copies NOTHING -- both or neither.
        nodes = [
            _node("goneSec", "Deleted Section", 1, row_class="preamble"),
            _node("child", "Child item", 2, row_class="preamble", parent_node="goneSec"),
        ]
        # The child kept its Excel row, so conditions 1+2 pass -- only condition 3 fails.
        revs = [_rev(0, "Replacement Section", 1, "preamble"), _rev(1, "Child item", 2, "note")]
        _match, carries = _run(nodes, revs)
        self.assertNotIn(1, carries, "condition 3 failed -> no classification either")

    def test_blank_row_class_copies_nothing(self):
        # Defensive: a node with no effective classification has no complete answer to give, so the
        # parent must not be carried alone.
        nodes = [_node("n", "Odd row", 1, row_class="")]
        revs = [_rev(0, "Odd row", 1)]
        _match, carries = _run(nodes, revs)
        self.assertNotIn(0, carries)

    def test_a_copied_row_always_has_both_fields(self):
        nodes = [
            _node("sec", "Section", 1, row_class="preamble"),
            _node("kid", "Kid", 2, parent_node="sec"),
        ]
        revs = [_rev(0, "Section", 1), _rev(1, "Kid", 2)]
        _match, carries = _run(nodes, revs)
        for write in carries.values():
            self.assertTrue(write.classification)
            self.assertIsNotNone(write.parent_index)


class TestRoot(unittest.TestCase):
    def test_effective_root_writes_explicit_minus_one(self):
        # parent_node NULL on a committed node IS effective-root (commit links parent_node from
        # effective_parent_index) -> carry the explicit -1 sentinel, never null/0.
        nodes = [_node("r", "Root row", 1, row_class="preamble", parent_node=None)]
        revs = [_rev(0, "Root row", 1, "preamble")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].parent_index, NO_PARENT)
        self.assertEqual(carries[0].parent_index, -1)

    def test_twin_at_row_index_zero_is_a_real_parent_not_the_sentinel(self):
        nodes = [
            _node("sec", "Section", 1, row_class="preamble"),
            _node("child", "Child", 2, parent_node="sec"),
        ]
        revs = [_rev(0, "Section", 1, "preamble"), _rev(1, "Child", 2)]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[1].parent_index, 0)  # a REAL parent at index 0
        self.assertNotEqual(carries[1].parent_index, NO_PARENT)

    def test_parent_repoint_uses_the_twins_row_index_never_the_originals_position(self):
        # The revision has an extra leading row, so the section's row_index (1) differs from its
        # Excel row (1) AND from the original's ordinal position (0). A sort_order-based carry
        # would land on row_index 0 -- the wrong row.
        nodes = [
            _node("sec", "The Section", 5, row_class="preamble"),
            _node("child", "The child item", 6, parent_node="sec"),
        ]
        revs = [
            _rev(0, "Intro line", 1, "note"),
            _rev(1, "The Section", 5, "preamble"),
            _rev(2, "The child item", 6),
        ]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[2].parent_index, 1)


class TestClassificationCarry(unittest.TestCase):
    def test_effective_classification_overrides_the_fresh_parse(self):
        nodes = [_node("n", "Some item", 1, row_class="preamble")]
        revs = [_rev(0, "Some item", 1, "line_item")]
        _match, carries = _run(nodes, revs)
        self.assertEqual(carries[0].classification, "preamble")

    def test_parser_only_taxonomy_carries(self):
        # subtotal_marker / header_repeat are NOT in _ASSIGNABLE_CLASSIFICATIONS -- they could never
        # ride the human layer. The parser layer carries them fine.
        for cls in ("subtotal_marker", "header_repeat", "note", "spacer"):
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
        self.assertEqual(carries[0].revision_carry_status, COPIED)


class TestPayloadShape(unittest.TestCase):
    def test_level_never_in_the_payload(self):
        # Structural guarantee (ADR-0009): ReviewCarryWrite has no `level` field.
        self.assertNotIn("level", {f.name for f in dataclass_fields(ReviewCarryWrite)})

    def test_human_fields_never_in_the_payload(self):
        # The carry writes the PARSER layer only -- no human_* field may be writable, or
        # `_row_has_override` would flip true sheet-wide and block Apply-AI.
        names = {f.name for f in dataclass_fields(ReviewCarryWrite)}
        self.assertFalse({n for n in names if n.startswith("human_")}, names)

    def test_parent_lost_is_retired_from_the_payload(self):
        self.assertNotIn("parent_lost", {f.name for f in dataclass_fields(ReviewCarryWrite)})

    def test_copied_is_the_only_status_ever_produced(self):
        nodes = [
            _node("a", "Alpha", 1, row_class="note"),
            _node("b", "Beta", 2, row_class="line_item"),
        ]
        revs = [_rev(0, "Alpha", 1), _rev(1, "Beta", 2), _rev(2, "Gamma", 3)]
        _match, carries = _run(nodes, revs)
        self.assertEqual({w.revision_carry_status for w in carries.values()}, {COPIED})

    def test_non_copied_rows_are_absent_not_stamped(self):
        # The caller writes ONLY what it finds here, so absence is how "leave this row alone" is
        # expressed. A stamped-but-empty entry would wrongly mark the row as revision-aware.
        nodes = [_node("n", "Real row", 1)]
        revs = [_rev(0, "Real row", 1), _rev(1, "Brand new row", 2)]
        _match, carries = _run(nodes, revs)
        self.assertIn(0, carries)
        self.assertNotIn(1, carries)

    def test_blank_description_row_is_never_copied(self):
        nodes = [_node("n", "Real row", 1)]
        revs = [_rev(0, "Real row", 1), _rev(1, "   ", 2)]
        _match, carries = _run(nodes, revs)
        self.assertNotIn(1, carries)


class TestKnownHole(unittest.TestCase):
    """⚠️ DOCUMENTED HOLE -- ADR-0014 D6 Amendment B, known hole #1. This test asserts the
    KNOWN-WRONG behaviour ON PURPOSE so that nobody "fixes" it by accident without reading the ADR.

    A net-zero span (a heading inserted at row 10, a row deleted at row 20) realigns rows 21+ onto
    their original positions, so they match and copy the OLD parent -- even though the newly
    inserted heading should have taken them. Closing this needs a span scan, which is exactly the
    complexity Amendment B removed. If you are here because this test failed, you have changed the
    match semantics: go read the ADR before deciding that is correct.
    """

    def test_net_zero_insert_and_delete_realigns_and_carries_the_old_parent(self):
        nodes = [
            _node("secA", "Section A", 1, row_class="preamble"),
            _node("doomed", "Row about to be deleted", 20),
            _node("tail", "Trailing item", 21, parent_node="secA"),
        ]
        revs = [
            _rev(0, "Section A", 1, "preamble"),
            _rev(1, "Newly Inserted Heading", 10, "preamble"),  # +1 below
            _rev(2, "Trailing item", 21),                        # -1 back => same Excel row
        ]
        _match, carries = _run(nodes, revs)
        # KNOWN-WRONG: it copies, and it re-points to Section A rather than the new heading.
        self.assertIn(2, carries)
        self.assertEqual(carries[2].parent_index, 0)


class TestExplainNonCarry(unittest.TestCase):
    """The reason half of the same decision (needs-review taxonomy).

    `explain_non_carry` covers ONLY rows that MATCHED and were still refused. A row that never
    matched is deliberately absent: its reason lives on the position/description axis, which needs
    both sides' rows and belongs to `diagnose.py`. Splitting it that way is what keeps a vague
    catch-all code out of the vocabulary.
    """

    def _reasons(self, nodes, revs, original_by_id=None):
        match = match_rows(
            [MatchRow(row_id=n["name"], excel_row=n["source_row_number"],
                      description=n["description"]) for n in nodes],
            [MatchRow(row_id=r["row_id"], excel_row=r["excel_row"],
                      description=r["description"]) for r in revs],
        )
        by_id = {n["name"]: n for n in nodes} if original_by_id is None else original_by_id
        return explain_non_carry(revs, by_id, match)

    def test_unmatched_parent_is_reported_as_parent_not_carried(self):
        nodes = [
            _node("goneSec", "Deleted Section", 1, row_class="preamble"),
            _node("child", "Child item", 2, row_class="preamble", parent_node="goneSec"),
        ]
        revs = [_rev(0, "Replacement Section", 1, "preamble"), _rev(1, "Child item", 2, "note")]
        self.assertEqual(self._reasons(nodes, revs)[1], PARENT_NOT_CARRIED)

    def test_blank_row_class_is_reported_as_source_unclassified(self):
        nodes = [_node("n", "Odd row", 1, row_class="")]
        revs = [_rev(0, "Odd row", 1)]
        self.assertEqual(self._reasons(nodes, revs)[0], SOURCE_UNCLASSIFIED)

    def test_a_matcher_node_map_disagreement_is_source_unclassified(self):
        # Defensive branch: the match paired the row, but the node map has no record for it.
        nodes = [_node("n", "Real row", 1)]
        revs = [_rev(0, "Real row", 1)]
        self.assertEqual(self._reasons(nodes, revs, original_by_id={})[0], SOURCE_UNCLASSIFIED)

    def test_an_unmatched_row_is_absent_because_diagnose_owns_it(self):
        nodes = [_node("n", "Real row", 1)]
        revs = [_rev(0, "Real row", 1), _rev(1, "Brand new row", 2)]
        self.assertNotIn(1, self._reasons(nodes, revs))

    def test_a_copied_row_is_never_given_a_reason(self):
        nodes = [_node("n", "Real row", 1)]
        revs = [_rev(0, "Real row", 1)]
        self.assertEqual(self._reasons(nodes, revs), {})


class TestDecideReviewCarry(unittest.TestCase):
    """`decide_review_carry` is the one traversal both public functions project from -- so the two
    halves cannot disagree about a row."""

    def _fixture(self):
        nodes = [
            _node("sec", "Section", 1, row_class="preamble"),
            _node("kid", "Kid", 2, parent_node="sec"),
            _node("goneSec", "Doomed Section", 3, row_class="preamble"),
            _node("orphan", "Orphan item", 4, parent_node="goneSec"),
            _node("blank", "Blank class", 5, row_class=""),
        ]
        revs = [
            _rev(0, "Section", 1), _rev(1, "Kid", 2),
            _rev(2, "Replaced Section", 3), _rev(3, "Orphan item", 4),
            _rev(4, "Blank class", 5), _rev(5, "Brand new", 6),
        ]
        match = match_rows(
            [MatchRow(row_id=n["name"], excel_row=n["source_row_number"],
                      description=n["description"]) for n in nodes],
            [MatchRow(row_id=r["row_id"], excel_row=r["excel_row"],
                      description=r["description"]) for r in revs],
        )
        return revs, {n["name"]: n for n in nodes}, match

    def test_the_two_halves_are_disjoint(self):
        revs, by_id, match = self._fixture()
        carries, reasons = decide_review_carry(revs, by_id, match)
        self.assertFalse(set(carries) & set(reasons))

    def test_each_projection_equals_its_half(self):
        revs, by_id, match = self._fixture()
        carries, reasons = decide_review_carry(revs, by_id, match)
        self.assertEqual(build_review_carry(revs, by_id, match), carries)
        self.assertEqual(explain_non_carry(revs, by_id, match), reasons)

    def test_the_expected_split_for_a_mixed_sheet(self):
        revs, by_id, match = self._fixture()
        carries, reasons = decide_review_carry(revs, by_id, match)
        self.assertEqual(set(carries), {0, 1})
        self.assertEqual(reasons, {3: PARENT_NOT_CARRIED, 4: SOURCE_UNCLASSIFIED})
        # 2 (reworded) and 5 (new) matched nothing -> neither half claims them.
        self.assertNotIn(2, carries)
        self.assertNotIn(2, reasons)
        self.assertNotIn(5, carries)
        self.assertNotIn(5, reasons)


if __name__ == "__main__":
    unittest.main()
