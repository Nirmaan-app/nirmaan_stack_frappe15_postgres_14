# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A revision increase spends the PO's overpaid credit, measured BEFORE the PO grows.

THE BUG (PO/138/00187/26-27, 2026-10-12)

The PO was paid in full (₹71,543), then revised down by ₹2,986.34, leaving ₹2,986.35 of real
overpaid credit. A later revision raised it by ₹19,255.83. The credit should have covered part of
that, leaving a new term of ₹16,269.48. The new term was the full ₹19,255.83, and the adjustment
stayed Pending at −₹2,986.35, locking the PO's payments. PO/051/00086/25-26 hit the same bug.

`on_approval_revision` saved the PO with its NEW total first and only then asked
`usable_po_credit` what it could spend. The D2 cap compares amount_paid with the PO total, so
against the already-raised total the real overpayment reads as 0 and the credit is never spent.

THE OTHER HALF, which a careless fix breaks: the cap itself must still hold. A ledger that claims
credit on a PO that paid nothing (PO/246/00103/26-27) must not shrink the new term.

These tests drive `on_approval_revision` itself, because the bug is the ORDER of its steps. They
write nothing that survives: doc hooks are off, vendor credit is patched out, nothing commits,
and `tearDown` rolls the whole transaction back.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.po_revisions.revision_logic import on_approval_revision

RATE, TAX = 100.0, 18.0


def _line_total(qty):
    return flt(qty * RATE * (1 + TAX / 100), 2)


class RevisionIncreaseSpendsCreditTests(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.project = frappe.db.get_value("Projects", {}, "name")
        self.vendor = frappe.db.get_value("Vendors", {}, "name")
        if not (self.project and self.vendor):
            self.skipTest("needs at least one Projects and one Vendors row")

        # PO doc_events reach action items, cashflow holds and critical tasks; none of them is
        # under test, and some fan out to real users.
        orig_hooks = frappe.get_doc_hooks
        frappe.get_doc_hooks = lambda: {}
        self.addCleanup(setattr, frappe, "get_doc_hooks", orig_hooks)

        vendor_credit = patch(
            "nirmaan_stack.api.po_revisions.revision_logic.recalculate_vendor_credit"
        )
        vendor_credit.start()
        self.addCleanup(vendor_credit.stop)

    def tearDown(self):
        frappe.db.rollback()
        super().tearDown()

    # ── fixture ─────────────────────────────────────────────────────────────────

    def _po(self, qty, paid):
        """A PO of one line (qty × ₹100 + 18% tax) with one term, `paid` of it already paid."""
        po = frappe.new_doc("Procurement Orders")
        po.project = self.project
        po.vendor = self.vendor
        po.status = "PO Approved"
        po.append("items", {
            "item_id": f"TEST-REV-CREDIT-{frappe.generate_hash(length=6)}",
            "item_name": "Test DB",
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
            "label": "Full",
            "amount": _line_total(qty),
            "percentage": 100,
            "term_status": "Paid" if paid else "Created",
            "payment_type": "Cash",
        })
        po.insert(ignore_permissions=True, ignore_links=True)
        frappe.db.set_value("Procurement Orders", po.name, "amount_paid", paid)
        return po.name

    def _approve(self, po_name, new_qty):
        """Raise and approve a revision that sets the PO's one line to `new_qty`."""
        po = frappe.get_doc("Procurement Orders", po_name)
        row = po.items[0]
        rev = frappe.new_doc("PO Revisions")
        rev.revised_po = po_name
        rev.project = po.project
        rev.vendor = po.vendor
        rev.status = "Pending"
        rev.total_amount_difference = flt(_line_total(new_qty) - flt(po.total_amount), 2)
        rev.append("revision_items", {
            "item_type": "Revised",
            "item_status": "Pending",
            "original_row_id": row.name,
            "original_item_id": row.item_id,
            "original_item_name": row.item_name,
            "original_unit": row.unit,
            "original_qty": row.quantity,
            "original_rate": row.quote,
            "original_amount": row.amount,
            "original_tax": row.tax,
            "original_category": row.category,
            "revision_item_id": row.item_id,
            "revision_item_name": row.item_name,
            "revision_unit": row.unit,
            "revision_qty": new_qty,
            "revision_rate": RATE,
            "revision_amount": new_qty * RATE,
            "revision_tax": TAX,
            "revision_category": row.category,
        })
        rev.insert(ignore_permissions=True, ignore_links=True)
        on_approval_revision(rev.name, _internal=True)
        return rev.name

    def _revision_term(self, po_name, rev_name):
        terms = frappe.get_all(
            "PO Payment Terms",
            filters={"parent": po_name, "label": f"Revision Adjustment - {rev_name}"},
            pluck="amount",
        )
        return flt(terms[0], 2) if terms else None

    def _adjustment(self, po_name):
        return frappe.db.get_value(
            "PO Adjustments", {"po_id": po_name}, ["remaining_impact", "status"], as_dict=True
        )

    # ── tests ───────────────────────────────────────────────────────────────────

    def test_credit_from_an_earlier_decrease_covers_part_of_an_increase(self):
        # PO/138/00187/26-27: paid in full, revised down, then revised up by more.
        po = self._po(qty=10, paid=_line_total(10))  # ₹1,180 paid
        self._approve(po, new_qty=8)  # −₹236 → ₹236 of real overpaid credit
        self.assertAlmostEqual(flt(self._adjustment(po).remaining_impact), -236.0, places=2)

        increase = self._approve(po, new_qty=20)  # +₹1,416

        self.assertEqual(self._revision_term(po, increase), 1180.0)  # 1,416 − 236
        adj = self._adjustment(po)
        self.assertAlmostEqual(flt(adj.remaining_impact), 0.0, places=2)
        self.assertEqual(adj.status, "Done")

    def test_credit_that_covers_the_whole_increase_adds_no_term(self):
        # PO/051/00086/25-26: revised down, then straight back up by the same amount.
        po = self._po(qty=10, paid=_line_total(10))
        self._approve(po, new_qty=8)  # −₹236

        increase = self._approve(po, new_qty=10)  # +₹236

        self.assertIsNone(self._revision_term(po, increase))
        adj = self._adjustment(po)
        self.assertAlmostEqual(flt(adj.remaining_impact), 0.0, places=2)
        self.assertEqual(adj.status, "Done")

    def test_ledger_credit_on_a_po_that_paid_nothing_is_not_spent(self):
        # PO/246/00103/26-27: the ledger claims credit the PO never overpaid. The D2 cap must
        # still refuse it, so the increase is billed in full.
        po = self._po(qty=10, paid=0)
        adj = frappe.new_doc("PO Adjustments")
        adj.po_id = po
        adj.project = self.project
        adj.vendor = self.vendor
        adj.status = "Pending"
        adj.append("adjustment_items", {"entry_type": "Revision Impact", "amount": -236.0})
        adj.insert(ignore_permissions=True, ignore_links=True)
        adj.recalculate_remaining_impact()

        increase = self._approve(po, new_qty=12)  # +₹236

        self.assertEqual(self._revision_term(po, increase), 236.0)
