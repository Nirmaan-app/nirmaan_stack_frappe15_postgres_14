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

import ast
import unittest
from pathlib import Path

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


class HeldCreditTests(unittest.TestCase):
    """A waiting Vendor Refund HOLDS its amount of the PO's overpaid credit (#1400, ADR-0032).

    The vendor says it sent ₹X back; until the bank line is matched the money has not moved, so the
    credit stays on the ledger, but nothing may spend the part the refund will take: not a revision
    increase, not a push to another PO, not a pull into one.
    """

    def test_a_waiting_refund_holds_back_its_amount(self):
        # Paid 24,780 on a 20,650 PO: 4,130 overpaid; the vendor says 1,000 of it is coming back.
        self.assertEqual(usable_credit(-4130, 24780, 20650, held=1000), 3130.0)

    def test_a_hold_of_the_whole_credit_leaves_nothing_to_spend(self):
        self.assertEqual(usable_credit(-4130, 24780, 20650, held=4130), 0.0)

    def test_a_hold_larger_than_the_credit_never_goes_negative(self):
        self.assertEqual(usable_credit(-4130, 24780, 20650, held=9000), 0.0)

    def test_the_hold_comes_off_the_capped_figure_not_the_ledger_claim(self):
        """Ledger claims 5,000, only 1,200 was really overpaid, 1,000 of it is promised back."""
        self.assertEqual(usable_credit(-5000, 11200, 10000, held=1000), 200.0)

    def test_no_hold_changes_nothing(self):
        self.assertEqual(usable_credit(-4130, 24780, 20650), 4130.0)
        self.assertEqual(usable_credit(-4130, 24780, 20650, held=None), 4130.0)

    def test_a_hold_read_from_the_db_layer_is_tolerated(self):
        self.assertEqual(usable_credit("-4130", "24780", "20650", held="1000.00"), 3130.0)


class OneReaderTests(unittest.TestCase):
    """Only `usable_po_credit` may apply the cap; every spender and listing reads through it.

    A second caller of `usable_credit` is a second copy of "how much may this PO spend", and the
    copies drift: a credit hold added to one reader would leave the other offering held money.
    """

    SHARED_READER = Path("api/po_adjustments/_payment_utils.py")

    def test_only_the_shared_reader_calls_usable_credit(self):
        package = Path(__file__).resolve().parent.parent
        callers = []
        for path in package.rglob("*.py"):
            if path.name.startswith("test_") or path.name == "po_credit.py":
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    func = node.func
                    name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
                    if name == "usable_credit":
                        callers.append(path.relative_to(package))
        self.assertEqual(sorted(set(callers)), [self.SHARED_READER])
