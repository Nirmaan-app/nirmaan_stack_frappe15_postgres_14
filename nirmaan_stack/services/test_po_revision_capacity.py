# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the D1 revision-capacity decision.

Pure module, so these are plain unit tests — no site, no DB, no fixtures.

THE TWO HALVES, and the second one is the one that will get broken by someone "improving"
this later:

  1. BLOCK when a decrease cannot be absorbed BECAUSE a mid-approval term is holding the
     value. This is the PO/246/00103/26-27 case.

  2. DO NOT BLOCK when a decrease cannot be absorbed and there is NO mid-approval term. That
     shortfall is a REAL overpayment — money genuinely left the building — and it is the
     entire reason the PO Adjustments system exists. A gate that catches it would break
     legitimate overpayment handling, which is worse than the bug being fixed.

`test_shortfall_without_mid_approval_terms_is_not_blocked` is half 2. If it ever fails,
someone has turned this into "block any unabsorbable decrease" and broken the good path.
"""

import unittest

from nirmaan_stack.services.po_revision_capacity import (
    MID_APPROVAL_TERM_STATUSES,
    REDUCIBLE_TERM_STATUSES,
    assess_decrease,
)


def term(amount, term_status, label="Term", project_payment=None):
    return {
        "label": label,
        "amount": amount,
        "term_status": term_status,
        "project_payment": project_payment,
    }


class AssessDecreaseTests(unittest.TestCase):
    # ── half 1: block when a payment request is the cause ────────────────────────

    def test_the_po_246_case(self):
        """One term, 100% of the PO, sitting in CEO Pending. Reducible capacity is zero."""
        terms = [term(24780, "CEO Pending", "Advance Payment", "PAY-00103-254")]

        result = assess_decrease(terms, 4130)

        self.assertTrue(result.is_blocked)
        self.assertEqual(result.capacity, 0)
        self.assertEqual(result.shortfall, 4130)
        self.assertEqual(len(result.blocking_terms), 1)
        self.assertEqual(result.blocking_terms[0].project_payment, "PAY-00103-254")
        self.assertEqual(result.blocking_terms[0].term_status, "CEO Pending")

    def test_partial_capacity_still_blocks_on_the_shortfall(self):
        """Some Created capacity, not enough. The mid-approval term is still the cause."""
        terms = [
            term(1000, "Created", "Remaining Payment"),
            term(9000, "Requested", "Advance Payment", "PAY-1"),
        ]

        result = assess_decrease(terms, 4000)

        self.assertTrue(result.is_blocked)
        self.assertEqual(result.capacity, 1000)
        self.assertEqual(result.shortfall, 3000)

    def test_every_mid_approval_status_blocks(self):
        for status in MID_APPROVAL_TERM_STATUSES:
            with self.subTest(status=status):
                result = assess_decrease([term(500, status, "T", "PAY-X")], 500)
                self.assertTrue(result.is_blocked, f"{status} should block")

    def test_all_blocking_terms_are_reported(self):
        """Listing one and stopping would send the user back for a second refusal."""
        terms = [
            term(100, "Requested", "A", "PAY-1"),
            term(200, "CEO Pending", "B", "PAY-2"),
            term(50, "Created", "C"),
        ]

        result = assess_decrease(terms, 300)

        self.assertTrue(result.is_blocked)
        self.assertEqual([t.label for t in result.blocking_terms], ["A", "B"])

    # ── half 2: the good path must stay open ─────────────────────────────────────

    def test_shortfall_without_mid_approval_terms_is_not_blocked(self):
        """A REAL overpayment: fully Paid terms, PO shrinks below what was paid.

        This is what the PO Adjustments system is FOR. Blocking it would be a worse bug than
        the one D1 fixes.
        """
        terms = [term(92040, "Paid", "Material Readiness"), term(2478, "Paid", "Revision Adj")]

        result = assess_decrease(terms, 708)

        self.assertFalse(result.is_blocked)
        self.assertEqual(result.capacity, 0)
        self.assertEqual(result.shortfall, 708)

    def test_sufficient_capacity_is_not_blocked_even_with_a_pending_request(self):
        """A mid-approval term is only a problem when the decrease actually needs it."""
        terms = [
            term(10000, "Created", "After Delivery"),
            term(10000, "CEO Pending", "Advance", "PAY-1"),
        ]

        result = assess_decrease(terms, 4130)

        self.assertFalse(result.is_blocked)
        self.assertEqual(result.capacity, 10000)
        self.assertEqual(result.shortfall, 0)

    def test_exact_capacity_is_not_blocked(self):
        result = assess_decrease([term(4130, "Created", "T"), term(10, "Requested", "R", "P")], 4130)
        self.assertFalse(result.is_blocked)

    def test_return_terms_are_neither_capacity_nor_blockers(self):
        """A `Return` term is money already sent back — it can't absorb and isn't in flight."""
        terms = [term(-563.33, "Return", "RA PO X"), term(1000, "Created", "T")]

        result = assess_decrease(terms, 500)

        self.assertFalse(result.is_blocked)
        self.assertEqual(result.capacity, 1000)

    # ── shape and edges ──────────────────────────────────────────────────────────

    def test_an_increase_is_never_assessed(self):
        self.assertFalse(assess_decrease([term(100, "CEO Pending", "T", "P")], 0).is_blocked)

    def test_a_zero_decrease_never_blocks_even_when_capacity_is_negative(self):
        """Guards the `decrease <= TOLERANCE` short-circuit specifically.

        A `Created` term can legitimately hold a NEGATIVE amount: live data carries 10 of
        them (worst −₹621,614.56) plus 11 adjusted-to-zero. With negative capacity,
        `shortfall = decrease - capacity` is POSITIVE even
        when nothing is being decreased, so a gate keyed on shortfall alone would refuse a
        revision that reduces nothing. Only the explicit zero-decrease check prevents that.
        """
        terms = [term(-500, "Created", "adjusted term"), term(100, "CEO Pending", "T", "PAY-1")]

        result = assess_decrease(terms, 0)

        self.assertEqual(result.capacity, -500)
        self.assertFalse(result.is_blocked, "a revision that decreases nothing must never block")

    def test_no_terms_at_all_is_not_blocked(self):
        """Nothing to absorb with, but also no payment request to blame."""
        self.assertFalse(assess_decrease([], 5000).is_blocked)

    def test_frappe_doc_style_objects_work_too(self):
        """Callers pass Frappe child docs; the module reads attributes as well as keys."""

        class Row:
            def __init__(self, **kw):
                self.__dict__.update(kw)

        rows = [Row(label="T", amount=1000, term_status="CEO Pending", project_payment="PAY-1")]
        self.assertTrue(assess_decrease(rows, 2000).is_blocked)

    def test_whitespace_in_status_is_tolerated(self):
        """`term_status` is a free-text Data field — live data holds strays like 'BLOCK'."""
        self.assertEqual(assess_decrease([term(500, " Created ", "T")], 100).capacity, 500)

    def test_unknown_statuses_are_neither_capacity_nor_blockers(self):
        """Live data carries 'BLOCK' and 'Credit Note'. Neither absorbs nor blames."""
        result = assess_decrease([term(900, "BLOCK", "?"), term(100, "Credit Note", "?")], 500)
        self.assertEqual(result.capacity, 0)
        self.assertFalse(result.is_blocked)

    def test_capacity_definition_is_exactly_created(self):
        """Pinned because `_auto_absorb_created_terms` shares this set. Widening it here
        silently widens what the absorber will reduce."""
        self.assertEqual(REDUCIBLE_TERM_STATUSES, frozenset({"Created"}))
