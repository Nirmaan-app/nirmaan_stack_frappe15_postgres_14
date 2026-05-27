import frappe


@frappe.whitelist()
def get_critical_po_milestone_links():
    """
    Return a map of Critical PO Item -> linked Work Milestones.

    Used by the Critical PO Categories master page to show, per Critical PO
    Item, which Work Milestones have it listed as a dependency in their
    `critical_po_dependencies` child table.

    Response shape:
        {
            "<critical_po_item_name>": [
                {"name": "<milestone_id>", "label": "<work_milestone_name>"},
                ...
            ],
            ...
        }
    """
    rows = frappe.db.sql(
        """
        SELECT
            d.critical_po_item AS critical_po_item,
            m.name             AS milestone_id,
            m.work_milestone_name AS milestone_label
        FROM "tabWork Milestone Critical PO Dependency" d
        INNER JOIN "tabWork Milestones" m
            ON m.name = d.parent
        WHERE d.parenttype = 'Work Milestones'
            AND d.critical_po_item IS NOT NULL
            AND d.critical_po_item <> ''
        ORDER BY m.work_milestone_name ASC
        """,
        as_dict=True,
    )

    grouped: dict[str, list[dict]] = {}
    seen: dict[str, set[str]] = {}
    for r in rows:
        item = r["critical_po_item"]
        mid = r["milestone_id"]
        if item not in seen:
            seen[item] = set()
            grouped[item] = []
        if mid in seen[item]:
            continue
        seen[item].add(mid)
        grouped[item].append(
            {"name": mid, "label": r["milestone_label"] or mid}
        )

    return grouped
