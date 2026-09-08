# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the allocation deriver (ADR-0020).

THE PROPERTY UNDER TEST IS THAT THERE IS NO COUNT. Every question this module answers is answered
from a BALANCE, so an unbounded number of legs is safe and a reversed leg simply stops contributing.
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.allocation import (
    MATCH_REVERSED,
    MATCH_SETTLED,
    allocated_of,
    allocation_fits,
    allocation_note,
    is_fully_allocated,
    is_over_allocated,
    remaining_of,
    status_for_allocation,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)


def _leg(amount, kind=MATCH_SETTLED):
    return {"target_amount": amount, "match_kind": kind}


# The real group from the live ledger that this feature exists for.
_REAL = [
    _leg("55819"), _leg("5310"), _leg("63720"),
    _leg("33268"), _leg("47208"), _leg("8071"),
]
_REAL_TOTAL = Decimal("213396")


class TestAllocatedOf(unittest.TestCase):
    def test_no_legs_is_zero(self):
        self.assertEqual(allocated_of([]), Decimal("0"))

    def test_it_sums_the_settled_legs(self):
        self.assertEqual(allocated_of(_REAL), _REAL_TOTAL)

    def test_a_reversed_leg_contributes_nothing(self):
        legs = [_leg("55819"), _leg("5310", MATCH_REVERSED)]
        self.assertEqual(allocated_of(legs), Decimal("55819"))

    def test_it_never_goes_through_float(self):
        """Paise survive. `Decimal(0.1)` is not `Decimal('0.1')`, and this module is summing money."""
        self.assertEqual(allocated_of([_leg("18678.69"), _leg("0.31")]), Decimal("18679.00"))

    def test_an_unknown_kind_contributes_nothing(self):
        """Fail CLOSED. A kind this module has never heard of must not silently count as money
        allocated -- that would let a row read Settled with nothing behind it."""
        self.assertEqual(allocated_of([_leg("1000", "Reconciled")]), Decimal("0"))


class TestRemainingOf(unittest.TestCase):
    def test_the_whole_transfer_is_remaining_when_nothing_is_allocated(self):
        self.assertEqual(remaining_of(_REAL_TOTAL, []), _REAL_TOTAL)

    def test_it_shrinks_leg_by_leg(self):
        self.assertEqual(remaining_of(_REAL_TOTAL, _REAL[:2]), Decimal("152267"))

    def test_it_reaches_zero_on_the_last_leg(self):
        self.assertEqual(remaining_of(_REAL_TOTAL, _REAL), Decimal("0"))

    def test_reversing_a_leg_raises_it_again(self):
        legs = list(_REAL[:2])
        self.assertEqual(remaining_of(_REAL_TOTAL, legs), Decimal("152267"))
        legs[1] = _leg("5310", MATCH_REVERSED)
        self.assertEqual(remaining_of(_REAL_TOTAL, legs), Decimal("157577"))


class TestIsFullyAllocated(unittest.TestCase):
    def test_exact(self):
        self.assertTrue(is_fully_allocated(_REAL_TOTAL, _REAL))

    def test_within_the_settle_window(self):
        """Paise gaps land here -- the allocation path never rewrites a payment's amount, so this
        is where a rounding difference is absorbed."""
        self.assertTrue(is_fully_allocated("213400", _REAL))   # Rs 4 over
        self.assertTrue(is_fully_allocated("213391", _REAL))   # Rs 5 under, inclusive
        self.assertFalse(is_fully_allocated("213402", _REAL))  # Rs 6 over

    def test_nothing_allocated_is_not_full(self):
        self.assertFalse(is_fully_allocated(_REAL_TOTAL, []))


class TestStatusForAllocation(unittest.TestCase):
    def test_no_settled_legs_returns_the_fallback(self):
        """A row with no money written is whatever the matcher last made it -- this module does not
        invent a status for it."""
        self.assertEqual(
            status_for_allocation(_REAL_TOTAL, [], fallback=ROW_MISMATCHED), ROW_MISMATCHED
        )
        self.assertEqual(
            status_for_allocation(_REAL_TOTAL, [], fallback=ROW_MATCHED), ROW_MATCHED
        )

    def test_every_leg_reversed_returns_the_fallback(self):
        legs = [_leg("55819", MATCH_REVERSED)]
        self.assertEqual(
            status_for_allocation(_REAL_TOTAL, legs, fallback=ROW_MATCHED), ROW_MATCHED
        )

    def test_some_allocated_is_partially_allocated(self):
        self.assertEqual(
            status_for_allocation(_REAL_TOTAL, _REAL[:2], fallback=ROW_MATCHED),
            ROW_PARTIALLY_ALLOCATED,
        )

    def test_all_allocated_is_settled(self):
        self.assertEqual(
            status_for_allocation(_REAL_TOTAL, _REAL, fallback=ROW_MATCHED), ROW_SETTLED
        )

    def test_a_single_leg_covering_the_whole_transfer_is_settled(self):
        """The ordinary 1:1 case, expressed through the same deriver. This is what keeps
        `settle_row`'s outcome unchanged when it starts routing through here."""
        self.assertEqual(
            status_for_allocation("5000", [_leg("5000")], fallback=ROW_MATCHED), ROW_SETTLED
        )

    def test_over_allocation_still_reads_settled_rather_than_inventing_a_status(self):
        """The GATE refuses over-allocation (`is_over_allocated`); the DERIVER does not get a
        fourth status for a state the write path cannot produce."""
        self.assertEqual(
            status_for_allocation("1000", [_leg("5000")], fallback=ROW_MATCHED), ROW_SETTLED
        )


class TestTheGates(unittest.TestCase):
    def test_a_leg_within_the_remainder_fits(self):
        self.assertTrue(allocation_fits(_REAL_TOTAL, _REAL[:2], "63720"))

    def test_a_leg_larger_than_the_remainder_does_not(self):
        self.assertFalse(allocation_fits(_REAL_TOTAL, _REAL[:5], "8078"))

    def test_the_boundary_is_inclusive_of_the_tolerance(self):
        """Same window as everywhere else, and inclusive at the edge for the same reason:
        'within five rupees, but not exactly five' cannot be said to an accountant."""
        self.assertTrue(allocation_fits("1000", [], "1005"))
        self.assertFalse(allocation_fits("1000", [], "1006"))

    def test_over_allocation_is_detected(self):
        self.assertFalse(is_over_allocated("1000", [_leg("1005")]))
        self.assertTrue(is_over_allocated("1000", [_leg("1006")]))

    def test_an_empty_row_is_not_over_allocated(self):
        self.assertFalse(is_over_allocated("1000", []))


class TestAllocationNote(unittest.TestCase):
    """The reviewer-facing sentence. Moved out of `api/outflow_import/expenses.py` at review
    (ADR-0020) specifically so its 'Partly allocated' branch -- the artifact this whole feature
    exists to produce -- is exercised by the bench-free pure suite, not left unreachable."""

    def test_nothing_allocated(self):
        note = allocation_note(_REAL_TOTAL, [], ROW_MISMATCHED)
        self.assertEqual(note, "Nothing is allocated against this transfer.")

    def test_nothing_allocated_when_every_leg_is_reversed(self):
        """A reversed leg is not `live`, so it must read exactly like no leg at all."""
        legs = [_leg("55819", MATCH_REVERSED)]
        note = allocation_note(_REAL_TOTAL, legs, ROW_MISMATCHED)
        self.assertEqual(note, "Nothing is allocated against this transfer.")

    def test_partly_allocated_names_every_live_leg(self):
        """The sentence must be checkable against the statement line by eye -- so the numbers in
        it must be the real allocated / remaining figures (55819 + 5310 = 61129 of 213396, leaving
        152267), not a leg count -- and every live target must be named."""
        legs = [
            {"target_amount": "55819", "match_kind": MATCH_SETTLED,
             "target_doctype": "Project Payments", "target_name": "PAY-1"},
            {"target_amount": "5310", "match_kind": MATCH_SETTLED,
             "target_doctype": "Project Expenses", "target_name": "EXP-1"},
        ]
        note = allocation_note(_REAL_TOTAL, legs, ROW_PARTIALLY_ALLOCATED)
        self.assertIn("Project Payments PAY-1", note)
        self.assertIn("Project Expenses EXP-1", note)
        self.assertIn("Partly allocated: 61129 of 213396, 152267 still to allocate.", note)

    def test_fully_allocated_names_what_was_settled(self):
        legs = [
            {"target_amount": "5000", "match_kind": MATCH_SETTLED,
             "target_doctype": "Project Payments", "target_name": "PAY-9"},
        ]
        note = allocation_note("5000", legs, ROW_SETTLED)
        self.assertEqual(note, "Fully allocated. Settled Project Payments PAY-9.")

    def test_a_reversed_leg_is_absent_from_a_settled_notes_names(self):
        legs = [
            {"target_amount": "5000", "match_kind": MATCH_SETTLED,
             "target_doctype": "Project Payments", "target_name": "PAY-9"},
            {"target_amount": "5000", "match_kind": MATCH_REVERSED,
             "target_doctype": "Project Payments", "target_name": "PAY-OLD"},
        ]
        note = allocation_note("5000", legs, ROW_SETTLED)
        self.assertNotIn("PAY-OLD", note)
