"""S5a/S6 (#1102, ADR-0014 D6) -- pure row-match tests.

No Frappe: the caller extracts per-side row descriptors; this module only decides the four-way
outcome + the twin map. Cases mirror the plan's S6 acceptance list: N=1/M=1 matches (section
IGNORED, rename-proof); a duplicate cluster at N=M pairs k-th<->k-th by section+ordinal;
N!=M -> whole group AMBIGUOUS; removed / new; a blank description is never matched.
"""

import unittest

from nirmaan_stack.services.boq_revision.row_match import (
    AMBIGUOUS,
    MATCHED,
    NEW,
    REMOVED,
    MatchRow,
    match_rows,
)


def _o(row_id, desc, order, level=None):
    return MatchRow(row_id=row_id, description=desc, order=order, level=level)


class TestSimpleOutcomes(unittest.TestCase):
    def test_unique_description_matches_forced(self):
        origs = [_o("n1", "Excavation in soil", 5)]
        revs = [_o(0, "Excavation in soil", 8)]
        res = match_rows(origs, revs)
        self.assertEqual(res.original_outcome["n1"], MATCHED)
        self.assertEqual(res.revised_outcome[0], MATCHED)
        self.assertEqual(res.original_to_revised["n1"], 0)
        self.assertEqual(res.revised_to_original[0], "n1")

    def test_n2_normalizes_whitespace_and_case(self):
        origs = [_o("n1", "  Excavation   in SOIL ", 5)]
        revs = [_o(0, "Excavation in soil", 8)]
        self.assertEqual(match_rows(origs, revs).revised_outcome[0], MATCHED)

    def test_removed_when_no_revised_twin(self):
        res = match_rows([_o("n1", "Old row", 5)], [])
        self.assertEqual(res.original_outcome["n1"], REMOVED)
        self.assertNotIn("n1", res.original_to_revised)

    def test_new_when_no_original(self):
        res = match_rows([], [_o(0, "Fresh row", 3)])
        self.assertEqual(res.revised_outcome[0], NEW)

    def test_section_rename_still_matches_at_1_1(self):
        # Description globally unique on both sides -> section IGNORED, so a renamed section
        # header above the row never blocks the forced pairing.
        origs = [_o("sec", "Civil Works", 1, level=1), _o("item", "RCC M25", 2)]
        revs = [_o(0, "Structural Works", 1, level=1), _o(1, "RCC M25", 2)]
        res = match_rows(origs, revs)
        self.assertEqual(res.revised_outcome[1], MATCHED)  # RCC M25 matched despite rename
        self.assertEqual(res.revised_to_original[1], "item")

    def test_blank_description_never_matched(self):
        origs = [_o("n1", "   ", 5)]  # whitespace-only -> N2 key ""
        revs = [_o(0, "", 8)]
        res = match_rows(origs, revs)
        self.assertNotIn("n1", res.original_outcome)
        self.assertNotIn(0, res.revised_outcome)


class TestDuplicateClusters(unittest.TestCase):
    def test_n_equals_m_pairs_by_section_then_ordinal(self):
        # Two "Supply & fix" rows, one under each section -> section disambiguates them.
        origs = [
            _o("secA", "Section A", 1, level=1),
            _o("a_item", "Supply and fix", 2),
            _o("secB", "Section B", 10, level=1),
            _o("b_item", "Supply and fix", 11),
        ]
        revs = [
            _o(0, "Section A", 1, level=1),
            _o(1, "Supply and fix", 2),
            _o(2, "Section B", 10, level=1),
            _o(3, "Supply and fix", 11),
        ]
        res = match_rows(origs, revs)
        self.assertEqual(res.original_to_revised["a_item"], 1)
        self.assertEqual(res.original_to_revised["b_item"], 3)

    def test_n_equals_m_same_section_pairs_by_ordinal(self):
        # Two identical rows under the SAME section -> ordinal (physical order) pairs them.
        origs = [
            _o("sec", "Section A", 1, level=1),
            _o("first", "Repeated item", 2),
            _o("second", "Repeated item", 3),
        ]
        revs = [
            _o(0, "Section A", 1, level=1),
            _o(10, "Repeated item", 2),
            _o(20, "Repeated item", 3),
        ]
        res = match_rows(origs, revs)
        self.assertEqual(res.original_to_revised["first"], 10)
        self.assertEqual(res.original_to_revised["second"], 20)

    def test_n_not_equal_m_whole_group_ambiguous(self):
        origs = [_o("a", "Dup", 2), _o("b", "Dup", 3)]
        revs = [_o(0, "Dup", 2), _o(1, "Dup", 3), _o(2, "Dup", 4)]
        res = match_rows(origs, revs)
        self.assertEqual(set(res.original_outcome.values()), {AMBIGUOUS})
        self.assertEqual(set(res.revised_outcome.values()), {AMBIGUOUS})
        self.assertEqual(res.original_to_revised, {})

    def test_n_equals_m_but_sections_dont_align_is_ambiguous(self):
        # 2 vs 2, but both revised rows fell under ONE section -> counts per section differ.
        origs = [
            _o("secA", "Section A", 1, level=1),
            _o("a_item", "Dup item", 2),
            _o("secB", "Section B", 10, level=1),
            _o("b_item", "Dup item", 11),
        ]
        revs = [
            _o(0, "Section A", 1, level=1),
            _o(1, "Dup item", 2),
            _o(2, "Dup item", 3),  # both under Section A now
            _o(3, "Section B", 10, level=1),
        ]
        res = match_rows(origs, revs)
        self.assertEqual(res.revised_outcome[1], AMBIGUOUS)
        self.assertEqual(res.revised_outcome[2], AMBIGUOUS)


if __name__ == "__main__":
    unittest.main()
