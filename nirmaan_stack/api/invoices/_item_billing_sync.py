# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Keep the stored `Purchase Order Item.invoice_qty` in sync — SELF-CLASSIFYING.

`invoice_qty` is a DERIVED per-PO-row field, RECOMPUTED FROM SOURCE on every call
(never incremented by deltas, so it cannot drift). Per PO, `counted` = Pending+
Approved invoices with Credit Notes excluded (`is_credit_note = 1` -> skipped, like
Rejected). It resolves to one of three states:

  EXACT   -- EVERY counted invoice is line-mapped -> Σ signed Matched line quantity
             per PO row. ALL-OR-NOTHING: trusted only when every invoice has line
             data, else summing the mapped ones would UNDERCOUNT the unmapped
             invoices (the "last added invoice" bug). A return note's negative qty
             subtracts here.
  ORDERED -- not all mapped, but the PO HAS counted invoices (or its project is
             Completed) -> ordered quantity per row. Legacy / not-yet-extracted POs
             are trusted fully invoiced; extraction later adds line data -> EXACT.
  ZERO    -- no counted invoices (none / all rejected / only credit notes) and the
             project is not Completed -> 0.

Call `recompute_po_invoice_qty(po_name)` inside the transaction of every invoice
event (create / approve / reject / delete / edit), BEFORE the commit.
"""

import frappe

# Invoice statuses that represent real billing exposure (mirror get_po_item_billing).
_COUNTED_STATUSES = ("Pending", "Approved")


def recompute_po_invoice_qty(po_name: str) -> None:
    """Self-classify invoice_qty on every `Purchase Order Item` row of `po_name`.

    Resolves the PO to EXACT / ORDERED / ZERO (see module docstring) and writes each
    row via db.set_value (update_modified=False) so the PO's on_update controller does
    NOT fire — invoice_qty is a derived cache, not a PO edit. No-op for blank/missing PO.
    """
    if not po_name:
        return

    po_rows = frappe.db.get_all(
        "Purchase Order Item",
        filters={"parent": po_name, "parenttype": "Procurement Orders"},
        fields=["name", "quantity"],
    )
    if not po_rows:
        return

    # counted invoices = real billing exposure: Pending+Approved, credit notes excluded.
    # n_lines = how many Vendor Invoice Line rows each carries (0 = not yet extracted).
    counted = frappe.db.sql(
        """
        SELECT vi.name,
               (SELECT COUNT(*) FROM "tabVendor Invoice Line" vil
                 WHERE vil.parent = vi.name AND vil.parenttype = 'Vendor Invoices') AS n_lines
        FROM "tabVendor Invoices" vi
        WHERE vi.document_type = 'Procurement Orders'
          AND vi.document_name = %(po)s
          AND vi.status IN %(statuses)s
          AND COALESCE(vi.is_credit_note, 0) = 0
        """,
        {"po": po_name, "statuses": _COUNTED_STATUSES},
        as_dict=True,
    )

    def _write(value_fn):
        for r in po_rows:
            frappe.db.set_value(
                "Purchase Order Item", r.name, "invoice_qty", value_fn(r),
                update_modified=False,
            )

    # 1) EXACT — every counted invoice has line data -> Σ signed Matched qty per row.
    # WHY all-or-nothing: if even one counted invoice is unmapped, summing the mapped
    # ones would UNDERCOUNT (the unmapped invoice contributes 0) -> the "last added
    # invoice" bug. Only trust the line sum when every invoice has been read.
    if counted and all((c.n_lines or 0) > 0 for c in counted):
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
              AND COALESCE(vi.is_credit_note, 0) = 0
            GROUP BY vil.po_item_row
            """,
            {"po": po_name, "statuses": _COUNTED_STATUSES},
            as_dict=True,
        )
        invoiced = {r.row_name: float(r.qty or 0) for r in rows}
        _write(lambda r: invoiced.get(r.name, 0))
        return

    # 2) ORDERED — not all mapped, but the PO HAS counted invoices, OR its project is
    # Completed -> trust it's (fully) invoiced -> ordered quantity per row. (The short-
    # circuit keeps the project lookup off the hot path when invoices exist.)
    if counted or _project_is_completed(po_name):
        _write(lambda r: float(r.quantity or 0))
        return

    # 3) ZERO — no counted invoices and project not Completed.
    _write(lambda r: 0)


def _project_is_completed(po_name: str) -> bool:
    project = frappe.db.get_value("Procurement Orders", po_name, "project")
    return bool(project) and (
        frappe.db.get_value("Projects", project, "status") == "Completed"
    )
