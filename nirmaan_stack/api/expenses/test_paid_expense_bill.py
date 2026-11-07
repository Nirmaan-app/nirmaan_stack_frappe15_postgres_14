# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Replacing a paid wallet spend's or card spend's bill on Payment Done (#1643, spec #1637, GLOSSARY *Expense bill
approval*).

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_paid_expense_bill`. An Admin or Accountant Lead's
new bill is an Expense bill approved at once in their name; its Bill check still runs and is recorded. The reader
is replaced (`expense_bills.reading.read_bill`) and `frappe.enqueue` captured, as in `test_expense_bills`. Uploads
are planted as raw `tabFile` rows with fake cloud URLs, as in `test_paid_invoice`.
"""

from datetime import date
from decimal import Decimal

import frappe
from frappe.utils import add_days, nowdate

from nirmaan_stack.api.expenses.cashbook_invoices import attach_cashbook_invoice
from nirmaan_stack.api.expenses.paid_invoice import set_paid_expense_invoice
from nirmaan_stack.api.expenses.test_cashbook_invoices import NPE, PE, CashbookInvoiceCase
from nirmaan_stack.api.expenses.test_expense_bills import CardBillCase, FakeReader, bills_of, readings_queued, run_reading
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, ADMIN
from nirmaan_stack.api.tds.test_submit import _cloud_url
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE as BILL
from nirmaan_stack.services.expense_bills.bill_check import BillRead

TYPED_DATE = add_days(nowdate(), -3)


class ReplaceOnPaymentDone:
    """The Payment Done replace as a person does it: an unattached upload of theirs, then the endpoint."""

    def _upload(self, owner: str) -> str:
        name = frappe.generate_hash(length=10)
        url = _cloud_url(f"paid-bill-{name}.pdf")
        frappe.db.sql(
            """INSERT INTO "tabFile" (name, creation, modified, modified_by, owner, docstatus, idx, file_name,
                   file_url, is_private, is_folder)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 1, 0)""",
            (name, owner, owner, f"paid-bill-{name}.pdf", url),
        )
        frappe.db.commit()
        self.addCleanup(lambda: (frappe.db.delete("File", {"name": name}), frappe.db.commit()))
        return url

    def _replace(self, user: str, doctype: str, expense: str, ref: str = "TYPED-77", day: str = TYPED_DATE) -> str:
        """Replace the bill as `user`; the new bill's file URL."""
        url = self._upload(user)
        self._as(user, set_paid_expense_invoice, doctype, expense, url, ref, day)
        return url


class TestReplacingACardSpendsBill(ReplaceOnPaymentDone, CardBillCase):
    def test_an_accountant_leads_new_bill_is_approved_at_once_in_their_name(self):
        _, first = self._attach()
        lead = self.users.make(ACCOUNTANT_LEAD)

        url = self._replace(lead, NPE, self.spend)

        bills = bills_of(NPE, self.spend)
        self.assertEqual([b.name for b in bills][0], first)
        new = bills[-1]
        self.assertEqual((new.bill_file, new.status, new.approved_by, new.auto_approved), (url, "Approved", lead, 0))
        self.assertTrue(new.approved_on)
        self.assertEqual((new.is_latest, new.uploaded_by, new.statement_line), (1, lead, self.line))
        # The previous bill stays as history, no longer the latest.
        self.assertEqual(frappe.db.get_value(BILL, first, "is_latest"), 0)
        self.assertEqual(frappe.db.get_value(NPE, self.spend, ["invoice_attachment", "invoice_ref"]), (url, "TYPED-77"))
