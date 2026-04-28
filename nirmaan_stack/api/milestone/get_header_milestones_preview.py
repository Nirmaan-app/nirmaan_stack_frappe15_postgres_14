import json

import frappe
from frappe.utils import add_days, nowdate


@frappe.whitelist()
def get_header_milestones_preview(project, work_header, zone=None):
    """
    Return the milestone preview for a Work Header under a project.

    Zone-agnostic: picks the latest completed report for the project (any
    zone) as the reference for current milestone statuses.

    Resolution:
      1. Latest completed Project Progress Reports for `project` (any zone) ->
         return its child milestones filtered to this work_header, merged with
         any master milestones that aren't yet tracked in the report.
      2. If no completed report exists OR the latest report has no rows for
         this header, fall back to `Work Milestones` master for this header.

    The `zone` param is accepted for backwards compatibility but ignored.
    """
    if not project or not work_header:
        frappe.throw("project and work_header are required")

    master_rows = frappe.get_all(
        "Work Milestones",
        filters={"work_header": work_header},
        fields=["name", "work_milestone_name", "work_header", "weightage", "work_milestone_order"],
        order_by="work_milestone_order asc, work_milestone_name asc",
    )

    latest = _get_latest_completed_report(project)

    if latest:
        report_rows = frappe.get_all(
            "Project Progress Report Work Milestones",
            filters={"parent": latest.name, "work_header": work_header},
            fields=[
                "name",
                "work_milestone_name",
                "work_header",
                "status",
                "progress",
                "expected_starting_date",
                "expected_completion_date",
                "remarks",
            ],
            order_by="idx asc",
        )

        if report_rows:
            report_by_name = {r.work_milestone_name: r for r in report_rows}
            merged = [dict(r) for r in report_rows]

            for m in master_rows:
                if m.work_milestone_name in report_by_name:
                    continue
                merged.append(
                    {
                        "name": f"master::{m.name}",
                        "work_milestone_name": m.work_milestone_name,
                        "work_header": m.work_header,
                        "status": "Not Started",
                        "progress": 0,
                        "is_new_from_master": 1,
                    }
                )

            return {
                "source": "report",
                "report_name": latest.name,
                "report_date": str(latest.report_date) if latest.report_date else None,
                "report_zone": latest.report_zone,
                "milestones": merged,
            }

    milestones = [
        {
            "name": r.name,
            "work_milestone_name": r.work_milestone_name,
            "work_header": r.work_header,
            "status": "Not Started",
            "progress": 0,
            "weightage": r.weightage,
        }
        for r in master_rows
    ]
    return {
        "source": "master",
        "report_name": None,
        "report_date": None,
        "report_zone": None,
        "milestones": milestones,
    }


@frappe.whitelist()
def seed_header_milestones(project, work_header, active_milestone_names, zones=None, zone=None):
    """
    Persist selected/unselected milestones for a work header across one or
    more zones.

    For each zone in `zones`:
      - If a completed Project Progress Report exists for (project, zone):
        update its milestone child rows for this header. Selected -> "Not
        Started", unselected -> "Not Applicable". Rows from master that don't
        exist in the report are appended.
      - Else: create a new Project Progress Reports (report_status=Completed,
        report_date=yesterday, report_zone=zone) seeded with the header's
        master milestones; selected -> "Not Started", unselected -> "Not
        Applicable".

    Backwards compatibility:
      - If `zones` is not provided but `zone` is, operate on that single zone.
      - If neither is provided, operate on all zones defined on the Project.
    """
    if not project or not work_header:
        frappe.throw("project and work_header are required")

    if isinstance(active_milestone_names, str):
        active_milestone_names = json.loads(active_milestone_names)
    active_set = set(active_milestone_names or [])

    if isinstance(zones, str):
        zones = json.loads(zones)

    zone_list = list(zones) if zones else ([zone] if zone else _get_project_zones(project))
    zone_list = [z for z in zone_list if z]  # drop None/empty

    if not zone_list:
        frappe.throw(
            f"No zones defined for project {project}. Add at least one zone before seeding."
        )

    master_rows = frappe.get_all(
        "Work Milestones",
        filters={"work_header": work_header},
        fields=["name", "work_milestone_name"],
        order_by="work_milestone_order asc, work_milestone_name asc",
    )
    if not master_rows:
        frappe.throw(f"No milestones found under Work Header '{work_header}'.")

    created_reports = []
    updated_reports = []

    for z in zone_list:
        latest = _get_latest_completed_report(project, z)
        if latest:
            _update_report_for_header(latest.name, work_header, master_rows, active_set)
            updated_reports.append({"zone": z, "report_name": latest.name})
        else:
            new_name = _create_seed_report(project, z, work_header, master_rows, active_set)
            created_reports.append({"zone": z, "report_name": new_name})

    frappe.db.commit()

    return {
        "status": "success",
        "created": created_reports,
        "updated": updated_reports,
    }


def _update_report_for_header(report_name, work_header, master_rows, active_set):
    doc = frappe.get_doc("Project Progress Reports", report_name)
    existing_by_key = {
        (row.work_milestone_name, row.work_header): row for row in doc.milestones
    }

    # Union of master milestones + existing report rows under this header.
    # Covers the case where a milestone exists in a past report but has since
    # been removed from the master — user should still be able to toggle it.
    milestone_names = {m.work_milestone_name for m in master_rows}
    for key in existing_by_key:
        if key[1] == work_header:
            milestone_names.add(key[0])

    for name in milestone_names:
        is_checked = name in active_set
        existing = existing_by_key.get((name, work_header))

        if existing:
            if is_checked:
                # Only reactivate rows that were deselected. In-progress
                # work (Not Started / WIP / Completed) is preserved.
                if existing.status == "Not Applicable":
                    existing.status = "Not Started"
                    existing.progress = 0
            else:
                if existing.status != "Not Applicable":
                    existing.status = "Not Applicable"
                    existing.progress = 0
        else:
            doc.append(
                "milestones",
                {
                    "work_milestone_name": name,
                    "work_header": work_header,
                    "status": "Not Started" if is_checked else "Not Applicable",
                    "progress": 0,
                },
            )

    doc.save(ignore_permissions=True)


def _create_seed_report(project, zone, work_header, master_rows, active_set):
    new_doc = frappe.get_doc(
        {
            "doctype": "Project Progress Reports",
            "project": project,
            "report_date": add_days(nowdate(), -1),
            "report_zone": zone or None,
            "report_status": "Completed",
            "milestones": [
                {
                    "work_milestone_name": m.work_milestone_name,
                    "work_header": work_header,
                    "status": "Not Started"
                    if m.work_milestone_name in active_set
                    else "Not Applicable",
                    "progress": 0,
                }
                for m in master_rows
            ],
            "manpower": _default_manpower_rows(),
        }
    )
    new_doc.insert(ignore_permissions=True)
    return new_doc.name


# Mirror of frontend DEFAULT_MANPOWER_ROLES (utils/manpowerDefaults.ts).
# Auto-seeded reports get this list with count=0 so the Copy Previous Report
# dialog and the MilestoneTab "Work force" tab always have the canonical
# 7 roles to start from. Keep both lists in sync.
_DEFAULT_MANPOWER_LABELS = [
    "MEP Engineer",
    "Safety Engineer",
    "Electrical Team",
    "Fire Fighting Team",
    "Data & Networking Team",
    "HVAC Team",
    "ELV Team",
]


def _default_manpower_rows():
    return [{"label": label, "count": "0"} for label in _DEFAULT_MANPOWER_LABELS]


@frappe.whitelist()
def ensure_zone_reports(project, zones):
    """
    For each zone in `zones`, ensure a completed Project Progress Report exists.

    Strategy per zone:
      - If the zone already has a completed report -> skip.
      - Else, if the project has at least one completed report in any zone ->
        clone that latest report's milestone rows into a new report for this
        zone (report_date=yesterday, report_status=Completed).
      - Else -> seed from the project's enabled Work Headers + their master
        Work Milestones (all rows set to "Not Started").

    Returns a summary of {zone, report_name, origin} for each zone touched.
    """
    if not project:
        frappe.throw("project is required")

    if isinstance(zones, str):
        zones = json.loads(zones)
    zones = [z for z in (zones or []) if z]
    if not zones:
        return {"created": [], "skipped": []}

    created = []
    skipped = []

    # Pick the project-wide reference report (any zone, most recent).
    reference = _get_latest_completed_report(project)
    reference_rows = []
    reference_manpower = []
    if reference:
        reference_rows = frappe.get_all(
            "Project Progress Report Work Milestones",
            filters={"parent": reference.name},
            fields=[
                "work_milestone_name",
                "work_header",
                "status",
                "progress",
                "expected_starting_date",
                "expected_completion_date",
            ],
            order_by="idx asc",
        )
        reference_manpower = frappe.get_all(
            "Project Progress Report Manpower Details",
            filters={"parent": reference.name},
            fields=["label", "count"],
            order_by="idx asc",
        )

    for z in zones:
        if _get_latest_completed_report(project, z):
            skipped.append({"zone": z, "reason": "report_exists"})
            continue

        if reference_rows:
            # Clone preserves the active/Not-Applicable split only.
            # Progress (WIP / Completed) is zone-specific, so the new zone
            # starts every active milestone at "Not Started" with progress=0.
            milestones = [
                {
                    "work_milestone_name": r.work_milestone_name,
                    "work_header": r.work_header,
                    "status": "Not Applicable" if r.status == "Not Applicable" else "Not Started",
                    "progress": 0,
                }
                for r in reference_rows
            ]
            origin = "cloned_from_latest"
        else:
            milestones = _build_seed_from_project_master(project)
            origin = "from_master"

        # Seed manpower: clone the reference report's labels (counts reset to
        # 0 since manpower is zone-specific), or fall back to the canonical
        # default list when no reference report exists.
        if reference_manpower:
            seen_labels = set()
            manpower_rows = []
            for mp in reference_manpower:
                if mp.label and mp.label not in seen_labels:
                    seen_labels.add(mp.label)
                    manpower_rows.append({"label": mp.label, "count": "0"})
            for default_label in _DEFAULT_MANPOWER_LABELS:
                if default_label not in seen_labels:
                    seen_labels.add(default_label)
                    manpower_rows.append({"label": default_label, "count": "0"})
        else:
            manpower_rows = _default_manpower_rows()

        new_doc = frappe.get_doc(
            {
                "doctype": "Project Progress Reports",
                "project": project,
                "report_date": add_days(nowdate(), -1),
                "report_zone": z,
                "report_status": "Completed",
                "milestones": milestones,
                "manpower": manpower_rows,
            }
        )
        new_doc.insert(ignore_permissions=True)
        created.append({"zone": z, "report_name": new_doc.name, "origin": origin})

    frappe.db.commit()
    return {"created": created, "skipped": skipped}


def _build_seed_from_project_master(project):
    """Seed milestones for all enabled headers on the project from master."""
    project_doc = frappe.get_doc("Projects", project)
    enabled_header_names = []
    for entry in (project_doc.get("project_work_header_entries") or []):
        header_name = entry.get("project_work_header_name")
        if not header_name:
            continue
        enabled = entry.get("enabled")
        if isinstance(enabled, str):
            enabled = enabled.lower() == "true"
        if enabled:
            enabled_header_names.append(header_name)

    if not enabled_header_names:
        return []

    master_rows = frappe.get_all(
        "Work Milestones",
        filters={"work_header": ["in", enabled_header_names]},
        fields=["work_milestone_name", "work_header"],
        order_by="work_header asc, work_milestone_order asc, work_milestone_name asc",
    )
    return [
        {
            "work_milestone_name": r.work_milestone_name,
            "work_header": r.work_header,
            "status": "Not Started",
            "progress": 0,
        }
        for r in master_rows
    ]


def _get_latest_completed_report(project, zone=None):
    filters = {"project": project, "report_status": "Completed"}
    if zone:
        filters["report_zone"] = zone
    rows = frappe.get_all(
        "Project Progress Reports",
        filters=filters,
        fields=["name", "report_date", "report_zone"],
        order_by="report_date desc, modified desc",
        limit=1,
    )
    return rows[0] if rows else None


def _get_project_zones(project):
    rows = frappe.get_all(
        "Project Zones",
        filters={"parent": project, "parenttype": "Projects"},
        fields=["zone_name"],
        order_by="idx asc",
    )
    return [r.zone_name for r in rows if r.zone_name]
