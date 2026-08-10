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
    _delete_remap,
    _delete_remap_attached,
    _insert_shift,
    _insert_shift_attached,
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


class TestDeleteRemapAttachedGrandparent(unittest.TestCase):
    """EA-6a slice 2 (C2a): attached_to_index re-points to the grandparent on DELETE.

    BEFORE this slice `_delete_remap_attached` DETACHED (-> 0) when the attached row was
    deleted, while `_delete_remap` RE-POINTED the same row's parent to the grandparent. That
    asymmetry is the pointer/text split the slice exists to remove: the note's parent survived
    the delete, its attachment did not, so the note's TEXT was stranded.

    The two sentinel spaces are deliberately NOT unified (attached_to_index keeps 0 =
    unattached; parent pointers keep -1 = no parent), so the mirror is behavioural, not literal.
    """

    def test_repoints_to_grandparent_instead_of_detaching(self):
        # Row 5 deleted; its own parent (grandparent) is row 2. A note attached to 5 must now
        # attach to 2 -- NOT detach to 0 (the pre-slice-2 behaviour).
        self.assertEqual(_delete_remap_attached(5, deleted_index=5, grandparent=2), 2)

    def test_repoint_target_above_delete_takes_the_shift(self):
        # Grandparent 7 sits ABOVE the deleted row 5, so after the -1 shift it is 6.
        self.assertEqual(_delete_remap_attached(5, deleted_index=5, grandparent=7), 6)

    def test_root_grandparent_detaches(self):
        # The deleted row was itself a root (-1): there is nothing left to attach to, so the
        # note unattaches -- the ONE case where the old detach behaviour is still correct.
        self.assertEqual(_delete_remap_attached(5, deleted_index=5, grandparent=-1), 0)
        self.assertEqual(_delete_remap_attached(5, deleted_index=5, grandparent=None), 0)

    def test_unattached_and_untouched_pointers(self):
        # 0 / None = not attached -> never rewritten, whatever the grandparent is.
        self.assertEqual(_delete_remap_attached(0, deleted_index=5, grandparent=2), 0)
        self.assertIsNone(_delete_remap_attached(None, deleted_index=5, grandparent=2))
        # A pointer BELOW the deleted row is unaffected by the shift.
        self.assertEqual(_delete_remap_attached(3, deleted_index=5, grandparent=2), 3)
        # A pointer ABOVE the deleted row shifts -1 (unchanged pre-existing behaviour).
        self.assertEqual(_delete_remap_attached(9, deleted_index=5, grandparent=2), 8)

    def test_mirrors_delete_remap_wherever_both_have_a_real_target(self):
        """Parity sweep: for every real (non-sentinel) outcome the two helpers now agree.

        This is the regression that would catch the asymmetry coming back -- it compares the
        attachment remap against the parent remap directly instead of restating its rules.
        """
        for deleted_index in range(0, 6):
            for grandparent in range(0, 6):
                for pointer in range(1, 8):
                    parent_out = _delete_remap(pointer, deleted_index, grandparent)
                    attached_out = _delete_remap_attached(pointer, deleted_index, grandparent)
                    if parent_out < 0:
                        # -1 space says "no parent"; the 0 space says "not attached".
                        self.assertEqual(attached_out, 0)
                    else:
                        self.assertEqual(
                            attached_out, parent_out,
                            f"divergence at pointer={pointer} deleted={deleted_index} "
                            f"grandparent={grandparent}",
                        )

    def test_insert_shift_still_mirrors_for_real_targets(self):
        """NEGATIVE / unchanged-behaviour control: the INSERT side was already symmetric.

        C2c reasoning -- an insert renumbers indices but never changes OWNERSHIP, so no blob
        movement is needed there. This pins that the two insert helpers stay in lockstep.
        """
        for insertion_index in range(0, 6):
            for pointer in range(1, 8):
                self.assertEqual(
                    _insert_shift_attached(pointer, insertion_index),
                    _insert_shift(pointer, insertion_index),
                )


if __name__ == "__main__":
    unittest.main()
