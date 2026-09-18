# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for WHAT KIND of skip a line is -- the Skipped popup's Skip Type (owner-confirmed 2026-09-17).

Pinned here, all pure:

  * the vocabulary is exactly the doctype's `skip_kind` Select, in order;
  * every bank-exclusion rule has a kind, so a new rule cannot land a skip with no Skip Type;
  * every deriver that lands `Skipped` sets the kind from the same branch as the sentence, and a
    non-skip outcome carries none;
  * the Cashbook plan carries a kind on every skip row;
  * the history back-fill reads every sentence template back to its kind.
"""

import json
import os
import unittest
from datetime import date, datetime
from decimal import Decimal

from nirmaan_stack.services.outflow_import import bank_exclusions, cashbook, skip_kinds, status
from nirmaan_stack.services.outflow_import.contains_guard import RecordedGroup
from nirmaan_stack.services.outflow_import.matcher import (
    BASIS_BANK_REFERENCE,
    PaymentGroup,
    RowMatchResult,
    TargetRef,
    VendorResolution,
)
from nirmaan_stack.services.outflow_import.parser import RawRow
from nirmaan_stack.services.outflow_import.skip_kind_backfill import (
    classify_stored_skip_kind,
    kind_of_skip_sentence,
)
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_ALREADY_IMPORTED,
    SKIP_KIND_BANK_REFUSED,
    SKIP_KIND_BY_EXCLUSION_CATEGORY,
    SKIP_KIND_BY_HAND,
    SKIP_KIND_CASHBOOK_INTERNAL,
    SKIP_KIND_INFLOW_RECORDED,
    SKIP_KIND_NO_AMOUNT,
    SKIP_KIND_OUTFLOW_RECORDED,
    SKIP_KIND_PORTER_TOP_UP,
    SKIP_KIND_REPEATED_IN_FILE,
    SKIP_KINDS,
)

_DOCTYPE_JSON = os.path.join(
    os.path.dirname(__file__),
    "..", "..", "nirmaan_stack", "doctype", "outflow_import_row", "outflow_import_row.json",
)


class _Row:
    def __init__(self, amount="5000", is_success=True, status_raw="SUCCESS", direction="Debit"):
        self.amount = Decimal(str(amount))
        self.is_success = is_success
        self.status_raw = status_raw
        self.direction = direction
        self.bank_reference_no = "900000000001"


def _target(doctype, name="REC-1", amount="5000"):
    return TargetRef(doctype, name, Decimal(amount), "Paid", "VEN-1", "")


def _paid_group(amount="5000"):
    return PaymentGroup(targets=(_target("Project Payments", "PAY-1", amount),), basis=BASIS_BANK_REFERENCE)


def _one_candidate():
    target = TargetRef("Project Payments", "PAY-2", Decimal("5000"), "Approved", "VEN-1", "")
    return RowMatchResult(
        vendor=VendorResolution(),
        payment_groups=(PaymentGroup(targets=(target,), basis=BASIS_BANK_REFERENCE),),
        expense_candidates=(),
    )


class TestVocabulary(unittest.TestCase):
    def test_the_doctype_select_is_this_list_in_this_order(self):
        with open(_DOCTYPE_JSON, encoding="utf-8") as handle:
            fields = {f["fieldname"]: f for f in json.load(handle)["fields"]}
        self.assertEqual(fields["skip_kind"]["options"].split("\n"), ["", *SKIP_KINDS])

    def test_the_owner_confirmed_labels(self):
        self.assertEqual(
            SKIP_KINDS,
            (
                "Already imported",
                "Repeated in same file",
                "Bank refused",
                "No amount",
                "Outflow Already Recorded",
                "Inflow Already Recorded",
                "Cashfree wallet top-up",
                "Cashbook wallet top-up",
                "Porter wallet top-up",
                "Wallet money returned",
                "Bank internal transfer",
                "Failed payment bounced back",
                "Bank card rounding (₹2)",
                "Credit card bill payment",
                "Credit card auto-debit",
                "Cashbook internal movement",
                "Skipped by hand",
            ),
        )

    def test_every_bank_exclusion_rule_has_a_kind(self):
        """A new rule in `bank_exclusions` must name its kind in the same change."""
        self.assertEqual(
            set(SKIP_KIND_BY_EXCLUSION_CATEGORY), set(bank_exclusions.SKIP_CATEGORY_IDS)
        )
        for kind in SKIP_KIND_BY_EXCLUSION_CATEGORY.values():
            self.assertIn(kind, SKIP_KINDS)

    def test_the_leaf_imports_nothing(self):
        import inspect

        for line in inspect.getsource(skip_kinds).splitlines():
            self.assertFalse(line.strip().startswith(("import ", "from ")), line)


class TestEveryDerivedSkipCarriesItsKind(unittest.TestCase):
    def test_a_non_skip_outcome_has_no_kind(self):
        self.assertIsNone(status.derive_staged_row_outcome(_Row()).skip_kind)
        self.assertIsNone(status.derive_staged_row_outcome(_Row(), no_settlement_path=True).skip_kind)
        self.assertIsNone(status.derive_row_outcome(_Row(), _one_candidate()).skip_kind)

    def test_staging(self):
        cases = [
            (dict(excluded_category="platform_porter"), SKIP_KIND_PORTER_TOP_UP),
            (dict(already_imported_in="OFI-26-00001"), SKIP_KIND_ALREADY_IMPORTED),
            (dict(duplicate_in_file=True), SKIP_KIND_REPEATED_IN_FILE),
        ]
        for kwargs, kind in cases:
            with self.subTest(kwargs=kwargs):
                outcome = status.derive_staged_row_outcome(_Row(), **kwargs)
                self.assertEqual(outcome.status, status.ROW_SKIPPED)
                self.assertEqual(outcome.skip_kind, kind)
        refused = status.derive_staged_row_outcome(_Row(is_success=False, status_raw="FAILED"))
        self.assertEqual(refused.skip_kind, SKIP_KIND_BANK_REFUSED)

    def test_every_exclusion_category_stages_its_own_kind(self):
        for category, kind in SKIP_KIND_BY_EXCLUSION_CATEGORY.items():
            with self.subTest(category=category):
                outcome = status.derive_staged_row_outcome(_Row(), excluded_category=category)
                self.assertEqual(outcome.skip_kind, kind)

    def test_refused_and_already_imported_is_already_imported(self):
        """Owner ruling: the sentence the software chose wins over the bank status."""
        outcome = status.derive_staged_row_outcome(
            _Row(is_success=False, status_raw="FAILED"), already_imported_in="OFI-26-00001"
        )
        self.assertEqual(outcome.skip_kind, SKIP_KIND_ALREADY_IMPORTED)

    def test_the_match_run(self):
        self.assertEqual(
            status.derive_row_outcome(_Row(), already_imported_in="OFI-26-00001").skip_kind,
            SKIP_KIND_ALREADY_IMPORTED,
        )
        self.assertEqual(
            status.derive_row_outcome(_Row(is_success=False, status_raw="FAILED")).skip_kind,
            SKIP_KIND_BANK_REFUSED,
        )
        self.assertEqual(
            status.derive_row_outcome(_Row(), _one_candidate(), paid_duplicate=_paid_group()).skip_kind,
            SKIP_KIND_OUTFLOW_RECORDED,
        )

    def test_the_contains_guard_outflow_and_inflow(self):
        outflow = status.derive_duplicate_guard_outcome(
            _Row(), paid_duplicate=RecordedGroup(targets=(_target("Project Expenses"),))
        )
        self.assertEqual(outflow.status, status.ROW_SKIPPED)
        self.assertEqual(outflow.skip_kind, SKIP_KIND_OUTFLOW_RECORDED)

        inflow = status.derive_duplicate_guard_outcome(
            _Row(direction="Credit"), paid_duplicate=RecordedGroup(targets=(_target("Project Inflows"),))
        )
        self.assertEqual(inflow.status, status.ROW_SKIPPED)
        self.assertEqual(inflow.skip_kind, SKIP_KIND_INFLOW_RECORDED)

    def test_a_mixed_group_follows_the_line_direction(self):
        """Unreachable today; owner ruling says it takes the line's direction rather than a kind of its own."""
        group = RecordedGroup(
            targets=(_target("Project Inflows", "IN-1", "2500"), _target("Project Payments", "PAY-1", "2500"))
        )
        for direction, kind in (("Credit", SKIP_KIND_INFLOW_RECORDED), ("Debit", SKIP_KIND_OUTFLOW_RECORDED), ("", SKIP_KIND_OUTFLOW_RECORDED)):
            with self.subTest(direction=direction):
                outcome = status.derive_duplicate_guard_outcome(_Row(direction=direction), paid_duplicate=group)
                self.assertEqual(outcome.status, status.ROW_SKIPPED)
                self.assertEqual(outcome.skip_kind, kind)


def _cashbook_row(number=1, transfer_id="OBO1", amount="100", kind="Wallet Spend", status_raw="SUCCESS"):
    return RawRow(
        row_number=number, transfer_id=transfer_id, reference_id="",
        added_on=datetime(2026, 8, 1), amount=Decimal(amount), status_raw=status_raw,
        beneficiary_name="A Payee", beneficiary_id="", bank_account="", ifsc="", remarks="",
        bank_reference_no="", service_charge=Decimal("0"), service_tax=Decimal("0"),
        added_by_raw="A Spender", normalized_account="", normalized_reference="", row_kind=kind,
    )


class TestTheCashbookPlanCarriesAKind(unittest.TestCase):
    def _reason_and_kind(self, raw, already=None, booked=None, seen=None):
        return cashbook._skip_reason(raw, raw.amount, already or {}, booked or {}, seen or {})

    def test_each_skip_reason_has_its_kind(self):
        self.assertEqual(
            self._reason_and_kind(_cashbook_row(kind="Wallet Load")),
            (cashbook.SKIP_NOT_A_SPEND, SKIP_KIND_CASHBOOK_INTERNAL),
        )
        self.assertEqual(
            self._reason_and_kind(_cashbook_row(status_raw="FAILED")),
            (cashbook.SKIP_NOT_SUCCESSFUL, SKIP_KIND_BANK_REFUSED),
        )
        self.assertEqual(
            self._reason_and_kind(_cashbook_row(amount="0")),
            (cashbook.SKIP_NO_AMOUNT, SKIP_KIND_NO_AMOUNT),
        )

    def test_a_row_to_create_has_no_kind(self):
        self.assertEqual(self._reason_and_kind(_cashbook_row()), ("", None))


class TestTheHistoryBackfill(unittest.TestCase):
    def _classify(self, **overrides):
        facts = dict(skip_origin="System", skip_reason=None, outcome_note=None, direction="Debit")
        facts.update(overrides)
        return classify_stored_skip_kind(**facts)

    def test_every_template_reads_back_to_its_kind(self):
        cases = [
            (status.SKIP_REASON_ALREADY_IMPORTED.format(batch="OFI-26-00001"), SKIP_KIND_ALREADY_IMPORTED),
            (status.SKIP_REASON_DUPLICATE_IN_FILE, SKIP_KIND_REPEATED_IN_FILE),
            (status.SKIP_REASON_NOT_SUCCESSFUL.format(status="FAILED"), SKIP_KIND_BANK_REFUSED),
            (status.SKIP_REASON_ALREADY_PAID.format(records="Project Payment PAY-1"), SKIP_KIND_OUTFLOW_RECORDED),
            (status.SKIP_REASON_ALREADY_RECEIVED.format(records="Project Inflow IN-1"), SKIP_KIND_INFLOW_RECORDED),
            (cashbook.SKIP_NOT_A_SPEND, SKIP_KIND_CASHBOOK_INTERNAL),
            (cashbook.SKIP_NOT_SUCCESSFUL, SKIP_KIND_BANK_REFUSED),
            (cashbook.SKIP_NO_AMOUNT, SKIP_KIND_NO_AMOUNT),
            (cashbook.SKIP_ALREADY_IMPORTED.format(batch="OFI-26-00007"), SKIP_KIND_ALREADY_IMPORTED),
            (cashbook.SKIP_ALREADY_BOOKED.format(record="Project Expenses PE-1"), SKIP_KIND_OUTFLOW_RECORDED),
            (cashbook.SKIP_REPEATED_IN_FILE, SKIP_KIND_REPEATED_IN_FILE),
        ]
        for category, kind in SKIP_KIND_BY_EXCLUSION_CATEGORY.items():
            cases.append((status.SKIP_REASON_EXCLUDED_AT_INGEST.format(category=category), kind))
        for sentence, kind in cases:
            with self.subTest(sentence=sentence):
                self.assertEqual(kind_of_skip_sentence(sentence), kind)

    def test_every_system_skip_sentence_is_covered(self):
        """A new skip template must be taught to the back-fill in the same change."""
        for template in status.SYSTEM_SKIP_SENTENCES:
            filled = template.format(
                status="FAILED", batch="OFI-1", records="Project Payment PAY-1",
                category="platform_porter",
            )
            with self.subTest(template=template):
                self.assertIsNotNone(kind_of_skip_sentence(filled))

    def test_the_mixed_sentence_follows_direction(self):
        mixed = status._SKIP_REASON_ALREADY_RECORDED.format(records="Project Inflow IN-1, Project Payment PAY-1")
        self.assertEqual(kind_of_skip_sentence(mixed, "Credit"), SKIP_KIND_INFLOW_RECORDED)
        self.assertEqual(kind_of_skip_sentence(mixed, "Debit"), SKIP_KIND_OUTFLOW_RECORDED)

    def test_manual_origin_is_by_hand_whatever_the_text(self):
        self.assertEqual(
            self._classify(skip_origin="Manual", skip_reason=status.SKIP_REASON_DUPLICATE_IN_FILE),
            SKIP_KIND_BY_HAND,
        )

    def test_a_system_skip_re_skipped_by_hand_reads_its_outcome_note(self):
        self.assertEqual(
            self._classify(
                skip_reason="yes this is a duplicate",
                outcome_note=status.SKIP_REASON_ALREADY_PAID.format(records="Project Payment PAY-1"),
            ),
            SKIP_KIND_OUTFLOW_RECORDED,
        )

    def test_nothing_recognisable_is_none(self):
        self.assertIsNone(self._classify(skip_reason="typed by someone"))
        self.assertIsNone(self._classify())
        self.assertIsNone(
            kind_of_skip_sentence(status.SKIP_REASON_EXCLUDED_AT_INGEST.format(category="not_a_rule"))
        )


if __name__ == "__main__":
    unittest.main()
