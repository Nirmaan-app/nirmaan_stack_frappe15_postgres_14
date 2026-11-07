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
from frappe.utils import add_days, getdate, nowdate

from nirmaan_stack.api.expenses.cashbook_invoices import attach_cashbook_invoice
from nirmaan_stack.api.expenses.expense_bill_fixture import cloud_url
from nirmaan_stack.api.expenses.expense_bill_approval import reject_expense_bill
from nirmaan_stack.api.expenses.paid_invoice import set_paid_expense_invoice
from nirmaan_stack.api.expenses.test_cashbook_invoices import NPE, PE, CashbookInvoiceCase
from nirmaan_stack.api.expenses.test_expense_bill_approval import keeping_versions
from nirmaan_stack.api.expenses.test_expense_bills import CardBillCase, FakeReader, bills_of, readings_queued, run_reading
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, ADMIN
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE as BILL
from nirmaan_stack.services.expense_bills.approval import correct_latest_bill
from nirmaan_stack.services.expense_bills.bill_check import BillRead

TYPED_DATE = add_days(nowdate(), -3)


class ReplaceOnPaymentDone:
    """The Payment Done replace as a person does it: an unattached upload of theirs, then the endpoint."""

    def _upload(self, owner: str) -> str:
        name = frappe.generate_hash(length=10)
        url = cloud_url(f"paid-bill-{name}.pdf")
        frappe.db.sql(
            """INSERT INTO "tabFile" (name, creation, modified, modified_by, owner, docstatus, idx, file_name,
                   file_url, is_private, is_folder)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 1, 0)""",
            (name, owner, owner, f"paid-bill-{name}.pdf", url),
        )
        frappe.db.commit()
        self.addCleanup(self._purge_file, name)
        return url

    def _purge_file(self, name: str) -> None:
        frappe.db.rollback()
        try:
            frappe.db.delete("File", {"name": name})
            frappe.db.commit()
        except Exception as exc:
            frappe.db.rollback()
            raise AssertionError(f"purge failed: file {name}: {exc}") from exc

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

    def test_its_bill_check_runs_and_a_matched_result_never_replaces_the_number_and_date_they_typed(self):
        lead = self.users.make(ACCOUNTANT_LEAD)
        self._replace(lead, NPE, self.spend)
        name = bills_of(NPE, self.spend)[-1].name
        self.assertEqual(readings_queued(self.jobs), [("long", name)])

        run_reading(name, FakeReader(BillRead(Decimal("1180.00"), "READ-9", date(2026, 9, 9))))

        bill = frappe.get_doc(BILL, name)
        self.assertEqual((bill.bill_check, bill.read_invoice_no, str(bill.read_invoice_date)), ("Matched", "READ-9", "2026-09-09"))
        self.assertEqual((bill.status, bill.approved_by, bill.auto_approved), ("Approved", lead, 0))
        self.assertEqual((bill.invoice_no, str(bill.invoice_date)), ("TYPED-77", TYPED_DATE))
        self.assertEqual(frappe.db.get_value(NPE, self.spend, ["invoice_ref", "invoice_date"]),
                         ("TYPED-77", frappe.utils.getdate(TYPED_DATE)))

    def test_an_accountants_new_bill_waits_like_any_other(self):
        accountant = self.users.make(ACCOUNTANT)

        self._replace(accountant, NPE, self.spend)

        new = bills_of(NPE, self.spend)[-1]
        self.assertEqual((new.status, new.approved_by, new.bill_check, new.uploaded_by),
                         ("Pending", None, "Checking", accountant))

    def test_an_approvers_edit_of_only_the_number_and_date_lands_no_new_bill_and_corrects_the_latest_one(self):
        _, first = self._attach(invoice_ref="TYPED-77", invoice_date=TYPED_DATE)
        lead = self.users.make(ACCOUNTANT_LEAD)
        kept = frappe.db.get_value(NPE, self.spend, "invoice_attachment")
        corrected = add_days(nowdate(), -2)

        with keeping_versions():
            self._as(lead, set_paid_expense_invoice, NPE, self.spend, kept, "TYPED-78", corrected)

        self.assertEqual([b.name for b in bills_of(NPE, self.spend)], [first])
        self.assertEqual(frappe.db.get_value(NPE, self.spend, "invoice_ref"), "TYPED-78")
        # The same profiles whose new bill is approved at once correct the bill itself, through the document layer.
        self.assertEqual(
            frappe.db.get_value(BILL, first, ["invoice_no", "invoice_date", "status"]),
            ("TYPED-78", getdate(corrected), "Pending"),
        )
        self.assertTrue(frappe.db.exists("Version", {"ref_doctype": BILL, "docname": first, "owner": lead}))

    def test_a_correction_leaves_a_rejected_latest_bill_as_the_record_of_its_rejection(self):
        _, first = self._attach(invoice_ref="TYPED-77", invoice_date=TYPED_DATE)
        run_reading(first, FakeReader(BillRead(Decimal("1250.00"), "READ-9", date(2026, 9, 9))))
        self._as(self.users.make(ACCOUNTANT), reject_expense_bill, first, reason="Bill of another shop")
        before = frappe.db.get_value(BILL, first, ["invoice_no", "invoice_date", "status"])

        # Called directly: a rejection clears the Expense's file, so Payment Done lands a new bill instead.
        correct_latest_bill(NPE, self.spend, "TYPED-78", add_days(nowdate(), -2))

        self.assertEqual(frappe.db.get_value(BILL, first, ["invoice_no", "invoice_date", "status"]), before)
        self.assertEqual(before[2], "Rejected")

    def test_an_accountants_edit_of_only_the_number_and_date_leaves_the_bill_as_it_was(self):
        _, first = self._attach(invoice_ref="TYPED-77", invoice_date=TYPED_DATE)
        accountant = self.users.make(ACCOUNTANT)
        kept = frappe.db.get_value(NPE, self.spend, "invoice_attachment")

        self._as(accountant, set_paid_expense_invoice, NPE, self.spend, kept, "TYPED-78", TYPED_DATE)

        self.assertEqual(frappe.db.get_value(NPE, self.spend, "invoice_ref"), "TYPED-78")
        self.assertEqual(frappe.db.get_value(BILL, first, ["invoice_no", "invoice_date"]), ("TYPED-77", getdate(TYPED_DATE)))


class TestReplacingAWalletSpendsBill(ReplaceOnPaymentDone, CashbookInvoiceCase):
    def test_an_admins_new_bill_is_approved_at_once_and_the_previous_one_is_history(self):
        self._as(self.users.make(ACCOUNTANT), attach_cashbook_invoice, self.pe, PE, cloud_url("wallet.pdf"))
        first = bills_of(PE, self.pe)[-1].name
        admin = self.users.make(ADMIN)

        url = self._replace(admin, PE, self.pe)

        bills = bills_of(PE, self.pe)
        self.assertEqual([b.name for b in bills][0], first)
        new = bills[-1]
        self.assertEqual((new.bill_file, new.status, new.approved_by, new.auto_approved, new.is_latest),
                         (url, "Approved", admin, 0, 1))
        self.assertEqual(frappe.db.get_value(BILL, first, "is_latest"), 0)
        self.assertEqual(frappe.db.get_value(PE, self.pe, "invoice_attachment"), url)


class TestOtherPaidExpenses(ReplaceOnPaymentDone, CardBillCase):
    def test_an_expense_that_is_no_wallet_or_card_spend_gets_no_expense_bill(self):
        hand_keyed = self._expense(None, amount=900)  # no statement: a hand-keyed Paid expense
        lead = self.users.make(ACCOUNTANT_LEAD)

        url = self._replace(lead, NPE, hand_keyed)

        self.assertEqual(bills_of(NPE, hand_keyed), [])
        self.assertEqual(frappe.db.get_value(NPE, hand_keyed, ["invoice_attachment", "invoice_ref"]), (url, "TYPED-77"))
        self.assertEqual(readings_queued(self.jobs), [])
