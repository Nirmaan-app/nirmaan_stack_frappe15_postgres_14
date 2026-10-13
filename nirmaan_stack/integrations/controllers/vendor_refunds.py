# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Keep `amount_paid` on the PO / Work Order a Vendor Refund is against true (owner, 2026-09-17).

The stored figure is the document's Paid payments LESS its refunds (`services/vendor_refunds.amount_paid_of`).
Wired to the Vendor Refunds doctype itself (`doc_events` in hooks.py), so every way a refund appears,
changes or disappears recomputes it: the bank-statement import, its Undo (`frappe.delete_doc`), and a
Desk edit or delete. A raw-SQL delete runs no hook -- such a caller must recompute itself.

On a PO it runs the REFUND SYNC STEP (`api/po_adjustments/refund_links.sync_po_refund_links`, #1399,
ADR-0032): the PO's paid amount and amount due, its PO Adjustment's Vendor Refund links (a Received
refund settles the negative balance by itself), and THE VENDOR'S CREDIT (#1398), as a payment does:
credit used reads the PO's stored `amount_paid`, so a refund that moves it moves credit used and
available credit too, and Vendor Hold reads a current figure. A refund against a Work Order or a Misc.
Expense has no link and no credit to move (both are PO-only); only its paid amount is recomputed here.
This is the ONE place a refund save recounts credit.

⚠️ NEVER COMMITS. The import writes refunds inside a savepoint; a commit here would end it.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.invoices._item_billing_sync import recompute_document_amount_due
from nirmaan_stack.api.po_adjustments.refund_links import sync_po_refund_links, unlink_refund
from nirmaan_stack.services.vendor_refunds import (
    PROCUREMENT_ORDERS,
    REFUND_DOCUMENT_FIELDS,
    amount_paid_of,
)

#: The `Vendor Credit Ledger` entry each kind of refund event writes.
ENTRY_RECORDED = "Vendor Refund Recorded"
ENTRY_CHANGED = "Vendor Refund Changed"
ENTRY_DELETED = "Vendor Refund Deleted"


def recompute_document_amount_paid(doc, method=None):
    """Recompute `amount_paid` (and `amount_due`, derived from it) on the refund's document, then the
    credit of the vendor behind each PO it touched. Bound to on_update / after_delete.

    `after_delete`, never `on_trash`: on_trash fires BEFORE the row leaves the database, so the sum
    would still count the refund being deleted. `get_doc_before_save()` is None on insert and delete.
    """
    before = doc.get_doc_before_save()
    if before is not None and _money_fields(before) == _money_fields(doc):
        return  # a UTR / description / attachment edit moves no money

    # Both sides when a refund is re-pointed: the document it LEFT still stores a total without it.
    targets = {(doc.document_type, doc.document_name)}
    if before is not None:
        targets.add((before.document_type, before.document_name))

    for document_type, document_name in targets:
        # A Misc. Expense names no document, so it has no paid amount to move. A PO is the sync's.
        if document_type not in REFUND_DOCUMENT_FIELDS or document_type == PROCUREMENT_ORDERS:
            continue
        if not document_name:
            continue
        # `set_value`, like the payment-side recompute: saving the PO / WO would fire its own hooks.
        frappe.db.set_value(
            document_type, document_name, "amount_paid", amount_paid_of(document_type, document_name)
        )
        recompute_document_amount_due(document_type, document_name)

    # Paid amount, links and credit, from source; folded so a re-point writes one credit entry.
    pos = [name for document_type, name in targets if document_type == PROCUREMENT_ORDERS and name]
    if pos:
        if method == "after_delete":
            entry_type = ENTRY_DELETED
        elif before is None:
            entry_type = ENTRY_RECORDED
        else:
            entry_type = ENTRY_CHANGED
        sync_po_refund_links(pos, entry_type)


def unlink_from_adjustments(doc, method=None):
    """Bound to on_trash: drop the PO Adjustment entries pointing at this refund before it goes.

    Frappe's link check runs after on_trash and would refuse the delete while an entry still names
    it. `after_delete` then runs the full sync, which may re-link the PO's other refunds.
    """
    unlink_refund(doc.name)


def _money_fields(doc) -> tuple:
    """What a refund's money depends on. The STATUS is one (#1398): only a Received refund lowers the
    paid amount, so a refund turning Received, or leaving it, moves money with nothing else changed."""
    return (doc.document_type, doc.document_name, flt(doc.amount), doc.status)
