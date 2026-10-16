# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A Received Vendor Refund settles its PO's negative PO Adjustment balance by itself (#1399, ADR-0032).

THE CASE (PO/005/00107/26-27, PO/124/00102/26-27)

A ₹28,886 bank refund lowered the PO's paid amount on 23-Sep, but nothing told the PO Adjustment:
when a ₹25,488 cut was approved on 9-Oct the adjustment asked for the money again, the PO stayed
payment-locked, and only an admin write-off got it out.

These tests build a PO, its Paid payments, revisions and refunds, and drive the real writers: a
refund saved or deleted (its doc hooks), and a revision approved (`on_approval_revision`). The bank
line create + Unreconcile paths, which commit, are in `test_refund_links_bank`. Nothing here commits;
`tearDown` rolls the transaction back.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.po_adjustments._payment_utils import (
    _create_project_payment,
    _recalculate_amount_paid,
    usable_po_credit,
)
from nirmaan_stack.api.po_adjustments.refund_links import (
    get_po_refund_links,
    sync_po_refund_links,
)
from nirmaan_stack.api.po_revisions.revision_logic import on_approval_revision
from nirmaan_stack.api.po_revisions.revision_po_check import check_po_in_pending_revisions
from nirmaan_stack.services.vendor_refunds import RECEIVED, RECONCILIATION_PENDING

RATE, TAX = 100.0, 18.0
PO = "Procurement Orders"
VENDOR_REFUNDS = "Vendor Refunds"
#: The only doctype whose hooks stay on: the refund hook is a writer under test. PO, payment and
#: vendor hooks fan out to action items, cashflow holds and notifications, none of them under test.
_HOOKED = ("Vendor Refunds",)


def _line_total(qty):
    return flt(qty * RATE * (1 + TAX / 100), 2)


class RefundLinkFixture(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.project = frappe.db.get_value("Projects", {}, "name")
        self.vendor = frappe.db.get_value("Vendors", {}, "name")
        if not (self.project and self.vendor):
            self.skipTest("needs at least one Projects and one Vendors row")

        orig_hooks = frappe.get_doc_hooks
        frappe.get_doc_hooks = lambda: {k: v for k, v in orig_hooks().items() if k in _HOOKED}
        self.addCleanup(setattr, frappe, "get_doc_hooks", orig_hooks)

    def tearDown(self):
        frappe.db.rollback()
        super().tearDown()

    # ── fixture ─────────────────────────────────────────────────────────────────

    def _po(self, qty):
        """A PO of one line (qty × ₹100 + 18% tax), paid in full by one real Paid payment."""
        po = frappe.new_doc(PO)
        po.project = self.project
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
            "label": "Full",
            "amount": _line_total(qty),
            "percentage": 100,
            "term_status": "Paid",
            "payment_type": "Cash",
        })
        po.insert(ignore_permissions=True, ignore_links=True)
        # A real payment, not a `set_value`: every refund save recomputes amount_paid from payments.
        _create_project_payment(po.name, self.project, self.vendor, _line_total(qty), "Paid")
        _recalculate_amount_paid(po.name)
        return po.name

    def _approve(self, po_name, new_qty):
        """Raise and approve a revision that sets the PO's one line to `new_qty`."""
        po = frappe.get_doc(PO, po_name)
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

    def _refund(self, po_name, amount, status=RECEIVED):
        return frappe.get_doc({
            "doctype": VENDOR_REFUNDS,
            "vendor": self.vendor,
            "project": self.project,
            "document_type": PO,
            "document_name": po_name,
            "amount": amount,
            "payment_date": frappe.utils.today(),
            "status": status,
        }).insert(ignore_permissions=True)

    def _adjustment(self, po_name):
        return frappe.db.get_value(
            "PO Adjustments", {"po_id": po_name}, ["name", "remaining_impact", "status"], as_dict=True
        )

    def _links(self, po_name):
        """{refund: linked amount} over the PO's Vendor Refund ledger entries."""
        adj = self._adjustment(po_name)
        if not adj:
            return {}
        rows = frappe.get_all(
            "PO Adjustment Items",
            filters={"parent": adj.name, "vendor_refund": ["is", "set"]},
            fields=["vendor_refund", "amount", "entry_type", "project_payment"],
        )
        for row in rows:
            self.assertEqual(row.entry_type, "Vendor Refund")
            self.assertFalse(row.project_payment)
        return {row.vendor_refund: flt(row.amount, 2) for row in rows}

    def _paid(self, po_name):
        return flt(frappe.db.get_value(PO, po_name, "amount_paid"), 2)

    def _payment_locked(self, po_name):
        return check_po_in_pending_revisions(po_name)["is_payment_locked"]


class TestARefundSettlesTheBalance(RefundLinkFixture):
    def test_refund_first_then_a_cut_is_settled_on_approval(self):
        # PO/005/00107/26-27: a ₹28,886 refund lands, then a ₹25,488 cut is approved.
        po = self._po(qty=300)  # ₹35,400, paid in full
        refund = self._refund(po, 28886)
        self.assertEqual(self._paid(po), 35400 - 28886)

        self._approve(po, new_qty=84)  # 216 × ₹118 = ₹25,488 cut

        self.assertEqual(self._links(po), {refund.name: 25488.0})
        adj = self._adjustment(po)
        self.assertEqual(flt(adj.remaining_impact, 2), 0.0)
        self.assertEqual(adj.status, "Done")
        self.assertFalse(self._payment_locked(po))
        # The refund lowered the paid amount once; the link moved it no further.
        self.assertEqual(self._paid(po), 35400 - 28886)
        self.assertEqual(usable_po_credit(po), 0.0)
        # The ₹3,398 the refund holds beyond the cut is the PO's warning.
        self.assertEqual(
            get_po_refund_links(po), {"received": 28886.0, "linked": 25488.0, "over_balance": 3398.0}
        )

    def test_a_link_creates_no_payment_and_no_payment_term(self):
        po = self._po(qty=300)
        self._approve(po, new_qty=84)
        payments = frappe.db.count("Project Payments", {"document_name": po})
        terms = frappe.db.count("PO Payment Terms", {"parent": po})

        self._refund(po, 25488)

        self.assertEqual(frappe.db.count("Project Payments", {"document_name": po}), payments)
        self.assertEqual(frappe.db.count("PO Payment Terms", {"parent": po}), terms)

    def test_a_refund_with_no_adjustment_is_all_over_the_balance(self):
        po = self._po(qty=10)
        self._refund(po, 500)
        self.assertIsNone(self._adjustment(po))
        self.assertEqual(get_po_refund_links(po)["over_balance"], 500.0)

    def test_a_later_cut_links_more_of_the_same_refund(self):
        po = self._po(qty=300)
        refund = self._refund(po, 28886)
        self._approve(po, new_qty=84)  # ₹25,488
        self._approve(po, new_qty=70)  # another 14 × ₹118 = ₹1,652
        self.assertEqual(self._links(po), {refund.name: 27140.0})
        self.assertEqual(get_po_refund_links(po)["over_balance"], 1746.0)
        self.assertEqual(self._adjustment(po).status, "Done")

    def test_refunds_settle_oldest_first_and_each_only_up_to_the_balance(self):
        po = self._po(qty=300)
        self._approve(po, new_qty=84)  # ₹25,488
        first = self._refund(po, 20000)
        second = self._refund(po, 8000)
        self.assertEqual(self._links(po), {first.name: 20000.0, second.name: 5488.0})
        self.assertEqual(flt(self._adjustment(po).remaining_impact, 2), 0.0)


class TestARefundLeavingUndoesItsLink(RefundLinkFixture):
    def test_deleting_a_linked_refund_brings_the_balance_and_the_lock_back(self):
        po = self._po(qty=300)
        self._approve(po, new_qty=84)
        refund = self._refund(po, 25488)
        self.assertFalse(self._payment_locked(po))

        # A Desk delete: no `force`, so Frappe's link check runs after the refund's on_trash.
        frappe.delete_doc(VENDOR_REFUNDS, refund.name, ignore_permissions=True)

        self.assertEqual(self._links(po), {})
        self.assertEqual(flt(self._adjustment(po).remaining_impact, 2), -25488.0)
        self.assertTrue(self._payment_locked(po))
        self.assertEqual(self._paid(po), 35400.0)

    def test_deleting_one_refund_re_links_another_into_the_balance_it_leaves(self):
        po = self._po(qty=300)
        self._approve(po, new_qty=84)  # ₹25,488
        first = self._refund(po, 20000)
        second = self._refund(po, 8000)

        frappe.delete_doc(VENDOR_REFUNDS, first.name, ignore_permissions=True)

        self.assertEqual(self._links(po), {second.name: 8000.0})
        self.assertEqual(flt(self._adjustment(po).remaining_impact, 2), -17488.0)

    def test_a_refund_that_stops_counting_drops_its_link(self):
        po = self._po(qty=300)
        self._approve(po, new_qty=84)
        refund = self._refund(po, 25488)

        # Unreconcile of a matched waiting refund (#1401) will send it back like this.
        refund.status = RECONCILIATION_PENDING
        refund.save(ignore_permissions=True)

        self.assertEqual(self._links(po), {})
        self.assertTrue(self._payment_locked(po))

    def test_a_refund_moved_to_another_po_takes_its_link_with_it(self):
        first, second = self._po(qty=300), self._po(qty=300)
        self._approve(first, new_qty=84)
        self._approve(second, new_qty=84)
        refund = self._refund(first, 25488)

        # A Received refund's PO is fixed (#1400): it moves only after Unreconcile sends it back
        # to waiting, and links again once it is Received on its new PO.
        refund.status = RECONCILIATION_PENDING
        refund.save(ignore_permissions=True)
        refund.document_name = second
        refund.save(ignore_permissions=True)
        refund.status = RECEIVED
        refund.save(ignore_permissions=True)

        self.assertEqual(self._links(first), {})
        self.assertEqual(self._links(second), {refund.name: 25488.0})
        self.assertTrue(self._payment_locked(first))
        self.assertFalse(self._payment_locked(second))


class TestAWaitingRefund(RefundLinkFixture):
    def test_a_waiting_refund_links_nothing_until_it_is_received(self):
        po = self._po(qty=300)
        self._approve(po, new_qty=84)
        refund = self._refund(po, 25488, status=RECONCILIATION_PENDING)
        self.assertEqual(self._links(po), {})
        self.assertTrue(self._payment_locked(po))
        self.assertEqual(get_po_refund_links(po)["received"], 0.0)

        # The match path (#1401) sets it Received by a save, so the hook links it.
        refund.status = RECEIVED
        refund.save(ignore_permissions=True)

        self.assertEqual(self._links(po), {refund.name: 25488.0})
        self.assertFalse(self._payment_locked(po))


class TestTheSyncStep(RefundLinkFixture):
    def test_running_it_twice_changes_nothing(self):
        po = self._po(qty=300)
        refund = self._refund(po, 28886)
        self._approve(po, new_qty=84)
        adj = self._adjustment(po)
        before = (
            frappe.db.get_value("PO Adjustments", adj.name, ["modified", "remaining_impact", "status"]),
            frappe.get_all("PO Adjustment Items", {"parent": adj.name}, ["name", "amount"], order_by="name"),
            self._paid(po),
        )

        sync_po_refund_links([po])
        sync_po_refund_links([po])

        after = (
            frappe.db.get_value("PO Adjustments", adj.name, ["modified", "remaining_impact", "status"]),
            frappe.get_all("PO Adjustment Items", {"parent": adj.name}, ["name", "amount"], order_by="name"),
            self._paid(po),
        )
        self.assertEqual(after, before)
        self.assertEqual(self._links(po), {refund.name: 25488.0})

    def test_it_recounts_paid_amount_amount_due_and_vendor_credit(self):
        po = self._po(qty=300)
        self._refund(po, 1000)
        # Stale figures, as a raw-SQL writer would leave them.
        frappe.db.set_value(PO, po, {"amount_paid": 1, "amount_due": 1})
        ledger = frappe.db.count("Vendor Credit Ledger", {"parent": self.vendor})

        sync_po_refund_links([po], "Vendor Refund Changed")

        self.assertEqual(self._paid(po), 35400.0 - 1000)
        invoiced, due = frappe.db.get_value(PO, po, ["amount_invoiced", "amount_due"])
        self.assertEqual(flt(due, 2), flt(flt(invoiced) - (35400.0 - 1000), 2))
        self.assertEqual(frappe.db.count("Vendor Credit Ledger", {"parent": self.vendor}), ledger + 1)

    def test_the_same_money_lowers_the_paid_amount_once_in_either_order(self):
        refund_first, revision_first = self._po(qty=300), self._po(qty=300)

        self._refund(refund_first, 25488)
        self._approve(refund_first, new_qty=84)
        self._approve(revision_first, new_qty=84)
        self._refund(revision_first, 25488)

        for po in (refund_first, revision_first):
            self.assertEqual(self._paid(po), 35400.0 - 25488)
            self.assertEqual(flt(self._adjustment(po).remaining_impact, 2), 0.0)
            # Nothing left for a credit push, pull, revision increase or second refund to spend.
            self.assertEqual(usable_po_credit(po), 0.0)

    def test_revision_first_then_a_refund_settles_the_balance_and_unlocks(self):
        po = self._po(qty=300)
        self._approve(po, new_qty=84)  # ₹25,488 overpaid
        self.assertEqual(self._adjustment(po).status, "Pending")
        self.assertTrue(self._payment_locked(po))

        refund = self._refund(po, 25488)

        self.assertEqual(self._links(po), {refund.name: 25488.0})
        self.assertEqual(self._adjustment(po).status, "Done")
        self.assertFalse(self._payment_locked(po))
        self.assertEqual(get_po_refund_links(po)["over_balance"], 0.0)
