import frappe
from nirmaan_stack.api.data_table.search import get_list_with_count_enhanced_impl
from nirmaan_stack.api.data_table.facets import get_facet_values_impl

@frappe.whitelist(allow_guest=False)
def get_list_with_count_enhanced(
    doctype: str, 
    fields: str | list[str], 
    filters: str | list | dict | None = None,
    order_by: str | None = None, 
    limit_start: int | str = 0, 
    limit_page_length: int | str | None = None,
    search_term: str | None = None, 
    current_search_fields: str | None = None,
    is_item_search: bool | str = False,
    require_pending_items: bool | str = False,
    to_cache: bool = False,
    aggregates_config: str | None = None,
    group_by_config: str | None = None,
    **kwargs
) -> dict:
    """
    Whitelisted entry point for enhanced list fetching with counts and targeted search.
    Delegates implementation to the nirmaan_stack.api.data_table.search module.
    """
    return get_list_with_count_enhanced_impl(
        doctype=doctype,
        fields=fields,
        filters=filters,
        order_by=order_by,
        limit_start=limit_start,
        limit_page_length=limit_page_length,
        search_term=search_term,
        current_search_fields=current_search_fields,
        is_item_search=is_item_search,
        require_pending_items=require_pending_items,
        to_cache=to_cache,
        aggregates_config=aggregates_config,
        group_by_config=group_by_config,
        **kwargs
    )

@frappe.whitelist(allow_guest=False)
def get_facet_values(
    doctype: str = None,
    field: str = None,
    filters: str | list | dict | None = None,
    search_term: str | None = None,
    current_search_fields: str | None = None,
    limit: int | str = 100
) -> dict:
    """
    Whitelisted entry point for dynamic facet value calculation.
    Delegates implementation to the nirmaan_stack.api.data_table.facets module.
    """
    return get_facet_values_impl(
        doctype=doctype,
        field=field,
        filters=filters,
        search_term=search_term,
        current_search_fields=current_search_fields,
        limit=limit
    )