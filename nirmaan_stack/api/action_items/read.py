# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Project Action Item — PERMISSION-SCOPED read endpoints (Phase 3).

Two whitelisted, GET-capable, READ-ONLY endpoints the frontend consumes:

  * `get_project_action_items(project_name)` — Surface B (the project page). Returns the
    Open rows for ONE project, AFTER verifying the caller may access that project.
  * `get_my_action_items()` — Surface A (the PM dashboard). Returns the Open rows for
    EVERY project the caller can access (each row carries `project` so the frontend can
    group), NOT filtered by `assigned_role` (so Admin/PMO see everything incl. no-PM
    projects, a PM sees their assigned projects).

THE PERMISSION GATE IS NON-NEGOTIABLE (red-team "Critical"): a bare whitelist would leak
cross-project data. Both endpoints reuse the EXACT `critical_po_tasks` access model —
`_get_user_role` / `FULL_ACCESS_ROLES` / `FILTERED_ACCESS_ROLES` / `_should_filter_by_
permissions` / `_get_allowed_projects` — so the two surfaces can never diverge from the
app's established project-scoping rule. Full-access roles (Administrator / Admin / PMO)
see all; filtered roles (PM / PL / Procurement Exec) are scoped to their `Nirmaan User
Permissions` (allow=Projects, for_value=project).

Both endpoints WRITE NOTHING (no set_value / insert / save / commit). The Resolved rows
may reference a since-deleted PO (`reference_name`) — these endpoints only ever return
Open rows, but readers must still tolerate a dangling `reference_name`; we do not
dereference it here.
"""

import frappe
from frappe import _

from nirmaan_stack.api.critical_po_tasks.get_projects_with_stats import (
    _get_allowed_projects,
    _get_user_role,
    _should_filter_by_permissions,
)

# The row fields returned to the frontend. `project` is included on BOTH endpoints'
# rows so Surface A can group by project (and Surface B can confirm scope).
_ROW_FIELDS = [
    "name",
    "project",
    "action_type",
    "reference_doctype",
    "reference_name",
    "status",
    "title",
    "action_url",
    "first_opened_at",
    "last_opened_at",
    "assigned_role",
]

# Group the two action types first (DN before DC, deterministic), then newest-touched
# first within each type.
_ORDER_BY = "action_type, last_opened_at desc"

# PO fields hydrated onto each Surface-A row so the dashboard can show vendor + dates
# without a second fetch. `reference_doctype` is always "Procurement Orders" and
# `reference_name` is the PO docname; these are the exact PO fieldnames (confirmed in
# procurement_orders.json): vendor_name (Data), dispatch_date / latest_delivery_date
# (Datetime).
_PO_HYDRATE_FIELDS = ["vendor_name", "dispatch_date", "latest_delivery_date"]


def _hydrate_po_fields(action_items):
    """Attach `vendor_name`/`dispatch_date`/`latest_delivery_date` from the referenced PO.

    ONE bulk fetch over the distinct `reference_name` PO docnames (no N+1), then map each
    row onto its PO. Defensive: a row whose PO is missing (a since-deleted PO referenced
    by a dangling row) gets the three keys set to None rather than being dropped — these
    endpoints only return Open rows, but a reader should never trip on a dangling ref.
    Mutates + returns the same list.
    """
    po_names = list({row["reference_name"] for row in action_items if row.get("reference_name")})

    po_map = {}
    if po_names:
        for po in frappe.get_all(
            "Procurement Orders",
            filters={"name": ["in", po_names]},
            fields=["name", *_PO_HYDRATE_FIELDS],
            limit_page_length=0,
        ):
            po_map[po["name"]] = po

    for row in action_items:
        po = po_map.get(row.get("reference_name"))
        for field in _PO_HYDRATE_FIELDS:
            row[field] = po.get(field) if po else None

    return action_items


@frappe.whitelist()
def get_project_action_items(project_name):
    """Open action items for ONE project — caller MUST be able to access it (Surface B).

    PERMISSION GATE (the whole point): a full-access user (Administrator / Admin / PMO)
    is allowed any project; any other user is allowed ONLY a project in their
    `_get_allowed_projects(...)` set — otherwise we `frappe.throw(PermissionError)`.
    Bare whitelist alone would leak another project's rows.

    Returns ``{"action_items": [...]}`` — Open rows only, read-only.
    """
    if not project_name:
        frappe.throw(_("project_name is required."))

    user = frappe.session.user
    role = _get_user_role(user)

    # `_should_filter_by_permissions` is False for Administrator + full-access roles
    # (Admin / PMO) → they may access any project. Everyone else is scoped.
    if _should_filter_by_permissions(user, role):
        if project_name not in _get_allowed_projects(user):
            frappe.throw(_("Not permitted"), frappe.PermissionError)

    action_items = frappe.get_all(
        "Project Action Item",
        filters={"project": project_name, "status": "Open"},
        fields=_ROW_FIELDS,
        order_by=_ORDER_BY,
        limit_page_length=0,
    )
    return {"action_items": action_items}


@frappe.whitelist()
def get_my_action_items():
    """Open action items across ALL projects the caller can access (Surface A).

    Resolve the caller's accessible-project scope FIRST, then return Open rows for ONLY
    those projects (each row carries `project` so the frontend can group):

      * full-access (Administrator / Admin / PMO) → no project filter → every Open row
        (incl. projects that have no assigned PM — the orphan case stays visible here);
      * a filtered role with an empty allowed set → ``{"action_items": []}`` (no leak);
      * a filtered role with N allowed projects → Open rows for those N projects only.

    NOT filtered by `assigned_role` — that field is a display label in v1; a PM sees the
    rows of the projects assigned to them, full-access sees everything. Read-only.
    """
    user = frappe.session.user
    role = _get_user_role(user)

    filters = {"status": "Open"}

    if _should_filter_by_permissions(user, role):
        allowed_projects = _get_allowed_projects(user)
        if not allowed_projects:
            # No project assignments → nothing to show (and crucially, no leak).
            return {"action_items": []}
        filters["project"] = ["in", allowed_projects]

    action_items = frappe.get_all(
        "Project Action Item",
        filters=filters,
        fields=_ROW_FIELDS,
        order_by=_ORDER_BY,
        limit_page_length=0,
    )
    # Surface A enrichment: hydrate the referenced PO's vendor + dates onto each row so
    # the dashboard panel needs no second fetch. (Surface B / get_project_action_items is
    # intentionally NOT enriched — it feeds counts only.)
    _hydrate_po_fields(action_items)
    return {"action_items": action_items}
