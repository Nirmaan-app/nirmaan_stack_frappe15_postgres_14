# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Pure unit tests for row_renumber.derive_source_row_offset (frappe-free; plain unittest).

derive_source_row_offset yields the stable data-start offset the template-flow insert/delete
paths (template_rows.* on BoQ Review Row + template_edit.* on BoQ Template Row) use to stamp
source_row_number = row_index + offset across a sheet -- self-healing the "Excel Row = 0"
corruption a freshly-inserted synthetic row introduces (source_row_number None -> Int 0).

The offset MUST be derived from the CONSISTENT pre-operation rows (each edit leaves the sheet
consistent, so the pre-op read is always consistent). test_offset_stable_across_* proves it
stays stable across repeated inserts -- the regression for the erosion bug (deriving from
post-shift rows dropped the offset by 1 per interior insert, re-introducing srn 0/negatives).
"""
import unittest

from nirmaan_stack.api.boq.wizard.row_renumber import (
    _SRN_OFFSET_FALLBACK,
    derive_source_row_offset,
)


def _simulate_insert(pairs, insertion_index):
    """Mimic the real endpoint at the pure level: capture the offset from the CONSISTENT
    pre-insert rows, shift row_index (+1 at/after insertion_index) WITHOUT touching srn (as
    the endpoint shift loop does), drop in the new synthetic row (srn None -> 0), then stamp
    srn = row_index + offset over the whole sheet. Returns the new [(row_index, srn)] sorted."""
    offset = derive_source_row_offset(pairs)
    shifted = [((ri + 1 if ri >= insertion_index else ri), srn) for ri, srn in pairs]
    shifted.append((insertion_index, 0))  # new row: source_row_number None -> Int 0
    return sorted((ri, ri + offset) for ri, _ in shifted)


class TestDeriveSourceRowOffset(unittest.TestCase):
    def test_offset_from_consistent_sheet(self):
        # offset = min(3-0, 4-1, 5-2) = 3 (data starts at Excel row 3).
        self.assertEqual(derive_source_row_offset([(0, 3), (1, 4), (2, 5)]), 3)

    def test_offset_ignores_stray_zero(self):
        # a stray 0 (un-healed old synthetic row) is excluded from the min -> never drags down.
        self.assertEqual(derive_source_row_offset([(0, 0), (1, 4), (2, 5)]), 3)
        self.assertEqual(derive_source_row_offset([(0, 3), (1, 4), (2, 0), (3, 6), (4, 7)]), 3)

    def test_offset_broken_first_row_recovers_true_offset(self):
        # first row broken (srn 0), the rest imply offset 2 -> min(srn-ri) recovers 2
        # (NOT min(srn)=3, which would over-shift the healthy rows).
        self.assertEqual(derive_source_row_offset([(0, 0), (1, 3), (2, 4)]), 2)

    def test_all_synthetic_falls_back(self):
        # no positive source_row_number -> fallback (header_row=1 -> data starts at Excel row 2).
        self.assertEqual(derive_source_row_offset([(0, 0), (1, 0)]), _SRN_OFFSET_FALLBACK)
        self.assertEqual(derive_source_row_offset([]), _SRN_OFFSET_FALLBACK)

    def test_none_is_no_source(self):
        self.assertEqual(derive_source_row_offset([(0, 3), (1, None), (2, 5)]), 3)

    def test_fallback_constant(self):
        self.assertEqual(_SRN_OFFSET_FALLBACK, 2)

    def test_offset_stable_across_repeated_middle_inserts(self):
        # REGRESSION: pre-op derivation keeps the offset STABLE across repeated interior
        # inserts. The old post-shift derivation eroded it by 1 per insert -> srn 0/negatives.
        rows = [(0, 2), (1, 3), (2, 4)]  # offset 2 (header_row=1)
        for _ in range(6):
            rows = _simulate_insert(rows, insertion_index=1)  # repeatedly insert near the top
            srns = [srn for _, srn in rows]
            self.assertEqual(derive_source_row_offset(rows), 2, "offset drifted")
            self.assertTrue(all(s >= 1 for s in srns), f"srn <= 0 re-introduced: {srns}")
            self.assertEqual(len(srns), len(set(srns)), f"non-unique: {srns}")
            self.assertEqual(srns, list(range(2, 2 + len(rows))), f"non-contiguous: {srns}")

    def test_offset_stable_across_top_inserts_offset_one(self):
        # A sheet whose data starts at Excel row 1 (offset 1) stays zero-free even on top-inserts
        # (the case that crashed on the very first insert under the old formula).
        rows = [(0, 1), (1, 2), (2, 3)]
        for _ in range(5):
            rows = _simulate_insert(rows, insertion_index=0)
            self.assertEqual(derive_source_row_offset(rows), 1)
            self.assertTrue(all(s >= 1 for _, s in rows))


if __name__ == "__main__":
    unittest.main()
