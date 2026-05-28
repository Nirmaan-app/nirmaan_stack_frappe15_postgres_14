import frappe
from frappe import _
from frappe.utils import cint
from frappe.desk.reportview import execute as reportview_execute
import json
import hashlib
import re
import traceback

from .constants import (
    DEFAULT_PAGE_LENGTH, MAX_PAGE_LENGTH, EXPORT_MAX_PAGE_LENGTH, CACHE_EXPIRY,
    JSON_ITEM_SEARCH_DOCTYPE_MAP, CHILD_TABLE_ITEM_SEARCH_MAP,
    LINK_FIELD_MAP, TOKEN_SCORE_OPTED_IN_DOCTYPES
)
from .utils import (
    _parse_filters_input, _process_filters_for_query,
    _parse_search_fields_input, _parse_target_search_field
)
from .aggregations import get_aggregates, get_group_by_results
from .token_search import rank_parents_by_token_score, tokenize

# Above this many candidates we skip Python ranking and fall back to the
# existing `modified desc` order — avoids pathological work on huge result sets.
# 5000 chosen to comfortably hold full-item-name queries (5-9 generic tokens)
# without tripping the cap. Python ranking on 5000 rows is still well under 500ms.
# If slow-search logs show this exceeded routinely, bump further or revisit
# token-coverage threshold (Option α).
TOKEN_SCORE_MAX_CANDIDATES = 5000

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
    for_export=False,
    **custom_params
):
    try:
        if not frappe.db.exists("DocType", doctype): frappe.throw(_("Invalid DocType: {0}").format(doctype))
        if not frappe.has_permission(doctype, "read"): frappe.throw(_("Not permitted"), frappe.PermissionError)

        start = cint(limit_start)
        for_export_bool = isinstance(for_export, str) and for_export.lower() == 'true' or for_export is True
        effective_max = EXPORT_MAX_PAGE_LENGTH if for_export_bool else MAX_PAGE_LENGTH
        if for_export_bool and cint(limit_page_length) == 0:
            page_length = EXPORT_MAX_PAGE_LENGTH
        else:
            page_length = min(cint(limit_page_length or DEFAULT_PAGE_LENGTH), effective_max)
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
            # Handle wildcard: if '*' is in fetch fields, allow sorting on any valid doctype field
            # if "*" in safe_fields_to_sort:
            #     try:
            #         doctype_meta = frappe.get_meta(doctype)
            #         safe_fields_to_sort |= {df.fieldname for df in doctype_meta.fields}
            #         safe_fields_to_sort |= {"name"}
            #     except Exception:
            #         pass
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
                search_tokens = tokenize(search_term)

                # Token search at PARENT level with partial matches allowed.
                # A parent qualifies if at least ONE of its child rows matches
                # at least ONE token (UNION across tokens). Ranking later sorts
                # tighter matches (all tokens covered, ideally in one row) above
                # looser ones (only some tokens covered).
                candidate_set = set(potential_parent_names)
                final_set = candidate_set
                if search_tokens and searchable_child_fields:
                    # SQL-filter token set: drop short tokens (length 1) that
                    # explode the candidate set without adding specificity.
                    # Single chars like "6" match "600", "6mm", "6th" etc.
                    # everywhere and trip the TOKEN_SCORE_MAX_CANDIDATES cap,
                    # silently disabling ranking.
                    # If ALL tokens are short, fall back to using them anyway
                    # (single-char prefix search still works for queries like "L").
                    # The ranker downstream still sees the full token set for
                    # scoring — short tokens contribute to position weight.
                    filter_tokens = [t for t in search_tokens if len(t) >= 1] or search_tokens
                    # Word-boundary regex match: token must appear at start of
                    # string OR right after one of our separators. Avoids
                    # "gi" matching inside "galvanised".
                    or_clause = " OR ".join([f"`tab{child_doctype_name}`.`{field}` ~* %s" for field in searchable_child_fields])
                    extra_where = [f"`tab{child_doctype_name}`.`{child_link_field}` IN %s",
                                   f"`tab{child_doctype_name}`.`parenttype` = %s",
                                   f"({or_clause})"]
                    if require_pending_items_bool and child_status_field:
                        extra_where.append(f"`tab{child_doctype_name}`.`{child_status_field}` = 'Pending'")
                    base_sql = (
                        f"SELECT DISTINCT `tab{child_doctype_name}`.`{child_link_field}` "
                        f"FROM `tab{child_doctype_name}` WHERE {' AND '.join(extra_where)}"
                    )
                    union_set: set = set()
                    for token in filter_tokens:
                        boundary_pattern = r"(^|[\s\-_/()])" + re.escape(token)
                        regex_params = [boundary_pattern] * len(searchable_child_fields)
                        token_params = (tuple(potential_parent_names), doctype, *regex_params)
                        matched = {r[0] for r in frappe.db.sql(base_sql, token_params, as_list=True) if r and r[0]}
                        union_set |= matched
                    final_set = union_set
                elif require_pending_items_bool and child_status_field:
                    # No search term but pending-only required — restrict to parents
                    # with at least one Pending child row.
                    sql = (
                        f"SELECT DISTINCT `tab{child_doctype_name}`.`{child_link_field}` "
                        f"FROM `tab{child_doctype_name}` "
                        f"WHERE `{child_link_field}` IN %s AND `parenttype` = %s "
                        f"AND `{child_status_field}` = 'Pending'"
                    )
                    matched = {r[0] for r in frappe.db.sql(sql, (tuple(potential_parent_names), doctype), as_list=True) if r and r[0]}
                    final_set = matched

                # Preserve the original candidate-list order on ties.
                final_matching_parent_names = [n for n in potential_parent_names if n in final_set]
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
                search_tokens = tokenize(search_term)
                # SQL-filter token set: drop short tokens (length 1) that would
                # explode the candidate set without specificity. Ranker still
                # uses the full search_tokens. Fallback if all tokens are short.
                filter_tokens = [t for t in search_tokens if len(t) >= 1] or search_tokens
                # Token-OR (union) at PARENT level: a parent qualifies if at
                # least one JSON item matches at least one token. Matches the
                # child-table branch's behavior so PR/PO/WO are consistent.
                # Ranking later sorts tighter matches (all tokens in one item,
                # ideally) above looser ones.
                union_set: set = set()
                for token in filter_tokens:
                    boundary_pattern = r"(^|[\s\-_/()])" + re.escape(token)
                    sql = (
                        f"SELECT DISTINCT name FROM `tab{doctype}` "
                        f"WHERE name IN %(names_tuple)s AND EXISTS("
                        f"SELECT 1 FROM jsonb_array_elements("
                        f"COALESCE(`tab{doctype}`.`{json_field_name}`::jsonb->'{json_array_key}','[]'::jsonb)"
                        f") AS item_obj "
                        f"WHERE item_obj->>'{item_name_key_in_json}' ~* %(token_pattern)s)"
                    )
                    matched = {r[0] for r in frappe.db.sql(
                        sql, {"names_tuple": tuple(potential_parent_names), "token_pattern": boundary_pattern},
                        as_list=True,
                    ) if r and r[0]}
                    union_set |= matched
                # Preserve original order on ties.
                final_matching_parent_names = [n for n in potential_parent_names if n in union_set]
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
                for token in tokenize(search_term): final_and_filters.append([doctype, target_search_field_name, "like", f"%{token}%"])
            count_fetch_args = {"doctype": doctype, "filters": final_and_filters, "fields": ["name"], "limit_page_length": 0}
            all_matching_docs = reportview_execute(**count_fetch_args)
            total_records = len(all_matching_docs)
            final_matching_parent_names = [d.get("name") for d in all_matching_docs if d.get("name")]

        # Auto token-score ranking for item-search on opted-in doctypes.
        # Same matches and total_count as today — only order changes (relevance
        # instead of `modified desc`). Skipped for exports and large candidate
        # sets. On error, falls back to existing order.
        ranked_names = final_matching_parent_names
        should_rank = (
            doctype in TOKEN_SCORE_OPTED_IN_DOCTYPES
            and search_term
            and final_matching_parent_names
            and len(final_matching_parent_names) <= TOKEN_SCORE_MAX_CANDIDATES
            and not for_export_bool
            and (use_child_table_item_search or use_json_item_search)
        )
        if should_rank:
            try:
                if use_child_table_item_search:
                    search_config = CHILD_TABLE_ITEM_SEARCH_MAP[doctype][target_search_field_name]
                    child_doctype_name = str(search_config["child_doctype"])
                    child_link_field = str(search_config["link_field_to_parent"])
                    rank_fields = [str(f) for f in search_config["searchable_child_fields"]]
                    rank_weights = {f: (2.0 if i == 0 else 1.0) for i, f in enumerate(rank_fields)}
                    select_cols = ", ".join([f"`{f}`" for f in [child_link_field, *rank_fields]])
                    rank_rows = frappe.db.sql(
                        f"SELECT {select_cols} FROM `tab{child_doctype_name}` "
                        f"WHERE `{child_link_field}` IN %s AND parenttype = %s",
                        (tuple(final_matching_parent_names), doctype),
                        as_dict=True,
                    )
                    ranked_names = rank_parents_by_token_score(
                        parent_names=final_matching_parent_names,
                        rows=rank_rows,
                        parent_key=child_link_field,
                        query=search_term,
                        fields=rank_fields,
                        field_weights=rank_weights,
                    )
                else:  # use_json_item_search
                    search_config = JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype]
                    json_field_name = search_config["json_field"]
                    item_path_parts = search_config["item_path_parts"]
                    item_name_key = search_config.get("item_name_key_in_json", "item")
                    json_array_key = item_path_parts[0]
                    rank_rows = frappe.db.sql(
                        f"SELECT `tab{doctype}`.`name` AS parent, "
                        f"item_obj->>'{item_name_key}' AS rank_text "
                        f"FROM `tab{doctype}`, jsonb_array_elements("
                        f"COALESCE(`tab{doctype}`.`{json_field_name}`::jsonb->'{json_array_key}','[]'::jsonb)"
                        f") AS item_obj "
                        f"WHERE `tab{doctype}`.`name` IN %s",
                        (tuple(final_matching_parent_names),),
                        as_dict=True,
                    )
                    ranked_names = rank_parents_by_token_score(
                        parent_names=final_matching_parent_names,
                        rows=rank_rows,
                        parent_key="parent",
                        query=search_term,
                        fields=["rank_text"],
                        field_weights={"rank_text": 2.0},
                    )
            except Exception:
                traceback.print_exc()
                ranked_names = final_matching_parent_names

        # Final data fetch and results
        if final_matching_parent_names:
            if should_rank and ranked_names:
                page_names = ranked_names[start:start + page_length]
                limit_filters = [["name", "in", page_names]]
                data_args = frappe._dict({"doctype": doctype, "fields": parsed_select_fields_str_list, "filters": limit_filters, "order_by": None, "limit_start": 0, "limit_page_length": page_length})
                data = reportview_execute(**data_args)
                # Re-sort fetched rows to honor the ranked order (reportview ignores order_by=None and may return in arbitrary order).
                rank_index = {n: i for i, n in enumerate(page_names)}
                def _rank_key(r):
                    name = dict(r).get("name") or ""
                    return rank_index.get(name, len(page_names))
                data.sort(key=_rank_key)
            else:
                limit_filters = [["name", "in", final_matching_parent_names]]
                data_args = frappe._dict({"doctype": doctype, "fields": parsed_select_fields_str_list, "filters": limit_filters, "order_by": _formatted_order_by, "limit_start": start, "limit_page_length": page_length})
                data = reportview_execute(**data_args)
        
        final_result = {
            "data": data,
            "total_count": total_records,
            "aggregates": {} if for_export_bool else get_aggregates(doctype, final_matching_parent_names, aggregates_config),
            "group_by_result": [] if for_export_bool else get_group_by_results(doctype, final_matching_parent_names, group_by_config)
        }

        if to_cache: frappe.cache().set_value(cache_key, final_result, expires_in_sec=CACHE_EXPIRY)
        return final_result

    except Exception as e:
        traceback.print_exc()
        frappe.throw(_("An error occurred while fetching list data: {0}").format(str(e)))
