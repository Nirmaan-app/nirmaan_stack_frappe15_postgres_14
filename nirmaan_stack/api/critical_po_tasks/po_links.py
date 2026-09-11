"""Critical PO Task <-> Procurement Order links.

A link is one `Critical PO Task Child Table` row under `Procurement Orders.critical_po_tasks`. This
module owns it: every write goes through `update_po_task_links`, and server-side reads go through
`get_task_pos` / `get_project_task_pos`.
"""

import json

import frappe

CHILD_DOCTYPE = "Critical PO Task Child Table"
PARENT_DOCTYPE = "Procurement Orders"
PARENTFIELD = "critical_po_tasks"


def _parse_pairs(value):
    """`[{"po": ..., "task": ...}, ...]`, or its JSON string, -> unique (po, task) pairs."""
    if not value:
        return []
    if isinstance(value, str):
        value = json.loads(value)
    pairs = []
    for item in value:
        po, task = (item or {}).get("po"), (item or {}).get("task")
        if not po or not task:
            frappe.throw("Each link needs both a po and a task.")
        pairs.append((po, task))
    return list(dict.fromkeys(pairs))


def _link_filters(po, task):
    return {"parent": po, "parenttype": PARENT_DOCTYPE, "parentfield": PARENTFIELD, "critical_po_task": task}


def task_label(item_name, sub_category):
    """A Critical PO Task's display name -- what `task_name` stores on each link row. Mirrors the
    frontend's `criticalPOLabel` (components/helpers/CriticalPOCell.tsx); keep the two identical,
    because the PO list's Critical PO facet filters on this string."""
    return f"{item_name} ({sub_category})" if sub_category else (item_name or "")


def get_task_pos(task):
    """PO names linked to one Critical PO Task, sorted by name."""
    return frappe.get_all(
        CHILD_DOCTYPE,
        filters={"parenttype": PARENT_DOCTYPE, "parentfield": PARENTFIELD, "critical_po_task": task},
        pluck="parent",
        order_by="parent asc",
    )


def get_project_task_pos(project):
    """`{task name: [PO names]}` for every linked task of a project. One query, no IN list."""
    rows = frappe.db.sql(
        """
        select c.critical_po_task as task, c.parent as po
        from `tabCritical PO Task Child Table` c
        join `tabCritical PO Tasks` t on t.name = c.critical_po_task
        where t.project = %s and c.parenttype = %s and c.parentfield = %s
        order by c.parent
        """,
        (project, PARENT_DOCTYPE, PARENTFIELD),
        as_dict=True,
    )
    links = {}
    for row in rows:
        links.setdefault(row.task, []).append(row.po)
    return links


def refresh_task_po_counts(task_names=None):
    """Recompute `Critical PO Tasks.linked_po_count` from the child table -- from source, never by a delta.

    `task_names=None` recounts every task (the migration). Raw UPDATE, so the task's on_update (which
    only syncs its name onto link rows) is skipped on purpose, and `modified` is left alone because a
    link change is not an edit of the task.
    """
    count_sql = """
        update `tabCritical PO Tasks` t
        set linked_po_count = (
            select count(*) from `tabCritical PO Task Child Table` c
            where c.critical_po_task = t.name and c.parenttype = 'Procurement Orders'
        )
    """
    if task_names is None:
        frappe.db.sql(count_sql)
        return
    names = tuple(sorted({n for n in task_names if n}))
    if names:
        frappe.db.sql(count_sql + " where t.name in %(names)s", {"names": names})


@frappe.whitelist(methods=["POST"])
def update_po_task_links(add=None, remove=None):
    """Add and/or remove (PO, Critical PO Task) links in one transaction.

    `add` / `remove`: lists of `{"po": <Procurement Orders name>, "task": <Critical PO Tasks name>}`.
    Permission is WRITE on every task touched.

    Child rows are inserted and deleted directly; the parent PO is never saved. No PO field is
    derived from this link, so its on_update hooks (controller, cashflow hold, action items) have
    nothing to recompute.
    """
    add, remove = _parse_pairs(add), _parse_pairs(remove)
    if not add and not remove:
        return {"added": 0, "removed": 0}

    task_names = sorted({task for _, task in add + remove})
    tasks = {
        t.name: t
        for t in frappe.get_all(
            "Critical PO Tasks",
            filters={"name": ["in", task_names]},
            fields=["name", "project", "item_name", "sub_category", "critical_po_category"],
        )
    }
    for task in task_names:
        if task not in tasks:
            frappe.throw(f"Critical PO Task {task} not found.")
        frappe.has_permission("Critical PO Tasks", "write", task, throw=True)

    removed = 0
    for po, task in remove:
        if frappe.db.exists(CHILD_DOCTYPE, _link_filters(po, task)):
            frappe.db.delete(CHILD_DOCTYPE, _link_filters(po, task))
            removed += 1

    added = 0
    if add:
        po_project = dict(
            frappe.get_all(
                PARENT_DOCTYPE,
                filters={"name": ["in", sorted({po for po, _ in add})]},
                fields=["name", "project"],
                as_list=True,
            )
        )
        for po, task in add:
            if po not in po_project:
                frappe.throw(f"Procurement Order {po} not found.")
            if po_project[po] != tasks[task].project:
                frappe.throw(f"{po} and Critical PO Task {task} belong to different projects.")
            if frappe.db.exists(CHILD_DOCTYPE, _link_filters(po, task)):
                continue
            last_idx = frappe.db.sql(
                "select coalesce(max(idx), 0) from `tabCritical PO Task Child Table` where parent = %s and parentfield = %s",
                (po, PARENTFIELD),
            )[0][0]
            frappe.get_doc({
                "doctype": CHILD_DOCTYPE,
                "parent": po,
                "parenttype": PARENT_DOCTYPE,
                "parentfield": PARENTFIELD,
                "idx": last_idx + 1,
                "critical_po_task": task,
                "task_name": task_label(tasks[task].item_name, tasks[task].sub_category),
                "critical_po_category": tasks[task].critical_po_category,
                "sub_category": tasks[task].sub_category or "",
            }).insert(ignore_permissions=True)
            added += 1

    refresh_task_po_counts(task_names)
    frappe.db.commit()
    return {"added": added, "removed": removed}
