"""
Patch: populate_critical_po_sub_category

Backfills the critical_po_sub_category field on existing Material Delivery Plan
and Cashflow Plan documents by looking up the sub_category from the matching
Critical PO Tasks record (matched on project + critical_po_category + task name).

Safe to re-run: Yes (idempotent - only updates records where critical_po_sub_category
is NULL or empty, and a matching Critical PO Tasks record with sub_category exists).
"""

import frappe


def execute():
    """
    Populate critical_po_sub_category for existing Material Delivery Plan
    and Cashflow Plan records by looking up sub_category from Critical PO Tasks.
    """

    # Build a lookup map from Critical PO Tasks: (project, category, task_name) -> sub_category
    tasks = frappe.get_all(
        "Critical PO Tasks",
        filters={
            "sub_category": ["is", "set"]
        },
        fields=["project", "critical_po_category", "item_name", "sub_category"],
        limit_page_length=None
    )

    task_map = {}
    for t in tasks:
        # Use get() for safer access, though keys should exist
        key = (t.get('project'), t.get('critical_po_category'), t.get('item_name'))
        task_map[key] = t.get('sub_category')

    if not task_map:
        print("No Critical PO Tasks with sub_category found. Nothing to update.")
        return

    # --- 1. Material Delivery Plan ---
    mdp_count = _update_doctype("Material Delivery Plan", task_map)

    # --- 2. Cashflow Plan ---
    cfp_count = _update_doctype("Cashflow Plan", task_map)

    print(f"Populated critical_po_sub_category:")
    print(f"  - Material Delivery Plan: {mdp_count} record(s) updated")
    print(f"  - Cashflow Plan: {cfp_count} record(s) updated")


def _update_doctype(doctype, task_map):
    """Update critical_po_sub_category for a given doctype using frappe.db.set_value."""
    plans = frappe.get_all(
        doctype,
        filters={
            "critical_po_task": ["is", "set"],
            "critical_po_category": ["is", "set"],
            "critical_po_sub_category": ["in", [None, ""]]
        },
        fields=["name", "project", "critical_po_category", "critical_po_task"],
        limit_page_length=None
    )

    count = 0
    for plan in plans:
        key = (plan.get('project'), plan.get('critical_po_category'), plan.get('critical_po_task'))
        sub_category = task_map.get(key)
        
        if sub_category:
            frappe.db.set_value(
                doctype,
                plan.get('name'),
                "critical_po_sub_category",
                sub_category,
                update_modified=False
            )
            count += 1

    return count
