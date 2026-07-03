# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Keep the stored `Purchase Order Item.invoice_qty` in sync with invoice lines.

`invoice_qty` is a DERIVED per-PO-row field: the sum of Matched
`Vendor Invoice Line.quantity` across that PO's Pending+Approved invoices
(Rejected excluded), grouped by the exact PO child row (`po_item_row`, which
`build_line_mapping_rows` sets to `Purchase Order Item.name`).

It is always RECOMPUTED FROM SOURCE — never incremented by deltas — so it cannot
drift. Call `recompute_po_invoice_qty(po_name)` inside the transaction of every
endpoint that changes the counted set of invoice lines (create, approve/reject,
delete), BEFORE the commit. The counted-status set mirrors get_po_item_billing.
"""

import frappe

# Invoice statuses that represent real billing exposure (mirror get_po_item_billing).
_COUNTED_STATUSES = ("Pending", "Approved")


def recompute_po_invoice_qty(po_name: str) -> None:
    """Rewrite invoice_qty on every `Purchase Order Item` row of `po_name`.

    Rows with no matched invoice lines are reset to 0. Writes go straight to the
    child rows via db.set_value (update_modified=False) so the PO's own on_update
    controller does NOT fire — invoice_qty is a derived cache, not a PO edit.
    No-op for a blank / missing PO.
    """
    if not po_name:
        return

    # Matched line quantity per PO child row, across counted invoices only.
    # Postgres: double-quoted identifiers, %(name)s params (see project CLAUDE.md).
    rows = frappe.db.sql(
        """
        SELECT vil.po_item_row              AS row_name,
               SUM(COALESCE(vil.quantity, 0)) AS qty
        FROM "tabVendor Invoice Line" vil
        JOIN "tabVendor Invoices" vi ON vil.parent = vi.name
        WHERE vil.parenttype = 'Vendor Invoices'
          AND vil.match_status = 'Matched'
          AND vil.po_item_row IS NOT NULL
          AND vil.po_item_row != ''
          AND vi.document_type = 'Procurement Orders'
          AND vi.document_name = %(po)s
          AND vi.status IN %(statuses)s
        GROUP BY vil.po_item_row
        """,
        {"po": po_name, "statuses": _COUNTED_STATUSES},
        as_dict=True,
    )
    invoiced = {r.row_name: float(r.qty or 0) for r in rows}

    po_rows = frappe.db.get_all(
        "Purchase Order Item",
        filters={"parent": po_name, "parenttype": "Procurement Orders"},
        fields=["name"],
    )
    for r in po_rows:
        frappe.db.set_value(
            "Purchase Order Item",
            r.name,
            "invoice_qty",
            invoiced.get(r.name, 0),
            update_modified=False,
        )
