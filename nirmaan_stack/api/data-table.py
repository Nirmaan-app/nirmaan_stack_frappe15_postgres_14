import frappe
from frappe import _
from frappe.utils import cint, cstr # cstr is not used, can remove if not needed elsewhere
from frappe.model.db_query import DatabaseQuery
import json
import traceback # For more detailed error logging

# Define constants for clarity and maintainability
DEFAULT_PAGE_LENGTH = 10
MAX_PAGE_LENGTH = 500  # Prevent excessively large requests

@frappe.whitelist()
def get_list_with_count(
    doctype: str,
    fields: str | list[str],
    filters: str | list | dict | None = None,
    order_by: str | None = None,
    limit_start: int | str = 0,
    limit_page_length: int | str | None = None,
    search_term: str | None = None,
    search_fields: str | list[str] | None = None,
    global_search: bool | str = False
) -> dict:
    # --- DEBUG PRINT: API Entry ---
    print(f"\n--- API CALL: get_list_with_count ---")
    print(f"ARGS: doctype='{doctype}', fields_arg_type={type(fields)}, filters_arg_type={type(filters)}, search_term='{search_term}', global_search={global_search}")

    try:
        # --- Input Sanitization and Preparation ---
        if not frappe.has_permission(doctype, "read"):
            frappe.throw(_("Not permitted"), frappe.PermissionError)

        limit_start = cint(limit_start)
        if limit_page_length is None:
            page_length = DEFAULT_PAGE_LENGTH
        else:
            page_length = min(cint(limit_page_length), MAX_PAGE_LENGTH)

        # Handle stringified JSON inputs for 'fields'
        if isinstance(fields, str):
            print(f"DEBUG: 'fields' is a string, attempting JSON parse: {fields}")
            try:
                fields = json.loads(fields)
                print(f"DEBUG: 'fields' parsed from JSON: {fields}, type: {type(fields)}")
            except json.JSONDecodeError as je:
                error_msg = f"Invalid 'fields' JSON format. String was: '{fields}'. Error: {str(je)}"
                print(f"ERROR: {error_msg}")
                frappe.log_error(error_msg, "get_list_with_count API")
                frappe.throw(_(error_msg))
        
        if not isinstance(fields, list) or not all(isinstance(f, str) for f in fields):
            error_msg = f"CRITICAL: 'fields' must be a list of strings after preparation. Value: {fields}, Type: {type(fields)}"
            print(f"ERROR: {error_msg}")
            frappe.log_error(error_msg, "get_list_with_count API")
            frappe.throw(_("Internal Server Error: Invalid fields format. Check logs."))

        if "name" not in fields:
            fields.insert(0, "name")
            print(f"DEBUG: 'name' added to fields. Current fields: {fields}")

        # --- DEBUG PRINT: Parsed Inputs ---
        print(f"DEBUG: search_term='{search_term}', parsed_search_fields_input='{search_fields}', global_search_bool={global_search}, initial_filters_input='{filters}'")

        parsed_filters = parse_filters(filters, doctype) # Pass doctype for logging
        parsed_search_fields = parse_search_fields(search_fields, doctype) # Pass doctype for logging

        if isinstance(global_search, str):
            global_search = global_search.lower() == 'true'
        print(f"DEBUG: Final global_search (bool): {global_search}")

        # --- Build Filters (including search) ---
        query_filters = build_query_filters(
            doctype, parsed_filters, search_term, parsed_search_fields, global_search
        )
        print(f"DEBUG: Built query_filters from build_query_filters: {query_filters}")


        # --- Get Total Count ---
        print(f"DEBUG: >>> About to call Frappe DBQuery for COUNT <<<")
        print(f"DEBUG: Count Query doctype = {doctype}")
        print(f"DEBUG: Count Query filters = {query_filters}")
        count_query = DatabaseQuery(doctype)
        count_query.filters = query_filters # Original print from your log
        total_count_result = count_query.execute(limit=1, fields=["count(*) as count"], as_list=True)
        total_records = total_count_result[0][0] if total_count_result else 0
        print(f"DEBUG: Total records from count query = {total_records}")


        # --- Get Paginated Data (THIS IS WHERE THE ERROR ORIGINATES) ---
        print(f"\n--- DEBUG SESSION MARKER (get_list) ---")
        print(f"DEBUG: DocType for data fetch = {doctype}")
        print(f"DEBUG: Fields for data fetch = {fields}")
        print(f"DEBUG: Type of 'fields' for data fetch = {type(fields)}")
        if isinstance(fields, list):
            for i, f_item in enumerate(fields):
                print(f"DEBUG: fields_for_data_fetch[{i}] = {f_item}, type = {type(f_item)}")
        else:
            print(f"CRITICAL DEBUG: 'fields_for_data_fetch' IS NOT A LIST!")

        print(f"DEBUG: Filters for data fetch = {query_filters}")
        print(f"DEBUG: Type of 'query_filters' for data fetch = {type(query_filters)}")
        # (Optional detailed print for query_filters items if needed)

        print(f"DEBUG: Order By = {order_by or 'creation desc'}")
        print(f"DEBUG: Limit Start = {limit_start}")
        print(f"DEBUG: Limit Page Length = {page_length}")
        print(f"--- END DEBUG SESSION MARKER (get_list) ---\n")

        data = frappe.get_list(
            doctype=doctype,
            fields=fields,
            filters=query_filters,
            order_by=order_by or "creation desc",
            limit_start=limit_start,
            limit_page_length=page_length,
            ignore_permissions=False,
            strict=False
        )

        return {"data": data, "total_count": total_records}

    except frappe.PermissionError:
        print("ERROR: PermissionError caught in get_list_with_count")
        raise
    except Exception as e:
        print(f"ERROR: Exception caught in get_list_with_count: {type(e).__name__} - {str(e)}")
        # Log the full traceback using print for console visibility
        print("--- TRACEBACK START ---")
        traceback.print_exc()
        print("--- TRACEBACK END ---")
        frappe.log_error(traceback.format_exc(), f"get_list_with_count API Error (DocType: {doctype})") # Also log to Frappe logs
        frappe.throw(_("An error occurred while fetching data: {0}. Check server logs and console output for details.").format(str(e)))


# --- Helper Functions (Modified for print debugging) ---

def parse_filters(filters_input: str | list | dict | None, doctype_for_log: str) -> list | dict:
    print(f"DEBUG (parse_filters for {doctype_for_log}): Input type = {type(filters_input)}, Value = {filters_input}")
    if isinstance(filters_input, str):
        try:
            parsed = json.loads(filters_input)
            print(f"DEBUG (parse_filters for {doctype_for_log}): Parsed from JSON string = {parsed}")
            return parsed
        except json.JSONDecodeError:
            # Simplified: Assume if string and not valid JSON, it's an error or needs specific handling not yet implemented
            print(f"WARNING (parse_filters for {doctype_for_log}): JSONDecodeError for string filters. String was: '{filters_input}'. Returning empty dict.")
            # Consider frappe.throw if string filters should always be valid JSON
            return {}
    parsed_val = filters_input or {}
    print(f"DEBUG (parse_filters for {doctype_for_log}): Returning directly or as empty dict = {parsed_val}")
    return parsed_val

def parse_search_fields(search_fields_input: str | list[str] | None, doctype_for_log: str) -> list[str] | None:
    print(f"DEBUG (parse_search_fields for {doctype_for_log}): Input type = {type(search_fields_input)}, Value = {search_fields_input}")
    if isinstance(search_fields_input, str):
        try:
            fields_list = json.loads(search_fields_input)
            if isinstance(fields_list, list) and all(isinstance(f, str) for f in fields_list):
                print(f"DEBUG (parse_search_fields for {doctype_for_log}): Parsed from JSON string = {fields_list}")
                return fields_list
            else:
                print(f"ERROR (parse_search_fields for {doctype_for_log}): Invalid format after JSON parse. Expected list of strings. Got: {fields_list}")
                frappe.throw(_("Invalid 'search_fields' format. Expected list of strings or valid JSON string array."))
        except json.JSONDecodeError:
            print(f"ERROR (parse_search_fields for {doctype_for_log}): Invalid 'search_fields' JSON format. String was: {search_fields_input}")
            frappe.throw(_("Invalid 'search_fields' JSON format."))
    elif isinstance(search_fields_input, list) and all(isinstance(f, str) for f in search_fields_input):
        print(f"DEBUG (parse_search_fields for {doctype_for_log}): Returning list directly = {search_fields_input}")
        return search_fields_input
    elif search_fields_input is None:
        print(f"DEBUG (parse_search_fields for {doctype_for_log}): Returning None.")
        return None
    else:
        print(f"ERROR (parse_search_fields for {doctype_for_log}): Invalid 'search_fields' type. Expected list of strings, JSON string array, or None. Got: {type(search_fields_input)}")
        frappe.throw(_("Invalid 'search_fields' type."))
    return None # Should be unreachable if throws are effective


def build_query_filters(
    doctype: str,
    base_filters: list | dict,
    search_term: str | None,
    search_fields: list[str] | None,
    global_search: bool
) -> list | dict:
    print(f"\n--- DEBUG (build_query_filters for {doctype}) ---")
    print(f"Input: base_filters={base_filters}, search_term='{search_term}', search_fields={search_fields}, global_search={global_search}")

    if isinstance(base_filters, dict):
        query_filters_list = [[k, "=", v] for k, v in base_filters.items()]
        if base_filters:
             print(f"WARNING (build_query_filters for {doctype}): Dictionary base_filters {base_filters} converted to list format: {query_filters_list}")
             # frappe.msgprint might not be ideal here if we are deep in backend logic. Print is safer for now.
    else:
        query_filters_list = list(base_filters) if base_filters else []
    print(f"DEBUG (build_query_filters for {doctype}): Initial query_filters_list = {query_filters_list}")

    if search_term:
        search_term_sql = f"%{search_term}%"
        try:
            meta = frappe.get_meta(doctype)
            print(f"DEBUG (build_query_filters for {doctype}): Meta object obtained successfully.")
        except Exception as e:
            print(f"ERROR (build_query_filters for {doctype}): Could not get meta for doctype {doctype}: {str(e)}")
            frappe.log_error(f"Could not get meta for doctype {doctype}: {str(e)}", f"BuildQueryFilters {doctype}")
            return query_filters_list # Return current filters

        if global_search:
            print(f"DEBUG (build_query_filters for {doctype}): Global search is ON.")
            # meta.get_search_fields() returns fields marked "In Global Search"
            configured_search_fields = meta.get_search_fields()
            print(f"DEBUG (build_query_filters for {doctype}): meta.get_search_fields() returned: {configured_search_fields}")

            if not configured_search_fields:
                 if meta.has_field("name"):
                     all_searchable_fields = ["name"]
                     print(f"WARNING (build_query_filters for {doctype}): No specific 'in_global_search' fields. Using ['name'] for global search.")
                 else:
                     print(f"ERROR (build_query_filters for {doctype}): Global search enabled, but no 'in_global_search' fields and 'name' field not found. Skipping text search.")
                     return query_filters_list
            else:
                all_searchable_fields = configured_search_fields
            print(f"DEBUG (build_query_filters for {doctype}): Effective fields for global search: {all_searchable_fields}")

            global_search_conditions = []
            for field_name in all_searchable_fields:
                field_exists_in_meta = meta.has_field(field_name)
                print(f"DEBUG (build_query_filters for {doctype}): Checking global field '{field_name}'. Exists in meta: {field_exists_in_meta}")

                if field_name == "name": # 'name' is implicitly searchable
                    global_search_conditions.append([doctype, field_name, "like", search_term_sql])
                    print(f"DEBUG (build_query_filters for {doctype}): Added global search condition for 'name'")
                    continue

                if field_exists_in_meta:
                    df = meta.get_field(field_name)
                    # frappe.model.no_value_fields includes 'Section Break', 'Column Break', 'HTML', 'Button', 'Image', 'Fold', 'Read Only' etc.
                    if df and df.fieldtype not in frappe.model.no_value_fields and df.fieldtype not in ("Table", "Table MultiSelect", "Attach Image", "Attach"): # Added Attach
                         global_search_conditions.append([doctype, field_name, "like", search_term_sql])
                         print(f"DEBUG (build_query_filters for {doctype}): Added global search condition for '{field_name}' (type: {df.fieldtype})")
                    else:
                         print(f"DEBUG (build_query_filters for {doctype}): Skipping non-queryable global field '{field_name}' (Type: {df.fieldtype if df else 'N/A'})")
                else:
                    # This is a critical warning
                    print(f"CRITICAL WARNING (build_query_filters for {doctype}): Field '{field_name}' from meta.get_search_fields() not found by meta.has_field(). Metadata inconsistent!")
                    # Optionally log to frappe.log_error as well
                    frappe.log_error(f"Metadata inconsistency in {doctype}: Field '{field_name}' from get_search_fields() not found by has_field()", "BuildQueryFilters Critical")


            if global_search_conditions:
                # Frappe expects OR conditions to be a list starting with "or"
                # e.g., ["or", [condition1], [condition2]]
                # If query_filters_list is empty, the global search is the only filter.
                # If query_filters_list has existing AND conditions, the new OR block is ANDed with them.
                # Example: [ ["status", "=", "Open"], ["or", [global_search_cond1], [global_search_cond2]] ]
                if not query_filters_list:
                     query_filters_list = ["or"] + global_search_conditions # This structure is for top-level OR
                     # If you want this OR block to be the *only* filter, and it contains multiple conditions, it should be:
                     # query_filters_list = [ ["or"] + global_search_conditions ] # If it's a single OR block.
                     # However, frappe.get_list handles `filters = ["or", ["Items", "name", "like", "%val%"], ["Items", "desc", "like", "%val%"]]`
                     # Let's stick to your previous logic which was: query_filters = global_search_filter
                     # where global_search_filter = ["or"] + global_search_conditions
                     # This means if base_filters were empty, query_filters becomes ["or", cond1, cond2, ...]
                     # This structure is directly consumable by frappe.get_list filters.
                     query_filters_list = ["or"] + global_search_conditions
                     print(f"DEBUG (build_query_filters for {doctype}): Global search is the only filter: {query_filters_list}")
                else:
                     # Append the OR block as another AND condition
                     query_filters_list.append(["or"] + global_search_conditions)
                     print(f"DEBUG (build_query_filters for {doctype}): Appended global search OR block to existing filters: {query_filters_list}")
            else:
                print(f"WARNING (build_query_filters for {doctype}): Global search for '{search_term}' yielded no searchable conditions.")

        elif search_fields: # Specific field search
            print(f"DEBUG (build_query_filters for {doctype}): Specific field search for fields: {search_fields}")
            for field_name in search_fields:
                field_exists_in_meta = meta.has_field(field_name)
                print(f"DEBUG (build_query_filters for {doctype}): Checking specific field '{field_name}'. Exists in meta: {field_exists_in_meta}")
                if field_exists_in_meta:
                    df = meta.get_field(field_name)
                    if df and df.fieldtype not in frappe.model.no_value_fields and df.fieldtype not in ("Table", "Table MultiSelect", "Attach Image", "Attach"):
                        query_filters_list.append([doctype, field_name, "like", search_term_sql])
                        print(f"DEBUG (build_query_filters for {doctype}): Added specific search condition for '{field_name}'")
                    else:
                         print(f"DEBUG (build_query_filters for {doctype}): Skipping non-queryable specific field '{field_name}' (Type: {df.fieldtype if df else 'N/A'})")
                else:
                    print(f"WARNING (build_query_filters for {doctype}): Specific search field '{field_name}' not found in DocType '{doctype}'. Skipping.")

    print(f"DEBUG (build_query_filters for {doctype}): Final query_filters_list being returned: {query_filters_list}")
    print(f"--- END DEBUG (build_query_filters for {doctype}) ---\n")
    return query_filters_list




# import frappe
# from frappe import _
# from frappe.utils import cint, cstr
# from frappe.model.db_query import DatabaseQuery
# import json

# # Define constants for clarity and maintainability
# DEFAULT_PAGE_LENGTH = 10
# MAX_PAGE_LENGTH = 500  # Prevent excessively large requests

# @frappe.whitelist()
# def get_list_with_count(
#     doctype: str,
#     fields: str | list[str],
#     filters: str | list | dict | None = None,
#     order_by: str | None = None,
#     limit_start: int | str = 0,
#     limit_page_length: int | str | None = None,
#     search_term: str | None = None,
#     search_fields: str | list[str] | None = None,
#     global_search: bool | str = False
# ) -> dict:
#     """
#     Fetches a paginated list of documents along with the total count
#     matching the filters, optimized into a single endpoint.

#     Args:
#         doctype (str): The DocType name.
#         fields (str | list[str]): List of fields to fetch or JSON string of fields.
#         filters (str | list | dict | None): Filters as a list/dict or JSON string.
#         order_by (str | None): Order by clause (e.g., "creation desc").
#         limit_start (int | str): Starting row index for pagination.
#         limit_page_length (int | str | None): Number of records per page.
#         search_term (str | None): Text search term.
#         search_fields (str | list[str] | None): Specific fields to apply search_term (JSON string or list).
#                                                 Required if global_search is False.
#         global_search (bool | str): If True, search_term is applied across all searchable fields.
#                                     Can be passed as boolean or string "true"/"false".

#     Returns:
#         dict: {"data": list[dict], "total_count": int}
#     """
#     try:
#         # --- Input Sanitization and Preparation ---
#         if not frappe.has_permission(doctype, "read"):
#             frappe.throw(_("Not permitted"), frappe.PermissionError)

#         limit_start = cint(limit_start)
#         if limit_page_length is None:
#             page_length = DEFAULT_PAGE_LENGTH
#         else:
#             page_length = min(cint(limit_page_length), MAX_PAGE_LENGTH) # Enforce max page length

#         # Handle stringified JSON inputs from JS/HTTP requests
#         if isinstance(fields, str):
#             try:
#                 fields = json.loads(fields)
#             except json.JSONDecodeError:
#                 frappe.throw(_("Invalid 'fields' format. Expected list or valid JSON string."))
#         if not isinstance(fields, list):
#              frappe.throw(_("'fields' must be a list."))
#         # Ensure 'name' is always included if not present, often needed for keys/links
#         if "name" not in fields:
#             fields.insert(0, "name")
        
#         print(f"search_term",search_term)
#         print(f"search_fields", search_fields)
#         print(f"global_search", global_search)
#         print(f"filters", filters)


#         parsed_filters = parse_filters(filters)
#         parsed_search_fields = parse_search_fields(search_fields)

#         # Convert global_search string to boolean if necessary
#         if isinstance(global_search, str):
#             global_search = global_search.lower() == 'true'

#         # --- Build Filters (including search) ---
#         query_filters = build_query_filters(
#             doctype, parsed_filters, search_term, parsed_search_fields, global_search
#         )

#         # --- Get Total Count (Optimized) ---
#         # We use a separate query for count for better performance and clarity,
#         # especially with complex filters or large datasets. Frappe's get_list
#         # can sometimes be less efficient for *just* the count with pagination params.
#         count_query = DatabaseQuery(doctype)
#         print("query_filters", query_filters) # Debugging
#         count_query.filters = query_filters
#         total_count = count_query.execute(limit=1, fields=["count(*) as count"], as_list=True) # Efficient count
#         total_records = total_count[0][0] if total_count else 0


#         # --- Get Paginated Data ---
#         # Use Frappe's built-in get_list for data fetching as it handles permissions, translations etc.
#         data = frappe.get_list(
#             doctype=doctype,
#             fields=fields,
#             filters=query_filters,
#             order_by=order_by or "creation desc", # Default sort order
#             limit_start=limit_start,
#             limit_page_length=page_length,
#             ignore_permissions=False, # Important: Respect user permissions
#             strict=False # Allow unknown fields in filters if needed, adjust as per policy
#         )

#         return {
#             "data": data,
#             "total_count": total_records
#         }

#     except frappe.PermissionError:
#         raise # Re-raise permission errors to be handled by Frappe framework
#     except Exception as e:
#         frappe.log_error(frappe.get_traceback(), "get_list_with_count API Error")
#         frappe.throw(_("An error occurred while fetching data: {0}").format(str(e)))


# # --- Helper Functions ---

# def parse_filters(filters: str | list | dict | None) -> list | dict:
#     """ Parses filters from JSON string if necessary. """
#     if isinstance(filters, str):
#         try:
#             return json.loads(filters)
#         except json.JSONDecodeError:
#             # Handle potential malformed simple filters like `[["field", "like", "%val%"]]`
#             # This is basic; a more robust parser might be needed for complex string filters
#             if filters.startswith('[') and filters.endswith(']'):
#                  try:
#                      # Attempt eval carefully ONLY if it looks like a list of lists/tuples
#                      # SECURITY NOTE: Avoid eval on arbitrary user input in production without heavy sanitization.
#                      # Consider a dedicated safe parsing library if complex string filters are common.
#                      # For now, assume JSON or Python list/dict is passed from frontend hook.
#                      # parsed = eval(filters) # AVOID THIS IF POSSIBLE
#                      # if isinstance(parsed, list): return parsed
#                      frappe.throw(_("Invalid 'filters' format. Use JSON string or pass list/dict directly."))
#                  except Exception:
#                     frappe.throw(_("Invalid 'filters' format. Use JSON string or pass list/dict directly."))
#             return {} # Default to empty if parsing fails
#     return filters or {} # Return as is if already list/dict, or default to empty dict

# def parse_search_fields(search_fields: str | list[str] | None) -> list[str] | None:
#     """ Parses search_fields from JSON string if necessary. """
#     if isinstance(search_fields, str):
#         try:
#             fields = json.loads(search_fields)
#             if isinstance(fields, list) and all(isinstance(f, str) for f in fields):
#                 return fields
#             else:
#                  frappe.throw(_("Invalid 'search_fields' format. Expected list of strings or valid JSON string array."))
#         except json.JSONDecodeError:
#              frappe.throw(_("Invalid 'search_fields' JSON format."))
#     elif isinstance(search_fields, list) and all(isinstance(f, str) for f in search_fields):
#         return search_fields
#     elif search_fields is None:
#         return None
#     else:
#         frappe.throw(_("Invalid 'search_fields' type. Expected list of strings, JSON string array, or None."))



# def build_query_filters(
#     doctype: str,
#     base_filters: list | dict,
#     search_term: str | None,
#     search_fields: list[str] | None,
#     global_search: bool
# ) -> list | dict:
#     """ Combines base filters with search filters. """

#     if isinstance(base_filters, dict):
#         query_filters = [[k, "=", v] for k, v in base_filters.items()]
#         if base_filters:
#              frappe.msgprint(f"Warning: Dictionary filters {base_filters} converted to list format for {doctype}. Ensure this is intended.", indicator="orange", alert=True)
#     else:
#         query_filters = list(base_filters) if base_filters else []

#     # frappe.log_info(f"Initial query_filters for {doctype}: {query_filters}", "BuildQueryFilters") # More detailed log

#     if search_term:
#         search_term_sql = f"%{search_term}%"
#         try:
#             meta = frappe.get_meta(doctype)
#         except Exception as e:
#             frappe.log_error(f"Could not get meta for doctype {doctype}: {str(e)}", "BuildQueryFilters")
#             # Depending on policy, you might want to return query_filters or raise
#             return query_filters


#         if global_search:
#             actual_search_fields = meta.get_search_fields() # Fields marked in_global_search
#             # frappe.log_info(f"Meta search fields for {doctype}: {actual_search_fields}", "BuildQueryFilters")

#             # Fallback logic if no search fields defined in meta
#             if not actual_search_fields:
#                  if meta.has_field("name"):
#                      all_searchable_fields = ["name"]
#                      frappe.msgprint(_("No specific search fields defined via 'in_global_search' for {0}. Using 'name' for global search.").format(doctype), indicator="orange")
#                  else:
#                      # This case should be extremely rare if meta is loaded correctly
#                      frappe.msgprint(_("Global search enabled, but no 'in_global_search' fields and 'name' field not found for DocType {0}. Skipping text search.").format(doctype), indicator="red", alert=True)
#                      return query_filters
#             else:
#                 all_searchable_fields = actual_search_fields

#             # frappe.log_info(f"Effective fields for global search on {doctype}: {all_searchable_fields}", "BuildQueryFilters")

#             global_search_conditions = []
#             for field_name in all_searchable_fields:
#                 # frappe.log_info(f"Checking field '{field_name}' for global search on {doctype}. Exists in meta: {meta.has_field(field_name)}", "BuildQueryFilters")

#                 # 'name' is implicitly searchable and always exists if meta is correct
#                 if field_name == "name":
#                     global_search_conditions.append([doctype, field_name, "like", search_term_sql])
#                     # frappe.log_info(f"Added 'name' field condition for global search on {doctype}", "BuildQueryFilters")
#                     continue

#                 if meta.has_field(field_name):
#                     df = meta.get_field(field_name)
#                     if df and df.fieldtype not in frappe.model.no_value_fields and df.fieldtype not in ("Table", "Table MultiSelect", "Attach Image"): # More comprehensive list
#                          global_search_conditions.append([doctype, field_name, "like", search_term_sql])
#                          # frappe.log_info(f"Added condition for field '{field_name}' (type: {df.fieldtype}) for global search on {doctype}", "BuildQueryFilters")
#                     else:
#                          frappe.log_info(f"Skipping non-queryable or unsuitable field '{field_name}' (Type: {df.fieldtype if df else 'N/A'}) for global search on {doctype}", "BuildQueryFilters")
#                 else:
#                     # This is a critical warning if a field from get_search_fields() is not found by has_field()
#                     frappe.log_warning(f"Field '{field_name}' was listed in get_search_fields for {doctype} but meta.has_field returned False. Metadata might be inconsistent.", "BuildQueryFilters Critical")


#             if global_search_conditions:
#                 global_search_filter = ["or"] + global_search_conditions
#                 if not query_filters:
#                      query_filters = global_search_filter
#                 else:
#                      query_filters.append(global_search_filter)
#             else:
#                 frappe.msgprint(_("Global search for '{term}' on {doctype} yielded no searchable conditions after field validation.").format(term=search_term, doctype=doctype), indicator="orange")

#         elif search_fields: # Specific field search
#             added_specific_filter = False
#             for field_name in search_fields:
#                 # frappe.log_info(f"Checking specific field '{field_name}' for search on {doctype}. Exists in meta: {meta.has_field(field_name)}", "BuildQueryFilters")
#                 if meta.has_field(field_name):
#                     df = meta.get_field(field_name)
#                     if df and df.fieldtype not in frappe.model.no_value_fields and df.fieldtype not in ("Table", "Table MultiSelect", "Attach Image"):
#                         query_filters.append([doctype, field_name, "like", search_term_sql])
#                         added_specific_filter = True
#                     else:
#                          frappe.log_info(f"Skipping non-queryable specific field '{field_name}' (Type: {df.fieldtype if df else 'N/A'}) for search on {doctype}", "BuildQueryFilters")
#                 else:
#                     frappe.msgprint(_("Warning: Search field '{0}' not found in DocType '{1}'. Skipping.").format(field_name, doctype), indicator="orange")
#             # if added_specific_filter and not query_filters: pass # Logic seems fine

#     # frappe.log_info(f"Final query_filters for {doctype} before returning: {query_filters}", "BuildQueryFilters")
#     return query_filters

# ---
# Important considerations for the main `get_list_with_count` function:
# 1. Error Handling for `json.loads(fields)`: Add a more specific error message or log the problematic string.
#    Example:
#    if isinstance(fields, str):
#        try:
#            fields = json.loads(fields)
#        except json.JSONDecodeError as je:
#            frappe.log_error(f"JSONDecodeError for 'fields' string: {fields}\nError: {str(je)}", "get_list_with_count API")
#            frappe.throw(_("Invalid 'fields' format. Expected list or valid JSON string. Check server logs for details."))
#
# 2. `strict=False` in `frappe.get_list`: This is powerful but can sometimes hide issues or lead to unexpected behavior if field names are ambiguous (e.g., exist in parent and child).
#    If the AttributeError persists even after metadata fixes, as a last resort for debugging, you could try `strict=True` to see if it changes the error or behavior. This would mean you can only filter/fetch fields directly belonging to the main DocType.
# ---



# def build_query_filters(
#     doctype: str,
#     base_filters: list | dict,
#     search_term: str | None,
#     search_fields: list[str] | None,
#     global_search: bool
# ) -> list | dict:
#     """ Combines base filters with search filters. """

#     # Start with base filters, ensuring it's a list for easier manipulation
#     if isinstance(base_filters, dict):
#         # Convert dict filters to list format if necessary for consistency
#         # This basic conversion might need enhancement for complex dict filters
#         query_filters = [[k, "=", v] for k, v in base_filters.items()] # Example conversion
#         # Or handle dict filters separately if they are fundamentally different
#         # For now, assume list format is preferred when combining with search
#         if base_filters:
#              frappe.msgprint(_("Warning: Combining dictionary filters with search might require specific handling. Assuming list format."), indicator="orange")
#     else:
#         # Create a copy if it's already a list or initialize empty list
#         query_filters = list(base_filters) if base_filters else []

#     print("global_search", global_search) # Keep for debugging if needed

#     if search_term:
#         search_term_sql = f"%{search_term}%"
#         meta = frappe.get_meta(doctype) # Get meta once

#         if global_search:
#             all_search_fields = meta.get_search_fields()
#             print("all_search_fields", all_search_fields) # Debugging

#             # Fallback logic if no search fields defined
#             if not all_search_fields:
#                  if meta.has_field("name"): # Check if 'name' field exists
#                      all_search_fields = ["name"]
#                      frappe.msgprint(_("No specific search fields defined for {0}. Using 'name' for global search.").format(doctype), indicator="orange")
#                  else:
#                      frappe.msgprint(_("Global search enabled, but no searchable fields (including 'name') defined for DocType {0}. Skipping text search.").format(doctype), indicator="orange")
#                      return query_filters # Return only base filters

#             # Build the OR condition list
#             global_search_conditions = []
#             for field in all_search_fields:
#                 print(f"Checking field: {field}, Exists: {meta.has_field(field)}") # Debugging

#                  # --- Updated Check ---
#                 # Treat 'name' specially, assume always searchable via DBQuery
#                 if field == "name":
#                      global_search_conditions.append([doctype, field, "like", search_term_sql])
#                      print(f"Adding condition for implicit field: {field}") # Debugging
#                      continue # Skip further checks for 'name'
#                 # *** CRUCIAL: Check if the field actually exists in DB ***
#                 if meta.has_field(field):
#                     # Ensure field is queryable (basic check, might need more nuance)
#                     df = meta.get_field(field)
#                     if df and df.fieldtype not in ["HTML", "Section Break", "Column Break", "Button", "Read Only", "Table", "Table MultiSelect"]:
#                          global_search_conditions.append([doctype, field, "like", search_term_sql])
#                     else:
#                          print(f"Skipping non-queryable field: {field} (Type: {df.fieldtype if df else 'N/A'})") # Debugging
#                 else:
#                     print(f"Skipping field not found in meta.has_field: {field}") # Debugging


#             # Only add the 'or' filter if there are valid conditions to check
#             if global_search_conditions:
#                 global_search_filter = ["or"] + global_search_conditions

#                 # --- *** THE CORE FIX *** ---
#                 # If there were no base filters, the global search is the *only* filter.
#                 if not query_filters: # Check if the original base filters were empty
#                      query_filters = global_search_filter # Assign directly, don't wrap
#                 else:
#                 # If there were base filters, append the OR condition list to them.
#                      query_filters.append(global_search_filter)
#             else:
#                 frappe.msgprint(_("Global search enabled, but no valid searchable fields found after check for DocType {0}. Skipping text search.").format(doctype), indicator="orange")


#         elif search_fields:
#             # Specific field search (AND conditions)
#             added_specific_filter = False
#             for field in search_fields:
#                  print(f"Checking specific field: {field}, Exists: {meta.has_field(field)}") # Debugging
#                  if meta.has_field(field):
#                      df = meta.get_field(field)
#                      # Add similar check for queryable field types if needed
#                      if df and df.fieldtype not in ["HTML", "Section Break", "Column Break", "Button", "Read Only", "Table", "Table MultiSelect"]:
#                         query_filters.append([doctype, field, "like", search_term_sql])
#                         added_specific_filter = True
#                      else:
#                           print(f"Skipping non-queryable specific field: {field} (Type: {df.fieldtype if df else 'N/A'})") # Debugging
#                  else:
#                      frappe.msgprint(_("Warning: Search field '{0}' not found in DocType '{1}'. Skipping.").format(field, doctype), indicator="orange")

#             # Optional: Reset page if specific filters were added? (Handled in frontend ideally)
#             # if added_specific_filter and not query_filters: # Check if query_filters was initially empty
#                  # This logic might be better placed in frontend to reset pagination state
#                 # pass


#     print("Final query_filters being used:", query_filters) # Debugging
#     return query_filters


    # def build_query_filters(
#     doctype: str,
#     base_filters: list | dict,
#     search_term: str | None,
#     search_fields: list[str] | None,
#     global_search: bool
# ) -> list | dict:
#     """ Combines base filters with search filters. """
#     query_filters = base_filters.copy() if isinstance(base_filters, dict) else list(base_filters)

#     if search_term:
#         search_term_sql = f"%{search_term}%"

#         if global_search:
#             # Get searchable fields from DocType meta
#             meta = frappe.get_meta(doctype)
#             all_search_fields = meta.get_search_fields()
#             if not all_search_fields:
#                  # Fallback if no search fields defined in meta (search 'name'?)
#                  # Or decide not to search globally if no fields are marked.
#                  # Let's default to searching 'name' if available.
#                  if meta.get_field("name"):
#                      all_search_fields = ["name"]
#                  else:
#                      # Or maybe throw an error? Warn? For now, skip global search if no fields defined.
#                      frappe.msgprint(_("Global search enabled, but no searchable fields defined for DocType {0}. Skipping text search.").format(doctype), indicator="orange")
#                      return query_filters # Return only base filters

#             # Build an OR condition across all searchable fields
#             global_search_filter = ["or"]
#             for field in all_search_fields:
#                  # Check if field actually exists in the doctype to prevent errors
#                  if meta.has_field(field):
#                      global_search_filter.append([doctype, field, "like", search_term_sql])

#             # If query_filters is a list, append the OR condition
#             if isinstance(query_filters, list):
#                 # Only add the filter if there were valid searchable fields
#                 if len(global_search_filter) > 1:
#                     query_filters.append(global_search_filter)
#             # If query_filters is a dict, add the OR condition under a unique key (less common for list views)
#             elif isinstance(query_filters, dict):
#                  # Merging dict filters with complex OR conditions can be tricky.
#                  # Frappe's get_list primarily expects list format for complex filters.
#                  # Converting dict to list might be necessary if this combination occurs.
#                  # For simplicity, let's assume list format is preferred when search is active.
#                  # If you heavily rely on dict filters, this part needs careful design.
#                  if len(global_search_filter) > 1:
#                      # This simple append might break dict filter logic. A safer approach
#                      # would be to convert the dict filters to list format first.
#                      # frappe.msgprint("Warning: Combining global search with dictionary filters might be unstable.", indicator="orange")
#                      query_filters[f"_global_search_{search_term[:10]}"] = global_search_filter # Example key
#             else:
#                  # If filters started as None/empty, initialize as list
#                  if len(global_search_filter) > 1:
#                      query_filters = [global_search_filter]

#         elif search_fields:
#             # Apply search term to specific fields (AND condition)
#             meta = frappe.get_meta(doctype) # To validate fields
#             if isinstance(query_filters, list):
#                 for field in search_fields:
#                     if meta.has_field(field):
#                          query_filters.append([doctype, field, "like", search_term_sql])
#                     else:
#                          frappe.msgprint(_("Warning: Search field '{0}' not found in DocType '{1}'. Skipping.").format(field, doctype), indicator="orange")
#             elif isinstance(query_filters, dict):
#                  for field in search_fields:
#                      if meta.has_field(field):
#                          query_filters[field] = ["like", search_term_sql]
#                      else:
#                           frappe.msgprint(_("Warning: Search field '{0}' not found in DocType '{1}'. Skipping.").format(field, doctype), indicator="orange")
#             else:
#                 # Initialize filters as list if starting empty
#                 query_filters = []
#                 for field in search_fields:
#                      if meta.has_field(field):
#                          query_filters.append([doctype, field, "like", search_term_sql])
#                      else:
#                           frappe.msgprint(_("Warning: Search field '{0}' not found in DocType '{1}'. Skipping.").format(field, doctype), indicator="orange")

#     return query_filters
