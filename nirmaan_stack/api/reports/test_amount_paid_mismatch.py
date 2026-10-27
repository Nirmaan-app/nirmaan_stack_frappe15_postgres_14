# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the Amount Paid Mismatch report's two endpoints (#1455, ADR-0034).

The report lists every PO / Work Order whose stored Amount Paid or Amount Due is ₹1 or more off its
source (Paid payments less Received refunds), and recounts one order from source. Both endpoints are
for Admin and Accountant Lead only, checked on the server. Fixtures are the mismatch service's raw-SQL
orders on a real vendor, purged by name; the vendor's credit is put back.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.reports.amount_paid_mismatch import get_amount_paid_mismatches, recount_amount_paid
from nirmaan_stack.api.vendor_refunds import po_refund_fixture
from nirmaan_stack.services.test_amount_paid_drift import OrdersFixture

PO = "Procurement Orders"
WO = "Service Requests"
LEDGER = "Vendor Credit Ledger"
#: The ledger entry type a recount from the report writes the vendor's credit under.
RECOUNT_ENTRY = "Amount Paid Recount"
ADMIN = "Nirmaan Admin Profile"
ACCOUNTANT_LEAD = "Nirmaan Accountant Lead Profile"
ACCOUNTANT = "Nirmaan Accountant Profile"
PROCUREMENT_EXECUTIVE = "Nirmaan Procurement Executive Profile"


class ListingMismatches(OrdersFixture):
    PREFIX = "TEST-APM"

    def _listed(self, doctype, *orders):
        """The report's rows for `orders`, keyed by order name."""
        return {row["name"]: row for row in get_amount_paid_mismatches(doctype) if row["name"] in orders}

    def test_lists_a_po_off_by_a_rupee_or_more_and_not_one_off_by_paisa(self):
        stale = self._po(stored_paid=400, payments=[600, 400])
        paisa = self._po(stored_paid=999.5, payments=[1000])

        rows = self._listed(PO, stale, paisa)

        self.assertEqual(list(rows), [stale])
        row = rows[stale]
        self.assertEqual(
            (row["project"], row["vendor"], row["status"], row["stored_paid"], row["correct_paid"],
             row["paid_difference"], row["stored_due"], row["correct_due"]),
            (self.project, self.vendor, "Delivered", 400.0, 1000.0, 600.0, 600.0, 0.0),
        )

    def test_lists_a_work_order_off_on_its_amount_due(self):
        # 490 reached the vendor and 10 was withheld for them: 500 paid, 500 due on a 1,000 order.
        due_off = self._wo(stored_paid=500, tds=10, stored_due=510)
        self._taxed_payment(due_off, 490, gross=500, tds=10)

        rows = self._listed(WO, due_off)

        self.assertEqual(
            [(r["name"], r["stored_due"], r["correct_due"], r["paid_difference"], r["stored_tds"], r["correct_tds"])
             for r in rows.values()],
            [(due_off, 510.0, 500.0, 0.0, 10.0, 10.0)],
        )

    def test_a_reconciliation_pending_refund_is_not_part_of_the_source(self):
        waiting = self._po(stored_paid=1000, payments=[1000])
        self._refund(PO, waiting, 200, "Reconciliation Pending")
        received = self._po(stored_paid=1000, payments=[1000])
        self._refund(PO, received, 200, "Received")

        rows = self._listed(PO, waiting, received)

        self.assertEqual([(r["name"], r["correct_paid"]) for r in rows.values()], [(received, 800.0)])


class RecountingFromTheReport(OrdersFixture):
    PREFIX = "TEST-APM"

    def _listed_names(self, doctype):
        return {row["name"] for row in get_amount_paid_mismatches(doctype)}

    def test_recount_fixes_a_po_and_its_row_disappears_and_its_vendor_credit_is_recounted(self):
        po = self._po(stored_paid=0, payments=[500])
        ledger_before = set(frappe.get_all(LEDGER, filters={"parent": self.vendor}, pluck="name"))

        reply = recount_amount_paid(PO, po)

        self.assertTrue(reply["recounted"])
        self.assertEqual((reply["before"]["stored_paid"], reply["before"]["correct_paid"]), (0.0, 500.0))
        self.assertEqual(self._stored(PO, po), (500.0, 500.0))
        self.assertNotIn(po, self._listed_names(PO))
        added = frappe.get_all(LEDGER, filters={"parent": self.vendor}, fields=["name", "entry_type", "po_id"])
        self.assertEqual(
            [(e.entry_type, e.po_id) for e in added if e.name not in ledger_before], [(RECOUNT_ENTRY, po)]
        )

    def test_recount_of_a_po_links_its_received_refund_into_its_overpaid_balance(self):
        # Paid 1,000 on a PO now worth 800: its adjustment waits for 200 back. A Received refund of 200
        # written by raw SQL ran no hook, so the PO still reads 1,000 paid and nothing links the refund.
        # The adjustment is saved through the document layer, so its project must be real.
        self.project = frappe.db.get_value("Projects", {"project_name": ["is", "set"]}, "name")
        po, adj = po_refund_fixture.overpaid_po(self.PREFIX, self.project, self.vendor, paid=1000, total=800, remaining=-200)
        self.orders[PO].append(po)
        self.addCleanup(po_refund_fixture.purge, [
            ("Version", lambda: frappe.db.delete("Version", {"ref_doctype": "PO Adjustments", "docname": adj})),
            ("PO Adjustment Items",lambda: frappe.db.delete("PO Adjustment Items", {"parent": adj})),
            ("PO Adjustments", lambda: frappe.db.delete("PO Adjustments", {"name": adj})),
        ])
        refund = self._refund(PO, po, 200, "Received")

        recount_amount_paid(PO, po)

        self.assertEqual(self._stored(PO, po)[0], 800.0)
        linked = frappe.get_all("PO Adjustment Items", filters={"parent": adj, "vendor_refund": refund}, pluck="amount")
        self.assertEqual([flt(a, 2) for a in linked], [200.0])
        self.assertNotIn(po, self._listed_names(PO))

    def test_recount_fixes_a_work_order(self):
        wo = self._wo(stored_paid=0, payments=[400])

        recount_amount_paid(WO, wo)

        self.assertEqual(self._stored(WO, wo), (400.0, 600.0))
        self.assertNotIn(wo, self._listed_names(WO))

    def test_recount_of_an_order_already_right_writes_nothing(self):
        po = self._po(stored_paid=1000, payments=[1000])
        modified = frappe.db.get_value(PO, po, "modified")

        self.assertEqual(recount_amount_paid(PO, po), {"recounted": False, "before": None})
        self.assertEqual(frappe.db.get_value(PO, po, "modified"), modified)


class OnlyAdminAndAccountantLead(OrdersFixture):
    """Both endpoints check the role profile on the server (Admin, Accountant Lead)."""

    PREFIX = "TEST-APM"

    def _user(self, profile):
        user = frappe.db.get_value("Nirmaan Users", {"role_profile": profile}, "name")
        if not user:
            self.skipTest(f"no {profile} user on this site")
        return user

    def _as(self, profile, fn, *args):
        frappe.set_user(self._user(profile))
        try:
            return fn(*args)
        finally:
            frappe.set_user("Administrator")

    def test_an_admin_and_an_accountant_lead_may_list(self):
        stale = self._po(stored_paid=0, payments=[300])

        for profile in (ADMIN, ACCOUNTANT_LEAD):
            with self.subTest(profile):
                names = [r["name"] for r in self._as(profile, get_amount_paid_mismatches, PO)]
                self.assertIn(stale, names)

    def test_an_accountant_or_procurement_user_may_not_list(self):
        for profile in (ACCOUNTANT, PROCUREMENT_EXECUTIVE):
            with self.subTest(profile), self.assertRaises(frappe.PermissionError):
                self._as(profile, get_amount_paid_mismatches, PO)

    def test_an_accountant_lead_may_recount(self):
        po = self._po(stored_paid=0, payments=[300])

        self._as(ACCOUNTANT_LEAD, recount_amount_paid, PO, po)

        self.assertEqual(self._stored(PO, po), (300.0, 700.0))

    def test_an_accountant_or_procurement_user_may_not_recount_and_nothing_is_written(self):
        po = self._po(stored_paid=0, payments=[300])

        for profile in (ACCOUNTANT, PROCUREMENT_EXECUTIVE):
            with self.subTest(profile), self.assertRaises(frappe.PermissionError):
                self._as(profile, recount_amount_paid, PO, po)

        self.assertEqual(self._stored(PO, po), (0.0, 1000.0))
