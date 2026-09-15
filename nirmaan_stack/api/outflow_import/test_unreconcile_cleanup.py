# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Unreconcile clean-up: nothing derived from a reverted payment is left stale (#1276, parent #1270).

Through the whitelisted `unreconcile_row`, after the payment is back to Approved:
  * the vendor's credit used equals a fresh full recompute, with a ledger entry;
  * the project's cashflow-gap CEO Hold reason equals a fresh evaluation, even when two payments of
    ONE project come off in one Reverse all (the hook's per-request flag skips the second save);
  * the parent's `latest_payment_date` is RECOMPUTED from its remaining Paid payments;
  * the statement attachment is cleared only while it still holds the statement, and the import's
    statement `File` row is gone -- the batch's own `File` row is untouched.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. The vendor, its ledger rows, the planted `File` rows and the
CEO Hold reasons are purged in tearDown with everything the base fixture purges.
"""

import datetime

import frappe

from nirmaan_stack.api.outflow_import.expenses import settle_row
from nirmaan_stack.api.outflow_import.test_unreconcile_payments import PaymentUnreconcileFixture
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.api.vendor_credit import _compute_credit_used
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import (
    _compute_cashflow_gap,
)
from nirmaan_stack.services.ceo_hold import core as ceo_hold

PAYMENT = "Project Payments"
PO = "Procurement Orders"
LEDGER = "Vendor Credit Ledger"


def _date(text):
    return datetime.date.fromisoformat(text)


def _as_date(value):
    return value.date() if isinstance(value, datetime.datetime) else value


class CleanupFixture(PaymentUnreconcileFixture):
    def setUp(self):
        super().setUp()
        self.files = []

    def tearDown(self):
        if self.files:
            frappe.db.delete("File", {"name": ["in", self.files]})
        project = getattr(self, "_alloc_project_name", None)
        if project:
            frappe.db.delete("CEO Hold Reason", {"project": project})
            frappe.flags.pop(f"ceo_hold_checked:{project}", None)
        vendor = getattr(self, "vendor", None)
        if vendor:
            frappe.db.delete(LEDGER, {"parent": vendor})
            frappe.db.delete("Version", {"ref_doctype": "Vendors", "docname": vendor})
            frappe.db.delete("Vendors", {"name": vendor})
        frappe.db.commit()
        super().tearDown()

    def _plant_file(self, file_url, doctype, name, field):
        file_name = f"TEST-OFI-FILE-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabFile" (name, creation, modified, modified_by, owner, docstatus, idx,
                   file_name, file_url, attached_to_doctype, attached_to_name, attached_to_field,
                   is_private, is_folder)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                   %s, %s, %s, %s, %s, 1, 0)""",
            (file_name, file_url.rsplit("/", 1)[-1], file_url, doctype, name, field),
        )
        self.files.append(file_name)
        frappe.db.commit()
        return file_name

    def _one_settled_payment(self, amount="60"):
        pay = self._approved_payment(amount)
        row = self._staged_row(amount=amount)
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay)
        return row, pay


class TestVendorCredit(CleanupFixture):
    def setUp(self):
        super().setUp()
        self.vendor = f"TEST-OFI-UNREC-VEN-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner,
                   docstatus, idx, vendor_name, vendor_category, credit_used, available_credit)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s,
                   '{"categories": []}', 0, 50000)""",
            (self.vendor, self.vendor),
        )
        frappe.db.set_value(
            PO,
            self._allocation_po(),
            {"vendor": self.vendor, "status": "PO Approved", "po_amount_delivered": 100},
            update_modified=False,
        )
        frappe.db.commit()

    def test_credit_used_matches_a_fresh_recompute_and_a_ledger_entry_records_it(self):
        row, pay = self._one_settled_payment("60")
        self.assertEqual(float(frappe.db.get_value(PO, self._allocation_po(), "amount_paid")), 60.0)
        before = frappe.get_all(LEDGER, {"parent": self.vendor}, pluck="name")

        unreconcile_row(row=row, legs="all", reason="wrong vendor")

        vendor = frappe.get_doc("Vendors", self.vendor)
        self.assertEqual(float(vendor.credit_used), float(_compute_credit_used(vendor)))
        self.assertEqual(float(vendor.credit_used), 100.0)
        entries = frappe.get_all(
            LEDGER,
            filters={"parent": self.vendor, "name": ["not in", before or [""]]},
            fields=["entry_type", "po_id", "delta_amount", "credit_used_after"],
        )
        self.assertEqual(len(entries), 1)
        [entry] = entries
        self.assertEqual(entry.entry_type, "Payment Unreconciled")
        self.assertEqual(entry.po_id, self._allocation_po())
        self.assertEqual(float(entry.credit_used_after), 100.0)
        self.assertEqual(float(entry.delta_amount), 60.0)


class TestCeoHold(CleanupFixture):
    def test_two_payments_of_one_project_leave_the_gap_equal_to_a_fresh_evaluation(self):
        row, (a, b, c) = self._allocated()
        project = self._allocation_project()
        # Gap is the three Paid payments, 100. Limit 35: reverting 60 first still leaves 40 over it,
        # so only a re-sync AFTER the 30 also comes off can clear the reason.
        frappe.db.set_value("Projects", project, "cashflow_gap_limit", 35, update_modified=False)
        ceo_hold.set_reason(project, ceo_hold.SOURCE_CASHFLOW, ceo_hold.cashflow_reason_text(100, 35))
        frappe.db.commit()
        # A fresh request: nothing has claimed this project's per-request flag yet.
        frappe.flags.pop(f"ceo_hold_checked:{project}", None)

        unreconcile_row(row=row, legs=[self._leg(row, a), self._leg(row, b)], reason="wrong")

        gap = _compute_cashflow_gap(project)
        self.assertEqual(gap, 10.0)
        self.assertEqual(ceo_hold.SOURCE_CASHFLOW in ceo_hold.active_sources(project), gap > 35)


class TestLatestPaymentDate(CleanupFixture):
    def _dated(self):
        row, (a, b, c) = self._allocated()
        for pay, day in ((a, "2026-08-01"), (b, "2026-08-05"), (c, "2026-08-10")):
            frappe.db.set_value(PAYMENT, pay, "payment_date", day, update_modified=False)
        frappe.db.commit()
        return row, (a, b, c)

    def _latest(self):
        return _as_date(frappe.db.get_value(PO, self._allocation_po(), "latest_payment_date"))

    def test_reverting_the_latest_falls_back_to_the_next_latest(self):
        row, (a, b, c) = self._dated()
        frappe.db.set_value(PO, self._allocation_po(), "latest_payment_date", "2026-08-10")
        frappe.db.commit()
        unreconcile_row(row=row, legs=[self._leg(row, c)], reason="wrong")
        self.assertEqual(self._latest(), _date("2026-08-05"))

    def test_reverting_one_that_is_not_the_latest_recomputes_rather_than_rolls_back(self):
        row, (a, b, c) = self._dated()
        # A stale value no remaining payment carries: a recompute repairs it, a rollback would not.
        frappe.db.set_value(PO, self._allocation_po(), "latest_payment_date", "2026-09-30")
        frappe.db.commit()
        unreconcile_row(row=row, legs=[self._leg(row, a)], reason="wrong")
        self.assertEqual(self._latest(), _date("2026-08-10"))

    def test_reverting_every_payment_blanks_it(self):
        row, pays = self._dated()
        frappe.db.set_value(PO, self._allocation_po(), "latest_payment_date", "2026-08-10")
        frappe.db.commit()
        unreconcile_row(row=row, legs="all", reason="wrong")
        self.assertIsNone(self._latest())


class TestStatementAttachment(CleanupFixture):
    def test_the_statement_is_cleared_and_its_file_row_deleted(self):
        row, pay = self._one_settled_payment()
        self.assertEqual(
            frappe.db.get_value(PAYMENT, pay, "payment_attachment"), self.ALLOC_STATEMENT
        )
        batch = frappe.db.get_value("Outflow Import Row", row, "import_batch")
        link = self._plant_file(self.ALLOC_STATEMENT, PAYMENT, pay, "payment_attachment")
        own = self._plant_file(self.ALLOC_STATEMENT, "Outflow Import Batch", batch, "source_file")

        unreconcile_row(row=row, legs="all", reason="wrong")

        self.assertFalse(frappe.db.get_value(PAYMENT, pay, "payment_attachment"))
        self.assertFalse(frappe.db.exists("File", link))
        self.assertFalse(
            frappe.db.exists(
                "File",
                {"file_url": self.ALLOC_STATEMENT, "attached_to_doctype": PAYMENT,
                 "attached_to_name": pay},
            )
        )
        # The import's own copy of the statement is not the payment's to delete.
        self.assertTrue(frappe.db.exists("File", own))

    def test_an_attachment_replaced_by_hand_is_left_alone(self):
        row, pay = self._one_settled_payment()
        receipt = "/private/files/test-ofi-signed-receipt.pdf"
        frappe.db.set_value(PAYMENT, pay, "payment_attachment", receipt, update_modified=False)
        frappe.db.commit()
        receipt_file = self._plant_file(receipt, PAYMENT, pay, "payment_attachment")
        link = self._plant_file(self.ALLOC_STATEMENT, PAYMENT, pay, "payment_attachment")

        unreconcile_row(row=row, legs="all", reason="wrong")

        self.assertEqual(frappe.db.get_value(PAYMENT, pay, "payment_attachment"), receipt)
        self.assertTrue(frappe.db.exists("File", receipt_file))
        self.assertFalse(frappe.db.exists("File", link))
