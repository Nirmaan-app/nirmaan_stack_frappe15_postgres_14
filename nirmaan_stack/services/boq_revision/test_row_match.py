"""Pure row-match tests (ADR-0014 D6 **Amendment B** 2026-07-20).

The key is `same Excel row + same description`, with any position occurring twice on a side dropped
from that side ("drop both" -- owner call 2026-07-20). No Frappe, no DB.

The description-bucket engine's tests (N=1/M=1 forced pairing, N=M>1 section disambiguation, N!=M
ambiguity, the section-header tiebreak) are DELETED with the engine -- none of those concepts exist
any more.
"""

import unittest

from nirmaan_stack.services.boq_revision.row_match import MatchRow, match_rows


def _o(row_id, excel_row, desc, serial=""):
    return MatchRow(row_id=row_id, excel_row=excel_row, description=desc, serial=serial)


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


class TestSerialSecondPassIsOptIn(unittest.TestCase):
    """WBC-S11 (ADR-0014 Amendment G). The second pass is a PARAMETER, default OFF, so the three
    consumers that must not get it are unaffected BY CONSTRUCTION rather than by care.

    `TestPositionIsLoadBearing` above is the other half of this pin and is deliberately NOT
    modified: it drives `match_rows` with the default and must keep passing verbatim. If it ever
    fails, the default has leaked and this slice is wrong.
    """

    def test_the_default_is_off(self):
        import inspect
        p = inspect.signature(match_rows).parameters["serial_second_pass"]
        self.assertIs(p.default, False)
        self.assertIs(p.kind, inspect.Parameter.KEYWORD_ONLY,
                      "keyword-only: a positional third argument could be passed by accident")

    def test_a_moved_row_with_a_matching_serial_does_not_pair_with_the_flag_off(self):
        orig = [_o("a", 3, "Cable tray 300mm", serial="1.1")]
        rev = [_o(0, 900, "Cable tray 300mm", serial="1.1")]
        self.assertEqual(match_rows(orig, rev).original_to_revised, {})

    def test_serial_matched_is_empty_with_the_flag_off(self):
        orig = [_o("a", 3, "X", serial="1.1")]
        rev = [_o(0, 900, "X", serial="1.1")]
        self.assertEqual(match_rows(orig, rev).serial_matched, frozenset())


class TestSerialSecondPass(unittest.TestCase):
    """WBC-S11. Pass 2 pairs rows that MOVED, on (serial + description), and ONLY when that key is
    unique on BOTH sides. It runs over what pass 1 left unmatched on both sides.

    The chosen failure mode (owner, 2026-07-30): a bad serial LOSES a match, it never CREATES a
    wrong one. Every negative case below is a row staying unmatched, never a row pairing wrongly.
    """

    ON = {"serial_second_pass": True}

    def test_a_moved_row_with_a_matching_serial_carries(self):
        # The headline. Byte-identical text, same serial, different Excel row -> pairs.
        orig = [_o("a", 3, "Cable tray 300mm", serial="1.1")]
        rev = [_o(0, 900, "Cable tray 300mm", serial="1.1")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.original_to_revised, {"a": 0})
        self.assertEqual(m.revised_to_original, {0: "a"})
        self.assertEqual(m.unmatched_original(), frozenset())

    def test_the_result_reports_which_pairs_came_from_pass_2(self):
        orig = [_o("stay", 1, "Stable", serial="1"), _o("move", 3, "Shifted", serial="2")]
        rev = [_o(0, 1, "Stable", serial="1"), _o(1, 9, "Shifted", serial="2")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.original_to_revised, {"stay": 0, "move": 1})
        self.assertEqual(m.serial_matched, frozenset({"move"}),
                         "the position-matched pair must NOT be reported as serial-matched")

    def test_a_blank_serial_does_not_pair(self):
        orig = [_o("a", 3, "Cable tray 300mm", serial="")]
        rev = [_o(0, 900, "Cable tray 300mm", serial="")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.original_to_revised, {})
        self.assertEqual(m.serial_matched, frozenset())

    def test_a_whitespace_only_serial_is_blank(self):
        orig = [_o("a", 3, "X", serial="   ")]
        rev = [_o(0, 900, "X", serial="\t ")]
        self.assertEqual(match_rows(orig, rev, **self.ON).original_to_revised, {})

    def test_a_blank_serial_on_ONE_side_does_not_pair(self):
        orig = [_o("a", 3, "X", serial="1.1")]
        rev = [_o(0, 900, "X", serial="")]
        self.assertEqual(match_rows(orig, rev, **self.ON).original_to_revised, {})

    def test_a_differing_serial_does_not_pair(self):
        orig = [_o("a", 3, "Cable tray 300mm", serial="1.1")]
        rev = [_o(0, 900, "Cable tray 300mm", serial="1.2")]
        self.assertEqual(match_rows(orig, rev, **self.ON).original_to_revised, {})

    def test_a_differing_description_does_not_pair_even_on_a_matching_serial(self):
        # The description half of the key is NOT weakened by pass 2 -- it is the same N2 comparison.
        orig = [_o("a", 3, "Cable tray 300mm", serial="1.1")]
        rev = [_o(0, 900, "Cable tray 150mm", serial="1.1")]
        self.assertEqual(match_rows(orig, rev, **self.ON).original_to_revised, {})

    def test_n2_normalisation_applies_to_both_halves_of_the_key(self):
        orig = [_o("a", 3, "  Cable   TRAY 300mm ", serial=" 1.1 ")]
        rev = [_o(0, 900, "cable tray 300mm", serial="1.1")]
        self.assertEqual(match_rows(orig, rev, **self.ON).original_to_revised, {"a": 0})

    def test_a_duplicate_key_on_the_ORIGINAL_side_pairs_nothing(self):
        # Live shape: 'a' / 'i)' / 'b.' repeat dozens of times inside one sheet. A second sighting
        # means neither is trustworthy -- the SAME "drop both" discipline pass 1 uses for positions.
        orig = [_o("a", 3, "Supply", serial="a"), _o("b", 4, "Supply", serial="a")]
        rev = [_o(0, 900, "Supply", serial="a")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.original_to_revised, {})
        self.assertEqual(m.unmatched_original(), frozenset({"a", "b"}))

    def test_a_duplicate_key_on_the_REVISED_side_pairs_nothing(self):
        orig = [_o("a", 3, "Supply", serial="a")]
        rev = [_o(0, 900, "Supply", serial="a"), _o(1, 901, "Supply", serial="a")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.original_to_revised, {})
        self.assertEqual(m.unmatched_revised(), frozenset({0, 1}))

    def test_a_third_sighting_does_not_re_add_a_dropped_key(self):
        orig = [_o("a", 3, "S", serial="x"), _o("b", 4, "S", serial="x"),
                _o("c", 5, "S", serial="x")]
        rev = [_o(0, 900, "S", serial="x")]
        self.assertEqual(match_rows(orig, rev, **self.ON).original_to_revised, {})

    def test_the_same_serial_on_DIFFERENT_descriptions_still_pairs(self):
        # The key is the PAIR. A serial repeating under distinct text is the common live case
        # (22,646 of 24,926 live (sheet, code, description) groups are unique) and must not be lost.
        orig = [_o("a", 3, "Supply", serial="a"), _o("b", 4, "Install", serial="a")]
        rev = [_o(0, 900, "Supply", serial="a"), _o(1, 901, "Install", serial="a")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.original_to_revised, {"a": 0, "b": 1})
        self.assertEqual(m.serial_matched, frozenset({"a", "b"}))

    def test_a_pass_1_match_wins_over_a_competing_pass_2_candidate(self):
        # Original "a" sits at row 5 and pairs there by POSITION with revised 0. Revised 1 elsewhere
        # carries the same serial + text and would have been a pass-2 candidate. Position wins, and
        # the loser stays unmatched rather than displacing anything.
        orig = [_o("a", 5, "Duct", serial="7")]
        rev = [_o(0, 5, "Duct", serial="7"), _o(1, 800, "Duct", serial="7")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.original_to_revised, {"a": 0})
        self.assertEqual(m.serial_matched, frozenset(), "pass 1 took it; pass 2 never saw it")
        self.assertEqual(m.unmatched_revised(), frozenset({1}))

    def test_pass_2_never_re_pairs_a_row_pass_1_already_placed(self):
        # The mirror: the ORIGINAL side has the decoy. Row 5 pairs by position; original "b" (same
        # serial + text, elsewhere) must not steal or duplicate revised 0.
        orig = [_o("a", 5, "Duct", serial="7"), _o("b", 700, "Duct", serial="7")]
        rev = [_o(0, 5, "Duct", serial="7")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.original_to_revised, {"a": 0})
        self.assertEqual(m.unmatched_original(), frozenset({"b"}))

    def test_a_blank_description_row_never_enters_either_pass(self):
        orig = [_o("a", 3, "", serial="1.1")]
        rev = [_o(0, 900, "", serial="1.1")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.original_to_revised, {})
        self.assertEqual(m.original_ids, frozenset())

    def test_a_position_dropped_duplicate_row_can_still_pair_on_its_serial(self):
        # Two originals collide at position 5 -> both dropped from pass 1's index (the synthetic
        # review-row collider). They are still unmatched CONTENT rows, so pass 2 gets to try, and
        # their (serial, description) keys are distinct -> both pair. Losing a position never has
        # to mean losing the row.
        orig = [_o("a", 5, "Supply", serial="1"), _o("b", 5, "Install", serial="2")]
        rev = [_o(0, 10, "Supply", serial="1"), _o(1, 11, "Install", serial="2")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.original_to_revised, {"a": 0, "b": 1})
        self.assertEqual(m.serial_matched, frozenset({"a", "b"}))

    def test_no_float_repair_is_attempted(self):
        # OUT OF SCOPE by owner ruling: a formula cell whose float precision leaked into stored text
        # stays unmatched. Numeric coercion is exactly how a wrong pairing gets made, so "2.3" and
        # "2.3000000000000003" are two different serials and that is the intended outcome.
        orig = [_o("a", 3, "Bend", serial="2.3000000000000003")]
        rev = [_o(0, 900, "Bend", serial="2.3")]
        self.assertEqual(match_rows(orig, rev, **self.ON).original_to_revised, {})

    def test_a_non_string_serial_does_not_raise(self):
        # Live `code` values include dates and integers read straight out of a cell.
        orig = [_o("a", 3, "Bend", serial=7)]
        rev = [_o(0, 900, "Bend", serial=7)]
        self.assertEqual(match_rows(orig, rev, **self.ON).original_to_revised, {"a": 0})

    def test_the_pairing_stays_symmetric_across_both_passes(self):
        orig = [_o("a", 1, "One", serial="1"), _o("b", 3, "Two", serial="2")]
        rev = [_o(10, 1, "One", serial="1"), _o(20, 9, "Two", serial="2")]
        m = match_rows(orig, rev, **self.ON)
        self.assertEqual(m.revised_to_original, {v: k for k, v in m.original_to_revised.items()})


if __name__ == "__main__":
    unittest.main()
