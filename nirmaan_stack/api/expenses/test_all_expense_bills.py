# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor Invoice Recon -> All Invoices -> Cashbook / Credit Card (#1646, spec #1637, GLOSSARY *Expense bills*).

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_all_expense_bills`. Bills are attached in a Pending
Invoices Upload tab and read through the replaced reader, so no test touches the network; then the All Invoices pill
lists every Expense bill, latest and history, paged and filtered on the server.
"""

import json
from datetime import date
from decimal import Decimal

import frappe

from nirmaan_stack.api.expenses.all_expense_bills import get_all_expense_bills
from nirmaan_stack.api.expenses.cashbook_invoices import attach_cashbook_invoice
from nirmaan_stack.api.expenses.expense_bill_approval import reject_expense_bill
from nirmaan_stack.api.expenses.test_cashbook_invoices import PE, CashbookInvoiceCase
from nirmaan_stack.api.expenses.test_expense_bills import NPE, CardBillCase, FakeReader, bills_of, run_reading
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, OUTSIDER
from nirmaan_stack.cloud_file_fixture import cloud_url
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE as BILL
from nirmaan_stack.services.expense_bills.bill_check import BillRead, ReadFailed


def _list(kind: str, filters=(), **kwargs) -> dict:
    """One page of the pill `kind`, as the data table asks for it."""
    return get_all_expense_bills(
        doctype=BILL, filters=json.dumps([["kind", "=", kind], *filters]), limit_start=0,
        limit_page_length=kwargs.pop("limit_page_length", 50), **kwargs,
    )


class CardBillsCase(CardBillCase):
    """A card spend whose first bill was rejected and whose second was read Matched (auto-approved)."""

    def setUp(self):
        super().setUp()
        self.accountant = self.users.make(ACCOUNTANT)
        _, self.first = self._attach()
        run_reading(self.first, FakeReader(BillRead(Decimal("1250.00"), "INV-9", date(2026, 9, 9))))
        self._as(self.accountant, reject_expense_bill, self.first, reason="Bill of another shop")
        _, self.second = self._attach()
        run_reading(self.second, FakeReader(BillRead(Decimal("1180.00"), "INV-10", date(2026, 9, 10))))

    def _rows(self, filters=(), **kwargs) -> dict:
        page = self._as(self.accountant, _list, "card", filters, **kwargs)
        return {r["name"]: r for r in page["data"]}


class TestTheCreditCardPill(CardBillsCase):
    def test_every_bill_of_a_card_spend_is_listed_latest_and_history_with_what_it_is(self):
        rows = self._rows()

        first, second = rows[self.first], rows[self.second]
        self.assertEqual((first["expense"], first["expense_doctype"]), (self.spend, NPE))
        self.assertEqual(str(first["payment_date"]), "2026-09-10")
        self.assertEqual((float(first["line_amount"]), float(first["read_total"])), (1180.0, 1250.0))
        self.assertEqual((first["bill_check"], first["approval"], first["is_latest"]), ("Mismatched", "Rejected", 0))
        self.assertEqual(first["rejection_reason"], "Bill of another shop")
        # Who decided each bill and when (story 35): the person who rejected, the System that approved.
        self.assertEqual(first["rejected_by"], self.accountant)
        self.assertEqual(first["rejected_by_name"], frappe.db.get_value("User", self.accountant, "full_name"))
        self.assertTrue(first["rejected_on"])
        self.assertEqual((first["approved_by"], first["approved_by_name"], first["approved_on"]), (None, None, None))
        self.assertEqual((second["approved_by"], second["approved_by_name"]), ("System", None))
        self.assertTrue(second["approved_on"])
        self.assertEqual((second["rejected_by"], second["rejected_by_name"], second["rejected_on"]), (None, None, None))
        self.assertIsNone(first["invoice_no"])
        self.assertEqual(first["uploaded_by"], frappe.db.get_value(BILL, self.first, "uploaded_by"))
        self.assertTrue(first["uploaded_by_name"])
        self.assertEqual(first["bill_file"], frappe.db.get_value(BILL, self.first, "bill_file"))
        self.assertEqual(first["paid_by"], self.holder)
        self.assertEqual((second["bill_check"], second["approval"], second["is_latest"]), ("Matched", "Auto-approved", 1))
        self.assertEqual((second["invoice_no"], str(second["invoice_date"])), ("INV-10", "2026-09-10"))

    def test_the_pill_filters_on_the_server_by_bill_check_and_approval(self):
        self.assertEqual(set(self._rows([["bill_check", "in", ["Mismatched"]]])) & {self.first, self.second}, {self.first})
        self.assertEqual(set(self._rows([["approval", "in", ["Auto-approved"]]])) & {self.first, self.second}, {self.second})

    def test_the_pill_pages_on_the_server_and_counts_every_row(self):
        page = self._as(self.accountant, _list, "card", [["expense", "=", self.spend]], limit_page_length=1,
                        order_by="creation desc")

        self.assertEqual(page["total_count"], 2)
        self.assertEqual([r["name"] for r in page["data"]], [self.second])

    def test_a_search_finds_a_bill_by_its_invoice_number(self):
        rows = self._rows(search_term="INV-10", current_search_fields=json.dumps(["invoice_no"]))

        self.assertIn(self.second, rows)
        self.assertNotIn(self.first, rows)

    def test_a_wallet_pill_does_not_list_a_card_bill(self):
        page = self._as(self.accountant, _list, "cashbook")

        self.assertNotIn(self.second, {r["name"] for r in page["data"]})

    def test_someone_outside_admin_and_the_accountant_profiles_cannot_list(self):
        with self.assertRaises(frappe.PermissionError):
            self._as(self.users.make(OUTSIDER), _list, "card")


class TestTheCashbookPill(CashbookInvoiceCase):
    def test_a_wallet_bill_is_listed_with_its_wallet_holder_and_project(self):
        accountant = self.users.make(ACCOUNTANT)
        self._as(accountant, attach_cashbook_invoice, self.pe, PE, cloud_url("wallet.pdf"), "TYPED-1", "2026-09-01")
        bill = bills_of(PE, self.pe)[-1].name
        run_reading(bill, FakeReader(ReadFailed("The reader timed out.")))

        rows = {r["name"]: r for r in self._as(accountant, _list, "cashbook")["data"]}

        row = rows[bill]
        self.assertEqual((row["bill_check"], row["bill_check_reason"]), ("Not read", "The reader timed out."))
        self.assertEqual(row["approval"], "Pending")
        self.assertIsNone(row["read_total"])
        # The latest bill shows the number and date the Accountant typed on the Expense.
        self.assertEqual((row["invoice_no"], str(row["invoice_date"])), ("TYPED-1", "2026-09-01"))
        self.assertEqual(row["paid_by"], self.lines[self.pe].added_by_raw.strip())
        self.assertEqual(row["project"], self.project)
        self.assertEqual(row["project_name"], frappe.db.get_value("Projects", self.project, "project_name"))
