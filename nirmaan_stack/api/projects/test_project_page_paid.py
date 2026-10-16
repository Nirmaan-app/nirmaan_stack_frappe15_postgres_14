# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The project page's paid figures read the stored Amount Paid / Amount Due and the project money (#1457).

ADR-0034: an order's paid figure is its stored `amount_paid` (Paid payments less Received Vendor Refunds),
never a sum of its payments; the project's outflow is the one server figure. Each order below has a
Received refund, so a screen that added up payments again would show the refunded money as still paid.

    PO A   PO Approved   Paid 400, Received refund 100     -> Amount Paid 300
    PO B   Inactive      Paid 50                           -> Amount Paid 50 (left out of the PO Summary)
    WO W   Approved      Paid 200, Received refund 50,     -> Amount Paid 150, Amount Due 500 - 150 - 20 = 330
                         TDS withheld 20, total 500
    WO X   Amendment     Paid 99                           -> left out of the WO Summary (Approved only)
    a Paid expense of 70

Outflow is cash: PO payments 400 + 50 - 100 = 350, WO payments 200 + 99 - 50 = 249, expenses 70; 669.

Fixtures are raw inserts (`db_insert`, no hooks) on a scratch project, purged per scope after a rollback.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.permissions import add_user_permission
from frappe.utils import flt

from nirmaan_stack.api.projects.project_aggregates import (
    get_project_po_summary_aggregates,
    get_project_sr_summary_aggregates,
)
from nirmaan_stack.api.projects.project_money import get_project_money
from nirmaan_stack.api.projects.project_spends import get_project_pos_paid

PO = "Procurement Orders"
WO = "Service Requests"


def _raw(doctype, name=None, **fields):
    """Insert a row with only the given fields, skipping every hook and validation."""
    doc = frappe.new_doc(doctype)
    doc.update(fields)
    doc.name = name or f"TEST-1457-{frappe.generate_hash(length=10)}"
    doc.db_insert()
    return doc.name


class TestProjectPagePaid(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.P = _raw("Projects", project_name="TEST-1457-PAID", status="WIP")
        cls.A = _raw(PO, project=cls.P, status="PO Approved", total_amount=1000, amount=850, amount_paid=300)
        cls.B = _raw(PO, project=cls.P, status="Inactive", total_amount=50, amount=50, amount_paid=50)
        cls.W = _raw(WO, project=cls.P, status="Approved", gst="false", total_amount=500, amount_paid=150,
                     amount_due=330)
        cls.X = _raw(WO, project=cls.P, status="Amendment", gst="false", total_amount=99, amount_paid=99,
                     amount_due=0)
        for doctype, order, amount in ((PO, cls.A, 400), (PO, cls.B, 50), (WO, cls.W, 200), (WO, cls.X, 99)):
            _raw("Project Payments", project=cls.P, document_type=doctype, document_name=order, amount=amount,
                 status="Paid", payment_date="2026-05-10")
        for doctype, order, amount in ((PO, cls.A, 100), (WO, cls.W, 50)):
            _raw("Vendor Refunds", project=cls.P, document_type=doctype, document_name=order, amount=amount,
                 status="Received", payment_date="2026-06-15")
        _raw("Project Expenses", projects=cls.P, amount=70, status="Paid", payment_date="2026-04-20")
        for order, package, idx in ((cls.A, "Electrical", 1), (cls.A, "Plumbing", 2), (cls.B, "HVAC", 1)):
            _raw("Purchase Order Item", parent=order, parenttype=PO, parentfield="items", idx=idx,
                 procurement_package=package, quote=100, quantity=2, tax=18)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        failures = []
        frappe.db.delete("Purchase Order Item", {"parent": ["in", [cls.A, cls.B]]})
        frappe.db.commit()
        for doctype, field in (
            ("Project Payments", "project"),
            ("Vendor Refunds", "project"),
            ("Project Expenses", "projects"),
            (PO, "project"),
            (WO, "project"),
            ("Projects", "name"),
        ):
            try:
                frappe.db.delete(doctype, {field: cls.P})
                frappe.db.commit()
            except Exception as error:  # noqa: BLE001 - report every scope, strand none silently
                frappe.db.rollback()
                failures.append(f"{doctype}: {error}")
        super().tearDownClass()
        if failures:
            raise AssertionError(f"test_project_page_paid left rows behind: {failures}")

    def test_wo_summary_reads_the_approved_wos_amount_paid_and_amount_due(self):
        totals = get_project_sr_summary_aggregates(self.P)
        self.assertEqual(flt(totals["total_amount_paid_for_srs"], 2), 150.0)
        self.assertEqual(flt(totals["total_amount_due_for_srs"], 2), 330.0)

    def test_po_summary_reads_the_live_pos_amount_paid(self):
        self.assertEqual(flt(get_project_po_summary_aggregates(self.P)["total_amount_paid_for_pos"], 2), 300.0)

    def test_outflow_splits_into_po_wo_and_expense_cash_less_refunds(self):
        money = {key: flt(value, 2) for key, value in get_project_money(self.P).items()}
        self.assertEqual(
            (money["po_outflow"], money["wo_outflow"], money["expense_outflow"], money["outflow"]),
            (350.0, 249.0, 70.0, 669.0),
        )

    def test_spends_reads_every_po_with_its_items_whatever_its_status(self):
        """Spends counts every PO's Amount Paid (spec #1451 story 14): the Inactive PO B is in, with the
        items that key its paid figure by work package, though the PO summary leaves it out."""
        paid = get_project_pos_paid(self.P)
        self.assertEqual(
            sorted((po["name"], flt(po["amount_paid"], 2)) for po in paid["pos"]),
            sorted([(self.A, 300.0), (self.B, 50.0)]),
        )
        self.assertEqual(
            sorted((item["po_number"], item["work_package"], flt(item["quote"]), flt(item["quantity"]),
                    flt(item["tax"]), item["isCustom"]) for item in paid["items"]),
            sorted([
                (self.A, "Electrical", 100.0, 2.0, 18.0, False),
                (self.A, "Plumbing", 100.0, 2.0, 18.0, False),
                (self.B, "HVAC", 100.0, 2.0, 18.0, False),
            ]),
        )

    def test_spends_refuses_a_reader_limited_to_another_project(self):
        """A user who may read POs but whose User Permission names another project gets no Spends rows."""
        email = f"test-1451-spends-{frappe.generate_hash(length=6)}@example.com"
        other = _raw("Projects", project_name="TEST-1457-OTHER", status="WIP")
        user = frappe.get_doc({"doctype": "User", "email": email, "first_name": "Spends", "send_welcome_email": 0,
                               "roles": [{"role": "Nirmaan Accountant"}]})
        user.insert(ignore_permissions=True)
        add_user_permission("Projects", other, email, ignore_permissions=True)
        try:
            frappe.set_user(email)
            self.assertTrue(frappe.has_permission(PO, "read"))
            with self.assertRaises(frappe.PermissionError):
                get_project_pos_paid(self.P)
        finally:
            frappe.set_user("Administrator")
            frappe.db.rollback()
            # The User and its Contact go through `delete_doc`, so their child rows (`Has Role`,
            # `Contact Email`) go with them; a bare row delete would strand those.
            scopes = (
                ("User Permission", lambda: frappe.db.delete("User Permission", {"user": email})),
                ("User", lambda: frappe.delete_doc("User", email, force=True, ignore_permissions=True)),
                ("Contact", lambda: [
                    frappe.delete_doc("Contact", contact, force=True, ignore_permissions=True)
                    for contact in frappe.get_all("Contact", {"email_id": email}, pluck="name")
                ]),
                ("Projects", lambda: frappe.db.delete("Projects", {"name": other})),
            )
            failures = []
            for doctype, purge in scopes:
                try:
                    purge()
                    frappe.db.commit()
                except Exception as error:  # noqa: BLE001 - report every scope, strand none silently
                    frappe.db.rollback()
                    failures.append(f"{doctype}: {error}")
            if failures:
                raise AssertionError(f"test_spends_refuses_a_reader_limited_to_another_project left rows: {failures}")
