"""Pure diagnosis tests -- why a revision row did not carry.

Every fixture runs the REAL seam (`match_rows` -> `decide_review_carry` -> `diagnose_sheet`) rather
than hand-feeding a diagnosis, so a change to the carry rule shows up here as a changed reason
instead of silently passing.

The load-bearing cases:

  * an insertion and an in-place reword produce DIFFERENT codes even though both look like "the
    text here changed" at the edited row -- the block below is what tells them apart;
  * TWO edit points, where cumulative offset and local change diverge (a single-edit fixture cannot
    catch that class of bug at all);
  * the ambiguity fallback lands on the CAUSAL label, because a causal row cannot be bulk-affirmed;
  * a spacer never receives a reason, so it can never reach the finalize gate.
"""

import unittest

from nirmaan_stack.services.boq_revision.carry import decide_review_carry
from nirmaan_stack.services.boq_revision.diagnose import (
    MAX_SUMMARY_ITEMS,
    diagnose_sheet,
)
from nirmaan_stack.services.boq_revision.reasons import (
    ALL_REASONS,
    DESCRIPTION_CHANGED,
    DUPLICATE_POSITION,
    NO_EXCEL_POSITION,
    PARENT_NOT_CARRIED,
    POSITION_SHIFTED,
    ROW_INSERTED,
    SOURCE_UNCLASSIFIED,
    is_collateral,
)
from nirmaan_stack.services.boq_revision.row_match import MatchRow, match_rows


def _node(name, desc, excel_row, row_class="line_item", parent_node=None):
    """A committed BOQ Nodes row (same shape as test_carry's fixture)."""
    return {
        "name": name, "description": desc, "source_row_number": excel_row,
        "row_class": row_class, "parent_node": parent_node,
    }


def _rev(row_id, desc, excel_row):
    """A freshly-parsed revision review row. `row_id` IS the `row_index`."""
    return {"row_id": row_id, "description": desc, "excel_row": excel_row}


def _seam(nodes, revs, positionless_ids=()):
    """Run the real parse seam and return `(carries, diagnosis)`."""
    orig_rows = [MatchRow(n["name"], n["source_row_number"], n["description"]) for n in nodes]
    rev_rows = [MatchRow(r["row_id"], r["excel_row"], r["description"]) for r in revs]
    match = match_rows(orig_rows, rev_rows)
    carries, non_carry = decide_review_carry(revs, {n["name"]: n for n in nodes}, match)
    diagnosis = diagnose_sheet(
        orig_rows, rev_rows, match,
        carried_ids=set(carries),
        non_carry_reasons=non_carry,
        positionless_ids=positionless_ids,
    )
    return carries, diagnosis


def _items(count, start=1):
    """`count` plain root rows named "Item N" at Excel rows start..start+count-1."""
    return [_node(f"n{i}", f"Item {i}", i) for i in range(start, start + count)]


class TestNothingChanged(unittest.TestCase):
    def test_identical_sheets_produce_no_reasons_at_all(self):
        nodes = _items(3)
        revs = [_rev(i - 1, f"Item {i}", i) for i in range(1, 4)]
        carries, diag = _seam(nodes, revs)
        self.assertEqual(len(carries), 3)
        self.assertEqual(diag.reasons, {})
        self.assertEqual(diag.shift_blocks, ())
        self.assertEqual(diag.removed_count, 0)


class TestInsertion(unittest.TestCase):
    def test_two_inserted_rows_are_causal_and_the_rest_are_collateral(self):
        # Items 3-5 slide from Excel 3,4,5 to 5,6,7.
        nodes = _items(5)
        revs = [
            _rev(0, "Item 1", 1), _rev(1, "Item 2", 2),
            _rev(2, "New A", 3), _rev(3, "New B", 4),
            _rev(4, "Item 3", 5), _rev(5, "Item 4", 6), _rev(6, "Item 5", 7),
        ]
        _carries, diag = _seam(nodes, revs)

        self.assertEqual(diag.reasons[2].code, ROW_INSERTED)
        self.assertEqual(diag.reasons[3].code, ROW_INSERTED)
        for rid in (4, 5, 6):
            self.assertEqual(diag.reasons[rid].code, POSITION_SHIFTED)
            self.assertEqual(diag.reasons[rid].delta, 2)

        self.assertEqual(len(diag.shift_blocks), 1)
        block = diag.shift_blocks[0]
        self.assertEqual(block.anchor, 3, "the change begins where the first new row sits")
        self.assertEqual(block.change, 2)
        self.assertEqual(block.shifted_count, 3)
        self.assertEqual(block.inserted_excel_rows, (3, 4))

    def test_the_inserted_rows_and_their_collateral_share_one_anchor(self):
        # This is what lets the warnings block state one event instead of five lines.
        nodes = _items(5)
        revs = [
            _rev(0, "Item 1", 1), _rev(1, "Item 2", 2),
            _rev(2, "New A", 3), _rev(3, "New B", 4),
            _rev(4, "Item 3", 5), _rev(5, "Item 4", 6), _rev(6, "Item 5", 7),
        ]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual({diag.reasons[r].anchor for r in (2, 3, 4, 5, 6)}, {3})

    def test_rows_above_the_insert_still_carry(self):
        nodes = _items(5)
        revs = [
            _rev(0, "Item 1", 1), _rev(1, "Item 2", 2), _rev(2, "New", 3),
            _rev(3, "Item 3", 4), _rev(4, "Item 4", 5), _rev(5, "Item 5", 6),
        ]
        carries, diag = _seam(nodes, revs)
        self.assertIn(0, carries)
        self.assertIn(1, carries)
        self.assertNotIn(0, diag.reasons)

    def test_shifted_rows_are_not_reported_as_removed(self):
        # They are still present in the revision -- just lower down.
        nodes = _items(5)
        revs = [
            _rev(0, "Item 1", 1), _rev(1, "New", 2),
            _rev(2, "Item 2", 3), _rev(3, "Item 3", 4),
            _rev(4, "Item 4", 5), _rev(5, "Item 5", 6),
        ]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(diag.removed_count, 0)


class TestDeletion(unittest.TestCase):
    def test_deleted_rows_shift_the_tail_up_and_are_reported_removed(self):
        nodes = _items(5)
        revs = [_rev(0, "Item 1", 1), _rev(1, "Item 2", 2), _rev(2, "Item 5", 3)]
        _carries, diag = _seam(nodes, revs)

        self.assertEqual(diag.reasons[2].code, POSITION_SHIFTED)
        self.assertEqual(diag.reasons[2].delta, -2)

        block = diag.shift_blocks[0]
        self.assertEqual(block.change, -2)
        self.assertEqual(block.anchor, 3, "the gap is where the row below the deletion now sits")
        self.assertEqual(block.inserted_excel_rows, (), "a deletion inserts nothing")

        self.assertEqual(diag.removed_count, 2)
        self.assertEqual({r.excel_row for r in diag.removed_rows}, {3, 4})


class TestInPlaceEdit(unittest.TestCase):
    def test_reworded_row_is_a_description_change_not_an_insert(self):
        # Nothing below it moves, so there is no block to make it an insertion.
        nodes = _items(3)
        revs = [_rev(0, "Item 1", 1), _rev(1, "Item 2", 2), _rev(2, "Item 3 -- revised", 3)]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(diag.reasons[2].code, DESCRIPTION_CHANGED)
        self.assertEqual(diag.shift_blocks, ())

    def test_an_overwritten_row_is_not_double_counted_as_removed(self):
        # The original "Item 3" is gone from the revision, but it was REPLACED in place -- calling
        # it both a removal and a reword would report one edit twice.
        nodes = _items(3)
        revs = [_rev(0, "Item 1", 1), _rev(1, "Item 2", 2), _rev(2, "Item 3 -- revised", 3)]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(diag.removed_count, 0)

    def test_appended_row_past_the_originals_last_row_is_new(self):
        nodes = _items(2)
        revs = [_rev(0, "Item 1", 1), _rev(1, "Item 2", 2), _rev(2, "Brand new tail", 3)]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(diag.reasons[2].code, ROW_INSERTED)
        self.assertEqual(diag.reasons[2].anchor, 0, "no block -> no anchor")


class TestTwoEditPoints(unittest.TestCase):
    """⚠️ THE regression guard for cumulative-vs-local offset.

    With one edit, `delta` and `change` are equal and every anchor computation looks right. With
    two, the second block's cumulative offset (+2) is NOT what a human did there (+1) -- deriving
    its anchor from `delta` lands on the FIRST edit's anchor and silently mis-attributes the whole
    block. Any single-edit fixture passes either way.
    """

    def _fixture(self):
        # ORIGINAL A1 B2 C3 D4 E5  ->  REVISED A1 X2 B3 C4 Y5 D6 E7
        nodes = [
            _node("a", "A", 1), _node("b", "B", 2), _node("c", "C", 3),
            _node("d", "D", 4), _node("e", "E", 5),
        ]
        revs = [
            _rev(0, "A", 1), _rev(1, "X", 2), _rev(2, "B", 3), _rev(3, "C", 4),
            _rev(4, "Y", 5), _rev(5, "D", 6), _rev(6, "E", 7),
        ]
        return _seam(nodes, revs)

    def test_two_separate_blocks_are_found(self):
        _carries, diag = self._fixture()
        self.assertEqual(len(diag.shift_blocks), 2)

    def test_each_block_reports_its_own_local_change_not_the_running_total(self):
        _carries, diag = self._fixture()
        first, second = diag.shift_blocks
        self.assertEqual((first.delta, first.change), (1, 1))
        self.assertEqual((second.delta, second.change), (2, 1),
                         "the second edit inserted ONE row, even though rows below sit +2 away")

    def test_each_anchor_points_at_its_own_inserted_row(self):
        _carries, diag = self._fixture()
        first, second = diag.shift_blocks
        self.assertEqual(first.anchor, 2)
        self.assertEqual(second.anchor, 5, "NOT 4 -- that would be `first_excel - delta`")
        self.assertEqual(first.inserted_excel_rows, (2,))
        self.assertEqual(second.inserted_excel_rows, (5,))

    def test_the_inserted_rows_are_attributed_to_the_right_block(self):
        _carries, diag = self._fixture()
        self.assertEqual(diag.reasons[1].code, ROW_INSERTED)
        self.assertEqual(diag.reasons[1].anchor, 2)
        self.assertEqual(diag.reasons[4].code, ROW_INSERTED)
        self.assertEqual(diag.reasons[4].anchor, 5)


class TestRepeatedDescriptions(unittest.TestCase):
    """Real BoQs repeat descriptions constantly ("Supply and fix conduit"), so the probe has to
    cope -- and has to fail SAFE when it cannot."""

    def test_the_running_offset_disambiguates_a_repeated_description(self):
        # "Dup" exists at original 3 AND 9. Only the running offset (+1, established by B) picks
        # the right one.
        nodes = [
            _node("a", "A", 1), _node("b", "B", 2), _node("dup1", "Dup", 3),
            _node("c", "C", 4), _node("dup2", "Dup", 9),
        ]
        revs = [
            _rev(0, "A", 1), _rev(1, "New", 2), _rev(2, "B", 3),
            _rev(3, "Dup", 4), _rev(4, "C", 5),
        ]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(diag.reasons[3].code, POSITION_SHIFTED)
        self.assertEqual(diag.reasons[3].delta, 1)

    def test_an_unresolvable_repeat_falls_back_to_the_causal_label(self):
        # Two candidates, no running offset to corroborate either -> refuse to guess. The row lands
        # on a CAUSAL code, so it can never be swept up by a block bulk-affirm.
        nodes = [
            _node("h", "Head", 1), _node("d1", "Supply cable", 2),
            _node("m", "Mid", 5), _node("d2", "Supply cable", 8),
        ]
        revs = [_rev(0, "Changed head", 1), _rev(1, "Supply cable", 5)]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(diag.reasons[1].code, DESCRIPTION_CHANGED)
        self.assertFalse(is_collateral(diag.reasons[1].code),
                         "an unresolved guess must never be bulk-affirmable")


class TestCarrySideReasons(unittest.TestCase):
    def test_parent_not_carried_reaches_the_diagnosis(self):
        nodes = [
            _node("goneSec", "Deleted Section", 1, row_class="preamble"),
            _node("child", "Child item", 2, parent_node="goneSec"),
        ]
        revs = [_rev(0, "Replacement Section", 1), _rev(1, "Child item", 2)]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(diag.reasons[1].code, PARENT_NOT_CARRIED)

    def test_blank_row_class_reaches_the_diagnosis(self):
        nodes = [_node("n", "Odd row", 1, row_class="")]
        revs = [_rev(0, "Odd row", 1)]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(diag.reasons[0].code, SOURCE_UNCLASSIFIED)

    def test_a_matched_row_that_refused_still_proves_alignment(self):
        # It matched positionally, so the row below it must NOT be treated as shifted.
        nodes = [
            _node("goneSec", "Deleted Section", 1, row_class="preamble"),
            _node("child", "Child item", 2, parent_node="goneSec"),
            _node("tail", "Tail item", 3),
        ]
        revs = [_rev(0, "Replacement Section", 1), _rev(1, "Child item", 2),
                _rev(2, "Tail item", 3)]
        carries, diag = _seam(nodes, revs)
        self.assertIn(2, carries)
        self.assertEqual(diag.shift_blocks, ())


class TestDuplicatePositions(unittest.TestCase):
    def test_a_duplicated_original_position_is_named_as_such(self):
        nodes = [_node("a", "Same", 5), _node("b", "Same", 5), _node("c", "Other", 6)]
        revs = [_rev(0, "Same", 5), _rev(1, "Other", 6)]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(diag.reasons[0].code, DUPLICATE_POSITION)

    def test_a_duplicated_revised_position_is_named_as_such(self):
        nodes = [_node("a", "Same", 5), _node("b", "Other", 6)]
        revs = [_rev(0, "Same", 5), _rev(1, "Same", 5), _rev(2, "Other", 6)]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(diag.reasons[0].code, DUPLICATE_POSITION)
        self.assertEqual(diag.reasons[1].code, DUPLICATE_POSITION)


class TestPositionless(unittest.TestCase):
    def test_a_row_with_no_excel_position_is_still_stamped(self):
        # Unreachable in production; it exists so the taxonomy stays total and the row still
        # reaches the finalize gate instead of slipping through unstamped.
        nodes = _items(1)
        revs = [_rev(0, "Item 1", 1)]
        _carries, diag = _seam(nodes, revs, positionless_ids=(99,))
        self.assertEqual(diag.reasons[99].code, NO_EXCEL_POSITION)


class TestSpacers(unittest.TestCase):
    def test_a_blank_row_never_receives_a_reason(self):
        # A spacer has nothing to classify. A reason would put it in front of the reviewer AND in
        # the finalize gate.
        nodes = _items(2)
        revs = [_rev(0, "Item 1", 1), _rev(1, "   ", 2), _rev(2, "Item 2", 3)]
        _carries, diag = _seam(nodes, revs)
        self.assertNotIn(1, diag.reasons)


class TestNetZeroKnownHole(unittest.TestCase):
    """The documented net-zero hole (ADR-0014 D6, known hole #1) is UNCHANGED: the realigned rows
    still match and still carry. What is new is that the deletion is now VISIBLE in `removed_rows`
    -- the diagnosis reports the edit even though the carry silently absorbed it."""

    def test_realigned_rows_still_carry_but_the_deletion_is_reported(self):
        nodes = [
            _node("secA", "Section A", 1, row_class="preamble"),
            _node("doomed", "Row about to be deleted", 20),
            _node("tail", "Trailing item", 21, parent_node="secA"),
        ]
        revs = [
            _rev(0, "Section A", 1),
            _rev(1, "Newly Inserted Heading", 10),
            _rev(2, "Trailing item", 21),
        ]
        carries, diag = _seam(nodes, revs)
        self.assertIn(2, carries, "known hole: it realigns and copies -- unchanged by this module")
        self.assertEqual(diag.reasons[1].code, ROW_INSERTED)
        self.assertEqual(diag.removed_count, 1)
        self.assertEqual(diag.removed_rows[0].excel_row, 20)


class TestTotality(unittest.TestCase):
    """The taxonomy must cover EXACTLY the non-copied content rows -- no gaps (a row with no reason
    gets no stamp and escapes the finalize gate) and no strays (a copied row must stay calm)."""

    def _messy(self):
        nodes = [
            _node("sec", "Section", 1, row_class="preamble"),
            _node("a", "Alpha", 2, parent_node="sec"),
            _node("b", "Beta", 3, parent_node="sec"),
            _node("dup1", "Twin", 7), _node("dup2", "Twin", 7),
            _node("odd", "Odd", 9, row_class=""),
        ]
        revs = [
            _rev(0, "Section", 1),
            _rev(1, "Alpha", 2),
            _rev(2, "Inserted", 3),
            _rev(3, "Beta", 4),
            _rev(4, "Twin", 7),
            _rev(5, "Odd", 9),
            _rev(6, "", 10),
        ]
        return nodes, revs

    def test_every_non_copied_content_row_has_exactly_one_reason(self):
        nodes, revs = self._messy()
        carries, diag = _seam(nodes, revs)
        content_ids = {r["row_id"] for r in revs if r["description"].strip()}
        self.assertEqual(set(diag.reasons), content_ids - set(carries))

    def test_no_copied_row_is_given_a_reason(self):
        nodes, revs = self._messy()
        carries, diag = _seam(nodes, revs)
        self.assertFalse(set(carries) & set(diag.reasons))

    def test_every_emitted_code_is_in_the_declared_vocabulary(self):
        nodes, revs = self._messy()
        _carries, diag = _seam(nodes, revs)
        self.assertTrue({r.code for r in diag.reasons.values()} <= ALL_REASONS)


class TestCollateralBoundary(unittest.TestCase):
    def test_only_a_shifted_row_is_bulk_affirmable(self):
        for code in ALL_REASONS:
            with self.subTest(code=code):
                self.assertEqual(is_collateral(code), code == POSITION_SHIFTED)


class TestSummaryCaps(unittest.TestCase):
    def test_removed_rows_are_capped_but_the_count_stays_honest(self):
        # No silent caps: the list stops enumerating, the count never lies about scale.
        size = MAX_SUMMARY_ITEMS + 10
        nodes = [_node(f"n{i}", f"Gone {i}", i) for i in range(1, size + 1)]
        revs = [_rev(0, "Only survivor", 500)]
        _carries, diag = _seam(nodes, revs)
        self.assertEqual(len(diag.removed_rows), MAX_SUMMARY_ITEMS)
        self.assertEqual(diag.removed_count, size)


if __name__ == "__main__":
    unittest.main()
