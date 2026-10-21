# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Pure: when a cheque may be cleared or cancelled, and which bank line may clear it (#1484, spec #1477,
#1516, ADR-0035 Amendment A).

Clearing pays, and only a bank-statement line clears: an ICICI debit nobody has matched yet, carrying the
cheque's number (leading zeros ignored) and its amount within ₹5. Every payment must be waiting for the
bank (Reconciliation Pending) unless the import starts from Approval Pending or Cancelled. An Old-type
cheque is cleared like any other, each line's record settled for the line's amount. Cancelling is
refused once the cheque is Cleared.

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


class TestClear(unittest.TestCase):
    """Only a bank-statement line clears a Payment cheque (#1516, ADR-0035 Amendment A)."""

    def problem(self, status="Issued", payments=(("PAY-1", RP),), **kw):
        values = {"cheque_type": "Payment", "old_type": False, "bank_line": True}
        values.update(kw)
        return clear_rules.clear_problem(status=status, payments=[clear_rules.ClearPayment(*p) for p in payments],
                                         **values)

    def test_an_issued_cheque_whose_payments_wait_for_the_bank_is_cleared_by_its_line(self):
        self.assertIsNone(self.problem(payments=[("PAY-1", RP), ("PAY-2", RP)]))

    def test_nothing_clears_a_cheque_without_a_bank_line(self):
        for status in ("Issued", "Approval Pending", "Cancelled"):
            self.assertEqual(
                self.problem(status, bank_line=False),
                "only a bank-statement line with its number and amount clears a cheque",
                status,
            )

    def test_a_cleared_cheque_is_already_cleared(self):
        self.assertEqual(self.problem("Cleared"), "already Cleared")

    def test_a_security_deposit_is_never_cleared(self):
        self.assertEqual(self.problem(cheque_type="Security Deposit"), "a Security Deposit cheque is never cashed")

    def test_a_payment_that_is_not_waiting_for_the_bank_is_named(self):
        self.assertEqual(self.problem(payments=[("PAY-1", RP), ("PAY-2", "Approved")]), "payment PAY-2 is Approved")

    def test_a_payment_already_paid_refuses_the_bank_line(self):
        self.assertEqual(
            self.problem(payments=[("PAY-1", RP), ("PAY-2", "Paid")]), "payment PAY-2 is already Paid"
        )

    def test_an_old_type_cheque_is_cleared_by_its_bank_line(self):
        self.assertIsNone(self.problem(old_type=True))
        self.assertIsNone(self.problem(old_type=True, payments=[]))  # it pays only expenses

    def test_an_old_type_cheque_is_cleared_from_any_live_status_like_any_other(self):
        # Owner, 2026-10-21: the import approves its waiting payments and revives a Cancelled one's.
        self.assertIsNone(self.problem("Approval Pending", [("PAY-1", "Requested")], old_type=True))
        self.assertIsNone(self.problem("Cancelled", [("PAY-1", "Rejected"), ("PAY-2", "Paid")], old_type=True))
        self.assertEqual(self.problem("Cleared", old_type=True), "already Cleared")

    def test_an_issued_old_type_cheque_takes_waiting_approved_and_paid_payments(self):
        # Every line is paid in full: a waiting one is approved by the import, an Approved one moves on and
        # is paid, a Paid one is left as it is.
        self.assertIsNone(self.problem(
            payments=[("PAY-1", "Requested"), ("PAY-2", "CEO Pending"), ("PAY-3", "Approved"), ("PAY-4", "Paid"),
                      ("PAY-5", RP)],
            old_type=True,
        ))

    def test_a_payment_rejected_while_its_cheque_stayed_issued_is_refused(self):
        # Only a cancel's history says the bank may have paid it twice, so no revival without one.
        self.assertEqual(
            self.problem(payments=[("PAY-1", RP), ("PAY-2", "Rejected")], old_type=True),
            "payment PAY-2 was Rejected while its cheque stayed Issued",
        )
        self.assertEqual(self.problem(payments=[("PAY-1", "")], old_type=True), "payment PAY-1 is blank")

    def test_a_payment_on_hold_is_refused_by_name(self):
        # A cheque payment is never put on hold (ADR-0035 §5), but one on an Old-type cheque may predate that.
        for status, old_type in (("Issued", True), ("Cancelled", True), ("Approval Pending", False)):
            self.assertEqual(
                self.problem(status, [("PAY-1", RP), ("PAY-2", "Approved", True)], old_type=old_type),
                "payment PAY-2 is on hold, so it cannot be paid until the hold is released",
                status,
            )
        # A Paid one is left as it is, so its hold stops nothing.
        self.assertIsNone(self.problem(payments=[("PAY-1", "Paid", True)], old_type=True))

    def test_an_old_type_cheque_s_expense_is_settled_only_once_it_waits_for_the_bank(self):
        for status in (RP, "Paid"):
            self.assertIsNone(self.problem(old_type=True, expenses=[("NPE-1", status)]), status)
        for status in ("Requested", "CEO Pending", "Approved", "Rejected", ""):
            self.assertEqual(
                self.problem(old_type=True, expenses=[("NPE-1", status)]),
                f"expense NPE-1 is {status or 'blank'}: the import settles an expense only at Reconciliation Pending",
                status,
            )


def _old(idx=1, doctype="Project Payments", name="PAY-1", amount=30000.0, record_amount=30000.0):
    return clear_rules.OldTypeLine(idx=idx, doctype=doctype, name=name, amount=amount, record_amount=record_amount)


class TestWhatAnOldTypeChequeSettles(unittest.TestCase):
    """Each line's record is settled for that line's amount, one bank match per line (#1516)."""

    def problem(self, lines, bank_amount=50000):
        return clear_rules.old_type_lines_problem(lines, bank_amount=bank_amount)

    def test_lines_that_add_up_to_the_bank_line_are_settled(self):
        lines = [_old(), _old(2, "Project Expenses", "PE-1", 20000, None)]
        self.assertIsNone(self.problem(lines))
        self.assertIsNone(self.problem(lines, bank_amount=50004))

    def test_a_cheque_with_no_lines_has_nothing_to_settle(self):
        self.assertEqual(self.problem([]), "it has no lines, so the bank line would settle nothing")

    def test_a_line_that_names_no_record_is_refused(self):
        self.assertEqual(self.problem([_old(name=None, amount=50000, record_amount=None)]), "line 1 names no payment")

    def test_lines_that_do_not_add_up_to_the_bank_line_are_refused(self):
        self.assertEqual(
            self.problem([_old(), _old(2, "Non Project Expenses", "NPE-1", 10000, None)]),
            "its lines add up to ₹40,000, but the bank line is for ₹50,000",
        )

    def test_a_payment_line_must_pay_the_whole_payment(self):
        self.assertEqual(
            self.problem([_old(amount=50000, record_amount=45000)]),
            "line 1 pays ₹50,000 of payment PAY-1, which is for ₹45,000",
        )


class TestCancel(unittest.TestCase):
    def test_pending_and_issued_cheques_may_be_cancelled(self):
        self.assertIsNone(clear_rules.cancel_problem(status="Approval Pending"))
        self.assertIsNone(clear_rules.cancel_problem(status="Issued"))

    def test_a_cleared_cheque_has_no_undo(self):
        self.assertEqual(clear_rules.cancel_problem(status="Cleared"), "it is Cleared: a cleared cheque cannot be cancelled")

    def test_a_cheque_with_a_paid_line_cannot_be_cancelled_and_names_it(self):
        # An Old-type cheque may have a line already Paid: that money has left, so a cancel cannot undo it.
        self.assertEqual(
            clear_rules.cancel_problem(status="Issued", paid=[("payment", "PAY-1"), ("expense", "NPE-1")]),
            "payment PAY-1 on it is already Paid, so the money has left the bank",
        )
        self.assertEqual(
            clear_rules.cancel_problem(status="Issued", paid=[("expense", "NPE-1")]),
            "expense NPE-1 on it is already Paid, so the money has left the bank",
        )

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
