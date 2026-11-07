# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook sub-tab of Pending Invoices Upload (#1592, ADR-0015 Amendment B decision 4): the list, attach,
No invoice. Prior art: `test_card_invoices`.

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_cashbook_invoices`. Each test stages the
Cashbook fixture, runs the job inline (so the Expenses carry the marker the job sets, as in production), and
purges the Expenses, the batch, its project and its users after itself. The staged lines' bill links are cleared
before the job runs: these are spends with no bill, the ones that wait.
"""

from pathlib import Path

import frappe

from nirmaan_stack.api.outflow_import.internal_transfer_fixture import purge_internal_transfers
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, add_to_date, now, nowdate

from nirmaan_stack.api.expenses.cashbook_invoices import (
    attach_cashbook_invoice,
    get_cashbook_invoice_queue,
    mark_cashbook_no_invoice,
)
from nirmaan_stack.api.expenses.expense_bill_fixture import capture_jobs, purge_expense_bills
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.test_card_import import purge_records
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD, ADMIN, OUTSIDER, _Users
from nirmaan_stack.api.tds.test_submit import _cloud_url
from nirmaan_stack.services.outflow_import.parser import parse_statement

PMO = "Nirmaan PMO Executive Profile"
PROCUREMENT = "Nirmaan Procurement Executive Profile"
PE = "Project Expenses"
NPE = "Non Project Expenses"
FIXTURE = (
    Path(frappe.get_app_path("nirmaan_stack")) / "services" / "outflow_import" / "tests" / "fixtures"
    / "cashbook_sample.csv"
)


class CashbookInvoiceCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.users = _Users()
        self.extra = []  # (doctype, name) made by hand
        self.project = None
        self.batch = None
        self.addCleanup(self._purge)
        self.jobs = capture_jobs(self)
        self.project = self._project()
        self.batch = self._import()
        self.created = self._created()

    def _project(self) -> str:
        doc = frappe.new_doc("Projects")
        doc.project_name = f"TEST_cashbook_inv_{frappe.generate_hash(length=6)}"
        doc.project_start_date = now()[:19]
        doc.project_end_date = add_to_date(now()[:19], years=1)[:19]
        doc.project_scopes = {"scopes": []}
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return doc.name

    def _import(self) -> str:
        """Stage the fixture, turn its first planned line into a Project spend, and run the job inline."""
        parsed = parse_statement(FIXTURE.read_bytes(), source="Cashbook")
        batch = cb._stage(
            parsed, cb._build_plan(parsed), file_url="/private/files/test-cashbook.csv",
            filename="test-cashbook.csv", user="Administrator",
        ).name
        frappe.db.sql("""UPDATE "tabOutflow Import Row" SET bill_links = NULL WHERE import_batch = %s""", (batch,))
        first = frappe.db.sql(
            """SELECT name FROM "tabOutflow Import Row" WHERE import_batch = %s AND suggested_doctype IS NOT NULL
               ORDER BY name LIMIT 1""",
            (batch,), pluck=True,
        )[0]
        project_type = frappe.db.get_value("Expense Type", {"project": 1}, "name")
        frappe.db.set_value(
            "Outflow Import Row", first,
            {"suggested_doctype": PE, "resolved_project": self.project, "suggested_expense_type": project_type},
            update_modified=False,
        )
        frappe.db.commit()
        cb._cashbook_worker(batch, "Administrator")
        return batch

    def _created(self) -> dict:
        """{doctype: [names]} of the Expenses the job made, and each one's import line."""
        rows = frappe.db.sql(
            """SELECT m.target_doctype, m.target_name, r.added_by_raw, r.remarks
               FROM "tabOutflow Row Match" m JOIN "tabOutflow Import Row" r ON r.name = m.import_row
               WHERE m.import_batch = %s ORDER BY m.target_name""",
            (self.batch,), as_dict=True,
        )
        self.lines = {r.target_name: r for r in rows}
        out = {PE: [], NPE: []}
        for r in rows:
            out[r.target_doctype].append(r.target_name)
        return out

    def _purge(self):
        frappe.db.rollback()
        frappe.set_user("Administrator")
        if self.batch:
            for doctype in (PE, NPE):
                names = frappe.get_all(doctype, filters={"cashbook_batch": self.batch}, pluck="name")
                purge_expense_bills(names)
                purge_records(doctype, names)
            frappe.db.sql("""DELETE FROM "tabOutflow Row Match" WHERE import_batch = %s""", (self.batch,))
            purge_internal_transfers(self.batch)
            frappe.db.sql("""DELETE FROM "tabOutflow Import Row" WHERE import_batch = %s""", (self.batch,))
            frappe.db.sql("""DELETE FROM "tabOutflow Import Batch" WHERE name = %s""", (self.batch,))
            frappe.db.commit()
        purge_expense_bills([name for _, name in self.extra])
        for doctype, name in self.extra:
            purge_records(doctype, [name])
        if self.project:
            frappe.delete_doc("Projects", self.project, force=True, ignore_permissions=True)
            frappe.db.commit()
        try:
            self.users.purge()
        except Exception as exc:
            frappe.db.rollback()
            raise AssertionError(f"purge failed: users: {exc}") from exc

    def _queue(self, user="Administrator"):
        frappe.set_user(user)
        try:
            rows = get_cashbook_invoice_queue()
        finally:
            frappe.set_user("Administrator")
        return {r["name"]: r for r in rows if r["cashbook_batch"] == self.batch}

    def _as(self, user, fn, *args, **kwargs):
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user("Administrator")

    @property
    def pe(self) -> str:
        return self.created[PE][0]

    @property
    def npe(self) -> str:
        return self.created[NPE][0]


class TestTheList(CashbookInvoiceCase):
    def test_every_marked_wallet_spend_waits_project_and_non_project(self):
        listed = self._queue()
        self.assertEqual(set(listed), set(self.created[PE] + self.created[NPE]))
        self.assertTrue(self.created[PE] and self.created[NPE])

    def test_a_row_shows_date_amount_who_paid_the_remark_and_its_ledger(self):
        row = self._queue()[self.pe]
        expense = frappe.get_doc(PE, self.pe)
        line = self.lines[self.pe]
        self.assertEqual(row["doctype"], PE)
        self.assertEqual(str(row["payment_date"]), str(expense.payment_date))
        self.assertEqual(float(row["amount"]), float(expense.amount))
        self.assertEqual(row["paid_by"], line.added_by_raw)
        self.assertEqual(row["remark"], line.remarks or expense.description)
        self.assertEqual(row["project"], self.project)
        self.assertTrue(row["project_name"].startswith("TEST_cashbook_inv_"))
        npe_row = self._queue()[self.npe]
        self.assertEqual(npe_row["doctype"], NPE)
        self.assertEqual(npe_row["paid_by"], self.lines[self.npe].added_by_raw)
        self.assertIsNone(npe_row["project"])

    def test_an_invoiced_or_marked_spend_is_not_listed(self):
        frappe.db.set_value(PE, self.pe, "invoice_attachment", _cloud_url("inv.pdf"), update_modified=False)
        frappe.db.set_value(NPE, self.npe, "no_invoice_by", "Administrator", update_modified=False)
        frappe.db.commit()
        listed = set(self._queue())
        self.assertNotIn(self.pe, listed)
        self.assertNotIn(self.npe, listed)

    def test_an_unmarked_cashbook_expense_never_appears(self):
        """An Expense an earlier Cashbook import made: Paid, a wallet Txn Id as payment_ref, no marker."""
        doc = frappe.get_doc(
            {
                "doctype": NPE,
                "type": frappe.db.get_value(NPE, self.npe, "type"),
                "status": "Paid",
                "amount": 99,
                "payment_date": "2026-08-01",
                "payment_ref": f"OBO17{frappe.generate_hash(length=10)}",
                "description": "Older Cashbook spend",
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        self.extra.append((NPE, doc.name))
        self.assertNotIn(doc.name, {r["name"] for r in get_cashbook_invoice_queue()})
        self.assertRaisesRegex(
            frappe.ValidationError, "not a wallet spend from a Cashbook Statement import",
            attach_cashbook_invoice, doc.name, NPE, _cloud_url("f.pdf"),
        )

    def test_every_pending_invoices_upload_profile_may_read_it(self):
        for profile in (ACCOUNTANT, ACCOUNTANT_LEAD, ADMIN, PMO, PROCUREMENT):
            self.assertIn(self.npe, self._queue(self.users.make(profile)), profile)

    def test_a_user_outside_pending_invoices_upload_is_refused(self):
        self.assertRaises(frappe.PermissionError, self._queue, self.users.make(OUTSIDER))


class TestAttachingTheInvoice(CashbookInvoiceCase):
    def test_a_file_alone_files_it_and_the_spend_leaves_the_list(self):
        self._as(self.users.make(ACCOUNTANT), attach_cashbook_invoice, self.pe, PE, _cloud_url("chai.pdf"))
        doc = frappe.get_doc(PE, self.pe)
        self.assertEqual(doc.invoice_attachment, _cloud_url("chai.pdf"))
        self.assertFalse(doc.invoice_ref)
        self.assertFalse(doc.invoice_date)
        self.assertNotIn(self.pe, self._queue())

    def test_number_and_date_are_kept_when_given(self):
        self._as(self.users.make(ACCOUNTANT), attach_cashbook_invoice, self.npe, NPE, _cloud_url("b.pdf"),
                 "INV-9", "2026-08-02")
        doc = frappe.get_doc(NPE, self.npe)
        self.assertEqual((doc.invoice_ref, str(doc.invoice_date)), ("INV-9", "2026-08-02"))

    def test_no_file_and_a_future_date_are_refused(self):
        self.assertRaisesRegex(frappe.ValidationError, "Attach the invoice file", attach_cashbook_invoice, self.pe, PE, "")
        self.assertRaisesRegex(
            frappe.ValidationError, "cannot be in the future",
            attach_cashbook_invoice, self.pe, PE, _cloud_url("f.pdf"), None, add_days(nowdate(), 1),
        )
        self.assertFalse(frappe.db.get_value(PE, self.pe, "invoice_attachment"))

    def test_a_spend_another_user_just_resolved_is_refused(self):
        self._as(self.users.make(ACCOUNTANT_LEAD), mark_cashbook_no_invoice, self.pe, PE, "No bill at the stall")
        self.assertRaisesRegex(
            frappe.ValidationError, "already marked No invoice by",
            self._as, self.users.make(ACCOUNTANT), attach_cashbook_invoice, self.pe, PE, _cloud_url("f.pdf"),
        )
        self._as(self.users.make(ACCOUNTANT), attach_cashbook_invoice, self.npe, NPE, _cloud_url("a.pdf"))
        self.assertRaisesRegex(
            frappe.ValidationError, "already has its invoice",
            attach_cashbook_invoice, self.npe, NPE, _cloud_url("b.pdf"),
        )

    def test_a_doctype_that_is_not_an_expense_ledger_is_refused(self):
        self.assertRaisesRegex(
            frappe.ValidationError, "not an expense ledger",
            attach_cashbook_invoice, self.npe, "Projects", _cloud_url("f.pdf"),
        )

    def test_a_user_outside_pending_invoices_upload_is_refused(self):
        self.assertRaises(
            frappe.PermissionError, self._as, self.users.make(OUTSIDER),
            attach_cashbook_invoice, self.npe, NPE, _cloud_url("f.pdf"),
        )
        self.assertFalse(frappe.db.get_value(NPE, self.npe, "invoice_attachment"))


class TestMarkingNoInvoice(CashbookInvoiceCase):
    def test_an_accountant_lead_marks_a_project_spend_and_who_and_when_are_kept(self):
        lead = self.users.make(ACCOUNTANT_LEAD)
        self._as(lead, mark_cashbook_no_invoice, self.pe, PE, "  Tea stall, no bill  ")
        doc = frappe.get_doc(PE, self.pe)
        self.assertEqual(doc.no_invoice_reason, "Tea stall, no bill")
        self.assertEqual(doc.no_invoice_by, lead)
        self.assertTrue(doc.no_invoice_at)
        self.assertNotIn(self.pe, self._queue())

    def test_an_admin_may_mark_a_non_project_spend(self):
        self._as(self.users.make(ADMIN), mark_cashbook_no_invoice, self.npe, NPE, "Lost")
        self.assertEqual(frappe.db.get_value(NPE, self.npe, "no_invoice_reason"), "Lost")

    def test_an_accountant_and_other_upload_users_are_refused(self):
        for profile in (ACCOUNTANT, PMO, PROCUREMENT):
            self.assertRaises(
                frappe.PermissionError, self._as, self.users.make(profile), mark_cashbook_no_invoice, self.npe, NPE, "x"
            )
        self.assertFalse(frappe.db.get_value(NPE, self.npe, "no_invoice_by"))

    def test_a_blank_reason_and_an_already_resolved_spend_are_refused(self):
        self.assertRaisesRegex(frappe.ValidationError, "Type the reason", mark_cashbook_no_invoice, self.pe, PE, "  ")
        attach_cashbook_invoice(self.npe, NPE, _cloud_url("inv.pdf"))
        self.assertRaisesRegex(
            frappe.ValidationError, "already has its invoice", mark_cashbook_no_invoice, self.npe, NPE, "x"
        )
