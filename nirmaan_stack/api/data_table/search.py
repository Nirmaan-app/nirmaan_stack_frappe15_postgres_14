import frappe
from frappe import _
from frappe.utils import cint
from frappe.desk.reportview import execute as reportview_execute
import json
import hashlib
import traceback

from .constants import (
    DEFAULT_PAGE_LENGTH, MAX_PAGE_LENGTH, CACHE_EXPIRY,
    JSON_ITEM_SEARCH_DOCTYPE_MAP, CHILD_TABLE_ITEM_SEARCH_MAP,
    LINK_FIELD_MAP
)
from .utils import (
    _parse_filters_input, _process_filters_for_query,
    _parse_search_fields_input, _parse_target_search_field
)
from .aggregations import get_aggregates, get_group_by_results

def get_list_with_count_enhanced_impl(
    doctype, 
    fields, 
    filters=None,
    order_by=None, 
    limit_start=0, 
    limit_page_length=None,
    search_term=None, 
    current_search_fields=None,
    is_item_search=False,
    require_pending_items=False,
    to_cache=False,
    aggregates_config=None,
    group_by_config=None,
    **custom_params
):
    try:
        if not frappe.db.exists("DocType", doctype): frappe.throw(_("Invalid DocType: {0}").format(doctype))
        if not frappe.has_permission(doctype, "read"): frappe.throw(_("Not permitted"), frappe.PermissionError)

        start = cint(limit_start)
        page_length = min(cint(limit_page_length or DEFAULT_PAGE_LENGTH), MAX_PAGE_LENGTH)
        is_item_search_bool = isinstance(is_item_search, str) and is_item_search.lower() == 'true' or is_item_search is True
        require_pending_items_bool = isinstance(require_pending_items, str) and require_pending_items.lower() == 'true' or require_pending_items is True

        parsed_select_fields_str_list = _parse_search_fields_input(fields, f"{doctype} (select_fields)") or ["name"]
        
        # --- SAFE Link Field Label Injection ---
        try:
            meta = frappe.get_meta(doctype)
            fields_to_add = []
            for field in parsed_select_fields_str_list:
                if field in LINK_FIELD_MAP:
                    df = meta.get_field(field)
                    # ONLY inject if it's a Link field and matches our known mapping
                    if df and df.fieldtype == "Link" and df.options == LINK_FIELD_MAP[field]["doctype"]:
                        label_field = LINK_FIELD_MAP[field]["label_field"]
                        alias = f"{field}_name"
                        fields_to_add.append(f"{field}.{label_field} as {alias}")
            
            for f in fields_to_add:
                if f not in parsed_select_fields_str_list:
                    parsed_select_fields_str_list.append(f)
        except:
            pass # Keep it extremely safe

        if "name" not in parsed_select_fields_str_list: parsed_select_fields_str_list.insert(0, "name")
        
        raw_base_filters_list = _parse_filters_input(filters, doctype)
        processed_base_filters = _process_filters_for_query(raw_base_filters_list, doctype)
        target_search_field_name = _parse_target_search_field(current_search_fields, doctype)

        _formatted_order_by = order_by or f"`tab{doctype}`.`modified` desc"
        if order_by and not order_by.startswith(f"`tab{doctype}`") and not order_by.startswith("`tab"):
            parts = order_by.split(" ")
            field_part = parts[0].strip("`")
            sort_order_part = parts[1].upper() if len(parts) > 1 and parts[1].upper() in ["ASC", "DESC"] else "DESC"
            safe_fields_to_sort = set(parsed_select_fields_str_list) | {"modified", "creation", "owner", "idx"}
            if field_part in safe_fields_to_sort:
                _formatted_order_by = f"`tab{doctype}`.`{field_part}` {sort_order_part}"
            else:
                _formatted_order_by = f"`tab{doctype}`.`modified` desc"

        # --- Caching Key ---
        cache_key_params = {
            "v_api": "5.1", # Incremented for refactored version
            "doctype": doctype, 
            "fields": json.dumps(sorted(parsed_select_fields_str_list)),
            "filters": json.dumps(processed_base_filters),
            "order_by": _formatted_order_by,
            "start": start, 
            "page_length": page_length, 
            "search_term": search_term,
            "target_search_field": target_search_field_name,
            "is_item_search": is_item_search_bool,
            "require_pending_items": require_pending_items_bool,
            "aggregates_config": aggregates_config,
            "group_by_config": group_by_config,
            "custom_params": json.dumps(custom_params, sort_keys=True)
        }
        cache_key_string = json.dumps(cache_key_params, sort_keys=True, default=str)
        cache_key = f"dt_target_search_{doctype}_{hashlib.sha1(cache_key_string.encode()).hexdigest()}"
        
        if to_cache:
            cached_result = frappe.cache().get_value(cache_key)
            if cached_result: return cached_result

        data = []
        total_records = 0
        final_matching_parent_names = [] 
        final_and_filters = list(processed_base_filters)

        # Strategy selection
        use_child_table_item_search = (
            is_item_search_bool and search_term and target_search_field_name and
            doctype in CHILD_TABLE_ITEM_SEARCH_MAP and target_search_field_name in CHILD_TABLE_ITEM_SEARCH_MAP[doctype]
        )
        use_child_table_pending_filter = (
            not use_child_table_item_search and require_pending_items_bool and
            doctype in CHILD_TABLE_ITEM_SEARCH_MAP and
            (target_search_field_name if target_search_field_name in CHILD_TABLE_ITEM_SEARCH_MAP[doctype] else "order_list")
            in CHILD_TABLE_ITEM_SEARCH_MAP[doctype]
        )
        use_json_item_search = (
            not use_child_table_item_search and not use_child_table_pending_filter and
            is_item_search_bool and search_term and target_search_field_name and
            doctype in JSON_ITEM_SEARCH_DOCTYPE_MAP and
            JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype]["json_field"] == target_search_field_name
        )
        use_json_pending_filter = (
            not use_child_table_item_search and not use_child_table_pending_filter and
            not use_json_item_search and require_pending_items_bool and
            doctype in JSON_ITEM_SEARCH_DOCTYPE_MAP
        )

        if use_child_table_item_search:
            search_config = CHILD_TABLE_ITEM_SEARCH_MAP[doctype][target_search_field_name]
            parent_names_query_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
            potential_parent_names = [doc.get("name") for doc in reportview_execute(**parent_names_query_args) if doc.get("name")]
            if potential_parent_names:
                child_doctype_name = search_config["child_doctype"]
                child_link_field = search_config["link_field_to_parent"]
                searchable_child_fields = search_config["searchable_child_fields"]
                child_status_field = search_config.get("status_field")
                search_tokens = search_term.split() if search_term else []
                child_item_search_params = []
                token_conditions_groups = []
                if searchable_child_fields:
                    or_clause_template = " OR ".join([f"`tab{child_doctype_name}`.`{field}` ILIKE %s" for field in searchable_child_fields])
                    for token in search_tokens:
                        token_conditions_groups.append(f"({or_clause_template})")
                        child_item_search_params.extend([f"%{token}%"] * len(searchable_child_fields))
                child_item_search_conditions_sql = " AND ".join(token_conditions_groups)
                sql_where_parts = [f"`tab{child_doctype_name}`.`{child_link_field}` IN %s", f"`tab{child_doctype_name}`.`parenttype` = %s"]
                if child_item_search_conditions_sql: sql_where_parts.append(f"({child_item_search_conditions_sql})")
                if require_pending_items_bool and child_status_field: sql_where_parts.append(f"`tab{child_doctype_name}`.`{child_status_field}` = 'Pending'")
                sql = f"SELECT DISTINCT `tab{child_doctype_name}`.`{child_link_field}` FROM `tab{child_doctype_name}` WHERE {' AND '.join(sql_where_parts)}"
                sql_params_tuple = (tuple(potential_parent_names), doctype, *child_item_search_params)
                final_matching_parent_names = [r[0] for r in frappe.db.sql(sql, sql_params_tuple, as_list=True) if r and r[0]]
                total_records = len(final_matching_parent_names)

        elif use_child_table_pending_filter:
            child_table_field_key = target_search_field_name if target_search_field_name in CHILD_TABLE_ITEM_SEARCH_MAP[doctype] else "order_list"
            search_config = CHILD_TABLE_ITEM_SEARCH_MAP[doctype][child_table_field_key]
            child_status_field = search_config.get("status_field")
            if child_status_field:
                if search_term and target_search_field_name and target_search_field_name not in CHILD_TABLE_ITEM_SEARCH_MAP[doctype]:
                    final_and_filters.append([doctype, target_search_field_name, "like", f"%{search_term}%"])
                parent_names_query_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
                potential_parent_names = [doc.get("name") for doc in reportview_execute(**parent_names_query_args) if doc.get("name")]
                if potential_parent_names:
                    child_doctype_name = search_config["child_doctype"]
                    child_link_field = search_config["link_field_to_parent"]
                    sql = f"SELECT DISTINCT `tab{child_doctype_name}`.`{child_link_field}` FROM `tab{child_doctype_name}` WHERE `{child_link_field}` IN %(names_tuple)s AND `parenttype` = %(parent_doctype)s AND `{child_status_field}` = 'Pending'"
                    sql_params = {"names_tuple": tuple(potential_parent_names), "parent_doctype": doctype}
                    final_matching_parent_names = [r[0] for r in frappe.db.sql(sql, sql_params, as_list=True) if r and r[0]]
                    total_records = len(final_matching_parent_names)

        elif use_json_item_search:
            search_config = JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype]
            json_field_name = search_config["json_field"]
            item_path_parts = search_config["item_path_parts"]
            item_name_key_in_json = search_config.get("item_name_key_in_json", "item")
            parent_names_query_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
            potential_parent_names = [doc.get("name") for doc in reportview_execute(**parent_names_query_args) if doc.get("name")]
            if potential_parent_names:
                json_array_key = item_path_parts[0]
                search_tokens = search_term.split() if search_term else []
                token_conditions, token_params = [], {}
                for idx, token in enumerate(search_tokens):
                    param_key = f"token_{idx}"
                    token_conditions.append(f"item_obj->>'{item_name_key_in_json}' ILIKE %({param_key})s")
                    token_params[param_key] = f"%{token}%"
                json_search_conditions_sql = " AND ".join(token_conditions) if token_conditions else "1=1"
                json_search_sql_where_part = f"EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(`tab{doctype}`.`{json_field_name}`::jsonb->'{json_array_key}','[]'::jsonb)) AS item_obj WHERE {json_search_conditions_sql})"
                sql_params = {"names_tuple": tuple(potential_parent_names)}
                sql_params.update(token_params)
                data_names_sql = f"SELECT DISTINCT name FROM `tab{doctype}` WHERE name IN %(names_tuple)s AND ({json_search_sql_where_part})"
                final_matching_parent_names = [r[0] for r in frappe.db.sql(data_names_sql, sql_params, as_list=True) if r and r[0]]
                total_records = len(final_matching_parent_names)

        elif use_json_pending_filter:
            if search_term and target_search_field_name: final_and_filters.append([doctype, target_search_field_name, "like", f"%{search_term}%"])
            parent_names_query_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
            potential_parent_names = [doc.get("name") for doc in reportview_execute(**parent_names_query_args) if doc.get("name")]
            if potential_parent_names:
                search_config = JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype]
                json_field_name, item_path_parts = search_config["json_field"], search_config["item_path_parts"]
                json_array_key = item_path_parts[0]
                json_pending_sql_where_part = f"EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(`tab{doctype}`.`{json_field_name}`::jsonb->'{json_array_key}','[]'::jsonb)) AS item_obj WHERE item_obj->>'status' = 'Pending')"
                data_names_sql = f"SELECT DISTINCT name FROM `tab{doctype}` WHERE name IN %(names_tuple)s AND ({json_pending_sql_where_part})"
                final_matching_parent_names = [r[0] for r in frappe.db.sql(data_names_sql, {"names_tuple": tuple(potential_parent_names)}, as_list=True) if r and r[0]]
                total_records = len(final_matching_parent_names)

        else: # Standard Search
            if search_term and target_search_field_name:
                for token in search_term.split(): final_and_filters.append([doctype, target_search_field_name, "like", f"%{token}%"])
            count_fetch_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
            all_matching_docs = reportview_execute(**count_fetch_args)
            total_records = len(all_matching_docs)
            final_matching_parent_names = [d.get("name") for d in all_matching_docs if d.get("name")]

        # Final data fetch and results
        if final_matching_parent_names:
            limit_filters = [["name", "in", final_matching_parent_names]]
            data_args = frappe._dict({"doctype": doctype, "fields": parsed_select_fields_str_list, "filters": limit_filters, "order_by": _formatted_order_by, "limit_start": start, "limit_page_length": page_length})
            data = reportview_execute(**data_args)
        
        final_result = {
            "data": data,
            "total_count": total_records,
            "aggregates": get_aggregates(doctype, final_matching_parent_names, aggregates_config),
            "group_by_result": get_group_by_results(doctype, final_matching_parent_names, group_by_config)
        }

        if to_cache: frappe.cache().set_value(cache_key, final_result, expires_in_sec=CACHE_EXPIRY)
        return final_result

    except Exception as e:
        traceback.print_exc()
        frappe.throw(_("An error occurred while fetching list data: {0}").format(str(e)))
