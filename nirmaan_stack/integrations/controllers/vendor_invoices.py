# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Keep `invoice_amount` on the parent Procurement Order / Service Request true.

Wired to the Vendor Invoices doctype itself (`doc_events` in hooks.py), NOT called
by hand from the invoice endpoints. That is deliberate: there are nine ways an
invoice appears, changes or disappears, and three of them run no application code
we would remember to edit —

    * the backfill patch re-saving invoices (`patches/v3_0/backfill_invoice_qty.py`)
    * the legacy migration creating them ALREADY APPROVED
      (`patches/v3_0/migrate_invoices_to_vendor_invoices.py`)
    * anyone editing an invoice in the Frappe desk

`recompute_po_invoice_qty` is still called explicitly from the endpoints and MUST
STAY THAT WAY: it counts a different set (Pending+Approved, credit notes excluded)
and writes every Purchase Order Item row, so putting it on doc events would fire it
on paths it deliberately does not run on today.
"""

from nirmaan_stack.api.invoices._item_billing_sync import (
    recompute_document_amount_invoiced,
)

# A change to any of these moves the parent's total. Everything else a Vendor
# Invoice save can touch — reconciliation fields, the AI autofill blob, the line
# mappings — leaves it identical, and there are far more of those saves.
_TOTAL_AFFECTING_FIELDS = (
    "status",
    "invoice_amount",
    "document_type",
    "document_name",
)


def recompute_parent_total(doc, method=None):
    """Recompute the parent's `invoice_amount`. Bound to after_insert / on_update /
    after_delete.

    `after_delete`, never `on_trash`: on_trash fires BEFORE the row leaves the
    database, so the sum would still count the invoice being deleted. Project
    Expenses and Non Project Expenses already moved for this reason.

    `get_doc_before_save()` returns None on both insert and delete, so those fall
    through to an unconditional recompute — correct for both — and the early exit
    applies only to updates.

    Raises rather than swallowing. This is one SELECT plus one UPDATE inside the
    caller's transaction; if it cannot run, a silently stale total is the worse
    outcome, so the invoice event rolls back with it.
    """
    targets = {(doc.document_type, doc.document_name)}

    before = doc.get_doc_before_save()
    if before is not None:
        if not any(before.get(f) != doc.get(f) for f in _TOTAL_AFFECTING_FIELDS):
            return
        # The invoice was re-pointed at a different order: the one it LEFT still
        # holds a total that includes it, so recompute both sides.
        targets.add((before.document_type, before.document_name))

    for document_type, document_name in targets:
        recompute_document_amount_invoiced(document_type, document_name)
