# # # # # ________________________________ Version 4 (Using Frappe's built-in Report View) ___________________________________


# # # # import frappe
# # # # from frappe import _
# # # # from frappe.utils import cint
# # # # import json
# # # # import traceback
# # # # import hashlib

# # # # from frappe.model.db_query import DatabaseQuery

# # # # # --- Import necessary functions from reportview ---
# # # # # We will use `reportview_execute` which is essentially `DatabaseQuery(doctype).execute()`
# # # # from frappe.desk.reportview import execute as reportview_execute

# # # # # Define constants
# # # # DEFAULT_PAGE_LENGTH = 10
# # # # MAX_PAGE_LENGTH = 2000 # Increased as per your previous file
# # # # CACHE_EXPIRY = 300 # 5 minutes

# # # # JSON_ITEM_SEARCH_DOCTYPE_MAP = {
# # # #     # DocTypes mapped to the JSON field and the path to the item identifier within that field's structure
# # # #     "Procurement Orders": {"json_field": "order_list", "item_path": ["list", "*", "item"]},
# # # #     "Procurement Requests": {"json_field": "procurement_list", "item_path": ["list", "*", "item"]},
# # # #     # Add other DocTypes here if they need item search on a JSON field
# # # # }


# # # # # --- Helper Functions (Moved before the main API function) ---

# # # # # def _parse_json_string_to_list(json_string: str | None, param_name: str, doctype_for_log: str) -> list | None:
# # # # #     """Safely parses a JSON string expected to be a list."""
# # # # #     if json_string is None:
# # # # #         return None
# # # # #     if not isinstance(json_string, str):
# # # # #         print(f"WARNING ({doctype_for_log}): Expected string for {param_name}, got {type(json_string)}. Value: {json_string}")
# # # # #         return None # Or raise error
# # # # #     try:
# # # # #         parsed_list = json.loads(json_string)
# # # # #         if not isinstance(parsed_list, list):
# # # # #             print(f"ERROR ({doctype_for_log}): {param_name} JSON did not parse to a list. Parsed: {parsed_list}")
# # # # #             frappe.throw(_(f"Invalid format for '{param_name}'. Expected a JSON list."))
# # # # #         return parsed_list
# # # # #     except json.JSONDecodeError:
# # # # #         print(f"WARNING ({doctype_for_log}): Invalid JSON for {param_name}: {json_string}")
# # # # #         # Depending on strictness, you might want to raise an error or return None/empty list
# # # # #         frappe.throw(_(f"Invalid JSON format for '{param_name}'."))
# # # # #     return None


# # # # # def _parse_filters_input(filters_input: str | list | dict | None, doctype_for_log: str) -> list:
# # # # #     """Parses various filter input types into a list of lists format."""
# # # # #     print(f"DEBUG (_parse_filters_input for {doctype_for_log}): Input type = {type(filters_input)}, Value = {filters_input}")
# # # # #     if isinstance(filters_input, str):
# # # # #         try:
# # # # #             parsed = json.loads(filters_input)
# # # # #             if isinstance(parsed, list):
# # # # #                 # Ensure all sub-elements are also lists (Frappe filter format)
# # # # #                 if all(isinstance(item, list) for item in parsed):
# # # # #                     print(f"DEBUG (_parse_filters_input for {doctype_for_log}): Parsed from JSON string (list of lists) = {parsed}")
# # # # #                     return parsed
# # # # #                 else:
# # # # #                     print(f"WARNING (_parse_filters_input for {doctype_for_log}): JSON parsed to list, but not all items are lists. Value: {parsed}")
# # # # #                     # Attempt to handle if it's a list of dicts or other structures if necessary,
# # # # #                     # or simply return empty / raise error if strict format expected.
# # # # #                     # For now, assuming it should be list of lists or will be handled downstream.
# # # # #                     return parsed # Or handle more strictly
# # # # #             elif isinstance(parsed, dict):
# # # # #                 # Convert dict to list of lists
# # # # #                 dict_as_list = [[doctype_for_log, k, "=", v] for k, v in parsed.items()]
# # # # #                 print(f"DEBUG (_parse_filters_input for {doctype_for_log}): Parsed from JSON string (dict to list) = {dict_as_list}")
# # # # #                 return dict_as_list
# # # # #             else:
# # # # #                 print(f"WARNING (_parse_filters_input for {doctype_for_log}): JSON string did not parse to list or dict. Parsed: {parsed}")
# # # # #                 return []
# # # # #         except json.JSONDecodeError:
# # # # #             print(f"WARNING (_parse_filters_input for {doctype_for_log}): JSONDecodeError for string filters. String was: '{filters_input}'. Returning empty list.")
# # # # #             return []
# # # # #     elif isinstance(filters_input, list):
# # # # #         if all(isinstance(item, list) for item in filters_input):
# # # # #             print(f"DEBUG (_parse_filters_input for {doctype_for_log}): Input is already list of lists = {filters_input}")
# # # # #             return filters_input
# # # # #         else:
# # # # #              print(f"WARNING (_parse_filters_input for {doctype_for_log}): Input is list, but not all items are lists. Value: {filters_input}")
# # # # #              # Handle as needed or return empty
# # # # #              return filters_input # Or handle more strictly
# # # # #     elif isinstance(filters_input, dict):
# # # # #         dict_as_list = [[doctype_for_log, k, "=", v] for k, v in filters_input.items()]
# # # # #         print(f"DEBUG (_parse_filters_input for {doctype_for_log}): Input is dict, converted to list = {dict_as_list}")
# # # # #         return dict_as_list
    
# # # # #     print(f"DEBUG (_parse_filters_input for {doctype_for_log}): No valid input, returning empty list.")
# # # # #     return []


# # # # # def _parse_search_fields_input(search_fields_input: str | list[str] | None, doctype_for_log: str) -> list[str] | None:
# # # # #     """Parses the current_search_fields parameter."""
# # # # #     print(f"DEBUG (_parse_search_fields_input for {doctype_for_log}): Input type = {type(search_fields_input)}, Value = {search_fields_input}")
# # # # #     if isinstance(search_fields_input, str):
# # # # #         parsed_list = _parse_json_string_to_list(search_fields_input, "current_search_fields", doctype_for_log)
# # # # #         if parsed_list is not None and all(isinstance(f, str) for f in parsed_list):
# # # # #             return parsed_list
# # # # #         elif parsed_list is not None: # Parsed to list, but not list of strings
# # # # #             print(f"ERROR (_parse_search_fields_input for {doctype_for_log}): Parsed current_search_fields is not a list of strings. Value: {parsed_list}")
# # # # #             frappe.throw(_("Invalid 'current_search_fields'. Expected list of field name strings."))
# # # # #         return None # JSON was invalid or not a list
# # # # #     elif isinstance(search_fields_input, list):
# # # # #         if all(isinstance(f, str) for f in search_fields_input):
# # # # #             return search_fields_input
# # # # #         else:
# # # # #             print(f"ERROR (_parse_search_fields_input for {doctype_for_log}): current_search_fields list contains non-string elements. Value: {search_fields_input}")
# # # # #             frappe.throw(_("Invalid 'current_search_fields'. All elements must be field name strings."))
# # # # #     elif search_fields_input is None:
# # # # #         return None
# # # # #     else:
# # # # #         print(f"ERROR (_parse_search_fields_input for {doctype_for_log}): Invalid type for current_search_fields. Got {type(search_fields_input)}")
# # # # #         frappe.throw(_("Invalid type for 'current_search_fields'."))
# # # # #     return None



# # # # def _parse_json_string_to_list(json_string: str | None, param_name: str, doctype_for_log: str) -> list | None:
# # # #     if json_string is None: return None
# # # #     if not isinstance(json_string, str): return None
# # # #     try:
# # # #         parsed_list = json.loads(json_string)
# # # #         if not isinstance(parsed_list, list): raise ValueError("Not a list")
# # # #         return parsed_list
# # # #     except (json.JSONDecodeError, ValueError):
# # # #         print(f"WARNING ({doctype_for_log}): Invalid JSON list for {param_name}: {json_string}")
# # # #         frappe.throw(_(f"Invalid JSON format for '{param_name}'."))
# # # #     return None

# # # # def _parse_filters_input(filters_input: str | list | dict | None, doctype_for_log: str) -> list:
# # # #     print(f"DEBUG (_parse_filters_input for {doctype_for_log}): Input type = {type(filters_input)}, Value = {filters_input}")
# # # #     if isinstance(filters_input, str):
# # # #         try: parsed = json.loads(filters_input)
# # # #         except json.JSONDecodeError: return []
# # # #     elif isinstance(filters_input, (list, dict)): parsed = filters_input
# # # #     else: return []

# # # #     if isinstance(parsed, list):
# # # #         if all(isinstance(item, list) for item in parsed): return parsed
# # # #         else: return parsed # Allow potentially mixed lists? Or validate stricter?
# # # #     elif isinstance(parsed, dict): return [[doctype_for_log, k, "=", v] for k, v in parsed.items()]
# # # #     return []

# # # # def _parse_search_fields_input(search_fields_input: str | list[str] | None, doctype_for_log: str) -> list[str] | None:
# # # #     print(f"DEBUG (_parse_search_fields_input for {doctype_for_log}): Input type = {type(search_fields_input)}, Value = {search_fields_input}")
# # # #     parsed_list = None
# # # #     if isinstance(search_fields_input, str):
# # # #         parsed_list = _parse_json_string_to_list(search_fields_input, "current_search_fields", doctype_for_log)
# # # #     elif isinstance(search_fields_input, list):
# # # #         parsed_list = search_fields_input

# # # #     if parsed_list is not None:
# # # #         if all(isinstance(f, str) for f in parsed_list): return parsed_list
# # # #         else: frappe.throw(_("Invalid 'current_search_fields'. Expected list of strings."))
# # # #     elif search_fields_input is not None: # Input was not None, but parsing failed or type wrong
# # # #         frappe.throw(_(f"Invalid type for 'current_search_fields': {type(search_fields_input)}."))
# # # #     return None # Input was None or successfully parsed as None


# # # # def _build_standard_filters(
# # # #     doctype: str,
# # # #     base_filters: list,
# # # #     search_term: str | None,
# # # #     global_search_fields: list[str] | None, # Fields for global search
# # # # ) -> tuple[list, list]:
# # # #     """Builds filters for standard global search (non-item search)."""
# # # #     print(f"\n--- DEBUG (_build_standard_filters for {doctype}) ---")
# # # #     and_filters = list(base_filters) # Start with base filters (column facets, etc.)
# # # #     or_filters = [] # For global search terms

# # # #     if search_term and global_search_fields:
# # # #         search_term_sql = f"%{search_term}%"
# # # #         effective_search_fields = set(global_search_fields)
# # # #         # Ensure 'name' is implicitly searched globally
# # # #         if "name" not in effective_search_fields:
# # # #             effective_search_fields.add("name")
# # # #             print(f"DEBUG (StdFilterBuilder): Implicitly added 'name' to global search")

# # # #         for field_name in effective_search_fields:
# # # #             if isinstance(field_name, str) and field_name.strip():
# # # #                 or_filters.append([doctype, field_name, "like", search_term_sql])
# # # #             else:
# # # #                 print(f"WARNING (StdFilterBuilder): Skipping invalid global search field: {field_name}")

# # # #         print(f"DEBUG (StdFilterBuilder): Generated OR conditions: {or_filters}")

# # # #     elif search_term and not global_search_fields: # Search term but no global fields = search name only
# # # #          print(f"WARNING (StdFilterBuilder): Search term '{search_term}' but no global fields. Defaulting to search 'name'.")
# # # #          and_filters.append([doctype, "name", "like", f"%{search_term}%"])

# # # #     print(f"DEBUG (StdFilterBuilder): Returning AND filters: {and_filters}")
# # # #     print(f"DEBUG (StdFilterBuilder): Returning OR filters: {or_filters}")
# # # #     print(f"--- END DEBUG (_build_standard_filters for {doctype}) ---\n")
# # # #     return and_filters, or_filters



# # # # # --- Main API Function ---
# # # # @frappe.whitelist(allow_guest=False)
# # # # def get_list_with_count_enhanced( # Renamed endpoint slightly
# # # #     doctype: str,
# # # #     fields: str | list[str],
# # # #     filters: str | list | dict | None = None, # Base filters (facets, static)
# # # #     order_by: str | None = None,
# # # #     limit_start: int | str = 0,
# # # #     limit_page_length: int | str | None = None,
# # # #     search_term: str | None = None,
# # # #     current_search_fields: str | list[str] | None = None, # Fields for GLOBAL search when is_item_search=False
# # # #     # --- NEW ---
# # # #     is_item_search: bool | str = False # Flag for special JSON item search
# # # # ) -> dict:

# # # #     print(f"\n--- API CALL: get_list_with_count_enhanced ---")
# # # #     print(f"ARGS: doctype='{doctype}', fields_arg_type={type(fields)}, filters_arg_type={type(filters)}, order_by='{order_by}'")
# # # #     print(f"PAGINATION: limit_start={limit_start}, limit_page_length={limit_page_length}")
# # # #     print(f"SEARCH: search_term='{search_term}', current_search_fields_arg_type='{type(current_search_fields)}', is_item_search={is_item_search}")

# # # #     # --- Parameter Validation & Permission Check ---
# # # #     if not frappe.db.exists("DocType", doctype):
# # # #         frappe.throw(_("Invalid DocType: {0}").format(doctype))
# # # #     if not frappe.has_permission(doctype, "read"):
# # # #         frappe.throw(_("Not permitted"), frappe.PermissionError)

# # # #     start = cint(limit_start)
# # # #     page_length = min(cint(limit_page_length or DEFAULT_PAGE_LENGTH), MAX_PAGE_LENGTH)
# # # #     is_item_search_bool = isinstance(is_item_search, str) and is_item_search.lower() == 'true' or is_item_search is True

# # # #     # --- Parse Inputs ---
# # # #     parsed_select_fields_str_list = _parse_search_fields_input(fields, doctype) or ["name"] # Default to ["name"] if fields missing
# # # #     if "name" not in parsed_select_fields_str_list:
# # # #         parsed_select_fields_str_list.insert(0, "name")
    
# # # #     parsed_base_filters_list = _parse_filters_input(filters, doctype)
    
# # # #     # This list is ONLY used for standard global search now
# # # #     parsed_global_search_fields = _parse_search_fields_input(current_search_fields, doctype)

# # # #     # --- Caching Key Generation ---
# # # #     # Include relevant search params in cache key
# # # #     cache_key_params = {
# # # #         "v_api": "3.0",
# # # #         "doctype": doctype,
# # # #         "fields": json.dumps(sorted(parsed_select_fields_str_list)),
# # # #         "filters": json.dumps(parsed_base_filters_list), # Base filters only
# # # #         "order_by": order_by or f"`tab{doctype}`.`modified` desc", # Use raw order_by here
# # # #         "start": start,
# # # #         "page_length": page_length,
# # # #         "search_term": search_term,
# # # #         "is_item_search": is_item_search_bool,
# # # #         "global_search_fields": json.dumps(sorted(parsed_global_search_fields)) if not is_item_search_bool and parsed_global_search_fields else None
# # # #     }
# # # #     cache_key_string = json.dumps(cache_key_params, sort_keys=True)
# # # #     cache_key = f"dt_enhanced_{doctype}_{hashlib.sha1(cache_key_string.encode()).hexdigest()}"
# # # #     print(f"DEBUG: Cache Key: {cache_key}")

# # # #     # --- Check Cache ---
# # # #     cached_result = frappe.cache().get_value(cache_key)
# # # #     if cached_result:
# # # #         print(f"DEBUG: Cache HIT for key: {cache_key}")
# # # #         # Basic validation of cached data
# # # #         if isinstance(cached_result, dict) and "data" in cached_result and "total_count" in cached_result:
# # # #              return cached_result
# # # #         else:
# # # #              print(f"WARNING: Invalid cached data for {cache_key}. Fetching fresh.")

# # # #     # --- Main Logic ---
# # # #     data = []
# # # #     total_records = 0

# # # #     try:
# # # #         if is_item_search_bool and search_term and doctype in JSON_ITEM_SEARCH_DOCTYPE_MAP:
# # # #             # --- Perform Item Search Workaround ---
# # # #             print("--- Executing Item Search Workaround ---")
# # # #             search_config = JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype]
# # # #             json_field = search_config["json_field"]
# # # #             item_path_parts = search_config["item_path"] # e.g., ["list", "*", "item"]

# # # #             # Construct PostgreSQL JSON path expression (adjust if path format differs)
# # # #             # Example: '$.list[*].item'
# # # #             json_path = f'$.{ ".".join(part if part != "*" else "[*]" for part in item_path_parts) }'
# # # #             # Use `like_regex` for case-insensitive partial matching within the JSON field value
# # # #             # Note: Ensure proper escaping if search_term contains regex special characters
# # # #             # For simple LIKE, jsonb_path_query_array->>0 might be needed on results
# # # #             # Using jsonb_path_exists for broader matching:
# # # #             jsonb_filter_expression = f"jsonb_path_exists(`tab{doctype}`.`{json_field}`::jsonb, '{json_path} ? (@ like_regex \"(?i).*{frappe.db.escape(search_term)}.*\")')"
            
# # # #             print(f"DEBUG (ItemSearch): JSON Field = {json_field}, JSON Path = {json_path}, JSONB Filter = {jsonb_filter_expression}")

# # # #             # Need to run raw query because frappe.get_list filters don't support JSON operators well
# # # #             # 1. Get count and names of matching parent documents (applying base filters)
# # # #             count_query = DatabaseQuery(doctype)
# # # #             count_query.filters = parsed_base_filters_list # Apply base filters like status, facets
# # # #             count_query.conditions.append(jsonb_filter_expression) # Add the raw JSON condition

# # # #             # Apply permission conditions
# # # #             count_query.build_match_conditions()
# # # #             count_conditions_sql = " AND ".join(count_query.conditions) if count_query.conditions else "1=1"
            
# # # #             sql_query_args = count_query.get_query_parameters()

# # # #             count_sql = f"""
# # # #                 SELECT count(distinct `tab{doctype}`.`name`) as total_count
# # # #                 FROM `tab{doctype}`
# # # #                 WHERE {count_conditions_sql}
# # # #             """
            
# # # #             name_sql = f"""
# # # #                  SELECT distinct `tab{doctype}`.`name`
# # # #                  FROM `tab{doctype}`
# # # #                  WHERE {count_conditions_sql}
# # # #                  -- We get all matching names first, then apply pagination in the second query
# # # #             """
            
# # # #             print(f"DEBUG (ItemSearch): Count SQL: {count_sql}")
# # # #             print(f"DEBUG (ItemSearch): Name SQL: {name_sql}")
# # # #             print(f"DEBUG (ItemSearch): SQL Args: {sql_query_args}")

# # # #             count_result = frappe.db.sql(count_sql, sql_query_args, as_dict=True)
# # # #             total_records = count_result[0].get("total_count", 0) if count_result else 0
# # # #             print(f"DEBUG (ItemSearch): Found {total_records} potential matching parent records.")

# # # #             if total_records > 0:
# # # #                 matching_names_result = frappe.db.sql(name_sql, sql_query_args, as_list=True)
# # # #                 matching_names = [row[0] for row in matching_names_result]

# # # #                 # 2. Fetch full data for the matching names with pagination
# # # #                 data_filters = parsed_base_filters_list + [["name", "in", matching_names]]
                
# # # #                 # Use reportview_execute (DatabaseQuery) for the final fetch with pagination
# # # #                 formatted_order_by = order_by or f"`tab{doctype}`.`modified` desc" # Apply original sorting
# # # #                 if order_by and not order_by.startswith(f"`tab{doctype}`") and not order_by.startswith("`tab"):
# # # #                     parts = order_by.split(" ")
# # # #                     field_part = parts[0].strip("`")
# # # #                     sort_order_part = parts[1] if len(parts) > 1 else "desc"
# # # #                     formatted_order_by = f"`tab{doctype}`.`{field_part}` {sort_order_part}"

# # # #                 data_args = frappe._dict({
# # # #                     "doctype": doctype,
# # # #                     "fields": parsed_select_fields_str_list,
# # # #                     "filters": data_filters,
# # # #                     "order_by": formatted_order_by,
# # # #                     "limit_start": start,
# # # #                     "limit_page_length": page_length,
# # # #                     "ignore_permissions": False, # Keep permission checks
# # # #                     "strict": False
# # # #                 })
# # # #                 print(f"DEBUG (ItemSearch): Calling reportview_execute for final data fetch with args: {data_args}")
# # # #                 data = reportview_execute(**data_args)
# # # #             else:
# # # #                 data = [] # No matching names found
            
# # # #             print(f"--- Finished Item Search Workaround ---")

# # # #         else:
# # # #             # --- Perform Standard Global Search ---
# # # #             print("--- Executing Standard Global Search ---")
# # # #             std_and_filters, std_or_filters = _build_standard_filters(
# # # #                 doctype=doctype,
# # # #                 base_filters=parsed_base_filters_list,
# # # #                 search_term=search_term,
# # # #                 global_search_fields=parsed_global_search_fields
# # # #             )
            
# # # #             formatted_order_by = order_by or f"`tab{doctype}`.`modified` desc"
# # # #             if order_by and not order_by.startswith(f"`tab{doctype}`") and not order_by.startswith("`tab"):
# # # #                  parts = order_by.split(" ")
# # # #                  field_part = parts[0].strip("`")
# # # #                  sort_order_part = parts[1] if len(parts) > 1 else "desc"
# # # #                  formatted_order_by = f"`tab{doctype}`.`{field_part}` {sort_order_part}"
            
# # # #             # Prepare args for DatabaseQuery / reportview_execute
# # # #             data_args = frappe._dict({
# # # #                 "doctype": doctype,
# # # #                 "fields": parsed_select_fields_str_list,
# # # #                 "filters": std_and_filters, # Only AND filters go here
# # # #                 "or_filters": std_or_filters, # OR filters for global search term go here
# # # #                 "order_by": formatted_order_by,
# # # #                 "limit_start": start,
# # # #                 "limit_page_length": page_length,
# # # #                 "ignore_permissions": False,
# # # #                 "strict": False,
# # # #             })
            
# # # #             count_args = {
# # # #                 "filters": std_and_filters,
# # # #                 "or_filters": std_or_filters,
# # # #                 "fields": [f"count(distinct `tab{doctype}`.`name`) as total_count"]
# # # #             }

# # # #             print(f"DEBUG (StandardSearch): Calling reportview_execute with args: {data_args}")
# # # #             data = reportview_execute(**data_args)
            
# # # #             print(f"DEBUG (StandardSearch): Calling DatabaseQuery for count with args: {count_args}")
# # # #             count_result = DatabaseQuery(doctype).execute(**count_args)
# # # #             total_records = count_result[0].get("total_count") if count_result else 0
            
# # # #             print("--- Finished Standard Global Search ---")

# # # #         # --- Prepare and Cache Result ---
# # # #         final_result = {"data": data, "total_count": total_records}
# # # #         frappe.cache().set_value(cache_key, final_result, expires_in_sec=CACHE_EXPIRY)
# # # #         print(f"DEBUG: Result stored in cache with key: {cache_key}")

# # # #         return final_result

# # # #     except frappe.PermissionError:
# # # #         print("ERROR: PermissionError caught")
# # # #         raise
# # # #     except Exception as e:
# # # #         print(f"ERROR: Final Exception caught: {type(e).__name__} - {str(e)}")
# # # #         print("--- FINAL TRACEBACK START (API) ---")
# # # #         traceback.print_exc()
# # # #         print("--- FINAL TRACEBACK END (API) ---")
# # # #         frappe.throw(_("An error occurred: {0}").format(str(e)))


# # # # # --- Main API Function ---
# # # # # @frappe.whitelist(allow_guest=False)
# # # # # def get_list_with_count_via_reportview_logic(
# # # # #     doctype: str,
# # # # #     fields: str | list[str],
# # # # #     filters: str | list | dict | None = None,
# # # # #     order_by: str | None = None,
# # # # #     limit_start: int | str = 0,
# # # # #     limit_page_length: int | str | None = None,
# # # # #     search_term: str | None = None,
# # # # #     current_search_fields: str | list[str] | None = None, # List of fields to search in
# # # # #     is_global_search: bool | str = False # Boolean flag
# # # # # ) -> dict:

# # # # #     print(f"\n--- API CALL (via ReportView Logic): get_list_with_count_via_reportview_logic ---")
# # # # #     print(f"ARGS: doctype='{doctype}', fields_arg_type={type(fields)}, filters_arg_type={type(filters)}, order_by='{order_by}'")
# # # # #     print(f"PAGINATION: limit_start={limit_start}, limit_page_length={limit_page_length}")
# # # # #     print(f"SEARCH: search_term='{search_term}', current_search_fields_arg_type='{type(current_search_fields)}', value='{current_search_fields}', is_global_search={is_global_search}")

# # # # #     try:
# # # # #         if not frappe.has_permission(doctype, "read"):
# # # # #             frappe.throw(_("Not permitted"), frappe.PermissionError)

# # # # #         start = cint(limit_start)
# # # # #         page_length = min(cint(limit_page_length or DEFAULT_PAGE_LENGTH), MAX_PAGE_LENGTH)

# # # # #         parsed_select_fields_str_list: list[str]
# # # # #         if isinstance(fields, str):
# # # # #             parsed_list = _parse_json_string_to_list(fields, "fields", doctype)
# # # # #             if parsed_list is None or not all(isinstance(f, str) for f in parsed_list):
# # # # #                 frappe.throw(_("'fields' must be a list of strings."))
# # # # #             parsed_select_fields_str_list = parsed_list
# # # # #         elif isinstance(fields, list):
# # # # #             if not all(isinstance(f, str) for f in fields):
# # # # #                 frappe.throw(_("'fields' list must contain only strings."))
# # # # #             parsed_select_fields_str_list = fields
# # # # #         else:
# # # # #             frappe.throw(_("'fields' must be a list or a valid JSON string of a list of strings."))
        
# # # # #         if "name" not in parsed_select_fields_str_list:
# # # # #             parsed_select_fields_str_list.insert(0, "name")
# # # # #         print(f"DEBUG: Parsed select_fields for reportview: {parsed_select_fields_str_list}")

# # # # #         # Parse base filters
# # # # #         parsed_base_filters_list = _parse_filters_input(filters, doctype)
# # # # #         print(f"DEBUG: Parsed parsed_base_filters_list: {parsed_base_filters_list}")
        
# # # # #         # Parse current_search_fields
# # # # #         active_search_fields_list = _parse_search_fields_input(current_search_fields, doctype)
        
# # # # #         is_global_bool = isinstance(is_global_search, str) and is_global_search.lower() == 'true' or is_global_search is True

# # # # #         # Build the final list of filters for DatabaseQuery
# # # # #         # final_query_filters = _build_reportview_compatible_filters(
# # # # #         #     doctype=doctype,
# # # # #         #     base_filters=parsed_base_filters_list,
# # # # #         #     search_term=search_term,
# # # # #         #     search_in_fields=active_search_fields_list,
# # # # #         #     is_global_search_flag=is_global_bool
# # # # #         # )
# # # # #         # print(f"DEBUG: Final constructed filters for DatabaseQuery: {final_query_filters}")

# # # # #         search_conditions_for_or_filters = [] # For global search, to be ORed
# # # # #         search_conditions_for_and_filters = [] # For specific search, to be ANDed with base_filters

# # # # #         if search_term and active_search_fields_list:
# # # # #             search_term_sql = f"%{search_term}%"
            
# # # # #             # Ensure 'name' is considered for search
# # # # #             effective_search_fields_for_term = set(active_search_fields_list)
# # # # #             if "name" not in effective_search_fields_for_term:
# # # # #                 # If 'name' wasn't in the list, add it to the set we iterate over for this search term
# # # # #                 effective_search_fields_for_term.add("name")
# # # # #                 print(f"DEBUG: Implicitly considering 'name' for search term '{search_term}'")

# # # # #             for field_name in effective_search_fields_for_term:
# # # # #                 if isinstance(field_name, str) and field_name.strip():
# # # # #                     condition = [doctype, field_name, "like", search_term_sql]
# # # # #                     if is_global_bool:
# # # # #                         search_conditions_for_or_filters.append(condition)
# # # # #                     else: # Specific search
# # # # #                         search_conditions_for_and_filters.append(condition)
# # # # #                     print(f"DEBUG: Generated search condition for '{field_name}': {condition} (Global: {is_global_bool})")
# # # # #                 else:
# # # # #                     print(f"WARNING: Skipping invalid field_name '{field_name}' in current_search_fields")
        
# # # # #         elif search_term and not active_search_fields_list: # Search term, no fields specified
# # # # #             print(f"WARNING: Search term '{search_term}' but no current_search_fields. Defaulting to search 'name'.")
# # # # #             search_conditions_for_and_filters.append([doctype, "name", "like", f"%{search_term}%"])

# # # # #         # Combine base_filters with specific_search_filters (which are ANDed)
# # # # #         final_and_filters = parsed_base_filters_list + search_conditions_for_and_filters
# # # # #         # The search_conditions_for_or_filters will be passed to `or_filters` if global search
        
# # # # #         final_or_filters = search_conditions_for_or_filters if is_global_bool and search_conditions_for_or_filters else []

# # # # #         print(f"DEBUG: Final AND_filters for DatabaseQuery: {final_and_filters}")
# # # # #         print(f"DEBUG: Final OR_filters for DatabaseQuery: {final_or_filters}")

# # # # #         formatted_order_by = order_by or f"`tab{doctype}`.`modified` desc"
# # # # #         if order_by and not order_by.startswith(f"`tab{doctype}`") and not order_by.startswith("`tab"): # check if not already prefixed
# # # # #             parts = order_by.split(" ")
# # # # #             field_part = parts[0].strip("`") # Sanitize field part
# # # # #             sort_order_part = parts[1] if len(parts) > 1 else "desc"
# # # # #             formatted_order_by = f"`tab{doctype}`.`{field_part}` {sort_order_part}"
# # # # #         print(f"DEBUG: Formatted order_by for reportview: {formatted_order_by}")

# # # # #         # --- Caching Setup ---
# # # # #         cache_key_params = {
# # # # #             "v_adapter": "2.0", # Increment version if logic changes significantly
# # # # #             "doctype": doctype,
# # # # #             "fields": json.dumps(sorted(parsed_select_fields_str_list)),
# # # # #             # "filters": json.dumps(final_query_filters), # Ensure stable order for dicts if filters can be dicts
# # # # #             "filters": json.dumps(final_and_filters), "or_filters": json.dumps(final_or_filters),
# # # # #             "order_by": formatted_order_by,
# # # # #             "start": start,
# # # # #             "page_length": page_length,
# # # # #         }
# # # # #         cache_key_string = json.dumps(cache_key_params, sort_keys=True)
# # # # #         cache_key = f"dt_adapter_{doctype}_{hashlib.sha1(cache_key_string.encode()).hexdigest()}"
# # # # #         print(f"DEBUG: Cache Key: {cache_key}")

# # # # #         cached_result = frappe.cache().get_value(cache_key)
# # # # #         if cached_result:
# # # # #             print(f"DEBUG: Cache HIT for key: {cache_key}")
# # # # #             if isinstance(cached_result, dict) and "data" in cached_result and "total_count" in cached_result:
# # # # #                  return cached_result
# # # # #             else:
# # # # #                  print(f"WARNING: Invalid cached data for {cache_key}. Fetching fresh.")

# # # # #         # --- Prepare arguments for reportview_execute (which is DatabaseQuery) ---
# # # # #         data_args = frappe._dict({
# # # # #             "doctype": doctype,
# # # # #             "fields": parsed_select_fields_str_list,
# # # # #             # "filters": final_query_filters,
# # # # #             "filters": json.dumps(final_and_filters),
# # # # #             "or_filters": json.dumps(final_or_filters),
# # # # #             "order_by": formatted_order_by,
# # # # #             "limit_start": start, # Renamed for DatabaseQuery
# # # # #             "limit_page_length": page_length, # Renamed for DatabaseQuery
# # # # #             "ignore_permissions": False,
# # # # #             "strict": False,
# # # # #         })
        
# # # # #         print(f"DEBUG: Calling reportview_execute (DatabaseQuery) with args: {data_args}")
# # # # #         data_list = reportview_execute(**data_args)
        
# # # # #         # Count Query
# # # # #         # count_db_query = DatabaseQuery(doctype)
# # # # #         # count_db_query.filters = final_query_filters
# # # # #         # count_result = count_db_query.execute(fields=[f"count(distinct `tab{doctype}`.`name`) as total_count"])
# # # # #         # total_records = count_result[0].get("total_count") if count_result else 0
        
# # # # #         # print(f"DEBUG: Data from reportview_execute: {len(data_list)} records")
# # # # #         # print(f"DEBUG: Total records from count: {total_records}")
# # # # #         count_db_query_args = {
# # # # #             # "doctype": doctype,
# # # # #             "filters": final_and_filters,
# # # # #             "or_filters": final_or_filters,
# # # # #             "fields": [f"count(distinct `tab{doctype}`.`name`) as total_count"] # Important for correct count
# # # # #         }
# # # # #         print(f"DEBUG: Calling DatabaseQuery for count with args: {count_db_query_args}")
# # # # #         count_result = DatabaseQuery(doctype).execute(**count_db_query_args)
# # # # #         total_records = count_result[0].get("total_count") if count_result else 0
        
# # # # #         print(f"DEBUG: Data from reportview_execute: {len(data_list)} records")
# # # # #         print(f"DEBUG: Total records from count: {total_records}")
        
# # # # #         final_result = {"data": data_list, "total_count": total_records}
        
# # # # #         frappe.cache().set_value(cache_key, final_result, expires_in_sec=CACHE_EXPIRY)
# # # # #         print(f"DEBUG: Result stored in cache with key: {cache_key}")

# # # # #         return final_result

# # # # #     except frappe.PermissionError:
# # # # #         print("ERROR: PermissionError caught")
# # # # #         raise
# # # # #     except Exception as e:
# # # # #         print(f"ERROR: Final Exception caught: {type(e).__name__} - {str(e)}")
# # # # #         print("--- FINAL TRACEBACK START (API) ---")
# # # # #         traceback.print_exc()
# # # # #         print("--- FINAL TRACEBACK END (API) ---")
# # # # #         frappe.throw(_("An error occurred: {0}").format(str(e)))



# # # # def _build_reportview_compatible_filters(
# # # #     doctype: str,
# # # #     base_filters: list, # Already parsed list of lists
# # # #     search_term: str | None,
# # # #     search_in_fields: list[str] | None, # Parsed list of fields to search in
# # # #     is_global_search_flag: bool
# # # # ) -> list:
# # # #     """
# # # #     Builds filters compatible with DatabaseQuery/reportview_execute.
# # # #     Bypasses frappe.get_meta() for search field validation.
# # # #     """
# # # #     print(f"\n--- DEBUG (_build_reportview_compatible_filters for {doctype}) ---")
# # # #     print(f"Input: base_filters={base_filters}, search_term='{search_term}', search_in_fields={search_in_fields}, is_global_search_flag={is_global_search_flag}")

# # # #     # Start with a mutable copy of base_filters
# # # #     query_filters_list = list(base_filters) if base_filters else []
# # # #     print(f"DEBUG (FilterBuilder): Initial query_filters_list from base_filters = {query_filters_list}")

# # # #     if search_term and search_in_fields and len(search_in_fields) > 0:
# # # #         search_term_sql = f"%{search_term}%"
# # # #         current_search_conditions = []
        
# # # #         # Ensure 'name' is included in search if term exists, and not already explicitly in search_in_fields
# # # #         # This is a common expectation for usability.
# # # #         effective_search_fields = set(search_in_fields)
# # # #         if "name" not in effective_search_fields:
# # # #             print(f"DEBUG (FilterBuilder): Implicitly adding 'name' to search conditions for '{search_term}'")
# # # #             current_search_conditions.append([doctype, "name", "like", search_term_sql])
        
# # # #         for field_name in search_in_fields:
# # # #             # Skip if 'name' was already added implicitly and also in the list explicitly
# # # #             if field_name == "name" and "name" not in effective_search_fields:
# # # #                 continue

# # # #             if isinstance(field_name, str) and field_name.strip():
# # # #                 current_search_conditions.append([doctype, field_name, "like", search_term_sql])
# # # #                 print(f"DEBUG (FilterBuilder): Added search condition for field '{field_name}'")
# # # #             else:
# # # #                 print(f"WARNING (FilterBuilder): Skipping invalid field name '{field_name}' in search_in_fields.")
        
# # # #         if not current_search_conditions:
# # # #             print(f"WARNING (FilterBuilder): No valid search conditions generated for term '{search_term}' and fields {search_in_fields}")
# # # #         elif is_global_search_flag:
# # # #             # For global search, this OR block is ANDed with existing base filters
# # # #             if len(current_search_conditions) == 1:
# # # #                 # If only one effective global search field, treat it as an AND condition
# # # #                 query_filters_list.extend(current_search_conditions)
# # # #                 print(f"DEBUG (FilterBuilder): Added single global search condition as AND: {query_filters_list}")
# # # #             else:
# # # #                 # Multiple global search fields, create an OR block
# # # #                 or_block = ["or"] + current_search_conditions
# # # #                 query_filters_list.append(or_block) # Append the OR block as one item
# # # #                 print(f"DEBUG (FilterBuilder): Appended global search OR block: {query_filters_list}")
# # # #         else: # Specific search
# # # #             query_filters_list.extend(current_search_conditions) # Add as AND conditions
# # # #             print(f"DEBUG (FilterBuilder): Added specific search AND conditions: {query_filters_list}")

# # # #     elif search_term and (not search_in_fields or len(search_in_fields) == 0):
# # # #          print(f"WARNING (FilterBuilder): Search term '{search_term}' provided but no search_in_fields. Defaulting to search 'name' only.")
# # # #          search_term_sql = f"%{search_term}%"
# # # #          query_filters_list.append([doctype, "name", "like", search_term_sql])

# # # #     print(f"DEBUG (FilterBuilder): Final query_filters_list being returned: {query_filters_list}")
# # # #     print(f"--- END DEBUG (_build_reportview_compatible_filters for {doctype}) ---\n")
# # # #     return query_filters_list




# # # # # ________________________________ Version 3 (Using Frappe's built-in Report View) ___________________________________


# # # # # /workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/api/data-table.py

# # # # # import frappe
# # # # # from frappe import _
# # # # # from frappe.utils import cint
# # # # # import json
# # # # # import traceback
# # # # # import hashlib

# # # # # from frappe.model.db_query import DatabaseQuery

# # # # # # --- Import necessary functions from reportview ---
# # # # # # We will call these functions as if we are reportview itself.
# # # # # # This means we need to prepare arguments exactly as reportview expects them.
# # # # # from frappe.desk.reportview import get_form_params as reportview_get_form_params
# # # # # from frappe.desk.reportview import execute as reportview_execute # This is DatabaseQuery(doctype).execute()
# # # # # from frappe.desk.reportview import get_count as reportview_get_count_logic # The logic part, not the whitelisted endpoint
# # # # # from frappe.desk.reportview import compress as reportview_compress_data

# # # # # # Define constants
# # # # # DEFAULT_PAGE_LENGTH = 10
# # # # # MAX_PAGE_LENGTH = 2000
# # # # # CACHE_EXPIRY = 300 # 5 minutes

# # # # # @frappe.whitelist(allow_guest=False)
# # # # # def get_list_with_count_via_reportview_logic(
# # # # #     doctype: str,
# # # # #     fields: str | list[str], # Simple list of field names from frontend, e.g., ["item_name", "category"]
# # # # #     filters: str | list | dict | None = None, # Base filters from frontend
# # # # #     order_by: str | None = None, # e.g., "creation desc" (simple field name)
# # # # #     limit_start: int | str = 0,
# # # # #     limit_page_length: int | str | None = None,
# # # # #     search_term: str | None = None,
# # # # #     # search_fields: str | list[str] | None = None, # For non-global - will be used to build filters
# # # # #     # global_search: bool | str = False, # Flag
# # # # #     # global_search_fields: str | list[str] | None = None # For global - will be used to build filters
# # # # #     # --- CONSOLIDATED SEARCH PARAMS ---
# # # # #     # The frontend hook (useServerDataTable) will now always send:
# # # # #     # - search_term: The string to search for.
# # # # #     # - is_global_search: Boolean true/false.
# # # # #     # - current_search_fields: A list of field names to search in.
# # # # #     #   - If global, this list comes from component config (e.g., globalSearchFieldList).
# # # # #     #   - If specific, this list contains [defaultSearchFieldFromHook].
# # # # #     current_search_fields: str | list[str] | None = None, # List of fields to search in
# # # # #     is_global_search: bool | str = False # Boolean flag
# # # # # ) -> dict:

# # # # #     print(f"\n--- API CALL (via ReportView Logic): get_list_with_count_via_reportview_logic ---")
# # # # #     print(f"ARGS: doctype='{doctype}', fields_arg_type={type(fields)}, filters_arg_type={type(filters)}, order_by='{order_by}'")
# # # # #     print(f"PAGINATION: limit_start={limit_start}, limit_page_length={limit_page_length}")
# # # # #     print(f"SEARCH: search_term='{search_term}', current_search_fields_arg='{current_search_fields}', is_global_search={is_global_search}")

# # # # #     try:
# # # # #         if not frappe.has_permission(doctype, "read"):
# # # # #             frappe.throw(_("Not permitted"), frappe.PermissionError)

# # # # #         # --- Prepare parameters for reportview functions ---
# # # # #         # 1. Basic pagination and doctype
# # # # #         start = cint(limit_start)
# # # # #         page_length = min(cint(limit_page_length or DEFAULT_PAGE_LENGTH), MAX_PAGE_LENGTH)

# # # # #         # 2. Fields: reportview expects fields to be prefixed, e.g., "`tabMyDocType`.`my_field`"
# # # # #         #    However, the `DatabaseQuery` called by `reportview_execute` can often handle simple names too.
# # # # #         #    Let's try with simple names first, as your original `frappe.get_list` call used them.
# # # # #         #    If errors occur related to field names, we might need to prefix them here.
# # # # #         parsed_select_fields: list[str]
# # # # #         if isinstance(fields, str):
# # # # #             try:
# # # # #                 parsed_select_fields = json.loads(fields)
# # # # #             except json.JSONDecodeError:
# # # # #                 frappe.throw(_("Invalid 'fields' JSON format."))
# # # # #         elif isinstance(fields, list):
# # # # #             parsed_select_fields = fields
# # # # #         else:
# # # # #             frappe.throw(_("'fields' must be a list or a valid JSON string of a list."))

# # # # #         if not all(isinstance(f, str) for f in parsed_select_fields):
# # # # #             frappe.throw(_("'fields' must be a list of strings."))
        
# # # # #         # Ensure 'name' is always fetched if not explicitly requested by frontend for linking/keys
# # # # #         # reportview.get often adds standard fields by default if '*' is used, but explicit is safer.
# # # # #         if "name" not in parsed_select_fields:
# # # # #             parsed_select_fields.insert(0, "name")
        
# # # # #         print(f"DEBUG: Parsed select_fields for reportview: {parsed_select_fields}")

# # # # #         # 3. Filters: Combine base filters and search filters
# # # # #         final_filters_list = []
# # # # #         # Parse base filters (from frontend column filters)
# # # # #         if filters:
# # # # #             parsed_base_filters = parse_filters(filters, doctype) # Your existing helper
# # # # #             if isinstance(parsed_base_filters, list):
# # # # #                 final_filters_list.extend(parsed_base_filters)
# # # # #             elif isinstance(parsed_base_filters, dict): # Convert dict to list of lists
# # # # #                 for k, v in parsed_base_filters.items():
# # # # #                     # Assuming simple equality for dict filters
# # # # #                     final_filters_list.append([doctype, k, "=", v])
        
# # # # #         # Parse current_search_fields (list of fields to search in)
# # # # #         active_search_fields_list: list[str] | None = None
# # # # #         if isinstance(current_search_fields, str):
# # # # #             try:
# # # # #                 active_search_fields_list = json.loads(current_search_fields)
# # # # #             except json.JSONDecodeError:
# # # # #                 print(f"WARNING: Invalid JSON for current_search_fields: {current_search_fields}")
# # # # #         elif isinstance(current_search_fields, list):
# # # # #             active_search_fields_list = current_search_fields
        
# # # # #         if not active_search_fields_list or not all(isinstance(f, str) for f in active_search_fields_list):
# # # # #             active_search_fields_list = None # Reset if malformed


# # # # #         # Convert is_global_search to boolean
# # # # #         is_global = isinstance(is_global_search, str) and is_global_search.lower() == 'true' or is_global_search is True


# # # # #         # Build search filter conditions
# # # # #         if search_term and active_search_fields_list:
# # # # #             search_term_sql = f"%{search_term}%"
# # # # #             search_conditions = []
            
# # # # #             # Always try to include 'name' in search if not already specified and search term exists
# # # # #             # This helps when specific search field is not 'name' but user expects 'name' to be searchable
# # # # #             temp_active_search_fields = set(active_search_fields_list)
# # # # #             if "name" not in temp_active_search_fields:
# # # # #                 print(f"DEBUG: Adding 'name' to search conditions for '{search_term}' for {doctype}")
# # # # #                 search_conditions.append([doctype, "name", "like", search_term_sql])

# # # # #             for field_name in active_search_fields_list:
# # # # #                 if field_name == "name" and "name" in temp_active_search_fields: # Already handled or will be
# # # # #                     if "name" not in temp_active_search_fields: continue # skip if already implicitly added
                
# # # # #                 # WORKAROUND: Directly add filter, assume field is valid and searchable
# # # # #                 # This bypasses meta.has_field which is problematic
# # # # #                 if isinstance(field_name, str) and field_name.strip():
# # # # #                     search_conditions.append([doctype, field_name, "like", search_term_sql])
# # # # #                 else:
# # # # #                     print(f"WARNING: Skipping invalid field_name '{field_name}' in current_search_fields")
            
# # # # #             if search_conditions:
# # # # #                 if is_global: # If global search, wrap these in an "or"
# # # # #                     final_filters_list.append(["or"] + search_conditions)
# # # # #                 else: # If specific search, they are effectively ANDed
# # # # #                     final_filters_list.extend(search_conditions)
        
# # # # #         elif search_term and not active_search_fields_list: # Search term exists but no fields specified
# # # # #             print(f"WARNING: Search term '{search_term}' provided but no current_search_fields. Defaulting to search 'name'.")
# # # # #             final_filters_list.append([doctype, "name", "like", f"%{search_term}%"])


# # # # #         print(f"DEBUG: Final constructed filters for reportview: {final_filters_list}")

# # # # #         # 4. Order By: reportview expects it like "`tabDoctype`.`field` desc"
# # # # #         # Your frontend hook should ideally send it in this format, or we adapt here.
# # # # #         # For now, let's assume simple field names from frontend and prefix.
# # # # #         # If `order_by` is already prefixed, this might double-prefix. Be careful.
# # # # #         formatted_order_by = order_by or f"`tab{doctype}`.`modified` desc"
# # # # #         if order_by and not order_by.startswith(f"`tab{doctype}`"):
# # # # #             # Basic prefixing, assuming order_by is "field_name sort_order"
# # # # #             parts = order_by.split(" ")
# # # # #             field_part = parts[0]
# # # # #             sort_order_part = parts[1] if len(parts) > 1 else "desc"
# # # # #             formatted_order_by = f"`tab{doctype}`.`{field_part}` {sort_order_part}"
        
# # # # #         print(f"DEBUG: Formatted order_by for reportview: {formatted_order_by}")


# # # # #         # --- Caching Setup (similar to before) ---
# # # # #         cache_key_params = {
# # # # #             "v_reportview_adapter": "1.0", # Version key for this adapter logic
# # # # #             "doctype": doctype,
# # # # #             "fields": json.dumps(sorted(parsed_select_fields)),
# # # # #             "filters": json.dumps(final_filters_list, sort_keys=True), # Assuming list of lists
# # # # #             "order_by": formatted_order_by,
# # # # #             "start": start,
# # # # #             "page_length": page_length,
# # # # #             # "with_comment_count": True # Often default in reportview
# # # # #         }
# # # # #         cache_key_string = json.dumps(cache_key_params, sort_keys=True)
# # # # #         cache_key = f"rv_adapter_{doctype}_{hashlib.sha1(cache_key_string.encode()).hexdigest()}"
# # # # #         print(f"DEBUG: Cache Key (ReportView Adapter): {cache_key}")

# # # # #         cached_result = frappe.cache().get_value(cache_key)
# # # # #         if cached_result:
# # # # #             print(f"DEBUG: Cache HIT (ReportView Adapter) for key: {cache_key}")
# # # # #             if isinstance(cached_result, dict) and "data" in cached_result and "total_count" in cached_result:
# # # # #                  return cached_result
# # # # #             else:
# # # # #                  print(f"WARNING: Invalid cached data for {cache_key}. Fetching fresh.")


# # # # #         # --- Prepare arguments for reportview_execute and reportview_get_count_logic ---
# # # # #         # These args mimic what `get_form_params` in reportview.py would produce
# # # # #         # after its internal parsing and validation (which we are partially bypassing/reimplementing).
        
# # # # #         # For Data
# # # # #         data_args = frappe._dict({
# # # # #             "doctype": doctype,
# # # # #             "fields": parsed_select_fields, # List of simple field names
# # # # #             "filters": final_filters_list,   # List of filter conditions
# # # # #             "order_by": formatted_order_by,
# # # # #             "start": start,
# # # # #             "page_length": page_length,
# # # # #             "ignore_permissions": False, # reportview typically respects permissions
# # # # #             "strict": False, # Consistent with your previous setup
# # # # #             # "with_comment_count": True, # reportview.get often adds this implicitly or via param
# # # # #         })

# # # # #         # For Count
# # # # #         count_args = frappe._dict({
# # # # #             "doctype": doctype,
# # # # #             "fields": [f"`tab{doctype}`.name"], # reportview_get_count_logic uses this
# # # # #             "filters": final_filters_list,
# # # # #             # reportview_get_count_logic nullifies order_by for count
# # # # #         })

# # # # #         # --- Call the core reportview logic ---
# # # # #         # Note: `reportview_execute` is `DatabaseQuery(doctype).execute(**args)`
# # # # #         # This is the same underlying call as `frappe.get_list`
# # # # #         # If the AttributeError was in DatabaseQuery due to bad meta, it might still occur.
# # # # #         # The hope is that reportview's default field handling or how it sets up DatabaseQuery
# # # # #         # might be more resilient to the `meta.has_field("name") == False` issue.
        
# # # # #         print(f"DEBUG: Calling reportview_execute with args: {data_args}")
# # # # #         data_list = reportview_execute(**data_args) # This returns a list of dicts
        
# # # # #         print(f"DEBUG: Calling reportview_get_count_logic with args: {count_args}")
# # # # #         # The `reportview_get_count_logic` is a bit more complex, let's simplify by calling its core
# # # # #         # We need to construct args as it expects after its internal `get_form_params`
        
# # # # #         # Simplified count - directly use DatabaseQuery as reportview.get_count ultimately does
# # # # #         # This avoids replicating all of reportview.get_count's internal arg parsing.
# # # # #         count_db_query = DatabaseQuery(doctype)
# # # # #         count_db_query.filters = final_filters_list # Apply the same filters
# # # # #         # The distinct count is on `name`
# # # # #         count_result = count_db_query.execute(fields=[f"count(distinct `tab{doctype}`.`name`) as total_count"])
# # # # #         total_records = count_result[0].get("total_count") if count_result else 0
        
# # # # #         print(f"DEBUG: Data from reportview_execute: {len(data_list)} records")
# # # # #         print(f"DEBUG: Total records from count: {total_records}")
        
# # # # #         # The `reportview.get` endpoint usually returns a compressed format {keys: [], values: []}
# # # # #         # Your frontend hook expects {data: [], total_count: number}
# # # # #         # `data_list` from `reportview_execute` is already list of dicts.

# # # # #         final_result = {"data": data_list, "total_count": total_records}
        
# # # # #         frappe.cache().set_value(cache_key, final_result, expires_in_sec=CACHE_EXPIRY)
# # # # #         print(f"DEBUG: Result stored in cache (ReportView Adapter) with key: {cache_key}")

# # # # #         return final_result

# # # # #     except frappe.PermissionError:
# # # # #         print("ERROR: PermissionError caught")
# # # # #         raise
# # # # #     except Exception as e:
# # # # #         print(f"ERROR: Final Exception caught: {type(e).__name__} - {str(e)}")
# # # # #         print("--- FINAL TRACEBACK START (ReportView Adapter) ---")
# # # # #         traceback.print_exc()
# # # # #         print("--- FINAL TRACEBACK END (ReportView Adapter) ---")
# # # # #         # frappe.log_error(traceback.format_exc(), f"API Error (via ReportView) (DocType: {doctype})")
# # # # #         frappe.throw(_("An error occurred (via ReportView adapter): {0}").format(str(e)))

# # # # # # Keep your parse_filters and parse_search_fields (now used for current_search_fields) helpers

# # # # # # --- Helper Functions (Modified for print debugging) ---

# # # # # def parse_filters(filters_input: str | list | dict | None, doctype_for_log: str) -> list | dict:
# # # # #     print(f"DEBUG (parse_filters for {doctype_for_log}): Input type = {type(filters_input)}, Value = {filters_input}")
# # # # #     if isinstance(filters_input, str):
# # # # #         try:
# # # # #             parsed = json.loads(filters_input)
# # # # #             print(f"DEBUG (parse_filters for {doctype_for_log}): Parsed from JSON string = {parsed}")
# # # # #             return parsed
# # # # #         except json.JSONDecodeError:
# # # # #             # Simplified: Assume if string and not valid JSON, it's an error or needs specific handling not yet implemented
# # # # #             print(f"WARNING (parse_filters for {doctype_for_log}): JSONDecodeError for string filters. String was: '{filters_input}'. Returning empty dict.")
# # # # #             # Consider frappe.throw if string filters should always be valid JSON
# # # # #             return {}
# # # # #     parsed_val = filters_input or {}
# # # # #     print(f"DEBUG (parse_filters for {doctype_for_log}): Returning directly or as empty dict = {parsed_val}")
# # # # #     return parsed_val

# # # # # def parse_search_fields(search_fields_input: str | list[str] | None, doctype_for_log: str) -> list[str] | None:
# # # # #     print(f"DEBUG (parse_search_fields for {doctype_for_log}): Input type = {type(search_fields_input)}, Value = {search_fields_input}")
# # # # #     if isinstance(search_fields_input, str):
# # # # #         try:
# # # # #             fields_list = json.loads(search_fields_input)
# # # # #             if isinstance(fields_list, list) and all(isinstance(f, str) for f in fields_list):
# # # # #                 print(f"DEBUG (parse_search_fields for {doctype_for_log}): Parsed from JSON string = {fields_list}")
# # # # #                 return fields_list
# # # # #             else:
# # # # #                 print(f"ERROR (parse_search_fields for {doctype_for_log}): Invalid format after JSON parse. Expected list of strings. Got: {fields_list}")
# # # # #                 frappe.throw(_("Invalid 'search_fields' format. Expected list of strings or valid JSON string array."))
# # # # #         except json.JSONDecodeError:
# # # # #             print(f"ERROR (parse_search_fields for {doctype_for_log}): Invalid 'search_fields' JSON format. String was: {search_fields_input}")
# # # # #             frappe.throw(_("Invalid 'search_fields' JSON format."))
# # # # #     elif isinstance(search_fields_input, list) and all(isinstance(f, str) for f in search_fields_input):
# # # # #         print(f"DEBUG (parse_search_fields for {doctype_for_log}): Returning list directly = {search_fields_input}")
# # # # #         return search_fields_input
# # # # #     elif search_fields_input is None:
# # # # #         print(f"DEBUG (parse_search_fields for {doctype_for_log}): Returning None.")
# # # # #         return None
# # # # #     else:
# # # # #         print(f"ERROR (parse_search_fields for {doctype_for_log}): Invalid 'search_fields' type. Expected list of strings, JSON string array, or None. Got: {type(search_fields_input)}")
# # # # #         frappe.throw(_("Invalid 'search_fields' type."))
# # # # #     return None # Should be unreachable if throws are effective
# # # # # (No need for the old build_query_filters that used meta)



# # # # # ________________________________ Version 2 (Custom Logic) ___________________________________

# # # # # import frappe
# # # # # from frappe import _
# # # # # from frappe.utils import cint, cstr # cstr is not used, can remove if not needed elsewhere
# # # # # from frappe.model.db_query import DatabaseQuery
# # # # # import json
# # # # # import traceback # For more detailed error logging

# # # # # # Define constants for clarity and maintainability
# # # # # DEFAULT_PAGE_LENGTH = 10
# # # # # MAX_PAGE_LENGTH = 500  # Prevent excessively large requests

# # # # # @frappe.whitelist()
# # # # # def get_list_with_count(
# # # # #     doctype: str,
# # # # #     fields: str | list[str],
# # # # #     filters: str | list | dict | None = None,
# # # # #     order_by: str | None = None,
# # # # #     limit_start: int | str = 0,
# # # # #     limit_page_length: int | str | None = None,
# # # # #     search_term: str | None = None,
# # # # #     search_fields: str | list[str] | None = None,
# # # # #     global_search: bool | str = False
# # # # # ) -> dict:
# # # # #     # --- DEBUG PRINT: API Entry ---
# # # # #     print(f"\n--- API CALL: get_list_with_count ---")
# # # # #     print(f"ARGS: doctype='{doctype}', fields_arg_type={type(fields)}, filters_arg_type={type(filters)}, search_term='{search_term}', global_search={global_search}")

# # # # #     try:
# # # # #         # --- Input Sanitization and Preparation ---
# # # # #         if not frappe.has_permission(doctype, "read"):
# # # # #             frappe.throw(_("Not permitted"), frappe.PermissionError)

# # # # #         limit_start = cint(limit_start)
# # # # #         if limit_page_length is None:
# # # # #             page_length = DEFAULT_PAGE_LENGTH
# # # # #         else:
# # # # #             page_length = min(cint(limit_page_length), MAX_PAGE_LENGTH)

# # # # #         # Handle stringified JSON inputs for 'fields'
# # # # #         if isinstance(fields, str):
# # # # #             print(f"DEBUG: 'fields' is a string, attempting JSON parse: {fields}")
# # # # #             try:
# # # # #                 fields = json.loads(fields)
# # # # #                 print(f"DEBUG: 'fields' parsed from JSON: {fields}, type: {type(fields)}")
# # # # #             except json.JSONDecodeError as je:
# # # # #                 error_msg = f"Invalid 'fields' JSON format. String was: '{fields}'. Error: {str(je)}"
# # # # #                 print(f"ERROR: {error_msg}")
# # # # #                 frappe.log_error(error_msg, "get_list_with_count API")
# # # # #                 frappe.throw(_(error_msg))
        
# # # # #         if not isinstance(fields, list) or not all(isinstance(f, str) for f in fields):
# # # # #             error_msg = f"CRITICAL: 'fields' must be a list of strings after preparation. Value: {fields}, Type: {type(fields)}"
# # # # #             print(f"ERROR: {error_msg}")
# # # # #             frappe.log_error(error_msg, "get_list_with_count API")
# # # # #             frappe.throw(_("Internal Server Error: Invalid fields format. Check logs."))

# # # # #         if "name" not in fields:
# # # # #             fields.insert(0, "name")
# # # # #             print(f"DEBUG: 'name' added to fields. Current fields: {fields}")

# # # # #         # --- DEBUG PRINT: Parsed Inputs ---
# # # # #         print(f"DEBUG: search_term='{search_term}', parsed_search_fields_input='{search_fields}', global_search_bool={global_search}, initial_filters_input='{filters}'")

# # # # #         parsed_filters = parse_filters(filters, doctype) # Pass doctype for logging
# # # # #         parsed_search_fields = parse_search_fields(search_fields, doctype) # Pass doctype for logging

# # # # #         if isinstance(global_search, str):
# # # # #             global_search = global_search.lower() == 'true'
# # # # #         print(f"DEBUG: Final global_search (bool): {global_search}")

# # # # #         # --- Build Filters (including search) ---
# # # # #         query_filters = build_query_filters(
# # # # #             doctype, parsed_filters, search_term, parsed_search_fields, global_search
# # # # #         )
# # # # #         print(f"DEBUG: Built query_filters from build_query_filters: {query_filters}")


# # # # #         # --- Get Total Count ---
# # # # #         print(f"DEBUG: >>> About to call Frappe DBQuery for COUNT <<<")
# # # # #         print(f"DEBUG: Count Query doctype = {doctype}")
# # # # #         print(f"DEBUG: Count Query filters = {query_filters}")
# # # # #         count_query = DatabaseQuery(doctype)
# # # # #         count_query.filters = query_filters # Original print from your log
# # # # #         total_count_result = count_query.execute(limit=1, fields=["count(*) as count"], as_list=True)
# # # # #         total_records = total_count_result[0][0] if total_count_result else 0
# # # # #         print(f"DEBUG: Total records from count query = {total_records}")


# # # # #         # --- Get Paginated Data (THIS IS WHERE THE ERROR ORIGINATES) ---
# # # # #         print(f"\n--- DEBUG SESSION MARKER (get_list) ---")
# # # # #         print(f"DEBUG: DocType for data fetch = {doctype}")
# # # # #         print(f"DEBUG: Fields for data fetch = {fields}")
# # # # #         print(f"DEBUG: Type of 'fields' for data fetch = {type(fields)}")
# # # # #         if isinstance(fields, list):
# # # # #             for i, f_item in enumerate(fields):
# # # # #                 print(f"DEBUG: fields_for_data_fetch[{i}] = {f_item}, type = {type(f_item)}")
# # # # #         else:
# # # # #             print(f"CRITICAL DEBUG: 'fields_for_data_fetch' IS NOT A LIST!")

# # # # #         print(f"DEBUG: Filters for data fetch = {query_filters}")
# # # # #         print(f"DEBUG: Type of 'query_filters' for data fetch = {type(query_filters)}")
# # # # #         # (Optional detailed print for query_filters items if needed)

# # # # #         print(f"DEBUG: Order By = {order_by or 'creation desc'}")
# # # # #         print(f"DEBUG: Limit Start = {limit_start}")
# # # # #         print(f"DEBUG: Limit Page Length = {page_length}")
# # # # #         print(f"--- END DEBUG SESSION MARKER (get_list) ---\n")

# # # # #         data = frappe.get_list(
# # # # #             doctype=doctype,
# # # # #             fields=fields,
# # # # #             filters=query_filters,
# # # # #             order_by=order_by or "creation desc",
# # # # #             limit_start=limit_start,
# # # # #             limit_page_length=page_length,
# # # # #             ignore_permissions=False,
# # # # #             strict=False
# # # # #         )

# # # # #         return {"data": data, "total_count": total_records}

# # # # #     except frappe.PermissionError:
# # # # #         print("ERROR: PermissionError caught in get_list_with_count")
# # # # #         raise
# # # # #     except Exception as e:
# # # # #         print(f"ERROR: Exception caught in get_list_with_count: {type(e).__name__} - {str(e)}")
# # # # #         # Log the full traceback using print for console visibility
# # # # #         print("--- TRACEBACK START ---")
# # # # #         traceback.print_exc()
# # # # #         print("--- TRACEBACK END ---")
# # # # #         frappe.log_error(traceback.format_exc(), f"get_list_with_count API Error (DocType: {doctype})") # Also log to Frappe logs
# # # # #         frappe.throw(_("An error occurred while fetching data: {0}. Check server logs and console output for details.").format(str(e)))


# # # # # # --- Helper Functions (Modified for print debugging) ---

# # # # # def parse_filters(filters_input: str | list | dict | None, doctype_for_log: str) -> list | dict:
# # # # #     print(f"DEBUG (parse_filters for {doctype_for_log}): Input type = {type(filters_input)}, Value = {filters_input}")
# # # # #     if isinstance(filters_input, str):
# # # # #         try:
# # # # #             parsed = json.loads(filters_input)
# # # # #             print(f"DEBUG (parse_filters for {doctype_for_log}): Parsed from JSON string = {parsed}")
# # # # #             return parsed
# # # # #         except json.JSONDecodeError:
# # # # #             # Simplified: Assume if string and not valid JSON, it's an error or needs specific handling not yet implemented
# # # # #             print(f"WARNING (parse_filters for {doctype_for_log}): JSONDecodeError for string filters. String was: '{filters_input}'. Returning empty dict.")
# # # # #             # Consider frappe.throw if string filters should always be valid JSON
# # # # #             return {}
# # # # #     parsed_val = filters_input or {}
# # # # #     print(f"DEBUG (parse_filters for {doctype_for_log}): Returning directly or as empty dict = {parsed_val}")
# # # # #     return parsed_val

# # # # # def parse_search_fields(search_fields_input: str | list[str] | None, doctype_for_log: str) -> list[str] | None:
# # # # #     print(f"DEBUG (parse_search_fields for {doctype_for_log}): Input type = {type(search_fields_input)}, Value = {search_fields_input}")
# # # # #     if isinstance(search_fields_input, str):
# # # # #         try:
# # # # #             fields_list = json.loads(search_fields_input)
# # # # #             if isinstance(fields_list, list) and all(isinstance(f, str) for f in fields_list):
# # # # #                 print(f"DEBUG (parse_search_fields for {doctype_for_log}): Parsed from JSON string = {fields_list}")
# # # # #                 return fields_list
# # # # #             else:
# # # # #                 print(f"ERROR (parse_search_fields for {doctype_for_log}): Invalid format after JSON parse. Expected list of strings. Got: {fields_list}")
# # # # #                 frappe.throw(_("Invalid 'search_fields' format. Expected list of strings or valid JSON string array."))
# # # # #         except json.JSONDecodeError:
# # # # #             print(f"ERROR (parse_search_fields for {doctype_for_log}): Invalid 'search_fields' JSON format. String was: {search_fields_input}")
# # # # #             frappe.throw(_("Invalid 'search_fields' JSON format."))
# # # # #     elif isinstance(search_fields_input, list) and all(isinstance(f, str) for f in search_fields_input):
# # # # #         print(f"DEBUG (parse_search_fields for {doctype_for_log}): Returning list directly = {search_fields_input}")
# # # # #         return search_fields_input
# # # # #     elif search_fields_input is None:
# # # # #         print(f"DEBUG (parse_search_fields for {doctype_for_log}): Returning None.")
# # # # #         return None
# # # # #     else:
# # # # #         print(f"ERROR (parse_search_fields for {doctype_for_log}): Invalid 'search_fields' type. Expected list of strings, JSON string array, or None. Got: {type(search_fields_input)}")
# # # # #         frappe.throw(_("Invalid 'search_fields' type."))
# # # # #     return None # Should be unreachable if throws are effective


# # # # # def build_query_filters(
# # # # #     doctype: str,
# # # # #     base_filters: list | dict,
# # # # #     search_term: str | None,
# # # # #     search_fields: list[str] | None,
# # # # #     global_search: bool
# # # # # ) -> list | dict:
# # # # #     print(f"\n--- DEBUG (build_query_filters for {doctype}) ---")
# # # # #     print(f"Input: base_filters={base_filters}, search_term='{search_term}', search_fields={search_fields}, global_search={global_search}")

# # # # #     if isinstance(base_filters, dict):
# # # # #         query_filters_list = [[k, "=", v] for k, v in base_filters.items()]
# # # # #         if base_filters:
# # # # #              print(f"WARNING (build_query_filters for {doctype}): Dictionary base_filters {base_filters} converted to list format: {query_filters_list}")
# # # # #              # frappe.msgprint might not be ideal here if we are deep in backend logic. Print is safer for now.
# # # # #     else:
# # # # #         query_filters_list = list(base_filters) if base_filters else []
# # # # #     print(f"DEBUG (build_query_filters for {doctype}): Initial query_filters_list = {query_filters_list}")

# # # # #     if search_term:
# # # # #         search_term_sql = f"%{search_term}%"
# # # # #         try:
# # # # #             meta = frappe.get_meta(doctype)
# # # # #             print(f"DEBUG (build_query_filters for {doctype}): Meta object obtained successfully.")
# # # # #         except Exception as e:
# # # # #             print(f"ERROR (build_query_filters for {doctype}): Could not get meta for doctype {doctype}: {str(e)}")
# # # # #             frappe.log_error(f"Could not get meta for doctype {doctype}: {str(e)}", f"BuildQueryFilters {doctype}")
# # # # #             return query_filters_list # Return current filters

# # # # #         if global_search:
# # # # #             print(f"DEBUG (build_query_filters for {doctype}): Global search is ON.")
# # # # #             # meta.get_search_fields() returns fields marked "In Global Search"
# # # # #             configured_search_fields = meta.get_search_fields()
# # # # #             print(f"DEBUG (build_query_filters for {doctype}): meta.get_search_fields() returned: {configured_search_fields}")

# # # # #             if not configured_search_fields:
# # # # #                  if meta.has_field("name"):
# # # # #                      all_searchable_fields = ["name"]
# # # # #                      print(f"WARNING (build_query_filters for {doctype}): No specific 'in_global_search' fields. Using ['name'] for global search.")
# # # # #                  else:
# # # # #                      print(f"ERROR (build_query_filters for {doctype}): Global search enabled, but no 'in_global_search' fields and 'name' field not found. Skipping text search.")
# # # # #                      return query_filters_list
# # # # #             else:
# # # # #                 all_searchable_fields = configured_search_fields
# # # # #             print(f"DEBUG (build_query_filters for {doctype}): Effective fields for global search: {all_searchable_fields}")

# # # # #             global_search_conditions = []
# # # # #             for field_name in all_searchable_fields:
# # # # #                 field_exists_in_meta = meta.has_field(field_name)
# # # # #                 print(f"DEBUG (build_query_filters for {doctype}): Checking global field '{field_name}'. Exists in meta: {field_exists_in_meta}")

# # # # #                 if field_name == "name": # 'name' is implicitly searchable
# # # # #                     global_search_conditions.append([doctype, field_name, "like", search_term_sql])
# # # # #                     print(f"DEBUG (build_query_filters for {doctype}): Added global search condition for 'name'")
# # # # #                     continue

# # # # #                 if field_exists_in_meta:
# # # # #                     df = meta.get_field(field_name)
# # # # #                     # frappe.model.no_value_fields includes 'Section Break', 'Column Break', 'HTML', 'Button', 'Image', 'Fold', 'Read Only' etc.
# # # # #                     if df and df.fieldtype not in frappe.model.no_value_fields and df.fieldtype not in ("Table", "Table MultiSelect", "Attach Image", "Attach"): # Added Attach
# # # # #                          global_search_conditions.append([doctype, field_name, "like", search_term_sql])
# # # # #                          print(f"DEBUG (build_query_filters for {doctype}): Added global search condition for '{field_name}' (type: {df.fieldtype})")
# # # # #                     else:
# # # # #                          print(f"DEBUG (build_query_filters for {doctype}): Skipping non-queryable global field '{field_name}' (Type: {df.fieldtype if df else 'N/A'})")
# # # # #                 else:
# # # # #                     # This is a critical warning
# # # # #                     print(f"CRITICAL WARNING (build_query_filters for {doctype}): Field '{field_name}' from meta.get_search_fields() not found by meta.has_field(). Metadata inconsistent!")
# # # # #                     # Optionally log to frappe.log_error as well
# # # # #                     frappe.log_error(f"Metadata inconsistency in {doctype}: Field '{field_name}' from get_search_fields() not found by has_field()", "BuildQueryFilters Critical")


# # # # #             if global_search_conditions:
# # # # #                 # Frappe expects OR conditions to be a list starting with "or"
# # # # #                 # e.g., ["or", [condition1], [condition2]]
# # # # #                 # If query_filters_list is empty, the global search is the only filter.
# # # # #                 # If query_filters_list has existing AND conditions, the new OR block is ANDed with them.
# # # # #                 # Example: [ ["status", "=", "Open"], ["or", [global_search_cond1], [global_search_cond2]] ]
# # # # #                 if not query_filters_list:
# # # # #                      query_filters_list = ["or"] + global_search_conditions # This structure is for top-level OR
# # # # #                      # If you want this OR block to be the *only* filter, and it contains multiple conditions, it should be:
# # # # #                      # query_filters_list = [ ["or"] + global_search_conditions ] # If it's a single OR block.
# # # # #                      # However, frappe.get_list handles `filters = ["or", ["Items", "name", "like", "%val%"], ["Items", "desc", "like", "%val%"]]`
# # # # #                      # Let's stick to your previous logic which was: query_filters = global_search_filter
# # # # #                      # where global_search_filter = ["or"] + global_search_conditions
# # # # #                      # This means if base_filters were empty, query_filters becomes ["or", cond1, cond2, ...]
# # # # #                      # This structure is directly consumable by frappe.get_list filters.
# # # # #                      query_filters_list = ["or"] + global_search_conditions
# # # # #                      print(f"DEBUG (build_query_filters for {doctype}): Global search is the only filter: {query_filters_list}")
# # # # #                 else:
# # # # #                      # Append the OR block as another AND condition
# # # # #                      query_filters_list.append(["or"] + global_search_conditions)
# # # # #                      print(f"DEBUG (build_query_filters for {doctype}): Appended global search OR block to existing filters: {query_filters_list}")
# # # # #             else:
# # # # #                 print(f"WARNING (build_query_filters for {doctype}): Global search for '{search_term}' yielded no searchable conditions.")

# # # # #         elif search_fields: # Specific field search
# # # # #             print(f"DEBUG (build_query_filters for {doctype}): Specific field search for fields: {search_fields}")
# # # # #             for field_name in search_fields:
# # # # #                 field_exists_in_meta = meta.has_field(field_name)
# # # # #                 print(f"DEBUG (build_query_filters for {doctype}): Checking specific field '{field_name}'. Exists in meta: {field_exists_in_meta}")
# # # # #                 if field_exists_in_meta:
# # # # #                     df = meta.get_field(field_name)
# # # # #                     if df and df.fieldtype not in frappe.model.no_value_fields and df.fieldtype not in ("Table", "Table MultiSelect", "Attach Image", "Attach"):
# # # # #                         query_filters_list.append([doctype, field_name, "like", search_term_sql])
# # # # #                         print(f"DEBUG (build_query_filters for {doctype}): Added specific search condition for '{field_name}'")
# # # # #                     else:
# # # # #                          print(f"DEBUG (build_query_filters for {doctype}): Skipping non-queryable specific field '{field_name}' (Type: {df.fieldtype if df else 'N/A'})")
# # # # #                 else:
# # # # #                     print(f"WARNING (build_query_filters for {doctype}): Specific search field '{field_name}' not found in DocType '{doctype}'. Skipping.")

# # # # #     print(f"DEBUG (build_query_filters for {doctype}): Final query_filters_list being returned: {query_filters_list}")
# # # # #     print(f"--- END DEBUG (build_query_filters for {doctype}) ---\n")
# # # # #     return query_filters_list









# # # # # _________________________________ Version 1 (Custom Logic) ______________________________


# # # # # import frappe
# # # # # from frappe import _
# # # # # from frappe.utils import cint, cstr
# # # # # from frappe.model.db_query import DatabaseQuery
# # # # # import json

# # # # # # Define constants for clarity and maintainability
# # # # # DEFAULT_PAGE_LENGTH = 10
# # # # # MAX_PAGE_LENGTH = 500  # Prevent excessively large requests

# # # # # @frappe.whitelist()
# # # # # def get_list_with_count(
# # # # #     doctype: str,
# # # # #     fields: str | list[str],
# # # # #     filters: str | list | dict | None = None,
# # # # #     order_by: str | None = None,
# # # # #     limit_start: int | str = 0,
# # # # #     limit_page_length: int | str | None = None,
# # # # #     search_term: str | None = None,
# # # # #     search_fields: str | list[str] | None = None,
# # # # #     global_search: bool | str = False
# # # # # ) -> dict:
# # # # #     """
# # # # #     Fetches a paginated list of documents along with the total count
# # # # #     matching the filters, optimized into a single endpoint.

# # # # #     Args:
# # # # #         doctype (str): The DocType name.
# # # # #         fields (str | list[str]): List of fields to fetch or JSON string of fields.
# # # # #         filters (str | list | dict | None): Filters as a list/dict or JSON string.
# # # # #         order_by (str | None): Order by clause (e.g., "creation desc").
# # # # #         limit_start (int | str): Starting row index for pagination.
# # # # #         limit_page_length (int | str | None): Number of records per page.
# # # # #         search_term (str | None): Text search term.
# # # # #         search_fields (str | list[str] | None): Specific fields to apply search_term (JSON string or list).
# # # # #                                                 Required if global_search is False.
# # # # #         global_search (bool | str): If True, search_term is applied across all searchable fields.
# # # # #                                     Can be passed as boolean or string "true"/"false".

# # # # #     Returns:
# # # # #         dict: {"data": list[dict], "total_count": int}
# # # # #     """
# # # # #     try:
# # # # #         # --- Input Sanitization and Preparation ---
# # # # #         if not frappe.has_permission(doctype, "read"):
# # # # #             frappe.throw(_("Not permitted"), frappe.PermissionError)

# # # # #         limit_start = cint(limit_start)
# # # # #         if limit_page_length is None:
# # # # #             page_length = DEFAULT_PAGE_LENGTH
# # # # #         else:
# # # # #             page_length = min(cint(limit_page_length), MAX_PAGE_LENGTH) # Enforce max page length

# # # # #         # Handle stringified JSON inputs from JS/HTTP requests
# # # # #         if isinstance(fields, str):
# # # # #             try:
# # # # #                 fields = json.loads(fields)
# # # # #             except json.JSONDecodeError:
# # # # #                 frappe.throw(_("Invalid 'fields' format. Expected list or valid JSON string."))
# # # # #         if not isinstance(fields, list):
# # # # #              frappe.throw(_("'fields' must be a list."))
# # # # #         # Ensure 'name' is always included if not present, often needed for keys/links
# # # # #         if "name" not in fields:
# # # # #             fields.insert(0, "name")
        
# # # # #         print(f"search_term",search_term)
# # # # #         print(f"search_fields", search_fields)
# # # # #         print(f"global_search", global_search)
# # # # #         print(f"filters", filters)


# # # # #         parsed_filters = parse_filters(filters)
# # # # #         parsed_search_fields = parse_search_fields(search_fields)

# # # # #         # Convert global_search string to boolean if necessary
# # # # #         if isinstance(global_search, str):
# # # # #             global_search = global_search.lower() == 'true'

# # # # #         # --- Build Filters (including search) ---
# # # # #         query_filters = build_query_filters(
# # # # #             doctype, parsed_filters, search_term, parsed_search_fields, global_search
# # # # #         )

# # # # #         # --- Get Total Count (Optimized) ---
# # # # #         # We use a separate query for count for better performance and clarity,
# # # # #         # especially with complex filters or large datasets. Frappe's get_list
# # # # #         # can sometimes be less efficient for *just* the count with pagination params.
# # # # #         count_query = DatabaseQuery(doctype)
# # # # #         print("query_filters", query_filters) # Debugging
# # # # #         count_query.filters = query_filters
# # # # #         total_count = count_query.execute(limit=1, fields=["count(*) as count"], as_list=True) # Efficient count
# # # # #         total_records = total_count[0][0] if total_count else 0


# # # # #         # --- Get Paginated Data ---
# # # # #         # Use Frappe's built-in get_list for data fetching as it handles permissions, translations etc.
# # # # #         data = frappe.get_list(
# # # # #             doctype=doctype,
# # # # #             fields=fields,
# # # # #             filters=query_filters,
# # # # #             order_by=order_by or "creation desc", # Default sort order
# # # # #             limit_start=limit_start,
# # # # #             limit_page_length=page_length,
# # # # #             ignore_permissions=False, # Important: Respect user permissions
# # # # #             strict=False # Allow unknown fields in filters if needed, adjust as per policy
# # # # #         )

# # # # #         return {
# # # # #             "data": data,
# # # # #             "total_count": total_records
# # # # #         }

# # # # #     except frappe.PermissionError:
# # # # #         raise # Re-raise permission errors to be handled by Frappe framework
# # # # #     except Exception as e:
# # # # #         frappe.log_error(frappe.get_traceback(), "get_list_with_count API Error")
# # # # #         frappe.throw(_("An error occurred while fetching data: {0}").format(str(e)))


# # # # # # --- Helper Functions ---

# # # # # def parse_filters(filters: str | list | dict | None) -> list | dict:
# # # # #     """ Parses filters from JSON string if necessary. """
# # # # #     if isinstance(filters, str):
# # # # #         try:
# # # # #             return json.loads(filters)
# # # # #         except json.JSONDecodeError:
# # # # #             # Handle potential malformed simple filters like `[["field", "like", "%val%"]]`
# # # # #             # This is basic; a more robust parser might be needed for complex string filters
# # # # #             if filters.startswith('[') and filters.endswith(']'):
# # # # #                  try:
# # # # #                      # Attempt eval carefully ONLY if it looks like a list of lists/tuples
# # # # #                      # SECURITY NOTE: Avoid eval on arbitrary user input in production without heavy sanitization.
# # # # #                      # Consider a dedicated safe parsing library if complex string filters are common.
# # # # #                      # For now, assume JSON or Python list/dict is passed from frontend hook.
# # # # #                      # parsed = eval(filters) # AVOID THIS IF POSSIBLE
# # # # #                      # if isinstance(parsed, list): return parsed
# # # # #                      frappe.throw(_("Invalid 'filters' format. Use JSON string or pass list/dict directly."))
# # # # #                  except Exception:
# # # # #                     frappe.throw(_("Invalid 'filters' format. Use JSON string or pass list/dict directly."))
# # # # #             return {} # Default to empty if parsing fails
# # # # #     return filters or {} # Return as is if already list/dict, or default to empty dict

# # # # # def parse_search_fields(search_fields: str | list[str] | None) -> list[str] | None:
# # # # #     """ Parses search_fields from JSON string if necessary. """
# # # # #     if isinstance(search_fields, str):
# # # # #         try:
# # # # #             fields = json.loads(search_fields)
# # # # #             if isinstance(fields, list) and all(isinstance(f, str) for f in fields):
# # # # #                 return fields
# # # # #             else:
# # # # #                  frappe.throw(_("Invalid 'search_fields' format. Expected list of strings or valid JSON string array."))
# # # # #         except json.JSONDecodeError:
# # # # #              frappe.throw(_("Invalid 'search_fields' JSON format."))
# # # # #     elif isinstance(search_fields, list) and all(isinstance(f, str) for f in search_fields):
# # # # #         return search_fields
# # # # #     elif search_fields is None:
# # # # #         return None
# # # # #     else:
# # # # #         frappe.throw(_("Invalid 'search_fields' type. Expected list of strings, JSON string array, or None."))



# # # # # def build_query_filters(
# # # # #     doctype: str,
# # # # #     base_filters: list | dict,
# # # # #     search_term: str | None,
# # # # #     search_fields: list[str] | None,
# # # # #     global_search: bool
# # # # # ) -> list | dict:
# # # # #     """ Combines base filters with search filters. """

# # # # #     if isinstance(base_filters, dict):
# # # # #         query_filters = [[k, "=", v] for k, v in base_filters.items()]
# # # # #         if base_filters:
# # # # #              frappe.msgprint(f"Warning: Dictionary filters {base_filters} converted to list format for {doctype}. Ensure this is intended.", indicator="orange", alert=True)
# # # # #     else:
# # # # #         query_filters = list(base_filters) if base_filters else []

# # # # #     # frappe.log_info(f"Initial query_filters for {doctype}: {query_filters}", "BuildQueryFilters") # More detailed log

# # # # #     if search_term:
# # # # #         search_term_sql = f"%{search_term}%"
# # # # #         try:
# # # # #             meta = frappe.get_meta(doctype)
# # # # #         except Exception as e:
# # # # #             frappe.log_error(f"Could not get meta for doctype {doctype}: {str(e)}", "BuildQueryFilters")
# # # # #             # Depending on policy, you might want to return query_filters or raise
# # # # #             return query_filters


# # # # #         if global_search:
# # # # #             actual_search_fields = meta.get_search_fields() # Fields marked in_global_search
# # # # #             # frappe.log_info(f"Meta search fields for {doctype}: {actual_search_fields}", "BuildQueryFilters")

# # # # #             # Fallback logic if no search fields defined in meta
# # # # #             if not actual_search_fields:
# # # # #                  if meta.has_field("name"):
# # # # #                      all_searchable_fields = ["name"]
# # # # #                      frappe.msgprint(_("No specific search fields defined via 'in_global_search' for {0}. Using 'name' for global search.").format(doctype), indicator="orange")
# # # # #                  else:
# # # # #                      # This case should be extremely rare if meta is loaded correctly
# # # # #                      frappe.msgprint(_("Global search enabled, but no 'in_global_search' fields and 'name' field not found for DocType {0}. Skipping text search.").format(doctype), indicator="red", alert=True)
# # # # #                      return query_filters
# # # # #             else:
# # # # #                 all_searchable_fields = actual_search_fields

# # # # #             # frappe.log_info(f"Effective fields for global search on {doctype}: {all_searchable_fields}", "BuildQueryFilters")

# # # # #             global_search_conditions = []
# # # # #             for field_name in all_searchable_fields:
# # # # #                 # frappe.log_info(f"Checking field '{field_name}' for global search on {doctype}. Exists in meta: {meta.has_field(field_name)}", "BuildQueryFilters")

# # # # #                 # 'name' is implicitly searchable and always exists if meta is correct
# # # # #                 if field_name == "name":
# # # # #                     global_search_conditions.append([doctype, field_name, "like", search_term_sql])
# # # # #                     # frappe.log_info(f"Added 'name' field condition for global search on {doctype}", "BuildQueryFilters")
# # # # #                     continue

# # # # #                 if meta.has_field(field_name):
# # # # #                     df = meta.get_field(field_name)
# # # # #                     if df and df.fieldtype not in frappe.model.no_value_fields and df.fieldtype not in ("Table", "Table MultiSelect", "Attach Image"): # More comprehensive list
# # # # #                          global_search_conditions.append([doctype, field_name, "like", search_term_sql])
# # # # #                          # frappe.log_info(f"Added condition for field '{field_name}' (type: {df.fieldtype}) for global search on {doctype}", "BuildQueryFilters")
# # # # #                     else:
# # # # #                          frappe.log_info(f"Skipping non-queryable or unsuitable field '{field_name}' (Type: {df.fieldtype if df else 'N/A'}) for global search on {doctype}", "BuildQueryFilters")
# # # # #                 else:
# # # # #                     # This is a critical warning if a field from get_search_fields() is not found by has_field()
# # # # #                     frappe.log_warning(f"Field '{field_name}' was listed in get_search_fields for {doctype} but meta.has_field returned False. Metadata might be inconsistent.", "BuildQueryFilters Critical")


# # # # #             if global_search_conditions:
# # # # #                 global_search_filter = ["or"] + global_search_conditions
# # # # #                 if not query_filters:
# # # # #                      query_filters = global_search_filter
# # # # #                 else:
# # # # #                      query_filters.append(global_search_filter)
# # # # #             else:
# # # # #                 frappe.msgprint(_("Global search for '{term}' on {doctype} yielded no searchable conditions after field validation.").format(term=search_term, doctype=doctype), indicator="orange")

# # # # #         elif search_fields: # Specific field search
# # # # #             added_specific_filter = False
# # # # #             for field_name in search_fields:
# # # # #                 # frappe.log_info(f"Checking specific field '{field_name}' for search on {doctype}. Exists in meta: {meta.has_field(field_name)}", "BuildQueryFilters")
# # # # #                 if meta.has_field(field_name):
# # # # #                     df = meta.get_field(field_name)
# # # # #                     if df and df.fieldtype not in frappe.model.no_value_fields and df.fieldtype not in ("Table", "Table MultiSelect", "Attach Image"):
# # # # #                         query_filters.append([doctype, field_name, "like", search_term_sql])
# # # # #                         added_specific_filter = True
# # # # #                     else:
# # # # #                          frappe.log_info(f"Skipping non-queryable specific field '{field_name}' (Type: {df.fieldtype if df else 'N/A'}) for search on {doctype}", "BuildQueryFilters")
# # # # #                 else:
# # # # #                     frappe.msgprint(_("Warning: Search field '{0}' not found in DocType '{1}'. Skipping.").format(field_name, doctype), indicator="orange")
# # # # #             # if added_specific_filter and not query_filters: pass # Logic seems fine

# # # # #     # frappe.log_info(f"Final query_filters for {doctype} before returning: {query_filters}", "BuildQueryFilters")
# # # # #     return query_filters

# # # # # ---
# # # # # Important considerations for the main `get_list_with_count` function:
# # # # # 1. Error Handling for `json.loads(fields)`: Add a more specific error message or log the problematic string.
# # # # #    Example:
# # # # #    if isinstance(fields, str):
# # # # #        try:
# # # # #            fields = json.loads(fields)
# # # # #        except json.JSONDecodeError as je:
# # # # #            frappe.log_error(f"JSONDecodeError for 'fields' string: {fields}\nError: {str(je)}", "get_list_with_count API")
# # # # #            frappe.throw(_("Invalid 'fields' format. Expected list or valid JSON string. Check server logs for details."))
# # # # #
# # # # # 2. `strict=False` in `frappe.get_list`: This is powerful but can sometimes hide issues or lead to unexpected behavior if field names are ambiguous (e.g., exist in parent and child).
# # # # #    If the AttributeError persists even after metadata fixes, as a last resort for debugging, you could try `strict=True` to see if it changes the error or behavior. This would mean you can only filter/fetch fields directly belonging to the main DocType.
# # # # # ---



# # # # # def build_query_filters(
# # # # #     doctype: str,
# # # # #     base_filters: list | dict,
# # # # #     search_term: str | None,
# # # # #     search_fields: list[str] | None,
# # # # #     global_search: bool
# # # # # ) -> list | dict:
# # # # #     """ Combines base filters with search filters. """

# # # # #     # Start with base filters, ensuring it's a list for easier manipulation
# # # # #     if isinstance(base_filters, dict):
# # # # #         # Convert dict filters to list format if necessary for consistency
# # # # #         # This basic conversion might need enhancement for complex dict filters
# # # # #         query_filters = [[k, "=", v] for k, v in base_filters.items()] # Example conversion
# # # # #         # Or handle dict filters separately if they are fundamentally different
# # # # #         # For now, assume list format is preferred when combining with search
# # # # #         if base_filters:
# # # # #              frappe.msgprint(_("Warning: Combining dictionary filters with search might require specific handling. Assuming list format."), indicator="orange")
# # # # #     else:
# # # # #         # Create a copy if it's already a list or initialize empty list
# # # # #         query_filters = list(base_filters) if base_filters else []

# # # # #     print("global_search", global_search) # Keep for debugging if needed

# # # # #     if search_term:
# # # # #         search_term_sql = f"%{search_term}%"
# # # # #         meta = frappe.get_meta(doctype) # Get meta once

# # # # #         if global_search:
# # # # #             all_search_fields = meta.get_search_fields()
# # # # #             print("all_search_fields", all_search_fields) # Debugging

# # # # #             # Fallback logic if no search fields defined
# # # # #             if not all_search_fields:
# # # # #                  if meta.has_field("name"): # Check if 'name' field exists
# # # # #                      all_search_fields = ["name"]
# # # # #                      frappe.msgprint(_("No specific search fields defined for {0}. Using 'name' for global search.").format(doctype), indicator="orange")
# # # # #                  else:
# # # # #                      frappe.msgprint(_("Global search enabled, but no searchable fields (including 'name') defined for DocType {0}. Skipping text search.").format(doctype), indicator="orange")
# # # # #                      return query_filters # Return only base filters

# # # # #             # Build the OR condition list
# # # # #             global_search_conditions = []
# # # # #             for field in all_search_fields:
# # # # #                 print(f"Checking field: {field}, Exists: {meta.has_field(field)}") # Debugging

# # # # #                  # --- Updated Check ---
# # # # #                 # Treat 'name' specially, assume always searchable via DBQuery
# # # # #                 if field == "name":
# # # # #                      global_search_conditions.append([doctype, field, "like", search_term_sql])
# # # # #                      print(f"Adding condition for implicit field: {field}") # Debugging
# # # # #                      continue # Skip further checks for 'name'
# # # # #                 # *** CRUCIAL: Check if the field actually exists in DB ***
# # # # #                 if meta.has_field(field):
# # # # #                     # Ensure field is queryable (basic check, might need more nuance)
# # # # #                     df = meta.get_field(field)
# # # # #                     if df and df.fieldtype not in ["HTML", "Section Break", "Column Break", "Button", "Read Only", "Table", "Table MultiSelect"]:
# # # # #                          global_search_conditions.append([doctype, field, "like", search_term_sql])
# # # # #                     else:
# # # # #                          print(f"Skipping non-queryable field: {field} (Type: {df.fieldtype if df else 'N/A'})") # Debugging
# # # # #                 else:
# # # # #                     print(f"Skipping field not found in meta.has_field: {field}") # Debugging


# # # # #             # Only add the 'or' filter if there are valid conditions to check
# # # # #             if global_search_conditions:
# # # # #                 global_search_filter = ["or"] + global_search_conditions

# # # # #                 # --- *** THE CORE FIX *** ---
# # # # #                 # If there were no base filters, the global search is the *only* filter.
# # # # #                 if not query_filters: # Check if the original base filters were empty
# # # # #                      query_filters = global_search_filter # Assign directly, don't wrap
# # # # #                 else:
# # # # #                 # If there were base filters, append the OR condition list to them.
# # # # #                      query_filters.append(global_search_filter)
# # # # #             else:
# # # # #                 frappe.msgprint(_("Global search enabled, but no valid searchable fields found after check for DocType {0}. Skipping text search.").format(doctype), indicator="orange")


# # # # #         elif search_fields:
# # # # #             # Specific field search (AND conditions)
# # # # #             added_specific_filter = False
# # # # #             for field in search_fields:
# # # # #                  print(f"Checking specific field: {field}, Exists: {meta.has_field(field)}") # Debugging
# # # # #                  if meta.has_field(field):
# # # # #                      df = meta.get_field(field)
# # # # #                      # Add similar check for queryable field types if needed
# # # # #                      if df and df.fieldtype not in ["HTML", "Section Break", "Column Break", "Button", "Read Only", "Table", "Table MultiSelect"]:
# # # # #                         query_filters.append([doctype, field, "like", search_term_sql])
# # # # #                         added_specific_filter = True
# # # # #                      else:
# # # # #                           print(f"Skipping non-queryable specific field: {field} (Type: {df.fieldtype if df else 'N/A'})") # Debugging
# # # # #                  else:
# # # # #                      frappe.msgprint(_("Warning: Search field '{0}' not found in DocType '{1}'. Skipping.").format(field, doctype), indicator="orange")

# # # # #             # Optional: Reset page if specific filters were added? (Handled in frontend ideally)
# # # # #             # if added_specific_filter and not query_filters: # Check if query_filters was initially empty
# # # # #                  # This logic might be better placed in frontend to reset pagination state
# # # # #                 # pass


# # # # #     print("Final query_filters being used:", query_filters) # Debugging
# # # # #     return query_filters


# # # #     # def build_query_filters(
# # # # #     doctype: str,
# # # # #     base_filters: list | dict,
# # # # #     search_term: str | None,
# # # # #     search_fields: list[str] | None,
# # # # #     global_search: bool
# # # # # ) -> list | dict:
# # # # #     """ Combines base filters with search filters. """
# # # # #     query_filters = base_filters.copy() if isinstance(base_filters, dict) else list(base_filters)

# # # # #     if search_term:
# # # # #         search_term_sql = f"%{search_term}%"

# # # # #         if global_search:
# # # # #             # Get searchable fields from DocType meta
# # # # #             meta = frappe.get_meta(doctype)
# # # # #             all_search_fields = meta.get_search_fields()
# # # # #             if not all_search_fields:
# # # # #                  # Fallback if no search fields defined in meta (search 'name'?)
# # # # #                  # Or decide not to search globally if no fields are marked.
# # # # #                  # Let's default to searching 'name' if available.
# # # # #                  if meta.get_field("name"):
# # # # #                      all_search_fields = ["name"]
# # # # #                  else:
# # # # #                      # Or maybe throw an error? Warn? For now, skip global search if no fields defined.
# # # # #                      frappe.msgprint(_("Global search enabled, but no searchable fields defined for DocType {0}. Skipping text search.").format(doctype), indicator="orange")
# # # # #                      return query_filters # Return only base filters

# # # # #             # Build an OR condition across all searchable fields
# # # # #             global_search_filter = ["or"]
# # # # #             for field in all_search_fields:
# # # # #                  # Check if field actually exists in the doctype to prevent errors
# # # # #                  if meta.has_field(field):
# # # # #                      global_search_filter.append([doctype, field, "like", search_term_sql])

# # # # #             # If query_filters is a list, append the OR condition
# # # # #             if isinstance(query_filters, list):
# # # # #                 # Only add the filter if there were valid searchable fields
# # # # #                 if len(global_search_filter) > 1:
# # # # #                     query_filters.append(global_search_filter)
# # # # #             # If query_filters is a dict, add the OR condition under a unique key (less common for list views)
# # # # #             elif isinstance(query_filters, dict):
# # # # #                  # Merging dict filters with complex OR conditions can be tricky.
# # # # #                  # Frappe's get_list primarily expects list format for complex filters.
# # # # #                  # Converting dict to list might be necessary if this combination occurs.
# # # # #                  # For simplicity, let's assume list format is preferred when search is active.
# # # # #                  # If you heavily rely on dict filters, this part needs careful design.
# # # # #                  if len(global_search_filter) > 1:
# # # # #                      # This simple append might break dict filter logic. A safer approach
# # # # #                      # would be to convert the dict filters to list format first.
# # # # #                      # frappe.msgprint("Warning: Combining global search with dictionary filters might be unstable.", indicator="orange")
# # # # #                      query_filters[f"_global_search_{search_term[:10]}"] = global_search_filter # Example key
# # # # #             else:
# # # # #                  # If filters started as None/empty, initialize as list
# # # # #                  if len(global_search_filter) > 1:
# # # # #                      query_filters = [global_search_filter]

# # # # #         elif search_fields:
# # # # #             # Apply search term to specific fields (AND condition)
# # # # #             meta = frappe.get_meta(doctype) # To validate fields
# # # # #             if isinstance(query_filters, list):
# # # # #                 for field in search_fields:
# # # # #                     if meta.has_field(field):
# # # # #                          query_filters.append([doctype, field, "like", search_term_sql])
# # # # #                     else:
# # # # #                          frappe.msgprint(_("Warning: Search field '{0}' not found in DocType '{1}'. Skipping.").format(field, doctype), indicator="orange")
# # # # #             elif isinstance(query_filters, dict):
# # # # #                  for field in search_fields:
# # # # #                      if meta.has_field(field):
# # # # #                          query_filters[field] = ["like", search_term_sql]
# # # # #                      else:
# # # # #                           frappe.msgprint(_("Warning: Search field '{0}' not found in DocType '{1}'. Skipping.").format(field, doctype), indicator="orange")
# # # # #             else:
# # # # #                 # Initialize filters as list if starting empty
# # # # #                 query_filters = []
# # # # #                 for field in search_fields:
# # # # #                      if meta.has_field(field):
# # # # #                          query_filters.append([doctype, field, "like", search_term_sql])
# # # # #                      else:
# # # # #                           frappe.msgprint(_("Warning: Search field '{0}' not found in DocType '{1}'. Skipping.").format(field, doctype), indicator="orange")

# # # # #     return query_filters



import frappe
from frappe import _
from frappe.utils import cint
import json
import traceback
import hashlib

from frappe.model.db_query import DatabaseQuery
from frappe.desk.reportview import execute as reportview_execute # Alias for DatabaseQuery(...).execute

# Define constants
DEFAULT_PAGE_LENGTH = 10
MAX_PAGE_LENGTH = 2000
CACHE_EXPIRY = 300 # 5 minutes
JSON_ITEM_SEARCH_DOCTYPE_MAP = {
    # Renamed item_path to item_path_parts for clarity
    "Procurement Orders": {"json_field": "order_list", "item_path_parts": ["list", "*", "item"], "item_name_key_in_json": "item"},
    "Procurement Requests": {"json_field": "procurement_list", "item_path_parts": ["list", "*", "item_code"], "item_name_key_in_json": "item_code"},
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
            if isinstance(item, list): # Already in Frappe filter format [[field, op, val]]
                parsed_list_of_lists.append(item)
            # Check if it looks like Tanstack ColumnFilterState item {id: "col", value: ["a", "b"]}
            elif isinstance(item, dict) and 'id' in item and 'value' in item:
                 # If value is array (likely from facet), use 'in'. Otherwise, use '='.
                 # Ensure doctype is prepended if necessary, though DatabaseQuery might handle it.
                 # Using simple field names for now based on previous steps.
                operator = "in" if isinstance(item['value'], list) else "="
                # Skip if value is empty array or empty string? Or let backend handle? Let backend handle for now.
                if item['value'] or isinstance(item['value'], list) and len(item['value']) > 0 :
                     parsed_list_of_lists.append([item['id'], operator, item['value']])
                else:
                     print(f"WARNING (_parse_filters_input for {doctype_for_log}): Skipping filter with empty value: {item}")
            else:
                print(f"WARNING (_parse_filters_input for {doctype_for_log}): Unexpected item format in filters list: {item}")
    elif isinstance(parsed_input, dict):
        for k, v in parsed_input.items():
             # Maybe add doctype prefix here if DatabaseQuery needs it for dict filters
            parsed_list_of_lists.append([k, "=", v])

    print(f"DEBUG (_parse_filters_input for {doctype_for_log}): Returning filter list: {parsed_list_of_lists}")
    return parsed_list_of_lists


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


def _build_standard_filters(
    doctype: str, base_filters: list, search_term: str | None,
    global_search_fields: list[str] | None,
) -> tuple[list, list]:
    print(f"\n--- DEBUG (_build_standard_filters for {doctype}) ---")
    and_filters = list(base_filters)
    or_filters = []
    if search_term and global_search_fields:
        search_term_sql = f"%{search_term}%"
        effective_search_fields = set(global_search_fields)
        if "name" not in effective_search_fields: effective_search_fields.add("name")
        for field_name in effective_search_fields:
            if isinstance(field_name, str) and field_name.strip():
                # Ensure filter format is [doctype, field, op, value] for clarity with or_filters
                or_filters.append([doctype, field_name, "like", search_term_sql])
    elif search_term and not global_search_fields:
         # Add as AND filter if no specific global fields provided
         and_filters.append([doctype, "name", "like", f"%{search_term}%"])
    print(f"DEBUG (StdFilterBuilder): Returning AND: {and_filters}, OR: {or_filters}")
    return and_filters, or_filters


@frappe.whitelist(allow_guest=False)
def get_list_with_count_enhanced(
    doctype: str, fields: str | list[str], filters: str | list | dict | None = None,
    order_by: str | None = None, limit_start: int | str = 0, limit_page_length: int | str | None = None,
    search_term: str | None = None, current_search_fields: str | list[str] | None = None,
    is_item_search: bool | str = False
) -> dict:

    print(f"\n--- API CALL: get_list_with_count_enhanced ---")
    # ... (Initial prints, permission checks, param parsing) ...
    if not frappe.db.exists("DocType", doctype): frappe.throw(_("Invalid DocType: {0}").format(doctype))
    if not frappe.has_permission(doctype, "read"): frappe.throw(_("Not permitted"), frappe.PermissionError)

    start = cint(limit_start)
    page_length = min(cint(limit_page_length or DEFAULT_PAGE_LENGTH), MAX_PAGE_LENGTH)
    is_item_search_bool = isinstance(is_item_search, str) and is_item_search.lower() == 'true' or is_item_search is True

    parsed_select_fields_str_list = _parse_search_fields_input(fields, f"{doctype} (select_fields)") or ["name"]
    if "name" not in parsed_select_fields_str_list: parsed_select_fields_str_list.insert(0, "name")
    
    parsed_base_filters_list = _parse_filters_input(filters, doctype)
    parsed_global_search_fields_for_standard_search = _parse_search_fields_input(current_search_fields, f"{doctype} (global_search_fields)")

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
        "v_api": "3.3", # Incremented version
        "doctype": doctype, "fields": json.dumps(sorted(parsed_select_fields_str_list)),
        "filters": json.dumps(parsed_base_filters_list), "order_by": _formatted_order_by,
        "start": start, "page_length": page_length, "search_term": search_term,
        "is_item_search": is_item_search_bool,
        "global_search_fields": json.dumps(sorted(parsed_global_search_fields_for_standard_search)) if not is_item_search_bool and parsed_global_search_fields_for_standard_search else None
    }
    cache_key_string = json.dumps(cache_key_params, sort_keys=True)
    cache_key = f"dt_enhanced_{doctype}_{hashlib.sha1(cache_key_string.encode()).hexdigest()}"
    print(f"DEBUG: Cache Key: {cache_key}")
    
    # --- Check Cache ---
    cached_result = frappe.cache().get_value(cache_key)
    if cached_result: # ... (cache hit logic)
        print(f"DEBUG: Cache HIT for key: {cache_key}")
        if isinstance(cached_result, dict) and "data" in cached_result and "total_count" in cached_result:
             return cached_result
        else: print(f"WARNING: Invalid cached data for {cache_key}. Fetching fresh.")

    data = []
    total_records = 0

    try:
        if is_item_search_bool and search_term and doctype in JSON_ITEM_SEARCH_DOCTYPE_MAP:
            # --- *** CORRECTED Item Search Workaround (Two-Step) *** ---
            print("--- Executing Item Search Workaround (Two-Step) ---")
            search_config = JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype]
            json_field_name = search_config["json_field"]
            item_path_parts = search_config["item_path_parts"]
            item_name_key_in_json = search_config.get("item_name_key_in_json", item_path_parts[-1] if item_path_parts else "item")
            
            escaped_search_term_for_like = f"%{search_term}%"

            # Step 1: Get names matching base filters (using DatabaseQuery for permissions)
            parent_names_query_args = {
                "doctype": doctype,
                "filters": parsed_base_filters_list, # Apply base filters here
                "fields": ["name"],
                "limit_page_length": 0 # Fetch all matching names
            }
            print(f"DEBUG (ItemSearch-Step1): Fetching parent names with args: {parent_names_query_args}")
            potential_parent_docs = reportview_execute(**parent_names_query_args)
            potential_parent_names = [doc.get("name") for doc in potential_parent_docs if doc.get("name")]

            if not potential_parent_names:
                print("DEBUG (ItemSearch-Step1): No parent documents found matching base filters.")
                total_records, data = 0, []
            else:
                print(f"DEBUG (ItemSearch-Step1): Found {len(potential_parent_names)} potential parents.")

                # Step 2: Filter these names using raw SQL JSON search
                if not item_path_parts or len(item_path_parts) < 2 or item_path_parts[-2] != "*":
                     frappe.throw(_(f"Invalid item_path_parts config: {item_path_parts}"))
                json_array_key = item_path_parts[0]

                json_search_sql_where_part = f"""
                    EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements(COALESCE(`tab{doctype}`.`{json_field_name}`::jsonb->'{json_array_key}', '[]'::jsonb)) AS item_obj
                        WHERE item_obj->>'{item_name_key_in_json}' ILIKE %(search_term)s
                    )
                """
                # Parameters for the raw SQL part
                sql_params = {"search_term": escaped_search_term_for_like, "names_tuple": tuple(potential_parent_names)}

                # Get count of names matching BOTH base filters (via names_tuple) AND JSON condition
                count_sql = f"""
                    SELECT COUNT(DISTINCT name) FROM `tab{doctype}`
                    WHERE name IN %(names_tuple)s AND ({json_search_sql_where_part})
                """
                print(f"DEBUG (ItemSearch-Step2): Count SQL: {count_sql}")
                print(f"DEBUG (ItemSearch-Step2): SQL Params for Count: {sql_params}")
                count_result = frappe.db.sql(count_sql, sql_params)
                total_records = count_result[0][0] if count_result and count_result[0] else 0
                print(f"DEBUG (ItemSearch-Step2): Total records after JSON filter: {total_records}")

                if total_records > 0:
                    # Fetch the names that actually matched the JSON condition
                    # This is needed to apply pagination/sorting correctly in the final query
                    data_names_sql = f"""
                        SELECT DISTINCT name FROM `tab{doctype}`
                        WHERE name IN %(names_tuple)s AND ({json_search_sql_where_part})
                    """
                    print(f"DEBUG (ItemSearch-Step2): Name SQL: {data_names_sql}")
                    print(f"DEBUG (ItemSearch-Step2): SQL Params for Names: {sql_params}")
                    final_matching_names_result = frappe.db.sql(data_names_sql, sql_params, as_list=True)
                    final_matching_names = [r[0] for r in final_matching_names_result]

                    if final_matching_names:
                        # Step 3: Fetch full data using DatabaseQuery, filtering by the final names list
                        # and applying pagination/sorting. This ensures permissions are checked again
                        # on the final data set and uses the standard query engine.
                        data_args = frappe._dict({
                            "doctype": doctype,
                            "fields": parsed_select_fields_str_list,
                            "filters": [["name", "in", final_matching_names]], # Filter only by matching names
                            "order_by": _formatted_order_by,
                            "limit_start": start,
                            "limit_page_length": page_length,
                            "ignore_permissions": False, # Let DBQuery handle permissions
                            "strict": False
                        })
                        print(f"DEBUG (ItemSearch-Step3): Calling final reportview_execute with args: {data_args}")
                        data = reportview_execute(**data_args)
                    else: data = []
                else: data = []
            print(f"--- Finished Item Search Workaround (Two-Step) ---")
            # --- *** END CORRECTED Two-Step Query *** ---

        else:
            # --- Perform Standard Global Search (Default) ---
            print("--- Executing Standard Global Search ---")
            std_and_filters, std_or_filters = _build_standard_filters(
                doctype=doctype,
                base_filters=parsed_base_filters_list,
                search_term=search_term,
                global_search_fields=parsed_global_search_fields_for_standard_search
            )
            data_args = frappe._dict({
                "doctype": doctype, "fields": parsed_select_fields_str_list,
                "filters": std_and_filters, "or_filters": std_or_filters,
                "order_by": _formatted_order_by, "limit_start": start,
                "limit_page_length": page_length, "ignore_permissions": False, "strict": False,
            })
            count_args = {
                "filters": std_and_filters, "or_filters": std_or_filters,
                "fields": [f"count(distinct `tab{doctype}`.`name`) as total_count"]
            }
            print(f"DEBUG (StandardSearch): Calling reportview_execute with data_args: {data_args}")
            data = reportview_execute(**data_args)
            print(f"DEBUG (StandardSearch): Calling DatabaseQuery for count with count_args: {count_args}")
            count_result = DatabaseQuery(doctype).execute(**count_args)
            total_records = count_result[0].get("total_count") if count_result else 0
            print("--- Finished Standard Global Search ---")

        final_result = {"data": data, "total_count": total_records}
        frappe.cache().set_value(cache_key, final_result, expires_in_sec=CACHE_EXPIRY)
        print(f"DEBUG: Result stored in cache with key: {cache_key}")
        return final_result

    except frappe.PermissionError:
         print("ERROR: PermissionError caught")
         raise
    except Exception as e:
        print(f"ERROR: Final Exception caught in API: {type(e).__name__} - {str(e)}")
        print("--- FINAL TRACEBACK START (API) ---")
        traceback.print_exc()
        print("--- FINAL TRACEBACK END (API) ---")
        frappe.throw(_("An error occurred while processing your request. Please check server logs or contact support."))