# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A Received Vendor Refund lowers its PO's `amount_paid` -- on insert, on turning Received and on delete
-- and a later payment recompute keeps it lowered. Its amount and PO change only while it waits (#1400).

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
from nirmaan_stack.api.vendor_credit import _compute_credit_used
from nirmaan_stack.api.vendor_refunds import credit_fixture
from nirmaan_stack.services.vendor_refunds import (
    CANCELLED,
    RECEIVED,
    RECONCILIATION_PENDING,
    refund_documents,
)

VENDOR_REFUNDS = "Vendor Refunds"
PO = "Procurement Orders"
_FIGURES = ["amount_paid", "amount_due", "modified", "modified_by"]


class TestAVendorRefundMovesAmountPaid(unittest.TestCase):
    refunds: list = []
    #: Extra SQL narrowing which POs are picked; a subclass sets it.
    _EXTRA_PO_FILTER = ""

    @classmethod
    def setUpClass(cls):
        frappe.set_user("Administrator")
        cls.refunds = []
        pair = frappe.db.sql(
            f"""
            SELECT po.vendor, po.project, array_agg(po.name ORDER BY po.name) AS names
            FROM "tabProcurement Orders" po
            WHERE po.status <> 'Merged' AND po.amount_paid >= 1000
              AND po.vendor IS NOT NULL AND po.project IS NOT NULL {cls._EXTRA_PO_FILTER}
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
        # Each refund save recounts this vendor's credit (#1398); put it back as found.
        cls.credit = credit_fixture.snapshot([cls.vendor])
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        credit_fixture.restore(cls.credit)
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
                # What every refund was before #1398, and what a bank-line refund still is.
                "status": RECEIVED,
                **extra,
            }
        ).insert(ignore_permissions=True)
        self.refunds.append(doc.name)
        # Through the hook, so a failed test does not leave its refund on the PO for the next one.
        self.addCleanup(self._drop, doc.name)
        return doc

    def _drop(self, name):
        frappe.db.rollback()
        if frappe.db.exists(VENDOR_REFUNDS, name):
            frappe.delete_doc(VENDOR_REFUNDS, name, ignore_permissions=True)

    def _paid(self, po):
        return flt(frappe.db.get_value(PO, po, "amount_paid"))

    def _was(self, po):
        return flt(self.figures[po].amount_paid)

    def _assert_due_follows_paid(self, po):
        invoiced, paid, due = frappe.db.get_value(PO, po, ["amount_invoiced", "amount_paid", "amount_due"])
        self.assertAlmostEqual(flt(due), flt(invoiced) - flt(paid), places=2)

    # --- tests -----------------------------------------------------------------------------

    def test_insert_status_change_and_delete_each_recompute(self):
        refund = self._refund(self.first, 100)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first) - 100, places=2)
        self._assert_due_follows_paid(self.first)
        frappe.delete_doc(VENDOR_REFUNDS, refund.name, ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first), places=2)

        # A waiting refund corrected and re-pointed (#1400) moves nothing until it is Received,
        # and then only on the PO it ended up on.
        waiting = self._refund(self.first, 100, status=RECONCILIATION_PENDING)
        waiting.amount = 250
        waiting.save(ignore_permissions=True)
        waiting.document_name = self.second
        waiting.save(ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first), places=2)
        self.assertAlmostEqual(self._paid(self.second), self._was(self.second), places=2)
        waiting.status = RECEIVED
        waiting.save(ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first), places=2)
        self.assertAlmostEqual(self._paid(self.second), self._was(self.second) - 250, places=2)
        self._assert_due_follows_paid(self.second)

        frappe.delete_doc(VENDOR_REFUNDS, waiting.name, ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.second), self._was(self.second), places=2)
        self._assert_due_follows_paid(self.second)

    def test_a_received_refund_s_amount_and_po_are_fixed(self):
        """#1400, ADR-0032: a matched bank record cannot drift; only Unreconcile can change it."""
        refund = self._refund(self.first, 100)
        for field, value in (("amount", 250), ("document_name", self.second)):
            with self.subTest(field=field):
                doc = frappe.get_doc(VENDOR_REFUNDS, refund.name)
                doc.set(field, value)
                with self.assertRaises(frappe.ValidationError):
                    doc.save(ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first) - 100, places=2)

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

        frappe.delete_doc(VENDOR_REFUNDS, refund.name, ignore_permissions=True)

        # Re-saving a refund does not count its own amount against itself. (Only a waiting refund's
        # amount may change, #1400.)
        waiting = self._refund(self.first, 60, status=RECONCILIATION_PENDING)
        waiting.amount = self._was(self.first)
        waiting.save(ignore_permissions=True)
        waiting.amount = self._was(self.first) + 1
        with self.assertRaises(frappe.ValidationError):
            waiting.save(ignore_permissions=True)
        waiting.reload()
        waiting.status = RECEIVED
        waiting.save(ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), 0, places=2)
        frappe.delete_doc(VENDOR_REFUNDS, waiting.name, ignore_permissions=True)

    def test_only_a_received_refund_lowers_the_paid_amount(self):
        waiting = self._refund(self.first, 100, status=RECONCILIATION_PENDING)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first), places=2)

        waiting.status = RECEIVED
        waiting.save(ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first) - 100, places=2)
        self._assert_due_follows_paid(self.first)

        never = self._refund(self.first, 30, status=RECONCILIATION_PENDING)
        never.status = CANCELLED
        never.save(ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first) - 100, places=2)

        frappe.delete_doc(VENDOR_REFUNDS, waiting.name, ignore_permissions=True)
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first), places=2)

    def test_the_cap_counts_a_waiting_refund_but_not_a_cancelled_one(self):
        paid = self._was(self.first)
        waiting = self._refund(self.first, paid, status=RECONCILIATION_PENDING)

        row = {d["name"]: d for d in refund_documents(self.vendor, self.project)[PO]}[self.first]
        self.assertAlmostEqual(row["paid"], paid, places=2)
        self.assertAlmostEqual(row["refunded"], paid, places=2)
        self.assertAlmostEqual(row["refundable"], 0, places=2)
        with self.assertRaises(frappe.ValidationError):
            self._refund(self.first, 1)

        waiting.status = CANCELLED
        waiting.save(ignore_permissions=True)
        self._refund(self.first, paid)
        self.assertAlmostEqual(self._paid(self.first), 0, places=2)


    def test_the_patch_makes_every_refund_from_before_the_status_received_and_runs_twice(self):
        from nirmaan_stack.patches.v3_0.set_vendor_refunds_received import mark_refunds_received

        older = self._refund(self.first, 20)
        waiting = self._refund(self.first, 30, status=RECONCILIATION_PENDING)
        # The shape a refund recorded before #1398 has once the column exists: no status at all.
        frappe.db.sql('UPDATE "tabVendor Refunds" SET status = NULL WHERE name = %s', older.name)

        self.assertEqual(mark_refunds_received([older.name, waiting.name]), 1)
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, older.name, "status"), RECEIVED)
        self.assertEqual(frappe.db.get_value(VENDOR_REFUNDS, waiting.name, "status"), RECONCILIATION_PENDING)
        # It already counted before the patch, so the paid amount does not move.
        self.assertAlmostEqual(self._paid(self.first), self._was(self.first) - 20, places=2)

        self.assertEqual(mark_refunds_received([older.name, waiting.name]), 0)


class TestAVendorRefundRecountsVendorCredit(TestAVendorRefundMovesAmountPaid):
    """Saving, changing or deleting a refund recounts its vendor's credit (#1398), as a payment does.

    Two real POs of one vendor that are UNDERPAID by at least Rs 1,000 against what was delivered, and
    created after April 2025: each counts `delivered - paid` towards credit used, so a Received refund
    of X raises the vendor's credit used by exactly X, and a refund that lowers no paid amount moves
    nothing. Re-runs the parent's tests on these POs too.
    """

    _EXTRA_PO_FILTER = """
        AND po.status NOT IN ('Cancelled', 'Merged', 'Inactive') AND po.creation >= '2025-04-01'
        AND COALESCE(po.po_amount_delivered, 0) >= po.amount_paid + 1000"""

    def setUp(self):
        self.base = _compute_credit_used(frappe.get_doc("Vendors", self.vendor))
        self.ledger = set(frappe.get_all("Vendor Credit Ledger", {"parent": self.vendor}, pluck="name"))

    def _credit_used(self):
        return flt(frappe.db.get_value("Vendors", self.vendor, "credit_used"))

    def _new_ledger_rows(self):
        rows = frappe.get_all(
            "Vendor Credit Ledger",
            filters={"parent": self.vendor},
            fields=["name", "entry_type", "po_id"],
            order_by="creation asc",
        )
        return [r for r in rows if r.name not in self.ledger]

    def test_create_change_repoint_and_delete_each_recount_the_vendor_s_credit(self):
        refund = self._refund(self.first, 100, status=RECONCILIATION_PENDING)
        self.assertAlmostEqual(self._credit_used(), self.base, places=2)
        entries = self._new_ledger_rows()
        self.assertEqual(len(entries), 1)
        self.assertIn(self.first, entries[0].po_id)

        refund.amount = 250
        refund.save(ignore_permissions=True)
        refund.document_name = self.second
        refund.save(ignore_permissions=True)
        self.assertAlmostEqual(self._credit_used(), self.base, places=2)
        # Both POs named: the one it left and the one it moved to.
        self.assertIn(self.first, self._new_ledger_rows()[-1].po_id)
        self.assertIn(self.second, self._new_ledger_rows()[-1].po_id)

        refund.status = RECEIVED
        refund.save(ignore_permissions=True)
        self.assertAlmostEqual(self._credit_used(), self.base + 250, places=2)

        frappe.delete_doc(VENDOR_REFUNDS, refund.name, ignore_permissions=True)
        self.assertAlmostEqual(self._credit_used(), self.base, places=2)
        self.assertEqual(
            [r.entry_type for r in self._new_ledger_rows()],
            ["Vendor Refund Recorded", "Vendor Refund Changed", "Vendor Refund Changed",
             "Vendor Refund Changed", "Vendor Refund Deleted"],
        )

    def test_a_waiting_refund_moves_no_credit_until_it_is_received(self):
        waiting = self._refund(self.first, 100, status=RECONCILIATION_PENDING)
        self.assertAlmostEqual(
            flt(_compute_credit_used(frappe.get_doc("Vendors", self.vendor))), self.base, places=2
        )
        waiting.status = RECEIVED
        waiting.save(ignore_permissions=True)
        self.assertAlmostEqual(self._credit_used(), self.base + 100, places=2)
