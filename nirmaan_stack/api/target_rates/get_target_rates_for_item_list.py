import frappe
from frappe.utils import cstr, create_batch # cstr is useful for ensuring string type


def _reorder_by(rows, order_by):
    """Re-impose a Frappe-style `order_by` on a list merged from chunked queries so a multi-chunk result
    matches the single-query order. Handles the common `field [asc|desc][, field2 ...]` form; a sort field
    that was not fetched is skipped (those rows keep their concatenation order). NULLs are ordered the
    PostgreSQL way (NULLS LAST for asc, NULLS FIRST for desc) so ties behave like the original query."""
    if not rows or not order_by:
        return
    clauses = [c.strip() for c in str(order_by).split(",") if c.strip()]
    # Apply least-significant clause first; Python's sort is stable, so this yields the correct multi-key order.
    for clause in reversed(clauses):
        parts = clause.split()
        field = parts[0].strip("`").split(".")[-1].strip("`")
        reverse = len(parts) > 1 and parts[1].lower() == "desc"
        if field not in rows[0]:
            continue
        rows.sort(key=lambda r, _f=field: (r.get(_f) is None, r.get(_f)), reverse=reverse)


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

        # Fetch parent "Target Rates" documents for the given item_ids.
        # The client-supplied item_ids_list can be large, so chunk the `item_id IN (...)` to keep the
        # generated query under sqlparse's 10,000-token cap (validate_generated_query). Each Target Rate has
        # exactly one item_id, so de-duping item_ids (IN already de-dupes) prevents a duplicate row when the
        # same item_id would straddle two chunks; we then re-impose the global `order_by` on the merged list
        # so the result order is byte-identical to the single-query result.
        unique_item_ids = list(dict.fromkeys(item_ids_list))
        target_rates_list = []
        for chunk in create_batch(unique_item_ids, 500):
            target_rates_list.extend(frappe.get_all(
                "Target Rates",
                fields=parent_fields,
                filters={"item_id": ["in", list(chunk)]},  # Use "in" operator for list filtering
                order_by=order_by
            ))
        _reorder_by(target_rates_list, order_by)

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