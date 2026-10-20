# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Pure: which bank-statement lines are cheque lines, which Payment cheque one clears, and what the import
review says about it (#1485, spec #1477, ADR-0035).

An ICICI statement DEBIT whose cheque column is filled is a cheque line; a credit never is. It clears the
one Payment cheque carrying its number (leading zeros ignored) and amount (within ₹5); the bank import may
start from Issued, Pending (it approves the payments first) or Cancelled (it revives them).

No database. Run with `devenv.sh unit nirmaan_stack.services.cheques.test_bank_import_rules`.
"""

import unittest

from nirmaan_stack.services.cheques import bank_import_rules, clear_rules, rules
from nirmaan_stack.services.cheques.bank_import_rules import DoublePayment, FoundCheque

ICICI = "ICICI Bank Statement"
RP = "Reconciliation Pending"


class TestWhichLinesAreChequeLines(unittest.TestCase):
    def test_an_icici_debit_with_the_cheque_column_filled_is_one_keyed_without_zeros(self):
        self.assertEqual(bank_import_rules.bank_cheque_key(source=ICICI, direction="Debit", reference_id="000747"), "747")
        self.assertEqual(bank_import_rules.bank_cheque_key(source=ICICI, direction="Debit", reference_id="747.0"), "747")

    def test_a_credit_with_a_cheque_number_is_not(self):
        self.assertEqual(bank_import_rules.bank_cheque_key(source=ICICI, direction="Credit", reference_id="000190"), "")

    def test_a_debit_with_an_empty_cheque_column_is_not(self):
        self.assertEqual(bank_import_rules.bank_cheque_key(source=ICICI, direction="Debit", reference_id="  "), "")

    def test_another_source_is_not(self):
        self.assertEqual(bank_import_rules.bank_cheque_key(source="Cashfree", direction="Debit", reference_id="747"), "")


def _cheque(name="CHQ-1", cheque_no="000747", amount=40000, status="Issued", bank_line=None):
    return FoundCheque(name=name, cheque_no=cheque_no, status=status, amount=amount, bank_line=bank_line)


class TestWhichChequeALineClears(unittest.TestCase):
    def test_no_payment_cheque_with_the_number_leaves_the_line_to_the_usual_guard(self):
        self.assertEqual(bank_import_rules.pick_bank_cheque([], amount=40000), (None, None))

    def test_the_one_cheque_within_five_rupees_is_cleared(self):
        cheque = _cheque(amount=40004)
        self.assertEqual(bank_import_rules.pick_bank_cheque([cheque], amount=40000), (cheque, None))

    def test_the_number_found_with_another_amount_settles_nothing_and_says_why(self):
        cheque, hint = bank_import_rules.pick_bank_cheque([_cheque(cheque_no="000745", amount=448802)], amount=443802)
        self.assertIsNone(cheque)
        self.assertEqual(
            hint,
            "Cheque 000745 found, but its amount is ₹4,48,802, not ₹4,43,802. Nothing was settled. Check the "
            "cheque, or match this line by hand.",
        )

    def test_two_cheques_that_both_fit_settle_nothing(self):
        cheque, hint = bank_import_rules.pick_bank_cheque(
            [_cheque("CHQ-1", "000747"), _cheque("CHQ-2", "747")], amount=40000
        )
        self.assertIsNone(cheque)
        self.assertEqual(
            hint,
            "Cheques 000747 and 747 both carry this number and amount. Nothing was settled. Cancel the one the "
            "bank did not pay, then run the match again.",
        )

    def test_of_two_with_the_number_the_one_with_the_amount_is_cleared(self):
        fits = _cheque("CHQ-2", "747", amount=40000)
        self.assertEqual(bank_import_rules.pick_bank_cheque([_cheque("CHQ-1", amount=9000), fits], amount=40000), (fits, None))


class TestTheBankImportStartsFromMoreStatuses(unittest.TestCase):
    def problem(self, status, payments, *, bank_line=True):
        return clear_rules.clear_problem(status=status, cheque_type="Payment", old_type=False,
                                         payments=list(payments), bank_line=bank_line)

    def test_a_pending_cheque_whose_payments_wait_for_approval_may_be_cleared_by_the_bank(self):
        self.assertIsNone(self.problem("Approval Pending", [("PAY-1", "Requested"), ("PAY-2", "CEO Pending")]))

    def test_a_cancelled_cheque_whose_payments_are_rejected_may_be_cleared_by_the_bank(self):
        self.assertIsNone(self.problem("Cancelled", [("PAY-1", "Rejected"), ("PAY-2", "Rejected")]))

    def test_a_paid_payment_still_refuses_the_bank_line(self):
        self.assertEqual(self.problem("Cancelled", [("PAY-1", "Paid")]), "payment PAY-1 is already Paid")

    def test_without_a_bank_line_they_are_still_refused(self):
        self.assertEqual(
            self.problem("Approval Pending", [("PAY-1", "Requested")], bank_line=False),
            "only a bank-statement line with its number and amount clears a cheque",
        )

    def test_an_issued_cheque_still_needs_every_payment_waiting_for_the_bank(self):
        self.assertEqual(self.problem("Issued", [("PAY-1", RP), ("PAY-2", "Approved")]), "payment PAY-2 is Approved")


class TestWhatTheReviewSays(unittest.TestCase):
    def note(self, started, payments=2, suspects=()):
        return bank_import_rules.bank_cleared_note(cheque_no="000747", started=started, payments=payments, day="2026-10-14",
                                       suspects=suspects)

    def test_an_issued_cheque(self):
        self.assertEqual(
            self.note("Issued"),
            "Cheque 000747 cleared: 2 payments Reconciliation Pending → Paid, payment date 14-10-2026.",
        )

    def test_a_pending_cheque_says_the_import_approved_it(self):
        self.assertEqual(
            self.note("Approval Pending", payments=1),
            "Cheque 000747 was Approval Pending: the bank paid it before approval. Its 1 payment was approved by bank "
            "import (approval date 14-10-2026), then Paid.",
        )

    def test_a_cancelled_cheque_says_the_bank_paid_it_and_names_a_possible_double_payment(self):
        suspect = DoublePayment(payment="PAY-00071-019", record="PO/077/00071/26-27", amount=40273, status="Approved")
        self.assertEqual(
            self.note("Cancelled", payments=3, suspects=[suspect]),
            "Cheque 000747 was cancelled, but the bank paid it: 3 payments Rejected → Paid, payment date "
            "14-10-2026. Check for double payment: PO/077/00071/26-27 has PAY-00071-019 (₹40,273, Approved), "
            "raised after the cheque was cancelled.",
        )

    def test_a_cheque_cleared_by_hand_is_only_linked(self):
        self.assertEqual(
            self.note("Cleared"),
            "Cheque 000747 was already cleared by hand: this line is linked to it and its 2 payments; nothing "
            "was paid again.",
        )

    def test_a_failure_names_the_reason(self):
        self.assertEqual(
            bank_import_rules.bank_clear_failed_note(cheque_no="000747", reason="payment PAY-1 is on hold"),
            "Cheque 000747 matches this line but could not be cleared: payment PAY-1 is on hold. Nothing was "
            "settled.",
        )

    def test_a_line_whose_number_names_no_payment_cheque(self):
        self.assertEqual(
            bank_import_rules.no_payment_cheque_note("798"),
            "No Payment cheque 798 on ICICI Bank. A Security Deposit cheque is never matched. Match this line "
            "by hand.",
        )


if __name__ == "__main__":
    unittest.main()


class TestWhereABankClearedChequeStarted(unittest.TestCase):
    def start(self, cleared_by, *history):
        return bank_import_rules.bank_start(cleared_by=cleared_by, history=list(history))

    def test_from_issued(self):
        self.assertEqual(
            self.start("Bank import", (None, "Approval Pending", None), ("Approval Pending", "Issued", None), ("Issued", "Cleared", "x")),
            "Issued",
        )

    def test_from_pending_when_the_import_approved_it(self):
        self.assertEqual(
            self.start("Bank import", (None, "Approval Pending", None), ("Approval Pending", "Issued", bank_import_rules.BANK_APPROVAL_NOTE),
                       ("Issued", "Cleared", "x")),
            "Approval Pending",
        )

    def test_from_cancelled(self):
        self.assertEqual(self.start("Bank import", ("Issued", "Cancelled", "lost"), ("Cancelled", "Cleared", "x")),
                         "Cancelled")

    def test_a_cheque_cleared_by_hand_was_only_linked(self):
        self.assertEqual(self.start("By hand", ("Issued", "Cleared", None)), "Cleared")
