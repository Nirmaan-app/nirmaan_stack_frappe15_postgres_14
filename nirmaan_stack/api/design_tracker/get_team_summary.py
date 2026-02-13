import frappe
from frappe import _
from frappe.utils import getdate
import json


# Status constants (excluding "Not Applicable")
TASK_STATUSES = [
    "Not Started",
    "Drawings Awaiting from Client",
    "In Progress",
    "Submitted",
    "Revision Pending",
    "Clarification Awaiting",
    "Approved"
]

UNASSIGNED_SENTINEL = "__unassigned__"


def _get_empty_counts():
    """Return a dict with all statuses initialized to 0, plus a total."""
    counts = {status: 0 for status in TASK_STATUSES}
    counts["total"] = 0
    return counts


def _parse_assigned_designers(assigned_designers_raw):
    """
    Parse the assigned_designers JSON field.

    Handles format: {"list": [{"userId": "...", "userName": "...", "userEmail": "..."}]}
    Also handles legacy format: {"list": ["user@example.com", ...]} or direct array

    Returns a list of user IDs (email addresses).
    """
    if not assigned_designers_raw:
        return []

    parsed = assigned_designers_raw

    # If it's a string, try to parse as JSON
    if isinstance(assigned_designers_raw, str):
        try:
            parsed = json.loads(assigned_designers_raw)
        except (json.JSONDecodeError, TypeError):
            return []

    # Extract list from dict with "list" key
    items = []
    if isinstance(parsed, dict):
        items = parsed.get("list", [])
    elif isinstance(parsed, list):
        items = parsed
    else:
        return []

    # Extract userId from objects, or use string directly
    user_ids = []
    for item in items:
        if isinstance(item, dict) and "userId" in item:
            user_ids.append(item["userId"])
        elif isinstance(item, str):
            user_ids.append(item)

    return user_ids


@frappe.whitelist()
def get_team_summary(projects=None, deadline_from=None, deadline_to=None):
    """
    Get a summary of design tasks grouped by user, then by project.

    Args:
        projects: Optional JSON array of project IDs to filter trackers (e.g., '["PROJ-001", "PROJ-002"]')
        deadline_from: Optional start date (inclusive) to filter tasks by deadline
        deadline_to: Optional end date (inclusive) to filter tasks by deadline

    Returns aggregated counts by: User -> Project -> Status

    Response structure:
    {
        "summary": [
            {
                "user_id": "designer@example.com",
                "user_name": "John Doe",
                "totals": {
                    "Not Started": 3,
                    "In Progress": 5,
                    ...
                    "total": 23
                },
                "projects": [
                    {
                        "project_id": "PROJ-001",
                        "project_name": "Project Alpha",
                        "tracker_id": "PDT-001",
                        "counts": { "Not Started": 1, "In Progress": 2, ... }
                    }
                ]
            }
        ]
    }
    """
    # 1. Fetch all allowed Project Design Trackers (respects user permissions)
    try:
        trackers = frappe.get_list(
            "Project Design Tracker",
            fields=["name", "project_name", "project", "hide_design_tracker"],
            limit_page_length=999999
        )
    except Exception as e:
        frappe.log_error(f"Team Summary - Permission Fetch Error: {e}")
        return {"summary": []}

    if not trackers:
        return {"summary": []}

    # Data structure: {user_id: {project_tracker_name: {"project_id": ..., "counts": {...}}}}
    user_data = {}

    # Parse projects filter (JSON array or single value)
    project_filter_set = None
    if projects:
        try:
            parsed_projects = json.loads(projects) if isinstance(projects, str) else projects
            if isinstance(parsed_projects, list) and len(parsed_projects) > 0:
                project_filter_set = set(parsed_projects)
        except (json.JSONDecodeError, TypeError):
            # If not valid JSON, treat as single project ID
            project_filter_set = {projects}

    # Parse date filters once
    parsed_deadline_from = getdate(deadline_from) if deadline_from else None
    parsed_deadline_to = getdate(deadline_to) if deadline_to else None

    # 2. Iterate through trackers and their tasks
    for tracker in trackers:
        # Skip hidden trackers
        if tracker.get("hide_design_tracker"):
            continue

        # Filter by projects if specified (multi-select)
        if project_filter_set and tracker.get("project") not in project_filter_set:
            continue

        try:
            doc = frappe.get_doc("Project Design Tracker", tracker.name)

            if not doc.design_tracker_task:
                continue

            for task in doc.design_tracker_task:
                task_status = task.get("task_status")

                # Skip "Not Applicable" tasks
                if task_status == "Not Applicable":
                    continue

                # Skip if status is not in our known list
                if task_status not in TASK_STATUSES:
                    continue

                # Filter by deadline if date filters are specified
                if parsed_deadline_from or parsed_deadline_to:
                    task_deadline = task.get("deadline")
                    # Skip tasks without a deadline when filtering by date
                    if not task_deadline:
                        continue
                    parsed_task_deadline = getdate(task_deadline)
                    # Skip tasks with deadline before deadline_from
                    if parsed_deadline_from and parsed_task_deadline < parsed_deadline_from:
                        continue
                    # Skip tasks with deadline after deadline_to
                    if parsed_deadline_to and parsed_task_deadline > parsed_deadline_to:
                        continue

                # Parse assigned designers
                designers = _parse_assigned_designers(task.get("assigned_designers"))

                if not designers:
                    designers = [UNASSIGNED_SENTINEL]

                # Count this task for each assigned designer
                for user_id in designers:
                    if not user_id:
                        continue

                    # Initialize user entry if not exists
                    if user_id not in user_data:
                        user_data[user_id] = {}

                    # Initialize project entry for this user if not exists
                    tracker_name = doc.name
                    if tracker_name not in user_data[user_id]:
                        user_data[user_id][tracker_name] = {
                            "project_id": doc.project,
                            "project_name": doc.project_name,
                            "tracker_id": tracker_name,
                            "counts": _get_empty_counts()
                        }

                    # Increment the status count
                    user_data[user_id][tracker_name]["counts"][task_status] += 1
                    user_data[user_id][tracker_name]["counts"]["total"] += 1

        except Exception as e:
            # Log error but continue processing other trackers
            frappe.log_error(f"Team Summary - Error processing tracker {tracker.name}: {e}")
            continue

    # 3. Build the response structure
    summary = []

    # Cache for user full names
    user_names_cache = {}

    for user_id, projects_dict in user_data.items():
        # Fetch user full name (with caching)
        if user_id == UNASSIGNED_SENTINEL:
            user_name = "Unassigned"
        elif user_id not in user_names_cache:
            user_name = frappe.db.get_value("User", user_id, "full_name") or user_id
            user_names_cache[user_id] = user_name
        else:
            user_name = user_names_cache[user_id]

        # Calculate user totals across all projects
        user_totals = _get_empty_counts()
        projects_list = []

        for tracker_name, project_data in projects_dict.items():
            projects_list.append({
                "project_id": project_data["project_id"],
                "project_name": project_data["project_name"],
                "tracker_id": project_data["tracker_id"],
                "counts": project_data["counts"]
            })

            # Aggregate totals
            for status in TASK_STATUSES:
                user_totals[status] += project_data["counts"][status]
            user_totals["total"] += project_data["counts"]["total"]

        # Sort projects alphabetically by project_name
        projects_list.sort(key=lambda x: (x.get("project_name") or "").lower())

        summary.append({
            "user_id": user_id,
            "user_name": user_name,
            "totals": user_totals,
            "projects": projects_list
        })

    # 4. Sort users alphabetically by user_name
    summary.sort(key=lambda x: (x.get("user_id") == UNASSIGNED_SENTINEL, (x.get("user_name") or "").lower()))

    return {"summary": summary}
