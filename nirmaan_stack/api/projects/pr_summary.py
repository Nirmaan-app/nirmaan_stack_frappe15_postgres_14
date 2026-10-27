import frappe
import json
from frappe.utils import create_batch
from nirmaan_stack.api.data_table.search import get_list_with_count_enhanced_impl

@frappe.whitelist(allow_guest=False)
def get_pr_summary_list(
    doctype: str, 
    fields: str | list[str], 
    filters: str | list | dict | None = None,
    order_by: str | None = None, 
    limit_start: int | str = 0, 
    limit_page_length: int | str | None = None,
    search_term: str | None = None, 
    current_search_fields: str | None = None,
    **kwargs
) -> dict:
    """
    Enriched PR list that includes tags from the child table.
    """
    # 0. Handle derived_status filtering if present
    processed_filters = filters
    if isinstance(filters, str) and filters:
        try:
            processed_filters = json.loads(filters)
        except:
            processed_filters = []
    
    if processed_filters is None:
        processed_filters = []
    
    # Ensure processed_filters is a list for the following operations
    if isinstance(processed_filters, dict):
        # If it's a dict, get_list_with_count_enhanced_impl can handle it, 
        # but our status filtering logic expects a list of conditions.
        # For now, if it's a dict, we don't try to intercept derived_status 
        # unless it's a single key-value pair we recognize.
        pass
    
    applied_name_filter = None
    if isinstance(processed_filters, list):
        # Extract project_id from filters to call get_project_pr_status_counts
        project_id = None
        for f in processed_filters:
            if isinstance(f, list) and len(f) >= 3 and f[0] == "project":
                project_id = f[2]
                break
        
        # Check for derived_status filter
        derived_status_filter_idx = -1
        requested_statuses = []
        for i, f in enumerate(processed_filters):
            if isinstance(f, list) and len(f) >= 3 and f[0] == "derived_status":
                derived_status_filter_idx = i
                requested_statuses = f[2] if isinstance(f[2], list) else [f[2]]
                break
        
        if derived_status_filter_idx != -1 and project_id:
            # We have a derived_status filter. 
            # 1. Fetch the actual status mapping for this project
            from nirmaan_stack.api.projects.project_aggregates import get_project_pr_status_counts
            status_data = get_project_pr_status_counts(project_id)
            pr_statuses = status_data.get("pr_statuses", {})
            
            # 2. Find PR names that match requested statuses
            matching_pr_names = [name for name, status in pr_statuses.items() if status in requested_statuses]
            
            # 3. Add a name-based filter
            if matching_pr_names:
                applied_name_filter = ["name", "in", matching_pr_names]
            else:
                # Force no results if no PR matches the derived status
                applied_name_filter = ["name", "=", "NON_EXISTENT_PR"]
                
            # 4. Remove the derived_status filter so it doesn't crash the SQL query
            processed_filters.pop(derived_status_filter_idx)

        # Re-inject the name filter if calculated
        if applied_name_filter:
            processed_filters.append(applied_name_filter)

    # 1. Get the base filtered PR list
    result = get_list_with_count_enhanced_impl(
        doctype=doctype,
        fields=fields,
        filters=processed_filters,
        order_by=order_by,
        limit_start=limit_start,
        limit_page_length=limit_page_length,
        search_term=search_term,
        current_search_fields=current_search_fields,
        **kwargs
    )

    pr_data = result.get("data", [])
    if not pr_data:
        return result

    # 2. Extract PR names for child table fetch
    pr_names = [pr.get("name") for pr in pr_data if pr.get("name")]
    if not pr_names:
        return result

    # 3. Fetch each PR's packages (its `pr_tag_list` rows)
    tags_by_parent = _packages_by_pr(pr_names)

    # 4. Inject them into the results
    for pr in pr_data:
        pr["pr_tag_list"] = tags_by_parent.get(pr.get("name"), [])

    return result


def _packages_by_pr(pr_names: list[str]) -> dict:
    """{pr_name: [{tag_package}, ...]}, each package once per PR, sorted.

    PR tags carry only a package (the header was retired, see services/pr_packages.py). Rows
    written before that can still repeat a package (one per old HVAC header) until the clean-up
    patch runs, so they are de-duplicated here.
    """
    tags = []
    # Chunked: a whole project's PR names would overrun sqlparse's 10k-token cap.
    for chunk in create_batch(pr_names, 500):
        tags += frappe.get_all(
            "PR Tag Child Table",
            fields=["parent", "tag_package"],
            filters={
                "parent": ["in", list(chunk)],
                "parenttype": "Procurement Requests",
                "parentfield": "pr_tag_list",
            },
        )
    packages_by_pr: dict = {}
    for tag in tags:
        if tag.get("tag_package"):
            packages_by_pr.setdefault(tag.get("parent"), set()).add(tag.get("tag_package"))
    return {
        parent: [{"tag_package": package} for package in sorted(packages)]
        for parent, packages in packages_by_pr.items()
    }


@frappe.whitelist(allow_guest=False)
def get_pr_tags_by_names(pr_names: str | list[str]) -> dict:
    """Return {pr_name: [{tag_package}, ...]} for the given PRs.

    Used by list pages that load PRs via `frappe.client.get_list` (which cannot
    return child tables, and where direct reads on `PR Tag Child Table` are
    blocked by perms).
    """
    if isinstance(pr_names, str):
        try:
            pr_names = json.loads(pr_names)
        except Exception:
            pr_names = [pr_names]

    if not pr_names:
        return {}

    return _packages_by_pr(pr_names)


@frappe.whitelist(allow_guest=False)
def get_pr_tags_by_project(project: str) -> dict:
    """Return {pr_name: [{tag_package}, ...]} for every PR in a project.

    The PR-name list is derived server-side so the caller never ships the whole
    list of names in the request URL. Passing all names in a GET query string
    overruns nginx's request-line limit on large projects (the same failure mode
    that broke the Project-Payments PO-Wise view); passing just the project id
    keeps the URL O(1) regardless of how many PRs the project has.
    """
    if not project:
        return {}
    pr_names = frappe.get_all(
        "Procurement Requests", filters={"project": project}, pluck="name"
    )
    if not pr_names:
        return {}
    # Reuse the tested name-based path; the IN-list now lives server-side where
    # there is no URL limit (and well under sqlparse's token cap for one project).
    return get_pr_tags_by_names(pr_names)
