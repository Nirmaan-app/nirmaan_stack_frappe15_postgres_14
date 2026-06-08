# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""
Create Internal Transfer Memo(s) directly from the inventory picker.

Replaces the legacy two-step ITR → approve → ITM flow with a single atomic
create. Selections are grouped by ``source_project``; warehouse-sourced
selections collapse into one extra ITM. Each ITM is born in ``Approved``
status with ``requested_by = approved_by = session.user`` and
``approved_on = now``.

If any per-source insert fails validation (controller's `validate` hook
re-runs the basic invariants and the state-machine transition guard),
all earlier inserts in the same call are rolled back via savepoint.
"""

from collections import defaultdict
from typing import Any

import frappe
from frappe.utils import flt, now_datetime


@frappe.whitelist()
def create_itms(
    target_project: str = None,
    selections: Any = None,
    target_type: str = "Project",
) -> dict:
    """Create N Internal Transfer Memos atomically.

    Args:
        target_project: Destination project name (required when
            ``target_type='Project'``; ignored for warehouse target).
        selections: List of ``{item_id, source_project, transfer_quantity,
            source_type?, make?}`` dicts. ``source_type`` defaults to
            ``Project``. For warehouse-sourced rows, ``source_project`` may
            be empty.
        target_type: ``Project`` (default) or ``Warehouse``.

    Returns:
        ``{"itms": ["ITM-2026-00001", ...], "count": N}``.
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
        # Empty / whitespace make → NULL bucket (matches RIR snapshot rules).
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
            "make": make,
        })

    # --- Availability guard (aggregate per bucket so one error per bucket) ---
    from nirmaan_stack.integrations.controllers.internal_transfer_memo import (
        available_quantity,
        warehouse_available_quantity,
    )

    proj_aggregated: dict[tuple[str, str, str | None], float] = defaultdict(float)
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
        available = warehouse_available_quantity(item_id, make=make)
        if requested > flt(available):
            make_label = f" ({make})" if make else ""
            errors.append(
                f"Item {item_id}{make_label} in Warehouse: requested {requested}, available {available}"
            )
    if errors:
        frappe.throw(
            "Requested quantities exceed available inventory:\n- " + "\n- ".join(errors)
        )

    # --- Split + group ---
    project_sels = [s for s in normalized if s["source_type"] == "Project"]
    warehouse_sels = [s for s in normalized if s["source_type"] == "Warehouse"]

    groups: dict[str, list[dict]] = defaultdict(list)
    for sel in project_sels:
        groups[sel["source_project"]].append(sel)

    # --- Latest submitted RIR per source project ---
    latest_rir_by_source: dict[str, str] = {}
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

    # --- Metadata snapshots ---
    snapshot = _build_metadata_snapshot(latest_rir_by_source, project_sels) if project_sels else {}
    wh_snapshot = _build_warehouse_metadata_snapshot(warehouse_sels) if warehouse_sels else {}

    # --- Atomic ITM creation ---
    #
    # The controller's ``after_insert`` hook normally commits inside every
    # ``doc.insert()`` so the realtime ``itm:created`` event is emitted on a
    # transaction the receivers can see. Inside this batch endpoint that
    # would defeat any savepoint-based rollback — committing destroys the
    # savepoint, so a failure halfway through would leave the earlier
    # inserts persisted with no way to undo. We set the
    # ``itm_create_in_progress`` flag so the hook short-circuits, hold the
    # transaction open for the whole batch, then commit once at the end and
    # publish the events ourselves.
    created: list[str] = []
    requester = frappe.session.user
    stamp = now_datetime()

    savepoint = "create_itms"
    frappe.db.savepoint(savepoint)
    failed_source: str | None = None
    frappe.flags["itm_create_in_progress"] = True
    try:
        try:
            for source_project, group_sels in groups.items():
                failed_source = source_project
                itm = frappe.new_doc("Internal Transfer Memo")
                itm.source_type = "Project"
                itm.source_project = source_project
                itm.target_type = target_type
                itm.target_project = target_project
                itm.source_rir = latest_rir_by_source[source_project]
                itm.status = "Approved"
                itm.requested_by = requester
                itm.approved_by = requester
                itm.approved_on = stamp

                for sel in group_sels:
                    snap = snapshot.get((sel["source_project"], sel["item_id"]), {})
                    # Selection's make is authoritative — the picker showed the
                    # user exactly which (item, make) bucket was being picked.
                    # Fall back to RIR snapshot only if the selection has no make
                    # (legacy callers that pre-date make-aware picking).
                    itm.append("items", {
                        "item_id": sel["item_id"],
                        "item_name": snap.get("item_name"),
                        "unit": snap.get("unit"),
                        "category": snap.get("category"),
                        "make": sel.get("make") if sel.get("make") is not None else snap.get("make"),
                        "transfer_quantity": sel["transfer_quantity"],
                        "estimated_rate": snap.get("estimated_rate") or 0,
                        "received_quantity": 0,
                    })
                itm.insert(ignore_permissions=True)
                created.append(itm.name)
                failed_source = None

            if warehouse_sels:
                failed_source = "Warehouse"
                itm = frappe.new_doc("Internal Transfer Memo")
                itm.source_type = "Warehouse"
                itm.source_project = None
                itm.target_type = target_type
                itm.target_project = target_project
                itm.source_rir = None
                itm.status = "Approved"
                itm.requested_by = requester
                itm.approved_by = requester
                itm.approved_on = stamp

                for sel in warehouse_sels:
                    snap = wh_snapshot.get((sel["item_id"], sel.get("make")), {})
                    itm.append("items", {
                        "item_id": sel["item_id"],
                        "item_name": snap.get("item_name"),
                        "unit": snap.get("unit"),
                        "category": snap.get("category"),
                        "make": sel.get("make"),
                        "transfer_quantity": sel["transfer_quantity"],
                        "estimated_rate": snap.get("estimated_rate") or 0,
                        "received_quantity": 0,
                    })
                itm.insert(ignore_permissions=True)
                created.append(itm.name)
                failed_source = None
        except Exception as exc:
            frappe.db.rollback(save_point=savepoint)
            if isinstance(exc, frappe.ValidationError):
                raise
            frappe.log_error(
                title="ITM multi-create failed",
                message=frappe.get_traceback(),
            )
            frappe.throw(
                f"Failed to create Internal Transfer Memo for source {failed_source or '?'}: {exc}"
            )
    finally:
        # Always clear so unrelated single-doc inserts later in the request
        # (e.g. background hooks) hit the normal commit + publish path.
        frappe.flags.pop("itm_create_in_progress", None)

    frappe.db.commit()

    # Publish itm:created AFTER commit so receivers can fetch the new docs.
    # `_get_admins` is imported above alongside the availability helpers.
    from nirmaan_stack.integrations.controllers.internal_transfer_memo import _get_admins
    recipients = _get_admins() | {requester}
    for itm_name in created:
        message = {"itm": itm_name, "status": "Approved"}
        for user in recipients:
            if user:
                frappe.publish_realtime(event="itm:created", message=message, user=user)

    return {"itms": created, "count": len(created)}


# ---------------------------------------------------------------------------
# Metadata snapshot helpers (ported from the deleted create_transfer_request)
# ---------------------------------------------------------------------------


def _build_metadata_snapshot(latest_rir_by_source, selections):
    """Fetch ``item_name/unit/category/make`` from RIR and ``estimated_rate``
    from PO (max quote) for every (source, item) pair in ``selections``.

    `make` comes from the RIR child row (stamped by RIR.validate at submit
    time from the latest PO Item) — RIR is authoritative for what's
    physically on the project right now. See
    ``RemainingItemsReport._stamp_latest_po_make``.
    """
    if not selections:
        return {}

    rir_names = tuple(latest_rir_by_source.values())
    item_ids = tuple({sel["item_id"] for sel in selections})
    source_projects = tuple({sel["source_project"] for sel in selections})

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

    items_rows = frappe.db.sql(
        """SELECT name AS item_id, item_name, unit_name AS unit, category
        FROM "tabItems" WHERE name IN %(item_ids)s""",
        {"item_ids": item_ids},
        as_dict=True,
    ) if item_ids else []
    items_index = {row["item_id"]: row for row in items_rows}

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
    """Fetch metadata from Warehouse Stock Item (with Items master fallback).

    Keyed by ``(item_id, make)`` — each distinct bucket has its own row.
    """
    if not selections:
        return {}

    item_ids = tuple({sel["item_id"] for sel in selections})

    items_rows = frappe.db.sql(
        """SELECT name AS item_id, item_name, unit_name AS unit, category
        FROM "tabItems" WHERE name IN %(item_ids)s""",
        {"item_ids": item_ids},
        as_dict=True,
    ) if item_ids else []
    items_index = {row["item_id"]: row for row in items_rows}

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
