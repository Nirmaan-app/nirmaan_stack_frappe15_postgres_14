# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Bill check on the Project Expenses and Non-Project Expenses lists (#1640, spec #1637, GLOSSARY *Expense bills*).

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_expense_bill_list`. A bill is attached in a Pending
Invoices Upload tab and read through the replaced reader (`expense_bills.reading.read_bill`); then the lists' endpoint
(`api/data-table.get_list_with_count_enhanced`, as the list pages call it) shows the Expense's latest bill's Bill
check and approval, and filters by them with server-side paging.
"""

import json
from datetime import date
from decimal import Decimal

import frappe

from nirmaan_stack.api.data_table.facets import get_facet_values_impl
from nirmaan_stack.api.data_table.search import get_list_with_count_enhanced_impl
from nirmaan_stack.api.expenses.card_invoices import attach_card_invoice
from nirmaan_stack.api.expenses.cashbook_invoices import attach_cashbook_invoice
from nirmaan_stack.api.expenses.expense_bill_approval import reject_expense_bill
from nirmaan_stack.api.expenses.test_cashbook_invoices import PE, CashbookInvoiceCase
from nirmaan_stack.api.expenses.test_expense_bills import NPE, CardBillCase, FakeReader, bills_of, run_reading
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT
from nirmaan_stack.cloud_file_fixture import cloud_url
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE as BILL
from nirmaan_stack.services.expense_bills.bill_check import BillRead, ReadFailed

#: The "no Expense bill" choice: the data table's "not set" facet value (`facetConfig.ts` NOT_SET_FACET_VALUE).
NO_BILL = "__NOT_SET__"
LIST_FIELDS = ["name", "amount", "bill_check", "bill_approval"]


class CardSpendOnTheListCase(CardBillCase):
    """A card spend whose bill is attached; the Non-Project Expenses list read as an Accountant."""

    def setUp(self):
        super().setUp()
        self.accountant = self.users.make(ACCOUNTANT)
        # `_Users` sets the profile only; the list reads through Frappe's permissions, which need the role.
        frappe.get_doc("User", self.accountant).add_roles("Nirmaan Accountant")
        frappe.db.commit()

    def _list(self, *filters, doctype=NPE, start=0, page=50) -> dict:
        """The list's page, scoped to this test's Expenses, as the Accountant reads it: {"rows", "total"}."""
        result = self._as(
            self.accountant, get_list_with_count_enhanced_impl,
            doctype=doctype, fields=json.dumps(LIST_FIELDS),
            filters=json.dumps([["name", "in", self.expenses], *filters]),
            order_by="name asc", limit_start=start, limit_page_length=page,
        )
        return {"rows": {r["name"]: r for r in result["data"]}, "total": result["total_count"]}


class TestTheBillCheckColumn(CardSpendOnTheListCase):
    def test_a_mismatched_bill_shows_mismatched_and_pending(self):
        _, bill = self._attach()
        run_reading(bill, FakeReader(BillRead(Decimal("1250.00"), "INV-9", date(2026, 9, 9))))

        row = self._list()["rows"][self.spend]

        self.assertEqual((row["bill_check"], row["bill_approval"]), ("Mismatched", "Pending"))

    def test_a_matched_bill_shows_matched_and_auto_approved(self):
        _, bill = self._attach()
        run_reading(bill, FakeReader(BillRead(Decimal("1180.40"), "INV-9", date(2026, 9, 9))))

        row = self._list()["rows"][self.spend]

        self.assertEqual((row["bill_check"], row["bill_approval"]), ("Matched", "Auto-approved"))

    def test_a_bill_still_being_read_shows_checking_and_pending(self):
        self._attach()

        row = self._list()["rows"][self.spend]

        self.assertEqual((row["bill_check"], row["bill_approval"]), ("Checking", "Pending"))

    def test_a_bill_whose_reading_stopped_shows_not_read(self):
        _, bill = self._attach()
        frappe.db.set_value(BILL, bill, "read_claimed_at", "2026-01-01 00:00:00")  # claimed long ago, never back
        frappe.db.commit()

        row = self._list()["rows"][self.spend]

        self.assertEqual((row["bill_check"], row["bill_approval"]), ("Not read", "Pending"))

    def test_a_rejected_bill_shows_its_result_and_rejected(self):
        _, bill = self._attach()
        run_reading(bill, FakeReader(ReadFailed("The reader timed out.")))
        self._as(self.accountant, reject_expense_bill, bill, reason="Wrong shop")

        row = self._list()["rows"][self.spend]

        self.assertEqual((row["bill_check"], row["bill_approval"]), ("Not read", "Rejected"))

    def test_only_the_latest_bill_counts(self):
        _, first = self._attach()
        run_reading(first, FakeReader(ReadFailed("The reader timed out.")))
        self._as(self.accountant, reject_expense_bill, first, reason="Wrong shop")
        self._attach()  # a new bill, still being read

        row = self._list()["rows"][self.spend]

        self.assertEqual((row["bill_check"], row["bill_approval"]), ("Checking", "Pending"))

    def test_an_expense_with_no_expense_bill_shows_none(self):
        row = self._list()["rows"][self.spend]

        self.assertEqual((row["bill_check"], row["bill_approval"]), (None, None))


class TestTheBillCheckFilters(CardSpendOnTheListCase):
    """Three spends: one Mismatched and Pending, one Not read and Rejected, one with no Expense bill."""

    def setUp(self):
        super().setUp()
        self.mismatched = self.spend
        _, bill = self._attach()
        run_reading(bill, FakeReader(BillRead(Decimal("1250.00"), "INV-9", date(2026, 9, 9))))
        self.rejected = self._expense(self.statement, serno="70000000002", amount=500)
        self._as(self.accountant, attach_card_invoice, self.rejected, cloud_url("other.pdf"))
        bill = bills_of(NPE, self.rejected)[-1].name
        run_reading(bill, FakeReader(ReadFailed("The reader timed out.")))
        self._as(self.accountant, reject_expense_bill, bill, reason="Wrong shop")
        self.no_bill = self._expense(self.statement, serno="70000000003", amount=300)

    def test_filtering_by_the_result_lists_only_those_expenses(self):
        page = self._list(["bill_check", "in", ["Mismatched"]])

        self.assertEqual((set(page["rows"]), page["total"]), ({self.mismatched}, 1))

    def test_filtering_by_the_approval_lists_only_those_expenses(self):
        page = self._list(["bill_approval", "in", ["Rejected", "Approved"]])

        self.assertEqual((set(page["rows"]), page["total"]), ({self.rejected}, 1))

    def test_the_no_bill_choice_lists_the_expenses_with_no_expense_bill(self):
        page = self._list(["bill_check", "in", [NO_BILL, "Mismatched"]])

        self.assertEqual((set(page["rows"]), page["total"]), ({self.no_bill, self.mismatched}, 2))

    def test_both_filters_together_narrow_to_what_both_allow(self):
        page = self._list(["bill_check", "in", ["Mismatched", "Not read"]], ["bill_approval", "in", ["Pending"]])

        self.assertEqual((set(page["rows"]), page["total"]), ({self.mismatched}, 1))

    def test_a_filtered_list_pages_on_the_server(self):
        filters = ["bill_check", "in", [NO_BILL, "Mismatched", "Not read"]]

        first, second = self._list(filters, page=2), self._list(filters, start=2, page=2)

        self.assertEqual((len(first["rows"]), first["total"]), (2, 3))
        self.assertEqual((len(second["rows"]), second["total"]), (1, 3))
        self.assertEqual(set(first["rows"]) | set(second["rows"]), {self.mismatched, self.rejected, self.no_bill})

    def test_another_columns_filter_choices_follow_the_bill_check_filter(self):
        result = self._as(
            self.accountant, get_facet_values_impl, doctype=NPE, field="amount",
            filters=json.dumps([["name", "in", self.expenses], ["bill_check", "in", ["Mismatched"]]]),
        )

        self.assertEqual([float(v["value"]) for v in result["values"]], [1180.0])

    def test_a_list_that_asks_for_no_bill_check_gets_none(self):
        result = self._as(
            self.accountant, get_list_with_count_enhanced_impl, doctype=NPE, fields=json.dumps(["name", "amount"]),
            filters=json.dumps([["name", "in", self.expenses]]),
        )

        self.assertTrue(result["data"])
        self.assertFalse({"bill_check", "bill_approval"} & set(result["data"][0]))


class TestTheProjectExpensesList(CashbookInvoiceCase):
    def test_a_wallet_spends_bill_check_shows_on_the_project_expenses_list(self):
        accountant = self.users.make(ACCOUNTANT)
        frappe.get_doc("User", accountant).add_roles("Nirmaan Accountant")
        frappe.db.commit()
        self._as(accountant, attach_cashbook_invoice, self.pe, PE, cloud_url("wallet.pdf"))
        run_reading(bills_of(PE, self.pe)[-1].name, FakeReader(ReadFailed("The reader timed out.")))

        result = self._as(
            accountant, get_list_with_count_enhanced_impl, doctype=PE, fields=json.dumps(LIST_FIELDS),
            filters=json.dumps([["name", "=", self.pe], ["bill_check", "in", ["Not read"]]]),
        )

        self.assertEqual(
            [(r["name"], r["bill_check"], r["bill_approval"]) for r in result["data"]], [(self.pe, "Not read", "Pending")]
        )


class TestTheNoBillChoiceAlone(CardSpendOnTheListCase):
    def test_no_bill_alone_lists_only_the_expenses_with_no_expense_bill(self):
        with_bill = self.spend
        self._attach()
        without = self._expense(self.statement, serno="70000000004", amount=300)

        page = self._list(["bill_approval", "in", [NO_BILL]])

        self.assertEqual((set(page["rows"]), page["total"]), ({without}, 1))
        self.assertNotIn(with_bill, page["rows"])

    def test_a_filter_the_column_does_not_offer_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            self._list(["bill_check", "!=", "Matched"])
