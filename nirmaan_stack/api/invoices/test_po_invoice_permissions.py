"""Who may approve or reject a Vendor Invoice on a Purchase Order (#1638).

Each test acts as a real user of the role it names (picked from the site's `Nirmaan Users`; skipped when the
site has none) and checks the refusal or the stored status. The prior art and the shared fixtures are the
Work Order tests (`test_work_order_invoice_permissions`, #1531).

Run: DEVENV test --module nirmaan_stack.api.invoices.test_po_invoice_permissions
"""

from unittest.mock import patch

import frappe

from nirmaan_stack.api.invoices._auto_approve import apply_auto_approval
from nirmaan_stack.api.invoices.approve_vendor_invoice import approve_vendor_invoice
from nirmaan_stack.api.invoices.test_work_order_invoice_permissions import (
    ACCOUNTANT,
    ADMIN,
    PROCUREMENT,
    _AsRoleCase,
)
from nirmaan_stack.services.purchase_order_invoice_access import SYSTEM_DECISION_FLAG

HR = "Nirmaan HR Executive Profile"

PO_DECIDE_REFUSAL = "Only Admin and Accountants can approve or reject a Purchase Order invoice."


class TestDecidingAPurchaseOrderInvoice(_AsRoleCase):
    def test_procurement_cannot_approve_or_reject_one(self):
        name = self._invoice(self.po)
        for action, reason in (("Approved", None), ("Rejected", "wrong bill")):
            with self.assertRaises(frappe.ValidationError) as refused:
                self._as(PROCUREMENT, approve_vendor_invoice, name, action, reason)
            self.assertIn(PO_DECIDE_REFUSAL, str(refused.exception))
        self.assertEqual(self._status(name), "Pending")

    def test_hr_cannot_approve_one(self):
        name = self._invoice(self.po)
        with self.assertRaises(frappe.ValidationError) as refused:
            self._as(HR, approve_vendor_invoice, name, "Approved")
        self.assertIn(PO_DECIDE_REFUSAL, str(refused.exception))
        self.assertEqual(self._status(name), "Pending")

    def test_an_accountant_approves_one(self):
        name = self._invoice(self.po)
        res = self._as(ACCOUNTANT, approve_vendor_invoice, name, "Approved")
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(self._status(name), "Approved")

    def test_an_accountant_rejects_one(self):
        name = self._invoice(self.po)
        res = self._as(ACCOUNTANT, approve_vendor_invoice, name, "Rejected", "wrong bill")
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(self._status(name), "Rejected")

    def test_an_admin_approves_and_rejects(self):
        approved, rejected = self._invoice(self.po), self._invoice(self.po)
        self.assertEqual(self._as(ADMIN, approve_vendor_invoice, approved, "Approved")["status"], 200)
        self.assertEqual(self._as(ADMIN, approve_vendor_invoice, rejected, "Rejected", "dup")["status"], 200)
        self.assertEqual((self._status(approved), self._status(rejected)), ("Approved", "Rejected"))

    def test_a_pending_one_is_still_the_only_one_decided(self):
        """The endpoint's old rule stays: a PO invoice is decided only while Pending."""
        name = self._invoice(self.po)
        self._as(ACCOUNTANT, approve_vendor_invoice, name, "Approved")
        with self.assertRaises(frappe.ValidationError) as refused:
            self._as(ACCOUNTANT, approve_vendor_invoice, name, "Rejected", "wrong amount")
        self.assertIn("is not in 'Pending' status", str(refused.exception))
        self.assertEqual(self._status(name), "Approved")


class TestTheRuleHoldsOffTheEndpoint(_AsRoleCase):
    """Desk and the REST API save the doc: the validate hook refuses there too."""

    def _save_as(self, profile, name, **fields):
        def save():
            doc = frappe.get_doc("Vendor Invoices", name)
            doc.update(fields)
            doc.save(ignore_permissions=True)  # the doctype's role rows aside: the hook alone decides

        self._as(profile, save)

    def test_procurement_cannot_approve_one_by_saving_it(self):
        name = self._invoice(self.po)
        with self.assertRaises(frappe.ValidationError) as refused:
            self._save_as(PROCUREMENT, name, status="Approved")
        self.assertIn(PO_DECIDE_REFUSAL, str(refused.exception))
        frappe.db.rollback()
        self.assertEqual(self._status(name), "Pending")

    def test_a_payload_that_looks_like_the_system_is_still_refused(self):
        """`approved_by` and `auto_approved` are plain fields a caller can send; the system's mark is not."""
        name = self._invoice(self.po)
        with self.assertRaises(frappe.ValidationError) as refused:
            self._save_as(
                PROCUREMENT, name, status="Approved", approved_by="System", auto_approved=1,
                flags={SYSTEM_DECISION_FLAG: True},
            )
        self.assertIn(PO_DECIDE_REFUSAL, str(refused.exception))
        frappe.db.rollback()
        self.assertEqual(self._status(name), "Pending")

    def test_procurement_cannot_create_one_already_approved(self):
        def insert():
            doc = frappe.new_doc("Vendor Invoices")
            doc.update({
                "document_type": "Procurement Orders", "document_name": self.po,
                "invoice_no": "T-" + frappe.generate_hash(length=8), "invoice_date": frappe.utils.nowdate(),
                "invoice_amount": 1_000, "status": "Approved",
            })
            doc.insert(ignore_permissions=True)

        with self.assertRaises(frappe.ValidationError) as refused:
            self._as(PROCUREMENT, insert)
        self.assertIn(PO_DECIDE_REFUSAL, str(refused.exception))
        frappe.db.rollback()

    def test_an_accountant_may_change_the_status_by_saving_it(self):
        name = self._invoice(self.po)
        self._save_as(ACCOUNTANT, name, status="Rejected", rejection_reason="wrong bill")
        self.assertEqual(self._status(name), "Rejected")


class TestTheSystemStillDecides(_AsRoleCase):
    """Auto-approve runs as whoever uploaded the invoice, often procurement: it must keep approving."""

    def test_auto_approval_approves_while_procurement_is_the_session_user(self):
        name = self._invoice(self.po)

        def auto_approve():
            doc = frappe.get_doc("Vendor Invoices", name)
            apply_auto_approval(doc)
            doc.save(ignore_permissions=True)

        self._as(PROCUREMENT, auto_approve)
        row = frappe.db.get_value("Vendor Invoices", name, ["status", "approved_by", "auto_approved"], as_dict=True)
        self.assertEqual((row.status, row.approved_by, row.auto_approved), ("Approved", "System", 1))

    def test_auto_approval_still_approves_on_upload(self):
        """The real upload path: `update_invoice_data` inserts, evaluates, and approves when every gate passes."""
        with patch(
            "nirmaan_stack.api.delivery_notes.update_invoice_data.evaluate_auto_approve_eligibility",
            return_value=(True, []),
        ):
            name = self._as(PROCUREMENT, self._invoice, self.po)
        self.assertEqual(self._status(name), "Approved")
