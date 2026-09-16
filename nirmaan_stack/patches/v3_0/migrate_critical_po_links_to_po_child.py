"""Move Critical PO Task <-> PO links off `Critical PO Tasks.associated_pos` onto the PO.

The link used to live on the TASK as a JSON blob, `{"pos": [...]}`. It now lives on the PO as one
`Critical PO Task Child Table` row per (PO, task), under `Procurement Orders.critical_po_tasks`.

- A link to a PO that no longer exists is SKIPPED and printed. A JSON array can point at a deleted
  document forever; a Link row cannot, so there is nowhere to put it.
- Rows are inserted as child documents directly, so the parent PO is never saved. Deliberate:
  Procurement Orders carries three on_update hooks (controller, cashflow hold, action items) and no
  PO field is derived from this link, so firing them 1,200+ times would do work and change nothing.
- The old JSON is only read (straight from its column), never written.
- Sets every task's `linked_po_count` from its rows -- recomputed, so re-running corrects it.
- Idempotent: a (PO, task) pair that already has a row is skipped.
- Every row is written with its task's display name (`task_name` = item name, plus the sub-category
  in brackets when there is one), `critical_po_category` and `sub_category`.
- Rows that already exist are brought in step too: any whose `task_name` or `sub_category` differs
  from its task is rewritten.
"""

import json

import frappe

from nirmaan_stack.api.critical_po_tasks.po_links import refresh_task_po_counts, task_label

CHILD_DOCTYPE = "Critical PO Task Child Table"
PARENT_DOCTYPE = "Procurement Orders"
PARENTFIELD = "critical_po_tasks"


def _parse_pos(raw):
    """`associated_pos` arrives as a JSON string or an already-parsed dict / list."""
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    if isinstance(raw, dict):
        return raw.get("pos") or []
    if isinstance(raw, list):
        return raw
    return []


def execute():
    tasks = (
        frappe.db.sql(
            "select name, item_name, sub_category, critical_po_category, associated_pos from `tabCritical PO Tasks`",
            as_dict=True,
        )
        if frappe.db.has_column("Critical PO Tasks", "associated_pos")
        else []
    )
    existing_pos = set(frappe.get_all(PARENT_DOCTYPE, pluck="name", limit_page_length=0))

    existing_rows = frappe.get_all(
        CHILD_DOCTYPE,
        filters={"parenttype": PARENT_DOCTYPE, "parentfield": PARENTFIELD},
        fields=["name", "parent", "critical_po_task", "task_name", "sub_category", "idx"],
        limit_page_length=0,
    )
    linked = {(r.parent, r.critical_po_task) for r in existing_rows}
    last_idx = {}
    for r in existing_rows:
        last_idx[r.parent] = max(last_idx.get(r.parent, 0), r.idx or 0)

    inserted = 0
    skipped_existing = 0
    dead = []

    for task in tasks:
        for po in dict.fromkeys(_parse_pos(task.associated_pos)):  # de-dupe, keep order
            if po not in existing_pos:
                dead.append((task.name, po))
                continue
            if (po, task.name) in linked:
                skipped_existing += 1
                continue

            last_idx[po] = last_idx.get(po, 0) + 1
            frappe.get_doc({
                "doctype": CHILD_DOCTYPE,
                "parent": po,
                "parenttype": PARENT_DOCTYPE,
                "parentfield": PARENTFIELD,
                "idx": last_idx[po],
                "critical_po_task": task.name,
                "task_name": task_label(task.item_name, task.sub_category),
                "critical_po_category": task.critical_po_category,
                "sub_category": task.sub_category or "",
            }).insert(ignore_permissions=True)
            linked.add((po, task.name))
            inserted += 1

    # Rows already present were written by an earlier run or the link endpoint, before `sub_category`
    # existed or with an older label. Bring each one in step with its task.
    task_info = {
        t.name: (task_label(t.item_name, t.sub_category), t.sub_category or "")
        for t in frappe.get_all("Critical PO Tasks", fields=["name", "item_name", "sub_category"], limit_page_length=0)
    }
    resynced = 0
    for r in existing_rows:
        if r.critical_po_task not in task_info:
            continue
        label, sub_category = task_info[r.critical_po_task]
        if r.task_name != label or (r.sub_category or "") != sub_category:
            frappe.db.set_value(CHILD_DOCTYPE, r.name, {"task_name": label, "sub_category": sub_category},
                                update_modified=False)
            resynced += 1

    refresh_task_po_counts()

    actual = frappe.db.count(CHILD_DOCTYPE, {"parenttype": PARENT_DOCTYPE, "parentfield": PARENTFIELD})
    if actual != len(linked):
        frappe.throw(
            f"Critical PO Task Child Table count mismatch: expected {len(linked)} rows, found {actual}. "
            "Nothing was committed."
        )

    print(f"[migrate_critical_po_links_to_po_child] inserted={inserted} "
          f"already_present={skipped_existing} resynced={resynced} total_rows={actual} "
          f"dead_po_refs={len(dead)}")
    for task_name, po in dead:
        print(f"    skipped dead PO ref: task={task_name} po={po}")

    frappe.db.commit()
