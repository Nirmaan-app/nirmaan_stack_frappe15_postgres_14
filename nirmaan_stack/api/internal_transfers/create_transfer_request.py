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
def create_transfer_request(target_project: str = None, selections: Any = None, target_type: str = "Project") -> dict:
    """Create N ITRs grouped by source_project (or one ITR for warehouse source).

    Args:
        target_project: Destination project name (required when target_type="Project").
        selections: List of ``{item_id, source_project, transfer_quantity, source_type?}`` dicts.
                    source_type defaults to "Project". Use "Warehouse" for warehouse source
                    (source_project can be empty in that case).
        target_type: "Project" (default) or "Warehouse". When "Warehouse", target_project
                     is ignored and material goes to the warehouse.

    Returns:
        ``{"requests": ["ITR-2026-00001", ...], "count": N}``
    """

    if frappe.session.user == "Guest":
        frappe.throw("Authentication required.")

    selections = frappe.parse_json(selections) or []
    if not isinstance(selections, list) or len(selections) == 0:
        frappe.throw("At least one item selection is required.")

    target_type = (target_type or "Project").strip() or "Project"

    if target_type == "Project":
        if not target_project:
            frappe.throw("Target project is required.")
        if not frappe.db.exists("Projects", target_project):
            frappe.throw(f"Target project {target_project} does not exist.")
    else:
        target_project = None

    # --- Pre-flight validation ---
    normalized = []
    for idx, sel in enumerate(selections, start=1):
        if not isinstance(sel, dict):
            frappe.throw(f"Selection #{idx} is malformed.")

        item_id = (sel.get("item_id") or "").strip()
        source_type = (sel.get("source_type") or "Project").strip()
        source_project = (sel.get("source_project") or "").strip()
        transfer_quantity = flt(sel.get("transfer_quantity") or 0)
        # make is required to identify the specific (item, make) bucket in the
        # warehouse; for project-source selections it is snapshotted from the
        # RIR later, so we don't trust the caller's value.
        raw_make = sel.get("make")
        make = (raw_make.strip() or None) if isinstance(raw_make, str) else raw_make

        if not item_id:
            frappe.throw(f"Selection #{idx} is missing item_id.")
        if source_type == "Project" and not source_project:
            frappe.throw(f"Selection #{idx} is missing source_project.")
        if transfer_quantity <= 0:
            frappe.throw(
                f"Selection #{idx} ({item_id}): non-positive quantity."
            )
        if target_type == "Warehouse" and source_type == "Warehouse":
            frappe.throw(
                f"Selection #{idx} ({item_id}): source and target cannot both be Warehouse."
            )
        if (
            source_type == "Project" and target_type == "Project"
            and source_project == target_project
        ):
            frappe.throw(
                f"Selection #{idx} ({item_id}): source project cannot equal target project."
            )

        normalized.append({
            "item_id": item_id,
            "source_type": source_type,
            "source_project": source_project if source_type == "Project" else "",
            "transfer_quantity": transfer_quantity,
            # Both warehouse- and project-source selections carry make so the
            # availability guard and the resulting ITR row can be precise about
            # which (item, make) bucket is being moved. For project sources,
            # the make value originates from the RIR row exposed by the picker.
            "make": make,
        })

    # --- Availability guard ---
    from nirmaan_stack.integrations.controllers.internal_transfer_request import (
        available_quantity,
        warehouse_available_quantity,
    )

    # Check project-sourced items — keyed by (item, source_project, make) so
    # different makes of the same item in the same project don't share a budget.
    proj_aggregated: dict[tuple[str, str, str | None], float] = defaultdict(float)
    # Warehouse source availability is per (item, make) bucket.
    wh_aggregated: dict[tuple[str, str | None], float] = defaultdict(float)
    for sel in normalized:
        if sel["source_type"] == "Warehouse":
            wh_aggregated[(sel["item_id"], sel.get("make"))] += sel["transfer_quantity"]
        else:
            proj_aggregated[(sel["item_id"], sel["source_project"], sel.get("make"))] += sel["transfer_quantity"]

    errors = []
    for (item_id, source_project, make), requested in proj_aggregated.items():
        available = available_quantity(item_id, source_project, make=make)
        if requested > flt(available):
            make_label = f" ({make})" if make else ""
            errors.append(
                f"Item {item_id}{make_label} in {source_project}: requested {requested}, available {available}"
            )
    for (item_id, make), requested in wh_aggregated.items():
        available = warehouse_available_quantity(item_id, make)
        if requested > flt(available):
            make_label = f" ({make})" if make else ""
            errors.append(
                f"Item {item_id}{make_label} in Warehouse: requested {requested}, available {available}"
            )
    if errors:
        frappe.throw(
            "Requested quantities exceed available inventory:\n- " + "\n- ".join(errors)
        )

    # --- Split into project-sourced and warehouse-sourced ---
    project_sels = [s for s in normalized if s["source_type"] == "Project"]
    warehouse_sels = [s for s in normalized if s["source_type"] == "Warehouse"]

    # --- Group project selections by source_project ---
    groups: dict[str, list[dict]] = defaultdict(list)
    for sel in project_sels:
        groups[sel["source_project"]].append(sel)

    # --- Fetch latest RIR per source project ---
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

    # --- Build metadata snapshot for project items ---
    snapshot = _build_metadata_snapshot(latest_rir_by_source, project_sels) if project_sels else {}

    # --- Build metadata snapshot for warehouse items ---
    wh_snapshot = _build_warehouse_metadata_snapshot(warehouse_sels) if warehouse_sels else {}

    # --- Create ITRs for project sources ---
    created = []
    for source_project, group_sels in groups.items():
        itr = frappe.new_doc("Internal Transfer Request")
        itr.source_type = "Project"
        itr.source_project = source_project
        itr.target_type = target_type
        itr.target_project = target_project
        itr.source_rir = latest_rir_by_source[source_project]
        itr.requested_by = frappe.session.user
        itr.status = "Pending"
        itr.memo_count = 0

        for sel in group_sels:
            snap = snapshot.get((sel["source_project"], sel["item_id"]), {})
            # Selection's make is authoritative — the picker showed the user
            # exactly which (item, make) bucket they were picking from. Fall
            # back to the RIR snapshot's make only when the selection lacks one
            # (legacy callers that haven't been upgraded yet).
            itr.append("items", {
                "item_id": sel["item_id"],
                "item_name": snap.get("item_name"),
                "unit": snap.get("unit"),
                "category": snap.get("category"),
                "make": sel.get("make") if sel.get("make") is not None else snap.get("make"),
                "transfer_quantity": sel["transfer_quantity"],
                "estimated_rate": snap.get("estimated_rate") or 0,
                "status": "Pending",
            })

        itr.insert()
        created.append(itr.name)

    # --- Create one ITR for warehouse source (if any) ---
    if warehouse_sels:
        itr = frappe.new_doc("Internal Transfer Request")
        itr.source_type = "Warehouse"
        itr.source_project = None
        itr.target_type = target_type
        itr.target_project = target_project
        itr.source_rir = None
        itr.requested_by = frappe.session.user
        itr.status = "Pending"
        itr.memo_count = 0

        for sel in warehouse_sels:
            snap = wh_snapshot.get((sel["item_id"], sel.get("make")), {})
            itr.append("items", {
                "item_id": sel["item_id"],
                "item_name": snap.get("item_name"),
                "unit": snap.get("unit"),
                "category": snap.get("category"),
                # Use the make from the selection (identifies the WSI bucket);
                # snapshot may have the same value, but selection is source of truth.
                "make": sel.get("make"),
                "transfer_quantity": sel["transfer_quantity"],
                "estimated_rate": snap.get("estimated_rate") or 0,
                "status": "Pending",
            })

        itr.insert()
        created.append(itr.name)

    frappe.db.commit()

    return {"requests": created, "count": len(created)}


def _build_metadata_snapshot(latest_rir_by_source, selections):
    """Fetch item_name/unit/category/make from RIR and estimated_rate from PO.

    `make` is sourced from the RIR child row (stamped by
    RemainingItemsReport.validate at submit time from the latest PO Item).
    RIR is the authoritative snapshot of what make is physically on the project
    as of that report, so we read it straight through instead of re-querying
    the latest PO here. See docs under `RemainingItemsReport._stamp_latest_po_make`.
    """

    if not selections:
        return {}

    rir_names = tuple(latest_rir_by_source.values())
    item_ids = tuple({sel["item_id"] for sel in selections})
    source_projects = tuple({sel["source_project"] for sel in selections})

    # RIR fields (make comes from here too)
    rir_rows = frappe.db.sql(
        """
        SELECT parent AS rir_name, item_id, item_name, unit, category, make
        FROM "tabRemaining Item Entry"
        WHERE parent IN %(rir_names)s AND item_id IN %(item_ids)s
        """,
        {"rir_names": rir_names, "item_ids": item_ids},
        as_dict=True,
    ) if rir_names and item_ids else []

    rir_index = {(row["rir_name"], row["item_id"]): row for row in rir_rows}

    # PO-derived estimated_rate only — make now comes from the RIR row.
    po_rows = frappe.db.sql(
        """
        SELECT po.project, poi.item_id, MAX(poi.quote) AS max_quote
        FROM "tabPurchase Order Item" poi
        JOIN "tabProcurement Orders" po ON poi.parent = po.name
        WHERE po.status NOT IN ('Merged', 'Inactive', 'PO Amendment')
          AND po.project IN %(source_projects)s
          AND poi.item_id IN %(item_ids)s
        GROUP BY po.project, poi.item_id
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
            "make": (rir_hit or {}).get("make"),
            "estimated_rate": flt(po_hit.get("max_quote") or 0),
        }

    return snapshot


def _build_warehouse_metadata_snapshot(selections):
    """Fetch item metadata from Warehouse Stock Item (falls back to Items master).

    Keyed by (item_id, make) — each distinct bucket in the warehouse has its
    own row. `make` may be None for items with no known make.
    """
    if not selections:
        return {}

    item_ids = tuple({sel["item_id"] for sel in selections})

    # Items master
    items_rows = frappe.db.sql(
        """SELECT name AS item_id, item_name, unit_name AS unit, category
        FROM "tabItems" WHERE name IN %(item_ids)s""",
        {"item_ids": item_ids},
        as_dict=True,
    ) if item_ids else []
    items_index = {row["item_id"]: row for row in items_rows}

    # Warehouse Stock Item — one row per (item_id, make) pair.
    wsi_rows = frappe.db.sql(
        """SELECT item_id, item_name, unit, category, make, estimated_rate
        FROM "tabWarehouse Stock Item" WHERE item_id IN %(item_ids)s""",
        {"item_ids": item_ids},
        as_dict=True,
    ) if item_ids else []
    wsi_index = {(row["item_id"], row["make"]): row for row in wsi_rows}

    snapshot = {}
    for sel in selections:
        iid = sel["item_id"]
        make = sel.get("make")
        items_hit = items_index.get(iid) or {}
        wsi_hit = wsi_index.get((iid, make)) or {}

        snapshot[(iid, make)] = {
            "item_name": wsi_hit.get("item_name") or items_hit.get("item_name") or iid,
            "unit": wsi_hit.get("unit") or items_hit.get("unit"),
            "category": wsi_hit.get("category") or items_hit.get("category"),
            "make": wsi_hit.get("make") or make,
            "estimated_rate": flt(wsi_hit.get("estimated_rate") or 0),
        }

    return snapshot
