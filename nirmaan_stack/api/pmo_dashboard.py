"""
API endpoints for the PMO Dashboard feature.

Provides endpoints to manage PMO project tasks across all projects,
including task initialization from master templates, status updates,
and project-level status overviews.
"""

import frappe
from frappe.utils import today


@frappe.whitelist()
def get_pmo_projects():
    """
    Get all non-completed projects with their PMO task summary.
    Returns task counts per category for dashboard card display.
    Category totals come from PMO package masters so cards are populated
    even before a project's PMO task rows are initialized.
    """
    projects = frappe.get_all(
        "Projects",
        filters=[["status", "not in", ["Completed"]]],
        fields=["name", "project_name", "project_city", "project_state", "status"],
        order_by="creation desc",
    )

    # Build package totals once from PMO masters.
    categories = frappe.get_all(
        "PMO Task Category",
        fields=["name", "category_name"],
        order_by="creation asc",
    )
    master_tasks = frappe.get_all(
        "PMO Task Master",
        fields=["category_link"],
    )

    category_name_by_link = {cat.name: cat.category_name for cat in categories}
    package_totals = {cat.category_name: 0 for cat in categories if cat.category_name}

    for task in master_tasks:
        category_name = category_name_by_link.get(task.category_link)
        if category_name:
            package_totals[category_name] += 1

    result = []
    for project in projects:
        # Get all PMO tasks for this project
        tasks = frappe.get_all(
            "PMO Project Task",
            filters={"project": project.name},
            fields=["category", "status"],
        )

        # Start from package totals so cards are non-empty before first project click.
        category_summary = {
            category_name: {"total": total_count, "done": 0}
            for category_name, total_count in package_totals.items()
            if total_count > 0
        }
        project_task_counts = {}

        for task in tasks:
            cat = task.category
            if cat not in category_summary:
                category_summary[cat] = {"total": 0, "done": 0}

            project_task_counts[cat] = project_task_counts.get(cat, 0) + 1
            if task.status == "Approve by client":
                category_summary[cat]["done"] += 1

        # Keep package totals by default, but if project has more rows than master
        # (legacy/manual data), prefer observed project count for that category.
        for cat, observed_count in project_task_counts.items():
            category_summary[cat]["total"] = max(category_summary[cat]["total"], observed_count)

        total_tasks = sum(item["total"] for item in category_summary.values())
        completed_tasks = sum(item["done"] for item in category_summary.values())
        pending_tasks = max(total_tasks - completed_tasks, 0)

        progress = round((completed_tasks / total_tasks * 100), 0) if total_tasks > 0 else 0

        result.append({
            "name": project.name,
            "project_name": project.project_name,
            "project_city": project.project_city,
            "project_state": project.project_state,
            "status": project.status,
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "pending_tasks": pending_tasks,
            "progress": progress,
            "categories": category_summary,
        })

    return result


@frappe.whitelist()
def get_project_tasks(project):
    """
    Get all PMO Project Task records for a given project, grouped by category.
    Maintains the order from master templates.
    """
    tasks = frappe.get_all(
        "PMO Project Task",
        filters={"project": project},
        fields=[
            "name", "task_name", "category", "status",
            "expected_completion_date", "completion_date", "attachment"
        ],
        order_by="category asc, task_name asc",
    )

    # Group by category maintaining order
    grouped = {}
    category_order = []
    for task in tasks:
        cat = task.category
        if cat not in grouped:
            grouped[cat] = []
            category_order.append(cat)
        grouped[cat].append(task)

    return {
        "tasks": grouped,
        "category_order": category_order,
    }


@frappe.whitelist()
def update_task_status(task_name, status, expected_completion_date=None, completion_date=None, attachment=None):
    """
    Update a PMO task's status and dates.
    - If status is "Done", completion_date defaults to today
    - If status is "Not Done", expected_completion_date is required
    - If status is "Not Defined", both dates are cleared
    """
    doc = frappe.get_doc("PMO Project Task", task_name)

    doc.status = status

    if status == "Approve by client":
        # Triggers progress, keep existing dates
        pass
    elif status == "Sent/Submision":
        doc.completion_date = completion_date or today()
        # Keep expected_completion_date as is
    elif status == "WIP":
        if not expected_completion_date:
            frappe.throw("Expected Completion Date is required when status is WIP.")
        doc.expected_completion_date = expected_completion_date
        doc.completion_date = None
    else:
        # Not Defined
        doc.expected_completion_date = None
        doc.completion_date = None

    if attachment:
        doc.attachment = attachment

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"status": "success", "name": doc.name}


@frappe.whitelist()
def initialize_project_tasks(project):
    """
    Create PMO Project Task records from all PMO Task Master templates
    for a project. Checks per-task to avoid duplicates and runs a dedupe pass.
    Returns the count of tasks created.
    """
    # Get all categories in order
    categories = frappe.get_all(
        "PMO Task Category",
        fields=["name", "category_name"],
        order_by="creation asc",
    )

    # Get all master tasks
    master_tasks = frappe.get_all(
        "PMO Task Master",
        fields=["name", "task_name", "category_link"],
        order_by="creation asc",
    )

    created_count = 0
    for cat in categories:
        cat_tasks = [t for t in master_tasks if t.category_link == cat.name]
        for task in cat_tasks:
            # Check by template link (reliable ID)
            existing_name = frappe.db.get_value("PMO Project Task", {
                "project": project,
                "task_master": task.name
            }, "name")

            if not existing_name:
                # Legacy check by name/category (handles migration for records created before this change)
                existing_name = frappe.db.get_value("PMO Project Task", {
                    "project": project,
                    "task_name": task.task_name,
                    "category": cat.category_name,
                }, "name")

            if existing_name:
                # Pair with master if not already linked, and sync name/category in case template changed
                frappe.db.set_value("PMO Project Task", existing_name, {
                    "task_master": task.name,
                    "task_name": task.task_name,
                    "category": cat.category_name
                }, update_modified=False)
            else:
                doc = frappe.new_doc("PMO Project Task")
                doc.project = project
                doc.task_master = task.name
                doc.task_name = task.task_name
                doc.category = cat.category_name
                doc.status = "Not Defined"
                doc.insert(ignore_permissions=True)
                created_count += 1

    if created_count > 0:
        frappe.db.commit()

    # Safety net: if two init calls run concurrently, deduplicate immediately.
    cleanup_duplicate_tasks(project=project)

    return {"status": "initialized" if created_count > 0 else "already_initialized", "count": created_count}


@frappe.whitelist()
def cleanup_duplicate_tasks(project=None):
    """
    Remove duplicate PMO Project Task records.
    Keeps the oldest record for each project + task_master combination.
    """
    filters = {}
    if project:
        filters["project"] = project

    all_tasks = frappe.get_all(
        "PMO Project Task",
        filters=filters,
        fields=["name", "project", "task_master", "task_name", "category", "creation"],
        order_by="creation asc",
    )

    # Group by (project, task_master) if available, else fallback to (project, category, task_name)
    seen = {}
    duplicates = []
    for task in all_tasks:
        if task.task_master:
            key = (task.project, task.task_master)
        else:
            key = (task.project, task.category, task.task_name)
            
        if key in seen:
            duplicates.append(task.name)
        else:
            seen[key] = task.name

    for dup_name in duplicates:
        frappe.delete_doc("PMO Project Task", dup_name, ignore_permissions=True)

    if duplicates:
        frappe.db.commit()

    return {"removed": len(duplicates), "kept": len(seen)}


@frappe.whitelist()
def get_project_status_overview(project):
    """
    Get the status overview for a project:
    - Drawing status from Project Design Tracker (excluding Not Applicable)
    - DPR last updated from Project Progress Reports
    - Inventory last updated from Remaining Items Report
    """
    result = {
        "drawing": None,
        "dpr": None,
        "inventory": None,
    }

    # 1. Drawing status from Project Design Tracker
    design_tracker = frappe.get_all(
        "Project Design Tracker",
        filters={"project": project},
        fields=["name"],
        limit=1,
    )

    if design_tracker:
        tracker_doc = frappe.get_doc("Project Design Tracker", design_tracker[0].name)
        status_counts = {
            "Not Started": 0,
            "Submitted": 0,
            "In Progress": 0,
            "Approved": 0,
        }
        applicable_drawing_tasks = 0
        not_applicable_tasks = 0

        if hasattr(tracker_doc, "design_tracker_task") and tracker_doc.design_tracker_task:
            for task in tracker_doc.design_tracker_task:
                raw_status = (task.task_status or "").strip()
                status_key = raw_status.casefold()

                if status_key in {"not applicable", "na", "n/a"}:
                    not_applicable_tasks += 1
                    continue

                applicable_drawing_tasks += 1

                if status_key in {"", "not started"}:
                    normalized_status = "Not Started"
                elif status_key == "submitted":
                    normalized_status = "Submitted"
                elif status_key in {"in progress", "in-progress"}:
                    normalized_status = "In Progress"
                elif status_key in {"approved", "approve"}:
                    normalized_status = "Approved"
                else:
                    normalized_status = raw_status or "Not Started"

                if normalized_status in status_counts:
                    status_counts[normalized_status] += 1
                else:
                    status_counts[normalized_status] = 1

        result["drawing"] = {
            "tracker_id": design_tracker[0].name,
            "total": applicable_drawing_tasks,
            "status_counts": status_counts,
            "excluded_not_applicable": not_applicable_tasks,
        }

    # 2. DPR status - last updated from Project Progress Reports
    latest_dpr = frappe.get_all(
        "Project Progress Reports",
        filters={"project": project},
        fields=["report_date", "modified", "report_zone"],
        order_by="report_date desc",
        limit=1,
    )

    if latest_dpr:
        result["dpr"] = {
            "last_updated": str(latest_dpr[0].report_date or latest_dpr[0].modified),
            "zone": latest_dpr[0].report_zone,
        }

    # 3. Inventory status - last updated from Remaining Items Report
    latest_inventory = frappe.get_all(
        "Remaining Items Report",
        filters={"project": project, "status": "Submitted"},
        fields=["report_date", "modified"],
        order_by="report_date desc",
        limit=1,
    )

    if latest_inventory:
        result["inventory"] = {
            "last_updated": str(latest_inventory[0].report_date or latest_inventory[0].modified),
        }

    return result
