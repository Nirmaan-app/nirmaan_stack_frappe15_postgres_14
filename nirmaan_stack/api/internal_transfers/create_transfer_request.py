"""
Create Transfer Request(s) from the inventory picker.

Groups selections by source_project and creates one ITR per source.
Each ITR = one source → one target → N items.
"""

from collections import defaultdict
from typing import Any

import frappe
from frappe.utils import flt


@frappe.whitelist()
def create_transfer_request(target_project: str, selections: Any) -> dict:
    """Create N ITRs grouped by source_project.

    Args:
        target_project: Destination project name.
        selections: List of ``{item_id, source_project, transfer_quantity}`` dicts.

    Returns:
        ``{"requests": ["ITR-2026-00001", ...], "count": N}``
    """

    if frappe.session.user == "Guest":
        frappe.throw("Authentication required.")

    selections = frappe.parse_json(selections) or []
    if not isinstance(selections, list) or len(selections) == 0:
        frappe.throw("At least one item selection is required.")

    if not target_project:
        frappe.throw("Target project is required.")

    if not frappe.db.exists("Projects", target_project):
        frappe.throw(f"Target project {target_project} does not exist.")

    # --- Pre-flight validation ---
    normalized = []
    for idx, sel in enumerate(selections, start=1):
        if not isinstance(sel, dict):
            frappe.throw(f"Selection #{idx} is malformed.")

        item_id = (sel.get("item_id") or "").strip()
        source_project = (sel.get("source_project") or "").strip()
        transfer_quantity = flt(sel.get("transfer_quantity") or 0)

        if not item_id:
            frappe.throw(f"Selection #{idx} is missing item_id.")
        if not source_project:
            frappe.throw(f"Selection #{idx} is missing source_project.")
        if transfer_quantity <= 0:
            frappe.throw(
                f"Selection #{idx} ({item_id} from {source_project}) has non-positive quantity."
            )
        if source_project == target_project:
            frappe.throw(
                f"Selection #{idx} ({item_id}): source project cannot equal target project."
            )

        normalized.append({
            "item_id": item_id,
            "source_project": source_project,
            "transfer_quantity": transfer_quantity,
        })

    # --- Availability guard ---
    from nirmaan_stack.integrations.controllers.internal_transfer_request import (
        available_quantity,
    )

    aggregated: dict[tuple[str, str], float] = defaultdict(float)
    for sel in normalized:
        aggregated[(sel["item_id"], sel["source_project"])] += sel["transfer_quantity"]

    errors = []
    for (item_id, source_project), requested in aggregated.items():
        available = available_quantity(item_id, source_project)
        if requested > flt(available):
            errors.append(
                f"Item {item_id} in {source_project}: requested {requested}, available {available}"
            )
    if errors:
        frappe.throw(
            "Requested quantities exceed available inventory:\n- " + "\n- ".join(errors)
        )

    # --- Group by source_project ---
    groups: dict[str, list[dict]] = defaultdict(list)
    for sel in normalized:
        groups[sel["source_project"]].append(sel)

    # --- Fetch latest RIR per source ---
    latest_rir_by_source = {}
    for src in groups.keys():
        rir = frappe.db.sql(
            """
            SELECT name FROM "tabRemaining Items Report"
            WHERE project = %(project)s AND status = 'Submitted'
            ORDER BY report_date DESC, creation DESC LIMIT 1
            """,
            {"project": src},
            as_dict=True,
        )
        if not rir:
            frappe.throw(f"No submitted Remaining Items Report found for {src}.")
        latest_rir_by_source[src] = rir[0]["name"]

    # --- Build metadata snapshot ---
    snapshot = _build_metadata_snapshot(latest_rir_by_source, normalized)

    # --- Create N ITRs (one per source) ---
    created = []
    for source_project, group_sels in groups.items():
        itr = frappe.new_doc("Internal Transfer Request")
        itr.source_project = source_project
        itr.target_project = target_project
        itr.source_rir = latest_rir_by_source[source_project]
        itr.requested_by = frappe.session.user
        itr.status = "Pending"
        itr.memo_count = 0

        for sel in group_sels:
            snap = snapshot.get((sel["source_project"], sel["item_id"]), {})
            itr.append("items", {
                "item_id": sel["item_id"],
                "item_name": snap.get("item_name"),
                "unit": snap.get("unit"),
                "category": snap.get("category"),
                "make": snap.get("make"),
                "transfer_quantity": sel["transfer_quantity"],
                "estimated_rate": snap.get("estimated_rate") or 0,
                "status": "Pending",
            })

        itr.insert()
        created.append(itr.name)

    frappe.db.commit()

    return {"requests": created, "count": len(created)}


def _build_metadata_snapshot(latest_rir_by_source, selections):
    """Fetch item_name/unit/category from RIR and make/estimated_rate from PO."""

    if not selections:
        return {}

    rir_names = tuple(latest_rir_by_source.values())
    item_ids = tuple({sel["item_id"] for sel in selections})
    source_projects = tuple({sel["source_project"] for sel in selections})

    # RIR fields
    rir_rows = frappe.db.sql(
        """
        SELECT parent AS rir_name, item_id, item_name, unit, category
        FROM "tabRemaining Item Entry"
        WHERE parent IN %(rir_names)s AND item_id IN %(item_ids)s
        """,
        {"rir_names": rir_names, "item_ids": item_ids},
        as_dict=True,
    ) if rir_names and item_ids else []

    rir_index = {(row["rir_name"], row["item_id"]): row for row in rir_rows}

    # PO rates + make
    po_rows = frappe.db.sql(
        """
        WITH ranked AS (
            SELECT po.project, poi.item_id, poi.quote, poi.make,
                ROW_NUMBER() OVER (
                    PARTITION BY po.project, poi.item_id ORDER BY poi.quote DESC
                ) AS rn_rate,
                ROW_NUMBER() OVER (
                    PARTITION BY po.project, poi.item_id ORDER BY poi.creation DESC
                ) AS rn_recent
            FROM "tabPurchase Order Item" poi
            JOIN "tabProcurement Orders" po ON poi.parent = po.name
            WHERE po.status NOT IN ('Merged', 'Inactive', 'PO Amendment')
              AND po.project IN %(source_projects)s AND poi.item_id IN %(item_ids)s
        ),
        rate_row AS (SELECT project, item_id, quote FROM ranked WHERE rn_rate = 1),
        make_row AS (SELECT project, item_id, make FROM ranked WHERE rn_recent = 1)
        SELECT COALESCE(r.project, m.project) AS project,
               COALESCE(r.item_id, m.item_id) AS item_id,
               r.quote AS max_quote, m.make AS latest_make
        FROM rate_row r
        FULL OUTER JOIN make_row m ON r.project = m.project AND r.item_id = m.item_id
        """,
        {"source_projects": source_projects, "item_ids": item_ids},
        as_dict=True,
    ) if source_projects and item_ids else []

    po_index = {(row["project"], row["item_id"]): row for row in po_rows}

    # Items master fallback
    items_rows = frappe.db.sql(
        """SELECT name AS item_id, item_name, unit_name AS unit, category
        FROM "tabItems" WHERE name IN %(item_ids)s""",
        {"item_ids": item_ids},
        as_dict=True,
    ) if item_ids else []
    items_index = {row["item_id"]: row for row in items_rows}

    # Merge
    snapshot = {}
    for sel in selections:
        src = sel["source_project"]
        iid = sel["item_id"]
        rir_name = latest_rir_by_source.get(src)
        rir_hit = rir_index.get((rir_name, iid)) if rir_name else None
        items_hit = items_index.get(iid) or {}
        po_hit = po_index.get((src, iid)) or {}

        snapshot[(src, iid)] = {
            "item_name": (rir_hit or {}).get("item_name") or items_hit.get("item_name") or iid,
            "unit": (rir_hit or {}).get("unit") or items_hit.get("unit"),
            "category": (rir_hit or {}).get("category") or items_hit.get("category"),
            "make": po_hit.get("latest_make"),
            "estimated_rate": flt(po_hit.get("max_quote") or 0),
        }

    return snapshot
