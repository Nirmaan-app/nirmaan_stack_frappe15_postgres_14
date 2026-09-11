"""Critical PO Tasks lifecycle hooks, plus the Procurement Orders hooks that keep
`Critical PO Tasks.linked_po_count` true when a PO's own save or delete changes its links."""

import frappe

from nirmaan_stack.api.critical_po_tasks.po_links import refresh_task_po_counts, task_label


def on_update(doc, method=None):
    """A task renamed directly (e.g. in Desk): keep its display name and sub-category on its PO link
    rows in step. The Critical PO Items master cascade writes tasks with set_value, so it updates the
    rows itself."""
    if doc.has_value_changed("item_name") or doc.has_value_changed("sub_category"):
        frappe.db.set_value("Critical PO Task Child Table", {"critical_po_task": doc.name},
                            {"task_name": task_label(doc.item_name, doc.sub_category),
                             "sub_category": doc.sub_category or ""},
                            update_modified=False)


def on_trash(doc, method=None):
    """Drop this task's `Critical PO Task Child Table` rows before Frappe's link check runs.

    Procurement Orders hold a Link to the task in their `critical_po_tasks` child table, so
    without this the link check refuses the delete -- from Manage Setup, and from the
    Critical PO Items master cascade (`critical_po_items.delete_matching_tasks`). Frappe runs
    on_trash BEFORE that check, which is what makes this the place to clear them.

    Raw delete on the child table: the parent PO is deliberately not saved. No PO field is
    derived from this link, so its on_update hooks would have nothing to recompute.
    """
    frappe.db.delete("Critical PO Task Child Table", {"critical_po_task": doc.name})


def _po_task_names(doc):
    return {row.critical_po_task for row in (doc.get("critical_po_tasks") or []) if row.critical_po_task}


def refresh_counts_on_po_update(doc, method=None):
    """A PO saved with a different set of task rows (e.g. edited in Desk): recount the tasks it gained
    AND the ones it lost. The link endpoint never saves the PO, so it recounts on its own."""
    before = doc.get_doc_before_save()
    changed = _po_task_names(doc) ^ (_po_task_names(before) if before else set())
    if changed:
        refresh_task_po_counts(changed)


def refresh_counts_on_po_delete(doc, method=None):
    """Deleting a PO deletes its link rows with it; recount the tasks it was linked to."""
    refresh_task_po_counts(_po_task_names(doc))
