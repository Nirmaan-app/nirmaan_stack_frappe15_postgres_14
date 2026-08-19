# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Keep the fields DERIVED FROM VENDOR INVOICES in sync.

Two of them live here, with deliberately DIFFERENT rules:
  `Purchase Order Item.invoice_qty`  -- per-PO-ROW invoiced QUANTITY, counted over
                                        Pending+Approved, credit notes EXCLUDED.
  `Procurement Orders` /
  `Service Requests`.amount_invoiced -- per-DOCUMENT invoiced AMOUNT, summed over
                                        APPROVED only, credit notes INCLUDED (they are
                                        stored negative and net out).
Do not "harmonise" the two — they answer different questions.

--- invoice_qty: SELF-CLASSIFYING ---

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
  ORDERED-FB   -- counted invoices exist but line data is incomplete (not every invoice mapped)
                  -> ordered quantity per row (same figure as TRUSTED-FULL). An invoice can be
                  raised BEFORE its delivery is recorded, so a received-qty fallback would read 0
                  and then churn as delivery qty is updated later; ordered qty stays stable and
                  non-zero the moment a PO is invoiced. Becomes EXACT once every invoice is
                  line-mapped. (Owner decision 2026-07 -- accepts a partial bill reading as fully
                  invoiced until mapped.)
  ZERO         -- no counted invoices (none / all rejected / only credit notes) and the
                  project is not Completed -> 0.

Call `recompute_po_invoice_qty(po_name)` inside the transaction of every invoice
event (create / approve / reject / delete / edit), BEFORE the commit.
"""

import frappe
from frappe.utils import flt

# Invoice statuses that represent real billing exposure (mirror get_po_item_billing).
_COUNTED_STATUSES = ("Pending", "Approved")
_TOL = 1.0   # Rs rounding cushion: a few Rs under the PO total still counts as "fully invoiced".


def recompute_po_invoice_qty(po_name: str) -> None:
    """Self-classify invoice_qty on every `Purchase Order Item` row of `po_name`.

    Resolves the PO to EXACT / ORDERED / ZERO (see module docstring) and writes each
    row via db.set_value, which stamps `modified` / `modified_by` on the child rows.
    That stamp is the POINT: a runtime hook must leave a trace a user can find, so the
    row visibly moved. Only PATCHES suppress it with `update_modified=False`, because a
    migration rewriting history should not look like everyone edited every document.
    The PO's own `on_update` controller does NOT fire either way — `set_value` runs no
    doc events at all, whatever `update_modified` says. No-op for blank/missing PO.
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

    # 3) ORDERED (fallback) — counted invoices exist but line data is incomplete (not every invoice
    # is line-mapped). Use the ORDERED quantity per row (same figure as TRUSTED-FULL above).
    # Rationale (owner decision, 2026-07): an invoice is often raised BEFORE its delivery is recorded,
    # so a received-qty fallback sits at 0 and then CHURNS every time delivery qty is later updated.
    # Ordered qty keeps invoice_qty stable and non-zero the moment a PO is invoiced. Trade-off
    # accepted: a partially-billed PO reads as fully invoiced until every invoice is line-mapped
    # -> EXACT (branch 1) gives the precise figure.
    if counted:
        _write(lambda r: float(r.quantity or 0))
        return

    # 4) ZERO — no counted invoices and project not Completed.
    _write(lambda r: 0)


def _project_is_completed(po_name: str) -> bool:
    project = frappe.db.get_value("Procurement Orders", po_name, "project")
    return bool(project) and (
        frappe.db.get_value("Projects", project, "status") == "Completed"
    )


# ---------------------------------------------------------------------------
# `Procurement Orders` / `Service Requests` .amount_invoiced
# ---------------------------------------------------------------------------

# The only doctypes a Vendor Invoice can be parented to that carry the field.
_TOTAL_PARENT_DOCTYPES = ("Procurement Orders", "Service Requests")


def recompute_document_amount_invoiced(document_type: str, document_name: str) -> None:
    """Re-derive `amount_invoiced` on ONE Procurement Order / Service Request.

    Value = SUM of that document's Vendor Invoices with status 'Approved'.

    Credit notes are NOT filtered out: they are stored with a NEGATIVE
    `invoice_amount`, so a plain sum nets them off — which is exactly what every
    screen showing this figure already does. (Contrast `recompute_po_invoice_qty`
    above, which counts Pending+Approved and skips credit notes entirely.)

    RECOMPUTED FROM SOURCE on every call, never incremented by a delta, so it
    cannot drift. Written with `set_value`, which STAMPS `modified` / `modified_by`
    (the default) — deliberately, so the parent row carries a visible trace that it
    moved, exactly as `amount_paid` already does at its own write sites.

    `update_modified` does NOT gate the parent's `on_update` chain, and never did:
    `frappe.db.set_value` runs no controller method, no doc event, no versioning and
    publishes no realtime event whatever the flag is set to. It controls the two
    timestamp columns and nothing else. (Verified against
    `frappe/database/database.py::set_value`.)

    Does NOT commit: it runs inside the transaction of the invoice event that
    triggered it. No-op for a blank name or a doctype without the field.
    """
    if document_type not in _TOTAL_PARENT_DOCTYPES or not document_name:
        return

    total = frappe.db.sql(
        """
        SELECT COALESCE(SUM(COALESCE(vi.invoice_amount, 0)), 0)
        FROM "tabVendor Invoices" vi
        WHERE vi.document_type = %(dt)s
          AND vi.document_name = %(dn)s
          AND vi.status = 'Approved'
        """,
        {"dt": document_type, "dn": document_name},
    )[0][0]

    # A parent that no longer exists (an order deleted along with its invoices)
    # matches zero rows here — a silent no-op, not an error.
    frappe.db.set_value(
        document_type, document_name, "amount_invoiced", flt(total),
    )

    # amount_due is derived from this value, so it moves with it.
    recompute_document_amount_due(document_type, document_name)

# ---------------------------------------------------------------------------
# `Procurement Orders` / `Service Requests` .amount_due
# ---------------------------------------------------------------------------

# The two doctypes use DELIBERATELY DIFFERENT formulas (owner decision 2026-08-19):
#   Procurement Orders   amount_invoiced - amount_paid   -> billed to us, not yet paid
#   Service Requests     total_amount    - amount_paid   -> ordered value, not yet paid
# The SR screens have always shown ordered-minus-paid and say so in their own footnote
# ("Amount Due = Total WO Value - Amt Paid"); switching them to invoiced-minus-paid
# would move 761 of 862 rows (measured 2026-08-19). Do NOT "harmonise" the two.
_AMOUNT_DUE_OPERANDS = {
    "Procurement Orders": ("amount_invoiced", "amount_paid"),
    "Service Requests": ("total_amount", "amount_paid"),
}


def recompute_document_amount_due(document_type: str, document_name: str) -> None:
    """Re-derive `amount_due` on ONE Procurement Order / Service Request.

    Called from every place that writes one of its operands — there is no single
    owner, because the operands are maintained by different subsystems:

        amount_invoiced  <- recompute_document_amount_invoiced (this module)
        total_amount     <- the Service Request's own save
        amount_paid      <- Project Payments' update_parent_amount_paid

    A Postgres GENERATED column was tried first and REJECTED: `bench migrate`
    re-asserts the type of every Currency column, and Postgres refuses to alter a
    column that a generated column depends on, so every migrate would fail.
    A `validate` hook was rejected too — both operands are written with
    `db.set_value`, which bypasses the document lifecycle, so such a field would be
    stale on arrival.

    Reads the operands straight back from the row (same transaction, so it sees the
    write that triggered it) and lets `set_value` stamp `modified` / `modified_by`,
    matching `amount_invoiced` above and `amount_paid` elsewhere. Does NOT commit.
    """
    operands = _AMOUNT_DUE_OPERANDS.get(document_type)
    if not operands or not document_name:
        return
    minuend, subtrahend = operands

    # Column and table names come from the constant above, never from a caller.
    row = frappe.db.sql(
        'SELECT COALESCE("{0}", 0) AS a, COALESCE("{1}", 0) AS b '
        'FROM "tab{2}" WHERE name = %(n)s'.format(minuend, subtrahend, document_type),
        {"n": document_name}, as_dict=True,
    )
    if not row:
        return

    frappe.db.set_value(
        document_type, document_name, "amount_due",
        flt(row[0].a) - flt(row[0].b),
    )
