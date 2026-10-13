# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The PO refund sync step: make one PO's Vendor Refund ledger entries right (#1399, ADR-0032).

A Received Vendor Refund settles its PO's negative PO Adjustment balance by itself. Whichever comes
first -- the refund (PO/005/00107/26-27, PO/124/00102/26-27) or the revision that cuts the PO -- the
link happens when the second one is written, because EVERY WRITER CALLS `sync_po_refund_links`:

  * the Vendor Refunds save / delete hooks (`integrations/controllers/vendor_refunds`), which also
    cover Bulk Import "create a vendor refund" (it inserts refunds), its Unreconcile (it deletes them
    with `frappe.delete_doc`), a Desk edit, and any status flip (a future match path that sets a
    waiting refund Received saves it, so the hook runs);
  * revision approval (`api/po_revisions/revision_logic.on_approval_revision`), after the decrease
    or increase is written to the ledger.

A writer that changes a Received refund's money (`document_type`, `document_name`, `amount`,
`status`) through the document layer needs nothing more. One that writes refunds by raw SQL, or
changes a PO's ledger in a way that LOWERS its base balance, must call `sync_po_refund_links` itself.

THE STEP, per PO, recomputed from source (so running it twice changes nothing):

  1. `amount_paid` and `amount_due` from payments and Received refunds (`_recalculate_amount_paid`).
  2. The ledger's `Vendor Refund` entries that point at a Vendor Refund (`vendor_refund` set) are set
     to `services/refund_links.plan_refund_links` over the ledger's other entries and the PO's
     Received refunds, oldest first: each refund links up to the still-unsettled negative balance.
     Such an entry creates NO Project Payment and NO payment term -- the refund already lowered
     the paid amount, the entry only stops the ledger asking for the money again. Old-style
     `Vendor Refund` entries backed by a negative payment (no `vendor_refund`) are ledger rows like
     any other and are never touched here. The adjustment is saved (and its status set: Done lifts
     the payment lock) ONLY when an entry changes.
  3. The vendor's credit, when the caller names a ledger entry type (`credit_entry_type`). Linking
     moves no paid amount, so a writer that already recounts credit (revision approval) passes none.

⚠️ NEVER COMMITS. The refund hook runs inside the Bulk Import savepoint, and revision approval
commits on its own.
"""

from decimal import Decimal

import frappe
from frappe.utils import flt, now_datetime

from nirmaan_stack.api.outflow_import.vendor_credit_refresh import recompute_vendor_credit
from nirmaan_stack.api.po_adjustments._payment_utils import _recalculate_amount_paid
from nirmaan_stack.services.refund_links import plan_refund_links
from nirmaan_stack.services.vendor_refunds import (
    LOWERS_PAID_STATUSES,
    PROCUREMENT_ORDERS,
    VENDOR_REFUNDS,
    money,
)

PO_ADJUSTMENTS = "PO Adjustments"
#: The ledger entry type of a refund link -- the same word the old negative-payment entries used.
ENTRY_TYPE = "Vendor Refund"
#: Below this, a refund's excess over the balance is paisa noise, not a warning (the ₹1 cap tolerance).
OVER_BALANCE_TOLERANCE = Decimal("1.00")


def sync_po_refund_links(po_names, credit_entry_type: str | None = None) -> None:
    """Make each PO's refund links, paid amount and amount due right; then, when `credit_entry_type`
    is given, recount the credit of the vendor(s) behind them under that ledger entry type."""
    pos = sorted({name for name in (po_names or []) if name})
    for po in pos:
        _recalculate_amount_paid(po)
        _sync_links(po)
    if pos and credit_entry_type:
        recompute_vendor_credit(pos, credit_entry_type)


def unlink_refund(refund_name: str) -> None:
    """Drop every ledger entry that points at `refund_name` -- for a refund about to be deleted.

    Called from the refund's `on_trash`, which runs BEFORE Frappe's link check: an entry still
    pointing at it would make a Desk delete refuse. The `after_delete` hook then runs the full sync,
    which may re-link the PO's other refunds into the balance this one leaves.
    """
    for adj_name in frappe.get_all(
        "PO Adjustment Items",
        filters={"parenttype": PO_ADJUSTMENTS, "vendor_refund": refund_name},
        pluck="parent",
        distinct=True,
    ):
        adj = frappe.get_doc(PO_ADJUSTMENTS, adj_name, for_update=True)
        for row in [r for r in adj.adjustment_items if r.vendor_refund == refund_name]:
            adj.remove(row)
        adj.recalculate_remaining_impact()


@frappe.whitelist()
def get_po_refund_links(po_id):
    """What the PO's Received refunds settle and what they hold beyond its overpaid balance.

    URL: /api/method/nirmaan_stack.api.po_adjustments.refund_links.get_po_refund_links

    Returns `{received, linked, over_balance}` in ₹. `over_balance` is the warning the PO page shows
    ("Refund is ₹X more than overpaid. Revise the PO?"); 0 when below ₹1. Read from the stored ledger
    entries, which the sync step keeps right; nothing is recomputed or written here.
    """
    frappe.has_permission(PROCUREMENT_ORDERS, "read", po_id, throw=True)
    received = sum((money(r.amount) for r in _received_refunds(po_id)), Decimal("0.00"))
    adj_name = frappe.db.get_value(PO_ADJUSTMENTS, {"po_id": po_id}, "name")
    linked = Decimal("0.00")
    if adj_name:
        linked = sum(
            (
                money(amount)
                for amount in frappe.get_all(
                    "PO Adjustment Items",
                    filters={"parent": adj_name, "parenttype": PO_ADJUSTMENTS, "vendor_refund": ["is", "set"]},
                    pluck="amount",
                )
            ),
            Decimal("0.00"),
        )
    over = received - linked
    return {
        "received": float(received),
        "linked": float(linked),
        "over_balance": float(over) if over >= OVER_BALANCE_TOLERANCE else 0.0,
    }


def _received_refunds(po: str) -> list:
    """The PO's refunds that count (Received), oldest first -- the order they settle the balance in."""
    return frappe.get_all(
        VENDOR_REFUNDS,
        filters={
            "document_type": PROCUREMENT_ORDERS,
            "document_name": po,
            "status": ["in", list(LOWERS_PAID_STATUSES)],
        },
        fields=["name", "amount", "payment_date"],
        order_by="payment_date asc, creation asc, name asc",
        limit_page_length=0,
    )


def _sync_links(po: str) -> None:
    adj_name = frappe.db.get_value(PO_ADJUSTMENTS, {"po_id": po}, "name")
    if not adj_name:
        return  # no adjustment, no balance to settle; the refund shows as over the balance
    adj = frappe.get_doc(PO_ADJUSTMENTS, adj_name, for_update=True)
    refunds = _received_refunds(po)

    base = sum(
        (money(row.amount) for row in adj.adjustment_items if not row.vendor_refund), Decimal("0.00")
    )
    plan = plan_refund_links(base, [(r.name, r.amount) for r in refunds])

    current: dict = {}
    for row in adj.adjustment_items:
        if row.vendor_refund:
            current.setdefault(row.vendor_refund, []).append(row)
    if {name: [money(r.amount) for r in rows] for name, rows in current.items()} == {
        name: [amount] for name, amount in plan.links.items()
    }:
        return  # already right: no save, no Version row, a hand-edited balance left alone

    dates = {r.name: r.payment_date for r in refunds}
    for name, rows in current.items():
        keep = rows[0] if name in plan.links else None
        for row in rows:
            if row is not keep:
                adj.remove(row)
        if keep is not None:
            keep.amount = flt(plan.links[name], 2)
    for name, amount in plan.links.items():
        if name in current:
            continue
        adj.append("adjustment_items", {
            "entry_type": ENTRY_TYPE,
            "vendor_refund": name,
            "amount": flt(amount, 2),
            "refund_date": dates.get(name),
            "description": f"Settled by Vendor Refund {name}",
            "timestamp": now_datetime(),
        })
    adj.recalculate_remaining_impact()
