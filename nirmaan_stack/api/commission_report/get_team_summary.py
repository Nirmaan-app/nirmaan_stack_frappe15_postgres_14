import frappe
from frappe import _
from frappe.utils import getdate
import json

TASK_STATUSES = [
    "Not Started",
    "Not Applicable",
    "Pending",
    "In Progress",
    "Completed"
]

UNASSIGNED_SENTINEL = "__unassigned__"

def _get_empty_counts():
    counts = {status: 0 for status in TASK_STATUSES}
    counts["total"] = 0
    return counts

def _parse_assigned_designers(assigned_designers_raw):
    if not assigned_designers_raw:
        return []

    parsed = assigned_designers_raw

    if isinstance(assigned_designers_raw, str):
        try:
            parsed = json.loads(assigned_designers_raw)
        except (json.JSONDecodeError, TypeError):
            return []

    items = []
    if isinstance(parsed, dict):
        items = parsed.get("list", [])
    elif isinstance(parsed, list):
        items = parsed
    else:
        return []

    user_ids = []
    for item in items:
        if isinstance(item, dict) and "userId" in item:
            user_ids.append(item["userId"])
        elif isinstance(item, str):
            user_ids.append(item)

    return user_ids

@frappe.whitelist()
def get_team_summary(projects=None, deadline_from=None, deadline_to=None, task_phase=None):
    try:
        trackers = frappe.get_list(
            "Project Commission Report",
            fields=["name", "project_name", "project", "hide_commission_report"],
            limit_page_length=999999
        )
    except Exception as e:
        frappe.log_error(f"Team Summary - Permission Fetch Error: {e}")
        return {"summary": []}

    if not trackers:
        return {"summary": []}

    user_data = {}

    project_filter_set = None
    if projects:
        try:
            parsed_projects = json.loads(projects) if isinstance(projects, str) else projects
            if isinstance(parsed_projects, list) and len(parsed_projects) > 0:
                project_filter_set = set(parsed_projects)
        except (json.JSONDecodeError, TypeError):
            project_filter_set = {projects}

    parsed_deadline_from = getdate(deadline_from) if deadline_from else None
    parsed_deadline_to = getdate(deadline_to) if deadline_to else None

    for tracker in trackers:
        if tracker.get("hide_commission_report"):
            continue

        if project_filter_set and tracker.get("project") not in project_filter_set:
            continue

        try:
            doc = frappe.get_doc("Project Commission Report", tracker.name)

            if not doc.commission_report_task:
                continue

            for task in doc.commission_report_task:
                if task_phase and task.get("task_phase") != task_phase:
                    continue

                task_status = task.get("task_status")

                if task_status == "Not Applicable":
                    continue

                if task_status not in TASK_STATUSES:
                    continue

                if parsed_deadline_from or parsed_deadline_to:
                    task_deadline = task.get("deadline")
                    if not task_deadline:
                        continue
                    parsed_task_deadline = getdate(task_deadline)
                    if parsed_deadline_from and parsed_task_deadline < parsed_deadline_from:
                        continue
                    if parsed_deadline_to and parsed_task_deadline > parsed_deadline_to:
                        continue

                designers = _parse_assigned_designers(task.get("assigned_designers"))

                if not designers:
                    designers = [UNASSIGNED_SENTINEL]

                for user_id in designers:
                    if not user_id:
                        continue

                    if user_id not in user_data:
                        user_data[user_id] = {}

                    tracker_name = doc.name
                    if tracker_name not in user_data[user_id]:
                        user_data[user_id][tracker_name] = {
                            "project_id": doc.project,
                            "project_name": doc.project_name,
                            "tracker_id": tracker_name,
                            "counts": _get_empty_counts()
                        }

                    user_data[user_id][tracker_name]["counts"][task_status] += 1
                    user_data[user_id][tracker_name]["counts"]["total"] += 1

        except Exception as e:
            frappe.log_error(f"Team Summary - Error processing tracker {tracker.name}: {e}")
            continue

    summary = []
    user_names_cache = {}

    for user_id, projects_dict in user_data.items():
        if user_id == UNASSIGNED_SENTINEL:
            user_name = "Unassigned"
        elif user_id not in user_names_cache:
            user_name = frappe.db.get_value("User", user_id, "full_name") or user_id
            user_names_cache[user_id] = user_name
        else:
            user_name = user_names_cache[user_id]

        user_totals = _get_empty_counts()
        projects_list = []

        for tracker_name, project_data in projects_dict.items():
            projects_list.append({
                "project_id": project_data["project_id"],
                "project_name": project_data["project_name"],
                "tracker_id": project_data["tracker_id"],
                "counts": project_data["counts"]
            })

            for status in TASK_STATUSES:
                user_totals[status] += project_data["counts"][status]
            user_totals["total"] += project_data["counts"]["total"]

        projects_list.sort(key=lambda x: (x.get("project_name") or "").lower())

        summary.append({
            "user_id": user_id,
            "user_name": user_name,
            "totals": user_totals,
            "projects": projects_list
        })

    summary.sort(key=lambda x: (x.get("user_id") == UNASSIGNED_SENTINEL, (x.get("user_name") or "").lower()))

    return {"summary": summary}
