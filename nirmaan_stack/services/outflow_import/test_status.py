# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for nirmaan_stack.services.outflow_import.status -- the SINGLE status deriver (B3).

These pin the precedence order, which is the part of this module most likely to be "tidied" into
something alphabetical or convenient later. The order encodes findings about the organisation, not
about the file:

    duplicate  >  not successful  >  control exception  >  amount / reference mismatch  >  reconciled

A `Control exception` -- money that left the bank against a payment nobody had approved -- must
never be masked by an amount delta that happens to sit on the same row.
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.matcher import (
    BASIS_BANK_REFERENCE,
    BASIS_VENDOR_AMOUNT_DATE,
    PaymentGroup,
    RowMatchResult,
    TargetRef,
    VendorResolution,
)
from nirmaan_stack.services.outflow_import.status import (
    BATCH_COMPLETED,
    BATCH_COMPLETED_WITH_EXCEPTIONS,
    BATCH_DRAFT,
    BATCH_IN_REVIEW,
    BATCH_PARTIALLY_SETTLED,
    OPEN_ROW_STATUSES,
    ROW_AMOUNT_MISMATCH,
    ROW_CONTROL_EXCEPTION,
    ROW_ERROR,
    ROW_PENDING,
    ROW_RECONCILED,
    ROW_REFERENCE_MISMATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_UNMATCHED,
    TERMINAL_ROW_STATUSES,
    derive_batch_counters,
    derive_batch_status,
    derive_row_outcome,
    derive_staged_row_outcome,
)


class _Row:
    def __init__(self, amount="5000", is_success=True, status_raw="SUCCESS",
                 bank_reference_no="900000000001", normalized_reference=None):
        self.amount = Decimal(str(amount))
        self.is_success = is_success
        self.status_raw = status_raw
        self.bank_reference_no = bank_reference_no
        self.normalized_reference = (
            bank_reference_no if normalized_reference is None else normalized_reference
        )


def _payment(name="PAY-1", amount="5000", status="Paid", reference="900000000001"):
    return TargetRef("Project Payments", name, Decimal(str(amount)), status, "VEN-1", reference)


def _match(targets, basis=BASIS_BANK_REFERENCE, expenses=()):
    return RowMatchResult(
        vendor=VendorResolution(),
        payment_groups=(PaymentGroup(targets=tuple(targets), basis=basis),) if targets else (),
        expense_candidates=tuple(expenses),
    )


class TestPrecedence(unittest.TestCase):
    def test_duplicate_outranks_everything_including_a_clean_match(self):
        outcome = derive_row_outcome(_Row(), _match([_payment()]), already_imported_in="OFI-26-00001")
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("OFI-26-00001", outcome.note)

    def test_failed_transfer_outranks_its_own_match(self):
        # A FAILED transfer still carries a bank reference and matches a payment perfectly well.
        outcome = derive_row_outcome(
            _Row(is_success=False, status_raw="FAILED"), _match([_payment()])
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("FAILED", outcome.note)

    def test_control_exception_outranks_an_amount_mismatch_on_the_same_row(self):
        # Both findings are true here: the payment is CEO Pending AND the total disagrees. The
        # organisational finding is the one that must surface.
        outcome = derive_row_outcome(
            _Row(amount="5000"), _match([_payment(amount="4000", status="CEO Pending")])
        )
        self.assertEqual(outcome.status, ROW_CONTROL_EXCEPTION)


class TestReadOnlyOutcomes(unittest.TestCase):
    def test_exact_single_match_is_reconciled(self):
        outcome = derive_row_outcome(_Row(), _match([_payment()]))
        self.assertEqual(outcome.status, ROW_RECONCILED)
        self.assertIn("PAY-1", outcome.note)

    def test_fan_out_whose_total_agrees_is_reconciled_and_says_how_many(self):
        targets = [_payment(f"PAY-{i}", "1000") for i in range(1, 8)]
        outcome = derive_row_outcome(_Row(amount="7000"), _match(targets))
        self.assertEqual(outcome.status, ROW_RECONCILED)
        self.assertIn("7 payments", outcome.note)

    def test_shortfall_is_an_amount_mismatch_that_names_the_implied_rate(self):
        # A Rs 100,000 payment settled by a Rs 98,000 transfer: 2% withheld. REPORTED, never written.
        outcome = derive_row_outcome(_Row(amount="98000"), _match([_payment(amount="100000")]))
        self.assertEqual(outcome.status, ROW_AMOUNT_MISMATCH)
        self.assertIn("2.00%", outcome.note)
        self.assertIn("never writes a TDS figure", outcome.note)

    def test_overpayment_is_an_amount_mismatch_and_is_worded_as_one(self):
        # The inverse must not be silently zeroed: more money left than any payment claims.
        outcome = derive_row_outcome(_Row(amount="100000"), _match([_payment(amount="98000")]))
        self.assertEqual(outcome.status, ROW_AMOUNT_MISMATCH)
        self.assertIn("MORE", outcome.note)

    def test_control_exception_names_the_offending_payment_and_its_status(self):
        outcome = derive_row_outcome(_Row(), _match([_payment(status="CEO Pending")]))
        self.assertEqual(outcome.status, ROW_CONTROL_EXCEPTION)
        self.assertIn("PAY-1", outcome.note)
        self.assertIn("CEO Pending", outcome.note)

    def test_pass_b_match_with_a_different_stored_reference_is_a_reference_mismatch(self):
        outcome = derive_row_outcome(
            _Row(bank_reference_no="900000000001"),
            _match([_payment(reference="PO/077/00066/25-26")], basis=BASIS_VENDOR_AMOUNT_DATE),
        )
        self.assertEqual(outcome.status, ROW_REFERENCE_MISMATCH)
        self.assertIn("PO/077/00066/25-26", outcome.note)
        self.assertIn("never edits a payment", outcome.note)

    def test_pass_b_match_whose_reference_agrees_is_simply_reconciled(self):
        outcome = derive_row_outcome(
            _Row(bank_reference_no="900000000001"),
            _match([_payment(reference="900000000001")], basis=BASIS_VENDOR_AMOUNT_DATE),
        )
        self.assertEqual(outcome.status, ROW_RECONCILED)

    def test_amount_mismatch_is_unreachable_on_pass_b_by_construction(self):
        # Pass B matches on an exact amount, so a delta cannot arise there. The two mismatch
        # outcomes are mutually exclusive by construction, not by precedence.
        outcome = derive_row_outcome(
            _Row(amount="5000", bank_reference_no="900000000001"),
            _match([_payment(amount="5000", reference="junk")], basis=BASIS_VENDOR_AMOUNT_DATE),
        )
        self.assertNotEqual(outcome.status, ROW_AMOUNT_MISMATCH)


class TestStagedOutcome(unittest.TestCase):
    """At upload nothing has been matched, so only the facts knowable without matching decide."""

    def test_a_clean_successful_row_is_pending_not_unmatched(self):
        # `Unmatched` is a FINDING. Reporting it before any matching ran would be a lie about work
        # that has not happened.
        self.assertEqual(derive_staged_row_outcome(_Row()).status, ROW_PENDING)

    def test_a_failed_transfer_is_skipped_with_the_same_wording_as_after_matching(self):
        row = _Row(is_success=False, status_raw="FAILED")
        staged = derive_staged_row_outcome(row)
        matched = derive_row_outcome(row, _match([]))
        self.assertEqual(staged.status, ROW_SKIPPED)
        self.assertEqual(staged.note, matched.note)

    def test_a_transfer_already_in_an_earlier_batch_is_skipped(self):
        outcome = derive_staged_row_outcome(_Row(), already_imported_in="OFI-26-00001")
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("OFI-26-00001", outcome.note)

    def test_the_same_transfer_twice_in_one_file_is_skipped_the_second_time(self):
        # Distinct from the cross-batch case, and it has to be: the cross-batch lookup cannot see
        # the file it is currently reading. Left uncaught, both copies match the same payment and
        # the second match insert violates the (transfer_id, target) unique constraint, aborting
        # the whole pass with a database error.
        outcome = derive_staged_row_outcome(_Row(), duplicate_in_file=True)
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("earlier in the same statement", outcome.note)

    def test_an_earlier_batch_outranks_an_in_file_duplicate_in_the_message(self):
        outcome = derive_staged_row_outcome(
            _Row(), already_imported_in="OFI-26-00001", duplicate_in_file=True
        )
        self.assertIn("OFI-26-00001", outcome.note)


class TestUnmatched(unittest.TestCase):
    def test_no_match_at_all(self):
        outcome = derive_row_outcome(_Row(), _match([]))
        self.assertEqual(outcome.status, ROW_UNMATCHED)
        self.assertIn("No payment or approved expense", outcome.note)

    def test_no_payment_but_expense_candidates_points_at_the_expense_work(self):
        expense = TargetRef("Project Expenses", "EXP-1", Decimal("5000"), "Approved")
        from nirmaan_stack.services.outflow_import.matcher import ExpenseCandidate

        outcome = derive_row_outcome(
            _Row(), _match([], expenses=[ExpenseCandidate(target=expense, score=0.8)])
        )
        self.assertEqual(outcome.status, ROW_UNMATCHED)
        self.assertIn("1 approved expense", outcome.note)

    def test_no_match_object_at_all_is_unmatched_not_a_crash(self):
        self.assertEqual(derive_row_outcome(_Row(), None).status, ROW_UNMATCHED)


class TestStatusSets(unittest.TestCase):
    def test_read_only_findings_are_terminal(self):
        # Reporting them WAS the job; they need nothing further from anyone.
        for status in (ROW_RECONCILED, ROW_AMOUNT_MISMATCH, ROW_REFERENCE_MISMATCH, ROW_CONTROL_EXCEPTION):
            self.assertIn(status, TERMINAL_ROW_STATUSES)

    def test_unmatched_and_error_are_open(self):
        # Unmatched is expense work nobody has done; Error must be retried.
        self.assertIn(ROW_UNMATCHED, OPEN_ROW_STATUSES)
        self.assertIn(ROW_ERROR, OPEN_ROW_STATUSES)

    def test_every_status_is_either_open_or_terminal_and_never_both(self):
        every = TERMINAL_ROW_STATUSES | OPEN_ROW_STATUSES
        self.assertEqual(TERMINAL_ROW_STATUSES & OPEN_ROW_STATUSES, frozenset())
        for status in (ROW_PENDING, ROW_RECONCILED, ROW_AMOUNT_MISMATCH, ROW_REFERENCE_MISMATCH,
                       ROW_CONTROL_EXCEPTION, ROW_UNMATCHED, ROW_SETTLED, ROW_SKIPPED, ROW_ERROR):
            self.assertIn(status, every)


class TestVocabularyParity(unittest.TestCase):
    """BE half of the FE<->BE parity pin (ADR-0010 F1).

    The TypeScript half is `frontend/src/pages/outflow-import/outflowImportStatus.test.ts` and
    asserts the SAME literal list. Neither test can import the other's language, so the pin is that
    both name the vocabulary explicitly -- change one side alone and the other side's test fails.

    Worth pinning because an unmirrored status does not crash anything. It arrives at the browser,
    misses the tone map, and renders as unstyled grey text that looks entirely deliberate.
    """

    EXPECTED = [
        "Pending",
        "Reconciled",
        "Amount mismatch",
        "Reference mismatch",
        "Control exception",
        "Unmatched",
        "Settled",
        "Skipped",
        "Error",
    ]

    def test_the_vocabulary_is_exactly_these_nine(self):
        actual = {
            ROW_PENDING, ROW_RECONCILED, ROW_AMOUNT_MISMATCH, ROW_REFERENCE_MISMATCH,
            ROW_CONTROL_EXCEPTION, ROW_UNMATCHED, ROW_SETTLED, ROW_SKIPPED, ROW_ERROR,
        }
        self.assertEqual(actual, set(self.EXPECTED))

    def test_terminal_and_open_partition_the_vocabulary(self):
        self.assertEqual(TERMINAL_ROW_STATUSES | OPEN_ROW_STATUSES, set(self.EXPECTED))
        self.assertEqual(TERMINAL_ROW_STATUSES & OPEN_ROW_STATUSES, frozenset())

    def test_the_batch_vocabulary_matches_the_doctype_select(self):
        # These five strings are also the `status` Select options on Outflow Import Batch. A value
        # this module derives that the doctype does not offer would fail on write.
        self.assertEqual(
            {
                BATCH_DRAFT, BATCH_IN_REVIEW, BATCH_PARTIALLY_SETTLED,
                BATCH_COMPLETED, BATCH_COMPLETED_WITH_EXCEPTIONS,
            },
            {
                "Draft", "In Review", "Partially Settled",
                "Completed", "Completed with exceptions",
            },
        )


class TestBatchStatus(unittest.TestCase):
    def test_no_rows_is_draft(self):
        self.assertEqual(derive_batch_status([]), BATCH_DRAFT)

    def test_all_pending_is_in_review(self):
        self.assertEqual(derive_batch_status([ROW_PENDING, ROW_PENDING]), BATCH_IN_REVIEW)

    def test_mixed_is_partially_settled(self):
        self.assertEqual(derive_batch_status([ROW_SETTLED, ROW_PENDING]), BATCH_PARTIALLY_SETTLED)

    def test_all_terminal_is_completed(self):
        self.assertEqual(
            derive_batch_status([ROW_RECONCILED, ROW_SETTLED, ROW_SKIPPED]), BATCH_COMPLETED
        )

    def test_read_only_findings_alone_complete_a_batch(self):
        # A batch of nothing but reported exceptions is DONE -- there is nothing to settle.
        self.assertEqual(
            derive_batch_status([ROW_CONTROL_EXCEPTION, ROW_AMOUNT_MISMATCH]), BATCH_COMPLETED
        )

    def test_force_close_with_open_rows_is_completed_with_exceptions(self):
        self.assertEqual(
            derive_batch_status([ROW_SETTLED, ROW_UNMATCHED], force_closed=True),
            BATCH_COMPLETED_WITH_EXCEPTIONS,
        )

    def test_force_close_with_no_open_rows_is_plain_completed(self):
        self.assertEqual(derive_batch_status([ROW_SETTLED], force_closed=True), BATCH_COMPLETED)


class TestBatchCounters(unittest.TestCase):
    def test_counters_partition_the_rows(self):
        statuses = [ROW_PENDING, ROW_RECONCILED, ROW_SETTLED, ROW_SKIPPED,
                    ROW_CONTROL_EXCEPTION, ROW_AMOUNT_MISMATCH, ROW_ERROR]
        counters = derive_batch_counters(statuses)
        self.assertEqual(counters["total_rows"], 7)
        self.assertEqual(counters["reviewed_rows"], 6)
        self.assertEqual(counters["reconciled_rows"], 1)
        self.assertEqual(counters["settled_rows"], 1)
        self.assertEqual(counters["skipped_rows"], 1)
        self.assertEqual(counters["exception_rows"], 2)
        self.assertEqual(counters["error_rows"], 1)

    def test_empty_batch_counts_zero(self):
        self.assertEqual(derive_batch_counters([])["total_rows"], 0)


if __name__ == "__main__":
    unittest.main()
