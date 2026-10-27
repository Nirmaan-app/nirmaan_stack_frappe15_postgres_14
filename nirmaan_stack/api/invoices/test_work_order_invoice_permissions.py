"""Who may approve, reject and edit a Vendor Invoice on a Work Order (#1531, ADR-0014 Amendment A).

Each test acts as a real user of the role it names (one is picked from the site's `Nirmaan Users`; the
test is skipped when the site has none), does what the screen or Desk does, and checks the refusal or
the stored figures. Purchase Order invoices keep their old rules.

The endpoints COMMIT, so the fixtures come from `_InvoiceEndpointCase`, whose clean-up deletes every
order and invoice it planted.

Run: DEVENV test --module nirmaan_stack.api.invoices.test_work_order_invoice_permissions
"""

import json

import frappe
from frappe.utils import add_days, flt, getdate, nowdate

from nirmaan_stack.api.delivery_notes.test_update_invoice_data import _InvoiceEndpointCase
from nirmaan_stack.api.delivery_notes.update_invoice_data import update_invoice_data
from nirmaan_stack.api.invoices.approve_vendor_invoice import (
    approve_vendor_invoice,
    bulk_approve_vendor_invoices,
)

PROCUREMENT = "Nirmaan Procurement Executive Profile"
ACCOUNTANT = "Nirmaan Accountant Profile"
PROJECT_LEAD = "Nirmaan Project Lead Profile"
ADMIN = "Nirmaan Admin Profile"

DECIDE_REFUSAL = "Only Admin and Accountants can approve or reject a Work Order invoice."


#: The site copy has no Project Lead, so the suite brings its own (removed in tearDownClass).
PROJECT_LEAD_USER = "test-wo-invoice-project-lead@example.com"


class _AsRoleCase(_InvoiceEndpointCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not frappe.db.exists("User", PROJECT_LEAD_USER):
            user = frappe.new_doc("User")
            user.update({"email": PROJECT_LEAD_USER, "first_name": "WO Invoice PL", "send_welcome_email": 0})
            user.flags.no_welcome_mail = True
            user.insert(ignore_permissions=True)   # its after_insert creates the Nirmaan Users row
            user.add_roles("Nirmaan Project Lead")
        frappe.db.set_value("Nirmaan Users", PROJECT_LEAD_USER, "role_profile", PROJECT_LEAD, update_modified=False)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        frappe.set_user("Administrator")
        for doctype in ("Nirmaan Users", "User"):
            try:
                if frappe.db.exists(doctype, PROJECT_LEAD_USER):
                    frappe.delete_doc(doctype, PROJECT_LEAD_USER, force=True, ignore_permissions=True)
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                print(f"!! could not remove test {doctype} {PROJECT_LEAD_USER}")
                raise
        super().tearDownClass()

    def _user(self, profile):
        if profile == PROJECT_LEAD:
            return PROJECT_LEAD_USER
        user = frappe.db.get_value(
            "Nirmaan Users", {"role_profile": profile, "name": ("!=", "Administrator")}, "name"
        )
        if not user:
            self.skipTest(f"no {profile} user on this site")
        return user

    def _as(self, profile, fn, *args, **kwargs):
        user = self._user(profile)
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user("Administrator")

    def _invoice(self, parent, amount=11_800, gst=1_800):
        """A Pending invoice uploaded the way the WO page does it."""
        res = self._save(parent, amount=amount, base_amount=amount - gst, gst_amount=gst)
        self.assertEqual(res["status"], 200, res)
        return res["data"]["vendor_invoice_id"]

    def _status(self, name):
        return frappe.db.get_value("Vendor Invoices", name, "status")

    def _invoiced(self, work_order):
        """The Work Order's Total Amount Invoiced and GST Invoiced, as stored."""
        row = frappe.db.get_value(
            "Service Requests", work_order, ["amount_invoiced", "gst_invoiced"], as_dict=True
        )
        return flt(row.amount_invoiced), flt(row.gst_invoiced)


class TestDecidingAWorkOrderInvoice(_AsRoleCase):
    def test_procurement_cannot_approve_or_reject_one(self):
        name = self._invoice(self.wo_gst_on)
        for action, reason in (("Approved", None), ("Rejected", "wrong bill")):
            with self.assertRaises(frappe.ValidationError) as refused:
                self._as(PROCUREMENT, approve_vendor_invoice, name, action, reason)
            self.assertIn(DECIDE_REFUSAL, str(refused.exception))
        self.assertEqual(self._status(name), "Pending")

    def test_an_accountant_approves_one_and_it_counts_as_invoiced(self):
        name = self._invoice(self.wo_gst_on)
        res = self._as(ACCOUNTANT, approve_vendor_invoice, name, "Approved")
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(self._status(name), "Approved")
        self.assertEqual(self._invoiced(self.wo_gst_on), (11_800, 1_800))

    def test_bulk_as_procurement_fails_every_one_and_moves_none(self):
        names = [self._invoice(self.wo_gst_on), self._invoice(self.wo_gst_on)]
        res = self._as(PROCUREMENT, bulk_approve_vendor_invoices, names, "Approved")
        self.assertEqual(res["data"]["success"], [])
        self.assertEqual([f["invoice_id"] for f in res["data"]["failed"]], names)
        self.assertIn(DECIDE_REFUSAL, res["data"]["failed"][0]["error"])
        self.assertEqual([self._status(n) for n in names], ["Pending", "Pending"])

    def test_bulk_as_an_accountant_rejects_them(self):
        names = [self._invoice(self.wo_gst_on), self._invoice(self.wo_gst_on)]
        res = self._as(ACCOUNTANT, bulk_approve_vendor_invoices, names, "Rejected", "duplicate")
        self.assertEqual(res["data"]["success"], names, res)
        self.assertEqual([self._status(n) for n in names], ["Rejected", "Rejected"])

    def test_an_accountant_rejects_an_approved_one_to_correct_it(self):
        """The correction path for anyone who may not edit an Approved invoice: reject, upload again."""
        name = self._invoice(self.wo_gst_on)
        approve_vendor_invoice(name, "Approved")
        res = self._as(ACCOUNTANT, approve_vendor_invoice, name, "Rejected", "wrong amount")
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(self._status(name), "Rejected")
        self.assertEqual(self._invoiced(self.wo_gst_on), (0, 0))

    def test_procurement_cannot_reject_an_approved_one(self):
        name = self._invoice(self.wo_gst_on)
        approve_vendor_invoice(name, "Approved")
        with self.assertRaises(frappe.ValidationError) as refused:
            self._as(PROCUREMENT, approve_vendor_invoice, name, "Rejected", "wrong amount")
        self.assertIn(DECIDE_REFUSAL, str(refused.exception))
        self.assertEqual(self._status(name), "Approved")

    def test_a_purchase_order_invoice_is_decided_as_before(self):
        """PO invoices are unchanged: no role check, and only a Pending one is decided."""
        name = self._invoice(self.po)
        res = self._as(PROCUREMENT, approve_vendor_invoice, name, "Approved")
        self.assertEqual(res["status"], 200, res)
        with self.assertRaises(frappe.ValidationError) as refused:
            approve_vendor_invoice(name, "Rejected", "wrong amount")
        self.assertIn("is not in 'Pending' status", str(refused.exception))
        self.assertEqual(self._status(name), "Approved")


EDIT_REFUSAL = "Only Admin and Accountants can edit a Work Order invoice."
APPROVED_REFUSAL = "Only an Admin can change the amount, number or date of an approved Work Order invoice."
APPROVED_MOVE_REFUSAL = "An approved Work Order invoice is only rejected"
REJECTED_MOVE_REFUSAL = "A rejected Work Order invoice is uploaded again"


class TestEditingAWorkOrderInvoice(_AsRoleCase):
    def _edit(self, profile, parent, name, **changes):
        """What the WO page's Edit dialog sends: number, date, amount and the split, changed or not."""
        row = frappe.db.get_value(
            "Vendor Invoices", name,
            ["invoice_no", "invoice_date", "invoice_amount", "invoice_base_amount", "invoice_gst_amount"],
            as_dict=True,
        )
        data = {
            "invoice_no": row.invoice_no,
            "date": str(row.invoice_date),
            "amount": flt(row.invoice_amount),
            "base_amount": flt(row.invoice_base_amount),
            "gst_amount": flt(row.invoice_gst_amount),
        }
        data.update(changes)
        return self._as(
            profile, update_invoice_data,
            docname=parent, invoice_data=json.dumps(data), isSR=parent != self.po, invoice_id=name,
        )

    def _figures(self, name):
        row = frappe.db.get_value(
            "Vendor Invoices", name, ["invoice_no", "invoice_date", "invoice_amount"], as_dict=True
        )
        return row.invoice_no, getdate(row.invoice_date), flt(row.invoice_amount)

    def _approved(self, parent):
        name = self._invoice(parent)
        self.assertEqual(approve_vendor_invoice(name, "Approved")["status"], 200)
        return name

    # ------------------------------------------------------------------ who may edit

    def test_a_project_lead_cannot_edit_one(self):
        name = self._invoice(self.wo_gst_on)
        before = self._figures(name)
        res = self._edit(PROJECT_LEAD, self.wo_gst_on, name, amount=11_000, base_amount=9_200)
        self.assertEqual(res["status"], 400, res)
        self.assertEqual(res["message"], EDIT_REFUSAL)
        self.assertEqual(self._figures(name), before)

    def test_a_project_lead_cannot_resave_one_unchanged_either(self):
        """The Edit dialog is refused as a whole, so it cannot swap the attached bill."""
        name = self._invoice(self.wo_gst_on)
        res = self._edit(PROJECT_LEAD, self.wo_gst_on, name)
        self.assertEqual(res["status"], 400, res)
        self.assertEqual(res["message"], EDIT_REFUSAL)

    def test_an_accountant_edits_a_pending_one(self):
        name = self._invoice(self.wo_gst_on)
        res = self._edit(ACCOUNTANT, self.wo_gst_on, name, invoice_no="FIXED-1", amount=11_000, base_amount=9_200)
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(self._figures(name)[0::2], ("FIXED-1", 11_000))

    def test_procurement_still_uploads_one(self):
        """Uploading is not narrowed: PMO and Procurement upload Work Order invoices."""
        res = self._as(
            PROCUREMENT, self._save, self.wo_gst_on, amount=11_800, base_amount=10_000, gst_amount=1_800
        )
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(self._status(res["data"]["vendor_invoice_id"]), "Pending")

    # ------------------------------------------------------------------ an Approved one

    def test_an_accountant_cannot_change_an_approved_ones_amount_number_or_date(self):
        name = self._approved(self.wo_gst_on)
        before = self._figures(name)
        for changes in (
            {"amount": 11_000, "base_amount": 9_200},
            {"invoice_no": "NEW-NO"},
            {"date": add_days(nowdate(), -1)},
        ):
            res = self._edit(ACCOUNTANT, self.wo_gst_on, name, **changes)
            self.assertEqual(res["status"], 400, (changes, res))
            self.assertTrue(res["message"].startswith(APPROVED_REFUSAL), res)
        self.assertEqual(self._figures(name), before)
        self.assertEqual(self._status(name), "Approved")
        self.assertEqual(self._invoiced(self.wo_gst_on), (11_800, 1_800))

    def test_an_admin_changes_an_approved_one_and_the_order_recounts(self):
        name = self._approved(self.wo_gst_on)
        res = self._edit(ADMIN, self.wo_gst_on, name, amount=5_900, base_amount=5_000, gst_amount=900)
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(self._status(name), "Approved")
        self.assertEqual(self._invoiced(self.wo_gst_on), (5_900, 900))

    def test_an_accountant_cannot_take_an_approved_one_back_to_pending(self):
        """Back to Pending, edit, approve again would skip the Admin-only rule: only rejecting moves it."""
        name = self._approved(self.wo_gst_on)
        doc = frappe.get_doc("Vendor Invoices", name)
        doc.status = "Pending"
        with self.assertRaises(frappe.ValidationError) as refused:
            self._as(ACCOUNTANT, doc.save, ignore_permissions=True)
        self.assertIn(APPROVED_MOVE_REFUSAL, str(refused.exception))
        self.assertEqual(self._status(name), "Approved")

        doc = frappe.get_doc("Vendor Invoices", name)
        doc.status = "Pending"
        self._as(ADMIN, doc.save, ignore_permissions=True)
        self.assertEqual(self._status(name), "Pending")

    def test_an_accountant_cannot_bring_a_rejected_one_back(self):
        """Reject, back to Pending, edit, approve would be the Approved-edit route again: a rejected WO invoice
        is uploaded anew; only an Admin moves it back."""
        name = self._approved(self.wo_gst_on)
        self.assertEqual(approve_vendor_invoice(name, "Rejected", "wrong amount")["status"], 200)
        for status in ("Pending", "Approved"):
            with self.subTest(status=status):
                doc = frappe.get_doc("Vendor Invoices", name)
                doc.status = status
                with self.assertRaises(frappe.ValidationError) as refused:
                    self._as(ACCOUNTANT, doc.save, ignore_permissions=True)
                self.assertIn(REJECTED_MOVE_REFUSAL, str(refused.exception))
        self.assertEqual(self._status(name), "Rejected")
        doc = frappe.get_doc("Vendor Invoices", name)
        doc.status = "Pending"
        self._as(ADMIN, doc.save, ignore_permissions=True)
        self.assertEqual(self._status(name), "Pending")

    def test_a_purchase_order_invoice_still_comes_back_from_rejected(self):
        name = self._invoice(self.po)
        self.assertEqual(approve_vendor_invoice(name, "Rejected", "wrong")["status"], 200)
        doc = frappe.get_doc("Vendor Invoices", name)
        doc.status = "Pending"
        self._as(ACCOUNTANT, doc.save, ignore_permissions=True)
        self.assertEqual(self._status(name), "Pending")

    # ------------------------------------------------------------------ Desk

    def test_desk_obeys_the_same_rules(self):
        """A Desk save runs the same document hook as the endpoints."""
        pending = self._invoice(self.wo_gst_on)
        approved = self._approved(self.wo_gst_on)
        cases = (
            (PROJECT_LEAD, pending, {"invoice_amount": 1}, EDIT_REFUSAL),
            (ACCOUNTANT, approved, {"invoice_amount": 1}, APPROVED_REFUSAL),
            (PROCUREMENT, pending, {"status": "Approved"}, DECIDE_REFUSAL),
        )
        for profile, name, changes, refusal in cases:
            doc = frappe.get_doc("Vendor Invoices", name)
            doc.update(changes)
            with self.assertRaises(frappe.ValidationError) as refused:
                self._as(profile, doc.save, ignore_permissions=True)
            self.assertIn(refusal, str(refused.exception))
        self.assertEqual(self._status(pending), "Pending")
        self.assertEqual(self._invoiced(self.wo_gst_on), (11_800, 1_800))

    # ------------------------------------------------------------------ Purchase Orders, unchanged

    def test_a_purchase_order_invoice_is_edited_as_before(self):
        name = self._approved(self.po)
        res = self._edit(PROJECT_LEAD, self.po, name, amount=11_000, base_amount=9_200)
        self.assertEqual(res["status"], 200, res)
        self.assertEqual(self._figures(name)[2], 11_000)
