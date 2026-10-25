# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Credit Card sub-tab of Pending Invoices Upload (#1570, ADR-0039 ruling 8): the list, attach, No invoice.

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_card_invoices`. Each test makes its own
statement (a unique holder) and expenses, and purges them and its users after itself.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from nirmaan_stack.api.expenses.card_invoices import (
    attach_card_invoice,
    get_card_invoice_queue,
    mark_card_no_invoice,
)
from nirmaan_stack.api.outflow_import.test_card_import import purge_records
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, ADMIN, OUTSIDER, _Users
from nirmaan_stack.api.tds.test_submit import _cloud_url
from nirmaan_stack.services.outflow_import.card_types import FALLBACK_EXPENSE_TYPE

PMO = "Nirmaan PMO Executive Profile"
PROCUREMENT = "Nirmaan Procurement Executive Profile"
NPE = "Non Project Expenses"
STATEMENT = "Credit Card Statement"


class CardInvoiceCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.users = _Users()
        self.expenses, self.statements = [], []
        self.addCleanup(self._purge)
        self.holder = f"CARD TESTHOLDER {frappe.generate_hash(length=6).upper()}"
        self.statement = self._statement(self.holder, "2026-09-02", "2026-10-01", "2026-10-01")

    def _purge(self):
        """Raw, per scope, with the records' Version and Comment rows (`test_card_import.purge_records`): a
        `delete_doc` would leave Deleted Document rows behind."""
        frappe.db.rollback()
        frappe.set_user("Administrator")
        purge_records(NPE, self.expenses)
        purge_records(STATEMENT, self.statements)
        try:
            self.users.purge()
        except Exception as exc:
            frappe.db.rollback()
            raise AssertionError(f"purge failed: users: {exc}") from exc

    def _statement(self, holder, period_from, period_to, statement_date):
        doc = frappe.get_doc(
            {
                "doctype": STATEMENT,
                "holder": holder,
                "company": "STRATOS INFRA TECHNOLOGIES PVT LTD",
                "statement_date": statement_date,
                "period_from": period_from,
                "period_to": period_to,
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        self.statements.append(doc.name)
        return doc.name

    def _expense(self, statement=None, details="Swiggy Limited Bangalore IN", serno="70000000001", amount=412.5,
                 payment_date="2026-09-10", **extra):
        doc = frappe.get_doc(
            {
                "doctype": NPE,
                "type": FALLBACK_EXPENSE_TYPE,
                "status": "Paid",
                "amount": amount,
                "payment_date": payment_date,
                "payment_ref": f"{details} - {serno}",
                "description": "Card spend",
                "credit_card_statement": statement,
                **extra,
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        self.expenses.append(doc.name)
        return doc.name

    def _queue(self, user="Administrator"):
        frappe.set_user(user)
        try:
            rows = get_card_invoice_queue()
        finally:
            frappe.set_user("Administrator")
        return {r["name"]: r for r in rows if r["credit_card_statement"] in self.statements}

    def _as(self, user, fn, *args, **kwargs):
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user("Administrator")


class TestTheList(CardInvoiceCase):
    def test_a_card_spend_waiting_for_its_invoice_is_listed_with_what_finds_the_receipt(self):
        name = self._expense(self.statement)
        row = self._queue()[name]
        self.assertEqual(str(row["payment_date"]), "2026-09-10")
        self.assertEqual(row["merchant"], "SWIGGY")
        self.assertEqual(row["details"], "Swiggy Limited Bangalore IN")
        self.assertEqual(float(row["amount"]), 412.5)
        self.assertEqual(row["expense_type"], FALLBACK_EXPENSE_TYPE)
        self.assertEqual(row["holder"], self.holder)
        self.assertEqual(row["statement_months"], ["2026-09", "2026-10"])
        self.assertEqual(str(row["period_from"]), "2026-09-02")
        self.assertEqual(str(row["period_to"]), "2026-10-01")

    def test_an_invoiced_a_marked_and_a_non_card_expense_are_not_listed(self):
        waiting = self._expense(self.statement, serno="70000000001")
        invoiced = self._expense(self.statement, serno="70000000002", invoice_attachment=_cloud_url("inv.pdf"))
        marked = self._expense(self.statement, serno="70000000003", no_invoice_reason="Toll", no_invoice_by="Administrator")
        not_card = self._expense(None, serno="70000000004")
        listed = set(self._queue())
        self.assertIn(waiting, listed)
        self.assertNotIn(invoiced, listed)
        self.assertNotIn(marked, listed)
        all_names = {r["name"] for r in get_card_invoice_queue()}
        self.assertNotIn(not_card, all_names)

    def test_every_pending_invoices_upload_profile_may_read_it(self):
        name = self._expense(self.statement)
        for profile in (ACCOUNTANT, ACCOUNTANT_LEAD, ADMIN, PMO, PROCUREMENT):
            self.assertIn(name, self._queue(self.users.make(profile)), profile)

    def test_a_user_outside_pending_invoices_upload_is_refused(self):
        self.assertRaises(frappe.PermissionError, self._queue, self.users.make(OUTSIDER))


class TestAttachingTheInvoice(CardInvoiceCase):
    def test_a_file_alone_files_it_and_the_spend_leaves_the_list(self):
        name = self._expense(self.statement)
        self._as(self.users.make(PROCUREMENT), attach_card_invoice, name, _cloud_url("zomato.pdf"))
        doc = frappe.get_doc(NPE, name)
        self.assertEqual(doc.invoice_attachment, _cloud_url("zomato.pdf"))
        self.assertFalse(doc.invoice_ref)
        self.assertFalse(doc.invoice_date)
        self.assertNotIn(name, self._queue())

    def test_number_and_date_are_kept_when_given(self):
        name = self._expense(self.statement)
        self._as(self.users.make(ACCOUNTANT), attach_card_invoice, name, _cloud_url("mmt.pdf"), "INV-77", "2026-09-11")
        doc = frappe.get_doc(NPE, name)
        self.assertEqual((doc.invoice_ref, str(doc.invoice_date)), ("INV-77", "2026-09-11"))

    def test_no_file_a_future_date_and_a_non_card_expense_are_refused(self):
        name = self._expense(self.statement)
        self.assertRaisesRegex(frappe.ValidationError, "Attach the invoice file", attach_card_invoice, name, "")
        self.assertRaisesRegex(
            frappe.ValidationError, "cannot be in the future",
            attach_card_invoice, name, _cloud_url("f.pdf"), None, add_days(nowdate(), 1),
        )
        other = self._expense(None, serno="70000000009")
        self.assertRaisesRegex(frappe.ValidationError, "not a card spend", attach_card_invoice, other, _cloud_url("f.pdf"))
        self.assertFalse(frappe.db.get_value(NPE, name, "invoice_attachment"))

    def test_a_user_outside_pending_invoices_upload_is_refused(self):
        name = self._expense(self.statement)
        self.assertRaises(
            frappe.PermissionError, self._as, self.users.make(OUTSIDER), attach_card_invoice, name, _cloud_url("f.pdf")
        )
        self.assertFalse(frappe.db.get_value(NPE, name, "invoice_attachment"))


class TestMarkingNoInvoice(CardInvoiceCase):
    def test_an_accountant_lead_marks_it_with_a_reason_and_who_and_when_are_kept(self):
        lead = self.users.make(ACCOUNTANT_LEAD)
        name = self._expense(self.statement)
        self._as(lead, mark_card_no_invoice, name, "  Toll booth, no receipt  ")
        doc = frappe.get_doc(NPE, name)
        self.assertEqual(doc.no_invoice_reason, "Toll booth, no receipt")
        self.assertEqual(doc.no_invoice_by, lead)
        self.assertTrue(doc.no_invoice_at)
        self.assertNotIn(name, self._queue())

    def test_an_admin_may_mark_it(self):
        name = self._expense(self.statement)
        self._as(self.users.make(ADMIN), mark_card_no_invoice, name, "Lost")
        self.assertEqual(frappe.db.get_value(NPE, name, "no_invoice_reason"), "Lost")

    def test_an_accountant_and_other_upload_users_are_refused(self):
        name = self._expense(self.statement)
        for profile in (ACCOUNTANT, PMO, PROCUREMENT):
            self.assertRaises(
                frappe.PermissionError, self._as, self.users.make(profile), mark_card_no_invoice, name, "x"
            )
        self.assertFalse(frappe.db.get_value(NPE, name, "no_invoice_by"))

    def test_a_blank_reason_and_an_already_invoiced_spend_are_refused(self):
        name = self._expense(self.statement)
        self.assertRaisesRegex(frappe.ValidationError, "Type the reason", mark_card_no_invoice, name, "  ")
        invoiced = self._expense(self.statement, serno="70000000002", invoice_attachment=_cloud_url("inv.pdf"))
        self.assertRaisesRegex(frappe.ValidationError, "already has its invoice", mark_card_no_invoice, invoiced, "x")
