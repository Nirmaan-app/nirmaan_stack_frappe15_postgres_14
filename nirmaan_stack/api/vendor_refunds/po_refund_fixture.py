# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Test support for the Vendor Refund / PO Adjustment suites (spec #1396): ONE purge and ONE overpaid PO.

These suites run against the env's database and their endpoints commit, so every record they make is
purged by name. `purge` is the one clean-up shape (CODING_STANDARDS.md § Writing tests): roll back
first, then each scope in its own try, committed on its own, every failure reported -- never swallowed,
never stranding the scopes after it. `overpaid_po` is the raw-SQL PO, Paid payment and Pending PO
Adjustment the waiting-refund suites build on.
"""

import frappe

PO = "Procurement Orders"
ADJ = "PO Adjustments"
ADJ_ITEM = "PO Adjustment Items"
PAYMENT = "Project Payments"


def purge(scopes) -> None:
    """Run each `(label, purge)` in its own transaction, after rolling back whatever the test left open.

    Raises AssertionError naming every scope that failed, once all have been tried.
    """
    frappe.db.rollback()
    failures = []
    for label, run in scopes:
        try:
            run()
            frappe.db.commit()
        except Exception as exc:  # report, never strand the next scope
            frappe.db.rollback()
            failures.append(f"{label}: {exc}")
    if failures:
        raise AssertionError("purge failed: " + "; ".join(failures))


def overpaid_po(prefix: str, project: str, vendor: str, paid: float, total: float, remaining: float):
    """A PO worth `total`, paid `paid` through one real Paid payment, its adjustment Pending at
    `remaining` (one Revision Impact entry). amount_due already agrees with amount_paid, so a recompute
    moves nothing. Committed. Returns `(po, adjustment)`; the caller tracks both for its purge."""
    po = f"{prefix}-PO-{frappe.generate_hash(length=10)}"
    frappe.db.sql(
        f"""INSERT INTO "tab{PO}"
                (name, creation, modified, modified_by, owner, docstatus, idx, project, vendor,
                 amount_paid, total_amount, amount_invoiced, amount_due, status)
            VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s,
                    %s, %s, 0, %s, 'PO Approved')""",
        (po, project, vendor, paid, total, -paid),
    )
    frappe.db.sql(
        f"""INSERT INTO "tab{PAYMENT}"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 document_type, document_name, project, vendor, amount, status)
            VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                    %s, %s, %s, %s, %s, 'Paid')""",
        (f"{prefix}-PAY-{frappe.generate_hash(length=10)}", PO, po, project, vendor, paid),
    )
    adj = f"{prefix}-ADJ-{frappe.generate_hash(length=8)}"
    frappe.db.sql(
        f"""INSERT INTO "tab{ADJ}"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 po_id, project, vendor, status, remaining_impact)
            VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0,
                    %s, %s, %s, 'Pending', %s)""",
        (adj, po, project, vendor, remaining),
    )
    frappe.db.sql(
        f"""INSERT INTO "tab{ADJ_ITEM}"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 parent, parenttype, parentfield, entry_type, amount)
            VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 1,
                    %s, %s, 'adjustment_items', 'Revision Impact', %s)""",
        (frappe.generate_hash(length=10), adj, ADJ, remaining),
    )
    frappe.db.commit()
    return po, adj


def po_scopes(pos, adjustments, refunds) -> list:
    """The purge scopes for the refunds, payments, adjustments and POs a suite tracked, children first."""
    refunds = list(refunds or [])
    return [
        ("Version", lambda: refunds + list(adjustments) and frappe.db.delete(
            "Version", {"ref_doctype": ["in", ["Vendor Refunds", ADJ]], "docname": ["in", refunds + list(adjustments)]})),
        ("File", lambda: refunds and frappe.db.delete(
            "File", {"attached_to_doctype": "Vendor Refunds", "attached_to_name": ["in", refunds]})),
        ("Vendor Refunds", lambda: refunds and frappe.db.delete("Vendor Refunds", {"name": ["in", refunds]})),
        (PAYMENT, lambda: pos and frappe.db.delete(PAYMENT, {"document_type": PO, "document_name": ["in", list(pos)]})),
        (ADJ_ITEM, lambda: adjustments and frappe.db.delete(ADJ_ITEM, {"parent": ["in", list(adjustments)]})),
        (ADJ, lambda: adjustments and frappe.db.delete(ADJ, {"name": ["in", list(adjustments)]})),
        (PO, lambda: pos and frappe.db.delete(PO, {"name": ["in", list(pos)]})),
    ]
