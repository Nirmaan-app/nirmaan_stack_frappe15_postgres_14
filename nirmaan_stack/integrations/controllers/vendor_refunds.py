# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Keep `amount_paid` on the PO / Work Order a Vendor Refund is against true (owner, 2026-09-17).

The stored figure is the document's Paid payments LESS its refunds (`services/vendor_refunds.amount_paid_of`).
Wired to the Vendor Refunds doctype itself (`doc_events` in hooks.py), so every way a refund appears,
changes or disappears recomputes it: the bank-statement import, its Undo (`frappe.delete_doc`), and a
Desk edit or delete. A raw-SQL delete runs no hook -- such a caller must recompute itself.

⚠️ NEVER COMMITS. The import writes refunds inside a savepoint; a commit here would end it.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.api.invoices._item_billing_sync import recompute_document_amount_due
from nirmaan_stack.services.vendor_refunds import REFUND_DOCUMENT_FIELDS, amount_paid_of


def recompute_document_amount_paid(doc, method=None):
    """Recompute `amount_paid` (and `amount_due`, derived from it) on the refund's document. Bound to
    on_update / after_delete.

    `after_delete`, never `on_trash`: on_trash fires BEFORE the row leaves the database, so the sum
    would still count the refund being deleted. `get_doc_before_save()` is None on insert and delete.
    """
    before = doc.get_doc_before_save()
    if before is not None and (before.document_type, before.document_name, flt(before.amount)) == (
        doc.document_type,
        doc.document_name,
        flt(doc.amount),
    ):
        return  # a UTR / description / attachment edit moves no money

    # Both sides when a refund is re-pointed: the document it LEFT still stores a total without it.
    targets = {(doc.document_type, doc.document_name)}
    if before is not None:
        targets.add((before.document_type, before.document_name))

    for document_type, document_name in targets:
        # A Misc. Expense names no document, so it has no paid amount to move.
        if document_type not in REFUND_DOCUMENT_FIELDS or not document_name:
            continue
        # `set_value`, like the payment-side recompute: saving the PO / WO would fire its own hooks.
        frappe.db.set_value(
            document_type, document_name, "amount_paid", amount_paid_of(document_type, document_name)
        )
        recompute_document_amount_due(document_type, document_name)
