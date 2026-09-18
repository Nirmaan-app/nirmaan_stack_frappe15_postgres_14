# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for who set a line aside: the software, or a person (#1273, parent #1270).

Two things are pinned here, both pure:

  * every outcome the software derives as `Skipped` carries `skip_origin = System`, so the three
    derivers (upload staging, the gateway match run, the ICICI contains-guard) cannot land a skip
    without it;
  * the back-fill classifier, which decides for lines skipped BEFORE the field existed. A line it
    wrongly calls Manual becomes unskippable, and unskipping a system skip is how the same money gets
    recorded twice -- so every doubt resolves to System.
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.matcher import (
    BASIS_BANK_REFERENCE,
    PaymentGroup,
    RowMatchResult,
    TargetRef,
    VendorResolution,
)
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KINDS
from nirmaan_stack.services.outflow_import.skip_origin import (
    SKIP_REFUSED_ALREADY_SKIPPED,
    SKIP_REFUSED_CASHBOOK,
    SKIP_REFUSED_PARTIALLY_ALLOCATED,
    SKIP_REFUSED_SETTLED,
    UNSKIP_REFUSED_CASHBOOK,
    UNSKIP_REFUSED_NOT_SKIPPED,
    UNSKIP_LOCKED_KINDS,
    UNSKIP_REFUSED_NO_KIND,
    classify_skip_origin,
    is_system_skip_sentence,
    manual_skip_refusal,
    unskip_refusal,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SKIPPED,
    SKIP_ORIGIN_MANUAL,
    SKIP_ORIGIN_SYSTEM,
    SKIP_ORIGINS,
    SKIP_REASON_ALREADY_IMPORTED,
    SKIP_REASON_EXCLUDED_AT_INGEST,
    SKIP_REASON_NOT_SUCCESSFUL,
    SYSTEM_SKIP_SENTENCES,
    RowOutcome,
    derive_duplicate_guard_outcome,
    derive_row_outcome,
    derive_staged_row_outcome,
)


class _Row:
    def __init__(self, amount="5000", is_success=True, status_raw="SUCCESS"):
        self.amount = Decimal(str(amount))
        self.is_success = is_success
        self.status_raw = status_raw
        self.bank_reference_no = "900000000001"


def _paid_group(amount="5000"):
    return PaymentGroup(
        targets=(TargetRef("Project Payments", "PAY-1", Decimal(amount), "Paid", "VEN-1", ""),),
        basis=BASIS_BANK_REFERENCE,
    )


def _one_candidate():
    target = TargetRef("Project Payments", "PAY-2", Decimal("5000"), "Approved", "VEN-1", "")
    return RowMatchResult(
        vendor=VendorResolution(),
        payment_groups=(PaymentGroup(targets=(target,), basis=BASIS_BANK_REFERENCE),),
        expense_candidates=(),
    )


class TestVocabulary(unittest.TestCase):
    def test_the_select_options_are_blank_system_manual(self):
        self.assertEqual(SKIP_ORIGINS, ("", "System", "Manual"))
        self.assertEqual(SKIP_ORIGIN_SYSTEM, "System")
        self.assertEqual(SKIP_ORIGIN_MANUAL, "Manual")


class TestEveryDerivedSkipIsSystem(unittest.TestCase):
    """A derived outcome is the software's decision by definition, so a derived skip is System."""

    def test_an_outcome_that_is_not_skipped_carries_no_origin(self):
        for status in (ROW_PENDING_MATCH, ROW_MATCHED, ROW_MISMATCHED):
            self.assertIsNone(RowOutcome(status, "note").skip_origin)

    def test_a_skipped_outcome_is_system(self):
        self.assertEqual(RowOutcome(ROW_SKIPPED, "note").skip_origin, SKIP_ORIGIN_SYSTEM)

    # --- the staged-outcome deriver (upload) ---------------------------------------------------

    def test_staging_an_excluded_line_is_system(self):
        outcome = derive_staged_row_outcome(_Row(), excluded_category="platform_porter")
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertEqual(outcome.skip_origin, SKIP_ORIGIN_SYSTEM)

    def test_staging_a_repeat_or_a_failed_transfer_is_system(self):
        for outcome in (
            derive_staged_row_outcome(_Row(), already_imported_in="OFI-26-00001"),
            derive_staged_row_outcome(_Row(), duplicate_in_file=True),
            derive_staged_row_outcome(_Row(is_success=False, status_raw="FAILED")),
        ):
            self.assertEqual(outcome.status, ROW_SKIPPED)
            self.assertEqual(outcome.skip_origin, SKIP_ORIGIN_SYSTEM)

    def test_staging_an_ordinary_line_has_no_origin(self):
        self.assertIsNone(derive_staged_row_outcome(_Row()).skip_origin)
        self.assertIsNone(derive_staged_row_outcome(_Row(), no_settlement_path=True).skip_origin)

    # --- the match-run derivers ----------------------------------------------------------------

    def test_a_gateway_line_already_recorded_is_system(self):
        outcome = derive_row_outcome(_Row(), _one_candidate(), paid_duplicate=_paid_group())
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertEqual(outcome.skip_origin, SKIP_ORIGIN_SYSTEM)

    def test_a_gateway_line_with_a_candidate_has_no_origin(self):
        self.assertIsNone(derive_row_outcome(_Row(), _one_candidate()).skip_origin)

    def test_a_contains_guard_skip_is_system(self):
        outcome = derive_duplicate_guard_outcome(_Row(), paid_duplicate=_paid_group())
        self.assertEqual(outcome.status, ROW_SKIPPED)
        self.assertEqual(outcome.skip_origin, SKIP_ORIGIN_SYSTEM)


def _classify(**overrides):
    facts = {
        "decided_by": "accounts@nirmaan.app",
        "outcome_note": "No approved payment or expense matches this transfer.",
        "skip_reason": "Staff's personal UPI transfer",
        "source": "Cashfree",
        "status_raw": "SUCCESS",
    }
    facts.update(overrides)
    return classify_skip_origin(**facts)


class TestBackfillClassifier(unittest.TestCase):
    """The five shapes the ticket names, plus the failed-transfer case and the blanks."""

    def test_a_hand_skip_is_manual(self):
        # The shape the dev database holds seven of: a typed reason, a person, and the matcher's
        # old NON-skip note still sitting in `outcome_note`.
        self.assertEqual(_classify(), SKIP_ORIGIN_MANUAL)

    def test_a_hand_skip_with_no_note_is_manual(self):
        self.assertEqual(_classify(outcome_note=None), SKIP_ORIGIN_MANUAL)

    def test_an_upload_skip_is_system(self):
        self.assertEqual(
            _classify(
                decided_by=None,
                outcome_note=None,
                skip_reason=SKIP_REASON_EXCLUDED_AT_INGEST.format(category="platform_porter"),
            ),
            SKIP_ORIGIN_SYSTEM,
        )

    def test_an_upload_skip_sentence_is_system_even_with_a_decider(self):
        self.assertEqual(
            _classify(
                outcome_note=None,
                skip_reason=SKIP_REASON_ALREADY_IMPORTED.format(batch="OFI-26-00001"),
            ),
            SKIP_ORIGIN_SYSTEM,
        )

    def test_a_match_time_skip_is_system(self):
        self.assertEqual(
            _classify(
                decided_by=None,
                outcome_note="Already recorded as Paid on Project Payment PAY-01393-005.",
                skip_reason=None,
            ),
            SKIP_ORIGIN_SYSTEM,
        )

    def test_a_system_skip_re_skipped_by_hand_stays_system(self):
        """Story 69. The old endpoint accepted an already-Skipped line and overwrote only
        `skip_reason`; the system sentence it left in `outcome_note` is the evidence."""
        for note in (
            "Already recorded as Paid on Project Payment PAY-01393-005.",
            "Already recorded as received on Project Inflow PINF-26-00001.",
            "Already recorded on Project Inflow PINF-26-00001 and Project Payment PAY-1.",
        ):
            with self.subTest(note=note):
                self.assertEqual(
                    _classify(outcome_note=note, skip_reason="checked, it is a duplicate"),
                    SKIP_ORIGIN_SYSTEM,
                )

    def test_a_cashbook_skip_is_system_even_with_a_decider(self):
        self.assertEqual(_classify(source="Cashbook"), SKIP_ORIGIN_SYSTEM)

    def test_a_transfer_the_bank_refused_is_system_even_with_a_typed_reason(self):
        """Story 59: money the bank never moved must never be unskippable. An upload skip re-skipped
        by hand lost its sentence to the typed reason; the bank's own status still says so."""
        self.assertEqual(
            _classify(outcome_note=None, status_raw="FAILED", skip_reason="not ours"),
            SKIP_ORIGIN_SYSTEM,
        )
        self.assertEqual(
            _classify(
                outcome_note=SKIP_REASON_NOT_SUCCESSFUL.format(status="REJECTED"),
                status_raw="REJECTED",
            ),
            SKIP_ORIGIN_SYSTEM,
        )

    def test_no_decider_is_system(self):
        for blank in (None, "", "   "):
            self.assertEqual(_classify(decided_by=blank), SKIP_ORIGIN_SYSTEM)

    def test_no_system_sentence_has_an_empty_fixed_prefix(self):
        """A template starting with `{` would give an empty prefix, and EVERY line would then read as a
        system sentence -- every hand skip silently back-filled System."""
        for sentence in SYSTEM_SKIP_SENTENCES:
            with self.subTest(sentence=sentence):
                self.assertGreaterEqual(len(sentence.split("{", 1)[0].strip()), 10)
        self.assertFalse(is_system_skip_sentence("Paid from the other account"))

    def test_leading_whitespace_does_not_hide_a_system_sentence(self):
        self.assertEqual(
            _classify(outcome_note="  Already recorded as Paid on Project Payment PAY-1."),
            SKIP_ORIGIN_SYSTEM,
        )


class TestManualSkipRefusal(unittest.TestCase):
    """Who may be skipped by hand: open, non-Cashbook lines, and nothing else."""

    def test_every_open_status_may_be_skipped(self):
        for status in (ROW_PENDING_MATCH, ROW_MATCHED, ROW_MISMATCHED, "Error"):
            with self.subTest(status=status):
                self.assertIsNone(manual_skip_refusal(row_status=status, source="Cashfree"))
        self.assertIsNone(
            manual_skip_refusal(row_status=ROW_MISMATCHED, source="ICICI Bank Statement")
        )

    def test_a_line_with_money_written_is_refused_with_its_own_sentence(self):
        self.assertEqual(
            manual_skip_refusal(row_status="Settled", source="Cashfree"), SKIP_REFUSED_SETTLED
        )
        self.assertEqual(
            manual_skip_refusal(row_status="Partially Allocated", source="Cashfree"),
            SKIP_REFUSED_PARTIALLY_ALLOCATED,
        )

    def test_an_already_skipped_line_is_refused_so_a_system_skip_is_never_relabelled(self):
        self.assertEqual(
            manual_skip_refusal(row_status=ROW_SKIPPED, source="Cashfree"),
            SKIP_REFUSED_ALREADY_SKIPPED,
        )

    def test_a_cashbook_line_is_refused_even_while_open(self):
        self.assertEqual(
            manual_skip_refusal(row_status=ROW_PENDING_MATCH, source="Cashbook"),
            SKIP_REFUSED_CASHBOOK,
        )

    def test_an_unknown_status_is_refused_and_named(self):
        refusal = manual_skip_refusal(row_status="Unmatched", source="Cashfree")
        self.assertIn("Unmatched", refusal)


class TestUnskipRefusal(unittest.TestCase):
    """Which skipped lines come back is decided by SKIP KIND (owner, 2026-09-17, ADR-0022 Amendment C).

    INVERTED from #1274's "only a hand skip": every kind comes back except the four locked ones, and a
    Cashbook line never does.
    """

    def test_every_unlocked_kind_may_be_unskipped(self):
        for kind in SKIP_KINDS:
            if kind in UNSKIP_LOCKED_KINDS:
                continue
            for source in ("Cashfree", "ICICI Bank Statement"):
                with self.subTest(kind=kind, source=source):
                    self.assertIsNone(
                        unskip_refusal(row_status=ROW_SKIPPED, skip_kind=kind, source=source)
                    )

    def test_the_locked_kinds_are_exactly_the_owner_s_four(self):
        self.assertEqual(
            set(UNSKIP_LOCKED_KINDS),
            {"Already imported", "Repeated in same file", "No amount", "Bank refused"},
        )
        for kind, sentence in UNSKIP_LOCKED_KINDS.items():
            with self.subTest(kind=kind):
                self.assertEqual(
                    unskip_refusal(row_status=ROW_SKIPPED, skip_kind=kind, source="Cashfree"), sentence
                )

    def test_a_blank_or_unknown_kind_is_refused(self):
        for kind in ("", None, "  ", "Not a kind"):
            with self.subTest(kind=kind):
                self.assertEqual(
                    unskip_refusal(row_status=ROW_SKIPPED, skip_kind=kind, source="Cashfree"),
                    UNSKIP_REFUSED_NO_KIND,
                )

    def test_a_line_that_is_not_skipped_is_refused(self):
        for status in (ROW_MATCHED, ROW_MISMATCHED, ROW_PENDING_MATCH, "Settled", "", None):
            with self.subTest(status=status):
                self.assertEqual(
                    unskip_refusal(row_status=status, skip_kind="Skipped by hand", source="Cashfree"),
                    UNSKIP_REFUSED_NOT_SKIPPED,
                )

    def test_a_cashbook_line_is_refused_whatever_its_kind(self):
        for kind in ("Skipped by hand", "Cashbook internal movement", "Outflow Already Recorded"):
            with self.subTest(kind=kind):
                self.assertEqual(
                    unskip_refusal(row_status=ROW_SKIPPED, skip_kind=kind, source=" Cashbook "),
                    UNSKIP_REFUSED_CASHBOOK,
                )

    def test_the_status_is_judged_before_the_source(self):
        self.assertEqual(
            unskip_refusal(row_status=ROW_MATCHED, skip_kind=None, source="Cashbook"),
            UNSKIP_REFUSED_NOT_SKIPPED,
        )


if __name__ == "__main__":
    unittest.main()
