import frappe
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
    # 1. Get the base filtered PR list
    result = get_list_with_count_enhanced_impl(
        doctype=doctype,
        fields=fields,
        filters=filters,
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
