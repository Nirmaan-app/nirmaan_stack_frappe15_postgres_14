"""Cross-project Snag roll-up -- the ONE payload behind the `/snag-list` sidebar page.

The tab under a project answers "what is left in THIS project"; this module answers
"which projects still have snags open", which is the same question the Design Tracker
list page asks of its trackers (`api/design_tracker/get_tracker_list.py`).

TWO AGGREGATE QUERIES, NEVER A ROW LOOP. A count over many rows is the DATABASE's job
(ADR-0010) -- the design tracker list `get_doc`s every tracker to walk its child table,
which it can afford because a tracker's tasks are a child table it must load anyway. A
Snag is a STANDALONE document (ADR-0017): there are tens of thousands of them, so the
same shape here would be a per-project fan-out. One GROUP BY over project+status carries
the whole grid instead.

PROJECTS WITH NO SNAGS ARE NOT LISTED. A Snag list is STARTED from the project's own
Snag List tab (that is where Import lives), so a project that has never been imported
into has nothing for this page to show. Listing every active project would bury the
projects that do have open snags under cards reading zero.

Wire contract: `frontend/src/pages/SnagList/types.ts` (`ProjectSnagSummary`).
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.snags import require_read_access
from nirmaan_stack.api.projects.module_controls import MODULE_CONTROL_PROFILES
from nirmaan_stack.services.role_profiles import has_role_profile

#: Display order, matching SNAG_STATUSES in types.ts and tracking.py.
SNAG_STATUSES = ("Pending", "WIP", "Completed", "Not Applicable")

#: Who still sees a project whose Snag List module is disabled, and who may toggle it.
#: The SAME tuple that guards `enable_module` / `disable_module`, imported rather than
#: retyped -- a second copy here would be free to drift from the endpoint that actually
#: enforces it, and "can see the hidden card" and "can unhide it" must not diverge.
FULL_VISIBILITY_PROFILES = MODULE_CONTROL_PROFILES


@frappe.whitelist()
def get_projects_with_snag_stats():
    """One `ProjectSnagSummary` per project that has at least one Snag or Batch.

    READ-GUARDED on the same tier as `get_snag_stats` -- this endpoint exposes the same
    defect counts, just for every project at once, so it cannot be the looser door.

    `status_of_project` is the Projects execution lifecycle (WIP / Handover / ...). It is
    named to match the design tracker list payload because the frontend feeds BOTH into
    the same shared `ProjectStatusFilter`.
    """
    require_read_access("view the snag lists")

    # --- The counts, one GROUP BY for the whole grid ---
    rows = frappe.get_all(
        "Project Snag",
        fields=["project", "status", "count(name) as cnt"],
        group_by="project, status",
        limit_page_length=0,
    )

    per_project: dict[str, dict] = {}
    for row in rows:
        project = row.get("project")
        if not project:
            continue
        entry = per_project.setdefault(
            project, {"total": 0, "by_status": {s: 0 for s in SNAG_STATUSES}}
        )
        count = int(row.get("cnt") or 0)
        entry["total"] += count
        if row.get("status") in entry["by_status"]:
            entry["by_status"][row["status"]] = count

    batch_rows = frappe.get_all(
        "Project Snag Batch",
        fields=["project", "count(name) as cnt", "max(uploaded_on) as last_upload"],
        group_by="project",
        limit_page_length=0,
    )
    batch_info = {
        r["project"]: {
            "batch_count": int(r.get("cnt") or 0),
            "last_upload": r.get("last_upload"),
        }
        for r in batch_rows
        if r.get("project")
    }

    # A project can hold a Batch whose snags were all deleted, or manual snags with no
    # Batch at all. Both belong on this page, so the id set is the UNION of the two.
    project_ids = set(per_project) | set(batch_info)
    if not project_ids:
        return []

    projects = frappe.get_all(
        "Projects",
        filters={"name": ("in", list(project_ids))},
        fields=[
            "name",
            "project_name",
            "status",
            "project_city",
            "project_manager",
            "disabled_snag_list",
        ],
        limit_page_length=0,
    )

    # Everyone below Admin/PMO gets hidden cards DROPPED, not returned-and-flagged: a
    # payload that carries them is one client bug away from showing them. Admin/PMO get
    # the flag instead, which is what the card's Hide toggle and the "Hidden" section
    # on the grid are driven by.
    can_see_hidden = has_role_profile(frappe.session.user, FULL_VISIBILITY_PROFILES)

    result = []
    for project in projects:
        is_hidden = bool(project.get("disabled_snag_list"))
        if is_hidden and not can_see_hidden:
            continue

        counts = per_project.get(
            project["name"], {"total": 0, "by_status": {s: 0 for s in SNAG_STATUSES}}
        )
        batches = batch_info.get(project["name"], {"batch_count": 0, "last_upload": None})
        result.append(
            {
                "name": project["name"],
                "project_name": project.get("project_name") or project["name"],
                "status_of_project": project.get("status") or "",
                "project_city": project.get("project_city") or "",
                "project_manager": project.get("project_manager") or "",
                "total": counts["total"],
                "by_status": counts["by_status"],
                "batch_count": batches["batch_count"],
                "last_upload": batches["last_upload"],
                # Always 0 for a non-privileged caller -- their hidden projects never
                # reach this loop -- so the client needs no second permission test to
                # know a "Hidden" badge is safe to render.
                "is_hidden": 1 if is_hidden else 0,
            }
        )

    # Most open work first -- the reason to open this page at all. `project_name` breaks
    # the tie so the order is stable between loads rather than left to the DB.
    result.sort(key=lambda r: (-r["by_status"]["Pending"], -r["total"], r["project_name"]))
    return result
