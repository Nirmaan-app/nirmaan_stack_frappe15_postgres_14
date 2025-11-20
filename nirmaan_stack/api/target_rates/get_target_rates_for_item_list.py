import frappe
from frappe.utils import cstr # cstr is useful for ensuring string type

@frappe.whitelist()
def get_target_rates_for_item_list(item_ids_json, order_by="modified desc"):
    """
    Fetches Target Rates documents along with their child Selected Quotations
    for a specific list of item_ids.

    :param item_ids_json: JSON string representing a list of item_ids.
                          Example: '["ITEM001", "ITEM002"]'
    :param order_by: Field to order the parent Target Rates by.
    """
    try:
        if not item_ids_json:
            frappe.msgprint("No item IDs provided.", indicator="orange", alert=True)
            return []

        item_ids_list = frappe.parse_json(item_ids_json)

        if not isinstance(item_ids_list, list) or not item_ids_list:
            frappe.throw("Parameter 'item_ids_json' must be a non-empty JSON array of item IDs.")
            return # Should not be reached due to frappe.throw

        # Ensure all item_ids are strings, in case numbers or other types are passed
        item_ids_list = [cstr(item_id) for item_id in item_ids_list if item_id]

        if not item_ids_list: # If after cleaning, the list is empty
             frappe.msgprint("No valid item IDs provided after cleaning.", indicator="orange", alert=True)
             return []

        # Define fields to fetch for the parent "Target Rates"
        parent_fields = ["name", "item_name", "unit","make", "rate", "item_id", "creation", "modified"]

        # Fetch parent "Target Rates" documents for the given item_ids
        target_rates_list = frappe.get_all(
            "Target Rates",
            fields=parent_fields,
            filters={
                "item_id": ["in", item_ids_list]  # Use "in" operator for list filtering
            },
            # Pagination parameters (limit_start, limit_page_length) are removed
            # as we are fetching for a specific list. If the list of item_ids
            # can be extremely large, consider client-side batching or re-adding pagination.
            order_by=order_by
        )

        if not target_rates_list:
            # It's valid to find no target rates for the given items
            return []

        # Define fields to fetch for the child "Selected Quotations"
        child_fields = [
            "name", "item_id", "item_name", "vendor_name", "procurement_order",
            "unit", "quantity", "quote", "city", "state", "category",
            "procurement_package", "make", "idx", "dispatch_date"
        ]

        results_with_children = []

        for tr_header in target_rates_list:
            selected_quotations = frappe.get_all(
                "Selected Quotations",
                fields=child_fields,
                filters={
                    "parent": tr_header.name,
                    "parenttype": "Target Rates"
                    # Optional: "parentfield": "your_child_table_fieldname_in_target_rates"
                    # e.g., "parentfield": "selected_quotations"
                },
                order_by="idx asc"
            )

            tr_data = dict(tr_header)
            tr_data["selected_quotations_items"] = selected_quotations
            results_with_children.append(tr_data)

        return results_with_children

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "get_target_rates_for_item_list API Error")
        # Re-raise or return a structured error
        # frappe.response.status_code = 500
        # return {"error": str(e), "traceback": frappe.get_traceback()}
        raise # Frappe will handle and return 500 with traceback in dev mode