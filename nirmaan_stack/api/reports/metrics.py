"""
Shared PO-level delivery-paperwork metrics for the reports layer.

ONE definition of "this PO still owes a DN / a DC", reused by every surface that
prints such a count, so the Monthly WIP report and the Action Centre / project
tiles can never disagree by construction.

WHY THIS EXISTS
---------------
The Monthly WIP report used to derive both numbers by subtracting DOCUMENT counts:

    missing_dn = max(0, dispatched_po_count - delivery_note_count)
    missing_dc = max(0, delivery_note_count - non_billable_dn_count - dc_count)

Both are unsound, because a PO carries an unbounded number of DNs (431 POs on live
data carry more than one, contributing 571 surplus documents). A PO with 3 DNs
silently cancels two other POs that have none, so the raw value went NEGATIVE on 56
of 93 projects for ``missing_dn`` and 12 of 93 for ``missing_dc`` — and the
``max(0, ...)`` clamp then rendered that incoherence as a clean, trustworthy-looking
zero. The DC form additionally counted 322 STUB Delivery-Challan rows as filed
challans (the reconciler has always excluded them), which pushed several projects to
0 while they genuinely owed dozens of challans.

The fix is to stop subtracting documents and COUNT POs against the same predicates
the Project Action Item reconciler uses (``services/action_items/predicates.py``).

CONTRACT
--------
  * PURE READ. No writes, no commits, not whitelisted — an internal helper.
  * Counts POs, never documents. Every value is a non-negative PO count, so no
    clamping is required or performed.
  * Uses the SAME predicates as ``services/action_items/reconcile._compute_desired``
    (including its ``is_stub = 0`` Delivery-Challan filter), so on a project the
    reconciler does not suppress, BOTH counts here EQUAL the project tile.
  * NOT project-status aware. The reconciler force-resolves every open row on
    Completed / Halted projects; this helper does not, because chasing outstanding
    paperwork on a finished project is exactly what a compliance report is for.
    Callers that want the Action-Centre view must apply that gate themselves.

DN: WHY THIS CALLS ``is_dn_pending`` AND NOT A DOCUMENT-EXISTENCE TEST
----------------------------------------------------------------------
An earlier revision of this module carried its own ``_is_dn_missing`` predicate —
"dispatched, and no Delivery Note document exists for the PO" — because
``is_dn_pending`` early-returns on ``status == "Delivered"`` and 5037 of the 5047
live POs are Delivered, which pins it near zero (5 system-wide, max 2 on any one
project). Owner ruling: the WIP column must show the SAME NUMBER as the project
Overview tile, so the shared predicate wins and the local one is gone.

What that trades away, recorded so it is not rediscovered as a bug: four POs
(Cinepolis, KVN Prestige Trade Tower, Richa & Mekin Residency, STS Bangalore) carry
a recorded ``received_quantity`` with NO delivery-note document at all — goods logged
without paperwork, or a note deleted afterwards. Their status is ``Delivered``, so
``is_dn_pending`` cannot see them. They are a DATA-INTEGRITY signal rather than
pending work (nobody can file the missing note — the delivery already happened), so
they belong in a separate audit, not in a compliance column.

SQL SHAPE (load-bearing — do not "simplify" this)
-------------------------------------------------
Every query is raw SQL that JOINs on the PO's status. It must NEVER be rewritten as
``frappe.get_all(..., filters={"parent": ["in", po_names]})``: Frappe runs
``validate_generated_query`` -> ``sqlparse.parse()``, which raises
``Maximum number of tokens exceeded (10000)`` once the IN-list grows past a few
thousand names. There are 5047 live POs on production today, so that form throws in
prod while passing on any small dataset.
"""

import frappe

from nirmaan_stack.services.action_items.predicates import (
    LIVE_STATUSES,
    is_dc_pending,
    is_dn_pending,
)

# Tuple form for psycopg2 ``IN %(s)s`` binding. Sorted for a stable query string
# (so Postgres can reuse its plan cache across calls).
_LIVE = tuple(sorted(LIVE_STATUSES))

_Q_POS = '''
    SELECT name, project, status, billing_status
    FROM "tabProcurement Orders"
    WHERE status IN %(s)s
'''

_Q_ITEMS = '''
    SELECT i.parent, i.category, i.is_dispatched, i.quantity, i.received_quantity
    FROM "tabPurchase Order Item" i
    JOIN "tabProcurement Orders" po ON po.name = i.parent
    WHERE po.status IN %(s)s
'''

# `is_stub = 0` is MANDATORY and mirrors reconcile._compute_desired. A stub row is a
# placeholder with no items; treating it as a filed challan is what made Air India
# Training Centre report 0 missing challans against 35 real ones.
_Q_DC = '''
    SELECT DISTINCT d.parent_docname
    FROM "tabPO Delivery Documents" d
    JOIN "tabProcurement Orders" po ON po.name = d.parent_docname
    WHERE d.parent_doctype = 'Procurement Orders'
      AND d.type = 'Delivery Challan'
      AND d.is_stub = 0
      AND po.status IN %(s)s
'''

def pending_counts_by_project():
    """Per-project counts of POs that still owe delivery paperwork.

    Returns ``{project_docname: {"dc_pending": int, "dn_pending": int}}`` covering
    every project that has at least one PO in a live delivery status. A project with
    live POs but nothing outstanding is present with both counts at 0; a project with
    no live POs at all is ABSENT, so callers must use ``.get(pid, ...)`` with a zero
    default rather than assuming a key exists.

    THREE bulk queries + a pure-Python pass; no N+1 and no per-project round-trip.
    (It was four while DN was a document-existence test; ``is_dn_pending`` reads only
    the PO's own items, so the Delivery-Notes fetch is gone.) Measured on
    production-scale data (5047 POs / 19,848 items / 93 projects): ~80-160 ms.
    """
    pos = frappe.db.sql(_Q_POS, {"s": _LIVE}, as_dict=True)
    if not pos:
        return {}

    item_rows = frappe.db.sql(_Q_ITEMS, {"s": _LIVE}, as_dict=True)
    items_by_po = {}
    for row in item_rows:
        items_by_po.setdefault(row["parent"], []).append(row)

    has_dc = {row[0] for row in frappe.db.sql(_Q_DC, {"s": _LIVE})}

    counts = {}
    for po in pos:
        project = po.get("project")
        if not project:
            # A PO with no project cannot be attributed to a report row.
            continue

        bucket = counts.setdefault(project, {"dc_pending": 0, "dn_pending": 0})
        name = po["name"]
        status = po["status"]
        billing = po.get("billing_status")
        items = items_by_po.get(name, [])

        if is_dc_pending(status, billing, items, name in has_dc):
            bucket["dc_pending"] += 1
        # No document lookup: is_dn_pending compares each dispatched item's ordered
        # quantity against what has been received, on the PO's own item rows.
        if is_dn_pending(status, billing, items):
            bucket["dn_pending"] += 1

    return counts
