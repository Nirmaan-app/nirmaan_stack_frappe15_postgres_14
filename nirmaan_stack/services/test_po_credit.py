# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the D2 credit cap.

Pure module — no site, no DB.

THE PROPERTY: you cannot spend more than you actually overpaid.

Three places spend a PO's overpaid credit (a revision increase, a push transfer, the vendor
credit pool), and all three read the adjustment ledger, which is assembled from revision
diffs alone and never consults what was PAID. `test_the_po_246_phantom_is_capped_to_zero` is
the case that forced this: a ledger claiming ₹4,130 on a PO that had paid ₹0.

AND THE COUNTER-PROPERTY, which is the one that will get broken by someone tightening this:
`test_rounding_scale_excess_is_honoured` pins that a ledger within ₹1 of the real figure is
paid out IN FULL. Measured on live data, 6 of 7 credit-holding POs agree to the paisa and
one is ₹0.52 apart from accumulated rounding. A cap that shaved that would be a bug of its
own — someone would be told their ₹155,454.38 credit is ₹155,453.86 with no explanation.
"""

import unittest

from nirmaan_stack.services.po_credit import (
    CAP_TOLERANCE,
    ledger_credit,
    real_overpayment,
    usable_credit,
)


class UsableCreditTests(unittest.TestCase):
    # ── the property ─────────────────────────────────────────────────────────────

    def test_the_po_246_phantom_is_capped_to_zero(self):
        """Ledger claimed −4,130 of credit. amount_paid was 0 on a 20,650 PO."""
        self.assertEqual(usable_credit(-4130, amount_paid=0, total_amount=20650), 0.0)

    def test_a_genuine_overpayment_is_fully_usable(self):
        """Paid 24,780 on a 20,650 PO — 4,130 really is overpaid."""
        self.assertEqual(usable_credit(-4130, amount_paid=24780, total_amount=20650), 4130.0)

    def test_partly_phantom_credit_is_capped_to_the_real_part(self):
        """Ledger says 5,000; only 1,200 was genuinely overpaid."""
        self.assertEqual(usable_credit(-5000, amount_paid=11200, total_amount=10000), 1200.0)

    def test_paying_less_than_the_total_yields_no_credit(self):
        self.assertEqual(usable_credit(-999, amount_paid=500, total_amount=10000), 0.0)

    # ── the counter-property: do not shave legitimate balances ───────────────────

    def test_rounding_scale_excess_is_honoured(self):
        """PO/208/00058/25-26, live: ledger 155,454.38 vs real 155,453.86 — ₹0.52 apart."""
        self.assertEqual(
            usable_credit(-155454.38, amount_paid=1085132.20, total_amount=929678.34),
            155454.38,
        )

    def test_the_tolerance_boundary(self):
        """Exactly at tolerance -> honoured in full. Past it -> capped to the real figure."""
        at = usable_credit(-(100 + CAP_TOLERANCE), amount_paid=1100, total_amount=1000)
        self.assertEqual(at, 100 + CAP_TOLERANCE)

        past = usable_credit(-(100 + CAP_TOLERANCE + 0.01), amount_paid=1100, total_amount=1000)
        self.assertEqual(past, 100.0)

    def test_credit_below_the_real_figure_is_never_inflated(self):
        """The cap is a ceiling, never a floor — it must not hand out credit the ledger
        does not claim just because the PO was overpaid."""
        self.assertEqual(usable_credit(-300, amount_paid=11000, total_amount=10000), 300.0)

    # ── shape and edges ──────────────────────────────────────────────────────────

    def test_a_positive_remaining_impact_is_not_credit(self):
        """A positive balance means the PO owes MORE, not that it holds credit."""
        self.assertEqual(usable_credit(144, amount_paid=93810, total_amount=93810), 0.0)

    def test_zero_and_none_are_safe(self):
        self.assertEqual(usable_credit(0, 0, 0), 0.0)
        self.assertEqual(usable_credit(None, None, None), 0.0)

    def test_string_inputs_from_the_db_layer_are_tolerated(self):
        """Frappe hands back Decimal/str for Currency columns depending on the driver."""
        self.assertEqual(usable_credit("-4130", amount_paid="24780", total_amount="20650"), 4130.0)

    def test_garbage_does_not_raise(self):
        self.assertEqual(usable_credit("abc", "xyz", "???"), 0.0)

    # ── the two halves, named separately so a caller can report them ─────────────

    def test_ledger_credit_reports_the_claim_uncapped(self):
        self.assertEqual(ledger_credit(-4130), 4130.0)
        self.assertEqual(ledger_credit(4130), 0.0)

    def test_real_overpayment_never_goes_negative(self):
        self.assertEqual(real_overpayment(500, 10000), 0.0)
        self.assertEqual(real_overpayment(10500, 10000), 500.0)

    def test_usable_is_never_more_than_either_half_beyond_tolerance(self):
        """Property sweep — the invariant the three spend points rely on."""
        for remaining in (0, -1, -100, -4130, -1e6, 250):
            for paid in (0, 100, 10000, 1e6):
                for total in (0, 100, 10000, 1e6):
                    got = usable_credit(remaining, paid, total)
                    self.assertLessEqual(got, ledger_credit(remaining) + 1e-9)
                    self.assertLessEqual(
                        got,
                        max(real_overpayment(paid, total), ledger_credit(remaining))
                        if ledger_credit(remaining) <= real_overpayment(paid, total) + CAP_TOLERANCE
                        else real_overpayment(paid, total) + 1e-9,
                    )
