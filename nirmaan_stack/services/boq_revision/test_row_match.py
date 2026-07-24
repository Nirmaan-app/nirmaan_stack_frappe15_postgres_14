"""Pure row-match tests (ADR-0014 D6 **Amendment B** 2026-07-20).

The key is `same Excel row + same description`, with any position occurring twice on a side dropped
from that side ("drop both" -- owner call 2026-07-20). No Frappe, no DB.

The description-bucket engine's tests (N=1/M=1 forced pairing, N=M>1 section disambiguation, N!=M
ambiguity, the section-header tiebreak) are DELETED with the engine -- none of those concepts exist
any more.
"""

import unittest

from nirmaan_stack.services.boq_revision.row_match import MatchRow, match_rows


def _o(row_id, excel_row, desc):
    return MatchRow(row_id=row_id, excel_row=excel_row, description=desc)


class TestExactMatch(unittest.TestCase):
    def test_identical_sheets_match_every_row(self):
        orig = [_o("a", 1, "Section A"), _o("b", 2, "Item one"), _o("c", 3, "Item two")]
        rev = [_o(0, 1, "Section A"), _o(1, 2, "Item one"), _o(2, 3, "Item two")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {"a": 0, "b": 1, "c": 2})
        self.assertEqual(m.revised_to_original, {0: "a", 1: "b", 2: "c"})
        self.assertEqual(m.unmatched_original(), frozenset())
        self.assertEqual(m.unmatched_revised(), frozenset())

    def test_n2_normalisation_is_applied_to_the_comparison(self):
        # trim + lowercase + collapse internal whitespace -- and nothing else.
        orig = [_o("a", 4, "  Supply   and FIX conduit ")]
        rev = [_o(0, 4, "supply and fix conduit")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {"a": 0})

    def test_punctuation_difference_is_a_real_edit_and_does_not_match(self):
        # N2 folds only provably meaning-preserving noise; `IP42` vs `IP-42` is a real difference.
        orig = [_o("a", 4, "Fitting IP42")]
        rev = [_o(0, 4, "Fitting IP-42")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {})


class TestPositionIsLoadBearing(unittest.TestCase):
    def test_same_text_at_a_different_row_does_not_match(self):
        # The whole point: description alone is NOT sufficient. Row 3 must never pair with row 900.
        orig = [_o("a", 3, "Cable tray 300mm")]
        rev = [_o(0, 900, "Cable tray 300mm")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {})
        self.assertEqual(m.unmatched_original(), frozenset({"a"}))
        self.assertEqual(m.unmatched_revised(), frozenset({0}))

    def test_shifted_by_insert_stops_matching_below_the_insert(self):
        orig = [_o("a", 1, "Head"), _o("b", 2, "One"), _o("c", 3, "Two")]
        # A row inserted at 2 pushes One->3 and Two->4.
        rev = [_o(0, 1, "Head"), _o(1, 2, "Inserted"), _o(2, 3, "One"), _o(3, 4, "Two")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {"a": 0})
        self.assertEqual(m.unmatched_original(), frozenset({"b", "c"}))

    def test_shifted_by_delete_stops_matching_below_the_delete(self):
        orig = [_o("a", 1, "Head"), _o("b", 2, "Gone"), _o("c", 3, "Tail")]
        rev = [_o(0, 1, "Head"), _o(1, 2, "Tail")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {"a": 0})
        self.assertEqual(m.unmatched_revised(), frozenset({1}))

    def test_append_at_end_leaves_everything_above_matched(self):
        orig = [_o("a", 1, "One"), _o("b", 2, "Two")]
        rev = [_o(0, 1, "One"), _o(1, 2, "Two"), _o(2, 3, "Appended")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {"a": 0, "b": 1})
        self.assertEqual(m.unmatched_revised(), frozenset({2}))


class TestInPlaceEdit(unittest.TestCase):
    def test_reworded_row_drops_out_and_the_rest_survive(self):
        # The 499/500 shape: one row's text changes in place; nothing shifts.
        orig = [_o(f"o{i}", i, f"Item {i}") for i in range(1, 6)]
        rev = [_o(i - 1, i, f"Item {i}") for i in range(1, 6)]
        rev[2] = _o(2, 3, "Item 3 -- revised wording")
        m = match_rows(orig, rev)
        self.assertEqual(len(m.original_to_revised), 4)
        self.assertEqual(m.unmatched_original(), frozenset({"o3"}))
        self.assertEqual(m.unmatched_revised(), frozenset({2}))


class TestDuplicatePositions(unittest.TestCase):
    """Owner call 2026-07-20: DROP BOTH. A position seen twice on a side is untrustworthy on that
    side, so it is removed from the index entirely. Live collider: a synthetic review row committed
    with its `row_index` as its row number (`commit_pipeline.py:207`)."""

    def test_duplicate_position_on_the_original_side_is_dropped(self):
        orig = [_o("a", 5, "Same"), _o("b", 5, "Same"), _o("c", 6, "Other")]
        rev = [_o(0, 5, "Same"), _o(1, 6, "Other")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {"c": 1})
        self.assertEqual(m.unmatched_original(), frozenset({"a", "b"}))
        self.assertEqual(m.unmatched_revised(), frozenset({0}))

    def test_duplicate_position_on_the_revised_side_is_dropped(self):
        orig = [_o("a", 5, "Same"), _o("b", 6, "Other")]
        rev = [_o(0, 5, "Same"), _o(1, 5, "Same"), _o(2, 6, "Other")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {"b": 2})
        self.assertEqual(m.unmatched_revised(), frozenset({0, 1}))

    def test_three_way_duplicate_is_also_dropped(self):
        # The drop must be sticky -- a third sighting must not re-add the position.
        orig = [_o("a", 5, "X"), _o("b", 5, "X"), _o("c", 5, "X")]
        rev = [_o(0, 5, "X")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {})
        self.assertEqual(m.unmatched_original(), frozenset({"a", "b", "c"}))

    def test_dropped_rows_still_count_as_having_entered(self):
        # They must appear in the id sets, or downstream "needs a value" counts under-report.
        orig = [_o("a", 5, "X"), _o("b", 5, "X")]
        rev = [_o(0, 5, "X"), _o(1, 5, "X")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_ids, frozenset({"a", "b"}))
        self.assertEqual(m.revised_ids, frozenset({0, 1}))


class TestBlankDescriptions(unittest.TestCase):
    def test_blank_rows_never_enter_the_match(self):
        orig = [_o("a", 1, "Real"), _o("b", 2, ""), _o("c", 3, "   ")]
        rev = [_o(0, 1, "Real"), _o(1, 2, ""), _o(2, 3, "\t\n ")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {"a": 0})
        self.assertEqual(m.original_ids, frozenset({"a"}))
        self.assertEqual(m.revised_ids, frozenset({0}))

    def test_two_blanks_at_the_same_position_do_not_pair(self):
        orig = [_o("a", 7, "")]
        rev = [_o(0, 7, "")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {})


class TestEdges(unittest.TestCase):
    def test_empty_sides(self):
        self.assertEqual(match_rows([], []).original_to_revised, {})
        self.assertEqual(match_rows([_o("a", 1, "X")], []).unmatched_original(), frozenset({"a"}))
        self.assertEqual(match_rows([], [_o(0, 1, "X")]).unmatched_revised(), frozenset({0}))

    def test_row_id_is_opaque_and_need_not_equal_excel_row(self):
        # The review carry passes committed node NAMES on the original side and row_index on the
        # revised side -- neither is the Excel row. The twin map must key on those ids.
        orig = [_o("NODE-ABC", 42, "Thing")]
        rev = [_o(7, 42, "Thing")]
        m = match_rows(orig, rev)
        self.assertEqual(m.original_to_revised, {"NODE-ABC": 7})
        self.assertEqual(m.revised_to_original, {7: "NODE-ABC"})

    def test_the_pairing_is_symmetric(self):
        orig = [_o("a", 1, "One"), _o("b", 2, "Two")]
        rev = [_o(10, 1, "One"), _o(20, 2, "Two")]
        m = match_rows(orig, rev)
        self.assertEqual(
            m.revised_to_original, {v: k for k, v in m.original_to_revised.items()}
        )


if __name__ == "__main__":
    unittest.main()
