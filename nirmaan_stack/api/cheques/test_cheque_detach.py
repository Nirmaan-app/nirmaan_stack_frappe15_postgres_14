# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Rejected or deleted payment drops off its Cheque (#1413, spec #1407).

Drives the real payment routes against the database: the single L1 and CEO rejects (the browser's
`updateDoc`, i.e. a document save), the bulk lead and CEO rejects (`bulk_actions`), the delete
endpoint (`update_payment_request`), and the delete of a Project Expense or Non Project Expense.
Reads back what a user sees: the Cheque's lines, status and history, and the payment itself.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors, Work Orders and payments
come from `TaxedWorkOrderFixture`; expenses are planted and purged here; every Cheque carries a
TESTCHQ number and is purged by `ChequeFixture`.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import change_cheque_status
from nirmaan_stack.api.payments import bulk_actions
from nirmaan_stack.api.payments.project_payments import update_payment_request
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER

U = "Administrator"
PAYMENT = "Project Payments"
PE = "Project Expenses"
NPE = "Non Project Expenses"
SR = "Service Requests"
PO_WO_LINE = "PO/WO Payment"
PE_LINE = "Project Expense"
NPE_LINE = "Non-project Expense"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class TestChequeDetach(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor(2.0)
        self.project = self.fx.project()
        self.sr = self.fx.service_request(self.project, self.vendor)
        frappe.db.commit()
        for target in (f"{CONTROLLER}._notify_admins_auto_approved", f"{CONTROLLER}._notify_ceo_payment_awaiting"):
            quiet = patch(target)
            quiet.start()
            self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _plant(self, status, *, amount=20000):
        """A payment already sitting at `status` (raw insert: no approval hook runs)."""
        return self.cheques.plant_payment(
            self.fx, status, project=self.project, vendor=self.vendor, document=(SR, self.sr), amount=amount
        )

    def _expense(self, doctype, *, amount=4000):
        """A bare expense (raw insert: no expense hook runs). A Project Expense names its `projects`."""
        name = f"TEST-CHQD-{frappe.generate_hash(length=10)}"
        columns = "name, creation, modified, modified_by, owner, docstatus, idx, amount, status, description"
        values = [name, U, U, flt(amount), "Approved", f"cheque detach test {name}"]
        if doctype == PE:
            columns += ", projects"
            values.append(self.project)
        placeholders = ", ".join(["%s", "NOW()", "NOW()", "%s", "%s", "0", "0"] + ["%s"] * (len(values) - 3))
        frappe.db.sql(f'INSERT INTO "tab{doctype}" ({columns}) VALUES ({placeholders})', tuple(values))
        self.addCleanup(ChequeFixture.purge_rows, [
            ("Version", {"ref_doctype": doctype, "docname": name}),
            ("Deleted Document", {"deleted_doctype": doctype, "deleted_name": name}),
            (doctype, {"name": name}),
        ])
        frappe.db.commit()
        return name

    def _po_wo_line(self, payment):
        return {"line_type": PO_WO_LINE, "project": self.project, "record_doctype": SR,
                "record_name": self.sr, "payment_name": payment}

    def _cheque(self, *lines, description=None, payee_name=None):
        """An Issued Cheque as the report made one before #1482, with `lines`. A Vendor payee unless
        `payee_name` is given."""
        return self.cheques.plant_cheque(
            bank="ICICI Bank",
            cheque_no=self.cheques.number(),
            cheque_date=nowdate(),
            amount=50000,
            vendor=None if payee_name else self.vendor,
            payee_name=payee_name,
            attachment=PHOTO,
            description=description,
            lines=list(lines),
        )

    # -- reading --------------------------------------------------------------------------------
    def _line_payments(self, cheque):
        return frappe.get_all(
            "Cheque Line", filters={"parent": cheque, "parenttype": "Cheques"}, pluck="payment_name", order_by="idx asc"
        )

    def _history(self, cheque):
        return [
            (h.from_status, h.to_status, h.note)
            for h in frappe.get_all(
                "Cheque Status History",
                filters={"parent": cheque, "parenttype": "Cheques"},
                fields=["from_status", "to_status", "note"],
                order_by="idx asc",
            )
        ]

    def _status(self, cheque):
        return frappe.db.get_value("Cheques", cheque, "status")

    # -- driving --------------------------------------------------------------------------------
    def _reject(self, payment):
        """What the browser's single reject does: `updateDoc(..., {status: "Rejected"})`."""
        doc = frappe.get_doc(PAYMENT, payment)
        doc.status = "Rejected"
        doc.save()
        frappe.db.commit()

    # -- single reject --------------------------------------------------------------------------
    def test_l1_reject_drops_the_line_and_writes_a_history_note(self):
        rejected, kept = self._plant("Requested"), self._plant("Requested")
        cheque = self._cheque(self._po_wo_line(rejected), self._po_wo_line(kept))

        self._reject(rejected)

        self.assertEqual(self._line_payments(cheque), [kept])
        self.assertEqual(self._status(cheque), "Issued")
        self.assertEqual(
            self._history(cheque)[-1],
            ("Issued", "Issued", f"Payment {rejected} was Rejected, so its line was removed."),
        )
        self.assertEqual(frappe.db.get_value(PAYMENT, rejected, "status"), "Rejected")

    def test_ceo_reject_of_the_last_line_cancels_a_cheque_with_no_description(self):
        payment = self._plant("CEO Pending", amount=60000)
        cheque = self._cheque(self._po_wo_line(payment))

        self._reject(payment)

        self.assertEqual(self._line_payments(cheque), [])
        self.assertEqual(self._status(cheque), "Cancelled")
        self.assertEqual(self._history(cheque)[-2:], [
            ("Issued", "Issued", f"Payment {payment} was Rejected, so its line was removed."),
            ("Issued", "Cancelled", "No lines and no description are left, so the cheque is Cancelled."),
        ])
        # Emptied, it pays for nothing it can name: it does not come back to life without a description.
        with self.assertRaisesRegex(frappe.ValidationError, "write a description"):
            change_cheque_status(cheque, "Issued")
        frappe.db.rollback()

    def test_a_cheque_with_a_description_keeps_its_status_when_emptied(self):
        payment = self._plant("Requested")
        cheque = self._cheque(self._po_wo_line(payment), description="Advance for the Block A works")

        self._reject(payment)

        self.assertEqual(self._line_payments(cheque), [])
        self.assertEqual(self._status(cheque), "Issued")
        self.assertEqual(
            self._history(cheque)[-1],
            ("Issued", "Issued", f"Payment {payment} was Rejected, so its line was removed."),
        )

    def test_a_cancelled_cheque_loses_the_line_too_and_stays_cancelled(self):
        payment = self._plant("Requested")
        old = self._cheque(self._po_wo_line(payment))
        change_cheque_status(old, "Cancelled", note="bounced")
        live = self._cheque(self._po_wo_line(payment), self._po_wo_line(self._plant("Requested")))

        self._reject(payment)

        self.assertEqual(self._line_payments(old), [])
        self.assertEqual(self._status(old), "Cancelled")
        self.assertEqual(
            self._history(old)[-1],
            ("Cancelled", "Cancelled", f"Payment {payment} was Rejected, so its line was removed."),
        )
        self.assertNotIn(payment, self._line_payments(live))
        self.assertEqual(self._status(live), "Issued")

    def test_a_status_change_that_is_not_a_reject_leaves_the_line(self):
        payment = self._plant("Requested", amount=60000)
        cheque = self._cheque(self._po_wo_line(payment))

        doc = frappe.get_doc(PAYMENT, payment)
        doc.status = "CEO Pending"
        doc.save()
        frappe.db.commit()

        self.assertEqual(self._line_payments(cheque), [payment])

    # -- bulk reject ----------------------------------------------------------------------------
    def test_bulk_lead_reject_drops_each_line(self):
        first, second, kept = self._plant("Requested"), self._plant("Requested"), self._plant("Requested")
        cheque = self._cheque(self._po_wo_line(first), self._po_wo_line(kept))
        other = self._cheque(self._po_wo_line(second))

        with patch.object(bulk_actions, "_add_rejection_comments"):
            res = bulk_actions.bulk_lead_approve_payments([first, second], "reject", "wrong vendor")["data"]

        self.assertEqual(sorted(res["succeeded"]), sorted([first, second]))
        self.assertEqual(self._line_payments(cheque), [kept])
        self.assertEqual(self._status(cheque), "Issued")
        self.assertEqual(self._line_payments(other), [])
        self.assertEqual(self._status(other), "Cancelled")

    def test_bulk_ceo_reject_drops_the_line(self):
        payment, kept = self._plant("CEO Pending", amount=60000), self._plant("Requested")
        cheque = self._cheque(self._po_wo_line(payment), self._po_wo_line(kept))

        frappe.set_user(CEO_AUTHORIZED_USER)
        try:
            with patch.object(bulk_actions, "_add_rejection_comments"):
                res = bulk_actions.bulk_ceo_approve_payments([payment], "reject", "duplicate")["data"]
        finally:
            frappe.set_user(U)

        self.assertEqual(res["succeeded"], [payment])
        self.assertEqual(self._line_payments(cheque), [kept])
        self.assertEqual(
            self._history(cheque)[-1],
            ("Issued", "Issued", f"Payment {payment} was Rejected, so its line was removed."),
        )

    # -- delete ---------------------------------------------------------------------------------
    def test_deleting_a_payment_drops_its_line_and_the_delete_goes_through(self):
        payment = self._plant("Requested")
        cheque = self._cheque(self._po_wo_line(payment))

        update_payment_request(json.dumps({"action": "delete", "name": payment}))
        frappe.db.commit()

        self.assertFalse(frappe.db.exists(PAYMENT, payment))
        self.assertEqual(self._line_payments(cheque), [])
        self.assertEqual(self._status(cheque), "Cancelled")
        self.assertEqual(self._history(cheque)[-2:], [
            ("Issued", "Issued", f"Payment {payment} was deleted, so its line was removed."),
            ("Issued", "Cancelled", "No lines and no description are left, so the cheque is Cancelled."),
        ])

    def test_deleting_a_project_expense_drops_its_line(self):
        expense = self._expense(PE)
        payment = self._plant("Requested")
        cheque = self._cheque(
            {"line_type": PE_LINE, "project": self.project, "payment_name": expense}, self._po_wo_line(payment)
        )

        frappe.delete_doc(PE, expense)
        frappe.db.commit()

        self.assertFalse(frappe.db.exists(PE, expense))
        self.assertEqual(self._line_payments(cheque), [payment])
        self.assertEqual(self._status(cheque), "Issued")
        self.assertEqual(
            self._history(cheque)[-1],
            ("Issued", "Issued", f"Expense {expense} was deleted, so its line was removed."),
        )

    def test_deleting_the_last_non_project_expense_cancels_a_typed_payee_cheque(self):
        expense = self._expense(NPE)
        cheque = self._cheque({"line_type": NPE_LINE, "payment_name": expense}, payee_name="Tata Power")

        frappe.delete_doc(NPE, expense)
        frappe.db.commit()

        self.assertFalse(frappe.db.exists(NPE, expense))
        self.assertEqual(self._line_payments(cheque), [])
        self.assertEqual(self._status(cheque), "Cancelled")
