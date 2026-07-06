# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Keep the stored `Purchase Order Item.invoice_qty` in sync — SELF-CLASSIFYING.

`invoice_qty` is a DERIVED per-PO-row field, RECOMPUTED FROM SOURCE on every call
(never incremented by deltas, so it cannot drift). Per PO, `counted` = Pending+
Approved invoices with Credit Notes excluded (`is_credit_note = 1` -> skipped, like
Rejected). It resolves by TRUST LEVEL to one of four states:

  EXACT        -- EVERY counted invoice is line-mapped -> Σ signed Matched line quantity
                  per PO row (a return note's negative qty subtracts here). Complete line
                  data for all invoices == FULLY trustable, so use the precise figure.
  TRUSTED-FULL -- fully billed (all counted invoices Approved AND their amount >= PO total
                  within TOL) OR project Completed -> ordered quantity per row. Also fully
                  trustable (a fully-invoiced PO can't be undercounted).
  DELIVERED    -- counted invoices exist but the PO is only PARTIALLY trustable: line data
                  is incomplete AND it is not yet fully billed -> fall back to the DELIVERED
                  (received) quantity, the real-world amount that actually arrived. Avoids
                  BOTH the ordered-qty OVERcount and the mapped-only UNDERcount -- e.g. a
                  directly-backfilled PO later revised with a new line-mapped invoice would
                  otherwise drop its old (unmapped) invoices' rows to 0.
  ZERO         -- no counted invoices (none / all rejected / only credit notes) and the
                  project is not Completed -> 0.

Call `recompute_po_invoice_qty(po_name)` inside the transaction of every invoice
event (create / approve / reject / delete / edit), BEFORE the commit.
"""

import frappe

# Invoice statuses that represent real billing exposure (mirror get_po_item_billing).
_COUNTED_STATUSES = ("Pending", "Approved")
_TOL = 1.0   # Rs rounding cushion: a few Rs under the PO total still counts as "fully invoiced".


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
        fields=["name", "quantity", "received_quantity", "category"],
    )
    if not po_rows:
        return

    # counted invoices = real billing exposure: Pending+Approved, credit notes excluded.
    # n_lines = how many Vendor Invoice Line rows each carries (0 = not yet extracted).
    counted = frappe.db.sql(
        """
        SELECT vi.name, vi.status, COALESCE(vi.invoice_amount, 0) AS amount,
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
            # Additional Charges (freight / P&F / etc.) are not real line quantities — they
            # NEVER carry an invoice_qty (always 0), whatever the bucket.
            val = 0 if r.category == "Additional Charges" else value_fn(r)
            frappe.db.set_value(
                "Purchase Order Item", r.name, "invoice_qty", val,
                update_modified=False,
            )

    mapped = [c for c in counted if (c.n_lines or 0) > 0]
    all_mapped = bool(counted) and len(mapped) == len(counted)
    # "Trusted full" = every counted invoice Approved AND their amount reaches the PO total
    # (within TOL), OR the project is Completed. Such a PO is trusted FULLY invoiced -> ordered qty.
    all_approved = bool(counted) and all(c.status == "Approved" for c in counted)
    net = sum(float(c.amount or 0) for c in counted)
    po_total = float(frappe.db.get_value("Procurement Orders", po_name, "total_amount") or 0)
    completed = _project_is_completed(po_name)
    trusted_full = (all_approved and net >= po_total - _TOL) or completed

    # 1) EXACT — EVERY counted invoice is line-mapped. Complete line data == FULLY trustable, so
    # sum the signed Matched line qty per PO row (a return note's negative qty subtracts here).
    if all_mapped:
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

    # 2) TRUSTED-FULL — fully billed (all Approved AND amount >= PO total) or project Completed.
    # Also fully trustable -> ordered quantity per row (a fully-invoiced PO can't be undercounted).
    if trusted_full:
        _write(lambda r: float(r.quantity or 0))
        return

    # 3) DELIVERED — counted invoices exist but the PO is only PARTIALLY trustable: line data is
    # incomplete AND it is not yet fully billed. Fall back to the DELIVERED (received) quantity --
    # the real-world amount that actually arrived. This avoids BOTH the ordered-qty OVERcount and
    # the mapped-only UNDERcount (e.g. a directly-backfilled PO later revised with a new line-mapped
    # invoice, whose old unmapped invoices would otherwise drop their rows to 0). It becomes EXACT
    # once every invoice on the PO is line-mapped (branch 1).
    if counted:
        _write(lambda r: float(r.received_quantity or 0))
        return

    # 4) ZERO — no counted invoices and project not Completed.
    _write(lambda r: 0)


def _project_is_completed(po_name: str) -> bool:
    project = frappe.db.get_value("Procurement Orders", po_name, "project")
    return bool(project) and (
        frappe.db.get_value("Projects", project, "status") == "Completed"
    )
