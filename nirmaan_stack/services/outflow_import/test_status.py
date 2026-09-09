# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for nirmaan_stack.services.outflow_import.status -- the SINGLE status deriver (B3).

REWRITTEN AT THE v3 REVERSAL (slice V0). The v2 suite pinned a precedence ending in `Reconciled`
and a `Control exception` that outranked everything; both statuses are gone. What is pinned now:

    already imported  >  failed at the bank  >  already recorded as Paid  >  candidates  >  nothing

The third step is the one most likely to be "simplified" away later, so it gets the most tests. It
is the owner's Q14 ruling: an already-Paid record is a SKIP, never a match. Delete it and a payment
somebody ticked by hand comes back `Unmatched`, and the obvious next click books the same money a
second time -- which under Q12 (mixed usage is normal) is the common case, not an edge case.

The vocabulary itself is pinned here AND in `outflowImportStatus.test.ts`. The two lists must agree
or one half of the app renders a status the other has never heard of.
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.ledgers import (
    INFLOW_DOCTYPE,
    LEDGER_DOCTYPES,
    NON_PROJECT_EXPENSE_DOCTYPE,
    RECEIVED_LEDGER_DOCTYPES,
    SETTLEABLE_STATUSES,
)
from nirmaan_stack.services.outflow_import.matcher import (
    BASIS_BANK_REFERENCE,
    ExpenseCandidate,
    PaymentGroup,
    RowMatchResult,
    TargetRef,
    VendorResolution,
)
from nirmaan_stack.services.outflow_import.status import (
    ORIGIN_ACCEPTED,
    ORIGIN_NO_SUGGESTION,
    ORIGIN_OVERRIDDEN,
    settlement_origin,
    BATCH_COMPLETED,
    BATCH_DRAFT,
    BATCH_IN_REVIEW,
    BATCH_PARTIALLY_SETTLED,
    BATCH_STATUSES,
    OPEN_ROW_STATUSES,
    ROW_ERROR,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_STATUSES,
    SETTLED_BLOCK_PAID,
    SETTLED_BLOCK_RECEIVED,
    SETTLED_LEDGER_OTHER,
    ROW_DIRECTION_CREDIT,
    SUMMARY_EXCLUDED_STATUSES,
    TERMINAL_ROW_STATUSES,
    RowOutcome,
    SettledLedgerEntry,
    StatusTally,
    Suggestion,
    derive_batch_counters,
    derive_settled_ledger_split,
    derive_settled_direction_blocks,
    is_received_direction,
    batch_is_open,
    derive_batch_status,
    derive_import_summary,
    STAGED_NOTE_NO_SETTLEMENT_PATH,
    derive_duplicate_guard_outcome,
    derive_row_outcome,
    derive_staged_row_outcome,
    several_found_note,
    sole_suggestion,
)


class _Row:
    def __init__(self, amount="5000", is_success=True, status_raw="SUCCESS",
                 bank_reference_no="900000000001"):
        self.amount = Decimal(str(amount))
        self.is_success = is_success
        self.status_raw = status_raw
        self.bank_reference_no = bank_reference_no


def _payment(name="PAY-1", amount="5000", status="Approved", reference=""):
    return TargetRef("Project Payments", name, Decimal(str(amount)), status, "VEN-1", reference)


def _expense(name="PE-1", amount="5000", doctype="Project Expenses"):
    return ExpenseCandidate(
        target=TargetRef(doctype, name, Decimal(str(amount)), "Approved"), score=1.0
    )


def _group(targets, basis=BASIS_BANK_REFERENCE):
    return PaymentGroup(targets=tuple(targets), basis=basis)


def _match(targets=(), expenses=(), basis=BASIS_BANK_REFERENCE):
    """ONE group holding every target -- i.e. a FAN-OUT, which is what tier 0 produces."""
    return RowMatchResult(
        vendor=VendorResolution(),
        payment_groups=(_group(targets, basis),) if targets else (),
        expense_candidates=tuple(expenses),
    )


def _match_many(targets=(), expenses=(), basis=BASIS_BANK_REFERENCE):
    """ONE GROUP PER TARGET -- i.e. N SEPARATE candidate payments, which is what tiers 1 and 2
    produce and what `_match` above cannot express.

    ⚠️ THIS HELPER DID NOT EXIST UNTIL 2026-08-10, AND ITS ABSENCE IS WHY THE WORST DEFECT IN THIS
    FEATURE SHIPPED. Every fixture built a single group, so `_settleable_candidates` reading only
    `payment_groups[0]` was indistinguishable from reading all of them, and a full green suite said
    nothing about the case that matters most on the main ledger: several separate approved payments
    at the same amount for the same vendor.
    """
    return RowMatchResult(
        vendor=VendorResolution(),
        payment_groups=tuple(_group([t], basis) for t in targets),
        expense_candidates=tuple(expenses),
    )


# --- the vocabulary itself ----------------------------------------------------------------------


class TestVocabulary(unittest.TestCase):
    def test_exactly_six_row_statuses_in_reviewer_order(self):
        self.assertEqual(
            ROW_STATUSES,
            (
                "Pending match run",
                "Matched",
                "Mismatched",
                "Settled",
                "Skipped",
                "Error",
            ),
        )

    def test_unmatched_is_retired_from_the_vocabulary(self):
        """⚠️ ASSERTED AS ABSENCE, and it is the one retired value a live database can still hold:
        rows staged before `patches/v3_0/merge_outflow_unmatched_status.py` runs carry it. Pinning
        the VOCABULARY is what makes such a row visibly stale rather than silently normal -- and it
        is the Python half of the parity pin with `outflowImportStatus.test.ts`, which asserts the
        same absence.
        """
        self.assertNotIn("Unmatched", ROW_STATUSES)
        self.assertNotIn("Unmatched", OPEN_ROW_STATUSES)
        self.assertNotIn("Unmatched", TERMINAL_ROW_STATUSES)

    def test_exactly_four_batch_statuses(self):
        self.assertEqual(
            BATCH_STATUSES, ("Draft", "In Review", "Partially Settled", "Completed")
        )

    def test_the_retired_v2_statuses_are_gone(self):
        """Reconciled / Amount mismatch / Reference mismatch / Control exception were RETIRED.

        Asserted as absence rather than trusted to a code read, because a re-added constant would
        otherwise pass every other test in this file while putting a status the frontend has never
        heard of into the database.
        """
        for retired in (
            "Reconciled",
            "Amount mismatch",
            "Reference mismatch",
            "Control exception",
            "Pending",
        ):
            self.assertNotIn(retired, ROW_STATUSES)
        self.assertNotIn("Completed with exceptions", BATCH_STATUSES)

    def test_only_settled_and_skipped_are_terminal(self):
        """NARROWER THAN v2 on purpose. v2 findings were terminal because reporting was the job;
        v3 settles, so a row that found something and was not confirmed is unfinished work."""
        self.assertEqual(TERMINAL_ROW_STATUSES, frozenset({ROW_SETTLED, ROW_SKIPPED}))

    def test_open_and_terminal_partition_the_vocabulary(self):
        self.assertEqual(set(ROW_STATUSES), OPEN_ROW_STATUSES | TERMINAL_ROW_STATUSES)
        self.assertFalse(OPEN_ROW_STATUSES & TERMINAL_ROW_STATUSES)

    def test_matched_and_mismatched_are_both_open(self):
        """Owner ruling: a mismatch must be RESOLVABLE, not merely reported. Marking it terminal
        would drop it out of every 'needs a decision' surface, which was the v2 defect."""
        self.assertIn(ROW_MATCHED, OPEN_ROW_STATUSES)
        self.assertIn(ROW_MISMATCHED, OPEN_ROW_STATUSES)


# --- precedence ---------------------------------------------------------------------------------


class TestPrecedence(unittest.TestCase):
    def test_already_imported_outranks_everything_including_a_clean_match(self):
        outcome = derive_row_outcome(
            _Row(), _match([_payment()]), already_imported_in="OFI-26-00001"
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("OFI-26-00001", outcome.note)

    def test_failed_transfer_outranks_a_match(self):
        """A FAILED transfer still carries a bank reference and matches perfectly well. Money that
        never moved must never settle anything."""
        row = _Row(is_success=False, status_raw="FAILED")
        outcome = derive_row_outcome(row, _match([_payment()]))
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("FAILED", outcome.note)

    def test_already_paid_outranks_candidates(self):
        outcome = derive_row_outcome(
            _Row(),
            _match([_payment("PAY-NEW")]),
            paid_duplicate=_group([_payment("PAY-OLD", status="Paid")]),
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("PAY-OLD", outcome.note)
        self.assertNotIn("PAY-NEW", outcome.note)

    def test_already_imported_outranks_already_paid(self):
        outcome = derive_row_outcome(
            _Row(),
            _match(),
            already_imported_in="OFI-26-00002",
            paid_duplicate=_group([_payment("PAY-OLD", status="Paid")]),
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("OFI-26-00002", outcome.note)


# --- the already-Paid duplicate check (owner ruling Q14) -----------------------------------------


class TestAlreadyPaidDuplicate(unittest.TestCase):
    def test_amounts_agree_is_a_skip_naming_the_record(self):
        outcome = derive_row_outcome(
            _Row(amount="5000"),
            _match(),
            paid_duplicate=_group([_payment("PAY-00066-003", amount="5000", status="Paid")]),
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("Already recorded as Paid", outcome.note)
        self.assertIn("PAY-00066-003", outcome.note)

    def test_a_sub_rupee_gap_is_the_bank_rounding_and_still_skips(self):
        """⚠️ THE REGRESSION THIS PINS COST 8 OF 26 ROWS IN A LIVE STATEMENT.

        This branch used an EXACT comparison while every other amount check in the feature used the
        +-Re 1 window. The bank rounds to the whole rupee and 31.4% of payments carry paise, so a
        payment hand-ticked at 18,903.60 against an 18,904.00 transfer was reported as a
        discrepancy -- under a note suggesting TDS, for 40 paise.

        Measured gaps from the statement that surfaced it: 0.14, 0.15, 0.18, 0.40, 0.57, 0.68, 0.86.
        """
        for recorded in ("18903.60", "18903.86", "18903.14", "18904.86"):
            outcome = derive_row_outcome(
                _Row(amount="18904"),
                _match(),
                paid_duplicate=_group([_payment(amount=recorded, status="Paid")]),
            )
            self.assertEqual(outcome.status, ROW_SKIPPED, f"recorded {recorded}")
            self.assertIn("Already recorded as Paid", outcome.note)

    def test_the_window_is_inclusive_at_exactly_the_settle_tolerance(self):
        """This branch reads the SETTLE window (`AMOUNT_TOLERANCE`), not tier 1's Re 1 -- a duplicate
        guard asks "is this the same money we already recorded", which is the same question the
        write guard asks. Stated to an accountant as "within five rupees", so exactly five is in."""
        outcome = derive_row_outcome(
            _Row(amount="18904"),
            _match(),
            paid_duplicate=_group([_payment(amount="18899", status="Paid")]),
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)

    def test_a_gap_just_over_the_window_is_still_reported(self):
        """The other half: widening the window must not swallow a real shortfall. Five rupees and
        one paisa is not rounding.

        ⚠️ ACCEPTED CONSEQUENCE OF THE 2026-08-07 WIDENING: a hand-ticked payment Rs 4 off now reads
        `Skipped` where it used to read `Mismatched`. The owner took that trade knowingly when tier 2
        arrived; it is recorded in `amounts.py` and it is not a regression to be "fixed" here."""
        outcome = derive_row_outcome(
            _Row(amount="18904"),
            _match(),
            paid_duplicate=_group([_payment(amount="18898.99", status="Paid")]),
        )
        self.assertEqual(outcome.status, ROW_MISMATCHED)

    def test_amounts_differ_is_mismatched_not_skipped(self):
        """The ONLY route to Mismatched: a gap wider than the rounding window. Both candidate passes
        match WITHIN that same window, so a disagreement is arithmetically impossible there."""
        outcome = derive_row_outcome(
            _Row(amount="232650"),
            _match(),
            paid_duplicate=_group([_payment("PAY-00066-003", amount="235000", status="Paid")]),
        )
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertIn("2350", outcome.note)
        self.assertIn("PAY-00066-003", outcome.note)

    def test_bank_paid_less_reads_as_a_deduction_and_shows_the_rate(self):
        outcome = derive_row_outcome(
            _Row(amount="98000"),
            _match(),
            paid_duplicate=_group([_payment(amount="100000", status="Paid")]),
        )
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertIn("less", outcome.note)
        self.assertIn("2.00%", outcome.note)
        self.assertIn("TDS", outcome.note)

    def test_bank_paid_more_says_so_without_inventing_a_rate(self):
        outcome = derive_row_outcome(
            _Row(amount="310000"),
            _match(),
            paid_duplicate=_group([_payment(amount="280000", status="Paid")]),
        )
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertIn("MORE", outcome.note)
        self.assertNotIn("TDS", outcome.note)

    def test_a_fan_out_that_totals_correctly_is_one_skip_not_a_partial(self):
        """40 real transfers cover 99 payments. Treating the group as one already-recorded transfer
        is what stops a legitimate fan-out being reported as a shortfall."""
        outcome = derive_row_outcome(
            _Row(amount="9000"),
            _match(),
            paid_duplicate=_group(
                [
                    _payment("PAY-A", amount="5000", status="Paid"),
                    _payment("PAY-B", amount="4000", status="Paid"),
                ]
            ),
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("PAY-A", outcome.note)
        self.assertIn("PAY-B", outcome.note)

    def test_an_empty_duplicate_group_is_ignored(self):
        """Defensive: an empty group must read as 'no duplicate found', not as a zero-amount
        record that mismatches every non-zero transfer."""
        outcome = derive_row_outcome(_Row(), _match([_payment()]), paid_duplicate=_group([]))
        self.assertEqual(outcome.status, ROW_MATCHED)


# --- Matched and the found-nothing half of Mismatched ------------------------------------------------------------------------


class TestMatched(unittest.TestCase):
    def test_one_approved_payment_is_matched(self):
        outcome = derive_row_outcome(_Row(), _match([_payment("PAY-1")]))
        self.assertEqual(outcome.status, ROW_MATCHED)
        self.assertIn("PAY-1", outcome.note)

    def test_one_approved_expense_is_also_matched(self):
        """All three ledgers reach the same final step, so an approved expense is as settleable as
        an approved payment. v2 reported this as Unmatched-with-a-hint."""
        outcome = derive_row_outcome(_Row(), _match(expenses=[_expense("PE-9")]))
        self.assertEqual(outcome.status, ROW_MATCHED)
        self.assertIn("PE-9", outcome.note)

    def test_a_fan_out_group_is_one_candidate_and_says_how_many(self):
        outcome = derive_row_outcome(
            _Row(amount="9000"),
            _match([_payment("PAY-A", amount="5000"), _payment("PAY-B", amount="4000")]),
        )
        self.assertEqual(outcome.status, ROW_MATCHED)
        self.assertIn("2 approved payments", outcome.note)

    def test_several_candidates_are_matched_and_the_note_refuses_to_choose(self):
        """Owner: the screen never guesses between two real records. The status says something was
        found; the note says a person must pick. There is deliberately no 'Ambiguous' status."""
        outcome = derive_row_outcome(
            _Row(), _match([_payment("PAY-1")], expenses=[_expense("PE-1")])
        )
        self.assertEqual(outcome.status, ROW_MATCHED)
        self.assertIn("2 approved records", outcome.note)
        self.assertIn("Choose", outcome.note)

    def test_the_note_COUNTS_separate_payments_instead_of_claiming_there_is_one(self):
        """⚠️ THE SENTENCE THAT LIED. With six separate approved payments the note read "One
        approved record at this amount: PAY-X" -- and that sentence is the reviewer's entire basis
        for ticking a row without opening it. It must count them and ask."""
        outcome = derive_row_outcome(
            _Row(), _match_many([_payment(f"PAY-{i}") for i in range(6)])
        )
        self.assertEqual(outcome.status, ROW_MATCHED)
        self.assertIn("6 approved records", outcome.note)
        self.assertIn("Choose", outcome.note)
        self.assertNotIn("One approved record", outcome.note)


class TestSoleSuggestion(unittest.TestCase):
    """What the screen may pre-select (slice R1).

    The rule is the owner's, re-affirmed 2026-08-06: exactly one approved record, or nothing. These
    tests exist because the pre-selection used to be re-derived in the browser from a DIFFERENT
    candidate list than the note counted, so the two could disagree on the same row.
    """

    def test_one_approved_payment_is_suggested(self):
        match = _match([_payment("PAY-1")])
        outcome = derive_row_outcome(_Row(), match)
        self.assertEqual(sole_suggestion(outcome, match), Suggestion("Project Payments", "PAY-1"))

    def test_one_approved_expense_is_suggested_with_its_own_doctype(self):
        """The pair must address ANY of the three ledgers -- a hardcoded 'Project Payments' would
        settle an expense against the wrong table."""
        match = _match(expenses=[_expense("NPE-4", doctype="Non Project Expenses")])
        outcome = derive_row_outcome(_Row(), match)
        self.assertEqual(
            sole_suggestion(outcome, match), Suggestion("Non Project Expenses", "NPE-4")
        )

    def test_two_candidates_suggest_nothing(self):
        match = _match([_payment("PAY-1")], expenses=[_expense("PE-1")])
        outcome = derive_row_outcome(_Row(), match)
        self.assertEqual(outcome.status, ROW_MATCHED)
        self.assertIsNone(sole_suggestion(outcome, match))

    def test_a_fan_out_suggests_nothing_even_though_it_is_one_candidate(self):
        """One group, but several records -- there is no single name to pre-select, and a
        `(doctype, name)` pair cannot express the group. The shape enforces the rule."""
        match = _match([_payment("PAY-A", amount="5000"), _payment("PAY-B", amount="4000")])
        outcome = derive_row_outcome(_Row(amount="9000"), match)
        self.assertEqual(outcome.status, ROW_MATCHED)
        self.assertIsNone(sole_suggestion(outcome, match))

    def test_TWO_SEPARATE_PAYMENTS_suggest_nothing(self):
        """⚠️ THE REGRESSION THAT COST 124 CONFIRMATIONS ON THE FIRST REAL STATEMENT (2026-08-10).

        Two SEPARATE approved payments -- not a fan-out -- is the commonest ambiguity there is on
        the main ledger, and it was the one shape no fixture built. `_settleable_candidates` read
        only `payment_groups[0]`, so this collapsed to one candidate and the screen pre-selected the
        arbitrary first one while announcing "One approved record at this amount".

        A vendor with six Rs 9,000 approved payments and seven Rs 9,000 transfers had all seven rows
        pointed at the SAME payment. One settled; six failed `AlreadyPaidError`; five good payments
        were never offered to anyone.
        """
        match = _match_many([_payment("PAY-1"), _payment("PAY-2")])
        outcome = derive_row_outcome(_Row(), match)
        self.assertEqual(outcome.status, ROW_MATCHED)
        self.assertIsNone(sole_suggestion(outcome, match))

    def test_six_separate_payments_suggest_nothing(self):
        """The real shape, at the real size."""
        match = _match_many([_payment(f"PAY-{i}") for i in range(6)])
        self.assertIsNone(sole_suggestion(derive_row_outcome(_Row(), match), match))

    def test_one_payment_among_several_groups_is_still_suggested_when_it_is_alone(self):
        """The fix must not over-correct: ONE group with ONE target is still unambiguous."""
        match = _match_many([_payment("PAY-1")])
        outcome = derive_row_outcome(_Row(), match)
        self.assertEqual(sole_suggestion(outcome, match), Suggestion("Project Payments", "PAY-1"))

    def test_no_candidates_suggest_nothing(self):
        match = _match()
        self.assertIsNone(sole_suggestion(derive_row_outcome(_Row(), match), match))

    def test_a_skipped_row_suggests_nothing_even_with_a_perfect_candidate(self):
        """THE GATE THIS FUNCTION EXISTS FOR. An already-Paid duplicate is Skipped by rule 2, but
        the match result behind it still holds a real approved candidate. Reading the match alone
        would pre-select a record on a row nobody may settle -- and the obvious next click would
        book the same money a second time, which is exactly what the duplicate guard prevents."""
        match = _match([_payment("PAY-1")])
        outcome = derive_row_outcome(
            _Row(), match, paid_duplicate=_group([_payment("PAY-9", status="Paid")])
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIsNone(sole_suggestion(outcome, match))

    def test_a_mismatched_row_suggests_nothing(self):
        match = _match([_payment("PAY-1")])
        outcome = derive_row_outcome(
            _Row(amount="5000"),
            match,
            paid_duplicate=_group([_payment("PAY-9", amount="7000", status="Paid")]),
        )
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertIsNone(sole_suggestion(outcome, match))

    def test_a_missing_match_suggests_nothing(self):
        """`match` defaults to None so a caller that has no result cannot crash the match run."""
        self.assertIsNone(sole_suggestion(RowOutcome(ROW_MATCHED, "")))


class TestNothingFound(unittest.TestCase):
    """The FOUND-NOTHING half of `Mismatched`.

    ⚠️ THIS CLASS WAS `TestUnmatched`, AND THE RENAME IS THE MERGE (owner ruling 2026-08-10). The
    status these cases produce is now the same one the amount-disagreement cases produce; what
    keeps them distinguishable is the NOTE, which is why every test here asserts the note as well
    as the status. Delete those note assertions and the merge becomes a genuine loss of
    information rather than a relocation of it.
    """

    def test_no_candidates_is_mismatched(self):
        outcome = derive_row_outcome(_Row(), _match())
        self.assertEqual(outcome.status, ROW_MISMATCHED)

    def test_no_match_object_at_all_is_mismatched(self):
        self.assertEqual(derive_row_outcome(_Row()).status, ROW_MISMATCHED)

    def test_the_note_offers_the_two_real_next_actions(self):
        note = derive_row_outcome(_Row(), _match()).note
        self.assertIn("new expense", note)
        self.assertIn("by hand", note)

    def test_the_note_tells_this_apart_from_an_amount_disagreement(self):
        """⚠️ THE LOAD-BEARING TEST OF THE MERGE. Two causes now share one status, so the note is
        the ONLY thing separating "we looked and found nothing" from "a record already recorded as
        Paid disagrees on amount". These two sentences must never converge.
        """
        nothing_found = derive_row_outcome(_Row(), _match()).note
        disagreement = derive_row_outcome(
            _Row(amount="1000"),
            _match(),
            paid_duplicate=_group([_payment("PAY-7", amount="9000")]),
        ).note

        self.assertIn("No approved payment or expense matches", nothing_found)
        self.assertNotIn("Already recorded as Paid", nothing_found)

        self.assertIn("PAY-7", disagreement)
        self.assertIn("Already recorded as Paid", disagreement)
        self.assertNotIn("No approved payment or expense matches", disagreement)

    def test_all_THREE_mismatched_causes_stay_distinguishable(self):
        """⚠️ THE MERGE TEST, WIDENED -- `Mismatched` now carries a THIRD fact (2026-08-11).

        The sweep that moves "several records matched and nothing separated them" out of `Matched`
        put a third cause under one status, so the note carries a three-way distinction where it
        used to carry a two-way one:

            found nothing        -> record or link one
            already Paid, delta  -> a deduction such as TDS
            several, none chosen -> pick which one

        The dangerous pair is the FIRST and THIRD. Both are open rows in the Not-Matched tab, and
        telling a reviewer "no approved payment or expense matches this transfer" about a transfer
        that matched six sends them to create a duplicate expense for money already approved and
        waiting to be paid.
        """
        nothing_found = derive_row_outcome(_Row(), _match()).note
        several = several_found_note(6)

        self.assertIn("No approved payment or expense matches", nothing_found)
        self.assertNotIn("6", nothing_found)

        self.assertIn("6 approved records match", several)
        self.assertNotIn("No approved payment or expense matches", several)
        self.assertNotIn("Already recorded as Paid", several)

    def test_the_several_note_says_what_to_do_not_just_what_happened(self):
        """Same obligation `_nothing_found_note` carries: the reader has nothing else to go on."""
        self.assertIn("pick which one", several_found_note(3).lower())

    def test_a_non_approved_payment_never_reaches_this_module_as_matched(self):
        """Rule 1 is enforced UPSTREAM, in candidates.py -- the pool is Approved only, so a
        CEO Pending payment is simply absent and the row is Mismatched. Pinned here because the
        seam is easy to misread as 'status.py filters by status', which it must never do: a
        filter here would silently paper over a widened candidate query.

        It also pins the REMOVAL of the approval nudge -- the note must not mention approval or
        the CEO, because nothing that cannot be settled is offered (owner, reversing an earlier
        stated goal).
        """
        outcome = derive_row_outcome(_Row(), _match())
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertNotIn("approval", outcome.note.lower())
        self.assertNotIn("ceo", outcome.note.lower())


# --- staging (upload time) -----------------------------------------------------------------------


class TestStagedOutcome(unittest.TestCase):
    def test_a_healthy_row_stages_as_pending_match_run(self):
        self.assertEqual(derive_staged_row_outcome(_Row()).status, ROW_PENDING_MATCH)

    def test_a_failed_transfer_is_skipped_at_upload(self):
        outcome = derive_staged_row_outcome(_Row(is_success=False, status_raw="REVERSED"))
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("REVERSED", outcome.note)

    def test_a_duplicate_from_an_earlier_batch_is_skipped_at_upload(self):
        outcome = derive_staged_row_outcome(_Row(), already_imported_in="OFI-26-00003")
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("OFI-26-00003", outcome.note)

    def test_a_duplicate_within_the_same_file_is_skipped_and_says_so_distinctly(self):
        outcome = derive_staged_row_outcome(_Row(), duplicate_in_file=True)
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("same statement", outcome.note)

    def test_skip_reasons_are_worded_identically_at_upload_and_after_matching(self):
        row = _Row(is_success=False, status_raw="FAILED")
        self.assertEqual(
            derive_staged_row_outcome(row).note, derive_row_outcome(row, _match()).note
        )


class TestStagedOutcomeForABankStatement(unittest.TestCase):
    """The two slice-B3 parameters: the ingest exclusion, and the source with no settlement path.

    ⚠️ THE DEFAULTS ARE HALF OF WHAT IS PINNED HERE, and `TestStagedOutcome` above is left untouched
    precisely to pin them: Cashfree and Cashbook pass neither parameter, so their staging is
    byte-identical to before this slice.
    """

    def test_an_excluded_line_is_skipped_and_the_reason_names_the_rule(self):
        """The category id itself is in the sentence, not a prettier synonym for it.

        `bank_exclusions` fits ten narration patterns to eight months of ONE account and says the
        per-category counts are what makes a new narration form noticeable. A reviewer who can read
        `platform_porter` off the row can find that rule, count how often it fires and argue with
        it; "Skipped -- not a spend" is unauditable.
        """
        outcome = derive_staged_row_outcome(_Row(), excluded_category="platform_porter")
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("platform_porter", outcome.note)

    def test_a_blank_category_is_not_an_exclusion(self):
        """`""` is the ruleset's INGEST answer and must not read as a falsy skip."""
        self.assertEqual(
            derive_staged_row_outcome(_Row(), excluded_category="").status, ROW_PENDING_MATCH
        )

    def test_the_exclusion_outranks_both_duplicate_checks(self):
        """PRECEDENCE, and it changes no status -- only which sentence the reviewer reads.

        Every branch here ends at `Skipped`. What the order decides is whether a re-uploaded
        statement's 405 excluded rows name the ten rules that fired, or all read "already imported
        in batch X" -- a batch where they were, correctly, skipped as exclusions too.
        """
        outcome = derive_staged_row_outcome(
            _Row(),
            already_imported_in="OFI-26-00003",
            duplicate_in_file=True,
            excluded_category="internal_gl_transfer",
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("internal_gl_transfer", outcome.note)
        self.assertNotIn("OFI-26-00003", outcome.note)

    def test_a_source_with_no_settlement_path_lands_on_mismatched(self):
        """Owner ruling Q31. `Pending match run` would promise a run that settles nothing, and the
        reviewer would press it once per statement forever."""
        outcome = derive_staged_row_outcome(_Row(), no_settlement_path=True)
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertTrue(outcome.note)

    def test_that_landing_leaves_the_row_open_to_a_later_match_run(self):
        """⚠️ THE POINT OF LANDING ON `Mismatched` RATHER THAN `Skipped`.

        The already-recorded-as-Paid duplicate guard is KEPT on this source (owner ruling Q31a; it
        catches 41 of 711 real debits) and it lives in the match run, which skips
        `review._FROZEN_ROW_STATUSES` -- Skipped and Settled. `Mismatched` is in neither, so the row
        stays reachable. Landing it `Skipped` would have deleted that guard silently.
        """
        outcome = derive_staged_row_outcome(_Row(), no_settlement_path=True)
        self.assertIn(outcome.status, OPEN_ROW_STATUSES)
        self.assertNotIn(outcome.status, TERMINAL_ROW_STATUSES)

    def test_an_exclusion_still_wins_over_the_landing(self):
        outcome = derive_staged_row_outcome(
            _Row(), excluded_category="platform_cashfree", no_settlement_path=True
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)

    def test_a_non_success_row_is_still_skipped_on_such_a_source(self):
        """The landing is the LAST branch, so it can never rescue a row an earlier rule refused."""
        outcome = derive_staged_row_outcome(
            _Row(is_success=False, status_raw="FAILED"), no_settlement_path=True
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)

    def test_the_landing_note_does_not_claim_the_matcher_never_runs(self):
        """⚠️ A DELIBERATE NEGATIVE PIN, and the wording is the whole substance of it.

        There is no SETTLEMENT path on this source; there IS still a match run, carrying the paid
        duplicate guard. A note asserting the stronger claim would give the next reader a reason to
        fence the source out of the run entirely, taking the guard with it.
        """
        note = derive_staged_row_outcome(_Row(), no_settlement_path=True).note.lower()
        self.assertNotIn("never", note)
        self.assertNotIn("no match", note)


# --- the duplicate-guard-only deriver (slice B4) --------------------------------------------------


class TestDeriveDuplicateGuardOutcome(unittest.TestCase):
    """The match-time deriver for a source with NO SETTLEMENT PATH (owner rulings Q31 / Q31a).

    Its whole job is to keep ONE of `derive_row_outcome`'s findings -- "this transfer is already
    recorded as Paid" -- and drop the other, because on a bank passbook there is nothing to match:
    tier 1 is structurally unreachable, tier 0's Approved-only pool is empty by construction, and
    tier 2 fires zero times with all seven near-misses false positives (see
    `sources.source_has_settlement_path`).
    """

    def test_it_takes_no_match_argument_at_all(self):
        """⚠️ THE SIGNATURE IS THE GUARANTEE, AND THIS IS THE TEST THAT SAYS SO OUT LOUD.

        A `match` parameter would be a place for a caller to hand candidates in, and the entire
        slice is that no settlement candidate is ever produced for this source. With nothing to
        suggest a record FROM, suggesting one is not something a later edit can quietly re-enable
        here -- it would have to change the signature, which is visible in review.
        """
        import inspect

        params = list(inspect.signature(derive_duplicate_guard_outcome).parameters)
        self.assertEqual(params, ["row", "paid_duplicate"])

    def test_a_row_with_no_paid_duplicate_is_mismatched_for_a_person(self):
        outcome = derive_duplicate_guard_outcome(_Row())
        self.assertEqual(outcome.status, ROW_MISMATCHED)

    def test_it_gives_back_the_STAGING_sentence_not_the_found_nothing_one(self):
        """⚠️ BOTH ARE `Mismatched`, SO THE NOTE IS THE ENTIRE DIFFERENCE.

        "No approved payment or expense matches this transfer" would be a finding about a search
        that never ran, and it sends a reviewer hunting for a record that does not exist. Reusing
        the sentence the row was STAGED with also keeps a re-run byte-idempotent on the note.
        """
        self.assertEqual(
            derive_duplicate_guard_outcome(_Row()).note, STAGED_NOTE_NO_SETTLEMENT_PATH
        )
        self.assertNotIn("No approved payment", derive_duplicate_guard_outcome(_Row()).note)

    def test_the_already_paid_guard_still_fires_and_names_the_record(self):
        """THE 41-of-711 CASE, AND THE REASON THIS SOURCE STILL REACHES THE MATCH RUN AT ALL."""
        outcome = derive_duplicate_guard_outcome(
            _Row(), paid_duplicate=_group([_payment("PAY-OLD", status="Paid")])
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("PAY-OLD", outcome.note)
        self.assertIn("Already recorded as Paid", outcome.note)

    def test_a_hand_recorded_fan_out_is_ONE_already_recorded_transfer(self):
        outcome = derive_duplicate_guard_outcome(
            _Row(amount="5000"),
            paid_duplicate=_group(
                [
                    _payment("PAY-A", amount="2000", status="Paid"),
                    _payment("PAY-B", amount="3000", status="Paid"),
                ]
            ),
        )
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("PAY-A", outcome.note)
        self.assertIn("PAY-B", outcome.note)

    def test_an_amount_disagreement_is_mismatched_and_names_the_shortfall(self):
        outcome = derive_duplicate_guard_outcome(
            _Row(amount="5000"),
            paid_duplicate=_group([_payment("PAY-OLD", amount="6000", status="Paid")]),
        )
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertIn("PAY-OLD", outcome.note)
        self.assertIn("1000", outcome.note)

    def test_the_rounding_window_is_the_SAME_one_the_gateway_path_uses(self):
        """⚠️ THE REASON BRANCHES 2 AND 3 WERE FACTORED OUT RATHER THAN COPIED. A second copy could
        drift back to an exact comparison on one path only -- and 31.4% of payments carry paise, so
        the bank's whole-rupee rounding would announce a "discrepancy" on every one of them, with a
        note suggesting TDS, for a gap of a few paise."""
        near = _group([_payment("PAY-OLD", amount="18899", status="Paid")])
        self.assertEqual(
            derive_duplicate_guard_outcome(_Row(amount="18898.99"), paid_duplicate=near).status,
            derive_row_outcome(_Row(amount="18898.99"), paid_duplicate=near).status,
        )
        self.assertEqual(
            derive_duplicate_guard_outcome(_Row(amount="18898.99"), paid_duplicate=near).status,
            ROW_SKIPPED,
        )

    def test_a_failed_transfer_is_still_skipped_before_anything_else(self):
        outcome = derive_duplicate_guard_outcome(_Row(is_success=False, status_raw="REVERSED"))
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertIn("REVERSED", outcome.note)

    def test_an_empty_paid_group_is_not_a_duplicate(self):
        """A group-shaped object with no targets is "we looked and found nothing", not a hit."""
        outcome = derive_duplicate_guard_outcome(_Row(), paid_duplicate=_group([]))
        self.assertEqual(outcome.status, ROW_MISMATCHED)
        self.assertEqual(outcome.note, STAGED_NOTE_NO_SETTLEMENT_PATH)

    def test_its_landing_status_is_the_one_STAGING_already_used(self):
        """The staged row and the matched row must read identically, or a reviewer would see a row
        change for no reason on a run that found nothing new about it."""
        self.assertEqual(
            derive_duplicate_guard_outcome(_Row()),
            derive_staged_row_outcome(_Row(), no_settlement_path=True),
        )

    def test_the_landing_stays_OPEN_so_a_later_run_can_still_guard_it(self):
        outcome = derive_duplicate_guard_outcome(_Row())
        self.assertIn(outcome.status, OPEN_ROW_STATUSES)
        self.assertNotIn(outcome.status, TERMINAL_ROW_STATUSES)


# --- batch rollup --------------------------------------------------------------------------------


class TestBatchStatus(unittest.TestCase):
    def test_no_rows_is_draft(self):
        self.assertEqual(derive_batch_status([]), BATCH_DRAFT)

    def test_all_open_is_in_review(self):
        self.assertEqual(
            derive_batch_status([ROW_PENDING_MATCH, ROW_MATCHED, ROW_MISMATCHED]), BATCH_IN_REVIEW
        )

    def test_some_terminal_some_open_is_partially_settled(self):
        self.assertEqual(
            derive_batch_status([ROW_SETTLED, ROW_MISMATCHED]), BATCH_PARTIALLY_SETTLED
        )

    def test_all_terminal_is_completed(self):
        self.assertEqual(derive_batch_status([ROW_SETTLED, ROW_SKIPPED]), BATCH_COMPLETED)

    def test_a_matched_row_keeps_the_batch_open(self):
        """v2 would have called this Completed -- a found-but-unconfirmed row was terminal there.
        Under v3 it is unfinished work and the batch must say so."""
        self.assertEqual(
            derive_batch_status([ROW_SETTLED, ROW_MATCHED]), BATCH_PARTIALLY_SETTLED
        )

    def test_an_errored_row_keeps_the_batch_open(self):
        self.assertEqual(derive_batch_status([ROW_SETTLED, ROW_ERROR]), BATCH_PARTIALLY_SETTLED)

    def test_batch_is_open_reads_the_status_derive_already_produces(self):
        """`batch_is_open` IS "auto-close" (slice CF/S5), and it adds no state.

        The 2026-08-10 ruling deleted `close_batch` because it stamped three fields nobody read.
        Nothing here writes anything: a batch closes itself the moment `derive_batch_status` returns
        `Completed`, and `_refresh_batch_rollup` runs on every settle and every skip.
        """
        self.assertFalse(batch_is_open(derive_batch_status([ROW_SETTLED, ROW_SKIPPED])))
        self.assertTrue(batch_is_open(derive_batch_status([ROW_SETTLED, ROW_MATCHED])))
        self.assertTrue(batch_is_open(derive_batch_status([])))

    def test_an_unknown_or_missing_status_is_OPEN(self):
        """⚠️ THE FAILURE DIRECTION IS THE POINT.

        A batch whose rollup has never run carries no status. Reading that as finished would drop it
        from every re-match silently -- the invisible-exclusion class this feature keeps fixing.
        Failing towards "still has work" costs one wasted pass; failing the other way loses the work.
        """
        self.assertTrue(batch_is_open(None))
        self.assertTrue(batch_is_open(""))
        self.assertTrue(batch_is_open("   "))
        self.assertTrue(batch_is_open("Something Else"))

    def test_it_does_not_resurrect_the_deleted_close_fields(self):
        """The ruling this slice had to work around, pinned.

        `closed_at` / `closed_by` / `close_reason` are still on the doctype and still never written.
        "Auto-close" is a READ of a derived status -- if a future change makes it a WRITE, that is
        the deleted control coming back and it should be a deliberate decision, not a drift.
        """
        import inspect

        from nirmaan_stack.services.outflow_import import status as S

        source = inspect.getsource(S.batch_is_open)
        for field in ("closed_at", "closed_by", "close_reason"):
            self.assertNotIn(f"{field} =", source)

    def test_derive_batch_status_takes_no_force_closed_argument(self):
        """Retired with `Completed with exceptions`. Pinned so a well-meaning re-add fails loudly
        rather than reintroducing a status the doctype's Select no longer offers -- which Frappe
        would accept and every filter would then miss."""
        with self.assertRaises(TypeError):
            derive_batch_status([ROW_SETTLED], force_closed=True)


class TestBatchCounters(unittest.TestCase):
    def test_counters_cover_the_live_fields_and_nothing_else(self):
        """Every key must be a real field on Outflow Import Batch. An extra key writes nothing and
        reports nothing, silently -- which is exactly how `reconciled_rows` outlived its status."""
        counters = derive_batch_counters([ROW_SETTLED])
        self.assertEqual(
            set(counters),
            {"total_rows", "reviewed_rows", "settled_rows", "skipped_rows", "error_rows"},
        )

    def test_the_dead_v2_counters_are_gone(self):
        counters = derive_batch_counters([ROW_SETTLED, ROW_SKIPPED])
        self.assertNotIn("reconciled_rows", counters)
        self.assertNotIn("exception_rows", counters)

    def test_reviewed_counts_everything_that_has_left_pending(self):
        counters = derive_batch_counters(
            [ROW_PENDING_MATCH, ROW_PENDING_MATCH, ROW_MATCHED, ROW_SETTLED]
        )
        self.assertEqual(counters["total_rows"], 4)
        self.assertEqual(counters["reviewed_rows"], 2)

    def test_each_terminal_bucket_counts_its_own(self):
        counters = derive_batch_counters(
            [ROW_SETTLED, ROW_SETTLED, ROW_SKIPPED, ROW_ERROR, ROW_MISMATCHED]
        )
        self.assertEqual(counters["settled_rows"], 2)
        self.assertEqual(counters["skipped_rows"], 1)
        self.assertEqual(counters["error_rows"], 1)


class TestImportSummary(unittest.TestCase):
    """`derive_import_summary` -- the numbers the summary section reports (slice X2).

    Its input is ALREADY AGGREGATED by the database: one `StatusTally` per `row_status`. A summary
    over a whole import is a count and a sum over many rows, which belongs in SQL (ADR-0010), so
    this module assembles rather than counts.
    """

    def test_an_empty_import_reports_zeroes_rather_than_nothing(self):
        """A batch staged and never matched still has to render. Every figure is 0, and crucially
        `decided_percent` is 0.0 rather than a ZeroDivisionError."""
        summary = derive_import_summary([])
        self.assertEqual(summary["total_rows"], 0)
        self.assertEqual(summary["total_value"], Decimal("0"))
        self.assertEqual(summary["decided_percent"], 0.0)
        self.assertEqual(summary["open_rows"], 0)

    def test_every_status_is_present_even_at_zero(self):
        """⚠️ ZERO-FILLED ON PURPOSE. A screen that renders only the statuses present reads as
        though the missing ones do not apply. "Mismatched 0" is the most useful cell on the panel --
        it is the one that says the import has finished finding work."""
        summary = derive_import_summary([StatusTally(ROW_SETTLED, 3, Decimal("300"))])
        for status in ROW_STATUSES:
            self.assertIn(status, summary["by_status"])
        self.assertEqual(summary["by_status"][ROW_MISMATCHED], {"count": 0, "value": Decimal("0")})

    def test_counts_and_money_both_roll_up(self):
        """⚠️ THE SKIPPED TALLY IS DELIBERATELY ABSENT FROM THE TOTALS. Six rows arrive; five are
        totalled. The Rs 99.49 skipped transfer is still reported, as `skipped_value` and in
        `by_status` -- it is out of the STATEMENT total, not out of the summary."""
        summary = derive_import_summary(
            [
                StatusTally(ROW_SETTLED, 2, Decimal("5000.50")),
                StatusTally(ROW_MISMATCHED, 3, Decimal("1200")),
                StatusTally(ROW_SKIPPED, 1, Decimal("99.49")),
            ]
        )
        self.assertEqual(summary["total_rows"], 5)
        self.assertEqual(summary["total_value"], Decimal("6200.50"))
        self.assertEqual(summary["settled_value"], Decimal("5000.50"))
        self.assertEqual(summary["mismatched_rows"], 3)
        self.assertEqual(summary["skipped_rows"], 1)
        self.assertEqual(summary["skipped_value"], Decimal("99.49"))

    def test_the_open_value_is_summed_not_subtracted(self):
        """⚠️ THE ARITHMETIC IS IDENTICAL TODAY AND THE FAILURE MODES ARE NOT. Subtracting settled
        and skipped from the total goes NEGATIVE the moment a status falls outside both sets -- a
        legacy v2 value on an old row, say. Summing what is genuinely open cannot lie."""
        summary = derive_import_summary(
            [
                StatusTally(ROW_MATCHED, 1, Decimal("100")),
                StatusTally(ROW_MISMATCHED, 1, Decimal("200")),
                StatusTally(ROW_SETTLED, 1, Decimal("900")),
                StatusTally("Reconciled", 4, Decimal("4000")),  # a retired v2 value
            ]
        )
        self.assertEqual(summary["open_value"], Decimal("300"))
        self.assertGreaterEqual(summary["open_value"], Decimal("0"))

    def test_an_unknown_status_is_carried_into_the_totals_not_dropped(self):
        """Rows staged under v2 hold retired values. A summary that omitted them would report a
        total smaller than the import, which is the one number nobody would think to doubt."""
        summary = derive_import_summary([StatusTally("Reconciled", 4, Decimal("4000"))])
        self.assertEqual(summary["total_rows"], 4)
        self.assertEqual(summary["total_value"], Decimal("4000"))
        self.assertEqual(summary["by_status"]["Reconciled"]["count"], 4)

    def test_decided_counts_SETTLED_ONLY_not_every_terminal_status(self):
        """⚠️ THIS TEST INVERTED. It used to read `decided_rows == 4` -- Settled + Skipped, the sum
        over `TERMINAL_ROW_STATUSES` -- out of a total of 8. Skipped rows left the total, so
        counting them here would divide by a denominator they are absent from, and a statement with
        more duplicates than settlements would report a `decided_percent` above 100.

        Three settled and four matched out of seven totalled rows: 42.9%.
        """
        summary = derive_import_summary(
            [
                StatusTally(ROW_SETTLED, 3, Decimal("300")),
                StatusTally(ROW_SKIPPED, 1, Decimal("100")),
                StatusTally(ROW_MATCHED, 4, Decimal("400")),
            ]
        )
        self.assertEqual(summary["total_rows"], 7)
        self.assertEqual(summary["decided_rows"], 3)
        self.assertEqual(summary["decided_percent"], 42.9)

    def test_matched_splits_into_confirmable_and_ambiguous(self):
        """⚠️ THE SPLIT THE BULK CONFIRM IS BUILT ON. A `Matched` row with no stored suggestion is
        one where the matcher found SEVERAL approved records and deliberately chose none -- it can
        be listed but never auto-confirmed, because there is nothing to confirm it against."""
        summary = derive_import_summary(
            [
                StatusTally(
                    ROW_MATCHED, 10, Decimal("10000"),
                    with_suggestion=7, suggested_value=Decimal("6500"),
                )
            ]
        )
        self.assertEqual(summary["confirmable_rows"], 7)
        self.assertEqual(summary["confirmable_value"], Decimal("6500"))
        self.assertEqual(summary["ambiguous_rows"], 3)

    def test_the_confirmable_value_is_its_own_sum_not_a_share(self):
        """Three matched rows of 10, 10 and 90,000 where only the last is confirmable are NOT "one
        third of the value". Apportioning would invent a number; the query sums the subset."""
        summary = derive_import_summary(
            [
                StatusTally(
                    ROW_MATCHED, 3, Decimal("90020"),
                    with_suggestion=1, suggested_value=Decimal("90000"),
                )
            ]
        )
        self.assertEqual(summary["confirmable_value"], Decimal("90000"))

    def test_a_suggestion_outside_matched_never_counts_as_confirmable(self):
        """A stored suggestion is blanked on every re-run that no longer finds one, but a `Skipped`
        row could still carry a stale pair from an older code path. Only `Matched` is confirmable --
        the same gate `sole_suggestion` applies, applied again where the number is reported."""
        summary = derive_import_summary(
            [StatusTally(ROW_SKIPPED, 2, Decimal("200"), with_suggestion=2)]
        )
        self.assertEqual(summary["confirmable_rows"], 0)

    def test_mismatched_is_the_figure_that_carries_the_work(self):
        """⚠️ THIS TEST'S POINT INVERTED AT THE 2026-08-10 MERGE, and the old version is worth
        stating: it used to read "reported even though it is usually zero", because `Mismatched`
        fired only when a hand-ticked payment disagreed on amount beyond the settle window. Having
        absorbed `Unmatched` it is the PRODUCTIVE figure -- most of a statement's work -- and the
        split a reviewer reads is matched vs mismatched.
        """
        summary = derive_import_summary([StatusTally(ROW_MISMATCHED, 1, Decimal("18679"))])
        self.assertEqual(summary["mismatched_rows"], 1)
        self.assertEqual(summary["mismatched_value"], Decimal("18679"))

    def test_the_retired_unmatched_keys_are_gone_rather_than_zeroed(self):
        """⚠️ ABSENT, NOT 0 -- the loud failure is deliberate. A screen still reading
        `unmatched_rows` gets `None` and breaks visibly; zeroing the key would have it report
        "0 transfers need a person" on a statement full of them, which is the same class of defect
        as the summary disagreeing with the table beneath it.
        """
        summary = derive_import_summary([StatusTally(ROW_MISMATCHED, 3, Decimal("300"))])
        self.assertNotIn("unmatched_rows", summary)
        self.assertNotIn("unmatched_value", summary)

    def test_it_accepts_a_generator(self):
        """The endpoint passes a genexp straight off the query rows. Consuming the input twice
        would silently produce an empty summary.

        Both assertions are needed to prove BOTH tallies were seen: the skipped one is excluded from
        the total, so `total_rows` alone could not tell "the generator was exhausted correctly" from
        "the second item never arrived".
        """
        summary = derive_import_summary(
            StatusTally(s, 1, Decimal("10")) for s in (ROW_SETTLED, ROW_SKIPPED)
        )
        self.assertEqual(summary["total_rows"], 1)
        self.assertEqual(summary["skipped_rows"], 1)


class TestTheStatementTotalSplitsByDirection(unittest.TestCase):
    """"Total transferred" became "Total paid out" + "Total received" (owner ruling).

    The panel showed ONE tile summing both directions -- `derive_import_summary` had no direction
    axis at all, which was documented and deliberate while the axis did not exist on this screen.
    Money out and money in are different facts, and one figure adding them together means nothing.

    ⚠️ THE WHOLE REASON THE SPLIT IS SAFE IS THAT IT PARTITIONS, EXACTLY:

        paid_rows + received_rows == total_rows
        paid_value + received_value == total_value

    on every input. Anything that can put a row in NEITHER half -- or in BOTH -- ships two tiles
    that do not add up to the figure they replaced, which is the one number nobody thinks to doubt.

    ⚠️ THIS IS NOT `derive_settled_direction_blocks`. That cuts the SAME axis over a DIFFERENT
    population -- Settled rows only, broken down by ledger -- and the two deliberately total
    different money. `TestSettledDirectionBlocks` pins that one; keeping them apart in the tests is
    how the naming stays honest in the code.
    """

    def test_the_two_halves_partition_the_total_exactly(self):
        summary = derive_import_summary(
            [
                StatusTally(ROW_SETTLED, 2, Decimal("5000.50"), direction="Debit"),
                StatusTally(ROW_SETTLED, 1, Decimal("900.25"), direction=ROW_DIRECTION_CREDIT),
                StatusTally(ROW_MISMATCHED, 3, Decimal("1200"), direction="Debit"),
                StatusTally(ROW_MATCHED, 4, Decimal("400.75"), direction=ROW_DIRECTION_CREDIT),
            ]
        )
        self.assertEqual(summary["paid_rows"], 5)
        self.assertEqual(summary["paid_value"], Decimal("6200.50"))
        self.assertEqual(summary["received_rows"], 5)
        self.assertEqual(summary["received_value"], Decimal("1301.00"))

        self.assertEqual(
            summary["paid_rows"] + summary["received_rows"], summary["total_rows"]
        )
        self.assertEqual(
            summary["paid_value"] + summary["received_value"], summary["total_value"]
        )

    def test_the_partition_holds_across_every_mixture_of_status_direction_and_failure(self):
        """The invariant asserted as a PROPERTY rather than on one hand-picked input. Every
        combination that can reach this deriver at once: both directions, a blank one, an
        unrecognised one, a skipped status, an unknown status, and a failed transfer."""
        tallies = [
            StatusTally(status, n, Decimal(str(n * 11.25)), failed=failed, direction=direction)
            for n, (status, direction, failed) in enumerate(
                [
                    (ROW_SETTLED, "Debit", False),
                    (ROW_SETTLED, ROW_DIRECTION_CREDIT, False),
                    (ROW_SETTLED, ROW_DIRECTION_CREDIT, True),
                    (ROW_MATCHED, "", False),
                    (ROW_MISMATCHED, "credit", False),
                    (ROW_PENDING_MATCH, "Debit", False),
                    (ROW_SKIPPED, ROW_DIRECTION_CREDIT, False),
                    (ROW_SKIPPED, "Debit", False),
                    (ROW_ERROR, "Debit", True),
                    ("Reconciled", ROW_DIRECTION_CREDIT, False),
                ],
                start=1,
            )
        ]
        summary = derive_import_summary(tallies)
        self.assertEqual(
            summary["paid_rows"] + summary["received_rows"], summary["total_rows"]
        )
        self.assertEqual(
            summary["paid_value"] + summary["received_value"], summary["total_value"]
        )
        # And it is not vacuous -- both halves carry rows.
        self.assertGreater(summary["paid_rows"], 0)
        self.assertGreater(summary["received_rows"], 0)

    def test_a_tally_built_positionally_lands_on_the_paid_side(self):
        """⚠️ `StatusTally.direction` IS DEFAULTED FOR THIS REASON. Every pre-split construction --
        in this suite and anywhere else -- keeps working and keeps landing where it always did.
        Same disposition `SettledLedgerEntry.direction` already took."""
        summary = derive_import_summary([StatusTally(ROW_SETTLED, 3, Decimal("300"))])
        self.assertEqual(summary["paid_rows"], 3)
        self.assertEqual(summary["paid_value"], Decimal("300"))
        self.assertEqual(summary["received_rows"], 0)
        self.assertEqual(summary["received_value"], Decimal("0"))

    def test_a_blank_or_unrecognised_direction_is_PAID_rather_than_neither(self):
        """⚠️ A CONSEQUENCE, NOT A GUESS. `settle.create_inflow_from_row` refuses anything that is
        not `Credit` at the WRITE, so such a row is structurally incapable of having become a
        receipt. Calling it received would put it in a block it could not have reached; leaving it
        out of both would be money in `total_value` and in neither tile beside it."""
        summary = derive_import_summary(
            [
                StatusTally(ROW_MATCHED, 1, Decimal("100"), direction=""),
                StatusTally(ROW_MATCHED, 1, Decimal("200"), direction="   "),
                StatusTally(ROW_MATCHED, 1, Decimal("400"), direction="Reversal"),
                StatusTally(ROW_MATCHED, 1, Decimal("800"), direction="credit"),
            ]
        )
        self.assertEqual(summary["received_rows"], 0)
        self.assertEqual(summary["paid_rows"], 4)
        self.assertEqual(summary["paid_value"], Decimal("1500"))

    def test_the_split_uses_the_ONE_definition_of_the_axis(self):
        """`is_received_direction` decides membership here exactly as it decides it for the settled
        blocks. A second predicate -- an inline `== "Credit"`, say -- would be free to drift from
        the one the write path is built on, and the drift would show as money in one tile only."""
        received = StatusTally(ROW_SETTLED, 1, Decimal("50"), direction=ROW_DIRECTION_CREDIT)
        self.assertTrue(is_received_direction(received.direction))
        self.assertEqual(derive_import_summary([received])["received_rows"], 1)

        paid = StatusTally(ROW_SETTLED, 1, Decimal("50"), direction="Debit")
        self.assertFalse(is_received_direction(paid.direction))
        self.assertEqual(derive_import_summary([paid])["paid_rows"], 1)

    def test_a_failed_receipt_is_absent_from_BOTH_halves(self):
        """⚠️ THE SAME TWO EXCLUSIONS THE TOTAL ALREADY APPLIES, OR THE TILES DESCRIBE A DIFFERENT
        POPULATION FROM THE FIGURE THEY REPLACED. A transfer the bank refused to move is out of
        every figure this summary reports (option B, 2026-08-10) -- including a credit."""
        summary = derive_import_summary(
            [
                StatusTally(
                    ROW_SETTLED, 2, Decimal("700"), failed=True, direction=ROW_DIRECTION_CREDIT
                ),
                StatusTally(ROW_SETTLED, 1, Decimal("300"), direction="Debit"),
            ]
        )
        self.assertEqual(summary["received_rows"], 0)
        self.assertEqual(summary["received_value"], Decimal("0"))
        self.assertEqual(summary["paid_rows"], 1)
        self.assertEqual(summary["failed_rows"], 2)
        self.assertEqual(
            summary["paid_value"] + summary["received_value"], summary["total_value"]
        )

    def test_a_skipped_receipt_is_absent_from_BOTH_halves_and_still_reported(self):
        """The second exclusion, for the second reason: a skipped transfer is money already counted
        somewhere else. It leaves the two tiles exactly as it leaves the total -- and is still
        reported as `skipped_*` and in `by_status`, which is what stops the exclusion becoming a
        disappearance."""
        summary = derive_import_summary(
            [
                StatusTally(
                    ROW_SKIPPED, 1, Decimal("99.49"), direction=ROW_DIRECTION_CREDIT
                ),
                StatusTally(ROW_SETTLED, 1, Decimal("300"), direction="Debit"),
            ]
        )
        self.assertEqual(summary["received_rows"], 0)
        self.assertEqual(summary["paid_rows"], 1)
        self.assertEqual(summary["skipped_rows"], 1)
        self.assertEqual(summary["skipped_value"], Decimal("99.49"))
        self.assertEqual(
            summary["paid_rows"] + summary["received_rows"], summary["total_rows"]
        )

    def test_an_empty_import_reports_both_halves_at_zero_rather_than_omitting_them(self):
        """Zero-filled for the reason every other figure here is: a tile that vanishes reads as
        "does not apply", when what it means is "none of these, right now"."""
        summary = derive_import_summary([])
        for key in ("paid_rows", "received_rows"):
            self.assertEqual(summary[key], 0)
        for key in ("paid_value", "received_value"):
            self.assertEqual(summary[key], Decimal("0"))

    def test_the_money_is_Decimal_never_float(self):
        """Same reasoning as every other figure here -- these are money, and the endpoint converts
        for the wire in `_jsonable_summary` rather than the deriver rounding early."""
        summary = derive_import_summary(
            [StatusTally(ROW_SETTLED, 1, Decimal("0.10"), direction=ROW_DIRECTION_CREDIT)]
        )
        self.assertIsInstance(summary["received_value"], Decimal)
        self.assertIsInstance(summary["paid_value"], Decimal)

    def test_the_figures_the_split_sits_beside_are_untouched(self):
        """⚠️ A REGRESSION PIN. `total_*`, `open_*` and `decided_percent` are the numbers the split
        was carved out of, and every one of them must be what it was before there was an axis."""
        tallies = [
            StatusTally(ROW_SETTLED, 3, Decimal("300"), direction=ROW_DIRECTION_CREDIT),
            StatusTally(ROW_SKIPPED, 1, Decimal("100"), direction="Debit"),
            StatusTally(ROW_MATCHED, 4, Decimal("400"), direction="Debit"),
        ]
        with_direction = derive_import_summary(tallies)
        without = derive_import_summary(
            [StatusTally(t.status, t.count, t.value) for t in tallies]
        )
        for key in (
            "total_rows",
            "total_value",
            "open_rows",
            "open_value",
            "decided_rows",
            "decided_percent",
            "settled_rows",
            "settled_value",
            "skipped_rows",
            "skipped_value",
        ):
            self.assertEqual(with_direction[key], without[key], key)


class TestStillOpenSplitsByDirection(unittest.TestCase):
    """`Still open` cut by direction -- the ONE genuinely new figure the two-band panel needed.

    The panel became two labelled bands (owner ruling), each holding Total, Settled and Still open,
    with Decided shared below them. Total was already cut by direction (`paid_*` / `received_*`) and
    Settled already had `derive_settled_direction_blocks` -- WITH the per-ledger lines the card
    renders, which is why nothing here re-derives it: two keys totalling the same money are two
    chances to disagree about it. Still open had nothing, because `by_status` is keyed by STATUS
    ALONE and both directions were folded together before `open_rows` was ever summed from it.

    ⚠️ THE PARTITION IS THE WHOLE REASON THIS IS SAFE TO RENDER:

        open_paid_rows + open_received_rows == open_rows
        open_paid_value + open_received_value == open_value

    A band whose three cards do not add up is worse than no band at all.
    """

    def test_the_two_halves_partition_what_is_still_open(self):
        summary = derive_import_summary(
            [
                StatusTally(ROW_MATCHED, 3, Decimal("1200.50"), direction="Debit"),
                StatusTally(ROW_MISMATCHED, 2, Decimal("300.25"), direction="Debit"),
                StatusTally(ROW_MATCHED, 4, Decimal("900.75"), direction=ROW_DIRECTION_CREDIT),
                StatusTally(ROW_SETTLED, 5, Decimal("7000"), direction="Debit"),
            ]
        )
        self.assertEqual(summary["open_paid_rows"], 5)
        self.assertEqual(summary["open_paid_value"], Decimal("1500.75"))
        self.assertEqual(summary["open_received_rows"], 4)
        self.assertEqual(summary["open_received_value"], Decimal("900.75"))

        self.assertEqual(
            summary["open_paid_rows"] + summary["open_received_rows"], summary["open_rows"]
        )
        self.assertEqual(
            summary["open_paid_value"] + summary["open_received_value"], summary["open_value"]
        )

    def test_the_partition_holds_across_every_mixture_of_status_direction_and_failure(self):
        """The invariant as a PROPERTY rather than on one hand-picked input -- the same shape, and
        nearly the same input set, `TestTheStatementTotalSplitsByDirection` uses for the total."""
        tallies = [
            StatusTally(status, n, Decimal(str(n * 11.25)), failed=failed, direction=direction)
            for n, (status, direction, failed) in enumerate(
                [
                    (ROW_SETTLED, "Debit", False),
                    (ROW_SETTLED, ROW_DIRECTION_CREDIT, False),
                    (ROW_MATCHED, ROW_DIRECTION_CREDIT, True),
                    (ROW_MATCHED, "", False),
                    (ROW_MISMATCHED, "credit", False),
                    (ROW_MISMATCHED, ROW_DIRECTION_CREDIT, False),
                    (ROW_PENDING_MATCH, "Debit", False),
                    (ROW_SKIPPED, ROW_DIRECTION_CREDIT, False),
                    (ROW_SKIPPED, "Debit", False),
                    (ROW_ERROR, "Debit", True),
                    (ROW_ERROR, ROW_DIRECTION_CREDIT, False),
                    ("Reconciled", ROW_DIRECTION_CREDIT, False),
                ],
                start=1,
            )
        ]
        summary = derive_import_summary(tallies)
        self.assertEqual(
            summary["open_paid_rows"] + summary["open_received_rows"], summary["open_rows"]
        )
        self.assertEqual(
            summary["open_paid_value"] + summary["open_received_value"], summary["open_value"]
        )
        # And it is not vacuous -- both halves carry rows.
        self.assertGreater(summary["open_paid_rows"], 0)
        self.assertGreater(summary["open_received_rows"], 0)

    def test_a_band_reconciles_total_equals_settled_plus_still_open(self):
        """⚠️ THE ARITHMETIC A BAND'S THREE CARDS REST ON, stated here in the pure layer where every
        input can be chosen:

            <dir>_rows == settled_<dir>_rows + open_<dir>_rows

        The panel reads its Settled card off `settled_by_direction`, which is a DIFFERENT query over
        the same rows; the endpoint's own tests pin those two against a real batch. There is
        deliberately no `settled_paid_rows` key -- see the return dict -- so the settled half is
        reconstructed here from the tallies this test itself built."""
        paid_settled = StatusTally(ROW_SETTLED, 6, Decimal("6000"), direction="Debit")
        paid_open = StatusTally(ROW_MISMATCHED, 2, Decimal("250.50"), direction="Debit")
        received_settled = StatusTally(
            ROW_SETTLED, 1, Decimal("400"), direction=ROW_DIRECTION_CREDIT
        )
        received_open = StatusTally(
            ROW_MATCHED, 3, Decimal("75.25"), direction=ROW_DIRECTION_CREDIT
        )
        summary = derive_import_summary(
            [paid_settled, paid_open, received_settled, received_open]
        )

        self.assertEqual(paid_settled.count + summary["open_paid_rows"], summary["paid_rows"])
        self.assertEqual(paid_settled.value + summary["open_paid_value"], summary["paid_value"])
        self.assertEqual(
            received_settled.count + summary["open_received_rows"], summary["received_rows"]
        )
        self.assertEqual(
            received_settled.value + summary["open_received_value"], summary["received_value"]
        )

    def test_a_failed_transfer_is_absent_from_BOTH_halves(self):
        """The same exclusion `open_rows` already applies, because the halves are cut from the same
        buckets on the same side of the `failed` `continue`. A transfer the bank refused to move is
        out of every figure this summary reports (option B, 2026-08-10) -- including an open one."""
        summary = derive_import_summary(
            [
                StatusTally(
                    ROW_MATCHED, 2, Decimal("700"), failed=True, direction=ROW_DIRECTION_CREDIT
                ),
                StatusTally(ROW_MATCHED, 4, Decimal("900"), failed=True, direction="Debit"),
                StatusTally(ROW_MISMATCHED, 1, Decimal("300"), direction="Debit"),
            ]
        )
        self.assertEqual(summary["open_received_rows"], 0)
        self.assertEqual(summary["open_received_value"], Decimal("0"))
        self.assertEqual(summary["open_paid_rows"], 1)
        self.assertEqual(summary["open_paid_value"], Decimal("300"))
        self.assertEqual(summary["failed_rows"], 6)
        self.assertEqual(
            summary["open_paid_rows"] + summary["open_received_rows"], summary["open_rows"]
        )

    def test_a_skipped_transfer_is_in_neither_half_because_it_is_not_open(self):
        """`Skipped` is TERMINAL, so it was never in `open_rows` -- and it is in
        `SUMMARY_EXCLUDED_STATUSES` besides. The halves inherit both by walking
        `OPEN_ROW_STATUSES`, which is why `open_side` states neither exclusion a second time."""
        summary = derive_import_summary(
            [
                StatusTally(ROW_SKIPPED, 3, Decimal("999"), direction=ROW_DIRECTION_CREDIT),
                StatusTally(ROW_SKIPPED, 2, Decimal("111"), direction="Debit"),
                StatusTally(ROW_MATCHED, 1, Decimal("50"), direction="Debit"),
            ]
        )
        self.assertEqual(summary["open_received_rows"], 0)
        self.assertEqual(summary["open_paid_rows"], 1)
        self.assertEqual(summary["skipped_rows"], 5)
        self.assertEqual(
            summary["open_paid_value"] + summary["open_received_value"], summary["open_value"]
        )

    def test_a_blank_or_unrecognised_direction_is_OPEN_PAID_rather_than_neither(self):
        """⚠️ A CONSEQUENCE, NOT A GUESS, and the same one the total's cut already makes: the
        receipt write paths refuse anything that is not `Credit`, so such a row is structurally
        incapable of having become a receipt. Leaving it out of both halves would be money in
        `open_value` and in neither card beside it."""
        summary = derive_import_summary(
            [
                StatusTally(ROW_MATCHED, 1, Decimal("100"), direction=""),
                StatusTally(ROW_MISMATCHED, 1, Decimal("200"), direction="   "),
                StatusTally(ROW_ERROR, 1, Decimal("400"), direction="Reversal"),
                StatusTally(ROW_PENDING_MATCH, 1, Decimal("800"), direction="credit"),
            ]
        )
        self.assertEqual(summary["open_received_rows"], 0)
        self.assertEqual(summary["open_paid_rows"], 4)
        self.assertEqual(summary["open_paid_value"], Decimal("1500"))

    def test_the_split_uses_the_ONE_definition_of_the_axis(self):
        """`is_received_direction` decides membership here exactly as it decides it for the total's
        cut and for the settled blocks. A second predicate -- an inline `== "Credit"` -- would be
        free to drift from the one the write path is built on."""
        received = StatusTally(ROW_MATCHED, 1, Decimal("50"), direction=ROW_DIRECTION_CREDIT)
        self.assertTrue(is_received_direction(received.direction))
        self.assertEqual(derive_import_summary([received])["open_received_rows"], 1)

        paid = StatusTally(ROW_MATCHED, 1, Decimal("50"), direction="Debit")
        self.assertFalse(is_received_direction(paid.direction))
        self.assertEqual(derive_import_summary([paid])["open_paid_rows"], 1)

    def test_every_open_status_reaches_the_split(self):
        """⚠️ NOT VACUOUS BY CONSTRUCTION. A half walking a narrower set than `open_rows` does would
        under-report silently and still pass a partition test on any input that happened to avoid
        the missing status. Every member of `OPEN_ROW_STATUSES` is asserted to land."""
        for status in sorted(OPEN_ROW_STATUSES):
            summary = derive_import_summary(
                [
                    StatusTally(status, 1, Decimal("10"), direction="Debit"),
                    StatusTally(status, 1, Decimal("20"), direction=ROW_DIRECTION_CREDIT),
                ]
            )
            self.assertEqual(summary["open_paid_rows"], 1, status)
            self.assertEqual(summary["open_paid_value"], Decimal("10"), status)
            self.assertEqual(summary["open_received_rows"], 1, status)
            self.assertEqual(summary["open_received_value"], Decimal("20"), status)

    def test_an_empty_import_reports_both_halves_at_zero_rather_than_omitting_them(self):
        summary = derive_import_summary([])
        for key in ("open_paid_rows", "open_received_rows"):
            self.assertEqual(summary[key], 0)
        for key in ("open_paid_value", "open_received_value"):
            self.assertEqual(summary[key], Decimal("0"))

    def test_the_money_is_Decimal_never_float(self):
        summary = derive_import_summary(
            [
                StatusTally(ROW_MATCHED, 1, Decimal("0.10"), direction=ROW_DIRECTION_CREDIT),
                StatusTally(ROW_MATCHED, 1, Decimal("0.10"), direction="Debit"),
            ]
        )
        self.assertIsInstance(summary["open_received_value"], Decimal)
        self.assertIsInstance(summary["open_paid_value"], Decimal)

    def test_every_figure_the_split_sits_beside_is_byte_unchanged(self):
        """⚠️ THE REGRESSION PIN, RUN WITH AND WITHOUT DIRECTIONS. `total_*`, `open_*`, `decided_*`,
        `settled_*` and `by_status` are the figures this cut was carved out of, and every one of
        them must be exactly what it was before there was a second axis on `open`."""
        tallies = [
            StatusTally(ROW_SETTLED, 3, Decimal("300"), direction=ROW_DIRECTION_CREDIT),
            StatusTally(ROW_SKIPPED, 1, Decimal("100"), direction="Debit"),
            StatusTally(ROW_MATCHED, 4, Decimal("400"), direction="Debit"),
            StatusTally(ROW_MISMATCHED, 2, Decimal("50.25"), direction=ROW_DIRECTION_CREDIT),
            StatusTally(ROW_ERROR, 1, Decimal("9"), failed=True, direction="Debit"),
        ]
        with_direction = derive_import_summary(tallies)
        without = derive_import_summary(
            [StatusTally(t.status, t.count, t.value, failed=t.failed) for t in tallies]
        )
        for key in (
            "total_rows",
            "total_value",
            "open_rows",
            "open_value",
            "decided_rows",
            "decided_percent",
            "settled_rows",
            "settled_value",
            "skipped_rows",
            "skipped_value",
            "failed_rows",
            "failed_value",
            "matched_rows",
            "matched_value",
            "mismatched_rows",
            "mismatched_value",
            "pending_rows",
            "error_rows",
            "by_status",
        ):
            self.assertEqual(with_direction[key], without[key], key)


class TestPurity(unittest.TestCase):
    """What this module may depend on.

    ⚠️ NARROWED, DELIBERATELY. This test used to forbid EVERY `nirmaan_stack` import, which read as
    a purity rule but was broader than its own stated reason -- "the deriver must stay callable from
    a plain unittest with no bench and no fixtures". A pure sibling costs that property nothing, and
    the over-broad version had a real price: the already-Paid branch kept its own EXACT amount
    comparison rather than importing the shared +-Re 1 window, and flagged 8 of 26 rows in a live
    statement as discrepancies over gaps of 14 to 86 paise.

    So the rule is now the property, stated directly: no `frappe`, and nothing outside this pure
    package. `services/outflow_import/` may not grow a dependency on `api/` or on a doctype.
    """

    def test_the_module_never_imports_frappe(self):
        """The load-bearing half. A `frappe` import here means the deriver needs a bench."""
        for line in self._import_lines():
            self.assertNotIn("frappe", line)

    def test_any_package_import_is_a_pure_sibling(self):
        for line in self._import_lines():
            if "nirmaan_stack" not in line:
                continue
            self.assertIn(
                "nirmaan_stack.services.outflow_import",
                line,
                "status.py may only import from its own pure service package",
            )

    def test_every_sibling_it_imports_is_itself_bench_free(self):
        """Transitive, because a pure-looking import of an impure module buys nothing.

        ⚠️ WIDENED WITH THE SECOND SIBLING. `status.py` grew a `ledgers` import so
        `derive_settled_ledger_split` would not spell the three ledger names a second time; leaving
        this test naming only `amounts` would have let the new dependency go unchecked, which is
        exactly the hole a transitive purity test exists to close. Any further sibling import must
        be added here in the same edit.
        """
        import inspect

        from nirmaan_stack.services.outflow_import import amounts, ledgers

        for sibling in (amounts, ledgers):
            for line in inspect.getsource(sibling).splitlines():
                stripped = line.strip()
                if stripped.startswith(("import ", "from ")):
                    self.assertNotIn("frappe", stripped, sibling.__name__)

    @staticmethod
    def _import_lines():
        import inspect

        from nirmaan_stack.services.outflow_import import status

        return [
            line.strip()
            for line in inspect.getsource(status).splitlines()
            if line.strip().startswith(("import ", "from "))
        ]


if __name__ == "__main__":
    unittest.main()


class TestSettlementOrigin(unittest.TestCase):
    """The three-way verdict shared by the settle path and the backfill patch (slice Q1)."""

    def test_the_matchers_pick_confirmed_unchanged_is_ACCEPTED(self):
        self.assertEqual(settlement_origin("PAY-1", "PAY-1"), ORIGIN_ACCEPTED)

    def test_a_different_record_is_OVERRIDDEN(self):
        self.assertEqual(settlement_origin("PAY-1", "PAY-2"), ORIGIN_OVERRIDDEN)

    def test_no_suggestion_is_ITS_OWN_ANSWER_not_an_override(self):
        # ⚠️ THE DISTINCTION THAT MATTERS. A fan-out has no single suggestion by design and a row
        # the matcher never touched has none either -- both are "the person found it", which is a
        # different fact from "the person disagreed with us". Collapsing them would report every
        # hand-found settlement as a disagreement with a machine that never spoke.
        for blank in (None, "", "   "):
            self.assertEqual(settlement_origin(blank, "PAY-1"), ORIGIN_NO_SUGGESTION)

    def test_it_trims_before_comparing(self):
        self.assertEqual(settlement_origin("  PAY-1 ", "PAY-1"), ORIGIN_ACCEPTED)

    def test_the_three_values_are_the_doctype_Select_options(self):
        # A value outside the Select silently fails to save on a Frappe insert.
        self.assertEqual(
            {ORIGIN_ACCEPTED, ORIGIN_OVERRIDDEN, ORIGIN_NO_SUGGESTION},
            {"Suggestion accepted", "Suggestion overridden", "No suggestion"},
        )


class TestSettledFromSuggestionInTheSummary(unittest.TestCase):
    def test_it_counts_only_SETTLED_tallies(self):
        # ⚠️ NOT `with_suggestion`, WHICH COUNTS A DIFFERENT MOMENT. That one counts rows CARRYING a
        # pick (only ever non-zero on `Matched`) -- work waiting to be confirmed. This counts
        # settlements where a person confirmed that pick. A row moves from one to the other by being
        # confirmed, so summing them double-counts the same transfer twice in its life.
        summary = derive_import_summary([
            StatusTally(status=ROW_SETTLED, count=10, from_suggestion=8),
            StatusTally(status=ROW_MATCHED, count=5, with_suggestion=5, from_suggestion=99),
        ])
        self.assertEqual(summary["settled_rows"], 10)
        self.assertEqual(summary["settled_from_suggestion"], 8)

    def test_it_defaults_to_zero_so_an_unaware_caller_still_derives(self):
        summary = derive_import_summary([StatusTally(status=ROW_SETTLED, count=3)])
        self.assertEqual(summary["settled_from_suggestion"], 0)

    def test_the_hand_found_count_is_the_remainder_and_is_not_sent_separately(self):
        summary = derive_import_summary([
            StatusTally(status=ROW_SETTLED, count=849, from_suggestion=843),
        ])
        self.assertEqual(summary["settled_rows"] - summary["settled_from_suggestion"], 6)
        self.assertNotIn("settled_by_hand", summary)


class TestSkippedLeavesTheStatementTotals(unittest.TestCase):
    """⚠️ `Skipped` IS EXCLUDED FROM `total_rows` / `total_value` AND FROM NOTHING ELSE.

    Most skipped rows are CROSS-BATCH DUPLICATES -- a transfer that arrived in an earlier statement
    and was already counted there. Measured live: 544 of 640. Totalling them again reports the same
    money twice across two imports, and makes `decided_percent` a percentage of work that was
    finished before this statement was uploaded.

    The rows are excluded from the TOTALS, never hidden: the Skipped chip reads `skipped_rows` /
    `skipped_value`, and those are unchanged.
    """

    def test_a_skipped_tally_moves_neither_total(self):
        without = derive_import_summary([StatusTally(ROW_SETTLED, 2, Decimal("500"))])
        with_skipped = derive_import_summary(
            [
                StatusTally(ROW_SETTLED, 2, Decimal("500")),
                StatusTally(ROW_SKIPPED, 9, Decimal("99999")),
            ]
        )
        self.assertEqual(with_skipped["total_rows"], without["total_rows"])
        self.assertEqual(with_skipped["total_value"], without["total_value"])

    def test_by_status_still_carries_the_skipped_bucket(self):
        """⚠️ THE HALF THAT IS EASY TO BREAK. Excluding the tally by `continue`ing past the bucket
        would blank the Skipped chip, which is the opposite of what the ruling asked for."""
        summary = derive_import_summary([StatusTally(ROW_SKIPPED, 9, Decimal("99999"))])
        self.assertEqual(
            summary["by_status"][ROW_SKIPPED], {"count": 9, "value": Decimal("99999")}
        )

    def test_the_skipped_chip_figures_are_unchanged(self):
        summary = derive_import_summary(
            [
                StatusTally(ROW_SETTLED, 2, Decimal("500")),
                StatusTally(ROW_SKIPPED, 9, Decimal("99999")),
            ]
        )
        self.assertEqual(summary["skipped_rows"], 9)
        self.assertEqual(summary["skipped_value"], Decimal("99999"))

    def test_the_total_is_EXACTLY_open_plus_settled(self):
        """The invariant that replaced `sum(by_status counts) == total_rows`. Settled and open
        partition the total, which is what makes `decided_percent` a real fraction again."""
        summary = derive_import_summary(
            [
                StatusTally(ROW_PENDING_MATCH, 5, Decimal("50")),
                StatusTally(ROW_MATCHED, 4, Decimal("40")),
                StatusTally(ROW_MISMATCHED, 3, Decimal("30")),
                StatusTally(ROW_ERROR, 1, Decimal("10")),
                StatusTally(ROW_SETTLED, 7, Decimal("70")),
                StatusTally(ROW_SKIPPED, 9, Decimal("900")),
            ]
        )
        self.assertEqual(
            summary["total_rows"], summary["open_rows"] + summary["settled_rows"]
        )
        self.assertEqual(summary["total_rows"], 20)
        self.assertEqual(summary["settled_rows"], 7)
        self.assertEqual(summary["open_rows"], 13)

    def test_decided_percent_can_never_exceed_one_hundred(self):
        """The defect the `decided_rows` narrowing prevents: a statement of nine duplicates and one
        settlement, where Settled + Skipped over a Skipped-free total is 1000%."""
        summary = derive_import_summary(
            [
                StatusTally(ROW_SETTLED, 1, Decimal("100")),
                StatusTally(ROW_SKIPPED, 9, Decimal("900")),
            ]
        )
        self.assertEqual(summary["decided_percent"], 100.0)

    def test_a_skipped_only_import_totals_zero_without_dividing_by_zero(self):
        summary = derive_import_summary([StatusTally(ROW_SKIPPED, 9, Decimal("900"))])
        self.assertEqual(summary["total_rows"], 0)
        self.assertEqual(summary["total_value"], Decimal("0"))
        self.assertEqual(summary["decided_percent"], 0.0)
        self.assertEqual(summary["skipped_rows"], 9)

    def test_the_exclusion_is_a_NAMED_set_so_the_reason_is_greppable(self):
        self.assertEqual(SUMMARY_EXCLUDED_STATUSES, frozenset({ROW_SKIPPED}))

    def test_TERMINAL_ROW_STATUSES_STILL_CONTAINS_SKIPPED(self):
        """⚠️ THE GUARD AGAINST "FIXING" THIS BY NARROWING THE WRONG SET.

        `TERMINAL_ROW_STATUSES` answers a different question -- "does anybody still owe this row a
        decision?" -- and is read by `derive_batch_status`, `batch_is_open` and
        `review._FROZEN_ROW_STATUSES`. Dropping `Skipped` from it to make the summary exclusion fall
        out for free would change which statements the "Re-run match" button touches and which rows
        a re-match may overwrite. The exclusion is LOCAL to `derive_import_summary`.
        """
        self.assertIn(ROW_SKIPPED, TERMINAL_ROW_STATUSES)
        self.assertEqual(TERMINAL_ROW_STATUSES, frozenset({ROW_SETTLED, ROW_SKIPPED}))
        self.assertIsNot(SUMMARY_EXCLUDED_STATUSES, TERMINAL_ROW_STATUSES)
        self.assertTrue(RowOutcome(ROW_SKIPPED).is_terminal)


class TestSettledLedgerSplit(unittest.TestCase):
    """`derive_settled_ledger_split` -- which of the three books the settled money landed in.

    Its input is ALREADY AGGREGATED by the database, one entry per `target_doctype`, exactly as
    `derive_import_summary`'s is.
    """

    def test_all_three_are_zero_filled_when_nothing_settled(self):
        """⚠️ ZERO-FILLED ON PURPOSE, the same reasoning the statuses get. A panel that renders only
        the ledgers present reads as though the missing ones do not apply, when what they mean is
        "nothing settled here, this time"."""
        split = derive_settled_ledger_split([])
        self.assertEqual(
            split,
            [
                {"ledger": "Project Payments", "rows": 0, "value": Decimal("0")},
                {"ledger": "Project Expenses", "rows": 0, "value": Decimal("0")},
                {"ledger": "Non Project Expenses", "rows": 0, "value": Decimal("0")},
            ],
        )

    def test_a_ledger_absent_from_the_input_is_still_present_at_zero(self):
        split = derive_settled_ledger_split(
            [SettledLedgerEntry("Project Payments", 4, Decimal("400"))]
        )
        self.assertEqual([b["ledger"] for b in split], list(LEDGER_DOCTYPES))
        self.assertEqual(split[2], {"ledger": "Non Project Expenses", "rows": 0, "value": Decimal("0")})

    def test_the_order_is_FIXED_and_never_follows_the_input(self):
        """⚠️ NOT SORTED BY VALUE AND NOT INPUT ORDER. Sorting would rearrange the panel between
        statements, so the same figure sits somewhere different each time it is read."""
        split = derive_settled_ledger_split(
            [
                SettledLedgerEntry("Non Project Expenses", 1, Decimal("1")),
                SettledLedgerEntry("Project Expenses", 2, Decimal("2")),
                SettledLedgerEntry("Project Payments", 3, Decimal("3")),
            ]
        )
        self.assertEqual(
            [b["ledger"] for b in split],
            ["Project Payments", "Project Expenses", "Non Project Expenses"],
        )

    def test_the_order_does_not_follow_value_either(self):
        split = derive_settled_ledger_split(
            [
                SettledLedgerEntry("Project Payments", 1, Decimal("1")),
                SettledLedgerEntry("Non Project Expenses", 900, Decimal("900000")),
            ]
        )
        self.assertEqual(split[0]["ledger"], "Project Payments")
        self.assertEqual(split[-1]["ledger"], "Non Project Expenses")

    def test_the_three_names_are_bound_from_the_ledgers_module(self):
        """⚠️ ONE LIST, NOT TWO. A private copy here would be free to drift from the list
        `candidates.py` offers from and `settle.py` writes to."""
        split = derive_settled_ledger_split([])
        self.assertEqual([b["ledger"] for b in split], list(LEDGER_DOCTYPES))

    def test_Other_is_absent_when_nothing_falls_into_it(self):
        """⚠️ AN ANOMALY SLOT, NOT A CATEGORY. Live data has 0, and a permanent empty "Other" row
        invites the question "what is Other?" every time, for a case that should never occur."""
        split = derive_settled_ledger_split(
            [SettledLedgerEntry("Project Expenses", 2, Decimal("20"))]
        )
        self.assertEqual(len(split), 3)
        self.assertNotIn(SETTLED_LEDGER_OTHER, [b["ledger"] for b in split])

    def test_an_unrecognised_ledger_folds_into_a_trailing_Other(self):
        """It becomes VISIBLE rather than vanishing -- a dropped entry would leave the breakdown no
        longer adding up to `settled_rows`, with nothing on screen to say why."""
        split = derive_settled_ledger_split(
            [
                SettledLedgerEntry("Project Payments", 1, Decimal("10")),
                SettledLedgerEntry("Some Retired Doctype", 2, Decimal("20")),
            ]
        )
        self.assertEqual(len(split), 4)
        self.assertEqual(split[-1], {"ledger": SETTLED_LEDGER_OTHER, "rows": 2, "value": Decimal("20")})

    def test_several_unrecognised_ledgers_fold_into_ONE_Other(self):
        split = derive_settled_ledger_split(
            [
                SettledLedgerEntry("Alpha", 1, Decimal("1")),
                SettledLedgerEntry("Beta", 2, Decimal("2")),
            ]
        )
        self.assertEqual(split[-1], {"ledger": SETTLED_LEDGER_OTHER, "rows": 3, "value": Decimal("3")})

    def test_a_blank_or_whitespace_ledger_folds_into_Other_too(self):
        """A settled row whose match record could not be read is exactly the fact worth surfacing."""
        split = derive_settled_ledger_split(
            [
                SettledLedgerEntry("", 1, Decimal("1")),
                SettledLedgerEntry("   ", 1, Decimal("1")),
            ]
        )
        self.assertEqual(split[-1], {"ledger": SETTLED_LEDGER_OTHER, "rows": 2, "value": Decimal("2")})

    def test_a_padded_ledger_name_still_matches_its_real_bucket(self):
        split = derive_settled_ledger_split(
            [SettledLedgerEntry("  Project Payments  ", 3, Decimal("30"))]
        )
        self.assertEqual(split[0], {"ledger": "Project Payments", "rows": 3, "value": Decimal("30")})
        self.assertEqual(len(split), 3)

    def test_repeated_entries_for_one_ledger_accumulate(self):
        split = derive_settled_ledger_split(
            [
                SettledLedgerEntry("Project Payments", 1, Decimal("10")),
                SettledLedgerEntry("Project Payments", 2, Decimal("20")),
            ]
        )
        self.assertEqual(split[0], {"ledger": "Project Payments", "rows": 3, "value": Decimal("30")})

    def test_money_is_summed_as_EXACT_Decimal_never_float(self):
        """These sit beside a summary that is `Decimal` throughout. 0.1 + 0.2 must be 0.3."""
        split = derive_settled_ledger_split(
            [
                SettledLedgerEntry("Project Expenses", 1, Decimal("0.1")),
                SettledLedgerEntry("Project Expenses", 1, Decimal("0.2")),
            ]
        )
        self.assertEqual(split[1]["value"], Decimal("0.3"))
        self.assertIsInstance(split[1]["value"], Decimal)

    def test_the_value_defaults_to_zero_so_a_count_only_caller_still_derives(self):
        split = derive_settled_ledger_split([SettledLedgerEntry("Project Payments", 4)])
        self.assertEqual(split[0], {"ledger": "Project Payments", "rows": 4, "value": Decimal("0")})

    def test_it_accepts_a_generator(self):
        """The endpoint passes a genexp straight off the query rows, as the summary does."""
        split = derive_settled_ledger_split(
            SettledLedgerEntry(ledger, 1, Decimal("5")) for ledger in LEDGER_DOCTYPES
        )
        self.assertEqual([b["rows"] for b in split], [1, 1, 1])

    def test_the_entry_is_frozen(self):
        entry = SettledLedgerEntry("Project Payments", 1, Decimal("1"))
        with self.assertRaises(Exception):
            entry.count = 2



class TestReceivedDirection(unittest.TestCase):
    """`is_received_direction` -- the ONE definition of the axis the two blocks are cut on (B8b).

    It is a single POSITIVE test on purpose: every settled row is `Credit` or it is not, so the two
    blocks partition the population and no row can land in neither. A figure that appears in neither
    total is the failure mode this shape rules out.
    """

    def test_credit_is_the_only_thing_that_means_money_arrived(self):
        self.assertTrue(is_received_direction("Credit"))
        self.assertTrue(is_received_direction("  Credit  "))

    def test_a_debit_is_not_received(self):
        self.assertFalse(is_received_direction("Debit"))

    def test_a_BLANK_direction_is_PAID_not_received_and_never_neither(self):
        """⚠️ THE DISPOSITION OF A BLANK, PINNED.

        A blank is a CONSEQUENCE, not a guess: `settle.create_inflow_from_row` refuses anything that
        is not `Credit` at the write, naming "a transfer with no stated direction", so a blank-
        direction row is structurally incapable of having become a receipt. Calling it received
        would put a row in a block it could not have reached. What must never happen is that it
        lands in NEITHER -- money that is settled, counted in `settled_value`, and missing from both
        breakdowns beside it.
        """
        for blank in ("", "   ", None):
            self.assertFalse(is_received_direction(blank))

    def test_an_unrecognised_value_is_PAID_too(self):
        """There is no `Other` slot on this axis -- the owner ruled TWO blocks -- so falling to the
        side that cannot lie about a receipt is the only disposition that keeps both totals whole."""
        self.assertFalse(is_received_direction("Reversal"))
        self.assertFalse(is_received_direction("credit"))  # case matters; the Select is exact

    def test_the_spelling_matches_the_parser_that_writes_it(self):
        """⚠️ SPELLED IN `status.py` RATHER THAN IMPORTED FROM `settle.py` (which needs `frappe`),
        on the precedent `settle.DIRECTION_CREDIT` set. `parser` is bench-free, so the pin can live
        here; a rename that reached only one of them would silently move every credit to the paid
        block, with no test failing anywhere else."""
        from nirmaan_stack.services.outflow_import.parser import DIRECTION_CREDIT

        self.assertEqual(ROW_DIRECTION_CREDIT, DIRECTION_CREDIT)


class TestSettledLedgerSplitOrderParameter(unittest.TestCase):
    """The `ledgers` parameter added at B8b -- ONE implementation, two orders."""

    def test_the_default_is_byte_identical_to_the_pre_B8b_behaviour(self):
        entries = [SettledLedgerEntry("Project Expenses", 2, Decimal("20"))]
        self.assertEqual(
            derive_settled_ledger_split(entries),
            derive_settled_ledger_split(entries, LEDGER_DOCTYPES),
        )

    def test_a_supplied_order_zero_fills_and_orders_from_THAT_tuple(self):
        split = derive_settled_ledger_split([], RECEIVED_LEDGER_DOCTYPES)
        self.assertEqual([b["ledger"] for b in split], list(RECEIVED_LEDGER_DOCTYPES))

    def test_the_Other_slot_still_works_under_a_supplied_order(self):
        """A `Project Payment` cannot be a receipt, so under the received order it is exactly the
        unrecognised value the anomaly slot exists to make visible."""
        split = derive_settled_ledger_split(
            [SettledLedgerEntry("Project Payments", 1, Decimal("10"))], RECEIVED_LEDGER_DOCTYPES
        )
        self.assertEqual(split[-1], {"ledger": SETTLED_LEDGER_OTHER, "rows": 1, "value": Decimal("10")})

    def test_the_received_order_is_the_two_books_a_credit_can_reach(self):
        """⚠️ `Non Project Expenses` IS IN BOTH TUPLES ON PURPOSE, NOT BY COPY-PASTE. A non-project
        RECEIPT is stored as a NEGATIVE `Non Project Expense` (B7), so the ledger cannot tell you
        the direction -- which is exactly why the split keys on the ROW's direction."""
        self.assertEqual(RECEIVED_LEDGER_DOCTYPES, (INFLOW_DOCTYPE, NON_PROJECT_EXPENSE_DOCTYPE))
        self.assertIn(NON_PROJECT_EXPENSE_DOCTYPE, LEDGER_DOCTYPES)

    def test_the_inflow_ledger_is_never_settleable(self):
        """⚠️ IT IS A DISPLAY ORDER AND NOTHING MORE. An inflow is CREATED, never SETTLED -- there is
        no approved inflow waiting to be paid -- so it must stay out of every tuple that decides
        what may be offered or written."""
        self.assertNotIn(INFLOW_DOCTYPE, LEDGER_DOCTYPES)
        self.assertNotIn(INFLOW_DOCTYPE, SETTLEABLE_STATUSES)


class TestSettledDirectionBlocks(unittest.TestCase):
    """`derive_settled_direction_blocks` -- the settled money as TWO blocks (B8b, owner Q14 (a)).

    Each block reconciles to its OWN total, and neither is ever netted against the other.
    """

    @staticmethod
    def _by_direction(blocks):
        return {b["direction"]: b for b in blocks}

    def test_a_statement_with_no_credits_renders_ONLY_the_paid_block(self):
        """⚠️ CASHFREE AND CASHBOOK ARE SINGLE-DIRECTION SOURCES AND MUST LOOK EXACTLY AS THEY DO
        TODAY. A zero-filled received block on those imports would be a permanent empty heading over
        two zero lines, for something that cannot occur -- and it would change how every existing
        import renders."""
        blocks = derive_settled_direction_blocks(
            [SettledLedgerEntry("Project Payments", 114, Decimal("3748174"), "Debit")]
        )
        self.assertEqual([b["direction"] for b in blocks], [SETTLED_BLOCK_PAID])

    def test_the_paid_block_is_ALWAYS_present_even_at_zero(self):
        """It is the successor of the single `Settled` tile, whose zero-fill is load-bearing: "0
        settled" is precisely the fact a reviewer needs when nothing has been settled yet."""
        blocks = derive_settled_direction_blocks([])
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["direction"], SETTLED_BLOCK_PAID)
        self.assertEqual(blocks[0]["rows"], 0)
        self.assertEqual(blocks[0]["value"], Decimal("0"))
        self.assertEqual([b["ledger"] for b in blocks[0]["ledgers"]], list(LEDGER_DOCTYPES))

    def test_the_paid_block_is_byte_identical_to_the_pre_B8b_flat_split(self):
        """The proof that today's live data renders unchanged: 809 staged rows, every one `Debit`."""
        entries = [
            SettledLedgerEntry("Project Payments", 114, Decimal("3748174"), "Debit"),
            SettledLedgerEntry("Project Expenses", 19, Decimal("33897"), "Debit"),
            SettledLedgerEntry("Non Project Expenses", 13, Decimal("16545"), "Debit"),
        ]
        blocks = derive_settled_direction_blocks(entries)
        legacy = derive_settled_ledger_split(entries)
        self.assertEqual(blocks[0]["ledgers"], legacy)

    def test_the_received_block_appears_once_a_credit_settles(self):
        blocks = derive_settled_direction_blocks(
            [
                SettledLedgerEntry("Project Payments", 2, Decimal("200"), "Debit"),
                SettledLedgerEntry("Project Inflows", 3, Decimal("1800"), "Credit"),
            ]
        )
        self.assertEqual(
            [b["direction"] for b in blocks], [SETTLED_BLOCK_PAID, SETTLED_BLOCK_RECEIVED]
        )
        received = self._by_direction(blocks)[SETTLED_BLOCK_RECEIVED]
        self.assertEqual(received["rows"], 3)
        self.assertEqual(received["value"], Decimal("1800"))

    def test_received_is_APPENDED_so_the_paid_block_never_moves(self):
        """⚠️ THE FIXED-ORDER RULE, ONE LEVEL UP. A block whose position depends on whether another
        block exists has to be re-found every time the period changes."""
        with_credits = derive_settled_direction_blocks(
            [
                SettledLedgerEntry("Project Payments", 1, Decimal("1"), "Debit"),
                SettledLedgerEntry("Project Inflows", 1, Decimal("1"), "Credit"),
            ]
        )
        without = derive_settled_direction_blocks(
            [SettledLedgerEntry("Project Payments", 1, Decimal("1"), "Debit")]
        )
        self.assertEqual(with_credits[0]["direction"], without[0]["direction"])

    def test_the_order_does_not_follow_value_either(self):
        """A ₹18 Cr receipts block still sits AFTER a ₹1 paid block."""
        blocks = derive_settled_direction_blocks(
            [
                SettledLedgerEntry("Project Payments", 1, Decimal("1"), "Debit"),
                SettledLedgerEntry("Project Inflows", 1, Decimal("180000000"), "Credit"),
            ]
        )
        self.assertEqual(blocks[0]["direction"], SETTLED_BLOCK_PAID)

    def test_EACH_BLOCK_RECONCILES_EXACTLY_TO_ITS_OWN_LINES(self):
        """⚠️ THE INVARIANT. Exact BY CONSTRUCTION -- the total is summed from the split this
        function just built, including its `Other` slot, so no arrangement of input entries can make
        a block's lines fail to add up to the figure above them."""
        blocks = derive_settled_direction_blocks(
            [
                SettledLedgerEntry("Project Payments", 4, Decimal("400.55"), "Debit"),
                SettledLedgerEntry("Project Expenses", 2, Decimal("20.10"), "Debit"),
                SettledLedgerEntry("Some Retired Doctype", 1, Decimal("9.35"), "Debit"),
                SettledLedgerEntry("Project Inflows", 3, Decimal("1800.01"), "Credit"),
                SettledLedgerEntry("Non Project Expenses", 1, Decimal("-50.01"), "Credit"),
                SettledLedgerEntry("Mystery Book", 2, Decimal("7"), "Credit"),
            ]
        )
        for block in blocks:
            self.assertEqual(
                block["value"],
                sum((b["value"] for b in block["ledgers"]), Decimal("0")),
                block["direction"],
            )
            self.assertEqual(
                block["rows"], sum(b["rows"] for b in block["ledgers"]), block["direction"]
            )

    def test_the_two_blocks_together_hold_EVERY_row_and_are_NEVER_netted(self):
        """⚠️ NEITHER HALF MAY VANISH. The blocks partition the input, so their totals add back to
        the whole -- which is what `settled_value` is, and what the endpoint test asserts against a
        real batch. Netting would report ₹350 here, which is the figure the owner ruled out."""
        entries = [
            SettledLedgerEntry("Project Payments", 4, Decimal("400"), "Debit"),
            SettledLedgerEntry("Project Inflows", 3, Decimal("1800"), "Credit"),
            SettledLedgerEntry("Non Project Expenses", 1, Decimal("-50"), "Credit"),
            SettledLedgerEntry("Project Expenses", 2, Decimal("20"), ""),
        ]
        blocks = derive_settled_direction_blocks(entries)
        self.assertEqual(sum(b["rows"] for b in blocks), 10)
        self.assertEqual(
            sum((b["value"] for b in blocks), Decimal("0")), Decimal("2170")
        )

    def test_a_blank_direction_lands_in_the_paid_block_and_is_never_dropped(self):
        """The named failure mode: a settled row that appears in NEITHER total."""
        blocks = derive_settled_direction_blocks(
            [SettledLedgerEntry("Project Expenses", 5, Decimal("500"), "")]
        )
        self.assertEqual([b["direction"] for b in blocks], [SETTLED_BLOCK_PAID])
        self.assertEqual(blocks[0]["rows"], 5)
        self.assertEqual(blocks[0]["value"], Decimal("500"))

    def test_non_project_expenses_appears_in_BOTH_blocks_when_both_sides_use_it(self):
        """⚠️ THE B7 TRAP, PINNED. A non-project RECEIPT is a NEGATIVE `Non Project Expense`, so the
        target doctype genuinely cannot tell you the direction -- the ROW's does."""
        blocks = derive_settled_direction_blocks(
            [
                SettledLedgerEntry("Non Project Expenses", 3, Decimal("300"), "Debit"),
                SettledLedgerEntry("Non Project Expenses", 1, Decimal("-40"), "Credit"),
            ]
        )
        by = self._by_direction(blocks)
        paid_npe = [b for b in by[SETTLED_BLOCK_PAID]["ledgers"] if b["ledger"] == NON_PROJECT_EXPENSE_DOCTYPE]
        recd_npe = [b for b in by[SETTLED_BLOCK_RECEIVED]["ledgers"] if b["ledger"] == NON_PROJECT_EXPENSE_DOCTYPE]
        self.assertEqual(paid_npe[0]["value"], Decimal("300"))
        self.assertEqual(recd_npe[0]["value"], Decimal("-40"))

    def test_the_received_block_zero_fills_its_OWN_two_books(self):
        """Not the three settle ledgers -- a credit can never be a `Project Payment`, and two
        permanent zeroes saying otherwise is the opposite of what a zero-fill is for."""
        blocks = derive_settled_direction_blocks(
            [SettledLedgerEntry("Project Inflows", 1, Decimal("10"), "Credit")]
        )
        received = self._by_direction(blocks)[SETTLED_BLOCK_RECEIVED]
        self.assertEqual([b["ledger"] for b in received["ledgers"]], list(RECEIVED_LEDGER_DOCTYPES))

    def test_money_stays_exact_Decimal_never_float(self):
        blocks = derive_settled_direction_blocks(
            [
                SettledLedgerEntry("Project Inflows", 1, Decimal("0.1"), "Credit"),
                SettledLedgerEntry("Project Inflows", 1, Decimal("0.2"), "Credit"),
            ]
        )
        received = self._by_direction(blocks)[SETTLED_BLOCK_RECEIVED]
        self.assertEqual(received["value"], Decimal("0.3"))
        self.assertIsInstance(received["value"], Decimal)

    def test_it_accepts_a_generator(self):
        """The endpoint passes a genexp straight off the query rows, as both other derivers do."""
        blocks = derive_settled_direction_blocks(
            SettledLedgerEntry(ledger, 1, Decimal("5"), "Debit") for ledger in LEDGER_DOCTYPES
        )
        self.assertEqual(blocks[0]["rows"], 3)

    def test_a_three_argument_entry_still_constructs_and_lands_paid(self):
        """Every pre-B8b caller and test builds this positionally with three arguments."""
        blocks = derive_settled_direction_blocks(
            [SettledLedgerEntry("Project Payments", 1, Decimal("1"))]
        )
        self.assertEqual([b["direction"] for b in blocks], [SETTLED_BLOCK_PAID])
