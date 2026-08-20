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

# The stored total sums APPROVED invoices only, so an invoice can only move it while
# it is Approved on one side of the change or the other. Everything else a Vendor
# Invoice save can touch — reconciliation fields, the AI autofill blob, the line
# mappings, and ANY edit to a Pending or Rejected invoice — leaves the total identical.
_APPROVED = "Approved"

# Fields that feed the sum. Only consulted when the invoice is Approved BOTH before and
# after: a status flip already implies a change, and a non-Approved invoice contributes
# nothing whatever these hold.
_SUM_INPUT_FIELDS = (
    "invoice_amount",
    "document_type",
    "document_name",
)


def recompute_parent_total(doc, method=None):
    """Recompute the parent's `amount_invoiced`. Bound to after_insert / on_update /
    after_delete.

    THE RULE, stated once: the total changes only when this invoice is Approved BEFORE
    the change, AFTER it, or both.

      * Pending -> Approved   the parent gains this amount        (recompute the new parent)
      * Approved -> anything  the parent loses it                 (recompute the old parent)
      * Approved -> Approved  only if the amount or the parent moved
      * anything else         the sum is arithmetically unchanged — return

    `after_delete`, never `on_trash`: on_trash fires BEFORE the row leaves the database,
    so the sum would still count the invoice being deleted. Project Expenses and Non
    Project Expenses already moved for this reason.

    `get_doc_before_save()` returns None on both insert and delete — there is no prior
    image — so those are judged on the invoice's own status alone.

    Raises rather than swallowing. This is one SELECT plus one UPDATE inside the caller's
    transaction; a silently stale total is the worse outcome.
    """
    before = doc.get_doc_before_save()

    # ---- insert / delete: no prior image, so the invoice's own status decides ----
    if before is None:
        if doc.status != _APPROVED:
            return          # a Pending insert, or deleting a non-Approved invoice
        recompute_document_amount_invoiced(doc.document_type, doc.document_name)
        return

    # ---- update ----
    was_approved = before.status == _APPROVED
    is_approved = doc.status == _APPROVED

    if not was_approved and not is_approved:
        return              # Pending edits, Pending -> Rejected, autofill saves, ...

    if was_approved and is_approved and not any(
        before.get(f) != doc.get(f) for f in _SUM_INPUT_FIELDS
    ):
        return              # still Approved, and nothing feeding the sum moved

    # Recompute each side that actually held this invoice. When it was re-pointed at a
    # different order these are two different documents, and the one it LEFT still holds
    # a total that includes it.
    targets = set()
    if is_approved:
        targets.add((doc.document_type, doc.document_name))
    if was_approved:
        targets.add((before.document_type, before.document_name))

    for document_type, document_name in targets:
        recompute_document_amount_invoiced(document_type, document_name)
