# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The UTR guard, shared by the import and the manual fulfil (ADR-0020 D2).

⚠️ BOTH SITES MUST MOVE TOGETHER, and the failure is asymmetric: miss the manual one and a human
fulfilling by hand is refused on a UTR the import wrote thirty seconds earlier, with a message
telling them to do it by hand.
"""

import unittest

from nirmaan_stack.services.outflow_import.reference_guard import reference_is_blocked


class TestReferenceIsBlocked(unittest.TestCase):
    def test_a_free_reference_is_not_blocked(self):
        self.assertFalse(
            reference_is_blocked(existing=set(), target_name="PAY-1", siblings=set())
        )

    def test_the_same_payment_is_not_a_conflict(self):
        self.assertFalse(
            reference_is_blocked(existing={"PAY-1"}, target_name="PAY-1", siblings=set())
        )

    def test_another_payment_is_blocked(self):
        self.assertTrue(
            reference_is_blocked(existing={"PAY-2"}, target_name="PAY-1", siblings=set())
        )

    def test_a_sibling_on_the_same_transfer_is_allowed(self):
        """⚠️ THE WHOLE POINT. Six payments settled from one transfer all carry the RAW bank
        reference -- which is what accountants already do by hand: 39 groups / 92 payments on the
        live ledger share one bank-shaped UTR today."""
        self.assertFalse(
            reference_is_blocked(
                existing={"PAY-2"}, target_name="PAY-1", siblings={"PAY-2", "PAY-3"}
            )
        )

    def test_a_payment_settled_from_a_DIFFERENT_transfer_is_still_blocked(self):
        """The sibling set is scoped to ONE transfer_id. Without that scope the guard would be
        switched off entirely -- any payment already carrying the reference would excuse any other."""
        self.assertTrue(
            reference_is_blocked(
                existing={"PAY-9"}, target_name="PAY-1", siblings={"PAY-2", "PAY-3"}
            )
        )

    def test_no_transfer_context_means_the_old_strict_rule(self):
        """`siblings=set()` is what the manual fulfil passes when it has no transfer to check
        against, and it reproduces the pre-ADR-0020 behaviour exactly."""
        self.assertTrue(
            reference_is_blocked(existing={"PAY-2"}, target_name="PAY-1", siblings=set())
        )

    def test_every_holder_must_be_excusable_not_just_one(self):
        """⚠️ THE FIX THIS TEST EXISTS FOR (review, Task 4). Several payments can already hold the
        same raw reference -- 39 groups / 92 payments do, by hand, on the live ledger -- and a
        single arbitrary holder is not enough to decide the call. `PAY-2` is a sibling on this
        transfer; `PAY-9` is a genuine third-party collision that happens to share the same UTR.
        The presence of ONE excusable holder must never let an INEXCUSABLE one slip through."""
        self.assertTrue(
            reference_is_blocked(
                existing={"PAY-2", "PAY-9"}, target_name="PAY-1", siblings={"PAY-2", "PAY-3"}
            )
        )

    def test_every_holder_excusable_is_allowed(self):
        """The mirror of the case above: when EVERY other holder is a sibling of this transfer,
        the call is allowed -- not just when there happens to be exactly one holder."""
        self.assertFalse(
            reference_is_blocked(
                existing={"PAY-2", "PAY-3"}, target_name="PAY-1", siblings={"PAY-2", "PAY-3"}
            )
        )
