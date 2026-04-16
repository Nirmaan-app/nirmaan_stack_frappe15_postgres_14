"""
API endpoints for the PMO Dashboard feature.

Provides endpoints to manage PMO project tasks across all projects,
including task initialization from master templates, status updates,
and project-level status overviews.
"""

import json

import frappe
from frappe.utils import today, add_days, getdate

HANDOVER_VISIBLE_STATUSES = {"handover", "completed"}


def _is_handover_phase(status):
    return (status or "").strip().lower() in HANDOVER_VISIBLE_STATUSES


def _extract_status_change_value_pairs(version_data):
    """
    Parse Version.data JSON and yield (old_value, new_value) for status changes.
    """
    if not version_data:
        return []

    try:
        parsed = json.loads(version_data)
    except Exception:
        return []

    changes = []
    raw_changed = parsed.get("changed") if isinstance(parsed, dict) else None
    if not isinstance(raw_changed, list):
        return changes

    for row in raw_changed:
        if not isinstance(row, (list, tuple)) or len(row) < 3:
            continue
        fieldname = (row[0] or "").strip().lower() if isinstance(row[0], str) else ""
        if fieldname == "status":
            changes.append((row[1], row[2]))

    return changes


def _get_handover_status_date(project_name, current_status=None, project_creation=None):
    """
    Return the first date when project status entered Handover/Completed.
    Falls back to project creation date when project is already in target state
    but no status-change version record exists.
    """
    version_rows = frappe.get_all(
        "Version",
        filters={"ref_doctype": "Projects", "docname": project_name},
        fields=["creation", "data"],
        order_by="creation asc",
    )

    for row in version_rows:
        for _, new_value in _extract_status_change_value_pairs(row.data):
            if _is_handover_phase(new_value):
                return getdate(row.creation)

    if _is_handover_phase(current_status):
        return getdate(project_creation) if project_creation else getdate(today())

    return None


def _compute_expected_date(base_date, deadline_offset):
    if not base_date:
        return None
    offset_days = int(deadline_offset or 0)
    return add_days(base_date, offset_days)


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
        # filters=[["status", "not in", ["Completed"]]],
        fields=["name", "project_name", "project_city", "project_state", "status", "disabled_pmo", "creation"],
        order_by="creation desc",
    )

    # Build package totals once from PMO masters.
    categories = frappe.get_all(
        "PMO Task Category",
        fields=["name", "category_name", "is_handover_restricted"],
        order_by="`order` asc",
    )
    master_tasks = frappe.get_all(
        "PMO Task Master",
        fields=["category_link"],
    )

    category_name_by_link = {cat.name: cat.category_name for cat in categories}
    category_meta_by_name = {
        cat.category_name: {
            "is_handover_restricted": int(cat.is_handover_restricted or 0)
        }
        for cat in categories
        if cat.category_name
    }
    package_totals = {cat.category_name: 0 for cat in categories if cat.category_name}

    for task in master_tasks:
        category_name = category_name_by_link.get(task.category_link)
        if category_name:
            package_totals[category_name] += 1

    result = []
    for project in projects:
        handover_visible = _is_handover_phase(project.status)

        visible_categories = {
            category_name
            for category_name, meta in category_meta_by_name.items()
            if not meta["is_handover_restricted"] or handover_visible
        }

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
            if total_count > 0 and category_name in visible_categories
        }
        project_task_counts = {}

        for task in tasks:
            cat = task.category
            if cat not in visible_categories:
                continue

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
            "disabled_pmo": project.disabled_pmo,
        })

    return result


@frappe.whitelist()
def get_project_tasks(project):
    """
    Get all PMO Project Task records for a given project, grouped by category.
    Maintains the order from master templates.
    """
    project_info = frappe.get_value(
        "Projects",
        project,
        ["status", "creation"],
        as_dict=True,
    ) or {}
    project_status = project_info.get("status")
    handover_status_date = _get_handover_status_date(
        project_name=project,
        current_status=project_status,
        project_creation=project_info.get("creation"),
    )
    handover_visible = _is_handover_phase(project_status)

    tasks = frappe.db.sql(f"""
        SELECT 
            pt.name, pt.task_name, pt.category, pt.status,
            pt.expected_completion_date, pt.completion_date, pt.attachment,
            pt.task_master, tm.deadline_offset, pc.is_handover_restricted
        FROM 
            `tabPMO Project Task` pt
        LEFT JOIN 
            `tabPMO Task Category` pc ON pt.category = pc.category_name
        LEFT JOIN 
            `tabPMO Task Master` tm ON pt.task_master = tm.name
        WHERE 
            pt.project = %s
        ORDER BY 
            pc.`order` ASC, tm.`order` ASC
    """, (project,), as_dict=True)

    # Group by category maintaining order
    grouped = {}
    category_order = []
    for task in tasks:
        is_handover_restricted = int(task.is_handover_restricted or 0) == 1
        if is_handover_restricted and not handover_visible:
            continue

        if is_handover_restricted:
            task.expected_completion_date = _compute_expected_date(
                handover_status_date, task.deadline_offset
            )

        cat = task.category
        if cat not in grouped:
            grouped[cat] = []
            category_order.append(cat)
        # Keep response payload lean.
        task.pop("is_handover_restricted", None)
        task.pop("deadline_offset", None)
        grouped[cat].append(task)

    return {
        "tasks": grouped,
        "category_order": category_order,
    }


@frappe.whitelist()
def update_task_status(task_name, status, completion_date=None, attachment=None):
    """
    Update a PMO task's status and dates.
    - If status is "Done", completion_date defaults to today
    - If status is "Not Defined", completion_date is cleared
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
        # Keep expected_completion_date as is (set from master offset)
        doc.completion_date = None
    else:
        # Not Defined
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
    # Get project creation date for offset computation
    project_creation, project_status = frappe.db.get_value("Projects", project, ["creation", "status"])
    project_creation_date = getdate(project_creation) if project_creation else None
    handover_status_date = _get_handover_status_date(
        project_name=project,
        current_status=project_status,
        project_creation=project_creation,
    )

    # Get all categories in order
    categories = frappe.get_all(
        "PMO Task Category",
        fields=["name", "category_name", "is_handover_restricted"],
        order_by="`order` asc",
    )

    # Get all master tasks (now including deadline_offset)
    master_tasks = frappe.get_all(
        "PMO Task Master",
        fields=["name", "task_name", "category_link", "deadline_offset"],
        order_by="`order` asc",
    )

    created_count = 0
    for cat in categories:
        cat_tasks = [t for t in master_tasks if t.category_link == cat.name]
        for task in cat_tasks:
            # Compute expected completion date from category-specific anchor date.
            is_handover_restricted = int(cat.is_handover_restricted or 0) == 1

            if is_handover_restricted:
                expected_date = _compute_expected_date(handover_status_date, task.deadline_offset)
            else:
                expected_date = _compute_expected_date(project_creation_date, task.deadline_offset)

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
                update_vals = {
                    "task_master": task.name,
                    "task_name": task.task_name,
                    "category": cat.category_name,
                }
                # Keep expected date synced with the active date anchor.
                if expected_date:
                    update_vals["expected_completion_date"] = expected_date
                elif is_handover_restricted:
                    update_vals["expected_completion_date"] = None
                frappe.db.set_value("PMO Project Task", existing_name, update_vals, update_modified=False)
            else:
                doc = frappe.new_doc("PMO Project Task")
                doc.project = project
                doc.task_master = task.name
                doc.task_name = task.task_name
                doc.category = cat.category_name
                doc.status = "Not Defined"
                if expected_date:
                    doc.expected_completion_date = expected_date
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


@frappe.whitelist()
def update_project_pmo_visibility(project_name, disabled):
    """
    Update the disabled_pmo status for a project.
    disabled should be 0 or 1.
    """
    frappe.db.set_value("Projects", project_name, "disabled_pmo", disabled)
    frappe.db.commit()
    return {"status": "success"}


@frappe.whitelist()
@frappe.whitelist()
def get_all_tasks(
    doctype=None,
    fields=None,
    filters=None,
    order_by=None,
    limit_start=0,
    limit_page_length=50,
    search_term=None,
    **kwargs
):
    """
    Get a flattened list of all PMO Project Tasks across all active projects.
    Computes expected dates for handover-restricted tasks based on project status dates.
    Works natively with `useServerDataTable` hooks.
    """
    from frappe.utils import cint
    start = cint(limit_start)
    page_length = cint(limit_page_length) if limit_page_length else 50

    # 1. Get all active projects and their handover status dates
    projects = frappe.get_all(
        "Projects",
        filters={"disabled_pmo": 0},
        fields=["name", "project_name", "status", "creation"]
    )
    
    project_map = {p.name: p for p in projects}
    handover_dates = {}
    handover_visible_map = {}
    
    for p_name, p in project_map.items():
        handover_dates[p_name] = _get_handover_status_date(
            project_name=p_name,
            current_status=p.status,
            project_creation=p.creation
        )
        handover_visible_map[p_name] = _is_handover_phase(p.status)

    # 2. Get all tasks with category and master info
    tasks = frappe.db.sql("""
        SELECT 
            pt.name, pt.task_name, pt.category, pt.status,
            pt.expected_completion_date, pt.completion_date, pt.attachment,
            pt.project, p.project_name,
            tm.deadline_offset, pc.is_handover_restricted
        FROM 
            `tabPMO Project Task` pt
        INNER JOIN
            `tabProjects` p ON pt.project = p.name
        LEFT JOIN 
            `tabPMO Task Category` pc ON pt.category = pc.category_name
        LEFT JOIN 
            `tabPMO Task Master` tm ON pt.task_master = tm.name
        WHERE 
            p.disabled_pmo = 0
        ORDER BY 
            p.creation DESC, pc.`order` ASC, tm.`order` ASC
    """, as_dict=True)

    # Prepare search and filters
    ui_filters = []
    if filters:
        if isinstance(filters, str):
            try:
                ui_filters = json.loads(filters)
            except: pass
        elif isinstance(filters, list):
            ui_filters = filters

    term_lower = search_term.lower() if search_term else None

    # 3. Process tasks (deadline computation and visibility filters)
    result = []
    for task in tasks:
        p_name = task.project
        is_handover_restricted = int(task.is_handover_restricted or 0) == 1
        handover_visible = handover_visible_map.get(p_name, False)
        
        if is_handover_restricted and not handover_visible:
            # Skip tasks that shouldn't be visible yet
            continue
            
        if is_handover_restricted:
            task.expected_completion_date = _compute_expected_date(
                handover_dates.get(p_name), task.deadline_offset
            )
            
        # Clean up internal fields
        task.pop("is_handover_restricted", None)
        task.pop("deadline_offset", None)

        # Apply Global Search (Task Name, Project Name, Category)
        if term_lower:
            found = False
            for key in ["task_name", "category", "project_name"]:
                val = task.get(key)
                if val and term_lower in str(val).lower():
                    found = True
                    break
            if not found:
                continue

        # Apply UI Column Filters
        filter_fail = False
        for f in ui_filters:
            # typical frappe filter Format: ["DocType", "field", "=", "value"]
            if len(f) >= 3:
                field = f[1]
                op = f[2].lower()
                val = f[3] if len(f) > 3 else None
                
                row_val = task.get(field)
                s_row = str(row_val) if row_val is not None else ""
                s_val = str(val) if val is not None else ""
                
                if op == '=' and s_row != s_val:
                    filter_fail = True
                elif op == '!=' and s_row == s_val:
                    filter_fail = True
                elif op == 'in' and isinstance(val, list) and row_val not in val:
                    filter_fail = True
                elif op == 'not in' and isinstance(val, list) and row_val in val:
                    filter_fail = True
                elif op == 'like' and s_val.replace('%', '').lower() not in s_row.lower():
                    filter_fail = True

            if filter_fail: break
            
        if filter_fail:
            continue
            
        result.append(task)
        
    # Apply Ordering
    try:
        if order_by:
            parts = order_by.split()
            sort_field = parts[0]
            ascending = True
            if len(parts) > 1 and "desc" in parts[1].lower():
                ascending = False
            
            # Helper to handle missing fields cleanly
            def sort_key(x):
                val = x.get(sort_field)
                if isinstance(val, str):
                    return (val is None, val.lower())
                return (val is None, val)
                
            result.sort(key=sort_key, reverse=not ascending)
    except: pass

    # Paginate
    total_count = len(result)
    paginated_data = result[start:start+page_length]
    
    return {
        "data": paginated_data,
        "total_count": total_count
    }
