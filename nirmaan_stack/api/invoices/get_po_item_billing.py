"""Item-level billing rollup for a Procurement Order.

Aggregates the verified invoice-line → PO-item mappings (the `line_mappings`
child rows on Vendor Invoices) across ALL of a PO's invoices, grouped by the
Items-master id (`po_item_id`). This answers "how much of each PO item has been
invoiced so far" and surfaces *cumulative* over-billing — a strictly finer check
than the existing invoice-level overage guard, which the per-line snapshot on a
single invoice can't see.

Decisions (locked with the user):
  * Aggregation key: po_item_id (Items master) — rolls up split rows / revisions.
  * Counts toward billed: invoices with status in {Pending, Approved} (exclude Rejected).
  * Over-billing basis: amount OR quantity exceeds the PO baseline (+ tolerance).
  * Behavior: warn only — this endpoint never blocks anything.
"""

import frappe

from nirmaan_stack.api.invoices._line_match import OVERBILL_TOLERANCE

# Quantity slack mirrors the per-line snapshot in _line_match._overbill.
_QTY_TOLERANCE = 0.001

# Invoice statuses that represent real billing exposure.
_COUNTED_STATUSES = ("Pending", "Approved")


def _f(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def compute_item_billing(po_items, invoiced_rows) -> dict:
    """Pure roll-up: PO baseline ∪ invoiced totals → per-item billing + summary.

    Kept free of frappe/SQL so it's unit-testable in isolation (the whitelisted
    wrapper supplies `po_items` from the PO doc and `invoiced_rows` from SQL).

    po_items:      iterable of {item_id, item_name, unit, quantity, amount}
    invoiced_rows: iterable of {po_item_id, invoiced_amount, invoiced_quantity, invoice_count}
    """
    baseline = {}
    for it in po_items:
        key = (it.get("item_id") if isinstance(it, dict) else it.item_id)
        if not key:
            continue
        b = baseline.setdefault(key, {
            "po_item_id": key,
            "po_item_name": (it.get("item_name") if isinstance(it, dict) else it.item_name),
            "unit": (it.get("unit") if isinstance(it, dict) else it.unit),
            "po_quantity": 0.0,
            "po_amount": 0.0,
        })
        b["po_quantity"] += _f(it.get("quantity") if isinstance(it, dict) else it.quantity)
        b["po_amount"] += _f(it.get("amount") if isinstance(it, dict) else it.amount)

    invoiced = {r["po_item_id"]: r for r in invoiced_rows}

    items = []
    for key in (set(baseline) | set(invoiced)):
        b = baseline.get(key, {"po_item_id": key, "po_item_name": None, "unit": None,
                               "po_quantity": 0.0, "po_amount": 0.0})
        inv = invoiced.get(key, {})
        inv_amt = _f(inv.get("invoiced_amount"))
        inv_qty = _f(inv.get("invoiced_quantity"))
        over_amt = inv_amt - b["po_amount"]
        over_qty = inv_qty - b["po_quantity"]
        is_over = (over_amt > OVERBILL_TOLERANCE) or (over_qty > _QTY_TOLERANCE)
        items.append({
            **b,
            "invoiced_amount": round(inv_amt, 2),
            "invoiced_quantity": round(inv_qty, 4),
            "invoice_count": int(inv.get("invoice_count") or 0),
            "over_billed_amount": round(over_amt, 2) if over_amt > 0 else 0,
            "over_billed_quantity": round(over_qty, 4) if over_qty > 0 else 0,
            "is_over_billed": bool(is_over),
        })

    items.sort(key=lambda x: (not x["is_over_billed"], (x["po_item_name"] or "").lower()))
    return {
        "items": items,
        "summary": {
            "items": len(items),
            "over_billed": sum(1 for x in items if x["is_over_billed"]),
            "total_po_amount": round(sum(x["po_amount"] for x in items), 2),
            "total_invoiced_amount": round(sum(x["invoiced_amount"] for x in items), 2),
        },
    }


@frappe.whitelist()
def get_po_item_billing(po: str) -> dict:
    """Return per-PO-item invoiced totals + cumulative over-billing for `po`.

    Shape:
      {
        "po": <name>,
        "items": [{
            po_item_id, po_item_name, unit,
            po_quantity, po_amount,
            invoiced_quantity, invoiced_amount, invoice_count,
            over_billed_amount, over_billed_quantity, is_over_billed
        }, ...],
        "summary": {items, over_billed, total_po_amount, total_invoiced_amount}
      }
    """
    if not po or not frappe.db.exists("Procurement Orders", po):
        frappe.throw(f"Procurement Order {po} not found.")

    # PO baseline (parent read respects the user's PO access; the child table is
    # istable with no DocPerm — see _po_items_for_match in invoice_autofill.py).
    po_doc = frappe.get_doc("Procurement Orders", po)
    po_items = [
        {"item_id": it.item_id, "item_name": it.item_name, "unit": it.unit,
         "quantity": it.quantity, "amount": it.amount}
        for it in (po_doc.items or [])
    ]

    # Invoiced totals from the verified mappings, across counted invoices only.
    # Postgres: double-quoted identifiers, %(name)s params (see project CLAUDE.md).
    invoiced_rows = frappe.db.sql(
        """
        SELECT vil.po_item_id            AS po_item_id,
               SUM(COALESCE(vil.amount, 0))   AS invoiced_amount,
               SUM(COALESCE(vil.quantity, 0)) AS invoiced_quantity,
               COUNT(DISTINCT vil.parent)     AS invoice_count
        FROM "tabVendor Invoice Line" vil
        JOIN "tabVendor Invoices" vi ON vil.parent = vi.name
        WHERE vil.parenttype = 'Vendor Invoices'
          AND vil.match_status = 'Matched'
          AND vil.po_item_id IS NOT NULL
          AND vil.po_item_id != ''
          AND vi.document_type = 'Procurement Orders'
          AND vi.document_name = %(po)s
          AND vi.status IN %(statuses)s
        GROUP BY vil.po_item_id
        """,
        {"po": po, "statuses": _COUNTED_STATUSES},
        as_dict=True,
    )

    result = compute_item_billing(po_items, invoiced_rows)
    result["po"] = po
    return result
