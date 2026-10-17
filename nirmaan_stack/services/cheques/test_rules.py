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
        self.assertIn(rules.BANK_MATCH_BASIS, _options("outflow_row_match", "match_basis"))

    def test_a_cheque_saved_with_no_status_starts_pending(self):
        # A new Payment cheque waits for its payments' approval (spec #1477); a deposit sets Issued itself.
        self.assertEqual(_field("cheques", "status").get("default"), rules.PENDING)

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


class TestReadyToIssue(unittest.TestCase):
    """A Pending Payment cheque is Issued in the step that moves its last payment on to Reconciliation
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
        self.assertIsNone(rules.cheque_mode_problem(rules.PO_DOCTYPE))
        self.assertEqual(
            rules.cheque_mode_problem(rules.WORK_ORDER_DOCTYPE),
            "A Work Order payment is paid Online: only a PO payment can be paid by cheque.",
        )

    def test_an_online_payment_is_never_refused(self):
        for action in rules.CHEQUE_PAYMENT_ACTIONS:
            self.assertIsNone(rules.cheque_payment_problem("PAY-1", action, is_cheque=False))

    def test_hold_revert_and_split_each_refuse_a_cheque_payment_saying_why(self):
        self.assertEqual(
            rules.cheque_payment_problem("PAY-1", rules.CHEQUE_REFUSES_HOLD, is_cheque=True, cheque_no="000747"),
            "PAY-1 is paid by cheque 000747, so it cannot be put on hold: a cheque's payments move together. "
            "Cancel the cheque in the Cheque Tracker instead.",
        )
        self.assertEqual(
            rules.cheque_payment_problem("PAY-1", rules.CHEQUE_REFUSES_REVERT, is_cheque=True, cheque_no="000747"),
            "PAY-1 is paid by cheque 000747, so it cannot go back to Approved: a cheque's payments move together. "
            "Cancel the cheque in the Cheque Tracker instead.",
        )
        self.assertEqual(
            rules.cheque_payment_problem("PAY-1", rules.CHEQUE_REFUSES_SPLIT, is_cheque=True, cheque_no="000747"),
            "PAY-1 is paid by cheque 000747, so it cannot be split: a cheque pays its payments in full or not "
            "at all.",
        )

    def test_a_cheque_payment_with_no_number_still_refuses(self):
        self.assertTrue(
            rules.cheque_payment_problem("PAY-1", rules.CHEQUE_REFUSES_HOLD, is_cheque=True).startswith(
                "PAY-1 is paid by cheque, so it cannot be put on hold"
            )
        )

    def test_an_unknown_action_is_a_bug(self):
        with self.assertRaises(KeyError):
            rules.cheque_payment_problem("PAY-1", "delete", is_cheque=True)


class TestModeChange(unittest.TestCase):
    """A payment's Mode of Payment changes only through a Cheque (spec #1407)."""

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

    def test_only_a_pending_cheque_s_payment_line_may_come_off(self):
        # #1482: a Payment cheque's lines change only while Pending; Issued and on, only the photo.
        header = rules.parse_header({"bank": "ICICI Bank", "cheque_no": "1", "cheque_date": "2026-10-14",
                                     "amount": 100, "vendor": "V", "attachment": "x"})
        for made_from in rules.MADE_FROM:
            self.assertIsNone(rules.edit_problem(
                header, header, status=rules.PENDING, made_from=made_from,
                lines_before=[self._line(rules.LINE_PO_WO_PAYMENT, "PAY-1")], lines_after=[],
            ))
        for status in (rules.ISSUED, rules.CLEARED, rules.CANCELLED):
            self.assertIn(f"is {status}: only its photo can change", rules.edit_problem(
                header, header, status=status, made_from=rules.MADE_FROM_REPORT,
                lines_before=[self._line(rules.LINE_PO_WO_PAYMENT, "PAY-1")], lines_after=[],
            ))

    def test_procurement_edits_only_its_own_pending_cheques(self):
        # C6 (#1482): lines lock once Issued, so Procurement's edits stop there too.
        self.assertIsNone(rules.edit_access_problem(status=rules.PENDING, owner="u", user="u", any_cheque=False))
        for status in (rules.ISSUED, rules.CLEARED):
            self.assertIn("only the Pending cheques you created",
                          rules.edit_access_problem(status=status, owner="u", user="u", any_cheque=False))
        self.assertIsNotNone(rules.edit_access_problem(status=rules.PENDING, owner="v", user="u", any_cheque=False))
        self.assertIsNone(rules.edit_access_problem(status=rules.ISSUED, owner="v", user="u", any_cheque=True))

    # The amount is left out: `flt(..., 2)` needs a site, so with no DB every amount reads 0.0.
    # `api/cheques/test_cheque_edit` covers it.
    def test_a_po_page_cheque_keeps_its_number_and_date_while_a_payment_is_on_it(self):
        before = rules.parse_header({"bank": "ICICI Bank", "cheque_no": "1", "cheque_date": "2026-10-14",
                                     "amount": 100, "vendor": "V", "attachment": "x"})
        after = rules.parse_header({"bank": "ICICI Bank", "cheque_no": "2", "cheque_date": "2026-10-15",
                                    "amount": 100, "vendor": "V", "attachment": "x"})
        on_it = [self._line(rules.LINE_PO_WO_PAYMENT, "PAY-1")]
        self.assertIn("so its number and date cannot change here", rules.edit_problem(
            before, after, status=rules.PENDING, made_from=rules.MADE_FROM_PO_WO_PAGE,
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
                before, after, status=rules.PENDING, made_from=rules.MADE_FROM_PO_WO_PAGE,
                lines_before=lines, lines_after=lines,
            ))


def _tracker_line(line_type=rules.LINE_PO_WO_PAYMENT, record_doctype=rules.PO_DOCTYPE, payment=None,
                  status=None, on_hold=False, added=True):
    line = rules.parse_line({"line_type": line_type, "project": "P", "record_doctype": record_doctype,
                             "record_name": "R-1", "payment_name": payment, "amount": 100})
    return rules.TrackerLine(line=line, added=added, payment_status=status, on_hold=on_hold)


class TestTrackerPaymentCheque(unittest.TestCase):
    """What the Cheque Tracker's Add and Edit take on a Payment cheque (#1482, spec #1477): a Vendor payee,
    PO lines only, at least one, and payments picked at Requested, CEO Pending or Approved, all at one step."""

    VENDOR = rules.parse_header({"bank": "ICICI Bank", "cheque_no": "1", "cheque_date": "2026-10-14",
                                 "amount": 100, "vendor": "V", "attachment": "x"})

    def _problem(self, lines, header=None):
        return rules.tracker_payment_cheque_problem(header or self.VENDOR, lines)

    def test_po_lines_across_records_with_payments_at_one_step_are_taken(self):
        self.assertIsNone(self._problem([
            _tracker_line(payment="PAY-1", status="Requested"),
            _tracker_line(payment="PAY-2", status="Requested"),
            _tracker_line(),  # no payment yet
        ]))
        self.assertIsNone(self._problem([_tracker_line(payment="PAY-1", status="Approved")]))

    def test_a_typed_payee_is_refused(self):
        typed = rules.parse_header({"bank": "ICICI Bank", "cheque_no": "1", "cheque_date": "2026-10-14",
                                    "amount": 100, "payee_name": "Tata Power", "attachment": "x"})
        self.assertIn("made out to a Vendor", self._problem([_tracker_line()], header=typed))

    def test_no_lines_is_refused(self):
        self.assertIn("at least one PO payment", self._problem([]))

    def test_a_work_order_or_expense_line_is_refused(self):
        self.assertIn("Line 2: a Payment cheque pays PO payments only", self._problem(
            [_tracker_line(), _tracker_line(record_doctype=rules.WORK_ORDER_DOCTYPE)]))
        self.assertIn("Line 1: a Payment cheque pays PO payments only", self._problem(
            [_tracker_line(line_type=rules.LINE_NON_PROJECT_EXPENSE, record_doctype=None, payment="NPE-1")]))

    def test_a_work_order_line_already_on_the_cheque_stays(self):
        # A Work Order cheque in flight before #1477 finishes as it is.
        self.assertIsNone(self._problem([_tracker_line(record_doctype=rules.WORK_ORDER_DOCTYPE, added=False)]))

    def test_a_payment_past_approval_or_rejected_is_refused(self):
        for status in ("Reconciliation Pending", "Paid", "Rejected"):
            self.assertIn(f"Line 1: payment PAY-1 is {status}", self._problem(
                [_tracker_line(payment="PAY-1", status=status)]))

    def test_a_held_payment_is_refused(self):
        self.assertIn("Line 1: payment PAY-1 is on hold", self._problem(
            [_tracker_line(payment="PAY-1", status="Approved", on_hold=True)]))

    def test_payments_at_two_steps_are_refused(self):
        self.assertIn("same step: PAY-1 is Requested, PAY-2 is Approved", self._problem([
            _tracker_line(payment="PAY-1", status="Requested"),
            _tracker_line(payment="PAY-2", status="Approved"),
        ]))
        # A payment added beside one already on the cheque at another step.
        self.assertIn("same step", self._problem([
            _tracker_line(payment="PAY-1", status="CEO Pending", added=False),
            _tracker_line(payment="PAY-2", status="Requested"),
        ]))

    @staticmethod
    def _header(amount):
        # Built directly: `parse_header` rounds through Frappe, which reads 0 with no site (`DEVENV unit`).
        return rules.ChequeHeader(bank="ICICI Bank", bank_name=None, cheque_no="1", cheque_date="2026-10-14",
                                  amount=amount, vendor="V", payee_name=None, description=None, attachment="x")

    @staticmethod
    def _paid_line(payment, status, amount=100.0):
        line = rules.ChequeLineInput(line_type=rules.LINE_PO_WO_PAYMENT, project="P", record_doctype=rules.PO_DOCTYPE,
                                     record_name="R-1", payment_doctype=rules.PAYMENT_DOCTYPE if payment else None,
                                     payment_name=payment, amount=amount)
        return rules.TrackerLine(line=line, added=True, payment_status=status)

    def test_approved_payments_beside_a_line_with_no_payment_yet_are_refused(self):
        # Approved payments issue the cheque at once, so a "No payment yet" line would leave it Pending
        # while they move on alone.
        problem = self._problem([self._paid_line("PAY-1", "Approved"), self._paid_line(None, None)],
                                header=self._header(200))
        self.assertIn("Line 2", problem)
        self.assertIn("no payment yet", problem)

    def test_approved_payments_that_do_not_add_up_to_the_cheque_are_refused(self):
        problem = self._problem([self._paid_line("PAY-1", "Approved"), self._paid_line("PAY-2", "Approved")],
                                header=self._header(250))
        self.assertIn("₹200", problem)
        self.assertIn("₹250", problem)

    def test_approved_payments_within_five_rupees_of_the_cheque_are_taken(self):
        self.assertIsNone(self._problem(
            [self._paid_line("PAY-1", "Approved"), self._paid_line("PAY-2", "Approved")], header=self._header(204)))

    def test_waiting_payments_need_not_add_up_yet(self):
        # They are approved later, together, and the approval checks the amount then.
        self.assertIsNone(self._problem([self._paid_line("PAY-1", "Requested"), self._paid_line(None, None)],
                                        header=self._header(999)))

    def test_payments_already_on_it_are_not_re_judged(self):
        # An edit that adds no payment leaves the ones on it alone, whatever step they reached.
        self.assertIsNone(self._problem([
            _tracker_line(payment="PAY-1", status="Requested", added=False),
            _tracker_line(payment="PAY-2", status="Reconciliation Pending", added=False),
            _tracker_line(),
        ]))


class TestOldTypeChequeEdit(unittest.TestCase):
    """An Old-type cheque (spec #1477) changes only its photo, whatever its status."""

    BEFORE = {"bank": "ICICI Bank", "cheque_no": "1", "cheque_date": "2026-10-14", "amount": 100,
              "payee_name": "Ravi Kumar", "attachment": "old.jpg"}

    def _problem(self, after, *, lines_after=None, status=rules.ISSUED):
        lines = [rules.parse_line({"line_type": rules.LINE_NON_PROJECT_EXPENSE, "payment_name": "NPE-1",
                                   "amount": 100})]
        return rules.edit_problem(
            rules.parse_header(self.BEFORE), rules.parse_header({**self.BEFORE, **after}),
            status=status, made_from=rules.MADE_FROM_REPORT, old_type=True,
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
