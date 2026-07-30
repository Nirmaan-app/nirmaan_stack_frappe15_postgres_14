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
from frappe.utils import today

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

# DPR (Daily Progress Report) is a LIVE, project-level daily obligation — NOT a Project
# Action Item projection. A project owes a DPR while it is under active execution; these
# statuses mean it does not. Mirrors STOP_STATUSES in api/pmo_recurrence.py (the app's
# existing "stop recurring obligations" set): Completed / CEO Hold / Halted. NOTE: CEO Hold
# is a *value* of Projects.status, not a separate field.
_DPR_STOP_STATUSES = ["Completed", "CEO Hold", "Halted"]

# A zone's DPR obligation for a given day is satisfied once a Completed report exists for it
# (a started-but-unsubmitted Draft still counts as pending — the work isn't done).
_DPR_SATISFIED_STATUS = "Completed"


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


def _hydrate_project_names(action_items):
    """Attach each row's human-readable `project_name` from its Projects link.

    ONE bulk fetch over the distinct project docnames (no N+1). This replaces a
    separate client-side "fetch every Projects row just for names" call — the panel
    then needs only this single endpoint. Falls back to the docname if a project has
    no `project_name`.
    """
    project_ids = list({row["project"] for row in action_items if row.get("project")})
    name_map = {}
    if project_ids:
        for p in frappe.get_all(
            "Projects",
            filters={"name": ["in", project_ids]},
            fields=["name", "project_name"],
            limit_page_length=0,
        ):
            name_map[p["name"]] = p.get("project_name")
    for row in action_items:
        row["project_name"] = name_map.get(row.get("project")) or row.get("project")
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
    _hydrate_project_names(action_items)
    return {"action_items": action_items}


@frappe.whitelist()
def get_my_pending_dprs():
    """Zones (across the caller's active projects) that still owe TODAY's Daily Progress Report.

    A DPR (`Project Progress Reports`) is a per-project-per-ZONE-per-DAY obligation, so this
    is computed at ZONE granularity: a (project, zone) is pending when the project is active,
    DPR-enabled, and has NO Completed report for today in that zone. LIVE query (DPR has no
    Project Action Item projection). Three bulk queries + a Python join — no N+1.

    Same project-scoping model as `get_my_action_items` (full-access → all active projects;
    a filtered role → only its allowed active projects; empty allowed set → no items).

    "Active" = ``status`` is set (non-empty; drops still-tendering projects, whose status stays
    "" until ``tendering_status == "Won"``) AND not in ``_DPR_STOP_STATUSES`` AND ``disabled_dpr``
    not ticked. Read-only. Returns ``{"items": [{"project", "project_name", "zone"}]}`` — one row
    per pending zone.
    """
    user = frappe.session.user
    role = _get_user_role(user)

    # (1) Active, DPR-enabled projects the caller can access. List-of-lists so both status
    # conditions can sit on the same field (a dict filter allows one condition per field).
    filters = [
        ["status", "not in", _DPR_STOP_STATUSES],
        ["status", "!=", ""],
    ]
    if _should_filter_by_permissions(user, role):
        allowed_projects = _get_allowed_projects(user)
        if not allowed_projects:
            # No project assignments → nothing to show (and crucially, no leak).
            return {"items": []}
        filters.append(["name", "in", allowed_projects])

    projects = frappe.get_all(
        "Projects",
        filters=filters,
        fields=["name", "project_name", "disabled_dpr"],
        order_by="project_name asc",
        limit_page_length=0,
    )
    # `disabled_dpr` is filtered in Python: a `!= 1` SQL filter would DROP NULL rows on PG.
    # Treat 0 / NULL / "" as enabled, only an explicit 1 as disabled.
    projects = [p for p in projects if not p.get("disabled_dpr")]
    if not projects:
        return {"items": []}

    project_names = [p["name"] for p in projects]
    label_of = {p["name"]: (p.get("project_name") or p["name"]) for p in projects}

    # (2) Every zone of those projects — one bulk query on the Projects.project_zones child.
    zone_rows = frappe.get_all(
        "Project Zone Child Table",
        filters={
            "parent": ["in", project_names],
            "parenttype": "Projects",
            "parentfield": "project_zones",
        },
        fields=["parent", "zone_name"],
        order_by="idx asc",
    )
    zones_by_project = {}
    for z in zone_rows:
        if z.get("zone_name"):
            zones_by_project.setdefault(z["parent"], []).append(z["zone_name"])

    # (3) Zones that ALREADY have today's Completed report — one bulk query.
    filed = frappe.get_all(
        "Project Progress Reports",
        filters={
            "project": ["in", project_names],
            "report_date": today(),
            "report_status": _DPR_SATISFIED_STATUS,
        },
        fields=["project", "report_zone"],
    )
    filed_by_project = {}
    for f in filed:
        filed_by_project.setdefault(f["project"], set()).add(f.get("report_zone"))

    # (4) Pending = each project's zones minus the zones already filed today. A zoneless
    # project yields nothing (a DPR can't be filed until zones are defined — a different
    # action from filing today's report).
    items = []
    for pname in project_names:
        done_zones = filed_by_project.get(pname, set())
        for zone in zones_by_project.get(pname, []):
            if zone not in done_zones:
                items.append(
                    {"project": pname, "project_name": label_of[pname], "zone": zone}
                )
    return {"items": items}
