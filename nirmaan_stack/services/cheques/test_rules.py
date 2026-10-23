# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Pure: the Cheque's names pinned to the doctype JSON, and the bank identity (spec #1407).

No database. Run with `devenv.sh unit nirmaan_stack.services.cheques.test_rules`.
"""

import json
import os
import unittest
from dataclasses import replace

from nirmaan_stack.services.cheques import bank_import_rules, edit_rules, payment_rules, rules

DOCTYPES = os.path.join(os.path.dirname(__file__), "..", "..", "nirmaan_stack", "doctype")


def _field(folder: str, fieldname: str) -> dict:
    with open(os.path.join(DOCTYPES, folder, f"{folder}.json")) as f:
        return {d["fieldname"]: d for d in json.load(f)["fields"]}[fieldname]


def _options(folder: str, fieldname: str) -> tuple:
    return tuple(_field(folder, fieldname)["options"].split("\n"))


class TestChequeNamesMatchTheDoctype(unittest.TestCase):
    def test_select_options_are_the_rule_constants(self):
        self.assertEqual(_options("cheques", "status"), rules.CHEQUE_STATUSES)
        self.assertEqual(_options("cheques", "cheque_type"), rules.CHEQUE_TYPES)
        self.assertEqual(_options("cheques", "cleared_by"), ("",) + rules.CLEARED_BY)  # blank until cleared
        self.assertEqual(_options("cheques", "bank"), rules.BANKS)
        self.assertEqual(_options("cheques", "made_from"), rules.MADE_FROM)
        self.assertEqual(_options("cheque_line", "line_type"), rules.LINE_TYPES)
        # A payment a cheque line of the bank import settled (#1485).
        self.assertIn(bank_import_rules.BANK_MATCH_BASIS, _options("outflow_row_match", "match_basis"))

    def test_a_cheque_saved_with_no_status_starts_approval_pending(self):
        # A new Payment cheque waits for its payments' approval (spec #1477); a deposit sets Issued itself.
        self.assertEqual(_field("cheques", "status").get("default"), "Approval Pending")

    def test_the_old_clearance_date_stays_hidden_so_earlier_patches_run(self):
        # The #1478 patch selects it; a site that first gets Cheques from this JSON must still have the column.
        field = _field("cheques", "clearance_date")
        self.assertEqual((field["fieldtype"], field.get("hidden"), field.get("read_only")), ("Date", 1, 1))

    def test_the_statuses_and_types_are_the_glossary_s(self):
        self.assertEqual(rules.CHEQUE_STATUSES, ("Approval Pending", "Issued", "Cleared", "Cancelled"))
        self.assertEqual(rules.CHEQUE_TYPES, ("Payment", "Security Deposit"))
        self.assertEqual(rules.CLEARED_BY, ("By hand", "Bank import"))


class TestStatusFromPayments(unittest.TestCase):
    """A Payment cheque's status is its payments' status in cheque words (spec #1477, ADR-0035).
    One entry per line: the payment's status, or None for a line with no payment yet."""

    def assertStatus(self, statuses, expected):
        self.assertEqual(rules.status_from_payments(statuses), expected, statuses)

    def test_payments_waiting_for_approval_make_it_pending(self):
        self.assertStatus(["Requested"], "Approval Pending")
        self.assertStatus(["CEO Pending"], "Approval Pending")
        self.assertStatus(["Requested", "CEO Pending"], "Approval Pending")

    def test_a_line_with_no_payment_yet_keeps_it_pending(self):
        self.assertStatus([None], "Approval Pending")
        self.assertStatus(["Approved", None], "Approval Pending")

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
        self.assertStatus(["Approved", "Requested"], "Approval Pending")
        self.assertStatus(["Paid", "CEO Pending"], "Approval Pending")

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


class TestReadyToIssue(unittest.TestCase):
    """An Approval Pending Payment cheque is Issued in the step that moves its last payment on to Reconciliation
    Pending (#1479): Approved alone is not enough, since that move can still fail."""

    def test_every_payment_moved_on_issues_it(self):
        self.assertTrue(rules.ready_to_issue(["Reconciliation Pending"]))
        self.assertTrue(rules.ready_to_issue(["Reconciliation Pending", " Reconciliation Pending "]))

    def test_a_payment_still_at_approved_holds_it(self):
        self.assertFalse(rules.ready_to_issue(["Approved"]))
        self.assertFalse(rules.ready_to_issue(["Reconciliation Pending", "Approved"]))

    def test_a_waiting_payment_or_a_line_with_none_holds_it(self):
        self.assertFalse(rules.ready_to_issue(["Reconciliation Pending", "Requested"]))
        self.assertFalse(rules.ready_to_issue(["Reconciliation Pending", "CEO Pending"]))
        self.assertFalse(rules.ready_to_issue(["Reconciliation Pending", None]))

    def test_no_lines_or_another_status_never_issues_it(self):
        self.assertFalse(rules.ready_to_issue([]))
        self.assertFalse(rules.ready_to_issue(["Paid"]))
        self.assertFalse(rules.ready_to_issue(["Rejected", "Reconciliation Pending"]))


class TestIssueDate(unittest.TestCase):
    """The issue date is the day of the last approval: an L1 date, or the CEO's when the CEO approved."""

    def test_the_latest_approval_wins(self):
        self.assertEqual(rules.issue_date_from(["2026-10-12", "2026-10-15", None]), "2026-10-15")

    def test_dates_and_text_compare_as_dates(self):
        import datetime

        self.assertEqual(rules.issue_date_from([datetime.date(2026, 10, 9), "2026-10-10"]), "2026-10-10")

    def test_no_approval_date_gives_none(self):
        self.assertIsNone(rules.issue_date_from([None, ""]))
        self.assertIsNone(rules.issue_date_from([]))


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


class TestWhatAChequePaymentRefuses(unittest.TestCase):
    """Spec #1477 (ADR-0035): a Work Order is never paid by cheque, and a cheque payment moves with its
    cheque, so hold, Revert to Approved and a split each refuse it."""

    def test_only_a_po_payment_may_be_paid_by_cheque(self):
        self.assertIsNone(payment_rules.cheque_mode_problem(rules.PO_DOCTYPE))
        self.assertEqual(
            payment_rules.cheque_mode_problem(rules.WORK_ORDER_DOCTYPE),
            "A Work Order payment is paid Online: only a PO payment can be paid by cheque.",
        )

    def test_an_online_payment_is_never_refused(self):
        for action in payment_rules.CHEQUE_PAYMENT_ACTIONS:
            self.assertIsNone(payment_rules.cheque_payment_problem("PAY-1", action, is_cheque=False))

    def test_hold_revert_and_split_each_refuse_a_cheque_payment_saying_why(self):
        self.assertEqual(
            payment_rules.cheque_payment_problem("PAY-1", payment_rules.CHEQUE_REFUSES_HOLD, is_cheque=True, cheque_no="000747"),
            "PAY-1 is paid by cheque 000747, so it cannot be put on hold: a cheque's payments move together. "
            "Cancel the cheque in the Cheque Tracker instead.",
        )
        self.assertEqual(
            payment_rules.cheque_payment_problem("PAY-1", payment_rules.CHEQUE_REFUSES_REVERT, is_cheque=True, cheque_no="000747"),
            "PAY-1 is paid by cheque 000747, so it cannot go back to Approved: a cheque's payments move together. "
            "Cancel the cheque in the Cheque Tracker instead.",
        )
        self.assertEqual(
            payment_rules.cheque_payment_problem("PAY-1", payment_rules.CHEQUE_REFUSES_SPLIT, is_cheque=True, cheque_no="000747"),
            "PAY-1 is paid by cheque 000747, so it cannot be split: a cheque pays its payments in full or not "
            "at all.",
        )

    def test_a_cheque_payment_with_no_number_still_refuses(self):
        self.assertTrue(
            payment_rules.cheque_payment_problem("PAY-1", payment_rules.CHEQUE_REFUSES_HOLD, is_cheque=True).startswith(
                "PAY-1 is paid by cheque, so it cannot be put on hold"
            )
        )

    def test_an_unknown_action_is_a_bug(self):
        with self.assertRaises(KeyError):
            payment_rules.cheque_payment_problem("PAY-1", "delete", is_cheque=True)


class TestAChequePaymentIsPaidOnlyByItsClear(unittest.TestCase):
    """#1552, ADR-0035 Amendment B: no save moves a cheque payment into or out of Paid but its cheque's clear,
    and a payment in Cheque mode always has its cheque."""

    def problem(self, from_status, to_status, *, is_cheque=True, clearing=False):
        return payment_rules.paid_move_problem(
            "PAY-1", from_status=from_status, to_status=to_status, is_cheque=is_cheque, clearing=clearing
        )

    def test_only_the_clear_makes_a_cheque_payment_paid(self):
        self.assertIsNone(self.problem("Reconciliation Pending", "Paid", clearing=True))
        for from_status in ("Reconciliation Pending", "Approved", None):
            self.assertEqual(
                self.problem(from_status, "Paid"),
                "PAY-1 is a cheque payment, so it cannot be saved as Paid: a cheque payment becomes Paid only when a "
                "bank-statement line with its cheque's number and amount is imported, which clears the cheque and "
                "pays every payment on it.",
            )

    def test_a_paid_cheque_payment_is_never_set_back(self):
        for to_status in ("Reconciliation Pending", "Approved", "Rejected"):
            self.assertIn(f"PAY-1 is a Paid cheque payment, so it cannot be moved to {to_status}",
                          self.problem("Paid", to_status, clearing=True))

    def test_any_other_save_is_not_a_paid_move(self):
        self.assertIsNone(self.problem("Paid", "Paid"))
        self.assertIsNone(self.problem("Requested", "Approved"))
        self.assertIsNone(self.problem("Reconciliation Pending", "Paid", is_cheque=False))
        self.assertIsNone(self.problem("Paid", "Approved", is_cheque=False))

    def test_a_cheque_payment_on_no_cheque_is_refused_unless_rejected(self):
        self.assertIsNone(payment_rules.no_cheque_problem("PAY-1", status="Requested", on_a_cheque=True))
        self.assertIsNone(payment_rules.no_cheque_problem("PAY-1", status="Rejected", on_a_cheque=False))
        self.assertEqual(
            payment_rules.no_cheque_problem("PAY-1", status="Approved", on_a_cheque=False),
            "PAY-1 is in Cheque mode, but no cheque lists it, so it cannot be saved: a cheque payment always has its "
            "cheque. Delete it and request the payment again.",
        )


class TestModeChange(unittest.TestCase):
    """A payment's Mode of Payment changes only through a Cheque (spec #1407)."""

    def test_the_mode_changes_only_through_a_cheque(self):
        def problem(was, now, *, cheque=None, old_cheque_status=None):
            return payment_rules.mode_change_problem(
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
        self.assertIsNone(payment_rules.mode_change_problem(
            was_cheque=True, now_cheque=False, cheque=None, old_cheque_status="Issued", on_old_cheque_lines=False
        ))


class TestPaymentChequeEdit(unittest.TestCase):
    """Editing a Payment cheque (spec #1514, ADR-0035 Amendment A): while Approval Pending only what was written
    wrongly on the paper changes (its number, bank, date and photo), never what it pays; once Issued,
    only its photo."""

    BEFORE = rules.ChequeHeader(bank=rules.ICICI_BANK, bank_name=None, cheque_no="004521",
                                cheque_date="2026-10-14", amount=30000.0, vendor="V", payee_name=None,
                                description=None, attachment="old.jpg")

    @staticmethod
    def _line(payment=None, *, record="PO-1", amount=20000.0):
        return rules.ChequeLineInput(line_type=rules.LINE_PO_WO_PAYMENT, project="P", record_doctype=rules.PO_DOCTYPE,
                                     record_name=record, payment_doctype=rules.PAYMENT_DOCTYPE if payment else None,
                                     payment_name=payment, amount=amount)

    def _problem(self, *, status=rules.PENDING, lines_after=None, **changes):
        lines = [self._line("PAY-1"), self._line(record="PO-2", amount=10000.0)]  # an older two-PO cheque
        return edit_rules.edit_problem(
            self.BEFORE, replace(self.BEFORE, **changes), status=status,
            lines_before=lines, lines_after=lines if lines_after is None else lines_after,
        )

    def test_a_pending_cheque_s_number_bank_date_and_photo_may_change(self):
        self.assertIsNone(self._problem(
            cheque_no="004522", bank=rules.OTHER_BANK, bank_name="HDFC Bank", cheque_date="2026-10-20",
            attachment="new.jpg",
        ))

    def test_what_a_pending_cheque_pays_and_to_whom_may_not_change(self):
        self.assertEqual(
            self._problem(amount=25000.0),
            "Cheque 004521 can change only its number, bank, date and photo, not its amount.",
        )
        self.assertEqual(
            self._problem(vendor="V2", description="Advance"),
            "Cheque 004521 can change only its number, bank, date and photo, not its Vendor and note.",
        )

    def test_a_pending_cheque_s_lines_may_not_change(self):
        expected = (
            "Cheque 004521's lines cannot change: it pays what it was made for. To pay something else, cancel it "
            "and raise the payment again from the PO."
        )
        paid, open_line = self._line("PAY-1"), self._line(record="PO-2", amount=10000.0)
        self.assertEqual(self._problem(lines_after=[paid]), expected)  # one taken off
        self.assertEqual(self._problem(lines_after=[paid, open_line, self._line(amount=1.0)]), expected)  # one added
        picked = self._line("PAY-9", record="PO-2", amount=10000.0)
        self.assertEqual(self._problem(lines_after=[paid, picked]), expected)  # a payment picked for an open line
        self.assertEqual(self._problem(lines_after=[]), expected)

    def test_an_issued_cleared_or_cancelled_cheque_changes_only_its_photo(self):
        for status in (rules.ISSUED, rules.CLEARED, rules.CANCELLED):
            self.assertEqual(self._problem(status=status, cheque_no="004522"),
                             f"Cheque 004521 is {status}: only its photo can change.")
            self.assertIn("only its photo can change", self._problem(status=status, lines_after=[]))
            self.assertIsNone(self._problem(status=status, attachment="new.jpg"))

    def test_the_photo_can_be_replaced_not_removed(self):
        self.assertEqual(self._problem(attachment=None), "The cheque's photo can be replaced, not removed.")

    def test_procurement_edits_only_its_own_pending_cheques(self):
        self.assertIsNone(edit_rules.edit_access_problem(status=rules.PENDING, owner="u", user="u", any_cheque=False))
        for status in (rules.ISSUED, rules.CLEARED):
            self.assertIn("only the Approval Pending cheques you created",
                          edit_rules.edit_access_problem(status=status, owner="u", user="u", any_cheque=False))
        self.assertIsNotNone(edit_rules.edit_access_problem(status=rules.PENDING, owner="v", user="u", any_cheque=False))
        self.assertIsNone(edit_rules.edit_access_problem(status=rules.ISSUED, owner="v", user="u", any_cheque=True))


class TestOldTypeChequeEdit(unittest.TestCase):
    """An Old-type cheque (spec #1477) changes only its photo, whatever its status."""

    BEFORE = {"bank": "ICICI Bank", "cheque_no": "1", "cheque_date": "2026-10-14", "amount": 100,
              "payee_name": "Ravi Kumar", "attachment": "old.jpg"}

    def _problem(self, after, *, lines_after=None, status=rules.ISSUED):
        lines = [rules.parse_line({"line_type": rules.LINE_NON_PROJECT_EXPENSE, "payment_name": "NPE-1",
                                   "amount": 100})]
        return edit_rules.edit_problem(
            rules.parse_header(self.BEFORE), rules.parse_header({**self.BEFORE, **after}),
            status=status, old_type=True,
            lines_before=lines, lines_after=lines if lines_after is None else lines_after,
        )

    def test_its_photo_may_be_replaced(self):
        for status in (rules.ISSUED, rules.CLEARED, rules.CANCELLED):
            self.assertIsNone(self._problem({"attachment": "new.jpg"}, status=status))

    def test_any_other_change_is_refused(self):
        expected = "Cheque 1 is an Old-type cheque: only its photo can change."
        self.assertEqual(self._problem({"cheque_no": "2"}), expected)
        self.assertEqual(self._problem({"payee_name": "Ravi K"}), expected)
        self.assertEqual(self._problem({"description": "Rent"}), expected)
        self.assertEqual(self._problem({}, lines_after=[]), expected)

    def test_its_photo_still_cannot_be_removed(self):
        self.assertEqual(self._problem({"attachment": ""}), "The cheque's photo can be replaced, not removed.")
