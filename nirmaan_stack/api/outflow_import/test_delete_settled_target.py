# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Deleting a record a bank line settled (ADR-0022 Amendment G).

A Reversed match record is history only and never blocks the delete; a live one always does, and the
refusal names the bank line. Through the entry points a delete really takes: the Payments page's
Delete endpoint, a plain `frappe.delete_doc` (Desk and `frappe.client.delete`), and a `force=True`
delete (PO deletion).

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Everything a test makes is purged by the fixtures' tearDown.
"""

import json

import frappe

from nirmaan_stack.api.outflow_import.expenses import settle_row
from nirmaan_stack.api.outflow_import.test_inflows import InflowFixture
from nirmaan_stack.api.outflow_import.test_unreconcile_created import (
    NON_PROJECT_INFLOW,
    PROJECT_INFLOW,
    CreatedUnreconcileFixture,
)
from nirmaan_stack.api.outflow_import.test_unreconcile_expenses import (
    PROJECT_EXPENSE,
    ExpenseUnreconcileFixture,
)
from nirmaan_stack.api.outflow_import.test_unreconcile_payments import (
    PAYMENT,
    ROW_DOCTYPE,
    PaymentUnreconcileFixture,
)
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.api.payments.project_payments import update_payment_request


def _delete_from_payments_page(name):
    update_payment_request(data=json.dumps({"action": "delete", "name": name}))


def _refusal(name, amount, where):
    return (
        f"{name} cannot be deleted: 1 bank line totalling {amount} ({where}) is linked to it. "
        "Take it off with Unreconcile on Bulk Import Transactions first."
    )


class TestDeleteAPayment(PaymentUnreconcileFixture):
    def _settled(self):
        pay = self._approved_payment("100")
        row = self._staged_row(amount="100", references={"added_on": "2026-10-12 10:30:00"})
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay)
        return row, pay

    def _purge_what_the_delete_left(self, pay):
        """A real delete leaves a `Nirmaan Versions` copy and a `Deleted Document` row behind."""
        frappe.db.rollback()
        frappe.db.delete("Nirmaan Versions", {"ref_doctype": PAYMENT, "docname": pay})
        frappe.db.delete("Deleted Document", {"deleted_doctype": PAYMENT, "deleted_name": pay})
        frappe.db.commit()

    def test_an_unreconciled_payment_can_be_deleted(self):
        row, pay = self._settled()
        unreconcile_row(row=row, legs="all", reason="wrong line")
        self.addCleanup(self._purge_what_the_delete_left, pay)

        _delete_from_payments_page(pay)

        self.assertFalse(frappe.db.exists(PAYMENT, pay))

    def test_a_payment_a_bank_line_still_pays_is_refused_and_names_the_line(self):
        row, pay = self._settled()
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")

        with self.assertRaises(frappe.ValidationError) as refused:
            _delete_from_payments_page(pay)

        self.assertEqual(
            str(refused.exception), _refusal(pay, "₹100", f"import {batch}, 12-Oct-2026")
        )
        self.assertTrue(frappe.db.exists(PAYMENT, pay))

    def test_a_force_delete_is_refused_too(self):
        """A PO delete force-deletes its adjustment payments (`cleanup_po_linked_docs`); `force`
        skips Frappe's link check, never `on_trash`."""
        row, pay = self._settled()

        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc(PAYMENT, pay, force=True, ignore_permissions=True)

        self.assertTrue(frappe.db.exists(PAYMENT, pay))


class TestDeleteAnInflow(CreatedUnreconcileFixture):
    """Desk and `frappe.client.delete` both end in a plain `frappe.delete_doc`."""

    def _assert_refused(self, doctype, name, row):
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
        with self.assertRaises(frappe.ValidationError) as refused:
            frappe.delete_doc(doctype, name)
        # A staged row carries no bank date, so only the import is named.
        self.assertEqual(str(refused.exception), _refusal(name, "₹500", f"import {batch}"))
        self.assertTrue(frappe.db.exists(doctype, name))

    def test_a_project_inflow_a_bank_line_still_settles_is_refused(self):
        row, name = self._project_inflow()
        self._assert_refused(PROJECT_INFLOW, name, row)

    def test_a_non_project_inflow_a_bank_line_still_settles_is_refused(self):
        row, name = self._non_project_inflow()
        self._assert_refused(NON_PROJECT_INFLOW, name, row)


class TestDeleteAVendorRefund(InflowFixture):
    def test_a_vendor_refund_a_bank_line_still_settles_is_refused(self):
        row, summary = self._refund()
        [record] = summary["records"]

        with self.assertRaises(frappe.ValidationError) as refused:
            frappe.delete_doc("Vendor Refunds", record["name"])

        batch = frappe.db.get_value(ROW_DOCTYPE, row["name"], "import_batch")
        where = f"import {batch}, {row['added_on'].strftime('%d-%b-%Y')}"
        self.assertEqual(str(refused.exception), _refusal(record["name"], "₹1,000", where))
        self.assertTrue(frappe.db.exists("Vendor Refunds", record["name"]))


class TestRenameASettledRecord(ExpenseUnreconcileFixture):
    """Desk renames payments, project inflows and both expenses (`allow_rename`). `target_name` is
    text, so Frappe no longer carries it along; a renamed record must still be refused."""

    def setUp(self):
        super().setUp()
        self.renamed = []

    def tearDown(self):
        """BEFORE the fixtures' purge: it deletes the allocation project through the document layer,
        which deletes any payment or expense it still finds -- these, under names it never tracked --
        and leaves a `Deleted Document` row for each."""
        frappe.db.rollback()
        for doctype, name in self.renamed:
            frappe.db.delete("Comment", {"reference_doctype": doctype, "reference_name": name})
            frappe.db.delete("Version", {"ref_doctype": doctype, "docname": name})
            frappe.db.delete(doctype, {"name": name})
        frappe.db.commit()
        super().tearDown()

    def _rename(self, doctype, old):
        new = f"{old}-RN"
        frappe.rename_doc(doctype, old, new, force=True)
        frappe.db.commit()
        self.renamed.append((doctype, new))
        return new

    def test_a_renamed_payment_a_bank_line_still_pays_is_refused(self):
        pay = self._approved_payment("100")
        row = self._staged_row(amount="100")
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay)
        new = self._rename(PAYMENT, pay)

        with self.assertRaises(frappe.ValidationError):
            _delete_from_payments_page(new)

        self.assertTrue(frappe.db.exists(PAYMENT, new))

    def test_a_renamed_expense_a_bank_line_still_pays_is_refused(self):
        row, name = self._linked(PROJECT_EXPENSE)
        new = self._rename(PROJECT_EXPENSE, name)

        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc(PROJECT_EXPENSE, new)

        self.assertTrue(frappe.db.exists(PROJECT_EXPENSE, new))
