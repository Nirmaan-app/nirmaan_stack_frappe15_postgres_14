# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An unpaired card refund: kept on the card import's Review and created as a negative Paid Non-Project Expense
(#1673, spec #1653, ADR-0039 Amendment D).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_card_refunds

Uploads the fixture statement as a PDF through the real endpoint (`test_card_import.CardImportCase`). Its one
unpaired merchant credit is the MakeMyTrip ₹801.50 line. Every test reads back what a user sees: the Review
payload, the main table, the Expenses written, the payments dashboard, the Credit Card invoice queue and the
Expense bill lists.
"""

from unittest.mock import patch

import frappe

from nirmaan_stack.api.expenses import card_invoices
from nirmaan_stack.api.expenses.all_expense_bills import get_all_expense_bills
from nirmaan_stack.api.expenses.paid_invoice import set_paid_expense_invoice
from nirmaan_stack.api.outflow_import import card_import, card_review
from nirmaan_stack.api.outflow_import.review import SCOPE_NOT_MATCHED_INFLOW, get_outflow_rows
from nirmaan_stack.api.outflow_import.test_card_create import (
    EXPENSE,
    HOTEL,
    CardCreateCase,
    _purge_what_the_delete_left,
)
from nirmaan_stack.api.outflow_import.test_card_import import purge_records
from nirmaan_stack.api.outflow_import.test_card_suggest import FOOD
from nirmaan_stack.api.payments import get_project_payment_summary
from nirmaan_stack.services.outflow_import.card_credits import CARD_REFUND_REFUSAL
from nirmaan_stack.services.outflow_import.settle import create_expense_from_row

REFUND_DETAILS = "MAKEMYTRIP(INDIA) P Gurgaon IN"
NON_PROJECT_INFLOW = "Non Project Inflows"
REFUND_AMOUNT = 801.50


def _purge_inflow(inflow: str) -> None:
    frappe.db.rollback()
    files = frappe.get_all("File", filters={"attached_to_doctype": NON_PROJECT_INFLOW, "attached_to_name": inflow},
                           pluck="name")
    purge_records("File", files)
    purge_records(NON_PROJECT_INFLOW, [inflow])


class CardRefundCase(CardCreateCase):
    def _refund_line(self):
        [line] = [
            row for row in self._rows(self.batch) if row.remarks == REFUND_DETAILS and row.direction == "Credit"
        ]
        return line

    def _shown_refund(self, review=None):
        review = review or self._review()
        [line] = [item for item in review["lines"] if item["is_credit"] and item["details"] == REFUND_DETAILS]
        return line


class TestTheRefundStaysOnTheCardImport(CardRefundCase):
    def test_it_is_create_work_and_not_on_the_main_table(self):
        self.assertEqual(self._refund_line().row_status, "Pending match run")
        inflow = get_outflow_rows(scope=SCOPE_NOT_MATCHED_INFLOW, batch=self.batch)
        self.assertEqual(inflow["rows"], [])

    def test_review_lists_it_as_a_refund_with_a_type_it_may_change(self):
        shown = self._shown_refund()
        self.assertTrue(shown["is_refund"])
        self.assertEqual(shown["amount"], REFUND_AMOUNT)
        self.assertEqual((shown["expense_type"], shown["check"], shown["editable"]), ("Misc. Expenses", True, True))
        self.assertEqual(shown["merchant"], "MAKEMYTRIP")
        review = self._review()
        self.assertEqual((review["spends_to_create"], review["refunds_to_create"]), (40, 1))


class TestCreateRecordsTheRefund(CardRefundCase):
    def setUp(self):
        super().setUp()
        self._press_create()
        self._run_create()
        self.line = self._refund_line()
        self.expense = frappe.get_doc(EXPENSE, self.line.suggested_name)

    def test_it_is_a_paid_non_project_expense_of_minus_its_amount(self):
        self.assertEqual(self.line.row_status, "Settled")
        self.assertEqual((self.expense.status, float(self.expense.amount)), ("Paid", -REFUND_AMOUNT))
        self.assertEqual(self.expense.type, "Misc. Expenses")
        self.assertEqual(self.expense.description, f"Card refund from MAKEMYTRIP, {self.holder}'s card")
        self.assertEqual(self.expense.payment_ref, f"{REFUND_DETAILS} - {self.line.transfer_id}")
        self.assertEqual(self.expense.credit_card_statement, self.statement)
        self.assertFalse(self.expense.invoice_attachment)

    def test_review_reports_every_spend_and_the_refund_created(self):
        review = self._review()
        self.assertEqual((review["created"], review["to_create"]), (41, 0))
        self.assertEqual((review["spends_to_create"], review["refunds_to_create"]), (0, 0))
        self.assertEqual(self._shown_refund(review)["expense"], self.expense.name)

    def test_the_spends_total_is_unchanged_and_the_refund_balances_it(self):
        amounts = [float(e.amount) for e in self._expenses()]
        self.assertEqual(round(sum(a for a in amounts if a > 0), 2), 137584.99)
        self.assertEqual(round(sum(amounts), 2), round(137584.99 - REFUND_AMOUNT, 2))


class TestTheRefundsTypeIsItsOwn(CardRefundCase):
    def test_review_may_retype_the_refund_alone(self):
        line = self._refund_line()
        review = card_review.set_card_expense_type(self.batch, [line.name], HOTEL)
        shown = self._shown_refund(review)
        self.assertEqual((shown["expense_type"], shown["check"]), (HOTEL, False))
        # MakeMyTrip's spends keep theirs.
        spends = [item for item in review["lines"] if item["merchant"] == "MAKEMYTRIP" and not item["is_credit"]]
        self.assertTrue(spends)
        self.assertEqual({item["expense_type"] for item in spends}, {"Misc. Expenses"})

    def test_the_refund_never_teaches_the_merchant_memory(self):
        card_review.set_card_expense_type(self.batch, [self._refund_line().name], HOTEL)
        self._press_create()
        self._run_create()
        # The spends taught it, at the type they were created with; the refund's Hotel did not.
        self.assertEqual(frappe.db.get_value("Card Merchant Memory", "MAKEMYTRIP", "expense_type"), "Misc. Expenses")
        # Retyping the refund's Expense afterwards teaches nothing either.
        expense = frappe.get_doc(EXPENSE, self._refund_line().suggested_name)
        self.assertEqual(expense.type, HOTEL)
        expense.type = FOOD
        expense.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("Card Merchant Memory", "MAKEMYTRIP", "expense_type"), "Misc. Expenses")


class TestTheRefundNeedsNoBill(CardRefundCase):
    def setUp(self):
        super().setUp()
        self._press_create()
        self._run_create()
        self.expense = self._refund_line().suggested_name

    def test_it_is_not_in_the_credit_card_invoice_queue(self):
        queued = {row["name"] for row in card_invoices.get_card_invoice_queue()}
        self.assertNotIn(self.expense, queued)
        spend = next(row for row in self._rows(self.batch) if row.direction == "Debit").suggested_name
        self.assertIn(spend, queued)

    def test_no_invoice_and_attach_are_refused_on_it(self):
        with self.assertRaises(frappe.ValidationError):
            card_invoices.mark_card_no_invoice(self.expense, "money came back")
        frappe.db.rollback()
        with self.assertRaises(frappe.ValidationError):
            card_invoices.attach_card_invoice(self.expense, "https://storage.example/credit-note.pdf")
        frappe.db.rollback()
        self.assertEqual(
            frappe.db.get_value(EXPENSE, self.expense, ["no_invoice_by", "invoice_attachment"]), (None, None)
        )

    def test_an_invoice_added_on_the_expense_page_is_no_expense_bill(self):
        url = f"https://storage.example/refund-{frappe.generate_hash(length=8)}.pdf"
        file = frappe.get_doc({"doctype": "File", "file_url": url, "file_name": "refund.pdf", "is_private": 1})
        file.insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(purge_records, "File", [file.name])
        with patch.object(frappe, "enqueue"):
            set_paid_expense_invoice(EXPENSE, self.expense, url, "CN-1", frappe.utils.nowdate())
        self.assertFalse(frappe.db.exists("Expense Bill", {"expense": self.expense}))
        listed = get_all_expense_bills(filters=[["kind", "=", "card"]], limit_page_length=500)["data"]
        self.assertNotIn(self.expense, {row["expense"] for row in listed})


class TestTheRefundLowersNonProjectSpend(CardRefundCase):
    def _non_project_figure(self):
        with patch.object(get_project_payment_summary, "today", return_value="2026-10-05"):
            stats = get_project_payment_summary.get_payment_dashboard_stats()
        return round(float(stats["total_non_project_expense_30_days_amount"]), 2)

    def test_the_dashboard_figure_drops_by_exactly_the_refund(self):
        before = self._non_project_figure()
        card_review.set_card_expense_type(self.batch, [self._refund_line().name], HOTEL)
        spends = [row.name for row in self._rows(self.batch) if row.direction == "Debit"]
        # Only the refund is created, so the figure moves by it alone: the spends are set aside first (raw, a
        # test fixture move; the lines carry no doc_events).
        frappe.db.set_value("Outflow Import Row", {"name": ["in", spends]}, "row_status", "Skipped")
        frappe.db.commit()
        self._press_create()
        self._run_create()
        self.assertEqual(self._non_project_figure(), round(before - REFUND_AMOUNT, 2))


class TestUnreconcilingTheRefund(CardRefundCase):
    def test_it_reopens_on_review_and_create_records_it_again(self):
        from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row

        self._press_create()
        self._run_create()
        line = self._refund_line()
        first = line.suggested_name
        unreconcile_row(row=line.name, legs="all", reason="wrong refund")
        self.addCleanup(_purge_what_the_delete_left, first)

        self.assertFalse(frappe.db.exists(EXPENSE, first))
        shown = self._shown_refund()
        self.assertTrue(shown["editable"])
        self.assertEqual(self._review()["refunds_to_create"], 1)
        self.assertEqual(get_outflow_rows(scope=SCOPE_NOT_MATCHED_INFLOW, batch=self.batch)["rows"], [])

        self._press_create()
        self._run_create()
        again = self._refund_line()
        self.assertEqual(again.row_status, "Settled")
        self.assertNotEqual(again.suggested_name, first)
        self.assertEqual(float(frappe.db.get_value(EXPENSE, again.suggested_name, "amount")), -REFUND_AMOUNT)


class TestDiscardRemovesTheRefund(CardRefundCase):
    def test_discard_before_create_removes_it_with_the_spends(self):
        line = self._refund_line()
        card_import.discard_card_import(self.batch)
        self.assertFalse(frappe.db.exists("Outflow Import Row", line.name))


class TestNoOtherCallerWritesANegativeExpense(CardRefundCase):
    def test_a_zero_or_negative_line_is_still_refused(self):
        from nirmaan_stack.api.outflow_import.review import StagedRow

        for amount in (0, -REFUND_AMOUNT):
            row = StagedRow(frappe._dict(self._refund_line(), amount=amount))
            with self.subTest(amount=amount), self.assertRaises(frappe.ValidationError):
                create_expense_from_row(row, doctype=EXPENSE, expense_type="Misc. Expenses", actor="Administrator")
            with self.subTest(amount=amount, card_refund=True), self.assertRaises(frappe.ValidationError):
                create_expense_from_row(
                    row, doctype=EXPENSE, expense_type="Misc. Expenses", actor="Administrator",
                    credit_card_statement=self.statement, card_refund=True,
                )

    def test_a_card_refund_without_its_statement_is_refused(self):
        from nirmaan_stack.api.outflow_import.review import StagedRow

        row = StagedRow(self._refund_line())
        with self.assertRaises(frappe.ValidationError):
            create_expense_from_row(
                row, doctype=EXPENSE, expense_type="Misc. Expenses", actor="Administrator", card_refund=True
            )
        frappe.db.rollback()
        self.assertFalse(frappe.db.exists(EXPENSE, {"payment_ref": self._refund_line().settlement_reference}))


class TestTheMainTableRefusesTheRefund(CardRefundCase):
    def test_skip_and_every_record_action_are_refused(self):
        from nirmaan_stack.api.outflow_import.expenses import guard_not_an_own_import_line
        from nirmaan_stack.api.outflow_import.review import skip_row

        line = self._refund_line()
        with self.assertRaises(frappe.ValidationError) as caught:
            skip_row(line.name, "not ours")
        self.assertIn(CARD_REFUND_REFUSAL, str(caught.exception))
        frappe.db.rollback()
        with self.assertRaises(frappe.ValidationError) as caught:
            guard_not_an_own_import_line(frappe.db.get_value("Outflow Import Row", line.name, "*", as_dict=True))
        self.assertIn(CARD_REFUND_REFUSAL, str(caught.exception))
        self.assertEqual(self._refund_line().row_status, "Pending match run")


class TestSuggestionTypesTheRefund(CardRefundCase):
    def test_the_merchants_remembered_type_reaches_the_refund(self):
        from nirmaan_stack.api.outflow_import import card_suggest

        frappe.get_doc({"doctype": "Card Merchant Memory", "merchant": "MAKEMYTRIP", "expense_type": HOTEL}).insert(
            ignore_permissions=True
        )
        frappe.db.commit()
        with patch.object(card_suggest, "get_extraction_settings", return_value={"enabled": False}):
            card_suggest.suggest_card_types(self.batch)
        shown = self._shown_refund()
        self.assertEqual((shown["expense_type"], shown["type_source"], shown["check"]), (HOTEL, "Earlier statement", False))


class TestThePatchMovesOldOpenCreditsBack(CardRefundCase):
    """The one-time patch (`patches/v3_0/card_credits_to_unpaired_refunds`), scoped to this test's import so the
    env's own data is never touched: an open credit from before #1673 goes back to its import as a refund; a
    decided one, and an auto-debit sent back to Mismatched, stay where they are."""

    _PLAN = {"match_basis": None, "suggested_doctype": None, "auto_matched": 0, "suggested_expense_type": None,
             "type_source": None}

    def setUp(self):
        super().setUp()
        rows = self._rows(self.batch)
        self.refund = self._refund_line()
        # As #1567 staged it: open at Mismatched, with no plan.
        frappe.db.set_value("Outflow Import Row", self.refund.name, {**self._PLAN, "row_status": "Mismatched"})
        self.cashback = next(row for row in rows if row.skip_kind == "Card cashback")
        self.auto_debit = next(row for row in rows if row.row_status == "Internal Transfer")
        # An auto-debit sent back to Mismatched by hand: open, no plan, and no refund.
        frappe.db.set_value("Outflow Import Row", self.auto_debit.name, "row_status", "Mismatched")
        frappe.db.commit()

    def _run(self, jobs=None):
        from nirmaan_stack.patches.v3_0.card_credits_to_unpaired_refunds import move_open_card_credits

        queued = [] if jobs is None else jobs
        with patch.object(frappe, "enqueue", side_effect=lambda method, **kw: queued.append((method, kw))):
            return move_open_card_credits(batches=[self.batch])

    def _state(self, name):
        return frappe.db.get_value("Outflow Import Row", name, ["row_status", "match_basis", "type_source",
                                                                "suggested_expense_type", "modified"], as_dict=True)

    def test_the_open_credit_is_a_refund_waiting_for_create(self):
        self.assertEqual(len(get_outflow_rows(scope=SCOPE_NOT_MATCHED_INFLOW, batch=self.batch)["rows"]), 2)
        self._run()
        state = self._state(self.refund.name)
        self.assertEqual((state.row_status, state.match_basis, state.type_source, state.suggested_expense_type),
                         ("Pending match run", "card statement", "Fallback", "Misc. Expenses"))
        review = self._review()
        self.assertEqual(review["refunds_to_create"], 1)
        self.assertTrue(self._shown_refund(review)["editable"])

    def test_a_decided_credit_and_a_sent_back_auto_debit_stay(self):
        before = [self._state(self.cashback.name), self._state(self.auto_debit.name)]
        self._run()
        self.assertEqual([self._state(self.cashback.name), self._state(self.auto_debit.name)], before)
        rows = get_outflow_rows(scope=SCOPE_NOT_MATCHED_INFLOW, batch=self.batch)["rows"]
        self.assertEqual([row["name"] for row in rows], [self.auto_debit.name])

    def test_the_suggestion_is_queued_once_for_the_import_and_types_the_refund(self):
        from nirmaan_stack.api.outflow_import import card_suggest

        frappe.get_doc({"doctype": "Card Merchant Memory", "merchant": "MAKEMYTRIP", "expense_type": HOTEL}).insert(
            ignore_permissions=True
        )
        frappe.db.commit()
        jobs = []
        self._run(jobs)
        self.assertEqual([kw["job_id"] for _, kw in jobs], [card_import.suggest_job_id(self.batch)])
        self.assertTrue(jobs[0][1]["deduplicate"])
        method, kw = jobs[0]
        with patch.object(card_suggest, "get_extraction_settings", return_value={"enabled": False}):
            frappe.get_attr(method)(batch=kw["batch"])
        shown = self._shown_refund()
        self.assertEqual((shown["expense_type"], shown["type_source"], shown["check"]), (HOTEL, "Earlier statement", False))

    def test_a_run_that_moves_nothing_queues_nothing(self):
        self._run()
        jobs = []
        self._run(jobs)
        self.assertEqual(jobs, [])

    def test_a_credit_recorded_as_a_non_project_inflow_on_the_main_table_stays(self):
        from nirmaan_stack.api.outflow_import.inflows import create_non_project_inflow

        summary = create_non_project_inflow(row=self.refund.name, inflow_type="FD Closures")
        inflow = summary["settled"]["name"]
        self.addCleanup(_purge_inflow, inflow)
        before = self._state(self.refund.name)
        self.assertEqual(before.row_status, "Settled")
        self.assertEqual(self._run(), [])
        self.assertEqual(self._state(self.refund.name), before)
        self.assertTrue(frappe.db.exists("Outflow Row Match", {"import_row": self.refund.name, "target_name": inflow}))

    def test_a_credit_skipped_by_hand_on_the_main_table_stays(self):
        from nirmaan_stack.api.outflow_import.review import skip_row

        skip_row(self.refund.name, "a refund we keep off the books")
        before = self._state(self.refund.name)
        self.assertEqual(before.row_status, "Skipped")
        self.assertEqual(self._run(), [])
        self.assertEqual(self._state(self.refund.name), before)
        self.assertEqual(frappe.db.get_value("Outflow Import Row", self.refund.name, "skip_origin"), "Manual")

    def test_an_open_credit_with_a_pick_is_left_and_named(self):
        frappe.db.set_value("Outflow Import Row", self.refund.name, "suggested_name", "NPI-PICKED-BY-HAND")
        frappe.db.commit()
        before = self._state(self.refund.name)
        with patch("builtins.print") as printed:
            self.assertEqual(self._run(), [])
        self.assertEqual(self._state(self.refund.name), before)
        self.assertIn(self.refund.name, " ".join(str(call.args[0]) for call in printed.call_args_list))

    def test_a_second_run_changes_nothing(self):
        self._run()
        after_first = [self._state(row.name) for row in self._rows(self.batch)]
        self.assertEqual(self._run(), [])
        self.assertEqual([self._state(row.name) for row in self._rows(self.batch)], after_first)
