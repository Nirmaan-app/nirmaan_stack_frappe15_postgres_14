import frappe
import json
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

    # 3. Fetch tags for these PRs
    tags = frappe.get_all(
        "PR Tag Child Table",
        fields=["parent", "tag_header", "tag_package"],
        filters={"parent": ["in", pr_names], "parenttype": "Procurement Requests"}
    )

    # 4. Map tags to their parent PRs
    tags_by_parent = {}
    for tag in tags:
        parent = tag.get("parent")
        if parent not in tags_by_parent:
            tags_by_parent[parent] = []
        tags_by_parent[parent].append({
            "tag_header": tag.get("tag_header"),
            "tag_package": tag.get("tag_package")
        })

    # 5. Inject tags into the results
    for pr in pr_data:
        pr["pr_tag_list"] = tags_by_parent.get(pr.get("name"), [])

    return result
