import frappe
import json
from collections import defaultdict

from typing import Any, Dict, Set, TypedDict

class ProjectStats(TypedDict):
    project: str
    project_name: str
    total_tags: int
    released_tags: int
    released_count: int
    not_released_count: int
    total_enabled_packages: int
    total_available_headers: int
    used_packages: Set[str]
    used_headers: Set[str]
    all_prs: Set[str]

# Roles that require project-level filtering based on user permissions
FILTERED_ACCESS_ROLES = {
    "Nirmaan Project Manager Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan Procurement Executive Profile",
}

# Roles with full access to all projects
FULL_ACCESS_ROLES = {
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
}


def _get_user_role(user: str) -> str:
    """Get the role profile for a user from Nirmaan Users."""
    if user == "Administrator":
        return "Administrator"

    role = frappe.db.get_value("Nirmaan Users", user, "role_profile")
    return role or ""


def _get_allowed_projects(user: str) -> list[str]:
    """
    Get list of projects the user has access to via Nirmaan User Permissions.
    """
    return frappe.get_all(
        "Nirmaan User Permissions",
        filters={"user": user, "allow": "Projects"},
        pluck="for_value",
    )


def _should_filter_by_permissions(user: str, role: str) -> bool:
    """
    Determine if the user should see filtered projects based on role.
    """
    if user == "Administrator" or role in FULL_ACCESS_ROLES:
        return False

    if role in FILTERED_ACCESS_ROLES:
        return True

    return False


@frappe.whitelist()
def get_projects_with_critical_pr_stats():
    """
    Fetches projects that have Critical PR Tags with aggregated statistics.
    """
    user = frappe.session.user
    role = _get_user_role(user)

    filters = []
    if _should_filter_by_permissions(user, role):
        allowed_projects = _get_allowed_projects(user)
        if not allowed_projects:
            return []
        filters = [["project", "in", allowed_projects]]

    # 1. Fetch all PR Tag Headers to map packages to headers
    tag_headers = frappe.get_all("PR Tag Headers", fields=["tag_package", "pr_header"])
    package_to_headers = defaultdict(list)
    for h in tag_headers:
        if h.tag_package:
            package_to_headers[h.tag_package].append(h.pr_header)

    # 2. Fetch Critical PR Tags
    tags = frappe.get_all(
        "Critical PR Tags",
        fields=[
            "name",
            "project",
            "projectname",
            "associated_prs",
            "package",
            "header"
        ],
        filters=filters,
        order_by="project asc"
    )

    if not tags:
        return []

    # 3. Fetch unique procurement packages from Project Work Package Category Make for each project
    project_ids = list(set(tag.get("project") for tag in tags if tag.get("project")))
    
    # Efficiently fetch all relevant child table entries in one go
    wp_makes = frappe.get_all(
        "Project Work Package Category Make",
        filters={"parent": ["in", project_ids], "parenttype": "Projects"},
        fields=["parent", "procurement_package"]
    )
    
    project_pkgs_map = defaultdict(set)
    for entry in wp_makes:
        if entry.procurement_package:
            project_pkgs_map[entry.parent].add(entry.procurement_package)

    project_data: Dict[str, ProjectStats] = {}

    for tag in tags:
        p_id = tag.get("project")
        if not p_id:
            continue

        if p_id not in project_data:
            enabled_pkgs = list(project_pkgs_map.get(p_id, []))
            
            # Calculate total available headers based on enabled packages
            available_headers = set()
            for pkg in enabled_pkgs:
                for h in package_to_headers.get(pkg, []):
                    available_headers.add(h)

            project_data[p_id] = {
                "project": p_id,
                "project_name": tag.get("projectname", ""),
                "total_tags": 0,
                "released_tags": 0,
                "released_count": 0,
                "not_released_count": 0,
                "total_enabled_packages": len(enabled_pkgs),
                "total_available_headers": len(available_headers),
                "used_packages": set(),
                "used_headers": set(),
                "all_prs": set()
            }
        
        # Determine release status based on associated_prs
        prs_raw = tag.get("associated_prs")
        is_rel = False
        p_data = project_data[p_id] # Helping the linter with a local variable
        
        if prs_raw:
            try:
                data = prs_raw
                if isinstance(prs_raw, str):
                    data = json.loads(prs_raw)
                
                if isinstance(data, dict) and data.get("prs"):
                    is_rel = True
                    # Collect unique PR names/IDs from strings or objects
                    for pr_entry in data["prs"]:
                        if isinstance(pr_entry, dict) and pr_entry.get("name"):
                            p_data["all_prs"].add(pr_entry["name"])
                        elif isinstance(pr_entry, str):
                            p_data["all_prs"].add(pr_entry)
            except Exception:
                pass
        
        p_data["total_tags"] += 1
        if tag.get("package"):
            p_data["used_packages"].add(tag.get("package"))
        if tag.get("header"):
            p_data["used_headers"].add(tag.get("header"))

        if is_rel:
            p_data["released_tags"] += 1
            p_data["released_count"] += 1
        else:
            p_data["not_released_count"] += 1

    # Fetch project lifecycle status for the projects with at least one tag
    project_ids_with_tags = [
        pid for pid, data in project_data.items() if data["total_tags"] > 0
    ]
    project_status_map = {}
    if project_ids_with_tags:
        project_docs = frappe.get_all(
            "Projects",
            filters={"name": ["in", project_ids_with_tags]},
            fields=["name", "status"],
        )
        project_status_map = {p.name: p.status or "" for p in project_docs}

    result = []
    for p_id in sorted(project_data.keys()):
        data = project_data[p_id]
        if data["total_tags"] > 0:
            result.append({
                "project": data["project"],
                "project_name": data["project_name"],
                "status_of_project": project_status_map.get(p_id, ""),
                "total_tags": data["total_tags"],
                "released_tags": data["released_tags"],
                "status_counts": {
                    "Released": data["released_count"],
                    "Not Released": data["not_released_count"]
                },
                "total_enabled_packages": data["total_enabled_packages"],
                "used_packages_count": len(data["used_packages"]),
                "total_available_headers": data["total_available_headers"],
                "used_headers_count": len(data["used_headers"]),
                "total_prs": len(data["all_prs"])
            })

    # Final sort by project name
    result.sort(key=lambda x: x["project_name"].lower() if x["project_name"] else "")

    return result
