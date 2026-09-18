# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A Vendor Refund lowers its PO's `amount_paid` -- on insert, edit, re-point and delete -- and a later
payment recompute keeps it lowered.

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.nirmaan_stack.doctype.vendor_refunds.test_vendor_refunds

⚠️ RUNS AGAINST THE LIVE SITE DB, on two real PAID POs of one vendor on one project whose stored
`amount_paid` already equals the sum of their Paid payments and which carry no refund yet -- so every
expected figure is `stored - refunds`, with no drift to explain. Their stored paid figures are captured
first and written back exactly as found; the refunds, their Version rows and their Deleted Document
rows are purged.
"""

import unittest

import frappe
from frappe.utils import flt

from nirmaan_stack.api.po_adjustments._payment_utils import _recalculate_amount_paid
from nirmaan_stack.services.vendor_refunds import refund_documents

VENDOR_REFUNDS = "Vendor Refunds"
PO = "Procurement Orders"
_FIGURES = ["amount_paid", "amount_due", "modified", "modified_by"]


class TestAVendorRefundMovesAmountPaid(unittest.TestCase):
    refunds: list = []

    @classmethod
    def setUpClass(cls):
        frappe.set_user("Administrator")
        cls.refunds = []
        pair = frappe.db.sql(
            """
            SELECT po.vendor, po.project, array_agg(po.name ORDER BY po.name) AS names
            FROM "tabProcurement Orders" po
            WHERE po.status <> 'Merged' AND po.amount_paid >= 1000
              AND po.vendor IS NOT NULL AND po.project IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM "tabVendor Refunds" r
                  WHERE r.document_type = 'Procurement Orders' AND r.document_name = po.name)
              AND ABS(po.amount_paid - COALESCE((
                  SELECT SUM(pp.amount) FROM "tabProject Payments" pp
                  WHERE pp.document_type = 'Procurement Orders' AND pp.document_name = po.name
                    AND pp.status = 'Paid'), 0)) < 0.01
            GROUP BY po.vendor, po.project HAVING COUNT(*) >= 2
            ORDER BY po.vendor, po.project LIMIT 1
            """,
            as_dict=True,
        )[0]
        cls.vendor, cls.project = pair.vendor, pair.project
        cls.first, cls.second = pair.names[:2]
        cls.figures = {po: frappe.db.get_value(PO, po, _FIGURES, as_dict=True) for po in (cls.first, cls.second)}
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        if cls.refunds:
            for side in ("Version", "Nirmaan Versions"):
                frappe.db.delete(side, {"ref_doctype": VENDOR_REFUNDS, "docname": ["in", cls.refunds]})
            frappe.db.delete(
                "Deleted Document", {"deleted_doctype": VENDOR_REFUNDS, "deleted_name": ["in", cls.refunds]}
            )
            frappe.db.delete(VENDOR_REFUNDS, {"name": ["in", cls.refunds]})
        for po, figures in cls.figures.items():
            frappe.db.set_value(PO, po, figures, update_modified=False)
        frappe.db.commit()

    # --- helpers ---------------------------------------------------------------------------

    def _refund(self, po, amount, **extra):
        doc = frappe.get_doc(
            {
                "doctype": VENDOR_REFUNDS,
                "vendor": self.vendor,
                "project": self.project,
                "document_type": PO,
                "document_name": po,
                "amount": amount,
                "payment_date": frappe.utils.today(),
                **extra,
            }
        ).insert(ignore_permissions=True)
        self.refunds.append(doc.name)
        return doc

    def _paid(self, po):
        return flt(frappe.db.get_value(PO, po, "amount_paid"))

    def _was(self, po):
        return flt(self.figures[po].amount_paid)

    def _assert_due_follows_paid(self, po):
        invoiced, paid, due = frappe.db.get_value(PO, po, ["amount_invoiced", "amount_paid", "amount_due"])
        self.assertAlmostEqual(flt(due), flt(invoiced) - flt(paid), places=2)

    # --- tests -----------------------------------------------------------------------------

    def test_insert_edit_repoint_and_delete_each_recompute(self):
        refund = self._refund(self.first, 100)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first) - 100, places=2)
        self._assert_due_follows_paid(self.first)

        refund.amount = 250
        refund.save(ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first) - 250, places=2)

        # Re-pointed: the PO it LEFT gets its paid amount back, the new one loses the refund.
        refund.document_name = self.second
        refund.save(ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first), places=2)
        self.assertAlmostEqual(self._paid(self.second), self._was(self.second) - 250, places=2)
        self._assert_due_follows_paid(self.first)
        self._assert_due_follows_paid(self.second)

        frappe.delete_doc(VENDOR_REFUNDS, refund.name, ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.second), self._was(self.second), places=2)
        self._assert_due_follows_paid(self.second)

    def test_an_edit_that_moves_no_money_leaves_the_po_untouched(self):
        refund = self._refund(self.first, 10)
        modified = frappe.db.get_value(PO, self.first, "modified")
        refund.utr = "TEST-UTR-ONLY"
        refund.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value(PO, self.first, "modified"), modified)
        frappe.delete_doc(VENDOR_REFUNDS, refund.name, ignore_permissions=True)

    def test_a_payment_recompute_keeps_the_refund_off(self):
        refund = self._refund(self.first, 40)
        _recalculate_amount_paid(self.first)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first) - 40, places=2)
        frappe.delete_doc(VENDOR_REFUNDS, refund.name, ignore_permissions=True)

    def test_the_cap_reads_what_was_paid_not_the_net_figure(self):
        refund = self._refund(self.first, 60)
        row = {d["name"]: d for d in refund_documents(self.vendor, self.project)[PO]}[self.first]
        self.assertAlmostEqual(row["paid"], self._was(self.first), places=2)
        self.assertAlmostEqual(row["refunded"], 60, places=2)
        self.assertAlmostEqual(row["refundable"], self._was(self.first) - 60, places=2)

        # Re-saving the refund does not count its own amount against itself.
        refund.amount = self._was(self.first)
        refund.save(ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), 0, places=2)
        refund.amount = self._was(self.first) + 1
        with self.assertRaises(frappe.ValidationError):
            refund.save(ignore_permissions=True)
        frappe.delete_doc(VENDOR_REFUNDS, refund.name, ignore_permissions=True)
