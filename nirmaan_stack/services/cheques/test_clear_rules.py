# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Pure: when a cheque may be cleared or cancelled by hand, and which bank line may clear it (#1484,
spec #1477, ADR-0035).

Clearing pays: a hand clear starts from Issued only, and every payment must be waiting for the bank
(Reconciliation Pending). A bank line clears it only when it is an ICICI debit nobody has matched yet,
carrying the cheque's number (leading zeros ignored) and its amount within ₹5. Cancelling is refused
once the cheque is Cleared.

No database. Run with `devenv.sh unit nirmaan_stack.services.cheques.test_clear_rules`.
"""

import unittest

from nirmaan_stack.services.cheques import clear_rules, rules
from nirmaan_stack.services.cheques.clear_rules import BankLine

RP = "Reconciliation Pending"


class TestChequeNumbersCompareWithoutLeadingZeros(unittest.TestCase):
    def test_the_statement_and_the_cheque_agree_whatever_the_zeros(self):
        self.assertEqual(rules.cheque_no_key("000747"), "747")
        self.assertEqual(rules.cheque_no_key("747"), "747")
        self.assertEqual(rules.cheque_no_key(" 000 747 "), "747")

    def test_a_spreadsheet_number_loses_its_decimal(self):
        self.assertEqual(rules.cheque_no_key("747.0"), "747")
        self.assertEqual(rules.cheque_no_key(747), "747")

    def test_blank_stays_blank_and_all_zeros_is_zero(self):
        self.assertEqual(rules.cheque_no_key(None), "")
        self.assertEqual(rules.cheque_no_key("  "), "")
        self.assertEqual(rules.cheque_no_key("000"), "0")


class TestClearByHand(unittest.TestCase):
    def problem(self, status="Issued", payments=(("PAY-1", RP),), **kw):
        values = {"cheque_type": "Payment", "old_type": False, "cleared_by": rules.CLEARED_BY_HAND,
                  "bank_line": False}
        values.update(kw)
        return clear_rules.clear_problem(status=status, payments=list(payments), **values)

    def test_an_issued_cheque_whose_payments_wait_for_the_bank_may_be_cleared(self):
        self.assertIsNone(self.problem(payments=[("PAY-1", RP), ("PAY-2", RP)]))

    def test_pending_and_cancelled_cheques_are_refused_by_hand(self):
        self.assertEqual(self.problem("Approval Pending"), "it is Approval Pending: its payments are not approved yet")
        self.assertEqual(self.problem("Cancelled"), "it is Cancelled: its payments are Rejected")

    def test_a_cleared_cheque_is_already_cleared(self):
        self.assertEqual(self.problem("Cleared"), "already Cleared")

    def test_a_security_deposit_is_never_cleared(self):
        self.assertEqual(self.problem(cheque_type="Security Deposit"), "a Security Deposit cheque is never cashed")

    def test_a_payment_that_is_not_waiting_for_the_bank_is_named(self):
        self.assertEqual(self.problem(payments=[("PAY-1", RP), ("PAY-2", "Approved")]), "payment PAY-2 is Approved")

    def test_a_payment_already_paid_is_left_as_it_is_without_a_bank_line(self):
        self.assertIsNone(self.problem(payments=[("PAY-1", RP), ("PAY-2", "Paid")]))

    def test_a_payment_already_paid_refuses_a_bank_line(self):
        self.assertEqual(
            self.problem(payments=[("PAY-1", RP), ("PAY-2", "Paid")], bank_line=True),
            "payment PAY-2 is already Paid",
        )

    def test_an_old_type_cheque_is_cleared_by_hand_without_a_bank_line(self):
        self.assertIsNone(self.problem(old_type=True, payments=[]))
        self.assertEqual(
            self.problem(old_type=True, bank_line=True), "an Old-type cheque is cleared by hand, without a bank line"
        )
        self.assertEqual(
            self.problem(old_type=True, cleared_by=rules.CLEARED_BY_BANK_IMPORT),
            "an Old-type cheque is cleared by hand, without a bank line",
        )

    def test_the_bank_import_clears_an_issued_cheque_too(self):
        self.assertIsNone(self.problem(cleared_by=rules.CLEARED_BY_BANK_IMPORT, bank_line=True))


class TestClearanceDate(unittest.TestCase):
    def test_a_date_is_required(self):
        self.assertEqual(
            clear_rules.clearance_date_problem(None, issue_date="2026-10-01", today="2026-10-17"),
            "Choose the clearance date.",
        )

    def test_it_cannot_be_after_today_or_before_the_issue_date(self):
        self.assertEqual(
            clear_rules.clearance_date_problem("2026-10-18", issue_date="2026-10-01", today="2026-10-17"),
            "The clearance date cannot be after today.",
        )
        self.assertEqual(
            clear_rules.clearance_date_problem("2026-09-30", issue_date="2026-10-01", today="2026-10-17"),
            "The clearance date cannot be before the cheque was issued (01-10-2026).",
        )

    def test_any_day_from_the_issue_date_to_today_is_fine(self):
        for day in ("2026-10-01", "2026-10-17"):
            self.assertIsNone(clear_rules.clearance_date_problem(day, issue_date="2026-10-01", today="2026-10-17"))
        self.assertIsNone(clear_rules.clearance_date_problem("2026-01-01", issue_date=None, today="2026-10-17"))


class TestCancel(unittest.TestCase):
    def test_pending_and_issued_cheques_may_be_cancelled(self):
        self.assertIsNone(clear_rules.cancel_problem(status="Approval Pending"))
        self.assertIsNone(clear_rules.cancel_problem(status="Issued"))

    def test_a_cleared_cheque_has_no_undo(self):
        self.assertEqual(clear_rules.cancel_problem(status="Cleared"), "it is Cleared: a cleared cheque cannot be cancelled")

    def test_a_cancelled_cheque_is_already_cancelled(self):
        self.assertEqual(clear_rules.cancel_problem(status="Cancelled"), "already Cancelled")

    def test_a_note_is_required(self):
        self.assertEqual(clear_rules.cancel_note_problem("  "), "Write a note saying why the cheque is cancelled.")
        self.assertIsNone(clear_rules.cancel_note_problem("bounced"))


def _line(**kw):
    values = {"name": "OFR-26-000001", "source": "ICICI Bank Statement", "direction": "Debit",
              "row_status": "Mismatched", "reference_id": "747", "amount": 50000}
    values.update(kw)
    return BankLine(**values)


class TestWhichBankLineClearsACheque(unittest.TestCase):
    def problem(self, line, *, bank="ICICI Bank", cheque_no="000747", amount=50000):
        return clear_rules.bank_line_problem(line, bank=bank, cheque_no=cheque_no, amount=amount)

    def test_an_unmatched_icici_debit_with_the_number_and_amount_clears_it(self):
        self.assertIsNone(self.problem(_line()))
        self.assertIsNone(self.problem(_line(reference_id="000747.0", amount=50004, row_status="Pending match run")))

    def test_only_an_icici_bank_cheque_is_matched(self):
        self.assertEqual(self.problem(_line(), bank="Others"), "only an ICICI Bank cheque is matched to a bank line")

    def test_a_line_from_another_source_is_refused(self):
        self.assertEqual(
            self.problem(_line(source="Cashfree")), "line OFR-26-000001 is not from an ICICI bank statement"
        )

    def test_a_credit_is_refused(self):
        self.assertEqual(self.problem(_line(direction="Credit")), "line OFR-26-000001 is a credit, not a debit")

    def test_a_line_already_matched_is_refused(self):
        self.assertEqual(self.problem(_line(row_status="Settled")), "line OFR-26-000001 is already Settled")

    def test_another_number_is_refused(self):
        self.assertEqual(
            self.problem(_line(reference_id="748")), "line OFR-26-000001 carries cheque number 748, not 000747"
        )

    def test_an_amount_more_than_five_rupees_off_is_refused(self):
        self.assertEqual(
            self.problem(_line(amount=50006)), "line OFR-26-000001 is for ₹50,006, but the cheque is for ₹50,000"
        )
