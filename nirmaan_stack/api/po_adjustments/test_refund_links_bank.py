# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A refund recorded from a bank line settles the PO Adjustment balance; its Unreconcile undoes it (#1399).

The Bulk Import writers through their real endpoints: `create_vendor_refund` (create from a credit
line) and `unreconcile_row`. Both COMMIT, so this suite builds its own PO, payment and revision on
the fixture's real vendor and project, commits them, and purges them in `tearDownClass`; the bank
rows, refunds, PO figures and vendor credit are put back by `InflowFixture`.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.outflow_import.test_inflows import InflowFixture
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.api.po_adjustments._payment_utils import (
    _create_project_payment,
    _recalculate_amount_paid,
)
from nirmaan_stack.api.po_adjustments.refund_links import get_po_refund_links
from nirmaan_stack.api.po_revisions.revision_logic import on_approval_revision
from nirmaan_stack.api.po_revisions.revision_po_check import check_po_in_pending_revisions

PO = "Procurement Orders"
RATE, TAX = 100.0, 18.0


def _line_total(qty):
    return flt(qty * RATE * (1 + TAX / 100), 2)


class TestABankLineRefundSettlesTheBalance(InflowFixture):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.own_pos, cls.own_revisions = [], []

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        scopes = [
            ("PO Adjustment Items", {"parent": ["in", cls._adjustments()]}),
            ("PO Adjustments", {"po_id": ["in", cls.own_pos]}),
            ("PO Revisions Items", {"parent": ["in", cls.own_revisions]}),
            ("PO Revisions", {"name": ["in", cls.own_revisions]}),
            ("Project Payments", {"document_name": ["in", cls.own_pos]}),
            ("PO Payment Terms", {"parent": ["in", cls.own_pos]}),
            ("Purchase Order Item", {"parent": ["in", cls.own_pos]}),
            ("Version", {"docname": ["in", cls.own_pos + cls.own_revisions + cls._adjustments()]}),
            (PO, {"name": ["in", cls.own_pos]}),
        ]
        failures = []
        for doctype, filters in scopes:
            if not cls.own_pos:
                break
            try:
                frappe.db.delete(doctype, filters)
                frappe.db.commit()
            except Exception as e:  # report, keep purging the rest
                frappe.db.rollback()
                failures.append(f"{doctype}: {e}")
        super().tearDownClass()
        if failures:
            raise AssertionError("purge failed: " + "; ".join(failures))

    @classmethod
    def _adjustments(cls):
        if not cls.own_pos:
            return []
        return frappe.get_all("PO Adjustments", {"po_id": ["in", cls.own_pos]}, pluck="name") or [""]

    def _without_po_hooks(self):
        """PO and payment hooks fan out to action items, cashflow holds and notifications."""
        orig = frappe.get_doc_hooks
        frappe.get_doc_hooks = lambda: {}
        return orig

    def _overpaid_po(self, qty, new_qty):
        """A PO of `qty` lines paid in full, then cut to `new_qty` by an approved revision. Committed."""
        orig = self._without_po_hooks()
        try:
            po = frappe.new_doc(PO)
            po.project = self.refund_project
            po.vendor = self.vendor
            po.status = "PO Approved"
            po.append("items", {
                "item_id": f"TEST-REFUND-LINK-{frappe.generate_hash(length=6)}",
                "item_name": "Test refund link",
                "unit": "Nos",
                "quantity": qty,
                "quote": RATE,
                "amount": qty * RATE,
                "tax": TAX,
                "tax_amount": qty * RATE * TAX / 100,
                "total_amount": _line_total(qty),
                "category": "Test Category",
            })
            po.append("payment_terms", {
                "label": "Full", "amount": _line_total(qty), "percentage": 100,
                "term_status": "Paid", "payment_type": "Cash",
            })
            po.insert(ignore_permissions=True, ignore_links=True)
            self.own_pos.append(po.name)
            frappe.db.commit()
            _create_project_payment(po.name, self.refund_project, self.vendor, _line_total(qty), "Paid")
            _recalculate_amount_paid(po.name)

            row = po.items[0]
            rev = frappe.new_doc("PO Revisions")
            rev.revised_po = po.name
            rev.project = po.project
            rev.vendor = po.vendor
            rev.status = "Pending"
            rev.total_amount_difference = flt(_line_total(new_qty) - _line_total(qty), 2)
            rev.append("revision_items", {
                "item_type": "Revised", "item_status": "Pending",
                "original_row_id": row.name, "original_item_id": row.item_id,
                "original_item_name": row.item_name, "original_unit": row.unit,
                "original_qty": row.quantity, "original_rate": row.quote,
                "original_amount": row.amount, "original_tax": row.tax,
                "original_category": row.category,
                "revision_item_id": row.item_id, "revision_item_name": row.item_name,
                "revision_unit": row.unit, "revision_qty": new_qty, "revision_rate": RATE,
                "revision_amount": new_qty * RATE, "revision_tax": TAX,
                "revision_category": row.category,
            })
            rev.insert(ignore_permissions=True, ignore_links=True)
            self.own_revisions.append(rev.name)
            on_approval_revision(rev.name, _internal=True)
            frappe.db.commit()
        finally:
            frappe.get_doc_hooks = orig
        return po.name

    def _adjustment(self, po):
        return frappe.db.get_value(
            "PO Adjustments", {"po_id": po}, ["name", "remaining_impact", "status"], as_dict=True
        )

    def _links(self, po):
        return {
            r.vendor_refund: flt(r.amount, 2)
            for r in frappe.get_all(
                "PO Adjustment Items",
                filters={"parent": self._adjustment(po).name, "vendor_refund": ["is", "set"]},
                fields=["vendor_refund", "amount"],
            )
        }

    def _locked(self, po):
        return check_po_in_pending_revisions(po)["is_payment_locked"]

    def test_revision_first_then_a_bank_line_refund_unlocks_and_unreconcile_locks_again(self):
        po = self._overpaid_po(qty=10, new_qty=5)  # ₹590 overpaid
        self.assertTrue(self._locked(po))

        row, summary = self._refund(
            row=self._refund_row(amount="590.00"),
            vendor=self.vendor, project=self.refund_project, allocations=[self._po(po, "590")],
        )
        refund = summary["records"][0]["name"]

        self.assertEqual(self._links(po), {refund: 590.0})
        self.assertEqual(self._adjustment(po).status, "Done")
        self.assertFalse(self._locked(po))

        unreconcile_row(row=row["name"], legs="all", reason="test: refund link undo")

        self.assertEqual(self._links(po), {})
        self.assertEqual(flt(self._adjustment(po).remaining_impact, 2), -590.0)
        self.assertTrue(self._locked(po))
        self.assertEqual(flt(frappe.db.get_value(PO, po, "amount_paid"), 2), 1180.0)

    def test_a_bank_line_refund_larger_than_the_balance_links_up_to_it_and_warns(self):
        po = self._overpaid_po(qty=10, new_qty=5)  # ₹590 overpaid
        _, summary = self._refund(
            row=self._refund_row(amount="1000.00"),
            vendor=self.vendor, project=self.refund_project, allocations=[self._po(po, "1000")],
        )
        refund = summary["records"][0]["name"]

        self.assertEqual(self._links(po), {refund: 590.0})
        self.assertFalse(self._locked(po))
        self.assertEqual(get_po_refund_links(po)["over_balance"], 410.0)
