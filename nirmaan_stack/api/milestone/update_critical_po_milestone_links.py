import json

import frappe


@frappe.whitelist()
def update_milestone_links_for_critical_po_item(critical_po_item, links):
    """
    Sync which Work Milestones link to a given Critical PO Item.

    `links` is the FULL desired set of links. For each entry:
      - If the milestone is not currently linked, add a row to its
        `critical_po_dependencies` child table with the supplied
        `delivery_percentage` (1-100).
      - If the milestone is already linked, leave the existing row untouched
        (use the milestone-side dialog to tune the % later).
    Any milestone currently linked but missing from `links` is removed.

    Args:
        critical_po_item (str): Critical PO Item name.
        links (list[dict] | str): [
            {"milestone_id": "<milestone>", "delivery_percentage": <num>},
            ...
        ]. JSON-encoded string also accepted.

    Returns:
        dict: { "added": [...], "removed": [...] }
    """
    if not critical_po_item:
        frappe.throw("critical_po_item is required")

    if isinstance(links, str):
        try:
            links = json.loads(links)
        except (TypeError, ValueError):
            links = []

    normalized = []
    for entry in links or []:
        if not isinstance(entry, dict):
            continue
        mid = entry.get("milestone_id")
        if not mid:
            continue
        pct = entry.get("delivery_percentage")
        try:
            pct = float(pct) if pct is not None else None
        except (TypeError, ValueError):
            pct = None
        normalized.append({"milestone_id": mid, "delivery_percentage": pct})

    desired_ids = {e["milestone_id"] for e in normalized}
    pct_by_id = {e["milestone_id"]: e["delivery_percentage"] for e in normalized}

    current_rows = frappe.db.sql(
        """
        SELECT DISTINCT parent AS milestone_id
        FROM "tabWork Milestone Critical PO Dependency"
        WHERE parenttype = 'Work Milestones'
            AND critical_po_item = %(item)s
        """,
        {"item": critical_po_item},
        as_dict=True,
    )
    current = {r["milestone_id"] for r in current_rows}

    to_add = desired_ids - current
    to_remove = current - desired_ids

    if not to_add and not to_remove:
        return {"added": [], "removed": []}

    if not frappe.db.exists("Critical PO Items", critical_po_item):
        frappe.throw(f"Critical PO Item '{critical_po_item}' does not exist")

    for mid in to_add:
        pct = pct_by_id.get(mid)
        if pct is None or pct < 1 or pct > 100:
            frappe.throw(
                f"Delivery % for milestone '{mid}' must be between 1 and 100"
            )
        if not frappe.db.exists("Work Milestones", mid):
            frappe.throw(f"Work Milestone '{mid}' does not exist")

    for mid in to_add:
        doc = frappe.get_doc("Work Milestones", mid)
        doc.append(
            "critical_po_dependencies",
            {
                "critical_po_item": critical_po_item,
                "delivery_percentage": pct_by_id[mid],
                "remarks": "",
            },
        )
        doc.save(ignore_permissions=False)

    for mid in to_remove:
        doc = frappe.get_doc("Work Milestones", mid)
        kept = [
            row
            for row in (doc.critical_po_dependencies or [])
            if row.critical_po_item != critical_po_item
        ]
        if len(kept) != len(doc.critical_po_dependencies or []):
            doc.set("critical_po_dependencies", kept)
            doc.save(ignore_permissions=False)

    frappe.db.commit()

    return {
        "added": sorted(to_add),
        "removed": sorted(to_remove),
    }
