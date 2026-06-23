"""
Project Action Item — event-hook glue (timeliness layer).

Thin, NON-INVASIVE doc_event handlers that enqueue a per-project reconcile whenever
a PO / DN / DC change could alter a project's pending-obligation set. The actual
recompute lives in `reconcile.reconcile_project_action_items`; these handlers only
RESOLVE the affected project and enqueue.

Correctness / safety contract (docs/prd/project-action-items.md §2 invariant 6, §5):
  * NEVER breaks the host save. Every handler is wrapped so any failure is logged and
    swallowed — a missing/broken reconciler can never fail a PO/DN/DC save.
  * `enqueue_after_commit=True` is MANDATORY on the enqueue — otherwise the background
    job can run BEFORE the triggering write commits and read stale state.
  * `deduplicate=True` + a stable `job_id=pai::{project}` collapse a burst of changes
    for the same project into one queued job.
  * Event hooks are a LATENCY optimisation only; the nightly sweep (reconcile_all) is
    the correctness backstop. So a no-op (blank link / out-of-scope parent / failure)
    is always safe — the sweep eventually heals it.

Out of v1 scope (skipped, never enqueued):
  * ITM-parented DN / DC rows (`parent_doctype == "Internal Transfer Memo"`).
  * Blank / legacy links (`procurement_order` / `parent_docname` may be unset on old
    rows) — guarded so a query never crashes a save.
"""

import frappe

_RECONCILE_METHOD = (
    "nirmaan_stack.services.action_items.reconcile.reconcile_project_action_items"
)


def enqueue_project_reconcile(project):
    """Enqueue a deduplicated, after-commit reconcile for one project.

    Safe to call from inside any doc save: a blank project is a no-op and any
    exception is logged and swallowed (the host save must NEVER fail because of an
    action-item enqueue — §2 invariant 6).
    """
    if not project:
        return
    try:
        frappe.enqueue(
            _RECONCILE_METHOD,
            project_name=project,
            queue="short",
            deduplicate=True,
            job_id=f"pai::{project}",
            enqueue_after_commit=True,  # MANDATORY — else the job reads uncommitted state.
        )
    except Exception:
        # Never break the host save — log and move on; the nightly sweep self-heals.
        frappe.log_error(
            frappe.get_traceback(),
            "action-item enqueue failed",
        )


def _po_project(po_name):
    """Resolve a PO docname to its project (None if blank/unknown). Never raises."""
    if not po_name:
        return None
    try:
        return frappe.db.get_value("Procurement Orders", po_name, "project")
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "action-item PO project lookup failed",
        )
        return None


def on_po_update(doc, method=None):
    """Procurement Orders.on_update — dispatch / revert / status change.

    The project is on the PO doc directly. Non-blocking: enqueue_project_reconcile
    swallows a blank project and any failure.
    """
    enqueue_project_reconcile(getattr(doc, "project", None))


def _on_dn_change(doc):
    """Shared DN handler for on_update + after_delete.

    SKIP ITM-parented DNs (out of v1, mirrors the existing controller's
    `parent_doctype == "Internal Transfer Memo"` guard). Resolve the project from the
    DN's `procurement_order` PO link; a blank/legacy link is a no-op (never crashes
    the save).
    """
    try:
        if getattr(doc, "parent_doctype", None) == "Internal Transfer Memo":
            return
        po_name = getattr(doc, "procurement_order", None)
        enqueue_project_reconcile(_po_project(po_name))
    except Exception:
        # Defensive: a host DN save must never fail because of this hook.
        frappe.log_error(
            frappe.get_traceback(),
            "action-item DN hook failed",
        )


def on_dn_update(doc, method=None):
    """Delivery Notes.on_update — DN created / edited."""
    _on_dn_change(doc)


def on_dn_delete(doc, method=None):
    """Delivery Notes.after_delete — DN deleted (re-opens the DN obligation)."""
    _on_dn_change(doc)


def _on_pdd_change(doc):
    """Shared PO Delivery Documents handler for after_insert + on_trash.

    SKIP rows whose parent is NOT a Procurement Order (ITM is out of v1). Resolve the
    project from the parent PO (`parent_docname`); a blank link is a no-op.
    """
    try:
        if getattr(doc, "parent_doctype", None) != "Procurement Orders":
            return
        po_name = getattr(doc, "parent_docname", None)
        enqueue_project_reconcile(_po_project(po_name))
    except Exception:
        # Defensive: a host DC/MIR save must never fail because of this hook.
        frappe.log_error(
            frappe.get_traceback(),
            "action-item PDD hook failed",
        )


def on_pdd_insert(doc, method=None):
    """PO Delivery Documents.after_insert — DC (or MIR) created."""
    _on_pdd_change(doc)


def on_pdd_delete(doc, method=None):
    """PO Delivery Documents.on_trash — DC (or MIR) deleted (re-opens DC obligation)."""
    _on_pdd_change(doc)
