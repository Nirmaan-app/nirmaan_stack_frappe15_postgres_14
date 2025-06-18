# # # # # ________________________________ Version 5 (Using Frappe's built-in Report View + Custom Logic for Item Search) ___________________________________
# Now the default search is Global Search on Pre defined fields
# Now Item Search logic is working fine

import frappe
from frappe import _
from frappe.utils import cint, nowdate, getdate, format_date
import frappe.utils.data # Import for get_timespan_date_range
import json
import traceback
import hashlib

from frappe.model.db_query import DatabaseQuery
from frappe.desk.reportview import execute as reportview_execute # Alias for DatabaseQuery(...).execute
from datetime import timedelta, datetime # Ensure datetime is imported

# Define constants
DEFAULT_PAGE_LENGTH = 50
MAX_PAGE_LENGTH = 10000
CACHE_EXPIRY = 300 # 5 minutes
JSON_ITEM_SEARCH_DOCTYPE_MAP = {
    # Renamed item_path to item_path_parts for clarity
    "Procurement Orders": {"json_field": "order_list", "item_path_parts": ["list", "*", "item"], "item_name_key_in_json": "item"},
    # "Procurement Requests": {"json_field": "procurement_list", "item_path_parts": ["list", "*", "item"], "item_name_key_in_json": "item"},
    # --- NEW ENTRY ---
    # "Sent Back Category": {"json_field": "item_list", "item_path_parts": ["list", "*", "item"], "item_name_key_in_json": "item"},
    # -----------------
    "Service Requests": {"json_field": "service_order_list", "item_path_parts": ["list", "*", "item"], "item_name_key_in_json": "description"},
}

CHILD_TABLE_ITEM_SEARCH_MAP = {
    "Procurement Requests": {
        # 'order_list' is the `target_search_field_name` sent from the frontend.
        # It's the field name on the parent Doctype that holds the child table.
        "order_list": {
            "child_doctype": "Procurement Request Item Detail",
            "link_field_to_parent": "parent",
            "searchable_child_fields": ["item_name", "item_id"], # Fields to search within the child table
            "status_field": "status" # Field in child table representing item status
        }
    },
    "Sent Back Category": {
        "order_list": { # Key: fieldname on parent that holds child table
            "child_doctype": "Procurement Request Item Detail", # *** UPDATE THIS TO YOUR ACTUAL CHILD DOCTYPE NAME for Sent Back Category ***
            "link_field_to_parent": "parent",
            "searchable_child_fields": ["item_name", "item_id"], # Or equivalent fields
            "status_field": "status" # Or equivalent status field
        }
    }
}

# --- Helper Functions ---
# (Keep your _parse_json_string_to_list, _parse_filters_input, _parse_search_fields_input helpers here)
def _parse_json_string_to_list(json_string: str | None, param_name: str, doctype_for_log: str) -> list | None:
    if json_string is None: return None
    if not isinstance(json_string, str): return None
    try:
        parsed_list = json.loads(json_string)
        if not isinstance(parsed_list, list): raise ValueError("Not a list")
        return parsed_list
    except (json.JSONDecodeError, ValueError):
        print(f"WARNING ({doctype_for_log}): Invalid JSON list for {param_name}: {json_string}")
        frappe.throw(_(f"Invalid JSON format for '{param_name}'."))
    return None

def _parse_filters_input(filters_input: str | list | dict | None, doctype_for_log: str) -> list:
    print(f"DEBUG (_parse_filters_input for {doctype_for_log}): Input type = {type(filters_input)}, Value = {filters_input}")
    parsed_list_of_lists = []
    parsed_input = None
    if isinstance(filters_input, str):
        try: parsed_input = json.loads(filters_input)
        except json.JSONDecodeError: return []
    elif isinstance(filters_input, (list, dict)): parsed_input = filters_input
    else: return []

    if isinstance(parsed_input, list):
        for item in parsed_input:
            # Check if item represents a Frappe filter [fieldname, operator, value]
            if isinstance(item, list) and len(item) >= 3:
                # Basic validation - ensure fieldname is string if present
                if len(item) == 3 and isinstance(item[0], str):
                     parsed_list_of_lists.append(item)
                elif len(item) == 4 and isinstance(item[1], str):
                     parsed_list_of_lists.append(item)
                else:
                     print(f"WARNING (_parse_filters_input): Skipping malformed list filter item: {item}")
                #  parsed_list_of_lists.append(item)
             # Check if item looks like Tanstack columnFilter {id: "col", value: ...}
            elif isinstance(item, dict) and 'id' in item and 'value' in item:
                column_id = item['id']
                filter_value = item['value']
                
                # Handle Date Filter Object specifically coming from Tanstack state
                if isinstance(filter_value, dict) and 'operator' in filter_value and 'value' in filter_value:
                    
                    # parsed_list_of_lists.append([column_id, frappe_op, final_value])
                    # Pass it through as [column_id, operator_obj, value_obj] for processing later
                    parsed_list_of_lists.append([column_id, filter_value['operator'], filter_value['value']])
                    print(f"DEBUG (_parse_filters_input): Parsed Date Filter Object: {[column_id, filter_value['operator'], filter_value['value']]}")
                    # Check for Facet Filter (array value)

                # Handle Facet Filter (array value)
                elif isinstance(filter_value, list):
                    if len(filter_value) > 0:
                        parsed_list_of_lists.append([column_id, 'in', filter_value])
                    # else: skip empty array filter?

                # Handle Simple String Filter
                elif isinstance(filter_value, str):
                    if filter_value.strip():
                         parsed_list_of_lists.append([column_id, 'like', f'%{filter_value}%']) # Default simple strings to 'like'? Or '='?
                    # else: skip empty string filter?

            else: # Catch-all for unexpected formats within the list
                print(f"WARNING (_parse_filters_input for {doctype_for_log}): Unexpected item format in filters list: {item}")

    elif isinstance(parsed_input, dict): # Handle if filters sent as {'field': 'value'}
        for k, v in parsed_input.items():
            parsed_list_of_lists.append([k, "=", v]) # Assuming doctype prefix handled later or not needed

    print(f"DEBUG (_parse_filters_input for {doctype_for_log}): Returning filter list: {parsed_list_of_lists}")
    return parsed_list_of_lists



# Function to process filters, handling Dates and Timespans
def _process_filters_for_query(filters_list: list, doctype: str) -> list:
    """
    Processes filter list, converting 'Timespan', 'Is', 'IsNot' for Date/DateTime fields.
    Ensures filters are in [doctype, field, op, value] format with date/datetime values
    as strings in 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS.ffffff' format suitable for DB queries.
    Uses workaround for 'IsNot' on DateTime fields.
    """
    processed_filters = []
    COMMON_DATE_FIELDS = {"creation", "modified"}

    for f in filters_list:
        # Basic validation of filter format
        if not isinstance(f, list) or len(f) < 3:
            print(f"WARNING (_process_filters_for_query): Skipping filter item with unexpected format: {f}")
            continue

        field, operator, value = None, None, None
        original_filter_doctype = doctype

        # Determine components, handling optional doctype prefix
        if len(f) == 3:
            field, operator, value = f[0], f[1], f[2]
        elif len(f) == 4:
            if isinstance(f[0], str) and frappe.db.exists("DocType", f[0]):
                original_filter_doctype = f[0]
                field, operator, value = f[1], f[2], f[3]
            else: field, operator, value = f[0], f[1], f[2]
        else: continue


        if not isinstance(f, list) or len(f) < 3: continue
        field, operator, value = None, None, None; original_filter_doctype = doctype
        if len(f) == 3: field, operator, value = f[0], f[1], f[2]
        elif len(f) == 4:
            if isinstance(f[0], str) and frappe.db.exists("DocType", f[0]):
                original_filter_doctype = f[0]; field, operator, value = f[1], f[2], f[3]
            else: field, operator, value = f[0], f[1], f[2]
        else: continue


        if not isinstance(field, str) or not field.strip(): continue

        filter_processed_correctly = False
        is_date_type, is_datetime_type = False, False
        if field in COMMON_DATE_FIELDS: is_date_type, is_datetime_type = True, True
        else:
            try: # Try getting meta
                field_meta = frappe.get_meta(original_filter_doctype).get_field(field)
                if field_meta:
                    is_date_type = field_meta.fieldtype == "Date"
                    is_datetime_type = field_meta.fieldtype == "Datetime"
            except Exception: pass # Ignore meta errors

        sql_date_format = "%Y-%m-%d" # Use standard ISO format for DB

        if is_date_type or is_datetime_type:
            if operator == "Timespan" and isinstance(value, str):
                print(f"Calling Timespan for {field}")
                try:
                    dt_range = frappe.utils.data.get_timespan_date_range(value)
                    start_dt_str = dt_range[0].strftime(sql_date_format)
                    end_dt_str = dt_range[1].strftime(sql_date_format)
                    val_for_query = [start_dt_str, end_dt_str]
                    if is_datetime_type: val_for_query = [start_dt_str + " 00:00:00.000000", end_dt_str + " 23:59:59.999999"]
                    processed_filters.append([original_filter_doctype, field, "Between", val_for_query])
                    filter_processed_correctly = True
                except Exception as e: print(f"ERROR: Processing Timespan '{value}' for '{field}': {e}")

            elif operator == "Is" and isinstance(value, str):
                try:
                    target_date = getdate(value)
                    target_date_str = target_date.strftime(sql_date_format)
                    if is_datetime_type:
                        start_dt_str = target_date_str + " 00:00:00.000000"
                        end_dt_str = target_date_str + " 23:59:59.999999"
                        processed_filters.append([original_filter_doctype, field, "Between", [start_dt_str, end_dt_str]])
                    else: processed_filters.append([original_filter_doctype, field, "=", target_date_str])
                    filter_processed_correctly = True
                except Exception as e: 
                    print(f"ERROR: Processing 'Is' date value '{value}' for '{field}': {e}")

            elif operator == "IsNot" and isinstance(value, str):
                 try:
                    target_date = getdate(value)
                    target_date_str = target_date.strftime(sql_date_format) # Use YYYY-MM-DD
                    # ***** CORRECTED: Use != with YYYY-MM-DD for both Date and DateTime *****
                    # This is imprecise for DateTime but avoids the DataError / ValidationError
                    processed_filters.append([original_filter_doctype, field, "!=", target_date_str])
                    print(f"DEBUG: Using '!=' for Date/DateTime '{field}' != '{target_date_str}' (Note: Imprecise for DateTime)")
                    filter_processed_correctly = True
                 except Exception as e:
                     print(f"ERROR: Processing 'IsNot' date value '{value}' for '{field}': {e}")

            elif operator == "Between" and isinstance(value, list) and len(value)==2:
                try: # Ensure values are YYYY-MM-DD strings
                    start_date_obj = getdate(value[0]) if value[0] else None; end_date_obj = getdate(value[1]) if value[1] else None
                    if start_date_obj and end_date_obj:
                        start_str = start_date_obj.strftime(sql_date_format)
                        end_str = end_date_obj.strftime(sql_date_format)
                        value_for_query = [start_str, end_str]
                        if is_datetime_type: 
                            value_for_query = [start_str + " 00:00:00.000000", end_str + " 23:59:59.999999"]
                        processed_filters.append([original_filter_doctype, field, "Between", value_for_query])
                        filter_processed_correctly = True
                    else: print(f"WARNING: Skipping 'Between' for '{field}' due to invalid values: {value}")
                except Exception as e:
                    print(f"ERROR: Processing 'Between' date values '{value}' for '{field}': {e}")

            elif operator in ["<=", ">="] and isinstance(value, str):
                 try: # Ensure values are YYYY-MM-DD or YYYY-MM-DD HH:MM:SS strings
                    parsed_date = getdate(value)
                    value_str = parsed_date.strftime(sql_date_format)
                    value_for_query = value_str
                    if is_datetime_type:
                         if operator == "<=": value_for_query = value_str + " 23:59:59.999999"
                         elif operator == ">=": value_for_query = value_str + " 00:00:00.000000"
                    processed_filters.append([original_filter_doctype, field, operator, value_for_query])
                    filter_processed_correctly = True
                 except Exception as e: print(f"ERROR: Invalid date format for '{operator}' on '{field}': {value} - {e}")

        # If not processed as a specific date case, add the original filter
        if not filter_processed_correctly:
            if len(f) == 3: processed_filters.append([original_filter_doctype, field, operator, value])
            else: processed_filters.append(f)

    print(f"DEBUG (_process_filters_for_query): Final processed filters output: {processed_filters}")
    return processed_filters


def _parse_search_fields_input(search_fields_input: str | list[str] | None, doctype_for_log: str) -> list[str] | None:
    print(f"DEBUG (_parse_search_fields_input for {doctype_for_log}): Input type = {type(search_fields_input)}, Value = {search_fields_input}")
    parsed_list = None
    if isinstance(search_fields_input, str):
        parsed_list_from_json = _parse_json_string_to_list(search_fields_input, "current_search_fields", doctype_for_log)
        if parsed_list_from_json is not None:
            if all(isinstance(f, str) for f in parsed_list_from_json): parsed_list = parsed_list_from_json
            else: frappe.throw(_("Invalid 'current_search_fields'. Expected list of strings."))
    elif isinstance(search_fields_input, list):
        if all(isinstance(f, str) for f in search_fields_input): parsed_list = search_fields_input
        else: frappe.throw(_("Invalid 'current_search_fields'. All elements must be strings."))
    elif search_fields_input is None: parsed_list = None
    else: frappe.throw(_(f"Invalid type for 'current_search_fields': {type(search_fields_input)}."))
    print(f"DEBUG (_parse_search_fields_input for {doctype_for_log}): Returning: {parsed_list}")
    return parsed_list

def _parse_target_search_field(search_fields_input: str | None, doctype_for_log: str) -> str | None:
    """
    Parses the `current_search_fields` which is expected to be a JSON string
    of a single-element list, e.g., '["name"]' or '["order_list"]'.
    Returns the single field name string or None.
    """
    print(f"DEBUG (_parse_target_search_field for {doctype_for_log}): Input = {search_fields_input}")
    if not search_fields_input or not isinstance(search_fields_input, str):
        return None
    try:
        parsed_list = json.loads(search_fields_input)
        if isinstance(parsed_list, list) and len(parsed_list) == 1 and isinstance(parsed_list[0], str):
            field_name = parsed_list[0]
            print(f"DEBUG (_parse_target_search_field): Parsed single target field: {field_name}")
            return field_name
        else:
            print(f"WARNING (_parse_target_search_field): `current_search_fields` not a single string list: {parsed_list}")
            return None
    except json.JSONDecodeError:
        print(f"WARNING (_parse_target_search_field): Invalid JSON for `current_search_fields`: {search_fields_input}")
        return None



# def _build_standard_filters(
#     doctype: str, base_filters: list, search_term: str | None,
#     global_search_fields: list[str] | None,
# ) -> tuple[list, list]:
#     print(f"\n--- DEBUG (_build_standard_filters for {doctype}) ---")
#     and_filters = list(base_filters)
#     or_filters = []
#     if search_term and global_search_fields:
#         search_term_sql = f"%{search_term}%"
#         effective_search_fields = set(global_search_fields)
#         if "name" not in effective_search_fields: effective_search_fields.add("name")
#         for field_name in effective_search_fields:
#             if isinstance(field_name, str) and field_name.strip():
#                 # Ensure filter format is [doctype, field, op, value] for clarity with or_filters
#                 or_filters.append([doctype, field_name, "like", search_term_sql])
#     elif search_term and not global_search_fields:
#          # Add as AND filter if no specific global fields provided
#          and_filters.append([doctype, "name", "like", f"%{search_term}%"])
#     print(f"DEBUG (StdFilterBuilder): Returning AND: {and_filters}, OR: {or_filters}")
#     return and_filters, or_filters


@frappe.whitelist(allow_guest=False)
def get_list_with_count_enhanced(
    doctype: str, 
    fields: str | list[str], 
    filters: str | list | dict | None = None,
    order_by: str | None = None, 
    limit_start: int | str = 0, 
    limit_page_length: int | str | None = None,
    search_term: str | None = None, 
    current_search_fields: str | None = None, # Now a JSON string of a single field, e.g., '["name"]' or '["order_list"]'
    is_item_search: bool | str = False,
    require_pending_items: bool | str = False, # Flag for PR filtering
    to_cache: bool = False # Flag for caching
) -> dict:

    """
    Fetches a paginated list of documents with count, supporting targeted search and JSON item search.

    Workflow:
    1.  Initialization:
        - Permission checks, parse pagination, select fields.
        - Parse `is_item_search` and `require_pending_items` booleans.
        - Parse base filters (facets, static) using `_parse_filters_input`.
        - Process these base_filters for date/timespan operators using `_process_filters_for_query`.
        - Parse `current_search_fields` to get the single target_search_field_name.
    2.  Cache Key Generation: Based on all processed parameters.
    3.  Cache Check: Attempt to retrieve from cache.
    4.  Main Logic Branching:
        IF `is_item_search_bool` is True AND `search_term` exists AND `target_search_field_name` is configured for JSON search:
            -> Execute Item Search Workaround (Two-Step SQL)
                - Step 1: Get parent doc names matching `processed_base_filters` (respects permissions).
                - Step 2: Filter these names using raw SQL for JSON content search (using `search_term` and `target_search_field_name`'s JSON config).
                - Step 3: Fetch final data for matching names with pagination/sorting.
        ELIF `require_pending_items_bool` is True AND `doctype` is "Procurement Requests":
            -> Execute Pending Item Filter (Two-Step SQL)
                - Step 1: Get parent doc names matching `processed_base_filters` AND any standard targeted search from `search_term` and `target_search_field_name` (if not JSON).
                - Step 2: Filter these names using raw SQL for JSON status='Pending'.
                - Step 3: Fetch final data for matching names.
        ELSE (Standard Targeted Search or No Search):
            -> Build standard filters:
                - Start with `processed_base_filters`.
                - If `search_term` and `target_search_field_name` (and not JSON search), add a `LIKE` condition for that single field.
            -> Execute `DatabaseQuery` for data and count using these filters.
    5.  Cache Result & Return.
    """

    print(f"\n--- API CALL: get_list_with_count_enhanced ---")
    print(f"ARGS: doctype='{doctype}', fields_arg_type={type(fields)}, filters_arg_type={type(filters)}, order_by='{order_by}'")
    print(f"PAGINATION: limit_start={limit_start}, limit_page_length={limit_page_length}")
    print(f"SEARCH: search_term='{search_term}', current_search_fields_arg_type='{type(current_search_fields)}', is_item_search={is_item_search}")
    print(f"NEW ARGS: require_pending_items={require_pending_items}") # Log new arg

    # --- Initial Setup & Parsing ---
    if not frappe.db.exists("DocType", doctype): frappe.throw(_("Invalid DocType: {0}").format(doctype))
    if not frappe.has_permission(doctype, "read"): frappe.throw(_("Not permitted"), frappe.PermissionError)

    start = cint(limit_start)
    page_length = min(cint(limit_page_length or DEFAULT_PAGE_LENGTH), MAX_PAGE_LENGTH)
    is_item_search_bool = isinstance(is_item_search, str) and is_item_search.lower() == 'true' or is_item_search is True
    require_pending_items_bool = isinstance(require_pending_items, str) and require_pending_items.lower() == 'true' or require_pending_items is True

    parsed_select_fields_str_list = _parse_search_fields_input(fields, f"{doctype} (select_fields)") or ["name"]
    if "name" not in parsed_select_fields_str_list: parsed_select_fields_str_list.insert(0, "name")
    
    # parsed_base_filters_list = _parse_filters_input(filters, doctype)

    # --- MODIFIED: Process Filters AFTER parsing ---
    raw_base_filters_list = _parse_filters_input(filters, doctype)
    processed_base_filters = _process_filters_for_query(raw_base_filters_list, doctype) # Handle Timespan etc.
    print(f"DEBUG: Processed base filters: {processed_base_filters}")
    # --- END MODIFICATION ---

    # Parse the single target search field from current_search_fields
    target_search_field_name = _parse_target_search_field(current_search_fields, doctype)


    # parsed_global_search_fields_for_standard_search = _parse_search_fields_input(current_search_fields, f"{doctype} (global_search_fields)")

    _formatted_order_by = order_by or f"`tab{doctype}`.`modified` desc"
    if order_by and not order_by.startswith(f"`tab{doctype}`") and not order_by.startswith("`tab"):
        parts = order_by.split(" ")
        field_part = parts[0].strip("`")
        sort_order_part = parts[1].upper() if len(parts) > 1 and parts[1].upper() in ["ASC", "DESC"] else "DESC"
        safe_fields_to_sort = set(parsed_select_fields_str_list) | {"modified", "creation", "owner", "idx"}
        if field_part in safe_fields_to_sort:
            _formatted_order_by = f"`tab{doctype}`.`{field_part}` {sort_order_part}"
        else:
            print(f"WARNING: Order by field '{field_part}' not in safe list. Defaulting.")
            _formatted_order_by = f"`tab{doctype}`.`modified` desc"

    # --- Caching Key ---
    cache_key_params = {
        "v_api": "4.0", # Incremented version
        "doctype": doctype, 
        "fields": json.dumps(sorted(parsed_select_fields_str_list)),
        # "filters": json.dumps(parsed_base_filters_list), 
        "filters": json.dumps(processed_base_filters),
        "order_by": _formatted_order_by,
        "start": start, 
        "page_length": page_length, 
        "search_term": search_term,
        "target_search_field": target_search_field_name,
        "is_item_search": is_item_search_bool,
        "require_pending_items": require_pending_items_bool,
        # "global_search_fields": json.dumps(sorted(parsed_global_search_fields_for_standard_search)) if not is_item_search_bool and parsed_global_search_fields_for_standard_search else None
    }
    cache_key_string = json.dumps(cache_key_params, sort_keys=True, default=str)
    cache_key = f"dt_target_search_{doctype}_{hashlib.sha1(cache_key_string.encode()).hexdigest()}"
    
    print(f"DEBUG: Cache Key String: {cache_key_string}")
    print(f"DEBUG: Cache Key Final: {cache_key}")
    
    # --- Check Cache ---
    cached_result = frappe.cache().get_value(cache_key)
    if cached_result: # ... (cache hit logic)
        print(f"DEBUG: Cache HIT for key: {cache_key}")
        if isinstance(cached_result, dict) and "data" in cached_result and "total_count" in cached_result:
             return cached_result
        else: print(f"WARNING: Invalid cached data for {cache_key}. Fetching fresh.")

    data = []
    total_records = 0

    # final_and_filters are the parent DocType filters (facets, static, and potentially standard targeted search if not item search)
    final_and_filters = list(processed_base_filters)

    try:
        # --- Determine which search/filter strategy to use ---
        
        # Strategy 1: Child Table Item Search (search_term for item in child table)
        # This is active if is_item_search_bool is true AND the target_search_field_name matches a child table link field
        # in CHILD_TABLE_ITEM_SEARCH_MAP for the current doctype.
        use_child_table_item_search = (
            is_item_search_bool and
            search_term and
            target_search_field_name and
            doctype in CHILD_TABLE_ITEM_SEARCH_MAP and
            target_search_field_name in CHILD_TABLE_ITEM_SEARCH_MAP[doctype]
        )

        # Strategy 2: Child Table Pending Items Filter (no item search_term, but require_pending_items_bool is true)
        # This is active if require_pending_items_bool is true AND the doctype is configured for child table status checks.
        use_child_table_pending_filter = (
            not use_child_table_item_search and # Only if not already doing item search
            require_pending_items_bool and
            doctype in CHILD_TABLE_ITEM_SEARCH_MAP and
            # We need a default child table field (e.g., 'order_list') if target_search_field_name isn't it
            # Let's assume the primary child table for status check is 'order_list' if not specified by target_search_field_name
            (target_search_field_name if target_search_field_name in CHILD_TABLE_ITEM_SEARCH_MAP[doctype] else "order_list")
            in CHILD_TABLE_ITEM_SEARCH_MAP[doctype]
        )

        # Strategy 3: JSON Field Item Search (fallback if not child table)
        use_json_item_search = (
            not use_child_table_item_search and # Only if not child table item search
            not use_child_table_pending_filter and # And not child table pending filter
            is_item_search_bool and
            search_term and
            target_search_field_name and
            doctype in JSON_ITEM_SEARCH_DOCTYPE_MAP and
            JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype]["json_field"] == target_search_field_name
        )
        
        # Strategy 4: JSON Field Pending Items Filter (fallback, if applicable and not child table)
        # This was the old logic for require_pending_items_bool for PRs.
        # We want to replace this with child table logic for PR and SBC.
        # Keep it for other doctypes if they still use JSON and need this flag.
        use_json_pending_filter = (
            not use_child_table_item_search and
            not use_child_table_pending_filter and
            not use_json_item_search and # Only if none of the above
            require_pending_items_bool and
            doctype in JSON_ITEM_SEARCH_DOCTYPE_MAP # And configured for JSON
        )


        if use_child_table_item_search:
            print(f"--- Executing Child Table Item Search for '{doctype}' on parent field '{target_search_field_name}' ---")
            search_config = CHILD_TABLE_ITEM_SEARCH_MAP[doctype][target_search_field_name]
            
            # Apply standard targeted search on parent IF target_search_field_name is NOT the child table link itself
            # but another parent field, AND search_term is also present.
            # However, for item search, the search_term is for the child item.
            # So, `final_and_filters` (which are processed_base_filters) are applied to parent first.
            
            parent_names_query_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
            potential_parent_docs = reportview_execute(**parent_names_query_args)
            potential_parent_names = [doc.get("name") for doc in potential_parent_docs if doc.get("name")]

            if not potential_parent_names:
                total_records, data = 0, []
            else:
                child_doctype_name = search_config["child_doctype"]
                child_link_field = search_config["link_field_to_parent"]
                searchable_child_fields = search_config["searchable_child_fields"]
                child_status_field = search_config.get("status_field") # Get status field for optional pending check

                search_term_like = f"%{search_term}%"
                child_item_search_conditions_sql = " OR ".join([f"`tab{child_doctype_name}`.`{field}` LIKE %(search_term)s" for field in searchable_child_fields])
                
                sql_where_parts = [
                    f"`tab{child_doctype_name}`.`{child_link_field}` IN %(names_tuple)s",
                    f"`tab{child_doctype_name}`.`parenttype` = %(parent_doctype)s",
                    f"({child_item_search_conditions_sql})"
                ]

                # If require_pending_items is ALSO true during an item search, add that filter
                if require_pending_items_bool and child_status_field:
                    sql_where_parts.append(f"`tab{child_doctype_name}`.`{child_status_field}` = 'Pending'")

                sql_where_clause = " AND ".join(sql_where_parts)
                sql = f"SELECT DISTINCT `tab{child_doctype_name}`.`{child_link_field}` FROM `tab{child_doctype_name}` WHERE {sql_where_clause}"
                
                sql_params = {"names_tuple": tuple(potential_parent_names), "parent_doctype": doctype, "search_term": search_term_like}
                
                final_matching_names_result = frappe.db.sql(sql, sql_params, as_list=True)
                final_matching_names = [r[0] for r in final_matching_names_result if r and r[0]]
                total_records = len(final_matching_names)

                if total_records > 0:
                    data_args = frappe._dict({
                        "doctype": doctype, "fields": parsed_select_fields_str_list,
                        "filters": [["name", "in", final_matching_names]],
                        "order_by": _formatted_order_by, "limit_start": start, "limit_page_length": page_length,
                    })
                    data = reportview_execute(**data_args)
                else: data = []
            print(f"--- Finished Child Table Item Search ---")

        elif use_child_table_pending_filter:
            # This case is when require_pending_items_bool is true, but there's NO item search term
            # OR if item search was on a non-child-table field, but we still need to filter by pending child items.
            child_table_field_key = target_search_field_name if target_search_field_name in CHILD_TABLE_ITEM_SEARCH_MAP[doctype] else "order_list"
            search_config = CHILD_TABLE_ITEM_SEARCH_MAP[doctype][child_table_field_key]
            child_status_field = search_config.get("status_field")

            if not child_status_field:
                print(f"WARNING: No status_field configured for child table pending check in {doctype} via {child_table_field_key}. Skipping pending filter.")
                # Fall through to standard search logic without pending filter
                use_child_table_pending_filter = False # Disable this path
            else:
                print(f"--- Executing Child Table Pending Item Filter for '{doctype}' (status field: {child_status_field}) ---")
                # If there's a search term on a *parent* field (target_search_field_name is not the child table itself)
                if search_term and target_search_field_name and target_search_field_name not in CHILD_TABLE_ITEM_SEARCH_MAP[doctype]:
                    final_and_filters.append([doctype, target_search_field_name, "like", f"%{search_term}%"])
                
                parent_names_query_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
                potential_parent_docs = reportview_execute(**parent_names_query_args)
                potential_parent_names = [doc.get("name") for doc in potential_parent_docs if doc.get("name")]

                if not potential_parent_names:
                    total_records, data = 0, []
                else:
                    child_doctype_name = search_config["child_doctype"]
                    child_link_field = search_config["link_field_to_parent"]
                    
                    sql = f"""
                        SELECT DISTINCT `tab{child_doctype_name}`.`{child_link_field}`
                        FROM `tab{child_doctype_name}`
                        WHERE `tab{child_doctype_name}`.`{child_link_field}` IN %(names_tuple)s
                          AND `tab{child_doctype_name}`.`parenttype` = %(parent_doctype)s
                          AND `tab{child_doctype_name}`.`{child_status_field}` = 'Pending'
                    """
                    sql_params = {"names_tuple": tuple(potential_parent_names), "parent_doctype": doctype}
                    final_matching_names_result = frappe.db.sql(sql, sql_params, as_list=True)
                    final_matching_names = [r[0] for r in final_matching_names_result if r and r[0]]
                    total_records = len(final_matching_names)

                    if total_records > 0:
                        data_args = frappe._dict({
                            "doctype": doctype, "fields": parsed_select_fields_str_list,
                            "filters": [["name", "in", final_matching_names]],
                            "order_by": _formatted_order_by, "limit_start": start, "limit_page_length": page_length,
                        })
                        data = reportview_execute(**data_args)
                    else: data = []
                print(f"--- Finished Child Table Pending Item Filter ---")
        
        # Fallbacks to JSON search or standard search if child table logic didn't run
        if not use_child_table_item_search and not use_child_table_pending_filter:
            if use_json_item_search:
                print(f"--- Executing JSON Item Search (on {target_search_field_name}) ---")
                search_config = JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype]
                json_field_name = search_config["json_field"]
                item_path_parts = search_config["item_path_parts"]
                item_name_key_in_json = search_config.get("item_name_key_in_json", item_path_parts[-1] if item_path_parts else "item")
                escaped_search_term_for_like = f"%{search_term}%"

                parent_names_query_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
                potential_parent_docs = reportview_execute(**parent_names_query_args)
                potential_parent_names = [doc.get("name") for doc in potential_parent_docs if doc.get("name")]

                if not potential_parent_names: total_records, data = 0, []
                else:
                    if not item_path_parts or len(item_path_parts) < 2 or item_path_parts[-2] != "*":
                        frappe.throw(_(f"Invalid JSON search config for {target_search_field_name}: {item_path_parts}"))
                    json_array_key = item_path_parts[0]
                    json_search_sql_where_part = f"""EXISTS(
                        SELECT 1 FROM jsonb_array_elements(COALESCE(`tab{doctype}`.`{json_field_name}`::jsonb->'{json_array_key}','[]'::jsonb)) AS item_obj
                        WHERE item_obj->>'{item_name_key_in_json}' ILIKE %(search_term)s
                    )"""
                    sql_params = {"search_term": escaped_search_term_for_like, "names_tuple": tuple(potential_parent_names)}
                    count_sql = f"SELECT COUNT(DISTINCT name) FROM `tab{doctype}` WHERE name IN %(names_tuple)s AND ({json_search_sql_where_part})"
                    count_result = frappe.db.sql(count_sql, sql_params)
                    total_records = count_result[0][0] if count_result and count_result[0] else 0
                    if total_records > 0:
                        data_names_sql = f"SELECT DISTINCT name FROM `tab{doctype}` WHERE name IN %(names_tuple)s AND ({json_search_sql_where_part})"
                        final_matching_names = [r[0] for r in frappe.db.sql(data_names_sql, sql_params, as_list=True) if r and r[0]]
                        if final_matching_names:
                            data_args = frappe._dict({
                                "doctype": doctype, "fields": parsed_select_fields_str_list,
                                "filters": [["name", "in", final_matching_names]],
                                "order_by": _formatted_order_by, "limit_start": start, "limit_page_length": page_length,
                            })
                            data = reportview_execute(**data_args)
                        else: data = []
                    else: data = []
                print(f"--- Finished JSON Item Search ---")
            
            elif use_json_pending_filter: # Old pending item filter for JSON fields
                print(f"--- Executing JSON Pending Item Filter for '{doctype}' ---")
                if search_term and target_search_field_name: # If standard search term is also present
                    final_and_filters.append([doctype, target_search_field_name, "like", f"%{search_term}%"])

                parent_names_query_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
                potential_parent_docs = reportview_execute(**parent_names_query_args)
                potential_parent_names = [doc.get("name") for doc in potential_parent_docs if doc.get("name")]

                if not potential_parent_names: total_records, data = 0, []
                else:
                    search_config = JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype]
                    json_field_name = search_config["json_field"]
                    item_path_parts = search_config["item_path_parts"]
                    item_status_key_in_json = search_config.get("item_status_key","status") # Assuming status key is 'status'
                    if not item_path_parts or len(item_path_parts) < 2 or item_path_parts[-2] != "*":
                        frappe.throw(_(f"Invalid JSON search config for pending items: {item_path_parts}"))
                    json_array_key = item_path_parts[0]
                    json_pending_sql_where_part = f"""EXISTS(
                        SELECT 1 FROM jsonb_array_elements(COALESCE(`tab{doctype}`.`{json_field_name}`::jsonb->'{json_array_key}','[]'::jsonb)) AS item_obj
                        WHERE item_obj->>'{item_status_key_in_json}' = 'Pending'
                    )"""
                    sql_params = {"names_tuple": tuple(potential_parent_names)}
                    count_sql = f"SELECT COUNT(DISTINCT name) FROM `tab{doctype}` WHERE name IN %(names_tuple)s AND ({json_pending_sql_where_part})"
                    count_result = frappe.db.sql(count_sql, sql_params)
                    total_records = count_result[0][0] if count_result and count_result[0] else 0
                    if total_records > 0:
                        data_names_sql = f"SELECT DISTINCT name FROM `tab{doctype}` WHERE name IN %(names_tuple)s AND ({json_pending_sql_where_part})"
                        final_matching_names = [r[0] for r in frappe.db.sql(data_names_sql, sql_params, as_list=True) if r and r[0]]
                        if final_matching_names:
                            data_args = frappe._dict({
                                "doctype": doctype, "fields": parsed_select_fields_str_list,
                                "filters": [["name", "in", final_matching_names]],
                                "order_by": _formatted_order_by, "limit_start": start, "limit_page_length": page_length,
                            })
                            data = reportview_execute(**data_args)
                        else: data = []
                    else: data = []
                print(f"--- Finished JSON Pending Item Filter ---")

            else: # Standard Targeted Search / No Search (Ultimate Fallback)
                print(f"--- Executing Standard Targeted Search / Fetch (Ultimate Fallback) for '{doctype}' ---")
                if search_term and target_search_field_name:
                    final_and_filters.append([doctype, target_search_field_name, "like", f"%{search_term}%"])
                
                data_args = frappe._dict({
                    "doctype": doctype, "fields": parsed_select_fields_str_list,
                    "filters": final_and_filters, "order_by": _formatted_order_by,
                    "limit_start": start, "limit_page_length": page_length,
                })
                # For count, fetch all names matching the filters then count them
                count_fetch_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
                all_matching_docs_for_count = reportview_execute(**count_fetch_args)
                total_records = len(all_matching_docs_for_count)
                
                if total_records > 0 : # Only fetch paginated data if there are records
                    data = reportview_execute(**data_args)
                else:
                    data = [] # Ensure data is empty if no records
                print(f"--- Finished Standard Targeted Search / Fetch (Ultimate Fallback) ---")


        final_result = {"data": data, "total_count": total_records}
        if to_cache:
            frappe.cache().set_value(cache_key, final_result, expires_in_sec=CACHE_EXPIRY)
            # print(f"DEBUG: Result stored in cache with key: {cache_key}")
        return final_result

    except frappe.PermissionError:
        # print("ERROR: PermissionError caught in API")
        raise
    except Exception as e:
        print(f"ERROR: Final Exception caught in API (get_list_with_count_enhanced): {type(e).__name__} - {str(e)}")
        traceback.print_exc()
        frappe.throw(_("An error occurred while fetching list data. Details: {0}").format(str(e)))