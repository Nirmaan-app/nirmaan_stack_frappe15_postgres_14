# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Pure: the Cheque's names pinned to the doctype JSON, and the bank identity (spec #1407).

No database. Run with `devenv.sh unit nirmaan_stack.services.cheques.test_rules`.
"""

import json
import os
import unittest

from nirmaan_stack.services.cheques import rules

DOCTYPES = os.path.join(os.path.dirname(__file__), "..", "..", "nirmaan_stack", "doctype")


def _options(folder: str, fieldname: str) -> tuple:
    with open(os.path.join(DOCTYPES, folder, f"{folder}.json")) as f:
        fields = {d["fieldname"]: d for d in json.load(f)["fields"]}
    return tuple(fields[fieldname]["options"].split("\n"))


class TestChequeNamesMatchTheDoctype(unittest.TestCase):
    def test_select_options_are_the_rule_constants(self):
        self.assertEqual(_options("cheques", "status"), rules.CHEQUE_STATUSES)
        self.assertEqual(_options("cheques", "cheque_type"), rules.CHEQUE_TYPES)
        self.assertEqual(_options("cheques", "cleared_by"), ("",) + rules.CLEARED_BY)  # blank until cleared
        self.assertEqual(_options("cheques", "bank"), rules.BANKS)
        self.assertEqual(_options("cheques", "made_from"), rules.MADE_FROM)
        self.assertEqual(_options("cheque_line", "line_type"), rules.LINE_TYPES)

    def test_the_statuses_and_types_are_the_glossary_s(self):
        self.assertEqual(rules.CHEQUE_STATUSES, ("Pending", "Issued", "Cleared", "Cancelled"))
        self.assertEqual(rules.CHEQUE_TYPES, ("Payment", "Security Deposit"))
        self.assertEqual(rules.CLEARED_BY, ("By hand", "Bank import"))


class TestStatusFromPayments(unittest.TestCase):
    """A Payment cheque's status is its payments' status in cheque words (spec #1477, ADR-0035).
    One entry per line: the payment's status, or None for a line with no payment yet."""

    def assertStatus(self, statuses, expected):
        self.assertEqual(rules.status_from_payments(statuses), expected, statuses)

    def test_payments_waiting_for_approval_make_it_pending(self):
        self.assertStatus(["Requested"], "Pending")
        self.assertStatus(["CEO Pending"], "Pending")
        self.assertStatus(["Requested", "CEO Pending"], "Pending")

    def test_a_line_with_no_payment_yet_keeps_it_pending(self):
        self.assertStatus([None], "Pending")
        self.assertStatus(["Approved", None], "Pending")

    def test_approved_payments_make_it_issued(self):
        self.assertStatus(["Approved"], "Issued")
        self.assertStatus(["Reconciliation Pending"], "Issued")
        self.assertStatus(["Approved", "Reconciliation Pending"], "Issued")

    def test_all_paid_makes_it_cleared(self):
        self.assertStatus(["Paid"], "Cleared")
        self.assertStatus(["Paid", "Paid"], "Cleared")

    def test_some_paid_is_still_issued(self):
        self.assertStatus(["Paid", "Reconciliation Pending"], "Issued")

    def test_one_waiting_payment_holds_the_whole_cheque_at_pending(self):
        self.assertStatus(["Approved", "Requested"], "Pending")
        self.assertStatus(["Paid", "CEO Pending"], "Pending")

    def test_all_rejected_makes_it_cancelled(self):
        self.assertStatus(["Rejected"], "Cancelled")
        self.assertStatus(["Rejected", "Rejected"], "Cancelled")

    def test_a_rejected_payment_beside_live_ones_does_not_count(self):
        # Under spec #1407 a Rejected payment dropped off its Cheque's lines, so the live ones decide.
        self.assertStatus(["Rejected", "Paid"], "Cleared")
        self.assertStatus(["Rejected", "Approved"], "Issued")

    def test_status_text_is_trimmed(self):
        self.assertStatus([" Paid "], "Cleared")

    def test_no_lines_or_an_unknown_status_cannot_be_worked_out(self):
        self.assertStatus([], None)
        self.assertStatus(["On Hold"], None)
        self.assertStatus(["Paid", ""], None)


class TestOldType(unittest.TestCase):
    """An Old-type cheque pays Expenses, has no lines, or is made out to a typed name (GLOSSARY.md)."""

    def test_a_vendor_cheque_of_po_lines_is_not_old_type(self):
        self.assertIsNone(rules.old_type_reason(vendor="V", payee_name=None, line_types=["PO/WO Payment"]))

    def test_each_reason(self):
        self.assertEqual(
            rules.old_type_reason(vendor="V", payee_name=None, line_types=["PO/WO Payment", "Project Expense"]),
            "pays expenses",
        )
        self.assertEqual(rules.old_type_reason(vendor=None, payee_name=None, line_types=["Non-project Expense"]),
                         "pays expenses")
        self.assertEqual(rules.old_type_reason(vendor="V", payee_name=None, line_types=[]), "has no lines")
        self.assertEqual(
            rules.old_type_reason(vendor=None, payee_name="Kavitha Properties", line_types=["PO/WO Payment"]),
            "is made out to a typed payee",
        )


class TestBankIdentity(unittest.TestCase):
    def test_an_others_bank_name_ignores_case_and_repeated_spaces(self):
        self.assertEqual(rules.bank_key("Others", "HDFC Bank"), rules.bank_key("Others", " hdfc   BANK "))
        self.assertNotEqual(rules.bank_key("Others", "HDFC Bank"), rules.bank_key("ICICI Bank"))

    def test_a_fixed_bank_ignores_any_typed_name(self):
        self.assertEqual(rules.bank_key("ICICI Bank", "anything"), "icici bank")

    def test_a_cheque_number_keeps_leading_zeros_and_loses_spaces(self):
        self.assertEqual(rules.normalise_cheque_no(" 004 521 "), "004521")


class TestPaymentChequeButtons(unittest.TestCase):
    """Which payments Convert to Cheque / Link a new cheque and Switch to Online accept (#1416)."""

    def test_an_online_payment_that_is_not_rejected_converts(self):
        for status in ("Requested", "CEO Pending", "Approved", "Reconciliation Pending", "Paid"):
            self.assertIsNone(rules.new_payment_cheque_problem("P1", is_cheque=False, status=status))
        self.assertIn("is Rejected", rules.new_payment_cheque_problem("P1", is_cheque=False, status="Rejected"))

    def test_a_cheque_payment_gets_a_new_cheque_only_once_its_cheque_is_cancelled(self):
        self.assertIsNone(
            rules.new_payment_cheque_problem("P1", is_cheque=True, status="Approved", cheque_no="1", cheque_status="Cancelled")
        )
        for cheque_status in ("Issued", "Cleared"):
            self.assertEqual(
                rules.new_payment_cheque_problem(
                    "P1", is_cheque=True, status="Approved", cheque_no="004521", cheque_status=cheque_status
                ),
                f"Payment P1 is on cheque 004521 ({cheque_status}). A new cheque can be linked only once that "
                "cheque is Cancelled.",
            )
        self.assertIn("is Rejected", rules.new_payment_cheque_problem(
            "P1", is_cheque=True, status="Rejected", cheque_no="1", cheque_status="Cancelled"
        ))

    def test_a_cheque_payment_no_cheque_records_may_get_a_cheque_or_go_back_online(self):
        # The backfill skips a refused cheque number, leaving its payments with no Cheque: both ways out
        # stay open, so the payment is not stuck.
        self.assertIsNone(rules.new_payment_cheque_problem("P1", is_cheque=True, status="Approved", cheque_no="004521"))
        self.assertIsNone(rules.switch_to_online_problem("P1", is_cheque=True, status="Approved", cheque_no="004521"))

    def test_a_rejected_cheque_payment_no_cheque_records_is_refused_both(self):
        self.assertIn("is Rejected", rules.new_payment_cheque_problem(
            "P1", is_cheque=True, status="Rejected", cheque_no="004521"
        ))
        self.assertEqual(
            rules.switch_to_online_problem("P1", is_cheque=True, status="Rejected", cheque_no="004521"),
            "Payment P1 is Rejected.",
        )

    def test_the_mode_changes_only_through_a_cheque(self):
        def problem(was, now, *, cheque=None, old_cheque_status=None):
            return rules.mode_change_problem(
                was_cheque=was, now_cheque=now, cheque=cheque, old_cheque_status=old_cheque_status,
                on_old_cheque_lines=old_cheque_status is not None,
            )

        self.assertIsNone(problem(False, False))
        self.assertIsNone(problem(True, True))
        self.assertIsNone(problem(False, True, cheque="CHQ-1"))
        self.assertEqual(
            problem(False, True), "An Online payment becomes a Cheque payment by putting it on a Cheque."
        )
        self.assertIsNone(problem(True, False, old_cheque_status="Cancelled"))
        self.assertIsNone(problem(True, False))  # on no Cheque: nothing holds it
        for status in ("Issued", "Cleared"):
            self.assertEqual(
                problem(True, False, old_cheque_status=status),
                "A Cheque payment goes back to Online only once its Cheque is Cancelled.",
            )

    def test_a_payment_whose_line_came_off_its_issued_cheque_may_go_online(self):
        # #1418, story 82: the report's Edit took its line off, so the Cheque no longer holds it.
        self.assertIsNone(rules.mode_change_problem(
            was_cheque=True, now_cheque=False, cheque=None, old_cheque_status="Issued", on_old_cheque_lines=False
        ))

    def test_switch_to_online_needs_a_cancelled_cheque(self):
        self.assertIsNone(rules.switch_to_online_problem("P1", is_cheque=True, cheque_no="1", cheque_status="Cancelled"))
        self.assertEqual(rules.switch_to_online_problem("P1", is_cheque=False), "Payment P1 is already Online.")
        self.assertIn("only once its cheque is Cancelled; it is on cheque 1 (Issued)",
                      rules.switch_to_online_problem("P1", is_cheque=True, cheque_no="1", cheque_status="Issued"))


class TestEditTakesPaymentsOff(unittest.TestCase):
    """A line holding a Project Payment may come off an Issued Cheque; the payment goes back to Online (#1418)."""

    @staticmethod
    def _line(line_type, payment=None):
        return rules.parse_line({"line_type": line_type, "project": "P", "record_doctype": "Service Requests",
                                 "record_name": "SR-1", "payment_name": payment, "amount": 100})

    def test_the_payments_an_edit_takes_off_are_the_ones_no_line_holds_any_more(self):
        wo, npe = rules.LINE_PO_WO_PAYMENT, rules.LINE_NON_PROJECT_EXPENSE
        before = [self._line(wo, "PAY-1"), self._line(wo, "PAY-2"), self._line(wo), self._line(npe, "NPE-1")]
        after = [self._line(wo, "PAY-2"), self._line(wo, "PAY-3")]
        self.assertEqual(rules.payments_taken_off(before, after), ["PAY-1"])  # an expense is no payment

    def test_an_issued_cheque_s_payment_line_may_come_off(self):
        header = rules.parse_header({"bank": "ICICI Bank", "cheque_no": "1", "cheque_date": "2026-10-14",
                                     "amount": 100, "vendor": "V", "attachment": "x"})
        for made_from in rules.MADE_FROM:
            self.assertIsNone(rules.edit_problem(
                header, header, status=rules.ISSUED, made_from=made_from,
                lines_before=[self._line(rules.LINE_PO_WO_PAYMENT, "PAY-1")], lines_after=[],
            ))

    # The amount is left out: `flt(..., 2)` needs a site, so with no DB every amount reads 0.0.
    # `api/cheques/test_cheque_edit` covers it.
    def test_a_po_page_cheque_keeps_its_number_and_date_while_a_payment_is_on_it(self):
        before = rules.parse_header({"bank": "ICICI Bank", "cheque_no": "1", "cheque_date": "2026-10-14",
                                     "amount": 100, "vendor": "V", "attachment": "x"})
        after = rules.parse_header({"bank": "ICICI Bank", "cheque_no": "2", "cheque_date": "2026-10-15",
                                    "amount": 100, "vendor": "V", "attachment": "x"})
        on_it = [self._line(rules.LINE_PO_WO_PAYMENT, "PAY-1")]
        self.assertIn("so its number and date cannot change here", rules.edit_problem(
            before, after, status=rules.ISSUED, made_from=rules.MADE_FROM_PO_WO_PAGE,
            lines_before=on_it, lines_after=on_it,
        ))

    def test_a_po_page_cheque_with_no_payment_left_edits_like_a_report_made_one(self):
        # Its payment came off (removed, swapped out, or dropped by a payee change): nothing to stay in step with.
        before = rules.parse_header({"bank": "ICICI Bank", "cheque_no": "1", "cheque_date": "2026-10-14",
                                     "amount": 100, "vendor": "V", "attachment": "x"})
        after = rules.parse_header({"bank": "ICICI Bank", "cheque_no": "2", "cheque_date": "2026-10-15",
                                    "amount": 100, "vendor": "V", "attachment": "x"})
        no_payment = [self._line(rules.LINE_PO_WO_PAYMENT), self._line(rules.LINE_NON_PROJECT_EXPENSE, "NPE-1")]
        for lines in ([], no_payment):
            self.assertIsNone(rules.edit_problem(
                before, after, status=rules.ISSUED, made_from=rules.MADE_FROM_PO_WO_PAGE,
                lines_before=lines, lines_after=lines,
            ))
